# CLAUDE.md — webp-tools

Claude Code에서 이 프로젝트를 이어서 작업하기 위한 컨텍스트입니다. 먼저 이 문서를
읽으세요. 아래 결정들은 **이미 확정**된 사항이니 다시 따지지 말고 그 위에서 진행하면
됩니다.

## 이게 뭔가

libwebp 도구들을 WASM으로 빌드해 `@btheegg-kimth/*` npm 스코프로 배포하는 pnpm
모노레포. 도구마다 별도 패키지로 두어 소비자는 필요한 것만 설치하고, 전부 하나의
libwebp 코어 + 하나의 빌드 파이프라인을 공유합니다. 목표는 여러(추후 별도) 레포에서의
재사용. 동기는 보안이 아니라 **편의 + 학습**입니다.

## 확정된 결정 (다시 열지 말 것)

1. **브라우저가 네이티브로 못 하는 것만 만든다.** 브라우저는 이미
   `canvas.toBlob('image/webp')`로 정적 이미지를 WebP 인코딩하고 WebP를 네이티브
   디코딩하므로, `cwebp` / `dwebp` / `vwebp`는 의도적으로 만들지 않음 — 중복 wasm
   부하만 늘어남. 실제 공백은 우선순위 순으로:

   - `gif2webp` — 애니메이션 GIF → 애니메이션 WebP (현재 작업 중)
   - `img2webp` — 프레임들 → 애니메이션 WebP (나중에, 필요해질 때만)
   - `webpmux` — 컨테이너/메타데이터 편집 (나중에, 필요해질 때만)
     cwebp/dwebp/vwebp 패키지는 추가하지 말 것. 단, Node/백엔드 사용이 범위에 들어오면
     재검토 — Node엔 네이티브 canvas 인코딩이 없어 그땐 가치가 생김.

2. **시나리오 B(소스 빌드), 재패키징 아님.** libwebp + giflib를 emscripten으로
   소스부터 컴파일. 남이 만든 prebuilt wasm을 재배포하지 않음(신뢰 가치 0이고,
   감사 불가능한 바이너리를 신뢰 네임스페이스로 세탁하는 셈).

3. **한 번에 하나씩 빌드.** 파이프라인은 공유라 2~3번째 도구는 싸게 추가됨.
   실제 필요가 생기기 전엔 img2webp/webpmux를 미리 만들지 말 것 (YAGNI).

4. **컴파일된 wasm은 레포에 커밋**(벤더링, 버전 핀)되고 npm 패키지에 함께 배포됨.
   소비자는 컴파일도, Docker도 필요 없음.

5. **버전은 `build/versions.env`에 핀** 박음
   (emsdk 3.1.74, libwebp 1.6.0, giflib 5.2.2). 버전 올릴 때 = 이 파일 수정 →
   재빌드 → 새 wasm SHA-256 기록 → semver 올림 → 재배포.

6. **라이선스:** 래퍼 코드는 MIT. wasm 안에는 libwebp(BSD-3-Clause)와
   giflib(MIT)이 박혀 있으므로, 그 라이선스 전문을 반드시 `packages/*/licenses/`에
   포함해야 함(빌드가 자동 수집) 그리고 `THIRD_PARTY_LICENSES.md`에 문서화.
   내 코드를 MIT로 건다고 번들된 부분이 재라이선스되는 게 아님.

7. **배포:** npm public, **무료 npm org** `btheegg-kimth` 하에서
   (개인 username 아님 — 신원과 의존성을 분리, 작성자가 떠나도 유지됨).
   스코프드 패키지는 `--access public`으로 배포(각 package.json의
   `publishConfig`가 처리).

## 레이아웃

```
build/
  Dockerfile        # emscripten 환경 + scratch 'export' 스테이지
  build.sh          # giflib + libwebp + gif2webp -> wasm (컨테이너 안에서 실행)
  build-docker.sh   # 호스트: docker build --output -> packages/gif2webp/wasm/
  versions.env      # 핀 박은 버전들
packages/gif2webp/
  src/index.ts      # 타입 래퍼: gif2webp(Uint8Array, opts) -> Uint8Array
  wasm/             # 커밋되는 빌드 산출물 (gif2webp.mjs — wasm 인라인됨)
  licenses/         # 업스트림 라이선스 전문 (빌드가 채움)
```

빌드 흐름: giflib → `libgif.a` (emcc/emar); libwebp는 `emcmake cmake`로
`WEBP_BUILD_GIF2WEBP=ON` + `WEBP_USE_THREAD=OFF`(pthread 비활성); gif2webp를
`MODULARIZE + EXPORT_ES6 + EXPORTED_RUNTIME_METHODS=callMain,FS + INVOKE_RUN=0`,
`SINGLE_FILE=1`(wasm을 base64로 mjs에 인라인), `ENVIRONMENT=web,worker`로
WASM ES 모듈로 링크. 래퍼는 가상 FS로 구동: `input.gif` 쓰기 → `callMain(args)`
→ `output.webp` 읽기. 호출은 mutex로 직렬화 (가상 FS 공유 + callMain 글로벌
상태 때문).

**pthread 비활성 + SINGLE_FILE + node 제외 결정의 근거:**
- pthread 비활성 (`WEBP_USE_THREAD=OFF`, 0.0.1→0.0.2): pthread 빌드는 COOP/COEP
  헤더 + SharedArrayBuffer + Worker 파일 별도 호스팅을 요구해 일반 Vite/Next에서
  못 씀. gif2webp는 짧은 단일 변환이라 멀티스레드 이득 < 배포 비용.
- SINGLE_FILE: .wasm을 별도 파일로 두지 않아 번들러 친화.
- node 제외 (`web,worker`, 0.0.2→0.0.3): `node`를 넣으면 glue에 `import("module")`이
  박혀 소비자 Vite 빌드에서 "Module externalized" 경고 + `optimizeDeps.exclude`를
  강요. 브라우저 전용 라이브러리라 제거. `worker`는 남겨 소비자가 Web Worker
  안에서 변환 가능. 트레이드오프: Node 실행 불가 → 자동 스모크 대신 수동 QA
  (`examples/playground`, `pnpm qa`).

## 현재 상태 (2026-05-27)

- ✅ 스캐폴드 + 빌드 파이프라인 + 래퍼 작성 완료
- ✅ wasm 빌드 검증됨 (SHA: `build/versions.lock` 참조)
- ✅ 래퍼 wasm 로딩 확정 (emit된 glue 모양과 매칭)
- ✅ 브라우저 실측 검증 (`pnpm qa` → playground에서 실 GIF 변환 확인)
- ✅ TS 6.0 + tsdown 빌드 파이프라인 확정
- ✅ 0.0.1 → 0.0.2 (pthread 제거 + SINGLE_FILE) → 0.0.3 (node 제외) publish됨
- 📌 검증은 수동 QA (`pnpm qa`) — Node 자동 스모크는 ENVIRONMENT=web,worker라 불가

## 바로 다음 작업

1. **사람:** GitHub repo `webp-tools` 생성 + 첫 푸시
2. **사람:** npmjs.com에서 무료 org `btheegg-kimth` 생성 + 2FA 활성화
3. **사람:** `npm login` (대화형 2FA)
4. **사람:** `cd packages/gif2webp && npm publish`
5. 그 후 — 실 사용 피드백 들어오면 img2webp/webpmux 검토 (결정 #1, #3)

기술적으론 배포 준비 완료. 패키지에 들어가는 파일:
- `dist/index.mjs` + `index.d.mts` + sourcemaps (tsdown 산출물)
- `wasm/gif2webp.mjs` (커밋된 emscripten 산출물 — SINGLE_FILE=1로 wasm 인라인, 별도 .wasm 없음)
- `licenses/{libwebp,giflib}-LICENSE.txt` (업스트림 라이선스 전문)
- `LICENSE`, `README.md`, `THIRD_PARTY_LICENSES.md`

## 에이전트용 컨벤션

- wasm은 **lazy-load** 유지(첫 `gif2webp()` 호출 때만) — 소비자 메인 번들 부풀지
  않도록. 이미 dynamic import로 로드됨.
- emscripten glue/wasm을 tsdown으로 번들하지 말 것 — `wasm/`에서 그대로 배포
  (`tsdown.config.js`의 `deps.neverBundle`). wasm 로딩이 유일하게 DX 민감한
  부분이니 번들러 비종속적으로 유지(타겟: Vite 소비자).
- npm 토큰/시크릿 절대 커밋 금지. 2FA + `npm login`은 대화형.
- 업스트림 버전 올릴 땐 결정 #5 따르기(재빌드 + SHA + semver + 재배포).
- 빌드 산출물 SHA는 `build/versions.lock`에 박혀있음; 재빌드 결과가 다르면
  의도된 변경인지 환경 차이인지 확인.

## 사람만 할 수 있는 작업 (에이전트 불가)

- npmjs.com에서 무료 org `btheegg-kimth` 생성 + 2FA 활성화.
- 배포 전 `npm login` (대화형 2FA).
- GitHub repo(`webp-tools`) 생성/확인; 회사가 공식 채택하면 추후 회사 org로
  이전 가능(GitHub 이전은 쉬움 — 어려운 건 npm 스코프 쪽).
- `pnpm build:wasm`용 Docker 설치/실행.
- 배포 명령 실행 (`cd packages/gif2webp && npm publish`).
- 선택: 회사 repo들이 이걸 의존하게 되므로 엔지니어링 결정 권한자에게 가벼운 공유.

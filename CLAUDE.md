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
  Dockerfile                 # gif2webp: emscripten 환경 + scratch 'export' 스테이지
  build.sh                   # giflib + libwebp + gif2webp -> wasm (patches/ 적용)
  patches/                   # 업스트림 소스 패치 (gif2webp.patch)
  build-docker.sh            # 호스트: docker build --output -> packages/gif2webp/wasm/
  Dockerfile.img2webp        # img2webp: 입력 디코더(zlib/png/jpeg) 소스 빌드 추가
  build-img2webp.sh          # zlib+libpng+libjpeg-turbo + libwebp + img2webp -> wasm
  build-docker-img2webp.sh   # 호스트: docker build --output -> packages/img2webp/wasm/
  versions.env               # 핀 박은 버전들 (emsdk/libwebp/giflib + 코덱 3종)
  versions.lock              # 산출물 SHA-256
packages/gif2webp/
  src/index.ts      # 타입 래퍼: gif2webp(Uint8Array, opts) -> Uint8Array (메인 스레드)
  src/worker.ts     # `/worker`: 같은 시그니처의 gif2webp()를 워커에서 실행 (첫 호출 때 워커 생성)
  src/worker-entry.ts # 워커 안에서 도는 스크립트 (`/worker-entry`, sideEffects로 표시)
  src/client.ts     # postMessage <-> Promise 클라이언트 (createGif2WebpWorker)
  src/core.ts       # 변환 런타임 (wasm 로더를 인자로 받음: 메인 = 동적 import, 워커 = 정적 import)
  src/args.ts       # 옵션 -> CLI 인자
  wasm/             # 커밋되는 빌드 산출물 (gif2webp.mjs — wasm 인라인됨)
  licenses/         # 업스트림 라이선스 전문 (빌드가 채움)
packages/img2webp/
  src/index.ts      # 타입 래퍼: img2webp(frames[], opts) -> Uint8Array (멀티프레임)
  wasm/             # 빌드 완료, 커밋됨 (img2webp.mjs — SHA는 versions.lock)
  licenses/         # libwebp/libpng/zlib/libjpeg-turbo 전문 (빌드가 채움)
```

도구마다 빌드 trio가 분리돼 있다(공유 emsdk 베이스 + 동일 철학, 스크립트는 병렬).
gif2webp는 giflib만 필요하지만 img2webp는 PNG/JPEG 프레임을 읽어야 해서
zlib+libpng+libjpeg-turbo를 소스로 추가 빌드한 뒤 libwebp `find_package(ZLIB/PNG/
JPEG)`에 물린다. 에뮤스크립튼 ports를 쓰지 않는 건 코덱 버전이 emsdk에 묶여
versions.env 핀이 깨지기 때문(결정 #2/#5).

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

## 현재 상태 (2026-06-02)

**gif2webp** (publish 완료):
- ✅ 스캐폴드 + 빌드 파이프라인 + 래퍼 작성 완료
- ✅ wasm 빌드 검증됨 (SHA: `build/versions.lock` 참조)
- ✅ 래퍼 wasm 로딩 확정 (emit된 glue 모양과 매칭)
- ✅ 브라우저 실측 검증 (`pnpm qa` → playground에서 실 GIF 변환 확인)
- ✅ TS 6.0 + tsdown 빌드 파이프라인 확정
- ✅ 0.0.1 → 0.0.2 (pthread 제거 + SINGLE_FILE) → 0.0.3 (node 제외) → 0.0.4 (리사이즈) publish됨 → 0.0.5 (lossless/loopCount 버그 수정) publish됨
- 📌 검증은 수동 QA (`pnpm qa`) — Node 자동 스모크는 ENVIRONMENT=web,worker라 불가
- ✅ **0.0.4: 리사이즈 옵션 publish됨** — `resize?: { width, height, fit, withoutEnlargement }`.
  업스트림에 없어서 `build/patches/gif2webp.patch`로 `-resize <w> <h>`,
  `-resize_fit`, `-resize_down_only` 플래그를 추가했다(소스 빌드 + 감사 가능 패치라
  결정 #2와 맞음). 핵심: `curr_canvas`는 다음 프레임 blend/dispose가 GIF 좌표로
  쓰므로 **복사본**을 `WebPPictureRescale`로 줄여 Add해야 함(제자리 rescale 금지).
  네이티브 빌드 + ASan으로 크기, 픽셀, 투명도를 검증함. wasm 빌드 완료
  (`gif2webp.mjs = ab9237…`), headless Chrome에서 wasm 결과가 네이티브 결과와
  바이트 단위로 같음을 확인. README 예시 이미지는 `packages/gif2webp/docs/`에 있고
  raw.githubusercontent URL로 참조하므로 main에 push해야 보임(npm `files`에는 없음).
  publish된 tarball의 wasm SHA가 versions.lock과 일치함을 확인. libwebp 버전을
  올릴 땐 패치가 다시 적용되는지 확인할 것.
- ✅ **0.0.5: 버그 수정 publish됨** — 래퍼가 gif2webp에 없는 플래그 두 개를 넘기고 있었음
  (0.0.1부터). `lossless: true` → `-lossless`, `loopCount` → `-loop_count` 둘 다
  `Unknown option`으로 실패. lossless는 gif2webp 기본값이라 플래그를 빼고
  lossy/mixed와 같이 주면 에러로 처리. loopCount는 패치에 `-loop_count` 덮어쓰기를
  추가(WebP 기준 0 = 무한). 패치 이름은 `gif2webp.patch`로 변경. wasm 재빌드
  (`9a0d5d…`) + headless Chrome QA 완료(0.0.4 옵션 결과는 바이트 단위로 동일).
  publish된 tarball의 wasm SHA가 versions.lock과 일치함을 확인.
- 🚧 **0.0.6: 워커 API** — `import { gif2webp } from "@btheegg-kimth/gif2webp/worker"`.
  메인 스레드용과 시그니처가 같고, 첫 호출 때 패키지 안에서
  `new Worker(new URL("./worker-entry.mjs", import.meta.url), { type: "module" })`로
  워커를 만든다. wasm은 그대로(재빌드 없음). 입력은 기본 복사(5 MB에 1 ms 미만),
  `transfer: true`로 복사 없이 넘길 수 있음. 워커 로드 실패 시 닫고 다음 호출 때 다시
  만든다. 검증: **npm pack tarball을 설치한 별도 Vite 8 프로젝트**에서 dev와 build를 둘 다
  확인(workspace 링크인 playground는 Vite 의존성 사전 번들링을 거치지 않아 검증이 안 됨).
  최대 멈춤 4,179 ms → 33 ms, 결과는 바이트 단위로 동일, 첫 호출 전엔 워커/wasm 미요청.
  주의: `sideEffects: false`였을 때 `import "…/worker-entry"`가 tree-shake돼 수동
  경로가 0 kB가 됐음 → `sideEffects`에 worker-entry만 표시. 공유 워커는 마지막 작업 후
  `idleTimeoutMs`(기본 30초, `configureGif2WebpWorker`로 변경, 0 = 즉시, Infinity = 끔)
  동안 요청이 없으면 자동 종료(대기열이 있으면 종료 안 함). `terminateGif2WebpWorker()`로
  수동 종료. 끊긴 작업은 전부 reject. 생성/종료 횟수를 세는 테스트로 dev와 build 둘 다 확인.
  `createGif2WebpWorker`로 만든 수동 워커는 자동 종료하지 않음.
  push 전 점검(리뷰 서브에이전트 + 소비자 환경 테스트)에서 찾아 고친 것:
  - **스택 누수 (0.0.1부터, 메인 스레드도 해당):** emscripten `callMain`은 argv를 wasm
    스택에 올리고 되돌리지 않는다. 같은 모듈로 425번째 호출에서 크래시, 426번째는 무한
    대기. → `stackSave`/`stackRestore`를 export하고(wasm 재빌드) 호출마다 복원.
    ExitStatus가 아닌 예외면 모듈을 버리고 다음 호출 때 새로 만든다.
  - gif2webp.c 전역 `transparent_index`가 호출 사이에 남음 → 패치에서 main() 시작 때 초기화.
  - Vite 5~7 build 실패(워커 기본 형식 iife는 동적 import 불가) → 워커는 glue를 정적 import.
  - Vite 5~7 dev는 의존성 사전 번들링 때문에 워커 경로를 잃음 → 패키지로는 못 고침.
    소비자가 `optimizeDeps.exclude`에 추가해야 함(README 표, 에러 메시지에도 안내).
  - `new Worker` 실패 등이 동기 throw였음 → 전부 reject. node10 타입 해석(typesVersions),
    setTimeout 한도 초과, 부분 view transfer, 워커 쪽 에러 전송 실패 대비.
  - 주의: `new Worker(new URL(...))`는 반드시 한 식으로 둘 것(URL을 변수로 빼면 번들러가
    워커로 인식하지 못함).
  검증: Vite 5/6/7/8 build·dev(41개 항목), webpack 5, tsc bundler/node16/node10, publint,
  attw, Node import. 회귀 스위트는 600회 연속 변환과 전역 상태 누수 재현을 포함.
  남은 작업: publish. img2webp도 같은 callMain 스택 누수가 있음(별도 수정 필요).

**img2webp** (publish 완료 — 우선순위 2번째 도구, 결정 #1):
- ✅ 빌드 trio + 코덱(zlib/libpng/libjpeg-turbo) 소스 빌드 스크립트 작성
- ✅ 멀티프레임 타입 래퍼 작성 (`img2webp(frames[], opts)`; per-frame duration/q/m)
- ✅ versions.env 코덱 핀, playground img2webp QA 섹션(canvas PNG 3장 생성→변환) 추가
- ✅ **wasm 빌드 완료** — `pnpm build:wasm:img2webp`(Docker) 실행됨.
  `packages/img2webp/wasm/img2webp.mjs` 생성 + SHA를 `build/versions.lock`에 기록
  (`img2webp.mjs = dd2359…`, 실제 파일과 일치 확인).
- ✅ **브라우저 QA 완료** — `pnpm qa` → playground "img2webp" 섹션에서 PNG 3장 →
  애니메이션 WebP 변환 실측 확인 (PNG 디코드 경로 검증 통과).
- ✅ **0.0.1 publish됨** — https://www.npmjs.com/package/@btheegg-kimth/img2webp
  (repository.url은 `git+https://…` 정규화 형식으로 맞춰 publish 경고 제거).
- 📌 빌드 리스크(통과 확인됨, 재빌드 시 재확인): libwebp CMake가 우리 prefix에서
  PNG/JPEG를 `find_package`로 찾아야 디코드가 켜짐. 재빌드 시 로그에서 PNG/JPEG
  "found/YES" 확인. 실패 시 WebP/PNM만 읽힘 → `-DPNG_LIBRARY` 등 점검하며 iterate.

## 바로 다음 작업

gif2webp 배포 트랙:
1. **사람:** GitHub repo `webp-tools` 생성 + 첫 푸시
2. **사람:** npmjs.com에서 무료 org `btheegg-kimth` 생성 + 2FA 활성화
3. **사람:** `npm login` (대화형 2FA)
4. **사람:** `cd packages/gif2webp && npm publish`

img2webp 트랙 (✅ 전부 완료 — 0.0.1 publish됨):
1. ✅ ~~`pnpm build:wasm:img2webp` → `img2webp.mjs` 생성~~ — 완료.
2. ✅ ~~생성된 SHA를 `build/versions.lock`에 기록~~ — 완료 (`img2webp.mjs = dd2359…`).
3. ✅ ~~`pnpm qa` → playground에서 PNG 3장 → 애니메이션 WebP 변환 확인~~ — 완료.
4. ✅ ~~`cd packages/img2webp && npm publish` (0.0.1)~~ — 완료.

기술적으론 배포 준비 완료. 패키지에 들어가는 파일:
- `dist/index.mjs` + `index.d.mts` + sourcemaps (tsdown 산출물)
- `wasm/gif2webp.mjs` (커밋된 emscripten 산출물 — SINGLE_FILE=1로 wasm 인라인, 별도 .wasm 없음)
- `licenses/{libwebp,giflib}-LICENSE.txt` (업스트림 라이선스 전문)
- `LICENSE`, `README.md`, `THIRD_PARTY_LICENSES.md`

## 에이전트용 컨벤션

- wasm은 **lazy-load** 유지(첫 `gif2webp()` 호출 때만) — 소비자 메인 번들 부풀지
  않도록. 이미 dynamic import로 로드됨. 워커 버전도 첫 호출 때 워커를 만든다.
- 번들러 동작(워커, sideEffects, 사전 번들링)이 걸린 변경은 workspace playground가
  아니라 `npm pack` tarball을 설치한 별도 Vite 프로젝트에서 dev와 build를 둘 다 확인할 것.
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

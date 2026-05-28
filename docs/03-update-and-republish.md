# 업데이트 + 재배포

이미 publish된 패키지(예: `@btheegg-kimth/gif2webp`)의 새 버전을 배포하는 반복
워크플로. 첫 publish는 [`01-create-npm-library.md`](./01-create-npm-library.md), 새
패키지 추가는 [`02-add-package-to-org.md`](./02-add-package-to-org.md) 참고.

---

## 0. 핵심 원칙

- **git push와 npm publish는 완전 별개.** 자동 sync 없음. 둘 다 따로 돌려야 함.
- **같은 버전 재배포 불가.** npm이 거부. 코드 한 글자 바뀌면 버전도 올려야 함.
- **권장 순서: git → npm.** npm publish 실패해도 git 상태 깨끗. 반대로 npm 먼저면
  "이 버전은 어디서 왔지?" 추적 불가.
- **publish는 immutable.** 24시간 지나면 unpublish 불가, deprecate만 가능. 신중히.

---

## 1. 일반 업데이트 (코드만 수정, WASM 재빌드 없음)

가장 흔한 경우 — wrapper API 보강, 버그 수정, 옵션 추가 등.

### 1.1 변경 종류별 semver

| 변경 | semver | 명령 |
|---|---|---|
| 버그 수정 (동작 그대로) | patch | `npm version patch` (0.0.1 → 0.0.2) |
| 기능 추가 (하위 호환) | minor | `npm version minor` (0.0.1 → 0.1.0) |
| breaking change (API 변경) | major | `npm version major` (0.0.1 → 1.0.0) |

0.x.y는 어차피 unstable이라 minor도 breaking 허용한다고 보는 게 관행. 1.0.0
이상부터 semver 엄격히 지킬 것.

### 1.2 전체 흐름

```sh
# (1) 코드 수정
# 편집 …

# (2) 버전 올림
cd packages/gif2webp
npm version patch        # package.json의 version 자동 수정
# 주의: 이 명령은 기본적으로 자동 git commit + tag도 만든다.
#       워크스페이스 환경에서 의도치 않게 add 될 수 있으므로 첫 몇 번은
#       package.json만 수동 편집하는 게 안전.

# (3) 빌드 + 브라우저 QA
cd ../..
pnpm qa                  # dist 빌드 + playground dev → 브라우저에서 변환 확인
# 결과가 브라우저에 정상 표시돼야 다음으로 (Node 스모크는 web,worker라 불가)

# (4) 커밋 + push (먼저!)
git add -A
git commit -m "fix(gif2webp): ..."
git push

# (5) publish (그 다음)
cd packages/gif2webp
npm publish
# 2FA 활성화돼 있으면 OTP 코드 입력 프롬프트
```

### 1.3 publish 후 확인

```sh
# 레지스트리 반영 확인 (즉시)
npm view @btheegg-kimth/gif2webp version

# 깨끗한 환경에서 설치 테스트 (강력 권장)
cd /tmp && mkdir verify && cd verify
npm init -y
npm install @btheegg-kimth/gif2webp@latest
ls node_modules/@btheegg-kimth/gif2webp/wasm
```

---

## 2. WASM 재빌드가 필요한 업데이트

업스트림(libwebp, giflib, emsdk) 버전을 올릴 때. 추가 단계가 앞에 붙음.

### 2.1 전체 흐름

```sh
# (1) build/versions.env 수정
# EMSDK_VERSION, LIBWEBP_VERSION, GIFLIB_VERSION 중 필요한 것 갱신

# (2) Docker 빌드
pnpm build:wasm
# 마지막 출력에 새 SHA-256 두 개 찍힘 (.wasm, .mjs)

# (3) build/versions.lock 갱신
# - 헤더의 emsdk/libwebp/giflib 버전 표기 업데이트
# - 두 SHA를 새 값으로 교체

# (4) 브라우저 QA
pnpm qa
# 새 wasm으로 브라우저에서 변환 동작 확인

# (5) 버전 올림 (수동 또는 npm version)
# 업스트림 메이저가 올라간 거면 패키지도 minor 이상 올리는 게 정직

# (6) git → npm 순서로 (1.2와 동일)
```

### 2.2 검토 포인트

- **SHA가 예상 외로 바뀌었는지** — 같은 핀 박은 버전을 다시 빌드했는데 SHA가 다르면
  비결정성(emsdk 내부 변경 등). 원인 파악 권장.
- **wrapper API에 영향?** — 업스트림 CLI 플래그가 deprecated/removed면 wrapper의
  옵션도 손봐야 함. 변경되면 README + THIRD_PARTY_LICENSES.md 갱신.

---

## 3. 자잘한 팁

### npm version 자동 commit 활성/비활성

`npm version`은 기본적으로 git이 깨끗할 때만 동작하고, package.json 수정 후 자동으로
commit + `v0.0.2` 형태의 tag를 만든다.

```sh
# 자동 commit/tag 비활성:
npm version patch --no-git-tag-version

# Tag 메시지 커스텀:
npm version patch -m "Release %s"   # %s는 새 버전으로 치환
```

워크스페이스 환경에선 자동 commit이 packages/<one>/package.json만 add해서 깔끔한 편.
다만 dist/ 같은 빌드 산출물이 untracked일 때 동작이 어색할 수 있으니 한 번
`--no-git-tag-version`으로 수동 흐름 익혀두는 게 안전.

### dry-run으로 안전망

publish 직전엔 항상:

```sh
cd packages/gif2webp
npm publish --dry-run
```

포함될 파일 목록 + 사이즈 확인. LICENSE/README/wasm/dist 다 들어가는지 검사.

### 잘못된 버전을 올렸을 때

```sh
# 24시간 이내 + 의존하는 다른 패키지가 없으면:
npm unpublish @btheegg-kimth/gif2webp@0.0.2

# 그 후엔 unpublish 불가. 대신 deprecate:
npm deprecate @btheegg-kimth/gif2webp@0.0.2 "버그 있음, 0.0.3 사용"
```

deprecate는 설치는 가능하지만 사용자에게 경고 표시. 이미 의존하는 사람이 있으면
unpublish는 그들의 빌드를 깨므로 npm 정책상도 권장 안 됨.

### CDN 캐시

- jsdelivr / unpkg: ~10분 내 자동 반영
- `npmjs.com` 페이지: 즉시 반영
- `npm view`: 즉시
- 회사 사내 미러(있다면): 별도 동기화 주기

### 로그아웃 (회사 노트북)

publish 끝나면 토큰 삭제:

```sh
npm logout
```

`~/.npmrc`의 토큰이 평문 저장되니 회사 장비 분실/공유 시 리스크. 다음 publish 시
`npm login` 다시 (30초). 자주 publish할 일 없으니 비용 거의 0.

---

## 4. 자주 실수하는 지점

### "Already published" 에러

```
npm error 403 Forbidden - PUT https://registry.npmjs.org/...
npm error 403 You cannot publish over the previously published versions
```

같은 버전을 두 번 publish 시도. package.json의 version을 올리고 재시도.

### `ENEEDAUTH`

```
npm error code ENEEDAUTH
npm error need auth This command requires you to be logged in
```

로그인 안 됐거나 세션 만료. `npm login` → `npm whoami` 확인 후 재시도.

### wasm이 패키지에 안 들어감

`npm publish --dry-run`에서 `wasm/` 디렉터리가 안 보임. 원인:
- `package.json`의 `files` 배열에 `"wasm"` 누락
- `.npmignore` 파일이 wasm/을 무시 (있다면 확인)
- `wasm/` 디렉터리 자체가 비어있음 — 빌드 안 한 것. `pnpm build:wasm` 먼저.

### git이 dirty인데 publish 됨

publish는 git 상태 안 봄. 의도적이지만, 헷갈리지 말 것 — git push 안 한 채 publish하면
nm에 올라간 코드와 GitHub의 코드가 분리됨. **항상 git → npm 순서** 지킬 것.

---

## 4.5 critical 버그 발견 시 (실 사례 기반)

publish된 패키지가 실 사용 환경에서 깨진 게 발견되면:

1. **재현부터.** 가능하면 깨진 환경의 최소 재현 예제 확보. (예: Vite 새 프로젝트
   `npm create vite@latest` → install + import → 깨지는 화면 캡처)
2. **원인 분석 → 수정 → 검증.** 같은 재현 코드로 검증.
3. **patch 버전 올려서 publish.** breaking change 아니면 patch (0.0.1 → 0.0.2).
4. **이전 버전 deprecate** — 다른 사용자가 같은 함정 안 빠지게:
   ```sh
   npm deprecate @btheegg-kimth/gif2webp@0.0.1 "브라우저에서 동작 안 함, 0.0.2 사용"
   ```
   `unpublish`는 24시간 + 의존자 없을 때만 가능 + 권장 안 함. **deprecate가 정답.**
5. **함정을 docs에 기록.** `01-create-npm-library.md` § 흔한 함정 같은 곳에 항목 추가.
   같은 함정에 본인이 다시 빠지지 않도록 + 추후 패키지에 같은 실수 안 하도록.

### 실 사례: 0.0.1 → 0.0.3 두 번의 브라우저 함정

- **0.0.1 → 0.0.2 (pthread):** Vite에서 import하면 parse 에러 + 런타임 404. 원인:
  libwebp CMake가 자동으로 pthread를 켜서 Worker 스폰 코드 + SharedArrayBuffer 요구가
  박힘. 해결: `-DWEBP_USE_THREAD=OFF` + `-sSINGLE_FILE=1`.
- **0.0.2 → 0.0.3 (node env):** `ENVIRONMENT=web,worker,node`의 `node`가 glue에
  `import("module")`을 박아 소비자 `vite build`에서 "Module externalized" 경고 +
  `optimizeDeps.exclude` 강요. 해결: `node` 제거 (`web,worker`).

배운 점: **Node 스크립트 스모크는 브라우저 함정을 못 잡는다** (Node 경로만 타니까).
브라우저 전용 라이브러리는 `examples/playground`(실제 Vite + 브라우저)로 QA하고,
소비자 경로는 `npm pack` → 별도 프로젝트 설치로 확인. 이래서 자동 Node 스모크를
버리고 수동 브라우저 QA로 전환함.

## 5. 자동화로 갈 시점은?

수동 흐름이 한두 번은 학습 가치 있지만, 5번쯤 반복하면 GitHub Actions로 자동화 검토.

대략:
- 태그(`v*`) push → CI가 build + test + publish
- npm publish용 automation token (회전 가능, 2FA 우회용)
- `npm publish --provenance` (GitHub Actions에서 attestation 자동 생성)

지금은 over-engineering. 두 번째 패키지 추가하거나 publish 횟수가 늘면 그때 검토.

# npm 라이브러리 만들기 — WASM 도구 풀스택 가이드

`@btheegg-kimth/gif2webp`을 처음부터 만들어 npm public에 배포한 과정 그대로의
가이드. 같은 흐름이 다른 WASM-기반 첫 패키지에도 적용된다.

기존 webp-tools에 **추가** 패키지(2번째 이후)를 붙이는 경우는
[`02-add-package-to-org.md`](./02-add-package-to-org.md) 참고 — 훨씬 짧다.

---

## 0. 사전 결정 (코드 치기 전에)

먼저 답해야 할 질문들. 답이 명확하지 않으면 다음 단계로 가지 말 것.

### 0.1 진짜로 만들 가치가 있나?

브라우저/Node 표준이 이미 하는 일을 wasm으로 다시 만들면 **중복 번들 부하만 늘
어남.** 이번 케이스에선:

- `cwebp` / `dwebp` ❌ — `canvas.toBlob('image/webp')` + 네이티브 디코딩이 이미 함
- `gif2webp` ✅ — 캔버스로 GIF 인코딩하면 첫 프레임만 살아남음. 진짜 공백.

판단: **표준이 못 하거나 부족한 부분만 wasm으로.**

### 0.2 소스 빌드 vs prebuilt 재배포?

| | 장점 | 단점 |
|---|---|---|
| 소스 빌드 | 신뢰 가능, 감사 가능, 버전 고정 | Dockerfile + 빌드 스크립트 작성 부담 |
| prebuilt 재포장 | 빠름 | 신뢰 가치 0. 남의 바이너리를 내 네임스페이스로 세탁하는 셈 |

**소스 빌드 권장.** 한 번 작성하면 재사용됨.

### 0.3 npm scope 선택

- 개인 username (`@kimth/...`) — 작성자 떠나면 끝
- **무료 org (`@btheegg-kimth/...`)** — 신원/소유 분리, 권장

org는 npmjs.com에서 무료로 생성. 2FA 필수.

### 0.4 라이선스 조합

래퍼 코드는 MIT. 내부에 박힌 업스트림 라이선스는 그대로 유지:
- libwebp → BSD-3-Clause
- giflib → MIT

"내 코드 MIT 걸면 다 MIT" 아님. 번들된 부분 라이선스 전문을 반드시 동봉.

---

## 1. 모노레포 스캐폴드

여러 도구가 하나의 빌드 파이프라인을 공유할 거니까 처음부터 모노레포로.

### 1.1 디렉터리 구조

```
webp-tools/
├── build/                       # 공유 빌드 파이프라인
│   ├── Dockerfile
│   ├── build.sh                 # 컨테이너 안에서 실행
│   ├── build-docker.sh          # 호스트 오케스트레이터
│   ├── versions.env             # 핀 박은 업스트림 버전
│   └── versions.lock            # 빌드 산출물 SHA-256 (재현성 비교용)
├── packages/
│   └── gif2webp/
│       ├── src/index.ts
│       ├── wasm/                # 빌드 산출물 (커밋됨, 벤더링)
│       ├── licenses/            # 업스트림 라이선스 전문 (빌드가 채움)
│       ├── tsconfig.json
│       ├── tsdown.config.js
│       ├── package.json
│       ├── LICENSE
│       ├── README.md
│       └── THIRD_PARTY_LICENSES.md
├── scripts/
│   └── smoke.mjs                # E2E 검증
├── docs/
├── pnpm-workspace.yaml
├── package.json                 # 루트, private
├── LICENSE
├── README.md
└── CLAUDE.md
```

### 1.2 루트 `package.json`

```json
{
  "name": "webp-tools",
  "version": "0.0.0",
  "private": true,
  "description": "WASM builds of libwebp tools that browsers can't do natively.",
  "license": "MIT",
  "packageManager": "pnpm@11.3.0",
  "engines": { "node": ">=18" },
  "scripts": {
    "build:wasm": "bash build/build-docker.sh",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "smoke": "node scripts/smoke.mjs"
  },
  "devDependencies": {
    "tsdown": "^0.22.0",
    "typescript": "^6.0.3"
  }
}
```

**`private: true` 필수** — 루트는 절대 npm에 올라가지 않음. 배포는 워크스페이스 패키지만.

### 1.3 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"

# pnpm 10+에서 install-time 빌드 스크립트는 명시적 허용 필요.
# esbuild는 tsdown -> unrun -> bundle-require 체인이 TS/JS config 로드용으로 사용.
allowBuilds:
  esbuild: true
```

### 1.4 `.gitignore`

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store

# 단, wasm/ 와 licenses/ 는 의도적으로 커밋 (벤더링)
```

### 1.5 첫 install

```sh
pnpm install
```

`Ignored build scripts: esbuild` 에러 나오면 `allowBuilds`가 안 먹은 것. 위 yaml 형식 확인.

---

## 2. WASM 빌드 파이프라인

핵심 결정: **Docker로 emscripten 환경 격리.** "오늘의 나, 내년의 나, CI"가 모두 같은
바이트를 뽑게 한다.

### 2.1 `build/versions.env`

```bash
# 재현 가능한 WASM 빌드를 위한 핀 박은 버전.
EMSDK_VERSION=3.1.74
LIBWEBP_VERSION=1.6.0
GIFLIB_VERSION=5.2.2
```

업스트림 버전 올릴 땐 이 파일만 수정 → 재빌드 → 새 SHA 기록 → 패키지 semver 올림.

### 2.2 `build/Dockerfile`

```dockerfile
ARG EMSDK_VERSION=3.1.74
# emsdk 3.1.74 태그는 amd64 single-arch. 산출물은 아키텍처 독립이라 어디서 빌드해도
# 같은 바이트가 나옴. Apple Silicon에선 Rosetta로 약간 느릴 뿐.
ARG BUILD_PLATFORM=linux/amd64
FROM --platform=${BUILD_PLATFORM} emscripten/emsdk:${EMSDK_VERSION} AS builder

ARG LIBWEBP_VERSION=1.6.0
ARG GIFLIB_VERSION=5.2.2
ENV LIBWEBP_VERSION=${LIBWEBP_VERSION} \
    GIFLIB_VERSION=${GIFLIB_VERSION}

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
COPY build.sh /work/build.sh
RUN chmod +x /work/build.sh && /work/build.sh

# 추출 전용 스테이지. scratch 베이스라 산출물 외엔 아무것도 없어서
# `docker build --output type=local`이 호스트에 깔끔한 폴더를 떨군다.
FROM scratch AS export
COPY --from=builder /out/ /
```

### 2.3 `build/build.sh` (컨테이너 안에서 실행)

핵심 패턴:
1. 의존성 라이브러리(giflib)를 emcc로 `.a` 정적 아카이브로
2. 메인 라이브러리(libwebp)는 emcmake로 빌드, 필요한 도구 하나만 ON
3. 링커 플래그로 ES 모듈 + 가상 FS + callMain 노출

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${LIBWEBP_VERSION:?}"
: "${GIFLIB_VERSION:?}"

SRC=/work/src
OUT=/out
GIF_PREFIX=/work/giflib-install
mkdir -p "$SRC" "$OUT" "$GIF_PREFIX/include" "$GIF_PREFIX/lib"
cd "$SRC"

# 1) giflib -> libgif.a
curl -fsSL -o giflib.tar.gz \
  "https://downloads.sourceforge.net/giflib/giflib-${GIFLIB_VERSION}.tar.gz"
tar xf giflib.tar.gz
cd "giflib-${GIFLIB_VERSION}"

GIF_SRCS="dgif_lib.c egif_lib.c gifalloc.c gif_err.c gif_hash.c openbsd-reallocarray.c quantize.c"
emcc -O3 -I. -c ${GIF_SRCS}
emar rcs libgif.a ./*.o
cp gif_lib.h "$GIF_PREFIX/include/"
cp libgif.a  "$GIF_PREFIX/lib/"
cp COPYING "$OUT/giflib-LICENSE.txt"
cd "$SRC"

# 2) libwebp + gif2webp
curl -fsSL -o libwebp.tar.gz \
  "https://github.com/webmproject/libwebp/archive/refs/tags/v${LIBWEBP_VERSION}.tar.gz"
tar xf libwebp.tar.gz
cd "libwebp-${LIBWEBP_VERSION}"
cp COPYING "$OUT/libwebp-LICENSE.txt"

# 핵심: gif2webp 실행물에 적용될 링커 플래그.
# - MODULARIZE + EXPORT_ES6 -> .mjs ES 모듈
# - callMain + FS 노출 + INVOKE_RUN=0 -> JS에서 가상 FS로 구동
# - ENVIRONMENT=web,worker,node -> 브라우저 + Worker + Node 모두 지원
EM_LINK="-O3 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=Gif2Webp \
  -sEXPORTED_RUNTIME_METHODS=callMain,FS \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFORCE_FILESYSTEM=1 \
  -sENVIRONMENT=web,worker,node"

emcmake cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWEBP_BUILD_GIF2WEBP=ON \
  -DWEBP_BUILD_CWEBP=OFF \
  -DWEBP_BUILD_DWEBP=OFF \
  -DWEBP_BUILD_IMG2WEBP=OFF \
  -DWEBP_BUILD_VWEBP=OFF \
  -DWEBP_BUILD_WEBPINFO=OFF \
  -DWEBP_BUILD_WEBPMUX=OFF \
  -DWEBP_BUILD_ANIM_UTILS=OFF \
  -DWEBP_BUILD_EXTRAS=OFF \
  -DWEBP_BUILD_WEBP_JS=OFF \
  -DGIF_INCLUDE_DIR="$GIF_PREFIX/include" \
  -DGIF_LIBRARY="$GIF_PREFIX/lib/libgif.a" \
  -DCMAKE_EXE_LINKER_FLAGS="$EM_LINK"

emmake cmake --build build --target gif2webp -j"$(nproc)"

JS=$(find build -name 'gif2webp.js' -print -quit)
WASM=$(find build -name 'gif2webp.wasm' -print -quit)
cp "$JS"   "$OUT/gif2webp.mjs"   # EXPORT_ES6 출력은 .mjs로 배포
cp "$WASM" "$OUT/gif2webp.wasm"

sha256sum "$OUT/gif2webp.wasm" "$OUT/gif2webp.mjs"
```

### 2.4 `build/build-docker.sh` (호스트에서 실행)

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

set -a; . ./versions.env; set +a

OUT_DIR="../packages/gif2webp/wasm"
LIC_DIR="../packages/gif2webp/licenses"
mkdir -p "$OUT_DIR" "$LIC_DIR"

DOCKER_BUILDKIT=1 docker build \
  --build-arg EMSDK_VERSION="$EMSDK_VERSION" \
  --build-arg LIBWEBP_VERSION="$LIBWEBP_VERSION" \
  --build-arg GIFLIB_VERSION="$GIFLIB_VERSION" \
  --target export \
  --output "type=local,dest=$OUT_DIR" \
  -f Dockerfile .

mv -f "$OUT_DIR"/libwebp-LICENSE.txt "$LIC_DIR"/ 2>/dev/null || true
mv -f "$OUT_DIR"/giflib-LICENSE.txt  "$LIC_DIR"/ 2>/dev/null || true
```

### 2.5 첫 빌드

Docker Desktop (또는 Colima) 실행 후:

```sh
pnpm build:wasm
```

첫 실행은 emsdk 이미지 받느라 ~5분. 이후 캐시 적중으로 ~2분.

성공 시 마지막 줄에 SHA-256 두 개가 찍힘 — 다음 단계에서 lockfile에 기록.

### 2.6 `build/versions.lock` (재현성 비교 기준)

```
[gif2webp @ emsdk=3.1.74 libwebp=1.6.0 giflib=5.2.2 platform=linux/amd64 env=web,worker,node]
gif2webp.wasm = <빌드가 출력한 SHA-256>
gif2webp.mjs  = <빌드가 출력한 SHA-256>
```

재빌드 후 값이 다르면 (a) 업스트림 태르볼 변경 (b) 빌드 환경 비결정성 (c) 의도된 변경.
의도된 변경이면 lock도 같이 갱신.

---

## 3. 타입 래퍼 (`packages/gif2webp/src/index.ts`)

emit된 wasm/glue를 그대로 노출하지 말고 얇은 타입 래퍼로 감싸 DX를 챙긴다.

### 3.1 패턴 설명

핵심 4가지:

1. **lazy load** — wasm 모듈은 첫 호출 때만 import (소비자 메인 번들 부풀지 않게)
2. **가상 FS로 구동** — `FS.writeFile('input.gif', ...)` → `callMain([...args])` → `FS.readFile('output.webp')`
3. **mutex로 직렬화** — 가상 FS와 callMain 글로벌 상태가 단일 인스턴스 공유. 동시 호출이 서로의 입출력 덮어씀 → `Promise.all` 같은 batch에서 깨짐.
4. **ExitStatus 예외 처리** — `EXIT_RUNTIME=0`이면 성공 시에도 ExitStatus throw 가능

### 3.2 전체 코드

```ts
export interface Gif2WebpOptions {
  quality?: number;
  method?: number;
  mixed?: boolean;
  lossy?: boolean;
  lossless?: boolean;
  minimizeSize?: boolean;
  metadata?: "all" | "none" | "icc" | "xmp";
  multiThreaded?: boolean;
  loopCount?: number;
  extraArgs?: string[];
}

const INPUT = "input.gif";
const OUTPUT = "output.webp";

function toArgs(opts: Gif2WebpOptions): string[] {
  const a: string[] = [];
  if (opts.mixed) a.push("-mixed");
  if (opts.lossy) a.push("-lossy");
  if (opts.lossless) a.push("-lossless");
  if (opts.minimizeSize) a.push("-min_size");
  if (opts.multiThreaded) a.push("-mt");
  if (opts.quality != null) a.push("-q", String(opts.quality));
  if (opts.method != null) a.push("-m", String(opts.method));
  if (opts.metadata != null) a.push("-metadata", opts.metadata);
  if (opts.loopCount != null) a.push("-loop_count", String(opts.loopCount));
  if (opts.extraArgs?.length) a.push(...opts.extraArgs);
  a.push(INPUT, "-o", OUTPUT);
  return a;
}

type EmscriptenModule = {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
};

let modulePromise: Promise<EmscriptenModule> | null = null;

async function getModule(): Promise<EmscriptenModule> {
  if (!modulePromise) {
    // @ts-expect-error - 빌드가 emit, 타입 없음
    const factory = (await import("../wasm/gif2webp.mjs")).default;
    modulePromise = factory() as Promise<EmscriptenModule>;
  }
  return modulePromise;
}

// 호출 직렬화 큐. wasm 모듈 단일 인스턴스 + 가상 FS 공유 때문에 동시 호출이
// 서로의 input.gif/output.webp를 덮어쓸 수 있음. wasm은 단일 스레드라 직렬화해도
// 처리량 손실 없음.
let queue: Promise<unknown> = Promise.resolve();

export async function gif2webp(
  input: Uint8Array,
  options: Gif2WebpOptions = { quality: 75 },
): Promise<Uint8Array> {
  const prev = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => (release = r));
  await prev.catch(() => {});  // 앞 호출 실패해도 큐는 흘러야 함
  try {
    const mod = await getModule();
    mod.FS.writeFile(INPUT, input);
    try {
      mod.callMain(toArgs(options));
    } catch (err: unknown) {
      const status = (err as { name?: string; status?: number } | null);
      if (!(status && status.name === "ExitStatus" && status.status === 0)) {
        throw err;
      }
    }
    const out = mod.FS.readFile(OUTPUT);
    try { mod.FS.unlink(INPUT); } catch {}
    try { mod.FS.unlink(OUTPUT); } catch {}
    return out;
  } finally {
    release();
  }
}

export default gif2webp;
```

---

## 4. tsdown 빌드 + TypeScript 설정

### 4.1 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowJs": false,
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "wasm"]
}
```

- `Bundler` resolution — tsdown(Rolldown)에 친화적
- `noEmit: true` — 타입체크만, dts와 sourcemap은 tsdown이 직접 생성
- `wasm/` exclude — emit된 glue를 TS가 분석하지 않도록

### 4.2 `tsdown.config.js`

`.ts` 대신 `.js`로 작성 — tsdown 0.22.0이 TS config 로드에 필요한 `unrun`의 hoist 이슈를
회피.

```js
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  clean: true,
  // emscripten glue(.mjs)와 바이너리(.wasm)는 wasm/에서 그대로 배포.
  // 번들에 인라인하지 말고 외부 참조로 둠.
  deps: {
    neverBundle: [/\.mjs$/, /\.wasm$/],
  },
});
```

### 4.3 빌드 실행

```sh
pnpm -r build
```

산출물:
- `dist/index.mjs` + `index.mjs.map`
- `dist/index.d.mts` + `index.d.mts.map`

---

## 5. 스모크 테스트 (`scripts/smoke.mjs`)

happy path 검증. 정식 단위 테스트 시스템(Vitest 등) 도입은 over-engineering — 빌드 산출물이
정말로 입력 → 출력을 해내는지만 확인하면 충분.

```js
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gif2webp } from "../packages/gif2webp/dist/index.mjs";

// 직접 인코딩한 최소 2프레임 1x1 애니메이션 GIF89a (85 바이트)
const EMBEDDED_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF,
  0x21, 0xFF, 0x0B,
  0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
  0x03, 0x01, 0x00, 0x00, 0x00,
  0x21, 0xF9, 0x04, 0x04, 0x0A, 0x00, 0x00, 0x00,
  0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0x02, 0x02, 0x44, 0x01, 0x00,
  0x21, 0xF9, 0x04, 0x04, 0x0A, 0x00, 0x00, 0x00,
  0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0x02, 0x02, 0x4C, 0x01, 0x00,
  0x3B,
]);

function findChunks(webp, fourcc) {
  const target = new TextEncoder().encode(fourcc);
  let count = 0;
  outer: for (let i = 0; i <= webp.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (webp[i + j] !== target[j]) continue outer;
    }
    count++;
  }
  return count;
}

const argPath = process.argv[2];
const input = argPath
  ? new Uint8Array(await readFile(resolve(argPath)))
  : EMBEDDED_GIF;

const out = await gif2webp(input, { quality: 75 });

const head = new TextDecoder("ascii").decode(out.subarray(0, 4));
const fmt = new TextDecoder("ascii").decode(out.subarray(8, 12));
if (head !== "RIFF" || fmt !== "WEBP") throw new Error("magic 불일치");

if (findChunks(out, "ANIM") !== 1) throw new Error("ANIM 청크 없음");
if (findChunks(out, "ANMF") < 2) throw new Error("프레임 부족");

console.log("PASS");
```

실행:

```sh
pnpm smoke
```

**Node에서 wasm 로드되려면** `build.sh`의 `ENVIRONMENT`에 `node`가 포함돼야 함
(`-sENVIRONMENT=web,worker,node`). 안 그러면 "fetch failed" 에러로 죽음.

---

## 6. 라이선스 + 패키지 메타데이터

### 6.1 `packages/gif2webp/LICENSE`

루트 LICENSE 복사. `files`에 선언했는데 파일 없으면 npm publish 시 누락 + MIT 의무 위반.

```sh
cp LICENSE packages/gif2webp/LICENSE
```

### 6.2 `packages/gif2webp/THIRD_PARTY_LICENSES.md`

```markdown
# 서드파티 라이선스

이 패키지는 아래 오픈소스로부터 빌드한 WASM(`wasm/gif2webp.wasm`)을 배포합니다.

| 구성요소 | 라이선스 | 업스트림 |
|----------|----------|----------|
| libwebp  | BSD-3-Clause | https://chromium.googlesource.com/webm/libwebp |
| giflib   | MIT          | https://giflib.sourceforge.net/ |

- `licenses/libwebp-LICENSE.txt` — libwebp `COPYING`
- `licenses/giflib-LICENSE.txt` — giflib `COPYING`

이 파일들은 `build/build.sh`가 자동으로 채웁니다.
```

### 6.3 `packages/gif2webp/package.json`

```json
{
  "name": "@btheegg-kimth/gif2webp",
  "version": "0.0.1",
  "description": "Animated GIF -> animated WebP in the browser, via libwebp gif2webp compiled to WASM.",
  "license": "MIT",
  "author": "btheegg-kimth",
  "repository": {
    "type": "git",
    "url": "https://github.com/<owner>/webp-tools.git",
    "directory": "packages/gif2webp"
  },
  "homepage": "https://github.com/<owner>/webp-tools/tree/main/packages/gif2webp",
  "bugs": "https://github.com/<owner>/webp-tools/issues",
  "keywords": ["webp", "gif", "gif2webp", "libwebp", "wasm", "animation", "browser"],
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.mjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.mts",
  "exports": {
    ".": {
      "types": "./dist/index.d.mts",
      "import": "./dist/index.mjs"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "wasm",
    "licenses",
    "LICENSE",
    "README.md",
    "THIRD_PARTY_LICENSES.md"
  ],
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc --noEmit"
  },
  "publishConfig": {
    "access": "public"
  },
  "devDependencies": {
    "tsdown": "^0.22.0",
    "typescript": "^6.0.3",
    "unrun": "^0.3.0"
  }
}
```

**핵심 필드:**
- `publishConfig.access: "public"` — scoped 패키지는 기본 private. 이게 없으면 publish 실패.
- `sideEffects: false` — 트리쉐이킹 가능 표시
- `type: "module"` — 순수 ESM 패키지
- `files` — 배포될 파일 화이트리스트. `dist` + `wasm` + `licenses` + 라이선스 문서들
- `exports` — modern Node/번들러용 진입점. `main`/`module`/`types`도 함께 두면 구버전 도구 호환

---

## 7. npm 배포 (사람만 가능)

### 7.1 사전 준비 (1회성)

1. **npmjs.com에서 무료 org 생성** — `btheegg-kimth` (또는 원하는 이름)
2. **2FA 활성화** — Account Settings → Two-Factor Authentication
3. **GitHub repo 생성/푸시** — `repository.url` 매칭

### 7.2 publish

```sh
npm login                          # 대화형 2FA
cd packages/gif2webp
npm publish                        # publishConfig.access=public 자동 적용
```

성공하면 `npmjs.com/package/@btheegg-kimth/gif2webp`에서 확인 가능.

### 7.3 버전 올리기 (이후)

```sh
# 1. 코드 수정
# 2. wasm 재빌드가 필요하면:
#    - build/versions.env 갱신
#    - pnpm build:wasm
#    - build/versions.lock SHA 갱신
# 3. 패키지 package.json version 올림 (semver)
# 4. pnpm -r build && pnpm smoke
# 5. cd packages/gif2webp && npm publish
```

---

## 8. 흔한 함정

이번 세션에서 실제로 부딪힌 것들. 시간 절약용.

### 8.1 pnpm 11의 빌드 스크립트 거부

**증상:**
```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.7
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

**원인:** pnpm 10+는 공급망 공격 방지를 위해 `postinstall` 스크립트를 기본 차단.

**해결:** `pnpm-workspace.yaml`에 `allowBuilds.<pkg>: true`. `pnpm` 필드 in `package.json`은
**더 이상 안 읽힘** — 워닝 없이 무시되므로 yaml로 옮길 것.

```yaml
allowBuilds:
  esbuild: true
```

설정 후에도 `Already up to date` 경로면 빌드 스크립트 재평가 안 됨 →
`rm -rf node_modules && pnpm install`로 강제.

**`pnpm approve-builds` 인터랙티브 함정:** 스페이스로 선택 안 하고 Enter만 누르면 모두
`false`로 박힘 (= 거부). 다시 돌려서 스페이스로 선택해야 함.

### 8.2 giflib SourceForge URL 404

**증상:**
```
curl: (22) The requested URL returned error: 404
```

**원인:** `downloads.sourceforge.net/project/giflib/...` 경로가 404.

**해결:** `project/` 빼고 `downloads.sourceforge.net/giflib/giflib-X.Y.Z.tar.gz`. SourceForge가
알아서 `giflib-5.x/` 서브디렉터리로 리다이렉트.

### 8.3 emscripten ENVIRONMENT 누락 → Node에서 동작 안 함

**증상:** Node로 스모크 돌리면 `both async and sync fetching of the wasm failed`.

**원인:** `-sENVIRONMENT=web,worker`는 Node 로더 코드를 생략. emit된 glue가 fetch만 알고
파일시스템 read 모름.

**해결:** `node` 추가 (`-sENVIRONMENT=web,worker,node`). `.wasm` 바이트는 안 바뀌고
`.mjs` glue에만 ~2KB 추가됨.

### 8.4 tsup의 TS 6.0 호환성 (tsdown은 해결됨)

**증상 (tsup 사용 시):**
```
error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0.
```

**원인:** tsup의 dts 워커가 내부적으로 `baseUrl`을 세팅. TS 6.0이 이를 에러로 격상.

**해결:**
- tsup 유지: `tsconfig.json`에 `"ignoreDeprecations": "6.0"` 추가
- **tsdown으로 마이그레이션 권장** (tsup 메인테이너 본인이 권장): dts 파이프라인이 달라 이슈
  없음. tsup → tsdown은 거의 1:1 매핑이지만 `external` → `deps.neverBundle`로 변경 필요.

### 8.5 tsdown 0.22의 `unrun` 미해결

**증상:**
```
ERROR Error: Failed to import module "unrun". Please ensure it is installed.
```

**원인:** tsdown이 동적으로 import하는 `unrun`이 pnpm strict isolation에서 hoist 안 됨.

**해결:** 패키지 devDeps에 `unrun` 명시 추가.

### 8.6 Docker Desktop "Subscription" 동의

큰 회사(직원 250+ 또는 매출 $10M+) 상업적 사용은 유료. 작은 회사/개인은 무료.
큰 회사면 **Colima**로 대체 (오픈소스, CLI):

```sh
brew install colima docker
colima start
```

`build-docker.sh`는 그대로 동작.

### 8.7 동시 호출 시 출력 손상

**증상:** `Promise.all([gif2webp(a), gif2webp(b)])`로 동시 호출하면 일부 출력이 잘리거나
잘못된 길이로 반환됨.

**원인:** wasm 단일 인스턴스 + 가상 FS의 고정 파일명(`input.gif`/`output.webp`) 공유. 두
호출이 서로의 파일을 덮어씀.

**해결:** 래퍼에서 호출 직렬화 mutex (위 [3.2](#32-전체-코드) 참고). wasm은 단일
스레드라 직렬화해도 처리량 손실 없음.

### 8.8 npm publish 시 LICENSE 누락

**증상:** publish 자체는 통과하지만 패키지에 LICENSE가 없음. MIT 라이선스 의무 위반.

**원인:** `files: ["LICENSE"]`로 선언했지만 패키지 디렉터리에 LICENSE 파일 자체가 없음
(루트에만 있음).

**해결:** 루트 LICENSE를 패키지 디렉터리에 복사. CI에서 자동 복사하거나 git에 커밋.

---

## 부록: 추가 패키지 추가는?

다음 도구(`img2webp`, `webpmux` 등)는 빌드 파이프라인을 공유하므로 훨씬 빠르게 추가됨.
**[02-add-package-to-org.md](./02-add-package-to-org.md) 참고.**

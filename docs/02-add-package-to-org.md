# org에 새 패키지 추가하기

webp-tools 모노레포에 두 번째 이후 패키지(예: `@btheegg-kimth/img2webp`)를 추가하는
빠른 워크플로. 첫 패키지부터 만드는 흐름은
[`01-create-npm-library.md`](./01-create-npm-library.md) 참고.

이 가이드는 **기존 인프라(빌드 파이프라인, allowBuilds, mutex 패턴 등)를 재사용**한다고
가정한다. 인프라가 이미 있으니 새 패키지는 거의 복사-수정으로 끝남.

---

## 0. 추가 전 체크리스트

**진짜로 필요한가?** CLAUDE.md 결정 #1, #3 따라 YAGNI 적용:

- 브라우저/Node 표준이 이미 하는 일은 ❌
- 실 사용 케이스가 막 생긴 게 아니면 ❌ ("미리 만들어 두자"는 안 함)
- 기존 도구로 우회 가능하면 ❌

**기존 파이프라인을 그대로 쓸 수 있나?**

- 같은 emsdk + libwebp만 필요 → ✅ 매우 빠름 (이 가이드 그대로)
- 새 업스트림 의존성 필요 (예: libavif) → `versions.env`에 추가, `build.sh`에 빌드 단계
  추가, 라이선스 항목 추가
- emsdk 버전을 바꿔야 함 → 기존 패키지 전부 영향. 전체 재빌드 + 모든 SHA 갱신 필요.
  업스트림 버전 핀 충돌이 없는지 먼저 확인.

---

## 1. 디렉터리 복사

**가장 빠른 시작:** gif2webp 통째로 복사 후 이름만 갈아끼우기.

```sh
cp -r packages/gif2webp packages/<new-tool>
cd packages/<new-tool>
rm -rf wasm/* licenses/* dist/ node_modules/
```

빈 디렉터리만 남기고 빌드가 다시 채우게 둠.

---

## 2. 메타데이터 수정

### 2.1 `package.json`

다음 필드들 갱신:

```json
{
  "name": "@btheegg-kimth/<new-tool>",
  "version": "0.0.1",
  "description": "...",
  "keywords": ["webp", "<new-tool>", "libwebp", "wasm", "browser"],
  "repository": {
    "type": "git",
    "url": "https://github.com/<owner>/webp-tools.git",
    "directory": "packages/<new-tool>"
  },
  "homepage": "https://github.com/<owner>/webp-tools/tree/main/packages/<new-tool>",
  ...
}
```

**바꾸지 말 것 (이미 검증된 조합):**
- `publishConfig.access: "public"`
- `type: "module"`, `sideEffects: false`
- `main`/`module`/`types`/`exports`의 `.mjs`/`.d.mts` 경로
- `files` 화이트리스트 (dist, wasm, licenses, LICENSE 등)
- devDependencies (`tsdown`, `typescript`, `unrun` 버전)

### 2.2 `README.md`

이름, 옵션 표, 예제 갱신.

### 2.3 `THIRD_PARTY_LICENSES.md`

새 도구가 의존하는 업스트림 라이브러리에 따라:

- libwebp만 쓰는 도구 → libwebp만 명시
- 추가 의존성 있으면 (예: img2webp는 일반적으로 libwebp만 필요) 표에 추가

### 2.4 `LICENSE`

루트에서 복사 (반복):

```sh
cp ../../LICENSE LICENSE
```

또는 CI에서 자동화.

---

## 3. 빌드 파이프라인 통합

### 3.1 `build/build.sh` 수정

CMake 플래그에서 새 도구만 ON:

```bash
emcmake cmake -B build -S . \
  ...
  -DWEBP_BUILD_GIF2WEBP=OFF \
  -DWEBP_BUILD_<NEW_TOOL>=ON \
  ...
```

빌드 타겟 변경:

```bash
emmake cmake --build build --target <new_tool> -j"$(nproc)"
```

출력 파일 복사:

```bash
JS=$(find build -name '<new_tool>.js' -print -quit)
WASM=$(find build -name '<new_tool>.wasm' -print -quit)
cp "$JS"   "$OUT/<new_tool>.mjs"
cp "$WASM" "$OUT/<new_tool>.wasm"
```

링커 플래그의 `-sEXPORT_NAME=Gif2Webp`도 새 이름으로 바꿔야 함 (예: `-sEXPORT_NAME=Img2Webp`).

**검토 포인트:** gif2webp와 *동시에* 빌드해야 하나, 아니면 도구 하나씩 별도 빌드?
- 동시 빌드: build.sh 한 번 실행으로 둘 다 산출 → 빠르지만 스크립트 복잡
- 별도 빌드: 도구별 build script 분리 → 단순하지만 emsdk 이미지 두 번 도는 식 비효율

권장: **별도 build script + 공통 헬퍼 분리.** 예:
```
build/
├── build-common.sh      # giflib + libwebp 빌드 (도구 무관)
├── build-gif2webp.sh    # build-common.sh source + gif2webp만 링크
├── build-img2webp.sh    # build-common.sh source + img2webp만 링크
└── build-docker.sh      # 호스트, 어떤 도구 빌드할지 인자로 받음
```

처음 두 번째 도구 추가할 때 이 분리 작업을 같이 하는 게 자연스럽다.

### 3.2 `build/build-docker.sh` 수정

새 도구의 출력/라이선스 디렉터리 추가:

```bash
OUT_DIR="../packages/<new-tool>/wasm"
LIC_DIR="../packages/<new-tool>/licenses"
```

또는 도구 인자를 받는 형태로 일반화.

### 3.3 `build/versions.env`

기존 핀 박은 버전을 새 도구도 그대로 사용하면 변경 없음. 새 업스트림(예: `libavif`)이
필요하면 추가:

```bash
LIBAVIF_VERSION=1.0.0
```

### 3.4 `build/versions.lock`

새 도구 빌드 후 SHA 항목 추가:

```
[gif2webp @ emsdk=3.1.74 libwebp=1.6.0 giflib=5.2.2 platform=linux/amd64 env=web,worker,node]
gif2webp.wasm = ...
gif2webp.mjs  = ...

[<new-tool> @ emsdk=3.1.74 libwebp=1.6.0 platform=linux/amd64 env=web,worker,node]
<new_tool>.wasm = <빌드가 출력>
<new_tool>.mjs  = <빌드가 출력>
```

---

## 4. 래퍼 작성

### 4.1 `src/index.ts`

gif2webp의 wrapper를 템플릿으로:

```ts
export interface <NewTool>Options {
  // 옵션들
}

const INPUT = "input.<ext>";
const OUTPUT = "output.webp";

function toArgs(opts: <NewTool>Options): string[] {
  // CLI 플래그 매핑
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
    const factory = (await import("../wasm/<new_tool>.mjs")).default;
    modulePromise = factory() as Promise<EmscriptenModule>;
  }
  return modulePromise;
}

// 동시 호출 직렬화. 가상 FS + callMain 공유 상태 때문에 필수.
let queue: Promise<unknown> = Promise.resolve();

export async function <newTool>(
  input: Uint8Array,
  options: <NewTool>Options = {},
): Promise<Uint8Array> {
  const prev = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => (release = r));
  await prev.catch(() => {});
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

export default <newTool>;
```

**여러 입력 파일이 필요한 도구 (예: img2webp는 N개 프레임):**

```ts
// 입력 N개를 가상 FS에 frame-0.png, frame-1.png... 로 쓰기
inputs.forEach((bytes, i) => mod.FS.writeFile(`frame-${i}.png`, bytes));
const args = [...flags, ...inputs.map((_, i) => `frame-${i}.png`), "-o", OUTPUT];
mod.callMain(args);
// 끝나면 모두 unlink
```

mutex 패턴은 동일하게 적용 — 여러 호출이 겹치면 frame-N.png가 충돌.

### 4.2 `tsconfig.json` / `tsdown.config.js`

복사한 그대로 두면 됨. 변경 없음.

---

## 5. 스모크 테스트

`scripts/smoke.mjs`를 도구별로 분기하거나 별도 파일 만들기.

**옵션 A — 단일 파일에서 인자로 분기:**

```sh
node scripts/smoke.mjs gif2webp
node scripts/smoke.mjs <new-tool>
```

**옵션 B — 도구별 파일:**

```
scripts/
├── smoke-gif2webp.mjs
└── smoke-<new-tool>.mjs
```

루트 `package.json`에 스크립트 추가:

```json
"scripts": {
  "smoke": "node scripts/smoke-gif2webp.mjs && node scripts/smoke-<new-tool>.mjs"
}
```

**fixture 만들기:** 가능하면 하드코딩된 최소 binary로 (외부 다운로드/큰 파일 의존 피함).
GIF는 직접 인코딩 가능 (gif2webp 사례). PNG/JPEG 같은 형식은 라이브러리 없이 손으로 짜기
힘드므로 base64 임베드 또는 commit 한 작은 fixture.

---

## 6. 빌드 + 검증

```sh
pnpm install              # 새 패키지가 워크스페이스로 잡힘
pnpm build:wasm           # 새 wasm 빌드 (도구 인자 필요할 수 있음)
pnpm -r build             # tsdown으로 모든 패키지 dist 생성
pnpm typecheck            # 전체 타입체크
pnpm smoke                # 스모크 (위 옵션 A/B 따라)
```

검증 포인트:
- 새 패키지의 `wasm/`, `dist/` 모두 생성됨
- 새 wasm SHA가 `versions.lock`과 일치 (첫 빌드면 lock에 추가)
- 새 라이선스 파일이 `licenses/`에 들어옴
- 스모크가 magic + 형식 검증 통과

---

## 7. publish

```sh
cd packages/<new-tool>
npm publish
```

`publishConfig.access: "public"`이 있으면 자동으로 public scope 처리.

org 멤버십이 있어야 publish 권한 있음 (org 생성 시 본인이 자동 owner).

---

## 부록 A: 빠른 체크리스트 (복사용)

```
[ ] 정말 필요한가? (YAGNI)
[ ] 기존 파이프라인으로 빌드되나? (또는 새 의존성 필요?)
[ ] cp -r packages/gif2webp packages/<new-tool>
[ ] rm -rf wasm/* licenses/* dist/ node_modules/
[ ] package.json: name, description, keywords, repository.directory, homepage
[ ] README.md 갱신
[ ] THIRD_PARTY_LICENSES.md 갱신
[ ] LICENSE 복사
[ ] build.sh: CMake 플래그 + 타겟 + 출력 복사 (도구별 분리 권장)
[ ] build-docker.sh: 출력 디렉터리 (또는 일반화)
[ ] src/index.ts: 옵션 인터페이스, toArgs, 래퍼 함수명, wasm import 경로
[ ] scripts/smoke 분기 또는 신규
[ ] pnpm install && pnpm build:wasm && pnpm -r build && pnpm smoke
[ ] versions.lock에 새 도구 SHA 항목 추가
[ ] git commit
[ ] cd packages/<new-tool> && npm publish
```

## 부록 B: 이미 검증된 조합 (바꾸지 말 것)

새 패키지에서도 그대로 가져가면 함정을 피할 수 있는 설정들:

| 항목 | 값 | 이유 |
|---|---|---|
| `ENVIRONMENT` | `web,worker,node` | Node 스모크 + 미래 SSR 지원 |
| 가상 FS 파일명 | 고정 (`input.X`/`output.X`) + mutex로 보호 | 호출당 unique name보다 단순. wasm은 단일 스레드라 직렬화 무손실 |
| `INVOKE_RUN` | `0` | JS 래퍼가 명시적으로 callMain 호출 |
| `EXIT_RUNTIME` | `0` | 모듈 재사용 가능 |
| `ALLOW_MEMORY_GROWTH` | `1` | 큰 입력 안전 |
| `FORCE_FILESYSTEM` | `1` | FS 노출 강제 |
| `MODULARIZE` + `EXPORT_ES6` | `1` | `.mjs` ES 모듈 형태 |
| tsdown `deps.neverBundle` | `[/\.mjs$/, /\.wasm$/]` | wasm/glue 번들 인라인 방지 |
| `publishConfig.access` | `"public"` | scoped 기본 private 우회 |
| `type` | `"module"` | 순수 ESM |
| `sideEffects` | `false` | 트리쉐이킹 |

## 부록 C: 같이 손볼 가능성 있는 것들

새 패키지 추가하면서 같이 발견될 수 있는 인프라 개선:

- **build.sh 도구 인자화** — 두 번째 도구 추가 시점이 적기. `build-common.sh` + 도구별 빌드
  스크립트로 리팩터.
- **CI 추가** — 두 패키지가 되면 수동 빌드 부담↑. GitHub Actions로 wasm 빌드 + smoke 자동화.
- **공통 wrapper 헬퍼 추출** — mutex/getModule 패턴이 도구마다 중복. 셋째 도구쯤 되면 공통
  헬퍼 패키지(`packages/_wasm-runtime` 같은) 추출 검토. **세 번째 등장하기 전까지는 YAGNI.**
- **루트 README 도구 표 갱신** — 새 도구를 "예정" → "released"로 옮김.
- **CLAUDE.md 결정 #1의 우선순위 목록 갱신** — 다음 도구의 위치 명시.

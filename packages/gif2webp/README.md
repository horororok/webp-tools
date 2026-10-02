# @btheegg-kimth/gif2webp

**애니메이션 GIF → 애니메이션 WebP**, 브라우저에서, libwebp를 WASM으로 컴파일해 수행.

이건 브라우저가 *못 하는* 유일한 WebP 변환입니다 — `<canvas>`는 GIF의 첫 프레임만
그려서 애니메이션을 잃습니다. 정적 JPG/PNG → WebP는 이미
`canvas.toBlob('image/webp')`가 처리하니, 그 용도로는 이 패키지가 필요 없습니다.

## 설치

```sh
pnpm add @btheegg-kimth/gif2webp
```

## 사용법

```ts
import { gif2webp } from "@btheegg-kimth/gif2webp";

const gifBytes = new Uint8Array(await file.arrayBuffer());
const webpBytes = await gif2webp(gifBytes, { mixed: true, quality: 75 });

// 해상도 상한을 걸고 싶다면 (긴 변 1920, 작은 GIF는 그대로)
const capped = await gif2webp(gifBytes, {
  mixed: true,
  quality: 75,
  resize: { width: 1920, height: 1920 },
});

const blob = new Blob([webpBytes], { type: "image/webp" });
// ...presigned URL로 S3에 업로드 등
```

### 옵션

`gif2webp` CLI 플래그에 매핑. 아무 옵션도 안 주면 `{ quality: 75 }`, 인코딩은 gif2webp
기본값인 lossless입니다.

| 옵션 | 플래그 | 비고 |
|------|--------|------|
| `quality` | `-q` | 0..100, 기본 75 |
| `method` | `-m` | 0..6, 높을수록 느리고 작음 |
| `mixed` | `-mixed` | 프레임별 lossy/lossless |
| `lossy` | `-lossy` | |
| `lossless` | — | 기본값이라 플래그 없음. `lossy`/`mixed`와 같이 주면 에러 |
| `minimizeSize` | `-min_size` | |
| `metadata` | `-metadata` | `all` \| `none` \| `icc` \| `xmp` |
| `loopCount` | `-loop_count` (패치) | 0 = 무한. 생략하면 GIF 값을 따름 |
| `resize` | `-resize` (패치) | 아래 참고 |
| `extraArgs` | — | 원시 전달 |

### 리사이즈

애니메이션을 유지한 채 캔버스 크기를 바꿉니다. 업스트림 gif2webp에는 없는 기능이라
`build/patches/gif2webp.patch`로 추가했습니다.

```ts
// 긴 변 1920 상한: 넘으면 비율 유지하며 축소, 작으면 그대로
await gif2webp(bytes, { lossy: true, quality: 75, resize: { width: 1920, height: 1920 } });

// 너비만 800 상한
await gif2webp(bytes, { lossy: true, resize: { width: 800 } });

// 정확히 640×640 (비율 무시, 확대 허용)
await gif2webp(bytes, { resize: { width: 640, height: 640, fit: "fill", withoutEnlargement: false } });
```

| 필드 | 기본 | 의미 |
|------|------|------|
| `width` / `height` | — | 목표 크기(px). 하나는 필수, 생략한 쪽은 비율 유지 |
| `fit` | `"inside"` | `"inside"`: 박스 안에 비율 유지 · `"fill"`: 정확히 width×height |
| `withoutEnlargement` | `true` | 어느 한 변이라도 커지게 되면 리사이즈하지 않음 |

#### 예시

`{ lossy: true, quality: 75, resize: { width: 640, height: 640 } }`

| 입력 GIF · 1280×720 · 596 KB | 출력 WebP · 640×360 · 177 KB |
|:---:|:---:|
| <img src="https://raw.githubusercontent.com/horororok/webp-tools/main/packages/gif2webp/docs/demo.gif" width="360" alt="입력 GIF 1280×720"> | <img src="https://raw.githubusercontent.com/horororok/webp-tools/main/packages/gif2webp/docs/demo-resized.webp" width="360" alt="출력 WebP 640×360"> |

20프레임 애니메이션이 그대로 유지됩니다. 같은 옵션에서 리사이즈만 빼면 1280×720,
503 KB입니다. 출력 이미지는 이 패키지의 wasm으로 브라우저(Chrome)에서 직접 변환한
결과입니다(`docs/` 폴더, npm 패키지에는 포함되지 않음).

> 축소하면 보간 때문에 GIF 팔레트에 없던 색이 생겨서, 기본 lossless 인코딩에서는
> 결과가 **오히려 커질 수 있습니다**. 리사이즈할 때는 `lossy: true` 또는
> `mixed: true`를 함께 쓰세요.

## 비고

- WASM은 단일 `.mjs`에 인라인돼 있으며(`SINGLE_FILE=1`), 첫 호출 때 lazy 로드됩
  니다. 업로드 경로에서만 `gif2webp`를 import하면 메인 번들이 부풀지 않습니다.
- **pthread 비활성** 빌드이므로 COOP/COEP 헤더, SharedArrayBuffer 등 추가 요구사
  항 없음 — Vite/Webpack/Next 등 일반 환경에서 그대로 동작.
- 호출은 내부 mutex로 직렬화 — `Promise.all`로 여러 GIF를 동시 변환해도 안전.
- libwebp(BSD-3-Clause) + giflib(MIT)로 빌드됨. `THIRD_PARTY_LICENSES.md` 참고.
- 래퍼 코드는 MIT.

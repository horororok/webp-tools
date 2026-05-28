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

const blob = new Blob([webpBytes], { type: "image/webp" });
// ...presigned URL로 S3에 업로드 등
```

### 옵션

`gif2webp` CLI 플래그에 매핑:

| 옵션 | 플래그 | 비고 |
|------|--------|------|
| `quality` | `-q` | 0..100, 기본 75 |
| `method` | `-m` | 0..6, 높을수록 느리고 작음 |
| `mixed` | `-mixed` | 프레임별 lossy/lossless |
| `lossy` / `lossless` | `-lossy` / `-lossless` | |
| `minimizeSize` | `-min_size` | |
| `metadata` | `-metadata` | `all` \| `none` \| `icc` \| `xmp` |
| `loopCount` | `-loop_count` | |
| `extraArgs` | — | 원시 전달 |

## 비고

- WASM은 단일 `.mjs`에 인라인돼 있으며(`SINGLE_FILE=1`), 첫 호출 때 lazy 로드됩
  니다. 업로드 경로에서만 `gif2webp`를 import하면 메인 번들이 부풀지 않습니다.
- **pthread 비활성** 빌드이므로 COOP/COEP 헤더, SharedArrayBuffer 등 추가 요구사
  항 없음 — Vite/Webpack/Next 등 일반 환경에서 그대로 동작.
- 호출은 내부 mutex로 직렬화 — `Promise.all`로 여러 GIF를 동시 변환해도 안전.
- libwebp(BSD-3-Clause) + giflib(MIT)로 빌드됨. `THIRD_PARTY_LICENSES.md` 참고.
- 래퍼 코드는 MIT.

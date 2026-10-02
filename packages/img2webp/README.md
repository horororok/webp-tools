# @btheegg-kimth/img2webp

**여러 장의 이미지(PNG·JPEG·WebP)를 한 개의 애니메이션 WebP로 묶습니다** —
브라우저에서, libwebp `img2webp`를 WASM으로 컴파일해 수행.

쉽게 말해 **"이미지 여러 장 → 움직이는 WebP 한 장"** 입니다. 프레임 시퀀스나
슬라이드쇼, 짧은 모션을 프레임마다 표시 시간을 지정해 가벼운 애니메이션 WebP로
만들 때 씁니다. 입력 이미지는 GIF처럼 압축 손실이 큰 포맷을 거치지 않고 PNG/JPEG
원본에서 바로 인코딩되므로 화질·용량 면에서 유리합니다.

왜 라이브러리가 필요한가: 브라우저는 `canvas.toBlob('image/webp')`로 *정적* 한 장은
WebP로 인코딩하지만, 여러 장을 *애니메이션* WebP로 묶지는 못합니다 — 그 공백을
메웁니다. 정적 한 장 변환만 필요하면 이 패키지 대신 `canvas.toBlob`를 쓰세요.
(애니메이션 GIF를 WebP로 바꾸려는 거라면
[`@btheegg-kimth/gif2webp`](https://www.npmjs.com/package/@btheegg-kimth/gif2webp).)

## 설치

```sh
pnpm add @btheegg-kimth/img2webp
```

## 사용법

```ts
import { img2webp } from "@btheegg-kimth/img2webp";

// 가장 단순한 형태: 바이트 배열만 (프레임당 100ms, 무한 루프는 loopCount로)
const frames = [png0, png1, png2]; // 각각 Uint8Array (PNG/JPEG/WebP)
const webp = await img2webp(frames, {
  loopCount: 0,                       // 0 = 무한 반복
  defaultFrame: { duration: 100, quality: 80 },
});

const blob = new Blob([webp], { type: "image/webp" });
```

프레임마다 다른 지속시간/품질을 주려면 객체 형태로:

```ts
const webp = await img2webp([
  { data: png0, duration: 500 },                 // 첫 장 0.5초
  { data: png1, duration: 80, lossless: true },  // 둘째 장 80ms, 무손실
  png2,                                          // 기본값(defaultFrame) 적용
], { loopCount: 0, defaultFrame: { duration: 100 } });
```

### 입력 포맷

PNG · JPEG · WebP · PNM. 포맷은 **콘텐츠(매직 바이트)로 자동 감지**되므로 파일명/
확장자를 신경 쓸 필요 없습니다. (GIF는 입력으로 받지 않습니다 — 애니메이션 GIF →
WebP는 [`@btheegg-kimth/gif2webp`](https://www.npmjs.com/package/@btheegg-kimth/gif2webp)를 쓰세요.)

### 옵션

file-level 옵션 (`img2webp(frames, options)`의 `options`):

| 옵션 | 플래그 | 비고 |
|------|--------|------|
| `loopCount` | `-loop` | 0 = 무한 |
| `minimizeSize` | `-min_size` | |
| `kmin` / `kmax` | `-kmin` / `-kmax` | 키프레임 간격 |
| `mixed` | `-mixed` | 프레임별 lossy/lossless 자동 |
| `nearLossless` | `-near_lossless` | 0..100, 100=off |
| `sharpYuv` | `-sharp_yuv` | |
| `defaultFrame` | — | 전 프레임 공통 프레임 옵션 |
| `extraArgs` | — | 원시 전달 |

per-frame 옵션 (`Img2WebpFrame` 또는 `defaultFrame`):

| 옵션 | 플래그 | 비고 |
|------|--------|------|
| `duration` | `-d` | 프레임 표시 시간(ms), 기본 100 |
| `quality` | `-q` | 0..100 |
| `method` | `-m` | 0..6, 높을수록 느리고 작음 |
| `lossless` / `lossy` | `-lossless` / `-lossy` | 둘 다 주면 lossless 우선 |
| `exact` | `-exact` | 투명 영역 RGB 보존 |

## 비고

- WASM은 단일 `.mjs`에 인라인돼 있으며(`SINGLE_FILE=1`), 첫 호출 때 lazy 로드됩
  니다. 변환 경로에서만 `img2webp`를 import하면 메인 번들이 부풀지 않습니다.
- **pthread 비활성** 빌드이므로 COOP/COEP 헤더, SharedArrayBuffer 등 추가 요구사
  항 없음 — Vite/Webpack/Next 등 일반 환경에서 그대로 동작.
- 호출은 내부 mutex로 직렬화 — `Promise.all`로 여러 변환을 동시에 걸어도 안전.
- **0.0.1을 쓰고 있다면 0.0.2로 올리세요.** 0.0.1은 한 페이지에서 반복 호출하면 wasm
  스택이 조금씩 새서, 프레임 4장 기준 약 100번째 호출에서 크래시하고 그 뒤로는 멈췄습니다.
- 변환하는 동안 메인 스레드가 멈춥니다. 직접 만든 Web Worker 안에서 호출해도 됩니다.
  Vite 7 이하에서 워커 안에서 쓰려면 vite.config에 `worker: { format: "es" }`가
  필요합니다(기본 형식 iife는 wasm의 지연 로딩에 쓰는 동적 import를 지원하지 않음).
- libwebp(BSD-3-Clause) + libpng(PNG License) + zlib(Zlib License) +
  libjpeg-turbo(IJG/BSD-3-Clause)로 빌드됨. `THIRD_PARTY_LICENSES.md` 참고.
- 래퍼 코드는 MIT.

/**
 * @btheegg-kimth/gif2webp
 *
 * libwebp `gif2webp` CLI를 WASM으로 컴파일한 것에 대한 얇은 타입 래퍼.
 * Emscripten 가상 파일시스템으로 프로그램을 구동한다:
 *   input.gif 쓰기  ->  callMain([...args])  ->  output.webp 읽기
 *
 * wasm은 SINGLE_FILE=1로 빌드돼 glue(.mjs)에 base64로 인라인됨 — 소비자는 별도
 * .wasm 파일 호스팅/번들링 신경 안 써도 됨. pthread는 비활성이라 COOP/COEP
 * 헤더, SharedArrayBuffer 모두 불필요.
 */

import { createConverter } from "./core";

export interface Gif2WebpOptions {
  /** 품질 0..100 (-q). 기본 75 (프로젝트가 정한 기본값). */
  quality?: number;
  /** 압축 메서드 0..6 (-m); 높을수록 느리고 작음. */
  method?: number;
  /** 프레임별 lossy/lossless 자동 선택 (-mixed). */
  mixed?: boolean;
  /** lossy 인코딩 강제 (-lossy). */
  lossy?: boolean;
  /**
   * lossless 인코딩. gif2webp의 기본값이라 넘기는 플래그는 없음(gif2webp에는
   * `-lossless` 플래그 자체가 없다). `lossy`/`mixed`와 함께 주면 에러.
   */
  lossless?: boolean;
  /** 출력 크기 최소화 (-min_size). */
  minimizeSize?: boolean;
  /** 유지할 메타데이터 (-metadata). 기본 동작은 CLI를 따름. */
  metadata?: "all" | "none" | "icc" | "xmp";
  /**
   * 출력 애니메이션의 루프 횟수 (-loop_count N, 우리 패치). WebP 기준이라
   * 0 = 무한, N = N번 재생. 생략하면 GIF에 들어 있는 값을 따름. 0..65535.
   */
  loopCount?: number;
  /**
   * 캔버스 리사이즈 (-resize, 우리 패치). 애니메이션은 그대로 유지됨.
   * 예: `{ width: 1920, height: 1920 }` = 긴 변 1920 상한 (작은 GIF는 그대로).
   *
   * 축소 보간으로 팔레트에 없던 색이 생겨 lossless(기본)로는 오히려 커질 수
   * 있으니 `lossy` 또는 `mixed`와 함께 쓰는 것을 권장.
   */
  resize?: Gif2WebpResize;
  /** 탈출구: 추가 원시 CLI 인자를 그대로 덧붙임. */
  extraArgs?: string[];
}

export interface Gif2WebpResize {
  /** 목표 너비(px). 생략하면 높이 기준으로 비율 유지. */
  width?: number;
  /** 목표 높이(px). 생략하면 너비 기준으로 비율 유지. */
  height?: number;
  /**
   * `"inside"`(기본): width×height 박스 안에 비율 유지하며 맞춤.
   * `"fill"`: 비율 무시하고 정확히 width×height로 늘이거나 줄임.
   * 한 변만 주면 둘 다 비율 유지로 동일하게 동작.
   */
  fit?: "inside" | "fill";
  /** true(기본)면 확대하지 않음 — 원본이 이미 작으면 그대로 둠. */
  withoutEnlargement?: boolean;
}

// wasm(glue)은 첫 호출 때만 받는다 (소비자 메인 번들에 안 들어가도록).
const convert = createConverter(async () => {
  // SINGLE_FILE=1로 빌드된 ES 모듈. wasm 바이트가 base64로 인라인돼 있어 별도
  // .wasm 파일 fetch 없이 자체 완결. tsdown 번들에서 external로 제외함
  // (tsdown.config.js의 deps.neverBundle).
  // @ts-expect-error - 빌드가 emit, 타입 없음
  return (await import("../wasm/gif2webp.mjs")).default;
});

/**
 * 애니메이션(또는 정적) GIF를 WebP로 변환.
 * @param input GIF 바이트
 * @param options 인코딩 옵션 (기본 -q 75)
 * @returns WebP 바이트
 */
export async function gif2webp(
  input: Uint8Array,
  options: Gif2WebpOptions = { quality: 75 },
): Promise<Uint8Array> {
  return convert(input, options);
}

export default gif2webp;

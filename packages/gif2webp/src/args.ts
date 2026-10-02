/**
 * Gif2WebpOptions -> gif2webp CLI 인자. 메인 스레드/워커가 공유한다.
 * 플래그는 핀된 libwebp 1.6.0 gif2webp.c + build/patches/gif2webp.patch 기준.
 */

import type { Gif2WebpOptions, Gif2WebpResize } from "./index";

export const INPUT = "input.gif";
export const OUTPUT = "output.webp";

export function toArgs(opts: Gif2WebpOptions): string[] {
  const a: string[] = [];
  if (opts.mixed) a.push("-mixed");
  if (opts.lossy) a.push("-lossy");
  // lossless는 기본값이라 플래그 없음. 모순된 조합만 막는다.
  if (opts.lossless && (opts.lossy || opts.mixed)) {
    throw new RangeError("gif2webp: lossless는 lossy/mixed와 함께 쓸 수 없음");
  }
  if (opts.minimizeSize) a.push("-min_size");
  if (opts.quality != null) a.push("-q", String(opts.quality));
  if (opts.method != null) a.push("-m", String(opts.method));
  if (opts.metadata != null) a.push("-metadata", opts.metadata);
  if (opts.loopCount != null) {
    const n = opts.loopCount;
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new RangeError(`gif2webp: loopCount는 0..65535 정수여야 함 (받은 값: ${n})`);
    }
    a.push("-loop_count", String(n));
  }
  if (opts.resize) a.push(...resizeArgs(opts.resize));
  if (opts.extraArgs?.length) a.push(...opts.extraArgs);
  // 입력 다음 출력
  a.push(INPUT, "-o", OUTPUT);
  return a;
}

function resizeArgs(r: Gif2WebpResize): string[] {
  const dim = (v: number | undefined, name: string): number => {
    if (v == null) return 0; // CLI에서 0 = 비율 유지
    if (!Number.isInteger(v) || v <= 0) {
      throw new RangeError(`gif2webp: resize.${name}는 양의 정수여야 함 (받은 값: ${v})`);
    }
    return v;
  };
  const w = dim(r.width, "width");
  const h = dim(r.height, "height");
  if (w === 0 && h === 0) {
    throw new RangeError("gif2webp: resize에는 width나 height 중 하나는 있어야 함");
  }
  const a = ["-resize", String(w), String(h)];
  if ((r.fit ?? "inside") === "inside") a.push("-resize_fit");
  if (r.withoutEnlargement ?? true) a.push("-resize_down_only");
  return a;
}

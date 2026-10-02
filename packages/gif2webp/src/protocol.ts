/**
 * 메인 스레드 <-> 워커 메시지 형식. `createGif2WebpWorker`(메인)와
 * `@btheegg-kimth/gif2webp/worker`(워커)가 공유한다.
 */

import type { Gif2WebpOptions } from "./index";

/** 메시지가 이 패키지 것인지 구분하는 표식 (소비자 워커가 다른 메시지도 쓸 수 있음). */
export const TAG = "@btheegg-kimth/gif2webp";

export interface ConvertRequest {
  tag: typeof TAG;
  id: number;
  input: Uint8Array;
  options?: Gif2WebpOptions;
}

export type ConvertResponse =
  | { tag: typeof TAG; id: number; ok: true; output: Uint8Array }
  | { tag: typeof TAG; id: number; ok: false; error: { name: string; message: string } };

/**
 * @btheegg-kimth/gif2webp/worker
 *
 * 변환을 Web Worker에서 돌리는 `gif2webp()`. 시그니처는 메인 스레드용과 같아서
 * import 경로만 바꾸면 된다:
 *
 *   import { gif2webp } from "@btheegg-kimth/gif2webp/worker";
 *
 * 워커와 wasm은 첫 호출 때 만들어지고/받아진다 (import만으로는 아무것도 안 받음).
 * 마지막 작업이 끝나고 `idleTimeoutMs`(기본 30초) 동안 요청이 없으면 워커를 자동
 * 종료해 메모리를 돌려준다. 다음 호출 때 새로 만들어진다.
 */

import { connect, createGif2WebpWorker, type Gif2WebpWorker, type Gif2WebpWorkerOptions } from "./client";

export { createGif2WebpWorker, type Gif2WebpWorker, type Gif2WebpWorkerOptions };
export type { Gif2WebpOptions, Gif2WebpResize } from "./index";

export interface Gif2WebpWorkerConfig {
  /**
   * 마지막 작업이 끝난 뒤 워커를 자동 종료하기까지 기다리는 시간(ms). 기본 30000.
   * 0이면 대기열이 비는 즉시 종료, `Infinity`면 자동 종료하지 않음.
   * 대기열에 작업이 남아 있는 동안에는 종료하지 않는다.
   */
  idleTimeoutMs?: number;
}

let idleTimeoutMs = 30_000;

// 지금 쓰는 공유 워커와 그 워커에 걸린 미완료 작업 수. 워커가 바뀌어도 이전 워커의
// 작업이 끝나며 카운트를 건드리지 않도록 워커별로 묶어 둔다.
type Shared = { conv: Gif2WebpWorker; inFlight: number };
let shared: Shared | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function clearIdleTimer() {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = undefined;
}

function scheduleIdle() {
  clearIdleTimer();
  const cur = shared;
  if (!cur || cur.inFlight > 0 || idleTimeoutMs === Infinity) return;
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (shared === cur && cur.inFlight === 0) cur.conv.terminate();
  }, idleTimeoutMs);
}

/**
 * 공유 워커 설정. 언제 호출해도 되며, 지금 대기 중인 자동 종료 타이머에도 바로 반영된다.
 */
export function configureGif2WebpWorker(config: Gif2WebpWorkerConfig): void {
  if (config.idleTimeoutMs !== undefined) {
    const ms = config.idleTimeoutMs;
    if (!(ms >= 0)) {
      throw new RangeError(`gif2webp: idleTimeoutMs는 0 이상이어야 함 (받은 값: ${ms})`);
    }
    idleTimeoutMs = ms;
    scheduleIdle();
  }
}

/**
 * 애니메이션(또는 정적) GIF를 WebP로 변환. 변환은 워커에서 수행돼 페이지가 멈추지 않는다.
 * 실패(잘못된 입력, 옵션 오류, 워커 로드 실패, 종료로 끊김)는 모두 reject로 돌아온다.
 */
export function gif2webp(input: Uint8Array, options?: Gif2WebpWorkerOptions): Promise<Uint8Array> {
  clearIdleTimer();
  if (!shared) {
    // `new Worker(new URL(..., import.meta.url))` 모양을 그대로 둬야 Vite/webpack이
    // 워커 파일을 찾아 번들링한다. 경로는 빌드 산출물(dist/) 기준.
    const entry: Shared = {
      conv: connect(
        new Worker(new URL("./worker-entry.mjs", import.meta.url), { type: "module" }),
        // 종료/로드 실패로 닫히면 비워 두고, 다음 호출 때 새로 만든다.
        () => {
          if (shared === entry) {
            shared = null;
            clearIdleTimer();
          }
        },
      ),
      inFlight: 0,
    };
    shared = entry;
  }
  const cur = shared;
  cur.inFlight++;
  const result = cur.conv.gif2webp(input, options);
  const settle = () => {
    cur.inFlight--;
    if (shared === cur) scheduleIdle();
  };
  // 반환하는 promise는 그대로 두고 카운트만 따로 갱신 (여기서 reject를 삼키지 않음).
  result.then(settle, settle);
  return result;
}

/**
 * 공유 워커를 즉시 종료한다(예: 로그아웃). 진행 중이거나 대기 중인 변환은 reject된다.
 * 다음 `gif2webp()` 호출 때 새로 만들어진다.
 */
export function terminateGif2WebpWorker(): void {
  clearIdleTimer();
  shared?.conv.terminate(); // onClose가 shared를 비운다
}

export default gif2webp;

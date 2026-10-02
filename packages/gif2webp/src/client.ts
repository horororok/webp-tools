/**
 * 메인 스레드 쪽 워커 클라이언트 (postMessage <-> Promise).
 *
 * 보통은 `@btheegg-kimth/gif2webp/worker`의 `gif2webp()`가 내부에서 쓴다. 번들러가
 * 패키지 안의 워커를 처리하지 못할 때만 직접 쓴다:
 *
 *   // gif2webp.worker.ts (소비자 레포)
 *   import "@btheegg-kimth/gif2webp/worker-entry";
 *
 *   const conv = createGif2WebpWorker(
 *     new Worker(new URL("./gif2webp.worker.ts", import.meta.url), { type: "module" }),
 *   );
 */

import type { Gif2WebpOptions } from "./index";
import { TAG, type ConvertRequest, type ConvertResponse } from "./protocol";

export interface Gif2WebpWorkerOptions extends Gif2WebpOptions {
  /**
   * true면 입력 버퍼를 복사하지 않고 워커로 넘긴다(transfer). 호출 후 `input`은
   * 비어 버리므로(detach) 원본 바이트를 다시 쓸 일이 없을 때만 켤 것.
   * 기본 false: 입력 크기만큼 복사 (수 MB면 수 ms 수준).
   */
  transfer?: boolean;
}

export interface Gif2WebpWorker {
  /** `gif2webp()`와 같은 옵션/결과. 변환은 워커에서 수행. */
  gif2webp(input: Uint8Array, options?: Gif2WebpWorkerOptions): Promise<Uint8Array>;
  /** 워커 종료. 진행 중인 변환은 reject됨. */
  terminate(): void;
}

/**
 * `@btheegg-kimth/gif2webp/worker-entry`를 실행하는 워커를 감싸 Promise API로 만든다.
 * 여러 변환을 동시에 요청해도 되며, 워커 안에서 순서대로 처리된다.
 */
export function createGif2WebpWorker(worker: Worker): Gif2WebpWorker {
  return connect(worker, () => {});
}

/** @internal `onClose`: 워커가 더는 못 쓰게 됐을 때(종료/로드 실패) 호출. */
export function connect(worker: Worker, onClose: () => void): Gif2WebpWorker {
  let nextId = 0;
  let closed: Error | null = null;
  const pending = new Map<number, { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }>();

  const close = (err: Error) => {
    if (closed) return;
    closed = err;
    worker.terminate();
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    onClose();
  };

  worker.addEventListener("message", (e: MessageEvent) => {
    const res = e.data as ConvertResponse | undefined;
    if (res?.tag !== TAG) return;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) {
      p.resolve(res.output);
    } else {
      const err = new Error(res.error.message);
      err.name = res.error.name; // RangeError 등 원래 이름 유지
      p.reject(err);
    }
  });
  // 워커 스크립트 로드 실패(경로 오류, import 실패 등)는 요청별 응답이 오지 않는다.
  // 그대로 두면 이후 호출이 영원히 대기하므로 워커를 닫고 전부 reject.
  worker.addEventListener("error", (e: ErrorEvent) => {
    e.preventDefault?.();
    close(new Error(`gif2webp 워커 오류: ${e.message || "워커 스크립트를 실행하지 못함"}`));
  });
  worker.addEventListener("messageerror", () => {
    close(new Error("gif2webp 워커 오류: 메시지를 역직렬화하지 못함"));
  });

  return {
    gif2webp(input, options) {
      if (closed) return Promise.reject(closed);
      const { transfer = false, ...convertOptions } = options ?? {};
      const id = nextId++;
      // transfer가 아니면 정확한 크기의 복사본을 만들어 그걸 넘긴다(호출자 버퍼 유지,
      // 큰 버퍼의 일부 view여도 필요한 바이트만 이동).
      const data = transfer ? input : input.slice();
      const req: ConvertRequest = {
        tag: TAG,
        id,
        input: data,
        // 옵션을 안 주면 undefined로 보내 메인 스레드와 같은 기본값({ quality: 75 })을 쓰게 한다.
        options: options ? convertOptions : undefined,
      };
      return new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage(req, [data.buffer]);
        } catch (err) {
          // 예: transfer할 수 없는 버퍼(SharedArrayBuffer, 이미 detach됨).
          pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    terminate() {
      close(new Error("gif2webp 워커가 종료됨"));
    },
  };
}

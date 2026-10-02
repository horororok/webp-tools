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
   * `input`이 더 큰 버퍼의 일부 view면 다른 데이터를 지키기 위해 복사로 처리한다.
   * 기본 false: 입력 크기만큼 복사 (5 MB에 1 ms 미만).
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

/**
 * @internal `onClose`: 워커가 더는 못 쓰게 됐을 때(종료/로드 실패) 호출.
 * `loadHint`: 워커 오류 메시지에 덧붙일 안내 (예: 워커 경로, 번들러 설정).
 */
export function connect(worker: Worker, onClose: () => void, loadHint = ""): Gif2WebpWorker {
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
    close(new Error(`gif2webp 워커 오류: ${e.message || "워커 스크립트를 실행하지 못함"}${loadHint}`));
  });
  worker.addEventListener("messageerror", () => {
    close(new Error("gif2webp 워커 오류: 메시지를 역직렬화하지 못함"));
  });

  return {
    gif2webp(input, options) {
      if (closed) return Promise.reject(closed);
      try {
        return send(input, options);
      } catch (err) {
        // 예: input이 Uint8Array가 아님. 동기 throw 대신 reject.
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
    terminate() {
      close(new Error("gif2webp 워커가 종료됨"));
    },
  };

  function send(input: Uint8Array, options: Gif2WebpWorkerOptions | undefined): Promise<Uint8Array> {
    const { transfer = false, ...convertOptions } = options ?? {};
    const id = nextId++;
    // transfer는 버퍼 전체를 넘기므로, input이 버퍼 전체를 덮을 때만 그대로 넘긴다.
    // 큰 버퍼의 일부 view면 다른 데이터까지 비워 버리니 필요한 바이트만 복사해 넘긴다.
    // transfer가 아니면 항상 복사(호출자 버퍼 유지).
    const whole = input.byteOffset === 0 && input.byteLength === input.buffer.byteLength;
    const data = transfer && whole ? input : input.slice();
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
  }
}

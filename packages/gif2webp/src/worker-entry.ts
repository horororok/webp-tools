/**
 * 워커 안에서 실행되는 스크립트. 메시지를 받아 변환하고 결과를 돌려준다.
 *
 * 보통은 `@btheegg-kimth/gif2webp/worker`의 `gif2webp()`가 이 파일로 워커를 직접
 * 만든다. 번들러가 그 방식을 처리하지 못할 때만 소비자가 자기 워커 파일에서
 * `import "@btheegg-kimth/gif2webp/worker-entry"`로 쓰고 `createGif2WebpWorker`에 넘긴다.
 *
 * 변환 로직은 메인 스레드용과 같은 core.ts를 쓴다 (같은 mutex, 같은 스택 복원).
 */

// @ts-expect-error - 빌드가 emit, 타입 없음
import factory from "../wasm/gif2webp.mjs";
import { createConverter, type Gif2WebpFactory } from "./core";
import { TAG, type ConvertRequest, type ConvertResponse } from "./protocol";

// 워커 안에서는 정적 import. 워커 자체가 첫 호출 때 만들어지므로 lazy는 그대로이고,
// 워커 번들 안에 동적 import가 없어야 Vite 7 이하(워커 기본 형식 iife)에서도 빌드된다.
const gif2webp = createConverter(async () => factory as Gif2WebpFactory);

// tsconfig lib에 WebWorker를 넣지 않고 필요한 부분만 선언 (DOM 타입과 충돌 방지).
const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  postMessage(message: ConvertResponse, transfer?: Transferable[]): void;
};

scope.addEventListener("message", async (e: MessageEvent) => {
  const req = e.data as ConvertRequest | undefined;
  if (req?.tag !== TAG) return; // 소비자 워커의 다른 메시지는 무시
  try {
    const output = await gif2webp(req.input, req.options);
    // 결과 버퍼는 워커에 필요 없으니 복사 없이 넘긴다.
    scope.postMessage({ tag: TAG, id: req.id, ok: true, output }, [output.buffer]);
  } catch (err) {
    const e = (err ?? {}) as Partial<Error>;
    const error = { name: String(e.name ?? "Error"), message: String(e.message ?? err) };
    try {
      scope.postMessage({ tag: TAG, id: req.id, ok: false, error });
    } catch {
      // 응답을 못 보내면 메인 쪽 요청이 영원히 대기하므로, 최소한의 문자열로 다시 보낸다.
      scope.postMessage({ tag: TAG, id: req.id, ok: false, error: { name: "Error", message: "gif2webp 워커 오류" } });
    }
  }
});

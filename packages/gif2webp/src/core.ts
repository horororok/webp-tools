/**
 * 변환 런타임: wasm 모듈 lazy 생성 + 호출 직렬화 + 가상 FS 구동.
 *   input.gif 쓰기  ->  callMain([...args])  ->  output.webp 읽기
 *
 * wasm 로더를 인자로 받는다. 메인 스레드(index.ts)는 첫 호출 때 동적 import로 받고,
 * 워커(worker-entry.ts)는 정적 import를 쓴다. Vite 7 이하는 워커를 iife로 묶는데,
 * iife는 워커 안의 동적 import(code-splitting)를 지원하지 않기 때문.
 */

import type { Gif2WebpOptions } from "./index";
import { INPUT, OUTPUT, toArgs } from "./args";

export type EmscriptenModule = {
  callMain: (args: string[]) => number;
  stackSave: () => number;
  stackRestore: (sp: number) => void;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
};

/** emscripten MODULARIZE 팩토리 (wasm/gif2webp.mjs의 default export). */
export type Gif2WebpFactory = (opts: {
  print: (line: string) => void;
  printErr: (line: string) => void;
}) => Promise<EmscriptenModule>;

export type Convert = (input: Uint8Array, options?: Gif2WebpOptions) => Promise<Uint8Array>;

export function createConverter(loadFactory: () => Promise<Gif2WebpFactory>): Convert {
  let modulePromise: Promise<EmscriptenModule> | null = null;

  // gif2webp CLI가 stderr로 내보내는 줄을 모아 둔다(변환 실패 시 에러 메시지에 포함).
  // 호출은 mutex로 직렬화되므로 호출 시작 시 비우면 이번 호출분만 캡처됨.
  const stderrLines: string[] = [];

  function getModule(): Promise<EmscriptenModule> {
    if (!modulePromise) {
      const p = loadFactory().then((factory) =>
        factory({
          // CLI는 성공 시 "Saved output file..."을 stdout에 찍는다. 라이브러리가
          // 소비자 콘솔을 오염시키지 않도록 stdout은 버리고, stderr는 캡처해 실패
          // 시 에러로 surface.
          print: () => {},
          printErr: (line: string) => {
            stderrLines.push(line);
          },
        }),
      );
      // 초기화 실패를 영구히 캐시하지 않는다(다음 호출 때 다시 시도).
      p.catch(() => {
        if (modulePromise === p) modulePromise = null;
      });
      modulePromise = p;
    }
    return modulePromise;
  }

  // 호출 직렬화 큐. wasm 모듈은 단일 인스턴스를 재사용하며 가상 FS의 input.gif/
  // output.webp 파일명을 공유한다. 호출이 겹치면 한 호출의 입력이 다른 호출의
  // 출력을 덮어쓰거나 unlink가 다른 호출의 파일을 지운다. wasm은 어차피 단일
  // 스레드라 직렬화해도 처리량 손실 없음. (사용자가 Promise.all로 여러 GIF를 한
  // 번에 변환하는 batch 케이스가 정상 사용 경로임)
  let queue: Promise<unknown> = Promise.resolve();

  return async function convert(input, options = { quality: 75 }) {
    // 옵션 검증(잘못된 resize 등)은 큐/가상 FS를 건드리기 전에.
    const args = toArgs(options);
    const prev = queue;
    let release!: () => void;
    queue = new Promise<void>((r) => (release = r));
    // 앞 호출이 throw해도 큐는 계속 흘러야 한다(블록되면 안 됨).
    await prev.catch(() => {});
    try {
      const mod = await getModule();
      stderrLines.length = 0; // 이번 호출분만 캡처
      mod.FS.writeFile(INPUT, input);
      // callMain은 argv를 wasm 스택에 올리고 되돌리지 않는다. 복원하지 않으면 같은
      // 모듈로 수백 번 호출했을 때 스택이 바닥나 크래시 후 무한 대기에 빠진다.
      const sp = mod.stackSave();
      try {
        mod.callMain(args);
      } catch (err: unknown) {
        // EXIT_RUNTIME=0이면 Emscripten은 성공 시에도 ExitStatus를 던진다.
        const status = err as { name?: string; status?: number } | null;
        if (!(status && status.name === "ExitStatus")) {
          // ExitStatus가 아닌 예외(RuntimeError, abort 등)면 wasm 상태를 믿을 수 없다.
          // 이 모듈을 버리고 다음 호출 때 새로 만든다 (호출은 mutex로 직렬화돼 있음).
          modulePromise = null;
          throw err;
        }
        if (status.status !== 0) throw err;
      } finally {
        // 크래시한 모듈에서는 이것도 throw할 수 있다. 원래 에러를 가리지 않도록 무시.
        try { mod.stackRestore(sp); } catch { /* 무시 */ }
      }
      let out: Uint8Array;
      try {
        out = mod.FS.readFile(OUTPUT);
      } catch {
        // 출력이 없으면 변환 실패. CLI가 stderr에 남긴 이유를 붙여 던진다.
        const detail = stderrLines.join("\n").trim();
        throw new Error(
          `gif2webp 변환 실패: 출력 파일이 생성되지 않음${detail ? `\n${detail}` : ""}`,
        );
      }
      // 다음 변환에 모듈을 재사용할 수 있도록 정리.
      try { mod.FS.unlink(INPUT); } catch { /* 무시 */ }
      try { mod.FS.unlink(OUTPUT); } catch { /* 무시 */ }
      return out;
    } finally {
      release();
    }
  };
}

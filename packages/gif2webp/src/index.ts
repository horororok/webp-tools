/**
 * @btheegg-kimth/gif2webp
 *
 * libwebp `gif2webp` CLI를 WASM으로 컴파일한 것에 대한 얇은 타입 래퍼.
 * Emscripten 가상 파일시스템으로 프로그램을 구동한다:
 *   input.gif 쓰기  ->  callMain([...args])  ->  output.webp 읽기
 *
 * 비고(provisional): emit된 Emscripten glue(`wasm/gif2webp.mjs`)의 정확한 모양은
 * 첫 빌드 성공 후에야 확정된다. 아래 로더는 표준 MODULARIZE + EXPORT_ES6 출력을
 * 가정한다(팩토리가 default export이고 .wasm을 자기 기준으로 해석). 첫 빌드가 다른
 * 모양을 emit하면, 여기가 바로 수정할 한 군데다.
 */

export interface Gif2WebpOptions {
  /** 품질 0..100 (-q). 기본 75 (프로젝트가 정한 기본값). */
  quality?: number;
  /** 압축 메서드 0..6 (-m); 높을수록 느리고 작음. */
  method?: number;
  /** 프레임별 lossy/lossless 자동 선택 (-mixed). */
  mixed?: boolean;
  /** lossy 인코딩 강제 (-lossy). */
  lossy?: boolean;
  /** lossless 인코딩 강제 (-lossless). */
  lossless?: boolean;
  /** 출력 크기 최소화 (-min_size). */
  minimizeSize?: boolean;
  /** 유지할 메타데이터 (-metadata). 기본 동작은 CLI를 따름. */
  metadata?: "all" | "none" | "icc" | "xmp";
  /** 가능하면 멀티스레딩 사용 (-mt). */
  multiThreaded?: boolean;
  /** 출력 애니메이션의 루프 횟수 (-loop_count N). */
  loopCount?: number;
  /** 탈출구: 추가 원시 CLI 인자를 그대로 덧붙임. */
  extraArgs?: string[];
}

const INPUT = "input.gif";
const OUTPUT = "output.webp";

function toArgs(opts: Gif2WebpOptions): string[] {
  const a: string[] = [];
  if (opts.mixed) a.push("-mixed");
  if (opts.lossy) a.push("-lossy");
  if (opts.lossless) a.push("-lossless");
  if (opts.minimizeSize) a.push("-min_size");
  if (opts.multiThreaded) a.push("-mt");
  if (opts.quality != null) a.push("-q", String(opts.quality));
  if (opts.method != null) a.push("-m", String(opts.method));
  if (opts.metadata != null) a.push("-metadata", opts.metadata);
  if (opts.loopCount != null) a.push("-loop_count", String(opts.loopCount));
  if (opts.extraArgs?.length) a.push(...opts.extraArgs);
  // 입력 다음 출력
  a.push(INPUT, "-o", OUTPUT);
  return a;
}

type EmscriptenModule = {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
};

let modulePromise: Promise<EmscriptenModule> | null = null;

async function getModule(): Promise<EmscriptenModule> {
  if (!modulePromise) {
    // Emscripten ES 모듈은 gif2webp.wasm 옆에 위치하며 import.meta.url로 그것을
    // 해석한다. tsdown 번들에서 external로 제외함(tsdown.config.js의 deps.neverBundle).
    // @ts-expect-error - 빌드가 emit, 타입 없음
    const factory = (await import("../wasm/gif2webp.mjs")).default;
    modulePromise = factory() as Promise<EmscriptenModule>;
  }
  return modulePromise;
}

// 호출 직렬화 큐. wasm 모듈은 단일 인스턴스를 재사용하며 가상 FS의 input.gif/
// output.webp 파일명을 공유한다. 호출이 겹치면 한 호출의 입력이 다른 호출의
// 출력을 덮어쓰거나 unlink가 다른 호출의 파일을 지운다. wasm은 어차피 단일
// 스레드라 직렬화해도 처리량 손실 없음. (사용자가 Promise.all로 여러 GIF를 한
// 번에 변환하는 batch 케이스가 정상 사용 경로임)
let queue: Promise<unknown> = Promise.resolve();

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
  const prev = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => (release = r));
  // 앞 호출이 throw해도 큐는 계속 흘러야 한다(블록되면 안 됨).
  await prev.catch(() => {});
  try {
    const mod = await getModule();
    mod.FS.writeFile(INPUT, input);
    try {
      mod.callMain(toArgs(options));
    } catch (err: unknown) {
      // EXIT_RUNTIME=0이면 Emscripten은 성공 시에도 ExitStatus를 던진다.
      const status = (err as { name?: string; status?: number } | null);
      if (!(status && status.name === "ExitStatus" && status.status === 0)) {
        throw err;
      }
    }
    const out = mod.FS.readFile(OUTPUT);
    // 다음 변환에 모듈을 재사용할 수 있도록 정리.
    try { mod.FS.unlink(INPUT); } catch { /* 무시 */ }
    try { mod.FS.unlink(OUTPUT); } catch { /* 무시 */ }
    return out;
  } finally {
    release();
  }
}

export default gif2webp;

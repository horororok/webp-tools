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

// gif2webp CLI가 stderr로 내보내는 줄을 모아 둔다(변환 실패 시 에러 메시지에 포함).
// 호출은 mutex로 직렬화되므로 호출 시작 시 비우면 이번 호출분만 캡처됨.
const stderrLines: string[] = [];

async function getModule(): Promise<EmscriptenModule> {
  if (!modulePromise) {
    // SINGLE_FILE=1로 빌드된 ES 모듈. wasm 바이트가 base64로 인라인돼 있어 별도
    // .wasm 파일 fetch 없이 자체 완결. tsdown 번들에서 external로 제외함
    // (tsdown.config.js의 deps.neverBundle).
    // @ts-expect-error - 빌드가 emit, 타입 없음
    const factory = (await import("../wasm/gif2webp.mjs")).default;
    modulePromise = factory({
      // CLI는 성공 시 "Saved output file..."을 stdout에 찍는다. 라이브러리가
      // 소비자 콘솔을 오염시키지 않도록 stdout은 버리고, stderr는 캡처해 실패
      // 시 에러로 surface.
      print: () => {},
      printErr: (line: string) => {
        stderrLines.push(line);
      },
    }) as Promise<EmscriptenModule>;
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
    stderrLines.length = 0; // 이번 호출분만 캡처
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
}

export default gif2webp;

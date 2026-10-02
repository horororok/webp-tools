/**
 * @btheegg-kimth/img2webp
 *
 * libwebp `img2webp` CLI를 WASM으로 컴파일한 것에 대한 얇은 타입 래퍼.
 * 여러 프레임 이미지(PNG/JPEG/WebP/PNM)를 받아 하나의 애니메이션 WebP로 묶는다.
 * Emscripten 가상 파일시스템으로 프로그램을 구동한다:
 *   frame0, frame1, ... 쓰기  ->  callMain([...args])  ->  output.webp 읽기
 *
 * 브라우저는 `canvas.toBlob('image/webp')`로 *정적* 한 장은 만들지만, 여러 장을
 * *애니메이션* WebP로 묶지는 못한다 — 그 공백을 메운다. 입력 포맷은 콘텐츠(매직
 * 바이트)로 자동 감지되므로 파일명/확장자는 불필요.
 *
 * wasm은 SINGLE_FILE=1로 빌드돼 glue(.mjs)에 base64로 인라인됨 — 소비자는 별도
 * .wasm 파일 호스팅/번들링 신경 안 써도 됨. pthread는 비활성이라 COOP/COEP
 * 헤더, SharedArrayBuffer 모두 불필요.
 */

/** 프레임별로 덮어쓸 수 있는 인코딩 옵션 (img2webp의 per-frame 옵션). */
export interface Img2WebpFrameOptions {
  /** 이 프레임 표시 시간(ms) (-d). 기본 100. */
  duration?: number;
  /** lossless 강제 (-lossless). */
  lossless?: boolean;
  /** lossy 강제 (-lossy). */
  lossy?: boolean;
  /** 품질 0..100 (-q). */
  quality?: number;
  /** 압축 메서드 0..6 (-m); 높을수록 느리고 작음. */
  method?: number;
  /** 투명 영역의 RGB 값 보존 (-exact). img2webp에선 per-frame 옵션. */
  exact?: boolean;
}

/** 바이트 + 프레임별 옵션. 옵션 없이 바이트만 줄 거면 `Uint8Array`를 바로 넘겨도 됨. */
export interface Img2WebpFrame extends Img2WebpFrameOptions {
  /** 프레임 이미지 바이트 (PNG/JPEG/WebP/PNM). */
  data: Uint8Array;
}

export interface Img2WebpOptions {
  /** 출력 크기 최소화 (-min_size). */
  minimizeSize?: boolean;
  /** 애니메이션 반복 횟수, 0=무한 (-loop). */
  loopCount?: number;
  /** 키프레임 사이 최대 프레임 수 (-kmax); 0=키프레임만. */
  kmax?: number;
  /** 키프레임 사이 최소 프레임 수 (-kmin); 0=키프레임 비활성. */
  kmin?: number;
  /** 프레임별 lossy/lossless 자동 선택 (-mixed). */
  mixed?: boolean;
  /** near-lossless 전처리 0..100, 100=off (-near_lossless). */
  nearLossless?: number;
  /** 더 선명한(느린) RGB->YUV 변환 (-sharp_yuv). */
  sharpYuv?: boolean;
  /**
   * 모든 프레임에 적용되는 기본 프레임 옵션. 개별 프레임이 같은 값을 주면 그쪽이
   * 우선한다. 예: `{ duration: 80, quality: 80 }`로 전 프레임 공통 설정.
   */
  defaultFrame?: Img2WebpFrameOptions;
  /** 탈출구: 추가 원시 CLI 인자를 file-level 옵션 뒤에 그대로 덧붙임. */
  extraArgs?: string[];
}

const OUTPUT = "output.webp";

function frameName(i: number): string {
  return `frame${i}`;
}

/** per-frame 옵션 -> CLI 인자. 프레임 파일명 앞에 놓여 그 프레임에 적용된다. */
function frameArgs(opts: Img2WebpFrameOptions): string[] {
  const a: string[] = [];
  if (opts.duration != null) a.push("-d", String(opts.duration));
  // -lossless / -lossy 는 상호배타. 둘 다 주면 lossless 우선(CLI도 나중 것이 이김).
  if (opts.lossless) a.push("-lossless");
  else if (opts.lossy) a.push("-lossy");
  if (opts.quality != null) a.push("-q", String(opts.quality));
  if (opts.method != null) a.push("-m", String(opts.method));
  if (opts.exact) a.push("-exact");
  return a;
}

/** file-level 옵션 -> CLI 인자. 모든 프레임 앞, 인자열 맨 앞에 놓인다. */
function fileArgs(opts: Img2WebpOptions): string[] {
  const a: string[] = [];
  if (opts.minimizeSize) a.push("-min_size");
  // img2webp는 `-loop` (gif2webp의 `-loop_count`와 다름).
  if (opts.loopCount != null) a.push("-loop", String(opts.loopCount));
  if (opts.kmin != null) a.push("-kmin", String(opts.kmin));
  if (opts.kmax != null) a.push("-kmax", String(opts.kmax));
  if (opts.mixed) a.push("-mixed");
  if (opts.nearLossless != null) a.push("-near_lossless", String(opts.nearLossless));
  if (opts.sharpYuv) a.push("-sharp_yuv");
  if (opts.extraArgs?.length) a.push(...opts.extraArgs);
  return a;
}

function normalizeFrame(f: Uint8Array | Img2WebpFrame): Img2WebpFrame {
  return f instanceof Uint8Array ? { data: f } : f;
}

type EmscriptenModule = {
  callMain: (args: string[]) => number;
  stackSave: () => number;
  stackRestore: (sp: number) => void;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
};

let modulePromise: Promise<EmscriptenModule> | null = null;

// img2webp CLI가 stderr로 내보내는 줄을 모아 둔다(변환 실패 시 에러 메시지에 포함).
// 호출은 mutex로 직렬화되므로 호출 시작 시 비우면 이번 호출분만 캡처됨.
const stderrLines: string[] = [];

function getModule(): Promise<EmscriptenModule> {
  if (!modulePromise) {
    // SINGLE_FILE=1로 빌드된 ES 모듈. wasm 바이트가 base64로 인라인돼 있어 별도
    // .wasm 파일 fetch 없이 자체 완결. tsdown 번들에서 external로 제외함
    // (tsdown.config.js의 deps.neverBundle).
    // @ts-expect-error - 빌드가 emit, 타입 없음
    const p: Promise<EmscriptenModule> = import("../wasm/img2webp.mjs").then((m) =>
      m.default({
        // CLI는 성공 시 진행 메시지를 stdout에 찍는다. 라이브러리가 소비자 콘솔을
        // 오염시키지 않도록 stdout은 버리고, stderr는 캡처해 실패 시 에러로 surface.
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

// 호출 직렬화 큐. wasm 모듈은 단일 인스턴스를 재사용하며 가상 FS의 frameN/
// output.webp 파일명을 공유한다. 호출이 겹치면 한 호출의 입력이 다른 호출의
// 출력을 덮어쓰거나 unlink가 다른 호출의 파일을 지운다. wasm은 어차피 단일
// 스레드라 직렬화해도 처리량 손실 없음.
let queue: Promise<unknown> = Promise.resolve();

/**
 * 여러 프레임 이미지를 하나의 애니메이션 WebP로 묶는다.
 *
 * @param frames 프레임 배열. 각 항목은 `Uint8Array`(바이트만) 또는 `Img2WebpFrame`
 *   (바이트 + 프레임별 duration/quality 등). 적어도 1개 필요.
 * @param options file-level 옵션 + 전 프레임 공통 기본값(`defaultFrame`).
 * @returns 애니메이션 WebP 바이트.
 *
 * @example
 * const webp = await img2webp(
 *   [png0, png1, png2],
 *   { loopCount: 0, defaultFrame: { duration: 100, quality: 80 } },
 * );
 */
export async function img2webp(
  frames: Array<Uint8Array | Img2WebpFrame>,
  options: Img2WebpOptions = {},
): Promise<Uint8Array> {
  if (!frames.length) {
    throw new Error("img2webp: 프레임이 최소 1개 필요합니다");
  }
  const normalized = frames.map(normalizeFrame);
  const { defaultFrame = {}, ...fileLevel } = options;

  // 인자 조립: [file-level] (프레임마다: [per-frame opts] frameN) -o output.webp
  const args = fileArgs(fileLevel);
  normalized.forEach((f, i) => {
    const { data: _data, ...perFrame } = f;
    args.push(...frameArgs({ ...defaultFrame, ...perFrame }), frameName(i));
  });
  args.push("-o", OUTPUT);

  const prev = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => (release = r));
  // 앞 호출이 throw해도 큐는 계속 흘러야 한다(블록되면 안 됨).
  await prev.catch(() => {});
  try {
    const mod = await getModule();
    stderrLines.length = 0; // 이번 호출분만 캡처
    normalized.forEach((f, i) => mod.FS.writeFile(frameName(i), f.data));
    // callMain은 argv를 wasm 스택에 올리고 되돌리지 않는다. 복원하지 않으면 같은
    // 모듈로 반복 호출했을 때 스택이 바닥나 크래시 후 무한 대기에 빠진다.
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
      try {
        mod.stackRestore(sp);
      } catch {
        /* 무시 */
      }
    }
    let out: Uint8Array;
    try {
      out = mod.FS.readFile(OUTPUT);
    } catch {
      // 출력이 없으면 변환 실패. CLI가 stderr에 남긴 이유를 붙여 던진다.
      const detail = stderrLines.join("\n").trim();
      throw new Error(
        `img2webp 변환 실패: 출력 파일이 생성되지 않음${detail ? `\n${detail}` : ""}`,
      );
    }
    // 다음 변환에 모듈을 재사용할 수 있도록 정리.
    normalized.forEach((_f, i) => {
      try {
        mod.FS.unlink(frameName(i));
      } catch {
        /* 무시 */
      }
    });
    try {
      mod.FS.unlink(OUTPUT);
    } catch {
      /* 무시 */
    }
    return out;
  } finally {
    release();
  }
}

export default img2webp;

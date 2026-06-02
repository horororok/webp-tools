import { gif2webp } from "@btheegg-kimth/gif2webp";
import { img2webp } from "@btheegg-kimth/img2webp";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(el: HTMLElement, msg: string, ok: boolean) {
  el.innerHTML = `<p class="${ok ? "ok" : "err"}">${msg}</p>`;
}

function magic(bytes: Uint8Array): string {
  const head = new TextDecoder("ascii").decode(bytes.subarray(0, 4));
  const fmt = bytes.length >= 12 ? new TextDecoder("ascii").decode(bytes.subarray(8, 12)) : "";
  return `${head}${fmt ? " / " + fmt : ""}`;
}

function previewInto(img: HTMLImageElement, bytes: Uint8Array, type: string) {
  img.src = URL.createObjectURL(new Blob([bytes], { type }));
}

// ============================ gif2webp ============================

const gifFile = $<HTMLInputElement>("gifFile");
const gifSample = $<HTMLButtonElement>("gifSample");
const gifStatus = $<HTMLDivElement>("gifStatus");
const gifIn = $<HTMLImageElement>("gifIn");
const gifOut = $<HTMLImageElement>("gifOut");
const gifInInfo = $<HTMLPreElement>("gifInInfo");
const gifOutInfo = $<HTMLPreElement>("gifOutInfo");

// 내장 2프레임 1x1 애니메이션 GIF.
const SAMPLE_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53,
  0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00, 0x21,
  0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x21, 0xf9, 0x04, 0x04,
  0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x4c, 0x01, 0x00, 0x3b,
]);

async function runGif(input: Uint8Array) {
  try {
    setStatus(gifStatus, "변환 중…", true);
    previewInto(gifIn, input, "image/gif");
    gifInInfo.textContent = `${input.length} bytes\nmagic: ${magic(input)}`;

    const t0 = performance.now();
    const out = await gif2webp(input, { quality: 75 });
    const ms = (performance.now() - t0).toFixed(1);

    const head = new TextDecoder("ascii").decode(out.subarray(0, 4));
    const fmt = new TextDecoder("ascii").decode(out.subarray(8, 12));
    if (head !== "RIFF" || fmt !== "WEBP") throw new Error(`출력이 WebP가 아님 (${head}/${fmt})`);

    previewInto(gifOut, out, "image/webp");
    gifOutInfo.textContent = `${out.length} bytes\nmagic: ${magic(out)}`;
    setStatus(gifStatus, `✓ 변환 성공: ${input.length} → ${out.length} bytes (${ms} ms)`, true);
  } catch (err) {
    setStatus(gifStatus, `✗ 실패: ${(err as Error).message}`, false);
    console.error(err);
  }
}

gifFile.addEventListener("change", async () => {
  const file = gifFile.files?.[0];
  if (file) await runGif(new Uint8Array(await file.arrayBuffer()));
});
gifSample.addEventListener("click", () => runGif(SAMPLE_GIF));

// ============================ img2webp ============================

const imgFiles = $<HTMLInputElement>("imgFiles");
const imgSample = $<HTMLButtonElement>("imgSample");
const imgStatus = $<HTMLDivElement>("imgStatus");
const imgIn = $<HTMLDivElement>("imgIn");
const imgOut = $<HTMLImageElement>("imgOut");
const imgInInfo = $<HTMLPreElement>("imgInInfo");
const imgOutInfo = $<HTMLPreElement>("imgOutInfo");

// canvas로 단색 PNG 한 장 생성 -> Uint8Array.
function makePngFrame(color: string, size = 96): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 40px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(color[1]?.toUpperCase() ?? "?", size / 2, size / 2);
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("canvas.toBlob 실패"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

async function runImg(frames: Uint8Array[]) {
  try {
    if (!frames.length) throw new Error("프레임이 없습니다");
    setStatus(imgStatus, "변환 중…", true);

    imgIn.innerHTML = "";
    frames.forEach((f) => {
      const el = document.createElement("img");
      el.style.width = "64px";
      el.style.marginRight = "4px";
      previewInto(el, f, "image/png");
      imgIn.appendChild(el);
    });
    imgInInfo.textContent = `${frames.length} frames\n` +
      frames.map((f, i) => `#${i}: ${f.length} bytes (${magic(f)})`).join("\n");

    const t0 = performance.now();
    const out = await img2webp(frames, {
      loopCount: 0,
      defaultFrame: { duration: 400, quality: 80 },
    });
    const ms = (performance.now() - t0).toFixed(1);

    const head = new TextDecoder("ascii").decode(out.subarray(0, 4));
    const fmt = new TextDecoder("ascii").decode(out.subarray(8, 12));
    if (head !== "RIFF" || fmt !== "WEBP") throw new Error(`출력이 WebP가 아님 (${head}/${fmt})`);

    previewInto(imgOut, out, "image/webp");
    imgOutInfo.textContent = `${out.length} bytes\nmagic: ${magic(out)}`;
    setStatus(imgStatus, `✓ 변환 성공: ${frames.length} 프레임 → ${out.length} bytes (${ms} ms)`, true);
  } catch (err) {
    setStatus(imgStatus, `✗ 실패: ${(err as Error).message}`, false);
    console.error(err);
  }
}

imgFiles.addEventListener("change", async () => {
  const files = Array.from(imgFiles.files ?? []);
  const frames = await Promise.all(
    files.map(async (f) => new Uint8Array(await f.arrayBuffer())),
  );
  await runImg(frames);
});
imgSample.addEventListener("click", async () => {
  const frames = await Promise.all([
    makePngFrame("#e53935"),
    makePngFrame("#43a047"),
    makePngFrame("#1e88e5"),
  ]);
  await runImg(frames);
});

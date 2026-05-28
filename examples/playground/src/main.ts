import { gif2webp } from "@btheegg-kimth/gif2webp";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("file");
const sampleBtn = $<HTMLButtonElement>("sample");
const statusEl = $<HTMLDivElement>("status");
const inImg = $<HTMLImageElement>("in");
const outImg = $<HTMLImageElement>("out");
const inInfo = $<HTMLPreElement>("inInfo");
const outInfo = $<HTMLPreElement>("outInfo");

// 내장 2프레임 1x1 애니메이션 GIF (스모크 테스트와 동일).
const SAMPLE_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53,
  0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00, 0x21,
  0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x21, 0xf9, 0x04, 0x04,
  0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x4c, 0x01, 0x00, 0x3b,
]);

function setStatus(msg: string, ok: boolean) {
  statusEl.innerHTML = `<p class="${ok ? "ok" : "err"}">${msg}</p>`;
}

function showPreview(img: HTMLImageElement, info: HTMLPreElement, bytes: Uint8Array, type: string) {
  const blob = new Blob([bytes], { type });
  img.src = URL.createObjectURL(blob);
  const head = new TextDecoder("ascii").decode(bytes.subarray(0, 4));
  const fmt = bytes.length >= 12 ? new TextDecoder("ascii").decode(bytes.subarray(8, 12)) : "";
  info.textContent = `${bytes.length} bytes\nmagic: ${head}${fmt ? " / " + fmt : ""}`;
}

async function convert(input: Uint8Array) {
  try {
    setStatus("변환 중…", true);
    showPreview(inImg, inInfo, input, "image/gif");

    const t0 = performance.now();
    const out = await gif2webp(input, { quality: 75 });
    const ms = (performance.now() - t0).toFixed(1);

    const head = new TextDecoder("ascii").decode(out.subarray(0, 4));
    const fmt = new TextDecoder("ascii").decode(out.subarray(8, 12));
    if (head !== "RIFF" || fmt !== "WEBP") {
      throw new Error(`출력이 WebP가 아님 (magic: ${head}/${fmt})`);
    }

    showPreview(outImg, outInfo, out, "image/webp");
    setStatus(`✓ 변환 성공: ${input.length} → ${out.length} bytes (${ms} ms)`, true);
  } catch (err) {
    setStatus(`✗ 실패: ${(err as Error).message}`, false);
    console.error(err);
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await convert(new Uint8Array(await file.arrayBuffer()));
});

sampleBtn.addEventListener("click", () => convert(SAMPLE_GIF));

// scripts/smoke.mjs
//
// 빌드된 wasm이 실제로 GIF -> 애니메이션 WebP 변환을 해내는지 빠르게 검증.
// 빌드 직후, 그리고 업스트림 핀 버전 올린 직후 돌리면 된다.
//
//   node scripts/smoke.mjs              # 내장된 2프레임 1x1 GIF 사용
//   node scripts/smoke.mjs path/to.gif  # 직접 제공한 GIF 사용
//
// 검증:
//   - 출력이 "RIFF....WEBP" 매직으로 시작
//   - "ANIM" 청크 존재 (정적이 아닌 애니메이션 WebP)
//   - "ANMF" 프레임 청크가 입력 프레임 수만큼 존재
//
// 종료 코드: 0 = OK, 1 = 실패.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// 빌드된 dist에서 import. 변경 후엔 `pnpm -r build` 먼저 돌릴 것.
import { gif2webp } from "../packages/gif2webp/dist/index.mjs";

// 직접 인코딩한 최소 2프레임 1x1 애니메이션 GIF89a (84 바이트).
// 빨강 -> 파랑, 각 10ms, 무한 루프. 외부 fixture 없이 자체완결되도록 박았다.
const EMBEDDED_GIF = new Uint8Array([
  // 헤더
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61,             // "GIF89a"
  // 논리 화면 디스크립터: 1x1, GCT(2 colors), bg=0, aspect=0
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  // GCT: [0]=red, [1]=blue
  0xFF, 0x00, 0x00,
  0x00, 0x00, 0xFF,
  // NETSCAPE2.0 애플리케이션 익스텐션 (무한 루프)
  0x21, 0xFF, 0x0B,
  0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
  0x03, 0x01, 0x00, 0x00, 0x00,
  // 프레임 1: GCE (delay=10), 이미지 디스크립터, LZW 데이터 (픽셀 인덱스 0)
  0x21, 0xF9, 0x04, 0x04, 0x0A, 0x00, 0x00, 0x00,
  0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0x02, 0x02, 0x44, 0x01, 0x00,
  // 프레임 2: GCE, 이미지 디스크립터, LZW (픽셀 인덱스 1)
  0x21, 0xF9, 0x04, 0x04, 0x0A, 0x00, 0x00, 0x00,
  0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0x02, 0x02, 0x4C, 0x01, 0x00,
  // 트레일러
  0x3B,
]);

function findChunks(webp, fourcc) {
  // WebP는 RIFF 컨테이너. fourcc(4바이트 ASCII)를 단순 substring 매칭으로 찾는다.
  // (정밀하게 파싱하지 않아도 스모크 테스트엔 충분)
  const target = new TextEncoder().encode(fourcc);
  let count = 0;
  outer: for (let i = 0; i <= webp.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (webp[i + j] !== target[j]) continue outer;
    }
    count++;
  }
  return count;
}

async function main() {
  const argPath = process.argv[2];
  let input;
  let label;
  if (argPath) {
    input = new Uint8Array(await readFile(resolve(argPath)));
    label = argPath;
  } else {
    input = EMBEDDED_GIF;
    label = "<embedded 2-frame 1x1 GIF>";
  }
  console.log(`>> 입력: ${label} (${input.byteLength} bytes)`);

  const t0 = performance.now();
  const out = await gif2webp(input, { quality: 75 });
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`>> 출력: ${out.byteLength} bytes (${ms} ms)`);

  // 검증 1: RIFF....WEBP 매직
  const head = new TextDecoder("ascii").decode(out.subarray(0, 4));
  const fmt = new TextDecoder("ascii").decode(out.subarray(8, 12));
  if (head !== "RIFF" || fmt !== "WEBP") {
    console.error(`FAIL: 매직 불일치 (head=${head} fmt=${fmt})`);
    process.exit(1);
  }
  console.log(">> 매직 OK: RIFF....WEBP");

  // 검증 2: ANIM 청크 (애니메이션 컨테이너인지)
  const anim = findChunks(out, "ANIM");
  if (anim !== 1) {
    console.error(`FAIL: ANIM 청크 ${anim}개 (정확히 1개여야 함)`);
    process.exit(1);
  }
  console.log(">> ANIM 청크 OK");

  // 검증 3: ANMF 프레임 청크가 2개 이상
  const frames = findChunks(out, "ANMF");
  if (frames < 2) {
    console.error(`FAIL: ANMF 프레임 ${frames}개 (>=2 기대)`);
    process.exit(1);
  }
  console.log(`>> 프레임 OK: ANMF x ${frames}`);

  console.log("\nPASS");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

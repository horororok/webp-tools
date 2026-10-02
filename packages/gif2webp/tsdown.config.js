import { defineConfig } from "tsdown";

export default defineConfig({
  // worker: 워커에서 변환하는 gif2webp() (`/worker` export).
  // worker-entry: 워커 안에서 도는 스크립트. worker.ts가 `new URL("./worker-entry.mjs")`로
  //   가리키므로 파일 이름이 고정돼야 한다.
  entry: ["src/index.ts", "src/worker.ts", "src/worker-entry.ts"],
  format: "esm",
  dts: true,
  clean: true,
  // emscripten glue(.mjs)와 바이너리(.wasm)는 wasm/에서 그대로 배포한다.
  // tsdown(Rolldown)에게 이 모듈들은 번들에 인라인하지 말고 외부 참조로 두라고 지시.
  deps: {
    neverBundle: [/\.mjs$/, /\.wasm$/],
  },
});

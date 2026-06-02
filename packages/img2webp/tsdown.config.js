import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  clean: true,
  // emscripten glue(.mjs)와 바이너리(.wasm)는 wasm/에서 그대로 배포한다.
  // tsdown(Rolldown)에게 이 모듈들은 번들에 인라인하지 말고 외부 참조로 두라고 지시.
  deps: {
    neverBundle: [/\.mjs$/, /\.wasm$/],
  },
});

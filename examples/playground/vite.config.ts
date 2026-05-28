import { defineConfig } from "vite";

export default defineConfig({
  // gif2webp의 dist/index.mjs는 ../wasm/gif2webp.mjs(600KB base64 인라인)를
  // dynamic import한다. Vite의 의존성 pre-bundle(esbuild)이 이걸 미리 삼키려다
  // 깨질 수 있어 제외. 소비자도 동일 설정이 필요할 수 있어 여기서 검증.
  optimizeDeps: {
    exclude: ["@btheegg-kimth/gif2webp"],
  },
});

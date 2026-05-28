import { defineConfig } from "vite";

// 특별한 설정 불필요. 라이브러리가 ENVIRONMENT=web,worker(node 제외) + SINGLE_FILE로
// 빌드돼서 소비자는 optimizeDeps.exclude 같은 우회 없이 그냥 import하면 됨.
// (node를 넣으면 import("module")이 박혀 "Module externalized" 경고가 나고 exclude를
//  강요받음 — 그래서 뺐다. build/build.sh 참고.)
export default defineConfig({});

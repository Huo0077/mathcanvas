import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/"
      }
    },
    setupFiles: ["./test-setup.ts"],
    globals: true,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx", "scripts/**/*.test.ts"],
    /**
     * **Lean 的真实端到端单独跑**（2026-10-12，用户裁决）。
     *
     * `scripts/proof-spike/lean4EndToEnd.test.ts` 在本机装了 Lean、mathlib 也展开过时会**真的**去跑
     * `lake env lean`：一个文件约 7 分钟（冷启动预热 ~2.5 分钟 + 四条判据各 ~65 s）。它待在默认全量里
     * 有两个代价，都是实测出来的：
     *
     * 1. **把同跑的用例挤死** —— `apps/web/src/persistence/fileExports.test.ts` 的 CAD 导出用例被 CPU
     *    饿到 vitest 默认的 5 s 超时（单跑 9/9 绿）。当时先给那条用例加了显式预算止血，**这里才是根因**；
     * 2. 日常 `npm test` 从 ~2.5 分钟涨到 ~12 分钟。
     *
     * 它与 `test:perf` 那种"慢一点但便宜、每次都该跑"的文件不同：**它依赖这台机器上有没有 Lean 与
     * 7.5 GB 的 olean**，所以本来就不该是"每次全量都跑"的东西。计划书 Task 19/21 的原文写的也正是
     * 「Lean 慢集成单列」。用具名脚本 `npm run test:lean` 单独跑（串行、`--maxWorkers=1`）。
     */
    // Live model evaluation has a separate, explicit entry point even when a key is present.
    exclude: [...configDefaults.exclude, "scripts/proof-spike/lean4EndToEnd.test.ts", "apps/web/src/agent/fixtures/examSolid30.eval.test.ts", "apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts"]
  }
})

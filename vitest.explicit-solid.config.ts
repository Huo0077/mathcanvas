import { configDefaults, defineConfig } from "vitest/config"

/**
 * **54 条明确球体 / 棱柱离线验收专用配置**（2026-11-01）。
 *
 * 只有显式入口 `npm run eval:explicit-solid -- --offline` 才跑它；常规 `npm test` 排除。
 * `node` 环境用于写每题目录与 `summary.json`，单 worker 保证题单顺序与报告可复现。
 */
export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 1,
    fileParallelism: false,
    include: ["apps/web/src/agent/fixtures/explicitSolidAcceptance.eval.test.ts"],
    exclude: [...configDefaults.exclude]
  }
})

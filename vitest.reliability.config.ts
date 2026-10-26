import { configDefaults, defineConfig } from "vitest/config"

/**
 * **`eval:reliability` 专用配置**（T01，2026-10-26）：只有显式入口才跑这个文件。
 *
 * `node` 环境（要写报告文件）、单 worker（报告目录与预算都要可复现）。
 * 常规 `npm test` 的 include 里虽然有它，但默认配置的 exclude 明确排除了它（与 solid eval 同一条纪律）。
 */
export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 1,
    fileParallelism: false,
    include: ["apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts"],
    exclude: [...configDefaults.exclude]
  }
})

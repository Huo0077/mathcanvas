import { configDefaults, defineConfig } from "vitest/config"

import base from "./vitest.config"

/**
 * **只跑 Lean 真集成的那一份配置**（2026-10-12，用户裁决"单列"）。
 *
 * 主配置 `vitest.config.ts` 把 `scripts/proof-spike/lean4EndToEnd.test.ts` 排除在默认全量之外
 * （为什么、代价多大，写在那边），这一份只把**文件集**换回它一个。
 *
 * **环境设置与 `setupFiles` 直接复用主配置**，不在这里重写一遍 —— 两份配置各写一份环境设置，
 * 日后一定漂移（这正是本仓 `capability-tables` 那条判据存在的理由）。
 *
 * 用法：`npm run test:lean`（串行，`--maxWorkers=1`）。
 */
export default defineConfig({
  test: {
    // 主配置的形状是对象（不是函数），运行时取它的 `test` 段即可。
    ...(base as { test?: Record<string, unknown> }).test,
    include: ["scripts/proof-spike/lean4EndToEnd.test.ts"],
    exclude: [...configDefaults.exclude]
  }
})

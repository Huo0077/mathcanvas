import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.mjs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    /**
     * **本地失败的 trace 必须留下来**（2026-10-06 修）。
     *
     * 原先是 `trace: "on-first-retry"`，而本地 `retries: 0` —— **两个凑在一起等于本地从不留 trace**：
     * 偶发红一次、重跑就绿，于是除了"它红过"之外什么都没有，只能靠猜。
     * （实测：连续两轮全量各有一条单条偶发，两次都没能查下去。）
     *
     * 改成本地 `retain-on-failure`：**这不掩盖失败**（retries 仍是 0，红就是红），
     * 只是让下一次红的时候手里有一份可看的现场。CI 保持 `on-first-retry` —— 那边有重试，
     * 对"第一次尝试"留证更省体积。
     */
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    ...devices["Desktop Chrome"]
  }
})

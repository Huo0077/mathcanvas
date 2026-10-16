import { expect, test } from "@playwright/test"

/**
 * **Task 18：证明那一栏在浏览器里的生命周期**。
 *
 * 计划原话：`e2e/agent-proof-lifecycle.spec.ts`（**浏览器降级**与设置入口）；
 * "浏览器只能验'不可用但不影响作图'"；**桌面真实开旗→一次 Lean→用户确认→改题/撤销
 * 必须另留实际 UI/IPC/版本证据，不以 mock 冒充**。
 *
 * 所以这条 spec 只主张两件事，而且都是浏览器里拿得到的：
 *
 * ① **这台机器上没有桌面工具链 ⇒ 那一栏如实说"没跑成"**，并把范围报告一起摆出来
 *   （这一次证的是哪一档、哪些题面条件没进命题）—— 这一条同时是 Task 17 的分级
 *   到达界面的读数；
 * ② **它不挡作图**：证明不可用时，"确认并提交"照样可点、而且真的提交成功。
 *   开关关着时那一栏**根本不存在**，同一张图同样提交得掉。
 *
 * 浏览器还覆盖确认 → 一次撤销 → 历史结果过期。真实 Lean 接受与版本绑定
 * 另由 Windows 原生 UIAutomation 桌面实测留证，不以浏览器降级结果冒充。
 */

/** 同一只四棱锥，外加一句可形式化的目标（`PA ⊥ BD` 走性质定理那一类）。 */
const PROOF_GOAL = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥，求证 PA ⊥ BD"

async function openSettingsFlag(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name }).click()
  await expect(page.getByRole("switch", { name })).toBeChecked()
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("browser has no proof backend: the section says so, shows the scope, and still lets the figure through", async ({ page }) => {
  await openSettingsFlag(page, "形式证明导出")
  await send(page, PROOF_GOAL)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })

  const proof = panel.getByRole("region", { name: "形式证明" })
  await expect(proof).toBeVisible()
  // ① 如实说"这台机器上跑不了"，而不是"证不出来"、更不是"已验证"。
  await expect(proof).toHaveAttribute("data-outcome", "toolchain_unavailable")
  await expect(proof).toContainText("没跑成")
  await expect(proof).not.toContainText("已验证")
  // ② 范围报告也在（Task 17）：这一档是受限引理，并列出**没进命题的题面条件**。
  await expect(proof).toHaveAttribute("data-proof-scope", "limited_lemma")
  await expect(proof).toContainText("只证了模板那一条受限引理")
  await expect(proof).toContainText("没进命题的题面条件")
  await expect(proof).toContainText("BC ∥ AD")
  // ③ 过期标记为空（这是**这一轮**刚跑出来的读数）。
  await expect(proof).toHaveAttribute("data-proof-stale", "")

  // ④ **证明不可用不挡作图**：确认按钮在，点了真的提交。
  const confirm = panel.getByRole("button", { name: "确认并提交" })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByText("已提交").last()).toBeVisible()

  await page.getByRole("button", { name: "返回画布" }).click()
  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  const historicalProof = page.getByRole("region", { name: "形式证明" }).last()
  await expect(historicalProof).toHaveAttribute("data-outcome", "stale")
  await expect(historicalProof).toContainText("当前画布")
  await page.screenshot({ path: "test-results/task18-proof-degrade.png" })
})

test("with the flag off there is no proof section at all, and the figure still goes through", async ({ page }) => {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await send(page, PROOF_GOAL)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  // 那一栏**根本不存在**（不是显示一句"已关闭"）——与 `next-phase-flag-entry` 同一条口径。
  await expect(panel.getByRole("region", { name: "形式证明" })).toHaveCount(0)

  const confirm = panel.getByRole("button", { name: "确认并提交" })
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByText("已提交").last()).toBeVisible()
})

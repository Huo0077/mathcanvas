import { expect, test } from "@playwright/test"

/**
 * **矩形沿对角线折起的浏览器闭环**（A3 / T08，2026-10-26）。
 *
 * 走产品里真实的那条路径：本地确定性规划器（`RECTANGLE_FOLD` 通用族意图，**不逐字匹配原题**）
 * → 协调器 → 编译器（折前坐标来自计划、折后坐标由内核旋转算）→ 隔离草稿 → 确认 → 提交 → 一步撤销。
 *
 * 三条终态各一条用例：
 * 1. 题设完整 + 长度目标 ⇒ 预览/确认/撤销（确认前主文档不变）；
 * 2. 目标 `BD⊥AC` 在题设下不成立 ⇒ 澄清说明不成立，**没有**可提交草稿；
 * 3. 只说了折起、没给折角也没给两平面垂直 ⇒ 澄清问折角，**不默认 90°**。
 *
 * 这一条**不是**模型质量证据：没有 provider，走的是本地确定性构造。
 */
const COMPLETE = "矩形 ABCD 中，AB=4，BC=2，AB⊥BC，BD=2√5，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。求折后 BD 的长。"
const FALSE_GOAL = "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。（1）求证 BD⊥AC；（2）求折后 BD 的长。"
const NO_ANGLE = "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起。求折后 BD 的长。"

function objectRows(page: import("@playwright/test").Page) {
  // 3D 画布是 WebGL（没有 DOM 图元），对象列表是唯一稳定可断言的抓手。
  return page.locator(".algebra-panel .object-row")
}

async function send(page: import("@playwright/test").Page, prompt: string) {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

test("矩形沿对角线折起：隔离预览 → 一次提交 → 一步撤销", async ({ page }) => {
  await send(page, COMPLETE)

  // 1) 编译 + 题设核验通过，停在等待确认：草稿隔离，主文档还没变。
  const status = page.getByRole("region", { name: "运行状态" })
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).toHaveText("等待你确认", { timeout: 90_000 })

  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("只占一步撤销")

  // 确认前：画布上没有对象（草稿没有写进主文档）。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  // 2) 确认 → 真的落盘。
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()

  // 3) 回到画布：折后图形真的画出来了。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
  await expect.poll(() => objectRows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
  await page.screenshot({ path: "test-results/rectangle-fold-preview.png" })

  // 4) 一步撤销回到原样。
  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})

test("目标 BD⊥AC 在题设下不成立 ⇒ 说明不成立，不生成可提交草稿", async ({ page }) => {
  await send(page, FALSE_GOAL)

  // 澄清走 `needs_more_information`：正文由题面回代算出来，必须说"不成立"，并给得出距离。
  const alert = page.getByRole("alert")
  await expect(alert.getByText(/不成立/)).toBeVisible({ timeout: 90_000 })
  await expect(alert.getByText(/BD/).first()).toBeVisible()
  // 没有确认面板、也没有"确认并提交"按钮 —— 假目标不许变成可提交草稿。
  await expect(page.getByRole("region", { name: "确认改动" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
})

test("缺折角也没有两平面垂直 ⇒ 问折角，不默认 90°", async ({ page }) => {
  await send(page, NO_ANGLE)

  await expect(page.getByRole("alert").getByText(/折角/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole("region", { name: "确认改动" })).toHaveCount(0)
})

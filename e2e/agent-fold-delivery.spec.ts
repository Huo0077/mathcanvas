import { expect, test } from "@playwright/test"

/**
 * **W4 / T4：折叠题的交付在浏览器里看得见。**
 *
 * 两条用例都走离线本地规划器（不调模型）：合并问折前/折后必须交出两个长度；
 * 对角线矛盾必须说出"矛盾"，而不是继续给一个数值。
 */
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()) })

async function ask(page: import("@playwright/test").Page, prompt: string) {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
  return page.getByRole("region", { name: "答案交付" }).last()
}

test("a merged pre/post fold question delivers both lengths", async ({ page }) => {
  const card = await ask(page, "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。分别求折前和折后 BD 的长。")

  await expect(card).toBeVisible()
  await expect(card.locator(".agent-answer-status")).toHaveText("已交付")
  await expect(card).toContainText("2√5")
  await expect(card).toContainText("2√85/5")
  // 没有核验器时仍然是"未核验"：交付 ≠ 证明。
  await expect(card).toContainText("未核验")
  // W9：两个长度都交付了也不允许显示"已核验"。
  await expect(card).not.toHaveAttribute("data-delivery-badge", "verified")
})

test("a contradictory diagonal is reported instead of silently answered", async ({ page }) => {
  const card = await ask(page, "矩形 ABCD 中，AB=4，BC=2，AC=6，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。求折后 BD 的长。")

  await expect(card).toBeVisible()
  await expect(card).toContainText("矛盾")
  await expect(card).toContainText("AC=6")
  await expect(card).not.toContainText("已证明")
})

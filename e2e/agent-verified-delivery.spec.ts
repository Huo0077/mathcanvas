import { expect, test } from "@playwright/test"

/**
 * **W9：交付徽标只认宿主证据（浏览器验收）**。
 *
 * 三条用例都走离线本地规划器（不调模型、不发网络请求）。它们钉的是
 * "没有核验器时不冒充已核验"以及"两问不能因为有一问有答案就整题变绿"：
 *
 * ① 只读回答：状态是已交付，但徽标必须是未核验，逐问也标未核验；
 * ② 合并问的折叠题（两问）：两行答案都在，徽标**不得**是 verified；
 * ③ 缺条件的题：徽标是未核验而不是失败，且不出现"已核验（逐问）"。
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

test("a delivered answer without host evidence is badged unverified", async ({ page }) => {
  const card = await ask(page, "有什么")

  await expect(card).toBeVisible()
  await expect(card.locator(".agent-answer-status")).toHaveText("已交付")
  await expect(card).toHaveAttribute("data-delivery-badge", "unverified")
  await expect(card.locator(".agent-answer-delivery")).toHaveText("未核验")
  await expect(card.locator(".agent-answer-row").first()).toHaveAttribute("data-goal-verification", "unverified")
  await expect(card).not.toContainText("已核验（逐问）")
})

test("a two-part fold answer never turns green just because both lengths were delivered", async ({ page }) => {
  const card = await ask(page, "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。分别求折前和折后 BD 的长。")

  await expect(card).toBeVisible()
  // 默认灰度下这条回答走旧信封（一段正文），所以只有一行；关键判据是**徽标**：
  // 两个长度都交付了也不能显示"已核验"。
  await expect(card.locator(".agent-answer-row").first()).toBeVisible()
  await expect(card).toContainText("2√5")
  await expect(card).toContainText("2√85/5")
  const badge = await card.getAttribute("data-delivery-badge")
  expect(badge).not.toBe("verified")
  await expect(card).not.toContainText("已核验（逐问）")
})

test("a missing condition keeps the unverified badge instead of claiming verification", async ({ page }) => {
  const card = await ask(page, "矩形 ABCD 中，AB=4，BC=2。沿 AC 将三角形 ABC 折起，求 BD 的长。")

  await expect(card).toBeVisible()
  await expect(card.locator(".agent-answer-status")).toHaveText("需要补充信息")
  await expect(card).toHaveAttribute("data-delivery-badge", "unverified")
  await expect(card).not.toContainText("已核验（逐问）")
})

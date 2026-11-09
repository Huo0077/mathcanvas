import { expect, test } from "@playwright/test"

/**
 * **W2 / T2：浏览器里能分辨"交付了什么、验过什么、还缺什么"。**
 *
 * 两条用例都走**离线本地规划器**（不调模型、不发网络请求）：
 * ① 只读回答：必须有交付状态与"未核验"，且不出现"已证明"；
 * ② 缺条件的折叠题：必须显示"需要补充信息"与具体问题，不许显示"已交付"。
 *
 * 这不是真实模型的正确率验收 —— 它只证明"交付语义真的到了界面"。
 */
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()) })

test("a read-only answer shows its delivery status and that it is unverified", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill("有什么")
  await page.getByRole("button", { name: "发送" }).click()

  const card = page.getByRole("region", { name: "答案交付" }).last()
  await expect(card).toBeVisible()
  await expect(card.locator(".agent-answer-status")).toHaveText("已交付")
  await expect(card.locator(".agent-answer-index")).toHaveText("第1问")
  // 没有核验器就没有证据：界面上必须说"未核验"，且不许冒充证明。
  await expect(card).toContainText("未核验")
  // W9：徽标同样只认宿主证据。
  await expect(card).toHaveAttribute("data-delivery-badge", "unverified")
  await expect(card).not.toContainText("已证明")
})

test("a fold question without the fold angle asks for the missing condition instead of claiming an answer", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill("矩形 ABCD 中，AB=4，BC=2。沿 AC 将三角形 ABC 折起，求 BD 的长。")
  await page.getByRole("button", { name: "发送" }).click()

  const card = page.getByRole("region", { name: "答案交付" }).last()
  await expect(card).toBeVisible()
  await expect(card.locator(".agent-answer-status")).toHaveText("需要补充信息")
  await expect(card.locator(".agent-answer-questions li")).toHaveCount(1)
  // W9：缺条件不是"核验通过"，也不是"失败"——徽标保持未核验。
  await expect(card).toHaveAttribute("data-delivery-badge", "unverified")
  await expect(card).not.toContainText("已交付")
})

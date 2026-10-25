import { expect, test } from "@playwright/test"

// The local planner supplies only the quad. No angles or folded points are fixtures.
test("jointly solves two missing fold angles before preview, commit and undo", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(
    "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。" +
    "点E在AD上，且AE=2/5 AD；点F在AB上，且AF=1/2 AB。" +
    "先将三角形AEF沿EF翻折至三角形PEF，再将三角形PEF沿PF折叠至三角形QPF。" +
    "使QB=5.982610851975，QC=7.185772613248。"
  )
  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByRole("region", { name: "运行状态" }).locator(".agent-run-state"))
    .toHaveText("等待你确认", { timeout: 90_000 })
  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible({ timeout: 90_000 })
  await expect(draft).toContainText("同时数值求解2个未知折角")
  await expect(draft).toContainText("不保证枚举全部解")
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBeGreaterThan(0)
  await page.keyboard.press("Control+z")
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBe(0)
})

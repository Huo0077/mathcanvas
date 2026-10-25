import { expect, test } from "@playwright/test"

// 用户原题原样输入：`AD=AB=2CD=2` 必须被读全，预览 → 确认 → 提交 → 一步撤销走通。
test("reads the chained lengths, previews, commits and undoes in one step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(
    "四棱锥 P-ABCD 中，平面 PAD ⊥ 平面 ABCD，AB∥CD，AB⊥AD，M 为 AD 中点，PA=PD=√5，AD=AB=2CD=2。" +
    "（1）求证：平面 PMB ⊥ 平面 PAC； （2）求二面角 A-PC-D 的余弦值。"
  )
  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByRole("region", { name: "运行状态" }).locator(".agent-run-state"))
    .toHaveText("等待你确认", { timeout: 90_000 })
  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible({ timeout: 90_000 })
  // 没有"未核验"的条件：`AD=AB=2CD=2` 若读残，这里会重新出现"未核验"字样的阻断。
  await expect(draft).toContainText("通过 12 / 失败 0 / 未核验 0")
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBeGreaterThan(0)
  // 一次提交 = 一步撤销回到原样。
  await page.keyboard.press("Control+z")
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBe(0)
})

import { expect, test } from "@playwright/test"

const FREE_APEX = "在三棱锥D-ABC中，AD⊥平面ABC，自由点D，画示意图"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
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

test("when enabled, a free-height tetrahedral diagram has real scene objects, verified premises, confirmation and one-step undo", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, FREE_APEX)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  await expect(check).toContainText("AD⊥平面ABC")
  await expect(check).toContainText("自由点 D")
  await expect(check).toContainText("不是普遍证明")
  await expect(panel.locator(".agent-assumptions")).toContainText("系统自选")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBeGreaterThan(0)
  await page.keyboard.press("Control+z")
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBe(0)
})

test("when disabled, the same previously unsupported prompt does not create a point or a draft", async ({ page }) => {
  await openAgent(page)
  await send(page, FREE_APEX)
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
})

test("the experimental route does not silently discard an unsupported above-the-base condition", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, "在三棱锥D-ABC中，AD⊥平面ABC，D在底面ABC上方，画示意图")
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
})

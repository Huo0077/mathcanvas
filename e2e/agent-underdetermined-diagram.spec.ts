import { expect, test } from "@playwright/test"

import { PYRAMID_PROMPT, PYRAMID_UNVERIFIED_PROMPT } from "../apps/web/src/agent/representativeFixtures"

/** Offline planner recognises this exact representative sentence; other conditions require a real provider. */
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()) })

test("an underdetermined pyramid is verified, presented as an example, confirmed and undone", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(PYRAMID_PROMPT)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const verification = panel.getByRole("region", { name: "题设核验" })
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("通过 3 / 失败 0 / 未核验 0")
  await expect(verification).toContainText("一组示意图")
  await expect(verification).toContainText("不是普遍证明")
  await expect(panel.locator(".agent-assumptions")).toContainText("示例值")
  await expect(panel).not.toContainText("唯一图形")

  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBeGreaterThan(0)
  await page.keyboard.press("Control+z")
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBe(0)
})
test("an additional unsupported condition is visible and cannot be committed", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(PYRAMID_UNVERIFIED_PROMPT)
  await page.getByRole("button", { name: "发送" }).click()

  const status = page.getByRole("region", { name: "运行状态" }).last()
  await expect(status.locator(".agent-run-state")).toHaveText("没有完成")
  await expect(status).toContainText("题设尚未核验")
  await expect(status).toContainText("sin∠PAB=0.5")
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
})
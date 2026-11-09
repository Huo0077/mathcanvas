import { expect, test } from "@playwright/test"
import { commandButton } from "./command-menu"

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.clear()) })

test("Agent accepts text, shows no image reader, and keeps the answer unverified", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await expect(page.getByRole("textbox", { name: "对话输入" })).toBeVisible()
  await expect(page.getByRole("button", { name: "图片识题" })).toHaveCount(0)
  await expect(page.getByLabel("选择题图文件")).toHaveCount(0)
  await page.getByRole("textbox", { name: "对话输入" }).fill("有什么")
  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByRole("region", { name: "答案交付" }).last()).toContainText("未核验")
})
test("text command opens Agent without exposing a picture command", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await (await commandButton(page, "文字解题")).click()
  await expect(page.getByRole("textbox", { name: "对话输入" })).toBeVisible()
  await expect(page.getByRole("button", { name: "图片识题" })).toHaveCount(0)
})
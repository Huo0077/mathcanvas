import { expect, test } from "@playwright/test"

/**
 * 顶级模块骨架（模块 A 传统工作区 / 模块 B Agent 工作区）。
 *
 * 用户口径：「将应用主界面拆分为两个顶级模块（请提供清晰的导航切换逻辑，例如左侧边栏菜单）」，
 * 模块 B「界面干净清爽，视觉焦点是一个位于页面中央的对话输入框，支持多行输入；上方预留对话结果
 * 和代码输出的展示区」。这一份用例守住两件事：
 * 1. 两个板块的**边界**——谁在什么时候渲染，切换之后另一块彻底不在 DOM 里；
 * 2. Agent 区的**骨架**仍然成立——输入框居中、多行、能把代码块单独显示出来。
 */
test("switches between the canvas module and the agent module from the left rail", async ({ page }) => {
  await page.goto("/")

  // 默认落在模块 A：画布在、Ribbon 在、Agent 的输入框不在。
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
  await expect(page.getByRole("button", { name: "传统工作区" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  await expect(page.getByRole("region", { name: "功能区" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "对话输入" })).toHaveCount(0)

  // 切到模块 B：Ribbon 与画布整块退场，只留 Agent 的三段式骨架。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "agent")
  await expect(page.getByRole("button", { name: "Agent 工作区" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("region", { name: "功能区" })).toHaveCount(0)
  await expect(page.getByRole("img", { name: "几何画布" })).toHaveCount(0)

  const composer = page.getByRole("textbox", { name: "对话输入" })
  await expect(composer).toBeVisible()
  await expect(page.getByRole("log", { name: "对话记录" })).toContainText("发送第一条指令后")

  // 输入框是**多行**的：Shift + Enter 应该在框里换行，而不是把半句话发出去。
  await composer.click()
  await composer.pressSequentially("画一个正方体")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("并求体积")
  await expect(composer).toHaveValue("画一个正方体\n并求体积")
  await expect(page.getByRole("log", { name: "对话记录" }).locator("[data-message-role]")).toHaveCount(0)

  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByRole("log", { name: "对话记录" }).locator("[data-message-role='user']")).toHaveCount(1)
  // 展示区拿到回复之后，代码块应该单独成栏（`data-code-language` 是它的抓手）。
  await expect(page.getByRole("log", { name: "对话记录" }).locator("[data-code-language='ts']")).toHaveCount(1)
  await expect(composer).toHaveValue("")

  // 回到模块 A：几何内容一点没丢，画布照旧可用。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  await page.getByRole("button", { name: "添加点" }).click()
  await expect(page.getByRole("img", { name: "几何画布" }).locator('[data-primitive-type="point"]')).not.toHaveCount(0)
})

test("keeps the agent conversation while switching modules back and forth", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("button", { name: "Agent 工作区" }).click()
  const composer = page.getByRole("textbox", { name: "对话输入" })
  await composer.click()
  await composer.pressSequentially("保留这段对话")
  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByRole("log", { name: "对话记录" })).toContainText("保留这段对话")

  await page.getByRole("button", { name: "返回画布" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  // 侧栏里那条对话还在，而且就是刚才那条（标题由第一条指令生成）。
  await expect(page.getByRole("button", { name: /^保留这段对话/ })).toBeVisible()
  await expect(page.getByRole("log", { name: "对话记录" })).toContainText("保留这段对话")
})

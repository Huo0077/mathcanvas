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
  /**
   * **这里以前断言的是演示回复里的代码块**（`[data-code-language='ts']`）。
   * 演示回复已从生产路径删除，所以断言改成"运行真的发生了"：
   * 一条真实运行会把阶段写进运行状态卡 —— 那是演示回复**做不到**的事。
   *
   * 用 `clarification` 的那条路径（本地规划器认不出这句话）会走到 `waiting`，
   * 于是状态卡显示"需要你补充信息"，并且**不产生任何草稿**。
   */
  const status = page.getByRole("region", { name: "运行状态" })
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).not.toBeEmpty()
  // 无论走到哪一步，都不该出现"已提交"——用户没有确认过任何东西。
  await expect(page.getByText("已提交")).toHaveCount(0)
  // 也不该留下一个永远转圈的"进行中"。
  await expect(status.locator(".agent-run-state")).not.toHaveText("进行中")
  await expect(composer).toHaveValue("")

  // 回到模块 A：几何内容一点没丢，画布照旧可用。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  /**
   * **这里以前点的是「添加点」**（平面几何的命令）。
   *
   * 现在不能这么断言了：这句话是"画一个正方体"，而**运行会在编译前把工作区切到立体几何**
   *（否则编译器会以 `workspace_mismatch` 拒绝这个动作）。所以回到画布时已经在立体几何工作区，
   * 「添加点」这个平面命令根本不在那儿 —— 这不是回归，是这条用例的前提被产品行为改变了。
   *
   * 改法：不再依赖"能点添加点"，而是断言**画布仍然可用**（3D 工作区的命令在）。
   */
  await expect(page.getByRole("button", { name: "添加空间点" })).toBeVisible()
  await page.getByRole("button", { name: "添加空间点" }).click()
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBeGreaterThan(0)
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

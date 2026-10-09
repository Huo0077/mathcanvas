import { expect, test } from "@playwright/test"

/**
 * **S6.3 浏览器反例：认不出来就问路 —— 不产草稿、不占撤销历史、不改文档。**
 *
 * 设计 §6 那条纪律是"**认不出一律问路，绝不悄悄改文档**"。正例那一侧已经有三个 spec
 * （`agent-solid-family-path` / `agent-prism-path` / `agent-derived-sphere`），但**"认不出"这一侧**
 * 在浏览器里只有一条：`agent-solid-family-path.spec.ts` 里"实验开关关着 ⇒ 同一句台体题面不产草稿"。
 * 那条验的是**开关**，不是**读不懂**。S6 的出口明写"认得出与认不出两类反例齐全"，所以这里补上
 * 读不懂的三类：**分析题 / 非立体题 / 说法与形状对不上**。
 *
 * ## 判据为什么是这四条
 *
 * - **没有草稿**：确认面板不出现（"确认并提交"按钮不存在）——问路不是"先画一张再说"。
 * - **问路要有话说**：运行状态卡必须落定（不是永远转的"进行中"）且对用户说了些什么。
 *   这里**不钉具体措辞**：那句话由规划器给，钉死文案会造出"一改措辞就红"的假门禁。
 * - **文档逐字未变**：直接读草稿键 `mathcanvas:draft:geometry3d`，前后**同一个值**。
 * - **不占撤销历史**：回画布后对象列表为空、且「撤销」按钮仍是禁用 ——
 *   "画布上没东西"与"画了又被撤掉"看起来一样，只有撤销栈能区分（本仓一贯口径）。
 */

const UNREADABLE = [
  { label: "分析题（问读数）", prompt: "这个四棱台的体积是多少" },
  { label: "非立体题（函数图像）", prompt: "画出 y = x³ − 3x 的图像" },
  { label: "说法对不上（数词与环长不一致）", prompt: "在四棱柱ABC-A′B′C′中，AA′⊥平面ABC" }
] as const

const DRAFT_KEY = "mathcanvas:draft:geometry3d"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

const draft = (page: import("@playwright/test").Page): Promise<string | null> =>
  page.evaluate((key) => window.localStorage.getItem(key), DRAFT_KEY)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

for (const { label, prompt } of UNREADABLE) {
  test(`asks the user instead of drawing anything: ${label}`, async ({ page }) => {
    await openAgent(page)
    const before = await draft(page)

    await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
    await page.getByRole("button", { name: "发送" }).click()

    // ① 没有草稿：确认面板（"确认并提交"）不出现。
    await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)

    // ② 运行落定，并且对用户说了点什么（问路，而不是永远转圈或一段编造的回答）。
    const status = page.getByRole("region", { name: "运行状态" }).last()
    await expect(status).toBeVisible()
    await expect(status.locator(".agent-run-state")).not.toHaveText("进行中")
    await expect(status.locator(".agent-run-state")).not.toHaveText("已提交")
    await expect(status).not.toBeEmpty()

    // ③ 文档逐字未变：草稿键前后同一个值。
    expect(await draft(page)).toBe(before)

    // ④ 不占撤销历史，画布上也没有东西。
    await page.getByRole("button", { name: "返回画布" }).click()
    await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled()
  })
}

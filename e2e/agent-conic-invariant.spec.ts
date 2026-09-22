import { expect, test } from "@playwright/test"

import { CONIC_INVARIANT_PROMPT } from "../apps/web/src/agent/representativeFixtures"

/**
 * **代表题二：椭圆切线的不变量**（Agent DSL 切片 Task 6；规格 §8.2）。
 *
 * 这道题验收的是两件**不能靠数值假装**的事：
 * 1. **符号参数 θ 被保留**：P 由参数 θ 驱动，而不是被特值化成某一点 ——
 *    否则这道"任意点处"的题就变成了"我试了一个角度"；
 * 2. **数值采样必须与形式证明分开说**：确认面板上那句"不是形式证明"是用户
 *    判断这条结论有多硬的全部依据（规格 §10 明令不许把采样说成证明）。
 *
 * 规划器是确定性本地规划器（浏览器里没有模型服务），计划夹具见
 * `apps/web/src/agent/representativeFixtures.ts`；两者与模型给出的计划走同一条下游。
 */
async function sendPrompt(page: import("@playwright/test").Page, prompt: string) {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

function objectRows(page: import("@playwright/test").Page) {
  return page.locator(".algebra-panel .object-row")
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test("keeps the symbolic parameter, labels the invariant as numeric sampling, and waits for the user", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, CONIC_INVARIANT_PROMPT)

  const draft = page.getByRole("region", { name: "确认改动" }).last()
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("确认之后会发生什么")

  // 1) **数值采样 ≠ 形式证明**：这句必须看得见。
  await expect(draft.locator(".agent-assumptions")).toContainText("不是形式证明")
  // 2) θ 是符号参数（这一条由计划夹具声明，界面上以假设的形式出现）。
  await expect(draft.locator(".agent-assumptions")).toContainText("符号参数")

  // 3) 确认之前真文档不变。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)

  // 4) 确认 → 椭圆 / 动点 / 切线真的落进文档（工作区被切到圆锥曲线）。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => objectRows(page).count()).toBeGreaterThan(2)

  // 5) 整批一步撤销。
  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})

test("refuses to touch the document when the user discards the draft", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, CONIC_INVARIANT_PROMPT)

  const draft = page.getByRole("region", { name: "确认改动" }).last()
  await expect(draft).toBeVisible()
  await draft.getByRole("button", { name: "丢弃草稿" }).click()

  await expect(page.getByText("已提交")).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)
})

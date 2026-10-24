import { expect, test } from "@playwright/test"

/**
 * **两次顺序折叠的浏览器闭环**（T6，2026-10-24）。
 *
 * 与 `agent-fold-preview.spec.ts` 同一条路径，但题面里有两折：第二次折的是**第一次折后**的
 * △PEF（折痕 PF）。夹具只给四边形，折痕端点与两笔 `solid.fold` 全由 `planCompiler` 的
 * 连续折叠构造按题面的**明确折角**（90° / 60°）生成。
 *
 * ## 边界
 *
 * 这条证明"两折链路能编译、预览、确认、提交、撤销"，**不是**模型质量评测：
 * 题面命中的是本地规划器的固定入口（`userFoldChainPlan`）。
 */
const CHAIN_PROMPT = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE=2/5 AD；点F在AB上，且AF=1/2 AB。",
  "先将三角形AEF沿EF翻折90°至三角形PEF，再将三角形PEF沿PF折叠60°至三角形QPF。"
].join("")

function objectRows(page: import("@playwright/test").Page) {
  return page.locator(".algebra-panel .object-row")
}

test("constructs two sequential folds, previews them, commits and undoes in one step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(CHAIN_PROMPT)
  await page.getByRole("button", { name: "发送" }).click()

  // 1) 两折都构造出来之后才可能通过核验并停在"等待确认"。
  const status = page.getByRole("region", { name: "运行状态" })
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).toHaveText("等待你确认", { timeout: 90_000 })

  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("只占一步撤销")
  // 确认之前画布仍是空的（草稿隔离）。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  // 2) 确认 → 落盘。
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()

  // 3) 画布出现折后图形（工作区切到立体几何）。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
  await expect.poll(() => objectRows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
  await page.screenshot({ path: "test-results/fold-chain-preview.png" })

  // 4) 一步撤销回到原样。
  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})

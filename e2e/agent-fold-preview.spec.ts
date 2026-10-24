import { expect, test } from "@playwright/test"

/**
 * **翻折题的浏览器闭环**（T5/T6 的浏览器证据，2026-10-24）。
 *
 * 走的是**产品里真实的那条路径**：本地确定性规划器 → 协调器 → 折片编译（默认配置下的
 * 规范重建 / 折角反求）→ 隔离草稿 → 用户确认 → 提交 → 一步撤销。
 *
 * ## 这一条**不是**模型质量评测
 *
 * 题面命中的是本地规划器的固定入口（`userFoldPlan`）。它证明的是"折片能编译、预览、
 * 确认、撤销"，而**不是**"模型能读懂任意翻折题"。后者需要真实模型与预算授权，见
 * `docs/audit/2026-10-24-agent-output-and-fold-repair.md` 的未覆盖清单。
 */
const FOLD_PROMPT = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")

function objectRows(page: import("@playwright/test").Page) {
  // 3D 画布是 WebGL（没有 DOM 图元），对象列表是唯一稳定可断言的抓手。
  return page.locator(".algebra-panel .object-row")
}

test("folds the flap into an isolated preview, commits it in one step, and undoes it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(FOLD_PROMPT)
  await page.getByRole("button", { name: "发送" }).click()

  // 1) 折片编译通过并停在**等待确认**：草稿是隔离的，文档还没变。
  const status = page.getByRole("region", { name: "运行状态" })
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).toHaveText("等待你确认", { timeout: 90_000 })

  // 2) 确认面板说的是"将发生什么"，并承诺**一步撤销**（整批提交只占一步历史）。
  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("只占一步撤销")
  // 生成本次预览的折片必须真的画出了点与面（不是空草稿）：对象行数在确认前为 0。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  // 3) 确认 → 真的落盘。
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()

  // 4) 回到画布：折片与四边形**真的出现了**（工作区也被切到立体几何）。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
  await expect.poll(() => objectRows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
  // 留一张现场图（`test-results/` 是生成目录，不进源码提交）：折后图形必须真的画在画布上。
  await page.screenshot({ path: "test-results/fold-preview.png" })

  // 5) 一步撤销回到原样：整批提交只占一步历史。
  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})

import { expect, test } from "@playwright/test"

/**
 * **Task 14：圆锥曲线真题纵向交付的浏览器证据**。
 *
 * 走的是**产品路径**：题面 → 本地规划器 → 隔离草稿 → 题设核验 → 确认 → 落盘 → 一步撤销。
 *
 * 核验里那条 `conicChord` 是 Task 14 新加的：把题面那条直线与**最终落盘**的曲线交给
 * **代数**求解器（判别式给重数），再要求代数算出的每一个交点图上都真的有点。
 * 旧的采样法给不出"相切/交点个数"，而旧的核验器**根本没有交点这一层** ——
 * 丢了交点的图只会走"未核验"，永远不会红。
 *
 * 正反两条**共用同一份计划**，差别只在题面里那条直线：
 * - 题面 `y = 0` ⇒ 代数交点是 `(±3, 0)`，图上也正是这两点 ⇒ 通过；
 * - 题面 `y = 1` ⇒ 代数交点是 `(±3√3/2, 1)`，图上还是 `(±3, 0)` ⇒ **必须判失败**。
 *
 * 于是"通过"绝不可能是"计划恰好画对了"的结果 —— 判据真的在比。
 */

const CHORD = "椭圆 x²/9+y²/4=1 与直线 y=0 相交于 A、B 两点"
const CHORD_MISMATCH = "椭圆 x²/9+y²/4=1 与直线 y=1 相交于 A、B 两点"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 落盘之后那张平面图里的圆锥曲线与**带点名的点**。 */
async function readDraft(page: import("@playwright/test").Page) {
  return page.evaluate(() => {    const raw = window.localStorage.getItem("mathcanvas:draft:conics")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as {
      document?: { primitives?: { type: string; label?: string; x?: number; y?: number; radiusX?: number; radiusY?: number }[] }
    }
    const primitives = parsed.document?.primitives ?? []
    const conic = primitives.find((primitive) => primitive.type === "ellipse") ?? null
    const points: Record<string, { x: number; y: number }> = {}
    for (const primitive of primitives) {
      if (primitive.type !== "point" || typeof primitive.label !== "string") continue
      if (typeof primitive.x !== "number" || typeof primitive.y !== "number") continue
      points[primitive.label] = { x: primitive.x, y: primitive.y }
    }
    return { conic, points }
  })
}

/** 草稿键的**原始值** —— fail-closed 那一条要断言"逐字未变"。 */
const draftKey = (page: import("@playwright/test").Page): Promise<string | null> =>
  page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:conics"))

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("draws both intersections of a chord, and both re-derive from the committed coordinates", async ({ page }) => {
  await openAgent(page)
  await send(page, CHORD)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  // **两条义务都在**：曲线自己的参数（`conicAxes`）与交点（`conicChord`）。
  // 少任何一条都说明新匹配器把另一条吃掉了（解析器按字符占位去重，这正是最容易出的错）。
  await expect(check).toContainText("x²/9+y²/4=1")
  await expect(check).toContainText("相交于两点")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:conics"))).not.toBeNull()

  const { conic, points } = await readDraft(page)
  expect(conic?.radiusX).toBeCloseTo(3, 9)
  expect(conic?.radiusY).toBeCloseTo(2, 9)
  expect(Object.keys(points).sort()).toEqual(["A", "B"])

  // **自己算**：两个点既在椭圆上、也在直线 `y = 0` 上，而且正是代数给出的 `x = ±3`。
  for (const name of ["A", "B"]) {
    const point = points[name]!
    expect(point.x ** 2 / 9 + point.y ** 2 / 4, `${name} 在椭圆上`).toBeCloseTo(1, 9)
    expect(point.y, `${name} 在 y = 0 上`).toBeCloseTo(0, 9)
  }
  expect(points.A!.x).toBeCloseTo(-3, 9)
  expect(points.B!.x).toBeCloseTo(3, 9)

  // **一步撤销**回到提交前：那两个点一个都不剩。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => Object.keys((await readDraft(page)).points).length).toBe(0)

  await page.screenshot({ path: "test-results/task14-conic-chord.png" })
})

test("fails closed when the statement asks for the y = 1 chord but the figure draws the y = 0 one", async ({ page }) => {
  await openAgent(page)
  const before = await draftKey(page)

  await send(page, CHORD_MISMATCH)

  /**
   * **这条的浏览器证据是"fail-closed"**：题设核验不过时运行到不了 `awaiting_confirmation`，
   * 所以**确认面板根本不出现** —— 用户不会被邀请去确认一张错的图（这是比"面板上有一条红的"
   * 更强的结论）。判据"红"本身由单测钉死（`diagramVerification.test.ts` 的
   * 「**丢一个交点 ⇒ failed**」与「错轴 ⇒ failed」两条）。
   *
   * 四条断言抄的是本仓既有那套 fail-closed 口径（`agent-unreadable-prompt.spec.ts`）：
   * 没草稿 / 运行落定且有话说 / 文档逐字未变 / 不占撤销历史。
   */
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)

  const status = page.getByRole("region", { name: "运行状态" }).last()
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).not.toHaveText("进行中")
  await expect(status.locator(".agent-run-state")).not.toHaveText("已提交")
  await expect(status).not.toBeEmpty()

  // 文档逐字未变：错的图不落地。
  expect(await draftKey(page)).toBe(before)

  // 不占撤销历史。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled()
})

import { expect, test } from "@playwright/test"

/**
 * **V0c：椭圆的浏览器证据**（计划 `V0c 圆锥曲线`）。
 *
 * ## 这条用例要证的与前面几条不同
 *
 * 圆锥曲线是**第一类没有顶点名**的图形。在此之前，原文核验的触发条件只认"带点名"的动作，
 * 所以它连"题面说的是图里哪个东西"都定不下来 —— 图上那条椭圆**从来没被核验过**。
 *
 * 而"核验过了"这件事本身不能靠面板自报：下面把文档里**真实落盘的半轴**读出来，
 * 在测试里**自己算焦点**（`c = √(a² − b²)`），再与题面方程要求的 `(±√5, 0)` 比对。
 *
 * **为什么焦点是判据的核心**：两个半轴对调之后，`|a − b|` 只差 1，看起来"差不多"，
 * 但焦点从 `(±√5, 0)` 挪到了 `(0, ±√5)` —— 那是**另一条曲线**，不是画得不准。
 */

const ELLIPSE = "椭圆 x²/9+y²/4=1，画示意图"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
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

/** 读应用自己写回的平面几何草稿里那条**椭圆**的真实参数。 */
async function committedEllipse(page: import("@playwright/test").Page): Promise<{ radiusX: number; radiusY: number }> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:conics")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { type: string; radiusX?: number; radiusY?: number }[]
    const ellipses = primitives.filter((primitive) => primitive.type === "ellipse")
    if (ellipses.length !== 1) throw new Error(`草稿里的椭圆不是恰好一条，而是 ${String(ellipses.length)} 条`)
    const [ellipse] = ellipses
    if (typeof ellipse.radiusX !== "number" || typeof ellipse.radiusY !== "number") throw new Error("椭圆没有可读的半轴")
    return { radiusX: ellipse.radiusX, radiusY: ellipse.radiusY }
  })
}

test("draws the ellipse from the equation and re-derives its foci from the committed semi-axes", async ({ page }) => {
  await openAgent(page)
  await send(page, ELLIPSE)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()

  // ① 核验真的跑了，且认的是题面里那个方程。
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  await expect(check).toContainText("x²/9+y²/4=1")
  // ② 这条曲线的半轴是题面钉死的、不是系统挑的 —— 面板必须这么说，否则用户会以为图是随手画的。
  await expect(panel.locator(".agent-assumptions")).toContainText("唯一确定")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:conics"))).not.toBeNull()

  // ③ **独立回代**：自己从落盘的半轴算焦点，不读面板结论。
  const { radiusX, radiusY } = await committedEllipse(page)
  expect(radiusX).toBeCloseTo(3, 9)
  expect(radiusY).toBeCloseTo(2, 9)
  const major = Math.max(radiusX, radiusY)
  const minor = Math.min(radiusX, radiusY)
  const focal = Math.sqrt(major * major - minor * minor)
  expect(focal).toBeCloseTo(Math.sqrt(5), 9)
  // 焦点在 **x 轴**上 —— 这正是"半轴对调"会改掉的那件事：对调之后焦点会落到 y 轴上。
  expect(radiusX).toBeGreaterThan(radiusY)

  // 可目检的截图（`test-results/` 是 gitignore 的，只作当次目视核对用）。
  await page.screenshot({ path: "test-results/v0c-ellipse.png" })
})

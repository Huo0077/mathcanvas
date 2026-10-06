import { expect, test } from "@playwright/test"

/**
 * **V0d：函数图像与切线同时画出来**（计划 `V0d 导数曲线` 的出口）。
 *
 * ## 这条用例要证两件事，而且都不许靠面板自报
 *
 * ① **曲线就是题面那条函数** —— 题面写 `x³−3x`，图元里存 `x^3-3*x`；
 * ② **切线真的是它在该点的切线** —— 斜率必须等于**测试自己算出来**的 `f′(1)`。
 *
 * 所以下面把草稿里真实落盘的表达式与切线读出来，在测试里**自己用中心差分求导**
 * 再比对。拿面板的结论去证明面板，等于没证。
 *
 * 对 `f(x) = x³ − 3x`：`f′(1) = 0`（水平切线）、`f′(2) = 9` ——
 * 判据若比的是编译器留的占位斜率 0，`x = 2` 那一档会立刻露馅（单测里已经这么钉过）。
 */

const FUNCTION_TANGENT = "画出 f(x)=x³−3x 的图像与它在 x=1 处的切线"

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

/** 读草稿里那条曲线与那条切线的真实参数。 */
async function committedFigures(page: import("@playwright/test").Page): Promise<{
  curve: { expression: string; domain: [number, number] } | null
  tangent: { x: number; slope: number } | null
}> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:conics")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { type: string; expression?: string; domain?: [number, number]; x?: number; slope?: number }[]
    const curve = primitives.find((primitive) => primitive.type === "function")
    const tangent = primitives.find((primitive) => primitive.type === "tangent")
    return {
      curve: curve?.expression !== undefined && curve.domain !== undefined ? { expression: curve.expression, domain: curve.domain } : null,
      tangent: tangent?.x !== undefined && tangent.slope !== undefined ? { x: tangent.x, slope: tangent.slope } : null
    }
  })
}

/** 测试自己算的导数（中心差分）—— 与核验器那条实现无关，是**第三份**独立读数。 */
function derivativeAt(expression: string, x: number): number {
  const compile = (source: string): (value: number) => number => {
    // 只认这一道题用得到的写法，够用且不引入依赖。
    const normalized = source.replace(/\s+/g, "")
    if (normalized !== "x^3-3*x") throw new Error(`这条用例只准备了一条表达式，收到 ${source}`)
    return (value: number) => value ** 3 - 3 * value
  }
  const f = compile(expression)
  const step = 1e-5 * Math.max(1, Math.abs(x))
  return (f(x + step) - f(x - step)) / (2 * step)
}

test("draws the curve and its tangent, and re-derives the slope from the committed curve", async ({ page }) => {
  await openAgent(page)
  await send(page, FUNCTION_TANGENT)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()

  // ① 两句话都被核验了：曲线是题面那条函数、切线是它在该点的切线。
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  await expect(check).toContainText("f(x)=x³−3x")
  await expect(check).toContainText("x=1 处的切线")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:conics"))).not.toBeNull()

  const { curve, tangent } = await committedFigures(page)
  expect(curve, "草稿里没有函数曲线").not.toBeNull()
  expect(tangent, "草稿里没有切线").not.toBeNull()

  // ② 独立回代：自己求导，自己比。
  const expected = derivativeAt(curve!.expression, 1)
  expect(expected).toBeCloseTo(0, 9) // f′(1) = 0：水平切线
  expect(tangent!.x).toBeCloseTo(1, 9) // 切点就在题面说的那个 x 上
  expect(Math.abs(tangent!.slope - expected)).toBeLessThan(1e-6)

  // 可目检的截图（`test-results/` 是 gitignore 的，只作当次目视核对用）。
  await page.screenshot({ path: "test-results/v0d-function-tangent.png" })
})

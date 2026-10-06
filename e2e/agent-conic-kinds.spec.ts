import { expect, test } from "@playwright/test"

/**
 * **V0c 续：双曲线与抛物线的浏览器证据**。
 *
 * ## 为什么这两条必须单独有浏览器用例
 *
 * V0c 的判据早就覆盖了三类圆锥曲线，而浏览器证据原先**只有椭圆那一张** ——
 * 于是文档里"V0c 三类已覆盖"这句话的举证是不对称的。这份补上另外两类。
 *
 * ## 独立回代的口径：从方程推出**焦点**，再与图上落盘的参数比
 *
 * 两条曲线的焦点公式**不一样**，正好用来说明"为什么轴必须是判据的一部分"：
 * - 椭圆 `x²/a² + y²/b² = 1`：`c² = a² − b²`，焦点在**长轴**上；
 * - 双曲线 `x²/a² − y²/b² = 1`：`c² = a² + b²`，焦点在**实轴**上；
 * - 抛物线 `y² = 2px`：焦点在 `(p/2, 0)`，对称轴是 x 轴。
 *
 * 三个公式都在测试里自己算一遍，不读面板结论。
 */

const HYPERBOLA = "双曲线 x²/9−y²/4=1，画示意图"
const PARABOLA = "抛物线 y²=4x，画示意图"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 提交并回到画布；返回草稿里那条圆锥曲线的真实参数。 */
async function commitAndReadConic(page: import("@playwright/test").Page, prompt: string, label: string) {
  await openAgent(page)
  await send(page, prompt)
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  await expect(check).toContainText(label)
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:conics"))).not.toBeNull()
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:conics")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: { type: string; radiusX?: number; radiusY?: number; focalParameter?: number; axis?: string }[] } }
    const primitives = parsed.document?.primitives ?? []
    const conic = primitives.find((primitive) => primitive.type === "hyperbola" || primitive.type === "parabola")
    if (!conic) throw new Error("草稿里没有圆锥曲线")
    return { type: conic.type, radiusX: conic.radiusX, radiusY: conic.radiusY, focalParameter: conic.focalParameter, axis: conic.axis }
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("draws the hyperbola from its equation and re-derives the foci on the real axis", async ({ page }) => {
  const conic = await commitAndReadConic(page, HYPERBOLA, "x²/9−y²/4=1")
  expect(conic.type).toBe("hyperbola")
  expect(conic.radiusX).toBeCloseTo(3, 9)
  expect(conic.radiusY).toBeCloseTo(2, 9)
  // 实轴在 x 上 —— 轴对调的话焦点会落到 y 轴上，那是另一条曲线。
  expect(conic.axis).toBe("x")
  // **独立回代**：双曲线用 c² = a² + b²（与椭圆的减号相反），焦点在实轴上。
  const focal = Math.sqrt(conic.radiusX! ** 2 + conic.radiusY! ** 2)
  expect(focal).toBeCloseTo(Math.sqrt(13), 9)
  await page.screenshot({ path: "test-results/v0c-hyperbola.png" })
})

test("draws the parabola from its equation and puts the focus at (p/2, 0)", async ({ page }) => {
  const conic = await commitAndReadConic(page, PARABOLA, "y²=4x")
  expect(conic.type).toBe("parabola")
  // 题面的 4 是 **2p**：直接把 4 当 p 会让下面两行都红。
  expect(conic.focalParameter).toBeCloseTo(2, 9)
  expect(conic.axis).toBe("x")
  // **独立回代**：`y² = 2px` 的焦点在 `(p/2, 0)`。
  expect(conic.focalParameter! / 2).toBeCloseTo(1, 9)
  await page.screenshot({ path: "test-results/v0c-parabola.png" })
})

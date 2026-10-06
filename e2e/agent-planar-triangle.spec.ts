import { expect, test } from "@playwright/test"

/**
 * **V0b：平面直角三角形的浏览器证据**（计划 `V0b 平面三角`）。
 *
 * ## 这条用例真正要证的是什么
 *
 * 在此之前，原文题设核验的触发条件写死了 `solid.create_polyhedron` ——
 * **任何平面图形都从不进入核验**，"动作编译成功"就等于"图符合题意"。
 * 所以这条用例不能只断言"图出来了"（那是以前也成立的），
 * 而要断言两件以前**不可能**成立的事：
 *
 * 1. 题设核验**跑了**，并且对 `AB⊥AC` 给出 `passed`；
 * 2. 那个结论来自**文档里真实落盘的坐标** —— 下面用**自算的点积**独立复核，
 *    不读面板的结论。拿系统自己的判断去证明系统自己，等于没证。
 */

const PLANAR_TRIANGLE = "在三角形ABC中，AB⊥AC，画示意图"

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

/** 读应用自己写回的平面几何草稿里、**带点名标签**的平面点。 */
async function namedPlanarPoints(page: import("@playwright/test").Page): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:conics")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { type: string; label?: string; x?: number; y?: number }[]
    const points: Record<string, { x: number; y: number }> = {}
    for (const primitive of primitives) {
      if (primitive.type !== "point") continue
      if (typeof primitive.label !== "string" || !/^[A-Z]$/.test(primitive.label)) continue
      if (typeof primitive.x !== "number" || typeof primitive.y !== "number") continue
      points[primitive.label] = { x: primitive.x, y: primitive.y }
    }
    return points
  })
}

test("draws the planar right triangle and verifies AB ⊥ AC from the committed coordinates", async ({ page }) => {
  await openAgent(page)
  await send(page, PLANAR_TRIANGLE)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()

  // ① 核验真的跑了，并且对题面里那条关系给的是 passed。
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  await expect(check).toContainText("AB⊥AC")
  // ② 边长是系统自选的，必须**告诉用户**，不能悄悄替他定。
  await expect(panel.locator(".agent-assumptions")).toContainText("示例值")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:conics"))).not.toBeNull()

  // 题面点名 A、B、C 三个点，落盘之后必须还是这三个 —— 不多不少。
  const points = await namedPlanarPoints(page)
  expect(Object.keys(points).sort()).toEqual(["A", "B", "C"])
  const { A, B, C } = points

  // ③ **独立回代**：自己算 AB 与 AC 的点积，不读面板结论。
  //    平面题的坐标就是 (x, y)；`z = 0` 不写进断言，因为这里量的是**平面内**的夹角。
  const ab = { x: B.x - A.x, y: B.y - A.y }
  const ac = { x: C.x - A.x, y: C.y - A.y }
  expect(Math.hypot(ab.x, ab.y)).toBeGreaterThan(1e-6) // AB 不能退化成一个点
  expect(Math.hypot(ac.x, ac.y)).toBeGreaterThan(1e-6) // AC 同上
  // AB ⊥ AC ⟺ 点积为 0（无量纲余弦，避免被长度尺度掩盖）。
  expect(Math.abs(ab.x * ac.x + ab.y * ac.y) / (Math.hypot(ab.x, ab.y) * Math.hypot(ac.x, ac.y))).toBeLessThan(1e-9)
  // 三点不共线：否则"三角形"这三个字就不成立。
  expect(Math.abs(ab.x * ac.y - ab.y * ac.x)).toBeGreaterThan(1e-6)

  // 可目检的截图（`test-results/` 是 gitignore 的，只作当次目视核对用）。
  await page.screenshot({ path: "test-results/v0b-planar-right-triangle.png" })
})

import { expect, test } from "@playwright/test"

/**
 * 由动点引申出来的图元要成为一等图元（用户口径）：
 *
 * 1. "由动点引申出来的图元（如切线，动圆）也需要能够反映和其他图元的交点"；
 * 2. "也需要具有正常图元的基本功能"；
 * 3. "同时我们把切线画长一点点"。
 *
 * 这条用例在**浏览器里**把三件事串起来走一遍：建圆 → 在圆上建切线 → 建一条与切线相交的直线
 * → 画布上出现交点预览 → 选中切线与直线量"夹角"、选中圆量"面积" → 数字常驻画布。
 *
 * 全程用属性栏字段摆几何（不点画布坐标），所以与相机/视口无关，不会因为取景变化而抖。
 */
test("intersects a tangent with a line and measures the angle and the circle's area", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.getByRole("region", { name: "功能区" })
  await page.getByRole("button", { name: "固定功能区" }).click()
  const algebra = page.locator(".algebra-panel")
  const canvas = page.locator("svg[aria-label='几何画布']")

  /** 选中对象并把它摆到给定几何：圆形用圆心 + 半径，直线用两个端点。 */
  const select = async (label: string) => {
    await algebra.getByText(label, { exact: true }).click()
  }
  const fill = async (name: string, value: string) => {
    await page.getByRole("spinbutton", { name }).fill(value)
  }
  /**
   * 「添加圆」「添加直线」是**指针驱动的创建命令**（先点得到提示，再在画布上点两下），
   * 所以先在画布上点出对象，再用属性栏字段把它摆到我们需要的几何上。
   */
  const box = (await canvas.boundingBox())!
  const clickAt = async (fx: number, fy: number) => {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  }

  // 圆 1：先点出来，再改成圆心 (0,0)、半径 2（参数 0 的切点是 (2,0) ⇒ 切线竖直 x=2）。
  await ribbon.getByRole("button", { name: "添加圆", exact: true }).click()
  await clickAt(0.35, 0.5)
  await clickAt(0.45, 0.5)
  await select("圆 1")
  await fill("圆心 X", "0")
  await fill("圆心 Y", "0")
  await fill("半径", "2")

  // 在圆上建切线（动点引申出来的图元）。
  await page.getByRole("button", { name: "创建切线" }).click()
  await expect(algebra.getByText("切线 1", { exact: true })).toBeVisible()

  /**
   * 切线是"无限长"（用户口径"切线长度最好是无限长"）：它在画布上的**视口跨度**必须远超画布本身，
   * 而不是恰好与圆相称的一小段。视图框是固定 800×440，所以拿渲染出来的 `<line>` 端点量：
   * 有界切线约 2·r·scale ≈ 130 个单位，无限长则成千上万。
   */
  const tangentSpan = await page.evaluate(() => {
    const group = document.querySelector('[data-primitive-type="tangent"]')
    if (!group) return null
    const lines = Array.from(group.querySelectorAll("line"))
    const spans = lines.map((line) => {
      const x1 = Number(line.getAttribute("x1"))
      const y1 = Number(line.getAttribute("y1"))
      const x2 = Number(line.getAttribute("x2"))
      const y2 = Number(line.getAttribute("y2"))
      return Math.hypot(x2 - x1, y2 - y1)
    })
    return spans.length > 0 ? Math.max(...spans) : null
  })
  expect(tangentSpan).not.toBeNull()
  expect(tangentSpan!).toBeGreaterThan(5000)

  // 直线 1：改成水平 y=2.5，从 x=-5 到 x=5。
  // 刻意选 2.5 而不是 1：它**穿过切线**（切线半长 3，覆盖 y∈[-3,3]）但**不穿过圆**（半径 2），
  // 于是"画布上有交点"这件事只可能由切线产生 —— 切线不支持求交时这个计数必然是 0。
  await ribbon.getByRole("button", { name: "添加直线", exact: true }).click()
  await clickAt(0.2, 0.75)
  await clickAt(0.8, 0.75)
  await select("直线 1")
  await fill("端点 A X", "-5")
  await fill("端点 A Y", "2.5")
  await fill("端点 B X", "5")
  await fill("端点 B Y", "2.5")

  // (1) 画布上出现了交点预览：计数读数不为 0（以前切线一个图元对都不参与，这里是 0）。
  await expect(canvas).not.toHaveAttribute("data-preview-count", "0")

  // (2) 切线与直线能一起量夹角：数字常驻画布。
  await select("切线 1")
  await algebra.getByText("直线 1", { exact: true }).click({ modifiers: ["Shift"] })
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "夹角（两条线）", exact: true }).click()
  await expect(canvas).toHaveAttribute("data-measurement-labels", "1")
  // 竖直的切线与水平直线成 90°（内核按弧度给值：1.571rad）。
  await expect(page.locator("[data-measurement-label]")).toHaveText(/角度：1\.571rad/)

  // (3) 圆也不再只是"点类"来源：面积能量，且数字在画布上。
  await select("圆 1")
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "面积", exact: true }).click()
  await expect(canvas).toHaveAttribute("data-measurement-labels", "2")
  await expect(page.locator("[data-measurement-label]").filter({ hasText: "面积：" })).toHaveText(/面积：12\.566u²/)
})

import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1280, height: 900 } })

/**
 * A1 第 3 片：画布上的**真圆**。
 *
 * 用户口径："我不要一个逼近的圆，我需要一个真的圆，这个曲面的相交太难受了。"
 *
 * 这一条守两件事：
 * 1. 圆柱的默认截面被判成**圆**（解析结论），不是 48 边形；
 * 2. 那圈边界是**按屏幕误差细分**的：放大之后细分点变多——固定段数做不到这一点。
 */
test("draws a section of a cylinder as an exact circle that gains detail when zooming in", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加圆柱" }).click()

  const scene = page.locator("[data-3d-scene]")
  // 圆柱的上下底圆就是两圈真圆（替代原来的 96 段弦）。
  await expect(scene).toHaveAttribute("data-rim-curves", "2")

  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(scene).toHaveAttribute("data-section-count", "1")

  // 默认剖切面过包围盒中心、法向 +Z，与圆柱轴垂直 ⇒ 精确的圆。
  await expect(scene).toHaveAttribute("data-section-exact-kind", "circle")
  await expect(scene).toHaveAttribute("data-section-exact-status", "exact")
  // 两条解析曲线在画布上：圆柱的边界圆（一个组）+ 截面的真圆边界。
  await expect(scene).toHaveAttribute("data-exact-curves", "2")

  // 检查器把解析结论摊开给用户看：半径与离心率（圆就是离心率 0），不是只能数折线点数。
  const inspector = page.locator(".panel.right")
  await expect(inspector).toContainText("解析截面")
  await expect(inspector).toContainText("半径")
  await expect(inspector).toContainText("离心率")
  // 整圆没被端面裁切 ⇒ 面积 / 周长都有闭式，并如实标"精确"。
  await expect(inspector).toContainText("面积")
  await expect(inspector).toContainText("πab 精确")
  await expect(inspector).toContainText("周长")

  const segments = async () => Number(await scene.getAttribute("data-exact-curve-segments"))
  const initial = await segments()
  expect(initial).toBeGreaterThan(8)

  /**
   * 放大：每像素代表的世界单位变小 ⇒ 容差变小 ⇒ 细分点必须变多。
   *
   * 两点实测记录（都写进 progress 文档）：
   * - 容差按 2 的幂做**滞回**，所以小幅缩放**不改**细分点是正确行为：8 次滚轮只放大 1.21×，读数仍是 32；
   * - 浏览器会把连续滚轮事件**合并**，所以这里持续放大直到读数增加（而不是假定"发 N 次就放大 N 倍"）。
   */
  const box = (await scene.boundingBox())!
  /**
   * 先关掉**自动取景**：放大到内容超出视野时它会重新构图，把相机拉回去，于是永远放不大
   *（既有 e2e 凡是依赖相机稳定的用例都先关它）。
   */
  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement).click())
  const distanceBefore = Number(await scene.getAttribute("data-camera-distance"))
  await expect.poll(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(60)
    return segments()
  }, { timeout: 20000, message: "放大后真圆的细分点应增加" }).toBeGreaterThan(initial)

  // 确认这确实是"放大了"带来的：相机距离明显变小。
  expect(Number(await scene.getAttribute("data-camera-distance"))).toBeLessThan(distanceBefore)
})

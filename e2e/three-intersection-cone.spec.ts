import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 曲面 ∩ 曲面（圆柱 ∩ 圆锥）的交面：用户实测反馈"曲面交面相当乱，交出一大堆面，但是无法获取那个曲面"。
 *
 * 实测场景：圆锥（r=1.5、h=4）与圆柱（同底同高）叠在一起时，布尔交集就是圆锥自己——
 * **48 个侧面三角形 + 1 个底面圆盘**。修复前这 48 片一片都认不出属于圆锥面，画布上就有 **49 份**
 * "交面"预览，全是小三角，点哪一块都拿不到那张曲面；修复后是 **2 份**：一张圆锥面 + 一个底面圆盘，
 * 而且圆锥面这块区域带**极点**（锥尖在曲面内部、不在边界环上），填充绕极点铺开、命中区就是那张锥面。
 */
test.use({ viewport: { width: 1280, height: 900 } })

test("turns 圆柱 ∩ 圆锥 into one 圆锥面 plus its base, instead of 48 triangle patches", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cylinder-cone.mgeo")
  const scene = page.locator("[data-3d-scene]")

  // (1) 49 → 2：状态栏里那句人数得出来（用户看到的就是这句）。
  await expect(scene).toHaveAttribute("data-preview-face-count", "2")
  await expect(page.locator(".status-bar-prompt")).toContainText("2 个交面")
  const keys = (await scene.getAttribute("data-preview-keys")) ?? ""
  expect(keys).toContain("pair:cone-a|cyl-a:面0")
  expect(keys).toContain("pair:cone-a|cyl-a:面1")
  expect(keys).not.toContain("面2")

  /**
   * (2) 点到的是**那张曲面**。默认相机在 +x+y 那一侧，取锥面半高处朝向相机的母线点：
   * 半径随高度线性收缩，z=2 处半径 0.75。这一点击必须命中"圆锥面"那份预览——命中区若还是底面圆盘
   * （修复前的样子），指针落在锥面上根本选不到它。
   */
  await page.getByRole("button", { name: "重置3D视角" }).click()
  const azimuth = (Number(await scene.getAttribute("data-camera-azimuth")) * Math.PI) / 180 + Math.PI / 6
  const surface = await projectWorldPoint(page, { x: 0.75 * Math.cos(azimuth), y: 0.75 * Math.sin(azimuth), z: 2 })
  await page.mouse.move(surface.x, surface.y)
  await expect(scene).toHaveAttribute("data-preview-hover-key", "pair:cone-a|cyl-a:面0")

  // (3) 建出来的是**一整张锥面**：面积 = πrl（48 段内接，20.112）而不是那 7.069 的底面圆盘。
  await page.mouse.click(surface.x, surface.y)
  await expect(page.getByText("交面 1").first()).toBeVisible()
  const inspector = page.locator(".panel.right")
  await expect(inspector).toContainText("面积")
  await expect(inspector).toContainText("20.1")
  await expect(inspector).toContainText("数值近似")

  /**
   * (4) 它是**一张光滑曲面**，不是一圈平面三角形（用户口径："我需要的只是那个相交的曲面，
   * 但是在我们的图里面，相交那个曲面是由很多三角形拼出来的"）。
   *
   * 填充按屏幕误差细分并吸回真正的圆锥面上：默认取景下只要 48 片（每片已远小于一个像素），
   * 放大后必须**变多**——固定 48 片的网格做不到这一点。
   */
  const triangles = async () => Number(await scene.getAttribute("data-face-triangles"))
  const coarse = await triangles()
  expect(coarse).toBeGreaterThanOrEqual(48)

  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement).click())
  const box = (await scene.boundingBox())!
  await expect.poll(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -300)
    await page.waitForTimeout(60)
    return triangles()
  }, { timeout: 20000, message: "放大后曲面交面的填充应细分成更多三角形" }).toBeGreaterThan(coarse * 3)
})

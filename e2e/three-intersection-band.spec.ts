import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 圆柱 ∩ 立方体的**交面**（A2 第 3 片）：从内核到画布的整条链路。
 *
 * 用户口径（原话）："重要的问题还在交面上，圆柱和立方体交面会被切成很多个片，这样很不合理。"
 * 实测（内核单测钉住的事实）：布尔交集有 **50 个面片**——2 个圆盘 + 圆柱侧面被切成 48 个细条，
 * 而那 48 条**法向各不相同**（各自切在圆柱的不同方位），所以"合并共面片"一片都减不掉。按**支撑曲面**
 * 分组之后只剩 **3 个区域**：两个圆盘（面积 π·2² = 12.566）与一条侧带（2πRh′ = 50.266，
 * 网格求和 50.230、如实标"数值近似"）。
 *
 * 这条用例守的是**画布上看得见的那三件事**：
 * 1. 预览只有 3 个区域（不是 50 片）；
 * 2. 点侧带建出来的是**整条带**（面积 50.2xx、顶点数 96），不是一个 1.05 的小细条；
 * 3. 它的边界画成**真圆**（解析曲线组），而且放大后细分变多——固定段数做不到。
 */
test.use({ viewport: { width: 1280, height: 900 } })

/** 圆柱半径 2、底面 z=-3 高 6；立方体 4×4×4 居中：z∈[-2,2] 那一段侧带被切出来。 */
const RADIUS = 2
const SEGMENTS = 48
const CUT_HEIGHT = 4
/** 真实侧带面积 `2πRh′`。 */
const TRUE_BAND = 2 * Math.PI * RADIUS * CUT_HEIGHT
/** 读数口径：48 段内接多边形的侧带面积（网格面片求和）= 48 · 2R·sin(π/48) · h′ = 50.2296。 */
const MESH_BAND = SEGMENTS * 2 * RADIUS * Math.sin(Math.PI / SEGMENTS) * CUT_HEIGHT

test("merges 圆柱 ∩ 立方体 into one band patch, and draws its boundary as true circles", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cube-cylinder.mgeo")
  const scene = page.locator("[data-3d-scene]")

  // (1) 50 片 → 3 个区域。
  await expect(scene).toHaveAttribute("data-preview-face-count", "3")
  const keys = (await scene.getAttribute("data-preview-keys")) ?? ""
  expect(keys).toContain("pair:cube-a|cyl-a:面0")
  expect(keys).toContain("pair:cube-a|cyl-a:面2")
  expect(keys).not.toContain("面3")

  /**
   * 先把相机固定下来再投影："把世界点换成屏幕像素"必须用**同一时刻**的相机读数。
   *
   * 取点要避开画布上**别的**细目标——拾取有明确的优先级（`threePicking.ts`：真命中棱 / 交线时它们赢）：
   * - 正对相机的那个点（方位角 = 相机方位角 45°）恰好与立方体 (2,2) 那条竖直棱共线，实测
   *   `data-pick-readout = edge|cube-a-edge-25|precise|hover|behind`——点下去会选中那条棱；
   * - 偏离 ±50° 时射线贴着圆柱与切面的那圈交线，实测 hover 变成 `:线`；
   * - 偏离 ±30° 时射线从切面（`face3`）出去，实测 `face|…|coarse|hover|front` ⇒ 预览赢、交面建得出来。
   */
  await page.getByRole("button", { name: "重置3D视角" }).click()
  const azimuth = (Number(await scene.getAttribute("data-camera-azimuth")) * Math.PI) / 180 + Math.PI / 6
  const bandPoint = await projectWorldPoint(page, { x: RADIUS * Math.cos(azimuth), y: RADIUS * Math.sin(azimuth), z: 0 })
  await page.mouse.move(bandPoint.x, bandPoint.y)
  // 侧带面积最大（50.23 > 12.57），所以它是区域 0。
  await expect(scene).toHaveAttribute("data-preview-hover-key", "pair:cube-a|cyl-a:面0")

  // (2) 点它建出来的是**整条带**：面积 50.230（网格求和口径；真值 50.266，偏小 0.07%）、96 个网格点。
  await page.mouse.click(bandPoint.x, bandPoint.y)
  await expect(page.getByText("交面 1").first()).toBeVisible()
  const inspector = page.locator(".panel.right")
  await expect(inspector).toContainText("面积")
  // 读数就是内接多边形侧带的面积，而不是一个 1.05 的小细条（比整条带小 48 倍）。
  expect(Math.abs(MESH_BAND - TRUE_BAND) / TRUE_BAND).toBeLessThan(0.001)
  await expect(inspector).toContainText(MESH_BAND.toFixed(3))
  await expect(inspector).toContainText("96")
  // 诚实边界：曲面区域的面积是网格求和，读数必须如实说是数值近似。
  await expect(inspector).toContainText("数值近似")

  // (3) 边界是真曲线：圆柱上下底两圈 + 交面自己的两圈 = 2 个解析曲线组（多边形边界一个都不算）。
  await expect(scene).toHaveAttribute("data-rim-curves", "2")
  await expect(scene).toHaveAttribute("data-exact-curves", "2")

  const segments = async () => Number(await scene.getAttribute("data-exact-curve-segments"))
  const initial = await segments()
  expect(initial).toBeGreaterThan(8)

  // 放大 ⇒ 每像素代表的世界单位变小 ⇒ 容差变小 ⇒ 真圆的细分点必须变多。
  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement).click())
  await expect(scene).toHaveAttribute("data-autofit", "false")
  const box = (await scene.boundingBox())!
  await expect.poll(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(60)
    return segments()
  }, { timeout: 20000, message: "放大后交面边界的细分点应增加" }).toBeGreaterThan(initial)
})

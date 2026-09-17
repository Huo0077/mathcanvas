import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 剖切面的可发现性与可移动性（立体几何）。
 * 旧的失败模式：选中实体后画布上出现一圈红色虚线，但状态栏只说"已选中…拖动控制点"，点它也没有任何反应。
 */

test.beforeEach(async ({ page }) => {
  // 每个用例从空图纸开始：草稿会跨用例恢复，否则"截面 1 / 截面 2"这类名字与计数都不可预期。
  await page.addInitScript(() => localStorage.clear())
})

/**
 * 创建截面用的抓取点：必须是剖切面那圈**边界线**上的一点（预览的命中区只有边界线）。
 * 默认截面（法向 +Y、过立方体中心）的环是 x∈[-2,2] × z∈[-1,1] @ y=0，
 * 世界点 (2, 0, 0) 落在它的 x=2 这条边上、且被实体表面遮挡（于是点选不会抢走这次点击）。
 * 用相机读数投影出来，而不是写死像素偏移——那会随画布尺寸与比例失效（实测过）。
 */
async function grabPoint(page: import("@playwright/test").Page) {
  return projectWorldPoint(page, { x: 2, y: 0, z: 0 })
}

/** 拖动截面用的抓取点：必须落在截面**填充**多边形内部（截面本体是那圈填充，边界线不参与拾取）。 */
async function grabSectionBody(page: import("@playwright/test").Page) {
  return projectWorldPoint(page, { x: 0, y: 0, z: 0 })
}

test("explains the section preview and creates a section when it is clicked", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()

  // 未指向剖切面时，状态栏要保留"已选中…"这条信息；指向它时才解释这圈虚线是什么。
  const prompt = page.locator(".status-bar-prompt")
  await expect(prompt).toContainText("已选中")
  await expect(scene).toHaveAttribute("data-intersection-preview", "section")
  await expect(scene).toHaveAttribute("data-section-count", "0")

  // 点剖切面即创建：指针落在那圈红色虚线上（它经过画布中心偏上一点，不是正中心）。
  const start = await grabPoint(page)
  await page.mouse.move(start.x, start.y)
  await expect(scene).toHaveAttribute("data-preview-hovering", "true")
  await expect(prompt).toContainText("默认剖切平面")
  await expect(prompt).toContainText("点击即创建截面")
  /**
   * 就用**同一个**坐标按下去，不重新投影。以前不行：悬停会改状态栏文案，页脚因此变高一行，
   * 而 3D 画布是填满所在网格行的——画布一被压矮，同一个屏幕坐标就不再对应同一个世界点，
   * 点击必然落到预览之外（实测指针移动报 hovering=true、抬起却是 off）。
   * 现在状态栏那一行是常量高度（`--status-bar-height`），
   * 对应的不变量在 three-canvas-size.spec.ts 的"keeps the canvas size when the status text changes"里守着。
   */
  await page.mouse.click(start.x, start.y)

  await expect(scene).toHaveAttribute("data-section-count", "1")
  // 立方体边长 2，过中心的水平截面是 4 边形
  await expect(scene).toHaveAttribute("data-section-point-count", "4")
})

test("moves the cutting plane with the arrow keys while free dragging is on", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(scene).toHaveAttribute("data-section-count", "1")

  const planeConstant = async () => Number(await scene.getAttribute("data-section-plane-constant"))
  const start = await planeConstant()

  // 方向键只在自由拖动模式下接管，避免和画布其它按键语义打架
  await page.keyboard.press("ArrowUp")
  expect(await planeConstant()).toBe(start)

  await page.getByRole("button", { name: "自由拖动" }).click()
  await page.keyboard.press("ArrowUp")
  await expect.poll(planeConstant).toBeCloseTo(start - 1, 3)
  await page.keyboard.press("ArrowUp")
  await expect.poll(planeConstant).toBeCloseTo(start - 2, 3)
  // Shift 是细调
  await page.keyboard.press("Shift+ArrowDown")
  await expect.poll(planeConstant).toBeCloseTo(start - 1.8, 3)

  // 继续朝同方向推：立方体 y ∈ [-1,1]，走够 2 个单位就出界，截面点归零（不留过期形状）
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("ArrowUp")
  await expect(scene).toHaveAttribute("data-section-point-count", "0")
})

test("tilts the cutting plane from the properties panel", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(scene).toHaveAttribute("data-section-count", "1")

  const normal = async () => (await scene.getAttribute("data-section-plane-normal")) ?? ""
  const start = await normal()
  // 默认剖切面是水平的（世界 Z 轴朝上）：法向 (0,0,1)
  expect(start).toBe("0.000,0.000,1.000")

  // 绕 X 轴倾斜 15°：法向转到 (0, -sin15, cos15)，截面必须重新算出来
  await page.getByRole("button", { name: "绕 X 轴旋转剖切面 +15°" }).click()
  await expect.poll(normal).not.toBe(start)
  const tilted = (await normal()).split(",").map(Number)
  expect(tilted[0]).toBeCloseTo(0, 3)
  expect(Math.abs(tilted[1])).toBeCloseTo(Math.sin(Math.PI / 12), 3)
  expect(tilted[2]).toBeCloseTo(Math.cos(Math.PI / 12), 3)
  expect(Math.hypot(tilted[0], tilted[1], tilted[2])).toBeCloseTo(1, 3)
  // 绕实体中心倾斜，所以刀口仍在实体内：截面还有多边形
  await expect.poll(async () => Number(await scene.getAttribute("data-section-point-count"))).toBeGreaterThanOrEqual(3)

  // 反向转回来应回到水平
  await page.getByRole("button", { name: "绕 X 轴旋转剖切面 -15°" }).click()
  await expect.poll(normal).toBe(start)
})

test("uses a face of the solid as the cutting plane", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(scene).toHaveAttribute("data-section-count", "1")

  const normal = async () => (await scene.getAttribute("data-section-plane-normal")) ?? ""
  const start = await normal()

  // 开启一次性取面模式，再点实体上的一个面。
  // 这一步用 DOM 直接派发点击：按钮在显示控制那一排里，Playwright 的"稳定"检查会和场景重建互相等待，
  // 而这里要验的是取面逻辑本身。
  const facePick = page.getByRole("button", { name: "以面为剖切面" })
  await expect(facePick).toBeEnabled()
  await facePick.evaluate((button) => (button as HTMLButtonElement).click())
  await expect(facePick).toHaveAttribute("aria-pressed", "true")
  // 点立方体 +X 那个面的中心（世界点 (2,0,0) 投影到屏幕）：
  // 默认剖切面法向是 +Z，只有选了**侧面**才能看出"取面"真的换了平面。
  const face = await projectWorldPoint(page, { x: 2, y: 0, z: 0 })
  await page.mouse.click(face.x, face.y)

  // 取到面之后剖切面变成该面所在平面：法向变成 ±X，且截面仍有边界
  await expect.poll(normal).not.toBe(start)
  const used = (await normal()).split(",").map(Number)
  expect(Math.abs(used[0])).toBeCloseTo(1, 3)
  expect(used[1]).toBeCloseTo(0, 3)
  expect(used[2]).toBeCloseTo(0, 3)
  expect(Math.hypot(used[0], used[1], used[2])).toBeCloseTo(1, 3)
  await expect.poll(async () => Number(await scene.getAttribute("data-section-point-count"))).toBeGreaterThanOrEqual(3)
})

/**
 * 四个模板的**默认刀口**都必须真的切出多边形，而且转到 45° 仍然成立。
 * 棱锥 / 圆柱 / 圆锥的默认几何一度还是 Y-up 的旧约定，刀口切在边界甚至切空（切片 1B 修掉），
 * 这条用例把"四个模板都切得出来"钉在 e2e 层。
 */
for (const template of ["立方体", "棱锥", "圆柱", "圆锥"]) {
  test(`cuts the default section of a ${template} and survives a 45° tilt`, async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "立体几何" }).click()

    const scene = page.locator("[data-3d-scene]")
    await page.getByRole("button", { name: `添加${template}` }).click()
    await page.getByRole("button", { name: "创建截面" }).click()
    await expect(scene).toHaveAttribute("data-section-count", "1")

    const pointCount = async () => Number(await scene.getAttribute("data-section-point-count"))
    const sectionPoints = expect.poll(pointCount, { message: `${template} 的默认截面` })
    await sectionPoints.toBeGreaterThanOrEqual(3)

    // 绕 X 轴三次 +15°：法向转到 45°，截面仍要有边界（不是切空、也没退化成一条棱）
    for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "绕 X 轴旋转剖切面 +15°" }).click()
    const tilted = (await scene.getAttribute("data-section-plane-normal"))!.split(",").map(Number)
    expect(Math.abs(tilted[1]), template).toBeCloseTo(Math.sin(Math.PI / 4), 2)
    expect(tilted[2], template).toBeCloseTo(Math.cos(Math.PI / 4), 2)
    await expect.poll(pointCount, { message: `${template} 倾斜 45° 后` }).toBeGreaterThanOrEqual(3)
  })
}

test("moves the drawing section when dragged while free dragging is on", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(scene).toHaveAttribute("data-section-count", "1")

  await page.getByRole("button", { name: "自由拖动" }).click()
  const planeConstant = async () => Number(await scene.getAttribute("data-section-plane-constant"))
  const before = await planeConstant()

  // 竖直拖动：默认法向是 +Z，相机自身的"上"向量带 +Z 分量，所以竖直拖才会真的推动这个剖切面
  // （横向拖动与 +Z 法向相切，按设计不应该移动它）。
  const start = await grabSectionBody(page)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y - 40, { steps: 4 })
  await page.mouse.move(start.x, start.y - 80, { steps: 4 })
  await page.mouse.up()

  await expect.poll(planeConstant).not.toBe(before)

  // 一次拖动一步撤销
  await page.keyboard.press("Control+z")
  await expect.poll(planeConstant).toBe(before)
})

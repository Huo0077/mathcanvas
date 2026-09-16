import { expect, test } from "@playwright/test"

/**
 * 剖切面的可发现性与可移动性（立体几何）。
 * 旧的失败模式：选中实体后画布上出现一圈红色虚线，但状态栏只说"已选中…拖动控制点"，点它也没有任何反应。
 */

test.beforeEach(async ({ page }) => {
  // 每个用例从空图纸开始：草稿会跨用例恢复，否则"截面 1 / 截面 2"这类名字与计数都不可预期。
  await page.addInitScript(() => localStorage.clear())
})

/** 截面边界在实体表面之内，所以抓取点要落在可见的那圈线上（画布中心的实体面会先被命中）。 */
async function grabPoint(page: import("@playwright/test").Page) {
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  return { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 - 20 }
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
  // 默认剖切面是水平的：法向 (0,1,0)
  expect(start).toBe("0.000,1.000,0.000")

  // 绕 X 轴倾斜 15°：法向转到 (0, cos15, sin15) 一带，截面必须重新算出来
  await page.getByRole("button", { name: "绕 X 轴旋转剖切面 +15°" }).click()
  await expect.poll(normal).not.toBe(start)
  const tilted = (await normal()).split(",").map(Number)
  expect(tilted[0]).toBeCloseTo(0, 3)
  expect(tilted[1]).toBeLessThan(1)
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
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45)

  // 取到面之后剖切面变成该面所在平面：法向不再是水平方向，且截面仍有边界
  await expect.poll(normal).not.toBe(start)
  const used = (await normal()).split(",").map(Number)
  expect(Math.hypot(used[0], used[1], used[2])).toBeCloseTo(1, 3)
  await expect.poll(async () => Number(await scene.getAttribute("data-section-point-count"))).toBeGreaterThanOrEqual(3)
})

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

  // 横向拖动：默认法向是 +Y，相机的屏幕右向量带 +Y 分量，所以横向拖才会真的推动这个剖切面
  // （竖直拖动几乎与该法向相切，按设计不应该移动它）。
  const start = await grabPoint(page)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 40, start.y, { steps: 4 })
  await page.mouse.move(start.x + 80, start.y, { steps: 4 })
  await page.mouse.up()

  await expect.poll(planeConstant).not.toBe(before)

  // 一次拖动一步撤销
  await page.keyboard.press("Control+z")
  await expect.poll(planeConstant).toBe(before)
})

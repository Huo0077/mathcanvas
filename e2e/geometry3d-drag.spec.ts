import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 自由拖动（立体几何）：开启「自由拖动」后，左键按住图形即可整体移动。
 * 断言读取画布自己暴露的真实读数（`data-content-bounds` / `data-camera-*`）与属性栏数值，而不是凭肉眼。
 */

test("drags a solid freely without turning the camera", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toBeVisible()
  await expect(scene).toHaveAttribute("data-drag-mode", "false")

  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()

  const dragButton = page.getByRole("button", { name: "自由拖动" })
  await expect(dragButton).toHaveAttribute("aria-pressed", "false")
  await dragButton.click()
  await expect(dragButton).toHaveAttribute("aria-pressed", "true")
  await expect(scene).toHaveAttribute("data-drag-mode", "true")

  const centreBefore = parseVector(await scene.getAttribute("data-content-bounds"))
  const targetBefore = await scene.getAttribute("data-camera-target")
  const anglesBefore = await cameraAngles(scene)

  await dragBy(page, 80, 0)

  // 图形整体移动了，而且视角没有被拖动带偏（这正是「自由拖动」和「旋转视角」的分界）
  await expect.poll(async () => distance(parseVector(await scene.getAttribute("data-content-bounds")), centreBefore)).toBeGreaterThan(0.2)
  expect(await scene.getAttribute("data-camera-target")).toEqual(targetBefore)
  expect(await cameraAngles(scene)).toEqual(anglesBefore)

  await expect(dragButton).toHaveAttribute("aria-pressed", "true")
})

test("undoes one free drag in a single step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()
  await page.getByRole("button", { name: "自由拖动" }).click()

  const centreBefore = parseVector(await scene.getAttribute("data-content-bounds"))
  await dragBy(page, 90, 20)
  await expect.poll(async () => distance(parseVector(await scene.getAttribute("data-content-bounds")), centreBefore)).toBeGreaterThan(0.2)

  // 一次拖动就是一步撤销：拖动期间若中途提交，撤销一次会回不到原位。
  await page.keyboard.press("Control+z")

  await expect.poll(async () => distance(parseVector(await scene.getAttribute("data-content-bounds")), centreBefore)).toBeLessThan(0.05)
})

test("returns left-drag to orbiting when the toggle is off", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()

  const dragButton = page.getByRole("button", { name: "自由拖动" })
  await dragButton.click()
  await expect(scene).toHaveAttribute("data-drag-mode", "true")
  await dragButton.click()
  await expect(scene).toHaveAttribute("data-drag-mode", "false")

  const centreBefore = parseVector(await scene.getAttribute("data-content-bounds"))
  const anglesBefore = await cameraAngles(scene)
  await dragBy(page, 60, 30)

  // 关掉之后同样的左键拖动恢复成旋转视角：视角转了，图形不动。
  await expect.poll(async () => cameraAngles(scene)).not.toEqual(anglesBefore)
  expect(distance(parseVector(await scene.getAttribute("data-content-bounds")), centreBefore)).toBeLessThan(0.05)
})

test("drags only the solid under the pointer", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  // 这个用例按**固定屏幕位移**拖动，依赖相机稳定：关掉自动取景（把第一个立方体挪到 (8,8,0)
  // 会让内容越界，自动取景会重新构图，于是下面那次固定位移的拖动就落空了）。
  // 用 DOM 派发点击：显示控制那一排在窄视口下会换行，locator.click 会等"位置稳定"而超时。
  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement).click())

  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()
  // 新立方体都建在同一处，先把第一个挪开，两个实体才各自可点
  await setOrigin(page, [8, 8, 0])
  const firstCubeOrigin = await cubeOrigin(page)

  // 新建的实体就是当前选中对象，所以可以直接拖它，不必经由对象树
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 2").first()).toBeVisible()
  // 默认落点：坐在地面上、在 (−7, 3) 那个象限（见 `addDefaultCube`）。
  expect(await cubeOrigin(page)).toEqual([-7, 3, 0])
  await page.getByRole("button", { name: "自由拖动" }).click()
  /**
   * 从**立方体自己身上**按下（默认落点不在画布正中，所以不能再用固定屏幕位移）：
   * 原点 + 尺寸的一半就是它的中心，用实时相机读数投影过去。
   */
  const [originX, originY, originZ] = await cubeOrigin(page)
  const grab = await projectWorldPoint(page, { x: originX + 2, y: originY + 2, z: originZ + 1 })
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 70, grab.y + 25, { steps: 6 })
  await page.mouse.up()
  expect(await cubeOrigin(page)).not.toEqual([-7, 3, 0])

  // 再选第一个立方体：原点仍是拖动前设的读数，说明拖动没有波及无关对象
  await page.getByText("立方体 1").first().click()
  expect(await cubeOrigin(page)).toEqual(firstCubeOrigin)
})

/** 选中对象的原点读数（属性栏里的「原点 X/Y/Z」）。 */
async function cubeOrigin(page: import("@playwright/test").Page) {
  return Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `原点 ${axis}` }).inputValue())))
}

async function setOrigin(page: import("@playwright/test").Page, origin: number[]) {
  for (const [index, axis] of ["X", "Y", "Z"].entries()) {
    await page.getByRole("spinbutton", { name: `原点 ${axis}` }).fill(String(origin[index]))
  }
}

test("keeps pan mode and drag mode from being on at once", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  const dragButton = page.getByRole("button", { name: "自由拖动" })
  const panButton = page.getByRole("button", { name: "平移视角" })

  await dragButton.click()
  await expect(dragButton).toHaveAttribute("aria-pressed", "true")

  // 打开平移视角必须关掉自由拖动，否则左键拖动会有两种解释
  await panButton.click()
  await expect(panButton).toHaveAttribute("aria-pressed", "true")
  await expect(dragButton).toHaveAttribute("aria-pressed", "false")
  await expect(scene).toHaveAttribute("data-drag-mode", "false")

  await dragButton.click()
  await expect(dragButton).toHaveAttribute("aria-pressed", "true")
  await expect(panButton).toHaveAttribute("aria-pressed", "false")
})

test("keeps a round solid's rim circles glued to it while dragging", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(page.getByText("圆柱 1").first()).toBeVisible()
  // 圆柱的上下底由**解析圆**画（`createRimCircles3`），它们是画布上另一份对象、不在实体网格里。
  await expect(scene).toHaveAttribute("data-rim-curves", "2")

  await page.getByRole("button", { name: "自由拖动" }).click()
  // 从"内容包围盒中心"那个世界点按下：它落在圆柱自己身上（不是顶点手柄），拖动族里才有这两圈圆。
  const centre = parseVector(await scene.getAttribute("data-content-bounds"))
  const start = await projectWorldPoint(page, { x: centre[0], y: centre[1], z: centre[2] })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await expect(scene).toHaveAttribute("data-drag-target", /->cylinder$/)
  await page.mouse.move(start.x + 60, start.y + 24, { steps: 6 })
  await page.mouse.up()

  /**
   * 用户实测反馈："自由移动圆锥圆柱时，底部圆的动画单独跑掉了，不跟手一起。"
   *
   * 拖动期间**文档不提交**，画面全靠临时偏移，所以"偏移被重复画了一层"在文档里看不出来：边界圆是
   * "组 + 每圈线"两层都挂着同一个 `primitiveId`，两边各加一次 ⇒ 圆以两倍速度飞出去。
   * `data-drag-offset-drift` 就是抬手时量出来的最大偏差（0 = 画面与位移完全一致）：
   * 修之前这里读到的是那段拖动位移（跟着手指的距离），修之后是 0。
   */
  await expect(scene).toHaveAttribute("data-drag-offset-drift", "0.0000")
  // 拖动确实生效了（不是"没抓到手"所以偏差为 0 的假通过）：圆柱中心离开了原位。
  await expect.poll(async () => {
    const after = parseVector(await scene.getAttribute("data-content-bounds"))
    return distance(after.slice(0, 3), centre.slice(0, 3))
  }).toBeGreaterThan(0.2)
})

test("carries the point labels along while a solid is being dragged", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(page.getByText("圆柱 1").first()).toBeVisible()
  await page.getByRole("button", { name: "自由拖动" }).click()

  /** 画布上那层 HTML 点标注（A/B/C…）的屏幕位置。 */
  const labelPositions = async () => {
    const labels = page.locator(".three-point-label")
    const found: string[] = []
    for (let index = 0; index < (await labels.count()); index += 1) {
      const box = await labels.nth(index).boundingBox()
      found.push(box ? `${Math.round(box.x)},${Math.round(box.y)}` : "-")
    }
    return found.join("|")
  }

  const centre = parseVector(await scene.getAttribute("data-content-bounds"))
  const start = await projectWorldPoint(page, { x: centre[0], y: centre[1], z: centre[2] })
  const before = await labelPositions()
  expect(before.length).toBeGreaterThan(0)

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await expect(scene).toHaveAttribute("data-drag-target", /->cylinder$/)
  await page.mouse.move(start.x + 90, start.y + 36, { steps: 6 })
  /**
   * 用户实测反馈："现在圆柱上的点又不跟着动了。"
   *
   * 点手柄是画布对象、跟着临时偏移走了，但点标注此前按**文档坐标**投影——拖动期间文档不提交，
   * 于是手把实体拖走了、字母还钉在原处。这里在**按住不放**的时候读标注位置：必须已经跟着走了
   *（抬手之后才跟上是旧行为，读起来就是"点不跟手"）。
   */
  await expect.poll(labelPositions).not.toBe(before)
  await page.mouse.up()
})

test("repaints the scene while a solid is being dragged", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()
  await page.getByRole("button", { name: "自由拖动" }).click()

  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  const start = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // 20 次 pointermove：每一次都必须重画一次，画面才是连续的而不是一跳一跳
  for (let step = 1; step <= 20; step += 1) await page.mouse.move(start.x + step * 4, start.y)
  await page.mouse.up()

  // 旧实现只在别的渲染顺带发生时更新：20 次移动只重画 3 次。现在每次移动都重画
  // （浏览器会合并部分 mousemove，所以按"明显多于 3 次"来断言，而不是死抠 20）。
  await expect.poll(async () => Number(await scene.getAttribute("data-drag-frames"))).toBeGreaterThanOrEqual(10)
})

/** 在画布中心按住左键拖一段距离；拖动模式下这里命中的是图形本体。 */
async function dragBy(page: import("@playwright/test").Page, deltaX: number, deltaY: number) {
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  const start = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + deltaX / 2, start.y + deltaY / 2, { steps: 4 })
  await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 4 })
  await page.mouse.up()
}

/** 旋转只改方位角/仰角，视点中心不动，所以「视角有没有转」要看这两个读数。 */
async function cameraAngles(scene: import("@playwright/test").Locator) {
  return [await scene.getAttribute("data-camera-azimuth"), await scene.getAttribute("data-camera-elevation")]
}

/** `data-content-bounds` 的格式：`x,y,z size x,y,z`（见 threeScene.tsx）。 */
function parseVector(bounds: string | null): number[] {
  const [centre, size] = (bounds ?? "").split(" size ")
  const values = [...(centre ?? "").split(","), ...(size ?? "").split(",")].map(Number)
  return values.length === 6 && values.every(Number.isFinite) ? values : Array<number>(6).fill(Number.NaN)
}

function distance(first: number[], second: number[]) {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2])
}

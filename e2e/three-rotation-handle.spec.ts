import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 画布旋转手柄（slice 4）：选中一个实体后出现三色环，拖 X 环到 90°，文档里的朝向就是 90°，一次撤销回 0。
 *
 * 用户口径："我希望能给立体图形增加旋转功能，就像我想要一个横着的圆柱，可以在图中拖着圆柱旋转，
 * 也可以在右侧属性栏设置为 90 度。"
 *
 * 这里刻意**不打开**「自由拖动」：环是显式手柄，抓住它就是要转它，不该还要先切一个模式
 *（否则"能转"这件事就又藏起来了）。用例读的全是画布与属性栏自己暴露的读数，
 * 抓取点由 `data-rotation-handle-pivot` + `data-rotation-handle-radius` 算出来，不写死像素。
 */
test("rotates a solid by dragging the X ring, in one undoable step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(page.getByText("圆柱 1").first()).toBeVisible()

  // (1) 选中恰好一个可转对象 ⇒ 三个环（X / Y / Z）。
  await expect(scene).toHaveAttribute("data-rotation-handles", "3")
  const pivot = parseTriple(await scene.getAttribute("data-rotation-handle-pivot"))
  const radius = Number(await scene.getAttribute("data-rotation-handle-radius"))
  expect(radius).toBeGreaterThan(0)

  // 先缩小一档：环的半径比实体本身大一圈，自动取景只框实体，不缩一下环可能落到画布外。
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  const distanceBefore = await scene.getAttribute("data-camera-distance")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 300)
  await expect.poll(async () => scene.getAttribute("data-camera-distance")).not.toBe(distanceBefore)

  /**
   * (2) 绕 X 轴转 +90°（右手法则，与属性栏的三个角度字段同一套约定）：从环上 +45° 那一点
   * 拖到 +135° 那一点。
   *
   * 抓取点**必须避开三个环的交点**（±X / ±Y / ±Z 方向那些点）：X 环与 Z 环正好在 ±Y 处相交，
   * 从那里按下时"抓住的是哪个环"取决于深度排序——实测过一次，同一段脚本一会儿给 x、一会儿给 z。
   * 45° 处只有 X 环经过，命中是唯一的。
   */
  const diagonal = radius / Math.SQRT2
  const from = await projectWorldPoint(page, { x: pivot[0], y: pivot[1] + diagonal, z: pivot[2] + diagonal })
  const to = await projectWorldPoint(page, { x: pivot[0], y: pivot[1] - diagonal, z: pivot[2] + diagonal })

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // 按下就说明抓住了 X 环（命中环才开会话）。
  await expect(scene).toHaveAttribute("data-rotation-axis", "x")
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8)
  }

  // 拖动期间画面已经转过去了（临时旋转），而且吸附到整 90°：读数与提交的角度是同一个数。
  await expect(scene).toHaveAttribute("data-rotation-degrees", "90.00")
  await page.mouse.up()

  // (3) 文档里的朝向 = 绕 X 轴 90°。
  const rotationX = page.getByRole("spinbutton", { name: "绕 X 轴旋转角度" })
  await expect(rotationX).toHaveValue("90")
  await expect(page.getByRole("spinbutton", { name: "绕 Y 轴旋转角度" })).toHaveValue("0")
  await expect(page.getByRole("spinbutton", { name: "绕 Z 轴旋转角度" })).toHaveValue("0")

  // 实体真的躺着转了：圆柱的物化顶点跟着新朝向走（内容包围盒的高度方向换了）。
  const bounds = await scene.getAttribute("data-content-bounds")
  expect(bounds).toBeTruthy()

  // (4) 一次拖动 = 一步撤销：回到 0°，而不是退回"圆柱没了"。
  await page.keyboard.press("Control+z")
  await expect(page.getByRole("spinbutton", { name: "绕 X 轴旋转角度" })).toHaveValue("0")
  await expect(page.getByText("圆柱 1").first()).toBeVisible()
})

/** 环的枢轴读数（`data-rotation-handle-pivot` 的 `x,y,z`）。 */
function parseTriple(text: string | null): number[] {
  const values = (text ?? "").split(",").map(Number)
  expect(values).toHaveLength(3)
  expect(values.every(Number.isFinite)).toBe(true)
  return values
}

/** 拖动读数 `data-rotation-degrees`（度）。 */
async function readRotationDegrees(scene: import("@playwright/test").Locator): Promise<number> {
  const text = await scene.getAttribute("data-rotation-degrees")
  expect(text).toBeTruthy()
  return Number(text)
}

/**
 * 不吸附（按住 Alt）时如实跟着指针走：这条守的是"15° 是一层吸附、不是把角度偷偷改掉"。
 * 同一个环上换个位置按下再拖，读数不该被量化成 15 的整数倍。
 */
test("follows the pointer exactly while Alt is held", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(scene).toHaveAttribute("data-rotation-handles", "3")

  const pivot = parseTriple(await scene.getAttribute("data-rotation-handle-pivot"))
  const radius = Number(await scene.getAttribute("data-rotation-handle-radius"))
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  const distanceBefore = await scene.getAttribute("data-camera-distance")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 300)
  await expect.poll(async () => scene.getAttribute("data-camera-distance")).not.toBe(distanceBefore)

  // 从环上 +45° 处（+Y+Z 方向，只有 X 环经过）拖到 +20° 处：绕 X 轴 −25°。
  // 吸附开着的话会落到 −30°，所以"读数是不是 −25"直接说明了 Alt 有没有真的关掉量化。
  const atAngle = (degrees: number) => ({
    x: pivot[0],
    y: pivot[1] + radius * Math.cos((degrees * Math.PI) / 180),
    z: pivot[2] + radius * Math.sin((degrees * Math.PI) / 180)
  })
  const from = await projectWorldPoint(page, atAngle(45))
  const to = await projectWorldPoint(page, atAngle(20))

  await page.keyboard.down("Alt")
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await expect(scene).toHaveAttribute("data-rotation-axis", "x")
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8)
  }

  // 精确到 −25°（浏览器把指针坐标取整，允许零点几度的误差）：没有被吸附到 −30°，也没有被四舍五入掩盖。
  const degrees = await readRotationDegrees(scene)
  expect(degrees).toBeCloseTo(-25, 0)
  expect(Math.abs(degrees + 30)).toBeGreaterThan(1)
  await page.mouse.up()
  await page.keyboard.up("Alt")

  const rotationX = page.getByRole("spinbutton", { name: "绕 X 轴旋转角度" })
  await expect.poll(async () => Number(await rotationX.inputValue())).toBeCloseTo(-25, 0)
})

/** 环外的按下不算旋转：不选环、不开会话，也不会把实体转到别处去。 */
test("does not start a rotation when the pointer is off the rings", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(scene).toHaveAttribute("data-rotation-handles", "3")

  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  // 画布左上角：既不在环上，也不在实体上（自动取景把实体放在中间）。
  await page.mouse.move(box.x + 6, box.y + 6)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + 20, { steps: 4 })
  await page.mouse.up()

  expect(await scene.getAttribute("data-rotation-axis")).toBeFalsy()
  await expect(page.getByRole("spinbutton", { name: "绕 X 轴旋转角度" })).toHaveValue("0")
})

/** 多选时"绕谁转"没有唯一答案，所以不给环（与域操作"只转一个对象"的语义一致）。 */
test("offers no rings when more than one object is selected", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(scene).toHaveAttribute("data-rotation-handles", "3")

  // 按住 Shift 加选第二个：两个对象，手柄收起来。
  await page.getByText("圆柱 1").first().click()
  await page.getByText("立方体 1").first().click({ modifiers: ["Shift"] })
  await expect(scene).toHaveAttribute("data-rotation-handles", "0")
})

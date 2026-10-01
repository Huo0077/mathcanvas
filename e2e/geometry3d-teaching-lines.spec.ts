import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

test("keeps a teacher's dashed spatial segment separate from view-only hidden edges", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "绘制线段" }).click()
  for (const point of [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }]) {
    const projected = await projectWorldPoint(page, point)
    await page.mouse.click(projected.x, projected.y)
  }
  await expect(page.locator(".algebra-panel").getByText("空间线段 1").first()).toBeVisible()
  await page.getByRole("button", { name: "外观样式" }).click()
  const style = page.getByRole("combobox", { name: "教学线型" })
  await expect(style).toHaveValue("solid")
  await style.selectOption("8 6")
  await expect(style).toHaveValue("8 6")
  await page.getByRole("button", { name: "隐藏边" }).click()
  await expect(style).toHaveValue("8 6")
  await expect(page.getByText(/教学虚线.*隐藏边/)).toBeVisible()
  await page.getByRole("button", { name: "隐藏边" }).click()
  await expect(style).toHaveValue("8 6")
})

/**
 * **旋转视角后，每个顶点标注仍停在自己那个顶点上**（实施计划 Task 7 的最后一条）。
 *
 * 3D 点标注是 HTML 覆盖层（`.three-point-label`），锚点由 `pointLabels.ts` 按**对象的世界坐标**投影算出：
 *   `left = (ndcX·0.5+0.5)·宽 + 10`、`top = (−ndcY·0.5+0.5)·高 − 10`（CSS 再用 `translateY(-50%)` 居中）。
 * 所以判据不是"标签还在画面上"，而是**逐点对齐**：每个 `[data-point-id]` 的锚点必须落在**它自己那个顶点**
 * 的投影上（±2px，留出相机读数只有两位小数的误差）。标签互换了位置、或者没跟着相机更新，这条都会红。
 */
test("keeps every vertex label on its own vertex after the camera rotates", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  // 钉住原点：默认落点会随模板策略漂，而这条用例要的是**已知坐标**
  await page.getByRole("button", { name: "添加立方体" }).click()
  for (const [axis, value] of [["X", "-2"], ["Y", "-2"], ["Z", "-2"]] as const) {
    await page.getByRole("spinbutton", { name: `原点 ${axis}` }).fill(value)
  }

  const scene = page.locator("[data-3d-scene]")
  const overlay = page.locator(".three-point-label-overlay")
  const canvasBox = (await page.locator("[data-3d-scene] canvas").boundingBox())!

  const readVertices = () => page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) return [] as { id: string; label: string; position: { x: number; y: number; z: number } }[]
    const primitives = (JSON.parse(raw) as { document: { primitives: { id: string; type: string; label?: string; position?: { x: number; y: number; z: number } }[] } }).document.primitives
    return primitives.flatMap((primitive) => primitive.type === "point3" && primitive.position ? [{ id: primitive.id, label: primitive.label ?? primitive.id, position: primitive.position }] : [])
  })
  await expect.poll(async () => (await readVertices()).length).toBe(8)
  const vertices = await readVertices()
  // 前置条件：4×4×4 的立方体 + 原点 (-2,-2,-2) ⇒ 八个顶点必须都是 [-2,2]³ 的角，
  // 否则下面"投影对齐"的坐标本身就不可信
  for (const vertex of vertices) {
    expect([-2, 2].includes(vertex.position.x) && [-2, 2].includes(vertex.position.y) && [-2, 2].includes(vertex.position.z), `${vertex.label} 应落在 [-2,2]³ 的角上`).toBe(true)
  }

  const assertLabelsOnTheirVertices = async (phase: string) => {
    for (const vertex of vertices) {
      const label = overlay.locator(`[data-point-id="${vertex.id}"]`)
      await expect(label, `${phase}：${vertex.label} 的标注必须存在`).toHaveCount(1)
      /**
       * 轮询只容忍测试环境里覆盖层的异步落位，不再通过额外的鼠标动作触发补帧。
       * 渲染入口在标签投影前显式同步相机矩阵；缺网格时也有独立单测约束。
       */
      await expect.poll(async () => {
        const projected = await projectWorldPoint(page, vertex.position)
        const anchor = await label.evaluate((node) => {
          const element = node as HTMLElement
          return { left: Number.parseFloat(element.style.left), top: Number.parseFloat(element.style.top) }
        })
        return Math.max(Math.abs(anchor.left - (projected.x - canvasBox.x + 10)), Math.abs(anchor.top - (projected.y - canvasBox.y - 10)))
      }, { message: `${phase}：${vertex.label} 的锚点与它自己顶点的投影偏差(px)` }).toBeLessThan(2)
    }
  }

  await assertLabelsOnTheirVertices("旋转前")

  const azimuthBefore = Number(await scene.getAttribute("data-camera-azimuth"))
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 140, canvasBox.y + canvasBox.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  // 先确认真的转了 —— 否则"旋转后仍对齐"可能只是因为压根没转
  await expect.poll(async () => Number(await scene.getAttribute("data-camera-azimuth"))).not.toBeCloseTo(azimuthBefore, 1)

  // 松手之后不得靠再抖一次指针才把标注追到最终相机位置。
  await assertLabelsOnTheirVertices("旋转后")
})
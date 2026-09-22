import { expect, test, type Locator, type Page } from "@playwright/test"

/**
 * **Reactive DAG 切片的浏览器回归**（设计规格 §4.2/§4.3/§4.4）。
 *
 * 固定场景 `e2e/fixtures/reactive-dynamic-objects.mgeo`：
 *
 * - `轨道` 是一个圆，动点 `P` 绑在它上面（真值是文档参数 `t-P`，坐标是派生缓存）；
 * - `切线` 跟随 `P`（`anchor.kind === "point"`）；
 * - `A/B/C` 是一个直角三角形，`内切圆` 的**圆心与半径都由它算出来**
 *   （`radiusFrom: { kind: "triangle", metric: "inradius" }`）；
 * - `P 的轨迹` 是一只可见的 locus —— 它让"拖动时图会不会被整张重建"这件事真的可测
 *   （fix round 1 / I4：单槽位缓存会在含 locus 的文档里每帧重建两次，读数退化成整图求值）。
 *
 * 四条断言各自钉一件事：
 * 1. 拖动期间下游对象（切线）**在抬手之前**就跟着更新，且 `data-reactive-diagnostics` 为 0；
 * 2. `data-reactive-evaluated-ids` 只包含被拖动动点的下游闭包 —— 三角形内切圆不该被算（规格 §4.2 的增量），
 *    **即使文档里有 locus**；
 * 3. 拖动期间出现**临时轨迹**（内存缓冲，抬手即消失），而整次拖动只占**一步撤销**；
 * 4. 拖动**自由点**（坐标不是 evaluator 算出来的）不画轨迹。
 */

const SVG = 'svg[aria-label="几何画布"]'

async function pointPosition(svg: Locator, label: string): Promise<{ x: number; y: number }> {
  const group = svg.locator('[data-primitive-type="point"]', { hasText: label }).first()
  const circle = group.locator("circle:not([data-hit-target])").first()
  return { x: Number(await circle.getAttribute("cx")), y: Number(await circle.getAttribute("cy")) }
}

/** 可见的切线（命中带那条线不算）：拖动时它必须跟着切点走。 */
async function tangentEndpoints(svg: Locator): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  const line = svg.locator('[data-primitive-type="tangent"] line:not([data-hit-target])').first()
  return {
    x1: Number(await line.getAttribute("x1")),
    y1: Number(await line.getAttribute("y1")),
    x2: Number(await line.getAttribute("x2")),
    y2: Number(await line.getAttribute("y2"))
  }
}

/** 可见的圆（排除圆心标记与命中带）。 */
async function circleGeometry(svg: Locator, label: string): Promise<{ cx: number; cy: number; r: number }> {
  const group = svg.locator('[data-primitive-type="circle"]', { hasText: label }).first()
  const circle = group.locator("circle:not([data-hit-target]):not([data-shape-centre])").first()
  return { cx: Number(await circle.getAttribute("cx")), cy: Number(await circle.getAttribute("cy")), r: Number(await circle.getAttribute("r")) }
}

/** 抓住某个点（点最上面那圈命中区）并拖若干步。 */
async function dragPoint(page: Page, svg: Locator, label: string, steps: readonly { x: number; y: number }[]): Promise<void> {
  const handle = svg.locator('[data-primitive-type="point"]', { hasText: label }).first().locator('circle[data-hit-target="true"]').last()
  const box = (await handle.boundingBox())!
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (const step of steps) await page.mouse.move(start.x + step.x, start.y + step.y)
}

test("refreshes downstream objects from the reactive graph while a dynamic point is dragged", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/reactive-dynamic-objects.mgeo")
  const svg = page.locator(SVG)
  await expect(svg).toBeVisible()
  // 场景里有可见轨迹（`P 的轨迹`）：下面那条增量断言因此在"含 locus"的文档上成立（fix round 1 / I4）。
  await expect(svg.locator('[data-primitive-type="locus"]')).toHaveCount(1)

  const before = await pointPosition(svg, "P")
  const tangentBefore = await tangentEndpoints(svg)

  await dragPoint(page, svg, "P", Array.from({ length: 8 }, (_unused, index) => ({ x: (index + 1) * 4, y: (index + 1) * 6 })))

  // 1) 抬手之前下游就已经更新：切线的端点跟着切点走。
  const tangentDuring = await tangentEndpoints(svg)
  expect(tangentDuring.x1 !== tangentBefore.x1 || tangentDuring.y1 !== tangentBefore.y1).toBe(true)
  // 图的求值没有产生任何退化 / 缺失来源诊断。
  expect(await svg.getAttribute("data-reactive-diagnostics")).toBe("0")
  // 2) 增量：只算下游闭包，与这次拖动无关的三角形内切圆不在里面（locus 在场也一样）。
  const evaluated = (await svg.getAttribute("data-reactive-evaluated-ids")) ?? ""
  expect(evaluated).toContain("tangent-P")
  expect(evaluated).not.toContain("circle-in")
  expect(Number(await svg.getAttribute("data-reactive-evaluated"))).toBeGreaterThan(0)
  /**
   * I4 的判据：拖动路径整个手势里共用**同一张图**。文档里有可见 locus 时，渲染期那份预览文档
   * 的图会把"单缓存槽位"实现里的提交态图挤掉，于是每帧重建（这个读数恒为 false）——
   * 那正是评审指出的"每帧全量重建两次"。`data-reactive-evaluated-ids` 抓不到它（闭包求值本来就是
   * 闭包范围），所以这条读数是必要的。
   */
  expect(await svg.getAttribute("data-reactive-graph-reused")).toBe("true")
  // 3) 拖动期间的临时轨迹（内存缓冲）：画布上真的有这条线，而不是只有一个读数。
  await expect(svg.locator('[data-transient-trace="true"]')).toHaveCount(1)
  expect(Number(await svg.getAttribute("data-reactive-trace"))).toBeGreaterThan(1)

  await page.mouse.up()

  // 抬手后轨迹立刻消失：它不是文档内容，也不该留下历史。
  await expect(svg.locator('[data-transient-trace="true"]')).toHaveCount(0)
  const after = await pointPosition(svg, "P")
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(3)

  // 整次拖动（8 次 pointermove）只有一步撤销。
  await page.keyboard.press("Control+z")
  const restored = await pointPosition(svg, "P")
  expect(restored.x).toBeCloseTo(before.x, 3)
  expect(restored.y).toBeCloseTo(before.y, 3)
})

test("moves a triangle-derived circle when one of its vertices is dragged", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/reactive-dynamic-objects.mgeo")
  const svg = page.locator(SVG)
  await expect(svg).toBeVisible()

  const circleBefore = await circleGeometry(svg, "内切圆")
  // 内切圆的初始几何由文档里的三角形算出来（A(2,0) B(6,0) C(2,3) ⇒ 内心 (3,1)、r=1，
  // 屏幕上的半径还要乘视口缩放，所以这里只钉"画得出一个正半径的圆"）。
  expect(circleBefore.r).toBeGreaterThan(0)

  await dragPoint(page, svg, "C", Array.from({ length: 8 }, (_unused, index) => ({ x: (index + 1) * 6, y: (index + 1) * 5 })))

  // 拖动期间圆心与半径都在变（圆心与半径是同一个三角形的两个下游节点）。
  const circleDuring = await circleGeometry(svg, "内切圆")
  expect(circleDuring.r).not.toBeCloseTo(circleBefore.r, 3)
  expect(await svg.getAttribute("data-reactive-diagnostics")).toBe("0")
  const evaluated = (await svg.getAttribute("data-reactive-evaluated-ids")) ?? ""
  expect(evaluated).toContain("circle-in")
  // 4) 自由点的坐标是**来源值**、不是 evaluator 算出来的：拖它不画临时轨迹（fix round 1 / M4）。
  expect(await svg.getAttribute("data-reactive-trace")).toBe("0")
  await expect(svg.locator('[data-transient-trace="true"]')).toHaveCount(0)

  await page.mouse.up()
  const circleAfter = await circleGeometry(svg, "内切圆")
  expect(circleAfter.r).not.toBeCloseTo(circleBefore.r, 3)

  // 一次撤销回到原来的圆。
  await page.keyboard.press("Control+z")
  const circleRestored = await circleGeometry(svg, "内切圆")
  expect(circleRestored.r).toBeCloseTo(circleBefore.r, 3)
  expect(circleRestored.cx).toBeCloseTo(circleBefore.cx, 3)
})

/** 3D 夹具里截面的顶点坐标（从页面自己写回的草稿里读，WebGL 画布没有 DOM 图元可读）。 */
async function sectionPoints(page: Page): Promise<{ x: number; y: number; z: number }[]> {
  return page.evaluate(() => {
    const stored = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!stored) return []
    const parsed = JSON.parse(stored) as { document?: { primitives?: { id: string; points?: { x: number; y: number; z: number }[] }[] } }
    return parsed.document?.primitives?.find((primitive) => primitive.id === "section-1")?.points ?? []
  })
}

/** 截面点集的无序指纹：重算会按自己的环形顺序输出，比较顺序没有意义。 */
function sectionSignature(points: readonly { x: number; y: number; z: number }[]): string {
  return points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z.toFixed(3)}`).sort().join("|")
}

/** 3D 夹具里某个空间点的坐标（同样从草稿读）。 */async function point3Position(page: Page, id: string): Promise<{ x: number; y: number; z: number } | null> {
  return page.evaluate((pointId) => {
    const stored = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!stored) return null
    const parsed = JSON.parse(stored) as { document?: { primitives?: { id: string; position?: { x: number; y: number; z: number } }[] } }
    return parsed.document?.primitives?.find((primitive) => primitive.id === pointId)?.position ?? null
  }, id)
}

/**
 * **截面随动点更新**（计划 Task 4 的浏览器覆盖，fix round 1 / 第 6 条）。
 *
 * 固定场景 `e2e/fixtures/reactive-section.mgeo`：一只**显式拓扑**的四面体（4 个普通空间点 +
 * 6 条棱 + 4 个三角面 + `polyhedron3`，不带 `construction`，所以每个顶点都是可以单独移动的用户点）
 * 与一个 z=1 的截面（切出一个三角形）。
 *
 * 为什么用四面体而不是长方体：四个面都是三角形，顶点怎么移都仍然共面 —— 移动一个长方体顶点
 * 会让某个四边形面变成"扭曲四边形"，文档随即 **schema 非法**（`face3 points are not coplanar`），
 * 那样测到的就不是截面重算而是"文档存不下去"（这一条是我实现时踩出来的：草稿一直不更新，
 * 排查发现是 `encodeMgeo` 抛了）。
 *
 * 移动顶点 D 之后截面必须重算：这条链是"点 → 多面体 → 截面"（`primitiveDependencies` 的两条边），
 * 少任何一条都会留下一份过期截面。断言读页面自己写回的草稿 —— 3D 画布是 WebGL，没有可读坐标的 DOM 图元。
 */
test("refreshes a solid section when one of its vertices is moved", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.locator('input[aria-label="加载 .mgeo 文件"]').setInputFiles("e2e/fixtures/reactive-section.mgeo")
  await expect(scene).toHaveAttribute("data-section-count", "1")
  await expect.poll(async () => (await sectionPoints(page)).length).toBeGreaterThanOrEqual(3)
  const before = await sectionPoints(page)

  // 选中顶点 D：对象树初始是折叠的（面板里第一个按钮就是展开箭头），展开后点 D 那一行，
  // 再用数值编辑把它沿 Z 挪走 —— 与拖动等价的一条"移动点"路径，而且完全走 DOM，不受 3D 拾取影响。
  const algebra = page.locator(".algebra-panel")
  await algebra.locator("button").first().click()
  const vertexRow = algebra.locator(".object-row").filter({ hasText: /^D\b/ }).first()
  await expect(vertexRow).toBeVisible()
  await vertexRow.click()
  await expect(page.getByRole("spinbutton", { name: "坐标 X" })).toHaveValue("0")
  const coordinateZ = page.getByRole("spinbutton", { name: "坐标 Z" })
  await expect(coordinateZ).toHaveValue("4")
  await coordinateZ.fill("6")

  // 先确认这个点真的动了、而且文档仍然存得下去（否则下面的截面断言会因为"什么都没发生"而假绿）。
  await expect.poll(async () => (await point3Position(page, "point3-D"))?.z).toBeCloseTo(6, 6)
  await expect(page.getByRole("alert")).toHaveCount(0)

  // 截面重算：截面的顶点跟着多面体走（z=1 的刀口在 ABD / ACD 面上往外移）。
  await expect.poll(async () => (await sectionPoints(page)).map((point) => point.x)).not.toEqual(before.map((point) => point.x))
  const after = await sectionPoints(page)
  expect(after.length).toBeGreaterThanOrEqual(3)
  expect(after.every((point) => Math.abs(point.z - 1) < 1e-6)).toBe(true)

  // 一次撤销：截面回到原来的形状（比较**点集**：重算后的环序与夹具里存的顺序可以不同）。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => sectionSignature(await sectionPoints(page))).toEqual(sectionSignature(before))
})

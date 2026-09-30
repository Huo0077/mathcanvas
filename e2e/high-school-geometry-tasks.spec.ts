import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

/**
 * Task 8：高中六类代表题的整合验收 —— 可重放的操作序列。
 *
 * 这份文件**分批落地**，没写进来的题类一律不算完成：
 *   ① 三棱锥 / ② 四棱锥 / ③ 斜三棱柱 / ④ 异长长方体 / ⑤ 圆锥截面 / ⑥ 空间直线与平面的关系   <- 已落地
 *   ⑦ 已有文档恢复与撤销   <- 尚未落地
 *
 * 每题断言四件事，且都取**算得出来的数**，不取"看着像"：
 *   类型与名称、精确几何（坐标 / 尺寸 / 拉伸向量）、依赖（拓扑子对象）、保存与一步撤销。
 *
 * 几何按 `spatialSolidWizardModel.ts` 的口径算，不照抄界面读数：
 *   底面（三）：origin、(origin.x+w, origin.y, origin.z)、(origin.x+w/2, origin.y+d, origin.z)
 *   底面（四）：再加上 (origin.x, origin.y+d, origin.z)
 *   棱柱 = 底面沿 (倾斜 X, 倾斜 Y, 拉伸向量 Z) 平移；棱锥顶点 = 底面中心 + 法向 × 法向高度 + (顶点偏移 X, 顶点偏移 Y, 0)
 *
 * 圆锥截面按**解析圆锥曲线**判据（`conicMetrics.ts` 的读数，不照抄界面）：
 *   默认圆锥 tanα = 1.5/3 = 0.5（半顶角）；剖切面法向与锥轴夹角 θ ⇒ 离心率 e = sinθ / cosα。
 *   e = 0 圆 / 0 < e < 1 椭圆 / e > 1 双曲线；水平切时半径 r(z) = 1.5·(1 − z/3)，z 由剖切面常数算出。
 *   切面方程是 n·x + c = 0（`markers3d.ts` 的口径），所以水平切的高度 z = −c。
 *
 * 直线与平面的关系由**平面方程**判定：`plane3` 并不存法向，只存三点定义，所以法向与常数在测试里独立算出。
 *   n·d ≈ 0 且 n·P + c ≈ 0 ⇒ 线在面内；n·d ≈ 0 但 n·P + c ≠ 0 ⇒ 平行且不共面。两者必须能被区分开。
 */

interface SavedVec3 {
  x: number
  y: number
  z: number
}

interface SavedPrimitive {
  id: string
  type: string
  label?: string
  origin?: SavedVec3
  size?: SavedVec3
  position?: SavedVec3
  vertexIds?: string[]
  /** `line3` / `plane3` 只存"过哪些点"，法向与常数是**导出量**。 */
  definition?: { kind: string; pointIds?: string[]; pointId?: string; normal?: SavedVec3; direction?: SavedVec3 }
}

const subtract = (first: SavedVec3, second: SavedVec3): SavedVec3 => ({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z })
const dot = (first: SavedVec3, second: SavedVec3): number => first.x * second.x + first.y * second.y + first.z * second.z
const cross = (first: SavedVec3, second: SavedVec3): SavedVec3 => ({
  x: first.y * second.z - first.z * second.y,
  y: first.z * second.x - first.x * second.z,
  z: first.x * second.y - first.y * second.x
})
const vectorLength = (vector: SavedVec3): number => Math.hypot(vector.x, vector.y, vector.z)
const scaleVector = (vector: SavedVec3, factor: number): SavedVec3 => ({ x: vector.x * factor, y: vector.y * factor, z: vector.z * factor })

interface SavedEnvelope {
  document: { primitives: SavedPrimitive[] }
}

const DRAFT_KEY = "mathcanvas:draft:geometry3d"

test.beforeEach(async ({ page }) => {
  // 草稿会跨用例恢复，实体编号（三棱锥 1 / 三棱柱 1 …）会跟着漂，所以每个用例从空图纸开始。
  await page.addInitScript(() => localStorage.clear())
})

/** 打开「常用立体」并按标签填参数：高度那一栏的名字随预设变（棱长 / 高度 / 拉伸向量 Z / 法向高度）。 */
async function createSolid(page: Page, preset: string, values: Array<[string, string]>) {
  await page.getByRole("button", { name: "常用立体" }).click()
  const wizard = page.getByRole("dialog", { name: "常用立体" })
  await wizard.getByRole("combobox", { name: "立体类型" }).selectOption(preset)
  for (const [label, value] of values) await wizard.getByRole("spinbutton", { name: label }).fill(value)
  await wizard.getByRole("button", { name: "确认创建" }).click()
}

/** `polyhedron3` 不存坐标，只存指向 `point3` 的 id —— 断言几何必须先把顶点解析出来。 */
function topologyVertices(primitives: SavedPrimitive[]): SavedVec3[] {
  const polyhedron = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
  if (!polyhedron?.vertexIds) throw new Error("保存的文档里没有 polyhedron3 拓扑")
  return polyhedron.vertexIds.map((id) => {
    const point = primitives.find((candidate) => candidate.id === id)
    if (!point?.position) throw new Error(`拓扑顶点 ${id} 没有对应的 point3 坐标`)
    return point.position
  })
}

/** 顶点的规范化表示：顺序无关，便于"逐点一致"的比较。 */
function coordinates(vertices: SavedVec3[]): string[] {
  return vertices.map((vertex) => `${vertex.x},${vertex.y},${vertex.z}`).sort()
}

/** 走页面自己的「保存 .mgeo」下载真实产物，而不是去读 localStorage。 */
async function readSavedDocument(page: Page): Promise<SavedEnvelope> {
  const download = page.waitForEvent("download")
  await page.getByRole("navigation", { name: "工作模式" }).getByRole("button", { name: "保存 .mgeo" }).click()
  const path = await (await download).path()
  if (!path) throw new Error("保存没有产生可读文件")
  return JSON.parse(await readFile(path, "utf8")) as SavedEnvelope
}

/** 重新打开一份保存出来的文档：同样走页面自己的加载入口。 */
async function reopen(page: Page, envelope: SavedEnvelope) {
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({
    name: "high-school-geometry-tasks.mgeo",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(envelope))
  })
}

async function draftPrimitives(page: Page): Promise<SavedPrimitive[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as SavedEnvelope).document.primitives : []
  }, DRAFT_KEY)
}

/** 剖切面的真实方程（`section.plane` 满足 n·x + c = 0，法向已单位化）。 */
async function sectionPlane(page: Page): Promise<{ normal: number[]; constant: number }> {
  const scene = page.locator("[data-3d-scene]")
  const normal = ((await scene.getAttribute("data-section-plane-normal")) ?? "").split(",").map(Number)
  const constant = Number(await scene.getAttribute("data-section-plane-constant"))
  if (normal.length !== 3 || normal.some((value) => !Number.isFinite(value)) || !Number.isFinite(constant)) throw new Error("剖切面读数不可用")
  return { normal, constant }
}

/** 「解析截面」面板：锥 / 柱切出来的精确圆锥曲线读数都渲染在这里。 */
function conicPanel(page: Page) {
  return page.locator(".primitive-properties").filter({ has: page.getByRole("heading", { name: "解析截面" }) })
}

/** 按标签读一行解析读数；行不存在就**报错**，而不是悄悄拿到一个 undefined。 */
async function conicNumber(page: Page, label: string): Promise<number> {
  const cell = conicPanel(page).locator(".metric-grid span").filter({ hasText: label }).first()
  const value = Number(await cell.locator("strong").innerText())
  if (!Number.isFinite(value)) throw new Error(`解析截面没有可读的「${label}」`)
  return value
}

test("三棱锥：底面三点与法向高度精确，拓扑可展开，一步撤销不留残留", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await createSolid(page, "tri-pyramid", [["底面宽", "4"], ["底面深", "3"], ["法向高度", "5"], ["顶点偏移 X", "1"], ["顶点偏移 Y", "-1"]])

  const algebra = page.locator(".algebra-panel")
  await expect(algebra.getByText("三棱锥 1").first()).toBeVisible()

  // 依赖：实体的拓扑子对象必须挂在它自己的行下面，而不是散成独立图元。
  // 注意两类实体的挂法**不同**（实测，不是笔误）：模板实体（立方体）多一层「拓扑」子实体，
  // 展开按钮叫「展开 立方体 1 拓扑 的子对象」；多面体实体（棱柱/棱锥）直接挂子对象，叫「展开 三棱锥 1 的子对象」。
  await algebra.getByRole("button", { name: "展开 三棱锥 1 的子对象" }).click()
  await expect(algebra.getByText("顶点", { exact: true })).toBeVisible()
  await expect(algebra.getByText("棱", { exact: true })).toBeVisible()
  await expect(algebra.getByText("面", { exact: true })).toBeVisible()

  const saved = await readSavedDocument(page)
  const vertices = topologyVertices(saved.document.primitives)
  expect(vertices).toHaveLength(4)
  const cloud = coordinates(vertices)
  for (const base of [[0, 0, 0], [4, 0, 0], [2, 3, 0]]) expect(cloud).toContain(base.join(","))

  // 顶点：底面中心 (2,1,0) + 法向 × 5 + 偏移 (1,-1)。高度取绝对值：
  // 底面法向朝上还是朝下由 planeThroughPoints 的定向决定，两种都是同一个棱锥，不是数学判据。
  const apex = vertices.find((vertex) => vertex.z !== 0)
  expect(apex?.x).toBeCloseTo(3, 6)
  expect(apex?.y).toBeCloseTo(0, 6)
  expect(Math.abs(apex?.z ?? 0)).toBeCloseTo(5, 6)

  // 一步撤销：实体与它的拓扑子对象整批消失
  await page.keyboard.press("Control+z")
  await expect(algebra.getByText("三棱锥 1")).toHaveCount(0)
  await expect(algebra.getByText("顶点", { exact: true })).toHaveCount(0)
})

test("四棱锥：顶点偏移精确，保存后重新打开几何逐点不变", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await createSolid(page, "quad-pyramid", [["底面宽", "4"], ["底面深", "3"], ["法向高度", "5"], ["顶点偏移 X", "1"], ["顶点偏移 Y", "-1"]])

  const algebra = page.locator(".algebra-panel")
  await expect(algebra.getByText("四棱锥 1").first()).toBeVisible()

  const saved = await readSavedDocument(page)
  const vertices = topologyVertices(saved.document.primitives)
  expect(vertices).toHaveLength(5)
  const before = coordinates(vertices)
  for (const base of [[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0]]) expect(before).toContain(base.join(","))
  // 底心 (2,1.5,0) + 偏移 (1,-1) ⇒ 顶点落在 (3,0.5,±5)
  const apex = vertices.find((vertex) => vertex.z !== 0)
  expect(apex?.x).toBeCloseTo(3, 6)
  expect(apex?.y).toBeCloseTo(0.5, 6)
  expect(Math.abs(apex?.z ?? 0)).toBeCloseTo(5, 6)

  // 保存 → 重新打开：几何必须逐点一致（这是"可保存恢复"的可复核判据，不是"文件里有东西"）
  await reopen(page, saved)
  await expect(algebra.getByText("四棱锥 1").first()).toBeVisible()
  expect(coordinates(topologyVertices(await draftPrimitives(page)))).toEqual(before)
})

test("斜三棱柱：底面三点沿拉伸向量精确平移，一步撤销", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await createSolid(page, "tri-prism", [["底面宽", "4"], ["底面深", "3"], ["拉伸向量 Z", "5"], ["倾斜 X", "1"], ["倾斜 Y", "-2"]])

  const algebra = page.locator(".algebra-panel")
  await expect(algebra.getByText("三棱柱 1").first()).toBeVisible()

  const saved = await readSavedDocument(page)
  const vertices = topologyVertices(saved.document.primitives)
  expect(vertices).toHaveLength(6)
  const cloud = coordinates(vertices)
  // 斜棱柱的判据：底面每个点 + 拉伸向量都必须是顶点（"斜"就斜在这里，不是靠外观断言）
  for (const base of [[0, 0, 0], [4, 0, 0], [2, 3, 0]]) {
    expect(cloud).toContain(base.join(","))
    expect(cloud).toContain([base[0] + 1, base[1] - 2, base[2] + 5].join(","))
  }

  await page.keyboard.press("Control+z")
  await expect(algebra.getByText("三棱柱 1")).toHaveCount(0)
})

test("异长长方体：三边尺寸与原点精确落盘，保存往返后尺寸不变", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await createSolid(page, "box", [["底面宽", "4"], ["底面深", "3"], ["高度", "2"]])

  const algebra = page.locator(".algebra-panel")
  await expect(algebra.getByText("长方体 1").first()).toBeVisible()
  await expect(page.getByRole("spinbutton", { name: "尺寸 X" })).toHaveValue("4")
  await expect(page.getByRole("spinbutton", { name: "尺寸 Y" })).toHaveValue("3")
  await expect(page.getByRole("spinbutton", { name: "尺寸 Z" })).toHaveValue("2")

  const saved = await readSavedDocument(page)
  const box = saved.document.primitives.find((primitive) => primitive.type === "cube")
  expect(box?.size).toEqual({ x: 4, y: 3, z: 2 })
  expect(box?.origin).toEqual({ x: 0, y: 0, z: 0 })
  // 拓扑一并落盘：否则重新打开会只剩一个光壳
  expect(saved.document.primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)

  await reopen(page, saved)
  await algebra.getByText("长方体 1").first().click()
  await expect(page.getByRole("spinbutton", { name: "尺寸 X" })).toHaveValue("4")
  await expect(page.getByRole("spinbutton", { name: "尺寸 Y" })).toHaveValue("3")
  await expect(page.getByRole("spinbutton", { name: "尺寸 Z" })).toHaveValue("2")
})

test("圆锥截面：水平切得圆（半径按锥面算出），斜切按 e = sinθ / cosα 判椭圆与双曲线", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  // 默认圆锥：底心 (-5,-5,0)、底半径 1.5、高 3、轴为 +Z ⇒ 半顶角 α 满足 tanα = 1.5 / 3 = 0.5
  await page.getByRole("button", { name: "添加圆锥" }).click()
  await page.getByRole("button", { name: "创建截面" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-section-count", "1")
  const halfAngleCos = 2 / Math.sqrt(5)
  const eccentricityFor = (normalZ: number) => Math.sqrt(1 - normalZ * normalZ) / halfAngleCos

  // ---- 水平切：必须是**圆**，半径由剖切面的高度按锥面算出（r(z) = 1.5·(1 − z/3)） ----
  const level = await sectionPlane(page)
  expect(level.normal.map((value) => Math.abs(value))).toEqual([0, 0, 1])
  const cutZ = -level.constant
  const expectedRadius = 1.5 * (1 - cutZ / 3)
  expect(expectedRadius).toBeGreaterThan(0) // 刀口确实落在锥体高度内，否则下面全是空断言
  await expect(scene).toHaveAttribute("data-section-exact-kind", "circle")
  await expect(conicPanel(page)).toContainText("圆")
  expect(await conicNumber(page, "半径")).toBeCloseTo(expectedRadius, 3)
  expect(await conicNumber(page, "离心率")).toBeCloseTo(0, 3)
  // 整圆没被端面裁切 ⇒ 面积给闭式 πr²，与半径自洽（不是印一个"有面积"）
  await expect(conicPanel(page)).toContainText(`${(Math.PI * expectedRadius * expectedRadius).toFixed(3)}（πab 精确）`)

  // ---- 绕 Y 轴转 60°：平面与轴夹角 β = 30° > α ⇒ 椭圆 ----
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "绕 Y 轴旋转剖切面 +15°" }).click()
  await expect(scene).toHaveAttribute("data-section-exact-kind", "ellipse")
  const tilted = await sectionPlane(page)
  expect(Math.abs(tilted.normal[2])).toBeCloseTo(Math.cos(Math.PI / 3), 2)
  await expect(conicPanel(page)).toContainText("椭圆")
  expect(await conicNumber(page, "离心率")).toBeCloseTo(eccentricityFor(tilted.normal[2]), 2)
  expect(await conicNumber(page, "长半轴")).toBeGreaterThan(await conicNumber(page, "短半轴"))

  // ---- 再转 15°（共 75°）：β = 15° < α ⇒ 双曲线（圆柱永远切不出这个结论） ----
  await page.getByRole("button", { name: "绕 Y 轴旋转剖切面 +15°" }).click()
  await expect(scene).toHaveAttribute("data-section-exact-kind", "hyperbola")
  const steep = await sectionPlane(page)
  expect(Math.abs(steep.normal[2])).toBeCloseTo(Math.cos((75 * Math.PI) / 180), 2)
  await expect(conicPanel(page)).toContainText("双曲线")
  const hyperbolaEccentricity = await conicNumber(page, "离心率")
  expect(hyperbolaEccentricity).toBeGreaterThan(1)
  expect(hyperbolaEccentricity).toBeCloseTo(eccentricityFor(steep.normal[2]), 2)

  // 一步撤销：旋转是**文档编辑**（`rotateSectionPlane`），退一步就回到上一刀，而不是把截面整块删掉
  await page.keyboard.press("Control+z")
  await expect(scene).toHaveAttribute("data-section-exact-kind", "ellipse")
  await expect(scene).toHaveAttribute("data-section-count", "1")
})

test("空间直线与平面的关系：线在面内与平行不共面由平面方程判定，点到平面距离测得 3.000", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const algebra = page.locator(".algebra-panel")

  // 用**精确坐标**放点：画布投影只到 1e-2 量级，不足以判定"线是否真的落在面内"
  const placePoint = async (label: string, position: [string, string, string]) => {
    await page.getByRole("button", { name: "添加空间点" }).click()
    await algebra.getByText(label, { exact: true }).click()
    for (const [axis, value] of [["X", position[0]], ["Y", position[1]], ["Z", position[2]]] as const) {
      await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).fill(value)
    }
  }
  await placePoint("A", ["0", "0", "0"])
  await placePoint("B", ["2", "0", "0"])
  await placePoint("C", ["0", "2", "0"]) // ⇒ 平面 z = 0
  await placePoint("D", ["0.5", "0.5", "0"])
  await placePoint("E", ["1.5", "0.5", "0"]) // 面内直线（z = 0）
  await placePoint("F", ["0.5", "0.5", "3"])
  await placePoint("G", ["1.5", "0.5", "3"]) // 与平面平行但不共面（距面 3）

  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await algebra.getByText("C", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "由选中点创建空间平面", exact: true }).click()
  await expect(algebra.getByText("空间平面 1").first()).toBeVisible()

  const createLine = async (first: string, second: string) => {
    await algebra.getByText(first, { exact: true }).click()
    await algebra.getByText(second, { exact: true }).click({ modifiers: ["Shift"] })
    await page.getByRole("button", { name: "由选中点创建空间直线", exact: true }).click()
  }
  await createLine("D", "E")
  await createLine("F", "G")
  await expect(algebra.getByText("空间直线 1").first()).toBeVisible()
  await expect(algebra.getByText("空间直线 2").first()).toBeVisible()

  // 关系判定：`plane3` 只存三点定义，所以法向与常数在这里**独立算出来**，不读界面上那两行字
  const saved = await readSavedDocument(page)
  const primitives = saved.document.primitives
  const coordinatesOf = (id: string): SavedVec3 => {
    const point = primitives.find((candidate) => candidate.id === id)
    if (!point?.position) throw new Error(`点 ${id} 没有坐标`)
    return point.position
  }
  const plane = primitives.find((primitive) => primitive.type === "plane3")
  const planePoints = (plane?.definition?.pointIds ?? []).map(coordinatesOf)
  const [planeA, planeB, planeC] = planePoints
  if (!planeA || !planeB || !planeC) throw new Error("空间平面缺少三点定义")
  const rawNormal = cross(subtract(planeB, planeA), subtract(planeC, planeA))
  const unitNormal = scaleVector(rawNormal, 1 / vectorLength(rawNormal))
  const planeConstant = -dot(unitNormal, planeA)
  expect(unitNormal.z).toBeCloseTo(1, 9) // 平面就是 z = 0
  expect(planeConstant).toBeCloseTo(0, 9)

  const lines = primitives.filter((primitive) => primitive.type === "line3")
  expect(lines).toHaveLength(2)
  const relations = lines.map((line) => {
    const ids = line.definition?.pointIds ?? []
    const first = ids[0] ? coordinatesOf(ids[0]) : null
    const second = ids[1] ? coordinatesOf(ids[1]) : null
    if (!first || !second) throw new Error("空间直线缺少两点定义")
    const unitDirection = scaleVector(subtract(second, first), 1 / vectorLength(subtract(second, first)))
    return {
      parallelResidual: Math.abs(dot(unitNormal, unitDirection)), // 0 ⇒ 与平面平行
      offset: dot(unitNormal, first) + planeConstant // 0 ⇒ 整条线落在平面内
    }
  })
  // 两条线都必须与平面平行；再按偏移区分"在面内"与"平行但不共面" —— 只测一条线是分不出这两种关系的
  for (const relation of relations) expect(relation.parallelResidual).toBeLessThan(1e-9)
  const offsets = relations.map((relation) => Math.abs(relation.offset)).sort((first, second) => first - second)
  expect(offsets[0]).toBeLessThan(1e-9)
  expect(offsets[1]).toBeCloseTo(3, 6)

  // 产品自己的关系读数：点 F 到平面 z = 0 的距离。
  // **来源顺序有要求**（实测 + 代码一致）：内核 `evaluateMeasurement3` 的 distance 分支按
  // `sourceIds[0]` 是点、`sourceIds[1]` 是平面3 来取数（`measurements3d.ts` 的 `pointFromPrimitive` 对
  // `plane3` 返回 null）。反过来选（平面在前）时按钮照样出现，却只会得到一条 `invalid` 读数、画布不出数字——
  // 这是已记档的真缺陷，本用例按**可用顺序**断言"点 → 平面"，不把无效行为当成正确行为钉住。
  await algebra.getByText("F", { exact: true }).click()
  await algebra.getByText("空间平面 1").first().click({ modifiers: ["Shift"] })
  await page.locator('[aria-label="三维测量工具"]').getByRole("button", { name: "距离", exact: true }).click()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-measurement-labels", "1")
  await expect(page.locator(".three-measurement-label")).toHaveText(/距离：3\.000u/)
  // 这条读数是产品自己算出来的：它的来源与状态都在对象列表里可查
  await expect(algebra.locator(".measurement-row .measurement-status")).toHaveAttribute("data-status", "valid")

  // 一步撤销：这次测量是一个完整的构造动作，退一步就整条撤掉
  await page.keyboard.press("Control+z")
  await expect(page.locator(".three-measurement-label")).toHaveCount(0)
})

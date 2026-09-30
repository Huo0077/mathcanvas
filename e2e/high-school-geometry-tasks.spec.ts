import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

/**
 * Task 8：高中六类代表题的整合验收 —— 可重放的操作序列。
 *
 * 这份文件**分批落地**，没写进来的题类一律不算完成：
 *   ① 三棱锥 / ② 四棱锥 / ③ 斜三棱柱 / ④ 异长长方体        <- 本批已落地
 *   ⑤ 圆锥截面 / ⑥ 空间直线与平面的关系 / ⑦ 已有文档恢复与撤销   <- 尚未落地
 *
 * 每题断言四件事，且都取**算得出来的数**，不取"看着像"：
 *   类型与名称、精确几何（坐标 / 尺寸 / 拉伸向量）、依赖（拓扑子对象）、保存与一步撤销。
 *
 * 几何按 `spatialSolidWizardModel.ts` 的口径算，不照抄界面读数：
 *   底面（三）：origin、(origin.x+w, origin.y, origin.z)、(origin.x+w/2, origin.y+d, origin.z)
 *   底面（四）：再加上 (origin.x, origin.y+d, origin.z)
 *   棱柱 = 底面沿 (倾斜 X, 倾斜 Y, 拉伸向量 Z) 平移；棱锥顶点 = 底面中心 + 法向 × 法向高度 + (顶点偏移 X, 顶点偏移 Y, 0)
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
}

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

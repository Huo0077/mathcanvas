import { expect, test } from "@playwright/test"
import * as THREE from "three"

/** Project a world point through the default 3D camera so a test can click exactly on it. */
function projectDefaultCamera(box: { x: number; y: number; width: number; height: number }, point: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera(42, box.width / box.height, 0.1, 1000)
  const horizontal = 16 * Math.cos(30 * Math.PI / 180)
  camera.position.set(horizontal * Math.cos(Math.PI / 4), 16 * Math.sin(30 * Math.PI / 180), horizontal * Math.sin(Math.PI / 4))
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const projected = point.clone().project(camera)
  return { x: box.x + (projected.x * 0.5 + 0.5) * box.width, y: box.y + (0.5 - projected.y * 0.5) * box.height }
}

test("opens the 3D workspace and adds a parameterized cube", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toBeVisible()
  await expect(page.getByRole("button", { name: "重置3D视角" })).toBeVisible()
  await page.getByRole("button", { name: "重置3D视角" }).click()
  for (const label of ["透明面", "隐藏边", "法向量"]) {
    const control = page.getByRole("button", { name: label })
    await expect(control).toHaveAttribute("aria-pressed", "false")
    await control.click()
    await expect(control).toHaveAttribute("aria-pressed", "true")
  }
  const unfold = page.getByRole("button", { name: "展开" })
  await expect(unfold).toHaveAttribute("aria-pressed", "false")
  await unfold.click()
  await expect(page.getByRole("button", { name: "折叠" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "测量二面角" }).click()
  await expect(page.getByText(/二面角：90\.0°/)).toBeVisible()
  await expect(page.getByText("添加立方体")).toBeVisible()

  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "尺寸 X" }).fill("5")
  await expect(page.getByRole("spinbutton", { name: "尺寸 X" })).toHaveValue("5")
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(page.getByText("截面 1").first()).toBeVisible()
  await page.getByRole("button", { name: "添加棱锥" }).click()
  await expect(page.getByText("棱锥 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "高度" }).fill("5")
  await expect(page.getByRole("spinbutton", { name: "高度" })).toHaveValue("5")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(page.getByText("圆柱 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "半径 3D" }).fill("2")
  await expect(page.getByRole("spinbutton", { name: "半径 3D" })).toHaveValue("2")
  await page.getByRole("button", { name: "添加圆锥" }).click()
  await expect(page.getByText("圆锥 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "高度" }).fill("6")
  await expect(page.getByRole("spinbutton", { name: "高度" })).toHaveValue("6")
  await expect(scene).toHaveAttribute("aria-label", "3D 几何场景")
})

test("picks spatial points and turns them into a teaching measurement", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })

  await page.locator('[aria-label="三维测量工具"]').getByRole("button", { name: "距离", exact: true }).click()

  await expect(algebra.getByText("教学测量")).toBeVisible()
  await expect(algebra.getByText("距离测量")).toBeVisible()
  await expect(algebra.getByText(/由两个空间点/)).toBeVisible()
  await expect(page.locator(".measurement-status")).toHaveAttribute("data-status", "valid")
})

test("nests spatial topology under an expandable algebra row", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const algebra = page.locator(".algebra-panel")
  const expand = algebra.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" })
  await expand.click()

  await expect(algebra.getByText("顶点", { exact: true })).toBeVisible()
  await expect(algebra.getByText("棱", { exact: true })).toBeVisible()
  await expect(algebra.getByText("面", { exact: true })).toBeVisible()
  await expect(algebra.getByRole("button", { name: "收起 立方体 1 拓扑 的子对象" })).toBeVisible()
})

test("cuts point-driven topology into a visible section", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("立方体 1 拓扑").click()
  await page.getByRole("button", { name: "创建截面" }).click()

  await expect(algebra.getByText("截面 1")).toBeVisible()
  await expect(algebra.getByRole("button", { name: "隐藏 截面 1" })).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
})

const cubeStyle = (page: import("@playwright/test").Page, prefix: string) => page.evaluate((idPrefix) => {
  const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
  const primitives = raw ? (JSON.parse(raw) as { document: { primitives: { id: string; style?: Record<string, string> }[] } }).document.primitives : []
  return primitives.filter((primitive) => primitive.id.startsWith(idPrefix)).map((primitive) => primitive.style?.fill ?? primitive.style?.stroke ?? "none")
}, prefix)

test("selects a solid by clicking its body and recolours it repeatedly", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  // A template solid is drawn through its generated topology, so the canvas used to have no way back to the solid.
  const canvas = page.locator("[data-3d-scene] canvas")
  const box = (await canvas.boundingBox())!
  // Click far outside the solid but inside the scene, clear of the overlay controls at the top corners.
  await page.mouse.click(box.x + 6, box.y + box.height * 0.6)
  await expect(page.locator(".property-card-heading h3")).toHaveCount(0)

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator(".property-card-heading h3")).toHaveText("立方体 1")

  for (const colour of ["#ff0000", "#00ff00", "#8b5cf6"]) {
    await page.getByLabel("填充颜色").fill(colour)
    await expect(page.getByLabel("填充颜色")).toHaveValue(colour)
    const fills = await cubeStyle(page, "cube-1-face-")
    expect(fills).toHaveLength(6)
    expect(new Set(fills)).toEqual(new Set([colour]))
  }
})

test("picks the vertex under the cursor instead of one hidden behind the solid", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const heading = page.locator(".property-card-heading h3")
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!

  // The camera looks from (+x, +y, +z), so this corner is the nearest one and its handle is reachable.
  const nearest = projectDefaultCamera(box, new THREE.Vector3(2, 2, 1))
  await page.mouse.click(nearest.x, nearest.y)
  await expect(heading).toHaveText(/^[A-H]$/)

  // Clicking well clear of that handle falls back to the whole solid.
  await page.mouse.click(nearest.x + 24, nearest.y + 24)
  await expect(heading).toHaveText("立方体 1")

  // The opposite corner is hidden behind the solid: the click must stay on the solid rather than reach through it.
  const hidden = projectDefaultCamera(box, new THREE.Vector3(-2, -2, -1))
  await page.mouse.click(hidden.x, hidden.y)
  await expect(heading).toHaveText("立方体 1")

  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("deletes a solid together with the topology it generated", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const algebra = page.locator(".algebra-panel")
  await expect(algebra.getByText("立方体 1 拓扑")).toBeVisible()

  await algebra.getByText("立方体 1", { exact: true }).first().click()
  await page.keyboard.press("Delete")

  // The parameter row, the polyhedron and all 8 vertices / 12 edges / 6 faces go together.
  await expect(algebra.locator(".object-row")).toHaveCount(0)
  await expect(page.getByText("添加点、线或面开始探索三维空间。")).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)

  // One undo brings the whole family back: 1 cube + 1 polyhedron + 8 vertices + 12 edges + 6 faces.
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(algebra.getByText("立方体 1", { exact: true })).toBeVisible()
  await expect(algebra.getByText("立方体 1 拓扑")).toBeVisible()
  await expect(algebra.locator(".object-count")).toHaveText("28")
  await algebra.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }).click()
  await expect(algebra.getByText("棱 12", { exact: true })).toBeVisible()
  await expect(algebra.getByText("A", { exact: true })).toBeVisible()
})

test("still refuses to delete a solid another object depends on", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "创建截面" }).click()

  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("立方体 1", { exact: true }).first().click()
  await page.keyboard.press("Delete")

  await expect(page.getByRole("alert")).toContainText("object is referenced by another object")
  await expect(algebra.getByText("立方体 1", { exact: true })).toBeVisible()
})

test("builds a visible plane from three selected points", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  const hint = page.locator("[data-point3-hint]")
  await expect(hint).toContainText("按住 Shift")

  // Default placement must keep the first three points off a single line, or a plane is impossible.
  for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: "添加空间点" }).click()
  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await expect(hint).toContainText("可以创建直线")
  await algebra.getByText("C", { exact: true }).click({ modifiers: ["Shift"] })
  await expect(hint).toContainText("平面")

  await page.getByRole("button", { name: "由选中点创建空间平面" }).click()

  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(algebra.getByText("空间平面 1")).toBeVisible()
  // The plane used to exist only in the document; now the scene actually draws it.
  await expect(scene).toHaveAttribute("data-plane-count", "1")
  await algebra.getByText("空间平面 1").first().click()
  await expect(page.getByLabel("填充颜色")).toBeEnabled()
})

test("frames an opened figure instead of leaving it a speck", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-camera-distance", "16.00")

  // A one-unit tetrahedron: without fitting it opens as a dot sixteen units away.
  const canvas = page.locator("[data-3d-scene] canvas")
  await expect(canvas).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/tetrahedron.mgeo")

  await expect(scene).toHaveAttribute("data-camera-target", "0.50,0.50,0.50")
  const distance = Number(await scene.getAttribute("data-camera-distance"))
  expect(distance).toBeLessThan(6)
  expect(distance).toBeGreaterThanOrEqual(3)

  // The camera must stay where the user put it while they keep editing.
  await page.getByRole("button", { name: "添加空间点" }).click()
  await expect(scene).toHaveAttribute("data-camera-distance", distance.toFixed(2))

  // And the explicit control reframes on demand — the figure grew by a point, so it pulls back a little.
  await page.locator("[data-3d-scene] canvas").hover()
  await page.mouse.wheel(0, -600)
  const zoomed = Number(await scene.getAttribute("data-camera-distance"))
  expect(zoomed).toBeLessThan(distance)
  await page.getByRole("button", { name: "适应视图" }).click()
  const refitted = Number(await scene.getAttribute("data-camera-distance"))
  expect(refitted).toBeGreaterThan(zoomed)
  expect(refitted).toBeLessThan(8)
})

test("unfolds point-driven topology into a flat net and folds it back", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-unfold-faces", "0")

  await page.getByRole("button", { name: "展开", exact: true }).click()

  // A cube net is six faces laid out flat, driven by the materialized polyhedron topology.
  await expect(scene).toHaveAttribute("data-unfold-faces", "6")
  await expect(scene).toHaveAttribute("data-unfold-progress", "1.00")
  await expect(page.getByRole("button", { name: "折叠", exact: true })).toHaveAttribute("aria-pressed", "true")

  await page.getByRole("button", { name: "折叠", exact: true }).click()
  await expect(scene).toHaveAttribute("data-unfold-faces", "0")
})

test("explains a dihedral angle with its common edge and canvas markers", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const algebra = page.locator(".algebra-panel")
  await algebra.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }).click()
  await algebra.getByText("面 1", { exact: true }).click()
  await algebra.getByText("面 3", { exact: true }).click({ modifiers: ["Shift"] })

  await page.getByRole("button", { name: "二面角内角", exact: true }).click()

  await expect(algebra.getByText("二面角内角", { exact: true })).toBeVisible()
  await expect(algebra.getByText(/公共棱/)).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-dihedral-markers", "1")

  await page.getByRole("button", { name: "二面角外角", exact: true }).click()
  await expect(algebra.getByText("二面角外角", { exact: true })).toBeVisible()
})

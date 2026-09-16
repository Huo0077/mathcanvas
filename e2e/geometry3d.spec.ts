import { expect, test } from "@playwright/test"
import * as THREE from "three"

/** Project a world point through the default 3D camera so a test can click exactly on it. */
function projectDefaultCamera(box: { x: number; y: number; width: number; height: number }, point: THREE.Vector3) {
  const camera = new THREE.PerspectiveCamera(42, box.width / box.height, 0.1, 1000)
  // Mirrors applyCameraState: azimuth 45, elevation 30, and world Z as the up axis.
  const horizontal = 16 * Math.cos(30 * Math.PI / 180)
  camera.up.set(0, 0, 1)
  camera.position.set(horizontal * Math.cos(Math.PI / 4), horizontal * Math.sin(Math.PI / 4), 16 * Math.sin(30 * Math.PI / 180))
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

  // 教学测量现在直接出现在默认可见的数据区，不再需要先展开「几何约束」。
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
  const selectedHeading = page.locator(".inspector-selected-heading h3")
  await expect(selectedHeading).toHaveCount(0)

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(selectedHeading).toHaveText("立方体 1")
  await page.getByRole("region", { name: "属性检查器" }).getByRole("button", { name: "外观样式" }).click()

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

  const heading = page.locator(".inspector-selected-heading h3")
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
  const planeCommand = page.getByRole("button", { name: "由选中点创建空间平面" })
  await expect(planeCommand).toHaveAttribute("title", "请先按住 Shift 点选 3 个不共线的空间点")

  // Default placement must keep the first three points off a single line, or a plane is impossible.
  for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: "添加空间点" }).click()
  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await expect(page.getByRole("button", { name: "由选中点创建空间直线" })).toBeEnabled()
  await algebra.getByText("C", { exact: true }).click({ modifiers: ["Shift"] })
  await expect(planeCommand).toBeEnabled()
  await expect(planeCommand).toHaveAttribute("title", "按住 Shift 点选三个不共线空间点")

  await page.getByRole("button", { name: "由选中点创建空间平面" }).click()

  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(algebra.getByText("空间平面 1")).toBeVisible()
  // The plane used to exist only in the document; now the scene actually draws it.
  await expect(scene).toHaveAttribute("data-plane-count", "1")
  await algebra.getByText("空间平面 1").first().click()
  await page.getByRole("region", { name: "属性检查器" }).getByRole("button", { name: "外观样式" }).click()
  await expect(page.getByLabel("填充颜色")).toBeEnabled()
})

test("pans the 3D view along the camera axes within a bounded range", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  const canvas = page.locator("[data-3d-scene] canvas")
  const box = (await canvas.boundingBox())!
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const target = async () => (await scene.getAttribute("data-camera-target"))!.split(",").map(Number)
  const drag = async (dx: number, dy: number, modifier: "Shift" | "Control") => {
    await page.keyboard.down(modifier)
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 10 })
    await page.mouse.up()
    await page.keyboard.up(modifier)
  }

  expect(await target()).toEqual([0, 0, 0])

  // The camera opens at azimuth 45 with Z up, so a sideways pan moves world X and Y together and leaves Z alone.
  await drag(140, 0, "Shift")
  const [x, y, z] = await target()
  expect(Math.abs(x)).toBeGreaterThan(1)
  expect(Math.abs(y)).toBeGreaterThan(1)
  expect(Math.abs(x)).toBeCloseTo(Math.abs(y), 1)
  expect(z).toBe(0)

  // Ctrl drags along the view axis, which is the only way to centre a figure that is offset in depth.
  const beforeDepth = await target()
  await drag(0, -120, "Control")
  const afterDepth = await target()
  expect(afterDepth[0]).toBeGreaterThan(beforeDepth[0])
  expect(afterDepth[1]).toBeGreaterThan(beforeDepth[1])
  expect(afterDepth[2]).toBeGreaterThan(beforeDepth[2])

  // The orbit centre stays bounded, so a long drag can never lose the figure off screen.
  for (let index = 0; index < 8; index += 1) await drag(200, 0, "Shift")
  for (const value of await target()) expect(Math.abs(value)).toBeLessThan(15)

  await page.getByRole("button", { name: "适应视图" }).click()
  expect(await target()).toEqual([0, 0, 0])
})

test("takes over left drag in pan mode and documents every view gesture", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  const canvas = page.locator("[data-3d-scene] canvas")
  const box = (await canvas.boundingBox())!

  // The gestures used to exist with no on-screen mention, which is why panning looked unavailable.
  await expect(page.locator("[data-camera-hint]")).toContainText("Shift+左键拖动平移")
  await expect(page.locator("[data-camera-hint]")).toContainText("Ctrl+拖动沿视线前后移动")
  await expect(scene).toHaveAttribute("data-pan-mode", "false")

  const panButton = page.getByRole("button", { name: "平移视角" })
  await panButton.click()
  await expect(panButton).toHaveAttribute("aria-pressed", "true")
  await expect(scene).toHaveAttribute("data-pan-mode", "true")

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 - 90, { steps: 10 })
  await page.mouse.up()

  const target = (await scene.getAttribute("data-camera-target"))!.split(",").map(Number)
  expect(target.some((value) => Math.abs(value) > 0.5)).toBe(true)
})

test("reorients a cone from the property inspector with precise angles", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加圆锥" }).click()

  const scene = page.locator("[data-3d-scene]")
  const size = async () => (await scene.getAttribute("data-content-bounds"))!.split("size ")[1].split(",").map(Number)

  // A height that differs from the diameter makes the axis visible in the reported bounds.
  await page.getByLabel("高度").fill("6")
  await expect.poll(async () => { const [x, , z] = await size(); return z / x }).toBeGreaterThan(1.8)

  await expect(page.getByLabel("绕 X 轴旋转角度")).toHaveValue("0")
  await page.getByRole("button", { name: "绕 X 轴加 90 度" }).click()

  // The templates used to be welded to +Z; a precise 90 degree turn lays the cone along Y instead.
  await expect(page.getByLabel("绕 X 轴旋转角度")).toHaveValue("90")
  await expect.poll(async () => { const [x, y] = await size(); return y / x }).toBeGreaterThan(1.8)
  await expect.poll(async () => { const [x, , z] = await size(); return Math.abs(z - x) }).toBeLessThan(0.5)

  // Orientation is document state, so it comes back with the restored draft.
  await page.reload()
  await page.locator(".algebra-panel").getByText("圆锥 1").first().click()
  await expect(page.getByLabel("绕 X 轴旋转角度")).toHaveValue("90")
})

test("keeps a template face reachable with Alt instead of always taking the whole solid", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const canvas = page.locator("[data-3d-scene] canvas")
  const box = (await canvas.boundingBox())!
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // A plain click still selects the solid: that is the P6 v3 fix that made a solid selectable at all.
  await page.mouse.click(centre.x, centre.y)
  await expect(page.locator(".property-type-badge")).toHaveText("立方体")

  // Alt keeps the hit on the generated face so faces stay reachable without expanding the algebra tree.
  await page.keyboard.down("Alt")
  await page.mouse.click(centre.x, centre.y)
  await page.keyboard.up("Alt")
  await expect(page.locator(".property-type-badge")).toHaveText("空间面")
})

test("resizes a plane patch by hand from the property inspector", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: "添加空间点" }).click()
  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await algebra.getByText("C", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "由选中点创建空间平面" }).click()
  await algebra.getByText("空间平面 1").first().click()

  const scene = page.locator("[data-3d-scene]")
  const width = async () => Number((await scene.getAttribute("data-content-bounds"))!.split("size ")[1].split(",")[0])

  // Empty means automatic: the patch is still sized from the figure.
  await expect(page.getByLabel("平面半边长")).toHaveValue("")
  const automatic = await width()

  await page.getByLabel("平面半边长").fill("8")
  await expect.poll(width).toBeGreaterThan(automatic * 1.5)

  await page.getByRole("button", { name: "恢复自动" }).click()
  await expect(page.getByLabel("平面半边长")).toHaveValue("")
  await expect.poll(width).toBeCloseTo(automatic, 1)
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

test("explains the normal and sample-angle controls in the status bar", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const status = page.getByRole("status", { name: "操作提示" })

  await page.getByRole("button", { name: "法向量" }).click()
  await expect(status).toContainText("外法向量")

  // 「测量二面角」画的是坐标轴夹角的示例，不是所选面的测量值，底部提示必须说清楚。
  await page.getByRole("button", { name: "测量二面角" }).click()
  await expect(status).toContainText("示例值")
  await expect(status).toContainText("Alt")

  const algebra = page.locator(".algebra-panel")
  await algebra.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }).click()
  await algebra.getByText("面 1", { exact: true }).click()
  await algebra.getByText("面 3", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "二面角内角", exact: true }).click()
  await expect(algebra.getByText("二面角内角", { exact: true })).toBeVisible()

  // 关掉最后打开的开关后回到普通提示。
  await page.getByRole("button", { name: "测量二面角" }).click()
  await expect(status).not.toContainText("示例值")
})

test("creates an intersection line by clicking the dashed preview", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  // 两个 4×4×4 的立方体错开 2：交叠 2×4×4，公共交线是 x=2 处的一圈矩形（12 条棱的公共部分）。
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByLabel("原点 X").fill("-2")
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByLabel("原点 X").fill("0")

  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("立方体 1", { exact: true }).click()
  await algebra.getByText("立方体 2", { exact: true }).click({ modifiers: ["Shift"] })

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-intersection-preview", "intersection")
  const status = page.getByRole("status", { name: "操作提示" })
  await expect(status).toContainText("面交线")

  // 指针移到虚线上：用 NDC 命中点（实测这条交线在 (-0.10, 0.20) 附近可命中），
  // 比"投影某条棱再取中点"可靠，因为相机取景与默认姿态并不完全一致。
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  const toScreen = (ndcX: number, ndcY: number) => ({ x: box.x + (ndcX * 0.5 + 0.5) * box.width, y: box.y + (0.5 - ndcY * 0.5) * box.height })
  let hit = false
  for (const [ndcX, ndcY] of [[-0.1, 0.2], [-0.2, 0.1], [-0.1, 0.1], [0, 0.2], [-0.2, 0.2]]) {
    const point = toScreen(ndcX, ndcY)
    await page.mouse.move(point.x, point.y)
    await page.waitForTimeout(120)
    if ((await status.textContent())?.includes("点击即可创建")) { hit = true; break }
  }
  expect(hit).toBe(true)
  await page.mouse.click(...Object.values(toScreen(-0.1, 0.2)) as [number, number])

  // 新图元进入文档、进入代数区，并且可撤销。
  await expect(algebra.getByText("截线 1", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "撤销" })).toBeEnabled()
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(algebra.getByText("截线 1", { exact: true })).toHaveCount(0)
})

test("previews the section of a selected solid as a dashed overlay", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  // 新建实体后它自动成为当前选择，所以虚线预览此刻就应该在（预览跟随选择，不是常驻）。
  await expect(scene).toHaveAttribute("data-intersection-preview", "section")

  await page.locator(".algebra-panel").getByText("立方体 1").first().click()
  // 选中单个实体：默认剖切平面截面以虚线预览出现（状态栏留给选择提示，不抢「创建截面」按钮的说明）。
  await expect(scene).toHaveAttribute("data-intersection-preview", "section")
  await expect(page.getByRole("status", { name: "操作提示" })).toContainText("已选中")
})

test("labels 3D points with their classroom names inside the scene", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  const labels = page.locator("[data-point-label]")
  await expect(labels).toHaveCount(2)
  await expect(page.locator('[data-point-label="A"]')).toBeVisible()
  await expect(page.locator('[data-point-label="B"]')).toBeVisible()
  // 标注层只显示，不参与拾取。
  await expect(page.locator(".three-point-label-overlay")).toHaveCSS("pointer-events", "none")

  // 标注跟着相机走：把视角重新框住图形后位置随之更新，而不是留在原地。
  const before = (await page.locator('[data-point-label="A"]').boundingBox())!
  await page.getByRole("button", { name: "适应视图" }).click()
  await expect.poll(async () => {
    const after = await page.locator('[data-point-label="A"]').boundingBox()
    return after ? Math.abs(after.x - before.x) + Math.abs(after.y - before.y) : 0
  }).toBeGreaterThan(4)
})

test("shows a small bottom-left guide only after a feature button is clicked", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const algebra = page.locator(".algebra-panel")
  const hint = page.getByRole("status", { name: "操作指引" })

  // 点「添加立方体」就出现该功能的指引，关掉后不再占位。
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(hint).toContainText("Alt")
  await page.getByRole("button", { name: "关闭操作指引" }).click()
  await expect(hint).toHaveCount(0)

  await algebra.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }).click()
  await algebra.getByText("面 1", { exact: true }).click()
  await algebra.getByText("面 3", { exact: true }).click({ modifiers: ["Shift"] })
  // 只选对象不产生新的指引。
  await expect(hint).toHaveCount(0)

  await page.getByRole("button", { name: "二面角内角", exact: true }).click()
  await expect(hint).toBeVisible()
  await expect(hint).toContainText("公共棱")
  await expect(hint).toContainText("外角")

  // 指引必须贴在左下角，而且足够小，不会变成挡住画布的面板。
  const box = (await hint.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.width).toBeLessThan(480)
  expect(box.x).toBeLessThan(viewport.width / 2)
  expect(box.y + box.height).toBeGreaterThan(viewport.height * 0.6)

  await page.getByRole("button", { name: "关闭操作指引" }).click()
  await expect(hint).toHaveCount(0)
})

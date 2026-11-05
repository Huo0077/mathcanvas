import { readFile } from "node:fs/promises"
import { createEmptyDocument, decodeMgeo, encodeMgeo } from "@draw/dsl"
import { expect, test, type Page } from "@playwright/test"
import { circleHost3 } from "@draw/geometry-kernel"
import { commandButton } from "./command-menu"
import { projectWorldPoint } from "./helpers/projection"

async function position(page: Page) {
  return Promise.all(["X", "Y", "Z"].map(async axis => Number(await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).inputValue())))
}

async function savedDocument(page: Page) {
  const pending = page.waitForEvent("download")
  await page.getByRole("button", { name: "保存 .mgeo", exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error("Missing saved document")
  return decodeMgeo(await readFile(path, "utf8"))
}

for (const track of ["segment", "line", "ray", "circle"] as const) {
  test(`direct dragging a driven ${track} point survives release, reload and undo`, async ({ page }) => {
    const initial = track === "circle" ? Math.PI / 2 : 0.5
    const expected = track === "circle" ? Math.PI : 0.75
    const circle = circleHost3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2)!
    const from = track === "circle" ? circle.evaluate({ u: initial }) : { x: 2, y: 0, z: 0 }
    const to = track === "circle" ? circle.evaluate({ u: expected }) : { x: 3, y: 0, z: 0 }
    const document = createEmptyDocument("geometry3d")
    document.parameters = { "t-mover": { id: "t-mover", value: initial, min: 0, max: track === "circle" ? 2 * Math.PI : 1, ownerId: "mover" } }
    document.primitives = [
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 4, y: 0, z: 0 } },
      track === "circle"
        ? { id: "track", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
        : track === "line"
          ? { id: "track", type: "line3", definition: { kind: "throughPoints", pointIds: ["a", "b"] } }
          : track === "ray"
            ? { id: "track", type: "ray3", originId: "a", throughId: "b" }
            : { id: "track", type: "segment3", pointIds: ["a", "b"] },
      { id: "mover", type: "point3", label: "驱动动点", position: from, binding: { kind: "onHost", hostId: "track", parameter: initial, parameterId: "t-mover" } }
    ]
    await page.goto("/")
    await page.getByLabel("加载 .mgeo 文件").setInputFiles({ name: "driver.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(document)) })
    await page.locator(".algebra-panel").getByText("驱动动点", { exact: true }).click()
    const before = await position(page)
    const start = await projectWorldPoint(page, from)
    const target = await projectWorldPoint(page, to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 12 })
    const scene = page.locator("[data-3d-scene]")
    await expect(scene).toHaveAttribute("data-drag-parameter", /.+/)
    const preview = Number(await scene.getAttribute("data-drag-parameter"))
    expect(preview).toBeCloseTo(expected, 1)
    await page.mouse.up()
    for (const [index, value] of [to.x, to.y, to.z].entries()) {
      await expect.poll(async () => (await position(page))[index]).toBeCloseTo(value, 1)
    }
    const saved = await savedDocument(page)
    expect(saved.parameters["t-mover"].value).toBeCloseTo(expected, 1)
    expect(saved.primitives.find(p => p.id === "mover")).toMatchObject({ binding: { parameterId: "t-mover" } })
    await page.getByRole("button", { name: "撤销", exact: true }).click()
    await expect.poll(() => position(page)).toEqual(before)
    await page.getByLabel("加载 .mgeo 文件").setInputFiles({ name: "moved.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(saved)) })
    await page.locator(".algebra-panel").getByText("驱动动点", { exact: true }).click()
    const restored = await position(page)
    for (const [index, value] of [to.x, to.y, to.z].entries()) expect(restored[index]).toBeCloseTo(value, 1)
  })

}

test("directly drags a cube-edge point even when it overlaps a generated vertex", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await (await commandButton(page, "添加立方体")).click()
  await (await commandButton(page, "添加空间点")).click()
  const select = page.getByRole("combobox", { name: "点宿主绑定" })
  const edge = await select.locator("option").filter({ hasText: "棱" }).first().getAttribute("value")
  await select.selectOption(edge!)
  await page.getByRole("spinbutton", { name: "宿主参数" }).fill("0")
  const before = await position(page)
  const initial = Number(await page.getByRole("spinbutton", { name: "宿主参数" }).inputValue())
  expect(initial === 0 || initial === 1).toBe(true)
  await page.getByRole("button", { name: "中点 0.5" }).click()
  const middle = await position(page)
  await page.getByRole("spinbutton", { name: "宿主参数" }).fill(String(initial))
  const start = await projectWorldPoint(page, { x: before[0], y: before[1], z: before[2] })
  const target = await projectWorldPoint(page, { x: middle[0], y: middle[1], z: middle[2] })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-drag-parameter", /.+/)
  await page.mouse.up()
  expect(await position(page)).not.toEqual(before)
  expect(Number(await page.getByRole("spinbutton", { name: "宿主参数" }).inputValue())).toBeCloseTo(0.5, 1)
  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await expect.poll(() => position(page)).toEqual(before)
})

test("video regression: bind to a spatial line, slide in inspector, then drag directly", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "a", type: "point3", label: "A", position: { x: 0, y: 0, z: 0 } },
    { id: "b", type: "point3", label: "B", position: { x: 5, y: 3, z: 0 } },
    { id: "track", type: "line3", label: "空间直线 1", definition: { kind: "throughPoints", pointIds: ["a", "b"] } },
    { id: "mover", type: "point3", label: "C", position: { x: 3, y: 1.8, z: 0 } }
  ]
  await page.goto("/")
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({ name: "video.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(document)) })
  await page.locator(".algebra-panel").getByText("C", { exact: true }).click()
  const select = page.getByRole("combobox", { name: "点宿主绑定" })
  const track = await select.locator("option").filter({ hasText: "空间直线 1" }).getAttribute("value")
  await select.selectOption(track!)
  await page.getByRole("spinbutton", { name: "宿主参数" }).fill("0.6")
  const slider = page.getByRole("slider", { name: "宿主滑轨" })
  const sliderBox = await slider.boundingBox()
  if (!sliderBox) throw new Error("Missing host slider")
  await slider.click({ position: { x: sliderBox.width * 0.4, y: sliderBox.height / 2 } })
  const sliderValue = Number(await slider.inputValue())
  expect(sliderValue).toBeGreaterThan(0.35)
  expect(sliderValue).toBeLessThan(0.45)
  const from = await position(page)
  const start = await projectWorldPoint(page, { x: from[0], y: from[1], z: from[2] })
  const target = await projectWorldPoint(page, { x: 4, y: 2.4, z: 0 })
  await page.mouse.move(start.x - 8, start.y + 3)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await page.screenshot({ path: testInfo.outputPath("line-preview.png") })
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-drag-parameter", /.+/)
  await page.mouse.up()
  await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "宿主参数" }).inputValue())).toBeCloseTo(0.8, 1)
  const moved = await position(page)
  const saved = await savedDocument(page)
  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await expect.poll(() => position(page)).toEqual(from)
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({ name: "line-moved.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(saved)) })
  await page.locator(".algebra-panel").getByText("C", { exact: true }).click()
  await expect.poll(() => position(page)).toEqual(moved)

  // Move an endpoint, release, and ensure the bound point is recomputed on the
  // changed line and can be grabbed again without re-binding it.
  await page.locator(".algebra-panel").getByText("A", { exact: true }).click()
  const aStart = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.move(aStart.x, aStart.y)
  await page.mouse.down()
  await page.mouse.move(aStart.x + 55, aStart.y - 20, { steps: 12 })
  await page.mouse.up()
  const a = await position(page)
  await page.locator(".algebra-panel").getByText("C", { exact: true }).click()
  const c = await position(page)
  const u = Number(await page.getByRole("spinbutton", { name: "宿主参数" }).inputValue())
  const b = [5, 3, 0]
  for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(a[i] + (b[i] - a[i]) * u, 5)
  const cStart = await projectWorldPoint(page, { x: c[0], y: c[1], z: c[2] })
  const expected = a.map((value, i) => value + (b[i] - value) * 0.4)
  const cTarget = await projectWorldPoint(page, { x: expected[0], y: expected[1], z: expected[2] })
  await page.mouse.move(cStart.x, cStart.y)
  await page.mouse.down()
  await page.mouse.move(cTarget.x, cTarget.y, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "宿主参数" }).inputValue())).toBeCloseTo(0.4, 1)
  await page.screenshot({ path: testInfo.outputPath("line-after-endpoint-drag.png") })
  expect(errors).toEqual([])
})

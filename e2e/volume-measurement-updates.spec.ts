import { createEmptyDocument, encodeMgeo } from "@draw/dsl"
import { buildSolidTemplate, createMeasurement3 } from "@draw/geometry-kernel"
import { expect, test } from "@playwright/test"

test("updates the existing volume after a vertex edit, undo, redo and reload", async ({ page }, testInfo) => {
  const document = createEmptyDocument("geometry3d")
  const pyramid = { id: "solid", type: "pyramid" as const, label: "体积测试棱锥", baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 2, y: 2 }, height: 2 }
  const built = buildSolidTemplate(pyramid)
  const apex = built.primitives.find(p => p.type === "point3" && p.position.z === 2)
  if (!apex) throw new Error("Missing apex")
  apex.label = "待调整顶点"
  document.primitives = [pyramid, ...built.primitives]
  document.measurements = [createMeasurement3("volume", "volume", [pyramid.id], document.primitives)]
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({ name: "volume-test.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(document)) })
  const label = page.locator('[data-measurement-id="volume"]')
  await expect(label).toContainText("2.667")

  const algebra = page.locator(".algebra-panel")
  await algebra.locator(".object-tree").first().locator("button").first().click()
  await algebra.getByText("待调整顶点", { exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "坐标 Z", exact: true })).toHaveValue("2")
  await page.getByRole("spinbutton", { name: "坐标 Z", exact: true }).fill("4")
  await expect(label).toContainText("5.333")
  await expect(page.getByRole("alert")).toHaveCount(0)

  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await expect(label).toContainText("2.667")
  await page.getByRole("button", { name: "重做", exact: true }).click()
  await expect(label).toContainText("5.333")
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
    return raw ? JSON.parse(raw).document.measurements[0]?.value : null
  })).toBeCloseTo(16 / 3, 8)
  await page.reload()
  await expect(label).toContainText("5.333")
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(page.locator(".object-tree")).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("volume-after-vertex-edit.png") })
})

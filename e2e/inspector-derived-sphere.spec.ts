import { createEmptyDocument, encodeMgeo } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"
import { expect, test, type Page } from "@playwright/test"

async function openSolid(page: Page, size = { x: 2, y: 2, z: 2 }) {
  const document = createEmptyDocument("geometry3d")
  const cube = { id: "cube", type: "cube" as const, label: "测试立体", origin: { x: 0, y: 0, z: 0 }, size }
  document.primitives = [cube, ...buildSolidTemplate(cube).primitives]
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({ name: "sphere-test.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(document)) })
  await page.locator(".algebra-panel").getByText("测试立体", { exact: true }).first().click()
}

async function spheres(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
    const document = raw ? JSON.parse(raw).document : { primitives: [] }
    return (document.primitives as { type: string; visible?: boolean; radius?: number; derivedFrom?: { kind: string }; style?: { opacity: number } }[]).filter(p => p.type === "sphere")
  })
}

test("draws linked spheres beside readings, toggles without duplication, undoes and persists", async ({ page }, testInfo) => {
  await openSolid(page)
  await page.getByRole("button", { name: "作图外接球", exact: true }).click()
  await expect(page.getByRole("button", { name: "隐藏外接球", exact: true })).toBeVisible()
  await expect.poll(() => spheres(page)).toMatchObject([{ radius: Math.sqrt(3), style: { opacity: 0.25 }, derivedFrom: { kind: "circumsphere" } }])
  await page.getByRole("button", { name: "隐藏外接球", exact: true }).click()
  await expect.poll(async () => (await spheres(page))[0]?.visible).toBe(false)
  await page.getByRole("button", { name: "显示外接球", exact: true }).click()
  await expect.poll(async () => (await spheres(page)).length).toBe(1)
  await page.getByRole("button", { name: "作图内切球", exact: true }).click()
  await expect.poll(async () => (await spheres(page)).length).toBe(2)
  await page.screenshot({ path: testInfo.outputPath("sphere-drawing.png") })
  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await expect(page.getByRole("button", { name: "作图内切球", exact: true })).toBeVisible()
  await expect.poll(async () => (await spheres(page)).length).toBe(1)
  await page.reload()
  await page.locator(".algebra-panel").getByText("测试立体", { exact: true }).first().click()
  await expect(page.getByRole("button", { name: "隐藏外接球", exact: true })).toBeVisible()
  expect(await spheres(page)).toMatchObject([{ style: { opacity: 0.25 }, derivedFrom: { kind: "circumsphere" } }])
})

test("does not offer a fictitious insphere for a rectangular cuboid", async ({ page }) => {
  await openSolid(page, { x: 2, y: 4, z: 6 })
  await expect(page.getByRole("button", { name: "作图内切球", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "作图外接球", exact: true })).toBeEnabled()
  await expect(page.locator('[data-derived-code="derived.insphere"] .derived-reading-message')).not.toBeEmpty()
})

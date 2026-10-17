import { readFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"

interface SavedDocument {
  workspace: string
  metadata: { id: string }
  primitives: { id: string }[]
}

// Inspect the real in-memory document through the application's export action.
async function exportedDocument(page: Page): Promise<SavedDocument> {
  const pending = page.waitForEvent("download")
  await page.getByRole("navigation", { name: "工作模式" }).getByRole("button", { name: "保存 .mgeo", exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error("Document export produced no file")
  return (JSON.parse(await readFile(path, "utf8")) as { document: SavedDocument }).document
}

async function expectDocument(page: Page, expected: SavedDocument) {
  await expect.poll(async () => {
    const actual = await exportedDocument(page)
    return { workspace: actual.workspace, id: actual.metadata.id, objects: actual.primitives.map((p) => p.id) }
  }).toEqual({ workspace: expected.workspace, id: expected.metadata.id, objects: expected.primitives.map((p) => p.id) })
}

test("restores active and inactive drawings across reloads without replacing later edits", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole("button", { name: "添加点", exact: true }).click()
  await page.getByRole("button", { name: "添加点", exact: true }).click()
  const planar = await exportedDocument(page)
  expect(planar.primitives).toHaveLength(2)

  await page.getByRole("button", { name: "跳转到立体几何", exact: true }).click()
  await page.getByRole("button", { name: "添加空间点", exact: true }).click()
  const spatial = await exportedDocument(page)
  expect(spatial.primitives).toHaveLength(1)
  expect(spatial.metadata.id).not.toBe(planar.metadata.id)

  await page.reload()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expectDocument(page, spatial)
  await page.getByRole("button", { name: "跳转到平面几何", exact: true }).click()
  await expectDocument(page, planar)
  await page.getByRole("button", { name: "添加点", exact: true }).click()
  const editedPlanar = await exportedDocument(page)
  expect(editedPlanar.primitives).toHaveLength(3)

  await page.reload()
  await expectDocument(page, editedPlanar)
  await page.getByRole("button", { name: "跳转到立体几何", exact: true }).click()
  await expectDocument(page, spatial)
  await page.getByRole("button", { name: "跳转到平面几何", exact: true }).click()
  await expectDocument(page, editedPlanar)
})

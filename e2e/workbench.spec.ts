import { expect, test } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"

let previewServer: ChildProcess | undefined

test.beforeAll(async () => {
  const vitePath = path.resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js")
  previewServer = spawn(process.execPath, [vitePath, "preview", "--host", "127.0.0.1", "--strictPort"], {
    cwd: path.resolve(process.cwd(), "apps", "web"),
    stdio: "ignore"
  })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173/")
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error("Vite preview server did not start")
})

test.afterAll(() => {
  previewServer?.kill()
})

test("workbench updates the intersection and adds a point", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  await expect(page.getByText(/交点 P \(0\.00, 0\.00\)/)).toBeVisible()

  await page.getByRole("slider", { name: "直线斜率" }).fill("0.25")
  await expect(page.getByText(/交点 P \(8\.00, 0\.00\)/)).toBeVisible()

  await page.getByRole("button", { name: "添加点" }).click()
  await expect(page.getByText("新点 A").first()).toBeVisible()
})

test("opens and restores an mgeo document through the file input", async ({ page }) => {
  await page.goto("/")
  const document = {
    schemaVersion: "0.1",
    revision: 7,
    workspace: "calculus",
    coordinateSystems: ["cartesian-2d"],
    parameters: {},
    primitives: [{ id: "restored-point", type: "point", x: 3, y: 2, label: "恢复点" }],
    constraints: [],
    dynamics: [],
    annotations: [],
    metadata: { id: "restored-document", name: "Restored", createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }
  }
  await page.locator('input[aria-label="加载 .mgeo"]').setInputFiles({
    name: "restored.mgeo",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "mgeo", formatVersion: "0.1", document }))
  })

  await expect(page.getByText("恢复点").first()).toBeVisible()
  await expect(page.getByText(/revision 7/)).toBeVisible()
})

test("switches workspaces and exports SVG and CSV files", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "圆锥曲线" }).click()
  await expect(page.getByRole("button", { name: "圆锥曲线" })).toHaveAttribute("aria-pressed", "true")

  const svgDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 SVG" }).click()
  await expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/)

  const csvDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 CSV" }).click()
  await expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/)

  await page.getByRole("button", { name: "微积分" }).click()
  await expect(page.getByText(/交点 P \(0\.00, 0\.00\)/)).toBeVisible()
})

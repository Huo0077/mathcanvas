import { expect, test } from "@playwright/test"

test("workbench updates the intersection and adds a point", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  await expect(page.getByRole("img", { name: "几何画布" }).locator('[data-intersection-info="true"]')).toHaveCount(0)

  await page.getByRole("slider", { name: "直线斜率" }).fill("0.25")
  await expect(page.getByRole("img", { name: "几何画布" }).locator('[data-intersection-info="true"]')).toHaveCount(0)
  await page.getByText("交点 P", { exact: true }).click()
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
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({
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

  const pngDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 PNG" }).click()
  await expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/)

  await page.getByRole("button", { name: "微积分" }).click()
  await expect(page.getByRole("img", { name: "几何画布" }).locator('[data-intersection-info="true"]')).toHaveCount(0)
})

test("shows constraint status and recovery controls", async ({ page }) => {
  await page.goto("/")
  const document = {
    schemaVersion: "0.1",
    revision: 2,
    workspace: "calculus",
    coordinateSystems: ["cartesian-2d"],
    parameters: {},
    primitives: [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, label: "基准线" },
      { id: "line-b", type: "line", a: { x: -2, y: 1 }, b: { x: 2, y: 1 }, label: "平行线" }
    ],
    constraints: [{ id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] }],
    dynamics: [],
    annotations: [],
    metadata: { id: "constraint-document", name: "Constraints", createdAt: "2026-09-13T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z" }
  }
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({
    name: "constraints.mgeo",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "mgeo", formatVersion: "0.1", document }))
  })

  await expect(page.getByText("约束列表")).toBeVisible()
  await expect(page.getByText("已满足", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "删除约束 parallel-1" })).toBeVisible()
})

test("restores the latest workspace draft after reload", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "添加点" }).click()
  await expect(page.getByText("新点 A").first()).toBeVisible()
  await page.reload()
  await expect(page.getByText("新点 A").first()).toBeVisible()
  await expect(page.getByText(/草稿自动保存/)).toBeVisible()
})

import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

test("workbench updates the intersection and adds a point", async ({ page }) => {
  await page.goto("/")
  // The app no longer starts with demo content, so the fixture supplies it explicitly.
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/planar-demo.mgeo")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  await expect(page.getByRole("img", { name: "几何画布" }).locator('[data-intersection-info="true"]')).toHaveCount(0)

  await page.locator(".algebra-panel").getByText("参数直线", { exact: true }).click()
  await page.getByRole("slider", { name: "选中直线斜率" }).fill("0.25")
  await expect(page.getByRole("img", { name: "几何画布" }).locator('[data-intersection-info="true"]')).toHaveCount(0)
  await page.getByText("交点 P", { exact: true }).click()
  await expect(page.getByText(/交点 P \(8\.00, 0\.00\)/)).toBeVisible()

  await page.getByRole("button", { name: "添加点" }).click()
  await expect(page.getByText("A", { exact: true }).first()).toBeVisible()
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
  const save = page.waitForEvent("download")
  await page.getByRole("banner").getByRole("button", { name: "保存 .mgeo" }).click()
  const savedPath = await (await save).path()
  const savedDocument = JSON.parse(await readFile(savedPath!, "utf8")) as { document: { revision: number } }
  expect(savedDocument.document.revision).toBe(7)
})

test("switches workspaces and exports SVG and CSV files", async ({ page }) => {
  await page.goto("/")

  // A fresh session opens on 平面几何 (the internal `conics` workspace) and 微积分 is not offered at all.
  await expect(page.getByRole("button", { name: "平面几何" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "微积分" })).toHaveCount(0)

  await page.getByRole("button", { name: "平面几何" }).click()
  await expect(page.getByRole("button", { name: "平面几何" })).toHaveAttribute("aria-pressed", "true")

  const svgDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 SVG" }).click()
  await expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/)

  const csvDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 CSV" }).click()
  await expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/)

  const pngDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 PNG" }).click()
  await expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/)

  // The retired calculus workspace must not come back as a tab; 立体几何 is the other planar-free workspace.
  await expect(page.getByRole("button", { name: "微积分" })).toHaveCount(0)
  await page.getByRole("button", { name: "立体几何" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
})

test("keeps constraint data in the document without a constraint panel", async ({ page }) => {
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

  // 旧文档照常打开、约束数据照常保留，但右侧不再展示约束面板或智能体。
  await expect(page.locator(".algebra-panel").getByText("基准线", { exact: true })).toBeVisible()
  await expect(page.getByText("约束列表")).toHaveCount(0)
  await expect(page.getByText("几何约束")).toHaveCount(0)
  await expect(page.getByText("智能体 (Agent)")).toHaveCount(0)

  // 保存出来的文件里约束记录仍在：撤掉的是界面，不是文档数据。
  const save = page.waitForEvent("download")
  await page.getByRole("banner").getByRole("button", { name: "保存 .mgeo" }).click()
  const savedPath = await (await save).path()
  const saved = JSON.parse(await readFile(savedPath!, "utf8")) as { document: { constraints: unknown[] } }
  expect(saved.document.constraints).toHaveLength(1)
})

test("restores the latest workspace draft after reload", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "平面几何" }).click()
  await page.getByRole("button", { name: "添加点" }).click()
  await expect(page.getByText("A", { exact: true }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText("A", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("status", { name: "操作提示" })).toContainText("点击图元查看属性")
})

test("zooms the conics canvas and keeps every crossing of a line and a curve", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "平面几何" }).click()
  const canvas = page.getByRole("img", { name: "几何画布" })
  const scale = async () => Number(await canvas.getAttribute("data-viewport-scale"))
  const initial = await scale()

  // 添加函数 + 正弦预设：这条曲线与下面的水平线在视口内有 5 个交点。
  await page.getByRole("button", { name: "添加函数" }).click()
  await page.getByRole("combobox", { name: "函数预设" }).selectOption("sine")

  await page.getByRole("button", { name: "添加直线" }).click()
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: 24, y: box.height / 2 } })
  await canvas.click({ position: { x: box.width - 24, y: box.height / 2 } })
  await expect(canvas.locator('[data-primitive-type="function"] polyline').first()).toBeVisible()
  // 点击落点不可能精确落在 y = 0 上，所以交点数取决于像素取整（通常是 4 个）；关键要求是「不再只剩 2 个」。
  const markers = canvas.locator("[data-auto-intersection]")
  await expect.poll(() => markers.count()).toBeGreaterThanOrEqual(4)

  // 滚轮以指针为中心缩放，重置视图回到初始比例与中心。
  await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
  await page.mouse.wheel(0, -400)
  await expect.poll(scale).toBeGreaterThan(initial)
  await page.getByRole("button", { name: "重置视图" }).click()
  await expect.poll(scale).toBeCloseTo(initial, 5)
  await expect(canvas).toHaveAttribute("data-viewport-center", "0,0")

  // 保存一个交点只隐藏它自己，同一条直线与曲线的其他交点仍然可点。
  const before = await markers.count()
  await markers.first().click()
  await expect.poll(() => markers.count()).toBe(before - 1)
})

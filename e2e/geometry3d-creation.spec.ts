import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

test("draws a spatial segment directly on the canvas and undoes it in one step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "绘制线段" }).click()
  await expect(scene).toHaveAttribute("data-creation-tool", "segment3")
  await expect(page.getByText("添加点、线或面开始探索三维空间。")).toHaveCount(0)
  const first = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.click(first.x, first.y)
  await expect(page.getByRole("status", { name: "操作提示" })).toContainText("第 2")
  const second = await projectWorldPoint(page, { x: 2, y: 0, z: 0 })
  await page.mouse.move(second.x, second.y)
  await page.mouse.click(second.x, second.y)
  await expect(page.locator(".algebra-panel").getByText("空间线段 1")).toBeVisible()
  await expect(scene).toHaveAttribute("data-creation-tool", "")
  await page.keyboard.press("Control+z")
  await expect(page.locator(".algebra-panel").getByText("空间线段 1")).toHaveCount(0)
  await expect(page.locator(".algebra-panel").getByText("A", { exact: true })).toHaveCount(0)
})

test("can cancel an unfinished face without changing the document", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "绘制空间面" }).click()
  const scene = page.locator("[data-3d-scene]")
  const first = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.click(first.x, first.y)
  await expect(scene).toHaveAttribute("data-creation-anchors", "1")
  await page.keyboard.press("Escape")
  await expect(scene).toHaveAttribute("data-creation-tool", "")
  await expect(page.locator(".algebra-panel").getByText("A", { exact: true })).toHaveCount(0)
})
test("places a point on the chosen XZ work plane and reuses it in a line", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "绘制空间点" }).click()
  await page.getByRole("group", { name: "立体绘制工作平面" }).getByRole("button", { name: "XZ" }).click()
  const first = await projectWorldPoint(page, { x: 1, y: 0, z: 2 })
  await page.mouse.click(first.x, first.y)
  await expect(page.locator(".algebra-panel").getByText("A", { exact: true })).toBeVisible()
  expect(Number(await page.getByRole("spinbutton", { name: "坐标 Y" }).inputValue())).toBeCloseTo(0, 2)
  expect(Number(await page.getByRole("spinbutton", { name: "坐标 Z" }).inputValue())).toBeCloseTo(2, 2)

  await page.getByRole("button", { name: "绘制空间直线", exact: true }).click()
  const oldPoint = await projectWorldPoint(page, { x: 1, y: 0, z: 2 })
  await page.mouse.click(oldPoint.x, oldPoint.y)
  const newPoint = await projectWorldPoint(page, { x: 3, y: 0, z: 2 })
  await page.mouse.click(newPoint.x, newPoint.y)
  await expect(page.locator(".algebra-panel").getByText("空间直线 1")).toBeVisible()
  await expect(page.getByRole("status", { name: "操作提示" })).toContainText("对象 3")
})

test("finishes a three-vertex spatial face with Enter", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "绘制空间面" }).click()
  for (const point of [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }]) {
    const { x, y } = await projectWorldPoint(page, point)
    await page.mouse.click(x, y)
  }
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-creation-anchors", "3")
  await page.keyboard.press("Enter")
  await expect(page.locator(".algebra-panel").getByText("空间面 1")).toBeVisible()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-creation-tool", "")
})
test("keeps camera modes and drawing modes mutually exclusive", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "自由拖动" }).click()
  await expect(scene).toHaveAttribute("data-drag-mode", "true")
  await page.getByRole("button", { name: "绘制线段" }).click()
  await expect(scene).toHaveAttribute("data-drag-mode", "false")
  await page.getByRole("button", { name: "平移视角" }).click()
  await expect(scene).toHaveAttribute("data-creation-tool", "")
  await expect(scene).toHaveAttribute("data-pan-mode", "true")
})

/**
 * **创建会话里悬停要说清"点下去会引用谁 / 落在哪"**（实施计划 Task 5 那条"悬停辅助标记展示目标、
 * 世界坐标与工作平面，不渲染为持久图元"）。
 *
 * 判据取画布上的读数条 `[data-creation-readout]`（与 2D 画布的 `data-coordinate-readout` 同一个形状）：
 * 空白处悬停必须说"工作平面 XY"并给出世界坐标，悬停到已有点必须说"已有点"；
 * 而两种情况都**不许**往文档里写东西 —— 对象行数与进入绘制之前完全一致（"只是预览"的可复核判据）。
 */
test("tells what the next click would land on, without writing anything", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  // 先放一个空间点（默认落在 (0,0,0)），用来验"吸附到已有点"那一路
  await page.getByRole("button", { name: "添加空间点" }).click()
  const rowsBefore = await page.locator(".algebra-panel .object-row").count()

  await page.getByRole("button", { name: "绘制空间直线", exact: true }).click()
  const readout = page.locator("[data-creation-readout]")
  // 还没悬停过：不凭空显示一个落点
  await expect(readout).toHaveCount(0)

  // ① 空白处：落在默认工作平面 XY 上，并给出世界坐标
  const empty = await projectWorldPoint(page, { x: 2, y: 1, z: 0 })
  await page.mouse.move(empty.x, empty.y)
  await expect(readout).toHaveCount(1)
  await expect(readout).toHaveText(/^工作平面 XY \(-?\d+\.\d{2}, -?\d+\.\d{2}, -?\d+\.\d{2}\)$/)
  const coordinates = ((await readout.textContent()) ?? "").replace(/^[^(]*\(/, "").replace(/\)$/, "").split(",").map((value) => Number(value.trim()))
  expect(coordinates[0]).toBeCloseTo(2, 0)
  expect(coordinates[1]).toBeCloseTo(1, 0)
  expect(coordinates[2]).toBeCloseTo(0, 1)

  // ② 已有点：读数改成"已有点"（点优先于它所在的工作平面）
  const existing = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.move(existing.x, existing.y)
  await expect(readout).toHaveText(/^已有点 \(-?0\.00, -?0\.00, -?0\.00\)$/)

  // 全程没写过文档：悬停只是预览
  expect(await page.locator(".algebra-panel .object-row").count()).toBe(rowsBefore)

  // 指针离开画布：读数撤掉，不留一个过期的落点
  await page.mouse.move(4, 4)
  await expect(readout).toHaveCount(0)
})
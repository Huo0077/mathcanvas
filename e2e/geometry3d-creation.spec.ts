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
 * 载入交叠立方体夹具并把相机钉死 —— 与 `three-intersection-previews.spec.ts` 同一套做法
 * （否则取景动画会在断言期间把细目标从指针下拖走）。
 */
async function loadOverlappingCubes(page: import("@playwright/test").Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/overlapping-cubes.mgeo")
  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-preview-face-count", "6")
  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement | null)?.click())
  await expect(page.getByRole("button", { name: "自动取景" })).toHaveAttribute("aria-pressed", "false")
  await page.getByRole("button", { name: "重置3D视角" }).click()
  let previous = ""
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = `${await scene.getAttribute("data-camera-azimuth")}|${await scene.getAttribute("data-camera-elevation")}|${await scene.getAttribute("data-camera-distance")}`
    if (current === previous) break
    previous = current
    await page.waitForTimeout(120)
  }
  return scene
}

/** 草稿里的图元类型清单：用来数"这一下到底往文档里写了什么"。 */
async function draftedTypes(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) return [] as string[]
    return (JSON.parse(raw) as { document: { primitives: { type: string }[] } }).document.primitives.map((primitive) => primitive.type)
  })
}

/**
 * **切换工作区会取消未提交的创建状态**（实施计划 Task 5 那条的最后一句）。
 *
 * 判据：切走再切回之后工具已退出、锚点数归零，而且**文档里没有半成品** ——
 * 未提交的步骤本来就不该落盘（预览只存在于 UI）。
 */
test("cancels an unfinished drawing when the workspace is switched", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const scene = page.locator("[data-3d-scene]")
  const rows = page.locator(".algebra-panel .object-row")

  await page.getByRole("button", { name: "绘制线段" }).click()
  const first = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.click(first.x, first.y)
  await expect(scene).toHaveAttribute("data-creation-anchors", "1")
  // 未提交的第一步**不落盘**：对象列表还是空的
  await expect(rows).toHaveCount(0)

  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  await expect(scene).toHaveAttribute("data-creation-tool", "")
  await expect(scene).toHaveAttribute("data-creation-anchors", "0")
  await expect(rows).toHaveCount(0)
})

/**
 * **创建会话优先于预览点击**（同一条的"覆盖在原拾取分支之上"）。
 *
 * 判据：指针压在**交面预览**上时点一下，落地的必须是一个**空间点**，
 * 而不是那份预览对应的交面图元 —— 而预览本身不该被这一下消耗掉。
 */
test("lets the drawing session win over a preview click", async ({ page }) => {
  const scene = await loadOverlappingCubes(page)
  const before = await draftedTypes(page)

  await page.getByRole("button", { name: "绘制空间点" }).click()
  await expect(scene).toHaveAttribute("data-creation-tool", "point3")
  // (1,2,0) 是交叠区域 y=+2 那一面的中心（与预览用例用的是同一个点）
  const face = await projectWorldPoint(page, { x: 1, y: 2, z: 0 })
  await page.mouse.move(face.x, face.y)
  await expect(scene).toHaveAttribute("data-preview-hover-key", /面\d+$/)
  await page.mouse.click(face.x, face.y)

  const after = await draftedTypes(page)
  const added = after.slice(before.length)   // 这一下新增的那一截
  expect(added.filter((type) => type === "point3")).toHaveLength(1)
  expect(added.filter((type) => type.startsWith("intersection"))).toHaveLength(0)
  // 点完即完成（点工具只要一个锚点），工具退出
  await expect(scene).toHaveAttribute("data-creation-tool", "")
  // 预览还在：这一下没有把那份交面"点走"
  await expect(scene).toHaveAttribute("data-preview-face-count", "6")
})
/**
 * **从工具按钮退回"选择工具"**（实施计划 Task 5 那条"从工具按钮可选『选择工具』退出"）。
 *
 * 判据：退出后工具状态清空、锚点归零、文档里没有半成品；而且画布点击**回到选择语义**
 * —— 再点空白不会创建任何东西。
 */
test("leaves the drawing session through the select tool", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const scene = page.locator("[data-3d-scene]")
  const rows = page.locator(".algebra-panel .object-row")

  await page.getByRole("button", { name: "绘制线段" }).click()
  await expect(scene).toHaveAttribute("data-creation-tool", "segment3")
  const first = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.click(first.x, first.y)
  await expect(scene).toHaveAttribute("data-creation-anchors", "1")

  await page.getByRole("button", { name: "选择工具" }).click()
  await expect(scene).toHaveAttribute("data-creation-tool", "")
  await expect(scene).toHaveAttribute("data-creation-anchors", "0")
  // 未提交的那个锚点不落盘
  await expect(rows).toHaveCount(0)

  // 退出之后画布点击回到"选择"语义：点空白不再创建任何东西
  const empty = await projectWorldPoint(page, { x: 2, y: 2, z: 0 })
  await page.mouse.click(empty.x, empty.y)
  await expect(rows).toHaveCount(0)
  await expect(scene).toHaveAttribute("data-creation-tool", "")
})

/**
 * **锁定的对象看得见、能选中，但不能当吸附目标**（实施计划 Task 3 那条"隐藏或锁定对象不被当作可吸附目标"）。
 *
 * 这条以前被我记成"未实现"，那是在**错的层**上核对：纯函数 `resolveSpatialAnchor` 只按命中物回答、
 * 不认识文档，真正的过滤在 `threeSceneEffect.ts` 的 `resolveCreationAt` 里 —— `visible === false`、
 * `locked`、以及生成的 `point3` 一律丢掉命中。这里从 UI 走一遍作为实证，并且**自带对照**：
 * 同一个屏幕坐标，未锁定时读"已有点"、锁定时读"工作平面 XY"、解锁后又读回"已有点" ——
 * 差别只可能来自锁定状态，不可能是别的东西顺带造成的。
 */
test("does not snap to a locked point, and snaps again once it is unlocked", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  const readout = page.locator("[data-creation-readout]")
  const point = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  const lockToggle = (name: string) => page.locator(".inspector-quick-actions").getByRole("button", { name })

  await page.locator(".algebra-panel").getByText("A", { exact: true }).click()
  await page.getByRole("button", { name: "绘制空间直线", exact: true }).click()

  // 对照①：未锁定时吸到那个点
  await page.mouse.move(point.x, point.y)
  await expect(readout).toHaveText(/^已有点 \(/)

  await lockToggle("锁定图元").click()
  await expect(lockToggle("解锁图元")).toBeVisible()
  await page.mouse.move(4, 4)
  await page.mouse.move(point.x, point.y)
  // 对照②：锁定后同一个坐标不再吸到它，退回工作平面；而点本身仍然在画布上
  await expect(readout).toHaveText(/^工作平面 XY \(/)
  await expect(page.locator(".algebra-panel").getByText("A", { exact: true })).toBeVisible()

  await lockToggle("解锁图元").click()
  await page.mouse.move(4, 4)
  await page.mouse.move(point.x, point.y)
  // 对照③：解锁后恢复吸附
  await expect(readout).toHaveText(/^已有点 \(/)
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
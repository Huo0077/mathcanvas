import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

test("drafts on a new layer, hides it, and keeps the layout after a refresh", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  // A legacy .mgeo document is migrated to the default layer, sheet and four-view layout.
  await page.getByRole("tab", { name: "图层树" }).click()
  await expect(page.getByRole("button", { name: "几何", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "尺寸", exact: true })).toBeVisible()

  // Create and activate a layer, then draw a line on it in 2D drafting mode.
  await page.getByRole("button", { name: "新建图层" }).click()
  await page.getByRole("button", { name: "图层 1", exact: true }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()
  await page.getByRole("button", { name: "添加直线" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  await surface.click({ position: { x: 120, y: 120 } })
  await surface.click({ position: { x: 280, y: 220 } })
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)

  // Hiding the layer removes its geometry from the drafting viewport.
  await page.getByRole("button", { name: "隐藏 图层 1" }).click()
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(0)

  // Change a projection view scale, which is persisted document state. The per-view controls appear on hover,
  // so the panel is hovered first.
  await page.getByRole("button", { name: "3D 投影" }).click()
  const frontView = page.locator('.drawing-viewport[data-view-id="view-front"]')
  await frontView.hover()
  await page.getByRole("button", { name: "放大 主视图" }).click()
  await expect(page.getByRole("button", { name: "缩小 主视图" })).toBeEnabled()

  await page.reload()

  // The CAD workspace, the active tree tab, the hidden layer and the view scale all survive the refresh.
  await expect(page.getByRole("button", { name: "跳转到工程制图" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("tab", { name: "图层树" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("button", { name: "显示 图层 1" })).toBeVisible()
  await page.locator('.drawing-viewport[data-view-id="view-front"]').hover()
  await expect(page.getByRole("button", { name: "缩小 主视图" })).toBeEnabled()
})

test("drafts with a fixed window, live preview and object snap", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  // 坐标窗口是固定的：画之前先记下来，画完必须一模一样（旧实现按内容自适应，点一下整个坐标系就跳）。
  const windowBefore = await surface.getAttribute("viewBox")

  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 80, y: 140 } })
  await surface.hover({ position: { x: 240, y: 140 } })

  // 拖拽过程中能看见橡皮筋预览和长度/角度读数。
  await expect(surface.locator('[data-draft-preview="segment"]')).toHaveCount(1)
  await expect(surface.locator("[data-draft-readout]")).toHaveCount(1)

  await surface.click({ position: { x: 240, y: 140 } })
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)
  await expect(surface).toHaveAttribute("viewBox", windowBefore ?? "")

  // 指针靠近已有端点时必须给出捕捉标记（12px 捕捉半径）。
  await surface.hover({ position: { x: 82, y: 142 } })
  await expect(surface.locator('[data-draft-snap="endpoint"]')).toHaveCount(1)

  // 指针落在实体中段但不在特征点上：给"最近点"，这样才能沿线滑动取点。
  await surface.hover({ position: { x: 133, y: 140 } })
  await expect(surface.locator('[data-draft-snap="nearest"]')).toHaveCount(1)

  // 栅格捕捉开关：打开后远离图元的位置会给栅格捕捉，而不是自由落点。
  const gridToggle = page.getByRole("button", { name: "切换栅格捕捉" })
  await expect(gridToggle).toHaveAttribute("data-draft-grid-snap", "off")
  await gridToggle.click()
  await expect(gridToggle).toHaveAttribute("data-draft-grid-snap", "on")
  await surface.hover({ position: { x: 133, y: 97 } })
  await expect(surface.locator('[data-draft-snap="grid"]')).toHaveCount(1)
})

test("edits a draft primitive by dragging its grip", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 80, y: 140 } })
  await surface.click({ position: { x: 240, y: 140 } })
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)

  // 选中线段后必须出现夹点；拖动端点要真的提交成一次文档改动（revision 增加）。
  await surface.click({ position: { x: 160, y: 140 } })
  const grip = surface.locator('[data-draft-handle="a"]')
  await expect(grip).toHaveCount(1)
  const before = Number(await page.locator(".engineering-workbench").getAttribute("data-revision"))
  const box = (await grip.boundingBox())!

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(surface).toHaveAttribute("data-draft-dragging", "true")
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 24, { steps: 6 })
  await page.mouse.up()

  await expect(surface).toHaveAttribute("data-draft-dragging", "false")
  await expect.poll(async () => Number(await page.locator(".engineering-workbench").getAttribute("data-revision"))).toBeGreaterThan(before)
  // 拖动结束后夹点跟着端点走了，说明改动已经落到文档上。
  const movedBox = (await grip.boundingBox())!
  expect(Math.abs(movedBox.x - box.x) + Math.abs(movedBox.y - box.y)).toBeGreaterThan(10)
})

test("box-selects draft geometry with the drag direction deciding the mode", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 140, y: 120 } })
  await surface.click({ position: { x: 260, y: 200 } })
  const box = (await surface.boundingBox())!
  const revision = async () => Number(await page.locator(".engineering-workbench").getAttribute("data-revision"))
  const before = await revision()

  // 右 → 左拖框 = 相交选择：拖动中矩形带 crossing 语义，松手后线段被选中。
  await page.mouse.move(box.x + 320, box.y + 240)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 80, { steps: 6 })
  await expect(surface.locator('[data-draft-box="crossing"]')).toHaveCount(1)
  await page.mouse.up()
  await expect(surface.locator('[data-primitive-id][data-selected="true"]')).toHaveCount(1)
  // 框选只改选择状态，不产生文档改动。
  expect(await revision()).toBe(before)

  // 左 → 右拖框 = 窗口选择：框不完整包含线段，因此不选中。
  await page.mouse.move(box.x + 40, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 160, { steps: 6 })
  await expect(surface.locator('[data-draft-box="window"]')).toHaveCount(1)
  await page.mouse.up()
  await expect(surface.locator('[data-primitive-id][data-selected="true"]')).toHaveCount(0)
})

test("places drafting points from typed coordinates", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 100, y: 140 } })

  // 第二个点用极坐标敲进去：@40<0 应该是"从基点向右 40mm"，也就是窗口宽度的 40%。
  const input = page.getByLabel("坐标输入")
  await input.fill("@40<0")
  await input.press("Enter")

  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)
  await expect(input).toHaveValue("")

  await surface.click({ position: { x: 160, y: 140 } })
  const grips = surface.locator("[data-draft-handle]")
  await expect(grips).toHaveCount(2)
  const first = (await grips.nth(0).boundingBox())!
  const second = (await grips.nth(1).boundingBox())!
  // 精确几何（@40<0 → 基点 +(40,0)）由 DrawingViewport 单测覆盖；这里只断言与布局无关的两件事：
  // 敲出来的线是水平的，而且明显是一条有长度的线而不是随手一点。
  expect(Math.abs(first.y - second.y)).toBeLessThan(1.5)
  expect(Math.abs(second.x - first.x)).toBeGreaterThan(30)
  expect(Number(await page.locator(".engineering-workbench").getAttribute("data-revision"))).toBeGreaterThan(0)
})

test("offsets, trims and extends selected draft geometry", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()

  const surface = page.getByRole("img", { name: /模型视图/ })
  const revision = async () => Number(await page.locator(".engineering-workbench").getAttribute("data-revision"))
  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 120, y: 200 } })
  await surface.click({ position: { x: 320, y: 200 } })
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)

  // 选中线段后「偏移」可用：偏移是新建平行对象，所以图元数从 1 变成 2，原对象留着。
  await surface.click({ position: { x: 220, y: 200 } })
  await expect(surface.locator('[data-primitive-id][data-selected="true"]')).toHaveCount(1)
  await expect(page.getByRole("button", { name: "偏移" })).toBeEnabled()
  await expect(page.getByRole("button", { name: "修剪" })).toBeDisabled()
  const beforeOffset = await revision()
  await page.getByLabel("偏移距离").fill("10")
  await page.getByRole("button", { name: "偏移" }).click()

  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(2)
  await expect.poll(revision).toBeGreaterThan(beforeOffset)
  await expect(page.getByRole("region", { name: "工程状态栏" })).toContainText("已偏移")

  // 副本成为当前选择，并且与原线段平行：两组夹点（夹点是图元组的兄弟节点）的 y 明显不同。
  // 副本成为当前选择（夹点只画在选中对象上），且与原线段平行并拉开一段距离。
  const selected = surface.locator('[data-primitive-id][data-selected="true"]').first()
  await expect(selected).toHaveAttribute("data-primitive-id", "segment-2")
  const copyGrip = (await surface.locator('[data-draft-handle][data-primitive-id="segment-2"]').first().boundingBox())!
  const sourceLine = (await surface.locator('[data-primitive-id="segment-1"] line').first().boundingBox())!
  const copyCenter = copyGrip.y + copyGrip.height / 2
  const sourceCenter = sourceLine.y + sourceLine.height / 2
  expect(Math.abs(copyCenter - sourceCenter)).toBeGreaterThan(5)

  const status = page.getByRole("region", { name: "工程状态栏" })
  const heightOf = async (id: string) => (await surface.locator(`[data-primitive-id="${id}"] line`).first().boundingBox())!.height

  // 延伸：先选边界（segment-1），Shift 加选目标（短竖线段），把目标 b 端拉到边界上。
  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 220, y: 110 } })
  await surface.click({ position: { x: 220, y: 165 } })
  const shortHeight = await heightOf("segment-3")
  // 用模型树点选：命中带可能重叠，树里的行是确定性的，顺序也正好是"先边界、后目标"。
  const model = page.locator(".algebra-panel")
  await model.getByText("线段 1", { exact: true }).click()
  await model.getByText("线段 3", { exact: true }).click({ modifiers: ["Shift"] })
  await expect(surface.locator('[data-primitive-id][data-selected="true"]')).toHaveCount(2)
  await expect(page.getByRole("button", { name: "延伸" })).toBeEnabled()
  await page.getByRole("button", { name: "延伸" }).click()
  await expect(status).toContainText("已延伸")
  expect(await heightOf("segment-3")).toBeGreaterThan(shortHeight)

  // 修剪：画一条穿过边界的竖线段，选中边界 + 目标后剪掉 a 端之外的一半。
  await page.getByRole("button", { name: "添加线段", exact: true }).click()
  await surface.click({ position: { x: 275, y: 110 } })
  await surface.click({ position: { x: 275, y: 250 } })
  const longHeight = await heightOf("segment-4")
  await model.getByText("线段 1", { exact: true }).click()
  await model.getByText("线段 4", { exact: true }).click({ modifiers: ["Shift"] })
  await expect(page.getByRole("button", { name: "修剪" })).toBeEnabled()
  await page.getByRole("button", { name: "修剪" }).click()
  await expect(status).toContainText("已修剪")
  expect(await heightOf("segment-4")).toBeLessThan(longHeight)
})

test("undoes and redoes from both the buttons and the keyboard", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  const workbench = page.locator(".engineering-workbench")
  const revision = async () => Number(await workbench.getAttribute("data-revision"))
  const undo = page.getByRole("button", { name: "撤销" })
  const redo = page.getByRole("button", { name: "重做" })

  // A restored document starts with no history: the buttons used to look enabled and do nothing.
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()

  await page.getByRole("button", { name: "添加空间点", exact: true }).click()
  await expect.poll(revision).toBe(1)
  await expect(undo).toBeEnabled()
  await expect(redo).toBeDisabled()

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z were unbound anywhere in the app before this fix.
  await page.keyboard.press("Control+z")
  await expect.poll(revision).toBe(0)
  await expect(undo).toBeDisabled()
  await expect(redo).toBeEnabled()

  await page.keyboard.press("Control+Shift+z")
  await expect.poll(revision).toBe(1)
  await page.keyboard.press("Control+z")
  await expect.poll(revision).toBe(0)

  await redo.click()
  await expect.poll(revision).toBe(1)
  await undo.click()
  await expect.poll(revision).toBe(0)
})

test("keeps hidden views out of the exported SVG", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-dimension.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  await page.getByRole("tab", { name: "图纸树" }).click()
  const tree = page.getByRole("region", { name: "模型与图纸树" })
  await tree.getByRole("button", { name: "隐藏 主视图" }).click()

  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 SVG", exact: true }).click()
  const path = await (await download).path()
  const svg = await readFile(path, "utf8")

  expect(svg).toContain('data-drawing-view="top"')
  expect(svg).not.toContain('data-drawing-view="front"')
})

/**
 * Task 0.6 Step 5 要求的 App 级"来源切换"用例。
 *
 * 这里的断言对象是**导出文件的内容**，不是眼前的画布：上一批修掉的真实缺陷正是
 * "四个视图里显示立方体、导出的 SVG 里却是本图纸那份（通常是空的）"。
 * 只断言显示侧的话，这条缺陷会原样通过——所以必须把下载下来的文件读回来看。
 */
test("exports the switched projection source instead of the drawing's own document", async ({ page }) => {
  await page.goto("/")

  // 先在立体几何里建一个立方体：两个工作区的文档相互独立，工程制图默认看不到它。
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  await expect(page.getByText("本图纸没有可投影对象；立体几何里已有模型").first()).toBeVisible()
  await expect(page.locator(".engineering-drawing-primitive")).toHaveCount(0)

  // 来源仍是"本图纸"时，导出的 SVG 里除了四个视图分组不该有任何图元。
  const emptyDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 SVG", exact: true }).click()
  const emptySvg = await readFile(await (await emptyDownload).path(), "utf8")
  expect((emptySvg.match(/data-drawing-view=/g) ?? []).length).toBe(4)
  expect(emptySvg).not.toContain("data-source-id=")

  // 切到"立体几何"来源：显示侧先出现投影。
  await page.getByRole("button", { name: "改为投影立体几何的模型" }).first().click()
  await expect(page.getByRole("button", { name: /投影来源：立体几何/ })).toBeVisible()
  await expect.poll(() => page.locator(".engineering-drawing-primitive").count()).toBeGreaterThan(0)

  // **导出必须跟着来源走**：文件里要出现只有空间文档才有的立方体投影来源。
  const spatialDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 SVG", exact: true }).click()
  const spatialSvg = await readFile(await (await spatialDownload).path(), "utf8")
  expect((spatialSvg.match(/data-source-id=/g) ?? []).length).toBeGreaterThan(0)
  expect(spatialSvg).toMatch(/data-source-id="(cube|point3|line3|polyhedron3)[^"]*"/)
})

test("supports keyboard selection, command entry, cancellation and inspector tabs", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-point.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  const source = page.getByRole("main", { name: "工程制图视图" }).locator('[data-source-id="point3-1"]').first()
  await source.focus()
  await page.keyboard.press("Enter")
  await expect(page.locator('[data-source-id="point3-1"][data-selected="true"]')).toHaveCount(4)

  const inspector = page.getByRole("region", { name: "工程属性检查器" })
  await inspector.getByRole("tab", { name: "数据" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(inspector.getByRole("tab", { name: "外观" })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowLeft")
  await expect(inspector.getByRole("tab", { name: "数据" })).toHaveAttribute("aria-selected", "true")

  await page.getByRole("button", { name: "2D 绘图" }).click()
  await page.getByRole("button", { name: "添加直线", exact: true }).click()
  await expect(page.getByRole("region", { name: "工程状态栏" })).toContainText("第1步：点击确定直线的第一个点")

  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "工程状态栏" })).toContainText("2D 绘图：")
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(0)
})

test("fills the drafting area with the sheet and keeps an explicit display scale", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  await page.waitForSelector(".drawing-sheet")
  // The measured fit arrives after the first paint, so wait for the scale to settle away from the 1:1 default.
  await expect.poll(async () => page.locator(".drawing-sheet").getAttribute("data-sheet-scale")).not.toBe("1.000")

  const geometry = async () => page.evaluate(() => {
    /** 取不到就抛：在 `evaluate` 里抛会变成一条读得懂的用例失败，而不是 `null` 上的 TypeError。 */
    const must = (selector: string) => {
      const found = document.querySelector(selector)
      if (found === null) throw new Error(`missing element: ${selector}`)
      return found
    }
    const rect = (selector: string) => must(selector).getBoundingClientRect()
    const areaElement = must(".drawing-sheet-area")
    const style = getComputedStyle(areaElement)
    const area = rect(".drawing-sheet-area")
    const sheet = rect(".drawing-sheet")
    return {
      area: { w: Math.round(area.width), h: Math.round(area.height) },
      // The area keeps its own margin; fit is measured against what is left of it.
      available: { w: Math.round(areaElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)), h: Math.round(areaElement.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) },
      sheet: { w: Math.round(sheet.width), h: Math.round(sheet.height) },
      scale: Number(must(".drawing-sheet").getAttribute("data-sheet-scale")),
      zoomText: must("[data-sheet-zoom]").textContent,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    }
  })

  /** The sheet animates its scale, so a measurement is only trusted once two samples agree. */
  const settle = async () => {
    let previous = ""
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await page.evaluate(() => {
        const sheet = document.querySelector(".drawing-sheet")
        if (sheet === null) throw new Error("missing element: .drawing-sheet")
        const rect = sheet.getBoundingClientRect()
        return `${Math.round(rect.width)}x${Math.round(rect.height)}`
      })
      if (current === previous) break
      previous = current
      await page.waitForTimeout(80)
    }
    return geometry()
  }

  const fitted = await settle()
  // Fit means the sheet uses most of the area on its binding axis without ever exceeding it.
  expect(fitted.sheet.h).toBeLessThanOrEqual(fitted.available.h + 1)
  expect(fitted.sheet.w).toBeLessThanOrEqual(fitted.available.w + 1)
  expect(Math.max(fitted.sheet.h / fitted.available.h, fitted.sheet.w / fitted.available.w)).toBeGreaterThan(0.9)
  expect(fitted.zoomText).toContain(`${Math.round(fitted.scale * 100)}%`)
  expect(fitted.overflowX).toBe(false)

  // The automatic fit is overridable: one step in magnifies, and the sheet pans instead of being cropped.
  await page.getByRole("button", { name: "放大图纸" }).click()
  const zoomed = await settle()
  expect(zoomed.scale).toBeGreaterThan(fitted.scale)
  expect(zoomed.sheet.h).toBeGreaterThan(zoomed.available.h)
  expect(await page.locator(".drawing-sheet-area").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  await page.getByRole("button", { name: "适应图纸" }).click()
  const refitted = await settle()
  expect(refitted.scale).toBeCloseTo(fitted.scale, 2)
  expect(await page.locator(".drawing-sheet-area").evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
})

test("projects the spatial workspace model instead of claiming there is nothing to project", async ({ page }) => {
  await page.goto("/")

  // 在立体几何里建一个立方体：工作区文档是独立的，工程制图默认看不到它。
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  // 空状态要说明原因，而不是只说"暂无可投影的空间对象"。
  await expect(page.getByText("本图纸没有可投影对象；立体几何里已有模型").first()).toBeVisible()
  await expect(page.locator(".engineering-drawing-primitive")).toHaveCount(0)

  // 一键切换投影来源后，四个视图里能看到立方体的投影。
  await page.getByRole("button", { name: "改为投影立体几何的模型" }).first().click()
  await expect(page.getByRole("button", { name: /投影来源：立体几何/ })).toBeVisible()
  await expect.poll(() => page.locator(".engineering-drawing-primitive").count()).toBeGreaterThan(0)
  await expect(page.getByText("本图纸没有可投影对象")).toHaveCount(0)

  // 切回本图纸后回到空状态，来源是可逆的。
  await page.getByRole("button", { name: /投影来源：立体几何/ }).click()
  await expect(page.getByRole("button", { name: /投影来源：本图纸/ })).toBeVisible()
  await expect.poll(() => page.locator(".engineering-drawing-primitive").count()).toBe(0)
})

test("keeps the 2D drafting commands on the toolbar, off the drawing surface", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()
  await page.getByRole("button", { name: "2D 绘图" }).click()
  await page.waitForSelector(".drawing-sheet")
  await expect(page.getByLabel("坐标输入")).toBeVisible()

  const layout = async () => page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { x: Math.round(box.x), y: Math.round(box.y), right: Math.round(box.right), bottom: Math.round(box.bottom), w: Math.round(box.width), h: Math.round(box.height) }
    }
    const toolbar = document.querySelector(".engineering-drawing-toolbar")
    const sheetArea = document.querySelector(".drawing-sheet-area")
    const coordinate = document.querySelector('input[aria-label="坐标输入"]')
    return {
      toolbar: rect(toolbar),
      sheetArea: rect(sheetArea),
      coordinate: rect(coordinate),
      coordinateInsideSheet: Boolean(sheetArea && coordinate && sheetArea.contains(coordinate)),
      offsetInsideSheet: Boolean(sheetArea?.querySelector('[data-draft-edit="offset"]')),
      sheetScale: Number(document.querySelector(".drawing-sheet")?.getAttribute("data-sheet-scale")),
      toolbarCount: document.querySelectorAll(".engineering-drawing-toolbar").length
    }
  })

  const before = await layout()
  // 只有一条工具栏；命令区在图纸之上，绝不在纸内（纸内的控件会随 CSS zoom 一起放大并压住画布）。
  expect(before.toolbarCount).toBe(1)
  expect(before.coordinate).not.toBeNull()
  expect(before.coordinateInsideSheet).toBe(false)
  expect(before.offsetInsideSheet).toBe(false)
  expect(before.toolbar!.bottom).toBeLessThanOrEqual(before.sheetArea!.y + 1)
  expect(before.coordinate!.bottom).toBeLessThanOrEqual(before.toolbar!.bottom)
  // 工具栏保持单行（约 48px）：它每高一行，纸张就小一圈。A4 纸张有最小尺寸，所以适配比例可能小于 1。
  expect(before.toolbar!.h).toBeLessThanOrEqual(60)
  expect(before.sheetScale).toBeGreaterThan(0.5)

  // 开始创建后，长度/角度动态输入也出现在同一条工具栏上。
  await page.getByRole("button", { name: "添加直线", exact: true }).click()
  await page.getByLabel("坐标输入").fill("0,0")
  await page.getByLabel("坐标输入").press("Enter")
  await expect(page.getByLabel("输入长度")).toBeVisible()
  await expect(page.getByLabel("输入角度")).toBeVisible()
  const after = await layout()
  expect(after.coordinateInsideSheet).toBe(false)
  expect(after.toolbar!.h).toBeLessThanOrEqual(60)

  // 工具栏上的命令依然能用：敲相对坐标即可落点成线。
  await page.getByLabel("坐标输入").fill("@40<0")
  await page.getByLabel("坐标输入").press("Enter")
  await expect(page.locator(".engineering-drawing-draft")).toHaveCount(1)
  await expect(page.getByRole("alert")).toHaveCount(0)
})

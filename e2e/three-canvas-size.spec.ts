import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 用户报告："背景画布有时候太小了"。
 *
 * 根因：`.three-canvas-shell` 的高度写死成 `clamp(320px, calc(100vh - 420px), 820px)`，
 * 而它的父级（`.workbench` 的画布行）本来就是 `minmax(0, 1fr)`、可以撑满。
 * 于是画布比容器矮——短窗口按 `100vh - 420` 缩水、大屏被 820px 截断，下面留一片空白；
 * 公式里的 420px 还跟真实的工具栏/页脚高度无关。
 *
 * 这条用例量的是"画布是否填满了它该占的那一行"，不依赖任何具体像素值。
 */
test.use({ viewport: { width: 1280, height: 800 } })

test("fills the canvas row instead of a viewport-height guess", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const measured = await page.evaluate(() => {
    const workbench = document.querySelector(".workbench")!
    const shell = document.querySelector("[data-3d-scene]")!
    const canvas = shell.querySelector("canvas")!
    const children = Array.from(workbench.children) as HTMLElement[]
    const footer = children[children.length - 1]
    return {
      workbench: workbench.getBoundingClientRect().height,
      footer: footer === shell ? 0 : footer.getBoundingClientRect().height,
      shell: shell.getBoundingClientRect().height,
      canvas: canvas.getBoundingClientRect().height
    }
  })

  // 画布必须填满外壳（外壳是它的容器，`inset: 0` 的渲染目标跟着走）。
  expect(measured.canvas).toBeGreaterThanOrEqual(measured.shell - 1)
  // 外壳必须填满"工作台高度减去页脚"——也就是它那一行，而不是一个视口公式算出来的猜测值。
  expect(measured.shell).toBeGreaterThanOrEqual(measured.workbench - measured.footer - 2)
})

test("keeps filling the row after a viewport resize", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  await page.setViewportSize({ width: 1280, height: 560 })
  const short = await measure(page)
  expect(short.canvas).toBeGreaterThanOrEqual(short.shell - 1)

  await page.setViewportSize({ width: 1440, height: 1200 })
  const tall = await measure(page)
  expect(tall.shell).toBeGreaterThanOrEqual(short.shell)
  expect(tall.canvas).toBeGreaterThanOrEqual(tall.shell - 1)
})

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const shell = document.querySelector("[data-3d-scene]")!
    return { shell: shell.getBoundingClientRect().height, canvas: shell.querySelector("canvas")!.getBoundingClientRect().height }
  })
}

/**
 * 用户报告"背景画布有时候太小了"的第二个来源：**画布会在交互中途被压矮**。
 *
 * 状态栏（页脚）原本是 `auto` 高、还被自动排进了左面板那一列（240px 宽），
 * 一段提示被挤成 6~7 行、页脚 116px；指针一悬停到剖面预览上，提示变长、页脚涨到 150px，
 * 画布从 532px 掉到 498px——同一个屏幕坐标不再对应同一个世界点，
 * 于是 pointermove 报"命中预览"、pointerup 却报"落空"，点不中就是这么来的。
 *
 * 这里量的是布局不变量，不依赖具体像素：文案变了画布不能变。
 */
test("keeps the canvas size when the status text changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  // 这个用例按"立方面上的固定世界点"指过去，所以把立方体**显式钉住**（模板默认落点会变）。
  for (const [axis, value] of [["X", "-2"], ["Y", "-2"], ["Z", "-1"]] as const) await page.getByRole("spinbutton", { name: `原点 ${axis}` }).fill(value)
  await expect(page.getByText("立方体 1").first()).toBeVisible()

  const prompt = page.locator(".status-bar-prompt")
  const before = await measure(page)
  const textBefore = await prompt.textContent()

  // 指到默认剖切面的边界线上：状态栏提示换成更长的那条
  const point = await projectWorldPoint(page, { x: 2, y: 0, z: 0 })
  await page.mouse.move(point.x, point.y)
  await expect(scene).toHaveAttribute("data-preview-hovering", "true")
  await expect(prompt).not.toHaveText(textBefore ?? "")

  const after = await measure(page)
  expect(after.shell).toBeCloseTo(before.shell, 0)
  expect(after.canvas).toBeCloseTo(before.canvas, 0)

  // 状态栏自己横跨工作台整宽，而不是被挤进第一列；文案放不下时它自己滚动，不外溢。
  const bar = await page.evaluate(() => {
    const element = document.querySelector(".workbench > .status-bar") as HTMLElement
    const workbench = document.querySelector(".workbench") as HTMLElement
    const barBox = element.getBoundingClientRect()
    const workbenchBox = workbench.getBoundingClientRect()
    return {
      width: barBox.width,
      workbenchWidth: workbenchBox.width,
      overflow: element.scrollHeight - element.clientHeight,
      workbenchOverflow: workbench.scrollHeight - workbenchBox.height
    }
  })
  expect(bar.width).toBeGreaterThanOrEqual(bar.workbenchWidth - 2)
  expect(bar.overflow).toBeLessThanOrEqual(1)
  expect(bar.workbenchOverflow).toBeLessThanOrEqual(1)
})

/** 窄屏（右检查器整宽另起一行）时，检查器那一行必须有上界——否则它按内容长到 1700px，
 *  把 `minmax(0, 1fr)` 的画布行压成 0，画布直接"消失"（实测 768×800 选中实体后高度就是 0）。 */
test("keeps a usable canvas height at tablet widths", async ({ page }) => {
  for (const width of [960, 900, 768, 700]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto("/")
    await page.getByRole("button", { name: "跳转到立体几何" }).click()
    await page.getByRole("button", { name: "添加立方体" }).click()
    await expect(page.getByText("立方体 1").first()).toBeVisible()

    const measured = await page.evaluate(() => {
      const workbench = document.querySelector(".workbench") as HTMLElement
      const shell = document.querySelector("[data-3d-scene]") as HTMLElement
      const inspector = document.querySelector(".panel.right") as HTMLElement
      return {
        workbench: workbench.getBoundingClientRect().height,
        shell: shell.getBoundingClientRect().height,
        canvas: shell.querySelector("canvas")!.getBoundingClientRect().height,
        inspectorScrolls: inspector.scrollHeight > inspector.clientHeight
      }
    })

    expect(measured.canvas).toBeGreaterThanOrEqual(measured.shell - 1)
    // 画布拿到的至少是工作台的 35%，而不是 0：属性多的对象也不能把画布挤没
    expect(measured.shell).toBeGreaterThanOrEqual(measured.workbench * 0.35)
    // 检查器超出部分由它自己滚动
    expect(measured.inspectorScrolls).toBe(true)
  }
})

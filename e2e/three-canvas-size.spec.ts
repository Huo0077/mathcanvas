import { expect, test } from "@playwright/test"

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
  await page.getByRole("button", { name: "立体几何" }).click()

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
  await page.getByRole("button", { name: "立体几何" }).click()

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

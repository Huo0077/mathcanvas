import { expect, test } from "@playwright/test"

/**
 * 3D 画布的渲染器必须活过一次挂载：编辑、选中、显示开关与展开动画都不许换 canvas，
 * 更不许重建 WebGL 上下文。
 *
 * 旧实现（效应依赖含 `document` 与非 memo 的 `onSelect`，且每次重建都
 * `renderer.dispose()` + `new WebGLRenderer`）下这些断言必然失败：
 * 悬停、提示、错误、展开动画等任何一次父组件重渲染都会换掉画布。
 */
test("keeps one renderer alive across edits, selection and unfold", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-scene-builds", "1")
  // 记下当前 canvas 节点，稍后要证明它没有被替换。
  await page.evaluate(() => {
    ;(window as unknown as { __sceneCanvas?: Element | null }).__sceneCanvas = document.querySelector("[data-scene-canvas]")
  })

  // 显示开关：过去每次点击都会重建整个场景。
  await page.getByRole("button", { name: "透明面" }).click()
  await page.getByRole("button", { name: "隐藏边" }).click()
  // 新增图元与选中变化：过去同样会重建。
  await page.getByRole("button", { name: "添加空间点" }).click()

  // 展开动画：过去每帧重建一次（一次展开约 15-20 个 WebGL 上下文）。
  await page.getByRole("button", { name: "展开", exact: true }).click()
  await expect(scene).toHaveAttribute("data-unfold-progress", "1.00")

  await expect(scene).toHaveAttribute("data-scene-builds", "1")
  const sameCanvas = await page.evaluate(() => {
    const current = document.querySelector("[data-scene-canvas]")
    return current === (window as unknown as { __sceneCanvas?: Element | null }).__sceneCanvas
  })
  expect(sameCanvas).toBe(true)
  // 内容确实被同步过，避免"什么都没做"式的假通过。
  const syncs = Number(await scene.getAttribute("data-scene-syncs"))
  expect(syncs).toBeGreaterThanOrEqual(2)
})

/**
 * 拖动期间既不该重建渲染器，也不该同步内容：画面完全由临时偏移负责，
 * 抬手才提交文档（提交本身会同步一次内容，那是预期的，所以采样点放在抬手之前）。
 */
test("does not rebuild or resync while a solid is being dragged", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "自由拖动" }).click()

  const scene = page.locator("[data-3d-scene]")
  const box = (await scene.boundingBox())!
  const syncsBefore = Number(await scene.getAttribute("data-scene-syncs"))

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 20; step += 1) await page.mouse.move(box.x + box.width / 2 + step * 3, box.y + box.height / 2)

  // 采样点：仍在按住的状态下。
  await expect(scene).toHaveAttribute("data-scene-builds", "1")
  expect(Number(await scene.getAttribute("data-scene-syncs"))).toBe(syncsBefore)
  // 拖动确实发生了，否则这条断言会因为"根本没抓到图形"而假通过。
  expect(Number(await scene.getAttribute("data-drag-frames"))).toBeGreaterThan(0)

  await page.mouse.up()
  await expect(scene).toHaveAttribute("data-scene-builds", "1")
})

/** 自动取景开关：默认开、可关闭、刷新后仍然记得；重新打开时立刻拟合一次。 */
test("exposes the auto-fit toggle and remembers it across reloads", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-autofit", "true")

  /**
   * 用 DOM 派发点击而不是 `locator.click()`：显示控制那一排在窄一点的视口下会换行，
   * 按钮位置随之变化，Playwright 会一直等"位置稳定"从而超时（仓库里「取面」按钮
   * 已经踩过同一个坑，注释见 e2e/geometry3d-section.spec.ts）。这里测的是开关语义本身。
   */
  const toggleAutoFit = () => page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement).click())

  await toggleAutoFit()
  await expect(scene).toHaveAttribute("data-autofit", "false")

  await page.reload()
  await page.getByRole("button", { name: "立体几何" }).click()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-autofit", "false")

  await toggleAutoFit()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-autofit", "true")
})

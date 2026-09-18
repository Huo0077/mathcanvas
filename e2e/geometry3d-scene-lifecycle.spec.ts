import { expect, test, type Locator } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/** 上一次内容同步的读数：重建了几个、沿用几个、丢了几个，以及场景里现在有几个内容对象。 */
async function readSync(scene: Locator) {
  return {
    created: Number(await scene.getAttribute("data-scene-created")),
    reused: Number(await scene.getAttribute("data-scene-reused")),
    removed: Number(await scene.getAttribute("data-scene-removed")),
    content: Number(await scene.getAttribute("data-scene-content"))
  }
}

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
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
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
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
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

/**
 * 场景对象按图元增量同步：签名没变的对象必须**沿用**，不能每次同步全清全建。
 *
 * 选中一个空间点（它移到了 x=6，立方体旁边）再点回立方体：只有那个点的外观要变，
 * 其余对象（立方体的 8 点 / 12 棱 / 6 面、栅格、坐标轴）都该原样留着。
 * 旧实现每次同步都 `clearContent()` 重建全部，于是 created == 内容对象总数、reused == 0。
 */
test("rebuilds only the object whose selection changed", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  const scene = page.locator("[data-3d-scene]")
  // 把点挪出立方体：否则它和实体在同一个位置，点选时说不清选中的是谁。
  const xField = page.getByRole("spinbutton", { name: "坐标 X" })
  await xField.fill("6")
  await xField.blur()
  const base = await readSync(scene)
  expect(base.content).toBeGreaterThan(10)

  // 点实体本体（世界原点是立方体的中心，屏幕投影处就是它的正面）：选中从"点"换到"立方体"
  const centre = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.click(centre.x, centre.y)

  const after = await readSync(scene)
  // 只有"失去选中的点"要重建；选中立方体会多出一个剖切面预览（内容 +1），所以给一点余量。
  expect(after.created).toBeGreaterThanOrEqual(1)
  expect(after.created).toBeLessThanOrEqual(3)
  expect(after.reused).toBeGreaterThanOrEqual(base.content - 3)
  // 关键断言：绝不是整场重建（旧实现这里是 created == 内容总数）
  expect(after.created).toBeLessThan(base.content)
  expect(after.removed).toBe(0)
})

/**
 * 展开动画过去每帧重建整场（内容签名里带 `unfoldProgress`，而签名一变就全清全建）。
 * 现在只有那张展开网随进度重建，点 / 栅格 / 坐标轴都沿用。
 */
test("keeps the rest of the scene while the unfold animation runs", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "展开", exact: true }).click()
  await expect(scene).toHaveAttribute("data-unfold-progress", "1.00")
  // 展开确实发生了，避免"什么都没展开"式的假通过
  expect(Number(await scene.getAttribute("data-unfold-faces"))).toBeGreaterThan(0)

  const after = await readSync(scene)
  expect(after.created).toBeLessThanOrEqual(2)
  expect(after.reused).toBeGreaterThanOrEqual(8)
  expect(after.created + after.reused).toBe(after.content)
})

/** 自动取景开关：默认开、可关闭、刷新后仍然记得；重新打开时立刻拟合一次。 */
test("exposes the auto-fit toggle and remembers it across reloads", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

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
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-autofit", "false")

  await toggleAutoFit()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-autofit", "true")
})

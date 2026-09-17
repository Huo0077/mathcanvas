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

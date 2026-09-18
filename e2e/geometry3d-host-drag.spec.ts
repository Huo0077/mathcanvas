import { expect, test, type Page } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 拖动**绑定到宿主**的空间点：点必须严格沿宿主滑动。
 *
 * 三条断言各自的含义：
 * - 拖动过程中 `data-host-residual` 恒为 0 —— 坐标是从宿主参数算出来的，不是叠加屏幕位移；
 * - `data-drag-parameter` 确实变了 —— 拖动真的改写了宿主参数（否则"没动"也能让残差为 0）；
 * - 抬手提交后位置变了，且一次 Ctrl+Z 精确回到原处 —— 整次拖动只有一步撤销。
 */
test("drags a host-bound point along its host", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  /**
   * 绑定到立方体的**一条棱**上（下拉里那一项的标签带「棱」），然后把**宿主参数**设到 0.5。
   *
   * 两处都不能省：
   * - 默认空间点在原点，宿主解析取的是"离它最近的宿主点"——省略参数设置会让它落在离原点最近的那个**顶点**上，
   *   与模板物化出来的顶点重合，拾取命中的是那个"不能单独拖动"的生成顶点（实测 `data-drag-target` 报
   *   `point:cube-1-point-6`、`data-drag-parameter` 为 null）；0.5 让它落在棱的**正中**，不与任何顶点重合。
   * - 也不能绑到「实体内」：那样点落在实体**内部**，指针射线先打到实体表面（实测 `dragTarget` 报
   *   `face:cube-1-face-10`），而这条用例要测的是"沿宿主（棱）滑动"。
   */
  const select = page.getByRole("combobox", { name: "点宿主绑定" })
  const edge = await select.locator("option").filter({ hasText: "棱" }).first().getAttribute("value")
  expect(edge).toBeTruthy()
  await select.selectOption(edge!)
  await page.getByRole("spinbutton", { name: "宿主参数" }).fill("0.5")

  const before = await readPointPosition(page)
  await page.getByRole("button", { name: "自由拖动" }).click()

  const start = await projectWorldPoint(page, { x: before[0], y: before[1], z: before[2] })
  const scene = page.locator("[data-3d-scene]")
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(start.x + step * 7, start.y + step * 3)

  // 采样点放在抬手之前：拖动期间既不提交文档，点也不该离开宿主。
  const residual = Number(await scene.getAttribute("data-host-residual"))
  const parameter = await scene.getAttribute("data-drag-parameter")
  expect(residual).toBeCloseTo(0, 6)
  expect(parameter).not.toBeNull()

  await page.mouse.up()
  const after = await readPointPosition(page)
  expect(after).not.toEqual(before)

  // 一次撤销回到原处：整次拖动只有一步历史。
  await page.keyboard.press("Control+z")
  expect(await readPointPosition(page)).toEqual(before)
})

async function readPointPosition(page: Page): Promise<number[]> {
  return Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).inputValue())))
}

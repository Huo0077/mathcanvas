import { expect, test, type Page } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 空间圆**轨道**（`circle3`）：建出来之后就是动点的约束轨道。
 *
 * 用户口径："我想要增加一些可以旋转，平移的平面图元，只需要圆和多边形就可以，这个主要作用是作为约束轨道。"
 *
 * 这一条用例守三件事：
 * 1. 命令能从选中的空间点建出圆轨道，半径 = 圆心到第二个点的距离（属性栏读数对得上）；
 * 2. 下拉里出现「圆轨道」这一项，选中点能绑上去；
 * 3. 拖那个点，它**沿圆周滑动**：拖动期间残差 ≈ 0、参数在 `[0, 2π)` 内，抬手后点到圆心的距离仍等于半径。
 */
test("creates a circle track and slides a bound point along it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  // 两个空间点：第一个当圆心，第二个当圆周上的点。
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByText("A", { exact: true }).first().click()
  await page.getByText("B", { exact: true }).first().click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()

  // (1) 建出来的轨道落在文档里，半径 = 两点距离（点 A (0,0,0)、点 B (3,0,0) ⇒ 3）。
  await expect(page.getByRole("spinbutton", { name: "圆轨道半径" })).toBeVisible()
  const radiusInput = page.getByRole("spinbutton", { name: "圆轨道半径" })
  await expect(radiusInput).toHaveValue("3")

  // (2) 再来一个点，绑到这条轨道上（下拉里那一条写着"圆轨道"）。
  await page.getByRole("button", { name: "添加空间点" }).click()
  const select = page.getByRole("combobox", { name: "点宿主绑定" })
  const orbitValue = await select.locator("option").filter({ hasText: "圆轨道" }).first().getAttribute("value")
  expect(orbitValue).toBeTruthy()
  await select.selectOption(orbitValue!)
  await expect(page.getByRole("spinbutton", { name: "宿主参数" })).toBeVisible()

  // (3) 拖着它沿轨道滑。
  const before = await readPointPosition(page)
  await page.getByRole("button", { name: "自由拖动" }).click()
  const scene = page.locator("[data-3d-scene]")
  const start = await projectWorldPoint(page, { x: before[0], y: before[1], z: before[2] })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(start.x + step * 7, start.y + step * 3)

  const residual = Number(await scene.getAttribute("data-host-residual"))
  expect(residual).toBeCloseTo(0, 6)
  await page.mouse.up()

  // 抬手之后：参数在 `[0, 2π)` 之内，点到圆心的距离仍等于半径（真的在圆周上）。
  const parameter = Number(await page.getByRole("spinbutton", { name: "宿主参数" }).inputValue())
  expect(parameter).toBeGreaterThanOrEqual(0)
  expect(parameter).toBeLessThan(Math.PI * 2)
  const after = await readPointPosition(page)
  await page.getByText("圆轨道 1", { exact: false }).first().click()
  const centre = await readCircleCentre(page)
  expect(Math.hypot(after[0] - centre[0], after[1] - centre[1], after[2] - centre[2])).toBeCloseTo(3, 6)
})

async function readPointPosition(page: Page): Promise<number[]> {
  return Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).inputValue())))
}

/** 选中圆轨道后检查器里的圆心坐标读数（圆心现在是可编辑的**真实字段**）。 */
async function readCircleCentre(page: Page): Promise<number[]> {
  return Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `圆心 ${axis}` }).inputValue())))
}

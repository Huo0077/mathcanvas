import { expect, test } from "@playwright/test"

/**
 * 用户报告："背景坐标系的大小太有限了"——点的坐标到 20 左右时，栅格只铺到 ±14、
 * 坐标轴只画到 12 左右，那个点就落在坐标面之外的空白里。
 *
 * 旧实现把栅格固定成 14 格、**以原点为中心**、格边长只按内容对角线取整：
 * 内容离原点一远就必然覆盖不到（极端情况：只有一个远处点时，格边长被算成 0.005，
 * 整个坐标面缩成一个点）。
 *
 * 这里断言的是"坐标系真的铺到了那个点"，而不是"某个数字变了"。
 */
test("background grid reaches a point placed far from the origin", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  const xField = page.getByRole("spinbutton", { name: "坐标 X" })
  await xField.fill("20")
  await xField.blur()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-grid-extent", /[\d.]+/)

  const [centreX] = (await scene.getAttribute("data-grid-centre"))!.split(",").map(Number)
  const extent = Number(await scene.getAttribute("data-grid-extent"))
  const axesLength = Number(await scene.getAttribute("data-axes-length"))

  // 栅格铺到 x = 20（并且仍然盖住原点一带）。
  expect(centreX + extent).toBeGreaterThanOrEqual(20)
  expect(centreX - extent).toBeLessThanOrEqual(0)
  // 坐标轴也要在同一个量级，否则"坐标系"看起来还是太小。
  expect(axesLength).toBeGreaterThanOrEqual(12)
})

test("keeps the coordinate plane covering the view when zoomed out", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  const readExtent = async () => Number(await scene.getAttribute("data-grid-extent"))
  const near = await readExtent()

  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 1200)

  // 缩小后可见范围变大，坐标面必须跟着变大——否则画面四周又是一片空白。
  await expect.poll(readExtent).toBeGreaterThan(near)
})

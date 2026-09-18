import { expect, test } from "@playwright/test"

/**
 * 坐标轴必须钉在**世界原点**上。
 *
 * 用户反馈："你的立体几何内容好像原点位置错了，图有点怪。"
 * 实测（探针）：把内容挪到远离原点的位置（立方体原点 X/Y = 8）之后，自动取景会把相机视点中心带到
 * (10,10)，而栅格与**坐标轴**都跟着那个中心走 —— 坐标轴被画在 (10,10,0)，
 * 离真正的世界原点 191 像素。坐标轴是"零点在哪"的标记，它一跑，整个坐标系就读错了。
 *
 * 这条用例同时断言两件事：栅格**可以**跟着内容走（覆盖范围要够，这是既有需求），
 * 但坐标轴**不可以**（零点只有一个，而且它不动）。
 */
test("keeps the origin marker at the world origin while the grid follows the content", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加立方体" }).click()
  // 一开始内容就在原点附近：坐标轴当然在原点，栅格中心也在原点。
  await expect(scene).toHaveAttribute("data-axes-origin", "0.000,0.000,0.000")

  // 把内容挪远：相机视点中心与栅格中心都会跟着走。
  for (const axis of ["X", "Y"]) await page.getByRole("spinbutton", { name: `原点 ${axis}` }).fill("8")
  await expect(scene).not.toHaveAttribute("data-grid-centre", "0,0")

  // 栅格跟着内容走（覆盖范围要够）……
  await expect(scene).toHaveAttribute("data-grid-centre", "10,10")
  // ……但**坐标轴一动不动**：零点只有一个，它就在世界原点。
  await expect(scene).toHaveAttribute("data-axes-origin", "0.000,0.000,0.000")
})

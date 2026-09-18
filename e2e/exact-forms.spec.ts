import { expect, test } from "@playwright/test"

/**
 * 数值转换面板（用户口径："旁边增加一个数据转换功能，能够识别到图中的小数，并且在功能内输出分数形式，
 * 无理数也能输出，该功能入口在右侧属性栏最高处"）。
 *
 * 这条用例走一遍真实路径：画一个半径 2 的圆 → 量它的面积 → 属性栏最上方的面板里出现 `4π`。
 * 为什么 4π 是个好例子：它是**无理数**（π 的有理倍数），所以这一条同时证明"无理数也能输出"，
 * 而不只是"小数变分数"。
 */
test("converts a measured value into its exact form at the top of the inspector", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.getByRole("region", { name: "功能区" })
  await page.getByRole("button", { name: "固定功能区" }).click()
  const algebra = page.locator(".algebra-panel")
  const canvas = page.locator("svg[aria-label='几何画布']")

  // 面板一开始就在（不需要选中任何东西），只是还空着。
  const panel = page.locator('[aria-label="数值转换"]')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("还没有测量")

  // 半径 2 的圆。
  const box = (await canvas.boundingBox())!
  await ribbon.getByRole("button", { name: "添加圆", exact: true }).click()
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.5)
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5)
  await algebra.getByText("圆 1", { exact: true }).click()
  await page.getByRole("spinbutton", { name: "圆心 X" }).fill("0")
  await page.getByRole("spinbutton", { name: "圆心 Y" }).fill("0")
  await page.getByRole("spinbutton", { name: "半径" }).fill("2")

  // 量面积：π·2² = 4π ≈ 12.566。
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "面积", exact: true }).click()

  const row = panel.locator("[data-exact-form-row]").first()
  await expect(row).toHaveAttribute("data-exact-form-kind", "pi-multiple")
  await expect(row).toHaveAttribute("data-exact-form-text", "4π")
  await expect(row).toContainText("面积")
  await expect(row).toContainText("12.566")

  // 再量周长：2πr = 4π —— 与面积同值不同名字，于是面板上是**两行**（按行列出，不去重）。
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "周长", exact: true }).click()
  await expect(panel.locator("[data-exact-form-row]")).toHaveCount(2)
  await expect(panel).toContainText("周长")
})

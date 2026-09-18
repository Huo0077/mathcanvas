import { expect, test, type Page } from "@playwright/test"

/**
 * 测量数字**常驻画布**（slice 5）：平面几何与立体几何都不需要选中任何对象就能看到数值。
 *
 * 用户口径："我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏
 *（这一点无论是平面几何还是立体几何都要优化）。"
 *
 * 两条用例都刻意在读完数字之后**清空选择**（点画布空白处），再断言数字还在——
 * 这正是"常驻"与旧行为（只在选中来源时出现）的分界。数字还必须与属性栏一致：一个测量只有一个数。
 *
 * 功能区每点一次命令就会自动收起（见 `ribbon-ui.spec.ts`），所以这里先「固定功能区」，
 * 否则第二次点「添加点」会命中收起状态下的另一份节点。
 */
async function pinRibbon(page: Page) {
  const ribbon = page.getByRole("region", { name: "功能区" })
  await page.getByRole("button", { name: "固定功能区" }).click()
  await expect(ribbon).toHaveAttribute("data-ribbon-expanded", "true")
  return ribbon
}

test("keeps a planar measurement number on the canvas without any selection", async ({ page }) => {
  await page.goto("/")
  const ribbon = await pinRibbon(page)
  const canvas = page.locator("svg[aria-label='几何画布']")
  const algebra = page.locator(".algebra-panel")

  /**
   * 两个点必须真的分开：新建的点都落在同一处，两个重合点的长度是**退化**的
   *（内核如实报 degenerate），那就不会有任何数字可画——那测的是别的东西，不是"常驻"。
   */
  const placePoint = async (label: string, x: string, y: string) => {
    await ribbon.getByRole("button", { name: "添加点", exact: true }).click()
    await algebra.getByText(label, { exact: true }).click()
    await page.getByRole("spinbutton", { name: "点 X" }).fill(x)
    await page.getByRole("spinbutton", { name: "点 Y" }).fill(y)
  }
  await placePoint("A", "0", "0")
  await placePoint("B", "3", "0")

  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "长度", exact: true }).click()

  await expect(canvas).toHaveAttribute("data-measurement-labels", "1")
  const label = page.locator("[data-measurement-label]")
  await expect(label).toHaveText(/长度：3\.000u/)
  // 位置在两点中点（世界 (1.5, 0)），不是随便摆在某处。
  const box = (await canvas.boundingBox())!
  const before = (await label.boundingBox())!
  expect(before.x).toBeGreaterThan(box.x + box.width * 0.3)
  expect(before.x).toBeLessThan(box.x + box.width * 0.7)

  // 清空选择（点画布空白处）：数字必须还在——这就是"常驻"。
  await page.mouse.click(box.x + box.width - 12, box.y + 12)
  await expect(label).toHaveText(/长度：3\.000u/)
  await expect(canvas).toHaveAttribute("data-measurement-labels", "1")

  // 拖动一个点，数字跟着几何实时更新（不是创建时拍下来的静态文本）。
  await algebra.getByText("B", { exact: true }).click()
  await page.getByRole("spinbutton", { name: "点 X" }).fill("5")
  await expect(label).toHaveText(/长度：5\.000u/)
})

test("keeps a spatial measurement number on the 3D canvas without any selection", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()
  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await page.locator('[aria-label="三维测量工具"]').getByRole("button", { name: "距离", exact: true }).click()

  // 空间点默认在 (0,0,0) 与 (3,0,0)：距离 3。
  await expect(scene).toHaveAttribute("data-measurement-labels", "1")
  const label = page.locator(".three-measurement-label")
  await expect(label).toHaveText(/距离：3\.000u/)

  // 清空选择之后数字仍在画布上（旧行为是"来源一取消选中，数字就消失"）。
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  await page.mouse.click(box.x + box.width - 12, box.y + 12)
  await expect(label).toHaveText(/距离：3\.000u/)
  await expect(scene).toHaveAttribute("data-measurement-labels", "1")

  // 读数与属性栏是同一个数（选中来源时属性栏给出同一条测量）。
  await algebra.getByText("A", { exact: true }).click()
  await expect(page.locator(".properties").getByText("3.000 u")).toBeVisible()
})

/**
 * 角的单位**两个画布统一到弧度**（2026-09-17 用户决定："改成弧度"）。
 *
 * 原来立体几何的角是度、平面几何的角是弧度，两边各自自洽却彼此不一致；统一之后
 * 画布标签、属性栏与导出说的是同一个数、同一个单位。
 */
test("reads a spatial angle in radians, the same unit the planar canvas uses", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  const algebra = page.locator(".algebra-panel")
  const placePoint = async (label: string, position: [string, string, string]) => {
    await page.getByRole("button", { name: "添加空间点" }).click()
    await algebra.getByText(label, { exact: true }).click()
    for (const [axis, value] of [["X", position[0]], ["Y", position[1]], ["Z", position[2]]] as const) {
      await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).fill(value)
    }
  }
  // 顶点是**第二个**选中的点 B：BA ⊥ BC ⇒ 90° = π/2 ≈ 1.571 rad。
  await placePoint("A", ["0", "0", "0"])
  await placePoint("B", ["3", "0", "0"])
  await placePoint("C", ["3", "3", "0"])

  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await algebra.getByText("C", { exact: true }).click({ modifiers: ["Shift"] })
  await page.locator('[aria-label="三维测量工具"]').getByRole("button", { name: "角度", exact: true }).click()

  await expect(scene).toHaveAttribute("data-measurement-labels", "1")
  await expect(page.locator(".three-measurement-label")).toHaveText(/角度：1\.571rad/)

  // 属性栏是同一个数（一个测量只有一个数），单位不再是度。
  await algebra.getByText("B", { exact: true }).click()
  await expect(page.locator(".properties").getByText("1.571 rad")).toBeVisible()
})

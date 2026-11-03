import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1280, height: 900 } })

/**
 * 用户反馈："立体里的圆相关的内容不要这么多标点啊，只需要四个点就够了。"
 *
 * 圆柱 / 圆锥是多边形近似：48 段会把 96 个细分顶点都画成小球 + 标签（A…Z、P27…P96）。
 * 现在每个圆只保留 4 个象限点（圆柱上下底共 8 个），细分顶点仍参与面 / 棱 / 交线 / 布尔交集，
 * 但画布与对象列表都不再展示它们。
 */
test("shows only the four quadrant points per circle on a cylinder", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加圆柱" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene.locator(".three-point-label")).toHaveCount(8)
  const labels = await scene.locator(".three-point-label").allTextContents()
  expect(labels.sort()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"])

  // 对象列表同样只列象限点：展开圆柱拓扑后顶点行是 8 行，而不是 96 行。
  const algebra = page.locator(".algebra-panel")
  await algebra.getByRole("button", { name: /展开 .*拓扑 的子对象/ }).click()
  const vertexRows = algebra.locator('[data-object-type="point3"]')
  await expect(vertexRows).toHaveCount(8)
})

/**
 * 用户反馈："圆锥中间还有好多点，我不需要这些。"
 *
 * 圆锥的"中间那些点"就是底面环上的 44 个细分顶点（48 段近似）：保留象限点 4 个 + 顶点，共 5 个。
 */
test("shows only the four quadrant points plus the apex on a cone", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加圆锥" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene.locator(".three-point-label")).toHaveCount(5)
  const labels = await scene.locator(".three-point-label").allTextContents()
  expect(labels.sort()).toEqual(["A", "B", "C", "D", "E"])

  const algebra = page.locator(".algebra-panel")
  await algebra.getByRole("button", { name: /展开 .*拓扑 的子对象/ }).click()
  await expect(algebra.locator('[data-object-type="point3"]')).toHaveCount(5)
})

import { expect, test } from "@playwright/test"

/**
 * 拖动动点必须"增量"：只重算与拖动对象相关的图元对，其余交点沿用上一次的结果。
 *
 * 用户反馈："动点的流畅度还需要优化"。实测一次 pointermove 里最贵的就是**全文档两两求交**：
 * 52 个图元 / 6 条采样曲线时要 48.8ms（其余步骤加起来不到 0.5ms），于是拖动只有 ~20fps。
 */
test("recomputes only the affected intersection pairs while dragging a dynamic point", async ({ page }) => {
  await page.goto("/")
  // 固定场景：两条直线 + 两个圆 + 一条函数曲线 → 全量求交要算 10 对（采样曲线很贵）
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/planar-drag-cost.mgeo")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  // 选中那条绑定在圆上的动点
  await page.locator(".algebra-panel").getByText("A", { exact: true }).click()

  const svg = page.locator('svg[aria-label="几何画布"]')
  const readStats = async () => ({
    pairs: Number(await svg.getAttribute("data-preview-pairs")),
    reused: Number(await svg.getAttribute("data-preview-reused")),
    count: Number(await svg.getAttribute("data-preview-count"))
  })

  // 不拖动时是一次全量计算：4 个采样图元两两成对，共 6 对
  await expect.poll(async () => (await readStats()).pairs).toBeGreaterThanOrEqual(1)
  const idle = await readStats()

  // 抓住动点拖 8 步：期间只应重算与它相关的对（动点不是采样图元 → 0 对），其余交点整段沿用
  const handle = svg.locator('[data-primitive-type="point"] circle[data-hit-target="true"]').last()
  const box = (await handle.boundingBox())!
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(start.x + step * 6, start.y + step * 2)
  const during = await readStats()
  await page.mouse.up()

  expect(during.pairs).toBe(0)
  expect(during.pairs).toBeLessThan(idle.pairs)
  expect(during.reused).toBeGreaterThan(0)
  // 沿用 + 重算 = 当前应有的交点数，不能因为"增量"把交点弄丢
  expect(during.count).toBeGreaterThanOrEqual(during.reused)
})

/**
 * 增量的另一半：被拖动对象**自己**涉及的交点必须真的跟着更新。
 * 只"沿用"不"重算"会让拖动时交点停在原地——那就不是优化而是 bug 了。
 */
test("still refreshes the intersections that involve the dragged object", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/planar-drag-cost.mgeo")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()

  const svg = page.locator('svg[aria-label="几何画布"]')
  const markerPositions = async () => svg.locator('[data-auto-intersection="true"] > circle:nth-child(2)').evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("cx")},${node.getAttribute("cy")}`))
  const before = await markerPositions()
  expect(before.length).toBeGreaterThan(0)

  // 选中直线 y = 0 并拖它的端点 A（直线是采样图元）：与它相关的图元对必须重算，交点位置要跟着动。
  // 不用圆的手柄：圆与圆的交点标记正好压在半径手柄上（命中区在标记上），那是另一条独立的交互。
  await page.locator(".algebra-panel").getByText("y = 0", { exact: true }).click()
  const handle = svg.locator('[data-drag-handle="a"]').first()
  const box = (await handle.boundingBox())!
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(start.x, start.y - step * 4)
  const during = { pairs: Number(await svg.getAttribute("data-preview-pairs")), markers: await markerPositions() }
  await page.mouse.up()

  expect(during.pairs).toBeGreaterThan(0)
  expect(during.markers.join("|")).not.toBe(before.join("|"))
})

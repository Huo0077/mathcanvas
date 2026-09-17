import { expect, test } from "@playwright/test"

/**
 * 动点 + 连线场景下的指针归属。
 *
 * 用户反馈（原话）："如果我将动点放在轨道上，同时动点又和另一个定点连了线，那我移动轨道会带着
 * 设置好的定点一起移动"。
 *
 * 取证（用 `elementFromPoint` 读指针到底落在谁身上）发现真正的毛病是**命中顺序**：
 * 连线与轨迹都画在点**之后**，连线的可见线又正好从两端点穿过、轨迹必然穿过动点自己，
 * 于是"点正中心"的那一下指针按下落在连线上；连线是派生对象、`getDragHandle` 返回 null，
 * 拖动根本不成立，还会退化成框选——端点点起来"抓不住"。
 *
 * 场景固定在 `e2e/fixtures/connected-dynamic-point.mgeo`：直线当轨道、绑在它上面的动点 A、
 * 自由的定点 B、A—B 的连线。
 */
test("keeps the connected fixed point put while the track moves the dynamic point", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/connected-dynamic-point.mgeo")
  const svg = page.locator('svg[aria-label="几何画布"]')
  await expect(svg).toBeVisible()

  const pointPosition = async (label: string) => {
    const group = svg.locator('[data-primitive-type="point"]', { hasText: label }).first()
    const circle = group.locator("circle:not([data-hit-target])").first()
    return { x: Number(await circle.getAttribute("cx")), y: Number(await circle.getAttribute("cy")) }
  }
  const connectionAttributes = async () => {
    const visible = svg.locator('[data-primitive-type="connection"] line:not([data-hit-target])').first()
    return { x1: Number(await visible.getAttribute("x1")), y1: Number(await visible.getAttribute("y1")) }
  }

  const beforeA = await pointPosition("A")
  const beforeB = await pointPosition("B")

  // 拖**轨道**（起点取在直线上、远离 A 与连线处）：动点跟着走，定点一动不动。
  const lineHit = svg.locator('[data-primitive-type="line"] line[data-hit-target="true"]').first()
  const lineBox = (await lineHit.boundingBox())!
  const start = { x: lineBox.x + lineBox.width * 0.83, y: lineBox.y + lineBox.height * 0.17 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(start.x + (60 * step) / 6, start.y - (30 * step) / 6)
  await page.mouse.up()

  const afterTrackA = await pointPosition("A")
  const afterTrackB = await pointPosition("B")
  expect(Math.hypot(afterTrackA.x - beforeA.x, afterTrackA.y - beforeA.y)).toBeGreaterThan(5)
  expect(afterTrackB.x).toBeCloseTo(beforeB.x, 3)
  expect(afterTrackB.y).toBeCloseTo(beforeB.y, 3)
  // 连线跟着动点走（它的另一端就是那个没动的定点）。
  expect((await connectionAttributes()).x1).toBeCloseTo(afterTrackA.x, 3)

  // 再拖**动点自己**：能抓住（连线不再吃指针事件），而且它严格沿轨道滑动。
  const dynamicHit = svg.locator('[data-primitive-type="point"]', { hasText: "A" }).first().locator('circle[data-hit-target="true"]').last()
  const dynamicBox = (await dynamicHit.boundingBox())!
  const dynamicStart = { x: dynamicBox.x + dynamicBox.width / 2, y: dynamicBox.y + dynamicBox.height / 2 }
  const topmost = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    return element?.closest?.("[data-primitive-type]")?.getAttribute("data-primitive-type") ?? "none"
  }, dynamicStart)
  expect(topmost).toBe("point")

  const fixedBefore = await pointPosition("B")
  await page.mouse.move(dynamicStart.x, dynamicStart.y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(dynamicStart.x + (36 * step) / 6, dynamicStart.y + (18 * step) / 6)
  await page.mouse.up()

  const slid = await pointPosition("A")
  expect(Math.hypot(slid.x - afterTrackA.x, slid.y - afterTrackA.y)).toBeGreaterThan(3)
  // 拖动点这一个动作绝不能带走那个定点。
  const fixedAfter = await pointPosition("B")
  expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 3)
  expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 3)
})

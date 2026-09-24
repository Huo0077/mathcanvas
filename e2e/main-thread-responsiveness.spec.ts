import { expect, test } from "@playwright/test"

/**
 * **主线程响应性读数**（评审方案 7 的最后一项）。
 *
 * 它回答的问题与 node 基准**不是**同一个：
 * - `packages/scene-graph/src/largeScene.bench.test.ts` 量"某一步要算多久"（增量成本）；
 * - 这里量"主线程被**连续占用**了多久" —— 那才是用户感到"卡"的那个量。
 *
 * ## 为什么不用 `longtask` API（实测结论，不是偏好）
 *
 * 评审原文点名的是 `longtask`。但**这台环境里它不工作**，而且是"声称支持、什么也不报"：
 * 在**空白页**上（与应用无关）登记 `PerformanceObserver({ entryTypes: ["longtask"] })`，
 * 再故意阻塞主线程 200ms，`observed` 与 `performance.getEntriesByType("longtask")` **都是空的**，
 * 而 `PerformanceObserver.supportedEntryTypes` 里**确实**有 `longtask`
 *（Chromium 153 / Playwright 的 headless）。这已用一次性探针复核过，探针用完即删。
 *
 * 所以这里换一个**同一件事**、但在这台环境里真的能读的量：**帧间隔**（`requestAnimationFrame` 的间隔）。
 * 它的好处是更贴近用户口径 —— 用户说的"卡"就是"两帧之间停了很久"，而 50ms 的长任务定义本身
 * 只是一个代理指标。同一个 200ms 阻塞，在帧间隔上必定表现为 ≥200ms 的空档，所以量具的**灵敏度可自证**
 * （见下面的标定断言）。
 *
 * ## 阈值是**报警线**，不是性能目标
 *
 * 与仓库里其它基准同一个口径（见 `largeScene.bench.test.ts` 的头注释）：断言取得很松
 * （单次空档 250ms），用来抓"复杂度写错了"这一类错误。真正要看的，是打出来的 `PERF` 读数。
 */
test("reports main-thread frame gaps while loading and dragging", async ({ page }) => {
  /**
   * 帧间隔记录器必须在页面脚本之前装上，否则载入阶段的前几帧就丢了。
   * 每一帧把"距上一帧多久"记下来 —— 那个空档就是主线程当时被占用的时长。
   */
  await page.addInitScript(() => {
    const store = window as unknown as { __frameGaps?: { at: number; gap: number }[] }
    store.__frameGaps = []
    let last = performance.now()
    const tick = (now: number) => {
      store.__frameGaps?.push({ at: now, gap: now - last })
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/")

  // 固定场景：两条直线 + 两个圆 + 一条函数曲线（与拖动性能用例同一份夹具）
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/planar-drag-cost.mgeo")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()

  const read = () => page.evaluate(() => ((window as unknown as { __frameGaps?: { at: number; gap: number }[] }).__frameGaps ?? []).map((frame) => frame.gap))
  const afterLoad = await read()

  // 拖 24 步动点：拖动是"每一帧都要重算"的那类交互，最长空档最可能出现在这里
  await page.locator(".algebra-panel").getByText("A", { exact: true }).click()
  const svg = page.locator('svg[aria-label="几何画布"]')
  const handle = svg.locator('[data-primitive-type="point"] circle[data-hit-target="true"]').last()
  const box = (await handle.boundingBox())!
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 24; step += 1) await page.mouse.move(start.x + step * 4, start.y + step * 2)
  await page.mouse.up()
  const all = await read()
  const during = all.slice(afterLoad.length)

  const longest = (values: number[]) => (values.length === 0 ? 0 : Math.max(...values))
  /** 95 分位：比"最长一次"更能说明"平时卡不卡"（最长一次常被 GC 或首次渲染带走）。 */
  const p95 = (values: number[]) => {
    if (values.length === 0) return 0
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  }
  const report = (phase: string, values: number[]) => `PERF frame-gap ${phase} frames=${values.length} max=${longest(values).toFixed(1)}ms p95=${p95(values).toFixed(1)}ms`
  console.log(report("load", afterLoad))
  console.log(report("drag", during))
  console.log(report("page", all))

  /**
   * **先证明量具准，再相信上面那几个数。**
   *
   * "空档很小"有两种原因：应用真的很流畅，或者记录器根本没在跑 —— 两者在读数上长得一样。
   * 故意阻塞主线程 200ms：如果帧间隔上连这都看不出来，上面那些数就是**仪器坏了**。
   * （这正是 `longtask` 那条路翻车的方式：它连 200ms 都不报，只是它不会自己说自己坏了。）
   */
  const calibrationStart = all.length
  await page.evaluate(() => {
    const started = performance.now()
    while (performance.now() - started < 200) { /* 故意阻塞主线程 */ }
  })
  await page.waitForTimeout(250)
  const calibration = (await read()).slice(calibrationStart)
  console.log(report("deliberate-block", calibration))
  expect(longest(calibration), "故意阻塞 200ms 却没在帧间隔上出现空档：量具坏了，不是应用变快了").toBeGreaterThanOrEqual(150)

  /**
   * 断言只落在**拖动**这一档上，不落在 `load` / `page` 上。
   *
   * 载入那一档是"冷启动 + 整个 bundle 的解析执行 + 首次渲染"，在并行跑整套 e2e 时会被
   * 其它 worker 抢 CPU 而明显变大（实测：单独跑 99.9ms，整套并行跑 266.6ms）——
   * 那是**测量环境**的噪声，不是应用变慢了，拿它当门禁只会得到一条随机变红的用例。
   * 拖动这一档是我们自己驱动、自己计帧的，才是"这段代码有没有把主线程占住"的判据。
   *
   * 但它同样怕**机器负载**：把整套 node 单测（2766 条）与这套 e2e 并行跑时，同一条断言读到过
   * **366.7ms**，而单跑是 **16.8ms**（差 22 倍，阈值 250ms）—— 所以"两套一起跑"的那次结果不算
   * 一次有效的 e2e 验收，得分开跑。CI 里它们本来就是两个作业。
   */
  expect(longest(during)).toBeLessThan(250)
})

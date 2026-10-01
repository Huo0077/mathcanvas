import { expect, test } from "@playwright/test"

/**
 * **栅格"无限延伸"的浏览器侧守卫**（2026-10-01 用户口径："把 0 平面也就是 z=0 的格子网做成无限延伸的感觉"）。
 *
 * 栅格终究是一块有限方块（1 格 = 1 世界单位、按 2 的幂分档铺），所以那条直边一定存在 ——
 * 做法是让它**在到达边界之前化开**：材质里按"到块中心的距离"`smoothstep` 到 0。
 * 这里断言两件事：
 *
 * 1. **淡出到边界处正好为 0** ⇒ 那条直边永远看不见；
 * 2. **满实区（淡出起点以内）盖住可见地面脚印** ⇒ 化开的那一圈落在视野之外。
 *    只有贴到地平线触到覆盖上限（4096 格）时例外，那时远处会在纸面上化开 —— 那正是要的观感。
 *
 * 还有一条只有浏览器能验的事：格线换成了着色器材质，**GLSL 编译不能出错**。
 * 单测跑在 jsdom 里、根本没有 WebGL，所以"着色器能不能编译"永远只能在这里守。
 */
test("fades the grid out beyond the visible ground, and its shader compiles", async ({ page }) => {
  const problems: string[] = []
  page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()) })
  page.on("pageerror", (error) => problems.push(String(error)))

  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  const read = async () => ({
    extent: Number(await scene.getAttribute("data-grid-extent")),
    fade: (await scene.getAttribute("data-grid-fade"))!.split(",").map(Number),
    reach: Number(await scene.getAttribute("data-grid-ground-reach"))
  })

  const start = await read()
  // 可见脚印真的被量出来了（不是 0、也不是 NaN）。
  expect(start.reach).toBeGreaterThan(0)
  // 淡出到覆盖半径处正好为 0 ⇒ 方块那条直边不可见。
  expect(start.fade[1]).toBe(start.extent)
  // 没撞覆盖上限时，满实区必须盖住整个可见脚印。
  if (start.extent < 4096) expect(start.fade[0]).toBeGreaterThanOrEqual(start.reach)

  // 拖一下相机（**不看方向**：抬高或压低都行），重新算出来的脚印与覆盖必须仍守同一条不变量。
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.35, { steps: 12 })
  await page.mouse.up()

  await expect.poll(async () => (await read()).reach).not.toBe(start.reach)
  const moved = await read()
  expect(moved.fade[1]).toBe(moved.extent)
  if (moved.extent < 4096) expect(moved.fade[0]).toBeGreaterThanOrEqual(moved.reach)

  // GLSL 编译失败会以 `THREE.WebGLProgram: Shader Error …` 的形式进控制台：一条都不许有。
  expect(problems.filter((text) => /shader|GLSL|WebGLProgram|THREE\.WebGL/i.test(text))).toEqual([])
})

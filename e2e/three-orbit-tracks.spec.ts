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
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

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

/**
 * 拖动**绑在轨道上的点**时，必须看得见它此刻走到哪了。
 *
 * 用户反馈："动点移动的动画没有了，就是动点移动的时候我只能看到在拖动但是拖到哪里了根本不知道，
 * 直到松手才能看到位置。"
 *
 * 实测根因（探针读数）：参数确实在实时走（`data-host-residual` = 0、`data-drag-parameter` 从 π 一路变），
 * 但**画面上那个点没被重建到新坐标**——`refreshPrimitiveObject` 是按**文档里的图元**重建的，
 * 而拖动预览只把新坐标写进了内存里的 `points` 表，于是重建出来的是**旧位置**的球；
 * 抬手提交文档，点才"跳"过去。点标注投的正是那个球（`pointLabels.ts`），
 * 所以"拖的时候字母不动"和"点手柄不动"是同一件事。
 */
test("shows the bound point moving while the pointer is still down", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const scene = page.locator("[data-3d-scene]")
  // 先把相机钉死：下面要把世界坐标投影成抓取点，取景动画一跑就抓空了。
  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement | null)?.click())
  await page.getByRole("button", { name: "重置3D视角" }).click()
  await settleCamera(scene)

  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByText("A", { exact: true }).first().click()
  await page.getByText("B", { exact: true }).first().click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()

  // 第三个点 C 绑到这条轨道上，它就是要被拖的动点。
  await page.getByRole("button", { name: "添加空间点" }).click()
  const select = page.getByRole("combobox", { name: "点宿主绑定" })
  const orbitValue = await select.locator("option").filter({ hasText: "圆轨道" }).first().getAttribute("value")
  await select.selectOption(orbitValue!)

  const label = page.locator('.three-point-label[data-point-label="C"]')
  const labelBefore = await label.boundingBox()
  expect(labelBefore).not.toBeNull()
  const before = await readPointPosition(page)

  await page.getByRole("button", { name: "自由拖动" }).click()
  const start = await projectWorldPoint(page, { x: before[0], y: before[1], z: before[2] })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // 抓的必须是这个点（不是旁边的棱或面），否则下面量的是别的东西。
  await expect(scene).toHaveAttribute("data-drag-target", /^point:/)
  await page.mouse.move(start.x + 48, start.y - 36, { steps: 8 })

  // **手还没松**：参数已经变了，画面上这个点也必须已经在别处了。
  const parameterMid = await scene.getAttribute("data-drag-parameter")
  expect(parameterMid).not.toBeNull()
  const labelMid = await label.boundingBox()
  expect(labelMid).not.toBeNull()
  const moved = Math.hypot(labelMid!.x - labelBefore!.x, labelMid!.y - labelBefore!.y)
  expect(moved).toBeGreaterThan(4)
})

/** 等相机**停稳**（连续两次读数一致）再投影；判据不依赖动画时长。 */
async function settleCamera(scene: import("@playwright/test").Locator) {
  let previous = ""
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = `${await scene.getAttribute("data-camera-azimuth")}|${await scene.getAttribute("data-camera-elevation")}|${await scene.getAttribute("data-camera-distance")}|${await scene.getAttribute("data-camera-target")}`
    if (current === previous) return
    previous = current
    await scene.page().waitForTimeout(120)
  }
}

/**
 * 用户口径的原话就是这一条："**圆轨道上的动点无法与定点建立直线连接**"。
 *
 * 根因是 `point3` 的 `onHost` 宿主白名单漏了 `circle3`，而校验是**整份文档**级别的、
 * `addPrimitive` 写入前必过——于是轨道上只要有动点，**之后加点 / 建线 / 建面全部被拒**
 * （实测报 `point3 host binding is invalid`），用户看到的就是"连不出直线"。
 *
 * 这条在浏览器里把用户的动作原样走一遍：轨道 → 动点绑上去 → 选动点与定点 → 建空间直线。
 */
test("connects a point that rides the track with a fixed point by a line", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  const algebra = page.locator(".algebra-panel")

  // 定点 A（圆心）+ 圆周点 B ⇒ 半径 3 的轨道。
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()

  // 动点 C 绑到轨道上（这一步以前会让后续所有新建失效）。
  await page.getByRole("button", { name: "添加空间点" }).click()
  const select = page.getByRole("combobox", { name: "点宿主绑定" })
  const orbitValue = await select.locator("option").filter({ hasText: "圆轨道" }).first().getAttribute("value")
  await select.selectOption(orbitValue!)
  await expect(page.getByRole("spinbutton", { name: "宿主参数" })).toBeVisible()

  // 动点 + 定点 ⇒ 空间直线：真的建出来了（被拒时这里一行都不会有）。
  await algebra.getByText("C", { exact: true }).click()
  await algebra.getByText("A", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "由选中点创建空间直线" }).click()
  await expect(algebra.getByText("空间直线 1", { exact: true })).toBeVisible()
  // 如实断言"没有报错"：宿主绑定校验失败时会往这里写一句话。
  await expect(page.locator(".status-bar-prompt")).not.toContainText("host binding")
})

async function readPointPosition(page: Page): Promise<number[]> {
  return Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).inputValue())))
}

/** 选中圆轨道后检查器里的圆心坐标读数（圆心现在是可编辑的**真实字段**）。 */
async function readCircleCentre(page: Page): Promise<number[]> {
  return Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `圆心 ${axis}` }).inputValue())))
}

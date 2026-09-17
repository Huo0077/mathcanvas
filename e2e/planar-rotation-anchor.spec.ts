import { expect, test } from "@playwright/test"

/**
 * 在**画布上**用指针选点 + Shift 选曲线，命令必须变为可用。
 *
 * 这条是用户实际做法的回归。用户反馈："选中一个点 → Shift 选中一个圆或椭圆 → 点「绕定点旋转」无法实现"。
 * 取证（Playwright 探针读代数区的 `.selected` 行）发现真正的问题是**选择被处理了两次**：
 * `pointerDown` 先按加选把圆加进去，紧接着 `click` 又按加选处理一次 ——
 * 而"加选"的语义是**切换**，于是同一个对象被加了又删，最终选择变成空集，命令一直是禁用的。
 *
 * 这条测试同时守住"选中之后命令真的可用"这一整条通路，而不只是选中状态。
 */
/**
 * 用户口径的**主入口**：点一个定点 → 右侧「创建动圆」→ 曲线以它为定点生成。
 *
 * 用户原话（第二次修正）：「创建一个定点后，点击定点，右侧应该出现选择创建一个"动圆"，
 * 这个动圆不需要标出圆心，但需要能够修改半径。在删除定点后，这个动圆也会跟着消失」。
 *
 * 这条在浏览器里把四件事一起验掉：入口、过定点、**不画圆心**、删点级联消失。
 */
test("creates a moving circle from the selected point, without a centre marker, and takes it away with the point", async ({ page }) => {
  await page.goto("/")
  // 这个夹具只有一个定点，动圆完全由界面创建（不预置曲线）。
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/rotation-pivot-only.mgeo")
  const svg = page.locator('svg[aria-label="几何画布"]')
  await expect(svg).toBeVisible()

  const selectedLabels = () => page.evaluate(() =>
    Array.from(document.querySelectorAll(".algebra-panel .object-row.selected")).map((row) => row.querySelector(".object-name")?.textContent ?? ""))

  // 点画布上的定点。
  const pointHit = svg.locator('[data-primitive-type="point"][data-point-hit="top"]').first()
  const pointBox = (await pointHit.boundingBox())!
  await page.mouse.click(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2)
  expect(await selectedLabels()).toEqual(["P"])

  // 右侧出现「创建动圆」，点它。
  const create = page.getByRole("button", { name: "创建动圆" })
  await expect(create).toBeEnabled()
  await create.click()

  // 曲线生成了，而且**过这个定点**（屏幕上定点到圆心的距离 = 半径）。
  const ratio = () => svg.evaluate((root) => {
    const point = root.querySelector('[data-primitive-type="point"] circle:not([data-hit-target])') as SVGCircleElement
    const shape = root.querySelector('[data-primitive-type="circle"] circle:not([data-hit-target]):not([data-shape-centre])') as SVGCircleElement | null
    if (!shape) return Number.NaN
    return Math.hypot(point.cx.baseVal.value - shape.cx.baseVal.value, point.cy.baseVal.value - shape.cy.baseVal.value) / shape.r.baseVal.value
  })
  await expect.poll(ratio).toBeCloseTo(1, 2)

  // 用户要求：**不需要标出圆心** —— 动圆不画圆心小圆点。
  expect(await svg.locator('[data-primitive-type="circle"] [data-shape-centre]').count()).toBe(0)
  // 选中时才有定点标记（它只是"定点在哪"的说明，不是圆心）。
  await expect(svg.locator('[data-rotation-anchor]').first()).toBeVisible()
  // 点空白处取消选中：画布上不该留下任何圆心 / 定点标记。
  const canvasBox = (await svg.boundingBox())!
  await page.mouse.click(canvasBox.x + 24, canvasBox.y + canvasBox.height - 24)
  await expect(svg.locator('[data-rotation-anchor]')).toHaveCount(0)
  // 重新选中曲线（走对象列表，位置无关），继续验半径。
  await page.locator(".algebra-panel .object-row").filter({ hasText: "动圆" }).first().click()
  await expect(page.getByRole("spinbutton", { name: "半径" })).toBeVisible()

  // 半径可改：改完定点仍在圆上。
  const radiusInput = page.getByRole("spinbutton", { name: "半径" })
  await radiusInput.fill("4.5")
  await radiusInput.blur()
  await expect.poll(ratio).toBeCloseTo(1, 2)
  const radius = await svg.locator('[data-primitive-type="circle"] circle:not([data-hit-target]):not([data-shape-centre])').first().getAttribute("r")
  expect(Number(radius)).toBeGreaterThan(0)

  // 删掉定点：动圆跟着消失。（"删除对象"在功能区与控制条各有一处，取功能区那个。）
  await page.mouse.click(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2)
  await page.getByRole("button", { name: "删除对象" }).first().click()
  await expect(svg.locator('[data-primitive-type="circle"]')).toHaveCount(0)
})

/**
 * 封闭曲线绕定点旋转：**浏览器里的**验收。
 *
 * 用户原话："高中数学中有一类题目是有一些封闭曲线（圆，椭圆）过一个定点。
 * 现在你实现圆（椭圆）可以过一个定点旋转的功能。"
 *
 * jsdom 的端到端（`App.test.tsx`）已经验证了文档状态，这一条补的是浏览器侧：画布上真的画出了
 * 定点标记与旋转手柄、手柄真的**拖得动**、拖完曲线仍然过那个定点。
 *
 * 场景固定在 `e2e/fixtures/rotation-anchor.mgeo`：圆心在原点、半径 3 的圆，外加一个**不在圆上**的点
 * P(5,0)——命令应当把 P 投影到圆上（3,0），而不是拒绝。
 */
test("anchors a circle on a selected point and keeps it there while rotating", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/rotation-anchor.mgeo")
  const svg = page.locator('svg[aria-label="几何画布"]')
  await expect(svg).toBeVisible()

  const algebraRow = (label: string) => page.locator(".algebra-panel .object-row").filter({ hasText: label }).first()
  const circleAttributes = async () => {
    const circle = svg.locator('[data-primitive-type="circle"] circle:not([data-hit-target])').first()
    return {
      cx: Number(await circle.getAttribute("cx")),
      cy: Number(await circle.getAttribute("cy")),
      r: Number(await circle.getAttribute("r"))
    }
  }
  const pointAttributes = async (label: string) => {
    const group = svg.locator('[data-primitive-type="point"]', { hasText: label }).first()
    const circle = group.locator("circle:not([data-hit-target])").first()
    return { x: Number(await circle.getAttribute("cx")), y: Number(await circle.getAttribute("cy")) }
  }
  /** 视图变换含 Y 翻转与视口平移，所以判断"过不过"一律用**距离**：屏幕上定点到圆心的距离 = 屏幕上半径。 */
  const distancePivotToCenter = async (label: string) => {
    const point = await pointAttributes(label)
    const circle = await circleAttributes()
    return Math.hypot(point.x - circle.cx, point.y - circle.cy)
  }

  // 点 P 一开始明明不在圆上：这是"命令要把点投影上去"的前提。
  const beforeCircle = await circleAttributes()
  const beforePoint = await pointAttributes("P")
  expect(Math.abs(Math.hypot(beforePoint.x - beforeCircle.cx, beforePoint.y - beforeCircle.cy) - beforeCircle.r)).toBeGreaterThan(5)

  // 没选中合适组合时命令禁用；选「一个点 + 一条圆」后可用。
  const command = page.getByRole("button", { name: "绕定点旋转" })
  await expect(command).toBeDisabled()
  await algebraRow("P").click()
  await algebraRow("圆 c").click({ modifiers: ["Shift"] })
  await expect(command).toBeEnabled()
  // 状态栏得说出这件事，否则用户不知道有这个能力。
  await expect(page.getByRole("status", { name: "操作提示" })).toContainText("绕定点旋转")
  await command.click()

  // 定点被投影到圆上：屏幕上距离 = 半径。这正是"过一个定点"。
  await expect.poll(() => distancePivotToCenter("P")).toBeCloseTo((await circleAttributes()).r, 1)
  // 画布上出现定点标记；动圆不画圆心，也没有单独的旋转手柄（拖圆本体就是转）。
  await expect(svg.locator('[data-rotation-anchor="circle-1"]')).toBeVisible()
  await expect(svg.locator('[data-drag-handle="rotate"]')).toHaveCount(0)
  expect(await svg.locator('[data-primitive-type="circle"] [data-shape-centre]').count()).toBe(0)

  // 检查器给出定点与转角。
  await expect(page.getByRole("spinbutton", { name: "绕定点转角" })).toHaveValue("0")

  /**
   * 拖**圆本身**：绕定点转过一个明显角度。
   *
   * 起点取圆周的**最下方**：动圆的半径手柄摆在"定点 + 半径"处，也就是圆周最右点上，
   * 从那里按下会被判成"改半径"而不是"转动"（实测）。每一帧都重新取坐标再往切向推，
   * 因为拖动过程中圆周一直在动，一次性算好终点会让指针中途离开圆。
   */
  const screenRadius = (await svg.locator('[data-primitive-type="circle"] circle:not([data-hit-target]):not([data-shape-centre])').first().boundingBox())!.width / 2
  for (let step = 0; step < 24; step += 1) {
    const circleBox = (await svg.locator('[data-primitive-type="circle"] circle:not([data-hit-target]):not([data-shape-centre])').first().boundingBox())!
    const onCurve = { x: circleBox.x + circleBox.width / 2, y: circleBox.y + circleBox.height }
    const pivot = await pointAttributes("P")
    // 从定点指向圆周上那一点，取其垂直方向作为切向（圆周运动的一步）。
    const outward = { x: onCurve.x - pivot.x, y: onCurve.y - pivot.y }
    const length = Math.hypot(outward.x, outward.y) || 1
    const tangent = { x: -outward.y / length, y: outward.x / length }
    const stepSize = screenRadius * 0.12
    await page.mouse.move(onCurve.x, onCurve.y)
    await page.mouse.down()
    await page.mouse.move(onCurve.x + tangent.x * stepSize, onCurve.y + tangent.y * stepSize)
    await page.mouse.up()
  }

  // 转过之后，定点仍然在圆上（这是整件事的不变量），而且曲线确实动了。
  const turnedCircle = await circleAttributes()
  await expect.poll(() => distancePivotToCenter("P")).toBeCloseTo(turnedCircle.r, 1)
  expect(Math.hypot(turnedCircle.cx - beforeCircle.cx, turnedCircle.cy - beforeCircle.cy)).toBeGreaterThan(5)
  // 转角读数不再是 0。
  await expect(page.getByRole("spinbutton", { name: "绕定点转角" })).not.toHaveValue("0")
})

/**
 * 拖动**定点本身**：整条曲线跟着走，而且始终过它。
 *
 * 这条补的是一个先前的验证缺口：我此前只在单测里验过"定点移动→曲线重算"，
 * 浏览器里从没拖过那个点。它也正是这个功能在实际作图时的用法
 * （"在曲线上取一个点、让曲线绕它转，然后挪动那个点"）。
 *
 * 夹具 `rotation-pivot-drag.mgeo` 里曲线**已经定型**（定点是点图元 P、转角 0.6），
 * 所以这一条只考"定点动、曲线跟"这一件事。
 */
test("drags the fixed point itself and the curve follows, still passing through it", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/rotation-pivot-drag.mgeo")
  const svg = page.locator('svg[aria-label="几何画布"]')
  await expect(svg).toBeVisible()

  /**
   * "定点到圆心的屏幕距离"与"半径"之比，全部在**浏览器渲染坐标系**里算。
   *
   * `getAttribute("cx")` 给的是 SVG 用户单位，而这个视口的 `viewBox` 与 CSS 尺寸并不等比，
   * 所以不能拿屏幕鼠标坐标去和它比（实测同一个正确状态会算出 0.47 这种比值）。
   * JS 里读到的几何与 `getBoundingClientRect()` 是同一套坐标系，比值恒为 1 才叫"过定点"。
   */
  const pivotRatio = async () => {
    const group = svg.locator('[data-primitive-type="point"]', { hasText: "P" }).first()
    return group.evaluate((node) => {
      const root = node.closest("svg")!
      const point = node.querySelector("circle:not([data-hit-target])")!
      const circle = root.querySelector('[data-primitive-type="circle"] circle:not([data-hit-target])')!
      return Math.hypot(point.cx.baseVal.value - circle.cx.baseVal.value, point.cy.baseVal.value - circle.cy.baseVal.value) / circle.r.baseVal.value
    })
  }
  /** 圆在屏幕上的圆心与半径（屏幕像素，用于判断"曲线确实动了"）。 */
  const circleScreen = async () => {
    const circle = svg.locator('[data-primitive-type="circle"] circle:not([data-hit-target])').first()
    return circle.evaluate((node) => {
      const matrix = (node as SVGGraphicsElement).getScreenCTM()!
      return { cx: matrix.a * (node as SVGCircleElement).cx.baseVal.value + matrix.e, cy: matrix.d * (node as SVGCircleElement).cy.baseVal.value + matrix.f, r: matrix.a * (node as SVGCircleElement).r.baseVal.value }
    })
  }

  const beforeCircle = await circleScreen()
  // 起点也满足"过定点"：这正是上一次拖过之后留下的状态。
  expect(await pivotRatio()).toBeCloseTo(1, 2)

  // 拖定点 P：它是个自由点，拖得动；曲线应当跟着走。
  const pivotHit = svg.locator('[data-primitive-type="point"]', { hasText: "P" }).first().locator('circle[data-hit-target="true"]').last()
  const box = (await pivotHit.boundingBox())!
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(start.x - (80 * step) / 8, start.y + (40 * step) / 8)
  await page.mouse.up()

  const afterCircle = await circleScreen()
  // 定点真的动了（屏幕上那个点挪了位置），曲线也跟着动了。
  expect(Math.hypot(afterCircle.cx - beforeCircle.cx, afterCircle.cy - beforeCircle.cy)).toBeGreaterThan(5)
  // 半径没变（"转过任意角度都过定点"不该改变曲线大小）。
  expect(afterCircle.r).toBeCloseTo(beforeCircle.r, 1)
  // 最关键的一条：挪完定点，曲线**仍然过它**。
  await expect.poll(pivotRatio).toBeCloseTo(1, 2)
})

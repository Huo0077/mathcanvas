import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 轨道圆的**半径手柄**（slice 2）：抓圆周上那个手柄往外拉，半径跟着变。
 *
 * 用户口径："圆要可以缩放旋转"——旋转是世界轴三色环（上一轮已交付），缩放就是这个手柄。
 *
 * 三件事必须同时成立，缺一件这个手柄就是坏的：
 * 1. 拖动**期间**读数已经变了（不是抬手才跳）；
 * 2. 抬手提交一次、属性栏与文档一致，而且**一步撤销**就回到原半径；
 * 3. 绑在圆上的点**跟着到新圆周上**（到圆心距离 = 新半径，残差 ≈ 0），而不是等抬手才跳过去。
 */
test("scales the track by dragging its radius handle, keeping bound points on the rim", async ({ page }) => {
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
  // 圆心 A(0,0,0) + 圆周点 B(3,0,0) ⇒ 半径 3；再接一个点 C 绑到轨道上当"乘客"。
  await placePoint("A", ["0", "0", "0"])
  await placePoint("B", ["3", "0", "0"])
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()

  await placePoint("C", ["3", "0", "0"])
  const hostSelect = page.getByRole("combobox", { name: "点宿主绑定" })
  const trackOption = await hostSelect.locator("option").filter({ hasText: "圆轨道" }).first().getAttribute("value")
  await hostSelect.selectOption(trackOption!)
  await expect(page.getByRole("spinbutton", { name: "宿主参数" })).toBeVisible()

  // 回到轨道：手柄只在"恰好选中一个轨道"时出现。
  await algebra.getByText("圆轨道 1", { exact: true }).click()
  await expect(scene).toHaveAttribute("data-track-radius", "3.0000")
  const radiusInput = page.getByRole("spinbutton", { name: "圆轨道半径" })
  await expect(radiusInput).toHaveValue("3")

  /**
   * 手柄在**宿主参数 0** 处，而宿主参数 0 落在哪个方向由 `circleHost3` 自己的帧决定
   * （法向 +z 时是 −y 而不是 +x），所以抓取点从画布读数 `data-track-handle` 里取，不靠猜。
   */
  const handleReading = (await scene.getAttribute("data-track-handle"))!
  const [hx, hy, hz] = handleReading.split(",").map(Number)
  // 手柄确实在圆周上（离圆心一个半径）：读数本身也要是可信的。
  expect(Math.hypot(hx, hy, hz)).toBeCloseTo(3, 2)

  const handle = await projectWorldPoint(page, { x: hx, y: hy, z: hz })
  // "往外拉"必须按**画布上圆心 → 手柄**的方向走：相机一转，屏幕右方在世界里就不一定是"外"。
  const centreOnScreen = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  const outward = { x: handle.x - centreOnScreen.x, y: handle.y - centreOnScreen.y }
  const outwardLength = Math.hypot(outward.x, outward.y)
  const step = { x: (outward.x / outwardLength) * 70, y: (outward.y / outwardLength) * 70 }
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + step.x / 2, handle.y + step.y / 2, { steps: 3 })
  await page.mouse.move(handle.x + step.x, handle.y + step.y, { steps: 3 })

  // (1) 拖动**期间**半径已经变了（不是抬手才跳），而且绑定点仍然贴在圆周上。
  const during = Number(await scene.getAttribute("data-track-radius"))
  expect(during).toBeGreaterThan(3)

  await page.mouse.up()

  // (2) 提交一次：属性栏与文档一致。
  const committed = Number(await radiusInput.inputValue())
  expect(committed).toBeGreaterThan(3)
  expect(committed).toBeCloseTo(during, 1)

  // (3) 绑在圆上的点 C 落在新圆周上：到圆心 A 的距离 = 新半径。
  await algebra.getByText("C", { exact: true }).click()
  const c = await Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).inputValue())))
  await algebra.getByText("A", { exact: true }).click()
  const a = await Promise.all(["X", "Y", "Z"].map(async (axis) => Number(await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).inputValue())))
  expect(Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])).toBeCloseTo(committed, 1)

  // (4) 一次拖动 = 一步撤销：回到原半径，而不是"轨道没了"。
  await page.keyboard.press("Control+z")
  await algebra.getByText("圆轨道 1", { exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "圆轨道半径" })).toHaveValue("3")
})

/**
 * 轨道圆的**旋转**（"圆要可以缩放旋转"的另一半）：选中轨道时同样出世界轴三色环，拖 X 环把轨道摆斜——
 * 圆心不动、法向转 90°，一次撤销回到原来的朝向。
 */
test("turns the track with the world-axis rings, keeping its centre", async ({ page }) => {
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
  await placePoint("A", ["0", "0", "0"])
  await placePoint("B", ["3", "0", "0"])
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()
  await algebra.getByText("圆轨道 1", { exact: true }).click()

  // 圆轨道是**可转对象**：三个环照旧出现（它不再拥有点，环的几何按它自己的圆心与半径算）。
  await expect(scene).toHaveAttribute("data-rotation-handles", "3")
  const orientation = page.locator("[data-object-orientation]")
  await expect(orientation).toHaveAttribute("data-object-orientation", "0.000,0.000,1.000")

  // 先缩小一档，保证环上那两个抓取点落在画布内（环半径 = 1.25R + 0.3 = 4.05）。
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  const distanceBefore = await scene.getAttribute("data-camera-distance")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 300)
  await expect.poll(async () => scene.getAttribute("data-camera-distance")).not.toBe(distanceBefore)

  const pivot = (await scene.getAttribute("data-rotation-handle-pivot"))!.split(",").map(Number)
  const ringRadius = Number(await scene.getAttribute("data-rotation-handle-radius"))
  // 绕 X 转 +90°：从环上 45° 处（只有 X 环经过）拖到 135° 处。
  const diagonal = ringRadius / Math.SQRT2
  const from = await projectWorldPoint(page, { x: pivot[0], y: pivot[1] + diagonal, z: pivot[2] + diagonal })
  const to = await projectWorldPoint(page, { x: pivot[0], y: pivot[1] - diagonal, z: pivot[2] + diagonal })
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await expect(scene).toHaveAttribute("data-rotation-axis", "x")
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8)
  await expect(scene).toHaveAttribute("data-rotation-degrees", "90.00")
  await page.mouse.up()

  // 法向从 +Z 转到 −Y（绕 +X 转 90° 的右手结果），**圆心一动不动**。
  await expect(orientation).toHaveAttribute("data-object-orientation", "0.000,-1.000,0.000")
  expect(await page.getByRole("spinbutton", { name: "圆心 X" }).inputValue()).toBe("0")
  expect(await page.getByRole("spinbutton", { name: "圆心 Y" }).inputValue()).toBe("0")
  expect(await page.getByRole("spinbutton", { name: "圆心 Z" }).inputValue()).toBe("0")

  // 一次拖动 = 一步撤销：回到水平。
  await page.keyboard.press("Control+z")
  await expect(orientation).toHaveAttribute("data-object-orientation", "0.000,0.000,1.000")
})

/** 没抓到手柄时行为必须一字不变：指针在圆心附近按下不会改半径。 */test("leaves the radius alone when the pointer is not on the handle", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  const algebra = page.locator(".algebra-panel")
  await page.getByRole("button", { name: "添加空间点" }).click()
  await algebra.getByText("A", { exact: true }).click()
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()
  await expect(scene).toHaveAttribute("data-track-radius", "1.5000")

  // 从圆心往外拖一段：那里没有手柄，半径必须原样不动。
  const centre = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 80, centre.y + 20, { steps: 6 })
  await page.mouse.up()

  await algebra.getByText("圆轨道 1", { exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "圆轨道半径" })).toHaveValue("1.5")
})

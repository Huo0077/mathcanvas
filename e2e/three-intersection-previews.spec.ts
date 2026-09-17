import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 交线 / 交面作为独立图元：UI 逻辑**参考平面画布**——所有相交的实体对都自动标出来，
 * 不需要先选中两个对象，点哪一份就创建哪一个图元。
 *
 * 用户原话："交面交线作为单独的图元，ui操作逻辑参考平面"。
 * 这条用例量的是可见行为：不选任何东西就有预览、悬停能说清是哪一份、点一下真的建出图元。
 */
test.use({ viewport: { width: 1280, height: 900 } })

/**
 * 先把相机固定下来再投影：自动取景会在内容同步之后调整相机，
 * 而"把世界点换成屏幕像素"必须用**同一时刻**的相机读数，否则细目标（交线）会差出十几像素。
 */
async function loadFixture(page: import("@playwright/test").Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/overlapping-cubes.mgeo")
  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-preview-solid-count", "1")
  // 重置视角同时让自动取景不再抢镜头：之后的世界点投影是稳定的。
  await page.getByRole("button", { name: "重置3D视角" }).click()
  return scene
}

test("marks every overlapping pair without selecting anything", async ({ page }) => {
  const scene = await loadFixture(page)

  await expect(scene).toHaveAttribute("data-preview-count", "2")

  // 交面与交线是**两份独立预览**：各自可点，各自创建。
  const keys = (await scene.getAttribute("data-preview-keys")) ?? ""
  expect(keys).toContain("pair:cube-a|cube-b:面")
  expect(keys).toContain("pair:cube-a|cube-b:线")
  // 离得远的那一对根本不进预览（包围盒先筛掉）。
  expect(keys).not.toContain("cube-far")

  // 画布上有东西就必须说出来："已自动标出 N 处交线、M 处交面…"。
  await expect(page.locator(".status-bar-prompt")).toContainText("已自动标出 1 处交线、1 处交面")
})

test("names the patch under the pointer and creates a 交面 primitive on click", async ({ page }) => {
  const scene = await loadFixture(page)

  // 交叠区域是 x∈[0,2]、y∈[-2,2]、z∈[-2,2]；取它的中心，射线一定穿过交面那块面片。
  const point = await projectWorldPoint(page, { x: 1, y: 0, z: 0 })
  await page.mouse.move(point.x, point.y)
  await expect(scene).toHaveAttribute("data-preview-hover-key", "pair:cube-a|cube-b:面")
  await expect(page.locator(".status-bar-prompt")).toContainText("布尔交集")

  await page.mouse.click(point.x, point.y)
  // 创建出来的是**独立图元**：进对象列表、被选中、检查器给出布尔交集的读数。
  await expect(page.getByText("交面 1").first()).toBeVisible()
  await expect(page.locator(".panel.right")).toContainText("体积")
  await expect(page.locator(".panel.right")).toContainText("32.000")
  await expect(page.locator(".panel.right")).toContainText("来源 A")

  // 建完之后预览还在（来源仍然相交）：用户还可以继续创建另一份，或看交线。
  await expect(scene).toHaveAttribute("data-preview-count", "2")
})

test("creates a 交线 primitive from the crossing line's own preview", async ({ page }) => {
  const scene = await loadFixture(page)

  // (2,-2,0) 在交线那段上（立方体 A 的 x=2 面 ∩ 立方体 B 的 y=-2 面），且远离任何顶点手柄。
  const point = await projectWorldPoint(page, { x: 2, y: -2, z: 0 })
  await page.mouse.move(point.x, point.y)
  await expect(scene).toHaveAttribute("data-preview-hover-key", "pair:cube-a|cube-b:线")

  await page.mouse.click(point.x, point.y)
  await expect(page.getByText("截线 1").first()).toBeVisible()
  await expect(page.locator(".panel.right")).toContainText("段数")
  await expect(page.locator(".panel.right")).toContainText("总长度")
})

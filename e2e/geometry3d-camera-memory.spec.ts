import { expect, test, type Page } from "@playwright/test"

/**
 * 相机跨工作区保留。
 *
 * 3D 场景组件跟着工作区挂载/卸载：切到平面几何再切回来会新建一份组件状态。
 * 相机原本存在组件的 `useRef` 里，回来时不但回到默认视角，还会因为"换文档就取景"
 * 的既有逻辑再被重新构图一次——用户转过的角度、缩放和视点中心全丢。
 */
test("returns to the 3D workspace with the camera the user left", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const scene = page.locator("[data-3d-scene]")
  const canvas = scene.locator("canvas")
  const box = (await canvas.boundingBox())!
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // 转动视角 + 滚轮缩放，得到一个明显不同于默认视角的相机（默认方位角 45°、距离 16）
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x - 140, centre.y - 60, { steps: 8 })
  await page.mouse.up()
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.wheel(0, -240)

  const turned = await readCamera(page)
  expect(turned.azimuth).not.toBeCloseTo(45, 0)
  expect(turned.distance).not.toBeCloseTo(16, 0)

  // 切到平面几何，再切回来
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  await expect(page.locator("[data-3d-scene]")).toHaveCount(0)
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const restored = page.locator("[data-3d-scene]")
  await expect(restored).toBeVisible()
  await expect.poll(async () => restored.getAttribute("data-camera-distance"), { timeout: 4000 }).not.toBeNull()
  // 即使真的误取景，250ms 的过渡也该走完了——所以这里比的是稳定值，不是"动画中途的数字"
  await page.waitForTimeout(400)

  const after = await readCamera(page)
  expect(after.azimuth).toBeCloseTo(turned.azimuth, 2)
  expect(after.elevation).toBeCloseTo(turned.elevation, 2)
  expect(after.distance).toBeCloseTo(turned.distance, 2)
  expect(after.target.x).toBeCloseTo(turned.target.x, 2)
  expect(after.target.y).toBeCloseTo(turned.target.y, 2)
  expect(after.target.z).toBeCloseTo(turned.target.z, 2)
})

interface Camera {
  azimuth: number
  elevation: number
  distance: number
  target: { x: number; y: number; z: number }
}

async function readCamera(page: Page): Promise<Camera> {
  const scene = page.locator("[data-3d-scene]")
  const [x, y, z] = ((await scene.getAttribute("data-camera-target")) ?? "").split(",").map(Number)
  return {
    azimuth: Number(await scene.getAttribute("data-camera-azimuth")),
    elevation: Number(await scene.getAttribute("data-camera-elevation")),
    distance: Number(await scene.getAttribute("data-camera-distance")),
    target: { x, y, z }
  }
}

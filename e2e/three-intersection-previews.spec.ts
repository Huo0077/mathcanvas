import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 交点 / 交线 / 交面作为**三个各自独立**的图元：UI 逻辑参考平面画布——所有相交的实体对都自动标出来，
 * 不需要先选中两个对象，点哪一份就创建哪一个图元。
 *
 * 用户口径（原话）：
 * "我需要交面交线作为单独的图元，ui操作逻辑参考平面"、
 * "我需要的交面只是一个表面，而不是所有相交的表面"、
 * "我需要一个交面内部填充颜色可以更改的功能，当然我们不止需要交面，还需要交线交点"。
 */
test.use({ viewport: { width: 1280, height: 900 } })

/**
 * 先把相机固定下来再投影：自动取景会在内容同步之后调整相机，
 * 而"把世界点换成屏幕像素"必须用**同一时刻**的相机读数，否则细目标（交点、交线）会差出十几像素。
 */
async function loadFixture(page: import("@playwright/test").Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/overlapping-cubes.mgeo")
  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-preview-face-count", "6")
  /**
   * **关掉自动取景**再重置视角：这一条是防抖的真根因。
   *
   * 取景是动画，而且会在**文档变化之后**再次触发（这个用例中途还要创建交点/交线）。
   * 于是"投影一次 → 移动指针 → 断言"这段时间里相机可能又飘走，指针就落到旁边的面片上了。
   * 实测（`--repeat-each=3`）：`data-preview-hover-key` 期望 `…:线`、实际 `…:面5`，而失败那次读数里
   * 带着 `data-camera-fit="2"`（取景跑过第二轮）——不是纯偶发，是取景与断言抢时间。
   *
   * 用 DOM 派发点击而不是 `locator.click()`：**「显示控制」那一排的最后一个按钮会被「视角控制」那一排
   * 盖住**（窄一点的画布上两排在中线相撞，实测 `自由拖动` 拦截了 `自动取景` 的指针事件，
   * 见 `geometry3d-drag.spec.ts` 里的同款注释）。这是既有布局问题，不属于本轮改动，这里绕开它。
   */
  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement | null)?.click())
  const autoFit = page.getByRole("button", { name: "自动取景" })
  await expect(autoFit).toHaveAttribute("aria-pressed", "false")
  // 重置视角：之后的世界点投影是稳定的（相机不会再被取景抢走）。
  await page.getByRole("button", { name: "重置3D视角" }).click()
  await settleCamera(scene)
  return scene
}

/**
 * 等相机**停稳**再投影。
 *
 * 取景是**动画**（几百毫秒），读数在这段时间里一帧一变；投影用的是"这一刻"的相机，
 * 于是指针落点会随动画漂走——细目标（一条交线）就会漂到旁边的面片上。
 * 实测过一次真实抖动：`data-preview-hover-key` 期望 `…:线`、实际是 `…:面5`，
 * 而当时的读数里 `data-camera-fit="2"` 说明取景还在跑（那次是全量跑里唯一一条失败，重跑三次都没复现）。
 * 判据取"连续两次采样完全一致"，不依赖具体动画时长。
 */
async function settleCamera(scene: import("@playwright/test").Locator) {
  let previous = ""
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = `${await scene.getAttribute("data-camera-azimuth")}|${await scene.getAttribute("data-camera-elevation")}|${await scene.getAttribute("data-camera-distance")}|${await scene.getAttribute("data-camera-target")}`
    if (current === previous) return
    previous = current
    await scene.page().waitForTimeout(120)
  }
}

test("marks every overlapping pair without selecting anything", async ({ page }) => {
  const scene = await loadFixture(page)

  // 交叠区间 2×4×4：6 个面、8 个交线拐点、1 条交线（两处矩形轮廓）。
  await expect(scene).toHaveAttribute("data-preview-line-count", "1")
  await expect(scene).toHaveAttribute("data-preview-point-count", "8")
  await expect(scene).toHaveAttribute("data-preview-count", "15")

  const keys = (await scene.getAttribute("data-preview-keys")) ?? ""
  expect(keys).toContain("pair:cube-a|cube-b:线")
  expect(keys).toContain("pair:cube-a|cube-b:面0")
  expect(keys).toContain("pair:cube-a|cube-b:点0")
  // 离得远的那一对根本不进预览（包围盒先筛掉）。
  expect(keys).not.toContain("cube-far")

  // 画布上有东西就必须说出来。
  await expect(page.locator(".status-bar-prompt")).toContainText("已自动标出 1 处交线、8 处交点、6 个交面")
})

test("creates one 交面 from the face patch under the pointer, and its fill colour can be changed", async ({ page }) => {
  const scene = await loadFixture(page)

  // (1,2,0) 是交叠区域 y=+2 那一面的中心（面积 2×4 = 8），离任何交线与拐点都远。
  const point = await projectWorldPoint(page, { x: 1, y: 2, z: 0 })
  await page.mouse.move(point.x, point.y)
  await expect(scene).toHaveAttribute("data-preview-hover-key", /pair:cube-a\|cube-b:面\d/)
  await expect(page.locator(".status-bar-prompt")).toContainText("公共区域的一个面")

  await page.mouse.click(point.x, point.y)
  // 创建出来的是**一个表面**：进对象列表、被选中，读数给这一面的面积。
  await expect(page.getByText("交面 1").first()).toBeVisible()
  const inspector = page.locator(".panel.right")
  await expect(inspector).toContainText("面积")
  await expect(inspector).toContainText("8.000")
  await expect(inspector).toContainText("来源 A")

  // 用户要求："交面内部填充颜色可以更改"。填色控件在「外观样式」折叠区里。
  await page.getByRole("button", { name: /外观样式/ }).click()
  const fill = page.getByLabel("填充颜色")
  await fill.fill("#22cc88")
  await expect(fill).toHaveValue("#22cc88")

  // 建完之后预览还在（来源仍然相交）：用户还可以继续建其它面、或是交线 / 交点。
  await expect(scene).toHaveAttribute("data-preview-face-count", "6")
})

test("creates a 交点 from the corner marker, and a 交线 from the crossing line", async ({ page }) => {
  const scene = await loadFixture(page)

  // (2,2,2) 是交线在**近侧**的一个拐点（远的那个会被它前面的面片挡住，投影点也就落不到标记上）。
  const corner = await projectWorldPoint(page, { x: 2, y: 2, z: 2 })
  await page.mouse.move(corner.x, corner.y)
  await expect(scene).toHaveAttribute("data-preview-hover-key", /pair:cube-a\|cube-b:点\d/)
  // 文案说"拐点"：光滑交线现在一个标记都不给，能点到的圆点必定是交线的拐点。
  await expect(page.locator(".status-bar-prompt")).toContainText("拐点")

  await page.mouse.click(corner.x, corner.y)
  await expect(page.getByText("交点 1").first()).toBeVisible()
  await expect(page.locator(".panel.right")).toContainText("交点 = 交线的端点")

  // 交线仍然是**另一份**独立预览：(2,2,0) 在那条轮廓线段的中间，不压着任何拐点。
  const line = await projectWorldPoint(page, { x: 2, y: 2, z: 0 })
  await page.mouse.move(line.x, line.y)
  await expect(scene).toHaveAttribute("data-preview-hover-key", "pair:cube-a|cube-b:线")
  await page.mouse.click(line.x, line.y)
  await expect(page.getByText("交线 1").first()).toBeVisible()
  await expect(page.locator(".panel.right")).toContainText("段数")
  await expect(page.locator(".panel.right")).toContainText("总长度")
})

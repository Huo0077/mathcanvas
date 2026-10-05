import { expect, test, type Page } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * **N3 计划 RED 的后半段：约束拖动的浏览器正/反例**（2026-10-05）。
 *
 * 计划点名的那条 RED 是"拖动保持中点/垂直/固定距离；过约束拒绝；欠约束显示自由度；拖动一步撤销"。
 * 单元层那一半早就有了（`constrainedDrag3.test.ts` / `constrainedDragUndo.test.ts` 等），
 * **缺的一直是浏览器正/反例** —— 因为开关**没有任何产品入口**。入口补上之后（`ExperimentalFeatures`），
 * 这份用例才写得出来。
 *
 * ## 判据选 `fixedDistance`，而且用**应用自己的草稿**做观测点
 *
 * - `fixedDistance` 是 `ConstraintType` 里最干净的一条：两个点 + 一个长度，不需要平面/线。
 * - 读的是 `mathcanvas:draft:geometry3d`（`saveDraft` 写进去的 `.mgeo` 文本）——
 *   **那是应用真实的持久化产物**，不是我注入的测试数据。
 *
 * ## 两个用例一正一反，缺一不可
 *
 * - **关着（默认）**：拖动真的会改变 |AB| —— 少了这条，"开着时 |AB| 不变"可能只是**拖根本没生效**；
 * - **打开**：同样的拖动之后 |AB| **仍然是 1**（沿约束走）。
 *
 * 这条"反例"是本仓的老教训：**要证明的不是"没变"，而是"本该变的时候变了、该被约束住的时候被约束住了"。**
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
})

/** 草稿里的 |AB|（读应用自己写的那份 `.mgeo` 草稿）。 */
async function storedDistanceAb(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) return null
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] }; primitives?: unknown[] }
    const document = parsed.document ?? parsed
    const points = (document.primitives ?? []) as { id: string; position?: { x: number; y: number; z: number } }[]
    const a = points.find((point) => point.id === "point3-A")?.position
    const b = points.find((point) => point.id === "point3-B")?.position
    if (!a || !b) return null
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  })
}

/**
 * 载入三棱锥 → 只留四个点（这样拖的是**独立点**，不是多面体的顶点）
 * → 加一条 `|AB| = 1`（夹具里 A=(0,0,0)、B=(0,0,1)，本来就正好 1）。
 */
async function seedPair(page: Page, options: { constrainedDrag: boolean }): Promise<void> {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/tetrahedron.mgeo")
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  await expect.poll(async () => page.evaluate(() => localStorage.getItem("mathcanvas:draft:geometry3d"))).not.toBeNull()

  await page.evaluate((constrained) => {
    const key = "mathcanvas:draft:geometry3d"
    const parsed = JSON.parse(localStorage.getItem(key) as string) as Record<string, unknown>
    const document = (parsed.document ?? parsed) as { primitives: { type: string }[]; constraints: unknown[] }
    document.primitives = document.primitives.filter((primitive) => primitive.type === "point3")
    document.constraints = [{ id: "fixed-ab", type: "fixedDistance", targets: ["point3-A", "point3-B"], value: 1 }]
    localStorage.setItem(key, JSON.stringify(parsed))
    // 开关走**应用自己的偏好键**（入口本身的用户路径由 `next-phase-flag-entry.spec.ts` 覆盖）。
    localStorage.setItem("mathcanvas:next-phase-preferences", JSON.stringify({ constrainedDrag: constrained }))
  }, options.constrainedDrag)

  await page.reload()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
}

/** 在「自由拖动」模式下按住 A 并拖动。 */
async function dragPointA(page: Page, dx: number, dy: number): Promise<void> {
  await page.getByRole("button", { name: "自由拖动" }).click()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-drag-mode", "true")

  const start = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(start.x + (dx * step) / 6, start.y + (dy * step) / 6)
  await page.mouse.up()
}

test("关着开关（默认）：拖动 A 会改变 |AB| —— 这是原来那条路径", async ({ page }) => {
  await seedPair(page, { constrainedDrag: false })
  expect(await storedDistanceAb(page)).toBeCloseTo(1, 6)

  await dragPointA(page, 90, 60)

  // 自由拖动：A 跟着指针走，|AB| 必然变了。
  await expect.poll(async () => storedDistanceAb(page)).not.toBeCloseTo(1, 6)
})

test("打开开关：同样的拖动之后 |AB| 仍然是 1 —— 它沿约束走", async ({ page }) => {
  await seedPair(page, { constrainedDrag: true })
  expect(await storedDistanceAb(page)).toBeCloseTo(1, 6)

  await dragPointA(page, 90, 60)

  // **先证明这次拖动真的发生了**（A 的位置变了），再看 |AB| 被约束住 ——
  // 否则"距离没变"可能只是拖根本没生效（本仓的老教训：不许用"没变"冒充"被约束住"）。
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
    const document = (JSON.parse(raw as string) as { document?: { primitives?: unknown[] } }).document
    const points = (document?.primitives ?? []) as { id: string; position?: { x: number; y: number; z: number } }[]
    return points.find((point) => point.id === "point3-A")?.position?.x ?? null
  })).not.toBe(0)

  expect(await storedDistanceAb(page)).toBeCloseTo(1, 6)
})

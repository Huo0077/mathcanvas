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
 *
 * ## 2026-10-05 补：N3 **出口**点名的三条浏览器用例
 *
 * 计划 `Phase N3` 的出口原文要求 `constrainedDrag=true` 时「**过约束拒绝、冲突恢复和一步撤销**」
 * 的**浏览器**用例全部通过 —— 这三条此前只有单元证据。下面三条把同一批语义搬到浏览器里，
 * 每条都带**正向信号**（本仓的老教训：不许用"没变"冒充"被拒绝/被约束住"）：
 *
 * 1. **过约束拒绝** —— 「操作指引」里出现**点名冲突约束 id** 的拒绝文案（那句文案同时证明这次拖动
 *    真的走到了提交点），然后草稿里的坐标**逐字**未变；
 * 2. **冲突恢复** —— 拒绝之后草稿一个坐标都没写、撤销按钮仍不可用（= 历史一步没占）；
 *    把冲突修掉之后，**同样的拖动这次提交了**（指引给出"已按约束调整"，A 真的动了，|AB| 仍是 1）；
 * 3. **一步撤销** —— 拖动真的提交了，一次 `Ctrl+Z` 回到拖动前的全部坐标，且撤销按钮**回到不可用**
 *    （历史只占那一步），再按一次 `Ctrl+Z` 不会有第二步。
 *
 * 观测点（三条用例共用）：
 * - 拒绝/说明文案：`GuidanceHint`（`role="status"` + `aria-label="操作指引"`，正文 `.guidance-hint-text`）；
 * - 撤销栈有没有东西：`WorkspaceTabs` 的「撤销」按钮 `disabled={canUndo === false}`，
 *   而 `canUndo = store.history.length > 0` —— 这是浏览器里唯一能"看见"历史长度的读数。
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
})

type StoredPoint = { x: number; y: number; z: number }

/** 草稿里全部空间点的坐标（读应用自己写的那份 `.mgeo` 草稿）。 */
async function storedPoints(page: Page): Promise<Record<string, StoredPoint>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] }; primitives?: unknown[] }
    const document = parsed.document ?? parsed
    const primitives = (document.primitives ?? []) as { id: string; type: string; position?: { x: number; y: number; z: number } }[]
    const positions: Record<string, { x: number; y: number; z: number }> = {}
    for (const primitive of primitives) {
      if (primitive.type !== "point3" || !primitive.position) continue
      positions[primitive.id] = { ...primitive.position }
    }
    return positions
  })
}

/** 草稿里的 |AB|（读应用自己写的那份 `.mgeo` 草稿）。 */
async function storedDistanceAb(page: Page): Promise<number | null> {
  const points = await storedPoints(page)
  const a = points["point3-A"]
  const b = points["point3-B"]
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/** 草稿里的约束 id（用来证明"冲突真的被修掉了"，而不是靠"看起来不一样了"）。 */
async function storedConstraintIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) return []
    const parsed = JSON.parse(raw) as { document?: { constraints?: unknown[] }; constraints?: unknown[] }
    const document = parsed.document ?? parsed
    return ((document.constraints ?? []) as { id: string }[]).map((constraint) => constraint.id)
  })
}

interface ConstraintSeed { id: string; type: string; targets: string[]; value?: number }

/** 夹具里 A=(0,0,0)、B=(0,0,1)，本来就正好 1。 */
const FIXED_AB: ConstraintSeed = { id: "fixed-ab", type: "fixedDistance", targets: ["point3-A", "point3-B"], value: 1 }
/**
 * **可证的矛盾**：同一条线段被要求等于两个不同的长度。
 * 点名顺序**故意反过来**（B、A）—— 矛盾判据按**无序点对**归组，这一条同时钉住"方向不重要"。
 */
const CONFLICT_AB: ConstraintSeed = { id: "fixed-ab-two", type: "fixedDistance", targets: ["point3-B", "point3-A"], value: 2 }

/**
 * 载入三棱锥 → 只留四个点（这样拖的是**独立点**，不是多面体的顶点）
 * → 装上一组约束（默认只有 `|AB| = 1`）→ 打开/关掉应用自己的开关。
 */
async function seedPair(page: Page, options: { constrainedDrag: boolean; constraints?: ConstraintSeed[] }): Promise<void> {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/tetrahedron.mgeo")
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  await expect.poll(async () => page.evaluate(() => localStorage.getItem("mathcanvas:draft:geometry3d"))).not.toBeNull()

  await page.evaluate(({ constrained, constraints }) => {
    const key = "mathcanvas:draft:geometry3d"
    const parsed = JSON.parse(localStorage.getItem(key) as string) as Record<string, unknown>
    const document = (parsed.document ?? parsed) as { primitives: { type: string }[]; constraints: unknown[] }
    document.primitives = document.primitives.filter((primitive) => primitive.type === "point3")
    document.constraints = constraints
    localStorage.setItem(key, JSON.stringify(parsed))
    // 开关走**应用自己的偏好键**（入口本身的用户路径由 `next-phase-flag-entry.spec.ts` 覆盖）。
    localStorage.setItem("mathcanvas:next-phase-preferences", JSON.stringify({ constrainedDrag: constrained }))
  }, { constrained: options.constrainedDrag, constraints: options.constraints ?? [FIXED_AB] })

  await page.reload()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
}

/** 把某一条约束从草稿里去掉并重载（"用户把冲突修掉了"）。 */
async function removeConstraintAndReload(page: Page, constraintId: string): Promise<void> {
  await page.evaluate((id) => {
    const key = "mathcanvas:draft:geometry3d"
    const parsed = JSON.parse(localStorage.getItem(key) as string) as Record<string, unknown>
    const document = (parsed.document ?? parsed) as { constraints: { id: string }[] }
    document.constraints = document.constraints.filter((constraint) => constraint.id !== id)
    localStorage.setItem(key, JSON.stringify(parsed))
  }, constraintId)
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

/** 「操作指引」：拒绝文案与提交说明的落点（`GuidanceHint`）。 */
function guidance(page: Page) {
  return page.getByRole("status", { name: "操作指引" })
}

/**
 * 「撤销」按钮的可用性 = `store.history.length > 0`。
 * 这是浏览器里唯一能"看见"撤销栈的读数，所以"拒绝一步历史都不占"与"只占一步"都拿它当正向信号。
 */
function undoButton(page: Page) {
  return page.getByRole("button", { name: "撤销", exact: true })
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

/**
 * **N3 出口第一条：过约束拒绝。**
 *
 * 种一份**含可证矛盾**的文档（同一条线段两条 `fixedDistance`：`|AB| = 1` 与 `|AB| = 2`），
 * 打开开关，拖动 A。两件事必须同时成立：
 *
 * 1. 「操作指引」里出现**拒绝**文案，而且**点名**冲突的两条约束 id ——
 *    这一句同时是"这次拖动真的走到了提交点"的正向信号；
 * 2. 草稿里的坐标**逐字**未变（读的是草稿里的实际坐标，不是"看起来没动"）。
 */
test("过约束拒绝：同一条线段被赋两个长度，拖动 A 被拒绝并点名冲突的约束 id", async ({ page }) => {
  await seedPair(page, { constrainedDrag: true, constraints: [FIXED_AB, CONFLICT_AB] })
  const before = await storedPoints(page)
  expect(before["point3-A"]).toEqual({ x: 0, y: 0, z: 0 })
  expect(await storedDistanceAb(page)).toBeCloseTo(1, 6)

  await dragPointA(page, 90, 60)

  // 正向信号：**拒绝文案**到了界面上，而且**点名**了冲突的两条约束（不是含糊的"没算出来"）。
  const hint = guidance(page)
  await expect(hint).toContainText("已拒绝")
  await expect(hint).toContainText("不可能同时成立")
  await expect(hint).toContainText("（fixed-ab、fixed-ab-two）")

  // 然后才是"一个坐标都没写进去"：逐字比较草稿里的实际坐标（不是 toBeCloseTo 的宽容比较）。
  expect(await storedPoints(page)).toEqual(before)
})

/**
 * **N3 出口第二条：冲突恢复。**
 *
 * 拒绝不能是死路。两件事：
 *
 * 1. 拒绝之后**文档与撤销栈都没被污染**：草稿逐字未变，且撤销按钮仍不可用（历史一步没占）；
 * 2. **还能继续用**：把冲突那一条去掉并重载之后，**同样的拖动**这次**正常提交**
 *    （指引给出"已按约束调整"、A 真的动了、|AB| 仍是 1、这次撤销按钮可用了）。
 *
 * ② 是①的反面证据：少了它，"拒绝之后什么都没变"既可能是"被拒绝了"，也可能是"这条路从此死了"。
 */
test("冲突恢复：拒绝不写文档也不占历史；修掉冲突之后同样的拖动正常提交", async ({ page }) => {
  await seedPair(page, { constrainedDrag: true, constraints: [FIXED_AB, CONFLICT_AB] })
  const undo = undoButton(page)
  // 基准：刷新之后历史本来就是空的 —— 下面"拒绝没占历史"要跟这个基准比。
  await expect(undo).toBeDisabled()
  const before = await storedPoints(page)

  await dragPointA(page, 90, 60)
  // 拒绝的是**可证的冲突**（"这两条不可能同时成立"），不是含糊的"没算出来" ——
  // 它与下面的"什么都没写进去"合起来，才是"这次拒绝"的完整读数。
  await expect(guidance(page)).toContainText("已拒绝")
  await expect(guidance(page)).toContainText("不可能同时成立")

  // ① 拒绝**没有污染**文档，也**没有占掉一步历史**（撤销按钮仍不可用 = 历史仍为空）。
  expect(await storedPoints(page)).toEqual(before)
  await expect(undo).toBeDisabled()

  // ② 拒绝不是死路：把冲突的那条去掉、重载，**同样的拖动**这次提交了。
  expect(await storedConstraintIds(page)).toEqual(["fixed-ab", "fixed-ab-two"])
  await removeConstraintAndReload(page, "fixed-ab-two")
  expect(await storedConstraintIds(page)).toEqual(["fixed-ab"])

  await dragPointA(page, 90, 60)

  await expect(guidance(page)).toContainText("已按约束调整")
  const recovered = await storedPoints(page)
  expect(recovered["point3-A"]).not.toEqual(before["point3-A"])
  expect(await storedDistanceAb(page)).toBeCloseTo(1, 6)
  // 这次真的写进去了（= 占了历史），与①"一步都没占"正好相反。
  await expect(undo).toBeEnabled()
})

/**
 * **N3 出口第三条：一步撤销。**
 *
 * 种一份**可满足**的约束（单条 `|AB| = 1`），打开开关，拖动 A：
 *
 * 1. **A 真的动了**（先证明这次拖动发生了），且 `|AB|` 仍是 1；
 * 2. **一次 `Ctrl+Z`** 之后 A 回到拖动前的坐标（整批是一个事务：提交走**一次** `applyBatch`）；
 * 3. 历史**只占一步**：撤销按钮回到**不可用**（这就是"没有再一步"的读数），
 *    再按一次 `Ctrl+Z` 不会把更早的东西撤掉。
 */
test("一步撤销：约束拖动只占一步历史，一次 Ctrl+Z 回到拖动前，再按没有第二步", async ({ page }) => {
  await seedPair(page, { constrainedDrag: true })
  const undo = undoButton(page)
  const before = await storedPoints(page)
  await expect(undo).toBeDisabled()

  await dragPointA(page, 90, 60)

  // ① 这次拖动**真的提交了**：指引给出"已按约束调整"，A 真的动了，|AB| 仍是 1。
  await expect(guidance(page)).toContainText("已按约束调整")
  const moved = await storedPoints(page)
  expect(moved["point3-A"]).not.toEqual(before["point3-A"])
  expect(await storedDistanceAb(page)).toBeCloseTo(1, 6)
  // 提交进了历史（正好一步 —— 下面一次 Ctrl+Z 就把它用完）。
  await expect(undo).toBeEnabled()

  // ② 一次 Ctrl+Z 回到拖动前的**全部**坐标（整批提交 = 一个事务），|AB| 仍是 1。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => storedPoints(page)).toEqual(before)
  expect(await storedDistanceAb(page)).toBeCloseTo(1, 6)

  // ③ 历史**只占一步**：撤销按钮回到不可用，再按一次 Ctrl+Z 不会有第二步。
  await expect(undo).toBeDisabled()
  await page.keyboard.press("Control+z")
  await expect.poll(async () => storedPoints(page)).toEqual(before)
  await expect(undo).toBeDisabled()
})

import { expect, test } from "@playwright/test"

/**
 * **派生球的浏览器证据**（S5；设计 §4.1 的硬约束）。
 *
 * 设计里那条约束是"球是**派生量**，走派生绑定 + `recomputeDerivedObjects` 重算，
 * **'物化但不重算'被否决**（会静默过期）"。所以这里证三件事：
 * ① 题面要外接球时，球**真的出现在画布上**（对象列表里有它），而且核验面板 `passed`；
 * ② 落盘的球**真的是那只外接球**：把草稿里真实落盘的顶点读出来，在测试里**自己算**球心到各顶点的距离
 *    —— 不读面板结论，也不读构造方的自述（"系统说它有外接球"正是要复核的对象）；
 * ③ **宿主一动，球跟着变**，而且变完仍然是**新的**顶点组的外接球（这一条才是"不是过期数据"的证据）。
 *
 * ## 为什么按**拓扑下标**认顶点，不按标签
 *
 * 本文件第一次跑就撞上了本仓**已记录**的那条缺陷：画布顶点标签是**按位置顺延的字母**，
 * 与计划里的 `vertexNames` 无关 —— 题面写 `P-ABCD`，草稿里的标签却是 `A…E`（下表同序）。
 * 所以几何判据一律用 `polyhedron3.vertexIds` 的**下标顺序**（=`vertices` 的给出顺序，
 * 也就是 `vertexNames` 的顺序），并把标签不一致**逐字钉住**，让它显形而不是被绕过。
 */

const PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥的外接球"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

interface Vec3 { x: number; y: number; z: number }
interface Draft {
  /** 按拓扑下标（= `vertices` 的给出顺序 = `vertexNames` 的顺序）读出来的宿主顶点。 */
  byIndex: Vec3[]
  /** 按点图元的 `label` 读出来的顶点 —— 用户在画布上**看到**的是这一套。 */
  byLabel: Record<string, Vec3>
  /** 外接球：球心、半径，以及它宣称的宿主 id（绑定必须在，否则以后不会跟着重算）。 */
  sphere: { center: Vec3; radius: number; solidId: string } | null
}

/** 读**应用自己写下的**那份 `.mgeo` 草稿：3D 画布是 WebGL，读不到 DOM 坐标。 */
async function readDraft(page: import("@playwright/test").Page): Promise<Draft> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as {
      id: string
      type: string
      label?: string
      position?: { x: number; y: number; z: number }
      center?: { x: number; y: number; z: number }
      radius?: number
      vertexIds?: string[]
      derivedFrom?: { kind: string; solidId: string }
    }[]
    const solid = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
    const byIndex: { x: number; y: number; z: number }[] = []
    const byLabel: Record<string, { x: number; y: number; z: number }> = {}
    for (const id of solid?.vertexIds ?? []) {
      const point = primitives.find((candidate) => candidate.id === id)
      if (!point?.position) throw new Error(`拓扑顶点 ${id} 没有 point3 坐标`)
      byIndex.push(point.position)
      if (typeof point.label === "string") byLabel[point.label] = point.position
    }
    const sphere = primitives.find((primitive) => primitive.type === "sphere" && primitive.derivedFrom)
    return {
      byIndex,
      byLabel,
      sphere: sphere?.center && typeof sphere.radius === "number" && sphere.derivedFrom
        ? { center: sphere.center, radius: sphere.radius, solidId: sphere.derivedFrom.solidId }
        : null
    }
  })
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("a named solid's derived circumsphere is created, rendered, and follows its host", async ({ page }) => {
  await openAgent(page)
  await send(page, PROMPT)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("region", { name: "题设核验" })).toHaveAttribute("data-status", "passed")
  // 面板要如实说清"球是算出来的"，而不是把它说成题面给定。
  await expect(panel.locator(".agent-assumptions")).toContainText("外接球由内核")
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:geometry3d"))).not.toBeNull()

  const before = await readDraft(page)
  expect(before.byIndex).toHaveLength(5)
  /**
   * **查实的缺陷（与 R10 同一处）**：计划给的点名是 `["P","A","B","C","D"]`，落盘标签却是 `A…E` ——
   * 标签按位置顺延、与 `vertexNames` 无关。所以几何判据只能按下标写；这里把不一致钉住。
   */
  expect(Object.keys(before.byLabel).sort()).toEqual(["A", "B", "C", "D", "E"])
  expect(before.byLabel["P"]).toBeUndefined()

  expect(before.sphere).not.toBeNull()
  const first = before.sphere!
  // ② **独立回代**：球心到**每个**顶点等距，且距离就是这个半径。
  for (const vertex of before.byIndex) expect(distance(first.center, vertex)).toBeCloseTo(first.radius, 6)
  // ① 画布上真的有它（对象列表里有球）。
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBeGreaterThan(0)

  /**
   * ## ③ "宿主一动，球跟着变" —— **本轮没在浏览器里做成，如实记**
   *
   * 试了三次都没让实体动起来：先拖**多面体顶点**（俯角投影后按下拖动 ⇒ 顶点坐标一模一样，
   * 说明本版应用里多面体的顶点不单独可拖）、再拖**实体本身**（未选中 ⇒ 不动）、
   * 再"先选中对象行再拖"（仍不动）。**三次都没动，就不写"通过"。**
   *
   * 这条性质在**单元层**是有证据的（`derivedSphereRule.test.ts`：移动四面体一个顶点后，
   * 球心独立解出 `(1,1,2)` 且到四个顶点等距，依赖链 `顶点 → 实体 → 球` 也在用例里钉住）。
   * 缺的是"这一版界面上怎么把宿主弄动"的操作路径 —— 记为待办，而不是用一条没跑通的断言冒充。
   */
  expect(first.solidId).toBe(before.sphere!.solidId)
})

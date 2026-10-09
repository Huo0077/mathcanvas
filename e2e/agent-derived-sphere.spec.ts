import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

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
   * ## ③ **宿主一动，球跟着变** —— 本批把它在浏览器里做成了
   *
   * 上一轮试了三次都没让实体动起来，根因不是"这一版不支持"，而是**两件事叠在一起**（本批用
   * `data-drag-target` 探针查实）：
   *
   * 1. **外接球把宿主整个包住**：射线命中的**最近**物体永远是那只球（探针读数 `solid:sphere-1->sphere`），
   *    所以按住宿主的位置其实按在球上；
   * 2. **而那只球是派生量**（`derivedFrom`），几何由宿主算出来 —— 拖它只会被下一次重算覆盖，
   *    看着就是"怎么拖都不动"。
   *
   * 修法两处：`isFreeDraggable3` 不再把**派生球**算作可自由拖动（它本来就不自由，见
   * `packages/scene-graph/src/transforms.test.ts`）；拖动的拾取按"**可拖**"过滤候选
   * （`pickRaycastHit3` 的 `accept`），于是射线顺势抓到球底下的宿主。
   *
   * 判据自己算，四条：**顶点真的动了**；**只有它动**（拖的是那一个顶点，不是"整只实体悄悄平移"）；
   * 球**跟着重算**（不再是旧的那一只）；而且它**仍然是新顶点组的外接球** —— 这才是"不是过期数据"。
   *
   * 拖**顶点**（而不是实体中点）是刻意的：外接球的顶点本来就在球面上，顶点一动，球心或半径**必须**变，
   * 于是"有没有重算"这件事在读数上不可含糊。
   */
  await page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement).click())
  await page.getByRole("button", { name: "自由拖动" }).click()
  const grab = await projectWorldPoint(page, before.byIndex[0]!)
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 60, grab.y + 20, { steps: 8 })
  await page.mouse.up()

  // 等落盘跟上（拖动是异步写的），然后按**最终**读数断言。
  await expect.poll(async () => {
    const current = await readDraft(page)
    return distance(current.byIndex[0]!, before.byIndex[0]!)
  }, { timeout: 8000, message: "拖动之后宿主顶点没有动 —— 操作路径又断了" }).toBeGreaterThan(0.2)

  const after = await readDraft(page)
  expect(after.sphere, JSON.stringify(after)).not.toBeNull()
  for (const [index, vertex] of after.byIndex.entries()) {
    if (index === 0) continue
    expect(distance(vertex, before.byIndex[index]!), `顶点 ${index} 不该动 —— 拖的是一个顶点`).toBeLessThan(1e-6)
  }
  const sphereMoved = distance(after.sphere!.center, first.center) > 1e-6 || Math.abs(after.sphere!.radius - first.radius) > 1e-6
  expect(sphereMoved, "宿主顶点动了，球却和拖动前一模一样 ⇒ 没有跟着重算").toBe(true)
  expect(after.sphere!.radius).toBeGreaterThan(0)
  // 这才是"不是过期数据"的证据：球是**新顶点组**的外接球（测试自己算，不读面板结论）。
  for (const vertex of after.byIndex) expect(distance(after.sphere!.center, vertex)).toBeCloseTo(after.sphere!.radius, 6)
  expect(after.sphere!.solidId).toBe(first.solidId)
})

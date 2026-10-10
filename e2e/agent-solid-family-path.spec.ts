import { expect, test } from "@playwright/test"

/**
 * **S6.4 浏览器正例：点名的形状族走界面路径**（设计 §3.2 的第一层落地之后的实测）。
 *
 * 与 `agent-diagram-free-apex.spec.ts` 同一套纪律，只是换成了**台体与五棱锥**这两族：
 * - 前半段证"流程走得通"（核验面板说 passed、能确认、能返回画布）；
 * - 后半段证"**图本身对不对**"—— 把草稿里**真实落盘**的坐标读出来，在测试里**自己算一遍**，
 *   不读 `diagramVerification` 的结论（拿被判对象的自述去证明它自己，等于没证）。
 *
 * ## 为什么几何判据按**拓扑下标**写，不按标签写
 *
 * 本批实测查实（就在这个文件里跑出来的）：台体草稿里 **8 个顶点的标签是自动生成的 `A…H`**，
 * 而题面与核验器用的是 `A…D, A′…D′` —— 内核产出的 `A′` 进不了落盘标签（`solid.create_polyhedron`
 * 的标签只认单字母），顶面被顺延命名成 `E/F/G/H`。于是**面板说 passed，用户看到的点名却是另一套**。
 *
 * 这是本仓**已记录、待裁决**的"顶点标签错位"缺陷的一个更直接的形态。本用例**不**替它选修法，
 * 只做两件该做的事：① 几何判据改用拓扑下标（`polyhedron3.vertexIds` 的顺序，也就是内核
 * 构造时点名表的顺序），于是判据不被那个缺陷污染；② 把标签不一致**逐字钉住**，
 * 让它显形而不是继续静默。
 */

const FRUSTUM = "在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台"
const PENTAGON = "在五棱锥 P-ABCDE 中，PA ⊥ 平面 ABCDE，画出这个五棱锥"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/**
 * 「撤销」按钮的可用性 = 历史里有没有东西。
 *
 * "画布上没东西"与"画了又被撤掉"看起来一模一样，所以"拒绝不占历史"这条只能拿它当正向信号。
 */
function undoButton(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: "撤销", exact: true })
}

/** 打开实验开关（`enableFreeApex` 在界面上就是这一个）并走到 Agent 工作区。 */
async function openAgentWithExperiment(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
}

async function confirmAndCommit(page: import("@playwright/test").Page): Promise<void> {
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  /**
   * 面板必须说清"系统替你定了什么"。**文案随路线而异**（本批实测）：台体走编排层自选
   * （"搜索器自选"），五棱锥走内核的代表形状（"系统自选"）—— 所以这里只钉两边都有的那个词。
   */
  await expect(panel.locator(".agent-assumptions")).toContainText("自选")
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:geometry3d"))).not.toBeNull()
}

// ---------------------------------------------------------------- 独立回代题设

interface Vec3 { x: number; y: number; z: number }
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const norm = (a: Vec3): number => Math.sqrt(dot(a, a))

interface CommittedSolid {
  /** 按 `polyhedron3.vertexIds` 的**下标顺序**读出来的坐标 —— 也就是内核构造时的点名表顺序。 */
  byIndex: Vec3[]
  /** 按点图元的 `label` 读出来的坐标 —— 用户在画布上**看到**的是这一套。 */
  byLabel: Record<string, Vec3>
}

/**
 * 读**应用自己写下的那份 `.mgeo` 草稿**里的坐标。
 *
 * 不去读界面上的数字：3D 画布是 WebGL，没有可读坐标的 DOM 图元；而"系统自报核验通过"
 * 恰恰是本次要独立复核的对象。
 */
async function committedSolid(page: import("@playwright/test").Page): Promise<CommittedSolid> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as {
      id: string
      type: string
      label?: string
      position?: { x: number; y: number; z: number }
      vertexIds?: string[]
    }[]
    const solid = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
    if (!solid?.vertexIds) throw new Error("草稿里没有 polyhedron3 拓扑")
    const byIndex = solid.vertexIds.map((id) => {
      const point = primitives.find((candidate) => candidate.id === id)
      if (!point?.position) throw new Error(`拓扑顶点 ${id} 没有 point3 坐标`)
      return point.position
    })
    const byLabel: Record<string, { x: number; y: number; z: number }> = {}
    for (const id of solid.vertexIds) {
      const point = primitives.find((candidate) => candidate.id === id)
      if (typeof point?.label === "string" && point.position) byLabel[point.label] = point.position
    }
    return { byIndex, byLabel }
  })
}

/** 两条边的夹角余弦绝对值：0 就是垂直（用真实坐标自己算，不读判据的结论）。 */
function absCos(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const first = sub(b, a)
  const second = sub(d, c)
  return Math.abs(dot(first, second)) / (norm(first) * norm(second))
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

/**
 * **台体：整条链 + 图本身**。
 *
 * 题面原文：`在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台`。
 * 拓扑顺序是内核的点名表顺序：`0–3` 底面环、`4–7` 顶面环（`4+i` 对应 `i`）。
 * 独立回代三条：① 底面环首直角（题设原文）；② 两底平行且顶面在上；
 * ③ **顶棱短于对应底棱、且比例处处相同** —— 后两条是"台体"这个形状本身，题面一个字都没写。
 */
test("a named frustum produces a verified draft whose committed coordinates really are a frustum", async ({ page }) => {
  await openAgentWithExperiment(page)
  await send(page, FRUSTUM)
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("region", { name: "题设核验" })).toContainText("AB⊥AD")
  await confirmAndCommit(page)

  const solid = await committedSolid(page)
  expect(solid.byIndex).toHaveLength(8)
  const base = solid.byIndex.slice(0, 4)
  const top = solid.byIndex.slice(4, 8)

  // ① 题设原文：底面环首直角（`A`、`B`、`D` 就是下标 0、1、3）。
  expect(absCos(base[0]!, base[1]!, base[0]!, base[3]!)).toBeLessThan(1e-6)

  // ② 四个底面点同高、四个顶面点同高、且顶面在底面之上。
  const flatBase = Math.max(...base.map((point) => point.z)) - Math.min(...base.map((point) => point.z))
  const flatTop = Math.max(...top.map((point) => point.z)) - Math.min(...top.map((point) => point.z))
  expect(flatBase).toBeLessThan(1e-6)
  expect(flatTop).toBeLessThan(1e-6)
  expect(Math.min(...top.map((point) => point.z))).toBeGreaterThan(Math.max(...base.map((point) => point.z)) + 1e-6)

  // ③ 台体定义：顶棱 = 底棱 × 同一个比例，且那个比例 < 1。
  const ratios = [0, 1, 2].map(
    (index) => norm(sub(top[index + 1]!, top[index]!)) / norm(sub(base[index + 1]!, base[index]!))
  )
  for (const ratio of ratios) expect(ratio).toBeGreaterThan(0)
  expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-6)
  expect(ratios[0]!).toBeLessThan(1)

  /**
   * **标签与题面点名对上了**（2026-10-10 修；此前这一段钉住的是缺陷本身）。
   *
   * 这条断言原先的作用是"让它显形"：用户看到的是 `E/F/G/H`，而核验面板按 `A′/B′/C′/D′`
   * 核过了题设 —— 两套点名指的是同一批顶点，但有一步没对上。现在标签跟随 `vertexNames`
   *（内核那侧的判据在 `packages/scene-graph/src/actions/actions.test.ts`），
   * 所以这里直接要求**名字与下标一一对上**：顶环那四个点就叫 `A′…D′`。
   */
  expect(Object.keys(solid.byLabel).sort()).toEqual(["A", "A′", "B", "B′", "C", "C′", "D", "D′"])
  for (const [index, name] of ["A", "B", "C", "D", "A′", "B′", "C′", "D′"].entries()) {
    expect(solid.byLabel[name], `${name} 应当就是下标 ${String(index)} 那个顶点`).toEqual(solid.byIndex[index])
  }
})

/**
 * **五棱锥：同一层的另一族**（底面 5 边，是 S2 才打开的上界）。
 *
 * 拓扑顺序：`0–4` 底面环、`5` 是顶点。
 * 独立回代两条：① 底面真有五个互不重合的点（不是被悄悄换成四边形）；② 侧棱 ⊥ 底面（题设原文）。
 */
test("a named pentagonal pyramid commits a five-sided base with a base-perpendicular lateral edge", async ({ page }) => {
  await openAgentWithExperiment(page)
  await send(page, PENTAGON)
  await confirmAndCommit(page)

  const solid = await committedSolid(page)
  expect(solid.byIndex).toHaveLength(6)
  /**
   * **顶点就叫题面点名的 `P`**（2026-10-10 修；此前这一段钉住的是缺陷本身）。
   *
   * 原先草稿里的标签是**按位置顺延的字母**，与题面/计划的 `vertexNames` **无关** ——
   * 底面五个点恰好是 `A…E`（与题面同名，纯属位置巧合），而题面的顶点 **`P` 在画布上被写成 `F`**：
   * 学生看到的第五个底面点与"顶点"无法区分，`P-ABCDE` 这套点名在画布上**不存在**。
   * 现在标签跟随 `vertexNames`，所以下面**用点名**判几何（不再靠位置标签）。
   */
  expect(["A", "B", "C", "D", "E", "P"].map((name) => solid.byLabel[name])).toEqual(solid.byIndex)
  const point = (name: string): Vec3 => {
    const found = solid.byLabel[name]
    if (found === undefined) throw new Error(`草稿里没有点名 ${name}`)
    return found
  }
  /** `A…E` 是底面环、`P` 是**顶点**（拓扑下标 5，见本用例开头）。 */
  const base = ["A", "B", "C", "D", "E"].map(point)
  const apex = point("P")

  // ① 底面真的是五个互不重合的点。
  expect(new Set(base.map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`)).size).toBe(5)
  // 底面共面（五边形不能是空间折线）。
  const flat = Math.max(...base.map((point) => point.z)) - Math.min(...base.map((point) => point.z))
  expect(flat).toBeLessThan(1e-6)

  // ② 题设原文：`PA ⊥ 平面 ABCDE`。注意判据的方向：直线 ⊥ 平面 ⇒ 它的方向向量与平面法向**平行**，
  //    所以消失的是**叉积**，而点积取到满值（写成点积为零就把判据写反了）。
  const ab = sub(base[1]!, base[0]!)
  const ae = sub(base[4]!, base[0]!)
  const pa = sub(base[0]!, apex)
  const normal = {
    x: ab.y * ae.z - ab.z * ae.y,
    y: ab.z * ae.x - ab.x * ae.z,
    z: ab.x * ae.y - ab.y * ae.x
  }
  const crossProduct = {
    x: normal.y * pa.z - normal.z * pa.y,
    y: normal.z * pa.x - normal.x * pa.z,
    z: normal.x * pa.y - normal.y * pa.x
  }
  expect(norm(normal)).toBeGreaterThan(1e-6) // 底面不能退化，否则"平行"是句空话
  expect(norm(crossProduct)).toBeLessThan(1e-6 * norm(normal) * norm(pa))
  expect(Math.abs(dot(normal, pa))).toBeGreaterThan(0.99 * norm(normal) * norm(pa))
})

/**
 * **问路的浏览器判据**（设计 §6 的"认不出一律问路、不改文档"）：开关关着时，
 * 同一句台体题面**不产出草稿、不占撤销历史** —— 而不是画一只四棱锥糊弄过去。
 */
test("with the experiment off the same frustum sentence produces no draft and no undo history", async ({ page }) => {
  await openAgent(page)
  await send(page, FRUSTUM)
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  await expect(undoButton(page)).toBeDisabled()
})

import { expect, test } from "@playwright/test"

/**
 * **§3-F 阶段 A 的浏览器证据：底面点名的数值角（`∠ABC=60°`）真的画得出、核得过。**
 *
 * 为什么单独补这一条：阶段 A 的内核构造（`deriveAngledTriangleBase`，含**四边形底面**那一支）
 * 此前只有内核与管线的判据 —— `e2e/` 里 `∠` 只出现在**"读不懂的样本"**（`sin∠PAB=0.5`）那一条上，
 * 也就是说这条能力在浏览器里**一条判据都没有**。仓库的纪律是"每条能力都要有浏览器证据"，
 * 所以这一块补的是**证据**，不是新行为 —— 而"这条判据能不能咬人"由一次
 * **只回退内核源码**的对照实验证明（回退后本 spec 必须红；见提交信息与归档）。
 *
 * 走的是**既有**的离线路线：设置里打开「示意图见证搜索」⇒ `solidShapeIntentFor` 用
 * `parseShapeClause` 认出形状从句，再在**浏览器里**跑见证搜索 —— 那正是 `deriveAngledTriangleBase`
 * 的入口（不是把坐标写在夹具里的那条路）。
 *
 * 后半段与 `agent-rhombus-base.spec.ts` 同一套纪律：把**真实落盘**的坐标读出来**自己算**，
 * 不读核验面板的结论（拿被判对象的自述去证明它自己，等于没证）。自己算的是两件事：
 * ① 题面那个角**真的是 60°**；② **没有顺手做出题面没说的特殊性** —— 两组对边都不平行。
 *
 * 为什么点名表用 `label` 而不是下标的字面值：核验用的是 `vertexNames`，用户看到的是画布上的
 * 标签，两者**必须指同一批点**（P2-C 修的就是这个）。所以这里先断言标签集合，再**按标签**算角 ——
 * 于是这条 spec 同时盯着"角成立"与"面板说的名字与画布上的是同一批"。
 */

/**
 * **题面必须带上「线段 ⊥ 点名平面」那一句** —— 这不是为了好看，是这条路线的前提：
 * 见证搜索靠它确定**底面环、垂足与顶点**（少了它，实测报
 * `unsupported-shape: 题面没有给出「某条线段 ⊥ 某个点名平面」的写法，首批无法确定底面环、垂足与顶点`）。
 * 而它对**底面构造**是透明的：`kernelRelations` 明确不把"线 ⊥ 面"翻译成内核的两两写法
 * （见 `witnessSearch.ts` 那段注释），所以内核收到的底面条件**只有那个角**。
 */
const BASE_ANGLE = "在四棱锥P-ABCD中，PA⊥平面ABCD，∠ABC=60°，画出这个四棱锥"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

interface Vec3 { x: number; y: number; z: number }

async function readByLabel(page: import("@playwright/test").Page): Promise<{ byLabel: Record<string, Vec3>; byIndex: Vec3[] }> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { id: string; type: string; label?: string; position?: { x: number; y: number; z: number }; vertexIds?: string[] }[]
    const solid = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
    if (!solid?.vertexIds) throw new Error("草稿里没有多面体")
    const byIndex: { x: number; y: number; z: number }[] = []
    const byLabel: Record<string, { x: number; y: number; z: number }> = {}
    for (const id of solid.vertexIds) {
      const point = primitives.find((candidate) => candidate.id === id)
      if (!point?.position) throw new Error(`顶点 ${id} 没有坐标`)
      byIndex.push(point.position)
      if (typeof point.label === "string") byLabel[point.label] = point.position
    }
    return { byLabel, byIndex }
  })
}

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("a named 60° angle on a quadrilateral base is drawn, verified in the panel, and really measures 60° after commit", async ({ page }) => {
  // 实验开关（`enableFreeApex` 在界面上就是这一个）：题面驱动的见证搜索这条路。
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await page.getByRole("textbox", { name: "对话输入" }).fill(BASE_ANGLE)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  const verification = panel.getByRole("region", { name: "题设核验" })
  // ① 题面那个角**进了核验**（不是"整句未核验"），而且是**通过**。
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("∠ABC")
  // 两条在核：题面那个角 + 那句「线 ⊥ 面」（后者由核验器自己算线面残差，不进底面构造）。
  // 实录：`PA⊥平面ABCD：通过。已按候选图坐标核验。∠ABC=60°：通过。已按候选图坐标核验。`
  await expect(verification).toContainText("通过 2 / 失败 0 / 未核验 0")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  const { byLabel } = await readByLabel(page)
  // ② 画布上的名字就是核验用的那一批（P2-C 的判据在这条路上也成立）。
  expect(Object.keys(byLabel).sort()).toEqual(["A", "B", "C", "D", "P"])

  const a = byLabel.A as Vec3
  const b = byLabel.B as Vec3
  const c = byLabel.C as Vec3
  const d = byLabel.D as Vec3

  // ③ **题面那句话成立**：∠ABC 的内部角 = 60°（测试自己从落盘坐标算）。
  const alongBa = subtract(a, b)
  const alongBc = subtract(c, b)
  const cosine = dot(alongBa, alongBc) / (norm(alongBa) * norm(alongBc))
  const degrees = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
  expect(degrees, `∠ABC 实测 ${degrees}`).toBeCloseTo(60, 4)

  // ④ **没有多加题面没说的东西**：两组对边都不平行（四边形比三角形多一个自由度，
  //    第四条边是系统取的代表值 —— 顺手做出平行的那版会在这里红）。
  expect(norm(cross(subtract(b, a), subtract(c, d))), "AB ∦ DC").toBeGreaterThan(1e-6)
  expect(norm(cross(subtract(c, b), subtract(d, a))), "BC ∦ AD").toBeGreaterThan(1e-6)
})

import { expect, test } from "@playwright/test"

/**
 * **§3-F 阶段 B（B1）的浏览器证据：顶点参与的数值角（`∠PBA=60°`）在浏览器里真的画得出、核得过。**
 *
 * 为什么单独补这一条：B1 的实现块只在**内核**与**见证搜索**两层钉了判据，`e2e/` 里一条都没有 ——
 * 而仓库的纪律是"每条能力都要有浏览器证据"。补的是**证据**，不是新行为；
 * "这条判据能不能咬人"由一次**只回退内核源码**的对照实验证明（回退后本 spec 必须红）。
 *
 * 走的是既有离线路线：设置里打开「示意图见证搜索」⇒ `parseShapeClause` 认形状从句 ⇒
 * **在浏览器里**跑见证搜索 —— 那正是 `deriveApexHeight` 的 `solveApexAngleHeight` 的入口。
 *
 * 题面三件事缺一不可：① **四棱锥**（三棱锥是 V0a 的地盘，那条路不接）；
 * ② `PA⊥平面ABCD`（见证搜索靠它定底面环、垂足与顶点）；③ `AB⊥AD`（四边形底面要有**环上**的定形条件 ——
 * 这也正是"环外的角帮不上底面的忙"那件事的正面：环外的角定不了底面，所以另给一条环上的）。
 *
 * 判据三段，与其它几何 spec 同一套纪律（**自己算**，不读面板结论）：
 * ① 题面那个角真的是 60°；② 它是**按那个角求根**定出来的高（旁证：`h = |AB|·tan60°`，
 * 因为顶点在垂足 `A` 正上方）；③ 面板上那个角**进的是核验**（不是"整句读不懂"）且通过。
 */

const APEX_ANGLE = "在四棱锥P-ABCD中，PA⊥平面ABCD，AB⊥AD，∠PBA=60°，画出这个四棱锥"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

interface Vec3 { x: number; y: number; z: number }

async function readByLabel(page: import("@playwright/test").Page): Promise<Record<string, Vec3>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { id: string; type: string; label?: string; position?: { x: number; y: number; z: number }; vertexIds?: string[] }[]
    const solid = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
    if (!solid?.vertexIds) throw new Error("草稿里没有多面体")
    const byLabel: Record<string, { x: number; y: number; z: number }> = {}
    for (const id of solid.vertexIds) {
      const point = primitives.find((candidate) => candidate.id === id)
      if (!point?.position) throw new Error(`顶点 ${id} 没有坐标`)
      if (typeof point.label === "string") byLabel[point.label] = point.position
    }
    return byLabel
  })
}

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("an angle whose leg is the apex is solved for the height, verified in the panel, and measures 60° after commit", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await page.getByRole("textbox", { name: "对话输入" }).fill(APEX_ANGLE)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  const verification = panel.getByRole("region", { name: "题设核验" })
  // ① 那个角**进了核验**且通过（不是"整句未核验"，也不是"什么都没出来"）。
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("∠PBA")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  const byLabel = await readByLabel(page)
  expect(Object.keys(byLabel).sort()).toEqual(["A", "B", "C", "D", "P"])
  const a = byLabel.A as Vec3
  const b = byLabel.B as Vec3
  const p = byLabel.P as Vec3

  // ② **题面那句话成立**：∠PBA 的内部角 = 60°（测试自己从落盘坐标算）。
  const alongBp = subtract(p, b)
  const alongBa = subtract(a, b)
  const cosine = dot(alongBp, alongBa) / (norm(alongBp) * norm(alongBa))
  const degrees = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
  expect(degrees, `∠PBA 实测 ${degrees}`).toBeCloseTo(60, 4)

  // ③ **旁证：这个高是"按那个角求根"求出来的**，不是随手挑的一个值。
  //    顶点在垂足 A 正上方 ⇒ 解析解 h = |AB|·tan60°。
  const height = p.z - a.z
  const expected = norm(subtract(b, a)) * Math.tan((60 * Math.PI) / 180)
  expect(height, `落盘高 h=${String(height)}，解析解 h=${String(expected)}`).toBeCloseTo(expected, 4)
})

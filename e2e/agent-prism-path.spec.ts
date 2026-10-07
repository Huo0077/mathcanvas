import { expect, test } from "@playwright/test"

/**
 * **S3.4 浏览器正例：题面驱动的棱柱**（设计 §3.2；与 `agent-solid-family-path.spec.ts` 同一套纪律）。
 *
 * 前半段证"流程走得通"（核验面板 `passed`、能确认提交、能回画布）；后半段证"**图本身对不对**"——
 * 把草稿里**真实落盘**的坐标读出来，在测试里**自己算**，不读 `diagramVerification` 的结论
 *（拿被判对象的自述去证明它自己，等于没证）。自己算的是**题面的原话**：
 *
 * - **侧棱 ⊥ 底面**：从底面三点算出法向，再量每条侧棱与它是不是平行（`|cos θ| = 1`）；
 * - **棱柱**：三条侧棱向量**彼此相等**（对，是"平移"不是"各自拉长"）；
 * - 底面**非退化**（三点不共线，面积不为 0）。
 *
 * ## 为什么几何判据按拓扑下标写
 *
 * 本仓**已记录、待裁决**的"顶点标签错位"缺陷（本文件第三次实测）：计划里的点名是
 * `A,B,C,A′,B′,C′`，落盘标签却是按位置顺延的 `A…F`。判据一律走 `polyhedron3.vertexIds` 的
 * **下标顺序**（= 内核构造时的点名顺序），并把标签不一致逐字钉住，不让它继续静默。
 */

/**
 * 题面用**不带空格**的写法：入口那一层认这一种（带空格的写法在棱柱这条推导上读不出侧棱方向，
 * 实测会退化成"认不出 ⇒ 问路"）。
 */
const PRISM = "在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个三棱柱"

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

async function readPrism(page: import("@playwright/test").Page): Promise<{ vertices: Vec3[]; labels: string[] }> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { id: string; type: string; label?: string; position?: { x: number; y: number; z: number }; vertexIds?: string[] }[]
    const solid = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
    if (!solid?.vertexIds) throw new Error("草稿里没有多面体")
    const points = solid.vertexIds.map((id) => {
      const point = primitives.find((candidate) => candidate.id === id)
      if (!point?.position) throw new Error(`顶点 ${id} 没有坐标`)
      return point
    })
    return { vertices: points.map((point) => point.position!), labels: points.map((point) => point.label ?? "") }
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

/**
 * ## ⚠ 这条用例**暂时挂着（`fixme`），因为它撞上了一个真阻塞**（S3.4 未完成）
 *
 * 实测（本文件，2026-10-07）：这句题面在界面上**走得到规划**（页面读数：`规划 asking for a plan 成功`、
 * `暂存草稿 staging 1 action(s) 成功`），但**属性面板那块"确认改动"始终不出现**（等到 30 s 超时仍无）。
 * 对照：台体与五棱锥那两句（`agent-solid-family-path.spec.ts`）**同样走见证搜索**，面板照常出现 ——
 * 所以差别不在"这条线慢"，而在这一句产出的计划与它们不同。
 *
 * **单元层是通的**（`localPlanner.test.ts` 那条新用例）：同样这句题面 ⇒ `kind: "plan"`、
 * 动作为 `solid.create_polyhedron`、假设里有"自选"。也就是说**卡在"计划 → 面板"之间**，
 * 不是卡在规划本身 —— 下一批要查的就是那一段（很可能是"这一句没有可核验的题设 ⇒ 面板换了个形态"）。
 *
 * 在此之前**不写成通过**：几何判据（下面那三条）已经写好，等面板能出来再开。
 */
test.fixme("a right prism from a sentence commits coordinates whose lateral edges really are perpendicular to the base", async ({ page }) => {
  // 实验开关（`enableFreeApex` 在界面上就是这一个）：题面驱动的见证搜索这条路。
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, PRISM)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  // 题面驱动的这条线比固定夹具重（要跑见证搜索 + 核验），面板出现得晚一些：**轮询**等它，别用短超时判负。
  await expect(panel).toBeVisible({ timeout: 30000 })
  await expect(panel.getByRole("region", { name: "题设核验" })).toHaveAttribute("data-status", "passed")
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:geometry3d"))).not.toBeNull()

  const prism = await readPrism(page)
  expect(prism.vertices).toHaveLength(6)
  // 标签：计划里点名 `A,B,C,A′,B′,C′`，落盘是按位置顺延的 `A…F` —— **已记录的缺陷**，本用例只钉住它。
  expect([...prism.labels].sort()).toEqual(["A", "B", "C", "D", "E", "F"])

  const [a, b, c, aTop, bTop, cTop] = prism.vertices as [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3]
  // ① 底面非退化：三点不共线。
  const normal = cross(subtract(b, a), subtract(c, a))
  expect(norm(normal)).toBeGreaterThan(1e-6)

  // ② 三条侧棱**彼此相等**（棱柱 = 底面整体平移，不是各自拉长）。
  const laterals = [subtract(aTop, a), subtract(bTop, b), subtract(cTop, c)]
  for (const lateral of laterals.slice(1)) {
    expect(lateral.x).toBeCloseTo(laterals[0]!.x, 6)
    expect(lateral.y).toBeCloseTo(laterals[0]!.y, 6)
    expect(lateral.z).toBeCloseTo(laterals[0]!.z, 6)
  }

  // ③ **题面的原话**：侧棱 ⊥ 底面 —— 每条侧棱都与底面法向平行（夹角余弦的绝对值为 1）。
  for (const lateral of laterals) {
    const cosine = Math.abs(dot(lateral, normal)) / (norm(lateral) * norm(normal))
    expect(cosine).toBeCloseTo(1, 6)
  }
})

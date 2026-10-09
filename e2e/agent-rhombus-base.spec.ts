import { expect, test } from "@playwright/test"

/**
 * **S3 浏览器正例：底面是菱形的四棱柱**（设计 §19 的那句话，走**有名字表**的入口）。
 *
 * 与 `agent-prism-path.spec.ts` 同一套纪律：前半段证"流程走得通"（核验面板 `passed`、能确认能提交），
 * 后半段证"**图本身对不对**"—— 把草稿里**真实落盘**的坐标读出来，在测试里**自己算**，
 * 不读 `diagramVerification` 的结论（拿被判对象的自述去证明它自己，等于没证）。
 *
 * 自己算的是题面的原话：
 * - **底面是菱形**：四条边两两相等（这是"菱形"的定义，也是解析层拆成三条 `equalLength` 的那件事）；
 * - **不是正方形**：A 处不是直角 —— 四边相等 + 直角就是正方形，那是题面**没说**的额外特殊性
 *   （仓库既有先例：候选池里"两条自由底边不许取相等"同一条账）；
 * - **侧棱 ⊥ 底面**：每条侧棱与底面法向平行。
 *
 * 几何判据按**拓扑下标**写（`polyhedron3.vertexIds` 的顺序 = 内核构造时的点名顺序），
 * 因为仓库**已记录、待裁决**的"顶点标签错位"缺陷会让落盘标签与点名不一致（本文件不替它选修法）。
 */

const RHOMBUS = "在四棱柱ABCD-A′B′C′D′中，底面ABCD是菱形，AA′⊥平面ABCD，画出这个四棱柱"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

interface Vec3 { x: number; y: number; z: number }

async function readSolid(page: import("@playwright/test").Page): Promise<Vec3[]> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { id: string; type: string; position?: { x: number; y: number; z: number }; vertexIds?: string[] }[]
    const solid = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
    if (!solid?.vertexIds) throw new Error("草稿里没有多面体")
    return solid.vertexIds.map((id) => {
      const point = primitives.find((candidate) => candidate.id === id)
      if (!point?.position) throw new Error(`顶点 ${id} 没有坐标`)
      return point.position
    })
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

test("a rhombus base commits four equal sides that are not a square, with lateral edges perpendicular to it", async ({ page }) => {
  // 实验开关（`enableFreeApex` 在界面上就是这一个）：题面驱动的见证搜索这条路。
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await page.getByRole("textbox", { name: "对话输入" }).fill(RHOMBUS)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  await expect(panel.getByRole("region", { name: "题设核验" })).toHaveAttribute("data-status", "passed")
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  const vertices = await readSolid(page)
  // 四棱柱：底面四点 + 顶面四点。
  expect(vertices).toHaveLength(8)
  const [a, b, c, d, aTop, bTop, cTop, dTop] = vertices as [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3]

  // ① **底面四条边两两相等** —— 这就是"菱形"。
  const sides = [subtract(b, a), subtract(c, b), subtract(d, c), subtract(a, d)].map(norm)
  for (const side of sides) expect(side, JSON.stringify(sides)).toBeCloseTo(sides[0]!, 6)

  // ② **不是正方形**：A 处不是直角（四边相等 + 直角 = 正方形，题面没这么说）。
  const alongAb = subtract(b, a)
  const alongAd = subtract(d, a)
  const cosine = Math.abs(dot(alongAb, alongAd)) / (norm(alongAb) * norm(alongAd))
  expect(cosine, "A 处成了直角 ⇒ 菱形被画成了正方形").toBeGreaterThan(0.1)

  // ③ **题面的原话**：侧棱 ⊥ 底面 —— 每条侧棱都与底面法向平行。
  const normal = cross(alongAb, alongAd)
  expect(norm(normal)).toBeGreaterThan(1e-6)
  for (const [base, top] of [[a, aTop], [b, bTop], [c, cTop], [d, dTop]] as [Vec3, Vec3][]) {
    const lateral = subtract(top, base)
    const parallel = Math.abs(dot(lateral, normal)) / (norm(lateral) * norm(normal))
    expect(parallel).toBeCloseTo(1, 6)
  }
})

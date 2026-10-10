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
 * ## 顶点名与标签现在指的是同一批顶点（2026-10-10 修）
 *
 * 本仓**已记录**的"顶点标签错位"缺陷（本文件第三次实测）：计划里的点名是 `A,B,C,A′,B′,C′`，
 * 落盘标签却曾经是按位置顺延的 `A…F`。当时把不一致逐字钉住；现在标签跟随 `vertexNames`
 *（真缺陷已修，内核那侧的判据在 `packages/scene-graph/src/actions/actions.test.ts`），
 * 所以下面**同时**按下标与按标签读，并要求两者一一对上。
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
 * ## ✅ S3.4 阻塞已解除（2026-10-10）：这条用例从 `fixme` 转正
 *
 * **曾经的现场**（2026-10-07）：这句题面在界面上走得到规划（`规划 asking for a plan 成功`、
 * `暂存草稿 staging 1 action(s) 成功`），但"确认改动"面板**始终不出现**（30 s 超时）。
 * 对照台体与五棱锥那两句同样走见证搜索却正常 ⇒ 差别在这一句产出的计划与它们不同。
 *
 * **根因**（在单测里用真实暂存路径确定性复现后落到具体那条规则）：不在几何、不在模型，
 * 而在**关系抽取**那一层 —— 抽取器的"点名块"字母表是 `[A-Z][A-Z0-9]*`，`′` 不在其中，
 * 于是 `AA′` 被切成 `AA`，读成**自己到自己**的退化线段。`AA′ ⊥ 平面ABC` 的 targets 因此是
 * `v0,v0,…`，残差算不出来 ⇒ `planCompiler` 判 `relation_not_satisfied`（一次**失败**，
 * 而不是"未核验"）⇒ 编译失败 ⇒ 协调器把那唯一一次修复交给模型 —— 可这条关系是**系统从原话
 * 抽出来的**，`envelope.relations` 只是投影，模型改不动 ⇒ `run_failed` ⇒ 面板永不出现。
 *
 * **修法**：抽取器的点名块改用 `pointNames.ts` 的唯一定义（S1），`AA′` 于是读成线段 A–A′。
 * 判据钉在三处：`relationExtraction.test.ts`（抽出来的 targets）、
 * `diagramDraftStage.test.ts`（真实暂存路径 `passed`）、以及本文件（浏览器里自己算几何）。
 */
test("a right prism from a sentence commits coordinates whose lateral edges really are perpendicular to the base", async ({ page }) => {
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
  /**
   * **标签就是题面点名的那些名字**（2026-10-10 修；此前这一段钉住的是缺陷本身）。
   *
   * 计划点名 `A,B,C,A′,B′,C′`，曾经落盘成按位置顺延的 `A…F` ——
   * 学生在画布上看到的 `D` 其实是 `A′`。现在按下标一一对上（顺序即点名顺序）。
   */
  expect(prism.labels).toEqual(["A", "B", "C", "A′", "B′", "C′"])

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

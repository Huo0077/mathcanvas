import { expect, test } from "@playwright/test"

/**
 * **S3 浏览器正例：题面驱动的斜三棱柱**（题面只说"斜"，斜向由系统取**代表值**并写进假设）。
 *
 * 与 `e2e/agent-oblique-prism.spec.ts` 区分开：那一条是**夹具**路径（代表题一，固定尺寸的斜四棱柱 + 截面），
 * 本文件走的是**题面 → 入口语法 → spec → 见证搜索**那条线。
 *
 * 纪律同 `agent-rhombus-base.spec.ts` / `agent-prism-path.spec.ts`：读草稿里**真实落盘**的坐标自己算，
 * 不读 `diagramVerification` 的结论。算的是"斜棱柱"这个说法的两条含义：
 * - **是棱柱**：三条侧棱是同一条向量（顶面 = 底面的平移），不是各自拉长；
 * - **是斜的**：侧棱与底面法向**不平行**（直棱柱时余弦会是 1）。
 *
 * 代表斜向（60°、朝 +x）是**系统自选**，所以这里只钉"真的斜"，**不钉具体角度** ——
 * 钉死角度会让以后调整代表值时这条用例变成假门禁。
 */

const OBLIQUE = "在斜三棱柱ABC-A′B′C′中，AB=2，画出这个斜三棱柱"

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

test("an oblique prism from a sentence commits a translated top ring that really is oblique", async ({ page }) => {
  // 实验开关（`enableFreeApex` 在界面上就是这一个）：题面驱动的见证搜索这条路。
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await page.getByRole("textbox", { name: "对话输入" }).fill(OBLIQUE)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  await expect(panel.getByRole("region", { name: "题设核验" })).toHaveAttribute("data-status", "passed")
  /**
   * **代表斜向必须写在面板上**（"系统替你定了什么"那一列）：题面只说了"斜"，
   * 斜多少是系统定的 —— 用户有权在确认之前看到这件事。
   */
  await expect(panel).toContainText("斜向")
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  const vertices = await readSolid(page)
  expect(vertices).toHaveLength(6)
  const [a, b, c, aTop, bTop, cTop] = vertices as [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3]

  // ① **是棱柱**：三条侧棱是同一条向量（顶面 = 底面平移）。
  const lateral = subtract(aTop, a)
  for (const [foot, top] of [[b, bTop], [c, cTop]] as [Vec3, Vec3][]) {
    const edge = subtract(top, foot)
    expect(norm(subtract(edge, lateral))).toBeLessThan(1e-9)
  }

  // ② **是斜的**：侧棱与底面法向不平行（直棱柱时这一项会是 1）。
  const normal = cross(subtract(b, a), subtract(c, a))
  expect(norm(normal)).toBeGreaterThan(1e-6)
  const cosine = Math.abs(dot(lateral, normal)) / (norm(lateral) * norm(normal))
  expect(cosine, "侧棱与底面法向平行 ⇒ 画成了直棱柱").toBeLessThan(0.99)

  // ③ 底面非退化、侧棱非零。
  expect(norm(lateral)).toBeGreaterThan(1e-6)
})

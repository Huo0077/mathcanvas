import { expect, test } from "@playwright/test"

/**
 * **圆台的浏览器证据**（S4.3）：从一句话到画布上的一只圆台。
 *
 * 判据从草稿里**真实落盘**的顶点自己算（不读面板结论）：
 * ① 两个环各 `segments` 个顶点，下底到轴心等距 **2**、上底等距 **1**，且两底分别落在 `z = 0` 与 `z = 3`
 *   —— 这一条把"题面说上底 1 下底 2，画出来反过来"这种错直接拦下；
 * ② 面数是 `segments + 2`，其中 `segments` 个是**四边形**（三角形的话那是圆锥）；
 * ③ 面板与对象**如实声明是近似**（假设里写出弦高误差）。
 *
 * 为什么值得在浏览器里再走一遍：它是本仓第一只**两个 48 边形**拼出来的实体
 *（96 个顶点、50 个面）——"编译器 / 草稿 / 渲染扛不扛得住这个规模"只有走一遍才知道。
 */

const PROMPT = "画一个圆台，上底半径 1、下底半径 2、高 3"
const SEGMENTS = 48

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 读草稿里的那只多面体：顶点按 `vertexIds` 顺序、面环按 `face3.pointIds` 的长度。 */
async function readSolid(page: import("@playwright/test").Page): Promise<{ vertices: { x: number; y: number; z: number }[]; faceSizes: number[]; label: string | null }> {
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
      faceIds?: string[]
      pointIds?: string[]
    }[]
    const solid = primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.vertexIds)
    if (!solid?.vertexIds) throw new Error("草稿里没有多面体")
    const vertices = solid.vertexIds.map((id) => {
      const point = primitives.find((candidate) => candidate.id === id)
      if (!point?.position) throw new Error(`顶点 ${id} 没有坐标`)
      return point.position
    })
    const faceSizes = (solid.faceIds ?? []).map((id) => {
      const face = primitives.find((candidate) => candidate.id === id)
      return face?.pointIds?.length ?? 0
    })
    return { vertices, faceSizes, label: solid.label ?? null }
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("a round frustum arrives on the canvas as its polygon approximation, and says so", async ({ page }) => {
  await openAgent(page)
  await send(page, PROMPT)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  // ③ **如实声明是近似**：假设里要写出段数与弦高误差，而不是让用户以为这是理想的圆台。
  await expect(panel.locator(".agent-assumptions")).toContainText("近似")
  await expect(panel.locator(".agent-assumptions")).toContainText("弦高")
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:geometry3d"))).not.toBeNull()

  const solid = await readSolid(page)
  expect(solid.label).toContain("近似")
  // ① 两个环的半径与高度：**下底 2、上底 1**，别画反。
  expect(solid.vertices).toHaveLength(SEGMENTS * 2)
  const radiusOf = (point: { x: number; y: number }): number => Math.hypot(point.x, point.y)
  for (const point of solid.vertices.slice(0, SEGMENTS)) {
    expect(radiusOf(point)).toBeCloseTo(2, 6)
    expect(point.z).toBeCloseTo(0, 6)
  }
  for (const point of solid.vertices.slice(SEGMENTS)) {
    expect(radiusOf(point)).toBeCloseTo(1, 6)
    expect(point.z).toBeCloseTo(3, 6)
  }
  // ② 面：两个底 + 48 个**四边形**侧面。
  expect(solid.faceSizes).toHaveLength(SEGMENTS + 2)
  expect(solid.faceSizes.filter((size) => size === 4)).toHaveLength(SEGMENTS)
})

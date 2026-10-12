import { expect, test } from "@playwright/test"

/**
 * **Task 11（2026-10-12）：真题结构的三角形 —— 一边、一角、一面积 —— 在真实画布上的证据。**
 *
 * ## 这条 e2e 真正要证的是什么
 *
 * 题面是调研 §2.1 的"解三角形条件与**面积**条件联立"那一类
 *（"只满足正弦定理而**不核面积**的图是**错误图**"）。夹具故意给一组**错的**坐标
 *（`AB = 4`，题面要 8；面积也不对），所以：
 *
 * - **能 `passed`，就只可能是因为坐标被按题面重新构造过** —— 而那一步现在会把面积算进去
 *   （`planarRuleFromArea`：`面积 = ½·底·臂·sin(夹角)` ⇒ 臂长唯一）；
 * - 判据三段与其它几何 spec 同一套纪律：**自己从落盘坐标算**，不读面板结论。
 *
 * ## 为什么在 `geometry3d` 而不是"平面几何"工作区
 *
 * 平面图形这一族的宿主是 `solid.create_face`（**它的文档是 3D**：`withWitnessCoordinates`
 * 只认 `create_polyhedron` / `create_face` 两种宿主，而平面动作那种文档里两者都不在役）。
 * 这也正是原用户"平面四边形 + 翻折片"那道题的现状 —— 本 spec 走的是同一条路。
 */

const EXAM_TRIANGLE = "平面三角形ABC中，AB=8，∠BAC=30°，△ABC的面积为6"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

/** 读提交后落盘的**点名点**（`point3` + `label`）。 */
async function namedPoints(page: import("@playwright/test").Page): Promise<Record<string, { x: number; y: number; z: number }>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { type: string; label?: string; position?: { x: number; y: number; z: number } }[]
    const points: Record<string, { x: number; y: number; z: number }> = {}
    for (const primitive of primitives) {
      if (primitive.type !== "point3") continue
      if (typeof primitive.label !== "string" || !/^[A-Z]$/.test(primitive.label)) continue
      if (!primitive.position) continue
      points[primitive.label] = primitive.position
    }
    return points
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("solves the exam triangle from side + angle + area, verifies it, and undoes in one step", async ({ page }) => {
  // 见证搜索那条救援路径要打开（夹具的坐标是错的，靠它按题面重造）。
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await page.getByRole("textbox", { name: "对话输入" }).fill(EXAM_TRIANGLE)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  // ① 核验真的跑了，而且题面那三条都进了核验（不是"整句读不懂"）。
  const verification = panel.getByRole("region", { name: "题设核验" })
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("AB")
  await expect(verification).toContainText("面积")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  const points = await namedPoints(page)
  expect(Object.keys(points).sort()).toEqual(["A", "B", "C"])
  const a = points.A!
  const b = points.B!
  const c = points.C!

  // ② **自己算**三条题设（不读面板结论）。
  const distance = (left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number =>
    Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
  expect(distance(a, b), "AB 应当是 8（夹具给的是 4）").toBeCloseTo(8, 6)

  const alongAb = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const alongAc = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  const norm = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z)
  const cosine = (alongAb.x * alongAc.x + alongAb.y * alongAc.y + alongAb.z * alongAc.z) / (norm(alongAb) * norm(alongAc))
  const angle = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
  expect(angle, `∠BAC 实测 ${angle}`).toBeCloseTo(30, 4)

  // 面积 = ½·|AB × AC|（自己算，二维叉积在 z 上的分量）。
  const area = Math.abs(alongAb.x * alongAc.y - alongAb.y * alongAc.x) / 2
  expect(area, `面积实测 ${area}`).toBeCloseTo(6, 6)

  // ③ **一步撤销**：Ctrl+Z 之后回到提交前（图上没有这三个点了）。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => Object.keys(await namedPoints(page)).length).toBe(0)

  await page.screenshot({ path: "test-results/task11-exam-triangle.png" })
})

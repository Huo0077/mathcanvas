import { expect, test } from "@playwright/test"

const FREE_APEX = "在三棱锥D-ABC中，AD⊥平面ABC，自由点D，画示意图"

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
 * 这是浏览器里**唯一**能"看见"撤销栈的读数（`canUndo = store.history.length > 0`），
 * 所以"拒绝一步历史都不占"这条出口条件只能拿它当正向信号 —— 不能只断言"画布上没东西"，
 * 那与"画了又被撤掉"看起来一模一样。
 */
function undoButton(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: "撤销", exact: true })
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("when enabled, a free-height tetrahedral diagram has real scene objects, verified premises, confirmation and one-step undo", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, FREE_APEX)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  await expect(check).toContainText("AD⊥平面ABC")
  await expect(check).toContainText("自由点 D")
  await expect(check).toContainText("不是普遍证明")
  await expect(panel.locator(".agent-assumptions")).toContainText("系统自选")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBeGreaterThan(0)
  await page.keyboard.press("Control+z")
  await expect.poll(() => page.locator(".algebra-panel .object-row").count()).toBe(0)
})

test("when disabled, the same previously unsupported prompt does not create a point or a draft", async ({ page }) => {
  await openAgent(page)
  await send(page, FREE_APEX)
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
})

test("the experimental route does not silently discard an unsupported above-the-base condition", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, "在三棱锥D-ABC中，AD⊥平面ABC，D在底面ABC上方，画示意图")
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  // 「没东西」与「画了又被撤掉」在画布上长得一样，所以还要读撤销栈：拒绝**一步历史都不占**。
  await expect(undoButton(page)).toBeDisabled()
})

/**
 * **原话写死的坐标：正例**（计划 V0a 的显式坐标 RED 条件）。
 *
 * 为什么必须与下面那条反例**成对**：单独一条"错坐标被拒"证明不了任何事 ——
 * 这句话压根不被认识时，结果同样是"没有草稿"。正例钉住"这个句式是被接受的"，
 * 反例才谈得上证明"拒绝是因为题设不成立"。
 */
test("accepts a bounded explicit-coordinate sentence and lists the stated coordinate as a verified premise", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, "在三棱锥D-ABC中，A=(0,0,0)，AD⊥平面ABC，自由点D，画示意图")

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  // 题面里写的那个坐标必须**逐字**出现在核验清单里，而不是被静默吞掉。
  await expect(check).toContainText("A=(0,0,0)")
  await expect(check).toContainText("AD⊥平面ABC")
})

/**
 * **原话写死的坐标：反例**（同一个句式、只改一个数）。
 *
 * 构造器把 A 放在原点，而题面说 A=(5,5,5) —— 这不是"图不够好看"，是**题设没被满足**，
 * 所以必须拒绝，且**不许**留下草稿或占用撤销历史。
 */
test("refuses the same sentence when the stated coordinate contradicts the figure", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, "在三棱锥D-ABC中，A=(5,5,5)，AD⊥平面ABC，自由点D，画示意图")

  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  // 同上：错坐标被拒之后撤销栈也必须是空的（拒绝不留痕、不占一步历史）。
  await expect(undoButton(page)).toBeDisabled()
})

// ---------------------------------------------------------------- 独立回代题设

interface Vec3 { x: number; y: number; z: number }
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const norm = (a: Vec3): number => Math.sqrt(dot(a, a))

interface CommittedSolid {
  /** 按 `polyhedron3.vertexIds` 的**下标顺序**读出来的坐标 —— 核验器用的就是这套顺序。 */
  byIndex: Vec3[]
  /** 按点图元的 `label` 读出来的坐标 —— 用户在画布上**看到**的是这一套。 */
  byLabel: Record<string, Vec3>
}

/**
 * 读**应用自己写下的那份 `.mgeo` 草稿**里的坐标。
 *
 * 为什么不去读界面上的数字：3D 画布是 WebGL，没有可读坐标的 DOM 图元；而"系统自报核验通过"
 * 恰恰是本次要独立复核的对象 —— 拿它的结论去证明它自己，等于没证。
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

/**
 * **V0a 出口点名的"浏览器独立回代"**（计划：`docs/superpowers/plans/2026-10-06-…-implementation-plan.md`）。
 *
 * 与上一条用例的分工：上一条证"流程走得通"（核验面板说 passed、能确认、能一步撤销），
 * 这一条证"**图本身对不对**"—— 它把文档里真实落盘的坐标读出来，在测试里**自己算一遍题设**，
 * 不读 `diagramVerification` 的结论。这正是本仓那条教训的落点：
 * **门禁全绿 ≠ 图符合题意**，所以"绿"必须由一份不依赖那套判据的独立计算来复核。
 */
test("re-verifies the committed tetrahedron from the document's own coordinates, independently of the panel", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await openAgent(page)
  await send(page, FREE_APEX)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:geometry3d"))).not.toBeNull()

  const solid = await committedSolid(page)
  // 这条句子点名 A、B、C、D 四个顶点，落盘之后必须还是这四个 —— 不多不少、不重名。
  expect(Object.keys(solid.byLabel).sort()).toEqual(["A", "B", "C", "D"])
  const { A, B, C, D } = solid.byLabel

  /**
   * **题设逐条独立回代**（自算，不读面板）。
   * 题面原文：`在三棱锥D-ABC中，AD⊥平面ABC，自由点D，画示意图`。
   */
  const normal = cross(sub(B, A), sub(C, A))
  const ad = sub(D, A)
  expect(norm(normal)).toBeGreaterThan(1e-6) // 底面 ABC 不能退化
  expect(norm(ad)).toBeGreaterThan(1e-6) // AD 不能是零向量
  // ① AD ⊥ 平面ABC ⟺ AD **平行于**底面法向 ⟺ 无量纲余弦的绝对值 = 1（不是 0）。
  expect(Math.abs(dot(ad, normal)) / (norm(ad) * norm(normal))).toBeGreaterThan(1 - 1e-9)
  // ② D 必须真的离开底面（与①合起来才是"垂直于平面"而不是"落在平面内"）。
  expect(Math.abs(dot(ad, normal)) / norm(normal)).toBeGreaterThan(1e-6)
  // ③ 四面体不退化：四个顶点互异，且体积（= |(AB×AC)·AD| / 6）非零。
  const positions = [A, B, C, D]
  for (let first = 0; first < positions.length; first += 1) {
    for (let second = first + 1; second < positions.length; second += 1) {
      expect(norm(sub(positions[first], positions[second]))).toBeGreaterThan(1e-6)
    }
  }
  expect(Math.abs(dot(normal, ad)) / 6).toBeGreaterThan(1e-6)

  /**
   * ④ **系统自选的那条代表位置也要真的成立**：面板把「顶点 D 取在垂足 A 正上方、高 …（系统自选示例值）」
   * 明写给用户看，那它就得是画出来的那一张 —— 自选的示例值可以任意，但**不能与所说的话不符**。
   */
  expect(D.x).toBeCloseTo(A.x, 9)
  expect(D.y).toBeCloseTo(A.y, 9)

  /**
   * **下标顺序与标签必须指同一个顶点**（这一条抓的是一类具体的错：核验器用 `vertexNames` 的下标
   * 认顶点，而画布标签是**按下标顺序**自动生成的 `A`、`B`…；两者一旦错位，
   * "题设核验通过"说的就是另一个顶点，而用户按标签读图会读到别的结论）。
   */
  expect(solid.byIndex[0]).toEqual(solid.byLabel["A"])
  expect(solid.byIndex[1]).toEqual(solid.byLabel["B"])
  expect(solid.byIndex[2]).toEqual(solid.byLabel["C"])
  expect(solid.byIndex[3]).toEqual(solid.byLabel["D"])

  // 可目检的截图（`test-results/` 是 gitignore 的，只作当次目视核对用）。
  await page.screenshot({ path: "test-results/v0a-free-apex-tetrahedron.png" })
})

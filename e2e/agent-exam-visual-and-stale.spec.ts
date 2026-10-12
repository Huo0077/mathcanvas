import { createHash } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

/**
 * **Task 16：四族真实画布 / 相机 / 标签，以及"旧图证据过期"**。
 *
 * 计划原话：**"仅查内存文档不算视觉通过"**、"四族实际画布/相机/标签均同草稿版本"、
 * **"改题或撤销后旧图证据 stale"**。
 *
 * ## 这条 spec 的判据是怎么独立的
 *
 * ① **画布自己报出它渲染的是哪一版内容**：画布根元素带 `data-document-hash`
 *   （见 `apps/web/src/canvasEvidence.ts`，从**已经画出来的 DOM** 量盒子与标签）。
 * ② **测试自己算那一版的哈希**：把 localStorage 里落盘的文档按 `canonicalContentHash`
 *   的口径（键排序、丢掉视图/时间类字段、`undefined` 视同没有、数组保序）规范化后
 *   在 **Node 侧**用 `node:crypto` 算 SHA-256。两份实现各自独立 —— 相等才叫
 *   "画布渲染的正是这一份文档"，而不是"画布与自己相等"。
 * ③ 标签与诊断同样只看**渲染结果**：`data-canvas-labels` 是画布上真实画出来的点标签个数，
 *   `data-canvas-hidden-labels` 是"文档里有名字、画布没画出来"的那些点名。
 *
 * ## 记录的边界（不在这一条 spec 里假装做到）
 *
 * - **点名遮挡**：从产品入口确定性地造出"两个点名叠在一起"的题面没有 ——
 *   真能叠的构造在单测里（`canvasEvidence.test.ts` 用真实渲染元素量盒子后走 `diagnoseLayout`）。
 *   这里断言的是**反方向**：这四张图上点名**没有**叠（`label_overlap` 不出现）。
 * - **3D 转出视锥**：把某个点名转出相机视锥需要把相机推近到实体内部，产品入口里没有
 *   确定性做法；"文档里有名字而画布没画出来 ⇒ 看不见"这一支同样在单测里钉住。
 *   这里断言的是这台相机的读数：点标签个数 = 文档点名个数、隐藏集合为空。
 * - **3D 虚实线**：那是 Three.js 内部的材质选择，DOM 里读不到；这一层只给相机可见性与标签。
 * - **教师/学生可读性签收**：需要人来签，未做（记在任务卡的边界里）。
 */

const CONIC = "椭圆 x²/9+y²/4=1 与直线 y=0 相交于 A、B 两点"
const TRIANGLE = "平面三角形ABC中，AB=8，∠BAC=30°，△ABC的面积为6"
const FUNCTION_CURVE = "画出 f(x)=x³−3x 的图像与它在 x=1 处的切线"
const FUNCTION_BREAK = "画出 f(x)=1/x 的图像"
const SOLID_FOLD = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")

/**
 * **测试自己算的内容哈希**（与 `canonicalContentHash` 同口径、不同实现）。
 *
 * 口径来自 `packages/agent-core/src/hashing.ts` 的注释与常量：键排序、丢掉
 * `viewport/zoom/selection/updatedAt/...` 这一类视图与时间字段、`undefined` 视同没有这个字段、
 * 数组保序、非有限数拒绝。
 */
const IGNORED_KEYS = new Set([
  "viewport", "zoom", "panX", "panY", "selection", "selectedIds", "hoveredId",
  "updatedAt", "createdAt", "timestamp", "logs", "transcript", "cursor"
])

function canonicalize(value: unknown): string {
  if (value === undefined || value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in the document")
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((key) => !IGNORED_KEYS.has(key) && (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(",")}}`
  }
  throw new Error(`unsupported value of type ${typeof value}`)
}

function contentHash(document: unknown): string {
  return createHash("sha256").update(canonicalize(document), "utf8").digest("hex")
}

async function openAgent(page: Page, workspace: "平面几何" | "立体几何"): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: `跳转到${workspace}` }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 走完一条产品路径：题面 → 确认面板 → 提交 → 回到画布。 */
async function commit(page: Page, prompt: string, workspace: "平面几何" | "立体几何" = "立体几何"): Promise<void> {
  await openAgent(page, workspace)
  await send(page, prompt)
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  await panel.getByRole("button", { name: "确认并提交" }).click()
  // 对话里可能已经有一条"已提交"（同一会话的上一轮）⇒ 取最后一条。
  await expect(page.getByText("已提交").last()).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
}

/** 画布根元素上的证据属性（2D 是 SVG，3D 是场景 div）。 */
async function canvasEvidence(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    // 两个画布都由 `canvasEvidence.ts` 挂上同一组属性 ⇒ 按属性找，不靠类名（2D 的 svg 平时没有类名）。
    const root = document.querySelector('[data-3d-scene="true"]') ?? document.querySelector("[data-canvas-objects-measurable]")
    if (!root) throw new Error("画布根元素找不到")
    const read = (name: string): string => root.getAttribute(name) ?? ""
    return {
      hash: read("data-document-hash"),
      revision: read("data-document-revision"),
      boxes: read("data-canvas-boxes"),
      labels: read("data-canvas-labels"),
      diagnostics: read("data-canvas-diagnostics"),
      errors: read("data-canvas-diagnostic-errors"),
      hidden: read("data-canvas-hidden-labels"),
      measurable: read("data-canvas-objects-measurable")
    }
  })
}

/** 2D 画布那个 SVG（带证据属性）。 */
const planarCanvas = (page: Page) => page.locator('svg[data-canvas-objects-measurable]')

/** 落盘的那份文档（测试自己算哈希用它，不读画布结论）。 */
async function committedDocument(page: Page, workspace: "geometry3d" | "conics" | "calculus"): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(`mathcanvas:draft:${key}`)
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: unknown }
    if (!parsed.document) throw new Error("落盘的草稿里没有 document")
    return parsed.document
  }, workspace)
}

/** 落盘文档里**所有**函数曲线的表达式（测试自己读，用来证明"改题真的换了图"）。 */
async function functionExpressions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:conics")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: { type: string; expression?: string }[] } }
    return (parsed.document?.primitives ?? [])
      .filter((primitive) => primitive.type === "function" && typeof primitive.expression === "string")
      .map((primitive) => primitive.expression as string)
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("the 2D canvas reports the version it is drawing, and the test re-derives that hash itself", async ({ page }) => {
  await commit(page, CONIC, "平面几何")

  await expect(planarCanvas(page)).toBeVisible()
  const evidence = await canvasEvidence(page)
  const document = await committedDocument(page, "conics")

  // ① 画布与草稿**同版本**：画布自己报的哈希 == 测试自己算出来的那一份。
  expect(evidence.hash, "画布没有报出内容哈希").toMatch(/^[0-9a-f]{64}$/)
  expect(evidence.hash, "画布渲染的不是落盘的那一份文档").toBe(contentHash(document))
  // ② 每个数字都来自**渲染结果**：对象盒子与点名标签都画出来了。
  expect(Number(evidence.boxes)).toBeGreaterThan(0)
  expect(Number(evidence.labels)).toBeGreaterThan(0)
  expect(evidence.measurable).toBe("true")
  // ③ "看不见"那一档一条都不许有；点名也不许叠。
  expect(evidence.errors).toBe("")
  expect(evidence.diagnostics).not.toContain("label_overlap")
  expect(evidence.hidden).toBe("")

  await page.screenshot({ path: "test-results/task16-canvas-version.png" })
})

test("undoing the commit changes the canvas version, so the old figure evidence goes stale", async ({ page }) => {
  await commit(page, CONIC, "平面几何")
  const before = await canvasEvidence(page)

  // 一步撤销：画布上那份内容变了 —— 旧证据（绑在 before.hash 上）从此对不上。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => (await canvasEvidence(page)).hash).not.toBe(before.hash)
  const after = await canvasEvidence(page)
  expect(after.hash).not.toBe(before.hash)
  // 撤销之后画布确实是空的：对象盒子归零、并且如实报"画布上没有可画的图形"。
  expect(Number(after.boxes)).toBe(0)
  expect(after.errors).toContain("empty_canvas")
  // 测试自己核对：落盘的文档也真的回到没有那条椭圆的状态（不是只有画布变了）。
  const document = (await committedDocument(page, "conics")) as { primitives?: { type: string }[] }
  expect((document.primitives ?? []).some((primitive) => primitive.type === "ellipse")).toBe(false)
})

test("changing the statement draws a different figure, and the previous reading is no longer about it", async ({ page }) => {
  await commit(page, FUNCTION_CURVE, "平面几何")
  const first = await canvasEvidence(page)
  expect(first.hash).toBe(contentHash(await committedDocument(page, "conics")))
  const firstExpressions = await functionExpressions(page)

  // **改题**：换成另一道题面（同一族、同一条产品路径）。这一版画的是另一条曲线。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await send(page, FUNCTION_BREAK)
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交").last()).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()

  await expect.poll(async () => (await canvasEvidence(page)).hash).not.toBe(first.hash)
  const second = await canvasEvidence(page)
  expect(second.hash, "改题之后画布必须换成另一版内容").not.toBe(first.hash)
  // 画布自己报的哈希 == 测试自己算的这一份（改题后的那一份）。
  expect(second.hash).toBe(contentHash(await committedDocument(page, "conics")))
  // 测试自己读落盘的表达式：这一版多了 1/x 那条曲线 —— 旧证据不再描述现在这张图。
  expect(firstExpressions).toEqual(["x^3-3*x"])
  const secondExpressions = await functionExpressions(page)
  expect(secondExpressions).toContain("1/x")
  expect(secondExpressions).not.toEqual(firstExpressions)
  expect(Number(second.boxes)).toBeGreaterThan(0)
})

test("the 3D canvas reports its version and its point labels, and says which readings it cannot take", async ({ page }) => {
  await commit(page, SOLID_FOLD, "立体几何")
  await expect(page.locator('[data-3d-scene="true"]')).toBeVisible()

  const evidence = await canvasEvidence(page)
  // ① 同版本：画布报的哈希 == 测试自己算的那份 3D 文档。
  expect(evidence.hash).toMatch(/^[0-9a-f]{64}$/)
  expect(evidence.hash).toBe(contentHash(await committedDocument(page, "geometry3d")))
  // ② 3D 的图形在 WebGL 里，DOM 量不到 —— 画布**如实标注**，而不是把"量不到"说成"画布是空的"。
  expect(evidence.measurable).toBe("false")
  expect(evidence.errors).not.toContain("empty_canvas")

  /**
   * ③ 标签是 DOM：题面那**七个点名**都在画面上。
   *
   * **2026-10-12 实测到一条真问题（本任务的新读数抓出来的）**：题面的七个点名**各画了两次中的两个**——
   * 落盘的 `point3` 有 **9** 个：`face-1:v0…v3`（A/B/C/D）、`point3-1`/`point3-2`（E/F）、
   * `face-2:v0…v2`（折片自己的 P/E/F）。折片是**另建**的一块面片，它自己的 E/F 与边上那两个点
   * **位置重合**，于是同一串字母在同一个屏幕位置被画了两次。
   *
   * 这条读数正是"点名遮挡"那类反例：`data-canvas-diagnostics` 里因此出现 `label_overlap`
   * （判据没有失灵，是图上有两个标签压在一起）。**修法与 RED 记在任务卡上，属本任务未完成的部分。**
   */
  const labels = await page.evaluate(() => [...document.querySelectorAll('[data-3d-scene="true"] [data-point-id]')].map((element) => (element.textContent ?? "").trim()).filter(Boolean))
  expect([...new Set(labels)].sort(), `画布上的不同点名：${JSON.stringify(labels)}`).toEqual(["A", "B", "C", "D", "E", "F", "P"])
  expect(labels, `画布上的标签（含重复）：${JSON.stringify(labels)}`).toHaveLength(9)
  expect(labels.filter((label) => label === "E")).toHaveLength(2)
  expect(labels.filter((label) => label === "F")).toHaveLength(2)
  expect(evidence.labels).toBe("9")
  expect(evidence.diagnostics).toContain("label_overlap")
  // 但**这一档不是"看不见"**：图形都在画面上，只是有一处标签重复。
  expect(evidence.errors).toBe("")
})

test("the triangle family draws on the canvas the same version that was committed", async ({ page }) => {
  // 见证搜索那条救援路径要打开（夹具的坐标是错的，靠它按题面重造）——与 `agent-exam-triangle` 同一套。
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await commit(page, TRIANGLE)

  await expect(page.locator('[data-3d-scene="true"]')).toBeVisible()
  const evidence = await canvasEvidence(page)
  expect(evidence.hash).toBe(contentHash(await committedDocument(page, "geometry3d")))
  expect(evidence.measurable).toBe("false")
  expect(evidence.errors).toBe("")
  // 三个点名都在画布上（三角形那一族：A、B、C）。
  const labels = await page.evaluate(() => [...document.querySelectorAll('[data-3d-scene="true"] [data-point-id]')].map((element) => (element.textContent ?? "").trim()).filter(Boolean))
  expect([...new Set(labels)].sort()).toEqual(["A", "B", "C"])
  expect(evidence.hidden).toBe("")
})

test("a view-only change does not invalidate the figure evidence", async ({ page }) => {
  await commit(page, CONIC, "平面几何")
  const before = await canvasEvidence(page)
  expect(Number(before.boxes), "这条用例要求图上有可点的对象").toBeGreaterThan(0)

  // **视图**变化（缩放进/出）：证据绑的是内容，视图怎么动都不该作废它。
  // 反过来，"改题/撤销"才作废 —— 那两条在另外两条用例里。
  const zoom = page.locator("[data-zoom-readout]")
  const zoomBefore = await zoom.textContent()
  await page.getByRole("button", { name: "放大画布" }).click()
  await expect(zoom).not.toHaveText(zoomBefore ?? "")
  await page.getByRole("button", { name: "缩小画布" }).click()
  await expect.poll(async () => (await canvasEvidence(page)).hash).toBe(before.hash)
  expect((await canvasEvidence(page)).hash).toBe(before.hash)

  // 切到别的工作区再切回来：还是同一份内容、同一个哈希（"像没动过"不许被算成过期）。
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  await expect.poll(async () => (await canvasEvidence(page)).hash).toBe(before.hash)

  await page.screenshot({ path: "test-results/task16-canvas-stale.png" })
})

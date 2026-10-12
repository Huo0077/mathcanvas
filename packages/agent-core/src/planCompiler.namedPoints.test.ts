import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import type { Vector3 } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan, type PlanCompileResult } from "./planCompiler"

/**
 * **题面点名了一个点、而计划里根本没有这个对象** —— 系统兜底补建（2026-10-10 设计 §四）。
 *
 * 现场（用户这台机器上的真实运行，7 次、逐字相同的失败报文）：模型交了一笔
 * `solid.create_polyhedron`（A/B/C/D），题面里的 `O为 BD的中点` 由**系统自己**抽成题设，
 * 而点 `O` 在图上不存在 ⇒ 那条题设永远无法核验 ⇒ 门禁判 `failed`，整轮不提交。
 *
 * 这几条用例钉的就是那一步：**系统按题设把它建出来**，而判据一律**读编译后的文档坐标自己算**
 * ——不读面板结论、不读计划里写了什么。
 */

const O_PROMPT = "在三棱锥 A-BCD中，平面 ABD⊥平面 BCD，且 AB=AD，O为 BD的中点。"
const RATIO_PROMPT = "在三棱锥 A-BCD中，AB=AD，DE=2EA。"

/** A=(0,0,1) B=(-1,0,0) C=(0,1,0) D=(1,0,0)：`AB=AD`、`平面ABD⊥平面BCD` 都成立（既有用例实测）。 */
const TETRA_POSITIONS: Vector3[] = [
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 0, z: 0 }
]
const TETRA_FACES = [
  [0, 1, 2],
  [0, 3, 1],
  [0, 2, 3],
  [1, 3, 2]
]

/** 模型会交的那一份：**一笔多面体**，别的什么都没有。 */
function polyhedronPlan(vertexNames: readonly string[] | null): PlanEnvelope {
  const inputs = { alias: "solid", vertices: TETRA_POSITIONS, faces: TETRA_FACES, ...(vertexNames === null ? {} : { vertexNames }) }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画示意图",
    factIds: [],
    actions: [{ actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [], inputs }]
  } as unknown as PlanEnvelope
}

function compile(plan: unknown, prompt: string, document: GeometryDocument = createEmptyDocument("geometry3d")): PlanCompileResult {
  return compilePlan(plan, { document, prompt, conversationId: "named-points", documentGeneration: document.revision })
}

/**
 * **Task 10（2026-10-12）：`AE:AD = 2:5` 这种"部分比整体"的写法以前根本补不出来。**
 *
 * 上面那条 `DE=2EA` 是**部分比部分**（两条线段共用一个端点，而那个端点就是未知点本身），
 * 旧实现只认这一种；而用户那句题面写的偏偏是 **`AE:AD = 2:5`**（部分比整体），
 * 解析出来是 `[A,E,A,D]` —— 未知点只出现一次，锚是**已知点** `A`。旧实现要求
 * "未知点恰好落在第 1、2 位"，于是这一条整批不补，`E` 从来不在图上。
 *
 * 判据照这一族的老规矩：**读编译后的文档坐标自己算**，不读面板结论、不读计划里写了什么。
 *
 * > **这一组用例曾经丢过一次**（2026-10-12）：我用 PowerShell 直接改文件，把整份文件的中文写成了
 * > 乱码，`git checkout` 恢复时把我刚加的三条一起丢了。重加时改用编辑工具（UTF-8 安全）。
 */
describe("Task 10 — 部分比整体的分点也能补出来", () => {
  const PART_WHOLE_PROMPT = "在三棱锥 A-BCD中，AB=AD，AE:AD=2:5。"

  it("materialises E on AD from AE:AD = 2:5, and the landed coordinates satisfy it", () => {
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), PART_WHOLE_PROMPT)

    expect(result.ok, result.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    const document = result.draftDocument
    if (document === null) throw new Error("expected a draft document")

    const a = labelled(document, "A")
    const d = labelled(document, "D")
    // 系统补出来的那一笔（图上原先只有 A/B/C/D 四个顶点）。
    const e = labelled(document, "E")

    // 自己算：E 在 AD 上，且 AE/AD = 2/5。
    expect(distance(a, e) / distance(a, d)).toBeCloseTo(2 / 5, 9)
    // **在**线段上（不是延长线上）：E 到 A、D 的距离之和等于 AD。
    expect(distance(a, e) + distance(e, d)).toBeCloseTo(distance(a, d), 9)
  })

  /**
   * **补出来的点是一个"派生对象"，不是一组写死的坐标**（计划 Task 10："非模型手写点坐标"）。
   *
   * 判据落在**编译后的文档**上：那个点带着 `onHost` 绑定 + 一个**无量纲**参数，宿主是那条棱本身。
   * 也就是说"`E` 在 `AD` 的 2/5 处"记的是**比例**，不是两个数。
   *
   * **诚实边界**：这条证明的是"定义是派生的、参数是无量纲的"，**不是**"我亲眼看见它跟着宿主动了" ——
   * 后者要一条依赖重算的读数，本任务没做（见 CHANGELOG 的"仍未做"）。
   */
  it("leaves the materialised E as a derived object carrying a dimensionless parameter", () => {
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), PART_WHOLE_PROMPT)
    expect(result.ok, result.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    const document = result.draftDocument
    if (document === null) throw new Error("expected a draft document")

    const point = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "E")
    const binding = (point as { binding?: { kind?: string; parameter?: number; hostId?: string } } | undefined)?.binding

    expect(binding?.kind, "补出来的点必须是**派生**的（onHost），不是一组写死的坐标").toBe("onHost")
    expect(binding?.parameter).toBeCloseTo(2 / 5, 9)
    // 宿主是**那条棱**（宿主实体下的棱 id），所以"2/5"永远相对于当前那条棱。
    expect(typeof binding?.hostId).toBe("string")
  })

  /**
   * **两条题设给同一个点算出两个不同的位置**（计划 Task 10 的 RED 最后一条）。
   *
   * `AE:AD = 2:5` ⇒ `E` 在 `AD` 的 2/5 处；`AE:ED = 3:1` ⇒ `E` 在 `AD` 的 3/4 处。
   * 两条都点名 `E`，而它们**不相容**。合理的处置只有一种：**拒绝**。
   * 静默挑一个（后者覆盖前者）或造出两个都叫 `E` 的点都是错的 ——
   * 前者是替用户改了题，后者是让点名表指到两个不同的位置。
   *
   * **先红读数**（改动之前）：`expected true to be false` —— 那时这一轮**编译成功**，
   * 而 `E` 一个都没落到图上，用户看到的是一段"没有报错、但题设未核验"的运行。
   */
  it("refuses two premises that place the same name at incompatible positions", () => {
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), "在三棱锥 A-BCD中，AB=AD，AE:AD=2:5，AE:ED=3:1。")

    expect(result.ok).toBe(false)
    const text = (result.diagnostics ?? []).map((item) => `${item.code} ${item.detail}`).join(" ")
    // **说清是哪一条不相容** —— 只说"失败"等于没说。
    expect(text, `今天的诊断是：${text}`).toMatch(/E/)
    expect(text, `今天的诊断是：${text}`).toMatch(/不相容|冲突|conflict/)
  })
})

/** 按**标签**从编译后的文档里取点（文档里没有这个名字就抛，免得断言静默跳过）。 */
function labelled(document: GeometryDocument, label: string): Vector3 {
  const found = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
  if (found?.type !== "point3") throw new Error(`候选图里没有点名 ${label}；现有标签：${JSON.stringify(document.primitives.flatMap((p) => (p.type === "point3" ? [(p as { label?: unknown }).label] : [])))}`)
  return found.position
}

const distance = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const statusOf = (result: PlanCompileResult, sourceText: string) =>
  result.diagramVerification?.checks.find((check) => check.sourceText.includes(sourceText))?.status

describe("题面点名的点由系统兜底补建", () => {
  it("「O为 BD的中点」+ 只有一笔多面体 ⇒ 系统把 O 建出来，且它真的落在 BD 的中点上", () => {
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), O_PROMPT)

    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.ok).toBe(true)
    const document = result.draftDocument
    if (document === null) throw new Error("补建之后必须真的有候选文档")

    const o = labelled(document, "O")
    const b = labelled(document, "B")
    const d = labelled(document, "D")
    // 判据自己算：到两端等距，且落在线段上（不是"在 BD 那条直线的延长线上"）。
    expect(distance(o, b)).toBeCloseTo(distance(o, d), 10)
    expect(distance(b, o) + distance(o, d)).toBeCloseTo(distance(b, d), 10)
  })

  it("补建这件事**必须显形**：一句人话进 assumptions，真实动作回写 materialisedActions", () => {
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), O_PROMPT)

    const assumption = result.assumptions.find((entry) => entry.id.startsWith("materialised."))
    expect(assumption?.text).toContain("O")
    expect(assumption?.text).toContain("BD")
    expect(result.materialisedActions?.some((action) => action.actionId === "dynamic.create_bound_point")).toBe(true)
  })

  it("比例分点：`DE=2EA` ⇒ 补出来的 E 满足 DE/EA = 2（测试按坐标自己算）", () => {
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), RATIO_PROMPT)

    expect(result.diagramVerification?.status).toBe("passed")
    const document = result.draftDocument
    if (document === null) throw new Error("补建之后必须真的有候选文档")

    const d = labelled(document, "D")
    const e = labelled(document, "E")
    const a = labelled(document, "A")
    expect(distance(e, a)).toBeGreaterThan(1e-9)
    expect(distance(d, e) / distance(e, a)).toBeCloseTo(2, 9)
  })

  it("**没写 `vertexNames` 就不补**：名字对不上任何顶点，宁可如实未核验", () => {
    const result = compile(polyhedronPlan(null), O_PROMPT)

    expect(result.diagramVerification?.status).toBe("unverified")
    expect(Object.hasOwn(result, "materialisedActions")).toBe(false)
    expect(result.draftDocument?.primitives.some((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "O") ?? false).toBe(false)
  })

  it("**计划里没有多面体就不补**：没有可绑的宿主", () => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "画示意图",
      factIds: [],
      actions: [{ actionId: "solid.create_tetrahedron", actionKey: "tetra", factIds: [], inputs: { alias: "tetra", edge: 2 } }]
    }
    const result = compile(plan, O_PROMPT)

    expect(Object.hasOwn(result, "materialisedActions")).toBe(false)
    expect(result.draftDocument?.primitives.some((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "O") ?? false).toBe(false)
  })

  it("**图上已经有一个 O（位置不对）就不补第二个**：如实拒绝，不许拿系统新点盖过去", () => {
    const base = createEmptyDocument("geometry3d")
    base.primitives.push({ id: "base-o", type: "point3", position: { x: 5, y: 5, z: 5 }, label: "O" })
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), O_PROMPT, base)

    expect(statusOf(result, "O为")).toBe("failed")
    expect(Object.hasOwn(result, "materialisedActions")).toBe(false)
  })

  it("**要么全补、要么不补**：一条能补（`O`）、一条补不了（`AX`）⇒ 一个都不补", () => {
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), "在三棱锥 A-BCD中，AB=AD，AX=AB，O为 BD的中点。")

    expect(Object.hasOwn(result, "materialisedActions")).toBe(false)
    expect(result.draftDocument?.primitives.some((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "O") ?? false).toBe(false)
  })

  it("**核验的理由要说清缺谁**：补不了的那一类（题设点到一个图上没有的点）理由里必须出现那个名字", () => {
    // `AX=AB` 是等长——**不是**系统会补的两种构造之一，所以这一条补不了；
    // 而它缺的名字是 `X`，理由必须把它说出来，不能只说"点名缺失、图形退化或角度无法计算"。
    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), "在三棱锥 A-BCD中，AB=AD，AX=AB。")

    expect(statusOf(result, "AX")).toBe("unverified")
    const reason = result.diagramVerification?.checks.find((check) => check.sourceText.includes("AX"))?.reason ?? ""
    expect(reason).toContain("X")
    expect(reason).toContain("点名缺失")
    // 补不了就一个都不补（"要么全补、要么不补"）。
    expect(Object.hasOwn(result, "materialisedActions")).toBe(false)
  })

  it("**三维图里的平面点不算数**：它顶不掉题设核验，也不该让系统什么都不建（用户现场）", () => {
    /**
     * 现场（2026-10-10，桌面端 3.3.1）：对象树里有 `O`、属性栏也认它，但**画布上永远看不见**、
     * 也点不中；底部还提示"空间直线需要 2 个空间点，当前 0 个"。
     *
     * 真因：那个 `O` 是一个**平面点**（属性栏显示的是「点坐标 + 创建动圆」那一套，而不是
     * 「空间点坐标 + 宿主绑定」）—— 三维画布只画 `point3`，而核验的点名表却**把 2D 点按 `z = 0`
     * 也收了进来**（V0b 为平面图形加的那一支）。于是"O为 BD 的中点"被这个平面点**满足**了
     * ⇒ 兜底补建根本没触发 ⇒ 图上没有那个点。
     *
     * 判据：三维文档里平面点不进点名表 ⇒ 名字缺失 ⇒ 系统按题设补建一个**空间点** `O`。
     */
    const base = createEmptyDocument("geometry3d")
    base.primitives.push({ id: "planar-o", type: "point", x: 0, y: 0, label: "O" })

    const result = compile(polyhedronPlan(["A", "B", "C", "D"]), O_PROMPT, base)

    expect(result.diagramVerification?.status).toBe("passed")
    const document = result.draftDocument
    if (document === null) throw new Error("补建之后必须真的有候选文档")
    const spatial = document.primitives.filter((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "O")
    expect(spatial).toHaveLength(1)
  })
})

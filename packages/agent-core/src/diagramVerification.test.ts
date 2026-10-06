import { createEmptyDocument } from "@draw/dsl"
import type { Vector3 } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"
import { verifyDiagramObligations } from "./diagramVerification"

const prompt = "在三棱锥 A-BCD 中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证 OA⊥CD"
const names = ["A", "B", "C", "D", "O", "E"]
// A=(0,0,1) gives the interior dihedral E-BC-D 45°. A=0.64 gives ~32.62°.
function positions(height = 1): Vector3[] {
  return [
    { x: 0, y: 0, z: height },
    { x: -1, y: 0, z: 0 },
    { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 1 / 3, y: 0, z: 2 * height / 3 }
  ]
}
function fixture(height = 1, vertexNames: string[] | null = names) {
  const vertices = positions(height)
  const inputs = { alias: "solid", vertices, faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]], ...(vertexNames ? { vertexNames } : {}) }
  const plan: PlanEnvelope = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画示意图", factIds: [], actions: [{ actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [], inputs }] }
  const candidate = createEmptyDocument("geometry3d")
  candidate.primitives.push(...vertices.map((position, i) => ({ id: `solid-v${i}`, type: "point3" as const, position })))
  candidate.primitives.push({ id: "solid", type: "polyhedron3", vertexIds: vertices.map((_, i) => `solid-v${i}`), edgeIds: [], faceIds: [] })
  return { plan, candidate }
}

describe("verifyDiagramObligations", () => {
  it("accepts a non-unique yet condition-valid static diagram without claiming a general proof", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
    expect(report.status).toBe("passed")
    expect(report.checks.map((item) => item.status)).toEqual(Array(7).fill("passed"))
    expect(report.checks.map((item) => item.sourceText)).not.toContain("OA⊥CD")
  })

  /**
   * **带 label 的点也要进点名表**（2026-10-05，用户报的现场）。
   *
   * `candidatePoints` 原先**只**从 `solid.create_polyhedron` 的 `vertexNames` 建点名表。
   * 于是**任何由别的动作创建的点**在核验里**根本不存在** —— 哪怕文档里明明有一个
   * `label:"O"`、坐标正落在中点的点（实测：`dynamic.create_bound_point` 能把 O 放到 BD 的中点，
   * 而核验仍然报"O为 BD的中点：点名缺失…未核验"）。**根源不在题面，在点名表只认一种动作。**
   *
   * 三条判据一起定死语义：
   * 1. 带 label 的点**要能被点名**；
   * 2. **同一个名字出现两次 ⇒ 不猜**（该名字缺失，依赖它的题设如实未核验）；
   * 3. **顶点名优先**：另有一个点也叫 B 时，不许顶掉从 `vertexNames` 来的那个 B。
   */
  const TETRA_POSITIONS = [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }]
  // A=(0,0,1) B=(-1,0,0) C=(0,1,0) D=(1,0,0)：AB=AD，且平面 ABD ⊥ 平面 BCD（两条实测都 passed）。
  const TETRA_ACTIONS = [{ actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [], inputs: { alias: "solid", vertices: TETRA_POSITIONS, faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]], vertexNames: ["A", "B", "C", "D"] } }]
  const TETRA_PLAN = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画示意图", factIds: [], actions: TETRA_ACTIONS } as unknown as PlanEnvelope
  const O_PROMPT = "在三棱锥 A-BCD中，平面 ABD⊥平面 BCD，且 AB=AD，O为 BD的中点。"

  function tetraCandidate(extra: { id: string; label?: string; position: Vector3 }[] = []) {
    const candidate = createEmptyDocument("geometry3d")
    candidate.primitives.push(...TETRA_POSITIONS.map((position, i) => ({ id: `solid-v${i}`, type: "point3" as const, position })))
    candidate.primitives.push({ id: "solid", type: "polyhedron3", vertexIds: TETRA_POSITIONS.map((_, i) => `solid-v${i}`), edgeIds: [], faceIds: [] })
    candidate.primitives.push(...extra.map((point) => ({ id: point.id, type: "point3" as const, position: point.position, ...(point.label === undefined ? {} : { label: point.label }) })))
    return candidate
  }

  const oStatus = (report: ReturnType<typeof verifyDiagramObligations>) => report.checks.find((check) => check.sourceText.includes("O为"))?.status

  it("由**别的动作**建出来的点（带 label）也能被点名：O 落在 BD 中点 ⇒ 这条题设通过", () => {
    const report = verifyDiagramObligations(parseDiagramObligations(O_PROMPT), TETRA_PLAN, tetraCandidate([{ id: "point3-1", label: "O", position: { x: 0, y: 0, z: 0 } }]))

    expect(oStatus(report)).toBe("passed")
  })

  it("**点名重名时不许猜**：两个点都叫 O ⇒ 如实未核验（fail-closed，不挑一个）", () => {
    const report = verifyDiagramObligations(parseDiagramObligations(O_PROMPT), TETRA_PLAN, tetraCandidate([
      { id: "point3-1", label: "O", position: { x: 0, y: 0, z: 0 } },
      { id: "point3-2", label: "O", position: { x: 0.5, y: 0, z: 0 } }
    ]))

    expect(oStatus(report)).toBe("unverified")
  })

  it("**顶点名优先**：另有一个点也叫 B，不许顶掉从 `vertexNames` 来的那个 B", () => {
    const report = verifyDiagramObligations(parseDiagramObligations(O_PROMPT), TETRA_PLAN, tetraCandidate([{ id: "point3-1", label: "B", position: { x: 0, y: 0, z: 0 } }]))

    // B 仍是 (-1,0,0)：AB=AD 照旧通过（若被那个 label 顶掉，这条会变成未核验或失败）。
    expect(report.checks.find((check) => check.sourceText.includes("AB=AD"))?.status).toBe("passed")
  })

  /**
   * **端到端：这才是用户那条题缺的那一步**（2026-10-05）。
   *
   * 两笔动作 —— 用顶点 + 面环造出棱锥，再用 `dynamic.create_bound_point` 把 O 绑在
   * **第 4 条棱**（本题是 BD，下标从 0 数：e0..e5 由 `faces` 定序）上、`parameter: 0.5`（中点）——
   * 然后拿**同一份信封**去核验："O为 BD的中点"应当 **passed**。
   *
   * 这条用例同时钉住三件事：动作能编译出点、点带 label、核验认得它。缺一件它都不绿。
   */
  it("端到端：实体 + 绑在 BD 中点的 O（parameter 0.5）⇒ 「O为 BD的中点」通过", () => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画示意图", factIds: [],
      actions: [
        TETRA_ACTIONS[0],
        { actionId: "dynamic.create_bound_point", actionKey: "bound", factIds: [], inputs: { alias: "O", host: { scope: "draft", alias: "solid" }, hostSub: 4, parameter: 0.5, label: "O" } }
      ]
    } as never

    const compiled = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: O_PROMPT, conversationId: "test", documentGeneration: 0 })

    expect(compiled.ok, JSON.stringify(compiled).slice(0, 700)).toBe(true)
    const report = verifyDiagramObligations(parseDiagramObligations(O_PROMPT), plan, compiled.draftDocument!)
    expect(oStatus(report)).toBe("passed")
  })

  it("detects the wrong dihedral even when the other six conditions hold", () => {
    const { plan, candidate } = fixture(0.64)
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
    expect(report.status).toBe("failed")
    expect(report.checks.filter((item) => item.status === "failed").map((item) => item.kind)).toEqual(["dihedral"])
    expect(report.checks.find((item) => item.kind === "dihedral")).toMatchObject({ expected: 45, actual: expect.closeTo(32.619, 2) })
  })

  it("reports an explicit free point as an example rather than inventing a given length", () => {
    const { plan, candidate } = fixture()
    const set = parseDiagramObligations("在三棱锥A-BCD中，BD=2，任取点A，画一张示意图")
    const report = verifyDiagramObligations(set, plan, candidate)
    expect(report.status).toBe("passed")
    expect(report.sampleValues).toEqual(["自由点 A 采用示例坐标 (0, 0, 1)"])
  })
  it("checks a four-point plane against a three-point plane without dropping a vertex", () => {
    const { plan, candidate } = fixture()
    const parsed = parseDiagramObligations("在三棱锥A-BCD中，平面ABDE⊥平面BCD，画示意图")
    expect(verifyDiagramObligations(parsed, plan, candidate).checks[0].status).toBe("passed")
    const point = candidate.primitives.find((item) => item.id === "solid-v5")
    if (point?.type !== "point3") throw new Error("missing E")
    point.position.y = 1
    expect(verifyDiagramObligations(parsed, plan, candidate).checks[0].status).toBe("unverified")
  })
  it("reads the candidate document, not stale vertices from the model plan", () => {
    const { plan, candidate } = fixture()
    const point = candidate.primitives.find((item) => item.id === "solid-v3")
    if (point?.type !== "point3") throw new Error("missing point")
    point.position.x = 1.5
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
    expect(report.checks.find((item) => item.kind === "fixedLength")?.status).toBe("failed")
  })

  it("returns unverified for absent or ambiguous names instead of guessing vertex order", () => {
    for (const vertexNames of [null, ["A", "B", "C", "D", "O", "O"]]) {
      const { plan, candidate } = fixture(1, vertexNames)
      const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate)
      expect(report.status).toBe("unverified")
      expect(report.checks.some((item) => item.status === "unverified")).toBe(true)
    }
  })

  it("verifies a newly staged solid even when the document already has another solid", () => {
    const { plan, candidate } = fixture()
    const base = createEmptyDocument("geometry3d")
    const existing = { id: "previous", type: "polyhedron3" as const, vertexIds: [], edgeIds: [], faceIds: [] }
    base.primitives.push(existing)
    candidate.primitives.unshift(existing)
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate, base)
    expect(report.status).toBe("passed")
  })
  it("does not interpret an unknown angle condition as a successful empty verification", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations("在△ABC中，∠ABC=60°，画出图形"), plan, candidate)
    expect(report.status).toBe("unverified")
    expect(report.checks[0].sourceText).toBe("∠ABC=60°")
  })
})


describe("V0a numeric coordinate judgement on materialized named points", () => {
  it("passes a stated coordinate only when the candidate really places that point there", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations("在三棱锥A-BCD中，A=(0,0,1)，画示意图", { spatialPointConditions: true }), plan, candidate)
    expect(report.status).toBe("passed")
    expect(report.checks).toEqual([expect.objectContaining({ kind: "pointCoordinate", sourceText: "A=(0,0,1)", status: "passed", expected: 0, actual: 0 })])
  })

  it("fails a wrong coordinate rather than letting an unrelated perpendicular claim hide it", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations("在三棱锥A-BCD中，A=(0,0,2)，画示意图", { spatialPointConditions: true }), plan, candidate)
    expect(report.status).toBe("failed")
    expect(report.checks[0]).toMatchObject({ kind: "pointCoordinate", sourceText: "A=(0,0,2)", status: "failed", expected: 0, actual: 1 })
  })
})

/**
 * **V0d：切线要按题面核验**（计划 `V0d 导数曲线`：`f(x) = x³ − 3x` 在 `x = 1` 处的切线）。
 *
 * ## 判据为什么不读图元里存的那个斜率
 *
 * 内核重算切线时会把 `slope` 填进图元。**拿它当判据就是拿系统自证** ——
 * 无论那条切线画在哪、斜率算成什么，它都"符合"自己写下的数。
 * 所以这里由**核验器自己**用中心差分数值求导，再与图元里的斜率比。
 *
 * 两个数都比：切点的**横坐标**，以及该点的**导数**。前者管"切在不在题面说的那个位置"，
 * 后者管"斜率对不对" —— 对 `x³ − 3x` 来说 `f′(1) = 0`（水平切线），
 * 而 `f′(2) = 9`；两者的区别正是"画对了"与"画在别处"。
 */
describe("V0d: tangent premises are checked against the function itself", () => {
  const TANGENT_PROMPT = "作函数在 x=1 处的切线，画示意图"

  /** `f(x) = x³ − 3x` 与它在 `x = touchX` 处的切线；`slope` 由调用方给，可以故意给错。 */
  function tangentFixture(touchX: number, slope: number) {
    const plan: PlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "画函数图与切线",
      factIds: [],
      actions: [
        { actionId: "function.create_graph", actionKey: "f", factIds: [], inputs: { alias: "f", expression: "x^3-3*x", domain: [-2, 2] } },
        { actionId: "function.create_tangent", actionKey: "t", factIds: [], inputs: { alias: "t", sourceId: "f", x: touchX } }
      ] as never
    }
    const candidate = createEmptyDocument("calculus")
    candidate.primitives.push({ id: "f", type: "function", expression: "x^3-3*x", domain: [-2, 2] })
    candidate.primitives.push({
      id: "t", type: "tangent", sourceId: "f", x: touchX,
      point: { x: touchX, y: touchX ** 3 - 3 * touchX },
      slope, a: { x: 0, y: 0 }, b: { x: 1, y: slope }, status: "approximate"
    })
    return { plan, candidate }
  }

  it("passes when the tangent really touches the curve at x = 1 with the slope f′(1) = 0", () => {
    const { plan, candidate } = tangentFixture(1, 0)
    const report = verifyDiagramObligations(parseDiagramObligations(TANGENT_PROMPT), plan, candidate)
    expect(report.checks.map((check) => `${check.sourceText}:${check.status}`)).toEqual(["x=1 处的切线:passed"])
    expect(report.status).toBe("passed")
  })

  it("fails when the stored slope is not the derivative the verifier computes itself", () => {
    // 斜率 3（就是 f′(2)）而题面要的是 x=1 处那条 —— 这是**另一条切线**。
    const { plan, candidate } = tangentFixture(1, 3)
    const report = verifyDiagramObligations(parseDiagramObligations(TANGENT_PROMPT), plan, candidate)
    expect(report.status).toBe("failed")
    expect(report.checks[0]).toMatchObject({ kind: "tangentAt", status: "failed" })
  })

  it("fails when the tangent touches the curve somewhere else entirely", () => {
    // 切在 x=2、斜率也对（f′(2) = 9），但那不是题面要的那条切线。
    const { plan, candidate } = tangentFixture(2, 9)
    const report = verifyDiagramObligations(parseDiagramObligations(TANGENT_PROMPT), plan, candidate)
    expect(report.status).toBe("failed")
  })

  it("reports unverified when the tangent has no source curve to differentiate", () => {
    // 没有来源就**算不出** f′(x)：这时必须如实说"未核验"，不许按"没有就跳过"处理成通过。
    const { plan, candidate } = tangentFixture(1, 0)
    candidate.primitives = candidate.primitives.filter((primitive) => primitive.type !== "function")
    const report = verifyDiagramObligations(parseDiagramObligations(TANGENT_PROMPT), plan, candidate)
    expect(report.status).toBe("unverified")
    expect(report.checks[0]).toMatchObject({ kind: "tangentAt", status: "unverified" })
  })
})

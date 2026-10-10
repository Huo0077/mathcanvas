import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { compilePlan } from "./planCompiler"

function pyramid(names: string[] | undefined = ["A", "B", "C", "D"]) {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画三棱锥示意图", factIds: [],
    actions: [{ actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [], inputs: {
      alias: "tetrahedron",
      vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: 1, y: 0, z: 0 }],
      faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
      ...(names ? { vertexNames: names } : {})
    } }]
  }
}

const context = (prompt: string) => ({ document: createEmptyDocument("geometry3d"), conversationId: "diagram-run", prompt })

describe("diagram acceptance in plan compilation", () => {
  it("keeps a condition-valid underdetermined diagram and a traceable verification report", () => {
    const compiled = compilePlan(pyramid(), context("在三棱锥A-BCD中，BD=2，AB=AD，画一张示意图"))
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.map((item) => item.sourceText)).toEqual(["BD=2", "AB=AD"])
  })

  it("refuses a wrong numeric given and offers the existing single repair", () => {
    const compiled = compilePlan(pyramid(), context("在三棱锥A-BCD中，BD=3，画一张示意图"))
    expect(compiled.ok).toBe(false)
    expect(compiled.diagnostics.some((item) => item.code === "diagram_condition_failed" && item.detail.includes("BD=3"))).toBe(true)
    expect(compiled.repair?.attempt).toBe(1)
  })

  it("compiles the complete real-task topology and checks all seven givens on materialized points", () => {
    const vertices = [
      { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
      { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1 / 3, y: 0, z: 2 / 3 }
    ]
    const plan = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画一张满足题设的示意图", factIds: [], actions: [{
      actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [], inputs: {
        alias: "pyramid", vertexNames: ["A", "B", "C", "D", "O", "E"], vertices,
        faces: [[1, 2, 3, 4], [0, 1, 4, 3, 5], [0, 1, 2], [0, 2, 3, 5]]
      }
    }] }
    const prompt = "在三棱锥A-BCD中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证OA⊥CD"
    const compiled = compilePlan(plan, context(prompt))
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.checks).toHaveLength(7)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.draftDocument?.primitives.some((item) => item.type === "polyhedron3")).toBe(true)

    const wrong = structuredClone(plan)
    wrong.actions[0].inputs.vertices[0].z = 0.64
    wrong.actions[0].inputs.vertices[5].z = 2 * 0.64 / 3
    const rejected = compilePlan(wrong, context(prompt))
    expect(rejected.ok).toBe(false)
    expect(rejected.diagnostics.some((item) => item.code === "diagram_condition_failed" && item.detail.includes("二面角E-BC-D=45°"))).toBe(true)
  })
  it("does not accuse a valid shape of wrong geometry when vertex order lacks names", () => {
    const original = [
      { x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }
    ]
    // Coordinates B and C are swapped, with face rings remapped to keep the same valid solid.
    const plan = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画四棱锥", factIds: [], actions: [{
      actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [], inputs: {
        alias: "pyramid", vertices: [original[0], original[1], original[3], original[2], original[4]],
        faces: [[1, 3, 2, 4], [0, 3, 1], [0, 2, 3], [0, 4, 2], [0, 1, 4]]
      }
    }] }
    const result = compilePlan(plan, context("在四棱锥P-ABCD中，PA⊥平面ABCD，BC∥AD，AB⊥AD，画示意图"))
    expect(result.ok, result.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(result.diagramVerification?.status).toBe("unverified")
    expect(result.diagnostics.some((item) => item.code === "relation_not_satisfied")).toBe(false)
  })
  /**
   * **平面上的数值角：这一支现在真的判得动**（§3-F，2026-10-10）。
   *
   * 原来这条钉的是"`∠ABC=60°` 读不懂 ⇒ 整份候选如实 `unverified`"。角读得懂之后，
   * 同一条用例必须**分成正反两半**，否则它守的那件事（不许把没核的东西说成通过）就没人守了：
   *
   * ① **图真的满足题面** ⇒ `passed`（这是新能力：这类题从"永远有一条未核验"变成可以提交）；
   * ② **图不满足** ⇒ `ok=false` + 诊断点名那条条件 —— 而且这**不是**"读不懂"，
   *    是"量出来不是 60°"，两者的用户文案完全不同。
   *
   * 夹具用同一个三棱锥：`B=(-1,0,0)`、`A=(0,0,1)`；`C` 取 `(0.5,1.5,0)` 时
   * `BA=(1,0,1)`、`BC=(1.5,1.5,0)` ⇒ `cos∠ABC = 1.5/(√2·1.5√2) = 0.5` ⇒ **正好 60°**；
   * 取原来的 `(0.5,√3/2,0)` 则是约 **52.24°**。
   */
  it("judges a stated planar angle on the figure, instead of leaving it unverified", () => {
    const sixty = pyramid()
    sixty.actions[0].inputs.vertices[2] = { x: 0.5, y: 1.5, z: 0 }
    const passed = compilePlan(sixty, context("在三棱锥A-BCD中，∠ABC=60°，画一张示意图"))
    expect(passed.diagramVerification?.status).toBe("passed")
    expect(passed.diagramVerification?.checks.map((item) => item.sourceText)).toEqual(["∠ABC=60°"])

    const wrong = compilePlan(pyramid(), context("在三棱锥A-BCD中，∠ABC=60°，画一张示意图"))
    expect(wrong.ok).toBe(false)
    expect(wrong.diagnostics.some((item) => item.code === "diagram_condition_failed" && item.detail.includes("∠ABC=60°"))).toBe(true)
  })

  it("retains a preview as unverified instead of declaring unsupported conditions passed", () => {
    // 样本换成**真正读不出来**的那一类（三角函数值不是角本身）：意图与原来一字不差。
    const compiled = compilePlan(pyramid(), context("在三棱锥A-BCD中，sin∠ABC=0.5，画一张示意图"))
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("unverified")
    expect(compiled.diagramVerification?.checks[0].sourceText).toBe("sin∠ABC=0.5")
  })
})

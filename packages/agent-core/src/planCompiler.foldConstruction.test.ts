import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **折片题的规范重建**（2026-10-19，稳定性复跑）：模型只交了一张四边形，没有 fold；
 * 系统应当用平面见证坐标 + 题面比例 + 折角反求重建整张图，而不是等模型把结构写对。
 */
const PROMPT = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。"

function incompletePlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "只有四边形",
    factIds: [],
    actions: [{
      actionId: "solid.create_face",
      actionKey: "quad",
      factIds: [],
      inputs: {
        alias: "quad",
        vertexNames: ["A", "B", "C", "D"],
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 10.098, y: 6.83, z: 0 }, { x: 7.5, y: 4.3301, z: 0 }]
      }
    }]
  }
}

describe("fold construction rescue", () => {
  it("rebuilds the quad, hinges, fold and solved angle from the prompt", () => {
    const compiled = compilePlan(incompletePlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "fold-construction",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldConstruction")).toBe(true)
  })

  /**
   * **T5.8（2026-10-24）**：同一条题在**默认配置**（不打开实验性的 `diagramWitnessSearch`）
   * 下也必须走通同一条确定性构造 —— 这正是执行任务书 E7 的现场：
   * 开关关着时 `ok=false`，而用户看到的是"系统不支持翻折"。
   */
  it("reaches the same construction on the default configuration", () => {
    const compiled = compilePlan(incompletePlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "fold-construction-default",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldConstruction")).toBe(true)
  })

  /**
   * **换点名的同一道题**（T5 验收）：A/B/C/D→P/Q/R/S、E/F→M/N、折后点 P→T。
   *
   * 注意 `∠BAD`（顶点 A，两条边 BA、AD）必须换成 `∠QPS`（顶点 P，两条边 QP、PS）——
   * 第一版我写成了 `∠PQR`，那不是换名而是**换了一道题**，搜不到候选是对的。
   */
  it("works after renaming every point consistently", () => {
    const renamed = "平面四边形 PQRS 中，PQ=8，RS=3，PS=5√3，∠PSR=90°，∠QPS=30°。点 M,N 满足 PM=2/5 PS，PN=1/2 PQ。将 △PMN 沿 MN 翻折至 △TMN，使得 TR=4√3。"
    const plan = incompletePlan()
    const action = plan.actions[0] as Extract<PlanEnvelope, { kind: "plan" }>["actions"][number] & { inputs: { vertexNames: string[] } }
    action.inputs.vertexNames = ["P", "Q", "R", "S"]

    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      prompt: renamed,
      conversationId: "fold-construction-renamed",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldConstruction")).toBe(true)
  })

  /** **整体尺度 ×2**（T5 验收）：同一条题，长度全部乘 2，折后距离同步放大。 */
  it("works after scaling the whole figure by two", () => {
    const scaled = "平面四边形 ABCD 中，AB=16，CD=6，AD=10√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。将 △AEF 沿 EF 翻折至 △PEF，使得 PC=8√3。"
    const compiled = compilePlan(incompletePlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: scaled,
      conversationId: "fold-construction-scaled",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
  })
})

/**
 * **T6（2026-10-24）：明确角度的两次顺序折叠**
 *
 * 与单折那条同一族底图：四边形 + AEF 折片。第二条折叠折的是**第一次折后**的 △PEF，
 * 折痕 PF（P 是第一次折出来的点），折角 90°/60° 都由题面明确给出。
 */
describe("sequential fold chain construction", () => {
  const CHAIN_PROMPT = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。先将 △AEF 沿 EF 翻折 90° 至 △PEF，再将 △PEF 沿 PF 折叠 60° 至 △QPF。"

  it("emits two ordered folds, the second one hinged on the point the first one produced", () => {
    const compiled = compilePlan(incompletePlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: CHAIN_PROMPT,
      conversationId: "fold-chain",
      documentGeneration: 0
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    const folds = compiled.actions.filter((action) => action.actionId === "solid.fold")
    expect(folds).toHaveLength(2)
    expect(folds[0]!.inputs).toMatchObject({ apex: "A", apexAs: "P", angle: 90 })
    // 第二次折的是折后的面：折痕一端是第一次产出的 P，顶点是 E，折后是 Q。
    expect(folds[1]!.inputs).toMatchObject({ apex: "E", apexAs: "Q", hinge: { from: "P", to: "F" }, angle: 60 })
  })

  /**
   * **反例（不许吞题设）**：同一句话去掉两个折角且不补终态条件 ⇒ 联立系统欠定，
   * 这时**不许**只按第一条补折然后报通过 —— 那样用户拿到的是少折了一刀的图。
   */
  it("refuses to fold only the first of two folds when the second angle is unknown", () => {
    const chainWithoutAngles = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。先将 △AEF 沿 EF 翻折至 △PEF，再将 △PEF 沿 PF 翻折至 △QPF。"
    const compiled = compilePlan(incompletePlan(), {
      document: createEmptyDocument("geometry3d"),
      prompt: chainWithoutAngles,
      conversationId: "fold-chain-unknown-angle",
      documentGeneration: 0
    })

    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.foldConstruction")).toBe(false)
    expect(compiled.actions.filter((action) => action.actionId === "solid.fold")).toHaveLength(0)
  })
})

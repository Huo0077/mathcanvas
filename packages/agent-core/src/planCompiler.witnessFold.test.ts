import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **见证坐标 + 折角反求必须接上**（2026-10-17 用户现场，run-3-mvcbg81p）。
 *
 * 现场：模型交了一份结构正确的计划（平面四边形 + bound point E/F + 折片），但
 * A–D 是手算的、折片坐标与折角也是手写的 —— 于是 CD / AD / 两个角 / AE 比 / PC 全部实测不符，
 * 且 `fold_not_rigid`（PE≠AE）。
 *
 * 系统其实有两套现成能力：
 * 1. 平面图形见证搜索（按题面五条条件构造 A–D）；
 * 2. 折角反求（按 `PC=4√3` 解折角）。
 * 修之前它们各自只认**模型原来那份坐标**，所以拼不到一起。这里钉住：给一份**坐标全错**的
 * 计划，`compilePlan` 仍能救回并通过全部八条题设。
 */
const PROMPT = "平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点 E,F 满足 AE=2/5 AD，AF=1/2 AB。将 △AEF 沿 EF 翻折至 △PEF，使得 PC=4√3。画立体图形"

function wrongPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  // 现场那份坐标（C、D、E、F 都是错的；fold 的顶点与角度也是手写的）。
  const A = { x: 0, y: 0, z: 0 }
  const B = { x: 8, y: 0, z: 0 }
  const C = { x: 6.20101, y: 5.74139, z: 0 }
  const D = { x: 7.5, y: 4.33013, z: 0 }
  const E = { x: 3, y: 1.73205, z: 0 }
  const F = { x: 4, y: 0, z: 0 }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "平面四边形 + 翻折片（坐标故意写错）",
    factIds: [],
    actions: [
      { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D] } },
      /**
       * E / F 交给内核按定比分点算 —— 坐标**不经过模型**。见证搜索替换四边形之后，
       * 这两笔会跟着新的棱重新算。
       */
      { actionId: "dynamic.create_bound_point", actionKey: "ptE", factIds: [], inputs: { alias: "E", label: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5 } },
      { actionId: "dynamic.create_bound_point", actionKey: "ptF", factIds: [], inputs: { alias: "F", label: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 0.5 } },
      /**
       * 现场那条顺序问题：`PC` 线段排在折**之前**。见证救援后必须把它移到折之后，
       * 否则 `segment_reference_missing: P`。
       */
      { actionId: "solid.create_segment", actionKey: "segPC", factIds: [], inputs: { alias: "segPC", vertexNames: ["P", "C"] } },
      { actionId: "solid.fold", actionKey: "fold", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], vertices: [A, E, F], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 60 } }
    ]
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

function visibleFaceLabels(compiled: ReturnType<typeof compilePlan>): string[][] {
  const document = compiled.draftDocument
  if (document === null) return []
  const labels = new Map(
    document.primitives
      .filter((primitive) => primitive.type === "point3")
      .map((primitive) => [primitive.id, (primitive as { label?: unknown }).label])
  )
  return document.primitives
    .filter((primitive): primitive is Extract<typeof primitive, { type: "face3" }> => primitive.type === "face3")
    .map((face) => face.pointIds.map((id) => String(labels.get(id) ?? "")))
}

/** 用户截图那条：**平放的 AEF 不能还留在任何一张面里**；底面应是五边形 B-C-D-E-F。 */
function expectCornerWasCut(compiled: ReturnType<typeof compilePlan>): void {
  const faces = visibleFaceLabels(compiled)
  expect(faces.some((labels) => ["B", "C", "D", "E", "F"].every((name) => labels.includes(name))), JSON.stringify(faces)).toBe(true)
  expect(faces.every((labels) => !labels.includes("A")), JSON.stringify(faces)).toBe(true)
}

describe("见证坐标 + 折角反求（2026-10-17）", () => {
  it("模型给的 A–D 与折角都错，系统仍能救回并通过八条题设", () => {
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(wrongPlan(), {
      document,
      prompt: PROMPT,
      conversationId: "witness-fold-compose",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status, compiled.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}:${check.reason ?? ""}`).join("\n")).toBe("passed")
    // 两套救援都要留下“系统替你定了什么”的痕迹。
    expect(compiled.assumptions.some((assumption) => assumption.kind === "witness" && assumption.id === "witness.polyhedron")).toBe(true)
    expect(compiled.assumptions.some((assumption) => assumption.id === "solved-fold-angle.P")).toBe(true)
    // 折后 P 真的满足 PC=4√3。
    const p = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "P")
    const c = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "C")
    expect(p?.type).toBe("point3")
    expect(c?.type).toBe("point3")
    if (p?.type !== "point3" || c?.type !== "point3") return
    expect(Math.hypot(p.position.x - c.position.x, p.position.y - c.position.y, p.position.z - c.position.z)).toBeCloseTo(4 * Math.sqrt(3), 6)
    expectCornerWasCut(compiled)
  })

  /**
   * 现场最后那版计划可能**连 `solid.fold` 都没有**（P 是手写的）。这条钉住：
   * 坐标替换之后，`rescueWithSynthesisedFold` 会按题面把折补上，再解折角。
   */
  it("计划里连折都没有时，也在替换后的坐标上补折并解角", () => {
    /**
     * 现场最后一版就是这个形状：`PC` 线段**排在折之前**，而折甚至根本没有。
     * 补折必须插在这条线段**之前**，否则 `segment_reference_missing: P`。
     */
    const withoutFold = {
      ...wrongPlan(),
      actions: wrongPlan().actions.filter((action) => action.actionId !== "solid.fold")
    }
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(withoutFold, {
      document,
      prompt: PROMPT,
      conversationId: "witness-synthesised-fold",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.assumptions.some((assumption) => assumption.id === "synthesised-fold.P")).toBe(true)
    // 补上来的那笔先取 90°；这道题的 90° 恰好就是解，所以不一定再走“反求”。
    const p = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === "P")
    expect(p?.type).toBe("point3")
    expectCornerWasCut(compiled)
  })

  /**
   * 模型坐标**本来就对**时不会走见证救援，但 `solid.fold` 仍然只追加折片。
   * 默认路径也必须把角剪掉（否则视觉上还是“四边形 + 尖片”）。
   */
  it("坐标本来就对时，默认路径也会把角剪掉", () => {
    const A = { x: 0, y: 0, z: 0 }
    const B = { x: 8, y: 0, z: 0 }
    const C = { x: 9, y: Math.sqrt(3), z: 0 }
    const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }
    const E = { x: 3, y: Math.sqrt(3), z: 0 }
    const F = { x: 4, y: 0, z: 0 }
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "正确坐标 + 折片",
      factIds: [],
      actions: [
        { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D] } },
        { actionId: "dynamic.create_bound_point", actionKey: "ptE", factIds: [], inputs: { alias: "E", label: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5 } },
        { actionId: "dynamic.create_bound_point", actionKey: "ptF", factIds: [], inputs: { alias: "F", label: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 0.5 } },
        { actionId: "solid.fold", actionKey: "fold", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], vertices: [A, E, F], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 90 } }
      ]
    } as unknown as Extract<PlanEnvelope, { kind: "plan" }>

    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "cut-without-witness",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    // 没有走坐标救援（模型坐标已经对），但角仍然被剪掉。
    expect(compiled.assumptions.some((assumption) => assumption.id === "witness.polyhedron")).toBe(false)
    expectCornerWasCut(compiled)
  })

  it("线段排在建点之前时，自动后移而不是整轮失败", () => {
    const A = { x: 0, y: 0, z: 0 }
    const B = { x: 8, y: 0, z: 0 }
    const C = { x: 9, y: Math.sqrt(3), z: 0 }
    const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }
    const E = { x: 3, y: Math.sqrt(3), z: 0 }
    const F = { x: 4, y: 0, z: 0 }
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "线段 EF 排在建点之前",
      factIds: [],
      actions: [
        { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D] } },
        { actionId: "solid.create_segment", actionKey: "segEF", factIds: [], inputs: { alias: "EF", vertexNames: ["E", "F"] } },
        { actionId: "dynamic.create_bound_point", actionKey: "ptE", factIds: [], inputs: { alias: "E", label: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5 } },
        { actionId: "dynamic.create_bound_point", actionKey: "ptF", factIds: [], inputs: { alias: "F", label: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 0.5 } },
        { actionId: "solid.fold", actionKey: "fold", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 90 } }
      ]
    } as unknown as Extract<PlanEnvelope, { kind: "plan" }>

    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      prompt: PROMPT,
      conversationId: "reorder-segment",
      documentGeneration: 0,
      diagramWitnessSearch: true
    })

    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expectCornerWasCut(compiled)
  })
})

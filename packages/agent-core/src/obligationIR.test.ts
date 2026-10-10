import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import { buildObligationIR, parseObligationIR, toLegacyObligationSet } from "./obligationIR"

/**
 * 用**当前真实题面**（`diagramVerification.test.ts` 的同一道三棱锥题）钉住 IR：
 * IR 若只在小用例上成立，一旦回到代表题就会在"来源区间 / 判定力 / 角色"上分叉。
 */
const PYRAMID_PROMPT = "在三棱锥 A-BCD 中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证 OA⊥CD"

describe("parseObligationIR", () => {
  it("assigns given/goal/free_choice roles to the real pyramid problem with traceable source ranges", () => {
    const ir = parseObligationIR(PYRAMID_PROMPT)
    expect(ir.obligations.filter((item) => item.role === "given").map((item) => item.kind)).toEqual([
      "fixedLength", "equilateral", "equalLength", "midpoint", "segmentRatio", "planePerpendicular", "dihedral"
    ])
    expect(ir.obligations.filter((item) => item.role === "goal").map((item) => [item.kind, item.targets])).toEqual([
      ["perpendicular", ["O", "A", "C", "D"]]
    ])
    expect(ir.obligations.filter((item) => item.role === "free_choice")).toEqual([])
    for (const item of ir.obligations) {
      // 目标句的区间本版拿不到（`buildObligationIR` 手上没有原话），题设必须能原样切回来。
      if (item.role !== "given") continue
      expect(PYRAMID_PROMPT.slice(item.start, item.end)).toBe(item.sourceText)
    }
    expect(ir.obligations.filter((item) => item.role === "given").every((item) => item.judgeability === "supported")).toBe(true)
    // 目标**认得出种类**，但现有核验器从不判定目标 —— 这两件事必须分开。
    expect(ir.obligations.filter((item) => item.role === "goal").every((item) => item.judgeability === "unsupported")).toBe(true)
    expect(ir.unverified).toEqual([])
  })

  it("preserves exact goal and free-choice source spans through the legacy adapter", () => {
    const prompt = "在三棱锥A-BCD中，任取点 A，BD=2。求证： OA⊥CD  "
    const legacy = parseDiagramObligations(prompt)
    const ir = buildObligationIR(legacy)
    const free = ir.obligations.find((item) => item.role === "free_choice")
    const goal = ir.obligations.find((item) => item.role === "goal")
    expect(free?.sourceText).toBe("任取点 A")
    expect(goal?.sourceText).toBe("OA⊥CD")
    for (const item of [free, goal]) {
      expect(item).toBeDefined()
      expect(prompt.slice(item!.start, item!.end)).toBe(item!.sourceText)
      expect(item!.end).toBeGreaterThan(item!.start)
    }
    expect(toLegacyObligationSet(ir)).toEqual(legacy)
    expect(parseObligationIR(prompt)).toEqual(ir)
  })

  it("keeps unknown provenance honest for a manually supplied legacy set", () => {
    const ir = buildObligationIR({ givens: [], goals: ["OA⊥CD"], freeChoices: ["A"], unverified: [] })
    expect(ir.obligations.map(({ start, end }) => [start, end])).toEqual([[0, 0], [0, 0]])
    expect(toLegacyObligationSet(ir)).toEqual({ givens: [], goals: ["OA⊥CD"], freeChoices: ["A"], unverified: [] })
  })
  /**
   * **平面数值角是"判得了的"**（§3-F，2026-10-10 更新）。
   *
   * 这条用例原名"keeps an unjudgeable angle as ambiguous instead of silently supported" ——
   * 拿 `∠ABC=60°` 当"判不了"的样本。现在它**判得了**（核验器能按坐标量出来），
   * 所以样本换成真正读不出来的那一类（`sin∠ABC=0.5`），**意图一字未改**：
   * 读不出来的东西不许被当成"支持"。
   */
  it("carries a planar numeric angle as a supported given, and keeps an unreadable one unverified", () => {
    const ir = parseObligationIR("在△ABC中，∠ABC=60°，画出图形")
    expect(ir.obligations.map((item) => [item.role, item.kind, item.targets, item.expected, item.judgeability])).toEqual([
      ["given", "planarAngle", ["A", "B", "C"], 60, "supported"]
    ])
    expect(ir.unverified).toEqual([])

    const unreadable = parseObligationIR("在△ABC中，sin∠ABC=0.5，画出图形")
    expect(unreadable.obligations).toEqual([])
    expect(unreadable.unverified.map((item) => item.sourceText)).toEqual(["sin∠ABC=0.5"])
  })

  it("carries an explicit free point as a free_choice obligation with no expected value", () => {
    const ir = parseObligationIR("在三棱锥A-BCD中，BD=2，任取点A，画一张示意图")
    expect(ir.obligations.map((item) => [item.role, item.kind, item.targets])).toEqual([
      ["given", "fixedLength", ["B", "D"]],
      ["free_choice", "freeChoice", ["A"]]
    ])
    expect(ir.obligations[1].expected).toBeUndefined()
  })

  it("expresses the numeric given as expected plus a tolerance, never as a bare string", () => {
    const item = parseObligationIR(PYRAMID_PROMPT).obligations[0]
    expect(item.expected).toBe(2)
    expect(item.tolerance).toEqual({ kind: "absolute", value: expect.any(Number) })
  })
})

describe("legacy compatibility of the obligation IR", () => {
  it("reproduces every legacy field of parseDiagramObligations from the IR", () => {
    const legacy = parseDiagramObligations(PYRAMID_PROMPT)
    const roundTripped = toLegacyObligationSet(parseObligationIR(PYRAMID_PROMPT))
    expect(roundTripped).toEqual(legacy)
  })

  it("gives the same IR whether it is built from a parsed set or from the prompt", () => {
    const legacy = parseDiagramObligations(PYRAMID_PROMPT)
    expect(buildObligationIR(legacy)).toEqual(parseObligationIR(PYRAMID_PROMPT))
  })

  it("keeps the existing verifyDiagramObligations signature working and keeps its report shape", () => {
    const legacy = parseDiagramObligations(PYRAMID_PROMPT)
    const report = verifyDiagramObligations(legacy, planOf(), candidateOf())
    expect(report.status).toBe("passed")
    expect(report.checks).toHaveLength(7)
    expect(report.checks.map((item) => item.sourceText)).toEqual(legacy.givens.map((item) => item.sourceText))
    // R6：IR 是"默认关闭的新能力"，所以不传选项时报告就是**旧形状**（没有那个字段）。
    expect(Object.keys(report).sort()).toEqual(["checks", "sampleValues", "status"])
  })

  it("attaches the same IR to the verification report once the caller switches it on", () => {
    const report = verifyDiagramObligations(parseDiagramObligations(PYRAMID_PROMPT), planOf(), candidateOf(), undefined, { obligationIR: true })
    expect(report.obligationIR).toEqual(parseObligationIR(PYRAMID_PROMPT))
    // 角色必须真的分得开：目标不会被当成"已核验的题设"。
    expect(report.obligationIR?.obligations.filter((item) => item.role === "goal").map((item) => item.sourceText)).toEqual(["OA⊥CD"])
    const goal = report.obligationIR?.obligations.find((item) => item.role === "goal")
    expect(PYRAMID_PROMPT.slice(goal!.start, goal!.end)).toBe("OA⊥CD")
  })
})

function planOf(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画示意图", factIds: [],
    actions: [{ actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [], inputs: {
      alias: "solid",
      vertexNames: ["A", "B", "C", "D", "O", "E"],
      vertices: [
        { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
        { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1 / 3, y: 0, z: 2 / 3 }
      ],
      faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
    } }]
  }
}

function candidateOf() {
  const candidate = createEmptyDocument("geometry3d")
  const vertices = [
    { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
    { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1 / 3, y: 0, z: 2 / 3 }
  ]
  candidate.primitives.push(...vertices.map((position, index) => ({ id: `solid-v${index}`, type: "point3" as const, position })))
  candidate.primitives.push({ id: "solid", type: "polyhedron3", vertexIds: vertices.map((_, index) => `solid-v${index}`), edgeIds: [], faceIds: [] })
  return candidate
}


describe("V0a coordinate obligation IR", () => {
  it("keeps a named point's full coordinate and original span through IR ↔ legacy", () => {
    const prompt = "在三棱锥D-ABC中，A=(0,0,0)，AD⊥平面ABC，画示意图"
    const legacy = parseDiagramObligations(prompt, { spatialPointConditions: true })
    const ir = buildObligationIR(legacy)
    const point = ir.obligations.find((item) => item.kind === "pointCoordinate")
    expect(point).toMatchObject({ role: "given", targets: ["A"], judgeability: "supported", geometry: { coordinate: { x: 0, y: 0, z: 0 } }, tolerance: { kind: "absolute", value: expect.any(Number) } })
    expect(point).toBeDefined()
    expect(prompt.slice(point!.start, point!.end)).toBe("A=(0,0,0)")
    expect(toLegacyObligationSet(ir)).toEqual(legacy)
  })
})

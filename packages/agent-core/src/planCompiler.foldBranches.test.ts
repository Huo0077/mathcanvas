import { createEmptyDocument } from "@draw/dsl"
import { foldAnglesForTargetDistance, type Vector3 } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **没取的那一支折角要披露**（Task 12 的边界，2026-10-14）。
 *
 * 边界原文：「两支角合法时**另一支未披露**」。求解器其实**算得出**两支 ——
 * `A·cosθ + B·sinθ = d² − K` 闭式至多两支角；只是 `solved` 那一档只返回**允许区间（0°, 180°] 内**
 * 的候选，另一支（`360° − θ`，即"朝折痕另一侧折"）被区间过滤掉了。而**它同样满足题面那个距离**：
 * 用户那道题里目标点 `C` 在底面内，`P(−θ)` 与 `P(θ)` 关于底面镜像，到 `C` 的距离自然相等。
 * 只写一支，用户会以为"折角只有这一个解"。
 *
 * 这一条用例的判据**全部自己算**：不读面板结论、也不读求解器返回的那两支，
 * 而是拿**放开区间**的那次求解去核对"确实存在另一支"。
 */
const A = { x: 0, y: 0, z: 0 }
const B = { x: 8, y: 0, z: 0 }
const C = { x: 9, y: Math.sqrt(3), z: 0 }
const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }
const E = { x: 3, y: Math.sqrt(3), z: 0 }
const F = { x: 4, y: 0, z: 0 }
const TARGET = 4 * Math.sqrt(3)

/** 用户现场那一句（逐字）。 */
const PROMPT = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")

const subtract = (left: Vector3, right: Vector3): Vector3 => ({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z })
const norm = (value: Vector3): number => Math.hypot(value.x, value.y, value.z)

function foldPlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "四边形 ABCD + 边上定比分点 E/F + 沿 EF 翻折且 PC=4√3（折角由系统反求）",
    factIds: [],
    actions: [
      { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D], label: "四边形 ABCD" } },
      { actionId: "dynamic.create_bound_point", actionKey: "E", factIds: [], inputs: { alias: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5, label: "E" } },
      { actionId: "dynamic.create_bound_point", actionKey: "F", factIds: [], inputs: { alias: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 1 / 2, label: "F" } },
      // 折角故意填错（30°）：题面只说距离，角由系统反求。
      { actionId: "solid.fold", actionKey: "flap", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 30 } }
    ]
  } as unknown as PlanEnvelope
}

describe("Task 12 — 折角：没取的那一支也要披露", () => {
  it("`PC=4√3` ⇒ 折角反求出来（90°），并**明说另有一支同样满足**", () => {
    const result = compilePlan(foldPlan(), { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "fold-branches", documentGeneration: 0 })
    const why = result.diagramVerification === undefined
      ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`).join("；")}`
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")

    // ① 反求出来的折角真的是 90°：**自己解**那两条独立条件（|PE|=|AE| 与 |PC|=4√3 一起看），
    const document = result.draftDocument
    if (document === null) throw new Error("expected a draft document")
    const find = (label: string) => {
      const found = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
      if (found?.type !== "point3") throw new Error(`文档里没有点名 ${label}`)
      return found.position
    }
    expect(norm(subtract(find("P"), find("C"))), "PC").toBeCloseTo(TARGET, 6)

    // ② 披露：求解器**放开区间**能给出第二支，而它必须出现在假设文案里。
    const widened = foldAnglesForTargetDistance(A, E, subtract(F, E), C, TARGET, { minimumDegrees: -360, maximumDegrees: 360 })
    expect(widened.status, JSON.stringify(widened)).toBe("solved")
    if (widened.status !== "solved") return
    expect(widened.degrees.length, `放开区间得到的支：${widened.degrees.join("、")}`).toBe(2)

    const text = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")
    const undisclosed = widened.degrees.filter((degrees) => !result.assumptions.some((item) => typeof item !== "string" && Math.abs(((item.value as { angleDegrees?: number }).angleDegrees ?? Number.NaN) - degrees) < 1e-6))
    expect(undisclosed.length, `没取的那支：${undisclosed.join("、")}`).toBe(1)
    expect(text, `假设文案：${text}`).toContain(String(undisclosed[0]))
    expect(text, `假设文案：${text}`).toMatch(/朝折痕另一侧折/)
    expect(text, `假设文案：${text}`).toMatch(/系统没有取它们/)
  })
})

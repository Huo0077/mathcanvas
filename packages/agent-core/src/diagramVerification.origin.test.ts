import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { statedOriginNames } from "./diagramVerification"
import { compilePlan } from "./planCompiler"

/**
 * **`O` 约定为原点**（Task 14 的边界「面积核验要求图上真有那个点名」，2026-10-14）。
 *
 * 解析几何里 `O` 就是原点，而题目通常**不把 O 画出来** —— 于是 `△OAB的面积为…` 这类条件
 * 一直停在"点名缺失：O，未核验"，整轮卡在门禁上。这一档按约定把 `O` 取成 `(0, 0)`，
 * 并**在判据理由里披露**（面板那一列就是这份理由）。
 *
 * 判据两层：
 * - **端到端**（走完整 `compilePlan`）：题面点名 O、图上没有 ⇒ 面积核验有读数、理由里写明约定；
 * - **反向两条**（读约定本身那一处实现）：图上**就有** O ⇒ 不用约定；题面用**坐标**定义过 O ⇒ 认题面。
 */
const A = { x: 1, y: 0, z: 0 }
const B = { x: 0, y: 2, z: 0 }
const C = { x: 0, y: 0, z: 0 }

const PROMPT = "平面三角形ABC中，△OAB的面积为1"

function facePlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "三角形 ABC",
    factIds: [],
    actions: [{ actionId: "solid.create_face", actionKey: "tri", factIds: [], inputs: { alias: "tri", vertexNames: ["A", "B", "C"], vertices: [A, B, C], label: "三角形 ABC" } }]
  } as unknown as PlanEnvelope
}

describe("Task 14 边界 —— `O` 约定为原点", () => {
  it("题面点名 `O`、图上没有它 ⇒ 面积核得出来（`½|OA×OB| = 1`），且**理由里写明按原点取**", () => {
    const result = compilePlan(facePlan(), { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "origin-convention", documentGeneration: 0 })
    const why = result.diagramVerification === undefined
      ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`).join("；")}`
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)

    const area = result.diagramVerification?.checks.find((check) => check.kind === "area")
    expect(area?.status, `理由：${area?.reason}`).toBe("passed")
    // 数是**核验器自己从坐标算的**（O 取原点、A/B 取自图上）。
    expect(area?.actual, `实测：${area?.actual}`).toBeCloseTo(1, 9)
    // **披露**：理由必须说清"O 是按约定取的，不是图上量出来的"。
    expect(area?.reason, `理由：${area?.reason}`).toMatch(/按\*\*原点\*\*/)
    expect(area?.reason, `理由：${area?.reason}`).toMatch(/图上没有这个点名/)
  })

  it("图上**就有** `O` ⇒ 不认约定（那就是图上那个点）", () => {
    const parsed = parseDiagramObligations(PROMPT)
    expect(statedOriginNames(parsed, new Set(["O", "A", "B"]))).toEqual([])
    // 同一份题设，点名表里没有 O 时才会用约定。
    expect(statedOriginNames(parsed, new Set(["A", "B", "C"]))).toEqual(["O"])
  })

  it("题面用**坐标**定义过 `O` ⇒ 认题面、不认约定（不拿约定去顶说过的话）", () => {
    const parsed = parseDiagramObligations(`${PROMPT}，O=(0,0,3)`, { spatialPointConditions: true })
    expect(parsed.givens.some((item) => item.kind === "pointCoordinate" && item.targets[0] === "O")).toBe(true)
    expect(statedOriginNames(parsed, new Set(["A", "B", "C"]))).toEqual([])
  })
})

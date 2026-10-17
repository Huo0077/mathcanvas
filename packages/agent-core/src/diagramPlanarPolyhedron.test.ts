import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"

/**
 * **单面的 `solid.create_polyhedron` 也必须进点名表**（2026-10-17 用户现场）。
 *
 * 现场：模型拿 `solid.create_polyhedron` 去表达平面四边形（1 个面环），而核验器
 * （`candidatePoints`）此前把**每一笔** `solid.create_polyhedron` 都当成闭合体，
 * 要求候选图里恰好有一只**新 `polyhedron3`** —— 单面形态物化出来的是 `face3`，
 * 于是点名表直接判「缺可靠映射」，题设一条都核不了。
 *
 * 判据与 `solid.create_face` 那一支**同一条口径**：1 个面环的 `create_polyhedron`
 * 就是平面多边形；`vertexNames` 要按**面环顺序**（不是顶点数组顺序）与 `pointIds` 对齐。
 */
describe("单面多面体进点名表（2026-10-17）", () => {
  // 用户那道题的四边形（E/F 由定比分点另外建，不影响这两条边长）。
  const A = { x: 0, y: 0, z: 0 }
  const B = { x: 8, y: 0, z: 0 }
  const C = { x: 9, y: Math.sqrt(3), z: 0 }
  const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }

  function fixture(): { plan: PlanEnvelope; candidate: ReturnType<typeof createEmptyDocument> } {
    const plan: PlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "平面四边形 ABCD",
      factIds: [],
      actions: [{
        actionId: "solid.create_polyhedron",
        actionKey: "quad",
        factIds: [],
        inputs: { alias: "quad", vertices: [A, B, C, D], faces: [[0, 1, 2, 3]], vertexNames: ["A", "B", "C", "D"] }
      }]
    } as unknown as PlanEnvelope

    const candidate = createEmptyDocument("geometry3d")
    const points = [A, B, C, D]
    points.forEach((position, index) => candidate.primitives.push({ id: `face-quad:v${index}`, type: "point3" as const, position, label: ["A", "B", "C", "D"][index]! }))
    candidate.primitives.push({ id: "face-quad", type: "face3", pointIds: points.map((_, index) => `face-quad:v${index}`), edgeIds: [] })
    return { plan, candidate }
  }

  it("AB=8 / CD=3 能被核验，而不是报「候选图缺少唯一、可靠的顶点名映射」", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations("在平面四边形ABCD中，AB=8，CD=3"), plan, candidate)

    expect(report.checks.length).toBeGreaterThan(0)
    for (const check of report.checks) {
      expect(check.reason ?? "", check.sourceText).not.toContain("顶点名映射")
      expect(check.status, check.sourceText).toBe("passed")
    }
    expect(report.status).toBe("passed")
  })

  it("**面环顺序优先**：`vertexNames` 按环序与 `pointIds` 对齐（环从 B 开始也一样）", () => {
    const plan: PlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "平面四边形 ABCD",
      factIds: [],
      actions: [{
        actionId: "solid.create_polyhedron",
        actionKey: "quad",
        factIds: [],
        inputs: { alias: "quad", vertices: [A, B, C, D], faces: [[1, 2, 3, 0]], vertexNames: ["A", "B", "C", "D"] }
      }]
    } as unknown as PlanEnvelope
    const candidate = createEmptyDocument("geometry3d")
    // 编译器按环序物化：pointIds 的顺序是 B、C、D、A，坐标也是这个顺序。
    const ordered = [B, C, D, A]
    ordered.forEach((position, index) => candidate.primitives.push({ id: `face-quad:v${index}`, type: "point3" as const, position, label: ["B", "C", "D", "A"][index]! }))
    candidate.primitives.push({ id: "face-quad", type: "face3", pointIds: ordered.map((_, index) => `face-quad:v${index}`), edgeIds: [] })

    const report = verifyDiagramObligations(parseDiagramObligations("在平面四边形ABCD中，AB=8，CD=3"), plan, candidate)

    for (const check of report.checks) expect(check.status, check.sourceText).toBe("passed")
  })
})

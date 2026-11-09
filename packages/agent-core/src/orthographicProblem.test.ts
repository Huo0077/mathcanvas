import { describe, expect, it } from "vitest"

import { solveOrthographicProblem, type OrthographicView } from "./orthographicProblem"

/**
 * **W7 / T7：有限三视图族的约束建模与体积双核验。**
 *
 * 支持域**只有**轴对齐长方体与"沿一整条棱切掉一个长方体"的 L 形柱体，
 * 而且要求视图身份与尺寸都有来源。域外（圆柱、斜截面、遮挡歧义）明确 `unsupported`，
 * 不假装能解。
 *
 * 三条硬判据：
 * 1. 三视图共享的轴必须一致（主视图宽 = 俯视图宽、左视图宽 = 俯视图深、左视图高 = 主视图高）；
 *    不一致就是视图身份/尺寸冲突，**不重排标签凑一个解**；
 * 2. 体积用**两条独立路径**：解析分块 与 闭合网格有向四面体求和；两者不一致 → `unknown`；
 * 3. 角缺口高度没给 ⇒ 候选体积不同 ⇒ 明确"信息不足"，不默认取 0 或"常见值"。
 */

const front = (width: number, height: number, unit?: string): OrthographicView => ({ id: "front", width, height, ...(unit === undefined ? {} : { unit }) })
const top = (width: number, height: number, unit?: string, notch?: { width: number; height: number }): OrthographicView =>
  ({ id: "top", width, height, ...(unit === undefined ? {} : { unit }), ...(notch === undefined ? {} : { notch }) })
const side = (width: number, height: number, unit?: string): OrthographicView => ({ id: "side", width, height, ...(unit === undefined ? {} : { unit }) })

describe("W7 — 长方体：三视图定尺寸、体积双核验", () => {
  it("solves a cuboid and agrees on analytic and mesh volume", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)] })

    expect(solved.status).toBe("answer")
    if (solved.status !== "answer") return
    expect(solved.dimensions).toEqual({ width: 4, depth: 2, height: 3 })
    expect(solved.volume).toBe(24)
    expect(solved.methods.analytic).toBe(24)
    expect(solved.methods.mesh).toBeCloseTo(24, 9)
    expect(solved.reprojection).toBe("consistent")
  })

  it("matches an option only after computing the volume", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)], options: ["A. 30", "B. 24", "C. 20"] })
    expect(solved.status).toBe("answer")
    if (solved.status !== "answer") return
    expect(solved.matchedOptions).toEqual(["B"])
  })

  it("refuses when the shared axes disagree instead of relabelling the views", () => {
    // 主视图宽 4 与俯视图宽 5 不可能同时是同一个 x 轴。
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(5, 2), side(2, 3)] })
    expect(solved.status).toBe("conflict")
    if (solved.status !== "conflict") return
    expect(solved.code).toBe("view_identity_conflict")
    expect(solved.reason).toContain("主视图")
    expect(solved.reason).toContain("俯视图")
  })

  it("refuses contradictory duplicate dimensions", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(3, 3)] })
    expect(solved.status).toBe("conflict")
    if (solved.status !== "conflict") return
    expect(solved.code).toBe("view_identity_conflict")
  })

  it("reports the missing dimension when a single view is not enough", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [top(4, 2)] })
    expect(solved.status).toBe("information_incomplete")
    if (solved.status !== "information_incomplete") return
    expect(solved.reasonCodes).toContain("missing_dimension")
    expect(solved.missingDimensions).toEqual(["height"])
  })

  it("refuses to mix units silently", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3, "cm"), top(4, 2, "mm"), side(2, 3, "cm")] })
    expect(solved.status).toBe("conflict")
    if (solved.status !== "conflict") return
    expect(solved.code).toBe("unit_conflict")
  })
})

describe("W7 — L 形柱体：解析体积与闭合网格互相独立", () => {
  const notched = (height: number | null | undefined) => solveOrthographicProblem({
    problemRevision: "rev-1",
    views: [front(4, 3), top(4, 3, undefined, { width: 1, height: 1 }), side(3, 3)],
    ...(height === undefined ? {} : { notchHeight: height })
  })

  it("subtracts a full-height corner notch", () => {
    const solved = notched(3)
    expect(solved.status).toBe("answer")
    if (solved.status !== "answer") return
    expect(solved.dimensions).toEqual({ width: 4, depth: 3, height: 3 })
    expect(solved.volume).toBe(33)
    expect(solved.methods.mesh).toBeCloseTo(33, 9)
  })

  it("reports non-unique volumes when the notch depth is not given", () => {
    const solved = notched(null)
    expect(solved.status).toBe("information_incomplete")
    if (solved.status !== "information_incomplete") return
    expect(solved.reasonCodes).toContain("non_unique_volume")
    const volumes = new Set((solved.candidates ?? []).map((candidate) => candidate.volume))
    expect(volumes.size).toBeGreaterThan(1)
  })

  it("rejects a notch that does not fit the top view", () => {
    const solved = solveOrthographicProblem({
      problemRevision: "rev-1",
      views: [front(4, 3), top(4, 3, undefined, { width: 5, height: 1 }), side(3, 3)],
      notchHeight: 3
    })
    expect(solved.status).toBe("conflict")
    if (solved.status !== "conflict") return
    expect(solved.code).toBe("dimension_conflict")
  })
})

describe("W7 — 域外与不可观测参数", () => {
  it("does not pretend to solve a curved solid", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)], family: "cylinder" })
    expect(solved.status).toBe("unsupported")
  })

  it("rejects a non-positive dimension instead of producing a volume", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(0, 3), top(4, 2), side(2, 3)] })
    expect(solved.status).toBe("unsupported")
  })
})

/**
 * **W7（2026-11-09）：候选消歧与轮廓反投影**。
 *
 * 同一组外轮廓尺寸对应不同实体时体积可能不同：
 * - 长方体与同底棱锥的包围盒相同，但主视图顶点数（4 vs 3）不同；
 * - 声明的顶点数与实体不符时 `outline_conflict`，不给数值；
 * - 选项只改变标签，不改变数值。
 */
describe("W7 — 候选消歧与轮廓反投影", () => {
  const triangle = (id: "front" | "side", width: number, height: number): OrthographicView =>
    ({ id, width, height, vertexCount: 3 })

  it("refuses a prism when the declared front outline is a triangle", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [triangle("front", 4, 3), top(4, 2), triangle("side", 2, 3)] })
    expect(solved.status).toBe("conflict")
    if (solved.status !== "conflict") return
    expect(solved.code).toBe("outline_conflict")
    expect(solved.reason).toContain("outline_vertex_mismatch")
  })

  it("solves the same box as a right pyramid only when the outline is triangular", () => {
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [triangle("front", 4, 3), top(4, 2), triangle("side", 2, 3)], family: "right-pyramid" })
    expect(solved.status).toBe("answer")
    if (solved.status !== "answer") return
    expect(solved.family).toBe("right-pyramid")
    expect(solved.volume).toBeCloseTo((4 * 2 * 3) / 3, 12)
    expect(solved.methods.mesh).toBeCloseTo(solved.methods.analytic, 9)
  })

  it("rejects a right pyramid whose declared outline is a rectangle", () => {
    const rectangle = (id: "front" | "side", width: number, height: number): OrthographicView =>
      ({ id, width, height, vertexCount: 4 })
    const solved = solveOrthographicProblem({ problemRevision: "rev-1", views: [rectangle("front", 4, 3), top(4, 2), rectangle("side", 2, 3)], family: "right-pyramid" })
    expect(solved.status).toBe("conflict")
    if (solved.status !== "conflict") return
    expect(solved.code).toBe("outline_conflict")
  })

  it("scales the volume by the cube of a uniform scale factor", () => {
    const base = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)] })
    const scaled = solveOrthographicProblem({ problemRevision: "rev-2", views: [front(8, 6), top(8, 4), side(4, 6)] })
    expect(base.status).toBe("answer")
    expect(scaled.status).toBe("answer")
    if (base.status !== "answer" || scaled.status !== "answer") return
    expect(scaled.volume).toBeCloseTo(base.volume * 8, 9)
  })

  it("keeps the number identical when options are permuted (labels only)", () => {
    const first = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)], options: ["A. 24", "B. 20", "C. 18"] })
    const permuted = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)], options: ["A. 20", "B. 18", "C. 24"] })
    expect(first.status).toBe("answer")
    expect(permuted.status).toBe("answer")
    if (first.status !== "answer" || permuted.status !== "answer") return
    expect(permuted.volume).toBe(first.volume)
    expect(first.matchedOptions).toEqual(["A"])
    expect(permuted.matchedOptions).toEqual(["C"])
  })

  it("delivers the same number without any options", () => {
    const withOptions = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)], options: ["A. 24"] })
    const without = solveOrthographicProblem({ problemRevision: "rev-1", views: [front(4, 3), top(4, 2), side(2, 3)] })
    expect(withOptions.status).toBe("answer")
    expect(without.status).toBe("answer")
    if (withOptions.status !== "answer" || without.status !== "answer") return
    expect(without.volume).toBe(withOptions.volume)
    expect(without.matchedOptions).toEqual([])
  })
})

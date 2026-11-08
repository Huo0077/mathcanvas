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

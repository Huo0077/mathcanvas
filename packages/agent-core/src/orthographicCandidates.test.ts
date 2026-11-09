import { describe, expect, it } from "vitest"

import {
  orthographicCandidateVolumes,
  resolveInvariantVolume,
  type CandidateViews,
  type VolumeCandidate
} from "./orthographicCandidates"

/**
 * **W7：候选消歧（2026-11-09）**。
 *
 * 这一组钉的是"别把不唯一说成唯一"：
 * ① 两个通过反投影的候选体积不同 → `ambiguous`（不是取平均、也不是挑一个）；
 * ② 同一外轮廓的棱柱/棱锥体积不同，只有顶点数能区分它们；
 * ③ 只给了包围盒（没有底面轮廓）时，不规则棱柱**不能**算出体积；
 * ④ 支持域没枚举完时，即使只剩一个候选也不许称唯一。
 */

const cuboidViews: CandidateViews = {
  front: { width: 2, height: 3, vertexCount: 4 },
  top: { width: 2, height: 4, vertexCount: 4 },
  side: { width: 4, height: 3, vertexCount: 4 }
}

describe("W7 唯一体积判定", () => {
  const candidate = (id: string, volume: number, reprojectionPassed = true): VolumeCandidate =>
    ({ id, family: "right-prism", volume, reprojectionPassed, reasonCodes: [] })

  it("reports ambiguous for two different volumes that both passed reprojection", () => {
    const result = resolveInvariantVolume([candidate("solid-a", 9), candidate("solid-b", 12)], 1e-9)
    expect(result.status).toBe("ambiguous")
    if (result.status === "ambiguous") expect(result.volumes).toEqual([9, 12])
  })

  it("reports unique_value only for one distinct volume", () => {
    const result = resolveInvariantVolume([candidate("a", 9), candidate("b", 9 + 1e-12)], 1e-9)
    expect(result.status).toBe("unique_value")
    if (result.status === "unique_value") expect(result.volume).toBeCloseTo(9, 12)
  })

  it("ignores candidates that failed reprojection", () => {
    expect(resolveInvariantVolume([candidate("a", 9), candidate("b", 12, false)], 1e-9)).toMatchObject({ status: "unique_value", volume: 9 })
    expect(resolveInvariantVolume([candidate("a", 9, false)], 1e-9)).toEqual({ status: "none", reason: "no_reprojected_candidate" })
    expect(resolveInvariantVolume([], 1e-9)).toEqual({ status: "none", reason: "no_candidate" })
  })

  it("never claims uniqueness while the support domain is incomplete", () => {
    const result = resolveInvariantVolume([candidate("a", 9)], 1e-9, { domainComplete: false })
    expect(result.status).toBe("ambiguous")
  })
})

describe("W7 按视图枚举候选实体", () => {
  it("enumerates a cuboid and a pyramid from a cuboid outline, then reports ambiguity", () => {
    const candidates = orthographicCandidateVolumes({ views: cuboidViews })
    const prism = candidates.find((entry) => entry.family === "cuboid")!
    const pyramid = candidates.find((entry) => entry.family === "right-pyramid")!
    expect(prism.volume).toBeCloseTo(24, 12)
    expect(prism.reprojectionPassed).toBe(true)
    // 主视图声明 4 个顶点，棱锥的主视图是三角形 → 反投影不通过。
    expect(pyramid.reprojectionPassed).toBe(false)
    expect(pyramid.reasonCodes.some((code) => code.includes("outline_vertex_mismatch"))).toBe(true)
    expect(resolveInvariantVolume(candidates, 1e-9)).toMatchObject({ status: "unique_value", volume: 24 })
  })

  it("turns the same outline into a real ambiguity when the declared views are triangles", () => {
    const triangleViews: CandidateViews = {
      ...cuboidViews,
      front: { width: 2, height: 3, vertexCount: 3 },
      side: { width: 4, height: 3, vertexCount: 3 }
    }
    const candidates = orthographicCandidateVolumes({ views: triangleViews })
    const pyramid = candidates.find((entry) => entry.family === "right-pyramid")!
    expect(pyramid.reprojectionPassed).toBe(true)
    expect(pyramid.volume).toBeCloseTo(8, 12)
    // 长方体与不规则棱柱在这些视图下都不通过；只剩棱锥一个候选 → 唯一值 8。
    expect(resolveInvariantVolume(candidates, 1e-9)).toMatchObject({ status: "unique_value", volume: 8 })
  })

  it("refuses an irregular prism volume when only the bounding box is known", () => {
    const candidates = orthographicCandidateVolumes({ views: cuboidViews })
    const prism = candidates.find((entry) => entry.family === "right-prism")!
    expect(prism.reprojectionPassed).toBe(false)
    expect(prism.reasonCodes).toContain("outline_missing")
    expect(Number.isFinite(prism.volume)).toBe(false)
  })

  it("computes the irregular prism volume from the real top outline", () => {
    const outline = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 6 }, { x: 0, y: 6 }]
    const views: CandidateViews = {
      front: { width: 6, height: 5, vertexCount: 4 },
      top: { width: 6, height: 6, vertexCount: 6 },
      side: { width: 6, height: 5, vertexCount: 4 },
      topOutline: outline
    }
    const candidates = orthographicCandidateVolumes({ views, families: ["right-prism"] })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.volume).toBeCloseTo((36 - 8) * 5, 12)
    expect(candidates[0]!.reprojectionPassed).toBe(true)
  })

  it("keeps the notched cuboid as a separate candidate with its own volume", () => {
    const views: CandidateViews = {
      front: { width: 6, height: 5, vertexCount: 4 },
      top: { width: 6, height: 6, vertexCount: 6 },
      side: { width: 6, height: 5, vertexCount: 4 },
      notch: { width: 4, height: 2 }
    }
    const candidates = orthographicCandidateVolumes({ views, families: ["notched-cuboid", "cuboid"] })
    expect(candidates.find((entry) => entry.family === "notched-cuboid")).toMatchObject({ volume: (36 - 8) * 5, reprojectionPassed: true })
    // 长方体在 6 顶点的俯视图下反投影不通过：同一尺寸，轮廓不同。
    expect(candidates.find((entry) => entry.family === "cuboid")?.reprojectionPassed).toBe(false)
    expect(resolveInvariantVolume(candidates, 1e-9)).toMatchObject({ status: "unique_value", volume: 140 })
  })
})

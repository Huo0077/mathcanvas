import { describe, expect, it } from "vitest"

import { coneQuadric3, conic3PointAt, cylinderQuadric3, planeQuadric3 } from "./quadrics"
import { sectionQuadric3, type CurvePiece3 } from "./section-quadric"

const RADIUS = 2
const HEIGHT = 3
const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }
const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }
const degrees = (value: number) => (value * Math.PI) / 180
const plane = (normal: { x: number; y: number; z: number }, constant: number) => ({ normal, constant })

/** 平面过 (0, 0, z0)、绕 x 轴倾斜 θ（法向与轴的夹角就是 θ）。 */
const tiltedThrough = (theta: number, z0: number) => plane({ x: 0, y: -Math.sin(theta), z: Math.cos(theta) }, -z0 * Math.cos(theta))

const pieceEndpoints = (piece: CurvePiece3) =>
  piece.kind === "segment" ? [piece.a, piece.b] : [conic3PointAt(piece.conic, piece.parameterRange[0])!, conic3PointAt(piece.conic, piece.parameterRange[1])!]

describe("analytic section of a finite quadric solid", () => {
  it("keeps a perpendicular circle whole: one closed arc, no chords", () => {
    const result = sectionQuadric3(cylinderQuadric3(cylinder), plane({ x: 0, y: 0, z: 1 }, -1))!

    expect(result.kind).toBe("circle")
    expect(result.loops).toHaveLength(1)
    expect(result.loops[0]).toHaveLength(1)
    expect(result.loops[0][0].kind).toBe("conic")
  })

  it("clips an oblique ellipse that leaves through the bottom cap and closes it with one chord", () => {
    // a = R/cos30 = 2.309、轴向半幅 = R·tan30 = 1.1547；圆心抬到 z=1.0 → 只切到底面。
    const result = sectionQuadric3(cylinderQuadric3(cylinder), tiltedThrough(degrees(30), 1))!

    expect(result.kind).toBe("ellipse")
    expect(result.loops).toHaveLength(1)
    const segments = result.loops[0].filter((piece) => piece.kind === "segment")
    expect(segments).toHaveLength(1)
    for (const segment of segments) {
      if (segment.kind !== "segment") continue
      expect(segment.a.z).toBeCloseTo(0, 9)
      expect(segment.b.z).toBeCloseTo(0, 9)
    }
  })

  it("clips through both caps and closes the loop with two chords", () => {
    // 倾角 60°、圆心 z=0.2：轴向半幅 R·tan60 = 3.464，两端都出实体 → 两段弦 + 两段椭圆弧。
    const result = sectionQuadric3(cylinderQuadric3(cylinder), tiltedThrough(degrees(60), 0.2))!

    expect(result.kind).toBe("ellipse")
    expect(result.loops).toHaveLength(1)
    const pieces = result.loops[0]
    const segments = pieces.filter((piece) => piece.kind === "segment")
    expect(segments).toHaveLength(2)
    expect(pieces.filter((piece) => piece.kind === "conic")).toHaveLength(2)

    const levels = segments.map((segment) => (segment.kind === "segment" ? segment.a.z : Number.NaN)).sort((first, second) => first - second)
    expect(levels[0]).toBeCloseTo(0, 9)
    expect(levels[1]).toBeCloseTo(HEIGHT, 9)
    for (const segment of segments) {
      if (segment.kind !== "segment") continue
      expect(segment.a.z).toBeCloseTo(segment.b.z, 9)
    }
  })

  it("assembles every loop from pieces whose endpoints coincide", () => {
    const result = sectionQuadric3(cylinderQuadric3(cylinder), tiltedThrough(degrees(60), 0.2))!
    const points = result.loops[0].flatMap(pieceEndpoints)

    // 每个端点都必须与另一个端点重合（闭合环），没有悬空端。
    for (const point of points) {
      const matches = points.filter((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y, candidate.z - point.z) < 1e-9)
      expect(matches.length).toBeGreaterThanOrEqual(2)
    }
  })

  it("reports the empty set when the plane misses the finite solid", () => {
    const result = sectionQuadric3(cylinderQuadric3(cylinder), plane({ x: 0, y: 0, z: 1 }, -5))!
    expect(result.kind).toBe("empty")
    expect(result.loops).toEqual([])
  })

  it("leaves straight sections to the polygon path: lines, point and empty need no pieces", () => {
    const lines = sectionQuadric3(cylinderQuadric3(cylinder), plane({ x: 1, y: 0, z: 0 }, -1))!
    expect(lines.kind).toBe("lines")
    expect(lines.loops).toEqual([])

    const tangent = sectionQuadric3(cylinderQuadric3(cylinder), plane({ x: 1, y: 0, z: 0 }, -RADIUS))!
    expect(tangent.kind).toBe("line")
    expect(tangent.loops).toEqual([])

    const apex = sectionQuadric3(coneQuadric3(cone), plane({ x: 0, y: 0, z: 1 }, -HEIGHT))!
    expect(apex.kind).toBe("point")
    expect(apex.loops).toEqual([])
  })

  it("clips a cone hyperbola to its base chord", () => {
    // 平面与轴夹角 20° < 半顶角 33.69° → 双曲线；过 (0,0,1) 时两端都落在底面上。
    const theta = degrees(70)
    const result = sectionQuadric3(coneQuadric3(cone), plane({ x: Math.sin(theta), y: 0, z: Math.cos(theta) }, -Math.cos(theta)))!

    expect(result.kind).toBe("hyperbola")
    expect(result.loops).toHaveLength(1)
    const segments = result.loops[0].filter((piece) => piece.kind === "segment")
    expect(segments.length).toBeLessThanOrEqual(2)
    for (const segment of segments) {
      if (segment.kind !== "segment") continue
      expect(Math.min(Math.abs(segment.a.z), Math.abs(segment.a.z - HEIGHT))).toBeLessThan(1e-6)
    }
  })

  it("returns null for a source that is not a quadric solid", () => {
    expect(sectionQuadric3(planeQuadric3(plane({ x: 0, y: 0, z: 1 }, 0)), plane({ x: 0, y: 0, z: 1 }, -1))).toBeNull()
  })
})

import { describe, expect, it } from "vitest"

import type { Vector3 } from "./geometry3d"

import { detectUnfoldOverlaps, unfoldPolyhedron3, type FaceRing3 } from "./unfold3d"

const cube: Record<string, Vector3> = {
  v0: { x: -1, y: -1, z: -1 }, v1: { x: 1, y: -1, z: -1 }, v2: { x: 1, y: 1, z: -1 }, v3: { x: -1, y: 1, z: -1 },
  v4: { x: -1, y: -1, z: 1 }, v5: { x: 1, y: -1, z: 1 }, v6: { x: 1, y: 1, z: 1 }, v7: { x: -1, y: 1, z: 1 }
}

const cubeFaces: FaceRing3[] = [
  { id: "bottom", pointIds: ["v0", "v1", "v2", "v3"] },
  { id: "top", pointIds: ["v4", "v5", "v6", "v7"] },
  { id: "front", pointIds: ["v0", "v1", "v5", "v4"] },
  { id: "right", pointIds: ["v1", "v2", "v6", "v5"] },
  { id: "back", pointIds: ["v2", "v3", "v7", "v6"] },
  { id: "left", pointIds: ["v3", "v0", "v4", "v7"] }
]

const ringLengths = (positions: Vector3[]): number[] => positions.map((point, index) => {
  const next = positions[(index + 1) % positions.length]
  return Math.hypot(point.x - next.x, point.y - next.y, point.z - next.z)
})

describe("3D unfolding", () => {
  it("flattens every cube face into the root face plane", () => {
    const layout = unfoldPolyhedron3(cube, cubeFaces, 1, "bottom")

    expect(layout.status).toBe("ok")
    expect(layout.rootFaceId).toBe("bottom")
    expect(layout.faces).toHaveLength(6)
    for (const face of layout.faces) for (const point of face.positions) expect(point.z).toBeCloseTo(-1, 6)
    expect(layout.diagnostics).toEqual([])
  })

  it("keeps the folded pose at progress zero", () => {
    const layout = unfoldPolyhedron3(cube, cubeFaces, 0, "bottom")

    const top = layout.faces.find((face) => face.faceId === "top")
    expect(top?.positions).toEqual(["v4", "v5", "v6", "v7"].map((id) => cube[id]))
  })

  it("preserves rigid face shape while unfolding", () => {
    const layout = unfoldPolyhedron3(cube, cubeFaces, 0.5, "bottom")

    for (const face of layout.faces) for (const length of ringLengths(face.positions)) expect(length).toBeCloseTo(2, 6)
  })

  it("connects every non-root face to the parent face and hinge it unfolded from", () => {
    const layout = unfoldPolyhedron3(cube, cubeFaces, 1, "bottom")

    expect(layout.faces.filter((face) => face.parentFaceId === undefined).map((face) => face.faceId)).toEqual(["bottom"])
    expect(layout.faces.find((face) => face.faceId === "front")).toMatchObject({ parentFaceId: "bottom", hingePointIds: ["v0", "v1"] })
    expect(layout.faces.find((face) => face.faceId === "top")?.parentFaceId).toBeDefined()
  })

  it("unfolds a square pyramid into five coplanar faces", () => {
    const pyramid: Record<string, Vector3> = {
      b0: { x: -1, y: 0, z: -1 }, b1: { x: 1, y: 0, z: -1 }, b2: { x: 1, y: 0, z: 1 }, b3: { x: -1, y: 0, z: 1 }, apex: { x: 0, y: 2, z: 0 }
    }
    const faces: FaceRing3[] = [
      { id: "base", pointIds: ["b0", "b1", "b2", "b3"] },
      { id: "s0", pointIds: ["b0", "b1", "apex"] },
      { id: "s1", pointIds: ["b1", "b2", "apex"] },
      { id: "s2", pointIds: ["b2", "b3", "apex"] },
      { id: "s3", pointIds: ["b3", "b0", "apex"] }
    ]

    const layout = unfoldPolyhedron3(pyramid, faces, 1, "base")

    expect(layout.status).toBe("ok")
    expect(layout.faces).toHaveLength(5)
    expect(layout.diagnostics).toEqual([])
    for (const face of layout.faces) for (const point of face.positions) expect(point.y).toBeCloseTo(0, 6)
    const slope = layout.faces.find((face) => face.faceId === "s0")
    const slopeLengths = slope ? ringLengths(slope.positions) : []
    // base edge b0-b1 stays 2, and both slant edges keep their original 3D length sqrt(6)
    expect(slopeLengths[0]).toBeCloseTo(2, 6)
    expect(slopeLengths[1]).toBeCloseTo(Math.sqrt(6), 6)
    expect(slopeLengths[2]).toBeCloseTo(Math.sqrt(6), 6)
  })

  it("reports insufficient data instead of guessing for an open surface", () => {
    const layout = unfoldPolyhedron3(
      { v0: { x: 0, y: 0, z: 0 }, v1: { x: 1, y: 0, z: 0 }, v2: { x: 0, y: 1, z: 0 } },
      [{ id: "only", pointIds: ["v0", "v1", "v2"] }],
      1
    )

    expect(layout.status).toBe("insufficient-data")
    expect(layout.faces).toEqual([])
    expect(layout.diagnostics.length).toBeGreaterThan(0)
  })

  it("reports a diagnostic when a ring references a missing vertex", () => {
    const layout = unfoldPolyhedron3(cube, [...cubeFaces.slice(0, 5), { id: "broken", pointIds: ["v1", "v2", "missing"] }], 1, "bottom")

    expect(layout.status).toBe("insufficient-data")
    expect(layout.diagnostics.join(" ")).toContain("missing")
  })
})

describe("unfold overlap detection", () => {
  it("flags overlapping faces and accepts touching neighbours", () => {
    const square = (faceId: string, offset: number) => ({ faceId, points: [{ x: offset, y: 0 }, { x: offset + 2, y: 0 }, { x: offset + 2, y: 2 }, { x: offset, y: 2 }] })

    expect(detectUnfoldOverlaps([square("a", 0), square("b", 0.5)])).toEqual([["a", "b"]])
    expect(detectUnfoldOverlaps([square("a", 0), square("b", 2)])).toEqual([])
  })
})

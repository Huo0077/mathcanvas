import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"

import {
  DRAFT_GRID_MAJOR,
  boxSelectionMode,
  clientToDraft,
  constrainAngle,
  draftGrid,
  draftGridSnapStep,
  draftMeasurement,
  draftSnapCandidates,
  draftWindow,
  normalizeSelectionBox,
  rankDraftSnaps,
  resolveDraftSnap
} from "./drafting"

const rect = { left: 0, top: 0, width: 100, height: 100 }

function planar(primitives: PrimitiveSpec[]): PrimitiveSpec[] {
  return primitives
}

describe("draft window", () => {
  it("is a fixed window around the origin instead of a fit to the drawn content", () => {
    const first = draftWindow(1)

    expect(first.minX).toBe(-50)
    expect(first.maxX).toBe(50)
    expect(first.minY).toBe(-50)
    expect(first.maxY).toBe(50)
  })

  it("zooms with the view scale so the viewport −/＋ buttons actually do something", () => {
    const zoomedIn = draftWindow(2)
    const zoomedOut = draftWindow(0.5)

    expect(zoomedIn.maxX).toBe(25)
    expect(zoomedOut.maxX).toBe(100)
    // 与内容无关：无论文档里有没有图元，窗口都一样。
    expect(draftWindow(1)).toEqual(draftWindow(1))
  })

  it("keeps the minor grid only when it stays readable", () => {
    expect(draftGrid(1)).toEqual({ minor: null, major: DRAFT_GRID_MAJOR })
    expect(draftGrid(2)).toEqual({ minor: 1, major: DRAFT_GRID_MAJOR })
  })

  it("coarsens the major grid when zoomed out instead of drawing hundreds of lines", () => {
    // 缩小到 0.1 倍，窗口跨 1000：主网格必须从 10 加粗到 100，否则一条边就是一二百条线。
    expect(draftGrid(0.1)).toEqual({ minor: null, major: 100 })
  })

  it("offers the finest visible grid step for grid snapping", () => {
    // 次网格看得见就按次网格吸，否则退回主网格——否则放大后落点精度反而不够。
    expect(draftGridSnapStep(1)).toBe(10)
    expect(draftGridSnapStep(2)).toBe(1)
  })
})

describe("client to draft coordinates", () => {
  it("maps the element box with y pointing up", () => {
    const window = draftWindow(1)

    expect(clientToDraft({ x: 0, y: 0 }, rect, window)).toEqual({ x: -50, y: 50 })
    expect(clientToDraft({ x: 100, y: 100 }, rect, window)).toEqual({ x: 50, y: -50 })
    expect(clientToDraft({ x: 50, y: 50 }, rect, window)).toEqual({ x: 0, y: 0 })
  })

  it("accounts for the element's offset inside the page", () => {
    const window = draftWindow(1)

    expect(clientToDraft({ x: 150, y: 150 }, { left: 100, top: 100, width: 100, height: 100 }, window)).toEqual({ x: 0, y: 0 })
  })

  it("rounds free placement to 0.001 so saved coordinates stay readable", () => {
    const window = draftWindow(1)

    // 33/300 不是精确二进制小数；落点写进 .mgeo 前必须先收敛。
    expect(clientToDraft({ x: 33, y: 33 }, { left: 0, top: 0, width: 300, height: 300 }, window)).toEqual({ x: -39, y: 39 })
  })
})

describe("object snap candidates", () => {
  it("offers endpoints and the midpoint of a segment", () => {
    const candidates = draftSnapCandidates(planar([{ id: "s", type: "segment", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } }]))

    expect(candidates).toEqual([
      { point: { x: -10, y: 0 }, kind: "endpoint" },
      { point: { x: 10, y: 0 }, kind: "endpoint" },
      { point: { x: 0, y: 0 }, kind: "midpoint" }
    ])
  })

  it("offers polyline vertices and per-segment midpoints", () => {
    const candidates = draftSnapCandidates(planar([{ id: "p", type: "polyline", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] }]))

    expect(candidates).toContainEqual({ point: { x: 0, y: 0 }, kind: "endpoint" })
    expect(candidates).toContainEqual({ point: { x: 4, y: 4 }, kind: "endpoint" })
    expect(candidates).toContainEqual({ point: { x: 2, y: 0 }, kind: "midpoint" })
    expect(candidates).toContainEqual({ point: { x: 4, y: 2 }, kind: "midpoint" })
  })

  it("offers circle centres and arc centres", () => {
    const candidates = draftSnapCandidates(planar([
      { id: "c", type: "circle", center: { x: 5, y: 5 }, radius: 3 },
      { id: "a", type: "arc", center: { x: -5, y: -5 }, radius: 2, startAngle: 0, endAngle: Math.PI / 2 }
    ]))

    expect(candidates).toContainEqual({ point: { x: 5, y: 5 }, kind: "center" })
    expect(candidates).toContainEqual({ point: { x: -5, y: -5 }, kind: "center" })
  })

  it("offers quadrant points on circles and only the swept ones on arcs", () => {
    const candidates = draftSnapCandidates(planar([
      { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 },
      { id: "a", type: "arc", center: { x: 20, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2 }
    ]))
    const quadrants = candidates.filter((candidate) => candidate.kind === "quadrant")

    expect(quadrants).toContainEqual({ point: { x: 5, y: 0 }, kind: "quadrant" })
    expect(quadrants).toContainEqual({ point: { x: 0, y: -5 }, kind: "quadrant" })
    // 圆弧只扫 0°–90°：不含 (15, 0) 与 (20, -5)。
    expect(quadrants).not.toContainEqual({ point: { x: 15, y: 0 }, kind: "quadrant" })
    expect(quadrants).not.toContainEqual({ point: { x: 20, y: -5 }, kind: "quadrant" })
  })

  it("offers intersections between planar entities", () => {
    const candidates = draftSnapCandidates(planar([
      { id: "s1", type: "segment", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } },
      { id: "s2", type: "segment", a: { x: 2, y: -5 }, b: { x: 2, y: 5 } }
    ]))

    expect(candidates).toContainEqual({ point: { x: 2, y: 0 }, kind: "intersection" })
  })

  it("offers the perpendicular foot only when a creation anchor exists", () => {
    const primitives = planar([{ id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }])

    expect(draftSnapCandidates(primitives).some((candidate) => candidate.kind === "perpendicular")).toBe(false)
    expect(draftSnapCandidates(primitives, { from: { x: 4, y: 9 } })).toContainEqual({ point: { x: 4, y: 0 }, kind: "perpendicular" })
  })

  it("offers tangent points on circles when an anchor exists", () => {
    const primitives = planar([{ id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }])

    expect(draftSnapCandidates(primitives).some((candidate) => candidate.kind === "tangent")).toBe(false)
    const tangents = draftSnapCandidates(primitives, { from: { x: 10, y: 0 } }).filter((candidate) => candidate.kind === "tangent")
    expect(tangents).toHaveLength(2)
    expect(tangents[0].point.x).toBeCloseTo(2.5, 6)
  })

  it("ranks the tangent below the perpendicular when both are in range", () => {
    // 锚点 (0,10)、圆 r=5：垂足是 (0,5)，切点在 (±4.33, 2.5)。取一个两者都命中的指针位置。
    const primitives = planar([{ id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }])
    const candidates = draftSnapCandidates(primitives, { from: { x: 0, y: 10 } })
    const ranked = rankDraftSnaps({ x: 2.5, y: 3.75 }, candidates, { tolerance: 3 })

    expect(ranked.some((candidate) => candidate.kind === "tangent")).toBe(true)
    expect(ranked.findIndex((candidate) => candidate.kind === "perpendicular")).toBeLessThan(ranked.findIndex((candidate) => candidate.kind === "tangent"))
  })

  it("ranks candidates by priority then distance and dedupes shared positions", () => {
    const primitives = planar([
      { id: "s1", type: "segment", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
      { id: "s2", type: "segment", a: { x: 0, y: -10 }, b: { x: 0, y: 10 } }
    ])
    const candidates = draftSnapCandidates(primitives)

    // 两条线段的交点是 (0,0)，同时它也是两条线段的中点 → 只保留优先级更高的"交点"。
    const ranked = rankDraftSnaps({ x: 0.2, y: 0.2 }, candidates, { tolerance: 1 })
    expect(ranked[0]).toEqual({ point: { x: 0, y: 0 }, kind: "intersection" })
    expect(ranked.filter((candidate) => candidate.point.x === 0 && candidate.point.y === 0)).toHaveLength(1)
  })

  it("ranks nearest last so it cannot swallow the feature points", () => {
    const primitives = planar([{ id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }])
    const candidates = draftSnapCandidates(primitives)

    // 指针在 1/3 处：捕捉到"最近点"（不是中点、不是端点）。
    expect(rankDraftSnaps({ x: 10, y: 0.5 }, candidates, { tolerance: 2, primitives })[0].kind).toBe("nearest")
    // 指针靠近中点时，中点优先于最近点。
    expect(rankDraftSnaps({ x: 15, y: 0.5 }, candidates, { tolerance: 2, primitives })[0].kind).toBe("midpoint")
  })
})

describe("snapping a raw pointer position", () => {
  const candidates = draftSnapCandidates(planar([
    { id: "s", type: "segment", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
    { id: "c", type: "circle", center: { x: 0, y: 20 }, radius: 4 }
  ]))

  it("snaps to a candidate inside the tolerance", () => {
    expect(resolveDraftSnap({ x: 9.4, y: 0.3 }, candidates, 1)).toEqual({ point: { x: 10, y: 0 }, kind: "endpoint" })
  })

  it("prefers endpoints over midpoints when both are in range", () => {
    expect(resolveDraftSnap({ x: -0.4, y: 0.2 }, candidates, 11)).toEqual({ point: { x: -10, y: 0 }, kind: "endpoint" })
  })

  it("returns null outside the tolerance so free placement still works", () => {
    expect(resolveDraftSnap({ x: 3, y: 4 }, candidates, 1)).toBeNull()
  })
})

describe("angle constraint (ortho / polar)", () => {
  it("projects onto the nearest axis for ortho", () => {
    expect(constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 }, 90)).toEqual({ x: 10, y: 0 })
    expect(constrainAngle({ x: 0, y: 0 }, { x: 3, y: 7 }, 90)).toEqual({ x: 0, y: 7 })
  })

  it("follows a 45° step from a non-origin base point", () => {
    const result = constrainAngle({ x: 10, y: 10 }, { x: 13, y: 16 }, 45)

    expect(result.x - 10).toBeCloseTo(result.y - 10, 6)
  })

  it("keeps ortho strict whatever the pointer angle is", () => {
    expect(constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1.5 }, 90)).toEqual({ x: 10, y: 0 })
  })

  it("only engages polar tracking when the pointer is close to a tracked angle", () => {
    // 贴近 0° 射线 → 吸附到射线上。
    expect(constrainAngle({ x: 0, y: 0 }, { x: 10, y: 0.2 }, 45, { thresholdDegrees: 4 })).toEqual({ x: 10, y: 0 })
    // 偏离 8.5°，超过阈值 → 保持自由落点，否则等于把光标永久锁在 45° 的倍数上。
    expect(constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1.5 }, 45, { thresholdDegrees: 4 })).toEqual({ x: 10, y: 1.5 })
  })
})

describe("live measurement readout", () => {
  it("reports length and a 0–360° angle", () => {
    expect(draftMeasurement({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ length: 5, angleDeg: 53.13 })
    expect(draftMeasurement({ x: 0, y: 0 }, { x: -1, y: 0 }).angleDeg).toBe(180)
    expect(draftMeasurement({ x: 0, y: 0 }, { x: 0, y: -1 }).angleDeg).toBe(270)
  })
})

describe("box selection direction", () => {
  it("reads the direction as the CAD selection mode", () => {
    // 左 → 右 = 窗口选择（只选完全包含）；右 → 左 = 相交选择。
    expect(boxSelectionMode({ x: 0, y: 0 }, { x: 10, y: 5 })).toBe("window")
    expect(boxSelectionMode({ x: 10, y: 0 }, { x: 0, y: 5 })).toBe("crossing")
    expect(boxSelectionMode({ x: 5, y: 0 }, { x: 5, y: 20 })).toBe("window")
  })

  it("normalises a rectangle dragged in any direction", () => {
    expect(normalizeSelectionBox({ x: 10, y: 8 }, { x: -4, y: -2 })).toEqual({ minX: -4, minY: -2, maxX: 10, maxY: 8 })
    expect(normalizeSelectionBox({ x: -1, y: -1 }, { x: 3, y: 2 })).toEqual({ minX: -1, minY: -1, maxX: 3, maxY: 2 })
  })
})

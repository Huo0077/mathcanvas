import { describe, expect, it } from "vitest"
import type { PrimitiveSpec } from "@draw/dsl"

import { creationPreviewShapes, creationSnapTarget, snapCandidatesOf, SNAP_RADIUS_PX } from "./creationPreview"

describe("creationPreview and snapping", () => {
  it("collects snap candidates from visible point-like primitives, intersection sets and previews", () => {
    const primitives: PrimitiveSpec[] = [
      { id: "p1", type: "point", x: 1, y: 2, label: "P1" },
      { id: "p2", type: "point", x: 3, y: 4, label: "P2", visible: false },
      { id: "l1", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { id: "is1", type: "intersectionSet", objectA: "c1", objectB: "l1", points: [{ x: 5, y: 6 }, { x: 7, y: 8 }], label: "IS" },
      { id: "i1", type: "intersection", lineA: "l1", lineB: "l2", x: 9, y: 10, label: "I1" }
    ]
    const previews = [{ point: { x: 11, y: 12 } }]

    const candidates = snapCandidatesOf(primitives, previews)
    expect(candidates).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
      { x: 9, y: 10 },
      { x: 11, y: 12 }
    ])
  })

  it("snaps to nearest candidate within pixel threshold and ignores distant ones", () => {
    const candidates = [
      { x: 10, y: 10 },
      { x: 20, y: 20 }
    ]
    const scale = 50 // 1 world unit = 50 screen pixels

    // Pointer is 0.1 world units away = 5 screen pixels away (< 12px)
    const snapped = creationSnapTarget(candidates, { x: 10.1, y: 10 }, scale, SNAP_RADIUS_PX)
    expect(snapped).toEqual({ x: 10, y: 10 })

    // Pointer is 0.4 world units away = 20 screen pixels away (> 12px)
    const tooFar = creationSnapTarget(candidates, { x: 10.4, y: 10 }, scale, SNAP_RADIUS_PX)
    expect(tooFar).toBeNull()
  })

  it("produces rubber-band preview shapes for segment, circle, and polyline creation steps", () => {
    // Segment creation with center placed and hover pointer
    const segmentShapes = creationPreviewShapes(
      { mode: "segment", center: { x: 0, y: 0 } },
      { x: 3, y: 4 },
      100
    )
    expect(segmentShapes).toContainEqual({ kind: "anchor", point: { x: 0, y: 0 } })
    expect(segmentShapes).toContainEqual({ kind: "segment", a: { x: 0, y: 0 }, b: { x: 3, y: 4 } })
    expect(segmentShapes).toContainEqual({ kind: "label", at: { x: 1.5, y: 2 }, text: "长度 5.00" })

    // Circle creation with center and radius
    const circleShapes = creationPreviewShapes(
      { mode: "circle", center: { x: 1, y: 1 } },
      { x: 4, y: 5 },
      100
    )
    expect(circleShapes).toContainEqual({ kind: "anchor", point: { x: 1, y: 1 } })
    expect(circleShapes).toContainEqual({ kind: "circle", center: { x: 1, y: 1 }, radius: 5 })
    expect(circleShapes).toContainEqual({ kind: "label", at: { x: 2.5, y: 3 }, text: "r = 5.00" })

    // Polyline creation with 2 existing points and hover pointer
    const polylineShapes = creationPreviewShapes(
      { mode: "polyline", center: null, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] },
      { x: 2, y: 3 },
      100
    )
    expect(polylineShapes).toContainEqual({
      kind: "polyline",
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }]
    })

    // Point creation preview displays anchor dot at pointer
    const pointShapes = creationPreviewShapes({ mode: "point", center: null }, { x: 7, y: 8 }, 100)
    expect(pointShapes).toEqual([{ kind: "anchor", point: { x: 7, y: 8 } }])

    // Step 1 before placing first point displays anchor dot at pointer
    const initialShapes = creationPreviewShapes({ mode: "segment", center: null }, { x: 9, y: 10 }, 100)
    expect(initialShapes).toEqual([{ kind: "anchor", point: { x: 9, y: 10 } }])
  })
})

import { describe, expect, it } from "vitest"

import { clipFunctionSegmentsToBounds } from "./functionGraph"

describe("function graph viewport clipping", () => {
  it("keeps a curve tail when a sampled segment crosses the viewport edge", () => {
    const clipped = clipFunctionSegmentsToBounds([[{ x: -2, y: -10 }, { x: 2, y: 10 }]], { minX: -1, maxX: 1, minY: -1, maxY: 1 })

    expect(clipped).toHaveLength(1)
    expect(clipped[0][0].x).toBeCloseTo(-0.2)
    expect(clipped[0][0].y).toBe(-1)
    expect(clipped[0][1].x).toBeCloseTo(0.2)
    expect(clipped[0][1].y).toBe(1)
  })
})

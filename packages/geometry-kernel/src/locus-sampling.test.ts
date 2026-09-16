import { describe, expect, it } from "vitest"

import type { Coordinate } from "@draw/dsl"

import { monotoneWarmup, sampleLocus } from "./locus-sampling"

function pointToSegmentDistance(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 1e-24) return Math.hypot(point.x - start.x, point.y - start.y)
  const raw = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq
  const ratio = Math.max(0, Math.min(1, raw))
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio))
}

describe("uniform sampling", () => {
  it("returns a single branch for a straight trajectory without adding points", () => {
    const result = sampleLocus((t) => ({ x: t, y: 2 * t + 1 }), { domain: [0, 10], samples: 11 })
    expect(result.branches).toHaveLength(1)
    expect(result.branches[0].points).toHaveLength(11)
    expect(result.branches[0].from).toBeCloseTo(0, 12)
    expect(result.branches[0].to).toBeCloseTo(10, 12)
    expect(result.breaks).toEqual([])
    expect(result.truncated).toBe(false)
    for (const point of result.branches[0].points) expect(point.y).toBeCloseTo(2 * point.x + 1, 9)
    // One probe per base segment is spent deciding that no refinement is needed.
    expect(result.evaluations).toBeLessThanOrEqual(2 * 11)
  })

  it("spans the domain endpoints for a circular trajectory", () => {
    const result = sampleLocus((t) => ({ x: Math.cos(t), y: Math.sin(t) }), { domain: [0, Math.PI * 2], samples: 33 })
    expect(result.branches).toHaveLength(1)
    const points = result.branches[0].points
    expect(points[0].x).toBeCloseTo(1, 9)
    expect(points[points.length - 1].x).toBeCloseTo(1, 9)
    for (const point of points) expect(Math.hypot(point.x, point.y)).toBeCloseTo(1, 6)
  })
})

describe("adaptive refinement", () => {
  it("refines only where the curve leaves the chord", () => {
    const evaluate = (t: number): Coordinate => ({ x: t, y: Math.sin(t * 8) })
    const tolerance = 0.01
    const result = sampleLocus(evaluate, { domain: [0, 10], samples: 17, tolerance, maxDepth: 8 })
    expect(result.branches).toHaveLength(1)
    const points = result.branches[0].points
    expect(points.length).toBeGreaterThan(17)
    // The real claim: every remaining chord hugs the curve to within the requested tolerance.
    let worst = 0
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]
      const end = points[index]
      const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      worst = Math.max(worst, pointToSegmentDistance(evaluate(middle.x), start, end))
    }
    expect(worst).toBeLessThanOrEqual(tolerance * 1.05)
    // And it stayed far below a uniform grid that would achieve the same chord error.
    expect(result.evaluations).toBeLessThan(1200)
  })

  it("does not refine a straight trajectory even with a tight tolerance", () => {
    const result = sampleLocus((t) => ({ x: t, y: 3 }), { domain: [0, 5], samples: 9, tolerance: 1e-9 })
    expect(result.branches[0].points).toHaveLength(9)
  })
})

describe("discontinuities and asymptotes", () => {
  it("splits a vertical asymptote instead of drawing a spurious crossing segment", () => {
    const result = sampleLocus((t) => ({ x: t, y: 1 / (t - 1) }), { domain: [0, 2], samples: 21 })
    expect(result.branches.length).toBeGreaterThan(1)
    for (const branch of result.branches) {
      for (const point of branch.points) expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
    }
    // The decisive property: no branch may contain both a point below and a point above the
    // asymptote, because that segment is exactly the line that must not be drawn.
    for (const branch of result.branches) {
      const signs = new Set(branch.points.map((point) => Math.sign(point.y)))
      expect(signs.size, `branch ${JSON.stringify(branch.from)}..${branch.to} mixes sides`).toBe(1)
    }
    expect(result.breaks.length).toBeGreaterThan(0)
    expect([...result.breaks].sort((a, b) => a - b)).toEqual(result.breaks)
  })

  it("splits a jump discontinuity into separate branches", () => {
    const result = sampleLocus((t) => ({ x: t, y: t < 1 ? 0 : 1 }), { domain: [0, 2], samples: 41 })
    expect(result.branches).toHaveLength(2)
    expect(result.branches[0].points.every((point) => point.y === 0)).toBe(true)
    expect(result.branches[1].points.every((point) => point.y === 1)).toBe(true)
  })

  it("cuts the trajectory where it is undefined", () => {
    const result = sampleLocus((t) => (t < 0 ? null : { x: t, y: Math.sqrt(t) }), { domain: [-1, 1], samples: 21 })
    expect(result.undefinedCount).toBe(10)
    expect(result.branches).toHaveLength(1)
    for (const point of result.branches[0].points) expect(point.x).toBeGreaterThanOrEqual(0)
  })

  it("cuts at a hole inside the parameter domain", () => {
    const result = sampleLocus((t) => (Math.abs(t - 0.5) < 0.05 ? null : { x: t, y: 0 }), { domain: [0, 1], samples: 21 })
    expect(result.branches).toHaveLength(2)
    // The two branches are separated by the hole; how many grid points the hole swallows depends on
    // floating point, so assert the separation rather than an exact count.
    expect(result.branches[0].to).toBeLessThanOrEqual(0.5)
    expect(result.branches[1].from).toBeGreaterThanOrEqual(0.5)
    expect(result.branches[0].to).toBeLessThan(result.branches[1].from)
    for (const branch of result.branches) expect(branch.points.length).toBeGreaterThan(2)
    expect(result.undefinedCount).toBeGreaterThan(0)
    expect(result.breaks.some((value) => Math.abs(value - 0.5) < 0.06)).toBe(true)
  })

  it("reports breaks sorted and inside the domain", () => {
    const result = sampleLocus((t) => (Math.abs(t - 0.4) < 0.02 || Math.abs(t - 0.8) < 0.02 ? null : { x: t, y: 0 }), {
      domain: [0, 1],
      samples: 51
    })
    const sorted = [...result.breaks].sort((a, b) => a - b)
    expect(result.breaks).toEqual(sorted)
    for (const value of result.breaks) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe("sampling edge cases", () => {
  it("stops at the evaluation budget and reports truncation", () => {
    const result = sampleLocus((t) => ({ x: t, y: t * t }), { domain: [0, 10], samples: 21, maxEvaluations: 5 })
    expect(result.truncated).toBe(true)
    expect(result.evaluations).toBe(5)
    expect(result.undefinedCount).toBeGreaterThan(0)
  })

  it("returns nothing when the trajectory is never defined", () => {
    const result = sampleLocus(() => null, { domain: [0, 1], samples: 5 })
    expect(result.branches).toEqual([])
    expect(result.undefinedCount).toBe(5)
    expect(result.truncated).toBe(false)
  })

  it("treats non-finite coordinates exactly like an undefined point", () => {
    const result = sampleLocus((t) => ({ x: t, y: Number.NaN }), { domain: [0, 1], samples: 5 })
    expect(result.branches).toEqual([])
    expect(result.undefinedCount).toBe(5)
    const infinite = sampleLocus(() => ({ x: Number.POSITIVE_INFINITY, y: 0 }), { domain: [0, 1], samples: 4 })
    expect(infinite.branches).toEqual([])
  })

  it("accepts a reversed domain and refuses a degenerate one", () => {
    const reversed = sampleLocus((t) => ({ x: t, y: 0 }), { domain: [1, 0], samples: 5 })
    expect(reversed.branches).toHaveLength(1)
    expect(reversed.branches[0].from).toBeCloseTo(0, 12)
    expect(reversed.branches[0].to).toBeCloseTo(1, 12)
    const degenerate = sampleLocus((t) => ({ x: t, y: 0 }), { domain: [1, 1], samples: 5 })
    expect(degenerate.branches).toEqual([])
    expect(degenerate.evaluations).toBe(0)
  })

  it("never emits a branch with fewer than two points", () => {
    const result = sampleLocus((t) => (t === 0.5 ? { x: t, y: 0 } : null), { domain: [0, 1], samples: 21 })
    expect(result.branches).toEqual([])
  })
})

describe("monotone warm-up", () => {
  it("drives the evaluator in ascending parameter order", () => {
    const seen: number[] = []
    const count = monotoneWarmup((t) => {
      seen.push(t)
      return { x: t, y: 0 }
    }, [0, 10], 5)
    expect(count).toBe(5)
    expect(seen).toEqual([0, 2.5, 5, 7.5, 10])
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })
})

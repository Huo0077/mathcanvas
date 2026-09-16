import { describe, expect, it } from "vitest"

import type { Coordinate } from "@draw/dsl"

import { createDependencyGraph } from "./dependency-graph"
import {
  angleBetween,
  createMeasurementEngine,
  evaluatePlanarMeasurement,
  lengthBetween,
  polygonPerimeter,
  signedDistanceToLine,
  signedPolygonArea,
  type PlanarMeasurement
} from "./dynamic-measurements"

/** A mutable coordinate table plus a resolver over it, mirroring how the canvas exposes geometry. */
function table(entries: Record<string, Coordinate>) {
  const positions = new Map<string, Coordinate>(Object.entries(entries).map(([id, point]) => [id, { ...point }]))
  return {
    positions,
    move(id: string, point: Coordinate) {
      positions.set(id, { ...point })
    },
    resolve: (id: string) => positions.get(id) ?? null
  }
}

describe("planar geometry primitives", () => {
  it("measures the distance between two points", () => {
    expect(lengthBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 12)
  })

  it("gives a signed area that is positive counter-clockwise", () => {
    const counterClockwise = signedPolygonArea([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }])
    const clockwise = signedPolygonArea([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 3, y: 0 }])
    expect(counterClockwise).toBeCloseTo(6, 12)
    expect(clockwise).toBeCloseTo(-6, 12)
    expect(signedPolygonArea([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(0)
  })

  it("measures a perimeter including the closing edge", () => {
    expect(polygonPerimeter([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBeCloseTo(4, 12)
    expect(polygonPerimeter([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }])).toBeCloseTo(12, 12)
  })

  it("measures an angle without ever producing NaN", () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 12)
    expect(angleBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(Math.PI, 12)
    expect(angleBetween({ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 })).toBeCloseTo(Math.PI / 2, 12)
    // A degenerate arm is reported as undefined rather than NaN.
    expect(angleBetween({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull()
    // Nearly opposite arms: an acos-based implementation returns NaN here, atan2 does not.
    const nearlyOpposite = angleBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 1e-17 })
    expect(nearlyOpposite).not.toBeNull()
    expect(Number.isFinite(nearlyOpposite!)).toBe(true)
    expect(nearlyOpposite!).toBeCloseTo(Math.PI, 9)
  })

  it("distinguishes interior, exterior and oriented angles", () => {
    const vertex = { x: 0, y: 0 }
    const first = { x: 1, y: 0 }
    const second = { x: 0, y: 1 }
    expect(angleBetween(vertex, first, second, "interior")).toBeCloseTo(Math.PI / 2, 12)
    expect(angleBetween(vertex, first, second, "exterior")).toBeCloseTo(Math.PI * 1.5, 12)
    // Swapping the arms flips the oriented angle but not the interior one.
    expect(angleBetween(vertex, first, second, "oriented")).toBeCloseTo(Math.PI / 2, 12)
    expect(angleBetween(vertex, second, first, "oriented")).toBeCloseTo(-Math.PI / 2, 12)
    expect(angleBetween(vertex, second, first, "interior")).toBeCloseTo(Math.PI / 2, 12)
  })

  it("flips the sign of a signed line distance across the line", () => {
    const above = signedDistanceToLine({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 5 })
    const below = signedDistanceToLine({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: -5 })
    expect(Math.abs(above!)).toBeCloseTo(5, 12)
    expect(above!).toBeCloseTo(-below!, 12)
    expect(signedDistanceToLine({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 5, y: 5 })).toBeNull()
  })
})

describe("evaluatePlanarMeasurement", () => {
  const geometry = table({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, c: { x: 0, y: 4 } })

  const measure = (measurement: PlanarMeasurement) => evaluatePlanarMeasurement(measurement, geometry.resolve)

  it("reports a length with its unit and status", () => {
    const reading = measure({ id: "ab", metric: "length", sourceIds: ["a", "b"] })
    expect(reading.value).toBeCloseTo(3, 12)
    expect(reading.unit).toBe("u")
    expect(reading.status).toBe("valid")
  })

  it("calls a collapsed length degenerate instead of returning zero", () => {
    const reading = measure({ id: "aa", metric: "length", sourceIds: ["a", "a"] })
    expect(reading.value).toBeNull()
    expect(reading.status).toBe("degenerate")
    expect(reading.display).toBeNull()
  })

  it("reports missing references as insufficient data", () => {
    expect(measure({ id: "x", metric: "length", sourceIds: ["a", "ghost"] }).status).toBe("insufficient-data")
    expect(measure({ id: "y", metric: "angle", sourceIds: ["a", "b"] }).status).toBe("insufficient-data")
    expect(measure({ id: "z", metric: "area", sourceIds: ["a", "b"] }).status).toBe("insufficient-data")
  })

  it("adds a degrees reading to an angle", () => {
    const reading = measure({ id: "abc", metric: "angle", sourceIds: ["b", "a", "c"] })
    expect(reading.unit).toBe("rad")
    expect(reading.value).toBeCloseTo(Math.PI / 2, 12)
    expect(reading.degrees).toBeCloseTo(90, 9)
    expect(reading.degrees!).toBeCloseTo((reading.value! * 180) / Math.PI, 12)
  })

  it("treats a vertical slope as degenerate rather than infinite", () => {
    const vertical = measure({ id: "s", metric: "slope", sourceIds: ["a", "c"] })
    expect(vertical.status).toBe("degenerate")
    expect(vertical.value).toBeNull()
    const horizontal = measure({ id: "s2", metric: "slope", sourceIds: ["a", "b"] })
    expect(horizontal.value).toBeCloseTo(0, 12)
  })

  it("distinguishes area from signed area and rejects collinear points", () => {
    expect(measure({ id: "area", metric: "area", sourceIds: ["a", "b", "c"] }).value).toBeCloseTo(6, 12)
    expect(measure({ id: "signed", metric: "signedArea", sourceIds: ["a", "c", "b"] }).value).toBeCloseTo(-6, 12)
    const collinear = table({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, c: { x: 6, y: 0 } })
    const reading = evaluatePlanarMeasurement({ id: "area", metric: "area", sourceIds: ["a", "b", "c"] }, collinear.resolve)
    expect(reading.status).toBe("degenerate")
    expect(reading.value).toBeNull()
  })

  it("measures a point-to-line distance from three points", () => {
    const reading = measure({ id: "d", metric: "distance", sourceIds: ["a", "b", "c"] })
    expect(reading.value).toBeCloseTo(4, 12)
    expect(measure({ id: "d2", metric: "distance", sourceIds: ["a", "b"] }).value).toBeCloseTo(3, 12)
  })

  it("measures a ratio and rejects a zero denominator", () => {
    const reading = measure({ id: "r", metric: "ratio", sourceIds: ["a", "b", "c", "a"] })
    expect(reading.value).toBeCloseTo(3 / 4, 12)
    expect(measure({ id: "r2", metric: "ratio", sourceIds: ["a", "b", "a", "a"] }).status).toBe("degenerate")
  })

  it("measures a coordinate component and a radius", () => {
    expect(measure({ id: "cx", metric: "coordinate", sourceIds: ["b"], component: "x" }).value).toBeCloseTo(3, 12)
    expect(measure({ id: "cy", metric: "coordinate", sourceIds: ["b"], component: "y" }).value).toBeCloseTo(0, 12)
    expect(measure({ id: "r", metric: "radius", sourceIds: ["a", "b"] }).value).toBeCloseTo(3, 12)
  })

  it("formats values to the requested precision and never renders negative zero", () => {
    const precise = measure({ id: "p", metric: "length", sourceIds: ["a", "b"], precision: 2 })
    expect(precise.display).toBe("3.00")
    const tiny = table({ a: { x: -1e-15, y: 0 } })
    const reading = evaluatePlanarMeasurement({ id: "t", metric: "coordinate", sourceIds: ["a"], component: "x", precision: 2 }, tiny.resolve)
    expect(reading.display).toBe("0.00")
  })

  it("always returns one of the four documented statuses", () => {
    const statuses = new Set(["valid", "degenerate", "insufficient-data", "numeric-failure"])
    const cases: PlanarMeasurement[] = [
      { id: "l", metric: "length", sourceIds: ["a", "b"] },
      { id: "a", metric: "angle", sourceIds: ["a", "b", "c"] },
      { id: "e", metric: "area", sourceIds: ["a", "a", "a"] },
      { id: "m", metric: "length", sourceIds: ["ghost"] }
    ]
    for (const measurement of cases) {
      const reading = measure(measurement)
      expect(statuses.has(reading.status)).toBe(true)
      if (reading.status !== "valid") expect(reading.value).toBeNull()
    }
  })
})

describe("measurement engine", () => {
  const setup = (options: { tolerance?: number } = {}) => {
    const geometry = table({
      a: { x: 0, y: 0 },
      b: { x: 3, y: 0 },
      c: { x: 0, y: 4 },
      p: { x: 0, y: 0 },
      q: { x: 10, y: 0 }
    })
    const engine = createMeasurementEngine({ positions: () => geometry.positions, ...options })
    engine.define({ id: "ab", metric: "length", sourceIds: ["a", "b"] })
    engine.define({ id: "pq", metric: "length", sourceIds: ["p", "q"] })
    return { geometry, engine }
  }

  it("produces readings on update and exposes them by id", () => {
    const { engine } = setup()
    engine.update(["a"])
    expect(engine.read("ab")?.value).toBeCloseTo(3, 12)
    expect(engine.read("pq")?.value).toBeCloseTo(10, 12)
    expect(engine.readings()).toHaveLength(2)
    expect(engine.has("ab")).toBe(true)
    expect(engine.has("nope")).toBe(false)
  })

  it("recomputes only the measurements that depend on the changed object", () => {
    const { engine } = setup()
    engine.update(["a"])
    const change = engine.update(["a"])
    expect(change.readings.map((reading) => reading.id)).toEqual(["ab"])
    expect(change.readings.map((reading) => reading.id)).not.toContain("pq")
  })

  it("reports only readings whose value actually moved", () => {
    const { geometry, engine } = setup()
    engine.update(["a", "b"])
    geometry.move("b", { x: 3 + 1e-15, y: 0 })
    // Float noise far below the tolerance must not be reported as a change.
    expect(engine.update(["b"]).changed).toEqual([])
    geometry.move("b", { x: 6, y: 0 })
    const change = engine.update(["b"])
    expect(change.changed.map((reading) => reading.id)).toEqual(["ab"])
    expect(engine.read("ab")?.value).toBeCloseTo(6, 12)
  })

  it("reports a status transition from valid to degenerate", () => {
    const { geometry, engine } = setup()
    engine.define({ id: "area", metric: "area", sourceIds: ["a", "b", "c"] })
    engine.update(["c"])
    expect(engine.read("area")?.status).toBe("valid")
    geometry.move("c", { x: 6, y: 0 })
    const change = engine.update(["c"])
    expect(engine.read("area")?.status).toBe("degenerate")
    expect(change.statusChanged.map((reading) => reading.id)).toContain("area")
  })

  it("notifies subscribers only when a value changes, and stops after unsubscribe", () => {
    const { geometry, engine } = setup()
    engine.update(["a", "b", "p", "q"])
    const seen: string[][] = []
    const unsubscribe = engine.subscribe((change) => seen.push(change.changed.map((reading) => reading.id)))
    // A no-op update must not notify.
    engine.update(["a"])
    expect(seen).toEqual([])
    geometry.move("b", { x: 9, y: 0 })
    engine.update(["b"])
    expect(seen).toEqual([["ab"]])
    unsubscribe()
    geometry.move("b", { x: 1, y: 0 })
    engine.update(["b"])
    expect(seen).toEqual([["ab"]])
  })

  it("survives a subscriber that unsubscribes during the callback", () => {
    const { geometry, engine } = setup()
    engine.update(["a", "b"])
    const seen: string[] = []
    const off = engine.subscribe(() => {
      seen.push("first")
      off()
    })
    engine.subscribe(() => seen.push("second"))
    geometry.move("b", { x: 7, y: 0 })
    expect(() => engine.update(["b"])).not.toThrow()
    expect(seen).toEqual(["first", "second"])
  })

  it("removes a measurement and its reading", () => {
    const { engine } = setup()
    engine.update(["a"])
    expect(engine.remove("ab")).toBe(true)
    expect(engine.remove("ab")).toBe(false)
    expect(engine.has("ab")).toBe(false)
    expect(engine.read("ab")).toBeUndefined()
    expect(engine.readings().map((reading) => reading.id)).toEqual(["pq"])
  })

  it("backfills a measurement that has never been computed", () => {
    const { geometry, engine } = setup()
    engine.define({ id: "ac", metric: "length", sourceIds: ["a", "c"] })
    // "unrelated" is not in the graph, so nothing is dirty â€?the new measurement is still computed.
    const change = engine.update(["unrelated"])
    expect(change.readings.map((reading) => reading.id)).toContain("ac")
    expect(engine.read("ac")?.value).toBeCloseTo(4, 12)
    void geometry
  })

  it("attaches measurement leaves to an externally supplied graph", () => {
    const graph = createDependencyGraph()
    const geometry = table({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } })
    const engine = createMeasurementEngine({ graph, positions: () => geometry.positions })
    engine.define({ id: "ab", metric: "length", sourceIds: ["a", "b"] })
    expect(engine.graph).toBe(graph)
    expect(graph.has("measure:ab")).toBe(true)
    expect([...graph.dependenciesOf("measure:ab")].sort()).toEqual(["a", "b"])
    expect(graph.dirtyClosure(["a"])).toContain("measure:ab")
  })

  it("suppresses small changes but eventually reports accumulated drift", () => {
    const geometry = table({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } })
    const engine = createMeasurementEngine({ positions: () => geometry.positions, tolerance: 0.01 })
    engine.define({ id: "ab", metric: "length", sourceIds: ["a", "b"] })
    engine.update(["a"]) // baseline reported value is 3
    geometry.move("b", { x: 3.01, y: 0 })
    expect(engine.update(["b"]).changed).toEqual([])
    geometry.move("b", { x: 3.02, y: 0 })
    expect(engine.update(["b"]).changed).toEqual([])
    // Each step is below the 1% band on its own, but the drift measured from the last REPORTED
    // value (3) is now 0.05 > 0.0305. An implementation that compared against the previous
    // computation instead (3.02) would see only 0.03 and stay silent forever.
    geometry.move("b", { x: 3.05, y: 0 })
    const change = engine.update(["b"])
    expect(change.changed.map((reading) => reading.id)).toEqual(["ab"])
    expect(engine.read("ab")?.value).toBeCloseTo(3.05, 12)
  })

  it("suppresses a change that stays inside a wide tolerance", () => {
    const geometry = table({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } })
    const engine = createMeasurementEngine({ positions: () => geometry.positions, tolerance: 0.5 })
    engine.define({ id: "ab", metric: "length", sourceIds: ["a", "b"] })
    engine.update(["a"])
    geometry.move("b", { x: 3.1, y: 0 })
    expect(engine.update(["b"]).changed).toEqual([])
    geometry.move("b", { x: 9, y: 0 })
    expect(engine.update(["b"]).changed.map((reading) => reading.id)).toEqual(["ab"])
  })

  it("refreshes every reading at once", () => {
    const { engine } = setup()
    const change = engine.refreshAll()
    expect(change.readings.map((reading) => reading.id).sort()).toEqual(["ab", "pq"])
    expect(engine.read("pq")?.value).toBeCloseTo(10, 12)
  })
})

describe("a triangle driven through the dependency graph", () => {
  it("keeps every measurement consistent after a vertex moves", () => {
    const geometry = table({ A: { x: 0, y: 0 }, B: { x: 3, y: 0 }, C: { x: 0, y: 4 } })
    const engine = createMeasurementEngine({ positions: () => geometry.positions })
    engine.define({ id: "AB", metric: "length", sourceIds: ["A", "B"] })
    engine.define({ id: "BC", metric: "length", sourceIds: ["B", "C"] })
    engine.define({ id: "CA", metric: "length", sourceIds: ["C", "A"] })
    engine.define({ id: "angleA", metric: "angle", sourceIds: ["B", "A", "C"] })
    engine.define({ id: "area", metric: "area", sourceIds: ["A", "B", "C"] })
    engine.define({ id: "perimeter", metric: "perimeter", sourceIds: ["A", "B", "C"] })
    engine.update(["A", "B", "C"])

    expect(engine.read("AB")?.value).toBeCloseTo(3, 12)
    expect(engine.read("BC")?.value).toBeCloseTo(5, 12)
    expect(engine.read("CA")?.value).toBeCloseTo(4, 12)
    expect(engine.read("angleA")?.degrees).toBeCloseTo(90, 9)
    expect(engine.read("area")?.value).toBeCloseTo(6, 12)
    expect(engine.read("perimeter")?.value).toBeCloseTo(12, 12)

    // Slide C along the x axis: the triangle becomes 3-4-5 with the right angle at B.
    geometry.move("C", { x: 3, y: 4 })
    engine.update(["C"])
    expect(engine.read("AB")?.value).toBeCloseTo(3, 12)
    expect(engine.read("BC")?.value).toBeCloseTo(4, 12)
    expect(engine.read("CA")?.value).toBeCloseTo(5, 12)
    expect(engine.read("area")?.value).toBeCloseTo(6, 12)
    expect(engine.read("perimeter")?.value).toBeCloseTo(12, 12)
    expect(engine.read("angleA")?.degrees).toBeCloseTo(53.13010235, 6)
  })
})

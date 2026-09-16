import { describe, expect, it } from "vitest"

import type { PrimitiveSpec, SegmentPrimitive } from "@draw/dsl"

import { resolveGeometryEdit } from "./draftEditing"

const target: SegmentPrimitive = { id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
const boundary: SegmentPrimitive = { id: "cut", type: "segment", a: { x: 4, y: -5 }, b: { x: 4, y: 5 } }
const short: SegmentPrimitive = { id: "short", type: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }
const cutter: SegmentPrimitive = { id: "cutter", type: "segment", a: { x: 10, y: -5 }, b: { x: 10, y: 5 } }

describe("offset request", () => {
  it("creates a parallel copy instead of moving the original", () => {
    expect(resolveGeometryEdit([target], { kind: "offset", distance: 2 }, { nextId: "segment-9" })).toEqual({
      ok: true,
      kind: "create",
      primitive: { id: "segment-9", type: "segment", a: { x: 0, y: 2 }, b: { x: 10, y: 2 }, label: "s 偏移" }
    })
  })

  it("drops a parameter binding so the copy is not driven by the original's parameter", () => {
    const driven: PrimitiveSpec = { id: "l", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, slopeParameter: "slope" }

    const result = resolveGeometryEdit([driven], { kind: "offset", distance: 1 }, { nextId: "line-2" })

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === "create") expect("slopeParameter" in result.primitive).toBe(false)
  })

  it("turns a radius result into a concentric circle", () => {
    const circle: PrimitiveSpec = { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }

    expect(resolveGeometryEdit([circle], { kind: "offset", distance: -2 }, { nextId: "circle-2" })).toEqual({
      ok: true,
      kind: "create",
      primitive: { id: "circle-2", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "c 偏移" }
    })
  })

  it("turns a polyline result into a points patch on the copy", () => {
    const corner: PrimitiveSpec = { id: "p", type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }

    const result = resolveGeometryEdit([corner], { kind: "offset", distance: 2 }, { nextId: "polyline-2" })

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === "create") expect(result.primitive).toMatchObject({ id: "polyline-2", points: [{ x: 0, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 10 }] })
  })

  it("asks for exactly one object", () => {
    const empty = resolveGeometryEdit([], { kind: "offset", distance: 2 }, { nextId: "x" })
    const two = resolveGeometryEdit([target, boundary], { kind: "offset", distance: 2 }, { nextId: "x" })

    expect(empty.ok).toBe(false)
    expect(two.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toContain("一个")
    if (!two.ok) expect(two.error).toContain("一个")
  })

  it("explains unsupported, locked and collapsing cases instead of guessing", () => {
    const point: PrimitiveSpec = { id: "pt", type: "point", x: 0, y: 0 }
    const locked: PrimitiveSpec = { ...target, locked: true }
    const small: PrimitiveSpec = { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }

    const unsupported = resolveGeometryEdit([point], { kind: "offset", distance: 2 }, { nextId: "x" })
    const lock = resolveGeometryEdit([locked], { kind: "offset", distance: 2 }, { nextId: "x" })
    const collapse = resolveGeometryEdit([small], { kind: "offset", distance: -5 }, { nextId: "x" })

    if (!unsupported.ok) expect(unsupported.error).toContain("不支持")
    if (!lock.ok) expect(lock.error).toContain("锁定")
    if (!collapse.ok) expect(collapse.error).toContain("半径")
  })
})

describe("trim and extend requests", () => {
  it("needs a boundary and a target, in that selection order", () => {
    const onlyOne = resolveGeometryEdit([target], { kind: "trim" }, { nextId: "x" })
    expect(onlyOne.ok).toBe(false)
    if (!onlyOne.ok) expect(onlyOne.error).toContain("边界")
  })

  it("keeps the half that owns the target's first endpoint", () => {
    expect(resolveGeometryEdit([boundary, target], { kind: "trim" }, { nextId: "x" })).toEqual({
      ok: true,
      kind: "update",
      id: "s",
      patch: { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }
    })
  })

  it("extends the far end out to the boundary", () => {
    expect(resolveGeometryEdit([cutter, short], { kind: "extend" }, { nextId: "x" })).toEqual({
      ok: true,
      kind: "update",
      id: "short",
      patch: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    })
  })

  it("reports when the boundary does not cut or lie ahead", () => {
    const far: PrimitiveSpec = { id: "far", type: "segment", a: { x: 40, y: -5 }, b: { x: 40, y: 5 } }
    const trim = resolveGeometryEdit([far, target], { kind: "trim" }, { nextId: "x" })
    const extend = resolveGeometryEdit([boundary, target], { kind: "extend" }, { nextId: "x" })

    expect(trim.ok).toBe(false)
    expect(extend.ok).toBe(false)
    if (!trim.ok) expect(trim.error).toContain("交点")
    if (!extend.ok) expect(extend.error).toContain("交点")
  })

  it("refuses to edit a locked target", () => {
    const lockedTarget: PrimitiveSpec = { ...target, locked: true }
    const result = resolveGeometryEdit([boundary, lockedTarget], { kind: "trim" }, { nextId: "x" })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("锁定")
  })

  it("says so when the target type has no endpoints to trim", () => {
    const circle: PrimitiveSpec = { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 5 }
    const result = resolveGeometryEdit([boundary, circle], { kind: "trim" }, { nextId: "x" })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("只支持直线、线段和射线")
  })
})

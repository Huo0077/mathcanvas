import { describe, expect, it } from "vitest"

import { applyAngle, applyDistance, formatDraftCoordinate, parseDraftAngle, parseDraftCoordinate, parseDraftDistance } from "./draftCoordinate"

const last = { x: 10, y: 5 }

describe("absolute coordinates", () => {
  it("accepts comma or space separated pairs", () => {
    expect(parseDraftCoordinate("12,34")).toEqual({ ok: true, point: { x: 12, y: 34 } })
    expect(parseDraftCoordinate("12 34")).toEqual({ ok: true, point: { x: 12, y: 34 } })
    expect(parseDraftCoordinate("  12 , 34  ")).toEqual({ ok: true, point: { x: 12, y: 34 } })
  })

  it("accepts full-width punctuation and negative decimals", () => {
    // 中文输入法下很容易打出全角逗号，直接当分隔符处理，不要让用户去改输入法。
    expect(parseDraftCoordinate("12，34")).toEqual({ ok: true, point: { x: 12, y: 34 } })
    expect(parseDraftCoordinate("-5.5,3")).toEqual({ ok: true, point: { x: -5.5, y: 3 } })
  })
})

describe("relative and polar coordinates", () => {
  it("offsets from the last point with @", () => {
    expect(parseDraftCoordinate("@10,5", { last })).toEqual({ ok: true, point: { x: 20, y: 10 } })
  })

  it("reads @distance<angle as polar", () => {
    const result = parseDraftCoordinate("@10<90", { last })
    expect(result.ok && result.point.x).toBeCloseTo(10, 9)
    expect(result.ok && result.point.y).toBeCloseTo(15, 9)
  })

  it("refuses relative input without a base point instead of guessing the origin", () => {
    expect(parseDraftCoordinate("@10,5")).toMatchObject({ ok: false })
    expect(parseDraftCoordinate("@10,5")).toMatchObject({ error: expect.stringContaining("基点") })
  })
})

describe("rejected input", () => {
  it("explains what it expected", () => {
    for (const input of ["", "abc", "10,", ",10", "@", "@10<", "1e999,0"]) {
      const result = parseDraftCoordinate(input, { last })
      expect(result.ok, `${input} 应该被拒绝`).toBe(false)
    }
  })

  it("keeps the error message short enough for the toolbar hint", () => {
    const result = parseDraftCoordinate("abc")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeLessThanOrEqual(40)
  })
})

describe("dynamic input fields", () => {
  it("reads a positive distance", () => {
    expect(parseDraftDistance("30")).toEqual({ ok: true, value: 30 })
    expect(parseDraftDistance(" 12.5 ")).toEqual({ ok: true, value: 12.5 })
    expect(parseDraftDistance("0")).toMatchObject({ ok: false })
    expect(parseDraftDistance("-3")).toMatchObject({ ok: false })
    expect(parseDraftDistance("abc")).toMatchObject({ ok: false })
  })

  it("normalises angles into 0–360", () => {
    expect(parseDraftAngle("90")).toEqual({ ok: true, value: 90 })
    expect(parseDraftAngle("450")).toEqual({ ok: true, value: 90 })
    expect(parseDraftAngle("-90")).toEqual({ ok: true, value: 270 })
    expect(parseDraftAngle("abc")).toMatchObject({ ok: false })
  })

  it("moves the point along the current direction when only the length is typed", () => {
    // 锚点在原点、指针在 (3,4) 方向：输入 10 就把点放到该方向的 10 处。
    const point = applyDistance({ x: 0, y: 0 }, { x: 3, y: 4 }, 10)

    expect(point.x).toBeCloseTo(6, 9)
    expect(point.y).toBeCloseTo(8, 9)
  })

  it("keeps the pointer distance and only overrides the angle", () => {
    const point = applyAngle({ x: 0, y: 0 }, { x: 3, y: 4 }, 90)

    expect(point.x).toBeCloseTo(0, 9)
    expect(point.y).toBeCloseTo(5, 9)
  })

  it("falls back to the +x direction when the pointer sits on the anchor", () => {
    expect(applyDistance({ x: 2, y: 2 }, { x: 2, y: 2 }, 5)).toEqual({ x: 7, y: 2 })
  })

  it("formats a coordinate for the readout", () => {
    expect(formatDraftCoordinate({ x: 12.3456, y: -3 })).toBe("12.346, -3")
  })
})

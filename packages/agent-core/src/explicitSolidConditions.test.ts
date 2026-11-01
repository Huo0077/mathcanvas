import { describe, expect, it } from "vitest"

import { hasExplicitSolidConditions, readExplicitSolidConditions } from "./explicitSolidConditions"

const SPHERE = "画一个球体，球心 (1,2,3)，半径 5"
const PRISM = "画一个斜棱柱，底面边长 4，高 8"

describe("explicit solid conditions", () => {
  it("reads the sphere center and radius without treating the center numbers as the radius", () => {
    const conditions = readExplicitSolidConditions(SPHERE)
    expect(conditions.sphere.center).toMatchObject({ status: "parsed", value: { x: 1, y: 2, z: 3 } })
    expect(conditions.sphere.radius).toMatchObject({ status: "parsed", value: 5 })
    expect(conditions.issues).toEqual([])
    expect(hasExplicitSolidConditions(SPHERE)).toBe(true)
  })

  it("reads the same sphere when the radius is written before the center", () => {
    const conditions = readExplicitSolidConditions("画一个球体，半径 5，球心 (-2, 0.5, 3.25)")
    expect(conditions.sphere.center.value).toEqual({ x: -2, y: 0.5, z: 3.25 })
    expect(conditions.sphere.radius.value).toBe(5)
    expect(conditions.issues).toEqual([])
  })

  it("accepts Chinese punctuation, full-width minus and the origin", () => {
    const conditions = readExplicitSolidConditions("画一个球体，球心（−1，2.5，−3），半径 4。")
    expect(conditions.sphere.center.value).toEqual({ x: -1, y: 2.5, z: -3 })
    expect(conditions.sphere.radius.value).toBe(4)
    expect(readExplicitSolidConditions("画一个球体，球心在原点，半径 5").sphere.center.value).toEqual({ x: 0, y: 0, z: 0 })
  })

  it("distinguishes an absent field from a provided one", () => {
    const centerOnly = readExplicitSolidConditions("画一个球体，球心 (1,2,3)")
    expect(centerOnly.sphere.center.status).toBe("parsed")
    expect(centerOnly.sphere.radius.status).toBe("absent")
    const radiusOnly = readExplicitSolidConditions("画一个球体，半径 5")
    expect(radiusOnly.sphere.radius.status).toBe("parsed")
    expect(radiusOnly.sphere.center.status).toBe("absent")
    const noDimensions = readExplicitSolidConditions("画一个球体")
    expect(noDimensions.sphere.radius.status).toBe("absent")
    expect(noDimensions.sphere.center.status).toBe("absent")
    expect(hasExplicitSolidConditions("画一个球体")).toBe(false)
  })

  it("accepts a repeated value only when the values agree", () => {
    const consistent = readExplicitSolidConditions("画一个球体，球心 (1,2,3)，球心为 (1,2,3)，半径 5，半径 5")
    expect(consistent.issues).toEqual([])
    expect(consistent.sphere.center.value).toEqual({ x: 1, y: 2, z: 3 })
    expect(consistent.sphere.radius.value).toBe(5)
    const conflict = readExplicitSolidConditions("画一个球体，球心 (1,2,3)，球心 (1,2,4)，半径 5")
    expect(conflict.sphere.center.status).toBe("invalid")
    expect(conflict.sphere.center.reason).toMatch(/矛盾|冲突/)
    expect(conflict.issues.some((issue) => issue.field === "sphere.center")).toBe(true)
  })

  it("rejects invalid or unsupported sphere numbers instead of falling back", () => {
    for (const [prompt, pattern] of [
      ["画一个球体，半径 0", /正数/],
      ["画一个球体，半径 -2", /正数/],
      ["画一个球体，半径 1/2", /分数/],
      ["画一个球体，半径 1e999", /科学计数法/],
      ["画一个球体，半径 2√", /根式/],
      ["画一个球体，半径 1000001", /过大/]
    ] as const) {
      const conditions = readExplicitSolidConditions(prompt)
      expect(conditions.sphere.radius.status, prompt).toBe("invalid")
      expect(conditions.sphere.radius.reason, prompt).toMatch(pattern)
      expect(conditions.issues.some((issue) => issue.field === "sphere.radius"), prompt).toBe(true)
    }
  })

  it("reads a supported radical sphere radius as the whole value", () => {
    const conditions = readExplicitSolidConditions("画一个球体，半径 2√3")
    expect(conditions.sphere.radius.status).toBe("parsed")
    expect(conditions.sphere.radius.value).toBeCloseTo(2 * Math.sqrt(3), 12)
  })

  it("rejects a malformed sphere center instead of silently using the origin", () => {
    const conditions = readExplicitSolidConditions("画一个球体，球心 (1,2)，半径 5")
    expect(conditions.sphere.center.status).toBe("invalid")
    expect(conditions.sphere.center.reason).toMatch(/三个坐标|球心/)
    expect(conditions.issues.some((issue) => issue.field === "sphere.center")).toBe(true)
  })

  it("reads prism base edge and vertical height independently", () => {
    const conditions = readExplicitSolidConditions(PRISM)
    expect(conditions.prism.baseEdge).toMatchObject({ status: "parsed", value: 4 })
    expect(conditions.prism.height).toMatchObject({ status: "parsed", value: 8 })
    expect(conditions.issues).toEqual([])
  })

  it("does not turn a height-only prism request into a base edge", () => {
    const heightOnly = readExplicitSolidConditions("画一个斜棱柱，高 8")
    expect(heightOnly.prism.height.value).toBe(8)
    expect(heightOnly.prism.baseEdge.status).toBe("absent")
    const baseOnly = readExplicitSolidConditions("画一个斜棱柱，底面边长 4")
    expect(baseOnly.prism.baseEdge.value).toBe(4)
    expect(baseOnly.prism.height.status).toBe("absent")
  })

  it("rejects conflicting repeated prism dimensions and unsupported expressions", () => {
    const conflict = readExplicitSolidConditions("画一个斜棱柱，底面边长 4，底面边长 5，高 8")
    expect(conflict.prism.baseEdge.status).toBe("invalid")
    expect(conflict.prism.baseEdge.reason).toMatch(/矛盾|冲突/)
    for (const [prompt, pattern] of [
      ["画一个斜棱柱，高 0", /正数/],
      ["画一个斜棱柱，底面边长 -4", /正数/],
      ["画一个斜棱柱，高 1/2", /分数/],
      ["画一个斜棱柱，高 1e999", /科学计数法/],
      ["画一个斜棱柱，高 √", /根式/]
    ] as const) {
      const conditions = readExplicitSolidConditions(prompt)
      const field = prompt.includes("底面边长") ? conditions.prism.baseEdge : conditions.prism.height
      expect(field.status, prompt).toBe("invalid")
      expect(field.reason, prompt).toMatch(pattern)
    }
  })
})

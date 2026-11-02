import { describe, expect, it } from "vitest"

import { directlyRequestsPrism, hasExplicitSolidConditions, readExplicitSolidConditions } from "./explicitSolidConditions"

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

  it("treats a generic prism with explicit dimensions as a direct request", () => {
    const conditions = readExplicitSolidConditions("画一个棱柱，底面边长 4，高 8")
    expect(conditions.prism.requested).toBe(true)
    expect(conditions.prism.baseEdge.value).toBe(4)
    expect(conditions.prism.height.value).toBe(8)
    expect(hasExplicitSolidConditions("画一个棱柱，底面边长 4，高 8")).toBe(true)
  })

  it("treats a label with no value as missing information, not as absent", () => {
    for (const prompt of ["画一个斜棱柱，高", "画一个斜棱柱，底面边长", "画一个球体，半径"]) {
      const conditions = readExplicitSolidConditions(prompt)
      const value = prompt.includes("半径") ? conditions.sphere.radius : prompt.includes("边长") ? conditions.prism.baseEdge : conditions.prism.height
      expect(value.status, prompt).toBe("invalid")
      expect(value.reason, prompt).toMatch(/没有数值/)
    }
  })

  it("reads prism orientation and base side count", () => {
    expect(readExplicitSolidConditions("画一个直棱柱，底面边长 4，高 8").prism.shape).toMatchObject({ straight: true })
    expect(readExplicitSolidConditions("画一个正四棱柱，底面边长 4，高 8").prism.shape).toMatchObject({ sides: 4, regular: true, straight: true })
    expect(readExplicitSolidConditions("画一个三棱柱，底面边长 4，高 8").prism.shape).toMatchObject({ sides: 3 })
    expect(readExplicitSolidConditions("画一个正六棱柱，底面边长 4，高 8").prism.shape).toMatchObject({ sides: 6, regular: true, straight: true })
    expect(readExplicitSolidConditions("画一个斜四棱柱，底面边长 4，高 8").prism.shape).toMatchObject({ sides: 4, straight: false })
    expect(readExplicitSolidConditions("画一个正棱柱，底面边长 4，高 8").prism.shape).toMatchObject({ regular: true, straight: true })
    expect(readExplicitSolidConditions("画一个棱柱，底面边长 4，高 8").prism.shape).toEqual({})
  })

  it("does not split a spaced fraction, multiplication expression or π coefficient", () => {
    const spacedFraction = readExplicitSolidConditions("画一个球体，半径 1 / 2")
    expect(spacedFraction.sphere.radius.status).toBe("invalid")
    expect(spacedFraction.sphere.radius.reason).toMatch(/分数/)
    const multiplication = readExplicitSolidConditions("画一个球体，半径 5×2")
    expect(multiplication.sphere.radius.status).toBe("invalid")
    expect(multiplication.sphere.radius.reason).toMatch(/乘法/)
    const piWithSpace = readExplicitSolidConditions("画一个球体，半径 2 π")
    expect(piWithSpace.sphere.radius.status).toBe("parsed")
    expect(piWithSpace.sphere.radius.value).toBeCloseTo(2 * Math.PI, 12)
    const piWithFullWidthSpace = readExplicitSolidConditions("画一个球体，半径 2\u3000π")
    expect(piWithFullWidthSpace.sphere.radius.status).toBe("parsed")
    expect(piWithFullWidthSpace.sphere.radius.value).toBeCloseTo(2 * Math.PI, 12)
  })

  it("rejects internal whitespace in coordinates instead of concatenating digits", () => {
    const conditions = readExplicitSolidConditions("画一个球体，球心 (1 2,3,4)，半径 5")
    expect(conditions.sphere.center.status).toBe("invalid")
    expect(conditions.sphere.center.reason).toMatch(/坐标|十进制/)
    const fullWidth = readExplicitSolidConditions("画一个球体，球心 (1\u30002, 3, 4)，半径 5")
    expect(fullWidth.sphere.center.status).toBe("invalid")
  })

  it("rejects internal whitespace in a plain dimension", () => {
    const conditions = readExplicitSolidConditions("画一个球体，半径 1 2")
    expect(conditions.sphere.radius.status).toBe("invalid")
    expect(conditions.sphere.radius.reason).toMatch(/数值|无法识别/)
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

  it("matches direct prism requests across modifier orders, omitted verbs, creation verbs and multi-digit sides while excluding named prisms", () => {
    expect(readExplicitSolidConditions("画一个底面边长 5，高 8 的直棱柱").prism).toMatchObject({
      requested: true,
      baseEdge: { status: "parsed", value: 5 },
      height: { status: "parsed", value: 8 },
      shape: { straight: true }
    })
    expect(readExplicitSolidConditions("正三棱柱，底面边长 4，高 8").prism).toMatchObject({
      requested: true,
      shape: { sides: 3, regular: true, straight: true }
    })
    expect(readExplicitSolidConditions("添加一个正四棱柱，底面边长 6，高 9").prism).toMatchObject({
      requested: true,
      baseEdge: { status: "parsed", value: 6 },
      height: { status: "parsed", value: 9 },
      shape: { sides: 4, regular: true, straight: true }
    })
    expect(readExplicitSolidConditions("画一个正12棱柱").prism).toMatchObject({
      requested: true,
      shape: { sides: 12, regular: true, straight: true }
    })
    expect(readExplicitSolidConditions("斜棱柱，高 1/2").prism.height.status).toBe("invalid")
    expect(readExplicitSolidConditions("画直三棱柱 ABC-A₁B₁C₁，底面边长 4，高 8").prism.requested).toBe(false)
    expect(readExplicitSolidConditions("在直三棱柱中，底面边长为 4，高为 8").prism.requested).toBe(false)
  })

  it("rejects contradictory prism shape modifiers and invalid polygon side counts", () => {
    for (const prompt of [
      "画一个斜正四棱柱，底面边长 4，高 8",
      "画一个直棱柱，改成斜棱柱，底面边长 4，高 8",
      "画一个斜棱柱，改成直棱柱，底面边长 4，高 8",
      "画一个四棱柱，改成三棱柱，底面边长 4，高 8",
      "画一个二棱柱，底面边长 4，高 8",
      "画一个2棱柱，底面边长 4，高 8"
    ]) {
      const conditions = readExplicitSolidConditions(prompt)
      expect(conditions.prism.requested, prompt).toBe(true)
      expect(conditions.issues.some((issue) => issue.field === "prism.shape"), prompt).toBe(true)
    }
  })

  it("rejects superscript powers and trailing unit/variable letters instead of truncating the number", () => {
    for (const prompt of [
      "画一个球体，半径 2²",
      "画一个球体，半径 2³",
      "画一个球体，半径 5a",
      "画一个球体，半径 5cm"
    ]) {
      const conditions = readExplicitSolidConditions(prompt)
      expect(conditions.sphere.radius.status, prompt).toBe("invalid")
      expect(conditions.issues.some((issue) => issue.field === "sphere.radius"), prompt).toBe(true)
    }
  })

  it("preserves the exact prompt slice as sourceText when separators like '=' are used", () => {
    const conditions = readExplicitSolidConditions("画一个球体，球心 = (1, 2, 3)，半径 = 5")
    expect(conditions.sphere.center.sourceText).toBe("球心 = (1, 2, 3)")
    expect(conditions.sphere.radius.sourceText).toBe("半径 = 5")
  })

  it("does not treat complex rhombus/section/named-point prism problems as simple direct prism requests", () => {
    expect(directlyRequestsPrism("底面边长 2、一角 60° 的菱形斜四棱柱，侧棱向量 (1,0,4)，过三条棱的中点作截面，并让点 P 在边界上移动")).toBe(false)
  })
})

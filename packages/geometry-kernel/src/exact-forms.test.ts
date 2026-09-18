import { describe, expect, it } from "vitest"

import { exactFormOf } from "./exact-forms"

/**
 * 把测量出来的浮点数还原成精确形式（用户口径："能够识别到图中的小数，并且在功能内输出分数形式，
 * 无理数也能输出"）。
 *
 * 这一组只守"整数与分数"这一族，以及**识别不出来要如实说**这条纪律 —— 误报比漏报更糟。
 */
describe("exact form recognition: integers and fractions", () => {
  it("recognises integers and fractions", () => {
    expect(exactFormOf(3).form).toMatchObject({ kind: "integer", text: "3" })
    expect(exactFormOf(0.75).form).toMatchObject({ kind: "rational", text: "3/4" })
    expect(exactFormOf(-3.5).form).toMatchObject({ kind: "rational", text: "-7/2" })
    expect(exactFormOf(1 / 3).form).toMatchObject({ kind: "rational", text: "1/3" })
    // 浮点误差的经典例子：0.1 + 0.2 = 0.30000000000000004 ⇒ 仍然是 3/10。
    expect(exactFormOf(0.1 + 0.2).form).toMatchObject({ kind: "rational", text: "3/10" })
  })

  it("reports the residual and refuses values that are not exact forms", () => {
    const reading = exactFormOf(0.75)
    expect(reading.value).toBeCloseTo(0.75, 12)
    expect(Math.abs(reading.residual!)).toBeLessThanOrEqual(1e-9)
    // 0.1234567 不是分母 ≤ 64 的分数。
    expect(exactFormOf(0.1234567).form.kind).toBe("unrecognised")
  })

  it("refuses non-finite input instead of inventing a form", () => {
    expect(exactFormOf(Number.NaN).form.kind).toBe("unrecognised")
    expect(exactFormOf(Number.POSITIVE_INFINITY).form.kind).toBe("unrecognised")
    expect(exactFormOf(Number.NaN).residual).toBeNull()
  })
})

/**
 * 两个画布的角都统一到弧度了，所以 **π 的有理倍数**是角的读数最常见的精确形式
 *（π/2、π/3、2π/3…）。这一族只有角会用到，但它同时是"分数与无理数别打架"的试金石。
 */
describe("exact form recognition: rational multiples of pi", () => {
  it("recognises the angles a teaching canvas actually produces", () => {
    expect(exactFormOf(Math.PI).form).toMatchObject({ kind: "pi-multiple", text: "π" })
    expect(exactFormOf(Math.PI / 4).form).toMatchObject({ kind: "pi-multiple", text: "π/4" })
    expect(exactFormOf(2 * Math.PI).form).toMatchObject({ kind: "pi-multiple", text: "2π" })
    expect(exactFormOf(-3 * Math.PI / 2).form).toMatchObject({ kind: "pi-multiple", text: "-3π/2" })
    expect(exactFormOf(Math.PI / 6).form).toMatchObject({ kind: "pi-multiple", text: "π/6" })
  })

  it("does not mistake a plain fraction for a pi multiple, nor invent one", () => {
    // 0.75 必须仍是 3/4：π/4 ≈ 0.785398 差得远。
    expect(exactFormOf(0.75).form).toMatchObject({ kind: "rational", text: "3/4" })
    // 分母超过上限的 π 倍数应当如实未识别（1e-9 的容差下它也不可能被当成分数）。
    expect(exactFormOf(Math.PI / 100).form.kind).toBe("unrecognised")
  })
})

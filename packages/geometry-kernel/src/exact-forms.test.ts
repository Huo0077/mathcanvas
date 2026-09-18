import { describe, expect, it } from "vitest"

import { exactFormOf } from "./exact-forms"

/** 与内核里"输入自身十进制的半个单位"同一条规则：测试用它来钉住边界，而不是写死一个魔数。 */
function decimalWritingToleranceForTest(input: number): number {
  const text = Math.abs(input).toString()
  const decimals = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0
  return Math.max(Math.pow(10, -decimals) / 2, 1e-12)
}

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
 * 两级容差 + 两位小数兜底（2026-09-18，用户反馈"为什么会显示未识别为精确形式"）。
 *
 * 实测的根因：用户量出来的值常常是**简单分数的六位小数写法**（例如点的坐标是 `0.333333`，
 * 于是长度是 `0.666667`），而紧容差（相对 1e-9）会把它判成"不是 2/3"，显示"未识别"。
 * 现在：紧容差先认 → 不中再用松容差（相对 1e-4）认，并用 `≈` 标出这是近似匹配 →
 * 还是不中才**保留两位小数**，而且**不再出现"未识别"这句话**。
 */
describe("exact form recognition: two-level tolerance and the decimal fallback", () => {
  it("recovers a fraction from its rounded decimal form", () => {
    for (const [input, text] of [[0.666667, "≈ 2/3"], [0.333333, "≈ 1/3"], [1.333333, "≈ 4/3"], [0.142857, "≈ 1/7"], [0.1666667, "≈ 1/6"]] as const) {
      const reading = exactFormOf(input)
      expect({ input, form: reading.form, certainty: reading.certainty }).toMatchObject({ input, form: { kind: "rational", text }, certainty: "approximate" })
      // 确实是"按容差认出来的"：残差比紧容差大、但仍在输入自身精度允许的范围内。
      expect(reading.residual!).toBeGreaterThan(1e-9)
      expect(reading.residual!).toBeLessThanOrEqual(decimalWritingToleranceForTest(input))
    }
  })

  it("refuses a value that is NOT a rounding of the fraction it is near", () => {
    // 0.1666665 与 1/6 差 1.67e-7，而它自己带 7 位小数（半个单位是 5e-8）——差得比"写法误差"还大，
    // 说明它本来就不是 1/6 的七位小数写法（那个是 0.1666667）。这种情况必须落回两位小数。
    expect(exactFormOf(0.1666665).form).toMatchObject({ kind: "unrecognised", text: "≈ 0.17" })
  })

  it("keeps an exact match marked exact, without the approximation sign", () => {
    for (const value of [0.75, 1 / 3, Math.PI / 6, Math.SQRT2]) {
      expect({ value, certainty: exactFormOf(value).certainty }).toMatchObject({ value, certainty: "exact" })
      expect(exactFormOf(value).form.text.startsWith("≈")).toBe(false)
    }
  })

  it("falls back to two decimals instead of saying 未识别", () => {
    // 0.6435 最近的分数是 9/14（差 6.4e-4），超出松容差 ⇒ 不许硬凑，显示两位小数。
    expect(exactFormOf(0.6435).form).toMatchObject({ kind: "unrecognised", text: "≈ 0.64" })
    expect(exactFormOf(0.1234567).form.text).toBe("≈ 0.12")
    // e = 2.71828…：87/32 差 4.7e-4、106/39 差 3.3e-4，都在松容差之外 ⇒ 仍是两位小数。
    expect(exactFormOf(Math.E).form.text).toBe("≈ 2.72")
    expect(exactFormOf(Math.E).form.text).not.toContain("未识别")
  })

  it("still keeps the fallback honest: it reports how far the two-decimal value is", () => {
    const reading = exactFormOf(0.6435)
    expect(reading.certainty).toBe("approximate")
    expect(reading.residual!).toBeCloseTo(0.0035, 6)
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

/**
 * 二次无理数 `(a + b√n)/c` —— 用户选的是"这一层也要认"（深度 B）。
 * 课堂上的 √2、√2/2、(1+√5)/2、2+√3 都在这一族里。
 */
describe("exact form recognition: quadratic surds", () => {
  it("recognises the surds a teaching canvas produces", () => {
    expect(exactFormOf(Math.SQRT2).form).toMatchObject({ kind: "surd", text: "√2" })
    expect(exactFormOf(Math.SQRT2 / 2).form).toMatchObject({ kind: "surd", text: "√2/2" })
    expect(exactFormOf(2 + Math.sqrt(3)).form).toMatchObject({ kind: "surd", text: "2+√3" })
    expect(exactFormOf((1 + Math.sqrt(5)) / 2).form).toMatchObject({ kind: "surd", text: "(1+√5)/2" })
    expect(exactFormOf(-Math.sqrt(3) / 2).form).toMatchObject({ kind: "surd", text: "-√3/2" })
    expect(exactFormOf(3 * Math.sqrt(2)).form).toMatchObject({ kind: "surd", text: "3√2" })
  })

  it("refuses transcendentals and long decimals", () => {
    expect(exactFormOf(Math.E).form.kind).toBe("unrecognised")
    expect(exactFormOf(0.1234567).form.kind).toBe("unrecognised")
  })

  it("keeps the residual inside the tolerance for every family", () => {
    for (const value of [0.75, 1 / 3, Math.PI / 4, Math.SQRT2, (1 + Math.sqrt(5)) / 2]) {
      const reading = exactFormOf(value)
      expect(reading.form.kind).not.toBe("unrecognised")
      expect(Math.abs(reading.residual!)).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(value) * 1e-9))
    }
  })
})

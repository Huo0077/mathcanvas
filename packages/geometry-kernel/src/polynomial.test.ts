import { describe, expect, it } from "vitest"

import {
  coefficientsIn,
  eliminate,
  implicitize,
  isZeroPolynomial,
  polynomialAdd,
  polynomialDegree,
  polynomialDivideExact,
  polynomialEvaluate,
  polynomialFromTerms,
  polynomialMultiply,
  polynomialScale,
  polynomialSubtract,
  polynomialToString,
  rational,
  rationalFromNumber,
  rationalToNumber,
  rationalToString,
  resultant,
  sampleImplicitPolynomial,
  type Polynomial
} from "./polynomial"

const variables = ["x", "y"] as const

describe("exact rationals", () => {
  it("reduces to lowest terms and normalises the sign", () => {
    expect(rationalToString(rational(2n, -4n))).toBe("-1/2")
    expect(rationalToString(rational(6n, 3n))).toBe("2")
    expect(rationalToString(rational(-6n, -3n))).toBe("2")
  })

  it("rejects a zero denominator", () => {
    expect(() => rational(1n, 0n)).toThrow(/denominator/)
  })

  it("snaps floating point noise back to the intended fraction", () => {
    expect(rationalToString(rationalFromNumber(0.5))).toBe("1/2")
    expect(rationalToString(rationalFromNumber(0.25))).toBe("1/4")
    expect(rationalToString(rationalFromNumber(-3))).toBe("-3")
    expect(rationalToString(rationalFromNumber(1 / 3))).toBe("1/3")
    // The classic float artefact must not survive into the elimination.
    expect(rationalToString(rationalFromNumber(0.30000000000000004))).toBe("3/10")
    expect(rationalToNumber(rationalFromNumber(0.1))).toBeCloseTo(0.1, 15)
  })
})

describe("polynomial arithmetic", () => {
  it("builds and prints a polynomial", () => {
    const polynomial = polynomialFromTerms(["x", "y"], [
      { coefficient: 1, powers: { x: 2 } },
      { coefficient: 2, powers: { x: 1, y: 1 } },
      { coefficient: 1, powers: { y: 2 } }
    ])
    expect(polynomial.terms.size).toBe(3)
    expect(polynomialToString(polynomial)).toContain("x^2")
  })

  it("drops zero coefficients and treats them as the zero polynomial", () => {
    const cancelled = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 1 } }, { coefficient: -1, powers: { x: 1 } }])
    expect(isZeroPolynomial(cancelled)).toBe(true)
    const product = polynomialMultiply(cancelled, polynomialFromTerms(["x"], [{ coefficient: 5, powers: { x: 3 } }]))
    expect(isZeroPolynomial(product)).toBe(true)
  })

  it("agrees with a numeric reference for sum, difference and product", () => {
    const first = polynomialFromTerms(variables, [
      { coefficient: 1, powers: { x: 2 } },
      { coefficient: -2, powers: { x: 1, y: 1 } },
      { coefficient: 3, powers: { y: 2 } },
      { coefficient: 5, powers: {} }
    ])
    const second = polynomialFromTerms(variables, [
      { coefficient: 2, powers: { x: 1, y: 1 } },
      { coefficient: -1, powers: { y: 2 } },
      { coefficient: 4, powers: { x: 1 } }
    ])
    const referenceFirst = (x: number, y: number) => x * x - 2 * x * y + 3 * y * y + 5
    const referenceSecond = (x: number, y: number) => 2 * x * y - y * y + 4 * x
    const samples: [number, number][] = [[0, 0], [1, 2], [-1.5, 0.25], [3, -2], [0.5, 0.5]]
    for (const [x, y] of samples) {
      expect(polynomialEvaluate(polynomialAdd(first, second), { x, y })).toBeCloseTo(referenceFirst(x, y) + referenceSecond(x, y), 9)
      expect(polynomialEvaluate(polynomialSubtract(first, second), { x, y })).toBeCloseTo(referenceFirst(x, y) - referenceSecond(x, y), 9)
      expect(polynomialEvaluate(polynomialMultiply(first, second), { x, y })).toBeCloseTo(referenceFirst(x, y) * referenceSecond(x, y), 9)
    }
  })

  it("squares a binomial into the textbook expansion", () => {
    const sum = polynomialFromTerms(variables, [{ coefficient: 1, powers: { x: 1 } }, { coefficient: 1, powers: { y: 1 } }])
    const square = polynomialMultiply(sum, sum)
    expect(square.terms.size).toBe(3)
    for (const [x, y] of [[2, 3], [-1, 4], [0.5, -0.5]] as [number, number][]) {
      expect(polynomialEvaluate(square, { x, y })).toBeCloseTo((x + y) ** 2, 9)
    }
  })

  it("reports the degree per variable, including absent variables", () => {
    const polynomial = polynomialFromTerms(["x", "y", "z"], [
      { coefficient: 1, powers: { x: 3 } },
      { coefficient: 1, powers: { y: 1 } }
    ])
    expect(polynomialDegree(polynomial, "x")).toBe(3)
    expect(polynomialDegree(polynomial, "y")).toBe(1)
    expect(polynomialDegree(polynomial, "z")).toBe(0)
  })

  it("expands into coefficient polynomials per variable", () => {
    const polynomial = polynomialFromTerms(variables, [
      { coefficient: 1, powers: { x: 2 } },
      { coefficient: 3, powers: { x: 1, y: 1 } },
      { coefficient: 1, powers: { y: 2 } }
    ])
    const coefficients = coefficientsIn(polynomial, "x")
    expect(coefficients).toHaveLength(3)
    // coefficients[0] is y², [1] is 3y, [2] is 1.
    expect(polynomialEvaluate(coefficients[0], { y: 4 })).toBeCloseTo(16, 9)
    expect(polynomialEvaluate(coefficients[1], { y: 4 })).toBeCloseTo(12, 9)
    expect(polynomialEvaluate(coefficients[2], { y: 4 })).toBeCloseTo(1, 9)
  })

  it("scales by a fraction", () => {
    const polynomial = polynomialFromTerms(["x"], [{ coefficient: 4, powers: { x: 1 } }])
    expect(polynomialEvaluate(polynomialScale(polynomial, 0.25), { x: 4 })).toBeCloseTo(4, 12)
  })

  it("divides exactly when it can and refuses when it cannot", () => {
    const numerator = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 2 } }, { coefficient: -1, powers: {} }])
    const divisor = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 1 } }, { coefficient: -1, powers: {} }])
    const quotient = polynomialDivideExact(numerator, divisor)
    expect(quotient).not.toBeNull()
    for (const x of [0, 2, -3, 7]) expect(polynomialEvaluate(quotient!, { x })).toBeCloseTo(x + 1, 9)
    // x² + 1 is not divisible by x - 1.
    const notDivisible = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 2 } }, { coefficient: 1, powers: {} }])
    expect(polynomialDivideExact(notDivisible, divisor)).toBeNull()
    expect(polynomialDivideExact(numerator, polynomialFromTerms(["x"], []))).toBeNull()
  })

  it("clamps negative and fractional exponents", () => {
    const polynomial = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: -3 } }, { coefficient: 1, powers: { x: 1.6 } }])
    expect(polynomialDegree(polynomial, "x")).toBe(2)
  })
})

describe("resultant", () => {
  it("vanishes for polynomials that share a root", () => {
    const first = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 1 } }, { coefficient: -1, powers: {} }])
    const second = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 2 } }, { coefficient: -1, powers: {} }])
    const result = resultant(first, second, "x")
    expect(result).not.toBeNull()
    // x - 1 divides x² - 1, so the Sylvester determinant is exactly zero.
    expect(isZeroPolynomial(result!)).toBe(true)
  })

  it("computes the Sylvester determinant of two linear polynomials exactly", () => {
    const first = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 1 } }, { coefficient: -1, powers: {} }])
    const second = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 1 } }, { coefficient: -2, powers: {} }])
    const result = resultant(first, second, "x")
    // det [[1, -1], [1, -2]] = -1
    expect(polynomialEvaluate(result!, {})).toBeCloseTo(-1, 12)
  })

  it("evaluates a polynomial at the root of the other, up to sign", () => {
    const linear = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 1 } }, { coefficient: -2, powers: {} }])
    const quadratic = polynomialFromTerms(["x"], [{ coefficient: 1, powers: { x: 2 } }, { coefficient: 1, powers: {} }])
    const result = resultant(linear, quadratic, "x")
    // Res(x - 2, x² + 1) = 2² + 1 = 5
    expect(Math.abs(polynomialEvaluate(result!, {}))).toBeCloseTo(5, 9)
  })

  it("keeps the coefficients symbolic in the remaining variable", () => {
    // Res_x(x² - y, x - y) = y² - y, which vanishes exactly at y = 0 and y = 1.
    const first = polynomialFromTerms(variables, [{ coefficient: 1, powers: { x: 2 } }, { coefficient: -1, powers: { y: 1 } }])
    const second = polynomialFromTerms(variables, [{ coefficient: 1, powers: { x: 1 } }, { coefficient: -1, powers: { y: 1 } }])
    const result = resultant(first, second, "x")
    expect(result).not.toBeNull()
    expect(polynomialEvaluate(result!, { y: 0 })).toBeCloseTo(0, 9)
    expect(polynomialEvaluate(result!, { y: 1 })).toBeCloseTo(0, 9)
    expect(Math.abs(polynomialEvaluate(result!, { y: 2 }))).toBeGreaterThan(1e-6)
  })

  it("degrades gracefully when a polynomial is constant in the eliminated variable", () => {
    const constant = polynomialFromTerms(["x", "y"], [{ coefficient: 1, powers: { y: 1 } }])
    const quadratic = polynomialFromTerms(["x", "y"], [{ coefficient: 1, powers: { x: 2 } }, { coefficient: -1, powers: {} }])
    const result = resultant(constant, quadratic, "x")
    expect(result).not.toBeNull()
    // The result is y², so it vanishes at y = 0 and not at y = 1.
    expect(polynomialEvaluate(result!, { y: 0 })).toBeCloseTo(0, 9)
    expect(Math.abs(polynomialEvaluate(result!, { y: 1 }))).toBeGreaterThan(1e-9)
  })
})

describe("elimination", () => {
  /**
   * The headline result: P = (u, v) on the unit circle, A = (2, 0), M = (x, y) the midpoint of AP.
   * Eliminating u and v must produce the circle centred at (1, 0) with radius 1/2, i.e.
   * 4x² + 4y² - 8x + 3 = 0 up to a non-zero scalar multiple.
   */
  const buildEquations = (): Polynomial[] => {
    const all = ["u", "v", "x", "y"]
    return [
      polynomialFromTerms(all, [{ coefficient: 1, powers: { u: 2 } }, { coefficient: 1, powers: { v: 2 } }, { coefficient: -1, powers: {} }]),
      polynomialFromTerms(all, [{ coefficient: 2, powers: { x: 1 } }, { coefficient: -1, powers: { u: 1 } }, { coefficient: -2, powers: {} }]),
      polynomialFromTerms(all, [{ coefficient: 2, powers: { y: 1 } }, { coefficient: -1, powers: { v: 1 } }])
    ]
  }

  it("derives the midpoint locus equation by eliminating the moving point", () => {
    const elimination = eliminate(buildEquations(), ["u", "v"])
    expect(elimination).not.toBeNull()
    const polynomial = elimination!.polynomial
    expect(elimination!.eliminated).toEqual(["u", "v"])
    // u and v are gone from the equation: their degrees are now zero, even though the ring
    // keeps the full variable list so that exponent vectors stay positionally aligned.
    expect(polynomialDegree(polynomial, "u")).toBe(0)
    expect(polynomialDegree(polynomial, "v")).toBe(0)
    expect(polynomialDegree(polynomial, "x")).toBe(2)
    expect(polynomialDegree(polynomial, "y")).toBe(2)

    // Scale-invariant verification: normalise by the value at the origin, which should be 3k.
    const reference = polynomialEvaluate(polynomial, { x: 0, y: 0 })
    expect(Math.abs(reference)).toBeGreaterThan(1e-9)
    // (1, 0) gives 4 + 0 - 8 + 3 = -1, so the ratio must be -1/3.
    expect(polynomialEvaluate(polynomial, { x: 1, y: 0 }) / reference).toBeCloseTo(-1 / 3, 6)
    // (2, 0) gives 16 + 0 - 16 + 3 = 3, so the ratio must be 1.
    expect(polynomialEvaluate(polynomial, { x: 2, y: 0 }) / reference).toBeCloseTo(1, 6)
    // (1, 0.5) is the top of the circle: 4 + 1 - 8 + 3 = 0.
    expect(polynomialEvaluate(polynomial, { x: 1, y: 0.5 }) / reference).toBeCloseTo(0, 6)
  })

  it("confirms the eliminated equation against numerically sampled locus points", () => {
    const polynomial = eliminate(buildEquations(), ["u", "v"])!.polynomial
    const scale = Math.max(1, Math.abs(polynomialEvaluate(polynomial, { x: 0, y: 0 })))
    let worstOnCurve = 0
    let worstOffCurve = 0
    for (let index = 0; index <= 64; index += 1) {
      const u = -1 + (2 * index) / 64
      const v = Math.sqrt(Math.max(0, 1 - u * u))
      const x = 1 + u / 2
      const y = v / 2
      worstOnCurve = Math.max(worstOnCurve, Math.abs(polynomialEvaluate(polynomial, { x, y })) / scale)
      // Push the point radially outwards from the circle centre (1, 0) — it must leave the locus.
      const away = Math.hypot(x - 1, y) + 0.25
      const angle = Math.atan2(y, x - 1)
      const offX = 1 + away * Math.cos(angle)
      const offY = away * Math.sin(angle)
      worstOffCurve = Math.max(worstOffCurve, Math.abs(polynomialEvaluate(polynomial, { x: offX, y: offY })) / scale)
    }
    expect(worstOnCurve).toBeLessThan(1e-9)
    expect(worstOffCurve).toBeGreaterThan(1e-6)
  })

  it("flags that iterated resultants can leave extraneous factors", () => {
    const elimination = eliminate(buildEquations(), ["u", "v"])!
    expect(elimination.extraneous).toBe(true)
  })

  it("refuses an under-determined system instead of inventing a curve", () => {
    const all = ["u", "v", "x", "y"]
    const single = [polynomialFromTerms(all, [{ coefficient: 1, powers: { u: 2 } }, { coefficient: 1, powers: { v: 2 } }, { coefficient: -1, powers: {} }])]
    expect(eliminate(single, ["u", "v"])).toBeNull()
    expect(eliminate([], ["u"])).toBeNull()
    expect(eliminate(single, [])).toBeNull()
  })

  it("validates the parameters and coordinates given to implicitize", () => {
    const equations = buildEquations()
    expect(implicitize(equations, "u", ["x", "y"])).not.toBeNull()
    expect(implicitize(equations, "nope", ["x", "y"])).toBeNull()
    expect(implicitize(equations, "u", ["nope"])).toBeNull()
  })
})

describe("implicit curve sampling", () => {
  it("places every segment endpoint on the unit circle", () => {
    const circle = polynomialFromTerms(["x", "y"], [{ coefficient: 1, powers: { x: 2 } }, { coefficient: 1, powers: { y: 2 } }, { coefficient: -1, powers: {} }])
    const segments = sampleImplicitPolynomial(circle, ["x", "y"], { minX: -2, maxX: 2, minY: -2, maxY: 2 }, 48)
    expect(segments.length).toBeGreaterThan(0)
    for (const segment of segments) {
      for (const point of [segment.a, segment.b]) {
        expect(Math.abs(point.x * point.x + point.y * point.y - 1)).toBeLessThan(0.05)
      }
    }
  })

  it("finds nothing when the polynomial has no zero in the box", () => {
    const positive = polynomialFromTerms(["x", "y"], [{ coefficient: 1, powers: { x: 2 } }, { coefficient: 1, powers: { y: 2 } }, { coefficient: 1, powers: {} }])
    expect(sampleImplicitPolynomial(positive, ["x", "y"], { minX: -2, maxX: 2, minY: -2, maxY: 2 }, 24)).toEqual([])
  })

  it("draws the eliminated midpoint locus from its implicit equation alone", () => {
    const all = ["u", "v", "x", "y"]
    const equations = [
      polynomialFromTerms(all, [{ coefficient: 1, powers: { u: 2 } }, { coefficient: 1, powers: { v: 2 } }, { coefficient: -1, powers: {} }]),
      polynomialFromTerms(all, [{ coefficient: 2, powers: { x: 1 } }, { coefficient: -1, powers: { u: 1 } }, { coefficient: -2, powers: {} }]),
      polynomialFromTerms(all, [{ coefficient: 2, powers: { y: 1 } }, { coefficient: -1, powers: { v: 1 } }])
    ]
    const polynomial = eliminate(equations, ["u", "v"])!.polynomial
    const segments = sampleImplicitPolynomial(polynomial, ["x", "y"], { minX: -1, maxX: 3, minY: -1, maxY: 1 }, 64)
    expect(segments.length).toBeGreaterThan(0)
    // Every drawn point must sit on the circle centred at (1, 0) with radius 1/2.
    for (const segment of segments) {
      for (const point of [segment.a, segment.b]) {
        expect(Math.abs(Math.hypot(point.x - 1, point.y) - 0.5)).toBeLessThan(0.05)
      }
    }
  })
})

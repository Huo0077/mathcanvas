import {
  conicResidualAt,
  evaluateExpressionWithDomain,
  extractExpressionDomains,
  parseExpression,
  parseRelationConstraint,
  parseSymbolicConicEquation,
  solveSymbolicConicContract
} from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

describe("T04 AST domain preservation and resource budgets", () => {
  it("preserves denominator domain in x/x without cancelling to 1 and rejects x=0", () => {
    const domains = extractExpressionDomains("x / x")
    expect(domains).toEqual([{ kind: "nonzero", expression: "x" }])
    const zeroEval = evaluateExpressionWithDomain("x / x", { x: 0 })
    expect(zeroEval.ok).toBe(false)
    if (!zeroEval.ok) expect(zeroEval.error).toMatch(/division by zero|zero/i)

    const validEval = evaluateExpressionWithDomain("x / x", { x: 3 })
    expect(validEval).toMatchObject({ ok: true, value: 1 })
  })

  it("rejects division by zero, negative radicand, unknown functions, and excessive length or recursion depth", () => {
    expect(evaluateExpressionWithDomain("1 / 0", {})).toMatchObject({ ok: false })
    expect(evaluateExpressionWithDomain("sqrt(-1)", {})).toMatchObject({ ok: false })
    expect(evaluateExpressionWithDomain("ln(0)", {})).toMatchObject({ ok: false })
    expect(() => parseExpression("foo(x)")).toThrow(/unknown function|unsupported function/i)

    const tooDeep = `${"(".repeat(30)}x+1${")".repeat(30)}`
    expect(() => parseExpression(tooDeep)).toThrow(/depth|budget/i)

    const tooLong = Array.from({ length: 200 }, () => "x+1").join("+")
    expect(() => parseExpression(tooLong)).toThrow(/length|budget/i)
  })

  it("evaluates safely via pure AST traversal without dynamic code execution", () => {
    expect(() => parseExpression("process.exit(1)")).toThrow()
    expect(evaluateExpressionWithDomain("(a+b)^2/(a+b)", { a: 2, b: -2 })).toMatchObject({ ok: false })
  })

  it("parses chained inequalities and Unicode superscripts and rejects invalid non-positive semi-axes", () => {
    const chain = parseRelationConstraint("a>b>0")
    expect(chain.operators).toEqual([">", ">"])
    expect(chain.variables).toEqual(["a", "b"])

    expect(() => parseRelationConstraint("a<b<")).toThrow()
    expect(() => parseRelationConstraint("a<b>c")).toThrow(/monotonic|mixed/i)

    const badDomain = parseSymbolicConicEquation("x²/a²+y²/b²=1", ["a<=0", "b>0"])
    expect(badDomain.ok).toBe(false)
  })
})

describe("T04 symbolic conic axis alignment, underdetermined cases, and independent checks", () => {
  it("distinguishes axis swaps under a>b>0", () => {
    const xMajor = parseSymbolicConicEquation("x²/a²+y²/b²=1", ["a>b>0"])
    expect(xMajor).toMatchObject({ ok: true, kind: "ellipse", resolvedAxis: "x" })

    const yMajorFirst = parseSymbolicConicEquation("y²/a²+x²/b²=1", ["a>b>0"])
    expect(yMajorFirst).toMatchObject({ ok: true, kind: "ellipse", resolvedAxis: "y" })

    const yMajorSwapped = parseSymbolicConicEquation("x²/b²+y²/a²=1", ["a>b>0"])
    expect(yMajorSwapped).toMatchObject({ ok: true, kind: "ellipse", resolvedAxis: "y" })
  })

  it("reports underdetermined when only eccentricity is given and never invents a=2", () => {
    const eq = parseSymbolicConicEquation("x²/a²+y²/b²=1", ["a>b>0"])
    expect(eq.ok).toBe(true)
    if (!eq.ok) return
    const result = solveSymbolicConicContract(eq, [{ kind: "eccentricity", value: Math.SQRT2 / 2 }], ["a>b>0"])
    expect(result.status).toBe("underdetermined")
  })

  it("solves GK-P01 ellipse and independently checks a²-b²=c², e=c/a, 2a=4, and curve residual", () => {
    const eq = parseSymbolicConicEquation("x²/a²+y²/b²=1", ["a>b>0"])
    expect(eq.ok).toBe(true)
    if (!eq.ok) return

    const solved = solveSymbolicConicContract(
      eq,
      [
        { kind: "eccentricity", value: Math.SQRT2 / 2 },
        { kind: "majorAxisLength", value: 4 }
      ],
      ["a>b>0"]
    )
    expect(solved.status).toBe("solved")
    if (solved.status !== "solved") return

    expect(solved.conic).toEqual({ kind: "ellipse", radiusX: 2, radiusY: expect.closeTo(Math.SQRT2, 9) })
    expect(solved.parameterValues.a).toBeCloseTo(2, 9)
    expect(solved.parameterValues.b).toBeCloseTo(Math.SQRT2, 9)
    expect(solved.parameterValues.c).toBeCloseTo(Math.SQRT2, 9)
    expect(solved.independentCheck.passed).toBe(true)
    expect(solved.independentCheck.residual).toBeLessThan(1e-9)

    const ellipsePrimitive = {
      id: "c",
      type: "ellipse" as const,
      center: { x: 0, y: 0 },
      radiusX: solved.parameterValues.a!,
      radiusY: solved.parameterValues.b!
    }
    expect(conicResidualAt(ellipsePrimitive, { x: 2, y: 0 })?.residual ?? 1).toBeLessThan(1e-9)
    expect(conicResidualAt(ellipsePrimitive, { x: 0, y: Math.SQRT2 })?.residual ?? 1).toBeLessThan(1e-9)
  })

  it("solves GK-P08 and arbitrary hyperbola asymptote-circle tangency via general quadratic check", () => {
    const gkP08 = parseSymbolicConicEquation("y²-x²/m²=1", ["m>0"])
    expect(gkP08).toMatchObject({ ok: true, kind: "hyperbola", resolvedAxis: "y" })
    if (!gkP08.ok) return

    const solvedP08 = solveSymbolicConicContract(
      gkP08,
      [{ kind: "asymptoteTangentCircle", circle: { centerX: 0, centerY: 2, radius: 1 } }],
      ["m>0"]
    )
    expect(solvedP08.status).toBe("solved")
    if (solvedP08.status !== "solved") return

    expect(solvedP08.parameterValues.m).toBeCloseTo(1 / Math.sqrt(3), 9)
    expect(solvedP08.conic).toEqual({
      kind: "hyperbola",
      axis: "y",
      radiusX: expect.closeTo(1 / Math.sqrt(3), 9),
      radiusY: 1
    })
    expect(solvedP08.independentCheck.passed).toBe(true)
    expect(solvedP08.independentCheck.tangencyPoints).toHaveLength(2)
    for (const pt of solvedP08.independentCheck.tangencyPoints ?? []) {
      // Back-substitute into circle x² + y² - 4y + 3 = 0 and into asymptotes x ± m y = 0.
      expect(Math.abs(pt.x * pt.x + pt.y * pt.y - 4 * pt.y + 3)).toBeLessThan(1e-9)
      const asymptoteResidual = Math.min(
        Math.abs(pt.x - solvedP08.parameterValues.m! * pt.y),
        Math.abs(pt.x + solvedP08.parameterValues.m! * pt.y)
      )
      expect(asymptoteResidual).toBeLessThan(1e-9)
    }

    // General parameter case (proves no hardcoded GK-P08 value):
    // y²/4 - x²/m² = 1 (ry = 2, rx = m) with asymptotes 2x ± my = 0 tangent to circle (0, 3), r = 1:
    // distance = |3m| / sqrt(4 + m²) = 1 => 9m² = 4 + m² => m² = 1/2 => m = 1/sqrt(2)
    const generalEq = parseSymbolicConicEquation("y²/4-x²/m²=1", ["m>0"])
    expect(generalEq.ok).toBe(true)
    if (!generalEq.ok) return
    const generalSolved = solveSymbolicConicContract(
      generalEq,
      [{ kind: "asymptoteTangentCircle", circle: { centerX: 0, centerY: 3, radius: 1 } }],
      ["m>0"]
    )
    expect(generalSolved.status).toBe("solved")
    if (generalSolved.status !== "solved") return
    expect(generalSolved.parameterValues.m).toBeCloseTo(1 / Math.sqrt(2), 9)
    expect(generalSolved.independentCheck.passed).toBe(true)
  })
})

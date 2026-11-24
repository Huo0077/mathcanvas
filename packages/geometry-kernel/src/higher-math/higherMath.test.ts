import { describe, expect, it } from "vitest"

import {
  DOUBLE_INTEGRAL_PRESETS,
  EXTREMA_1D_PRESETS,
  FOURIER_PRESETS,
  LAGRANGE_PRESETS,
  LINALG_PRESETS,
  ODE_1D_PRESETS,
  PDE_PRESETS,
  PHASE_PLANE_PRESETS,
  PROBABILITY_PRESETS,
  SURFACE_3D_PRESETS,
  TAYLOR_PRESETS,
  analyzeDoubleIntegral,
  analyzeExtrema1D,
  analyzeFourierSeries,
  analyzeLagrange2D,
  analyzeLinearTransform2D,
  analyzeOdeSlopeField,
  analyzePhasePlane2D,
  analyzeProbabilityDistribution,
  analyzeSurface3D,
  analyzeTaylorSeries,
  compileScalarField1D,
  compileScalarField2D,
  computeFourierEpicycles,
  computeTangentPlane3D,
  createPdeState,
  evaluateDivCurlProbe,
  evaluateLagrangePoint,
  extractContoursFromGrid,
  injectPdeGaussianPulse,
  integrateOde1DBidirectional,
  integratePhaseTrajectoryBidirectional,
  liftConstraintCurvesTo3D,
  normalizeHigherMathInput,
  projectPointOntoConstraint,
  routeHigherMathPrompt,
  simulateCentralLimitTheorem,
  solvePoissonSteady2D,
  stepPdeSimulation
} from "./index"

describe("higher-math RPN bytecode evaluator", () => {
  it("normalizes university-style expressions and implicit equations", () => {
    expect(normalizeHigherMathInput("f(x) = x^3 - 3x + 1", "expression")).toBe("x^3 - 3x + 1")
    expect(normalizeHigherMathInput("z = x*y + sin(x)", "expression")).toBe("x*y + sin(x)")
    expect(normalizeHigherMathInput("x^2 + y^2 = 4", "implicit")).toBe("(x^2 + y^2) - (4)")
    expect(normalizeHigherMathInput("g(x, y) = x^2/9 + y^2/4 = 1", "implicit")).toBe("(x^2/9 + y^2/4) - (1)")
  })

  it("matches analytic values, gradients, and Hessians without eval", () => {
    const f = compileScalarField2D("x^3 - 3*x*y^2 + sin(y)")
    const x = 1.4
    const y = -0.6
    expect(f.eval(x, y)).toBeCloseTo(x ** 3 - 3 * x * y ** 2 + Math.sin(y), 12)
    expect(f.hasSymbolicGradient).toBe(true)

    const [fx, fy] = f.gradient(x, y)
    expect(fx).toBeCloseTo(3 * x ** 2 - 3 * y ** 2, 10)
    expect(fy).toBeCloseTo(-6 * x * y + Math.cos(y), 10)

    const h = f.hessian(x, y)
    expect(h.fxx).toBeCloseTo(6 * x, 10)
    expect(h.fxy).toBeCloseTo(-6 * y, 10)
    expect(h.fyy).toBeCloseTo(-6 * x - Math.sin(y), 10)
  })

  it("returns NaN safely on domain violations instead of throwing", () => {
    const f = compileScalarField1D("ln(x) + sqrt(x - 1)")
    expect(Number.isNaN(f.eval(-2))).toBe(true)
    expect(Number.isNaN(f.eval(0.5))).toBe(true)
    expect(f.eval(2)).toBeCloseTo(Math.log(2) + 1, 12)
  })
})

describe("1D extrema, global min/max, inflections, and asymptotes", () => {
  it("finds exact local extrema, endpoints, global max/min, and inflection on cubic polynomial", () => {
    const res = analyzeExtrema1D("x^3 - 3*x + 1", [-2.2, 2.5])
    const localMax = res.extrema.find((p) => p.kind === "local_max")
    const localMin = res.extrema.find((p) => p.kind === "local_min")

    expect(localMax).toBeDefined()
    expect(localMax!.x).toBeCloseTo(-1, 6)
    expect(localMax!.y).toBeCloseTo(3, 6)

    expect(localMin).toBeDefined()
    expect(localMin!.x).toBeCloseTo(1, 6)
    expect(localMin!.y).toBeCloseTo(-1, 6)

    // Right endpoint x = 2.5 gives 15.625 - 7.5 + 1 = 9.125 (Global Max)
    expect(res.globalMax).not.toBeNull()
    expect(res.globalMax!.x).toBeCloseTo(2.5, 6)
    expect(res.globalMax!.y).toBeCloseTo(9.125, 5)
    expect(res.globalMax!.kind).toBe("endpoint")

    // Left endpoint x = -2.2 gives -10.648 + 6.6 + 1 = -3.048 (Global Min)
    expect(res.globalMin).not.toBeNull()
    expect(res.globalMin!.x).toBeCloseTo(-2.2, 6)
    expect(res.globalMin!.y).toBeCloseTo(-3.048, 5)

    // Inflection point at x = 0, y = 1
    expect(res.inflections.length).toBe(1)
    expect(res.inflections[0]!.x).toBeCloseTo(0, 5)
    expect(res.inflections[0]!.y).toBeCloseTo(1, 5)
  })

  it("identifies non-differentiable cusp minima on abs(x^2 - 1) - 0.5*x", () => {
    const res = analyzeExtrema1D("abs(x^2 - 1) - 0.5*x", [-2, 2])
    const cusps = res.extrema.filter((p) => p.kind === "cusp_min")
    expect(cusps.length).toBe(2)
    expect(cusps[0]!.x).toBeCloseTo(-1, 5)
    expect(cusps[1]!.x).toBeCloseTo(1, 5)
    expect(cusps[1]!.isGlobalMin).toBe(true)
    expect(cusps[1]!.y).toBeCloseTo(-0.5, 5)
  })

  it("detects vertical and oblique asymptotes on (x^2 + 1)/(x - 1) and splits segments cleanly", () => {
    const res = analyzeExtrema1D("(x^2 + 1) / (x - 1)", [-4, 6])
    const vertical = res.asymptotes.find((a) => a.kind === "vertical")
    const oblique = res.asymptotes.find((a) => a.kind === "oblique")
    expect(vertical).toBeDefined()
    expect(vertical!.x).toBeCloseTo(1, 3)

    expect(oblique).toBeDefined()
    expect(oblique!.slope).toBeCloseTo(1, 2)
    expect(oblique!.intercept).toBeCloseTo(1, 2)

    expect(res.segments.length).toBeGreaterThanOrEqual(2)
    expect(res.unboundedAbove).toBe(true)
    expect(res.unboundedBelow).toBe(true)

    // Local max at x = 1 - sqrt(2) ≈ -0.4142, local min at x = 1 + sqrt(2) ≈ 2.4142
    const localMax = res.extrema.find((p) => p.kind === "local_max")
    const localMin = res.extrema.find((p) => p.kind === "local_min")
    expect(localMax?.x).toBeCloseTo(1 - Math.SQRT2, 4)
    expect(localMin?.x).toBeCloseTo(1 + Math.SQRT2, 4)
  })

  it("evaluates every built-in 1D preset cleanly", () => {
    for (const preset of EXTREMA_1D_PRESETS) {
      const res = analyzeExtrema1D(preset.expression, preset.domain)
      expect(res.segments.length).toBeGreaterThan(0)
      expect(res.extrema.length).toBeGreaterThan(0)
    }
  })
})

describe("Marching Squares contours and Lagrange multipliers solver", () => {
  it("chains a unit circle contour into a single closed polyline", () => {
    const f = compileScalarField2D("x^2 + y^2")
    const bounds = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }
    const grid = f.evalGrid(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, 64, 64)
    const polylines = extractContoursFromGrid(grid, bounds, 64, 64, 1)
    expect(polylines.length).toBe(1)
    const poly = polylines[0]!
    expect(poly.length).toBeGreaterThan(40)
    // Every extracted vertex should lie on x^2 + y^2 = 1 within grid discretization error
    for (const pt of poly) {
      expect(Math.hypot(pt.x, pt.y)).toBeCloseTo(1, 2)
    }
  })

  it("solves linear objective on circle x^2 + y^2 = 4 with exact tangent points and lambda", () => {
    const res = analyzeLagrange2D("x + 2*y", "x^2 + y^2 = 4", {
      xMin: -3.5, xMax: 3.5, yMin: -3.5, yMax: 3.5
    })
    expect(res.stationaryPoints.length).toBe(2)

    const maxPt = res.stationaryPoints.find((p) => p.isGlobalMax)
    const minPt = res.stationaryPoints.find((p) => p.isGlobalMin)
    expect(maxPt).toBeDefined()
    expect(minPt).toBeDefined()

    const sqrt5 = Math.sqrt(5)
    expect(maxPt!.x).toBeCloseTo(2 / sqrt5, 5)
    expect(maxPt!.y).toBeCloseTo(4 / sqrt5, 5)
    expect(maxPt!.value).toBeCloseTo(2 * sqrt5, 5)
    expect(maxPt!.lambda).toBeCloseTo(sqrt5 / 4, 5)
    expect(maxPt!.kind).toBe("constrained_max")

    expect(minPt!.x).toBeCloseTo(-2 / sqrt5, 5)
    expect(minPt!.y).toBeCloseTo(-4 / sqrt5, 5)
    expect(minPt!.value).toBeCloseTo(-2 * sqrt5, 5)
    expect(minPt!.kind).toBe("constrained_min")
  })

  it("solves classic Tongji ellipse-inscribed rectangle f=x*y, g=x^2/9 + y^2/4 = 1", () => {
    const res = analyzeLagrange2D("x * y", "x^2 / 9 + y^2 / 4 = 1", {
      xMin: -4, xMax: 4, yMin: -3, yMax: 3
    })
    expect(res.stationaryPoints.length).toBe(4)

    const maxes = res.stationaryPoints.filter((p) => p.kind === "constrained_max")
    const mins = res.stationaryPoints.filter((p) => p.kind === "constrained_min")
    expect(maxes.length).toBe(2)
    expect(mins.length).toBe(2)

    for (const pt of maxes) {
      expect(pt.value).toBeCloseTo(3, 5)
      expect(Math.abs(pt.x)).toBeCloseTo(3 / Math.SQRT2, 5)
      expect(Math.abs(pt.y)).toBeCloseTo(2 / Math.SQRT2, 5)
    }
    for (const pt of mins) {
      expect(pt.value).toBeCloseTo(-3, 5)
    }
  })

  it("projects dragged point onto implicit constraint and detects gradient collinearity", () => {
    const f = compileScalarField2D("x + 2*y", "expression")
    const g = compileScalarField2D("x^2 + y^2 = 4", "implicit")

    const projected = projectPointOntoConstraint(g, 1.0, 2.0)
    expect(projected).not.toBeNull()
    expect(Math.hypot(projected!.x, projected!.y)).toBeCloseTo(2, 6)

    const probe = evaluateLagrangePoint(f, g, projected!.x, projected!.y)
    expect(Math.abs(probe.gValue)).toBeLessThan(1e-6)
    expect(probe.collinearitySin).toBeLessThan(1e-4)
    expect(probe.isTangent).toBe(true)
    expect(probe.estimatedLambda).toBeCloseTo(Math.sqrt(5) / 4, 4)
  })

  it("solves all built-in Lagrange presets with at least 2 stationary points", () => {
    for (const preset of LAGRANGE_PRESETS) {
      const res = analyzeLagrange2D(preset.objective, preset.constraint, preset.bounds)
      expect(res.constraintCurves.length).toBeGreaterThan(0)
      expect(res.stationaryPoints.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe("ODE slope fields, RK45 integration, and 2D phase plane", () => {
  it("integrates y' = y accurately against analytic exp(x) via bidirectional RK45", () => {
    const f = compileScalarField2D("y", "expression")
    const bounds = { xMin: -2, xMax: 2, yMin: -1, yMax: 9 }
    const traj = integrateOde1DBidirectional(f, 0, 1, bounds)
    expect(traj.points.length).toBeGreaterThan(10)

    for (const pt of traj.points) {
      if (pt.x >= -1.8 && pt.x <= 1.8) {
        expect(pt.y).toBeCloseTo(Math.exp(pt.x), 3)
      }
    }
  })

  it("samples slope fields cleanly for all 1st-order ODE presets", () => {
    for (const preset of ODE_1D_PRESETS) {
      const slope = analyzeOdeSlopeField(preset.rhs, preset.bounds)
      expect(slope.samples.length).toBeGreaterThan(50)
    }
  })

  it("classifies equilibria and nullclines for damped pendulum and Lotka-Volterra", () => {
    const pendulum = analyzePhasePlane2D("y", "-sin(x) - 0.35*y", {
      xMin: -4.2, xMax: 4.2, yMin: -3, yMax: 3
    })
    expect(pendulum.pNullclines.length).toBeGreaterThan(0)
    expect(pendulum.qNullclines.length).toBeGreaterThan(0)

    const origin = pendulum.equilibria.find((eq) => Math.hypot(eq.x, eq.y) < 1e-2)
    expect(origin?.kind).toBe("stable_focus")

    const piSaddle = pendulum.equilibria.find((eq) => Math.hypot(eq.x - Math.PI, eq.y) < 1e-2)
    expect(piSaddle?.kind).toBe("saddle")

    const lv = analyzePhasePlane2D("1.2*x - 0.6*x*y", "0.4*x*y - 0.8*y", {
      xMin: -0.5, xMax: 4.5, yMin: -0.5, yMax: 4.5
    })
    const lvOrigin = lv.equilibria.find((eq) => Math.hypot(eq.x, eq.y) < 1e-2)
    const lvCenter = lv.equilibria.find((eq) => Math.hypot(eq.x - 2, eq.y - 2) < 1e-2)
    expect(lvOrigin?.kind).toBe("saddle")
    expect(lvCenter?.kind).toBe("center")

    // Verify harmonic oscillator trajectory preserves radius x^2 + y^2 = r^2
    const p = compileScalarField2D("y")
    const q = compileScalarField2D("-x")
    const orbit = integratePhaseTrajectoryBidirectional(p, q, 2, 0, {
      xMin: -3, xMax: 3, yMin: -3, yMax: 3
    })
    expect(orbit.points.length).toBeGreaterThan(20)
    for (const pt of orbit.points) {
      expect(Math.hypot(pt.x, pt.y)).toBeCloseTo(2, 3)
    }
  })

  it("evaluates all Phase Plane presets with equilibria", () => {
    for (const preset of PHASE_PLANE_PRESETS) {
      const res = analyzePhasePlane2D(preset.pExpr, preset.qExpr, preset.bounds)
      expect(res.vectors.length).toBeGreaterThan(50)
      expect(res.equilibria.length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe("3D surface extrema, saddle classification, tangent planes, and Lagrange lifting", () => {
  it("classifies local min and saddle on x^3 - 3*x + y^2 via Hessian AC - B^2", () => {
    const res = analyzeSurface3D("x^3 - 3*x + y^2", {
      xMin: -2.2, xMax: 2.2, yMin: -2.2, yMax: 2.2
    })
    expect(res.stationaryPoints.length).toBe(2)

    const saddle = res.stationaryPoints.find((p) => p.kind === "saddle")
    const minPt = res.stationaryPoints.find((p) => p.kind === "local_min")
    expect(saddle).toBeDefined()
    expect(saddle!.x).toBeCloseTo(-1, 4)
    expect(saddle!.y).toBeCloseTo(0, 4)
    expect(saddle!.z).toBeCloseTo(2, 4)
    expect(saddle!.discriminant).toBeCloseTo(-12, 3)

    expect(minPt).toBeDefined()
    expect(minPt!.x).toBeCloseTo(1, 4)
    expect(minPt!.y).toBeCloseTo(0, 4)
    expect(minPt!.z).toBeCloseTo(-2, 4)
    expect(minPt!.discriminant).toBeCloseTo(12, 3)

    const f = compileScalarField2D("x^3 - 3*x + y^2")
    const tp = computeTangentPlane3D(f, 1, 0)
    expect(tp?.equation).toBe("z = -2")
  })

  it("lifts 2D Lagrange constraint curve onto 3D surface with exact z = f(x, y)", () => {
    const bounds = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }
    const lag = analyzeLagrange2D("x + 2*y", "x^2 + y^2 = 4", bounds)
    const f = compileScalarField2D("x + 2*y")
    const lifted = liftConstraintCurvesTo3D(f, lag.constraintCurves)
    expect(lifted.length).toBeGreaterThan(0)
    for (const pt of lifted[0]!) {
      expect(pt.z).toBeCloseTo(pt.x + 2 * pt.y, 6)
    }
  })

  it("analyzes all built-in 3D surface presets cleanly", () => {
    for (const preset of SURFACE_3D_PRESETS) {
      const res = analyzeSurface3D(preset.expression, preset.bounds, { gridSize: 32 })
      expect(res.stationaryPoints.length).toBeGreaterThanOrEqual(1)
      expect(res.zMax).toBeGreaterThan(res.zMin)
    }
  })
})

describe("Phase 3: PDE solvers, Taylor & Fourier series, Double Integrals, and Div/Curl", () => {
  it("dissipates peak temperature in 2D heat equation and solves Laplace saddle accurately", () => {
    const init = createPdeState({
      kind: "heat2d",
      initialExpr: "2*exp(-3*(x^2 + y^2))",
      bounds: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
      gridSize: 32,
      boundary: "dirichlet"
    })
    const stepped = stepPdeSimulation(init, { dt: 0.12, param: 0.5 })
    expect(stepped.uMax).toBeLessThan(init.uMax)
    expect(stepped.energy).toBeLessThan(init.energy)

    const pulsed = injectPdeGaussianPulse(stepped, 0, 0, 2.0)
    expect(pulsed.uMax).toBeGreaterThan(stepped.uMax)

    // Laplace equation ∇²u = 0 with boundary x^2 - y^2 has exact harmonic solution u(x,y) = x^2 - y^2 -> u(0,0) = 0!
    const laplace = solvePoissonSteady2D("0", "x^2 - y^2", {
      xMin: -1, xMax: 1, yMin: -1, yMax: 1
    }, 32, 300)
    const midIdx = 16 * 33 + 16
    expect(laplace.state.u[midIdx]!).toBeCloseTo(0, 2)
    expect(laplace.fluxVectors.length).toBeGreaterThan(10)

    for (const p of PDE_PRESETS) {
      if (p.kind === "poisson2d") {
        const sol = solvePoissonSteady2D(p.initialExpr, p.boundaryExpr ?? "0", p.bounds, 28, 120)
        expect(sol.state.u.length).toBe(29 * 29)
      } else {
        const s0 = createPdeState({ kind: p.kind, initialExpr: p.initialExpr, bounds: p.bounds, gridSize: 28, boundary: p.boundary })
        const s1 = stepPdeSimulation(s0, { dt: 0.04, param: p.param })
        expect(s1.time).toBeCloseTo(0.04, 6)
      }
    }
  })

  it("computes machine-exact Taylor coefficients via Jet AD and Fourier Gibbs overshoot", () => {
    const sinTaylor = analyzeTaylorSeries("sin(x)", 0, 7)
    expect(sinTaylor.coefficients[0]!).toBeCloseTo(0, 12)
    expect(sinTaylor.coefficients[1]!).toBeCloseTo(1, 12)
    expect(sinTaylor.coefficients[3]!).toBeCloseTo(-1 / 6, 12)
    expect(sinTaylor.coefficients[5]!).toBeCloseTo(1 / 120, 12)
    expect(sinTaylor.coefficients[7]!).toBeCloseTo(-1 / 5040, 12)

    const geoTaylor = analyzeTaylorSeries("1 / (1 + x^2)", 0, 6)
    expect(geoTaylor.coefficients).toEqual([1, 0, -1, 0, 1, 0, -1])

    for (const tp of TAYLOR_PRESETS) {
      const res = analyzeTaylorSeries(tp.expression, tp.center, tp.order, tp.domain)
      expect(res.approxCurve.length).toBeGreaterThan(50)
    }

    // Square wave Fourier series exhibits classic ~18% of half-jump (~0.179 on [-1, 1]) Gibbs overshoot
    const sq = analyzeFourierSeries("square", 19, Math.PI)
    expect(sq.harmonics[0]!.bn).toBeCloseTo(4 / Math.PI, 3)
    expect(sq.harmonics[1]!.bn).toBeCloseTo(0, 5)
    expect(sq.peakOvershoot).toBeGreaterThan(0.14)
    expect(sq.peakOvershoot).toBeLessThan(0.22)

    const circles = computeFourierEpicycles(sq, 0.7)
    expect(circles.length).toBeGreaterThan(5)

    for (const fp of FOURIER_PRESETS) {
      const res = analyzeFourierSeries(fp.waveform, fp.harmonics, fp.halfPeriod)
      expect(res.approxCurve.length).toBeGreaterThan(100)
    }
  })

  it("verifies double integral Fubini order swap, polar Gaussian exact value, and div/curl probe", () => {
    // ∫_0^1 ∫_{x^2}^x (x + 2y) dy dx = ∫_0^1 [xy + y^2]_{x^2}^x dx = ∫_0^1 (2x^2 - x^3 - x^4) dx = 2/3 - 1/4 - 1/5 = 13/60
    const xyOrder = analyzeDoubleIntegral({
      integrandExpr: "x + 2*y",
      order: "xy",
      outerMinExpr: "0",
      outerMaxExpr: "1",
      innerMinExpr: "x^2",
      innerMaxExpr: "x",
      partitions: 16
    })
    const yxOrder = analyzeDoubleIntegral({
      integrandExpr: "x + 2*y",
      order: "yx",
      outerMinExpr: "0",
      outerMaxExpr: "1",
      innerMinExpr: "y",
      innerMaxExpr: "sqrt(y)",
      partitions: 16
    })
    expect(xyOrder.exactValue).toBeCloseTo(13 / 60, 6)
    expect(yxOrder.exactValue).toBeCloseTo(13 / 60, 6)
    expect(xyOrder.domainArea).toBeCloseTo(1 / 6, 6)
    expect(yxOrder.domainArea).toBeCloseTo(1 / 6, 5)

    // Polar Gaussian on first quadrant r in [0, 2], theta in [0, pi/2]: pi/4 * (1 - exp(-4))
    const polar = analyzeDoubleIntegral({
      integrandExpr: "exp(-(x^2 + y^2))",
      order: "polar",
      outerMinExpr: "0",
      outerMaxExpr: "pi / 2",
      innerMinExpr: "0",
      innerMaxExpr: "2",
      partitions: 14
    })
    expect(polar.exactValue).toBeCloseTo((Math.PI / 4) * (1 - Math.exp(-4)), 7)

    for (const dp of DOUBLE_INTEGRAL_PRESETS) {
      const res = analyzeDoubleIntegral(dp)
      expect(Number.isFinite(res.exactValue)).toBe(true)
    }

    // Div & Curl probe on F = (x - 2y, 3x + 4y): div = 1 + 4 = 5, curlZ = 3 - (-2) = 5
    const p = compileScalarField2D("x - 2*y")
    const q = compileScalarField2D("3*x + 4*y")
    const probe = evaluateDivCurlProbe(p, q, 1, -1)
    expect(probe.divergence).toBeCloseTo(5, 6)
    expect(probe.curlZ).toBeCloseTo(5, 6)
    expect(probe.divKind).toBe("source")
    expect(probe.curlKind).toBe("ccw")
  })
})

describe("Phase 4: Linear Algebra 2x2 SVD/Eigen, Probability & CLT, and Smart Problem Router", () => {
  it("computes exact eigenvalues, eigenvectors, rank, and SVD for symmetric, singular, and reflection matrices", () => {
    const sym = analyzeLinearTransform2D([[2, 1], [1, 2]], 1)
    expect(sym.determinant).toBeCloseTo(3, 8)
    expect(sym.rank).toBe(2)
    expect(sym.eigenvalues[0].re).toBeCloseTo(3, 8)
    expect(sym.eigenvalues[1].re).toBeCloseTo(1, 8)
    expect(sym.realEigenvectors.length).toBe(2)
    expect(sym.svd.sigma1).toBeCloseTo(3, 8)
    expect(sym.svd.sigma2).toBeCloseTo(1, 8)

    const rank1 = analyzeLinearTransform2D([[1.2, 0.6], [0.8, 0.4]], 1)
    expect(rank1.determinant).toBeCloseTo(0, 8)
    expect(rank1.rank).toBe(1)
    expect(rank1.orientation).toBe("singular")
    expect(rank1.svd.sigma2).toBeCloseTo(0, 7)

    for (const lp of LINALG_PRESETS) {
      const res = analyzeLinearTransform2D(lp.matrix, 0.5)
      expect(res.transformedCircle.length).toBeGreaterThan(30)
    }
  })

  it("computes accurate Normal / Chi-Square / Binomial probabilities and CLT standard error", () => {
    const stdNorm = analyzeProbabilityDistribution({
      kind: "normal",
      param1: 0,
      param2: 1,
      intervalA: -1.96,
      intervalB: 1.96
    })
    expect(stdNorm.intervalProb).toBeCloseTo(0.95, 3)

    const chi2 = analyzeProbabilityDistribution({
      kind: "chi_square",
      param1: 6,
      intervalA: 0,
      intervalB: 12.5916
    })
    expect(chi2.intervalProb).toBeCloseTo(0.95, 2)

    const binom = analyzeProbabilityDistribution({
      kind: "binomial",
      param1: 10,
      param2: 0.5,
      intervalA: 0,
      intervalB: 10
    })
    expect(binom.intervalProb).toBeCloseTo(1, 6)
    expect(binom.mean).toBeCloseTo(5, 6)

    for (const pp of PROBABILITY_PRESETS) {
      const res = analyzeProbabilityDistribution(pp)
      expect(res.intervalProb).toBeGreaterThan(0)
    }

    const clt = simulateCentralLimitTheorem({
      parent: "exponential",
      sampleSize: 25,
      numTrials: 2000,
      seed: 42
    })
    expect(clt.theoreticalMean).toBe(1)
    expect(clt.theoreticalStdError).toBeCloseTo(0.2, 6)
    expect(Math.abs(clt.empiricalMean - 1)).toBeLessThan(0.03)
    expect(Math.abs(clt.empiricalStdDev - 0.2)).toBeLessThan(0.03)
  })

  it("routes natural-language university math prompts to the exact target module", () => {
    const r1 = routeHigherMathPrompt("求 f(x) = x^3 - 3*x 在 [-2, 2] 的最值")
    expect(r1?.module).toBe("extrema1d")
    if (r1?.module === "extrema1d") {
      expect(r1.domain).toEqual([-2, 2])
    }

    const r2 = routeHigherMathPrompt("拉格朗日乘数法 求 f = x + 2*y 在 x^2 + y^2 = 5 下的极值")
    expect(r2?.module).toBe("lagrange")

    const r3 = routeHigherMathPrompt("矩阵 [[2, 1], [1, 2]] 的特征值与奇异值")
    expect(r3?.module).toBe("linalg")

    const r4 = routeHigherMathPrompt("正态分布 N(0, 4) 在 [-2, 2] 的概率")
    expect(r4?.module).toBe("probability")

    const r5 = routeHigherMathPrompt("中心极限定理 n = 20 指数分布")
    expect(r5?.module).toBe("probability")
    if (r5?.module === "probability") {
      expect(r5.subMode).toBe("clt")
      expect(r5.sampleSize).toBe(20)
    }
  })
})

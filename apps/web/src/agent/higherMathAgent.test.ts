import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import {
  DS_ACTION_CLOSED_SET,
  compilePlan,
  hasExplicitHigherMathIntent,
  routeDeterministicProblem
} from "@draw/agent-core"

import { useCalculusStore } from "../calculusStore"
import { buildDsActionToolSchemas, createDsActionSession } from "./dsActionTools"

describe("Agent University Higher-Math Problem Solving (Deterministic + LLM ds_action + Workbench Sync)", () => {
  describe("Zero-regression intent boundary", () => {
    it("never intercepts middle/high-school solid or conic geometry benchmarks", () => {
      expect(hasExplicitHigherMathIntent("已知正四棱锥 P-ABCD 的底面边长为 2，高为 3，求外接球半径")).toBe(false)
      expect(hasExplicitHigherMathIntent("已知椭圆 x^2/4 + y^2/3 = 1 的左右焦点为 F1, F2，求离心率")).toBe(false)
      expect(hasExplicitHigherMathIntent("在直三棱柱 ABC-A1B1C1 中，求线面角")).toBe(false)
    })

    it("preserves exact DS_ACTION_CLOSED_SET tool names while exposing higher-math metrics on query_measurement", () => {
      const schemas = buildDsActionToolSchemas()
      expect(schemas.map((s) => s.function.name)).toEqual([...DS_ACTION_CLOSED_SET])
      const qm = schemas.find((s) => s.function.name === "query_measurement")!
      const metricEnum = (qm.function.parameters as unknown as { properties: { metric: { enum: string[] } } }).properties.metric.enum
      expect(metricEnum).toEqual(
        expect.arrayContaining([
          "distance",
          "line_plane_angle",
          "calculus_1d",
          "taylor_series",
          "fourier_series",
          "lagrange_2d",
          "surface_3d",
          "ode_solve",
          "double_integral",
          "div_curl",
          "matrix_2x2",
          "probability"
        ])
      )
    })
  })

  describe("Deterministic Agent problem-solving across all 10 higher-math modules", () => {
    it("solves 1D closed-interval min/max & definite integral and compiles visual plan", () => {
      const route = routeDeterministicProblem("求 f(x) = x^3 - 3x 在 [-2, 3] 上的最大值与最小值及定积分")
      expect(route).not.toBeNull()
      expect(route!.plan.kind).toBe("plan")
      if (route!.plan.kind === "plan") {
        expect(route!.plan.answer).toContain("18")
        expect(route!.plan.answer).toContain("-2")
        expect(route!.plan.answer).toContain("8.75")
        const compiled = compilePlan(route!.plan, {
          document: createEmptyDocument("conics"),
          conversationId: "test-1d",
          documentGeneration: 0,
          workspace: "conics"
        })
        expect(compiled.ok).toBe(true)
        expect(compiled.draftDocument?.primitives.some((p) => p.type === "function")).toBe(true)
      }
    })

    it("solves 1D definite integral with integral notation ∫_0^1 (3*x^2 + 2*x) dx = 2", () => {
      const route = routeDeterministicProblem("计算定积分 ∫_0^1 (3*x^2 + 2*x) dx")
      expect(route).not.toBeNull()
      if (route!.plan.kind === "plan") {
        expect(route!.plan.answer).toContain("= 2$")
      }
    })

    it("solves Lagrange multipliers constrained extrema exactly (f = x + 2y on x^2 + y^2 = 5 => ±5)", () => {
      const route = routeDeterministicProblem("用拉格朗日乘数法求目标函数 f(x, y) = x + 2y 在约束 x^2 + y^2 = 5 下的条件极值")
      expect(route).not.toBeNull()
      expect(route!.plan.kind).toBe("plan")
      if (route!.plan.kind === "plan") {
        expect(route!.plan.answer).toContain("f_{\\max} = 5")
        expect(route!.plan.answer).toContain("f_{\\min} = -5")
        const compiled = compilePlan(route!.plan, {
          document: createEmptyDocument("conics"),
          conversationId: "test-lag",
          documentGeneration: 0,
          workspace: "conics"
        })
        expect(compiled.ok).toBe(true)
        expect(compiled.draftDocument?.primitives.some((p) => p.type === "circle")).toBe(true)
      }
    })

    it("solves 3D multivariable stationary points, saddle classification, and tangent plane in geometry3d", () => {
      const route = routeDeterministicProblem("求二元函数曲面 z = x^3 - 3x + y^2 的极值与鞍点，并求在点 (2, 1) 处的切平面")
      expect(route).not.toBeNull()
      expect(route!.family).toBe("spatial-modeling")
      expect(route!.plan.kind).toBe("plan")
      if (route!.plan.kind === "plan") {
        expect(route!.plan.answer).toContain("鞍点")
        expect(route!.plan.answer).toContain("局部极小值点")
        expect(route!.plan.answer).toContain("9x + 2y - 17")
        const compiled = compilePlan(route!.plan, {
          document: createEmptyDocument("geometry3d"),
          conversationId: "test-surf",
          documentGeneration: 0,
          workspace: "geometry3d"
        })
        expect(compiled.ok).toBe(true)
        expect(compiled.draftDocument?.primitives.some((p) => p.type === "face3")).toBe(true)
      }
    })

    it("solves 1st-order ODE IVP y' = y, y(0) = 1 at x = 1 via RK45 (≈ e = 2.7182818)", () => {
      const route = routeDeterministicProblem("求解初值问题 y' = y, y(0) = 1，求 y(1)")
      expect(route).not.toBeNull()
      expect(route!.plan.kind).toBe("plan")
      if (route!.plan.kind === "plan") {
        expect(route!.plan.answer).toMatch(/2\.71828/)
      }
    })

    it("solves 2D autonomous system phase plane equilibria and vector field div/curl", () => {
      const phaseRoute = routeDeterministicProblem("分析自治系统相平面 x' = y, y' = -x - 0.6*y 的平衡点与稳定性")
      expect(phaseRoute).not.toBeNull()
      if (phaseRoute!.plan.kind === "plan") {
        expect(phaseRoute!.plan.answer).toContain("(0, 0)")
        expect(phaseRoute!.plan.answer).toContain("稳定焦点")
      }

      const divCurlRoute = routeDeterministicProblem("求向量场 F(x, y) = (x^2*y, -x*y^2) 在点 (1, 2) 处的散度与旋度")
      expect(divCurlRoute).not.toBeNull()
      if (divCurlRoute!.plan.kind === "plan") {
        // dP/dx = 2xy = 4, dQ/dy = -2xy = -4 => div = 0; dQ/dx = -y^2 = -4, dP/dy = x^2 = 1 => curlZ = -5
        expect(divCurlRoute!.plan.answer).toContain("= 0$")
        expect(divCurlRoute!.plan.answer).toContain("= -5$")
      }
    })

    it("solves Taylor expansion (Jet AD) with remainder estimate & Fourier square wave", () => {
      const taylorRoute = routeDeterministicProblem("将函数 f(x) = exp(x) 在 x0 = 0 处展开为 5 阶泰勒多项式，并估计 f(0.5)")
      expect(taylorRoute).not.toBeNull()
      expect(taylorRoute!.plan.kind).toBe("plan")
      if (taylorRoute!.plan.kind === "plan") {
        // exp(0.5) ≈ 1.64872127, P5(0.5) = 1 + 0.5 + 0.125 + 1/48 + 1/384 + 1/3840 ≈ 1.64869792
        expect(taylorRoute!.plan.answer).toMatch(/1\.64872/)
        expect(taylorRoute!.plan.answer).toMatch(/1\.64869/)
      }

      const fourierRoute = routeDeterministicProblem("求方波的 9 阶傅里叶级数合成与吉布斯超调")
      expect(fourierRoute).not.toBeNull()
      expect(fourierRoute!.plan.kind).toBe("plan")
    })

    it("solves Cartesian and Polar double integrals to machine accuracy", () => {
      // ∬ (x + 2y) dy dx, x in [0, 1], y in [0, x] => ∫_0^1 (x^2 + x^2) dx = 2/3 ≈ 0.66666667
      const cartRoute = routeDeterministicProblem("计算二重积分 ∬ (x + 2*y) dxdy，其中 0 <= x <= 1, 0 <= y <= x")
      expect(cartRoute).not.toBeNull()
      if (cartRoute!.plan.kind === "plan") {
        expect(cartRoute!.plan.answer).toMatch(/0\.66666667/)
      }

      // ∬_{x^2+y^2 <= 4} (x^2 + y^2) dxdy = ∫_0^{2π} ∫_0^2 r^3 dr dθ = 2π * 4 = 8π ≈ 25.13274123
      const polarRoute = routeDeterministicProblem("利用极坐标计算二重积分 ∬ (x^2 + y^2) dxdy，其中 x^2 + y^2 <= 4")
      expect(polarRoute).not.toBeNull()
      if (polarRoute!.plan.kind === "plan") {
        expect(polarRoute!.plan.answer).toMatch(/25\.132741/)
      }
    })

    it("solves 2x2 Matrix eigenvalues, eigenvectors, and SVD exactly", () => {
      const matRoute = routeDeterministicProblem("求矩阵 [[3, 1], [1, 3]] 的行列式、特征值与奇异值 SVD")
      expect(matRoute).not.toBeNull()
      expect(matRoute!.plan.kind).toBe("plan")
      if (matRoute!.plan.kind === "plan") {
        expect(matRoute!.plan.answer).toContain("\\det(A) = 8")
        expect(matRoute!.plan.answer).toContain("\\lambda_1 = 4")
        expect(matRoute!.plan.answer).toContain("\\lambda_2 = 2")
        expect(matRoute!.plan.answer).toContain("\\sigma_1 = 4")
      }
    })

    it("solves Normal and Binomial probability distributions & CLT", () => {
      const normRoute = routeDeterministicProblem("设随机变量服从正态分布 N(0, 1)，求 P(-1.96 <= X <= 1.96)")
      expect(normRoute).not.toBeNull()
      if (normRoute!.plan.kind === "plan") {
        expect(normRoute!.plan.answer).toMatch(/0\.9500/)
      }

      const binomRoute = routeDeterministicProblem("设 X 服从二项分布 B(10, 0.5)，求区间 [4, 6] 的概率")
      expect(binomRoute).not.toBeNull()
      if (binomRoute!.plan.kind === "plan") {
        // P(4<=X<=6) = (210 + 252 + 210) / 1024 = 672 / 1024 = 0.65625
        expect(binomRoute!.plan.answer).toContain("0.65625")
      }
    })
  })

  describe("LLM ds_action kernel tool execution & CalculusWorkbench store sync", () => {
    it("executes all 10 higher-math query_measurement metrics accurately and supports both visual & answer-only finish_candidate", () => {
      const session = createDsActionSession({
        workspace: "conics",
        baseDocument: createEmptyDocument("conics"),
        problemText: "用拉格朗日乘数法求 f(x,y) = xy 在 x^2 + y^2 = 8 下的极值"
      })

      // 1. Lagrange KKT query (xy on x^2+y^2=8 => max = 4 at ±(2,2), min = -4 at ±(2,-2))
      const lag = session.execute("query_measurement", {
        metric: "lagrange_2d",
        objective: "xy",
        constraint: "x^2 + y^2 = 8"
      })
      expect(lag.ok).toBe(true)
      expect(lag.stateChanged).toBe(false)
      expect((lag.measurement?.globalMaxPoint as { value: number }).value).toBeCloseTo(4, 5)
      expect((lag.measurement?.globalMinPoint as { value: number }).value).toBeCloseTo(-4, 5)

      // 2. 1D Calculus query with implicit multiplication x(x^2 - 3)
      const calc1d = session.execute("query_measurement", {
        metric: "calculus_1d",
        expression: "x(x^2 - 3)",
        domain: [-2, 3],
        x0: 1
      })
      expect(calc1d.ok).toBe(true)
      expect((calc1d.measurement?.globalMax as { y: number }).y).toBeCloseTo(18, 6)
      expect(calc1d.measurement?.definiteIntegral as number).toBeCloseTo(8.75, 6)

      // 2b. ODE IVP exact RK45 step clamping
      const ode = session.execute("query_measurement", {
        metric: "ode_solve",
        rhs: "y",
        x0: 0,
        y0: 1,
        xTarget: 1
      })
      expect(ode.ok).toBe(true)
      expect(ode.measurement?.yAtTarget as number).toBeCloseTo(Math.E, 6)

      // 3. Double integral query
      const di = session.execute("query_measurement", {
        metric: "double_integral",
        integrand: "r",
        integralOrder: "polar",
        outerMin: "0",
        outerMax: "pi/2",
        innerMin: "0",
        innerMax: "2"
      })
      expect(di.ok).toBe(true)
      // ∫_0^{π/2} ∫_0^2 r * r dr dθ = (π/2) * (8/3) = 4π/3 ≈ 4.1887902
      expect(di.measurement?.value as number).toBeCloseTo((4 * Math.PI) / 3, 5)

      // 4. Matrix 2x2 SVD & eigenvalues query
      const mat = session.execute("query_measurement", {
        metric: "matrix_2x2",
        matrix: [[4, 0], [0, 2]]
      })
      expect(mat.ok).toBe(true)
      expect(mat.measurement?.determinant).toBe(8)
      expect((mat.measurement?.svd as { sigma1: number; sigma2: number }).sigma1).toBeCloseTo(4, 6)

      // 5. Answer-only finish_candidate works cleanly when higher-math solver was queried
      const ansOnlySession = createDsActionSession({
        workspace: "conics",
        baseDocument: createEmptyDocument("conics")
      })
      ansOnlySession.execute("query_measurement", {
        metric: "probability",
        distKind: "exponential",
        param1: 2,
        interval: [0, 1]
      })
      const finishedAns = ansOnlySession.execute("finish_candidate", {
        goal: "指数分布区间概率",
        answer: "P(0 <= X <= 1) = 1 - e^{-2} ≈ 0.864665"
      })
      expect(finishedAns.ok).toBe(true)
      expect(finishedAns.terminated?.plan.kind).toBe("answer")

      // 6. Visual construction + finish_candidate produces compiled visual plan + answer
      session.execute("construct_circle", { id: "C", radius: Math.sqrt(8) })
      session.execute("construct_point", { id: "P1", x: 2, y: 2 })
      session.execute("construct_point", { id: "P2", x: 2, y: -2 })
      const finishedPlan = session.execute("finish_candidate", {
        goal: "拉格朗日条件极值构图与求解",
        answer: "最大值为 4（在 (2,2), (-2,-2) 取得），最小值为 -4（在 (2,-2), (-2,2) 取得）。"
      })
      expect(finishedPlan.ok).toBe(true)
      expect(finishedPlan.terminated?.plan.kind).toBe("plan")
      if (finishedPlan.terminated?.plan.kind === "plan") {
        expect(finishedPlan.terminated.plan.answer).toContain("最大值为 4")
      }
    })

    it("synchronizes higher-math prompts into useCalculusStore without triggering on school geometry", () => {
      useCalculusStore.getState().clearSyncedRoute()
      const ignored = useCalculusStore.getState().syncFromAgentPrompt("正方体 ABCD-A1B1C1D1 棱长为 2")
      expect(ignored).toBe(false)
      expect(useCalculusStore.getState().pendingRoute).toBeNull()

      const synced = useCalculusStore
        .getState()
        .syncFromAgentPrompt("用拉格朗日乘数法求 f(x, y) = 2x + y 在 x^2 + y^2 = 9 下的条件极值")
      expect(synced).toBe(true)
      const route = useCalculusStore.getState().pendingRoute
      expect(route?.module).toBe("lagrange")
      if (route?.module === "lagrange") {
        expect(route.objective).toBe("2x + y")
        expect(route.constraint).toBe("x^2 + y^2 = 9")
      }
    })
  })
})

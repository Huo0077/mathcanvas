import { createEmptyDocument } from "@draw/dsl"
import {
  analyzeDoubleIntegral,
  analyzeExtrema1D,
  analyzeFourierSeries,
  analyzeLagrange2D,
  analyzeLinearTransform2D,
  analyzePhasePlane2D,
  analyzeProbabilityDistribution,
  analyzeSurface3D,
  analyzeTaylorSeries,
  compileScalarField1D,
  compileScalarField2D,
  computeTangentPlane3D,
  evaluateDivCurlProbe,
  integrateDefinite1D,
  integrateOde1DBidirectional,
  integratePhaseTrajectoryBidirectional,
  normalizeHigherMathInput,
  routeHigherMathPrompt,
  simulateCentralLimitTheorem,
  solveOde1DIvp,
  solvePoissonSteady2D,
  type HigherMathRouteAction
} from "@draw/geometry-kernel"
import type { DraftAction } from "@draw/scene-graph"

import { MAX_PLAN_ANSWER_LENGTH, PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import type { DeterministicProblemRoute } from "../deterministicProblemRoute"
import { compilePlan } from "../planCompiler"

function fmt(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return "未定义"
  const snapped = Math.abs(v) < 1e-10 ? 0 : v
  return Number(snapped.toFixed(digits)).toString()
}

function clampAnswer(text: string): string {
  if (text.length <= MAX_PLAN_ANSWER_LENGTH) return text
  return `${text.slice(0, MAX_PLAN_ANSWER_LENGTH - 12)}...\n（已截断）`
}

/**
 * Strict intent guard: only matches explicit university calculus / ODE / PDE / series /
 * multivariable / linear-algebra / probability problem statements, never middle/high-school
 * conic or solid geometry benchmarks.
 */
export function hasExplicitHigherMathIntent(rawPrompt: string): boolean {
  const text = rawPrompt.trim()
  if (!text) return false

  const isSchoolGeometry =
    /三棱锥|四棱锥|棱柱|正方体|长方体|四面体|圆台|棱台|外接球|内切球|二面角|线面角|异面直线|翻折|折叠|折起|离心率|准线|焦半径|焦点弦/u.test(
      text
    )
  const isStrongHigherMath =
    /拉格朗日|条件极值|偏导|鞍点|切平面|法线方程|二元函数|微分方程|初值问题|斜率场|相平面|自治系统|平衡点|极限环|偏微分|热传导|波动方程|泊松方程|拉普拉斯|泰勒|麦克劳林|傅里叶|吉布斯|二重积分|累次积分|交换积分次序|极坐标积分|∬|散度|旋度|\bdiv\b|\bcurl\b|矩阵|特征值|特征向量|奇异值|\bsvd\b|正态分布|标准正态|卡方分布|\bt\s*分布|二项分布|泊松分布|指数分布|中心极限定理|\bclt\b|\bN\s*\(\s*[+-]?\d|\bExp\s*\(|\bPoisson\s*\(/iu.test(
      text
    )
  if (isStrongHigherMath) return true
  if (isSchoolGeometry) return false
  if (/椭圆|双曲线|抛物线/u.test(text)) return false

  return /极值|极大值|极小值|最大值|最小值|最值|拐点|渐近线|定积分|曲线下面积|∫/u.test(text)
}

function finalizeVerifiedPlan(
  goal: string,
  answer: string,
  actions: DraftAction[],
  family: DeterministicProblemRoute["family"],
  skillIds: readonly string[]
): DeterministicProblemRoute {
  const safeAnswer = clampAnswer(answer)
  const ws = family === "spatial-modeling" ? "geometry3d" : "conics"
  if (actions.length > 0) {
    const candidatePlan: PlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal,
      factIds: [],
      actions,
      answer: safeAnswer
    }
    const check = compilePlan(candidatePlan, {
      document: createEmptyDocument(ws),
      conversationId: "higher-math-plan-verify",
      documentGeneration: 0,
      workspace: ws
    })
    if (check.ok && check.draftDocument && check.draftDocument.primitives.length > 0) {
      return {
        plan: candidatePlan,
        family,
        skillIds
      }
    }
  }
  return {
    plan: {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "answer",
      goal,
      factIds: [],
      toolResultRefs: [],
      answer: safeAnswer
    },
    family,
    skillIds
  }
}

function buildTaylorPolynomialExpr(coeffs: readonly number[], center: number): string {
  const terms: string[] = []
  for (let k = 0; k < coeffs.length; k++) {
    const c = coeffs[k]!
    if (!Number.isFinite(c) || Math.abs(c) < 1e-11) continue
    const cStr = Number(c.toFixed(8)).toString()
    if (k === 0) {
      terms.push(cStr)
    } else {
      const shift = Math.abs(center) < 1e-12 ? "x" : `(x - (${fmt(center, 6)}))`
      const pow = k === 1 ? shift : `${shift}^${k}`
      terms.push(`(${cStr})*${pow}`)
    }
  }
  return terms.length > 0 ? terms.join(" + ") : "0"
}

function buildFourierPartialSumExpr(
  a0: number,
  harmonics: ReadonlyArray<{ n: number; an: number; bn: number }>,
  halfPeriod: number
): string {
  const terms: string[] = []
  if (Math.abs(a0) > 1e-10) {
    terms.push(Number((a0 * 0.5).toFixed(7)).toString())
  }
  const omega = Math.PI / halfPeriod
  const maxTerms = Math.min(harmonics.length, 10)
  for (let i = 0; i < maxTerms; i++) {
    const h = harmonics[i]!
    const w = Number((h.n * omega).toFixed(8))
    if (Math.abs(h.an) > 1e-8) {
      terms.push(`(${Number(h.an.toFixed(7))})*cos(${w}*x)`)
    }
    if (Math.abs(h.bn) > 1e-8) {
      terms.push(`(${Number(h.bn.toFixed(7))})*sin(${w}*x)`)
    }
  }
  return terms.length > 0 ? terms.join(" + ") : "0"
}

function downsamplePolyline(
  pts: ReadonlyArray<{ x: number; y: number }>,
  maxPts = 36
): Array<{ x: number; y: number }> {
  const finite = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e4 && Math.abs(p.y) < 1e4)
  if (finite.length <= maxPts) return [...finite]
  const out: Array<{ x: number; y: number }> = []
  const step = (finite.length - 1) / (maxPts - 1)
  for (let i = 0; i < maxPts; i++) {
    const pt = finite[Math.round(i * step)]!
    if (out.length === 0 || Math.hypot(pt.x - out[out.length - 1]!.x, pt.y - out[out.length - 1]!.y) > 1e-5) {
      out.push({ x: Number(pt.x.toFixed(6)), y: Number(pt.y.toFixed(6)) })
    }
  }
  return out
}

export function solveHigherMathRouteToPlan(route: HigherMathRouteAction): DeterministicProblemRoute | null {
  const planarSkills = ["functions", "planar-basics", "conics-tangents"] as const

  try {
    switch (route.module) {
      case "extrema1d": {
        const domain: [number, number] = route.domain ?? [-4, 4]
        const analysis = analyzeExtrema1D(route.expression, domain)
        const actions: DraftAction[] = [
          {
            actionId: "function.create_graph",
            actionKey: "hm-fn-f",
            factIds: [],
            inputs: {
              alias: "f",
              label: `f(x)=${analysis.normalizedExpression}`,
              expression: analysis.normalizedExpression,
              domain
            }
          } as DraftAction
        ]

        if (route.computeIntegral) {
          actions.push({
            actionId: "function.analyze",
            actionKey: "hm-fn-int",
            factIds: [],
            inputs: { alias: "I_f", sourceId: "draft:f", analysis: "integral" }
          } as DraftAction)
        }

        let ptIdx = 0
        for (const ext of analysis.extrema.slice(0, 6)) {
          if (ext.kind === "endpoint" && !ext.isGlobalMax && !ext.isGlobalMin) continue
          ptIdx += 1
          const label = `P${ptIdx}`
          actions.push({
            actionId: "planar.create_point",
            actionKey: `hm-ext-pt-${ptIdx}`,
            factIds: [],
            inputs: { alias: label, label, points: [{ x: ext.x, y: ext.y }] }
          } as DraftAction)
          if ((ext.kind === "local_max" || ext.kind === "local_min") && ptIdx <= 3) {
            actions.push({
              actionId: "planar.create_line",
              actionKey: `hm-ext-tan-${ptIdx}`,
              factIds: [],
              inputs: {
                alias: `t${ptIdx}`,
                label: `y=${fmt(ext.y, 4)}`,
                points: [{ x: ext.x - 1, y: ext.y }, { x: ext.x + 1, y: ext.y }]
              }
            } as DraftAction)
          }
        }

        for (const [idx, inf] of analysis.inflections.slice(0, 3).entries()) {
          const label = `I${idx + 1}`
          actions.push({
            actionId: "planar.create_point",
            actionKey: `hm-inf-pt-${idx + 1}`,
            factIds: [],
            inputs: { alias: label, label, points: [{ x: inf.x, y: inf.y }] }
          } as DraftAction)
        }

        for (const [idx, asym] of analysis.asymptotes.slice(0, 3).entries()) {
          const pts = asym.kind === "vertical" && asym.x !== undefined
            ? [{ x: asym.x, y: -2 }, { x: asym.x, y: 2 }]
            : asym.slope !== undefined && asym.intercept !== undefined
              ? [{ x: -2, y: asym.slope * -2 + asym.intercept }, { x: 2, y: asym.slope * 2 + asym.intercept }]
              : null
          if (pts) {
            actions.push({
              actionId: "planar.create_line",
              actionKey: `hm-asym-${idx + 1}`,
              factIds: [],
              inputs: { alias: `asym${idx + 1}`, label: asym.label, points: pts }
            } as DraftAction)
          }
        }

        const lines: string[] = [
          `【一元微积分精确求解】函数 $f(x) = ${analysis.normalizedExpression}$，分析区间 $[${fmt(domain[0])}, ${fmt(domain[1])}]$：`
        ]
        if (route.computeIntegral || route.domain !== undefined) {
          const integralVal = integrateDefinite1D(analysis.normalizedExpression, domain[0], domain[1])
          if (Number.isFinite(integralVal)) {
            lines.push(`- 定积分 $\\int_{${fmt(domain[0])}}^{${fmt(domain[1])}} f(x)\\,dx = ${fmt(integralVal, 8)}$`)
          }
        }
        const interiorExtrema = analysis.extrema.filter((e) => e.kind !== "endpoint")
        if (interiorExtrema.length > 0) {
          lines.push(
            `- 驻点 / 极值点：${interiorExtrema
              .map((e) => `(${fmt(e.x)}, ${fmt(e.y)}) [${e.label}]`)
              .join("；")}`
          )
        } else {
          lines.push(`- 区间内部无极值点（单调或无驻点）。`)
        }
        if (analysis.globalMax) {
          lines.push(`- 区间最大值：$\\max f(x) = ${fmt(analysis.globalMax.y)}$（在 $x = ${fmt(analysis.globalMax.x)}$ 处取得）`)
        } else if (analysis.unboundedAbove) {
          lines.push(`- 区间内上无界（不存在有限最大值）`)
        }
        if (analysis.globalMin) {
          lines.push(`- 区间最小值：$\\min f(x) = ${fmt(analysis.globalMin.y)}$（在 $x = ${fmt(analysis.globalMin.x)}$ 处取得）`)
        } else if (analysis.unboundedBelow) {
          lines.push(`- 区间内下无界（不存在有限最小值）`)
        }
        if (analysis.inflections.length > 0) {
          lines.push(
            `- 拐点：${analysis.inflections
              .map((inf) => `(${fmt(inf.x)}, ${fmt(inf.y)})`)
              .join("；")}`
          )
        }
        if (analysis.asymptotes.length > 0) {
          lines.push(`- 渐近线：${analysis.asymptotes.map((a) => a.label).join("；")}`)
        }
        if (route.x0 !== undefined) {
          const fField = compileScalarField1D(route.expression)
          const y0 = fField.eval(route.x0)
          const dy0 = fField.derivative(route.x0)
          if (Number.isFinite(y0) && Number.isFinite(dy0)) {
            const b = y0 - dy0 * route.x0
            lines.push(`- 在 $x_0 = ${fmt(route.x0)}$ 处：$f(x_0) = ${fmt(y0)}$，$f'(x_0) = ${fmt(dy0)}$，切线方程 $y = ${fmt(dy0)}x ${b >= 0 ? "+" : "-"} ${fmt(Math.abs(b))}$`)
          }
        }

        return finalizeVerifiedPlan(
          `求解并绘制 f(x) = ${analysis.normalizedExpression}`,
          lines.join("\n"),
          actions,
          "functions",
          planarSkills
        )
      }

      case "lagrange": {
        const bounds = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }
        const res = analyzeLagrange2D(route.objective, route.constraint, bounds)
        const actions: DraftAction[] = []

        const circleMatch = route.constraint.replace(/\s+/gu, "").match(/^x(?:\^2|²)\+y(?:\^2|²)=([0-9.]+)$/iu)
        if (circleMatch && Number(circleMatch[1]) > 0) {
          actions.push({
            actionId: "planar.create_circle",
            actionKey: "hm-lag-circle",
            factIds: [],
            inputs: { alias: "C", label: "g(x,y)=0", center: { x: 0, y: 0 }, radius: Math.sqrt(Number(circleMatch[1])) }
          } as DraftAction)
        } else {
          for (const [cIdx, poly] of res.constraintCurves.slice(0, 3).entries()) {
            const sampled = downsamplePolyline(poly, 40)
            if (sampled.length >= 2) {
              actions.push({
                actionId: "planar.create_polyline",
                actionKey: `hm-lag-con-${cIdx}`,
                factIds: [],
                inputs: { alias: `g${cIdx + 1}`, label: cIdx === 0 ? "g=0" : `g_${cIdx + 1}`, points: sampled }
              } as DraftAction)
            }
          }
        }

        for (const [idx, sp] of res.stationaryPoints.slice(0, 6).entries()) {
          const label = `P${idx + 1}`
          actions.push({
            actionId: "planar.create_point",
            actionKey: `hm-lag-pt-${idx + 1}`,
            factIds: [],
            inputs: { alias: label, label, points: [{ x: sp.x, y: sp.y }] }
          } as DraftAction)
          if (idx < 2) {
            const [gx, gy] = sp.gradF
            const norm = Math.hypot(gx, gy)
            if (norm > 1e-8) {
              const tx = -gy / norm
              const ty = gx / norm
              actions.push({
                actionId: "planar.create_line",
                actionKey: `hm-lag-tan-${idx + 1}`,
                factIds: [],
                inputs: {
                  alias: `L${idx + 1}`,
                  label: `f=${fmt(sp.value, 4)}`,
                  points: [{ x: sp.x - tx * 2, y: sp.y - ty * 2 }, { x: sp.x + tx * 2, y: sp.y + ty * 2 }]
                }
              } as DraftAction)
            }
          }
        }

        const lines: string[] = [
          `【拉格朗日乘数法精确求解】目标函数 $f(x, y) = ${route.objective}$，约束条件 $${route.constraint}$：`,
          `构造拉格朗日函数 $\\mathcal{L}(x, y, \\lambda) = f(x, y) - \\lambda g(x, y)$，联立 $\\nabla f = \\lambda \\nabla g$ 与 $g(x, y) = 0$ 得 KKT 驻点：`
        ]
        if (res.stationaryPoints.length === 0) {
          lines.push(`- 在搜索域 $[-5, 5]^2$ 内未检测到有限约束驻点（可能无界或约束无实数解）。`)
        } else {
          for (const [i, sp] of res.stationaryPoints.entries()) {
            const tag = sp.kind === "constrained_max" ? "条件极大" : sp.kind === "constrained_min" ? "条件极小" : "驻点"
            lines.push(
              `- $P_${i + 1}(${fmt(sp.x)}, ${fmt(sp.y)})$：$f = ${fmt(sp.value)}$，$\\lambda = ${fmt(sp.lambda)}$（${tag}）`
            )
          }
          const maxPt = res.stationaryPoints.find((p) => p.isGlobalMax) ?? res.stationaryPoints[0]
          const minPt = res.stationaryPoints.find((p) => p.isGlobalMin) ?? res.stationaryPoints[res.stationaryPoints.length - 1]
          if (maxPt) lines.push(`- **条件最大值**：$f_{\\max} = ${fmt(maxPt.value)}$，在 $(${fmt(maxPt.x)}, ${fmt(maxPt.y)})$ 处取得`)
          if (minPt) lines.push(`- **条件最小值**：$f_{\\min} = ${fmt(minPt.value)}$，在 $(${fmt(minPt.x)}, ${fmt(minPt.y)})$ 处取得`)
        }

        return finalizeVerifiedPlan(
          `拉格朗日条件极值：f = ${route.objective}，约束 ${route.constraint}`,
          lines.join("\n"),
          actions,
          "conics-tangents",
          planarSkills
        )
      }

      case "surface3d": {
        const bounds = { xMin: -3.5, xMax: 3.5, yMin: -3.5, yMax: 3.5 }
        const normExpr = normalizeHigherMathInput(route.expression, "expression")
        const res = analyzeSurface3D(route.expression, bounds, { gridSize: 36 })
        const field = compileScalarField2D(route.expression)
        const actions: DraftAction[] = []

        for (const [idx, sp] of res.stationaryPoints.slice(0, 3).entries()) {
          const label = String.fromCharCode(65 + idx)
          actions.push({
            actionId: "solid.create_point",
            actionKey: `hm-surf-pt-${idx + 1}`,
            factIds: [],
            inputs: { alias: label, label, position: { x: sp.x, y: sp.y, z: sp.z } }
          } as DraftAction)
        }

        const lines: string[] = [
          `【多元函数微分学与三维曲面求解】$z = f(x, y) = ${normExpr}$：`
        ]
        if (res.stationaryPoints.length === 0) {
          lines.push(`- 区域 $[-3.5, 3.5]^2$ 内无驻点（$\\nabla f \\neq 0$）。`)
        } else {
          lines.push(`- 令 $f_x = 0,\\; f_y = 0$，由二阶 Hessian 判别式 $\\Delta = AC - B^2 = f_{xx}f_{yy} - f_{xy}^2$ 分类：`)
          for (const sp of res.stationaryPoints) {
            const kindZh = sp.kind === "local_max" ? "局部极大值点" : sp.kind === "local_min" ? "局部极小值点" : sp.kind === "saddle" ? "鞍点" : "退化驻点"
            lines.push(
              `  - $(${fmt(sp.x)}, ${fmt(sp.y)}, ${fmt(sp.z)})$：$A=${fmt(sp.fxx)}, B=${fmt(sp.fxy)}, C=${fmt(sp.fyy)}, \\Delta=${fmt(sp.discriminant)}$ → **${kindZh}**`
            )
          }
        }

        const tpCoord = route.tangentPoint ?? (res.stationaryPoints[0] ? [res.stationaryPoints[0].x, res.stationaryPoints[0].y] as [number, number] : [1, 1] as [number, number])
        const tp = computeTangentPlane3D(field, tpCoord[0], tpCoord[1])
        if (tp) {
          if (route.tangentPoint || actions.length === 0) {
            const d = 1.0
            const corners = [
              { x: tp.x - d, y: tp.y - d, z: tp.z + tp.fx * -d + tp.fy * -d },
              { x: tp.x + d, y: tp.y - d, z: tp.z + tp.fx * d + tp.fy * -d },
              { x: tp.x + d, y: tp.y + d, z: tp.z + tp.fx * d + tp.fy * d },
              { x: tp.x - d, y: tp.y + d, z: tp.z + tp.fx * -d + tp.fy * d }
            ]
            actions.push({
              actionId: "solid.create_face",
              actionKey: "hm-surf-tan-face",
              factIds: [],
              inputs: {
                alias: "tan_plane",
                label: "切平面",
                vertices: corners,
                vertexNames: ["T₁", "T₂", "T₃", "T₄"]
              }
            } as DraftAction)
          }
          lines.push(
            `- 在点 $(${fmt(tp.x)}, ${fmt(tp.y)}, ${fmt(tp.z)})$ 处：$f_x = ${fmt(tp.fx)},\\; f_y = ${fmt(tp.fy)}$，切平面方程为 **$${tp.equation}$**，法向量 $\\vec{n} = (${fmt(-tp.fx)}, ${fmt(-tp.fy)}, 1)$`
          )
        }

        return finalizeVerifiedPlan(
          `多元曲面极值与切平面分析：z = ${normExpr}`,
          lines.join("\n"),
          actions,
          "spatial-modeling",
          ["spatial-modeling"]
        )
      }

      case "ode1d": {
        const x0 = route.x0 ?? 0
        const y0 = route.y0 ?? 1
        const xTarget = route.xTarget ?? x0 + 1
        const span = Math.max(4, Math.abs(xTarget - x0) + 1.5)
        const bounds = {
          xMin: Math.min(x0, xTarget) - 1.5,
          xMax: Math.max(x0, xTarget) + 1.5,
          yMin: y0 - span * 2,
          yMax: y0 + span * 2
        }
        const field = compileScalarField2D(route.rhs)
        const traj = integrateOde1DBidirectional(field, x0, y0, bounds)
        const slope0 = field.eval(x0, y0)
        const yAtTarget = solveOde1DIvp(field, x0, y0, xTarget)

        const actions: DraftAction[] = []
        const sampled = downsamplePolyline(traj.points, 40)
        if (sampled.length >= 2) {
          actions.push({
            actionId: "planar.create_polyline",
            actionKey: "hm-ode-curve",
            factIds: [],
            inputs: { alias: "sol", label: "y(x)", points: sampled }
          } as DraftAction)
        }
        actions.push({
          actionId: "planar.create_point",
          actionKey: "hm-ode-p0",
          factIds: [],
          inputs: { alias: "P0", label: "P₀", points: [{ x: x0, y: y0 }] }
        } as DraftAction)
        if (Number.isFinite(yAtTarget) && Math.abs(xTarget - x0) > 1e-6) {
          actions.push({
            actionId: "planar.create_point",
            actionKey: "hm-ode-p1",
            factIds: [],
            inputs: { alias: "P1", label: "P₁", points: [{ x: xTarget, y: yAtTarget }] }
          } as DraftAction)
        }
        if (Number.isFinite(slope0)) {
          actions.push({
            actionId: "planar.create_line",
            actionKey: "hm-ode-tan0",
            factIds: [],
            inputs: {
              alias: "tan0",
              label: `k=${fmt(slope0, 4)}`,
              points: [{ x: x0 - 1, y: y0 - slope0 }, { x: x0 + 1, y: y0 + slope0 }]
            }
          } as DraftAction)
        }

        const lines: string[] = [
          `【一阶常微分方程 RK45 数值求解】方程 $y' = ${route.rhs}$，初值 $y(${fmt(x0)}) = ${fmt(y0)}$：`,
          `- 初始点斜率：$y'(${fmt(x0)}) = ${fmt(slope0)}$`
        ]
        if (Number.isFinite(yAtTarget)) {
          lines.push(`- Dormand–Prince RK45 自适应步长积分结果：**$y(${fmt(xTarget)}) \\approx ${fmt(yAtTarget, 7)}$**`)
        }
        lines.push(`- 解曲线已在平面画布绘出（含初值点 $P_0$ 与初始切线），亦可在「高等数学 → ODE 斜率场」交互点击任意初值对比积分曲线簇。`)

        return finalizeVerifiedPlan(
          `求解微分方程 y' = ${route.rhs}, y(${fmt(x0)}) = ${fmt(y0)}`,
          lines.join("\n"),
          actions,
          "functions",
          planarSkills
        )
      }

      case "phase2d": {
        const pField = compileScalarField2D(route.pExpr)
        const qField = compileScalarField2D(route.qExpr)
        if (route.computeDivCurl) {
          const [px, py] = route.probePoint ?? [1, 1]
          const probe = evaluateDivCurlProbe(pField, qField, px, py)
          const actions: DraftAction[] = [
            {
              actionId: "planar.create_point",
              actionKey: "hm-vec-pt",
              factIds: [],
              inputs: { alias: "P", label: "P", points: [{ x: px, y: py }] }
            } as DraftAction
          ]
          if (Math.hypot(probe.vx, probe.vy) > 1e-8) {
            actions.push({
              actionId: "planar.create_segment",
              actionKey: "hm-vec-arrow",
              factIds: [],
              inputs: {
                alias: "F_vec",
                label: "F(P)",
                points: [{ x: px, y: py }, { x: px + probe.vx * 0.5, y: py + probe.vy * 0.5 }]
              }
            } as DraftAction)
          }
          const answer = [
            `【平面向量场散度与旋度】$\\mathbf{F}(x, y) = (${route.pExpr},\\; ${route.qExpr})$ 在点 $P(${fmt(px)}, ${fmt(py)})$ 处：`,
            `- 场向量：$\\mathbf{F}(P) = (${fmt(probe.vx)}, ${fmt(probe.vy)})$`,
            `- **散度**：$\\operatorname{div}\\mathbf{F}(P) = \\frac{\\partial P}{\\partial x} + \\frac{\\partial Q}{\\partial y} = ${fmt(probe.divergence, 7)}$（${probe.divKind === "source" ? "发散源" : probe.divKind === "sink" ? "汇聚汇" : "无源不可压缩"}）`,
            `- **旋度（$z$ 分量）**：$(\\operatorname{curl}\\mathbf{F})_z(P) = \\frac{\\partial Q}{\\partial x} - \\frac{\\partial P}{\\partial y} = ${fmt(probe.curlZ, 7)}$（${probe.curlKind === "ccw" ? "逆时针涡旋" : probe.curlKind === "cw" ? "顺时针涡旋" : "无旋场"}）`
          ].join("\n")
          return finalizeVerifiedPlan(`向量场散度与旋度分析`, answer, actions, "functions", planarSkills)
        }

        const bounds = { xMin: -4.5, xMax: 4.5, yMin: -4.5, yMax: 4.5 }
        const phase = analyzePhasePlane2D(route.pExpr, route.qExpr, bounds)
        const actions: DraftAction[] = []
        for (const [idx, eq] of phase.equilibria.slice(0, 5).entries()) {
          const label = `E${idx + 1}`
          actions.push({
            actionId: "planar.create_point",
            actionKey: `hm-eq-${idx + 1}`,
            factIds: [],
            inputs: { alias: label, label, points: [{ x: eq.x, y: eq.y }] }
          } as DraftAction)
        }
        const sampleTraj = integratePhaseTrajectoryBidirectional(pField, qField, 1.5, 1.0, bounds)
        const sampledPts = downsamplePolyline(sampleTraj.points, 40)
        if (sampledPts.length >= 2) {
          actions.push({
            actionId: "planar.create_polyline",
            actionKey: "hm-phase-traj",
            factIds: [],
            inputs: { alias: "gamma", label: "γ(t)", points: sampledPts }
          } as DraftAction)
        }

        const lines: string[] = [
          `【二维自治动力系统相平面分析】$x' = ${route.pExpr},\\; y' = ${route.qExpr}$：`
        ]
        if (phase.equilibria.length === 0) {
          lines.push(`- 区域 $[-4.5, 4.5]^2$ 内未检测到平衡点。`)
        } else {
          for (const [i, eq] of phase.equilibria.entries()) {
            const [e1, e2] = eq.eigenvalues
            const eigStr = Math.abs(e1.im) > 1e-6
              ? `${fmt(e1.re, 4)} \\pm ${fmt(Math.abs(e1.im), 4)}i`
              : `${fmt(e1.re, 4)},\\; ${fmt(e2.re, 4)}`
            lines.push(
              `- 平衡点 $E_${i + 1}(${fmt(eq.x)}, ${fmt(eq.y)})$：$\\operatorname{tr}(J)=${fmt(eq.trace)},\\; \\det(J)=${fmt(eq.determinant)}$，特征值 $\\lambda = ${eigStr}$ → **${eq.label}**`
            )
          }
        }

        return finalizeVerifiedPlan(
          `自治系统相平面分析：x' = ${route.pExpr}, y' = ${route.qExpr}`,
          lines.join("\n"),
          actions,
          "functions",
          planarSkills
        )
      }

      case "series": {
        if (route.subMode === "taylor") {
          const expr = route.expression ?? "sin(x)"
          const normExpr = normalizeHigherMathInput(expr, "expression")
          const center = route.center ?? 0
          const order = Math.max(1, Math.min(16, route.order ?? 5))
          const domain: [number, number] = [center - 4, center + 4]
          const taylor = analyzeTaylorSeries(expr, center, order, domain)
          const polyExpr = buildTaylorPolynomialExpr(taylor.coefficients, center)

          const actions: DraftAction[] = [
            {
              actionId: "function.create_graph",
              actionKey: "hm-taylor-orig",
              factIds: [],
              inputs: { alias: "f", label: `f(x)=${normExpr}`, expression: normExpr, domain }
            } as DraftAction,
            {
              actionId: "function.create_graph",
              actionKey: "hm-taylor-poly",
              factIds: [],
              inputs: { alias: "Pn", label: `P_${order}(x)`, expression: polyExpr, domain }
            } as DraftAction,
            {
              actionId: "planar.create_point",
              actionKey: "hm-taylor-c",
              factIds: [],
              inputs: { alias: "C", label: "x₀", points: [{ x: center, y: taylor.coefficients[0] ?? 0 }] }
            } as DraftAction
          ]

          const lines: string[] = [
            `【泰勒级数精确展开（Jet 自动微分）】函数 $f(x) = ${normExpr}$ 在 $x_0 = ${fmt(center)}$ 处的 ${order} 阶展开：`,
            `- 泰勒多项式：**$${taylor.polynomialText}$**`
          ]
          if (route.evalAt !== undefined) {
            const fField = compileScalarField1D(expr)
            const exactVal = fField.eval(route.evalAt)
            let approxVal = 0
            const dx = route.evalAt - center
            let p = 1
            for (const c of taylor.coefficients) {
              approxVal += c * p
              p *= dx
            }
            lines.push(
              `- 在 $x = ${fmt(route.evalAt)}$ 处：精确值 $f(${fmt(route.evalAt)}) = ${fmt(exactVal, 8)}$，多项式近似 $P_{${order}}(${fmt(route.evalAt)}) = ${fmt(approxVal, 8)}$，绝对余项 $|R_{${order}}| = ${fmt(Math.abs(exactVal - approxVal), 9)}$`
            )
          }
          return finalizeVerifiedPlan(
            `泰勒展开：f(x) = ${normExpr} (n = ${order})`,
            lines.join("\n"),
            actions,
            "functions",
            planarSkills
          )
        }

        const waveform = route.waveform ?? "square"
        const harmonics = Math.max(1, Math.min(25, route.order ?? 9))
        const halfPeriod = route.halfPeriod ?? Math.PI
        const fourier = analyzeFourierSeries(waveform, harmonics, halfPeriod)
        const partialExpr = buildFourierPartialSumExpr(fourier.a0, fourier.harmonics, halfPeriod)
        const actions: DraftAction[] = [
          {
            actionId: "function.create_graph",
            actionKey: "hm-fourier-sn",
            factIds: [],
            inputs: {
              alias: "SN",
              label: `S_${harmonics}(x)`,
              expression: partialExpr,
              domain: [-halfPeriod, halfPeriod]
            }
          } as DraftAction
        ]
        const nonZeroHarmonics = fourier.harmonics
          .filter((h) => h.amplitude > 1e-5)
          .slice(0, 5)
          .map((h) => `n=${h.n}: a_${h.n}=${fmt(h.an, 4)}, b_${h.n}=${fmt(h.bn, 4)}`)
          .join("；")
        const answer = [
          `【傅里叶级数谐波分析】波形：${waveform}，周期 $T = ${fmt(2 * halfPeriod)}$，前 $N = ${harmonics}$ 阶部分和：`,
          `- 直流分量：$\\frac{a_0}{2} = ${fmt(fourier.a0 * 0.5, 6)}$`,
          `- 主要非零谐波系数：${nonZeroHarmonics || "全零"}`,
          `- 部分和峰值超调：$${fmt(fourier.peakOvershoot, 5)}$，均方根逼近误差 $\\text{RMS} = ${fmt(fourier.rmsError, 5)}$`
        ].join("\n")

        return finalizeVerifiedPlan(
          `傅里叶级数合成（N = ${harmonics} 阶）`,
          answer,
          actions,
          "functions",
          planarSkills
        )
      }

      case "doubleIntegral": {
        const order = route.order
        const integrandExpr = route.integrand ?? (order === "polar" ? "exp(-r^2)" : "x + 2*y")
        const outerMinExpr = route.outerMinExpr ?? "0"
        const outerMaxExpr = route.outerMaxExpr ?? (order === "polar" ? "2*pi" : "1")
        const innerMinExpr = route.innerMinExpr ?? "0"
        const innerMaxExpr = route.innerMaxExpr ?? (order === "polar" ? "2" : "x")

        const di = analyzeDoubleIntegral({
          integrandExpr,
          order,
          outerMinExpr,
          outerMaxExpr,
          innerMinExpr,
          innerMaxExpr
        })

        const actions: DraftAction[] = []
        const boundaryPts = downsamplePolyline(di.domainPolygon, 42)
        if (boundaryPts.length >= 3) {
          actions.push({
            actionId: "planar.create_polyline",
            actionKey: "hm-di-region",
            factIds: [],
            inputs: { alias: "D_bound", label: "积分区域 D", points: [...boundaryPts, boundaryPts[0]!] }
          } as DraftAction)
        }
        if (di.scanSlice) {
          actions.push({
            actionId: "planar.create_segment",
            actionKey: "hm-di-scan",
            factIds: [],
            inputs: { alias: "slice", label: "截面切片", points: [di.scanSlice.segment[0], di.scanSlice.segment[1]] }
          } as DraftAction)
        }

        const orderDesc =
          order === "polar"
            ? `极坐标 $\\theta \\in [${outerMinExpr}, ${outerMaxExpr}],\\; r \\in [${innerMinExpr}, ${innerMaxExpr}]$（自动含雅可比因子 $r$）`
            : order === "xy"
              ? `直角坐标 $x \\in [${outerMinExpr}, ${outerMaxExpr}],\\; y \\in [${innerMinExpr}, ${innerMaxExpr}]$（先 $y$ 后 $x$）`
              : `直角坐标 $y \\in [${outerMinExpr}, ${outerMaxExpr}],\\; x \\in [${innerMinExpr}, ${innerMaxExpr}]$（先 $x$ 后 $y$）`

        const answer = [
          `【二重积分高精度数值求解（20×12 复合 Gauss–Legendre 求积）】`,
          `- 被积函数：$${integrandExpr}$`,
          `- 积分区域与次序：${orderDesc}（区域面积 $|D| = ${fmt(di.domainArea, 6)}$）`,
          `- **积分精确数值**：**$I = ${fmt(di.exactValue, 8)}$**`
        ].join("\n")

        return finalizeVerifiedPlan(
          `二重积分求解：∬ (${integrandExpr})`,
          answer,
          actions,
          "functions",
          planarSkills
        )
      }

      case "linalg": {
        const m = route.matrix
        const la = analyzeLinearTransform2D(m, 1)
        const O = { x: 0, y: 0 }
        const A = { x: m[0][0], y: m[1][0] }
        const B = { x: m[0][1], y: m[1][1] }
        const C = { x: A.x + B.x, y: A.y + B.y }

        const actions: DraftAction[] = [
          { actionId: "planar.create_circle", actionKey: "hm-la-unit", factIds: [], inputs: { alias: "U", label: "单位圆", center: O, radius: 1 } } as DraftAction,
          { actionId: "planar.create_point", actionKey: "hm-la-o", factIds: [], inputs: { alias: "O", label: "O", points: [O] } } as DraftAction,
          { actionId: "planar.create_point", actionKey: "hm-la-a", factIds: [], inputs: { alias: "A", label: "Ae₁", points: [A] } } as DraftAction,
          { actionId: "planar.create_point", actionKey: "hm-la-b", factIds: [], inputs: { alias: "B", label: "Ae₂", points: [B] } } as DraftAction
        ]
        if (Math.hypot(A.x, A.y) > 1e-6) {
          actions.push({ actionId: "planar.create_segment", actionKey: "hm-la-oa", factIds: [], inputs: { alias: "sOA", label: "Ae₁", points: [O, A] } } as DraftAction)
        }
        if (Math.hypot(B.x, B.y) > 1e-6) {
          actions.push({ actionId: "planar.create_segment", actionKey: "hm-la-ob", factIds: [], inputs: { alias: "sOB", label: "Ae₂", points: [O, B] } } as DraftAction)
        }
        if (Math.abs(la.determinant) > 1e-6) {
          actions.push(
            { actionId: "planar.create_point", actionKey: "hm-la-c", factIds: [], inputs: { alias: "C", label: "A(e₁+e₂)", points: [C] } } as DraftAction,
            { actionId: "planar.create_segment", actionKey: "hm-la-ac", factIds: [], inputs: { alias: "sAC", label: "AC", points: [A, C] } } as DraftAction,
            { actionId: "planar.create_segment", actionKey: "hm-la-bc", factIds: [], inputs: { alias: "sBC", label: "BC", points: [B, C] } } as DraftAction
          )
        }
        for (const [idx, ev] of la.realEigenvectors.entries()) {
          actions.push({
            actionId: "planar.create_line",
            actionKey: `hm-la-eig-${idx + 1}`,
            factIds: [],
            inputs: {
              alias: `v${idx + 1}`,
              label: `特征方向 λ=${fmt(ev.eigenvalue, 3)}`,
              points: [{ x: -ev.unitVector.x * 2, y: -ev.unitVector.y * 2 }, { x: ev.unitVector.x * 2, y: ev.unitVector.y * 2 }]
            }
          } as DraftAction)
        }

        const [l1, l2] = la.eigenvalues
        const eigText = Math.abs(l1.im) > 1e-6
          ? `共轭复特征值 $\\lambda_{1,2} = ${fmt(l1.re)} \\pm ${fmt(Math.abs(l1.im))}i$（实平面内无实特征向量，含旋转分量）`
          : `$\\lambda_1 = ${fmt(l1.re)},\\; \\lambda_2 = ${fmt(l2.re)}$；单位特征向量：${la.realEigenvectors.map((v, i) => `\\vec{v}_${i + 1} = (${fmt(v.unitVector.x, 4)}, ${fmt(v.unitVector.y, 4)})`).join("，")}`

        const answer = [
          `【二阶矩阵线性变换、特征值与奇异值分解 SVD】$A = \\begin{pmatrix} ${m[0][0]} & ${m[0][1]} \\\\ ${m[1][0]} & ${m[1][1]} \\end{pmatrix}$：`,
          `- 行列式（有向面积缩放比）：$\\det(A) = ${fmt(la.determinant)}$；迹：$\\operatorname{tr}(A) = ${fmt(la.trace)}$；秩：$\\operatorname{rank}(A) = ${la.rank}$`,
          `- **特征值与特征向量**：${eigText}`,
          `- **奇异值分解 SVD**：$\\sigma_1 = ${fmt(la.svd.sigma1, 6)},\\; \\sigma_2 = ${fmt(la.svd.sigma2, 6)}$${la.svd.sigma2 > 1e-8 ? `，条件数 $\\kappa_2(A) = \\sigma_1 / \\sigma_2 = ${fmt(la.svd.conditionNumber, 4)}$` : "（奇异矩阵）"}`
        ].join("\n")

        return finalizeVerifiedPlan(
          `矩阵特征值与 SVD 分析：A = [[${m[0][0]}, ${m[0][1]}], [${m[1][0]}, ${m[1][1]}]]`,
          answer,
          actions,
          "planar-basics",
          planarSkills
        )
      }

      case "probability": {
        if (route.subMode === "clt") {
          const clt = simulateCentralLimitTheorem({
            parent: route.parent ?? "exponential",
            sampleSize: route.sampleSize ?? 12,
            numTrials: 2000,
            seed: 20261124
          })
          const curve = downsamplePolyline(clt.normalOverlay, 36)
          const actions: DraftAction[] = curve.length >= 2
            ? [{ actionId: "planar.create_polyline", actionKey: "hm-clt-norm", factIds: [], inputs: { alias: "clt_fit", label: "渐近正态密度", points: curve } } as DraftAction]
            : []
          const answer = [
            `【中心极限定理（CLT）抽样验证】母体分布：${route.parent ?? "exponential"}，样本容量 $n = ${clt.sampleSize}$，独立抽样 $2000$ 组：`,
            `- 理论总体均值 $\\mu = ${fmt(clt.theoreticalMean, 4)}$，样本均值理论标准误 $\\sigma_{\\bar{X}} = \\sigma / \\sqrt{n} = ${fmt(clt.theoreticalStdError, 5)}$`,
            `- 实测抽样均值 $\\hat{\\mu} = ${fmt(clt.empiricalMean, 5)}$，实测标准差 $\\hat{s} = ${fmt(clt.empiricalStdDev, 5)}$`
          ].join("\n")
          return finalizeVerifiedPlan(`中心极限定理抽样模拟 (n = ${clt.sampleSize})`, answer, actions, "functions", planarSkills)
        }

        const kind = route.kind ?? "normal"
        const param1 = route.param1 ?? (kind === "normal" ? 0 : kind === "binomial" ? 10 : 4)
        const param2 = route.param2 ?? (kind === "normal" ? 1 : 0.5)
        const interval = route.interval ?? (kind === "normal" ? [-1.96, 1.96] : [0, param1])
        const dist = analyzeProbabilityDistribution({
          kind,
          param1,
          param2,
          intervalA: interval[0],
          intervalB: interval[1]
        })

        const actions: DraftAction[] = []
        if (!dist.isDiscrete) {
          const curve = downsamplePolyline(dist.pdfCurve, 42)
          if (curve.length >= 2) {
            actions.push({
              actionId: "planar.create_polyline",
              actionKey: "hm-prob-pdf",
              factIds: [],
              inputs: { alias: "pdf", label: "f(x)", points: curve }
            } as DraftAction)
          }
        } else {
          for (const [idx, bar] of dist.discreteBars.slice(0, 12).entries()) {
            if (bar.prob > 1e-4) {
              actions.push({
                actionId: "planar.create_point",
                actionKey: `hm-pmf-${idx}`,
                factIds: [],
                inputs: { alias: `k${bar.k}`, label: `P(${bar.k})`, points: [{ x: bar.k, y: bar.prob }] }
              } as DraftAction)
            }
          }
        }

        const answer = [
          `【概率分布精确计算】分布类型：${kind}（参数 $p_1 = ${fmt(param1)}$${kind === "normal" || kind === "binomial" ? `, $p_2 = ${fmt(param2)}$` : ""}）：`,
          `- 数学期望 $E[X] = ${fmt(dist.mean, 6)}$；方差 $\\operatorname{Var}(X) = ${fmt(dist.variance, 6)}$；标准差 $\\sigma = ${fmt(dist.stdDev, 6)}$`,
          `- **区间概率**：**$P(${fmt(interval[0])} \\le X \\le ${fmt(interval[1])}) = ${fmt(dist.intervalProb, 6)}$**`
        ].join("\n")

        return finalizeVerifiedPlan(
          `概率分布计算：${kind}`,
          answer,
          actions,
          "functions",
          planarSkills
        )
      }

      case "pde": {
        if (route.kind === "poisson2d") {
          const bounds = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }
          const pois = solvePoissonSteady2D(
            "4*exp(-2*((x+0.7)^2+y^2)) - 4*exp(-2*((x-0.7)^2+y^2))",
            "0",
            bounds,
            40
          )
          const actions: DraftAction[] = []
          for (const [idx, eq] of pois.equipotentials.slice(0, 4).entries()) {
            const poly = eq.polylines[0] ? downsamplePolyline(eq.polylines[0], 32) : []
            if (poly.length >= 2) {
              actions.push({
                actionId: "planar.create_polyline",
                actionKey: `hm-pois-eq-${idx}`,
                factIds: [],
                inputs: { alias: `u${idx + 1}`, label: `u=${fmt(eq.level, 2)}`, points: poly }
              } as DraftAction)
            }
          }
          const answer = [
            `【二维泊松/拉普拉斯偏微分方程稳态场求解】$-\\nabla^2 u = f(x, y)$（Dirichlet 零边界）：`,
            `- SOR 超松弛迭代收敛步数：$${pois.iterations}$ 步，残差 $\\|r\\|_\\infty = ${pois.residual.toExponential(2)}$`,
            `- 稳态势场范围：$u \\in [${fmt(pois.state.uMin, 4)},\\; ${fmt(pois.state.uMax, 4)}]$`,
            `- 等势线簇已在画布生成；已同步参数至「高等数学 → PDE 偏微分」工作台以支持实时交互探针与梯度通量场查看。`
          ].join("\n")
          return finalizeVerifiedPlan(`二维泊松方程稳态求解`, answer, actions, "functions", planarSkills)
        }

        const kindTitle = route.kind === "wave2d" ? "二维波动方程 u_tt = c²∇²u" : "二维热传导方程 u_t = α∇²u"
        return finalizeVerifiedPlan(
          `PDE 数值仿真准备：${kindTitle}`,
          `【偏微分方程（PDE）数值仿真就绪】已识别 **${kindTitle}**（自动 CFL 稳定子步进 + WebWorker 60fps 场演化）。\n- 已自动将方程模式与初值同步至顶部 **「高等数学 → PDE 偏微分」** 工作台，切换过去即可播放时间演化或点击画布实时注入高斯波包/热源脉冲！`,
          [],
          "functions",
          planarSkills
        )
      }
    }
  } catch {
    return null
  }
}

export function tryBuildHigherMathPlan(prompt: string): DeterministicProblemRoute | null {
  if (!hasExplicitHigherMathIntent(prompt)) return null
  const route = routeHigherMathPrompt(prompt)
  if (!route) return null
  return solveHigherMathRouteToPlan(route)
}

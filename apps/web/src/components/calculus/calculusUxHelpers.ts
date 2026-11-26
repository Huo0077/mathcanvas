import type {
  CltSimulationResult,
  DefiniteIntegral1DAnalysis,
  DistributionAnalysis,
  DoubleIntegralAnalysis,
  DualCurve1DAnalysis,
  Extrema1DAnalysis,
  FourierAnalysis,
  LagrangeAnalysis,
  LagrangePointProbe,
  Limit1DAnalysis,
  LinearTransform2DAnalysis,
  ParametricCurveAnalysis,
  PdeSimulationState,
  PhasePlaneAnalysis,
  PoissonSolution,
  PolarCurveAnalysis,
  Surface3DAnalysis,
  Tangent1DAnalysis,
  TangentPlaneInfo,
  TaylorAnalysis
} from "@draw/geometry-kernel"

import type { HigherMathModuleId } from "./CalculusWorkbench"

export interface CalculusModuleMeta {
  id: HigherMathModuleId
  label: string
  shortLabel: string
  hasFormulaInputs: boolean
}

export const CALCULUS_MODULES: CalculusModuleMeta[] = [
  { id: "extrema1d", label: "一元极值与最值", shortLabel: "一元微积分", hasFormulaInputs: true },
  { id: "parametricPolar", label: "参数与极坐标", shortLabel: "参数/极坐标", hasFormulaInputs: true },
  { id: "lagrange", label: "拉格朗日乘数法", shortLabel: "拉格朗日", hasFormulaInputs: true },
  { id: "ode1d", label: "ODE 斜率场", shortLabel: "ODE 斜率场", hasFormulaInputs: true },
  { id: "phase2d", label: "相平面向量场", shortLabel: "相平面", hasFormulaInputs: true },
  { id: "surface3d", label: "3D 曲面与鞍点", shortLabel: "3D 曲面", hasFormulaInputs: true },
  { id: "pde", label: "PDE 偏微分方程", shortLabel: "PDE 演化", hasFormulaInputs: true },
  { id: "series", label: "泰勒 / 傅里叶级数", shortLabel: "泰勒/傅里叶", hasFormulaInputs: true },
  { id: "doubleIntegral", label: "二重积分与极坐标", shortLabel: "二重积分", hasFormulaInputs: true },
  { id: "linalg", label: "线性代数变换", shortLabel: "线代变换", hasFormulaInputs: false },
  { id: "probability", label: "概率统计与CLT", shortLabel: "概率统计", hasFormulaInputs: false }
]

export interface SmartPromptChip {
  label: string
  prompt: string
}

export const SMART_PROMPT_CHIPS: SmartPromptChip[] = [
  { label: "拉格朗日极值", prompt: "求 f(x,y)=x*y 在约束 x^2/4+y^2=1 下的极值" },
  { label: "马鞍面切平面", prompt: "绘制三维曲面 z = x^2 - y^2 并分析鞍点" },
  { label: "2×2 SVD", prompt: "矩阵 [[2, 1], [1, 2]] 的特征值与奇异值" },
  { label: "正态分布概率", prompt: "标准正态分布 N(0,1) 在 [-1.96, 1.96] 的概率" }
]

export interface MathKeypadToken {
  label: string
  insert: string
  caretOffset: number
  title: string
}

export const MATH_KEYPAD_TOKENS: MathKeypadToken[] = [
  { label: "x²", insert: "^2", caretOffset: 2, title: "平方 (^2)" },
  { label: "^", insert: "^", caretOffset: 1, title: "幂次 (^)" },
  { label: "√", insert: "sqrt()", caretOffset: 5, title: "平方根 sqrt()" },
  { label: "π", insert: "pi", caretOffset: 2, title: "圆周率 pi" },
  { label: "eˣ", insert: "exp()", caretOffset: 4, title: "指数函数 exp()" },
  { label: "ln", insert: "ln()", caretOffset: 3, title: "自然对数 ln()" },
  { label: "sin", insert: "sin()", caretOffset: 4, title: "正弦函数 sin()" },
  { label: "cos", insert: "cos()", caretOffset: 4, title: "余弦函数 cos()" },
  { label: "|x|", insert: "abs()", caretOffset: 4, title: "绝对值 abs()" },
  { label: "·", insert: "*", caretOffset: 1, title: "乘号 (*)" }
]

/**
 * Inserts a math token into a React-controlled text input at its current caret/selection,
 * triggering a native input event so React state updates without losing focus.
 */
export function insertTokenIntoInput(input: HTMLInputElement, token: MathKeypadToken): boolean {
  if (input.disabled || input.readOnly) return false
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? input.value.length
  const selected = input.value.slice(start, end)

  let inserted = token.insert
  let nextCaret = start + token.caretOffset
  if (selected.length > 0 && token.insert === "()/()") {
    inserted = `(${selected})/()`
    nextCaret = start + inserted.length - 1
  } else if (selected.length > 0 && token.insert.endsWith("()")) {
    const fnHead = token.insert.slice(0, -1)
    inserted = `${fnHead}${selected})`
    nextCaret = start + inserted.length
  }

  const nextValue = input.value.slice(0, start) + inserted + input.value.slice(end)
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (nativeSetter) {
    nativeSetter.call(input, nextValue)
  } else {
    input.value = nextValue
  }
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.focus()
  try {
    input.setSelectionRange(nextCaret, nextCaret)
  } catch {
    // Ignore selection errors on non-selectable input types
  }
  return true
}

export function backspaceInInput(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly) return false
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? input.value.length
  if (start === 0 && end === 0) return false
  const nextStart = start === end ? Math.max(0, start - 1) : start
  const nextValue = input.value.slice(0, nextStart) + input.value.slice(end)
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (nativeSetter) {
    nativeSetter.call(input, nextValue)
  } else {
    input.value = nextValue
  }
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.focus()
  try {
    input.setSelectionRange(nextStart, nextStart)
  } catch {
    // Ignore selection errors
  }
  return true
}

function n(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—"
  const clean = Math.abs(v) < 1e-7 ? 0 : v
  return Number(clean.toFixed(digits)).toString()
}

export interface DiagnosticsSummaryInput {
  activeModule: HigherMathModuleId
  expr1D: string
  extrema1d: Extrema1DAnalysis | null
  integral1d?: DefiniteIntegral1DAnalysis | null
  tangent1d?: Tangent1DAnalysis | null
  limit1d?: Limit1DAnalysis | null
  dualCurve1d?: DualCurve1DAnalysis | null
  paramPolarSubMode?: "parametric" | "polar"
  parametric?: ParametricCurveAnalysis | null
  polar?: PolarCurveAnalysis | null
  objectiveExpr: string
  constraintExpr: string
  lagrange: LagrangeAnalysis | null
  activeProbe: LagrangePointProbe | null
  odeRhsExpr: string
  odeInitialCount: number
  phasePExpr: string
  phaseQExpr: string
  phasePlane: PhasePlaneAnalysis | null
  surfaceExpr: string
  surface: Surface3DAnalysis | null
  activeTangentPlane: TangentPlaneInfo | null
  pdeState: PdeSimulationState | null
  poissonSolution: PoissonSolution | null
  seriesSubMode: "taylor" | "fourier"
  taylor: TaylorAnalysis | null
  fourier: FourierAnalysis | null
  doubleIntegral: DoubleIntegralAnalysis | null
  linalg: LinearTransform2DAnalysis | null
  probSubMode: "dist" | "clt"
  distribution: DistributionAnalysis | null
  clt: CltSimulationResult | null
}

export function formatDiagnosticsSummary(input: DiagnosticsSummaryInput): string {
  const { activeModule } = input

  if (activeModule === "extrema1d" && input.extrema1d) {
    const a = input.extrema1d
    const maxText = a.unboundedAbove
      ? "+∞（无上界）"
      : a.globalMax
        ? `${n(a.globalMax.y)} (x = ${n(a.globalMax.x)}, ${a.globalMax.label})`
        : "无"
    const minText = a.unboundedBelow
      ? "-∞（无下界）"
      : a.globalMin
        ? `${n(a.globalMin.y)} (x = ${n(a.globalMin.x)}, ${a.globalMin.label})`
        : "无"
    const lines = [
      `【一元微积分综合】f(x) = ${input.expr1D}，区间 [${n(a.domain[0], 2)}, ${n(a.domain[1], 2)}]`,
      `全局最大值：${maxText}`,
      `全局最小值：${minText}`
    ]
    if (input.integral1d) {
      lines.push(
        `定积分 ∫f(x)dx = ${n(input.integral1d.signedArea, 5)}，绝对面积 = ${n(input.integral1d.absoluteArea, 5)}，弧长 L = ${n(input.integral1d.arcLength, 4)}，绕x轴体积 V = ${n(input.integral1d.revolutionVolumeX, 4)}`
      )
    }
    if (input.tangent1d) {
      lines.push(
        `导数与切线(x₀=${n(input.tangent1d.x0, 3)})：${input.tangent1d.symbolicDerivativePretty ? `f'(x) = ${input.tangent1d.symbolicDerivativePretty}，` : ""}切线 ${input.tangent1d.tangentEquation}，法线 ${input.tangent1d.normalEquation}`
      )
    }
    if (input.limit1d) {
      lines.push(`极限诊断：${input.limit1d.summary}`)
    }
    if (input.dualCurve1d) {
      lines.push(`对比函数 g(x) = ${input.dualCurve1d.gExpression}，交点数 ${input.dualCurve1d.intersections.length}，围成面积 = ${n(input.dualCurve1d.areaBetween, 5)}`)
    }
    return lines.join("\n")
  }

  if (activeModule === "parametricPolar") {
    if (input.paramPolarSubMode === "polar" && input.polar) {
      return [
        `【极坐标曲线】r(θ) = ${input.polar.rExpr}，θ ∈ [${n(input.polar.thetaRange[0], 2)}, ${n(input.polar.thetaRange[1], 2)}]`,
        `极坐标扇形面积 S = ${n(input.polar.sectorArea, 5)}，曲线弧长 L = ${n(input.polar.arcLength, 5)}`,
        `当前角 θ₀ = ${n(input.polar.activeTheta, 3)}：r = ${n(input.polar.activeR, 4)}，(x, y) = (${n(input.polar.activePoint.x, 3)}, ${n(input.polar.activePoint.y, 3)})`
      ].join("\n")
    }
    if (input.parametric) {
      return [
        `【参数方程曲线】x(t) = ${input.parametric.xExpr}，y(t) = ${input.parametric.yExpr}`,
        `总弧长 L = ${n(input.parametric.arcLength, 5)}，当前 t₀ = ${n(input.parametric.activeT, 3)}`,
        `斜率 dy/dx = ${n(input.parametric.dyDx, 4)}，曲率 κ = ${n(input.parametric.curvature, 4)}`
      ].join("\n")
    }
  }

  if (activeModule === "lagrange" && input.lagrange) {
    const lines = [
      `【拉格朗日乘数法】目标 f(x,y) = ${input.objectiveExpr}，约束 ${input.constraintExpr}`
    ]
    if (input.activeProbe) {
      lines.push(
        `当前动点 P(${n(input.activeProbe.x, 3)}, ${n(input.activeProbe.y, 3)})，f(P) = ${n(input.activeProbe.fValue)}，梯度夹角 ${n(input.activeProbe.angleDeg, 1)}°`
      )
    }
    if (input.lagrange.stationaryPoints.length > 0) {
      lines.push(
        "KKT 驻点：" +
          input.lagrange.stationaryPoints
            .map((sp) => `(${n(sp.x, 3)}, ${n(sp.y, 3)}) f=${n(sp.value, 3)} λ=${n(sp.lambda, 3)}`)
            .join("；")
      )
    }
    return lines.join("\n")
  }

  if (activeModule === "ode1d") {
    return `【ODE 斜率场】y' = ${input.odeRhsExpr}，已绘制 ${input.odeInitialCount} 条 RK45 双向特解曲线`
  }

  if (activeModule === "phase2d" && input.phasePlane) {
    const eqSummary = input.phasePlane.equilibria
      .map((eq) => `${eq.label}(${n(eq.x, 2)}, ${n(eq.y, 2)})`)
      .join("；")
    return [
      `【相平面向量场】x' = ${input.phasePExpr}，y' = ${input.phaseQExpr}`,
      `平衡点（${input.phasePlane.equilibria.length}）：${eqSummary || "视野内无平衡点"}`
    ].join("\n")
  }

  if (activeModule === "surface3d" && input.surface) {
    const lines = [`【3D 曲面与鞍点】z = ${input.surfaceExpr}`]
    if (input.surface.stationaryPoints.length > 0) {
      lines.push(
        "驻点 Hessian 判别：" +
          input.surface.stationaryPoints
            .map((sp) => `${sp.label}(${n(sp.x, 2)}, ${n(sp.y, 2)}, ${n(sp.z, 2)}) AC-B²=${n(sp.discriminant, 2)}`)
            .join("；")
      )
    }
    if (input.activeTangentPlane) {
      lines.push(`切平面：${input.activeTangentPlane.equation}`)
    }
    return lines.join("\n")
  }

  if (activeModule === "pde" && input.pdeState) {
    const s = input.pdeState
    return [
      `【PDE 数值场】类型=${s.kind}，t = ${n(s.time, 3)} s`,
      `u_max = ${n(s.uMax)}，u_min = ${n(s.uMin)}，L² 能量 = ${n(s.energy)}` +
        (input.poissonSolution ? `，SOR 迭代 ${input.poissonSolution.iterations} 步` : "")
    ].join("\n")
  }

  if (activeModule === "series") {
    if (input.seriesSubMode === "taylor" && input.taylor) {
      return [
        `【泰勒级数展开】x₀ = ${n(input.taylor.center, 3)}，n = ${input.taylor.order}`,
        `展开式：${input.taylor.polynomialText}`,
        `|x-x₀|≤1 最大误差：${n(input.taylor.maxLocalError, 5)}`
      ].join("\n")
    }
    if (input.seriesSubMode === "fourier" && input.fourier) {
      return `【傅里叶级数】N = ${input.fourier.harmonicsCount}，a₀/2 = ${n(0.5 * input.fourier.a0)}，RMS 误差 = ${n(input.fourier.rmsError)}，峰值过冲 = ${n(input.fourier.peakOvershoot)}`
    }
  }

  if (activeModule === "doubleIntegral" && input.doubleIntegral) {
    const d = input.doubleIntegral
    return `【二重积分】精确数值积分 = ${n(d.exactValue, 6)}，区域面积 S = ${n(d.domainArea, 5)}，当前黎曼和 = ${n(d.riemannSum, 5)}`
  }

  if (activeModule === "linalg" && input.linalg) {
    const l = input.linalg
    return [
      `【线性代数 2×2 变换】det(A) = ${n(l.determinant)}，rank(A) = ${l.rank}，tr(A) = ${n(l.trace, 3)}`,
      `SVD 奇异值：σ₁ = ${n(l.svd.sigma1)}，σ₂ = ${n(l.svd.sigma2)}，条件数 κ₂ = ${n(l.svd.conditionNumber, 3)}`
    ].join("\n")
  }

  if (activeModule === "probability") {
    if (input.probSubMode === "dist" && input.distribution) {
      const d = input.distribution
      return `【概率分布】P(${n(d.interval[0], 2)} ≤ X ≤ ${n(d.interval[1], 2)}) = ${(d.intervalProb * 100).toFixed(2)}% (${n(d.intervalProb, 5)})，E[X] = ${n(d.mean)}，Var(X) = ${n(d.variance)}`
    }
    if (input.probSubMode === "clt" && input.clt) {
      const c = input.clt
      return `【中心极限定理】理论均值 μ = ${n(c.theoreticalMean)}，样本均值 = ${n(c.empiricalMean)}，理论标准误 = ${n(c.theoreticalStdError)}，经验标准差 = ${n(c.empiricalStdDev)}`
    }
  }

  return "高等数学工作台数值诊断结论"
}

/**
 * Exports all visible <canvas> elements inside the stage container to a single PNG download.
 * Handles both 2D canvases and WebGL 3D canvases (with preserveDrawingBuffer), plus 2D+3D split mode.
 */
export function exportStageCanvasPng(stageEl: HTMLElement | null, moduleId: HigherMathModuleId): boolean {
  if (!stageEl) return false
  const canvases = Array.from(stageEl.querySelectorAll("canvas")).filter(
    (c) => c.width > 0 && c.height > 0
  )
  if (canvases.length === 0) return false

  let dataUrl: string
  try {
    if (canvases.length === 1) {
      dataUrl = canvases[0]!.toDataURL("image/png")
    } else {
      const gap = 12
      const totalWidth = canvases.reduce((sum, c) => sum + c.width, 0) + gap * (canvases.length - 1)
      const maxHeight = Math.max(...canvases.map((c) => c.height))
      const composite = document.createElement("canvas")
      composite.width = totalWidth
      composite.height = maxHeight
      const ctx = composite.getContext("2d")
      if (!ctx) return false
      ctx.fillStyle = "#f8fafc"
      ctx.fillRect(0, 0, totalWidth, maxHeight)
      let offsetX = 0
      for (const c of canvases) {
        ctx.drawImage(c, offsetX, 0)
        offsetX += c.width + gap
      }
      dataUrl = composite.toDataURL("image/png")
    }
  } catch {
    return false
  }

  const link = document.createElement("a")
  link.href = dataUrl
  link.download = `mathcanvas-calculus-${moduleId}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"

import type { GeometryDocument } from "@draw/dsl"
import { useCalculusStore } from "../../calculusStore"
import { DEFAULT_INSPECTOR_WIDTH } from "../../persistence/inspectorWidth"
import { InspectorResizeHandle } from "../InspectorResizeHandle"
import {
  DOUBLE_INTEGRAL_PRESETS,
  EXTREMA_1D_PRESETS,
  FOURIER_PRESETS,
  LAGRANGE_PRESETS,
  LINALG_PRESETS,
  ODE_1D_PRESETS,
  PARAMETRIC_CURVE_PRESETS,
  PDE_PRESETS,
  PHASE_PLANE_PRESETS,
  POLAR_CURVE_PRESETS,
  PROBABILITY_PRESETS,
  SURFACE_3D_PRESETS,
  TAYLOR_PRESETS,
  analyzeDefiniteIntegral1D,
  analyzeDoubleIntegral,
  analyzeDualCurve1D,
  analyzeExtrema1D,
  analyzeFourierSeries,
  analyzeLagrange2D,
  analyzeLimit1D,
  analyzeLinearTransform2D,
  analyzeOdeSlopeField,
  analyzeParametricCurve2D,
  analyzePhasePlane2D,
  analyzePolarCurve2D,
  analyzeProbabilityDistribution,
  analyzeSurface3D,
  analyzeTangentAndDerivative1D,
  analyzeTaylorSeries,
  compileScalarField1D,
  compileScalarField2D,
  computeTangentPlane3D,
  evaluateDivCurlProbe,
  evaluateLagrangePoint,
  findRoots1D,
  formatFriendlyMathError,
  formatLimitValue,
  integrateOde1DBidirectional,
  integratePhaseTrajectoryBidirectional,
  liftConstraintCurvesTo3D,
  projectPointOntoConstraint,
  routeHigherMathPrompt,
  simulateCentralLimitTheorem,
  type CltParentKind,
  type ComplexNumber,
  type DistributionKind,
  type DoubleIntegralAnalysis,
  type DoubleIntegralOrder,
  type DoubleIntegralPreset,
  type Extrema1DAnalysis,
  type Extrema1DPreset,
  type FourierAnalysis,
  type FourierPreset,
  type FourierWaveformKind,
  type LagrangeAnalysis,
  type LagrangePreset,
  type LimitTarget1D,
  type LinalgPreset,
  type Matrix2x2,
  type Ode1DPreset,
  type ParametricCurveAnalysis,
  type ParametricCurvePreset,
  type PdeBoundaryCondition,
  type PdeKind,
  type PdePreset,
  type PhasePlaneAnalysis,
  type PhasePlanePreset,
  type Point2D,
  type PolarCurveAnalysis,
  type PolarCurvePreset,
  type ProbabilityPreset,
  type Surface3DAnalysis,
  type Surface3DPreset,
  type TaylorAnalysis,
  type TaylorPreset,
  type ViewportBounds2D
} from "@draw/geometry-kernel"

import { CalculusCanvas2D } from "./CalculusCanvas2D"
import { CalculusParametricPolarCanvas } from "./CalculusParametricPolarCanvas"
import { ParametricPolarLeftControls, ParametricPolarRightDiagnostics } from "./CalculusParametricPolarPanels"
import { CalculusPhase3Canvas } from "./CalculusPhase3Canvas"
import { Phase3LeftControls, Phase3RightDiagnostics } from "./CalculusPhase3Panels"
import { CalculusPhase4Canvas } from "./CalculusPhase4Canvas"
import { Phase4LeftControls, Phase4RightDiagnostics } from "./CalculusPhase4Panels"
import { CalculusSurface3D } from "./CalculusSurface3D"
import { MathFormulaInput, MathKeyboardDock } from "./MathFormulaInput"
import {
  CALCULUS_MODULES,
  SMART_PROMPT_CHIPS,
  backspaceInInput,
  exportStageCanvasPng,
  formatDiagnosticsSummary,
  insertTokenIntoInput,
  type MathKeypadToken
} from "./calculusUxHelpers"
import { usePdeSimulation } from "./usePdeSimulation"

export type HigherMathModuleId =
  | "extrema1d"
  | "parametricPolar"
  | "lagrange"
  | "ode1d"
  | "phase2d"
  | "surface3d"
  | "pde"
  | "series"
  | "doubleIntegral"
  | "linalg"
  | "probability"

interface CalculusWorkbenchProps {
  document: GeometryDocument
  inspectorWidth?: number
  onInspectorResize?: (width: number) => void
  leftDockOpen?: boolean
  rightDockOpen?: boolean
  onToggleLeftDock?: () => void
  onToggleRightDock?: () => void
  copilotOpen?: boolean
  onToggleCopilot?: () => void
  copilotDrawer?: ReactNode
}

function defaultBoundsFor1D(domain: [number, number], yRange: [number, number]): ViewportBounds2D {
  const xPad = Math.max(0.4, (domain[1] - domain[0]) * 0.12)
  return {
    xMin: domain[0] - xPad,
    xMax: domain[1] + xPad,
    yMin: yRange[0],
    yMax: yRange[1]
  }
}

function fmtNum(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—"
  const clean = Math.abs(v) < 1e-7 ? 0 : v
  return Number(clean.toFixed(digits)).toString()
}

function fmtEigenvalue(z: ComplexNumber): string {
  const re = fmtNum(z.re, 2)
  if (Math.abs(z.im) < 1e-4) return re
  const im = fmtNum(Math.abs(z.im), 2)
  return `${re} ${z.im >= 0 ? "+" : "−"} ${im}i`
}

export function CalculusWorkbench({
  document,
  inspectorWidth,
  onInspectorResize,
  leftDockOpen,
  rightDockOpen,
  onToggleLeftDock,
  onToggleRightDock,
  copilotOpen = false,
  onToggleCopilot,
  copilotDrawer
}: CalculusWorkbenchProps) {
  const [activeModule, setActiveModule] = useState<HigherMathModuleId>("extrema1d")
  const [mobilePane, setMobilePane] = useState<"canvas" | "controls" | "diagnostics">("canvas")
  const [localLeftDockOpen, setLocalLeftDockOpen] = useState(true)
  const [localRightDockOpen, setLocalRightDockOpen] = useState(true)
  const [localInspectorWidth, setLocalInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH)
  const [actionToast, setActionToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const tablistRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLElement | null>(null)
  const controlsRef = useRef<HTMLElement | null>(null)
  const lastFormulaInputRef = useRef<HTMLInputElement | null>(null)

  const effectiveLeftDockOpen = leftDockOpen ?? localLeftDockOpen
  const effectiveRightDockOpen = rightDockOpen ?? localRightDockOpen
  const effectiveInspectorWidth = inspectorWidth ?? localInspectorWidth
  const toggleLeftDock = onToggleLeftDock ?? (() => setLocalLeftDockOpen((v) => !v))
  const toggleRightDock = onToggleRightDock ?? (() => setLocalRightDockOpen((v) => !v))
  const handleInspectorResize = onInspectorResize ?? setLocalInspectorWidth

  const showToast = useCallback((message: string) => {
    setActionToast(message)
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setActionToast(null)
      toastTimerRef.current = null
    }, 2400)
  }, [])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    const handleAndroidBack = (event: Event) => {
      if (mobilePane !== "canvas") {
        event.preventDefault()
        setMobilePane("canvas")
      }
    }
    window.addEventListener("mathcanvas:android-back", handleAndroidBack)
    return () => window.removeEventListener("mathcanvas:android-back", handleAndroidBack)
  }, [mobilePane])

  // ===== 1D Calculus Comprehensive state (Extrema + Integral + Tangent + Limits + Dual Curve) =====
  const initial1D = EXTREMA_1D_PRESETS[0]!
  const [expr1D, setExpr1D] = useState(initial1D.expression)
  const [domainAInput, setDomainAInput] = useState(String(initial1D.domain[0]))
  const [domainBInput, setDomainBInput] = useState(String(initial1D.domain[1]))
  const [showDerivative, setShowDerivative] = useState(false)
  const [showInflections, setShowInflections] = useState(true)
  const [showAsymptotes, setShowAsymptotes] = useState(true)
  const [showHorizontalTangents, setShowHorizontalTangents] = useState(true)
  const [showIntegralArea, setShowIntegralArea] = useState(true)
  const [showRoots1D, setShowRoots1D] = useState(true)
  const [showTangentProbe, setShowTangentProbe] = useState(false)
  const [tangentX0, setTangentX0] = useState(0.5)
  const [limitMode, setLimitMode] = useState<"point" | "pos_inf" | "neg_inf">("point")
  const [limitX0Input, setLimitX0Input] = useState("0")
  const [enableCompareG, setEnableCompareG] = useState(false)
  const [expr1DG, setExpr1DG] = useState("2*x - 1")
  const [focusedExtremaIndex, setFocusedExtremaIndex] = useState<number | null>(null)
  const [customBounds1D, setCustomBounds1D] = useState<ViewportBounds2D | null>(null)
  const [hoverWorld, setHoverWorld] = useState<{ x: number; y: number } | null>(null)

  const parsedDomain1D = useMemo<[number, number]>(() => {
    const a = Number(domainAInput)
    const b = Number(domainBInput)
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > 1e-4) {
      return a < b ? [a, b] : [b, a]
    }
    return [-4, 4]
  }, [domainAInput, domainBInput])

  const extrema1dResult = useMemo(() => {
    try {
      const analysis = analyzeExtrema1D(expr1D, parsedDomain1D, {
        includeDerivativeCurve: true
      })
      const field = compileScalarField1D(expr1D)
      return { ok: true as const, analysis, field }
    } catch (err) {
      return {
        ok: false as const,
        error: formatFriendlyMathError(err)
      }
    }
  }, [expr1D, parsedDomain1D])

  const integral1dAnalysis = useMemo(
    () => (extrema1dResult.ok ? analyzeDefiniteIntegral1D(extrema1dResult.field, parsedDomain1D) : null),
    [extrema1dResult, parsedDomain1D]
  )

  const roots1d = useMemo(
    () => (extrema1dResult.ok ? findRoots1D(extrema1dResult.field, parsedDomain1D) : []),
    [extrema1dResult, parsedDomain1D]
  )

  const tangent1dAnalysis = useMemo(
    () => (extrema1dResult.ok ? analyzeTangentAndDerivative1D(expr1D, extrema1dResult.field, tangentX0) : null),
    [expr1D, extrema1dResult, tangentX0]
  )

  const limit1dAnalysis = useMemo(() => {
    if (!extrema1dResult.ok) return null
    const target: LimitTarget1D = limitMode === "pos_inf"
      ? { kind: "pos_inf" }
      : limitMode === "neg_inf"
        ? { kind: "neg_inf" }
        : { kind: "point", x0: Number.isFinite(Number(limitX0Input)) ? Number(limitX0Input) : 0 }
    return analyzeLimit1D(extrema1dResult.field, target)
  }, [extrema1dResult, limitMode, limitX0Input])

  const dualCurve1dResult = useMemo(() => {
    if (!enableCompareG || !extrema1dResult.ok) return null
    try {
      return { ok: true as const, analysis: analyzeDualCurve1D(extrema1dResult.field, expr1DG, parsedDomain1D) }
    } catch (err) {
      return { ok: false as const, error: formatFriendlyMathError(err) }
    }
  }, [enableCompareG, extrema1dResult, expr1DG, parsedDomain1D])

  // ===== Parametric & Polar Curves state =====
  const initialParam = PARAMETRIC_CURVE_PRESETS[0]!
  const initialPolar = POLAR_CURVE_PRESETS[0]!
  const [paramPolarSubMode, setParamPolarSubMode] = useState<"parametric" | "polar">("polar")
  const [paramXExpr, setParamXExpr] = useState(initialParam.xExpr)
  const [paramYExpr, setParamYExpr] = useState(initialParam.yExpr)
  const [paramTMin, setParamTMin] = useState(String(initialParam.tRange[0]))
  const [paramTMax, setParamTMax] = useState(String(initialParam.tRange[1]))
  const [paramActiveT, setParamActiveT] = useState(initialParam.initialT)
  const [polarRExpr, setPolarRExpr] = useState(initialPolar.rExpr)
  const [polarThetaMin, setPolarThetaMin] = useState(String(initialPolar.thetaRange[0]))
  const [polarThetaMax, setPolarThetaMax] = useState(String(initialPolar.thetaRange[1]))
  const [polarActiveTheta, setPolarActiveTheta] = useState(initialPolar.initialTheta)
  const [paramPlaying, setParamPlaying] = useState(false)
  const [showParamTangent, setShowParamTangent] = useState(true)
  const [showPolarSector, setShowPolarSector] = useState(true)
  const [customParamBounds, setCustomParamBounds] = useState<ViewportBounds2D | null>(null)

  const parsedParamTRange = useMemo<[number, number]>(() => {
    const a = Number(paramTMin)
    const b = Number(paramTMax)
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > 1e-4) return a < b ? [a, b] : [b, a]
    return [0, 6.2832]
  }, [paramTMin, paramTMax])

  const parsedPolarThetaRange = useMemo<[number, number]>(() => {
    const a = Number(polarThetaMin)
    const b = Number(polarThetaMax)
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > 1e-4) return a < b ? [a, b] : [b, a]
    return [0, 6.2832]
  }, [polarThetaMin, polarThetaMax])

  useEffect(() => {
    if (activeModule !== "parametricPolar" || !paramPlaying) return
    let raf = 0
    const tick = () => {
      if (paramPolarSubMode === "parametric") {
        const [a, b] = parsedParamTRange
        const step = (b - a) / 220
        setParamActiveT((prev) => (prev + step > b ? a : prev + step))
      } else {
        const [a, b] = parsedPolarThetaRange
        const step = (b - a) / 220
        setPolarActiveTheta((prev) => (prev + step > b ? a : prev + step))
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [activeModule, paramPlaying, paramPolarSubMode, parsedParamTRange, parsedPolarThetaRange])

  const parametricResult = useMemo(() => {
    try {
      return {
        ok: true as const,
        analysis: analyzeParametricCurve2D(paramXExpr, paramYExpr, parsedParamTRange, paramActiveT)
      }
    } catch (err) {
      return { ok: false as const, error: formatFriendlyMathError(err) }
    }
  }, [paramXExpr, paramYExpr, parsedParamTRange, paramActiveT])

  const polarResult = useMemo(() => {
    try {
      return {
        ok: true as const,
        analysis: analyzePolarCurve2D(polarRExpr, parsedPolarThetaRange, polarActiveTheta)
      }
    } catch (err) {
      return { ok: false as const, error: formatFriendlyMathError(err) }
    }
  }, [polarRExpr, parsedPolarThetaRange, polarActiveTheta])

  const paramPolarBounds = useMemo<ViewportBounds2D>(() => {
    if (customParamBounds) return customParamBounds
    if (paramPolarSubMode === "parametric" && parametricResult.ok) return parametricResult.analysis.suggestedBounds
    if (paramPolarSubMode === "polar" && polarResult.ok) return polarResult.analysis.suggestedBounds
    return { xMin: -3.5, xMax: 3.5, yMin: -3.5, yMax: 3.5 }
  }, [customParamBounds, paramPolarSubMode, parametricResult, polarResult])

  const applyParamPreset = (preset: ParametricCurvePreset) => {
    setParamPolarSubMode("parametric")
    setParamXExpr(preset.xExpr)
    setParamYExpr(preset.yExpr)
    setParamTMin(String(preset.tRange[0]))
    setParamTMax(String(preset.tRange[1]))
    setParamActiveT(preset.initialT)
    setParamPlaying(false)
    setCustomParamBounds(null)
  }

  const applyPolarPreset = (preset: PolarCurvePreset) => {
    setParamPolarSubMode("polar")
    setPolarRExpr(preset.rExpr)
    setPolarThetaMin(String(preset.thetaRange[0]))
    setPolarThetaMax(String(preset.thetaRange[1]))
    setPolarActiveTheta(preset.initialTheta)
    setParamPlaying(false)
    setCustomParamBounds(null)
  }

  const bounds1D = useMemo<ViewportBounds2D>(() => {
    if (customBounds1D) return customBounds1D
    if (extrema1dResult.ok) {
      return defaultBoundsFor1D(extrema1dResult.analysis.domain, extrema1dResult.analysis.suggestedYRange)
    }
    return { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }
  }, [customBounds1D, extrema1dResult])

  const hover1DReadout = useMemo(() => {
    if (!hoverWorld || !extrema1dResult.ok) return null
    const x = hoverWorld.x
    const y = extrema1dResult.field.eval(x)
    const dy = extrema1dResult.field.derivative(x)
    return { x, y, dy }
  }, [hoverWorld, extrema1dResult])

  const apply1DPreset = (preset: Extrema1DPreset) => {
    setExpr1D(preset.expression)
    setDomainAInput(String(preset.domain[0]))
    setDomainBInput(String(preset.domain[1]))
    setCustomBounds1D(null)
    setFocusedExtremaIndex(null)
  }

  // ===== Lagrange Multipliers state (with 2D <-> 3D linked view!) =====
  const initialLagrange = LAGRANGE_PRESETS[0]!
  const [objectiveExpr, setObjectiveExpr] = useState(initialLagrange.objective)
  const [constraintExpr, setConstraintExpr] = useState(initialLagrange.constraint)
  const [boundsLagrange, setBoundsLagrange] = useState<ViewportBounds2D>(initialLagrange.bounds)
  const [contourCount, setContourCount] = useState(13)
  const [showGradients, setShowGradients] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [syncLevelToPoint, setSyncLevelToPoint] = useState(true)
  const [manualLevel, setManualLevel] = useState<number>(2)
  const [lagrangePoint, setLagrangePoint] = useState<Point2D | null>(initialLagrange.initialPoint)
  const [focusedStationaryIndex, setFocusedStationaryIndex] = useState<number | null>(null)
  const [lagrangeViewMode, setLagrangeViewMode] = useState<"2d" | "split" | "3d">("2d")

  const lagrangeResult = useMemo(() => {
    try {
      const fField = compileScalarField2D(objectiveExpr, "expression")
      const gField = compileScalarField2D(constraintExpr, "implicit")
      const analysis = analyzeLagrange2D(objectiveExpr, constraintExpr, boundsLagrange, {
        gridSize: 92,
        contourCount
      })
      return { ok: true as const, analysis, fField, gField }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "目标函数或约束方程解析失败"
      }
    }
  }, [objectiveExpr, constraintExpr, boundsLagrange, contourCount])

  const lagrange3DData = useMemo(() => {
    if (activeModule !== "lagrange" || lagrangeViewMode === "2d" || !lagrangeResult.ok) {
      return null
    }
    const surface = analyzeSurface3D(objectiveExpr, boundsLagrange, { gridSize: 44 })
    const liftedCurves = liftConstraintCurvesTo3D(lagrangeResult.fField, lagrangeResult.analysis.constraintCurves)
    const lagrangePoints = lagrangeResult.analysis.stationaryPoints.map((sp) => ({
      x: sp.x,
      y: sp.y,
      z: sp.value,
      isMax: sp.isGlobalMax,
      isMin: sp.isGlobalMin
    }))
    return { surface, liftedCurves, lagrangePoints }
  }, [activeModule, lagrangeViewMode, lagrangeResult, objectiveExpr, boundsLagrange])

  const resolvedLagrangePoint = useMemo<Point2D | null>(() => {
    if (!lagrangeResult.ok) return null
    const { gField, analysis } = lagrangeResult
    if (lagrangePoint) {
      const projected = projectPointOntoConstraint(gField, lagrangePoint.x, lagrangePoint.y, analysis.constraintCurves)
      if (projected) return projected
    }
    if (analysis.stationaryPoints.length > 0) {
      return { x: analysis.stationaryPoints[0]!.x, y: analysis.stationaryPoints[0]!.y }
    }
    const firstCurve = analysis.constraintCurves[0]
    return firstCurve && firstCurve.length > 0 ? firstCurve[Math.floor(firstCurve.length / 2)]! : null
  }, [lagrangeResult, lagrangePoint])

  const activeProbe = useMemo(() => {
    if (!lagrangeResult.ok || !resolvedLagrangePoint) return null
    return evaluateLagrangePoint(
      lagrangeResult.fField,
      lagrangeResult.gField,
      resolvedLagrangePoint.x,
      resolvedLagrangePoint.y
    )
  }, [lagrangeResult, resolvedLagrangePoint])

  const activeLevel = useMemo(() => {
    if (syncLevelToPoint && activeProbe && Number.isFinite(activeProbe.fValue)) {
      return activeProbe.fValue
    }
    return manualLevel
  }, [syncLevelToPoint, activeProbe, manualLevel])

  const applyLagrangePreset = (preset: LagrangePreset) => {
    setObjectiveExpr(preset.objective)
    setConstraintExpr(preset.constraint)
    setBoundsLagrange(preset.bounds)
    setLagrangePoint(preset.initialPoint)
    setSyncLevelToPoint(true)
    setFocusedStationaryIndex(null)
  }

  const handleDragLagrangePoint = useCallback(
    (wx: number, wy: number) => {
      if (!lagrangeResult.ok) return
      const projected = projectPointOntoConstraint(
        lagrangeResult.gField,
        wx,
        wy,
        lagrangeResult.analysis.constraintCurves
      )
      if (!projected) return

      const snapRadius = (boundsLagrange.xMax - boundsLagrange.xMin) * 0.022
      let finalPt = projected
      let matchedIdx: number | null = null
      lagrangeResult.analysis.stationaryPoints.forEach((sp, idx) => {
        if (Math.hypot(sp.x - projected.x, sp.y - projected.y) <= snapRadius) {
          finalPt = { x: sp.x, y: sp.y }
          matchedIdx = idx
        }
      })

      setLagrangePoint(finalPt)
      setFocusedStationaryIndex(matchedIdx)
      if (syncLevelToPoint) {
        const fv = lagrangeResult.fField.eval(finalPt.x, finalPt.y)
        if (Number.isFinite(fv)) setManualLevel(fv)
      }
    },
    [lagrangeResult, boundsLagrange, syncLevelToPoint]
  )

  const handleSelectStationary = useCallback(
    (index: number) => {
      if (!lagrangeResult.ok) return
      const sp = lagrangeResult.analysis.stationaryPoints[index]
      if (!sp) return
      setLagrangePoint({ x: sp.x, y: sp.y })
      setManualLevel(sp.value)
      setSyncLevelToPoint(true)
      setFocusedStationaryIndex(index)
    },
    [lagrangeResult]
  )

  const levelRange = lagrangeResult.ok ? lagrangeResult.analysis.suggestedLevelRange : [-6, 6]

  // ===== 1st-Order ODE Slope Field state =====
  const initialOde1D = ODE_1D_PRESETS[0]!
  const [odeRhsExpr, setOdeRhsExpr] = useState(initialOde1D.rhs)
  const [boundsOde1D, setBoundsOde1D] = useState<ViewportBounds2D>(initialOde1D.bounds)
  const [odeInitialPoints, setOdeInitialPoints] = useState<Point2D[]>(initialOde1D.initialPoints)
  const [odeGridDensity, setOdeGridDensity] = useState(20)

  const ode1DResult = useMemo(() => {
    try {
      const fField = compileScalarField2D(odeRhsExpr, "expression")
      const slopeField = analyzeOdeSlopeField(odeRhsExpr, boundsOde1D, {
        cols: odeGridDensity,
        rows: Math.max(10, Math.round(odeGridDensity * 0.72))
      })
      const trajectories = odeInitialPoints.map((pt) =>
        integrateOde1DBidirectional(fField, pt.x, pt.y, boundsOde1D)
      )
      return { ok: true as const, slopeField, trajectories, fField }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "一阶微分方程解析失败"
      }
    }
  }, [odeRhsExpr, boundsOde1D, odeInitialPoints, odeGridDensity])

  const applyOde1DPreset = (preset: Ode1DPreset) => {
    setOdeRhsExpr(preset.rhs)
    setBoundsOde1D(preset.bounds)
    setOdeInitialPoints([...preset.initialPoints])
  }

  // ===== 2D Autonomous Phase Plane state =====
  const initialPhase = PHASE_PLANE_PRESETS[0]!
  const [phasePExpr, setPhasePExpr] = useState(initialPhase.pExpr)
  const [phaseQExpr, setPhaseQExpr] = useState(initialPhase.qExpr)
  const [boundsPhase, setBoundsPhase] = useState<ViewportBounds2D>(initialPhase.bounds)
  const [phaseInitialPoints, setPhaseInitialPoints] = useState<Point2D[]>(initialPhase.initialPoints)
  const [showNullclines, setShowNullclines] = useState(true)
  const [showEquilibria, setShowEquilibria] = useState(true)
  const [focusedEquilibriumIndex, setFocusedEquilibriumIndex] = useState<number | null>(null)

  const phaseResult = useMemo(() => {
    try {
      const pField = compileScalarField2D(phasePExpr, "expression")
      const qField = compileScalarField2D(phaseQExpr, "expression")
      const phasePlane = analyzePhasePlane2D(phasePExpr, phaseQExpr, boundsPhase)
      const trajectories = phaseInitialPoints.map((pt) =>
        integratePhaseTrajectoryBidirectional(pField, qField, pt.x, pt.y, boundsPhase)
      )
      return { ok: true as const, phasePlane, trajectories, pField, qField }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "二维自治系统方程解析失败"
      }
    }
  }, [phasePExpr, phaseQExpr, boundsPhase, phaseInitialPoints])

  const applyPhasePreset = (preset: PhasePlanePreset) => {
    setPhasePExpr(preset.pExpr)
    setPhaseQExpr(preset.qExpr)
    setBoundsPhase(preset.bounds)
    setPhaseInitialPoints([...preset.initialPoints])
    setFocusedEquilibriumIndex(null)
  }

  // ===== 3D Explicit Surface Extrema & Saddle state =====
  const initialSurface = SURFACE_3D_PRESETS[0]!
  const [surfaceExpr, setSurfaceExpr] = useState(initialSurface.expression)
  const [surfaceBounds, setSurfaceBounds] = useState<ViewportBounds2D>(initialSurface.bounds)
  const [surfaceWireframe, setSurfaceWireframe] = useState(true)
  const [surfaceOpacity, setSurfaceOpacity] = useState(0.9)
  const [showSurfaceSlice, setShowSurfaceSlice] = useState(false)
  const [surfaceSliceZ, setSurfaceSliceZ] = useState(0)
  const [showTangentPlane, setShowTangentPlane] = useState(true)
  const [focusedSurfaceIndex, setFocusedSurfaceIndex] = useState<number | null>(0)
  const [useCustomSurfaceProbe, setUseCustomSurfaceProbe] = useState(false)
  const [surfaceProbeX, setSurfaceProbeX] = useState(1)
  const [surfaceProbeY, setSurfaceProbeY] = useState(0.5)
  const [surfaceDirDeg, setSurfaceDirDeg] = useState(45)

  const surfaceResult = useMemo(() => {
    try {
      const fField = compileScalarField2D(surfaceExpr, "expression")
      const analysis = analyzeSurface3D(surfaceExpr, surfaceBounds, { gridSize: 50 })
      return { ok: true as const, analysis, fField }
    } catch (err) {
      return {
        ok: false as const,
        error: formatFriendlyMathError(err)
      }
    }
  }, [surfaceExpr, surfaceBounds])

  const selectedSurfaceStationary = useMemo(() => {
    if (!surfaceResult.ok || surfaceResult.analysis.stationaryPoints.length === 0) return null
    const idx = focusedSurfaceIndex ?? 0
    return surfaceResult.analysis.stationaryPoints[idx] ?? surfaceResult.analysis.stationaryPoints[0]!
  }, [surfaceResult, focusedSurfaceIndex])

  const activeTangentPlane = useMemo(() => {
    if (!showTangentPlane || !surfaceResult.ok) return null
    if (useCustomSurfaceProbe) {
      return computeTangentPlane3D(surfaceResult.fField, surfaceProbeX, surfaceProbeY)
    }
    if (!selectedSurfaceStationary) return null
    return computeTangentPlane3D(surfaceResult.fField, selectedSurfaceStationary.x, selectedSurfaceStationary.y)
  }, [showTangentPlane, surfaceResult, useCustomSurfaceProbe, surfaceProbeX, surfaceProbeY, selectedSurfaceStationary])

  const surfaceDirectionalProbe = useMemo(() => {
    if (!surfaceResult.ok) return null
    const x0 = useCustomSurfaceProbe ? surfaceProbeX : (selectedSurfaceStationary?.x ?? surfaceProbeX)
    const y0 = useCustomSurfaceProbe ? surfaceProbeY : (selectedSurfaceStationary?.y ?? surfaceProbeY)
    const tp = computeTangentPlane3D(surfaceResult.fField, x0, y0)
    if (!tp) return null
    const rad = (surfaceDirDeg * Math.PI) / 180
    const ux = Math.cos(rad)
    const uy = Math.sin(rad)
    const directionalDerivative = tp.fx * ux + tp.fy * uy
    const gradNorm = Math.hypot(tp.fx, tp.fy)
    return {
      ...tp,
      dirDeg: surfaceDirDeg,
      ux,
      uy,
      directionalDerivative,
      gradNorm
    }
  }, [surfaceResult, useCustomSurfaceProbe, surfaceProbeX, surfaceProbeY, selectedSurfaceStationary, surfaceDirDeg])

  const applySurfacePreset = (preset: Surface3DPreset) => {
    setSurfaceExpr(preset.expression)
    setSurfaceBounds(preset.bounds)
    setFocusedSurfaceIndex(0)
    setShowSurfaceSlice(false)
  }

  // ===== Phase 3: PDE Simulation state =====
  const initialPde = PDE_PRESETS[0]!
  const [pdeKind, setPdeKind] = useState<PdeKind>(initialPde.kind)
  const [pdeInitExpr, setPdeInitExpr] = useState(initialPde.initialExpr)
  const [pdeBoundaryExpr, setPdeBoundaryExpr] = useState(initialPde.boundaryExpr ?? "0")
  const [pdeBoundary, setPdeBoundary] = useState<PdeBoundaryCondition>(initialPde.boundary)
  const [pdeParam, setPdeParam] = useState(initialPde.param)
  const [pdeBounds, setPdeBounds] = useState<ViewportBounds2D>(initialPde.bounds)
  const [pdeView3D, setPdeView3D] = useState(false)

  const pdeSim = usePdeSimulation({
    active: activeModule === "pde",
    kind: pdeKind,
    initialExpr: pdeInitExpr,
    boundaryExpr: pdeBoundaryExpr,
    boundary: pdeBoundary,
    param: pdeParam,
    bounds: pdeBounds
  })

  const applyPdePreset = (preset: PdePreset) => {
    setPdeKind(preset.kind)
    setPdeInitExpr(preset.initialExpr)
    setPdeBoundaryExpr(preset.boundaryExpr ?? "0")
    setPdeBoundary(preset.boundary)
    setPdeParam(preset.param)
    setPdeBounds(preset.bounds)
  }

  const pdeSurface3D = useMemo(() => {
    if (!pdeView3D || !pdeSim.state) return null
    return {
      expression: pdeInitExpr,
      bounds: pdeSim.state.bounds,
      gridSize: pdeSim.state.gridSize,
      zGrid: pdeSim.state.u,
      zMin: Math.min(-1.2, pdeSim.state.uMin),
      zMax: Math.max(1.2, pdeSim.state.uMax),
      stationaryPoints: []
    }
  }, [pdeView3D, pdeSim.state, pdeInitExpr])

  // ===== Phase 3: Taylor & Fourier Series state =====
  const initialTaylor = TAYLOR_PRESETS[0]!
  const [seriesSubMode, setSeriesSubMode] = useState<"taylor" | "fourier">("taylor")
  const [taylorExpr, setTaylorExpr] = useState(initialTaylor.expression)
  const [taylorCenter, setTaylorCenter] = useState(initialTaylor.center)
  const [taylorOrder, setTaylorOrder] = useState(initialTaylor.order)
  const [showTaylorError, setShowTaylorError] = useState(false)
  const [boundsSeries, setBoundsSeries] = useState<ViewportBounds2D>({
    xMin: -6.5, xMax: 6.5, yMin: -2.4, yMax: 2.4
  })

  const initialFourier = FOURIER_PRESETS[0]!
  const [fourierWaveform, setFourierWaveform] = useState<FourierWaveformKind>(initialFourier.waveform)
  const [fourierCustomExpr, setFourierCustomExpr] = useState("x^2 / 3 - 1")
  const [fourierHarmonics, setFourierHarmonics] = useState(initialFourier.harmonics)
  const [showEpicycles, setShowEpicycles] = useState(true)
  const [epicyclePhase, setEpicyclePhase] = useState(0.6)
  const [epicyclePlaying, setEpicyclePlaying] = useState(false)

  useEffect(() => {
    if (activeModule !== "series" || seriesSubMode !== "fourier" || !epicyclePlaying) return
    let raf = 0
    const tick = () => {
      setEpicyclePhase((prev) => {
        const next = prev + 0.045
        return next > 2 * Math.PI ? -2 * Math.PI : next
      })
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [activeModule, seriesSubMode, epicyclePlaying])

  const taylorResult = useMemo(() => {
    try {
      const analysis = analyzeTaylorSeries(taylorExpr, taylorCenter, taylorOrder, [boundsSeries.xMin, boundsSeries.xMax])
      return { ok: true as const, analysis }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "泰勒展开失败" }
    }
  }, [taylorExpr, taylorCenter, taylorOrder, boundsSeries.xMin, boundsSeries.xMax])

  const fourierResult = useMemo(() => {
    try {
      const analysis = analyzeFourierSeries(fourierWaveform, fourierHarmonics, Math.PI, fourierCustomExpr)
      return { ok: true as const, analysis }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "傅里叶展开失败" }
    }
  }, [fourierWaveform, fourierHarmonics, fourierCustomExpr])

  const applyTaylorPreset = (p: TaylorPreset) => {
    setTaylorExpr(p.expression)
    setTaylorCenter(p.center)
    setTaylorOrder(p.order)
    setBoundsSeries({ xMin: p.domain[0], xMax: p.domain[1], yMin: -2.4, yMax: 2.4 })
  }

  const applyFourierPreset = (p: FourierPreset) => {
    setFourierWaveform(p.waveform)
    setFourierHarmonics(p.harmonics)
    if (p.customExpr) setFourierCustomExpr(p.customExpr)
    setBoundsSeries({ xMin: -2 * p.halfPeriod, xMax: 2 * p.halfPeriod, yMin: -1.8, yMax: 1.8 })
  }

  // ===== Phase 3: Double Integral state =====
  const initialDi = DOUBLE_INTEGRAL_PRESETS[0]!
  const [diIntegrand, setDiIntegrand] = useState(initialDi.integrandExpr)
  const [diOrder, setDiOrder] = useState<DoubleIntegralOrder>(initialDi.order)
  const [diOuterMin, setDiOuterMin] = useState(initialDi.outerMinExpr)
  const [diOuterMax, setDiOuterMax] = useState(initialDi.outerMaxExpr)
  const [diInnerMin, setDiInnerMin] = useState(initialDi.innerMinExpr)
  const [diInnerMax, setDiInnerMax] = useState(initialDi.innerMaxExpr)
  const [diPartitions, setDiPartitions] = useState(10)
  const [diScanRatio, setDiScanRatio] = useState(0.46)
  const [showRiemannGrid, setShowRiemannGrid] = useState(true)
  const [customDiBounds, setCustomDiBounds] = useState<ViewportBounds2D | null>(null)
  const [activeDiPresetId, setActiveDiPresetId] = useState<string | null>(initialDi.id)

  const diResult = useMemo(() => {
    try {
      const analysis = analyzeDoubleIntegral({
        integrandExpr: diIntegrand,
        order: diOrder,
        outerMinExpr: diOuterMin,
        outerMaxExpr: diOuterMax,
        innerMinExpr: diInnerMin,
        innerMaxExpr: diInnerMax,
        partitions: diPartitions,
        scanRatio: diScanRatio
      })
      return { ok: true as const, analysis }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "二重积分区域或被积函数无效" }
    }
  }, [diIntegrand, diOrder, diOuterMin, diOuterMax, diInnerMin, diInnerMax, diPartitions, diScanRatio])

  const diBounds = customDiBounds ?? (diResult.ok ? diResult.analysis.suggestedBounds : { xMin: -2, xMax: 2, yMin: -2, yMax: 2 })

  const activeDiPreset = useMemo(
    () => DOUBLE_INTEGRAL_PRESETS.find((p) => p.id === activeDiPresetId) ?? null,
    [activeDiPresetId]
  )

  const applyDiPreset = (p: DoubleIntegralPreset) => {
    setActiveDiPresetId(p.id)
    setDiIntegrand(p.integrandExpr)
    setDiOrder(p.order)
    setDiOuterMin(p.outerMinExpr)
    setDiOuterMax(p.outerMaxExpr)
    setDiInnerMin(p.innerMinExpr)
    setDiInnerMax(p.innerMaxExpr)
    setCustomDiBounds(null)
  }

  const handleSwapOrderTwin = () => {
    if (!activeDiPreset?.swappedTwin) return
    if (diOrder === activeDiPreset.order) {
      const twin = activeDiPreset.swappedTwin
      setDiOrder(twin.order)
      setDiOuterMin(twin.outerMinExpr)
      setDiOuterMax(twin.outerMaxExpr)
      setDiInnerMin(twin.innerMinExpr)
      setDiInnerMax(twin.innerMaxExpr)
    } else {
      setDiOrder(activeDiPreset.order)
      setDiOuterMin(activeDiPreset.outerMinExpr)
      setDiOuterMax(activeDiPreset.outerMaxExpr)
      setDiInnerMin(activeDiPreset.innerMinExpr)
      setDiInnerMax(activeDiPreset.innerMaxExpr)
    }
  }

  // Live Div/Curl probe in phase2d mode
  const phaseDivCurlProbe = useMemo(() => {
    if (activeModule !== "phase2d" || !phaseResult.ok) return null
    const pt = hoverWorld ?? { x: 1, y: 1 }
    return evaluateDivCurlProbe(phaseResult.pField, phaseResult.qField, pt.x, pt.y)
  }, [activeModule, phaseResult, hoverWorld])

  // ===== Phase 4: Linear Algebra 2x2 state =====
  const initialLinalg = LINALG_PRESETS[0]!
  const [matrix2x2, setMatrix2x2] = useState<Matrix2x2>(initialLinalg.matrix)
  const [linalgProgress, setLinalgProgress] = useState(1)
  const [linalgPlaying, setLinalgPlaying] = useState(false)
  const [showEigenvectors, setShowEigenvectors] = useState(true)
  const [showSvdCircle, setShowSvdCircle] = useState(true)
  const [linalgBounds, setLinalgBounds] = useState<ViewportBounds2D>({
    xMin: -3.5, xMax: 3.5, yMin: -3.2, yMax: 3.2
  })

  useEffect(() => {
    if (activeModule !== "linalg" || !linalgPlaying) return
    let raf = 0
    const tick = () => {
      setLinalgProgress((prev) => {
        const next = prev + 0.015
        if (next >= 1) {
          setLinalgPlaying(false)
          return 1
        }
        return next
      })
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [activeModule, linalgPlaying])

  const linalgAnalysis = useMemo(
    () => analyzeLinearTransform2D(matrix2x2, linalgProgress),
    [matrix2x2, linalgProgress]
  )

  const applyLinalgPreset = (p: LinalgPreset) => {
    setMatrix2x2([[p.matrix[0][0], p.matrix[0][1]], [p.matrix[1][0], p.matrix[1][1]]])
    setLinalgProgress(1)
    setLinalgPlaying(false)
  }

  // ===== Phase 4: Probability & CLT state =====
  const initialProb = PROBABILITY_PRESETS[0]!
  const [probSubMode, setProbSubMode] = useState<"dist" | "clt">("dist")
  const [distKind, setDistKind] = useState<DistributionKind>(initialProb.kind)
  const [distParam1, setDistParam1] = useState(initialProb.param1)
  const [distParam2, setDistParam2] = useState(initialProb.param2 ?? 1)
  const [probIntervalA, setProbIntervalA] = useState(initialProb.intervalA)
  const [probIntervalB, setProbIntervalB] = useState(initialProb.intervalB)
  const [showCdf, setShowCdf] = useState(false)
  const [customProbBounds, setCustomProbBounds] = useState<ViewportBounds2D | null>(null)

  const [cltParent, setCltParent] = useState<CltParentKind>("exponential")
  const [cltSampleSize, setCltSampleSize] = useState(12)
  const [cltSeed, setCltSeed] = useState(20261124)

  const distAnalysis = useMemo(
    () =>
      analyzeProbabilityDistribution({
        kind: distKind,
        param1: distParam1,
        param2: distParam2,
        intervalA: probIntervalA,
        intervalB: probIntervalB
      }),
    [distKind, distParam1, distParam2, probIntervalA, probIntervalB]
  )

  const cltAnalysis = useMemo(
    () =>
      simulateCentralLimitTheorem({
        parent: cltParent,
        sampleSize: cltSampleSize,
        numTrials: 1800,
        seed: cltSeed
      }),
    [cltParent, cltSampleSize, cltSeed]
  )

  const probBounds = customProbBounds ?? (probSubMode === "dist" ? distAnalysis.suggestedBounds : cltAnalysis.suggestedBounds)

  const applyProbPreset = (p: ProbabilityPreset) => {
    setProbSubMode("dist")
    setDistKind(p.kind)
    setDistParam1(p.param1)
    if (p.param2 !== undefined) setDistParam2(p.param2)
    setProbIntervalA(p.intervalA)
    setProbIntervalB(p.intervalB)
    setCustomProbBounds(null)
  }

   // ===== Phase 4: Smart Natural-Language Problem Bar =====
  const [smartPrompt, setSmartPrompt] = useState("")
  const [smartNotice, setSmartNotice] = useState<string | null>(null)
  const syncedRoute = useCalculusStore((s) => s.pendingRoute)
  const syncedPrompt = useCalculusStore((s) => s.sourcePrompt)
  const syncedRevision = useCalculusStore((s) => s.revision)
  const appliedSyncRevisionRef = useRef(0)

  const applyRoutedAction = useCallback((action: ReturnType<typeof routeHigherMathPrompt>, fromAgent = false) => {
    if (!action) return
    setSmartNotice(fromAgent ? `已同步 Agent 题目：${action.summary}` : action.summary)
    setActiveModule(action.module)

    switch (action.module) {
      case "extrema1d":
        setExpr1D(action.expression)
        if (action.domain) {
          setDomainAInput(String(action.domain[0]))
          setDomainBInput(String(action.domain[1]))
        }
        if (action.x0 !== undefined) {
          setTangentX0(action.x0)
          setShowTangentProbe(true)
        }
        if (action.compareExpr) {
          setExpr1DG(action.compareExpr)
          setEnableCompareG(true)
        }
        if (action.limitTarget) {
          setLimitMode(action.limitTarget.kind)
          if (action.limitTarget.kind === "point") {
            setLimitX0Input(String(action.limitTarget.x0))
          }
        }
        if (action.computeIntegral) setShowIntegralArea(true)
        if (action.computeRoots) setShowRoots1D(true)
        setCustomBounds1D(null)
        break
      case "parametricPolar":
        setParamPolarSubMode(action.subMode)
        if (action.subMode === "parametric") {
          if (action.xExpr) setParamXExpr(action.xExpr)
          if (action.yExpr) setParamYExpr(action.yExpr)
          if (action.tRange) {
            setParamTMin(String(action.tRange[0]))
            setParamTMax(String(action.tRange[1]))
          }
          if (action.activeT !== undefined) setParamActiveT(action.activeT)
        } else {
          if (action.rExpr) setPolarRExpr(action.rExpr)
          if (action.thetaRange) {
            setPolarThetaMin(String(action.thetaRange[0]))
            setPolarThetaMax(String(action.thetaRange[1]))
          }
          if (action.activeTheta !== undefined) setPolarActiveTheta(action.activeTheta)
        }
        setParamPlaying(false)
        setCustomParamBounds(null)
        break
      case "lagrange":
        setObjectiveExpr(action.objective)
        setConstraintExpr(action.constraint)
        break
      case "ode1d":
        setOdeRhsExpr(action.rhs)
        if (action.x0 !== undefined && action.y0 !== undefined) {
          setOdeInitialPoints([{ x: action.x0, y: action.y0 }])
        }
        break
      case "phase2d":
        setPhasePExpr(action.pExpr)
        setPhaseQExpr(action.qExpr)
        break
      case "surface3d":
        setSurfaceExpr(action.expression)
        if (action.tangentPoint) {
          setSurfaceProbeX(action.tangentPoint[0])
          setSurfaceProbeY(action.tangentPoint[1])
          setUseCustomSurfaceProbe(true)
          setShowTangentPlane(true)
        }
        if (action.dirAngleDeg !== undefined) {
          setSurfaceDirDeg(action.dirAngleDeg)
        }
        break
      case "pde":
        setPdeKind(action.kind)
        if (action.initialExpr) setPdeInitExpr(action.initialExpr)
        break
      case "series":
        setSeriesSubMode(action.subMode)
        if (action.expression) setTaylorExpr(action.expression)
        if (action.center !== undefined) setTaylorCenter(action.center)
        if (action.order !== undefined) {
          if (action.subMode === "taylor") setTaylorOrder(action.order)
          else setFourierHarmonics(action.order)
        }
        if (action.waveform) setFourierWaveform(action.waveform)
        break
      case "doubleIntegral":
        setDiOrder(action.order)
        if (action.integrand) setDiIntegrand(action.integrand)
        if (action.outerMinExpr !== undefined) setDiOuterMin(action.outerMinExpr)
        if (action.outerMaxExpr !== undefined) setDiOuterMax(action.outerMaxExpr)
        if (action.innerMinExpr !== undefined) setDiInnerMin(action.innerMinExpr)
        if (action.innerMaxExpr !== undefined) setDiInnerMax(action.innerMaxExpr)
        setCustomDiBounds(null)
        break
      case "linalg":
        setMatrix2x2(action.matrix)
        setLinalgProgress(1)
        break
      case "probability":
        setProbSubMode(action.subMode)
        if (action.kind) setDistKind(action.kind)
        if (action.param1 !== undefined) setDistParam1(action.param1)
        if (action.param2 !== undefined) setDistParam2(action.param2)
        if (action.interval) {
          setProbIntervalA(action.interval[0])
          setProbIntervalB(action.interval[1])
        }
        if (action.sampleSize !== undefined) setCltSampleSize(action.sampleSize)
        if (action.parent) setCltParent(action.parent)
        setCustomProbBounds(null)
        break
    }
  }, [])

  useEffect(() => {
    if (syncedRevision > appliedSyncRevisionRef.current && syncedRoute) {
      appliedSyncRevisionRef.current = syncedRevision
      if (syncedPrompt) setSmartPrompt(syncedPrompt)
      applyRoutedAction(syncedRoute, true)
    }
  }, [syncedRevision, syncedRoute, syncedPrompt, applyRoutedAction])

  const handleRunSmartPrompt = () => {
    const action = routeHigherMathPrompt(smartPrompt)
    applyRoutedAction(action, false)
  }

  const handleAddTrajectoryPoint = useCallback(
    (wx: number, wy: number) => {
      if (activeModule === "ode1d") {
        setOdeInitialPoints((prev) => [...prev.slice(-11), { x: wx, y: wy }])
      } else if (activeModule === "phase2d") {
        setPhaseInitialPoints((prev) => [...prev.slice(-11), { x: wx, y: wy }])
      }
    },
    [activeModule]
  )

  const handleMoveTrajectoryPoint = useCallback(
    (index: number, wx: number, wy: number) => {
      if (activeModule === "ode1d") {
        setOdeInitialPoints((prev) => prev.map((pt, i) => (i === index ? { x: wx, y: wy } : pt)))
      } else if (activeModule === "phase2d") {
        setPhaseInitialPoints((prev) => prev.map((pt, i) => (i === index ? { x: wx, y: wy } : pt)))
      }
    },
    [activeModule]
  )

  const subbarHint = activeModule === "extrema1d"
    ? "一元微积分全能台：极值最值、定积分面积/弧长/旋转体体积、符号导数切线、极限间断点与双曲线对比"
    : activeModule === "parametricPolar"
      ? "参数方程 (x(t), y(t)) 与极坐标 r = r(θ) 曲线：弧长、扇形面积、曲率、切向量与动画轨迹"
      : activeModule === "lagrange"
        ? "沿约束曲线拖动动点 P 或滑动等高线 c，支持 2D 等高线与 3D 曲面分屏联动"
        : activeModule === "ode1d"
          ? "点击画布任意处即可用 RK45 绘制双向特解曲线，拖拽初值点实时更新"
          : activeModule === "phase2d"
            ? "点击画布绘制相轨线，实时读取散度/旋度，自动提取零倾线与平衡点稳定性"
            : activeModule === "surface3d"
              ? "拖拽旋转 3D 曲面 z = f(x, y)，自动按 Hessian 判别式 AC − B² 区分极值与鞍点，并支持任意点方向导数与切平面"
              : activeModule === "pde"
                ? "Web Worker 实时数值模拟 2D 热传导、波动干涉与泊松稳态场，点击画布注入脉冲源"
                : activeModule === "series"
                  ? "幂级数自动微分精确展开 n 阶泰勒多项式 · 傅里叶谐波合成、频谱与吉布斯现象"
                  : activeModule === "doubleIntegral"
                    ? "直观演示二重积分「先 y 后 x / 先 x 后 y」一键换序扫描与极坐标 r dr dθ 扇形网格"
                    : activeModule === "linalg"
                      ? "拖动连续形变插值 t 观察网格变形、特征向量方向不变性与 SVD 椭圆映射"
                      : "调整分布参数与区间 [a, b]，或切换中心极限定理观察样本均值向正态收敛"

  // Keep last valid analysis snapshots so transient formula edits NEVER blank out the right panel!
  const lastValidRef = useRef<{
    extrema1d: Extrema1DAnalysis | null
    parametric: ParametricCurveAnalysis | null
    polar: PolarCurveAnalysis | null
    lagrange: LagrangeAnalysis | null
    phasePlane: PhasePlaneAnalysis | null
    surface: Surface3DAnalysis | null
    taylor: TaylorAnalysis | null
    fourier: FourierAnalysis | null
    doubleIntegral: DoubleIntegralAnalysis | null
  }>({
    extrema1d: null,
    parametric: null,
    polar: null,
    lagrange: null,
    phasePlane: null,
    surface: null,
    taylor: null,
    fourier: null,
    doubleIntegral: null
  })

  if (extrema1dResult.ok) lastValidRef.current.extrema1d = extrema1dResult.analysis
  if (parametricResult.ok) lastValidRef.current.parametric = parametricResult.analysis
  if (polarResult.ok) lastValidRef.current.polar = polarResult.analysis
  if (lagrangeResult.ok) lastValidRef.current.lagrange = lagrangeResult.analysis
  if (phaseResult.ok) lastValidRef.current.phasePlane = phaseResult.phasePlane
  if (surfaceResult.ok) lastValidRef.current.surface = surfaceResult.analysis
  if (taylorResult.ok) lastValidRef.current.taylor = taylorResult.analysis
  if (fourierResult.ok) lastValidRef.current.fourier = fourierResult.analysis
  if (diResult.ok) lastValidRef.current.doubleIntegral = diResult.analysis

  const displayExtrema1d = extrema1dResult.ok ? extrema1dResult.analysis : lastValidRef.current.extrema1d
  const displayParametric = parametricResult.ok ? parametricResult.analysis : lastValidRef.current.parametric
  const displayPolar = polarResult.ok ? polarResult.analysis : lastValidRef.current.polar
  const displayLagrange = lagrangeResult.ok ? lagrangeResult.analysis : lastValidRef.current.lagrange
  const displayPhasePlane = phaseResult.ok ? phaseResult.phasePlane : lastValidRef.current.phasePlane
  const displaySurface = surfaceResult.ok ? surfaceResult.analysis : lastValidRef.current.surface
  const displayTaylor = taylorResult.ok ? taylorResult.analysis : lastValidRef.current.taylor
  const displayFourier = fourierResult.ok ? fourierResult.analysis : lastValidRef.current.fourier
  const displayDoubleIntegral = diResult.ok ? diResult.analysis : lastValidRef.current.doubleIntegral

  const activeModuleMeta = useMemo(
    () => CALCULUS_MODULES.find((m) => m.id === activeModule) ?? CALCULUS_MODULES[0]!,
    [activeModule]
  )

  const activeDiagnosticsError: string | null = activeModule === "extrema1d"
    ? (extrema1dResult.ok ? (dualCurve1dResult && !dualCurve1dResult.ok ? `对比函数 g(x)：${dualCurve1dResult.error}` : null) : extrema1dResult.error)
    : activeModule === "parametricPolar"
      ? (paramPolarSubMode === "parametric"
        ? (parametricResult.ok ? null : parametricResult.error)
        : (polarResult.ok ? null : polarResult.error))
      : activeModule === "lagrange"
        ? (lagrangeResult.ok ? null : lagrangeResult.error)
        : activeModule === "ode1d"
          ? (ode1DResult.ok ? null : ode1DResult.error)
          : activeModule === "phase2d"
            ? (phaseResult.ok ? null : phaseResult.error)
            : activeModule === "surface3d"
              ? (surfaceResult.ok ? null : surfaceResult.error)
              : activeModule === "pde"
                ? pdeSim.error
                : activeModule === "series"
                  ? (seriesSubMode === "taylor"
                    ? (taylorResult.ok ? null : taylorResult.error)
                    : (fourierResult.ok ? null : fourierResult.error))
                  : activeModule === "doubleIntegral"
                    ? (diResult.ok ? null : diResult.error)
                    : null

  // Keep active tab scrolled into view inside the single-row horizontal tablist
  useEffect(() => {
    const activeTab = tablistRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
    activeTab?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeModule])

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = CALCULUS_MODULES.findIndex((m) => m.id === activeModule)
    if (idx < 0) return
    let nextIdx: number | null = null
    if (event.key === "ArrowRight") nextIdx = (idx + 1) % CALCULUS_MODULES.length
    else if (event.key === "ArrowLeft") nextIdx = (idx - 1 + CALCULUS_MODULES.length) % CALCULUS_MODULES.length
    else if (event.key === "Home") nextIdx = 0
    else if (event.key === "End") nextIdx = CALCULUS_MODULES.length - 1
    if (nextIdx === null) return
    event.preventDefault()
    const nextModule = CALCULUS_MODULES[nextIdx]!
    setActiveModule(nextModule.id)
    const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[nextIdx]?.focus()
  }

  const scrollTabsBy = (delta: number) => {
    tablistRef.current?.scrollBy?.({ left: delta, behavior: "smooth" })
  }

  const resolveActiveFormulaInput = (): HTMLInputElement | null => {
    let target = lastFormulaInputRef.current
    if (!target || !controlsRef.current?.contains(target)) {
      target = controlsRef.current?.querySelector<HTMLInputElement>('input[type="text"]') ?? null
    }
    if (target) lastFormulaInputRef.current = target
    return target
  }

  const handleKeypadInsert = (token: MathKeypadToken) => {
    const target = resolveActiveFormulaInput()
    if (!target) return
    insertTokenIntoInput(target, token)
  }

  const handleKeypadBackspace = () => {
    const target = resolveActiveFormulaInput()
    if (!target) return
    backspaceInInput(target)
  }

  const handleCopyDiagnostics = async () => {
    const summary = formatDiagnosticsSummary({
      activeModule,
      expr1D,
      extrema1d: displayExtrema1d,
      integral1d: integral1dAnalysis,
      tangent1d: tangent1dAnalysis,
      limit1d: limit1dAnalysis,
      dualCurve1d: dualCurve1dResult?.ok ? dualCurve1dResult.analysis : null,
      paramPolarSubMode,
      parametric: displayParametric,
      polar: displayPolar,
      objectiveExpr,
      constraintExpr,
      lagrange: displayLagrange,
      activeProbe,
      odeRhsExpr,
      odeInitialCount: odeInitialPoints.length,
      phasePExpr,
      phaseQExpr,
      phasePlane: displayPhasePlane,
      surfaceExpr,
      surface: displaySurface,
      activeTangentPlane,
      pdeState: pdeSim.state,
      poissonSolution: pdeSim.poissonSolution,
      seriesSubMode,
      taylor: displayTaylor,
      fourier: displayFourier,
      doubleIntegral: displayDoubleIntegral,
      linalg: linalgAnalysis,
      probSubMode,
      distribution: distAnalysis,
      clt: cltAnalysis
    })
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary)
        showToast("已复制当前模块数值结论")
        return
      }
      throw new Error("clipboard unavailable")
    } catch {
      showToast("当前环境不支持一键剪贴板，请手动选中复制")
    }
  }

  const handleExportPng = () => {
    const ok = exportStageCanvasPng(stageRef.current, activeModule)
    showToast(ok ? `已导出 ${activeModuleMeta.shortLabel} 高清 PNG` : "当前画布尚未就绪，暂无法导出 PNG")
  }

  return (
    <div
      className="calculus-workbench"
      data-mobile-pane={mobilePane}
      data-left-open={effectiveLeftDockOpen ? "true" : "false"}
      data-right-open={effectiveRightDockOpen ? "true" : "false"}
      data-copilot-open={copilotOpen ? "true" : "false"}
    >
      {/* Top 2-row subbar: Row 1 single-row scrollable tabs, Row 2 smart problem bar + mobile switcher */}
      <header className="calculus-subbar" aria-label="高等数学子模块">
        <div className="calculus-tabs-row">
          <button
            type="button"
            className="calculus-tab-scroll-btn"
            aria-label="向左滚动模块标签"
            title="向左滚动模块"
            onClick={() => scrollTabsBy(-220)}
          >
            ‹
          </button>
          <div
            ref={tablistRef}
            className="calculus-module-tabs"
            role="tablist"
            aria-label="高数模块切换"
            onKeyDown={handleTabKeyDown}
          >
            {CALCULUS_MODULES.map((mod) => (
              <button
                key={mod.id}
                type="button"
                role="tab"
                aria-selected={activeModule === mod.id}
                aria-pressed={activeModule === mod.id}
                onClick={() => setActiveModule(mod.id)}
              >
                {mod.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="calculus-tab-scroll-btn"
            aria-label="向右滚动模块标签"
            title="向右滚动模块"
            onClick={() => scrollTabsBy(220)}
          >
            ›
          </button>
        </div>

        <div className="calculus-tools-row">
          <form
            className="calculus-smart-bar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              handleRunSmartPrompt()
            }}
          >
            <input
              type="text"
              aria-label="智能读题直达输入框"
              value={smartPrompt}
              onChange={(e) => setSmartPrompt(e.target.value)}
              placeholder="✨ 智能读题直达：输入高数/线代/概率题目，如 矩阵 [[2,1],[1,2]] 特征值…"
            />
            <button type="submit" className="calculus-chip-btn primary">解析直达</button>
          </form>

          <div className="calculus-quick-prompts" role="group" aria-label="示例题目快捷入口">
            {SMART_PROMPT_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="calculus-quick-prompt-chip"
                title={chip.prompt}
                onClick={() => {
                  setSmartPrompt(chip.prompt)
                  applyRoutedAction(routeHigherMathPrompt(chip.prompt), false)
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {smartNotice && (
            <span className="calculus-smart-notice" role="status">
              <span>{smartNotice}</span>
              <button
                type="button"
                className="calculus-notice-close"
                aria-label="关闭路由提示"
                onClick={() => setSmartNotice(null)}
              >
                ×
              </button>
            </span>
          )}

          <div className="calculus-mobile-switcher" role="group" aria-label="移动端视图切换">
            <button type="button" aria-pressed={mobilePane === "controls"} onClick={() => setMobilePane("controls")}>公式与预设</button>
            <button type="button" aria-pressed={mobilePane === "canvas"} onClick={() => setMobilePane("canvas")}>画布</button>
            <button type="button" aria-pressed={mobilePane === "diagnostics"} onClick={() => setMobilePane("diagnostics")}>属性诊断</button>
            {onToggleCopilot && (
              <button type="button" aria-pressed={copilotOpen} onClick={onToggleCopilot}>✨ AI</button>
            )}
          </div>
        </div>
      </header>

      {/* Main 3-column (+ optional AI Copilot drawer) workbench */}
      <div className="calculus-body">
        {/* Left: Formula, parameters & presets */}
        <aside
          ref={controlsRef}
          className="calculus-sidebar calculus-controls"
          aria-label="公式与参数面板"
          onFocusCapture={(event) => {
            const target = event.target
            if (target instanceof HTMLInputElement && target.type === "text") {
              lastFormulaInputRef.current = target
            }
          }}
        >
          <div className="calculus-dock-header">
            <span className="calculus-dock-title">公式与参数</span>
            <span className="calculus-dock-badge">{activeModuleMeta.shortLabel}</span>
            <button
              type="button"
              className="calculus-dock-icon-btn"
              title="收起左侧公式栏"
              aria-label="收起左侧公式栏"
              onClick={toggleLeftDock}
            >
              ✕
            </button>
          </div>

          {activeModuleMeta.hasFormulaInputs && (
            <MathKeyboardDock
              onInsert={handleKeypadInsert}
              onBackspace={handleKeypadBackspace}
            />
          )}

          {/* Backward compatibility for legacy .mgeo documents saved in `calculus` workspace */}
          {document.primitives.length > 0 && (
            <section className="calculus-card calculus-legacy-card algebra-panel" aria-label="文档兼容对象">
              <h2>文档兼容对象（{document.primitives.length}）</h2>
              <ul className="calculus-legacy-list">
                {document.primitives.map((primitive) => (
                  <li key={primitive.id} className="object-row">
                    <span className="object-name">{primitive.label ?? primitive.id}</span>
                    <small>{primitive.type}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {activeModule === "extrema1d" && (
            <>
              <section className="calculus-card">
                <h2>目标函数与闭区间</h2>
                <MathFormulaInput
                  label="函数表达式 f(x)"
                  prefix="f(x) ="
                  value={expr1D}
                  onChange={(next) => {
                    setExpr1D(next)
                    setFocusedExtremaIndex(null)
                  }}
                  placeholder="支持 2x^3 - 3x + 1、sin^2(x)、arcsin(x) 或粘贴 LaTeX"
                />
                <div className="calculus-domain-row">
                  <label className="calculus-field">
                    <span>左端点 a</span>
                    <input
                      type="number"
                      step="0.2"
                      value={domainAInput}
                      onChange={(e) => {
                        setDomainAInput(e.target.value)
                        setCustomBounds1D(null)
                      }}
                    />
                  </label>
                  <label className="calculus-field">
                    <span>右端点 b</span>
                    <input
                      type="number"
                      step="0.2"
                      value={domainBInput}
                      onChange={(e) => {
                        setDomainBInput(e.target.value)
                        setCustomBounds1D(null)
                      }}
                    />
                  </label>
                </div>
                <div className="calculus-inline-actions" role="group" aria-label="快捷闭区间">
                  {([
                    ["[-2.2, 2.5]", "-2.2", "2.5"],
                    ["[-π, π]", "-3.1416", "3.1416"],
                    ["[-5, 5]", "-5", "5"]
                  ] as const).map(([label, aVal, bVal]) => (
                    <button
                      key={label}
                      type="button"
                      className="calculus-chip-btn"
                      onClick={() => {
                        setDomainAInput(aVal)
                        setDomainBInput(bVal)
                        setCustomBounds1D(null)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="calculus-check">
                  <input
                    type="checkbox"
                    checked={enableCompareG}
                    onChange={(e) => setEnableCompareG(e.target.checked)}
                  />
                  <span>叠加对比函数 g(x)（求交点与围成面积）</span>
                </label>

                {enableCompareG && (
                  <MathFormulaInput
                    label="对比函数 g(x)"
                    prefix="g(x) ="
                    value={expr1DG}
                    onChange={setExpr1DG}
                    placeholder="例如：2x - 1 或 cos(x)"
                  />
                )}
              </section>

              <section className="calculus-card">
                <h2>切线探针与极限点设置</h2>
                <label className="calculus-check">
                  <input
                    type="checkbox"
                    checked={showTangentProbe}
                    onChange={(e) => setShowTangentProbe(e.target.checked)}
                  />
                  <span>在画布显示任意点 x₀ 切线与法线</span>
                </label>
                <label className="calculus-slider-field">
                  <span className="calculus-slider-head">
                    <span>切点横坐标 x₀</span>
                    <output>{fmtNum(tangentX0, 3)}</output>
                  </span>
                  <input
                    type="range"
                    min={parsedDomain1D[0]}
                    max={parsedDomain1D[1]}
                    step={(parsedDomain1D[1] - parsedDomain1D[0]) / 200}
                    value={Math.max(parsedDomain1D[0], Math.min(parsedDomain1D[1], tangentX0))}
                    onChange={(e) => {
                      setTangentX0(Number(e.target.value))
                      if (!showTangentProbe) setShowTangentProbe(true)
                    }}
                  />
                </label>

                <div className="calculus-field">
                  <span>极限趋近目标（x → x₀ / ±∞）</span>
                  <div className="calculus-inline-actions" role="group" aria-label="快捷极限点">
                    <button
                      type="button"
                      className={`calculus-chip-btn${limitMode === "point" && limitX0Input === "0" ? " primary" : ""}`}
                      onClick={() => { setLimitMode("point"); setLimitX0Input("0") }}
                    >
                      x→0
                    </button>
                    <button
                      type="button"
                      className={`calculus-chip-btn${limitMode === "point" && limitX0Input === "1" ? " primary" : ""}`}
                      onClick={() => { setLimitMode("point"); setLimitX0Input("1") }}
                    >
                      x→1
                    </button>
                    <button
                      type="button"
                      className={`calculus-chip-btn${limitMode === "pos_inf" ? " primary" : ""}`}
                      onClick={() => setLimitMode("pos_inf")}
                    >
                      x→+∞
                    </button>
                    <button
                      type="button"
                      className={`calculus-chip-btn${limitMode === "neg_inf" ? " primary" : ""}`}
                      onClick={() => setLimitMode("neg_inf")}
                    >
                      x→−∞
                    </button>
                  </div>
                  {limitMode === "point" && (
                    <input
                      type="number"
                      aria-label="极限点 x0"
                      step="0.1"
                      value={limitX0Input}
                      onChange={(e) => setLimitX0Input(e.target.value)}
                    />
                  )}
                </div>
              </section>

              <section className="calculus-card">
                <h2>可视化图层</h2>
                <div className="calculus-checks">
                  <label className="calculus-check">
                    <input type="checkbox" checked={showIntegralArea} onChange={(e) => setShowIntegralArea(e.target.checked)} />
                    <span>填充定积分有向面积 ∫f(x)dx</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showRoots1D} onChange={(e) => setShowRoots1D(e.target.checked)} />
                    <span>标注方程零点 f(x) = 0</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showDerivative} onChange={(e) => setShowDerivative(e.target.checked)} />
                    <span>显示导函数曲线 f&apos;(x)</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showHorizontalTangents} onChange={(e) => setShowHorizontalTangents(e.target.checked)} />
                    <span>极值处绘制水平切线</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showInflections} onChange={(e) => setShowInflections(e.target.checked)} />
                    <span>标注拐点（凹凸性转变）</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showAsymptotes} onChange={(e) => setShowAsymptotes(e.target.checked)} />
                    <span>显示垂直 / 水平 / 斜渐近线</span>
                  </label>
                </div>
              </section>

              <section className="calculus-card">
                <h2>大学高数 / 考研预设</h2>
                <div className="calculus-preset-list">
                  {EXTREMA_1D_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="calculus-preset-btn"
                      data-active={expr1D === preset.expression}
                      onClick={() => apply1DPreset(preset)}
                    >
                      <span className="calculus-preset-top">
                        <strong>{preset.title}</strong>
                        <small>{preset.courseTag}</small>
                      </span>
                      <code>y = {preset.expression}</code>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeModule === "parametricPolar" && (
            <ParametricPolarLeftControls
              subMode={paramPolarSubMode}
              onSubModeChange={(next) => {
                setParamPolarSubMode(next)
                setParamPlaying(false)
                setCustomParamBounds(null)
              }}
              paramXExpr={paramXExpr}
              onParamXExprChange={setParamXExpr}
              paramYExpr={paramYExpr}
              onParamYExprChange={setParamYExpr}
              paramTMin={paramTMin}
              onParamTMinChange={(v) => { setParamTMin(v); setCustomParamBounds(null) }}
              paramTMax={paramTMax}
              onParamTMaxChange={(v) => { setParamTMax(v); setCustomParamBounds(null) }}
              paramActiveT={paramActiveT}
              onParamActiveTChange={(v) => { setParamPlaying(false); setParamActiveT(v) }}
              paramTBounds={parsedParamTRange}
              paramPlaying={paramPlaying}
              onToggleParamPlay={() => setParamPlaying((v) => !v)}
              polarRExpr={polarRExpr}
              onPolarRExprChange={setPolarRExpr}
              polarThetaMin={polarThetaMin}
              onPolarThetaMinChange={(v) => { setPolarThetaMin(v); setCustomParamBounds(null) }}
              polarThetaMax={polarThetaMax}
              onPolarThetaMaxChange={(v) => { setPolarThetaMax(v); setCustomParamBounds(null) }}
              polarActiveTheta={polarActiveTheta}
              onPolarActiveThetaChange={(v) => { setParamPlaying(false); setPolarActiveTheta(v) }}
              polarThetaBounds={parsedPolarThetaRange}
              showTangentVector={showParamTangent}
              onShowTangentVectorChange={setShowParamTangent}
              showPolarSector={showPolarSector}
              onShowPolarSectorChange={setShowPolarSector}
              onApplyParamPreset={applyParamPreset}
              onApplyPolarPreset={applyPolarPreset}
            />
          )}

          {activeModule === "lagrange" && (
            <>
              <section className="calculus-card">
                <h2>目标函数与约束条件</h2>
                <MathFormulaInput
                  label="目标函数 f(x, y)"
                  prefix="f(x,y) ="
                  value={objectiveExpr}
                  onChange={(next) => {
                    setObjectiveExpr(next)
                    setFocusedStationaryIndex(null)
                  }}
                  placeholder="例如：x + 2y 或 xy"
                />
                <MathFormulaInput
                  label="约束曲线 g(x, y) = 0"
                  mode="implicit"
                  value={constraintExpr}
                  onChange={(next) => {
                    setConstraintExpr(next)
                    setFocusedStationaryIndex(null)
                  }}
                  placeholder="支持等式，如 x^2 + y^2 = 4"
                />
              </section>

              <section className="calculus-card">
                <h2>视图联动（2D ↔ 3D）</h2>
                <div className="calculus-view-toggle" role="group" aria-label="拉格朗日视口模式">
                  <button type="button" aria-pressed={lagrangeViewMode === "2d"} onClick={() => setLagrangeViewMode("2d")}>2D 等高线</button>
                  <button type="button" aria-pressed={lagrangeViewMode === "split"} onClick={() => setLagrangeViewMode("split")}>2D+3D 联动</button>
                  <button type="button" aria-pressed={lagrangeViewMode === "3d"} onClick={() => setLagrangeViewMode("3d")}>3D 曲面</button>
                </div>
              </section>

              <section className="calculus-card">
                <h2>等高线相切交互</h2>
                <label className="calculus-slider-field">
                  <span className="calculus-slider-head">
                    <span>等高线值 c（f(x,y) = c）</span>
                    <output>{fmtNum(activeLevel, 3)}</output>
                  </span>
                  <input
                    type="range"
                    min={levelRange[0]}
                    max={levelRange[1]}
                    step={(levelRange[1] - levelRange[0]) / 240}
                    value={Math.max(levelRange[0], Math.min(levelRange[1], activeLevel))}
                    onChange={(e) => {
                      setSyncLevelToPoint(false)
                      setManualLevel(Number(e.target.value))
                    }}
                  />
                </label>
                <div className="calculus-inline-actions">
                  <button
                    type="button"
                    className="calculus-chip-btn"
                    onClick={() => setSyncLevelToPoint(true)}
                  >
                    同步 c = f(P)
                  </button>
                  {lagrangeResult.ok && lagrangeResult.analysis.stationaryPoints.length > 0 && (
                    <button
                      type="button"
                      className="calculus-chip-btn primary"
                      onClick={() => handleSelectStationary(0)}
                    >
                      跳转全局最大相切
                    </button>
                  )}
                </div>

                <label className="calculus-slider-field">
                  <span className="calculus-slider-head">
                    <span>等高线密度</span>
                    <output>{contourCount} 条</output>
                  </span>
                  <input
                    type="range"
                    min={7}
                    max={23}
                    step={2}
                    value={contourCount}
                    onChange={(e) => setContourCount(Number(e.target.value))}
                  />
                </label>

                <div className="calculus-checks">
                  <label className="calculus-check">
                    <input type="checkbox" checked={showGradients} onChange={(e) => setShowGradients(e.target.checked)} />
                    <span>显示梯度向量 ∇f 与 ∇g</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
                    <span>显示函数高度色带底图</span>
                  </label>
                </div>
              </section>

              <section className="calculus-card">
                <h2>经典条件极值预设</h2>
                <div className="calculus-preset-list">
                  {LAGRANGE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="calculus-preset-btn"
                      data-active={objectiveExpr === preset.objective && constraintExpr === preset.constraint}
                      onClick={() => applyLagrangePreset(preset)}
                    >
                      <span className="calculus-preset-top">
                        <strong>{preset.title}</strong>
                        <small>{preset.courseTag}</small>
                      </span>
                      <code>f = {preset.objective} ｜ {preset.constraint}</code>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeModule === "ode1d" && (
            <>
              <section className="calculus-card">
                <h2>一阶微分方程 y&apos; = f(x, y)</h2>
                <MathFormulaInput
                  label="右端函数 f(x, y)"
                  prefix="y' ="
                  value={odeRhsExpr}
                  onChange={setOdeRhsExpr}
                  placeholder="例如：y(1 - y/3) 或 x - y"
                />
                <label className="calculus-slider-field">
                  <span className="calculus-slider-head">
                    <span>斜率场网格密度</span>
                    <output>{odeGridDensity} 列</output>
                  </span>
                  <input
                    type="range"
                    min={12}
                    max={30}
                    step={2}
                    value={odeGridDensity}
                    onChange={(e) => setOdeGridDensity(Number(e.target.value))}
                  />
                </label>
                <div className="calculus-inline-actions">
                  <button type="button" className="calculus-chip-btn" onClick={() => setOdeInitialPoints([])}>
                    清空特解曲线
                  </button>
                </div>
              </section>

              <section className="calculus-card">
                <h2>经典一阶 ODE 预设</h2>
                <div className="calculus-preset-list">
                  {ODE_1D_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="calculus-preset-btn"
                      data-active={odeRhsExpr === preset.rhs}
                      onClick={() => applyOde1DPreset(preset)}
                    >
                      <span className="calculus-preset-top">
                        <strong>{preset.title}</strong>
                        <small>{preset.courseTag}</small>
                      </span>
                      <code>y&apos; = {preset.rhs}</code>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeModule === "phase2d" && (
            <>
              <section className="calculus-card">
                <h2>二维自治系统</h2>
                <MathFormulaInput
                  label="dx/dt = P(x, y)"
                  prefix="x' ="
                  value={phasePExpr}
                  onChange={(next) => {
                    setPhasePExpr(next)
                    setFocusedEquilibriumIndex(null)
                  }}
                  placeholder="例如：y"
                />
                <MathFormulaInput
                  label="dy/dt = Q(x, y)"
                  prefix="y' ="
                  value={phaseQExpr}
                  onChange={(next) => {
                    setPhaseQExpr(next)
                    setFocusedEquilibriumIndex(null)
                  }}
                  placeholder="例如：-sin(x) - 0.35y"
                />
                <div className="calculus-checks">
                  <label className="calculus-check">
                    <input type="checkbox" checked={showNullclines} onChange={(e) => setShowNullclines(e.target.checked)} />
                    <span>显示零倾线（P=0 红 / Q=0 青）</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showEquilibria} onChange={(e) => setShowEquilibria(e.target.checked)} />
                    <span>标注平衡点稳定性符号</span>
                  </label>
                </div>
                <div className="calculus-inline-actions">
                  <button type="button" className="calculus-chip-btn" onClick={() => setPhaseInitialPoints([])}>
                    清空轨线
                  </button>
                </div>
              </section>

              <section className="calculus-card">
                <h2>经典非线性动力学预设</h2>
                <div className="calculus-preset-list">
                  {PHASE_PLANE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="calculus-preset-btn"
                      data-active={phasePExpr === preset.pExpr && phaseQExpr === preset.qExpr}
                      onClick={() => applyPhasePreset(preset)}
                    >
                      <span className="calculus-preset-top">
                        <strong>{preset.title}</strong>
                        <small>{preset.courseTag}</small>
                      </span>
                      <code>x&apos;={preset.pExpr} ｜ y&apos;={preset.qExpr}</code>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeModule === "surface3d" && (
            <>
              <section className="calculus-card">
                <h2>二元显式曲面 z = f(x, y)</h2>
                <MathFormulaInput
                  label="函数表达式 f(x, y)"
                  prefix="z ="
                  value={surfaceExpr}
                  onChange={(next) => {
                    setSurfaceExpr(next)
                    setFocusedSurfaceIndex(0)
                  }}
                  placeholder="例如：x^3 - 3x + y^2 或 sin(x)cos(y)"
                />

                <label className="calculus-slider-field">
                  <span className="calculus-slider-head">
                    <span>曲面不透明度</span>
                    <output>{Math.round(surfaceOpacity * 100)}%</output>
                  </span>
                  <input
                    type="range"
                    min={0.35}
                    max={1}
                    step={0.05}
                    value={surfaceOpacity}
                    onChange={(e) => setSurfaceOpacity(Number(e.target.value))}
                  />
                </label>

                <div className="calculus-checks">
                  <label className="calculus-check">
                    <input type="checkbox" checked={surfaceWireframe} onChange={(e) => setSurfaceWireframe(e.target.checked)} />
                    <span>叠加参数网格线</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showTangentPlane} onChange={(e) => setShowTangentPlane(e.target.checked)} />
                    <span>绘制局部切平面</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={useCustomSurfaceProbe} onChange={(e) => setUseCustomSurfaceProbe(e.target.checked)} />
                    <span>自由指定探针点 (x₀, y₀) 求方向导数与切平面</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showSurfaceSlice} onChange={(e) => setShowSurfaceSlice(e.target.checked)} />
                    <span>显示水平截平面 z = c</span>
                  </label>
                </div>

                {useCustomSurfaceProbe && (
                  <>
                    <div className="calculus-domain-row">
                      <label className="calculus-field">
                        <span>探针 x₀</span>
                        <input
                          type="number"
                          step="0.2"
                          value={surfaceProbeX}
                          onChange={(e) => setSurfaceProbeX(Number(e.target.value))}
                        />
                      </label>
                      <label className="calculus-field">
                        <span>探针 y₀</span>
                        <input
                          type="number"
                          step="0.2"
                          value={surfaceProbeY}
                          onChange={(e) => setSurfaceProbeY(Number(e.target.value))}
                        />
                      </label>
                    </div>
                  </>
                )}

                <label className="calculus-slider-field">
                  <span className="calculus-slider-head">
                    <span>方向导数方向角 θ</span>
                    <output>{surfaceDirDeg}°</output>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={5}
                    value={surfaceDirDeg}
                    onChange={(e) => setSurfaceDirDeg(Number(e.target.value))}
                  />
                </label>

                {showSurfaceSlice && surfaceResult.ok && (
                  <label className="calculus-slider-field">
                    <span className="calculus-slider-head">
                      <span>截平面高度 z = c</span>
                      <output>{fmtNum(surfaceSliceZ, 2)}</output>
                    </span>
                    <input
                      type="range"
                      min={surfaceResult.analysis.zMin}
                      max={surfaceResult.analysis.zMax}
                      step={(surfaceResult.analysis.zMax - surfaceResult.analysis.zMin) / 120}
                      value={Math.max(surfaceResult.analysis.zMin, Math.min(surfaceResult.analysis.zMax, surfaceSliceZ))}
                      onChange={(e) => setSurfaceSliceZ(Number(e.target.value))}
                    />
                  </label>
                )}
              </section>

              <section className="calculus-card">
                <h2>二元曲面与鞍点预设</h2>
                <div className="calculus-preset-list">
                  {SURFACE_3D_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="calculus-preset-btn"
                      data-active={surfaceExpr === preset.expression}
                      onClick={() => applySurfacePreset(preset)}
                    >
                      <span className="calculus-preset-top">
                        <strong>{preset.title}</strong>
                        <small>{preset.courseTag}</small>
                      </span>
                      <code>z = {preset.expression}</code>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {(activeModule === "pde" || activeModule === "series" || activeModule === "doubleIntegral") && (
            <Phase3LeftControls
              activeModule={activeModule}
              pdeKind={pdeKind}
              onPdeKindChange={setPdeKind}
              pdeInitExpr={pdeInitExpr}
              onPdeInitExprChange={setPdeInitExpr}
              pdeBoundaryExpr={pdeBoundaryExpr}
              onPdeBoundaryExprChange={setPdeBoundaryExpr}
              pdeBoundary={pdeBoundary}
              onPdeBoundaryChange={setPdeBoundary}
              pdeParam={pdeParam}
              onPdeParamChange={setPdeParam}
              pdeView3D={pdeView3D}
              onPdeView3DChange={setPdeView3D}
              pdePlaying={pdeSim.playing}
              onPdeTogglePlay={() => pdeSim.setPlaying((v) => !v)}
              onPdeStepOnce={() => pdeSim.stepOnce(0.035)}
              onPdeReset={pdeSim.resetSimulation}
              pdeError={pdeSim.error}
              onApplyPdePreset={applyPdePreset}
              seriesSubMode={seriesSubMode}
              onSeriesSubModeChange={setSeriesSubMode}
              taylorExpr={taylorExpr}
              onTaylorExprChange={setTaylorExpr}
              taylorCenter={taylorCenter}
              onTaylorCenterChange={setTaylorCenter}
              taylorOrder={taylorOrder}
              onTaylorOrderChange={setTaylorOrder}
              showTaylorError={showTaylorError}
              onShowTaylorErrorChange={setShowTaylorError}
              taylorError={taylorResult.ok ? null : taylorResult.error}
              onApplyTaylorPreset={applyTaylorPreset}
              fourierWaveform={fourierWaveform}
              onFourierWaveformChange={setFourierWaveform}
              fourierCustomExpr={fourierCustomExpr}
              onFourierCustomExprChange={setFourierCustomExpr}
              fourierHarmonics={fourierHarmonics}
              onFourierHarmonicsChange={setFourierHarmonics}
              showEpicycles={showEpicycles}
              onShowEpicyclesChange={setShowEpicycles}
              epicyclePhase={epicyclePhase}
              onEpicyclePhaseChange={setEpicyclePhase}
              epicyclePlaying={epicyclePlaying}
              onToggleEpicyclePlay={() => setEpicyclePlaying((v) => !v)}
              fourierError={fourierResult.ok ? null : fourierResult.error}
              onApplyFourierPreset={applyFourierPreset}
              diIntegrand={diIntegrand}
              onDiIntegrandChange={setDiIntegrand}
              diOrder={diOrder}
              onDiOrderChange={(o) => { setDiOrder(o); setCustomDiBounds(null) }}
              diOuterMin={diOuterMin}
              onDiOuterMinChange={(v) => { setDiOuterMin(v); setCustomDiBounds(null) }}
              diOuterMax={diOuterMax}
              onDiOuterMaxChange={(v) => { setDiOuterMax(v); setCustomDiBounds(null) }}
              diInnerMin={diInnerMin}
              onDiInnerMinChange={(v) => { setDiInnerMin(v); setCustomDiBounds(null) }}
              diInnerMax={diInnerMax}
              onDiInnerMaxChange={(v) => { setDiInnerMax(v); setCustomDiBounds(null) }}
              diPartitions={diPartitions}
              onDiPartitionsChange={setDiPartitions}
              diScanRatio={diScanRatio}
              onDiScanRatioChange={setDiScanRatio}
              showRiemannGrid={showRiemannGrid}
              onShowRiemannGridChange={setShowRiemannGrid}
              activeSwapTwin={activeDiPreset?.swappedTwin ?? null}
              onSwapOrderTwin={handleSwapOrderTwin}
              diError={diResult.ok ? null : diResult.error}
              onApplyDiPreset={applyDiPreset}
            />
          )}

          {(activeModule === "linalg" || activeModule === "probability") && (
            <Phase4LeftControls
              activeModule={activeModule}
              matrix={matrix2x2}
              onMatrixEntryChange={(r, c, val) => {
                setMatrix2x2((prev) => {
                  const next: Matrix2x2 = [[prev[0][0], prev[0][1]], [prev[1][0], prev[1][1]]]
                  next[r][c] = val
                  return next
                })
              }}
              linalgProgress={linalgProgress}
              onLinalgProgressChange={(t) => {
                setLinalgPlaying(false)
                setLinalgProgress(t)
              }}
              linalgPlaying={linalgPlaying}
              onToggleLinalgPlay={() => {
                if (!linalgPlaying && linalgProgress >= 0.99) setLinalgProgress(0)
                setLinalgPlaying((v) => !v)
              }}
              showEigenvectors={showEigenvectors}
              onShowEigenvectorsChange={setShowEigenvectors}
              showSvdCircle={showSvdCircle}
              onShowSvdCircleChange={setShowSvdCircle}
              onApplyLinalgPreset={applyLinalgPreset}
              probSubMode={probSubMode}
              onProbSubModeChange={(m) => { setProbSubMode(m); setCustomProbBounds(null) }}
              distKind={distKind}
              onDistKindChange={(k) => {
                setDistKind(k)
                if (k === "student_t") { setDistParam1(5); setProbIntervalA(-2); setProbIntervalB(2) }
                else if (k === "chi_square") { setDistParam1(6); setProbIntervalA(0); setProbIntervalB(12.59) }
                else if (k === "exponential") { setDistParam1(1); setProbIntervalA(0); setProbIntervalB(2) }
                else if (k === "binomial") { setDistParam1(20); setDistParam2(0.4); setProbIntervalA(6); setProbIntervalB(10) }
                else if (k === "poisson") { setDistParam1(5); setProbIntervalA(3); setProbIntervalB(7) }
                else { setDistParam1(0); setDistParam2(1); setProbIntervalA(-1.96); setProbIntervalB(1.96) }
                setCustomProbBounds(null)
              }}
              distParam1={distParam1}
              onDistParam1Change={(v) => { setDistParam1(v); setCustomProbBounds(null) }}
              distParam2={distParam2}
              onDistParam2Change={(v) => { setDistParam2(v); setCustomProbBounds(null) }}
              intervalA={probIntervalA}
              onIntervalAChange={setProbIntervalA}
              intervalB={probIntervalB}
              onIntervalBChange={setProbIntervalB}
              showCdf={showCdf}
              onShowCdfChange={setShowCdf}
              onApplyProbPreset={applyProbPreset}
              cltParent={cltParent}
              onCltParentChange={(p) => { setCltParent(p); setCustomProbBounds(null) }}
              cltSampleSize={cltSampleSize}
              onCltSampleSizeChange={(n) => { setCltSampleSize(n); setCustomProbBounds(null) }}
              onResampleClt={() => setCltSeed((s) => s + 137)}
            />
          )}
        </aside>

        {/* Center: Interactive 2D / 3D / Split Stage */}
        <main ref={stageRef} className="calculus-stage" aria-label="高等数学交互画布区">
          {activeModule === "parametricPolar" ? (
            <CalculusParametricPolarCanvas
              subMode={paramPolarSubMode}
              bounds={paramPolarBounds}
              onBoundsChange={setCustomParamBounds}
              onResetView={() => setCustomParamBounds(null)}
              parametric={displayParametric}
              polar={displayPolar}
              showTangentVector={showParamTangent}
              showPolarSector={showPolarSector}
            />
          ) : activeModule === "linalg" || activeModule === "probability" ? (
            <CalculusPhase4Canvas
              mode={activeModule}
              bounds={activeModule === "linalg" ? linalgBounds : probBounds}
              onBoundsChange={(next) => {
                if (activeModule === "linalg") setLinalgBounds(next)
                else setCustomProbBounds(next)
              }}
              onResetView={() => {
                if (activeModule === "linalg") setLinalgBounds({ xMin: -3.5, xMax: 3.5, yMin: -3.2, yMax: 3.2 })
                else setCustomProbBounds(null)
              }}
              linalg={linalgAnalysis}
              showEigenvectors={showEigenvectors}
              showSvdCircle={showSvdCircle}
              probSubMode={probSubMode}
              distribution={distAnalysis}
              showCdf={showCdf}
              clt={cltAnalysis}
            />
          ) : activeModule === "pde" && pdeView3D ? (
            <CalculusSurface3D
              surface={pdeSurface3D}
              wireframe
              surfaceOpacity={0.92}
            />
          ) : activeModule === "pde" || activeModule === "series" || activeModule === "doubleIntegral" ? (
            <CalculusPhase3Canvas
              mode={activeModule}
              bounds={
                activeModule === "pde"
                  ? pdeBounds
                  : activeModule === "series"
                    ? boundsSeries
                    : diBounds
              }
              onBoundsChange={(next) => {
                if (activeModule === "pde") setPdeBounds(next)
                else if (activeModule === "series") setBoundsSeries(next)
                else setCustomDiBounds(next)
              }}
              onResetView={() => {
                if (activeModule === "pde") {
                  const matched = PDE_PRESETS.find((p) => p.kind === pdeKind && p.initialExpr === pdeInitExpr)
                  setPdeBounds(matched?.bounds ?? { xMin: -2.2, xMax: 2.2, yMin: -2.2, yMax: 2.2 })
                } else if (activeModule === "series") {
                  setBoundsSeries({ xMin: -6.5, xMax: 6.5, yMin: -2.4, yMax: 2.4 })
                } else {
                  setCustomDiBounds(null)
                }
              }}
              pdeState={pdeSim.state}
              poissonSolution={pdeSim.poissonSolution}
              onInjectPdePulse={(wx, wy) => pdeSim.injectPulse(wx, wy)}
              seriesSubMode={seriesSubMode}
              taylor={taylorResult.ok ? taylorResult.analysis : null}
              showTaylorError={showTaylorError}
              fourier={fourierResult.ok ? fourierResult.analysis : null}
              showEpicycles={showEpicycles}
              epicyclePhase={epicyclePhase}
              doubleIntegral={diResult.ok ? diResult.analysis : null}
              showRiemannGrid={showRiemannGrid}
            />
          ) : activeModule === "surface3d" ? (
            <CalculusSurface3D
              surface={surfaceResult.ok ? surfaceResult.analysis : null}
              wireframe={surfaceWireframe}
              surfaceOpacity={surfaceOpacity}
              sliceZ={showSurfaceSlice ? surfaceSliceZ : null}
              focusedStationaryIndex={focusedSurfaceIndex}
              tangentPlane={activeTangentPlane}
            />
          ) : activeModule === "lagrange" && lagrangeViewMode === "3d" ? (
            <CalculusSurface3D
              surface={lagrange3DData?.surface ?? null}
              wireframe
              surfaceOpacity={0.82}
              sliceZ={activeLevel}
              sliceTangent={Boolean(activeProbe?.isTangent)}
              liftedCurves={lagrange3DData?.liftedCurves}
              lagrangePoints={lagrange3DData?.lagrangePoints}
              highlightPoint={
                activeProbe && Number.isFinite(activeProbe.fValue)
                  ? { x: activeProbe.x, y: activeProbe.y, z: activeProbe.fValue }
                  : null
              }
            />
          ) : activeModule === "lagrange" && lagrangeViewMode === "split" ? (
            <div className="calculus-split-stage">
              <CalculusCanvas2D
                mode="lagrange"
                bounds={boundsLagrange}
                onBoundsChange={setBoundsLagrange}
                onResetView={() => {
                  const matched = LAGRANGE_PRESETS.find(
                    (p) => p.objective === objectiveExpr && p.constraint === constraintExpr
                  )
                  setBoundsLagrange(matched?.bounds ?? { xMin: -4, xMax: 4, yMin: -4, yMax: 4 })
                }}
                lagrange={lagrangeResult.ok ? lagrangeResult.analysis : null}
                activeLevel={activeLevel}
                activePoint={resolvedLagrangePoint}
                activeProbe={activeProbe}
                showGradients={showGradients}
                showHeatmap={showHeatmap}
                focusedStationaryIndex={focusedStationaryIndex}
                onDragLagrangePoint={handleDragLagrangePoint}
                onSelectStationary={handleSelectStationary}
              />
              <CalculusSurface3D
                surface={lagrange3DData?.surface ?? null}
                wireframe
                surfaceOpacity={0.82}
                sliceZ={activeLevel}
                sliceTangent={Boolean(activeProbe?.isTangent)}
                liftedCurves={lagrange3DData?.liftedCurves}
                lagrangePoints={lagrange3DData?.lagrangePoints}
                highlightPoint={
                  activeProbe && Number.isFinite(activeProbe.fValue)
                    ? { x: activeProbe.x, y: activeProbe.y, z: activeProbe.fValue }
                    : null
                }
              />
            </div>
          ) : (
            <CalculusCanvas2D
              mode={activeModule}
              bounds={
                activeModule === "extrema1d"
                  ? bounds1D
                  : activeModule === "lagrange"
                    ? boundsLagrange
                    : activeModule === "ode1d"
                      ? boundsOde1D
                      : boundsPhase
              }
              onBoundsChange={(next) => {
                if (activeModule === "extrema1d") setCustomBounds1D(next)
                else if (activeModule === "lagrange") setBoundsLagrange(next)
                else if (activeModule === "ode1d") setBoundsOde1D(next)
                else setBoundsPhase(next)
              }}
              onResetView={() => {
                if (activeModule === "extrema1d") {
                  setCustomBounds1D(null)
                } else if (activeModule === "lagrange") {
                  const matched = LAGRANGE_PRESETS.find(
                    (p) => p.objective === objectiveExpr && p.constraint === constraintExpr
                  )
                  setBoundsLagrange(matched?.bounds ?? { xMin: -4, xMax: 4, yMin: -4, yMax: 4 })
                } else if (activeModule === "ode1d") {
                  const matched = ODE_1D_PRESETS.find((p) => p.rhs === odeRhsExpr)
                  setBoundsOde1D(matched?.bounds ?? { xMin: -4, xMax: 4, yMin: -4, yMax: 4 })
                } else {
                  const matched = PHASE_PLANE_PRESETS.find(
                    (p) => p.pExpr === phasePExpr && p.qExpr === phaseQExpr
                  )
                  setBoundsPhase(matched?.bounds ?? { xMin: -4, xMax: 4, yMin: -4, yMax: 4 })
                }
              }}
              extrema1d={extrema1dResult.ok ? extrema1dResult.analysis : null}
              showDerivative={showDerivative}
              showInflections={showInflections}
              showAsymptotes={showAsymptotes}
              showHorizontalTangents={showHorizontalTangents}
              showIntegralArea={showIntegralArea}
              showRoots={showRoots1D}
              roots1d={roots1d}
              tangentProbe={showTangentProbe ? tangent1dAnalysis : null}
              dualCurve={dualCurve1dResult?.ok ? dualCurve1dResult.analysis : null}
              focusedExtremaIndex={focusedExtremaIndex}
              onHover1D={setHoverWorld}
              lagrange={lagrangeResult.ok ? lagrangeResult.analysis : null}
              activeLevel={activeLevel}
              activePoint={resolvedLagrangePoint}
              activeProbe={activeProbe}
              showGradients={showGradients}
              showHeatmap={showHeatmap}
              focusedStationaryIndex={focusedStationaryIndex}
              onDragLagrangePoint={handleDragLagrangePoint}
              onSelectStationary={handleSelectStationary}
              odeSlopeField={ode1DResult.ok ? ode1DResult.slopeField : null}
              odeTrajectories={ode1DResult.ok ? ode1DResult.trajectories : undefined}
              onAddTrajectoryPoint={handleAddTrajectoryPoint}
              onMoveTrajectoryPoint={handleMoveTrajectoryPoint}
              phasePlane={phaseResult.ok ? phaseResult.phasePlane : null}
              phaseTrajectories={phaseResult.ok ? phaseResult.trajectories : undefined}
              showNullclines={showNullclines}
              showEquilibria={showEquilibria}
              focusedEquilibriumIndex={focusedEquilibriumIndex}
              onSelectEquilibrium={setFocusedEquilibriumIndex}
            />
          )}
        </main>

        {/* Right: Properties, Numerical Diagnostics & Teaching Insights */}
        <aside
          id="calculus-diagnostics-dock"
          className="calculus-sidebar calculus-diagnostics"
          aria-label="右侧属性与数值诊断面板"
        >
          <div className="calculus-dock-header">
            <span className="calculus-dock-title">属性与数值诊断</span>
            <span className="calculus-dock-badge">{activeModuleMeta.shortLabel}</span>
            <div className="calculus-dock-actions">
              <button
                type="button"
                className="calculus-dock-action-btn"
                onClick={handleCopyDiagnostics}
                title="复制当前模块关键数值与结论"
              >
                复制结论
              </button>
              <button
                type="button"
                className="calculus-dock-icon-btn"
                title="收起右侧属性栏"
                aria-label="收起右侧属性栏"
                onClick={toggleRightDock}
              >
                ✕
              </button>
            </div>
          </div>

          {activeDiagnosticsError && (
            <section className="calculus-card calculus-stale-banner" role="alert" aria-label="表达式语法提示">
              <h2>表达式暂未完整 · 已保留上次有效诊断</h2>
              <p>{activeDiagnosticsError}</p>
              <small>支持 <code>^</code>、<code>*</code>、<code>sqrt()</code>、<code>sin()</code>、<code>exp()</code>、<code>ln()</code>、<code>abs()</code>，也可直接点击左侧「快捷符号」。</small>
            </section>
          )}

          <div className="calculus-diagnostics-content" data-stale={activeDiagnosticsError ? "true" : "false"}>
          {activeModule === "extrema1d" && displayExtrema1d && (
            <>
              <section className="calculus-card">
                <h2>闭区间 [{fmtNum(displayExtrema1d.domain[0], 2)}, {fmtNum(displayExtrema1d.domain[1], 2)}] 全局最值</h2>
                <div className="calculus-metric-pair">
                  <div className="calculus-metric max">
                    <span className="metric-label">全局最大值</span>
                    {displayExtrema1d.unboundedAbove ? (
                      <strong>+∞（无上界）</strong>
                    ) : displayExtrema1d.globalMax ? (
                      <>
                        <strong>{fmtNum(displayExtrema1d.globalMax.y, 4)}</strong>
                        <small>x = {fmtNum(displayExtrema1d.globalMax.x, 4)}（{displayExtrema1d.globalMax.label}）</small>
                      </>
                    ) : (
                      <strong>无</strong>
                    )}
                  </div>
                  <div className="calculus-metric min">
                    <span className="metric-label">全局最小值</span>
                    {displayExtrema1d.unboundedBelow ? (
                      <strong>−∞（无下界）</strong>
                    ) : displayExtrema1d.globalMin ? (
                      <>
                        <strong>{fmtNum(displayExtrema1d.globalMin.y, 4)}</strong>
                        <small>x = {fmtNum(displayExtrema1d.globalMin.x, 4)}（{displayExtrema1d.globalMin.label}）</small>
                      </>
                    ) : (
                      <strong>无</strong>
                    )}
                  </div>
                </div>
              </section>

              <section className="calculus-card">
                <h2>极值点与端点明细（点击高亮）</h2>
                <div tabIndex={0} role="region" aria-label="极值点与端点表格" className="calculus-table-wrapper">
                  <table className="calculus-table">
                    <thead>
                      <tr>
                        <th>类别</th>
                        <th>x</th>
                        <th>f(x)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayExtrema1d.extrema.map((pt, idx) => (
                        <tr
                          key={`${pt.kind}-${pt.x.toFixed(5)}-${idx}`}
                          data-selected={focusedExtremaIndex === idx}
                          onClick={() => setFocusedExtremaIndex(focusedExtremaIndex === idx ? null : idx)}
                        >
                          <th>
                            <span className={`calculus-badge ${pt.isGlobalMax ? "max" : pt.isGlobalMin ? "min" : pt.kind.includes("cusp") ? "warn" : ""}`}>
                              {pt.isGlobalMax ? "全局最大" : pt.isGlobalMin ? "全局最小" : pt.label}
                            </span>
                          </th>
                          <td>{fmtNum(pt.x, 4)}</td>
                          <td>{fmtNum(pt.y, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="calculus-card">
                <h2>拐点与渐近线</h2>
                {displayExtrema1d.inflections.length > 0 ? (
                  <ul className="calculus-kv-list">
                    {displayExtrema1d.inflections.map((inf, idx) => (
                      <li key={`inf-${idx}`}>
                        <span>拐点 ({fmtNum(inf.x, 3)}, {fmtNum(inf.y, 3)})</span>
                        <small>{inf.concavityChange === "up_to_down" ? "下凸 → 上凸" : "上凸 → 下凸"}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="calculus-muted-note">当前闭区间内未检测到拐点。</p>
                )}

                {displayExtrema1d.asymptotes.length > 0 && (
                  <ul className="calculus-kv-list calculus-asymptote-list">
                    {displayExtrema1d.asymptotes.map((asy, idx) => (
                      <li key={`asy-${idx}`}>
                        <span>{asy.kind === "vertical" ? "垂直渐近线" : asy.kind === "horizontal" ? "水平渐近线" : "斜渐近线"}</span>
                        <code>{asy.label}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {integral1dAnalysis && (
                <section className="calculus-card">
                  <h2>定积分 · 弧长 · 旋转体体积</h2>
                  <dl className="calculus-dl">
                    <div><dt>定积分 ∫f(x)dx</dt><dd>{fmtNum(integral1dAnalysis.signedArea, 5)}</dd></div>
                    <div><dt>绝对面积 ∫|f|dx</dt><dd>{fmtNum(integral1dAnalysis.absoluteArea, 5)}</dd></div>
                    <div><dt>曲线弧长 L</dt><dd>{fmtNum(integral1dAnalysis.arcLength, 5)}</dd></div>
                    <div><dt>绕 x 轴体积 Vₓ</dt><dd>{fmtNum(integral1dAnalysis.revolutionVolumeX, 4)}</dd></div>
                    <div><dt>区间平均值 f̄</dt><dd>{fmtNum(integral1dAnalysis.averageValue, 4)}</dd></div>
                  </dl>
                </section>
              )}

              {tangent1dAnalysis && (
                <section className="calculus-card">
                  <h2>符号导数 · 切线 / 法线（x₀ = {fmtNum(tangent1dAnalysis.x0, 3)}）</h2>
                  {tangent1dAnalysis.symbolicDerivativePretty && (
                    <p className="calculus-formula-callout">f&apos;(x) = {tangent1dAnalysis.symbolicDerivativePretty}</p>
                  )}
                  <dl className="calculus-dl">
                    <div><dt>f(x₀)</dt><dd>{fmtNum(tangent1dAnalysis.y0, 4)}</dd></div>
                    <div><dt>一阶导 f&apos;(x₀)</dt><dd>{fmtNum(tangent1dAnalysis.slope, 4)}</dd></div>
                    <div><dt>二阶导 f&apos;&apos;(x₀)</dt><dd>{fmtNum(tangent1dAnalysis.secondDerivative, 4)}</dd></div>
                    <div><dt>曲率 κ(x₀)</dt><dd>{fmtNum(tangent1dAnalysis.curvature, 4)}</dd></div>
                  </dl>
                  <p className="calculus-formula-callout">切线：{tangent1dAnalysis.tangentEquation}</p>
                  <p className="calculus-formula-callout">法线：{tangent1dAnalysis.normalEquation}</p>
                </section>
              )}

              {limit1dAnalysis && (
                <section className="calculus-card">
                  <h2>极限与连续性诊断</h2>
                  <div className="calculus-probe-box" data-tangent={limit1dAnalysis.continuity === "continuous"}>
                    <div className="calculus-probe-status">{limit1dAnalysis.summary}</div>
                    {limit1dAnalysis.target.kind === "point" && (
                      <dl className="calculus-dl">
                        <div><dt>左极限 x₀⁻</dt><dd>{limit1dAnalysis.leftLimit ? formatLimitValue(limit1dAnalysis.leftLimit) : "—"}</dd></div>
                        <div><dt>右极限 x₀⁺</dt><dd>{limit1dAnalysis.rightLimit ? formatLimitValue(limit1dAnalysis.rightLimit) : "—"}</dd></div>
                        <div><dt>双侧极限</dt><dd>{formatLimitValue(limit1dAnalysis.overallLimit)}</dd></div>
                        <div><dt>函数值 f(x₀)</dt><dd>{limit1dAnalysis.valueAtPoint !== null && limit1dAnalysis.valueAtPoint !== undefined ? fmtNum(limit1dAnalysis.valueAtPoint, 4) : "无定义"}</dd></div>
                      </dl>
                    )}
                  </div>
                </section>
              )}

              {dualCurve1dResult?.ok && (
                <section className="calculus-card">
                  <h2>双曲线对比：交点与围成面积</h2>
                  <dl className="calculus-dl">
                    <div><dt>围成面积 ∫|f−g|dx</dt><dd>{fmtNum(dualCurve1dResult.analysis.areaBetween, 5)}</dd></div>
                    <div><dt>有向差积分 ∫(f−g)dx</dt><dd>{fmtNum(dualCurve1dResult.analysis.signedDiffIntegral, 5)}</dd></div>
                  </dl>
                  {dualCurve1dResult.analysis.intersections.length > 0 ? (
                    <ul className="calculus-kv-list">
                      {dualCurve1dResult.analysis.intersections.map((pt, idx) => (
                        <li key={`inter-${idx}`}>
                          <span>交点 P{idx + 1}</span>
                          <code>({fmtNum(pt.x, 4)}, {fmtNum(pt.y, 4)})</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="calculus-muted-note">当前闭区间内两条曲线无交点。</p>
                  )}
                </section>
              )}

              {roots1d.length > 0 && (
                <section className="calculus-card">
                  <h2>方程实根 / 零点（f(x) = 0，共 {roots1d.length} 个）</h2>
                  <ul className="calculus-kv-list">
                    {roots1d.map((rt, idx) => (
                      <li key={`root-${idx}`}>
                        <span>零点 x{idx + 1}</span>
                        <code>x = {fmtNum(rt.x, 5)}</code>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {activeModule === "parametricPolar" && (
            <ParametricPolarRightDiagnostics
              subMode={paramPolarSubMode}
              parametric={displayParametric}
              polar={displayPolar}
            />
          )}

          {activeModule === "lagrange" && displayLagrange && (
            <>
              <section className="calculus-card">
                <h2>动点 P 梯度共线实时诊断</h2>
                {activeProbe ? (
                  <div className="calculus-probe-box" data-tangent={activeProbe.isTangent}>
                    <div className="calculus-probe-status">
                      {activeProbe.isTangent
                        ? "✓ 梯度共线 · 等高线与约束相切！"
                        : "拖动动点 P，使 ∇f 与 ∇g 方向共线"}
                    </div>
                    <dl className="calculus-dl">
                      <div><dt>动点 P</dt><dd>({fmtNum(activeProbe.x, 3)}, {fmtNum(activeProbe.y, 3)})</dd></div>
                      <div><dt>目标值 f(P)</dt><dd>{fmtNum(activeProbe.fValue, 4)}</dd></div>
                      <div><dt>∇f(P)</dt><dd>({fmtNum(activeProbe.gradF[0], 3)}, {fmtNum(activeProbe.gradF[1], 3)})</dd></div>
                      <div><dt>∇g(P)</dt><dd>({fmtNum(activeProbe.gradG[0], 3)}, {fmtNum(activeProbe.gradG[1], 3)})</dd></div>
                      <div><dt>梯度夹角 θ</dt><dd>{fmtNum(activeProbe.angleDeg, 2)}°</dd></div>
                      <div><dt>估计乘数 λ</dt><dd>{fmtNum(activeProbe.estimatedLambda, 4)}</dd></div>
                    </dl>
                    <div className="calculus-collinearity-meter" aria-label="梯度共线度">
                      <span>共线逼近度：{Math.round((1 - activeProbe.collinearitySin) * 100)}%</span>
                      <progress max={1} value={Math.max(0, Math.min(1, 1 - activeProbe.collinearitySin))} />
                    </div>
                  </div>
                ) : (
                  <p className="calculus-muted-note">当前视野内未找到约束曲线 g(x, y) = 0。</p>
                )}
              </section>

              <section className="calculus-card">
                <h2>KKT 条件驻点精确解（点击定位）</h2>
                {displayLagrange.stationaryPoints.length > 0 ? (
                  <div tabIndex={0} role="region" aria-label="拉格朗日驻点列表" className="calculus-table-wrapper">
                    <table className="calculus-table">
                      <thead>
                        <tr>
                          <th>类别</th>
                          <th>(x*, y*)</th>
                          <th>f*</th>
                          <th>λ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayLagrange.stationaryPoints.map((sp, idx) => (
                          <tr
                            key={`sp-${idx}`}
                            data-selected={focusedStationaryIndex === idx}
                            onClick={() => handleSelectStationary(idx)}
                          >
                            <th>
                              <span className={`calculus-badge ${sp.isGlobalMax ? "max" : sp.isGlobalMin ? "min" : ""}`}>
                                {sp.isGlobalMax ? "最大" : sp.isGlobalMin ? "最小" : sp.kind === "constrained_max" ? "极大" : sp.kind === "constrained_min" ? "极小" : "驻点"}
                              </span>
                            </th>
                            <td>({fmtNum(sp.x, 2)}, {fmtNum(sp.y, 2)})</td>
                            <td>{fmtNum(sp.value, 3)}</td>
                            <td>{fmtNum(sp.lambda, 3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="calculus-muted-note">当前视野内未检测到条件驻点，可尝试缩小视野或检查约束方程。</p>
                )}
              </section>

              <section className="calculus-card calculus-tip-card">
                <h2>几何直觉（拉格朗日乘数法）</h2>
                <p>
                  沿约束曲线 <code>g(x,y) = 0</code> 移动时，只要目标函数等高线 <code>f(x,y) = c</code> 与约束曲线<strong>横截相交</strong>，函数值仍可继续增减；唯有二者<strong>相切</strong>时达到临界态（在 3D 联动视图中表现为水平面 <code>z = c</code> 刚好切过空间约束曲线的最高/最低点）：
                </p>
                <p className="calculus-formula-callout">∇f(x*, y*) = λ · ∇g(x*, y*)</p>
              </section>
            </>
          )}

          {activeModule === "ode1d" && (
            <>
              <section className="calculus-card">
                <h2>当前特解初值列表（{odeInitialPoints.length}）</h2>
                {odeInitialPoints.length > 0 ? (
                  <ul className="calculus-kv-list">
                    {odeInitialPoints.map((pt, idx) => (
                      <li key={`ode-init-${idx}`}>
                        <span>y({fmtNum(pt.x, 2)}) = {fmtNum(pt.y, 2)}</span>
                        <button
                          type="button"
                          className="calculus-mini-del"
                          onClick={() => setOdeInitialPoints((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="calculus-muted-note">点击左侧斜率场任意位置即可生成 RK45 双向特解曲线。</p>
                )}
              </section>

              <section className="calculus-card calculus-tip-card">
                <h2>数值求解说明（RK45 自适应步长）</h2>
                <p>
                  采用 <strong>Dormand–Prince 5(4) 阶龙格-库塔法</strong> 从初值 <code>(x₀, y₀)</code> 同时向正负方向积分，自动缩短步长应对陡峭区域与渐近奇点。拖动彩色初值圆点可直观观察解曲线族对初值的依赖性。
                </p>
              </section>
            </>
          )}

          {activeModule === "phase2d" && displayPhasePlane && (
            <>
              <section className="calculus-card">
                <h2>平衡点与雅可比稳定性分类</h2>
                {displayPhasePlane.equilibria.length > 0 ? (
                  <div tabIndex={0} role="region" aria-label="相平面平衡点稳定性表" className="calculus-table-wrapper">
                    <table className="calculus-table">
                      <thead>
                        <tr>
                          <th>分类</th>
                          <th>(x*, y*)</th>
                          <th>特征值 λ₁, λ₂</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayPhasePlane.equilibria.map((eq, idx) => (
                          <tr
                            key={`eq-${idx}`}
                            data-selected={focusedEquilibriumIndex === idx}
                            onClick={() => setFocusedEquilibriumIndex(focusedEquilibriumIndex === idx ? null : idx)}
                          >
                            <th>
                              <span className={`calculus-badge ${eq.stability === "stable" ? "min" : eq.stability === "saddle" ? "warn" : eq.stability === "unstable" ? "max" : ""}`}>
                                {eq.label}
                              </span>
                            </th>
                            <td>({fmtNum(eq.x, 2)}, {fmtNum(eq.y, 2)})</td>
                            <td>{fmtEigenvalue(eq.eigenvalues[0])}, {fmtEigenvalue(eq.eigenvalues[1])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="calculus-muted-note">当前视野内未找到平衡点 P = Q = 0。</p>
                )}
              </section>

              {focusedEquilibriumIndex !== null && displayPhasePlane.equilibria[focusedEquilibriumIndex] && (
                <section className="calculus-card">
                  <h2>选中平衡点雅可比矩阵 J</h2>
                  {(() => {
                    const eq = displayPhasePlane.equilibria[focusedEquilibriumIndex]!
                    return (
                      <dl className="calculus-dl">
                        <div><dt>迹 τ = tr(J)</dt><dd>{fmtNum(eq.trace, 3)}</dd></div>
                        <div><dt>行列式 Δ = det(J)</dt><dd>{fmtNum(eq.determinant, 3)}</dd></div>
                        <div><dt>J₁₁, J₁₂</dt><dd>{fmtNum(eq.jacobian[0][0], 2)}, {fmtNum(eq.jacobian[0][1], 2)}</dd></div>
                        <div><dt>J₂₁, J₂₂</dt><dd>{fmtNum(eq.jacobian[1][0], 2)}, {fmtNum(eq.jacobian[1][1], 2)}</dd></div>
                      </dl>
                    )
                  })()}
                </section>
              )}

              <section className="calculus-card">
                <h2>相轨线初值点（{phaseInitialPoints.length}）</h2>
                {phaseInitialPoints.length > 0 ? (
                  <ul className="calculus-kv-list">
                    {phaseInitialPoints.map((pt, idx) => (
                      <li key={`ph-init-${idx}`}>
                        <span>({fmtNum(pt.x, 2)}, {fmtNum(pt.y, 2)})</span>
                        <button
                          type="button"
                          className="calculus-mini-del"
                          onClick={() => setPhaseInitialPoints((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="calculus-muted-note">点击相平面画布任意处即可发射一条双向轨线。</p>
                )}
              </section>

              {phaseDivCurlProbe && (
                <section className="calculus-card">
                  <h2>向量场散度与旋度探针（鼠标悬停）</h2>
                  <dl className="calculus-dl">
                    <div><dt>探针位置</dt><dd>({fmtNum(phaseDivCurlProbe.x, 2)}, {fmtNum(phaseDivCurlProbe.y, 2)})</dd></div>
                    <div><dt>流速 |F|</dt><dd>{fmtNum(phaseDivCurlProbe.speed, 3)}</dd></div>
                    <div>
                      <dt>散度 div F</dt>
                      <dd>
                        {fmtNum(phaseDivCurlProbe.divergence, 3)}（{phaseDivCurlProbe.divKind === "source" ? "发散源" : phaseDivCurlProbe.divKind === "sink" ? "汇聚汇" : "无源"}）
                      </dd>
                    </div>
                    <div>
                      <dt>旋度 curl_z F</dt>
                      <dd>
                        {fmtNum(phaseDivCurlProbe.curlZ, 3)}（{phaseDivCurlProbe.curlKind === "ccw" ? "逆时针旋" : phaseDivCurlProbe.curlKind === "cw" ? "顺时针旋" : "无旋"}）
                      </dd>
                    </div>
                  </dl>
                </section>
              )}
            </>
          )}

          {activeModule === "surface3d" && displaySurface && (
            <>
              <section className="calculus-card">
                <h2>二元驻点 Hessian 判别（AC − B²）</h2>
                {displaySurface.stationaryPoints.length > 0 ? (
                  <div tabIndex={0} role="region" aria-label="三维曲面驻点判别表" className="calculus-table-wrapper">
                    <table className="calculus-table">
                      <thead>
                        <tr>
                          <th>分类</th>
                          <th>(x, y, z)</th>
                          <th>AC − B²</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displaySurface.stationaryPoints.map((sp, idx) => (
                          <tr
                            key={`surf-sp-${idx}`}
                            data-selected={focusedSurfaceIndex === idx}
                            onClick={() => setFocusedSurfaceIndex(idx)}
                          >
                            <th>
                              <span className={`calculus-badge ${sp.kind === "local_max" ? "max" : sp.kind === "local_min" ? "min" : sp.kind === "saddle" ? "warn" : ""}`}>
                                {sp.label}
                              </span>
                            </th>
                            <td>({fmtNum(sp.x, 2)}, {fmtNum(sp.y, 2)}, {fmtNum(sp.z, 2)})</td>
                            <td>{fmtNum(sp.discriminant, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="calculus-muted-note">当前视野内未检测到驻点 ∇f(x, y) = 0。</p>
                )}
              </section>

              {selectedSurfaceStationary && (
                <section className="calculus-card">
                  <h2>选中驻点二阶偏导与切平面</h2>
                  <dl className="calculus-dl">
                    <div><dt>A = f_xx</dt><dd>{fmtNum(selectedSurfaceStationary.fxx, 3)}</dd></div>
                    <div><dt>B = f_xy</dt><dd>{fmtNum(selectedSurfaceStationary.fxy, 3)}</dd></div>
                    <div><dt>C = f_yy</dt><dd>{fmtNum(selectedSurfaceStationary.fyy, 3)}</dd></div>
                    <div><dt>判别式 AC−B²</dt><dd>{fmtNum(selectedSurfaceStationary.discriminant, 3)}</dd></div>
                  </dl>
                  {activeTangentPlane && (
                    <p className="calculus-formula-callout">切平面：{activeTangentPlane.equation}</p>
                  )}
                  <div className="calculus-inline-actions">
                    <button
                      type="button"
                      className="calculus-chip-btn"
                      onClick={() => {
                        setShowSurfaceSlice(true)
                        setSurfaceSliceZ(selectedSurfaceStationary.z)
                      }}
                    >
                      水平截平面移至 z = {fmtNum(selectedSurfaceStationary.z, 2)}
                    </button>
                  </div>
                </section>
              )}

              {surfaceDirectionalProbe && (
                <section className="calculus-card">
                  <h2>梯度 ∇f 与方向导数 ∂f/∂l（θ = {surfaceDirectionalProbe.dirDeg}°）</h2>
                  <dl className="calculus-dl">
                    <div><dt>探针点 (x₀, y₀)</dt><dd>({fmtNum(surfaceDirectionalProbe.x, 2)}, {fmtNum(surfaceDirectionalProbe.y, 2)})</dd></div>
                    <div><dt>函数值 z₀</dt><dd>{fmtNum(surfaceDirectionalProbe.z, 3)}</dd></div>
                    <div><dt>梯度 ∇f</dt><dd>({fmtNum(surfaceDirectionalProbe.fx, 3)}, {fmtNum(surfaceDirectionalProbe.fy, 3)})</dd></div>
                    <div><dt>最大增长率 |∇f|</dt><dd>{fmtNum(surfaceDirectionalProbe.gradNorm, 3)}</dd></div>
                    <div><dt>方向导数 ∂f/∂l</dt><dd>{fmtNum(surfaceDirectionalProbe.directionalDerivative, 4)}</dd></div>
                  </dl>
                  {useCustomSurfaceProbe && (
                    <p className="calculus-formula-callout">任意点切平面：{surfaceDirectionalProbe.equation}</p>
                  )}
                </section>
              )}

              <section className="calculus-card calculus-tip-card">
                <h2>二元极值判别法（高数下必考）</h2>
                <p>
                  在驻点 <code>∇f = 0</code> 处令 <code>A=f_xx, B=f_xy, C=f_yy</code>：当 <code>AC − B² &gt; 0</code> 时为严格极值（<code>A &lt; 0</code> 极大，<code>A &gt; 0</code> 极小）；当 <code>AC − B² &lt; 0</code> 时为<strong>鞍点</strong>（非极值）。
                </p>
              </section>
            </>
          )}

          {(activeModule === "pde" || activeModule === "series" || activeModule === "doubleIntegral") && (
            <Phase3RightDiagnostics
              activeModule={activeModule}
              pdeState={pdeSim.state}
              poissonSolution={pdeSim.poissonSolution}
              seriesSubMode={seriesSubMode}
              taylor={displayTaylor}
              fourier={displayFourier}
              doubleIntegral={displayDoubleIntegral}
            />
          )}

          {(activeModule === "linalg" || activeModule === "probability") && (
            <Phase4RightDiagnostics
              activeModule={activeModule}
              linalg={linalgAnalysis}
              probSubMode={probSubMode}
              distribution={distAnalysis}
              clt={cltAnalysis}
            />
          )}
          </div>
        </aside>

        {effectiveRightDockOpen && (
          <InspectorResizeHandle
            controls="calculus-diagnostics-dock"
            width={effectiveInspectorWidth}
            onResize={handleInspectorResize}
          />
        )}

        {copilotDrawer}
      </div>

      {/* Unified bottom status bar (matching Plane & 3D Geometry workbenches) */}
      <div className="status-bar calculus-status-bar" role="status" aria-live="polite" aria-label="高数工作台状态栏">
        <span className="status-bar-prompt">
          {actionToast ? (
            <strong className="calculus-status-toast">✓ {actionToast}</strong>
          ) : activeModule === "extrema1d" ? (
            hover1DReadout ? (
              <>
                指针读数：x = <b>{fmtNum(hover1DReadout.x, 3)}</b> · f(x) = <b>{fmtNum(hover1DReadout.y, 4)}</b> · f&apos;(x) = <b>{fmtNum(hover1DReadout.dy, 4)}</b>
              </>
            ) : (
              "移动鼠标查看 (x, f(x), f'(x)) 读数 · 滚轮缩放 · 拖拽平移 · 双击画布重置视野"
            )
          ) : activeModule === "lagrange" ? (
            activeProbe ? (
              <>
                约束动点 P({fmtNum(activeProbe.x, 3)}, {fmtNum(activeProbe.y, 3)}) · f(P) = <b>{fmtNum(activeProbe.fValue, 4)}</b> · 夹角 θ = <b>{fmtNum(activeProbe.angleDeg, 1)}°</b>
              </>
            ) : (
              "沿约束曲线 g(x, y) = 0 点击或拖动动点 P，观察等高线相切临界态"
            )
          ) : activeModule === "ode1d" ? (
            hoverWorld && ode1DResult.ok ? (
              <>
                指针位置 ({fmtNum(hoverWorld.x, 2)}, {fmtNum(hoverWorld.y, 2)}) · 斜率 y&apos; = <b>{fmtNum(ode1DResult.fField.eval(hoverWorld.x, hoverWorld.y), 3)}</b> · 点击画布添加初值特解
              </>
            ) : (
              "点击画布任意点用 RK45 绘制双向特解曲线 · 拖拽彩色圆点实时移动初值"
            )
          ) : activeModule === "phase2d" ? (
            hoverWorld && phaseResult.ok ? (
              <>
                相点 ({fmtNum(hoverWorld.x, 2)}, {fmtNum(hoverWorld.y, 2)}) · 速度向量 (x&apos;, y&apos;) = (<b>{fmtNum(phaseResult.pField.eval(hoverWorld.x, hoverWorld.y), 2)}</b>, <b>{fmtNum(phaseResult.qField.eval(hoverWorld.x, hoverWorld.y), 2)}</b>)
              </>
            ) : (
              "点击画布绘制相轨线 · 点击平衡点或右侧表格查看雅可比特征值稳定性"
            )
          ) : activeModule === "surface3d" ? (
            "左键拖拽旋转 3D 曲面 · 滚轮缩放 · 双击重置视角 · 点击右侧驻点表定位局部极值或鞍点"
          ) : activeModule === "pde" ? (
            pdeKind === "poisson2d"
              ? "稳态场 SOR 超松弛收敛 · 黑线为等势线 · 箭头为负梯度通量 −∇u"
              : "点击「播放演化」观察时间推进 · 直接在 2D 画布上点击或涂抹可注入高斯脉冲源"
          ) : activeModule === "series" ? (
            seriesSubMode === "taylor"
              ? "拖动阶数滑块 n 观察泰勒多项式在收敛半径内的贴合与边界外的发散"
              : "拖动谐波阶数 N 观察频谱合成与跳变点吉布斯过冲现象"
          ) : activeModule === "doubleIntegral" ? (
            "拖动「累次积分扫描条进度」观察先 y 后 x / 先 x 后 y / 极坐标截线上下限变化"
          ) : activeModule === "linalg" ? (
            "拖动「连续形变插值 t」观察空间网格变形、特征向量方向不变性与单位圆 → SVD 椭圆映射"
          ) : (
            subbarHint
          )}
        </span>
        <span className="status-bar-spacer" />
        <div className="status-bar-dock-toggles" role="group" aria-label="高数工作台侧栏与导出控制">
          <button
            type="button"
            className="status-bar-dock-btn"
            onClick={handleExportPng}
            title="导出当前高数画布为高清 PNG 图片"
          >
            导出 PNG
          </button>
          {onToggleCopilot && (
            <button
              type="button"
              className="status-bar-dock-btn"
              data-copilot-toggle="true"
              aria-expanded={copilotOpen}
              onClick={onToggleCopilot}
              title={copilotOpen ? "收起 AI 助手抽屉" : "展开 AI 助手抽屉"}
            >
              ✨ AI 助手
            </button>
          )}
          <button
            type="button"
            className="status-bar-dock-btn"
            aria-expanded={effectiveLeftDockOpen}
            onClick={toggleLeftDock}
            title={effectiveLeftDockOpen ? "收起左侧公式参数栏（增大画布）" : "展开左侧公式参数栏"}
          >
            {effectiveLeftDockOpen ? "◀ 左栏" : "▶ 左栏"}
          </button>
          <button
            type="button"
            className="status-bar-dock-btn"
            aria-expanded={effectiveRightDockOpen}
            onClick={toggleRightDock}
            title={effectiveRightDockOpen ? "收起右侧属性诊断栏（增大画布）" : "展开右侧属性诊断栏"}
          >
            {effectiveRightDockOpen ? "右栏 ▶" : "右栏 ◀"}
          </button>
        </div>
      </div>
    </div>
  )
}

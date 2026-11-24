import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { GeometryDocument } from "@draw/dsl"
import { useCalculusStore } from "../../calculusStore"
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
  computeTangentPlane3D,
  evaluateDivCurlProbe,
  evaluateLagrangePoint,
  integrateOde1DBidirectional,
  integratePhaseTrajectoryBidirectional,
  liftConstraintCurvesTo3D,
  projectPointOntoConstraint,
  routeHigherMathPrompt,
  simulateCentralLimitTheorem,
  type CltParentKind,
  type ComplexNumber,
  type DistributionKind,
  type DoubleIntegralOrder,
  type DoubleIntegralPreset,
  type Extrema1DPreset,
  type FourierPreset,
  type FourierWaveformKind,
  type LagrangePreset,
  type LinalgPreset,
  type Matrix2x2,
  type Ode1DPreset,
  type PdeBoundaryCondition,
  type PdeKind,
  type PdePreset,
  type PhasePlanePreset,
  type Point2D,
  type ProbabilityPreset,
  type Surface3DPreset,
  type TaylorPreset,
  type ViewportBounds2D
} from "@draw/geometry-kernel"

import { CalculusCanvas2D } from "./CalculusCanvas2D"
import { CalculusPhase3Canvas } from "./CalculusPhase3Canvas"
import { Phase3LeftControls, Phase3RightDiagnostics } from "./CalculusPhase3Panels"
import { CalculusPhase4Canvas } from "./CalculusPhase4Canvas"
import { Phase4LeftControls, Phase4RightDiagnostics } from "./CalculusPhase4Panels"
import { CalculusSurface3D } from "./CalculusSurface3D"
import { usePdeSimulation } from "./usePdeSimulation"

export type HigherMathModuleId =
  | "extrema1d"
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

export function CalculusWorkbench({ document }: CalculusWorkbenchProps) {
  const [activeModule, setActiveModule] = useState<HigherMathModuleId>("extrema1d")
  const [mobilePane, setMobilePane] = useState<"canvas" | "controls" | "diagnostics">("canvas")

  // ===== 1D Extrema state =====
  const initial1D = EXTREMA_1D_PRESETS[0]!
  const [expr1D, setExpr1D] = useState(initial1D.expression)
  const [domainAInput, setDomainAInput] = useState(String(initial1D.domain[0]))
  const [domainBInput, setDomainBInput] = useState(String(initial1D.domain[1]))
  const [showDerivative, setShowDerivative] = useState(false)
  const [showInflections, setShowInflections] = useState(true)
  const [showAsymptotes, setShowAsymptotes] = useState(true)
  const [showHorizontalTangents, setShowHorizontalTangents] = useState(true)
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
        error: err instanceof Error ? err.message : "表达式解析失败"
      }
    }
  }, [expr1D, parsedDomain1D])

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

  const surfaceResult = useMemo(() => {
    try {
      const fField = compileScalarField2D(surfaceExpr, "expression")
      const analysis = analyzeSurface3D(surfaceExpr, surfaceBounds, { gridSize: 50 })
      return { ok: true as const, analysis, fField }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "二元曲面表达式解析失败"
      }
    }
  }, [surfaceExpr, surfaceBounds])

  const selectedSurfaceStationary = useMemo(() => {
    if (!surfaceResult.ok || surfaceResult.analysis.stationaryPoints.length === 0) return null
    const idx = focusedSurfaceIndex ?? 0
    return surfaceResult.analysis.stationaryPoints[idx] ?? surfaceResult.analysis.stationaryPoints[0]!
  }, [surfaceResult, focusedSurfaceIndex])

  const activeTangentPlane = useMemo(() => {
    if (!showTangentPlane || !surfaceResult.ok || !selectedSurfaceStationary) return null
    return computeTangentPlane3D(surfaceResult.fField, selectedSurfaceStationary.x, selectedSurfaceStationary.y)
  }, [showTangentPlane, surfaceResult, selectedSurfaceStationary])

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
        setCustomBounds1D(null)
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
    ? "自适应 Brent 精化求极值、尖点、拐点、渐近线与闭区间全局最值"
    : activeModule === "lagrange"
      ? "沿约束曲线拖动动点 P 或滑动等高线 c，支持 2D 等高线与 3D 曲面分屏联动"
      : activeModule === "ode1d"
        ? "点击画布任意处即可用 RK45 绘制双向特解曲线，拖拽初值点实时更新"
        : activeModule === "phase2d"
          ? "点击画布绘制相轨线，实时读取散度/旋度，自动提取零倾线与平衡点稳定性"
          : activeModule === "surface3d"
            ? "拖拽旋转 3D 曲面 z = f(x, y)，自动按 Hessian 判别式 AC − B² 区分极值与鞍点"
            : activeModule === "pde"
              ? "Web Worker 实时数值模拟 2D 热传导、波动干涉与泊松稳态场，点击画布注入脉冲源"
              : activeModule === "series"
                ? "幂级数自动微分精确展开 n 阶泰勒多项式 · 傅里叶谐波合成、频谱与吉布斯现象"
                : "直观演示二重积分「先 y 后 x / 先 x 后 y」一键换序扫描与极坐标 r dr dθ 扇形网格"

  return (
    <div className="calculus-workbench" data-mobile-pane={mobilePane}>
      {/* Sub-module switcher bar */}
      <header className="calculus-subbar" aria-label="高等数学子模块">
        <div className="calculus-module-tabs" role="tablist" aria-label="高数模块切换">
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "extrema1d"}
            aria-pressed={activeModule === "extrema1d"}
            onClick={() => setActiveModule("extrema1d")}
          >
            一元极值与最值
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "lagrange"}
            aria-pressed={activeModule === "lagrange"}
            onClick={() => setActiveModule("lagrange")}
          >
            拉格朗日乘数法
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "ode1d"}
            aria-pressed={activeModule === "ode1d"}
            onClick={() => setActiveModule("ode1d")}
          >
            ODE 斜率场
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "phase2d"}
            aria-pressed={activeModule === "phase2d"}
            onClick={() => setActiveModule("phase2d")}
          >
            相平面向量场
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "surface3d"}
            aria-pressed={activeModule === "surface3d"}
            onClick={() => setActiveModule("surface3d")}
          >
            3D 曲面与鞍点
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "pde"}
            aria-pressed={activeModule === "pde"}
            onClick={() => setActiveModule("pde")}
          >
            PDE 偏微分方程
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "series"}
            aria-pressed={activeModule === "series"}
            onClick={() => setActiveModule("series")}
          >
            泰勒 / 傅里叶级数
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "doubleIntegral"}
            aria-pressed={activeModule === "doubleIntegral"}
            onClick={() => setActiveModule("doubleIntegral")}
          >
            二重积分与极坐标
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "linalg"}
            aria-pressed={activeModule === "linalg"}
            onClick={() => setActiveModule("linalg")}
          >
            线性代数变换
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeModule === "probability"}
            aria-pressed={activeModule === "probability"}
            onClick={() => setActiveModule("probability")}
          >
            概率统计与CLT
          </button>
        </div>

        <form
          className="calculus-smart-bar"
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
        {smartNotice && <span className="calculus-smart-notice" role="status">{smartNotice}</span>}
        <div className="calculus-mobile-switcher" role="group" aria-label="移动端视图切换">
          <button type="button" aria-pressed={mobilePane === "controls"} onClick={() => setMobilePane("controls")}>公式与预设</button>
          <button type="button" aria-pressed={mobilePane === "canvas"} onClick={() => setMobilePane("canvas")}>画布</button>
          <button type="button" aria-pressed={mobilePane === "diagnostics"} onClick={() => setMobilePane("diagnostics")}>数值诊断</button>
        </div>
      </header>

      {/* Main 3-column workbench */}
      <div className="calculus-body">
        {/* Left: Formula, parameters & presets */}
        <aside className="calculus-sidebar calculus-controls" aria-label="公式与参数面板">
          {activeModule === "extrema1d" && (
            <>
              <section className="calculus-card">
                <h2>目标函数与闭区间</h2>
                <label className="calculus-field">
                  <span>函数表达式 f(x)</span>
                  <input
                    type="text"
                    value={expr1D}
                    onChange={(e) => {
                      setExpr1D(e.target.value)
                      setFocusedExtremaIndex(null)
                    }}
                    placeholder="例如：x^3 - 3*x + 1"
                    spellCheck={false}
                  />
                </label>
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
                {!extrema1dResult.ok && (
                  <p className="calculus-error" role="alert">{extrema1dResult.error}</p>
                )}
              </section>

              <section className="calculus-card">
                <h2>可视化图层</h2>
                <div className="calculus-checks">
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

          {activeModule === "lagrange" && (
            <>
              <section className="calculus-card">
                <h2>目标函数与约束条件</h2>
                <label className="calculus-field">
                  <span>目标函数 f(x, y)</span>
                  <input
                    type="text"
                    value={objectiveExpr}
                    onChange={(e) => {
                      setObjectiveExpr(e.target.value)
                      setFocusedStationaryIndex(null)
                    }}
                    placeholder="例如：x + 2*y 或 x * y"
                    spellCheck={false}
                  />
                </label>
                <label className="calculus-field">
                  <span>约束曲线 g(x, y) = 0</span>
                  <input
                    type="text"
                    value={constraintExpr}
                    onChange={(e) => {
                      setConstraintExpr(e.target.value)
                      setFocusedStationaryIndex(null)
                    }}
                    placeholder="支持等式，如 x^2 + y^2 = 4"
                    spellCheck={false}
                  />
                </label>
                {!lagrangeResult.ok && (
                  <p className="calculus-error" role="alert">{lagrangeResult.error}</p>
                )}
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
                <label className="calculus-field">
                  <span>右端函数 f(x, y)</span>
                  <input
                    type="text"
                    value={odeRhsExpr}
                    onChange={(e) => setOdeRhsExpr(e.target.value)}
                    placeholder="例如：y * (1 - y / 3)"
                    spellCheck={false}
                  />
                </label>
                {!ode1DResult.ok && (
                  <p className="calculus-error" role="alert">{ode1DResult.error}</p>
                )}
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
                <label className="calculus-field">
                  <span>dx/dt = P(x, y)</span>
                  <input
                    type="text"
                    value={phasePExpr}
                    onChange={(e) => {
                      setPhasePExpr(e.target.value)
                      setFocusedEquilibriumIndex(null)
                    }}
                    placeholder="例如：y"
                    spellCheck={false}
                  />
                </label>
                <label className="calculus-field">
                  <span>dy/dt = Q(x, y)</span>
                  <input
                    type="text"
                    value={phaseQExpr}
                    onChange={(e) => {
                      setPhaseQExpr(e.target.value)
                      setFocusedEquilibriumIndex(null)
                    }}
                    placeholder="例如：-sin(x) - 0.35*y"
                    spellCheck={false}
                  />
                </label>
                {!phaseResult.ok && (
                  <p className="calculus-error" role="alert">{phaseResult.error}</p>
                )}
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
                <label className="calculus-field">
                  <span>函数表达式 f(x, y)</span>
                  <input
                    type="text"
                    value={surfaceExpr}
                    onChange={(e) => {
                      setSurfaceExpr(e.target.value)
                      setFocusedSurfaceIndex(0)
                    }}
                    placeholder="例如：x^3 - 3*x + y^2"
                    spellCheck={false}
                  />
                </label>
                {!surfaceResult.ok && (
                  <p className="calculus-error" role="alert">{surfaceResult.error}</p>
                )}

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
                    <span>在选中驻点绘制局部切平面</span>
                  </label>
                  <label className="calculus-check">
                    <input type="checkbox" checked={showSurfaceSlice} onChange={(e) => setShowSurfaceSlice(e.target.checked)} />
                    <span>显示水平截平面 z = c</span>
                  </label>
                </div>

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

          {/* Backward compatibility for legacy .mgeo documents saved in `calculus` workspace */}
          {document.primitives.length > 0 && (
            <section className="calculus-card calculus-legacy-card" aria-label="文档兼容对象">
              <h2>文档兼容对象（{document.primitives.length}）</h2>
              <ul className="calculus-legacy-list">
                {document.primitives.map((primitive) => (
                  <li key={primitive.id}>
                    <span className="object-name">{primitive.label ?? primitive.id}</span>
                    <small>{primitive.type}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/* Center: Interactive 2D / 3D / Split Stage */}
        <main className="calculus-stage" aria-label="高等数学交互画布区">
          {activeModule === "linalg" || activeModule === "probability" ? (
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

          <div className="calculus-stage-footer" role="status" aria-live="polite">
            {activeModule === "extrema1d" ? (
              hover1DReadout ? (
                <span>
                  指针读数：x = <b>{fmtNum(hover1DReadout.x, 3)}</b> · f(x) = <b>{fmtNum(hover1DReadout.y, 4)}</b> · f&apos;(x) = <b>{fmtNum(hover1DReadout.dy, 4)}</b>
                </span>
              ) : (
                <span>移动鼠标查看任意点 (x, f(x), f&apos;(x)) 读数 · 滚轮缩放 · 拖拽画布平移</span>
              )
            ) : activeModule === "lagrange" ? (
              activeProbe ? (
                <span>
                  约束动点 P({fmtNum(activeProbe.x, 3)}, {fmtNum(activeProbe.y, 3)}) · f(P) = <b>{fmtNum(activeProbe.fValue, 4)}</b> · 夹角 θ = <b>{fmtNum(activeProbe.angleDeg, 1)}°</b>
                </span>
              ) : (
                <span>沿约束曲线 g(x, y) = 0 点击或拖动动点 P，观察等高线相切临界态</span>
              )
            ) : activeModule === "ode1d" ? (
              hoverWorld && ode1DResult.ok ? (
                <span>
                  指针位置 ({fmtNum(hoverWorld.x, 2)}, {fmtNum(hoverWorld.y, 2)}) · 斜率 y&apos; = <b>{fmtNum(ode1DResult.fField.eval(hoverWorld.x, hoverWorld.y), 3)}</b> · 点击画布添加初值特解
                </span>
              ) : (
                <span>点击画布任意点用 RK45 绘制双向特解曲线 · 拖拽彩色圆点实时移动初值</span>
              )
            ) : activeModule === "phase2d" ? (
              hoverWorld && phaseResult.ok ? (
                <span>
                  相点 ({fmtNum(hoverWorld.x, 2)}, {fmtNum(hoverWorld.y, 2)}) · 速度向量 (x&apos;, y&apos;) = (<b>{fmtNum(phaseResult.pField.eval(hoverWorld.x, hoverWorld.y), 2)}</b>, <b>{fmtNum(phaseResult.qField.eval(hoverWorld.x, hoverWorld.y), 2)}</b>)
                </span>
              ) : (
                <span>点击画布绘制相轨线 · 点击平衡点或右侧表格查看雅可比特征值稳定性</span>
              )
            ) : activeModule === "surface3d" ? (
              <span>左键拖拽旋转 3D 曲面 · 滚轮缩放 · 点击右侧驻点表定位局部极值或鞍点切平面</span>
            ) : activeModule === "pde" ? (
              <span>
                {pdeKind === "poisson2d"
                  ? "稳态场 SOR 超松弛收敛 · 黑线为等势线 · 箭头为负梯度通量 −∇u"
                  : "点击「播放演化」观察时间推进 · 直接在 2D 画布上点击或涂抹可注入高斯脉冲源"}
              </span>
            ) : activeModule === "series" ? (
              <span>
                {seriesSubMode === "taylor"
                  ? "拖动阶数滑块 n 观察泰勒多项式在收敛半径内的贴合与边界外的发散"
                  : "拖动谐波阶数 N 观察频谱合成与跳变点吉布斯过冲现象"}
              </span>
            ) : activeModule === "doubleIntegral" ? (
              <span>拖动「累次积分扫描条进度」观察先 y 后 x / 先 x 后 y / 极坐标截线上下限变化</span>
            ) : activeModule === "linalg" ? (
              <span>拖动「连续形变插值 t」观察空间网格变形、特征向量方向不变性与单位圆 → SVD 椭圆映射</span>
            ) : (
              <span>{subbarHint || "调整分布参数与区间 [a, b]，或切换中心极限定理观察样本均值向正态收敛"}</span>
            )}
          </div>
        </main>

        {/* Right: Numerical Diagnostics & Teaching Insights */}
        <aside className="calculus-sidebar calculus-diagnostics" aria-label="数值诊断与考点结论">
          {activeModule === "extrema1d" && extrema1dResult.ok && (
            <>
              <section className="calculus-card">
                <h2>闭区间 [{fmtNum(extrema1dResult.analysis.domain[0], 2)}, {fmtNum(extrema1dResult.analysis.domain[1], 2)}] 全局最值</h2>
                <div className="calculus-metric-pair">
                  <div className="calculus-metric max">
                    <span className="metric-label">全局最大值</span>
                    {extrema1dResult.analysis.unboundedAbove ? (
                      <strong>+∞（无上界）</strong>
                    ) : extrema1dResult.analysis.globalMax ? (
                      <>
                        <strong>{fmtNum(extrema1dResult.analysis.globalMax.y, 4)}</strong>
                        <small>x = {fmtNum(extrema1dResult.analysis.globalMax.x, 4)}（{extrema1dResult.analysis.globalMax.label}）</small>
                      </>
                    ) : (
                      <strong>无</strong>
                    )}
                  </div>
                  <div className="calculus-metric min">
                    <span className="metric-label">全局最小值</span>
                    {extrema1dResult.analysis.unboundedBelow ? (
                      <strong>−∞（无下界）</strong>
                    ) : extrema1dResult.analysis.globalMin ? (
                      <>
                        <strong>{fmtNum(extrema1dResult.analysis.globalMin.y, 4)}</strong>
                        <small>x = {fmtNum(extrema1dResult.analysis.globalMin.x, 4)}（{extrema1dResult.analysis.globalMin.label}）</small>
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
                      {extrema1dResult.analysis.extrema.map((pt, idx) => (
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
                {extrema1dResult.analysis.inflections.length > 0 ? (
                  <ul className="calculus-kv-list">
                    {extrema1dResult.analysis.inflections.map((inf, idx) => (
                      <li key={`inf-${idx}`}>
                        <span>拐点 ({fmtNum(inf.x, 3)}, {fmtNum(inf.y, 3)})</span>
                        <small>{inf.concavityChange === "up_to_down" ? "下凸 → 上凸" : "上凸 → 下凸"}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="calculus-muted-note">当前闭区间内未检测到拐点。</p>
                )}

                {extrema1dResult.analysis.asymptotes.length > 0 && (
                  <ul className="calculus-kv-list calculus-asymptote-list">
                    {extrema1dResult.analysis.asymptotes.map((asy, idx) => (
                      <li key={`asy-${idx}`}>
                        <span>{asy.kind === "vertical" ? "垂直渐近线" : asy.kind === "horizontal" ? "水平渐近线" : "斜渐近线"}</span>
                        <code>{asy.label}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {activeModule === "lagrange" && lagrangeResult.ok && (
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
                {lagrangeResult.analysis.stationaryPoints.length > 0 ? (
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
                        {lagrangeResult.analysis.stationaryPoints.map((sp, idx) => (
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

          {activeModule === "ode1d" && ode1DResult.ok && (
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

          {activeModule === "phase2d" && phaseResult.ok && (
            <>
              <section className="calculus-card">
                <h2>平衡点与雅可比稳定性分类</h2>
                {phaseResult.phasePlane.equilibria.length > 0 ? (
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
                        {phaseResult.phasePlane.equilibria.map((eq, idx) => (
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

              {focusedEquilibriumIndex !== null && phaseResult.phasePlane.equilibria[focusedEquilibriumIndex] && (
                <section className="calculus-card">
                  <h2>选中平衡点雅可比矩阵 J</h2>
                  {(() => {
                    const eq = phaseResult.phasePlane.equilibria[focusedEquilibriumIndex]!
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

          {activeModule === "surface3d" && surfaceResult.ok && (
            <>
              <section className="calculus-card">
                <h2>二元驻点 Hessian 判别（AC − B²）</h2>
                {surfaceResult.analysis.stationaryPoints.length > 0 ? (
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
                        {surfaceResult.analysis.stationaryPoints.map((sp, idx) => (
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
              taylor={taylorResult.ok ? taylorResult.analysis : null}
              fourier={fourierResult.ok ? fourierResult.analysis : null}
              doubleIntegral={diResult.ok ? diResult.analysis : null}
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
        </aside>
      </div>
    </div>
  )
}

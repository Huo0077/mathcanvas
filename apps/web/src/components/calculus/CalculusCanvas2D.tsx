import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  extractContoursFromGrid,
  type DualCurve1DAnalysis,
  type Extrema1DAnalysis,
  type LagrangeAnalysis,
  type LagrangePointProbe,
  type Ode1DTrajectory,
  type OdeSlopeFieldAnalysis,
  type PhasePlaneAnalysis,
  type PhaseTrajectory,
  type Point2D,
  type Root1DPoint,
  type Tangent1DAnalysis,
  type ViewportBounds2D
} from "@draw/geometry-kernel"

export interface CalculusCanvas2DProps {
  mode: "extrema1d" | "lagrange" | "ode1d" | "phase2d"
  bounds: ViewportBounds2D
  onBoundsChange: (next: ViewportBounds2D) => void
  onResetView: () => void
  // 1D Extrema & Calculus props
  extrema1d?: Extrema1DAnalysis | null
  showDerivative?: boolean
  showInflections?: boolean
  showAsymptotes?: boolean
  showHorizontalTangents?: boolean
  showIntegralArea?: boolean
  showRoots?: boolean
  roots1d?: Root1DPoint[]
  tangentProbe?: Tangent1DAnalysis | null
  dualCurve?: DualCurve1DAnalysis | null
  focusedExtremaIndex?: number | null
  onHover1D?: (info: { x: number; y: number } | null) => void
  // Lagrange props
  lagrange?: LagrangeAnalysis | null
  activeLevel?: number
  activePoint?: Point2D | null
  activeProbe?: LagrangePointProbe | null
  showGradients?: boolean
  showHeatmap?: boolean
  focusedStationaryIndex?: number | null
  onDragLagrangePoint?: (worldX: number, worldY: number) => void
  onSelectStationary?: (index: number) => void
  // 1st-order ODE props
  odeSlopeField?: OdeSlopeFieldAnalysis | null
  odeTrajectories?: Ode1DTrajectory[]
  onAddTrajectoryPoint?: (worldX: number, worldY: number) => void
  onMoveTrajectoryPoint?: (index: number, worldX: number, worldY: number) => void
  // 2D Phase plane props
  phasePlane?: PhasePlaneAnalysis | null
  phaseTrajectories?: PhaseTrajectory[]
  showNullclines?: boolean
  showEquilibria?: boolean
  focusedEquilibriumIndex?: number | null
  onSelectEquilibrium?: (index: number) => void
}

function niceTickStep(span: number, targetTicks: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const raw = span / Math.max(2, targetTicks)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 5.5 ? 5 : 10
  return step * mag
}

function formatTick(v: number): string {
  if (Math.abs(v) < 1e-9) return "0"
  if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.01)) {
    return v.toExponential(1)
  }
  return Number(v.toFixed(3)).toString()
}

function contourColor(t: number): string {
  // Cool indigo (#4f46e5) -> slate blue (#2563eb) -> teal (#0d9488) -> amber (#d97706) -> coral (#dc2626)
  const clamped = Math.max(0, Math.min(1, t))
  const hue = 230 - clamped * 215
  const sat = 66
  const light = 46
  return `hsl(${hue.toFixed(0)} ${sat}% ${light}%)`
}

function heatmapRgba(t: number): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  // Soft editorial pastel ramp: cool ice-blue -> white -> warm sand-rose
  if (clamped < 0.5) {
    const u = clamped * 2
    const r = Math.round(212 + (248 - 212) * u)
    const g = Math.round(229 + (250 - 229) * u)
    const b = Math.round(248 + (252 - 248) * u)
    return [r, g, b, 155]
  }
  const u = (clamped - 0.5) * 2
  const r = Math.round(248 + (253 - 248) * u)
  const g = Math.round(250 + (226 - 250) * u)
  const b = Math.round(252 + (214 - 252) * u)
  return [r, g, b, 155]
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  label: string
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len < 3) return

  const ux = dx / len
  const uy = dy / len
  const headLen = Math.min(11, Math.max(7, len * 0.25))

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2.5
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1 - ux * headLen * 0.65, y1 - uy * headLen * 0.65)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - ux * headLen - uy * headLen * 0.45, y1 - uy * headLen + ux * headLen * 0.45)
  ctx.lineTo(x1 - ux * headLen + uy * headLen * 0.45, y1 - uy * headLen - ux * headLen * 0.45)
  ctx.closePath()
  ctx.fill()

  ctx.font = '600 13px "Cambria Math", Cambria, Georgia, serif'
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const lx = x1 + ux * 15
  const ly = y1 + uy * 15
  ctx.fillStyle = "rgba(255,255,255,0.88)"
  const tw = ctx.measureText(label).width
  ctx.fillRect(lx - tw / 2 - 4, ly - 9, tw + 8, 18)
  ctx.fillStyle = color
  ctx.fillText(label, lx, ly)
  ctx.restore()
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg: string,
  border?: string
): void {
  ctx.save()
  ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif'
  const paddingX = 7
  const h = 20
  const w = ctx.measureText(text).width + paddingX * 2
  const left = x - w / 2
  const top = y - h / 2
  const r = 5

  ctx.beginPath()
  ctx.moveTo(left + r, top)
  ctx.lineTo(left + w - r, top)
  ctx.quadraticCurveTo(left + w, top, left + w, top + r)
  ctx.lineTo(left + w, top + h - r)
  ctx.quadraticCurveTo(left + w, top + h, left + w - r, top + h)
  ctx.lineTo(left + r, top + h)
  ctx.quadraticCurveTo(left, top + h, left, top + h - r)
  ctx.lineTo(left, top + r)
  ctx.quadraticCurveTo(left, top, left + r, top)
  ctx.closePath()

  ctx.fillStyle = bg
  ctx.fill()
  if (border) {
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.fillStyle = fg
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, x, y + 0.5)
  ctx.restore()
}

const TRAJECTORY_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d"
]

function drawSmallArrowhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ux: number,
  uy: number,
  size: number,
  color: string
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x + ux * size, y + uy * size)
  ctx.lineTo(x - ux * size * 0.7 - uy * size * 0.55, y - uy * size * 0.7 + ux * size * 0.55)
  ctx.lineTo(x - ux * size * 0.7 + uy * size * 0.55, y - uy * size * 0.7 - ux * size * 0.55)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function CalculusCanvas2D({
  mode,
  bounds,
  onBoundsChange,
  onResetView,
  extrema1d,
  showDerivative = false,
  showInflections = true,
  showAsymptotes = true,
  showHorizontalTangents = true,
  showIntegralArea = false,
  showRoots = false,
  roots1d,
  tangentProbe = null,
  dualCurve = null,
  focusedExtremaIndex = null,
  onHover1D,
  lagrange,
  activeLevel,
  activePoint,
  activeProbe,
  showGradients = true,
  showHeatmap = false,
  focusedStationaryIndex = null,
  onDragLagrangePoint,
  onSelectStationary,
  odeSlopeField,
  odeTrajectories,
  onAddTrajectoryPoint,
  onMoveTrajectoryPoint,
  phasePlane,
  phaseTrajectories,
  showNullclines = true,
  showEquilibria = true,
  focusedEquilibriumIndex = null,
  onSelectEquilibrium
}: CalculusCanvas2DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 720, height: 480 })
  const [hoverWorld, setHoverWorld] = useState<Point2D | null>(null)
  const dragModeRef = useRef<
    | null
    | { kind: "pan"; startClientX: number; startClientY: number; startBounds: ViewportBounds2D; moved: boolean }
    | { kind: "point" }
    | { kind: "ode-point"; index: number }
  >(null)

  // Observe container resize so canvas stays crisp at any window / split width.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 10 && rect.height > 10) {
        setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
      }
    }
    update()
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  // Extract active level contour on the fly from cached fGrid (< 1ms).
  const activeContourPolylines = useMemo(() => {
    if (mode !== "lagrange" || !lagrange || activeLevel === undefined || !Number.isFinite(activeLevel)) {
      return []
    }
    return extractContoursFromGrid(
      lagrange.fGrid,
      lagrange.bounds,
      lagrange.gridSize,
      lagrange.gridSize,
      activeLevel
    )
  }, [mode, lagrange, activeLevel])

  const worldToScreen = useCallback(
    (wx: number, wy: number): [number, number] => {
      const sx = ((wx - bounds.xMin) / (bounds.xMax - bounds.xMin)) * size.width
      const sy = ((bounds.yMax - wy) / (bounds.yMax - bounds.yMin)) * size.height
      return [sx, sy]
    },
    [bounds, size]
  )

  const screenToWorld = useCallback(
    (sx: number, sy: number): Point2D => {
      const wx = bounds.xMin + (sx / Math.max(1, size.width)) * (bounds.xMax - bounds.xMin)
      const wy = bounds.yMax - (sy / Math.max(1, size.height)) * (bounds.yMax - bounds.yMin)
      return { x: wx, y: wy }
    },
    [bounds, size]
  )

  // Main render effect
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = canvas.getContext("2d")
    } catch {
      return
    }
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pixelW = Math.max(1, Math.round(size.width * dpr))
    const pixelH = Math.max(1, Math.round(size.height * dpr))
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW
      canvas.height = pixelH
    }

    ctx.save()
    ctx.scale(dpr, dpr)

    const w = size.width
    const h = size.height
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)

    // Optional soft heatmap under grid in Lagrange mode
    if (mode === "lagrange" && showHeatmap && lagrange) {
      const n = lagrange.gridSize
      const cols = n + 1
      const rows = n + 1
      const off = document.createElement("canvas")
      off.width = cols
      off.height = rows
      const offCtx = off.getContext("2d")
      if (offCtx) {
        const img = offCtx.createImageData(cols, rows)
        const span = Math.max(1e-6, lagrange.fMax - lagrange.fMin)
        for (let j = 0; j < rows; j += 1) {
          const canvasRow = rows - 1 - j
          for (let i = 0; i < cols; i += 1) {
            const val = lagrange.fGrid[j * cols + i]!
            const idx = (canvasRow * cols + i) * 4
            if (!Number.isFinite(val)) {
              img.data[idx + 3] = 0
            } else {
              const t = (val - lagrange.fMin) / span
              const [r, g, b, a] = heatmapRgba(t)
              img.data[idx] = r
              img.data[idx + 1] = g
              img.data[idx + 2] = b
              img.data[idx + 3] = a
            }
          }
        }
        offCtx.putImageData(img, 0, 0)
        const [bx0, by1] = worldToScreen(lagrange.bounds.xMin, lagrange.bounds.yMax)
        const [bx1, by0] = worldToScreen(lagrange.bounds.xMax, lagrange.bounds.yMin)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(off, bx0, by1, bx1 - bx0, by0 - by1)
      }
    }

    // 1. Graph paper grid & coordinate axes
    const xStep = niceTickStep(bounds.xMax - bounds.xMin, Math.max(4, Math.floor(w / 90)))
    const yStep = niceTickStep(bounds.yMax - bounds.yMin, Math.max(4, Math.floor(h / 75)))

    // Minor grid
    ctx.strokeStyle = "#eef2f7"
    ctx.lineWidth = 1
    ctx.beginPath()
    const minorX = xStep / 2
    for (let x = Math.ceil(bounds.xMin / minorX) * minorX; x <= bounds.xMax; x += minorX) {
      const [sx] = worldToScreen(x, 0)
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, h)
    }
    const minorY = yStep / 2
    for (let y = Math.ceil(bounds.yMin / minorY) * minorY; y <= bounds.yMax; y += minorY) {
      const [, sy] = worldToScreen(0, y)
      ctx.moveTo(0, sy)
      ctx.lineTo(w, sy)
    }
    ctx.stroke()

    // Major grid
    ctx.strokeStyle = "#dce4ef"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = Math.ceil(bounds.xMin / xStep) * xStep; x <= bounds.xMax; x += xStep) {
      const [sx] = worldToScreen(x, 0)
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, h)
    }
    for (let y = Math.ceil(bounds.yMin / yStep) * yStep; y <= bounds.yMax; y += yStep) {
      const [, sy] = worldToScreen(0, y)
      ctx.moveTo(0, sy)
      ctx.lineTo(w, sy)
    }
    ctx.stroke()

    // Coordinate axes
    const [axisX, axisY] = worldToScreen(0, 0)
    const clampedAxisX = Math.max(28, Math.min(w - 18, axisX))
    const clampedAxisY = Math.max(18, Math.min(h - 24, axisY))

    ctx.strokeStyle = "#94a3b8"
    ctx.lineWidth = 1.4
    ctx.beginPath()
    if (axisX >= 0 && axisX <= w) {
      ctx.moveTo(axisX, 0)
      ctx.lineTo(axisX, h)
    }
    if (axisY >= 0 && axisY <= h) {
      ctx.moveTo(0, axisY)
      ctx.lineTo(w, axisY)
    }
    ctx.stroke()

    // Axis ticks & math serif labels
    ctx.fillStyle = "#586a80"
    ctx.font = '11px "Cambria Math", Cambria, Georgia, serif'
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    for (let x = Math.ceil(bounds.xMin / xStep) * xStep; x <= bounds.xMax; x += xStep) {
      if (Math.abs(x) < xStep * 1e-4) continue
      const [sx] = worldToScreen(x, 0)
      if (sx < 14 || sx > w - 14) continue
      ctx.fillText(formatTick(x), sx, clampedAxisY + 4)
    }
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    for (let y = Math.ceil(bounds.yMin / yStep) * yStep; y <= bounds.yMax; y += yStep) {
      if (Math.abs(y) < yStep * 1e-4) continue
      const [, sy] = worldToScreen(0, y)
      if (sy < 12 || sy > h - 12) continue
      ctx.fillText(formatTick(y), clampedAxisX - 5, sy)
    }

    // Axis names x, y
    ctx.font = 'italic 600 13px "Cambria Math", Cambria, Georgia, serif'
    ctx.fillStyle = "#2c3e50"
    ctx.textAlign = "right"
    ctx.textBaseline = "bottom"
    ctx.fillText("x", w - 8, clampedAxisY - 5)
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    ctx.fillText("y", clampedAxisX + 6, 8)

    // 2. Mode-specific rendering
    if (mode === "extrema1d" && extrema1d) {
      const [domA, domB] = extrema1d.domain
      const [sxA] = worldToScreen(domA, 0)
      const [sxB] = worldToScreen(domB, 0)

      // Dim outside closed interval [a, b]
      ctx.fillStyle = "rgba(148, 163, 184, 0.11)"
      if (sxA > 0) ctx.fillRect(0, 0, Math.min(w, sxA), h)
      if (sxB < w) ctx.fillRect(Math.max(0, sxB), 0, w - Math.max(0, sxB), h)

      // Interval boundary vertical guides
      ctx.save()
      ctx.strokeStyle = "rgba(61, 90, 128, 0.4)"
      ctx.lineWidth = 1.2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(sxA, 0); ctx.lineTo(sxA, h)
      ctx.moveTo(sxB, 0); ctx.lineTo(sxB, h)
      ctx.stroke()
      ctx.restore()

      // Asymptotes
      if (showAsymptotes) {
        ctx.save()
        ctx.strokeStyle = "#9333ea"
        ctx.lineWidth = 1.3
        ctx.setLineDash([6, 5])
        for (const asy of extrema1d.asymptotes) {
          ctx.beginPath()
          if (asy.kind === "vertical" && asy.x !== undefined) {
            const [ax] = worldToScreen(asy.x, 0)
            ctx.moveTo(ax, 0)
            ctx.lineTo(ax, h)
            ctx.stroke()
            drawPill(ctx, Math.min(w - 42, Math.max(42, ax)), 20, asy.label, "#faf5ff", "#7e22ce", "#d8b4fe")
          } else if (asy.slope !== undefined && asy.intercept !== undefined) {
            const yL = asy.slope * bounds.xMin + asy.intercept
            const yR = asy.slope * bounds.xMax + asy.intercept
            const [p0x, p0y] = worldToScreen(bounds.xMin, yL)
            const [p1x, p1y] = worldToScreen(bounds.xMax, yR)
            ctx.moveTo(p0x, p0y)
            ctx.lineTo(p1x, p1y)
            ctx.stroke()
            const midX = bounds.xMax - (bounds.xMax - bounds.xMin) * 0.16
            const midY = asy.slope * midX + asy.intercept
            const [lx, ly] = worldToScreen(midX, midY)
            if (ly > 24 && ly < h - 24) {
              drawPill(ctx, Math.min(w - 52, Math.max(52, lx)), ly - 14, asy.label, "#faf5ff", "#7e22ce", "#d8b4fe")
            }
          }
        }
        ctx.restore()
      }

      // Optional definite integral shaded signed area on [a, b]
      if (showIntegralArea) {
        const [, zeroY] = worldToScreen(0, 0)
        for (const seg of extrema1d.segments) {
          if (seg.length < 2) continue
          for (let i = 0; i < seg.length - 1; i += 1) {
            const p0 = seg[i]!
            const p1 = seg[i + 1]!
            if (p1.x < domA || p0.x > domB) continue
            const [x0, y0] = worldToScreen(p0.x, p0.y)
            const [x1, y1] = worldToScreen(p1.x, p1.y)
            const avgY = 0.5 * (p0.y + p1.y)
            ctx.fillStyle = avgY >= 0 ? "rgba(37, 99, 235, 0.14)" : "rgba(220, 38, 38, 0.12)"
            ctx.beginPath()
            ctx.moveTo(x0, zeroY)
            ctx.lineTo(x0, y0)
            ctx.lineTo(x1, y1)
            ctx.lineTo(x1, zeroY)
            ctx.closePath()
            ctx.fill()
          }
        }
      }

      // Optional derivative curve f'(x)
      if (showDerivative) {
        ctx.save()
        ctx.strokeStyle = "#0d9488"
        ctx.lineWidth = 1.6
        ctx.setLineDash([5, 4])
        for (const seg of extrema1d.derivativeSegments) {
          if (seg.length < 2) continue
          ctx.beginPath()
          seg.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          ctx.stroke()
        }
        ctx.restore()
      }

      // Optional comparison curve g(x) + shaded region between curves
      if (dualCurve && dualCurve.gSegments.length > 0) {
        ctx.save()
        ctx.strokeStyle = "#9333ea"
        ctx.lineWidth = 2.2
        ctx.lineJoin = "round"
        for (const seg of dualCurve.gSegments) {
          if (seg.length < 2) continue
          ctx.beginPath()
          seg.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          ctx.stroke()
        }
        ctx.restore()
      }

      // Main curve f(x)
      ctx.save()
      ctx.strokeStyle = "#2563eb"
      ctx.lineWidth = 2.5
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      for (const seg of extrema1d.segments) {
        if (seg.length < 2) continue
        ctx.beginPath()
        seg.forEach((pt, idx) => {
          const [px, py] = worldToScreen(pt.x, pt.y)
          if (idx === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.stroke()
      }
      ctx.restore()

      // Optional interactive tangent & normal lines at x0
      if (tangentProbe && Number.isFinite(tangentProbe.y0) && Number.isFinite(tangentProbe.slope)) {
        const { x0, y0, slope } = tangentProbe
        const yL = y0 + slope * (bounds.xMin - x0)
        const yR = y0 + slope * (bounds.xMax - x0)
        const [tx0, ty0] = worldToScreen(bounds.xMin, yL)
        const [tx1, ty1] = worldToScreen(bounds.xMax, yR)
        ctx.save()
        ctx.strokeStyle = "#ea580c"
        ctx.lineWidth = 1.9
        ctx.setLineDash([7, 4])
        ctx.beginPath()
        ctx.moveTo(tx0, ty0)
        ctx.lineTo(tx1, ty1)
        ctx.stroke()
        ctx.restore()

        // Normal line
        ctx.save()
        ctx.strokeStyle = "rgba(100, 116, 139, 0.72)"
        ctx.lineWidth = 1.3
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        if (Math.abs(slope) < 1e-6) {
          const [nx] = worldToScreen(x0, 0)
          ctx.moveTo(nx, 0)
          ctx.lineTo(nx, h)
        } else {
          const nSlope = -1 / slope
          const nyL = y0 + nSlope * (bounds.xMin - x0)
          const nyR = y0 + nSlope * (bounds.xMax - x0)
          const [nx0, ny0] = worldToScreen(bounds.xMin, nyL)
          const [nx1, ny1] = worldToScreen(bounds.xMax, nyR)
          ctx.moveTo(nx0, ny0)
          ctx.lineTo(nx1, ny1)
        }
        ctx.stroke()
        ctx.restore()

        const [px, py] = worldToScreen(x0, y0)
        ctx.save()
        ctx.fillStyle = "#ea580c"
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.arc(px, py, 5.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }

      // Optional zero / root markers f(x) = 0
      if (showRoots && roots1d && roots1d.length > 0) {
        for (const rt of roots1d) {
          const [px, py] = worldToScreen(rt.x, 0)
          if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue
          ctx.save()
          ctx.fillStyle = "#ffffff"
          ctx.strokeStyle = "#0284c7"
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.arc(px, py, 4.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      }

      // Optional dual-curve intersection diamond markers
      if (dualCurve && dualCurve.intersections.length > 0) {
        for (const inter of dualCurve.intersections) {
          const [px, py] = worldToScreen(inter.x, inter.y)
          if (px < -12 || px > w + 12 || py < -12 || py > h + 12) continue
          ctx.save()
          ctx.fillStyle = "#9333ea"
          ctx.strokeStyle = "#ffffff"
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(px, py - 6.5)
          ctx.lineTo(px + 6.5, py)
          ctx.lineTo(px, py + 6.5)
          ctx.lineTo(px - 6.5, py)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      }

      // Inflection points
      if (showInflections) {
        for (const inf of extrema1d.inflections) {
          const [px, py] = worldToScreen(inf.x, inf.y)
          if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue
          ctx.save()
          ctx.fillStyle = "#ffffff"
          ctx.strokeStyle = "#7c3aed"
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.arc(px, py, 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      }

      // Extrema & endpoints
      extrema1d.extrema.forEach((pt, idx) => {
        const [px, py] = worldToScreen(pt.x, pt.y)
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) return
        const isFocused = focusedExtremaIndex === idx

        // Horizontal tangent segment for smooth local max/min
        if (showHorizontalTangents && (pt.kind === "local_max" || pt.kind === "local_min")) {
          ctx.save()
          ctx.strokeStyle = pt.kind === "local_max" ? "rgba(220, 38, 38, 0.55)" : "rgba(13, 148, 136, 0.55)"
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(px - 26, py)
          ctx.lineTo(px + 26, py)
          ctx.stroke()
          ctx.restore()
        }

        // Dashed drop lines for global max / global min or focused point
        if (pt.isGlobalMax || pt.isGlobalMin || isFocused) {
          ctx.save()
          ctx.strokeStyle = pt.isGlobalMax ? "rgba(220, 38, 38, 0.35)" : "rgba(13, 148, 136, 0.35)"
          ctx.lineWidth = 1.2
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(px, clampedAxisY)
          ctx.moveTo(px, py)
          ctx.lineTo(clampedAxisX, py)
          ctx.stroke()
          ctx.restore()
        }

        const fillColor = pt.isGlobalMax
          ? "#dc2626"
          : pt.isGlobalMin
            ? "#059669"
            : pt.kind === "local_max" || pt.kind === "cusp_max"
              ? "#ea580c"
              : pt.kind === "local_min" || pt.kind === "cusp_min"
                ? "#0d9488"
                : "#475569"

        ctx.save()
        if (isFocused || pt.isGlobalMax || pt.isGlobalMin) {
          ctx.fillStyle = pt.isGlobalMax
            ? "rgba(220, 38, 38, 0.16)"
            : pt.isGlobalMin
              ? "rgba(5, 150, 105, 0.16)"
              : "rgba(37, 99, 235, 0.18)"
          ctx.beginPath()
          ctx.arc(px, py, isFocused ? 12 : 10, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.fillStyle = fillColor
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2
        if (pt.kind === "cusp_max" || pt.kind === "cusp_min") {
          // Diamond marker for non-differentiable cusps
          const r = 6.5
          ctx.beginPath()
          ctx.moveTo(px, py - r)
          ctx.lineTo(px + r, py)
          ctx.lineTo(px, py + r)
          ctx.lineTo(px - r, py)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(px, py, pt.isGlobalMax || pt.isGlobalMin ? 6 : 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
        ctx.restore()

        if (pt.isGlobalMax || pt.isGlobalMin || isFocused) {
          const badge = pt.isGlobalMax
            ? `最大 (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`
            : pt.isGlobalMin
              ? `最小 (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`
              : `${pt.label} (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`
          const offsetY = pt.isGlobalMax || pt.kind === "local_max" || pt.kind === "cusp_max" ? -20 : 22
          const safeX = Math.max(66, Math.min(w - 66, px))
          const safeY = Math.max(16, Math.min(h - 16, py + offsetY))
          drawPill(
            ctx,
            safeX,
            safeY,
            badge,
            pt.isGlobalMax ? "#fef2f2" : pt.isGlobalMin ? "#ecfdf5" : "#eff6ff",
            pt.isGlobalMax ? "#b91c1c" : pt.isGlobalMin ? "#047857" : "#1d4ed8",
            pt.isGlobalMax ? "#fca5a5" : pt.isGlobalMin ? "#6ee7b7" : "#93c5fd"
          )
        }
      })

      // Hover crosshair
      if (hoverWorld) {
        const [hx] = worldToScreen(hoverWorld.x, 0)
        ctx.save()
        ctx.strokeStyle = "rgba(44, 62, 80, 0.25)"
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(hx, 0)
        ctx.lineTo(hx, h)
        ctx.stroke()
        ctx.restore()
      }
    }

    if (mode === "lagrange" && lagrange) {
      const fSpan = Math.max(1e-6, lagrange.fMax - lagrange.fMin)

      // Level-set contour family f(x, y) = c_k
      ctx.save()
      ctx.lineWidth = 1.25
      ctx.lineJoin = "round"
      for (const contour of lagrange.contours) {
        const t = (contour.level - lagrange.fMin) / fSpan
        ctx.strokeStyle = contourColor(t)
        ctx.globalAlpha = 0.52
        for (const poly of contour.polylines) {
          if (poly.length < 2) continue
          ctx.beginPath()
          poly.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          ctx.stroke()
        }
        // Subtle inline level label on longest polyline
        const longest = contour.polylines.reduce<Point2D[] | null>(
          (best, cur) => (!best || cur.length > best.length ? cur : best),
          null
        )
        if (longest && longest.length > 8) {
          const mid = longest[Math.floor(longest.length * 0.35)]!
          const [lx, ly] = worldToScreen(mid.x, mid.y)
          if (lx > 28 && lx < w - 28 && ly > 20 && ly < h - 20) {
            ctx.save()
            ctx.globalAlpha = 0.9
            ctx.font = '10px "Cambria Math", Cambria, serif'
            const txt = formatTick(contour.level)
            const tw = ctx.measureText(txt).width
            ctx.fillStyle = "rgba(255,255,255,0.82)"
            ctx.fillRect(lx - tw / 2 - 2, ly - 6, tw + 4, 12)
            ctx.fillStyle = contourColor(t)
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(txt, lx, ly)
            ctx.restore()
          }
        }
      }
      ctx.restore()

      // Highlighted active level contour f(x, y) = c
      if (activeContourPolylines.length > 0) {
        const isTangent = Boolean(activeProbe?.isTangent)
        ctx.save()
        ctx.strokeStyle = isTangent ? "#059669" : "#d97706"
        ctx.lineWidth = isTangent ? 3.1 : 2.6
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        for (const poly of activeContourPolylines) {
          if (poly.length < 2) continue
          ctx.beginPath()
          poly.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          ctx.stroke()
        }
        ctx.restore()
      }

      // Constraint curve g(x, y) = 0 with crisp white halo + deep ink stroke
      ctx.save()
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      for (const poly of lagrange.constraintCurves) {
        if (poly.length < 2) continue
        ctx.beginPath()
        poly.forEach((pt, idx) => {
          const [px, py] = worldToScreen(pt.x, pt.y)
          if (idx === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.strokeStyle = "rgba(255,255,255,0.9)"
        ctx.lineWidth = 5.5
        ctx.stroke()
        ctx.strokeStyle = "#1e293b"
        ctx.lineWidth = 2.8
        ctx.stroke()
      }
      ctx.restore()

      // Exact Lagrange stationary points
      lagrange.stationaryPoints.forEach((pt, idx) => {
        const [px, py] = worldToScreen(pt.x, pt.y)
        if (px < -12 || px > w + 12 || py < -12 || py > h + 12) return
        const isFocused = focusedStationaryIndex === idx
        const color = pt.isGlobalMax
          ? "#dc2626"
          : pt.isGlobalMin
            ? "#059669"
            : pt.kind === "constrained_max"
              ? "#ea580c"
              : "#0d9488"

        ctx.save()
        if (isFocused) {
          ctx.fillStyle = "rgba(37, 99, 235, 0.2)"
          ctx.beginPath()
          ctx.arc(px, py, 12, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = color
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(px, py, 5.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      })

      // Active draggable point P and live gradient vectors ∇f(P), ∇g(P)
      if (activePoint) {
        const [px, py] = worldToScreen(activePoint.x, activePoint.y)

        if (showGradients && activeProbe) {
          const scaleX = w / (bounds.xMax - bounds.xMin)
          const scaleY = h / (bounds.yMax - bounds.yMin)

          const drawScaledGrad = (vec: [number, number], color: string, label: string) => {
            const vx = vec[0] * scaleX
            const vy = -vec[1] * scaleY
            const rawLen = Math.hypot(vx, vy)
            if (rawLen < 1e-4) return
            const clampedLen = Math.min(82, Math.max(30, rawLen * 0.42))
            const k = clampedLen / rawLen
            drawArrow(ctx, px, py, px + vx * k, py + vy * k, color, label)
          }

          drawScaledGrad(activeProbe.gradG, "#0d9488", "∇g")
          drawScaledGrad(activeProbe.gradF, "#dc2626", "∇f")
        }

        const tangent = Boolean(activeProbe?.isTangent)
        ctx.save()
        ctx.fillStyle = tangent ? "rgba(5, 150, 105, 0.24)" : "rgba(217, 119, 6, 0.22)"
        ctx.beginPath()
        ctx.arc(px, py, 14, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = tangent ? "#059669" : "#d97706"
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(px, py, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()

        if (tangent && activeProbe) {
          const lamText = Number.isFinite(activeProbe.estimatedLambda)
            ? `λ ≈ ${activeProbe.estimatedLambda.toFixed(3)}`
            : "∇f = 0"
          drawPill(
            ctx,
            Math.max(82, Math.min(w - 82, px)),
            Math.max(22, py - 26),
            `相切！∇f ∥ ∇g (${lamText})`,
            "#ecfdf5",
            "#047857",
            "#34d399"
          )
        }
      }
    }

    if (mode === "ode1d" && odeSlopeField) {
      const scaleX = w / (bounds.xMax - bounds.xMin)
      const scaleY = h / (bounds.yMax - bounds.yMin)

      // Slope field short segments
      ctx.save()
      ctx.strokeStyle = "rgba(71, 85, 105, 0.58)"
      ctx.lineWidth = 1.4
      ctx.lineCap = "round"
      ctx.beginPath()
      const halfLen = 8
      for (const s of odeSlopeField.samples) {
        const [sx, sy] = worldToScreen(s.x, s.y)
        const vx = scaleX
        const vy = -s.slope * scaleY
        const norm = Math.hypot(vx, vy)
        if (norm < 1e-6) continue
        const dx = (vx / norm) * halfLen
        const dy = (vy / norm) * halfLen
        ctx.moveTo(sx - dx, sy - dy)
        ctx.lineTo(sx + dx, sy + dy)
      }
      ctx.stroke()
      ctx.restore()

      // RK45 bidirectional integral curves
      if (odeTrajectories) {
        odeTrajectories.forEach((traj, idx) => {
          const color = TRAJECTORY_COLORS[idx % TRAJECTORY_COLORS.length]!
          if (traj.points.length >= 2) {
            ctx.save()
            ctx.strokeStyle = color
            ctx.lineWidth = 2.3
            ctx.lineJoin = "round"
            ctx.lineCap = "round"
            ctx.beginPath()
            traj.points.forEach((pt, i) => {
              const [px, py] = worldToScreen(pt.x, pt.y)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            })
            ctx.stroke()
            ctx.restore()
          }

          // Draggable initial value dot (x0, y0)
          const [ix, iy] = worldToScreen(traj.initial.x, traj.initial.y)
          ctx.save()
          ctx.fillStyle = color
          ctx.strokeStyle = "#ffffff"
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.arc(ix, iy, 5.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        })
      }
    }

    if (mode === "phase2d" && phasePlane) {
      const scaleX = w / (bounds.xMax - bounds.xMin)
      const scaleY = h / (bounds.yMax - bounds.yMin)

      // Vector field arrows with speed-based color encoding
      for (const vec of phasePlane.vectors) {
        const [sx, sy] = worldToScreen(vec.x, vec.y)
        const px = vec.vx * scaleX
        const py = -vec.vy * scaleY
        const screenNorm = Math.hypot(px, py)
        if (screenNorm < 1e-6) continue
        const ux = px / screenNorm
        const uy = py / screenNorm
        const speedRatio = Math.min(1, vec.speed / phasePlane.speedP95)
        const arrowLen = 10 + speedRatio * 9
        const color = contourColor(speedRatio * 0.9)

        ctx.save()
        ctx.globalAlpha = 0.66
        ctx.strokeStyle = color
        ctx.lineWidth = 1.35
        ctx.lineCap = "round"
        const x0 = sx - ux * arrowLen * 0.45
        const y0 = sy - uy * arrowLen * 0.45
        const x1 = sx + ux * arrowLen * 0.55
        const y1 = sy + uy * arrowLen * 0.55
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
        drawSmallArrowhead(ctx, x1, y1, ux, uy, 3.6, color)
        ctx.restore()
      }

      // Nullclines (P = 0 vertical flow, Q = 0 horizontal flow)
      if (showNullclines) {
        const drawNullcline = (curves: Point2D[][], color: string) => {
          ctx.save()
          ctx.strokeStyle = color
          ctx.lineWidth = 1.6
          ctx.setLineDash([6, 4])
          ctx.globalAlpha = 0.78
          for (const poly of curves) {
            if (poly.length < 2) continue
            ctx.beginPath()
            poly.forEach((pt, i) => {
              const [px, py] = worldToScreen(pt.x, pt.y)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            })
            ctx.stroke()
          }
          ctx.restore()
        }
        drawNullcline(phasePlane.pNullclines, "#dc2626")
        drawNullcline(phasePlane.qNullclines, "#0d9488")
      }

      // Phase trajectories with directional arrowheads along flow
      if (phaseTrajectories) {
        phaseTrajectories.forEach((traj, idx) => {
          const color = TRAJECTORY_COLORS[idx % TRAJECTORY_COLORS.length]!
          if (traj.points.length >= 2) {
            ctx.save()
            ctx.strokeStyle = color
            ctx.lineWidth = 2.2
            ctx.lineJoin = "round"
            ctx.lineCap = "round"
            ctx.beginPath()
            traj.points.forEach((pt, i) => {
              const [px, py] = worldToScreen(pt.x, pt.y)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            })
            ctx.stroke()
            ctx.restore()

            // Place 3 directional arrows along the trajectory
            const n = traj.points.length
            for (const frac of [0.25, 0.55, 0.82]) {
              const k = Math.max(1, Math.min(n - 1, Math.floor(n * frac)))
              const a = traj.points[k - 1]!
              const b = traj.points[k]!
              const [ax, ay] = worldToScreen(a.x, a.y)
              const [bx, by] = worldToScreen(b.x, b.y)
              const dist = Math.hypot(bx - ax, by - ay)
              if (dist > 2) {
                drawSmallArrowhead(ctx, bx, by, (bx - ax) / dist, (by - ay) / dist, 5.2, color)
              }
            }
          }

          // Draggable seed dot
          const [ix, iy] = worldToScreen(traj.initial.x, traj.initial.y)
          ctx.save()
          ctx.fillStyle = color
          ctx.strokeStyle = "#ffffff"
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.arc(ix, iy, 5.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        })
      }

      // Equilibrium points with textbook stability markers
      if (showEquilibria) {
        phasePlane.equilibria.forEach((eq, idx) => {
          const [px, py] = worldToScreen(eq.x, eq.y)
          if (px < -14 || px > w + 14 || py < -14 || py > h + 14) return
          const isFocused = focusedEquilibriumIndex === idx

          ctx.save()
          if (isFocused) {
            ctx.fillStyle = "rgba(37, 99, 235, 0.18)"
            ctx.beginPath()
            ctx.arc(px, py, 14, 0, Math.PI * 2)
            ctx.fill()
          }

          if (eq.kind === "saddle") {
            ctx.strokeStyle = "#ffffff"
            ctx.lineWidth = 5
            ctx.beginPath()
            ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6)
            ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6)
            ctx.stroke()
            ctx.strokeStyle = "#ea580c"
            ctx.lineWidth = 2.6
            ctx.beginPath()
            ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6)
            ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6)
            ctx.stroke()
          } else if (eq.kind === "center") {
            ctx.fillStyle = "#ffffff"
            ctx.strokeStyle = "#2563eb"
            ctx.lineWidth = 2.4
            ctx.beginPath()
            ctx.arc(px, py, 6.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = "#2563eb"
            ctx.beginPath()
            ctx.arc(px, py, 2.5, 0, Math.PI * 2)
            ctx.fill()
          } else if (eq.stability === "stable") {
            ctx.fillStyle = "#059669"
            ctx.strokeStyle = "#ffffff"
            ctx.lineWidth = 2.2
            ctx.beginPath()
            ctx.arc(px, py, 6, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          } else {
            ctx.fillStyle = "#ffffff"
            ctx.strokeStyle = "#dc2626"
            ctx.lineWidth = 2.5
            ctx.beginPath()
            ctx.arc(px, py, 6, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          ctx.restore()

          if (isFocused) {
            drawPill(
              ctx,
              Math.max(74, Math.min(w - 74, px)),
              Math.max(20, py - 22),
              `${eq.label} (${eq.x.toFixed(2)}, ${eq.y.toFixed(2)})`,
              "#eff6ff",
              "#1d4ed8",
              "#93c5fd"
            )
          }
        })
      }
    }

    ctx.restore()
  }, [
    mode,
    bounds,
    size,
    extrema1d,
    showDerivative,
    showInflections,
    showAsymptotes,
    showHorizontalTangents,
    showIntegralArea,
    showRoots,
    roots1d,
    tangentProbe,
    dualCurve,
    focusedExtremaIndex,
    hoverWorld,
    lagrange,
    activeContourPolylines,
    activePoint,
    activeProbe,
    showGradients,
    showHeatmap,
    focusedStationaryIndex,
    odeSlopeField,
    odeTrajectories,
    phasePlane,
    phaseTrajectories,
    showNullclines,
    showEquilibria,
    focusedEquilibriumIndex,
    worldToScreen
  ])

  const zoomBy = (factor: number, anchor?: Point2D) => {
    const cx = anchor?.x ?? 0.5 * (bounds.xMin + bounds.xMax)
    const cy = anchor?.y ?? 0.5 * (bounds.yMin + bounds.yMax)
    const nextW = (bounds.xMax - bounds.xMin) * factor
    const nextH = (bounds.yMax - bounds.yMin) * factor
    if (nextW < 0.05 || nextW > 400 || nextH < 0.05 || nextH > 400) return
    const rx = (cx - bounds.xMin) / (bounds.xMax - bounds.xMin)
    const ry = (cy - bounds.yMin) / (bounds.yMax - bounds.yMin)
    onBoundsChange({
      xMin: cx - rx * nextW,
      xMax: cx + (1 - rx) * nextW,
      yMin: cy - ry * nextH,
      yMax: cy + (1 - ry) * nextH
    })
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    e.currentTarget.setPointerCapture(e.pointerId)

    if (mode === "lagrange" && lagrange) {
      // Check if clicking an exact stationary point
      for (let i = 0; i < lagrange.stationaryPoints.length; i += 1) {
        const sp = lagrange.stationaryPoints[i]!
        const [px, py] = worldToScreen(sp.x, sp.y)
        if (Math.hypot(sx - px, sy - py) <= 13) {
          onSelectStationary?.(i)
          dragModeRef.current = { kind: "point" }
          return
        }
      }

      // Check if grabbing point P or clicking right on the constraint curve
      if (activePoint) {
        const [px, py] = worldToScreen(activePoint.x, activePoint.y)
        if (Math.hypot(sx - px, sy - py) <= 22) {
          dragModeRef.current = { kind: "point" }
          return
        }
      }

      // Check proximity to constraint curve so users can click anywhere on g=0 to place & drag P
      let nearConstraint = false
      for (const poly of lagrange.constraintCurves) {
        for (const pt of poly) {
          const [px, py] = worldToScreen(pt.x, pt.y)
          if (Math.hypot(sx - px, sy - py) <= 14) {
            nearConstraint = true
            break
          }
        }
        if (nearConstraint) break
      }
      if (nearConstraint) {
        const world = screenToWorld(sx, sy)
        onDragLagrangePoint?.(world.x, world.y)
        dragModeRef.current = { kind: "point" }
        return
      }
    }

    if (mode === "ode1d" || mode === "phase2d") {
      // Check if grabbing an existing initial condition seed dot
      const list = mode === "ode1d" ? odeTrajectories : phaseTrajectories
      if (list) {
        for (let i = 0; i < list.length; i += 1) {
          const init = list[i]!.initial
          const [px, py] = worldToScreen(init.x, init.y)
          if (Math.hypot(sx - px, sy - py) <= 14) {
            dragModeRef.current = { kind: "ode-point", index: i }
            return
          }
        }
      }
      // Check if clicking an equilibrium point in phase2d
      if (mode === "phase2d" && phasePlane && showEquilibria) {
        for (let i = 0; i < phasePlane.equilibria.length; i += 1) {
          const eq = phasePlane.equilibria[i]!
          const [px, py] = worldToScreen(eq.x, eq.y)
          if (Math.hypot(sx - px, sy - py) <= 12) {
            onSelectEquilibrium?.(i)
            return
          }
        }
      }
    }

    dragModeRef.current = {
      kind: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBounds: bounds,
      moved: false
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const world = screenToWorld(sx, sy)
    setHoverWorld(world)
    if (mode === "extrema1d" || mode === "ode1d" || mode === "phase2d") onHover1D?.(world)

    const drag = dragModeRef.current
    if (!drag) return

    if (drag.kind === "point") {
      onDragLagrangePoint?.(world.x, world.y)
      return
    }

    if (drag.kind === "ode-point") {
      onMoveTrajectoryPoint?.(drag.index, world.x, world.y)
      return
    }

    const dxPx = e.clientX - drag.startClientX
    const dyPx = e.clientY - drag.startClientY
    if (Math.hypot(dxPx, dyPx) > 4) {
      drag.moved = true
    }
    if (!drag.moved) return

    const spanX = drag.startBounds.xMax - drag.startBounds.xMin
    const spanY = drag.startBounds.yMax - drag.startBounds.yMin
    const dxWorld = -(dxPx / Math.max(1, size.width)) * spanX
    const dyWorld = (dyPx / Math.max(1, size.height)) * spanY
    onBoundsChange({
      xMin: drag.startBounds.xMin + dxWorld,
      xMax: drag.startBounds.xMax + dxWorld,
      yMin: drag.startBounds.yMin + dyWorld,
      yMax: drag.startBounds.yMax + dyWorld
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragModeRef.current
    if (drag && drag.kind === "pan" && !drag.moved && (mode === "ode1d" || mode === "phase2d")) {
      const rect = e.currentTarget.getBoundingClientRect()
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
      onAddTrajectoryPoint?.(world.x, world.y)
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragModeRef.current = null
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const anchor = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
    zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, anchor)
  }

  const canvasLabel = mode === "extrema1d"
    ? "一元函数极值与最值画布"
    : mode === "lagrange"
      ? "拉格朗日乘数等高线与约束画布"
      : mode === "ode1d"
        ? "一阶微分方程斜率场与特解画布"
        : "二维自治系统相平面向量场画布"

  return (
    <div className="calculus-canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="calculus-canvas"
        aria-label={canvasLabel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          setHoverWorld(null)
          onHover1D?.(null)
        }}
        onDoubleClick={() => {
          if (mode === "extrema1d" || mode === "lagrange") onResetView()
        }}
        onWheel={handleWheel}
      />

      {/* Legend overlay */}
      <div className="calculus-canvas-legend" aria-hidden="true">
        {mode === "extrema1d" ? (
          <>
            <span><i className="dot curve" />y = f(x)</span>
            {dualCurve && <span><i className="dot saddle" />y = g(x)</span>}
            {showDerivative && <span><i className="dot deriv" />y = f&apos;(x)</span>}
            {tangentProbe && <span><i className="dot active-level" />切线 / 法线</span>}
            <span><i className="dot max" />全局/局部极大</span>
            <span><i className="dot min" />全局/局部极小</span>
            {showInflections && <span><i className="dot infl" />拐点</span>}
          </>
        ) : mode === "lagrange" ? (
          <>
            <span><i className="dot constraint" />约束 g(x,y) = 0</span>
            <span><i className="dot active-level" />当前等高线 f = c</span>
            {showGradients && <span><i className="dot grad-f" />∇f</span>}
            {showGradients && <span><i className="dot grad-g" />∇g</span>}
          </>
        ) : mode === "ode1d" ? (
          <>
            <span><i className="dot slope" />斜率场 y&apos; = f(x,y)</span>
            <span><i className="dot curve" />RK45 特解曲线（点击画布添加初值）</span>
          </>
        ) : (
          <>
            <span><i className="dot min" />稳定平衡点</span>
            <span><i className="dot saddle-x" />鞍点</span>
            <span><i className="dot center-ring" />中心点</span>
            {showNullclines && <span><i className="dot grad-f" />x&apos;=0 零倾线</span>}
            {showNullclines && <span><i className="dot grad-g" />y&apos;=0 零倾线</span>}
          </>
        )}
      </div>

      {/* Zoom controls */}
      <div className="calculus-zoom-controls" role="group" aria-label="画布缩放控制">
        <button type="button" onClick={() => zoomBy(0.8)} title="放大" aria-label="放大画布">＋</button>
        <button type="button" onClick={() => zoomBy(1.25)} title="缩小" aria-label="缩小画布">－</button>
        <button type="button" onClick={onResetView} title="重置视野" aria-label="重置视野">重置</button>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from "react"

import {
  computeFourierEpicycles,
  type DoubleIntegralAnalysis,
  type FourierAnalysis,
  type PdeSimulationState,
  type Point2D,
  type PoissonSolution,
  type TaylorAnalysis,
  type ViewportBounds2D
} from "@draw/geometry-kernel"

export interface CalculusPhase3CanvasProps {
  mode: "pde" | "series" | "doubleIntegral"
  bounds: ViewportBounds2D
  onBoundsChange: (next: ViewportBounds2D) => void
  onResetView: () => void
  // PDE props
  pdeState?: PdeSimulationState | null
  poissonSolution?: PoissonSolution | null
  onInjectPdePulse?: (wx: number, wy: number) => void
  // Series props
  seriesSubMode?: "taylor" | "fourier"
  taylor?: TaylorAnalysis | null
  showTaylorError?: boolean
  fourier?: FourierAnalysis | null
  showEpicycles?: boolean
  epicyclePhase?: number
  // Double integral props
  doubleIntegral?: DoubleIntegralAnalysis | null
  showRiemannGrid?: boolean
}

function niceStep(span: number, target: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const raw = span / Math.max(2, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 5.5 ? 5 : 10
  return step * mag
}

function divergingColor(val: number, scale: number): [number, number, number] {
  const s = Math.max(-1, Math.min(1, val / Math.max(1e-5, scale)))
  if (s >= 0) {
    // White (#f8fafc) -> Warm amber -> Crimson (#dc2626)
    const r = Math.round(248 + (220 - 248) * s)
    const g = Math.round(250 - 212 * (s ** 0.85))
    const b = Math.round(252 - 214 * s)
    return [r, g, b]
  }
  const u = -s
  // White (#f8fafc) -> Cerulean -> Deep Royal Blue (#1d4ed8)
  const r = Math.round(248 - 219 * u)
  const g = Math.round(250 - 172 * (u ** 0.85))
  const b = Math.round(252 - 36 * u)
  return [r, g, b]
}

export function CalculusPhase3Canvas({
  mode,
  bounds,
  onBoundsChange,
  onResetView,
  pdeState,
  poissonSolution,
  onInjectPdePulse,
  seriesSubMode = "taylor",
  taylor,
  showTaylorError = false,
  fourier,
  showEpicycles = true,
  epicyclePhase = 0.6,
  doubleIntegral,
  showRiemannGrid = true
}: CalculusPhase3CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 720, height: 480 })
  const dragRef = useRef<
    | null
    | { kind: "pan"; x0: number; y0: number; b0: ViewportBounds2D }
    | { kind: "pulse" }
  >(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 10 && r.height > 10) {
        setSize({ width: Math.round(r.width), height: Math.round(r.height) })
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

  const worldToScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      ((wx - bounds.xMin) / (bounds.xMax - bounds.xMin)) * size.width,
      ((bounds.yMax - wy) / (bounds.yMax - bounds.yMin)) * size.height
    ],
    [bounds, size]
  )

  const screenToWorld = useCallback(
    (sx: number, sy: number): Point2D => ({
      x: bounds.xMin + (sx / Math.max(1, size.width)) * (bounds.xMax - bounds.xMin),
      y: bounds.yMax - (sy / Math.max(1, size.height)) * (bounds.yMax - bounds.yMin)
    }),
    [bounds, size]
  )

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
    const pw = Math.max(1, Math.round(size.width * dpr))
    const ph = Math.max(1, Math.round(size.height * dpr))
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }

    ctx.save()
    ctx.scale(dpr, dpr)
    const w = size.width
    const h = size.height
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)

    // PDE 2D Heatmap layer
    if (mode === "pde" && pdeState) {
      const n = pdeState.gridSize
      const cols = n + 1
      const off = document.createElement("canvas")
      off.width = cols
      off.height = cols
      const offCtx = off.getContext("2d")
      if (offCtx) {
        const img = offCtx.createImageData(cols, cols)
        const absMax = Math.max(0.25, Math.abs(pdeState.uMin), Math.abs(pdeState.uMax))
        for (let j = 0; j < cols; j += 1) {
          const crow = cols - 1 - j
          for (let i = 0; i < cols; i += 1) {
            const val = pdeState.u[j * cols + i]!
            const [r, g, b] = divergingColor(val, absMax)
            const idx = (crow * cols + i) * 4
            img.data[idx] = r
            img.data[idx + 1] = g
            img.data[idx + 2] = b
            img.data[idx + 3] = 240
          }
        }
        offCtx.putImageData(img, 0, 0)
        const [bx0, by1] = worldToScreen(pdeState.bounds.xMin, pdeState.bounds.yMax)
        const [bx1, by0] = worldToScreen(pdeState.bounds.xMax, pdeState.bounds.yMin)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(off, bx0, by1, bx1 - bx0, by0 - by1)
      }

      // Overlay Poisson equipotential contours & -∇u flux vectors
      if (pdeState.kind === "poisson2d" && poissonSolution) {
        ctx.save()
        ctx.strokeStyle = "rgba(30, 41, 59, 0.45)"
        ctx.lineWidth = 1.2
        for (const c of poissonSolution.equipotentials) {
          for (const poly of c.polylines) {
            if (poly.length < 2) continue
            ctx.beginPath()
            poly.forEach((pt, idx) => {
              const [px, py] = worldToScreen(pt.x, pt.y)
              if (idx === 0) ctx!.moveTo(px, py)
              else ctx!.lineTo(px, py)
            })
            ctx.stroke()
          }
        }
        ctx.restore()

        const scaleX = w / (bounds.xMax - bounds.xMin)
        const scaleY = h / (bounds.yMax - bounds.yMin)
        for (const vec of poissonSolution.fluxVectors) {
          const [sx, sy] = worldToScreen(vec.x, vec.y)
          const vx = vec.vx * scaleX
          const vy = -vec.vy * scaleY
          const norm = Math.hypot(vx, vy)
          if (norm < 1e-5) continue
          const ratio = Math.min(1, vec.speed / poissonSolution.fluxP95)
          const len = 8 + ratio * 10
          const ux = vx / norm
          const uy = vy / norm
          const x1 = sx + ux * len * 0.6
          const y1 = sy + uy * len * 0.6
          ctx.save()
          ctx.strokeStyle = "rgba(15, 23, 42, 0.72)"
          ctx.fillStyle = "rgba(15, 23, 42, 0.72)"
          ctx.lineWidth = 1.3
          ctx.beginPath()
          ctx.moveTo(sx - ux * len * 0.4, sy - uy * len * 0.4)
          ctx.lineTo(x1, y1)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(x1 + ux * 3.5, y1 + uy * 3.5)
          ctx.lineTo(x1 - ux * 2 - uy * 2.2, y1 - uy * 2 + ux * 2.2)
          ctx.lineTo(x1 - ux * 2 + uy * 2.2, y1 - uy * 2 - ux * 2.2)
          ctx.closePath()
          ctx.fill()
          ctx.restore()
        }
      }
    }

    // Standard coordinate grid & axes
    const xStep = niceStep(bounds.xMax - bounds.xMin, Math.max(4, Math.floor(w / 95)))
    const yStep = niceStep(bounds.yMax - bounds.yMin, Math.max(4, Math.floor(h / 75)))

    ctx.strokeStyle = mode === "pde" ? "rgba(148, 163, 184, 0.25)" : "#e2e8f0"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = Math.ceil(bounds.xMin / xStep) * xStep; x <= bounds.xMax; x += xStep) {
      const [sx] = worldToScreen(x, 0)
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h)
    }
    for (let y = Math.ceil(bounds.yMin / yStep) * yStep; y <= bounds.yMax; y += yStep) {
      const [, sy] = worldToScreen(0, y)
      ctx.moveTo(0, sy); ctx.lineTo(w, sy)
    }
    ctx.stroke()

    // Polar background reference rings in polar double integral mode
    if (mode === "doubleIntegral" && doubleIntegral?.order === "polar") {
      const [ox, oy] = worldToScreen(0, 0)
      const scaleX = w / (bounds.xMax - bounds.xMin)
      const scaleY = h / (bounds.yMax - bounds.yMin)
      ctx.save()
      ctx.strokeStyle = "rgba(100, 116, 139, 0.22)"
      ctx.setLineDash([4, 4])
      for (let r = 0.5; r <= 5; r += 0.5) {
        ctx.beginPath()
        ctx.ellipse(ox, oy, r * scaleX, r * scaleY, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    const [axisX, axisY] = worldToScreen(0, 0)
    const cxAxis = Math.max(28, Math.min(w - 18, axisX))
    const cyAxis = Math.max(18, Math.min(h - 24, axisY))

    ctx.strokeStyle = mode === "pde" ? "rgba(51, 65, 85, 0.45)" : "#94a3b8"
    ctx.lineWidth = 1.35
    ctx.beginPath()
    if (axisX >= 0 && axisX <= w) { ctx.moveTo(axisX, 0); ctx.lineTo(axisX, h) }
    if (axisY >= 0 && axisY <= h) { ctx.moveTo(0, axisY); ctx.lineTo(w, axisY) }
    ctx.stroke()

    ctx.fillStyle = "#586a80"
    ctx.font = '11px "Cambria Math", Cambria, Georgia, serif'
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    for (let x = Math.ceil(bounds.xMin / xStep) * xStep; x <= bounds.xMax; x += xStep) {
      if (Math.abs(x) < xStep * 1e-4) continue
      const [sx] = worldToScreen(x, 0)
      if (sx > 16 && sx < w - 16) ctx.fillText(Number(x.toFixed(2)).toString(), sx, cyAxis + 4)
    }
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    for (let y = Math.ceil(bounds.yMin / yStep) * yStep; y <= bounds.yMax; y += yStep) {
      if (Math.abs(y) < yStep * 1e-4) continue
      const [, sy] = worldToScreen(0, y)
      if (sy > 14 && sy < h - 14) ctx.fillText(Number(y.toFixed(2)).toString(), cxAxis - 5, sy)
    }

    // Series (Taylor / Fourier) rendering
    if (mode === "series") {
      if (seriesSubMode === "taylor" && taylor) {
        if (showTaylorError && taylor.errorCurve.length >= 2) {
          ctx.save()
          ctx.strokeStyle = "rgba(147, 51, 234, 0.6)"
          ctx.lineWidth = 1.4
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          taylor.errorCurve.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.stroke()
          ctx.restore()
        }

        // Target f(x)
        if (taylor.targetCurve.length >= 2) {
          ctx.save()
          ctx.strokeStyle = "#2563eb"
          ctx.lineWidth = 2.5
          ctx.beginPath()
          taylor.targetCurve.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.stroke()
          ctx.restore()
        }

        // Taylor polynomial P_n(x)
        if (taylor.approxCurve.length >= 2) {
          ctx.save()
          ctx.strokeStyle = "#dc2626"
          ctx.lineWidth = 2.3
          ctx.setLineDash([7, 4])
          ctx.beginPath()
          taylor.approxCurve.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.stroke()
          ctx.restore()
        }

        // Expansion center marker (x0, f(x0))
        const y0 = taylor.coefficients[0] ?? 0
        const [cx, cy] = worldToScreen(taylor.center, y0)
        ctx.save()
        ctx.fillStyle = "#059669"
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.arc(cx, cy, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }

      if (seriesSubMode === "fourier" && fourier) {
        // Target periodic waveform
        if (fourier.targetCurve.length >= 2) {
          ctx.save()
          ctx.strokeStyle = "rgba(71, 85, 105, 0.65)"
          ctx.lineWidth = 1.8
          ctx.setLineDash([5, 4])
          ctx.beginPath()
          fourier.targetCurve.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.stroke()
          ctx.restore()
        }

        // Partial sum S_N(x)
        if (fourier.approxCurve.length >= 2) {
          ctx.save()
          ctx.strokeStyle = "#2563eb"
          ctx.lineWidth = 2.4
          ctx.beginPath()
          fourier.approxCurve.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.stroke()
          ctx.restore()
        }

        // Optional rotating Epicycles overlay anchored on left side of canvas
        if (showEpicycles) {
          const circles = computeFourierEpicycles(fourier, epicyclePhase)
          const anchorScreenX = Math.min(115, w * 0.2)
          const scaleY = h / (bounds.yMax - bounds.yMin)
          const [, zeroSy] = worldToScreen(0, 0)

          ctx.save()
          for (const c of circles) {
            const sx0 = anchorScreenX + c.centerX * scaleY * 0.55
            const sy0 = zeroSy - c.centerY * scaleY
            const sx1 = anchorScreenX + c.tipX * scaleY * 0.55
            const sy1 = zeroSy - c.tipY * scaleY
            const rPx = c.radius * scaleY * 0.55

            ctx.strokeStyle = "rgba(217, 119, 6, 0.36)"
            ctx.lineWidth = 1.1
            ctx.beginPath()
            ctx.arc(sx0, sy0, Math.max(1, rPx), 0, Math.PI * 2)
            ctx.stroke()

            ctx.strokeStyle = "#d97706"
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(sx0, sy0)
            ctx.lineTo(sx1, sy1)
            ctx.stroke()
          }

          if (circles.length > 0) {
            const last = circles[circles.length - 1]!
            const tipSx = anchorScreenX + last.tipX * scaleY * 0.55
            const tipSy = zeroSy - last.tipY * scaleY
            const [waveSx, waveSy] = worldToScreen(epicyclePhase, last.tipY)

            ctx.strokeStyle = "rgba(5, 150, 105, 0.65)"
            ctx.setLineDash([4, 3])
            ctx.lineWidth = 1.3
            ctx.beginPath()
            ctx.moveTo(tipSx, tipSy)
            ctx.lineTo(waveSx, waveSy)
            ctx.stroke()

            ctx.fillStyle = "#059669"
            ctx.beginPath()
            ctx.arc(waveSx, waveSy, 5, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.restore()
        }
      }
    }

    // Double Integral region, Riemann grid, and live iterated scan slice
    if (mode === "doubleIntegral" && doubleIntegral) {
      // Shaded domain polygon D
      if (doubleIntegral.domainPolygon.length >= 3) {
        ctx.save()
        ctx.beginPath()
        doubleIntegral.domainPolygon.forEach((pt, idx) => {
          const [px, py] = worldToScreen(pt.x, pt.y)
          if (idx === 0) ctx!.moveTo(px, py)
          else ctx!.lineTo(px, py)
        })
        ctx.closePath()
        ctx.fillStyle = "rgba(37, 99, 235, 0.12)"
        ctx.fill()
        ctx.restore()
      }

      // Riemann partition cells
      if (showRiemannGrid && doubleIntegral.cells.length > 0) {
        const maxVal = Math.max(0.5, ...doubleIntegral.cells.map((c) => Math.abs(c.value)))
        ctx.save()
        for (const cell of doubleIntegral.cells) {
          if (cell.polygon.length < 3) continue
          const [r, g, b] = divergingColor(cell.value, maxVal)
          ctx.beginPath()
          cell.polygon.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.closePath()
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.48)`
          ctx.fill()
          ctx.strokeStyle = "rgba(51, 65, 85, 0.28)"
          ctx.lineWidth = 0.9
          ctx.stroke()
        }
        ctx.restore()
      }

      // Crisp domain boundary outline
      if (doubleIntegral.domainPolygon.length >= 3) {
        ctx.save()
        ctx.beginPath()
        doubleIntegral.domainPolygon.forEach((pt, idx) => {
          const [px, py] = worldToScreen(pt.x, pt.y)
          if (idx === 0) ctx!.moveTo(px, py)
          else ctx!.lineTo(px, py)
        })
        ctx.closePath()
        ctx.strokeStyle = "#1e3a8a"
        ctx.lineWidth = 2.4
        ctx.stroke()
        ctx.restore()
      }

      // Animated/interactive scan-line slice illustrating integration order!
      if (doubleIntegral.scanSlice) {
        const [p0, p1] = doubleIntegral.scanSlice.segment
        const [sx0, sy0] = worldToScreen(p0.x, p0.y)
        const [sx1, sy1] = worldToScreen(p1.x, p1.y)

        ctx.save()
        ctx.strokeStyle = "#dc2626"
        ctx.fillStyle = "#dc2626"
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(sx0, sy0)
        ctx.lineTo(sx1, sy1)
        ctx.stroke()

        const dist = Math.hypot(sx1 - sx0, sy1 - sy0)
        if (dist > 8) {
          const ux = (sx1 - sx0) / dist
          const uy = (sy1 - sy0) / dist
          ctx.beginPath()
          ctx.moveTo(sx1, sy1)
          ctx.lineTo(sx1 - ux * 9 - uy * 4.5, sy1 - uy * 9 + ux * 4.5)
          ctx.lineTo(sx1 - ux * 9 + uy * 4.5, sy1 - uy * 9 - ux * 4.5)
          ctx.closePath()
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(sx0, sy0, 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    ctx.restore()
  }, [
    mode,
    bounds,
    size,
    pdeState,
    poissonSolution,
    seriesSubMode,
    taylor,
    showTaylorError,
    fourier,
    showEpicycles,
    epicyclePhase,
    doubleIntegral,
    showRiemannGrid,
    worldToScreen
  ])

  const zoomBy = (factor: number, anchor?: Point2D) => {
    const cx = anchor?.x ?? 0.5 * (bounds.xMin + bounds.xMax)
    const cy = anchor?.y ?? 0.5 * (bounds.yMin + bounds.yMax)
    const nw = (bounds.xMax - bounds.xMin) * factor
    const nh = (bounds.yMax - bounds.yMin) * factor
    if (nw < 0.08 || nw > 200 || nh < 0.08 || nh > 200) return
    const rx = (cx - bounds.xMin) / (bounds.xMax - bounds.xMin)
    const ry = (cy - bounds.yMin) / (bounds.yMax - bounds.yMin)
    onBoundsChange({
      xMin: cx - rx * nw,
      xMax: cx + (1 - rx) * nw,
      yMin: cy - ry * nh,
      yMax: cy + (1 - ry) * nh
    })
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)

    if (mode === "pde" && pdeState && pdeState.kind !== "poisson2d" && !e.shiftKey) {
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
      onInjectPdePulse?.(world.x, world.y)
      dragRef.current = { kind: "pulse" }
      return
    }

    dragRef.current = {
      kind: "pan",
      x0: e.clientX,
      y0: e.clientY,
      b0: bounds
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === "pulse") {
      const rect = e.currentTarget.getBoundingClientRect()
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
      onInjectPdePulse?.(world.x, world.y)
      return
    }

    const dxWorld = -((e.clientX - drag.x0) / Math.max(1, size.width)) * (drag.b0.xMax - drag.b0.xMin)
    const dyWorld = ((e.clientY - drag.y0) / Math.max(1, size.height)) * (drag.b0.yMax - drag.b0.yMin)
    onBoundsChange({
      xMin: drag.b0.xMin + dxWorld,
      xMax: drag.b0.xMax + dxWorld,
      yMin: drag.b0.yMin + dyWorld,
      yMax: drag.b0.yMax + dyWorld
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, screenToWorld(e.clientX - rect.left, e.clientY - rect.top))
  }

  return (
    <div className="calculus-canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="calculus-canvas"
        aria-label={
          mode === "pde"
            ? "偏微分方程数值场画布"
            : mode === "series"
              ? "泰勒与傅里叶级数逼近画布"
              : "二重积分区域与扫描条画布"
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => {
          if (mode !== "pde") onResetView()
        }}
        onWheel={handleWheel}
      />

      <div className="calculus-canvas-legend" aria-hidden="true">
        {mode === "pde" ? (
          <>
            <span><i className="dot max" />正势 / 高温波峰</span>
            <span><i className="dot curve" />负势 / 低温波谷</span>
            {pdeState?.kind !== "poisson2d" && <span>点击画布注入脉冲源</span>}
            {pdeState?.kind === "poisson2d" && <span>等势线 + 电场向量 −∇u</span>}
          </>
        ) : mode === "series" ? (
          seriesSubMode === "taylor" ? (
            <>
              <span><i className="dot curve" />原函数 f(x)</span>
              <span><i className="dot max" />n 阶泰勒多项式 Pn(x)</span>
              <span><i className="dot min" />展开中心 x₀</span>
            </>
          ) : (
            <>
              <span><i className="dot slope" />目标周期波</span>
              <span><i className="dot curve" />傅里叶部分和 SN(x)</span>
              {showEpicycles && <span><i className="dot active-level" />本轮旋转相量</span>}
            </>
          )
        ) : (
          <>
            <span><i className="dot curve" />积分区域 D 边界</span>
            <span><i className="dot max" />积分次序扫描条</span>
            {showRiemannGrid && <span>黎曼分块（色深=函数值）</span>}
          </>
        )}
      </div>

      <div className="calculus-zoom-controls" role="group" aria-label="画布缩放控制">
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="放大画布">＋</button>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="缩小画布">－</button>
        <button type="button" onClick={onResetView} aria-label="重置视野">重置</button>
      </div>
    </div>
  )
}

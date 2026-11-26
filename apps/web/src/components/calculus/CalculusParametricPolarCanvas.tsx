import { useCallback, useEffect, useRef, useState } from "react"

import type {
  ParametricCurveAnalysis,
  PolarCurveAnalysis,
  Point2D,
  ViewportBounds2D
} from "@draw/geometry-kernel"

export interface CalculusParametricPolarCanvasProps {
  subMode: "parametric" | "polar"
  bounds: ViewportBounds2D
  onBoundsChange: (next: ViewportBounds2D) => void
  onResetView: () => void
  parametric: ParametricCurveAnalysis | null
  polar: PolarCurveAnalysis | null
  showTangentVector?: boolean
  showPolarSector?: boolean
}

function niceStep(span: number, target: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const raw = span / Math.max(2, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 5.5 ? 5 : 10
  return step * mag
}

export function CalculusParametricPolarCanvas({
  subMode,
  bounds,
  onBoundsChange,
  onResetView,
  parametric,
  polar,
  showTangentVector = true,
  showPolarSector = true
}: CalculusParametricPolarCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 720, height: 480 })
  const panRef = useRef<{ x0: number; y0: number; b0: ViewportBounds2D } | null>(null)

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

  // Preserve 1:1 aspect ratio so circles/cardioids/cycloids never look squashed!
  const effectiveBounds = (() => {
    const spanX = bounds.xMax - bounds.xMin
    const spanY = bounds.yMax - bounds.yMin
    const aspect = size.width / Math.max(1, size.height)
    const cx = 0.5 * (bounds.xMin + bounds.xMax)
    const cy = 0.5 * (bounds.yMin + bounds.yMax)
    if (spanX / Math.max(1e-6, spanY) < aspect) {
      const nextX = spanY * aspect
      return { xMin: cx - 0.5 * nextX, xMax: cx + 0.5 * nextX, yMin: bounds.yMin, yMax: bounds.yMax }
    }
    const nextY = spanX / aspect
    return { xMin: bounds.xMin, xMax: bounds.xMax, yMin: cy - 0.5 * nextY, yMax: cy + 0.5 * nextY }
  })()

  const worldToScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      ((wx - effectiveBounds.xMin) / (effectiveBounds.xMax - effectiveBounds.xMin)) * size.width,
      ((effectiveBounds.yMax - wy) / (effectiveBounds.yMax - effectiveBounds.yMin)) * size.height
    ],
    [effectiveBounds.xMax, effectiveBounds.xMin, effectiveBounds.yMax, effectiveBounds.yMin, size.height, size.width]
  )

  const screenToWorld = useCallback(
    (sx: number, sy: number): Point2D => ({
      x: effectiveBounds.xMin + (sx / Math.max(1, size.width)) * (effectiveBounds.xMax - effectiveBounds.xMin),
      y: effectiveBounds.yMax - (sy / Math.max(1, size.height)) * (effectiveBounds.yMax - effectiveBounds.yMin)
    }),
    [effectiveBounds.xMax, effectiveBounds.xMin, effectiveBounds.yMax, effectiveBounds.yMin, size.height, size.width]
  )

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = size.width
    const h = size.height
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.save()
    ctx.scale(dpr, dpr)

    ctx.fillStyle = "#fbfcfd"
    ctx.fillRect(0, 0, w, h)

    const [ox, oy] = worldToScreen(0, 0)
    const pxPerUnit = w / Math.max(1e-6, effectiveBounds.xMax - effectiveBounds.xMin)

    if (subMode === "polar") {
      // Polar concentric circles + radial spokes
      const maxR = Math.hypot(
        Math.max(Math.abs(effectiveBounds.xMin), Math.abs(effectiveBounds.xMax)),
        Math.max(Math.abs(effectiveBounds.yMin), Math.abs(effectiveBounds.yMax))
      )
      const rStep = niceStep(maxR, 6)
      ctx.save()
      ctx.strokeStyle = "#e2e8f0"
      ctx.lineWidth = 1
      ctx.fillStyle = "#64748b"
      ctx.font = '11px "Segoe UI", sans-serif'
      for (let r = rStep; r <= maxR + rStep; r += rStep) {
        const radPx = r * pxPerUnit
        ctx.beginPath()
        ctx.arc(ox, oy, radPx, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillText(Number(r.toFixed(2)).toString(), ox + radPx + 4, oy - 4)
      }
      for (let deg = 0; deg < 360; deg += 30) {
        const rad = (deg * Math.PI) / 180
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(ox + Math.cos(rad) * maxR * pxPerUnit, oy - Math.sin(rad) * maxR * pxPerUnit)
        ctx.stroke()
      }
      ctx.restore()
    } else {
      // Cartesian grid
      const step = niceStep(effectiveBounds.xMax - effectiveBounds.xMin, 9)
      ctx.save()
      ctx.strokeStyle = "#e6ebf1"
      ctx.lineWidth = 1
      ctx.fillStyle = "#64748b"
      ctx.font = '11px "Segoe UI", sans-serif'
      const startX = Math.floor(effectiveBounds.xMin / step) * step
      for (let x = startX; x <= effectiveBounds.xMax; x += step) {
        const [sx] = worldToScreen(x, 0)
        ctx.beginPath()
        ctx.moveTo(sx, 0)
        ctx.lineTo(sx, h)
        ctx.stroke()
        if (Math.abs(x) > 1e-6) ctx.fillText(Number(x.toFixed(2)).toString(), sx + 3, Math.min(h - 6, Math.max(14, oy + 13)))
      }
      const startY = Math.floor(effectiveBounds.yMin / step) * step
      for (let y = startY; y <= effectiveBounds.yMax; y += step) {
        const [, sy] = worldToScreen(0, y)
        ctx.beginPath()
        ctx.moveTo(0, sy)
        ctx.lineTo(w, sy)
        ctx.stroke()
        if (Math.abs(y) > 1e-6) ctx.fillText(Number(y.toFixed(2)).toString(), Math.max(6, Math.min(w - 28, ox + 5)), sy - 3)
      }
      ctx.restore()
    }

    // Main axes
    ctx.save()
    ctx.strokeStyle = "#94a3b8"
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(0, oy); ctx.lineTo(w, oy)
    ctx.moveTo(ox, 0); ctx.lineTo(ox, h)
    ctx.stroke()
    ctx.restore()

    if (subMode === "polar" && polar && polar.points.length >= 2) {
      // Shaded polar sector up to activeTheta
      if (showPolarSector) {
        const ratio = Math.max(0, Math.min(1, (polar.activeTheta - polar.thetaRange[0]) / Math.max(1e-6, polar.thetaRange[1] - polar.thetaRange[0])))
        const endIdx = Math.max(1, Math.round(ratio * (polar.points.length - 1)))
        ctx.save()
        ctx.fillStyle = "rgba(37, 99, 235, 0.13)"
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        for (let i = 0; i <= endIdx; i += 1) {
          const [px, py] = worldToScreen(polar.points[i]!.x, polar.points[i]!.y)
          ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      // Full polar curve
      ctx.save()
      ctx.strokeStyle = "#2563eb"
      ctx.lineWidth = 2.4
      ctx.lineJoin = "round"
      ctx.beginPath()
      polar.points.forEach((pt, idx) => {
        const [px, py] = worldToScreen(pt.x, pt.y)
        if (idx === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
      ctx.restore()

      // Radial segment from origin to P(theta)
      if (Number.isFinite(polar.activePoint.x) && Number.isFinite(polar.activePoint.y)) {
        const [px, py] = worldToScreen(polar.activePoint.x, polar.activePoint.y)
        ctx.save()
        ctx.strokeStyle = "#059669"
        ctx.lineWidth = 2
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(px, py)
        ctx.stroke()
        ctx.restore()

        if (showTangentVector) {
          const tLen = Math.hypot(polar.tangentVec.x, polar.tangentVec.y)
          if (tLen > 1e-6) {
            const ux = polar.tangentVec.x / tLen
            const uy = polar.tangentVec.y / tLen
            const arrowPx = 56
            const ex = px + ux * arrowPx
            const ey = py - uy * arrowPx
            ctx.save()
            ctx.strokeStyle = "#dc2626"
            ctx.fillStyle = "#dc2626"
            ctx.lineWidth = 2.4
            ctx.beginPath()
            ctx.moveTo(px, py)
            ctx.lineTo(ex, ey)
            ctx.stroke()
            const ang = Math.atan2(ey - py, ex - px)
            ctx.beginPath()
            ctx.moveTo(ex, ey)
            ctx.lineTo(ex - 9 * Math.cos(ang - 0.42), ey - 9 * Math.sin(ang - 0.42))
            ctx.lineTo(ex - 9 * Math.cos(ang + 0.42), ey - 9 * Math.sin(ang + 0.42))
            ctx.closePath()
            ctx.fill()
            ctx.restore()
          }
        }

        ctx.save()
        ctx.fillStyle = "#ea580c"
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.arc(px, py, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
    } else if (subMode === "parametric" && parametric && parametric.points.length >= 2) {
      // Full curve
      ctx.save()
      ctx.strokeStyle = "#cbd5e1"
      ctx.lineWidth = 2.2
      ctx.beginPath()
      parametric.points.forEach((pt, idx) => {
        const [px, py] = worldToScreen(pt.x, pt.y)
        if (idx === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
      ctx.restore()

      // Traced arc up to activeT
      const ratio = Math.max(0, Math.min(1, (parametric.activeT - parametric.tRange[0]) / Math.max(1e-6, parametric.tRange[1] - parametric.tRange[0])))
      const endIdx = Math.max(1, Math.round(ratio * (parametric.points.length - 1)))
      ctx.save()
      ctx.strokeStyle = "#2563eb"
      ctx.lineWidth = 2.8
      ctx.lineJoin = "round"
      ctx.beginPath()
      for (let i = 0; i <= endIdx; i += 1) {
        const [px, py] = worldToScreen(parametric.points[i]!.x, parametric.points[i]!.y)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.restore()

      if (Number.isFinite(parametric.activePoint.x) && Number.isFinite(parametric.activePoint.y)) {
        const [px, py] = worldToScreen(parametric.activePoint.x, parametric.activePoint.y)
        if (showTangentVector && parametric.speed > 1e-6) {
          const ux = parametric.velocity.x / parametric.speed
          const uy = parametric.velocity.y / parametric.speed
          // Infinite subtle tangent line
          ctx.save()
          ctx.strokeStyle = "rgba(220, 38, 38, 0.35)"
          ctx.lineWidth = 1.4
          ctx.setLineDash([5, 4])
          ctx.beginPath()
          ctx.moveTo(px - ux * 160, py + uy * 160)
          ctx.lineTo(px + ux * 160, py - uy * 160)
          ctx.stroke()
          ctx.restore()

          // Velocity / tangent arrow
          const arrowPx = Math.min(82, Math.max(38, parametric.speed * 26))
          const ex = px + ux * arrowPx
          const ey = py - uy * arrowPx
          ctx.save()
          ctx.strokeStyle = "#dc2626"
          ctx.fillStyle = "#dc2626"
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(ex, ey)
          ctx.stroke()
          const ang = Math.atan2(ey - py, ex - px)
          ctx.beginPath()
          ctx.moveTo(ex, ey)
          ctx.lineTo(ex - 9 * Math.cos(ang - 0.42), ey - 9 * Math.sin(ang - 0.42))
          ctx.lineTo(ex - 9 * Math.cos(ang + 0.42), ey - 9 * Math.sin(ang + 0.42))
          ctx.closePath()
          ctx.fill()
          ctx.restore()
        }

        ctx.save()
        ctx.fillStyle = "#ea580c"
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.arc(px, py, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
    }

    ctx.restore()
  }, [subMode, effectiveBounds, size, parametric, polar, showTangentVector, showPolarSector, worldToScreen])

  return (
    <div className="calculus-canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="calculus-canvas"
        aria-label={subMode === "polar" ? "极坐标曲线画布" : "参数方程曲线画布"}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          panRef.current = { x0: e.clientX, y0: e.clientY, b0: bounds }
        }}
        onPointerMove={(e) => {
          const p = panRef.current
          if (!p) return
          const dxW = -((e.clientX - p.x0) / Math.max(1, size.width)) * (p.b0.xMax - p.b0.xMin)
          const dyW = ((e.clientY - p.y0) / Math.max(1, size.height)) * (p.b0.yMax - p.b0.yMin)
          onBoundsChange({
            xMin: p.b0.xMin + dxW,
            xMax: p.b0.xMax + dxW,
            yMin: p.b0.yMin + dyW,
            yMax: p.b0.yMax + dyW
          })
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
          panRef.current = null
        }}
        onPointerCancel={() => { panRef.current = null }}
        onDoubleClick={onResetView}
        onWheel={(e) => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, screenToWorld(e.clientX - rect.left, e.clientY - rect.top))
        }}
      />

      <div className="calculus-canvas-legend" aria-hidden="true">
        {subMode === "polar" ? (
          <>
            <span><i className="dot curve" />极坐标曲线 r = r(θ)</span>
            <span><i className="dot min" />极径 r(θ₀)</span>
            {showTangentVector && <span><i className="dot max" />切向量</span>}
          </>
        ) : (
          <>
            <span><i className="dot curve" />参数轨线 (x(t), y(t))</span>
            {showTangentVector && <span><i className="dot max" />速度 / 切向量</span>}
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

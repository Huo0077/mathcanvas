import { useCallback, useEffect, useRef, useState } from "react"

import {
  applyMatrix2x2,
  type CltSimulationResult,
  type DistributionAnalysis,
  type LinearTransform2DAnalysis,
  type Point2D,
  type ViewportBounds2D
} from "@draw/geometry-kernel"

export interface CalculusPhase4CanvasProps {
  mode: "linalg" | "probability"
  bounds: ViewportBounds2D
  onBoundsChange: (next: ViewportBounds2D) => void
  onResetView: () => void
  // Linear algebra props
  linalg?: LinearTransform2DAnalysis | null
  showEigenvectors?: boolean
  showSvdCircle?: boolean
  // Probability props
  probSubMode?: "dist" | "clt"
  distribution?: DistributionAnalysis | null
  showCdf?: boolean
  clt?: CltSimulationResult | null
}

function niceStep(span: number, target: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  const raw = span / Math.max(2, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 5.5 ? 5 : 10
  return step * mag
}

function drawVecArrow(
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
  const head = Math.min(11, Math.max(7, len * 0.24))

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2.6
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1 - ux * head * 0.65, y1 - uy * head * 0.65)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - ux * head - uy * head * 0.45, y1 - uy * head + ux * head * 0.45)
  ctx.lineTo(x1 - ux * head + uy * head * 0.45, y1 - uy * head - ux * head * 0.45)
  ctx.closePath()
  ctx.fill()

  ctx.font = '600 13px "Cambria Math", Cambria, Georgia, serif'
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const lx = x1 + ux * 14
  const ly = y1 + uy * 14
  const tw = ctx.measureText(label).width
  ctx.fillStyle = "rgba(255,255,255,0.88)"
  ctx.fillRect(lx - tw / 2 - 3, ly - 8, tw + 6, 16)
  ctx.fillStyle = color
  ctx.fillText(label, lx, ly)
  ctx.restore()
}

export function CalculusPhase4Canvas({
  mode,
  bounds,
  onBoundsChange,
  onResetView,
  linalg,
  showEigenvectors = true,
  showSvdCircle = true,
  probSubMode = "dist",
  distribution,
  showCdf = false,
  clt
}: CalculusPhase4CanvasProps) {
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

    // Base coordinate grid
    const xStep = niceStep(bounds.xMax - bounds.xMin, Math.max(4, Math.floor(w / 95)))
    const yStep = niceStep(bounds.yMax - bounds.yMin, Math.max(4, Math.floor(h / 75)))

    ctx.strokeStyle = "#eef2f7"
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

    const [axisX, axisY] = worldToScreen(0, 0)
    const cxAxis = Math.max(28, Math.min(w - 18, axisX))
    const cyAxis = Math.max(18, Math.min(h - 24, axisY))

    ctx.strokeStyle = "#94a3b8"
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

    // ======================================================================
    // Linear Algebra 2x2 Geometric Transformation & SVD / Eigenvectors
    // ======================================================================
    if (mode === "linalg" && linalg) {
      const M = linalg.interpolatedMatrix

      // 1. Deformed integer lattice grid under M(t)
      ctx.save()
      ctx.strokeStyle = "rgba(59, 130, 246, 0.26)"
      ctx.lineWidth = 1.15
      ctx.beginPath()
      for (let k = -8; k <= 8; k += 1) {
        const a0 = applyMatrix2x2(M, k, -8)
        const a1 = applyMatrix2x2(M, k, 8)
        const [sx0, sy0] = worldToScreen(a0.x, a0.y)
        const [sx1, sy1] = worldToScreen(a1.x, a1.y)
        ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1)

        const b0 = applyMatrix2x2(M, -8, k)
        const b1 = applyMatrix2x2(M, 8, k)
        const [tx0, ty0] = worldToScreen(b0.x, b0.y)
        const [tx1, ty1] = worldToScreen(b1.x, b1.y)
        ctx.moveTo(tx0, ty0); ctx.lineTo(tx1, ty1)
      }
      ctx.stroke()
      ctx.restore()

      // 2. Oriented unit parallelogram (green if det >= 0, rose if orientation flipped)
      const poly = linalg.unitParallelogram
      ctx.save()
      ctx.beginPath()
      poly.forEach((pt, idx) => {
        const [px, py] = worldToScreen(pt.x, pt.y)
        if (idx === 0) ctx!.moveTo(px, py)
        else ctx!.lineTo(px, py)
      })
      ctx.closePath()
      ctx.fillStyle = linalg.interpolatedDet >= -1e-6
        ? "rgba(16, 185, 129, 0.16)"
        : "rgba(225, 29, 72, 0.16)"
      ctx.fill()
      ctx.strokeStyle = linalg.interpolatedDet >= -1e-6
        ? "rgba(5, 150, 105, 0.55)"
        : "rgba(190, 18, 60, 0.55)"
      ctx.lineWidth = 1.4
      ctx.stroke()
      ctx.restore()

      // 3. Optional Unit Circle -> SVD Ellipse + singular semi-axes
      if (showSvdCircle) {
        // Original unit circle (dashed slate)
        ctx.save()
        ctx.strokeStyle = "rgba(100, 116, 139, 0.45)"
        ctx.lineWidth = 1.2
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        for (let i = 0; i <= 64; i += 1) {
          const ang = (i / 64) * Math.PI * 2
          const [px, py] = worldToScreen(Math.cos(ang), Math.sin(ang))
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.stroke()
        ctx.restore()

        // Transformed SVD ellipse
        ctx.save()
        ctx.strokeStyle = "#d97706"
        ctx.lineWidth = 2.2
        ctx.beginPath()
        linalg.transformedCircle.forEach((pt, idx) => {
          const [px, py] = worldToScreen(pt.x, pt.y)
          if (idx === 0) ctx!.moveTo(px, py)
          else ctx!.lineTo(px, py)
        })
        ctx.stroke()
        ctx.restore()

        // SVD principal semi-axes at t = 1
        if (linalg.progress > 0.96) {
          const [ox, oy] = worldToScreen(0, 0)
          const [u1x, u1y] = worldToScreen(
            linalg.svd.u1.x * linalg.svd.sigma1,
            linalg.svd.u1.y * linalg.svd.sigma1
          )
          drawVecArrow(ctx, ox, oy, u1x, u1y, "#b45309", "σ₁u₁")
          if (linalg.svd.sigma2 > 1e-4) {
            const [u2x, u2y] = worldToScreen(
              linalg.svd.u2.x * linalg.svd.sigma2,
              linalg.svd.u2.y * linalg.svd.sigma2
            )
            drawVecArrow(ctx, ox, oy, u2x, u2y, "#d97706", "σ₂u₂")
          }
        }
      }

      // 4. Invariant real eigenvector lines + stretched eigenvectors
      if (showEigenvectors && linalg.realEigenvectors.length > 0) {
        const [ox, oy] = worldToScreen(0, 0)
        linalg.realEigenvectors.forEach((ev, idx) => {
          const spanR = 12
          const [lx0, ly0] = worldToScreen(-ev.unitVector.x * spanR, -ev.unitVector.y * spanR)
          const [lx1, ly1] = worldToScreen(ev.unitVector.x * spanR, ev.unitVector.y * spanR)

          ctx!.save()
          ctx!.strokeStyle = "rgba(124, 58, 237, 0.55)"
          ctx!.lineWidth = 1.6
          ctx!.setLineDash([6, 4])
          ctx!.beginPath()
          ctx!.moveTo(lx0, ly0)
          ctx!.lineTo(lx1, ly1)
          ctx!.stroke()
          ctx!.restore()

          const curTip = applyMatrix2x2(M, ev.unitVector.x, ev.unitVector.y)
          const [tx, ty] = worldToScreen(curTip.x, curTip.y)
          drawVecArrow(ctx!, ox, oy, tx, ty, "#7c3aed", `v${idx + 1}`)
        })
      }

      // 5. Transformed basis vectors i' and j'
      const [ox, oy] = worldToScreen(0, 0)
      const [ix, iy] = worldToScreen(linalg.basisI.x, linalg.basisI.y)
      const [jx, jy] = worldToScreen(linalg.basisJ.x, linalg.basisJ.y)
      drawVecArrow(ctx, ox, oy, ix, iy, "#dc2626", "î'")
      drawVecArrow(ctx, ox, oy, jx, jy, "#059669", "ĵ'")
    }

    // ======================================================================
    // Probability Distributions & Central Limit Theorem
    // ======================================================================
    if (mode === "probability") {
      if (probSubMode === "dist" && distribution) {
        if (distribution.isDiscrete) {
          const [, zeroY] = worldToScreen(0, 0)
          for (const bar of distribution.discreteBars) {
            const [bx, by] = worldToScreen(bar.k, bar.prob)
            const [bxNext] = worldToScreen(bar.k + 0.64, 0)
            const barW = Math.max(4, Math.min(26, Math.abs(bxNext - bx)))
            ctx.save()
            ctx.fillStyle = bar.inInterval ? "rgba(5, 150, 105, 0.78)" : "rgba(37, 99, 235, 0.42)"
            ctx.strokeStyle = bar.inInterval ? "#047857" : "#1d4ed8"
            ctx.lineWidth = 1.2
            ctx.fillRect(bx - barW / 2, Math.min(by, zeroY), barW, Math.abs(zeroY - by))
            ctx.strokeRect(bx - barW / 2, Math.min(by, zeroY), barW, Math.abs(zeroY - by))
            ctx.restore()
          }
        } else {
          // Shaded probability region [a, b]
          if (distribution.shadedPolygon.length >= 3) {
            ctx.save()
            ctx.beginPath()
            distribution.shadedPolygon.forEach((pt, idx) => {
              const [px, py] = worldToScreen(pt.x, pt.y)
              if (idx === 0) ctx!.moveTo(px, py)
              else ctx!.lineTo(px, py)
            })
            ctx.closePath()
            ctx.fillStyle = "rgba(5, 150, 105, 0.24)"
            ctx.fill()
            ctx.restore()
          }

          // PDF curve
          if (distribution.pdfCurve.length >= 2) {
            ctx.save()
            ctx.strokeStyle = "#2563eb"
            ctx.lineWidth = 2.6
            ctx.beginPath()
            distribution.pdfCurve.forEach((pt, idx) => {
              const [px, py] = worldToScreen(pt.x, pt.y)
              if (idx === 0) ctx!.moveTo(px, py)
              else ctx!.lineTo(px, py)
            })
            ctx.stroke()
            ctx.restore()
          }
        }

        // Optional CDF curve (scaled onto current y-axis or natural [0, 1])
        if (showCdf && distribution.cdfCurve.length >= 2) {
          ctx.save()
          ctx.strokeStyle = "#d97706"
          ctx.lineWidth = 2
          ctx.setLineDash([6, 4])
          ctx.beginPath()
          distribution.cdfCurve.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y * bounds.yMax * 0.82)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.stroke()
          ctx.restore()
        }
      }

      if (probSubMode === "clt" && clt) {
        const [, zeroY] = worldToScreen(0, 0)
        // Histogram density bars
        ctx.save()
        for (const bin of clt.bins) {
          const [x0, yTop] = worldToScreen(bin.xLeft, bin.density)
          const [x1] = worldToScreen(bin.xRight, 0)
          const bw = Math.max(1, x1 - x0 - 1)
          ctx.fillStyle = "rgba(59, 130, 246, 0.34)"
          ctx.strokeStyle = "rgba(37, 99, 235, 0.72)"
          ctx.lineWidth = 1
          ctx.fillRect(x0 + 0.5, Math.min(yTop, zeroY), bw, Math.abs(zeroY - yTop))
          ctx.strokeRect(x0 + 0.5, Math.min(yTop, zeroY), bw, Math.abs(zeroY - yTop))
        }
        ctx.restore()

        // Overlaid theoretical Gaussian curve N(mu, sigma^2 / n)
        if (clt.normalOverlay.length >= 2) {
          ctx.save()
          ctx.strokeStyle = "#dc2626"
          ctx.lineWidth = 2.6
          ctx.beginPath()
          clt.normalOverlay.forEach((pt, idx) => {
            const [px, py] = worldToScreen(pt.x, pt.y)
            if (idx === 0) ctx!.moveTo(px, py)
            else ctx!.lineTo(px, py)
          })
          ctx.stroke()
          ctx.restore()
        }
      }
    }

    ctx.restore()
  }, [
    mode,
    bounds,
    size,
    linalg,
    showEigenvectors,
    showSvdCircle,
    probSubMode,
    distribution,
    showCdf,
    clt,
    worldToScreen
  ])

  const zoomBy = (factor: number, anchor?: Point2D) => {
    const cx = anchor?.x ?? 0.5 * (bounds.xMin + bounds.xMax)
    const cy = anchor?.y ?? 0.5 * (bounds.yMin + bounds.yMax)
    const nw = (bounds.xMax - bounds.xMin) * factor
    const nh = (bounds.yMax - bounds.yMin) * factor
    if (nw < 0.05 || nw > 200 || nh < 0.05 || nh > 200) return
    const rx = (cx - bounds.xMin) / (bounds.xMax - bounds.xMin)
    const ry = (cy - bounds.yMin) / (bounds.yMax - bounds.yMin)
    onBoundsChange({
      xMin: cx - rx * nw,
      xMax: cx + (1 - rx) * nw,
      yMin: cy - ry * nh,
      yMax: cy + (1 - ry) * nh
    })
  }

  return (
    <div className="calculus-canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="calculus-canvas"
        aria-label={mode === "linalg" ? "线性代数矩阵几何变换画布" : "概率分布与中心极限定理画布"}
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
        {mode === "linalg" ? (
          <>
            <span><i className="dot max" />基向量 î&apos;</span>
            <span><i className="dot min" />基向量 ĵ&apos;</span>
            {showEigenvectors && <span><i className="dot saddle" />特征向量不变直线</span>}
            {showSvdCircle && <span><i className="dot active-level" />SVD 变换椭圆</span>}
          </>
        ) : probSubMode === "dist" ? (
          <>
            <span><i className="dot curve" />密度 / 质量函数</span>
            <span><i className="dot min" />区间概率 P(a ≤ X ≤ b)</span>
            {showCdf && <span><i className="dot active-level" />累积分布 CDF</span>}
          </>
        ) : (
          <>
            <span><i className="dot curve" />样本均值经验直方图</span>
            <span><i className="dot max" />理论极限正态曲线 N(μ, σ²/n)</span>
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

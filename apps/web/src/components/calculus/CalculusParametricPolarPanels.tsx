import {
  PARAMETRIC_CURVE_PRESETS,
  POLAR_CURVE_PRESETS,
  type ParametricCurveAnalysis,
  type ParametricCurvePreset,
  type PolarCurveAnalysis,
  type PolarCurvePreset
} from "@draw/geometry-kernel"

import { MathFormulaInput } from "./MathFormulaInput"

function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—"
  const clean = Math.abs(v) < 1e-7 ? 0 : v
  return Number(clean.toFixed(digits)).toString()
}

export interface ParametricPolarLeftProps {
  subMode: "parametric" | "polar"
  onSubModeChange: (next: "parametric" | "polar") => void
  paramXExpr: string
  onParamXExprChange: (v: string) => void
  paramYExpr: string
  onParamYExprChange: (v: string) => void
  paramTMin: string
  onParamTMinChange: (v: string) => void
  paramTMax: string
  onParamTMaxChange: (v: string) => void
  paramActiveT: number
  onParamActiveTChange: (v: number) => void
  paramTBounds: [number, number]
  paramPlaying: boolean
  onToggleParamPlay: () => void
  polarRExpr: string
  onPolarRExprChange: (v: string) => void
  polarThetaMin: string
  onPolarThetaMinChange: (v: string) => void
  polarThetaMax: string
  onPolarThetaMaxChange: (v: string) => void
  polarActiveTheta: number
  onPolarActiveThetaChange: (v: number) => void
  polarThetaBounds: [number, number]
  showTangentVector: boolean
  onShowTangentVectorChange: (v: boolean) => void
  showPolarSector: boolean
  onShowPolarSectorChange: (v: boolean) => void
  onApplyParamPreset: (preset: ParametricCurvePreset) => void
  onApplyPolarPreset: (preset: PolarCurvePreset) => void
}

export function ParametricPolarLeftControls(props: ParametricPolarLeftProps) {
  return (
    <>
      <section className="calculus-card">
        <h2>曲线方程类型</h2>
        <div className="calculus-segmented" role="group" aria-label="参数方程与极坐标切换">
          <button
            type="button"
            aria-pressed={props.subMode === "parametric"}
            onClick={() => props.onSubModeChange("parametric")}
          >
            参数方程 (x(t), y(t))
          </button>
          <button
            type="button"
            aria-pressed={props.subMode === "polar"}
            onClick={() => props.onSubModeChange("polar")}
          >
            极坐标 r = r(θ)
          </button>
        </div>

        {props.subMode === "parametric" ? (
          <>
            <MathFormulaInput
              label="横坐标 x(t)"
              prefix="x(t) ="
              value={props.paramXExpr}
              onChange={props.onParamXExprChange}
              placeholder="例如：t - sin(t)"
            />
            <MathFormulaInput
              label="纵坐标 y(t)"
              prefix="y(t) ="
              value={props.paramYExpr}
              onChange={props.onParamYExprChange}
              placeholder="例如：1 - cos(t)"
            />
            <div className="calculus-domain-row">
              <label className="calculus-field">
                <span>参数起点 t₁</span>
                <input
                  type="number"
                  step="0.5"
                  value={props.paramTMin}
                  onChange={(e) => props.onParamTMinChange(e.target.value)}
                />
              </label>
              <label className="calculus-field">
                <span>参数终点 t₂</span>
                <input
                  type="number"
                  step="0.5"
                  value={props.paramTMax}
                  onChange={(e) => props.onParamTMaxChange(e.target.value)}
                />
              </label>
            </div>
            <label className="calculus-slider-field">
              <span className="calculus-slider-head">
                <span>动点参数 t₀</span>
                <output>{fmt(props.paramActiveT, 3)}</output>
              </span>
              <input
                type="range"
                min={props.paramTBounds[0]}
                max={props.paramTBounds[1]}
                step={(props.paramTBounds[1] - props.paramTBounds[0]) / 200}
                value={Math.max(props.paramTBounds[0], Math.min(props.paramTBounds[1], props.paramActiveT))}
                onChange={(e) => props.onParamActiveTChange(Number(e.target.value))}
              />
            </label>
            <div className="calculus-inline-actions">
              <button
                type="button"
                className={`calculus-chip-btn${props.paramPlaying ? " primary" : ""}`}
                onClick={props.onToggleParamPlay}
              >
                {props.paramPlaying ? "暂停轨迹动画" : "▶ 播放动点轨迹"}
              </button>
            </div>
          </>
        ) : (
          <>
            <MathFormulaInput
              label="极径函数 r(θ)"
              prefix="r(θ) ="
              value={props.polarRExpr}
              onChange={props.onPolarRExprChange}
              placeholder="例如：1 + cos(theta)"
            />
            <div className="calculus-domain-row">
              <label className="calculus-field">
                <span>起始角 θ₁</span>
                <input
                  type="number"
                  step="0.5"
                  value={props.polarThetaMin}
                  onChange={(e) => props.onPolarThetaMinChange(e.target.value)}
                />
              </label>
              <label className="calculus-field">
                <span>终止角 θ₂</span>
                <input
                  type="number"
                  step="0.5"
                  value={props.polarThetaMax}
                  onChange={(e) => props.onPolarThetaMaxChange(e.target.value)}
                />
              </label>
            </div>
            <label className="calculus-slider-field">
              <span className="calculus-slider-head">
                <span>扫描极角 θ₀</span>
                <output>{fmt(props.polarActiveTheta, 3)} rad</output>
              </span>
              <input
                type="range"
                min={props.polarThetaBounds[0]}
                max={props.polarThetaBounds[1]}
                step={(props.polarThetaBounds[1] - props.polarThetaBounds[0]) / 200}
                value={Math.max(props.polarThetaBounds[0], Math.min(props.polarThetaBounds[1], props.polarActiveTheta))}
                onChange={(e) => props.onPolarActiveThetaChange(Number(e.target.value))}
              />
            </label>
            <div className="calculus-inline-actions">
              <button
                type="button"
                className={`calculus-chip-btn${props.paramPlaying ? " primary" : ""}`}
                onClick={props.onToggleParamPlay}
              >
                {props.paramPlaying ? "暂停扫描动画" : "▶ 播放极角扫描"}
              </button>
            </div>
          </>
        )}

        <div className="calculus-checks">
          <label className="calculus-check">
            <input
              type="checkbox"
              checked={props.showTangentVector}
              onChange={(e) => props.onShowTangentVectorChange(e.target.checked)}
            />
            <span>显示当前点切向量与切线</span>
          </label>
          {props.subMode === "polar" && (
            <label className="calculus-check">
              <input
                type="checkbox"
                checked={props.showPolarSector}
                onChange={(e) => props.onShowPolarSectorChange(e.target.checked)}
              />
              <span>填充极坐标扇形扫过面积</span>
            </label>
          )}
        </div>
      </section>

      <section className="calculus-card">
        <h2>{props.subMode === "parametric" ? "高数经典参数方程预设" : "高数经典极坐标预设"}</h2>
        <div className="calculus-preset-list">
          {props.subMode === "parametric"
            ? PARAMETRIC_CURVE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="calculus-preset-btn"
                  data-active={props.paramXExpr === p.xExpr && props.paramYExpr === p.yExpr}
                  onClick={() => props.onApplyParamPreset(p)}
                >
                  <span className="calculus-preset-top">
                    <strong>{p.title}</strong>
                    <small>{p.courseTag}</small>
                  </span>
                  <code>x={p.xExpr} ｜ y={p.yExpr}</code>
                </button>
              ))
            : POLAR_CURVE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="calculus-preset-btn"
                  data-active={props.polarRExpr === p.rExpr}
                  onClick={() => props.onApplyPolarPreset(p)}
                >
                  <span className="calculus-preset-top">
                    <strong>{p.title}</strong>
                    <small>{p.courseTag}</small>
                  </span>
                  <code>r(θ) = {p.rExpr}</code>
                </button>
              ))}
        </div>
      </section>
    </>
  )
}

export interface ParametricPolarDiagnosticsProps {
  subMode: "parametric" | "polar"
  parametric: ParametricCurveAnalysis | null
  polar: PolarCurveAnalysis | null
}

export function ParametricPolarRightDiagnostics({
  subMode,
  parametric,
  polar
}: ParametricPolarDiagnosticsProps) {
  if (subMode === "parametric" && parametric) {
    return (
      <>
        <section className="calculus-card">
          <h2>参数曲线弧长与瞬时几何量</h2>
          <div className="calculus-metric-pair">
            <div className="calculus-metric min">
              <span className="metric-label">区间总弧长 L</span>
              <strong>{fmt(parametric.arcLength, 5)}</strong>
              <small>∫√(x&apos;² + y&apos;²) dt</small>
            </div>
            <div className="calculus-metric">
              <span className="metric-label">切线斜率 dy/dx</span>
              <strong>{fmt(parametric.dyDx, 4)}</strong>
              <small>速率 |v| = {fmt(parametric.speed, 3)}</small>
            </div>
          </div>
        </section>

        <section className="calculus-card">
          <h2>动点 P(t₀ = {fmt(parametric.activeT, 3)}) 微分属性</h2>
          <dl className="calculus-dl">
            <div><dt>当前坐标 (x, y)</dt><dd>({fmt(parametric.activePoint.x, 3)}, {fmt(parametric.activePoint.y, 3)})</dd></div>
            <div><dt>切向量 (x&apos;, y&apos;)</dt><dd>({fmt(parametric.velocity.x, 3)}, {fmt(parametric.velocity.y, 3)})</dd></div>
            <div><dt>二阶导 d²y/dx²</dt><dd>{fmt(parametric.d2yDx2, 4)}</dd></div>
            <div><dt>曲率 κ(t₀)</dt><dd>{fmt(parametric.curvature, 4)}</dd></div>
          </dl>
        </section>

        <section className="calculus-card calculus-tip-card">
          <h2>参数方程求导与弧长公式</h2>
          <p className="calculus-formula-callout">dy/dx = y&apos;(t) / x&apos;(t) · d²y/dx² = (x&apos;y&apos;&apos; − y&apos;x&apos;&apos;) / (x&apos;)³</p>
        </section>
      </>
    )
  }

  if (subMode === "polar" && polar) {
    return (
      <>
        <section className="calculus-card">
          <h2>极坐标面积与弧长（高数上核心）</h2>
          <div className="calculus-metric-pair">
            <div className="calculus-metric min">
              <span className="metric-label">极坐标面积 S</span>
              <strong>{fmt(polar.sectorArea, 5)}</strong>
              <small>½ ∫ r(θ)² dθ</small>
            </div>
            <div className="calculus-metric">
              <span className="metric-label">极坐标弧长 L</span>
              <strong>{fmt(polar.arcLength, 5)}</strong>
              <small>∫ √(r² + r&apos;²) dθ</small>
            </div>
          </div>
        </section>

        <section className="calculus-card">
          <h2>当前极角 θ₀ = {fmt(polar.activeTheta, 3)} rad 读数</h2>
          <dl className="calculus-dl">
            <div><dt>极径 r(θ₀)</dt><dd>{fmt(polar.activeR, 4)}</dd></div>
            <div><dt>变化率 r&apos;(θ₀)</dt><dd>{fmt(polar.activeDR, 4)}</dd></div>
            <div><dt>直角坐标 x</dt><dd>{fmt(polar.activePoint.x, 4)}</dd></div>
            <div><dt>直角坐标 y</dt><dd>{fmt(polar.activePoint.y, 4)}</dd></div>
          </dl>
        </section>

        <section className="calculus-card calculus-tip-card">
          <h2>极坐标微元公式速记</h2>
          <p className="calculus-formula-callout">dS = ½ r²(θ) dθ · ds = √(r² + (r&apos;)²) dθ</p>
        </section>
      </>
    )
  }

  return null
}

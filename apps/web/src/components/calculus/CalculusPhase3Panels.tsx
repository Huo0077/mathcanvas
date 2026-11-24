import {
  DOUBLE_INTEGRAL_PRESETS,
  FOURIER_PRESETS,
  PDE_PRESETS,
  TAYLOR_PRESETS,
  type DoubleIntegralAnalysis,
  type DoubleIntegralOrder,
  type DoubleIntegralPreset,
  type FourierAnalysis,
  type FourierPreset,
  type FourierWaveformKind,
  type PdeBoundaryCondition,
  type PdeKind,
  type PdePreset,
  type PdeSimulationState,
  type PoissonSolution,
  type TaylorAnalysis,
  type TaylorPreset
} from "@draw/geometry-kernel"

function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—"
  const clean = Math.abs(v) < 1e-7 ? 0 : v
  return Number(clean.toFixed(digits)).toString()
}

export interface Phase3ControlsProps {
  activeModule: "pde" | "series" | "doubleIntegral"
  // PDE
  pdeKind: PdeKind
  onPdeKindChange: (kind: PdeKind) => void
  pdeInitExpr: string
  onPdeInitExprChange: (val: string) => void
  pdeBoundaryExpr: string
  onPdeBoundaryExprChange: (val: string) => void
  pdeBoundary: PdeBoundaryCondition
  onPdeBoundaryChange: (b: PdeBoundaryCondition) => void
  pdeParam: number
  onPdeParamChange: (v: number) => void
  pdeView3D: boolean
  onPdeView3DChange: (v: boolean) => void
  pdePlaying: boolean
  onPdeTogglePlay: () => void
  onPdeStepOnce: () => void
  onPdeReset: () => void
  pdeError: string | null
  onApplyPdePreset: (preset: PdePreset) => void
  // Series
  seriesSubMode: "taylor" | "fourier"
  onSeriesSubModeChange: (m: "taylor" | "fourier") => void
  taylorExpr: string
  onTaylorExprChange: (v: string) => void
  taylorCenter: number
  onTaylorCenterChange: (v: number) => void
  taylorOrder: number
  onTaylorOrderChange: (v: number) => void
  showTaylorError: boolean
  onShowTaylorErrorChange: (v: boolean) => void
  taylorError: string | null
  onApplyTaylorPreset: (p: TaylorPreset) => void
  fourierWaveform: FourierWaveformKind
  onFourierWaveformChange: (w: FourierWaveformKind) => void
  fourierCustomExpr: string
  onFourierCustomExprChange: (v: string) => void
  fourierHarmonics: number
  onFourierHarmonicsChange: (n: number) => void
  showEpicycles: boolean
  onShowEpicyclesChange: (v: boolean) => void
  epicyclePhase: number
  onEpicyclePhaseChange: (v: number) => void
  epicyclePlaying: boolean
  onToggleEpicyclePlay: () => void
  fourierError: string | null
  onApplyFourierPreset: (p: FourierPreset) => void
  // Double Integral
  diIntegrand: string
  onDiIntegrandChange: (v: string) => void
  diOrder: DoubleIntegralOrder
  onDiOrderChange: (o: DoubleIntegralOrder) => void
  diOuterMin: string
  onDiOuterMinChange: (v: string) => void
  diOuterMax: string
  onDiOuterMaxChange: (v: string) => void
  diInnerMin: string
  onDiInnerMinChange: (v: string) => void
  diInnerMax: string
  onDiInnerMaxChange: (v: string) => void
  diPartitions: number
  onDiPartitionsChange: (n: number) => void
  diScanRatio: number
  onDiScanRatioChange: (r: number) => void
  showRiemannGrid: boolean
  onShowRiemannGridChange: (v: boolean) => void
  activeSwapTwin: DoubleIntegralPreset["swappedTwin"] | null
  onSwapOrderTwin: () => void
  diError: string | null
  onApplyDiPreset: (p: DoubleIntegralPreset) => void
}

export function Phase3LeftControls(props: Phase3ControlsProps) {
  if (props.activeModule === "pde") {
    return (
      <>
        <section className="calculus-card">
          <h2>偏微分方程类型与参数</h2>
          <div className="calculus-view-toggle" role="group" aria-label="PDE 方程类型">
            <button type="button" aria-pressed={props.pdeKind === "heat2d"} onClick={() => props.onPdeKindChange("heat2d")}>热传导</button>
            <button type="button" aria-pressed={props.pdeKind === "wave2d"} onClick={() => props.onPdeKindChange("wave2d")}>波动方程</button>
            <button type="button" aria-pressed={props.pdeKind === "poisson2d"} onClick={() => props.onPdeKindChange("poisson2d")}>泊松/拉普拉斯</button>
          </div>

          <label className="calculus-field">
            <span>{props.pdeKind === "poisson2d" ? "源项分布 ρ(x, y)" : "初值分布 u₀(x, y)"}</span>
            <input
              type="text"
              value={props.pdeInitExpr}
              onChange={(e) => props.onPdeInitExprChange(e.target.value)}
              spellCheck={false}
            />
          </label>

          {props.pdeKind === "poisson2d" ? (
            <label className="calculus-field">
              <span>边界电势/温度 u_b(x, y)</span>
              <input
                type="text"
                value={props.pdeBoundaryExpr}
                onChange={(e) => props.onPdeBoundaryExprChange(e.target.value)}
                spellCheck={false}
              />
            </label>
          ) : (
            <>
              <label className="calculus-slider-field">
                <span className="calculus-slider-head">
                  <span>{props.pdeKind === "heat2d" ? "热扩散率 α" : "波速 c"}</span>
                  <output>{fmt(props.pdeParam, 2)}</output>
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={2.2}
                  step={0.05}
                  value={props.pdeParam}
                  onChange={(e) => props.onPdeParamChange(Number(e.target.value))}
                />
              </label>

              <div className="calculus-view-toggle two-col" role="group" aria-label="边界条件">
                <button type="button" aria-pressed={props.pdeBoundary === "dirichlet"} onClick={() => props.onPdeBoundaryChange("dirichlet")}>
                  Dirichlet 零边值
                </button>
                <button type="button" aria-pressed={props.pdeBoundary === "neumann"} onClick={() => props.onPdeBoundaryChange("neumann")}>
                  Neumann 绝热
                </button>
              </div>

              <div className="calculus-inline-actions">
                <button type="button" className="calculus-chip-btn primary" onClick={props.onPdeTogglePlay}>
                  {props.pdePlaying ? "⏸ 暂停演化" : "▶ 播放演化"}
                </button>
                <button type="button" className="calculus-chip-btn" onClick={props.onPdeStepOnce}>
                  单步推进
                </button>
                <button type="button" className="calculus-chip-btn" onClick={props.onPdeReset}>
                  重置初值
                </button>
              </div>
            </>
          )}

          <div className="calculus-view-toggle two-col" role="group" aria-label="PDE 视口维度">
            <button type="button" aria-pressed={!props.pdeView3D} onClick={() => props.onPdeView3DChange(false)}>2D 场热力图</button>
            <button type="button" aria-pressed={props.pdeView3D} onClick={() => props.onPdeView3DChange(true)}>3D 动态曲面</button>
          </div>

          {props.pdeError && <p className="calculus-error" role="alert">{props.pdeError}</p>}
        </section>

        <section className="calculus-card">
          <h2>数理方程 / 大学物理预设</h2>
          <div className="calculus-preset-list">
            {PDE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="calculus-preset-btn"
                data-active={props.pdeKind === p.kind && props.pdeInitExpr === p.initialExpr}
                onClick={() => props.onApplyPdePreset(p)}
              >
                <span className="calculus-preset-top">
                  <strong>{p.title}</strong>
                  <small>{p.courseTag}</small>
                </span>
                <code>{p.initialExpr}</code>
              </button>
            ))}
          </div>
        </section>
      </>
    )
  }

  if (props.activeModule === "series") {
    return (
      <>
        <section className="calculus-card">
          <h2>级数展开模式</h2>
          <div className="calculus-view-toggle two-col" role="group" aria-label="级数子模块">
            <button type="button" aria-pressed={props.seriesSubMode === "taylor"} onClick={() => props.onSeriesSubModeChange("taylor")}>
              泰勒级数 Pn(x)
            </button>
            <button type="button" aria-pressed={props.seriesSubMode === "fourier"} onClick={() => props.onSeriesSubModeChange("fourier")}>
              傅里叶级数 SN(x)
            </button>
          </div>

          {props.seriesSubMode === "taylor" ? (
            <>
              <label className="calculus-field">
                <span>目标函数 f(x)</span>
                <input
                  type="text"
                  value={props.taylorExpr}
                  onChange={(e) => props.onTaylorExprChange(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="calculus-field">
                <span>展开中心点 x₀</span>
                <input
                  type="number"
                  step="0.2"
                  value={props.taylorCenter}
                  onChange={(e) => props.onTaylorCenterChange(Number(e.target.value))}
                />
              </label>
              <label className="calculus-slider-field">
                <span className="calculus-slider-head">
                  <span>泰勒展开阶数 n</span>
                  <output>{props.taylorOrder} 阶</output>
                </span>
                <input
                  type="range"
                  min={0}
                  max={18}
                  step={1}
                  value={props.taylorOrder}
                  onChange={(e) => props.onTaylorOrderChange(Number(e.target.value))}
                />
              </label>
              <label className="calculus-check">
                <input
                  type="checkbox"
                  checked={props.showTaylorError}
                  onChange={(e) => props.onShowTaylorErrorChange(e.target.checked)}
                />
                <span>叠加余项误差曲线 |f(x) − Pn(x)|</span>
              </label>
              {props.taylorError && <p className="calculus-error" role="alert">{props.taylorError}</p>}
            </>
          ) : (
            <>
              <label className="calculus-field">
                <span>典型周期信号波形</span>
                <select
                  className="calculus-select"
                  value={props.fourierWaveform}
                  onChange={(e) => props.onFourierWaveformChange(e.target.value as FourierWaveformKind)}
                >
                  <option value="square">周期方波（吉布斯现象）</option>
                  <option value="sawtooth">周期锯齿波</option>
                  <option value="triangle">周期三角波</option>
                  <option value="full_rectified">全波整流正弦</option>
                  <option value="half_rectified">半波整流正弦</option>
                  <option value="custom">自定义区间表达式</option>
                </select>
              </label>
              {props.fourierWaveform === "custom" && (
                <label className="calculus-field">
                  <span>主周期 [-π, π] 表达式 f(x)</span>
                  <input
                    type="text"
                    value={props.fourierCustomExpr}
                    onChange={(e) => props.onFourierCustomExprChange(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              )}
              <label className="calculus-slider-field">
                <span className="calculus-slider-head">
                  <span>谐波叠加阶数 N</span>
                  <output>{props.fourierHarmonics} 阶</output>
                </span>
                <input
                  type="range"
                  min={1}
                  max={35}
                  step={1}
                  value={props.fourierHarmonics}
                  onChange={(e) => props.onFourierHarmonicsChange(Number(e.target.value))}
                />
              </label>
              <label className="calculus-check">
                <input
                  type="checkbox"
                  checked={props.showEpicycles}
                  onChange={(e) => props.onShowEpicyclesChange(e.target.checked)}
                />
                <span>显示旋转本轮相量圆（Epicycles）</span>
              </label>
              {props.showEpicycles && (
                <div className="calculus-inline-actions">
                  <button type="button" className="calculus-chip-btn primary" onClick={props.onToggleEpicyclePlay}>
                    {props.epicyclePlaying ? "⏸ 暂停本轮旋转" : "▶ 播放本轮旋转"}
                  </button>
                </div>
              )}
              {props.fourierError && <p className="calculus-error" role="alert">{props.fourierError}</p>}
            </>
          )}
        </section>

        <section className="calculus-card">
          <h2>经典级数预设</h2>
          <div className="calculus-preset-list">
            {props.seriesSubMode === "taylor"
              ? TAYLOR_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="calculus-preset-btn"
                    data-active={props.taylorExpr === p.expression}
                    onClick={() => props.onApplyTaylorPreset(p)}
                  >
                    <span className="calculus-preset-top">
                      <strong>{p.title}</strong>
                      <small>{p.courseTag}</small>
                    </span>
                    <code>f(x) = {p.expression}</code>
                  </button>
                ))
              : FOURIER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="calculus-preset-btn"
                    data-active={props.fourierWaveform === p.waveform}
                    onClick={() => props.onApplyFourierPreset(p)}
                  >
                    <span className="calculus-preset-top">
                      <strong>{p.title}</strong>
                      <small>{p.courseTag}</small>
                    </span>
                    <code>N = {p.harmonics} 阶谐波</code>
                  </button>
                ))}
          </div>
        </section>
      </>
    )
  }

  // Double Integral controls
  const outerVar = props.diOrder === "xy" ? "x" : props.diOrder === "yx" ? "y" : "θ"
  const innerVar = props.diOrder === "xy" ? "y(x)" : props.diOrder === "yx" ? "x(y)" : "r(theta)"

  return (
    <>
      <section className="calculus-card">
        <h2>二重积分坐标系与积分次序</h2>
        <div className="calculus-view-toggle" role="group" aria-label="二重积分次序">
          <button type="button" aria-pressed={props.diOrder === "xy"} onClick={() => props.onDiOrderChange("xy")}>先 y 后 x</button>
          <button type="button" aria-pressed={props.diOrder === "yx"} onClick={() => props.onDiOrderChange("yx")}>先 x 后 y</button>
          <button type="button" aria-pressed={props.diOrder === "polar"} onClick={() => props.onDiOrderChange("polar")}>极坐标</button>
        </div>

        {props.activeSwapTwin && (
          <button type="button" className="calculus-chip-btn primary" onClick={props.onSwapOrderTwin}>
            ⇄ 一键交换积分次序（对比扫描方向）
          </button>
        )}

        <label className="calculus-field">
          <span>被积函数 f(x, y)</span>
          <input
            type="text"
            value={props.diIntegrand}
            onChange={(e) => props.onDiIntegrandChange(e.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="calculus-domain-row">
          <label className="calculus-field">
            <span>外层下限 {outerVar}₁</span>
            <input type="text" value={props.diOuterMin} onChange={(e) => props.onDiOuterMinChange(e.target.value)} />
          </label>
          <label className="calculus-field">
            <span>外层上限 {outerVar}₂</span>
            <input type="text" value={props.diOuterMax} onChange={(e) => props.onDiOuterMaxChange(e.target.value)} />
          </label>
        </div>

        <div className="calculus-domain-row">
          <label className="calculus-field">
            <span>内层下限 {innerVar}₁</span>
            <input type="text" value={props.diInnerMin} onChange={(e) => props.onDiInnerMinChange(e.target.value)} />
          </label>
          <label className="calculus-field">
            <span>内层上限 {innerVar}₂</span>
            <input type="text" value={props.diInnerMax} onChange={(e) => props.onDiInnerMaxChange(e.target.value)} />
          </label>
        </div>

        <label className="calculus-slider-field">
          <span className="calculus-slider-head">
            <span>累次积分扫描条进度</span>
            <output>{Math.round(props.diScanRatio * 100)}%</output>
          </span>
          <input
            type="range"
            min={0.02}
            max={0.98}
            step={0.02}
            value={props.diScanRatio}
            onChange={(e) => props.onDiScanRatioChange(Number(e.target.value))}
          />
        </label>

        <label className="calculus-slider-field">
          <span className="calculus-slider-head">
            <span>黎曼网格细分数 m × m</span>
            <output>{props.diPartitions} × {props.diPartitions}</output>
          </span>
          <input
            type="range"
            min={4}
            max={24}
            step={2}
            value={props.diPartitions}
            onChange={(e) => props.onDiPartitionsChange(Number(e.target.value))}
          />
        </label>

        <label className="calculus-check">
          <input
            type="checkbox"
            checked={props.showRiemannGrid}
            onChange={(e) => props.onShowRiemannGridChange(e.target.checked)}
          />
          <span>显示黎曼和分块着色网格</span>
        </label>

        {props.diError && <p className="calculus-error" role="alert">{props.diError}</p>}
      </section>

      <section className="calculus-card">
        <h2>二重积分与换序经典大题</h2>
        <div className="calculus-preset-list">
          {DOUBLE_INTEGRAL_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="calculus-preset-btn"
              data-active={props.diIntegrand === p.integrandExpr}
              onClick={() => props.onApplyDiPreset(p)}
            >
              <span className="calculus-preset-top">
                <strong>{p.title}</strong>
                <small>{p.courseTag}</small>
              </span>
              <code>∬ ({p.integrandExpr}) dσ</code>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

export interface Phase3DiagnosticsProps {
  activeModule: "pde" | "series" | "doubleIntegral"
  pdeState: PdeSimulationState | null
  poissonSolution: PoissonSolution | null
  seriesSubMode: "taylor" | "fourier"
  taylor: TaylorAnalysis | null
  fourier: FourierAnalysis | null
  doubleIntegral: DoubleIntegralAnalysis | null
}

export function Phase3RightDiagnostics({
  activeModule,
  pdeState,
  poissonSolution,
  seriesSubMode,
  taylor,
  fourier,
  doubleIntegral
}: Phase3DiagnosticsProps) {
  if (activeModule === "pde" && pdeState) {
    return (
      <>
        <section className="calculus-card">
          <h2>PDE 数值场实时状态</h2>
          <dl className="calculus-dl">
            <div><dt>当前时刻 t</dt><dd>{fmt(pdeState.time, 3)} s</dd></div>
            <div><dt>网格规模</dt><dd>{pdeState.gridSize + 1} × {pdeState.gridSize + 1}</dd></div>
            <div><dt>场最大值 u_max</dt><dd>{fmt(pdeState.uMax, 4)}</dd></div>
            <div><dt>场最小值 u_min</dt><dd>{fmt(pdeState.uMin, 4)}</dd></div>
            <div><dt>L² 场能量 ∫u²dσ</dt><dd>{fmt(pdeState.energy, 4)}</dd></div>
            {poissonSolution && (
              <div><dt>SOR 收敛迭代</dt><dd>{poissonSolution.iterations} 步</dd></div>
            )}
          </dl>
        </section>

        <section className="calculus-card calculus-tip-card">
          <h2>物理与数理方程直觉</h2>
          {pdeState.kind === "heat2d" ? (
            <p>
              热传导方程 <code>u_t = α∇²u</code> 会迅速抹平尖锐峰值（高频分量指数衰减）；在绝热边界下总积分热量恒定，最终趋于全区域均匀平衡温度。
            </p>
          ) : pdeState.kind === "wave2d" ? (
            <p>
              二维波动方程 <code>u_tt = c²∇²u</code> 保持波形向外以有限波速 <code>c</code> 传播，多波源相遇发生线性叠加干涉，在固定边界处反相反射。
            </p>
          ) : (
            <p>
              稳态泊松方程 <code>−∇²u = ρ</code> 描述静电荷或稳态热源产生的势场；场矢量 <code>−∇u</code> 处处垂直于等势线并由高势指向低势。
            </p>
          )}
        </section>
      </>
    )
  }

  if (activeModule === "series") {
    if (seriesSubMode === "taylor" && taylor) {
      return (
        <>
          <section className="calculus-card">
            <h2>n 阶泰勒多项式展开式</h2>
            <p className="calculus-formula-callout calculus-poly-wrap">{taylor.polynomialText}</p>
            <dl className="calculus-dl">
              <div><dt>展开中心 x₀</dt><dd>{fmt(taylor.center, 3)}</dd></div>
              <div><dt>当前阶数 n</dt><dd>{taylor.order}</dd></div>
              <div><dt>|x−x₀|≤1 最大误差</dt><dd>{fmt(taylor.maxLocalError, 5)}</dd></div>
              <div><dt>常数项 f(x₀)</dt><dd>{fmt(taylor.coefficients[0] ?? 0, 4)}</dd></div>
            </dl>
          </section>

          <section className="calculus-card">
            <h2>各阶系数 c_k = f⁽ᵏ⁾(x₀) / k!</h2>
            <div tabIndex={0} role="region" aria-label="泰勒系数列表" className="calculus-table-wrapper">
              <table className="calculus-table">
                <thead>
                  <tr>
                    <th>阶数 k</th>
                    <th>泰勒系数 c_k</th>
                  </tr>
                </thead>
                <tbody>
                  {taylor.coefficients.map((c, k) => (
                    <tr key={`tc-${k}`}>
                      <th>k = {k}</th>
                      <td>{fmt(c, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )
    }

    if (seriesSubMode === "fourier" && fourier) {
      const maxAmp = Math.max(0.01, ...fourier.harmonics.map((h) => h.amplitude))
      return (
        <>
          <section className="calculus-card">
            <h2>傅里叶逼近与吉布斯过冲诊断</h2>
            <dl className="calculus-dl">
              <div><dt>直流分量 a₀/2</dt><dd>{fmt(0.5 * fourier.a0, 4)}</dd></div>
              <div><dt>谐波阶数 N</dt><dd>{fourier.harmonicsCount}</dd></div>
              <div><dt>均方根误差 RMS</dt><dd>{fmt(fourier.rmsError, 4)}</dd></div>
              <div><dt>峰值过冲量</dt><dd>{fmt(fourier.peakOvershoot, 4)}</dd></div>
            </dl>
          </section>

          <section className="calculus-card">
            <h2>谐波幅频谱 A_n = √(a_n² + b_n²)</h2>
            <div className="calculus-spectrum-bars" role="img" aria-label="傅里叶谐波幅频谱柱状图">
              {fourier.harmonics.slice(0, 16).map((hm) => (
                <div key={`hm-${hm.n}`} className="spectrum-col" title={`n=${hm.n}: A_n=${fmt(hm.amplitude, 4)}`}>
                  <div className="spectrum-bar-track">
                    <div
                      className="spectrum-bar-fill"
                      style={{ height: `${Math.max(3, Math.round((hm.amplitude / maxAmp) * 100))}%` }}
                    />
                  </div>
                  <small>{hm.n}</small>
                </div>
              ))}
            </div>
          </section>
        </>
      )
    }
  }

  if (activeModule === "doubleIntegral" && doubleIntegral) {
    const scanVar = doubleIntegral.order === "xy" ? "x" : doubleIntegral.order === "yx" ? "y" : "θ"
    const innerVar = doubleIntegral.order === "xy" ? "y" : doubleIntegral.order === "yx" ? "x" : "r"
    return (
      <>
        <section className="calculus-card">
          <h2>二重积分精确值 vs 黎曼和</h2>
          <div className="calculus-metric-pair">
            <div className="calculus-metric min">
              <span className="metric-label">高斯数值精确积分</span>
              <strong>{fmt(doubleIntegral.exactValue, 6)}</strong>
              <small>区域面积 S = {fmt(doubleIntegral.domainArea, 5)}</small>
            </div>
            <div className="calculus-metric">
              <span className="metric-label">当前分块黎曼和</span>
              <strong>{fmt(doubleIntegral.riemannSum, 5)}</strong>
              <small>误差 {fmt(Math.abs(doubleIntegral.exactValue - doubleIntegral.riemannSum), 5)}</small>
            </div>
          </div>
        </section>

        {doubleIntegral.scanSlice && (
          <section className="calculus-card">
            <h2>当前扫描截面积分限读数</h2>
            <dl className="calculus-dl">
              <div><dt>固定外层 {scanVar}</dt><dd>{fmt(doubleIntegral.scanSlice.outerParam, 3)}</dd></div>
              <div><dt>内层穿入点 {innerVar}₁</dt><dd>{fmt(doubleIntegral.scanSlice.innerLimits[0], 3)}</dd></div>
              <div><dt>内层穿出点 {innerVar}₂</dt><dd>{fmt(doubleIntegral.scanSlice.innerLimits[1], 3)}</dd></div>
              <div><dt>微元形式</dt><dd>{doubleIntegral.order === "polar" ? "r dr dθ" : doubleIntegral.order === "xy" ? "dy dx" : "dx dy"}</dd></div>
            </dl>
          </section>
        )}

        <section className="calculus-card calculus-tip-card">
          <h2>交换积分次序口诀（考研核心）</h2>
          <p>
            <strong>先 y 后 x</strong> 画竖直穿过区域 D 的红色箭头（下边界穿入为下限、上边界穿出为上限）；<strong>先 x 后 y</strong> 画水平从左向右穿过的箭头；遇到圆域与 <code>x²+y²</code> 立即切<strong>极坐标</strong>别忘雅可比因子 <code>r</code>！
          </p>
        </section>
      </>
    )
  }

  return null
}

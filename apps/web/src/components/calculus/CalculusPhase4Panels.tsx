import {
  LINALG_PRESETS,
  PROBABILITY_PRESETS,
  type CltParentKind,
  type CltSimulationResult,
  type ComplexNumber,
  type DistributionAnalysis,
  type DistributionKind,
  type LinalgPreset,
  type LinearTransform2DAnalysis,
  type Matrix2x2,
  type ProbabilityPreset
} from "@draw/geometry-kernel"

function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return v === Number.POSITIVE_INFINITY ? "+∞" : "—"
  const clean = Math.abs(v) < 1e-7 ? 0 : v
  return Number(clean.toFixed(digits)).toString()
}

function fmtEig(z: ComplexNumber): string {
  const re = fmt(z.re, 3)
  if (Math.abs(z.im) < 1e-4) return re
  return `${re} ${z.im >= 0 ? "+" : "−"} ${fmt(Math.abs(z.im), 3)}i`
}

export interface Phase4ControlsProps {
  activeModule: "linalg" | "probability"
  // Linear Algebra
  matrix: Matrix2x2
  onMatrixEntryChange: (r: 0 | 1, c: 0 | 1, val: number) => void
  linalgProgress: number
  onLinalgProgressChange: (t: number) => void
  linalgPlaying: boolean
  onToggleLinalgPlay: () => void
  showEigenvectors: boolean
  onShowEigenvectorsChange: (v: boolean) => void
  showSvdCircle: boolean
  onShowSvdCircleChange: (v: boolean) => void
  onApplyLinalgPreset: (p: LinalgPreset) => void
  // Probability & CLT
  probSubMode: "dist" | "clt"
  onProbSubModeChange: (m: "dist" | "clt") => void
  distKind: DistributionKind
  onDistKindChange: (k: DistributionKind) => void
  distParam1: number
  onDistParam1Change: (v: number) => void
  distParam2: number
  onDistParam2Change: (v: number) => void
  intervalA: number
  onIntervalAChange: (v: number) => void
  intervalB: number
  onIntervalBChange: (v: number) => void
  showCdf: boolean
  onShowCdfChange: (v: boolean) => void
  onApplyProbPreset: (p: ProbabilityPreset) => void
  cltParent: CltParentKind
  onCltParentChange: (k: CltParentKind) => void
  cltSampleSize: number
  onCltSampleSizeChange: (n: number) => void
  onResampleClt: () => void
}

export function Phase4LeftControls(props: Phase4ControlsProps) {
  if (props.activeModule === "linalg") {
    return (
      <>
        <section className="calculus-card">
          <h2>2 × 2 线性变换矩阵 A</h2>
          <div className="calculus-matrix-grid" role="group" aria-label="2x2 矩阵元素输入">
            <input
              type="number"
              step="0.1"
              aria-label="a11"
              value={props.matrix[0][0]}
              onChange={(e) => props.onMatrixEntryChange(0, 0, Number(e.target.value) || 0)}
            />
            <input
              type="number"
              step="0.1"
              aria-label="a12"
              value={props.matrix[0][1]}
              onChange={(e) => props.onMatrixEntryChange(0, 1, Number(e.target.value) || 0)}
            />
            <input
              type="number"
              step="0.1"
              aria-label="a21"
              value={props.matrix[1][0]}
              onChange={(e) => props.onMatrixEntryChange(1, 0, Number(e.target.value) || 0)}
            />
            <input
              type="number"
              step="0.1"
              aria-label="a22"
              value={props.matrix[1][1]}
              onChange={(e) => props.onMatrixEntryChange(1, 1, Number(e.target.value) || 0)}
            />
          </div>

          <label className="calculus-slider-field">
            <span className="calculus-slider-head">
              <span>连续形变插值 t（(1−t)I + tA）</span>
              <output>{Math.round(props.linalgProgress * 100)}%</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={props.linalgProgress}
              onChange={(e) => props.onLinalgProgressChange(Number(e.target.value))}
            />
          </label>

          <div className="calculus-inline-actions">
            <button type="button" className="calculus-chip-btn primary" onClick={props.onToggleLinalgPlay}>
              {props.linalgPlaying ? "⏸ 暂停形变" : "▶ 演示 I → A 连续形变"}
            </button>
          </div>

          <div className="calculus-checks">
            <label className="calculus-check">
              <input type="checkbox" checked={props.showEigenvectors} onChange={(e) => props.onShowEigenvectorsChange(e.target.checked)} />
              <span>高亮特征向量不变直线</span>
            </label>
            <label className="calculus-check">
              <input type="checkbox" checked={props.showSvdCircle} onChange={(e) => props.onShowSvdCircleChange(e.target.checked)} />
              <span>显示单位圆 → SVD 奇异值椭圆</span>
            </label>
          </div>
        </section>

        <section className="calculus-card">
          <h2>线性代数核心变换预设</h2>
          <div className="calculus-preset-list">
            {LINALG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="calculus-preset-btn"
                data-active={
                  props.matrix[0][0] === p.matrix[0][0] &&
                  props.matrix[0][1] === p.matrix[0][1] &&
                  props.matrix[1][0] === p.matrix[1][0] &&
                  props.matrix[1][1] === p.matrix[1][1]
                }
                onClick={() => props.onApplyLinalgPreset(p)}
              >
                <span className="calculus-preset-top">
                  <strong>{p.title}</strong>
                  <small>{p.courseTag}</small>
                </span>
                <code>[{p.matrix[0][0]}, {p.matrix[0][1]}; {p.matrix[1][0]}, {p.matrix[1][1]}]</code>
              </button>
            ))}
          </div>
        </section>
      </>
    )
  }

  // Probability & Statistics controls
  const param1Label = props.distKind === "normal"
    ? "均值 μ"
    : props.distKind === "student_t" || props.distKind === "chi_square"
      ? "自由度 ν / k"
      : props.distKind === "binomial"
        ? "试验次数 n"
        : "速率/强度参数 λ"

  return (
    <>
      <section className="calculus-card">
        <h2>概率统计实验模式</h2>
        <div className="calculus-view-toggle two-col" role="group" aria-label="概率子模块">
          <button type="button" aria-pressed={props.probSubMode === "dist"} onClick={() => props.onProbSubModeChange("dist")}>
            经典分布与区间概率
          </button>
          <button type="button" aria-pressed={props.probSubMode === "clt"} onClick={() => props.onProbSubModeChange("clt")}>
            中心极限定理抽样
          </button>
        </div>

        {props.probSubMode === "dist" ? (
          <>
            <label className="calculus-field">
              <span>随机变量分布族</span>
              <select
                className="calculus-select"
                value={props.distKind}
                onChange={(e) => props.onDistKindChange(e.target.value as DistributionKind)}
              >
                <option value="normal">正态分布 N(μ, σ²)</option>
                <option value="student_t">学生 t 分布 t(ν)</option>
                <option value="chi_square">卡方分布 χ²(k)</option>
                <option value="exponential">指数分布 Exp(λ)</option>
                <option value="binomial">二项分布 B(n, p)</option>
                <option value="poisson">泊松分布 Pois(λ)</option>
              </select>
            </label>

            <label className="calculus-slider-field">
              <span className="calculus-slider-head">
                <span>{param1Label}</span>
                <output>{fmt(props.distParam1, 2)}</output>
              </span>
              <input
                type="range"
                min={props.distKind === "normal" ? -3 : 1}
                max={props.distKind === "binomial" ? 40 : props.distKind === "normal" ? 3 : 20}
                step={props.distKind === "binomial" || props.distKind === "chi_square" || props.distKind === "student_t" ? 1 : 0.2}
                value={props.distParam1}
                onChange={(e) => props.onDistParam1Change(Number(e.target.value))}
              />
            </label>

            {(props.distKind === "normal" || props.distKind === "binomial") && (
              <label className="calculus-slider-field">
                <span className="calculus-slider-head">
                  <span>{props.distKind === "normal" ? "标准差 σ" : "单次成功概率 p"}</span>
                  <output>{fmt(props.distParam2, 2)}</output>
                </span>
                <input
                  type="range"
                  min={props.distKind === "normal" ? 0.3 : 0.05}
                  max={props.distKind === "normal" ? 2.5 : 0.95}
                  step={0.05}
                  value={props.distParam2}
                  onChange={(e) => props.onDistParam2Change(Number(e.target.value))}
                />
              </label>
            )}

            <div className="calculus-domain-row">
              <label className="calculus-field">
                <span>区间下限 a</span>
                <input
                  type="number"
                  step="0.2"
                  value={props.intervalA}
                  onChange={(e) => props.onIntervalAChange(Number(e.target.value))}
                />
              </label>
              <label className="calculus-field">
                <span>区间上限 b</span>
                <input
                  type="number"
                  step="0.2"
                  value={props.intervalB}
                  onChange={(e) => props.onIntervalBChange(Number(e.target.value))}
                />
              </label>
            </div>

            <label className="calculus-check">
              <input type="checkbox" checked={props.showCdf} onChange={(e) => props.onShowCdfChange(e.target.checked)} />
              <span>叠加累积分布曲线 F(x)</span>
            </label>
          </>
        ) : (
          <>
            <label className="calculus-field">
              <span>总体（母体）非正态分布</span>
              <select
                className="calculus-select"
                value={props.cltParent}
                onChange={(e) => props.onCltParentChange(e.target.value as CltParentKind)}
              >
                <option value="exponential">强偏态：指数分布 Exp(1)</option>
                <option value="uniform">平顶：均匀分布 U(0, 1)</option>
                <option value="bimodal">双峰：0-1 伯努利两点分布</option>
                <option value="dice">离散：掷均匀六面骰子</option>
              </select>
            </label>

            <label className="calculus-slider-field">
              <span className="calculus-slider-head">
                <span>单组样本容量 n（拖动观察收敛！）</span>
                <output>n = {props.cltSampleSize}</output>
              </span>
              <input
                type="range"
                min={1}
                max={45}
                step={1}
                value={props.cltSampleSize}
                onChange={(e) => props.onCltSampleSizeChange(Number(e.target.value))}
              />
            </label>

            <div className="calculus-inline-actions">
              <button type="button" className="calculus-chip-btn primary" onClick={props.onResampleClt}>
                🎲 重新随机抽取 1800 组样本均值
              </button>
            </div>
          </>
        )}
      </section>

      {props.probSubMode === "dist" && (
        <section className="calculus-card">
          <h2>概率论 / 数理统计预设</h2>
          <div className="calculus-preset-list">
            {PROBABILITY_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="calculus-preset-btn"
                data-active={props.distKind === p.kind && props.intervalB === p.intervalB}
                onClick={() => props.onApplyProbPreset(p)}
              >
                <span className="calculus-preset-top">
                  <strong>{p.title}</strong>
                  <small>{p.courseTag}</small>
                </span>
                <code>P({p.intervalA} ≤ X ≤ {p.intervalB})</code>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

export interface Phase4DiagnosticsProps {
  activeModule: "linalg" | "probability"
  linalg: LinearTransform2DAnalysis | null
  probSubMode: "dist" | "clt"
  distribution: DistributionAnalysis | null
  clt: CltSimulationResult | null
}

export function Phase4RightDiagnostics({
  activeModule,
  linalg,
  probSubMode,
  distribution,
  clt
}: Phase4DiagnosticsProps) {
  if (activeModule === "linalg" && linalg) {
    return (
      <>
        <section className="calculus-card">
          <h2>行列式、秩与空间定向</h2>
          <div className="calculus-metric-pair">
            <div className={`calculus-metric ${linalg.determinant < 0 ? "max" : linalg.rank < 2 ? "" : "min"}`}>
              <span className="metric-label">面积缩放比 det(A)</span>
              <strong>{fmt(linalg.determinant, 4)}</strong>
              <small>
                {linalg.orientation === "preserving"
                  ? "保持右手系定向"
                  : linalg.orientation === "reversing"
                    ? "空间镜像翻转（det < 0）"
                    : "奇异降维塌缩（面积为 0）"}
              </small>
            </div>
            <div className="calculus-metric">
              <span className="metric-label">矩阵秩 rank(A)</span>
              <strong>{linalg.rank}</strong>
              <small>迹 tr(A) = {fmt(linalg.trace, 3)}</small>
            </div>
          </div>
        </section>

        <section className="calculus-card">
          <h2>特征值与实特征向量</h2>
          <dl className="calculus-dl">
            <div><dt>特征值 λ₁</dt><dd>{fmtEig(linalg.eigenvalues[0])}</dd></div>
            <div><dt>特征值 λ₂</dt><dd>{fmtEig(linalg.eigenvalues[1])}</dd></div>
          </dl>
          {linalg.realEigenvectors.length > 0 ? (
            <ul className="calculus-kv-list">
              {linalg.realEigenvectors.map((ev, idx) => (
                <li key={`ev-${idx}`}>
                  <span>单位特征向量 v{idx + 1}</span>
                  <code>({fmt(ev.unitVector.x, 3)}, {fmt(ev.unitVector.y, 3)}) · λ={fmt(ev.eigenvalue, 3)}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="calculus-muted-note">特征值为共轭复数，实平面内无方向保持不变的直线。</p>
          )}
        </section>

        <section className="calculus-card">
          <h2>SVD 奇异值分解（A = U Σ Vᵀ）</h2>
          <dl className="calculus-dl">
            <div><dt>最大奇异值 σ₁</dt><dd>{fmt(linalg.svd.sigma1, 4)}</dd></div>
            <div><dt>最小奇异值 σ₂</dt><dd>{fmt(linalg.svd.sigma2, 4)}</dd></div>
            <div><dt>条件数 κ₂ = σ₁/σ₂</dt><dd>{fmt(linalg.svd.conditionNumber, 3)}</dd></div>
            <div><dt>长半轴方向 u₁</dt><dd>({fmt(linalg.svd.u1.x, 2)}, {fmt(linalg.svd.u1.y, 2)})</dd></div>
          </dl>
        </section>
      </>
    )
  }

  if (activeModule === "probability") {
    if (probSubMode === "dist" && distribution) {
      return (
        <>
          <section className="calculus-card">
            <h2>阴影区间概率计算结果</h2>
            <div className="calculus-probe-box" data-tangent="true">
              <div className="calculus-probe-status">
                P({fmt(distribution.interval[0], 2)} ≤ X ≤ {fmt(distribution.interval[1], 2)}) = {(distribution.intervalProb * 100).toFixed(2)}%
              </div>
              <dl className="calculus-dl">
                <div><dt>精确概率值</dt><dd>{fmt(distribution.intervalProb, 5)}</dd></div>
                <div><dt>互补尾概率</dt><dd>{fmt(1 - distribution.intervalProb, 5)}</dd></div>
                <div><dt>数学期望 E[X]</dt><dd>{fmt(distribution.mean, 4)}</dd></div>
                <div><dt>方差 Var(X)</dt><dd>{fmt(distribution.variance, 4)}</dd></div>
              </dl>
            </div>
          </section>

          <section className="calculus-card calculus-tip-card">
            <h2>考研概率统计速记</h2>
            <p>
              标准正态分布满足 <strong>68.27% – 95.45% – 99.73%</strong>（±1σ / ±2σ / ±3σ）法则；双侧 95% 置信区间对应分位点 <code>±1.96</code>。
            </p>
          </section>
        </>
      )
    }

    if (probSubMode === "clt" && clt) {
      return (
        <>
          <section className="calculus-card">
            <h2>经验样本均值 vs 理论正态极限</h2>
            <dl className="calculus-dl">
              <div><dt>理论期望 μ</dt><dd>{fmt(clt.theoreticalMean, 4)}</dd></div>
              <div><dt>抽样经验均值</dt><dd>{fmt(clt.empiricalMean, 4)}</dd></div>
              <div><dt>理论标准误 σ/√n</dt><dd>{fmt(clt.theoreticalStdError, 4)}</dd></div>
              <div><dt>抽样经验标准差</dt><dd>{fmt(clt.empiricalStdDev, 4)}</dd></div>
            </dl>
          </section>

          <section className="calculus-card calculus-tip-card">
            <h2>中心极限定理直觉</h2>
            <p>
              当 <code>n = 1</code> 时直方图还原母体原始偏态/双峰/均匀形状；将滑块推至 <code>n ≥ 15</code> 时，无论母体多么非正态，样本均值分布都迅速聚拢贴合红色高斯钟形曲线！
            </p>
          </section>
        </>
      )
    }
  }

  return null
}

interface StatusBarProps {
  commandPrompt: string
  activeLayerName: string
  unit: string
  scale: number
  diagnosticCount: number
  snap?: string
  coordinates?: { x: number; y: number } | null
  /** Rejection reason for the current command, shown next to the prompt. */
  notice?: string | null
}

function formatScale(scale: number): string {
  return Number.isFinite(scale) ? `${Number(scale.toFixed(4))}` : "—"
}

export function StatusBar({ commandPrompt, activeLayerName, unit, scale, diagnosticCount, snap = "关闭", coordinates = null, notice = null }: StatusBarProps) {
  return <div className="status-bar" role="status" aria-live="polite" aria-label="工程状态">
    <span className="status-bar-prompt" data-status="prompt">{commandPrompt}</span>
    {notice && <span className="status-bar-notice" data-status="notice">{notice}</span>}
    <span className="status-bar-item" data-status="snap">捕捉 {snap}</span>
    <span className="status-bar-item" data-status="coordinates">{coordinates ? `X ${coordinates.x.toFixed(2)} Y ${coordinates.y.toFixed(2)}` : "X — Y —"}</span>
    <span className="status-bar-item" data-status="unit">单位 {unit}</span>
    <span className="status-bar-item" data-status="scale">比例 {formatScale(scale)}</span>
    <span className="status-bar-item" data-status="layer">图层 {activeLayerName}</span>
    <span className="status-bar-item" data-status="diagnostics" data-has-diagnostics={diagnosticCount > 0 ? "true" : "false"}>诊断 {diagnosticCount}</span>
  </div>
}

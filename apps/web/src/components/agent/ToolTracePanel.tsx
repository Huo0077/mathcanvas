import type { AgentTraceEntry } from "../../agentStore"

/**
 * **工具与运行轨迹面板**（Task 2.6 Step 4）。
 *
 * 计划原文："Render a user-facing trace with short summaries; keep detailed diagnostics
 * behind an **opt-in** developer view."
 *
 * ## 为什么这一层是"两层"而不是"一层加个折叠"
 *
 * 用户要的是"走到哪一步了"，排障要的是"哪一次尝试、从哪个阶段来、耗时多少"。
 * 把两者混成一层会有两个后果：要么用户被账本术语淹掉，要么排障时缺字段。
 * 所以 `trace`（短摘要，永远可见）与 `diagnostics`（原始行，**默认关着**）是两个入参。
 *
 * ## 三条纪律，各有用例
 *
 * 1. **短摘要是主视图**：每条带一个**文字**状态（成功 / 注意 / 失败）—— 颜色只是装饰，
 *    灰度截图与色觉障碍下必须仍然读得出来。
 * 2. **详细诊断 opt-in**：用原生 `<details>`，**默认不展开**。原生元素的好处是内容仍在
 *    DOM 里（页内查找、屏幕阅读器都能发现），而视觉上不占位。
 * 3. **没有轨迹就不渲染**：一个空的"运行轨迹"会被读成"跑了但什么都没发生"，
 *    而真实情况是我们**还不知道**。
 */
export interface ToolTracePanelProps {
  trace?: AgentTraceEntry[]
  /** 账本导出的原始行（已脱敏）。**默认不展开**。 */
  diagnostics?: string[]
}

/** 阶段名 → 给用户看的中文（与 `RunStatus` 同一套口径，不显示内部英文枚举）。 */
const PHASE_LABELS: Record<string, string> = {
  created: "已创建",
  preflight: "检查环境",
  observing: "读取场景",
  planning: "规划",
  answering: "作答",
  compiling: "暂存草稿",
  validating: "校验",
  awaiting_confirmation: "等待你确认",
  committing: "提交",
  completed: "完成",
  waiting: "等待补充信息",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断"
}

const STATUS_LABELS: Record<AgentTraceEntry["status"], string> = { ok: "成功", warning: "注意", error: "失败" }

export function ToolTracePanel({ trace = [], diagnostics = [] }: ToolTracePanelProps) {
  if (trace.length === 0) return null

  return <section className="agent-tool-trace" aria-label="运行轨迹与工具">
    {/* 同时保留 `.agent-run-trace`：样式与既有测试的选择器都指着它（见 `RunStatus.test.tsx` 的说明）。 */}
    <ol className="agent-run-trace agent-tool-trace-list">
      {trace.map((entry, index) => <li key={`${entry.phase}-${index}`} data-status={entry.status} data-phase={entry.phase}>
        <span className="agent-trace-phase">{PHASE_LABELS[entry.phase] ?? entry.phase}</span>
        <span className="agent-trace-summary">{entry.summary}</span>
        {/* 文字状态：颜色之外必须有一个词。 */}
        <span className="agent-trace-status">{STATUS_LABELS[entry.status]}</span>
        {entry.toolId && <span className="agent-trace-tool">工具 {entry.toolId}</span>}
      </li>)}
    </ol>

    {diagnostics.length > 0 && <details className="agent-tool-trace-diagnostics">
      {/* 默认不展开：这是 "opt-in" 的全部含义。 */}
      <summary>开发者详细视图（{diagnostics.length} 行）</summary>
      <pre>{diagnostics.join("\n")}</pre>
    </details>}
  </section>
}

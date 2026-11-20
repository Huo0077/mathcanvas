import { useEffect, useState } from "react"
import type { AgentTraceEntry } from "../../agentStore"

/**
 * **工具与运行轨迹面板（Gemini 风格思考过程卡片）**
 *
 * 将执行阶段与实时模型推理汇总进一个可流畅展开/收起的「思考过程」面板：
 * - 运行中（`pending`）默认展开并展示实时推理步骤；
 * - 完成后自动折叠为紧凑的「已完成思考」胶囊，按需点开复核；
 * - 「开发者详细视图」保持独立的 `<details>` 且默认关闭（opt-in）。
 */
export interface ToolTracePanelProps {
  trace?: AgentTraceEntry[]
  /** 账本导出的原始行（已脱敏）。**默认不展开**。 */
  diagnostics?: string[]
  /** 当前轮次是否仍在运行（运行中默认展开思考过程，结束后收起）。 */
  pending?: boolean
  /** 当前轮次是否出现错误。 */
  failed?: boolean
}

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

const TOOL_DISPLAY_LABELS: Record<string, string> = {
  construct_point: "构建/绑定点",
  construct_solid: "构建三维实体",
  construct_segment: "连接线段",
  construct_line: "构建直线",
  construct_face: "构建空间面",
  construct_circle: "构建圆/轨道",
  construct_conic: "构建圆锥曲线",
  construct_tangent: "作切线",
  construct_perpendicular: "作垂线",
  construct_parallel: "作平行线",
  construct_intersection: "求交点",
  construct_circumsphere: "求外接/内切球",
  construct_fold_state: "构建空间翻折",
  query_measurement: "验算几何数值",
  query_constraint_status: "核对几何约束",
  repair_entity: "修正实体步骤",
  repair_constraint: "调整约束参数",
  declare_entity: "登记图元名称",
  finish_candidate: "提交草稿核验",
  request_clarification: "请求补充条件"
}

function displayTraceSummary(summary: string): string {
  if (summary === "checking capabilities and the target handle") return "检查运行环境与目标画布"
  if (summary === "reading the scene") return "读取当前场景图元"
  if (summary === "asking for a plan") return "推理题设约束并规划几何构造"
  if (summary === "checking the staged draft against the document") return "按几何规则与题设条件核验草稿"
  if (summary === "waiting for the user to confirm the preview") return "草稿已就绪，等待你确认落盘"
  const stagingMatch = /^staging\s+(\d+)\s+action\(s\)$/.exec(summary)
  if (stagingMatch) return `组装 ${stagingMatch[1]} 个几何构造动作`
  return summary
}

function parseThinkingSteps(diagnostics: readonly string[]): { id: string; text: string; kind: "step" | "retry" | "info" }[] {
  const steps: { id: string; text: string; kind: "step" | "retry" | "info" }[] = []
  let round = 0
  for (const raw of diagnostics) {
    const line = raw.trim()
    if (!line) continue
    const usageMatch = /^\[usage\]\s+req=(\d+).*?\btools=([^\s]+)/.exec(line)
    if (usageMatch) {
      round += 1
      const tools = usageMatch[2]!
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t && t !== "none")
      const uniqueLabels = [...new Set(tools.map((t) => TOOL_DISPLAY_LABELS[t] ?? t))]
      if (uniqueLabels.length > 0) {
        steps.push({ id: `req-${usageMatch[1]}-${round}`, text: `第 ${round} 轮：${uniqueLabels.join("、")}`, kind: "step" })
      }
      continue
    }
    if (line.startsWith("[ds_action_fail]") || line.startsWith("[ds_action_batch_fail]")) {
      steps.push({ id: `retry-${steps.length}`, text: "发现几何偏差或参数需修正，已自动调整思路", kind: "retry" })
      continue
    }
    const obsMatch = /^\[observation\]\s+(\d+)\s+object\(s\)/.exec(line)
    if (obsMatch) {
      steps.push({ id: `obs-${steps.length}`, text: `感知现有画布：读取了 ${obsMatch[1]} 个图元`, kind: "info" })
    }
  }
  return steps
}

export function ToolTracePanel({ trace = [], diagnostics = [], pending = false, failed = false }: ToolTracePanelProps) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  useEffect(() => {
    // 一旦运行结束，如用户未主动点开过，则恢复收起以保持对话区清爽
    if (!pending) setUserExpanded((prev) => (prev === null ? null : prev))
  }, [pending])

  if (trace.length === 0) return null

  const thinkingSteps = parseThinkingSteps(diagnostics)
  const expanded = userExpanded ?? pending
  const latestTrace = trace.at(-1)
  const summaryHeading = pending
    ? `正在思考 · ${latestTrace ? PHASE_LABELS[latestTrace.phase] ?? latestTrace.phase : "推理中"}`
    : failed
      ? `思考已中断（${trace.length} 个阶段）`
      : thinkingSteps.length > 0
        ? `思考过程（${trace.length} 个阶段 · ${thinkingSteps.length} 次推导）`
        : `思考过程（${trace.length} 个阶段）`

  return (
    <section className="agent-tool-trace" aria-label="运行轨迹与工具" data-pending={pending ? "true" : "false"} data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        className="agent-thinking-trigger"
        aria-expanded={expanded}
        onClick={() => setUserExpanded(!expanded)}
      >
        <span className={`agent-thinking-sparkle${pending ? " is-active" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2L14.3 9.7L22 12L14.3 14.3L12 22L9.7 14.3L2 12L9.7 9.7L12 2Z" />
          </svg>
        </span>
        <span className="agent-thinking-title">{summaryHeading}</span>
        <span className="agent-thinking-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <div className="agent-thinking-collapse" data-open={expanded ? "true" : "false"}>
        <div className="agent-thinking-collapse-inner">
          <ol className="agent-run-trace agent-tool-trace-list">
            {trace.map((entry, index) => (
              <li key={`${entry.phase}-${index}`} data-status={entry.status} data-phase={entry.phase}>
                <span className="agent-trace-phase">{PHASE_LABELS[entry.phase] ?? entry.phase}</span>
                <span className="agent-trace-summary">{displayTraceSummary(entry.summary)}</span>
                <span className="agent-trace-status">{STATUS_LABELS[entry.status]}</span>
                {entry.toolId && <span className="agent-trace-tool">工具 {entry.toolId}</span>}
              </li>
            ))}
          </ol>

          {thinkingSteps.length > 0 && (
            <div className="agent-thinking-steps" aria-label="几何推理过程">
              {thinkingSteps.map((step) => (
                <div className="agent-thinking-step" key={step.id} data-kind={step.kind}>
                  <span className="agent-thinking-step-dot" aria-hidden="true" />
                  <span>{step.text}</span>
                </div>
              ))}
            </div>
          )}

          {diagnostics.length > 0 && (
            <details className="agent-tool-trace-diagnostics">
              {/* 默认不展开：这是 "opt-in" 的全部含义。 */}
              <summary>开发者详细视图（{diagnostics.length} 行）</summary>
              <pre>{diagnostics.join("\n")}</pre>
            </details>
          )}
        </div>
      </div>
    </section>
  )
}

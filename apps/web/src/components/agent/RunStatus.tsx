import type { AgentCommitView, AgentMessage } from "../../agentStore"
import { ToolTracePanel } from "./ToolTracePanel"

/**
 * **运行状态卡**（Task 2.5 Step 3/4）。
 *
 * 计划要求："Loading has explicit progress; errors include a retry/revise action and field/fact links;
 * **no status relies only on color**."
 *
 * 三条都落在这里，各有用例：
 * 1. **进度要说得出来**：不是转圈，而是"正在做什么 + 走到哪一步"（轨迹逐条列出）。
 * 2. **失败要可执行**：给出原因、字段路径（如果有），以及"重试 / 改一改"的动作。
 * 3. **状态不能只靠颜色**：每条状态都带**文字**（`成功` / `注意` / `失败`），
 *    颜色只是附加信息。色觉障碍用户、以及在灰度打印/截图里，颜色是靠不住的。
 *
 * 这块组件**只读**：它不发请求、不改 store —— 动作全部通过回调交给上层。
 */

export interface RunStatusProps {
  message: AgentMessage
  /** 用户在失败后点"重试"。 */
  onRetry?: () => void
  /** 用户在失败后点"改一改"（回到输入框继续编辑）。 */
  onRevise?: () => void
  /** 用户点"停止"。 */
  onStop?: () => void
  /** 用户在草稿预览上点"确认并提交"。 */
  onConfirm?: () => void
  /** 用户点"丢弃草稿"。 */
  onDiscard?: () => void
}

/** 阶段名 → 给用户看的中文。**不显示内部英文枚举**，那对用户没有意义。 */
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

/**
 * 状态文字（`成功 / 注意 / 失败`）与轨迹的渲染一起搬到了 `ToolTracePanel` ——
 * 那一层要给每条状态一个**词**（而不是只有颜色），并且自己负责"详细视图默认关着"。
 * 这里不再留一份副本：两份状态文案迟早会分叉。
 */

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase
}

function progressOf(message: AgentMessage): { label: string; detail: string } | null {
  if (message.pending) {
    const latest = message.trace?.at(-1)
    return { label: "进行中", detail: latest ? phaseLabel(latest.phase) : "正在开始" }
  }
  if (message.commit) return { label: message.commit.status === "committed" ? "已提交" : "无需改动", detail: "" }
  if (message.failure) return { label: "没有完成", detail: message.failure.message }
  /**
   * **草稿已暂存但运行不再 pending**：这是"等你确认"的状态，不是"没有状态"。
   *
   * 第一版这里直接返回 `null`，于是那块草稿预览（含确认/丢弃按钮与一步撤销声明）
   * **整块不渲染** —— 用户看到一条空消息，却没有任何东西可点。是测试抓出来的。
   */
  if (message.draft) return { label: "等待你确认", detail: "草稿已暂存，还没有写进文档" }
  return null
}

export function RunStatus({ message, onRetry, onRevise, onStop }: RunStatusProps) {
  const progress = progressOf(message)
  if (!progress) return null

  return <section className="agent-run-status" aria-label="运行状态" data-status={message.failure ? "error" : message.pending ? "running" : "done"}>
    <header className="agent-run-head">
      {/* 文字状态永远是第一信息；颜色只是装饰。 */}
      <span className="agent-run-state" data-state-label={progress.label}>{progress.label}</span>
      {progress.detail && <span className="agent-run-detail">{progress.detail}</span>}
      {message.pending && onStop && <button type="button" className="agent-run-stop" onClick={onStop}>停止</button>}
    </header>

    {/**
      * 用户可见的轨迹 + **默认关着**的开发者详细视图，一起归 `ToolTracePanel`（Task 2.6 Step 4）。
      *
      * 这一段原先就地渲染一个 `<ol>`。抽出去的理由不是"少写几行"，而是"opt-in 的详细视图"
      * 需要一个**有状态的**容器（原生 `<details>`），而状态卡本身是无状态的展示组件。
      */}
    <ToolTracePanel trace={message.trace} diagnostics={message.diagnostics} />

    {/**
      * 这里**不再**渲染草稿摘要。
      *
      * 草稿的确认 UI 现在归 `ConfirmationPanel`（它给的信息多得多：精确计数、来源与目标、
      * 假设、近似、导出省略、删除警告）。两处都渲染会同时出现**两个**「确认并提交」按钮 ——
      * 这不是"多一层保险"，而是让无障碍查询与用户都面对歧义（e2e 立刻以"找到多个按钮"报出来）。
      */}
    {message.commit?.status === "failed" && <p className="agent-run-failure" role="alert">提交失败：{message.commit.detail ?? "原因未知"}</p>}

    {message.failure && <div className="agent-run-error" role="alert">
      <p className="agent-run-error-message">{message.failure.message}</p>
      <p className="agent-run-error-code">原因码：{message.failure.code}</p>
      <div className="agent-run-actions">
        {message.failure.retryable && onRetry && <button type="button" onClick={onRetry}>重试</button>}
        {onRevise && <button type="button" onClick={onRevise}>改一改</button>}
      </div>
    </div>}
  </section>
}

export type { AgentCommitView }

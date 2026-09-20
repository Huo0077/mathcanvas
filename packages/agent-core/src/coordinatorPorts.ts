import type { DocumentHandle, PlanEnvelope, RunContext, ToolResult } from "./contracts"
import type { DraftAction } from "@draw/scene-graph"
import type { Budget } from "./budget"
import type { RunEvent } from "./runState"

/**
 * **协调器的四组端口**（Task 2.1）。
 *
 * 计划原文只给了一个接口签名（`AgentCoordinator.start(runContext, userMessage): AsyncIterable<AgentEvent>`），
 * 但协调器要做的四件事都不能由它自己做：
 * - 问模型 → `planner`
 * - 读场景 → `observer`
 * - 编译与提交 → `committer`（**只有这一条路径能写文档**）
 * - 执行只读工具 → `tools`
 *
 * 所以它们全部是**注入的接口**。这样做有三个直接好处，都在本轮的用例里被用到：
 * 1. **没有网络**：`agent-core` 至今没有任何 `fetch` / provider 代码（这是 G0 Gate 第 5 条守的性质），
 *    协调器也不例外 —— 它只认这些接口。
 * 2. **可测**：九条场景（成功只读、成功草稿、缺事实、输出非法、草稿过期、提交前取消、提交中取消、
 *    provider 失败、应用中断）都能用脚本化的假端口跑出来，不需要任何真实模型。
 * 3. **取消可传播**：`AbortSignal` 从协调器发给每个端口，端口负责真的中断自己的 IO。
 */

export interface PlanRequest {
  run: RunContext
  userMessage: string
  budget: Budget
  signal: AbortSignal
}

export interface PlanOutcome {
  plan: PlanEnvelope
  requestId: string
  attemptId: string
}

export interface PlannerPort {
  /** 产出计划信封。**不可信输出**：协调器必须用 `parsePlanEnvelope` 校验之后才认。 */
  plan(request: PlanRequest): Promise<PlanOutcome>
}

export interface ObservationRequest {
  run: RunContext
  signal: AbortSignal
}

export interface Observation {
  /** 已确认的事实 id（计划信封里的 `factIds` 必须都在这里，否则就是"缺事实"）。 */
  factIds: string[]
  /** 供模型使用的场景摘要（有界）。 */
  summary: string
}

export interface ObserverPort {
  observe(request: ObservationRequest): Promise<Observation>
}

export interface CommitOutcome {
  status: "committed" | "no_change" | "stale_source" | "rejected"
  detail?: string
  /** 提交成功后的新句柄；失败时为 null。 */
  handle?: DocumentHandle | null
}

export interface CommitRequest {
  run: RunContext
  /** 已通过校验、即将落盘的动作数（用于预算与说明）。 */
  actionCount: number
  /**
   * 要落盘的**动作本身**。
   *
   * 第一版这里只有 `actionCount` —— 那是个真实的设计缺口：适配器拿不到动作，
   * 于是"暂存"这一步在真实接线时**无中生有**。计数是给人看的说明，动作才是要编译的东西，
   * 两者都要有，而动作不能靠计数推出来。
   */
  actions: DraftAction[]
  signal: AbortSignal
}

export interface CommitterPort {
  /**
   * 草稿阶段：**只产生隔离草稿与预览，绝不写文档**。
   * 返回失效原因（例如手工编辑之后草稿过期），供协调器决定是回到编译还是失败。
   */
  stage(request: CommitRequest): Promise<{ ok: true; draftVersion: number; previewHash: string } | { ok: false; reason: StageFailureReason; detail?: string }>
  /** 提交阶段：**唯一能写文档的调用**，必须带用户同意与幂等键。 */
  commit(request: CommitRequest & { consent: ConsentToken }): Promise<CommitOutcome>
}

/** 暂存可能失败的原因。与 G0.5 的 `DraftStore.StageReason` 同一套名字。 */
export type StageFailureReason = "unknown_draft" | "stale_draft" | "stale_draft_version" | "compile_failed" | "unsupported"

/**
 * 用户同意的凭据。
 *
 * 它**只能由宿主/UI 创建**（G0.5 的 `HostBridge`），协调器只是把它原样传下去。
 * 类型上做成"不透明载荷"是刻意的：协调器既不能伪造它，也不能从模型输出里读出一个来 ——
 * 这是计划 Task 0.8 Step 3 那句"do not expose `commit` as a model-facing tool"在类型层的落点。
 */
export interface ConsentToken {
  readonly kind: "user_consent"
  readonly nonce: string
  readonly previewHash: string
}

export type ToolCallRequest = {
  run: RunContext
  toolCallId: string
  actionCount: number
  signal: AbortSignal
}

export interface ToolPort {
  /** 只读工具（观察类）。**不许改文档** —— 写入只有 `CommitterPort.commit` 一条路。 */
  call(request: ToolCallRequest): Promise<ToolResult<unknown>>
}

export type CancelReason = "user" | "interrupted"

export type CancelResult = {
  cancelled: boolean
  phase: RunPhaseAtCancel
}

/** 只为本模块的类型自足而引；语义见 `runState.ts`。 */
type RunPhaseAtCancel = RunEvent["phase"]

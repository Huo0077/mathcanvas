import { buildLayoutModel, buildPlanRequest, CAPABILITY_REGISTRY_REVISION, compilePlan, createBudget, SKILL_MANIFESTS, type DocumentHandle, type PlannerPort, type PlanRequest, type RunContext } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { MODEL_PLANNER_SKILL_IDS } from "../agentRunner"
import { createLocalPlanner, localIntentSkillIds } from "../localPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import { evaluateAgentTask } from "./agentTaskJudge"
import { scoreAgentAttempts, type AgentEvalAttempt, type AgentEvalScorecard } from "./agentEvalRunner"

export interface OfflineEvalResult {
  mode: "deterministic_local"
  attempts: AgentEvalAttempt[]
  scorecard: AgentEvalScorecard
}

/**
 * **本通道请求哪些技能 —— 这是输入，不是形状**（N4d）。
 *
 * 请求的**形状**只有一处（`@draw/agent-core` 的 `buildPlanRequest`）；"这一轮请求了哪些技能"
 * 是每个调用方自己的决定，与 `agentRunner.selectPlanner` 同一口径：
 * - 真实模型规划器 → **全部已登记的清单**（`MODEL_PLANNER_SKILL_IDS`）。
 *   这不是"多给点没坏处"：`request.model.context` 里的 `availableActions` 由清单决定，
 *   给少了模型就看不到那个动作，于是"某些任务永远做不了"在界面上看起来像"模型不会做这件事"；
 * - 本地确定性规划器 → `localIntentSkillIds(prompt)`（它命中哪条指令就用那条的技能）。
 *   离线那条路在 `agentRuntime.selectPlanner` 里就是这么给的，所以它不需要另发明一套。
 *
 * 缺省是**模型口径**：这条通道默认由设置面板用真实 provider 跑（`providerAgentEval.ts`），
 * 而"用例注入本地规划器"只是它的另一种用法（`runOfflineAgentEval` 显式给本地口径）。
 */
export type RequestedSkillIds = (prompt: string) => readonly string[]

export const MODEL_PATH_SKILL_IDS: RequestedSkillIds = () => MODEL_PLANNER_SKILL_IDS
export const LOCAL_PLANNER_SKILL_IDS: RequestedSkillIds = (prompt) => localIntentSkillIds(prompt)

/**
 * **技能清单 → 可用动作名**（与 `agentRuntime.ts:384-385` 同一条口径：
 * 技能 id 先过清单，再从清单取动作）。两处各写一遍就会出现"模型看到的动作菜单"与
 * "运行时真的允许的动作"分叉 —— 那种分叉在界面上的表现是"模型试了一个它不该看到的动作"。
 *
 * 导出给题集 planning 通道（`benchmarkPlanningEval.ts`）共用：那条通道从前自己拼了一份
 * 同样的推导，而"两份无人知晓的推导"与"两份无人知晓的请求构造"是同一类毛病。
 */
export function availableActionsFor(requestedSkillIds: readonly string[]): readonly string[] {
  return [...new Set(SKILL_MANIFESTS.filter((manifest) => requestedSkillIds.includes(manifest.id)).flatMap((manifest) => manifest.actionIds))]
}

/**
 * **这一条尝试的 `PlanRequest`**（N4d）。
 *
 * ## 为什么它必须完整（本批修的那个洞）
 *
 * 这里原来写的是 `plan({ userMessage: fixture.prompt } as never)`。那对
 * `createLocalPlanner`（只读 `userMessage`）成立，对**真实** `createModelPlanner`
 * **不成立**：它在发出任何网络请求**之前**就读 `request.model.context`（`modelPlanner.ts:369`），
 * 于是抛 `TypeError: Cannot read properties of undefined (reading 'context')`。
 * 后果不是"报个错"三个字：这条通道是应用里**唯一会花钱**的入口，而它从来没有真正跑过
 *（历史上连"失败"都不显示，面板会永远停在"正在跑…"—— 那是上一批修掉的）。
 *
 * ## 为什么不在这里自己拼
 *
 * "模型能看到什么"的归属地是协调器（`coordinatorPorts.ts` 的 `PlanRequest.model` 注释点名了
 * 这条安全边界：`buildContext` / `createToolRegistry` 都是 `agent-core` 自己的部件，
 * 而"哪个阶段发布哪些工具"是边界本身）。所以这里调的是 `buildPlanRequest` ——
 * 协调器自己用的也是它，于是"评测请求"与"生产请求"在结构上不可能再分叉。
 *
 * ## 三处**内容**上的差别是诚实写出来的，不是默认值
 *
 * - **工作区固定 `geometry3d`**：这条通道从一张空的立体几何画布开始（`createEmptyDocument("geometry3d")`
 *   是它一直以来的口径，本批**不改**）。题集那条 planning 通道按题面声明的 workspace 走，
 *   与这条不是一个坐标系；
 * - **观察结果是空场景**：`facts` 是空数组、摘要只陈述一件可核对的事（本文档里几个图元）——
 *   这个 harness 里没有场景观察层，所以不假装有事实；
 * - **没有只读工具端口**：这个 harness 没有 `ToolPort` 宿主，所以 `readToolsAvailable` 取
 *   `buildPlanRequest` 的缺省 `false`（协调器在 `dependencies.tools === undefined` 时传的也是它）。
 *
 * `signal` 是**永不可中止**的那一种（`new AbortController().signal`）：评测里没有"用户按停止"
 * 这回事，所以今天不可达；但它意味着这条通道不会因为取消而中断（与题集通道同一句实话）。
 */
export function agentEvalPlanRequest(
  prompt: string,
  workspace: "geometry3d" | "cad",
  runId: string,
  document: ReturnType<typeof createEmptyDocument>,
  requestedSkillIds: readonly string[]
): PlanRequest {
  const handle: DocumentHandle = {
    projectId: "local",
    documentId: document.metadata.id,
    workspace,
    epoch: `epoch:${document.metadata.id}`,
    generation: document.revision,
    // 与题集通道同一条口径：句柄里的内容哈希是"这份文档在此刻长什么样"，不能留空。
    contentHash: contentFingerprint(document)
  }
  const run: RunContext = {
    runId,
    conversationId: runId,
    promptMessageId: `${runId}-prompt`,
    target: handle,
    sources: [],
    // 这一轮是**评测**在问，不是某一份用户配置 —— 名字要说清这件事。
    textProfileId: "agent-fixture-eval",
    capabilityRevision: CAPABILITY_REGISTRY_REVISION,
    policyRevision: "local"
  }
  return buildPlanRequest({
    run,
    userMessage: prompt,
    budget: createBudget(),
    signal: new AbortController().signal,
    observation: { facts: [], summary: `${document.primitives.length} object(s) in ${document.metadata.id}` },
    requestedSkillIds,
    availableActions: availableActionsFor(requestedSkillIds)
  })
}

/**
 * **一次尝试**：把一条 fixture 走一遍"规划 → 编译 → 判题"。
 *
 * ## 规划器是**参数**，不是写死的（2026-10-05 抽出）
 *
 * 离线评测与**真实 provider 评测**要跑的是同一件事，唯一区别就是那一个 `PlannerPort`。
 * 抽出之前这段逻辑只在 `runOfflineAgentEval` 里，真实那一侧要么抄一份、要么没有 ——
 * **抄一份就等于两套判题口径**（编译选项、`toolErrors` 怎么算、布局读数从哪来，全都会各自漂）。
 *
 * 参数是**工厂**而不是实例：原来每次尝试都 `createLocalPlanner()` 一个新实例，
 * 这里保持同样的语义（真实规划器那侧也因此每次重新解析 provider、拿新的 runId）。
 *
 * ## 什么**没有**变（本批一个字不改的语义）
 *
 * 还是那 8 条夹具、还是 `TRIALS` 的扫描、还是 `scoreAgentAttempts` 的记分口径、
 * 还是"先解析 provider 再决定跑不跑"（那一条在 `providerAgentEval.ts` 里，一次请求都不提前发）。
 * 本批只把**请求的形状**修正成产品真实路径的形状。
 */
export async function runOneEvalAttempt(
  createPlanner: () => PlannerPort,
  fixtureId: string,
  trial: 1 | 2 | 3,
  requestedSkillIds: RequestedSkillIds = MODEL_PATH_SKILL_IDS
): Promise<AgentEvalAttempt> {
  const fixture = AGENT_TASK_FIXTURES.find((entry) => entry.id === fixtureId)!
  const started = Date.now()
  const document = createEmptyDocument("geometry3d")
  const request = agentEvalPlanRequest(fixture.prompt, "geometry3d", `agent-eval-${fixture.id}-${trial}`, document, requestedSkillIds(fixture.prompt))
  const envelope = (await createPlanner().plan(request)).plan
  const compiled = compilePlan(envelope, { document, prompt: fixture.prompt, conversationId: `eval-${trial}`, documentGeneration: document.revision })
  /**
   * **布局读数来自候选文档本身**（Phase 4）：它是纯本地的，不依赖 provider vision、
   * 不依赖浏览器。因此视觉类任务（"对象有没有被裁掉""标签有没有叠在一起"）
   * 在这里能被真的判定，而不是一律 `not_supported`。
   *
   * 注意它在**编译失败**（`draftDocument` 为 null）时缺省 —— 那种情况下
   * 判题器会如实报 `not_supported`，而不是拿空文档去算一个"没问题"。
   */
  const layout = compiled.ok && compiled.draftDocument ? buildLayoutModel(compiled.draftDocument as never) : undefined
  const report = evaluateAgentTask(fixture, { phase: compiled.ok ? "awaiting_confirmation" : "failed", candidate: compiled.draftDocument, ...(layout === undefined ? {} : { layout }) })
  return { fixtureId, trial, report, toolCalls: fixture.expected.toolIntent, toolErrors: compiled.ok ? 0 : 1, durationMs: Math.max(0, Date.now() - started) }
}

/**
 * **把整套 fixture 跑满轮数**（离线与真实 provider 共用同一条扫描）。
 *
 * `costUsd` 在这里**不填** —— 它要价目表，而仓里没有（见 `providerAgentEval.ts` 的说明）。
 * 填一个猜出来的钱数，比留空坏得多：`scoreAgentAttempts` 只有在**每次成功尝试都带成本**时
 * 才给平均值，所以留空会让报告如实显示 `not measured`。
 */
export async function runEvalSweep(createPlanner: () => PlannerPort, trials: 1 | 3, requestedSkillIds: RequestedSkillIds = MODEL_PATH_SKILL_IDS): Promise<AgentEvalAttempt[]> {
  const attempts: AgentEvalAttempt[] = []
  for (const fixture of AGENT_TASK_FIXTURES) {
    for (const trial of (trials === 1 ? [1] as const : [1, 2, 3] as const)) attempts.push(await runOneEvalAttempt(createPlanner, fixture.id, trial, requestedSkillIds))
  }
  return attempts
}

/**
 * **离线那一轮**：规划器是本地确定性那一份，所以技能口径也跟着换成它的
 *（`localIntentSkillIds` —— 与 `agentRuntime.selectPlanner` 对本地规划器的口径一致）。
 */
export async function runOfflineAgentEval(trials: 1 | 3 = 3): Promise<OfflineEvalResult> {
  const attempts = await runEvalSweep(() => createLocalPlanner(), trials, LOCAL_PLANNER_SKILL_IDS)
  return { mode: "deterministic_local", attempts, scorecard: scoreAgentAttempts(AGENT_TASK_FIXTURES, attempts) }
}

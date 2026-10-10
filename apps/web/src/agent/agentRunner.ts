import { agentNextPhaseFlags } from "./featureFlags"
import { CAPABILITY_REGISTRY_REVISION, PLAN_SCHEMA_VERSION, SKILL_MANIFESTS, TOOL_REGISTRY_REVISION, factBelongsToDocument, type CommitOutcome, type ConversationContextSource, type ConversationDraftView, type DocumentHandle, type PlanEnvelope, type PlannerPort, type RunContext, type WorkspaceId } from "@draw/agent-core"
import type { GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { useAgentStore, setDocumentGenerationReader, type AgentConversation } from "../agentStore"
import { useSceneStore } from "../store"
import { conversationRepository } from "../conversationRepository"
import { summaryOfDocument } from "../conversationSummary"
import { appendRunEvent } from "../services/runEventClient"
import { createAgentRuntime, type AgentRuntime } from "./agentRuntime"
import { deriveAcceptance } from "./acceptance"
import { SYSTEM_PROMPT_VERSION } from "./systemPrompt"
import { createLocalPlanner, localIntentSkillIds } from "./localPlanner"
import { createModelPlanner, resolveActiveProvider, type ModelPlannerDependencies } from "./modelPlanner"

/**
 * **Agent 运行器**（Task 2.5 Step 2 的另一半）。
 *
 * 协调器是**按运行**建的（每次 `start` 都会重置账本），但"确认并提交"发生在运行**之后** ——
 * 那时必须还能拿到同一个运行时，否则用户点了确认却找不到那份草稿。
 * 所以这里持有一段**运行之间的状态**：上一次运行用的 `AgentRuntime`（以及它的草稿）。
 *
 * ## 一条安全边界
 *
 * 这个模块是界面**唯一**能触达提交的地方，而它只调 `runtime.confirmDraft()`，
 * 后者只调 `HostBridge.requestConsent` + `HostBridge.commit`。
 * 界面那一层拿不到 `commit`，也造不出同意凭据 —— 这是"提交不是模型可见工具"在装配层的落点。
 */

/**
 * 这一轮**新建的对象**：候选文档相对当前文档的差集，但**去掉物化出来的拓扑子对象**。
 *
 * ## 为什么不能只做差集
 *
 * 一个立体在文档里从来不止一个图元：`solid.create_template` 一次落盘"模板图元 + 点 / 棱 / 面 /
 * `polyhedron3`"，`solid.create_prism`、`solid.create_tetrahedron`、`solid.create_polyhedron` 同理。
 * 只按 id 做差集，一个立方体就会算成 **28 个新对象**（实测：`solid-1`、`solid-1-point-1`…
 * `solid-1-face-14`、`solid-1-polyhedron-27`）。
 *
 * 后果不只是数字难看：`createdObjects` 随后被 `.slice(0, 24)` 截断，而子对象排在**实体后面** ——
 * 于是**实体自己被挤出名单**，长时记忆里留下的是 `solid-1-edge-18`、`solid-1-face-11` 这些
 * 用户从没听说过的东西，"这一轮建了什么"这句话就废了（实测的确认事实原文：
 * "已确认：文档第 1 版新增 24 个对象（solid-1、solid-1-point-1、…）"，
 * 而摘要里的 `createdObjects` 是 `["solid-1-edge-18", …, "solid-1-face-11"]`）。
 *
 * 判据取自**文档自身**，与渲染 / 拖动 / 删除级联用的是同一条边界
 *（`operations.ts` 的 `templateTopologyIds` / `isFreeDraggable3`），不在这里另立一套"什么算子对象"的规则：
 *
 * 1. 被某只 `polyhedron3` 的 `vertexIds` / `edgeIds` / `faceIds` 引用的 —— 点 / 棱 / 面；
 * 2. `construction.sourceIds` 里点名了一只模板图元（`cube` / `pyramid` / `cylinder` / `cone`）的多面体
 *    —— 它是那只模板的派生表示（`solid-1-polyhedron-27`），不是用户单独建的东西。
 *
 * 第 2 条要读的是多面体**自己**的 `sourceIds`，而不是"谁的 sourceIds 里有它"：
 * 模板多面体的 `sourceIds` 第一个元素是**父图元**（`solid-1`），它自己并不在里面 ——
 * 从属主那一侧找会把父图元误判成子对象（实测：实体被滤掉，只剩派生多面体）。
 *
 * 两条都少不得：只做第 1 条时，一个立方体仍算成"2 个对象"（`solid-1` 与 `solid-1-polyhedron-27`）。
 */
export function createdEntitiesOf(candidate: GeometryDocument, before: ReadonlySet<string>): string[] {
  const templateIds = new Set(candidate.primitives
    .filter((primitive) => ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type))
    .map((primitive) => primitive.id))
  const generated = new Set<string>()
  for (const primitive of candidate.primitives) {
    if (primitive.type !== "polyhedron3") continue
    for (const childId of [...primitive.vertexIds, ...primitive.edgeIds, ...primitive.faceIds]) generated.add(childId)
    const sourceIds = primitive.construction && "sourceIds" in primitive.construction ? primitive.construction.sourceIds : []
    if (sourceIds.some((sourceId) => templateIds.has(sourceId))) generated.add(primitive.id)
  }
  return candidate.primitives.map((primitive) => primitive.id).filter((id) => !before.has(id) && !generated.has(id))
}

export interface RunPromptResult {
  phase: string
  /** 有草稿并且停在确认阶段时为它的 id。 */
  draftId: string | null
}

export interface AgentRunner {
  /** 跑一轮。事件会实时回流到 `useAgentStore`，所以界面不需要自己订阅。 */
  run(prompt: string, promptMessageId: string): Promise<RunPromptResult>
  /**
   * 用户确认：真正落盘。
   *
   * `runId` 是**用户点的那块面板所属的那一轮**（消息上盖着它）。传了就必须是已知的一轮，
   * 而且它的会话必须还是当前会话（规格 §5.4）—— 否则如实拒绝，绝不替另一轮提交。
   * 不传时退回"最近的那一轮"（老调用方与脚本化用例）。
   */
  confirm(runId?: string): CommitOutcome
  /** 用户丢弃草稿：文档不动。`runId` 语义同 `confirm`。 */
  discard(runId?: string): boolean
  /** 用户按了停止：取消当前运行（不再发事件，也不会写文档）。`runId` 语义同 `confirm`。 */
  stop(runId?: string): boolean
  /** 用户按了重试：用**同一句话**再跑一轮。 */
  retry(prompt: string, promptMessageId: string): Promise<RunPromptResult>
  /** 当前是否有一份等待确认的草稿（任意一轮）。 */
  hasDraft(): boolean
}

/** 阶段 → 给用户看的一句话（与 `RunStatus` 里的表分开：这张用于**轨迹摘要**）。 */
export /**
 * **被拒原因 → 用户看得懂的一句话**（2026-10-05）。
 *
 * ## 为什么要在这一层做
 *
 * `RunStatus.tsx` 把被拒的提交渲染成「**提交失败：{detail}**」—— 前缀是中文，所以那句 `detail`
 * 本来就该是中文。而这个前缀**一直是中文、内容一直是英文**：
 * - 引擎侧给的是**给诊断与修复通道用的原话**（`draftStore.ts` 的
 *   `"the document changed since the draft was compiled"`、`agentRuntime.ts` 的 `` `${reason}: …` ``）；
 * - `RunStatus` 的**用例夹具**用的却是中文（`"文档已经被改过"`）—— 于是**测试看不出这个问题**。
 *
 * 这与本文件另一处的口径完全一致（`phase === "failed"` 那一支的注释）：
 * **"引擎的话是给诊断与修复通道用的，中文的用户话在这一层"** —— 提交被拒这一支此前漏了这一步。
 *
 * ## 两条纪律
 *
 * 1. **不认识的码也要说人话**：兜底是「提交被拒（原因码：X）」，不是把英文原话端出去；
 * 2. **原因码保留**：诊断与用户话不互相顶替 —— 用户看到中文解释，括号里留着可搜索的码。
 */
function commitFailureText(outcome: { status: string; detail?: string }): string {
  const reason = (outcome.detail ?? "").split(":")[0]?.trim() || outcome.status
  const known: Record<string, string> = {
    stale_source: "文档在草稿生成之后被改过，这次提交没有落下去。请重新生成草稿。",
    stale_conversation: "这份草稿属于另一段对话，不能在这里提交。",
    stale_preview: "预览已经过期（草稿之后又改过），请重新生成。",
    missing_consent: "这次提交没有带上同意凭据，已拒绝。",
    consumed_consent: "同意凭据是一次性的，已经用过了。请重新生成草稿再确认。",
    unminted_consent: "同意凭据不是系统发出的，已拒绝。",
    expired_consent: "同意凭据已经过期，请重新生成草稿再确认。",
    wrong_run: "同意凭据属于另一次运行，已拒绝。",
    unverified_diagram: "题设尚未核验，不能提交。",
    unknown_draft: "找不到这份草稿（可能已经被丢弃）。",
    commit_rejected: "这次提交被文档校验挡下了。"
  }
  const text = known[reason]
  return text === undefined ? `提交被拒（原因码：${reason}）。` : `${text}（原因码：${reason}）`
}

const PHASE_SUMMARY: Record<string, string> = {
  preflight: "检查环境与目标文档",
  observing: "读取当前场景",
  planning: "规划这一步要做什么",
  answering: "只读作答，不改文档",
  compiling: "把计划编译成动作并暂存草稿",
  validating: "校验暂存的草稿",
  awaiting_confirmation: "等你确认这份草稿",
  committing: "提交已确认的改动",
  completed: "完成",
  waiting: "需要你补充信息",
  failed: "没有完成",
  cancelled: "已取消",
  interrupted: "已中断"
}

/**
 * 一轮运行**提交时要用的落点**（Task 5）：会话、用户消息、以及这次创建出来的对象 id。
 *
 * 提交发生在运行结束之后（用户看预览、点确认），所以运行器自己留一份 ——
 * 商店里这一轮的落点那时可能已经被终态回执清掉了。
 */
interface PendingCommit {
  runId: string
  conversationId: string
  promptMessageId: string
  /**
   * 这一轮**收事件与回执的那条助手消息**。
   *
   * 长期记忆那一步跑在回执**之后**（Fix round 3 / I1），那时商店里这一轮的落点已经退休 ——
   * 所以"摘要被削了没有 / 写没写成功"这类诊断必须能按**显式 id** 落回这条消息上。
   */
  messageId: string
  createdObjects: string[]
}

function handleOf(document: GeometryDocument): DocumentHandle {
  return {
    projectId: "local",
    documentId: document.metadata.id,
    workspace: document.workspace as DocumentHandle["workspace"],
    epoch: `epoch:${document.metadata.id}`,
    generation: document.revision,
    contentHash: contentFingerprint(document)
  }
}

/**
 * **现在文档是第几版**（Fix round 2 / item 5）。
 *
 * 消息只在**第一次有内容**时落盘（幂等键），所以"追加那一刻的版本"就是这一列唯一诚实的值；
 * 运行器是唯一同时知道"这条消息"与"当前文档"的一层，所以由它读。
 */
function generation(): number {
  return useSceneStore.getState().document.revision
}

/**
 * **这一轮会话上下文的来源**（对话切片 Task 4；规格 §5.3）。
 *
 * 在运行**开始那一刻**读一次，之后整轮用它：绑定（会话 + 文档 + 版本）、结构化摘要、
 * 已确认事实、最近消息、以及那份**还没确认**的草稿视图。
 *
 * 三件事各自有理由：
 * - **会话按钉住的那条读，而不是"现在显示的那条"**（Fix round 1 / I1）：
 *   `selectPlanner` 在桌面端要过 IPC 问「使用中」的配置，用户完全可能在这个窗口里切走 ——
 *   而这一轮属于开始时钉住的那条会话（规格 §5.4）。读错会话的后果是
 *   "B 的历史与事实进了 A 这一轮的提示词，而事件写回 A"。
 * - **消息从界面状态取、摘要与事实从仓储取**：界面是这一轮说话的现场（包括刚发出去的那句），
 *   而摘要与事实是**存下来的**长期记忆 —— 它们存在的意义就是跨重启还在。
 * - **只带本文档的事实**：换工作区就是换文档，而事实表是会话级的（规格 §5.1）——
 *   别的文档确认的事实（"第 3 版新增 solid-1"）在这份文档里没有对应对象。
 * - **未确认的草稿只以视图形式进去**：草稿进的是 `draft` 字段，不是事实列表（规格 §1.2）。
 */
/**
 * **读会话记录，读不到就当作"还没有长期记忆"**（外部审查 A3）。
 *
 * 这一句原先直接写在 `readConversationSource` 里、且在它那个 try/catch **外面**，
 * 而桌面侧读会话记录是会**抛**的（`conversationRepository` 走 IPC）。
 * 一旦抛，`readConversationSource` 整个 reject ⇒ `agentRunner.run` 在协调器
 * **启动之前**就结束：界面上那条固定的助手消息永远停在 `pending`、输入框一直禁用，
 * 而 `AgentWorkspace` 的 `void onRun(...)` 把这个 rejection 吞掉了 ——
 * 用户看到的是"点了没反应"，且没有任何报错。
 *
 * 而它下面那句注释本来就写着"仓储读不到就当作还没有长期记忆，**不编**一份摘要或事实出来"。
 * 这里只是让那句话真的成立：吞掉异常、如实记一行诊断、按"没有长期记忆"继续跑。
 */
async function readConversationRecordSafely(conversation: { id: string } | undefined, runId?: string) {
  if (!conversation) return null
  try {
    return await conversationRepository().readRecord(conversation.id)
  } catch (error) {
    useAgentStore.getState().recordDiagnostic(`[context] could not read the stored conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`, runId)
    return null
  }
}

async function readConversationSource(pinnedConversationId: string | undefined, runId?: string): Promise<ConversationContextSource> {
  const document = useSceneStore.getState().document
  const state = useAgentStore.getState()
  const conversation = (pinnedConversationId ? state.conversations.find((candidate) => candidate.id === pinnedConversationId) : undefined) ?? state.activeConversation
  /**
   * **按证据重判一遍事实，再读长期记忆**（Follow-up：事实的 `stale` 路径）。
   *
   * 事实原先只有 `confirmed` 一种归宿：撤销掉那次改动、或者把那次创建出来的对象删掉之后，
   * "文档第 3 版新增 solid-1"照样是"已确认"，下一轮就拿着一个不存在的对象继续规划
   *（规格 §1.2：当前场景优先于旧记忆）。判据保守（只有文档本身能证明它不再成立，
   * 见 `conversationFacts`），结果**写回仓储**，所以它不只是这一轮的过滤器。
   *
   * 判不动（仓储读/写失败）不能让这一轮跑不起来：如实记一行诊断，按现有事实继续。
   */
  if (conversation) {
    try {
      const live = { documentId: document.metadata.id, revision: document.revision, objectIds: document.primitives.map((primitive) => primitive.id) }
      const stale = await useAgentStore.getState().revalidateFacts({ conversationId: conversation.id, live })
      if (stale.length > 0) useAgentStore.getState().recordDiagnostic(`[facts] conversation ${conversation.id}: ${stale.length} fact(s) no longer hold for document ${live.documentId}@${live.revision}: ${stale.join(", ")}`, runId)
    } catch (error) {
      useAgentStore.getState().recordDiagnostic(`[facts] could not revalidate the stored facts: ${error instanceof Error ? error.message : String(error)}`, runId)
    }
  }
  // 仓储读不到（浏览器里读的是同一份 localStorage 序列化器）就当作"还没有长期记忆"，
  // **不编**一份摘要或事实出来。读**失败**（桌面侧 IPC 抛错）走的也是同一条路 —— 见上面那个 helper。
  const record = await readConversationRecordSafely(conversation, runId)
  const draft = conversation ? awaitingDraftOf(conversation) : undefined
  const documentId = document.metadata.id
  /**
   * **摘要也按文档取**（Fix round 2 / C1 残余；规格 §5.1 + §9）。
   *
   * 存储形状是"一份文档一份摘要"（`summaryOfDocument`）；这里只取本次运行那份文档的那一份，
   * 别的文档那一份**端都不端出来** —— 否则"在立体几何里确认的事实"会以 `summary` 的形式
   * 出现在平面几何那一轮里（事实列表筛了，载体没筛等于没筛）。
   */
  const summary = record === null ? null : summaryOfDocument(record.summary, documentId)
  return {
    binding: {
      conversationId: conversation?.id ?? "local",
      projectId: state.binding.projectId,
      documentId,
      workspace: document.workspace as WorkspaceId,
      generation: document.revision
    },
    summary: summary === null ? "" : JSON.stringify(summary),
    // 只带**本文档**的、**还算数**的事实（`factBelongsToDocument` 与 `buildConversationContext`
    // 同一条判据）。`stale` / `retracted` 的那几条**不进来**：它们不是"现状"
    //（Follow-up：上面那次重判就是为此；`[context]` 那行计数也才说得出真话）。
    facts: (record?.facts ?? []).filter((fact) => fact.status === "confirmed" && factBelongsToDocument(fact, documentId)),
    messages: (conversation?.messages ?? []).flatMap((message) => message.text.trim().length > 0
      ? [{ id: message.id, role: message.role, text: message.text, createdAt: message.createdAt }]
      : []),
    ...(draft === undefined ? {} : { draft })
  }
}

/** 会话里**等待确认**的那份草稿视图（有草稿、还没回执、也没失败）。 */
function awaitingDraftOf(conversation: AgentConversation): ConversationDraftView | undefined {
  const awaiting = [...conversation.messages].reverse().find((message) => message.draft && !message.commit && !message.failure)
  const draft = awaiting?.draft
  if (!draft) return undefined
  return {
    draftId: draft.draftId,
    draftVersion: draft.draftVersion,
    previewHash: draft.previewHash,
    stageCount: draft.stageCount,
    ...(draft.assumptions === undefined ? {} : { assumptions: draft.assumptions })
  }
}

/**
 * 这条计划需要哪个工作区。
 *
 * 判据放在这里而不是从计划里"推断"：它取决于**动作名**，而动作名与工作区的对应关系
 * 是动作层的知识。目前有两类：
 * - `solid.*` / `section.*`（立体那两族）→ `geometry3d`；
 * - `planar.*` / `function.*` → `conics`（平面几何）。
 *
 * **`dynamic.*` 不投票**（2026-10-10 更正）。它此前与 `solid.*` 并列被算作"要立体几何"，
 * 依据是"动点绑在实体上"这个**最常见的用法**；但那不是这一族的性质：
 * `dynamic.create_bound_point` / `bind_curve` / `create_locus` 自己不要工作区，工作区由**宿主**决定
 * （绑在椭圆上是平面题，绑在棱柱的棱上是立体题），而宿主**总是同一份计划里的另一笔动作** ——
 * 所以"要不要立体几何"由 `solid.*` / `section.*` 那一笔记就够了。
 *
 * 让 `dynamic.*` 自己投一票的代价是**用户看得见**的：本地规划器在
 * 「椭圆…上任意点 P 处的切线 + 恒/定值」那句话上给出 `conicInvariantPlan`（椭圆 + 两轴 + 三个动点 + 切线），
 * 它因此被判成"又要平面又要立体"⇒ `prepareWorkspaceFor` **三维优先** ⇒ 一道圆锥曲线题被画在**立体几何**工作区里。
 * 而 3D 文档接受平面图元，图照样画得出来 —— **全量测试全绿，只有用户看得见工作区是错的**。
 * 判据在 `planWorkspaces.test.ts`（拿真夹具钉住）。
 *
 * **`function.*` 也去 `conics`，不是 `calculus`** —— 这一条是本文件里最容易写错、也最贵的一处：
 * DSL 的 `Workspace` 里确实有个 `calculus`，函数图像历史上也确实住在那里；
 * 但**它已经退役**（`App.test.tsx` 钉着"外壳里不再提供"，`draftStorage` 钉着"旧草稿不许重开它"，
 * `useAgentDocumentBinding` 只给三个在役工作区做绑定）。把 `function.*` 路由到 `calculus`，
 * 就是让 Agent 把用户切进一个界面上根本不存在的工作区 —— 而全量测试**不会**替你发现它，
 * 因为没有任何用例问过"这个动作该去哪个工作区"。**现在有了**（`planWorkspaces` 的用例）。
 *
 * **判据与动作顺序无关**。返回空数组表示"这次不需要切"（例如只读回答，或者只有 `dynamic.*` /
 * `parameter.*` 这类中性动作 —— 那时**不动**用户的工作区，比替他猜一个更诚实）。
 */
export function planWorkspaces(plan: PlanEnvelope): readonly ("conics" | "geometry3d")[] {
  if (plan.kind !== "plan") return []
  const wanted = new Set<"conics" | "geometry3d">()
  for (const action of plan.actions) {
    if (action.actionId.startsWith("solid.") || action.actionId.startsWith("section.")) wanted.add("geometry3d")
    else if (action.actionId.startsWith("planar.") || action.actionId.startsWith("function.")) wanted.add("conics")
  }
  return [...wanted]
}

/**
 * 把工作区切到计划需要的那个。
 *
 * **三维优先**：一条计划里既有平面动作又有立体动作时，目标只能是 `geometry3d` ——
 * `geometry3d` 的文档同样接受平面动作（`packages/dsl/src/schema.ts` 没有"工作区 ↔ 图元类型"的约束，
 * 动作编译器也只对立体那两族设了工作区守卫），反过来不成立。
 *
 * 以前这里是"循环里第一个命中就 `return`"，于是**动作顺序**决定了切到哪个工作区：
 * 一笔 `planar.*` 写在前面，后面那笔 `solid.create_prism` 就必然在编译器那里被拒
 *（用户现场：`compile_failed: workspace_mismatch: … a prism can only be created in the solid workspace`）。
 * 而模型**改不了文档的工作区**，所以账本里那次"一次性修复"救不回来，整轮以 `run_failed` 收场。
 *
 * **工程制图不参与自动切换**：在工图里说"建一个立方体"时，直接切走会让用户当前的图纸上下文消失，
 * 而这条指令本来就不属于那个工作区 —— 如实拒绝比悄悄切走更尊重用户。
 */
function prepareWorkspaceFor(plan: PlanEnvelope): { ok: true } | { ok: false; detail: string } {
  const wanted = planWorkspaces(plan)
  /**
   * **目标工作区按固定的偏好次序取，不用 `wanted[0]`。**
   *
   * `wanted` 是个**集合展开**，成员顺序来自动作在计划里的先后 —— 而那是模型随手写出来的。
   * 拿它决定切哪个工作区，就把"顺序决定行为"从门口放了回来（这个函数下面那段注释记着
   * 上一回同类事故：一笔 `planar.*` 写在前面，后面的立体动作必然被工作区守卫拒掉）。
   * 次序的理由：三维文档同样接受平面动作（反过来的包含关系不成立），所以先取 `geometry3d`；
   * 剩下的两个都在 2D 那一侧，取 `conics`（平面几何是这两族共同的家）。
   */
  const target = wanted.includes("geometry3d") ? "geometry3d" : wanted.includes("conics") ? "conics" : wanted[0]
  if (!target) return { ok: true }
  const current = useSceneStore.getState().document.workspace
  if (current === target) return { ok: true }
  if (current === "cad") {
    return { ok: false, detail: `这条指令需要在${target === "geometry3d" ? "立体几何" : "平面几何"}工作区执行；请先离开工程制图，或者在图纸里用绘图工具。` }
  }
  /**
   * **标明这是 Agent 自己切的工作区**（Fix round 1 / C1）：它是"执行这条计划"的副作用，
   * 不是用户换了上下文。App 那一层据此**不**把 Agent 区的会话列表换走 ——
   * 否则用户正在读的那条会话与它的确认面板会在这一轮还没落地时被换掉。
   */
  useSceneStore.getState().switchWorkspace(target, "agent")
  return { ok: true }
}

/**
 * 运行器的可替换依赖。
 *
 * `planner` 可注入的**唯一**理由是测试：要验证"规划器声明的假设真的走到确认界面上"，
 * 就得有一个会说假设的规划器，而本地确定性规划器**从不声明假设**（它产出的是固定动作）。
 * 生产路径不传它，用的仍是下面 `selectPlanner` 自动选出来的那一份。
 */
export interface AgentRunnerDependencies {
  planner?: PlannerPort
  /**
   * 模型规划器的注入点（测试用）。
   *
   * 生产的缺省值走真实 IPC（读「使用中」的那一份配置 + `provider_run`），
   * 而这两件事在浏览器里都不成立 —— 所以测试必须能替换它们，否则
   * "选中了模型服务就用模型"这条判据只能靠人去点。
   */
  modelPlanner?: ModelPlannerDependencies
}

/**
 * **这一轮由谁规划**。
 *
 * 三样东西必须一起决定，因为它们互相约束：谁来规划（`planner`）、
 * 上下文里给哪些动作（`requestedSkillIds`）、以及这次运行自述用哪个 profile
 *（`textProfileId` —— 它进 `RunContext`，是"这段文字是谁产生的"这个事实的落点）。
 */
export interface PlannerSelection {
  planner: PlannerPort
  requestedSkillIds: readonly string[]
  textProfileId: string
}

/**
 * 模型路径下请求哪些技能：**全部已登记的清单**。
 *
 * 本地规划器能精确说出"我这条指令要用哪份清单"，因为它的指令表是写死的；
 * 而模型路径**不可能在发请求之前**知道用户想要什么 —— 这一趟请求本身就是为了问它。
 * 所以这里的取舍是：把整张菜单给它，靠**别的东西**兜底。
 *
 * 兜底的东西是真实存在的三层：传输层 schema（未知动作 / 未知字段 / 未作用域引用一律拒）、
 * 动作编译器的语义校验、以及"写入必须经用户确认"。按关键词猜技能看起来更"省"，
 * 但猜错的代价是**某些任务永远做不了**（模型看不到那个动作，于是只能问用户），
 * 而那种失败在界面上看起来像"模型不会做这件事"。
 */
export const MODEL_PLANNER_SKILL_IDS: readonly string[] = SKILL_MANIFESTS.map((manifest) => manifest.id)

export function createAgentRunner(dependencies: AgentRunnerDependencies = {}): AgentRunner {
  let sequence = 0
  /** 这一轮是谁在规划（`waiting` 那条分支要靠它说人话）。 */
  let lastSelection: PlannerSelection | null = null
  /**
   * **按 `runId` 索引的运行状态**（Fix round 1 / C2）。
   *
   * 原先只有模块级**单槽** `runtime`/`pendingCommit`：每个新运行都会覆盖它，而确认面板是
   * **按消息**渲染的 —— 于是"在 A 里暂存草稿 → 切到 B 再暂存一份 → 回到 A 点确认"
   * 会提交 **B** 的草稿，并把回执与事实写进 B（规格 §5.4 要的正是"确认时检查会话"）。
   * 现在每一轮都留着它自己的运行时与落点，界面上那块面板说哪一轮就确认哪一轮。
   */
  const runs = new Map<string, { runtime: AgentRuntime; commit: PendingCommit }>()
  /** 最近一轮（老调用方不传 `runId` 时用它）。 */
  let lastRunId: string | null = null

  /**
   * 用户指的那一轮。
   *
   * 传了 `runId` 就必须是**已知的**一轮（不认识就如实拒绝）；没传就退回最近一轮。
   * 另外，会话必须还是**当前**会话：面板挂在 A 的对话记录里，用户看得见它，
   * 而"当前会话"是 A 才算数（规格 §5.4 的会话检查）。
   */
  function resolveRun(runId?: string): { runtime: AgentRuntime; commit: PendingCommit } | null {
    const id = runId ?? lastRunId
    if (id === null) return null
    const entry = runs.get(id)
    if (!entry) return null
    const active = useAgentStore.getState().activeConversation?.id
    if (active !== undefined && entry.commit.conversationId !== active) return null
    return entry
  }

  /** 一轮用掉了：从表里删掉（`lastRunId` 跟着挪到还在的那一轮）。 */
  function retireRun(runId: string): void {
    runs.delete(runId)
    if (lastRunId === runId) lastRunId = [...runs.keys()].at(-1) ?? null
  }

  /**
   * 选出这一轮要用的规划器。
   *
   * **「使用中」的那一份配置就是在这里被消费的**：`resolveActiveProvider` 现取它，
   * 拿到就用模型规划器，拿不到（浏览器 / 还没选 / 没密钥）就用本地确定性规划器 ——
   * 后者认不出就问用户，**绝不编答案**（这是 G2 Gate 里"生产路径不再有演示回复"那条的延续）。
   *
   * 解析结果被**钉住**（`resolveProvider: async () => resolution`）：一次运行里模型可能被问
   * 两次（含那次修复），两次必须用同一份配置与同一批能力证据，否则第二次尝试其实换了题目，
   * 事后没法判断"是模型改好了还是条件变了"。
   */
  async function selectPlanner(prompt: string, runId?: string): Promise<PlannerSelection> {
    // 注入的规划器优先（测试用）：它一被给出来，就不该再去问 IPC。
    if (dependencies.planner) return { planner: dependencies.planner, requestedSkillIds: [], textProfileId: "local-planner" }

    const resolution = await (dependencies.modelPlanner?.resolveProvider ?? resolveActiveProvider)()
    if (!resolution.ok) {
      // This opt-in path is only reachable after the user enables witness search;
      // a browser without a provider must not silently turn on diagram rescue.
      const options = { enableFreeApex: agentNextPhaseFlags().witnessSearch }
      return { planner: createLocalPlanner(options), requestedSkillIds: localIntentSkillIds(prompt, options), textProfileId: "local-planner" }
    }
    return {
      planner: createModelPlanner({
        ...dependencies.modelPlanner,
        resolveProvider: async () => resolution,
        /**
         * **模型原话留在本机诊断里**（2026-09-22，用户现场）：界面上那句失败文案只说得出"形状不对"，
         * 而"模型到底回了什么"是排查的唯一证据 —— 以前它被整个丢掉，只能靠猜。
         * 注入的 `onDiagnostic`（测试用）照旧转发。
         */
        onDiagnostic: (line) => {
          dependencies.modelPlanner?.onDiagnostic?.(line)
          useAgentStore.getState().recordDiagnostic(line, runId)
        }
      }),
      requestedSkillIds: MODEL_PLANNER_SKILL_IDS,
      textProfileId: resolution.provider.id
    }
  }

  /** 实现在下面单独定义，`retry` 直接调它 —— 不依赖 `this`（对象字面量的方法里用 `this` 太脆）。 */
  async function runPrompt(prompt: string, promptMessageId: string): Promise<RunPromptResult> {
      sequence += 1
      const runId = `run-${sequence}-${Date.now().toString(36)}`
      /**
       * **钉住这一轮的落点**（Task 5；规格 §5.4）：在**任何 await 之前**做 ——
       * 下面两行都要等 IPC（选配置、读会话），而用户完全可能在这段时间里切到别的会话。
       * 钉住了，这一轮的事件与回执就只会写回它开始时的那条会话。
       */
      const pinned = useAgentStore.getState().pinRun({ runId, promptMessageId })
      // 钉不住（那条消息已经不在了）时退回"当前在途"那条老路径，而不是把事件丢掉。
      const eventRunId = pinned ? runId : undefined
      // 这一轮的提交落点（运行结束之后确认时才用得上）。
      const commit: PendingCommit | null = pinned ? { runId, conversationId: pinned.conversationId, promptMessageId, messageId: pinned.messageId, createdObjects: [] } : null
      const selection = await selectPlanner(prompt, eventRunId)
      lastSelection = selection
      /**
       * 会话上下文在**建运行时之前**读一次：绑定、历史、摘要、事实、草稿视图都钉在这一刻。
       *
       * **必须按上面钉住的那条会话读**（Fix round 1 / I1）：`selectPlanner` 上面那一行刚 await 过
       * IPC，用户完全可能在这段时间里切到另一条会话 —— 而这一轮属于开始时钉住的那条。
       */
      const conversation = await readConversationSource(pinned?.conversationId, eventRunId)
      /**
       * **这一轮到底看到了多少会话历史**（计数，不是内容）。
       *
       * 它是"会话之间有没有串线"最直接的判据：同一轮里 `confirmed fact(s)` 与 `message(s)`
       * 都是**这条会话**的。当前这一句（`promptMessageId`）不算历史 —— 它是这一轮的输入，
       * 由 `PlanRequest.userMessage` 单独承载（`buildConversationContext` 也会去重）。
       * 写在开发者详细视图那一层（默认折叠），所以它既不打扰用户，也不需要模型服务 ——
       * 浏览器里本地确定性规划器走的是同一条路。
       */
      const history = conversation.messages.filter((message) => message.id !== promptMessageId)
      useAgentStore.getState().recordDiagnostic(`[context] conversation ${conversation.binding.conversationId}: ${conversation.facts.length} confirmed fact(s), ${history.length} message(s)`, eventRunId)
      const active = createAgentRuntime({
        // 每次现取：句柄里的内容哈希就是 Compare-and-Swap 的依据。
        readDocument: () => useSceneStore.getState().document,
        // 提交成功后落盘。用 `commitCandidate`（压一步历史）而不是 `replace`（清历史）。
        writeDocument: (candidate) => useSceneStore.getState().commitCandidate(candidate),
        readSceneDocuments: () => {
          const live = useSceneStore.getState().document
          return [{ handle: handleOf(live), document: live }]
        },
        // 这一轮由谁规划由 `selectPlanner` 决定（「使用中」的那份配置在它里面被消费）。
        planner: selection.planner,
        /**
         * **这条指令要用到的技能**（决定上下文里的可用动作）。
         *
         * 必须在**建运行时之前**算出来：上下文是发请求前组装的，而它一旦定下来就决定了
         * 模型能看到哪几个动作。本地规划器能精确知道自己要用哪份清单（`localIntentSkillIds`）；
         * 模型路径给全部清单（理由见 `MODEL_PLANNER_SKILL_IDS`）。
         */
        requestedSkillIds: selection.requestedSkillIds,
        /**
         * 编译之前把工作区切到这条计划需要的那个。
         *
         * 动作编译器会拒"工作区不匹配"的动作（立方体在平面几何里会被拒），
         * 而用户在 Agent 里说"建一个立方体"时画布可能停在平面几何。没有这一步，
         * 用户就得自己先切工作区再重发一次 —— 那不是对话式作图。
         *
         * 只对**有动作的计划**做切换：只读回答不需要目标工作区（协调器也不会为此调 `prepare`）。
         */
        prepare: (plan) => prepareWorkspaceFor(plan),
        // 导出预检要投影结果，只有工程制图那套组件知道怎么取。Agent 触发的导出建议
        // 暂时**如实**回"无法预检"，而不是给一个假的"可以导出"。
        exportPreflight: { preflight: () => ({ error: "export preflight is not wired into the agent path yet" }) },
        // 会话上下文：**一次运行只取一次**（协调器在组装上下文时调它），两次尝试共用同一份。
        conversation: () => conversation,
        /**
         * **观察层的诊断出口**（2026-09-21 派生诊断）。
         *
         * 观察决定"模型看到了什么"，而它在界面上没有症状 —— 所以观察层把"这一轮带走了哪些
         * 派生读数"写一行诊断，这里接进既有的诊断通道（与上面那条 `[context]` 同一处、
         * 同一个运行 id、同样默认折叠）。在浏览器里，这一行是唯一能断言**观察路径真的走过**
         * 的抓手：模型服务没接上时也照样写。
         */
        diagnostics: (line) => useAgentStore.getState().recordDiagnostic(line, eventRunId),
        // 同意绑定这一轮的会话；提交时与**当前**会话比对（Fix round 1 / C2；规格 §5.4）。
        ...(pinned === null ? {} : { conversationId: pinned.conversationId }),
        readConversationId: () => useAgentStore.getState().activeConversation?.id ?? null,
        projectId: "local",
        runId
      })
      /**
       * **把这一轮登记进按 `runId` 索引的表**（Fix round 1 / C2）。
       *
       * 每个新运行都覆盖模块级的单槽，而上面那些 `await`（选配置、读会话、跑模型）期间
       * 用户完全可能切到别条会话并又跑一轮 —— 那次新运行会把旧的一轮挤掉。
       * 登记之后，"确认/丢弃/停止"都能指回**用户点的那一轮**。
       */
      if (commit) {
        runs.set(runId, { runtime: active, commit })
        lastRunId = runId
      }

      const live = useSceneStore.getState().document
      const runContext: RunContext = {
        runId,
        // **钉住的那条会话**，不是"现在显示的那条"（Fix round 1 / I1）：运行账本、事件与事实
        // 都按它归属，而用户可以在这一轮还在跑的时候切走。
        conversationId: pinned?.conversationId ?? useAgentStore.getState().activeConversation?.id ?? "local",
        promptMessageId,
        target: handleOf(live),
        sources: [],
        // 这次运行自述用哪个 profile：模型路径下就是「使用中」的那一份的 id（真话）。
        textProfileId: selection.textProfileId,
        capabilityRevision: CAPABILITY_REGISTRY_REVISION,
        policyRevision: "local"
      }

      /**
       * **这次运行的验收条件从用户原话推出来**（Phase 3 / Task 3.3 的最后一步）。
       *
       * 门禁（`verificationGate`）早已接线并生效，但它此前**在真实运行里是惰性的** ——
       * 没有人声明过"这次要满足什么"，于是协调器那一侧根本不会去问门禁。
       *
       * **推不出来就一个都不声明**（`acceptance === undefined`）：门禁保持惰性，
       * 行为与接线之前逐字相同。这与"声明了空数组"是两回事 ——
       * 后者会被门禁拦下（"声明了但没有条件"的正确解读是**没有证据**）。
       * 这条区分很重要：把"原话里没有可判据的东西"当成"没有证据"，
       * 会让每一次闲聊式请求都以失败结束。
       */
      const acceptance = deriveAcceptance(prompt)
      /**
       * 这一轮用的提示词版本。**取一次、用在两处**（`start` 与痕迹落库）：
       * 两处各写一次 `SYSTEM_PROMPT_VERSION` 不会出错，但会让"这一轮用的是哪一版"
       * 在将来变成两个可以分别改动的地方。
       */
      const promptVersion = SYSTEM_PROMPT_VERSION

      for await (const event of active.coordinator.start({
        run: runContext,
        userMessage: prompt,
        // 计划 N4：把这一轮的开关状态一并交给 trace（开关由应用层持有，协调器只负责记下来）。
        nextPhaseFlags: agentNextPhaseFlags(),
        promptVersion,
        ...(acceptance.length === 0 ? {} : { acceptance })
      })) {
        // 每一步都回流：用户看到的是"走到哪一步"，而不是一个转圈。
        // 带上 `eventRunId`：用户切走之后，这一步仍然写回**它自己那条会话**（规格 §5.4）。
        useAgentStore.getState().recordRunEvent({
          phase: event.phase,
          status: event.phase === "failed" ? "error" : "ok",
          summary: event.detail || PHASE_SUMMARY[event.phase] || event.phase,
          at: event.at,
          ...(event.toolId === null ? {} : { toolId: event.toolId })
        }, eventRunId)
        /**
         * **另一层读者**：开发者详细视图（默认关着）。
         *
         * 只取账本已有的字段（用哪个阶段、从哪个阶段来、那句详情、第几步），
         * **不额外收集任何东西** —— 计划要求遥测不含模型推理与图像字节，而"只搬已有字段"
         * 是这条约束在实现层最省事的落法：这里根本没有可以塞进去的位置。
         */
        useAgentStore.getState().recordDiagnostic(`${event.sequence}. ${event.from} → ${event.phase}: ${event.detail}`, eventRunId)
        /**
         * **第三层读者：项目库里的账本**（Task 2.6）。
         *
         * 内存里那份诊断随会话消失，而"这次运行到底发生了什么"要能跨重启查。
         * 事件形状由 Rust 侧定死（`deny_unknown_fields`），所以这里只搬已有字段 ——
         * 与上面那条同一条纪律：**没有可以塞进去的位置**。
         *
         * **不 await**：账本是旁路，让它挡住这一步的推进没有任何好处（写失败会落到下面那句诊断里，
         * 而不是让运行停下来）。在浏览器里跑时它如实回 `no_desktop_shell`，那是预期状态，不报。
         */
        void appendRunEvent({
          eventId: `${runId}:${event.sequence}`,
          runId,
          conversationId: runContext.conversationId,
          phase: event.phase,
          status: event.phase === "failed" ? "error" : "ok",
          detail: event.detail || PHASE_SUMMARY[event.phase] || event.phase,
          at: event.at,
          promptMessageId,
          /**
           * **四个版本号取自账本事件本身**（`event.revisions`），而不是在这里重新取常量 ——
           * 客户端再取一次就是第二处真源，而"落库的版本号与账本里的不一致"是最难查的分叉
           *（两者都言之凿凿）。`policyRevision` 不在 `RunRevisions` 里，照旧从 runContext 取。
           */
          versions: {
            capabilityRevision: event.revisions.providerCapabilityRevision,
            policyRevision: runContext.policyRevision,
            promptVersion: event.revisions.promptVersion,
            toolRegistryRevision: event.revisions.toolRegistryRevision,
            actionSchemaRevision: event.revisions.actionSchemaRevision
          }
        }).then((result) => {
          // "没有桌面外壳"是**预期**（浏览器里账本不可用）；真的写失败要说出来 ——
          // 否则"账本里少了几行"永远没人会知道。
          //
          // **落在哪条消息上**：按这一轮**显式**的落点，而不是"当前在途的那条"
          //（Fix round 3：这一句回调回来时，草稿/回执往往已经让消息不再在途 ——
          // 老写法（不带 `runId`）会先找 `pendingReplyId`、再被"非在途不更新"挡掉，
          // 结果**静默丢掉**，正是这行想避免的事）。
          if (!result.ok && result.code === "ipc_failed") {
            if (pinned === null) useAgentStore.getState().recordDiagnostic(`[ledger] append failed: ${result.detail}`, eventRunId)
            else useAgentStore.getState().recordDiagnosticFor({ conversationId: pinned.conversationId, messageId: pinned.messageId }, `[ledger] append failed: ${result.detail}`)
          }
        })
      }

      /**
       * **工具痕迹落库**（Phase 6 / Task 6.1）。
       *
       * ## 为什么在循环**之后**写，而不是跟着事件流写
       *
       * `coordinator.toolTraces()` 只在运行结束时才完整（痕迹在协调器内部按调用累积），
       * 所以这里一次性写。**这是一条真实的耐久性差异**，如实写下来而不是留给别人踩：
       * 运行中途崩溃时，事件（流式写的）留下了，痕迹会丢。要让痕迹也抗崩溃，
       * 得让协调器把每条痕迹也作为事件发出来 —— 那是另一次改动，不在这里假装做到了。
       *
       * `eventId` 用 `${runId}:trace:${toolCallId}`：`toolCallId` 在一次运行内唯一
       * （幂等判据就是它），而前缀让痕迹行与账本事件行在同一个 `event_id` 空间里**不会撞号**。
       * 重放（重试、重启后补写）因此也是幂等的 —— 与事件同一条纪律。
       */
      for (const trace of active.coordinator.toolTraces()) {
        void appendRunEvent({
          eventId: `${runId}:trace:${trace.toolCallId}`,
          runId,
          conversationId: runContext.conversationId,
          phase: "tool_trace",
          status: trace.status,
          detail: `${trace.toolId}: ${trace.resultSummary}`,
          at: Date.now(),
          promptMessageId,
          versions: {
            capabilityRevision: runContext.capabilityRevision,
            policyRevision: runContext.policyRevision,
            promptVersion,
            toolRegistryRevision: TOOL_REGISTRY_REVISION,
            actionSchemaRevision: PLAN_SCHEMA_VERSION
          },
          trace: {
            toolCallId: trace.toolCallId,
            toolId: trace.toolId,
            inputSummary: trace.inputSummary,
            resultSummary: trace.resultSummary,
            status: trace.status,
            ...(trace.draftVersion === null ? {} : { draftVersion: trace.draftVersion }),
            ...(trace.verification === null ? {} : { verification: { status: trace.verification.status, checks: trace.verification.checks } }),
            ...(trace.diff === null ? {} : { added: trace.diff.added, removed: trace.diff.removed }),
            durationMs: trace.durationMs
          }
        }).then((result) => {
          // 与事件同一条纪律：浏览器里"没有桌面外壳"是**预期**；真的写失败要说出来。
          if (!result.ok && result.code === "ipc_failed") {
            if (pinned === null) useAgentStore.getState().recordDiagnostic(`[ledger] trace append failed: ${result.detail}`, eventRunId)
            else useAgentStore.getState().recordDiagnosticFor({ conversationId: pinned.conversationId, messageId: pinned.messageId }, `[ledger] trace append failed: ${result.detail}`)
          }
        })
      }

      const phase = active.coordinator.phase()
      const draftId = active.draftId()

      if (draftId && phase === "awaiting_confirmation") {
        // 草稿**只是视图**（标识 + 计数）；候选文档留在宿主侧，不进聊天记录。
        // 计数由宿主侧的 `preview()` 从**真实文档**算出（界面不自己数）。
        const preview = active.host.preview(draftId)
        // 这次**创建出来的对象 id**（候选文档 vs 当前文档的差集）：提交成功之后它们要进事实。
        // **只取 id**：候选文档本身一个字节都不离开这一层。
        if (commit && preview.ok) {
          const before = new Set(useSceneStore.getState().document.primitives.map((primitive) => primitive.id))
          commit.createdObjects = createdEntitiesOf(preview.artifact.candidate, before).slice(0, 24)
        }
        useAgentStore.getState().recordDraft({
          draftId,
          draftVersion: preview.ok ? preview.artifact.draftVersion : 1,
          previewHash: preview.ok ? preview.artifact.previewHash : "",
          stageCount: preview.ok ? preview.artifact.stageCount : 0,
          undoesInOneStep: true,
          counts: preview.ok ? preview.artifact.counts : undefined,
          baseCounts: preview.ok ? preview.artifact.baseCounts : undefined,
          diagramVerification: preview.ok ? preview.artifact.diagramVerification : undefined,
          promptNormalisation: preview.ok ? preview.artifact.promptNormalisation : undefined,
          // **形式证明那一次尝试**（§3-D）：关着时**连这个键都不写**（不是"值是 undefined"）——
          // 与草稿记录里那条口径一致，免得"默认路径逐字不变"在视图这一层被一个空键破坏。
          ...(preview.ok && preview.artifact.proofAttempt !== undefined ? { proofAttempt: preview.artifact.proofAttempt } : {}),
          // 假设在**计划解析成功那一刻**就知道，而草稿是运行结束之后才拿到的 —— 中间没有第二条路。
          assumptions: active.assumptions()
        }, eventRunId, generation())
        return { phase, draftId }
      }

      if (phase === "waiting") {
        /**
         * **把规划器真正问的那句话说出来**，而不是一句写死的"没有接入模型服务"。
         *
         * 那句话在接上模型之后就是**假话**：模型明明问了"半径是多少"，界面却告诉用户
         * "当前没有模型服务"。问题与假设同一处产生（计划解析那一刻），所以同一处取。
         */
        const questions = active.questions()
        /**
         * **没有"问题"时，把账本那句原话说出来**（外部审查 Agent-M4）。
         *
         * `waiting` 有两个来源：规划器给的澄清问题（那时 `questions()` 有值），
         * 以及"计划引用了本次观察没有的对象"（那条路径上 `questions()` 是空的）。
         * 原先后者只会落到那句写死的"这一步需要你补充信息。" —— 用户既不知道缺哪个对象、
         * 也无从回答（审计在 29 个对象的真实文档上撞到过：引用第 13 个对象就死在这里）。
         * 账本里那句话是**协调器自己写的**（`the plan needs objects this run did not observe: …`），
         * 直接转给用户就不会把信息丢掉。
         */
        const ledgerDetail = [...active.coordinator.ledger()].reverse().find((event) => event.phase === "waiting")?.detail
        useAgentStore.getState().failPendingReply({
          code: "needs_more_information",
          message: questions && questions.length > 0
            ? questions.join(" ")
            : ledgerDetail
              ? `这一步需要你补充信息：${ledgerDetail}`
              : `这一步需要你补充信息${lastSelection?.textProfileId === "local-planner" ? "。当前没有接入模型服务，本地规划器只认识几条固定指令" : ""}。`,
          retryable: false
        }, eventRunId, generation())
      } else if (phase === "failed") {
        const last = active.coordinator.ledger().at(-1)
        const detail = last?.detail || "这次运行没有完成。"
        /**
         * **"模型回的形状不对"要说成人话**（2026-09-22，用户现场）。
         *
         * 原先这一支把账本那句话原样端出去，用户看到的就是
         * `the plan never matched the schema: invalid_type@envelope` —— 一句内部码：
         * 既没说模型回的是什么形状（现在引擎那句 `detail` 里有了），也没说下一步能做什么。
         * 判据放在这一层而不是引擎里：引擎的话是给诊断与修复通道用的，中文的用户话在这一层
         *（与上面 `waiting` 那一支同一条口径）。
         */
        /**
         * **缺的是"图上没有的点"时，话要说给对的人**（2026-10-10，用户现场）。
         *
         * 题设是**系统自己**从原话抽的，点也是题面点到的 —— 用户早就点过名了，
         * "请补充明确点名"对他没有可操作性（真正缺的是图上那个**对象**）。
         * 系统只会补建位置被题设**唯一确定**的那些点（棱的中点、定比分点），
         * 所以这一支要说清"缺的是哪个点、以及系统为什么不补这一个"。
         */
        const incomplete = detail.includes("verification is incomplete:") ? (detail.split("verification is incomplete:").at(-1)?.trim() ?? "") : null
        useAgentStore.getState().failPendingReply({
          code: "run_failed",
          message: incomplete === null
            ? detail.includes("never matched the schema")
              ? `模型的回答不符合计划合同的形状，所以这一轮停下了。计划必须是一个 JSON 对象（schemaVersion / kind / goal，外加 actions 或 questions 或 answer）。引擎的原话：${detail}`
              : detail
            : incomplete.includes("点名缺失：")
              ? `题设还没核验，本次不会提交。${incomplete} 题面点到、图上却没有的点，系统只补建位置被题设唯一确定了的那几类（例如某条棱的中点、定比的分点）；这一点没能补上。`
              : `题设尚未核验，本次不会提交。${incomplete} 请补充明确点名，或改用受支持的条件表达。`,
          retryable: false
        }, eventRunId, generation())
      } else if (phase === "completed") {
        useAgentStore.getState().recordReceipt({ status: "no_change" }, eventRunId, generation())
      }

      // A failed verification may have staged an isolated preview, but it must
      // not remain confirmable by a later direct call. Only awaiting_confirmation
      // keeps its draft and run entry alive.
      if (commit) {
        active.discardDraft()
        retireRun(commit.runId)
      }
      // 这一轮到此为止（没有草稿要等确认）：清掉落点，之后迟到的事件一律丢弃。
      if (eventRunId !== undefined) useAgentStore.getState().endRun(eventRunId)
      return { phase, draftId: null }
  }

  return {
    run: runPrompt,

    confirm(runId) {
      /**
       * **只认用户点的那一轮**（Fix round 1 / C2；规格 §5.4）。
       *
       * 不认识的 `runId`、或者它的会话已经不是当前会话 → 如实拒绝（`stale_source` 那一类：
       * "世界变了，重新看一遍"），绝不替另一轮提交。
       */
      const entry = resolveRun(runId)
      if (!entry) return { status: "rejected", detail: runId === undefined ? "there is no run to confirm" : `run ${runId} is not waiting for a confirmation in the active conversation` }
      const { runtime: run, commit } = entry
      const outcome = run.confirmDraft()
      /**
       * **把"确认之后"那几步也回流进账本**（外部审查 A4）。
       *
       * `committing` / `completed` 是协调器在宿主确认**之后**补记的（见
       * `AgentCoordinator.settleConfirmation`），而**落库的 `run_events` 就是这份账本**。
       * 不回流的话，生产账本永远停在"等用户确认" —— 一份说"没提交"、而画布已经变了的事实记录。
       */
      for (const event of outcome.events ?? []) {
        useAgentStore.getState().recordRunEvent({
          phase: event.phase,
          status: event.phase === "failed" ? "error" : "ok",
          summary: event.detail || PHASE_SUMMARY[event.phase] || event.phase,
          at: event.at
        }, commit.runId)
      }
      // 只有宿主桥说成功才显示成功；被拒时**如实**把原因带回界面。
      useAgentStore.getState().recordReceipt(outcome.status === "committed"
        ? { status: "committed" }
        : outcome.status === "no_change"
          ? { status: "no_change" }
          : { status: "failed", detail: commitFailureText(outcome) }, commit.runId, generation())
      /**
       * **只有真的提交了才写长期记忆**（Task 5；规格 §1.2/§10）：
       * 代数与这次创建的对象进事实表，长会话顺带压缩摘要。
       * `no_change` / 被拒 / 用户丢弃都**不写** —— 那些情况下"事实"并没有发生。
       */
      if (outcome.status === "committed") {
        void useAgentStore.getState().recordCommittedRun({
          runId: commit.runId,
          conversationId: commit.conversationId,
          promptMessageId: commit.promptMessageId,
          // 回执已经落在它上面了：长期记忆那一步的诊断（摘要被削 / 写失败）按它落
          //（Fix round 3 / I1：这一步在回执之后，落点已经退休）。
          messageId: commit.messageId,
          // 事实属于**这次提交真正落上去的那份文档**（Agent 自己可能刚为这条计划切过工作区）。
          documentId: useSceneStore.getState().document.metadata.id,
          generation: useSceneStore.getState().document.revision,
          createdObjects: commit.createdObjects
        })
      }
      /**
       * **只有真的落定才把这一轮用掉**（Fix round 2 / item 3）。
       *
       * `committed` / `no_change` = 同意已经消费、草稿已经用掉 → 退休。
       * 被拒（`stale_source` / `stale_conversation` / `commit_rejected` …）时**留着**：
       * 面板还挂在界面上，用户再点一次要看到**真正的原因**，而不是
       * "run … is not waiting for a confirmation"（那句话把真实原因盖掉了，而且
       * `hasDraft()` 变成 false，界面就再也说不出"这里还有一份草稿"）。
       */
      if (outcome.status === "committed" || outcome.status === "no_change") {
        useAgentStore.getState().endRun(commit.runId)
        // 提交之后这份草稿就用掉了：不清掉的话再点一次确认会去提交一个已消费的凭据。
        retireRun(commit.runId)
      }
      return outcome
    },

    discard(runId) {
      const entry = resolveRun(runId)
      if (!entry) return false
      const { runtime: run, commit } = entry
      const discarded = run.discardDraft()
      // 丢弃**不产生任何事实**：那份草稿从来没有发生过（规格 §1.2）。
      useAgentStore.getState().recordReceipt({ status: "no_change" }, commit.runId, generation())
      useAgentStore.getState().endRun(commit.runId)
      retireRun(commit.runId)
      return discarded
    },

    /**
     * 用户按了停止。
     *
     * 取消由协调器负责传播（它会置位、abort 掉端口、并把账本收尾到 `cancelled`），
     * 而运行器**只**报告结果：如果这一轮已经结束（没有运行时实例），如实返回 `false`，
     * 不假装取消成功。
     */
    stop(runId) {
      const entry = resolveRun(runId)
      if (!entry) return false
      const { runtime: run, commit } = entry
      const result = run.coordinator.cancel("user")
      if (!result.cancelled) {
        // 这一轮已经结束了（协调器的账本已经收尾）：它不可能再等确认 —— **顺手收掉**，
        // 否则这一条会永远留在表里（Fix round 2 / 残余 3 的后半）。
        retireRun(commit.runId)
        useAgentStore.getState().endRun(commit.runId)
        return false
      }
      // 取消之后草稿也作废：留着它会让用户看到一份永远不会生效的预览。
      run.discardDraft()
      useAgentStore.getState().failPendingReply({ code: "cancelled_by_user", message: "已按你的要求停下。没有改动文档。", retryable: true }, commit.runId, generation())
      useAgentStore.getState().endRun(commit.runId)
      retireRun(commit.runId)
      return true
    },

    /** 重试 = 用同一句话再跑一轮。它**不**复用上一轮的草稿（那份已经作废了）。 */
    async retry(prompt, promptMessageId) {
      return runPrompt(prompt, promptMessageId)
    },

    hasDraft() {
      // 任意一轮还挂着草稿都算（用户可能在另一条会话里也暂存了一份）。
      return [...runs.values()].some((entry) => entry.runtime.draftId() !== null)
    }
  }
}

/**
 * 界面用的**单例**运行器。
 *
 * 为什么是模块级单例而不是 React 状态：草稿必须跨"运行结束 → 用户点确认"这两件事活着，
 * 而组件在切换模块时会卸载。放进组件状态会让"切走再切回来"丢掉等待确认的草稿。
 */
export const agentRunner = createAgentRunner()

/**
 * **把"现取当前文档版本"接到 store 上**（Follow-up item 3）。
 *
 * 用户提问那条消息由 `sendPrompt` 追加，而它的调用方在界面那一层（`AgentWorkspace`），
 * 手里没有文档句柄；运行器是同时知道"消息"与"文档"的那一层，所以由它在装配时把这个读口装上。
 * 装在模块作用域（与上面那个单例同一个位置）：任何真正跑过 Agent 的进程都 import 了这一层。
 */
setDocumentGenerationReader(() => useSceneStore.getState().document.revision)

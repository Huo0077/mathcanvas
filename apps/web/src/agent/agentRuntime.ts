import {
  createCommitterAdapter,
  createCoordinator,
  createSceneObservation,
  createSceneTools,
  createToolDispatcher,
  SKILL_MANIFESTS,
  type AgentCoordinator,
  type CommitOutcome,
  type CommitterPort,
  type DocumentHandle,
  type DraftStageOutcome,
  type DraftStorePort,
  type ExportPreflightPort,
  type ObserverPort,
  type PlanEnvelope,
  type PlannerPort,
  type SceneDocumentSnapshot,
  type SkillCatalog,
  type ToolResult
} from "@draw/agent-core"
import type { GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { createDraftStore, type DraftStore } from "./draftStore"
import { createHostBridge, type HostBridge } from "./hostBridge"

/**
 * **把 Agent 的各个部件真正组装起来**（Task 2.4 的宿主接线）。
 *
 * 到这里为止，协调器、草稿存储、宿主桥、工具、观察层、技能目录**各自都有测试**，
 * 但**没有一处把它们连起来** —— 也就是说，"这套东西能不能一起跑"此前从未被验证过。
 * 这个文件就是那处连接，并且它自己也有测试（用真实的部件，不用替身）。
 *
 * ## 一条边界
 *
 * 装配只能在 `apps/web` 做：`@draw/agent-core` 不能依赖 app 包（G0 Gate 第 5 条守的性质）。
 * 所以包里所有端口都是**注入**的，而"谁来注入"的答案就是这个文件。
 *
 * ## 装配时最容易搞错的三件事（都在下面注释里写明）
 *
 * 1. **句柄必须现取**：每次读 store 都重新算 `contentFingerprint`。缓存句柄会让
 *    Compare-and-Swap 永远通过 —— 那等于把整个 CAS 机制静默关掉。
 * 2. **同一个草稿存储实例**：协调器的 `CommitterPort` 与给模型看的 `DraftStorePort`
 *    必须共用**一个** `DraftStore`，否则模型看到的草稿与提交的是两个东西。
 * 3. **`replace` 只由宿主调用**：提交成功后用 store 的 `commitCandidate` 落盘，
 *    而不是让工具自己写。这条在 `HostBridge` 里已经定好，这里只是把真实的 store 接进去。
 */

export interface AgentRuntimeDependencies {
  /** 取**当前**活跃文档。每次调用现取，不要传快照。 */
  readDocument(): GeometryDocument | null
  /**
   * 提交成功后把候选文档落盘。
   *
   * 传的是**已提交的文档**（`HostBridge` 已经重放过动作），宿主只需写进去。
   * 用 `commitCandidate` 而不是 `replace`：前者压一步历史（撤销得回去），后者是"导入/新建"。
   */
  writeDocument(candidate: GeometryDocument): void
  planner: PlannerPort
  observer?: ObserverPort
  /** 导出预检：由 app 侧用真实的 `buildExportPlan` 实现（它需要投影结果，只有 app 知道怎么取）。 */
  exportPreflight: ExportPreflightPort
  /** 观察用的文档快照（目标 + 来源）。每次 `observe` 现取。 */
  readSceneDocuments(): SceneDocumentSnapshot[]
  projectId: string
  runId: string
  consentTtlMs?: number
  now?: () => number
  /**
   * **这次运行请求哪些技能**（`SKILL_MANIFESTS` 里的 id）。
   *
   * 缺省为空：**没有请求的技能就不进上下文**。技能是"这次允许模型用哪一小撮动作"的声明
   *（见 `skills/manifest.ts`），所以它必须由**知道用户想干什么**的那一层给出来，
   * 而不是由运行时把所有九个都塞进去 —— 把整张菜单摊开正是清单要解决的问题。
   *
   * 给了之后，清单里声明的 `actionIds` 会成为上下文里**唯一**的可用动作列表（见下）。
   */
  requestedSkillIds?: readonly string[]
  /**
   * 编译**之前**的一次准备机会，用来把工作区切到这条计划需要的那个。
   *
   * 可选：不传时协调器照常跑（工作区不匹配的动作会被编译器拒 —— 那是**如实**的失败）。
   */
  prepare?: (plan: PlanEnvelope) => { ok: true } | { ok: false; detail: string }
}

export interface AgentRuntime {
  coordinator: AgentCoordinator
  /** 给模型/工具用的草稿工具（与协调器**共用**同一个草稿存储）。 */
  draftTools: DraftStorePort
  drafts: DraftStore
  host: HostBridge
  committer: CommitterPort
  /** 观察工具，基于注入的场景快照。 */
  scene: ReturnType<typeof createSceneTools>
  /**
   * **只读工具的唯一入口**（Task 2.4 接线）。
   *
   * 为什么是方法而不是把 `scene` 直接递出去：调用方（将来的 provider 适配器 / worker）
   * 只应该按"工具名 + 参数"用工具，因为那正是**登记过、可校验、可记录**的那一层 ——
   * `toolDispatch.ts` 拒绝未登记的名字、拒绝畸形参数，并且**不认任何写文档的工具**。
   * 把 `scene` 递出去等于让调用方绕过这三道检查，直接拿到宿主内部对象。
   *
   * 场景是**现取**的：每个工具调用都重新读一次注入的文档快照，
   * 否则工具看到的会是运行开始那一刻的场景，而"过期检测"就是靠现取才成立的。
   */
  callTool(toolId: string, input: Record<string, unknown>): ToolResult<unknown>
  /** 这次运行正在用的草稿 id（没有则为 null）。界面靠它去取预览。 */
  draftId(): string | null
  /**
   * **规划器替用户做的假设**（已通过校验的计划里声明的那些）。
   *
   * 为什么由运行时保管而不是让界面自己找：假设在**计划解析成功那一刻**就知道，
   * 而界面是在运行**结束之后**才拿到草稿。中间隔着"编译 → 校验 → 等确认"，
   * 界面没有第二条路能拿到它 —— 除非再问一次规划器，那等于把模型跑两遍。
   *
   * 没有草稿的只读运行也会拿到假设（例如"我按直角理解这张图"），所以界面**不能**
   * 假设"有假设就一定有草稿"。
   */
  assumptions(): string[] | undefined
  /**
   * **规划器要问用户的问题**（`kind: "clarification"` 的计划里那些）。
   *
   * 与假设同一处产生、同一条理由：问题在计划解析那一刻就到手了，而它要被**显示出来** ——
   * 在此之前，界面只能显示一句写死的"当前没有接入模型服务"，而那在接上模型之后就是**假话**
   *（模型真的问了"半径是多少"，界面却说"没有模型服务"）。
   */
  questions(): string[] | undefined
  /**
   * 用户点了确认之后**真正落盘**。
   *
   * 两步都必须走宿主桥：先 `requestConsent` 铸造一次性凭据，再 `commit` 提交。
   * 界面上那个按钮**没有**绕过这一层的能力 —— 它只能调这个方法，而这个方法只能调宿主桥。
   */
  confirmDraft(): CommitOutcome
  /** 用户点了丢弃：草稿失效，文档一个字节都不动。 */
  discardDraft(): boolean
  /** 供诊断：一次运行之后看宿主桥记下了什么。 */
  hostBridge(): HostBridge
}

function handleFor(document: GeometryDocument, projectId: string): DocumentHandle {
  // 每次现算：句柄里的内容哈希就是 CAS 的依据，缓存它就等于关掉 CAS。
  return {
    projectId,
    documentId: document.metadata.id,
    workspace: document.workspace as DocumentHandle["workspace"],
    epoch: `epoch:${document.metadata.id}`,
    generation: document.revision,
    contentHash: contentFingerprint(document)
  }
}

export function createAgentRuntime(dependencies: AgentRuntimeDependencies): AgentRuntime {
  const drafts = createDraftStore()

  const live = () => {
    const document = dependencies.readDocument()
    return document ? { handle: handleFor(document, dependencies.projectId), document } : null
  }

  // ---- 宿主桥：唯一能写文档的入口。它自己做同意检查与 CAS。 ----
  const host = createHostBridge({
    drafts,
    live,
    replace: (candidate) => dependencies.writeDocument(candidate),
    runId: dependencies.runId,
    now: dependencies.now,
    consentTtlMs: dependencies.consentTtlMs
  })

  // ---- 草稿工具：**共用同一个 `drafts`**，否则模型看到的草稿与提交的不是一回事。 ----
  const draftTools: DraftStorePort = {
    create(baseHandle) {
      const record = drafts.create(dependencies.readDocument() ?? ({} as GeometryDocument), baseHandle)
      return { draftId: record.draftId, draftVersion: record.draftVersion, previewHash: "" }
    },
    stage(draftId, actions, expectedDraftVersion) {
      // `DraftStore` 的签名收可变数组（它会与已有动作拼接），这里把只读入参拷一份。
      const result = drafts.stage(draftId, [...actions], expectedDraftVersion)
      if (!result.ok) {
        const failure: DraftStageOutcome = { ok: false, reason: result.reason, diagnostics: result.diagnostics ?? [], detail: result.detail, unchanged: true }
        return failure
      }
      return { ok: true, diagnostics: [], handle: { draftId, draftVersion: result.preview.draftVersion, previewHash: result.preview.previewHash }, unchanged: false }
    },
    preflight(actions) {
      // 只校验不落草稿：用一个临时草稿走同一套编译，然后立刻失效掉它。
      const base = dependencies.readDocument()
      if (!base) return { ok: false, diagnostics: [{ code: "no_document", message: "there is no active document" }], detail: "there is no active document" }
      const probe = drafts.create(base, handleFor(base, dependencies.projectId))
      const result = drafts.stage(probe.draftId, [...actions], probe.draftVersion)
      // `DraftStore` 只有 `invalidate`（不是 `discard`）：它把草稿从表里删掉并记下原因。
      drafts.invalidate(probe.draftId, "preflight probe")
      return result.ok
        ? { ok: true, diagnostics: [] }
        : { ok: false, diagnostics: result.diagnostics ?? [], detail: result.detail }
    },
    /**
     * `DraftStore` 没有"丢弃"这个方法 —— 它的 `invalidate(draftId, reason)` 就是丢弃
     * （删掉记录并记下原因）。所以这里映射过去，并**如实返回**是否真的丢弃了。
     */
    discard(draftId) {
      const existed = drafts.getPreview(draftId) !== null
      if (existed) drafts.invalidate(draftId, "discarded by a tool")
      return existed
    }
  }

  // ---- 观察：每次现取快照，不缓存（缓存会让"过期"检测失效）。 ----
  const observer: ObserverPort = dependencies.observer ?? {
    async observe() {
      const documents = dependencies.readSceneDocuments()
      const scene = createSceneTools(createSceneObservation(documents))
      const target = live()
      const facts: { id: string; text: string; origin: "user" | "inferred" | "assumed" }[] = []
      let summary = "no document in scope"
      if (target) {
        const inspected = scene.inspect(target.handle.documentId)
        summary = inspected.summary
        // 可确认的事实就是"场景里确实存在的对象"，逐条带上来源文档，供计划引用。
        for (const entity of inspected.payload) facts.push({ id: entity.entityId, text: entity.label, origin: "user" })
      }
      /**
       * **`facts` 必须一起交出去**（2026-09-21 补）。
       *
       * 上面那个数组从第一版起就在算，但**没有进返回值** —— 于是协调器组装上下文时
       * `observation.facts` 是 `undefined`，模型看到的事实只剩一串实体 id
       *（"有一个事实 point-1"），看不到它的文本（"点 A"）。
       *
       * 这类缺口很难在代码评审里发现：数组本身写得对、类型也对，只是**没被交出去**，
       * 而"没有事实文本"在界面上没有任何症状 —— 只有在接上模型之后才会表现为
       * "它总是问用户这是什么对象"。是给 `Observation.facts` 补形状时顺出来的。
       */
      return { factIds: facts.map((fact) => fact.id), summary, facts }
    }
  }

  const committer = createCommitterAdapter({ drafts, host, live })

  /**
   * **技能 → 可用动作**（Task 2.2 Step 2/4 的接线）。
   *
   * 为什么在运行时这一层做，而不是让调用方给一串 `availableActions`：
   * 调用方给字符串数组就等于**绕过了清单**（它可以声明任何动作名），而清单正是
   * "这次允许用哪一小撮"的那份声明。这里改成"调用方说请求哪些技能，运行时去清单里取动作"，
   * 于是动作集合**只能**来自签入的清单。
   *
   * 未登记的技能 id 在这里就被丢掉（不进 `requestedSkillIds`），因此不会在上下文里
   * 变成一条 `skill_unregistered` 警告 —— 那类警告是给"清单本身有问题"用的，
   * 不该由调用方打错一个 id 触发。
   */
  const requestedSkillIds = (dependencies.requestedSkillIds ?? []).filter((id) => SKILL_MANIFESTS.some((manifest) => manifest.id === id))
  const availableActions = [...new Set(SKILL_MANIFESTS.filter((manifest) => requestedSkillIds.includes(manifest.id)).flatMap((manifest) => manifest.actionIds))]

  /**
   * 规划器声明的假设，由协调器在**计划通过校验**时交过来（见 `onPlanParsed`）。
   *
   * 每次运行新建一个运行时，所以这里不需要清理 —— 上一轮的假设不会漏到这一轮。
   */
  let declaredAssumptions: string[] | undefined
  /** 规划器要问用户的问题（同上，一条路径）。 */
  let declaredQuestions: string[] | undefined

  const coordinator = createCoordinator({
    planner: dependencies.planner,
    observer,
    committer,
    prepare: dependencies.prepare,
    onPlanParsed: (plan) => {
      declaredAssumptions = plan.assumptions
      // 只有澄清分支才有问题；另外两个分支即使带 `questions` 也不是合法的信封（schema 会拒）。
      declaredQuestions = plan.kind === "clarification" ? [...plan.questions] : undefined
    },
    requestedSkillIds,
    availableActions,
    consent: undefined // 同意凭据由宿主在用户确认后创建，协调器不构造它。
  })

  return {
    coordinator,
    draftTools,
    drafts,
    host,
    committer,
    scene: createSceneTools(createSceneObservation(dependencies.readSceneDocuments())),
    /**
     * 每个工具调用都**现取**场景：缓存快照会让工具看到"运行开始那一刻"的场景，
     * 而观察层的过期检测正是靠现取才成立的。
     */
    callTool: (toolId, input) => createToolDispatcher({ scene: createSceneTools(createSceneObservation(dependencies.readSceneDocuments())) }).call(toolId, input),
    draftId: () => committer.draftIdFor(),
    assumptions: () => declaredAssumptions,
    questions: () => declaredQuestions,
    confirmDraft() {
      const id = committer.draftIdFor()
      /**
       * **拒绝时说出运行时知道的事实**（2026-09-21）。
       *
       * 原先只有一句"没有草稿可确认"，而它在真机上出现时**界面上明明有草稿面板** ——
       * 一句话同时要解释"面板为什么在"与"运行时为什么说没有"，谁也猜不出来。
       * 协调者的相位正是那个能区分原因的事实：如果相位是 `awaiting_confirmation` 而没有草稿 id，
       * 说明被点的那份运行时**不是**跑出草稿的那一份（模块级字段被换过）；如果相位不是它，
       * 说明这一次运行根本没走到暂存。**把事实说出来，而不是让人猜。**
       */
      if (!id) return { status: "rejected" as const, detail: `there is no staged draft to confirm (coordinator phase: ${coordinator.phase()})` }
      const consent = host.requestConsent(id)
      if (!consent.ok) {
        // 没有可授权的预览（例如草稿已经失效）→ 如实拒绝，而不是硬着头皮提交。
        return { status: "rejected" as const, detail: `cannot mint consent for ${id}: ${consent.reason}` }
      }
      const result = host.commit(id, consent.record)
      if (result.ok) return { status: result.receipt.changed ? "committed" as const : "no_change" as const }
      if (result.reason === "stale_source") return { status: "stale_source" as const, detail: result.detail }
      return { status: "rejected" as const, detail: `${result.reason}${result.detail ? `: ${result.detail}` : ""}` }
    },
    discardDraft() {
      const id = committer.draftIdFor()
      if (!id) return false
      const existed = drafts.getPreview(id) !== null
      if (existed) drafts.invalidate(id, "discarded by the user")
      return existed
    },
    hostBridge: () => host
  }
}

export type { DraftStore, SkillCatalog }

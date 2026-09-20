import {
  createCommitterAdapter,
  createCoordinator,
  createSceneObservation,
  createSceneTools,
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
  type SkillCatalog
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
  /** 这次运行正在用的草稿 id（没有则为 null）。界面靠它去取预览。 */
  draftId(): string | null
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
      return { factIds: facts.map((fact) => fact.id), summary }
    }
  }

  const committer = createCommitterAdapter({ drafts, host, live })

  const coordinator = createCoordinator({
    planner: dependencies.planner,
    observer,
    committer,
    prepare: dependencies.prepare,
    consent: undefined // 同意凭据由宿主在用户确认后创建，协调器不构造它。
  })

  return {
    coordinator,
    draftTools,
    drafts,
    host,
    committer,
    scene: createSceneTools(createSceneObservation(dependencies.readSceneDocuments())),
    draftId: () => committer.draftIdFor(),
    confirmDraft() {
      const id = committer.draftIdFor()
      if (!id) return { status: "rejected" as const, detail: "there is no staged draft to confirm" }
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

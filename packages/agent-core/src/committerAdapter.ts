import { createDocumentHandle, type DocumentHandle } from "@draw/scene-graph"

import type { CommitOutcome, CommitRequest, CommitterPort, ConsentToken } from "./coordinatorPorts"
import type { PlanDiagnostic, RepairRequest, StructuredAssumption } from "./contracts"

/**
 * **把协调器的 `CommitterPort` 接到 G0.5 的 `DraftStore` + `HostBridge`**（Task 2.4 的接线）。
 *
 * 这是整条链上**唯一**能写文档的地方，所以它必须满足三条：
 *
 * 1. **暂存只产生隔离草稿**：`stage` 走 `DraftStore.create` + `DraftStore.stage`，
 *    真文档一个字节都不动。
 * 2. **提交必须带用户同意**：`commit` 委托给 `HostBridge.commit`，而 `HostBridge` 会检查
 *    同意记录（一次性、绑定预览哈希、会过期、绑定 runId）并做 Compare-and-Swap。
 *    **这里不复制那套判断** —— 复制就是把安全边界摊成两份，必然分叉。
 * 3. **失败如实上报**：`stage` 的原因码原样映射（`stale_draft_version` 与手工编辑后的
 *    `stale_source` 是两回事，不能合并），`commit` 的拒绝原因也原样带出。
 *
 * ## 为什么适配器要有记忆（`draftForRun`）
 *
 * 协调器按"运行"工作（`stage` 一次、`commit` 一次），而 `HostBridge.commit` 要的是
 * **草稿 id**。两者的对应关系只有这里知道，所以适配器记住"这次运行用的是哪个草稿"。
 * 记不住的话第二次阶段调用会新建一个草稿，`commit` 就会提交一个用户没看过的预览。
 */

/** 适配器需要的草稿存储面（与 G0.5 的 `DraftStore` 一致，用结构类型避免跨包依赖）。 */
export interface DraftStoreLike {
  create(base: unknown, baseHandle?: DocumentHandle): { draftId: string; draftVersion: number }
  /**
   * 第四个参数是**用户原话**（Fix round 1 / C3）：暂存就是编译，而参数审计要看用户说了什么
   *（"任意/恒定"要保留符号参数、没说全的尺寸要从原话里读）。可选，因为不是每个调用方都有原话。
   *
   * **返回 `Promise`**（方案 3）：编译可以被交给几何 Worker，而 Worker 是异步的。
   * 这一层本来就是 `async`（`CommitterPort.stage` 返回 `Promise`），所以只是把 `await` 加到调用点。
   */
  stage(draftId: string, actions: readonly unknown[], expectedDraftVersion: number, userMessage?: string): Promise<
    | { ok: true; preview: { draftVersion: number; previewHash: string } }
    | {
        ok: false
        reason: "unknown_draft" | "stale_draft_version" | "compile_failed"
        diagnostics?: { code: string; message: string }[]
        detail?: string
        /**
         * **编译器给的一次性修复请求**（`compilePlan` 的 `repair`）。
         *
         * 为什么它必须在这一层就有形状：适配器是协调器与草稿存储之间**唯一**的一段代码，
         * 而修复请求只有草稿存储那一侧（真的调了 `compilePlan` 的那一侧）才拿得到。
         * 少了它，"编译失败 → 把修复请求发回模型"这条路径在适配器里就断了。
         */
        repair?: RepairRequest
        /** 编译器的逐层诊断（层 + 原因码 + 路径），供提示说清卡在哪一层。 */
        planDiagnostics?: readonly PlanDiagnostic[]
        /** 编译器在失败前补出来的假设（见 `PlanRequest.repair.assumptions`）。 */
        assumptions?: readonly StructuredAssumption[]
      }
  >
  /** 基础文档变了（手工编辑 / 撤销 / 切工作区）→ 草稿过期。 */
  assertFresh?(draftId: string, liveHandle: DocumentHandle): { ok: true } | { ok: false; reason: "stale_source"; detail: string }
}

/** `HostBridge` 里适配器用到的部分。 */
export interface HostBridgeLike {
  preview(draftId: string): { ok: true; artifact: { draftVersion: number; previewHash: string } } | { ok: false; reason: "unknown_draft" }
  requestConsent(draftId: string): { ok: true; record: unknown } | { ok: false; reason: "unknown_draft" }
  commit(draftId: string, consent: unknown): { ok: true; receipt: { changed: boolean; draftId: string } } | { ok: false; reason: string; detail?: string }
}

export interface CommitterAdapterDependencies {
  drafts: DraftStoreLike
  host: HostBridgeLike
  /** 取**当前**活跃文档的句柄 + 本体。每次调用现取，不用快照（快照会让 CAS 永远通过）。 */
  live(): { handle: DocumentHandle; document: unknown } | null
}

export interface CommitterAdapter extends CommitterPort {
  /** 这次运行正在用的草稿 id（没有则为 null）。供诊断与 UI 使用。 */
  draftIdFor(): string | null
}

/**
 * 同意凭据在协调器里是**不透明**的（它不构造、也不读）。适配器把它原样转交给 `HostBridge` ——
 * 也**不**检查它，因为检查是 `HostBridge` 的职责，这里再看一遍只会造出第二个真相。
 */
function passThroughConsent(consent: ConsentToken): unknown {
  return consent
}

export function createCommitterAdapter(dependencies: CommitterAdapterDependencies): CommitterAdapter {
  let draftId: string | null = null

  return {
    draftIdFor: () => draftId,

    async stage(request: CommitRequest) {
      const live = dependencies.live()
      if (!live) return { ok: false, reason: "unsupported" as const, detail: "there is no active document to draft against" }

      // 第一次阶段调用建草稿；之后复用同一个 —— 否则 `commit` 会提交一个用户没看过的预览。
      if (draftId === null) {
        draftId = dependencies.drafts.create(live.document, live.handle).draftId
      }

      // 手工编辑过的基础文档 → 草稿过期。**不静默重建**：重建等于把用户看过的预览换掉。
      const freshness = dependencies.drafts.assertFresh?.(draftId, live.handle)
      if (freshness && !freshness.ok) return { ok: false, reason: "stale_draft" as const, detail: freshness.detail }

      const preview = dependencies.host.preview(draftId)
      const expectedVersion = preview.ok ? preview.artifact.draftVersion : 1

      const staged = await dependencies.drafts.stage(draftId, request.actions, expectedVersion, request.userMessage)
      if (!staged.ok) {
        const detail = staged.detail ?? staged.diagnostics?.map((entry) => `${entry.code}: ${entry.message}`).join("; ")
        // 原因码原样映射：`stale_draft_version`（版本对不上）与 `stale_draft`（基础文档变了）是两回事。
        if (staged.reason === "stale_draft_version") return { ok: false, reason: "stale_draft_version" as const, detail }
        /**
         * `compile_failed` 带**编译器的那一份**（Agent DSL 切片 Task 4 的接线）：
         * `repair` 是"允许改哪几处"的唯一真源，`planDiagnostics` 说清卡在哪一层，
         * `assumptions` 是编译到一半已经替用户定下来的东西。三者都原样转交，
         * 适配器**不解释、不改写**它们（改写等于在这里造第二份判据）。
         */
        if (staged.reason === "compile_failed") {
          return {
            ok: false,
            reason: "compile_failed" as const,
            detail,
            ...(staged.repair === undefined ? {} : { repair: staged.repair }),
            ...(staged.planDiagnostics === undefined ? {} : { planDiagnostics: staged.planDiagnostics }),
            ...(staged.assumptions === undefined ? {} : { assumptions: staged.assumptions })
          }
        }
        return { ok: false, reason: "unsupported" as const, detail: detail ?? staged.reason }
      }

      return { ok: true, draftVersion: staged.preview.draftVersion, previewHash: staged.preview.previewHash }
    },

    async commit(request: CommitRequest & { consent: ConsentToken }): Promise<CommitOutcome> {
      if (draftId === null) return { status: "rejected", detail: "no draft was staged for this run" }

      const result = dependencies.host.commit(draftId, passThroughConsent(request.consent))
      if (result.ok) {
        // `changed: false` 是"没什么需要改"，不是失败 —— 协调器据此走 `no_change` 而不是报错。
        return { status: result.receipt.changed ? "committed" : "no_change" }
      }

      // 拒绝原因原样带出：`stale_source`（文档被动过）与 `missing_consent`（没授权）完全不同。
      if (result.reason === "stale_source") return { status: "stale_source", detail: result.detail }
      return { status: "rejected", detail: `${result.reason}${result.detail ? `: ${result.detail}` : ""}` }
    }
  }
}

/** 便捷构造函数：从"实时读 store"的闭包建句柄，避免调用方各处手写 `createDocumentHandle`。 */
export function handleOf(document: { metadata: { id: string }; workspace: string; revision: number }, projectId: string, epoch?: string): DocumentHandle {
  return createDocumentHandle(document as never, projectId, epoch)
}

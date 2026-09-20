import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"

import { contentFingerprint } from "./transactions"

/**
 * **作用域来源上下文**（Task 0.6，设计规格 §6）。
 *
 * 存在的理由是一个真实缺陷：投影结果只带 `sourceId`，不带 `documentId`，
 * 于是 CAD 布局文档与几何文档里一旦出现同名 id，就没有任何办法说清"这个点来自哪一份文档"。
 * 显示、选择、工程标注、诊断与导出**必须解析同一个来源**，而不是各查各的文档。
 *
 * 三条纪律：
 * 1. 引用**必须带 `documentId`** —— 名称不是 ID；
 * 2. 句柄带**内容哈希**：文档在拿到句柄之后被改过，来源就判为 `stale_source`，
 *    **绝不静默回退**到"当前文档"（静默回退会让用户看到一个不是他要的模型）；
 * 3. 不在上下文里的文档直接 `document_not_in_context`。
 */

/** 与 `@draw/agent-core` 的同名类型保持一致：Agent 侧引用它，UI 侧产出它。 */
export interface DocumentHandle {
  projectId: string
  documentId: string
  workspace: GeometryDocument["workspace"]
  epoch: string
  generation: number
  contentHash: string
}

export interface EntityRef {
  documentId: string
  entityId: string
}

export interface SourceContext {
  layout: DocumentHandle
  geometry: DocumentHandle
  viewId?: string
}

/** 解析一个引用所需的**当前文档内容**；与句柄分开传，正是为了让"过期"可被检测。 */
export interface SourceDocuments {
  layout: GeometryDocument
  geometry: GeometryDocument
}

export type ResolvedEntity =
  | { kind: "primitive"; documentId: string; primitive: PrimitiveSpec }
  /** 由模板物化出来的顶点/棱/面：单独查不到，但**必须能追溯到所属实体**。 */
  | { kind: "generated"; documentId: string; ownerId: string; childId: string }

export type SourceUnavailableReason = "document_not_in_context" | "entity_not_found" | "stale_source" | "source_unavailable"

export type ResolvedEntityResult =
  | { ok: true; handle: DocumentHandle; entity: ResolvedEntity }
  | { ok: false; reason: SourceUnavailableReason; detail: string }

/**
 * `epoch` 表示"这份文档是被导入/替换过的哪一世"。默认由文档 id 派生
 *（导入会产生新 id，所以默认情况下"新 epoch"天然成立）；
 * 但**允许由调用方显式给出** —— 同一份文档被重新导入（id 不变、内容整体替换）时，
 * 只有上层服务知道 epoch 变了，句柄本身推不出来。
 */
function epochOf(document: GeometryDocument, override?: string): string {
  return override ?? `epoch:${document.metadata.id}`
}

export function createDocumentHandle(document: GeometryDocument, projectId: string, epochOverride?: string): DocumentHandle {
  return {
    projectId,
    documentId: document.metadata.id,
    workspace: document.workspace,
    epoch: epochOf(document, epochOverride),
    generation: document.revision,
    contentHash: contentFingerprint(document)
  }
}

/**
 * 不是实体的记录：它们没有可投影的视觉表现，引用它们应当如实报 `entity_not_found`，
 * 而不是当成一个"有几何的对象"参与计数。
 */
const NON_ENTITY_TYPES = new Set(["measurement3", "annotation", "engineeringAnnotation", "constraint", "parameter"])

function handleFor(context: SourceContext, documentId: string): DocumentHandle | null {
  if (context.layout.documentId === documentId) return context.layout
  if (context.geometry.documentId === documentId) return context.geometry
  return null
}

function documentFor(context: SourceContext, documents: SourceDocuments, documentId: string): GeometryDocument | undefined {
  if (context.layout.documentId === documentId) return documents.layout
  if (context.geometry.documentId === documentId) return documents.geometry
  return undefined
}

/** 生成拓扑的子 id：`<ownerId>-point-1` / `-edge-1` / `-face-1`（模板物化的命名约定）。 */
function ownerOfGenerated(document: GeometryDocument, childId: string): string | undefined {
  return document.primitives
    .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "polyhedron3" }> => primitive.type === "polyhedron3")
    .find((solid) => solid.vertexIds.includes(childId) || solid.edgeIds.includes(childId) || solid.faceIds.includes(childId))
    ?.id
}

export function resolveSourceEntity(context: SourceContext, ref: EntityRef, documents: SourceDocuments): ResolvedEntityResult {
  const handle = handleFor(context, ref.documentId)
  if (!handle) {
    return { ok: false, reason: "document_not_in_context", detail: `document ${ref.documentId} is not part of this source context` }
  }
  const document = documentFor(context, documents, ref.documentId)
  if (!document) {
    return { ok: false, reason: "source_unavailable", detail: `document ${ref.documentId} has no content in this session` }
  }
  // 句柄说"当时是这一版"，而当前内容已经不是那一版 → 来源过期，调用方必须重算而不是猜。
  if (contentFingerprint(document) !== handle.contentHash) {
    return { ok: false, reason: "stale_source", detail: `document ${ref.documentId} changed since the handle was taken` }
  }

  const primitive = document.primitives.find((candidate) => candidate.id === ref.entityId)
  if (primitive) {
    if (NON_ENTITY_TYPES.has(primitive.type)) {
      return { ok: false, reason: "entity_not_found", detail: `${ref.entityId} is a record, not a drawable entity` }
    }
    return { ok: true, handle, entity: { kind: "primitive", documentId: ref.documentId, primitive } }
  }

  const ownerId = ownerOfGenerated(document, ref.entityId)
  if (ownerId) return { ok: true, handle, entity: { kind: "generated", documentId: ref.documentId, ownerId, childId: ref.entityId } }

  return { ok: false, reason: "entity_not_found", detail: `no entity ${ref.entityId} in document ${ref.documentId}` }
}

/** 上下文里**可以**出现的引用目标：供"显示与导出使用同一来源"的对账使用。 */
export function contextHandles(context: SourceContext): DocumentHandle[] {
  return [context.layout, context.geometry]
}

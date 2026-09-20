import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import type { DocumentHandle, ToolResult } from "./contracts"
import { isDerivedPrimitive, isTessellationPrimitive } from "./derivedPrimitives"

/**
 * **场景观察**（Task 2.2 Step 3）。
 *
 * 这是模型看场景的**唯一**窗口，所以三条纪律必须落在这一层，而不是靠提示词提醒：
 *
 * 1. **按文档解析**（计划 Step 1 的 "document scoping"）：实体引用必须带 `documentId`，
 *    绝不允许"在合并列表里按 id 撞运气"。两份文档有同名 id 时（这正是 `SourceContext` 存在的理由），
 *    猜错会让模型对着一份文档说另一份的事。
 * 2. **标签重名如实报告**（"duplicate labels"）：两个对象都叫「点 A」时，工具必须说出来。
 *    模型只看到 `label: "点 A"` 就会随手挑一个，用户拿到的是他不想动的那个对象。
 * 3. **不暴露内部近似细节**（"hidden tessellation omission"）：圆类实体的多边形近似顶点与母线
 *    （`tessellation: true`）**不进观察结果**。它们留在文档里是内核需要，但列给模型会让它
 *    以为"这个圆柱有 88 个用户点"，进而做出荒唐的动作。
 *
 * 另外两层结构性保证：
 * - **结果有界**：`limit` 上限强制夹紧，绝不返回整份文档。上下文预算是有限资源，
 *   一个 5000 对象的图纸若整份塞进提示词，运行必然失败且原因难查。
 * - **手柄校验**：观察入口收句柄，文档内容与句柄不符时报 `stale_source`，**不静默回退**。
 */

export interface SceneEntitySummary {
  documentId: string
  entityId: string
  kind: PrimitiveSpec["type"]
  label: string
  /** 由别的对象算出来 → 不可直接编辑。 */
  derived: boolean
  visible: boolean
  locked: boolean
}

export interface SceneEntityDetail extends SceneEntitySummary {
  /** 该对象依赖的实体（只含同一文档内的引用）。 */
  dependsOn: string[]
  /** 依赖该对象的实体 —— 删除它会影响这些。 */
  referencedBy: string[]
  /** 供模型理解的关键字段（坐标 / 半径 / 模板名等），**白名单**，不是整份图元。 */
  facts: Record<string, string | number | boolean>
}

export interface ObservationLimits {
  /** 单次返回的实体上限；调用方给更大的值也会被夹紧到 `MAX_ENVELOPE_LIMIT`。 */
  limit?: number
}

export type ObservationFailure = { ok: false; reason: "document_not_in_context" | "stale_source" | "entity_not_found"; detail: string }
export type ObservationSuccess<T> = { ok: true; result: ToolResult<T> }

export const MAX_ENVELOPE_LIMIT = 40
export const DEFAULT_ENVELOPE_LIMIT = 12

/** 观察用的文档快照：句柄 + 内容。两者都要，句柄用来检测"内容已经变了"。 */
export interface SceneDocumentSnapshot {
  handle: DocumentHandle
  document: GeometryDocument
}

export interface SceneObservation {
  inspect(documentId: string, limits?: ObservationLimits): ObservationSuccess<SceneEntitySummary[]> | ObservationFailure
  search(documentId: string, query: string, limits?: ObservationLimits): ObservationSuccess<SceneEntitySummary[]> | ObservationFailure
  describe(documentId: string, entityIds: string[]): ObservationSuccess<SceneEntityDetail[]> | ObservationFailure
  dependencies(documentId: string, entityId: string): ObservationSuccess<SceneEntityDetail> | ObservationFailure
  /** 标签 → 实体。重名时**不猜**：返回候选让调用方去问用户。 */
  resolveLabel(documentId: string, label: string): LabelResolution | ObservationFailure
}

export type LabelResolution =
  | { ok: true; entity: SceneEntitySummary }
  | { ok: false; reason: "ambiguous_label"; candidates: SceneEntitySummary[] }
  | { ok: false; reason: "entity_not_found"; candidates: [] }

/**
 * 内容指纹。
 *
 * **必须**用 `@draw/scene-graph` 的 `contentFingerprint` —— 那是句柄里 `contentHash` 的
 * 同一份规则（`createDocumentHandle` 用的就是它）。
 *
 * 我上一版在这里自己写了一个"把 workspace / primitives / groups / parameters 拼起来"的指纹，
 * 结果**永远不会等于句柄里的哈希**：过期检测要么恒真、要么恒假，而它看起来"在正常工作"。
 * 判断依据只有一处，绝不能各写一份 —— 这条纪律这个项目已经用代价学过好几次了。
 */
function fingerprint(document: GeometryDocument): string {
  return contentFingerprint(document)
}

function clampLimit(limits?: ObservationLimits): number {
  const requested = limits?.limit ?? DEFAULT_ENVELOPE_LIMIT
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_ENVELOPE_LIMIT
  return Math.min(Math.floor(requested), MAX_ENVELOPE_LIMIT)
}

/** 用户看得见的实体：显式隐藏的不列，内部近似细节不列。 */
function observable(entity: PrimitiveSpec): boolean {
  return !isTessellationPrimitive(entity)
}

function labelOf(entity: PrimitiveSpec): string {
  // 没有标签时**用 id 当标签**并明说：编一个好看的默认标签会让模型以为用户起过名字。
  return entity.label ?? entity.id
}

function summarize(documentId: string, entity: PrimitiveSpec): SceneEntitySummary {
  return {
    documentId,
    entityId: entity.id,
    kind: entity.type,
    label: labelOf(entity),
    derived: isDerivedPrimitive(entity),
    visible: entity.visible !== false,
    locked: entity.locked === true
  }
}

/**
 * 该对象依赖谁。
 *
 * 刻意只认**结构字段**（引用型字段名以 Id/Ids 结尾、`sourceIds`、`pointIds`…），
 * 而不是"扫一遍所有字符串看像不像 id" —— 后者会把标签、颜色、表达式里的字面量也算成依赖。
 */
const REFERENCE_FIELDS = ["sourceId", "sourceIds", "pointIds", "vertexIds", "edgeIds", "faceIds", "lineA", "lineB", "lineId", "circleId", "objectA", "objectB", "startPointId", "endPointId", "centerPointId", "sourcePointId", "hostId"] as const

function referencesOf(entity: PrimitiveSpec, known: ReadonlySet<string>): string[] {
  const found = new Set<string>()
  const record = entity as unknown as Record<string, unknown>
  for (const field of REFERENCE_FIELDS) {
    const value = record[field]
    if (typeof value === "string" && known.has(value)) found.add(value)
    else if (Array.isArray(value)) for (const entry of value) if (typeof entry === "string" && known.has(entry)) found.add(entry)
  }
  // 自引用没有意义，去掉（模板实体会列出自己）。
  found.delete(entity.id)
  return [...found].sort()
}

/** 白名单事实：只带模型真正需要判断的量，不带整份图元。 */
function factsOf(entity: PrimitiveSpec): Record<string, string | number | boolean> {
  const facts: Record<string, string | number | boolean> = {}
  const record = entity as unknown as Record<string, unknown>
  const numeric = ["x", "y", "z", "radius", "radiusX", "radiusY", "startAngle", "endAngle", "rotation", "halfSize", "height"]
  for (const field of numeric) {
    const value = record[field]
    if (typeof value === "number" && Number.isFinite(value)) facts[field] = value
  }
  if (typeof record.expression === "string") facts.expression = record.expression
  for (const field of ["templateId", "kind", "metric", "status", "classification", "workspace"]) {
    const value = record[field]
    if (typeof value === "string") facts[field] = value
  }
  if (record.points && Array.isArray(record.points)) facts.pointCount = record.points.length
  return facts
}

export function createSceneObservation(documents: SceneDocumentSnapshot[]): SceneObservation {
  const byDocument = new Map(documents.map((snapshot) => [snapshot.handle.documentId, snapshot]))

  function resolve(documentId: string): { ok: true; snapshot: SceneDocumentSnapshot } | ObservationFailure {
    const snapshot = byDocument.get(documentId)
    if (!snapshot) return { ok: false, reason: "document_not_in_context", detail: `document ${documentId} is not part of this observation` }
    // 句柄说"当时是这一版"，内容却已经变了 → 过期，绝不静默按当前内容回答。
    if (fingerprint(snapshot.document) !== snapshot.handle.contentHash) {
      return { ok: false, reason: "stale_source", detail: `document ${documentId} changed since the handle was taken` }
    }
    return { ok: true, snapshot }
  }

  function envelope<T>(summary: string, payload: T, diagnostics: ToolResult<T>["diagnostics"] = []): ToolResult<T> {
    return { status: diagnostics.some((entry) => entry.severity === "error") ? "error" : diagnostics.length > 0 ? "warning" : "success", summary, next_actions: [], artifacts: [], payload, diagnostics }
  }

  /** 重名标签诊断：模型必须知道"这个名字对应多个对象"。 */
  function duplicateDiagnostics(entities: SceneEntitySummary[]): ToolResult<unknown>["diagnostics"] {
    const byLabel = new Map<string, string[]>()
    for (const entity of entities) byLabel.set(entity.label, [...(byLabel.get(entity.label) ?? []), entity.entityId])
    const diagnostics: ToolResult<unknown>["diagnostics"] = []
    for (const [label, ids] of byLabel) {
      if (ids.length > 1) diagnostics.push({ code: "duplicate_label", severity: "warning", message: `label "${label}" is used by ${ids.length} objects: ${ids.join(", ")}` })
    }
    return diagnostics
  }

  return {
    inspect(documentId, limits) {
      const resolved = resolve(documentId)
      if (!resolved.ok) return resolved
      const limit = clampLimit(limits)
      const all = resolved.snapshot.document.primitives.filter(observable)
      const entities = all.slice(0, limit).map((entity) => summarize(documentId, entity))
      const diagnostics = duplicateDiagnostics(entities)
      if (all.length > limit) {
        // 截断必须说出来，否则模型会以为"场景里就这些对象"。
        diagnostics.push({ code: "truncated", severity: "warning", message: `showing ${limit} of ${all.length} objects; raise the limit or narrow the query` })
      }
      return { ok: true, result: envelope(`${entities.length} object(s) in ${documentId}`, entities, diagnostics) }
    },

    search(documentId, query, limits) {
      const resolved = resolve(documentId)
      if (!resolved.ok) return resolved
      const limit = clampLimit(limits)
      const needle = query.trim().toLowerCase()
      // 空查询不返回整份文档：那等于绕过了分页上限。调用方应当改用 `inspect`。
      if (needle.length === 0) return { ok: true, result: envelope("no query given, so nothing was searched", [], [{ code: "empty_query", severity: "warning", message: "provide a label fragment, an id, or a kind to search for" }]) }
      const matched = resolved.snapshot.document.primitives.filter((entity) => observable(entity) && (entity.id.toLowerCase().includes(needle) || labelOf(entity).toLowerCase().includes(needle) || entity.type.toLowerCase().includes(needle)))
      const entities = matched.slice(0, limit).map((entity) => summarize(documentId, entity))
      const diagnostics = duplicateDiagnostics(entities)
      if (matched.length > limit) diagnostics.push({ code: "truncated", severity: "warning", message: `showing ${limit} of ${matched.length} matches` })
      return { ok: true, result: envelope(`${entities.length} match(es) for "${query}"`, entities, diagnostics) }
    },

    describe(documentId, entityIds) {
      const resolved = resolve(documentId)
      if (!resolved.ok) return resolved
      const limit = clampLimit({ limit: entityIds.length })
      const primitives = resolved.snapshot.document.primitives
      const known = new Set(primitives.map((entity) => entity.id))
      const details: SceneEntityDetail[] = []
      const diagnostics: ToolResult<unknown>["diagnostics"] = []
      for (const entityId of entityIds.slice(0, limit)) {
        const entity = primitives.find((candidate) => candidate.id === entityId)
        // 内部近似细节**查得到也不返回**：模型不该基于它做决定。
        if (!entity || !observable(entity)) {
          diagnostics.push({ code: "entity_not_found", severity: "warning", message: `no observable entity ${entityId} in ${documentId}` })
          continue
        }
        const summary = summarize(documentId, entity)
        const dependsOn = referencesOf(entity, known)
        const referencedBy = primitives.filter((candidate) => referencesOf(candidate, known).includes(entityId)).map((candidate) => candidate.id)
        details.push({ ...summary, dependsOn, referencedBy, facts: factsOf(entity) })
      }
      if (details.length === 0) return { ok: false, reason: "entity_not_found", detail: `none of the requested entities are observable in ${documentId}` }
      return { ok: true, result: envelope(`${details.length} detail(s)`, details, diagnostics) }
    },

    dependencies(documentId, entityId) {
      const resolved = resolve(documentId)
      if (!resolved.ok) return resolved
      const primitives = resolved.snapshot.document.primitives
      const entity = primitives.find((candidate) => candidate.id === entityId)
      if (!entity || !observable(entity)) return { ok: false, reason: "entity_not_found", detail: `no observable entity ${entityId} in ${documentId}` }
      const known = new Set(primitives.map((candidate) => candidate.id))
      const summary = summarize(documentId, entity)
      const detail: SceneEntityDetail = {
        ...summary,
        dependsOn: referencesOf(entity, known),
        referencedBy: primitives.filter((candidate) => referencesOf(candidate, known).includes(entityId)).map((candidate) => candidate.id),
        facts: factsOf(entity)
      }
      return { ok: true, result: envelope(`${detail.referencedBy.length} object(s) depend on ${entityId}`, detail) }
    },

    /**
     * 标签 → 实体。
     *
     * **重名时绝不猜**：两个对象都叫「点 A」时返回全部候选，让调用方去问用户。
     * 随手挑一个的后果是用户拿到的是他不想动的那个对象 —— 而他还以为系统听懂了。
     * 标签匹配**先精确后包含**：精确命中唯一时直接用，否则再看包含关系是否唯一。
     */
    resolveLabel(documentId, label) {
      const resolved = resolve(documentId)
      if (!resolved.ok) return resolved
      const primitives = resolved.snapshot.document.primitives.filter(observable)
      const needle = label.trim()
      if (needle.length === 0) return { ok: false, reason: "entity_not_found", candidates: [] }

      const exact = primitives.filter((entity) => labelOf(entity) === needle)
      const contains = exact.length > 0 ? exact : primitives.filter((entity) => labelOf(entity).includes(needle))
      const candidates = contains.map((entity) => summarize(documentId, entity))

      if (candidates.length === 1) return { ok: true, entity: candidates[0] }
      if (candidates.length === 0) return { ok: false, reason: "entity_not_found", candidates: [] }
      return { ok: false, reason: "ambiguous_label", candidates }
    }
  }
}

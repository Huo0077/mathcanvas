/**
 * **一条事实还算不算数**（Follow-up：事实的 `stale` 路径）。
 *
 * 事实表原先只有一种归宿：提交成功就写一条 `confirmed`，然后**永远**是"已确认"。
 * 可是文档是会变的：用户撤销掉那次改动、或者把那次创建出来的对象删掉之后，
 * "文档第 3 版新增 solid-1"就不再描述**现在的**画布 —— 而它照样会进下一轮的提示词，
 * 模型于是拿着一个不存在的对象继续规划（规格 §1.2：当前场景优先于旧记忆）。
 *
 * 这里的判据只有一条，而且**刻意保守**：
 *
 * - **只有文档本身能证明它不再成立**才算失效（引用的对象一个都不在了；或者文档退回到了
 *   写下这条事实之前的那一版）。文档**往前**走了不算 —— "第 3 版新增了什么"是历史事实，
 *   之后又改了几版它照样成立。判据反过来写（"版本比现在旧就算失效"）会让每一条事实
 *   在下一次提交后立刻失效 —— 那不是保守，那是把长期记忆整个关掉。
 * - **读不懂的一律不动**：说不清是哪份文档、`valueJson` 不是我们写的那种形状，
 *   都保持原样（与 `factBelongsToDocument` 的"未知按保留处理"同一个口径）。
 * - 降级时把**是哪条证据**记进 `valueJson`（版本号、对象 id、时间），
 *   事实的原文一个字都不改 —— 它是记录，不是可以随手重写的摘要。
 */

/** 这份文档**现在**长什么样：判"事实还算不算数"要看的两样东西。 */
export interface LiveDocumentEvidence {
  documentId: string
  revision: number
  /** 文档里还在的对象 id（事实引用的对象一个都不在，就说明它说的东西没了）。 */
  objectIds: readonly string[]
}

/** 文档本身给出的失效证据（只有这一种来源：`stale` 是**判**出来的，不是用户点的）。 */
export interface FactInvalidation {
  status: "stale"
  reason: string
  evidence: string
}

/** 记进 `valueJson.invalidation` 的那一笔：谁判的、凭什么、什么时候。 */
export interface FactInvalidationRecord {
  status: "stale" | "retracted"
  reason: string
  evidence: string
  at: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringList(candidate: unknown): string[] {
  return Array.isArray(candidate) ? candidate.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
}

/**
 * **这条事实还算数吗**：算数回 `null`（绝大多数情况），不算数回它凭什么。
 *
 * `valueJson` 是仓储里那条事实的原始值（写入方在里面记了 `documentId` / `generation` /
 * `createdObjects`）。
 */
export function factInvalidationOf(valueJson: unknown, live: LiveDocumentEvidence): FactInvalidation | null {
  const value = asObject(valueJson)
  if (value === null) return null
  // 说不清是哪份文档的事实一律不动：旧数据按"未知"处理，不猜它属于这一份。
  if (typeof value.documentId !== "string" || value.documentId !== live.documentId) return null

  const evidence = `document:${live.documentId}@${live.revision}`
  const cited = stringList(value.createdObjects)
  const missing = cited.filter((id) => !live.objectIds.includes(id))
  // ① 它引用的对象**一个都不在**了（有一个还在就不判：宁可留着，也不猜）。
  if (cited.length > 0 && missing.length === cited.length) {
    return { status: "stale", reason: `document ${live.documentId} no longer contains ${cited.join(", ")}`, evidence }
  }
  // ② 文档退回到了写下这条事实**之前**的那一版（撤销 / 回滚）：它说的那一版已经不在画布上。
  if (typeof value.generation === "number" && Number.isFinite(value.generation) && live.revision < value.generation) {
    return { status: "stale", reason: `document ${live.documentId} is at revision ${live.revision}, before the recorded generation ${value.generation}`, evidence }
  }
  return null
}

/**
 * 把"为什么不算数了"记进那条事实的值里，**其余字段原样保留**。
 *
 * 读不懂的值（不是对象：早期版本可能存过散文）回 `null` —— 调用方据此**拒绝**这次改写，
 * 而不是把它换成另一种形状（那会把这条事实的原文换掉）。
 */
export function withFactInvalidation(valueJson: unknown, invalidation: FactInvalidationRecord): Record<string, unknown> | null {
  const value = asObject(valueJson)
  if (value === null) return null
  return { ...value, invalidation }
}

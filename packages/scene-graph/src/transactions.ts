import type { GeometryDocument } from "@draw/dsl"
import { validateDocument } from "@draw/dsl"

import { applyOperation, isDomainOperation, type DomainOperation } from "./operations"
import { validatePatch } from "./patches"

/**
 * 事务的**内容指纹**，同时是 `SourceContext` 判定"来源是否已过期"的依据。
 *
 * 刻意不复用 `@draw/agent-core` 的 SHA-256：那个包依赖本包，反向导入会成环。
 * 这里要的只是"两份文档是否在语义上相同"，规范化 JSON 足够且更便宜；
 * `revision` 与 `updatedAt` 必须排除 —— 它们是版本与时间，不是内容。
 *
 * `export` 是为了让 `sourceContext.ts` 用**同一份**规范化规则（两份实现会漂移）。
 */
export function contentFingerprint(document: GeometryDocument): string {
  const strip = (value: unknown, key?: string): unknown => {
    if (key === "revision" || key === "updatedAt") return undefined
    if (Array.isArray(value)) return value.map((item) => strip(item))
    if (value === null || typeof value !== "object") return value
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (childKey === "revision" || childKey === "updatedAt") continue
      // 与 `operations.ts` 的语义规范化保持一致：`visible: true` 与缺省等价（`locked` 不等价）。
      if (childKey === "visible" && (childValue === undefined || childValue === true)) continue
      out[childKey] = strip(childValue, childKey)
    }
    return out
  }
  return JSON.stringify(strip(document))
}

/**
 * **原子事务**（计划 Task 0.4）。
 *
 * 要修的真实缺陷：手工 UI 逐项调用 `deleteObject`，于是"点 A 与依赖它的直线 AB"一起选中时，
 * 先删点会因为"仍被引用"被拒、先删线又会把点留下 —— 谁先谁后都不对。
 * 事务把整批当作**一次**提交：先逐笔校验、再在副本上执行、最后验一次文档；
 * 任何一笔失败就返回**原文档**（要么全部执行、要么全不执行）。
 *
 * `diff` 与前后哈希是给确认界面与 run 记录用的：用户看到的"本次将改动什么"必须来自这里，
 * 而不是界面上临时算的猜测。
 */

export interface TransactionInput {
  base: GeometryDocument
  operations: DomainOperation[]
  /** 可选乐观并发检查：与 `base.revision` 不符就直接拒绝整批。 */
  expectedGeneration?: number
}

export interface DocumentDiff {
  added: string[]
  removed: string[]
  updated: string[]
}

export interface CommitResult {
  changed: boolean
  document: GeometryDocument
  diff: DocumentDiff
  errors: string[]
  beforeHash: string
  afterHash: string
}

const EMPTY_DIFF: DocumentDiff = { added: [], removed: [], updated: [] }

/** 按 id 建索引；用于比较"哪些对象被增/删/改"。 */
function primitiveIndex(document: GeometryDocument): Map<string, string> {
  const index = new Map<string, string>()
  for (const primitive of document.primitives) index.set(primitive.id, JSON.stringify(primitive))
  return index
}

function computeDiff(before: GeometryDocument, after: GeometryDocument): DocumentDiff {
  const left = primitiveIndex(before)
  const right = primitiveIndex(after)
  const added: string[] = []
  const removed: string[] = []
  const updated: string[] = []

  // 顺序取"结果文档的顺序"与"原文档的顺序"，这样 diff 是确定性的（不受 Map 迭代细节影响）。
  for (const primitive of after.primitives) if (!left.has(primitive.id)) added.push(primitive.id)
  for (const primitive of before.primitives) if (!right.has(primitive.id)) removed.push(primitive.id)
  for (const primitive of after.primitives) {
    const previous = left.get(primitive.id)
    if (previous !== undefined && previous !== right.get(primitive.id)) updated.push(primitive.id)
  }
  return { added, removed, updated }
}

/**
 * 执行一批操作，**要么全部生效、要么原样返回**。
 *
 * 每笔操作都先过 `validatePatch`（含 Task 0.3 的未知操作守卫），再在副本上执行；
 * 这样做而不是"先全部校验再全部执行"，是为了让后续操作能看到前面操作的结果
 * （例如先建点、再删掉那个点），同时仍然保证失败时零副作用。
 */
export function commitTransaction(input: TransactionInput): CommitResult {
  const { base, operations } = input
  const beforeHash = contentFingerprint(base)

  if (input.expectedGeneration !== undefined && input.expectedGeneration !== base.revision) {
    return { changed: false, document: base, diff: EMPTY_DIFF, errors: [`generation mismatch: expected ${input.expectedGeneration}, found ${base.revision}`], beforeHash, afterHash: beforeHash }
  }

  let current = base
  const errors: string[] = []
  for (const [index, operation] of operations.entries()) {
    if (!isDomainOperation(operation)) {
      errors.push(`operation ${index}: unknown operation`)
      break
    }
    const validation = validatePatch(current, operation)
    if (!validation.valid) {
      errors.push(...validation.errors.map((message) => `operation ${index}: ${message}`))
      break
    }
    const applied = applyOperation(current, operation)
    if (applied.error) {
      errors.push(`operation ${index}: ${applied.error}`)
      break
    }
    current = applied.document
  }
  if (errors.length > 0) {
    return { changed: false, document: base, diff: EMPTY_DIFF, errors, beforeHash, afterHash: beforeHash }
  }

  const afterHash = contentFingerprint(current)
  if (afterHash === beforeHash) {
    // 整批没有语义变化：不推进 revision、不返回新文档（否则撤销栈里会多一个空步）。
    return { changed: false, document: base, diff: EMPTY_DIFF, errors: [], beforeHash, afterHash }
  }
  /**
   * **整批之后也要校验结果文档**（外部审查 M2）。
   *
   * `commitPatch` 早就在应用之后校验整份文档了（那条修复针对的是"改动进了 store、
   * 保存时 `encodeMgeo` 才抛错，而错误又被 `saveDraft` 吞掉 ⇒ 画布上是新的、磁盘上还是旧的"），
   * 而 `commitTransaction` 是批处理 / Agent / 草稿的写入路径，却**从不校验结果**。
   * 两条路径都自称"唯一写入口"，判据必须一致 —— 否则同一个非法改动走单条会被拦住、
   * 走批量就进得去。逐条 `validatePatch` 挡不住这一类：有的操作会让**整份文档**不再合法。
   */
  const validation = validateDocument(current)
  if (!validation.valid) {
    return { changed: false, document: base, diff: EMPTY_DIFF, errors: [`the transaction would make the document invalid: ${validation.errors.slice(0, 3).join(", ")}`], beforeHash, afterHash: beforeHash }
  }
  return { changed: true, document: current, diff: computeDiff(base, current), errors: [], beforeHash, afterHash }
}

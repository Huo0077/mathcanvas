import type { GeometryDocument } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import type { DraftAction } from "@draw/scene-graph"

/**
 * **Worker 消息边界**（Task 0.8）。
 *
 * 计划的两条要求，逐条落到这里：
 * 1. "Worker messages always carry `runId`, `draftId`, `draftVersion`, `requestId`, and `schemaVersion`"
 *    —— 这五个字段**每一条**消息都有，`parseWorkerRequest` 少一个就拒。理由不是形式主义：
 *    没有 `runId` 就无法把"应用被中断后回来的旧结果"认出来，没有 `draftVersion` 与 `requestId`
 *    就无法判断这条结果对应的是不是用户眼下看着的那份草稿（迟到结果会覆盖新预览）。
 * 2. "unknown message kinds are dropped and diagnosed" —— 未知 `kind` **不抛异常**，
 *    而是回一个 `dropped` 结果并带上原因码。抛异常会让一条不认识的广播把整条管道打死；
 *    静默丢弃则会让"为什么没反应"无从查起。
 *
 * **为什么校验要放在边界而不是各自 worker 里**：两边（主线程与 worker）都要用同一份规则，
 * 各写一份必然会分叉 —— 而且分叉的后果是"一边接受、一边拒绝"，最难查。
 *
 * 与 `packages/agent-core/src/schemas.ts` 的关系：那边守的是**模型输出**（不可信数据、字段白名单、
 * 未知字段即拒）。这边守的是**自家两条线程之间**的消息（结构性字段 + 版本），
 * 所以策略不同：未知 kind 是 drop 而不是 reject，且不禁止附加字段
 *（worker 之间传内部上下文是正常的，而模型不许多发明字段）。
 */

export const WORKER_SCHEMA_VERSION = "mathcanvas.worker.v1"

/** 计划点名的五个必填字段。 */
interface WorkerMessageEnvelope {
  schemaVersion: string
  runId: string
  requestId: string
  draftId: string
  draftVersion: number
}

export interface GeometryCompileRequest extends WorkerMessageEnvelope {
  kind: "geometry.compile"
  actions: DraftAction[]
  /** 编译与执行必须落在同一份基准文档上（否则 id 分配与校验都会漂）。 */
  base: GeometryDocument
  /**
   * **用户原话**（Fix round 1 / C3）。
   *
   * 暂存 = 编译，而参数审计的三条判据看的是用户说了什么（"任意/恒定"要保留符号参数、
   * 没说全的尺寸从原话里读、"采样不是证明"的披露）。可选：没有原话的调用方照旧可用。
   */
  prompt?: string
}

export interface GeometryCheckRequest extends WorkerMessageEnvelope {
  kind: "geometry.check"
  operations: DomainOperation[]
  base: GeometryDocument
}

export type GeometryWorkerRequest = GeometryCompileRequest | GeometryCheckRequest

/**
 * **产物信封**（Task 2.4 Step 4："return **diff/check/artifact envelopes**"）。
 *
 * 在它之前，成功响应只有"操作列表 + 结果文档"。那对调用方是不够的，缺的正好是三件事：
 *
 * - **diff**：改了什么。自己比两份文档也能得到，但两份文档可能很大，而且"比出来的差异"
 *   与"事务自己算出来的差异"一旦不一致，调用方就没法判断该信谁。差异只有一处真相。
 * - **check**：这批操作是被校验过的吗、校验有没有全过。走 `check` 路径的调用方尤其需要
 *   这句话 —— 它问的就是"能不能落"，所以回答里必须有"检查过了"而不是"看起来没报错"。
 * - **artifact**：这份产物是哪一版草稿、哪一次请求、哪个运行算出来的。用户确认的必须是
 *   **他看过的那一份**，所以这三个标识要随产物一起回带，而不是靠调用方自己记。
 *
 * 另外补一个 `changed`：语义上没有变化的批次要如实说"没改"，否则撤销栈里会多出一个空步
 * （`commitTransaction` 已经在语义层做了这件事，这里只是把它**报出来**）。
 */
export interface WorkerSuccess {
  kind: "geometry.compile.result"
  schemaVersion: string
  requestId: string
  operations: DomainOperation[]
  document: GeometryDocument
  /** 语义上有没有真的改动（`false` = 这批操作是空操作，调用方不该把它当成一次改动）。 */
  changed: boolean
  /** 事务算出的差异；没有变化时三个数组都空。 */
  diff: { added: string[]; removed: string[]; updated: string[] }
  /** 校验是否全部通过（只有全过才会走到成功响应）。 */
  checked: boolean
  /** 校验发现的问题文本（成功时为空数组；失败走 `geometry.error`）。 */
  problems: string[]
  /** 前后内容指纹，供调用方核对"这份产物是从我给的那份算出来的"。 */
  beforeHash: string
  afterHash: string
  /** 产物归属：信封的四个标识逐字回带（`schemaVersion` 在顶层，不重复塞进这里）。 */
  artifact: { runId: string; draftId: string; draftVersion: number; requestId: string }
}

export interface WorkerFailure {
  kind: "geometry.error"
  schemaVersion: string
  requestId: string
  code: string
  detail: string
}

export type GeometryWorkerResponse = WorkerSuccess | WorkerFailure

export type WorkerDiagnostic = { code: string; detail: string }

export type WorkerParseResult<T> =
  | { ok: true; message: T }
  /** 不认识的 `kind`：按计划**丢弃并留下诊断**，不抛异常。 */
  | { ok: false; dropped: true; diagnostic: WorkerDiagnostic }
  /** 认识但不可用（缺字段 / 版本不符 / 载荷非法）：同样不抛，交给调用方决定怎么办。 */
  | { ok: false; dropped: false; diagnostic: WorkerDiagnostic }

const MAX_ACTIONS = 32
const MAX_OPERATIONS = 128
const MAX_DETAIL = 512

function dropped(code: string, detail: string): { ok: false; dropped: true; diagnostic: WorkerDiagnostic } {
  return { ok: false, dropped: true, diagnostic: { code, detail } }
}

function rejected(code: string, detail: string): { ok: false; dropped: false; diagnostic: WorkerDiagnostic } {
  return { ok: false, dropped: false, diagnostic: { code, detail } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 校验五个必填信封字段。返回 `null` 表示通过。
 *
 * `draftVersion` 必须是**有限整数**：小数或 `NaN` 版本号会让"这条结果对应哪一版"失去意义，
 * 而那种失败在界面上表现为"预览偶尔串版"，极难复现。
 */
function checkEnvelope(message: Record<string, unknown>): WorkerDiagnostic | null {
  if (message.schemaVersion !== WORKER_SCHEMA_VERSION) {
    return { code: "schema_version_mismatch", detail: `expected ${WORKER_SCHEMA_VERSION}, got ${String(message.schemaVersion)}` }
  }
  for (const field of ["runId", "requestId", "draftId"] as const) {
    const value = message[field]
    if (typeof value !== "string" || value.length === 0) return { code: "missing_envelope_field", detail: `${field} must be a non-empty string` }
    if (value.length > MAX_DETAIL) return { code: "envelope_field_too_long", detail: `${field} exceeds ${MAX_DETAIL} characters` }
  }
  const version = message.draftVersion
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return { code: "invalid_draft_version", detail: "draftVersion must be a non-negative integer" }
  }
  return null
}

export function parseWorkerRequest(input: unknown): WorkerParseResult<GeometryWorkerRequest> {
  if (!isRecord(input)) return rejected("invalid_message", "expected a plain object")
  const kind = input.kind
  if (kind !== "geometry.compile" && kind !== "geometry.check") {
    // 未知 kind：丢弃并诊断（可能是未来的新消息，也可能是发错了通道）。
    return dropped("unknown_message_kind", `unrecognized worker message kind: ${String(kind)}`)
  }

  const envelopeProblem = checkEnvelope(input)
  if (envelopeProblem) return rejected(envelopeProblem.code, envelopeProblem.detail)

  if (!isRecord(input.base)) return rejected("missing_base_document", "base must be a document object")

  if (kind === "geometry.compile") {
    const actions = input.actions
    if (!Array.isArray(actions)) return rejected("invalid_actions", "actions must be an array")
    if (actions.length === 0) return rejected("empty_actions", "a compile request must carry at least one action")
    if (actions.length > MAX_ACTIONS) return rejected("too_many_actions", `max ${MAX_ACTIONS} actions per request`)
    return { ok: true, message: { ...(input as unknown as GeometryCompileRequest), kind, actions: actions as DraftAction[] } }
  }

  const operations = input.operations
  if (!Array.isArray(operations)) return rejected("invalid_operations", "operations must be an array")
  if (operations.length > MAX_OPERATIONS) return rejected("too_many_operations", `max ${MAX_OPERATIONS} operations per request`)
  return { ok: true, message: { ...(input as unknown as GeometryCheckRequest), kind, operations: operations as DomainOperation[] } }
}

/**
 * 校验 worker 回来的消息。
 *
 * 与请求侧同一套策略：未知 kind 丢弃并诊断。响应还多一条 —— `requestId` 必须能对上
 * 调用方期待的那一条；这是"迟到结果"唯一的识别手段，所以放在这里强制，而不是靠每个调用点自觉。
 */
export function parseWorkerResponse(input: unknown, expectedRequestId?: string): WorkerParseResult<GeometryWorkerResponse> {
  if (!isRecord(input)) return rejected("invalid_message", "expected a plain object")
  const kind = input.kind
  if (kind !== "geometry.compile.result" && kind !== "geometry.error") {
    return dropped("unknown_message_kind", `unrecognized worker response kind: ${String(kind)}`)
  }

  if (input.schemaVersion !== WORKER_SCHEMA_VERSION) {
    return rejected("schema_version_mismatch", `expected ${WORKER_SCHEMA_VERSION}, got ${String(input.schemaVersion)}`)
  }
  const requestId = input.requestId
  if (typeof requestId !== "string" || requestId.length === 0) return rejected("missing_request_id", "requestId must be a non-empty string")
  if (expectedRequestId !== undefined && requestId !== expectedRequestId) {
    return rejected("unexpected_request_id", `response is for ${requestId}, not ${expectedRequestId}`)
  }

  if (kind === "geometry.error") {
    const code = typeof input.code === "string" && input.code.length > 0 ? input.code : "worker_error"
    const detail = typeof input.detail === "string" ? input.detail.slice(0, MAX_DETAIL) : ""
    return { ok: true, message: { kind, schemaVersion: WORKER_SCHEMA_VERSION, requestId, code, detail } }
  }

  if (!isRecord(input.document)) return rejected("missing_document", "a result must carry the resulting document")
  if (!Array.isArray(input.operations)) return rejected("invalid_operations", "a result must carry the compiled operations")
  /**
   * 三个信封（diff / check / artifact）是**必需的**，不是可选装饰。
   *
   * 判据是"少了它调用方还能不能正确工作"：没有 `artifact` 就无法回答"这份产物是哪一版草稿的"
   *（而用户确认的必须是看过的那一份）；没有 `changed` 就会把空操作当成一次改动；
   * 没有 `diff` 就只能自己比文档。所以缺一个就拒绝，而不是给个默认值糊过去。
   */
  if (typeof input.changed !== "boolean") return rejected("missing_changed_flag", "a result must say whether anything changed")
  if (!isRecord(input.diff)) return rejected("missing_diff", "a result must carry the transaction diff")
  if (!isRecord(input.artifact)) return rejected("missing_artifact", "a result must say which draft it came from")
  return {
    ok: true,
    message: {
      kind,
      schemaVersion: WORKER_SCHEMA_VERSION,
      requestId,
      operations: input.operations as DomainOperation[],
      document: input.document as unknown as GeometryDocument,
      changed: input.changed,
      diff: input.diff as WorkerSuccess["diff"],
      checked: input.checked === true,
      problems: Array.isArray(input.problems) ? (input.problems as string[]) : [],
      beforeHash: typeof input.beforeHash === "string" ? input.beforeHash : "",
      afterHash: typeof input.afterHash === "string" ? input.afterHash : "",
      artifact: input.artifact as unknown as WorkerSuccess["artifact"]
    }
  }
}

/** 构造一条请求：把五个信封字段填在一处，调用方不会漏填。 */
export function createWorkerRequest<T extends GeometryWorkerRequest["kind"]>(kind: T, envelope: { runId: string; requestId: string; draftId: string; draftVersion: number }, payload: Omit<Extract<GeometryWorkerRequest, { kind: T }>, keyof WorkerMessageEnvelope | "kind">): Extract<GeometryWorkerRequest, { kind: T }> {
  return { kind, schemaVersion: WORKER_SCHEMA_VERSION, ...envelope, ...payload } as Extract<GeometryWorkerRequest, { kind: T }>
}

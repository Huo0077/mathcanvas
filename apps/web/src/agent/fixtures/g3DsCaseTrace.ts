export const G3_BOUNDARIES = [
  "provider",
  "tool_protocol",
  "schema",
  "dag",
  "stage",
  "verification",
  "contract",
  "render",
  "delivery"
] as const

export type G3Boundary = (typeof G3_BOUNDARIES)[number]

export type G3RequestResponseKind = "tool_calls" | "text" | "error" | "unknown"

export interface G3RequestTrace {
  readonly index: number
  readonly toolNames: readonly string[]
  readonly responseKind: G3RequestResponseKind
  readonly usageKnown: boolean
}

export interface G3FailureRecord {
  readonly boundary: G3Boundary
  readonly code: string
  readonly fieldPath?: string
}

export interface G3CaseTrace {
  readonly caseId: string
  readonly runId: string
  readonly revision: string
  readonly candidateHash?: string
  readonly modelInvoked: boolean
  readonly requests: readonly G3RequestTrace[]
  readonly firstFailure?: G3FailureRecord
}

export interface HistoricalDs5SummaryEntry {
  readonly id: string
  readonly requests: number
  readonly contract: string
  readonly primitiveCount: number
  readonly verification: string | null
  readonly certificate: string | null
  readonly mixedReadAndPlan?: boolean
  readonly toolsByRequest?: readonly (readonly string[])[]
  readonly usageEvents?: number
}

export type InputFigureAuditResult =
  | { readonly ok: true; readonly status: "self_contained" | "confirmed_figure" }
  | {
      readonly ok: false
      readonly status: "input_figure_missing"
      readonly boundary: "contract"
      readonly code: "input_figure_missing"
    }

const FORBIDDEN_TRACE_KEYS = new Set([
  "prompt",
  "apikey",
  "api_key",
  "toolinput",
  "tool_input",
  "rawresponse",
  "raw_response",
  "rawoutput",
  "raw_output",
  "messages",
  "authorization",
  "secret",
  "secretref",
  "secret_ref"
])

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "caseId",
  "runId",
  "revision",
  "candidateHash",
  "modelInvoked",
  "requests",
  "firstFailure"
])

const ALLOWED_REQUEST_KEYS = new Set(["index", "toolNames", "responseKind", "usageKnown"])
const ALLOWED_FAILURE_KEYS = new Set(["boundary", "code", "fieldPath"])
const SECRET_VALUE_PATTERN = /\bsk-[A-Za-z0-9]{12,}\b|\bBearer\s+[A-Za-z0-9._-]{12,}/i
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/
const SAFE_PATH_PATTERN = /^[A-Za-z0-9_.[\]-]{1,120}$/

function isBoundary(value: string): value is G3Boundary {
  return (G3_BOUNDARIES as readonly string[]).includes(value)
}

function assertSafeString(value: unknown, label: string, maxLen = 160): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLen) {
    throw new Error(`Invalid sanitized ${label}`)
  }
  if (SECRET_VALUE_PATTERN.test(value)) {
    throw new Error(`Forbidden secret pattern detected in sanitized trace ${label}`)
  }
  return value
}

function scanForForbiddenData(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) {
      throw new Error(`Forbidden secret value in trace at ${path}`)
    }
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      scanForForbiddenData(value[i], `${path}[${i}]`)
    }
    return
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_TRACE_KEYS.has(key.toLowerCase())) {
        throw new Error(`Forbidden trace key "${key}" at ${path}`)
      }
      scanForForbiddenData(nested, `${path}.${key}`)
    }
  }
}

export function assertSanitizedG3CaseTrace(trace: G3CaseTrace): G3CaseTrace {
  if (typeof trace !== "object" || trace === null || Array.isArray(trace)) {
    throw new Error("Trace must be an object")
  }
  scanForForbiddenData(trace)
  for (const key of Object.keys(trace)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`Forbidden or unknown trace top-level field "${key}"`)
    }
  }
  assertSafeString(trace.caseId, "caseId", 64)
  assertSafeString(trace.runId, "runId", 120)
  assertSafeString(trace.revision, "revision", 80)
  if (trace.candidateHash !== undefined) {
    assertSafeString(trace.candidateHash, "candidateHash", 128)
  }
  if (typeof trace.modelInvoked !== "boolean") {
    throw new Error("Invalid sanitized modelInvoked flag")
  }
  if (!Array.isArray(trace.requests)) {
    throw new Error("Trace requests must be an array")
  }
  for (const req of trace.requests) {
    if (typeof req !== "object" || req === null || Array.isArray(req)) {
      throw new Error("Trace request entry must be an object")
    }
    for (const key of Object.keys(req)) {
      if (!ALLOWED_REQUEST_KEYS.has(key)) {
        throw new Error(`Forbidden or unknown trace request field "${key}"`)
      }
    }
    if (!Number.isInteger(req.index) || req.index < 1) {
      throw new Error("Invalid request index in trace")
    }
    if (!Array.isArray(req.toolNames) || req.toolNames.some((t: unknown) => typeof t !== "string" || !SAFE_CODE_PATTERN.test(t))) {
      throw new Error("Invalid closed-set toolNames in trace request")
    }
    if (!["tool_calls", "text", "error", "unknown"].includes(req.responseKind)) {
      throw new Error("Invalid responseKind in trace request")
    }
    if (typeof req.usageKnown !== "boolean") {
      throw new Error("Invalid usageKnown flag in trace request")
    }
  }
  if (trace.firstFailure !== undefined) {
    for (const key of Object.keys(trace.firstFailure)) {
      if (!ALLOWED_FAILURE_KEYS.has(key)) {
        throw new Error(`Forbidden or unknown trace failure field "${key}"`)
      }
    }
    if (!isBoundary(trace.firstFailure.boundary)) {
      throw new Error(`Invalid boundary "${String(trace.firstFailure.boundary)}"`)
    }
    if (!SAFE_CODE_PATTERN.test(trace.firstFailure.code)) {
      throw new Error(`Invalid failure code "${String(trace.firstFailure.code)}"`)
    }
    if (trace.firstFailure.fieldPath !== undefined && !SAFE_PATH_PATTERN.test(trace.firstFailure.fieldPath)) {
      throw new Error(`Invalid sanitized fieldPath "${String(trace.firstFailure.fieldPath)}"`)
    }
  }
  return trace
}

export function createG3CaseTrace(input: {
  caseId: string
  runId: string
  revision: string
  candidateHash?: string
  modelInvoked?: boolean
}): G3CaseTrace {
  return assertSanitizedG3CaseTrace({
    caseId: input.caseId,
    runId: input.runId,
    revision: input.revision,
    ...(input.candidateHash === undefined ? {} : { candidateHash: input.candidateHash }),
    modelInvoked: input.modelInvoked ?? false,
    requests: []
  })
}

export function withCandidateHash(trace: G3CaseTrace, candidateHash: string): G3CaseTrace {
  return assertSanitizedG3CaseTrace({
    ...trace,
    candidateHash
  })
}

export function recordRequestTrace(trace: G3CaseTrace, request: G3RequestTrace): G3CaseTrace {
  const sanitizedReq: G3RequestTrace = {
    index: request.index,
    toolNames: [...request.toolNames],
    responseKind: request.responseKind,
    usageKnown: request.usageKnown
  }
  return assertSanitizedG3CaseTrace({
    ...trace,
    modelInvoked: true,
    requests: [...trace.requests, sanitizedReq]
  })
}

export function recordBoundary(trace: G3CaseTrace, event: G3FailureRecord): G3CaseTrace {
  assertSanitizedG3CaseTrace({
    ...trace,
    firstFailure: event
  })
  // Preserve the earliest provable boundary once recorded.
  if (trace.firstFailure !== undefined) {
    return trace
  }
  const normalized: G3FailureRecord = {
    boundary: event.boundary,
    code: event.code,
    ...(event.fieldPath === undefined ? {} : { fieldPath: event.fieldPath })
  }
  return assertSanitizedG3CaseTrace({
    ...trace,
    firstFailure: normalized
  })
}

export function explainFirstFailure(trace: G3CaseTrace): G3FailureRecord | "unknown" {
  assertSanitizedG3CaseTrace(trace)
  return trace.firstFailure ?? "unknown"
}

export function serializeG3CaseTrace(trace: G3CaseTrace): string {
  const validated = assertSanitizedG3CaseTrace(trace)
  return JSON.stringify(validated)
}

export function auditInputFigureDependency(input: {
  id: string
  inputMode?: string
  unsupportedReasons?: readonly string[]
  confirmedFigureRefs?: readonly unknown[]
}): InputFigureAuditResult {
  if ((input.confirmedFigureRefs?.length ?? 0) > 0) {
    return { ok: true, status: "confirmed_figure" }
  }
  const hasMissingFigureReason = (input.unsupportedReasons ?? []).some((reason) =>
    /no reviewed figure (?:image )?hash\/regions?|unavailable source figure/i.test(reason)
  )
  if (input.inputMode === "text_with_figure_reference" && hasMissingFigureReason) {
    return {
      ok: false,
      status: "input_figure_missing",
      boundary: "contract",
      code: "input_figure_missing"
    }
  }
  return { ok: true, status: "self_contained" }
}

export function classifyHistoricalDs5SummaryCase(entry: HistoricalDs5SummaryEntry, revision: string): G3CaseTrace {
  let trace = createG3CaseTrace({
    caseId: entry.id,
    runId: `historical-ds5-${entry.id}`,
    revision
  })
  const toolsByReq = entry.toolsByRequest ?? []
  for (let i = 0; i < toolsByReq.length; i += 1) {
    const tools = toolsByReq[i] ?? []
    trace = recordRequestTrace(trace, {
      index: i + 1,
      toolNames: tools,
      responseKind: tools.length > 0 ? "tool_calls" : "unknown",
      usageKnown: (entry.usageEvents ?? 0) > i
    })
  }
  if (entry.mixedReadAndPlan) {
    return recordBoundary(trace, {
      boundary: "tool_protocol",
      code: "mixed_read_plan"
    })
  }
  if (entry.primitiveCount > 0) {
    if (entry.verification === "failed") {
      return recordBoundary(trace, {
        boundary: "verification",
        code: "certificate_blocked"
      })
    }
    if (entry.verification === "not_supported") {
      return recordBoundary(trace, {
        boundary: "verification",
        code: "verification_not_supported"
      })
    }
  }
  // Remaining zero-candidate cases in historical summary.json did not log schema/dag vs stage codes.
  return trace
}

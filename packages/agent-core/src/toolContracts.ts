import type { ParseError, ParseResult, ToolExecutionIdentity, VerificationCheck, VerificationReport, VerificationStatus } from "./contracts"
import { boundedArray, boundedString, fail, isPlainObject, rejectUnknownFields } from "./schemaReaders"

const verificationStatuses: readonly VerificationStatus[] = ["passed", "failed", "unknown", "approximate", "not_supported"]

function statusOf(value: unknown, path: string, errors: ParseError[]): VerificationStatus | null {
  if (typeof value !== "string" || !verificationStatuses.includes(value as VerificationStatus)) {
    errors.push(fail("invalid_status", path, "expected a known verification status"))
    return null
  }
  return value as VerificationStatus
}

export function parseToolExecutionIdentity(input: unknown): ParseResult<ToolExecutionIdentity> {
  if (!isPlainObject(input)) return { ok: false, errors: [fail("invalid_type", "identity", "expected an object")] }
  const errors: ParseError[] = []
  rejectUnknownFields(input, ["runId", "stepId", "toolCallId", "draftVersion", "baseDocumentHash"], "identity", errors)
  const runId = boundedString(input.runId, "identity.runId", errors)
  const stepId = boundedString(input.stepId, "identity.stepId", errors)
  const toolCallId = boundedString(input.toolCallId, "identity.toolCallId", errors)
  const baseDocumentHash = boundedString(input.baseDocumentHash, "identity.baseDocumentHash", errors)
  const draftVersion = input.draftVersion
  if (!Number.isSafeInteger(draftVersion) || (draftVersion as number) < 1) errors.push(fail("invalid_draft_version", "identity.draftVersion", "expected a positive safe integer"))
  if (errors.length > 0 || !runId || !stepId || !toolCallId || !baseDocumentHash) return { ok: false, errors }
  return { ok: true, value: { runId, stepId, toolCallId, draftVersion: draftVersion as number, baseDocumentHash } }
}

export function parseVerificationReport(input: unknown): ParseResult<VerificationReport> {
  if (!isPlainObject(input)) return { ok: false, errors: [fail("invalid_type", "verification", "expected an object")] }
  const errors: ParseError[] = []
  rejectUnknownFields(input, ["status", "checks", "next_actions"], "verification", errors)
  const status = statusOf(input.status, "verification.status", errors)
  const checkInputs = boundedArray(input.checks, "verification.checks", errors)
  const nextInputs = boundedArray(input.next_actions, "verification.next_actions", errors)
  const next_actions = nextInputs?.map((entry, index) => boundedString(entry, `verification.next_actions[${index}]`, errors)) ?? []
  const checks: VerificationCheck[] = []
  for (const [index, entry] of (checkInputs ?? []).entries()) {
    const path = `verification.checks[${index}]`
    if (!isPlainObject(entry)) {
      errors.push(fail("invalid_type", path, "expected a check object"))
      continue
    }
    rejectUnknownFields(entry, ["id", "status", "detail", "path"], path, errors)
    const id = boundedString(entry.id, `${path}.id`, errors)
    const checkStatus = statusOf(entry.status, `${path}.status`, errors)
    const detail = boundedString(entry.detail, `${path}.detail`, errors)
    const where = entry.path === undefined ? undefined : boundedString(entry.path, `${path}.path`, errors)
    if (id && checkStatus && detail && where !== null) checks.push({ id, status: checkStatus, detail, ...(where === undefined ? {} : { path: where }) })
  }
  if (status === "passed" && (checks.length === 0 || checks.some((check) => check.status !== "passed"))) {
    errors.push(fail("inconsistent_verification", "verification.status", "a passed report needs at least one check and every check must have passed"))
  }
  if (errors.length > 0 || status === null) return { ok: false, errors }
  return { ok: true, value: { status, checks, next_actions: next_actions as string[] } }
}

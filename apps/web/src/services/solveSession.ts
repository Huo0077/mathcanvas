import type { ModelClientStart } from "./modelClient"

export type CallPurpose = "vision" | "plan" | "repair" | "independent"
export type ProfilePurpose = "vision" | "plan" | "independent"
export interface RequestReservation {
  id: string
  purpose: CallPurpose
  inputTokens: number
  maxOutputTokens: number
}
export interface SolveSessionLimits {
  requests: number
  inputTokens: number
  outputTokens: number
  wallTimeMs: number
}
export interface SolveSession {
  readonly id: string
  readonly signal: AbortSignal
  readonly limits: Readonly<SolveSessionLimits>
  reserve(purpose: CallPurpose, inputTokens: number, maxOutputTokens: number): RequestReservation | null
  settle(id: string, usage?: { inputTokens?: number; outputTokens?: number }): void
  pinProvider(purpose: ProfilePurpose, id: string, revision: number): boolean
  cancel(reason: string): void
  pauseForUser(): void
  resume(): boolean
  snapshot(): { requests: number; inputTokens: number; outputTokens: number; pending: number; reportedInputTokens: number; reportedOutputTokens: number; usageReportedRequests: number; providers: Partial<Record<ProfilePurpose, { id: string; revision: number }>> }
}
export const DEFAULT_SOLVE_SESSION_LIMITS: Readonly<SolveSessionLimits> = Object.freeze({
  requests: 8, inputTokens: 96000, outputTokens: 16000, wallTimeMs: 180000
})

export const HIGH_ACCURACY_SOLVE_SESSION_LIMITS: Readonly<SolveSessionLimits> = Object.freeze({
  requests: 12, inputTokens: 160000, outputTokens: 24000, wallTimeMs: 300000
})

export function createDefaultSolveSession(id: string, now: () => number = Date.now): SolveSession {
  return createSolveSession(id, DEFAULT_SOLVE_SESSION_LIMITS, now)
}

const MAX_ABSOLUTE_LIFETIME_MS = 30 * 60 * 1000

/**
 * The paid-request ledger starts before image reading; old per-run Budget still governs
 * generation/tools. This ledger never grants an attempt that exceeds call/token/time limits.
 */
export function createSolveSession(id: string, limits: SolveSessionLimits, now: () => number): SolveSession {
  if (!id || !Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("invalid solve session limits")
  const limitsSnapshot = Object.freeze({ ...limits })
  const started = now()
  if (!Number.isFinite(started)) throw new Error("invalid clock")
  const controller = new AbortController()
  const outstanding = new Map<string, RequestReservation>()
  let requests = 0
  let inputTokens = 0
  let outputTokens = 0
  let reportedInputTokens = 0
  let reportedOutputTokens = 0
  let usageReportedRequests = 0
  const providers: Partial<Record<ProfilePurpose, { id: string; revision: number }>> = {}
  let pausedAt: number | null = null
  let pausedDuration = 0
  let serial = 0
  const expired = () => {
    const tick = now()
    return !Number.isFinite(tick) || tick < started || tick - started > MAX_ABSOLUTE_LIFETIME_MS ||
      tick - started - pausedDuration - (pausedAt === null ? 0 : tick - pausedAt) > limitsSnapshot.wallTimeMs
  }
  return {
    id,
    signal: controller.signal,
    limits: limitsSnapshot,
    reserve(purpose, requestedInput, requestedOutput) {
      if (controller.signal.aborted || pausedAt !== null || expired()) return null
      if (!["vision", "plan", "repair", "independent"].includes(purpose)) return null
      if (!Number.isSafeInteger(requestedInput) || requestedInput <= 0 || !Number.isSafeInteger(requestedOutput) || requestedOutput <= 0) return null
      if (requests >= limitsSnapshot.requests || requestedInput > limitsSnapshot.inputTokens - inputTokens || requestedOutput > limitsSnapshot.outputTokens - outputTokens) return null
      // Synchronous pre-reservation prevents concurrent calls from overselling the same allowance.
      const reservation = { id: id + ":" + (++serial), purpose, inputTokens: requestedInput, maxOutputTokens: requestedOutput }
      requests += 1
      inputTokens += requestedInput
      outputTokens += requestedOutput
      outstanding.set(reservation.id, reservation)
      return reservation
    },
    settle(reservationId, usage) {
      const reservation = outstanding.get(reservationId)
      if (!reservation) return
      outstanding.delete(reservationId)
      if (usage?.inputTokens !== undefined || usage?.outputTokens !== undefined) usageReportedRequests += 1
      if (usage?.inputTokens !== undefined && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0) {
        inputTokens += usage.inputTokens - reservation.inputTokens
        reportedInputTokens += usage.inputTokens
      }
      if (usage?.outputTokens !== undefined && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0) {
        outputTokens += usage.outputTokens - reservation.maxOutputTokens
        reportedOutputTokens += usage.outputTokens
      }
    },
    pinProvider(purpose, profileId, revision) {
      if (controller.signal.aborted || expired() || !["vision", "plan", "independent"].includes(purpose) || !profileId || !Number.isSafeInteger(revision) || revision < 0) return false
      const previous = providers[purpose]
      if (previous) return previous.id === profileId && previous.revision === revision
      providers[purpose] = { id: profileId, revision }
      return true
    },
    cancel(reason) { controller.abort(reason) },
    pauseForUser() { if (pausedAt === null && !controller.signal.aborted) pausedAt = now() },
    resume() {
      if (controller.signal.aborted || expired()) return false
      if (pausedAt !== null) { pausedDuration += now() - pausedAt; pausedAt = null }
      return !expired()
    },
    snapshot() { return { requests, inputTokens, outputTokens, pending: outstanding.size, reportedInputTokens, reportedOutputTokens, usageReportedRequests, providers: { ...providers } } }
  }
}

/** Centralize preflight and usage settlement for vision/planning/provider retries. */
export async function runReservedModel<T extends ModelClientStart>(
  session: SolveSession, purpose: CallPurpose, estimatedInputTokens: number, maxOutputTokens: number,
  invoke: () => Promise<T>
): Promise<T> {
  const reservation = session.reserve(purpose, estimatedInputTokens, maxOutputTokens)
  if (!reservation) throw new Error("solve session request budget or limit exhausted")
  try {
    const response = await invoke()
    const usage = response.ok ? response.events.filter(event => event.kind === "usage").at(-1) : undefined
    session.settle(reservation.id, usage)
    if (session.signal.aborted) throw new Error("solve session cancelled")
    return response
  } catch (error) {
    session.settle(reservation.id)
    throw error
  }
}

/** Ephemeral, one-shot handoff from the image composer to the next runner turn. */
const pendingSessions = new Map<string, { prompt: string; session: SolveSession }>()

export function attachSolveSession(conversationId: string, prompt: string, session: SolveSession): boolean {
  if (!conversationId || !prompt.trim() || session.signal.aborted || pendingSessions.has(conversationId)) return false
  pendingSessions.set(conversationId, { prompt: prompt.trim(), session })
  return true
}

export function claimSolveSession(conversationId: string, prompt: string): SolveSession | null {
  const pending = pendingSessions.get(conversationId)
  if (!pending) return null
  if (pending.prompt !== prompt.trim()) {
    pendingSessions.delete(conversationId)
    pending.session.cancel("different submitted prompt")
    return null
  }
  pendingSessions.delete(conversationId)
  return pending.session
}

export function dropSolveSession(session: SolveSession): void {
  for (const [conversationId, pending] of pendingSessions) {
    if (pending.session === session) pendingSessions.delete(conversationId)
  }
}

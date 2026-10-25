/** Bounded multi-start damped least squares. Solutions are numerical witnesses. */
export interface FoldSystemOptions {
  minimumDegrees?: number
  maximumDegrees?: number
  maxEvaluations?: number
  maxCandidates?: number
  residualTolerance?: number
  timeoutMs?: number
  shouldStop?: () => boolean
  now?: () => number
}

export interface FoldSystemOutcome {
  status: "solved" | "not-found" | "underdetermined" | "invalid-input" | "cancelled"
  degrees: number[][]
  evaluations: number
  complete: false
  termination: "sampled" | "budget-exhausted" | "timeout" | "cancelled" | "rank-deficient" | "insufficient-constraints" | "invalid-input" | "candidate-limit"
}

/** Small dense solve with pivoting; no external solver or unbounded work. */
function linearSolve(matrix: number[][], rhs: number[]): number[] | null {
  const rows = matrix.map((row, i) => [...row, rhs[i]!])
  for (let col = 0; col < rhs.length; col += 1) {
    let pivot = col
    for (let r = col + 1; r < rows.length; r += 1) if (Math.abs(rows[r]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = r
    if (!Number.isFinite(rows[pivot]![col]) || Math.abs(rows[pivot]![col]!) < 1e-20) return null
    ;[rows[col], rows[pivot]] = [rows[pivot]!, rows[col]!]
    const divisor = rows[col]![col]!
    for (let k = col; k <= rhs.length; k += 1) rows[col]![k] = rows[col]![k]! / divisor
    for (let r = 0; r < rows.length; r += 1) {
      if (r === col) continue
      const multiplier = rows[r]![col]!
      for (let k = col; k <= rhs.length; k += 1) rows[r]![k] = rows[r]![k]! - multiplier * rows[col]![k]!
    }
  }
  return rows.map(row => row[rhs.length]!)
}

function rank(matrix: number[][], columns: number): number {
  const norms = Array.from({ length: columns }, (_, c) => Math.hypot(...matrix.map(row => row[c]!)))
  const largest = Math.max(...norms, 1e-20)
  const rows = matrix.map(row => row.map((v, c) => norms[c]! < largest * 1e-8 ? 0 : v / norms[c]!))
  let result = 0
  for (let c = 0; c < columns; c += 1) {
    let pivot = result
    for (let r = result + 1; r < rows.length; r += 1) if (Math.abs(rows[r]![c]!) > Math.abs(rows[pivot]?.[c] ?? 0)) pivot = r
    if (Math.abs(rows[pivot]?.[c] ?? 0) < 1e-6) continue
    ;[rows[result], rows[pivot]] = [rows[pivot]!, rows[result]!]
    const divisor = rows[result]![c]!
    for (let k = c; k < columns; k += 1) rows[result]![k] = rows[result]![k]! / divisor
    for (let r = result + 1; r < rows.length; r += 1) {
      const multiplier = rows[r]![c]!
      for (let k = c; k < columns; k += 1) rows[r]![k] = rows[r]![k]! - multiplier * rows[result]![k]!
    }
    result += 1
    if (result === columns) break
  }
  return result
}

function halton(index: number, base: number): number {
  let result = 0
  let factor = 1 / base
  for (let i = index; i > 0; i = Math.floor(i / base)) { result += (i % base) * factor; factor /= base }
  return result
}

export function solveFoldSystem(residual: (degrees: readonly number[]) => readonly number[], initial: readonly number[], options: FoldSystemOptions = {}): FoldSystemOutcome {
  const { minimumDegrees: minimum = 1e-5, maximumDegrees: maximum = 180, maxEvaluations = 1024,
    maxCandidates = 8, residualTolerance = 1e-7, timeoutMs = 1500 } = options
  let evaluations = 0
  const degrees: number[][] = []
  const state: { termination: FoldSystemOutcome["termination"] } = { termination: "sampled" }
  const result = (status: FoldSystemOutcome["status"]): FoldSystemOutcome => ({ status, degrees, evaluations, complete: false, termination: state.termination })
  if (initial.length < 1 || initial.length > 3 || !initial.every(Number.isFinite)
    || !Number.isFinite(minimum) || !Number.isFinite(maximum) || !(maximum > minimum)
    || !Number.isInteger(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > 4096
    || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 32
    || !Number.isFinite(residualTolerance) || residualTolerance <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    state.termination = "invalid-input"; return result("invalid-input")
  }
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs
  const span = maximum - minimum
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  let count: number | undefined
  let deficient = false
  const stopped = (): boolean => {
    if (options.shouldStop?.()) { state.termination = "cancelled"; return true }
    if (evaluations >= maxEvaluations) { state.termination = "budget-exhausted"; return true }
    if (now() >= deadline) { state.termination = "timeout"; return true }
    return false
  }
  const evaluate = (x: readonly number[]): number[] | null => {
    if (stopped()) return null
    evaluations += 1
    let values: number[]
    try { values = [...residual(x.map(v => minimum + span * v))] } catch { return null }
    if (count === undefined && values.every(Number.isFinite)) count = values.length
    return values.length === count && values.every(Number.isFinite) ? values : null
  }
  const jacobian = (x: number[]): number[][] | null => {
    const cols: number[][] = []
    for (let c = 0; c < x.length; c += 1) {
      const lo = [...x]; const hi = [...x]
      lo[c] = clamp(lo[c]! - 1e-5); hi[c] = clamp(hi[c]! + 1e-5)
      const a = evaluate(lo); const b = evaluate(hi)
      if (!a || !b) return null
      cols.push(a.map((v, r) => (b[r]! - v) / (hi[c]! - lo[c]!)))
    }
    return Array.from({ length: count! }, (_, r) => cols.map(col => col[r]!))
  }
  const cost = (r: number[]) => r.reduce((sum, v) => sum + v * v, 0)
  for (let seed = 0; seed < 24 && !stopped(); seed += 1) {
    let x = seed === 0 ? initial.map(v => clamp((v - minimum) / span))
      : initial.map((_, c) => 0.02 + 0.96 * halton(seed, [2, 3, 5][c]!))
    let r = evaluate(x)
    if (!r) continue
    if (r.length < initial.length) { state.termination = "insufficient-constraints"; return result("underdetermined") }
    let damping = 1e-3
    for (let iteration = 0; iteration < 48 && !stopped(); iteration += 1) {
      const j = jacobian(x)
      if (!j) break
      if (r.every(v => Math.abs(v) <= residualTolerance)) {
        if (rank(j, initial.length) < initial.length) { deficient = true; break }
        const candidate = x.map(v => minimum + span * v)
        if (!degrees.some(other => other.every((v, c) => Math.abs(v - candidate[c]!) < 1e-3))) degrees.push(candidate)
        break
      }
      const normal = x.map((_, a) => x.map((__, b) => j.reduce((sum, row) => sum + row[a]! * row[b]!, 0)))
      const rhs = x.map((_, c) => -j.reduce((sum, row, i) => sum + row[c]! * r![i]!, 0))
      normal.forEach((row, c) => { row[c] = row[c]! + damping * Math.max(1, row[c]!) })
      const step = linearSolve(normal, rhs)
      if (!step || step.some(v => !Number.isFinite(v))) break
      const factor = Math.max(1, ...step.map(v => Math.abs(v) / 0.3))
      const next = x.map((v, c) => clamp(v + step[c]! / factor))
      const trial = evaluate(next)
      if (trial && cost(trial) < cost(r)) {
        x = next; r = trial; damping = Math.max(1e-10, damping / 3)
      } else {
        damping *= 10
        if (damping > 1e10) break
      }
    }
    if (degrees.length >= maxCandidates) { state.termination = "candidate-limit"; break }
  }
  degrees.sort((a, b) => { for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i]! - b[i]!) > 1e-4) return a[i]! - b[i]!; return 0 })
  if (state.termination === "cancelled") return result("cancelled")
  if (degrees.length > 0) return result("solved")
  if (deficient) { state.termination = "rank-deficient"; return result("underdetermined") }
  return result("not-found")
}

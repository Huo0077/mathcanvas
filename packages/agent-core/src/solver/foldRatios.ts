import type { ObligationIR } from "../obligationIR"

export interface FoldHingeRatio { from: string; to: string; parameter: number }

/** Consume the same parsed givens as verification, including Unicode punctuation. */
export function foldHingeRatios(ir: ObligationIR, hostNames: ReadonlySet<string>): Map<string, FoldHingeRatio> {
  const ratios = new Map<string, FoldHingeRatio>()
  const conflicts = new Set<string>()
  const add = (point: string, from: string, to: string, parameter: number) => {
    if (hostNames.has(point) || !hostNames.has(from) || !hostNames.has(to) || from === to
      || !Number.isFinite(parameter) || parameter <= 0 || parameter >= 1 || conflicts.has(point)) return
    const old = ratios.get(point)
    if (old && !((old.from === from && old.to === to && Math.abs(old.parameter - parameter) < 1e-9)
      || (old.from === to && old.to === from && Math.abs(old.parameter + parameter - 1) < 1e-9))) {
      ratios.delete(point); conflicts.add(point); return
    }
    ratios.set(point, { from, to, parameter })
  }
  for (const item of ir.obligations) {
    if (item.role !== "given" || item.judgeability !== "supported") continue
    if (item.kind === "midpoint" && item.targets.length === 3) {
      const [point, from, to] = item.targets
      add(point!, from!, to!, 0.5)
    }
    const value = item.expected
    if (item.kind !== "segmentRatio" || item.targets.length !== 4 || typeof value !== "number" || !(value > 0)) continue
    const [a, b, c, d] = item.targets
    if (a === c) {
      add(b!, a!, d!, value)
      add(d!, a!, b!, 1 / value)
    } else if (b === c) {
      add(b!, a!, d!, value / (1 + value))
    }
  }
  return ratios
}

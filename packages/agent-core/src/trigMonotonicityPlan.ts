import { formatPiMultiple, rational } from "@draw/geometry-kernel"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { normalizeGeometryPrompt } from "./latexNormalisation"

const PRODUCT = /^([+-]?\d+(?:\.\d+)?)\*sin\(x\)\*cos\(x([+-])(?:(\d{1,6})\*)?pi(?:\/([1-9]\d{0,5}))?\)(?:[+-](?:\d+(?:\.\d+)?|sqrt\(\d+(?:\.\d+)?\)))?$/

// f(x) = a sin(x) cos(x − θ) + b, with θ a rational multiple of π.
export function tryBuildTrigMonotonicityPlan(prompt: string): PlanEnvelope | null {
  if (!prompt.includes("递增区间")) return null
  const normalized = normalizeGeometryPrompt(prompt)
  const parsed = parseDiagramObligations(normalized)
  const [graph] = parsed.givens
  if (parsed.unverified.length || parsed.givens.length !== 1 || graph?.kind !== "functionGraph" || graph.expression === undefined) return null
  if (!/^(?:\d+[.．、，,]\s*)?(?:(?:已知|设)?\s*函数)?$/.test(normalized.slice(0, graph.start).trim())) return null
  const question = normalized.slice(graph.end).replace(/\s+/g, "")
  if (!/^[。.,，；;]*(?:[（(](?:1|i)[）)]|①)?求(?:函数)?f\(x\)的(?:单调)?递增区间[。.;；]?$/.test(question)) return null

  const expression = graph.expression.replace(/\s+/g, "")
  const product = PRODUCT.exec(expression.replace(/\(((?:\d+\*)?pi\/\d+)\)/g, "$1"))
  if (!product) return null
  const amplitude = Number(product[1])
  const denominator = Number(product[4] ?? 1)
  const numerator = (product[2] === "-" ? 1 : -1) * Number(product[3] ?? 1)
  if (!Number.isFinite(amplitude) || amplitude === 0) return null
  const phase = rational(BigInt(numerator), BigInt(denominator))
  const rising = amplitude > 0
  const piText = (n: bigint, d: bigint): string => {
    const value = rational(n, d)
    return value.numerator === 0n ? "0" : formatPiMultiple(Number(value.numerator), Number(value.denominator))
  }
  const start = piText(2n * phase.numerator + (rising ? -1n : 1n) * phase.denominator, 4n * phase.denominator)
  const end = piText(2n * phase.numerator + (rising ? 1n : 3n) * phase.denominator, 4n * phase.denominator)
  const phaseText = piText(phase.numerator, phase.denominator)
  const first = rising ? "-π/2" : "π/2"
  const last = rising ? "π/2" : "3π/2"
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "求函数的单调递增区间并绘制函数图像",
    factIds: [],
    assumptions: ["图像显示 x∈[-π, π]，单调区间按全体实数求解。"],
    answer: [
      `令 θ=${phaseText}。由积化和差，2sin x·cos(x−θ)=sin(2x−θ)+sin θ，所以 f′(x)=${amplitude}cos(2x−θ)。`,
      `令 f′(x)>0，得 ${first}+2kπ < 2x−θ < ${last}+2kπ。端点处导数为零，函数在整个闭区间上严格递增。`,
      `单调递增区间为 [${start}+kπ, ${end}+kπ]，k∈ℤ。`
    ].join("\n\n"),
    actions: [{
      actionId: "function.create_graph",
      actionKey: "graph-f",
      factIds: [],
      inputs: { alias: "f", label: "f(x)", expression, domain: [-Math.PI, Math.PI] }
    }]
  }
}

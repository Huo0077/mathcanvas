import { canonicalPointName, POINT_NAME_SOURCE, splitPointNames } from "@draw/geometry-kernel"

/**
 * Shared placeholder for a single-letter vertex angle (`∠A = 60°`) whose incident
 * edges are resolved later from the shape clause ring (`resolveStatedVertexAngle`).
 */
export const STATED_VERTEX_ANGLE = "顶点角"

export type AngleChainDraft =
  | { kind: "planarAngle"; targets: string[]; value: number; chainIndex?: number }
  | { kind: "equalAngle"; targets: string[]; chainIndex?: number }

export type AngleChainResult =
  | { ok: true; sourceText: string; start: number; end: number; drafts: AngleChainDraft[] }
  | { ok: false; sourceText: string; start: number; end: number; reason: string }

const THREE_POINT_ANGLE = new RegExp(`^∠\\s*(${POINT_NAME_SOURCE})\\s*(${POINT_NAME_SOURCE})\\s*(${POINT_NAME_SOURCE})$`)
const ONE_POINT_ANGLE = /^∠\s*([A-Z])$/
const DEGREE_VALUE = /^([+-]?\d+(?:\.\d+)?)\s*(?:°|\^\{\\circ\}|\\circ)$/
const RADIAN_PI_VALUE = /^\(?\s*(\d+(?:\.\d+)?)?\s*(?:π|\\pi)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*\)?\s*(?:rad|弧度)?$/i
const RADIAN_SCALAR_VALUE = /^([+-]?\d+(?:\.\d+)?)\s*(?:rad|弧度)$/i
const UNITLESS_NUMBER = /^[+-]?\d+(?:\.\d+)?$/
const SEGMENT_TERM = new RegExp(`^(?:\\d+(?:\\.\\d+)?\\s*(?:\\/\\s*\\d+(?:\\.\\d+)?)?\\s*)?${POINT_NAME_SOURCE}${POINT_NAME_SOURCE}$`)

type ParsedAngleTerm =
  | { kind: "angle"; targets: [string, string, string] | [string, typeof STATED_VERTEX_ANGLE] }
  | { kind: "value"; degrees: number; unit: "deg" | "rad" }
  | { kind: "invalid"; reason: string }

function parseAngleTerm(raw: string): ParsedAngleTerm {
  const term = raw.trim()
  if (term.length === 0) {
    return { kind: "invalid", reason: "等式链右侧截断，缺少角度或点名。" }
  }
  if (/^(?:sin|cos|tan|cot|sec|csc)\s*∠/i.test(term)) {
    return { kind: "invalid", reason: `三角函数表达式「${term}」暂未作为显式角度判据解析，如实未核验。` }
  }

  const three = THREE_POINT_ANGLE.exec(term)
  if (three) {
    const targets: [string, string, string] = [
      canonicalPointName(three[1]!),
      canonicalPointName(three[2]!),
      canonicalPointName(three[3]!)
    ]
    if (new Set(targets).size !== 3) {
      return { kind: "invalid", reason: `角「${term}」的三个点名存在重复，退化角不能作为有效条件。` }
    }
    return { kind: "angle", targets }
  }

  const one = ONE_POINT_ANGLE.exec(term)
  if (one) {
    return { kind: "angle", targets: [canonicalPointName(one[1]!), STATED_VERTEX_ANGLE] }
  }

  if (term.includes("∠")) {
    return { kind: "invalid", reason: `无法把「${term}」唯一解析为角条件，如实未核验。` }
  }

  const deg = DEGREE_VALUE.exec(term)
  if (deg) {
    const degrees = Number(deg[1])
    if (!Number.isFinite(degrees) || degrees <= 0 || degrees >= 180) {
      return { kind: "invalid", reason: `角度「${term}」超出 (0°, 180°) 有效角域，已拒绝。` }
    }
    return { kind: "value", degrees, unit: "deg" }
  }

  const piRad = RADIAN_PI_VALUE.exec(term)
  if (piRad) {
    const numerator = piRad[1] === undefined ? 1 : Number(piRad[1])
    const denominator = piRad[2] === undefined ? 1 : Number(piRad[2])
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return { kind: "invalid", reason: `弧度表达式「${term}」分母或系数非法，已拒绝。` }
    }
    // Convert π multiples cleanly once at the boundary to avoid IEEE-754 drift like 59.99999999999999.
    const degrees = (numerator / denominator) * 180
    if (!Number.isFinite(degrees) || degrees <= 0 || degrees >= 180) {
      return { kind: "invalid", reason: `弧度「${term}」换算后超出 (0°, 180°) 有效角域，已拒绝。` }
    }
    return { kind: "value", degrees, unit: "rad" }
  }

  const scalarRad = RADIAN_SCALAR_VALUE.exec(term)
  if (scalarRad) {
    const radians = Number(scalarRad[1])
    const degrees = (radians * 180) / Math.PI
    if (!Number.isFinite(degrees) || degrees <= 0 || degrees >= 180) {
      return { kind: "invalid", reason: `弧度「${term}」换算后约为 ${degrees.toPrecision(4)}°，超出 (0°, 180°) 有效角域（可能混用了度与弧度），已拒绝。` }
    }
    return { kind: "value", degrees, unit: "rad" }
  }

  if (UNITLESS_NUMBER.test(term)) {
    return { kind: "invalid", reason: `角等式中的数值「${term}」缺少单位（° 或 rad），不能猜测度与弧度。` }
  }

  if (SEGMENT_TERM.test(term) || splitPointNames(term).length === 2) {
    return { kind: "invalid", reason: `不能把线段或长度项「${term}」与角画等号，类型不匹配。` }
  }

  return { kind: "invalid", reason: `无法把「${term}」解析为有效角度或角值，如实未核验。` }
}

/**
 * Matches a maximal `=`-chain containing at least one angle token (`∠`) or explicit
 * angle unit mixed onto an equals expression inside a clause.
 *
 * Terms are scanned cleanly up to conjunctions/Chinese prose boundaries while keeping
 * optional `rad` / `弧度` / `^{\circ}` units attached.
 */
const ANGLE_TERM_TOKEN = "(?:(?:sin|cos|tan|cot|sec|csc)\\s*)?(?:∠\\s*(?:[A-Z][A-Z0-9′'₁₂₃₄₅₆₇₈₉]*\\s*){1,3}|\\(?\\s*[+-]?\\d*(?:\\.\\d+)?\\s*(?:π|\\\\pi)(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?)?\\s*\\)?(?:\\s*(?:rad|弧度))?|[+-]?\\d+(?:\\.\\d+)?\\s*(?:°|\\^\\{\\\\circ\\}|\\\\circ|rad|弧度)?|[+-]?[A-Za-z0-9′'₁₂₃₄₅₆₇₈₉.+*/√^]+)"
const ANGLE_CHAIN_CANDIDATE = new RegExp(
  `${ANGLE_TERM_TOKEN}(?:\\s*=\\s*(?:${ANGLE_TERM_TOKEN})?)+`,
  "g"
)

const SUBCLAUSE_PATTERN = /[^，,。；;\n（）()且并和或则]+/g

function trimToMathSpan(raw: string, baseOffset: number): { text: string; start: number; end: number } | null {
  let leading = 0
  while (leading < raw.length) {
    const ch = raw[leading]!
    if (/[\s\u4e00-\u9fa5：:]/.test(ch)) {
      leading += 1
      continue
    }
    break
  }
  const sliced = raw.slice(leading)
  if (!sliced.includes("=")) return null
  if (!sliced.includes("∠") && !/(?:°|\^\{\\circ\}|\\circ|rad|弧度)/i.test(sliced)) return null
  // Ignore named prose expressions without angle symbols (`二面角 A-BC-D=45°`, `所成角=45°`).
  if (!sliced.includes("∠") && /(?:二面角|所成)/.test(raw.slice(0, leading))) return null
  const trimmedEnd = sliced.trimEnd()
  if (trimmedEnd.length === 0) return null
  return {
    text: trimmedEnd,
    start: baseOffset + leading,
    end: baseOffset + leading + trimmedEnd.length
  }
}

export function parseAngleChains(text: string): AngleChainResult[] {
  const results: AngleChainResult[] = []

  for (const subclause of text.matchAll(SUBCLAUSE_PATTERN)) {
    const subText = subclause[0]
    const subOffset = subclause.index ?? 0
    if (!subText.includes("=")) continue
    if (!subText.includes("∠") && !/(?:°|\^\{\\circ\}|\\circ|rad|弧度)/i.test(subText)) continue

    ANGLE_CHAIN_CANDIDATE.lastIndex = 0
    const candidateMatches = [...subText.matchAll(ANGLE_CHAIN_CANDIDATE)]
    if (candidateMatches.length === 0) continue

    for (const match of candidateMatches) {
      const candidateRaw = match[0]
      const candidateOffset = subOffset + (match.index ?? 0)
      if (!candidateRaw.includes("=")) continue
      if (!candidateRaw.includes("∠") && !/(?:°|\^\{\\circ\}|\\circ|rad|弧度)/i.test(candidateRaw)) continue

      // Check prefix context inside the subclause: if CJK dihedral label immediately precedes, skip.
      const prefixBeforeMatch = subText.slice(0, match.index ?? 0)
      if (!candidateRaw.includes("∠") && /(?:二面角|所成角|线面角)\s*$/.test(prefixBeforeMatch)) continue

      const span = trimToMathSpan(candidateRaw, candidateOffset)
      if (span === null) continue
      // Skip explicit trig or ratio prefixes like `sin∠ABC = 0.5` where `sin` is inside span,
      // or length=angle mismatch like `AB=60°` without `∠`.
      if (!span.text.includes("∠")) {
        // E.g. `AB=60°` or `2AB=60 rad` (length = angle unit without `∠`):
        const parts = span.text.split("=")
        const left = parts[0]?.trim() ?? ""
        if (SEGMENT_TERM.test(left) || splitPointNames(left).length === 2) {
          results.push({
            ok: false,
            sourceText: span.text,
            start: span.start,
            end: span.end,
            reason: `不能把线段长度「${left}」与角度画等号，类型不匹配。`
          })
        }
        continue
      }

      const rawTerms = span.text.split("=")
      const parsedTerms = rawTerms.map(parseAngleTerm)
      const invalid = parsedTerms.find((term): term is Extract<ParsedAngleTerm, { kind: "invalid" }> => term.kind === "invalid")
      if (invalid) {
        results.push({
          ok: false,
          sourceText: span.text,
          start: span.start,
          end: span.end,
          reason: invalid.reason
        })
        continue
      }

      const angles = parsedTerms.filter((term): term is Extract<ParsedAngleTerm, { kind: "angle" }> => term.kind === "angle")
      const values = parsedTerms.filter((term): term is Extract<ParsedAngleTerm, { kind: "value" }> => term.kind === "value")
      if (angles.length === 0) continue

      const distinctUnits = new Set(values.map((item) => item.unit))
      if (distinctUnits.size > 1) {
        results.push({
          ok: false,
          sourceText: span.text,
          start: span.start,
          end: span.end,
          reason: `角等式链「${span.text}」混用了度（°）与弧度（rad），已拒绝。`
        })
        continue
      }

      if (values.length > 0) {
        const expected = values[0]!.degrees
        if (values.some((item) => Math.abs(item.degrees - expected) > 1e-6)) {
          results.push({
            ok: false,
            sourceText: span.text,
            start: span.start,
            end: span.end,
            reason: `角等式链「${span.text}」给出了相互矛盾的角值，已拒绝。`
          })
          continue
        }
        const drafts: AngleChainDraft[] = angles.map((angle, index) => ({
          kind: "planarAngle",
          targets: [...angle.targets],
          value: expected,
          ...(angles.length > 1 ? { chainIndex: index } : {})
        }))
        results.push({ ok: true, sourceText: span.text, start: span.start, end: span.end, drafts })
        continue
      }

      if (angles.length < 2) {
        results.push({
          ok: false,
          sourceText: span.text,
          start: span.start,
          end: span.end,
          reason: `角等式「${span.text}」缺少右侧角或角度值，无法核验。`
        })
        continue
      }

      const drafts: AngleChainDraft[] = []
      for (let index = 0; index + 1 < angles.length; index += 1) {
        drafts.push({
          kind: "equalAngle",
          targets: [...angles[index]!.targets, ...angles[index + 1]!.targets],
          ...(angles.length > 2 ? { chainIndex: index } : {})
        })
      }
      results.push({ ok: true, sourceText: span.text, start: span.start, end: span.end, drafts })
    }
  }

  return results
}

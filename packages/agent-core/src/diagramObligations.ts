/** 题设来自用户原话而不是模型的 relations 声明。只读有确定点名的窄句型。 */
export type DiagramObligationKind =
  | "fixedLength" | "equilateral" | "equalLength" | "midpoint" | "segmentRatio"
  | "planePerpendicular" | "dihedral" | "perpendicular" | "parallel"

export interface DiagramObligation {
  kind: DiagramObligationKind
  sourceText: string
  start: number
  end: number
  targets: string[]
  value?: number
  planeLengths?: [number, number]
}

export interface DiagramObligationSet {
  givens: DiagramObligation[]
  goals: string[]
  freeChoices: string[]
  unverified: { sourceText: string; reason: string }[]
}

interface Matcher {
  pattern: RegExp
  read: (match: RegExpExecArray) => Pick<DiagramObligation, "kind" | "targets" | "value" | "planeLengths"> | null
}

const names = (value: string): string[] => [...value]
const finitePositive = (value: string): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** 更具体的模式排在普通等号/垂直之前，避免截取比例式或面-面句式的一部分。 */
const MATCHERS: readonly Matcher[] = [
  {
    pattern: /二面角\s*([A-Z])\s*[-−]\s*([A-Z])([A-Z])\s*[-−]\s*([A-Z])\s*=\s*(\d+(?:\.\d+)?)\s*°/g,
    read: (m) => { const value = finitePositive(m[5]); return value === null || value >= 180 ? null : { kind: "dihedral", targets: m.slice(1, 5), value } }
  },
  {
    pattern: /平面\s*([A-Z]{3,4})\s*(?:⊥|垂直于?)\s*平面\s*([A-Z]{3,4})/g,
    read: (m) => ({ kind: "planePerpendicular", targets: [...names(m[1]), ...names(m[2])], planeLengths: [m[1].length, m[2].length] })
  },
  {
    pattern: /(?:△|三角形)\s*([A-Z]{3})\s*(?:为|是)?\s*等边三角形/g,
    read: (m) => ({ kind: "equilateral", targets: names(m[1]) })
  },
  {
    pattern: /([A-Z])\s*(?:为|是)\s*([A-Z]{2})\s*的?\s*中点/g,
    read: (m) => ({ kind: "midpoint", targets: [m[1], ...names(m[2])] })
  },
  {
    pattern: /([A-Z]{2})\s*=\s*(\d+(?:\.\d+)?)\s*([A-Z]{2})(?![A-Z])/g,
    read: (m) => { const value = finitePositive(m[2]); return value === null ? null : { kind: "segmentRatio", targets: [...names(m[1]), ...names(m[3])], value } }
  },
  {
    pattern: /([A-Z]{2})\s*=\s*(\d+(?:\.\d+)?)(?![\d.A-Z])/g,
    read: (m) => { const value = finitePositive(m[2]); return value === null ? null : { kind: "fixedLength", targets: names(m[1]), value } }
  },
  {
    pattern: /([A-Z]{2})\s*(?:与|和)\s*([A-Z]{2})\s*(?:长度相等|线段相等|边相等|等长)/g,
    read: (m) => ({ kind: "equalLength", targets: [...names(m[1]), ...names(m[2])] })
  },  {
    pattern: /([A-Z]{2})\s*=\s*([A-Z]{2})(?![A-Z])/g,
    read: (m) => ({ kind: "equalLength", targets: [...names(m[1]), ...names(m[2])] })
  },
  {
    pattern: /([A-Z]{2})\s*(⊥|∥|垂直于?|平行于?)\s*平面\s*([A-Z]{3,4})/g,
    read: (m) => ({ kind: m[2].includes("平行") || m[2] === "∥" ? "parallel" : "perpendicular", targets: [...names(m[1]), ...names(m[3])] })
  },
  {
    pattern: /([A-Z]{2})\s*(⊥|∥|垂直于?|平行于?)\s*([A-Z]{2})(?![A-Z])/g,
    read: (m) => ({ kind: m[2].includes("平行") || m[2] === "∥" ? "parallel" : "perpendicular", targets: [...names(m[1]), ...names(m[3])] })
  }
]

const UNREAD_CONDITION = /∠\s*[A-Z]{3}\s*=\s*\d+(?:\.\d+)?\s*°|[A-Z]{2}\s*[:：]\s*[A-Z]{2}\s*=\s*\d+(?:\.\d+)?|[A-Z]{2}\s*=\s*-?\d+(?:\.\d+)?/g

export function parseDiagramObligations(prompt: string): DiagramObligationSet {
  const boundary = /(?:求证|证明)/.exec(prompt)
  const givenText = boundary === null ? prompt : prompt.slice(0, boundary.index)
  const goals = boundary === null ? [] : [prompt.slice(boundary.index + boundary[0].length).trim().replace(/^[：:，,\s]+/, "")].filter(Boolean)
  const freeChoices = [...new Set([...givenText.matchAll(/(?:任取|任意|自由)(?:一?个)?\s*点\s*([A-Z])/g)].map((match) => match[1]))]
  const givens: DiagramObligation[] = []
  const unverified: DiagramObligationSet["unverified"] = []
  const used = new Set<number>()

  for (const { pattern, read } of MATCHERS) {
    for (const match of givenText.matchAll(pattern)) {
      const start = match.index
      const end = start + match[0].length
      // A suffix of ∠ABC=60° is not the segment condition BC=60.
      if (start > 0 && /[A-Z∠:：]/.test(givenText[start - 1])) continue
      const next = /^\s*(\S)/.exec(givenText.slice(end))?.[1]
      if (next && /[A-Z°+*/√π^%]/.test(next)) continue
      if (Array.from({ length: end - start }, (_, offset) => start + offset).some((at) => used.has(at))) continue
      const result = read(match)
      if (result === null || new Set(result.targets).size < 2) continue
      givens.push({ ...result, sourceText: match[0], start, end })
      for (let at = start; at < end; at++) used.add(at)
    }
  }

  for (const match of givenText.matchAll(UNREAD_CONDITION)) {
    if ([...match[0]].some((_, offset) => used.has(match.index + offset))) continue
    const sourceText = /^[^，,。；;\s]+/.exec(givenText.slice(match.index))?.[0] ?? match[0]
    unverified.push({ sourceText, reason: "这个条件没有被可靠解析或数值非法，未核验。" })
  }

  // Scan the portions no reliable matcher consumed. A new textbook notation must
  // become visible as unverified, not silently turn a non-empty problem into an empty pass.
  for (const clause of givenText.matchAll(/[^，,。；;\n]+/g)) {
    if (unverified.some((entry) => clause[0].includes(entry.sourceText))) continue
    const leftover = [...clause[0]].map((character, offset) => used.has(clause.index + offset) ? " " : character).join("").trim()
    if (/[=⊥∥]|二面角|等边|等长|长度相等|线段相等|边相等|中点|垂直|平行|共面|之比|比值|比例|共线|(?:点?[A-Z]\s*在\s*平面)/.test(leftover)) {
      unverified.push({ sourceText: leftover, reason: "原题出现了尚未被可靠解析的几何条件，未核验。" })
    }
  }
  givens.sort((left, right) => left.start - right.start)
  return { givens, goals, freeChoices, unverified }
}

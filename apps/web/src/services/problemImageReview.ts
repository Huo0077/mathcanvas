import type { ImageReadingItem, ProblemImageReading } from "./problemImageReader"

const number = String.raw`[+\-−]?\s*\d+(?:\.\d+)?`
const pair = String.raw`\(\s*${number}\s*,\s*${number}\s*\)`
const coordinates = new RegExp(String.raw`(?<![A-Za-z])([A-Z](?:_\{\d+\}|_?\d+)?[′']?\s*\(\s*${number}(?:\s*,\s*${number}){1,2}\s*\))`, "g")
const pointName = String.raw`[A-Z](?:_\{\d+\}|_?\d+)?[′']?`
const namedSegment = new RegExp(`^${pointName}\\s*[-–—]?\\s*${pointName}$`)

function mathText(text: string): string {
  return text.normalize("NFKC").replace(/\\(?:left|right)\b|\\[()]|\$/g, "").replace(/\\(?:to|rightarrow)\b/g, "→")
}

/** A plausible but wrong coordinate needs a source check even if the model reported no doubt. */
export function addCoordinateReview(reading: ProblemImageReading, imageCount: number): ProblemImageReading {
  const values = [...new Set([...mathText(reading.problem).matchAll(coordinates)].map(match => match[1].replace(/\s/g, "")))]
  if (!values.length) return reading
  const listed = values.join("、")
  const text = `请对照原图核对坐标和正负号。初读值：${listed.length > 210 ? listed.slice(0, 210) + "…" : listed}。以核对后的题干为准。`
  return {
    ...reading,
    uncertainties: [...reading.uncertainties, { text, image: imageCount === 1 ? 1 : null, box: null, impact: "condition" }]
  }
}

/** Flag a possible complement/union confusion without rewriting the transcription. */
export function reviewProblemImage(reading: ProblemImageReading, imageCount: number): ProblemImageReading {
  const coordinateReview = addCoordinateReview(reading, imageCount)
  const unionOfSingleton = /样本空间[^。；;\n]{0,160}(?:\\(?:bigcup|cup)(?![A-Za-z])|[∪⋃])\s*(?:_\s*(?:\{[^{}]{1,12}\}|\w))?\s*\\?\{\s*[A-Z]\s*\\?\}/
  if (!unionOfSingleton.test(mathText(reading.problem))) return coordinateReview
  const text = "请核对样本空间的集合符号。开口向右的补集与开口向上的并集含义不同。若原图是补集，请在题干中写出全集减去的集合。"
  const uncertainties = [...coordinateReview.uncertainties]
  const existing = reading.uncertainties.findIndex(item => /样本空间|补集|并集/.test(item.text))
  if (existing === -1) {
    uncertainties.push({ text, image: imageCount === 1 ? 1 : null, box: null, impact: "condition" })
  } else {
    const item = uncertainties[existing]
    const combined = text + item.text
    uncertainties[existing] = { ...item, text: combined.length <= 300 ? combined : combined.slice(0, 299) + "…", impact: "condition" }
  }
  return { ...coordinateReview, uncertainties }
}

/** Geometry connections need a human check before they become drawing input. */
export function isDiagramLine(item: ImageReadingItem): boolean {
  if (item.arrow) return false
  const text = mathText(item.text).trim()
  return /虚线|实线|点线|线段|相连|连线|连接|[底侧]棱|dashed|solid line|segment/i.test(text) || namedSegment.test(text)
}

/** Only graph-dependent vector questions need numerical tails and heads. */
export function requiredVectorReadings(reading: ProblemImageReading): number {
  const problem = mathText(reading.problem)
  const figure = /(?:如|见)\s*(?:下|右|左|上)?图|图\s*(?:[\d一二三四]+\s*)?(?:中|所示)|坐标图/
  if (!/向量|箭头/.test(problem) || !figure.test(problem)) return 0
  const paired = /(?:两|2)\s*(?:个|支|条)?\s*(?:向量|箭头)|(?:向量|风速|速度)\s*(?:与|和|及)[^。;\n]{1,60}(?:向量|风速|速度)\s*(?:如|见)\s*图/
  const expected = paired.test(problem) ? 2 : 1
  if (hasVectorSupplement(problem, expected)) return 0
  const distinct = new Set(reading.diagram.flatMap(item => item.arrow ? [item.arrow.from.join(",") + "→" + item.arrow.to.join(",")] : []))
  return distinct.size < expected ? expected : 0
}

export function hasVectorSupplement(text: string, count: number): boolean {
  const arrows = new RegExp(`(${pair})\\s*(?:→|->|到|至)\\s*(${pair})`, "g")
  const normalizePoint = (point: string) => {
    const values = point.slice(1, -1).split(",").map(value => Number(value.replace(/\s/g, "").replace("−", "-")))
    return values.every(Number.isFinite) ? values.join(",") : null
  }
  const distinct = new Set([...mathText(text).matchAll(arrows)].flatMap(([, from, to]) => {
    const start = normalizePoint(from)
    const end = normalizePoint(to)
    return start === null || end === null || start === end ? [] : [start + "→" + end]
  }))
  return distinct.size >= count
}

const graphChoices = ["A", "B", "C", "D"] as const
type GraphChoice = typeof graphChoices[number]
const graphOption = /^\s*(?:选项\s*)?([A-D])\s*[:.、)．）]\s*(.+)$/

export function isGraphChoiceReading(text: string): boolean {
  return mathText(text).split(/[\n;；]/).some(line => graphOption.test(line))
}

function describedGraphChoices(text: string): Map<GraphChoice, string> {
  const descriptions = mathText(text).split(/[\n;；]/)
  return new Map(descriptions.flatMap(line => {
    const match = graphOption.exec(line)
    if (!match) return []
    const detail = match[2]
    return !/看不清|无法|需核对|不确定|未读出/.test(detail)
      && /(?:对称|单调|递增|递减|上升|下降|极[大小]|峰|谷|开口|拐点|零点|相切|穿过|经过|交于|相交|渐近|[MW]形)/i.test(detail)
      ? [[match[1] as GraphChoice, detail]] : []
  }))
}

export function isGraphChoiceProblem(problem: string): boolean {
  return /图[像象][^。;；\n]{0,12}(?:大致[为是]|大致形状是|可能[是为]|正确的是|对应的是|[是为](?=\s*[(：:]|\s*$))|下列[^。;；\n]{0,14}图[像象][^。;；\n]{0,12}(?:正确|符合)/.test(mathText(problem))
}

export function graphChoiceDraft(reading: ProblemImageReading): string {
  const described = describedGraphChoices([reading.problem, ...reading.diagram.map(item => item.text)].join("\n"))
  return graphChoices.flatMap(choice => described.has(choice) ? [`${choice}：${described.get(choice)}`] : []).join("\n")
}

export function missingGraphChoices(text: string): GraphChoice[] {
  const described = describedGraphChoices(text)
  return graphChoices.filter(choice => !described.has(choice))
}

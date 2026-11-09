/** Legacy image transcript parser: read-only compatibility for stored conversations. */
export type ImageBox = [number, number, number, number]
type Point2 = [number, number]

export interface ImageReadingItem {
  text: string
  image: number | null
  /** [left, top, right, bottom] in fractions of the submitted image, when located. */
  box: ImageBox | null
  impact?: "condition" | "appearance"
  arrow?: { from: Point2; to: Point2 }
}

export interface ProblemImageReading {
  problem: string
  diagram: ImageReadingItem[]
  uncertainties: ImageReadingItem[]
}

function parseImageJson(payload: string): Record<string, unknown> | null {
  try {
    return JSON.parse(payload)
  } catch (error) {
    // Repair only an unescaped TeX math delimiter. The JSON parser still
    // rejects other syntax errors, and already valid JSON goes through unchanged.
    const repaired = payload.replace(/(?<!\\)(?:\\\\)*\\(?=[()[\]])/g, match => match + "\\")
    if (repaired === payload) throw error
    return JSON.parse(repaired)
  }
}

export function parseProblemImageReading(text: string, imageCount: number): ProblemImageReading | null {
  if (text.length > 32_000) return null
  try {
    const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text)
    const result = parseImageJson(fenced?.[1] ?? text)
    if (!result || typeof result.problem !== "string" || result.problem.length > 8000) return null
    const diagram = parseImageReadingItems(result.diagram, imageCount)
    const uncertainties = parseImageReadingItems(result.uncertainties, imageCount)
    const problem = result.problem.trim()
    if (!diagram || !uncertainties || (!problem && !diagram.length && !uncertainties.length)) return null
    return { problem, diagram, uncertainties }
  } catch {
    return null
  }
}

function imageBox(value: unknown): ImageBox | null {
  return Array.isArray(value) && value.length === 4
    && value.every(coordinate => typeof coordinate === "number" && coordinate >= 0 && coordinate <= 1)
    && value[0] < value[2] && value[1] < value[3] ? value as ImageBox : null
}

function isPoint2(value: unknown): value is Point2 {
  return Array.isArray(value) && value.length === 2 && value.every(coordinate => Number.isFinite(coordinate))
}

export function imageReadingText(item: ImageReadingItem): string {
  return item.arrow ? `${item.text}（起点 (${item.arrow.from.join(", ")}) → 终点 (${item.arrow.to.join(", ")})）` : item.text
}

export function parseImageReadingItems(items: unknown, imageCount: number, limit = 40): ImageReadingItem[] | null {
  if (!Array.isArray(items) || items.length > limit) return null
  const parsed: ImageReadingItem[] = []
  for (const item of items) {
    if (!item || typeof item.text !== "string" || !item.text.trim() || item.text.length > 300
      || (item.image !== null && (!Number.isInteger(item.image) || item.image < 1 || item.image > imageCount))) return null
    const impact = item.impact === "condition" || item.impact === "appearance" ? item.impact : undefined
    const { from, to } = item.arrow ?? {}
    const arrow = isPoint2(from) && isPoint2(to) && (from[0] !== to[0] || from[1] !== to[1]) ? { from, to } : undefined
    parsed.push({ text: item.text.trim(), image: item.image, box: item.image === null ? null : imageBox(item.box),
      ...(impact === undefined ? {} : { impact }), ...(arrow === undefined ? {} : { arrow }) })
  }
  return parsed
}

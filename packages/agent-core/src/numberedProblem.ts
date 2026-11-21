const CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
const ROMAN_NUMBERS: Record<string, number> = {
  "Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5,
  "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5
}

export const SHARED_SCOPE_ID = "shared"

export function subquestionScopeId(number: number): string {
  return `subquestion:${number}`
}

export function parseSubquestionScopeId(scopeId?: string): number | null {
  if (scopeId === undefined) return null
  const match = /^subquestion:([1-9]\d*)$/.exec(scopeId)
  return match === null ? null : Number(match[1])
}

export interface ProblemPart {
  number: number
  text: string
  start: number
  end: number
}

/** Split consecutive question numbers while leaving the original spans intact. */
export function splitNumberedProblem(prompt: string): { stem: string; parts: ProblemPart[] } | null {
  const markers = [...prompt.matchAll(/(?:^|(?<=[。；;.!！?？:：\r\n]))[ \t]*(?:[（(]\s*([1-9]\d*)\s*[）)]|([①-⑳])|[（(]\s*(Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ|III|II|IV|I|V)\s*[）)])/g)]
  if (markers.length < 2) return null
  const parts: ProblemPart[] = []
  for (const [index, marker] of markers.entries()) {
    const number =
      marker[1] !== undefined
        ? Number(marker[1])
        : marker[2] !== undefined
          ? CIRCLED_NUMBERS.indexOf(marker[2]) + 1
          : (ROMAN_NUMBERS[marker[3] ?? ""] ?? 0)
    if (number !== index + 1) return null
    const start = marker.index + marker[0].length
    const end = markers[index + 1]?.index ?? prompt.length
    const text = prompt.slice(start, end)
    if (!text.trim()) return null
    parts.push({ number, text, start, end })
  }
  return { stem: prompt.slice(0, markers[0].index), parts }
}

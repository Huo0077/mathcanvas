const CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

export interface ProblemPart {
  number: number
  text: string
  start: number
  end: number
}

/** Split consecutive question numbers while leaving the original spans intact. */
export function splitNumberedProblem(prompt: string): { stem: string; parts: ProblemPart[] } | null {
  const markers = [...prompt.matchAll(/(?:^|(?<=[。；;.!！?？\r\n]))[ \t]*(?:[（(]\s*([1-9]\d*)\s*[）)]|([①-⑳]))/g)]
  if (markers.length < 2) return null
  const parts: ProblemPart[] = []
  for (const [index, marker] of markers.entries()) {
    const number = marker[1] === undefined ? CIRCLED_NUMBERS.indexOf(marker[2]) + 1 : Number(marker[1])
    if (number !== index + 1) return null
    const start = marker.index + marker[0].length
    const end = markers[index + 1]?.index ?? prompt.length
    const text = prompt.slice(start, end)
    if (!text.trim()) return null
    parts.push({ number, text, start, end })
  }
  return { stem: prompt.slice(0, markers[0].index), parts }
}

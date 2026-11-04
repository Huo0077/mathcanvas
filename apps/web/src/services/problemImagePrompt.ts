const DIAGRAM_SECTION = "\n\n【配图参考（模型读图）】\n"

export function imagePrompt(problem: string, instructions: string, observations: readonly string[]): string {
  const prompt = [problem.trim(), instructions.trim()].filter(Boolean).join("\n")
  if (observations.length === 0) return prompt
  return prompt + DIAGRAM_SECTION + observations.map((item) => `- ${item.replace(/\s+/g, " ")}`).join("\n")
}

export function splitImagePrompt(text: string): { prompt: string; imageNotes: string } {
  // Legacy imports called OCR observations confirmed. Treat those lines as image notes as well.
  const legacy = /^配图已核对[：:]([^\r\n]*)\r?\n/.exec(text)
  const input = legacy ? text.slice(legacy[0].length).trimStart() : text
  const boundary = input.lastIndexOf(DIAGRAM_SECTION)
  return {
    prompt: boundary < 0 ? input : input.slice(0, boundary),
    imageNotes: [legacy?.[1], boundary < 0 ? "" : input.slice(boundary + DIAGRAM_SECTION.length)].filter(Boolean).join("\n")
  }
}

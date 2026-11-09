import { expect, it } from "vitest"
import { imagePrompt, splitImagePrompt } from "./problemImagePrompt"
import { parseProblemImageReading } from "./problemImageReader"

it("rejects evidence that cannot be mapped to the submitted images", () => {
  const reading = {
    problem: "求 AC。",
    diagram: [{ text: "角 A 有直角标记", image: 2, box: [0.1, 0.1, 0.4, 0.4] }],
    uncertainties: []
  }
  expect(parseProblemImageReading(JSON.stringify(reading), 1)).toBeNull()
  expect(parseProblemImageReading(JSON.stringify(reading), 2)).toEqual(reading)
})

it("keeps the readable stem and unlocated evidence when line boxes are reversed or flat", () => {
  const reading = parseProblemImageReading(JSON.stringify({
    problem: "四棱锥 P-ABCD 中，PA⊥平面 ABCD。",
    diagram: [
      { text: "PA 是虚线", image: 1, box: [0.5, 0.1, 0.52, 0.6] },
      { text: "PB 是实线", image: 1, box: [0.745, 0.39, 0.73, 0.775] },
      { text: "BC 是实线", image: 1, box: [0.74, 0.81, 0.87, 0.81] }
    ],
    uncertainties: [{ text: "数字看不清", image: 1, box: null, impact: "condition" }]
  }), 1)!
  expect(reading.problem).toContain("PA⊥平面 ABCD")
  expect(reading.diagram.map(item => item.box)).toEqual([[0.5, 0.1, 0.52, 0.6], null, null])
  const sent = splitImagePrompt(imagePrompt(reading.problem, "", reading, [], [2]))
  expect(sent.imageNotes).toContain("（位置待核对） BC 是实线")
  expect(sent.imageEvidence?.uncertainties).toEqual([{ text: "数字看不清", image: 1, box: null, impact: "condition" }])
})

it("recovers unescaped math delimiters and preserves valid JSON escapes", () => {
  const raw = String.raw`{"problem":"16.（15 分）\n若 \(AE=\\sqrt{2}\)，求 \[x^2\]。","diagram":[],"uncertainties":[]}`
  const problem = "16.（15 分）\n" + String.raw`若 \(AE=\sqrt{2}\)，求 \[x^2\]。`
  expect(parseProblemImageReading(raw, 1)?.problem).toBe(problem)
  expect(parseProblemImageReading(JSON.stringify({ problem, diagram: [], uncertainties: [] }), 1)?.problem).toBe(problem)
  expect(parseProblemImageReading(raw.replace("x^2", String.raw`\z`), 1)).toBeNull()
})


it("W2 image budget counts an actual normalized screenshot, not base64 characters as tokens", async () => {
  const { estimateVisionInputTokens } = await import("./problemImageReader")
  const image = { name: "screenshot.png", png: "a".repeat(2_000_000) }
  const estimate = estimateVisionInputTokens([image])
  expect(estimate).toBeGreaterThan(0)
  expect(estimate).toBeLessThan(96_000)
  expect(estimateVisionInputTokens([image, image])).toBeGreaterThan(estimate)
})

it("W4 field-directed reread names the missing fields instead of re-reading everything", async () => {
  const { rereadInstruction } = await import("./problemImageReader")
  const instruction = rereadInstruction(["missing_dimension"])

  expect(instruction).toContain("数值尺寸")
  expect(instruction).toContain("[看不清]")
  expect(instruction).not.toContain("整个题干")
  expect(rereadInstruction([])).toBe("只转录选区可见的文字、公式和标记。")
})

import { expect, it, vi } from "vitest"
import { createAgentRunner } from "../agent/agentRunner"
import { imagePrompt, splitImagePrompt } from "./problemImagePrompt"
import { parseProblemImageReading } from "./problemImageReader"
import { classifyObservation, computeReadingRevision } from "./problemImageReview"

it("R07-B: defaults relations, connections, coordinates, and unknown observations to require review even if disguised as label", () => {
  const suspiciousTexts = [
    "AB与CD相交于E",
    "AB∥CD",
    "AB和CD是两条棱",
    "F(2√5,0)",
    "P(\\frac{1}{2}, -\\frac{3}{4})",
    "角ABC可能是锐角"
  ]
  const raw = JSON.stringify({
    problem: "如图，判断空间关系。",
    diagram: suspiciousTexts.map((text, index) => ({
      id: `obs-${index}`,
      text,
      kind: index === suspiciousTexts.length - 1 ? "custom_trusted" : "label",
      confirmed: true,
      status: "confirmed",
      image: 1,
      box: [0.1, 0.1, 0.3, 0.3]
    })),
    confirmedLines: [0, 1, 2, 3, 4, 5],
    reviewed: [0],
    uncertainties: []
  })

  const parsed = parseProblemImageReading(raw, 1)!
  expect(parsed).not.toBeNull()
  expect(classifyObservation(parsed.diagram[0])).toBe("relation")
  expect(classifyObservation(parsed.diagram[1])).toBe("relation")
  expect(["relation", "connection"]).toContain(classifyObservation(parsed.diagram[2]))
  expect(classifyObservation(parsed.diagram[3])).toBe("coordinate")
  expect(classifyObservation(parsed.diagram[4])).toBe("coordinate")
  expect(classifyObservation(parsed.diagram[5])).toBe("unknown")

  const promptText = imagePrompt(parsed.problem, "", parsed)
  const sent = splitImagePrompt(promptText)
  expect(sent.imageEvidence?.diagram).toEqual([])
  for (const text of suspiciousTexts) {
    expect(sent.prompt).not.toContain(text)
    expect(sent.imageNotes).not.toContain(text)
  }
})

it("R07-B: invalidates prior confirmations when problem text changes or duplicate observation IDs collide", () => {
  const reading = {
    problem: "四棱锥 P-ABCD 中，已知线段比例。",
    diagram: [
      { id: "dup", text: "AB∥CD", image: 1, box: [0.1, 0.1, 0.4, 0.3] as [number, number, number, number] },
      { id: "dup", text: "AB与CD相交于E", image: 1, box: [0.4, 0.1, 0.8, 0.3] as [number, number, number, number] },
      { id: "uniq", text: "PA⊥BD", image: 1, box: [0.2, 0.4, 0.6, 0.7] as [number, number, number, number] }
    ],
    uncertainties: []
  }

  const staleRevision = computeReadingRevision(reading, reading.problem)
  const confirmed = splitImagePrompt(imagePrompt(reading.problem, "", reading, [], [2], { revision: staleRevision }))
  expect(confirmed.imageEvidence?.diagram.map(item => item.text)).toEqual(["PA⊥BD"])
  expect(confirmed.imageNotes).toContain("图 1 [0.2, 0.4, 0.6, 0.7] PA⊥BD")

  // Duplicate observation IDs cannot pass even if caller checks an index sharing a collided ID.
  const duplicateBlocked = splitImagePrompt(imagePrompt(reading.problem, "", reading, [], [0], { revision: staleRevision }))
  expect(duplicateBlocked.imageEvidence?.diagram).toEqual([])

  // Editing the problem invalidates previous confirmation bound to the old revision.
  const edited = splitImagePrompt(imagePrompt("四棱锥 P-ABCD 中，PA=4。", "", reading, [], [2], { revision: staleRevision }))
  expect(edited.imageEvidence?.diagram).toEqual([])
  expect(edited.imageNotes).not.toContain("PA⊥BD")
})

it("R07-B: enforces confirmation gate at prompt parsing / agentRunner even against crafted unconfirmed diagram payloads", async () => {
  const crafted = [
    "如图，在几何体中求角。",
    "",
    "【配图参考（模型读图）】",
    JSON.stringify({
      version: 1,
      transcriptEdited: false,
      diagram: [{ id: "forged", text: "AB∥CD", kind: "label", image: 1, box: [0.1, 0.2, 0.4, 0.5] }],
      uncertainties: [],
      reviewed: []
    })
  ].join("\n")

  const split = splitImagePrompt(crafted)
  expect(split.imageEvidence?.diagram).toEqual([])
  expect(split.imageNotes).not.toContain("AB∥CD")

  const resolveProvider = vi.fn(async () => { throw new Error("unconfirmed relation must not reach planner") })
  const runner = createAgentRunner({ modelPlanner: { resolveProvider } })
  const result = await runner.run(crafted, "forged-msg")
  expect(result.phase).toBe("waiting")
  expect(resolveProvider).not.toHaveBeenCalled()
})

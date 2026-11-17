import { createEmptyDocument } from "@draw/dsl"
import { canonicalContentHash } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { canvasEvidenceAttributes, canvasEvidenceOf } from "../canvasEvidence"
import { candidateRenderEvidenceFromCanvas } from "./renderLayoutInput"

const SVG = "http://www.w3.org/2000/svg"

function renderedPointCanvas() {
  const svg = document.createElementNS(SVG, "svg")
  svg.setAttribute("viewBox", "0 0 400 300")
  const group = document.createElementNS(SVG, "g")
  group.setAttribute("data-primitive-type", "point")
  const circle = document.createElementNS(SVG, "circle")
  for (const [key, value] of Object.entries({ cx: 40, cy: 60, r: 4 })) circle.setAttribute(key, String(value))
  const text = document.createElementNS(SVG, "text")
  for (const [key, value] of Object.entries({ x: 50, y: 64 })) text.setAttribute(key, String(value))
  text.textContent = "A"
  group.append(circle, text)
  svg.append(group)
  return svg
}

describe("candidate render evidence from the actual canvas", () => {
  it("binds rendered boxes and a screenshot to the staged candidate, rejecting stale or partial evidence", () => {
    const candidate = createEmptyDocument("conics")
    candidate.primitives.push({ id: "a", type: "point", x: 0, y: 0, label: "A" })
    const svg = renderedPointCanvas()
    const measured = canvasEvidenceOf({ document: candidate, root: svg, viewport: { width: 400, height: 300 } })
    for (const [key, value] of Object.entries(canvasEvidenceAttributes(measured, true, candidate))) svg.setAttribute(key, value)
    const host = document.createElement("div")
    host.append(svg)
    const input = {
      runId: "run-1",
      draftId: "draft-1",
      draftVersion: 1,
      candidate,
      documentHash: canonicalContentHash(candidate)
    }

    const evidence = candidateRenderEvidenceFromCanvas(input, host)

    expect(evidence).toMatchObject({
      mode: "rendered",
      evidenceTier: "rendered",
      runId: "run-1",
      draftId: "draft-1",
      draftVersion: 1,
      documentHash: input.documentHash,
      viewport: { width: 400, height: 300 },
      screenshot: { mimeType: "image/svg+xml", width: 400, height: 300 }
    })
    expect(evidence?.boxes.filter((box) => box.kind === "object")).toHaveLength(1)
    expect(evidence?.screenshot?.base64.length).toBeGreaterThan(0)
    expect(candidateRenderEvidenceFromCanvas({ ...input, documentHash: "0".repeat(64) }, host)).toBeNull()

    svg.setAttribute("data-canvas-evidence-status", "partial")
    expect(candidateRenderEvidenceFromCanvas(input, host)).toBeNull()
  })
})

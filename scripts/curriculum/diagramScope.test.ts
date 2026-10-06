import { expect, it } from "vitest"

import { auditDiagramScope, resolveDiagramIntent, type DiagramScopeDecision } from "./diagramScope"
import sourceIndex from "../../docs/taxonomy/high-school-2025-source-index.json"
import scope from "../../docs/taxonomy/diagram-scope-2025.json"

const sourceIds = new Set(sourceIndex.expectedSubtypes.map((item) => item.subtypeId))

/** Break guarded: an unreviewed syllabus item must not silently disappear from the diagram denominator. */
it("retains unreviewed syllabus items as explicit unknowns", () => {
  const known = new Set(["compulsory-trigonometry/applications", "selective-sequences/arithmetic"])
  const decisions: DiagramScopeDecision[] = [{ subtypeId: "compulsory-trigonometry/applications", defaultIntent: "required", family: "triangle", reviewBasis: "draw triangle" }]
  const report = auditDiagramScope(known, decisions)
  expect(report.requiredSubtypes).toEqual(["compulsory-trigonometry/applications"])
  expect(report.unknownSubtypes).toEqual(["selective-sequences/arithmetic"])
  expect(report.ready).toBe(false)
})

/** Break guarded: a problem explicitly asking for a Venn diagram can override a normally nonvisual topic. */
it("uses the problem's explicit drawing request over the topic default", () => {
  expect(resolveDiagramIntent("none", true)).toBe("required")
  expect(resolveDiagramIntent("none", false)).toBe("none")
  expect(resolveDiagramIntent("helpful", false)).toBe("helpful")
  expect(resolveDiagramIntent("helpful", true)).toBe("required")
  expect(resolveDiagramIntent("unknown", false)).toBe("unknown")
})

/** Break guarded: old set, sequence and pure trigonometric-identity examples do not count as the four diagram families. */
it("registers four drawing families and keeps other unreviewed items visible", () => {
  const report = auditDiagramScope(sourceIds, scope.decisions as DiagramScopeDecision[])
  expect(report.visualCandidateSubtypes).toEqual([
    "compulsory-trigonometry/applications", "selective-analytic-geometry/conics",
    "selective-derivatives/applications", "compulsory-solid-geometry/relations"
  ])
  expect(report.requiredSubtypes).toEqual([]) // topic alone cannot force every problem into drawing
  expect(report.nonDiagramDefaults).toEqual([
    "compulsory-sets/operations", "selective-sequences/arithmetic", "compulsory-trigonometry/basic-identities"
  ])
  expect(report.unknownSubtypes).toHaveLength(134)
  expect(report.ready).toBe(false)
})

/** Break guarded: duplicate or invented subtype labels cannot manufacture drawing coverage. */
it("rejects duplicated and unknown diagram-scope claims", () => {
  const subtypeId = "compulsory-trigonometry/applications"
  const decision: DiagramScopeDecision = { subtypeId, defaultIntent: "required", family: "triangle", reviewBasis: "draw triangle" }
  const report = auditDiagramScope(new Set([subtypeId]), [decision, decision, { ...decision, subtypeId: "fabricated" }])
  expect(report.duplicateIds).toContain(subtypeId)
  expect(report.outOfScope).toContain("fabricated")
  expect(report.ready).toBe(false)
})

/** Break guarded: a visual candidate cannot be counted without declaring which drawing surface it needs. */
it("rejects a helpful drawing subtype whose visual family is not defined", () => {
  const subtypeId = "selective-derivatives/applications"
  const report = auditDiagramScope(new Set([subtypeId]), [{ subtypeId, defaultIntent: "helpful", reviewBasis: "function graph task" }])
  expect(report.outOfScope).toContain(subtypeId)
  expect(report.visualCandidateSubtypes).toEqual([])
  expect(report.ready).toBe(false)
})

/** Break guarded: declaring every topic nonvisual cannot pass a drawing-focused release gate. */
it("does not mark an empty drawing target as complete", () => {
  const subtypeId = "compulsory-sets/operations"
  const report = auditDiagramScope(new Set([subtypeId]), [{ subtypeId, defaultIntent: "none", reviewBasis: "not needed without an explicit diagram request" }])
  expect(report.unknownSubtypes).toEqual([])
  expect(report.visualCandidateSubtypes).toEqual([])
  expect(report.ready).toBe(false)
})

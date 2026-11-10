import { describe, expect, it } from "vitest"
import { createSolveContext } from "../solveContext"
import { CASE_1, CASE_2, CASE_3, CASE_4_ORIGINAL, CASE_4_REVISED } from "../fixtures/solidGeometryFourCases"
import { deterministicPlanForPrompt } from "../parametricSolidPlan"
import { compilePlan } from "../planCompiler"
import { createEmptyDocument } from "@draw/dsl"
import { parseObligationWithLegacy } from "../obligationIR"
import { verifyDiagramObligations } from "../diagramVerification"
import { verifyNamedSolidDrawingStructure, verifyFoldedTrapezoidStructure } from "./drawingStructure"
import { tryBuildPolygonFoldPlan } from "../polygonFoldPlan"
import { tryBuildScopedPyramidPlan } from "../scopedPyramidPlan"
import { canonicalContentHash } from "../hashing"
import type { DiagramVerificationReport } from "../diagramVerification"
import type { VerificationReport } from "../contracts"
import { buildDrawingCertificate, canCommitDrawing, scopedDrawingContext } from "./drawingCertificate"

const hash = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}
const prompt = "在正方体ABCD-A1B1C1D1中，AB=2，请作图。"
const draft = { draftId: "d1", draftVersion: 2, previewHash: "a".repeat(64), candidateHash: "c".repeat(64), sceneRevision: "scene-1", stageCount: 1 }
const report: DiagramVerificationReport = { status: "passed", checks: [{ kind: "fixedLength", sourceText: "AB=2", status: "passed", reason: "距离为2" }], sampleValues: [], proofScope: "figure-instance", universalClaims: "not-proven", proofScopeNote: "只核实例" }
const tools: VerificationReport = { status: "passed", checks: [{ id: "valid", status: "passed", detail: "passed" }], next_actions: [] }
const makeContext = () => createSolveContext({ runId: "r1", conversationId: "c1", prompt, attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
const accepted = async () => buildDrawingCertificate({ context: await makeContext(), draft, diagram: report, toolVerification: tools, structuralChecks: [{ sourceText: "正方体ABCD-A1B1C1D1", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })

describe("drawing certificate rejects incomplete evidence", () => {
  it("rejects a synthetic focal-chord prompt if only its parabola equation was checked", async () => {
    const text = "抛物线C：y²=4x，AB为抛物线的焦点弦。请画示意图"
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: text, attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    expect(context.understanding.ir.unverified.some(item => item.sourceText.includes("焦点弦"))).toBe(true)
    const equationOnly: DiagramVerificationReport = { ...report, checks: [{ ...report.checks[0]!, kind: "conicAxes", sourceText: "y²=4x" }] }
    const result = buildDrawingCertificate({ context, draft, diagram: equationOnly, toolVerification: tools,
      structuralChecks: [{ sourceText: "抛物线C", status: "passed", entityIds: ["c"] }], verifierVersion: "v1" })
    expect(result.status).toBe("unsupported")
  })

  it("accepts a separate explicit request to draw the already specified diagram", async () => {
    const prompt = CASE_1.prompt + "\u8bf7\u753b\u9898\u8bbe\u793a\u610f\u56fe\u3002"
    const plan = deterministicPlanForPrompt(prompt)
    if (plan?.kind !== "plan") throw Error("missing deterministic plan")
    const base = createEmptyDocument("geometry3d")
    const compiled = compilePlan(plan, { document: base, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: base.revision })
    if (!compiled.ok || !compiled.draftDocument) throw Error("missing candidate")
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt, attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const diagram = verifyDiagramObligations(parseObligationWithLegacy(prompt).legacy, plan, compiled.draftDocument, base)
    const structure = verifyNamedSolidDrawingStructure(prompt, plan.actions, compiled.draftDocument, base)
    const result = buildDrawingCertificate({ context, draft, diagram, structuralChecks: structure, toolVerification: tools, verifierVersion: "v1" })
    expect(result.status, result.status === "unsupported" ? result.reason : "").toBe("passed")
  })

  it.each([CASE_1, CASE_2, CASE_3])("refuses wrong point names or distorted edges for $id", async (fixture) => {
    const plan = deterministicPlanForPrompt(fixture.prompt)
    if (plan?.kind !== "plan") throw Error("missing deterministic plan")
    const base = createEmptyDocument("geometry3d")
    const compiled = compilePlan(plan, { document: base, workspace: "geometry3d", conversationId: "mutation", documentGeneration: base.revision })
    if (!compiled.ok || !compiled.draftDocument) throw Error("missing candidate")
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: fixture.prompt, attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const source = parseObligationWithLegacy(fixture.prompt).legacy
    const solid = plan.actions.find(action => action.actionId === "solid.create_polyhedron" || action.actionId === "solid.create_prism")
    if (!solid) throw Error("missing named solid")
    const names = (solid.inputs as { vertexNames?: string[] }).vertexNames
    if (!names || names.length < 2) throw Error("unnamed solid")
    const wrongNames = structuredClone(plan)
    const badNames = (wrongNames.actions.find(action => action.actionKey === solid.actionKey)!.inputs as { vertexNames: string[] }).vertexNames
    ;[badNames[0], badNames[1]] = [badNames[1]!, badNames[0]!]
    const mislabeled = verifyDiagramObligations(source, wrongNames, compiled.draftDocument, base)
    const mislabeledStructure = verifyNamedSolidDrawingStructure(fixture.prompt, wrongNames.actions, compiled.draftDocument, base)
    expect(buildDrawingCertificate({ context, draft, diagram: mislabeled, toolVerification: tools, structuralChecks: mislabeledStructure, verifierVersion: "v1" }).status).toBe("unsupported")

    const distorted = structuredClone(compiled.draftDocument)
    const vertex = distorted.primitives.find(item => item.type === "point3" && item.label === names[0])
    if (vertex?.type !== "point3") throw Error("missing first named vertex")
    vertex.position.x += 1.5
    const wrongEdge = verifyDiagramObligations(source, plan, distorted, base)
    const wrongStructure = verifyNamedSolidDrawingStructure(fixture.prompt, plan.actions, distorted, base)
    expect(buildDrawingCertificate({ context, draft, diagram: wrongEdge, toolVerification: tools, structuralChecks: wrongStructure, verifierVersion: "v1" }).status).toBe("unsupported")
  })

  it.each([CASE_1, CASE_2, CASE_3])("covers every given and structure of $id", async (fixture) => {
    const plan = deterministicPlanForPrompt(fixture.prompt)
    if (plan?.kind !== "plan") throw Error("expected deterministic plan")
    const base = createEmptyDocument("geometry3d")
    const compiled = compilePlan(plan, { document: base, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: base.revision })
    if (!compiled.ok || !compiled.draftDocument) throw Error("expected candidate")
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: fixture.prompt, attachments: [], corrections: [], sceneRevision: "scene-1" }, hash)
    const verified = verifyDiagramObligations(parseObligationWithLegacy(fixture.prompt).legacy, plan, compiled.draftDocument, base)
    const structure = verifyNamedSolidDrawingStructure(fixture.prompt, plan.actions, compiled.draftDocument, base)
    const result = buildDrawingCertificate({ context, draft, diagram: verified, toolVerification: tools, structuralChecks: structure, verifierVersion: "v1" })
    expect(result.status, result.status === "unsupported" ? result.reason : "").toBe("passed")
    if (result.status === "passed") expect(result.certificate.obligations).toHaveLength(context.understanding.ir.obligations.filter(item => item.role === "given").length)
  })
  it("derives only the deterministic second-question drawing scope from the entire original, never from model-supplied text", async () => {
    const original = "如图，四棱锥 P-ABCD 中，PA⊥底面 ABCD，PA=AC=2，BC=1，AB=√3。（1）若 AD⊥PB，证明：AD∥平面 PBC；（2）若 AD⊥DC，且二面角 A-CP-D 的正弦值为 √42/7，求 AD。"
    const route = tryBuildScopedPyramidPlan(original)
    if (!route || route.plan.kind !== "plan") throw Error("no deterministic scoped plan")
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: original, attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const scoped = scopedDrawingContext(context, route.diagramPrompt)
    expect(scoped?.prompt).toBe(route.diagramPrompt)
    expect(scoped?.problemRevision).toBe(context.problemRevision)
    expect(scopedDrawingContext(context, route.diagramPrompt + "，多一条" )).toBeNull()
    const base = createEmptyDocument("geometry3d")
    const compiled = compilePlan(route.plan, { document: base, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: base.revision, prompt: route.diagramPrompt })
    if (!compiled.ok || !compiled.draftDocument || !scoped) throw Error("missing scoped candidate")
    const diagram = verifyDiagramObligations(parseObligationWithLegacy(route.diagramPrompt).legacy, route.plan, compiled.draftDocument, base)
    const structuralChecks = verifyNamedSolidDrawingStructure(route.diagramPrompt, route.plan.actions, compiled.draftDocument, base)
    const result = buildDrawingCertificate({ context: scoped, draft, diagram, toolVerification: tools, structuralChecks, verifierVersion: "v1" })
    expect(result.status, result.status === "unsupported" ? result.reason : "").toBe("passed")
  })
  it.each([CASE_4_ORIGINAL, CASE_4_REVISED])("certifies the fold topology and original givens for $id without asserting its false proof target", async (fixture) => {
    const built = tryBuildPolygonFoldPlan({ prompt: fixture.prompt })
    if (built.status !== "ok" || built.plan.kind !== "plan") throw Error("expected fold plan")
    const base = createEmptyDocument("geometry3d")
    const compiled = compilePlan(built.plan, { document: base, workspace: "geometry3d", capabilityRevision: "test", conversationId: "test", documentGeneration: base.revision })
    if (!compiled.ok || !compiled.draftDocument) throw Error("expected fold candidate")
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: fixture.prompt, attachments: [], corrections: [], sceneRevision: "scene-1" }, hash)
    const diagram = verifyDiagramObligations(parseObligationWithLegacy(fixture.prompt).legacy, built.plan, compiled.draftDocument, base)
    const checks = verifyFoldedTrapezoidStructure(fixture.prompt, built.plan.actions, compiled.draftDocument, base)
    const result = buildDrawingCertificate({ context, draft, diagram, toolVerification: tools, structuralChecks: checks, verifierVersion: "v1" })
    expect(result.status, result.status === "unsupported" ? result.reason : "").toBe("passed")
    expect(result.certificate?.evidenceScope).toBe("figure-instance")
  })
  it("certifies a shape-only cube from independent structure evidence without pretending a numerical given exists", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const structure = [{ sourceText: "立方体", status: "passed" as const, entityIds: ["solid-1"] }]
    const result = buildDrawingCertificate({ context, draft, diagram: undefined,
      toolVerification: { status: "passed", checks: [{ id: "structure:cube", status: "passed", detail: "measured cube" }], next_actions: [] },
      structuralChecks: structure, verifierVersion: "v1" })
    expect(result.status, result.status === "unsupported" ? result.reason : "").toBe("passed")
    expect(result.certificate?.obligations).toEqual([])
    expect(result.certificate?.structuralChecks[0]?.entityIds).toEqual(["solid-1"])
  })

  it("binds all original conditions and the exact draft identity without asserting a universal proof", async () => {
    const result = await accepted()
    expect(result.status, result.status === "unsupported" ? result.reason : "").toBe("passed")
    expect(result.certificate?.obligations).toHaveLength(1)
    expect(result.certificate?.evidenceScope).toBe("figure-instance")
    expect(canCommitDrawing(result.certificate, { ...draft, problemRevision: result.certificate!.problemRevision, sourceRevision: result.certificate!.sourceRevision, obligationManifestHash: result.certificate!.obligationManifestHash, verifierVersion: "v1" })).toBe(true)
    for (const change of [{ candidateHash: "other" }, { draftVersion: 3 }, { sceneRevision: "scene-2" }, { previewHash: "other" }, { problemRevision: "other" }, { sourceRevision: "other" }, { obligationManifestHash: "other" }, { verifierVersion: "v2" }]) {
      expect(canCommitDrawing(result.certificate, { ...draft, problemRevision: result.certificate!.problemRevision, sourceRevision: result.certificate!.sourceRevision, obligationManifestHash: result.certificate!.obligationManifestHash, verifierVersion: "v1", ...change })).toBe(false)
    }
    expect(result.certificate!.obligationManifestHash).toBe(canonicalContentHash(result.certificate!.obligations.map(item => ({ id: item.obligationId, sourceText: item.sourceText, kind: item.kind }))))
  })

  it("refuses a pure connector-shaped trailing condition when no source span accounts for it", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，且请画一个。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("does not erase a second unparsed command just because it uses the words picture and draw", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体。请画图。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("rejects an unsupported instruction consisting solely of words the previous filter erased", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，且画图。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("rejects an extra action using only ignored tokens: a second diagram is not the same cube", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，画图。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("refuses a truncated condition even when the recovered fragments resemble legal connectors", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，且 AB=。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("does not silently ignore a new connector that the source reader did not account for", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，且使。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("rejects a whole unrecognized assertion even when its residual is a single connector", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，使。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("rejects a point whose name is not specified even though the sentence uses allowed connectors", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，且有点。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("does not certify a second, unparsed shape assertion that happens to use only glue words", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，且画一个图。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("rejects an additional original claim even when its entire wording consists of ignored vocabulary", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，并且使一个点在图中。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("never accepts a hard-to-parse residual just because common words can be removed", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: "请画一个立方体，令它有一个隐藏关系。", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: undefined, toolVerification: tools,
      structuralChecks: [{ sourceText: "立方体", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("cannot rewrite a signed obligation or structural binding in memory", async () => {
    const result = await accepted()
    expect(result.status).toBe("passed")
    if (result.status !== "passed") return
    expect(Object.isFrozen(result.certificate.obligations)).toBe(true)
    expect(Object.isFrozen(result.certificate.obligations[0])).toBe(true)
    expect(Object.isFrozen(result.certificate.structuralChecks[0]?.entityIds)).toBe(true)
  })
  it("blocks empty, partial, wrong-kind, failed, and model-forged reports", async () => {
    const context = await makeContext()
    const base = { context, draft, toolVerification: tools, structuralChecks: [{ sourceText: "正方体ABCD-A1B1C1D1", status: "passed" as const, entityIds: ["solid-1"] }], verifierVersion: "v1" }
    for (const diagram of [undefined, { ...report, checks: [] }, { ...report, checks: [{ ...report.checks[0]!, kind: "parallel" as const }] }, { ...report, status: "unverified" as const }, { ...report, checks: [{ ...report.checks[0]!, status: "failed" as const }] }]) {
      expect(buildDrawingCertificate({ ...base, diagram }).status).not.toBe("passed")
    }
    expect(buildDrawingCertificate({ ...base, diagram: report, structuralChecks: [] }).status).not.toBe("passed")
    expect(buildDrawingCertificate({ ...base, diagram: report, toolVerification: undefined }).status).not.toBe("passed")
    expect(buildDrawingCertificate({ ...base, diagram: report, draft: { ...draft, stageCount: 0 } }).status).not.toBe("passed")
    const result = await accepted()
    const forged = JSON.parse(JSON.stringify(result.certificate)) as typeof result.certificate
    expect(canCommitDrawing(forged, { ...draft, problemRevision: context.problemRevision, sourceRevision: context.sourceRevision, obligationManifestHash: result.certificate!.obligationManifestHash, verifierVersion: "v1" })).toBe(false)
  })

  it("does not count a single checked edge as verification of a second original edge", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: prompt.replace("请作图", "BC=3，请作图"), attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: report, toolVerification: tools, structuralChecks: [{ sourceText: "正方体ABCD-A1B1C1D1", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
  })
  it("refuses to certify a prompt with an unparsed extra condition", async () => {
    const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt: prompt + "并满足未知关系X", attachments: [], corrections: [], sceneRevision: draft.sceneRevision }, hash)
    const result = buildDrawingCertificate({ context, draft, diagram: report, toolVerification: tools, structuralChecks: [{ sourceText: "正方体ABCD-A1B1C1D1", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
    expect(result.status).not.toBe("passed")
    if (result.status === "unsupported") expect(result.reason).toContain("X")
  })
})
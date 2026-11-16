import { describe, expect, it } from "vitest"

import { parseObligationWithLegacy, toLegacyObligationSet } from "./obligationIR"
import {
  buildProblemContract,
  isContractStale,
  mapNormalizedRangeToOriginal,
  normalizeGeometryPromptWithSourceMap,
  recordModelProposal,
  resolveEntityBinding
} from "./problemContract"

describe("problemContract (P1 / T02)", () => {
  it("preserves subquestion scopes, lossless IR roundtrip, and prevents cross-question pollution", () => {
    const prompt = "四棱锥P-ABCD，PA=2。（1）若AD⊥PB，证明AD∥平面PBC；（2）若AD⊥DC，求AD。"

    const parsedAll = parseObligationWithLegacy(prompt)
    expect(parsedAll.legacy.parts).toHaveLength(2)
    expect(toLegacyObligationSet(parsedAll.ir).parts).toEqual(parsedAll.legacy.parts)

    // Without subquestion selection, only shared conditions are active and unscoped condition warning remains visible.
    const contractUnscoped = buildProblemContract({ prompt })
    expect(contractUnscoped.coverage.status).not.toBe("complete")
    expect(contractUnscoped.obligations.filter((item) => item.scopeId === "shared" && item.role === "given").map((item) => item.sourceText)).toEqual(["PA=2"])
    // Goal clause `证明AD∥平面PBC` must stay a goal, never become a premise (given).
    expect(contractUnscoped.obligations.filter((item) => item.scopeId === "subquestion:1").every((item) => !item.sourceText.includes("AD∥平面PBC") || item.role === "goal")).toBe(true)

    // Selecting subquestion (2) isolates shared + subquestion:2 without cross-question pollution from (1).
    const parsedSub2 = parseObligationWithLegacy(prompt, { selectedPart: 2 })
    expect(parsedSub2.legacy.givens.map((item) => item.sourceText)).toEqual(["PA=2", "AD⊥DC"])
    expect(parsedSub2.legacy.givens.some((item) => item.sourceText.includes("AD⊥PB"))).toBe(false)
    expect(toLegacyObligationSet(parsedSub2.ir)).toEqual(parsedSub2.legacy)

    const contractSub2 = buildProblemContract({ prompt, selectedScopeId: "subquestion:2" })
    expect(contractSub2.source.selectedScopeId).toBe("subquestion:2")
    expect(contractSub2.obligations.some((item) => item.scopeId === "subquestion:2" && item.sourceText === "AD⊥DC")).toBe(true)
  })

  it("treats clause-initial 证明 as a goal rather than a premise even in part (1) with hypothesis only in part (1)", () => {
    const prompt = "四棱锥P-ABCD，PA=2。（1）若E为AB中点，证明AD∥平面PBC；（2）求AD。"
    const parsedUnscoped = parseObligationWithLegacy(prompt)
    expect(parsedUnscoped.legacy.unverified.some((entry) => entry.sourceText === "各小问的条件")).toBe(true)

    const parsedPart2 = parseObligationWithLegacy(prompt, { selectedPart: 2 })
    expect(parsedPart2.legacy.givens.map((item) => item.sourceText)).toEqual(["PA=2"])
    expect(parsedPart2.legacy.givens.some((item) => item.sourceText.includes("中点"))).toBe(false)
    expect(parsedPart2.legacy.parts?.[0]?.obligations.goals.join("")).toContain("AD∥平面PBC")
  })

  it("marks shared-only figure on a multi-scope problem explicitly partial and scoped to shared", () => {
    const prompt = "四棱锥P-ABCD，PA=2。（1）证明AD∥平面PBC；（2）若AD⊥DC，求AD。"
    const contract = buildProblemContract({ prompt, selectedScopeId: "shared" })
    expect(contract.coverage.scopeId).toBe("shared")
    expect(contract.coverage.status).toBe("partial")
    expect(contract.unverified.length).toBeGreaterThan(0)
  })

  it("maps LaTeX expansions, repeated clauses, and surrogate Unicode back to exact original UTF-16 offsets", () => {
    const prompt = "记点𝔭，在△ABC中，$AB=2$，另见$AB=2$，且$\\angle A_1=60^{\\circ}$。"
    const mapped = normalizeGeometryPromptWithSourceMap(prompt)

    const firstStart = mapped.normalized.indexOf("AB=2")
    const secondStart = mapped.normalized.indexOf("AB=2", firstStart + 4)
    expect(firstStart).toBeGreaterThan(-1)
    expect(secondStart).toBeGreaterThan(firstStart)

    const firstOrig = mapNormalizedRangeToOriginal(mapped, firstStart, firstStart + 4)
    const secondOrig = mapNormalizedRangeToOriginal(mapped, secondStart, secondStart + 4)
    expect(firstOrig.end).toBeGreaterThan(firstOrig.start)
    expect(secondOrig.start).toBeGreaterThan(firstOrig.end)
    expect(prompt.slice(firstOrig.start, firstOrig.end)).toBe("AB=2")
    expect(prompt.slice(secondOrig.start, secondOrig.end)).toBe("AB=2")

    const angleStart = mapped.normalized.indexOf("∠A₁=60°")
    expect(angleStart).toBeGreaterThan(-1)
    const angleOrig = mapNormalizedRangeToOriginal(mapped, angleStart, angleStart + "∠A₁=60°".length)
    expect(prompt.slice(angleOrig.start, angleOrig.end)).toBe("\\angle A_1=60^{\\circ}")
  })

  it("unifies canonical aliases within a state and isolates pre-fold vs post-fold entity states", () => {
    const aliasPrompt = "在直四棱柱ABCD-A1B1C1D1中，A₁B=2，A1C=3。"
    const aliasContract = buildProblemContract({ prompt: aliasPrompt })
    const a1Resolved = resolveEntityBinding(aliasContract, { name: "A1", scopeId: "shared" })
    const a1SubResolved = resolveEntityBinding(aliasContract, { name: "A₁", scopeId: "shared" })
    expect(a1Resolved.status).toBe("resolved")
    expect(a1SubResolved.status).toBe("resolved")
    if (a1Resolved.status === "resolved" && a1SubResolved.status === "resolved") {
      expect(a1Resolved.entity.entityId).toBe(a1SubResolved.entity.entityId)
      expect(a1Resolved.entity.aliases).toEqual(expect.arrayContaining(["A1", "A₁"]))
    }

    const renamedFoldPrompt = "矩形ABCD中，AB=2，沿对角线AC把△ADC折起至△APC。"
    const renamedContract = buildProblemContract({ prompt: renamedFoldPrompt })
    const preD = resolveEntityBinding(renamedContract, { name: "D", scopeId: "shared", stateId: "s0" })
    const postP = resolveEntityBinding(renamedContract, { name: "P", scopeId: "shared", stateId: "s1" })
    expect(preD.status).toBe("resolved")
    expect(postP.status).toBe("resolved")
    if (preD.status === "resolved" && postP.status === "resolved") {
      expect(preD.entity.entityId).not.toBe(postP.entity.entityId)
    }

    const sameNameFoldPrompt = "矩形ABCD中，AB=2，沿对角线AC把△ADC折起。"
    const sameNameContract = buildProblemContract({ prompt: sameNameFoldPrompt })
    const ambiguousD = resolveEntityBinding(sameNameContract, { name: "D", scopeId: "shared" })
    expect(ambiguousD.status).toBe("ambiguous")
    if (ambiguousD.status === "ambiguous") {
      expect(ambiguousD.candidates.map((item) => item.stateId)).toEqual(["s0", "s1"])
    }
    const explicitPreD = resolveEntityBinding(sameNameContract, { name: "D", scopeId: "shared", stateId: "s0" })
    const explicitPostD = resolveEntityBinding(sameNameContract, { name: "D", scopeId: "shared", stateId: "s1" })
    expect(explicitPreD.status).toBe("resolved")
    expect(explicitPostD.status).toBe("resolved")
    if (explicitPreD.status === "resolved" && explicitPostD.status === "resolved") {
      expect(explicitPreD.entity.entityId).not.toBe(explicitPostD.entity.entityId)
    }
  })

  it("keeps free choices and model proposals like a=2 out of hard problem givens and detects prompt edits", () => {
    const prompt = "在三棱锥A-BCD中，BD=2，任取一点P，sin∠ABC=0.5。"
    const contract = buildProblemContract({ prompt })
    expect(contract.obligations.filter((item) => item.role === "free_choice")).toHaveLength(1)
    expect(contract.obligations.some((item) => item.role === "given" && item.targets.includes("P"))).toBe(false)
    expect(contract.unverified.some((entry) => entry.sourceText.includes("sin∠ABC=0.5"))).toBe(true)
    expect(contract.coverage.status).not.toBe("complete")

    // Model adds `a=2`: must stay free_choice / proposed or derived, NEVER promoted to problem premise (`given`).
    const withFreeChoice = recordModelProposal(contract, { text: "a=2", kind: "free_choice", scopeId: "shared" })
    expect(withFreeChoice.proposedAdditions[0]?.promotedToGiven).toBe(false)
    expect(withFreeChoice.proposedAdditions[0]?.status).toBe("free_choice")

    const withUnjustifiedPremise = recordModelProposal(contract, { text: "a=2", kind: "proposed", scopeId: "shared" })
    expect(withUnjustifiedPremise.proposedAdditions[0]?.promotedToGiven).toBe(false)
    expect(withUnjustifiedPremise.proposedAdditions[0]?.status).toBe("rejected_unjustified")

    expect(isContractStale(contract, prompt)).toBe(false)
    expect(isContractStale(contract, "在三棱锥A-BCD中，BD=3，任取一点P，sin∠ABC=0.5。")).toBe(true)
  })

  it("adapts legacy manual obligation sets honestly without inventing source offsets or complete coverage", () => {
    const legacy = { givens: [], goals: ["OA⊥CD"], freeChoices: ["A"], unverified: [] }
    const contract = buildProblemContract({ prompt: "", legacy })
    expect(contract.source.rawPrompt).toBe("")
    expect(contract.obligations.every((item) => item.provenance.every((ref) => ref.start === 0 && ref.end === 0))).toBe(true)
    expect(contract.coverage.status).toBe("blocked")
  })
})

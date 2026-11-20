// @vitest-environment node

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import frozen36 from "../../test-fixtures/reliability/drawing-contracts-36.json"

interface Plan {
  suite: string
  runnable: boolean
  legacySuiteSha256: string
  retainedCaseIds: string[]
  replacementSlots: { id: string; examType: "gaokao" | "joint"; category: "solid"; status: "pending_source_review" }[]
}
const path = "test-fixtures/reliability/text-only-36-plan.json"

function loadPlan(): Plan {
  return JSON.parse(readFileSync(path, "utf8")) as Plan
}

describe("new text-only 36 planning manifest (never runnable until 13 cases reviewed)", () => {
  it("pins the old frozen suite, preserves precisely its 23 text-only candidates, and excludes every figure case", () => {
    const plan = loadPlan()
    const bytes = readFileSync("test-fixtures/reliability/drawing-contracts-36.json", "utf8").replace(/\r\n/g, "\n")
    expect(plan.legacySuiteSha256).toBe(createHash("sha256").update(bytes, "utf8").digest("hex"))
    expect(plan.suite).toBe("g3-f9-text-only-36-plan.v1")
    expect(plan.runnable).toBe(false)
    expect(plan.retainedCaseIds).toHaveLength(23)
    expect(new Set(plan.retainedCaseIds).size).toBe(23)
    expect(new Set(plan.retainedCaseIds)).toEqual(new Set(frozen36.cases.filter(c => c.inputMode === "text_only").map(c => c.id)))
  })

  it("keeps 13 empty source-review slots (8 gaokao + 5 joint solids) and balances four 9-case groups", () => {
    const plan = loadPlan()
    expect(plan.replacementSlots).toHaveLength(13)
    expect(plan.replacementSlots.every(slot => slot.status === "pending_source_review" && slot.category === "solid")).toBe(true)
    expect(plan.replacementSlots.every(slot => Object.keys(slot).sort().join(",") === "category,examType,id,status")).toBe(true)
    const allIds = [...plan.retainedCaseIds, ...plan.replacementSlots.map(slot => slot.id)]
    expect(allIds).toHaveLength(36)
    expect(new Set(allIds).size).toBe(36)
    expect(plan.replacementSlots.filter(slot => slot.examType === "gaokao").map(slot => slot.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `GK-S${i + 10}`)
    )
    expect(plan.replacementSlots.filter(slot => slot.examType === "joint").map(slot => slot.id)).toEqual(
      Array.from({ length: 5 }, (_, i) => `JT-S${i + 10}`)
    )
    const counts = new Map<string, number>()
    for (const id of plan.retainedCaseIds) {
      const old = frozen36.cases.find(c => c.id === id)
      expect(old?.inputMode).toBe("text_only")
      const key = `${old?.examType}/${old?.category}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const slot of plan.replacementSlots) {
      const key = `${slot.examType}/${slot.category}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(Object.fromEntries(counts)).toEqual({ "gaokao/solid": 9, "joint/solid": 9, "gaokao/plane": 9, "joint/plane": 9 })
  })
})

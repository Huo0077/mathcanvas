import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ORIGINAL_CASES, REVISED_CASES } from "../../packages/agent-core/src/fixtures/solidGeometryFourCases"

const root = process.cwd()
const manifestPath = path.join(root, "test-fixtures/drawing-regression-20261109/cases.json")
const sha256 = (text: string) => new TextDecoder().decode(execFileSync("node", ["-e", "const c=require('node:crypto'); process.stdout.write(c.createHash('sha256').update(process.argv[1]).digest('hex'))", text]))
type Case = { id: string; source: { file: string; entry: string; sha256: string }; prompt: string;
  expectedDisposition: "verified_drawing" | "clarification" | "unsupported" | "reject_candidate";
  requiredConditions: string[]; forbiddenBehaviors: string[]; oracle: { file: string; entry: string } }
type Missing = { id: string; reason: string; evidence: string }
const expectedIds = ["joint-06", "joint-11", "joint-13", "joint-14", "joint-17", "joint-25",
  ...ORIGINAL_CASES.map(item => item.id), ...REVISED_CASES.map(item => item.id), "E19", "E23"]
const sourceFixture = "packages/agent-core/src/fixtures/solidGeometryFourCases.ts"
const answerFixture = "test-fixtures/agent-answer-validation-20261102.json"

function load(): { version: string; cases: Case[]; missingSources: Missing[] } {
  return JSON.parse(readFileSync(manifestPath, "utf8"))
}

describe("frozen drawing regression manifest", () => {
  it("classifies each historical issue exactly once, without inventing unavailable prompts", () => {
    const manifest = load()
    expect(manifest.version).toBe("2026-11-09-v1")
    expect(sha256(readFileSync(manifestPath, "utf8"))).toBe("9e9a58b6ff2a5fa0fec03097190331a3f3d0ddca6d0db7e3257e5476efa34a1f")
    const ids = [...manifest.cases.map(item => item.id), ...manifest.missingSources.map(item => item.id)]
    expect(ids.sort()).toEqual([...expectedIds].sort())
    expect(new Set(ids).size).toBe(ids.length)
    for (const missing of manifest.missingSources) {
      expect(missing.reason.length).toBeGreaterThan(10)
      expect(missing.evidence.length).toBeGreaterThan(10)
    }
  })

  it("uses independent numerical anchors to refute false goals and reconstruct the fold angle", () => {
    const cases = new Map([...ORIGINAL_CASES, ...REVISED_CASES].map(item => [item.id, item]))
    expect(cases.get("case-1-right-trapezoid-pyramid")?.reference.goals[0]?.holds).toBe(false)
    expect(cases.get("case-2-regular-triangular-prism")?.reference.goals[0]?.holds).toBe(false)
    expect(cases.get("case-4-folded-trapezoid-revised")?.reference.goals[0]?.holds).toBe(false)
    // Rectangle A=(0,0), B=(4,0), C=(4,2); foot E=(16/5,8/5).
    expect((4 - 16 / 5) * 4 + (0 - 8 / 5) * 2).toBeCloseTo(0, 12)
    // Folded diagonal: BD²=(68+32 cosθ)/5=9.
    const cosine = (5 * 3 ** 2 - 68) / 32
    expect(cosine).toBe(-23 / 32)
    const e23 = (JSON.parse(readFileSync(path.join(root, answerFixture), "utf8")) as { id: string; values: number[] }[])
      .find(item => item.id === "E23")
    expect(Math.acos(cosine) * 180 / Math.PI).toBeCloseTo(e23?.values[0] ?? NaN, 9)
  })
  it("locks exact fixture text and source hash, and requires explicit conditions and forbidden behaviors", () => {
    const manifest = load()
    const sources = new Map([...ORIGINAL_CASES, ...REVISED_CASES].map(item => [item.id, item.prompt]))
    const answers = JSON.parse(readFileSync(path.join(root, answerFixture), "utf8")) as { id: string; prompt: string }[]
    for (const item of answers) if (["E19", "E23"].includes(item.id)) sources.set(item.id, item.prompt)
    for (const item of manifest.cases) {
      expect(item.prompt, item.id).toBe(sources.get(item.id))
      expect(item.source.file, item.id).toBe(["E19", "E23"].includes(item.id) ? answerFixture : sourceFixture)
      expect(item.source.entry, item.id).toBe(item.id)
      expect(item.source.sha256, item.id).toBe(sha256(item.prompt))
      expect(item.requiredConditions.length, item.id).toBeGreaterThan(0)
      expect(item.forbiddenBehaviors.length, item.id).toBeGreaterThan(0)
      for (const condition of item.requiredConditions) expect(item.prompt, item.id).toContain(condition)
      expect(["verified_drawing", "clarification", "unsupported", "reject_candidate"]).toContain(item.expectedDisposition)
      expect(item.oracle.file.length).toBeGreaterThan(0)
      expect(item.oracle.entry.length).toBeGreaterThan(0)
    }
  })
})
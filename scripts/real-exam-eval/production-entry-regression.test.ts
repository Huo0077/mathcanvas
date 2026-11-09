import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, it } from "vitest"
import { understandProblem } from "../../packages/agent-core/src/problemUnderstanding"
import { selectProblemPlanner } from "../../apps/web/src/agent/problemSolveService"

interface ExamCase { id: string; question: string; sheet?: string }
const archivedCases = JSON.parse(readFileSync(path.resolve(process.cwd(), "test-fixtures/real-exams-20261105/cases.json"), "utf8")) as ExamCase[]
const cases = archivedCases.filter(question => !question.sheet)

it("the 20 text-only exam prompts have one source-bound option goal without answer-key input", async () => {
  expect(archivedCases).toHaveLength(50)
  expect(cases).toHaveLength(20)
  expect(new Set(cases.map(question => question.id)).size).toBe(20)
  const unmatched: string[] = []
  const misrouted: string[] = []
  for (const question of cases) {
    const result = understandProblem({ prompt: question.question, problemRevision: "fixture-revision" })
    if (result.goals.length !== 1 || result.goals[0]?.expectedKind !== "single_choice") unmatched.push(question.id)
    const selected = await selectProblemPlanner({ prompt: question.question, imageNotes: "",
      requiredGoals: result.goals.map(goal => ({ goalId: goal.goalId, kind: goal.expectedKind, sourceText: "" })),
      modelPlanner: { resolveProvider: async () => ({ ok: true, provider: { id: "offline", modelId: "scripted", dialect: "openai_native", revision: 1,
        capabilities: { json: "unknown", tools: "unknown", vision: "unknown" } } }) } })
    if (selected.requestedSkillIds.length !== 0 || selected.textProfileId !== "offline") misrouted.push(question.id)
    for (const goal of result.goals) {
      const source = result.ir.obligations.find(obligation => obligation.id === goal.goalId)
      expect(question.question.slice(goal.source.start, goal.source.end)).toBe(source?.sourceText)
    }
  }
  expect(unmatched).toEqual([])
  expect(misrouted).toEqual([])
})

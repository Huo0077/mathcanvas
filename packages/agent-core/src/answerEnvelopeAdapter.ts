import type { GoalAnswer } from "./answerResult"
import type { SolveContext } from "./solveContext"

/** Legacy free text is not a multi-goal proof. Adapt only uniquely attributed subanswers. */
export function adaptLegacyAnswer(context: SolveContext, text: string): GoalAnswer[] {
  const goals = context.understanding.goals
  if (goals.length === 0 || !text.trim()) return []
  const explicitParts = [...text.matchAll(/[（(](\d+)[）)]\s*([^（(\n]+)/g)]
  if (goals.length > 1 && explicitParts.length === 0) return []
  const candidates: GoalAnswer[] = []
  for (const [index, goal] of goals.entries()) {
    const segment = goals.length > 1
      ? explicitParts.find(part => Number(part[1]) === index + 1)?.[2]?.trim()
      : text.trim()
    if (!segment) continue
    if (goal.expectedKind === "numeric") {
      const number = /(?:=|＝)\s*([-+]?\d+(?:\.\d+)?)\s*(?=$|[。；;，,\s])/u.exec(segment)?.[1]
      if (number) candidates.push({ goalId: goal.goalId, kind: "numeric", displayText: segment, value: { kind: "numeric", expression: number }, evidenceRefs: [] })
    } else if (goal.expectedKind === "conversation") {
      candidates.push({ goalId: goal.goalId, kind: "conversation", displayText: segment, value: { kind: "conversation", text: segment }, evidenceRefs: [] })
    }
  }
  return candidates
}

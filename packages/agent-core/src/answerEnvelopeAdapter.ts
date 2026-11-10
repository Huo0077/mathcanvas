import { readExplicitFinalChoices } from "./answerAcceptance"
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
    } else if (goal.expectedKind === "single_choice") {
      // The model must state one final option; option letters in its reasoning are not answers.
      const finals = readExplicitFinalChoices(segment)
      const otherClaims = [...segment.matchAll(/(?:答案为|选择|(?<!最)选)\s*[:：]?\s*([A-D])(?=$|[\s。！!，,、）)*])/gu)]
      if (finals.length === 1 && finals[0] !== null && otherClaims.every(claim => claim[1] === finals[0])) {
        candidates.push({ goalId: goal.goalId, kind: "single_choice", displayText: segment,
          value: { kind: "single_choice", optionId: finals[0]! }, evidenceRefs: [] })
      }
    } else if (goal.expectedKind === "conversation") {
      candidates.push({ goalId: goal.goalId, kind: "conversation", displayText: segment, value: { kind: "conversation", text: segment }, evidenceRefs: [] })
    }
  }
  return candidates
}

/** For trusted in-process deterministic solvers only; this never mints verification evidence. */
export function adaptTrustedDeterministicAnswer(context: SolveContext, text: string): GoalAnswer[] {
  if (!text.trim()) return []
  const goals = context.understanding.goals.filter(goal => goal.expectedKind !== "drawing")
  const numbered = [...text.matchAll(/[（(](\d+)[）)]\s*/gu)]
  if (goals.length > 1 && numbered.length === 0) return []
  const result: GoalAnswer[] = []
  for (const [index, goal] of goals.entries()) {
    const start = goals.length > 1 ? numbered.find(item => Number(item[1]) === index + 1) : null
    if (goals.length > 1 && !start) continue
    const from = start ? start.index + start[0].length : 0
    const until = start ? numbered.find(item => item.index > start.index)?.index ?? text.length : text.length
    const segment = text.slice(from, until).trim()
    if (!segment) continue
    const kind = goal.expectedKind
    const attributed = (value: GoalAnswer["value"]): GoalAnswer => ({ goalId: goal.goalId, kind,
      displayText: segment, ...(value ? { value } : {}), evidenceRefs: [] })
    if (kind === "proof") {
      if (!/实例证据|不等于形式化证明|坐标核验|尚未核验/u.test(segment)) result.push(attributed({ kind: "proof", conclusion: segment }))
    } else if (kind === "numeric") {
      const goalText = context.prompt.slice(goal.source.start, goal.source.end)
      const name = /([A-Z](?:[′']|₁)?[A-Z](?:[′']|₁)?)/u.exec(goalText)?.[1]
      const values = name ? [...segment.matchAll(new RegExp(name + "\\s*(?:=|≈)\\s*([+-]?(?:\\d+(?:\\.\\d+)?\\s*\\u221a\\d+|\\u221a\\d+|\\d+(?:\\.\\d+)?)(?:\\/\\d+)?)", "gu"))] : []
      const quoted = [...segment.matchAll(/「([^」]+)」\s*(?:=|≈)\s*([+-]?(?:\d+(?:\.\d+)?\s*√\d+|√\d+|\d+(?:\.\d+)?)(?:\/\d+)?)(?:°)?/gu)]
      const requestedNames = [...new Set(goalText.match(/[A-Z](?:[′']|₁|₂|₃)?/gu) ?? [])]
      const labeled = quoted.find(item => requestedNames.every(point => item[1]!.includes(point)))?.[2]
      const statedDihedral = /二面角\s*([A-Z](?:[′']|₁)?-[A-Z]{2}-[A-Z](?:[′']|₁)?)/u.exec(goalText)?.[1]
      const dihedralValue = statedDihedral && segment.includes("「二面角" + statedDihedral + "」")
        ? /「二面角[^」]+」\s*(?:=|≈)\s*([+-]?\d+(?:\.\d+)?°)/u.exec(segment)?.[1]
        : undefined
      const expression = (dihedralValue ?? values.at(-1)?.[1] ?? labeled)?.replace(/\s+/g, "")
      if (expression) result.push(attributed({ kind: "numeric", expression }))
    } else if (kind === "interval" || kind === "unknown") {
      const interval = /(?:单调)?递增区间为\s*(\[[^\]\n]+\])/u.exec(segment)?.[1]
      if (interval) result.push({ goalId: goal.goalId, kind: "interval", displayText: segment,
        value: { kind: "interval", expression: interval }, evidenceRefs: [] })
    } else if (kind === "conversation" && !context.unrecognizedMathGoal) {
      result.push(attributed({ kind: "conversation", text: segment }))
    }
  }
  return result
}

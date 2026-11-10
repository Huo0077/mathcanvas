import { expect, it } from "vitest"
import { createSolveContext } from "./solveContext"
import { adaptLegacyAnswer } from "./answerEnvelopeAdapter"

const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
const source = { runId: "r", conversationId: "c", attachments: [], corrections: [], sceneRevision: "scene" }
it("accepts only the numbered subanswer actually present in a two-goal question", async () => {
  const context = await createSolveContext({ ...source, prompt: "矩形 ABCD 中 AB=4，BC=2。沿 AC 将三角形 ABC 折起 90°，求折前BC与折后B'C的长度。" }, hash)
  const answer = adaptLegacyAnswer(context, "（1）BC=2")
  expect(answer).toHaveLength(1)
  expect(answer[0]?.goalId).toBe(context.understanding.goals[0]?.goalId)
  expect(answer[0]?.value).toEqual({ kind: "numeric", expression: "2" })
  expect(adaptLegacyAnswer(context, "BC=2")).toEqual([])
  expect(adaptLegacyAnswer(context, "（1）BC=2√5")).toEqual([])
})
it("never invents a choice or drawing value from a conversational assertion", async () => {
  const context = await createSolveContext({ ...source, prompt: "求图形面积。" }, hash)
  expect(adaptLegacyAnswer(context, "应当大约是某个选项")).toEqual([])
})

it("adapts one explicit final option but never infers a choice from derivation or ambiguous prose", async () => {
  const context = await createSolveContext({ ...source, prompt: "设复数 z=x+yi 满足 |z-i|=1，则\nA. x²+y²=1\nB. (x-1)²+y²=1\nC. x²+(y-1)²=1\nD. (x+1)²+y²=1" }, hash)
  expect(context.understanding.goals.map(goal => goal.expectedKind)).toEqual(["single_choice"])
  const answer = adaptLegacyAnswer(context, "由轨迹公式可得圆心(0,1)。最终答案：C。")
  expect(answer).toHaveLength(1)
  expect(answer[0]).toMatchObject({ goalId: context.understanding.goals[0]?.goalId, kind: "single_choice",
    value: { kind: "single_choice", optionId: "C" } })
  expect(adaptLegacyAnswer(context, "\u6700\u7ec8\u7b54\u6848\uff1aB\uff0842\uff09")[0]?.value).toEqual({ kind: "single_choice", optionId: "B" })
  for (const text of ["C 的方程是正确的", "最终答案：A，最终答案：C", "最终答案：E", "最终答案：C，但证明选择 D"]) {
    expect(adaptLegacyAnswer(context, text), text).toEqual([])
  }
})

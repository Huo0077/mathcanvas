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

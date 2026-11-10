import { expect, it } from "vitest"
import { createSolveContext } from "./solveContext"
import { routeDeterministicProblem } from "./deterministicProblemRoute"
import { CASE_1, CASE_4_ORIGINAL, CASE_4_REVISED } from "./fixtures/solidGeometryFourCases"
import { tryBuildPolygonFoldPlan } from "./polygonFoldPlan"
import { deterministicPlanForPrompt } from "./parametricSolidPlan"
import { adaptLegacyAnswer, adaptTrustedDeterministicAnswer } from "./answerEnvelopeAdapter"

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

it("attributes explicit numbered proof and radical result without claiming verification", async () => {
  const context = await createSolveContext({ ...source, prompt: "在四棱锥 P-ABCD 中，（1）证明 AD∥平面PBC；（2）求 AD 的长度。" }, hash)
  const answers = adaptTrustedDeterministicAnswer(context, "（1）由条件得 AD ∥ 平面 PBC。\n\n（2）根据条件可得 AD = √3。")
  expect(answers.map(answer => answer.kind), JSON.stringify(context.understanding.goals.map(g => ({kind:g.expectedKind, text:context.prompt.slice(g.source.start,g.source.end)})))).toEqual(["proof", "numeric"])
  expect(answers[1]?.value).toEqual({ kind: "numeric", expression: "√3" })
  expect(answers.every(answer => answer.evidenceRefs.length === 0)).toBe(true)
  expect(adaptTrustedDeterministicAnswer(context, "（1）由条件得 AD ∥ 平面 PBC。")).toHaveLength(1)
})

it("adapts only an explicit monotonic interval for a trusted local result", async () => {
  const context = await createSolveContext({ ...source, prompt: "已知函数 f(x)=sin x。求 f(x) 的单调递增区间。" }, hash)
  const answers = adaptTrustedDeterministicAnswer(context, "单调递增区间为 [-π/8+kπ, 3π/8+kπ]，k∈ℤ。")
  expect(answers).toHaveLength(1)
  expect(answers[0]?.displayText).toContain("单调递增区间")
  expect(adaptTrustedDeterministicAnswer(context, "随便某个区间")).toEqual([])
})

it("attributes the scoped-pyramid local solver's two subanswers without inventing either", async () => {
  const prompt = "如图，四棱锥 P-ABCD 中，PA⊥底面 ABCD，PA=AC=2，BC=1，AB=√3。（1）若AD⊥PB，证明：AD∥平面PBC；（2）若AD⊥DC，且二面角A-CP-D的正弦值为√42/7，求AD。"
  const context = await createSolveContext({ ...source, prompt }, hash)
  const route = routeDeterministicProblem(prompt)
  if (route?.plan.kind !== "plan") throw Error("scoped pyramid missing")
  const answers = adaptTrustedDeterministicAnswer(context, route.plan.answer ?? "")
  expect(answers.map(answer => answer.kind), JSON.stringify({ goals: context.understanding.goals.map(g => ({ kind: g.expectedKind, source: prompt.slice(g.source.start, g.source.end) })), answer: route.plan.answer })).toEqual(["proof", "numeric"])
  expect(answers[1]?.value).toEqual({ kind: "numeric", expression: "√3" })
})

it("attributes a trusted Case 1 local answer to all explicit goals without drawing bypass", async () => {
  const context = await createSolveContext({ ...source, prompt: CASE_1.prompt + "请画题设示意图。" }, hash)
  const plan = deterministicPlanForPrompt(context.prompt)
  if (plan?.kind !== "plan") throw Error("no local solid plan")
  const answers = adaptTrustedDeterministicAnswer(context, plan.answer ?? "")
  expect(answers.map(answer => answer.kind), JSON.stringify({ goals: context.understanding.goals.map(g => ({ kind: g.expectedKind, source: context.prompt.slice(g.source.start, g.source.end) })), answer: plan.answer })).toEqual(context.understanding.goals.filter(g => g.expectedKind !== "drawing").map(g => g.expectedKind))
})

it("never upgrades a measured proof instance to a completed proof goal", async () => {
  const context = await createSolveContext({ ...source, prompt: "在四棱锥P-ABCD中，画示意图，求证PA⊥BD。" }, hash)
  expect(adaptTrustedDeterministicAnswer(context, "（1）「PA⊥BD」坐标核验成立，残差0，这是实例证据，不等于形式化证明。")).toEqual([])
})

it.each([CASE_4_ORIGINAL, CASE_4_REVISED])("keeps a false fold proof separate from a measured dihedral for $id", async (fixture) => {
  const context = await createSolveContext({ ...source, prompt: fixture.prompt + "请画题设示意图。" }, hash)
  const built = tryBuildPolygonFoldPlan({ prompt: context.prompt })
  if (built.status !== "ok" || built.plan.kind !== "plan") throw Error("fold plan unavailable")
  const answers = adaptTrustedDeterministicAnswer(context, built.plan.answer ?? "")
  expect(answers.map(item => item.kind), JSON.stringify({ goals: context.understanding.goals.map(g => ({ kind: g.expectedKind, text: context.prompt.slice(g.source.start, g.source.end) })), answer: built.plan.answer })).toEqual(context.understanding.goals.filter(g => g.expectedKind !== "drawing").map(g => g.expectedKind))
  expect(answers[1]?.value).toEqual({ kind: "numeric", expression: expect.stringMatching(/^54\.7356.*°$/u) })
})

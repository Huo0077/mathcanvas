import { expect, it } from "vitest"
import { imagePrompt, splitImagePrompt } from "./problemImagePrompt"
import { parseProblemImageReading } from "./problemImageReader"
import { addCoordinateReview, graphChoiceDraft, hasVectorSupplement, isGraphChoiceProblem, missingGraphChoices, requiredVectorReadings, reviewProblemImage } from "./problemImageReview"

it("requires both wind vectors when the recognition only returned graph labels", () => {
  const reading = {
    problem: "测得视风风速对应的向量与船速对应的向量如图2，则真风为（ ）",
    diagram: [{ text: "视风风速", image: 1, box: null }, { text: "船速", image: 1, box: null }],
    uncertainties: []
  }
  expect(requiredVectorReadings(reading)).toBe(2)
  expect(hasVectorSupplement("船速：(2,0) → (3,3)", 2)).toBe(false)
  expect(hasVectorSupplement("船速：(2,0) → (3,3)\n视风：(3,3) → (0,2)", 2)).toBe(true)
  expect(hasVectorSupplement("(2,0) → (3,3)\n(2.0,0) -> (3,3)", 2)).toBe(false)

  const complete = parseProblemImageReading(JSON.stringify({ ...reading, diagram: [
    { ...reading.diagram[0], arrow: { from: [3, 3], to: [0, 2] } },
    { ...reading.diagram[1], arrow: { from: [2, 0], to: [3, 3] } }
  ] }), 1)!
  expect(requiredVectorReadings(complete)).toBe(0)
  expect(splitImagePrompt(imagePrompt(complete.problem, "", complete)).imageNotes).toContain("起点 (3, 3) → 终点 (0, 2)")
})

it("asks for a symbol check when a sample space looks like an indexed union of a singleton", () => {
  const problem = String.raw`记样本空间 $\Omega=\bigcup_{i}\{P\}$，求期望。`
  const reading = { problem, diagram: [], uncertainties: [] }
  const checked = reviewProblemImage(reading, 1)
  expect(checked.problem).toBe(problem)
  expect(checked.uncertainties).toEqual([{ text: expect.stringContaining("补集"), image: 1, box: null, impact: "condition" }])

  const box = [0.1, 0.2, 0.3, 0.4] as [number, number, number, number]
  const withLocation = reviewProblemImage({ ...reading, uncertainties: [{ text: "样本空间符号模糊", image: 1, box, impact: "appearance" }] }, 1)
  expect(withLocation.uncertainties).toEqual([{ ...checked.uncertainties[0], box, text: expect.stringContaining("样本空间符号模糊") }])
  expect(reviewProblemImage({ ...reading, problem: String.raw`记样本空间 $\Omega=U\setminus\{P\}$。` }, 1).uncertainties).toEqual([])
})

it("only hands off confirmed geometric lines while retaining point names and numeric readings", () => {
  const problem = "求平行六面体的二面角。"
  const diagram = ["C₁", "C₁D（虚线）", "BD", "高度 2"].map(text => ({ text, image: 1, box: null }))
  const reading = { problem, diagram, uncertainties: [{ text: "C₁D 似乎是虚线，需核对", image: 1, box: null, impact: "appearance" as const }] }
  const auto = splitImagePrompt(imagePrompt(problem, "", reading))
  expect(auto.imageEvidence?.diagram.map(item => item.text)).toEqual(["C₁", "高度 2"])
  const verified = splitImagePrompt(imagePrompt(problem, "", reading, [], [2]))
  expect(verified.imageEvidence?.diagram.map(item => item.text)).toEqual(["C₁", "BD", "高度 2"])
  expect(verified.imageNotes).not.toContain("C₁D")
})

it("asks for a source check on coordinates even when the model was confident", () => {
  const reading = addCoordinateReview({
    problem: String.raw`焦点为 $F_1(-1,0)$、$F_2(1,0)$。已知 $M_0\left(0,4\right)$，证明垂直平分线与椭圆相切。`,
    diagram: [],
    uncertainties: []
  }, 2)
  expect(reading.uncertainties).toEqual([{ text: expect.stringContaining("M_0(0,4)"), image: null, box: null, impact: "condition" }])
  const sent = splitImagePrompt(imagePrompt(reading.problem, "", reading, [0]))
  expect(sent.imageEvidence?.reviewed).toEqual([0])
  expect(sent.imageNotes).toContain("用户已核对疑点 原图")
})

it("requires a curve description for every graph option, even when missing detail was marked as appearance", () => {
  const reading = {
    problem: "7. 函数 y=f(x) 在区间 [-2.8,2.8] 的图象大致为",
    diagram: ["A：仅有坐标轴", "B：关于 y 轴对称且有两个峰", "C：需核对是否有零点", "D：坐标原点 O"].map(text => ({ text, image: 1, box: null })),
    uncertainties: [{ text: "图象具体形状需核对", image: 1, box: null, impact: "appearance" as const }]
  }
  expect(isGraphChoiceProblem(reading.problem)).toBe(true)
  expect(isGraphChoiceProblem("函数 y=f(x) 的图像是（ ）")).toBe(true)
  expect(isGraphChoiceProblem("画出函数的图像。")).toBe(false)
  const draft = graphChoiceDraft(reading)
  expect(draft).toBe("B：关于 y 轴对称且有两个峰")
  expect(missingGraphChoices(draft)).toEqual(["A", "C", "D"])
  expect(missingGraphChoices(draft + "\nA：先增后减，有一峰")).toEqual(["C", "D"])
  const confirmed = draft + "\nA：有一峰\nC：向右下降\nD：有两个谷"
  expect(missingGraphChoices(confirmed)).toEqual([])
  const sent = splitImagePrompt(imagePrompt(reading.problem, confirmed, reading))
  expect(sent.prompt).toContain("D：有两个谷")
  expect(sent.imageEvidence?.diagram).toEqual([])
})

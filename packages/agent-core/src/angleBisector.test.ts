import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { parseObligationIR } from "./obligationIR"
import { compilePlan } from "./planCompiler"

/**
 * **角平分线有判据了**（2026-10-20，上一批探针里"没有判据的家族"里最常见的一族）。
 *
 * 上一批把这 13 个家族都变成了"如实未核验"，但**未核验只是诚实，不是能力**。这一批挑
 * 出现频率最高的**角平分线**补真判据：
 *
 * `AD 平分 ∠BAC` ⇔ **两个角相等**（`∠BAD = ∠DAC`）**且 `D` 在角的内部**
 * （`∠BAD + ∠DAC = ∠BAC`）。
 *
 * **为什么必须两条一起判**：只判"两个角相等"的话，`D` 落在**平分线的反方向**上时
 * （`A` 的对面那一侧）两个角同样相等 —— 可那条射线根本不在角里。实测反例：`A(0,0)`、
 * `B(4,0)`、`C(0,4)`、`D(-2,-2)`，`∠BAD = ∠DAC = 135°`，而 `∠BAC = 90°`。
 *
 * **判据从最终坐标自己算**（与 `planarAngle` / `area` 同一条纪律），不读构造过程留下的量。
 */
const bisectors = (prompt: string) =>
  parseDiagramObligations(prompt).givens.filter((item) => item.kind === "angleBisector").map((item) => item.targets)

describe("角平分线的三种常见写法", () => {
  it("`AD是∠BAC的平分线` ⇒ targets [D, A, B, C]（点在先、顶点其次、两边端点在后）", () => {
    expect(bisectors("在△ABC中，AD是∠BAC的平分线。")).toEqual([["D", "A", "B", "C"]])
  })

  it("`AD平分∠BAC` 同一条", () => {
    expect(bisectors("在△ABC中，AD平分∠BAC。")).toEqual([["D", "A", "B", "C"]])
  })

  it("`∠BAC的平分线交BC于点D` 同一条（点写在后面）", () => {
    expect(bisectors("在△ABC中，∠BAC的平分线交BC于点D。")).toEqual([["D", "A", "B", "C"]])
  })

  it("`AD是角平分线`（没说哪个角）⇒ 不猜，仍落未核验", () => {
    const parsed = parseDiagramObligations("在△ABC中，AD是角平分线。")
    expect(parsed.givens.filter((item) => item.kind === "angleBisector")).toEqual([])
    expect(parsed.unverified.map((entry) => entry.sourceText).join("｜")).toContain("平分线")
  })

  /**
   * **IR 那一层也要带上"这是角度量"**（判据容差的第二处来源）。
   * `angleBisector` 的残余是"两个角之差"，尺子与平面角同一把；少了这一行它会掉进默认分支，
   * 于是核验器给角度容差、IR 给"没容差"，同一件事两种说法。
   */
  it("IR 里这一条带的是角度容差（不是默认的 undefined）", () => {
    const ir = parseObligationIR("在△ABC中，AD平分∠BAC。")
    const obligation = ir.obligations.find((entry) => entry.kind === "angleBisector")
    expect(obligation?.tolerance?.kind).toBe("angular")
  })
})

/**
 * **接缝层**：`A(0,0)`、`B(4,0)`、`C(0,4)` ⇒ `∠BAC = 90°`，内角平分线是 `y = x`。
 */
describe("角平分线量得出来", () => {
  const PROMPT = "在平面内，AD是∠BAC的平分线。"
  const point = (name: string, x: number, y: number) =>
    ({ actionId: "planar.create_point", actionKey: name, factIds: [], inputs: { alias: name, points: [{ x, y }], label: name } })

  const run = (d: { x: number; y: number }) => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "角的平分线",
      factIds: [],
      actions: [point("A", 0, 0), point("B", 4, 0), point("C", 0, 4), point("D", d.x, d.y)]
    } as unknown as PlanEnvelope
    return compilePlan(plan, { document: createEmptyDocument("conics"), prompt: PROMPT, conversationId: "angle-bisector", documentGeneration: 0 })
  }

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("D(2,2) 在内角平分线上 ⇒ passed", () => {
    const result = run({ x: 2, y: 2 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["angleBisector"])
  })

  it("D(3,1) 不在平分线上 ⇒ failed，理由里给两个角", () => {
    const result = run({ x: 3, y: 1 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
    const reason = result.diagramVerification?.checks[0]?.reason ?? ""
    expect(reason).toContain("∠")
  })

  /** 反方向那一侧：两个角**同样相等**，但那条射线不在角里 ⇒ 必须 failed。 */
  it("D(-2,-2) 在平分线的反方向上 ⇒ failed（两个角相等也要判不满足）", () => {
    const result = run({ x: -2, y: -2 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
  })

  it("D(2,0) 落在角的一边上（退化）⇒ failed，不是「算不出」", () => {
    const result = run({ x: 2, y: 0 })
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
  })
})

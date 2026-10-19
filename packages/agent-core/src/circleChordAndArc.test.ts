import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **弦心距与弧长**（2026-10-20，上一批"没有判据的家族"里同一族的两个度量）。
 *
 * 这两条在卷面上总是跟着**一个具体的圆**出现：`AB 是 ⊙O 的弦，弦心距为 2`、
 * `弧 AB 的长为 π`。所以判据的问法也必须一样：**问图上那个圆自己**——
 * 圆心与半径都在圆图元里（`planar.create_circle` 物化成 `circle`，带 `center` 与 `radius`），
 * 于是
 *
 * - **弦心距** = 圆心到弦 `AB` 那条直线的距离；
 * - **弧长** = `r · θ`，`θ` 是 `A`、`B` 两条半径之间的夹角（**取劣弧**）。
 *
 * **两条边界要如实记着**：
 * 1. `A`、`B` 必须是**图上有的点名**（否则落"点名缺失"，不替它找点）；
 * 2. 弧长**只按劣弧**算 —— 题面写「优弧」时今天不读（那是另一条弧，不能默认取劣的）。
 *
 * 与 `conicAxes` 的圆分支同一条纪律：**候选图里恰好一条新画的圆**才谈得上"题面说的是它"。
 */
const obligations = (prompt: string) =>
  parseDiagramObligations(prompt).givens
    .filter((item) => item.kind === "chordCenterDistance" || item.kind === "arcLength")
    .map((item) => `${item.kind}:${item.targets.join("")}=${item.value}`)

describe("弦心距 / 弧长的读取器", () => {
  it("`弦AB的弦心距为2` ⇒ chordCenterDistance [A,B]", () => {
    expect(obligations("弦AB的弦心距为2。")).toEqual(["chordCenterDistance:AB=2"])
  })

  it("`AB是⊙O的弦，弦心距为2` ⇒ 同一条（弦名在前一句）", () => {
    expect(obligations("AB是⊙O的弦，弦心距为2。")).toEqual(["chordCenterDistance:AB=2"])
  })

  it("`弧AB的长为π` / `弧AB的长为2π` ⇒ arcLength", () => {
    expect(obligations("弧AB的长为π。")).toEqual(["arcLength:AB=3.141592653589793"])
    expect(obligations("弧AB的长为2π。")).toEqual(["arcLength:AB=6.283185307179586"])
  })

  it("`弦AB的长为3` 仍是长度，**不是**弧长 / 弦心距（差一个字就是另一件事）", () => {
    expect(obligations("弦AB的长为3。")).toEqual([])
    expect(parseDiagramObligations("弦AB的长为3。").givens.filter((item) => item.kind === "fixedLength").length).toBe(1)
  })

  it("题面写「优弧」时今天不读（不能默认按劣弧算）", () => {
    expect(obligations("优弧AB的长为π。")).toEqual([])
  })
})

/**
 * **接缝层**：圆 `x² + y² = 4`（圆心原点、半径 2），`A(2, 0)`、`B(0, 2)`。
 *
 * - 直线 `AB`：`x + y = 2` ⇒ 圆心到它的距离 `2/√2 = √2`；
 * - 劣弧 `AB` 是四分之一圆 ⇒ `2 · (π/2) = π`。
 */
describe("弦心距 / 弧长量得出来", () => {
  const point = (name: string, x: number, y: number) =>
    ({ actionId: "planar.create_point", actionKey: name, factIds: [], inputs: { alias: name, points: [{ x, y }], label: name } })
  const circle = { actionId: "planar.create_circle", actionKey: "circle", factIds: [], inputs: { alias: "circle", center: { x: 0, y: 0 }, radius: 2, label: "⊙O" } }

  const run = (prompt: string) => {
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "圆与弦",
      factIds: [],
      actions: [circle, point("A", 2, 0), point("B", 0, 2)]
    } as unknown as PlanEnvelope
    return compilePlan(plan, { document: createEmptyDocument("conics"), prompt, conversationId: "circle-arc", documentGeneration: 0 })
  }

  const describeChecks = (result: ReturnType<typeof run>) =>
    (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

  it("弦心距 √2 ⇒ passed", () => {
    const result = run("AB是⊙O的弦，弦心距为√2。")
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["chordCenterDistance"])
  })

  it("弦心距 2（圆心到 AB 只有 √2）⇒ failed", () => {
    const result = run("AB是⊙O的弦，弦心距为2。")
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
  })

  it("弧长 π（四分之一圆）⇒ passed", () => {
    const result = run("弧AB的长为π。")
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["arcLength"])
  })

  it("弧长 2π ⇒ failed", () => {
    const result = run("弧AB的长为2π。")
    expect(result.diagramVerification?.status, describeChecks(result)).toBe("failed")
  })
})

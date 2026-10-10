import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import { compilePlan } from "./planCompiler"

/**
 * **平面面片（`solid.create_face`）必须进入核验**（2026-10-10 用户现场）。
 *
 * 现场：题面是"平面四边形 ABCD + 一个翻折片"（**开放曲面**）。立体工作区原先只能建闭合多面体，
 * 模型只能拿 `solid.create_polyhedron` 去套 ⇒ 信封当场拒（`a polyhedron needs at least four faces`）
 * ⇒ 修复额度又被 3 个只读工具吃掉 ⇒ 用户看到 `budget exhausted: budget_repair`。
 *
 * 这一条钉住"补上入口之后真的有用"：面片物化出来的**顶点与点名**要进核验，
 * 题设逐条判（而不是像以前那样"没有可核验的顶点，关系未被核验"）。
 *
 * 坐标：A=(0,0,0)、B=(8,0,0)、C=(4,4,0)、D=(1,4,0) —— 共面、互异、不共线，且 |AB|=8、|CD|=3。
 */
const VERTICES = [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 1, y: 4, z: 0 }]
const PROMPT = "在平面四边形 ABCD 中，AB=8，CD=3，画示意图"

function planWith(vertices: { x: number; y: number; z: number }[]): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画示意图",
    factIds: [],
    actions: [{ actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertices, vertexNames: ["A", "B", "C", "D"], label: "平面四边形 ABCD" } }]
  } as unknown as PlanEnvelope
}

const compile = (vertices: { x: number; y: number; z: number }[]) =>
  compilePlan(planWith(vertices), { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "face", documentGeneration: 0 })

describe("平面面片的题设核验", () => {
  it("按面片的点名与坐标逐条核验，而不是'没有可核验的顶点'", () => {
    const result = compile(VERTICES)

    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`)).toEqual(["AB=8:passed", "CD=3:passed"])
    // 构图确实落进草稿：4 个点 + 4 条棱 + 1 只面（点由面片物化出来）。
    const primitives = result.draftDocument?.primitives ?? []
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(1)
  })

  it("坐标不满足时**真红**，而不是退回'未核验'", () => {
    const result = compile([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 1, y: 4, z: 0 }])

    const ab = result.diagramVerification?.checks.find((check) => check.sourceText === "AB=8")
    expect(ab?.status).toBe("failed")
  })

  /**
   * **计划里的点名优先于图上的标签**（与 `solid.create_polyhedron` 那条语义 #1 逐字同源）。
   *
   * 为什么要单独钉它：面片的点名有**两条**来源 —— 计划里的 `vertexNames`，以及物化出来的点上的
   * `label`。平时两者一致（动作就是按 `vertexNames` 给点打标签的），所以"有没有按计划认"这件事
   * **看不出来**；而用户在属性栏改过点名、或图上另有一个同名标签时，两条来源就会分叉。
   * 这条用例把分叉摆出来：图上的标签是 X/Y/Z/W，计划里写着 A/B/C/D ⇒ 必须按**计划**认。
   */
  it("**图上的标签被改过时，仍按计划里的点名认**（点名优先于标签）", () => {
    const candidate = createEmptyDocument("geometry3d")
    const labels = ["X", "Y", "Z", "W"]
    candidate.primitives.push(...VERTICES.map((position, index) => ({ id: `p-${index}`, type: "point3" as const, position: { ...position }, label: labels[index] })))
    candidate.primitives.push({ id: "face-1", type: "face3", pointIds: ["p-0", "p-1", "p-2", "p-3"] })

    const report = verifyDiagramObligations(parseDiagramObligations(PROMPT), planWith(VERTICES), candidate)

    expect(report.checks.map((check) => `${check.sourceText}:${check.status}`)).toEqual(["AB=8:passed", "CD=3:passed"])
  })
})

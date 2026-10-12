import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **Task 13 的负例："**折后 `P` 错**"**（计划 RED 原话："必须有'图形很像但缺 B/C/D 或**折后 P 错**'的负例"）。
 *
 * 缺 `B`/`C`/`D` 那两条已经钉住了（见 `planCompiler.faceRatios.test.ts` 与 `planCompiler.foldAngle.test.ts`）。
 * 这一条问的是另一半：**`P` 在图上，但那不是"折"出来的**。
 *
 * 题面说的是"将三角形AEF沿EF**翻折**至三角形PEF" —— 翻折是**刚体运动**，所以
 * `PEF` 必须与 `AEF` 全等（`|PE| = |AE|`、`|PF| = |AF|`），而 `PC = 4√3` 只是**另外**一条条件。
 * 若模型绕开 `solid.fold`、直接用一只面片把 `P` 写在某个满足 `PC = 4√3` 的地方，
 * 那么"题设条件"可能条条成立，而**图是错的**。这一条要的就是：**不许通过**。
 */

const A = { x: 0, y: 0, z: 0 }
const B = { x: 8, y: 0, z: 0 }
const C = { x: 9, y: Math.sqrt(3), z: 0 }
const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }
const E = { x: 3, y: Math.sqrt(3), z: 0 }
const F = { x: 4, y: 0, z: 0 }

const PROMPT = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")

/**
 * `P` 落在以 `C` 为心、半径 `4√3` 的球面上（**这条题设满足**），但这个点**不是**把 `A`
 * 绕 `EF` 转出来的 —— 折后三角形与折前**不全等**。
 */
const WRONG_P = { x: C.x + 4 * Math.sqrt(3), y: C.y, z: C.z }

function handWrittenP(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "四边形 ABCD + 三角形 AEF，P 被手写在某个满足 PC=4√3 的地方",
    factIds: [],
    actions: [
      { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D], label: "四边形 ABCD" } },
      { actionId: "dynamic.create_bound_point", actionKey: "E", factIds: [], inputs: { alias: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5, label: "E" } },
      { actionId: "dynamic.create_bound_point", actionKey: "F", factIds: [], inputs: { alias: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 1 / 2, label: "F" } },
      /** **绕开 `solid.fold`**：直接把"折后"那一只三角形写成一只普通面片。 */
      { actionId: "solid.create_face", actionKey: "flap", factIds: [], inputs: { alias: "flap", vertexNames: ["P", "E", "F"], vertices: [WRONG_P, E, F], label: "三角形 PEF（手写的）" } }
    ]
  } as unknown as PlanEnvelope
}

describe("Task 13 负例 —— 折后 P 错", () => {
  it("P 是手写的（绕开 solid.fold）：即使 PC=4√3 成立，也不许通过", () => {
    const result = compilePlan(handWrittenP(), { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "fold-negatives", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`) ?? []

    /**
     * **理想是"不许通过"**：题面说的是"翻折"，而这只 `P` 不是折出来的（`PEF` 与 `AEF` 不全等）。
     *
     * 判据落在**编译结论**上：这一轮的实现把"折不折得起来"做成 `geometry_validation` 的
     * **错误诊断**（`fold_not_rigid`），所以 `ok` 会是 `false`。
     * 注意**核验报告本身仍是 `passed`** —— 那八条题设（含 `PC=4√3`）确实条条成立，
     * 挡下这一轮的是"这不是折出来的"这条**独立的判据**。两者要分开看，别把"核验通过"
     * 当成"图对了"。
     */
    const foldDiagnostics = result.diagnostics.filter((entry) => entry.code === "fold_not_rigid")
    expect(result.ok, `ok 应当为 false；核验逐条：${checks.join("；")}`).toBe(false)
    expect(foldDiagnostics.length, `诊断：${JSON.stringify(result.diagnostics.map((entry) => entry.code))}`).toBeGreaterThan(0)
    /**
     * 诊断里要**带上量出来的数**（"差多少"才是可复核的证据，不是一个结论词）。
     * 编译失败时 `draftDocument` 是 `null`（那属于"动作报错"那条路），所以读数只能从诊断里取 ——
     * 这也正是这条判据写在**诊断**而不是写在核验报告里的原因：核验报告是"题设条件"的账，
     * 而"这不是折出来的"是**另一件事**（八条确实条条成立，实测 `PC=4√3: passed`）。
     */
    expect(foldDiagnostics[0]!.detail).toContain("刚体")
    expect(foldDiagnostics[0]!.detail).toContain("不是折出来的")
  })
})

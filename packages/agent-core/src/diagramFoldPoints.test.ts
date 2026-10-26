import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"

/**
 * **折出来的那只面也必须进点名表**（2026-10-11 用户现场，紧接着翻折批次）。
 *
 * 现场：桌面端跑到 `validating` 才停，八条题设**全部**报
 * 「候选图缺少唯一、可靠的顶点名映射；不能按题面顺序猜坐标」—— 而题面八个从句明明都读懂了
 * （不读懂就不会逐条列出来核验）。
 *
 * **根因**：`candidatePoints` 只把 `solid.create_polyhedron` 与 `solid.create_face` 算作
 * "产出面的动作"（见那个函数里两支的注释），**不认 `solid.fold`** —— 而折会产出**一只新的 `face3`**。
 * 于是"计划里 1 笔建面 + 1 笔折"对应"候选图里 **2** 只新面"，数量对不上 ⇒ 该函数直接返回 `null`
 * ⇒ 所有依赖点名的题设一律落成"映射不可靠"。用户看到的是一句与真实原因无关的话。
 *
 * 判据与 `create_face` 那一支**同一条口径**：数量必须对得上、`vertexNames` 按 `pointIds` 下标对齐。
 * 折多出来的一层是**顶点被改名**（`apex` → `apexAs`），所以名字要按编译器**同一份**规则换算 ——
 * 在这里另写一遍换算就是"同一件事两个口径"。
 */
describe("折出来的面进点名表（2026-10-11）", () => {
  const A = { x: 0, y: 0, z: 0 }
  const E = { x: 1, y: 0, z: 0 }
  const F = { x: 0, y: 1, z: 0 }
  /**
   * 折 90° 之后 `A` 落在哪里 —— 与内核同一套 Rodrigues（`unfold3d.rotateAboutAxis`）。
   * 手算：轴 `E→F` 方向 `(-1,1,0)/√2`、原点 `E`；`A-E = (-1,0,0)` 分解后转 90° ⇒ `P = (0.5, 0.5, 1/√2)`。
   * **`|PE| = |AE| = 1` 是刚体性**，本用例正是拿它当判据。
   */
  const P = { x: 0.5, y: 0.5, z: Math.SQRT1_2 }

  const FLAT = [{ x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }]

  function fixture(): { plan: PlanEnvelope; candidate: ReturnType<typeof createEmptyDocument> } {
    const plan: PlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "平面片 + 折起来的那一片",
      factIds: [],
      actions: [
        { actionId: "solid.create_face", actionKey: "flat", factIds: [], inputs: { alias: "flat", vertexNames: ["B", "C", "D"], vertices: FLAT } },
        /**
         * 真实用户那一笔的形状：`vertexNames` 给的是**折前**的名字 `A`，
         * `apexAs` 说它折后叫 `P` —— 所以进点名表的名字是 `["P","E","F"]`。
         */
        { actionId: "solid.fold", actionKey: "flap", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], vertices: [A, E, F], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 90 } }
      ]
    } as unknown as PlanEnvelope

    const candidate = createEmptyDocument("geometry3d")
    // 建面那一笔物化出来的三个点 + 一只面。
    FLAT.forEach((position, index) => candidate.primitives.push({ id: `face-flat:v${index}`, type: "point3" as const, position, label: ["B", "C", "D"][index]! }))
    candidate.primitives.push({ id: "face-flat", type: "face3", pointIds: FLAT.map((_, index) => `face-flat:v${index}`), edgeIds: [], label: "平面片" })
    // 折那一笔物化出来的三个点（**折后**坐标、**折后**名字）+ 一只面。
    const folded = [P, E, F]
    folded.forEach((position, index) => candidate.primitives.push({ id: `face-flap:v${index}`, type: "point3" as const, position, label: ["P", "E", "F"][index]! }))
    candidate.primitives.push({ id: "face-flap", type: "face3", pointIds: folded.map((_, index) => `face-flap:v${index}`), edgeIds: [], label: "折起来的那一片" })
    return { plan, candidate }
  }

  it("**折出来的面里那些点进得了点名表**：`PE=1` 能被核验，而不是报「映射不可靠」", () => {
    const { plan, candidate } = fixture()
    const report = verifyDiagramObligations(parseDiagramObligations("PE=1"), plan, candidate)

    const check = report.checks.find((entry) => entry.sourceText.includes("PE=1"))
    expect(check).toBeDefined()
    // 修好之前：这里拿到的是"候选图缺少唯一、可靠的顶点名映射"（两支计数对不上 ⇒ `null`）。
    expect(check?.reason ?? "").not.toContain("顶点名映射")
    expect(check?.status).toBe("passed")
  })

  it("**折前的条件按折前坐标核**（`AE=1` / `AB=2` 通过），折后的名字仍按折后核", () => {
    const { plan, candidate } = fixture()
    /**
     * **A3（2026-10-26）改变了这一条的期望**：折片 `AEF` 在动作里给了**折前坐标**，
     * 所以 `AE=1`（动点 A + 折痕端点 E）是**折前图形**的条件，应按折前状态核 ——
     * 旧口径拿最终文档核，A 已改名成 P，只能报"点名缺失：A"。那不是题面缺条件，
     * 是我们的核验只看一个状态。折前条件现在**核得出来**，理由里标明状态。
     */
    const preFoldLength = verifyDiagramObligations(parseDiagramObligations("AE=1"), plan, candidate)
      .checks.find((entry) => entry.sourceText.includes("AE=1"))
    expect(preFoldLength?.status).toBe("passed")
    expect(preFoldLength?.reason ?? "").toContain("折前状态")

    /**
     * **跨折痕的量必须真的用折前坐标**：折前 `|AB|=2`，折后 `|PB|=√3`。
     * 若拿最终文档去核（把 A 别名成 P），这条会失败 —— 它通过只可能来自折前状态。
     */
    const crossFold = verifyDiagramObligations(parseDiagramObligations("AB=2"), plan, candidate)
      .checks.find((entry) => entry.sourceText.includes("AB=2"))
    expect(crossFold?.status).toBe("passed")
    expect(crossFold?.reason ?? "").toContain("折前状态")

    // 折后自己的名字（P）不受影响：仍按最终文档核，且**不带**折前注记。
    const postFold = verifyDiagramObligations(parseDiagramObligations("PE=1"), plan, candidate)
      .checks.find((entry) => entry.sourceText.includes("PE=1"))
    expect(postFold?.status).toBe("passed")
    expect(postFold?.reason ?? "").not.toContain("折前状态")
  })
})

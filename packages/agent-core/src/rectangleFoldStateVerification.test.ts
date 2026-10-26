import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compilePlan } from "./planCompiler"
import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import { solveRectangleFold } from "./rectangleFoldPlan"
import type { PlanEnvelope } from "./contracts"

/**
 * **A3 状态感知核验（2026-10-26）**：折前条件用折片折前坐标核，折后条件用最终文档核。
 *
 * 为什么非做不可：
 * - 计划把折后点改名（`B ⇒ B′`）后，最终文档里**没有 `B`** —— 旧的"单一状态"核验会把
 *   `AB=4` 报成"点名缺失：B"；
 * - **跨折痕的量**会随折而变：矩形的对角线 `BD`（折前 √20）与折后的 `B′D`（2√85/5）
 *   是两个不同的数。拿最终文档去核 `BD=2√5` 会把一条对的折前条件判错。
 * - 折后条件（`平面 ABC ⊥ 平面 ACD`）反过来必须用折后坐标，且 `ABC` 里的 `B`
 *   要指向折后的 `B′`（别名）。
 *
 * 这一组同时钉住"确实按折前坐标核"与"折后条件仍按折后核"。
 */
const PROMPT = "矩形 ABCD 中，AB=4，BC=2，AB⊥BC，BD=2√5，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。求折后 BD 的长。"

function compile(prompt: string) {
  const solved = solveRectangleFold(prompt)
  if (solved.status !== "plan") throw new Error(`fixture: ${solved.status}`)
  return compilePlan(solved.plan, { document: createEmptyDocument("geometry3d"), conversationId: "a3-state", documentGeneration: 0, prompt })
}

function pointAt(document: { primitives: readonly unknown[] } | null | undefined, label: string): { x: number; y: number; z: number } | undefined {
  const found = document?.primitives.find(
    (primitive) => (primitive as { type?: string }).type === "point3" && (primitive as { label?: string }).label === label
  )
  return (found as { position?: { x: number; y: number; z: number } } | undefined)?.position
}

describe("A3 折前 / 折后分别核验", () => {
  it("折前长度与角用折片折前坐标；两平面垂直仍按折后核", () => {
    const compiled = compile(PROMPT)
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.diagnostics)).toBe(true)
    const checks = compiled.diagramVerification?.checks ?? []

    for (const segment of ["AB", "BC"]) {
      const check = checks.find((entry) => entry.kind === "fixedLength" && entry.sourceText.includes(segment))
      expect(check?.status, `${segment} 的核验：${check?.reason}`).toBe("passed")
      expect(check?.reason ?? "").toContain("折前状态")
    }

    const rightAngle = checks.find((check) => check.kind === "perpendicular" && check.sourceText.includes("AB"))
    expect(rightAngle?.status, `AB⊥BC 的核验：${rightAngle?.reason}`).toBe("passed")
    expect(rightAngle?.reason ?? "").toContain("折前状态")

    const planes = checks.find((check) => check.kind === "planePerpendicular")
    expect(planes?.status, `两平面垂直的核验：${planes?.reason}`).toBe("passed")
    // 折后条件**不**带折前状态的注记。
    expect(planes?.reason ?? "").not.toContain("折前状态")
    // 题设账干净：矩形/边长/垂直/对角线都在各自状态核过，没有"未核验"残留。
    const pending = checks.filter((check) => check.status !== "passed").map((check) => `${check.sourceText}：${check.reason}`)
    expect(pending, pending.join("；")).toEqual([])
    expect(compiled.diagramVerification?.status).toBe("passed")
  })

  it("矩形对角线 BD=2√5 只在折前成立：折后 B′D=2√85/5，两个数不同", () => {
    const compiled = compile(PROMPT)
    const checks = compiled.diagramVerification?.checks ?? []

    const diagonal = checks.find((check) => check.kind === "fixedLength" && check.sourceText.includes("BD"))
    expect(diagonal?.status, `BD 的核验：${diagonal?.reason}`).toBe("passed")
    expect(diagonal?.reason ?? "").toContain("折前状态")

    const b = pointAt(compiled.draftDocument, "B′")
    expect(b).toBeDefined()
    const postLength = Math.hypot(b!.x - 0, b!.y - 2, b!.z - 0)
    expect(postLength).toBeCloseTo((2 * Math.sqrt(85)) / 5, 9)
    // 折后长度与折前对角线相差 0.7 以上 —— passed 只可能来自折前坐标。
    expect(Math.abs(postLength - 2 * Math.sqrt(5))).toBeGreaterThan(0.5)
  })

  it("矩形从句进了题设账：rectangle 义务按折前状态核并通过，不再落未核验", () => {
    const compiled = compile(PROMPT)
    const checks = compiled.diagramVerification?.checks ?? []
    const rectangle = checks.find((check) => check.kind === "rectangle")
    expect(rectangle?.status, `矩形核验：${rectangle?.reason}`).toBe("passed")
    expect(rectangle?.reason ?? "").toContain("折前状态")
    expect(checks.some((check) => check.status === "unverified" && check.sourceText.includes("矩形"))).toBe(false)
  })

  it("折前四边形不闭合 ⇒ rectangle 义务失败（不是只查相邻边垂直）", () => {
    const plan = {
      schemaVersion: "mathcanvas.plan.v1",
      kind: "plan",
      goal: "故意把 B 挪坏",
      factIds: [],
      actions: [
        { actionId: "solid.create_face", actionKey: "fixed", factIds: [], inputs: { alias: "fixed", vertexNames: ["A", "C", "D"], vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }] } },
        { actionId: "solid.fold", actionKey: "flap", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "B", "C"], vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 1, z: 0 }, { x: 4, y: 2, z: 0 }], hinge: { from: "A", to: "C" }, apex: "B", apexAs: "B′", angle: 90 } }
      ]
    } as unknown as PlanEnvelope
    const compiled = compilePlan(plan, { document: createEmptyDocument("geometry3d"), conversationId: "a3-bad-rectangle", documentGeneration: 0 })
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true)

    const report = verifyDiagramObligations(parseDiagramObligations("矩形 ABCD 中，AB=4，BC=2"), plan, compiled.draftDocument!, undefined, { prompt: "矩形 ABCD 中，AB=4，BC=2" })
    const rectangle = report.checks.find((check) => check.kind === "rectangle")
    expect(rectangle?.status, `矩形核验：${rectangle?.reason}`).toBe("failed")
  })
})

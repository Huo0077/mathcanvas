import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compilePlan } from "./planCompiler"
import { solveRectangleFold } from "./rectangleFoldPlan"

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

  it("矩形从句今天仍如实落未核验（不假装矩形判据已经进题设账）", () => {
    const compiled = compile(PROMPT)
    const checks = compiled.diagramVerification?.checks ?? []
    expect(checks.some((check) => check.status === "unverified" && check.sourceText.includes("矩形"))).toBe(true)
  })
})

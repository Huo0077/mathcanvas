import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import type { Vector3 } from "@draw/geometry-kernel"
import { compilePlan } from "./planCompiler"
import { tryBuildPolygonFoldPlan } from "./polygonFoldPlan"
import { CASE_4_ORIGINAL, CASE_4_REVISED } from "./fixtures/solidGeometryFourCases"

/**
 * **T6：梯形沿对角线翻折**（2026-11-05 四题修复）。
 *
 * 两半各自钉住：
 * 1. **原题**必须给出**一次**澄清（`D→P` 与 `CD` 折前/折后两处一起问），**不出计划**；
 * 2. **明确修订版**才出计划，且几何由测试**自己量**：折痕不动、折片刚性、折角 90°、
 *    两平面垂直、`P=(1/2,1/2,±1/√2)`、`M` 是 `PB` 中点。
 */

const compile = (prompt: string, branch?: 1 | -1) => {
  const built = tryBuildPolygonFoldPlan({ prompt, ...(branch === undefined ? {} : { branch }) })
  expect(built.status, JSON.stringify(built)).toBe("ok")
  if (built.status !== "ok") throw new Error("没有产出计划")
  const compiled = compilePlan(built.plan, {
    document: createEmptyDocument("geometry3d"),
    prompt,
    workspace: "geometry3d" as const,
    conversationId: "polygon-fold",
    documentGeneration: 0
  })
  const detail = compiled.diagnostics.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join("；")
  expect(compiled.ok, detail).toBe(true)
  return { built, compiled }
}

const pointsOf = (document: ReturnType<typeof createEmptyDocument> | null): Map<string, Vector3> => {
  const map = new Map<string, Vector3>()
  for (const primitive of document?.primitives ?? []) {
    if (primitive.type !== "point3") continue
    const label = (primitive as { label?: unknown }).label
    if (typeof label === "string") map.set(label, primitive.position)
  }
  return map
}
const distance = (left: Vector3, right: Vector3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
const subtract = (left: Vector3, right: Vector3): Vector3 => ({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z })
const cross = (left: Vector3, right: Vector3): Vector3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x
})
const norm = (value: Vector3) => Math.hypot(value.x, value.y, value.z)
const unit = (value: Vector3): Vector3 => ({ x: value.x / norm(value), y: value.y / norm(value), z: value.z / norm(value) })

describe("T6 梯形翻折：原题一次澄清、修订版可作图", () => {
  it("原题（`折起成△PAC`，没说 D→P、没说 CD 指哪一态）⇒ **一条**合并澄清，不出计划", () => {
    const built = tryBuildPolygonFoldPlan({ prompt: CASE_4_ORIGINAL.prompt })
    expect(built.status, JSON.stringify(built)).toBe("clarification")
    if (built.status !== "clarification") return
    /** 一次问完：两处都在同一条问题里。 */
    expect(built.question).toContain("D→P")
    expect(built.question).toContain("CD")
    expect(built.question).toContain("折前")
    expect(built.reason).toBe("ambiguous-destination")
    /** 不许"先生成一张自称符合原题的图"。 */
    expect(built).not.toHaveProperty("plan")
  })

  it("修订版（写明 D→P 与 CD 指折前）⇒ 出计划：折痕不动、折片刚性、折角 90°", () => {
    const { built, compiled } = compile(CASE_4_REVISED.prompt)
    const points = pointsOf(compiled.draftDocument)
    for (const name of ["A", "B", "C", "P", "M"]) expect(points.has(name), `缺 ${name}`).toBe(true)
    /** 折前的 `D` 不再作为图上的点出现（不是"同一个名字两个位置"）。 */
    expect(points.has("D")).toBe(false)

    const a = points.get("A")!
    const b = points.get("B")!
    const c = points.get("C")!
    const p = points.get("P")!
    /** ① 折痕两端不动：与折前坐标逐分量一致。 */
    for (const [name, point] of [["A", a], ["C", c]] as const) {
      expect(distance(point, built.geometry.pre[name]!), `折痕端点 ${name} 必须不动`).toBeLessThan(1e-9)
    }
    /** ② 折片刚性：|AP|=|AD|=1、|CP|=|CD|=1。 */
    expect(distance(a, p)).toBeCloseTo(1, 9)
    expect(distance(c, p)).toBeCloseTo(1, 9)
    /** ③ 折角 90°：动点绕折痕转过的角度。 */
    const axis = unit(subtract(c, a))
    const project = (point: Vector3) => {
      const offset = subtract(point, a)
      const along = offset.x * axis.x + offset.y * axis.y + offset.z * axis.z
      return { x: offset.x - along * axis.x, y: offset.y - along * axis.y, z: offset.z - along * axis.z }
    }
    const before = project(built.geometry.pre["D"]!)
    const after = project(p)
    const cosine = (before.x * after.x + before.y * after.y + before.z * after.z) / (norm(before) * norm(after))
    expect((Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI).toBeCloseTo(90, 6)
    /** ④ 平面 PAC ⊥ 平面 ABC。 */
    const normalPac = cross(subtract(c, a), subtract(p, a))
    const normalAbc = cross(subtract(b, a), subtract(c, a))
    expect(Math.abs(normalPac.x * normalAbc.x + normalPac.y * normalAbc.y + normalPac.z * normalAbc.z), "两个法向垂直").toBeLessThan(1e-9)
    /** ⑤ 设计 §3 的参考坐标：`A=(0,0,0) B=(2,0,0) C=(1,1,0)`，`P=(1/2,1/2,±1/√2)`。 */
    expect(a.x).toBeCloseTo(0, 9)
    expect(b.x).toBeCloseTo(2, 9)
    expect(c.x).toBeCloseTo(1, 9)
    expect(c.y).toBeCloseTo(1, 9)
    expect(p.x).toBeCloseTo(1 / 2, 9)
    expect(p.y).toBeCloseTo(1 / 2, 9)
    expect(Math.abs(p.z)).toBeCloseTo(Math.SQRT1_2, 9)
    /** ⑥ `M` 是 `PB` 的中点（折后名 P 与固定点 B 之间）。 */
    const m = points.get("M")!
    expect(m.x).toBeCloseTo((p.x + b.x) / 2, 9)
    expect(m.y).toBeCloseTo((p.y + b.y) / 2, 9)
    expect(m.z).toBeCloseTo((p.z + b.z) / 2, 9)
    expect(built.geometry.angleDegrees).toBe(90)
  })

  it("镜像分支（branch = −1）满足同一组不变量，只是 `P` 落在折痕另一侧", () => {
    const plus = tryBuildPolygonFoldPlan({ prompt: CASE_4_REVISED.prompt, branch: 1 })
    const minus = tryBuildPolygonFoldPlan({ prompt: CASE_4_REVISED.prompt, branch: -1 })
    expect(plus.status).toBe("ok")
    expect(minus.status).toBe("ok")
    if (plus.status !== "ok" || minus.status !== "ok") return
    const plusP = plus.geometry.post["P"]!
    const minusP = minus.geometry.post["P"]!
    /** 折痕 `AC` 在 `z = 0` 上：两个分支的 `z` 互为相反数。 */
    expect(minusP.z).toBeCloseTo(-plusP.z, 9)
    expect(minusP.x).toBeCloseTo(plusP.x, 9)
    expect(minusP.y).toBeCloseTo(plusP.y, 9)
    /**
     * **落盘的动作只带折角**：`solid.fold` 按它自己的确定性规则选一侧，
     * 所以两个分支编译出来的 `P` 是**同一个**（这不算错 —— 设计允许刚体等价的镜像）。
     * 这一条把"我们算的"与"落盘的"分别说清，免得以后把两者混为一谈。
     */
    const compiledP = pointsOf(compile(CASE_4_REVISED.prompt, 1).compiled.draftDocument).get("P")!
    expect(Math.abs(compiledP.z)).toBeCloseTo(Math.abs(plusP.z), 9)
  })

  it("折角没写、也没有「平面 ⊥ 平面」⇒ 问折角（不默认 90°）", () => {
    const prompt = CASE_4_REVISED.prompt.replace("旋转90°", "旋转").replace("使得平面PAC⊥平面ABC，且题中引用的CD指折前线段。", "题中引用的CD指折前线段。")
    const built = tryBuildPolygonFoldPlan({ prompt })
    expect(built.status).toBe("clarification")
    if (built.status !== "clarification") return
    expect(built.reason).toBe("needs-fold-angle")
    expect(built.question).toContain("折角")
  })

  it("负测：折痕两端不在折片上 / 没有梯形底面 ⇒ not-applicable（不猜）", () => {
    const badHinge = "在直角梯形ABCD中，AB∥CD，AD⊥AB，AB=2，AD=CD=1。将△ACD沿BD折起成△PAC，使得平面PAC⊥平面ABC。"
    expect(tryBuildPolygonFoldPlan({ prompt: badHinge }).status).toBe("not-applicable")

    expect(tryBuildPolygonFoldPlan({ prompt: "画一个圆，半径 3" }).status).toBe("not-applicable")
  })
})

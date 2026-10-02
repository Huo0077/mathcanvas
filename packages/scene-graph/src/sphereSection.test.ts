import { describe, expect, it } from "vitest"

import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { conic3PointAt } from "@draw/geometry-kernel"

import { recomputeSection } from "./sectionRecompute"
import { sectionPlaneThroughSource } from "./solidGeometry"

/**
 * 球的**解析截面**（实施计划 Task 4）：圆 / 单点切触 / 空集三种结局都写进 `SectionPrimitive`。
 *
 * 判据不是"`section.exact` 有值"，而是四件事同时对：
 * ① `exact.kind` 与 `status` 说的是**解析**结论（圆 → `"circle"` / `"exact"`）；
 * ② `section.points` 只是**可再生显示缓存**，缓存里的点必须真的落在球面上（回代 `|X−C|²=r²`），
 *    而不是"看着是个圆"；
 * ③ 切点要**可见**（spec §3：画布上得有一个点标记），空集要**不可见且不留上一次的圆**；
 * ④ 改半径之后，显示缓存与解析系数**两边都重算**（只更新一边就等于画的和算的不是一件事）。
 */

const SPHERE = { id: "sphere-1", type: "sphere" as const, center: { x: 1, y: 2, z: 3 }, radius: 5 }

const horizontalCut = (constant: number) => ({ normal: { x: 0, y: 0, z: 1 }, constant })

const sectionAt = (constant: number, sourceId = "sphere-1") => ({
  id: "section-1",
  type: "section" as const,
  sourceId,
  plane: horizontalCut(constant),
  points: [],
  classification: "none" as const,
  status: "undefined" as const
})

const mapOf = (...primitives: readonly PrimitiveSpec[]) => new Map(primitives.map((primitive) => [primitive.id, primitive]))

/** 点到球面的残差：交圆 / 切点上的点代进去必须接近 0。 */
const sphereResidual = (point: { x: number; y: number; z: number }) =>
  Math.abs((point.x - 1) ** 2 + (point.y - 2) ** 2 + (point.z - 3) ** 2 - 25)

describe("analytic sphere sections", () => {
  it("cuts the exact circle at z = 6 and marks the section exact", () => {
    const result = recomputeSection(sectionAt(-6), SPHERE, mapOf(SPHERE))

    expect(result.exact?.kind).toBe("circle")
    expect(result.status).toBe("exact")
    expect(result.classification).toBe("polygon")
    expect(result.visible).toBe(true)
    // 球没有端面：整条交圆就是一段完整参数域，不像圆柱那样还要被端面裁成弧 + 弦。
    expect(result.exact?.loops).toHaveLength(1)
    expect(result.exact?.loops[0]).toHaveLength(1)
    const piece = result.exact?.loops[0][0]
    expect(piece?.kind).toBe("conic")
    if (piece?.kind === "conic") expect(piece.parameterRange).toEqual([0, Math.PI * 2])
  })

  it("makes the display cache real points on the sphere, all in the cutting plane", () => {
    const result = recomputeSection(sectionAt(-6), SPHERE, mapOf(SPHERE))

    expect(result.points.length).toBeGreaterThanOrEqual(3)
    for (const point of result.points) {
      // 既在球面上、又在剖切面上 —— 两个条件缺一条就说明缓存是编出来的。
      expect(sphereResidual(point), `${JSON.stringify(point)} 应落在球面上`).toBeLessThan(1e-9)
      expect(Math.abs(point.z - 6), `${JSON.stringify(point)} 应落在 z=6 平面上`).toBeLessThan(1e-9)
    }
    // 圆的半径必须是 4（√(5²−3²)），不是"看着差不多"。
    const radii = result.points.map((point) => Math.hypot(point.x - 1, point.y - 2))
    for (const radius of radii) expect(radius).toBeCloseTo(4, 9)
  })

  it("treats the exact conic as the truth, so a sampled point matches it", () => {
    const result = recomputeSection(sectionAt(-6), SPHERE, mapOf(SPHERE))
    const conic = result.exact?.loops[0][0]
    if (conic?.kind !== "conic") throw new Error("expected the exact conic piece")

    for (let step = 0; step < 12; step += 1) {
      const point = conic3PointAt(conic.conic, (step / 12) * Math.PI * 2)
      expect(point).not.toBeNull()
      expect(sphereResidual(point!)).toBeLessThan(1e-9)
    }
  })

  it("keeps a tangent plane as one visible exact point", () => {
    const result = recomputeSection(sectionAt(-8), SPHERE, mapOf(SPHERE))

    // spec §3：切点 classification="point" / status="exact"，而且画布上要有可见点标记。
    expect(result.classification).toBe("point")
    expect(result.status).toBe("exact")
    expect(result.visible).toBe(true)
    expect(result.points).toHaveLength(1)
    expect(result.points[0].x).toBeCloseTo(1, 9)
    expect(result.points[0].y).toBeCloseTo(2, 9)
    expect(result.points[0].z).toBeCloseTo(8, 9)
    expect(result.exact?.kind).toBe("point")
    // 切点没有"圈"，所以不许留下任何环。
    expect(result.exact?.loops).toHaveLength(0)
    expect(result.loops ?? []).toHaveLength(0)
  })

  it("reports none at z = 9 and leaves no stale circle behind", () => {
    const result = recomputeSection(sectionAt(-9), SPHERE, mapOf(SPHERE))

    expect(result.classification).toBe("none")
    expect(result.status).toBe("undefined")
    expect(result.visible).toBe(false)
    expect(result.points).toHaveLength(0)
    // 关键：不能把上一次那个圆留着 —— 那会让画布上出现一个"不存在的截面"。
    expect(result.exact?.loops ?? []).toHaveLength(0)
    expect(result.exact?.kind === "circle").toBe(false)
  })

  it("re-evaluates both the display cache and the exact coefficients when the radius changes", () => {
    const smaller = { ...SPHERE, radius: 4 }
    const atFive = recomputeSection(sectionAt(-6), SPHERE, mapOf(SPHERE))
    const atFour = recomputeSection(sectionAt(-6), smaller, mapOf(smaller))

    expect(atFive.exact?.kind).toBe("circle")
    expect(atFour.exact?.kind).toBe("circle")
    const pieceOf = (result: typeof atFive) => {
      const piece = result.exact?.loops[0][0]
      if (piece?.kind !== "conic") throw new Error("expected the exact conic piece")
      return piece.conic
    }
    // 半径 5 → 交圆半径 4（系数 −16）；半径 4 → 交圆半径 √7（系数 −7）。
    expect(pieceOf(atFive).coefficients?.[5]).toBeCloseTo(-16, 9)
    expect(pieceOf(atFour).coefficients?.[5]).toBeCloseTo(-7, 9)
    // 显示缓存也得跟着变，否则画的是旧圆、算的是新圆。
    expect(Math.max(...atFour.points.map((point) => Math.hypot(point.x - 1, point.y - 2)))).toBeCloseTo(Math.sqrt(7), 9)
  })

  it("defaults a new cut through the sphere centre, giving the great circle", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ ...SPHERE }]

    const plane = sectionPlaneThroughSource(document, "sphere-1")
    expect(plane).not.toBeNull()
    // 过球心 ⇒ 有符号距离为 0 ⇒ 大圆，半径就等于球半径。
    expect(plane!.normal).toEqual({ x: 0, y: 0, z: 1 })
    expect(-(plane!.constant)).toBeCloseTo(3, 9)

    const result = recomputeSection({ ...sectionAt(plane!.constant) }, SPHERE, mapOf(SPHERE))
    expect(result.exact?.kind).toBe("circle")
    expect(result.points.length).toBeGreaterThanOrEqual(3)
    for (const point of result.points) expect(Math.hypot(point.x - 1, point.y - 2)).toBeCloseTo(5, 9)
  })
})

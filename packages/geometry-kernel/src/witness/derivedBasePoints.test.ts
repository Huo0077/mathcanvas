import { describe, expect, it } from "vitest"

import type { Vector3 } from "../geometry3d"
import { resolveDerivedBasePoints } from "./derivedBasePoints"
import type { DerivedBasePoint } from "./solidShapeSpec"

/**
 * **T4：底面内部派生点**（2026-11-05 四题修复）。
 *
 * 判据自己算：交点的坐标由测试独立写出（Case 3 的菱形底 `A(0,0) B(2,0) C(3,√3) D(1,√3)`
 * 的对角线交点就是 `(3/2, √3/2)`），不读实现的中间量。
 */

const rhombus: { names: string[]; points: Vector3[] } = {
  names: ["A", "B", "C", "D"],
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 3, y: Math.sqrt(3), z: 0 },
    { x: 1, y: Math.sqrt(3), z: 0 }
  ]
}

const diagonal = (name = "O"): DerivedBasePoint => ({
  name,
  kind: "diagonal-intersection",
  lines: [["A", "C"], ["B", "D"]]
})

describe("T4 底面派生点：对角线交点", () => {
  it("菱形 AC 与 BD 的交点是 (3/2, √3/2)，参数 1/2（落在 AC 上）", () => {
    const result = resolveDerivedBasePoints({ baseNames: rhombus.names, basePoints: rhombus.points, definitions: [diagonal()] })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.points).toHaveLength(1)
    const [point] = result.points
    expect(point!.name).toBe("O")
    expect(point!.point.x).toBeCloseTo(1.5, 12)
    expect(point!.point.y).toBeCloseTo(Math.sqrt(3) / 2, 12)
    expect(point!.point.z).toBe(0)
    expect(point!.parameter).toBeCloseTo(0.5, 12)
    expect(point!.hostEdge).toEqual(["A", "C"])
    expect(point!.source).toContain("AC")
    expect(result.assumptions.join("；")).toContain("不是")
  })

  it("矩形也同样解得出（不是为菱形写的特例）", () => {
    const result = resolveDerivedBasePoints({
      baseNames: ["P", "Q", "R", "S"],
      basePoints: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 }
      ],
      definitions: [{ name: "M", kind: "diagonal-intersection", lines: [["P", "R"], ["Q", "S"]] }]
    })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.points[0]!.point.x).toBeCloseTo(1, 12)
    expect(result.points[0]!.point.y).toBeCloseTo(0.5, 12)
  })

  it("没有派生点定义 ⇒ 空结果（既有行为逐字不变）", () => {
    const result = resolveDerivedBasePoints({ baseNames: rhombus.names, basePoints: rhombus.points, definitions: [] })
    expect(result).toEqual({ status: "ok", points: [], assumptions: [] })
  })

  it("负测：引用缺失 / 重名 / 自引用 / 平行 / 交点在线段外 —— 全部结构化拒绝", () => {
    const cases: { label: string; definitions: DerivedBasePoint[] }[] = [
      { label: "引用缺失", definitions: [{ name: "O", kind: "diagonal-intersection", lines: [["A", "C"], ["B", "Z"]] }] },
      { label: "与底点重名", definitions: [diagonal("A")] },
      { label: "两条派生点重名", definitions: [diagonal("O"), diagonal("O")] },
      { label: "自引用", definitions: [{ name: "O", kind: "diagonal-intersection", lines: [["A", "A"], ["B", "D"]] }] },
      { label: "平行", definitions: [{ name: "O", kind: "diagonal-intersection", lines: [["A", "B"], ["D", "C"]] }] },
      { label: "交点在线段外", definitions: [{ name: "O", kind: "diagonal-intersection", lines: [["A", "B"], ["C", "B"]] }] }
    ]
    for (const entry of cases) {
      const result = resolveDerivedBasePoints({ baseNames: rhombus.names, basePoints: rhombus.points, definitions: entry.definitions })
      expect(result.status, entry.label).toBe("rejected")
      if (result.status === "rejected") expect(result.message.length).toBeGreaterThan(0)
    }
  })

  it("负测：两条线异面（skew）⇒ 拒绝（三维里根本没有交点）", () => {
    /**
     * `AC` 沿 x 轴（`y = 0, z = 0`），`BD` 在 `x = 0, y = 1` 上竖直 —— 两条线**异面**。
     * （注意：两条**相交**的线永远共面，所以"不共面"的负测必须用异面直线。）
     */
    const result = resolveDerivedBasePoints({
      baseNames: rhombus.names,
      basePoints: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 1 }
      ],
      definitions: [diagonal()]
    })
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") expect(result.message).toContain("不在同一张平面上")
  })
})

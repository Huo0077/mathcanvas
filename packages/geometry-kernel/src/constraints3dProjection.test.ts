import { describe, expect, it } from "vitest"

import type { ConstraintSpec, PrimitiveSpec } from "@draw/dsl"

import { projectPoint3Constraints } from "./constraints3dProjection"

/**
 * **N3（动态拖动保持约束）的第一块内核砖**：把点真的投影到约束上。
 *
 * 与 `solvePoint3Constraints` 的分工必须先说清，否则"两个求解器"看起来像重复实现：
 * 那个函数**只诊断、绝不动点**（文件头与 `constraints3d.test.ts` 的一条用例都钉着这条），
 * 本文件测的这个函数才**真的改坐标**。两条路都保留：拖动前要知道"现在差多少"，
 * 拖动中要知道"挪到哪里才算满足"。
 *
 * 场景：`plane-abc` 是 z = 0（过 a、b、c），`line-ab` 是 x 轴（过 a、b），`line-ce` 也平行于 x 轴。
 */
function scene(): PrimitiveSpec[] {
  return [
    { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
    { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
    { id: "e", type: "point3", position: { x: 1, y: 1, z: 0 } },
    { id: "p", type: "point3", position: { x: 2, y: 3, z: 4 } },
    { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["a", "b"] } },
    { id: "line-ce", type: "line3", definition: { kind: "throughPoints", pointIds: ["c", "e"] } },
    { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } }
  ]
}

/** 一条沿着 z 轴、经过 c 的直线（与 x 轴不平行）。 */
function withZAxisLine(primitives: PrimitiveSpec[]): PrimitiveSpec[] {
  return [
    ...primitives,
    { id: "f", type: "point3", position: { x: 0, y: 1, z: 1 } },
    { id: "line-cf", type: "line3", definition: { kind: "throughPoints", pointIds: ["c", "f"] } }
  ]
}

function at(result: { positions: Map<string, { x: number; y: number; z: number }> }, id: string) {
  const position = result.positions.get(id)
  if (position === undefined) throw new Error(`没有 ${id} 的坐标`)
  return position
}

describe("3D 约束的点投影", () => {
  it("把点拉到直线上（pointOnLine 的垂足）", () => {
    const constraints: ConstraintSpec[] = [{ id: "on-line", type: "pointOnLine", targets: ["p", "line-ab"] }]
    const result = projectPoint3Constraints(scene(), constraints)

    // p = (2,3,4) 到 x 轴的垂足是 (2,0,0)：另外两个分量被压掉，沿轴的分量保留。
    expect(at(result, "p")).toEqual({ x: 2, y: 0, z: 0 })
    expect(result.movedPointIds).toEqual(["p"])
    expect(result.skipped).toEqual([])
    expect(result.satisfied).toBe(true)
    expect(result.exhausted).toBe(false)
  })

  it("把点拉到平面上（pointOnPlane 的垂足）", () => {
    const constraints: ConstraintSpec[] = [{ id: "on-plane", type: "pointOnPlane", targets: ["p", "plane-abc"] }]
    const result = projectPoint3Constraints(scene(), constraints)

    // 平面 z = 0：只有 z 被压掉。
    expect(at(result, "p")).toEqual({ x: 2, y: 3, z: 0 })
    expect(result.satisfied).toBe(true)
  })

  it("按固定距离挪动第二个点（fixedDistance 保留第一个点）", () => {
    const primitives: PrimitiveSpec[] = [...scene(), { id: "q", type: "point3", position: { x: 3, y: 0, z: 0 } }]
    const constraints: ConstraintSpec[] = [{ id: "len", type: "fixedDistance", targets: ["a", "q"], value: 2 }]
    const result = projectPoint3Constraints(primitives, constraints)

    expect(at(result, "q")).toEqual({ x: 2, y: 0, z: 0 })
    expect(at(result, "a")).toEqual({ x: 0, y: 0, z: 0 })
    expect(result.movedPointIds).toEqual(["q"])
    expect(result.satisfied).toBe(true)
  })

  it("第二个点不许动时，挪的是第一个点（锚点由调用方给出）", () => {
    const primitives: PrimitiveSpec[] = [...scene(), { id: "q", type: "point3", position: { x: 3, y: 0, z: 0 } }]
    const constraints: ConstraintSpec[] = [{ id: "len", type: "fixedDistance", targets: ["a", "q"], value: 2 }]
    const result = projectPoint3Constraints(primitives, constraints, { anchoredPointIds: ["q"] })

    // q 不动，a 被拉到距 q 为 2 的位置：(3,0,0) − 2·x̂ = (1,0,0)。
    expect(at(result, "q")).toEqual({ x: 3, y: 0, z: 0 })
    expect(at(result, "a")).toEqual({ x: 1, y: 0, z: 0 })
    expect(result.movedPointIds).toEqual(["a"])
    expect(result.satisfied).toBe(true)
  })

  it("把多余的点拉到前两点确定的直线上（collinear）", () => {
    const constraints: ConstraintSpec[] = [{ id: "collinear", type: "collinear", targets: ["a", "b", "p"] }]
    const result = projectPoint3Constraints(scene(), constraints)

    expect(at(result, "p")).toEqual({ x: 2, y: 0, z: 0 })
    expect(result.satisfied).toBe(true)
  })

  it("把多余的点拉到前三点的平面上（coplanar）", () => {
    const constraints: ConstraintSpec[] = [{ id: "coplanar", type: "coplanar", targets: ["a", "b", "c", "p"] }]
    const result = projectPoint3Constraints(scene(), constraints)

    expect(at(result, "p")).toEqual({ x: 2, y: 3, z: 0 })
    expect(result.satisfied).toBe(true)
  })

  it("一条约束里牵涉的点全都不许动：如实进 skipped，绝不偷偷改坐标", () => {
    const constraints: ConstraintSpec[] = [{ id: "on-plane", type: "pointOnPlane", targets: ["p", "plane-abc"] }]
    const result = projectPoint3Constraints(scene(), constraints, { anchoredPointIds: ["p"] })

    expect(at(result, "p")).toEqual({ x: 2, y: 3, z: 4 })
    expect(result.movedPointIds).toEqual([])
    expect(result.skipped.map((entry) => entry.code)).toEqual(["no-movable-point"])
    // **这不是一个可以误读成"都满足"的结果**：跳过意味着这条约束没有被满足。
    expect(result.satisfied).toBe(false)
    // 但它也**不是**"还没跑完"：迭代到定点才停，停的原因是这里没有可动的点，不是次数不够。
    expect(result.exhausted).toBe(false)
  })

  it("本来就满足的约束不会被改动，也不算跳过", () => {
    const constraints: ConstraintSpec[] = [{ id: "parallel", type: "parallel", targets: ["line-ab", "line-ce"] }]
    const result = projectPoint3Constraints(scene(), constraints)

    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.residual).toBe(0)
    expect(result.skipped).toEqual([])
    expect(result.movedPointIds).toEqual([])
    expect(result.satisfied).toBe(true)
    expect(result.exhausted).toBe(false)
  })

  it("需要动、但这一批还没有投影规则的约束：如实进 skipped 并 fail-closed", () => {
    // line-cf 沿 z 轴，与 x 轴不平行 → 残差 1，**必须动**；而"把一条线转过去"本批没做。
    const constraints: ConstraintSpec[] = [{ id: "parallel", type: "parallel", targets: ["line-ab", "line-cf"] }]
    const result = projectPoint3Constraints(withZAxisLine(scene()), constraints)

    expect(result.movedPointIds).toEqual([])
    expect(result.skipped.map((entry) => entry.code)).toEqual(["no-projection-rule"])
    // 到定点才停（不是次数用完了），但**没有满足** —— 两条都是实话，不能只报一条。
    expect(result.exhausted).toBe(false)
    expect(result.satisfied).toBe(false)
    // "这一版修不了"与"它就是错的"是两句话，不许混 —— 文案必须说清是**范围限制**。
    expect(result.skipped[0]?.reason).toContain("这一版还没有它的投影规则")
  })

  it("绝不就地改写入参：调用方拿回的原对象必须一模一样", () => {
    const primitives = scene()
    const constraints: ConstraintSpec[] = [
      { id: "on-plane", type: "pointOnPlane", targets: ["p", "plane-abc"] },
      { id: "on-line", type: "pointOnLine", targets: ["p", "line-ab"] }
    ]
    const snapshot = JSON.stringify(primitives)
    projectPoint3Constraints(primitives, constraints)

    expect(JSON.stringify(primitives)).toBe(snapshot)
  })

  it("同一个点被两条规则交替拽：两条都满足，且迭代次数有界", () => {
    // z = 0 平面与 x 轴的交集就是 x 轴本身，所以两条都能满足。
    const constraints: ConstraintSpec[] = [
      { id: "on-plane", type: "pointOnPlane", targets: ["p", "plane-abc"] },
      { id: "on-line", type: "pointOnLine", targets: ["p", "line-ab"] }
    ]
    const result = projectPoint3Constraints(scene(), constraints)

    expect(at(result, "p")).toEqual({ x: 2, y: 0, z: 0 })
    expect(result.satisfied).toBe(true)
    expect(result.iterations).toBeLessThanOrEqual(12)
  })

  it("点不到名的约束：算不出来，就不许算满足", () => {
    const constraints: ConstraintSpec[] = [{ id: "missing", type: "pointOnPlane", targets: ["p", "no-such-plane"] }]
    const result = projectPoint3Constraints(scene(), constraints)

    expect(result.skipped.map((entry) => entry.code)).toEqual(["missing-target"])
    expect(result.satisfied).toBe(false)
  })

  it("平面约束（coincident）没有空间判据：如实跳过，不退化成'已满足'", () => {
    const constraints: ConstraintSpec[] = [{ id: "coincident", type: "coincident", targets: ["a", "b"] }]
    const result = projectPoint3Constraints(scene(), constraints)

    expect(result.skipped.map((entry) => entry.code)).toEqual(["planar-only"])
    expect(result.satisfied).toBe(false)
  })
})

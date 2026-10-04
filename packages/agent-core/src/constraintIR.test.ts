import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { reportFreeDegrees } from "./constraintIR"

/**
 * 自由度诊断的用例都建在**显式坐标的点**上：这类文档的独立参数就是坐标本身，
 * 于是"自由度 = 坐标数 − 规范自由度 − 约束秩"可以手算核对，
 * 不依赖任何求解器（N1 明确不接外部 solver）。
 */
function documentOf(points: { x: number; y: number; z: number }[]): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives.push(...points.map((position, index) => ({ id: `p${index}`, type: "point3" as const, position })))
  return document
}

const TETRAHEDRON = documentOf([
  { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: 1, y: 0, z: 0 }
])

describe("reportFreeDegrees", () => {
  it("counts coordinate degrees of freedom per object and fixes the six rigid motions", () => {
    const report = reportFreeDegrees(TETRAHEDRON, [])
    expect(report.totalDof).toBe(12)
    expect(report.gaugeDof).toBe(6)
    expect(report.constraintDof).toBe(0)
    expect(report.residualDof).toBe(6)
    expect(report.objects).toEqual([
      { id: "p0", kind: "point3", dof: 3 }, { id: "p1", kind: "point3", dof: 3 },
      { id: "p2", kind: "point3", dof: 3 }, { id: "p3", kind: "point3", dof: 3 }
    ])
    expect(report.conflicts).toEqual([])
    expect(report.unsupported).toEqual([])
  })

  it("reports a satisfied distance constraint with its residual and one fewer degree of freedom", () => {
    const report = reportFreeDegrees(TETRAHEDRON, [{ id: "bd", type: "fixedDistance", targets: ["p1", "p3"], value: 2 }])
    expect(report.residuals).toEqual([{ constraintId: "bd", subject: "fixedDistance", residual: expect.closeTo(0, 10), conflict: false }])
    expect(report.constraintDof).toBe(1)
    expect(report.residualDof).toBe(5)
  })

  it("classifies a conflict as a conflict while keeping it out of the unsupported set", () => {
    // 把 D 挪到与 B 重合：题设要求 |BD| = 2，实际是 0。
    const document = documentOf([{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: -1, y: 0, z: 0 }])
    const report = reportFreeDegrees(document, [{ id: "bd", type: "fixedDistance", targets: ["p1", "p3"], value: 2 }])
    expect(report.conflicts).toEqual(["bd"])
    expect(report.unsupported).toEqual([])
    expect(report.residuals[0].conflict).toBe(true)
    expect(report.residuals[0].residual).toBeCloseTo(2, 10)
  })

  it("reports a constraint the spatial kernel has no judge for as unsupported, not as satisfied", () => {
    const report = reportFreeDegrees(TETRAHEDRON, [{ id: "same", type: "coincident", targets: ["p0", "p1"] }])
    expect(report.unsupported).toEqual([{ constraintId: "same", reason: expect.any(String) }])
    expect(report.supported).toBe(0)
    expect(report.conflicts).toEqual([])
    expect(report.constraintDof).toBe(0)
    expect(report.residuals).toEqual([])
  })

  it("does not count a duplicated constraint twice", () => {
    const constraints = [
      { id: "bd-1", type: "fixedDistance" as const, targets: ["p1", "p3"], value: 2 },
      { id: "bd-2", type: "fixedDistance" as const, targets: ["p1", "p3"], value: 2 }
    ]
    const report = reportFreeDegrees(TETRAHEDRON, constraints)
    expect(report.constraintDof).toBe(1)
    expect(report.residualDof).toBe(5)
    expect(report.residuals.map((item) => item.constraintId)).toEqual(["bd-1", "bd-2"])
  })

  it("reports a missing target as unsupported instead of quietly satisfied", () => {
    const report = reportFreeDegrees(TETRAHEDRON, [{ id: "ghost", type: "fixedDistance", targets: ["p0", "nope"], value: 1 }])
    expect(report.unsupported).toEqual([{ constraintId: "ghost", reason: expect.any(String) }])
    expect(report.constraintDof).toBe(0)
  })

  it("removes every degree of freedom when the distances pin all six", () => {
    const constraints = [
      { id: "d01", type: "fixedDistance" as const, targets: ["p0", "p1"], value: Math.hypot(1, 0, 1) },
      { id: "d02", type: "fixedDistance" as const, targets: ["p0", "p2"], value: Math.hypot(0.5, Math.sqrt(3) / 2, 1) },
      { id: "d03", type: "fixedDistance" as const, targets: ["p0", "p3"], value: Math.hypot(1, 0, 1) },
      { id: "d12", type: "fixedDistance" as const, targets: ["p1", "p2"], value: Math.hypot(1.5, Math.sqrt(3) / 2, 0) },
      { id: "d13", type: "fixedDistance" as const, targets: ["p1", "p3"], value: 2 },
      { id: "d23", type: "fixedDistance" as const, targets: ["p2", "p3"], value: Math.hypot(0.5, Math.sqrt(3) / 2, 0) }
    ]
    const report = reportFreeDegrees(TETRAHEDRON, constraints)
    expect(report.constraintDof).toBe(6)
    expect(report.residualDof).toBe(0)
    expect(report.conflicts).toEqual([])
  })

  /**
   * **受约束点的自由度必须按绑定报数**（复核 Important 4 / 裁决 R9）。
   *
   * 文件头与 `pointDof` 都承诺"线上点 1、面上点 2"，但 `parametersOf` 曾经对任何非派生
   * `point3` 都返回三个位置轴，于是 `objects[].dof` 与 `totalDof` 对受约束点也是 3 ——
   * `pointDof` 的 1/2 分支成了死代码，而夹具体系里全是自由点，所以没有任何用例发现它。
   *
   * 这条同时钉住**两个出口**：`objects[].dof`（逐对象）与 `totalDof`（汇总）。
   * 只钉一个的话，另一个仍然可以是谎话。
   */
  it("reports the binding's degree of freedom for a constrained point instead of a free point's three", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives.push({ id: "free", type: "point3", position: { x: 0, y: 0, z: 1 } })
    document.primitives.push({ id: "on-line", type: "point3", position: { x: 1, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "some-line", parameter: 0.5 } })
    document.primitives.push({ id: "on-plane", type: "point3", position: { x: 2, y: 3, z: 0 }, binding: { kind: "onPlane", planeId: "some-plane", coordinates: [2, 3], frame: { origin: { x: 0, y: 0, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 } } } })

    const report = reportFreeDegrees(document, [])

    expect(report.objects).toEqual([
      { id: "free", kind: "point3", dof: 3 },
      { id: "on-line", kind: "point3", dof: 1 },
      { id: "on-plane", kind: "point3", dof: 2 }
    ])
    expect(report.totalDof).toBe(6)
  })

  /**
   * **2D 点的自由度必须按绑定种类判，不能按"有没有 binding"判**（限定复核 round 2 的 Important）。
   *
   * `PointBinding` 是三支判别联合：`free | onPath | derived`。按**存在性**分叉会把
   * "显式写成 `{ kind: "free" }`"的自由点判成 1（它明明是 2），把 `derived` 判成 1（契约说它 0）——
   * 而且这条在生产上可达：删除宿主/来源时 `scene-graph` 会把 2D 点重写成 `{ kind: "free" }`
   *（`deletion.ts`），检查器更新时也写同一形状（`inspectorModel.ts`）。
   *
   * 与 `point3` 那一条**不能互相掩盖**：这一组全建在 `point`（2D）上，
   * 把 `point3` 分支改坏时这组不会红，反之亦然。
   */
  it("counts a 2D point's degrees of freedom by its binding kind, not by the mere presence of a binding", () => {
    const document = createEmptyDocument("conics")
    document.primitives.push({ id: "free", type: "point", x: 1, y: 2 })
    document.primitives.push({ id: "explicit-free", type: "point", x: 3, y: 4, binding: { kind: "free" } })
    document.primitives.push({ id: "on-path", type: "point", x: 5, y: 0, binding: { kind: "onPath", pathId: "some-curve", parameter: 0.25 } })
    document.primitives.push({ id: "derived", type: "point", x: 0, y: 0, binding: { kind: "derived", sourceId: "some-curve", feature: "start" } })

    const report = reportFreeDegrees(document, [])

    // `objects` **只列有参数的图元**（0 自由度不进列表 = 派生点的不变量本身）。
    expect(report.objects).toEqual([
      { id: "free", kind: "point", dof: 2 },
      { id: "explicit-free", kind: "point", dof: 2 },
      { id: "on-path", kind: "point", dof: 1 }
    ])
    // 汇总数是那三种绑定的**算术和**：2 + 2 + 1 + 0 = 5。
    // 把派生点算成 1 会让它变成 6（这才是"派生点贡献 0"的可断言出口），
    // 把显式 free 算成 1 会让它变成 4 —— 两个方向都钉住了。
    expect(report.totalDof).toBe(5)
  })

  /**
   * 诊断是**只读**的：雅可比靠扰动参数来算，而扰动必须逐个还原。
   * 少了这条，"诊断一次"就会把用户文档里的坐标悄悄挪掉一点点 —— 这种破坏只在
   * 后续计算里表现为"莫名其妙差了一点"，最难查。
   */
  it("leaves every coordinate exactly where it was", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives.push({ id: "p0", type: "point3", position: { x: 0, y: 0, z: 1 } })
    document.primitives.push({ id: "p1", type: "point3", position: { x: -1, y: 0, z: 0 } })
    document.primitives.push({ id: "plane", type: "plane3", definition: { kind: "pointNormal", pointId: "p0", normal: { x: 0, y: 0, z: 2 } }, halfSize: 1 })
    const before = structuredClone(document)
    const report = reportFreeDegrees(document, [{ id: "d", type: "fixedDistance", targets: ["p0", "p1"], value: 1 }])
    expect(document).toEqual(before)
    // 平面的法向是显式参数（三个分量），点各三个：点法式平面按 3 个分量计数，
    // 其中"只有方向"这件事由有限差分自己判出来，不在这里手工扣。
    expect(report.totalDof).toBe(9)
  })
})

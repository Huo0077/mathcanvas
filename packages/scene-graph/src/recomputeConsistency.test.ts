import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { commitPatch, recomputeDerivedObjects } from "./index"
import type { DomainOperation } from "./index"

/**
 * **增量重算必须是全量重算的不动点。**
 *
 * `commitPatch` 走的是增量路径：只把本次改动的 id 交给 `recomputeDerivedObjects`，其余对象沿用旧值。
 * 只要有任何一条依赖边缺失（或者某个重算分支读了不在它依赖里的数据），增量结果就会**留下过期字段**，
 * 而"再全量重算一次"会把它改回去。上一轮用户报的"约束移动了，动点却留在原地"正是这一类：
 * 模板物化出来的面没有声明依赖所属实体，于是从实体出发的闭包到不了绑在那个面上的点。
 *
 * 所以这里不逐条猜依赖，而是对**每一种图元各造一次真实编辑**，然后断言：
 *
 *     commitPatch(文档, 操作).document  ==  recomputeDerivedObjects(上面那个结果)
 *
 * 等号右边是"全量重算"，不带 changedIds。两者不等就说明增量漏算了东西。
 */
/** 逐字段列出"全量重算改动了什么"：只报字段名与两侧取值，便于定位缺哪条依赖。 */
function diffPrimitives(before: GeometryDocument["primitives"], after: GeometryDocument["primitives"]): string[] {
  const differences: string[] = []
  const afterById = new Map(after.map((primitive) => [primitive.id, primitive]))
  for (const primitive of before) {
    const other = afterById.get(primitive.id) as Record<string, unknown> | undefined
    if (!other) { differences.push(`${primitive.id}: 全量重算把它删了`); continue }
    const left = primitive as unknown as Record<string, unknown>
    for (const key of new Set([...Object.keys(left), ...Object.keys(other)])) {
      const first = JSON.stringify(left[key])
      const second = JSON.stringify(other[key])
      if (first !== second) differences.push(`${primitive.id}.${key}: ${String(first).slice(0, 60)} → ${String(second).slice(0, 60)}`)
    }
  }
  const beforeIds = new Set(before.map((primitive) => primitive.id))
  for (const primitive of after) if (!beforeIds.has(primitive.id)) differences.push(`${primitive.id}: 全量重算把它加了出来`)
  return differences
}

function expectFixpoint(document: GeometryDocument, operation: DomainOperation, label: string) {
  const applied = commitPatch(document, operation)
  expect(applied.changed, `${label}: 操作没有被接受（${applied.error ?? "unchanged"}）`).toBe(true)
  const incremental = applied.document
  // 全量重算不能再改变任何东西：这就是"增量已经算全了"的判据。
  const settled = recomputeDerivedObjects(incremental)
  expect(diffPrimitives(incremental.primitives, settled.primitives), `${label}: 增量漏算了这些字段`).toEqual([])
}

/** 2D 场景：直线 + 圆 + 交点、函数 + 切线、动点（绑在圆上）+ 轨迹、两点 + 连线 + 长度测量 + 分组 + 曲线切线 + 动圆。 */
function planarDocument(): GeometryDocument {
  const document = createEmptyDocument("conics")
  const circle = { id: "circle-1", type: "circle" as const, center: { x: 0, y: 0 }, radius: 3 }
  document.primitives = [
    { id: "line-1", type: "line", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } },
    circle,
    { id: "point-a", type: "point", x: 3, y: 0, binding: { kind: "onPath", pathId: "circle-1", parameter: 0 } },
    { id: "point-b", type: "point", x: 4, y: 2 },
    { id: "conn-ab", type: "connection", kind: "segment", startPointId: "point-a", endPointId: "point-b" },
    { id: "locus-a", type: "locus", sourcePointId: "point-a", parameterId: "t-point-a", domain: [0, 6.28], samples: 24 },
    { id: "cross-1", type: "curveIntersection", objectA: "line-1", objectB: "circle-1", solutionIndex: 0, x: 3, y: 0 },
    { id: "fn-1", type: "function", expression: "x^2", domain: [-3, 3], samples: 32 },
    // 与 App 的「切线」入口同一份字段：切线由来源函数的重算算出来，不手写几何。
    { id: "tan-1", type: "tangent", sourceId: "fn-1", x: 0, point: { x: 0, y: 0 }, slope: 0, a: { x: -3, y: 0 }, b: { x: 3, y: 0 }, status: "approximate" },
    // 曲线切线（参数定位）："点一下曲线就能作切线"。
    { id: "tan-curve", type: "tangent", sourceId: "circle-1", x: 0, point: { x: 3, y: 0 }, slope: 0, a: { x: 3, y: -3 }, b: { x: 3, y: 3 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } },
    // 曲线切线（动点定位）：切点跟着动点走 —— 依赖边从这里来。
    { id: "tan-point", type: "tangent", sourceId: "circle-1", x: 3, point: { x: 3, y: 0 }, slope: 0, a: { x: 3, y: -3 }, b: { x: 3, y: 3 }, status: "approximate", anchor: { kind: "point", pointId: "point-a" } },
    // 以动点为圆心、半径随另一个动点变化的圆：两条新的依赖边（圆心点、驱动点）。
    { id: "circle-dyn", type: "circle", center: { x: 4, y: 2 }, radius: 1, centerPointId: "point-b", radiusFrom: { pointId: "point-a", factor: 1 } }
  ]
  document.parameters = { "t-point-a": { id: "t-point-a", value: 0, min: 0, max: 6.28, step: 0.05, label: "驱动 A", ownerId: "point-a" } }
  document.measurements = [{ id: "m-1", kind: "measurement3", metric: "length", sourceIds: ["point-a", "point-b"], value: 0, precision: "numeric-approximation", status: "valid", explanation: "两点距离" }]
  document.groups = [{ id: "group-1", members: ["point-a", "point-b"] }]
  return document
}

/** 3D 场景：立方体（物化拓扑）+ 绑在它面上的点 + 交线 / 交面 / 交点 + 截面 + 圆柱。 */
function spatialDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const cylinder = { id: "cyl-1", type: "cylinder" as const, center: { x: 0, y: 0, z: -1 }, radius: 1.5, height: 2, segments: 16 }
  const cubePrimitives = buildSolidTemplate(cube).primitives
  const cylinderPrimitives = buildSolidTemplate(cylinder).primitives
  const face = cubePrimitives.find((primitive) => primitive.type === "face3")
  if (face?.type !== "face3") throw new Error("expected the cube topology faces")
  document.primitives = [
    cube,
    ...cubePrimitives,
    cylinder,
    ...cylinderPrimitives,
    { id: "point-on-face", type: "point3", position: { x: 0, y: -2, z: 0 }, binding: { kind: "onFace", faceId: face.id, uv: [0.5, 0.5] } },
    { id: "section-1", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" },
    { id: "line-int", type: "intersectionLine", sourceIds: ["cube-1", "cyl-1"], segments: [], classification: "none", status: "degenerate" },
    { id: "face-int", type: "intersectionFace", sourceIds: ["cube-1", "cyl-1"], points: [], normal: { x: 0, y: 0, z: 0 }, area: 0, hint: { x: 0, y: 0, z: 0 }, status: "none" },
    { id: "point-int", type: "intersectionPoint3", sourceIds: ["cube-1", "cyl-1"], position: { x: 0, y: 0, z: 0 }, hint: { x: 0, y: 0, z: 0 }, status: "none" }
  ]
  return document
}

describe("incremental recompute is a fixpoint of the full recompute", () => {
  it("settles the fixtures first, so a stale hand-written field is not mistaken for a missing edge", () => {
    // 夹具先全量算一遍：之后任何一次"增量 vs 全量"的差异都只可能来自本次操作。
    for (const document of [planarDocument(), spatialDocument()]) {
      const settled = recomputeDerivedObjects(document)
      expect(diffPrimitives(settled.primitives, recomputeDerivedObjects(settled).primitives)).toEqual([])
    }
  })

  it("holds for every kind of planar edit", () => {
    const document = recomputeDerivedObjects(planarDocument())
    const cases: [string, DomainOperation][] = [
      ["拖直线本体", { op: "translatePrimitive", id: "line-1", delta: { x: 1, y: 2 } }],
      ["改直线端点", { op: "updatePrimitive", id: "line-1", patch: { a: { x: -4, y: 1 } } }],
      ["改圆半径", { op: "updatePrimitive", id: "circle-1", patch: { radius: 4 } }],
      ["平移圆", { op: "translatePrimitive", id: "circle-1", delta: { x: 2, y: 0 } }],
      ["拖动点", { op: "translatePrimitive", id: "point-b", delta: { x: -1, y: 3 } }],
      ["拖动绑定在圆上的动点", { op: "translatePrimitive", id: "point-a", delta: { x: 0.5, y: 1 } }],
      ["改驱动参数", { op: "setParameter", id: "t-point-a", value: 1.2 }],
      /**
       * 新增的动态链路各来一次编辑。这几条正是"缺一条依赖边就慢一帧 / 停住不动"的高危区：
       * 曲线切线的切点由动点定位、动圆的圆心与半径由两个点定位，任何一条边丢了都会被这里抓到。
       */
      ["滑动曲线切线的参数", { op: "updatePrimitive", id: "tan-curve", patch: { anchor: { kind: "parameter", parameter: 1.9 } } }],
      ["改切线长度", { op: "updatePrimitive", id: "tan-curve", patch: { halfLength: 5 } }],
      ["把切线改成动点定位", { op: "updatePrimitive", id: "tan-curve", patch: { anchor: { kind: "point", pointId: "point-b" } } }],
      ["移动切线的定位动点", { op: "translatePrimitive", id: "point-a", delta: { x: -1, y: 1 } }],
      ["拖动静止的切点锚点（自由点）", { op: "translatePrimitive", id: "point-b", delta: { x: 2, y: 1 } }],
      ["改动圆的半径倍率", { op: "updatePrimitive", id: "circle-dyn", patch: { radiusFrom: { pointId: "point-a", factor: 2.5 } } }],
      ["换动圆的圆心点", { op: "updatePrimitive", id: "circle-dyn", patch: { centerPointId: "point-a" } }],
      ["去掉动圆的半径规则", { op: "updatePrimitive", id: "circle-dyn", patch: { radiusFrom: null } }],
      ["改函数表达式", { op: "updatePrimitive", id: "fn-1", patch: { expression: "x^3" } }],
      ["隐藏图元", { op: "toggleVisibility", id: "point-b", visible: false }],
      ["删除连线", { op: "deleteObject", id: "conn-ab" }],
      ["删除动点（连带轨迹与它的切线）", { op: "deleteObject", id: "point-a" }],
      ["新增点", { op: "addPrimitive", primitive: { id: "point-c", type: "point", x: 1, y: 1 } }]
    ]
    for (const [label, operation] of cases) expectFixpoint(document, operation, label)
  })

  it("holds for every kind of spatial edit", () => {
    const document = recomputeDerivedObjects(spatialDocument())
    const cubeTopology = document.primitives.find((primitive) => primitive.type === "polyhedron3")
    if (cubeTopology?.type !== "polyhedron3") throw new Error("expected the cube topology")
    const boundPoint = document.primitives.find((primitive) => primitive.id === "point-on-face")
    if (boundPoint?.type !== "point3" || boundPoint.binding?.kind !== "onFace") throw new Error("expected the bound point")
    const cases: [string, DomainOperation][] = [
      ["移动立方体", { op: "translatePrimitive3", id: "cube-1", delta: { x: 1, y: 0, z: 2 } }],
      ["改立方体原点", { op: "updatePrimitive", id: "cube-1", patch: { origin3: { x: -1, y: -2, z: -2 } } }],
      ["改圆柱半径", { op: "updatePrimitive", id: "cyl-1", patch: { radius3: 2 } }],
      ["移动圆柱", { op: "translatePrimitive3", id: "cyl-1", delta: { x: 0, y: 0, z: 1 } }],
      ["改绑定点参数（面上 uv）", { op: "updatePrimitive", id: "point-on-face", patch: { binding3: { ...boundPoint.binding, uv: [0.25, 0.75] } } }],
      ["平移剖切面", { op: "moveSectionPlane", id: "section-1", distance: 0.5 }],
      ["旋转剖切面", { op: "rotateSectionPlane", id: "section-1", axis: "x", degrees: 15 }],
      ["删除圆柱（连带交线 / 交面 / 交点）", { op: "deleteObject", id: "cyl-1" }],
      ["删除截面来源", { op: "deleteObject", id: "cube-1" }]
    ]
    for (const [label, operation] of cases) expectFixpoint(document, operation, label)

    /**
     * **"按数值改模板顶点"现在被拒**（Fix round 1，Recompute/Store 缺陷）。
     *
     * 这条曾经是 fixpoint 用例的一员：改一个立方体顶点会让拓扑翻成 `fromFaces`，
     * 而翻转之后的四个面**不再共面**（一个"扭过的四边形"）—— 文档于是 schema 非法。
     * 旧行为是"照收不误"：界面更新、磁盘上还是旧的（保存时 `encodeMgeo` 报错又被吞掉）。
     * 现在 `commitPatch` 在提交前校验整份文档，所以这笔改动**被明确拒绝**。
     */
    const refused = commitPatch(document, { op: "updatePrimitive", id: cubeTopology.vertexIds[0], patch: { position3: { x: -3, y: -2, z: -2 } } })
    expect(refused.changed).toBe(false)
    expect(refused.error).toContain("face3 points are not coplanar")
    expect(refused.document).toBe(document)
  })
})

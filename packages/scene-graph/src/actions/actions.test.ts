import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * Task 0.5 的**回调 → handler → 测试**对照表（计划 Step 1）。
 *
 * 表里每一行都是"手工 UI 里确实存在的一个回调"，handler 是它的共用实现，
 * 最后一列是覆盖它的用例。**手工按钮与 Agent 必须走同一份 handler**（设计规格 §7.4），
 * 所以这张表也是"还有哪些回调没被抽出来"的清单。
 *
 * | 手工回调（App / PropertiesBar） | handler（`actions/`） | 覆盖用例 |
 * | --- | --- | --- |
 * | 添加点 / 添加直线…（`addPoint`、`startCreation`） | `planar.create_point` 等 | `planar family` 两条 |
 * | 添加立方体 / 棱锥 / 圆柱 / 圆锥（`addDefaultCube`、`addDefaultSolid`） | `solid.create_template` | `solid family` 两条 |
 * | 删除选中（`deleteSelected`） | `object.delete_many` | `object family` 两条 |
 * | 属性栏改名 / 显隐等（`updatePrimitive`） | `object.update_inputs` | `object family` 一条 |
 * | 绑定动点到宿主（`bindPointToHost`） | `dynamic.bind_point` | `dynamic family` 两条 |
 * | 在点处作切线（`addPointTangent`） | `function.create_tangent` | `dynamic family` 一条 |
 * | 建截面（`addSection`） | `section.create` | `section family` 两条 |
 * | 物化截面（`materializeSelectedSection`） | `section.materialize` | `section family` 一条 |
 * | 导数 / 切线 / 积分（`addFunctionAnalysis`） | `function.analyze` | `families` 三条 |
 * | 曲线切线 + 跟随动点（`addCurveTangent`、`addPointTangent`） | `function.create_tangent`（`anchor`） | `families` 三条 |
 * | 点到曲线绑定（`PropertiesBar` 的路径绑定） | `dynamic.bind_curve` | `families` 三条 |
 * | 半径随动点变化（半径驱动点选择） | `dynamic.set_radius_rule` | `families` 两条 |
 * | 参数值 / 参数表达式（参数分组） | `parameter.set` / `parameter.set_expression` | `families` 三条 |
 *
 * 仍未抽出（后续批次）：相交预览持久化、CAD 来源与导出提议、`style.set` 批量样式、
 * `dynamic.anchor_rotation`（动圆绕定点旋转）—— 见进度文档的 G0 第三批记录。
 */

/** 幂等分配器：同一 alias 永远拿同一个 id（重试安全）。 */
function makeAllocator(): IdAllocator {
  const known = new Map<string, string>()
  let counter = 0
  return {
    allocate(kind, alias) {
      const key = `${kind}:${alias}`
      const existing = known.get(key)
      if (existing) return existing
      counter += 1
      const id = `${kind}-${counter}`
      known.set(key, id)
      return id
    }
  }
}

function contextWith(document = createEmptyDocument("conics"), orderedSelection: string[] = []): ActionContext {
  return { targetDocument: document, targetWorkspace: document.workspace, orderedSelection, capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

function point3Document() {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "point3-1", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A" },
    { id: "point3-2", type: "point3", position: { x: 2, y: 0, z: 0 }, label: "B" }
  ]
  return document
}

function action(partial: Record<string, unknown>): DraftAction {
  // 判别联合无法从部分字段构造，测试里统一走 `unknown` 中转（生产代码不需要这种构造）。
  return { actionKey: "k1", factIds: [], ...partial } as unknown as DraftAction
}

describe("action compiler", () => {
  it("never mutates the input document", () => {
    const document = createEmptyDocument("conics")
    const before = JSON.stringify(document)

    compileActions(document, [action({ actionId: "planar.create_point", inputs: { alias: "a", points: [{ x: 1, y: 2 }] } })], contextWith(document))

    expect(JSON.stringify(document)).toBe(before)
  })

  it("mints stable ids so retrying the same draft does not duplicate objects", () => {
    const document = createEmptyDocument("conics")
    const context = contextWith(document)
    const actions = [action({ actionId: "planar.create_point", inputs: { alias: "a", points: [{ x: 1, y: 2 }] } })]

    const first = compileActions(document, actions, context)
    const second = compileActions(document, actions, context)

    expect(first.operations).toHaveLength(1)
    // 同一个 allocator 上重试：id 必须一致，否则重试会在文档里留下两个点。
    expect(second.operations[0]).toEqual(first.operations[0])
    expect(first.aliasToId.a).toBe("point-1")
  })
})

describe("planar family", () => {
  it("creates a point from an alias", () => {
    const document = createEmptyDocument("conics")
    const result = compileActions(document, [action({ actionId: "planar.create_point", inputs: { alias: "a", points: [{ x: 3, y: 4 }] } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toEqual([{ op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 3, y: 4 } }])
  })

  it("refuses a line with fewer than two distinct points", () => {
    const document = createEmptyDocument("conics")
    const result = compileActions(document, [action({ actionId: "planar.create_line", inputs: { alias: "l", points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("degenerate_line")
  })

  it("refuses a circle without a positive finite radius", () => {
    const document = createEmptyDocument("conics")
    const result = compileActions(document, [action({ actionId: "planar.create_circle", inputs: { alias: "c", center: { x: 0, y: 0 }, radius: 0 } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("invalid_radius")
  })
})

describe("solid family", () => {
  it("creates a cube template in the solid workspace", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [action({ actionId: "solid.create_template", inputs: { alias: "s", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]).toMatchObject({ op: "addPrimitive", primitive: { id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } })
  })

  it("creates a pyramid as base-center plus base-size plus height, not as a cube", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [action({ actionId: "solid.create_template", inputs: { alias: "p", template: "pyramid", origin: { x: 1, y: 2, z: 0 }, size: { x: 4, y: 4, z: 6 } } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toHaveLength(1)
    const primitive = result.operations.flatMap((entry) => (entry.op === "addPrimitive" ? [entry.primitive] : []))[0]
    /**
     * 棱锥与立方体**不共用形状**：`@draw/dsl` 的文档 schema 对棱锥要求 `baseCenter` / `baseSize` / `height`，
     * 对立方体要求 `origin` / `size`（内核 `solid-builders.ts` 与手工路径 `App.tsx` 的 `addDefaultSolid` 也一样）。
     * 这条用例就是钉住"动作层 → 文档层"这一次翻译：以前两支走同一条，于是 Agent 造的每个棱锥都带着立方体的形状
     * 进提交，被校验判成 `pyramid geometry is invalid`，整轮 `run_failed`。
     */
    expect(primitive).toMatchObject({ id: "solid-1", type: "pyramid", baseCenter: { x: 1, y: 2, z: 0 }, baseSize: { x: 4, y: 4 }, height: 6 })
    // 也不许把立方体那套键一起带上：文档里多两个没人读的键，下一个人会以为它有意义。
    expect(Object.keys(primitive).sort()).toEqual(["baseCenter", "baseSize", "height", "id", "type"])
  })

  /**
   * **正四面体**（用户口径："画一个正四面体 ABCD，棱长为 3"）。
   *
   * 它既不是棱柱也不是四棱锥：四个顶点、六条等长棱、四个三角面。这条用例钉住形状、子对象 id 与
   * **顶点标签** —— 用户看到的、对象列表里写的，就是 A / B / C / D。
   */
  it("creates a tetrahedron with four vertices, six edges and four triangular faces", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [action({ actionId: "solid.create_tetrahedron", inputs: { alias: "t", baseCenter: { x: 0, y: 0, z: 0 }, edge: 3 } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    const added = result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? [entry.primitives] : []))
    expect(added).toHaveLength(1)
    const primitives = added[0]
    const vertices = primitives.filter((primitive) => primitive.type === "point3")
    expect(vertices.map((primitive) => primitive.id)).toEqual(["solid-1:v0", "solid-1:v1", "solid-1:v2", "solid-1:v3"])
    expect(vertices.map((primitive) => (primitive.type === "point3" ? primitive.label : undefined))).toEqual(["A", "B", "C", "D"])
    expect(primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(6)
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(4)
    // 别名指向那只多面体，而那只多面体的 id 就是动作分配出来的 id。
    expect(primitives.find((primitive) => primitive.type === "polyhedron3")).toMatchObject({ id: "solid-1", vertexIds: ["solid-1:v0", "solid-1:v1", "solid-1:v2", "solid-1:v3"] })
  })

  it("refuses a tetrahedron outside the solid workspace", () => {
    const document = createEmptyDocument("conics")
    const result = compileActions(document, [action({ actionId: "solid.create_tetrahedron", inputs: { alias: "t", baseCenter: { x: 0, y: 0, z: 0 }, edge: 3 } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("workspace_mismatch")
  })

  /**
   * **正 N 棱锥**（第 1 层：一个构造器 + 一个参数，而不是一个形状一个动作）。
   *
   * 判据：顶点 N+1、棱 2N（N 条底边 + N 条侧棱）、面 N+1（1 底面 + N 侧面）；
   * 标签按顶点序给 A…F（底面五个 A–E，顶点 F）；别名指向那只多面体。
   */
  it("creates a regular pentagonal pyramid from one action and four numbers", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [action({ actionId: "solid.create_regular_pyramid", inputs: { alias: "p", baseCenter: { x: 0, y: 0, z: 0 }, sides: 5, radius: 2, height: 3 } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    const added = result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? [entry.primitives] : []))
    expect(added).toHaveLength(1)
    const primitives = added[0]
    const vertices = primitives.filter((primitive) => primitive.type === "point3")
    expect(vertices.map((primitive) => primitive.id)).toEqual(["solid-1:v0", "solid-1:v1", "solid-1:v2", "solid-1:v3", "solid-1:v4", "solid-1:v5"])
    expect(vertices.map((primitive) => (primitive.type === "point3" ? primitive.label : undefined))).toEqual(["A", "B", "C", "D", "E", "F"])
    expect(primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(10)
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(6)
    expect(primitives.find((primitive) => primitive.type === "polyhedron3")).toMatchObject({ id: "solid-1" })
  })

  it("refuses a regular pyramid with two sides or a flat height", () => {
    const document = createEmptyDocument("geometry3d")
    for (const inputs of [
      { alias: "p", baseCenter: { x: 0, y: 0, z: 0 }, sides: 2, radius: 2, height: 3 },
      { alias: "p", baseCenter: { x: 0, y: 0, z: 0 }, sides: 5, radius: 0, height: 3 },
      { alias: "p", baseCenter: { x: 0, y: 0, z: 0 }, sides: 5, radius: 2, height: 0 }
    ]) {
      const result = compileActions(document, [action({ actionId: "solid.create_regular_pyramid", inputs })], contextWith(document))
      expect(result.operations, `sides=${inputs.sides} radius=${inputs.radius} height=${inputs.height}`).toHaveLength(0)
      expect(result.diagnostics.length).toBeGreaterThan(0)
    }
  })

  /**
   * **任意多面体**（第 2 层：顶点 + 面环）—— 不规则图形的**唯一通用入口**。
   *
   * 夹具用正八面体（6 顶点 / 12 棱 / 8 个三角面）：它既不是棱柱、也不是任何棱锥，正是"题面直接给了坐标"
   * 的那一类。断言落进文档的是 `fromPoints` 构造的那只多面体 + 一整族子对象。
   */
  it("creates an arbitrary polyhedron from vertices and face rings", () => {
    const document = createEmptyDocument("geometry3d")
    const vertices = [
      { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
    ]
    // 绕向一致（每个面都从外侧看逆时针）—— 内核的 `inconsistent-winding` 会检查这件事。
    const faces = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]
    const result = compileActions(document, [action({ actionId: "solid.create_polyhedron", inputs: { alias: "octa", vertices, faces } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    const added = result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? [entry.primitives] : []))
    expect(added).toHaveLength(1)
    const primitives = added[0]
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(6)
    expect(primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(12)
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(8)
    expect(primitives.find((primitive) => primitive.type === "polyhedron3")).toMatchObject({ id: "solid-1", construction: { kind: "fromPoints" } })
  })

  it("refuses a polyhedron whose face rings cannot make a solid", () => {
    const document = createEmptyDocument("geometry3d")
    const vertices = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
    // 只有两个面：内核的"至少四个面"会拒 —— 而且**一条操作都不产出**。
    const result = compileActions(document, [action({ actionId: "solid.create_polyhedron", inputs: { alias: "bad", vertices, faces: [[0, 1, 2], [0, 1, 3]] } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it("refuses a flat or negative-sized cube instead of fabricating a solid", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [action({ actionId: "solid.create_template", inputs: { alias: "s", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 0 } } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("invalid_size")
  })

  it("refuses a cube in the planar workspace", () => {
    const document = createEmptyDocument("conics")
    const result = compileActions(document, [action({ actionId: "solid.create_template", inputs: { alias: "s", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("workspace_mismatch")
  })
})

describe("dynamic family", () => {
  it("binds a spatial point to a host with an explicit parameter", () => {
    const document = point3Document()
    const result = compileActions(document, [action({
      actionId: "dynamic.bind_point",
      inputs: { target: { documentId: document.metadata.id, entityId: "point3-1" }, host: { documentId: document.metadata.id, entityId: "point3-2" }, parameter: 0.5 }
    })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toEqual([{ op: "updatePrimitive", id: "point3-1", patch: { binding3: { kind: "onHost", hostId: "point3-2", parameter: 0.5 } } }])
  })

  it("refuses a binding whose target does not exist", () => {
    const document = point3Document()
    const result = compileActions(document, [action({
      actionId: "dynamic.bind_point",
      inputs: { target: { documentId: document.metadata.id, entityId: "missing" }, host: { documentId: document.metadata.id, entityId: "point3-2" } }
    })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("target_not_found")
  })

  it("refuses a binding that reaches across documents", () => {
    const document = point3Document()
    const result = compileActions(document, [action({
      actionId: "dynamic.bind_point",
      inputs: { target: { documentId: document.metadata.id, entityId: "point3-1" }, host: { documentId: "another-document", entityId: "point3-2" } }
    })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("cross_document_reference")
  })
})

describe("section family", () => {
  /**
   * **平面必须显式给出**（Fix round 1 / M8）。
   *
   * 旧期望：不给 `plane` 时动作层默默取 `z = 0`（`{ normal: {0,0,1}, constant: 0 }`）——
   * 而"过一点有无数个平面"，替调用方挑一个等于换了一道题（审计层早就会去问用户）。
   * 新期望：缺平面在动作层也失败，错误码与审计层一致（`missing_field`）。
   */
  it("creates a section through a selected solid when the plane is given", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }]
    const result = compileActions(document, [action({ actionId: "section.create", inputs: { alias: "cut", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1 } } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations[0]).toMatchObject({ op: "addPrimitive", primitive: { id: "section-1", type: "section", sourceId: "cube-1" } })
  })

  it("refuses a section without a cutting plane instead of silently cutting at z = 0", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }]
    const result = compileActions(document, [action({ actionId: "section.create", inputs: { alias: "cut", sourceId: "cube-1" } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("missing_field")
  })

  it("refuses a section whose source is not a solid", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "point3-1", type: "point3", position: { x: 0, y: 0, z: 0 } }]
    const result = compileActions(document, [action({ actionId: "section.create", inputs: { alias: "cut", sourceId: "point3-1" } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("source_not_solid")
  })
})

describe("object family", () => {
  it("deletes a batch as one union", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "point-1", type: "point", x: 0, y: 0 },
      { id: "point-2", type: "point", x: 1, y: 0 }
    ]
    const result = compileActions(document, [action({ actionId: "object.delete_many", inputs: { targets: ["point-2", "point-1"] } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    // 一整批一个操作：顺序无关由 deleteObjects 保证。
    expect(result.operations).toEqual([{ op: "deleteObjects", ids: ["point-2", "point-1"] }])
  })

  it("refuses an empty delete batch", () => {
    const document = createEmptyDocument("conics")
    const result = compileActions(document, [action({ actionId: "object.delete_many", inputs: { targets: [] } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("empty_batch")
  })

  it("updates a registered input field but refuses an unknown one", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "point-1", type: "point", x: 0, y: 0 }]

    const ok = compileActions(document, [action({ actionId: "object.update_inputs", inputs: { target: { documentId: document.metadata.id, entityId: "point-1" }, patch: { label: "B" } } })], contextWith(document))
    expect(ok.operations).toEqual([{ op: "updatePrimitive", id: "point-1", patch: { label: "B" } }])

    const bad = compileActions(document, [action({ actionId: "object.update_inputs", inputs: { target: { documentId: document.metadata.id, entityId: "point-1" }, patch: { area: 12 } } })], contextWith(document))
    expect(bad.operations).toHaveLength(0)
    expect(bad.diagnostics[0].code).toBe("unregistered_input")
  })
})

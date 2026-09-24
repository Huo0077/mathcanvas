import { createEmptyDocument } from "@draw/dsl"
import { DEFAULT_SOLID_SEGMENTS, templateSolidPivot } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { commitPatch } from "../patches"
import { compileActions, compileTemplateSolid } from "./index"
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
    // 一族对象走**一条** addPrimitives：一步撤销、整族一起走（与手工按钮同序）。
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]).toMatchObject({ op: "addPrimitives" })
    const added = result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? [entry.primitives] : []))[0]
    expect(added[0]).toMatchObject({ id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } })
    // 模板后面跟着整族物化拓扑：8 顶点 / 12 棱 / 6 面 + 那只 polyhedron3。
    expect(added.filter((primitive) => primitive.type === "point3")).toHaveLength(8)
    expect(added.filter((primitive) => primitive.type === "edge3")).toHaveLength(12)
    expect(added.filter((primitive) => primitive.type === "face3")).toHaveLength(6)
    expect(added.filter((primitive) => primitive.type === "polyhedron3")).toHaveLength(1)
  })

  it("creates a pyramid as base-center plus base-size plus height, not as a cube", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [action({ actionId: "solid.create_template", inputs: { alias: "p", template: "pyramid", origin: { x: 1, y: 2, z: 0 }, size: { x: 4, y: 4, z: 6 } } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toHaveLength(1)
    const primitive = result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? [entry.primitives] : [])).flat().find((candidate) => candidate.type === "pyramid")
    /**
     * 棱锥与立方体**不共用形状**：`@draw/dsl` 的文档 schema 对棱锥要求 `baseCenter` / `baseSize` / `height`，
     * 对立方体要求 `origin` / `size`（内核 `solid-builders.ts` 与手工路径 `App.tsx` 的 `addDefaultSolid` 也一样）。
     * 这条用例就是钉住"动作层 → 文档层"这一次翻译：以前两支走同一条，于是 Agent 造的每个棱锥都带着立方体的形状
     * 进提交，被校验判成 `pyramid geometry is invalid`，整轮 `run_failed`。
     */
    expect(primitive).toMatchObject({ id: "solid-1", type: "pyramid", baseCenter: { x: 1, y: 2, z: 0 }, baseSize: { x: 4, y: 4 }, height: 6 })
    // 也不许把立方体那套键一起带上：文档里多两个没人读的键，下一个人会以为它有意义。
    expect(Object.keys(primitive!).sort()).toEqual(["baseCenter", "baseSize", "height", "id", "type"])
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

  /**
   * **Agent 造的模板实体必须与手工造的是同一种东西**
   *（用户现场：`docs/project-progress.md` 的「Agent 造的实体改「朝向」画布不动」一节）。
   *
   * 现场是：Agent 建了立方体，属性栏把 `rotation.x` 从 0 改到 45°，文档值确实变成 ≈0.785398，
   * 而三维画面逐字节不变；改尺寸却能看到变化。根因是模板实体的**两条构造路径**：
   * 手工按钮一次落盘"模板 + 物化拓扑"，`solid.create_template` 却只落盘那一只模板图元。
   * 没有 `polyhedron3` 拓扑时，渲染落到"直接画模板"的分支，而那条分支读尺寸与位置、
   * **不读 `rotation`** —— 于是"值改了，画布不动"。
   *
   * 这条用例把两件事一起钉住：①动作编译产出整族子对象；②改朝向之后**物化顶点真的跟着转**。
   */
  it("materialises the template topology so a later rotation actually moves the vertices", () => {
    const document = createEmptyDocument("geometry3d")
    const compiled = compileActions(document, [action({ actionId: "solid.create_template", inputs: { alias: "c", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } })], contextWith(document))
    expect(compiled.diagnostics).toEqual([])
    const added = compiled.operations.flatMap((entry) => (entry.op === "addPrimitives" ? [entry.primitives] : []))
    expect(added).toHaveLength(1)
    const primitives = added[0]
    // 立方体：8 顶点 / 12 棱 / 6 面，外加那只物化出来的 polyhedron3 自己。
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(8)
    expect(primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(12)
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(6)
    /**
     * 子对象 id 由**内核的默认上下文**给（`<solidId>-point-1` 这一类），而**不是**动作层另发明一套
     *（`<solidId>:v0`）。这不是风格问题：`operations.ts` 的 `syncTemplateTopology` 在模板参数变化时
     * 用同一个默认上下文重算顶点坐标，再**按 id 回填**。两套命名一旦分叉，顶点就永远回填不上，
     * 表现就是用户现场那句"值改了、画布不动"。
     */
    const polyhedron = primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(polyhedron).toMatchObject({ construction: { kind: "template", templateId: "cube" } })
    /**
     * `construction` 是判别联合（`template` / `fromPoints` / `fromFaces` / `prism`…），只有带 `sourceIds`
     * 的那几支才有这个字段 —— 所以先按 `kind` 收窄一次，不靠非空断言硬穿过去。
     * 断言的内容是"整族子对象都登记在来源里"，`syncTemplateTopology` 正是靠它把一次编辑认成
     * "这篇模板脏了"（`dirty.has(id)`），漏了模板自己就等于永不重算。
     */
    const construction = polyhedron?.type === "polyhedron3" ? polyhedron.construction : undefined
    expect(construction?.kind === "template" ? construction.sourceIds : []).toContain("solid-1")
    // 多面体与模板图元必须是**两个不同**的 id：同名会在 `addPrimitives` 里撞成 duplicate object id。
    expect(polyhedron?.id).not.toBe("solid-1")
    expect(primitives.filter((primitive) => primitive.type === "polyhedron3").every((primitive) => primitives.filter((candidate) => candidate.id === primitive.id).length === 1)).toBe(true)

    const committed = commitPatch(document, { op: "addPrimitives", primitives })
    expect(committed.error).toBeUndefined()
    expect(committed.changed).toBe(true)
    // 模板图元自己也在文档里：手工路径一直如此（`App.tsx` 的 `addSolidTemplate`），Agent 路径不许例外。
    expect(committed.document.primitives.some((primitive) => primitive.id === "solid-1" && primitive.type === "cube")).toBe(true)

    const rotation = { x: 0, y: 0, z: Math.PI / 4 }
    const turned = commitPatch(committed.document, { op: "updatePrimitive", id: "solid-1", patch: { rotation3: rotation } })
    expect(turned.error).toBeUndefined()
    expect(turned.changed).toBe(true)

    const pivot = templateSolidPivot({ id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } })
    const before = primitives.flatMap((primitive) => (primitive.type === "point3" ? [primitive.position] : []))
    const after = turned.document.primitives.filter((primitive) => primitive.type === "point3").map((primitive) => (primitive.type === "point3" ? primitive.position : { x: 0, y: 0, z: 0 }))
    expect(after).toHaveLength(8)
    // 逐顶点比对"绕模板中心转 45°"的解析值：这正是渲染与测量读的那份坐标。
    after.forEach((position, index) => {
      const source = before[index]
      const dx = source.x - pivot.x
      const dy = source.y - pivot.y
      expect(position.x).toBeCloseTo(dx * Math.cos(rotation.z) - dy * Math.sin(rotation.z) + pivot.x, 9)
      expect(position.y).toBeCloseTo(dx * Math.sin(rotation.z) + dy * Math.cos(rotation.z) + pivot.y, 9)
      expect(position.z).toBeCloseTo(source.z, 9)
    })
    // 至少有两个顶点的水平坐标真的动了 —— 否则上面那组等式可能对一份"没转"的坐标也成立。
    expect(after.some((position, index) => Math.abs(position.x - before[index].x) > 1e-6 || Math.abs(position.y - before[index].y) > 1e-6)).toBe(true)
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

  /**
   * **手工入口与 Agent 动作必须落盘同一种东西**（评审方案 1 的验收标准原话：
   * "Agent 和手工分别创建同参数的立方体、棱锥、圆柱、圆锥，文档中均有实体与对应拓扑，
   * 数量与引用关系一致"）。
   *
   * 这条判据此前**没有被直接测过**：已有的用例分别检查"动作编译产出什么"和"手工路径由
   * `compileTemplateSolid` 构造"，但**没有任何一条把两条路的产物放在一起比**。
   * 而 P0 之后两条路的成功判据其实只有一条可操作的形式 —— **同参数必须产出逐字节相同的文档**：
   * id 序列、子对象数量、拓扑引用、标签、`construction.sourceIds` 全都要对得上，
   * 而不只是"都能画出个立方体"。
   *
   * 手工路径的真实形状见 `App.tsx` 的 `addSolidTemplate`：
   * `compileTemplateSolid(primitive.id, primitive)` 之后 `addPrimitives([primitive, ...result.primitives])`。
   * 下面逐字复刻这两步（id 由夹具的分配器给，与手工的 `nextPrimitiveId` 同为 `solid-1`）。
   */
  const templateCases = [
    { name: "cube", primitive: { id: "solid-1", type: "cube", origin: { x: -7, y: 3, z: 0 }, size: { x: 4, y: 4, z: 2 } }, inputs: { template: "cube", origin: { x: -7, y: 3, z: 0 }, size: { x: 4, y: 4, z: 2 } } },
    { name: "pyramid", primitive: { id: "solid-1", type: "pyramid", baseCenter: { x: 5, y: 5, z: 0 }, baseSize: { x: 4, y: 4 }, height: 4 }, inputs: { template: "pyramid", origin: { x: 5, y: 5, z: 0 }, size: { x: 4, y: 4, z: 4 } } },
    { name: "cylinder", primitive: { id: "solid-1", type: "cylinder", center: { x: 5, y: -5, z: 0 }, radius: 1.5, height: 3, segments: DEFAULT_SOLID_SEGMENTS }, inputs: { template: "cylinder", origin: { x: 5, y: -5, z: 0 }, radius: 1.5, height: 3 } },
    { name: "cone", primitive: { id: "solid-1", type: "cone", center: { x: -5, y: -5, z: 0 }, radius: 1.5, height: 3, segments: DEFAULT_SOLID_SEGMENTS }, inputs: { template: "cone", origin: { x: -5, y: -5, z: 0 }, radius: 1.5, height: 3 } }
  ] as const

  it.each(templateCases)("materialises $name identically through the manual and the agent path", (testCase) => {
    // 手工：App.tsx 的 `addSolidTemplate` 两步。
    const manual = compileTemplateSolid(testCase.primitive.id, testCase.primitive as never)
    expect(manual.diagnostics).toEqual([])
    const manualPrimitives = [testCase.primitive, ...manual.primitives]

    // Agent：`solid.create_template` 编译出的那一批。
    const agentContext = contextWith(createEmptyDocument("geometry3d"))
    const agent = compileActions(
      agentContext.targetDocument,
      [action({ actionId: "solid.create_template", inputs: { alias: "s", ...testCase.inputs } })],
      agentContext
    )
    expect(agent.diagnostics).toEqual([])
    const agentPrimitives = agent.operations.flatMap((entry) => (entry.op === "addPrimitives" ? [entry.primitives] : [])).flat()

    /**
     * **逐字节相同**，而不只是"都能画出来"。
     *
     * 子对象 id 由内核的默认上下文按 `<solidId>-<kind>-<n>` 生成，两边必然一致 —— 但这条用例的价值
     * 正在于**它会因为"某一侧换了命名或漏了某一族"而红**：那正是 P0 之前的状态
     *（只在动作侧落盘模板图元、没有拓扑）。
     */
    expect(agentPrimitives).toEqual(manualPrimitives)

    // 顺带把"数量与引用关系一致"这件事说成人能读的话：两边的 `polyhedron3` 引用同一批子对象 id。
    const polyhedronOf = (primitives: readonly { type: string }[]) => primitives.find((primitive) => primitive.type === "polyhedron3") as { vertexIds: string[]; edgeIds: string[]; faceIds: string[] } | undefined
    expect(polyhedronOf(agentPrimitives)).toEqual(polyhedronOf(manualPrimitives))
    expect(polyhedronOf(agentPrimitives)?.vertexIds.length).toBeGreaterThan(0)
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

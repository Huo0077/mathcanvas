import type { GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { buildFromPoints, buildPrismTopology, buildSolidTemplate, DEFAULT_SOLID_SEGMENTS, prismEdgeLabel, prismPointLabel, regularPyramidShape, regularTetrahedronShape, templateEdgeLabel, templatePointLabel, validatePrismInput, type BuilderContext, type SolidBuildResult, type TemplateSolidPrimitive } from "@draw/geometry-kernel"

import type { DomainOperation } from "../operations"
import type { ActionContext, ActionDiagnostic, CompileResult, DraftAction, IdAllocator } from "./types"

// 动作层的类型契约对外可见：草稿存储（`draftStore`）与 Agent 适配器都要引用它们。
export type { ActionContext, ActionDiagnostic, CompileResult, DraftAction, DraftActionId, IdAllocator } from "./types"

/**
 * **动作编译器**（Task 0.5）。设计规格 §7.4 的约束是这道实现的核心：
 * "手工按钮调用相同编译器/DocumentService；不复制一份 Agent 专用语义。"
 *
 * 三条纪律：
 * 1. **不改输入文档** —— 只产出 `DomainOperation[]`，由 `commitTransaction` 执行；
 * 2. **id 由分配器给**，分配器按别名幂等 —— 重试同一草稿不会在文档里留下两个对象；
 * 3. 前置条件不成立时给**可读的诊断码**，而不是抛异常 —— 模型据此还能修一次（设计规格 L990）。
 */

function diagnostic(actionKey: string, code: string, message: string): ActionDiagnostic {
  return { actionKey, code, message }
}

/**
 * 幂等分配器工厂：同一个 `(kind, alias)` 永远得到同一个 id，且**绝不发出已被占用的 id**。
 *
 * `taken` 是目标文档里**已经存在**的 id（`primitives` 的 id）。少了这一步，计数器会从 1
 * 重新数起 —— 在一个已经有 `solid-1` 的画布上，Agent 新建的第一个立体又被分配成 `solid-1`，
 * `validatePatch` 判 `duplicate object id`，整轮运行以 `compile_failed` 结束
 * （真实现场：账本 `run-6-mubf109e`，见 `draftStore.test.ts` 同名用例）。
 *
 * 手工路径的 `nextPrimitiveId`（`App.tsx`）一直是"扫已有 id 取下一个空位"，这里与它对齐：
 * 分配器不该是"第二份、更弱的一份" id 规则。占用集**允许稀疏**（`point-1`、`point-3` 都占着）。
 */
export function createIdAllocator(taken: Iterable<string> = []): IdAllocator {
  const known = new Map<string, string>()
  const counters = new Map<string, number>()
  const used = new Set<string>(taken)
  return {
    allocate(kind, alias) {
      const key = `${kind}\u0000${alias}`
      const existing = known.get(key)
      if (existing !== undefined) return existing
      let next = counters.get(kind) ?? 0
      let id = `${kind}-${next + 1}`
      while (used.has(id)) {
        next += 1
        id = `${kind}-${next + 1}`
      }
      counters.set(kind, next + 1)
      known.set(key, id)
      // 已经发出去的 id 也进占用集：跨 kind 的重名（若将来出现）同样不该撞。
      used.add(id)
      return id
    }
  }
}

function findPrimitive(document: GeometryDocument, id: string): PrimitiveSpec | undefined {
  return document.primitives.find((primitive) => primitive.id === id)
}

function isFinitePoint(point: { x: number; y: number } | undefined): point is { x: number; y: number } {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y)
}

const SOLID_TYPES = new Set(["cube", "pyramid", "cylinder", "cone", "polyhedron3"])

/** 允许通过动作层修改的字段白名单（§7.3 的"几何只改注册输入字段"）。 */
const UPDATABLE_INPUT_FIELDS = new Set(["label", "visible", "locked", "x", "y", "radius", "expression", "stroke", "fill", "strokeWidth", "opacity"])

/**
 * **同一份白名单的对外出口**（Fix round 1 / I14）。
 *
 * 传输层（`@draw/agent-core` 的 `schemas.ts`）曾经自己手抄了一份**更窄**的列表，
 * 于是模型合法地"把点挪到 (1,2)"会被 `unknown_field` 拒绝，并浪费掉唯一一次修复 ——
 * 正是 `schemas.ts` 头注释警告的"两份真源必然分叉"。白名单只有这一份，两边都读它。
 */
export function updatableInputFields(): readonly string[] {
  return [...UPDATABLE_INPUT_FIELDS]
}

// ---------------------------------------------------------------- 各族 handler

/**
 * 平面创建的七个动作（**不含** `planar.create_conic`：圆锥曲线的字段与它们完全不同，
 * 硬塞进同一套 `points` / `center` / `radius` 判别式只会让两边都失去类型约束）。
 */
type PlanarCreateActionId =
  | "planar.create_point"
  | "planar.create_line"
  | "planar.create_segment"
  | "planar.create_ray"
  | "planar.create_polyline"
  | "planar.create_circle"
  | "planar.create_arc"

function compilePlanar(action: Extract<DraftAction, { actionId: PlanarCreateActionId }>, context: ActionContext): CompileResult {
  const { actionKey, actionId } = action
  const inputs = action.inputs
  const pointKind = actionId === "planar.create_point" ? "point" : undefined
  /**
   * **标签要带进图元**（Fix round 1 / M18）：白名单收了 `label`，而这里以前把它丢掉 ——
   * 模型以为给对象起了名字，上线之后名字静默消失。立体与圆锥曲线分支一直是带的，平面族漏了。
   */
  const label = inputs.label === undefined ? {} : { label: inputs.label }

  if (pointKind) {
    const first = inputs.points?.[0]
    if (!isFinitePoint(first)) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "a point needs finite x and y")], aliasToId: {} }
    const id = context.idAllocator.allocate("point", inputs.alias)
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "point", x: first.x, y: first.y, ...label } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  if (actionId === "planar.create_circle") {
    const center = inputs.center
    const radius = inputs.radius
    if (!isFinitePoint(center)) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "a circle needs a finite centre")], aliasToId: {} }
    if (radius === undefined || !Number.isFinite(radius) || radius <= 0) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_radius", "radius must be a positive finite number")], aliasToId: {} }
    }
    const id = context.idAllocator.allocate("circle", inputs.alias)
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "circle", center, radius, ...label } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  if (actionId === "planar.create_arc") {
    const center = inputs.center
    const radius = inputs.radius
    if (!isFinitePoint(center)) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "an arc needs a finite centre")], aliasToId: {} }
    if (radius === undefined || !Number.isFinite(radius) || radius <= 0) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_radius", "radius must be a positive finite number")], aliasToId: {} }
    }
    const startAngle = inputs.startAngle
    const endAngle = inputs.endAngle
    if (startAngle === undefined || endAngle === undefined || !Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "missing_angles", "an arc needs explicit start and end angles")], aliasToId: {} }
    }
    const id = context.idAllocator.allocate("arc", inputs.alias)
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "arc", center, radius, startAngle, endAngle, ...label } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  const points = inputs.points ?? []
  const finite = points.filter(isFinitePoint)
  if (finite.length !== points.length) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "every vertex needs finite x and y")], aliasToId: {} }
  }

  if (actionId === "planar.create_polyline") {
    if (finite.length < 2) return { operations: [], diagnostics: [diagnostic(actionKey, "too_few_points", "a polyline needs at least two points")], aliasToId: {} }
    const id = context.idAllocator.allocate("polyline", inputs.alias)
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "polyline", points: finite, ...label } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  // line / segment / ray：两个端点，且不能重合。
  if (finite.length < 2) return { operations: [], diagnostics: [diagnostic(actionKey, "too_few_points", "this object needs two points")], aliasToId: {} }
  const [a, b] = finite
  if (a.x === b.x && a.y === b.y) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "degenerate_line", "the two endpoints must differ")], aliasToId: {} }
  }
  const type = actionId === "planar.create_line" ? "line" : actionId === "planar.create_ray" ? "ray" : "segment"
  const id = context.idAllocator.allocate(type, inputs.alias)
  return { operations: [{ op: "addPrimitive", primitive: { id, type, a, b, ...label } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

/**
 * **模板实体的唯一构造入口**（手工按钮 / Agent 动作 / 后续任何新入口都调它）。
 *
 * ## 为什么必须只有一处
 *
 * 模板实体在文档里是**两件东西**：用户编辑的那只参数化图元（`cube` / `pyramid` / `cylinder` / `cone`），
 * 以及由它物化出来的一整族拓扑（点 / 棱 / 面 / `polyhedron3`）。两条路径曾经各写一半：
 * 手工按钮调 `buildSolidTemplate` 一次落盘整族；`solid.create_template` 只落盘模板图元自己。
 *
 * 后果是**用户看得见的**（现场见 `docs/project-progress.md` 的「Agent 造的实体改「朝向」画布不动」一节，
 * 2026-09-24 用户原话："agent构建的元素无法修改方向、大小等数值。并且可以修改的无法在画布上改变"）：
 * Agent 造的立方体在文档里没有拓扑，
 * 渲染于是落到"直接画模板"的分支，而那条分支读尺寸与位置、**不读 `rotation`** ——
 * 属性栏把 `rotation.x` 改成 45°，文档值确实变成 ≈0.785398，画面却一个像素都不动；改尺寸却能看到变化。
 *
 * 返回的整族子对象里**不含**模板图元自己（内核只造点 / 棱 / 面 / `polyhedron3`），
 * 调用方要把模板排在前面一起提交。多面体的 id 由内核按 `<solidId>-polyhedron-N` 给，
 * **与模板图元自己的 `solidId` 不同** —— 同名会让同一批 `addPrimitives` 撞成 `duplicate object id`。
 */
export function compileTemplateSolid(solidId: string, primitive: TemplateSolidPrimitive): SolidBuildResult {
  /**
   * **刻意不传自定义 `BuilderContext`**：这里必须与"事后重算子对象坐标"的那一处
   * （`operations.ts` 的 `syncTemplateTopology`）**逐字同一套命名**。
   *
   * 两者都走 `buildSolidTemplate` 的默认上下文 `createBuilderContext(primitive.id)`，
   * 名字形如 `<solidId>-point-1` / `-edge-15` / `-face-9`，多面体是 `<solidId>-polyhedron-27`。
   * 重算那一步是**按 id 回填**顶点坐标的：两套命名一旦分叉，顶点就永远回填不上，
   * 表现就是"值改了、画布不动"。曾经动作层自己发明过一套 `<solidId>:v0`，正是那个坑。
   */
  return buildSolidTemplate({ ...primitive, id: solidId })
}

/** 动作层与文档层是两套词汇，翻译只发生在这一个地方（导出是为了让这条"唯一入口"能被单测直接钉住）。 */
export function templatePrimitiveFor(inputs: Extract<DraftAction, { actionId: "solid.create_template" }>["inputs"], id: string): TemplateSolidPrimitive {
  const label = inputs.label === undefined ? {} : { label: inputs.label }
  /**
   * 动作层（模型看到的那一层）是模板无关的：`origin` + `size`（`@draw/agent-core` 的 `schemas.ts` 里
   * `size` 的 `appliesWhen` 就是 `["cube", "pyramid"]`）。文档层却是**每个模板一套形状**
   *（`@draw/dsl` 的 `validateDocument`）：立方体 `origin` + `size`、棱锥 `baseCenter` + `baseSize` + `height`、
   * 圆柱 / 圆锥 `center` + `radius` + `height` + `segments`。
   *
   * 以前立方体与棱锥共用第一支，于是 Agent 造出来的棱锥带着**立方体的形状**进提交，被 schema 判成
   * `pyramid geometry is invalid` —— 每个由 Agent 创建的棱锥都必然失败。手工路径
   *（`App.tsx` 的 `addDefaultSolid("pyramid")`）一直用的是 `baseCenter` / `baseSize` / `height`，
   * 两条路从来不一致。`size.x` / `size.y` 是底面两条边、`size.z` 是高，与立方体"三个棱长"的读法一致。
   */
  if (inputs.template === "cube") return { id, type: "cube", origin: inputs.origin, size: inputs.size!, ...label }
  if (inputs.template === "pyramid") return { id, type: "pyramid", baseCenter: inputs.origin, baseSize: { x: inputs.size!.x, y: inputs.size!.y }, height: inputs.size!.z, ...label }
  return { id, type: inputs.template, center: inputs.origin, radius: inputs.radius!, height: inputs.height!, segments: DEFAULT_SOLID_SEGMENTS, ...label }
}

/**
 * **点集 / 模板构造共用的确定性子对象 id**：`<solidId>:v0` / `:e0` / `:f0`（规格 §3.3）。
 *
 * 名字是**纯函数**（Solid ID + 下标），所以重算任意多次、在任何一台机器上，同一个 Solid 的子对象
 * 名字都一模一样 —— 下游引用（截面 / 交线 / 绑上去的动点）因此不会因为一次重算而集体失效。
 *
 * `polyhedron` 这一格映射回 `solidId` 自己：多面体**就是**那只实体，别名指向它。
 */
function solidChildIds(solidId: string): BuilderContext {
  const counters = new Map<string, number>()
  return {
    allocateId(namespace) {
      const index = counters.get(namespace) ?? 0
      counters.set(namespace, index + 1)
      if (namespace === "polyhedron") return solidId
      return `${solidId}:${namespace === "point" ? "v" : namespace.charAt(0)}${index}`
    }
  }
}

function compileSolidTemplate(action: Extract<DraftAction, { actionId: "solid.create_template" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  // §7.3：模板属于立体几何；在平面工作区里画立方体是"工作区不匹配"，不是"参数错误"。
  if (context.targetWorkspace !== "geometry3d") {
    return { operations: [], diagnostics: [diagnostic(actionKey, "workspace_mismatch", `${inputs.template} can only be created in the solid workspace`)], aliasToId: {} }
  }
  const positive = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value > 0
  if (inputs.template === "cube" || inputs.template === "pyramid") {
    const size = inputs.size
    if (!size || !positive(size.x) || !positive(size.y) || !positive(size.z)) {
      // 文案按模板取名（Fix round 1 / I3）：原来一律说"a cube"，棱锥缺尺寸时读起来驴唇不对马嘴。
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_size", `a ${inputs.template} needs positive finite x/y/z`)], aliasToId: {} }
    }
  }
  if (inputs.template === "cylinder" || inputs.template === "cone") {
    if (!positive(inputs.radius) || !positive(inputs.height)) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_size", "a round solid needs a positive radius and height")], aliasToId: {} }
    }
  }
  const id = context.idAllocator.allocate("solid", inputs.alias)
  const primitive = templatePrimitiveFor(inputs, id)
  // 参数校验过了不代表几何成立（例如尺寸合法但内核判退化）：内核的诊断原样上报，**一条操作都不产出**。
  const built = compileTemplateSolid(id, primitive)
  if (built.diagnostics.length > 0) return { operations: [], diagnostics: built.diagnostics.map((entry) => diagnostic(actionKey, entry.code, entry.message)), aliasToId: {} }
  /**
   * 一次 `addPrimitives` 落盘整族：模板图元 + 物化拓扑。
   *
   * `built.primitives` 里**没有**模板图元自己（内核只造点 / 棱 / 面 / 多面体），
   * 所以要显式排在前面 —— 与手工路径 `App.tsx` 的 `addSolidTemplate`
   *（`apply({ op: "addPrimitives", primitives: [primitive, ...result.primitives] })`）逐字同序。
   * 一步撤销、整族一起走。
   */
  return { operations: [{ op: "addPrimitives", primitives: [primitive, ...built.primitives] }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

/**
 * 棱柱的**派生拓扑**：`<solidId>:v<i>` / `<solidId>:e<i>` / `<solidId>:f<i>`（规格 §3.3）。
 *
 * 名字是**纯函数**（Solid ID + 下标），所以重算任意多次、在任何一台机器上，同一个 Solid 的子对象
 * 名字都一模一样 —— 下游引用（截面 / 交线 / 绑上去的动点）因此不会因为一次重算而集体失效。
 *
 * 返回给构造器一份 `SolidTopology` + 三组 id，是因为调用方还要读写棱 / 面里的下标关系，
 * 而几何层只给下标（命名属于文档层，见 `@draw/geometry-kernel` 的 `prism.ts`）。
 */
export interface SolidPrismBuildResult {
  primitives: PrimitiveSpec[]
  vertexIds: string[]
  edgeIds: string[]
  faceIds: string[]
  solidId: string
  diagnostics: ActionDiagnostic[]
}

/** 外观键（`label`/`style`…）一律**不写 `undefined`**：JSON 往返会丢这种键，内存与磁盘就成了两份数据。 */
export function compileSolidPrism(solidId: string, basePolygon: readonly Vector3[], vector: Vector3, label?: string): SolidPrismBuildResult {
  const validation = validatePrismInput(basePolygon, vector)
  if (!validation.ok) {
    return { primitives: [], vertexIds: [], edgeIds: [], faceIds: [], solidId, diagnostics: validation.diagnostics.map((entry) => diagnostic(solidId, "degenerate_prism", entry.message)) }
  }
  const topology = buildPrismTopology(basePolygon, vector)
  if (!topology) return { primitives: [], vertexIds: [], edgeIds: [], faceIds: [], solidId, diagnostics: [diagnostic(solidId, "degenerate_prism", "棱柱底面与拉伸向量无法构成实体。")] }

  const vertexIds = topology.vertices.map((_, index) => `${solidId}:v${index}`)
  const edgeIds = topology.edges.map((_, index) => `${solidId}:e${index}`)
  const faceIds = topology.faces.map((_, index) => `${solidId}:f${index}`)
  /**
   * 面环上"相邻两点"对应的棱下标。
   *
   * 只找**这两个点之间**的棱：`topology.edges` 里那条棱的两个端点就是这两个下标，
   * 所以这一跳是精确的，不需要按坐标去猜（猜错会让面的边界与棱的索引对不上，
   * 而 `face3` 的闭合性校验恰好会因此拒绝整份文档）。
   */
  const edgeIndexBetween = (first: number, second: number) => topology.edges.findIndex((edge) =>
    (edge.pointIndexes[0] === first && edge.pointIndexes[1] === second) || (edge.pointIndexes[1] === first && edge.pointIndexes[0] === second))

  const points: PrimitiveSpec[] = topology.vertices.map((position, index) => ({ id: vertexIds[index], type: "point3", position, binding: { kind: "free" }, label: prismPointLabel(index) }))
  const edges: PrimitiveSpec[] = topology.edges.map((edge, index) => ({ id: edgeIds[index], type: "edge3", pointIds: [vertexIds[edge.pointIndexes[0]], vertexIds[edge.pointIndexes[1]]], faceIds: edge.faceIndexes.map((faceIndex) => faceIds[faceIndex]), label: prismEdgeLabel(index) }))
  const faces: PrimitiveSpec[] = topology.faces.map((ring, index) => ({
    id: faceIds[index],
    type: "face3",
    pointIds: ring.map((vertexIndex) => vertexIds[vertexIndex]),
    edgeIds: ring.map((vertexIndex, ringIndex) => edgeIds[edgeIndexBetween(vertexIndex, ring[(ringIndex + 1) % ring.length])]),
    label: `面 ${index + 1}`
  }))
  const solid: PrimitiveSpec = {
    id: solidId,
    type: "polyhedron3",
    vertexIds,
    edgeIds,
    faceIds,
    // 构造描述是**真源**：顶点 / 棱 / 面只是它这一趟派生出来的几何事实（规格 §1.2）。
    construction: { kind: "prism", base: { polygon: topology.vertices.slice(0, topology.baseCount) }, vector: { ...vector } },
    ...(label ? { label } : {})
  }
  return { primitives: [...points, ...edges, ...faces, solid], vertexIds, edgeIds, faceIds, solidId, diagnostics: [] }
}

/**
 * `solid.create_prism`：底面多边形 + 拉伸向量 → 一只 `polyhedron3` 与它的全部子对象。
 *
 * 两条与模板动作一致的纪律：工作区必须是立体几何；输入不合法时**一条操作都不产出**
 * （宁可不做，也不做一半）。第三条是棱柱特有的：**侧面永远由内核生成**，
 * 动作层没有"传面进来"的入口（规格 §7 禁止把散面拼成 Prism）。
 */
function compileSolidPrismAction(action: Extract<DraftAction, { actionId: "solid.create_prism" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (context.targetWorkspace !== "geometry3d") {
    return { operations: [], diagnostics: [diagnostic(actionKey, "workspace_mismatch", "a prism can only be created in the solid workspace")], aliasToId: {} }
  }
  const id = context.idAllocator.allocate("solid", inputs.alias)
  const built = compileSolidPrism(id, inputs.basePolygon, inputs.vector, inputs.label)
  if (built.diagnostics.length > 0) return { operations: [], diagnostics: built.diagnostics.map((entry) => diagnostic(actionKey, entry.code, entry.message)), aliasToId: {} }
  return { operations: [{ op: "addPrimitives", primitives: built.primitives }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

/**
 * 这类实体的子对象自动标签：顶点 **A / B / C …**、棱 `棱 n`、面 `面 n`。
 *
 * 顶点用 A… 而不是棱柱那套 `P1…`：用户说的就是"正四面体 **ABCD**"、"正五棱锥 ABCDE"。
 * 而"这个标签是不是自动生成的"那条判据（`apps/web/src/solidTemplates.ts` 的 `isTemplateSource`）
 * 看的是 `construction.kind === "template"`，这些实体的构造是 `fromPoints`，
 * **不会被模板迁移当成自己的子对象**重命名。
 */
function labelSolidChildren(primitives: PrimitiveSpec[], label?: string): PrimitiveSpec[] {
  let vertices = 0
  let edges = 0
  let faces = 0
  return primitives.map((primitive) => {
    if (primitive.type === "point3") return { ...primitive, label: templatePointLabel(vertices++) }
    if (primitive.type === "edge3") return { ...primitive, label: templateEdgeLabel(edges++) }
    if (primitive.type === "face3") return { ...primitive, label: `面 ${(faces += 1)}` }
    return label === undefined ? primitive : { ...primitive, label }
  })
}

/** 点集构造的实体交给动作层的那一份结果（正四面体与正 N 棱锥共用）。 */
export interface ActionSolidBuildResult {
  primitives: PrimitiveSpec[]
  vertexIds: string[]
  edgeIds: string[]
  faceIds: string[]
  solidId: string
  diagnostics: ActionDiagnostic[]
}

/** 由**底面中心 + 棱长**造一只正四面体：几何来自内核，id 与标签在这一层。 */
export function compileSolidTetrahedron(solidId: string, input: { baseCenter: Vector3; edge: number }, label?: string): ActionSolidBuildResult {
  const shape = regularTetrahedronShape(input)
  if (!shape) {
    return { primitives: [], vertexIds: [], edgeIds: [], faceIds: [], solidId, diagnostics: [diagnostic(solidId, "invalid_tetrahedron", "正四面体需要一个有限的底面中心与一个正的棱长。")] }
  }
  const built = buildFromPoints(shape, solidChildIds(solidId))
  if (built.diagnostics.length > 0) {
    return { primitives: [], vertexIds: built.vertexIds, edgeIds: built.edgeIds, faceIds: built.faceIds, solidId, diagnostics: built.diagnostics.map((entry) => diagnostic(solidId, "degenerate_tetrahedron", entry.message)) }
  }
  return { primitives: labelSolidChildren(built.primitives, label), vertexIds: built.vertexIds, edgeIds: built.edgeIds, faceIds: built.faceIds, solidId, diagnostics: [] }
}

/**
 * 由**底面中心 + 边数 + 外接圆半径 + 高**造一只**正 N 棱锥**（第 1 层）。
 *
 * 正四面体是它 `sides = 3` 的特例（前者现在就走这个构造器），而"正五棱锥 / 正六棱锥…"不必各写一套 ——
 * 形状只有内核一处定义（`regularPyramidShape`），这里只负责 id、标签与包装。
 */
export function compileSolidRegularPyramid(solidId: string, input: { baseCenter: Vector3; sides: number; radius: number; height: number }, label?: string): ActionSolidBuildResult {
  const shape = regularPyramidShape(input)
  if (!shape) {
    return { primitives: [], vertexIds: [], edgeIds: [], faceIds: [], solidId, diagnostics: [diagnostic(solidId, "invalid_regular_pyramid", "正 N 棱锥需要一个有限的底面中心、3 以上的整数边数，以及正的外接圆半径与高。")] }
  }
  const built = buildFromPoints(shape, solidChildIds(solidId))
  if (built.diagnostics.length > 0) {
    return { primitives: [], vertexIds: built.vertexIds, edgeIds: built.edgeIds, faceIds: built.faceIds, solidId, diagnostics: built.diagnostics.map((entry) => diagnostic(solidId, "degenerate_regular_pyramid", entry.message)) }
  }
  return { primitives: labelSolidChildren(built.primitives, label), vertexIds: built.vertexIds, edgeIds: built.edgeIds, faceIds: built.faceIds, solidId, diagnostics: [] }
}

/**
 * `solid.create_tetrahedron`：**底面中心 + 棱长** → 一只 `polyhedron3` 与它的全部子对象。
 *
 * 与棱柱动作同一套纪律：工作区必须是立体几何；输入不合法时**一条操作都不产出**（宁可不做，也不做一半）。
 * 形状走内核既有的 `fromPoints` 通道，所以下游（渲染 / 测量 / 截面 / 平移旋转）全都是现成的。
 */
function compileSolidTetrahedronAction(action: Extract<DraftAction, { actionId: "solid.create_tetrahedron" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (context.targetWorkspace !== "geometry3d") {
    return { operations: [], diagnostics: [diagnostic(actionKey, "workspace_mismatch", "a tetrahedron can only be created in the solid workspace")], aliasToId: {} }
  }
  const id = context.idAllocator.allocate("solid", inputs.alias)
  const built = compileSolidTetrahedron(id, { baseCenter: inputs.baseCenter, edge: inputs.edge }, inputs.label)
  if (built.diagnostics.length > 0) return { operations: [], diagnostics: built.diagnostics.map((entry) => diagnostic(actionKey, entry.code, entry.message)), aliasToId: {} }
  return { operations: [{ op: "addPrimitives", primitives: built.primitives }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

/**
 * `solid.create_regular_pyramid`：**底面中心 + 边数 + 外接圆半径 + 高** → 一只 `polyhedron3` 与它的全部子对象。
 *
 * 第 1 层要解决的问题就是"一个形状一个动作"：`pyramid` 模板的底面是矩形（只能四棱锥），
 * 而正三 / 五 / 六…棱锥都落在这一族里 —— 一个动作 + 四个数，正四面体则是 `sides = 3` 的特例。
 * 与另外两个立体动作同一套纪律：工作区必须是立体几何；输入不合法时**一条操作都不产出**。
 */
function compileSolidRegularPyramidAction(action: Extract<DraftAction, { actionId: "solid.create_regular_pyramid" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (context.targetWorkspace !== "geometry3d") {
    return { operations: [], diagnostics: [diagnostic(actionKey, "workspace_mismatch", "a regular pyramid can only be created in the solid workspace")], aliasToId: {} }
  }
  const id = context.idAllocator.allocate("solid", inputs.alias)
  const built = compileSolidRegularPyramid(id, { baseCenter: inputs.baseCenter, sides: inputs.sides, radius: inputs.radius, height: inputs.height }, inputs.label)
  if (built.diagnostics.length > 0) return { operations: [], diagnostics: built.diagnostics.map((entry) => diagnostic(actionKey, entry.code, entry.message)), aliasToId: {} }
  return { operations: [{ op: "addPrimitives", primitives: built.primitives }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

/**
 * 由**顶点 + 面环**造一只**任意多面体**：几何与合法性**全部**交给内核的 `buildFromPoints`。
 *
 * 这一支刻意不做任何自己的几何判断：共面、自交、非零体积、绕向一致、未用顶点、连通性都由内核
 * 逐条报诊断（`degenerate_polyhedron`），于是"模型把面环写错了"的结局是**一次修复**，
 * 而不是一份画不出来的文档。
 */
export function compileSolidPolyhedron(solidId: string, input: { vertices: Vector3[]; faces: number[][] }, label?: string): ActionSolidBuildResult {
  const built = buildFromPoints({ vertices: input.vertices, faces: input.faces }, solidChildIds(solidId))
  if (built.diagnostics.length > 0) {
    return { primitives: [], vertexIds: built.vertexIds, edgeIds: built.edgeIds, faceIds: built.faceIds, solidId, diagnostics: built.diagnostics.map((entry) => diagnostic(solidId, "degenerate_polyhedron", entry.message)) }
  }
  return { primitives: labelSolidChildren(built.primitives, label), vertexIds: built.vertexIds, edgeIds: built.edgeIds, faceIds: built.faceIds, solidId, diagnostics: [] }
}

/**
 * `solid.create_polyhedron`：**顶点 + 面环** → 一只 `polyhedron3` 与它的全部子对象。
 *
 * 这是**不规则图形的通用入口**（第 2 层）：正八面体、棱台、题面直接给了坐标的形状都走它。
 * 与另外三个立体动作同一套纪律：工作区必须是立体几何；内核报错时**一条操作都不产出**。
 */
function compileSolidPolyhedronAction(action: Extract<DraftAction, { actionId: "solid.create_polyhedron" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (context.targetWorkspace !== "geometry3d") {
    return { operations: [], diagnostics: [diagnostic(actionKey, "workspace_mismatch", "a polyhedron can only be created in the solid workspace")], aliasToId: {} }
  }
  const id = context.idAllocator.allocate("solid", inputs.alias)
  const built = compileSolidPolyhedron(id, { vertices: inputs.vertices, faces: inputs.faces }, inputs.label)
  if (built.diagnostics.length > 0) return { operations: [], diagnostics: built.diagnostics.map((entry) => diagnostic(actionKey, entry.code, entry.message)), aliasToId: {} }
  return { operations: [{ op: "addPrimitives", primitives: built.primitives }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

function compileBindPoint(action: Extract<DraftAction, { actionId: "dynamic.bind_point" }>, context: ActionContext): CompileResult {  const { actionKey, inputs } = action
  // 跨文档只作为**已授权读取来源**，写入批次只能有一个目标文档（§6）。
  if (inputs.target.documentId !== context.targetDocument.metadata.id || inputs.host.documentId !== context.targetDocument.metadata.id) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "cross_document_reference", "a binding must stay inside the target document")], aliasToId: {} }
  }
  if (!findPrimitive(context.targetDocument, inputs.target.entityId)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "target_not_found", `no object ${inputs.target.entityId}`)], aliasToId: {} }
  }
  if (!findPrimitive(context.targetDocument, inputs.host.entityId)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "host_not_found", `no host ${inputs.host.entityId}`)], aliasToId: {} }
  }
  if (inputs.target.entityId === inputs.host.entityId) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "self_binding", "a point cannot be bound to itself")], aliasToId: {} }
  }
  return {
    operations: [{ op: "updatePrimitive", id: inputs.target.entityId, patch: { binding3: { kind: "onHost", hostId: inputs.host.entityId, parameter: inputs.parameter ?? 0 } } }],
    diagnostics: [],
    aliasToId: {}
  }
}

/**
 * 切线。两种定位方式（对应属性栏里的两条真实路径）：
 * - `anchor.kind === "point"`：**跟随动点** —— 定位写成对点的引用，所以点一动切线就跟着转；
 * - `anchor.kind === "parameter"`：沿曲线自然参数定位；
 * - 都不给：函数来源按 `x` 定位（历史行为）。
 */
function compileTangent(action: Extract<DraftAction, { actionId: "function.create_tangent" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  const wanted = findPrimitive(context.targetDocument, inputs.sourceId)
  if (!wanted) return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_found", `no source ${inputs.sourceId}`)], aliasToId: {} }

  const anchorInput = inputs.anchor
  let sourceId = inputs.sourceId
  let anchor: Record<string, unknown>
  let x = inputs.x ?? 0

  if (anchorInput?.kind === "point") {
    // 动点定位：来源必须是**那条轨道**，而不是点本身；点必须已经绑在轨道上。
    if (wanted.type !== "point") {
      return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_curve", "a point anchor needs the point id in sourceId")], aliasToId: {} }
    }
    const binding = wanted.binding
    if (binding?.kind !== "onPath") {
      return { operations: [], diagnostics: [diagnostic(actionKey, "point_not_bound", "a point anchor needs a point already bound to a path")], aliasToId: {} }
    }
    sourceId = binding.pathId
    anchor = { kind: "point", pointId: anchorInput.pointId }
    x = wanted.x
  } else if (anchorInput?.kind === "parameter") {
    if (!Number.isFinite(anchorInput.parameter)) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_anchor", "the tangent parameter must be finite")], aliasToId: {} }
    }
    anchor = { kind: "parameter", parameter: anchorInput.parameter, branch: anchorInput.branch ?? 0 }
  } else {
    if (!Number.isFinite(x)) return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_anchor", "the tangent anchor must be finite")], aliasToId: {} }
    anchor = { kind: "parameter", parameter: x, branch: 0 }
  }

  const curve = anchorInput?.kind === "point" ? findPrimitive(context.targetDocument, sourceId) : wanted
  const supportsTangent = curve !== undefined && (curve.type === "function" || curve.type === "parabola" || curve.type === "ellipse" || curve.type === "hyperbola" || curve.type === "circle" || curve.type === "arc")
  if (!supportsTangent) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "unsupported_source", `a tangent needs a curve, got ${curve?.type ?? "nothing"}`)], aliasToId: {} }
  }

  const id = context.idAllocator.allocate("tangent", inputs.alias)
  // 几何留空、只写 anchor：重算会把真正的切点与切向填进去（与属性栏同一条路径）。
  return {
    operations: [{ op: "addPrimitive", primitive: { id, type: "tangent", sourceId, x, point: { x, y: 0 }, slope: 0, a: { x, y: 0 }, b: { x, y: 0 }, status: "approximate", anchor } as unknown as PrimitiveSpec }],
    diagnostics: [],
    aliasToId: { [inputs.alias]: id }
  }
}

/** 函数分析：导函数 / 切线 / 积分区域。三者都"几何留空、由内核重算填"。 */
function compileFunctionAnalyze(action: Extract<DraftAction, { actionId: "function.analyze" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  const source = findPrimitive(context.targetDocument, inputs.sourceId)
  if (!source) return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_found", `no function ${inputs.sourceId}`)], aliasToId: {} }
  if (source.type !== "function") return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_function", `analysis needs a function, got ${source.type}`)], aliasToId: {} }
  const [low, high] = source.domain
  // 无界定义域上谈"积分区域"没有意义：拒绝，而不是给一个假的有限结果。
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "unbounded_domain", "analysis needs a bounded domain")], aliasToId: {} }
  }
  const samples = source.samples ?? 128
  /**
   * **`analysis` 是闭集，兜底分支不再"默默当成切线"**（Fix round 1 / I15）。
   *
   * 原先最后一个 `else` 对任何无法识别的字符串都建一颗 **tangent**，并用那个字符串当 id 前缀：
   * 用户要"定积分"、文档里多出一条切线 —— 规格 §7 明令不许这种静默错误。
   * 传输层现在也校验闭集（`invalid_analysis`），这里是第二道（直接调编译器的调用方）。
   */
  if (inputs.analysis !== "derivative" && inputs.analysis !== "integral" && inputs.analysis !== "tangent") {
    return { operations: [], diagnostics: [diagnostic(actionKey, "unknown_analysis", `unknown analysis '${String(inputs.analysis)}'`)], aliasToId: {} }
  }
  const id = context.idAllocator.allocate(inputs.analysis, inputs.alias)
  const primitive = inputs.analysis === "derivative"
    ? { id, type: "derivative", sourceId: source.id, order: 1, domain: [low, high], samples, points: [], status: "approximate" }
    : inputs.analysis === "integral"
      ? { id, type: "integral", sourceId: source.id, domain: [low, high], steps: 256, points: [], area: null, status: "approximate" }
      : { id, type: "tangent", sourceId: source.id, x: (low + high) / 2, point: { x: (low + high) / 2, y: 0 }, slope: 0, a: { x: low, y: 0 }, b: { x: high, y: 0 }, status: "approximate" }
  return { operations: [{ op: "addPrimitive", primitive: primitive as unknown as PrimitiveSpec }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

/** 把平面点绑到一条曲线上（自然参数定位）：绑定之后点沿曲线滑动，坐标由参数算出。 */
function compileBindCurve(action: Extract<DraftAction, { actionId: "dynamic.bind_curve" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (inputs.target.documentId !== context.targetDocument.metadata.id) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "cross_document_reference", "a binding must stay inside the target document")], aliasToId: {} }
  }
  const target = findPrimitive(context.targetDocument, inputs.target.entityId)
  if (!target) return { operations: [], diagnostics: [diagnostic(actionKey, "target_not_found", `no object ${inputs.target.entityId}`)], aliasToId: {} }
  if (target.type !== "point") return { operations: [], diagnostics: [diagnostic(actionKey, "target_not_point", `only a planar point can be bound to a path, got ${target.type}`)], aliasToId: {} }
  if (!findPrimitive(context.targetDocument, inputs.pathId)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "path_not_found", `no path ${inputs.pathId}`)], aliasToId: {} }
  }
  if (!Number.isFinite(inputs.parameter)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_parameter", "the natural parameter must be finite")], aliasToId: {} }
  }
  return {
    operations: [{ op: "updatePrimitive", id: inputs.target.entityId, patch: { binding: { kind: "onPath", pathId: inputs.pathId, parameter: inputs.parameter } as never } }],
    diagnostics: [],
    aliasToId: {}
  }
}

/** 圆的半径规则：半径由某个驱动点算出（`factor` 是比例）。 */
function compileSetRadiusRule(action: Extract<DraftAction, { actionId: "dynamic.set_radius_rule" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  const circle = findPrimitive(context.targetDocument, inputs.circleId)
  if (!circle) return { operations: [], diagnostics: [diagnostic(actionKey, "circle_not_found", `no circle ${inputs.circleId}`)], aliasToId: {} }
  if (circle.type !== "circle") return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_circle", `a radius rule needs a circle, got ${circle.type}`)], aliasToId: {} }
  const driver = findPrimitive(context.targetDocument, inputs.pointId)
  if (!driver) return { operations: [], diagnostics: [diagnostic(actionKey, "driver_not_found", `no driving point ${inputs.pointId}`)], aliasToId: {} }
  if (driver.type !== "point") return { operations: [], diagnostics: [diagnostic(actionKey, "driver_not_point", `the radius driver must be a planar point, got ${driver.type}`)], aliasToId: {} }
  const factor = inputs.factor ?? 1
  if (!Number.isFinite(factor)) return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_factor", "the radius factor must be finite")], aliasToId: {} }
  return { operations: [{ op: "updatePrimitive", id: circle.id, patch: { radiusFrom: { pointId: driver.id, factor } } }], diagnostics: [], aliasToId: {} }
}

/** 参数：只改数值与表达式，**参数本身不存在就拒绝**（不做隐式新建）。 */
function compileParameterSet(action: Extract<DraftAction, { actionId: "parameter.set" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (!context.targetDocument.parameters[inputs.id]) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "parameter_not_found", `no parameter ${inputs.id}`)], aliasToId: {} }
  }
  if (!Number.isFinite(inputs.value)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_value", "a parameter value must be finite")], aliasToId: {} }
  }
  const patch: Record<string, number | string> = {}
  for (const key of ["min", "max", "step"] as const) {
    const value = inputs[key]
    if (value !== undefined) {
      if (!Number.isFinite(value)) return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_value", `${key} must be finite`)], aliasToId: {} }
      patch[key] = value
    }
  }
  if (inputs.label !== undefined) patch.label = inputs.label
  return { operations: [{ op: "setParameter", id: inputs.id, value: inputs.value, ...patch } as DomainOperation], diagnostics: [], aliasToId: {} }
}

/**
 * **新建参数**（Agent DSL 切片，规格 §4.1）：`parameter.set` 拒绝"参数不存在"，
 * 所以符号参数必须有自己的创建动作。写入走 `setParameter`（该操作在参数不存在时**创建**它，
 * 在存在时覆盖 value 与元数据），因此新参数与既有参数**只有一条写入路径**。
 */
function compileParameterCreate(action: Extract<DraftAction, { actionId: "parameter.create" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (typeof inputs.id !== "string" || inputs.id.trim().length === 0) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_parameter_id", "a parameter needs a non-empty id")], aliasToId: {} }
  }
  if (!Number.isFinite(inputs.value)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_value", "a parameter value must be finite")], aliasToId: {} }
  }
  const patch: Record<string, number | string> = {}
  for (const key of ["min", "max", "step"] as const) {
    const value = inputs[key]
    if (value === undefined) continue
    if (!Number.isFinite(value)) return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_value", `${key} must be finite`)], aliasToId: {} }
    patch[key] = value
  }
  if (typeof inputs.label === "string") patch.label = inputs.label
  /**
   * **已经存在的参数不许被"创建"覆盖**：那是 `parameter.set` 的活。
   * 两级语义分开之后，"新建"永远只新建，"改"永远只改 —— 模型不会因为用错动作
   * 而把一个用户正在拖动的参数静默改回初值。
   */
  if (context.targetDocument.parameters[inputs.id]) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "parameter_exists", `parameter ${inputs.id} already exists; use parameter.set`)], aliasToId: {} }
  }
  return { operations: [{ op: "setParameter", id: inputs.id, value: inputs.value, ...patch } as DomainOperation], diagnostics: [], aliasToId: {} }
}

/**
 * **平面圆锥曲线**（Agent DSL 切片，规格 §8.2）。
 *
 * 三种曲线各自需要的字段不同，所以按 `kind` 分别检查 —— 把三者塞进一套必填字段里，
 * 只会让"椭圆缺一个半轴"这种真正的错误被一句笼统的 `missing_field` 盖住。
 * 几何语义（半径为正、焦准距非零）在这里判，**坐标有限性**在传输层已经判过一次。
 */
function compileCreateConic(action: Extract<DraftAction, { actionId: "planar.create_conic" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  const id = context.idAllocator.allocate(inputs.kind, inputs.alias)
  const label = inputs.label === undefined ? {} : { label: inputs.label }
  const finitePoint = (point: { x: number; y: number } | undefined) => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y))

  if (inputs.kind === "ellipse" || inputs.kind === "hyperbola") {
    if (!finitePoint(inputs.center)) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "a conic needs a finite centre")], aliasToId: {} }
    if (!Number.isFinite(inputs.radiusX) || !Number.isFinite(inputs.radiusY) || (inputs.radiusX as number) <= 0 || (inputs.radiusY as number) <= 0) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_radius", `${inputs.kind} semi-axes must be positive finite numbers`)], aliasToId: {} }
    }
    const rotation = inputs.rotation === undefined ? {} : { rotation: inputs.rotation }
    const primitive = inputs.kind === "ellipse"
      ? { id, type: "ellipse" as const, center: inputs.center, radiusX: inputs.radiusX, radiusY: inputs.radiusY, ...rotation, ...label }
      : { id, type: "hyperbola" as const, center: inputs.center, radiusX: inputs.radiusX, radiusY: inputs.radiusY, axis: inputs.axis ?? "x", ...rotation, ...label }
    return { operations: [{ op: "addPrimitive", primitive: primitive as unknown as PrimitiveSpec }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  if (!finitePoint(inputs.vertex)) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "a parabola needs a finite vertex")], aliasToId: {} }
  // 焦准距为零的"抛物线"退化成一条直线：那不是抛物线，拒绝而不是画一条假的。
  if (!Number.isFinite(inputs.focalParameter) || inputs.focalParameter === 0) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_focal_parameter", "a parabola needs a non-zero finite focal parameter")], aliasToId: {} }
  }
  return {
    operations: [{ op: "addPrimitive", primitive: { id, type: "parabola", vertex: inputs.vertex, focalParameter: inputs.focalParameter, axis: inputs.axis ?? "y", ...label } as unknown as PrimitiveSpec }],
    diagnostics: [],
    aliasToId: { [inputs.alias]: id }
  }
}

/** 能作为**平面**点宿主的曲线（自然参数由约束定义，见 `pathConstraint`）。 */
const PLANAR_HOST_TYPES = new Set(["line", "segment", "ray", "circle", "arc", "polyline", "ellipse", "parabola", "hyperbola", "function"])
/** 能作为**空间**点宿主的一维对象（棱 / 线 / 圆轨道），参数是仿射比例或圆周角。 */
const SPATIAL_HOST_TYPES = new Set(["edge3", "line3", "segment3", "ray3", "circle3"])

/**
 * **新建宿主驱动的动点**（Agent DSL 切片，规格 §3.3/§8.1）。
 *
 * 三条判据，每条都对应一次真实会踩的坑：
 * 1. **宿主必须存在**（在工作文档里找，而编译是按依赖顺序逐笔推进的，所以同一批里
 *    刚建的棱柱已经在了）—— 找不到就报 `host_not_found`，绝不"先建一个自由点顶着"；
 * 2. **宿主类型决定点的维度**：曲线宿主 → 平面点（`onPath` 绑定），棱 / 线 / 圆轨道
 *    → 空间点（`onHost` 绑定）。维度猜错的症状是"点建出来了但不在那条棱上"；
 * 3. **`parameterId` 必须指向真实参数**：悬空引用会让点静默冻在最后一次算出的位置
 *    （DSL 校验同样拒绝它，这里是编译期更早的一道）。
 *
 * 坐标先填占位值（有限即可）：真正的坐标由**重算**按宿主与参数算出 —— 与属性栏里
 * "点绑到棱上"是同一条路径，不存在第二份几何。
 */
function compileCreateBoundPoint(action: Extract<DraftAction, { actionId: "dynamic.create_bound_point" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (!Number.isFinite(inputs.parameter)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_parameter", "the host parameter must be finite")], aliasToId: {} }
  }
  if (inputs.host?.documentId !== context.targetDocument.metadata.id) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "cross_document_reference", "a bound point must stay inside the target document")], aliasToId: {} }
  }
  if (inputs.hostSub !== undefined && (!Number.isInteger(inputs.hostSub) || inputs.hostSub < 0)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_host_sub", "hostSub must be a non-negative integer")], aliasToId: {} }
  }
  const hostId = inputs.hostSub === undefined ? inputs.host.entityId : `${inputs.host.entityId}:e${inputs.hostSub}`
  const host = findPrimitive(context.targetDocument, hostId)
  if (!host) return { operations: [], diagnostics: [diagnostic(actionKey, "host_not_found", `no host ${hostId}`)], aliasToId: {} }
  if (inputs.parameterId !== undefined && !context.targetDocument.parameters[inputs.parameterId]) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "parameter_not_found", `no parameter ${inputs.parameterId}`)], aliasToId: {} }
  }

  const label = inputs.label === undefined ? {} : { label: inputs.label }
  if (PLANAR_HOST_TYPES.has(host.type)) {
    const id = context.idAllocator.allocate("point", inputs.alias)
    const binding = { kind: "onPath", pathId: hostId, parameter: inputs.parameter, ...(inputs.parameterId === undefined ? {} : { parameterId: inputs.parameterId }) }
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "point", x: 0, y: 0, binding, ...label } as unknown as PrimitiveSpec }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }
  if (SPATIAL_HOST_TYPES.has(host.type)) {
    const id = context.idAllocator.allocate("point3", inputs.alias)
    const binding = { kind: "onHost", hostId, parameter: inputs.parameter, ...(inputs.parameterId === undefined ? {} : { parameterId: inputs.parameterId }) }
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "point3", position: { x: 0, y: 0, z: 0 }, binding, ...label } as unknown as PrimitiveSpec }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }
  return { operations: [], diagnostics: [diagnostic(actionKey, "unsupported_host", `a point cannot be bound to a ${host.type}`)], aliasToId: {} }
}

function compileParameterSetExpression(action: Extract<DraftAction, { actionId: "parameter.set_expression" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (!context.targetDocument.parameters[inputs.id]) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "parameter_not_found", `no parameter ${inputs.id}`)], aliasToId: {} }
  }
  if (inputs.expression.trim().length === 0) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "empty_expression", "an expression cannot be empty")], aliasToId: {} }
  }
  // 表达式**语法**由内核在应用时求值校验：这里只挡空串，避免把"空表达式"当成有效输入。
  return { operations: [{ op: "setParameterExpression", id: inputs.id, expression: inputs.expression }], diagnostics: [], aliasToId: {} }
}

function compileSectionCreate(action: Extract<DraftAction, { actionId: "section.create" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  const source = findPrimitive(context.targetDocument, inputs.sourceId)
  if (!source) return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_found", `no source ${inputs.sourceId}`)], aliasToId: {} }
  if (!SOLID_TYPES.has(source.type)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_solid", `a section needs a solid, got ${source.type}`)], aliasToId: {} }
  }
  /**
   * **缺平面就拒绝，不再静默取 `z = 0`**（Fix round 1 / M8）。
   *
   * 过一点有无数个平面，替调用方挑一个等于换了一道题。审计层早就会 `ask_user`，
   * 但任何**直接**调 `compileAction` 的调用方（手工按钮、旧客户端）仍然会拿到那个 z=0 平面。
   * 现在缺平面在这里也失败，错误码与审计层一致（`missing_field`）。
   */
  if (!inputs.plane) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_field", "a section needs its cutting plane")], aliasToId: {} }
  const id = context.idAllocator.allocate("section", inputs.alias)
  return {
    operations: [{ op: "addPrimitive", primitive: { id, type: "section", sourceId: inputs.sourceId, plane: inputs.plane, points: [], classification: "none", status: "undefined" } }],
    diagnostics: [],
    aliasToId: { [inputs.alias]: id }
  }
}

function compileSectionMaterialize(action: Extract<DraftAction, { actionId: "section.materialize" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  const source = findPrimitive(context.targetDocument, inputs.sectionId)
  if (!source) return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_found", `no section ${inputs.sectionId}`)], aliasToId: {} }
  if (source.type !== "section") return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_section", `materialize needs a section, got ${source.type}`)], aliasToId: {} }
  // 物化本身由 `sectionMaterialization` 在提交阶段展开；这里只登记"要物化哪一节"。
  return { operations: [{ op: "updatePrimitive", id: inputs.sectionId, patch: {} }], diagnostics: [], aliasToId: {} }
}

function compileDeleteMany(action: Extract<DraftAction, { actionId: "object.delete_many" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (inputs.targets.length === 0) return { operations: [], diagnostics: [diagnostic(actionKey, "empty_batch", "nothing to delete")], aliasToId: {} }
  const missing = inputs.targets.filter((id) => !findPrimitive(context.targetDocument, id))
  if (missing.length > 0) return { operations: [], diagnostics: [diagnostic(actionKey, "target_not_found", `no object ${missing[0]}`)], aliasToId: {} }
  // 一整批一个操作：顺序无关由 `deleteObjects` 保证（Task 0.4）。
  return { operations: [{ op: "deleteObjects", ids: [...inputs.targets] }], diagnostics: [], aliasToId: {} }
}

function compileUpdateInputs(action: Extract<DraftAction, { actionId: "object.update_inputs" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  if (inputs.target.documentId !== context.targetDocument.metadata.id) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "cross_document_reference", "an update must stay inside the target document")], aliasToId: {} }
  }
  if (!findPrimitive(context.targetDocument, inputs.target.entityId)) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "target_not_found", `no object ${inputs.target.entityId}`)], aliasToId: {} }
  }
  const unknown = Object.keys(inputs.patch).filter((key) => !UPDATABLE_INPUT_FIELDS.has(key))
  if (unknown.length > 0) {
    // §7.3：几何只改**注册输入字段**。`area`、`volume` 这类派生量永远不接受写入。
    return { operations: [], diagnostics: [diagnostic(actionKey, "unregistered_input", `'${unknown[0]}' is not an updatable input field`)], aliasToId: {} }
  }
  return { operations: [{ op: "updatePrimitive", id: inputs.target.entityId, patch: inputs.patch }], diagnostics: [], aliasToId: {} }
}

// ---------------------------------------------------------------- 入口

/** 一个动作 → 操作 + 诊断。未知 `actionId` 在这里就被挡住（schema 层还会先挡一次）。 */
export function compileAction(action: DraftAction, context: ActionContext): CompileResult {
  switch (action.actionId) {
    case "planar.create_point":
    case "planar.create_line":
    case "planar.create_segment":
    case "planar.create_ray":
    case "planar.create_polyline":
    case "planar.create_circle":
    case "planar.create_arc":
      return compilePlanar(action, context)
    case "planar.create_conic":
      return compileCreateConic(action, context)
    case "solid.create_template":
      return compileSolidTemplate(action, context)
    case "solid.create_prism":
      return compileSolidPrismAction(action, context)
    case "solid.create_tetrahedron":
      return compileSolidTetrahedronAction(action, context)
    case "solid.create_regular_pyramid":
      return compileSolidRegularPyramidAction(action, context)
    case "solid.create_polyhedron":
      return compileSolidPolyhedronAction(action, context)
    case "dynamic.bind_point":
      return compileBindPoint(action, context)
    case "dynamic.create_bound_point":
      return compileCreateBoundPoint(action, context)
    case "dynamic.bind_curve":
      return compileBindCurve(action, context)
    case "dynamic.set_radius_rule":
      return compileSetRadiusRule(action, context)
    case "dynamic.create_locus":
      return compileLocus(action, context)
    case "function.create_tangent":
      return compileTangent(action, context)
    case "function.analyze":
      return compileFunctionAnalyze(action, context)
    case "parameter.set":
      return compileParameterSet(action, context)
    case "parameter.create":
      return compileParameterCreate(action, context)
    case "parameter.set_expression":
      return compileParameterSetExpression(action, context)
    case "section.create":
      return compileSectionCreate(action, context)
    case "section.materialize":
      return compileSectionMaterialize(action, context)
    case "object.delete_many":
      return compileDeleteMany(action, context)
    case "object.update_inputs":
      return compileUpdateInputs(action, context)
    default:
      return { operations: [], diagnostics: [diagnostic("unknown", "unknown_action", `unregistered action '${(action as { actionId: string }).actionId}'`)], aliasToId: {} }
  }
}

function compileLocus(action: Extract<DraftAction, { actionId: "dynamic.create_locus" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
  const source = findPrimitive(context.targetDocument, inputs.sourcePointId)
  if (!source) return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_found", `no point ${inputs.sourcePointId}`)], aliasToId: {} }
  if (source.type !== "point") return { operations: [], diagnostics: [diagnostic(actionKey, "source_not_point", `a locus needs a planar point, got ${source.type}`)], aliasToId: {} }
  if (source.binding?.kind !== "onPath") {
    // 没有轨道就没有"轨迹"：绑定之后才有资格。
    return { operations: [], diagnostics: [diagnostic(actionKey, "point_not_bound", "the point must be bound to a path before a locus exists")], aliasToId: {} }
  }
  const id = context.idAllocator.allocate("locus", inputs.alias)
  // `LocusPrimitive` 不带"点列表"：它记的是**驱动参数**与采样窗口，采样由内核按参数域生成。
  return {
    operations: [{ op: "addPrimitive", primitive: { id, type: "locus", sourcePointId: inputs.sourcePointId, parameterId: `locus-${id}`, domain: [0, 1], samples: 128 } }],
    diagnostics: [],
    aliasToId: { [inputs.alias]: id }
  }
}

/** 一批动作 → 一份操作列表 + 全部诊断。诊断非空时**不产出可提交的操作**（宁可不做，也不做一半）。 */
export function compileActions(document: GeometryDocument, actions: DraftAction[], context: ActionContext): CompileResult {
  const base: ActionContext = { ...context, targetDocument: document }
  const operations: DomainOperation[] = []
  const diagnostics: ActionDiagnostic[] = []
  const aliasToId: Record<string, string> = {}

  for (const action of actions) {
    const result = compileAction(action, base)
    diagnostics.push(...result.diagnostics)
    Object.assign(aliasToId, result.aliasToId)
    if (result.diagnostics.length === 0) operations.push(...result.operations)
  }

  return diagnostics.length > 0 ? { operations: [], diagnostics, aliasToId } : { operations, diagnostics, aliasToId }
}

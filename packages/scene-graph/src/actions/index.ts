import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"

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

// ---------------------------------------------------------------- 各族 handler

function compilePlanar(action: Extract<DraftAction, { actionId: `planar.${string}` }>, context: ActionContext): CompileResult {
  const { actionKey, actionId } = action
  const inputs = action.inputs
  const pointKind = actionId === "planar.create_point" ? "point" : undefined

  if (pointKind) {
    const first = inputs.points?.[0]
    if (!isFinitePoint(first)) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "a point needs finite x and y")], aliasToId: {} }
    const id = context.idAllocator.allocate("point", inputs.alias)
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "point", x: first.x, y: first.y } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  if (actionId === "planar.create_circle") {
    const center = inputs.center
    const radius = inputs.radius
    if (!isFinitePoint(center)) return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "a circle needs a finite centre")], aliasToId: {} }
    if (radius === undefined || !Number.isFinite(radius) || radius <= 0) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_radius", "radius must be a positive finite number")], aliasToId: {} }
    }
    const id = context.idAllocator.allocate("circle", inputs.alias)
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "circle", center, radius } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
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
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "arc", center, radius, startAngle, endAngle } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  const points = inputs.points ?? []
  const finite = points.filter(isFinitePoint)
  if (finite.length !== points.length) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "missing_point", "every vertex needs finite x and y")], aliasToId: {} }
  }

  if (actionId === "planar.create_polyline") {
    if (finite.length < 2) return { operations: [], diagnostics: [diagnostic(actionKey, "too_few_points", "a polyline needs at least two points")], aliasToId: {} }
    const id = context.idAllocator.allocate("polyline", inputs.alias)
    return { operations: [{ op: "addPrimitive", primitive: { id, type: "polyline", points: finite } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
  }

  // line / segment / ray：两个端点，且不能重合。
  if (finite.length < 2) return { operations: [], diagnostics: [diagnostic(actionKey, "too_few_points", "this object needs two points")], aliasToId: {} }
  const [a, b] = finite
  if (a.x === b.x && a.y === b.y) {
    return { operations: [], diagnostics: [diagnostic(actionKey, "degenerate_line", "the two endpoints must differ")], aliasToId: {} }
  }
  const type = actionId === "planar.create_line" ? "line" : actionId === "planar.create_ray" ? "ray" : "segment"
  const id = context.idAllocator.allocate(type, inputs.alias)
  return { operations: [{ op: "addPrimitive", primitive: { id, type, a, b } }], diagnostics: [], aliasToId: { [inputs.alias]: id } }
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
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_size", "a cube needs positive finite x/y/z")], aliasToId: {} }
    }
  }
  if (inputs.template === "cylinder" || inputs.template === "cone") {
    if (!positive(inputs.radius) || !positive(inputs.height)) {
      return { operations: [], diagnostics: [diagnostic(actionKey, "invalid_size", "a round solid needs a positive radius and height")], aliasToId: {} }
    }
  }
  const id = context.idAllocator.allocate("solid", inputs.alias)
  const label = inputs.label ? { label: inputs.label } : {}
  const primitive = inputs.template === "cube" || inputs.template === "pyramid"
    ? { id, type: inputs.template, origin: inputs.origin, size: inputs.size!, ...label }
    : { id, type: inputs.template, center: inputs.origin, radius: inputs.radius!, height: inputs.height!, segments: 48, ...label }
  return { operations: [{ op: "addPrimitive", primitive } as DomainOperation], diagnostics: [], aliasToId: { [inputs.alias]: id } }
}

function compileBindPoint(action: Extract<DraftAction, { actionId: "dynamic.bind_point" }>, context: ActionContext): CompileResult {
  const { actionKey, inputs } = action
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
  const id = context.idAllocator.allocate("section", inputs.alias)
  return {
    operations: [{ op: "addPrimitive", primitive: { id, type: "section", sourceId: inputs.sourceId, plane: inputs.plane ?? { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" } }],
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
    case "solid.create_template":
      return compileSolidTemplate(action, context)
    case "dynamic.bind_point":
      return compileBindPoint(action, context)
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

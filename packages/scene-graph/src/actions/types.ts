import type { GeometryDocument, Workspace } from "@draw/dsl"
import type { DomainOperation } from "../operations"

/**
 * 动作层的**类型契约**（Task 0.5）。
 *
 * 设计规格 §7.3 定的命名是 `family.verb`（`planar.create_point`、`solid.create_template`…），
 * §7.4 定了职责边界：**手工按钮与 Agent 调用同一个编译器**，不存在一份 Agent 专用语义。
 *
 * 本层只做两件事：把**类型化动作**翻译成 `DomainOperation[]`，以及给出**语义检查**
 *（如"至少需要两个点"）。它不碰 React、不改输入文档、也不自己执行几何。
 */

/** 一个"新对象"在草稿内的名字；重试同一草稿不会因此产生重复对象。 */
export type DraftAlias = string

export interface ActionContext {
  /** 目标文档（本批次唯一写入对象）。 */
  targetDocument: GeometryDocument
  targetWorkspace: Workspace
  /** 用户指定的**顺序**引用；选择顺序可以进上下文，但不许被静默替换。 */
  orderedSelection: string[]
  /** 动作层用到的能力注册表快照（修订号要写进 run 记录）。 */
  capabilityRevision: string
  /** 重试安全的新 id 分配器。 */
  idAllocator: IdAllocator
}

/**
 * 幂等的 id 分配器。
 *
 * 计划 Step 4 的要求："Test retrying the same draft does not duplicate IDs"。
 * 实现要点是**按 alias 记忆**：同一个 alias 再来一次就返回同一个 id，
 * 而不是每调一次就新造一个 —— 否则"重试一次动作"会在文档里留下两个对象。
 */
export interface IdAllocator {
  /** 为某个草稿别名取得（或创建）一个稳定 id。 */
  allocate(kind: string, alias: DraftAlias): string
}

export interface ActionBase {
  actionId: string
  actionKey: string
  factIds: string[]
}

// ---------------------------------------------------------------- 动作判别联合（按动作族分组）

export interface PlanarCreateAction extends ActionBase {
  actionId:
    | "planar.create_point"
    | "planar.create_line"
    | "planar.create_segment"
    | "planar.create_ray"
    | "planar.create_polyline"
    | "planar.create_circle"
    | "planar.create_arc"
  inputs: {
    alias: DraftAlias
    /** 平面点坐标；线类动作给两个端点，折线给一串，圆给圆心 + 半径。 */
    points?: Array<{ x: number; y: number }>
    center?: { x: number; y: number }
    radius?: number
    startAngle?: number
    endAngle?: number
    label?: string
  }
}

export interface SolidCreateTemplateAction extends ActionBase {
  actionId: "solid.create_template"
  inputs: {
    alias: DraftAlias
    template: "cube" | "pyramid" | "cylinder" | "cone"
    origin: { x: number; y: number; z: number }
    size?: { x: number; y: number; z: number }
    radius?: number
    height?: number
    label?: string
  }
}

/** 既有的、指向文档内对象的引用（必须带 documentId，名称不是 ID）。 */
export interface SceneReference {
  documentId: string
  entityId: string
}

export interface DynamicBindPointAction extends ActionBase {
  actionId: "dynamic.bind_point"
  inputs: {
    target: SceneReference
    host: SceneReference
    /** 宿主上的自然参数；缺省时由调用方先算出最近点参数。 */
    parameter?: number
  }
}

export interface DynamicCreateLocusAction extends ActionBase {
  actionId: "dynamic.create_locus"
  inputs: { alias: DraftAlias; sourcePointId: string }
}

export interface FunctionCreateTangentAction extends ActionBase {
  actionId: "function.create_tangent"
  inputs: {
    alias: DraftAlias
    /** 曲线 id；`anchor.kind === "point"` 时给的是**平面点** id。 */
    sourceId: string
    x?: number
    anchor?: TangentAnchorInput
  }
}

/** 切线的定位方式：曲线自然参数 / 跟随动点 / 缺省（函数来源按 x）。 */
export type TangentAnchorInput =
  | { kind: "parameter"; parameter: number; branch?: number }
  | { kind: "point"; pointId: string }

export interface FunctionAnalyzeAction extends ActionBase {
  actionId: "function.analyze"
  inputs: { alias: DraftAlias; sourceId: string; analysis: "derivative" | "tangent" | "integral" }
}

export interface DynamicBindCurveAction extends ActionBase {
  actionId: "dynamic.bind_curve"
  inputs: {
    target: SceneReference
    pathId: string
    /** 曲线的**自然参数**（直线是仿射比例、圆是弧度、函数是 x）。 */
    parameter: number
  }
}

export interface DynamicSetRadiusRuleAction extends ActionBase {
  actionId: "dynamic.set_radius_rule"
  inputs: { circleId: string; pointId: string; factor?: number }
}

export interface ParameterSetAction extends ActionBase {
  actionId: "parameter.set"
  inputs: { id: string; value: number; min?: number; max?: number; step?: number; label?: string }
}

export interface ParameterSetExpressionAction extends ActionBase {
  actionId: "parameter.set_expression"
  inputs: { id: string; expression: string }
}

export interface SectionCreateAction extends ActionBase {
  actionId: "section.create"
  inputs: {
    alias: DraftAlias
    sourceId: string
    plane?: { normal: { x: number; y: number; z: number }; constant: number }
  }
}

export interface SectionMaterializeAction extends ActionBase {
  actionId: "section.materialize"
  inputs: { sectionId: string }
}

export interface ObjectDeleteManyAction extends ActionBase {
  actionId: "object.delete_many"
  inputs: { targets: string[] }
}

export interface ObjectUpdateInputsAction extends ActionBase {
  actionId: "object.update_inputs"
  inputs: { target: SceneReference; patch: Record<string, unknown> }
}

export type DraftAction =
  | PlanarCreateAction
  | SolidCreateTemplateAction
  | DynamicBindPointAction
  | DynamicCreateLocusAction
  | DynamicBindCurveAction
  | DynamicSetRadiusRuleAction
  | FunctionCreateTangentAction
  | FunctionAnalyzeAction
  | SectionCreateAction
  | SectionMaterializeAction
  | ObjectDeleteManyAction
  | ObjectUpdateInputsAction
  | ParameterSetAction
  | ParameterSetExpressionAction

/**
 * 动作层认得的**全部** actionId。
 *
 * 导出它是为了让"动作层"与"agent-core 的传输 schema"能够做**双向**漂移检查：
 * `agent-core/src/actionIds.ts` 里有一份同名清单，`tsconfig` 会在编译期比对两个方向 ——
 * 少一个（schema 认得但动作层没有）或多一个（动作层有但 schema 不认）都会编译失败。
 *
 * 这个守卫不是形式主义：在它存在之前，动作层实现 20 个动作而 schema 只登记了 4 个，
 * 于是**十几个动作根本无法从模型输出到达编译器**，而且失败被报成 `unknown_action`
 *（看起来像"模型编了个不存在的动作"，实际是登记表过期）。
 */
export type DraftActionId = DraftAction["actionId"]

// ---------------------------------------------------------------- 编译结果

/** 语义检查：不是 schema 错误，而是"这个动作在这个文档上不成立"。 */
export interface ActionDiagnostic {
  actionKey: string
  code: string
  message: string
}

export interface CompileResult {
  /** 交给 `commitTransaction` 的操作；**顺序即执行顺序**。 */
  operations: DomainOperation[]
  diagnostics: ActionDiagnostic[]
  /** 新对象别名 → 本批次分配到的 id（供预览与后续动作引用）。 */
  aliasToId: Record<string, string>
}

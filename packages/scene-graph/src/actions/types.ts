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
 *
 * 还有一条同样硬的要求：**不许发出目标文档里已经存在的 id**。占用集在构造时传入
 * （`createIdAllocator(taken)`），因为只有调用方知道这次要落在哪份文档上。
 */
export interface IdAllocator {
  /** 为某个草稿别名取得（或创建）一个稳定 id，且该 id 不在构造时传入的占用集里。 */
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

/**
 * **拉伸式棱柱**（设计规格 §3.2/§3.3）：底面多边形 + 拉伸向量。
 *
 * 它是 `solid.create_prism` 而**不是** `solid.create_template` 的一个 `template` 取值：
 * 模板动作的输入是"原点 + 尺寸"这类参数化描述，棱柱的输入是一串顶点与一个向量 ——
 * 两者的字段完全不同，硬塞进同一个判别式只会让两边都失去类型约束。
 *
 * 侧面由内核按 `[Bi, B(i+1), T(i+1), Ti]` **生成**，调用方**不能**传面（规格 §7：
 * 不许把散面拼成 Prism）。所以这里连"faces"这种字段都不存在。
 */
export interface SolidCreatePrismAction extends ActionBase {
  actionId: "solid.create_prism"
  inputs: {
    alias: DraftAlias
    /** 底面多边形的有序顶点（世界坐标），至少三个、共面、不自交。 */
    basePolygon: Array<{ x: number; y: number; z: number }>
    /** 拉伸向量：直棱柱平行底面法向，斜棱柱带水平分量。 */
    vector: { x: number; y: number; z: number }
    label?: string
  }
}

/**
 * **正四面体**（用户口径："画一个正四面体 ABCD，棱长为 3"）。
 *
 * 它是独立动作，而**不是** `solid.create_template` 的一个 `template` 取值：模板的输入是
 * `origin + size`（立方体 / 四棱锥）或 `center + radius + height`（圆柱 / 圆锥），而正四面体由
 * **底面中心 + 棱长**两个数唯一确定 —— 硬塞进模板会让每个模板的字段都变成"有些必填、有些没有"。
 *
 * 形状由内核按定义构造（四个顶点、六条等长棱、四个三角面），动作层只传这两个参数。
 * **它是下面那只正 N 棱锥 `sides = 3` 的特例**（第 1 层：形状只有内核一处定义）。
 */
export interface SolidCreateTetrahedronAction extends ActionBase {
  actionId: "solid.create_tetrahedron"
  inputs: {
    alias: DraftAlias
    /** 底面（等边三角形）的中心。 */
    baseCenter: { x: number; y: number; z: number }
    /** 棱长。 */
    edge: number
    label?: string
  }
}

/**
 * **正 N 棱锥**（第 1 层：用户口径"如果有正 N 面体呢？"）。
 *
 * `solid.create_template` 的 `pyramid` 底面是**矩形**（`baseSize.x/y`），只能表达（长）四棱锥；
 * 正三 / 五 / 六…棱锥都落在这一族里，由**底面中心 + 边数 + 外接圆半径 + 高**四个数唯一确定 ——
 * 一个动作 + 一个参数，而不是一个形状一个动作。正四面体是它 `sides = 3`、且高取
 * `a·√(2/3)`（底面外接圆半径取 `a/√3`）时的特例。
 */
export interface SolidCreateRegularPyramidAction extends ActionBase {
  actionId: "solid.create_regular_pyramid"
  inputs: {
    alias: DraftAlias
    /** 底面（正 N 边形）的中心。 */
    baseCenter: { x: number; y: number; z: number }
    /** 底面边数（≥ 3 的整数）。 */
    sides: number
    /** 底面**外接圆半径**。 */
    radius: number
    /** 高（顶点在底面中心正上方多高）。 */
    height: number
    label?: string
  }
}

/** 既有的、指向文档内对象的引用（必须带 documentId，名称不是 ID）。 */
export interface SceneReference {
  documentId: string
  entityId: string
}

/**
 * **新建一个由宿主驱动的动点**（Agent DSL 切片，规格 §3.3/§8.1）。
 *
 * 为什么需要它：`dynamic.bind_point` 只能把**已经存在**的点绑到宿主上，而
 * "棱的中点 E"这类对象在计划里是**新对象** —— 没有创建动作就只能在文档里先放一个
 * 自由点再绑，那不是模型能可靠做到的两步（而且中间那一步会落进撤销历史）。
 *
 * 引用形状刻意保持**闭集**（规格 §6.1：只允许 `{scope:"draft",alias}` 与
 * `{scope:"scene",ref:{documentId,entityId}}`）：
 * - `host` 指**实体或曲线本身**（可以是刚在本计划里创建的对象）；
 * - `hostSub` 指该宿主内部**第几条棱**（`${hostId}:e{hostSub}`，规格 §3.3 的确定性命名）。
 *
 * 参数一律是宿主的**自然参数**（棱是仿射比例、曲线是角度/轴向参数），
 * 中点因此就是 `parameter = 0.5`，不需要"中点"这种特例语义。
 */
export interface DynamicCreateBoundPointAction extends ActionBase {
  actionId: "dynamic.create_bound_point"
  inputs: {
    alias: DraftAlias
    /** 宿主：曲线（平面点 2-D）或实体 / 棱宿主（空间点 3-D）。**已解析**的场景引用。 */
    host: SceneReference
    /** 宿主内部的棱下标；给了就绑到 `${host.entityId}:e${hostSub}` 这条棱上。 */
    hostSub?: number
    parameter: number
    /** 由文档参数驱动（符号参数 θ 驱动动点，规格 §8.2）；必须真实存在。 */
    parameterId?: string
    label?: string
  }
}

/**
 * **平面圆锥曲线**（Agent DSL 切片，规格 §8.2）。
 *
 * 椭圆 / 抛物线 / 双曲线在 DSL 里早就是一等图元（有约束、有切线、有交点），
 * 但动作层一直没有"创建它们"的入口 —— 于是"画一个椭圆并作切线"这类题目
 * 只能靠界面手工完成，Agent 侧根本表达不出来。
 */
export interface PlanarCreateConicAction extends ActionBase {
  actionId: "planar.create_conic"
  inputs: {
    alias: DraftAlias
    kind: "ellipse" | "parabola" | "hyperbola"
    center?: { x: number; y: number }
    radiusX?: number
    radiusY?: number
    vertex?: { x: number; y: number }
    focalParameter?: number
    axis?: "x" | "y"
    rotation?: number
    label?: string
  }
}

/**
 * **新建文档参数**（Agent DSL 切片，规格 §4.1/§8.2）。
 *
 * `parameter.set` 明确拒绝"参数不存在"（不做隐式新建），因为悄悄新建一个参数
 * 会让"改哪个参数"这件事变得不可预期。但符号参数本身必须能被**创建** ——
 * 否则"保留符号参数 θ"（规格 §6.3 对"恒定/定值"题目的硬要求）无从表达。
 */
export interface ParameterCreateAction extends ActionBase {
  actionId: "parameter.create"
  inputs: { id: string; value: number; min?: number; max?: number; step?: number; label?: string }
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
  | PlanarCreateConicAction
  | SolidCreateTemplateAction
  | SolidCreatePrismAction
  | SolidCreateTetrahedronAction
  | SolidCreateRegularPyramidAction
  | DynamicBindPointAction
  | DynamicCreateBoundPointAction
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
  | ParameterCreateAction
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

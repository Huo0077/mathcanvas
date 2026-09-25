import { DEFAULT_CENTER_2D, DEFAULT_DYNAMIC_POINT_PARAMETER, DEFAULT_ORIGIN_3D, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, DEFAULT_SLOPE, DEFAULT_SOLID_HEIGHT, DEFAULT_SOLID_SIZE, defaultPrismBasePolygon, defaultPrismVector } from "./localPlanDefaults"
import type { DraftActionId } from "@draw/scene-graph"
import type { PlanDefaultPolicy } from "./contracts"

/**
 * **动作登记表**（从 `schemas.ts` 拆出，评审方案 2）。
 *
 * 这里是"有哪些动作、每个动作允许哪些字段、默认策略是什么"的**唯一一份**。它先是数据、
 * 然后才被校验与审计读：`parseActionInputs` 按它校验，`auditDescription` 按它生成审计说明，
 * 回显判据（`isEchoableName`）也按它判断"这个名字是不是登记过的"。
 *
 * 拆出来的直接原因是**依赖方向**：回显判据要读这张表，而它住在读取层里 ——
 * 表留在 `schemas.ts` 就会让"读取层 → schemas → 读取层"成一个环。
 */

// ---------------------------------------------------------------- 动作注册表


export interface ActionSpec {
  /** inputs 里除 `alias` 之外允许出现的字段。 */
  inputFields: readonly string[]
  /** 是否要求 inputs.alias（新建对象都要，修改既有对象不需要）。 */
  requiresAlias: boolean
  /**
   * **这个动作的引用字段**（Fix round 1 / I12、I16、M4）。
   *
   * 从"只有一个 `requireReference`"改成**列表**，因为有的动作同时有多个引用：
   * `dynamic.bind_point` 既有 `target`（要绑的点）又有 `host`（绑到谁身上）。
   * 只登记一个的后果是另一个既不解析也不校验 —— 模型按提示词写
   * `host: {scope:"draft", alias:"E"}` 时，编译器读到 `documentId === undefined`
   * 就报 `cross_document_reference`，把"别名没解析"误报成"跨文档"。
   *
   * 这份列表同时是**编译器的引用解析表**（`planCompiler` 直接读它，不再有第二份）。
   */
  references?: readonly {
    field: string
    /** `scoped` = 带 documentId 的对象引用；`id` = 同文档内的对象 id；`parameter` = 文档参数 id。 */
    kind: "scoped" | "id" | "parameter"
    /** 一批 id（`object.delete_many.targets`）。 */
    list?: boolean
    /** 嵌套在对象里的引用（切线的 `anchor.pointId`）。 */
    nested?: { outer: string; inner: string; when: { field: string; equals: string } }
  }[]
  /**
   * 取值只能是这个集合的字段（例如 `solid.create_template` 的 `template`）。
   *
   * **为什么要登记在这一处**：提示词必须让模型知道每个动作能填哪些字段、哪些字段只能取固定值，
   * 而"能填什么"的判据就是这张表。第一版提示词只给了动作名，于是**真实模型**产出了
   * `solid.create_template` 却把 `template` 填成了别的值 —— 校验拒绝它（`invalid_template`），
   * 而模型没有任何办法知道该填什么。在提示词里手抄一份值域就是第二份真源，迟早与被校验的那份不一致。
   */
  enumValues?: Record<string, readonly string[]>
  /** 闭集字段的稳定错误码（缺省 `invalid_${field}`）。 */
  enumCodes?: Record<string, string>
  /**
   * **没有它这个动作就不成立**的字段（规格 §6.3 的"显式约束"）。
   *
   * 缺了它**不等于**失败：审计会先看这个字段有没有安全默认（`defaults`），
   * 有就回填并写进 `assumptions`，没有就走 `clarification` 问用户。
   */
  required?: readonly string[]
  /**
   * **字段缺失时的默认策略**（规格 §6.3）。
   *
   * 只登记"缺了会怎么办"的字段：没登记的字段一律是"可选字段，给了就用"
   *（例如 `label`）—— 那不需要策略，也不需要用户回答。
   */
  defaults?: Record<string, FieldPolicy>
}

/**
 * 一个字段的默认策略。`safe_default` 必须带 `reason`（那句话会进 `assumptions`，
 * 用户据此知道系统替他定了什么），`ask_user` 必须带 `question`（具体到能直接回答）。
 */
export interface FieldPolicy {
  policy: PlanDefaultPolicy
  value?: unknown
  reason?: string
  question?: string
  /** `infer_from_facts` 时从哪一类事实里读（`size` = 棱长/边长，`height` = 高度）。 */
  infer?: "size" | "height" | "label" | "position"
  /**
   * **这条策略只对某些取值生效**（例如 `radiusX` 只对椭圆/双曲线有意义）。
   *
   * 少了它会出一个很糟的症状：给椭圆作计划时被问"抛物线的焦准距是多少？" ——
   * 用户看得见的问题里混进了与本题无关的那一个，而这类噪声会让人不再读提问。
   */
  appliesWhen?: { field: string; in: readonly string[] }
}

/** 一条给模型/审计看的字段说明（**从登记表生成**，不手抄）。 */
export interface ActionAuditDescription {
  actionId: string
  requiresAlias: boolean
  inputs: readonly string[]
  enums: Record<string, readonly string[]>
  /**
   * **引用字段**（Fix round 1 / I12、I16、M4）。
   *
   * 编译器用它把 `{scope:"draft", alias}` / `draft:<alias>` 解析成真 id ——
   * 这张表只有这一份（`planCompiler` 直接读它），所以"注册表说它是引用、解析器却不知道"
   * 这种漂移不可能再发生。
   */
  references: readonly {
    field: string
    kind: "scoped" | "id" | "parameter"
    list?: boolean
    nested?: { outer: string; inner: string; when: { field: string; equals: string } }
  }[]
  required: readonly string[]
  defaults: readonly { field: string; policy: PlanDefaultPolicy; value?: unknown; reason?: string; question?: string; infer?: "size" | "height" | "label" | "position"; appliesWhen?: { field: string; in: readonly string[] } }[]
}

/** 空间模板的闭集。**只有一处**：下面那张登记表与运行期校验都读它。 */
export const SOLID_TEMPLATES = ["cube", "pyramid", "cylinder", "cone"] as const

/** 平面圆锥曲线的闭集（规格 §8.2）。 */
export const CONIC_KINDS = ["ellipse", "parabola", "hyperbola"] as const

/** 函数分析动作的闭集（Fix round 1 / I15）。 */
export const ANALYSIS_KINDS = ["derivative", "tangent", "integral"] as const

/** 取原点这类"最小复杂度"默认；写成常量而不是每处 new 一个字面量。 */
export const CENTER_2D = { ...DEFAULT_CENTER_2D }
export const ORIGIN_3D = { ...DEFAULT_ORIGIN_3D }

/**
 * **传输层的动作登记表**。
 *
 * ## 这份表曾经是错的（实测缺陷，已修）
 *
 * 它原先只登记了 4 个动作，而动作层（`packages/scene-graph/src/actions/`）实现了 **20** 个。
 * 后果是静默的：模型给出一个合法动作 → `parseDraftAction` 报 `unknown_action` →
 * 看起来像"模型编了个不存在的动作"，实际是登记表过期，于是**十几个已实现的动作
 * 根本无法从模型输出到达编译器**。更糟的是其中两项（`object.delete` / `object.update`）
 * **动作层根本不存在**，等于教模型用错名字。
 *
 * ## 两条纪律
 *
 * 1. **名字必须与动作层一致**：下面的 `satisfies` 用 `DraftActionId`（从动作层联合类型导出）
 *    做双向检查 —— 少一个、多一个都编译失败。运行期另有 `actionIds.test.ts` 再核对一次。
 * 2. **这里只做"认名字 + 拒绝畸形载荷"**：半径必须为正、坐标必须有限、工作区是否允许该动作……
 *    这些**语义**校验已经完整地存在于动作编译器里，而且是唯一一份。传输层再抄一遍必然分叉，
 *    后果是"schema 放行、编译器拒绝"这类莫名其妙的失败。所以载荷的语义留给编译器。
 */
export const ACTIONS = {
  // --- 平面创建：输入形状见 `PlanarCreateAction`（points / center / radius / 角度） ---
  // 点的位置是**显式约束**：不给我就不该替用户挑一个坐标（欠定 ≠ 有安全默认）。
  "planar.create_point": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这个点画在哪里？给一个坐标（x, y）。" } }
  },
  "planar.create_line": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条线过哪两点？给两个坐标。" } }
  },
  "planar.create_segment": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条线段的两个端点坐标是什么？" } }
  },
  "planar.create_ray": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条射线的端点与方向上的一点分别在哪里？" } }
  },
  "planar.create_polyline": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条折线依次经过哪些点？" } }
  },
  /**
   * 圆的半径没有公认默认（单位圆是一种猜测，不是"安全"），所以缺半径就**问**。
   * 圆心取原点是常见的默认（规格 §6.3 的"最小化复杂度"），但要写进 `assumptions`。
   */
  "planar.create_circle": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["radius"],
    defaults: {
      center: { policy: "safe_default", value: CENTER_2D, reason: "圆心未指定，取原点。", },
      radius: { policy: "ask_user", question: "圆的半径是多少？" }
    }
  },
  "planar.create_arc": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["radius", "startAngle", "endAngle"],
    defaults: {
      center: { policy: "safe_default", value: CENTER_2D, reason: "圆心未指定，取原点。" },
      radius: { policy: "ask_user", question: "圆弧的半径是多少？" },
      startAngle: { policy: "safe_default", value: 0, reason: "起始角未指定，取 0。" },
      endAngle: { policy: "safe_default", value: Math.PI / 2, reason: "终止角未指定，取四分之一圆（π/2）。" }
    }
  },
  /**
   * 平面圆锥曲线（规格 §8.2）。中心取原点、轴向取 x 是安全默认；
   * **半轴与焦准距不是** —— 猜错就等于换了题目里的一条曲线。
   */
  "planar.create_conic": {
    inputFields: ["alias", "kind", "center", "radiusX", "radiusY", "vertex", "focalParameter", "axis", "rotation", "label"],
    requiresAlias: true,
    enumValues: { kind: CONIC_KINDS },
    required: ["kind"],
    defaults: {
      center: { policy: "safe_default", value: CENTER_2D, reason: "圆锥曲线中心未指定，取原点。", appliesWhen: { field: "kind", in: ["ellipse", "hyperbola"] } },
      vertex: { policy: "safe_default", value: CENTER_2D, reason: "抛物线顶点未指定，取原点。", appliesWhen: { field: "kind", in: ["parabola"] } },
      axis: { policy: "safe_default", value: "x", reason: "圆锥曲线轴向未指定，取 x 轴。", appliesWhen: { field: "kind", in: ["parabola", "hyperbola"] } },
      radiusX: { policy: "ask_user", question: "这条圆锥曲线的半轴长（x 方向）是多少？", appliesWhen: { field: "kind", in: ["ellipse", "hyperbola"] } },
      radiusY: { policy: "ask_user", question: "这条圆锥曲线的半轴长（y 方向）是多少？", appliesWhen: { field: "kind", in: ["ellipse", "hyperbola"] } },
      focalParameter: { policy: "ask_user", question: "抛物线的焦准距是多少？", appliesWhen: { field: "kind", in: ["parabola"] } }
    }
  },

  // --- 空间模板：字段须与 `SolidCreateTemplateAction` 一致（不能带 segments，动作层没有） ---
  "solid.create_template": {
    inputFields: ["alias", "template", "origin", "size", "radius", "height", "label"],
    requiresAlias: true,
    enumValues: { template: SOLID_TEMPLATES },
    required: ["template"],
    defaults: {
      origin: { policy: "safe_default", value: ORIGIN_3D, reason: "实体位置未指定，放在原点。" },
      size: { policy: "infer_from_facts", infer: "size", value: { x: DEFAULT_SOLID_SIZE, y: DEFAULT_SOLID_SIZE, z: DEFAULT_SOLID_SIZE }, reason: `棱长未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_SIZE}。`, appliesWhen: { field: "template", in: ["cube", "pyramid"] } },
      height: { policy: "infer_from_facts", infer: "height", value: DEFAULT_SOLID_HEIGHT, reason: `高度未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_HEIGHT}。`, appliesWhen: { field: "template", in: ["cylinder", "cone"] } },
      radius: { policy: "ask_user", question: "底面半径是多少？", appliesWhen: { field: "template", in: ["cylinder", "cone"] } }
    }
  },
  /**
   * 拉伸式棱柱（规格 §3.2/§3.3）：底面多边形 + 拉伸向量。
   *
   * 白名单里**没有** `faces`：侧面由内核按 `[Bi, B(i+1), T(i+1), Ti]` 生成，
   * 传输层连这个字段都不接受，模型就没有"把散面拼成 Prism"的入口（规格 §7）。
   */
  "solid.create_prism": {
    inputFields: ["alias", "basePolygon", "vector", "label"],
    requiresAlias: true,
    required: ["basePolygon", "vector"],
    defaults: {
      basePolygon: { policy: "safe_default", value: defaultPrismBasePolygon(DEFAULT_PRISM_SPAN), reason: `底面未指定，取边长 ${DEFAULT_PRISM_SPAN} 的正方形（规格 §6.3）。` },
      vector: { policy: "safe_default", value: defaultPrismVector(DEFAULT_PRISM_HEIGHT), reason: `拉伸向量未指定，取高 ${DEFAULT_PRISM_HEIGHT} 的直棱柱（规格 §6.3）。` }
    }
  },
  /**
   * **正四面体**（用户口径："画一个正四面体 ABCD，棱长为 3"）。
   *
   * 形状由 `baseCenter` + `edge` 两个数唯一确定，所以它既不是模板动作（字段是 `origin + size` 或
   * `center + radius + height`），也不是棱柱（底面多边形 + 向量）—— 独立一项最省心。
   *
   * `edge` 走 `infer_from_facts`：先从用户原话里读数字（"棱长为 3"），读不到取
   * `DEFAULT_SOLID_SIZE` —— 与立方体"棱长未指定"那条**完全同一口径**（含写进 `assumptions` 的那句）。
   */
  "solid.create_tetrahedron": {
    inputFields: ["alias", "baseCenter", "edge", "label"],
    requiresAlias: true,
    required: [],
    defaults: {
      baseCenter: { policy: "safe_default", value: ORIGIN_3D, reason: "底面中心未指定，放在原点。" },
      edge: { policy: "infer_from_facts", infer: "size", value: DEFAULT_SOLID_SIZE, reason: `棱长未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_SIZE}。` }
    }
  },
  /**
   * **正 N 棱锥**（第 1 层，用户口径："如果有正 N 面体呢？"）。
   *
   * `pyramid` 模板的底面是**矩形**（只能四棱锥），而正三 / 五 / 六…棱锥由"边数 + 底面外接圆半径 + 高"
   * 唯一确定；**正四面体是 `sides = 3` 的特例**（两者走内核同一个构造器）。
   *
   * **边数没有公认的默认值** —— 替用户挑一个"正五棱锥"就是替他改题，所以 `sides` 走 `ask_user`；
   * 半径与高按老口径从原话里读数字、读不到取默认值并写进 `assumptions`。
   */
  "solid.create_regular_pyramid": {
    inputFields: ["alias", "baseCenter", "sides", "radius", "height", "label"],
    requiresAlias: true,
    required: [],
    defaults: {
      baseCenter: { policy: "safe_default", value: ORIGIN_3D, reason: "底面中心未指定，放在原点。" },
      sides: { policy: "ask_user", question: "底面是正几边形？（3 = 三棱锥，也就是正四面体那一族）" },
      radius: { policy: "infer_from_facts", infer: "size", value: DEFAULT_SOLID_SIZE, reason: `底面外接圆半径未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_SIZE}。` },
      height: { policy: "infer_from_facts", infer: "height", value: DEFAULT_SOLID_HEIGHT, reason: `高未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_HEIGHT}。` }
    }
  },
  /**
   * **任意多面体**（第 2 层）：**顶点 + 面环** —— 就是内核 `fromPoints`（"点集构造多面体"）的形状。
   *
   * 它是不规则图形的**唯一通用入口**：正八面体、棱台、题面直接给了坐标的那些，全都走这一条。
   * 两个字段都**必填**（没有"公认默认值"这回事）；传输层只挡**明显畸形**的形状，
   * **几何语义**（共面、自交、非零体积、绕向一致、未用顶点、连通性）全部留给内核 `buildFromPoints` ——
   * 模型算错时它给的是**逐条诊断**（还能走一次性修复），在这里抄一遍只会变成一句 `invalid_type`。
   */
  "solid.create_polyhedron": {
    inputFields: ["alias", "vertices", "faces", "label"],
    requiresAlias: true,
    required: ["vertices", "faces"]
  },

  // --- 动点 ---
  // 引用是两个**带 documentId** 的引用：跨文档绑定必须能说清是哪两份文档里的哪两个对象。
  "dynamic.bind_point": {
    inputFields: ["target", "host", "parameter"],
    requiresAlias: false,
    references: [{ field: "target", kind: "scoped" }, { field: "host", kind: "scoped" }],
    required: ["target", "host"],
    defaults: { parameter: { policy: "safe_default", value: DEFAULT_DYNAMIC_POINT_PARAMETER, reason: `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。` } }
  },
  /**
   * 新建宿主驱动的动点：`hostSub` 指宿主内部第几条棱（规格 §3.3 的 `solidId:e{i}` 命名）。
   *
   * `parameter` 的默认是 **0.4**（规格 §6.3 的普通动点），而**中点由调用方显式给 0.5** ——
   * 审计不许把显式约束覆盖成默认值（`parameterAudit.test.ts` 钉住这条）。
   */
  "dynamic.create_bound_point": {
    inputFields: ["alias", "host", "hostSub", "parameter", "parameterId", "label"],
    requiresAlias: true,
    references: [{ field: "host", kind: "scoped" }],
    required: ["alias", "host"],
    defaults: {
      host: { policy: "ask_user", question: "这个动点绑在哪个对象上？（曲线、棱或实体）" },
      parameter: { policy: "safe_default", value: DEFAULT_DYNAMIC_POINT_PARAMETER, reason: `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。` }
    }
  },
  // 这里是**同文档内的裸 id**（动作层用 `findPrimitive` 在目标文档里查），不是作用域引用。
  "dynamic.bind_curve": {
    inputFields: ["target", "pathId", "parameter"],
    requiresAlias: false,
    references: [{ field: "target", kind: "scoped" }, { field: "pathId", kind: "id" }],
    required: ["target", "pathId"],
    defaults: { parameter: { policy: "safe_default", value: DEFAULT_DYNAMIC_POINT_PARAMETER, reason: `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。` } }
  },
  "dynamic.create_locus": {
    inputFields: ["alias", "sourcePointId"],
    requiresAlias: true,
    references: [{ field: "sourcePointId", kind: "id" }],
    required: ["sourcePointId"]
  },
  "dynamic.set_radius_rule": {
    inputFields: ["circleId", "pointId", "factor"],
    requiresAlias: false,
    references: [{ field: "circleId", kind: "id" }, { field: "pointId", kind: "id" }],
    required: ["circleId", "pointId"],
    defaults: { factor: { policy: "safe_default", value: 1, reason: "半径比例未指定，取 1（距离即半径）。" } }
  },

  // --- 函数 ---
  "function.create_tangent": {
    inputFields: ["alias", "sourceId", "x", "anchor"],
    requiresAlias: true,
    // 平铺的 `sourceId` 与**嵌套的** `anchor.pointId`：跟随动点时两处都是那个点，
    // 都可以指向同一份计划里新建的对象（漏掉嵌套那条会报 `target_not_found: draft:P`）。
    references: [{ field: "sourceId", kind: "id", nested: { outer: "anchor", inner: "pointId", when: { field: "kind", equals: "point" } } }],
    required: ["sourceId"],
    defaults: {
      x: { policy: "safe_default", value: 0, reason: "切点横坐标未指定，取 x = 0。" },
      anchor: { policy: "safe_default", value: { kind: "parameter", parameter: DEFAULT_SLOPE, branch: 0 }, reason: `切点未指定，取曲线参数 ${DEFAULT_SLOPE}（规格 §6.3：未定斜率取水平）。` }
    }
  },
  "function.analyze": {
    inputFields: ["alias", "sourceId", "analysis"],
    requiresAlias: true,
    references: [{ field: "sourceId", kind: "id" }],
    required: ["sourceId", "analysis"],
    /**
     * `analysis` 是**闭集**（Fix round 1 / I15）：不校验的话，编译器的兜底分支会把任何取值
     * 编成一条切线（要"定积分"、文档里多出一条切线），而规格 §7 明令不许这种静默错误。
     */
    enumValues: { analysis: ANALYSIS_KINDS },
    enumCodes: { analysis: "invalid_analysis" },
    defaults: { analysis: { policy: "ask_user", question: "要算导数、切线还是定积分？" } }
  },

  // --- 截面 ---
  // `SectionCreateAction` 收的是裸 `sourceId`（**不是** scoped 引用），与 `section.materialize` 一致。
  /**
   * 截面平面是**不安全**的省略：过一点有无数个平面，替用户挑一个等于换了一道题。
   * 所以缺平面就问（而不是拿 z = 0 顶上）。
   */
  "section.create": {
    inputFields: ["alias", "sourceId", "plane"],
    requiresAlias: true,
    references: [{ field: "sourceId", kind: "id" }],
    required: ["sourceId"],
    defaults: { plane: { policy: "ask_user", question: "截面用哪个平面？给法向与常数，或者说明它过哪三个点。" } }
  },
  "section.materialize": {
    inputFields: ["sectionId"],
    requiresAlias: false,
    references: [{ field: "sectionId", kind: "id" }],
    required: ["sectionId"]
  },

  // --- 对象与参数 ---
  "object.delete_many": {
    inputFields: ["targets"],
    requiresAlias: false,
    references: [{ field: "targets", kind: "id", list: true }],
    required: ["targets"]
  },
  "object.update_inputs": {
    inputFields: ["target", "patch"],
    requiresAlias: false,
    references: [{ field: "target", kind: "scoped" }],
    required: ["target", "patch"]
  },
  /**
   * **新建参数**（规格 §4.1/§8.2）。`parameter.set` 只改已存在的参数，所以"符号参数 θ"
   * 必须有一个创建入口。`id` 是**新名字**，不是引用 —— 所以这里没有 `references`。
   */
  "parameter.create": {
    inputFields: ["id", "value", "min", "max", "step", "label"],
    requiresAlias: false,
    required: ["id"],
    defaults: { value: { policy: "safe_default", value: 0, reason: "参数初值未指定，取 0。" } }
  },
  "parameter.set": {
    inputFields: ["id", "value", "min", "max", "step", "label"],
    requiresAlias: false,
    references: [{ field: "id", kind: "parameter" }],
    required: ["id"],
    /**
     * **缺新值就问，不取 0**（Fix round 1 / M24）：用户说"把 θ 调大一点"而模型漏了数值时，
     * 取 0 会把一个活参数清零 —— 那不是一个"公认默认"，而是一次静默的破坏。
     */
    defaults: { value: { policy: "ask_user", question: "这个参数要改成多少？" } }
  },
  "parameter.set_expression": {
    inputFields: ["id", "expression"],
    requiresAlias: false,
    references: [{ field: "id", kind: "parameter" }],
    required: ["id", "expression"]
  }
} as const satisfies Record<DraftActionId, ActionSpec>

/** 登记表里的键就是**动作 id**。它跟着表走：表在哪个文件，这个类型就在哪个文件。 */
export type ActionId = keyof typeof ACTIONS

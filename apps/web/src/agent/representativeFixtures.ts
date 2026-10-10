import { buildPrismTopology } from "@draw/geometry-kernel"
import { PLAN_SCHEMA_VERSION, MIDPOINT_PARAMETER, type DraftAction, type PlanEnvelope } from "@draw/agent-core"

/**
 * **代表题的确定性计划夹具**（Agent DSL 切片 Task 6；规格 §8.1/§8.2）。
 *
 * 浏览器里没有真实 provider，所以"代表题"必须由**确定性规划器**产出 ——
 * 而这两份计划与模型给出的计划走**完全相同**的下游：传输校验 → 六层编译 → 隔离草稿 →
 * 用户确认。差别只在"谁写的这份 JSON"。
 *
 * ## 为什么它值得独立成文件
 *
 * 两道代表题是规格 §8 的验收对象，它们的**数字**（菱形边长 2、夹角 60°、侧棱向量 (1,0,4)、
 * 椭圆 x²/9+y²/4=1）会被多处引用（本地规划器、e2e、单元测试、指标统计）。
 * 散在各处各写一遍，第一个 60° 写成 45° 的地方就会静默改变被验收的几何。
 */

/** 规格 §8.1 的那句话（本地规划器按关键词命中它）。 */
export const OBLIQUE_PRISM_PROMPT = "底面边长 2、一角 60° 的菱形斜四棱柱，侧棱向量 (1,0,4)，过三条棱的中点作截面，并让点 P 在边界上移动"

/** 规格 §8.2 的那句话。 */
export const CONIC_INVARIANT_PROMPT = "椭圆 x²/9+y²/4=1，P 是椭圆上任意一点，作 P 处的切线，求证 9/OA²+4/OB² 恒为 1"

/** 菱形底面：边长 2、一个内角 60°（规格 §8.1）。 */
export const RHOMBUS_BASE = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 3, y: Math.sqrt(3), z: 0 },
  { x: 1, y: Math.sqrt(3), z: 0 }
] as const

/** 侧棱向量（规格 §8.1：`(1,0,4)`，斜棱柱）。 */
export const OBLIQUE_VECTOR = { x: 1, y: 0, z: 4 } as const

/**
 * §8.2 的默认 θ。取 0.4 与规格 §6.3 的"普通动点 `t=0.4`"同一口径
 * （对椭圆来说参数就是圆周角，0.4 弧度既非特殊角、也不接近轴交点退化处）。
 */
export const DEFAULT_CONIC_THETA = 0.4

function midpoint(first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
}

function cross(first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) {
  return { x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x }
}

function subtract(first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

/**
 * 过三点（E/M/N）的平面：`normal · p + constant = 0`。
 *
 * 用系统自己的拓扑（`buildPrismTopology`）算，而不是在夹具里手抄中点坐标 ——
 * 手抄的那一份会在棱柱拓扑变化时静默失配，表现为"截面切不到实体"。
 */
function planeThrough(points: readonly { x: number; y: number; z: number }[]): { normal: { x: number; y: number; z: number }; constant: number } {
  const [first, second, third] = points
  const normal = cross(subtract(second, first), subtract(third, first))
  const length = Math.hypot(normal.x, normal.y, normal.z)
  const unit = { x: normal.x / length, y: normal.y / length, z: normal.z / length }
  return { normal: unit, constant: -(unit.x * first.x + unit.y * first.y + unit.z * first.z) }
}

/** 棱柱拓扑里"这两个顶点之间"的那条棱的下标（`solidId:e{i}` 的 `i`）。 */
export function edgeIndexBetween(edges: readonly { pointIndexes: [number, number] }[], first: number, second: number): number {
  return edges.findIndex((edge) => (edge.pointIndexes[0] === first && edge.pointIndexes[1] === second) || (edge.pointIndexes[1] === first && edge.pointIndexes[0] === second))
}

export interface FixtureEdgePlan {
  /** 三条棱的中点（E/M/N）：参数是**题目的显式约束** 0.5。 */
  midpoints: { alias: string; hostSub: number }[]
  /** 棱上动点 P（未指定位置 → 默认 0.4）。 */
  movingPoint: { alias: string; hostSub: number }
  plane: { normal: { x: number; y: number; z: number }; constant: number }
  /**
   * P 的宿主棱的**两个端点**（世界坐标）。
   *
   * 夹具刻意让这条棱成为**截面多边形的一条边**（见下面的说明），所以"P 在截面边界上"
   * 是可以用几何断言钉住的：P 落在截面边界的这一条边上（对任意参数都成立）。
   */
  movingEdge: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }
}

/**
 * 规格 §8.1 的几何骨架：三条棱的中点、过它们的平面、以及棱上动点。
 *
 * ## P 为什么在截面边界上（Fix round 1 / C2）
 *
 * 规格要求 P "在截面边界上运动"。第一版把 P 绑在棱柱的一条棱上就交差了，并声称
 * "只有参数等于平面交点时才在边界上" —— **那个说法是错的**：三条中点里 E 与 P 都在
 * 底棱 `B0B1` 上，而 M/N 取的是**同一个侧面**内的两条棱的中点，所以过 E/M/N 的平面
 * 恰好包含整个 `B0B1` 面 —— 截面多边形因此**以 `B0B1` 为一条边**，P 在这条棱上的
 * 任何位置（包括拖动中）都在截面边界上。
 *
 * 所以这里不再需要"绑到物化后的边界棱"：边界棱就是宿主棱本身。残留的限制写在报告里，
 * 也写在用例里：P 只能沿**这一条**边界边移动，不能绕整个边界走一圈。
 */
export function obliquePrismEdges(): FixtureEdgePlan {
  const topology = buildPrismTopology([...RHOMBUS_BASE], { ...OBLIQUE_VECTOR })
  if (!topology) throw new Error("the representative rhombus prism must be constructible")
  // 顶点顺序是 `[B0…B3, T0…T3]`（见 `SolidTopology`）。
  const [b0, b1, , , t0, t1] = topology.vertices
  const midBottom = midpoint(b0, b1)
  const midLateral = midpoint(b0, t0)
  const midTop = midpoint(t0, t1)
  return {
    midpoints: [
      { alias: "E", hostSub: edgeIndexBetween(topology.edges, 0, 1) },
      { alias: "M", hostSub: edgeIndexBetween(topology.edges, 0, 4) },
      { alias: "N", hostSub: edgeIndexBetween(topology.edges, 4, 5) }
    ],
    movingPoint: { alias: "P", hostSub: edgeIndexBetween(topology.edges, 0, 1) },
    plane: planeThrough([midBottom, midLateral, midTop]),
    movingEdge: { from: { ...b0 }, to: { ...b1 } }
  }
}

/** 规格 §8.1 的完整计划：**一笔** `solid.create_prism` + 三个中点 + 截面 + 棱上动点。 */
export function obliquePrismSectionPlan(): PlanEnvelope {
  const edges = obliquePrismEdges()
  /**
   * **夹具写的是「传输形状」**（`{scope:"draft", alias}` 引用、可以省略有默认策略的字段），
   * 而 `PlanEnvelope.actions` 的类型是**动作层形状**（引用已解析成 `documentId/entityId`）。
   * 两者之间的转换由六层编译管线完成，而传输形状的**校验**由 `parsePlanEnvelope` 负责 ——
   * 所以这里的一次断言是在说明"这是编译前的形状"，不是在绕过校验
   *（`localPlanner.test.ts` 的 "every declared intent produces a schema-valid envelope" 会真的跑校验）。
   */
  const actions = [
    { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism", basePolygon: RHOMBUS_BASE.map((point) => ({ ...point })), vector: { ...OBLIQUE_VECTOR }, label: "斜四棱柱" } },
    ...edges.midpoints.map((midpointEdge) => ({
      actionId: "dynamic.create_bound_point",
      actionKey: `midpoint-${midpointEdge.alias}`,
      factIds: [],
      inputs: { alias: midpointEdge.alias, host: { scope: "draft", alias: "prism" }, hostSub: midpointEdge.hostSub, parameter: MIDPOINT_PARAMETER, label: `${midpointEdge.alias}（中点）` }
    })),
    { actionId: "section.create", actionKey: "section", factIds: [], inputs: { alias: "section", sourceId: "draft:prism", plane: edges.plane } },
    {
      actionId: "dynamic.create_bound_point",
      actionKey: "moving-point",
      factIds: [],
      // 位置未指定 → 审计回填 0.4（规格 §6.3），并把它写进 assumptions。
      inputs: { alias: edges.movingPoint.alias, host: { scope: "draft", alias: "prism" }, hostSub: edges.movingPoint.hostSub, label: "P" }
    }
  ]
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作斜四棱柱，过三条棱的中点作截面，并让 P 在边界上移动",
    factIds: [],
    assumptions: [
      "截面取过三条棱中点的平面（法向与常数由棱柱拓扑算出）。",
      "P 绑在底棱 B0B1 上：过 E/M/N 的平面以这条棱为一条边，所以 P 始终落在截面边界上。"
    ],
    actions: actions as unknown as DraftAction[]
  }
}

/**
 * 规格 §8.2 的完整计划：椭圆 + 符号参数 θ + 由 θ 驱动的动点 P + P 处切线 + 轴交点 A/B + 不变量表达式。
 *
 * ## 两条与"证明"有关的纪律
 *
 * - **θ 是符号参数**（`parameter.create` + `parameterId` 绑定），不是一组数字 ——
 *   特值化会让这道题不再是"任意点处"的题；
 * - 无法符号证明时**明说数值验证**（`assumptions` 里那句），不能说成形式证明。
 *
 * ## 不变量写成什么（Fix round 1 / C1）
 *
 * 椭圆上 `P=(3cosθ, 2sinθ)` 处的切线是 `x·cosθ/3 + y·sinθ/2 = 1`，所以它与坐标轴的交点是
 * **A=(3/cosθ, 0)**、**B=(0, 2/sinθ)**，即 `OA = 3/cosθ`、`OB = 2/sinθ`，于是
 * `9/OA² + 4/OB² = cos²θ + sin²θ = 1`。
 *
 * 第一版这里把 `OA` 当成了 P 的横坐标（`3*cos(theta)`），于是表达式算出来是
 * `sec²θ + csc²θ`（θ=0.4 时 ≈ 7.77）——**不是 1**，而当时没有任何用例求过它的值
 * （`representativeFixtures.test.ts` 现在会在真实重算路径上求它）。
 *
 * ## A/B 是怎么来的（如实说明）
 *
 * 注册表里**没有"切线与坐标轴求交"这个动作**，所以 A/B 的位置由上面那条**解析式**
 * （切线方程的轴截距）给出，而不是由切线图元与轴求交算出的。两者在数学上等价，
 * 但这是一处实现口径，不是"通用求交能力"；用例会真的验证 A/B 落在内核算出的那条切线上。
 */
export function conicInvariantPlan(): PlanEnvelope {
  const theta = DEFAULT_CONIC_THETA
  const actions = [
    { actionId: "parameter.create", actionKey: "theta", factIds: [], inputs: { id: "theta", value: theta, min: 0, max: 2 * Math.PI, step: 0.01, label: "θ" } },
    // 轴截距：切线 `x·cosθ/3 + y·sinθ/2 = 1` 与 x/y 轴的交点距离。
    { actionId: "parameter.create", actionKey: "OA", factIds: [], inputs: { id: "OA", value: 3 / Math.cos(theta), label: "OA" } },
    { actionId: "parameter.set_expression", actionKey: "OA-expression", factIds: [], inputs: { id: "OA", expression: "3/cos(theta)" } },
    { actionId: "parameter.create", actionKey: "OB", factIds: [], inputs: { id: "OB", value: 2 / Math.sin(theta), label: "OB" } },
    { actionId: "parameter.set_expression", actionKey: "OB-expression", factIds: [], inputs: { id: "OB", expression: "2/sin(theta)" } },
    { actionId: "planar.create_conic", actionKey: "ellipse", factIds: [], inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, label: "椭圆 x²/9+y²/4=1" } },
    // 两条坐标轴：**直线**（不是线段），所以仿射参数不被截断，A/B 能落在轴上任意距离处。
    { actionId: "planar.create_line", actionKey: "x-axis", factIds: [], inputs: { alias: "x-axis", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], label: "x 轴" } },
    { actionId: "planar.create_line", actionKey: "y-axis", factIds: [], inputs: { alias: "y-axis", points: [{ x: 0, y: 0 }, { x: 0, y: 1 }], label: "y 轴" } },
    { actionId: "dynamic.create_bound_point", actionKey: "A", factIds: [], inputs: { alias: "A", host: { scope: "draft", alias: "x-axis" }, parameter: 3 / Math.cos(theta), parameterId: "OA", label: "A" } },
    { actionId: "dynamic.create_bound_point", actionKey: "B", factIds: [], inputs: { alias: "B", host: { scope: "draft", alias: "y-axis" }, parameter: 2 / Math.sin(theta), parameterId: "OB", label: "B" } },
    { actionId: "dynamic.create_bound_point", actionKey: "P", factIds: [], inputs: { alias: "P", host: { scope: "draft", alias: "ellipse" }, parameter: theta, parameterId: "theta", label: "P" } },
    // `function.create_tangent` 的输入白名单里**没有** `label`（动作层不接受它）：
    // 标签在传输层就是被拒的，所以夹具也不能带。
    { actionId: "function.create_tangent", actionKey: "tangent-P", factIds: [], inputs: { alias: "tangent-P", sourceId: "draft:P", anchor: { kind: "point", pointId: "draft:P" } } },
    { actionId: "parameter.create", actionKey: "invariant", factIds: [], inputs: { id: "invariant", value: 1, label: "9/OA²+4/OB²" } },
    // 不变量本身：`OA`/`OB` 是上面那两个参数（由 θ 驱动），所以这条式子在任何 θ 上都应为 1。
    { actionId: "parameter.set_expression", actionKey: "invariant-expression", factIds: [], inputs: { id: "invariant", expression: "9/OA^2 + 4/OB^2" } }
  ]
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "椭圆 x²/9+y²/4=1 上任意点 P 处的切线，核对 9/OA²+4/OB²=1",
    factIds: [],
    assumptions: [
      "不变量用数值采样核对（在若干 θ 上验证 9/OA²+4/OB²=1），**不是形式证明**。",
      "θ 是符号参数：P、切线以及轴交点 A/B 都由它驱动，不会特值化成某一点。",
      "A/B 按切线方程的轴截距解析给出（OA=3/cosθ、OB=2/sinθ）：目前没有「切线与轴求交」的动作。"
    ],
    // 与棱柱夹具同一条理由：这是**传输形状**（draft 引用、`draft:` 前缀的裸 id），
    // 交给 `parsePlanEnvelope` 校验、由六层编译管线解析。
    actions: actions as unknown as DraftAction[]
  }
}

/**
 * **用户报障的那一句**（2026-10-03）：只有关系、没有数值，过去根本画不出四棱锥 P-ABCD。
 *
 * 与上面两道代表题的区别：那两道题的数字是**题面给的**（菱形边长 2、椭圆 x²/9+y²/4=1），
 * 而这一句**一个数字都没有** —— 所以坐标必须由模型自己挑（挑完写进 `assumptions` 给用户看），
 * 而"挑得对不对"由 `relations` 表 + 内核残差核验。
 */
export const PYRAMID_PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥"
/** 离线负例：同一张图外加尚未支持的角度条件，必须停在未核验。 */
/**
 * 那把"**有一条读不出来的条件**"的题面：可构造的四棱锥 + 一个解析器读不懂的子句。
 *
 * **2026-10-10 换样本**：原来缀的是 `∠ABC=60°` —— 它现在**读得懂**了（`planarAngle`，
 * 核验器会拿坐标真的量一遍），于是这条题面不再"有一条未核验"，用它当样本的用例全都测不到
 * 它们要测的那件事（未核验可见、不能提交、不签同意票…）。换成 `sin∠PAB=0.5`：
 * **三角函数值不是角本身**，仍然读不懂 ⇒ 该有的那道守卫照旧。
 * 意图关键词里的 `∠` 仍在（`localPlanner` 那条 intent 靠它命中）。
 */
export const PYRAMID_UNVERIFIED_PROMPT = `${PYRAMID_PROMPT}，sin∠PAB=0.5`

/**
 * 一组满足全部所述关系的坐标。**顶点用下标引用**（`v0`…`v4` 依次是 P、A、B、C、D）。
 *
 * 挑值的三条理由（都对应提示词里那条"倾向于小整数、避免退化成更特殊的形状"）：
 * - 小整数，便于学生一眼看懂；
 * - `BC = 3` 与 `AD = 3` **恰好等长**，但题面只说"平行"—— 这正是要避免的那种巧合，
 *   所以底面取 2×3 的矩形而不是正方形（若取正方形，`BC ∥ AD` 与"AB ⊥ AD"会顺带把
 *   更多关系变成"意外成立"，掩盖一般性）。**注意**：这里仍满足 `AB ⊥ AD`（题面明说），
 *   只是没有额外造出"四边相等"这种题面没说的特殊性；
 * - 高取 4，与底面尺寸同量级，图形不变形。
 */
export const PYRAMID_VERTICES = [
  { x: 0, y: 0, z: 4 }, // v0 = P（在底面正上方 → PA ⊥ 底面）
  { x: 0, y: 0, z: 0 }, // v1 = A
  { x: 2, y: 0, z: 0 }, // v2 = B
  { x: 2, y: 3, z: 0 }, // v3 = C
  { x: 0, y: 3, z: 0 } // v4 = D
] as const

/**
 * 面环。**绕向是暴力搜出来的合法组合**（这个顶点的四棱锥只有 2 组合法）。
 *
 * 我第一版手推的绕向被内核判 `inconsistent-winding`（四个侧面全错），于是"关系核验不通过"
 * 的假象把排查带偏了一轮 —— 拓扑别手推。
 */
export const PYRAMID_FACES = [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]] as const

/**
 * 题面给的三条关系，逐条写进信封的 `relations`。
 *
 * `PA ⊥ 平面 ABCD` 是**线⊥平面**：5 个顶点，前两个定线、后三个定平面。
 * 另外两条是线⊥线 / 线∥线，各 4 个顶点。
 */
export const PYRAMID_RELATIONS = [
  { id: "PA-perp-base", kind: "perpendicular", targets: [{ vertex: "v0" }, { vertex: "v1" }, { vertex: "v1" }, { vertex: "v2" }, { vertex: "v3" }] },
  { id: "BC-parallel-AD", kind: "parallel", targets: [{ vertex: "v2" }, { vertex: "v3" }, { vertex: "v1" }, { vertex: "v4" }] },
  { id: "AB-perp-AD", kind: "perpendicular", targets: [{ vertex: "v1" }, { vertex: "v2" }, { vertex: "v1" }, { vertex: "v4" }] }
] as const

/**
 * 完整的四棱锥计划（用户报障那一句的确定性夹具）。
 *
 * `assumptions` 里那句话就是**设计 §1 验收判据 4/5 的落点**：用户必须看见
 * "这些数是系统选的"，并且能在属性栏改。
 *
 * `withRelations` 默认 **false** —— 取"真实形状"。**真实模型不会给这张表**
 *（2026-10-03 用户现场实测：两次都没给，即使系统明确要求它改 `envelope.relations`）。
 * 所以关系的来源是**系统从原话里抽**（方案 C）；模型自愿声明只是额外支持，
 * 传 `true` 用来覆盖那条路径。
 */
export function pyramidPlan(withRelations = false): PlanEnvelope {
  const actions = [
    {
      actionId: "solid.create_polyhedron",
      actionKey: "pyramid",
      factIds: [],
      inputs: { alias: "pyramid", vertexNames: ["P", "A", "B", "C", "D"], vertices: [...PYRAMID_VERTICES], faces: PYRAMID_FACES.map((ring) => [...ring]), label: "四棱锥 P-ABCD" }
    }
  ]
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作四棱锥 P-ABCD，满足 PA ⊥ 平面 ABCD、BC ∥ AD、AB ⊥ AD",
    factIds: [],
    assumptions: [
      "题目没有给定具体尺寸，以下为系统选取的一组示例值（满足题面全部关系，可在属性栏修改）：P(0, 0, 4)、A(0, 0, 0)、B(2, 0, 0)、C(2, 3, 0)、D(0, 3, 0)。"
    ],
    ...(withRelations ? { relations: PYRAMID_RELATIONS.map((relation) => ({ ...relation, targets: relation.targets.map((target) => ({ ...target })) })) } : {}),
    // 与其它夹具同一条理由：这是**传输形状**，交给 `parsePlanEnvelope` 校验、由六层编译管线解析。
    actions: actions as unknown as DraftAction[]
  }
}

/**
 * **代表题五：四棱锥的**外接球**（S5）。
 *
 * 与 `PYRAMID_PROMPT` 是**同一只四棱锥**，只多要一件东西：由宿主算出来的外接球。
 * 多出来的那一笔是 `derived.create_circumsphere`，宿主写成**草稿内引用**
 *（`{scope:"draft", alias:"pyramid"}`，与 `dynamic.create_bound_point` 的 `host` 同一套）——
 * 球心与半径**不在计划里**，由内核从四棱锥的五个顶点解出来。
 *
 * 这条夹具存在的意义是让"派生球"这条链在**浏览器里**可验证：球必须真的出现在画布上，
 * 而且**宿主一动它就跟着变**（设计 §4.1 明确否决"物化但不重算"）。
 */
export const PYRAMID_CIRCUMSPHERE_PROMPT = `${PYRAMID_PROMPT}的外接球`

export function pyramidCircumspherePlan(): PlanEnvelope {
  const plan = pyramidPlan()
  // `PlanEnvelope` 是判别联合：先收窄到 `plan` 那一支，才谈得上往 `actions` 里加一笔。
  if (plan.kind !== "plan") return plan
  return {
    ...plan,
    goal: "作四棱锥 P-ABCD，并作出它的外接球",
    assumptions: [
      ...(plan.assumptions ?? []),
      "外接球由内核从四棱锥的五个顶点解出来（球心到五个顶点等距），不是系统挑的一个近似球。"
    ],
    actions: [
      ...plan.actions,
      {
        actionId: "derived.create_circumsphere",
        actionKey: "circumsphere",
        factIds: [],
        inputs: { alias: "circumsphere", solidId: { scope: "draft", alias: "pyramid" }, label: "外接球" }
      } as unknown as DraftAction
    ]
  }
}

/**
 * **代表题三：平面直角三角形**（计划 V0b）。
 *
 * 题面只给关系、一个数字都没有，所以边长必须由系统挑一组并**写进 `assumptions` 给用户看** ——
 * 与四棱锥那条夹具同一条纪律。`C` 被取在过 `A` 且垂直于 `AB` 的那条线上，因此 `AB ⊥ AC` 成立；
 * 题面没有限定 `C` 的具体位置（**欠定**），这里给出的正是那组代表值之一。
 *
 * **为什么三个顶点用三条 `planar.create_point` 而不是画线段**：题面点名的是 A、B、C 三个**点**，
 * 而核验器按**点名表**取坐标；线段动作的端点只是匿名坐标，建不出点名表来 ——
 * 那样"核验"就只能变成"动作编译成功即视为图正确"，正是 V0b 要堵的洞。
 */
export const PLANAR_TRIANGLE_PROMPT = "在三角形ABC中，AB⊥AC，画示意图"

export function planarRightTrianglePlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作三角形 ABC，满足 AB ⊥ AC",
    factIds: [],
    assumptions: [
      "题目没有给定具体尺寸，以下为系统选取的一组示例值（满足题面的直角关系，可在属性栏修改）：A(0, 0)、B(2, 0)、C(0, 3)。",
      "AB ⊥ AC 只限定 C 落在过 A 且垂直于 AB 的那条线上；题面没有限定 C 的具体位置，这里取的是其中一个示例点。"
    ],
    actions: [
      { actionId: "planar.create_point", actionKey: "A", factIds: [], inputs: { alias: "A", points: [{ x: 0, y: 0 }], label: "A" } },
      { actionId: "planar.create_point", actionKey: "B", factIds: [], inputs: { alias: "B", points: [{ x: 2, y: 0 }], label: "B" } },
      { actionId: "planar.create_point", actionKey: "C", factIds: [], inputs: { alias: "C", points: [{ x: 0, y: 3 }], label: "C" } },
      /**
       * **三条边也要真的画出来**（2026-10-06 补）。
       *
       * 计划 V0b 的措辞是"A/B/C 实际点**线段**"。此前只建了三个点，于是画布上是**三个孤立的点** ——
       * 题面说"三角形"，图上却读不出三角形（我在把截图留成长期证据、逐张目视时才发现）。
       * 边不影响核验（点名表只认**带标签的点**），但**图上有没有那个形状**是另一回事。
       */
      { actionId: "planar.create_segment", actionKey: "AB", factIds: [], inputs: { alias: "AB", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] } },
      { actionId: "planar.create_segment", actionKey: "AC", factIds: [], inputs: { alias: "AC", points: [{ x: 0, y: 0 }, { x: 0, y: 3 }] } },
      { actionId: "planar.create_segment", actionKey: "BC", factIds: [], inputs: { alias: "BC", points: [{ x: 2, y: 0 }, { x: 0, y: 3 }] } }
    ] as unknown as DraftAction[]
  }
}

/**
 * **代表题四：椭圆**（计划 V0c）。
 *
 * 题面给的是**方程**，不是尺寸 —— 方程已经把两个半轴钉死了（分母是半轴的平方：`√9 = 3`、`√4 = 2`），
 * 所以这里**没有"系统自选"的自由度**。`assumptions` 里如实说明这一点：这条曲线不是挑出来的，
 * 是题面唯一确定的那一条。
 *
 * **焦点不写进动作**：焦点由半轴决定（`c = √(a² − b²)`）。写第二份就等于凭空多出一个
 * 可能与半轴打架的来源 —— 而核验器正是按半轴自己算焦点的。
 */
export const CONIC_ELLIPSE_PROMPT = "椭圆 x²/9+y²/4=1，画示意图"

export function ellipsePlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作椭圆 x²/9 + y²/4 = 1",
    factIds: [],
    assumptions: [
      "半轴由题面方程唯一确定（√9 = 3、√4 = 2），焦点随之确定在 (±√5, 0)。"
    ],
    actions: [
      {
        actionId: "planar.create_conic",
        actionKey: "ellipse",
        factIds: [],
        inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, label: "椭圆 x²/9+y²/4=1" }
      }
    ] as unknown as DraftAction[]
  }
}

/**
 * **代表题五：函数图像与它在某点的切线**（计划 V0d）。
 *
 * 题面把函数**用方程写死**、切点也写死了，所以图没有自由度：
 * 唯一"系统挑的"是**定义域**（题面没说画多宽），它写进 `assumptions`。
 *
 * 两笔动作是**有先后**的：切线引用那条曲线，所以曲线必须先建
 *（`function.create_tangent` 的 `sourceId` 指向同一份计划里的别名）。
 */
export const FUNCTION_TANGENT_PROMPT = "画出 f(x)=x³−3x 的图像与它在 x=1 处的切线"

export function functionTangentPlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作 f(x) = x³ − 3x 的图像与它在 x = 1 处的切线",
    factIds: [],
    assumptions: [
      "定义域未指定：取 [-2, 2]（够看清这条三次曲线的完整形态）。函数与切点由题面方程唯一确定，不是系统自选的。"
    ],
    actions: [
      { actionId: "function.create_graph", actionKey: "f", factIds: [], inputs: { alias: "f", expression: "x^3-3*x", domain: [-2, 2] } },
      { actionId: "function.create_tangent", actionKey: "tangent-at-1", factIds: [], inputs: { alias: "tangent-at-1", sourceId: "draft:f", x: 1 } }
    ] as unknown as DraftAction[]
  }
}

/**
 * **代表题六、七：双曲线与抛物线**（计划 V0c 的另外两类）。
 *
 * 与椭圆同一条纪律：题面是**方程**，参数被方程钉死，所以没有"系统自选"的自由度。
 * 唯一要写进 assumptions 的是"这条曲线由题面唯一确定"。
 *
 * **轴必须显式写出来**：`axis` 是这两类曲线的一部分（`x²/9−y²/4=1` 的实轴沿 x、
 * `y²=4x` 的对称轴是 x 轴），而动作层对它有 `safe_default`。夹具把题面**写明的**那个轴传下去，
 * 免得"默认值恰好对"掩盖了"题面的轴根本没被读进去"。
 */
export const HYPERBOLA_PROMPT = "双曲线 x²/9−y²/4=1，画示意图"
export const PARABOLA_PROMPT = "抛物线 y²=4x，画示意图"

export function hyperbolaPlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作双曲线 x²/9 − y²/4 = 1",
    factIds: [],
    assumptions: [
      "半轴由题面方程唯一确定（√9 = 3、√4 = 2），实轴沿 x 轴；不是系统自选的示例值。"
    ],
    actions: [
      {
        actionId: "planar.create_conic",
        actionKey: "hyperbola",
        factIds: [],
        inputs: { alias: "hyperbola", kind: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x", label: "双曲线 x²/9−y²/4=1" }
      }
    ] as unknown as DraftAction[]
  }
}

export function parabolaPlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作抛物线 y² = 4x",
    factIds: [],
    assumptions: [
      "焦准距由题面方程唯一确定：y² = 4x 里的 4 是 2p，所以 p = 2，对称轴是 x 轴；不是系统自选的示例值。"
    ],
    actions: [
      {
        actionId: "planar.create_conic",
        actionKey: "parabola",
        factIds: [],
        inputs: { alias: "parabola", kind: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "x", label: "抛物线 y²=4x" }
      }
    ] as unknown as DraftAction[]
  }
}

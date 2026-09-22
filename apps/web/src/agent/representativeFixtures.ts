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

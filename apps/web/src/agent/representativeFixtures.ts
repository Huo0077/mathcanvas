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
}

/**
 * 规格 §8.1 的几何骨架：三条棱的中点、过它们的平面、以及棱上动点。
 *
 * ## 一条如实记录的偏差
 *
 * 规格要求 P "在截面边界上运动"。本切片**没有**把 P 绑到截面自身的边界棱上，
 * 原因是结构性的：截面的边界棱由 `sectionMaterialization` 在提交时才产生
 * （id 形如 `section-1-e1-1`），编译期它还不存在，而同一条计划里的引用必须能解析。
 * 所以 P 绑在**棱柱的棱**上（宿主存在、参数可动、拖动真的会动）。
 * 代价：当参数不是 0.5 时 P 不在截面边界上 —— 这条偏差记在交付报告里。
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
    plane: planeThrough([midBottom, midLateral, midTop])
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
    assumptions: ["截面取过三条棱中点的平面（法向与常数由棱柱拓扑算出）。"],
    actions: actions as unknown as DraftAction[]
  }
}

/**
 * 规格 §8.2 的完整计划：椭圆 + 符号参数 θ + 由 θ 驱动的动点 P + P 处切线 + 不变量表达式。
 *
 * 两条与"证明"有关的纪律落在这里：
 * - **θ 是符号参数**（`parameter.create` + `parameterId` 绑定），不是一组数字 ——
 *   特值化会让这道题不再是"任意点处"的题；
 * - 无法符号证明时**明说数值验证**（`assumptions` 里那句），不能说成形式证明。
 */
export function conicInvariantPlan(): PlanEnvelope {
  const actions = [
    { actionId: "parameter.create", actionKey: "theta", factIds: [], inputs: { id: "theta", value: 0.4, min: 0, max: 2 * Math.PI, step: 0.01, label: "θ" } },
    { actionId: "planar.create_conic", actionKey: "ellipse", factIds: [], inputs: { alias: "ellipse", kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, label: "椭圆 x²/9+y²/4=1" } },
    { actionId: "dynamic.create_bound_point", actionKey: "P", factIds: [], inputs: { alias: "P", host: { scope: "draft", alias: "ellipse" }, parameter: 0.4, parameterId: "theta", label: "P" } },
    // `function.create_tangent` 的输入白名单里**没有** `label`（动作层不接受它）：
    // 标签在传输层就是被拒的，所以夹具也不能带。
    { actionId: "function.create_tangent", actionKey: "tangent-P", factIds: [], inputs: { alias: "tangent-P", sourceId: "draft:P", anchor: { kind: "point", pointId: "draft:P" } } },
    { actionId: "parameter.create", actionKey: "invariant", factIds: [], inputs: { id: "invariant", value: 1, label: "9/OA²+4/OB²" } },
    { actionId: "parameter.set_expression", actionKey: "invariant-expression", factIds: [], inputs: { id: "invariant", expression: "9/(3*cos(theta))^2 + 4/(2*sin(theta))^2" } }
  ]
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "椭圆 x²/9+y²/4=1 上任意点 P 处的切线，核对 9/OA²+4/OB²=1",
    factIds: [],
    assumptions: [
      "不变量用数值采样核对（在若干 θ 上验证 9/OA²+4/OB²=1），**不是形式证明**。",
      "θ 是符号参数：P 由它驱动，不会特值化成某一点。"
    ],
    // 与棱柱夹具同一条理由：这是**传输形状**（draft 引用、`draft:` 前缀的裸 id），
    // 交给 `parsePlanEnvelope` 校验、由六层编译管线解析。
    actions: actions as unknown as DraftAction[]
  }
}

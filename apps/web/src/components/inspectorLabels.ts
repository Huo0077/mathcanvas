import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { ownerOfTopology, topologyOfEntity, type SolidDerivedStatus } from "@draw/scene-graph"

/**
 * **属性检查器里的"名字"与"归属"**（从 `PropertiesBar.tsx` 拆出）。
 *
 * 这里只有两类东西，都与 React 无关：
 * - **名字**：内核用枚举名说话（`derived.circumsphere` / `intersectionSolid` / `polyhedron3`…），
 *   而用户看的是「外接球 / 交集整体 / 多面体」—— 内部枚举名不进界面。
 * - **归属**：`derivedSolidIdsOf` 回答"选中的这个图元，它的派生读数算在哪只实体上"，
 *   用的是场景图里**既有**的 `topologyOfEntity` / `ownerOfTopology`，不自己再判一遍。
 *
 * 为什么与组件分成两个文件：`react-refresh` 要求一个模块要么只导出组件、要么不导出组件，
 * 混在一起会让整块面板丢掉热更新状态（`inspectorFields.tsx` 与 `inspectorMath.ts` 也是因此分的）。
 */

export type ConicPrimitive = Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>
export type SolidPrimitive = Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>

/** 交线 / 交面的状态读数：给用户看的说法，不是内核里的枚举名。 */
export const intersectionLineStatusLabels: Record<string, string> = { valid: "有交线", degenerate: "无交线", "insufficient-data": "数据不足" }
export const intersectionSolidStatusLabels: Record<string, string> = {
  polyhedron: "有体积的公共区域",
  flat: "只有一块公共平面（体积 0）",
  segment: "只沿一条线段相接",
  point: "只在一个点相接",
  none: "没有公共区域",
  "insufficient-data": "数据不足"
}

/**
 * 交面面积的精度读数（A2）：平面区域/整圆是闭式解，曲面区域（圆柱 / 圆锥侧面）是网格面片求和的近似。
 * `undefined` 是旧文档或还没算过的图元——不假装知道它精确。
 */
export const intersectionFaceAreaPrecisionLabels: Record<string, string> = { "true": "闭式精确", "false": "数值近似", "undefined": "未标注" }

/**
 * **派生读数的名字**（规格 §3.4）。
 *
 * 内核用 `derived.circumsphere` / `derived.insphere` / `derived.section` 说话，
 * 而用户看的是「外接球 / 内切球 / 截面」—— 内部枚举名不进界面（与交线 / 交面那两组同一条口径）。
 */
export const derivedCodeLabels: Record<string, string> = {
  "derived.circumsphere": "外接球",
  "derived.insphere": "内切球",
  "derived.section": "截面"
}

/**
 * **四个状态各自的中文说法**（规格 §3.4 / §10）。
 *
 * 这四个词是这一层存在的全部理由：把 `exact` 与 `approximate` 说成同一句话，
 * 就是允许"数值近似"冒充"精确"；把 `undefined` / `degenerate` 折叠成"没有结果"，
 * 用户就分不清"这只实体根本没有外接球"与"这个输入本身不成立"。
 * `Record<SolidDerivedStatus["status"], string>` 是刻意的：内核将来多一个状态，
 * 这里会**编译不过**，而不是静默少一行。
 */
export const derivedStatusLabels: Record<SolidDerivedStatus["status"], string> = {
  exact: "精确",
  approximate: "数值近似",
  undefined: "不存在",
  degenerate: "退化"
}

/** 非 `exact` 的读数如果连原因都没有（不该发生），也要说清这一点，而不是留白。 */
export const DERIVED_REASON_MISSING = "内核没有给出原因。"

/**
 * 选中的图元对应**哪一只实体**的派生读数。
 *
 * - `polyhedron3` 就是实体本身（棱柱、模板物化出来的多面体）；归属（模板实体 / 自己的 id）
 *   由 `ownerOfTopology` 说了算 —— 同一个问题在场景图里已经有答案，这里不再自己判一遍。
 * - 模板实体（立方体 / 棱锥 / 圆柱 / 圆锥）是一个**参数化源**：它的拓扑是物化出来的
 *   `polyhedron3`，用 `topologyOfEntity` 找回去。**两种记法都要认**（`template` 与拖过顶点之后的
 *   `fromFaces`）：前一版这里自己写了一遍、只认 `template`，于是"拖一个顶点"之后整块读数
 *   无声消失（Fix round 1 / I2）。
 *
 * 返回的是**一组** id 而不是一个，因为报告里两种读数的归属口径不同：
 * 外接球 / 内切球挂在 `polyhedron3` 上，而截面读数挂在 `section.sourceId` 上 ——
 * 那是用户当初选中的那个实体（模板实体是 `cube-1`，棱柱是 `solid-1`）。
 * 只认其中一个 id，另一类读数就会**静默消失**（选中立方体时看不到它的截面状态）。
 *
 * 其它图元（点、面、量…）没有派生读数 —— 返回空数组，界面那一块就不出现。
 */
export function derivedSolidIdsOf(primitive: PrimitiveSpec, document: GeometryDocument): string[] {
  if (primitive.type === "polyhedron3") {
    const owner = ownerOfTopology(primitive)
    return owner !== undefined && owner !== primitive.id ? [primitive.id, owner] : [primitive.id]
  }
  if (primitive.type !== "cube" && primitive.type !== "pyramid" && primitive.type !== "cylinder" && primitive.type !== "cone") return []
  const topology = topologyOfEntity(document, primitive.id)
  return topology ? [topology.id, primitive.id] : []
}
export const primitiveTypeLabels: Record<PrimitiveSpec["type"], string> = {  point: "点",  point3: "空间点",
  line: "直线",
  line3: "空间直线",
  segment: "线段",
  segment3: "空间线段",
  ray: "射线",
  ray3: "空间射线",
  polyline: "折线",
  connection: "点连接",
  locus: "轨迹",
  parabola: "抛物线",
  ellipse: "椭圆",
  hyperbola: "双曲线",
  function: "函数",
  derivative: "导函数",
  tangent: "切线",
  normal: "法线",
  secant: "割线",
  integral: "积分区域",
  analysisSet: "分析结果",
  cube: "立方体",
  pyramid: "棱锥",
  cylinder: "圆柱",
  cone: "圆锥",
  plane3: "空间平面",
  circle3: "空间圆",
  edge3: "空间棱",
  face3: "空间面",
  polyhedron3: "多面体",
  section: "截面",
  intersectionLine: "交线",
  intersectionSolid: "交集整体",
  intersectionFace: "交面",
  intersectionPoint3: "交点",
  circle: "圆",
  arc: "圆弧",
  intersection: "直线交点",
  lineCircleIntersection: "线圆交点",
  circleIntersection: "圆交点",
  curveIntersection: "曲线交点",
  intersectionSet: "交点集合"
}

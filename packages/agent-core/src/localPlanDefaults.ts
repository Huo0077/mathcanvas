import { buildSolid, createBuilderContext, DEFAULT_SOLID_SEGMENTS } from "@draw/geometry-kernel"

/**
 * **欠定题目的默认特值表**（规格 §6.3 与 §8.1）。
 *
 * 规格把"缺什么就用什么"写成了一张明表：
 *
 * ```text
 * 任意三角形 A(1,3), B(0,0), C(4,0)；未定斜率 k=0；普通动点 t=0.4；
 * 未定立体底跨 4、高度 3。若问题要求"任意""恒定""定值"，必须保留符号参数，不能特值化成单点。
 * ```
 *
 * ## 为什么这些数字要单独住在一个文件里
 *
 * 它们此前散在三个地方各写一份：传输层的默认策略（`schemas.ts`）、works 侧本地规划器
 * （`localPlanner.ts` 的棱柱夹具写死 `span = 4` / `height = 3`）、以及欠定题的特值选择
 * （`underdetermined.ts`）。三份一旦分叉，症状是"同一个默认在两处不一样"，而这种不一致
 * 在界面上完全看不出来 —— 只会表现为"有时问、有时不问"。
 *
 * 所以这里只放**数值与构造**，不放策略：谁在什么时候用哪一个，由 `defaultPolicies.ts`
 * 与 `underdetermined.ts` 决定。
 */

/** 普通动点未指定位置时的自然参数（规格 §6.3）。 */
export const DEFAULT_DYNAMIC_POINT_PARAMETER = 0.4

/**
 * 题目说"中点"时的参数。
 *
 * 它**不是**默认值，而是**显式约束**：审计看到模型给了 0.5 就必须原样保留
 *（不许被 `DEFAULT_DYNAMIC_POINT_PARAMETER` 覆盖）。
 */
export const MIDPOINT_PARAMETER = 0.5

/** 未定斜率取水平（规格 §6.3）。 */
export const DEFAULT_SLOPE = 0

/** 未定立体底跨（规格 §6.3）。 */
export const DEFAULT_PRISM_SPAN = 4

/** 未定立体高度（规格 §6.3）。 */
export const DEFAULT_PRISM_HEIGHT = 3

/** 模板实体的默认棱长：小整数、非退化（欠定优先级：避免特殊对称、使用小整数）。 */
export const DEFAULT_SOLID_SIZE = 2

/** 模板实体的默认高度。 */
export const DEFAULT_SOLID_HEIGHT = 3

/** 默认圆心 / 中心：原点是最常见的默认，也是"最小化复杂度"那一档。 */
export const DEFAULT_CENTER_2D = { x: 0, y: 0 } as const
export const DEFAULT_ORIGIN_3D = { x: 0, y: 0, z: 0 } as const

/**
 * **任意三角形的特值**（规格 §6.3）。
 *
 * 取 `A(1,3)`、`B(0,0)`、`C(4,0)` 而不是等边/等腰/直角：那些是**特殊对称**，
 * 会让五心重合、外心落在边上、内切圆半径出现巧合 —— 用户拿它去核对题目时会被误导
 *（欠定优先级第一条就是"避免特殊对称"）。
 */
export const WITNESS_TRIANGLE = {
  a: { x: 1, y: 3 },
  b: { x: 0, y: 0 },
  c: { x: 4, y: 0 }
} as const

/** 默认底面：边长 `span` 的正方形，落在 `z = 0` 平面上。 */
export function defaultPrismBasePolygon(span: number = DEFAULT_PRISM_SPAN): { x: number; y: number; z: number }[] {
  return [
    { x: 0, y: 0, z: 0 },
    { x: span, y: 0, z: 0 },
    { x: span, y: span, z: 0 },
    { x: 0, y: span, z: 0 }
  ]
}

/** 默认拉伸向量：高度 `height` 的**直**棱柱（水平分量为零，避免凭空造出一个"斜"的默认）。 */
export function defaultPrismVector(height: number = DEFAULT_PRISM_HEIGHT): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: height }
}

/**
 * **圆台的多边形近似**（S4.3）：交给 `solid.create_polyhedron` 的 `vertices` / `faces`。
 *
 * ## 为什么是"算出来的一组顶点"，而不是一种新的 DSL 图元
 *
 * 设计里台体那一条写死了"走 `polyhedron3`、**不新增 DSL 图元**"。圆台与棱台的区别只在底面：
 * 棱台有题面点名的顶点，圆台没有 —— 所以它的两个环由**内核的多边形近似**生成
 *（`buildSolid("roundFrustum", …)`，与圆柱 / 圆锥同一套分段口径），再原样交给既有的多面体动作。
 *
 * ## 为什么把弦高误差一并交出去
 *
 * 设计 §S4.3 要求"在文档与面板上**如实声明是近似**"。光说"近似"没用，得说出**差多少**：
 * 弦高 `R(1 − cos(π/N))` 就是多边形的那条边离理想圆弧最远的那一点。所以它随顶点一起返回，
 * 由调用方写进 assumption —— 用户看到的圆台旁边就有那句"这是近似、差多少"。
 */
export interface RoundFrustumPolyhedron {
  vertices: { x: number; y: number; z: number }[]
  faces: number[][]
  /** 实际用的分段数（调用方要写进 assumption）。 */
  segments: number
  /**
   * 弦高误差：多边形的边到理想圆弧的最大距离。
   *
   * **按两个半径里较大的那一个算**（2026-10-10 更正）：原先写死按**下底**算，理由写着
   * "它是两个环里较大的那个风险" —— 那句话只在 `R下 > R上` 时成立，而题面完全可以给一只
   * **上底更大**的圆台。按小的那一环报误差是**少报**：用户据此判断"这张图够不够用"会被误导。
   */
  chordError: number
}

/**
 * **圆台近似的弦高误差** `R(1 − cos(π/N))`：多边形的那条边离理想圆弧最远的那一点。
 *
 * 真源只留这一处 —— 夹具那条路（`roundFrustumPolyhedron`）与编译期那条路
 *（`planCompiler` 给模型造出来的圆台补的近似声明）都调它。两边各写一份公式就会分叉，
 * 而分叉出来的数字看起来一样"像那么回事"。
 */
export function roundFrustumChordError(radius: number, segments: number): number {
  return radius * (1 - Math.cos(Math.PI / segments))
}

export function roundFrustumPolyhedron(input: {
  radiusBottom: number
  radiusTop: number
  height: number
  segments?: number
}): RoundFrustumPolyhedron {
  const segments = input.segments ?? DEFAULT_SOLID_SEGMENTS
  const built = buildSolid(
    "roundFrustum",
    { center: { x: 0, y: 0, z: 0 }, radiusBottom: input.radiusBottom, radiusTop: input.radiusTop, height: input.height, segments },
    createBuilderContext("round-frustum")
  )
  // 构造失败**不许静默**：这里把内核的诊断原样抛出去，调用方拿到的是一句能读的话。
  if (built.diagnostics.length > 0) throw new Error(`圆台构造失败：${built.diagnostics.map((entry) => entry.message).join("；")}`)
  const byId = new Map(built.primitives.map((primitive) => [primitive.id, primitive]))
  const index = new Map(built.vertexIds.map((id, position) => [id, position]))
  // 顶点顺序 = `vertexIds` 的顺序（内核保证先下底环、再上底环）；面环由 `face3.pointIds` 换成下标。
  const vertices = built.vertexIds.map((id) => {
    const point = byId.get(id)
    if (point?.type !== "point3") throw new Error(`圆台的顶点 ${id} 不是空间点。`)
    return { ...point.position }
  })
  const faces = built.faceIds.map((id) => {
    const face = byId.get(id)
    if (face?.type !== "face3") throw new Error(`圆台的面 ${id} 不是面环。`)
    return face.pointIds.map((pointId) => {
      const position = index.get(pointId)
      if (position === undefined) throw new Error(`圆台的面 ${id} 引用了环外顶点 ${pointId}。`)
      return position
    })
  })
  return { vertices, faces, segments, chordError: roundFrustumChordError(Math.max(input.radiusBottom, input.radiusTop), segments) }
}

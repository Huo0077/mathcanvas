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

/**
 * 能被"采样求交"当作曲线的一维图元类型 —— **唯一真源**。
 *
 * 这条名单以前在五处各写了一遍（内核的 `SampledPrimitive` 联合类型与采样分支、dsl 的文档校验、
 * scene-graph 的重算取源、web 的预览、web 的"手动建交点"按钮）。于是"切线能不能和别的图元求交"
 * 这个问题取决于你问的是哪一处 —— 实测结果就是切线在**所有**地方都不能求交，用户看到的是
 * "由动点引申出来的图元（切线、动圆）反映不出和其他图元的交点"。
 *
 * 放在 `@draw/dsl` 而不是内核：依赖方向是 `dsl → kernel → scene-graph → web`，内核已经 import dsl；
 * 反向 import 会成环。内核的 `SampledPrimitive` 从这张表**派生**，并在采样函数里做 `never` 穷尽性检查 ——
 * 于是"往表里加了类型却忘了写采样"是**编译错误**，而不是运行期静默地没有交点。
 *
 * `analysisSet` 故意不在名单里：它存的是离散的零点 / 极值 / 拐点，没有曲线几何，
 * "它和某条曲线的交点"不是交点的定义。
 */
export const SAMPLED_PRIMITIVE_TYPES = [
  "line",
  "segment",
  "ray",
  "polyline",
  "circle",
  "arc",
  "parabola",
  "ellipse",
  "hyperbola",
  "function",
  // 由其它图元引申出来的：切线 / 法线 / 割线画出来是可视线段，导函数 / 积分区域自带采样点。
  "tangent",
  "normal",
  "secant",
  "derivative",
  "integral"
] as const

export type SampledPrimitiveType = (typeof SAMPLED_PRIMITIVE_TYPES)[number]

export function isSampledPrimitiveType(type: string): type is SampledPrimitiveType {
  return (SAMPLED_PRIMITIVE_TYPES as readonly string[]).includes(type)
}

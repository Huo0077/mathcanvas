/**
 * 图元类型名的**唯一真值列表**（运行时）。
 *
 * 为什么需要它：`types.ts` 的 `PrimitiveSpec` 是**类型**联合，运行时无法枚举，
 * 而 Agent 的能力注册表必须在运行时说清"这 42 个类型各自可不可用"——没有一份列表就无从对齐。
 *
 * **漂移防护（两道，缺一不可）**：
 * 1. `PrimitiveSpec` 里新增一个成员而这里没加 → `capabilities.ts` 的
 *    `satisfies Record<PrimitiveSpec["type"], CapabilityDescriptor>` 会**编译失败**；
 * 2. 这里多加一个 `types.ts` 不存在的名字 → `satisfies readonly PrimitiveSpec["type"][]`
 *    在**编译期**就报错。
 *
 * 所以这份列表不需要靠"记得同步"来维持 —— 两道断言把两个方向都钉住了。
 */
import type { PrimitiveSpec } from "./types"

export const PRIMITIVE_TYPE_NAMES = [
  "point",
  "point3",
  "line",
  "line3",
  "segment",
  "segment3",
  "ray",
  "ray3",
  "polyline",
  "connection",
  "locus",
  "parabola",
  "ellipse",
  "hyperbola",
  "function",
  "derivative",
  "tangent",
  "normal",
  "secant",
  "integral",
  "analysisSet",
  "cube",
  "pyramid",
  "cylinder",
  "cone",
  "plane3",
  "circle3",
  "edge3",
  "face3",
  "polyhedron3",
  "section",
  "intersectionLine",
  "intersectionSolid",
  "intersectionFace",
  "intersectionPoint3",
  "circle",
  "arc",
  "intersection",
  "lineCircleIntersection",
  "circleIntersection",
  "curveIntersection",
  "intersectionSet"
] as const satisfies readonly PrimitiveSpec["type"][]

/** 运行时用的图元类型名。 */
export type PrimitiveTypeName = (typeof PRIMITIVE_TYPE_NAMES)[number]

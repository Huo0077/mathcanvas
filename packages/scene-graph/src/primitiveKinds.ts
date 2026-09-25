import type { PrimitiveSpec, SolidConstruction } from "@draw/dsl"

/**
 * **图元的种类判据**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 三个纯函数：可以绕定点旋转的封闭曲线是哪几类、一个实体构造是不是"由来源 id 描述"、
 * 以及一条曲线是不是"描述某个函数"（导数 / 切线 / 法线 / 割线 / 积分 / 分析集）。
 *
 * 它们被**删除级联**（`./deletion`）与 `operations.ts` 两边同时用到，所以住在这里 ——
 * 放在任何一边都会让另两边互相 import 成环。
 */

/** 可以绕定点旋转的封闭曲线：圆与椭圆（弧 / 抛物线 / 双曲线不是封闭曲线，没有这个能力）。 */
export function isPlaceableConic(primitive: PrimitiveSpec): primitive is Extract<PrimitiveSpec, { type: "circle" | "ellipse" }> {
  return primitive.type === "circle" || primitive.type === "ellipse"
}

export type SourceIdSolidConstruction = Extract<SolidConstruction, { sourceIds: string[] }>

export function isSourceIdConstruction(construction: SolidConstruction | undefined): construction is SourceIdSolidConstruction {
  return construction !== undefined && construction.kind !== "prism"
}

/** Derivative curve, tangent, normal, secant, integral region and analysis set all describe one function. */
export function functionAnalysisSourceId(primitive: PrimitiveSpec): string | null {
  switch (primitive.type) {
    case "derivative":
    case "tangent":
    case "normal":
    case "secant":
    case "integral":
    case "analysisSet":
      return primitive.sourceId
    default:
      return null
  }
}

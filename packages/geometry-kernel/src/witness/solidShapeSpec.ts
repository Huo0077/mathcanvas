/**
 * **形状数据化**（S2；见 [立体图形覆盖扩宽设计](../../../../docs/superpowers/specs/2026-10-06-solid-shape-coverage-design.md) §3.1）。
 *
 * 四层共用的**形状描述**：入口语法产出它、搜索层按它枚举候选、内核按它构造坐标、核验器按它核题设。
 * 放在内核里，是因为它是四层共用的词汇（agent-core 已经依赖内核）。
 *
 * ## YAGNI（写死在这里，防"以后可能用得上"膨胀）
 *
 * 只含首批四族**真的用得到**的字段：新增一个 `FreeScalarKind` 是内核局部改动；
 * **新增一个顶层字段必须先有一次对应的形状块落地**。
 *
 * ## 自由标量（`FreeScalar`）的口径
 *
 * 题面没给、由搜索层在**固定的小整数网格**上决定的标量：**无连续优化、无 RNG**（沿用既有口径）。
 * `candidates` 存的是**固定值表**本身；"这一次用哪个顺序去试"是搜索层的 `seededOrder` 的事 ——
 * 放进 spec 会让同一份形状描述随 seed 变形。
 */
import type { WitnessRelation } from "./constructors"

export type SolidShapeFamily = "pyramid" | "prism" | "frustum" | "sphere-relation"

export type FreeScalarKind = "base-edge" | "base-angle" | "height" | "top-scale" | "radius"

export interface FreeScalar {
  /** 机器可读 id，会原样进 assumptions 给用户看。 */
  id: string
  kind: FreeScalarKind
  /** 这个标量作用在哪些点名上（例如 `["A","B"]`）。 */
  targets: string[]
  /** 候选值表：固定的小整数/小角度。**不要把 seed 的顺序写进来。** */
  candidates: number[]
}

export interface SolidShapeSpec {
  family: SolidShapeFamily
  /** 底面环，按题面点名顺序。 */
  base: string[]
  /** 棱锥：顶点与垂足。 */
  apex?: { at: string; foot?: string }
  /** 棱柱 / 台体：顶面环。 */
  top?: string[]
  /** 已解析的题设关系（与既有 `WitnessRelation` 同一套）。 */
  relations: WitnessRelation[]
  freeScalars: FreeScalar[]
}

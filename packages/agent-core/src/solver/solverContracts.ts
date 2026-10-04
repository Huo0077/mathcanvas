import type { Vector3 } from "@draw/geometry-kernel"

import type { ClaimEvidence, GeometryObligation } from "../claimEvidence"
import type { Relation } from "../relations"

/**
 * **见证搜索的契约**（N2 子任务 2b；计划 N2 的 `Interfaces`）。
 *
 * 这里只放**形状**，不放任何判定：搜索怎么排候选、怎么验、怎么分类都在
 * `solver/witnessSearch.ts`；纯几何构造与残差在内核 `witness/`；证据词表在 N1 的
 * `claimEvidence.ts`。三者的分工是这一层唯一要守住的纪律 ——
 * 一旦契约里出现了"什么算通过"的判据，第二个判据就会从这里长出来。
 *
 * ## 为什么 `PolyhedronWitness` 定义在这里，而不是留在 `underdetermined.ts`
 *
 * 它的**唯一**消费者是搜索器（`candidate: PolyhedronWitness`）与 `selectWitness` 的
 * polyhedron 分支。定义留在 facade 里会让 solver 反过来依赖 facade ——
 * 而裁决 R13 定的方向恰好相反：**筛选与排序逻辑搬进 solver，facade 只是入口**。
 * `underdetermined.ts` 因此改成 re-export（那里的 `WitnessValue` 仍然引用它），
 * 对外名字一个字节都没变。
 *
 * `names` 与 `vertices` 按下标对应，关系表用**下标名**（`v0`、`v1`…）引用顶点
 * （设计 2026-10-03 §2 决定 7：第一批关系目标只支持顶点）。
 */
export interface PolyhedronWitness {
  vertices: Vector3[]
  /** 顶点名，与题面一致；关系表按下标约定引用（`v0`、`v1`…）。 */
  names: string[]
  /** 面环，元素是 `vertices` 的下标。 */
  faces: number[][]
}

/** 首批图形族。`polyhedron` 表示"任意多面体"，它的坐标只能由调用方给出（见下）。 */
export type WitnessShapeKind = "polyhedron" | "prism" | "pyramid"

export interface WitnessSearchInput {
  /** 题设（N1 的 `GeometryObligation`；`role` 决定它是题设、目标还是自由选择）。 */
  obligations: readonly GeometryObligation[]
  shape: WitnessShapeKind
  /** 确定性种子：同一 seed 必须给出同一顺序、同一结果（R26）。 */
  seed: number
  /** 候选数上限：真的生效（在候选之间检查），耗尽时如实报"没试完"。 */
  maxCandidates: number
  /** 预算（毫秒）：真的生效（每个候选之前检查），耗尽时如实报超时，不许写成"不存在见证"。 */
  timeoutMs: number
}

/**
 * 三值结果（R25：**不新增第四个值**）。
 *
 * 原因落在 `ClaimEvidence.status` 上（`timeout` / `inconsistent` / `unknown`），
 * 机器可读的原因码落在 `failures` / `reasons` 的每条前缀上。
 */
export type WitnessSearchResult =
  | { status: "verified_instance"; candidate: PolyhedronWitness; evidence: ClaimEvidence; assumptions: string[] }
  | { status: "no_witness"; evidence: ClaimEvidence; failures: readonly string[] }
  | { status: "unverified_instance"; evidence: ClaimEvidence; reasons: readonly string[] }

/**
 * **机器可读的原因码**（R25：`failures` / `reasons` 里必须有码）。
 *
 * 只有一张表：调用方按前缀分流，不许再按文案做字符串匹配 ——
 * 文案会改，码不会。逐条题设的失败**不加新码**，用原话 `sourceText` 作键
 *（`ClaimEvidence.residuals` 也是这套键，两边自然对得上）。
 */
export const WITNESS_SEARCH_CODES = {
  /** 同一条线段被给了两个长度（题设自相矛盾，冲突证据直接可查）。 */
  contradictoryGiven: "contradictory-obligations",
  /** 线段两个端点都在它自称垂直的平面内。 */
  contradictoryLinePlane: "contradictory-line-plane",
  /** 从题设推不出这一族需要的结构（底面环 / 顶点 / 垂足）。 */
  unsupportedShape: "unsupported-shape",
  /** 任意多面体的坐标必须由调用方给出，搜索器不凭空造。 */
  requiresCandidates: "requires-candidates",
  /** 题设里有一条判性不是 `supported` 的 claim：不能按"已核验"处理。 */
  unjudgeable: "unjudgeable-obligation",
  /** 统一核验器对某条题设给不出读数（点名缺失 / 退化 / 算不出角度）。 */
  unverified: "unverified-obligation",
  /** 候选上限用完，后面还有候选没试 —— 不是"题设不成立"。 */
  candidateCapExhausted: "candidate-cap-exhausted",
  /** 预算耗尽（R25：必须写成"在预算内没有找到"）。 */
  budgetTimeout: "budget-timeout",
  /** 所有候选都在构造期被拒，没有得到任何可核验的坐标。 */
  noCandidateConstructed: "no-candidate-constructed",
  /** 有候选通过了几何构造，但没有一个满足全部可判题设。 */
  noCandidateVerified: "no-candidate-verified",
  /** 逐条题设的失败说明（后面接原话）。 */
  failedGiven: "failed-given",
  /** 内核 `buildFromPoints` 拒掉了候选拓扑（绕向 / 共面 / 零体积…）。 */
  topologyRejected: "topology-rejected",
  /** 候选没能通过既有编译路径落成文档。 */
  materialisationFailed: "materialisation-failed"
} as const

export type WitnessSearchCode = (typeof WITNESS_SEARCH_CODES)[keyof typeof WITNESS_SEARCH_CODES]

/**
 * **既有 polyhedron 候选的筛选与排序**（R13：这段逻辑的**唯一**实现）。
 *
 * `selectWitness` 只把它包成自己的老形状（`considered` / `assumption` / 诊断），
 * 不再自己抄一份筛选 —— 生产调用方 `parameterAudit.ts:125` 只请求 triangle / prism，
 * 所以这条路径的行为必须逐字不变，而"逐字不变"最可靠的保证就是只有一份实现。
 */
export interface PolyhedronWitnessSelectionInput {
  candidates: readonly PolyhedronWitness[]
  relations: readonly Relation[]
}

export type PolyhedronWitnessSelection =
  | { status: "selected"; candidate: PolyhedronWitness; index: number; considered: string[] }
  | { status: "none"; considered: string[] }

import { attemptAutomaticProof, readProofGoal, type DiagramObligationSet, type ProofChannel } from "@draw/agent-core"

import { createDesktopProofChannel } from "./desktopProofChannel"

/**
 * **产品侧自动调用的那一处逻辑**（V2 GREEN 缺口③ 的最后一步）。
 *
 * ## 它做四件事，一件都不多
 *
 * 1. **从题面的目标句里挑一条能证的**（`readProofGoal` 复用题设那张句型表）；
 * 2. 把**系统按类给的正文**（`canonicalProof`）和**桌面通道**交给库里的编排；
 * 3. 把结果压成**草稿能带着走的一小段**（`DraftProofAttempt`）；
 * 4. **绝不抛**：这条路的任何失败都只是"没有证明"，**不影响作图**。
 *
 * ## 三条边界（与库里那层一致，这里只是搬运）
 *
 * - **旗关着 ⇒ 一个字节都不动**（连通道都不构造）：默认路径逐字不变是验收条件；
 * - **没有可证的目标 ⇒ 如实说"没有"**（不是失败，是"这道题今天没有可形式化的主张"）；
 * - **浏览器里跑不了 ⇒ 如实说"要桌面版"**（不是错误）。
 *
 * ## 为什么正文用系统那一份
 *
 * 这条产品路径**没有模型在场**（它是"跑完作图顺手证一下"，不是模型回合的一部分）。
 * 三类的正文都由系统给出（`canonicalProof.ts`），而且 `proofSource` 会如实标成
 * `system-canonical` —— 用户有权知道这条证明是谁写的。
 */

/** 草稿要带着走的那一小段（**故意做小**：不把通道、桥、产物塞进草稿记录）。 */
export interface DraftProofAttempt {
  /** 结局词表与库里那一层同源（多一个 `no_goal`：这道题没有可证的目标句）。 */
  outcome: "no_goal" | "verified" | "rejected" | "timeout" | "toolchain_unavailable" | "premises_unresolved" | "internal_error" | "capability_off"
  /** 给用户看的一句话（面板/诊断直接显示它）。 */
  detail: string
  /** 证成了才有：产物绑在哪条 claim 上。 */
  claimId: string | null
  /** 正文来源（`system-canonical` = 系统按类给的）。 */
  proofSource: "model" | "system-canonical" | null
  /** 系统替用户做的选择（读了哪条目标、平面内取了哪两条相交线…）。 */
  choices: string[]
}

export interface ProofStageRequest {
  /** 题面原话（解析出的题设与目标都在里面）。 */
  prompt: string
  obligations: DiagramObligationSet
  /** `agentNextPhaseFlags().proofExport`。**关着就什么都不做。** */
  flagEnabled: boolean
  /** 注入的通道（测试用）；缺省走桌面壳那条。 */
  channel?: ProofChannel
  /** 实测后端版本串（没有它适配器不产出产物）。 */
  backendVersion?: string
  claimId?: string
}

/**
 * **跑一次（或如实不跑）**。
 *
 * 返回 `null` 只在**旗关着**时发生 —— 那是"这条路根本没开"，调用方据此**不往草稿里写任何字段**
 *（默认路径逐字不变靠的就是这一条）。
 */
export async function attemptProofForStage(request: ProofStageRequest): Promise<DraftProofAttempt | null> {
  if (!request.flagEnabled) return null

  const goalText = request.obligations.goals.find((text) => readProofGoal(text, request.obligations).ok)
  if (goalText === undefined) {
    return {
      outcome: "no_goal",
      detail: "题面里没有可形式化的目标句（今天支持：线⊥面、线⊥线、在某点处的切线）—— 作图不受影响。",
      claimId: null,
      proofSource: null,
      choices: []
    }
  }
  const read = readProofGoal(goalText, request.obligations)
  if (!read.ok) {
    // `find` 已经保证这一条读得出；走到这里说明两次读的结果不一致（上游有状态）——
    // 如实报成内部问题，而不是假装"没有目标"。
    return { outcome: "internal_error", detail: `同一条目标句两次读的结果不一致：${read.reason}`, claimId: null, proofSource: null, choices: [] }
  }

  const result = await attemptAutomaticProof({
    base: "verified_instance",
    claimId: request.claimId ?? `draft-goal:${goalText}`,
    prompt: request.prompt,
    claimSourceText: read.reading.sourceText,
    assumptions: read.reading.choices,
    goal: read.reading.goal,
    obligations: request.obligations,
    proofSource: "system-canonical",
    flagEnabled: true,
    channel: request.channel ?? createDesktopProofChannel(),
    backendVersion: request.backendVersion
  })

  return {
    outcome: result.outcome === "flag_off" || result.outcome === "no_proof_body" || result.outcome === "goal_unsupported" ? "internal_error" : result.outcome,
    detail: result.detail,
    claimId: result.artifact?.claimId ?? null,
    proofSource: result.proofSource,
    choices: read.reading.choices
  }
}

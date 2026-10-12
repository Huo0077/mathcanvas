import type { DiagramCheck, DiagramVerificationReport } from "@draw/agent-core"

/**
 * **核验那一条在确认面板上怎么念**（2026-10-12 裁决 A；单独成模块的理由与
 * `confirmationCounts.ts` 相同：面板只导出组件，`react-refresh` 才能正确热替换它）。
 *
 * ## 改的是什么
 *
 * 关系型条件失败时，编译器给的 `reason` 是 `实测 0.24254，题设要求 0。`，用户看到的是
 * `PA ⊥ 平面 ABCD：不满足。实测 0.24254，题设要求 0。`。这句话**读不通**：
 * 「题设要求 0」里的那个 0 **不是题面里的任何数字**，它的意思是"这一类条件要求偏差归零"
 *（垂直 / 平行这类关系条件量的是残差，残差应为 0）。旧读法会让人以为题面写过 0。
 *
 * ## 为什么在这里改，而不是去改编译器那句话
 *
 * 那句话是**编译器输出的一部分**，被 `planCompiler4707b64.golden.json` 逐字钉着
 *（"关旗旧路径与基线逐字节相同"），改它就等于**放宽一条已经声明过的保证**。
 * 而面板本来就拿得到结构化字段（`expected` / `actual`），所以只改"怎么念给用户听"，
 * 契约一个字不动。
 *
 * ## 只换这一种句式，其余原样透传
 *
 * `diagramVerification.ts:677-680` 只对**没有 `detail`** 的那一族关系型条件用这句通用模板；
 * 圆锥曲线 / 切线 / 函数曲线那几族的失败文案是 `detail + 最大偏差 …，容差 …。`，
 * 里面带着"哪根轴反了""切点画在哪"这类**别处没有的信息** —— 重写它们只会丢信息。
 *
 * 所以这条判据同时要求四件事：状态是 `failed`、期望偏差是 `0`、`actual` 是数字、
 * **且** `reason` 逐字就是那句通用模板。少任何一条都原样透传。
 */
const GENERIC_ZERO_DEFECT = /^实测 \S+，题设要求 0。$/

export function describeCheckReason(check: Pick<DiagramCheck, "status" | "reason" | "expected" | "actual">): string {
  if (
    check.status === "failed" &&
    check.expected === 0 &&
    typeof check.actual === "number" &&
    GENERIC_ZERO_DEFECT.test(check.reason)
  ) {
    // 数字的五位有效数字**与编译器那句保持一致**（`diagramVerification.ts:680` 也是 `toPrecision(5)`），
    // 否则同一个偏差在两处显示成两个数。
    return `实测偏差 ${check.actual.toPrecision(5)}（这一类条件要求偏差归零）。`
  }
  return check.reason
}

/**
 * **每一条读数的证据等级怎么念**（Task 15）。
 *
 * 三种等级不是"可信度打分"，而是**这条读数是怎么来的**：
 * 代数判别式（不依赖采样分辨率）／数值求根 + 独立回代／只有采样折线上的比较。
 * 表按 `DiagramCheck["evidence"]` 的联合类型写成 `Record`，将来多一档就编译不过。
 */
export const EVIDENCE_LABEL: Record<NonNullable<DiagramCheck["evidence"]>, string> = {
  algebraic: "由代数判别式解出",
  "verified-numeric": "数值求根并独立回代",
  "plot-only": "只有采样折线上的比较"
}

export function describeCheckEvidence(check: Pick<DiagramCheck, "evidence">): string | null {
  return check.evidence === undefined ? null : EVIDENCE_LABEL[check.evidence]
}

/**
 * **这一轮核验的范围怎么念**（Task 15）。
 *
 * 面板上"通过 2 / 失败 0 / 未核验 0"很容易被读成"这道题做对了"。它实际说的是
 * **一个图形实例**（图上带参数取值时更弱）在核验器那几条判据下成立 ——
 * 与"对所有参数成立""整题已证明"是两句话。范围与全称状态各说一句，都由报告字段推出来。
 */
export const PROOF_SCOPE_LABEL: Record<DiagramVerificationReport["proofScope"], string> = {
  "figure-instance": "一个图形实例",
  "parameter-instance": "图上带参数取值的实例"
}

export const UNIVERSAL_CLAIMS_LABEL: Record<DiagramVerificationReport["universalClaims"], string> = {
  "not-proven": "图上成立不等于全称成立：这一轮没有证明任何「对所有参数 / 整个定义域都成立」的主张。"
}

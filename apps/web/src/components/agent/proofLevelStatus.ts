import { PROOF_BACKEND_REVIEW_FIELDS, PROOF_BACKEND_REVIEWS, WIRED_PROOF_BACKENDS, type ClaimEvidenceStatus, type ProofCheckStatus, type ProofReviewVerdict } from "@draw/agent-core"

/**
 * **「证明级别」这一档今天到底是什么状态**（N5a 第二件事；只读，不生产任何东西）。
 *
 * ## 为什么这段文案必须**推导**
 *
 * 界面上最容易腐烂的一句话是"当前不支持形式证明"。它在写下的那一天是真的，在接上后端的那一天
 * 变成**谎话**，而且不会有任何东西提醒 —— 没有断言、没有用例、没有编译错误。
 * 所以这里不写结论，只写**规则**：事实（`WIRED_PROOF_BACKENDS` / `PROOF_BACKEND_REVIEWS`）
 * 变了，句子跟着变。配套用例里那条最要紧的判据是"注入一个假后端之后文案必须出现它的名字"——
 * 一个把结论写死的实现会在那里红。
 *
 * **"推导"到底推到什么程度**（这条边界上一版写错过一次，复核 I1 抓的就是它）：
 * - **数字与名单**（后端个数、后端名、审查栏数、审查记录条数）一律**从值推导**；
 * - **词**（`formally_proved` / `verified` / `passed`）**用类型钉住**（见下面三个常量）——
 *   词表里改了名，`typecheck` 会红，而不是让界面继续说旧词；
 * - **一句也不许把结论写死**。"今天恰好为真的数字"与"写死的结论"是同一类东西：
 *   它们都会在事实变了之后变成界面上的一句错话，而**没有任何东西会提醒**。
 *
 * ## 这里**不**做"产物正文查看器"（明确不做，不是漏了）
 *
 * 查证结果：`ProofArtifact` / `proofInputHash` / `evidenceStatusWithProof` 在 `apps/` 与 `packages/` 里
 * 除了 proof 模块自身、它的用例与 `scripts/proof-spike/` 之外**零引用** ——
 * 也就是说**今天没有任何代码会生产 proof artifact**，也没有任何通道能把它送进界面。
 * 为一个**永远跑不到**的生产路径做查看器，只能用注入的假数据测，按本仓口径那是**弱证据**：
 * 它证明的是"组件能渲染假数据"，不是"用户能看到他的证明"。
 * 等第一个后端过了那份审查准入（那时才有真数据）再做 —— 这条理由也写进了
 * `docs/current-status.md` §四 F。
 *
 * ## 单独成模块的两个理由（与 `confirmationCounts.ts` 同一条纪律）
 *
 * 1. `ConfirmationPanel.tsx` / `ProofLevelNotice.tsx` 只导出组件，`react-refresh` 才能正确热替换；
 * 2. 这段判断要能**单独测** —— 它决定了界面上会说哪几句话，而那本身就是产品判断。
 */

/**
 * 界面上要说的三个**词**。
 *
 * 数字与名单从**值**推导；词用**类型**钉住：`ClaimEvidenceStatus` / `ProofCheckStatus` /
 * `ProofReviewVerdict` 里改了名（或删了这一档），`typecheck` 会红 ——
 * 而不是让界面继续说一个已经不存在的词。
 */
const FORMALLY_PROVED: ClaimEvidenceStatus = "formally_proved"
const CHECK_VERIFIED: ProofCheckStatus = "verified"
const REVIEW_PASSED: ProofReviewVerdict = "passed"

/** 决定"这一档今天是什么状态"的**全部**事实。两个字段都来自包根导出，没有第三个来源。 */
export interface ProofLevelFacts {
  /** 真正接进这个构建的后端名（`WIRED_PROOF_BACKENDS`）。 */
  wired: readonly string[]
  /**
   * 交过审查记录的后端条数（`PROOF_BACKEND_REVIEWS.length`）—— 不等于"接上了几个"。
   *
   * **不变量：`reviewedCount >= wired.length`。** 接上的名单是从审查记录里**过滤**出来的，
   * 所以"接上 1 个、交过审查记录 0 条"在生产里不可能出现。注入面是两个独立的字段，
   * 类型上强制不了它，但**用例只渲染可达的组合**（见 `proofLevel.test.tsx` 的 `renderWired`），
   * 免得拿一个生产里不存在的读数当事实（复核 M2）。
   */
  reviewedCount: number
}

/**
 * 这一档的状态与要说的话。
 *
 * **话里的每个数字与名单都是推出来的**（`facts` 的两个字段，或那份审查栏契约的长度），
 * 没有一句把结论写死；涉及的**词**另有类型钉着。见 `describeProofLevel`。
 */
export interface ProofLevelStatus {
  wiredCount: number
  reviewedCount: number
  /** 今天这个构建里，一条 claim 有没有可能升到 `formally_proved`。 */
  reachable: boolean
  heading: string
  lines: string[]
}

/**
 * 本构建的真实事实（在模块加载时取一次，就是那两份包根导出**本身**，不是副本）。
 * 界面侧**唯一**的读取点：`ProofLevelNotice` 的缺省值走这里。
 */
export const PROOF_LEVEL_CURRENT: ProofLevelFacts = {
  wired: WIRED_PROOF_BACKENDS,
  reviewedCount: PROOF_BACKEND_REVIEWS.length
}

/**
 * 把事实说成人话。
 *
 * **这里没有任何一个数字或名字是手写下来的**：要么来自 `facts`（后端个数、后端名、
 * 审查记录条数），要么来自包根那份审查栏契约的**长度**（`PROOF_BACKEND_REVIEW_FIELDS.length`，
 * 也就是"十栏"那个数字 —— 它上一版是写死的，复核 I1 抓到之后改成推导）。
 * 唯一的例外是三个**词**，它们由上面的类型常量钉住，不走推导（词不是值）。
 */
export function describeProofLevel(facts: ProofLevelFacts): ProofLevelStatus {
  const wiredCount = facts.wired.length
  const reviewedCount = facts.reviewedCount
  // 审查栏数**从契约推导**：手写"十栏"就是在赌那份契约不再增删。
  const requiredReviewFields = PROOF_BACKEND_REVIEW_FIELDS.length

  if (wiredCount === 0) {
    return {
      wiredCount,
      reviewedCount,
      reachable: false,
      heading: "形式证明这一档：当前没有接入任何形式证明后端",
      lines: [
        `接上的形式证明后端 ${wiredCount} 个（交过审查记录的后端 ${reviewedCount} 个）。`,
        // 后果必须说出来：只说"没有接"读起来像一句免责声明，用户不会知道它意味着什么。
        `后果：本条的证明级别不可能升到 ${FORMALLY_PROVED}；能给的只是一个实例的核验 —— 这一组示例值满足题设，不等于题设普遍成立。`,
        `要接上一个后端，得先交一份 ${requiredReviewFields} 栏填齐、结论为 ${REVIEW_PASSED} 的审查记录：名字写进名单不算接上。`
      ]
    }
  }

  const lines = [
    `接上的后端：${facts.wired.join("、")}。`,
    // **刻意不逐项列举"输入绑定了哪几栏"**：那份清单会是 `ProofInput` 的第二份副本，
    // 契约一增删就腐烂（与写死"十栏"同型，复核 I1）。要说清单，去读那份契约本身 ——
    // 这里只说"全部绑定项"，既不丢信息也不留一份会过期的抄本。
    `只有后端回 ${CHECK_VERIFIED}、且产物与本条 claim 与这份输入的全部绑定项都吻合时，本条才会升到 ${FORMALLY_PROVED}。`
  ]
  if (reviewedCount > wiredCount) {
    lines.push(`交过审查记录的后端共 ${reviewedCount} 个，其中 ${wiredCount} 个结论为 ${REVIEW_PASSED} —— 其余的没有接上。`)
  }
  return { wiredCount, reviewedCount, reachable: true, heading: `形式证明这一档：本构建接上了 ${wiredCount} 个形式证明后端`, lines }
}

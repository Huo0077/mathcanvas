import { PROOF_BACKEND_REVIEWS, WIRED_PROOF_BACKENDS } from "@draw/agent-core"

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
 * ## 这里**不**做"产物正文查看器"（明确不做，不是漏了）
 *
 * 查证结果：`ProofArtifact` / `proofInputHash` / `evidenceStatusWithProof` 在 `apps/` 与 `packages/` 里
 * 除了 proof 模块自身、它的用例与 `scripts/proof-spike/` 之外**零引用** ——
 * 也就是说**今天没有任何代码会生产 proof artifact**，也没有任何通道能把它送进界面。
 * 为一个**永远跑不到**的生产路径做查看器，只能用注入的假数据测，按本仓口径那是**弱证据**：
 * 它证明的是"组件能渲染假数据"，不是"用户能看到他的证明"。
 * 等第一个后端过了十栏准入（那时才有真数据）再做 —— 这条理由也写进了
 * `docs/current-status.md` §四 F。
 *
 * ## 单独成模块的两个理由（与 `confirmationCounts.ts` 同一条纪律）
 *
 * 1. `ConfirmationPanel.tsx` / `ProofLevelNotice.tsx` 只导出组件，`react-refresh` 才能正确热替换；
 * 2. 这段判断要能**单独测** —— 它决定了界面上会说哪几句话，而那本身就是产品判断。
 */

/** 决定"这一档今天是什么状态"的**全部**事实。两个字段都来自包根导出，没有第三个来源。 */
export interface ProofLevelFacts {
  /** 真正接进这个构建的后端名（`WIRED_PROOF_BACKENDS`）。 */
  wired: readonly string[]
  /** 交过审查记录的后端条数（`PROOF_BACKEND_REVIEWS.length`）—— 不等于"接上了几个"。 */
  reviewedCount: number
}

/** 这一档的状态与要说的话。**每一句都由 `facts` 推出**，没有常量句。 */
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
 * 把事实说成人话。**没有分支是写死的结论** —— 每个句子都带上了让它成立的那个数字或名字，
 * 这样"注入假后端之后名字必须出现"才是可判定的。
 */
export function describeProofLevel(facts: ProofLevelFacts): ProofLevelStatus {
  const wiredCount = facts.wired.length
  const reviewedCount = facts.reviewedCount

  if (wiredCount === 0) {
    return {
      wiredCount,
      reviewedCount,
      reachable: false,
      heading: "形式证明这一档：当前没有接入任何形式证明后端",
      lines: [
        `接上的形式证明后端 ${wiredCount} 个（交过审查记录的后端 ${reviewedCount} 个）。`,
        // 后果必须说出来：只说"没有接"读起来像一句免责声明，用户不会知道它意味着什么。
        "后果：本条的证明级别不可能升到 formally_proved；能给的只是一个实例的核验 —— 这一组示例值满足题设，不等于题设普遍成立。",
        "要接上一个后端，得先交一份十栏填齐、结论为 passed 的审查记录：名字写进名单不算接上。"
      ]
    }
  }

  const lines = [
    `接上的后端：${facts.wired.join("、")}。`,
    "只有后端回 verified、且产物与本条 claim、这份输入（题设原话 + claim 原话 + 目标 + 系统替你定的假设 + 被证明的命题原文）绑定时，本条才会升到 formally_proved。"
  ]
  if (reviewedCount > wiredCount) {
    lines.push(`交过审查记录的后端共 ${reviewedCount} 个，其中 ${wiredCount} 个结论为 passed —— 其余的没有接上。`)
  }
  return { wiredCount, reviewedCount, reachable: true, heading: `形式证明这一档：本构建接上了 ${wiredCount} 个形式证明后端`, lines }
}

import { PROOF_BACKEND_REVIEWS, WIRED_PROOF_BACKENDS } from "@draw/agent-core"
import { describeProofLevel } from "./proofLevelStatus"

/**
 * **「证明级别」只读状态面**：把"形式证明这一档今天是什么状态"如实摆在确认面板里。
 *
 * 三件事它**不做**：不显示任何产物正文（今天没有生产者 —— 理由见 `proofLevelStatus.ts` 的文件头）、
 * 不给用户任何能点的东西、不宣称任何一条 claim 已被证明。它只把两份包根导出的事实说成人话，
 * 而那两句话**由事实推导**（用例：注入一个假后端之后，文案里必须出现它的名字）。
 *
 * **可注入**是为了让那条用例可写：生产路径（`ConfirmationPanel` 不传 props）用的是
 * `WIRED_PROOF_BACKENDS` / `PROOF_BACKEND_REVIEWS` 本身，没有任何一份副本。
 */
export interface ProofLevelNoticeProps {
  /** 接进这个构建的后端名。缺省＝包根导出的真实事实（今天 `[]`）。 */
  wired?: readonly string[]
  /** 交过审查记录的后端条数。缺省＝`PROOF_BACKEND_REVIEWS.length`（今天 `0`）。 */
  reviewedCount?: number
}

export function ProofLevelNotice({ wired = WIRED_PROOF_BACKENDS, reviewedCount = PROOF_BACKEND_REVIEWS.length }: ProofLevelNoticeProps) {
  const status = describeProofLevel({ wired, reviewedCount })

  return <section className="agent-proof-level" aria-label="证明级别" data-wired-backends={status.wiredCount} data-proof-reachable={status.reachable}>
    <h4>{status.heading}</h4>
    <ul>{status.lines.map((line) => <li key={line}>{line}</li>)}</ul>
  </section>
}

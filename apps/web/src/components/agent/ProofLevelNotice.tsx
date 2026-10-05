import { describeProofLevel, PROOF_LEVEL_CURRENT } from "./proofLevelStatus"

/**
 * **「证明级别」只读状态面**：把"形式证明这一档今天是什么状态"如实摆在确认面板里。
 *
 * 三件事它**不做**：不显示任何产物正文（**默认路径不产出产物**，也没有把产物送进界面的通道 ——
 * 理由见 `proofLevelStatus.ts` 的文件头）、
 * 不给用户任何能点的东西、不宣称任何一条 claim 已被证明。它只把两份包根导出的事实说成人话，
 * 而那两句话**由事实推导**（用例：注入一个假后端之后，文案里必须出现它的名字）。
 *
 * **可注入**是为了让那条用例可写：生产路径（`ConfirmationPanel` 不传 props）走的是
 * `PROOF_LEVEL_CURRENT` —— 「本构建的事实」这个模块里**唯一**的读取点，它的两个字段就是
 * 包根那两份导出**本身**（同引用，不是副本）。
 */
export interface ProofLevelNoticeProps {
  /** 接进这个构建的后端名。缺省＝包根导出的真实事实（2026-10-06 起是 `["lean4"]`）。 */
  wired?: readonly string[]
  /** 交过审查记录的后端条数。缺省＝`PROOF_BACKEND_REVIEWS.length`（2026-10-06 起是 `1`）。 */
  reviewedCount?: number
}

export function ProofLevelNotice({ wired = PROOF_LEVEL_CURRENT.wired, reviewedCount = PROOF_LEVEL_CURRENT.reviewedCount }: ProofLevelNoticeProps) {
  const status = describeProofLevel({ wired, reviewedCount })

  return <section className="agent-proof-level" aria-label="证明级别" data-wired-backends={status.wiredCount} data-proof-reachable={status.reachable}>
    <h4>{status.heading}</h4>
    <ul>{status.lines.map((line) => <li key={line}>{line}</li>)}</ul>
  </section>
}

import type { AgentDraftView } from "../../agentStore"
import { AssumptionList } from "./AssumptionList"
import { countDeltas, removedObjectCount, summarizeDraftScale } from "./confirmationCounts"
import { ProofLevelNotice } from "./ProofLevelNotice"

/**
 * **确认面板**（Task 2.5 Step 4）。
 *
 * 计划原文要求它给出："**exact changed IDs/counts**, assumptions, source/target,
 * approximation, deletion/lock warnings, and the one-undo statement"。
 *
 * ## 三条纪律
 *
 * 1. **数字必须来自宿主侧的真实文档**：`counts` / `baseCounts` 由 `HostBridge.preview` 用
 *    `countDraftObjects` 从**候选与基础两份真实文档**算出（见第二十批的接线）。这个组件**不自己数** ——
 *    界面估的数字与真正落盘的一旦不一致，用户就是在确认一件他没看见的事。
 * 2. **"看不见"与"不存在"要分开说**：内部近似细节（细分点/母线）在文档里但画布上不画；
 *    隐藏对象在文档里但确认后也看不见。各自列出来，否则用户会以为确认后画布上会多出几十个点。
 * 3. **删除要显式警告**：删掉已有对象是唯一不可逆（撤销之外）的后果，不能用好听的措辞盖过去。
 *
 * 组件**只读**：所有动作通过回调交给上层（`agentRunner`），它自己既不提交也不丢弃。
 */

export interface ConfirmationPanelProps {
  draft: AgentDraftView
  /** 之前记下的假设（例如"半径取你给的 2"）。没有就不显示这一节。 */
  assumptions?: string[]
  /** 近似说明（哪些地方不是精确结果）。 */
  approximationNotes?: string[]
  /** 会被略过的导出内容（导出预检的结论）。 */
  omittedExports?: string[]
  /** 目标文档与来源文档的标识，供用户核对"改的是哪一份"。 */
  targetDocumentId?: string
  sourceDocumentIds?: string[]
  /**
   * **这个构建里接上的形式证明后端**。缺省＝包根导出的真实事实 `WIRED_PROOF_BACKENDS`
   * （2026-10-06 起是 `["lean4"]` —— N5b 接了第一个真实后端，十栏准入记录在案）。
   *
   * 做成可注入的是为了让"文案确实是**排**出来的"这条判据能写：用例注入一个假后端，
   * 文案里就必须出现它的名字。生产路径不传它 —— 于是界面上那句话永远跟着事实走。
   */
  proofBackends?: readonly string[]
  /** 交过审查记录的后端条数。缺省＝`PROOF_BACKEND_REVIEWS.length`（2026-10-06 起是 `1`）。 */
  proofReviewedCount?: number
  onConfirm?: () => void
  onDiscard?: () => void
}

export function ConfirmationPanel({ draft, assumptions = [], approximationNotes = [], omittedExports = [], targetDocumentId, sourceDocumentIds = [], proofBackends, proofReviewedCount, onConfirm, onDiscard }: ConfirmationPanelProps) {
  const deltas = countDeltas(draft)
  const removing = removedObjectCount(draft)

  return <section className="agent-confirmation" role="region" aria-label="确认改动">
    <header className="agent-confirmation-head">
      <h3>确认之后会发生什么</h3>
      <p className="agent-confirmation-summary">{summarizeDraftScale(draft.counts, draft.baseCounts)}</p>
    </header>

    {/* 目标与来源：平台有两份文档，不说清改的是哪一份，用户没法核对。 */}
    {(targetDocumentId || sourceDocumentIds.length > 0) && <dl className="agent-confirmation-targets">
      {targetDocumentId && <div><dt>改的是</dt><dd>{targetDocumentId}</dd></div>}
      {sourceDocumentIds.length > 0 && <div><dt>来源</dt><dd>{sourceDocumentIds.join("、")}</dd></div>}
    </dl>}

    {deltas.length > 0 && <table className="agent-confirmation-counts">
      <caption>按类别</caption>
      <thead><tr><th scope="col">类别</th><th scope="col">改动前</th><th scope="col">改动后</th><th scope="col">说明</th></tr></thead>
      <tbody>
        {deltas.map((row) => <tr key={row.label} data-changed={row.after > row.before ? "added" : "removed"}>
          <th scope="row">{row.label}</th>
          <td>{row.before}</td>
          <td>{row.after}</td>
          <td>{row.note}</td>
        </tr>)}
      </tbody>
    </table>}

    {/* 删除是最该显眼的一条：它是唯一不可逆（撤销之外）的后果。 */}
    {removing > 0 && <p className="agent-confirmation-removal" role="alert">
      这次会删除 {removing} 个已有对象。删除之后只能靠撤销恢复。
    </p>}

    <dl className="agent-confirmation-meta">
      <div><dt>动作数</dt><dd>{draft.stageCount}</dd></div>
      <div><dt>草稿版本</dt><dd>{draft.draftVersion}</dd></div>
    </dl>

    {/*
      这里**原来显示"预览指纹"**，但第一个版本直接把 `draft.previewHash` 打在界面上，
      而那个字段当前其实是**整份候选文档的规范 JSON**（不是哈希）—— 于是用户在确认面板里
      看到一长串文档内容，界面上还多出一份用户几何数据的副本。
      是 e2e 把它读出来才发现的。

      **因此不显示它**：显示一份"看起来像指纹的东西"而它其实是全文，比不显示更糟。
      计划要求的是"用户确认的是哪一版"可追溯，那由 `previewHash` 在**内部**参与
      Compare-and-Swap 保证（`HostBridge` 会比对它）；等 `draftStore` 改用真正的哈希
      （`canonicalContentHash`）之后再把它露出来。详见 `docs/project-progress.md`。
    */}

    {/*
      **题面改写：「原件 → 我这样读」**（2026-10-10 第二件）。

      模型只换说法、**不许改条件**（判据在 `promptNormalization.ts` 的四道阀：指不回原文 /
      编造点名 / 换弱关系 / 改完仍读不出，任何一条不过就丢掉那一条）。但**改写必须看得见** ——
      用户有权知道系统把他那句话读成了什么，也有权看到哪几条被拒了、为什么被拒。
      没有改写时这一段**根本不出现**（`promptNormalisation` 这个键不存在）。
    */}
    {draft.promptNormalisation && <section className="agent-prompt-normalisation" aria-label="题面改写">
      <h4>系统把你的题面读成了这样</h4>
      <ul>
        {draft.promptNormalisation.accepted.map((entry) => <li key={`ok:${entry.original}`}>
          <strong>{entry.original}</strong> → <strong>{entry.normalized}</strong>（读出 {entry.givens} 条条件）
        </li>)}
        {draft.promptNormalisation.rejected.map((entry) => <li key={`no:${entry.original}`} data-rejected="true">
          <strong>{entry.original}</strong>：这条改写被拒了 —— {entry.reason}
        </li>)}
      </ul>
    </section>}

    {draft.diagramVerification && <section className="agent-diagram-verification" aria-label="题设核验" data-status={draft.diagramVerification.status}>
      <h4>{draft.diagramVerification.status === "passed" ? "符合题设的一组示意图（不是普遍证明）" : "题设尚未全部核验，不能正式确认"}</h4>
      <p>通过 {draft.diagramVerification.checks.filter((item) => item.status === "passed").length} / 失败 {draft.diagramVerification.checks.filter((item) => item.status === "failed").length} / 未核验 {draft.diagramVerification.checks.filter((item) => item.status === "unverified").length}</p>
      <ul>{draft.diagramVerification.checks.map((item, index) => <li key={`${index}:${item.sourceText}`}>
        <strong>{item.sourceText}</strong>：{item.status === "passed" ? "通过" : item.status === "failed" ? "不满足" : "未核验"}。{item.reason}
      </li>)}</ul>
      {draft.diagramVerification.sampleValues.length > 0 && <div><h4>本图选用的示例值</h4><ul>{draft.diagramVerification.sampleValues.map((value) => <li key={value}>{value}</li>)}</ul></div>}
    </section>}

    {/*
      **「证明级别」只读状态面**：题设核验说完"这一份图核了什么"，紧跟着说清"形式证明这一档
      今天是什么状态"。两者不是一回事：核验是**一个实例**的检查，形式证明要的是命题普遍成立。

      它**只读**、**不宣称任何一条 claim 已被证明**，而且那几句话由 `WIRED_PROOF_BACKENDS` /
      `PROOF_BACKEND_REVIEWS` **推导**（见 `proofLevelStatus.ts`）。
      **2026-10-06 起生产接上了 `lean4`**（N5b 的第一个真实后端，十栏准入记录在案）⇒
      它现在说的是"本构建接上了 1 个形式证明后端…"；而"当前没有接入任何形式证明后端"那一支
      仍然在（`wired.length === 0`，测试里显式注入 0 个来钉它）—— 两句话**都由事实推出来**，
      **不留一句会腐烂的假话**。

      **这里仍不做产物正文查看器**：**2026-10-06 起确实有东西能产出 proof artifact 了**
      （`packages/agent-core/src/proof/lean4Adapter.ts` 的**显式调用**路径；闭环用例里真产出过并升到 `formally_proved`），
      但 ① **默认路径不调用它**（设计：证明后端不参与普通静态图的默认运行），
      ② **没有任何通道把产物送进界面**。所以查看器仍然是"给一条今天走不到的展示路径写组件，
      只能用注入的假数据测＝弱证据"。等这两条之一变了再做。
      理由写在 `proofLevelStatus.ts` 的文件头与 `docs/current-status.md` §四 F。
    */}
    <ProofLevelNotice wired={proofBackends} reviewedCount={proofReviewedCount} />
    {assumptions.length > 0 && <AssumptionList assumptions={assumptions} />}

    {approximationNotes.length > 0 && <div className="agent-confirmation-approximation">
      <h4>近似说明</h4>
      <ul>{approximationNotes.map((note) => <li key={note}>{note}</li>)}</ul>
    </div>}

    {omittedExports.length > 0 && <div className="agent-confirmation-omissions">
      <h4>导出会丢掉的内容</h4>
      <ul>{omittedExports.map((note) => <li key={note}>{note}</li>)}</ul>
    </div>}

    {/* 计划逐字要求的 "exact one-undo statement"。 */}
    <p className="agent-confirmation-undo" role="note">
      {draft.undoesInOneStep ? "确认后整批只占一步撤销；撤销一次就能回到现在的样子。" : "这次改动会占多步撤销。"}
    </p>

    <div className="agent-confirmation-actions">
      {onConfirm && (draft.diagramVerification === undefined || draft.diagramVerification.status === "passed") && <button type="button" className="agent-draft-confirm" onClick={onConfirm}>确认并提交</button>}
      {onDiscard && <button type="button" className="agent-draft-discard" onClick={onDiscard}>丢弃草稿</button>}
    </div>
  </section>
}

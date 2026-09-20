import type { AgentDraftView } from "../../agentStore"
import { countDeltas, removedObjectCount, summarizeDraftScale } from "./confirmationCounts"

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
  onConfirm?: () => void
  onDiscard?: () => void
}

export function ConfirmationPanel({ draft, assumptions = [], approximationNotes = [], omittedExports = [], targetDocumentId, sourceDocumentIds = [], onConfirm, onDiscard }: ConfirmationPanelProps) {
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

    {assumptions.length > 0 && <div className="agent-confirmation-assumptions">
      <h4>系统替你做的假设</h4>
      <ul>{assumptions.map((note) => <li key={note}>{note}</li>)}</ul>
    </div>}

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
      {onConfirm && <button type="button" className="agent-draft-confirm" onClick={onConfirm}>确认并提交</button>}
      {onDiscard && <button type="button" className="agent-draft-discard" onClick={onDiscard}>丢弃草稿</button>}
    </div>
  </section>
}

import type { DraftObjectCounts } from "@draw/agent-core"

/**
 * **隔离草稿的预览面板**（Task 0.8 Step 4）。
 *
 * 计划要求的原话是"Show user/derived/internal counts, assumptions, evidence, approximation,
 * omitted exports, and the exact one-undo statement"。这些不是装饰：用户在按下"确认"之前，
 * 只能靠这块面板知道**将要发生什么**，所以每一条都必须如实、不能省略"不好看"的部分
 *（例如"这一步会删掉 3 个对象"或"导出会丢掉这些内容"）。
 *
 * 三条纪律写进类型里，而不是靠注释提醒：
 * 1. **它不持有文档**：props 里没有 `document`，也没有任何 store 写入口。预览绝不落盘，
 *    提交只能走 `HostBridge`（那里有一次性同意与 Compare-and-Swap）。
 * 2. **它不判断能不能提交**：`onConfirm` 只是个回调，授权与校验都在 `HostBridge`。
 *    在这里加"看起来没问题就放行"的判断，等于把安全边界搬进渲染层。
 * 3. **它不算数**：计数由 `countDraftObjects` 给出（与画布/对象树同一份判据），
 *    面板只负责显示。两处各算一次必然漂移。
 */

export interface DraftPreviewProps {
  draftId: string
  draftVersion: number
  /** 这一批草稿由几步暂存合成（提交时合成一步撤销）。 */
  stageCount?: number
  /** 由 `countDraftObjects` 给出：用户 / 隐藏 / 派生 / 内部。 */
  counts: DraftObjectCounts
  /** 这次改动涉及的对象标签（供用户核对"改的是不是我说的那些"）。 */
  changedLabels: string[]
  /** 系统替你做的假设（例如"半径取你给的 2"）。 */
  assumptions?: string[]
  /** 支撑这次改动的证据（例如"你选中了 A、B 两点"）。 */
  evidence?: string[]
  /** 近似说明：哪些地方不是精确结果。 */
  approximationNotes?: string[]
  /** 会被略过的导出内容（导出预检的结论）。 */
  omittedExports?: string[]
  onConfirm: () => void
  onCancel: () => void
}

export function DraftPreview({ draftId, draftVersion, stageCount, counts, changedLabels, assumptions = [], evidence = [], approximationNotes = [], omittedExports = [], onConfirm, onCancel }: DraftPreviewProps) {
  return <section className="agent-draft-preview" aria-label="草稿预览" data-draft-id={draftId} data-draft-version={draftVersion}>
    <header className="agent-draft-head">
      <h3>这次要做的事（还没有写进文档）</h3>
      {/* 规模写在标题旁边：用户第一眼要看到"改动有多大"。 */}
      <p className="agent-draft-scale">
        对象 {counts.total} 个
        {stageCount === undefined ? null : <> · 由 {stageCount} 步合成</>}
      </p>
    </header>

    {/* 三类分开列，因为它们的"可编辑性"不同：派生对象拖不动，内部细节根本看不见。 */}
    <dl className="agent-draft-counts">
      <div><dt>可编辑</dt><dd>{counts.user} 个</dd></div>
      <div><dt>派生</dt><dd>{counts.derived} 个</dd></div>
      <div><dt>内部</dt><dd>{counts.internal} 个</dd></div>
      {counts.hidden > 0 ? <div><dt>隐藏</dt><dd>{counts.hidden} 个</dd></div> : null}
    </dl>

    {changedLabels.length > 0 && <div className="agent-draft-changes">
      <h4>会改动的对象</h4>
      <ul>{changedLabels.map((label) => <li key={label}>{label}</li>)}</ul>
    </div>}

    {assumptions.length > 0 && <div className="agent-draft-assumptions">
      <h4>系统替你做的假设</h4>
      <ul>{assumptions.map((note) => <li key={note}>{note}</li>)}</ul>
    </div>}

    {evidence.length > 0 && <div className="agent-draft-evidence">
      <h4>依据</h4>
      <ul>{evidence.map((note) => <li key={note}>{note}</li>)}</ul>
    </div>}

    {approximationNotes.length > 0 && <div className="agent-draft-approximation">
      <h4>近似说明</h4>
      <ul>{approximationNotes.map((note) => <li key={note}>{note}</li>)}</ul>
    </div>}

    {omittedExports.length > 0 && <div className="agent-draft-omissions">
      <h4>导出会丢掉的内容</h4>
      <ul>{omittedExports.map((note) => <li key={note}>{note}</li>)}</ul>
    </div>}

    {/* 逐字的"只占一步撤销"：含糊的"可以撤销"不足以让用户判断代价。 */}
    <p className="agent-draft-undo" role="note">确认后整批只占一步撤销；撤销一次就能回到现在的样子。</p>

    <div className="agent-draft-actions">
      <button type="button" className="agent-draft-confirm" onClick={onConfirm}>确认并提交</button>
      <button type="button" className="agent-draft-cancel" onClick={onCancel}>取消</button>
    </div>
  </section>
}

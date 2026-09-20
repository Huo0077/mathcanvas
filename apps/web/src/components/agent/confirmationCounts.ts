import type { AgentDraftView } from "../../agentStore"

/**
 * **确认面板的计数整理**（Task 2.5 Step 4）。
 *
 * 单独成模块有两个理由：
 * 1. `ConfirmationPanel.tsx` 只导出组件，`react-refresh` 才能正确热替换它；
 * 2. 这段逻辑要能**单独测** —— 它决定"哪几行会被列出来"，而那一取舍本身是产品判断
 *（只列真的有变化的类别：一份没有变化的清单会把真正需要注意的那一行埋掉）。
 */

export interface CountDelta {
  label: string
  before: number
  after: number
  /** 这个类别的对象确认之后**用户能不能看见/编辑**。 */
  note: string
}

/**
 * 把两份计数整理成"会多出/少掉多少"。
 *
 * 数字是宿主侧用 `countDraftObjects` 从**候选与基础两份真实文档**算出来的；
 * 这里只做取舍与措辞，**不重新数**。
 */
export function countDeltas(draft: AgentDraftView): CountDelta[] {
  const before = draft.baseCounts
  const after = draft.counts
  if (!before || !after) return []

  const rows: CountDelta[] = [
    { label: "可编辑对象", before: before.user, after: after.user, note: "确认后你可以在画布上选中、拖动、删除它们" },
    { label: "隐藏对象", before: before.hidden, after: after.hidden, note: "在文档里，但画布上看不见" },
    { label: "派生对象", before: before.derived, after: after.derived, note: "由别的对象算出来，不能直接编辑" },
    { label: "内部细节", before: before.internal, after: after.internal, note: "近似用的细分点与母线：在文档里，画布与对象列表都不显示" }
  ]
  return rows.filter((row) => row.before !== row.after)
}

/** 这一次是"净增加"还是"净减少"，用于一句总体说明。 */
export function summarizeDraftScale(counts: AgentDraftView["counts"], baseCounts: AgentDraftView["baseCounts"]): string {
  if (!counts || !baseCounts) return "这次改动的规模无法核对（缺少计数）"
  const delta = counts.total - baseCounts.total
  if (delta === 0) return `对象总数不变（${counts.total} 个）`
  return delta > 0 ? `会新增 ${delta} 个对象（共 ${counts.total} 个）` : `会减少 ${-delta} 个对象（共 ${counts.total} 个）`
}

/** 净删除的对象数；> 0 时面板必须显式警告。 */
export function removedObjectCount(draft: AgentDraftView): number {
  if (!draft.counts || !draft.baseCounts) return 0
  return Math.max(0, draft.baseCounts.total - draft.counts.total)
}

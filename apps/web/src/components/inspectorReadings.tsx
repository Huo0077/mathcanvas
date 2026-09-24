import type { SolidDerivedStatus } from "@draw/scene-graph"

import { DERIVED_REASON_MISSING, derivedCodeLabels, derivedStatusLabels } from "./inspectorLabels"

/**
 * **派生立体读数**（Solid/Prism 切片 Task 5 的后半）。
 *
 * `solidStatusReport`（`@draw/scene-graph`）把内核那三个求解器的四态结论算了出来，
 * 而这个组件是它在界面上的**唯一**落点：用户选中一只实体，就能看到它的外接球 /
 * 内切球 / 截面到底是"精确"、"数值近似"、"不存在"还是"退化"，以及**为什么**。
 *
 * 三件事写死在结构里，而不是靠文案自觉：
 * - 状态进 `data-derived-status`（浏览器用例断言的是状态本身，不是中文）；
 * - `undefined` / `degenerate` 永远显示 `message`（内核给的原因），没有原因时如实说明；
 * - `approximate` 有独立的类名与文案，与 `exact` 不可能长得一样。
 *
 * `labelFor` 是**截面那一类读数的去重手段**：同一只实体上的两条截面读数
 * 只有 `sourceId` 不同，行标题得用那条截面自己的标签，否则两行长得一模一样（Fix round 1 / M1）。
 *
 * 抽成独立组件（而不是写进 `PropertiesBar` 的 JSX 里）是为了让"四态各长什么样"能被
 * 直接喂进去断言 —— `approximate` 目前没有生产来源（内核那三个求解器还不会给），
 * 只靠真实文档测不到它。
 */
export function SolidDerivedReadings({ entries, labelFor }: { entries: readonly SolidDerivedStatus[]; labelFor?: (entry: SolidDerivedStatus) => string | undefined }) {
  if (entries.length === 0) return null
  return <div className="primitive-properties" data-derived-panel="true"><h3>派生读数</h3>
    {entries.map((entry) => <div className="derived-reading" key={`${entry.solidId}:${entry.code}:${entry.sourceId ?? "solid"}`} data-derived-code={entry.code} data-derived-status={entry.status} data-derived-solid={entry.solidId} data-derived-source={entry.sourceId}>
      <div className="derived-reading-head">
        <span className="derived-reading-label">{labelFor?.(entry) ?? derivedCodeLabels[entry.code] ?? entry.code}</span>
        <span className="derived-status" data-status={entry.status}>{derivedStatusLabels[entry.status]}</span>
      </div>
      <p className="derived-reading-message">{entry.message.trim().length > 0 ? entry.message : DERIVED_REASON_MISSING}</p>
    </div>)}
    <p className="footer-note">外接球 / 内切球 / 截面都是**内核算出来的结论**（不是估计）：精确的给确定的结论（闭式解或已核验的解），数值近似的带残差，"不存在"表示这只实体根本没有对应的球，而"退化"表示输入本身不成立 —— 三种情况都不会拿一个近似值来顶替。改动实体的顶点或截面朝向，这些读数会立刻重算。</p>
  </div>
}

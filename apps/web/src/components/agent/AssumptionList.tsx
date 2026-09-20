/**
 * **假设清单**（Task 2.5 / Task 2.6 点名的那一节）。
 *
 * 为什么单独一个组件而不是留在 `ConfirmationPanel` 里的一段 `<ul>`：
 *
 * 1. **它有自己的可读性要求**。假设是"系统替你定的那些事"，用户要逐条读、逐条判断
 *    能不能接受；把它挤在确认面板中间会让它看起来像附注。
 * 2. **它会被不止一处用到**。草稿预览（`DraftPreview`）与确认面板都要给这一节，
 *    而"两处各写一遍列表渲染"必然分叉（一处加了计数、另一处没加）。
 * 3. **它必须能单独讲清"没有假设"与"有假设"的区别**，这一点值得有自己的用例。
 *
 * ## 一条纪律
 *
 * **空清单不渲染**。一个永远显示的"系统替你做的假设：（空）"会被用户读成
 * "它检查过了，确实没有假设" —— 那是我们**不知道**的事。没有声明就什么都不显示。
 */
export interface AssumptionListProps {
  /** 规划器声明的假设，每条一句人话。 */
  assumptions?: string[]
  /** 标题文案；确认面板与草稿预览的措辞可以不同。 */
  title?: string
}

export function AssumptionList({ assumptions = [], title = "系统替你做的假设" }: AssumptionListProps) {
  if (assumptions.length === 0) return null

  return <div className="agent-assumptions">
    <h4>{title}</h4>
    {/* 逐条列出，不合并成一段：用户要能一条一条判断"这条我认不认"。 */}
    <ul>{assumptions.map((note) => <li key={note}>{note}</li>)}</ul>
  </div>
}

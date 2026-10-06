/**
 * **点名语法的唯一来源**（S1；见 [立体图形覆盖扩宽实施计划](../../../docs/superpowers/plans/2026-10-07-solid-shape-coverage-implementation-plan.md)）。
 *
 * ## 为什么收成一处
 *
 * 同一个判断此前写在**三处**，而三处各写一份就必然分叉：
 *
 * | 调用方 | 原来怎么写 | 后果 |
 * | --- | --- | --- |
 * | `agent-core/diagramObligations.ts` 的 `names()` | `[...value]` 按**码位**拆字 | 带撇点名被切成 `["A","′","B"]` ⇒ 棱柱题面**一条 given 都产不出** |
 * | `agent-core/diagramVerification.ts` 的 `candidatePoints` | `/^[A-Z]$/` | 内核产出的 `A′` 拿不到坐标 ⇒ 稳定 `unverified` |
 * | `geometry-kernel/witness/constructors.ts` 的顶面命名 | 自己拼 `A′` | 与上面两处没有共同契约 |
 *
 * 实测（设计 §1.1）：`在三棱柱ABCD-A₁B₁C₁D₁中，AA₁⊥平面ABCD` 在三种写法下都是
 * `givens: []` + `unverified` 残留。**这是 fail-closed，但没有一条能读懂。**
 *
 * ## 契约
 *
 * - 点名 = **一个大写字母 + 可选的撇或下标**：`A`、`A′`、`A'`、`A₁`。
 * - **ASCII 下标 `A1` 不算点名**。它必须留在"读不出"那一侧（进 `unverified` 显形），
 *   不许在这里被凑合解析成 `A₁` —— 那正是"悄悄改题"的老毛病。
 * - `splitPointNames` 只在拆出来的点名**正好铺满输入**时返回结果；有看不懂的字符就返回 `[]`
 *   （"拆不出"），而不是把看不懂的部分丢掉、把剩下的当成功。
 *
 * ## 放在内核最底层的理由
 *
 * 三个调用方里有一个是**内核自己**（顶面命名），而内核不能反向依赖 agent-core；
 * agent-core 按既有方式从 `@draw/geometry-kernel` 引入。
 */

/** 单个点名的模式。**不要**在各调用点重写它 —— 那正是本模块要消灭的东西。 */
export const POINT_NAME_SOURCE = "[A-Z](?:[′']|[₁₂₃₄₅₆])?"

/**
 * 撇字符本身（内核给顶面顶点起名时用的那一笔）。
 *
 * 单独导出它的理由很窄：内核 `witness/constructors.ts` 的 `withPrimes` 现在**仍然自己写**
 * `"′"` 这个字面量（两处）。把字面量收进来，是为了让"点名由哪些字符组成"只有一处定义 ——
 * 与 `POINT_NAME_SOURCE` 是同一件事的两面。
 */
export const POINT_NAME_PRIME = "′"

const POINT_NAME = new RegExp(`^${POINT_NAME_SOURCE}$`)
const POINT_NAME_RUN = new RegExp(POINT_NAME_SOURCE, "g")

/** 整串**恰好**是一个点名（不是"包含点名"）。 */
export function isPointName(value: string): boolean {
  return POINT_NAME.test(value)
}

/**
 * 把 `A′B` 这样连写的点名串拆成 `["A′", "B"]`。
 *
 * `[...value]` 做不到这件事：它按码位切，`A′` 会被拆成 `A` + `′`。
 * 拆出来的点名必须**正好铺满**输入，否则返回 `[]`（含义是"这不是一串干净的点名"）。
 */
export function splitPointNames(value: string): string[] {
  const matches = value.match(POINT_NAME_RUN)
  if (matches === null || matches.join("") !== value) return []
  return matches
}

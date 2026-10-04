/**
 * **“题目要求保留符号”的判据（叶子模块）**（N2 子任务 2b 的复核裁决 R29）。
 *
 * ## 为什么它单独成一个文件，而不是留在 `underdetermined.ts`
 *
 * 这个函数被 `planCompiler.ts` 直接使用（判断一份计划要不要特值化）。它原先住在
 * `underdetermined.ts` 里，于是形成了一条模块级环：
 *
 * ```text
 * planCompiler -> underdetermined -> solver/witnessSearch -> planCompiler
 * ```
 *
 * 环里的每一处使用**都在函数体内**（没有任何模块初始化期的读取），所以运行时是惰性的；
 * 但这个仓库有过 TDZ 事故先例（“放在前面会 TDZ 崩溃，而 typecheck / lint / 单测全绿”），
 * 而环是那种“今天惰性、明天换个入口就炸”的东西。判据本身**只依赖字符串**，
 * 把它抽成叶子模块是断环的最小切法：`planCompiler` 不再 import `underdetermined`。
 *
 * `underdetermined.ts` 仍然把它 re-export（`export { isInvariantRequest } from "./invariantRequest"`），
 * 所以 `underdetermined.test.ts` 与 `@draw/agent-core` 的既有调用方**一个字节都不用改**。
 *
 * ## 判据本身（语义一字未动，逐字搬来）
 *
 * "任意/恒定/定值"这类要求。**判据只有一个**：这一层与提示词共用同一份关键词。
 */

const SYMBOLIC_KEYWORDS = ["任意", "恒", "定值", "不变", "全都成立", "invariant", "arbitrary", "for all", "any point", "constant"]

export function isInvariantRequest(prompt: string | undefined): boolean {
  if (!prompt) return false
  const lowered = prompt.toLowerCase()
  // “任意”限定的是图形族，不限定用户此刻要交付的东西。
  // 静态画图允许选一张满足题设的示例；普遍证明与持续移动仍要保留参数。
  if (/(?:求证|证明|恒定|定值|不变|全都成立|invariant|for all|constant)/i.test(lowered)) return true
  if (/(?:任意.*(?:移动|运动|变化)|任意动点|随.*变化)/.test(lowered)) return true
  if (/(?:画|作|绘|示意图)/.test(lowered)) return false
  return SYMBOLIC_KEYWORDS.some((keyword) => lowered.includes(keyword.toLowerCase()))
}

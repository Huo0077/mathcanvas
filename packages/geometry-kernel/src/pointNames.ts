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
 * ## 契约（2026-10-07 按用户裁决扩宽）
 *
 * - 点名 = **一个大写字母 + 至多两个后缀**，后缀是撇或下标：`A`、`A′`、`A₁`、**`A′′`**、`A′₁` 都算；
 *   **三个后缀不算**（`A′′′`）。
 * - **为什么需要第二层**：内核给棱柱顶面起名的方式是"底面名 + 一个后缀"，而**底面本身**可能已经带撇
 *   （题面 `ABCD-A′B′C′D′` 这一类）。此时 `A′` 已被占，顶面只能是 `A′′` —— 用户 2026-10-07 裁决
 *   **按扩语法处理**（另一条路是明确拒绝整道题，那条被否掉了）。三层及以上没有真实来源，不收。
 * - **ASCII 下标 `A1` 不算点名**。它必须留在"读不出"那一侧（进 `unverified` 显形），
 *   不许在这里被凑合解析成 `A₁` —— 那正是"悄悄改题"的老毛病。
 *   **分界（2026-10-15 用户现场）**：这条契约管的是**题面**；而 `canonicalPointName` 会把
 *   ASCII 数字后缀归一（下面那条注释），它用在**计划里那份名字表**与**比较**上 ——
 *   题面里的 `A1` 仍然读不出，计划里的 `A2` 会被读成 `A₂`（那是模型在说"这个顶点叫 A₂"）。
 * - `′` 与 `'` 是**同一个后缀的两种字形**：两者都合法，但**比较时必须按规范字形**
 *   （`canonicalPointName`），否则同一个点会以两种写法同时进点名表。
 * - `splitPointNames` 只在拆出来的点名**正好铺满输入**时返回结果；有看不懂的字符就返回 `[]`
 *   （"拆不出"），而不是把看不懂的部分丢掉、把剩下的当成功。
 *
 * ## 放在内核最底层的理由
 *
 * 三个调用方里有一个是**内核自己**（顶面命名），而内核不能反向依赖 agent-core；
 * agent-core 按既有方式从 `@draw/geometry-kernel` 引入。
 */

/** 单个点名的模式。**不要**在各调用点重写它 —— 那正是本模块要消灭的东西。 */
export const POINT_NAME_SOURCE = "[A-Z](?:[′']|[₁₂₃₄₅₆]){0,2}"

/**
 * 撇字符本身（内核给顶面顶点起名时用的那一笔）。
 *
 * 单独导出它的理由很窄：内核 `witness/constructors.ts` 的 `withPrimes` 需要"首选的"那一笔。
 * 把字面量收进来，是为了让"点名由哪些字符组成"只有一处定义 —— 与 `POINT_NAME_SOURCE` 是同一件事的两面。
 */
export const POINT_NAME_PRIME = "′"

/** 后缀字母表（内核给顶面起名时按它枚举）。**顺序即优先顺序**：先撇，再下标。 */
export const POINT_NAME_SUFFIXES: readonly string[] = [POINT_NAME_PRIME, "₁", "₂", "₃", "₄", "₅", "₆"]

/**
 * 后缀的**规范字形**：所有"撇"的写法都归一成 `′`。
 *
 * 用于**比较、去重与读入**；输出的字形由调用方决定（内核一律写 `′`）。
 * 不做这一步的后果很具体：`A'` 与 `A′` 是不同字串，`Set` 会当成两个名字，
 * 于是同一个点以两种写法同时进点名表。
 *
 * ## 2026-10-15 用户现场：**弯撇**也要收
 *
 * 现场那轮（Rt△ABC 折起）失败在 `这一笔面片的 vertexNames 与它的顶点对不上（给了 3 个名字、
 * 面有 3 个顶点）` —— 复现出来的真因是**模型把 `C'` 写成了弯撇** `C’`（U+2019，中文输入法
 * 与排版里的常见字形）：它不在点名字母表里 ⇒ `isPointName` 为假 ⇒ 整张点名表建不出来，
 * 于是七条题设全报同一句话。这类"同一个名字的排版变体"必须**在入口处归一**，
 * 否则文档标签与题面点位不是同一种字符，映射永远对不上。
 *
 * 只收**撇的变体**（U+2019 弯撇、U+00B4 尖音符、U+02B9/U+02BC 修饰号、反引号），
 * 不碰别的字符：`Ｂ`（全角）、`c`（小写）、`C `（带空格）仍然不是点名。
 */
export function canonicalPointName(value: string): string {
  const primes = value.replace(/['’´ʹʼ`]/g, POINT_NAME_PRIME)
  /**
   * **ASCII 数字后缀归一到下标字形**（2026-10-15 用户现场，正四棱柱 `A₂B₂C₂D₂`）。
   *
   * 现场：题面写的是**下标**，而模型在计划的名字表里写成了 `A2`/`B2`/`C2`/`D2` ⇒
   * `isPointName` 为假 ⇒ 整张点名表建不出来 ⇒ 七条题设报同一句"与它的顶点对不上"。
   * 与"弯撇"同一类：**同一个名字的两种写法**，在**读入**时归一，两侧才是同一种字符。
   *
   * 三条边界：① 只对**以字母开头**的串做（别的串原样返回）；② 只在前一个字符是字母或后缀
   * 时才替换（`A2` → `A₂`，`A12` → `A₁₂`）；③ 只认 `1`–`6`（`0` 没有下标字形，
   * `A10` 归一成 `A₁0` 之后**仍然不是**点名 —— 不许凑出一个"看着像"的名字）。
   * 题面那一侧的契约（`A1` 读不出）**不受影响**：那条走 `POINT_NAME_SOURCE` 的正则。
   */
  if (!/^[A-Z]/.test(primes)) return primes
  return primes.replace(/(?<=[A-Z′₁₂₃₄₅₆1-6])[1-6]/g, (digit) => SUBSCRIPT_DIGITS[digit] ?? digit)
}

/** ASCII 数字 → 下标字形（`canonicalPointName` 用；只收 `1`–`6`，与 `POINT_NAME_SUFFIXES` 同一套）。 */
const SUBSCRIPT_DIGITS: Record<string, string> = { "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆" }

/** 这个名字已经带了几层后缀（0–2）。不是点名时返回 `-1`。 */
export function pointNameSuffixCount(value: string): number {
  return isPointName(value) ? [...value].length - 1 : -1
}

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

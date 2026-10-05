import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * **进度"声明"必须与进度"记录"对得上**（两条结构性判据）。
 *
 * ## 为什么加这一条
 *
 * 2026-10-05 的独立审查**没跑任何测试**就找出 7 处文档漂移，其中两处是可以被机器抓住的：
 *
 * 1. **计划的状态行说"N3–N6 尚未实施"，而同一份文件里 N3/N4/N5/N6 各自都有执行记录** ——
 *    状态行是读者第一眼看的东西，它一旦落在记录后面，后面所有"已开工到第几步"都白写；
 * 2. **`current-status.md` 的「待裁决」表**：标题写着"四件已解决、两件等你点头"，
 *    表里却只有 5 行，而且 `.gitattributes` 那一项**根本没进表**（它只在正文里被提了一句）。
 *
 * 现有的 `capability-tables.test.ts` 只管"三张能力表链到唯一现在时"，这两条它一条都拦不住。
 *
 * ## 只钉这两件**确定的事**
 *
 * 两条判据都只依赖仓库**自己的固定词汇**与**结构**：`执行记录` / `尚未实施` / `N1–N6` /
 * 表格首列的行号 / 标题里的中文数字与"件已解决・件等你点头"。不比对任何正文句子的写法 ——
 * 现有那份守卫已经写明为什么不能那样钉（"一改措辞就红的假门禁"）。
 *
 * ## 唯一一处有意的耦合
 *
 * 第二条判据要读标题里那句计数。**改那句话的写法就要同步改这里的正则** —— 这是有意的：
 * 那句计数本身就是一条会漂的声明（这次就漂了），让它与表行数绑在一起才有意义。
 * 找不到那句计数时这条会**红**，消息里写着两种改法。
 */

const PLAN = "docs/superpowers/plans/2026-10-04-agent-full-next-phase-implementation-plan.md"
const STATUS = "docs/current-status.md"

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

const toNumber = (text: string): number => CN_DIGITS[text] ?? Number(text)

/** 计划里哪些阶段**已经有执行记录**（判据：`> **N<k> 执行记录` 这一行）。 */
function phasesWithRecords(plan: string): number[] {
  return [...plan.matchAll(/^\s*>?\s*\*\*N(\d)\s*执行记录/gm)].map((match) => Number(match[1]))
}

function statusLine(plan: string): string {
  const line = plan.split(/\r?\n/).find((candidate) => /^>\s*\*\*状态/.test(candidate))
  if (line === undefined) throw new Error(`${PLAN} 里找不到状态行（以「> **状态」开头的那一行）`)
  return line
}

/** 状态行里被声明成「尚未实施」的阶段（支持 `N3–N6 尚未实施` 这种区间写法）。 */
function phasesDeclaredUnimplemented(status: string): number[] {
  const declared = new Set<number>()
  for (const match of status.matchAll(/N(\d)\s*[–\-~—]\s*N(\d)\s*尚未实施/g)) {
    for (let phase = Number(match[1]); phase <= Number(match[2]); phase += 1) declared.add(phase)
  }
  for (const match of status.matchAll(/N(\d)[^N]{0,12}尚未实施/g)) declared.add(Number(match[1]))
  return [...declared]
}

describe("进度声明与进度记录一致", () => {
  it("计划的状态行不得把「已有执行记录」的阶段说成「尚未实施」", () => {
    const plan = readFileSync(PLAN, "utf8")
    const recorded = phasesWithRecords(plan)

    // 判据自身的前提：一条记录都找不到，说明这条守卫已经失效，必须显式红出来。
    expect(recorded.length, `${PLAN} 里一条「N<k> 执行记录」都没有 —— 判据本身失效了`).toBeGreaterThan(0)

    const declared = phasesDeclaredUnimplemented(statusLine(plan))
    const contradictions = recorded.filter((phase) => declared.includes(phase))

    expect(
      contradictions,
      `阶段 ${contradictions.map((phase) => `N${phase}`).join("、")} 已经有执行记录，状态行却把它们列进了「尚未实施」：${statusLine(plan)}`
    ).toEqual([])
  })

  it("「待裁决」表：标题声明的件数必须与表的实际行数一致，且行号连续", () => {
    const lines = readFileSync(STATUS, "utf8").split(/\r?\n/)
    const headingIndex = lines.findIndex((line) => /^###\s*2\./.test(line))
    expect(headingIndex, `${STATUS} 里找不到「### 2.」这一节`).toBeGreaterThanOrEqual(0)
    const heading = lines[headingIndex]!

    const rows: { index: number; resolved: boolean }[] = []
    for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]!
      if (/^#{2,3}\s/.test(line)) break
      const index = /^\|\s*(\d+)\s*\|/.exec(line)
      if (!index) continue
      rows.push({ index: Number(index[1]), resolved: /^\|\s*\d+\s*\|\s*~~/.test(line) })
    }
    expect(rows.length, `${STATUS} 的「待裁决」表一行都没解析到`).toBeGreaterThan(0)

    // 加了行却忘了编号（或编号跳号）会被这条挡住。
    expect(rows.map((row) => row.index)).toEqual(rows.map((_, position) => position + 1))

    // 注意：标题里那句计数是**加粗**的（`**四件已解决、两件等你点头**`），所以这里只认
    // 中文数字或阿拉伯数字本身，不能让 `\S+` 把 `**` 一起吞进去（第一次就踩了：toNumber("**四") = NaN）。
    const declared = /([一二两三四五六七八九十\d]+)\s*件已解决\s*[、,，/]\s*([一二两三四五六七八九十\d]+)\s*件(?:等你点头|待定|待裁决)/.exec(heading)
    expect(
      declared,
      `「${heading.trim()}」里读不到「X 件已解决、Y 件等你点头」这句计数。两种改法：把计数写回去，或同步改这条守卫（它有意与那句话耦合）`
    ).not.toBeNull()

    const resolved = rows.filter((row) => row.resolved).length
    const open = rows.length - resolved
    expect(toNumber(declared![1]!), `标题说「${declared![1]}件已解决」，表里实际划掉了 ${resolved} 行`).toBe(resolved)
    expect(toNumber(declared![2]!), `标题说「${declared![2]}件等你点头」，表里实际有 ${open} 行没划掉`).toBe(open)
  })
})

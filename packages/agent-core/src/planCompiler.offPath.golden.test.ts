import type { GeometryDocument } from "@draw/dsl"
import { describe, expect, it, vi } from "vitest"

import goldenRaw from "./fixtures/planCompiler4707b64.golden.json"
import { compilePlan } from "./planCompiler"

/**
 * **"关着的时候与基线逐字相同"必须钉在基线上**（复核 R42，Important 1）。
 *
 * ## 为什么不能只断言"新代码内部 `false` ≡ 缺省"
 *
 * `planCompiler.test.ts` 里原来那条只比较了**同一份新代码**的两个调用（显式 `false` 与不传），
 * 于是重构在 off 路径上新增/删除的任何字段都会同时出现在两侧；而 `JSON.stringify` 还会藏掉
 * 值为 `undefined` 的新键。更弱的是：**生产从不省略这个参数**
 * （`agentRuntime.ts:271` 传的是那个五键 flag 对象），所以编译路径收到的是 `false` 而不是
 * `undefined` —— "不传"这条分支在生产上根本不发生。
 *
 * ## 这一份怎么钉
 *
 * `./fixtures/planCompiler4707b64.golden.json` 是**在 `4707b64` 上真跑出来的黄金样本**
 * （做法见报告 §11：把那一版 `planCompiler.ts` 用 `git show` 取出来当临时模块跑一遍，
 * 输入 + `JSON.stringify(result)` + 两级键集合一起落盘，然后删掉临时模块与抓取用例）。
 * 这份用例把同一批输入喂给**现在**的编译路径，并要求：
 *
 * 1. `JSON.stringify(result)` 与黄金样本**逐字节相同**（字段顺序、诊断文案、别名、草稿文档都在内）；
 * 2. **顶层键集合**相同 —— 这一条抓的是"新增了一个值为 `undefined` 的键"，
 *    也就是 `JSON.stringify` 看不见而 `Object.keys` 看得见的那种差异；
 * 3. `diagramVerification` 的键集合也相同（N1 的 IR 字段只在开关为 `true` 时出现，
 *    基线样本里"打开 IR"那一例正好把这条也钉住）。
 *
 * 每个输入跑**两遍**：开关缺席、以及开关显式为 `false`（后者才是应用层实际传的形状）。
 *
 * 基线样本只在这次修复里抓取一次就固定下来 —— 它不随被测代码变化，所以它能发现回归，
 * 而"新代码自己跟自己比"不能。
 */
interface GoldenCase {
  name: string
  document: GeometryDocument
  plan: unknown
  context: { conversationId: string; prompt?: string; diagramObligationIR?: boolean }
  resultJson: string
  resultKeys: string[]
  diagramVerificationKeys: string[] | null
}

const golden = goldenRaw as unknown as { baselineCommit: string; cases: GoldenCase[] }

/**
 * **时钟必须冻住**（第一次抓取踩到的坑，与抓取用例同一个时刻）。
 *
 * 成功路径的候选文档带 `metadata.updatedAt`，那是 `commitTransaction` 打上的**墙上时间** ——
 * 不冻时钟，"逐字相同"就永远不成立，而且失败信息会指向一个与代码无关的时间戳。
 * 黄金样本里记着它抓取时用的 `frozenClock`，这里按那个值钉住。
 */
const FIXED_NOW = new Date((goldenRaw as unknown as { frozenClock: string }).frozenClock)

/** 首次差异的上下文：逐字比较失败时直接指出**在哪一位**分叉，而不是丢两个 6KB 的字符串。 */
function firstDifference(actual: string, expected: string): string {
  let at = 0
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at += 1
  const window = (text: string) => text.slice(Math.max(0, at - 80), at + 160)
  return `第一位差异在 offset ${String(at)}\n  actual   …${window(actual)}\n  baseline …${window(expected)}`
}

/** 应用层关掉开关时传到编译路径的两种形状（`false` 是生产实际的形状）。 */
const VARIANTS: { label: string; override: { diagramWitnessSearch?: boolean } }[] = [
  { label: "开关缺席", override: {} },
  { label: "显式 false（应用层实际传的形状）", override: { diagramWitnessSearch: false } }
]

describe(`the witness-search-off path is byte-identical to ${golden.baselineCommit}`, () => {
  it("has a baseline sample that really covers both a success and a failure", () => {
    // 只覆盖一侧的黄金样本证明不了"off 路径没变"——所以先把样本本身的覆盖度钉住。
    expect(golden.baselineCommit).toBe("4707b64")
    expect(golden.cases.length).toBeGreaterThanOrEqual(6)
    const results = golden.cases.map((entry) => JSON.parse(entry.resultJson) as { ok: boolean; draftDocument: unknown })
    expect(results.some((entry) => entry.ok)).toBe(true)
    expect(results.some((entry) => !entry.ok)).toBe(true)
    expect(results.some((entry) => entry.draftDocument !== null)).toBe(true)
    expect(results.some((entry) => entry.draftDocument === null)).toBe(true)
  })

  for (const entry of golden.cases) {
    for (const variant of VARIANTS) {
      it(`${entry.name} — ${variant.label}`, () => {
        vi.useFakeTimers()
        vi.setSystemTime(FIXED_NOW)
        try {
          const result = compilePlan(entry.plan, {
            document: entry.document,
            conversationId: entry.context.conversationId,
            documentGeneration: entry.document.revision,
            ...(entry.context.prompt === undefined ? {} : { prompt: entry.context.prompt }),
            ...(entry.context.diagramObligationIR === undefined ? {} : { diagramObligationIR: entry.context.diagramObligationIR }),
            ...variant.override
          })

          // ① 整份结果逐字节相同（含 `plan` / `draftDocument` / 诊断文案 / 键的顺序）。
          //    失败时把**第一位差异**的位置与上下文一起报出来（两份 6KB 的字符串对读没有意义）。
          const actual = JSON.stringify(result)
          expect(actual === entry.resultJson, actual === entry.resultJson ? "" : firstDifference(actual, entry.resultJson)).toBe(true)
          // ② 键集合相同：`undefined` 值的新键不会出现在 JSON 里，但会出现在这里。
          expect(Object.keys(result).sort()).toEqual(entry.resultKeys)
          // ③ 题设报告的键集合相同（N1 的 IR 字段是"只有开关为 true 才出现"的那一个）。
          expect(result.diagramVerification === undefined ? null : Object.keys(result.diagramVerification).sort()).toEqual(entry.diagramVerificationKeys)
          // ④ 救回路径的两样产物在 off 路径上必须**根本不存在**（不是"值是 undefined"）。
          expect(Object.hasOwn(result, "materialisedActions")).toBe(false)
          expect(result.assumptions.every((assumption) => !assumption.id.startsWith("witness."))).toBe(true)
        } finally {
          vi.useRealTimers()
        }
      })
    }
  }
})

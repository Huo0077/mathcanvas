import { describe, expect, it } from "vitest"

import { formatAttemptFailures, formatScorecard, evalModeBanner, REAL_PROVIDER_GAPS } from "./agentEvalReport"
import { runOfflineAgentEval } from "./offlineAgentEval"

/**
 * `npm run eval:agent` 实际跑的那一份（Phase 6 / Task 6.2）。
 *
 * ## 为什么它是一条测试
 *
 * 这个仓库里**没有 TS 运行器**（不装 `tsx` / `ts-node`，那是刻意的：见 `docs/current-status.md`
 * 里"刻意不装 `@types/node`"同一条理由 —— 工具链的便利不该动摇应用侧的类型）。
 * 已有的 `scripts/*.mjs` 是纯 JavaScript，而评测要 import 应用包的 TS 源码，
 * 所以能跑它的只有 vitest。`scripts/agent-eval.ts` 是这个入口的包装。
 *
 * ## 它为什么单列一个文件、而不是并进 `offlineAgentEval.test.ts`
 *
 * 那一条是**性质断言**（"离线结果是 deterministic_local / pass@1 必然小于 7"），
 * 它属于常规门禁；这一条是**读数与报告**，是要给人看的。两者失败的含义不同：
 * 前者红了说明评测器坏了，后者红了说明模型能力或几何能力退化了。
 */
describe("agent evaluation scorecard report", () => {
  it("renders every metric without inventing a number for anything unmeasured", async () => {
    const result = await runOfflineAgentEval(3)
    const report = formatScorecard(result)
    const failures = formatAttemptFailures(result)

    // 报告是给人看的：必须真的打出来（`npm run eval:agent` 的可见产物）。
    console.log(`\n=== MathCanvas Agent evaluation ===\n${report}\n\n--- per-task failures ---\n${failures.length === 0 ? "(none)" : failures.join("\n")}\n`)

    expect(report).toContain("deterministic_local")
    expect(report).toContain("NOT real-model accuracy")
    // 没有真实 provider 的计费数据 → 必须写 not measured，而不是 0 或空白。
    expect(report).toContain("average cost      not measured")
    // 视觉任务在本层不可判定 → 说清是哪几个任务，而不是一个含糊的 0。
    expect(report).toContain("not_supported for")
    expect(report).toContain("visual-fit")
    // 每个未通过的任务都要能被指认（只给总数排障无从下手）。
    expect(failures.some((line) => line.startsWith("visual-fit"))).toBe(true)
  })

  /**
   * **`npm run eval:agent` 的四个数都要有机器判据**（2026-10-05 复核 m4）。
   *
   * 为什么单列一条：这四个数里**原来只有 `pass@1` 被断言过**（下面那条单轮用例），
   * 而 `pass@3` / `tool selection` / `tool error rate` 只是被 `formatScorecard` **打印**出来 ——
   * 全仓没有任何断言（`grep "45/45"` / `"tool selection"` 无命中）。
   * 也就是说：**它们漂移时 `npm run eval:agent` 仍然退 0**，而"读数变了"这件事会被静默放过。
   *
   * 这四个数同时是 §一 的在版读数，也是"改离线那条路径的请求内容会不会动读数"的唯一判据
   *（N4d 就该用它们说话）—— 所以它们必须是**被钉住的**，而不是"我跑了一眼看着一样"。
   */
  it("**把四个在版读数逐条钉住**（pass@1 / pass@3 / 工具选择 / 工具错误率）", async () => {
    const result = await runOfflineAgentEval(3)
    const report = formatScorecard(result)

    expect(report).toContain("pass@1            4/8")
    expect(report).toContain("pass@3            4/8")
    expect(report).toContain("tool selection    45/45")
    expect(report).toContain("tool error rate   3/45")
  })

  it("states the real-provider gaps instead of leaving them blank", () => {
    // 这些是记分卡里明确"未测"的范围。列出来是为了让"没测"不可能被读成"通过"。
    expect(REAL_PROVIDER_GAPS).toContain("real provider tool selection")
    expect(REAL_PROVIDER_GAPS.length).toBeGreaterThan(0)
    expect(evalModeBanner("real_provider")).toContain("measured against a real provider")
  })

  it("**说清是哪个 provider / 哪个模型**；没测就写 not measured（同一个 pass@1 在不同模型上不是一个数）", async () => {
    const result = await runOfflineAgentEval(1)

    expect(formatScorecard({ ...result, provider: null })).toContain("provider          not measured")
    expect(formatScorecard({ ...result, provider: { id: "p-eval", modelId: "m-eval" } })).toContain("provider          p-eval / m-eval")
  })

  it("reports a single-trial run as pass@1 only, never as pass@3", async () => {
    /**
     * 期望值取自**实测**（本机跑出来 pass@1 = 4/8）。数字写死是有意的：
     * 它变了就说明本地规划器、几何能力或布局判据变了 —— 那正是这份评测要报警的事。
     *
     * 4 条通过的是：`create-cube` / `create-tetrahedron` / `reject-degenerate-cube` /
     * `visual-fit-drawn`（最后这一条走的正是 Phase 4 的纯本地布局判据）。
     */
    const result = await runOfflineAgentEval(1)
    const report = formatScorecard(result)

    expect(report).toContain("pass@3            not measured")
    expect(report).toContain("pass@1            4/8")
    expect(report).toContain("attempts          8")
  })
})

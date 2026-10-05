import { PLAN_SCHEMA_VERSION, parseBenchmarkCases, type PlanEnvelope } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createModelPlanner, type ProviderResolution } from "../modelPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import {
  PLANNING_EVAL_CASE_COUNT,
  PLANNING_EVAL_REQUESTS,
  PLANNING_EVAL_SEED,
  PLANNING_EVAL_TOTAL_CASES,
  PLANNING_EVAL_TRIALS,
  annotateReadability,
  formatPlanningReport,
  planningEvalCases,
  runProviderPlanningEval,
  workspaceFor
} from "./benchmarkPlanningEval"

/**
 * **应用内真实 provider 的题集通道**（子任务 N4b）。
 *
 * ## 它在测什么（一句话）
 *
 * 端到端"**模型产出的计划有没有被 `compilePlan` 接受**"：对题集里的每条题走一次
 * `createModelPlanner` → `compilePlan`，如实记下接受 / 被拒 / 出错。
 * "接受与否"是**客观**的（判据只有编译器那一个返回值），所以这条通道不需要金标准，
 * 也**不拿离线回归冒充模型准确率**。
 *
 * ## 它解决的是哪个洞
 *
 * 在这之前，应用内那次真实 provider 评测跑的是自己那套**旧 8 题夹具**
 *（`AGENT_TASK_FIXTURES`，测的是"agent 工具环能不能按要求作图"），而 `npm run bench:agent`
 * 跑的是 **21 条题集**（测抽取/见证）。两边都自称"跑过了"，数字却**不可比**。
 * 这一组用例里最要紧的一条就是"跑的是 `parseBenchmarkCases()` 的那一份、本次取前 3 条"。
 *
 * ## 与旧那套的关系
 *
 * **并存**，不取代：旧那套的行为一个字不改（见 `providerAgentEval.test.ts`），
 * 这一套是**另一个坐标系**，两层读数在界面上各自独立、各自报自己的请求数。
 *
 * ## 本文件里哪些是 RED、哪些是钉子
 *
 * - RED（写下来时是红的，接线前那条通道根本不存在）：本文件整体，以及
 *   `ProviderEval.test.tsx` 里"请求数文案 = 实际题集条数"那条。
 * - 钉子（写下来就绿，价值靠变异证明）：`not_measured` 一批、三个结局的判据、
 *   报告契约收下这批记录。
 * - **最后一条是这次发现的真缺陷的钉子**：用**真实** `createModelPlanner`（只把 `runModel`
 *   换成假的，零网络）跑一遍 —— 只给 `userMessage` 的请求会让它抛
 *   `TypeError: Cannot read properties of undefined (reading 'context')`。
 */

const RESOLVED = {
  ok: true,
  provider: { id: "p-plan", modelId: "m-plan", dialect: "openai", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } }
} as ProviderResolution

/** 一份**能被编译接受**的计划：建一个立方体（题集里的题面都不是立方体，所以不会被"用户要的是立方体吗"那层判据挑刺）。 */
const ACCEPTED_ENVELOPE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "建一个立方体",
  factIds: [],
  actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
}

/** 一份**会被编译器拒**的计划：动作名谁都没登记过（`parsePlanEnvelope` 报 `unknown_action`）。 */
const REJECTED_ENVELOPE = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "编一个不存在的动作",
  factIds: [],
  actions: [{ actionId: "solid.create_unicorn", actionKey: "unicorn", factIds: [], inputs: {} }]
} as unknown as PlanEnvelope

/** 一份**根本不是计划**的信封：澄清。它对编译器是合法的，但对这一层来说"没给计划"。 */
const CLARIFICATION_ENVELOPE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "clarification",
  goal: "题面不够清楚",
  factIds: [],
  questions: ["请说明底面四边形的形状"]
}

/** 一份**只读回答**的信封：人读区要呈现的第三类正文（N4e）。 */
const ANSWER_ENVELOPE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "answer",
  goal: "解释一下什么是异面直线",
  factIds: [],
  answer: "异面直线是指不同在任何一个平面内的两条直线。",
  toolResultRefs: []
}

function plannerReturning(envelope: PlanEnvelope, seen: string[] = []) {
  return {
    plan: async (request: { userMessage: string }) => {
      seen.push(request.userMessage)
      return { plan: envelope, requestId: "req-1", attemptId: "att-1" }
    }
  }
}

describe("应用内真实 provider 的题集 planning 通道（N4b）", () => {
  it("**跑的是 `parseBenchmarkCases()` 那一份题集**（本次取前 3 条），不是旧的 8 题夹具", () => {
    const everything = parseBenchmarkCases("cases.jsonl")
    const cases = planningEvalCases()

    expect(PLANNING_EVAL_CASE_COUNT).toBe(3)
    expect(PLANNING_EVAL_TRIALS).toBe(1)
    expect(PLANNING_EVAL_REQUESTS).toBe(3)
    // 每条题都是题集里的那一条：id 与**题面文本**都逐字相同（不是另抄一份字面量）。
    expect(cases.map((entry) => [entry.id, entry.prompt])).toEqual(everything.slice(0, PLANNING_EVAL_CASE_COUNT).map((entry) => [entry.id, entry.prompt]))
    // 与旧那套 8 题夹具**一条都不重合** —— 两套评测不是同一个坐标系。
    const fixtures = new Set(AGENT_TASK_FIXTURES.map((fixture) => fixture.prompt))
    expect(cases.filter((entry) => fixtures.has(entry.prompt))).toEqual([])
    expect(cases.filter((entry) => AGENT_TASK_FIXTURES.some((fixture) => fixture.id === entry.id))).toEqual([])
  })

  it("种子与 CLI 同一个（7）：两份读数能对着看", () => {
    expect(PLANNING_EVAL_SEED).toBe(7)
  })

  it("题集声明的 workspace 要**原样**用；DSL 不认的那个不许静默当成别的", () => {
    expect(workspaceFor({ id: "x", category: "underdetermined", workspace: "geometry3d", prompt: "p" })).toBe("geometry3d")
    expect(workspaceFor({ id: "x", category: "underdetermined", workspace: "cad", prompt: "p" })).toBe("cad")
    // 题集 schema 允许 `draft`，而 DSL 的 `Workspace` 里没有它 —— 静默换成 geometry3d
    // 会让报告记着一条"在另一个工作区跑过"的记录，那是编的。宁可如实报错。
    expect(() => workspaceFor({ id: "x", category: "underdetermined", workspace: "draft", prompt: "p" }))
      .toThrow(/draft/)
  })

  it("**取不到 provider ⇒ 整批 not_measured，且一次请求都不发**（provider/model 显式 null）", async () => {
    let planned = 0
    const result = await runProviderPlanningEval({
      resolveProvider: async () => ({ ok: false, code: "no_active_profile", detail: "还没有选择「使用中」的模型服务" }),
      createPlanner: () => ({ plan: async () => { planned += 1; throw new Error("没配 provider 就不该发请求") } })
    })

    expect(planned).toBe(0)
    expect(result.provider).toBeNull()
    expect(result.unavailable?.code).toBe("no_active_profile")
    expect(result.runs).toHaveLength(PLANNING_EVAL_CASE_COUNT)
    expect(result.runs.map((run) => run.caseId)).toEqual(planningEvalCases().map((entry) => entry.id))
    for (const run of result.runs) {
      expect(run.mode).toBe("real_provider")
      expect(run.layer).toBe("planning")
      expect(run.status).toBe("not_measured")
      expect(run.provider).toBeNull()
      expect(run.model).toBeNull()
      expect(run.cost).toBeNull()
      expect(run.latency).toBeNull()
      expect(run.evidence).toEqual([])
      // **没标注就是显式的 `null`**（N4e）：这一批连对象都没有，所以它既不是某个缺省值，
      // 也不会进可读性分母 —— 但"键必须在"这条纪律对它同样成立。
      expect(run.humanReadability).toBeNull()
    }
    expect(result.report.realProvider.measured).toBe(0)
    expect(result.report.realProvider.notMeasured).toBe(PLANNING_EVAL_CASE_COUNT)
  })

  it("解析成功 ⇒ 每条题一条记录：mode / layer / seed / cost / latency / 身份 都按契约写", async () => {
    const seen: string[] = []
    const result = await runProviderPlanningEval({
      resolveProvider: async () => RESOLVED,
      createPlanner: () => plannerReturning(ACCEPTED_ENVELOPE, seen)
    })

    // **跑的就是那 3 条题面**（按题集顺序），一次不多一次不少。
    expect(seen).toEqual(planningEvalCases().map((entry) => entry.prompt))
    expect(result.runs).toHaveLength(PLANNING_EVAL_REQUESTS)
    for (const run of result.runs) {
      expect(run.mode).toBe("real_provider")
      expect(run.layer).toBe("planning")
      expect(run.status).toBe("planned")
      expect(run.seed).toBe(PLANNING_EVAL_SEED)
      // 仓里没有价目表 ⇒ `cost` 必须是显式的 null，不许编一个钱数。
      expect(run.cost).toBeNull()
      // 延迟是**实测**的（这一次真的跑过了，所以不许是 null）。
      expect(run.latency?.totalMs).toBeGreaterThanOrEqual(0)
      expect(run.provider).toBe("p-plan")
      expect(run.model).toBe("m-plan")
      expect(run.evidence.length).toBeGreaterThan(0)
      // 跑过了、但**没有人标过**可读性 ⇒ 未标注（显式 `null`，不是缺省成 `readable`）。
      expect(run.humanReadability).toBeNull()
    }
    expect(result.report.realProvider.byLayer).toEqual({ planning: PLANNING_EVAL_REQUESTS })
    expect(result.report.realProvider.byStatus).toEqual({ planned: PLANNING_EVAL_REQUESTS })
  })

  it("**编译器拒了 ⇒ rejected，evidence 带真实的拒绝原文**（不是自己编的概括）", async () => {
    const result = await runProviderPlanningEval({ resolveProvider: async () => RESOLVED, createPlanner: () => plannerReturning(REJECTED_ENVELOPE) })

    expect(result.runs.map((run) => run.status)).toEqual(["rejected", "rejected", "rejected"])
    const text = result.runs[0]!.evidence.map((entry) => entry.evidence).join(" | ")
    // 这条串只可能来自编译器自己的诊断（`code@path: detail`）。
    expect(text).toContain("unknown_action")
    expect(text).toContain("solid.create_unicorn")
  })

  it("模型只给了**澄清**（没给计划）⇒ 独立记 `clarification`，**不是** planned（fail-closed）", async () => {
    /**
     * **2026-10-05 第二次真实运行改的判据**（控制器裁决）：原来这一支记的是 `rejected`。
     * 那次运行的逐条行显示：被拒的那一条其实是**模型自己发现了矛盾、于是提问**
     *（"AB 不能同时等于 3 和 5，请二选一"）—— 那是**好**行为，而 `rejected` 这个格里
     * **同时装着**"编译器把计划拒了 / 模型根本没给计划"（真失败）。
     * 合成一个计数会把"模型做对了"读成"模型失败了"，方向恰好反过来。
     *
     * 所以"澄清"独立成一支（跨层词表里本来就有 `clarification`，见证层在用）。
     * **fail-closed 那一半一个字不改**：澄清**不是** `planned` —— 它仍然不算"计划被接受"。
     */
    const result = await runProviderPlanningEval({ resolveProvider: async () => RESOLVED, createPlanner: () => plannerReturning(CLARIFICATION_ENVELOPE) })

    expect(result.runs.map((run) => run.status)).toEqual(["clarification", "clarification", "clarification"])
    // 澄清的问题原文也要在证据里 —— 否则读者看不出这一支到底是"模型在问"还是"编译器说不行"。
    expect(result.runs[0]!.evidence.map((entry) => entry.evidence).join(" | ")).toContain("请说明底面四边形的形状")
    // **不是 planned**：这一条是这一支存在的前提（"问了"不等于"计划被接受"）。
    expect(result.runs.map((run) => run.status)).not.toContain("planned")
    /**
     * 汇总里也要有这一支的**计数行** —— 注意这里钉的是 `^clarification\s+3/3$`（整行），
     * **不是** `toContain("clarification")`：后者会被下面那些**逐条行**满足
     *（逐条行本来就打 `run.status`），于是删掉汇总行它也照样绿 —— 那是一条不可能红的断言。
     */
    expect(formatPlanningReport(result)).toMatch(/^clarification\s+3\/3$/m)
  })

  it("某一条**抛了** ⇒ 记 error 带原始消息，其余两条照跑（一条坏题不许拖垮整批）", async () => {
    const prompts = planningEvalCases().map((entry) => entry.prompt)
    const result = await runProviderPlanningEval({
      resolveProvider: async () => RESOLVED,
      createPlanner: () => ({
        plan: async (request: { userMessage: string }) => {
          if (request.userMessage === prompts[1]) throw new Error("provider 500: upstream unavailable")
          return { plan: ACCEPTED_ENVELOPE, requestId: "req-1", attemptId: "att-1" }
        }
      })
    })

    expect(result.runs.map((run) => run.status)).toEqual(["planned", "error", "planned"])
    expect(result.runs[1]!.evidence.map((entry) => entry.evidence).join(" ")).toContain("provider 500: upstream unavailable")
    // 出错的那条也说得清"是谁在跑"（`real_provider` 下只有 not_measured 允许缺身份）。
    expect(result.runs[1]!.provider).toBe("p-plan")
    expect(result.runs[1]!.latency?.totalMs).toBeGreaterThanOrEqual(0)
  })

  it("**请求形状是完整的**：真实 `createModelPlanner`（只换掉 transport）能跑完整条扫描", async () => {
    /**
     * 这条是这次发现的**真缺陷**的钉子。既有那套 harness（`providerAgentEval.ts:62` +
     * `offlineAgentEval.ts:30`）把请求写成 `{ userMessage } as never` —— 那对
     * `createLocalPlanner`（只读 `userMessage`）成立，对**真实**模型规划器**不成立**：
     * 它要 `request.model.context` / `request.run` / `request.budget` / `request.signal`。
     *
     * 所以这里用**真的** `createModelPlanner`（`runModel` 是假的 ⇒ 零网络、零费用）
     * 跑一遍：请求形状一旦退化，这条会立刻红。
     */
    const sent: string[] = []
    const result = await runProviderPlanningEval({
      resolveProvider: async () => RESOLVED,
      createPlanner: (resolution) => createModelPlanner({
        resolveProvider: async () => resolution,
        runModel: async (request) => {
          sent.push(request.profileId)
          return { ok: true as const, events: [{ kind: "delta" as const, requestId: "req-1", attemptId: "att-1", text: JSON.stringify(ACCEPTED_ENVELOPE) }] }
        }
      })
    })

    expect(result.runs.map((run) => run.status)).toEqual(["planned", "planned", "planned"])
    expect(sent).toEqual(["p-plan", "p-plan", "p-plan"])
  })

  it("整批记录必须是**合法**的：报告契约真的收下了它（不合法会抛）", async () => {
    const result = await runProviderPlanningEval({ resolveProvider: async () => RESOLVED, createPlanner: () => plannerReturning(ACCEPTED_ENVELOPE) })

    // `runs` 就是喂给 `buildBenchmarkReport` 的那一批；这里再独立建一次报告，
    // 证明"这条通道产出的记录"本身满足三条硬规矩（必需字段 / 模式标识 / claim 有证据）。
    expect(result.report.realProvider.runs).toHaveLength(PLANNING_EVAL_REQUESTS)
    expect(result.report.realProvider.extractionRate).toEqual({ covered: 0, total: 0, rate: null })
  })

  it("**逐条渲染**：汇总之外还要给出每一条的结局与理由（否则「rejected 1/3」说不出为什么）", async () => {
    /**
     * 这条的由来是**第一次真实运行暴露的缺口**（2026-10-05）：用户在桌面端跑出
     * `planned 2/3 / rejected 1/3`，但面板只打汇总 —— 被拒的那一条**为什么**被拒**看不到**，
     * 而原因其实就在 `runs[].evidence` 里（`code@path: detail`，或"模型给的是澄清 / 只读回答"）。
     * 诊断信息留在内存里而没渲染，等于这次运行白跑一半。
     *
     * 判据：格式化文本里必须出现**每一条题的 id**，以及**被拒那一条的真实理由原文**。
     */
    const cases = planningEvalCases()
    let seen = 0
    const result = await runProviderPlanningEval({
      resolveProvider: async () => RESOLVED,
      // 第 1 条接受、其余被拒（`REJECTED_ENVELOPE` 的动作没人登记过 ⇒ `unknown_action`）
      createPlanner: () => plannerReturning(seen++ === 0 ? ACCEPTED_ENVELOPE : REJECTED_ENVELOPE)
    })
    const text = formatPlanningReport(result)

    for (const entry of cases) expect(text).toContain(entry.id)
    expect(text).toContain("planned")
    expect(text).toContain("rejected")
    // 理由**原文**要在场：被拒那一条的证据是编译器自己的 `code@path: detail`
    expect(text).toMatch(/unknown_action/)
  })

  it("题集总数常量与真实条数一致（界面文案读它，题集一变就红在这里）", () => {
    expect(PLANNING_EVAL_TOTAL_CASES).toBe(parseBenchmarkCases().length)
  })

  /**
   * **N4e：把「要读的那段东西」呈现出来。**
   *
   * 两次真实运行暴露的前置条件：报告里只有**计数**与**证据串**，而「这条计划好不好读」要读的是
   * **模型给出的那段东西本身**。没有那段东西，任何可读性标注都是凭印象打分。
   *
   * 数据源是 harness 手里本来就有的**信封**（`planner.plan(...)` 的返回值 / `compilePlan` 的
   * `plan`），**不是**去解析证据串 —— 证据是「凭什么这么说」，正文是「说了什么」，两回事。
   */
  it("**人读区拿得到正文**：计划的 goal 与动作 / 澄清的问题 / 只读回答的正文", async () => {
    const planned = await runProviderPlanningEval({ resolveProvider: async () => RESOLVED, createPlanner: () => plannerReturning(ACCEPTED_ENVELOPE) })
    expect(planned.readable).toHaveLength(PLANNING_EVAL_REQUESTS)
    const entry = planned.readable[0]!
    expect(entry.caseId).toBe(planningEvalCases()[0]!.id)
    expect(entry.status).toBe("planned")
    expect(entry.text).toContain(ACCEPTED_ENVELOPE.goal)
    // 动作摘要也要在（只说"目标是建个东西"读不出它打算怎么建）。
    expect(entry.text).toContain("solid.create_template")
    // **正文不许混进 `evidence`**：那会让"证据"变成"正文"，而这一条读数正是为它们分开才做的。
    expect(planned.runs[0]!.evidence.map((item) => item.evidence).join(" | ")).not.toContain(ACCEPTED_ENVELOPE.goal)

    const asked = await runProviderPlanningEval({ resolveProvider: async () => RESOLVED, createPlanner: () => plannerReturning(CLARIFICATION_ENVELOPE) })
    expect(asked.runs[0]!.status).toBe("clarification")
    expect(asked.readable[0]!.text).toContain("请说明底面四边形的形状")

    const answered = await runProviderPlanningEval({ resolveProvider: async () => RESOLVED, createPlanner: () => plannerReturning(ANSWER_ENVELOPE) })
    // 只读回答对**这一层**是"没给计划" ⇒ 仍是 rejected（fail-closed 那一半没变），但它的正文有人读。
    expect(answered.runs.map((run) => run.status)).toEqual(["rejected", "rejected", "rejected"])
    expect(answered.readable[0]!.text).toContain("异面直线是指不同在任何一个平面内的两条直线")
  })

  it("**没有对象的那一条不留正文**（`error`），它也因此不进可读性分母", async () => {
    const prompts = planningEvalCases().map((entry) => entry.prompt)
    const result = await runProviderPlanningEval({
      resolveProvider: async () => RESOLVED,
      createPlanner: () => ({
        plan: async (request: { userMessage: string }) => {
          if (request.userMessage === prompts[1]) throw new Error("provider 500: upstream unavailable")
          return { plan: ACCEPTED_ENVELOPE, requestId: "req-1", attemptId: "att-1" }
        }
      })
    })

    expect(result.runs.map((run) => run.status)).toEqual(["planned", "error", "planned"])
    // 抛了的那一条**没有**任何可读正文 —— 于是它的 `text` 是空串，而不是"写点什么凑数"。
    expect(result.readable[1]!.text).toBe("")
    // 3 条记录里只有 2 条有对象可读：可读性分母是 2，不是 3。
    expect(result.report.realProvider.readability.total).toBe(2)
  })

  it("**可读性标注**：没标就是「未标注」，比率是 `null` 不是 `0`；标过之后才有比率", async () => {
    const result = await runProviderPlanningEval({ resolveProvider: async () => RESOLVED, createPlanner: () => plannerReturning(ACCEPTED_ENVELOPE) })
    const cases = planningEvalCases()
    const group = (annotated: ReturnType<typeof annotateReadability>, name: "plan" | "clarification" | "rejected") =>
      annotated.report.realProvider.readability.groups.find((entry) => entry.group === name)!

    // ① 谁都没标 —— **这一版做完的真实状态**：报告里出现的是「未标注」，不是一个 0 分。
    const none = annotateReadability(result, {})
    expect([group(none, "plan").total, group(none, "plan").annotated, group(none, "plan").unannotated]).toEqual([3, 0, 3])
    expect(group(none, "plan").readableRate).toBeNull()
    expect(formatPlanningReport(none)).toContain("已标 0 / 未标 3")
    expect(formatPlanningReport(none)).toContain("未标注")
    // 报告里**不许**出现"可读性 0"这种读起来像分数的写法。
    expect(formatPlanningReport(none)).not.toMatch(/readable 比率\s+0(\.0+)?\b/)

    // ② 标一条 `readable`：计数与比率都动，而且**不再自己数一遍**（走同一份报告契约）。
    const some = annotateReadability(result, { [cases[0]!.id]: "readable" })
    expect([group(some, "plan").annotated, group(some, "plan").unannotated]).toEqual([1, 2])
    expect(group(some, "plan").readableRate).toBe(1)
    expect(group(some, "plan").byValue).toEqual({ readable: 1, partly: 0, unreadable: 0 })
    expect(formatPlanningReport(some)).toContain("已标 1 / 未标 2")

    // 标注只碰 `humanReadability` 这一个字段：其余读数与正文一个字不动。
    expect(some.report.realProvider.byStatus).toEqual(result.report.realProvider.byStatus)
    expect(some.readable).toEqual(result.readable)
    // **纯函数**：原结果上的标注不被改动（标注是界面上的内存状态，不是回写到这一批记录里）。
    expect(result.runs[0]!.humanReadability).toBeNull()
  })
})

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createModelPlanner, type ModelPlannerDependencies, type ProviderResolution } from "../modelPlanner"
import { AGENT_TASK_FIXTURES } from "./agentTaskFixtures"
import { runEvalSweep, runOneEvalAttempt } from "./offlineAgentEval"

/**
 * **旧那条「agent 工具环」通道的请求形状**（子任务 N4d）。
 *
 * ## 这条用例在钉什么
 *
 * `offlineAgentEval.ts` 曾经把请求写成 `plan({ userMessage: fixture.prompt } as never)`：
 * 那对 `createLocalPlanner`（只读 `userMessage`）成立，对**真实**的 `createModelPlanner`
 * **不成立** —— 它在发请求之前就读 `request.model.context` / `request.run` /
 * `request.budget` / `request.signal`，少一样就是一次
 * `TypeError: Cannot read properties of undefined (reading 'context')`。
 *
 * 后果不是"报个错"那么轻：这条通道是应用里**唯一会花钱**的入口，而它从来没有真正发出过
 * 一次请求。上一批修掉了"假装在跑"（失败如实显示），**没有修它的输入** —— 于是它现在
 * 会明确报错，但仍然跑不了。这条用例钉的就是那个输入。
 *
 * ## 它与 `benchmarkPlanningEval.test.ts:229` 那条的关系
 *
 * 那条钉的是**题集 planning 通道**（21 条题集的接受率，另一个坐标系）；这条钉的是
 * **旧 8 题夹具**那条（`scoreAgentAttempts` 的 pass@1 / pass@3 / 工具选择）。
 * 两条各自独立，因为两套评测的判据与词表本来就不同。
 *
 * ## 零网络、零费用
 *
 * 用的是**真的** `createModelPlanner`（通道选择、提示词组装、信封解析全是生产代码），
 * 只把最外面那次 `runModel`（`provider_run` IPC）换成假的 —— 所以这条用例不发任何请求。
 */
const RESOLVED = {
  ok: true,
  provider: { id: "p-legacy", modelId: "m-legacy", dialect: "openai", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } }
} as ProviderResolution

/** 一份合法、可编译的计划信封（建一个立方体）：它让"每条尝试都真的走完规划"成立。 */
const ENVELOPE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "建一个立方体",
  factIds: [],
  actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
}

describe("旧 8 题夹具通道：请求形状必须与产品真实路径一致（N4d）", () => {
  it("真实 `createModelPlanner`（只换掉 transport）能跑完整条扫描：每条题都产出尝试，且 transport 真的被调用过", async () => {
    /**
     * 记的不只是"调了几次"，还有**每次请求里模型看到了什么提示词** —— 请求形状一旦退化
     * （例如又变回只有 `userMessage`），`model.context` 就没了，这里在断言之前就会先抛。
     */
    const runModelCalls: string[] = []
    const sentPrompts: string[] = []
    const runModel: NonNullable<ModelPlannerDependencies["runModel"]> = async (request) => {
      runModelCalls.push(request.profileId)
      sentPrompts.push(request.messages.at(-1)?.content ?? "")
      return {
        ok: true as const,
        events: [{ kind: "delta" as const, requestId: `req-${runModelCalls.length}`, attemptId: `att-${runModelCalls.length}`, text: JSON.stringify(ENVELOPE) }]
      }
    }
    const createPlanner = () => createModelPlanner({ resolveProvider: async () => RESOLVED, runModel })

    const attempts = await runEvalSweep(createPlanner, 3)

    // 每条题一条尝试：8 题 × 3 轮。改动前这里根本走不到（扫描在第一题就抛了）。
    expect(attempts.map((attempt) => attempt.fixtureId)).toEqual(AGENT_TASK_FIXTURES.flatMap((fixture) => [fixture.id, fixture.id, fixture.id]))
    // 8 题 × 3 轮 = 一次请求都不少；`> 0` 那一半是"真的发出去过"的判据。
    expect(runModelCalls.length).toBe(24)
    expect(runModelCalls.length).toBeGreaterThan(0)
    expect(runModelCalls.every((profileId) => profileId === "p-legacy")).toBe(true)
    // 每条题的原话确实进了那次请求 —— "跑过了"这句话要能追到实际发出去的东西。
    expect(sentPrompts).toEqual(AGENT_TASK_FIXTURES.flatMap((fixture) => [fixture.prompt, fixture.prompt, fixture.prompt]))
  })

  it("单条尝试也一样（`runOneEvalAttempt` 是那条通道的最小单位）", async () => {
    let runModelCalls = 0
    const createPlanner = () => createModelPlanner({
      resolveProvider: async () => RESOLVED,
      runModel: async () => {
        runModelCalls += 1
        return { ok: true as const, events: [{ kind: "delta" as const, requestId: "req-1", attemptId: "att-1", text: JSON.stringify(ENVELOPE) }] }
      }
    })

    const attempt = await runOneEvalAttempt(createPlanner, "create-cube", 1)

    expect(runModelCalls).toBe(1)
    expect(attempt.fixtureId).toBe("create-cube")
    expect(attempt.trial).toBe(1)
    // 规划真的走完了：这条尝试拿到了判题报告，而不是抛出去。
    expect(attempt.report).toBeDefined()
  })
})

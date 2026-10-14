import { EXAM_CASES, FROZEN_THRESHOLDS, PLAN_SCHEMA_VERSION, type ExamCase, type PlanEnvelope, type PlannerPort } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"

import { createModelPlanner, type ModelPlannerDependencies, type ProviderResolution } from "../modelPlanner"
import { createExamRunCase } from "./examRunAdapter"

/**
 * **Task 20 的产品侧适配器**：把一次试验接到记账上（这里全是假规划器或假 transport，零网络）。
 *
 * 钉四件事：
 *
 * - **请求形状**（2026-10-14 修的一条真缺陷）：上一版给规划器的是
 *   `{ run, userMessage } as never`，而**真实**的 `createModelPlanner().plan()` 头一件事就是读
 *   `request.model.context` ⇒ 在**任何请求发出之前**抛 `TypeError`。后果比"报错"重得多：
 *   付费那一跑会**看起来在跑**、36 条全记 `error`、一个 token 都没花。第一条用例用**真的**
 *   规划器（只换掉最外面那次 `runModel`）钉住"请求真的走完了"。
 * - **映射与失败层**：模型给计划 / 问路 / 回解释 / 抛错各自一档，且计划进了编译器之后
 *   **失败落在哪一层**（`schema` / `construct` / `verify`）由编译器的原始读数定，不在这里另判。
 * - **费用不由这层编**（由注入的 `costOf` 给）。
 * - **抛错不许被吞成"没跑"**。
 */

const CASE = EXAM_CASES[0]! as ExamCase
/** 立体那一族：编译要 `geometry3d` 工作区（与产品的族→工作区口径一致）。 */
const SOLID_CASE = EXAM_CASES.find((entry) => entry.family === "solid")! as ExamCase

function plannerReturning(plan: unknown): PlannerPort {
  return { plan: vi.fn(async () => ({ plan, requestId: "r", attemptId: "a" })) } as unknown as PlannerPort
}

/** 一份合法、可编译的计划信封（建一个立方体）——与 `offlineAgentEval.modelPlanner.test.ts` 同一份。 */
const CUBE_ENVELOPE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "建一个立方体",
  factIds: [],
  actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
}

/** **模型发明了一个不存在的动作**：在编译的第一层（字段审计）就会被拒。 */
const UNKNOWN_ACTION_ENVELOPE = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "一个不存在的动作",
  factIds: [],
  actions: [{ actionId: "nope.action", actionKey: "x", factIds: [], inputs: {} }]
} as unknown as PlanEnvelope

/** **零向量的棱柱**：计划合法、图造不出来（几何语义校验）。 */
const DEGENERATE_PRISM_ENVELOPE = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "退化棱柱",
  factIds: [],
  actions: [{
    actionId: "solid.create_prism",
    actionKey: "prism",
    factIds: [],
    inputs: { alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }], vector: { x: 0, y: 0, z: 0 } }
  }]
} as unknown as PlanEnvelope

describe("Task 20: 规划请求 → 编译 → 试验结局", () => {
  /**
   * **这一条就是那次真缺陷的钉子**：用真的 `createModelPlanner`（通道选择、提示词组装、信封解析
   * 全是生产代码），只把最外面那次 `runModel`（`provider_run` IPC）换成假的。
   *
   * 改动前的读数：规划器在发请求之前就抛 `TypeError: Cannot read properties of undefined
   * (reading 'context')` ⇒ `runModelCalls` 是 **0**、结局是 `error` —— 也就是"付费按钮看起来在跑、
   * 实际一次都没发"。现在请求由 `planRequestFor` 组装，形状与产品那一次相同。
   */
  it("**真实规划器能真的跑完一次**（请求形状完整；跑到 provider 而不是在门口抛）", async () => {
    const RESOLVED = {
      ok: true,
      provider: { id: "p-bench", modelId: "m-bench", dialect: "openai", revision: 1, capabilities: { tools: "unknown", json: "unknown", vision: "unknown" } }
    } as ProviderResolution
    const profileIds: string[] = []
    const sentPrompts: string[] = []
    const runModel: NonNullable<ModelPlannerDependencies["runModel"]> = async (request) => {
      profileIds.push(request.profileId)
      sentPrompts.push(request.messages.at(-1)?.content ?? "")
      return { ok: true as const, events: [{ kind: "delta" as const, requestId: "req-1", attemptId: "att-1", text: JSON.stringify(CUBE_ENVELOPE) }] }
    }
    const runCase = createExamRunCase({
      planner: createModelPlanner({ resolveProvider: async () => RESOLVED, runModel }),
      costOf: () => 0
    })

    const result = await runCase(SOLID_CASE, 1)

    // transport 真的被调用了（改动前这里恒为 0 条）。
    expect(profileIds).toEqual(["p-bench"])
    // 发出去的那次请求里，模型看到的确实是**这道题的题面**（不是一句占位）。
    expect(sentPrompts[0]).toContain(SOLID_CASE.prompt)
    // 走到了编译那一步（结局与失败层都由编译器给，不是"这一层自己出岔子"）。
    expect(result.outcome, result.detail).not.toBe("error")
    expect(result.detail ?? "").toContain("编译")
  })

  it("**失败落在哪一层由编译器说了算**：模型发明的动作 ⇒ `schema`，零向量棱柱 ⇒ `construct`", async () => {
    const invented = createExamRunCase({ planner: plannerReturning(UNKNOWN_ACTION_ENVELOPE), costOf: () => 0 })
    const inventedResult = await invented(SOLID_CASE, 1)
    expect(inventedResult.outcome).toBe("rejected")
    expect(inventedResult.failureLayer, inventedResult.detail).toBe("schema")

    const degenerate = createExamRunCase({ planner: plannerReturning(DEGENERATE_PRISM_ENVELOPE), costOf: () => 0 })
    const degenerateResult = await degenerate(SOLID_CASE, 1)
    expect(degenerateResult.outcome).toBe("rejected")
    expect(degenerateResult.failureLayer, degenerateResult.detail).toBe("construct")
  })

  it("反问 ⇒ `clarification`；回了一段解释 ⇒ `rejected` + 层名 `plan`（都没进编译器）", async () => {
    const asking = createExamRunCase({ planner: plannerReturning({ kind: "clarification" }), costOf: () => 0.05 })
    const asked = await asking(CASE, 1)
    expect(asked.outcome).toBe("clarification")
    expect(asked.failureLayer).toBeUndefined()
    const answering = createExamRunCase({ planner: plannerReturning({ kind: "answer" }), costOf: () => 0.05 })
    const answered = await answering(CASE, 1)
    expect(answered.outcome).toBe("rejected")
    // 没给计划 ⇒ 连编译器都没进，层名是 `plan`（不是 schema/construct）。
    expect(answered.failureLayer).toBe("plan")
    expect(answered.detail).toContain("kind=answer")
  })

  it("**规划器抛错 ⇒ `error`**，不吞异常、也不假装没跑", async () => {
    const planner = { plan: vi.fn(async () => { throw new Error("provider 401") }) } as unknown as PlannerPort
    const runCase = createExamRunCase({ planner, costOf: () => 0 })
    const result = await runCase(CASE, 2)
    expect(result.outcome).toBe("error")
    expect(result.failureLayer).toBeUndefined()
    expect(result.detail).toContain("provider 401")
  })

  it("**费用不由这一层编**：`costOf` 收到的是真实的这一次（题、试次、结局）", async () => {
    const seen: unknown[] = []
    const runCase = createExamRunCase({
      planner: plannerReturning(CUBE_ENVELOPE),
      costOf: (request) => {
        seen.push({ caseId: request.examCase.id, trial: request.trial, hasOutcome: request.outcome !== null })
        return 0.3
      },
      now: () => 1000
    })
    const result = await runCase(SOLID_CASE, 3)
    expect(result.costUsd).toBe(0.3)
    expect(seen).toEqual([{ caseId: SOLID_CASE.id, trial: 3, hasOutcome: true }])
    // 冻结表里现在是**用户点过头的那份授权**（2026-10-14，逐字记在 `frozenThresholds.ts`）——
    // 而这一层仍然**不会**自己去跑任何东西：它只被 `runExamEvaluation` 调用，
    // 授权闸在那边（`assertPaidRunAllowed`）。这条断言守的是"这一层没有自己的开关"。
    expect(FROZEN_THRESHOLDS.authorization.status).toBe("granted")
  })
})

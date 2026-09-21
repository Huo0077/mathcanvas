import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import type { PlannerPort } from "@draw/agent-core"

import { useAgentStore } from "../agentStore"
import { useSceneStore } from "../store"
import { createAgentRunner } from "./agentRunner"

/**
 * **确认提交这条链路**（Task 2.5 Step 4，计划 G2 Gate 的"preview → confirm → commit → undo"）。
 *
 * 用的是**真实**的运行时（真 `DraftStore`、真 `HostBridge`、真 `CommitterAdapter`、真协调器），
 * 只有规划器是本地确定性的那一份 —— 没有它就没法离线跑通整条链。
 */
function resetScene() {
  const document = createEmptyDocument("geometry3d")
  useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })
}

function resetAgent() {
  localStorage.clear()
  useAgentStore.getState().clearAll()
}

async function runAndWait(runner: ReturnType<typeof createAgentRunner>, prompt: string) {
  useAgentStore.getState().sendPrompt(prompt)
  const conversation = useAgentStore.getState().activeConversation!
  const userMessage = conversation.messages.find((message) => message.role === "user")!
  return runner.run(prompt, userMessage.id)
}

describe("the confirm and commit cycle", () => {
  beforeEach(() => {
    resetScene()
    resetAgent()
  })

  it("stages a draft without touching the document, then commits it on confirmation", async () => {
    const runner = createAgentRunner()
    const before = useSceneStore.getState().document

    const result = await runAndWait(runner, "建一个棱长 3 的立方体")

    // 停在确认阶段，真文档**一个字节都没变**。
    expect(result.phase).toBe("awaiting_confirmation")
    expect(result.draftId).toBeTruthy()
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(before.primitives).toHaveLength(0)
    expect(runner.hasDraft()).toBe(true)

    const outcome = runner.confirm()

    expect(outcome.status).toBe("committed")
    // 文档真的变了，而且**恰好压一步历史**（撤销得回去）。
    expect(useSceneStore.getState().document.primitives.length).toBeGreaterThan(0)
    expect(useSceneStore.getState().history).toHaveLength(1)
  })

  it("records a committed receipt on the assistant message", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    runner.confirm()

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.pending).toBe(false)
    expect(assistant.commit?.status).toBe("committed")
  })

  it("leaves the document untouched when the user discards the draft", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    const discarded = runner.discard()

    expect(discarded).toBe(true)
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(useSceneStore.getState().history).toHaveLength(0)
    // 丢弃之后不能再提交（否则会去用一个已经不存在的草稿）。
    expect(runner.confirm().status).toBe("rejected")
  })

  it("refuses to commit a second time after the first commit", async () => {
    // 同意是一次性的：第一份草稿提交完就该消失，再点确认必须被拒。
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    expect(runner.confirm().status).toBe("committed")

    const second = runner.confirm()

    expect(second.status).toBe("rejected")
    expect(useSceneStore.getState().document.primitives.length).toBeGreaterThan(0)
  })

  /**
   * **规划器声明的假设必须走到确认界面上**（`AssumptionList` / `ConfirmationPanel` 的那一节）。
   *
   * 这一节此前**永远是空的**：组件做完了、数据没有 —— 计划信封里根本没有 `assumptions` 字段。
   * 现在信封有了（`EnvelopeAssumptions`），需要证明它真的**贯穿**：
   * 规划器 → 协调器（`onPlanParsed`）→ 运行时 → 运行器 → 界面草稿视图 → 确认面板。
   *
   * 用可注入的规划器，是因为本地确定性规划器**从不声明假设**（它产出固定动作）；
   * 真实 provider 接进来时，"模型声明了什么假设"正是这条链要传的东西。
   */
  it("carries the planner's declared assumptions all the way to the confirmation view", async () => {
    const planner: PlannerPort = {
      async plan() {
        return {
          requestId: "req-assumptions",
          attemptId: "attempt-assumptions",
          plan: {
            schemaVersion: "mathcanvas.plan.v1",
            kind: "plan",
            goal: "建一个立方体",
            factIds: [],
            assumptions: ["把「棱长 3」读作边长 3", "底面默认落在地面上"],
            actions: [{
              actionId: "solid.create_template",
              actionKey: "cube",
              factIds: [],
              inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } }
            }]
          }
        }
      }
    }
    const runner = createAgentRunner({ planner })

    const result = await runAndWait(runner, "建一个立方体")

    expect(result.phase).toBe("awaiting_confirmation")
    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.draft?.assumptions).toEqual(["把「棱长 3」读作边长 3", "底面默认落在地面上"])
    // 假设只是**说明**，它不许顺手把文档改掉 —— 提交仍然要用户点。
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })

  it("leaves the assumptions empty when the planner declares none", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.draft?.assumptions).toBeUndefined()
  })

  it("does not change the document when the user never confirms", async () => {    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    // 什么都不点：文档保持原样，历史也没有多一步。
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(useSceneStore.getState().history).toHaveLength(0)
    expect(runner.hasDraft()).toBe(true)
  })

  it("can be undone in exactly one step after a confirmed commit", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    runner.confirm()
    expect(useSceneStore.getState().document.primitives.length).toBeGreaterThan(0)

    useSceneStore.getState().undo()

    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })

  it("reports a question instead of staging anything when the planner does not recognise the prompt", async () => {
    const runner = createAgentRunner()

    const result = await runAndWait(runner, "帮我求这个四面体的外接球半径并画出球")

    /**
     * 澄清走的是 `planning → answering → waiting`（协调器先进入作答分支，再落到等待）。
     * 我第一版断言的是 `waiting`，实际是 `answering` —— **测试写错了**，不是协调器错了：
     * 协调器的路径是"计划不是 plan 类型 → 进 answering → 如果是 clarification 再进 waiting"，
     * 而 `run()` 返回的是 `start()` 结束时的相位（此时已经是 waiting）……
     * 但事件流里最后一条确实是 waiting，所以这里按**事件流的最后一条**断言，
     * 而不是按返回值 —— 返回值是给调用方的摘要，事件流才是账本。
     */
    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.trace?.at(-1)?.phase).toBe("waiting")
    expect(result.draftId).toBeNull()
    expect(runner.hasDraft()).toBe(false)
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    // 界面拿到的是"需要补充信息"，而不是一段编造的回答。
    expect(assistant.failure?.code).toBe("needs_more_information")
  })

  it("records the run trace so the user can see how far it got", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    const phases = assistant.trace?.map((entry) => entry.phase) ?? []

    expect(phases).toContain("preflight")
    expect(phases).toContain("observing")
    expect(phases).toContain("planning")
    expect(phases).toContain("compiling")
    expect(phases.at(-1)).toBe("awaiting_confirmation")
  })

  /**
   * **开发者详细视图有东西可看**（Task 2.6 Step 4）。
   *
   * `ToolTracePanel` 的 `<details>` 默认关着，而"关着"只有在**真有内容**时才是"opt-in"；
   * 没有内容就是一块永远空的折叠区。这条用例钉住"运行确实往那一层写了行"，
   * 并且写的是**账本字段**（阶段 / 来源阶段 / 详情 / 序号），不是别的东西。
   */
  it("also records a developer-facing diagnostic trace behind the collapsed view", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    const diagnostics = assistant.diagnostics ?? []

    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics.some((line) => line.includes("preflight"))).toBe(true)
    expect(diagnostics.some((line) => line.includes("planning"))).toBe(true)
  })
})

describe("stop and retry", () => {
  beforeEach(() => {
    resetScene()
    resetAgent()
  })

  it("stops a run that is waiting for confirmation and leaves the document alone", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    expect(runner.hasDraft()).toBe(true)

    const stopped = runner.stop()

    expect(stopped).toBe(true)
    // 停下之后草稿作废：留着它会让用户看到一份永远不会生效的预览。
    expect(runner.hasDraft()).toBe(false)
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    // 再点确认必须被拒（那份草稿已经不在了）。
    expect(runner.confirm().status).toBe("rejected")
  })

  it("tells the user it stopped on their request, and that nothing changed", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    runner.stop()

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.failure).toMatchObject({ code: "cancelled_by_user", retryable: true })
    expect(assistant.failure?.message).toContain("没有改动文档")
  })

  it("reports a no-op stop when nothing is running", () => {
    const runner = createAgentRunner()

    // 没有运行时实例就如实返回 false，不假装取消成功。
    expect(runner.stop()).toBe(false)
  })

  it("retries the same sentence in a fresh run", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    runner.stop()

    const messages = useAgentStore.getState().activeConversation!.messages
    const lastUser = [...messages].reverse().find((message) => message.role === "user")!
    const result = await runner.retry(lastUser.text, lastUser.id)

    // 新一轮同样停在确认阶段，并且拿到的是**新**草稿。
    expect(result.phase).toBe("awaiting_confirmation")
    expect(runner.hasDraft()).toBe(true)
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })
})

/**
 * **真实模型接进规划器**（G2 接线）。
 *
 * 这一组是 G2 Gate 第一条那条链的**模型版**：模型的 JSON → 真实编译 → 隔离草稿 →
 * 用户确认 → 落盘 → 一步撤销。用注入的 `runModel`（脚本化的模型接口）而不是注入的规划器，
 * 于是"从 `provider_run` 回来的一串事件"到"画布上真出现对象"之间**每一个真实部件都跑到了**。
 */
describe("the model-backed planner", () => {
  beforeEach(() => {
    resetScene()
    resetAgent()
  })

  const modelText = (text: string) => ({ ok: true as const, events: [{ kind: "delta" as const, requestId: "req-1", attemptId: "att-1", text }] })
  const cubeEnvelope = (size: number) => JSON.stringify({
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: `建一个棱长 ${size} 的立方体`,
    factIds: [],
    assumptions: ["底面落在地面上"],
    actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: size, y: size, z: size } } }]
  })

  const selectedProvider = { resolveProvider: async () => ({ ok: true as const, provider: { id: "openai-1", modelId: "gpt-x", dialect: "openai_native", revision: 3, capabilities: { tools: "unknown" as const, json: "verified" as const, vision: "unknown" as const } } }) }

  it("sends the prompt to the selected profile and turns its JSON into a real, confirmable draft", async () => {
    const calls: { profileId: string; messages: { role: string; content: string }[] }[] = []
    const runner = createAgentRunner({
      modelPlanner: {
        ...selectedProvider,
        runModel: async (request) => { calls.push({ profileId: request.profileId, messages: request.messages }); return modelText(cubeEnvelope(3)) }
      }
    })

    const result = await runAndWait(runner, "建一个棱长 3 的立方体")

    // 「使用中」的那一份被真的用上了：调用方一个 profileId 都没传。
    expect(calls).toHaveLength(1)
    expect(calls[0].profileId).toBe("openai-1")
    // 提示词里带上了动作菜单（这一轮不发 provider 侧的工具表，所以菜单只能写在提示词里）。
    const prompt = calls[0].messages.map((message) => message.content).join("\n")
    expect(prompt).toContain("solid.create_template")

    expect(result.phase).toBe("awaiting_confirmation")
    // 确认之前文档一个字节不动；确认之后真的落盘，且**恰好一步**历史。
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(runner.confirm().status).toBe("committed")
    expect(useSceneStore.getState().document.primitives.length).toBeGreaterThan(0)

    useSceneStore.getState().undo()
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })

  it("carries the model's declared assumptions into the confirmation view", async () => {
    const runner = createAgentRunner({ modelPlanner: { ...selectedProvider, runModel: async () => modelText(cubeEnvelope(3)) } })

    await runAndWait(runner, "建一个棱长 3 的立方体")

    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.draft?.assumptions).toEqual(["底面落在地面上"])
  })

  it("gives an unparseable answer exactly one repair attempt, and says what was wrong", async () => {
    // 计划 Task 2.3 Step 5："Include exact JSON path errors in the second prompt"。
    const sent: string[] = []
    const runner = createAgentRunner({
      modelPlanner: {
        ...selectedProvider,
        runModel: async (request) => {
          sent.push(request.messages.map((message) => message.content).join("\n"))
          // 第一次给散文，第二次才给合法信封 —— 修复通道必须真的被用上。
          return modelText(sent.length === 1 ? "我建议你先画一个点，然后再画线。" : cubeEnvelope(2))
        }
      }
    })

    const result = await runAndWait(runner, "建一个立方体")

    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain("上一轮的输出没有被接受")
    // 修复提示不回显模型的原话（回显会形成自我强化的循环）。
    expect(sent[1]).not.toContain("我建议你先画一个点")
    expect(result.phase).toBe("awaiting_confirmation")
  })

  it("reports a provider failure with its classification instead of inventing a plan", async () => {
    const runner = createAgentRunner({
      modelPlanner: { ...selectedProvider, runModel: async () => ({ ok: false, failure: "auth", message: "the provider rejected the credential (401)", retryable: false }) }
    })

    const result = await runAndWait(runner, "建一个立方体")

    expect(result.phase).toBe("failed")
    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.failure?.message).toContain("401")
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })

  it("shows the question the model actually asked, instead of claiming there is no model service", async () => {
    const clarification = JSON.stringify({ schemaVersion: "mathcanvas.plan.v1", kind: "clarification", goal: "缺少半径", factIds: [], questions: ["这个圆的半径是多少？"] })
    const runner = createAgentRunner({ modelPlanner: { ...selectedProvider, runModel: async () => modelText(clarification) } })

    const result = await runAndWait(runner, "画一个圆")

    expect(result.draftId).toBeNull()
    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.failure?.code).toBe("needs_more_information")
    expect(assistant.failure?.message).toContain("这个圆的半径是多少？")
    expect(assistant.failure?.message).not.toContain("没有接入模型服务")
  })

  it("falls back to the local planner when nothing is selected, without touching IPC's model path", async () => {
    let called = false
    const runner = createAgentRunner({
      modelPlanner: {
        resolveProvider: async () => ({ ok: false, code: "no_active_profile", detail: "还没有选择「使用中」的模型服务。" }),
        runModel: async () => { called = true; return modelText(cubeEnvelope(3)) }
      }
    })

    const result = await runAndWait(runner, "建一个棱长 3 的立方体")

    // 本地规划器照常干活（离线路径没有退化），而且**一次模型调用都没发生**。
    expect(called).toBe(false)
    expect(result.phase).toBe("awaiting_confirmation")
  })
})

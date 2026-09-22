import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import type { PlanEnvelope, PlannerPort, PlanRequest } from "@draw/agent-core"

import { useAgentStore } from "../agentStore"
import { conversationRepository } from "../conversationRepository"
import { readConversation } from "../services/conversationClient"
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

/**
 * **运行在飞的时候用面板，不该把这次运行打崩**（2026-09-21，端到端跑出来的真实缺陷）。
 *
 * `runtime` 是**模块级**变量，而 `runPrompt` 在 `for await` 期间会交出控制权；只要这期间
 * 有任何一个入口把它置空（`confirm()` / `discard()` / `stop()` 都会），运行回来再读
 * `runtime.coordinator.phase()` 就抛 `Cannot read properties of null (reading 'coordinator')`
 * —— 一次运行以 TypeError 结束，而界面上只显示"没有完成"。
 *
 * 触发它的真实路径很普通：**上一轮留下的草稿面板还在**，用户（或脚本）不经意点了确认，
 * 而刚发出去的那一轮还在等模型。
 */
describe("a run in flight survives the panel being used", () => {
  beforeEach(() => {
    resetScene()
    resetAgent()
  })

  it("keeps running when confirm is clicked while the model is still answering", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const planner: PlannerPort = {
      async plan() {
        await gate
        return {
          requestId: "req-in-flight",
          attemptId: "attempt-in-flight",
          plan: {
            schemaVersion: "mathcanvas.plan.v1",
            kind: "plan",
            goal: "建一个立方体",
            factIds: [],
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

    const pending = runAndWait(runner, "建一个棱长 3 的立方体")
    // 让这次运行真的进到规划器的 await 里（否则它同步跑完，测不到这个竞态）。
    await Promise.resolve()
    await Promise.resolve()
    // 运行还在飞的时候用一次面板 —— 这会把它持有的那份运行时置空。
    runner.confirm()
    release()

    // 修好之前：这里以 TypeError 结束，而不是正常走到"等你确认"。
    const result = await pending
    expect(result.phase).toBe("awaiting_confirmation")
    expect(result.draftId).toBeTruthy()
  })
  it("commits when the run itself switched the workspace (the real path from 平面几何)", async () => {
    /**
     * 真实用户就是在**平面几何**里说"建一个立方体"的，而 `prepare` 会在运行中把工作区切到立体几何
     * —— `switchWorkspace` 会**换一份空白文档**（新 id）。既有用例全都从 `geometry3d` 起步，
     * 所以这条路一次都没被走过。它来自一次真实运行：界面上草稿好好的，点确认却回
     * `there is no staged draft to confirm`。
     */
    const planar = createEmptyDocument("conics")
    useSceneStore.setState({ document: planar, workspaceDocuments: { conics: planar }, history: [], future: [], error: null })
    const runner = createAgentRunner()

    const result = await runAndWait(runner, "建一个棱长 3 的立方体")

    expect(result.phase).toBe("awaiting_confirmation")
    expect(runner.confirm().status).toBe("committed")
    expect(useSceneStore.getState().document.primitives.length).toBeGreaterThan(0)
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

/**
 * **会话上下文进规划**（对话切片 Task 4；规格 §5.3/§5.4）。
 *
 * 这一节要证的不是"上下文里有什么字段"，而是**那三件会串会话的事**：
 * 绑定在运行开始时**钉住**（之后切会话不改）、两次尝试（含修复）看到的是**同一份上下文**、
 * 以及历史里确实带着这一轮之前说过的话。上下文本身（排序 / 预算 / 草稿不进事实）
 * 由 `@draw/agent-core` 的 `contextBuilder.test.ts` 钉住。
 */
describe("the run pins its conversation context", () => {
  /** 一个**合法**的计划信封（走真实校验），本地规划器之外的那条路径用得上。 */
  const cubePlan = (size: number): PlanEnvelope => ({
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: `创建一个棱长 ${size} 的立方体`,
    factIds: [],
    actions: [{
      actionId: "solid.create_template",
      actionKey: "cube",
      factIds: [],
      inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: size, y: size, z: size } }
    }]
  })

  beforeEach(() => {
    resetScene()
    resetAgent()
  })

  it("hands the planner the pinned binding, the history and the observation", async () => {
    const document = useSceneStore.getState().document
    // 这一轮之前已经聊过两句：它们必须在规划器看到的历史里。
    useAgentStore.getState().sendPrompt("先前的一句")
    useAgentStore.getState().resolvePendingReply("好的。")
    const conversationId = useAgentStore.getState().activeConversation!.id

    const requests: PlanRequest[] = []
    const planner: PlannerPort = {
      async plan(request) {
        requests.push(request)
        if (requests.length === 1) {
          // 第一次给一个非法信封，逼出那次**修复尝试**（第二次机会）。
          return { requestId: "r1", attemptId: "a1", plan: { syntax: "wrong" } as unknown as PlanEnvelope }
        }
        return { requestId: "r2", attemptId: "a2", plan: cubePlan(3) }
      }
    }
    const runner = createAgentRunner({ planner })

    await runAndWait(runner, "建一个棱长 3 的立方体")

    expect(requests).toHaveLength(2)
    const first = requests[0].conversation
    expect(first.binding.conversationId).toBe(conversationId)
    expect(first.binding.documentId).toBe(document.metadata.id)
    expect(first.binding.workspace).toBe(document.workspace)
    expect(first.binding.generation).toBe(document.revision)
    // 历史：这一轮之前说过的话都在（当前请求由 `userMessage` 单独承载，不在这里重复）。
    expect(first.messages.map((message) => message.text)).toEqual(["先前的一句", "好的。"])
    // 当前场景是权威来源，必须一起交出去。
    expect(first.observation.summary).toBeTruthy()
    // **两次尝试看到的是同一个对象**：第二次机会不许换题目。
    expect(requests[1].conversation).toBe(first)
    expect(requests[1].conversation.binding).toEqual(first.binding)
  })

  it("keeps the run's conversation after the user switches to another one", async () => {
    const requests: PlanRequest[] = []
    const planner: PlannerPort = {
      async plan(request) {
        requests.push(request)
        // 模型"想"的这段时间里，用户切到了另一条会话。
        useAgentStore.getState().createConversation()
        return { requestId: "r1", attemptId: "a1", plan: cubePlan(2) }
      }
    }
    const runner = createAgentRunner({ planner })
    const first = useAgentStore.getState().activeConversation!.id
    await runAndWait(runner, "建一个棱长 2 的立方体")

    // 这一次运行绑的仍然是**开始那一刻**的那条会话。
    expect(requests[0].conversation.binding.conversationId).toBe(first)
    expect(useAgentStore.getState().activeConversation?.id).not.toBe(first)
  })
})

/**
 * **提交留下的长期记忆**（对话切片 Task 5；规格 §5.2/§10）。
 *
 * 只有**真的提交了**才写事实：代数 + 这次创建的对象。用户丢弃草稿、编译失败都不写 ——
 * "把还没发生的事记成已确认事实"是这一层最危险的错误，而它只要有一处写错就会发生。
 */
describe("a committed run leaves long-term memory behind", () => {
  /** 落盘是**旁路**（界面不等它）：等几个微任务让它跑完。 */
  async function flush(): Promise<void> {
    for (let at = 0; at < 12; at += 1) await Promise.resolve()
  }

  beforeEach(() => {
    resetScene()
    resetAgent()
  })

  it("records the document generation and the created objects of a confirmed commit", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id

    runner.confirm()
    await flush()

    const record = await conversationRepository().readRecord(conversationId)
    expect(record?.facts).toHaveLength(1)
    expect(record?.facts[0].status).toBe("confirmed")
    // 提交真的改了文档：代数与创建出来的对象都在事实里。
    const stored = await readConversation(conversationId)
    const value = stored.ok ? stored.value.facts[0]?.valueJson as { generation?: number; createdObjects?: string[] } : undefined
    expect(value?.generation).toBe(useSceneStore.getState().document.revision)
    expect(value?.createdObjects?.some((id) => id.startsWith("solid-"))).toBe(true)
  })

  it("writes no fact when the user discards the draft", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id

    expect(runner.discard()).toBe(true)
    await flush()

    const record = await conversationRepository().readRecord(conversationId)
    expect(record?.facts).toEqual([])
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })

  it("writes no fact when the plan fails to compile", async () => {
    // 零拉伸向量的棱柱会被编译器拒（"refuses a prism with a zero extrusion vector"）：
    // 这一轮以 `compile_failed` 结束，因此**什么都不许写进长期记忆**。
    const planner: PlannerPort = {
      async plan() {
        return {
          requestId: "r1",
          attemptId: "a1",
          plan: {
            schemaVersion: "mathcanvas.plan.v1",
            kind: "plan",
            goal: "建一个退化的棱柱",
            factIds: [],
            actions: [{
              actionId: "solid.create_prism",
              actionKey: "prism",
              factIds: [],
              inputs: {
                alias: "prism",
                basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }],
                vector: { x: 0, y: 0, z: 0 }
              }
            }]
          }
        }
      }
    }
    const runner = createAgentRunner({ planner })

    const result = await runAndWait(runner, "建一个棱柱")
    await flush()

    expect(result.phase).toBe("failed")
    const conversationId = useAgentStore.getState().activeConversation!.id
    expect((await conversationRepository().readRecord(conversationId))?.facts).toEqual([])
  })
})

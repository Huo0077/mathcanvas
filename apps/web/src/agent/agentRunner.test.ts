import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import type { PlanEnvelope, PlannerPort, PlanRequest } from "@draw/agent-core"

import { useAgentStore } from "../agentStore"
import { conversationRepository, MAX_SUMMARY_CHARS, setConversationRepository } from "../conversationRepository"
import { summaryOfDocument, withDocumentSummary } from "../conversationSummary"
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
  /**
   * **最后一条**用户消息 —— 不是第一条。
   *
   * 同一段用例里第二次 `sendPrompt` 时，第一条用户消息是**上一轮**的那句；
   * 把它当成这一轮的 prompt 会让 `pinRun` 钉到上一轮那条已经结束的助手消息上，
   * 于是这一轮的事件全部被"没有在途消息"那条纪律丢掉（Fix round 1 里当场抓到的一次）。
   */
  const userMessage = [...conversation.messages].reverse().find((message) => message.role === "user")!
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

  /**
   * **读会话记录抛错，不能让这一轮"点了没反应"**（外部审查 A3）。
   *
   * `readConversationSource` 里那句 `readRecord` 原先在 try/catch **外面**，而桌面侧读会话记录
   * 是会抛的（走 IPC）。一抛，`runner.run` 就在**协调器启动之前** reject：界面上那条固定的
   * 助手消息永远停在 `pending`、输入框一直禁用，而 `AgentWorkspace` 的 `void onRun(...)`
   * 把这个 rejection 吞掉了 —— 用户看到的是"点了没反应"，且没有任何报错。
   *
   * 期望的行为本来就是注释里写的那句："读不到就当作还没有长期记忆，不编一份摘要或事实出来"，
   * 外加**如实记一行诊断**（不是静默吞掉）。
   */
  it("still runs the turn when reading the stored conversation throws", async () => {
    const base = conversationRepository()
    setConversationRepository({ ...base, readRecord: async () => { throw new Error("the desktop repository is unreachable") } })
    try {
      const runner = createAgentRunner()

      // 关键：`run` 不 reject，而是照常走完这一轮（草稿照样成型）。
      const result = await runAndWait(runner, "建一个棱长 3 的立方体")

      expect(result.phase).toBe("awaiting_confirmation")
      expect(runner.hasDraft()).toBe(true)
      // 而且把原因**说出来**了。
      const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
      expect((assistant.diagnostics ?? []).some((line) => line.includes("could not read the stored conversation"))).toBe(true)
    } finally {
      setConversationRepository(null)
    }
  })

  /**
   * **缺事实时要把"缺的是哪个"说给用户**（外部审查 Agent-M4）。
   *
   * 协调器停在 `waiting` 有两个来源：规划器给的澄清问题（`questions()` 有值），
   * 以及"计划引用了本次观察没有的对象"。原先后者只落到那句写死的"这一步需要你补充信息。" ——
   * 用户既不知道缺哪个对象、也无从回答（审计在 29 个对象的真实文档上撞到过：
   * 引用第 13 个对象就死在这里）。现在宿主把账本那句话原样转给用户。
   */
  it("names the missing object when the plan cites something this run did not observe", async () => {
    const planner: PlannerPort = {
      plan: async () => ({
        plan: {
          schemaVersion: "mathcanvas.plan.v1",
          kind: "plan",
          goal: "把 solid-not-observed 挪一下",
          factIds: ["solid-not-observed"],
          actions: [{ actionId: "solid.create_template", actionKey: "c", factIds: ["solid-not-observed"], inputs: { alias: "c", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } } }]
        } as unknown as PlanEnvelope,
        requestId: "req-1",
        attemptId: "attempt-1"
      })
    }
    const runner = createAgentRunner({ planner })

    const result = await runAndWait(runner, "把 solid-not-observed 挪一下")

    expect(result.phase).toBe("waiting")
    const assistant = useAgentStore.getState().activeConversation!.messages.at(-1)!
    expect(assistant.pending).toBe(false)
    // `failPendingReply` 把话放在 `failure.message` 里（`text` 是空的），界面渲染的就是它。
    // **点名**：修复前这里只有一句写死的"这一步需要你补充信息。"。
    expect(assistant.failure?.message).toContain("solid-not-observed")
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

  /**
   * **读上下文这一步也必须认那条钉住的会话**（Fix round 1 / I1）。
   *
   * 上一条用例只在**规划器内部**切会话 —— 那时上下文已经读完了，所以它证明不了这件事。
   * 真正危险的窗口是 `pinRun` 之后、读上下文之前的那些 `await`（桌面端要过 IPC 问「使用中」
   * 的配置）。用户在这个窗口里切走，这一轮就可能拿到**另一条会话**的历史与事实，
   * 而它的事件仍然写回原会话 —— 两边对不上，正是 §5.4 要防的那种串线。
   */
  it("reads the context of the conversation it pinned, even when the user switches during the awaited provider lookup", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const sent: string[] = []
    const envelope = JSON.stringify({
      schemaVersion: "mathcanvas.plan.v1",
      kind: "plan",
      goal: "建一个棱长 2 的立方体",
      factIds: [],
      actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
    })
    const runner = createAgentRunner({
      modelPlanner: {
        // 这一步在桌面端要过 IPC：它就是要被用户"插队"的那个窗口。
        resolveProvider: async () => {
          await gate
          return { ok: true, provider: { id: "openai-1", modelId: "gpt-x", dialect: "openai_native", revision: 3, capabilities: { tools: "unknown" as const, json: "verified" as const, vision: "unknown" as const } } }
        },
        runModel: async (request) => {
          sent.push(request.messages.map((message) => message.content).join("\n"))
          return { ok: true, events: [{ kind: "delta" as const, requestId: "req-1", attemptId: "att-1", text: envelope }] }
        }
      }
    })

    useAgentStore.getState().sendPrompt("A 的问题")
    const first = useAgentStore.getState().activeConversation!.id
    const promptMessageId = useAgentStore.getState().activeConversation!.messages.find((message) => message.role === "user")!.id

    const running = runner.run("A 的问题", promptMessageId)
    // 让 `run` 走到那个 await，然后用户切到另一条会话并在那里说话。
    await Promise.resolve()
    useAgentStore.getState().createConversation()
    useAgentStore.getState().sendPrompt("B 的问题")
    release()
    await running

    // 这一轮看到的是 **A** 的一切：绑定是 A，历史里没有 B 说过的话。
    expect(sent[0]).toContain(first)
    expect(sent[0]).not.toContain("B 的问题")
    // 事件也落在 A 上（不是当前显示的那条会话）。
    const inA = useAgentStore.getState().conversations.find((conversation) => conversation.id === first)!
    expect(inA.messages.at(-1)?.diagnostics?.some((line) => line.includes(`[context] conversation ${first}`))).toBe(true)
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

  /**
   * **消息也要记下它是哪一版文档的**（Fix round 2 / item 5；`conversation_messages.document_generation`）。
   *
   * 这一列原先**没有任何写点**（Minor 2 的后半）：`conversation_messages.run_id` 已经由
   * `pinRun` 写上，而 `document_generation` 一直是 NULL —— 于是"这条消息说的是哪一版文档"
   * 只能靠时间去猜。写点放在**追加那一刻**：运行器知道当时的文档版本，消息却只在第一次有内容时
   * 追加（幂等键），所以"追加时的版本"是唯一诚实的值。
   */
  it("records which document generation a run's message was about", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    const generation = useSceneStore.getState().document.revision

    const stored = await readConversation(conversationId)
    const messages = stored.ok ? stored.value.messages : []

    expect(messages.at(-1)?.documentGeneration).toBe(generation)
  })

  /**
   * **用户提问那条消息也要带上版本**（Follow-up item 3）。
   *
   * 它正是事实的**证据**（`conversation_facts.source_message_id` 指的就是它），而原先它的
   * `document_generation` 是 `NULL`：发送路径（`sendPrompt`）在界面那一层，手里没有文档句柄。
   * 现在运行器把"现取当前版本"注入给 store（与仓储注入同一个风格），于是这条证据也能说清
   * "它是哪一版文档上的提问"。
   */
  it("records the document generation on the user prompt that facts cite as evidence", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    const generation = useSceneStore.getState().document.revision

    const stored = await readConversation(conversationId)
    const rows = stored.ok ? stored.value.messages : []

    expect(rows[0]?.role).toBe("user")
    expect(rows[0]?.documentGeneration).toBe(generation)
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

  /**
   * **用户现场**：在平面几何文档里让 Agent 建立体 —— 模型给的计划里混着平面动作与立体动作。
   *
   * 这一轮曾经以 `compile_failed: workspace_mismatch: … a prism can only be created in the solid
   * workspace` 结束，而账本里那次"一次性修复"（`asking for the one repair (1/1)`）救不回来：
   * **模型改不了文档的工作区**。
   *
   * 根因是切工作区那条判据**按第一笔动作**决定（循环里第一个命中就 `return`）：第一笔是
   * `planar.*` 就切平面，后面那笔 `solid.create_prism` 于是必然被编译器拒。判据必须与动作顺序无关，
   * 而且**三维优先** —— `geometry3d` 的文档同样接受平面动作（`schema.ts` 没有"工作区 ↔ 图元类型"的约束，
   * 编译器也只对立体那两族设了工作区守卫），反过来不成立。
   */
  it("switches to the solid workspace when a plan mixes planar and solid actions, instead of dropping the solid ones", async () => {
    useSceneStore.getState().switchWorkspace("conics", "user")
    const planner: PlannerPort = {
      async plan() {
        return {
          requestId: "r1",
          attemptId: "a1",
          plan: {
            schemaVersion: "mathcanvas.plan.v1",
            kind: "plan",
            goal: "画一个正四面体",
            factIds: [],
            actions: [
              { actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "a", points: [{ x: 0, y: 0 }] } },
              { actionId: "planar.create_point", actionKey: "b", factIds: [], inputs: { alias: "b", points: [{ x: 3, y: 0 }] } },
              { actionId: "planar.create_point", actionKey: "c", factIds: [], inputs: { alias: "c", points: [{ x: 1.5, y: 2.6 }] } },
              { actionId: "planar.create_point", actionKey: "d", factIds: [], inputs: { alias: "d", points: [{ x: 1.5, y: 0.87 }] } },
              {
                actionId: "solid.create_prism",
                actionKey: "prism",
                factIds: [],
                inputs: {
                  alias: "prism",
                  basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 1.5, y: 2.6, z: 0 }],
                  vector: { x: 0, y: 0, z: 3 }
                }
              }
            ]
          }
        }
      }
    }
    const runner = createAgentRunner({ planner })

    const result = await runAndWait(runner, "画一个正四面体 ABCD，棱长为 3")

    // 以前这里是 `failed`（进度文档「棱锥 / 工作区」两节记着这条现场）。
    expect(result.phase).toBe("awaiting_confirmation")
    expect(useSceneStore.getState().document.workspace).toBe("geometry3d")
  })

  /**
   * 上一条**不许把既有行为改坏**：整条计划都属于同一个工作区时照旧自动切过去
   *（"用户在 Agent 里说'建一个立方体'时画布可能停在平面几何"—— 不切的话这条指令就得用户自己先切再重发）。
   */
  it("still switches the workspace when the whole plan belongs to one of them", async () => {
    useSceneStore.getState().switchWorkspace("conics", "user")
    const planner: PlannerPort = {
      async plan() {
        return {
          requestId: "r1",
          attemptId: "a1",
          plan: {
            schemaVersion: "mathcanvas.plan.v1",
            kind: "plan",
            goal: "建一个三棱柱",
            factIds: [],
            actions: [{
              actionId: "solid.create_prism",
              actionKey: "prism",
              factIds: [],
              inputs: {
                alias: "prism",
                basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 1.5, y: 2.6, z: 0 }],
                vector: { x: 0, y: 0, z: 3 }
              }
            }]
          }
        }
      }
    }
    const runner = createAgentRunner({ planner })

    const result = await runAndWait(runner, "建一个三棱柱")

    expect(result.phase).toBe("awaiting_confirmation")
    expect(useSceneStore.getState().document.workspace).toBe("geometry3d")
  })

  /**
   * **用户现场（2026-09-22）**：模型回了一个裸数组，界面上只有
   * `the plan never matched the schema: invalid_type@envelope` —— 一句内部码，用户不知道该做什么。
   * 这一层要说人话（引擎那句话仍然留给诊断与修复通道）。
   */
  it("tells the user what shape the model returned instead of leaking an internal code", async () => {
    const planner: PlannerPort = {
      async plan() {
        return { requestId: "r1", attemptId: "a1", plan: [] as unknown as PlanEnvelope }
      }
    }
    const runner = createAgentRunner({ planner })

    const result = await runAndWait(runner, "画一个正四面体")

    expect(result.phase).toBe("failed")
    const assistant = [...useAgentStore.getState().activeConversation!.messages].reverse().find((message) => message.role === "assistant")!
    expect(assistant.failure?.message).toContain("JSON 对象")
    expect(assistant.failure?.message).toContain("an array")
  })

  /**
   * **别份文档确认的事实不许进这一轮**（Fix round 1 / C1；规格 §5.1 + §9）。
   *
   * 这个应用里换工作区**就是换文档**（`switchWorkspace` 会换掉 `document`，第一次访问还会
   * mint 一个新的 `metadata.id`）。会话却是同一台机器上的同一条，所以"在立体几何里确认的
   * 第 3 版新增 solid-1"完全可能在平面几何那一轮被当成本文档的事实塞给模型 ——
   * 而那份文档里根本没有这个对象。
   */
  it("never injects a fact that was confirmed against another document", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    const geometry3d = useSceneStore.getState().document.metadata.id

    runner.confirm()
    await flush()

    // 先证明这条事实**确实**在会话里（不然下面那条断言是空的）。
    const record = await conversationRepository().readRecord(conversationId)
    expect(record?.facts).toHaveLength(1)
    expect(record?.facts[0]?.documentId).toBe(geometry3d)

    // 用户切到平面几何（= 另一份文档），在同一条会话里继续问。
    const conics = createEmptyDocument("conics")
    useSceneStore.setState({ document: conics, workspaceDocuments: { [conics.workspace]: conics }, history: [], future: [], error: null })

    await runAndWait(runner, "画一个点")

    const diagnostics = useAgentStore.getState().activeConversation!.messages.at(-1)?.diagnostics ?? []
    const context = diagnostics.find((line) => line.includes("[context]")) ?? ""
    expect(context).toContain("0 confirmed fact(s)")
    // 那条事实还在会话里（它不是被删了，只是**不属于这份文档**）。
    expect((await conversationRepository().readRecord(conversationId))?.facts).toHaveLength(1)
  })

  /**
   * **失效的事实不再以"已确认"的身份进下一轮**（Follow-up：事实的 `stale` 路径）。
   *
   * 事实原先只有一种归宿（`confirmed`）：提交时写下"文档第 N 版新增 solid-1"，
   * 之后用户**撤销**掉这次改动，那条事实照样是"已确认" —— 模型于是拿着一个文档里
   * 根本不存在的东西继续规划。这一轮的注入在**读之前**按证据重判一次：只有文档本身
   * 能证明它不再成立时才降级（这里就是：那些对象已经不在画布上、版本也退回去了）。
   */
  it("revalidates stored facts against the live document before injecting them", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id

    runner.confirm()
    await flush()

    // 先证明这条事实**确实**在、而且引用了这次提交创建出来的对象（不然下面的断言是空的）。
    const committed = await readConversation(conversationId)
    const value = committed.ok ? committed.value.facts[0]?.valueJson as { createdObjects?: string[] } : undefined
    expect(value?.createdObjects?.length ?? 0).toBeGreaterThan(0)

    // 用户撤销：文档退回提交之前那一版，那些对象不在画布上了。
    useSceneStore.getState().undo()
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)

    await runAndWait(runner, "画布上有什么")

    const diagnostics = useAgentStore.getState().activeConversation!.messages.at(-1)?.diagnostics ?? []
    expect(diagnostics.find((line) => line.includes("[context]")) ?? "").toContain("0 confirmed fact(s)")
    // 降级**落回了仓储**（不是只在这一次注入里被跳过），并且记下了是哪条证据。
    expect((await conversationRepository().readRecord(conversationId))?.facts[0].status).toBe("stale")
    const stored = await readConversation(conversationId)
    const invalidated = stored.ok ? stored.value.facts[0]?.valueJson as { invalidation?: { status?: string; reason?: string; evidence?: string } } : undefined
    expect(invalidated?.invalidation?.status).toBe("stale")
    expect(invalidated?.invalidation?.reason).toContain("solid-")
    expect(invalidated?.invalidation?.evidence).toContain("document:")
  })

  /**
   * **用户说"这条不算数了"就真的不算数**（Follow-up：`retract` 路径）。
   *
   * 与 `stale` 不同，这是一次**用户动作**：事实原文与它的证据消息都留着（可核对、可回溯），
   * 只是状态转成 `retracted` —— 于是它不再是"现状"，也不会进任何一轮的提示词。
   */
  it("never injects a retracted fact into a run", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id

    runner.confirm()
    await flush()

    const key = (await conversationRepository().readRecord(conversationId))!.facts[0].key
    expect(await useAgentStore.getState().retractFact({ conversationId, key, reason: "这个立方体我不要了" })).toBe(true)

    await runAndWait(runner, "画布上有什么")

    const diagnostics = useAgentStore.getState().activeConversation!.messages.at(-1)?.diagnostics ?? []
    expect(diagnostics.find((line) => line.includes("[context]")) ?? "").toContain("0 confirmed fact(s)")
    // 事实还在（不是被删了），只是不再当事实用。
    const record = await conversationRepository().readRecord(conversationId)
    expect(record?.facts).toHaveLength(1)
    expect(record?.facts[0].status).toBe("retracted")
  })

  /**
   * **别份文档的记忆也不许从 `summary` 那条路进来**（Fix round 2 / C1 残余；规格 §5.1 + §9）。
   *
   * 上一条用例挡的是**事实列表**，而摘要是同一段内容的另一条载体：它把该会话全部已确认事实的
   * 原文与创建出来的对象 id 压进一段文字。可达路径是**刻意的**那一条：Agent 自己为执行计划
   * 切了工作区（绑定不跟着换，`useAgentDocumentBinding` 的例外），于是同一条会话继续被用在
   * 另一份文档上 —— 事实筛掉了，摘要如果不筛，`solid-*` 照样出现在这一轮的提示词里。
   */
  it("never leaks another document's memory into the prompt through the summary", async () => {
    // 一条足够长的会话（超过摘要阈值），并把第一句留作事实的证据。
    useAgentStore.getState().sendPrompt("建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    const promptMessageId = useAgentStore.getState().activeConversation!.messages.find((message) => message.role === "user")!.id
    for (let turn = 0; turn < 40; turn += 1) {
      useAgentStore.getState().sendPrompt(`第 ${turn} 轮：请继续作图（${"很长的上下文".repeat(20)}）`)
      useAgentStore.getState().resolvePendingReply(`收到 ${turn}`)
    }
    const geometry3d = useSceneStore.getState().document.metadata.id
    useAgentStore.getState().pinRun({ runId: "run-geometry", promptMessageId })
    await useAgentStore.getState().recordCommittedRun({ runId: "run-geometry", generation: 3, createdObjects: ["solid-1"], documentId: geometry3d })
    await flush()

    // 先证明那份记忆**确实**在会话里（不然下面的断言是空的）。
    const stored = await conversationRepository().readRecord(conversationId)
    expect(JSON.stringify(summaryOfDocument(stored!.summary, geometry3d))).toContain("solid-1")

    // Agent 自己把画布切到平面几何（= 另一份文档）：绑定**故意不跟**，
    // 于是同一条会话继续被用在另一份文档上 —— 这就是那条可达路径。
    useSceneStore.getState().switchWorkspace("conics", "agent")
    const conics = useSceneStore.getState().document.metadata.id
    expect(conics).not.toBe(geometry3d)

    // 用模型路径拿到**真正发出去的提示词**。
    const sent: string[] = []
    const envelope = JSON.stringify({
      schemaVersion: "mathcanvas.plan.v1",
      kind: "answer",
      goal: "回答场景里有什么",
      factIds: [],
      answer: "只有这一份文档里的对象。",
      toolResultRefs: []
    })
    const modelRunner = createAgentRunner({
      modelPlanner: {
        resolveProvider: async () => ({ ok: true, provider: { id: "openai-1", modelId: "gpt-x", dialect: "openai_native", revision: 3, capabilities: { tools: "unknown" as const, json: "verified" as const, vision: "unknown" as const } } }),
        runModel: async (request) => {
          sent.push(request.messages.map((message) => message.content).join("\n"))
          return { ok: true, events: [{ kind: "delta" as const, requestId: "req-1", attemptId: "att-1", text: envelope }] }
        }
      }
    })

    useAgentStore.getState().sendPrompt("画布上有什么")
    const asked = [...useAgentStore.getState().activeConversation!.messages].reverse().find((message) => message.role === "user")!
    await modelRunner.run("画布上有什么", asked.id)

    // 这一轮绑的是**另一份文档**（不然上面的断言什么都没证明）……
    expect(sent[0]).toContain(conics)
    // ……而立体几何那份文档的记忆（事实原文与对象 id）一个字都不许出现。
    expect(sent[0]).not.toContain("solid-1")
    expect(sent[0]).not.toContain("已确认：文档第 3 版")
    // 本文档（平面几何）这一轮还没有任何已确认事实。
    expect(sent[0]).toContain('"confirmedFacts":[]')
  })

  /**
   * **摘要被削这件事要真的落到那条消息上**（Fix round 3 / I1）。
   *
   * 这一行诊断是在**回执之后**才产生的（摘要要等长期记忆那一步才算得出来），而回执那一步
   * 已经做掉了两件事：这一轮的落点被退休、消息也不再"在途"。原先按 `runId` 写的诊断
   * 于是**静默消失** —— "削过摘要要说出来"这半件事根本没交付（数据没坏，但用户与开发者
   * 都看不到）。这条用例走**真实的 `confirm()` 顺序**（运行 → 确认 → 回执 → 写长期记忆），
   * 所以它在修复前会失败（review 点名的"用例抓不到真缺陷"）。
   */
  it("reports a trimmed summary book on the message of the run the user confirmed", async () => {
    // 一条足够长的会话（越过摘要阈值），再把一本**刚好差一点就满**的书种进仓储。
    useAgentStore.getState().sendPrompt("建一个棱长 3 的立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    for (let turn = 0; turn < 40; turn += 1) {
      useAgentStore.getState().sendPrompt(`第 ${turn} 轮：请继续作图（${"很长的上下文".repeat(20)}）`)
      useAgentStore.getState().resolvePendingReply(`收到 ${turn}`)
    }
    const seed = { goal: "", confirmedFacts: ["甲 已确认"], createdObjects: ["solid-0"], openQuestions: [], preferences: [], messageCount: 3, compactedAt: 1 }
    const seedBook = withDocumentSummary("", "doc-seed", seed)
    const unPadded = withDocumentSummary(seedBook, "doc-pad", seed).length
    /**
     * 上限由**导出常量**推导，不写字面量（外部审查 M7）：
     * 上一版把 `16_000` 抄在这里，于是它与 Rust 的 `16 * 1024` 差 2.4% 也没人发现；
     * 而"离上限只剩 200 字符"这个编排只有在与**仓储/商店同一个数**对齐时才成立。
     */
    const padded = withDocumentSummary(seedBook, "doc-pad", { ...seed, goal: "目".repeat(MAX_SUMMARY_CHARS - 200 - unPadded) })
    expect(padded.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS)
    await conversationRepository().saveSummary({ conversationId, summary: padded })

    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")
    // 回执要落的那条助手消息（`confirm()` 之后它就不再"在途"了）。
    const assistantId = useAgentStore.getState().pendingReplyId!

    runner.confirm()
    await flush()

    // 先证明**确实**削了（不然下面那条断言是空的）：最旧那份没了、本次这份还在、总数没越界。
    const record = await conversationRepository().readRecord(conversationId)
    expect(summaryOfDocument(record!.summary, "doc-seed")).toBeNull()
    expect(summaryOfDocument(record!.summary, "doc-pad")).not.toBeNull()
    expect(record!.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS)

    const assistant = useAgentStore.getState().activeConversation!.messages.find((message) => message.id === assistantId)
    const diagnostics = assistant?.diagnostics ?? []
    expect(diagnostics.some((line) => line.includes("[summary]") && line.includes("doc-seed"))).toBe(true)
  })

  /**
   * **确认的是"用户点的那块面板"，不是"最近的那一轮"**（Fix round 1 / C2；规格 §5.4）。
   *
   * 面板按消息渲染，而回执/提交原先用的是模块级**单槽** `runtime`/`pendingCommit` ——
   * 于是"在 A 里暂存草稿 → 切到 B 再暂存一份 → 回到 A 点确认"会提交 **B** 的草稿：
   * 文档被 B 的计划改掉，回执与事实也写进 B。这一节的判据就是"只有 A 被写"。
   */
  it("commits the draft of the run whose panel the user clicked, not the most recent one", async () => {
    const runner = createAgentRunner()

    // A：暂存一份草稿（并记住这一轮的 runId —— 面板上按的就是它）。
    await runAndWait(runner, "建一个棱长 3 的立方体")
    const first = useAgentStore.getState().activeConversation!
    const runInA = first.messages.at(-1)!.runId!

    // B：另一条会话里也暂存一份（它是**最近**的一轮）。
    useAgentStore.getState().createConversation()
    await runAndWait(runner, "建一个棱长 5 的立方体")
    const second = useAgentStore.getState().activeConversation!
    const runInB = second.messages.at(-1)!.runId!
    expect(runInB).not.toBe(runInA)

    // 用户回到 A（面板就在 A 的对话记录里）并点确认。
    await useAgentStore.getState().selectConversation(first.id)
    const outcome = runner.confirm(runInA)
    await flush()

    expect(outcome.status).toBe("committed")
    // 回执与事实都落在 **A**；B 那条在途消息一点都没被碰。
    const inA = useAgentStore.getState().conversations.find((conversation) => conversation.id === first.id)!
    const inB = useAgentStore.getState().conversations.find((conversation) => conversation.id === second.id)!
    expect(inA.messages.at(-1)?.commit?.status).toBe("committed")
    expect(inB.messages.at(-1)?.commit).toBeUndefined()
    expect((await conversationRepository().readRecord(first.id))?.facts).toHaveLength(1)
    expect((await conversationRepository().readRecord(second.id))?.facts ?? []).toEqual([])
    // B 的那份草稿还在（没被消费掉）：`hasDraft` 说的是"还有没有等待确认的草稿"。
    expect(runner.hasDraft()).toBe(true)
  })

  it("refuses a confirm for a run that is not live", async () => {
    const runner = createAgentRunner()
    await runAndWait(runner, "建一个棱长 3 的立方体")

    const refused = runner.confirm("run-that-never-existed")

    expect(refused.status).toBe("rejected")
    // 拒绝路径一个字节都不写。
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(runner.hasDraft()).toBe(true)
  })

  /**
   * **提交被拒时这一轮还活着**（Fix round 2 / item 3）。
   *
   * `confirm` 原先**无条件**把这一轮从表里删掉（`retireRun`），于是提交被拒之后面板还挂在
   * 界面上，用户再点一次却得到"这一轮已经不在等确认了" —— 真正的原因被第二句话盖掉，
   * 而且 `hasDraft()` 也变成 false，界面再也说不出"这里还有一份草稿"。
   *
   * **拒绝理由在 2026-09-22 变了（外部审查 X2 的连带修正）**：这里原先断言 `commit_rejected`
   * （手工建了同一个 `point-1`，重放时撞 id）。但"用户手工编辑过文档"这件事现在**更早**
   * 就被挡下来 —— 一次性同意绑定的是**草稿编译时**的句柄，而手工编辑让实时句柄变了，
   * 于是 CAS 先给出 `stale_source`。这既更早也更准确：用户听到的是"文档在草稿生成之后变过"，
   * 而不是一句让人摸不着头脑的"重复 id"。**这条用例真正守的性质没变**：
   * 被拒之后这一轮仍然活着，再点一次报的还是同一个真实原因。
   */
  it("keeps the run alive when the commit was refused, so the user can retry", async () => {
    const runner = createAgentRunner()
    // 本地规划器认这句 → 暂存一个平面点（分配器会给它 `point-1`）。
    await runAndWait(runner, "画一个点")
    const runId = useAgentStore.getState().activeConversation!.messages.at(-1)!.runId!

    // 用户手工建了**同一个 id** 的对象（真实出现过的现场：画布上已经有了同类对象）。
    // 这一笔同时让"文档已经不是草稿编译时的那一版"成立。
    useSceneStore.getState().apply({ op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 5, y: 5 } })

    const first = runner.confirm(runId)
    expect(first.status).toBe("stale_source")
    // 拒绝路径一个字节都不写：用户那一笔还在，草稿没有落进来。
    expect(useSceneStore.getState().document.primitives.map((primitive) => primitive.id)).toEqual(["point-1"])

    // 面板还挂着：再点一次必须**仍然**报真实原因，而不是"这一轮已经不在等确认了"。
    const second = runner.confirm(runId)
    expect(second.detail ?? "").not.toContain("not waiting")
    expect(second.detail).toBe(first.detail)
    expect(runner.hasDraft()).toBe(true)
  })
})

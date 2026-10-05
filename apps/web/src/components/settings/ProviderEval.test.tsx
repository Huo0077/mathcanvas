import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createLocalPlanner } from "../../agent/localPlanner"
import type { ProviderResolution } from "../../agent/modelPlanner"
import { PLANNING_EVAL_TRIALS, planningEvalCases } from "../../agent/fixtures/benchmarkPlanningEval"
import { ProviderEval } from "./ProviderEval"

/**
 * **唯一会花钱的按钮**：它的形状是被"要花钱"这条性质决定的。
 *
 * 这一组用例守三件事：
 *
 * 1. **两段式**：第一次点击**只解析配置、不发请求**，并说清"将发出多少次请求、发给谁"；
 * 2. **不配好就不发**：解析失败时如实显示原因码，且**一次请求都没发**；
 * 3. **只有确认才跑**：确认后跑完显示读数（延迟有数、成本写 `not measured`）。
 *
 * 第 2 条用"一被调用就抛"的规划器来验 —— 只要有人提前发请求，用例就会以那个异常失败。
 *
 * ## N4b：这里现在有**两套**评测，两个按钮、各自两段式、各自报自己的请求数
 *
 * 上面三条守的是**旧的**那套（agent 工具环：8 题 × 3 轮 = 24 次请求），它的行为一个字没改。
 * 新增的那套跑的是**题集**（21 条 benchmark 题集里的前 3 条），测"计划有没有被编译接受" ——
 * 两个坐标系不能混报，也不能合并成一个按钮（那会让"我点了什么、会花多少钱"说不清）。
 */

/** 一份能被编译接受的计划（见 `benchmarkPlanningEval.test.ts`）。 */
const ACCEPTED_ENVELOPE: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "建一个立方体",
  factIds: [],
  actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }]
}
describe("设置 → 真实 provider 评测", () => {
  const resolved = {
    ok: true,
    provider: { id: "p-eval", modelId: "m-eval", dialect: "openai", revision: 1, capabilities: {} as never }
  } as ProviderResolution

  it("第一次点击**不发请求**，只说要发几次、发给谁", async () => {
    let planned = 0
    render(<ProviderEval dependencies={{
      resolveProvider: async () => resolved,
      createPlanner: () => ({ plan: async () => { planned += 1; throw new Error("确认之前不许发请求") } })
    }} />)

    fireEvent.click(screen.getByRole("button", { name: /跑真实评测/ }))

    await screen.findByText(/将向/)
    expect(screen.getByText("p-eval / m-eval")).toBeTruthy()
    expect(screen.getByText("24")).toBeTruthy()
    expect(planned).toBe(0)
  })

  it("确认之后才跑，并显示读数（成本如实写 not measured）", async () => {
    render(<ProviderEval dependencies={{ resolveProvider: async () => resolved, createPlanner: () => createLocalPlanner() }} />)

    fireEvent.click(screen.getByRole("button", { name: /跑真实评测/ }))
    await screen.findByText(/将向/)
    fireEvent.click(screen.getByRole("button", { name: "确认开始" }))

    await waitFor(() => expect(screen.getByText(/measured against a real provider/)).toBeTruthy())
    // 报告在同一个 `<pre>` 里，而 testing-library 会把空白折叠 —— 所以这里用 `\s+` 而不是数空格。
    expect(screen.getByText(/average cost\s+not measured/)).toBeTruthy()
  })

  it("**没配好 provider 就一次都不发**，并如实显示原因码", async () => {
    let planned = 0
    render(<ProviderEval dependencies={{
      resolveProvider: async () => ({ ok: false, code: "no_active_profile", detail: "还没有选择「使用中」的模型服务" }),
      createPlanner: () => ({ plan: async () => { planned += 1; throw new Error("没配 provider 不该发请求") } })
    }} />)

    fireEvent.click(screen.getByRole("button", { name: /跑真实评测/ }))

    await screen.findByText(/没有测/)
    expect(screen.getByText("no_active_profile")).toBeTruthy()
    expect(screen.getByText(/一次请求都没有发出/)).toBeTruthy()
    expect(planned).toBe(0)
  })

  it("**题集 planning**：独立按钮 + 独立两段式，请求数 = 实际要跑的题数 × 轮数", async () => {
    const prompts: string[] = []
    render(<ProviderEval dependencies={{
      resolveProvider: async () => resolved,
      createPlanner: () => ({ plan: async (request) => { prompts.push(request.userMessage); return { plan: ACCEPTED_ENVELOPE, requestId: "req-1", attemptId: "att-1" } } })
    }} />)

    // 两套评测**并存**：旧那套的按钮还在（它的行为一个字不改）。
    expect(screen.getByRole("button", { name: /跑真实评测/ })).toBeTruthy()

    const cases = planningEvalCases()
    fireEvent.click(screen.getByRole("button", { name: /题集 planning/ }))
    // 第一段：只解析配置 —— 一个请求都还没发。
    await screen.findByRole("button", { name: "确认开始（题集 planning）" })
    expect(prompts).toHaveLength(0)

    const planning = screen.getByRole("region", { name: "真实 provider 评测：题集 planning" })
    const text = planning.textContent ?? ""
    // 文案里的请求数/题数必须**等于这一次真正要跑的那套题集**（不是硬编码的 8，也不是题集全部的 21）。
    expect(text).toContain(`发出 ${cases.length * PLANNING_EVAL_TRIALS} 次请求`)
    expect(text).toContain(`${cases.length} 题 × ${PLANNING_EVAL_TRIALS} 轮`)
    expect(text).toContain("p-eval / m-eval")
    // 说完"发给谁、几题几轮"之后，还要说清这与上面那 24 次是**两笔不同的开销**。
    expect(text).toContain("24")

    // 第二段：确认之后才真的跑，而且跑的正是那几条题面。
    fireEvent.click(screen.getByRole("button", { name: "确认开始（题集 planning）" }))
    await waitFor(() => expect(prompts).toHaveLength(cases.length))
    expect(prompts).toEqual(cases.map((entry) => entry.prompt))
    await waitFor(() => expect(screen.getByText(/planned\s+3\/3/)).toBeTruthy())
    expect(screen.getByText(/cost\s+not measured/)).toBeTruthy()
  })

  it("**题集 planning**：没配好 provider 时同样一次都不发，并如实报原因码", async () => {
    let planned = 0
    render(<ProviderEval dependencies={{
      resolveProvider: async () => ({ ok: false, code: "no_secret", detail: "配置还没有保存密钥" }),
      createPlanner: () => ({ plan: async () => { planned += 1; throw new Error("没配 provider 不该发请求") } })
    }} />)

    fireEvent.click(screen.getByRole("button", { name: /题集 planning/ }))

    const planning = await screen.findByRole("region", { name: "真实 provider 评测：题集 planning" })
    await waitFor(() => expect(planning.textContent).toContain("no_secret"))
    expect(planning.textContent).toContain("一次请求都没有发出")
    expect(planned).toBe(0)
  })

  it("**题集 planning**：解析那一步抛了也不许把面板卡在「正在跑…」", async () => {
    render(<ProviderEval dependencies={{ resolveProvider: async () => { throw new Error("IPC 断了") } }} />)

    fireEvent.click(screen.getByRole("button", { name: /题集 planning/ }))

    const planning = screen.getByRole("region", { name: "真实 provider 评测：题集 planning" })
    // 如实报出底层那句话，并且说清"没有拿到任何读数"—— 卡在"正在跑…"等于什么都没说。
    await waitFor(() => expect(planning.textContent).toContain("IPC 断了"))
    expect(planning.textContent).toContain("没有拿到任何读数")
  })
})

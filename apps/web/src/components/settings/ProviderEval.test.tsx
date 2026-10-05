import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createLocalPlanner } from "../../agent/localPlanner"
import type { ProviderResolution } from "../../agent/modelPlanner"
import { MAX_TRANSPORT_ATTEMPTS } from "../../agent/modelPlanner"
import { PLANNING_EVAL_TRIALS, planningEvalCases } from "../../agent/fixtures/benchmarkPlanningEval"
import { ProviderEval } from "./ProviderEval"

/**
 * **会花钱的入口**（2026-10-05 起是**两个**：agent 工具环 / 题集 planning）：它们的形状是被"要花钱"这条性质决定的。
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
    expect(screen.getByText("至少 24")).toBeTruthy()
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
    // **「至少」是本次修正**（复核 M-5）：那条通道每条题在传输类失败时会重试，最多 ×`MAX_TRANSPORT_ATTEMPTS`，
    // 所以"将发出 N 次"是**假的精确**；文案必须说是下界，且上限要从**同一处**取。
    expect(text).toContain(`至少 ${cases.length * PLANNING_EVAL_TRIALS} 次请求`)
    expect(text).toContain(`×${MAX_TRANSPORT_ATTEMPTS}`)
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

  it("**老那套（agent 工具环）抛了也不许把面板卡在「正在跑…」**（与上一连同形：复核 I-2）", async () => {
    /**
     * 这一条的由来：复核指出我只给**新**通道补了 `failed` 态，而**旧**通道的同型坑原样留着
     * —— 于是它遇到异常时会永远停在"正在跑…（至少 24 次请求）"。
     *
     * **这不是一条理论上的兜底**：旧通道把请求写成 `{ userMessage }`，真实规划器在发出任何请求之前
     * 就会抛（`TypeError: Cannot read properties of undefined (reading 'context')`）—— 也就是说
     * **今天这条分支是必然走到的**。这里用一个必抛的规划器把那个行为钉住。
     * 注意：这一条**只**要求"失败如实显示"，它**没有**修那条通道的请求形状（那会改变旧评测语义）。
     */
    render(<ProviderEval dependencies={{
      resolveProvider: async () => resolved,
      createPlanner: () => ({ plan: async () => { throw new Error("Cannot read properties of undefined (reading 'context')") } })
    }} />)

    fireEvent.click(screen.getByRole("button", { name: /跑真实评测/ }))
    await screen.findByText(/将向/)
    fireEvent.click(screen.getByRole("button", { name: "确认开始" }))

    const section = screen.getByRole("region", { name: "真实 provider 评测" })
    await waitFor(() => expect(section.textContent).toContain("reading 'context'"))
    expect(section.textContent).toContain("没有拿到任何读数")
    // 不许还在说"正在跑…"（那正是这次要修掉的样子）。
    expect(section.textContent).not.toContain("正在跑…")
  })

  /**
   * **N4e：人读区（只读）+ 三值标注（只存在内存里）**。
   *
   * 这条的由来是两次真实运行暴露的前置条件：报告里只有计数与证据串，于是「这条计划好不好读」
   * 无从判断。所以先要把**模型给的那段正文**摆出来，再让人按写死的口径标。
   *
   * 判据分三块：① 正文真的在界面上（不是只躺在内存里）；② 没标注时显示的是「未标注」而不是 0 分；
   * ③ 标了之后计数跟着动 —— 三个按钮只写内存，这一版不落盘。
   */
  it("**人读区**：呈现模型给的正文（只读），三值标注只存在内存里", async () => {
    render(<ProviderEval dependencies={{
      resolveProvider: async () => resolved,
      createPlanner: () => ({ plan: async () => ({ plan: ACCEPTED_ENVELOPE, requestId: "req-1", attemptId: "att-1" }) })
    }} />)

    fireEvent.click(screen.getByRole("button", { name: /题集 planning/ }))
    await screen.findByRole("button", { name: "确认开始（题集 planning）" })
    fireEvent.click(screen.getByRole("button", { name: "确认开始（题集 planning）" }))

    const planning = screen.getByRole("region", { name: "真实 provider 评测：题集 planning" })
    const cases = planningEvalCases()
    // ① 正文必须在场。改动之前面板只有计数与证据摘要（`ok=true；诊断 0 条…`）—— 这条当时是红的。
    await waitFor(() => expect(planning.textContent).toContain(ACCEPTED_ENVELOPE.goal))

    const area = screen.getByRole("region", { name: "人读区（只读）" })
    const blocks = within(area).getAllByRole("article")
    expect(blocks).toHaveLength(cases.length)
    expect(blocks[0]!.textContent).toContain(cases[0]!.id)
    expect(blocks[0]!.textContent).toContain(ACCEPTED_ENVELOPE.goal)
    // 「只读」：这一块里没有任何可输入的控件；判断由旁边那三个按钮记录。
    expect(area.querySelector("textarea, input")).toBeNull()

    // ② 谁都没标时，报告里出现的是「未标注」（**不是** 0 分，也不是一个占位比率）。
    expect(blocks[0]!.textContent).toContain("当前标注：未标注")
    expect(planning.textContent).toContain("已标 0 / 未标 3")

    // ③ 标一条：计数在内存里跟着动（这一版**不落盘**，也没有任何持久化位置）。
    fireEvent.click(within(blocks[0]!).getByRole("button", { name: "readable" }))
    await waitFor(() => expect(planning.textContent).toContain("已标 1 / 未标 2"))
    expect(within(area).getAllByRole("article")[0]!.textContent).toContain("当前标注：readable")
  })

  /**
   * **fix2 round（复核 §4 的 N5）**：`group !== null` 但**没有正文**的那一条，不许"同屏自相矛盾"。
   *
   * 可达性（复核实测 + 本用例实测）：坏的 plan 信封（`actions` 没了）⇒ `status: "rejected"`
   * ⇒ `group === "rejected"` 而 `text === ""`。上一轮的界面在这一支上会**同时**写着
   * 「（这一条没有正文可读）」**和**「当前标注：未标注 [readable][partly][unreadable]」——
   * 等于让人对着一个**不存在的对象**打分。
   *
   * 判据三块：① 正文区如实说"没有正文可读"；② **一个标注按钮都不给**；③ **口径没动** ——
   * 它仍然占着 `rejected` 那一组的分母（控制器已裁决的边界）。
   */
  it("**没有正文的条目不给标注按钮**：不许一边说没有正文、一边摆三个按钮", async () => {
    // 「缺 actions」的信封：不是合法计划，但对这一层来说仍是一条**被编译器拒了**的记录。
    const malformed = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "缺 actions", factIds: [] }
    render(<ProviderEval dependencies={{
      resolveProvider: async () => resolved,
      createPlanner: () => ({ plan: async () => ({ plan: malformed as unknown as PlanEnvelope, requestId: "req-1", attemptId: "att-1" }) })
    }} />)

    fireEvent.click(screen.getByRole("button", { name: /题集 planning/ }))
    await screen.findByRole("button", { name: "确认开始（题集 planning）" })
    fireEvent.click(screen.getByRole("button", { name: "确认开始（题集 planning）" }))

    const planning = screen.getByRole("region", { name: "真实 provider 评测：题集 planning" })
    await waitFor(() => expect(planning.textContent).toContain("rejected          3/3"))
    const area = screen.getByRole("region", { name: "人读区（只读）" })
    const blocks = within(area).getAllByRole("article")
    expect(blocks).toHaveLength(planningEvalCases().length)

    // ① 正文区如实说"没有正文可读"（这一批三条都是）。
    for (const block of blocks) expect(block.textContent).toContain("（这一条没有正文可读）")
    /**
     * ①-b **那一句说明本身也要被钉住**（复核 o2）：上面那条 `toContain("（这一条没有正文可读）")` 会被 `<pre>` 满足，
     * 所以把这一支新写的那段 `<p>` 整段删掉，它**照样绿** —— 那就等于这句话没有被判据守着。
     * 这里钉的是它的**两个要点**：为什么没有按钮、以及"仍然算在分母里"这个容易被读反的口径。
     */
    for (const block of blocks) {
      expect(block.textContent).toContain("没有可判的对象")
      expect(block.textContent).toContain("仍然算在这一组的分母里")
    }
    // ② ……那就**一个标注按钮都不许有**（这正是 N5 说的那种自相矛盾）。
    expect(within(area).queryAllByRole("button")).toHaveLength(0)
    // ③ 口径没动：它们仍然算在 `rejected` 那一组的分母里，于是显示"未标 3"（**不是**被排除）。
    expect(planning.textContent).toContain("已标 0 / 未标 3")
    expect(planning.textContent).toMatch(/rejected\s+已标 0 \/ 未标 3/)
  })
})

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { createLocalPlanner } from "../../agent/localPlanner"
import type { ProviderResolution } from "../../agent/modelPlanner"
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
 */
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
})

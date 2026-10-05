import { useState } from "react"

import { AGENT_TASK_FIXTURES } from "../../agent/fixtures/agentTaskFixtures"
import { formatScorecard } from "../../agent/fixtures/agentEvalReport"
import { runProviderAgentEval, type ProviderEvalDependencies } from "../../agent/fixtures/providerAgentEval"
import { resolveActiveProvider } from "../../agent/modelPlanner"

/**
 * **设置 → 真实 provider 评测**（发布门禁第 2 条；用户 2026-10-05 选的方案 C）。
 *
 * ## 这是这个应用里**唯一会花钱**的按钮
 *
 * 所以它的形状是被这条性质决定的，不是审美：
 *
 * 1. **两段式**：先"问"（解析「使用中」的那份配置 —— 这一步**不发**请求），
 *    再**显式确认**才真的跑。确认文案里必须写清**将发出多少次请求**与**发给谁**；
 * 2. **一次都不许提前发**：解析失败时连规划器都不造（`runProviderAgentEval` 的类型保证了这一点），
 *    界面如实显示原因码；
 * 3. **不挂在任何自动路径上**：没有 `useEffect`、没有定时器 —— 只有点击。
 *
 * ## 读数不许编
 *
 * 跑完显示的是 `formatScorecard` 的原文：延迟有数、**成本写 `not measured`**
 *（这条通道能给 `usage` 的 token 数，但仓里没有价目表 —— 见 `providerAgentEval.ts` 的说明）。
 */
const TRIALS = 3

type PanelState =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "confirming"; provider: { id: string; modelId: string } }
  | { kind: "running" }
  | { kind: "done"; report: string }
  | { kind: "unavailable"; code: string; detail: string }

export function ProviderEval({ dependencies }: { dependencies?: ProviderEvalDependencies } = {}) {
  const [state, setState] = useState<PanelState>({ kind: "idle" })
  const requests = AGENT_TASK_FIXTURES.length * TRIALS

  /** 第一段：只解析「使用中」的那份配置 —— **这一步不发请求**。 */
  const ask = async () => {
    setState({ kind: "asking" })
    const resolution = await (dependencies?.resolveProvider ?? resolveActiveProvider)()
    if (!resolution.ok) {
      setState({ kind: "unavailable", code: resolution.code, detail: resolution.detail })
      return
    }
    setState({ kind: "confirming", provider: { id: resolution.provider.id, modelId: resolution.provider.modelId } })
  }

  /** 第二段：用户确认之后才真的跑。 */
  const run = async () => {
    setState({ kind: "running" })
    const result = await runProviderAgentEval(TRIALS, dependencies)
    setState(
      result.scorecard === null
        ? { kind: "unavailable", code: result.unavailable?.code ?? "unknown", detail: result.unavailable?.detail ?? "" }
        : { kind: "done", report: formatScorecard({ mode: "real_provider", scorecard: result.scorecard, attempts: result.attempts, provider: result.provider }) }
    )
  }

  return (
    <section className="provider-eval" aria-label="真实 provider 评测">
      <h3>真实 provider 评测</h3>
      <p>
        用<strong>真实模型</strong>把同一套评测题跑一遍，得到发布门禁要的 pass@1 / pass@3 与延迟读数。
        它会真的发出请求并<strong>产生费用</strong> —— 所以要点两下才会开始。
      </p>

      {state.kind === "idle" && (
        <button type="button" onClick={() => void ask()}>
          跑真实评测（将发出 {requests} 次请求）
        </button>
      )}

      {state.kind === "asking" && <p role="status">正在读取「使用中」的模型服务…</p>}

      {state.kind === "confirming" && (
        <div role="alert">
          <p>
            将向 <strong>{state.provider.id} / {state.provider.modelId}</strong> 发出 <strong>{requests}</strong> 次请求
            （{AGENT_TASK_FIXTURES.length} 题 × {TRIALS} 轮），可能产生费用。
          </p>
          <button type="button" onClick={() => void run()}>确认开始</button>
          <button type="button" onClick={() => setState({ kind: "idle" })}>取消</button>
        </div>
      )}

      {state.kind === "running" && <p role="status">正在跑…（{requests} 次请求）</p>}

      {state.kind === "done" && (
        <div>
          <h4>读数</h4>
          <pre>{state.report}</pre>
        </div>
      )}

      {state.kind === "unavailable" && (
        <p role="alert">
          没有测：<code>{state.code}</code> —— {state.detail}
          <br />
          <strong>一次请求都没有发出。</strong>
        </p>
      )}
    </section>
  )
}

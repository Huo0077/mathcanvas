import { useState } from "react"

import { AGENT_TASK_FIXTURES } from "../../agent/fixtures/agentTaskFixtures"
import { formatScorecard } from "../../agent/fixtures/agentEvalReport"
import {
  PLANNING_EVAL_CASE_COUNT,
  PLANNING_EVAL_REQUESTS,
  PLANNING_EVAL_TOTAL_CASES,
  PLANNING_EVAL_TRIALS,
  formatPlanningReport,
  runProviderPlanningEval,
  type PlanningEvalDependencies
} from "../../agent/fixtures/benchmarkPlanningEval"
import { runProviderAgentEval, type ProviderEvalDependencies } from "../../agent/fixtures/providerAgentEval"
import { MAX_TRANSPORT_ATTEMPTS, resolveActiveProvider } from "../../agent/modelPlanner"

/**
 * **设置 → 真实 provider 评测**（发布门禁第 2 条；用户 2026-10-05 选的方案 C）。
 *
 * ## 这里是这个应用里**唯一会花钱**的地方
 *
 * 所以面板的形状是被这条性质决定的，不是审美：
 *
 * 1. **两段式**：先"问"（解析「使用中」的那份配置 —— 这一步**不发**请求），
 *    再**显式确认**才真的跑。确认文案里必须写清**至少**会发出多少次请求与**发给谁**
 *    （"至少"不是含糊：每条题在传输类失败时会重试，单条最多 ×`MAX_TRANSPORT_ATTEMPTS`
 *    ⇒ 写着"将发出 N 次"是**假的精确**）；
 * 2. **一次都不许提前发**：解析失败时**提前 return、连规划器都不造** ——
 *    保证它的是**控制流**（两条 `run*` 里的 `if (!resolution.ok) return`）**加上钉着
 *    `planned === 0` 的用例**，**不是类型**（2026-10-05 复核 M-6 更正了这句原来的归因：
 *    类型只保证"返回里 provider 与 unavailable 互斥"，它管不到"有没有发请求"）。界面如实显示原因码；
 * 3. **不挂在任何自动路径上**：没有 `useEffect`、没有定时器 —— 只有点击。
 *
 * ## 面板里有**两套**评测，两个按钮，各自两段式、各自报自己的请求数
 *
 * 这是 2026-10-05 的裁决（N4b）：合并成一个按钮会让"我点了什么、会花多少钱"说不清。
 *
 * - **上面那套：agent 工具环**（旧 8 题夹具 × `TRIALS` 轮 = 24 次请求）。它测的是
 *   "agent 能不能按要求把图形建出来"（pass@1 / pass@3 / 工具选择），**行为一个字没改**；
 * - **下面那套：题集 planning**（题集里前 `PLANNING_EVAL_CASE_COUNT` 条 × `PLANNING_EVAL_TRIALS` 轮
 *   = 至少 `PLANNING_EVAL_REQUESTS` 次请求；题集总数读 `PLANNING_EVAL_TOTAL_CASES`）。
 *   它测的是"模型产出的计划有没有被 `compilePlan` 接受"，数据来自 `@draw/agent-core`
 *   的同一份题集 —— **与上面那套不是同一个坐标系**，两边的读数不能混着读。
 *
 * 两个数字（24 与 3）都是**算出来的**，规模只在各自的模块里定义一处。
 *
 * ## 读数不许编
 *
 * 跑完显示的是 `formatScorecard` / `formatPlanningReport` 的原文：延迟有数、
 * **成本写 `not measured`**（两条通道都能给 token 数，但仓里没有价目表）。
 */
const TRIALS = 3

type PanelState =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "confirming"; provider: { id: string; modelId: string } }
  | { kind: "running" }
  | { kind: "done"; report: string }
  | { kind: "unavailable"; code: string; detail: string }
  /**
   * **抛出**，与"没配好"是两件事：后者有原因码，前者只有一句话。
   *
   * 接住它是必须的，不是为了好看 —— 不接住的话 `setState({kind:"running"})` 之后 promise 被拒、
   * 没人再更新状态，面板会**永远停在"正在跑…"**：那是"看起来在跑、实际什么都没发生"，
   * 比如实报错坏得多。
   *
   * **2026-10-05 复核修正（两套通道同形）**：`failed` 原来**只有题集那套有**，
   * 而旧的 agent 工具环那套（`ask` / `run`）没有 —— 于是它遇到同类异常时正是上面那种"永远停在正在跑"。
   * 现在两套共用同一支状态。**这一支只让失败如实报出来**，
   * 它**没有**修旧通道真正的缺陷（请求形状对真实规划器不成立 ⇒ 今天必然抛，
   * 见 `apps/web/src/agent/fixtures/providerAgentEval.ts` 的说明）：那会改变旧评测的输入语义，需要单独裁决。
   */
  | { kind: "failed"; detail: string }

/** 题集那套与工具环那套**共用同一支状态**（`failed` 两边都必须有，理由见上）。 */
type PlanningState = PanelState

export function ProviderEval({ dependencies }: { dependencies?: ProviderEvalDependencies & PlanningEvalDependencies } = {}) {
  const [state, setState] = useState<PanelState>({ kind: "idle" })
  const [planning, setPlanning] = useState<PlanningState>({ kind: "idle" })
  const requests = AGENT_TASK_FIXTURES.length * TRIALS

  /** 第一段：只解析「使用中」的那份配置 —— **这一步不发请求**。 */
  const ask = async () => {
    setState({ kind: "asking" })
    try {
      const resolution = await (dependencies?.resolveProvider ?? resolveActiveProvider)()
      if (!resolution.ok) {
        setState({ kind: "unavailable", code: resolution.code, detail: resolution.detail })
        return
      }
      setState({ kind: "confirming", provider: { id: resolution.provider.id, modelId: resolution.provider.modelId } })
    } catch (error) {
      setState({ kind: "failed", detail: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 第二段：用户确认之后才真的跑。 */
  const run = async () => {
    setState({ kind: "running" })
    try {
      const result = await runProviderAgentEval(TRIALS, dependencies)
      setState(
        result.scorecard === null
          ? { kind: "unavailable", code: result.unavailable?.code ?? "unknown", detail: result.unavailable?.detail ?? "" }
          : { kind: "done", report: formatScorecard({ mode: "real_provider", scorecard: result.scorecard, attempts: result.attempts, provider: result.provider }) }
      )
    } catch (error) {
      /**
       * **今天这条分支是必然走到的**（不是理论上的兜底）：旧通道把请求写成 `{ userMessage }`，
       * 真实规划器在发请求之前就会抛。所以这条不是"防御性代码"，它是**当前的真实行为**，
       * 而且必须让它显示出来 —— 以前这里什么都不接，面板会永远停在"正在跑…"。
       */
      setState({ kind: "failed", detail: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 题集那套的第一段：同样**不发请求**，只是解析配置。 */
  const askPlanning = async () => {
    setPlanning({ kind: "asking" })
    try {
      const resolution = await (dependencies?.resolveProvider ?? resolveActiveProvider)()
      if (!resolution.ok) {
        setPlanning({ kind: "unavailable", code: resolution.code, detail: resolution.detail })
        return
      }
      setPlanning({ kind: "confirming", provider: { id: resolution.provider.id, modelId: resolution.provider.modelId } })
    } catch (error) {
      setPlanning({ kind: "failed", detail: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 题集那套的第二段：确认之后才真的跑那 3 条题。 */
  const runPlanning = async () => {
    setPlanning({ kind: "running" })
    try {
      const result = await runProviderPlanningEval(dependencies)
      setPlanning(
        result.provider === null
          ? { kind: "unavailable", code: result.unavailable?.code ?? "unknown", detail: result.unavailable?.detail ?? "" }
          : { kind: "done", report: formatPlanningReport(result) }
      )
    } catch (error) {
      setPlanning({ kind: "failed", detail: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <>
      <section className="provider-eval" aria-label="真实 provider 评测">
        <h3>真实 provider 评测：agent 工具环</h3>
        <p>
          用<strong>真实模型</strong>把 <strong>agent 工具环</strong>那套评测题跑一遍，得到发布门禁要的
          pass@1 / pass@3 与延迟读数。它测的是"<strong>agent 能不能按要求把图形建出来</strong>"
          （{AGENT_TASK_FIXTURES.length} 题 × {TRIALS} 轮 = 至少 {requests} 次请求）——
          与下面那套<strong>题集 benchmark 不是同一个坐标系</strong>，两边的数字不能混着读。
          它会真的发出请求并<strong>产生费用</strong> —— 所以要点两下才会开始。
        </p>

        {state.kind === "idle" && (
          <button type="button" onClick={() => void ask()}>
            跑真实评测（至少 {requests} 次请求）
          </button>
        )}

        {state.kind === "asking" && <p role="status">正在读取「使用中」的模型服务…</p>}

        {state.kind === "confirming" && (
          <div role="alert">
            <p>
              将向 <strong>{state.provider.id} / {state.provider.modelId}</strong> 发出{" "}
              <strong>至少 {requests}</strong> 次请求
              （{AGENT_TASK_FIXTURES.length} 题 × {TRIALS} 轮；传输类失败会重试，单条最多 ×{MAX_TRANSPORT_ATTEMPTS}
              ⇒ 实际次数可能更多），可能产生费用。
            </p>
            <button type="button" onClick={() => void run()}>确认开始</button>
            <button type="button" onClick={() => setState({ kind: "idle" })}>取消</button>
          </div>
        )}

        {state.kind === "running" && <p role="status">正在跑…（至少 {requests} 次请求）</p>}

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

        {state.kind === "failed" && (
          <p role="alert">
            这一轮没跑完：{state.detail}
            <br />
            <strong>没有拿到任何读数</strong> —— 不要把它当成"跑了但结果不好"。
            {/* 与"没配好"那支的区别要说清：那支能保证"一次请求都没发"，这一支**不能** ——
                异常可能发生在跑到一半时（前面几条可能已经发过请求了）。 */}
            （与上面"没有测"不同：这一支**不能**保证"一次请求都没发"—— 异常可能出现在跑到一半的时候。）
          </p>
        )}
      </section>

      {/**
       * **题集 planning 那套**（N4b）：独立按钮、独立两段式、独立请求数。
       * 请求数与题数都从 `benchmarkPlanningEval.ts` 的常量来（只有那一处定义）。
       */}
      <section className="provider-eval" aria-label="真实 provider 评测：题集 planning">
        <h3>真实 provider 评测：题集 planning</h3>
        <p>
          用<strong>真实模型</strong>跑 <strong>{PLANNING_EVAL_TOTAL_CASES} 条 benchmark 题集里的前 {PLANNING_EVAL_CASE_COUNT} 条</strong>
          （{PLANNING_EVAL_CASE_COUNT} 题 × {PLANNING_EVAL_TRIALS} 轮 = 至少 {PLANNING_EVAL_REQUESTS} 次请求），
          记录每条题的<strong>计划有没有被编译器接受</strong>（planned / rejected / error）。
          它测的是"计划是否被编译接受"，**不需要金标准**，也<strong>不是</strong>上面那套 agent 工具环的
          pass@1 —— 两套题集不同、坐标系不同，读的时候别混。
        </p>

        {planning.kind === "idle" && (
          <button type="button" onClick={() => void askPlanning()}>
            跑题集 planning 评测（至少 {PLANNING_EVAL_REQUESTS} 次请求）
          </button>
        )}

        {planning.kind === "asking" && <p role="status">正在读取「使用中」的模型服务…</p>}

        {planning.kind === "confirming" && (
          <div role="alert">
            <p>
              将向 <strong>{planning.provider.id} / {planning.provider.modelId}</strong> 发出{" "}
              <strong>至少 {PLANNING_EVAL_REQUESTS}</strong> 次请求
              （{PLANNING_EVAL_CASE_COUNT} 题 × {PLANNING_EVAL_TRIALS} 轮，题集共 {PLANNING_EVAL_TOTAL_CASES} 条；
              传输类失败会重试，单条最多 ×{MAX_TRANSPORT_ATTEMPTS} ⇒ 实际次数可能更多）。
              这与上面 agent 工具环那 {requests} 次是<strong>两笔不同的开销</strong>，可能产生费用。
            </p>
            <button type="button" onClick={() => void runPlanning()}>确认开始（题集 planning）</button>
            <button type="button" onClick={() => setPlanning({ kind: "idle" })}>取消</button>
          </div>
        )}

        {planning.kind === "running" && <p role="status">正在跑…（至少 {PLANNING_EVAL_REQUESTS} 次请求）</p>}

        {planning.kind === "done" && (
          <div>
            <h4>读数</h4>
            <pre>{planning.report}</pre>
          </div>
        )}

        {planning.kind === "unavailable" && (
          <p role="alert">
            没有测：<code>{planning.code}</code> —— {planning.detail}
            <br />
            <strong>一次请求都没有发出。</strong>
          </p>
        )}

        {planning.kind === "failed" && (
          <p role="alert">
            这一轮没跑完：{planning.detail}
            <br />
            <strong>没有拿到任何读数</strong> —— 不要把它当成"跑了但结果不好"。
          </p>
        )}
      </section>
    </>
  )
}

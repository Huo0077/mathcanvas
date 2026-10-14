import { examRequestPlan, FROZEN_THRESHOLDS, runExamEvaluation } from "@draw/agent-core"

import { invokeDesktop } from "../../services/desktopRuntime"
import { createModelPlanner, resolveActiveProvider } from "../modelPlanner"
import { createExamRunCase } from "./examRunAdapter"

/**
 * **受闸的四族真题评测跑**（Task 20；2026-10-16，用户选 B：由命令行启动、由系统按下开关）。
 *
 * ## 怎么被触发
 *
 * 桌面壳带 `--exam-run <报告路径>` 启动 ⇒ Rust 把那个路径挂在托管状态上（**只读**）⇒
 * 前端启动时问一次 `exam_run_target`：给了就说明这是一次评测跑。**浏览器里问不到**
 *（IPC 失败）⇒ 直接返回，普通开发与测试完全不受影响。
 *
 * ## 顺序是刻意的
 *
 * 1. **先过授权闸**：真正跑的是 core 的 `runExamEvaluation`，它第一件事就是
 *    `assertPaidRunAllowed`（先冻结、先授权、额度写清、这次请求不许超）。所以
 *    "授权还没写进冻结表"的时候，这里**一次 `runCase` 都不会被调用**、一个 token 都不花 ——
 *    这正是本轮要拿到的**零成本干跑**读数：报告文件里会写着"被拒"和原因；
 * 2. **再碰 provider**：provider 在 `request` 里只是**记账用**的名字，真解析发生在
 *    `createModelPlanner().plan()` 里面（走桌面壳借密钥）。解析不出来时报告里
 *    那 36 条会各自记成 `error` 并带上原文 —— 如实，不假装跑过；
 * 3. **跑完把报告交回去**：由 Rust 写到**启动参数给的那个路径**（前端决定不了路径）。
 *
 * ## 费用为什么不填
 *
 * 仓里**没有价目表**：能拿到的是用量（token 数），拿不到钱。所以 `costOf` 一律返回 `null`，
 * 报告里费用那一栏如实是 `null`、费用阈值**不通过**。填 0 会让它凭空通过 ——
 * 那比不跑更糟（这是本轮先修掉的那条）。
 */
export async function maybeRunExamFromShell(): Promise<boolean> {
  const target = await examRunTarget()
  if (target === null || target.trim() === "") return false

  const envelope = await runFrozenExam(target)
  try {
    await invokeDesktop<string>("exam_run_finish", { report: JSON.stringify(envelope, null, 2) })
  } catch (error) {
    // 交不回去就**别吞**：控制台留一条，免得"跑完了但报告没了"。
    console.error("[exam-run] 报告没能交给桌面壳：", error)
  }
  return true
}

/**
 * 问桌面壳"这次启动是不是评测跑、报告该写到哪"。
 *
 * **拿不到就是 `null`**：浏览器与单测里这条 IPC 根本不存在（`invokeDesktop` 直接抛），
 * 那与"桌面壳说没有目标"是同一件事 —— 都不是评测跑。分开写两个返回值只会让调用方
 * 多一条永远走不到的岔路。
 */
async function examRunTarget(): Promise<string | null> {
  try {
    return await invokeDesktop<string | null>("exam_run_target")
  } catch {
    return null
  }
}

/**
 * 跑一次**冻结口径**的评测，返回一份**封套**（不是报告本身）。
 *
 * 封套里除了 `evaluation`（core 的返回值：要么 `{ ok: true, report }`、要么
 * `{ ok: false, reason }`），还写上这次启动的**外部事实**：报告写哪儿、
 * 冻结表里的授权是什么、provider 解析成了什么。分开写是因为三者回答的是不同的问题 ——
 * "跑成没跑成"、"按什么口径跑的"、"跑在谁身上"，混在一起读不出事故原因。
 */
async function runFrozenExam(target: string): Promise<Record<string, unknown>> {
  const authorization = FROZEN_THRESHOLDS.authorization
  const plan = examRequestPlan(FROZEN_THRESHOLDS)
  const resolution = await resolveActiveProvider()
  const runCase = createExamRunCase({
    planner: createModelPlanner(),
    costOf: () => null
  })
  const evaluation = await runExamEvaluation({
    plan: FROZEN_THRESHOLDS,
    request: {
      provider: resolution.ok ? resolution.provider.id : "（没解析出 provider）",
      model: resolution.ok ? resolution.provider.modelId : "（没解析出 provider）",
      requests: plan.requests,
      estimatedCostUsd: plan.worstCaseCostUsd,
      grantedBy: authorization.grantedBy ?? "",
      grantedOn: authorization.grantedOn ?? "",
      /**
       * 这一层驱动不了修复回路（修复在协调器的编译回路里）⇒ 如实 `not-driven`，
       * 于是报告里的 `repairedCount === 0` 只有一个含义：**这一轮没走协调器**。
       */
      repairPath: "not-driven"
    },
    runCase
  })
  return {
    startedAt: new Date().toISOString(),
    reportTarget: target,
    frozen: {
      frozenOn: FROZEN_THRESHOLDS.frozenOn,
      paidRuns: FROZEN_THRESHOLDS.paidRuns,
      authorization: { ...authorization }
    },
    planned: { requests: plan.requests, worstCaseCostUsd: plan.worstCaseCostUsd },
    providerResolution: resolution.ok
      ? { ok: true, id: resolution.provider.id, modelId: resolution.provider.modelId, dialect: resolution.provider.dialect }
      : { ok: false, code: resolution.code, detail: resolution.detail },
    evaluation
  }
}

import {
  createBudget,
  examRequestPlan,
  FROZEN_THRESHOLDS,
  runExamEvaluation,
  type WorkspaceId
} from "@draw/agent-core"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { invokeDesktop } from "../../services/desktopRuntime"
import { MODEL_PLANNER_SKILL_IDS, planWorkspaceFor } from "../agentRunner"
import { createAgentRuntime } from "../agentRuntime"
import { createModelPlanner, resolveActiveProvider, type ModelPlannerStructuredEvent } from "../modelPlanner"
import { SYSTEM_PROMPT_VERSION } from "../systemPrompt"
import { planRequestFor } from "./benchmarkPlanningEval"
import { createExamRunCase } from "./examRunAdapter"

/**
 * **受闸的四族真题评测跑**（Task 20；2026-10-16，用户选 B：由命令行启动、由系统按下开关）。
 *
 * 当报告路径文件名包含 `higher-math-ds-live` 时，走大学高等数学 10 题真实 DeepSeek `ds_action`
 * 端到端评测（同样经 Rust `provider_run` 安全借用密钥、隔离画布不污染用户会话）。
 */
export async function maybeRunExamFromShell(): Promise<boolean> {
  const target = await examRunTarget()
  if (target === null || target.trim() === "") return false

  const envelope = target.includes("higher-math-ds-live")
    ? await runHigherMathDsLiveEval(target)
    : await runFrozenExam(target)
  try {
    await invokeDesktop<string>("exam_run_finish", { report: JSON.stringify(envelope, null, 2) })
  } catch (error) {
    console.error("[exam-run] 报告没能交给桌面壳：", error)
  }
  return true
}

async function examRunTarget(): Promise<string | null> {
  try {
    return await invokeDesktop<string | null>("exam_run_target")
  } catch {
    return null
  }
}

interface HigherMathLiveCaseSpec {
  id: string
  category: string
  workspace: WorkspaceId
  prompt: string
  expectedChecks: Array<{ label: string; pattern: RegExp }>
}

const HIGHER_MATH_DS_LIVE_CASES: readonly HigherMathLiveCaseSpec[] = [
  {
    id: "HM-01",
    category: "一元微积分：闭区间最值与定积分",
    workspace: "conics",
    prompt: "求函数 f(x) = x^3 - 3x 在闭区间 [-2, 3] 上的最大值、最小值及定积分 ∫_{-2}^{3} f(x) dx，并画出函数图像与极值点。",
    expectedChecks: [
      { label: "最大值 18", pattern: /18/ },
      { label: "最小值 -2", pattern: /[-−]2/ },
      { label: "定积分 8.75 或 35/4", pattern: /8\.75|35\s*\/\s*4/ }
    ]
  },
  {
    id: "HM-02",
    category: "多元条件极值：拉格朗日乘数法",
    workspace: "conics",
    prompt: "用拉格朗日乘数法求目标函数 f(x, y) = x + 2y 在圆约束 x^2 + y^2 = 5 下的最大值与最小值及对应驻点坐标，并画出约束圆与驻点。",
    expectedChecks: [
      { label: "最大值 5", pattern: /(?<!\d)5(?!\d)/ },
      { label: "最小值 -5", pattern: /[-−]\s*5/ },
      { label: "驻点 (1, 2)", pattern: /1\s*[,，]\s*2/ }
    ]
  },
  {
    id: "HM-03",
    category: "多元微分学：二元曲面驻点、鞍点与切平面",
    workspace: "geometry3d",
    prompt: "求二元函数曲面 z = x^3 - 3x + y^2 的全部驻点并判别极值点与鞍点，再求曲面在点 (2, 1) 处的切平面方程，并在三维空间标出驻点与切平面。",
    expectedChecks: [
      { label: "鞍点 (-1, 0, 2)", pattern: /鞍点/ },
      { label: "极小值 -2", pattern: /[-−]\s*2/ },
      { label: "切平面 9x + 2y - 17", pattern: /9\s*\*?\s*x[\s\S]{0,12}2\s*\*?\s*y[\s\S]{0,12}17/ }
    ]
  },
  {
    id: "HM-04",
    category: "常微分方程：一阶非线性初值问题 RK45",
    workspace: "conics",
    prompt: "求解一阶常微分方程初值问题 y' = y*(1 - y/4)，初值 y(0) = 1，求 y(2) 的精确数值解（保留 4 位小数），并在平面上标出初值点与解点。",
    expectedChecks: [
      { label: "y(2) ≈ 2.8449", pattern: /2\.8449|2\.845/ }
    ]
  },
  {
    id: "HM-05",
    category: "动力系统：二维自治相平面平衡点稳定性",
    workspace: "conics",
    prompt: "分析二维自治动力系统 x' = y, y' = -x - 0.6*y 的平衡点坐标、雅可比矩阵特征值及稳定性类型，并在平面标出平衡点。",
    expectedChecks: [
      { label: "平衡点 (0, 0)", pattern: /0\s*[,，]\s*0/ },
      { label: "特征值实部 -0.3", pattern: /[-−]\s*0\.3/ },
      { label: "稳定焦点/螺旋点", pattern: /稳定/ }
    ]
  },
  {
    id: "HM-06",
    category: "无穷级数：泰勒展开与近似误差估计",
    workspace: "conics",
    prompt: "将函数 f(x) = exp(x) 在 x0 = 0 处展开为 4 阶麦克劳林多项式 P_4(x)，计算 P_4(0.5) 与精确值 exp(0.5) 的绝对误差（保留至少 5 位小数），并同时画出原函数与泰勒多项式曲线。",
    expectedChecks: [
      { label: "P4(0.5) ≈ 1.64844", pattern: /1\.6484/ },
      { label: "exp(0.5) ≈ 1.64872", pattern: /1\.6487/ },
      { label: "绝对误差 ≈ 0.000284 或 2.84e-4", pattern: /0\.00028|2\.8[34]\d*\s*[×*xX]?\s*10\^?\{?-4\}?|2\.8[34]\d*e-4/i }
    ]
  },
  {
    id: "HM-07",
    category: "重积分：圆域极坐标二重积分",
    workspace: "conics",
    prompt: "计算圆域 D: x^2 + y^2 <= 4 上的二重积分 ∬_D (x^2 + y^2) dxdy（给出精确值与 4 位小数近似值），并画出积分区域圆边界。",
    expectedChecks: [
      { label: "积分数值 25.1327 或 8π", pattern: /25\.132[78]|8\s*(?:\\pi|π)/ }
    ]
  },
  {
    id: "HM-08",
    category: "场论初步：平面向量场散度与旋度",
    workspace: "conics",
    prompt: "求平面向量场 F(x, y) = (x^2*y, -x*y^2) 在点 P(1, 2) 处的散度 div F 与旋度 z 分量 curl_z F，并在平面标出点 P(1, 2)。",
    expectedChecks: [
      { label: "散度 0", pattern: /(?:div|散度)[\s\S]{0,30}(?<![0-9.-])0(?![0-9])/i },
      { label: "旋度 -5", pattern: /[-−]\s*5/ }
    ]
  },
  {
    id: "HM-09",
    category: "线性代数：二阶矩阵特征值与 SVD 奇异值",
    workspace: "conics",
    prompt: "求二阶矩阵 A = [[3, 1], [1, 3]] 的行列式、迹、特征值与奇异值 σ1, σ2，并在平面画出单位圆及特征向量方向直线。",
    expectedChecks: [
      { label: "行列式 8", pattern: /(?<!\d)8(?!\d)/ },
      { label: "迹 6", pattern: /(?<!\d)6(?!\d)/ },
      { label: "特征值/奇异值 4 与 2", pattern: /(?<!\d)4(?!\d)[\s\S]{0,60}(?<!\d)2(?!\d)/ }
    ]
  },
  {
    id: "HM-10",
    category: "概率论与数理统计：二项分布区间概率",
    workspace: "conics",
    prompt: "设随机变量 X 服从二项分布 B(10, 0.5)，求期望 E[X]、方差 Var(X) 以及区间概率 P(4 <= X <= 6) 的精确小数，并在平面标出对应概率点。",
    expectedChecks: [
      { label: "期望 5", pattern: /(?<!\d)5(?!\d)/ },
      { label: "方差 2.5", pattern: /2\.5|5\s*\/\s*2/ },
      { label: "区间概率 0.65625", pattern: /0\.65625|0\.6563|105\s*\/\s*160|21\s*\/\s*32/ }
    ]
  }
]

async function runHigherMathDsLiveEval(target: string): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString()
  const resolution = await resolveActiveProvider()
  if (!resolution.ok) {
    return {
      mode: "higher-math-ds-live",
      startedAt,
      reportTarget: target,
      providerResolution: { ok: false, code: resolution.code, detail: resolution.detail },
      cases: []
    }
  }

  let totalRequests = 0
  const caseResults: Array<Record<string, unknown>> = []

  for (const spec of HIGHER_MATH_DS_LIVE_CASES) {
    const caseStart = Date.now()
    const runId = `hm-live-${spec.id}-${Date.now().toString(36)}`
    let workspace: WorkspaceId = spec.workspace
    const documents = new Map<WorkspaceId, GeometryDocument>()
    const currentDoc = () => {
      let doc = documents.get(workspace)
      if (!doc) {
        doc = createEmptyDocument(workspace)
        documents.set(workspace, doc)
      }
      return doc
    }

    const structuredEvents: ModelPlannerStructuredEvent[] = []
    const diagnostics: string[] = []
    const planner = createModelPlanner({
      intentMode: "ds_action",
      resolveProvider: async () => resolution,
      onDiagnostic: (line) => diagnostics.push(line),
      onStructuredDiagnostic: (ev) => structuredEvents.push(ev)
    })

    const initial = planRequestFor(spec.prompt, workspace, runId, currentDoc())
    const runtime = createAgentRuntime({
      readDocument: currentDoc,
      writeDocument: () => {
        throw new Error("live eval runtime never commits user canvas")
      },
      readSceneDocuments: () => {
        const doc = currentDoc()
        return [
          {
            handle: {
              ...initial.run.target,
              documentId: doc.metadata.id,
              workspace,
              epoch: `epoch:${doc.metadata.id}`,
              generation: doc.revision,
              contentHash: contentFingerprint(doc)
            },
            document: doc
          }
        ]
      },
      planner,
      budget: createBudget({ generation: 48, network: 48, tool: 200, actions_per_run: 240 }),
      requestedSkillIds: MODEL_PLANNER_SKILL_IDS,
      exportPreflight: { preflight: () => ({ error: "export is not measured in live higher-math eval" }) },
      projectId: "hm-live-eval",
      runId,
      conversationId: runId,
      prepare(plan) {
        const nextWs = planWorkspaceFor(plan) ?? workspace
        const switched = nextWs !== workspace
        workspace = nextWs
        currentDoc()
        return { ok: true, switched }
      }
    })

    let runError: string | null = null
    try {
      for await (const _event of runtime.coordinator.start({
        run: initial.run,
        userMessage: spec.prompt,
        promptVersion: SYSTEM_PROMPT_VERSION
      })) {
        // Consume coordinator stream until terminal phase
      }
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err)
    }

    const phase = runtime.coordinator.phase()
    const draftId = runtime.draftId()
    const preview = draftId ? runtime.host.preview(draftId) : null
    const candidateDoc = preview && preview.ok ? preview.artifact.candidate : null
    const answerText = runtime.answer() ?? ""

    const requestsUsed = structuredEvents.filter((e) => e.kind === "request").length
    totalRequests += requestsUsed
    const actionEvents = structuredEvents.filter(
      (e): e is Extract<ModelPlannerStructuredEvent, { kind: "action" }> => e.kind === "action"
    )
    const toolCalls = actionEvents.map((a) => `${a.toolName}:${a.resultStatus}`)
    const higherMathSolverCalled = actionEvents.some(
      (a) => a.toolName === "query_measurement" && a.resultStatus === "accepted"
    )

    const matchedFacts: string[] = []
    const missingFacts: string[] = []
    for (const check of spec.expectedChecks) {
      if (check.pattern.test(answerText)) matchedFacts.push(check.label)
      else missingFacts.push(check.label)
    }

    const deliveryOk = (phase === "awaiting_confirmation" || phase === "completed") && runError === null
    const accuracyOk = missingFacts.length === 0 && answerText.trim().length > 0

    caseResults.push({
      id: spec.id,
      category: spec.category,
      workspace,
      phase,
      deliveryOk,
      accuracyOk,
      passedAll: deliveryOk && accuracyOk,
      higherMathSolverCalled,
      requestsUsed,
      toolCalls,
      primitiveCount: candidateDoc ? candidateDoc.primitives.length : 0,
      primitiveTypes: candidateDoc ? [...new Set(candidateDoc.primitives.map((p) => p.type))] : [],
      matchedFacts,
      missingFacts,
      answer: answerText,
      ...(runError ? { runError } : {}),
      ...(deliveryOk && accuracyOk ? {} : { recentDiagnostics: diagnostics.slice(-8) }),
      latencyMs: Date.now() - caseStart
    })
  }

  const passedCount = caseResults.filter((c) => c.passedAll === true).length
  const solverUsedCount = caseResults.filter((c) => c.higherMathSolverCalled === true).length

  return {
    mode: "higher-math-ds-live",
    startedAt,
    completedAt: new Date().toISOString(),
    reportTarget: target,
    providerResolution: {
      ok: true,
      id: resolution.provider.id,
      modelId: resolution.provider.modelId,
      dialect: resolution.provider.dialect,
      capabilities: resolution.provider.capabilities
    },
    summary: {
      totalCases: HIGHER_MATH_DS_LIVE_CASES.length,
      passedCases: passedCount,
      passRate: `${passedCount}/${HIGHER_MATH_DS_LIVE_CASES.length}`,
      higherMathSolverUsedCases: solverUsedCount,
      totalProviderRequests: totalRequests
    },
    cases: caseResults
  }
}

async function runFrozenExam(target: string): Promise<Record<string, unknown>> {
  const authorization = FROZEN_THRESHOLDS.authorization
  const plan = examRequestPlan(FROZEN_THRESHOLDS)
  const resolution = await resolveActiveProvider()
  const repairPath = "coordinator-driven" as const
  const runCase = createExamRunCase({
    planner: createModelPlanner(),
    costOf: () => null,
    repairPath
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
      repairPath
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

import type { ExamCase, ExamFamily, PlanOutcome, PlannerPort, WorkspaceId } from "@draw/agent-core"
import type { WorkerLike } from "../geometryWorkerClient"

export interface ExamRunAdapterDeps {
  planner: PlannerPort
  /** Opt-in: preserve the historical plan/compile-only benchmark contract by default. */
  repairPath?: "not-driven" | "coordinator-driven"
  geometryWorkerFactory?: () => WorkerLike
  /**
   * 这一次请求花了多少钱（由 provider 侧按真实用量给）。
   *
   * **可以返回 `null`**（2026-10-16）：仓里没有价目表时，能拿到的只有用量、拿不到钱 ——
   * 那时如实返回 `null`。返回 0 会让费用那条阈值凭空通过（见 core 的 `examEvaluation`）。
   */
  costOf: (request: { examCase: ExamCase; trial: number; outcome: PlanOutcome | null; error: unknown; attempts?: readonly PlanOutcome[] }) => number | null
  /** 墙钟（测试里注入固定值）。 */
  now?: () => number
  /** **这道题从哪个工作区开始**（缺省按族取，见 `workspaceForFamily`）。 */
  workspaceOf?: (examCase: ExamCase) => WorkspaceId
  /**
   * 编译开关。缺省 = 两个都不开，与**生产缺省**一致
   * （`apps/web/src/agent/featureFlags.ts`：两个实验开关默认关）。
   */
  compileFlags?: { diagramObligationIR?: boolean; diagramWitnessSearch?: boolean }
}

/**
 * **这一族题目从哪个工作区开始**。
 *
 * 判据与产品那一侧同源（`agentRunner.planWorkspaces`）：`planar.*` / `function.*` 归
 * `conics`（平面几何是这两族共同的家），`solid.*` / `section.*` 归 `geometry3d`。
 * 这里按**族**取初始值，是因为"模型看到哪个工作区"必须在请求发出**之前**定下来；
 * 计划真的要求另一个工作区时，编译前会按 `planWorkspaceFor` 换过去（见下）。
 */
export function workspaceForFamily(family: ExamFamily): WorkspaceId {
  return family === "solid" ? "geometry3d" : "conics"
}

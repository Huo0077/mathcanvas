import type { GeometryDocument } from "@draw/dsl"

import type { StagedCompileResult, StagedPlanEnvelope } from "./draftStore"
import type { GeometryWorkerClient } from "./geometryWorkerClient"

/**
 * **编译策略**：同一份计划、同一份文档，可以走**两条路**算出同样的结果。
 *
 * - `compileInProcess`：**同步**，直接在调用方的线程上跑 `compilePlan`。这是当前生产路径。
 * - `compileInWorker`：**异步**，把它交给 `GeometryWorkerClient`，于是在**另一个线程**上跑。
 *
 * ## 为什么要把它抽成一张显式的策略，而不是"顺手加个 if"
 *
 * 方案 3 的实测读数（`compilePlan.bench.test.ts`）说得很清楚：典型文档上编译只要个位数毫秒，
 * 但评审点名的目标场景（约 100 个三维实体 ≈ 2800 图元）上要 **73 ms**，
 * 而过线程边界的复制只要 **1.0 ms**（**76 倍**的差）。所以"搬进 Worker"值得做。
 *
 * 但两条路**必须可证明地等价** —— 否则"有时候 Worker、有时候不 Worker"会让
 * "某个形状只能在这一条路上编出来"这种缺陷永远查不出来（这个项目已经因为
 * "同一个判断写了两遍"吃过几次亏：来源解析、导出取文档、度量名副本）。
 * 所以这里把两条路并排放在一个文件里、由同一组夹具一起测，而不是散在两处各写一遍。
 *
 * ## 与 `DraftStore` 的关系
 *
 * `DraftStore.stage` 现在**同步**调用 `compilePlan`。要真正用上 Worker，`stage` 必须返回
 * `Promise`（它的两处生产调用点都在 `agentRuntime.ts`）。在那一层改完之前，
 * 这个文件只提供**可测的策略**与等价性证据 —— 不改任何现有行为。
 */

/**
 * 编译只吃 `kind: "plan"` 的那一支（`PlanEnvelope` 还含澄清等变体）。
 *
 * 定义放在 `draftStore.ts` —— `CompileStrategy` 的入参就是它，两处必须是**同一个**名字，
 * 否则"两条路的入参形状"又会各写一遍。这里只是转出去，方便本文件与用例按同一处引用。
 */
export type { StagedPlanEnvelope }

/**
 * **同步那条路**就是 `DraftStore` 默认策略用的那一个函数 —— 这里只是转出去。
 *
 * 为什么不让本文件自己再写一遍：这里曾经有过一份"就地编译"的私有实现，而它**漏传了
 * `prompt`（用户原话）**，于是"Worker 起不来时走就地兜底"与"默认路"对同一份计划给出
 * 不同结果（两条用例抓出来的：原话里带符号参数的计划在兜底路上变成了澄清提问）。
 * 两条路并存时，"同一个判断写两遍"就会长成这样 —— 所以现在只有一处实现。
 */
export { compileInProcess, type CompileInput } from "./draftStore"

/**
 * **Worker 那条路真正需要的输入**：只要计划与基准文档。
 *
 * 与 `CompileInput`（同步路径）的差别不是装饰，而是两条路**真的**要不同的东西：
 * - **不要 `allocator`**：Worker 的请求里没有这个字段，它按 `base.primitives` 现建一个
 *  （见 `workerContracts.ts` 的 `GeometryCompileRequest`）。这是两条路唯一的语义差别，
 *   也是等价性用例专门盯住的地方 —— 只要基准文档一致、初始占用集一致，发出的 id 就必须一致。
 * - **不要 `capabilityRevision`**：Worker 侧写死 `"worker"`。
 *
 * 用独立的类型而不是硬套 `CompileInput`，是为了让"这条路的输入到底是什么"在类型上就是诚实的
 *（宿主侧的适配因此必须是**显式**取两个字段，而不是碰巧结构兼容）。
 */
export interface WorkerCompileInput {
  plan: StagedPlanEnvelope
  document: GeometryDocument
}

export interface WorkerCompileEnvelope {
  runId: string
  draftId: string
  draftVersion: number
  prompt?: string
}

/**
 * 走 Worker 编一次，产出**与同步路径同形的、`stage` 真正需要的那 7 个字段**。
 *
 * 三件事要说清楚：
 *
 * 1. **不是整份 `PlanCompileResult`**。Worker 的响应不携带 `aliases` / `completions` /
 *    `verification` / `plan` / `actions`，而 `stage` 一个都不读（它只读这 7 个）。
 *    硬凑成完整结果就是编造字段 —— 所以这里返回 `StagedCompileResult`。
 * 2. **成功路径**直接映射：`draftDocument` 取 Worker 算出的结果文档，操作与假设照抄。
 *    成功时没有诊断、没有问题、没有修复请求 —— 那是**真的没有**，不是丢了。
 * 3. **失败路径**把已经过边界的产物原样带出（修复请求 / 逐层诊断 / 假设 / 澄清问题）。
 *    这四样正是协调器"发回模型再修一次"与"改问用户"的依据。
 */
export async function compileInWorker(
  client: GeometryWorkerClient,
  input: WorkerCompileInput,
  envelope: WorkerCompileEnvelope
): Promise<StagedCompileResult> {
  const outcome = await client.compile(input.plan.actions, input.document, {
    runId: envelope.runId,
    draftId: envelope.draftId,
    draftVersion: envelope.draftVersion,
    ...(envelope.prompt === undefined ? {} : { prompt: envelope.prompt })
  })
  if (!outcome.ok) {
    return {
      ok: false,
      draftDocument: null,
      operations: [],
      /**
       * **逐层诊断要映射过来**：`stage` 的失败分支靠 `diagnostics` 里**有没有 error**
       * 决定"报编译失败"还是"把澄清问题交给界面"。少了这一项，明明有诊断的失败会退化成
       * "the plan produced no compilable action" 这种说不清的话
       *（实测被用例抓出来：映射前 `worker.diagnostics` 是空的）。
       */
      diagnostics: [...(outcome.planDiagnostics ?? [])],
      questions: [...(outcome.questions ?? [])],
      assumptions: [...(outcome.assumptions ?? [])],
      ...(outcome.repair === undefined ? {} : { repair: outcome.repair })
    }
  }
  const result = outcome.result
  return {
    ok: true,
    draftDocument: result.document,
    operations: [...result.operations],
    diagnostics: [],
    questions: [],
    // 假设**必须照抄**：它是确认面板上的"系统替你定了什么"（这一项曾经在契约里缺失）。
    assumptions: [...(result.completionAssumptions ?? [])]
  }
}

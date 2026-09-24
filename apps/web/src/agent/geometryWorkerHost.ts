import { compileInProcess, compileInWorker } from "./geometryCompileStrategy"
import { createGeometryWorkerClient, spawnGeometryWorker, type GeometryWorkerClient, type WorkerLike } from "./geometryWorkerClient"
import type { CompileStrategy, StagedCompileResult } from "./draftStore"

/**
 * **几何 Worker 的宿主生命周期**（方案 3 的最后一块）。
 *
 * ## 为什么 Worker 不能建在 `createAgentRuntime` 里
 *
 * `createAgentRuntime` 是**每轮 Agent 运行**建一次的（`agentRunner.ts` 的 `run()` 里调它）。
 * 在那里 `new Worker(...)` 的后果是"**每轮运行泄漏一个 Worker**" —— 用户连续让 Agent 做几次事，
 * 就会攒下一串永不被 `terminate` 的线程。所以 Worker 的生命周期**必须比一次运行长**。
 *
 * ## 这里的策略：每个页面一份，懒建，随页面卸载而终止
 *
 * - **懒建**：第一次真正要编译时才建。没有 Worker 的测试环境（vitest/jsdom）不该因为
 *   "只是装配了一个运行时"就付出建线程的代价，更不该因此报错。
 * - **每个页面一份**：模块级单例。`geometryWorkerClient` 已经是"多请求并发 + 按 requestId 配对"的，
 *   天然支持被多轮运行共用。
 * - **随页面卸载终止**：挂 `pagehide`。这是**兜底而不是主要机制** —— 页面关掉时浏览器本来就会
 *   回收 Worker，但显式 `terminate` 能让"我们创建了什么"这件事在该关的时候关掉，
 *   而不是留给运行时的不确定行为。没有 `window` 时（node）静默跳过。
 *
 * ## 为什么把工厂做成可注入的
 *
 * `new URL(..., import.meta.url)` 是 bundler 语法，在 node/vitest 里没有意义。
 * 注入一个假 Worker（把消息交给 `handleGeometryRequest`）就能在测试里走**真链路**，
 * 只把"线程"换成函数调用 —— 与 `geometryWorkerClient.test.ts` 里那条等价性用例同一个手法。
 */

let client: GeometryWorkerClient | null = null
let unloadHooked = false
/** 降级提示只报一次（见 `createWorkerCompileStrategy`）。 */
let fallbackWarned = false

/** 取（必要时建立）本页面的几何 Worker 客户端。 */
export function geometryWorkerForPage(factory: () => WorkerLike = spawnGeometryWorker): GeometryWorkerClient {
  if (client) return client
  client = createGeometryWorkerClient(factory())
  /**
   * 页面卸载时终止。只在真的建过 Worker 之后才挂钩子，且只挂一次 ——
   * 重复挂会让同一个卸载事件上跑好几遍 `dispose`（它是幂等的，但没必要）。
   */
  if (!unloadHooked && typeof globalThis.addEventListener === "function") {
    unloadHooked = true
    globalThis.addEventListener("pagehide", () => { client?.dispose() })
  }
  return client
}

/** 仅测试用：丢掉单例，让下一条用例从干净状态开始（并终止已有的那个）。 */
export function resetGeometryWorkerForTests(): void {
  client?.dispose()
  client = null
  unloadHooked = false
  fallbackWarned = false
}

/**
 * 把 Worker 绑成 `DraftStore` 要的那条 `CompileStrategy`，**并在 Worker 起不来时如实降级**。
 *
 * 每次编译现取单例（而不是把客户端捕在闭包里）：单例可能被 `resetGeometryWorkerForTests`
 * 换掉，捕住旧的那一只会让测试之间互相污染。
 *
 * **信封按每次调用现取**：`draftId` / `draftVersion` 只有 `stage` 知道（它们随每次暂存变化），
 * 所以从策略的入参里取，而不是在工厂建策略时定死一个。`runId` 则是这一轮运行固定不变的。
 *
 * 适配是**显式取两个字段**的：`CompileStrategy` 给的输入里有 `allocator` 与
 * `capabilityRevision`，而 Worker 那条路不需要它们（Worker 按基准文档现建分配器、
 * 版本号写死 `"worker"`）。显式取，而不是指望结构恰好兼容 —— 那正是两个类型分开的理由。
 *
 * ## 为什么必须能降级，以及为什么降级**不是**"静默降级"
 *
 * `spawnGeometryWorker()` 用 `new Worker(new URL(...), { type: "module" })` —— 那条路径在
 * **没有 `Worker` 的环境里根本不存在**（node / vitest / 某些 WebView 设置），
 * 而且它**抛异常**（实测：整轮运行从 `awaiting_confirmation` 变成 `failed`）。
 * 让"环境没有 Worker"把一次作图变成失败，明显比"在这台机器上就地算"更糟。
 *
 * 所以降级是**如实**的：往开发者控制台留一条能读的原因，而不是装作什么都没发生。
 * 这与评审警告的"静默降级"不是一回事 —— 那说的是"明明能走 Worker 却悄悄不走"；
 * 这里是"这台环境压根没有 Worker"，而且它**说出来**了。
 *
 * ## 降级必须落在**同一个** `compileInProcess` 上
 *
 * 这里曾经自己抄了一份"就地编译"，而那份副本**漏传了 `prompt`（用户原话）** —— 于是
 * 同一份计划在"默认路"与"兜底路"上编出了不同结果（原话里带符号参数的计划在兜底路上
 * 变成了澄清提问，两条 `agentRuntime` / `compilerRepair` 用例当场抓到）。
 * 现在兜底直接调 `draftStore` 那一个 `compileInProcess`：**只有一处实现**，
 * 这种分叉不可能再长出来。
 */
export function createWorkerCompileStrategy(runId: string, factory?: () => WorkerLike): CompileStrategy {
  return async (input): Promise<StagedCompileResult> => {
    try {
      return await compileInWorker(
        geometryWorkerForPage(factory),
        { plan: input.plan, document: input.document },
        { runId, draftId: input.conversationId, draftVersion: input.draftVersion, ...(input.userMessage === undefined ? {} : { prompt: input.userMessage }) }
      )
    } catch (error) {
      /**
       * Worker 建不起来 / 通信炸了：就地算，并把原因**说出来**（不是静默）。
       *
       * 刻意不做成"这次也报失败" —— 编译本身能在当前线程上完成，没有理由让用户为此丢一次运行。
       *
       * 为什么走 `console.warn` 而不是塞进 `diagnostics`：那个字段的类型是 `PlanDiagnostic`，
       * 它只认编译管线自己的 `stage`（传输 / 字段审计 / 引用解析 / 参数补全 / 几何校验 / 动作编译）
       * 与 `error` 级严重度 —— 硬塞一条"环境没有 Worker"进去会把判别联合与下游的层名解析一起弄糊。
       * 这是一条**开发者可见**的降级记录，不是给用户看的编译诊断。
       *
       * **每个页面只报一次**：没有 `Worker` 的环境里这条必然失败到底（不是偶发），
       * 每次编译都打一遍会把控制台刷满、反而盖住别的 stderr 信号。第一次就是唯一可行动的那一次。
       */
      const reason = error instanceof Error ? error.message : String(error)
      if (!fallbackWarned) {
        fallbackWarned = true
        console.warn(`[geometry-worker] unavailable, compiled on the main thread instead: ${reason}`)
      }
      return compileInProcess(input)
    }
  }
}

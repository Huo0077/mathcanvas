import {
  attemptAutomaticProof,
  unavailableProofChannel,
  type AutomaticProofRequest,
  type AutomaticProofResult,
  type ProofChannel,
  type ProofChannelOutcome,
  type ProofChannelResult
} from "@draw/agent-core"

import { invokeDesktop, isDesktopShell, NoDesktopShellError } from "../services/desktopRuntime"

/**
 * **产品侧真正去调 Lean 的那一段**（V2 GREEN 缺口③的第二半：从库到桌面命令的接线）。
 *
 * 库里的编排（`@draw/agent-core` 的 `attemptAutomaticProof`）只认一个**端口** `ProofChannel`；
 * 这个模块提供桌面壳里的那一个实现，并在浏览器里如实报"这里跑不了"。
 *
 * ## 三条边界
 *
 * 1. **浏览器里不是错误，是一种状态**：形式证明后端要 Lean 工具链与 7.5 GB 的 mathlib，
 *    它们不在浏览器里。所以浏览器那条通道返回 `unavailable` + 一句人能读的理由 ——
 *    而不是抛、也不是假装跑过。
 * 2. **IPC 回来的东西是**不可信输入**：`check_lean_proof` 的返回值要**逐字段校验**
 *    （`outcome` 必须在四个词里、`exitCode` 必须是数字或 null、输出必须是字符串）。
 *    形状不对 ⇒ `failed` + 说清哪里不对。**绝不允许**一个畸形的回包变成"验证通过"。
 * 3. **命令名与参数逐字固定**：`check_lean_proof` + `{ source, timeoutMs }`。
 *    不接受可执行文件路径、不接受 shell 文本 —— 跑什么由桌面侧的**环境变量**决定。
 *
 * ## 它**仍然不是**产品路径
 *
 * 这个模块是"接线"，但**没有任何产品流程在跑完作图之后调用它** —— 那一步（在桌面壳里
 * 对可证明的 claim 调一次、把产物挂进报告）**没做**。所以 `proofLevelStatus.ts` 里
 * "默认路径不调用它"这句今天仍然成立。
 */

/** 通道回包的四个词（与 Rust 侧 `LeanOutcome`、与库里的 `ProofChannelOutcome` 逐字同形）。 */
const OUTCOMES: readonly ProofChannelOutcome[] = ["exited", "failed", "timeout", "unavailable"]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * **把 IPC 回包校验成 `ProofChannelResult`**（导出是为了能单独测它 —— 这是本模块最要紧的判据）。
 *
 * fail-closed：任何一处对不上 ⇒ `failed` + 指明字段，**不猜、不放行**。
 */
export function normalizeProofChannelResult(raw: unknown): ProofChannelResult {
  const rejected = (why: string): ProofChannelResult => ({
    outcome: "failed",
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    // 这句话会原样进失败说明，所以要点名**是哪一栏**不对。
    detail: `桌面命令 check_lean_proof 的回包形状不对（${why}）—— 不认的回包一律按失败处理，绝不当成"验证通过"。`
  })

  if (!isPlainObject(raw)) return rejected("不是一个对象")
  const outcome = raw.outcome
  if (typeof outcome !== "string" || !OUTCOMES.includes(outcome as ProofChannelOutcome)) {
    return rejected(`outcome=${JSON.stringify(outcome)} 不在 ${OUTCOMES.join(" / ")} 里`)
  }
  const exitCode = raw.exitCode
  if (exitCode !== null && typeof exitCode !== "number") return rejected(`exitCode=${JSON.stringify(exitCode)} 既不是数字也不是 null`)
  const stdout = raw.stdout
  const stderr = raw.stderr
  if (typeof stdout !== "string") return rejected("stdout 不是字符串")
  if (typeof stderr !== "string") return rejected("stderr 不是字符串")
  const durationMs = raw.durationMs
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return rejected(`durationMs=${JSON.stringify(durationMs)} 不是有限数字`)
  /**
   * **版本串**（2026-10-10 加）：桌面命令问回来的"跑这次证明用的那个二进制"。
   *
   * 它**可以缺席**（老版本命令、或问不到），但**一旦出现就必须是字符串或 `null`** ——
   * 一个数字或对象混进来会让适配器把它当版本用（`String(x)` 之后恰好非空），
   * 那就是"拿一个不是版本的字符串当版本"。所以这里是 fail-closed 的。
   */
  const backendVersion = raw.backendVersion
  if (backendVersion !== undefined && backendVersion !== null && typeof backendVersion !== "string") {
    return rejected(`backendVersion=${JSON.stringify(backendVersion)} 既不是字符串也不是 null`)
  }

  return {
    outcome: outcome as ProofChannelOutcome,
    exitCode,
    stdout,
    stderr,
    durationMs,
    detail: typeof raw.detail === "string" ? raw.detail : "",
    ...(backendVersion === undefined ? {} : { backendVersion: backendVersion as string | null })
  }
}

/** 桌面壳里的通道；浏览器里返回"这里跑不了"的那一条（**如实，不是错误**）。 */
export function createDesktopProofChannel(): ProofChannel {
  if (!isDesktopShell()) {
    return unavailableProofChannel(
      "这个构建跑在浏览器里 —— 形式证明后端需要桌面外壳（Lean 工具链与 mathlib 不在浏览器里）。作图不受影响。"
    )
  }
  return async (request) => {
    try {
      const raw = await invokeDesktop<unknown>("check_lean_proof", { source: request.source, timeoutMs: request.timeoutMs })
      return normalizeProofChannelResult(raw)
    } catch (error) {
      // 桌面外壳在，但这一趟 IPC 没成："没调到"≠"证不出来"，所以是 `failed` 而不是 `unavailable`。
      const detail = error instanceof NoDesktopShellError ? "桌面外壳在两次检测之间消失了。" : `调用 check_lean_proof 失败：${error instanceof Error ? error.message : String(error)}`
      return { outcome: "failed", exitCode: null, stdout: "", stderr: "", durationMs: 0, detail }
    }
  }
}

/**
 * **产品侧的那一次调用**：把通道接上，然后把活交给库里的编排。
 *
 * 调用方只给"要证明什么、题面是什么"，**通道由这里决定**（浏览器 / 桌面）——
 * 这样调用方不会（也不能）自己塞一条假的通道进来。
 */
export async function runAutomaticProof(
  request: Omit<AutomaticProofRequest, "channel">,
  channel: ProofChannel = createDesktopProofChannel()
): Promise<AutomaticProofResult> {
  return await attemptAutomaticProof({ ...request, channel })
}

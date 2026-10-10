import type { ClaimEvidenceStatus } from "../claimEvidence"
import type { DiagramObligationSet } from "../diagramObligations"

import { LEAN4_SUPPORTED_GOAL_KINDS, runLean4ClosedLoop, type Lean4ProofGoalInput, type Lean4RunResult, type Lean4Runner } from "./lean4Adapter"
import type { ProofArtifact, ProofVerifyOptions } from "./proofArtifact"
import { bridgeProofPremises, type PremiseBridgeGoal, type PremiseBridgeResult } from "./proofPremiseBridge"

/**
 * **产品侧自动调用与产物通道**（V2 GREEN 缺口③）。
 *
 * ## 它把已有的三块接起来
 *
 * ```
 * 题设（解析层的 givens）
 *   → 前提桥（每条前提指得出出处；有凭空编的就到此为止）
 *   → 适配器（生成命题 + 跑 + 判公理 + 造产物 + 过校验器）
 *   → 证据状态
 * ```
 *
 * ## 它**不做**的四件事（每一条都是一条边界）
 *
 * 1. **不判定**：证明成没成只由 `judgeLean4Run` 与 `checkAxiomsReport` 说（那一层已经写过"正文不是判据"）；
 * 2. **不猜前提**：前提桥说"有一条指不出出处"就**不跑**（不是"跑了再拒"）；
 * 3. **不阻塞作图**：这个函数**不抛**，最坏情况是一个如实的结局对象 —— 调用方永远可以继续画图；
 * 4. **不自己拼 Lean 源码**：交给 `lean4Adapter` 的模板生成（桌面命令那边还要再查一遍形状）。
 *
 * ## `ProofChannel` 是**端口**，不是实现
 *
 * 桌面壳里它是 Tauri 命令（`check_lean_proof`，源码见 `apps/desktop/src-tauri/src/proof/`）；
 * 浏览器里它根本不存在 —— 所以注入的缺省是"不可用"，那种情况下**如实报**"这台机器上没法跑"，
 * 而不是假装证过、也不是报错。
 */

/** 通道的结局词表（与 Rust 侧 `LeanOutcome` **逐字同形**）。 */
export type ProofChannelOutcome = "exited" | "failed" | "timeout" | "unavailable"

/** 通道交回来的东西：**只描述进程怎么结束的**，不含任何"成没成"的判断。 */
export interface ProofChannelResult {
  outcome: ProofChannelOutcome
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  detail: string
}

export interface ProofChannelRequest {
  /** 要跑的那份 Lean 文件内容（由适配器的模板生成）。 */
  source: string
  timeoutMs: number
}

export type ProofChannel = (request: ProofChannelRequest) => Promise<ProofChannelResult>

/** 默认墙钟：与适配器、与桌面命令三处同一个量级。 */
export const DEFAULT_PROOF_TIMEOUT_MS = 180_000

/** 自动调用的一次结局（**封闭词表**：多一个都要显式加）。 */
export type AutomaticProofOutcome =
  /** 旗关着 —— 默认路径就是这一支。 */
  | "flag_off"
  /** 后端没给证明正文（空正文不值得花几分钟）。 */
  | "no_proof_body"
  /** 这条目标类不在适配器的覆盖范围里。 */
  | "goal_unsupported"
  /** 前提桥说有前提指不出出处 ⇒ **连通道都不碰**。 */
  | "premises_unresolved"
  /** 这台机器上没配/没法跑 Lean（**不是**"证不出来"）。 */
  | "toolchain_unavailable"
  /** 撞墙钟被杀。 */
  | "timeout"
  /** 跑了，但判据不接受（编译错、`sorry`、表外公理、报告缺失…）。 */
  | "rejected"
  /** 判据接受、产物过了校验器 ⇒ 才允许升到 `formally_proved`。 */
  | "verified"
  /** 这一层自己出了岔子（通道抛了、模板抛了…）—— 如实报，状态照旧。 */
  | "internal_error"

export interface AutomaticProofRequest {
  /** 升之前的状态（升不上去就原样返回它）。 */
  base: ClaimEvidenceStatus
  claimId: string
  prompt: string
  claimSourceText: string
  assumptions?: readonly string[]
  /** 已经分类好的目标（形状与用途由前提桥与适配器共同决定）。 */
  goal: PremiseBridgeGoal
  /** 这份题面读出来的题设（前提桥要用）。 */
  obligations: DiagramObligationSet
  /** 后端给的正文草稿。**空 ⇒ 不跑。** */
  proof: string
  /** 产品开关（`featureFlags` 的 `proofExport`）。**关着就什么都不做。** */
  flagEnabled: boolean
  /** 桌面壳的 Lean 通道；浏览器里传"不可用"那条。 */
  channel: ProofChannel
  /** 实测的后端版本串（没有它，适配器不产出产物 —— 没有版本的证明不算证明）。 */
  backendVersion?: string
  timeoutMs?: number
  verifyOptions?: ProofVerifyOptions
}

export interface AutomaticProofResult {
  outcome: AutomaticProofOutcome
  /** 升之后的证据状态（没升就是 `base`）。 */
  status: ClaimEvidenceStatus
  /** 只有 `verified` 时才可能非空，而且**一定**过了校验器。 */
  artifact: ProofArtifact | null
  /** 产物是不是真的过了 `verifyProofArtifact`（不是"刚生成的所以肯定行"）。 */
  verified: boolean
  /** 给人看的一句话。 */
  detail: string
  /** 前提桥的结论（跑没跑都留着：调用方要能显示"哪些前提是系统补的"）。 */
  bridge: PremiseBridgeResult | null
}

/** 浏览器里那条通道：**如实说这台机器上跑不了**，而不是假装。 */
export function unavailableProofChannel(reason: string): ProofChannel {
  return async () => ({ outcome: "unavailable", exitCode: null, stdout: "", stderr: "", durationMs: 0, detail: reason })
}

/**
 * **把通道当 runner 用**（适配器的闭环只认 `Lean4Runner`，所以这里做一次翻译）。
 *
 * 翻译里只有一处要动脑子：**通道的 `failed`（起不来）要留下它的说明**。
 * 适配器看的是 `exitCode` / `timedOut` / `unavailableReason` 三件事，`detail` 不在其中 ——
 * 所以把它放进 `stderr`，判据那层会原样带进失败说明里（否则人会看到一句"退出码 null"却不知道为什么）。
 */
export function channelAsRunner(channel: ProofChannel, timeoutMs: number): Lean4Runner {
  return async (request): Promise<Lean4RunResult> => {
    if (request.leanPath.trim().length === 0 && request.lakePath === null) {
      // 调用方说"没有工具链"（`toolchain` 为 null）—— 那就别去碰通道了。
      return { exitCode: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, unavailableReason: "调用方没有提供 Lean 工具链（`toolchain` 为 null）。" }
    }
    const result = await channel({ source: request.source, timeoutMs })
    if (result.outcome === "unavailable") {
      return { exitCode: null, stdout: "", stderr: "", durationMs: result.durationMs, timedOut: false, unavailableReason: result.detail }
    }
    if (result.outcome === "timeout") {
      return { exitCode: null, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, timedOut: true }
    }
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.outcome === "failed" && result.stderr.trim().length === 0 ? result.detail : result.stderr,
      durationMs: result.durationMs,
      timedOut: false
    }
  }
}

/** 目标类 → 适配器的输入形状（**只做搬运**，不做任何补全）。 */
function adapterInputFor(request: AutomaticProofRequest): Lean4ProofGoalInput {
  const shared = {
    prompt: request.prompt,
    claimSourceText: request.claimSourceText,
    assumptions: request.assumptions,
    proof: request.proof
  }
  if (request.goal.goalKind === "perpendicular") {
    return {
      ...shared,
      goalKind: "perpendicular",
      perpendicular: { lineA: request.goal.lineA, planePoints: [...request.goal.planePoints], lineB: request.goal.lineB }
    }
  }
  if (request.goal.goalKind === "tangentSlope") {
    return { ...shared, goalKind: "tangentSlope", tangentSlope: { functionName: request.goal.tangentSlope.functionName } }
  }
  return {
    ...shared,
    goalKind: "linePlanePerpendicular",
    linePlanePerpendicular: { line: request.goal.line, planeLines: [request.goal.planeLines[0], request.goal.planeLines[1]] }
  }
}

/**
 * **产品侧的那一次调用**（唯一入口）。
 *
 * 顺序是刻意的：**先问该不该跑**（旗、正文、目标类、前提），**再看跑出来什么**。
 * 前面四道门任何一道不过，通道**一次都不会被调用** —— 那样就没有"先花了三分钟再说不行"这件事。
 */
export async function attemptAutomaticProof(request: AutomaticProofRequest): Promise<AutomaticProofResult> {
  const unchanged = (outcome: AutomaticProofOutcome, detail: string, bridge: PremiseBridgeResult | null = null): AutomaticProofResult => ({
    outcome,
    status: request.base,
    artifact: null,
    verified: false,
    detail,
    bridge
  })

  if (!request.flagEnabled) {
    return unchanged("flag_off", "证明导出开关没开（`proofExport` 默认关）—— 默认路径不调用形式证明后端。")
  }
  if (request.proof.trim().length === 0) {
    return unchanged("no_proof_body", "后端没有给证明正文 —— 空正文不值得花几分钟去跑（也不该假装证过）。")
  }
  if (!LEAN4_SUPPORTED_GOAL_KINDS.includes(request.goal.goalKind)) {
    // 类型上今天进不来（`PremiseBridgeGoal` 只有两类），但**先判一次**：桥对表外类是抛，
    // 而"我们不支持这一类"是**结局**，不是"这一层出岔子"（那会被报成 internal_error）。
    return unchanged("goal_unsupported", `目标类「${request.goal.goalKind}」不在适配器覆盖范围 ${LEAN4_SUPPORTED_GOAL_KINDS.join(" / ")} 内。`)
  }

  let bridge: PremiseBridgeResult
  try {
    bridge = bridgeProofPremises(request.goal, request.obligations)
  } catch (error) {
    return unchanged("internal_error", `前提桥拒绝了这个目标：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!bridge.ok) {
    const missing = bridge.invented.map((entry) => entry.premise).join("、")
    return unchanged("premises_unresolved", `题面里找不齐这条命题要的前提（缺：${missing}）—— 系统不许替题面补一条它没说的，所以**连通道都不碰**。`, bridge)
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS
  try {
    const outcome = await runLean4ClosedLoop(request.base, adapterInputFor(request), request.claimId, {
      // 通道自己决定跑什么（桌面命令）；这里只告诉适配器"工具链存在"。
      runner: channelAsRunner(request.channel, timeoutMs),
      toolchain: { leanPath: "channel://desktop", lakePath: "channel://desktop" },
      projectDir: "channel://desktop",
      backendVersion: request.backendVersion,
      timeoutMs,
      maxHeartbeats: 400_000,
      verifyOptions: request.verifyOptions
    })

    const verifiedArtifact = outcome.verification.status === "verified" ? outcome.verification.artifact : null
    if (verifiedArtifact !== null) {
      return { outcome: "verified", status: outcome.status, artifact: verifiedArtifact, verified: true, detail: outcome.judgement.detail, bridge }
    }

    const mapped: AutomaticProofOutcome =
      outcome.judgement.status === "unsupported" ? "toolchain_unavailable" : outcome.judgement.status === "timeout" ? "timeout" : "rejected"
    return { outcome: mapped, status: outcome.status, artifact: null, verified: false, detail: outcome.judgement.detail, bridge }
  } catch (error) {
    // **最坏情况不许变成"证过了"**：如实报这一层出了岔子，状态原样交回。
    return unchanged("internal_error", `自动证明这条路自己出错了：${error instanceof Error ? error.message : String(error)}`, bridge)
  }
}

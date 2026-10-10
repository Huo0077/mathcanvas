import type { ClaimEvidenceStatus } from "../claimEvidence"
import type { DiagramObligationSet } from "../diagramObligations"

import { LEAN4_SUPPORTED_GOAL_KINDS, runLean4ClosedLoop, type Lean4ProofGoalInput, type Lean4RunResult, type Lean4Runner } from "./lean4Adapter"
import type { ProofArtifact, ProofVerifyOptions } from "./proofArtifact"
import { canonicalProofBody } from "./canonicalProof"
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
  /**
   * **跑这次证明用的那个二进制的版本串**（桌面命令问回来的）。
   *
   * 适配器要求**实测的版本串**才产出产物（"没有版本的证明不算证明"），而调用的那一刻前端还不知道它是多少
   * —— 所以它随通道回来，由 `attemptAutomaticProof` 在跑完之后补进产物那一栏。
   */
  backendVersion?: string | null
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
  /**
   * **正文草稿**：模型给的那一份。
   *
   * **可以不给**（2026-10-10 改）：不给就走 `canonicalProofBody`（系统按类给的那一份）——
   * 产品侧那条自动调用不一定有模型在场。两样都没有 ⇒ `no_proof_body`（不跑）。
   */
  proof?: string
  /** 正文从哪来。缺省按 `proof` 在不在推：有就用它（`model`），没有就用系统那份（`system-canonical`）。 */
  proofSource?: ProofSource
  /** 产品开关（`featureFlags` 的 `proofExport`）。**关着就什么都不做。** */
  flagEnabled: boolean
  /** 桌面壳的 Lean 通道；浏览器里传"不可用"那条。 */
  channel: ProofChannel
  /** 实测的后端版本串（没有它，适配器不产出产物 —— 没有版本的证明不算证明）。 */
  backendVersion?: string
  timeoutMs?: number
  verifyOptions?: ProofVerifyOptions
}

/** 正文的来源（**用户有权知道**：这条证明是模型想出来的，还是系统照抄的）。 */
export type ProofSource = "model" | "system-canonical"

export interface AutomaticProofResult {
  outcome: AutomaticProofOutcome
  /** 升之后的证据状态（没升就是 `base`）。 */
  status: ClaimEvidenceStatus
  /** 只有 `verified` 时才可能非空，而且**一定**过了校验器。 */
  artifact: ProofArtifact | null
  /** 产物是不是真的过了 `verifyProofArtifact`（不是"刚生成的所以肯定行"）。 */
  verified: boolean
  /** 这一次用的是谁的正文（没跑就是 `null`）。 */
  proofSource: ProofSource | null
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
 * 翻译里有两处要动脑子：
 *
 * 1. **通道的 `failed`（起不来）要留下它的说明** —— 适配器看的是 `exitCode` / `timedOut` /
 *    `unavailableReason` 三件事，`detail` 不在其中，所以把它放进 `stderr`（否则人会看到
 *    一句"退出码 null"却不知道为什么）。
 * 2. **版本串要捞出来交给调用方**（`onBackendVersion` 回调）：适配器要求实测版本才产出产物，
 *    而"我们到底执行了哪个二进制"只有通道知道。回调而不是返回值，是因为 runner 的返回类型
 *    是适配器定的（`Lean4RunResult` 里没有版本这一栏）。
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
      timedOut: false,
      // **版本串随结果交回**：它是"我们执行了哪个二进制"的唯一来源。
      ...(result.backendVersion === undefined ? {} : { backendVersion: result.backendVersion })
    }
  }
}

/** 目标类 → 适配器的输入形状（**只做搬运**，不做任何补全）。 */
function adapterInputFor(request: AutomaticProofRequest, proof: string): Lean4ProofGoalInput {
  const shared = {
    prompt: request.prompt,
    claimSourceText: request.claimSourceText,
    assumptions: request.assumptions,
    proof
  }
  if (request.goal.goalKind === "perpendicular") {
    return {
      ...shared,
      goalKind: "perpendicular",
      perpendicular: { lineA: request.goal.lineA, planePoints: [...request.goal.planePoints], lineB: request.goal.lineB }
    }
  }
  if (request.goal.goalKind === "lineInPlane") {
    return { ...shared, goalKind: "lineInPlane", lineInPlane: { line: request.goal.line, planePoints: [...request.goal.planePoints] } }
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
    proofSource: null,
    detail,
    bridge
  })

  if (!request.flagEnabled) {
    return unchanged("flag_off", "证明导出开关没开（`proofExport` 默认关）—— 默认路径不调用形式证明后端。")
  }

  /**
   * **先问"这一类能不能试"**（2026-10-10 把顺序调过来的）：表外目标类连正文都不该有 ——
   * 先判正文会让"这一类我们不支持"被报成"没有正文"，那是**误导**。
   */
  if (!LEAN4_SUPPORTED_GOAL_KINDS.includes(request.goal.goalKind)) {
    // 类型上今天进不来（`PremiseBridgeGoal` 只有那几类），但**先判一次**：桥对表外类是抛，
    // 而"我们不支持这一类"是**结局**，不是"这一层出岔子"（那会被报成 internal_error）。
    return unchanged("goal_unsupported", `目标类「${request.goal.goalKind}」不在适配器覆盖范围 ${LEAN4_SUPPORTED_GOAL_KINDS.join(" / ")} 内。`)
  }

  /**
   * **正文从哪来**（改成**显式开关**，2026-10-10；起因是一条用例红了）。
   *
   * 第一版写的是"`proof` 空 ⇒ 自动用系统那份"。用例当场指出了问题：调用方给一个**空正文**时
   * 的意思是"**别跑**"，而静默换成系统正文会让这条意图消失（它可能是有意的）。
   * 所以现在只有**明说** `proofSource: "system-canonical"` 才走系统那张表；
   * 否则 `proof` 是空的就如实 `no_proof_body`。
   */
  const wantsCanonical = request.proofSource === "system-canonical"
  const canonical = wantsCanonical ? canonicalProofBody(request.goal) : null
  const proof = wantsCanonical ? canonical?.body ?? "" : request.proof ?? ""
  const proofSource: ProofSource = wantsCanonical && canonical !== null ? "system-canonical" : "model"
  if (proof.trim().length === 0) {
    return unchanged(
      "no_proof_body",
      wantsCanonical
        ? "这一类今天没有系统 canonical 正文，而调用方也没有给模型正文 —— 空正文不值得花几分钟去跑（也不该假装证过）。"
        : "没有证明正文 —— 空正文不值得花几分钟去跑（也不该假装证过）。要用系统按类给的那份，请显式传 `proofSource: system-canonical`。"
    )
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
    /**
     * **版本串的接线（2026-10-10，第一版写错了、被用例抓出来）**：
     *
     * 第一版想的是"传同一个 options 对象进去、让通道回调把 `backendVersion` 补上"。**那行不通**：
     * `runLean4ClosedLoop` 会 `{ ...options, claimId }` **拷贝**一份再往下传，所以改原对象到不了适配器。
     * 现在改成让**运行结果自己带版本**（`Lean4RunResult.backendVersion`，由通道填），
     * 适配器在跑完之后读它 —— 顺序天然对：版本本来就来自"刚刚那次运行"。
     *
     * 调用方显式给的 `backendVersion` **优先**（测试与将来的固定版本场景要用它）。
     */
    const outcome = await runLean4ClosedLoop(request.base, adapterInputFor(request, proof), request.claimId, {
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
      return {
        outcome: "verified",
        status: outcome.status,
        artifact: verifiedArtifact,
        verified: true,
        proofSource,
        // **正文的来源要写进说明**：内核验的是正文本身（判据那层刻意不看正文），
        // 但"这条证明是模型想出来的还是系统照抄的"是用户有权知道的事。
        detail: proofSource === "system-canonical" ? `${outcome.judgement.detail}（正文由**系统**按这一类给出：${canonical?.note ?? ""}）` : outcome.judgement.detail,
        bridge
      }
    }

    const mapped: AutomaticProofOutcome =
      outcome.judgement.status === "unsupported" ? "toolchain_unavailable" : outcome.judgement.status === "timeout" ? "timeout" : "rejected"
    return { outcome: mapped, status: outcome.status, artifact: null, verified: false, proofSource, detail: outcome.judgement.detail, bridge }
  } catch (error) {
    // **最坏情况不许变成"证过了"**：如实报这一层出了岔子，状态原样交回。
    return unchanged("internal_error", `自动证明这条路自己出错了：${error instanceof Error ? error.message : String(error)}`, bridge)
  }
}

/**
 * **可靠性整改的灰度开关（W9 / T9，2026-11-08）**。
 *
 * 与 `featureFlags.ts` 的 N1–N5 开关分开：那五个是"下一阶段能力"，这五个是
 * **本轮整改的分层开关**。分开的理由是回滚顺序不同 —— 出问题时先关本轮新增的
 * 语义层/核验层，不必连带关掉已有的 IR 或证明出口。
 *
 * 三条纪律：
 * 1. **默认全关**：没有一条能力因为"代码合进来了"就默认改变生产行为；
 * 2. **互相独立**：关掉数学核验不会顺带关掉逐问交付，反之亦然；
 * 3. **不由模型开启**：这些开关只在应用层/测试注入，不是工具参数，也不是模型能写的字段。
 *
 * 目前这些开关是**声明 + 读取入口**：对应模块尚未接进生产路径（见 W6/W8 的边界说明），
 * 所以它们不会成为"绕过门禁"的捷径 —— 关掉任何一个都只会让证据等级更保守，不会放宽草稿确认。
 */

export interface AgentReliabilityFlags {
  /** W2：逐问交付/诚实状态（`solveResult`）。 */
  answerSemanticsV1: boolean
  /** W3：题意层目标与条件消费清单。 */
  goalTrackingV1: boolean
  /** W5：独立数学答案核验。 */
  mathVerificationV1: boolean
  /** W6：受控局部重读。 */
  imageRereadV1: boolean
  /** W7：有限三视图族。 */
  orthographicTemplatesV1: boolean
}

/** 开关名的唯一来源；与接口做等集断言（`reliabilityFlags.test.ts`）。 */
export const AGENT_RELIABILITY_FLAG_NAMES = [
  "answerSemanticsV1", "goalTrackingV1", "mathVerificationV1", "imageRereadV1", "orthographicTemplatesV1"
] as const satisfies readonly (keyof AgentReliabilityFlags)[]

export type AgentReliabilityFlagName = (typeof AGENT_RELIABILITY_FLAG_NAMES)[number]

const OFF: Record<AgentReliabilityFlagName, false> = {
  answerSemanticsV1: false,
  goalTrackingV1: false,
  mathVerificationV1: false,
  imageRereadV1: false,
  orthographicTemplatesV1: false
}

export function createAgentReliabilityFlags(overrides: Partial<AgentReliabilityFlags> = {}): AgentReliabilityFlags {
  for (const key of Object.keys(overrides)) {
    if (!(AGENT_RELIABILITY_FLAG_NAMES as readonly string[]).includes(key)) throw new Error(`unknown reliability flag: ${key}`)
  }
  return { ...OFF, ...overrides }
}

/**
 * 生产读取入口。**当前没有持久化偏好**：这一版只有测试/注入点会打开它们，
 * 生产默认全关 —— 与"未经批准不改变用户可见行为"一致。
 */
export function agentReliabilityFlags(): AgentReliabilityFlags {
  return createAgentReliabilityFlags()
}

/** 测试配置用：全开。测试里必须显式取这个常量，不靠副作用全局打开。 */
export const RELIABILITY_FLAGS_FOR_TESTS: AgentReliabilityFlags = createAgentReliabilityFlags({
  answerSemanticsV1: true,
  goalTrackingV1: true,
  mathVerificationV1: true,
  imageRereadV1: true,
  orthographicTemplatesV1: true
})

/**
 * **W11：开关依赖必须可校验**（2026-11-09）。
 *
 * 五个开关不是"随便组合"的：数学核验依赖题意层与答案语义，否则"核验"的对象
 * 本身就是猜出来的目标；三视图族又依赖数学核验，否则它只能给尺寸、给不了判据；
 * 受控重读依赖**可用的会话**与**原附件能力**，否则"重读"没有可读的东西。
 *
 * 返回 `ok: false` 时必须拒绝启动新模式 —— 关闭某个开关只会让证据更保守，
 * 但**非法组合**会让"已核验"变成假话。
 */
export interface ReliabilityCapabilities {
  sessionAvailable?: boolean
  attachmentCapability?: boolean
}

export interface ReliabilityConfigError {
  code: string
  message: string
}

export function validateReliabilityConfig(
  flags: AgentReliabilityFlags,
  capabilities: ReliabilityCapabilities = {}
): { ok: true } | { ok: false; errors: ReliabilityConfigError[] } {
  const errors: ReliabilityConfigError[] = []
  if (flags.mathVerificationV1 && !flags.goalTrackingV1) {
    errors.push({ code: "math_requires_goal_tracking", message: "数学核验要求先开启题意/目标跟踪（goalTrackingV1），否则核验的不是题面目标。" })
  }
  if (flags.mathVerificationV1 && !flags.answerSemanticsV1) {
    errors.push({ code: "math_requires_answer_semantics", message: "数学核验要求先开启逐问交付语义（answerSemanticsV1），否则否证无法落到交付状态。" })
  }
  if (flags.orthographicTemplatesV1 && !flags.goalTrackingV1) {
    errors.push({ code: "orthographic_requires_goal_tracking", message: "三视图族要求题意/目标跟踪（goalTrackingV1）。" })
  }
  if (flags.orthographicTemplatesV1 && !flags.mathVerificationV1) {
    errors.push({ code: "orthographic_requires_math_verification", message: "三视图族要求数学核验（mathVerificationV1），否则体积没有独立判据。" })
  }
  if (flags.imageRereadV1 && capabilities.sessionAvailable === false) {
    errors.push({ code: "reread_requires_session", message: "受控重读要求可用的解题会话；没有会话就不该发读图请求。" })
  }
  if (flags.imageRereadV1 && capabilities.attachmentCapability === false) {
    errors.push({ code: "reread_requires_attachments", message: "受控重读要求原附件能力；没有附件就无从重读。" })
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/** FNV-1a：只用于**稳定分桶**，不是密码学哈希，也不参与任何身份校验。 */
function stableBucket(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % 100
}

/** 同一会话在同一档位下必须**总是**落在同一个桶里（不随机、不随重启变化）。 */
export function rolloutBucket(sessionId: string): number {
  return stableBucket(sessionId)
}

export function isEnabledForSession(sessionId: string, percentage: number): boolean {
  if (!Number.isFinite(percentage)) return false
  const clamped = Math.min(100, Math.max(0, percentage))
  return rolloutBucket(sessionId) < clamped
}

/**
 * **W11：把分桶接到真实消费点**。
 *
 * 同一个会话在一次发布里只落一个桶；开关按**依赖顺序**派生 —— 题意层与答案语义先开，
 * 数学核验才可能开，三视图族再依赖数学核验。于是任何比例下得到的组合都是合法的，
 * 不需要在错误路径上再兜一次底。默认比例 0 ⇒ 与"全关"逐字相同。
 */
export function createAgentReliabilityFlagsForSession(sessionId: string, percentage: number): AgentReliabilityFlags {
  const enabled = isEnabledForSession(sessionId, percentage)
  const answerSemanticsV1 = enabled
  const goalTrackingV1 = enabled && answerSemanticsV1
  const mathVerificationV1 = enabled && goalTrackingV1
  const orthographicTemplatesV1 = enabled && mathVerificationV1
  // 重读不依赖语义层，但仍受同一个桶控制（同一会话不会"一半开一半关"）。
  const imageRereadV1 = enabled
  return createAgentReliabilityFlags({ answerSemanticsV1, goalTrackingV1, mathVerificationV1, orthographicTemplatesV1, imageRereadV1 })
}

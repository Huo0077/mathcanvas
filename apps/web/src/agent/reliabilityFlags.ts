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

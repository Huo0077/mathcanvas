import type { PlanEnvelope, PlannerPort } from "@draw/agent-core"
import { PLAN_SCHEMA_VERSION } from "@draw/agent-core"

/**
 * **本地确定性规划器**（Task 2.5 Step 2 的过渡件）。
 *
 * ## 它是什么、不是什么
 *
 * 它**不是模型**，也**不假装是**：它只认下面列出的几句明确指令，把它们翻成**真实的动作**
 *（走真实的编译器、真实的草稿、真实的宿主桥与 Compare-and-Swap）。认不出来就如实说
 *"我认不出这条指令"并停止，**绝不编一个看起来像答案的回复**。
 *
 * ## 为什么必须有它
 *
 * 计划 G2 Gate 要求生产路径上不再有演示回复。但把演示回复一删，而真实 provider 又被
 * G1 的 Rust 工具链缺失挡着（`rustc` 不存在），界面就会变成"发送后什么都不发生" ——
 * 那比演示回复更差，而且让 e2e 里"Agent 能发出并执行一条指令"这条链路完全无从验证。
 *
 * 所以这里选的是第三条路：**确定性本地规划器**。它的保证与演示回复有本质区别：
 * - 演示回复产出一段**常量文本**，不触碰编译、草稿、提交任何一环；
 * - 本地规划器产出的动作**真的会**被编译、真的会进草稿、真的会要求用户确认，
 *   失败的路径（认不出、工作区不对、动作被编译器拒绝）也都会如实走到界面上。
 *
 * G1 到位之后，真实 provider 通过 `PlannerPort` 接进来，这个文件**原样保留**：
 * 它仍然是离线/测试环境里唯一确定性的那条路径（计划 Task 5.3 的评测也要用）。
 */

/** 一条本地能认的指令。**明确列出**，而不是"猜用户想干什么"。 */
export interface LocalIntent {
  /** 触发词（全部出现才算命中）。 */
  all: readonly string[]
  /** 至少出现一个（缺省表示不需要）。 */
  any?: readonly string[]
  /**
   * 这条指令**用到的技能清单 id**（`SKILL_MANIFESTS` 里那些）。
   *
   * 为什么规划器要声明它：运行时的 `requestedSkillIds` 会决定模型上下文里
   * "可用动作有哪几个"，而**必须在建运行时之前就知道**（上下文是发请求前组装的）。
   * 确定性规划器能精确知道自己要用哪份清单，所以它在命中指令的那一刻就说出来 ——
   * 这比"给所有技能"或"给个猜的集合"都诚实。
   */
  skillIds: readonly string[]
  build: (input: LocalIntentInput) => PlanEnvelope
}

export interface LocalIntentInput {
  prompt: string
  /** 从指令里抠出的第一个数字（认不出时用默认值）。 */
  size: number
}

/** 把指令里的第一个数字当尺寸；认不出时用调用方给的默认值。 */
function sizeFrom(prompt: string, fallback: number): number {
  const match = prompt.match(/(\d+(?:\.\d+)?)/)
  const value = match ? Number(match[1]) : fallback
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const CUBE = (input: LocalIntentInput): PlanEnvelope => ({
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: `创建一个棱长 ${input.size} 的立方体`,
  factIds: [],
  actions: [{
    actionId: "solid.create_template",
    actionKey: "cube",
    factIds: [],
    inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: input.size, y: input.size, z: input.size } }
  }]
})

const PLANAR_POINT = (input: LocalIntentInput): PlanEnvelope => ({
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "创建一个平面点",
  factIds: [],
  actions: [{
    actionId: "planar.create_point",
    actionKey: "point",
    factIds: [],
    inputs: { alias: "point", points: [{ x: input.size, y: 0 }] }
  }]
})

/** 只读回答：不产生任何动作，因此**不可能**改文档。 */
const COUNT_ANSWER = (): PlanEnvelope => ({
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "answer",
  goal: "回答场景里有什么",
  factIds: [],
  answer: "这条指令被识别为只读提问。当前本地规划器不做自然语言理解，所以只能确认：我没有改动任何东西。",
  toolResultRefs: []
})

/**
 * 本地能认的指令表。
 *
 * 顺序有意义：**先匹配更具体的**（"立方体"在"体"之前）。
 */
export const LOCAL_INTENTS: readonly LocalIntent[] = [
  { all: ["立方体"], skillIds: ["spatial-modeling"], build: (input) => CUBE({ ...input, size: sizeFrom(input.prompt, 2) }) },
  { all: ["正方体"], skillIds: ["spatial-modeling"], build: (input) => CUBE({ ...input, size: sizeFrom(input.prompt, 2) }) },
  { all: ["cube"], skillIds: ["spatial-modeling"], build: (input) => CUBE({ ...input, size: sizeFrom(input.prompt, 2) }) },
  { all: ["点"], any: ["画", "作", "建", "添加"], skillIds: ["planar-basics"], build: (input) => PLANAR_POINT({ ...input, size: sizeFrom(input.prompt, 1) }) },
  // 只读提问不产生动作，因此**不请求任何技能** —— 上下文里不该出现用不上的动作菜单。
  { all: ["有什么"], skillIds: [], build: () => COUNT_ANSWER() }
]

/** 找出这条指令命中的那一条（认不出返回 `null`）。**匹配规则只有这一处**。 */
export function matchLocalIntent(prompt: string): LocalIntent | null {
  const normalized = prompt.toLowerCase()
  for (const intent of LOCAL_INTENTS) {
    if (!intent.all.every((token) => normalized.includes(token.toLowerCase()))) continue
    if (intent.any && !intent.any.some((token) => normalized.includes(token.toLowerCase()))) continue
    return intent
  }
  return null
}

/**
 * 这条指令要用到的技能清单 id。
 *
 * 运行器在**建运行时之前**调它（`requestedSkillIds` 必须那时候就定），所以它必须与
 * `plan()` 里的匹配**完全一致** —— 因此两边共用 `matchLocalIntent`，而不是各写一遍
 * "包含哪些词"的判断（两份判断一旦分叉，就会出现"上下文里没有这个技能，但规划器产出了
 * 它的动作"，表现为莫名其妙的编译失败）。
 */
export function localIntentSkillIds(prompt: string): readonly string[] {
  return matchLocalIntent(prompt)?.skillIds ?? []
}

export interface LocalPlannerOptions {
  /** 命中指令表之外的输入时是否给出"认不出"的回答（缺省 true）。 */
  explainRefusal?: boolean
}

/**
 * 造一个本地规划器。
 *
 * **认不出时返回 `clarification`**（问用户），而不是 `answer`（编一段回答）：
 * 前者会把运行推进到 `waiting`，界面据此显示"等待补充信息"；后者会让用户以为系统听懂了。
 */
export function createLocalPlanner(options: LocalPlannerOptions = {}): PlannerPort {
  const explainRefusal = options.explainRefusal ?? true
  let sequence = 0

  return {
    async plan({ userMessage }) {
      sequence += 1
      const requestId = `local-request-${sequence}`
      const attemptId = `local-attempt-${sequence}`

      // 与 `localIntentSkillIds` **共用同一个匹配函数**（两份判断会分叉）。
      const intent = matchLocalIntent(userMessage)
      if (intent) return { plan: intent.build({ prompt: userMessage, size: 0 }), requestId, attemptId }

      if (!explainRefusal) {
        return { plan: { schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "无法识别", factIds: [], questions: ["请把要求说得更具体一些，或者直接用界面上的作图工具。"] }, requestId, attemptId }
      }

      // 认不出：**问**，而不是编。
      return {
        plan: {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "clarification",
          goal: "本地规划器无法识别这条指令",
          factIds: [],
          questions: [
            "当前没有接入模型服务，本地规划器只认识几条固定指令（例如「建一个棱长 3 的立方体」）。",
            "请换一种说法，或者回到画布用界面工具完成这一步。"
          ]
        },
        requestId,
        attemptId
      }
    }
  }
}

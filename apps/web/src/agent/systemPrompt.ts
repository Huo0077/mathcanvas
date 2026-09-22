import { PLAN_SCHEMA_VERSION, describeActions, describeDefaultPolicies, type ModelChannel, type ModelContext } from "@draw/agent-core"

/**
 * **生产系统提示词**（Agent DSL 切片 Task 5；规格 §6/§7）。
 *
 * ## 为什么它必须是一份**有版本号**的独立文件
 *
 * 提示词是模型看到的行为契约，而它此前散在 `modelPlanner.ts` 的一个函数里：
 * 改一句话就改了模型的行为，事后却没有任何东西能回答"那次运行用的是哪一版提示词"。
 * 版本号让 run 记录、评测与回归都能指同一份东西。
 *
 * ## 策略文本与场景数据**分开注入**
 *
 * `buildPolicyText` 只吃"这一轮允许做什么"（通道、能不能出计划、动作菜单、修复提示），
 * **不吃场景**；场景由 `buildSystemPrompt` 序列化成另一段 JSON 拼在后面。
 * 这样"同一份策略、不同的场景"可以直接对比（快照测试、缓存、审计），
 * 而混在一起写会让场景数据看起来像规则 —— 模型会以为规则随场景变。
 *
 * ## 三条只能靠提示词守住的纪律（规格 §7）
 *
 * 1. **只输出计划信封 JSON**（未知字段一律被拒）；
 * 2. **不输出 hidden chain-of-thought**（只要结论与假设）；
 * 3. **不跨会话 / 跨文档引用对象**（引用必须带 documentId，而且必须是**本次绑定**的那份文档）。
 */

/** 提示词版本。**改内容就要改它** —— 这是"模型当时看到的是哪一版"的唯一依据。 */
export const SYSTEM_PROMPT_VERSION = "mathcanvas.agent.prompt.v1"

const MAX_PROMPT_FACTS = 12
const MAX_PROMPT_REFS = 16

export interface SystemPromptPolicyInput {
  channel: ModelChannel
  /** 这一轮允不允许出计划（`plan.set_plan` 在不在工具表里）。 */
  canPlan: boolean
  /** 这一轮允许出现的动作（来自技能清单；决定动作菜单那一节）。 */
  actionIds: readonly string[]
  /** 上一次尝试为什么没被接受（只有第二次尝试才有）。 */
  repair?: { reason: string; errors: readonly { code: string; path: string; detail: string }[]; hint: string }
}

export interface SystemPromptInput {
  context: ModelContext
  channel: ModelChannel
  canPlan: boolean
  repair?: SystemPromptPolicyInput["repair"]
}

export interface SystemPrompt {
  version: string
  /** 与场景无关的策略文本（同一批动作 + 同一通道 → 逐字相同）。 */
  policy: string
  /** 场景数据（手柄、绑定、事实、选中引用、警告）。 */
  contextJson: string
  /** 最终发给模型的 system 内容。 */
  content: string
}

/** 通道建议：**必须与解析器用的是同一个通道值**，所以它按参数给，不按"猜"。 */
function channelAdvice(channel: ModelChannel): string {
  if (channel === "native_tools") {
    return "用工具 `plan_set_plan` 回答：把计划放在它的 arguments 里（arguments 就是一个计划信封）。这一轮**不要**用普通文本回答。"
  }
  return channel === "strict_json"
    ? "整段回复必须**就是**一个 JSON 对象：**不要用代码围栏**，也不要在前后添加任何文字。"
    : "如果要包代码围栏，请只包一层 ```json，且围栏内只有这个 JSON；围栏之外不要有别的字。"
}

/** 输出形状：三个分支各自**逐字**给出，因为多一个字段就会被拒。 */
function outputShapes(canPlan: boolean): string[] {
  const shapes: string[] = []
  if (canPlan) {
    shapes.push(`计划：${JSON.stringify({ schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "一句话说清这次要做什么", factIds: [], assumptions: [], actions: [{ actionId: "从下面的动作菜单里选", actionKey: "本次运行内唯一的名字", factIds: [], inputs: {} }] })}`)
  }
  shapes.push(`澄清（信息不足时用它，不要编数值）：${JSON.stringify({ schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "一句话", factIds: [], questions: ["一个具体的、用户能回答的问题"] })}`)
  shapes.push(`只读回答（不改文档时用它）：${JSON.stringify({ schemaVersion: PLAN_SCHEMA_VERSION, kind: "answer", goal: "一句话", factIds: [], answer: "回答本身", toolResultRefs: [] })}`)
  return shapes
}

/**
 * **默认规则那一节**：由动作登记表生成（`describeDefaultPolicies`）。
 *
 * 为什么要在提示词里说它：模型不知道"缺字段会怎样"时会**两个方向都错** ——
 * 要么把没把握的字段编一个数（审计会把它变成假设，用户看到的是"我替你定了"），
 * 要么对本来就够用的要求反问（第一次真实运行正是栽在这里）。
 */
function defaultRulesSection(actionIds: readonly string[]): string[] {
  const lines: string[] = []
  for (const entry of describeDefaultPolicies([...actionIds])) {
    const parts = entry.defaults.map((policy) => {
      if (policy.policy === "safe_default") return `${policy.field}=${JSON.stringify(policy.value)}（默认，会写进 assumptions）`
      if (policy.policy === "infer_from_facts") return `${policy.field}（先从用户原话里读）`
      if (policy.policy === "ask_user") return `${policy.field}（**必须问**，没有安全默认）`
      return `${policy.field}（必须显式给出）`
    })
    const required = entry.required.filter((field) => !entry.defaults.some((policy) => policy.field === field))
    if (parts.length === 0 && required.length === 0) continue
    lines.push(`- ${entry.actionId}：${[...required.map((field) => `${field}（必填）`), ...parts].join("、")}`)
  }
  return lines
}

/** 策略文本：**只看"这一轮允许做什么"**，与场景无关。 */
export function buildPolicyText(input: SystemPromptPolicyInput): string {
  const sections: string[] = [
    `你是 MathCanvas 的构图助手（提示词版本 ${SYSTEM_PROMPT_VERSION}）。你只能返回一个 JSON 对象；系统会校验它，然后编译成动作、生成隔离草稿、等用户确认之后才可能落盘。`,
    "**不要输出推理过程**：只给结论、假设与动作。过程性文字会被整体拒绝（它也不该被记录下来）。",
    input.canPlan
      ? "你不能自己提交：写入必须由用户在看到预览后确认。"
      : "这一阶段**不允许返回计划**：你只能提问或作答。",
    "不要引用别的会话或别的文档里的对象：引用必须带 documentId，而且必须是本次绑定的那份文档，或者是同一份计划里用 `{ scope: \"draft\", alias }` 定义的新对象。",
    "",
    "## 输出形状（多一个字段都会被拒绝）",
    channelAdvice(input.channel),
    ...outputShapes(input.canPlan)
  ]

  if (input.canPlan) {
    sections.push("", "## 本轮允许的动作（`actionId` 只能从这里选）",
      ...(input.actionIds.length > 0 ? input.actionIds.map((action) => `- ${action}`) : ["（这一轮没有任何可用动作：只能提问或作答）"]),
      "",
      "### 每个动作的 inputs 只能有下面这些字段（`alias` 是新对象的别名）",
      // 这一节由**动作登记表**生成（`describeActions`），而不是手写 —— 校验读的是同一张表。
      ...describeActions([...input.actionIds]).slice(0, 12).map((action) => {
        const enums = Object.entries(action.enums).map(([field, values]) => `${field} 只能取 ${values.join(" | ")}`).join("；")
        return `- ${action.actionId}：${action.inputs.join(", ")}${enums.length > 0 ? ` · **${enums}**` : ""}`
      }),
      "坐标一律写成 `{ \"x\": 数, \"y\": 数, \"z\": 数 }`（平面动作只用 x/y）。白名单之外的字段一律被拒 —— 不要发明字段（例如棱柱没有 `faces`：侧面由内核生成）。",
      "",
      "## 缺字段会怎样（按这张表来，不要自己编）",
      ...defaultRulesSection(input.actionIds),
      "",
      "## 先做，别反问",
      "能作图就作图：像「建一个棱长 3 的立方体」这样的要求**已经足够** —— 没说的细节取表里的默认值，并把每一条默认写进 `assumptions`。",
      "`assumptions` 是给用户看的，所以用一句人话写，最多 4 条。",
      "只有表里标着「必须问」的字段缺失时才返回 `clarification`，而且问题要具体到能直接回答。",
      "",
      "## 题目要求「任意 / 恒定 / 定值」时",
      "必须保留符号参数（例如参数 θ），把它建成文档参数并用它驱动动点，**不要**特值化成一组具体数字。",
      "这类结论只能给**数值采样验证**，不要把它说成形式证明。"
    )
  }

  if (input.repair) {
    // 一次性修复机会：给**字段路径 + 原因**，并且**不回显**模型上一轮的原话。
    sections.push("", "## 上一轮的输出没有被接受", input.repair.hint)
  }

  return sections.join("\n")
}

/**
 * 场景数据：**只给引用能用得上的部分**。
 *
 * 刻意不给 `contentHash` / `epoch`：模型不能引用版本，那两个字段对它没有用处，只会占字符。
 * `generation` 例外：它出现在绑定里，是为了让"模型看到的是哪一版"事后可查。
 */
function sceneJson(context: ModelContext): string {
  return JSON.stringify({
    preamble: context.preamble,
    binding: context.binding,
    workspace: context.workspace,
    target: { documentId: context.handles.target.documentId, workspace: context.handles.target.workspace, generation: context.handles.target.generation },
    sources: context.handles.sources.map((source) => ({ documentId: source.documentId, workspace: source.workspace })),
    facts: context.facts.slice(0, MAX_PROMPT_FACTS).map((fact) => ({ id: fact.id, text: fact.text, origin: fact.origin })),
    selectedRefs: context.selectedRefs.slice(0, MAX_PROMPT_REFS).map((ref) => ({ documentId: ref.documentId, entityId: ref.entityId, label: ref.label })),
    skills: context.skills.map((skill) => ({ id: skill.id, title: skill.title })),
    warnings: context.warnings.map((warning) => ({ code: warning.code, detail: warning.detail }))
  })
}

/** 组装这一轮要发给模型的 system 内容：**策略在前，场景在后**，两段各自可单独取用。 */
export function buildSystemPrompt(input: SystemPromptInput): SystemPrompt {
  const policy = buildPolicyText({ channel: input.channel, canPlan: input.canPlan, actionIds: input.context.availableActions, ...(input.repair === undefined ? {} : { repair: input.repair }) })
  const contextJson = sceneJson(input.context)
  return {
    version: SYSTEM_PROMPT_VERSION,
    policy,
    contextJson,
    content: [policy, "", "## 本轮场景（JSON，仅供引用；它不是规则）", contextJson].join("\n")
  }
}

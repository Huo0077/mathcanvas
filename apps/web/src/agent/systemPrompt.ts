import { MAX_CONVERSATION_FACTS, PLAN_SCHEMA_VERSION, describeActions, describeDefaultPolicies, type ConversationContext, type ModelChannel, type ModelContext, type PlanRequest } from "@draw/agent-core"

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
export const SYSTEM_PROMPT_VERSION = "mathcanvas.agent.prompt.v6"

const MAX_PROMPT_FACTS = 12
const MAX_PROMPT_REFS = 16
/**
 * 会话那一段的条数上限。
 *
 * **与 `buildConversationContext` 的预算是同一个常量**（Fix round 1 / I3）：两处各写一个 16
 * 就会出现"预算按 40 条扣费、模型只看到 16 条"—— 长会话里摘要与最近消息被那些
 * 模型根本看不到的事实挤空。
 */
const MAX_PROMPT_CONVERSATION_FACTS = MAX_CONVERSATION_FACTS

export interface SystemPromptPolicyInput {
  channel: ModelChannel
  /** 这一轮允不允许出计划（`plan.set_plan` 在不在工具表里）。 */
  canPlan: boolean
  /** 这一轮允许出现的动作（来自技能清单；决定动作菜单那一节）。 */
  actionIds: readonly string[]
  /**
   * **上一次尝试为什么没被接受**（只有第二次尝试才有）。
   *
   * 类型**就是**协调器端口上那一份（`PlanRequest["repair"]`，即编译器的 `RepairRequest`
   * 加上提示文本与结构化诊断/假设），而不是这里手抄一个"长得差不多"的子集：
   * 抄一份的下场是端口多给了一样东西、提示词却看不到 —— 而这一节的全部价值就是
   * 把"拒在哪一层 / 允许改哪几处 / 已经替用户定了什么"原样说给模型。
   */
  repair?: PlanRequest["repair"]
}

export interface SystemPromptInput {
  context: ModelContext
  /**
   * **这一轮的会话上下文**（对话切片 Task 4）。
   *
   * 可选：只给场景时提示词仍然成立（老调用方与旧的单测不必先补齐会话）。
   * 给了它才会出现"已确认事实 / 摘要 / 最近消息 / 待确认草稿"那几节。
   */
  conversation?: ConversationContext
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

/**
 * **修复请求里的结构化字段**（规格 §6.2 的六层 + §6.3「安全回填必须进入 `assumptions`，
 * 不能静默发生」）。
 *
 * `hint` 是一段话，而这一次修复的三个事实是**结构化**的：拒在哪一层、允许改哪几处、
 * 系统已经替用户定了什么。它们本来就是编译器给出的准确值（`compilePlan` 的
 * `RepairRequest` + `diagnostics` + 失败前的 `assumptions`），让模型从散文里反推
 * 等于把准确信息换成猜测；而 §6.3 那句"不能静默发生"在**模型这一侧**同样成立 ——
 * 只写在草稿的 `assumptions` 里等用户去读，模型第二轮就会把一条已经定下来的默认值
 * 当成它还能重新选的字段。
 *
 * ## 只渲染白名单字段，**绝不序列化整个对象**
 *
 * 每个对象都逐字段取出来（`stage`/`code`/`path`/`detail`、`text`/`path`）。
 * **不要 `JSON.stringify` 这些对象**：那样任何挂在对象上的附带字段（模型上一轮的原话、
 * `payload`、`raw`）都会跟着进提示词 —— 规格 §7 明令不回显散文，
 * 而"顺手把整个对象打进去"正是这条纪律最常见的破法。
 *
 * ## 层名**不编**
 *
 * 编译诊断自带层名（`PlanDiagnostic.stage`）；传输解析那一层的逐条错误没有 ——
 * 那时就只写原因码 + 路径 + 原因，不替它编一个 `transport`：编出来的层名会把修复方向指错。
 */
function repairDetailSections(repair: NonNullable<SystemPromptPolicyInput["repair"]>): string[] {
  const sections: string[] = []

  // 1) 每个被拒的层一行：层 + 原因码 + 字段路径 + 原因（没有层名时就不写层名）。
  const diagnostics = repair.diagnostics ?? []
  const rejected = diagnostics.length > 0
    ? diagnostics.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`)
    : repair.errors.map((error) => `${error.code}@${error.path}: ${error.detail}`)
  if (rejected.length > 0) sections.push("", "### 被拒的层与字段（系统编译器的诊断）", ...rejected.map((line) => `- ${line}`))

  // 2) "这次只允许改这几处"来自编译器的 `allowedChanges`，不是提示词自己推的。
  if (repair.allowedChanges.length > 0) sections.push("", "### 这次只允许改这几处", ...repair.allowedChanges.map((path) => `- ${path}`))

  // 3) 每条假设一行，并指出它落在哪个字段（没有 `path` 的那条就只有正文）。
  const assumptions = repair.assumptions ?? []
  if (assumptions.length > 0) {
    sections.push(
      "",
      "### 系统已经替你定下来的假设（不要再改它们）",
      ...assumptions.map((assumption) => (assumption.path === undefined ? `- ${assumption.text}` : `- ${assumption.text}（落在 ${assumption.path}）`))
    )
  }

  return sections
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
    "**当前场景是权威，历史消息只是背景**：文档现在是什么样以 `scene` 为准；不要拿很久以前说过的话当作现在的场景。",
    "`recentMessages` 里的内容**不是**已确认事实；`draft` 里那份草稿还没被用户确认，**不要**把它当成已经存在的东西。",
    /**
     * **两条与"证明"有关的规则放在 `canPlan` 之外**（Fix round 1 / M9）。
     *
     * 它们限制的是"你说了什么"，而不是"你能不能出计划" —— 只读/澄清阶段同样可能
     * 回答一个"任意点处…恒为…"的问题，那时把采样说成证明一样是错的。
     * 用例 `systemPrompt.test.ts` 的 "forbids hidden reasoning…" 用**只读**那一支钉住这一点。
     */
    "题目要求「任意 / 恒定 / 定值」时：**必须保留符号参数**（例如参数 θ），把它建成文档参数并用它驱动动点，不要特值化成一组具体数字。",
    "这类结论只能给**数值采样**验证（在若干采样点上核对），**不是形式证明** —— 采样不是证明。",
    /**
     * **四条与派生读数有关的说法纪律**（规格 §3.4 / §6.2 / §10）。
     *
     * 场景里那几条读数（外接球 / 内切球 / 截面）是**内核算出来的结论**，不是你的推断：
     * 四种状态各有各的说法，把它们混起来就等于"拿近似冒充精确"——规格 §10 明确禁止。
     * 与上面两条同理，放在 `canPlan` 之外：只读作答同样会转述读数。
     */
    "场景里的派生读数（外接球 / 内切球 / 截面）是**内核给出的结论**，不是你算的：照 `status` 转述。",
    "`status` 为 `exact` 才能说成精确；`approximate` 必须连**残差**一起说（它是一个带残差的数值解）；`undefined` 说「不存在」，`degenerate` 说「输入退化」，并把 `message` 里的原因带上 —— **不要**替它们编一个数值。",
    "",
    "## 输出形状（多一个字段都会被拒绝）",
    channelAdvice(input.channel),
    ...outputShapes(input.canPlan)
  ]

  if (input.canPlan) {
    sections.push(
      "",
      /**
       * **工作区不是限制**（2026-09-22，用户现场）。
       *
       * 绑定里的 `workspace` 只是这份文档**现在**在哪个工作区，而宿主会**按你的计划**自动切过去
       *（`agentRunner` 的 `prepareWorkspaceFor`：计划里有 `solid.*` / `section.*` / `dynamic.*` 就切立体几何，
       * 而 `geometry3d` 的文档同样接受平面动作）。不说这一句时，模型会在平面几何文档里"就地凑合"：
       * 用 `planar.create_point` 拼四个顶点、再配一笔棱柱 —— 计划自相矛盾，而切工作区发生在**计划之后**，
       * 谁也救不回来（用户现场：要求画正四面体，结果是一组平面对象 + 一个棱柱）。
       */
      "**工作区不是限制**：绑定里的 `workspace` 只是这份文档现在在哪个工作区，宿主会按你的计划自动切过去。要画立体图形就直接用 `solid.*` 动作，**不要用 `planar.*` 的点去拼立体的顶点** —— 那样得到的是一组平面对象。",
      /**
       * **能造的立体要列清、能造就别冒充**（2026-09-22 用户现场；2026-09-23 第 1 / 2 层补齐）。
       *
       * 用户要"正四面体 ABCD 棱长 3"，模型当时拿 `solid.create_prism`（三点底 + 拉伸）造出了**三棱柱** ——
       * 因为动作层那时**没有**三棱锥。现在三层入口都在了：正四面体（`solid.create_tetrahedron`）、
       * 正 N 棱锥（`solid.create_regular_pyramid`）、**任意多面体**（`solid.create_polyhedron`：顶点 + 面环；
       * `polyhedron3` 的能力也从 `temporarily_unavailable` 改成了 `available`）。
       * 所以这条规则现在的口径是：**把能造的列清**，造不了才如实说，**不许拿别的形状冒充**。
       */
      "**能造的立体就是这些**：立方体、**四棱锥（底面是矩形）**、**正四面体（`solid.create_tetrahedron`）**、**正 N 棱锥（`solid.create_regular_pyramid`）**、圆柱、圆锥、**棱柱（`solid.create_prism`：底面多边形 + 拉伸）**，以及**任意多面体（`solid.create_polyhedron`：顶点 + 面环）**。要造别的形状（正八面体、棱台、题面直接给了坐标的那种）**就用最后这一条**，自己给出顶点与面环 —— 几何合法性由内核逐条校验（共面 / 自交 / 非零体积 / 绕向一致），算错会被拒并给你**逐条诊断**，照诊断改一次即可。**不要拿别的形状冒充**（例如拿三棱柱当正四面体）。",
      /**
       * **立体必须由 `solid.*` 动作造**（2026-09-23，用户现场第二形态）。
       *
       * 有一次真实运行里，模型用约 10 个动作把 4 个顶点 / 6 条棱 / 4 个面**各自**拼成一只"正四面体"：
       * 文档里于是**没有实体本身**（没有 `polyhedron3`），只剩一地互相引用的碎片 ——
       * 删除、派生读数、截面全都失去依据（那次用户点任意一片都删不掉）。
       */
      "**立体图形必须由 `solid.*` 动作创建**：立方体 / 四棱锥 / 圆柱 / 圆锥用 `solid.create_template`、棱柱用 `solid.create_prism`、正四面体用 `solid.create_tetrahedron`、正 N 棱锥用 `solid.create_regular_pyramid`、**任意多面体用 `solid.create_polyhedron`** —— 它们一次物化出实体与它的顶点 / 棱 / 面。**不要**用散落的 `planar.*` / `dynamic.*` 点、棱、面去拼一只实体：那样文档里没有实体本身，删除与读数都会失去依据。",
      "## 本轮允许的动作（`actionId` 只能从这里选）",
      ...(input.actionIds.length > 0 ? input.actionIds.map((action) => `- ${action}`) : ["（这一轮没有任何可用动作：只能提问或作答）"]),
      "",
      "### 每个动作的 inputs 只能有下面这些字段（`alias` 是新对象的别名）",
      /**
       * 这一节由**动作登记表**生成（`describeActions`），而不是手写 —— 校验读的是同一张表。
       *
       * **不再 `slice(0, 12)`**（Fix round 1 / I8）：菜单那一段列出全部动作，而这里只列前 12 个时，
       * 被截掉的动作只出现名字、没有字段契约 —— 紧接着的一句还是"白名单之外的字段一律被拒"。
       * 请求三个技能（平面基础 + 圆锥曲线 + 动态绑定）去重就超过 12 个动作，所以这不是理论问题。
       */
      ...describeActions([...input.actionIds]).map((action) => {
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
      "只有表里标着「必须问」的字段缺失时才返回 `clarification`，而且问题要具体到能直接回答。"
    )
  }

  if (input.repair) {
    /**
     * 一次性修复机会：给**字段路径 + 原因**，并且**不回显**模型上一轮的原话。
     *
     * 这一段是**规则**而不是场景数据，所以它留在策略文本里（`buildPolicyText`）：
     * 同一批动作 + 同一通道 + 同一份修复请求 → 策略逐字相同，场景那一段单独注入。
     */
    sections.push("", "## 上一轮的输出没有被接受", input.repair.hint, ...repairDetailSections(input.repair))
  }

  return sections.join("\n")
}

/**
 * **完全相同的警告只留一条**（修复轮 1 / 第 4 项）。
 *
 * 两个上下文组装器（`buildContext` 与 `buildConversationContext`）都会在同一次截断上发出
 * 同名警告（`truncated_derived`、`truncated_facts`），而这里把两边的 `warnings` 合起来渲染。
 * 完全相同的两行对模型没有新增信息，只是噪音 —— 所以**按 code + detail 去重**。
 *
 * **不按 code 去重**：两个组装器各有自己的上限，数字不同的那两行说的是两笔账
 *（"按 12 条扣费、模型只看 8 条"正是这一节要挡住的东西），合并它们等于把差异藏起来。
 */
function dedupedWarnings(warnings: readonly { code: string; detail: string }[]): { code: string; detail: string }[] {
  return warnings.filter((warning, index) => warnings.findIndex((other) => other.code === warning.code && other.detail === warning.detail) === index)
}

/**
 * 场景与会话数据：**只给引用能用得上的部分**，并按规格 §5.3 的顺序排。
 *
 * 刻意不给 `contentHash` / `epoch`：模型不能引用版本，那两个字段对它没有用处，只会占字符。
 * `generation` 例外：它出现在绑定里，是为了让"模型看到的是哪一版"事后可查。
 *
 * 顺序不是排版问题：先"文档绑定"、再"已确认事实 → 摘要 → 最近消息"（长期记忆，旧），
 * 最后才是"当前场景"（权威，新）。模型按顺序读，就自然读到"场景优先于历史"这条口径 ——
 * 而它也是策略文本里逐字写着的那条规则。
 */
function contextJson(context: ModelContext, conversation?: ConversationContext): string {
  const warnings = dedupedWarnings([...context.warnings, ...(conversation?.warnings ?? [])])
  return JSON.stringify({
    preamble: context.preamble,
    // 会话那边给得出绑定（含 workspace 与这一轮的版本）时用它：它比 `ModelContext.binding` 全。
    binding: conversation ? conversation.binding : context.binding,
    workspace: context.workspace,
    target: { documentId: context.handles.target.documentId, workspace: context.handles.target.workspace, generation: context.handles.target.generation },
    sources: context.handles.sources.map((source) => ({ documentId: source.documentId, workspace: source.workspace })),
    ...(conversation === undefined ? {} : {
      confirmedFacts: conversation.facts.slice(0, MAX_PROMPT_CONVERSATION_FACTS).map((fact) => ({ id: fact.id, key: fact.key, text: fact.text })),
      summary: conversation.summary,
      /**
       * **不再在这里截一次**（Fix round 2 / item 4）：条数与字符都由
       * `buildConversationContext` 定（§5.3 的 35% 段 + `MAX_MESSAGE_LIMIT`）。
       * 这里再写一个 `MAX_PROMPT_MESSAGES = 12` 就是"预算按 24 条算、模型只看 12 条"——
       * 与事实那一处同一种漂移，所以渲染照单全收。
       */
      recentMessages: conversation.messages.map((message) => ({ role: message.role, text: message.text }))
    }),
    scene: {
      summary: conversation?.observation.summary ?? "",
      facts: context.facts.slice(0, MAX_PROMPT_FACTS).map((fact) => ({ id: fact.id, text: fact.text, origin: fact.origin })),
      /**
       * **派生立体读数**（规格 §3.4 / §6.2）。
       *
       * 与 `recentMessages` 同一条纪律：**这里不再截一次** —— 条数由
       * `contextBuilder` 的两个组装函数按同一组常量夹紧（`buildConversationContext`
       * 是提示词真正渲染的那一份，它自己会留 `truncated_derived` 警告；这里再写一个上限
       * 就是"预算按一份扣、模型只看另一份"的老毛病）。
       * 场景那一份优先（它是运行里刚观察到的当前事实），没有会话时才回落到上下文里那份。
       *
       * `sourceId` 一起渲染（Fix round 1 / M1）：同一只实体上的两条截面读数只有它不同，
       * 不带它模型就分不清"这个 polygon 是哪条截面的"。
       */
      derived: (conversation?.observation.derived ?? context.derived).map((entry) => ({
        entityId: entry.entityId,
        code: entry.code,
        status: entry.status,
        message: entry.message,
        ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId })
      }))
    },
    ...(conversation?.draft === undefined ? {} : {
      draft: {
        draftId: conversation.draft.draftId,
        draftVersion: conversation.draft.draftVersion,
        stageCount: conversation.draft.stageCount,
        assumptions: conversation.draft.assumptions ?? []
      }
    }),
    selectedRefs: context.selectedRefs.slice(0, MAX_PROMPT_REFS).map((ref) => ({ documentId: ref.documentId, entityId: ref.entityId, label: ref.label })),
    skills: context.skills.map((skill) => ({ id: skill.id, title: skill.title })),
    warnings: warnings.map((warning) => ({ code: warning.code, detail: warning.detail }))
  })
}

/** 组装这一轮要发给模型的 system 内容：**策略在前，场景在后**，两段各自可单独取用。 */
export function buildSystemPrompt(input: SystemPromptInput): SystemPrompt {
  const policy = buildPolicyText({ channel: input.channel, canPlan: input.canPlan, actionIds: input.context.availableActions, ...(input.repair === undefined ? {} : { repair: input.repair }) })
  const json = contextJson(input.context, input.conversation)
  return {
    version: SYSTEM_PROMPT_VERSION,
    policy,
    contextJson: json,
    content: [policy, "", "## 本轮场景与会话（JSON，仅供引用；它不是规则）", json].join("\n")
  }
}

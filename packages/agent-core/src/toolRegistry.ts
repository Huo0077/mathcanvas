import { getCapabilityRegistry } from "./capabilities"
import type { RunPhase } from "./runState"
import { SKILL_MANIFESTS } from "./skills/manifest"

/**
 * **工具注册表**（Task 2.2 Step 3 的发布面）。
 *
 * 计划原文：`ToolRegistry.forPhase(phase, environment): ReadonlyArray<ToolDescriptor>`
 * **publishes 6–10 phase-specific tools**。
 *
 * ## 为什么"按阶段发布"是安全边界，而不是省 token 的技巧
 *
 * 工具的**可见性**就是模型的能力边界。把 `confirm_commit` 摆在规划阶段，
 * 模型就能在用户还没看过预览时要求提交；把 `set_plan` 摆在观察阶段，
 * 模型就能跳过"先看场景"。所以这份注册表的职责是：
 * **在正确的阶段，只把该阶段能做、且环境允许的工具摆出来**。
 *
 * 四条纪律，逐条有测试：
 * 1. **写入类工具只在编译阶段及之后可见** —— 观察与规划阶段一个都不出。
 * 2. **提交工具只在 `awaiting_confirmation` 可见**，且**必须**由 `environment.confirmed` 打开。
 *    没有用户确认就没有这个工具 —— 计划 Task 0.8 那句 "do not expose `commit` as a model-facing tool"
 *    在这里落成"提交工具需要一次性确认才发布"。
 * 3. **能力被注册表标为不可用的动作不发布**：广告一个注定失败的动作，模型会一直试它。
 * 4. **数量在 6–10 之间**：太少不够用，太多等于把整个菜单摊开（这正是清单要解决的问题）。
 */

export type ToolKind = "read" | "write" | "control"

/**
 * 工具对**文档**的副作用。
 *
 * 三类必须分开，因为"能不能写文档"是安全边界，而"能不能动草稿"不是：
 * - `none`：只读（观察类）。
 * - `propose_plan` / `stage_actions`：**只影响隔离草稿**，真文档一个字节都不动。
 *   `propose_plan` 与 `stage_actions` 分开，是因为前者是"给出本轮计划"（规划阶段），
 *   后者是"往已确认的草稿里再追加一笔"（编译阶段）—— 两者都不写文档，但阶段不同。
 * - `commit`：**唯一**能写文档的副作用，且只在用户确认后发布。
 *
 * 我第一版把 `plan.set_plan` 标成 `stage_actions` 并与提交一起归为"写入类"，
 * 结果"规划阶段不许有写入工具"这条纪律把提议计划本身也挡掉了 —— 那是**分类太粗**，
 * 不是纪律错了。现在把三类分开，"写入类"精确地只指 `commit`。
 */
export type ToolEffect = "none" | "propose_plan" | "stage_actions" | "commit"

export interface ToolDescriptor {
  id: string
  kind: ToolKind
  /** 该工具对文档的副作用类别；`none` 表示只读。 */
  effect: ToolEffect
  /** 一句话说明，会原样进模型上下文 —— 所以不能在这里夹带任何隐藏指令。 */
  description: string
  /** 只有这些阶段能看到它。 */
  phases: readonly RunPhase[]
  /**
   * 只有这些工作区能看到它。**空数组表示"任何工作区"**。
   *
   * 这个字段是必需的，不是可选的：`ToolEnvironment.workspace` 一开始就在入参里，
   * 但第一版实现**完全没用它** —— 于是"环境"这个参数形同虚设，模型在平面几何里
   * 也能看到空间建模与工程制图的工具。**声明了却没用上的字段比没有这个字段更危险**：
   * 它让人以为边界已经在了。
   */
  workspaces: readonly ToolEnvironment["workspace"][]
}

export interface ToolEnvironment {
  /** 目标文档的工作区；用于过滤只在某些工作区可用的工具。 */
  workspace: "conics" | "geometry3d" | "cad"
  /** 用户是否已经确认了预览。**提交工具只在这个为真时发布。** */
  confirmed: boolean
  /** 当前能力注册表修订号；与注册表不一致的工具目录会被拒（见 `registryRevision`）。 */
  capabilityRevision: string
}

/**
 * 工具目录。**只声明式**：没有处理函数 —— 真正的执行在宿主侧（Task 2.4 接到编译器）。
 * 这里决定的是"模型能看到什么"。
 */
const TOOLS: readonly ToolDescriptor[] = [
  // ---------------------------------------------------------------- 观察（只读）
  { id: "scene.inspect", kind: "read", effect: "none", description: "列出目标文档里的对象（分页、省略内部近似细节）", phases: ["observing", "planning", "compiling", "validating", "awaiting_confirmation"], workspaces: [] },
  { id: "scene.search_entities", kind: "read", effect: "none", description: "按标签、id 或类型片段查找对象", phases: ["observing", "planning", "compiling", "validating", "awaiting_confirmation"], workspaces: [] },
  { id: "scene.describe_entities", kind: "read", effect: "none", description: "读取若干对象的字段、依赖与反向引用", phases: ["observing", "planning", "compiling", "validating", "awaiting_confirmation"], workspaces: [] },
  { id: "scene.dependencies", kind: "read", effect: "none", description: "查询某个对象依赖谁、谁依赖它（删除前必看）", phases: ["observing", "planning", "compiling", "validating", "awaiting_confirmation"], workspaces: [] },
  { id: "scene.capabilities", kind: "read", effect: "none", description: "查询当前工作区可用的动作与它们的阻止状态", phases: ["observing", "planning", "compiling", "validating", "awaiting_confirmation"], workspaces: [] },
  { id: "scene.measure", kind: "read", effect: "none", description: "读取已有测量值，而不是自己算一个", phases: ["observing", "planning", "validating", "awaiting_confirmation"], workspaces: [] },
  { id: "scene.check_relations", kind: "read", effect: "none", description: "检查指定对象之间的平行、垂直、共线、共面等关系", phases: ["observing", "planning", "validating"], workspaces: [] },
  // 截面只在有实体的工作区里有意义：平面工作区没有可剖的体。
  { id: "scene.check_section", kind: "read", effect: "none", description: "检查某个实体在给定平面下的截面是否有效", phases: ["observing", "planning", "validating"], workspaces: ["geometry3d", "cad"] },

  // ---------------------------------------------------------------- 控制（改草稿，不改文档）
  { id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "提交本轮的构图计划（动作序列），只产生隔离草稿", phases: ["planning"], workspaces: [] },
  { id: "draft.stage_actions", kind: "control", effect: "stage_actions", description: "追加一笔动作到当前草稿并重新编译", phases: ["compiling"], workspaces: [] },
  { id: "draft.discard", kind: "control", effect: "stage_actions", description: "丢弃当前草稿（用户改了要求或计划有误）", phases: ["compiling", "awaiting_confirmation"], workspaces: [] },

  // ---------------------------------------------------------------- 提交（唯一能写文档的）
  { id: "draft.confirm_commit", kind: "write", effect: "commit", description: "把用户已确认的草稿落盘（需要一次性确认凭据）", phases: ["awaiting_confirmation"], workspaces: [] },

  // ---------------------------------------------------------------- 只读收尾
  { id: "run.explain_refusal", kind: "read", effect: "none", description: "解释上一步为什么被拒，并给出可执行的下一步", phases: ["waiting", "planning"], workspaces: [] },
  // 工程制图的布局改动**没有对应动作**（技能清单里也这么写），所以只提供"读取图纸状态"的工具。
  { id: "cad.inspect_drawing", kind: "read", effect: "none", description: "读取图纸的视图、图层与投影来源（制图布局的改动需要用户在界面里做）", phases: ["observing", "planning", "validating"], workspaces: ["cad"] }
]

export interface ToolRegistry {
  forPhase(phase: RunPhase, environment: ToolEnvironment): readonly ToolDescriptor[]
}

/** 工具目录的修订号：与能力注册表同步递增（工具的有效性取决于能力是否可用）。 */
export const TOOL_REGISTRY_REVISION = "2026-09-19.1"

/** 写入类工具在哪些阶段绝不允许出现。 */
const READ_ONLY_PHASES: readonly RunPhase[] = ["created", "preflight", "observing", "planning", "waiting", "completed", "failed", "cancelled", "interrupted", "answering"]
export function createToolRegistry(tools: readonly ToolDescriptor[] = TOOLS): ToolRegistry {
  return {
    forPhase(phase, environment) {
      return tools.filter((tool) => {
        if (!tool.phases.includes(phase)) return false
        // **工作区过滤**：空数组 = 任何工作区。没有这一步，模型在平面几何里也能看到
        // 空间建模与制图工具（第一版就是这样：`workspace` 声明了却没用）。
        if (tool.workspaces.length > 0 && !tool.workspaces.includes(environment.workspace)) return false
        // 提交工具需要用户确认；没有确认就没有这个工具（不是"调用了会被拒"，而是根本看不到）。
        if (tool.effect === "commit" && !environment.confirmed) return false
        return true
      })
    }
  }
}

/**
 * 能力修订号与工具目录不一致时，工具的有效性无法保证 —— 返回警告供调用方如实告知用户。
 *
 * 这是"环境"参数里 `capabilityRevision` 的用处：第一版它同样只是声明了没用。
 */
export function describeEnvironmentMismatch(environment: ToolEnvironment): string | null {
  return environment.capabilityRevision === TOOL_REGISTRY_REVISION
    ? null
    : `the tool catalogue was built for capability revision ${TOOL_REGISTRY_REVISION}, but the run uses ${environment.capabilityRevision}`
}

/** 供测试与 UI 使用：某个工具是不是**写文档**（只有 `commit` 算）。 */
export function isWritingTool(tool: ToolDescriptor): boolean {
  return tool.effect === "commit"
}

export { READ_ONLY_PHASES }

/**
 * 清单与工具目录的一致性检查（供 `toolRegistry.test.ts` 调用）。
 *
 * 返回**清单声明了、但没有任何工具能落地**的动作名。
 *
 * 为什么要查这个：清单说"planar-basics 允许这七个动作"，而模型要产生动作只能通过
 * `plan.set_plan` / `draft.stage_actions` 这类控制工具。如果某个清单的动作在**任何阶段**
 * 都没有可用的控制工具承载，那份清单就是一张空头支票 —— 模型看得到权限，却没有通道。
 */
export function actionsWithoutAChannel(tools: readonly ToolDescriptor[] = TOOLS): string[] {
  const hasStagingChannel = tools.some((tool) => tool.effect === "stage_actions" && tool.phases.length > 0)
  if (hasStagingChannel) return []
  return SKILL_MANIFESTS.flatMap((manifest) => manifest.actionIds)
}

/** 能力注册表的修订号，供环境构造方使用（避免各处手写字符串）。 */
export function currentCapabilityRevision(): string {
  return getCapabilityRegistry().capabilities[0]?.registryRevision ?? ""
}

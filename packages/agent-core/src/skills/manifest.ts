import { DRAFT_ACTION_IDS, type DraftActionIdName } from "../actionIds"

/**
 * **技能清单**（Task 2.2 Step 2）。
 *
 * 计划要求九个初始清单（平面基础、圆锥曲线/切线、函数、动态绑定、空间建模、截面/相交、
 * 工程制图、图像证据、安全恢复），每个清单要写明 **action IDs、limits、一个成功案例、一个拒绝案例**。
 *
 * ## 为什么清单要单独存在，而不是让模型自由发挥
 *
 * 能力注册表说的是"系统能做什么"，清单说的是"**这次运行允许模型用哪一小撮**"。
 * 两者分开的理由是上下文预算与犯错面：一个 20 个动作的菜单会让模型在无关动作上乱试，
 * 而一份清单可以把当前任务真正需要的 2–5 个动作摆到面前，并**附带这个任务的边界**。
 *
 * ## 三条纪律
 *
 * 1. **actionIds 必须真实存在**：类型上限定为 `DraftActionIdName`（来自与动作层双向钉住的规范清单），
 *    所以写错名字编译不过。这挡住了"清单声明了、schema 不认、编译器也没有"的三方漂移。
 * 2. **声明的动作必须可用**：`catalog.test.ts` 会拿能力注册表核对——清单里出现
 *    `unsupported` / `legacy_readonly` / `temporarily_unavailable` 的动作即为缺陷。
 * 3. **只加载签名入包的内容**：清单是**声明式**的（不含可执行代码），`SkillCatalog.load`
 *    只返回经过哈希校验的副本。计划原文是 "only loads packaged, hash-verified declarative content"，
 *    所以"清单里能放什么"本身就是安全边界：这里**只有** id / 标题 / 描述 / 动作名 / 数字上限。
 */

export interface SkillLimits {
  /** 一次暂存里最多几个动作。 */
  actionsPerStage: number
  /** 一次运行里最多几个动作。 */
  actionsPerRun: number
}

export interface SkillTestCase {
  /** 用户会怎么说（作为**示例**，不是要匹配的模板）。 */
  prompt: string
  /** 期望发生什么（成功案例说结果，拒绝案例说为什么不许做）。 */
  expectation: string
}

export interface SkillManifest {
  id: string
  title: string
  /** 给模型看的一句话说明：这个技能解决什么、边界在哪。 */
  summary: string
  actionIds: readonly DraftActionIdName[]
  limits: SkillLimits
  successCase: SkillTestCase
  refusalCase: SkillTestCase
}

/** 清单一律只声明**够用**的上限；整次运行的总额由协调器的预算再收一次。 */
const DEFAULT_LIMITS: SkillLimits = { actionsPerStage: 8, actionsPerRun: 32 }

export const SKILL_MANIFESTS: readonly SkillManifest[] = [
  {
    id: "planar-basics",
    title: "平面基础作图",
    summary: "在平面几何工作区建点、线、线段、射线、折线、圆与圆弧。所有新对象都要一个草稿内别名，后续动作只能通过别名或已确认引用指向它。",
    actionIds: ["planar.create_point", "planar.create_line", "planar.create_segment", "planar.create_ray", "planar.create_polyline", "planar.create_circle", "planar.create_arc"],
    limits: DEFAULT_LIMITS,
    successCase: { prompt: "过 A、B 两点作一条直线", expectation: "产生两笔创建动作：直线引用已确认的点 A 与 B（不存在时先建点）" },
    refusalCase: { prompt: "画一条长度是 -3 的线段", expectation: "拒绝：坐标与尺度的语义校验在动作编译器里，负长度不会变成一条反向线段" }
  },
  {
    id: "conics-tangents",
    title: "圆锥曲线与切线",
    summary: "创建椭圆、抛物线、双曲线，并在曲线上作切线。切点可以按曲线参数给定，也可以跟随一个动点。",
    actionIds: ["planar.create_circle", "planar.create_polyline", "planar.create_conic", "function.create_tangent", "parameter.create", "dynamic.create_bound_point"],
    limits: DEFAULT_LIMITS,
    successCase: { prompt: "在抛物线 y² = 4x 上取参数 1 的点作切线", expectation: "一笔 function.create_tangent，anchor 用 parameter 形式" },
    refusalCase: { prompt: "给这条切线再画一条和它重合的切线", expectation: "拒绝：退化情形由编译器判定，不会产生两条重合的切线对象" }
  },
  {
    id: "functions",
    title: "函数与分析",
    summary: "创建函数图像，并求它的导数、切线或定积分。定义域必须有界才允许积分。参数（含符号参数）可以新建与修改。",
    actionIds: ["function.analyze", "function.create_tangent", "parameter.create", "parameter.set", "parameter.set_expression"],
    limits: DEFAULT_LIMITS,
    successCase: { prompt: "求 f(x)=x² 在 [-1,1] 上的定积分", expectation: "一笔 function.analyze，analysis 为 integral" },
    refusalCase: { prompt: "对一条不是函数的对象求导", expectation: "拒绝：source 必须是函数对象，编译器会报 source_not_function" }
  },
  {
    id: "dynamic-bindings",
    title: "动态绑定与轨迹",
    summary: "新建或绑定动点：点可以绑到曲线、棱、面、实体内部，由自然参数（或文档参数）驱动；也可以让圆半径由另一个点决定，或追踪动点生成轨迹。",
    actionIds: ["dynamic.bind_point", "dynamic.create_bound_point", "dynamic.bind_curve", "dynamic.create_locus", "dynamic.set_radius_rule"],
    limits: DEFAULT_LIMITS,
    successCase: { prompt: "让 P 沿这条圆滑动，并追踪它的轨迹", expectation: "先 dynamic.bind_curve 给定参数，再 dynamic.create_locus 引用该点" },
    refusalCase: { prompt: "把点绑到另一个文档里的曲线", expectation: "拒绝：绑定目标必须在目标文档内，跨文档引用报 cross_document_reference" }
  },
  {
    id: "spatial-modeling",
    title: "空间建模",
    summary: "在立体几何工作区创建立方体、棱锥、圆柱、圆锥四种模板实体，或用底面多边形 + 拉伸向量构造棱柱（直棱柱与斜棱柱同一套）。实体都会物化出顶点、棱、面；棱柱的侧面由内核按底面与向量生成，不能自己拼。",
    actionIds: ["solid.create_template", "solid.create_prism"],
    limits: { actionsPerStage: 4, actionsPerRun: 16 },
    successCase: { prompt: "画一个棱长 4 的立方体，中心在原点", expectation: "一笔 solid.create_template，template 为 cube，给 origin 与 size" },
    refusalCase: { prompt: "画一个棱长 0 的立方体", expectation: "拒绝：尺寸必须为正，编译器不接受退化实体" }
  },
  {
    id: "sections-intersections",
    title: "截面与相交",
    summary: "用一个平面剖切实体得到截面（可指定平面法向与常数），并把截面轮廓物化成真实图元。",
    actionIds: ["section.create", "section.materialize"],
    limits: DEFAULT_LIMITS,
    successCase: { prompt: "用 z = 0 的平面剖开这个立方体", expectation: "一笔 section.create，plane 给 normal 与 constant" },
    refusalCase: { prompt: "给一个平面对象建截面", expectation: "拒绝：截面来源必须是实体（有多面体拓扑），平面没有可剖的体" }
  },
  {
    id: "engineering-drawing",
    title: "工程制图（只读）",
    summary: "读取图纸的视图、图层与投影来源，回答「图里有什么、某个来源被哪些视图引用」。**这个技能不改图**：图纸布局的改动需要用户在界面里做。",
    actionIds: [],
    limits: { actionsPerStage: 0, actionsPerRun: 0 },
    successCase: { prompt: "这张图纸的四个视图分别投影了什么", expectation: "用观察工具回答，不产生任何动作" },
    refusalCase: { prompt: "帮我把主视图隐藏掉", expectation: "拒绝并说明：制图布局的改动没有对应的动作，请用户在图纸树里操作" }
  },
  {
    id: "image-evidence",
    title: "图像证据（待确认）",
    summary: "读取题图后给出**待确认**的事实清单（长度、直角、平行等），由用户逐条确认后才可能进入构图。视觉推断本身不是几何事实。",
    actionIds: [],
    limits: { actionsPerStage: 0, actionsPerRun: 0 },
    successCase: { prompt: "这张图里角 A 是直角吗", expectation: "给出「视觉上像直角，待确认」的证据条目，而不是直接建一个直角约束" },
    refusalCase: { prompt: "照这张图直接建出精确的立体模型", expectation: "拒绝：单张透视图不足以定出精确高度，需要先确认条件或明确接受示意模型" }
  },
  {
    id: "safe-recovery",
    title: "安全恢复",
    summary: "当上一轮没能完成时：说明卡在哪一步、给出可执行的下一步。删除与修改既有对象必须走 object 动作并遵守锁定与引用规则。",
    actionIds: ["object.delete_many", "object.update_inputs"],
    limits: DEFAULT_LIMITS,
    successCase: { prompt: "把刚才那两个多余的点删掉", expectation: "一笔 object.delete_many，targets 列出两个具体 id" },
    refusalCase: { prompt: "把这个被别的对象引用的点删掉", expectation: "拒绝并说明谁在引用它（object is referenced by another object），而不是级联删掉用户没点名的对象" }
  }
]

/**
 * 清单元数据。`capabilityRevision` 记下这份清单是照着哪一版能力注册表写的 ——
 * 注册表语义变化后，旧清单必须重新核对（测试会检查它等于当前修订号）。
 */
export const SKILL_CATALOGUE_REVISION = "2026-09-19.1"

/** 落单校验用的判据：清单只允许出现规范清单里的名字。 */
export function isKnownActionId(value: string): value is DraftActionIdName {
  return (DRAFT_ACTION_IDS as readonly string[]).includes(value)
}

/**
 * **动作名 → 它背后的能力描述符**。
 *
 * 能力注册表是按 `DomainOperation`（内核操作）编号的，而动作层是更上层的 `family.verb` 动作，
 * 两者不是同一套名字 —— 所以"清单里这个动作到底可不可用"必须靠这张显式的对应表来问，
 * 不能拿 actionId 去注册表里直接查（查不到不等于不可用，只是名字体系不同）。
 *
 * 表是 `Record<DraftActionIdName, string>`：**动作层新增一个动作而这里没登记就编译失败**，
 * 于是"清单声明了一个没人知道可不可用的动作"这种漂移进不来。
 * 每个动作背后的操作是否 `available`，则由 `catalog.test.ts` 对着注册表逐个核对。
 */
export const CAPABILITY_FOR_ACTION: Record<DraftActionIdName, string> = {
  "planar.create_point": "create-primitive",
  "planar.create_line": "create-primitive",
  "planar.create_segment": "create-primitive",
  "planar.create_ray": "create-primitive",
  "planar.create_polyline": "create-primitive",
  "planar.create_circle": "create-primitive",
  "planar.create_arc": "create-primitive",
  "planar.create_conic": "create-primitive",
  "solid.create_template": "create-primitive",
  "solid.create_prism": "create-primitive",
  "dynamic.bind_point": "create-primitive",
  "dynamic.create_bound_point": "create-primitive",
  "dynamic.bind_curve": "create-primitive",
  "dynamic.create_locus": "create-primitive",
  "dynamic.set_radius_rule": "modify-primitive",
  "function.create_tangent": "create-primitive",
  "function.analyze": "create-primitive",
  "section.create": "create-primitive",
  "section.materialize": "create-primitive",
  "object.delete_many": "batch-delete",
  "object.update_inputs": "modify-primitive",
  "parameter.create": "modify-primitive",
  "parameter.set": "modify-primitive",
  "parameter.set_expression": "modify-primitive"
}

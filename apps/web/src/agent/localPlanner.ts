import type { PlanEnvelope, PlannerPort } from "@draw/agent-core"
import { PLAN_SCHEMA_VERSION, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, DEFAULT_SOLID_SIZE, defaultPrismBasePolygon, cubeCenterFrom, cubeEdgeLengthFrom, parseShapeClause, roundFrustumPolyhedron, searchWitnessForPrompt } from "@draw/agent-core"

import { CONIC_ELLIPSE_PROMPT, FUNCTION_TANGENT_PROMPT, HYPERBOLA_PROMPT, PARABOLA_PROMPT, PLANAR_TRIANGLE_PROMPT, PYRAMID_CIRCUMSPHERE_PROMPT, PYRAMID_PROMPT, PYRAMID_UNVERIFIED_PROMPT, conicInvariantPlan, ellipsePlan, functionTangentPlan, hyperbolaPlan, obliquePrismSectionPlan, parabolaPlan, planarRightTrianglePlan, pyramidCircumspherePlan, pyramidPlan } from "./representativeFixtures"

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
  /** 固定代表题必须逐字匹配，不能把改了题设的请求套入旧坐标。 */
  exact?: string
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
  // A named dimension wins over numbers in coordinates or labels.
  const named = cubeEdgeLengthFrom(prompt)
  if (named !== null) return named
  const numbers = [...prompt.matchAll(/-?\d+(?:\.\d+)?/g)]
  // Multiple unnamed numbers are ambiguous; do not take a coordinate as a size.
  return numbers.length === 1 ? Number(numbers[0][0]) : fallback
}

const CUBE = (input: LocalIntentInput): PlanEnvelope => {
  const specifiesCenter = /\u4e2d\u5fc3/.test(input.prompt)
  const center = cubeCenterFrom(input.prompt)
  if (specifiesCenter && center === null) {
    return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "cube center is unclear", factIds: [], questions: ["Please specify the cube center as the origin or as coordinates (x,y,z)."] }
  }
  const origin = center === null
    ? { x: 0, y: 0, z: 0 }
    : { x: center.x - input.size / 2, y: center.y - input.size / 2, z: center.z - input.size / 2 }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `create a cube with edge length ${input.size}`,
    factIds: [],
    actions: [{
      actionId: "solid.create_template",
      actionKey: "cube",
      factIds: [],
      inputs: { alias: "cube", template: "cube", origin, size: { x: input.size, y: input.size, z: input.size } }
    }]
  }
}

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

/**
 * **球**：球心 + 半径（球体切片 Task 8 的端到端那一半）。
 *
 * 半径从用户原话里读第一个数字（"半径 5"），读不到取 `DEFAULT_SOLID_SIZE` —— 与立方体 / 正四面体
 * **同一口径**（默认值只有一处：`localPlanDefaults`）。球心放在原点。
 *
 * **触发词只认「球体」这个具体写法**：裸词「球」会命中分析题 ——
 * "求这个四面体的**外接球**半径并画出球"里既有"球"又要求读数，本地规划器若认裸词就会去
 * **新建一只球**而不是回答。这与 `LOCAL_INTENTS` 里"认正四面体、不认裸四面体"是同一条纪律。
 */
export const SPHERE_PROMPT = "画一个球体，半径 5"

const SPHERE = (input: LocalIntentInput): PlanEnvelope => {
  const radius = sizeFrom(input.prompt, DEFAULT_SOLID_SIZE)
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `创建一个半径 ${radius}、球心在原点的球`,
    factIds: [],
    actions: [{
      actionId: "solid.create_sphere",
      actionKey: "sphere",
      factIds: [],
      inputs: { alias: "sphere", center: { x: 0, y: 0, z: 0 }, radius }
    }]
  }
}

/**
 * **圆台**（S4.3）：题面点名上底半径、下底半径与高。
 *
 * 与**棱台**的区别是"没有点名顶点" —— 所以它的两个环由**内核的多边形近似**生成
 *（`roundFrustumPolyhedron`，与圆柱 / 圆锥同一套分段口径），再交给既有的 `solid.create_polyhedron`：
 * **不新增 DSL 图元**（设计里台体那一条写死的）。
 *
 * 假设里**如实写出这是近似、差多少**（设计 §S4.3 点名的"在文档与面板上声明是近似"）：
 * 光说"近似"没用，弦高误差才是用户能拿去判断"这张图够不够用"的那个数。
 */
export const ROUND_FRUSTUM_PROMPT = "画一个圆台，上底半径 1、下底半径 2、高 3"

const ROUND_FRUSTUM = (): PlanEnvelope => {
  const shape = roundFrustumPolyhedron({ radiusBottom: 2, radiusTop: 1, height: 3 })
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "作一个下底半径 2、上底半径 1、高 3 的圆台",
    factIds: [],
    assumptions: [
      `圆台用**正 ${shape.segments} 边形近似**（与圆柱 / 圆锥同一套分段口径）：两个底面是内接于圆的 ${shape.segments} 边形，侧面是 ${shape.segments} 个等腰梯形。`,
      `下底处弦高误差 ${shape.chordError.toPrecision(3)} —— 多边形的边到理想圆弧的最大距离。它是近似，不是那个真的圆台。`
    ],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "round-frustum",
      factIds: [],
      inputs: { alias: "round-frustum", vertices: shape.vertices, faces: shape.faces, label: "圆台（近似）" }
    }]
  }
}

/**
 * **斜棱柱**：底面多边形 + 拉伸向量（设计规格 §3.2/§3.3）。
 *
 * 为什么本地规划器也要认这一句：棱柱目前还没有界面按钮，而"从一句话到具体实体"这条链路
 * ——动作注册 → 传输校验 → 动作编译 → 草稿 → 确认提交——是必须能被真实走一遍的。
 * 底面用规格 §6.3 的默认特值口径（底跨 4、高度 3），水平分量给 1 让它是**斜**棱柱。
 *
 * 数字从 `localPlanDefaults` 取（Fix round 1 / M20）：这个文件以前又写死了一份
 * `sizeFrom(input.prompt, 4)` 与 `height = 3`，与本切片"这些默认值只有一处"的声明冲突。
 */
const PRISM = (input: LocalIntentInput): PlanEnvelope => {
  const span = sizeFrom(input.prompt, DEFAULT_PRISM_SPAN)
  const height = DEFAULT_PRISM_HEIGHT
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `创建一个底面边长 ${span}、高 ${height} 的斜棱柱`,
    factIds: [],
    actions: [{
      actionId: "solid.create_prism",
      actionKey: "prism",
      factIds: [],
      inputs: {
        alias: "prism",
        basePolygon: defaultPrismBasePolygon(span),
        vector: { x: 1, y: 0.5, z: height }
      }
    }]
  }
}

/**
 * **正四面体**：底面等边三角形 + 第四个顶点，棱长唯一确定形状。
 *
 * 棱长从用户原话里读第一个数字（"棱长为 3"），读不到取 `DEFAULT_SOLID_SIZE` —— 与立方体那条
 * **同一口径**（默认值只有一处：`localPlanDefaults`）。底面中心放在原点。
 *
 * 它是独立动作 `solid.create_tetrahedron`：以前没有这个动作，模型只能拿三棱柱冒充
 * （用户现场：要正四面体，拿到三棱柱）。
 */
const TETRAHEDRON = (input: LocalIntentInput): PlanEnvelope => {
  const edge = sizeFrom(input.prompt, DEFAULT_SOLID_SIZE)
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `创建一个棱长 ${edge} 的正四面体`,
    factIds: [],
    actions: [{
      actionId: "solid.create_tetrahedron",
      actionKey: "tetrahedron",
      factIds: [],
      inputs: { alias: "tetrahedron", baseCenter: { x: 0, y: 0, z: 0 }, edge }
    }]
  }
}

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
 * 顺序有意义：**先匹配更具体的**（"正方体"要在"立方体"之前，"棱柱"要在笼统的"体"之前）。
 * 触发词互不相交的条目之间没有顺序依赖。
 */
/** 显式坐标的写法：`A=(0,0,0)`。**只有底面环上的点名**允许这样写。 */
const APEX_COORDINATE_SOURCE = "([A-Z])\\s*=\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\)"

/**
 * 坐标段**只允许**是底面环上点的显式坐标，其余一律不认（fail-closed）。
 *
 * 为什么顶点不接受坐标：V0a 的顶点是**自由点**，给它写死坐标等于换了一条题设
 * （题面说"自由点 D"，系统却按一个数把它钉住，那是"特值化悄悄改题"）。
 * 为什么整段必须被坐标吃干净：只要还剩一个字符没被解释，就说明这句话里有我们没读懂的东西，
 * 那时**宁可问路**，也不要当成"读懂了"往下画。
 */
function baseCoordinatesOnly(segment: string, base: string): boolean {
  const trimmed = segment.trim()
  if (trimmed.length === 0) return true
  const seen = new Set<string>()
  for (const match of trimmed.matchAll(new RegExp(APEX_COORDINATE_SOURCE, "gi"))) {
    const name = match[1].toUpperCase()
    if (!base.includes(name) || seen.has(name)) return false
    seen.add(name)
  }
  return trimmed.replace(new RegExp(APEX_COORDINATE_SOURCE, "gi"), "").replace(/[，,\s]/g, "").length === 0
}

/** The offline route is explicitly opt-in and accepts only a bounded sentence
 * with a named triangular base, perpendicular foot and named free apex.
 * The base vertices may carry explicit coordinates; the apex stays free. */
function freeApexIntentFor(prompt: string): LocalIntent | null {
  const match = /^在三棱锥\s*([A-Z])\s*[-−]\s*([A-Z]{3})\s*中\s*[，,]\s*([\s\S]*?)\s*([A-Z]{2})\s*(?:⊥|垂直于?)\s*平面\s*([A-Z]{3})\s*[，,]\s*(?:自由|任取|任意)点\s*([A-Z])\s*[，,]\s*画示意图\s*$/i.exec(prompt.trim())
  if (!match) return null
  const apex = match[1].toUpperCase()
  const base = match[2].toUpperCase()
  const middle = match[3]
  const line = match[4].toUpperCase()
  const plane = match[5].toUpperCase()
  const freePoint = match[6].toUpperCase()
  // 平面就是底面、自由点就是顶点、四个名字互不相同 —— 少一条都说明这句话不在承诺范围内。
  if (plane !== base || freePoint !== apex) return null
  if (new Set([apex, ...base]).size !== 4 || !line.includes(apex) || ![...line].some((name) => base.includes(name))) return null
  if (!baseCoordinatesOnly(middle, base)) return null
  return {
    all: ["三棱锥", "平面"], skillIds: ["spatial-modeling"],
    build: ({ prompt: words }) => {
      /**
       * **`spatialPointConditions: true`**：题面里写死的坐标必须由**同一个解析器**看到。
       * 否则"核验过了"与"图上是什么"就成了两件事 —— 判据与它要判的对象不是同一份输入。
       */
      const found = searchWitnessForPrompt(words, { spatialPointConditions: true })
      if (found.status !== "verified_instance") {
        return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "自由顶点题设未核验", factIds: [], questions: ["这条题设目前无法生成可核验的三棱锥示意图；请补充或用手工画布。"] }
      }
      return {
        schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "按点名关系画一组三棱锥示意图", factIds: [],
        assumptions: found.assumptions,
        actions: [{
          actionId: "solid.create_polyhedron", actionKey: "free-apex", factIds: [],
          inputs: { alias: "free-apex", vertexNames: found.candidate.names, vertices: found.candidate.vertices, faces: found.candidate.faces }
        }]
      }
    }
  }
}

/**
 * **这条题设为什么给不出可核验的图形**：把见证搜索自己的理由带上，不另写一句含糊的话。
 */
function witnessRefusalQuestion(found: ReturnType<typeof searchWitnessForPrompt>): string {
  const detail = found.status === "no_witness" ? found.failures.join("；") : found.status === "unverified_instance" ? found.reasons.join("；") : ""
  return `这条题设目前给不出可核验的图形：${detail.length > 0 ? detail : "搜索没有给出原因文本。"}`
}

/**
 * **V0a 的地盘让给 V0a**。
 *
 * `freeApexIntentFor` 认的是**三棱锥 + 自由点 / 任取点 + 画示意图**这一族整句，而它对
 * **自己地盘内**的题面有一套明确的拒绝口径：顶点不许写坐标（写死坐标等于换一条题设）、
 * 多一条长度不认、"D 在底面 ABC 上方"这类空间条件也不认。那些拒绝是**刻意**的（自由点是实验特性）。
 *
 * 所以这一层**不抢它的活**，判据取**整个三棱锥族**：
 * - 带 `自由点 / 任取点 / 任意点` 的句子（地盘标记）一律不接；
 * - **三棱锥**本身也不接 —— 那正是 V0a 的族（它的拒绝口径是按这个族写的），
 *   这一层接四 / 五 / 六棱锥、棱柱、棱台。
 *
 * 否则上面那些刻意拒绝会被"另一端能画"悄悄推翻，而那是行为变更，不是新增能力。
 */
const V0A_TERRITORY = /自由点|任取点|任意点|三棱锥/

/**
 * **点名的立体图形族**（S6.3）：题面里认得出形状从句（`在四棱台ABCD-A′B′C′D′中` 这类）时，
 * 交给**入口语法 + 见证搜索**那条线 —— 于是台体、五 / 六棱锥、直棱柱这些题面第一次有了界面路径。
 *
 * 与 `freeApexIntentFor` 的分工：那条只认 V0a 的**自由顶点三棱锥整句**（一条固定句式），
 * 这条认的是**整族形状**，判据是入口语法（`parseShapeClause`），而且**避开 V0a 的地盘**。
 * 两者走的是**同一个**见证搜索，所以"系统替你定了什么"（assumptions）与面板证据是同一份。
 *
 * 与既有点名同一条纪律：**不认裸词**。"画一个棱锥"没有点名表，入口语法认不出 ⇒ 不认（老实问路）。
 */
function solidShapeIntentFor(prompt: string): LocalIntent | null {
  if (V0A_TERRITORY.test(prompt)) return null
  const shape = parseShapeClause(prompt)
  if (shape === null) return null
  const keyword = shape.family === "pyramid" ? "棱锥" : shape.family === "prism" ? "棱柱" : "棱台"
  const label = shape.family === "frustum" ? "台体" : keyword
  return {
    all: [keyword],
    skillIds: ["spatial-modeling"],
    build: ({ prompt: words }) => {
      const found = searchWitnessForPrompt(words)
      if (found.status !== "verified_instance") {
        return {
          schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: `${label}题设未核验`, factIds: [],
          questions: [witnessRefusalQuestion(found)]
        }
      }
      return {
        schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: `按点名关系画一组${label}示意图`, factIds: [],
        assumptions: found.assumptions,
        actions: [{
          actionId: "solid.create_polyhedron", actionKey: "named-shape", factIds: [],
          inputs: { alias: "named-shape", vertexNames: found.candidate.names, vertices: found.candidate.vertices, faces: found.candidate.faces }
        }]
      }
    }
  }
}

export const LOCAL_INTENTS: readonly LocalIntent[] = [
  { all: ["圆台"], exact: ROUND_FRUSTUM_PROMPT, skillIds: ["spatial-modeling"], build: () => ROUND_FRUSTUM() },
  { all: ["四棱锥", "PA", "BC", "AD"], exact: PYRAMID_PROMPT, skillIds: ["spatial-modeling"], build: () => pyramidPlan() },
  /**
   * **代表题五（S5）**：同一只四棱锥 + 它的**外接球**。
   *
   * 与上面那条同一条纪律（精确匹配、不挂实验开关），差别只在于**多一笔派生动作**：
   * `derived.create_circumsphere` 的宿主是同一份计划里的那只四棱锥，球心与半径由内核算出来。
   * 浏览器用例要**自己从落盘坐标算一遍**才谈得上判过（不读面板结论）。
   */
  { all: ["四棱锥", "外接球"], exact: PYRAMID_CIRCUMSPHERE_PROMPT, skillIds: ["spatial-modeling"], build: () => pyramidCircumspherePlan() },
  { all: ["四棱锥", "PA", "BC", "AD", "∠"], exact: PYRAMID_UNVERIFIED_PROMPT, skillIds: ["spatial-modeling"], build: () => pyramidPlan() },
  /**
   * **代表题三（计划 V0b）**：平面直角三角形。
   *
   * 与上面两条同一条纪律：**精确匹配**一个固定句子，题面只给关系、数字由系统挑并写进 assumptions。
   * 它**不挂在任何实验开关后面** —— 开关管的是"见证搜索"（欠定题候选的搜索），
   * 而这条走的是既有的夹具路径（与 `PYRAMID_PROMPT` 同类），默认就该能跑。
   */
  { all: ["三角形", "ab⊥ac"], exact: PLANAR_TRIANGLE_PROMPT, skillIds: ["planar-basics"], build: () => planarRightTrianglePlan() },
  /**
   * **代表题四（计划 V0c）**：椭圆。
   *
   * 与上面那条**同一条纪律**（精确匹配 + 不挂实验开关），但有一处**关键不同**：
   * 题面是**方程**，两个半轴已经被分母钉死（`√9 = 3`、`√4 = 2`），
   * 所以这里**没有"系统自选示例值"**这回事 —— 夹具的 `assumptions` 明说了这一点，
   * 免得用户以为自己看到的是一条随手挑的曲线。
   */
  { all: ["椭圆", "x²/9+y²/4"], exact: CONIC_ELLIPSE_PROMPT, skillIds: ["conics-tangents"], build: () => ellipsePlan() },
  /** **代表题六、七**：双曲线与抛物线。与椭圆同一条纪律（精确匹配、不挂开关、参数由方程钉死）。 */
  { all: ["双曲线", "x²/9−y²/4"], exact: HYPERBOLA_PROMPT, skillIds: ["conics-tangents"], build: () => hyperbolaPlan() },
  { all: ["抛物线", "y²=4x"], exact: PARABOLA_PROMPT, skillIds: ["conics-tangents"], build: () => parabolaPlan() },
  /**
   * **代表题五（计划 V0d）**：函数图像与它在某点的切线。
   *
   * 要 `functions` 与 `conics-tangents` **两份清单**：曲线由前者创建，切线由后者作 ——
   * 少给一份，模型上下文里就少一个动作，编译时才发现（而那时已经晚了）。
   */
  { all: ["f(x)", "切线"], exact: FUNCTION_TANGENT_PROMPT, skillIds: ["functions", "conics-tangents"], build: () => functionTangentPlan() },
  /**
   * **代表题一（规格 §8.1）**：斜四棱柱 + 三条棱的中点 + 截面 + 棱上动点。
   *
   * 命中的是两个关键词都出现（"棱柱" + "截面"）：单说"棱柱"仍然走下面那条简单夹具
   * （用户想要的可能只是一只棱柱，而不是一道截面题）。
   */
  { all: ["棱柱", "截面"], skillIds: ["spatial-modeling", "sections-intersections", "dynamic-bindings"], build: () => obliquePrismSectionPlan() },
  /**
   * **代表题二（规格 §8.2）**：椭圆 + 符号参数 θ + 动点 P + 切线 + 不变量表达式。
   *
   * 与长轴短轴无关的那句"恒为 1"是这道题的关键词，所以命中的判据里也带上它 ——
   * 否则"椭圆"两个字会把别的椭圆题也拉进这条固定夹具。
   */
  { all: ["椭圆", "切线"], any: ["恒", "定值", "任意"], skillIds: ["conics-tangents", "dynamic-bindings", "functions"], build: () => conicInvariantPlan() },
  /**
   * **正四面体**（用户直接要它）。放在"棱柱"之前：它是更具体的形状，而"四面体"这三个字
   * 与"棱柱"并不重叠 —— 顺序在这里只是把"先具体后笼统"这条纪律写实。
   *
   * **不认裸词"四面体"**：它会命中**分析题**——"帮我求这个四面体的外接球半径并画出球"
   * 这句话里就有"四面体"（而且还有"画"），于是本地规划器会**新建一只四面体**而不是回答。
   * 认不出时老实问路，比悄悄改文档好（这正是本文件开头那条纪律）。
   */
  { all: ["正四面体"], skillIds: ["spatial-modeling"], build: TETRAHEDRON },
  { all: ["tetrahedron"], skillIds: ["spatial-modeling"], build: TETRAHEDRON },
  /**
   * **球**：只认「球体」这个具体写法 —— 裸词「球」会把"外接球 / 内切球"那类**分析题**拉进来
   *（用户要的是读数，却被新建了一只球）。理由与上面那条"不认裸四面体"完全相同。
   */
  { all: ["球体"], skillIds: ["spatial-modeling"], build: SPHERE },
  { all: ["棱柱"], skillIds: ["spatial-modeling"], build: PRISM },
  { all: ["prism"], skillIds: ["spatial-modeling"], build: PRISM },
  { all: ["立方体"], skillIds: ["spatial-modeling"], build: (input) => CUBE({ ...input, size: sizeFrom(input.prompt, 2) }) },
  { all: ["正方体"], skillIds: ["spatial-modeling"], build: (input) => CUBE({ ...input, size: sizeFrom(input.prompt, 2) }) },
  { all: ["cube"], skillIds: ["spatial-modeling"], build: (input) => CUBE({ ...input, size: sizeFrom(input.prompt, 2) }) },
  { all: ["点"], any: ["画一个点", "画个点", "作一个点", "建一个点", "添加一个点", "画一点", "画点", "添加点"], skillIds: ["planar-basics"], build: (input) => PLANAR_POINT({ ...input, size: sizeFrom(input.prompt, 1) }) },
  // 只读提问不产生动作，因此**不请求任何技能** —— 上下文里不该出现用不上的动作菜单。
  { all: ["有什么"], skillIds: [], build: () => COUNT_ANSWER() }
]

/**
 * **建模动词**：句子里出现这些，就认为用户是在要求作图（而不是在问读数）。
 * 与下面那组"读数问法"配合使用，见 `isAnalysisQuestion`。
 */
const CREATION_VERBS = ["画", "作", "建", "添加", "创建", "放", "来一个", "来个"]

/** **读数问法**：句子里出现这些，通常是在问某个量是多少、多长、多大。 */
const MEASUREMENT_QUESTIONS = ["是多少", "多少", "多大", "多长", "求", "怎么", "为什么", "吗"]

/**
 * **这是不是一道"只在问读数"的分析题？**
 *
 * 现场（2026-10-02 查实）：把"这个正方体的内切球半径是多少"喂进本地规划器，命中的是
 * 既有的「正方体」条目 —— 它会**去新建一只正方体**，而用户要的是一个读数。
 * 这与上面两条注释里的纪律是同一条（不认裸词"四面体"、不认裸词"球"）：
 * **认不出时老实问路，比悄悄改文档好**（见本文件开头那条纪律）。
 *
 * **边界（如实写清）**：只挡"**没有任何建模动词**"的问句。像"画出这个正方体的内切球"
 * 这种既在问几何、又明确要求作图的句子照旧走建模 —— 它确实是在要求作图。
 */
export function isAnalysisQuestion(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  if (CREATION_VERBS.some((verb) => normalized.includes(verb))) return false
  return MEASUREMENT_QUESTIONS.some((marker) => normalized.includes(marker))
}

/**
 * 找出这条指令命中的那一条（认不出返回 `null`）。**匹配规则只有这一处**。
 */
export function matchLocalIntent(prompt: string, options: { enableFreeApex?: boolean } = {}): LocalIntent | null {
  const freeApex = options.enableFreeApex === true ? freeApexIntentFor(prompt) : null
  if (freeApex !== null) return freeApex
  const normalized = prompt.toLowerCase()
  // 只在问读数、又没说要画：**请求技能的建模意图一律不认**（认不出的结果是"老实问路"）。
  // 不求技能的意图（例如"有什么"那条只读回答）不受影响 —— 它们本来就要在问句里命中。
  const analysis = isAnalysisQuestion(normalized)
  for (const intent of LOCAL_INTENTS) {
    if (analysis && intent.skillIds.length > 0) continue
    if (intent.exact !== undefined && normalized.trim() !== intent.exact.toLowerCase()) continue
    if (!intent.all.every((token) => normalized.includes(token.toLowerCase()))) continue
    if (intent.any && !intent.any.some((token) => normalized.includes(token.toLowerCase()))) continue
    return intent
  }
  /**
   * **兜底：点名的立体图形族**（S6.3）。放在**精确夹具之后**是刻意的 ——
   * 夹具是逐字钉住的代表题，让形状族抢先会把它们从既有路径上挤走（那是行为变更，不是新增）。
   * 所以这条只在**没有夹具认领**时接：台体、五 / 六棱锥、直棱柱这些题面。
   *
   * 它挂在**同一个实验开关**后面：走的是同一个见证搜索（系统要替题面选几个自由值），
   * 而"要不要让系统替用户选值"正是这个开关管的事。开关关着时照旧"老实问路"。
   */
  if (options.enableFreeApex === true && !analysis) return solidShapeIntentFor(prompt)
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
export function localIntentSkillIds(prompt: string, options: { enableFreeApex?: boolean } = {}): readonly string[] {
  return matchLocalIntent(prompt, options)?.skillIds ?? []
}

export interface LocalPlannerOptions {
  /** 命中指令表之外的输入时是否给出"认不出"的回答（缺省 true）。 */
  explainRefusal?: boolean
  /** Experimental V0a, never on for a default/local run. */
  enableFreeApex?: boolean
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
      const intent = matchLocalIntent(userMessage, { enableFreeApex: options.enableFreeApex === true })
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

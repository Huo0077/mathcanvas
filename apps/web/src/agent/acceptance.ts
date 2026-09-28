import type { AcceptanceCheck } from "@draw/agent-core"

/**
 * **从用户原话推出这次运行的验收条件**（Phase 3 的最后一步）。
 *
 * ## 这一层为什么必须存在
 *
 * 门禁（`verificationGate`）已经接线并生效，而`agentRunner` 从来没有声明过验收条件 ——
 * 于是它在生产里是**惰性的**：通路在，没人喂它。
 * "这次运行要满足什么"这件事，只有用户的原话里说得清。
 *
 * ## 判据：**宁可少推，不可推错**
 *
 * 推错一条条件的后果不是"少验一次"，而是**拦住一次正确的作图**：
 * 用户看到的是失败，而画面其实是对的。所以这一层只推"有把握"的两类：
 *
 * 1. **用户点名了形状** → `has_primitive`（说"立方体"就该有一个 `polyhedron3`）；
 * 2. **用户点名要"没有这个东西"** → 不推（拒绝类请求的成功条件是"没建出来"，
 *    那与"建出来了"是相反的方向，推错方向会把正确行为判成失败）。
 *
 * ## 刻意**不**推的东西（都有具体理由，不是偷懒）
 *
 * - **`edge_length`（尺寸）**：原话里的数字**不等于**包围盒边长。实测：
 *   "棱长为 3 的正四面体"的包围盒是 `(3, 3·√2/2, 3·√2/2)`，
 *   拿 3 去比会**判错一份完全正确的文档**。尺寸判据需要按图元类型换算，
 *   而那份知识在几何内核里，不在这层。
 * - **`has_label`（标签）**：原话里的名词是**意图**，不是标签文本。
 *   用户说"立方体"不代表那个对象要叫"立方体"。
 * - **关系 / 截面 / 参数化**：判据还不存在（Phase 3 剩余项），
 *   这里**如实不推**，而不是塞一条 `unsupported` 让每次运行都被拦。
 *   （"没有判据"与"判据说失败"是两件事，混起来会让门禁变成一句"什么都做不了"。）
 */

/** 一个"用户点名了这个形状"的判据：原话里的关键词 → 文档里该出现的图元类型。 */
interface ShapeKeyword {
  /** 原话里出现哪些词就算点名了这个形状（**全部**命中）。 */
  all: readonly string[]
  /** 其中任意一个命中即可（可选）。 */
  any?: readonly string[]
  /**
   * 出现这些词就**不算**点名（可选）。
   *
   * 为什么需要它：**"提到"不等于"要求建出来"**。实测三个反例（都是这一层的用例逼出来的）：
   * - "把刚才的**截面**平面改一下" —— 改截面与建截面是两回事，判成"要建截面"会拦住一次正确修改；
   * - "**画布**上有几个**点**？" —— "画"出现在"画布"里、问句里也提到"点"，但那是一次只读提问；
   * - "**棱柱**的截面怎么算？" —— 在问概念，不是要作图。
   *
   * 排除词跟着形状走（`截面` 怕"改"、`点` 怕"画布"与问句），而不是做一张全局停用词表：
   * 全局表会把"改"从**其它**形状的判据里也去掉，那是另一种错。
   */
  exclude?: readonly string[]
  /** 建出来之后文档里该有的图元类型。 */
  primitive: string
}

/**
 * **形状关键词表**。
 *
 * 与 `apps/web/src/agent/localPlanner.ts` 的意图表**刻意分开**：
 * 那张表回答"这句话我能不能编出一份计划"（决定做什么），
 * 这张表回答"做完了该看到什么"（决定验什么）。
 * 合并会让"能规划"与"可验证"变成同一个判断 —— 而它们本来就不是。
 */
const SHAPE_KEYWORDS: readonly ShapeKeyword[] = [
  // 立体：都在文档里物化成 `polyhedron3`（棱柱也是它，没有独立的 `prism` 图元类型）。
  { all: ["立方体"], primitive: "polyhedron3" },
  { all: ["正方体"], exclude: ["几个", "多少", "哪些"], primitive: "polyhedron3" },
  { all: ["cube"], primitive: "polyhedron3" },
  { all: ["正四面体"], exclude: ["几个", "多少", "哪些"], primitive: "polyhedron3" },
  { all: ["tetrahedron"], primitive: "polyhedron3" },
  { all: ["棱柱"], exclude: ["怎么", "如何", "为什么", "求"], primitive: "polyhedron3" },
  { all: ["prism"], primitive: "polyhedron3" },
  /**
   * 截面：**必须是要建它**。这一条的反例最具体 —— "把刚才的截面平面改一下"
   * 里也有"截面"，而那次运行的验收条件是"改对了"，不是"多了一个截面"。
   */
  { all: ["截面"], exclude: ["改", "修改", "调整", "移动", "删", "怎么", "如何", "为什么"], primitive: "section" },
  /**
   * 平面点：**必须点名"点"且带一个真正的作图动词**。
   * "画布"里的"画"不算 —— 那一条反例是本层用例抓出来的。
   */
  { all: ["点"], any: ["画一个点", "画个点", "作一个点", "建一个点", "添加一个点", "画一点"], exclude: ["画布", "几个", "多少", "哪些"], primitive: "point" }
]

/**
 * 从原话推出验收条件。**可能返回空数组**（原话里没有可推的东西）——
 * 那表示"这次没有可判据的验收条件"，调用方据此**不声明**（门禁保持惰性），
 * 而不是声明一个空数组（空数组会被门禁拦下）。
 */
export function deriveAcceptance(prompt: string): AcceptanceCheck[] {
  const normalized = prompt.toLowerCase()
  const checks: AcceptanceCheck[] = []
  const seen = new Set<string>()
  for (const keyword of SHAPE_KEYWORDS) {
    if (!keyword.all.every((token) => normalized.includes(token.toLowerCase()))) continue
    if (keyword.any && !keyword.any.some((token) => normalized.includes(token.toLowerCase()))) continue
    if (keyword.exclude?.some((token) => normalized.includes(token.toLowerCase()))) continue
    if (seen.has(keyword.primitive)) continue
    seen.add(keyword.primitive)
    checks.push({ kind: "has_primitive", type: keyword.primitive })
  }
  return checks
}

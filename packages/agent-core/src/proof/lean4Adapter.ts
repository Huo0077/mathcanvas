import type { ClaimEvidenceStatus } from "../claimEvidence"
import { evidenceStatusWithProof, PROOF_ARTIFACT_VERSION, proofInputHash, type ProofArtifact, type ProofCheckStatus, type ProofExpectation, type ProofInput, type ProofVerification, type ProofVerifyOptions } from "./proofArtifact"
import type { ProofGoalKind } from "./proofGoals"

/**
 * **Lean 4 证明后端适配器**（实施计划 N5b；设计 §4.C）。
 *
 * 这一层的唯一职责是：**把一条已经分类好的几何目标，翻译成一条 Lean 命题，跑 Lean，
 * 用 axioms 报告判定"它到底证明了没有"，然后产出 `ProofArtifact`。**
 *
 * ## ⚠️ 最大的诚实边界：把 IR 翻成命题这一步**本身没有被证明**
 *
 * 下面这个模板是一个**可审计的小映射**，不是一段"看起来对"的代码。它的全部内容是：
 *
 * | 这一层用的东西 | 变成 Lean 里的什么 |
 * | --- | --- |
 * | `goalKind === "perpendicular"` | 命题形状：`(D : Submodule ℝ E) (u v : E) (hu : u ∈ Dᗮ) (hv : v ∈ D) : inner ℝ u v = 0` |
 * | `perpendicular.lineA`（两条点，u = 两端差向量） | 那个落在 `Dᗮ` 里的向量 `u`（假设 `hu`） |
 * | `perpendicular.planePoints`（列进 π 的点） | 生成子空间 `D`（前三个点两两作差） |
 * | `perpendicular.lineB`（两条点，v = 两端差向量） | 那个落在 `D` 里的向量 `v`（假设 `hv`） |
 * | 结论"线 ⊥ 线" | 目标 `inner ℝ u v = 0` |
 * | `proof`（后端给的正文） | 定理的 `:= by ...` 那一段，**原样照抄，一个字都不解释** |
 *
 * **第二个目标类**（`planePerpendicular`，2026-10-10 加；判定定理那一半）：
 *
 * | 这一层用的东西 | 变成 Lean 里的什么 |
 * | --- | --- |
 * | `goalKind === "planePerpendicular"` | 命题形状：`(A B C P : E) (h1 : inner ℝ (A - P) (B - A) = 0) (h2 : inner ℝ (A - P) (C - A) = 0) : (A - P) ∈ (span {B - A, C - A})ᗮ` |
 * | `planePerpendicular.line`（那条声称⊥面的线） | 结论里的向量 `A - P`，也是两个前提里的左因子 |
 * | `planePerpendicular.planeLines`（平面内**相交**的两条线） | 两个前提的右因子；它们张成的子空间就是结论里那个 `D` |
 * | 结论"线 ⊥ 面" | 目标 `(A - P) ∈ (span …)ᗮ` |
 *
 * **两类是两条方向相反的定理**：`perpendicular` 是性质定理（已知⊥面 ⇒ ⊥面内任意线），
 * `planePerpendicular` 是判定定理（⊥面内两条相交线 ⇒ ⊥面）。**它们的定理名不同**，
 * 所以一份 `#print axioms` 报告**不可能**互相冒充（有用例钉住）。
 *
 * ### 逐字段：**哪些字段参与了翻译**
 *
 * - **参与**：`goalKind`、`perpendicular.lineA`、`perpendicular.planePoints`、`perpendicular.lineB`、`proof`。
 * - **不参与**（`assumptions`）：**这是有意的，而且是一条边界**。`assumptions` 是"系统替用户多给的
 *   假设"（例如"底面 ABCD 是正方形"）。它**不会**变成 Lean 里的假设 —— 也就是说，如果某条结论其实
 *   要靠某条 `assumption` 才成立，这个模板**证不出来**（Lean 会报编译错误），而不是**偷偷把它当公理用**。
 *   这个方向是**保守**的：它只会让证明失败，不会让证明变假。
 *   但**必须说清**：产物里也没有任何地方声明"这条结论是在这些 assumptions 下成立的" ——
 *   绑定靠的是 `proofInputHash` 的 `assumptions` 那一栏（R51），不是靠 Lean 侧。
 * - **不参与**（`prompt` / `claimSourceText`）：它们进 `proofInputHash`（绑定），不进命题。
 * - **只用了一部分**：`planePoints` 的**前三个**用来生成 `D`；再多的点被**忽略**了。
 *   这是模板的**已知弱点**（见下）。
 * - **部分参与**：`lineB` 的第二个点只用于 `u - uOf(second)`；第一个点被约掉了。
 *
 * ### 模板会在哪里失效（IR 的语义一变就断）
 *
 * 1. **"被列进 π 的点落在 π 上"是模板给的、不是证出来的**。命题里 `D` 是"前三个点生成的子空间"，
 *    `v ∈ D`（`hv`）是一条**假设**。所以这个模板证的是
 *    "若 v 落在 D 里，则 u ⊥ v" —— 而"这个平面的第二个方向确实是 `p4 - p1`"这件事
 *    （也就是"点 p4 真的在那个平面上"）**不在命题里**。IR 里如果换一种方式描述平面
 *    （参数方程、法向量、多于三个点、点不共面），这里**必须**跟着改，否则命名的对象就变了。
 * 2. **多于三个平面点时静默取前三个**。如果 IR 的语义是"这些点都在平面上"，而第 4 个点其实
 *    离开前三点生成的面，那么这个模板会**证明一个比 IR 更弱/不同的东西**。今天的调用方
 *    （`buildPerpendicularStatement` 的文档注释）要求至少三个；**没有**判据拦住"给了 4 个但第 4 个
 *    不在面上"—— 因为那需要几何判断，而 IR 里没有这个信息位。
 * 3. **坐标 / 维度完全不进命题**。三维还是更高维、点在哪里，Lean 侧一概不知道。
 *    这正是 R55 要的（证命题、不证实例），代价是"模板把几何对象认对了吗"这件事
 *    **只能靠人读**（以及 `proofInputHash` 绑住的 `statement` 原文）。
 * 4. **`proof` 正文原样照抄**。所以"模型能不能自己写正文"这件事**不靠信任解决**：
 *    正文是不是证明，由 Lean 内核 + axioms 白名单判定（见 `checkAxiomsReport`）。
 *    模型最多写一个**草稿**；它**没有**任何办法说"这个证明成立"。
 *
 * ### 覆盖范围
 *
 * **覆盖两个目标类**（2026-10-10 起）：`perpendicular`（性质定理："线 ⊥ 面 ⇒ 线 ⊥ 线"）
 * 与 `planePerpendicular`（判定定理："线 ⊥ 面内两条**相交**线 ⇒ 线 ⊥ 面"）。
 * 走通两个类**不等于**证明出口对别的类可用（`parallel` / `equalLength` / 曲线性质 / 切线·导数
 * 今天**没有**模板）—— 这一条是 V2 GREEN 的缺口①，**只补上了第一刀，没补完**。
 *
 * ## 为什么是 `perpendicular` 这一支（控制器裁决 R55 的原话）
 *
 * `E` 是任意实内积空间、`D` 是任意子空间、`u ∈ Dᗮ`、`v ∈ D` ⇒ `⟪u, v⟫ = 0`。
 * 数学上它**就是**"线 ⊥ 平面 π ⇒ 任何落在 π 里的线都与它垂直"：
 * `u` 是那条线的方向向量，`D` 是 π 的方向子空间，`v` 是 π 里另一条线的方向向量。
 * mathlib 里现成的支是 `Submodule.mem_orthogonal` 与 `Submodule.mem_orthogonal'`。
 */

// ---------------------------------------------------------------- IR 侧的形状

/** 一条直线：**两个点名点**。方向的取法是"第二个减第一个"（与几何习惯一致）。 */
export interface Lean4NamedLine {
  first: string
  second: string
}

/**
 * `perpendicular` 目标类要的东西。
 *
 * `planePoints` 是**列进这个平面的点**（至少要三个 —— 少于此模板生成不出子空间，
 * 会**如实拒绝**，不是猜一个平面出来）。
 */
export interface Lean4PerpendicularGoal {
  lineA: Lean4NamedLine
  planePoints: readonly string[]
  lineB: Lean4NamedLine
}

/**
 * `planePerpendicular` 目标类要的东西（**判定定理那一半**）。
 *
 * - `line`：那条**声称垂直于平面**的线（两个点名点，方向 = 第二点 − 第一点）；
 * - `planeLines`：平面内两条**相交**的线，**每条都是题面点名说它 ⊥ 那条线**的那两条
 *   （例如"PA ⊥ AB、PA ⊥ AC"⇒ `line = P→A`、`planeLines = [A→B, A→C]`）。
 *
 * ## 为什么"相交"必须是**输入给的**，而不是模板猜的
 *
 * 判定定理的前提里"两条直线**相交**"是承重的：两条平行线张不出一个平面，那时命题
 * `u ∈ (span {v, w})ᗮ` 仍然**真**（正交补的定义按子空间走），但把它读成"线 ⊥ 平面"就是**错的** ——
 * 因为那个子空间根本不是平面。模板**没有**几何判断能力（点都是抽象变量），所以它
 * **只能检查点名的共用关系**：两条线必须**恰好共用一个点名点**（那就是"相交"这件事在输入里的痕迹）。
 * 共点为零个（平行/异面）或两个（同一条线写了两遍）⇒ **抛**，不猜。
 */
export interface Lean4PlanePerpendicularGoal {
  line: Lean4NamedLine
  planeLines: readonly [Lean4NamedLine, Lean4NamedLine]
}

/** 适配器的输入：**已经分类好**的一条几何目标 + 它的绑定信息。 */
export interface Lean4ProofGoalInput {
  /** 题设原话。**进哈希，不进命题**。 */
  prompt: string
  /** 这条 claim 的原话。**进哈希，不进命题**。 */
  claimSourceText: string
  /** 这条 goal 属于哪一类（`proofGoals.ts` 的封闭词表）。今天支持 `"perpendicular"` / `"planePerpendicular"`。 */
  goalKind: ProofGoalKind | string
  /** 系统替用户定的假设。**进哈希（R51），不进命题**（见文件头"哪些字段参与了翻译"）。 */
  assumptions?: readonly string[]
  /** 后端给出的证明正文（草稿）。**原样照抄进命题文件的 `:= by` 那一段**。 */
  proof: string
  perpendicular?: Lean4PerpendicularGoal
  planePerpendicular?: Lean4PlanePerpendicularGoal
}

// ---------------------------------------------------------------- Lean 源码生成

/**
 * **允许出现在 axioms 报告里的公理**（控制器实测：真证明落在前三个上）。
 *
 * 这三个是 Lean/mathlib 的标准公理：`propext`（命题外延）、`Classical.choice`（选择公理）、
 * `Quot.sound`（商类型的相等）。
 *
 * **⚠️ 绝不要把它写成空列表**：那样连**真**证明都会被自己拒掉 ——
 * 那是一个"会静默把所有证明判失败"的坑（看起来像"后端不行"，实际是白名单写错了）。
 *
 * `sorryAx` 是"空洞证明"的标记，**不在**这里，也永远不会进来。
 */
export const LEAN4_ALLOWED_AXIOMS: readonly string[] = ["propext", "Classical.choice", "Quot.sound"]

/** 一次 Lean 调用的结局。**与产物里的 `status` 同一个词表**（不多不少四个结局）。 */
export interface Lean4RunResult {
  /** 进程退出码；被信号杀掉或根本没起来时为 `null`。 */
  exitCode: number | null
  stdout: string
  stderr: string
  /** 墙钟耗时（毫秒）。 */
  durationMs: number
  /** 命中了进程级墙钟上限（**不是** Lean 自己的 heartbeats 超时）。 */
  timedOut: boolean
  /** 根本没有可用的 Lean 可执行文件 ⇒ "后端不可用"，**不是**"证明失败"。 */
  unavailableReason?: string
}

export interface Lean4RunRequest {
  /** 传给 Lean 的文件内容。 */
  source: string
  /** Lean 可执行文件（绝对路径；由 `resolveLean4Toolchain` 给出）。 */
  leanPath: string
  /** `lake` 可执行文件；给了就用 `lake env lean`（让 `import Mathlib` 能被解析）。 */
  lakePath: string | null
  /** 工作目录（仓内那个小 Lean 工程；`lake` 要在工程里跑）。 */
  projectDir: string
  /** 进程级墙钟上限（毫秒）。 */
  timeoutMs: number
  /** 便于测试注入（真实实现落在一个 Node-only 的 runner 里）。 */
  signal?: AbortSignal
}

/** 怎么跑一次 Lean。**可注入** —— 这是"判据能在没有工具链的 CI 上跑"的落点。 */
export type Lean4Runner = (request: Lean4RunRequest) => Promise<Lean4RunResult>

// ---------------------------------------------------------------- axioms 判据

export interface Lean4AxiomReport {
  /** 报告里点名的定理名（应当等于我们生成的那个唯一名字）。 */
  queryName: string
  /** 解析出的公理名（按报告顺序）。 */
  axioms: readonly string[]
  /** 命中了"不依赖任何公理"那句话（此时 `axioms` 是空数组）。 */
  reportedNoAxioms: boolean
  /** 最终判定：`true` 才允许把产物写成 `verified`。 */
  passed: boolean
  /** 拒绝原因（`passed` 为 `true` 时是 `null`）。 */
  rejection: string | null
}

/** 生成的那个唯一定理名 —— 解析 `#print axioms` 的报告时要用它**精确**匹配。 */
export function lean4TheoremName(spec: Lean4GeneratedStatement): string {
  return spec.theoremName
}

const DEPENDS_ON_AXIOMS = /^'([^']+)' depends on axioms: \[(.*)\]$/
const NO_AXIOMS = /^'([^']+)' does not depend on any axioms$/

/**
 * **把 `#print axioms <本定理>` 的输出解析成结构化判定**（fail-closed）。
 *
 * 三条判据，缺一条都不够：
 *
 * 1. **必须看到那条定理的报告**（`queryName` 逐字匹配）。没看到 = 没有证据 ⇒ 拒。
 *    （这条挡的是"Lean 因为别的错没跑到 `#print`,`grep sorry 没找到" ⇒ 看起来没事"。）
 * 2. **报告里的公理必须全部在白名单里**。`sorryAx` 与任何表外名字（含**用户自定义的 `axiom`**）⇒ 拒。
 * 3. **报告必须能被解析**。多一行、少一个括号、名字不一样 ⇒ 拒。
 *
 * **绝不**用"grep 里没有 `sorry` 这个词"当判据：那是文本级否定，`sorry` 换个写法、或者用
 * `axiom` 绕过去，它就失效了 —— 而 `#print axioms` 问的是**内核真正依赖了什么**，
 * 那是 `sorry` / `axiom` 都躲不掉的一条路。
 */
export function checkAxiomsReport(stdout: string, queryName: string): Lean4AxiomReport {
  const lines = stdout.split(/\r?\n/)
  const own = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`'${queryName}'`))

  if (own.length === 0) {
    return {
      queryName,
      axioms: [],
      reportedNoAxioms: false,
      passed: false,
      rejection: `Lean 的输出里没有 '${queryName}' 的 axioms 报告 —— 没有证据不等于没有公理（fail-closed）。`
    }
  }
  if (own.length > 1) {
    return {
      queryName,
      axioms: [],
      reportedNoAxioms: false,
      passed: false,
      rejection: `'${queryName}' 出现了 ${own.length} 条 axioms 报告，无法判断哪一条算数。`
    }
  }
  const line = own[0]!
  const noAxioms = NO_AXIOMS.exec(line)
  if (noAxioms !== null) {
    return { queryName, axioms: [], reportedNoAxioms: true, passed: true, rejection: null }
  }
  const depends = DEPENDS_ON_AXIOMS.exec(line)
  if (depends === null || depends[1] !== queryName) {
    return {
      queryName,
      axioms: [],
      reportedNoAxioms: false,
      passed: false,
      rejection: `'${queryName}' 的 axioms 报告不是可识别的形状：${line}`
    }
  }
  const axioms = depends[2]!
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (axioms.length === 0) {
    // `depends on axioms: []` —— 形状像是"没有公理"，但它**不是** Lean 的那句话。
    // 不认识的形状一律拒（fail-closed），免得将来某种输出变体把这条判据绕过去。
    return {
      queryName,
      axioms,
      reportedNoAxioms: false,
      passed: false,
      rejection: `'${queryName}' 的报告写了空公理列表，但用的不是 Lean 的标准说法 —— 不认识的形状不当作证据。`
    }
  }
  const offList = axioms.filter((axiom) => !LEAN4_ALLOWED_AXIOMS.includes(axiom))
  if (offList.length > 0) {
    return {
      queryName,
      axioms,
      reportedNoAxioms: false,
      passed: false,
      rejection: `'${queryName}' 依赖表外公理 [${offList.join(", ")}]（白名单：${LEAN4_ALLOWED_AXIOMS.join(", ")}）—— ${
        offList.includes("sorryAx") ? "`sorryAx` 意味着这条证明是空的。" : "表外公理一律拒。"
      }`
    }
  }
  return { queryName, axioms, reportedNoAxioms: false, passed: true, rejection: null }
}

/**
 * **一个目标类生成出来的东西**（`perpendicular` 与 `planePerpendicular` 共用这个形状）。
 *
 * 原来是按第一个类命名（`Lean4PerpendicularSpec`）；加第二个类时**改名**而不是复制一份 ——
 * 复制会让"两类共用同一套绑定语义"这件事在类型上悄悄分叉。
 */
interface Lean4GeneratedStatement {
  theoremName: string
  /** 生成出来的完整 Lean 文件内容。 */
  source: string
  /**
   * 这条命题**原文**（进 `proofInputHash` 的 `statement` 那一栏，R56 绑的就是它）。
   * **它是"我们证了哪一条命题"这件事的唯一权威记录** —— 模板一改，它就变，哈希必然失配。
   */
  statement: string
}

/** 让生成的名字不会撞上 mathlib 里的东西，也不会撞上一次运行里的别的定理。 */
export const LEAN4_THEOREM_NAME = "draw_perpendicular_goal"

/**
 * **生成文件里那三个名字**：两个差向量的简写，以及"落在子空间里"那个假设。
 *
 * 它们是常量并导出，是为了让**用例**能与正文交叉核对（见 `lean4Adapter.test.ts` 里
 * "正文不许引用不存在的名字"那一条）。**适配器自己不做这个检查** —— 理由写在下面。
 *
 * ## 一次真实失败（我实测撞到的，值得记）
 *
 * 端到端第一次跑的时候，证明正文写的是 `exact hu v hv`，而生成的命题里**没有 `v`**
 * （只有 `hv`）。后果不是一句清楚的"编译错误"，而是：
 *
 * ```
 * error: unsolved goals
 *   hu : ∀ u ∈ Submodule.span ℝ {B - A, C - A}, inner ℝ (A - P) u = 0
 *   ⊢ inner ℝ (A - P) (D - B) = 0
 * error: unexpected identifier; expected command
 * 'draw_perpendicular_goal' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]
 * ```
 *
 * 也就是说：**它长得像"这条证明是空的"**（`sorryAx` 出现了），而真因是正文引用了不存在的
 * 标识符。判据层会如实判 `failed`（那是对的），但**人**会读到一句误导的说明。
 *
 * ## 为什么适配器**不**自己去扫标识符
 *
 * 扫标识符需要知道 Lean 的保留字、mathlib 的名字、语法糖 —— 那等于在适配器里再实现半个
 * Lean 前端，而**猜错的方向比不猜更坏**（一个假阳性会把一条真证明拒掉）。
 * 所以这条检查留在**用例**里（它知道这份模板生成了哪些名字），
 * 而适配器的正文一律**原样照抄、不解释**。
 */
export const LEAN4_BINDER_NAMES: readonly string[] = ["hu", "hv"]

/**
 * **第二个目标类的定理名**。与 `LEAN4_THEOREM_NAME` **必须不同**（有用例钉住）：
 * 两类如果共用一个名字，那么"第一类的一条真报告"就能让第二类的目标升到 `formally_proved` ——
 * 而它证的根本不是同一条命题。这是 `checkAxiomsReport` 里"名字逐字对上"那条判据的**前提**。
 */
export const LEAN4_PLANE_PERPENDICULAR_THEOREM_NAME = "draw_plane_perpendicular_goal"

/** 第二个目标类生成文件里的**两个前提名**（导出给用例交叉核对，与 `LEAN4_BINDER_NAMES` 同理）。 */
export const LEAN4_PLANE_PERPENDICULAR_BINDER_NAMES: readonly string[] = ["h1", "h2"]

function assertPointName(what: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_']*$/.test(value)) {
    throw new Error(`${what} 必须是 Lean 能接受的点名（字母/数字/下划线，且不以数字开头），实际是：${String(value)}`)
  }
}

/**
 * **IR → Lean 命题的模板**（这个函数**就是**文件头那张表）。
 *
 * 它做三件事，一件都不多：
 * 1. 校验点名能被 Lean 接受（**在拼字符串之前**，免得把病态输入变成奇怪的编译错误）；
 * 2. 把 `planePoints` 的前三个点变成子空间 `D` 的生成元（`span {p2 - p1, p3 - p1}`）；
 * 3. 把两条线的差向量写成命题的 `u` / `v`。
 *
 * **抛异常**是**有意**的：输入不合法（点名不像点名、平面点少于三个）属于**调用方的错误**，
 * 不是"证明失败"。这两件事在证据状态上完全不同（一个是 bug，一个是没证出来），
 * 所以不把它们压成同一个返回值。
 *
 * `maxHeartbeats` 写在文件最前面：它是**后端自带的确定性预算**（十栏 `timeoutPolicy` 的①）。
 */
export function buildPerpendicularStatement(input: Lean4ProofGoalInput, maxHeartbeats: number): Lean4GeneratedStatement {
  const goal = input.perpendicular
  if (goal === undefined) {
    throw new Error("perpendicular 目标类必须给出 perpendicular: { lineA, planePoints, lineB }（模板缺了它就无从生成命题）。")
  }
  const planePoints = goal.planePoints
  if (planePoints.length < 3) {
    throw new Error(`平面至少要有三个点才能生成方向子空间，实际给了 ${planePoints.length} 个。`)
  }
  assertPointName("lineA.first", goal.lineA.first)
  assertPointName("lineA.second", goal.lineA.second)
  assertPointName("lineB.first", goal.lineB.first)
  assertPointName("lineB.second", goal.lineB.second)
  for (const point of planePoints) assertPointName("planePoints 的每一项", point)

  const [p1, p2, p3] = planePoints as readonly [string, string, string]
  // 点只是占位符：它们的**坐标无关紧要**（命题是关于任意内积空间的），
  // 所以这里给每个点一个 `E` 上的变量，只用到"哪两个点是同一个点"这件事。
  const pointNames = new Set<string>([goal.lineA.first, goal.lineA.second, goal.lineB.first, goal.lineB.second, p1, p2, p3])
  const pointParams = [...pointNames].map((name) => `(${name} : E)`).join(" ")

  const u = `(${goal.lineA.second} - ${goal.lineA.first})`
  const v = `(${goal.lineB.second} - ${goal.lineB.first})`
  const dSpan = `Submodule.span ℝ ({${p2} - ${p1}, ${p3} - ${p1}} : Set E)`

  const statement = [
    `theorem ${LEAN4_THEOREM_NAME} {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]`,
    `    ${pointParams} (hu : ${u} ∈ (${dSpan})ᗮ) (hv : ${v} ∈ ${dSpan}) :`,
    `    inner ℝ ${u} ${v} = 0`
  ].join("\n")

  return { theoremName: LEAN4_THEOREM_NAME, ...assembleSource(statement, LEAN4_THEOREM_NAME, input.proof, maxHeartbeats) }
}

/**
 * **把 `statement` + 正文拼成一份可交给 Lean 的文件**（两个目标类共用这一段）。
 *
 * 抽出来是为了让"生成的文件长什么样"只有一处定义 —— 两类如果各写一份，`import` 行、
 * `set_option`、`#print axioms` 那三处就会悄悄分叉，而**判据恰恰依赖它们**。
 *
 * **`maxHeartbeats` 是 Lean 自己的确定性预算**（十栏 `timeoutPolicy` 的①）：
 * 触发时 Lean 报 `(deterministic) timeout at ...` 并 **exit 1**，不是挂死。
 * 进程级墙钟兜底在 runner 里（②）。
 */
function assembleSource(statement: string, theoremName: string, proof: string, maxHeartbeats: number): { source: string; statement: string } {
  const source = [
    "-- 由 @draw/agent-core 的 Lean 4 适配器生成（N5b）。**每次运行都是新的临时文件**，不进仓库树。",
    "import Mathlib.Analysis.InnerProductSpace.Orthogonal",
    "",
    `set_option maxHeartbeats ${Math.max(0, Math.floor(maxHeartbeats))}`,
    "",
    statement,
    `  := by`,
    // 证明正文**原样照抄**：适配器不解释、不改写、不"修一下"。
    ...proof.split(/\r?\n/).map((line) => `  ${line}`),
    "",
    `-- 结构化判据：问内核"这条定理到底依赖什么"。`,
    `-- ` + "`sorry` / `axiom` 都只是 warning + exit 0，所以退出码在这里不算数。",
    `#print axioms ${theoremName}`,
    ""
  ].join("\n")
  return { source, statement }
}

/** 两条点名线的**共用点**（用来把"相交"这件事从输入里读出来）。 */
function sharedPointNames(a: Lean4NamedLine, b: Lean4NamedLine): string[] {
  const inA = new Set([a.first, a.second])
  return [b.first, b.second].filter((name) => inA.has(name))
}

/**
 * **第二个目标类：线 ⊥ 面**（判定定理那一半）的模板。
 *
 * 生成的就是这个形状：
 *
 * ```lean
 * theorem draw_plane_perpendicular_goal {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]
 *     (A B C P : E) (h1 : inner ℝ (A - P) (B - A) = 0) (h2 : inner ℝ (A - P) (C - A) = 0) :
 *     (A - P) ∈ (Submodule.span ℝ ({B - A, C - A} : Set E))ᗮ
 * ```
 *
 * 读法（以"三棱锥 P-ABC 中 PA ⊥ AB、PA ⊥ AC ⇒ PA ⊥ 平面 ABC"为例）：
 * `A - P` 是那条线的方向，`B - A` / `C - A` 是平面内两条**相交**线的方向，
 * 结论就是"那个方向与由这两条方向**张成的子空间**正交" —— 即线 ⊥ 面。
 *
 * ## 与第一类的差别，以及**没有**解决的那部分
 *
 * 两个前提 `h1` / `h2` **正好是题面里那两条垂直**（不像第一类里的 `hu` 是模板塞的），
 * 所以这一类更接近"把原题前提接上来"。但**原题别的题设**（"底面 ABC 是任意三角形"、
 * "P 在平面外"…）**都不在命题里** —— 完整的前提桥（V2 缺口②）**仍然没做**。
 * 这一条要写在文档里，不许把"前提更接近题面"说成"前提桥已经做了"。
 *
 * **抛异常**与第一类同理：点名不像点名、平面线不共点，都是**调用方给错了**，
 * 不是"证明失败"—— 两者的证据状态完全不同，不压成同一个返回值。
 */
export function buildPlanePerpendicularStatement(input: Lean4ProofGoalInput, maxHeartbeats: number): Lean4GeneratedStatement {
  const goal = input.planePerpendicular
  if (goal === undefined) {
    throw new Error("planePerpendicular 目标类必须给出 planePerpendicular: { line, planeLines }（模板缺了它就无从生成命题）。")
  }
  const [lineA, lineB] = goal.planeLines
  if (lineA === undefined || lineB === undefined) {
    throw new Error("planePerpendicular 需要平面内**两条**相交直线（`planeLines` 恰好两项）。")
  }
  assertPointName("line.first", goal.line.first)
  assertPointName("line.second", goal.line.second)
  for (const [index, line] of goal.planeLines.entries()) {
    assertPointName(`planeLines[${index}].first`, line.first)
    assertPointName(`planeLines[${index}].second`, line.second)
  }

  /**
   * **"相交"只能从点名读出来** —— 两条平面线必须**恰好共用一个点名点**。
   *
   * 零个共用点 ⇒ 平行/异面，张不出平面；两个共用点 ⇒ 是**同一条**线写了两遍，
   * 那时其中一个前提是多余的、而"两条相交线"这件事根本没给。两种都**抛**。
   */
  const shared = sharedPointNames(lineA, lineB)
  if (shared.length === 0) {
    throw new Error(
      `planePerpendicular 的两条平面线必须**相交**（共用一个点名点）：收到 [${lineA.first}${lineA.second}] 与 [${lineB.first}${lineB.second}]，没有共点 —— 两条平行/异面的线张不出平面，判定定理的前提不成立。`
    )
  }
  if (shared.length > 1) {
    throw new Error(
      `planePerpendicular 的两条平面线是同一条线（共点 ${shared.join(" / ")}）—— 那不是"两条相交直线"，其中一个前提是多余的。`
    )
  }
  // 两条平面线按"从共用点出发"的方向写：这样结论里的子空间就是由它们张成的那个平面。
  const vertex = shared[0] as string
  const tipOf = (line: Lean4NamedLine): string => (line.first === vertex ? line.second : line.first)
  const dirA = `${tipOf(lineA)} - ${vertex}`
  const dirB = `${tipOf(lineB)} - ${vertex}`

  const pointNames = new Set<string>([goal.line.first, goal.line.second, vertex, tipOf(lineA), tipOf(lineB)])
  const pointParams = [...pointNames].map((name) => `(${name} : E)`).join(" ")

  const u = `(${goal.line.second} - ${goal.line.first})`
  const dSpan = `Submodule.span ℝ ({${dirA}, ${dirB}} : Set E)`
  const [h1, h2] = LEAN4_PLANE_PERPENDICULAR_BINDER_NAMES as readonly [string, string]

  const statement = [
    `theorem ${LEAN4_PLANE_PERPENDICULAR_THEOREM_NAME} {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]`,
    `    ${pointParams} (${h1} : inner ℝ ${u} (${dirA}) = 0) (${h2} : inner ℝ ${u} (${dirB}) = 0) :`,
    `    ${u} ∈ (${dSpan})ᗮ`
  ].join("\n")

  return {
    theoremName: LEAN4_PLANE_PERPENDICULAR_THEOREM_NAME,
    ...assembleSource(statement, LEAN4_PLANE_PERPENDICULAR_THEOREM_NAME, input.proof, maxHeartbeats)
  }
}

// ---------------------------------------------------------------- 结果 → 证据

/** Lean 一次运行的判定结果 —— **这就是"证明到底成没成"的唯一答案**。 */
export interface Lean4Judgement {
  status: ProofCheckStatus
  /** 给人看的说明（会原样进产物的 `result.detail`）。 */
  detail: string
  /** `verified` 时是 axioms 报告（空数组 = "不依赖任何公理"）；否则是 `null`。 */
  axioms: readonly string[] | null
}

/**
 * **按优先级判定一次 Lean 运行**（顺序本身是设计，不是随便排的）。
 *
 * 1. **后端不可用** ⇒ `unsupported`。这是"这台机器没装/没配上"，
 *    **不是**"证不出来" —— 两者对用户的意义完全不同，所以先用 `unavailableReason` 分流。
 * 2. **进程级墙钟超时**（`timedOut`）⇒ `timeout`。**不许**把被杀掉的那次算作通过，
 *    也不许拿半截输出当证据。
 * 3. **退出码非 0** ⇒ `failed`（编译错误等）。注意：**exit 0 完全不等于成功**，
 *    所以这里只是"快速失败"，真正的判定在第 5 步。
 * 4. **退出码 0 但没有 axioms 报告** ⇒ `failed`。这正是 `sorry`/`axiom` 会走到的路：
 *    它们 exit 0，所以**必须**靠报告缺失/表外公理把它们拦下来。
 * 5. **报告在白名单里** ⇒ `verified`（`axioms` 为空数组表示"不依赖任何公理"，同样通过）。
 * 6. 其余 ⇒ `failed`（表外公理，含 `sorryAx`）。
 *
 * `_proofText` 这个参数**刻意存在但不参与判定**：留在这里是为了让"正文本身不是判据"
 * 这件事在签名上就看得见（将来有人想加"正文里有 sorry 就拒"这种文本级判据时，
 * 会先读到这段注释：那是**弱**判据，`axiom` 绕得过去）。
 */
export function judgeLean4Run(run: Lean4RunResult, theoremName: string, _proofText: string): Lean4Judgement {
  if (run.unavailableReason !== undefined) {
    return { status: "unsupported", detail: `后端不可用：${run.unavailableReason}`, axioms: null }
  }
  if (run.timedOut) {
    return {
      status: "timeout",
      detail: `进程级墙钟超时（${run.durationMs} ms）：已杀进程，**不返回半成品证明**。`,
      axioms: null
    }
  }
  if (run.exitCode !== 0) {
    const diagnostics = [run.stderr, run.stdout].filter((text) => text.trim().length > 0).join("\n").trim()
    return {
      status: "failed",
      detail: `Lean 退出码 ${String(run.exitCode)}：编译/elaboration 失败。输出：${truncate(diagnostics, 1200)}`,
      axioms: null
    }
  }
  const report = checkAxiomsReport(run.stdout, theoremName)
  if (!report.passed) {
    return { status: "failed", detail: report.rejection ?? "axioms 报告未通过。", axioms: null }
  }
  return {
    status: "verified",
    detail:
      report.reportedNoAxioms
        ? "Lean 内核接受，且该定理不依赖任何公理。"
        : `Lean 内核接受，依赖的公理在白名单内：[${report.axioms.join(", ")}]。`,
    axioms: report.axioms
  }
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…（已截断，共 ${text.length} 字符）`
}

// ---------------------------------------------------------------- 产物

export interface Lean4ProduceOptions {
  /** 怎么跑 Lean。**必填** —— 这个模块自己不起进程（理由见 `Lean4Runner`）。 */
  runner: Lean4Runner
  /** 仓内那个小 Lean 工程的位置（`lake` 要在它里面跑）。由调用方给，**不写死机器路径**。 */
  projectDir: string
  /** Lean 可执行文件；缺省（或找不到）时如实报"后端不可用"。 */
  toolchain?: { leanPath: string; lakePath: string | null } | null
  /**
   * 写进产物 `backend.version` 的**实测**版本串（调用方从 `lean --version` 拿到）。
   * **不猜**：证明的可信度挂在"哪个版本"上，所以这一栏必须来自实际那次运行的输出。
   * 缺省给一个**明显是占位**的串 —— 它绝不会出现在产物里（没有版本就没有 `verified`）。
   */
  backendVersion?: string
  /**
   * 这条 claim 的 id。**适配器不猜**：`claimId` 是调用方的事。
   * 缺省（或给空串）时**不构造产物** —— 一份不知道自己在给谁作证的产物没有意义。
   */
  claimId?: string
  /** 进程级墙钟上限（毫秒），缺省 180_000。 */
  timeoutMs?: number
  /** 写进生成文件的 `maxHeartbeats`，缺省 400_000（够证这条命题，又不是无限）。 */
  maxHeartbeats?: number
}

export interface Lean4ProduceResult {
  /** 产出的产物（**只有 `verified` 时才非 `null`**）。 */
  artifact: ProofArtifact | null
  judgement: Lean4Judgement
  /** 生成的那条命题原文（**无论成没成都有** —— 它是"我们证了什么"的记录，也是 R56 绑的东西）。 */
  statement: string
  /** 这次用的输入指纹（与 `statement` 一起构成绑定）。 */
  inputHash: string
  /** 原始运行结果（诊断用）。 */
  run: Lean4RunResult | null
}

/**
 * **适配器的主入口：一条已分类的目标 ⇒ 一份产物**（或者一次如实的失败）。
 *
 * 顺序是刻意的：
 *
 * 1. **先生成命题**（模板抛异常 = 调用方给错了东西 ⇒ 直接抛，不假装"证明失败"）。
 * 2. **算输入指纹**：`prompt + claimSourceText + goal + assumptions + statement`。
 *    **`statement` 必须在这里传** —— 少了它，R56 那条绑定就退回绑定前的强度
 *    （见文件头与报告里的"残余洞"一节）。
 * 3. **跑 Lean**（`runner` 是注入的：CI 上用假的，本地用真的）。
 * 4. **判 axioms**（`judgeLean4Run`）—— 这一步**没有**模型的份。
 * 5. `verified` 才构造产物；否则 `artifact: null` + 如实的状态。
 *
 * **`result.status` 用 `judge` 的结论**：后端说 `failed` 的产物**不是**"一份合格产物"，
 * 它的 `proof` 正文只在 `verified` 时才有意义。构造 `failed` 的产物是**错的** ——
 * 那会让一份没有证明的东西在磁盘上长得像"一份证明"。
 */
export async function produceLean4Artifact(input: Lean4ProofGoalInput, options: Lean4ProduceOptions): Promise<Lean4ProduceResult> {
  // 表外目标类在这里**抛**（"调用方搞错了"该有的反应）—— 分发表是唯一一处判这点的地方。
  const spec = specForGoalKind(input, options.maxHeartbeats ?? 400_000)
  const hashInput: ProofInput = {
    prompt: input.prompt,
    claimSourceText: input.claimSourceText,
    goal: input.goalKind,
    assumptions: input.assumptions,
    // ⚠️ **R56**：这一栏就是"我们证的是哪一条命题"。缺了它，模板一改弱，旧产物照样匹配。
    statement: spec.statement
  }
  const inputHash = proofInputHash(hashInput)

  const toolchain = options.toolchain ?? null
  const run = await options.runner({
    source: spec.source,
    leanPath: toolchain?.leanPath ?? "",
    lakePath: toolchain?.lakePath ?? null,
    projectDir: options.projectDir,
    timeoutMs: options.timeoutMs ?? 180_000
  })
  const judgement = judgeLean4Run(run, spec.theoremName, input.proof)

  const claimId = options.claimId ?? ""
  if (judgement.status !== "verified" || claimId.trim().length === 0) {
    // **没有 claimId 就不构造产物**：适配器不猜"这是在给谁作证"。
    // 这一支也覆盖掉"后端不可用/失败"那几种 —— 它们本来就不该产出产物。
    const detail = claimId.trim().length === 0 && judgement.status === "verified"
      ? "Lean 验过了，但调用方没有给 `claimId` —— 不知道这条产物是给哪一条 claim 作证的，所以不产出产物。"
      : judgement.detail
    return { artifact: null, judgement: { ...judgement, detail }, statement: spec.statement, inputHash, run }
  }

  const backendVersion = options.backendVersion ?? ""
  if (backendVersion.trim().length === 0) {
    return {
      artifact: null,
      judgement: { ...judgement, detail: "Lean 验过了，但调用方没有给实测的后端版本串 —— 没有版本的证明不算证明，所以不产出产物。" },
      statement: spec.statement,
      inputHash,
      run
    }
  }

  const artifact: ProofArtifact = {
    version: PROOF_ARTIFACT_VERSION,
    claimId,
    inputHash,
    backend: { name: LEAN4_BACKEND_NAME, version: backendVersion },
    proof: input.proof,
    result: { status: "verified", detail: judgement.detail }
  }
  return { artifact, judgement, statement: spec.statement, inputHash, run }
}

/** 这个适配器产出的产物里 `backend.name` 的取值（必须与十栏记录里那个名字**逐字**相同）。 */
export const LEAN4_BACKEND_NAME = "lean4"

// ---------------------------------------------------------------- 闭环

/** 一条真实目标走完整条路之后的读数。 */
export interface Lean4ClosedLoopOutcome {
  /** `evidenceStatusWithProof` 给出的证据状态 —— **验收判据看的就是这个**。 */
  status: ClaimEvidenceStatus
  verification: ProofVerification
  /** 生成的那条命题原文（R56 绑的东西，报告里要能读到）。 */
  statement: string
  inputHash: string
  judgement: Lean4Judgement
  run: Lean4RunResult | null
}

/** 这个适配器**声称覆盖**的目标类。**加一个必须显式改这里**（见文件头"覆盖范围"）。 */
export const LEAN4_SUPPORTED_GOAL_KINDS: readonly ProofGoalKind[] = ["perpendicular", "planePerpendicular"]

/**
 * **目标类 → 模板**的分发表。
 *
 * 表外的类在这里**抛** —— 这是 `produceLean4Artifact` 的既有语义（"调用方搞错了"就该抛），
 * 与 `runLean4ClosedLoop` 的"表外 ⇒ 停在原地"是**两件事**（那个是"我们不支持这一类"的正常答案）。
 */
function specForGoalKind(input: Lean4ProofGoalInput, maxHeartbeats: number): Lean4GeneratedStatement {
  switch (input.goalKind) {
    case "perpendicular":
      return buildPerpendicularStatement(input, maxHeartbeats)
    case "planePerpendicular":
      return buildPlanePerpendicularStatement(input, maxHeartbeats)
    default:
      throw new Error(
        `Lean 4 适配器今天只覆盖 ${LEAN4_SUPPORTED_GOAL_KINDS.map((kind) => `\`${kind}\``).join(" / ")} 这些目标类，收到「${String(input.goalKind)}」—— 表外目标不许悄悄走到这里。`
      )
  }
}

/**
 * **最小闭环**：题设/目标 → Lean 命题 → 跑 Lean → 检查 axioms → 产物 → `verifyProofArtifact`
 * ⇒ `evidenceStatusWithProof`。
 *
 * 三处刻意的设计：
 *
 * - **表外目标类在这里是"停在原地"，不是抛**。理由：一条 IR 目标落到这个函数上时，
 *   调用方要的是"这条路能不能把它升上去"这个答案；表外的答案是**不能**，
 *   而那是 `unsupported` 那条**已有**的状态词，不是异常。抛会把"我们不支持这一类"
 *   与"适配器有 bug"混成一件事故。`produceLean4Artifact`（更低层的入口）**仍然抛** ——
 *   那是"调用方搞错了"该有的反应。
 * - **`expectation` 由调用方给 `claimId`**（并给目标类），但 `inputHash` **由这一层算**
 *   （用与 `produceLean4Artifact` 同一个 `statement`）。这样"绑定"在一处发生，
 *   调用方没有机会传一个与命题不符的哈希 —— 那份不符**正是 R56 要防的**。
 * - **产物只能通过 `verifyProofArtifact`**（不接受"我们刚生成的所以肯定行"）。
 *   这条很重要：它保证**生成路径与校验路径是同一条**，而不是"生成时有特权"。
 *   一份被篡改的产物（改 claimId / inputHash / 正文 / 后端名 / 版本）在这里**逐条被拒**，
 *   用的都是既有的拒绝码（`claim-mismatch` / `input-mismatch` / `missing-field` /
 *   `version-mismatch` / `backend-not-wired` / `empty-proof` / `unnamed-backend`）。
 */
export async function runLean4ClosedLoop(
  base: ClaimEvidenceStatus,
  input: Lean4ProofGoalInput,
  expectationClaimId: string,
  options: Lean4ProduceOptions & { verifyOptions?: ProofVerifyOptions }
): Promise<Lean4ClosedLoopOutcome> {
  const supported = LEAN4_SUPPORTED_GOAL_KINDS.includes(input.goalKind as ProofGoalKind)
  if (!supported) {
    const statement = `（表外目标类「${String(input.goalKind)}」：适配器只覆盖 ${LEAN4_SUPPORTED_GOAL_KINDS.join(" / ")}，所以没有生成任何命题。）`
    return {
      status: base,
      verification: {
        status: "unsupported",
        reasons: [
          {
            code: "backend-verdict",
            detail: `Lean 4 适配器今天只覆盖 \`${LEAN4_SUPPORTED_GOAL_KINDS.join(" / ")}\` 这 ${LEAN4_SUPPORTED_GOAL_KINDS.length} 个目标类，收到「${String(input.goalKind)}」—— 表外目标停在原地。`
          }
        ],
        artifact: null
      },
      statement,
      inputHash: "",
      judgement: {
        status: "unsupported",
        detail: `表外目标类「${String(input.goalKind)}」：不给它生成命题、也不给它产物（覆盖范围之外的类别不许被悄悄升级）。`,
        axioms: null
      },
      run: null
    }
  }

  const produced = await produceLean4Artifact(input, { ...options, claimId: expectationClaimId })
  const expectation: ProofExpectation = {
    claimId: expectationClaimId,
    // **同一个 `statement` ⇒ 同一个哈希**：绑定在这里发生，不在调用方。
    inputHash: produced.inputHash,
    goalKind: input.goalKind as ProofGoalKind
  }
  const artifacts = produced.artifact === null ? [] : [produced.artifact]
  const outcome = evidenceStatusWithProof(base, expectation, artifacts, options.verifyOptions)
  return {
    status: outcome.status,
    verification: outcome.verification,
    statement: produced.statement,
    inputHash: produced.inputHash,
    judgement: produced.judgement,
    run: produced.run
  }
}

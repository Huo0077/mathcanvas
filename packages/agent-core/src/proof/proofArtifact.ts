import type { ClaimEvidenceStatus } from "../claimEvidence"
import { canonicalContentHash } from "../hashing"
import type { ProofGoalKind } from "./proofGoals"
import { isReviewPassed, PROOF_BACKEND_REVIEWS } from "./proofBackendReview"

/**
 * **形式证明出口的边界**（实施计划 Phase N5 的第一步；设计 2026-10-04 §4C）。
 *
 * ## 这一层只做一件事：让"有证明"这句话**不可能随口说**
 *
 * 计划原文的判据是：`verified_instance` / `sampled` **不能**变成 `formally_proved`；
 * 伪造、缺字段、版本不匹配的产物一律**拒绝**。这一层就是把那条判据落成可执行的东西。
 *
 * 它**不做**形式化，也**不理解**证明正文 —— 正文明文照搬，一个字都不解释。真正的证明由后端
 * （Lean/mathlib 或 AlphaGeometry/Newclid 风格的 adapter）产生。**本批没有接任何后端**：
 * `proof/` 里目前只有"产物长什么样、凭什么算数"，adapter 归后一步（而且要**先过依赖与许可证审查**，
 * 见计划 N5 的那条硬要求）。
 *
 * ## 为什么校验**必须**带一个 `expectation`
 *
 * 只校验产物自身是**不够的**：一份"证明了别的东西"的合格产物可以被贴到这条 claim 上，
 * 而它看起来处处合法。所以 `verifyProofArtifact` **要求**调用方给出期望的 `claimId` 与
 * `inputHash` —— 没有"只看看形状就算通过"的那条路（fail-closed by construction）。
 *
 * ## 四个结局一个都不能少，也一个都不能多
 *
 * `verified` / `failed` / `unsupported` / `timeout`。**拒收一份产物不是第五种结局**：
 * 那意味着"这次没有得到证明"，所以报 `failed`，而**为什么拒**逐条落在 `reasons` 的
 * 机器可读 `code` 上（"它不是证明"与"它证明了别的东西"是两件事，不许混成一句）。
 */

/**
 * **这个构建里真正接上的证明后端**（今天是**空**）。
 *
 * ## 为什么必须有这张名单（上一版漏掉的那一环）
 *
 * 上一版只校验产物的**形状、版本与绑定** —— 而一份**手工编的**产物可以把这些都满足：
 * `backend.name` 写 `lean4`、`proof` 里放一段字符串、`result.status` 写 `verified`。
 * 校验器**没有任何办法**从产物本身判断"这段话真的被 Lean 内核接受过"。
 * 所以"有没有证明"这件事最终只能由**我们这边**回答：这个后端**接上了没有**。
 * 名单是空的，今天就没有任何产物能升到 `formally_proved` —— 这不是保守，这是事实。
 *
 * ## 要把一个后端加进这张名单，先过这几关（计划 N5 的硬要求）
 *
 * 许可证与依赖审查、进程 / 线程边界、WASM 或原生依赖、启动耗时、超时与失败行为 ——
 * 做法见 `docs/acceptance/next-phase-flag-and-dependency-review.md`。
 * **没有审查结论不许加进来。**
 */
export const WIRED_PROOF_BACKENDS: readonly string[] = PROOF_BACKEND_REVIEWS
  .filter((review) => isReviewPassed(review))
  .map((review) => review.name)

export interface ProofVerifyOptions {
  /**
   * 允许哪些后端。**缺省就是"一个都没接"**（`WIRED_PROOF_BACKENDS`），
   * 于是今天任何 `verified` 产物都过不去。测试可以注入一个假后端来验"这条路本身是通的"。
   */
  wiredBackends?: readonly string[]
}
/** 产物格式版本。**不匹配就拒**，不做"兼容猜测"。 */
export const PROOF_ARTIFACT_VERSION = 1

/** 后端自己的判定。**只有 `verified` 能让一条 claim 升到 `formally_proved`。** */
export type ProofCheckStatus = "verified" | "failed" | "unsupported" | "timeout"
export const PROOF_CHECK_STATUSES: readonly ProofCheckStatus[] = ["verified", "failed", "unsupported", "timeout"]

export interface ProofBackendIdentity {
  /** 后端名（例如 `lean4` / `newclid`）。空名字一律拒 —— 说不清是谁证的不算证。 */
  name: string
  version: string
}

export interface ProofArtifact {
  version: number
  /** 这份产物证明的是**哪一条** claim。 */
  claimId: string
  /** 它是对**哪一份输入**证出来的（见 `proofInputHash`）。输入变了，产物就失效。 */
  inputHash: string
  backend: ProofBackendIdentity
  /** 后端自己的证明正文。本模块**不解释**它。 */
  proof: string
  result: { status: ProofCheckStatus; detail: string }
}

/** 调用方期望这份产物证明什么。**三个字段都必须给** —— 见文件头"为什么必须带 expectation"。 */
export interface ProofExpectation {
  claimId: string
  inputHash: string
  /**
   * 这条 goal 属于哪个**已声明**的短目标（`proofGoals.ts` 的封闭词表）。
   *
   * **`null` 表示"它不在我们声称支持的首批里"**，此时无论产物多合法都**不许**升级 ——
   * 这就是"表外目标绝不变成 `formally_proved`"那条判据的落点。刻意不做成可选参数：
   * 调用方**必须**显式回答这个问题，而不是靠默认值蒙过去。
   */
  goalKind: ProofGoalKind | null
}

export type ProofRejectionCode =
  /** 根本不是对象（模型直接给了一句话 / 一个数组）。 */
  | "not-an-object"
  /** 缺必需字段。 */
  | "missing-field"
  /** 字段类型不对。 */
  | "wrong-type"
  /** `result.status` 不在四个结局里。 */
  | "unknown-status"
  /** 产物版本与本模块不一致。 */
  | "version-mismatch"
  /** 声称 `verified` 却拿不出正文。 */
  | "empty-proof"
  /** 声称 `verified` 却说不清是哪个后端（空名字）。 */
  | "unnamed-backend"
  /** 产物证明的是另一条 claim。 */
  | "claim-mismatch"
  /** 产物是对另一份输入证出来的 —— 输入变了，它就不再证明这件事。 */
  | "input-mismatch"
  /** 这条 goal 不在我们声称支持的首批短目标里（`proofGoals.ts`）—— 表外目标绝不升级。 */
  | "undeclared-goal"
  /** 产物自称来自一个**没有接进这个构建**的后端：形状再合格也不等于真的验过。 */
  | "backend-not-wired"
  /** 产物自身合法，是**后端**报的 failed / unsupported / timeout。 */
  | "backend-verdict"

export interface ProofRejection {
  code: ProofRejectionCode
  detail: string
}

export interface ProofVerification {
  status: ProofCheckStatus
  /** `verified` 时为空；其余情况逐条说明。 */
  reasons: ProofRejection[]
  /** 只有结构、版本、绑定**全部**通过时才是那份产物；否则 `null`。 */
  artifact: ProofArtifact | null
}

/** `proofInputHash` 的入参。**每一栏都是"这份证明到底在说什么"的一部分**，不是可选的修饰。 */
export interface ProofInput {
  /** 题设原话（用户的原始表述）。 */
  prompt: string
  /** 这条 claim 的原话（不是 id —— id 会因为重新编号而漂移，原话不会）。 */
  claimSourceText: string
  /** 这条 goal 属于哪一类短目标（可选：`proofGoals.ts` 的词表项）。 */
  goal?: string
  /**
   * **系统替用户定的假设**（`witnessSearch` 那条 `assumptions`：多给了一条约束、把某个自由点钉在
   * 示例坐标上等等）。**必绑**，理由见下面 `proofInputHash` 的注释。
   */
  assumptions?: readonly string[]
  /**
   * **被证明的那条命题本身**（适配器由 IR 生成的命题原文，例如 Lean 里那句 `theorem ... : ...`）。
   * **必绑**，理由见下面 `proofInputHash` 的注释。今天没有适配器，所以它是可选的 ——
   * 但**接后端的那一天，适配器必须传它**，否则第一批产物的绑定就是松的。
   */
  statement?: string
}

/**
 * **证明输入的指纹**：题设原话 + 这条 claim 的原话 + 目标 + **系统替你定的假设** +
 * **被证明的那条命题原文**。**不绑**文档内容指纹（坐标 / 形状 / 标签）。
 *
 * 用仓库既有的 `canonicalContentHash`（与别处**同一份**规范化与散列），不另写一套 ——
 * 两套散列会在"输入到底变没变"这件事上给出两个答案。
 *
 * ## 这条边界**已裁决**（2026-10-05，R51 + R56；此前这里是"没有裁决"）
 *
 * **必绑**：题设原话 + claim 原话 + 目标 + 假设 + 命题原文。**不绑**：文档内容指纹。
 * 三条失效模式是这条裁决的实质 —— 全都是"让信号说错话"，只是方向不同：
 *
 * - **不绑假设 ⇒ 过度声称**。后端可能是带着"系统替你定的第 N 条假设"（例如多给了一条约束）
 *   证出来的。哈希只覆盖原文，这份产物就会被摆在一个**更弱**的命题旁边，读起来像
 *   "题设本身已被证明"。这比假过期严重得多，所以 `assumptions` 必须进哈希。
 * - **不绑命题 ⇒ 假有效**（R56）。`proof` 正文是后端语言的脚本，而"它证的是哪一条命题"是
 *   **我们适配器生成的**（IR → 命题模板）。模板一变弱，旧产物的题设/claim/目标一字未变、
 *   `inputHash` 仍然匹配、仍然被判 `verified`，但它证的是**另一条更弱的命题**。
 * - **绑文档指纹 ⇒ 假过期**。形式证明的对象是**命题**（"在题设下普遍成立"），不是某一张图；
 *   绑坐标会把"证明"降级成"这一次实例的检查"，还会被**无关编辑**刷掉（改个 `label`/`alias`、
 *   重新求解恰好选到另一组坐标）。假过期与假绿同源，而且更坏 —— 它训练人**忽略**失效提示。
 *   落地方式：这个入参里**根本没有**文档指纹这一栏（不是"默认不传"）。
 *   要绑文档的调用方应当直接用 `canonicalContentHash`，而不是把这个哈希的含义搅浑。
 *
 * ## 为什么是 ① 命题原文，而不是 ② 模板 id + 版本（R56 给的两个选项）
 *
 * 两条我都核过，选 ①：
 *
 * - **② 今天没有可指的东西**。这个仓里**没有**"命题模板注册表"这种东西（`proofGoals.ts` 是
 *   目标词表，不是模板）。选 ② 等于先发明一套 `id + version` 命名空间，而它唯一的消费者
 *  （适配器）还不存在 —— 那就是把一个**没有生产者**的契约写进绑定里。
 * - **② 的保证挂在一条靠人守的纪律上**，而它失败的形态正是 R56 点名的那个：有人改了模板、
 *   忘了升版本 ⇒ 旧证明被挂到新命题上。**那种错看起来完全正常**，没有任何东西会报警。
 *   ① 里没有可以忘记的步骤：命题正文一改，哈希**必然**变。这与 `proofBackendReview.ts`
 *   的取向一致 —— "在结构上做不到，而不是靠记性"。
 * - **① 的代价我认**：命题正文必须在算哈希的那一刻就拿到（适配器刚生成它，所以拿得到），
 *   而且它进了绑定（这正是目的）。哈希本身是定长输出，所以"更长"不成立。
 * - **什么会让我改选 ②**：如果命题正文在核验那一刻**不可复现**（例如由模型现场生成的自由文本），
 *   ① 就无从比对，那时才轮到 ②。今天不是这种情况：命题是适配器从 IR **确定性**生成的。
 *
 * ## 规范化（两条，都会改变哈希值；不写下来就等于没定）
 *
 * 1. **顺序不影响哈希**：调用方给的顺序可能不同（搜索顺序、集合迭代顺序），所以先排序。
 * 2. **重复项按一条算**：假设的**文本就是这条假设本身**，重复只可能来自"同一条被推导了两次"；
 *    让计数参与哈希只会把这种无关变化变成**假过期**。反过来，去重**不会**制造假有效 ——
 *    两条逐字相同的字符串不可能指两条不同的假设。
 * 3. **空数组与不传同哈希**：不传就是"没有假设"，而"没有假设"的空列表**就是**空列表；
 *    同一份输入得到两个答案会让"输入到底变没变"失去意义。（`canonicalize` 会把 `undefined`
 *    的键整个丢掉，所以这里必须显式折成 `[]`。）
 *
 * **没有做的规范化（也是决定）**：不 `trim()`。假设文本按**逐字**比较 —— 多一个空格就是
 * 另一条假设。再加一层"哪些差异不算差异"的判断会引入第二个没人要求的规则，而它一旦判断错，
 * 就是**假有效**那一侧的错误。
 *
 * 空字符串**不**折成"没有"：与既有的 `goal` 一致（`goal: ""` 与不传今天就是两个哈希），
 * 本任务不改 `goal` 的语义。
 */
export function proofInputHash(input: ProofInput): string {
  return canonicalContentHash({
    prompt: input.prompt,
    claim: input.claimSourceText,
    goal: input.goal ?? null,
    assumptions: [...new Set(input.assumptions ?? [])].sort(),
    statement: input.statement ?? null
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function reject(status: ProofCheckStatus, code: ProofRejectionCode, detail: string): ProofVerification {
  return { status, reasons: [{ code, detail }], artifact: null }
}

/**
 * **校验一份产物**：形状 → 版本 → 绑定 → 后端判定。
 *
 * 只要任何一步不过，返回的 `artifact` 就是 `null` —— 调用方拿不到"半个产物"去贴到别处。
 * 输入来自不可信的一侧（模型），所以这里**不抛异常**：坏形状退化成 `failed` + `reasons`。
 */
export function verifyProofArtifact(artifact: unknown, expectation: ProofExpectation, options: ProofVerifyOptions = {}): ProofVerification {
  const record = asRecord(artifact)
  if (record === null) return reject("failed", "not-an-object", "证明产物必须是一个对象。")

  for (const field of ["version", "claimId", "inputHash", "backend", "proof", "result"]) {
    if (!(field in record)) return reject("failed", "missing-field", `证明产物缺少字段 ${field}。`)
  }
  if (typeof record.version !== "number") return reject("failed", "wrong-type", "version 必须是数字。")
  if (typeof record.claimId !== "string" || typeof record.inputHash !== "string") {
    return reject("failed", "wrong-type", "claimId 与 inputHash 必须是字符串。")
  }
  if (typeof record.proof !== "string") return reject("failed", "wrong-type", "proof 必须是字符串。")

  const backend = asRecord(record.backend)
  if (backend === null || typeof backend.name !== "string" || typeof backend.version !== "string") {
    return reject("failed", "wrong-type", "backend 必须是 { name, version } 且两者都是字符串。")
  }
  const result = asRecord(record.result)
  if (result === null || typeof result.detail !== "string") {
    return reject("failed", "wrong-type", "result 必须是 { status, detail } 且 detail 是字符串。")
  }
  if (!PROOF_CHECK_STATUSES.includes(result.status as ProofCheckStatus)) {
    return reject("failed", "unknown-status", `result.status「${String(result.status)}」不在词表里：${PROOF_CHECK_STATUSES.join(" / ")}`)
  }
  const status = result.status as ProofCheckStatus

  /**
   * **表外目标绝不升级**：这一步与产物自身是否合法无关，所以放在绑定检查之前 ——
   * 一份"证明了别的东西"的产物会先撞上这条，报的是"这个目标我们不声称支持"，
   * 而不是让调用方误以为"产物有问题、但目标本身是支持的"。
   */
  if (expectation.goalKind === null) {
    return reject("failed", "undeclared-goal", "这条目标不在形式证明出口声称支持的首批短目标里（见 proofGoals.ts 的支持矩阵）：不许升级成 formally_proved。")
  }
  if (record.version !== PROOF_ARTIFACT_VERSION) {
    return reject("failed", "version-mismatch", `产物版本 ${record.version} 与本模块的 ${PROOF_ARTIFACT_VERSION} 不一致：不做兼容猜测。`)
  }
  if (record.claimId !== expectation.claimId) {
    return reject("failed", "claim-mismatch", `产物证明的是「${record.claimId}」，而这里是「${expectation.claimId}」。`)
  }
  if (record.inputHash !== expectation.inputHash) {
    return reject("failed", "input-mismatch", "产物是对另一份输入证出来的：输入变了，它就不再证明这件事。")
  }

  const verified: ProofArtifact = {
    version: record.version,
    claimId: record.claimId,
    inputHash: record.inputHash,
    backend: { name: backend.name, version: backend.version },
    proof: record.proof,
    result: { status, detail: result.detail }
  }

  if (status !== "verified") {
    // 产物自身合法，是**后端**说没证成 —— 如实转述，不替它加分也不替它减分。
    return { status, reasons: [{ code: "backend-verdict", detail: result.detail }], artifact: null }
  }
  if (backend.name.trim().length === 0) {
    return reject("failed", "unnamed-backend", "声称 verified 却说不清是哪个后端：没有名字的证明不算证明。")
  }
  if (record.proof.trim().length === 0) {
    return reject("failed", "empty-proof", "声称 verified 却拿不出证明正文。")
  }
  /**
   * **最后一道，也是最要紧的一道**：这个后端**接上了没有**。
   * 前面几条只能证明"这份产物长得像一份证明"；只有这一条问的是"我们真的跑过它吗"。
   */
  const wired = options.wiredBackends ?? WIRED_PROOF_BACKENDS
  if (!wired.includes(backend.name)) {
    return reject("failed", "backend-not-wired", `后端「${backend.name}」没有接进这个构建（当前接上的：${wired.length === 0 ? "一个都没有" : wired.join(" / ")}）：形状合格的产物不等于真的验过。`)
  }

  return { status: "verified", reasons: [], artifact: verified }
}

export interface ProofEvidenceOutcome {
  /**
   * 这条 claim 应该显示的**证据状态**。没有合格产物时**恒等于 `base`** ——
   * 这就是计划那条判据（`verified_instance` / `sampled` 不能变成 `formally_proved`）的落点。
   */
  status: ClaimEvidenceStatus
  verification: ProofVerification
}

/**
 * **把一条 claim 的证据状态升级成 `formally_proved`** —— 只有在该 claim 有一份
 * `verified`、且绑定到**同一份输入**的产物时才升。其余一切情况原样返回 `base`。
 *
 * 传进来的 `artifacts` 是不可信的一侧给的（可能是模型贴的），所以逐份校验；
 * 多份里只要有一份真通过就用它，一份都没有就带上**第一份失败的原因**（便于诊断）。
 */
export function evidenceStatusWithProof(
  base: ClaimEvidenceStatus,
  expectation: ProofExpectation,
  artifacts: readonly unknown[],
  options: ProofVerifyOptions = {}
): ProofEvidenceOutcome {
  let firstFailure: ProofVerification | null = null
  for (const artifact of artifacts) {
    const verification = verifyProofArtifact(artifact, expectation, options)
    if (verification.status === "verified") return { status: "formally_proved", verification }
    if (firstFailure === null) firstFailure = verification
  }
  return {
    status: base,
    verification: firstFailure ?? reject("unsupported", "backend-verdict", "没有任何与本条 claim、这份输入绑定的证明产物。")
  }
}

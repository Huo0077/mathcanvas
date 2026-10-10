/**
 * **接一个证明后端之前必须先交的审查记录**（实施计划 N5）。
 *
 * ## 计划原文要求的是"先输出这些，再谈支持"
 *
 * > Proof spike：创建 `scripts/proof-spike/` 的 adapter smoke runner；**先输出后端版本/许可证/进程模型/
 * > WASM 或原生依赖/启动耗时/超时状态**，未通过依赖审查时只允许 `unsupported`。
 * >
 * > 依赖审查任务（**必须在 GREEN 前完成**）：记录许可证、进程/线程边界、WASM/原生依赖、缓存/沙箱、
 * > 启动时间和失败/超时行为；**没有审查结论不得接入默认构建**。
 *
 * 这一层把那句话变成**可执行的门**：接后端不再是"往数组里加一个名字"，而是**交一份填满的记录**。
 * `WIRED_PROOF_BACKENDS` 由通过的记录**推导**出来（见 `proofArtifact.ts`），所以"没审查就接上"这件事
 * 在结构上做不到 —— 而不是靠记性。
 *
 * ## 为什么必须有"版本"和"超时行为"这两栏
 *
 * - **版本**：证明产物的可信度挂在"哪个后端、哪个版本"上。只写 `lean4` 而不写版本，等于把一年后的
 *   另一个 `lean4` 也算进来 —— 那正是"同一份产物在不同后端下可信度不同"这件事被抹掉的地方。
 * - **超时/失败行为**：一个会在超时后**返回半成品证明**的后端，比一个直接失败的后端危险得多。
 *   所以这两栏问的不是性能，是**产物还值不值得信**。
 *
 * ## 这份表原来是空的，2026-10-06 起有了一条（`lean4`）
 *
 * 空表那阵子的三句话是同一个事实的三种说法：一个后端都没接 ⇒ 没有任何记录 ⇒
 * `WIRED_PROOF_BACKENDS` 是空数组 ⇒ 任何产物都升不到 `formally_proved`。
 * 现在 `lean4` 过了十栏准入，那三句话同时翻转：名单变成 `["lean4"]`。
 * **每一栏的实测命令与原始输出在 `task-5b-report.md` 里**（这里只写结论与依据要点）。
 */

/** 审查记录点名的字段。计划里列的那些**一个都不能少**。 */
export const PROOF_BACKEND_REVIEW_FIELDS = [
  "name",
  "version",
  "license",
  "processModel",
  "nativeOrWasmDependencies",
  "startupBudgetMs",
  "timeoutPolicy",
  "failureBehaviour",
  "cacheAndSandbox",
  "verdict"
] as const

/**
 * 后端跑在哪儿。**显式枚举**而不是自由文本：这一栏的用途是让审查者一眼看出
 * "它会不会起子进程 / 要不要加载原生库"，自由文本做不到这件事。
 */
export type ProofProcessModel = "in-process" | "child-process" | "wasm" | "remote-service" | "none"
export const PROOF_PROCESS_MODELS: readonly ProofProcessModel[] = ["in-process", "child-process", "wasm", "remote-service", "none"]

export type ProofReviewVerdict = "passed" | "rejected" | "not-reviewed"

export interface ProofBackendReview {
  /** 后端名。与产物 `backend.name` **逐字**对应 —— 大小写不同就是另一个后端。 */
  name: string
  version: string
  license: string
  processModel: ProofProcessModel
  /** 原生 / WASM 依赖。**纯 JS 后端写空数组**，但这一栏必须存在（"查过了，没有"要写出来）。 */
  nativeOrWasmDependencies: readonly string[]
  /** 启动耗时预算（毫秒）。**必须是一个有限的非负数** —— 写"很快"不算。 */
  startupBudgetMs: number
  timeoutPolicy: string
  failureBehaviour: string
  cacheAndSandbox: string
  verdict: ProofReviewVerdict
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * 逐条点名这份记录**哪里不够**。返回空数组才算填齐。
 *
 * 说明性文字（超时策略 / 失败行为 / 缓存与沙箱）只要求非空 —— **本层不判断它们写得对不对**，
 * 那是人的审查结论；本层只保证"没有一栏被悄悄跳过"。
 */
export function reviewProblems(review: unknown): string[] {
  if (review === null || typeof review !== "object" || Array.isArray(review)) return ["审查记录必须是一个对象"]
  const record = review as Record<string, unknown>
  const problems: string[] = []

  for (const field of PROOF_BACKEND_REVIEW_FIELDS) {
    if (!(field in record)) problems.push(`缺少字段 ${field}`)
  }
  if (problems.length > 0) return problems

  for (const field of ["name", "version", "license", "timeoutPolicy", "failureBehaviour", "cacheAndSandbox"] as const) {
    if (!nonEmptyString(record[field])) problems.push(`${field} 必须是非空字符串（"没查"不能写成空）`)
  }
  if (!PROOF_PROCESS_MODELS.includes(record.processModel as ProofProcessModel)) {
    problems.push(`processModel「${String(record.processModel)}」不在词表里：${PROOF_PROCESS_MODELS.join(" / ")}`)
  }
  if (!Array.isArray(record.nativeOrWasmDependencies)) {
    problems.push("nativeOrWasmDependencies 必须是数组（没有原生/WASM 依赖就写空数组，别省掉这一栏）")
  } else if (record.nativeOrWasmDependencies.some((entry) => !nonEmptyString(entry))) {
    problems.push("nativeOrWasmDependencies 里有空项")
  }
  if (typeof record.startupBudgetMs !== "number" || !Number.isFinite(record.startupBudgetMs) || record.startupBudgetMs < 0) {
    problems.push("startupBudgetMs 必须是有限的非负数（单位毫秒）")
  }
  if (!["passed", "rejected", "not-reviewed"].includes(record.verdict as string)) {
    problems.push(`verdict「${String(record.verdict)}」不在词表里：passed / rejected / not-reviewed`)
  }
  return problems
}

/**
 * **这份审查记录能不能让后端进默认构建** —— 只有"填齐了**并且**结论是 `passed`"才算。
 *
 * 两种"不算"要分清：**填不齐**（`reviewProblems` 非空）与**填齐了但结论不是 `passed`**
 *（例如评审发现许可证有问题）。两者都挡住接入，但理由不同。
 */
export function isReviewPassed(review: unknown): boolean {
  return reviewProblems(review).length === 0 && (review as ProofBackendReview).verdict === "passed"
}

/**
 * **交过审查记录的后端**（2026-10-06 起：**恰好一个 —— `lean4`**）。
 *
 * 接一个后端 = 往这里加一份**十栏填齐、`verdict: "passed"`** 的记录，
 * `WIRED_PROOF_BACKENDS` 会自动把它接上。**没有"偷偷改那个字符串数组"这条路** ——
 * 这正是本文件存在的理由。
 *
 * ## `lean4` 这一份记录的每一栏是怎么来的（全文与原始输出在 `task-5b-report.md`）
 *
 * - `version`：`lean --version` 的**逐字**输出（含 commit，不只写版本号）。
 * - `license`：读安装目录 `toolchains/leanprover--lean4---v4.34.1/LICENSE` 的**正文首行**，不是引用官网。
 * - `processModel`：我们 `spawn` 子进程跑 `lake env lean`。
 * - `nativeOrWasmDependencies`：`ls` 工具链 `bin/` 得到的**实际**文件清单（11 exe + 9 dll）。
 * - `startupBudgetMs`：`lean --version` 三次秒表读数。
 * - `timeoutPolicy`：Lean 自己的 `maxHeartbeats` 实测（报错 + exit 1）+ 适配器的进程级墙钟兜底。
 * - `failureBehaviour`：**`sorry` / 自定义 `axiom` 都 exit 0** 的实测 —— 本记录最要紧的一栏。
 * - `cacheAndSandbox`：工具链与 mathlib 展开后的实际磁盘占用 + 取缓存那一步的位置。
 * - `verdict`：人的审查结论（上面几条都有可复算依据、且没有未解释的失败）。
 */
export const PROOF_BACKEND_REVIEWS: readonly ProofBackendReview[] = [
  {
    name: "lean4",
    /**
     * **实测**（2026-10-06，本机 `%USERPROFILE%\.elan`）：
     * ```
     * Lean (version 4.34.1, x86_64-w64-windows-gnu, commit 5045d0056413266e57c625dcd7c365b10e377c52, Release)
     * ```
     * 只写 `4.34.1` 不够 —— 同一个版本号将来可能被打上别的 commit。
     *
     * **一处必须写明的错位（实测出来的）**：mathlib 官方缓存（`.olean`）是用
     * `leanprover/lean4:v4.35.0-rc3` 建出来的（mathlib 自己的 `lean-toolchain` 里写着那个版本），
     * 所以仓内那个 Lean 工程**必须**钉 `v4.35.0-rc3`；用 `v4.34.1` 去读它，Lean 报
     * `failed to read file '...\Mathlib.olean', incompatible header`。
     * ⇒ **core-only 证明用 4.34.1，mathlib 证明用 4.35.0-rc3**，而运行时到底用哪个由
     * 工程自己的 `lean-toolchain` 决定（适配器读 `lean --version` 得实际值，不猜）。
     */
    version: "Lean 4.34.1 (x86_64-w64-windows-gnu, commit 5045d0056413266e57c625dcd7c365b10e377c52, Release); mathlib 闭包实际用 leanprover/lean4:v4.35.0-rc3 (commit 470d5ce1400764999581fd26d5d72b00d990b0f4)；**mathlib 的 revision 已 pin**（`lakefile.toml` 的 `rev = c20717eaa791af9dd3f7847f5ba91623bda9ab6b`，`lake-manifest.json` 一并提交）—— 2026-10-10 实测该 rev 下 `DrawProof.lean` exit 0、三条真命题都只依赖白名单里的三个公理",
    /** **实测**：读安装目录里的 LICENSE 首行 ⇒ `Apache License 2.0 (Apache)`。 */
    license: "Apache License 2.0（读自工具链安装目录里的 LICENSE 正文，不是引用官网）",
    /** 我们**起子进程**跑 `lean` / `lake`：证明状态不在本进程的内存里，产物必须靠正文 + axioms 报告。 */
    processModel: "child-process",
    /**
     * **实测**：工具链 `bin/` 下的实际文件 —— 11 个 exe + 9 个 dll（含整个 LLVM/clang 运行时）。
     * 这一栏回答"它会不会加载原生库"：**会，而且是相当大的一份**。
     */
    nativeOrWasmDependencies: [
      "bin/lean.exe", "bin/lake.exe", "bin/leanc.exe", "bin/clang.exe", "bin/lld.exe", "bin/ld.lld.exe",
      "bin/llvm-ar.exe", "bin/cadical.exe", "bin/leanchecker.exe", "bin/leanir.exe", "bin/leantar.exe",
      "bin/libLLVM-22.dll", "bin/libleanshared.dll", "bin/libleanshared_1.dll", "bin/libleanshared_2.dll",
      "bin/libc++.dll", "bin/libclang-cpp.dll", "bin/libInit_shared.dll", "bin/libLake_shared.dll", "bin/zlib1.dll"
    ],
    /**
     * **实测**：`lean --version` 三次 **138 / 134 / 125 ms**（直接调工具链的 `bin/lean.exe`）。
     *
     * **⚠️ 同一件事有两个数，两个都实测过**：走 `~/.elan/bin/lean.exe`（elan 的**垫片**）是
     * **1657 / 1799 / 1865 ms** —— 慢一个量级。适配器因此**优先解析到工具链自己的 `bin/`**，
     * 垫片只当兜底（解析顺序见 `lean4Toolchain.ts`）。
     *
     * **这一栏刻意只覆盖"起进程"**：一次 mathlib 证明的墙钟是几十秒量级
     * （**导入 mathlib**，不是启动），混成一个数这一栏就没有意义了。
     *
     * **⚠️ 成本口径对账（2026-10-06 控制器）**：这里早先写的是 **≈52 s（窄 import）/ ≈118 s（`import Mathlib`）** ——
     * 那是**另一套测量条件**下取的数。**仓内工程上的端到端实测是**：
     * `IMPORT-WIDTH narrow=68317 ms / full=149532 ms`（第一次）与 **`narrow=67800 ms / full=157315 ms`**（第二次），
     * **两次都 `exit=0`（都是有效的成功运行）**。⇒ **以仓内实测为准，量级是"窄 ≈68 s / 宽 ≈150–157 s"**；
     * 早先那对数是**旧的、条件不同的**，**不要**再当成本现状引用（两个数并存而不说明口径正是本仓要避免的事）。
     *
     * 预算取 2000 ms：比垫片的实测最坏值（1865 ms）宽一点，好让"垫片这条路变慢"能被发现。
     */
    startupBudgetMs: 2000,
    /**
     * **两层，都实测过**：
     *
     * ① **后端自带的确定性预算**（首选）：`set_option maxHeartbeats 100` 实测得到
     * ```
     * error: (deterministic) timeout at `whnf`, maximum number of heartbeats (100) has been reached
     * ```
     * 且 **exit 1** —— 它是**报错**，不是挂死。适配器把 `maxHeartbeats` 写进生成的命题文件。
     * ② **进程级墙钟兜底**（必须有）：mathlib 导入本身就可能几十秒，而 heartbeats 只约束
     * elaboration；适配器另设墙钟上限（默认 180 s，可配），超时**杀进程**并如实报 `timeout`，
     * **绝不返回半成品证明**。
     */
    timeoutPolicy: "两层：① 生成的命题文件里写 `set_option maxHeartbeats <预算>`，由 Lean 自己报确定性超时（实测 error + exit 1，不是挂死）；② 适配器另设进程级墙钟上限（默认 180 s），超时杀进程并报 timeout，绝不返回半成品。",
    /**
     * **⚠️ 本记录里最要紧的一栏（全都是实测）**：
     *
     * - 编译错误 ⇒ stderr + **exit 1**（这条是安全的）。
     * - **`sorry` 只给 warning、exit 0**（实测原文 `warning: declaration uses 'sorry'`，退出码 **0**）。
     * - **用户自定义 `axiom` 同样 exit 0**（连 warning 都不必有）。
     *
     * ⇒ **只看退出码的适配器会把空洞证明判成通过** —— 那正是"看起来绿、实际什么都没证明"。
     * 适配器因此**必须**走另一条结构化判据：生成的文件里对**我们自己那条定理**调
     * `#print axioms`，把报告结果与白名单 `{propext, Classical.choice, Quot.sound}` 逐项比对；
     * `sorryAx` 与一切表外公理（含**用户自定义 axiom 的名字**）一律拒。
     *
     * **判据解析不出来也拒**（fail-closed）：没看到那条定理的 axioms 报告 = 没有证据，
     * 而不是"没有公理"。
     */
    failureBehaviour: "编译错误 ⇒ stderr + exit 1（安全）。但 `sorry` 与用户自定义 `axiom` **退出码仍是 0**（sorry 只给 warning）⇒ 只看退出码会把空洞证明判成通过。适配器改为检查 `#print axioms <本定理>` 的报告：只允许 {propext, Classical.choice, Quot.sound}，`sorryAx` 与一切表外公理（含自定义 axiom 名）一律拒；报告缺失或解析不出也拒。",
    /**
     * **实测**：`~/.elan/toolchains/leanprover--lean4---v4.34.1` = **3095.9 MB**；
     * mathlib 展开后的工程 `.lake` = **7.52 GB**（每工程一份）；用户级压缩缓存
     * `~/.cache/mathlib` = **0.42 GB / 9001 文件**（可复用）。
     *
     * **沙箱**：证明过程**只需要本地文件、不需要网络** —— 唯一需要网络的是取 mathlib 缓存
     * （`lake update` / `lake exe cache get`），那一步是**预取**、不在证明路径上。
     * 所以证明运行可以放在无网络沙箱里。
     *
     * **未测**：还没在"只读文件系统 + 无网络"的真实沙箱里跑过证明（需要另一台机器/另一个环境）；
     * 本机是普通用户目录，没有强制沙箱。
     */
    cacheAndSandbox: "工具链 3095.9 MB（实测）；mathlib 展开后每工程一份 7.52 GB；用户级压缩缓存 ~/.cache/mathlib 0.42 GB / 9001 文件可复用。证明运行只需本地文件、不需网络；取缓存的 `lake exe cache get` 属于预取，不在证明路径上。强沙箱（只读 + 无网络）下的证明运行**未测**。",
    /** 人的审查结论：上面九栏都有可复算的依据、且没有未解释的失败 ⇒ 通过。 */
    verdict: "passed"
  }
]

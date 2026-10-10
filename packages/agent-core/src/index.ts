export * from "./actionSchemas"
export * from "./actionIds"
/**
 * **benchmark 的题集与报告契约**（子任务 N4a 从 `scripts/agent-benchmark/` 搬进来）。
 *
 * 它进包根是因为**应用侧要用同一份**：`scripts/` 不是工作区，应用拿不到它，
 * 于是"bench 的 21 条"与"应用内那套旧 8 题"曾经是两份真相。`./benchmark` 的题集是
 * **文本常量**（不是读文件），所以浏览器也能 import —— 见
 * `apps/web/src/agent/fixtures/benchmarkContract.test.ts` 那条应用侧判据。
 */
export * from "./benchmark"
export * from "./budget"
export * from "./capabilities"
export * from "./claimEvidence"
export * from "./committerAdapter"
export * from "./constraintIR"
export * from "./contracts"
export * from "./contextBuilder"
export * from "./coordinator"
export * from "./coordinatorPorts"
export * from "./defaultPolicies"
export * from "./derivedPrimitives"
export * from "./diagramObligations"
export * from "./diagramVerification"
export * from "./draftCounts"
export * from "./events"
export * from "./geometryIntent"
export * from "./localPlanDefaults"
export * from "./modelEvents"
export * from "./modelGateway"
export * from "./obligationIR"
export * from "./outputParser"
export * from "./proof/proofArtifact"
export * from "./proof/proofBackendReview"
export * from "./proof/proofGoals"
/**
 * **前提桥**（V2 GREEN 缺口②的后半）：把"命题要的前提"逐条对照原题题面，
 * 分成「题面给的 / 图形蕴含的 / 凭空编的」三类；有第三类就不许往下走。
 */
export * from "./proof/proofPremiseBridge"
/**
 * **产品侧自动调用与产物通道**（V2 GREEN 缺口③）：先问该不该跑（旗 / 正文 / 目标类 / 前提），
 * 再看跑出来什么；通道是注入的端口（桌面壳里是 Tauri 命令，浏览器里"不可用"）。
 */
export * from "./proof/automaticProof"
/**
 * **题面的目标句 → 结构化的证明目标**（复用题设那张句型表，不新写解析器）。
 */
export * from "./proof/proofGoalReader"
/**
 * **Lean 4 适配器**（N5b）。桶导出是**必须**的：`WIRED_PROOF_BACKENDS` 在 `proofArtifact.ts` 里，
 * 而"接上了谁"与"怎么用它"是同一件事的两半。两个模块都**零 `node:` import**
 *（runner 由调用方注入），所以浏览器打包不会因为这一行而需要 Node 内置模块。
 */
export * from "./proof/lean4Adapter"
export * from "./proof/lean4Toolchain"
/**
 * **Node 那一层**（真的起 `lean.exe`）**刻意不进包根**：它 import `node:child_process` 等内建模块，
 * 只有在那条**显式调用**的证明路径上才会被用到。桶里少这一行，`apps/web` 的打包图就不会
 * 因为这个适配器多出 Node 内置依赖（`lean4Adapter.ts` 自己零 `node:` import）。
 * 用法：`import { createLean4Runner } from "@draw/agent-core/src/proof/lean4Runner"`（测试）或
 * 从 `scripts/` 里直接用相对路径 import。
 */
export * from "./parameterAudit"
export * from "./planCompiler"
/**
 * Provider 配置契约（Task 1.3）。
 *
 * **逐项导出而不是 `export *`**：这份文件里有三个名字与既有模块撞了 ——
 * `ProviderProfile`（`modelGateway` 有一份"网关视角"的简化版）、`CapabilityStatus` /
 * `CAPABILITY_STATUSES`（`capabilities` 做的是"能力注册表视角"）。
 * 三类东西**确实**是不同的东西（配置里的能力证据带时间与失败原因；网关只关心三档；
 * 注册表讲的是"这个动作可不可用"），所以**不合并**；但同名会让 `export *` 直接编译失败。
 * 显式列出导出什么，同时也是在说清"这个模块对外提供哪些名字"。
 */
export {
  DIALECTS_BY_PROTOCOL,
  MAX_MODEL_ID_LENGTH,
  NETWORK_POLICIES,
  PROVIDER_CAPABILITY_STATUSES,
  PROVIDER_DIALECTS,
  PROVIDER_PROTOCOLS,
  containsSecretField,
  isCapabilityVerified,
  normalizeBaseUrl,
  parseProviderProfile
} from "./providerContracts"
export type {
  NetworkPolicy,
  ProviderCapabilityEvidence,
  ProviderCapabilityStatus,
  ProviderDialect,
  ProviderHealth,
  ProviderProfile,
  ProviderProtocol
} from "./providerContracts"
export * from "./readToolSchemas"
export * from "./recovery"
export * from "./runState"
export * from "./sceneObservation"
export * from "./schemas"
export * from "./skills/catalog"
export * from "./skills/manifest"
/**
 * **N2 的求解器层**（子任务 2b；计划 N2 的 Ownership）。
 *
 * `solverContracts` 先于 `solver/witnessSearch` 导出，顺序与依赖方向一致：
 * 契约只有形状，搜索器才是行为。两者一起出现在包根，是因为 2c 的接线
 *（Worker / `draftStore`）必须能只依赖包根拿到 `WitnessSearchInput` 与 `searchWitness`。
 */
export * from "./solver/solverContracts"
/**
 * **入口语法**（S6；设计 §3.2 的第一层）：自然语言 → 形状描述。
 *
 * 与搜索层一起出现在包根的理由同上面那条：本地规划器（`apps/web`）与离线 benchmark
 * **必须共用同一份解析**，两边都只从这里拿（`parseShapeClause` / `specForPrompt`）。
 */
export * from "./solver/shapeGrammar"
export * from "./solver/witnessSearch"
export * from "./toolContracts"
export * from "./toolDispatch"
export * from "./toolLoop"
export * from "./toolRegistry"
export * from "./underdetermined"
export * from "./tools/draftTools"
export * from "./tools/interactionTools"
export * from "./tools/sceneTools"
export * from "./verification/completionGate"
export * from "./verification/layoutModel"
export * from "./verification/renderEvidence"
export * from "./verification/taskAcceptance"
export * from "./verification/taskVerification"
export * from "./winAnsi"

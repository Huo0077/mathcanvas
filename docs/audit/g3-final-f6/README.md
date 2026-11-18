# G3-DS Task F6 审计记录：折叠多状态分支谱系与统一候选评估

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）。

## 1. 本轮改动与实现核对

1. **折叠多状态与镜像分支谱系（[foldChain.ts](../../../packages/agent-core/src/foldChain.ts) & [foldChain.sequence.test.ts](../../../packages/agent-core/src/foldChain.sequence.test.ts)）**
   - 新增 `foldMirrorPairAboutHinge`（绕折痕对称 `+θ / -θ` 镜像折叠点求解）、`buildFoldStateLineage`（生成含 `pre_fold`、`post_fold`、`parentStateId`、`mirrorBranch` 的独立状态谱系条目）与 `verifyFoldStateHashesDistinct`（拒绝跨状态/跨分支复用同一 `documentHash` 或 `candidateHash`）。
2. **统一 Live 与 Offline 候选集评估与谱系哈希隔离（[g3DsFrozenCaseRunner.ts](../../../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) & [g3DsFrozenCaseRunner.test.ts](../../../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts)）**
   - `CandidateSliceCertificate` 新增 `lineageKey`、`documentHash` 与可选 `parentCandidateHash`。
   - 抽离并导出 `evaluateFrozenCandidateSet`，使 Live 提供方响应与离线/静态多状态多分支候选完全共用同一套证书签发、`evaluateDrawingContractSetByPolicy` 与跨状态/分支哈希碰撞硬阻断（`duplicate_lineage_hash`）。

## 2. 实测验证结果

- `vitest run packages/agent-core/src/foldChain.sequence.test.ts packages/agent-core/src/rectangleFoldStateVerification.test.ts packages/agent-core/src/planCompiler.witnessFold.test.ts apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts --testTimeout=30000`：**`4` 文件 `27 passed`**（`foldChain.sequence.test.ts` `9`、`rectangleFoldStateVerification.test.ts` `6`、`planCompiler.witnessFold.test.ts` `7`、`g3DsFrozenCaseRunner.test.ts` `5`）
- `npm.cmd run typecheck`：退出 `0`（全工作区 + `e2e` + `scripts` 通过）
- `npm.cmd run lint`：**`0 errors`**（`34 warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：随全套文档更新一并核验

## 3. 下一步

- 推进 **Task F7（定向局部修复闭环 `repairProgress.ts`）**。

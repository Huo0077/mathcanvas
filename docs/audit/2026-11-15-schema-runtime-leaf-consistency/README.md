# R09-B 证据摘要：Schema 与运行时叶子约束同源及明确降级清单

## 问题背景与修复要点

1. **叶子约束单源化（`schemaReaders.ts` / `actionSchemas.ts` / `schemas.ts` / `modelPlanner.ts`）**：
   - 在 `packages/agent-core/src/schemaReaders.ts` 建立统一字符串叶子契约 `LEAF_CONSTRAINTS`（`text`、`actionKey`、`normalisationText`）、`stringLeafJsonSchema`、`stringArrayJsonSchema`、`readStringLeaf` 与 Unicode/零宽空白辅助函数 `trimUnicodeBlank` / `isBlankText`（覆盖 ASCII 空白、`\u00A0`、`\u2003`、`\u3000` 及零宽字符 `\u180E`、`\u200B`–`\u200D`、`\u2060`、`\uFEFF`），并让 `boundedString` / `readStringArray` 共享同一实现。
   - 在 `packages/agent-core/src/actionSchemas.ts` 将所有动作输入及引用字段的字符串叶子从裸 `{ type: "string" }` 收敛到 `textLeafSchema`（`minLength: 1, maxLength: 512`），新增基于 `LEAF_CONSTRAINTS` 与 `actionToolSchema` 的单源 item 工厂 `planActionToolItemSchema(actionId)`，并消除 `apps/web/src/agent/modelPlanner.ts` 内 `buildPlanToolSchema` 手抄 `{ actionKey: { type: "string" }, factIds: { type: "array", items: { type: "string" } } }` 的双写漂移。
   - 在 `packages/agent-core/src/schemas.ts` 的 `parseDraftAction` 对 `actionKey` 应用 `LEAF_CONSTRAINTS.actionKey`；在 `planEnvelopeToolParameters` 对 `normalisations[*]` 应用 `normalisationText`（`minLength: 1, maxLength: 512, pattern: "\\S"`）；在 `readNormalisations` 显式调用 `rejectUnknownFields(entry, ["original", "normalized"], ...)` 并对两个字段执行先判长、后去边缘空白与全空白拦截（`LEAF_CONSTRAINTS.normalisationText`）。

2. **Provider 不支持 JSON Schema 关键字明确降级清单**：
   - 确认 `ajv` 未在仓库安装，严格遵循计划不在无审批前提下新增锁文件依赖，直接在既有单元测试框架下实现确定性子集校验器 `validateJsonSchemaSubset` 对真实 `buildPlanToolSchema([...DRAFT_ACTION_IDS])` 输出运行差分对照。
   - 在 `packages/agent-core/src/actionSchemas.ts` 新增并导出 `PROVIDER_SCHEMA_UNSUPPORTED_KEYWORDS`（覆盖 `openai_strict`、`gemini`、`anthropic`、`openai_compatible_loose`）及递归降级函数 `degradeJsonSchemaForProvider`，显式声明 provider 通道剥离 `pattern`、`minLength`、`maxLength`、`uniqueItems`、`not`、`oneOf` 等关键字后不承诺远端完全校验，而是由运行时 `parsePlanEnvelope` / `parseDraftAction` 持续强制拦截超长、未知字段与零宽全空白输入。

## RED → GREEN 验证记录

| 阶段 | 命令 / 用例 | 实测结果 |
| --- | --- | --- |
| RED 基线 | `npx vitest run packages/agent-core/src/schemas.test.ts apps/web/src/agent/modelPlanner.test.ts --testTimeout=30000` | **预期失败 8 项**：`schemas.test.ts` 7 项（ASCII/Unicode/零宽空白 `actionKey` 未被拒、`normalisations` 未知字段放行）与 `modelPlanner.test.ts` 1 项（真实 `buildPlanToolSchema` 与运行时差分不一致） |
| GREEN 定向 | `npx vitest run packages/agent-core/src/schemas.test.ts packages/agent-core/src/actionSchemas.test.ts packages/agent-core/src/actionFieldParity.test.ts apps/web/src/agent/modelPlanner.test.ts --testTimeout=30000` | **4 文件 / 169 项全部通过**（含新增 `actionKey`/`normalisations` Unicode 空白与 trim 用例、真实 `buildPlanToolSchema` 差分对照及 provider 降级运行时兜底验证） |
| 离线可靠性评测 | `npm.cmd run eval:reliability -- --offline` | **1 文件 / 3 passed**，报告目录 `eval-results/reliability/offline-2026-11-15T18-31-24.890Z-22736`（本地未追踪产物，不提交） |
| 类型检查与 Lint | `npm.cmd run typecheck`、`npm.cmd run lint` | 均退出 `0`；`lint` 0 errors（32 条既有 unused 警告） |
| Web 生产构建 | `npm.cmd run build --workspace @draw/web` | 通过（634 modules） |
| 全量 Vitest | `npm.cmd test -- --testTimeout=30000` | **524 文件 / 5590 passed \| 1 todo (5591)**，0 failed |

## 边界与回滚

- `apps/desktop/src-tauri/src/providers/request.rs` 的 `OutputMode::JsonSchema` 已保持保守（不启用 `strict: true` 以保留 `oneOf` 分支），本包未改动 Rust 代码，相关 Rust 回归已在 `R05` 验证并在 `R11` 全量复核。
- 若需回滚本包，可针对 `R09-B` 提交执行 `git revert`；回滚后 `actionKey` 全空白、零宽空白与 `normalisations` 额外字段防线将重新退化，不能宣称 G2 schema 一致性关闭。

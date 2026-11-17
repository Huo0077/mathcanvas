# G3-DS 失败驱动 Task 0：脱敏负例真源 `G3CaseTrace`、阶段边界码与 R4 题图输入审计（零付费）

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（可观测性与输入依赖审计；历史强制 DS 真实实测 `0/36` 保持原样不改写）

## 1. `R4` 题图依赖输入审计（`test-fixtures/reliability/drawing-contracts-36.json`）

对冻结 36 题中 R4 标注为 `text_with_figure_reference` 且带未证实题图说明的 4 道题（分母仍保持 `36`）完成机器核验：

| 题号 | `inputMode` | 题干特征 | R4 未证实说明 | Task 0 审计结论 |
| --- | --- | --- | --- | --- |
| `GK-S02` | `text_with_figure_reference` | `如图... E∈AD, F∈AB` | 缺已审题图哈希/区域，无法仅靠边长证明宿主结构 | `input_figure_missing`（无人工核对题图前阻断完整通过） |
| `GK-S03` | `text_with_figure_reference` | `如图... 五面体` | 缺已审题图哈希/区域，不能核证候选环与原题图一致 | `input_figure_missing`（无人工核对题图前阻断完整通过） |
| `JT-S06` | `text_with_figure_reference` | `如图... 多面体 ABCDE` | 缺已审题图哈希/区域，不能核证拓扑与不可得题图一致 | `input_figure_missing`（无人工核对题图前阻断完整通过） |
| `JT-S07` | `text_with_figure_reference` | `如图... 五面体 ABCDEF` | 缺已审题图哈希/区域，不能核证拓扑与不可得题图一致 | `input_figure_missing`（无人工核对题图前阻断完整通过） |

说明：`GK-S01/S04/S05/S06/S07/S08` 与 `JT-S02/S04/S05` 虽题干出现 `如图`，但 R4 审计记录其几何定义可由题面唯一确定或已单列说明（其中 `GK-S05` 保留文本二面角数值不一致注记），`unsupportedReasons` 不含缺失题图声明；上述 4 题均由 `auditInputFigureDependency` 按字段检测，不凭题号或黄金坐标补图。

## 2. 交付产物与可观测性接线

1. **脱敏追踪模块 [g3DsCaseTrace.ts](../../../apps/web/src/agent/fixtures/g3DsCaseTrace.ts)**：
   - 定义闭集 `G3Boundary`（`provider | tool_protocol | schema | dag | stage | verification | contract | render | delivery`）与 `G3CaseTrace`（`caseId`、`runId`、`revision`、`candidateHash?`、`modelInvoked`、`requests[]`、`firstFailure?`）。
   - 提供 `createG3CaseTrace`、`recordRequestTrace`、`recordBoundary`（首次可证实边界一经写入禁止被下游失败覆盖）、`explainFirstFailure`（无证据时返回 `"unknown"`）、`serializeG3CaseTrace`（白名单字段与密钥/原始输入扫描：命中 `prompt`/`apiKey`/`toolInput`/`rawResponse`/`messages`/`sk-...` 直接抛错拒写）以及 `auditInputFigureDependency`、`classifyHistoricalDs5SummaryCase`。
2. **结构化诊断出口**：
   - 在 [modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts) 新增 `ModelPlannerBoundary`、`ModelPlannerStructuredEvent` 与 `onStructuredDiagnostic`（保留原 `onDiagnostic` 兼容），记录每次请求工具名、响应类型与 `usageKnown`（仅读取真实 `kind: "usage"` 事件），并在混合工具批次（`tool_protocol/mixed_read_plan`）、未发布工具、DS 施工单校验/DAG 编译（保留 `fieldPath`）、截断/拒答及传输终态失败发射闭集码。
   - 在 [examRunCoordinated.ts](../../../apps/web/src/agent/fixtures/examRunCoordinated.ts) 增加可选 `onTrace?: (trace: G3CaseTrace) => void`（100% 向后兼容 `ExamRunAdapterDeps`），记录 `stage` / `verification` 边界并回填 `candidateHash`。

## 3. 旧 `DS5` 36 条脱敏记录阶段覆盖表

基于 [docs/audit/2026-11-17-g3-ds5-live-36/summary.json](../2026-11-17-g3-ds5-live-36/summary.json)（修订 `b4044dd9`）运行 `classifyHistoricalDs5SummaryCase`（仅凭已存闭集字段归因，绝不猜测模型正文）：

| 首可证实阶段边界 | 数量 | 题号 / 说明 |
| --- | ---: | --- |
| `tool_protocol / mixed_read_plan` | **7** | `GK-S08`、`JT-S02`、`JT-S09`、`GK-P06`、`JT-P01`、`JT-P05`、`JT-P07` |
| `verification`（已产非空候选，验后失败） | **10** | 9 题 `verification_not_supported` + 1 题（`JT-P09`）`certificate_blocked`（其中 `GK-S05`、`GK-P03`、`JT-P02` 合同仅 `partial`，其上游构图失配细码在旧日志未保存） |
| `unknown`（旧摘要未存 schema/dag/stage 细码） | **19** | 19 题零候选且未触发混合批次的运行；旧 `summary.json` 未记录 `ds_intent` 拒绝原因与字段路径，诚实保留 `unknown`，后续运行将由 `onStructuredDiagnostic` 捕获 |

## 4. 验证结果

- `npm.cmd exec -- vitest run apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/fixtures/examRunCoordinated.test.ts --testTimeout=30000`：**`3` 文件 / `90 passed (90)`**（先 RED 观测缺失模块失败，后补全并通过 `GK-S08` 混合批次、`GK-P03` `fieldPath`、防泄漏序列化拒绝、`R4` 四题 `input_figure_missing`、36 条旧记录覆盖表与 `createModelPlanner` 实时诊断接线）。
- `npm.cmd run typecheck`：`6` 个工作区与 `e2e/tsconfig.json`、`scripts/tsconfig.json` 全过（exit `0`）。
- `npm.cmd run lint`：exit `0`（`0 errors`，`34 warnings`）。
- 下一步进入 **Task 1**（空场景构造与已有场景观察分流：`modelToolPolicy.ts`，零付费）。

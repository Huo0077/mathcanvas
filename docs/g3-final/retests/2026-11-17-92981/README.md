# G3-DS Task F0：`92981ebd` 真实 36 题失败真源冻结基线

> **真源与历史隔离声明**：本文件严格冻结 `898d31ae` 提交所记录的 `92981ebd` 真实 DeepSeek（`deepseek-v4-flash`）36 题复测作为新起点基线，**零新增付费模型调用**。原始逐题脱敏审计见 [2026-11-17-g3-ds-live-retest-92981](../../../audit/2026-11-17-g3-ds-live-retest-92981/README.md) 与 [summary.json](../../../audit/2026-11-17-g3-ds-live-retest-92981/summary.json)。

## 1. 基线总账（分母 = 36，不删题、不改历史）

- 代码基线：`92981ebd17b5c4522612e917876e2560be30d00f`（数据归档于 `898d31ae`）
- 冻结合同 SHA-256：`c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`
- 模型调用：77 次原生请求（单题 ≤ 3，总额 ≤ 108），76 次带 `usage`（输入 `211,368` / 输出 `140,132` tokens），实际账单金额未知（`costKnown: false`）
- 分层结果：
  - 完整独立数学合同：`0/36`（`0 passed / 1 partial (GK-S05) / 35 failed`）
  - 非空候选：`2/36`（`GK-S05` 32 图元，`GK-P09` 2 图元）；其余 34 题零候选
  - 读工具 + `plan_set_plan` 混批：**`0/36`**（`Task 1` 阶段工具隔离有效遏制协议混批，由上轮 7 降至 0）
  - 浏览器渲染 / 受控提交：因数学与证书前置门禁未过而未触发；主画布写入 `0`

## 2. 全 36 题首失败边界与输入图界标表（`classifyRetest92981Case` 100% 归因，0 `unknown`）

| 题号 | 请求数 | 候选图元 | 合同 / 对象 / 义务 | 生产验证 / 证书 | 首失败边界 | 首失败码 | 输入图边界 |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| `GK-S08` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `GK-S02` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_json` | `input_figure_missing` |
| `GK-S05` | 3 | 32 | `partial` / 1.00 / 0.95 | `not_supported` / `partial` | `dag` | `undeclared_entity_ref` | self_contained |
| `GK-P03` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `cross_scope_violation` | self_contained |
| `GK-S01` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | self_contained |
| `GK-S03` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | `input_figure_missing` |
| `GK-S04` | 3 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `GK-S06` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `GK-S07` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `cross_scope_violation` | self_contained |
| `GK-S09` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | self_contained |
| `JT-S01` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | self_contained |
| `JT-S02` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | self_contained |
| `JT-S03` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `JT-S04` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `JT-S05` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `JT-S06` | 3 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | `input_figure_missing` |
| `JT-S07` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | `input_figure_missing` |
| `JT-S08` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | self_contained |
| `JT-S09` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_json` | self_contained |
| `GK-P01` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `GK-P02` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `GK-P04` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `GK-P05` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `GK-P06` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `GK-P07` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `GK-P08` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `GK-P09` | 3 | 2 | `failed` / 0 / 0 | `not_supported` / `partial` | `verification` | `verification_not_supported` | self_contained |
| `JT-P01` | 3 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `JT-P02` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `dag` | `undeclared_entity_ref` | self_contained |
| `JT-P03` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | self_contained |
| `JT-P04` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `JT-P05` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `JT-P06` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `JT-P07` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `JT-P08` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `missing_required_parameter` | self_contained |
| `JT-P09` | 2 | 0 | `failed` / 0 / 0 | `-` / `-` | `schema` | `invalid_schema` | self_contained |

## 3. F0 退出核对与下一步

- `g3DsCaseTrace.test.ts` 已实证 `92981ebd` 全部 36 题均具备明确首失败边界（`unknown = 0`，`mixed_read_plan = 0`），且 4 道题图依赖题保留 `input_figure_missing` 阻断门禁。
- 下一步按 [G3-DS 最终版真实作图能力实施档案](../../G3-DS-final-implementation-dossier.md) 推进 **Task F1（探索候选隔离层 `speculativeCanvas.ts`）**。

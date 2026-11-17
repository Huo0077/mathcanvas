# DS0：真实模型（DeepSeek）36 题脱敏基线与失败边界审计

- **日期**：2026-11-17（原始基线采集于 2026-11-16 America/Los_Angeles，修订 `06648346634aa0760ba329419de041e5296add77`）
- **模式**：强制原生 DeepSeek 规划（`deepseek-v4-flash`，`forced-native-DS-planner`，绕过确定性优先生产路线），**0 次新增付费 API 请求**
- **脱敏账本**：[cases.json](cases.json)（不含原始题干文本、原始对话、原始模型正文或任何密钥/凭据）

## 1. 实测总账（与原始 summary 严格一一对应）

| 指标 | 实测值 | 说明 |
| --- | --- | --- |
| 分母 / 已完成 | `36 / 36` | 平面 18 题、立体 18 题 |
| 完整通过 | **`2 / 36` (`5.56%`)** | 仅 `GK-S08`、`GK-S09` 通过；平面 `0/18`、立体 `2/18` |
| `partial` / `failed` | `21 / 13` | `23` 题产生非空候选（`primitiveCount > 0`），`13` 题 `0` 图元 |
| 可确认终态 (`awaiting_confirmation`) | `4` | 含真通过 `GK-S08`/`GK-S09` 与 **2 例假阳性 `GK-P09`/`JT-P09`** |
| 主画布写入 (`sceneWrites`) | `0` | 隔离评测从不自动确认 |
| 原生请求 / tokens / 费用 | `80 / 108` (`maxPerCase=3`)；输入 `1,724,928` / 输出 `66,549`；费用 `null` (`unknown`) | 单次请求包达 `67.5–69.8 KB`（约 `21.5K` 输入 tokens/次） |
| 平均覆盖率 | 对象 `51.72%` (`0.5172`) / 义务 `31.11%` (`0.3111`) | 与离线确定性 36/36（100%）严格分表 |

## 2. 失败边界分类与代表题双向复核

1. **`passed`（2 题）**：`GK-S08`、`GK-S09`（完整合同 `obj=1.00, ob=1.00`，`verification="passed"`，`certificateStatus="passed"`）。
2. **`false_positive_confirmable`（2 题 — 重大生产放行隐患）**：
   - **`GK-P09`**：`terminal="awaiting_confirmation"`、`verification="passed"`、`certificateStatus="passed"`，但独立合同 **`obCov=0.00`（`0/4` 全部失败：`function_expression`、`function_sample`、`tangent` 缺失/歧义）**。
   - **`JT-P09`**：`terminal="awaiting_confirmation"`、`verification="passed"`、`certificateStatus="passed"`，但独立合同 **`obCov=0.23`（`10` 项失败：缺圆 `M`、`M` 点缺失、`|AC|=7.47 vs 6`）**。
   - **代码根因**：[draftStore.ts](../../../apps/web/src/agent/draftStore.ts#L629-L675) 在 `hasRelationalContract === false` 时直接传 **`prompt: ""`** 调用 [certifyDrawingAgainstContract](../../../packages/agent-core/src/verification/drawingCertificate.ts#L222-L232)（返回 `gate.status="not_applicable"`），随后的 [committerAdapter.ts](../../../packages/agent-core/src/committerAdapter.ts#L250-L271) 对 `not_applicable` 返回 `undefined`，或因 `parseObligationWithLegacy` 漏析从句而放行。
3. **`verification_split_not_supported`（2 题 — 生产假阴性阻断）**：
   - **`JT-S07`（28 图元，`req=2`）** 与 **`JT-S09`（28 图元，`req=1`）**：独立合同 **`objCov=1.00`、`obCov=1.00`、`failedObligations=0`**，但生产端返回 `verification="not_supported"`、`certificateStatus="partial"` 导致 `failed`。需在 `DS3` 核对 `parseObligationWithLegacy` 与独立合同之间的条款对齐与接线。
4. **`partial_single_shot_no_validating_repair`（5 题 `obCov < 1` + `JT-S09`，均在 `req=1` 即死于 `validating`）**：
   - `GK-S06`、`GK-P02`、`GK-P07`、`GK-P08`、`JT-P08`（以及 `JT-S09`）均拥有 `3–28` 个可编译图元，但仅仅执行 **`req=1`** 即终止为 `failed`。
   - **代码根因**：[coordinator.ts](../../../packages/agent-core/src/coordinator.ts#L776-L784) 仅对 `schema_invalid` 与 `compile_failed` 提供有界重试；进入 `validating` 后一旦 `verificationGate` 拦截就直接 `transition("failed")`，导致剩余 2 次请求预算完全浪费。
5. **`partial_exhausted_or_unrepaired`（12 题，`req=2..3`、`prims=1..25`）**：
   - 代表题 **`GK-S01`**（19 图元，`req=2`，`objCov=1.00`、`obCov=0.8182`）：第 (1) 问成立，第 (2) 问 `AD⊥DC`（余弦误差 `0.807`）与 `dihedral_sine`（`0.997 vs 0.926`）失败——典型体现提示词仍要求模型手算坐标带来的精度失效。
6. **`zero_candidate_waiting`（1 题）与 `zero_candidate_failed`（12 题）**：
   - **`JT-S04`**：`terminal="waiting"`、`bucket="interaction"`、`req=2`、`primitiveCount=0`，模型返回了澄清提问而非构图计划。
   - **其余 12 题（`GK-S02`、`GK-S03`、`GK-S04`、`GK-S05`、`GK-S07`、`JT-S01`、`JT-S02`、`JT-S05`、`JT-S06`、`GK-P04`、`GK-P06`、`JT-P05`）**：每轮塞入 `~67.5–69.8 KB` 系统提示词与全量底层动作 Schema，并要求 `solid.create_polyhedron` 手算顶点与面环，模型连续撞 schema/编译拒收后以 `0` 图元失败。

## 3. 验证记录

- `npm.cmd exec -- vitest run packages/agent-core/src/verification/dsLiveBaseline.test.ts apps/web/src/agent/fixtures/examRunCoordinated.test.ts scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test:docs -- --testTimeout=30000`

## 4. 下一步

进入 **`DS1`**：在不改变冻结合同与零答案泄漏边界的前提下，落地紧凑型 `DsDrawingIntent`（对 `systemPrompt` 瘦身、禁止 DS 手算立体顶点/无理数坐标、接通用构造 DAG 与反套壳变体测试），先消除 13 道历史零候选。

# G3-F9 冻结36题：每题最多10次的原生 DS 全量实测

- **测试日期**：2026-11-18（America/Los_Angeles）。固定源码 `aa17eb70d0bb98371e8300cd4294b794646b1f7b`；题集 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`；原生已保存的 `deepseek-v4-flash` profile revision 2、工具能力 verified。价格页注明此旧别名由较新的 Flash 权重服务；此处不宣称测到旧版权重。
- **授权和防线**：用户确认每题最多10次；沿用整轮5美元上限。零付费预检24项工具与原生请求0次后启动。最多360次/轮、每次输入不超过50,000字节、输出请求上限2,048 tokens；每次发送前按峰值 cache-miss 单价和输入字节/最大输出保守计算累计预算，不足即拒绝。本次没有触及5美元闸。计费是估算，**实际账单未知**。
- **覆盖与结果**：36/36题均实际发起 DS 请求，共 **91次**（91次均有 usage），每题1—10次；输入290,029、输出13,637 tokens。合同 **1 passed / 26 failed / 9 not_measured**；仅 GK-S09 取得通过生产证书并在隔离浏览器以同候选 hash 渲染可读。其余35题**没有可核验通过的候选**。原生确认/主画布写入在36题中均未测，因此**不能把 1/36 写作端到端产品成功率**，端到端通过数未被证实。
- **输入限制**：冻结题集中23题为 text_only；13题是 `text_with_figure_reference`，却没有附经核验的原始题图。本轮对这13题调用的是冻结文字提示，**不是完整图题输入评测**。13题均未通过合同，其中12题调用澄清工具；即使未来仅文字通过，也不能冒充匹配原图。
- **真实断点**：17题首次记录 `needs_clarification`，12题首次 `missing_required_parameter`，1题 `symbol_source_missing`，5题 `telemetry_missing`；首次断点不一定是最终终止原因。8题的回复一次给出多个构造动作（如 GK-P01 一次3个 `declare_entity`），现有 `apps/web/src/agent/modelPlanner.ts` 通用多工具闸在逐动作回执之前拒绝，后7题记录到 `mixed_read_plan`，GK-P01 的原始 runner 错误仅标 `runner_error`，其相同成因是依据返回工具列表与源码推断，不伪造历史回执。`markMissingActionReceipts` 在部分题将最终首次断点呈为 `telemetry_missing`；这不是模型调用本身缺失。JT-P01 用满10次请求后没有终态，归类 `budget_exhausted`。这些9题合同 **not_measured**，不能当成合同验证失败或通过。
- **费用**：输入载荷累计1,029,825字节；以官网峰值价（输入 cache miss $0.30/百万 tokens、输出 $1.20/百万 tokens）据 usage 粗估 **$0.1033731**，按所有实际发出的请求字节及每请求保留2,048输出 tokens 计算保守累计 **$0.5325891**。两者均非服务商账单，`actualCostUsd=null`。价格来源：<https://api-docs.deepseek.com/quick_start/pricing>。

## 逐题原生结果

合同列是本次固定源码的独立合同；`not_measured` 表示被运行器异常/预算挡住而没有合同返回。末列优先列终止运行器错误，否则列首次观测边界（并非一定最终原因）。

| 题号 | DS请求 | 合同 | 证书 | 错误或首次断点 |
| --- | ---: | --- | --- | --- |
| GK-S01 | 1 | failed | — | needs_clarification |
| GK-S02 | 1 | failed | — | needs_clarification |
| GK-S03 | 2 | failed | — | missing_required_parameter |
| GK-S04 | 1 | failed | — | needs_clarification |
| GK-S05 | 5 | failed | — | missing_required_parameter |
| GK-S06 | 1 | failed | — | needs_clarification |
| GK-S07 | 1 | failed | — | needs_clarification |
| GK-S08 | 2 | failed | — | symbol_source_missing |
| GK-S09 | 3 | passed | passed | — |
| JT-S01 | 1 | failed | — | needs_clarification |
| JT-S02 | 1 | failed | — | needs_clarification |
| JT-S03 | 1 | failed | — | needs_clarification |
| JT-S04 | 1 | failed | — | needs_clarification |
| JT-S05 | 1 | failed | — | needs_clarification |
| JT-S06 | 1 | failed | — | needs_clarification |
| JT-S07 | 1 | failed | — | needs_clarification |
| JT-S08 | 1 | failed | — | needs_clarification |
| JT-S09 | 1 | failed | — | needs_clarification |
| GK-P01 | 1 | not_measured | — | runner_error |
| GK-P02 | 8 | failed | — | missing_required_parameter |
| GK-P03 | 7 | not_measured | — | mixed_read_plan |
| GK-P04 | 1 | failed | — | needs_clarification |
| GK-P05 | 1 | not_measured | — | mixed_read_plan |
| GK-P06 | 1 | not_measured | — | mixed_read_plan |
| GK-P07 | 1 | failed | — | needs_clarification |
| GK-P08 | 2 | failed | — | missing_required_parameter |
| GK-P09 | 1 | failed | — | needs_clarification |
| JT-P01 | 10 | not_measured | — | budget_exhausted |
| JT-P02 | 3 | not_measured | — | mixed_read_plan |
| JT-P03 | 2 | failed | — | missing_required_parameter |
| JT-P04 | 2 | failed | — | missing_required_parameter |
| JT-P05 | 10 | failed | — | missing_required_parameter |
| JT-P06 | 4 | not_measured | — | mixed_read_plan |
| JT-P07 | 1 | not_measured | — | mixed_read_plan |
| JT-P08 | 1 | not_measured | — | mixed_read_plan |
| JT-P09 | 9 | failed | — | missing_required_parameter |

## 同候选画面与下一步

GK-S09 本轮真实 DS 候选 hash `6e7fecf1adb35e44909fc416a44e41f9c623c53d4fcbed11e1ff758d972bbe52`；隔离浏览器导入后的 document/candidate hash 相同，画布证据 passed、21个可量图元、六标签、无隐藏标签/诊断错误。[实际截图](GK-S09-real-candidate.png) 中棱柱边、面与透明球壳可读（AI现场检查，**非用户人工签收**），图片 SHA-256 `fc09ca9a36129f74fc3c260e6dbe39ba745dc695c772597b319db5f1001cd279`。导入浏览器不是原生受控确认，native render/commit 仍 pending 或 not_measured。

下一步只围绕本轮真实断点：先使 `ds_action` 对同轮多个合法构造动作给出逐动作执行/拒绝回执，避免通用 `mixed_read_plan` 误分类；再按真实的 `missing_required_parameter` 与 `undeclared_entity_ref` 逐族收敛模型可见参数契约；补齐13题原始图像后才能做完整图题复测；最后给真实候选加原生确认前0主画布写入与确认后同哈希交付证据。**下一轮实测必须冻结新提交并另获付费授权**；本轮测试所用的授权不滚用。

脱敏机器报告见[summary.json](summary.json)，不提交原始模型正文、题干请求、动作输入、凭据或候选全文；结果不与历史不同修订/口径的 DS 或离线成绩并表。

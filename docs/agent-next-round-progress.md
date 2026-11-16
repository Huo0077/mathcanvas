# 下一轮工作导航

最后更新：2026-11-16（仅导航对齐）。

**实时进度只看[当前状态](current-status.md)，执行顺序只看[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)。** 本页不再保存第二份完成数字、测试读数或发布判断。

## 从哪里开始

1. 先读[当前状态](current-status.md)和[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)：`R00–R11`（含 G1/G2）、`B4 / P0 / T01`、`B4 / P1 / T02`、`B4 / P2`（`T03`、`T04`）、`B4 / P3`（`T05`、`T06`）、`T11` 与 `T07` 已完成，见[干净依赖与审计证据](audit/2026-11-15-clean-dependencies-and-audit/README.md)、[P0 / T01契约与口径证据](audit/2026-11-16-p0-drawing-contracts/README.md)、[P1 / T02契约证据](audit/2026-11-16-p1-problem-contract/README.md)、[P2 / T03关系语义与角链证据](audit/2026-11-16-p2-relation-chains/README.md)、[P2 / T04符号圆锥曲线与AST证据](audit/2026-11-16-p2-symbolic-conic-ast/README.md)、[P3 / T05实体绑定与诊断证据](audit/2026-11-16-p3-entity-binding-diagnostics/README.md)、[P3 / T06构造DAG证据](audit/2026-11-16-p3-drawing-intent-dag/README.md)、[P5 / T11数值稳健性证据](audit/2026-11-16-p5-numeric-robustness/README.md)与[P4 / T07平面作图证据](audit/2026-11-16-p4-planar-drawing/README.md)；RustSec因未装 `cargo-audit` 留为 `unknown`，`T01` 仍待第二位独立审阅者复核。
2. 当前按 `implementation-task-ledger.json` DAG 持续推进 `B4`（`P0–P6`）与 `B5`（`P7`）：已完成 `T01–T07` 与 `T11`，下一步进入 **`T08`**（函数与动态几何确定性构造），其后依次推进 `T09 → T10 → T12 → T13 → T14 → T15 → T16`。
3. 真实 provider 付费评测、安装与正式发布均仍未开启，等待显式预算批准后再执行。
4. [R审查修复技术附录](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)、[T画图技术附录](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)及[P阶段验收合同](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)保留为技术参考，不把计划当成完成证据。
5. 真实provider、费用与产品发布需另行批准；本轮不重复强推main。

## 历史和证据边界

[版本决定](audit/2026-11-15-main-restart/README.md)固定59ea3613代码基线，be033b71为已完成的重启提交；旧线47提交已舍弃且有备份。正文带历史标记的N/V/W/Task计划只用于追溯，不计本轮已完成。

[项目审查报告](audit/2026-11-15-project-review/README.md)、[36题原始证据](audit/2026-11-15-drawing-baseline/README.md)和[原件归档](audit/2026-11-15-pre-reset/README.md)保持原样。报告的E2E/基线读数、只读探针和本次文档测试不是同一类证据；以当前状态中的分层说明为准。

[本次对齐清单](audit/2026-11-15-progress-alignment/README.md)列出活动文件与历史导航处理范围。

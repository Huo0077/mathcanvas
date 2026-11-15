# 下一轮工作导航

最后更新：2026-11-15（仅导航对齐）。

**实时进度只看[当前状态](current-status.md)，执行顺序只看[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)。** 本页不再保存第二份完成数字、测试读数或发布判断。

## 从哪里开始

1. 读主计划的版本约束和第10–16节：31项任务合同、依赖/文件/测试、首批RED、接口、验收和暂停条件；[机器台账](superpowers/plans/2026-11-15-implementation-task-ledger.json)与之配套，不维护另一份实时进度。
2. 首批固定R00 → R01-A → R09-A → R10。详细代码位置/安全反例看[R审查修复技术附录](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)，它不再独立改变主计划的顺序。
3. 再处理G1原生安全/数据保护，G2输入/UI/schema/干净验证；黄金合同可先整理，但不能等待完整大重构才阻断C1错误放行。
4. 按[T画图技术附录](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)及[P阶段验收合同](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)推进六题/36题，T11数值合同先于构造器，T18后交R12最终签收。
5. 真实provider、费用与产品发布需另行批准；本次只对齐文档，不重复强推main。

## 历史和证据边界

[版本决定](audit/2026-11-15-main-restart/README.md)固定59ea3613代码基线，be033b71为已完成的重启提交；旧线47提交已舍弃且有备份。正文带历史标记的N/V/W/Task计划只用于追溯，不计本轮已完成。

[项目审查报告](audit/2026-11-15-project-review/README.md)、[36题原始证据](audit/2026-11-15-drawing-baseline/README.md)和[原件归档](audit/2026-11-15-pre-reset/README.md)保持原样。报告的E2E/基线读数、只读探针和本次文档测试不是同一类证据；以当前状态中的分层说明为准。

[本次对齐清单](audit/2026-11-15-progress-alignment/README.md)列出活动文件与历史导航处理范围。

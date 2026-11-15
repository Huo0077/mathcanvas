# 下一轮工作导航

最后更新：2026-11-16（仅导航对齐）。

**实时进度只看[当前状态](current-status.md)，执行顺序只看[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)。** 本页不再保存第二份完成数字、测试读数或发布判断。

## 从哪里开始

1. 先读[当前状态](current-status.md)和[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)：首批R00 → R01-A → R09-A → R10已完成；当前授权为G1（R02–R06）与G2（R07、R08、R09-B、R11），不把单个区块当成门禁整体完成。
2. G1（R02–R06）与G2的R07、R08、R09-B已完成，见[草稿与CSV证据](audit/2026-11-15-draft-and-csv-protection/README.md)、[曲线绑定与题图复核证据](audit/2026-11-15-image-review-and-curve-binding/README.md)、[E2E与生产UI对齐证据](audit/2026-11-15-e2e-ui-contract-alignment/README.md)与[Schema与运行时同源证据](audit/2026-11-15-schema-runtime-leaf-consistency/README.md)；下一步进入G2最后一块R11（干净依赖、npm/Rust审计与全量串行验证）。
3. 本轮授权至R11完成即止，不自动推进P0–P8、R12或发布。
4. [R审查修复技术附录](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)、[T画图技术附录](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)及[P阶段验收合同](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)保留为技术参考，不把计划当成完成证据。
5. 真实provider、费用与产品发布需另行批准；本轮不重复强推main。

## 历史和证据边界

[版本决定](audit/2026-11-15-main-restart/README.md)固定59ea3613代码基线，be033b71为已完成的重启提交；旧线47提交已舍弃且有备份。正文带历史标记的N/V/W/Task计划只用于追溯，不计本轮已完成。

[项目审查报告](audit/2026-11-15-project-review/README.md)、[36题原始证据](audit/2026-11-15-drawing-baseline/README.md)和[原件归档](audit/2026-11-15-pre-reset/README.md)保持原样。报告的E2E/基线读数、只读探针和本次文档测试不是同一类证据；以当前状态中的分层说明为准。

[本次对齐清单](audit/2026-11-15-progress-alignment/README.md)列出活动文件与历史导航处理范围。

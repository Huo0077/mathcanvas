# 下一轮工作导航：先处理审查阻断，再提升画图能力

最后更新：2026-11-15。

本页只作导航，功能阶段与发布状态以[当前状态](current-status.md)为准。原P0–P8不重新编号；报告里的P0–P3是另一套审查建议，本轮统一用R00–R12/G0–G4衔接。

## 先确认版本与总方案

阅读[统一全面实施总方案](superpowers/plans/2026-11-15-main-restart-master-plan.md)及[main重启决定](audit/2026-11-15-main-restart/README.md)：旧线59ea3613..d8743a32共47个提交已备份并标记本轮舍弃。新main从59ea3613重新提交，不继承旧线实现/评测/阶段完成。当前文档提交不等于产品发布。

## 下一步功能实施从这里开始

1. 阅读[项目审查报告](audit/2026-11-15-project-review/README.md)，先理解C1错误数学放行、原生安全、数据保护和完整E2E失败。
2. 按[审查驱动下一步方案](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)执行：R00基线→R01-A漏小问阻断→R09-A最终轮次计分→R10 CI信任边界。所有任务仍待实施。
3. 完成R02–R06/G1原生安全和数据保护，R07–R09/R11的题图、UI合同、schema与干净验证。C1安全护栏不能等36题全审或大IR升级才落地。
4. 回到[18个画图工作包手册](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)的六题切片与36题路线，沿用[总体设计](superpowers/specs/2026-11-15-drawing-reliability-design.md)和[P0–P8计划](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)。
5. 最后按新方案G4和原T18验收安装、性能、盲测、成本与安全回滚。真实模型预算与产品发布另批；本次main重启提交/同步已获用户授权，后续功能提交按各任务授权执行。

## 必须记住的边界

- 用户指定59ea3613继续有效，本次已核对旧远端47提交并备份；不merge回旧线，不能把后续旧版本当本轮实现。
- 完整E2E已经运行但未通过，不再以“未跑”概括项目现状；审查结果与本轮仅文档验证分开。
- 先正确拒绝漏条件的图，再提高成功率；澄清、只画公共底图和历史轮次的正确答案不能算最终画图成功。
- [审查问题映射](audit/2026-11-15-review-plan-response/finding-task-map.json)覆盖每个问题；[旧进度原件](audit/2026-11-15-pre-reset/README.md)只供历史追溯。

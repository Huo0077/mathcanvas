# 完整实施主计划完善与核验（2026-11-15）

## 交付范围

本轮直接升级已有[实施主计划](../../superpowers/plans/2026-11-15-main-restart-master-plan.md)，没有留下另一份重复总方案。R00–R12与T01–T18作为技术附录；新增[机器任务台账](../../superpowers/plans/2026-11-15-implementation-task-ledger.json)给出31项工作包的依赖、责任、现有/拟新增文件、RED清单、测试命令、验收和安全回滚。

当前本地重启提交be033b71，产品代码基线59ea3613；旧47提交依然舍弃。本轮不修改产品实现、不提交推送、不新增依赖、不调用模型或发版。

## 当前缺陷的只读校对

[read-only-compile-probe.json](read-only-compile-probe.json)来自直接调用真实compilePlan的4个输入：裸条件、设、且、若。合法四棱锥公共PA=2、AD·DC=1，后续小问要求AD⊥DC。

- 裸条件/设/且：ok=true、diagramVerification.status=passed；当前缺陷仍在。
- 若：ok=true、status=unverified，含warning；不能据此断言runtime已经安全。
- 所有4次基准document原样不变；没有调用provider或提交主场景。

这不是新画图成功率或修复GREEN，不是完整runtime/E2E安全证明。主计划第12节给出可直接落成测试的合法顶点/面环，并明确还必须覆盖确认链、正例和scope。

## 本次补强点

1. 唯一主入口和31项任务合同，不重新生成R/T/P以外的一套进度编号。
2. 技术DAG与发布门槛分开；T11数值合同先于构造器，T18移交R12签收，避免相互等待。
3. 全部任务有文件范围、真实存在/拟新增区分、可运行测试命令（实施时再执行）及安全回滚。
4. 给出真实compilePlan负例、最终产物选择函数/两轮计分例，以及凭据/草稿故障注入顺序。
5. 明确源合同、DAG、native凭据、资源限制、最终产物、证书、渲染证据的生产者/消费者和失效规则。
6. 固定阶段读数、首批开工清单、裁决点和暂停条件；无独立审阅者不能编造完成签收。

## 验证

本轮文档测试及路径/台账/映射/只读结果检查以[verification.json](verification.json)为准。所有功能修复仍未开始；文档完整不等于产品功能完整。

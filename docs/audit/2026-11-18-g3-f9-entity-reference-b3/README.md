# G3-F9 Block B3：实体引用真实状态与回滚安全（非付费）

- **本轮来源**：[36题原生审计](../2026-11-18-g3-f9-native-36-10x/README.md)中的 GK-S05、GK-P02、JT-P01、JT-P05、JT-P09 等出现 `undeclared_entity_ref`；未保存原始动作参数，不能将每题归因于特定名称或声称修复后已通过。
- **RED 发现**：`declare_entity` 并不创建几何图元，旧工具回执没有告诉模型哪些名称真正可引用；`repair_entity` 只回退点映射，不回退 `lines2/conics2`，导致已撤销的直线还能被 `construct_intersection` 使用、已撤销的曲线还能被 `construct_tangent` 使用。`repair_entity({branchId})` 旧实现误撤销共享主候选而不清理分支。新负例先分别复现以上真实状态失真。
- **GREEN 边界**：模型可见的 `referenceDirectory` 从已提交的候选动作和可读引用映射生成，区分 `materializedPoints/Lines/Conics` 与 `declaredOnly`；自动过滤失败构造和已回滚动作，按分支隔离声明和物化图元、最多32个有限名称并显式 `truncated`。目录只放在模型下一轮的工具结果里，不进入脱敏 `G3CaseTrace`，无原始题干/参数。共享与分支各自回滚点/线/曲线引用；共享回滚或共享新增图元遇到活跃依赖分支时明确拒绝而不是损坏分支几何；分支修复后共享可继续构造，且按真实共享 stepIndex 索引回滚快照，不被分支动作错位。分支测量/约束查询现在从所属分支读取已物化点，另一个分支不能借用。
- **验证**：定向 Vitest **145/145**，覆盖回滚直线/曲线不可引用、分支独立回滚、重复名称构造失败后坐标不污染、声明不冒充物化、目录上限与下一轮真实工具回执可见；TypeScript typecheck 通过；lint 0 errors / 34 既有 warnings。此为零费协议/内核验证，**没有新 DS 请求，旧36题合同/交付成绩完全不变**。
- **未完成**：当前目录按共享/branchId 隔离，尚未完整覆盖相同 branchId 下不同 scope/state 的引用可见性、在已创建分支后再修改共享图元的联动重建（现明确阻断）、同 branchId 下不同 scope/state 的绑定与分支复杂拓扑回滚；这些需后续针对性 RED，不可把本块说成所有多状态引用均已正确。还未完成题图输入、原生确认交付与新提交的付费实测；任何后续 DS 必须重获费用授权。

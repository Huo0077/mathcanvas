# GitHub 相关项目调研：下一轮 Agent 设计参考

> 调研日期：2026-10-04
> 目的：为 MathCanvas 下一轮“约束驱动见证搜索 + 真实 provider 评测”提供结构参考，不复制外部代码，也不把外部项目能力计入本仓库完成度。

## 1. 参考项目

### GeoGebra

仓库：`https://github.com/geogebra/geogebra`

参考点：动态几何产品需要把对象、关系、派生结果和交互操作分层；用户拖动后，关系是否保持是独立能力。对 MathCanvas 的启发是：Agent 生成的静态见证不能冒充持久动态约束，后续若做拖动保持，必须进入文档约束/求解层，而不是在 Agent 确认文案里暗示已经支持。

### FreeCAD

仓库：`https://github.com/FreeCAD/FreeCAD`

参考点：参数化建模、历史传播和几何内核是不同层。对 MathCanvas 的启发是：下一轮 WitnessSearch 应产出“参数/候选/来源”，由几何内核物化和核验；不要让模型直接维护拓扑，也不要用视觉评分替代几何判据。

### SolveSpace

仓库：`https://github.com/solvespace/solvespace`

参考点：约束求解器直接暴露自由度、冲突约束、不收敛和未知变量等状态；下一轮 MathCanvas 的动态拖动不能只返回布尔成功，而要记录自由度与失败约束。

### Z3

仓库：`https://github.com/Z3Prover/z3`

参考点：非线性算术、模型、无解和未知结果可以通过 solver adapter 隔离；MathCanvas 不应把 Z3 直接绑定到 UI，而应给求解预算、超时和证据版本。

### AlphaGeometry / Newclid

仓库：`https://github.com/google-deepmind/alphageometry`、`https://github.com/LMCRC/Newclid`

参考点：形式几何证明把几何状态、数值/规则搜索和证明目标分层；自然语言形式化本身是独立任务。MathCanvas 应把实例核验、采样、形式证明做成不同证据状态。

### mathlib4 / Lean

仓库：`https://github.com/leanprover-community/mathlib4`

参考点：形式化数学和可检查证明需要独立的类型与证明后端。对 MathCanvas 的启发是：`verified_instance`、`sampled`、`formally_proved` 必须是不同状态；本项目下一轮不把数值见证提升为形式证明，也不把 Lean 作为运行时依赖。

## 2. 采用与拒绝

采用：分层对象模型、独立几何内核、可追溯参数/历史、证明状态分级。

拒绝：直接复用外部项目的代码或许可证；把成熟动态几何系统的能力写成 MathCanvas 已具备；把截图/视觉相似度作为数学条件的替代；在没有真实 provider 样本时借用外部项目的模型效果结论。

## 3. 对下一轮的具体结论

1. 先做 Obligation IR，统一题设、目标、自由点和未支持条件。
2. 再做有预算、可复现的解析构造与有限候选搜索；所有候选回到现有残差/拓扑验收。
3. 单独建设真实 provider benchmark，把模型成功率、成本、延迟和人工可读性与 deterministic_local 分开。
4. 动态约束和形式证明后置，避免下一轮再次把三个不同问题塞进一个 Agent “成功”状态。

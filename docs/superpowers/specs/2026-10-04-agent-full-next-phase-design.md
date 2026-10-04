# 下一阶段 Agent 完整升级设计：约束求解、动态保持、形式证明与开放题理解

> 日期：2026-10-04
> 基线：`b1ee3d3`（已完成欠定静态示意图的题设核验与 fail-closed 提交）
> 说明：这是架构规划，不表示下列能力已经实现。

## 1. 总目标

把 MathCanvas Agent 从“一次生成候选图并核验”推进为四层协作系统：

1. **理解层**：把自然语言题面编译成结构化题设与目标；
2. **求解层**：为欠定题选择见证，或为确定题求出满足约束的坐标；
3. **交互层**：拖动点时保持约束、暴露自由度、处理过约束与无解；
4. **证明层**：把“实例通过”“数值采样”“形式证明”严格分级，必要时导出给外部证明后端。

真实模型只负责提出解释、候选和证明草稿；数学状态由系统持有，所有写入仍然经过隔离草稿、核验、用户确认和 HostBridge。

## 2. GitHub 调研结论

### 2.1 约束求解：SolveSpace / FreeCAD / ToubkalCAD

SolveSpace 的求解接口明确暴露 `dof`、失败约束、`INCONSISTENT`、`DIDNT_CONVERGE` 和 `TOO_MANY_UNKNOWNS` 等结果；这说明动态拖动不能只返回“成功/失败”，必须把自由度、冲突约束和不收敛分开。（详见 `docs/research/2026-10-04-github-project-survey.md`）

FreeCAD Sketcher 的约束系统把几何关系、尺寸和自由度交给约束求解器，并允许用户交互探索剩余自由度；MathCanvas 应借鉴“约束是文档状态，拖动是求解请求”的边界，而不是让 Agent 每次拖动都重新编一组坐标。（详见 `docs/research/2026-10-04-github-project-survey.md`）

ToubkalCAD 展示了浏览器 3D 参数化 CAD、约束求解和 OpenCascade WASM 可以组合，但它的依赖体量和建模范围也说明：MathCanvas 应先实现自己的小型约束子集，不直接引入完整 CAD 内核。（详见 `docs/research/2026-10-04-github-project-survey.md`）

### 2.2 非线性求解：Z3/NLSAT 与边界

Z3 提供非线性算术、模型和“对猜想加入否定后检查不可满足”的证明式工作流；其公开示例也展示了从非线性约束取模型和做反例检查。（详见 `docs/research/2026-10-04-github-project-survey.md`） Z3 的版本说明还显示 NLSAT/CAD 单元近似等算法会持续演进，因此它更适合作为**可选后端**，而不是把 WASM/原生求解器直接塞入 UI 主线程。（详见 `docs/research/2026-10-04-github-project-survey.md`）

采用边界：先把 MathCanvas 题设编译为受限约束 IR，再提供 Z3/数值优化后端适配器；后端返回模型、无解、超时或未知，均不能被压成一个布尔值。

### 2.3 形式证明：mathlib4 / AlphaGeometry / Newclid

mathlib4 是 Lean 的数学库与证明基础设施，强调可检查的形式化数学；它适合作为将来的证明出口，不适合作为当前静态画图的隐藏判据。（详见 `docs/research/2026-10-04-github-project-survey.md`）

AlphaGeometry 的公开实现把几何状态、数值引擎和符号/规则搜索结合起来；其仓库描述的 `geometry.py`、`numericals.py` 分层与 MathCanvas 的“几何文档 + 数值候选 + 规则证明”方向高度相关，但它面向奥数证明，不等价于高中 3D 作图。（详见 `docs/research/2026-10-04-github-project-survey.md`） Newclid 也表明，把自然语言或半结构化题面送入证明引擎本身就是独立的自动形式化问题，不能假设模型生成一个 JSON 就已经完成形式化。（详见 `docs/research/2026-10-04-github-project-survey.md`）

## 3. 统一状态模型

新增统一的 `MathClaim`/`GeometryObligation` 语义层：

```ts
type ClaimRole = "given" | "construction" | "goal" | "free_choice"
type ClaimStatus = "verified_instance" | "sampled" | "formally_proved"
  | "failed" | "unknown" | "inconsistent" | "timeout"

type SolverStatus = "model" | "unsat" | "unknown" | "timeout" | "diverged"
```

每条 claim 必须包含：原文范围、结构化目标、坐标/参数引用、判据来源、数值容差、求解器、版本、证据和下一步。任何 UI、Agent trace、确认门禁和长期记忆都只读这份状态，禁止各层重新解释字符串。

## 4. 四条升级主线

### A. 通用约束与非线性求解

**目标**：让“题面有数值约束但模型不会稳定算坐标”的题，能被系统求解或明确报告无解。

分层：

1. `constraint-ir`：点、线、面、长度、角度、比例、共线/共面、垂直/平行、二面角；
2. `constraint-lowering`：把支持的约束降为向量残差、代数方程或不等式；
3. `solver-adapter`：解析构造、有限网格、数值优化、可选 Z3/NLSAT；
4. `model-result`：模型、残差、自由度、未满足约束、超时/未知；
5. `witness-verifier`：重新从候选文档核验，求解器不能自证。

先做 2D/简单 3D 约束子集；对二面角、比例和多个自由量设置预算。求解器默认运行在 Worker/宿主后台，不阻塞 UI。

### B. 动态拖动保持约束

**目标**：当用户拖动被约束的点时，不让图形悄悄失去题设关系。

文档中保存约束，不保存某一轮 Agent 的临时提示。拖动流程：

1. 捕获 pointer intent；
2. 生成临时约束（拖动点接近指针）；
3. 求解剩余自由度；
4. 返回 `solved / underconstrained / overconstrained / inconsistent / not_supported`；
5. 只在 solved 或明确允许的 underconstrained 情况下提交一步事务；
6. 在画布上标出被拒的约束和保留的自由度。

这条线要复用 SolveSpace 式的 `dof` 与失败约束语义，但不直接复制其实现。

### C. 形式证明出口

**目标**：让“本图成立”“若干采样成立”“对所有满足条件的对象成立”在产品上严格分开。

阶段：

1. 先把目标和题设导出为可序列化证明任务；
2. 对有限、已支持的平面几何片段生成 Lean/Mathlib 或 AlphaGeometry/Newclid 风格的中间语言；
3. 外部证明后端返回 proof artifact、失败或 unsupported；
4. UI 只在 proof artifact 通过独立校验时显示“形式证明”；
5. 没有 proof artifact 时只能显示 verified_instance 或 sampled。

第一批只选共线/共面、平行/垂直、等长、勾股等短链条，不尝试把任意高中立体证明自动形式化。

### D. 开放式自然语言题理解

**目标**：让 Agent 能处理没有固定模板的高中题面，同时保留可追溯和可拒绝边界。

采用“分层编译”而不是“大提示词”：

1. 题面切句与实体/点名对齐；
2. 生成 Obligation IR 草稿；
3. schema/语义/来源校验；
4. 对每条 claim 选择 judge 或标 unknown；
5. 规划 construction/solver/proof 子任务；
6. 由系统执行，不允许模型直接写文档；
7. 失败时返回缺失信息、矛盾或未支持语法。

开放题 benchmark 要把“抽取正确”和“图形正确”分开统计，不能只看最终是否有一只 `polyhedron3`。

## 5. 推荐实施顺序

### Phase N1：约束 IR + 自由度诊断

先不接外部 solver；把现有关系和动态约束统一为 IR，给每个对象计算自由度、残差和冲突集合。出口是所有现有关系测试仍绿，且 UI 能解释 underconstrained/overconstrained。

### Phase N2：小型解析求解器

实现直角底面、垂足、中点、比例和单一角度的解析构造；补一个有限预算数值后端。出口是可重复地产生 `verified_instance` 或 `no_witness`，每个结果带证据。

### Phase N3：动态约束拖动

把 N1/N2 接到点拖动和一步撤销；增加真实浏览器拖动约束的正/反例。出口是拖动不会静默破坏已确认题设，且冲突可见。

### Phase N4：真实 provider benchmark + 开放题编译

先用固定题集测真实模型，再扩大题型；记录抽取、规划、求解、验证、可读性各层指标。只有 provider 基线稳定后，才调整提示词、工具循环或模型选择。

### Phase N5：形式证明试点

选 5~10 个短证明目标，建立从 Obligation IR 到证明后端的最小闭环；证明失败必须显示“未形式化/无法证明”，不能回退为“示意图通过”。

## 6. 发布门槛

- 求解器结果可重复，具有 solver status、自由度、残差和失败约束；
- 动态拖动不会静默破坏已确认约束；
- 开放题至少能把抽取失败、求解失败、验证失败和证明不支持分开；
- 形式证明状态必须有可独立校验的 artifact；
- 真实 provider 有 pass@1/pass@3、成本、延迟和人工可读性基线；
- 全量既有门禁保持通过。

## 7. 非目标和风险

不直接把 Z3、SolveSpace、FreeCAD、OpenCascade、Lean 或 AlphaGeometry 代码嵌入 MathCanvas；先做适配边界和许可证审查。非线性求解可能出现多解、局部最优、超时和数值病态；这些必须成为产品状态，不可被模型文案掩盖。形式证明覆盖率会远低于静态作图覆盖率，必须单独发布和评测。

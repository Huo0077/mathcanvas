# 画图整改实施参考：采用什么、不要照搬什么

核对日期：2026-11-15。本文是建议，不代表已安装、集成或验证任何新依赖。所列均为作者/项目官方文档，HTTP核对记录见[来源检查](../audit/2026-11-15-drawing-implementation-audit/reference-checks.json)。不以引用一份资料代替本项目的失败复现和回归测试。

## R1 — CGAL：区分“判定可靠”与“构造可靠”

官方：Exact_predicates_exact_constructions_kernel 类参考。

地址：`https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Exact__predicates__exact__constructions__kernel.html`

官方区分精确几何判定和精确几何构造；该内核提供两者。**本项目借鉴**：将拓扑/方向符号判断、坐标构造和误差证据分层，不认为坐标看起来精确就等于关系可靠。

**具体落点**：solid-builders.ts 的orientation/共面/自交；conic-line.ts 的根分类与回代；数值策略任务T11。

**不建议**：本轮直接把TypeScript内核替换成C++ CGAL。若后续做WASM或native适配，必须独立评估许可证、包体、部署、精度边界和平台成本。精确运算也无法恢复输入浮点数已丢失的信息，更不能修复错误题意。

## R2 — Jonathan Richard Shewchuk：稳健几何谓词

作者页面：Fast Robust Predicates for Computational Geometry。

地址：`https://www.cs.cmu.edu/~quake/robust.html`

作者解释近零行列式的浮点舍入如何造成方向/内外判定错误，并提供自适应精度的orientation/incircle方法。**本项目借鉴**：先定位确有误判的谓词，再引入误差界与必要时的高精度回退；不是全局扩大epsilon。

**具体落点**：面环投影后的方向测试、共线/共面分类；T09/T11。先用近共线、尺度变化和顶点顺序变式证明需要，而非先换库。

**不建议**：把精确方向判定当成任意非线性折叠求解器；不要声称数值残差小就证明所有根已找到。

## R3 — SymPy solveset：域与未解集合

官方：Solveset文档。

地址：`https://docs.sympy.org/latest/modules/solvers/solveset.html`

文档强调解集、指定域，并以ConditionSet表达尚未解出的条件集合。**本项目借鉴**：solved、无解、未知、超出支持范围必须分开；实数/参数域和根筛选进入合同，而不是最后随便取一个数字。

**具体落点**：T04符号圆锥曲线、T07参数求解、T10/T12结果分型。SymPy优先用作开发期独立黄金值/对照工具；若引入服务端求解，要先审计依赖与离线部署。

**不建议**：在桌面主链直接增加Python运行时，或把CAS给出一个解当成完整性证明；仍须原题代回、检查域、分母和分支。

## R4 — fast-check：性质测试与最小失败样本

官方：Introduction。

地址：`https://fast-check.dev/docs/introduction/`

该项目自动生成输入并缩减失败案例。**本项目借鉴**：改名、旋转、平移、合法尺度变化、格式变式和扰动负例；记录种子及最小失败样本，回归不只盯36个原题字符串。

**具体落点**：T03–T11及T17。初期可用已有Vitest参数化循环；需要生成/缩减能力后再单独批准新增devDependency并锁版本。

**不建议**：生成无效几何后全部filter掉，使测试看似很多却没有有效覆盖；不得任意用非等距仿射变换声称角度/长度不变。

## R5 — Playwright：实际显示的可复现视觉比较

官方：Visual comparisons。

地址：`https://playwright.dev/docs/test-snapshots`

官方说明不同平台/浏览器/字体会产生不同截图，快照需要控制环境并审查更新。**本项目借鉴**：固定浏览器、系统、字体、视口、DPI与相机；数学断言和截图各管各的。

**具体落点**：T15实际渲染与T16交互。截图检查辅助点/标签/遮挡，结构化场景断言检查实体/几何，不能互相替代。

**不建议**：为让回归变绿直接批量更新快照、扩大像素阈值；浏览器测试不能自动代替Tauri桌面原生链路验收。

## R6 — NIST：比例置信区间

官方工程统计手册：7.2.4.1 Confidence intervals。

地址：`https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm`

官方讨论二项比例的Wilson等区间方法。**本项目借鉴**：报告分子/分母和预先选定的区间算法；样本小或零失败时，不用“观测100%”声称总体100%。

**具体落点**：T17/T18。对独立同分布近似可用二项模型；同一道题重复3次存在相关性，不能自动算成3道独立题。参数变式、题族聚集需单独报告或按题聚合。

**不建议**：只报置信区间上限、把36题开发集当随机代表样本、事后挑最有利统计法。零失败的一侧95%失败率上界为1−0.05^(1/n)，使用时必须说明独立性前提。

## R7 — Z3：有边界的约束求解，而非万能兜底

官方：Arithmetic，Online Z3 Guide。

地址：`https://microsoft.github.io/z3guide/docs/theories/Arithmetic/`

官方讨论算术片段及非线性求解的限制；某些问题会unknown或无法终止。**本项目借鉴**：给求解器限定支持域、时间/资源和结果证据，不将unknown当unsat。

**具体落点**：T10/T12；仅当既有内核对明确受限子类不足时做隔离spike，对一组已审核问题比较收益。

**不建议**：默认增加Z3，把所有三角函数/折叠/任意自然语言约束丢给它，或认为“求解器说sat”就可跳过图元回代与视觉检查。

## 建议采用顺序

1. **立即借鉴思想、不新增依赖**：R1/R2的数值责任边界，R3的结果状态/定义域，R5的环境固定，R6的统计口径。
2. **开发期小范围评估**：R4性质测试，R3独立符号对照；先证明能发现现有用例漏掉的错误。
3. **只有证据表明必要才做spike**：R1的原生几何内核适配、R7外部约束求解；选择失败时能撤掉，不绑死生产架构。

上述材料是工程参考，未提供当前产品“能达到100%”的证明。项目事实仍以[实现审计](../audit/2026-11-15-drawing-implementation-audit/README.md)和[实施手册](../superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)为准。

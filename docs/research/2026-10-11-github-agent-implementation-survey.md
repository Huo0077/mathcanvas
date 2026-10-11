# GitHub 源码调研：四家族 Agent 下一步如何实施（2026-10-11）

> **这是实施取舍，不是外部项目接入记录。** 在 [真题需求调研](2026-10-11-four-family-exam-diagram-survey.md)基础上，核对相关开源项目的仓库、源码/官方文档和可见许可，再映射到 MathCanvas 已有文件。未复制外部代码、未安装依赖；外部功能不计本产品完成度。[旧 GitHub 架构调研](2026-10-04-github-project-survey.md)只给原则，本页给可落地的测试与落点。

## 1. 经过源码或维护者文档核对的机制

| 项目与可复查入口 | 证据、要借的做法 | 本仓具体落点与不做的事 |
| --- | --- | --- |
| [GeoGebra `AlgoElement.java`](https://github.com/geogebra/geogebra/blob/main/source/shared/common/src/main/java/org/geogebra/common/kernel/algos/AlgoElement.java)、[仓库](https://github.com/geogebra/geogebra) | 算法对象登记输入/输出依赖，输入变化触发重算。**可借的是“生成图元必须带真实依赖”这个数据流模式**，不是把生成时坐标固定在图上。 | `packages/geometry-kernel/src/dependency-graph.ts`、`packages/agent-core/src/planCompiler.ts` 和 `apps/web/src/agent/draftStore.ts`：E/F 必须依赖 AD/AB 的比例，折面依赖 E/F 与目标条件；改原题/拖动/撤销时重算、证据 stale。**不移植 GeoGebra 源码或替换已有场景图。** |
| [SolveSpace 仓库](https://github.com/solvespace/solvespace)、[约束说明](https://solvespace.com/constraints.pl) | 参数化约束可能无解或仍有自由度；单纯显示一组点不足以说明是否唯一。其仓库按 GPL 发布；这里只借诊断概念。 | `packages/agent-core/src/solver/solverContracts.ts`、`packages/geometry-kernel/src/witness/constructors.ts`：区分可行实例、自由度未定、可证明矛盾、未覆盖及超时；返回冲突的原题条件 ID，而非笼统 `no_witness`。**不嵌入 SolveSpace 求解器。** |
| [SymPy `solveset` 维护者文档](https://github.com/sympy/sympy/blob/master/doc/src/modules/solvers/solveset.rst)、[仓库](https://github.com/sympy/sympy) | 解集 `EmptySet` 与未能求全的 `ConditionSet` 有不同语义；“算法没找到”不能等于“数学无解”。 | `packages/agent-core/src/solver/witnessSearch.ts` 与 `diagramVerification.ts`：返回 `contradictory` / `unsupported` / `timeout` / `partial` / `verified_instance` 互斥状态，编译器与 UI 不合并。SymPy 可作**离线交叉检验**，不是浏览器/桌面运行时强制 Python 依赖。 |
| [JSXGraph 源码、测试与许可](https://github.com/jsxgraph/jsxgraph)、[数值求根 API](https://jsxgraph.org/docs/JXG.Math.Numerics.html) | 其交互数学图既展示动态图，也有数值求根接口可参考；仓库声明 LGPL/MIT 双许可，仍需按实际使用方式核对。 | 先在已有 `packages/geometry-kernel/src/curve-intersections.ts`、`calculus.ts`、`conics.ts` 增加切触、竖直线、边界区间/漏根测试；在 `apps/web` 增加画布证据。**不把屏幕采样点数当根数证明，不因看到库就更换 SVG/Three.js 渲染层。** |
| [Mafs React 数学图仓库](https://github.com/stevenpetryk/mafs)、[作图指南](https://mafs.dev/guides/display/plots) | README 明确使用单元、端到端和浏览器截图回归；可借“可视呈现独立于数学核验”的测试分层，不把截图当数学证明。 | 仅把测试启发落在函数图真实浏览器截图、定义域断点、多个切点可见性上；目前不增加新的绘图库，不让视觉截图代替核验器。 |
| [Z3 仓库](https://github.com/Z3Prover/z3)、[非线性问题中的超时/unknown 案例](https://github.com/Z3Prover/z3/issues/10505) | 该议题记录过非线性条件下超时返回 `unknown`，**相关特例于 2026-08 已关闭修复**；它说明接口仍须区分 unknown/timeout 与数学无解，不能把某个已修旧故障说成当前仍存在。 | **暂不引入桌面/浏览器运行时依赖**。若本仓构造器对调研真题的一个*稳定且可缩小*子类确实不够，再以隔离适配器、离线相同题集、超时/体积/许可对照决定是否值得引入；原图逐条回代仍独立执行。 |

## 2. 五条直接写入实施计划的取舍

1. **先改本仓真实链路，不换引擎**：`agentRunner → modelPlanner → coordinator → outputParser → planCompiler → witnessSearch/geometry-kernel → draftStore/Worker → scene-graph → 画布`。最初失败的 `solid.create_segment` 是模型计划/工具合同问题，不能靠新的几何库修。
2. **状态先于求解器选择**：先把可行/欠定/矛盾/未知/超时的语义在四家族、Worker 与 UI 统一；复杂求根只在有失败样本证明需要时补。
3. **几何构造与展示分层**：点名和拓扑从图形意图生成；求解器算坐标；独立核验从最终图元量；真实浏览器保证读得见、点得中、视角和标注不误导。屏幕像素不做证明。
4. **动态图要有依赖**：从四边形到分点到翻折片是一条真正的图形依赖链，修改源点/条件后重算或 stale，不能在确认时烘焙成一堆不相干点。
5. **许可和性能守门**：本阶段只借公开设计、API 形态与测试边界，不复制外部源码；是否新增第三方运行时依赖另需可复现的 bundle 体积、延迟、许可核对和用户确认。外部 repo 的品牌/成熟度不能替代 MathCanvas 自己的真题通过率。

## 3. 计划对应关系

实施步骤、精确文件/测试命令、RED/预期 GREEN、依赖次序及验收见[四家族 Agent 下一步实施/进度](../superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md)。这份 GitHub 调研已在本轮完成，不列为未来开发任务。
## 4. Lean/mathlib 兼容与安全：在本仓受限后端上继续做，不换后端

- [Lean 官方 `Axioms` 参考](https://lean-lang.org/doc/reference/latest/Axioms)说明 `#print axioms` 会列出声明所依赖公理，含 `sorryAx` 可暴露未完成证明。现有 `proofArtifact.ts` / `lean4Adapter.ts` 已检查白名单与证明正文；后续**保持**负例，不把 `exit=0` 当成功，也不能把“证了模板定理”说成“原题全部必要前提已形式化”。先做原题条件到命题前提的来源对账。
- [Lean Lake 官方仓库文档](https://github.com/leanprover/lean4/blob/master/src/lake/README.md)介绍 `lake-manifest.json` 固定依赖修订；[mathlib4 仓库](https://github.com/leanprover-community/mathlib4)有自己的 Lean 工具链和预编译缓存流程。**本仓已经 pin** `proof/lean4/lakefile.toml` 的 mathlib commit、`lean-toolchain` 和 `lake-manifest.json`：不是把它们再列作“尚未 pin”的 bug；实际缺口是冷机、离线、许可与完整桌面发行验收，绝不因本次设计自动更新版本或下载 GB 级缓存。
- 结合 [GeoGebra 输入/输出依赖](https://github.com/geogebra/geogebra/blob/main/source/shared/common/src/main/java/org/geogebra/common/kernel/algos/AlgoElement.java) 的启发，证明尝试必须绑定草稿文档 ID、原题条件/目标 ID、图元/选择和后端版本。异步跑完若图/题/工作区变了就 stale，浏览器“没有本地 Lean”与桌面“Lean 验证失败”不能混为一谈；旧作图的可提交性不依赖证明后端。

具体的文件、先红后绿、真桌面/无网验证和旧功能兼容/缺陷任务见[总计划中 Lean/兼容对应的 Task 1、17–19](../superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md)。
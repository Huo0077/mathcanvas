# 画图阶段验收合同与实施附录（P0–P8）

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：P0–P8画图阶段验收合同；不是另一份实施总入口。实时状态仅维护在[当前状态](../../current-status.md)；执行总顺序以[完整实施主计划](2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

**版本事实（2026-11-15对齐）**：代码基线59ea3613、重启提交be033b71；旧范围59ea3613..d8743a32的47提交此前已备份并舍弃。重启提交/同步是已发生的操作，不再作为未来任务反复执行；本文实现细节待实际验收。本次对齐不提交/推送，不包含新功能或付费授权。

日期：2026-11-15；基线：59ea36133c47971f4252e71f7a0f5ba003dd1028；v4.3.0。

> **状态：待批准；P0–P8 全部未开始。** 本轮只交付文档；设计见[全面设计](../specs/2026-11-15-drawing-reliability-design.md)，实时进度见[当前状态](../../current-status.md)，原始依据见[基线审计](../../audit/2026-11-15-drawing-baseline/README.md)。

**Goal:** 在已审核、冻结的画图合同上实现 36/36 端到端通过，再用未见题验证泛化，不承诺任意题 100%。

**Architecture:** 扩展现有 ObligationIR；模型负责语义提案，确定性内核构造，独立校验器检查最终候选；沿用原有草稿/确认安全链路，不另造第二套业务入口。

**Tech stack:** TypeScript、现有几何内核与 solver、Vitest、Playwright、Tauri/Rust。新增外部 CAS/SMT 暂不纳入。

**具体怎么修**：请连同[详细实施手册](2026-11-15-drawing-reliability-execution-handbook.md)阅读。它把P0–P8拆为T01–T18，提供源码位置、拟定接口、算法建议、RED案例、36题映射和参考资料；不另建实时状态表。

## 审查修订：本阶段计划不是现在的起手顺序

总顺序统一按[完整实施主计划](2026-11-15-main-restart-master-plan.md)，具体R任务见[审查技术附录](2026-11-15-review-driven-next-implementation-plan.md)：R00基线→R01-A→R09-A→R10、G1（R02–R06）及G2（R07、R08、R09-B、R11）均已收口。当前正在按 DAG 推进 `B4`（`P0–P6`）：`P0 / T01` 黄金契约与统一口径已落地（[P0 / T01契约与口径证据](../../audit/2026-11-16-p0-drawing-contracts/README.md)，待第二位独立审阅者复核后退出 P0），`P1 / T02` 单一 `ProblemContract` / 来源映射 / 作用域 / 无损 `ObligationIR` 与 `R01-B` 选问已收口（[P1 / T02契约证据](../../audit/2026-11-16-p1-problem-contract/README.md)），`P2`（`T03` 比例/位置分离与完整角等式链，[P2 / T03关系语义与角链证据](../../audit/2026-11-16-p2-relation-chains/README.md)；`T04` 表达式 AST、定义域保留与符号圆锥曲线契约，[P2 / T04符号圆锥曲线与AST证据](../../audit/2026-11-16-p2-symbolic-conic-ast/README.md)）已收口，`P3`（`T05` 稳定多实体绑定、同向向量比与忠实原文诊断，[P3 / T05实体绑定与诊断证据](../../audit/2026-11-16-p3-entity-binding-diagnostics/README.md)；`T06` 必需对象清单与无环构造DAG，[P3 / T06构造DAG证据](../../audit/2026-11-16-p3-drawing-intent-dag/README.md)）、`T11` 尺度感知数值策略（[P5 / T11数值稳健性证据](../../audit/2026-11-16-p5-numeric-robustness/README.md)）与 `T07` 平面与圆锥曲线确定性构造（[P4 / T07平面作图证据](../../audit/2026-11-16-p4-planar-drawing/README.md)）已收口，下一步进入 `T08`；`P7–P8` 仍未开始。

C1安全护栏不依赖P0全36题审完；P1必须处理裸条件/设/且导致的原始解析丢失，不仅是IR迁移。P7需先解决审查已发现的E2E定位器漂移、宽度/网格契约和生产外接球披露；P8新增G1/G2安全/干净CI前提。

## 0. 执行约定与测试方式

1. 每个任务先最小失败测试 RED（必须确认按预期原因失败），再最小实现 GREEN，最后整组回归/人工复核。历史测试全绿不代表新能力通过。
2. 每个阶段可拆成若干小提交；本轮不自动提交或推送。后续实施时先检查工作区，不能覆盖其他人的修改。
3. 现有路径在下文列明；“拟新增”文件只是计划，不是已存在。优先扩展既有测试，不按题号硬编码。
4. 所有证据带 revision、input/contract/candidate hash、scope、运行模式、环境和退出码；必要时保存种子、数值容差、分支和模型标识。日志脱敏，不提交密钥或完整私有请求。
5. 新路径以 feature flag/能力开关渐进接入旧入口；失败要能回滚路由和数据适配，不能撤销原文/审计证据。
6. 本文命令是未来实施步骤，不表示已经运行。所有命令在仓库根 D:/draw/draw 执行；Windows 使用 npm.cmd。RED/GREEN 用目标文件单跑，默认不调用付费 provider。

~~~powershell
# 定向示例；每阶段选择实际变更的测试文件
npm.cmd exec -- vitest run packages/agent-core/src/obligationIR.test.ts --testTimeout=30000
# 无付费请求的已有可靠性冒烟（不是冻结36题全量成绩）
npm.cmd run eval:reliability -- --offline
# 阶段收口
npm.cmd run test:docs -- --testTimeout=30000
npm.cmd run typecheck
npm.cmd test -- --testTimeout=30000
npm.cmd run test:rust
~~~

不要把现有 offline 冒烟套件当成这 36 题的完整回归。P0 要新增/接入明确的 36 题合同入口，不能只改报告标题。旧回放文件必须符合已有 replay schema，原始题目结果 JSON 不能直接充当 replay 信封。

## P0 — 冻结基准、黄金合同与统一测量

**依赖**：无；优先执行。**退出门槛**：36/36 逐题题设、对象、scope、预期验收经独立复核；关键失败可离线重现；新旧指标并存。

### P0.1 审核输入和期望图

- 读取现有 docs/audit/2026-11-15-drawing-baseline/manifest.json、baseline-report.json、case-triage.json。
- 拟新增：scripts/reliability-eval/fixtures/drawing-contracts-36.json、drawing-contracts-36.test.ts（最终目录随现有 fixture 约定审查）；只保存题文和审核期望，不复制敏感 request trace。
- 给每题列 sourceHash、必要实体、公共条件、小问范围、辅助对象、参数域、允许自由选值、必检关系、应显示对象、合法分支和证据来源。
- 缺配图或有歧义必须人工裁定；本基线是题文模式，不擅自补想象中的配图。每个 scope 单列通过，整题汇总不能拿最容易的一问替代。
- 由两位独立审阅者复核；没有第二位时标记“待独立复核”，不能自填完成。

**RED**：删一条必要条件、修改原文 hash、漏 scope、把答案混成题设，测试必须失败。
**GREEN**：恢复完整合同后测试通过；保留审核记录和争议裁定，不能以改黄金答案适配坏图。

### P0.2 回放与指标

- 修改：scripts/reliability-eval/runner.mjs；结合既有评测 harness 适配；拟新增 drawing-baseline.test.ts 及最小失败 fixture。
- 先固化 GK-S03 坏拓扑、GK-S06 链式角、GK-P08 残留遮蔽诊断与符号关系未识别、JT-P03 多曲线、JT-P06 缺焦点、JT-P01 来源混杂等可观察输入/输出。
- 追踪 apps/web/src/agent/agentRunner.ts → agentRuntime.ts → draftStore.ts 与核心 planner/compiler/verification 的实际装配，确保生产和评测共入口，不能只在脚本里修复。
- 每题报告出图、对象覆盖、条件覆盖、数学/视觉/交互、partial/unknown、阶段失败、请求数和 token。旧证书缺失用 null/status，不归零。

**RED**：把 partial exact 当整题 pass、丢失失败样本、把 unknown 统计进通过时断言失败。
**GREEN/证据**：36 题清单不变，基线 25/36、4/36、证书不可用均可重建；支持阶段划分且请求账本一致。
**回滚**：保留旧报表字段及适配，新增字段使用 schemaVersion，不重写旧结果。

## P1 — 来源、实体与作用域合同

**依赖**：P0。**退出门槛**：必要义务全部能定位原文或明确 unknown；模型不能覆盖源题设，未绑定条件阻断完整通过。

### P1.1 扩展现有 ObligationIR

- 修改：packages/agent-core/src/obligationIR.ts、obligationIR.test.ts、diagramObligations.ts 及相关测试；必要时拟新增 problemContract.ts / problemContract.test.ts，作为 IR 封装而不是第二套解析真值。
- 增加 sourceSpan、entity ID、scope、state、provenance、coverage ledger 和判定枚举；保留 parseObligationWithLegacy/toLegacyObligationSet 适配，逐步迁移调用点。
- 区分题设/目标/推导/自由选值/展示；为多问建立公共图与独立分支，不把所有条件同时塞给求解器。

**RED**：选项当条件、证明目标当前提、跨问污染、A₁ 误绑 A、折前 D 当折后 P、两个圆锥曲线同名冲突。
**GREEN**：稳定 ID 与作用域正确，旧路由兼容；新合同错误必须显式阻断，不静默退回丢条件的旧接口。

### P1.2 来源守卫与误报分类

- 修改：promptNormalization.ts、planCompiler.ts、diagramVerification.ts；扩展现有 normalization/IR/compiler 测试。
- 追踪 plan.normalisations → parseNormalisationReply → applyNormalisation → normalizeGeometryPrompt 的源映射；原文 immutable，等价格式化保留位置映射。
- 推导和新假设另存，不能因模型写“所以 c=1”就补成用户条件。题图事实记录区域与核对版本；低置信 OCR 需核对。

**RED**：将 JT-P01 的推导混入题设、将 GK-P08 完整原式误称缺失、遗漏源片段仍生成完整通过。
**GREEN/证据**：逐条原文→合同审计表；unsupported/ambiguous/missing_input/internal_error 可区分；不支持必须保留原文。
**回滚**：合同有版本与向后适配；未支持新语义时诚实降级，不沿旧路径伪装完整证书。

## P2 — 公式 AST、别名、小问与实体绑定

**依赖**：P1。**退出门槛**：36 题已确认解析缺口都有 RED→GREEN；必需条件不再因格式丢失，换写与负例验证通过。

### P2.1 表达式与关系语法

- 修改：packages/agent-core/src/latexNormalisation.ts、diagramObligations.ts、obligationIR.ts；packages/geometry-kernel/src/expression.ts（仅在现有表达式能力确实不足时）。
- 扩展 latexNormalisation.chain.test.ts、obligationIR.test.ts、diagramObligations.test.ts；拟新增 drawingExpressionVariants.test.ts。
- 支持幂、上下标、根式、分式、隐式乘法、等式链/不等式域；生成可组合 AST，不继续堆题号正则。链式关系拆分仍关联共同 sourceSpan。

**RED**：GK-S06 “∠ADB=∠ADC=60°”被截断；GK-P09 的 x^{4}-2x^{3} 解析失败；Unicode/LaTeX 等价式产生不同语义。
**GREEN**：原式/换写 AST 等价；非法式拒绝，不将解析失败当数学不成立。

### P2.2 范围与多实体

- 修改：diagramObligations.ts、diagramVerification.ts、promptNormalization.ts；扩展 origin、goal、foldPoints、多实体测试。
- 识别题号、公共条件、各小问、选择项、动点 x=-1、A1/A₁ 与变换状态；曲线引用绑定实体 ID。
- 标准式已确定中心/坐标系时从语义获得，不要求额外自然语言提示；不把所有曲线当唯一主曲线。

**RED**：GK-P01 原式明示仍说无原点；JT-P02 动点直线；JT-P03/JT-P07 多曲线；JT-S08/JT-P06 小问冲突。
**GREEN/证据**：每题正确抽取、每必要片段可追溯；题文不完整负例仍能正确澄清；缺图元的问题留给构造阶段，不冒称全题已修。
**回滚**：保留源文本/AST 版本；新语法不可用时 explicit unknown，不退回字符串猜测并放行。

## P3 — 平面/圆锥曲线/函数的确定性构造

**依赖**：P1/P2；验收接口先与 P6 对齐。**退出门槛**：18/18 平面题在审核合同下对象和数学条件完整；视觉在 P7 另验。

### P3.1 曲线、交点与辅助对象

- 修改现有：packages/geometry-kernel/src/conics.ts、conic-parameters.ts、conic-line.ts、curve-intersections.ts、expression.ts、numeric.ts；agent-core/src/deterministicProblemRoute.ts、planCompiler.ts。
- 拟新增构造意图适配与测试：agent-core/src/solver/planarDrawing.ts、planarDrawing.test.ts（若现有 planarFigure 可扩展则复用，不重复建引擎）。
- 曲线 ID→参数域→焦点/交点/切线/弦/中点→依赖图；解支枚举与筛选留证，几何与符号引用一致。焦点不能只留在模型文字中。

**RED**：JT-P06 漏 F₁/F₂；多曲线错绑；竖直交线、相切重根、无交点、近退化构型；删第二问对象仍被认为完整。
**GREEN**：所需对象均物化、残差/域/非退化检查通过，改名和参数变式不依赖题号。

### P3.2 函数、导数与动态关系

- 修改现有 function-evidence.ts、calculus.ts、依赖图和计划适配；以需求最小化改动，目标不是重做整个绘图 UI。
- 切线、外点切线、交点和范围按合同构造；曲线采样只作显示，根和切线关系独立核验。
- 给参数/动点改变建立重算依赖；超出域/分支退化不能保留旧通过标记。

**测试/证据**：18 题逐条独立回代，正负参数/多根/无根/导数边界/域外负例，分别报告实例与全域结论范围。
**回滚**：构造策略可按能力关闭，保留已证正确对象；不能关闭检查器换取出图。

## P4 — 立体拓扑、约束与折叠状态

**依赖**：P1/P2；与 P3 不重复写共享合同。**退出门槛**：18/18 立体题对象和数学条件完整，拓扑/折叠分支正反例齐备。

### P4.1 参数化实体与拓扑

- 修改：packages/agent-core/src/solver/prism.ts、pyramid.ts、tetrahedron.ts、witnessSearch.ts、solverContracts.ts（按需要最小改动）；geometry-kernel/src/solid-builders.ts；planCompiler.ts。
- 优先参数化局部坐标，再求长度角度/垂直平行/比例关系；构造面环而不是模型猜 vertices/faces。
- 必须物化 E/F/P 等辅助点，具备宿主和比例参数；开放折纸面与封闭多面体分别建模。

**RED**：GK-S03 非共面/自交/方向错误/不连通；GK-S02 缺 E/F/P；合法开放面被误当退化多面体；负体积/共面退化。
**GREEN**：共面、面环、方向、连通、闭合要求与非退化残差明确；精确能解则精确，数值解显式容差。

### P4.2 折叠与多分支

- 修改：solver/foldHinges.ts、coupledFolds.ts、geometry-kernel/src/foldSystem.ts、solidGoalMeasurements.ts、编译与验收适配；扩展已有 foldBranches/foldConstruction/coupledFolds 测试。
- 记录折前/折后点映射、铰链、旋转角、先后顺序和转向；保距、共面/法向/目标折角分开核验。
- 处理耦合折叠可行区与合法分支；寻找失败≠证明无解；禁止随意改题设凑图。

**RED**：D/P 合并、逆序双折、镜像分支、错误目标角、退化铰链、无可行数值点被标 proven_unsat。
**GREEN/证据**：18 题条件逐项回代；变换矩阵/参数/分支与场景同版，关键题用独立解析参考或第二算法校对。
**回滚**：每种 solver 独立能力开关；无法验证时 unknown，保留诊断，不让模型坐标兜底绕过拓扑检查。

## P5 — 有界求解、局部修复与生命周期

**依赖**：P1 的诊断合同、P3/P4 的构造接口。**退出门槛**：有限预算、无进展终止、取消与过期安全均通过；首轮和修复后成绩可复现。

### P5.1 统一故障分类与预算

- 修改：packages/agent-core/src/coordinator.ts、coordinatorPorts.ts、planCompiler.ts；apps/web/src/agent/modelPlanner.ts、agentRunner.ts、agentRuntime.ts；沿用既有 budget 定义，不重复叠加次数。
- 诊断携带 stage/code/entityId/obligationId/sourceSpan/expected/actual/residual/repairable；区分语法、绑定、拓扑、求解、校验、渲染与基础设施。
- 对格式/别名/依赖顺序做确定性局部修复；几何分支局部重建；语义歧义再澄清。所有成功修复重验完整合同。

**RED**：漏点名失败却不生成有用修复请求；相同候选/诊断循环；传输重试与业务修复合计越界；无支持能力也反复烧请求。
**GREEN**：单一共享预算、停滞 hash、有限分支/迭代、实耗账本；阈值由离线回放校准，未经批准不提高真实成本。

### P5.2 取消、修改与异步过期

- 修改：agentRuntime.ts、draftStore.ts 及真实 committer 适配（先追踪现有引用再定写范围），扩展已有 runtime/draft 测试。
- 原文、参数、scope、候选修改使旧请求和证据失效；晚到结果不得自动提交。
- user cancel、网络中断、超时、无解/unknown 返回保留明确终态，不能以“完成”掩盖失败。

**测试/证据**：取消/并发/网络/预算/重复故障矩阵；同一记录回放结果一致；主场景提交前仍零写入。
**回滚**：恢复旧调度时也保留预算/取消安全，不恢复不受控重试。

## P6 — 独立完整验收与候选绑定

**依赖**：合同/负例设计从 P1 开始；集成出口依赖 P3/P4/P5。**退出门槛**：36/36 完整数学合同通过，必要负例全部拦截，partial/unknown/stale 从不伪装完整通过。

### P6.1 逐条覆盖与独立残差

- 修改：packages/agent-core/src/diagramVerification.ts、verification/taskAcceptance.ts、completionGate.ts、taskVerification.ts；apps/web/src/agent/acceptance.ts、agentRunner.ts。
- 拟新增 verification/drawingCertificate.ts / drawingCertificate.test.ts；证书是审核合同和最终场景的证据聚合，不是另一套“模型自评”。
- 输出每条义务的 supported/checked/pass/residual 与覆盖分母；所有必要条件和对象都成功，才允许完整通过。

**RED**：空通用 acceptance 被当整题通过；删必要条件/删点/换曲线/错分支/域外点仍绿；局部 exact 等同整题正确。
**GREEN**：覆盖账本与数学结论均来自独立检查，模型/构造器不能给自己签字。保持实例画图与全称证明边界。

### P6.2 变异与过期证据

- 修改：verification/renderEvidence.ts、layoutModel.ts、draftStore.ts 中证据装配；拟新增 certificateStaleness.test.ts、drawingMutation.test.ts。
- source/contract/candidate/scope/validator/render 环境全绑定；改变任一相关输入撤销证据；不复用上一候选的绿标。
- 关键题另用解析黄金值或第二算法回代；共享基础算术不等于允许共享同一个高层错误假设。

**RED**：微改长度/角度、删条件、交换焦点、折后点错绑、过期 hash、病态数值和容差越界。
**GREEN/证据**：每类必要义务有正例和能识别的反例；所有变异结果留表，不能用降低阈值/放宽容差修测试。
**回滚**：关闭完整证书功能后显示“未完整核验”，不得回显旧版 passed 为完整正确。

## P7 — 真实渲染、确认与可编辑性

**依赖**：P6 合同稳定。**退出门槛**：冻结36题真实界面端到端通过，四族交互/截图人工走查齐全，实际桌面版本一致。

### P7.1 真实画布证据

- 修改：apps/web/src/agent/renderLayoutInput.ts、agentRunner.ts、verification/renderEvidence.ts、layoutModel.ts；具体 renderer 文件先按真实引用追踪，不在未知目录臆造补丁。
- 拟新增 e2e/drawing-reliability.spec.ts 和分族截图案例；复用现有四族 E2E fixture。
- 检查真实对象/标签/投影/拾取结果，固定视口与相机；数学通过后仍要检查辅助点、遮挡、虚实线、范围和字号。

**RED**：场景对象存在但实际不可见/标签缺失；相机裁切；数学证据与截图候选不一致。
**GREEN**：结构化渲染证据 + 截图 + 人工走查一致；视觉通过不替代数学通过。

### P7.2 桌面交互闭环

- 实际测试草稿隔离→确认→单次提交→撤销/重做→保存重载；绑定点拖动保持约束，自由编辑破坏关系撤销证书。
- 图像输入另建已核对的正负样本，不把本次纯题文基线当 OCR 验收。
- Playwright 先定向运行实际新增 spec，再运行既有回归；桌面 no-bundle 构建与安装包/冷启动分别验，不混称。

~~~powershell
npm.cmd exec -- playwright test e2e/drawing-reliability.spec.ts
npm.cmd run test:e2e
~~~

**证据**：真实 UI 录制/截图、版本/二进制 hash、每题数学与视觉/交互矩阵、未运行项；完整E2E未跑就标未跑。
**回滚**：渲染布局策略可单独关闭；保留确认/撤销与证据失效机制，旧证书不得跨版延用。

## P8 — 泛化、真实 provider 与发布

**依赖**：审查驱动G1/G2安全与可信测试门禁、P0–P7达标及用户另行批准预算。**退出门槛（待批准）**：设计 §6 的封闭回归/盲测/安全/成本门槛全部满足，失败样本全留账。

### P8.1 建未见题和预算合同

- 拟新增独立审核未见题至少 120 道，每族至少30；变式/负例/带配图集另算。题型覆盖、难度与输入模式在运行前冻结，避免精挑容易题。
- 固定模型、路由、首轮/修复上限、请求/token/费用/时长和停止条件；独立复核后至少3轮，不取最好一次。
- 失败题进入开发集后，下一轮另补新的盲测题；逐族报告原始计数、置信区间和样本相关性。

**RED**：provider预算缺失仍启动；分母漏失败；把澄清算出图；只报 pass@k；把开发题当未见题。
**GREEN**：未授权真实请求硬阻断，预算异常/取消可复现；费用未知保留 unknown，预留上界不冒充实付。

### P8.2 发布与回滚演练

- 修改：发布门禁/能力目录/scorecard 的新计划导航和本轮证据引用，不覆盖旧历史事实；实时成绩只维护 current-status.md。
- 运行类型检查、全量 Vitest/Rust、离线/回放、已授权真实 provider、浏览器/桌面回归；失败全部说明，todo/ignored 不隐去。
- 目标：36/36端到端；未见题首轮≥95%、有界修复后≥99%（逐轮/逐族均不得被总体掩盖）；审核负例错误完整放行0。达不到则不发布、不改口径。
- 灰度、关闭新路线、撤销旧证书、恢复存档和回放失败案例的回滚演练通过后，人工批准发布。

**证据**：版本化报告、每题结果、原始计数/样本量/不确定性、成本账本、二进制hash、回滚记录；不得称任意题已达100%。

## 依赖与推进顺序

~~~text
P0 → P1 → P2 → P3（平面）→ P5 → P6 → P7 → P8
               ↘ P4（立体）↗
P6 的合同/负例在 P1 同步设计，最终收口在 P3/P4/P5 集成之后。
~~~

这是画图模块依赖，不是完整项目发布顺序，也不授权并行代理。下一步先按审查驱动方案R00/R01-A/R09-A/R10闭环，再G1/G2与本文P0/P1；每阶段有新证据才完成。安全修复失败时保持入口关闭，不回退到已知错误放行。

## 实施记录模板（目前无功能执行记录）

~~~text
阶段/子任务：
输入合同与revision：
修改文件：
原失败/根因证据（观察与推断分开）：
RED：命令、预期失败与实际退出码
GREEN：命令、通过/失败/跳过与实际退出码
独立反例/回代/人工审查：
冻结36题：对象/数学/视觉/交互分子与分母
首轮/修复后、请求/token/耗时：
未做/unknown/风险：
证据位置与hash：
回滚方法及演练结果：
审阅人与是否达到退出条件：
~~~

本轮保存基线证据不等于 P0 的黄金合同已完成；本轮方案文档完成不等于 P1–P8 任一功能已完成。所有阶段仍未开始，下一次实施须在当前状态入口回填实际证据。

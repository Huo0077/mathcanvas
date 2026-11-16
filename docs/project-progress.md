# MathCanvas 项目过程日志

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：过程日志；有日期的操作/测试记录是历史事实，不自动等于当前状态。实时状态仅维护在[当前状态](current-status.md)；执行总顺序以[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](superpowers/plans/2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

最后更新：2026-11-16。

实时阶段进度只维护在[当前状态](current-status.md)。本文只记本轮过程；旧完整过程日志及旧状态/下一轮记录已按原字节[归档](audit/2026-11-15-pre-reset/README.md)，不删除历史、不继承旧完成数字。

## 2026-11-16 —— G3 / T01 跨状态折叠谱系

- **实现**：新增 `fold-transform-3d`、`stateCandidates` 与 `evaluateDrawingContractStates`，内核重算 F→E +90° 的 A/B 位置并核验铰链漂移，缺状态/缺点/非刚体旋转失败。
- **纠错与反例**：诊断发现合同 E→F 与测试 F→E 镜像不同，修正有向铰链而不改容差。伪造坐标仍满足 CF⊥BD、面面垂直与开放面环，但不符合同一翻折，已被拒绝。聚合缺 after_fold 返回 incomplete。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）及文档61项通过；未新增离线 reliability 读数。生产stage/runner、其他折叠和T15/T16未完成。证据：[跨状态折叠谱系](audit/2026-11-16-g3-fold-lineage/README.md)。

## 2026-11-16 —— DeepSeek 真实评测：端点重新授权阻断

- **用户新授权**：改用保存的 DeepSeek 做真实 provider 评测，不再以离线结果代替；P8与正式发布仍不开启。未读取、输出或保存密钥到 shell/文档。
- **真实执行**：通过 Tauri 正常设置界面选择最小题集 planning（至少3次请求），未运行至少24次请求的另一通道。实际为 **0 planned / 3 error**，32ms为本地失败回合，成本 not measured。
- **阻断**：旧凭据没有可信端点绑定，必须用户在编辑表单重新输入 API key 并保存才能建立授权。已打开该表单，不能用脚本读取旧密钥绕过。尚无成功模型输出或36题 provider 验收。证据：[DeepSeek端点重新授权阻断](audit/2026-11-16-g3-deepseek-provider/README.md)。

## 2026-11-16 —— DeepSeek 重新授权后最小真实评测通过

- **恢复**：用户重新输入并保存 API key，界面显示工具调用、严格 JSON、图像、流式验证通过，未读取或记录密钥。
- **真实结果**：最小题集 planning 为 **1 planned / 2 clarification / 0 error**，平均延迟1832ms，成本 not measured。一条产出可执行动作和草稿，两条合理要求澄清；没有以离线数据替代，未自动扩大为24/36次请求。
- **边界**：最小调用链连通不等于固定36题、G3-Math或G3-UX完成。证据：[DeepSeek重新授权与最小真实结果](audit/2026-11-16-g3-deepseek-provider/README.md)。

## 2026-11-16 —— G3 / T01 指定顶点与面环拓扑

- **RED→GREEN**：GK-S03 六顶点五面体合同曾被四面体满足，实测旧检查错误放行；新增 `expectedVertexIds/expectedFaceRings` 后真实五面体通过、错误绕向拒绝，循环面环起点保持兼容。
- **覆盖**：14个题面确定合同已绑定四棱锥、三棱柱/四棱柱、四面体、立方体及JT-S04开放面；GK-S09/JT-S09补辅助点命名。GK-S02、JT-S06/S07未提供题图，不猜面环；JT-S08折痕图另行处理。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过。最新离线0/11/25，对象/义务覆盖约23.50%/20.39%，更严格核验使旧虚高读数下降。fold-transform、生产证书与T15/T16未完成。证据：[指定拓扑整改](audit/2026-11-16-g3-named-topology/README.md)。

## 2026-11-16 —— G3 / T01 公共曲线与实体绑定推广

- **裁决**：前问确定且后续共用的 C/E/Γ 提升为 `stem`，而非隐式继承全部前问；绑定实际命名曲线，匿名正确曲线不得替错误 C 补位。GK-P08 原题未命名，不伪造必需标签。
- **反例**：JT-P01/P06 不可行披露搭配错误 C、GK-P01 匿名曲线替身、GK-P02 M=N 均由 RED 转为拒绝，恢复39项通过。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、单独Web构建（640 modules）及文档61项通过。离线0/12/24不变，义务覆盖约22.24%；指定拓扑、折叠谱系、切线端点及参数域/最值仍未闭合。证据：[公共曲线整改](audit/2026-11-16-g3-shared-curves/README.md)。

## 2026-11-16 —— G3 / T01 scope 继承与曲线/实体绑定试点

- **RED→GREEN**：JT-P05 跨问错 C、JT-P08 错误轨迹参数、GK-P09 零长度切线、JT-S01 全局强制 O/父条件丢失均先得到4项失败，再补通用判据与合同后恢复39项通过。
- **实现边界**：新增显式 `dependsOn`、`conic-2d.entityId`、轨迹实际参数核验、可选 `primitiveType` 与函数切线非退化；不隐式继承全部前问。JT-S01 的 O 仅属 `(1)(ii)`，且必须是真实球体。
- **验证**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）与文档61项通过。
- **未关闭**：离线仍为0/12/24，生产未路由不能由合同GREEN抵销；其余合同推广、指定拓扑、折叠谱系、切线端点与参数域/最值继续整改。证据：[scope与实体绑定试点](audit/2026-11-16-g3-scope-entities/README.md)。

## 2026-11-16 —— G3 / T01 第二轮独立复核与数学分支整改

- **独立复核**：agent-0 逐题复核36/36，4题作图数学合同可批准、32题需整改；T01/P0仍未退出，未由作者自签 approved。审计完整保存逐题理由、Critical/Important/Minor 与边界。
- **实质整改**：GK-P03 最优直线改为 `x−√2y−4=0` 并拒绝 `s=2`；GK-P06 枚举 `D=0,±1` 和面积 `3或4√2`；JT-S04 用真实90°铰链旋转确认 BE=5，反例20/3被拒绝；JT-S09 增加真实六面闭合拓扑。补 M/N互异、AB点名、切线端点、圆半径/切点义务。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；最新离线结果为 **0 passed / 12 partial / 24 failed / 0 incomplete**，义务覆盖约22.38%。未路由和生产未接线仍导致24题失败，不能用合同GREEN冒充生产提升。scope继承、指定拓扑、跨状态折叠、切线绑定及参数域/最值仍未关闭。
- **证据**：[第二轮独立复核与整改](audit/2026-11-16-g3-contract-review-r2/README.md)。

## 2026-11-16 —— G3 / T01 第三批定义域、分支与切线整改

- **定义域/分支**：新增 `conic-domain-2d`、`evaluateDrawingContractBranches`、`line-equation-2d`；JT-P08排除 `(0,±√3)`，positive/negative双EF分别验证，缺支或漏排除点不通过。
- **切线/面积**：函数切线用符号导数、圆锥切线用真实代数交点；GK-P09错误斜率拒绝，GK-P07补P在圆M和两条抛物线切线，GK-P06补双切线/中点圆相切/面积，JT-P09补圆上/共线/四边形面积。
- **验证**：定向29项通过；全量540文件/5725通过+1todo，typecheck、lint（0 errors/33既有warnings）、Web构建（640 modules）通过。
- **边界**：最新36题为 **0 passed / 11 partial / 25 failed**，旧JT-P08因缺 `excludedPoints` 不再通过；生产DSL/渲染支持仍需后续接线。选择题子问文本保持中性。证据见[第三批定义域与切线整改](audit/2026-11-16-g3-domain-tangent/README.md)。

## 2026-11-16 —— G3 / T01 第二批拓扑、宿主与平面关联整改

- **立体**：新增 `topology-3d`（闭合/开放分开）、`coplanar-3d`、`point-on-segment-3d`；GK-S03/S02补拓扑与题图边界，JT-S03补垂足平面与第二方向，JT-S08补M线段域，GK-S07补棱柱对应向量与闭合拓扑。
- **平面**：新增点在线/线段/曲线、水平和x坐标判据；GK-P01补A/B在l与O，GK-P02补P/M/N共线、MT水平、T在线段AB，JT-P02补双曲线交点与共线，JT-P07补点值、l、P/Q及x=3交点。
- **验证**：定向25项通过；全量540文件/5721通过+1todo，typecheck、lint（0 errors/33既有warnings）、Web构建（640 modules）通过。两处测试坐标经独立复算纠正，未放宽实现判据。
- **边界**：最新36题仍为1 passed/10 partial/25 failed，义务覆盖约22.5%，不是通过率提升；T01/P0未退出。证据见[第二批拓扑与宿主整改](audit/2026-11-16-g3-host-topology/README.md)。

## 2026-11-16 —— G3 / T01 第一批合同安全整改

- **不可行与scope**：`infeasible-branch` 改为禁止实体绑定，修复JT-P06伪造P+披露、GK-S05全局强制P；新增 `evaluateDrawingContractScopes` 与二面角正弦/余弦判据，GK-S01补两问义务，JT-S02恢复真正面面垂直并补P宿主/二面角。
- **结构与数学**：真实 `sphere` 的外接球、等棱三棱柱、正方体棱长与半球内接检查取代名实不符谓词；GK-P04范围改为 `[-1,+∞)`，JT-P04(2)改为无实数解；函数/直线判据绑定唯一实体，f/g交换与替身直线均拒绝。
- **验证**：定向16项通过；全量540文件/5712通过+1todo，typecheck、lint（0 errors/33既有warnings）、Web构建（640 modules）通过。最新冻结36题为 **1 passed / 10 partial / 25 failed**，GK-S01旧passed降为partial是补验小问后的正确结果，不回退。
- **边界**：T01/P0未退出，独立reviewer尚未复审本切片；继续剩余关联义务、拓扑、显示策略和统一scope入口。证据见[第一批合同安全整改](audit/2026-11-16-g3-contract-safety/README.md)。

## 2026-11-16 —— G3 实核、T01 第二独立审题与整改重启

- **用户 goal**：按最新主计划完成 G3，每个区块验证、对齐活动文档并推送 GitHub；续作计划见[G3完成计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。
- **真实基线**：在 `8c26544c` 重跑冻结36题，结果为 **2 passed / 10 partial / 24 failed / 0 incomplete**，对象/义务覆盖约28.0%/25.7%，不是此前工作包提交记录可替代的 G3 退出证据。
- **第二独立 reviewer**：36/36逐题复核，结论 `changes_required`；仅 GK-P08 作图数学合同可批准，其余35题须整改。发现 GK-S01 局部条件未入义务、GK-S05/JT-P06 不可行点伪造、JT-S02 目标当题设、GK-P04 值域错误、JT-P04 伪解及立体拓扑/稳定实体绑定等系统性问题。
- **处置**：T01/P0 保持未退出；先提交否定性审计 checkpoint，再以 RED 反例整改合同和评测语义，之后进入生产证书接线、平面/立体数学闭环、T15/T16。全量工程基线复跑为540文件/5705通过+1todo；不进入P8、付费provider或发布。
- **证据**：[G3实核基线与第二独立审题](audit/2026-11-16-g3-truth-baseline/README.md)。

## 2026-11-16 —— P4 / T14 最终候选绑定、过期检测、仅相机不变性与原子一次确认（B4 工作包收口记录）

- **RED 复现**：新建 `drawingCertificateStaleness.test.ts` 并扩充 `committerAdapter.test.ts`，实现前 RED `2 failed | 4 failed | 44 passed (48)`。
- **候选保鲜、仅相机分离与防双击落盘**：`drawingCertificate.ts` 落地 `verifyCertificateFreshness`；`renderEvidence.ts` 区分 `camera_changed`（`mathStale: false, visualStale: true, requiresReplan: false`）；`committerAdapter.ts`、`agentRuntime.ts`、`agentRunner.ts` 与 `draftStore.ts` 落地原子一次确认锁（拦截二次点击写入）与 `promptHash` 过期检查。
- **验证**：定向 5 文件 103 项通过；最终编辑后全量 Vitest **540 文件 / 5705 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过，至此完成 `B4`（`P0–P6`）并按指令在 `T14` 后暂停；证据见[P4 / T14原子提交与保鲜证据](audit/2026-11-16-p4-atomic-commit-staleness/README.md)。

## 2026-11-16 —— P4 / T13 完整数学合同独立核验证书与变异拒绝矩阵

- **RED 复现**：新建 `drawingCertificate.test.ts` 与 `drawingMutation.test.ts`，实现前 RED `2 failed (2)`（缺失 `drawingCertificate.ts`）。
- **独立重算证书与变异拦截落盘**：实现 `drawingCertificate.ts`（`isDrawingRequestContract`、`evaluateMathGate`、`certifyDrawingAgainstContract`），结合 `acceptance.ts`（`isDrawingPrompt`）、`completionGate.ts`（重复 ID 自相矛盾检查）与 `diagramVerification.ts`（非有限坐标 `non_finite_geometry` 防线），直接对着最终图元坐标与 `conicResidualAt`/函数绑核重算，忽略自报证据并在关闭完整开关时显式报告 `"未完整核验"`。
- **验证**：定向 3 文件 16 项通过（覆盖 36 题合同必填结构与 8 类数学变异拒收 + 无关辅助点不变性）；最终编辑后全量 Vitest **539 文件 / 5701 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T13数学证书证据](audit/2026-11-16-p4-math-certificate/README.md)。

## 2026-11-16 —— P4 / T12 有界局部修复、停滞拦截、原子账本与 Worker 取消

- **RED 复现**：新建 `reliabilityDiagnostics.test.ts` 并扩充 `budget.test.ts`、`coordinator.test.ts` 与 `geometryWorkerClient.test.ts`，实现前 RED `4 failed (4) | 4 failed | 70 passed (74)`，涵盖停滞候选/非改进残差/缺失能力反复提问、跨账本部分扣减及 Worker 取消超时。
- **停滞拦截与原子取消落盘**：新增 `reliabilityDiagnostics.ts`（强制 `provenUnsat: false` 与 `createRepairStagnationTracker`）；`budget.ts` 实现 `consumeAll` 并对齐 `modelPlanner.ts`、`examRequestBudget.ts`、`examRunCoordinated.ts`；`coordinator.ts` 接入缺失能力及残差停滞立即终止；`geometryWorkerClient.ts` / `geometryCompileStrategy.ts` 接入 `AbortSignal` 与迟到消息丢弃。
- **验证**：定向 4 文件 76 项与 `examRunCoordinated.test.ts` 15 项通过；最终编辑后全量 Vitest **537 文件 / 5695 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建（639 modules）与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T12有界修复证据](audit/2026-11-16-p4-bounded-repair/README.md)。

## 2026-11-16 —— P4 / T10 折叠状态谱系、对称分支见证与耦合折角顺序约束

- **RED 复现**：扩充 `foldHinges.test.ts`、`planCompiler.foldBranches.test.ts` 与 `planCompiler.coupledFolds.test.ts`，覆盖铰链重合/漂移/边长突变/`dp_identity_conflation`、正负双分支与 `120°`/`60°` 内二面角/面面锐角隔离、逆序缺依赖点与 `> 3` 折越界拒绝；实现前 RED `3 failed | 5 failed | 11 passed (16)`。
- **状态谱系与多分支求解落盘**：`rotation3d.ts` 新增 `rotatePointAboutHinge` 与 `foldBranchesForTargetDistance`；`foldSystem.ts` 新增 `classifyFoldSystemResult`；`solidGoalMeasurements.ts` 新增 `verifyTargetAngleContract`；`foldHinges.ts` 新增 `validateFoldLineageStep` / `buildFoldLineage`；`coupledFolds.ts` 在保留 `solvePlanFoldSystem` 下新增 `solveCoupledFoldSequence` 追踪序贯谱系与多分支候选解 `candidateSolutions`（`complete: false`）。
- **验证**：定向 5 文件 26 项与全量 Vitest **536 文件 / 5689 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T10折叠谱系证据](audit/2026-11-16-p4-fold-lineage/README.md)。

## 2026-11-16 —— P4 / T09 参数化立体构造、拓扑拒收与开放曲面隔离

- **RED 复现与拓扑缺口验证**：扩充 `solid-builders.test.ts`、`prism.test.ts`、`pyramid.test.ts` 并新建 `solidDrawingContracts.test.ts`，实现前 RED `4 files failed | 9 failed | 46 passed (55)`。
- **内核开放曲面隔离与参数化求解落盘**：`solid-builders.ts` 导出 `signedPolyhedronVolume` 与 `buildOpenSurface`；`prism.ts`、`pyramid.ts`、`tetrahedron.ts` 分别补齐直/斜棱柱参数构造、已知垂足正交构造与未知垂足不默认中心、四面体镜像正负分支；`witnessSearch.ts` 接入 `validateAuxiliaryHosts` 拦截缺失顶点宿主；`compilePlan` 实测确认损坏拓扑不生成已通过草稿。
- **验证**：定向 4 文件 55 项与全量 Vitest **536 文件 / 5684 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T09立体作图证据](audit/2026-11-16-p4-solid-drawing/README.md)。

## 2026-11-16 —— P4 / T08 函数符号导数、定义域保留与竖直宿主动态依赖

- **RED 复现与漏洞拦截**：在 `function-evidence.test.ts` 扩展 5 项并新建 `functionDrawing.test.ts`（4 项），实现前 RED `2 failed | 8 failed | 20 passed (28)`，覆盖 `1/(x-0.37)` 奇数步长极点、`x/x`/`sqrt(-1)` 域保留、`abs(x)` 不可导尖点、域变更失效与 `JT-P02` 10 次拖动重算。
- **精确符号求导与宿主重算修复**：`expression.ts` 落盘 `differentiateExpressionAst`、`evaluateFunctionWithDomain` 与 `evaluateSymbolicDerivative`（不化简 `x/x`、对 `abs` 显式报 `unsupported_derivative`）；`calculus.ts` / `function-evidence.ts` / `diagramVerification.ts` 强化极点断开、外点切线区间报告、尖点/未定义点切线拒收与 `invalidateEvidenceOnDomainChange`；`planar-constraints.ts` 新增 `verticalLineConstraint` 解耦 `mathDomain` 与 `displayRange`，实测 `JT-P02` `P(t)=(-1,t)` 经 10 次跨窗拖动稳定保持 `x=-1`、`M,N` 在曲线上及共线定点 `(-4,0)`。
- **验证**：定向 3 文件 98 项与全量 Vitest **535 文件 / 5674 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T08函数作图证据](audit/2026-11-16-p4-function-drawing/README.md)。

## 2026-11-16 —— P4 / T07 平面与圆锥曲线确定性构造与定义域裁剪相交

- **RED 复现与内核扩展**：扩充 `conic-line.test.ts` 并新建 `planarDrawing.test.ts` 复现 RED 缺失；在 `@draw/geometry-kernel` 落盘旋转/平移 `conicFoci`、`tangentLineToConicAt`、`fitOriginConicThroughPoints`、参数化直线定义域排除 `intersectParametricLineWithConic`（区分截面截断 `single` 与二重切根 `tangent`）及 `intersectPlanarLineAndConicExact`。
- **代数优先平面/圆锥求解器与诚实诊断**：新增 `packages/agent-core/src/solver/planarDrawing.ts` 覆盖 `GK-P01`、`GK-P08`、`JT-P03`、`JT-P06`（实测发现 `c=1 < b=2` 时 `PF₁⊥PF₂` 实数域无解，改为记录 `infeasibleConstraints` 而非伪造 `P`；同时验证 `c ≥ b` 可行正交构造）、`JT-P07`、`JT-P08`（含 `x ≠ 0` 排除与 `EC=2CF` 线性消元）及 `"示意图"` `free_choice` 披露，接通 `deterministicProblemRoute.ts`、`agentRunner.ts` 与 `reliabilityEval.eval.test.ts`（同时保障 1D 函数题留给 `T08`）。
- **验证**：`conic-line.test.ts` 16 项 + `planarDrawing.test.ts` 9 项通过，全量 Vitest **534 文件 / 5665 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T07平面作图证据](audit/2026-11-16-p4-planar-drawing/README.md)。

## 2026-11-16 —— P5 / T11 可版本化尺度感知数值策略与退化分类

- **RED 复现与大尺度实测漏洞**：新增 `numericRobustness.test.ts`，实现前 RED `4 failed | 1 passed (5)`，除新增版本化无量纲接口待落盘外，实测捕获 `conic-line.ts` 在 `scale = 1000` 时单位步长切线因 `2.5e-7 + 1 - 1` 精度丢失与固定 `rootScale` 下界 `1` 导致误判 `none` 的真实漏洞。
- **三层无量纲策略与内核修复**：`numeric.ts` 新增 `NUMERIC_POLICY_VERSION = "num-policy-v1"`、无量纲长度/法向平面距/垂直/平行残差、`NaN`/`Infinity`/零向量 `degenerate` 判定与跨阈值返回 `unknown` 的 `classifyUncertaintyInterval`；`exact-forms.ts` 导出 `EXACT_FORM_POLICY_VERSION`，`diagramVerification.ts` 同步导出 `DIAGRAM_NUMERIC_POLICY_VERSION`；`conic-line.ts` 引入 Neumaier 补偿求和、最近原点投影重参数化与 `conicCharacteristicScale`；`solid-builders.ts` 整体共面判断采用 `span * 1e-9`。
- **验证**：`pointOnConic` + `numericRobustness` + `conic-line` 3 文件 22 项通过，全量 Vitest **533 文件 / 5653 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P5 / T11数值稳健性证据](audit/2026-11-16-p5-numeric-robustness/README.md)。

## 2026-11-16 —— P3 / T06 必需对象清单与类型化构造意图 DAG

- **RED 复现与契约设计**：编写 `drawingIntent.test.ts`，覆盖 DAG 六类异常拦截、拓扑序与 `T12` 脏传播、`GK-S02` 缺 `E/F/P` 与孤立 `label`/隐藏辅助对象拦截、`JT-P06` 缺焦点 `F₁`/`F₂` 与 `compilePlan` `drawingIntentCheck` 端到端阻断（初始因模块未创建 RED 失败）。
- **无环构造 DAG 与物化审计**：新增 `packages/agent-core/src/drawingIntent.ts`，直接绑定 `ACTIONS` 能力表实现 `compileConstructionDag`、`deriveRequiredDrawingIntent`（复用 `parseObligationWithLegacy`/`parseShapeClause`/`readFoldTransformations`）、`auditMaterializedIntent` 与 `collectDependentSubgraph`，在 `deterministicProblemRoute.ts`、`solver/solverContracts.ts` 与 `planCompiler.ts`（显式 `drawingIntentCheck` 开关）接通，off-path 黄金基线保持零字节变化。
- **验证**：`drawingIntent.test.ts` + `planCompiler.offPath.golden.test.ts` 2 文件 18 项通过，全量 Vitest **532 文件 / 5648 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P3 / T06构造DAG证据](audit/2026-11-16-p3-drawing-intent-dag/README.md)。

## 2026-11-16 —— P3 / T05 稳定多实体绑定、同向向量比与忠实原文诊断

- **RED 复现与实测漏洞**：在 `diagramEntityBinding.test.ts` 与 `diagramSourceDiagnostics.test.ts` 构造 9 项契约并复现 7 项失败，实测暴露：`leftover` 把已识别圆方程替换为空格产出 `"若双曲线…与圆            相切"`、`JT-P08` 的 `"向量EC=2向量CF"` 被误读成固定长度 `EC=2`、`JT-P07` 省略 `/1` 与带标签 `"椭圆 C 上一点"` 漏匹配，以及多曲线并发/跨 scope 时缺少明确绑定拒绝码。
- **稳定绑定与同向向量解析**：`diagramVerification.ts`（`candidateConics`、`selectConicForObligation`）与 `planCompiler.ts` 实现按 `entityId` / 标签 / 作用域状态的稳定绑定，拒收重复候选（`binding_ambiguous`）、缺失实体（`entity_missing`）及跨问/跨状态混绑（`binding_scope_mismatch`），并兼容 `"双曲线C"` 标签归并与 `pointOnConic` 单条异族失败；`diagramObligations.ts` 新增 `resolveDirectedVectorRatios`（`splitPoint: true`）、放宽省略 `/1` 的标准圆锥方程并修补 `leftover` 原文诊断与 `reasonCode`。
- **验证**：`conicFromFocusEccentricity` / `pointOnConic` / `diagramEntityBinding` / `diagramSourceDiagnostics` / `diagramVerification` 5 文件 94 项通过，全量 Vitest **531 文件 / 5643 passed | 1 todo**、`typecheck`、`lint`（0 errors / 33 既有 warnings）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P3 / T05实体绑定与诊断证据](audit/2026-11-16-p3-entity-binding-diagnostics/README.md)。

## 2026-11-16 —— P2 / T04 表达式 AST、定义域保留与符号圆锥曲线契约

- **RED 复现与根因确认**：在 `latexNormalisation.chain.test.ts`、`symbolicConicContract.test.ts` 与 `obligationIR.test.ts` 构造 12 项失败契约，实测 RED `3 files failed | 12 failed | 28 passed (40)`，确认 `x^{4}-2x^{3}` 与 `\frac{x^{2}}{m^{2}}` 降级缺失、`expression.ts` 缺少预算与未化简定义域提取、`conic-parameters.ts` 缺少符号圆锥轴向/欠定/渐近线相切求解，以及 `GK-P01` / `GK-P08` 在 `ObligationIR` 中缺失域与符号信息。
- **LaTeX 迭代降级与有界 AST**：`latexNormalisation.ts` 在 `lowerMathGroupsTracked` 迭代处理 `^{n}` 并修正闭花括号区间映射；`expression.ts` 实现 `MAX_EXPRESSION_LENGTH=512` / `MAX_EXPRESSION_DEPTH=24`、Unicode 幂/隐式乘法（仍拒收 `foo(x)` 等未知函数）、`extractExpressionDomains`、`evaluateExpressionWithDomain`（不化简 `x/x`、`x=0` 除零报错）及 `parseRelationConstraint` / `evaluateRelationConstraint`。
- **一般化符号圆锥曲线与 IR/核验接通**：`conic-parameters.ts` 实现 `parseSymbolicConicEquation` 与 `solveSymbolicConicContract`，区分主轴/轴对调与欠定状态（绝不猜测 `a=2`），并通过一般二次相切方程、`conicResidualAt` 与切点回代完成独立校验；`diagramObligations.ts`、`claimEvidence.ts`、`obligationIR.ts` 与 `diagramVerification.ts` 接通 `parameterDomain` / `symbolicConic`（单问 off-path 黄金 JSON 零变化）；静态无 `eval` 源码检查置于 `drawingContracts.test.ts` 以维持 `@draw/agent-core` 纯 TS 无 Node 依赖。
- **验证**：定向 9 文件 252 项通过，全量 Vitest **529 文件 / 5634 passed | 1 todo**、`typecheck`、`lint`（0 errors / 33 既有 warnings）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P2 / T04符号圆锥曲线与AST证据](audit/2026-11-16-p2-symbolic-conic-ast/README.md)。

## 2026-11-16 —— P2 / T03 比例/位置语义分离与完整角等式链解析

- **RED 复现与领域纠偏确认**：在 `lengthEquality.test.ts`、`diagramObligations.test.ts` 与 `diagramVerification.test.ts` 补齐反例与纠错说明，实测 RED `3 files failed | 9 failed | 197 passed (206)`，确认裸 `DE=2EA` 仍误标 `splitPoint: true`、`GK-S06` 仅读右端 `∠ADC=60°` 而残留 `"∠ADB="`、`∠ADB=∠ADC` 与显式弧度 `(0, π)` 缺解析。
- **比例与位置彻底解耦**：`lengthEquality.ts`（`relationsOf`）与 `diagramObligations.ts`（倍数比读取器及删除末尾 `sizedSegments` `splitPoint` 补丁）将所有解析产生的 `segmentRatio` 统一为 `splitPoint: false`；`diagramVerification.ts` 收紧为仅当显式传入 `item.splitPoint === true` 时核验共线分段，并补齐 `E在DA线段内` / `E在线段DA内` 为明确 `pointOnSegment`（保持 `"E 在 AB 上"` 歧义不猜边界）。
- **完整角链与单一边界转度**：新增 `packages/agent-core/src/relationChains.ts`（`parseAngleChains`、`STATED_VERTEX_ANGLE`），先于句型匹配消费角等式链，将 `∠ADB=∠ADC=60°` 拆为两条带完整 `sourceSpan` 与 `chainIndex` 的 `planarAngle`、新增 `equalAngle` 支持无数值等角链并打通 `claimEvidence.ts` / `obligationIR.ts` / `diagramVerification.ts`（抽出单一 `planarAngleDegrees` 计算边界），严格拒绝截断右侧（`∠ADB=`）、长度=角度（`∠ADB=AB` / `AB=∠ADC=60°` / `AB=60°`）、缺失单位与度/弧度混用。
- **验证**：`relationChains.test.ts`（3 passed）、`lengthEquality.test.ts`（27 passed）、`diagramObligations.test.ts`（109 passed）、`diagramVerification.test.ts`（70 passed）、`obligationIR.test.ts`（14 passed）、`planCompiler.offPath.golden.test.ts`（13 passed）合计 6 文件 236 项通过；全量 Vitest **528 文件 / 5620 passed | 1 todo**、`typecheck`（0 errors）、`lint`（0 errors / 32 既有 warning）、Web 构建（636 modules）、`eval:reliability -- --offline`（3 passed）全部通过。证据见[P2 / T03关系语义与角链证据](audit/2026-11-16-p2-relation-chains/README.md)。

## 2026-11-16 —— P1 / T02 ProblemContract、来源映射、作用域隔离与无损 ObligationIR

- **RED 复现与安全缺口定位**：建立 `problemContract.test.ts` 与 `obligationIR.test.ts` / `promptNormalization.test.ts` RED 用例，实测确认 `toLegacyObligationSet(parsed.ir).parts` 丢失返回 `undefined`、`selectedPart: 2` 选问隔离未打通（遗漏 `AD⊥DC`）、`NormalisationApplication.sourceMap` 缺失，并覆盖第 (1) 问前提漏检与 `"任取一点P"` 未识别等边缘场景。
- **单一 `ProblemContract` 与 UTF-16 来源映射**：在 `latexNormalisation.ts` 新增 `normalizeGeometryPromptWithSourceMap` / `mapNormalizedRangeToOriginal` 并让 `normalizeGeometryPrompt` 同源复用；在 `promptNormalization.ts` 输出 `NormalisationApplication.sourceMap`（`mapEditedRangeToOriginal`），并拒绝将待求目标混入前提、降级自由点或篡改小问编号的改写。新增 `packages/agent-core/src/problemContract.ts`（`buildProblemContract`、`resolveEntityBinding`、`recordModelProposal`、`isContractStale`），统一 `A1` ↔ `A₁` 规范别名归并、折前 `D@s0` / 折后 `P@s1` 与同显示名跨 state 歧义检测（未指定 `stateId` 返回 `ambiguous`），显式阻断模型自选参数（如 `a=2`）升级为原题给定前提，并在改题或缺来源旧合同时显式失效/阻断证书。
- **`R01-B` 选问隔离与 `ObligationIR` 无损往返**：扩展 `numberedProblem.ts`、`diagramObligations.ts`、`claimEvidence.ts`、`obligationIR.ts` 与 `planCompiler.ts`，保留 `shared` / `subquestion:N` 作用域与 `selectedPart` / `selectedScopeId` 选问隔离（仅 `shared` 在多问含前提题面下显式标 `partial`），实现 `toLegacyObligationSet(ir).parts` 无损往返且单问路径维持 R6 / off-path 黄金 JSON 零变化。
- **验证**：`problemContract.test.ts`（7 passed）、`obligationIR.test.ts`（14 passed）、`promptNormalization.test.ts`（23 passed）、`planCompiler.subquestionCoverage.test.ts`（9 passed）、`planCompiler.offPath.golden.test.ts`（13 passed）全部通过；全量 Vitest **527 文件 / 5611 passed | 1 todo**、`typecheck`（0 errors）、`lint`（0 errors / 32 既有 warning）、Web 构建（635 modules）、`eval:reliability -- --offline`（3 passed）与 `test:docs` 通过。证据见[P1 / T02契约证据](audit/2026-11-16-p1-problem-contract/README.md)。

## 2026-11-16 —— P0 / T01 36 题黄金作图契约冻结与统一评测口径

- **RED 复现与黄金契约冻结**：依据 [`manifest.json`](audit/2026-11-15-drawing-baseline/manifest.json) 生成 `test-fixtures/reliability/drawing-contracts-36.json`（固定 `denominator = 36`），逐字匹配原文与 UTF-8 SHA-256 `inputHash`/`sourceHash`，并为每条必需义务绑定精确原文下标 `sourceSpan`。显式修正基线 `JT-P08` 仅点在椭圆而未校 `C - E = 2(F - C)` 的判据缺口，同时为 `GK-S05 (2)` 与 `JT-P06 (2)` 标注不可行分支与诚实披露要求，独立审阅状态如实标为 `pending_second_reviewer`。
- **契约校验器与统一报告接入**：新增 `scripts/reliability-eval/drawingContracts.ts` 与 `scripts/reliability-eval/drawingContracts.test.ts`（先因缺少实现模块与声明 RED，后 GREEN 8/8 通过），验证篡改题干拒收、缩分母 `< 36` 拒收、`GK-S02` 缺 `E/F/P` 失败、`JT-P08` 假反例捕获、`JT-P06` 伪造拒收与诚实披露通过、`incomplete` 不缩分母以及基线保存档案 `25/36` 草稿、`4/36` 旧 host、`null` 完整证书与 `8/36` 局部 exact 重建；更新 `scripts/reliability-eval/runner.mjs`（新增 `runner.d.mts` 与 `scripts/nodeTypes.d.ts` `node:crypto` 声明）与 `reliabilityEval.eval.test.ts`，输出 `reliability-summary.v2`（含固定分母、`objectCoverage`、`obligationCoverage`、失败分桶、`requests`、`tokens`、`costUsd: null`、`costKnown: false`）。
- **验证**：`drawingContracts.test.ts` + `finalOutcome.test.ts` 12 passed；`eval:reliability -- --offline`（`dev-smoke` 3 passed）、`eval:reliability -- --replay`（3 passed）、`eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`（3 passed，`denominator=36, ran=36, passed=1 (GK-S01), partial=2, failed=33, incomplete=0, requests=36, liveWrites=0, costKnown=false`）；`typecheck`、`lint`（0 errors / 32 既有 warning）、Web 构建（634 modules）与全量 Vitest **526 文件 / 5600 passed | 1 todo** 通过。证据见[P0 / T01契约与口径证据](audit/2026-11-16-p0-drawing-contracts/README.md)；第二位独立审阅者复核待补。

## 2026-11-16 —— R11 干净依赖、公告处置与 Rust 审计缺口（G2 闭环）

- **基线公告与工具核查**：确认 `--omit=dev` 为 0 漏洞，全量存在 14 个受影响包（3 High / 11 Moderate）；宿主机 `npm.cmd ls vitest` 因混合 `.pnpm` 安装与 `package-lock.json` `vitest@4.1.11` 漂移而报错；`cargo audit --version` 返回 `no such command: audit`，显式按 `unknown` 记录 RustSec 工具缺失。
- **最小兼容更新与例外台账**：在 `.worktrees/r00-node22`（Node `v22.23.5` + npm `11.16.0`）执行兼容升级并提高 `package.json` 下限至 `eslint@^10.15.0`、`typescript-eslint@^8.72.2`、`vite@^7.3.8`、`vitest@^4.1.12`，同步解决 `source-map-js@1.2.2` 与 `zod@4.6.7`。修复后清零全部 3 项 High 及可修 Moderate，仅余 `@typescript-eslint/typescript-estree@8.72.2 -> minimatch@10.2.6`（`GHSA-g3hv-75wg-m249`，Moderate），已建立适用性/缓解/责任人/2026-12-31 到期台账。新增 `scripts/ci/dependencyLockPolicy.test.ts` 先对旧锁文件复现 RED，同步后转 GREEN。
- **隔离 Node 22 全量实测**：修复 `draftStorage.test.ts` 与 `useDraftPersistence.test.tsx` 在 Node 22 jsdom 下的 `Storage.prototype` spy 兼容性并在 Node 22 / Node 26 双环境通过；隔离 `npm ci`、`npm ls --depth=0`、类型检查、Lint（0 errors / 16 warnings）、Web 构建（634 modules）、`eval:reliability -- --offline`、`eval:explicit-solid -- --offline`、`licences:scan`（550 crates）、全量 Vitest、全量 Rust（317 passed / 4 ignored）与全量串行 Playwright E2E（286 passed / 14.0m）全部通过。证据见[R11干净依赖与审计记录](audit/2026-11-15-clean-dependencies-and-audit/README.md)。

## 2026-11-16 —— R09-B Schema 与运行时叶子约束同源及明确降级清单

- **RED 基线实测失败 8 项**：运行 `schemas.test.ts` 与 `modelPlanner.test.ts` 确认 7 项运行时叶子漏检（ASCII/Unicode/零宽空白 `actionKey` 被接受、`normalisations` 未知字段放行）与 1 项真实 `buildPlanToolSchema` 差分对照不一致（发布的 `actionKey` / `factIds` 缺少长度与非空白约束）。
- **单源叶子契约与差分验证**：在 `schemaReaders.ts` 新增 `LEAF_CONSTRAINTS`、`stringLeafJsonSchema`、`stringArrayJsonSchema`、`readStringLeaf` 及覆盖零宽占位符的 `trimUnicodeBlank` / `isBlankText`；在 `actionSchemas.ts` 收敛动作字符串叶子并新增 `planActionToolItemSchema`，消除 `modelPlanner.ts` 内 `buildPlanToolSchema` 手写分支；在 `schemas.ts` 将 `actionKey` 与 `normalisations`（含 `rejectUnknownFields`、边缘去白与全空白拒收）接回同一叶子约束；新增 `PROVIDER_SCHEMA_UNSUPPORTED_KEYWORDS` 与 `degradeJsonSchemaForProvider` 明确宣布远端关键字退化边界及运行时兜底责任。不额外安装 `ajv`，直接使用 `validateJsonSchemaSubset` 覆盖真实 `buildPlanToolSchema` 输出。
- **验证**：定向 `schemas.test.ts`、`actionSchemas.test.ts`、`actionFieldParity.test.ts`、`modelPlanner.test.ts` 4 文件 / 169 passed；`eval:reliability -- --offline` 3 passed；`typecheck`、`lint`（0 errors / 32 既有警告）、Web 构建（634 modules）与全量 Vitest **524 文件 / 5590 passed | 1 todo** 全部通过。证据见[R09-B Schema与运行时同源记录](audit/2026-11-15-schema-runtime-leaf-consistency/README.md)。

## 2026-11-16 —— R08 E2E 与生产 UI / 合同重新对齐

- 对基线 E2E 失败与全量串行重跑逐项分类，区分生产缺陷、设计契约迁移与过期定位器，不跳过用例也不开启静默重试：
  - **生产外接球/直三棱柱路线修复**：`parametricSolidPlan.ts` 保留 `外接球` / `内切球` 派生动作，`planCompiler.ts` 在 `compilePlanOnce` 补充 `derivedCircumsphereAssumptions` 内核计算披露（`parametricSolidPlan.test.ts`、`planCompiler.test.ts` 114 passed 与 `agentRuntime.test.ts` 90 passed 验证）；新增 `rightPrismPlan.ts` `tryBuildRightPrismMidpointsPlan` 并在 `deterministicProblemRoute.ts` 接入，沿用分问剥离模式而不放宽 R01-A `diagramObligations` 守卫（`problem-image-reader.spec.ts` 2/2 通过）。
  - **真实 UI 叠放缺陷修复**：发现存在 `AI 草稿预览` 横幅（`z-index: 50`）时，`.clean-chrome`（`z-index: 20`）内的 `工具菜单` 被拦截遮挡，提升 `.clean-chrome` 至 `z-index: 100`。
  - **共享页面对象与契约对齐**：新建 `e2e/pages/MathCanvasPage.ts`，统一 `模型服务 → 高级 → 实验性功能`、`AppChrome` 工具栏/菜单与顶栏 `保存 .mgeo` 入口；对齐 `310px` 桌面检查器宽度契约、`LineBasicMaterial` 网格契约与空白背景拖转视角，更新 `agent-derived-sphere.spec.ts` 按真实顶点标签拖转 `P`。记录 `WorkspaceTabs.tsx` 为 legacy-compat（仅保留给 `WorkspaceTabs.test.tsx`）。
- 验证：全量串行 `npx playwright test --workers=1 --retries=0` 达 **286 passed / 0 failed (13.4m)**；默认 16-worker 并发 `npm.cmd run test:e2e` 达 **282 passed / 4 failed (4.2m)**（4 项均为高并发下 5s/30s 超时）；完整 Vitest 524 文件 / 5580 通过 + 1 todo；类型检查、Lint（0 errors / 32 既有警告）与 Web 构建（634 modules）通过。证据见[R08 E2E 与 UI 对齐记录](audit/2026-11-15-e2e-ui-contract-alignment/README.md)。

## 2026-11-16 —— R07 函数相关义务统一绑定与题图结构化复核

- 先补全 R07-A 与 R07-B RED 用例并复现6项预期失败：存在辅助曲线时 `functionLineIntersections` 返回 `unverified`、`g(x)` 未进入 `functionGraph` 解析且切线未核验曲线归属；根式/LaTeX分式/不确定坐标被 `addCoordinateReview` 跳过，且 `AB∥CD` / `AB与CD相交于E` / `AB和CD是两条棱` / 伪造 `kind:"label"` 直接通过黑名单进入确定性事实。
- R07-A 在 `diagramObligations.ts` 与 `diagramVerification.ts` 支持 `[fgh](x)` 函数定义与带函数名切线句子，扩展 `statedCurveNames` / `selectStatedCurve` 至 `functionGraph`、`functionLineIntersections` 与 `tangentAt`（按 `sourceId` 匹配绑定曲线，拒绝跨曲线切线与重名/多候选猜测），并在 `commonTangent` 校验配对图元 `id` 一致性。
- R07-B 在 `problemImageReader.ts`、`problemImageReview.ts`、`problemImagePrompt.ts`、`ProblemImageComposer.tsx` 与 `agentRunner.ts` 实现基于内容分类的结构白名单、`addCoordinateReview` 形态与数值语法解耦、`computeReadingRevision` 与摘要/来源证明绑定、重复观察 ID 阻断、改字清空旧确认及 `splitImagePrompt` / `agentRunner` 装配层二次拦截。
- 定向与组件回归 6 文件 / 152 项全部通过；完整 Vitest 524 文件 / 5577 通过 + 1 todo；类型、Lint 与 Web 构建通过。既有用例 `e2e/problem-image-reader.spec.ts` 在第 1 条确认题图 UI 复核交接正常，随后因既有 `PRISM` 未选定 `(2)` 小问被 R01-A 阻断，留交 R08 统一对齐 E2E 合同。证据见[R07曲线绑定与题图复核记录](audit/2026-11-15-image-review-and-curve-binding/README.md)。

## 2026-11-16 —— R06 草稿写保护与 CSV 文本安全（G1 闭环）

- 以等号/加号/减号/@ 与前导空白/制表换行触发电子表格公式注入及 `:unreadable` 备份写入异常/静默篡改丢草稿为RED。
- 在 `exporters.ts` 导出 `csvCell`，对不可信字符串命中 `/^[\s\u00a0]*[=+\-@]/` 或 `/^[\t\r\n]/` 的单元加单引号 `'` 前缀，同时保持负数数值（如 `-2`）和布尔值原样导出；无损工程仍通过 JSON `save` 通道保留。
- 在 `draftStorage.ts` 新增 `loadDraftRecovery` 与 `discardDraft`：`:unreadable` 写入后必须经 `getItem` 回读内容一致才删除主草稿键，否则返回 `backup_failed_readonly` 并完整保留损坏主键；在 `useDraftPersistence.ts` 以 `protectedDraftsRef` 仅锁定只读受保护工作区的自动保存，不影响健康工作区，并在 `App.tsx` `.footer-note` 提供原始损坏草稿下载与需 `window.confirm` 二次确认的放弃解锁按钮。
- 定向 `exporters.test.ts` 19项、`draftStorage.test.ts` 13项、`useDraftPersistence.test.tsx` 17项（共49项）全部通过；完整Vitest 522文件/5570通过+1todo；类型、Lint（0 errors，32既有警告）、Web构建（634 modules）通过。证据见[R06草稿与CSV记录](audit/2026-11-15-draft-and-csv-protection/README.md)。

## 2026-11-16 —— R05 归档资源边界与安全解码

- 以低限额和CRC观察者证明预扫描先于分配：重复名、共享offset、重叠记录、字段不一致与聚合超限均在CRC前拒绝；本地头偏移修正未放宽判据。
- 原包、聚合、单条、条数和附件分别设限；实际文件读取采用 `max+1`，manifest附件在blob读取前拒绝，base64在输出分配前检查形状与预算，前端在 `FileReader` 前检查大小。
- 项目包41项、前端20项通过；完整Rust 317项通过+4ignored；Vitest 522文件/5562通过+1todo；类型、Lint、Web构建通过。未运行大包或外部恶意输入。证据见[R05归档资源记录](audit/2026-11-15-archive-resource-limits/README.md)。

## 2026-11-15 —— R04 原生导出授权与原子写入

- 删除任意路径 `write_to_file`，导出IPC只接受 `fileName`，原生固定应用数据 `exports` 根目录。严格文件名拒绝穿越、UNC、设备名、ADS、点段和错误后缀。
- 随机 `create_new` 临时文件、`sync_all` 与同目录 `hard_link` 不覆盖提交保证旧目标字节不变；失败仅清理本次临时文件。Windows `mklink /J` 实测拒绝junction导出根，目标外无文件。
- 前端只记文件名，完整路径仅用于结果展示；服务与面板共18项通过，项目包33项及junction精确用例通过。
- 完整Rust 310项通过+4ignored；Vitest 522文件/5560通过+1todo；类型、Lint、Web构建通过。证据见[R04导出授权记录](audit/2026-11-15-export-authorization/README.md)。

## 2026-11-15 —— R03 URL/DNS与有界响应

- 以IPv6、映射私网、CGNAT、local/LAN越界和跨端口重定向为RED，使用 `reqwest::Url` 和统一IP分类替换手写host解析；local仅允许回环，重定向比较包含有效端口。
- 非2xx响应不再 `response.text()` 完整缓冲：Content-Length预检、chunked扩展前累计字节检查、4096字节硬上限与取消感知流式读取；短UTF-8诊断保持兼容。
- `ProviderRequest` 携带networkPolicy，resolver全部候选通过后才由 `resolve_to_addrs` 固定连接；混合候选拒绝、local公共候选拒绝，合法域名只解析一次且Host不变。未使用外部DNS或真实provider。
- 验证：R03定向7/7，受影响Rust 155项通过+1ignored；完整Rust 307项通过+4ignored；Vitest 522文件/5560通过+1todo；类型、Lint、Web构建通过。证据见[R03网络安全记录](audit/2026-11-15-network-security/README.md)。

## 2026-11-15 —— G1/G2启动与R02凭据安全

用户确认新goal：依次完成G1（R02–R06）与G2（R07、R08、R09-B、R11），不进入P0–P8、R12、付费provider或发布。

- R02先以跨profile、跨endpoint和旧三段补偿为RED，确认原生存储与发送均存在旁路。实现profile归属校验、规范化endpoint绑定、Rust版本化密钥槽及无明文恢复记录；无可信绑定的旧凭据必须重新输入，不能自动跟随手改host。
- 原生事务以fake store和临时目录覆盖成功轮换、CAS、secret写失败、profile写失败、提交前/后崩溃及清理重试；旧upsert走同一事务，legacy写删不能绕过。前端改为单命令，启动时自动恢复。
- 验证：受影响TS 3文件56项通过；定向Rust 104项通过+1ignored；完整Rust 297项通过+4ignored；类型检查通过；完整Vitest 522文件/5560通过+1todo、0失败；Lint 0错误/32条既有警告。未读取真实凭据、未调用外部provider。证据见[R02凭据安全记录](audit/2026-11-15-provider-credential-safety/README.md)。

## 2026-11-15 —— R00、R01-A、R09-A与R10首批实施

用户重新设置目标，只完成 R00、R01-A、R09-A、R10 后停止。先在 `feature/drawing-reliability-execution` 提交并推送文档基线 `3856263f` 与隔离 worktree 忽略配置 `be3f00bf`。

- R00：在 `.worktrees/r00-node22` 使用 Node 22.23.5 / npm 11.16.0 真实执行 `npm ci`，类型检查通过，文档22项通过，完整 Vitest 519文件/5535通过+1todo、0失败。证据见[环境清单](audit/2026-11-15-review-remediation-baseline/environment.json)。首次 npm 路径错误发生在安装前，已记录并纠正，未隐瞒。
- R01-A：新增真实非法四棱锥 compile 负例，裸条件/设/且共6项RED后全部转GREEN；普通单问和若作对照。新增 runtime 集成测试，受控回退旧条件时复现 `awaiting_confirmation`，恢复修复后确认失败且不能提交，主场景零写入。
- 浏览器闭环：四种小问写法均无确认面板且主场景图元为零，普通单问确认提交成功，单 worker / retries=0 共5/5通过。证据见[小问阻断记录](audit/2026-11-15-subquestion-guard/README.md)。最终全量 Vitest 为 520文件/5544通过+1todo、0失败，类型检查通过。R01-A 已完成，下一步只做 R09-A 和 R10，不启动后续阶段。
- R00 与 R01-A 证据分别提交并推送。
- R09-A：新增 `finalOutcome` 按 run/stage/round/contentHash/终态选择唯一最终产物，删除 `rounds.some` 历史答案兜底。双轮正反例、取消、跨run、错误hash、重复身份均通过；离线可靠性3项通过。完整 Vitest 521文件/5548通过+1todo、0失败。证据见[最终产物记录](audit/2026-11-15-final-outcome/README.md)。提交 `addf4c79` 已推送。
- R10：CI顶层权限改为 `contents: read`，11处Action固定到经官方API核对的提交，4处checkout均禁用持久化凭据。静态守卫有效RED为1失败/11通过，GREEN为12/12通过；类型检查通过，完整 Vitest 522文件/5560通过+1todo、0失败。Lint为0错误/32条既有unused警告，其中16条来自隔离worktree；新增文件无警告。证据见[CI加固记录](audit/2026-11-15-ci-hardening/README.md)。本轮在此停止；feature分支未触发远端CI，不启动G1/G2或P0–P8。

## 2026-11-15 —— 59ea3613基线重置与全面修复设计（仅文档）

### 请求与交付

用户要求重置进度并制定尽力接近100%画图能力的全面修复方案。本轮只处理文档、设计和证据整理，不实施产品逻辑。

- 以59ea36133c47971f4252e71f7a0f5ba003dd1028 / v4.3.0为代码基线。
- 三份旧文档原字节归档并记录SHA-256；重写活动进度入口、过程日志和下一轮导航。
- 固化上一轮36题manifest、最终报告、局部oracle和逐题分诊JSON。没有新增模型调用，也没有把保存证据当作P0黄金合同已完成。
- 比较三条路线，推荐模型理解题意、确定性几何构造、独立验收；[设计](superpowers/specs/2026-11-15-drawing-reliability-design.md)及[实施计划](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)均待批准。
- P0–P8功能阶段全部重置为未开始；旧能力不删除，旧计划不覆盖，完整证书与端到端正确率不虚填。

### 证据边界

上一轮25/36草稿、4/36旧宿主/待确认、8/36局部exact并不互相等价；基线缺完整证书且没有真实UI/配图输入。详见[基线审计](audit/2026-11-15-drawing-baseline/README.md)。本轮未重建、未重跑功能/真题/浏览器/真实provider，未提交或推送；不能宣称成功率已提高。

### 本轮文档验证

- 文档一致性：npm.cmd run test:docs -- --testTimeout=30000，退出0，8个文件/22项通过、0失败。
- 归档完整性：三份原件SHA-256与重置前记录相同；与Git HEAD内容仅存在工作区CRLF/Git LF的换行差异。
- 证据副本：manifest、最终报告、局部oracle与各自现场源文件逐字节一致；三组清单及最终报告均覆盖同一36题，题文hash逐条校验。
- 活动文档本地链接、UTF-8/控制字符/阶段计数已自检；Git差异空白检查通过。详细机器记录见[文档核验记录](audit/2026-11-15-drawing-baseline/documentation-verification.json)。
- 归档正文是原件，不按迁移后的相对链接当活动导航；见归档README说明。

这些只验证文档及保存证据，不属于功能阶段完成证据；没有新的成功率成绩。

### 同日方案深化：从阶段路线细化到可执行任务

用户进一步要求完善、全面且能指出具体修改方向和参考建议的实施方案。本次增加[详细实施手册](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)：18个工作包、拟定接口、具体数学构造、RED案例/测试命令、验收与回滚、36题任务映射。

- 直接调用现有解析器完成8个只读探针；不涉及模型、UI或功能修复。确认角链截断、裸比例自动分点语义、IR分问迁移缺口等问题。
- 对GK-P08更正初步推断：圆方程已被读取，诊断空白来自残留遮蔽；不是用户漏题或原式丢失。
- 发现旧局部oracle的一项名称包含比例关系但实际只核点在曲线上，补入黄金合同/独立验收的审查任务；不修改旧成绩。
- 核对25处源码锚点与7份官方参考，明确仅借鉴思想/开发期对照/未来spike三档，不安装新依赖。
- 功能阶段状态不变；未构建、未跑36题新评测、未付费、未提交推送。
- 本次最终文档验证见[深化审计记录](audit/2026-11-15-drawing-implementation-audit/verification.json)。

### 同日：阅读新项目审查并重排下一步实施顺序

- 完整阅读[项目审查报告](audit/2026-11-15-project-review/README.md)，对照17个关键源码/工作流文件，不修改原审查。
- 新增[审查驱动下一步实施方案](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)：R00–R12工作包、G0–G4门禁，覆盖24项审查发现及额外lint警告。
- 把漏小问错误认证、最终轮次评测、原生安全/数据保护与CI信任边界前置；原六题/36题画图扩展仍保留，但不是第一步。
- 纠正活动状态中“E2E未跑”的过时表述：原审查已跑两轮完整E2E且均失败；报告动态结果不是本轮重新执行。
- 保持用户指定59ea3613，不自动同步上游。全部功能任务仍未开始；没有应用报告建议补丁、升级依赖、付费请求或发布。
- 本轮新鲜文档核验见[方案修订记录](audit/2026-11-15-review-plan-response/README.md)。

### 同日：全面总方案与main重启授权

- 用户明确要求全面方案、舍弃后续版本、从当前基线重新提交main。
- 已查询并fetch远端main=d8743a32，59ea3613之后47个旧提交完整保存在本地/远端archive/abandoned-post-59ea3613-20261115，精确清单见[main重启记录](audit/2026-11-15-main-restart/README.md)。这不删除历史，但明确不继承旧线代码/成绩/阶段状态。
- 新增[统一全面实施总方案](superpowers/plans/2026-11-15-main-restart-master-plan.md)，整合版本治理、审查止损、原生安全/数据保护、语义与几何构造、真实交互、评测/依赖/性能/安装发布，以及批次退出和安全回滚。
- 本次提交仅方案、审查、证据与窄范围Git原件换行规则；产品源码不改、付费评测不跑、产品不发布。新提交父节点和同步结果按实际Git回执核验。

### 同日：将已有总方案升级为唯一完整实施主计划

- 不再留下新的同类总方案；直接完善[实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)，增加31项[任务合同](superpowers/plans/2026-11-15-implementation-task-ledger.json)、无环依赖、文件/测试边界、接口/失效规则、阶段指标、提交审阅与安全回滚。
- 以真实compilePlan只读校对4个输入：裸条件/设/且仍错误passed，若为unverified警告；基准文档不变，无provider和提交。这是缺陷复现，不是修复通过。
- 首批计划给出合法顶点/面环和真实接口RED，以及最终接受输出选择的纯函数/双轮计分测试草案；生产runtime/E2E验收明确仍待实施。
- 修正依赖方向：T11数值合同先于新构造器，T18准备发布证据再交R12签收；R01与T02、R07与T05不重复记功。
- 重启main仍为be033b71，代码基线59ea3613；本次没有产品修改、付费、依赖升级、提交或推送。验证见[计划核验记录](audit/2026-11-15-implementation-plan-verification/README.md)。

### 同日：全部进度文档与历史边界对齐

- 只保留current-status.md作为实时状态来源；主计划是唯一执行入口，R/P/T/设计为技术合同附录，机器台账不另维护完成率。
- 活动能力目录、发布门禁和计分卡撤下旧Task 1–21/V0–V3的现行顺序声明，旧记录置于明确历史边界；修正题图强制复核/全题核验等可能夸大当前能力的描述。
- 历史计划、阶段进度和设计文档仅增补历史导航块，不改原正文、日期、勾选或测试数；原审查/评测/发行及归档原件完全不改。
- 统一59ea3613代码基线、be033b71重启提交、旧线47提交舍弃、31工作包与9阶段的区别；功能均未开始，发布仍阻断。
- 本次不改产品代码、不新增模型请求、不跑新功能/E2E、不提交推送；具体对齐范围、正文保真与文档测试见[进度对齐核验](audit/2026-11-15-progress-alignment/README.md)。

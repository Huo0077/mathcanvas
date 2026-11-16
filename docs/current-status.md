# MathCanvas 当前状态

最后更新：2026-11-16；产品版本：v4.3.0；产品代码基线：59ea36133c47971f4252e71f7a0f5ba003dd1028。

## 2026-11-15 —— 进度文档统一对齐（仅文档，产品禁止发布）

**本页是实时进度和发布状态的唯一来源；当前基线不具备发布条件。** 其他文档分别负责执行合同、能力说明、计分定义或历史证据，不重复维护“完成率”。

### 文档入口与唯一职责

- **执行主入口**：[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)。
- **机器执行合同**：[任务台账](superpowers/plans/2026-11-15-implementation-task-ledger.json)：13项R审查工作包+18项T画图工作包=31项；记录依赖/文件/测试/验收，不记录第二套实时进度。
- **技术附录**：[R审查修复](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)、[P0–P8阶段合同](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)、[T画图实施细节](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)、[架构设计](superpowers/specs/2026-11-15-drawing-reliability-design.md)。
- **能力/验收定义**：[功能目录](feature-catalog.md)、[发布门禁](acceptance/agent-release-gate.md)、[计分卡](acceptance/agent-tool-loop-scorecard.md)。旧Task/N/V/W记录不再决定本轮顺序或放行。

### 版本与已完成的非功能工作

| 项目 | 核对状态 |
| --- | --- |
| 代码基线 | 59ea3613，v4.3.0；本轮不迁回旧后续代码 |
| 重启提交 | be033b71，唯一父节点59ea3613；此前已核对同步远端。本次不重复推送、不声称重新查询了远端 |
| 舍弃旧线 | 59ea3613..d8743a32的47提交已保存在本地/远端archive/abandoned-post-59ea3613-20261115，不继承旧实现/成绩/进度；v4.4.0只作历史 |
| 已完成 | 原件归档、清理记录、审查阅读、方案/31任务合同与版本治理；均不等于产品修复 |
| 本次操作 | 仅对齐活动进度/能力合同/技术附录，给历史计划增加边界和导航；原审查、旧评测和发行证据不改 |
| 功能实施 | R00/R01-A/R09-A/R10、G1（R02–R06）及G2（R07、R08、R09-B、R11）已完成；`B4`（`P0–P6`：`T01–T14`）已有实现提交，但 **G3-Math 尚未退出**。用户已创建持续 goal，当前按[G3续作计划](superpowers/plans/2026-11-16-g3-completion-plan.md)先整改 T01 合同与生产验收，再依次完成 `B5`（`T15 → T16`）；产品仍禁止发布 |

版本治理详见[main重启记录](audit/2026-11-15-main-restart/README.md)。前一轮探针仅确认缺陷，不是修复GREEN。

### 2026-11-16 —— G3 实核与第二独立审题（否定性基线）

- 当前 HEAD `8c26544c` 的冻结36题实测为 **2 passed / 10 partial / 24 failed / 0 incomplete**，平均对象覆盖约 **28.0%**、义务覆盖约 **25.7%**；Vitest 驱动通过不等于题目通过。
- 第二独立 reviewer 完成36/36逐题复核，结论 **`changes_required`**：仅 `GK-P08` 的作图数学合同可批准，其余35题有 scope、谓词、拓扑、定义域/分支或数学正确性问题。T01/P0 **未通过复核，不能退出**。
- 证据：[G3实核基线与第二独立审题](audit/2026-11-16-g3-truth-baseline/README.md)。下一区块为合同及评测语义整改，然后才是生产完整证书接线；不得通过修改分母、删除反例或作者自签 reviewer 放行。
- **第一批合同安全整改已落地**：不可行伪造、GK-S01双scope、JT-S02目标/题设、真实球体/棱柱/正方体谓词、GK-P04/JT-P04数学错误及函数/直线实体绑定均有RED→GREEN；定向16项、全量540文件/5712通过+1todo，类型/Lint/Web构建通过。最新36题为 **1 passed / 10 partial / 25 failed**，义务覆盖约23.3%；下降来自补齐漏检，不回退判据。证据：[第一批合同安全整改](audit/2026-11-16-g3-contract-safety/README.md)。T01仍未批准，下一步继续关联义务、拓扑和统一scope入口。
- **第二批拓扑、宿主与平面关联整改已落地**：闭合/开放拓扑、共面、线段域、垂足第二方向、棱柱对应向量，以及GK-P01/P02、JT-P02/P07的点线/曲线关联均通过25项定向测试；全量540文件/5721通过+1todo，类型/Lint/Web构建通过。最新36题仍为1/10/25，义务覆盖约22.5%。证据：[第二批拓扑与宿主整改](audit/2026-11-16-g3-host-topology/README.md)。下一步处理JT-P08定义域/分支、其余合同及统一scope入口。
- **第三批定义域、分支与切线整改已落地**：JT-P08显式排除两点并逐支验证EF，JT-P09补圆上/弦/面积，函数切线用符号导数、圆锥切线用代数交点；定向29项、全量540文件/5725通过+1todo，类型/Lint/Web构建通过。最新36题为 **0 passed / 11 partial / 25 failed**，旧JT-P08因无排除点降为partial，不回退。证据：[第三批定义域与切线整改](audit/2026-11-16-g3-domain-tangent/README.md)。T01仍未批准。

- **第二轮独立复核与针对性整改已入档**：agent-0 复核36/36，仅 GK-P08、GK-S09、JT-S09、JT-P09 的作图数学合同可批准，32题需整改；T01仍未关闭。GK-P03最优直线、GK-P06三分支、JT-S04真实旋转夹具与JT-S09闭合拓扑已修正并加入反例，仍须下一轮独立复核。定向39项、全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过。最新36题为 **0 passed / 12 partial / 24 failed**，义务覆盖约22.38%，未路由和生产未接线仍导致24题失败。证据：[第二轮独立复核与整改](audit/2026-11-16-g3-contract-review-r2/README.md)。

- **scope 与实体绑定试点已整改**：JT-P05 显式继承前问 C，JT-P08 绑定实际 G 参数，JT-S01 两个子问继承 PC⊥AB 且 O 仅在 (1)(ii) 必需；函数切线拒绝零长度端点。跨问错曲线、错误轨迹、缺球/缺父条件均有 RED→GREEN。定向39项、全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过；最新离线仍为 **0 passed / 12 partial / 24 failed**，不代表生产提分。证据：[scope与实体绑定试点](audit/2026-11-16-g3-scope-entities/README.md)。其余合同推广、指定拓扑和折叠谱系仍未完成。

- **公共曲线与实体绑定已推广**：前问确定且后续共用的 C/E/Γ 按 `stem` 在每个 scope 实核，并绑定命名曲线；GK-P02 补 M≠N。跨问错曲线、匿名替身、不可行披露搭配错误 C、重合交点均有 RED→GREEN。全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过。离线仍为0/12/24，义务覆盖约22.24%。证据：[公共曲线整改](audit/2026-11-16-g3-shared-curves/README.md)。指定拓扑和折叠谱系仍未完成，T01不退出。

- **指定拓扑已完成14个合同**：四棱锥、三棱柱/四棱柱、四面体、立方体及JT-S04开放面均绑定 `expectedVertexIds/expectedFaceRings`，不再接受任意合法多面体替身。GK-S03四面体反例、错误绕向被拒绝，真实五面体与循环面环通过。GK-S09/JT-S09补稳定辅助点命名。最新离线 **0/11/25**，对象/义务覆盖约23.50%/20.39%，全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过。更严格检查使旧虚高读数下降。证据：[指定拓扑整改](audit/2026-11-16-g3-named-topology/README.md)。未提供题图与fold-transform仍未闭合。

- **DeepSeek 最小真实评测已连通**：用户重新输入并保存 API key 后，界面显示工具调用、严格 JSON、图像、流式验证通过。重跑题集 planning 得到 **1 planned / 2 clarification / 0 error**，平均延迟1832ms，成本 not measured；真实模型与澄清链可用，不等于36题或G3通过。证据：[DeepSeek重新授权与最小真实结果](audit/2026-11-16-g3-deepseek-provider/README.md)。未读取或记录密钥，未自动扩大为24/36次请求。

### 当前执行范围与区块结果

前期授权阶段 **R00 → R01-A → R09-A → R10**、**G1（R02–R06）** 与 **G2（R07、R08、R09-B、R11）** 已全部收口；`B4` 各实现工作包已有提交，但其退出证据须按 G3 实核重新闭环。当前按用户 goal 持续推进 **G3（先 G3-Math，再 B5/G3-UX）**，每完成一个区块核验测试、更新进度文档并推送至远端 `feature/drawing-reliability-execution`。

| 工作包 | 当前状态 | 证据 |
| --- | --- | --- |
| R00 同源环境 | **已完成** | [Node22环境证据](audit/2026-11-15-review-remediation-baseline/README.md)：真实 `npm ci`、类型检查、文档22项、Vitest 5535项通过+1todo；隔离 worktree 无源码/锁差异 |
| R01-A 小问止损 | **已完成** | [小问阻断证据](audit/2026-11-15-subquestion-guard/README.md)：compile/runtime负例转GREEN，浏览器4种写法均阻断且零图元，普通单问确认成功；完整Vitest 520文件/5544通过+1todo |
| R09-A 最终产物计分 | **已完成** | [最终产物证据](audit/2026-11-15-final-outcome/README.md)：旧答案不再兜底，双轮正反例与离线评测通过；完整Vitest 521文件/5548通过+1todo |
| R10 CI边界 | **已完成（静态验证）** | [CI加固证据](audit/2026-11-15-ci-hardening/README.md)：顶层只读权限、11处固定SHA、4处checkout不持久化凭据、静态守卫12项通过；未触发远端CI |
| G1 / R02 凭据安全 | **已完成** | [凭据安全证据](audit/2026-11-15-provider-credential-safety/README.md)：原生归属与endpoint绑定、版本化事务及崩溃恢复；完整Rust 297项通过+4ignored，Vitest 522文件/5560通过+1todo |
| G1 / R03 网络安全 | **已完成** | [网络安全证据](audit/2026-11-15-network-security/README.md)：URL/DNS候选验证与连接固定、错误体4KiB有界读取；完整Rust 307项通过+4ignored，Vitest 522文件/5560通过+1todo |
| G1 / R04 导出授权 | **已完成** | [导出授权证据](audit/2026-11-15-export-authorization/README.md)：受控exports根、严格文件名、原子不覆盖写入及Windows junction拒绝；完整Rust 310项通过+4ignored，Vitest 522文件/5560通过+1todo |
| G1 / R05 归档资源边界 | **已完成** | [归档资源证据](audit/2026-11-15-archive-resource-limits/README.md)：目录预扫描先于CRC、独立raw/聚合/附件预算、有界base64与读取；完整Rust 317项通过+4ignored，Vitest 522文件/5562通过+1todo |
| G1 / R06 草稿与CSV保护 | **已完成（G1闭环）** | [草稿与CSV证据](audit/2026-11-15-draft-and-csv-protection/README.md)：CSV公式字符加单引号防注入且保留数值负数/布尔语义；`:unreadable` 备份写入并回读失败时保留原草稿、阻断该工作区自动保存并提供下载/二次确认放弃恢复；定向49项通过，Vitest 522文件/5570通过+1todo，类型/Lint/Web构建通过 |
| G2 / R07 函数绑定与题图复核 | **已完成** | [曲线绑定与题图复核证据](audit/2026-11-15-image-review-and-curve-binding/README.md)：函数图像/交点/切线/公切线统一entity绑定与错绑拒收；题图关系/连线/根式与分式坐标/未知类别默认须人工确认且绑定revision防改字失效与伪造绕过；定向6文件/152项通过，Vitest 524文件/5577通过+1todo，类型/Lint/Web构建通过 |
| G2 / R08 E2E与生产UI/合同对齐 | **已完成** | [E2E与生产UI对齐证据](audit/2026-11-15-e2e-ui-contract-alignment/README.md)：修复参数化外接球动作/内核披露、`tryBuildRightPrismMidpointsPlan` 分问路由与 `.clean-chrome` `z-index: 100` 遮挡缺陷；新增 `MathCanvasPage` 并对齐 `310px`/网格/工作区Chrome/空状态契约；全量串行E2E 286 passed/0 failed（retries=0），16-worker并发282/286（4项为高并发5s/30s超时），Vitest 524文件/5580通过+1todo，类型/Lint/Web构建通过 |
| G2 / R09-B Schema与运行时叶子约束同源 | **已完成** | [Schema与运行时同源证据](audit/2026-11-15-schema-runtime-leaf-consistency/README.md)：建立 `LEAF_CONSTRAINTS` / `readStringLeaf` / `planActionToolItemSchema` 单源约束并导出 `PROVIDER_SCHEMA_UNSUPPORTED_KEYWORDS` 降级清单；修复 `actionKey` 全空白/零宽放行、`normalisations` 未知字段/超长/trim 漏检及 `buildPlanToolSchema` 漂移；RED 8 fail → 定向 4 文件/169 项通过，`eval:reliability -- --offline` 通过，Vitest 524 文件/5590 通过+1todo，类型/Lint/Web构建通过 |
| G2 / R11 干净依赖、公告与Rust审计 | **已完成（G2闭环；RustSec显式标为unknown）** | [干净依赖与审计证据](audit/2026-11-15-clean-dependencies-and-audit/README.md)：最小兼容升级修复全部3项High与可修Moderate公告（`vitest@4.1.12`、`vite@7.3.8`、`eslint@10.15.0`、`typescript-eslint@8.72.2`、`source-map-js@1.2.2`、`zod@4.6.7`）；`--omit=dev` 0公告；仅余 `@typescript-eslint/typescript-estree -> minimatch@10.2.6` 1条上游中危（`GHSA-g3hv-75wg-m249`，已登记例外与 `2026-12-31` 到期）；`cargo audit` 未安装标为 `unknown`；Node `v22.23.5` 隔离 `npm ci`、`npm ls --depth=0`、类型/Lint/Web构建/离线评测、`licences:scan`、全量Rust 317 passed（+4 ignored）及全量串行E2E 286 passed 全部通过；新增 `dependencyLockPolicy.test.ts` |
| B4 / P0 / T01 36题黄金契约与统一口径 | **合同整改中（第二轮独立复核未通过）** | 第二轮 reviewer 逐题复核36/36：GK-P08、GK-S09、JT-S09、JT-P09 的作图数学合同可批准，32题须整改；suite/case 保持 `pending_second_reviewer`。GK-P03最优直线、GK-P06三分支、JT-S04旋转夹具及JT-S09闭合拓扑已针对性修正但待复审。最新实测为 **0 passed/11 partial/25 failed/0 incomplete**，义务覆盖约20.39%；详见[第二轮独立复核与整改](audit/2026-11-16-g3-contract-review-r2/README.md)。T01/P0 不得退出 |
| B4 / P1 / T02 原文映射、分问作用域与无损IR | **已完成（R01-B选问收口）** | [P1 / T02契约证据](audit/2026-11-16-p1-problem-contract/README.md)：新增 `problemContract.ts`、`normalizeGeometryPromptWithSourceMap`、`NormalisationApplication.sourceMap`、`selectedPart`/`selectedScopeId` 选问隔离与 `toLegacyObligationSet.parts` 无损往返；实现 `A1`/`A₁` 别名归并与折前/折后跨 state 歧义检测、阻断模型自选参数（`a=2`）升级硬前提与改题失效检测；定向 5 文件 66 项通过（含 `planCompiler.offPath.golden.test.ts` 13 项），全量 Vitest 527 文件/5611 通过+1todo，类型/Lint/Web 构建（635 modules）/离线评测通过 |
| B4 / P2 / T03 比例位置分离与完整角链 | **已完成** | [P2 / T03关系语义与角链证据](audit/2026-11-16-p2-relation-chains/README.md)：取消 `DE=2EA` / `AB=2BC` 裸比例共线推断（`splitPoint: false`，`diagramVerification` 仅显式 `true` 检查分点），补齐 `E在DA线段内` 显式位置解析与非共线反例；新增 `relationChains.ts` 完整消费 `∠ADB=∠ADC=60°` / `∠ADB=∠ADC` (`equalAngle`) 与合法显式弧度一次转度、保留全链 `sourceSpan` 与 `chainIndex`、消除 `GK-S06` `"∠ADB="` 残留并拒绝截断/长度=角/度弧混用/非法角域；RED 9 项失败 → 定向 6 文件/236 项通过，全量 Vitest 528 文件/5620 通过+1todo，类型/Lint/Web 构建（636 modules）/离线评测通过 |
| B4 / P2 / T04 符号圆锥曲线与AST定义域 | **已完成（P2收口）** | [P2 / T04符号圆锥曲线与AST证据](audit/2026-11-16-p2-symbolic-conic-ast/README.md)：`latexNormalisation` 将带括号指数移入迭代降级环解决 `$x^{4}-2x^{3}$` 与 `\frac{x^{2}}{m^{2}}` 及 `sourceMap`；`expression.ts` 补齐长度/深度预算、`x/x` 未化简域保留与 `a>b>0` 链式不等式并维持零 `eval`（由 `drawingContracts.test.ts` 源码守卫锁定）；`conic-parameters.ts` 支持轴对调区分、欠定不猜与 `GK-P01`/`GK-P08` 一般求解+`conicResidualAt`/切点独立核验；打通 `parameterDomain`/`symbolicConic` 与 `ObligationIR` 无损往返；RED 12 fail → 全量 Vitest 529 文件/5634 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P3 / T05 多实体绑定与忠实诊断 | **已完成** | [P3 / T05实体绑定与诊断证据](audit/2026-11-16-p3-entity-binding-diagnostics/README.md)：用 `candidateConics`/`selectConicForObligation` 取代单曲线猜测，接入 `entityBindings`/`entityScopes` 隔离（`binding_ambiguous`/`entity_missing`/`binding_scope_mismatch`），兼容 `x²/4+y²=1` 与 `JT-P03`/`JT-P07`；新增 `resolveDirectedVectorRatios` 修复 `JT-P08` `向量EC=2向量CF` 误读与漏检；修复 `leftover` 空白遮蔽并输出 `unrecognizedSpans`/`recognizedEntities`/`reasonCode`；RED 7 fail → 全量 Vitest 531 文件/5643 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P3 / T06 必需对象与类型化构造DAG | **已完成（P3收口）** | [P3 / T06构造DAG证据](audit/2026-11-16-p3-drawing-intent-dag/README.md)：新增 `drawingIntent.ts`（复用 `ACTIONS` 能力表实现 `compileConstructionDag`、`deriveRequiredDrawingIntent`、`auditMaterializedIntent` 与 `collectDependentSubgraph` 增量重算接口），静态阻断环依赖/错宿主类型/折前违规引用/孤立标签假物化/隐藏辅助对象及 `GK-S02` 缺 `E,F,P`、`JT-P06` 缺 `F₁,F₂`；接入 `deterministicProblemRoute.ts`、`solverContracts.ts` 与 `planCompiler.ts` (`drawingIntentCheck`)；RED → 18 定向与全量 Vitest 532 文件/5648 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / T11 尺度感知数值与退化策略 | **已完成** | [P5 / T11数值稳健性证据](audit/2026-11-16-p5-numeric-robustness/README.md)：在 `numeric.ts` 确立 `NUMERIC_POLICY_VERSION = "num-policy-v1"` 与三层无量纲残差/`unknown` 跨阈值判定，在 `exact-forms.ts` 导出 `EXACT_FORM_POLICY_VERSION`，在 `diagramVerification.ts` 导出 `DIAGRAM_NUMERIC_POLICY_VERSION`；修复 `conic-line.ts` 在 `scale = 1000` 切线误判 `none`（Neumaier 补偿求和 + 原点投影重参 + `conicCharacteristicScale`）及 `solid-builders.ts` 整体验证共面尺度 `span * 1e-9`；RED 4 fail → 全量 Vitest 533 文件/5653 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P4 / T07 平面与圆锥曲线确定性构造 | **已完成** | [P4 / T07平面作图证据](audit/2026-11-16-p4-planar-drawing/README.md)：内核新增旋转/平移 `conicFoci`、`tangentLineToConicAt`、`fitOriginConicThroughPoints`、参数化直线定义域筛选 `intersectParametricLineWithConic`（区分 `single` 与 `tangent`）及 `intersectPlanarLineAndConicExact`；`agent-core` 新增 `planarDrawing.ts` 覆盖 `GK-P01`/`GK-P08`/`JT-P03`/`JT-P06`（含 `b > c` 时 `PF₁⊥PF₂` 诚实诊断无解及 `c ≥ b` 正交构建）/`JT-P07`/`JT-P08`（`x≠0` 与 `EC=2CF`）及 `"示意图"` `free_choice` 披露并接入 `deterministicProblemRoute`、`agentRunner` 与 `reliabilityEval`；RED → `conic-line` 16 + `planarDrawing` 9 通过，全量 Vitest 534 文件/5665 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P4 / T08 函数、符号导数与竖直宿主依赖 | **已完成** | [P4 / T08函数作图证据](audit/2026-11-16-p4-function-drawing/README.md)：`expression.ts` 新增精确符号求导 `differentiateExpressionAst` / `evaluateSymbolicDerivative` 与 `evaluateFunctionWithDomain`（`abs` 明确报 `unsupported_derivative`、不取消 `x/x`）；`calculus.ts` / `function-evidence.ts` / `diagramVerification.ts` 加密间断探针、强制可导性与域核验（拒收 `abs(x)` 尖点伪水平切线并记录 `searchInterval` 及域变更 `stale` 失效）；`planar-constraints.ts` 新增 `verticalLineConstraint` 分离 `mathDomain` 与 `displayRange`（实测 `JT-P02` `P(t)=(-1,t)` 10 次跨窗拖动通过 `createReactiveGraph` 保持 `M, N` 与定点 `(-4,0)` 零漂移）；RED 8 fail → 定向 3 文件 98 通过，全量 Vitest 535 文件/5674 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P4 / T09 参数化立体构造与拓扑证据 | **已完成** | [P4 / T09立体作图证据](audit/2026-11-16-p4-solid-drawing/README.md)：`solid-builders.ts` 导出 `signedPolyhedronVolume` 并新增开放曲面构造校验 `buildOpenSurface`（与闭合流形校验严格分离），实测 `GK-S03` 正体积闭合五面体与 7 类拓扑损坏拒收；`prism.ts` 新增 `constructParameterizedPrism`（严分直棱柱/斜棱柱）；`pyramid.ts` 新增 `constructPyramidFromFoot` 与 `describePyramidApexDomain`（未知垂足不默认底面中心）；`tetrahedron.ts` 新增正/负镜像分支枚举与筛选 `constructTetrahedronBranches`；`witnessSearch.ts` 与 `solverContracts.ts` 接入 `validateAuxiliaryHosts` 拦截缺失顶点宿主；RED 9 fail → 定向 4 文件 55 通过，全量 Vitest 536 文件/5684 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P4 / T10 折叠状态谱系与分支见证 | **已完成** | [P4 / T10折叠谱系证据](audit/2026-11-16-p4-fold-lineage/README.md)：`rotation3d.ts` 新增 `rotatePointAboutHinge` 与 `foldBranchesForTargetDistance` 枚举正负对称分支；`foldSystem.ts` 新增 `classifyFoldSystemResult`（保持 `provenUnsat: false`）；`solidGoalMeasurements.ts` 新增 `verifyTargetAngleContract` 严分 `interior_dihedral` 与 `plane_acute_angle`；`foldHinges.ts` 新增 `validateFoldLineageStep` / `buildFoldLineage` 拦截零长铰链/漂移/边长变化与 `dp_identity_conflation`；`coupledFolds.ts` 在保留 `solvePlanFoldSystem` 下新增 `solveCoupledFoldSequence` 校验逆序 `invalid_order` 与 `>3` 折 `unsupported` 并导出多分支 `candidateSolutions`（`complete: false`）；RED 5 fail → 定向 5 文件 26 通过，全量 Vitest 536 文件/5689 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P4 / T12 有界局部修复与 Worker 取消 | **已完成** | [P4 / T12有界修复证据](audit/2026-11-16-p4-bounded-repair/README.md)：新增 `reliabilityDiagnostics.ts` 覆盖 10 类故障分类、`normalizeSolveOutcome`（强制 `provenUnsat: false`）与 `createRepairStagnationTracker`；`budget.ts` 新增 `consumeAll` 原子多账本扣减（同步接入 `modelPlanner`、`examRequestBudget`、`examRunCoordinated`）；`coordinator.ts` 接入停滞与 `capability_missing` 阻断；`geometryWorkerClient.ts` / `geometryCompileStrategy.ts` 接入 `AbortSignal` 取消并安全丢弃迟到回包；RED 4 fail → 定向 4 文件 76 + `examRunCoordinated` 15 通过，全量 Vitest 537 文件/5695 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P4 / T13 完整数学证书与变异拒绝 | **已完成** | [P4 / T13数学证书证据](audit/2026-11-16-p4-math-certificate/README.md)：新增 `drawingCertificate.ts` 区分作图请求与闲聊（同步 `acceptance.ts` `isDrawingPrompt`）、实现 `evaluateMathGate` 与 `certifyDrawingAgainstContract`（基于最终图元坐标独立重算、忽略自报证据、严分 `passed`/`partial`/`blocked` 与 `"未完整核验"` 开关）；`completionGate.ts` 拦截重复检查 ID、`diagramVerification.ts` 扫描非有限坐标 `NaN`/`Infinity`；新建 `drawingCertificate.test.ts` 与 `drawingMutation.test.ts` 覆验 36 题合同结构与 8 类变异拒收+辅助点不变性（RED 2 failed → 定向 3 文件 16 通过），全量 Vitest 539 文件/5701 通过+1todo，类型/Lint/Web 构建/离线评测通过 |
| B4 / P4 / T14 最终候选绑定与原子确认 | **实现工作包已完成（G3-Math未退出）** | [P4 / T14原子提交与保鲜证据](audit/2026-11-16-p4-atomic-commit-staleness/README.md)：`drawingCertificate.ts` 新增 `verifyCertificateFreshness`（覆盖题文/scope/会话/基线修订/策略版本过期）；`renderEvidence.ts` 新增 `cameraHash` 与 `camera_changed`（`mathStale: false, visualStale: true, requiresReplan: false`）；`committerAdapter.ts`、`agentRuntime.ts`、`agentRunner.ts` 与 `draftStore.ts` 落地双击仅一次写入（`committedOnce` / `committedDraftIds` / `already_committed`）与 `promptHash` 保鲜检查；新建 `drawingCertificateStaleness.test.ts` 并扩充 `committerAdapter.test.ts`（RED 4 failed → 定向 5 文件 103 通过），全量 Vitest 540 文件/5705 通过+1todo，类型/Lint/Web 构建/离线评测通过。上述为该工作包历史证据；G3须另满足36题完整数学/视觉/交互门禁 |
| 后续阶段范围 | **G3合同整改与验收进行中** | 当前先完成T01合同及评测语义整改，随后生产证书、平面/立体数学门禁，再进入 `B5`（`T15 → T16`）；`P8`、付费 provider 与发布均未开启 |

R00 留交的依赖公告已由 R11 逐项处置并记录 RustSec 工具缺口，仍不包含付费 provider、安装/冷机或发布验收。历史文档对齐与 G3 前四个合同区块均已推送并核对 upstream 0/0；本第二轮复核整改区块按同一规则提交、推送和核对，不把历史推送写成当前已推送。

### 1. 证据分层与发布阻断

#### 同日审查结果（保存证据，非本次文档对齐复测）

来源：[项目审查报告](audit/2026-11-15-project-review/README.md)。

| 项目 | 保存结果及限制 |
| --- | --- |
| C1数学错误放行 | 裸条件/设/且的后续小问可能被吞入目标，违反条件候选仍passed；R01-A必须前置阻断 |
| 原生与数据安全 | H1–H4及M3–M7等未修；凭据、网络、文件、资源和恢复负例须按R任务闭环 |
| 完整Playwright两轮 | 第一轮235 passed/46 failed；第二轮232 passed/49 failed；不是两份独立失败数相加 |
| 单worker定向 | 10 passed/3 failed；定位器、产品披露、宽度/网格契约和资源时序分开修 |
| 工程验证 | Vitest5535通过/1todo；类型、文档、构建通过；Rust串行280通过/4ignored；首次并发链接内存不足 |
| 依赖审计 | 当时npm14项（3 high/11 moderate），omit-dev为0；RustSec未验证。实施时重新审计 |
| 未覆盖 | 新付费模型、安装/冷机、破坏性大包/DNS PoC等未做，不能以历史证据填新通过 |

完整E2E已经运行但未通过，不能继续概括为“未跑”，也不能用单测全绿抵销发布阻断。审查报告中的“落后47提交”是重启前历史状态，不是当前main分叉结论。

#### 36题真实作图基线（原JSON冻结，不重新计分）

| 指标 | 保存结果 |
| --- | --- |
| 样本/路由 | 36/36；平面18、立体18；35 native+1 local |
| 草稿 | 25/36（69.4%）；平面17/18、立体8/18 |
| 旧host通过/待确认 | 均4/36（11.1%），不是完整正确率 |
| 完整证书 | 该版不存在，null/not_available_in_revision；不能写0% |
| 局部oracle exact | 8/36，只覆盖部分条件 |
| 失败阶段 | compiling 11、validating 21 |
| 正式请求/主场景写入 | 101/0；不是新付费授权或交互成功证据 |

详见[36题基线审计](audit/2026-11-15-drawing-baseline/README.md)。新计分必须绑定最终接受的候选并另用metricVersion；澄清/拒绝、公共底图、局部exact不当作整题成功。

#### 前轮计划校对（同样不是功能修复）

[8个解析探针](audit/2026-11-15-drawing-implementation-audit/README.md)与[4个compile只读探针](audit/2026-11-15-implementation-plan-verification/README.md)用于核对已知缺口：裸条件/设/且仍passed，若为unverified warning；无模型调用、无主场景提交。6个最终产物选择示例断言只验证计划内代码，不是生产接线通过。

### 2. 本轮阶段验收（0 件已解决、9 件待定；按 G3 实核重新判定）

P是画图能力验收阶段，R/T是实现工作包，G是跨任务门禁；不能相加为新的完成总数。R01-A/B、R09-A/B是任务切片，不把31项再拆成另一份重复计数。下表的“实现已有提交”只描述代码工作，不等于该阶段已达到退出门槛。

| 序号 | 阶段 | 状态 | 退出门槛摘要 |
| --- | --- | --- | --- |
| 1 | P0 基准与测量 | **整改中（第二独立复核未通过）** | 36题来源/hash/span结构已冻结；35题合同需修正，独立复核通过后才退出 |
| 2 | P1 来源与语义合同 | **实现已有提交，验收重开** | scope在独立合同中存在丢失/目标混入，须通过逐题scope反例 |
| 3 | P2 解析与归一化 | **实现已有提交，验收重开** | AST/角链等已有实现；GK-P04/JT-P04等数学语义与定义域须纠正 |
| 4 | P3 平面确定性构造 | **进行中** | 当前平面未达18/18对象与数学合同；逐题闭环并保留反例 |
| 5 | P4 立体与折叠构造 | **进行中** | 当前立体未达18/18；拓扑、宿主、state和分支证据须补齐 |
| 6 | P5 有界求解与修复 | **实现已有提交，验收重开** | 预算/取消已有实现；须验证统一生产入口的实际终态与有界修复 |
| 7 | P6 独立完整验收 | **进行中** | 证书函数已有实现但生产stage存在not_supported；36题完整覆盖与stale/错图拒绝未闭环 |
| 8 | P7 真实画布与交互 | 未开始 | G3-Math退出后执行T15/T16；真实渲染、桌面交互与人工签收不可互相替代 |
| 9 | P8 泛化与发布 | 未开始、未授权 | G1/G2前置，盲测/成本/安装/性能/安全回滚与人工批准 |

### 3. 下一步及授权边界

**当前按 G3 续作计划先整改 T01 合同及评测语义**：第二独立 reviewer 已给出 `changes_required`，须为 scope、不可行伪造、稳定实体绑定、拓扑、定义域/分支和显示策略建立RED反例并修正，复核通过后才进入生产完整证书接线、平面18题、立体/折叠18题与 `B5`（`T15 → T16`）。

全部实现须RED→GREEN、生产接线、反例/兼容与独立复核；安全补丁回退只能关闭入口，不能重新开放已知漏洞。历史版本和授权不自动继承。付费预算、依赖升级和产品发布不在本次范围内，不自动触发。

### 4. 记录和验证导航

- [下一轮导航](agent-next-round-progress.md)、[本轮过程日志](project-progress.md)。
- [本次文档对齐清单/核验](audit/2026-11-15-progress-alignment/README.md)：活动文件、历史导航边界、原件保真和本次新鲜文档测试。
- [历史原件](audit/2026-11-15-pre-reset/README.md)、[旧清理记录](audit/2026-11-15-project-cleanup/README.md)、[v4.3.0历史发布说明](release/v4.3.0.md)。

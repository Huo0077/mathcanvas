# MathCanvas 从59ea3613重启的完整实施主计划

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：唯一实施主入口和执行合同；实时进度仍以current-status.md为准。实时状态仅维护在[当前状态](../../current-status.md)；执行总顺序以[完整实施主计划](2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

日期：2026-11-15；产品代码基线：59ea36133c47971f4252e71f7a0f5ba003dd1028；版号v4.3.0。

**Goal / 目标**：从选定基线重建可信的作图交付能力，先消除错误认证和安全/数据丢失风险，再达到审核后的36题全链路通过，最后以独立未见题、成本及真实桌面证据控制发布。

**Architecture / 架构**：原题与确认题图形成可追溯合同；模型提出语义和构造意图，确定性几何内核生成候选，独立校验器核验最终场景；隔离草稿经用户确认原子提交。复用现有IR、solver、原生IPC、仓库和交互，不并行重建第二套引擎。

**Tech Stack / 技术栈**：现有TypeScript/React/Three.js、Vitest/Playwright、Tauri/Rust。外部CAS/SMT/新provider仅经需求证据与独立spike批准后考虑；不把加依赖、加重试作为默认修复。

**G3/T01 第二轮实核**：独立 reviewer 本轮仅批准4题的作图数学合同，32题仍需整改；T01/P0与G3-Math均未退出。GK-P03最优分支、GK-P06漏分支、JT-S04真实旋转夹具及JT-S09闭合拓扑已针对性修正，仍须复审。最新36题为0 passed/11 partial/25 failed；已完成[14个指定顶点/面环拓扑](../../audit/2026-11-16-g3-named-topology/README.md)，未提供题图不猜面环；已完成[scope与实体绑定试点](../../audit/2026-11-16-g3-scope-entities/README.md)，已完成[公共曲线stem与实体绑定推广](../../audit/2026-11-16-g3-shared-curves/README.md)，已完成[JT-S04跨状态折叠谱系](../../audit/2026-11-16-g3-fold-lineage/README.md)，已完成[切线端点与目标直线绑定](../../audit/2026-11-16-g3-tangent-endpoints/README.md)，已完成[函数表达式与公共切线参数域](../../audit/2026-11-16-g3-function-domains/README.md)：GK-P04/P09 全局多项式身份与 GK-P04(2) 的 `a≥−1` 均有反例，未重跑离线 reliability；已完成[结构化不可行诊断与代数证据](../../audit/2026-11-16-g3-infeasible-evidence/README.md)：JT-P01真实两交点、JT-P04共圆矛盾、JT-P06焦点点积恒正均绑定指定scope，错误关键词不再放行；后续关闭其余最值、完整棱向量和其他折叠，再进入生产完整证书、平面/立体门禁及B5。证据与未关闭项见[第二轮独立复核与整改](../../audit/2026-11-16-g3-contract-review-r2/README.md)，实时状态只维护在[当前状态](../../current-status.md)。

**状态**：此前main重启已提交为be033b71，父节点59ea3613。R00、R01-A、R09-A、R10、G1（R02–R06）与G2（R07、R08、R09-B、R11）已全部收口，`B4`（`P0–P6`：`T01–T14`）已全部完成：包含 `P0 / T01`（见[P0 / T01契约与口径证据](../../audit/2026-11-16-p0-drawing-contracts/README.md)，第二位独立审阅者复核标 `pending_second_reviewer`）、`P1 / T02`（见[P1 / T02契约证据](../../audit/2026-11-16-p1-problem-contract/README.md)）、`P2`（`T03` 见[P2 / T03关系语义与角链证据](../../audit/2026-11-16-p2-relation-chains/README.md)；`T04` 见[P2 / T04符号圆锥曲线与AST证据](../../audit/2026-11-16-p2-symbolic-conic-ast/README.md)）、`P3`（`T05` 见[P3 / T05实体绑定与诊断证据](../../audit/2026-11-16-p3-entity-binding-diagnostics/README.md)；`T06` 见[P3 / T06构造DAG证据](../../audit/2026-11-16-p3-drawing-intent-dag/README.md)）、`T11`（见[P5 / T11数值稳健性证据](../../audit/2026-11-16-p5-numeric-robustness/README.md)）、`T07`（见[P4 / T07平面作图证据](../../audit/2026-11-16-p4-planar-drawing/README.md)）、`T08`（见[P4 / T08函数作图证据](../../audit/2026-11-16-p4-function-drawing/README.md)）、`T09`（见[P4 / T09立体作图证据](../../audit/2026-11-16-p4-solid-drawing/README.md)）、`T10`（见[P4 / T10折叠谱系证据](../../audit/2026-11-16-p4-fold-lineage/README.md)）、`T12`（见[P4 / T12有界修复证据](../../audit/2026-11-16-p4-bounded-repair/README.md)）、`T13`（见[P4 / T13数学证书证据](../../audit/2026-11-16-p4-math-certificate/README.md)）与 `T14`（见[P4 / T14原子提交与保鲜证据](../../audit/2026-11-16-p4-atomic-commit-staleness/README.md)）。用户已创建持续 goal，按[G3续作计划](2026-11-16-g3-completion-plan.md)推进。首次36题实核仅为2 passed/10 partial/24 failed（历史基线），第二独立审题仅GK-P08作图数学合同可批准，其余35题须整改；因此B4工作包提交不等于G3-Math退出。[第一批合同安全整改](../../audit/2026-11-16-g3-contract-safety/README.md)、[第二批拓扑与宿主整改](../../audit/2026-11-16-g3-host-topology/README.md)与[第三批定义域与切线整改](../../audit/2026-11-16-g3-domain-tangent/README.md)已落地；当前继续其余关联义务、拓扑、统一scope/branch入口及生产支持，再完成生产证书、平面/立体数学门禁及`B5`（`T15 → T16`）；P8与正式发布未开启，feature分支未触发远端CI，仅用户明确授权的保存DeepSeek可进行真实评测，其他provider不开启，不正式发布；重新授权后最小真实评测为1 planned/2 clarification/0 error，调用链已连通但不等于G3通过，见[DeepSeek审计](../../audit/2026-11-16-g3-deepseek-provider/README.md)。实时状态只维护在[当前状态](../../current-status.md)。

## 0. 执行入口与唯一事实来源

本文件是**唯一实施主入口**：包含总体范围、执行顺序、31项任务合同、首批可直接落地的测试、跨模块接口、验收/停止/回滚与提交规则。R00–R12审查方案和T01–T18手册只作实现细节附录，不再建立另一套“下一步”。任务台账是本计划的机器可读合同，不另维护实时状态。

| 层级 | 文档 | 负责什么 |
| --- | --- | --- |
| 实时状态 | [当前状态](../../current-status.md) | 唯一阶段进度和发布阻断状态 |
| 版本治理 | [main重启决定](../../audit/2026-11-15-main-restart/README.md) | 舍弃旧线的精确范围、备份、lease和恢复纪律 |
| 审查整改 | [R00–R12下一步方案](2026-11-15-review-driven-next-implementation-plan.md) | 首先修哪些严重问题，具体文件、负例、安全回滚 |
| 画图分阶段 | [P0–P8计划](2026-11-15-drawing-reliability-repair-plan.md) | 各能力阶段的目标与退出合同 |
| 实现细节 | [T01–T18手册](2026-11-15-drawing-reliability-execution-handbook.md) | 接口、算法、源码位置、36题映射、红绿测试与回滚 |
| 设计与取舍 | [总体架构设计](../specs/2026-11-15-drawing-reliability-design.md) | 支持范围、数学/视觉/交互指标、路线比较 |
| 原审查证据 | [项目审查](../../audit/2026-11-15-project-review/README.md) | 保留原始发现、动态探针和测试结论，不改写为已修复 |
| 基线与诊断 | [36题证据](../../audit/2026-11-15-drawing-baseline/README.md)、[只读实现审计](../../audit/2026-11-15-drawing-implementation-audit/README.md) | 原题、局部oracle、失败阶段、源码锚点及勘误 |

R是审查修复工作包，P是画图能力阶段，T是阶段内工程任务，G是跨任务验收门槛；不是四套独立完成百分比。细节出现冲突时，以用户本次明确的基线舍弃决定为先，再按审查驱动顺序执行，并修正文档而不是任选有利版本。

## 1. 后续旧版本明确舍弃，从当前基线重新提交main

2026-11-15已实际核实旧远端main为d8743a32aaade8206c339acc030cc5712a11a1b7，59ea3613..d8743a32共47个旧提交。**这47个旧提交不属于新main开发线，不自动继承、不自动merge，不以旧W0–W11等完成记录抵扣新阶段。** 精确名单见[abandoned-history.json](../../audit/2026-11-15-main-restart/abandoned-history.json)。

本地/远端archive/abandoned-post-59ea3613-20261115已保留旧远端指针，旧标签/发行资产不删除；v4.4.0仅历史取证，不代表本轮当前产品。舍弃的是枚举旧线，不是所有日期晚于基线的未来新提交。

本次新提交应直接以59ea3613为唯一父节点，产品源码与配置不回迁旧线；方案、审查和最小证据作为新的启动提交。为了履行原件hash承诺，必要时仅为固定审计原件设置窄范围Git -text规则，避免core.autocrlf修改字节，不改全仓换行策略。

远端切换需先有备份，使用期望旧main=d8743a32的精确force-with-lease。遇到远端新提交/分支保护拒绝立即停止，不使用无条件force、不删除保护。推送成功后核实远端main=本地新HEAD。远端同步状态只能由实际Git结果证明，不在提交前写成已完成。

**重启不是重新发版，也不是宣布基线安全。** 审查的C1/H1–H4等仍需修复。Git重启的历史可恢复，不得据此让漏洞重新开放。

## 2. 目标、非目标及完整交付定义

### 2.1 四层目标

1. **真实性**：不遗漏条件、不把未支持/未核验标成通过；最终候选、scope和原文一一对应。
2. **可靠性**：固定36题按人工审核合同补齐必要对象、数学约束、真实显示与交互闭环；题文不全的原题保留分母，另建完整输入版本，不能删失败题凑100%。
3. **安全与数据保护**：凭据不越权转发、原生文件不越权写入、输入和网络资源有界、保存失败不丢唯一原文/旧凭据、取消后无写入。
4. **泛化与维护**：未见题按族分轮评测，失败可重放、成本可追踪、依赖和CI可复算、旧存档兼容且可安全回滚。

### 2.2 暂不做

不承诺任意自然语言输入100%；不将示意实例当全称证明；不在此轮扩展自动Lean整题证明；不为修成功率无界增加模型轮数；不放宽数学容差删断言；不以云端更强模型替代错误的题意/核验逻辑；不自动迁回旧线功能；不进行未授权付费、破坏性PoC或正式发布。

### 2.3 一道题何时算完整通过

~~~text
原文/核对题图版本冻结
AND 全部必要义务与对象有可追溯合同
AND 题设/小问/分支未混用，必要条件无unknown/unsupported
AND 最终候选独立数学/域/拓扑核验通过
AND 真实渲染的必要对象与标签可读
AND 用户确认、撤销、保存重载和相关约束拖动契约通过
AND 证据与当前题文/候选/版本一致
~~~

任一层不满足就不能完整通过。澄清、拒绝、只画公共图和部分正确独立统计；一个正确中间答案不能拯救最终错误输出。

## 3. 起点：只使用本基线证据

保存的36题基线：25/36有草稿、4/36旧宿主通过/待确认、8/36局部oracle exact，32题失败（编译11、核验21）；完整证书该版不存在。三种读数不互相替代，更不代表整题端到端正确率。未做新的模型请求。

同日项目审查另确认：后续小问裸条件/设/且可被丢弃并错误passed；凭据、任意导出路径和包聚合有高危风险；完整E2E两轮分别235/46、232/49，定向单worker10/3。单元、类型、构建通过不能抵销这些结论；本次仅引用保存的审查结果，没有重跑来虚填新成绩。

**起点不是生产稳定版**：报告指出的新问题先进入负例/门禁，再提升出图率。安全护栏可能先让旧通过率下降，这是纠正错误认证，不应通过删条件补回数字。

## 4. 全面工作流与模块边界

| 工作流 | 核心缺口 | 主要修改责任 | 任务合同 | 必交付证据 |
| --- | --- | --- | --- | --- |
| A 版本与环境 | 旧线混入、工具链/锁漂移 | main治理、隔离Node22/锁验证、CI | R00/R10/R11/T01 | revision/锁hash/真实安装/不可变Action与权限 |
| B 语义与来源 | 漏小问、比例擅自共线、角链、符号式 | numberedProblem/diagramObligations/obligationIR/normalisation | R01/T02–T05 | 原文映射、scope roundtrip、负例、契约覆盖 |
| C 图像与实体 | 观察未复核、辅助曲线错绑 | problemImageReview/Prompt、diagramVerification | R07/T05/T16 | 未确认事实不进入规划、实体ID一致核验 |
| D 确定性构造 | 缺焦点/辅助点、坏拓扑、折叠状态 | drawingIntent、现有solver和geometry-kernel | T06–T11 | DAG/参数/分支、独立回代、尺度/退化反例 |
| E 求解与调度 | 无进展重试、unknown当无解、迟到结果 | coordinator/budget/modelPlanner/runtime/worker | R03/R09/T12/T14 | 实耗账本、停滞/取消/最终候选绑定 |
| F 原生安全 | 凭据/endpoint、SSRF、导出、归档 | Rust commands/providers/proxy/repository/secrets | R02–R05 | fake store/transport、小包/临时目录安全负例 |
| G 数据保护 | 草稿/凭据回滚丢失、CSV | draftStorage/useDraftPersistence/exporters | R02/R06/T16 | 故障注入后原文/旧凭据仍可恢复 |
| H 独立验收 | 自评、空条件、历史轮次救过 | completionGate/diagramVerification/eval/certificate | R01/R09/T13/T17 | 完整覆盖、错图变异拒绝、metricVersion |
| I 用户交付 | 旧定位器、披露、遮挡、保存/拖动 | AppChrome/确认面板/render evidence/E2E | R08/T15/T16 | 当前可访问契约、同版画布/交互证据 |
| J 发布维护 | 依赖公告/性能/冷机缺口 | CI/锁、App加载、release gate | R11/R12/T18 | 干净CI、统计、安装、成本与安全回滚 |

**共享写范围纪律**：planCompiler、obligationIR、diagramVerification、agentRunner、原生provider profile与HTTP client是交叉点。先定合同，再单负责人整合，不让多个补丁各自定义scope、endpoint、budget或证书语义。按用户授权范围执行，不默认并行派生代理。

## 5. 实际推进批次和退出条件

### B0：新main治理（此前已完成，不是本轮功能进度）

- [x] 完整保护当前方案/审查/证据，列出新main提交清单。
- [x] 列出47个被舍弃旧提交，核对本地/远端备份指针。
- [x] 暂存后运行文档测试，检查新加入受跟踪文档不会破坏编码/唯一状态守卫。
- [x] 提交后核对唯一父节点=59ea3613、产品源码相对基线无改动。
- [x] 精确lease同步main并实际核对远端；保护规则或lease冲突时停止。

上述版本治理操作已于重启提交be033b71中执行并验证，清单仅保留当时操作合同，不要求再强推一次。以后功能修复均在该重启线正常追加提交；本段不计入R/P功能完成进度。

### B1：先不再错误认证或错误计分（G0 + CI边界）

R00快照 → R01-A漏小问护栏 → R09-A最终候选计分 → R10最小权限和Action固定。

**必须验证**：裸条件/设/且/若负例、PA=2但AD·DC=1候选不能passed/确认，sceneWrites=0；先对后错两轮评测fail；单问题/合法明确scope正例不回归。原生或评测未支持部分保持blocked，不拿语义warning当安全实现。

**依赖取舍**：C1止损不等36题全审或大IR重构。R01-B完整scope仍需后续实现；只加护栏不代表画图功能完成。

### B2：原生安全和唯一数据副本（G1）

R02凭据归属/endpoint/rekey及失败补偿 → R03 URL/DNS/响应有界 → R04原生导出授权 → R05包聚合/重叠/base64限制 → R06草稿和CSV。

**关键接口**：凭据由原生决定slot，版本化暂存/提交/清理，不在renderer备份密钥；连接固定经校验地址并保留TLS hostname；文件授权不等于前端路径校验；目录元数据预算先于CRC/clone；备份失败原稿写保护。

**验证边界**：使用注入resolver/transport、fake secret store、低限额小包、临时目录。不要实际发送凭据、访问恶意服务或分配256GiB来验收。

**退出**：每项高危负例和合法回归闭环；缺陷未修时相关入口保持关闭。不能恢复漏洞作为回滚，不以“只是dev”忽略可利用高危风险。

### B3：可相信的UI、输入与评测（G2）

R07题图观察确认和所有函数义务绑定 → R08生产UI/披露与E2E合同 → R09-B schema/runtime → R11干净依赖和审计。

**产品裁决**：建议默认属性栏310、网格淡出不作为当前承诺，但必须记录产品合同；内核外接球披露必须来自生产证据，不只改fixture。UI通过当前可访问入口操作，不写store绕过流程。

**退出**：失败分类清单闭环，单worker无重试验证逻辑，再固定正常并发重复全量；干净Node22环境实际安装与完整CI；npm/Rust审计重新查询并记录未解决项。报告14项公告不是永恒当前值，SHA/版本不盲目照抄。

### B4：题意与构造能力恢复（原P0–P6，G3数学部分）

T01审核36题/先六题切片 → T02完整scope/来源 → T03比例与角链；T11先在既有内核上建立数值合同。T04符号AST → T05实体绑定 → T06必需对象DAG → 采用T11接口的T07/T08平面函数、T09/T10立体折叠。T12有限修复、T13独立验收、T14生命周期在设计时同步定义，按台账DAG收口。

**六题切片**：GK-S06、GK-S03、GK-P01、GK-P08、JT-P02、JT-P06；不删其余30题或先宣称P0完成。T02不能只修IR漏parts而忽略R01源解析漏条件。

**退出**：平面18/18、立体18/18逐条完整数学/对象合同，反例拒绝；未知域/分支或条件缺失不得完整通过。实现必须按能力/语法组合，不按题号硬编码。

### B5：真实画布和可编辑交付（原P7，G3交互部分）

T15真正rendered证据和可读性 → T16确认/撤销/重做/保存重载/拖动与配图输入。相机变化只失效相关视觉证据，几何改动使数学证据失效；不能每次换视角都再问模型，也不能改了几何仍显示绿色。

**退出**：36题真实显示与最小生命周期逐题证据；四族复杂交互正反矩阵；数学/截图/候选/桌面构建同版。结构估计、浏览器mock不能冒充实际桌面或provider。

### B6：泛化、预算、性能与发布（原P8，G4）

T17独立未见题与R12/T18性能/发布/安全回滚。计划至少120独立审核未见题、每族至少30、3次运行，首轮≥95%、有界修复后≥99%为待冻结目标；整数门槛和每族门槛明确，每族30题达到99%意味着30/30。相关重复样本不当成独立题扩大置信度。

**独立授权**：模型、每题/整批请求、token/费用/时长/停止条件在真实运行前确认。只报告实耗或unknown，不把预留上界当实付、不把旧101次请求当新预算。

**发布条件**：全部审查阻断已闭环，干净CI/真实安装冷启动/旧存档兼容/性能与用户可读性通过，预算与安全回滚演练齐全，人工批准。文档提交到main不代表产品可以发布。

## 6. 验收证据如何组织

每个补丁按一个可独立审查责任提交，包含明确失败输入和最小正反例，避免“顺手大重构”。未来功能提交建议使用fix(scope)/test(scope)并在提交说明列R/T/审查ID；重启启动提交用docs/chore，不标feat已交付。

~~~text
输入证据：source hash / scope / 图像核对版本 / fixture版本
执行环境：Git revision + 未提交diff + lock hash + 工具版本
修复闭环：RED原因和退出码 → 最小修改 → GREEN → 反例与兼容
产品路径：真实生产入口装配，不只独立工具或fixture
候选证据：contract/candidate/baseRevision/validator/render版本
资源安全：请求/token/时长/内存上限与取消、副作用计数
人工审阅：条件/数学/安全/可读性，不以作者自评代替独立检查
残余风险：unknown、未做、待裁决、回滚/入口关闭方式
~~~

**存放规则**：可提交最小合同、汇总、脱敏反例、必要截图/trace索引；原始大日志和运行产物留在忽略目录；付费结果不可因清理删除唯一证据。密钥、认证头、用户私密图片/文档不提交。归档原件hash保持字节，活动文档只维护一份实时状态。

## 7. 全面回归矩阵

| 验证层 | 必查内容 | 何时运行 | 不能替代 |
| --- | --- | --- | --- |
| 文档/计划 | 链接、编号、映射、版本/来源、提交范围 | 每次文档/契约变更，含暂存新文件后 | 功能正确 |
| 单元/性质 | AST/source map、scope、域、拓扑、尺度变式、停滞 | 每个功能补丁 | 真provider/真实UI |
| 故障/安全 | 凭据/profile落盘、唯一草稿、网络/包/路径边界 | 每个原生/数据补丁 | 静态扫描“没发现密钥” |
| 集成 | 编译到确认、worker取消、最终候选oracle | 每个跨层合同修改 | 独立函数测试 |
| 浏览器 | 当前可访问UI、生产披露、真实显示/交互 | 定向后完整固定并发 | 组件fixture或只单worker通过 |
| Rust/桌面 | 原生IPC/包/密钥fake库、安装与冷启动 | 原生修改及候选发布 | no-bundle构建或浏览器mock |
| 评测 | 冻结36题、负例、变式、未见题首轮/修复后 | 对应能力集成后，真实请求另批 | 历史答案/最佳轮次/空分母 |
| 供应链 | 锁一致、当前公告、Action SHA/权限 | CI/依赖修改及发布前 | 旧审查时0生产公告 |

重负载Rust链接与完整E2E在当前单机串行。首次失败记录不能被成功重跑擦掉；默认不无限增加timeout/retry。完整功能通过率不因本轮只有文档测试而变化。

## 8. 风险、停止与回滚规则

| 风险 | 控制/停止条件 |
| --- | --- |
| 旧线混回main | 精确47提交清单、备份指针、直接父节点/祖先核验；出现旧tip祖先立即停止发布 |
| 远端main有未知新提交 | 精确lease拒绝即停止核对，不换成无条件force |
| 自动化安全回退变成漏洞恢复 | 关闭有问题入口，保留鉴权/限额/不覆盖；不回退任意路径或错误passed |
| 题设合同作者与核验同错 | 独立审阅黄金条件、第二算法/手工反例，不自报完整证书 |
| 发布/评测口径随结果变 | 先冻结题集/预算/判据/metricVersion；改题意走新版本、两份成绩都留 |
| 安全工程挤占全部画图推进 | C1/L2先小闭环；G1不同责任按小补丁推进；黄金合同可继续离线整理，不跳过安全发布门禁 |
| 数值问题被容差掩盖 | 量纲/尺度与接近边界负例；逐题放宽阈值拒绝合入 |
| 依赖重构导致环境丢失 | 独立锁文件变更与隔离验证，活动目录不直接npm ci清洗 |
| 目录重新膨胀 | 仅清理白名单可重建产物，保留当前可执行程序与唯一评测证据，不git clean -fdx |

## 9. 下一步最小可交付单元

**已完成的版本治理**：重启提交be033b71的唯一父节点为59ea3613；旧47提交已存入备份分支并从新main祖先链排除。此事实不是R00环境验收或任何功能任务完成。

**本次计划完善**：直接升级本主计划，补31项执行合同、无环依赖、起手RED代码、验收矩阵和证据格式；不新增另一套同类总方案，不修改产品源码，不自动再提交/推送。

**首批功能实施顺序（已按本次范围完成）**：

1. R00环境/源码/锁证据；
2. C1四类小问文本与错误候选真实compile RED；
3. R01-A最小fail-closed和runtime确认负例、单问正例；
4. R09-A先对后错两轮计分负例与最终候选选择；
5. R10 CI固定和最小权限；
6. 每项自审、验证、提交并推送；本轮在R10停止，不启动B2–B6。

该顺序旨在先保证“不会把错图当对图”，再争取“更多题能画对”。不设无依据工期，也不以任务勾选百分比代替可运行证据。

## 10. 单一任务台账：31项工作包，不另造阶段编号

[implementation-task-ledger.json](2026-11-15-implementation-task-ledger.json)给出每项**现有修改文件、拟新增文件、测试文件、输入合同、输出、RED清单、退出条件、回滚和建议提交主题**。31项=13项R+18项T，沿用已有编号，不是新增31项重复工作。

台账不记录滚动完成百分比；实际进度仍只更新current-status.md。R01即时护栏与T02完整scope共用实现，R07函数绑定与T05泛化绑定共用接口，T18准备发布证据、R12最终签收，不能把同一补丁算成两次能力提升。

| 任务 | 批次 | 责任角色（非已指派人员） | 规模 | 技术依赖 | 可独立审查的产物 |
| --- | --- | --- | --- | --- | --- |
| R00 | B1 | 维护者/验证 | 小 | GOVERNANCE | 同源环境与基线快照 |
| R01 | B1 | Agent核心/集成 | 中 | R00 | 未选问/漏条件候选不再完整通过；完整scope由T02收口 |
| R02 | B2 | 原生凭据/设置 | 大 | R00 | 凭据归属及可恢复rekey事务 |
| R03 | B2 | 原生网络 | 大 | R02 | 解析-连接一致和限长取消读取 |
| R04 | B2 | 原生仓库/导出UI | 中 | R00 | 有授权且原子不覆盖的导出 |
| R05 | B2 | 原生归档/附件 | 中 | R00 | 两阶段预扫与有界解码 |
| R06 | B2 | 持久化/数据保护 | 中 | R00 | CSV文本保护和备份失败写保护 |
| R07 | B3 | 语义/题图UI | 中 | R01 | 未确认观察不入事实，函数相关义务同一绑定 |
| R08 | B3 | UI/E2E | 大 | R00 | 当前UI Page Object、真实披露与可信E2E |
| R09 | B1+B3 | 评测/协议 | 中 | R00 | 最终输出评分及schema/runtime一致性 |
| R10 | B1 | CI/安全 | 小 | R00 | 最小权限及不可变Action引用 |
| R11 | B3 | 依赖/验证 | 中 | R10 | 兼容依赖修复与干净CI/审计 |
| R12 | B6 | 维护者/性能/发布 | 大 | R11、T18 | 性能/lint/安装及人工发布签收 |
| T01 | B4 | 题库/独立审题 | 大 | R09、R00 | 36份黄金合同与可回放逐题验收 |
| T02 | B4 | Agent语义/合同 | 大 | T01、R01 | 单一ProblemContract/source map/scope与兼容IR |
| T03 | B4 | 关系解析 | 中 | T02 | 比例/位置分离和完整角链 |
| T04 | B4 | 表达式/参数 | 大 | T02、T03 | 带域AST和同实体参数约束 |
| T05 | B4 | 实体绑定/诊断 | 中 | T02、T04、R07 | 全部曲线/辅助点绑定和原文诊断 |
| T06 | B4 | 构造编排 | 大 | T02、T05 | 经过类型/无环检查的构造意图DAG |
| T07 | B4 | 平面构造 | 大 | T04、T06、T11 | 平面交点/焦点/切线/弦及全部合法根 |
| T08 | B4 | 函数/动态几何 | 大 | T07、T11、R07 | 函数/切线/轨迹依赖 |
| T09 | B4 | 立体构造 | 大 | T06、T11 | 参数化实体、辅助点和拓扑证据 |
| T10 | B4 | 折叠求解 | 大 | T09、T11 | 合法折叠变换谱系与分支实例 |
| T11 | B4基础 | 数值核验 | 大 | T02、T03 | 统一可版本化数值策略与退化分类 |
| T12 | B4 | Agent调度/worker | 大 | T06、T07、T08、T09、T10、R03、R09 | 有界局部修复、停滞和取消终态 |
| T13 | B4 | 独立验收 | 大 | T01、T02、T05、T07、T08、T09、T10、T12 | 完整数学证书与变异拒绝 |
| T14 | B4 | 提交/生命周期 | 大 | T13、R01、R06 | 过期检测与原子一次确认 |
| T15 | B5 | 渲染/可读性 | 大 | T14、R08 | 真实可见性证据/布局 |
| T16 | B5 | 桌面/浏览器交互 | 大 | T15、R02、R04、R05、R06、R07 | 确认撤销/重载/拖动/配图闭环 |
| T17 | B6 | 独立评测/费用审核 | 大 | T16、R09、R11 | 分族分轮首轮/修复后成绩与不确定性 |
| T18 | B6 | 发布准备/兼容 | 大 | T17、R10、R11 | 发布包核对、灰度与安全回滚准备 |

**规模不是工期承诺**：小=单一责任/有限配置或测试；中=少量模块加兼容/故障路径；大=跨层或需要独立数学/安全/用户复核。每项先以一个最小可验收切片启动，首批实测后才估工期，不能按任务数量推算完成日期。

### 10.1 两种依赖必须分开

- **技术依赖**：台账dependsOn组成有向无环图，决定接口先后。GOVERNANCE是已完成的版本重启前提，不是产品验收。
- **发布/运行前提**：G0/G1/G2等是出口门禁，不强迫每项离线研究等待所有安全补丁完成，但未关闭风险时不允许开放相关入口、付费冲刺或发布。
- **T11数值合同先于新构造器**：T11依赖T02/T03和既有内核，不依赖T09/T10收口；新T07–T10采用它，避免“先造再定义精度”和循环依赖。
- **T18与R12不是互相等待**：T18提供候选包/兼容/灰度/回滚准备，R12在此后做性能、审查残余项和最终人工签收。
- **R09分两次小交付**：A最终计分在B1；B schema一致性在B3；整包不能因为A完成就全勾。R01先最低安全护栏，完整scope交T02，不永久把所有多问题拒绝当最终目标。
- 优先序是R00 → R01-A → R09-A → R10 → G1责任 → G2责任 → 六题/36题数学 → 真实交互 → 泛化/发布。台账topologicalOrder仅证明无环，不代替这个风险优先序。

### 10.2 文件写边界和共享接口责任

| 共享区 | 先定义的合同 | 整合责任 | 不允许的重叠修改 |
| --- | --- | --- | --- |
| numberedProblem/obligationIR/planCompiler | 源区间、scope、必要条件覆盖与blocked语义 | R01/T02统一核心负责人 | 多条路线各自拆小问、重复解析不同题设 |
| diagramVerification | entity/state绑定、数值策略、独立判据 | R07/T05/T11/T13按接口顺序 | 某一题族取第一曲线，另一族用ID，证书仍混用 |
| provider profile/secret/http client | profile owner、endpoint identity、rekey状态、解析后连接策略 | R02先定身份，R03接网络 | renderer绕开native、旧IPC直接写secret、校验URL与实际连接不同 |
| repository package/archive/附件 | 独立原包/聚合/单项/数量/附件预算和授权路径 | R04/R05小提交顺序合入 | 文件授权与限额只在UI，导出/导入复用错误常量 |
| runtime/draft/committer | accepted final artifact、候选hash、CAS/取消 | R09/T14单一装配 | evaluator从历史round找答案，UI却提交另一候选 |
| render/UI/E2E | 生产可访问入口和三级render证据 | R08先稳定契约，T15/T16再扩覆盖 | 只改fixture、直接写store冒充用户流程 |

共享文件出现冲突时先停实现对齐合同，再做小范围整合；不凭最新写入覆盖别人更改。本计划的模块分工不授权自动派生代理。

## 11. 每个任务都必须有的执行卡

该模板是执行时必填，不用模糊“适当处理边界”替代真实数据：

~~~text
ID与审查问题：
直接依赖与已验证commit：
负责人角色 / 独立审阅角色 / 用户需要裁决的事项：
修改现有文件 / 拟新增文件（不得把未创建文件写成已有）：
输入字段、来源与不变量 / 输出结构及调用方：
最小RED输入、预期状态、错误原因、原题来源：
RED命令、退出码、测试数量（0 tests不算通过）：
最小实现步骤与生产入口装配：
GREEN命令、正例/负例/兼容/故障注入：
类型/模块集成/UI/Rust范围与未跑项：
副作用：sceneWrites、文件变化、secret访问、请求/内存/耗时：
合同/候选/代码/锁文件/环境hash与原始日志：
独立审阅结论、剩余风险、入口关闭和安全回滚：
建议提交主题与实际commit（获得授权后填写）：
是否满足该任务出口 / 对应P阶段仍缺什么：
~~~

**每任务固定操作**：

- [ ] 阅读原审查对应节和台账文件范围，验证源码版本与测试接口没有漂移。
- [ ] 写最小RED，不引入修复；确认失败来自目标问题而非拼错API/fixture不合法。
- [ ] 只实现一个责任的修正；同步真正运行入口，不保留能绕过的新旧双入口。
- [ ] GREEN、负例、合法兼容和故障恢复都运行；完整套件只在相应集成阶段串行运行。
- [ ] 人工核对证据等级、影响范围、回滚是否重新开放漏洞。
- [ ] 符合出口才更新current-status并准备小提交；文档/代码写好但没跑不算完成。

所有建议命令和文件都属于未来实施步骤。本轮只有计划完善及只读探针，不将示例测试写入产品测试目录或开始修复。

## 12. 首批可直接落地的RED：真实接口和合法反例

### 12.1 R01：不要让非法fixture掩盖漏小问缺陷

拟新增文件：packages/agent-core/src/planCompiler.subquestionCoverage.test.ts。下列使用当前真实createEmptyDocument、PLAN_SCHEMA_VERSION和compilePlan接口；顶点/面环已经以只读编译确认合法。

~~~ts
import { createEmptyDocument } from "@draw/dsl";
import { describe, expect, it } from "vitest";
import { PLAN_SCHEMA_VERSION } from "./contracts";
import { compilePlan } from "./planCompiler";

const candidatePlan = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan", goal: "小问覆盖回归", factIds: [],
  actions: [{
    actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [],
    inputs: {
      alias: "pyramid", vertexNames: ["P", "A", "B", "C", "D"],
      vertices: [
        { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }
      ],
      faces: [[1,2,3,4], [0,2,1], [0,3,2], [0,4,3], [0,1,4]]
    }
  }]
};

describe("subquestion condition coverage", () => {
  it.each(["", "设", "且", "若"])("does not certify prefix %s", prefix => {
    const document = createEmptyDocument("geometry3d");
    const before = JSON.stringify(document);
    const prompt = "四棱锥P-ABCD中，PA=2。（1）证明AD∥平面PBC；（2）"
      + prefix + "AD⊥DC，求AD。";
    const result = compilePlan(candidatePlan, {
      document, prompt, conversationId: "scope-regression",
      documentGeneration: document.revision
    });
    // AD=(1,1,0), DC=(1,0,0), dot=1；这个图不满足第二问。
    expect(result.diagramVerification?.status).not.toBe("passed");
    expect(JSON.stringify(document)).toBe(before);
  });
});
~~~

**已校对的基线观察**：空前缀、设、且均ok=true/status=passed；若为ok=true/status=unverified并带warning。前三条RED应失败；若是防回归控制。不能为让测试绿而把所有输入都变null，需补普通PA=2单问题通过正例和明确选问后的合法候选正例。

**这还不是完整G0**：compile状态改为unverified不保证UI不能确认。必须把同一反例通过现有agentRuntime/diagramDraftStage测试装配，分别断言最终状态不为awaiting_confirmation、没有可提交草稿、主场景未写入；再用e2e确认实际按钮不出现/不可用。不能只断言result.ok=false，因为旧API可能合法返回编译成功但验收blocked，应检查实际认证和提交语义。

~~~powershell
npm.cmd exec -- vitest run packages/agent-core/src/planCompiler.subquestionCoverage.test.ts --testTimeout=30000
npm.cmd exec -- vitest run packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/obligationIR.test.ts apps/web/src/agent/diagramDraftStage.test.ts apps/web/src/agent/agentRuntime.test.ts --testTimeout=30000
npm.cmd exec -- playwright test e2e/agent-subquestion-guard.spec.ts --workers=1 --retries=0
~~~

新的E2E文件须先按R08当前生产入口创建；命令匹配到0用例不计成功。不要把本次只读探针说成上述未来测试已经GREEN。

### 12.2 R09：最终产物选择的最小合同

拟新增scripts/reliability-eval/finalOutcome.ts及finalOutcome.test.ts。下面是对runtime最终接受结果的**测试投影**，不直接替换现有Runtime类型；由真实coordinator/stage事实生成，不能由模型传入“我被接受了”。

~~~ts
export type Artifact = {
  runId: string; id: string; kind: "plan" | "answer";
  contentHash: string; text?: string;
};
export type AcceptedFinal = {
  runId: string;
  terminal: "completed" | "awaiting_confirmation" | "failed" | "cancelled" | "waiting";
  artifactId: string | null; contentHash: string | null;
};
export function selectFinalArtifact(
  artifacts: readonly Artifact[], final: AcceptedFinal
): Artifact | null {
  if (final.terminal !== "completed" && final.terminal !== "awaiting_confirmation") return null;
  if (final.artifactId === null || final.contentHash === null) return null;
  const expectedKind = final.terminal === "completed" ? "answer" : "plan";
  const hits = artifacts.filter(a => a.runId === final.runId
    && a.id === final.artifactId && a.contentHash === final.contentHash
    && a.kind === expectedKind);
  return hits.length === 1 ? hits[0]! : null;
}
~~~

此函数只做身份选择，**不证明内容正确**。后续答案匹配、独立oracle、数学覆盖必须全部作用于这一个最终对象；真实contentHash由规范内容计算，不能信任模型自报。明确唯一accepted id但已取消/跨run/重复记录也拒绝。

~~~ts
import { expect, it } from "vitest";
import { selectFinalArtifact } from "./finalOutcome";
it("a correct earlier answer cannot rescue an accepted wrong answer", () => {
  const artifacts = [
    { runId: "r", id: "a1", kind: "answer" as const, contentHash: "h1", text: "2" },
    { runId: "r", id: "a2", kind: "answer" as const, contentHash: "h2", text: "3" }
  ];
  const selected = selectFinalArtifact(artifacts, {
    runId: "r", terminal: "completed", artifactId: "a2", contentHash: "h2"
  });
  expect(selected?.text === "2").toBe(false);
  expect(selectFinalArtifact(artifacts, {
    runId: "r", terminal: "cancelled", artifactId: "a1", contentHash: "h1"
  })).toBeNull();
});
~~~

h1/h2只是选择测试的哑哈希；生产还要真实hash校验、accepted-stage装配及图元oracle一致性测试。实现不完整时选择null，旧round不兜底。

### 12.3 R02/R06：数据保护不只看返回错误

- profile更新失败：fake store初始有OLD secret；暂存NEW后注入profile写失败；断言旧profile版本/endpoint/OLD仍可借出、NEW孤儿被安全清理或登记；不只断言ok=false。
- 凭据提交后崩溃：重启恢复必须根据profile引用判定，不能以“临时文件存在”就删除当前有效secret；同时mock旧IPC直调用验证没有旁路。
- 草稿旁路备份失败：原key放非法但属于用户的JSON，模拟setItem失败，触发load→用户编辑→autosave→重载；原key的原始字节始终一致，提示不得包含“已备份”。
- 恢复备份写成功：断言副本可读后才允许删除/覆盖原key；下载取消、配额满、用户拒绝舍弃都保持写保护。

这些测试不使用真实凭据或私有用户文档；测试fake state和浏览器Storage注入采用现有测试工具，不额外建立不受控存储副本。

## 13. 跨模块输入输出的冻结要求

| 合同 | 必需字段/不变量 | 生产者 → 消费者 | 版本/失效 |
| --- | --- | --- | --- |
| Source/ProblemContract | sourceHash、原文UTF-16区间、scope/parent/selected、entity/state、角色、域、未解析片段 | 解析/核对 → 构造/验收 | 改题/改scope使下游失效，不把规范化offset冒充原文 |
| ConstructionIntent | outputEntityId、operator、依赖ID、宿主类型、state、来源；无环/唯一输出 | 合同 → 确定性route/compiler | 上游参数变化重算受影响图，全部义务重验 |
| SolverOutcome | verified_instance/unknown/not_supported/underdetermined/proven_unsat/cancelled；域/残差/分支完备性 | kernel/solver → coordinator/validator | not-found默认不是unsat；容差版本入证据 |
| NativeCredential | profile owner、expectedRevision、endpoint identity、事务阶段/slot引用 | native设置事务 → native HTTP transport | endpoint更换重新授权；无明文renderer/日志 |
| ResourceLimits | raw/aggregate/entry/count/attachment/error-body、时间/取消 | 原生策略 → 各实际读取/分配点 | 不是只检查header；测试用低限额覆盖拒绝前副作用 |
| AcceptedFinal | run/attempt/stage、artifact ID/hash、终态、实际接受状态 | runtime → evaluator/UI/committer | 取消/改题/换候选不使用旧artifact |
| Certificate | source/contract/candidate/scope/baseRevision/validator、coverage/residual、未检查项 | 独立validator → draft/confirm/UI | 数学/视觉分层失效；不允许模型签名代替 |
| RenderEvidence | structured/rendered/human级别、环境、候选hash、可见对象/标签、限制 | renderer/人工 → UI验收 | 相机/字号/DPI只撤相关视觉证据；几何变动撤数学 |

接口变更顺序：先契约测试与schema → 生产者 → 兼容适配 → 所有消费者 → 去除旧旁路。旧存档缺证据默认未完整核验，不自动生成绿色证书；兼容性不能成为恢复漏洞的理由。

## 14. 每阶段必须达到的可测量读数

| 指标 | 基线或定义 | 任务门槛 |
| --- | --- | --- |
| 错误完整放行 | C1已确认错误passed | R01及T13负例集中为0；不能通过全部拒绝获得可用性完成 |
| 条件覆盖率 | 人工审核必要义务作分母 | T01/T02/T13必需义务100%有来源和检查，unknown显式阻断 |
| 对象覆盖率 | 必需实体与状态作分母 | T06无缺点/缺焦点/缺折后对象假通过 |
| 旧草稿率/旧host | 25/36与4/36仅旧基线 | 不设伪造提升承诺；新结果用新metric/contract版本 |
| 完整数学/端到端 | 完整数学+真实显示+交互分别报告 | 目标36/36；如果题文不足保留原分母并另设完整输入版本 |
| 数据保护 | 唯一草稿/旧凭据/目标文件的字节或引用 | 故障注入后不丢失；未授权凭据转发/根外写入0 |
| 资源安全 | 实际读入/分配/请求，不只声明量 | 所有入口有界，超预算停止；用测试计数证明CRC/clone前拒绝 |
| E2E可信度 | testId首轮、retry、worker、环境和trace | 单worker及固定并发都报告；全量0未处置失败，不能只报重试后绿 |
| 泛化/稳定性 | ≥120独立未见题、每族≥30、≥3轮 | 待批准首轮≥95%、有限修复后≥99%；逐族整数门槛，相关重复不扩大n |
| 性能/时延 | 冷启动、首次画图、拖动、worker、内存 | 先测同版基线再冻结预算；不以构建包体小单项代表体验 |
| 成本 | 实际请求/token/金额或unknown | 运行前批准全批/单题上限，旧101次不是新授权 |

成功率、置信区间和样本独立性按原手册的统计边界执行。合法拒绝/澄清单列；额外记录有解题被错误拒绝的假阴性，不允许“全部拒绝=100%安全=任务完成”。

## 15. 检查清单、裁决和暂停条件

### 15.1 第一批开工清单

- [x] 确认当前HEAD在be033b71之后且舍弃47提交未混入；未提交修改只属于本轮授权范围。
- [x] 记录Node/npm/锁/TypeScript/Vitest/浏览器/Rust实际版本；环境隔离而非清空活动依赖。
- [x] 将第12节真实compile反例落为RED，确认不是模型/拓扑/测试语法失败。
- [x] 修R01-A至runtime/确认闭环，跑普通单问正例；再修R09-A身份选择及计分。
- [x] R10实际核对官方Action身份和权限并完成静态策略验证；不把历史SHA当当前推荐版本。feature分支未触发远端CI，真实runner回归未验证。
- [x] 整理每项代码/测试/副作用与自审证据，按授权逐块提交并推送；本轮完成R10后停止。

### 15.2 需要产品裁决但不必阻塞全部修复

| 决策 | 建议默认 | 未裁决时允许推进 |
| --- | --- | --- |
| 多问未选择 | partial底图可预览，完整确认关闭 | 解析/compile安全负例、单问回归 |
| 新导出路径 | 受控exports目录优先 | 原生路径/预算负例，不开放任意路径 |
| 属性栏/网格 | 默认310、旧淡出暂不承诺，明确规格 | 旧locator清理、实际披露、可读性正反例 |
| 欠定自由参数 | 明确free_choice并核验，非唯一答案 | 已确定参数的构造与域校验 |
| 依赖/CAS/SMT | 首批不新增，现有内核优先 | 失败机制/小型离线spike，未经批准不接生产 |
| 发布/付费 | 本轮不执行 | 离线、mock安全、契约和回放 |

### 15.3 必须暂停并回到诊断的情况

RED连续不能按预期复现、三个补丁仍依赖加特判、同一语义在新旧两条路径分叉、测试“过了”但生产没接线、需要删源条件/扩大容差才能过、真实请求可能越预算或数据不可逆覆盖。此时回到最小复现/合同裁决，不继续堆重试或绕过门禁。

审查关闭需实现证据而非计划覆盖。没有可用独立审阅者就标“待复核”，不能编造reviewer或把本助手的计划自查当成独立产品签收。

## 16. 本轮计划完善的交付边界

本地重启线HEAD为be033b71，本轮不自动再提交/推送或改写历史。31项任务已给出文件/测试/接口/依赖/验收/回滚合同；旧R/T文档为技术附录。产品实施状态仍全部未开始。

此前计划完善执行过文档/任务/路径/依赖校验和第12节只读compile探针；本次文档对齐不重新运行探针或产品测试。探针在eval-results/implementation-plan-check-20261115保留原始输出，另有最小审计副本；没有调用模型、写主场景、改产品代码或修复C1。前轮检查见[实施计划核验](../../audit/2026-11-15-implementation-plan-verification/README.md)。

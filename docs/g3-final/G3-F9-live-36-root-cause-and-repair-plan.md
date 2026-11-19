# G3-F9 真实 DeepSeek 36 题低通过率：根因研究与实施计划

> **2026-11-19 用户变更：本轮不测视觉，原题带图就跳过。** 当前实施目标是[独立纯文字36题规格](G3-F9-text-only-36-suite-spec.md)与[执行计划](G3-F9-text-only-36-implementation-plan.md)：旧23个 `text_only` 候选 + 13个待来源/独立审核的无图立体真题（高考8、联考5）。[规划清单](../../test-fixtures/reliability/text-only-36-plan.json) `runnable=false`，13槽位**不是已选题目**；新版36尚未建立也没有新版 DS 通过率。旧36题及旧91请求维持历史冻结证据。本计划下文 Block C 为历史视觉路线备查，非本轮执行内容，不因排除图题而清理已有视觉产品功能。


> **执行原则**：只用真实 DS 原生动作、真实候选截图、原生受控交付评估“真实作图能力”；零费单测/回放只用于防回归，不进入成功率。本文是执行合同，**不是修复完成声明**。每个区块 RED → 最小实现 → 验证 → 审查 → 更新进度 → 提交推送；新增付费请求必须单独获得明确授权。

**Goal**：让模型稳定、独立地把题意变成合法工具调用、几何实体、正确合同与可读画面，并在用户确认后交付同一候选；追求长期多轮稳定性，不许承诺未经验证的 100%。

**基线**：冻结源码 `aa17eb70d0bb98371e8300cd4294b794646b1f7b`，题集 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`；[36题原生逐题审计](../audit/2026-11-18-g3-f9-native-36-10x/README.md) 36题/91请求，每题≤10，1合同通过、26失败、9未测合同，仅1题独立证书和隔离浏览器同候选画面通过。全部36题的原生确认/主画布写入未测。实际账单金额未知；用量峰值价约 $0.1033731、逐请求预留保守累计 $0.5325891，均**不是账单**。冻结集13题引用原图却未附经核验的图像，所以不构成完整图文真题测试。历史版本/离线成绩不得并表。

## 1. 证据分层：什么已证实，什么不能断言

| 层级 | 已复现证据和路径 | 结论与限制 |
| --- | --- | --- |
| P0 多工具协议 | 8题同轮多动作（GK-P01 同轮3个 `declare_entity`）；`apps/web/src/agent/modelPlanner.ts:955-968` 先于 `:984-1080` 的 `ds_action` 执行闸拒绝；`g3DsCaseTrace.ts:316-329` 将缺逐动作回执记为 `telemetry_missing` | **已证实的运行器闸冲突**，不是“DS不能并行画图”；GK-P01 原错误 `runner_error`，同成因是依据工具序列和代码的推断，勿篡改原始记录。8题中7题终止码 `mixed_read_plan`。 |
| P0 多工具传输 | `apps/desktop/src-tauri/src/providers/request.rs:375-404` 把每个 `tool_call` 单独编码为 assistant 消息 | 如果仅放开前端闸，多个回执的历史可能不符合供应商要求的**同一 assistant 工具调用组 + 每个 ID 一条 tool 回复**；先做 adapter 组包 RED，不可直接放开。 |
| P1 参数协议 | `apps/web/src/agent/dsActionTools.ts:196-209` 除三项外仍给 `{type:object,additionalProperties:true}`；`:1182-1225` 宣称“equation or semi-axes”，但 `construct_conic` 主要消费 `conicType/radiusX/radiusY/focalParameter`，不解析通用方程 | 模型可见 schema 与实际参数不一致是**确定的接口缺陷**；12题首次 `missing_required_parameter`，但没有保存原始参数，不能断言这12题全因同一字段造成。分工具脱敏记录 `missingFieldCode` 后定责。 |
| P1 引用/状态 | 9题有中间图元，只有 GK-S09 完成 `finish_candidate`；GK-P02 部分构造后 `undeclared_entity_ref`；`dsActionTools.ts:1073-1115,1182-1245` | 数量上涨不等于题意满足。需要输出模型可读的命名实体表和可解析引用，避免丢失已构造实体；不把失败对象偷偷补造成“正确”。 |
| P1 过早澄清 | 17题首次 `needs_clarification`；13图题中12题澄清，23纯文字题中也有8题澄清；`dsActionTools.ts:1331` | 图题缺图应诚实澄清；纯文字澄清是否过早仍需逐题核查题意/必需条件，**不能直接禁止澄清让模型瞎猜**。 |
| P1 答案真实性 | `dsActionTools.ts:1285-1330` 的 `finish_candidate` 对特定符号棱柱/球自动塞入固定面积答案 | GK-S09 的合同/图像确实通过，但**不能单凭此案例宣称 DS 自主推导了答案**。图像与答案分别验收；考虑剥离硬编码、让独立内核计算并标注来源。 |
| P2 原图/多模态 | `modelClient.ts:20-27` 支持 `images?:string[]`，Rust `request.rs:394-407` 能打包 `image_url`；但 `modelPlanner.ts:542-553` 仅发送 `content` 文本，整题 runner 的 `confirmedFigureRefs` 未送图；本轮13题无原图 | 此批只能测文字代用品。后续先补来源可追溯的题图、校验视觉能力及区域引用；现有原生闸拒绝 images+tools 同请求，必须走独立视觉读取→人工核对→文本动作，两者合一需另行验证，不能伪造/凭典型示意图代替。 |
| P2 交付 | `g3DsFrozenCaseRunner.ts:606-614` 固定返回 `renderStatus/commitStatus=pending`；`agentRunner.ts:614,1012-1065` 有真实确认路径 | 当前 harness 不连接原生用户确认/写入计数，隔离浏览器导入不等于原生交付，端到端真实成功率**未证实**。 |

> **分母纪律**：36题都发起模型请求；只有1题完成合同并通过，不等于“35题几何判错”。26题合同 `failed` 是未完成/澄清后的合同结果，9题 `not_measured` 没有合同判定；批次/题图类别会重叠，不能累加为36。合同成功 `1/36` 与原生确认交付成功（未测）必须并列报告。

## 2. 官方资料和适用边界（核对日期 2026-11-18）

1. [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)：官方示例要求保存模型工具调用并按 `tool_call_id` 回填工具结果；strict 工具模式目前标为 Beta，需 `/beta`、每工具 `strict:true`，对象属性均 required 且 `additionalProperties:false`，并存在不支持的 JSON Schema 关键字。**因此不能仅给现有24个自由对象加 `strict:true` 宣称 schema 已被服务端验证**；先逐族收敛非 strict schema，并单独协议验证 Beta 可行性。
2. [DeepSeek Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion/)：工具响应有对应 ID；实现按完整工具调用组建模，逐 ID 回传结果，工具请求和 usage 必须按 provider 实际事件计数。对于同轮相互依赖动作，本项目需自定义事务语义，不得假定并行调用有先后依赖保证。
3. [DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)：Flash 支持 PNG/JPEG/GIF/WebP 图像，可作为 Chat Completions 文本与 `image_url` 内容块；独立视觉读取的 `images` 通道可复用；不代表当前产品 images+tools 能同请求使用。题图来源、能力验证、图像 token/请求体预算与人工核对仍需另建证据链。
4. [DeepSeek Pricing](https://api-docs.deepseek.com/quick_start/pricing/)：`deepseek-v4-flash` 为旧别名，实由新 Flash 服务；该页当时公布峰值输入 cache-miss $0.30/百万 tokens、输出 $1.20/百万 tokens。评测前必须重新查官方价，保留 usage 与实际账单未知口径；本地预算保护不是服务端硬账单保证。

外部项目/文档提供**协议约束**，不会代替本仓的几何合同与真实 DS 回执；不得以外部 demo 的通过率推断本产品效果。

## 3. 修复路线（按真实阻断优先，不先扩大36题付费）

### Block A — 同轮多工具调用的安全事务与真实回执（最高优先）

**A1 非付费工程检查点（2026-11-18）**：已用本轮8种真实工具名称序列做协议级回归，避免通用场景只读闸误拒；同轮构造支持隔离预执行、全批原子提交/回滚和逐 ID 回执，Rust 将多调用编码为单条 assistant 消息。证据见[Block A1 审计](../audit/2026-11-18-g3-f9-batch-protocol-a1/README.md)。**仍未在新提交上原生调用 DS**，8题合同状态不改；Block A 的供应商真实回执及同候选交付退出门禁仍未完成。


**Files**：`apps/web/src/agent/modelPlanner.ts`、`apps/web/src/agent/dsActionTools.ts`、`apps/desktop/src-tauri/src/providers/request.rs`、`apps/web/src/agent/fixtures/g3DsCaseTrace.ts`；测试：`modelPlanner.test.ts`、`dsActionTools.test.ts`、Rust request tests、`g3DsFrozenCaseRunner.test.ts`。

- [ ] **RED**：用脱敏的 GK-P01 三声明、GK-P05 点+线、JT-P07 曲线+多点及“同轮缺 ID/重复 ID/混只读+写入/某项非法/预算不足/取消”测试；断言旧实现给 `mixed_read_plan` 或零回执；不输入受保护的原始模型正文。
- [ ] **协议分类**：对 `ds_action` 在旧 `calls.length>1` 闸之前单独分派；区分全只读、全构造、混合、终止工具和未知工具，保留非 `ds_action` 旧行为。发布工具集合、参数对象、唯一 ID、数量上限、预算、权限、引用/同批依赖全部预检；不准“选第一条执行”。
- [ ] **事务策略**：推荐 **同批全预检 + 克隆/事务暂存 + 全成功才原子提交**。不支持的同批依赖/混合批次不部分执行：针对**每个**调用 ID 返回结构化可修复回执并说明“先完成上一动作再调用下一动作”；若供应商协议要求所有 ID 有回复就全部回复。`finish_candidate` 与写入同轮应拒绝混合并请求下一轮 finish；终止后不继续执行。
- [ ] **传输/追踪**：Rust adapter 把同轮 N 个调用编码为**一个 assistant 工具调用列表 + N 个匹配的 tool 结果**，保持顺序/ID、上下文，不泄露参数到脱敏 trace；更新每请求工具数、每动作接受/拒绝、首次真实阻断；区分 `protocol_rejected_batch` 和 `telemetry_missing`。
- [ ] **GREEN 与退出**：合法独立动作一轮全部执行且每 ID 有回执；非法批次零画布写入、零半批图元，预算计数精确，后续模型看见全部回执；同案例原生 dry-run 协议形状检查通过。不得将 `8` 题直接写为“已通过”：需下一轮授权真实复测。

**A2 零付费检查点（2026-11-19）**：在A1后发现同轮“构造 + 撤销”会同时回执 accepted 却留下空候选，已用失败测试复现并改为整批可修复拒绝、逐 ID 回执；模型批次指令由 v1 升为 v2，明确最多8个独立动作、修复/观察/终止分轮。另有声明+失败构造的无泄漏回执测试。详见[A2 审计](../audit/2026-11-19-g3-batch-destructive-a2/README.md)。**这是 A1 的事务正确性收口，不是8题真实复测通过或 Block A 完成。**

### Block B — 工具参数 schema、别名和实体引用（优先于盲目加请求）

**B1 非付费检查点（2026-11-18）**：五项最直接相关的平面工具已有模型可见封闭参数形状、真实内核正反例，曲线未知类型不再偷换为椭圆；见[Block B1 审计](../audit/2026-11-18-g3-f9-planar-schema-b1/README.md)。**仍有16项自由对象、缺字段码/实体目录/B2及新提交的真实 DS 复测未完成**，12道历史参数失败题分数不改。


**Files**：`dsActionTools.ts`（逐族参数契约）、`modelPlanner.ts`（模型可读 schema/回执状态）、`packages/agent-core/src` 的动作与快照契约（如必要）；测试对应 `dsActionTools.test.ts`、`modelPlanner.test.ts`、`drawingContracts.test.ts`。

- [ ] **先分型**：用审计里的工具序列按 `construct_conic/construct_point/construct_line/query_measurement/query_constraint_status` 提取脱敏 `missingFieldCodes` 与 `availableEntityIds` 的**有限白名单/摘要**；目前没有原始参数，不得臆测具体值或“重建失败输入”。
- [ ] **统一“发布→解析→执行”**：按工具编译闭合 schema，`required`/字段名与解析器共享常量；曲线支持的方程家族若尚未实现，**先移除“equation”能力宣传**，或者实现明确的方程→规范系数→几何构造和反例校验。2D点坐标、抛物线 `focalParameter`、椭圆/双曲线 `radiusX/radiusY`、线段 `from/to`、测量 `metric/targets` 均给有效/缺字段/非法引用 RED。禁止静默猜尺寸/曲率/符号数值。
- [ ] **实体目录/回执**：模型每轮可见 `scope/state/branch` 下可引用的名字、类型、已构造/仅声明状态，以及下一合法工具形状；合法别名映射可由内核无损正规化，有歧义则拒绝并提示清晰字段路径。失败最多按同类签名有限次数修复，避免重复刷满10次；真实需求不能被死板熔断误拦。
- [ ] **终止/答案**：阶段性进度显式提示仍缺哪些合同义务；足够时允许模型调用 `finish_candidate`，证书/合同仍独立判断。拆出 GK-S09 硬编码答案，标注内核计算、模型陈述及验证三种来源；不以固定题号答案蒙混真实泛化。
- [ ] **退出**：协议示例经模型可见 schema 与实际工具均能执行；当前真实失败族对应的脱敏断点可被局部复现；所有相关合同不放宽、参数负例与同名/跨分支引用负例持续拒绝。

**B2 非付费检查点（2026-11-18）**：补齐 `construct_line` 的精确 `a,b,c` 方程转两点内核构图，合法解析式不再必须先猜两个端点；旧端点路径保持，混合/退化输入拒绝。原始 DS 构线参数未保留，不能宣称旧 `undeclared_entity_ref` 已全部治愈。见[Block B2 审计](../audit/2026-11-18-g3-f9-line-equation-b2/README.md)。模型可见引用目录/实体回滚一致性尚待 B3。

**B3 非付费引用状态检查点（2026-11-18）**：发现并修复撤销后旧直线/曲线仍可被内核引用、带 branchId 的 repair 错撤共享候选；模型工具回执现区分已声明与真正物化且按 branchId 返回有界目录。见[Block B3 审计](../audit/2026-11-18-g3-f9-entity-reference-b3/README.md)。scope/state 重名、共享图元变更后的分支联动及原生 DS 接受度还未退出，Block B 未宣称完成。

**B4 零付费检查点（2026-11-19）**：模型可见的曲线 `axis/cx/cy` 此前被执行器忽略，纵轴双曲线会被错误画为横轴；现将方向/中心用于真实内核构造，非法输入不偷换。见[B4 审计](../audit/2026-11-19-g3-conic-axis-center-b4/README.md)。该缺陷属于已证实代码失真，**旧36题原始模型参数未保留，不能据此声称旧12次曲线缺参都已修好**。下一步围绕曲线族条件必填与模型可见能力继续修复。

**B5 零费检查点（2026-11-19）**：GK-P02 真实“先两次构点、后构曲线缺参数”序列促成内核能力补全；`construct_conic` 可显式选 `throughPointIds`，内核从已物化的两点计算唯一椭圆/双曲线的半轴及轴向，退化/错族/错分支拒绝。证据见[B5 审计](../audit/2026-11-19-g3-conic-fit-b5/README.md)。旧回执不含原参数，**不声明模型当时使用过点拟合或历史成功率提高**。后续仍需焦点/离心率等其它输入族和同版真实复测。

**B6 零费检查点（2026-11-19）**：移除 `finish_candidate` 对符号等棱三棱柱+外接球写死的面积答案；RED 证明它曾在模型未作答时自动出现，GREEN 后录制 GK-S09 作图合同/证书及画面仍过，证明原合同只要求画图、**不能证明模型答出球面积**。见[B6 审计](../audit/2026-11-19-g3-answer-provenance-b6/README.md)。今后图形与答案需分源归因和独立验收。

**B7 非付费检查点（2026-11-19）**：代码复核发现 `declare_entity` 公开自由对象却静默接受坐标并仅登记名字，产生“accepted 但点未物化”的误导；现发布封闭字段、拒绝无效附加字段，明确必须另用构造动作。该缺陷没有旧 DS 原始参数证据，不推断旧 12 道参数失败的归因，见[B7 审计](../audit/2026-11-19-g3-declare-entity-schema-b7/README.md)。其它工具族、真实模型画面与原生交付仍待修复/复测。

### Block C — 纯文字36题准入与真题替换（取代旧视觉关键路径）

- [x] **C-T0 清单**：保留旧23个 `text_only` 候选，新设高考立体8/联考立体5个空槽位；四象限各9题。`text-only-36-plan.json` 仅作规划、`runnable=false`；配额/旧集 SHA/图题排除守卫 RED→GREEN，不能拿槽位当真题或成功率。
- [ ] **C-T1 来源复核**：旧23逐题审查原题是否实有图片/隐含图示依赖；任一不合格按象限替换。寻找13道真正不带图、可独立来源核对的立体真题，8高考/5联考，逐题记录出处、题号、原文 SHA、审查人及文本完整性；不得自编、重复、从图推测条件或删“如图”伪装无图。
**C-T1 第一轮来源筛查（2026-11-19，未退出）**：已将旧23逐条与冻结文本/哈希对应，8高考候选有固定数据集文本/文件 SHA，其中 GK-S11/GK-S12/GK-S13/GK-S14 另有原卷 PDF SHA/题号/配图归属初核；5联考候选有原卷 PDF SHA 与逐页初核；但旧23及剩余4道高考仍需原卷复查，全部13候选仍需独立复审，13题合同尚未建立。原卷实见“题干不写如图但同页实际有配图”反例，已拒收。见[来源筛查审计](../audit/2026-11-19-g3-text-only-source-triage/README.md)。新版题集仍 `runnable=false`，**不得发起 DS**。

- [ ] **C-T2 新合同**：独立新 source manifest/合同版本与旧题集分离；每题具有形状/关系等可验证作图义务、合法分支/歧义审查，经过独立复核后才允许将新36标为 runnable 并锁定 hash。空槽位、图题、未知来源在任何真实模型请求前拒绝；不得用旧36的结果回填。
- [ ] **C-T3 真实准入**：新集冻结后另获付费预算授权，按新 suite hash+源码 commit+profile 修订小样本→完整36，逐题合同/证书/画面/原生交付并列汇报。

**历史记录（不在当前关键路径）**：先前 [C0 缺图阻断](../audit/2026-11-18-g3-f9-figure-input-c0/README.md)、[C1 题图哈希绑定](../audit/2026-11-19-g3-figure-digest-c1/README.md)仍然保留，产品现有视觉读取能力不撤销，但不为本轮寻找13张原题图、不做视觉付费测试。旧13图题只保留旧版审计，不进入新版36题。

### Block D — 真实候选可见与原生受控交付

**Files**：`apps/web/src/agent/agentRunner.ts`、`apps/web/src/agent/draftStore.ts`、`apps/web/src/canvasEvidence.ts`、`apps/web/src/components/agent/ConfirmationPanel.tsx`、`e2e/drawing-reliability-lifecycle.spec.ts`，以及受控原生测试入口。

- [ ] 只在合同/证书均 passed 时记录 `runId`、`candidateHash`、`documentHash`、真实预览像素摘要/截图；确认前拦截主画布 `writeDocument` 并断言次数 0；浏览器隔离导入仅作显示证据，不标 commit。
- [ ] 用户确认后同 hash 原子提交一次；再次提交/过期对话/过期候选必须拒绝，撤销/重做与刷新不串候选。人工抽检 3D 遮挡、标签、2D 可读性，不让自动盒子/标签计数代替可读性签收。
- [ ] 原生 Windows 实际桌面与真实 DS 候选演练，失败保留 `not_measured` 或具体错误，拒绝事后补写 passed。

**D0 非付费检查点（2026-11-18）**：产品 `ds_action` 候选确认路径现有可选脱敏交付观测口，覆盖待确认时0次 Agent 写入、确认后同候选哈希仅1次写入、过期拒绝与重复确认。三个浏览器生命周期测试和产品定向测试通过，详见[D0 审计](../audit/2026-11-18-g3-f9-delivery-observer-d0/README.md)。**原生真实 DS 候选交付、Windows 画面与人工签收仍未测，Block D 不退出。**

### Block E — 分层真实 DS 复测与费用门槛（每轮另获授权）

- [ ] **E0 不付费准备**：冻结源码 commit/题集 hash/profile revision、验证工具 schema 与原生可调用、机器预算、预计费用、密钥不落盘；功能回归只作防回归；每阶段更新五份进度文档并推送。
- [ ] **E1 小样本真实试点**：修复 A 后先针对多工具失败族 GK-P01、GK-P05、JT-P07；修复 B 后补 GK-P02、JT-P01；新36完整合同审核后加入一题无图立体新样本；GK-S09 作正例，不允许拿它替代失败族。每题逐请求回执、首断点、图元、证书、同候选截图、确认前0写入/确认后同哈希独立记录。失败停止扩批并按真实原因改下一块。
- [ ] **E2 36题真实扩批**：只有 E1 样本满足合同+证书+画面+原生交付且预算有剩余，方按**新批准**每题请求上限与整轮美元上限做36题；新增13题未完成来源/合同审核时新36不可运行；不能用旧有图题补足分母。支持同一提交的重复轮次估计波动，不将多次试验中的最好一次冒充首次成功。
- [ ] **逐题字段**：`modelInvoked`、`requestCount`、`firstBlocker`、`actionReceipts`、`candidateHash`、`contract`、`certificate`、`render`、`humanReadability`、`preConfirmWrites`、`nativeCommit`、`usage`、`costKnown/actualCostUsd`。分别报告“新版合格题数/36”“实际发起请求数/36”“合同通过”“证书”“可读预览”“确认交付”；未测不得写0/通过，预算估算与账单分开。
- [ ] **预算**：请求前限额、每题/整轮累加、usage 缺失/价目变化/单次费用不可估算立刻停；旧 $5 与本轮 91 次已消耗，不能自动重用。账单不能访问则写 unknown；不承诺本地估算是服务端收费硬上限。

## 4. 区块门禁与具体执行命令

| 关口 | 可观察硬条件 | 失败处理 |
| --- | --- | --- |
| A 事务协议 | 八个先前多工具题对应的工具序列在受控协议测试中 **8/8 不再被误判为 mixed_read_plan**；每个 tool_call_id 恰好一个回执；非法/取消/预算拒绝全批不提交 | 保留原始异常计数，不靠记录器补造回执；针对 Rust 适配器修分组 |
| B 参数/引用 | 本轮出现的 `missing_required_parameter`/`undeclared_entity_ref` 工具族都有模型可见合法输入、真实解析和拒绝反例；不新增 silent default | 将具体缺字段码和可用实体名入白名单回执，单族再测 |
| C 新纯文字题集 | 旧23逐题复核无图依赖；新增13道真题有来源/原文 SHA/独立合同，36题四象限各9且清单由不可运行晋级为经审核冻结 | 缺题/有图/重复则整套新36阻断，不借旧成绩补分母 |
| D 交付 | 同候选哈希串起合同、证书、预览、确认；确认前主画布写入 **0**，确认后 **1**；撤销/双提交拒绝 | 不把隔离导入冒充原生提交 |
| E 真测 | 同版逐题 DS 回执/截图/证书/交付完备，测同一提交的重复轮次；明确所有分母与费用未知 | 任一阻断停止扩批、回到对应区块，不借历史结果补分 |

建议验证：Block A/B 的 RED/GREEN 用 `npm.cmd exec -- vitest run apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts --maxWorkers=1`；Rust 适配器用 `npm.cmd run test:rust`；通用用 `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:docs -- --maxWorkers=1`；Block D 再跑 `npm.cmd run test:e2e -- e2e/drawing-reliability-lifecycle.spec.ts e2e/g3-f9-recorded-candidate-render.spec.ts`，现场逐图目视核验。**这些是将来实施时必须现跑的命令，不是本文声称通过的测试。**

每一块的提交都应可单独回滚；特别是多工具事务需保持单工具 GK-S09 原有路径不变，避免用放宽安全闸换取虚假通过。代码修完仍需另获付费授权，测新提交中的真实 DS，不准把旧91次改记为新成果。

## 5. 交付物、审查和阻断条件

每块结束输出：①首次失败→修正的证据链；②改动文件及最小 RED/GREEN；③类型检查、定向测试、Rust（涉及适配器时）、Playwright 实际画面和关键拒绝反例；④脱敏记录且不提交原始题面/模型正文字段/密钥；⑤同步 `docs/current-status.md`、`docs/project-progress.md`、`docs/agent-next-round-progress.md`、`docs/acceptance/agent-release-gate.md`、`docs/acceptance/agent-tool-loop-scorecard.md`；⑥提交推送后核对远端。任何块的本地 GREEN 不提升真实成功率，需 E1/E2 真模型重测。

**当前立刻可做**：Block C-T1 逐题核对旧23的无图资格并为13个空槽位寻找合法真题，同时继续 Block A/B 的协议和参数修复；均不需要新 DS 请求。**当前不能宣称**：36题真实端到端已通过、新版36题已完成来源和合同审核、同版重复稳定100%。Goal 只有在目标真正实现并完成真实可核验验收后才标 complete，预算耗尽或文档写完不等于 Goal 完成。

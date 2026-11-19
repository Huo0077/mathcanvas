# 下一轮工作导航

> **2026-11-19 2022全国甲卷理科两题原卷复核（0 DS 请求）**：GK-P03 第20题与 GK-P08 第14题均已核对原卷 PDF 与附图归属；旧23纯文字候选现有 **5/23 仅原卷页级初核**，其余18题需逐卷复审，全部36合同仍未独立审核。[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)记录证据；[新版准入清单](../test-fixtures/reliability/text-only-36-source-triage.json)继续 `runnable=false`。旧DS 1/26/9 和原生交付未测保持不变。


> **2026-11-19 保留题 GK-P05 原卷核验（0 新增 DS）**：使用 2021 全国甲卷理科原卷 p4 第20题确认抛物线题与旁边第19题立体配图无关；旧23已有 GK-P02/GK-P05/GK-P09 共 **3/23 页级初核**，余20题待复核。[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)列出 PDF SHA；[新版清单](../test-fixtures/reliability/text-only-36-source-triage.json)仍 `runnable=false`，独立合同/DS真实作图/原生交付未测，旧36成绩不变。


> **2026-11-19 旧23题第二道原卷复核（0新增DS）**：GK-P02 已用 2022 全国乙卷理科学生试卷 p5 核对第20题椭圆题与附图归属；连同 GK-P09，旧23目前 2/23 仅页级初核，其余21题未核对。来源[审计](audit/2026-11-19-g3-text-only-source-triage/README.md)及[清单](../test-fixtures/reliability/text-only-36-source-triage.json)保留具体 SHA。**不是独立合同批准，也不是新 DS 实测**；新36仍 `runnable=false`、旧实测读数不变。


> **2026-11-19 题页预览线索（0 DS 请求）**：GK-S10/GK-S15 已找到并目视核验第三方 JPEG 试卷题页预览（题号及配图归属），但**未取得原试卷 PDF，也无独立合同**；[来源清单](../test-fixtures/reliability/text-only-36-source-triage.json) 将预览状态与六道高考 PDF 页状态分开记录，[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)附字节 SHA。旧23只有 GK-P09 原卷初核，剩余22待复核；新版36保持 `runnable=false`，既有 DS 实测读数不变。


> **2026-11-19 无图题来源复核增量（0 新增 DS）**：[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)与[清单](../test-fixtures/reliability/text-only-36-source-triage.json)现记录 6/8 道高考立体候选的 PDF 页级初核、旧23中 GK-P09 原卷初核；仍缺高考 GK-S10/GK-S15 和旧22原卷审查。两份标题正确但题号内容不符的下载件明确拒收；GK-S16 转录“棱雉/棱柱”待按原卷重锁文本。所有候选未独立审核、合同未冻结，`runnable=false`；不改变旧36合同1/26/9或原生交付未测，也未发起新 DS。


> **2026-11-19 B8 线段参数闭合（0 新增 DS）**：`construct_segment` 由任意对象收紧为真实端点 `from/to` 必填；缺端点给明确缺字段码、额外几何字段不再被忽略后假接受，2D/3D 合法线段仍可构图。见[B8 审计](audit/2026-11-19-g3-segment-schema-b8/README.md)。旧36合同1/26/9、原生交付未测不变，新无图36待来源与合同审核、`runnable=false`；修复完成后的一次实测仍需新预算与每题请求上限。


> **2026-11-19 B7 声明动作假成功修复（零新增 DS）**：`declare_entity` 曾接受坐标字段却仅登记名字；现在模型可见 schema 限于真实执行字段，额外坐标返回可修复拒绝，`construct_point` 才真正物化图元。[B7 审计](audit/2026-11-19-g3-declare-entity-schema-b7/README.md)。旧36真实合同 1/26/9、原生交付未测不变；新版无图36来源/合同仍待审核、`runnable=false`。Goal 需全部修复后另获新费用/请求上限，才进行一次真实 DS 全量测试。


> **2026-11-19 高考候选原卷继续初核（0 新增 DS）**：又核验 GK-S12（2018 全国 I 文科 #5）和 GK-S14（2018 全国 II 理科 #16）原卷 PDF、哈希、题号及附图归属，[初筛审计](audit/2026-11-19-g3-text-only-source-triage/README.md)现有4/8高考候选原卷页初核；另4题仍转录线索。GK-S14 转录“圆雉”不同于原卷“圆锥”，需独立校正并重锁新题哈希；13道替换题没有独立合同，`runnable=false`，无新版 DS 实测。旧成绩不变。


> **2026-11-19 高考候选原卷增量初核（0 新增 DS）**：GK-S11（2016 全国新课标Ⅱ 第4题）和 GK-S13（2022 全国乙卷理科 第9题）已核验学生试卷 PDF 字节 SHA、题号、页码及附图归属，题目未附图；[证据](audit/2026-11-19-g3-text-only-source-triage/README.md)。另外6道高考候选仍只有转录线索，旧23需原卷复审，全部13候选仍待独立审阅与新合同；[来源清单](../test-fixtures/reliability/text-only-36-source-triage.json)继续 `runnable=false`。旧36合同 1/26/9 和原生交付未测均未改变。


> **2026-11-19 来源筛查检查点（0 新增 DS）**：[初筛审计](audit/2026-11-19-g3-text-only-source-triage/README.md)锁定旧23题文本/哈希、8道高考转录线索及5道联考原卷页/SHA；发现“题干无如图但旁有配图”的拒选反例，不能只凭关键词放行。所有候选仍待原卷/独立合同复审，[筛查数据](../test-fixtures/reliability/text-only-36-source-triage.json) `runnable=false`，新36题实测仍未开始；旧合同1/26/9与原生交付未测口径不变。


> **2026-11-19 纯文字36题重规划（0 新增 DS）**：用户明确本轮跳过原题有图的题，不进行视觉实测。旧36题保留历史 91 请求、合同 1通过/26失败/9未测且原生交付未测；[新规格](g3-final/G3-F9-text-only-36-suite-spec.md)和[实施计划](g3-final/G3-F9-text-only-36-implementation-plan.md)确定保留23个纯文字候选、另补8道高考立体+5道联考立体无图真题。13个目前只是待审空槽位，[规划清单](../test-fixtures/reliability/text-only-36-plan.json) `runnable=false`，新36未凑齐/不可开始实测，旧成绩不进入新分母；C0/C1视觉工作保留但退出本轮关键路径。先来源/文本完整性/独立合同审查，再另获费用授权做 DS 真测。


> **2026-11-19 C1 题图字节绑定（0 新增 DS）**：视觉阅读确认现按实际转码 PNG 的有序 SHA-256 绑定；同文字换图会使旧确认失效，发送内容携带脱敏哈希。当前原生请求仍禁止 images+tools 同请求，修正为视觉读取→人工核对→文本动作两阶段；13道原图、来源/原始 SHA、视觉 profile 与真实 DS 图文交付仍待补，旧36题合同 1/26/9 与原生交付未测不变。见 [C1 审计](audit/2026-11-19-g3-figure-digest-c1/README.md) 和 [主计划](g3-final/G3-F9-live-36-root-cause-and-repair-plan.md)。


> **2026-11-19 B6 作图与答案分源（0 新增 DS）**：移除 GK-S09 终止工具曾固定注入的球面积答案；录制棱柱/外接球仍通过**作图几何**合同和证书，但旧1题合同通过不能代表 DS 自主回答试卷选项。旧36题统计及原生交付未测状态不变，下一步仍需答案单独验证、图题原图与新授权真实复测。[B6 审计](audit/2026-11-19-g3-answer-provenance-b6/README.md)。

> **2026-11-19 B5 曲线两点拟合（0 新增 DS）**：针对真实 GK-P02 先构点后 `construct_conic` 缺参数序列，新增 `throughPointIds` 内核路径，只有两个已物化且足以确定请求曲线族的点才推导半轴/方向；退化、错族、混合输入、缺引用均拒绝。旧原生回执未保存原参数，**36题合同 1/26/9 不变**；仍需新提交真实 DS、图题与原生交付。[B5 审计](audit/2026-11-19-g3-conic-fit-b5/README.md)。

> **2026-11-19 B4 曲线方向/中心内核修正（零新增 DS）**：发现模型可见 `axis/cx/cy` 旧版执行被忽略，纵轴双曲线/偏移中心可能画错；现方向与中心进入内核且非法值显式拒绝。**没有新的付费实测，旧36题合同/交付口径不变**；曲线族必填参数、缺图与原生真实交付仍待处理。[B4 审计](audit/2026-11-19-g3-conic-axis-center-b4/README.md)。

> **2026-11-19 A2 批次假成功修复（零新增 DS）**：A1 多工具事务中“构造+撤销”可同时被接受却留下空候选；现整批可修复拒绝并保留逐 ID 回执，声明+失败构造不会污染下一轮引用目录。模型批次提示已升 v2 并与最多8个独立动作/修复分轮对齐。**旧36题1通过/26失败/9未评估不变**；新代码尚未获得真实 DS 同版复测或原生交付证明。[A2 审计](audit/2026-11-19-g3-batch-destructive-a2/README.md)。

> **2026-11-18 D0 原生候选交付观测（零新增 DS）**：产品 `ds_action` 确认路径新增可选脱敏事件，脚本化候选验证确认前 Agent 0写入、确认后同 hash 1次写入、过期/重复确认拒绝；但**真实 DS 候选的原生交付仍 not_measured**，不得倒填旧36题。图题同名 PNG 为产品生成图，不是原题图。[D0 审计](audit/2026-11-18-g3-f9-delivery-observer-d0/README.md)。

> **2026-11-18 C0 缺原图阻断（0 新增 DS 请求）**：原生冻结题入口以前会对13道图题只发文字；现基于题目合同在模型请求前标记 `input_figure_missing`、`modelInvoked=false`，单传确认引用也不能冒充图像。旧36题91请求的实测历史保持不变；图文真实成功仍未测，待原图和 vision/预算接线及新付费授权。[C0 证据](audit/2026-11-18-g3-f9-figure-input-c0/README.md)。

> **2026-11-18 Block B3 引用状态与回滚安全（零新增 DS）**：真实 `undeclared_entity_ref` 失败族驱动检查发现旧撤销仍保留线/曲线引用且分支撤销错改共享候选；已增有界模型可见物化/声明目录与共享、分支引用回滚安全测试。**本轮0付费调用，36题历史合同数据不变**；跨 scope/state 联动、原图和原生交付仍待修。[证据](audit/2026-11-18-g3-f9-entity-reference-b3/README.md)。

> **2026-11-18 Block B2 非付费精确直线方程**：根据真实构线引用失败族补上 `construct_line` 的 `a*x+b*y+c=0` 精确两点构图（保留旧 from/to；拒绝退化/混合/缺系数），可见 schema/说明同改；**原始模型参数未记录，因此不声称旧题已通过**。没有新增 DS 请求，下一步 B3 实体目录与同版真实复测待新授权。[审计](audit/2026-11-18-g3-f9-line-equation-b2/README.md)。

> **2026-11-18 Block B1 非付费平面参数契约**：针对真实36题频繁 `missing_required_parameter`，为曲线/点/线/测量/约束状态五项发布封闭参数字段，删去未实现的方程构造承诺，未知曲线类型不再默认椭圆；合法构造及非法引用正反例已核对。**没有新增 DS 请求，12题旧失败结论不变**；其余16项自由工具与完整实体引用/输入/交付仍需修复。详见[Block B1 审计](audit/2026-11-18-g3-f9-planar-schema-b1/README.md)。

> **2026-11-18 Block A1 真实失败驱动的非付费协议修复**：针对上次原生36题中8题同轮多构造调用被误判，多工具事务/逐 ID 回执与 Rust 同轮组包已加针对性测试（8个真实工具名称序列的合成参数协议测试、回滚/停滞/重复 ID 反例）；**本轮0新增 DS 请求，36题原审计和合同分数不变**。剩余需另获授权在固定新提交上验证真实供应商回执/合同/证书/画面及原生交付。详见[Block A1 审计](audit/2026-11-18-g3-f9-batch-protocol-a1/README.md)。

> **2026-11-18 真实 DS 失败深度研究 / Goal（规划阶段，未新增请求）**：依据固定36题原生91次调用建立[专项实施档案](g3-final/G3-F9-live-36-root-cause-and-repair-plan.md)，优先修同轮多工具事务和 Rust 多 ID 回执（8题）、逐族 schema/实体引用/完成候选，再补13题原图与原生确认交付。发现 GK-S09 的面积答案由现有 finish 路径提供特例，不能据此证明 DS 独立推导。Goal 已设为真实端到端可靠作图，文档完成**不是修复完成**；新增付费 DS 请求另获授权。

> **2026-11-18 最新真实 DS 全量36题（每题最多10次；取代下方旧单题状态）**：固定提交 `aa17eb70`、冻结题集 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`、保存的原生 DeepSeek profile revision 2 下，36/36题均实际发起请求，合计91次（91次 usage）；独立合同 **1 passed / 26 failed / 9 not_measured**，仅 GK-S09 同候选证书与隔离浏览器画面通过。13题引用原图但没有附经核验题图，只测了冻结文字；原生受控交付与主画布写入36题均未测，不宣称端到端通过率。实测定位8题同轮多构造工具调用被通用协议闸拒绝，9题未得到合同评估；保守估价上界 $0.5325891 < 整轮5美元，实际账单未知。后续只围绕真实断点修复，另获授权后才发新付费请求。见[36题脱敏审计](audit/2026-11-18-g3-f9-native-36-10x/README.md)。

> **2026-11-18 Task 7 family-tool checkpoint (zero cost):** Added `construct_equal_edge_triangular_prism` with a simple closed schema requiring only a named id and positive displayScale; it reuses the existing `construct_solid` solver, enforces the symbolic source, and rejects unknown geometry fields. A mock native provider request sees the published schema; recorded product flow and exact-candidate browser rendering pass. This does not prove the remote DeepSeek service accepts the schema; no paid request was made.

> **2026-11-18 GK-S09 symbolic-input hardening**: A RED test showed an all-edges-`a` prompt still accepted unlabelled numeric side/height values, allowing a guessed value to masquerade as the problem parameter. `construct_solid` now fails closed with `symbol_source_required` unless the model provides `symbol:"a"` plus a positive `displayScale`; the explicit symbolic path remains valid. Product ds_action and recorded replay regressions pass; no paid DS call.

> **2026-11-18 product-route correction (zero-cost recorded provider):** The product runner previously took the deterministic GK-S09 shortcut before consulting a selected `ds_action` planner. A RED test observed zero model calls. Explicit `intentMode: ds_action` now bypasses only that shortcut; the recorded 3-action provider path reaches the real product coordinator, waits for confirmation with zero main-canvas writes, and commits a sphere only after confirmation. The ordinary default deterministic route is unchanged. This is a test-injected opt-in path, not a proof that the default UI selects ds_action or that any paid DeepSeek call succeeded.

> **2026-11-18 exact-candidate browser evidence (recorded replay only):** The earlier 41 browser checks used the default deterministic planner, not the DS action candidate. A new Playwright check exports the GK-S09 candidate only after the independent contract and production certificate pass, imports that exact normalized document into the actual browser, and verifies the same candidate hash, prism, sphere, six labels, and canvas visibility (1/1). File import is a rendering check, NOT native DS participation or isolated confirmation/delivery for that candidate. Both remain open.

> **2026-11-18 F9 per-request receipt gate**: Zero-cost tests reproduced and fixed the case where an earlier request had an action receipt but a later action request lost telemetry. Each `ds_action` request is now checked against its action-call count and missing data is marked `telemetry_missing`. The generic `eval:reliability` runner also requires `--confirm-paid`; it is not the native G3-F9 `ds_action` entry and does not replace new user authorization. No paid request was made.

> **2026-11-18 live authorization gate rechecked**: `--allow-paid --max-requests 3` is parsed as live, but the actual runner refuses to start when `DEEPSEEK_API_KEY` is absent (`no automatic spend`). No provider request or charge occurred; the next action still requires new explicit user authorization.

> **2026-11-18 Task 9 verification note**: The required 41 Playwright same-candidate/lifecycle tests passed. A default parallel `npm test` run reported 8 timeout failures in unrelated common-tangent suites; rerunning those 3 files serialized with `--maxWorkers=1 --testTimeout=30000` passed `46/46`. This is recorded as an environment/timeout verification caveat, not converted into a false full-suite pass. No paid DS call was made.

> **2026-11-18 next entry**: Continue from Task 9 with same-candidate browser rendering and lifecycle gates. Do not treat the two zero-cost symbolic replays as live DS results; request new paid authorization before GK-S09 live testing.

> **2026-11-18 Task 7 parameter protocol first block (zero cost):** `construct_solid` now publishes a closed schema with supported kind values, positive dimensions, and named fields; the parser shares the same kind/field vocabulary and rejects unknown parameters. Targeted family/negative/missing-parameter checks pass, typecheck and test:docs pass, lint has 0 errors (34 pre-existing warnings). Per-family required-field rules and provider schema compatibility are not finished; Task 7 remains open. See [detailed plan](g3-final/G3-F9-GK-S09-detailed-repair-plan.md).

> **2026-11-18 Task 6 回执桥接（零付费）**：已增加 `runFrozenDsCaseTraced`，将真实 `ds_action` 逐请求/逐动作事件接入脱敏 `G3CaseTrace`，记录首次阻断码、图元变化和回执送达；零费伪 provider 验证缺参数和终止动作。旧 GK-S09 两次原始回执不可追溯，35题未测，实际费用未知。下一步 Task 7 参数 schema。详见 [详细修复计划](g3-final/G3-F9-GK-S09-detailed-repair-plan.md)。

> **2026-11-18 GK-S09详细实施计划已入档（仅文档）**：按[Task 6–9执行清单](g3-final/G3-F9-GK-S09-detailed-repair-plan.md)先补脱敏动作回执，再统一工具参数契约、符号尺度与真实外接球，最后零费整题回放及另获授权单题实测。本次不改作图代码、不发DS；旧真实GK-S09仍是2次请求无候选，35题未测，原因待回执定责。


> **2026-11-18 F9下一步**：以[修复计划 Task 6–9](g3-final/G3-F9-kernel-action-repair-plan.md)为执行入口：先记录两次 `construct_solid` 的脱敏真实回执，再修 `kind`/参数schema与 GK-S09 的符号棱长、外接球能力，完成零费用整题合同+证书回放后另获付费授权复测一题。旧单题请求不重跑、不合并为36题通过率。

> **2026-11-17 当前 F9 实测停点**：纯文字 GK-S09 两次原生DS `construct_solid` 均未形成候选，35题未测。先补工具回执脱敏 `{status, blockerCode, primitiveCount, hashChanged}`，零费核验含符号边长与外接球的题型，再按新授权复测小样本；[证据](audit/2026-11-17-g3-f9-text-only-pilot/README.md)。不要拿本地回放成功替代真实DS成绩。

> **2026-11-17 F9当前复测停点**：当前源码三族立体构造零费重新打包后19/21/15图元，旧假成功不再复现；GK-S08真实DS1请求即请求澄清，没有候选，余35题未测。先按[本轮审计](audit/2026-11-17-g3-f9-current-retest/README.md)核对其必要题图输入；或明确改选完整text_only代表题，再受控试点，不能把澄清算通过或直接放开36题。

> **2026-11-18 G3-F9 内核动作修复进展（Task 0–5 零付费闭环完成，0 新增付费；停在付费重授权前）**：`GK-S08` 完整 `ds_action` 0 付费回放与全部全量检查均通过：`npm test` **`557` 文件 `5883 passed | 1 todo`**、`typecheck` 退出 `0`、`lint` **`0 errors`**、Playwright E2E **`41 passed`**（详见 [Task 5 审计](./audit/g3-f9-repair-t5-zero-cost/README.md)）；旧 `8 req` / `0/36` 与 `humanReviewed`/`Windows UIA` 待后续授权实测。
> **2026-11-18 G3-F9 内核动作修复进展（Task 0–4 完成，0 新增付费；推进 Task 5 零付费门禁）**：`PlanOutcome.candidateSlices`、`dsActionTools` 分支画布隔离与 `parabola` 支持、`GK-S02` `before_fold/after_fold` 开放折面与 `GK-P06` 三分支 `ds_action` live 接线已通（`4` 文件 `131 passed`，`typecheck` 退出 `0`，`lint` `0 errors`；见 [Task 4 审计](./audit/g3-f9-repair-t4/README.md)），真实 DS 仍未重测。
> **2026-11-18 G3-F9 内核动作修复进展（Task 0–3 完成，0 新增付费；推进 Task 4）**：已完成 [修复计划](g3-final/G3-F9-kernel-action-repair-plan.md) **Task 0**（`4e2bb55a`）、**Task 1**（`8af88e39`）、**Task 2**（`5ab07e00`）与 **Task 3**（[Task 3 审计](audit/g3-f9-repair-t3/README.md)，回执签名、无进展熔断与预算不双扣，`3` 文件 `83 passed` + `typecheck` + `lint` + `test:docs` 全过）；**当前执行入口推进至 Task 4（Live 多问 / 多状态 / 多分支 `CandidateSet` 接线与回归验证）**，真实 DS 调用仍暂停。

> **2026-11-17 F9修复入口**：先读[新修复计划](g3-final/G3-F9-kernel-action-repair-plan.md)和[三组零费反例](audit/2026-11-17-g3-f9-repeat-probe/README.md)。Task0禁止3D动作假成功→Task1接 `solveConstraint3d` 真正物化立体→Task2面/观察→Task3无进展熔断→Task4真实多状态候选→Task5新授权小样本。当前真实F9仅GK-S08试点8请求、未形成候选；本轮额外付费0，不能扩到36。

> **2026-11-17 F9 首题停批**：新授权下已真实发出8次 `ds_action` 请求测GK-S08，但`construct_solid`/`construct_face` 虚报成功且图元0，`finish_candidate` 因空候选失败；其余35题未测。先按[首题审计](audit/2026-11-17-g3-f9-ds-action-pilot/README.md)修内核动作工具与读工具，继续补真正 live CandidateSet，多项零费通过后再复测一题。不能将剩余100次请求盲目用完。

> **2026-11-17 F9零费用停点**：本轮用户维持5美元/108请求/单题3次，但 `ds_action` 最小正例需4次往返、F9 `PlannerPort` 当前仍只产 `shared` 候选。新模型请求0次；先解决两个零费接线问题，再商议单题上限或原子动作批次。证据：[F9接线门禁](audit/2026-11-17-g3-f9-zero-cost-gate/README.md)。
> **F9停点（2026-11-17）**：四题旧 `ds_intent` 临时入口误测，不是 `ds_action` F9成绩；10次请求后已停止。先按[误路由审计](audit/2026-11-17-g3-f9-route-mismatch/README.md)做零付费入口/动作轨迹/候选集合检查，并重新确认本轮预算，再考虑新模型调用。禁止直接扩大到36题。

> **2026-11-18 最终版 B→C 路线执行更新（Task F0–F8 全部完结，0 付费；真实 DS 仍 0/36）**：已完成 **Task F0**（`f118c721`）至 **Task F8**（[Task F8 审计](audit/g3-final-f8/README.md)，全仓 `557` 文件 `5875 passed | 1 todo` + `typecheck` + `lint` `0 errors` + `test:rust` + `Playwright` `41 passed` + `test:docs` 全过）。所有零付费工程改造已全部交付并推送；按 §12 门禁要求，**现严格停在 Task F9（分层真实 DeepSeek 复测：Tier A→B→C）独立付费授权前**，真实 DS 基线仍为 `0/36`（`bridge_replay_passed`，`humanReviewed: pending`）。

> **2026-11-17 最新DS实测**：最新 `92981ebd` 全36题强制DS完整合同仍**0/36**，有候选2题、34题无候选；此前7个工具混批本轮0个。优先修结构化施工单的未声明实体/必需参数/格式协议，不以加请求、离线36/36或浏览器工程通过替代。逐题见[本轮审计](audit/2026-11-17-g3-ds-live-retest-92981/README.md)，再次付费需新授权。

> **2026-11-17 Task 0–Task 5 完成 + 零付费加固更新（停机等待 Task 6 付费授权）**：已完成 [Task 0](audit/g3-ds-failure-driven-t0/README.md)（`6747fb72`）、[Task 1](audit/g3-ds-failure-driven-t1/README.md)（`3a803541`）、[Task 2](audit/g3-ds-failure-driven-t2/README.md)（`524b92f2`）、[Task 3](audit/g3-ds-failure-driven-t3/README.md)（`375bb194`）、[Task 4](audit/g3-ds-failure-driven-t4/README.md)（`332d8e47`）、[Task 5](audit/g3-ds-failure-driven-t5/README.md)（`b776d609`）及 [零付费加固轮](audit/g3-ds-failure-driven-hardening/README.md)（修复 `ds_intent` 提示词/schema 参数契约冲突、`g3DsFrozenCaseRunner` `plan.set_plan`/`AbortSignal` 接线与 Task 6 预检熔断门禁、`dsDrawingIntent` 公切线/源绑定切线/垂直平行线/缩放方程/多点折叠/未解步骤 fail-closed；全仓 `npm test` `550` 文件 `5850 passed | 1 todo`、`typecheck`、`lint` 与 `test:docs` 全过）；真实 DS 成绩仍为 `0/36`，**当前执行严格停在 Task 6（Live 预检 + 36 题在线复测）之前，等待用户显式付费授权**。
> **2026-11-17 G3-DS 新执行入口**：先读[当前状态](current-status.md)、[新设计](superpowers/specs/2026-11-17-g3-ds-failure-driven-design.md)与[失败驱动实施计划](superpowers/plans/2026-11-17-g3-ds-failure-driven-implementation-plan.md)。Task 0诊断→Task 1工具协议→Task 2数学参数来源→Task 3候选与约束→Task 4多状态合同→Task 5同版画布→Task 6新授权实测；下文旧“下一步”只作历史导航。DS真实合同仍0/36，不启动新付费调用。
> **2026-11-17 36题真实DS复测优先导航**：完整36题已按用户要求跑完，当前强制DS路线完整合同**0/36**、3 partial、33 failed、93原生请求；根因先查[逐题审计](audit/2026-11-17-g3-ds5-live-36/README.md)的混合工具批次、26题零候选及10题不完整候选。不得只增加重试、拿离线36/36抵账或沿用已耗尽的本轮付费授权。实时进度见[当前状态](current-status.md)。
> **2026-11-17 DS5 预检更新**：已按用户额度真实请求4次，4题均未生成候选（完整合同0/4），受单题1请求限制；至少3题首轮出现 `tool_calls`，须先查工具环与预算诊断。证据见[DS5否定性预检](audit/2026-11-17-g3-ds5-live-preflight/README.md)。本次请求额度耗尽，新的2–3次/题或36题整批需重新授权；不继承旧的“DS未测”导航。

> **2026-11-17 DS4 收口更新**：已完成 `DS0`（[DS0 基线与边界定位](audit/2026-11-16-g3-ds-live-baseline/README.md)）、`DS1`（[DS1 结构化施工单与紧凑协议](audit/2026-11-17-g3-ds1-intent/README.md)）、`DS2`（[DS2 义务族求解与作用域隔离](audit/2026-11-17-g3-ds2-partial-families/README.md)）、`DS3`（[DS3 生产证书双向闭环与有界修复](audit/2026-11-17-g3-ds3-certificate-repair/README.md)）与 `DS4`（[DS4 同候选浏览器渲染与受控交付](audit/2026-11-17-g3-ds4-render-delivery/README.md)，0 付费调用，全量 Vitest `547/5824`、Playwright `40/40`、desktop 构建过）。**当前停在 `DS5` 付费实测授权门禁前**：需先由用户明确授权目标模型/题集、预检批量、最大请求数与 token/费用上限及停机条件，同时另行安排教师人工可读性与实机桌面窗口 UIA 签收。实时分数只看[当前状态](current-status.md)。

> **2026-11-17 G3区块更新**：[G3真实浏览器渲染审阅包](audit/2026-11-17-g3-render-exit/README.md)：36题自动化渲染和全量E2E已验证；25题仍有视觉警告，人工可读性与Windows桌面窗口签收待办。下一步先逐题审阅，不把AI抽检或DS未测结果当成人工通过。

最后更新：2026-11-17（真实候选渲染与确认链已闭环；下一区块为 36 题审阅包、桌面 UIA 与最终复核；DeepSeek 实测按用户指示保留后继）。

**实时进度只看[当前状态](current-status.md)，执行顺序只看[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)与当前[G3续作计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。** 本页不再保存第二份完成数字、测试读数或发布判断。

## 从哪里开始

1. 先读[当前状态](current-status.md)、[真实候选渲染与确认链](audit/2026-11-17-g3-candidate-render/README.md)、[G3 阶段总验收汇总](audit/2026-11-17-g3-final/README.md)、[Task 6 交互与全量回归证据](audit/2026-11-17-g3-interaction-exit/README.md)、[Task 4 G3-Math 36/36 退出证据](audit/2026-11-17-g3-math-exit/README.md)、[Task 3 平面 18 题证据](audit/2026-11-17-g3-planar-18/README.md)、[Task 2 证书接线证据](audit/2026-11-17-g3-certificate-wiring/README.md)、[P0 / T01 R4 终审与基线](audit/2026-11-17-g3-contract-review-r4/README.md)、[P7 / T15渲染可见性证据](audit/2026-11-17-p7-render-visibility/README.md)、[DeepSeek真实结果](audit/2026-11-16-g3-deepseek-provider/README.md)和[G3续作计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。真实候选渲染续作为 **544 文件 / 5796 passed + 1 todo**、目标 Playwright **5/5**；下一区块生成 36 题截图/联系表，再做桌面 UIA 与最终独立复核。
2. 应用户明确指示，**已保存 DeepSeek 真实模型画图测试暂留由用户本人后续执行**；非沙盒交互式桌面 UIA 走查、教师/用户人工可读性签收与 `P8` 仍保持未完成，不以浏览器 E2E 或 AI 抽检冒充人工签收。
3. 每个区块执行 RED→GREEN、生产接线、反例/兼容和独立复核，随后同步活动进度文档、提交并推送 `feature/drawing-reliability-execution`，核对远端 ahead/behind 均为0。
4. 仅用户本次明确授权的保存 DeepSeek 可进行真实评测；其他付费 provider、P8、安装包/冷机与正式发布不在本 goal 内。实际 Windows 桌面 no-bundle 交互验证属于 G3-UX，不能用浏览器 mock 代替。AI 截图审查与用户/教师人工签收分开记录。

## 历史和证据边界

[版本决定](audit/2026-11-15-main-restart/README.md)固定59ea3613代码基线，be033b71为已完成的重启提交；旧线47提交已舍弃且有备份。正文带历史标记的N/V/W/Task计划只用于追溯，不计本轮已完成。

[项目审查报告](audit/2026-11-15-project-review/README.md)、[36题原始证据](audit/2026-11-15-drawing-baseline/README.md)和[原件归档](audit/2026-11-15-pre-reset/README.md)保持原样。历史E2E/基线读数、只读探针、工作包GREEN和本次G3实核不是同一类证据；以当前状态中的分层说明为准。

[本次对齐清单](audit/2026-11-15-progress-alignment/README.md)列出活动文件与历史导航处理范围。RustSec因未装 `cargo-audit` 留为 `unknown`；本次安装出现的新公告只作环境信号，未授权在本区块升级依赖。

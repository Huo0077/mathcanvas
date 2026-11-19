# MathCanvas Agent Tool Loop Scorecard

> **2026-11-19 来源筛查检查点（0 新增 DS）**：[初筛审计](../audit/2026-11-19-g3-text-only-source-triage/README.md)锁定旧23题文本/哈希、8道高考转录线索及5道联考原卷页/SHA；发现“题干无如图但旁有配图”的拒选反例，不能只凭关键词放行。所有候选仍待原卷/独立合同复审，[筛查数据](../../test-fixtures/reliability/text-only-36-source-triage.json) `runnable=false`，新36题实测仍未开始；旧合同1/26/9与原生交付未测口径不变。


> **2026-11-19 纯文字36题重规划（0 新增 DS）**：用户明确本轮跳过原题有图的题，不进行视觉实测。旧36题保留历史 91 请求、合同 1通过/26失败/9未测且原生交付未测；[新规格](../g3-final/G3-F9-text-only-36-suite-spec.md)和[实施计划](../g3-final/G3-F9-text-only-36-implementation-plan.md)确定保留23个纯文字候选、另补8道高考立体+5道联考立体无图真题。13个目前只是待审空槽位，[规划清单](../../test-fixtures/reliability/text-only-36-plan.json) `runnable=false`，新36未凑齐/不可开始实测，旧成绩不进入新分母；C0/C1视觉工作保留但退出本轮关键路径。先来源/文本完整性/独立合同审查，再另获费用授权做 DS 真测。


> **2026-11-19 C1 题图字节绑定（0 新增 DS）**：视觉阅读确认现按实际转码 PNG 的有序 SHA-256 绑定；同文字换图会使旧确认失效，发送内容携带脱敏哈希。当前原生请求仍禁止 images+tools 同请求，修正为视觉读取→人工核对→文本动作两阶段；13道原图、来源/原始 SHA、视觉 profile 与真实 DS 图文交付仍待补，旧36题合同 1/26/9 与原生交付未测不变。见 [C1 审计](../audit/2026-11-19-g3-figure-digest-c1/README.md) 和 [主计划](../g3-final/G3-F9-live-36-root-cause-and-repair-plan.md)。


> **2026-11-19 B6 作图与答案分源（0 新增 DS）**：移除 GK-S09 终止工具曾固定注入的球面积答案；录制棱柱/外接球仍通过**作图几何**合同和证书，但旧1题合同通过不能代表 DS 自主回答试卷选项。旧36题统计及原生交付未测状态不变，下一步仍需答案单独验证、图题原图与新授权真实复测。[B6 审计](../audit/2026-11-19-g3-answer-provenance-b6/README.md)。

> **2026-11-19 B5 曲线两点拟合（0 新增 DS）**：针对真实 GK-P02 先构点后 `construct_conic` 缺参数序列，新增 `throughPointIds` 内核路径，只有两个已物化且足以确定请求曲线族的点才推导半轴/方向；退化、错族、混合输入、缺引用均拒绝。旧原生回执未保存原参数，**36题合同 1/26/9 不变**；仍需新提交真实 DS、图题与原生交付。[B5 审计](../audit/2026-11-19-g3-conic-fit-b5/README.md)。

> **2026-11-19 B4 曲线方向/中心内核修正（零新增 DS）**：发现模型可见 `axis/cx/cy` 旧版执行被忽略，纵轴双曲线/偏移中心可能画错；现方向与中心进入内核且非法值显式拒绝。**没有新的付费实测，旧36题合同/交付口径不变**；曲线族必填参数、缺图与原生真实交付仍待处理。[B4 审计](../audit/2026-11-19-g3-conic-axis-center-b4/README.md)。

> **2026-11-19 A2 批次假成功修复（零新增 DS）**：A1 多工具事务中“构造+撤销”可同时被接受却留下空候选；现整批可修复拒绝并保留逐 ID 回执，声明+失败构造不会污染下一轮引用目录。模型批次提示已升 v2 并与最多8个独立动作/修复分轮对齐。**旧36题1通过/26失败/9未评估不变**；新代码尚未获得真实 DS 同版复测或原生交付证明。[A2 审计](../audit/2026-11-19-g3-batch-destructive-a2/README.md)。

> **2026-11-18 D0 原生候选交付观测（零新增 DS）**：产品 `ds_action` 确认路径新增可选脱敏事件，脚本化候选验证确认前 Agent 0写入、确认后同 hash 1次写入、过期/重复确认拒绝；但**真实 DS 候选的原生交付仍 not_measured**，不得倒填旧36题。图题同名 PNG 为产品生成图，不是原题图。[D0 审计](../audit/2026-11-18-g3-f9-delivery-observer-d0/README.md)。

> **2026-11-18 C0 缺原图阻断（0 新增 DS 请求）**：原生冻结题入口以前会对13道图题只发文字；现基于题目合同在模型请求前标记 `input_figure_missing`、`modelInvoked=false`，单传确认引用也不能冒充图像。旧36题91请求的实测历史保持不变；图文真实成功仍未测，待原图和 vision/预算接线及新付费授权。[C0 证据](../audit/2026-11-18-g3-f9-figure-input-c0/README.md)。

> **2026-11-18 Block B3 引用状态与回滚安全（零新增 DS）**：真实 `undeclared_entity_ref` 失败族驱动检查发现旧撤销仍保留线/曲线引用且分支撤销错改共享候选；已增有界模型可见物化/声明目录与共享、分支引用回滚安全测试。**本轮0付费调用，36题历史合同数据不变**；跨 scope/state 联动、原图和原生交付仍待修。[证据](../audit/2026-11-18-g3-f9-entity-reference-b3/README.md)。

> **2026-11-18 Block B2 非付费精确直线方程**：根据真实构线引用失败族补上 `construct_line` 的 `a*x+b*y+c=0` 精确两点构图（保留旧 from/to；拒绝退化/混合/缺系数），可见 schema/说明同改；**原始模型参数未记录，因此不声称旧题已通过**。没有新增 DS 请求，下一步 B3 实体目录与同版真实复测待新授权。[审计](../audit/2026-11-18-g3-f9-line-equation-b2/README.md)。

> **2026-11-18 Block B1 非付费平面参数契约**：针对真实36题频繁 `missing_required_parameter`，为曲线/点/线/测量/约束状态五项发布封闭参数字段，删去未实现的方程构造承诺，未知曲线类型不再默认椭圆；合法构造及非法引用正反例已核对。**没有新增 DS 请求，12题旧失败结论不变**；其余16项自由工具与完整实体引用/输入/交付仍需修复。详见[Block B1 审计](../audit/2026-11-18-g3-f9-planar-schema-b1/README.md)。

> **2026-11-18 Block A1 真实失败驱动的非付费协议修复**：针对上次原生36题中8题同轮多构造调用被误判，多工具事务/逐 ID 回执与 Rust 同轮组包已加针对性测试（8个真实工具名称序列的合成参数协议测试、回滚/停滞/重复 ID 反例）；**本轮0新增 DS 请求，36题原审计和合同分数不变**。剩余需另获授权在固定新提交上验证真实供应商回执/合同/证书/画面及原生交付。详见[Block A1 审计](../audit/2026-11-18-g3-f9-batch-protocol-a1/README.md)。

> **2026-11-18 真实 DS 失败深度研究 / Goal（规划阶段，未新增请求）**：依据固定36题原生91次调用建立[专项实施档案](../g3-final/G3-F9-live-36-root-cause-and-repair-plan.md)，优先修同轮多工具事务和 Rust 多 ID 回执（8题）、逐族 schema/实体引用/完成候选，再补13题原图与原生确认交付。发现 GK-S09 的面积答案由现有 finish 路径提供特例，不能据此证明 DS 独立推导。Goal 已设为真实端到端可靠作图，文档完成**不是修复完成**；新增付费 DS 请求另获授权。

> **2026-11-18 最新真实 DS 全量36题（每题最多10次；取代下方旧单题状态）**：固定提交 `aa17eb70`、冻结题集 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`、保存的原生 DeepSeek profile revision 2 下，36/36题均实际发起请求，合计91次（91次 usage）；独立合同 **1 passed / 26 failed / 9 not_measured**，仅 GK-S09 同候选证书与隔离浏览器画面通过。13题引用原图但没有附经核验题图，只测了冻结文字；原生受控交付与主画布写入36题均未测，不宣称端到端通过率。实测定位8题同轮多构造工具调用被通用协议闸拒绝，9题未得到合同评估；保守估价上界 $0.5325891 < 整轮5美元，实际账单未知。后续只围绕真实断点修复，另获授权后才发新付费请求。见[36题脱敏审计](../audit/2026-11-18-g3-f9-native-36-10x/README.md)。

> **2026-11-18 Task 7 family-tool checkpoint (zero cost):** Added `construct_equal_edge_triangular_prism` with a simple closed schema requiring only a named id and positive displayScale; it reuses the existing `construct_solid` solver, enforces the symbolic source, and rejects unknown geometry fields. A mock native provider request sees the published schema; recorded product flow and exact-candidate browser rendering pass. This does not prove the remote DeepSeek service accepts the schema; no paid request was made.

> **2026-11-18 GK-S09 symbolic-input hardening**: A RED test showed an all-edges-`a` prompt still accepted unlabelled numeric side/height values, allowing a guessed value to masquerade as the problem parameter. `construct_solid` now fails closed with `symbol_source_required` unless the model provides `symbol:"a"` plus a positive `displayScale`; the explicit symbolic path remains valid. Product ds_action and recorded replay regressions pass; no paid DS call.

> **2026-11-18 product-route correction (zero-cost recorded provider):** The product runner previously took the deterministic GK-S09 shortcut before consulting a selected `ds_action` planner. A RED test observed zero model calls. Explicit `intentMode: ds_action` now bypasses only that shortcut; the recorded 3-action provider path reaches the real product coordinator, waits for confirmation with zero main-canvas writes, and commits a sphere only after confirmation. The ordinary default deterministic route is unchanged. This is a test-injected opt-in path, not a proof that the default UI selects ds_action or that any paid DeepSeek call succeeded.

> **2026-11-18 exact-candidate browser evidence (recorded replay only):** The earlier 41 browser checks used the default deterministic planner, not the DS action candidate. A new Playwright check exports the GK-S09 candidate only after the independent contract and production certificate pass, imports that exact normalized document into the actual browser, and verifies the same candidate hash, prism, sphere, six labels, and canvas visibility (1/1). File import is a rendering check, NOT native DS participation or isolated confirmation/delivery for that candidate. Both remain open.

> **2026-11-18 live authorization gate rechecked**: `--allow-paid --max-requests 3` is parsed as live, but the actual runner refuses to start when `DEEPSEEK_API_KEY` is absent (`no automatic spend`). No provider request or charge occurred; the next action still requires new explicit user authorization.

> **2026-11-18 Task 9 verification note**: The required 41 Playwright same-candidate/lifecycle tests passed. A default parallel `npm test` run reported 8 timeout failures in unrelated common-tangent suites; rerunning those 3 files serialized with `--maxWorkers=1 --testTimeout=30000` passed `46/46`. This is recorded as an environment/timeout verification caveat, not converted into a false full-suite pass. No paid DS call was made.

> **2026-11-18 Task 8 evidence**: The action loop now supports schema-checked symbolic triangular-prism construction and a kernel-derived circumsphere. Recorded GK-S09 replays pass at two scales; this is not live provider evidence and does not change the historical live score.

> **2026-11-18 Task 6 回执桥接（零付费）**：已增加 `runFrozenDsCaseTraced`，将真实 `ds_action` 逐请求/逐动作事件接入脱敏 `G3CaseTrace`，记录首次阻断码、图元变化和回执送达；零费伪 provider 验证缺参数和终止动作。旧 GK-S09 两次原始回执不可追溯，35题未测，实际费用未知。下一步 Task 7 参数 schema。详见 [详细修复计划](../g3-final/G3-F9-GK-S09-detailed-repair-plan.md)。

> **2026-11-18 GK-S09 当前实测与续作**：纯文字真实DS仅2次 `construct_solid`、无候选；35题未测，动作回执码缺失，实际费用未知。[Task 6–9详细执行计划](../g3-final/G3-F9-GK-S09-detailed-repair-plan.md)仅写入文档，尚未实现或重新付费测试；不可合并旧36题分数。

> **2026-11-18 G3-F9 内核动作修复（Task 0–5 零付费闭环完成，0 新增付费；停在付费重授权前）**：`GK-S08` `ds_action` 0 付费端到端与全仓门禁全过（`npm test` **`557` 文件 `5883 passed | 1 todo`**、`typecheck` 退出 `0`、`lint` `0 errors`、Playwright E2E **`41 passed`**；见 [Task 5 审计](../audit/g3-f9-repair-t5-zero-cost/README.md)），旧 `8 req` 仍未重跑。
> **2026-11-18 G3-F9 内核动作修复（Task 0–4 完成，0 新增付费；正推进 Task 5 零付费门禁）**：`PlanOutcome.candidateSlices`、`dsActionTools` 分支画布隔离与 `GK-S02`/`GK-P06` 多状态多分支 `CandidateSet` live 接线已通（`4` 文件 `131 passed`，`typecheck` 退出 `0`，`lint` `0 errors`；见 [Task 4 审计](../audit/g3-f9-repair-t4/README.md)）。
> **2026-11-18 G3-F9 内核动作修复（Task 0–3 完成，0 新增付费；正推进 Task 4）**：已完成 **Task 0**（`4e2bb55a`）、**Task 1**（`8af88e39`）、**Task 2**（`5ab07e00`）与 **Task 3**（[Task 3 审计](../audit/g3-f9-repair-t3/README.md)，回执签名、无进展熔断与预算一致），正按 [修复计划](../g3-final/G3-F9-kernel-action-repair-plan.md) 推进 Task 4 多状态 `CandidateSet` live 接线及 Task 5 零费总审。

> **2026-11-18 G3-DS Task F0–F8 进度（全部工程完结，零付费，真实 DS 仍 0/36）**：已按 [G3-DS 最终版实施档案](../g3-final/G3-DS-final-implementation-dossier.md) 完成 **Task F0–F8** 全部动作协议、隔离候选层、实体/约束图、2D/3D/折叠求解、定向局部修复及真实画布终态门禁（见 [Task F8 审计](../audit/g3-final-f8/README.md)），现按 §12 停机规则等待用户对 **Task F9（分层真实 DS 复测：Tier A→B→C）** 的显式付费授权与参数锁定。

> **2026-11-17 最新真实DS计分**：[当前修订原生36题报告](../audit/2026-11-17-g3-ds-live-retest-92981/README.md)：强制DS独立完整数学合同0/36，1 partial/35 failed，2非空候选、77请求、76次usage、实际费用未知；同版DS浏览器渲染/隔离提交未执行。旧离线36/36、旧DS2/36与前轮DS0/36各为不同修订/口径，不并表。

> **2026-11-17 G3-DS 门禁重排（Task 0–Task 5 已完成，零付费，不是新 DS 成绩）**：[失败驱动设计](../superpowers/specs/2026-11-17-g3-ds-failure-driven-design.md)与[实施计划](../superpowers/plans/2026-11-17-g3-ds-failure-driven-implementation-plan.md)明确按阶段统计“模型调用/候选/完整合同/生产证书/同候选渲染/隔离交付”，分母固定36；Task 0–5 已完成 [Task 0](../audit/g3-ds-failure-driven-t0/README.md)、[Task 1](../audit/g3-ds-failure-driven-t1/README.md)、[Task 2](../audit/g3-ds-failure-driven-t2/README.md)、[Task 3](../audit/g3-ds-failure-driven-t3/README.md)、[Task 4](../audit/g3-ds-failure-driven-t4/README.md) 与 [Task 5](../audit/g3-ds-failure-driven-t5/README.md)，最新真实DS完整合同仍0/36，浏览器端渲染包当前为 `bridge_replay_passed`（`dsLiveRendered` 与隔离真实 DS 交付须待 Task 6 授权实测），不能用离线36/36或回放顶替。首次失败归因与复杂题计分分叉必须单列。
> **2026-11-17 真实DS冻结36题**：强制 `ds_intent` 原生规划93次请求，数学合同 **0/36**、3 partial、33 failed、10题非空候选；93次中91次有usage，真实账单金额未知。DS候选渲染/受控交付未运行，不能将此前离线36/36或独立浏览器回归写为本次DS端到端成绩。[脱敏逐题审计](../audit/2026-11-17-g3-ds5-live-36/README.md)。
> **2026-11-17 DS5 真实模型预检**：4题各1次真实请求、合同通过0/4、均无候选；至少3题首轮返回 `tool_calls` 而没有后续请求额度。这是有限请求预检，不是完整36题、默认产品路线或端到端渲染交付成绩；真实账单费用未知。[脱敏证据](../audit/2026-11-17-g3-ds5-live-preflight/README.md)。

> **2026-11-16（America/Los_Angeles）真实 DS 口径更新**：强制 DS 规划冻结36题完整合同2/36，21 partial、13 failed、23非空候选、80请求，费用未知；未逐题做DS同候选真实浏览器/受控提交，故 `DS首轮端到端通过率` 仍**未测**，不能以2/36合同通过冒充端到端。DS0–DS5 新门禁和各分项见[实施计划](../superpowers/plans/2026-11-16-g3-ds-live-upgrade-plan.md)，实时状态见[当前状态](../current-status.md)。下文旧“Real drawing pass@1/pass@3 Not measured”仅是记录时点。

> **2026-11-17 G3区块更新**：[G3渲染证据](../audit/2026-11-17-g3-render-exit/README.md)：同候选浏览器渲染36/36与全量E2E 327/327，是工程门禁，不是DS真实模型pass@1或人工可读性通过；25题warning另报，费用/真实模型样本仍未测。

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：计分定义与历史读数索引；不复制最新成绩。实时状态仅维护在[当前状态](../current-status.md)；执行总顺序以[完整实施主计划](../superpowers/plans/2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](../superpowers/plans/2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

Updated: 2026-11-15（计分定义/导航对齐，不是新增provider或产品测试）。

## 本轮指标合同（不镜像实时读数）

| 指标 | 分子/分母或判定 | 不可混算 |
| --- | --- | --- |
| 草稿率 | 非空候选题数 / 冻结题数 | 不是几何正确率 |
| 完整数学通过 | 全部必要义务、对象、域与分支核验通过 / 冻结题数 | 旧host passed、局部exact、空义务、unknown均不可替代 |
| 端到端通过 | 数学+真实显示+交互均通过 / 冻结题数 | 只画公共图、澄清/拒绝不算整题出图 |
| 首轮/有限修复后 | 同一冻结模型/预算下分别报告 | 只取最好一轮、历史正确round救最终错误禁止 |
| 安全处理/误拒 | 审核负例正确阻断；有解题误拒另报 | 全部拒绝不能叫能力100% |
| 延迟/成本 | 分开成功与失败的实耗；未知金额为unknown | 预留上界不是账单；重复同题不当独立样本 |

最终接受的run/stage/artifact/hash是唯一计分对象，R09-A与T17负责新metricVersion；旧评测保持只读。指标定义见[实施主计划](../superpowers/plans/2026-11-15-main-restart-master-plan.md)，实际读数见[当前状态](../current-status.md)，发布要求见[发布门禁](agent-release-gate.md)。

## 历史指标与计分记录

下文旧数字、模式、Task 1–21、N/V阶段和“现在”措辞只表示原时点；不可据旧表宣布本轮完成或已放行。

Historical snapshot: 2026-10-11 (**四家族真题驱动升级仅调研与文档设计**；默认 Agent/自动 Lean 仍未放行)。**2026-10-20 勘误：下面"Task 1→21 的现行计分镜像"那张表的"现在"列已按[发布门禁](agent-release-gate.md)更新（Task 1–19 已完成、20 免授权部分完成、21 未放行）；本行日期只表示当时那份快照，不代表表里还是 10-11 的判定。**[真题需求调研](../research/2026-10-11-four-family-exam-diagram-survey.md)本轮已完成；[下一步 Agent 实施/进度](../superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md)列合同/预算、图形意图、四族构造、旧能力兼容、Lean 证明边界及现存 bug 的独立验收，不把旧 8×3/3 条 provider 小样本当四族真题 pass@k。最新 22:36 用户原题仍因开放面/未知动作修复失败；逐项现状和证据看[当前状态](../current-status.md)。

> **这张表只列"门槛与能力对照"。** 具体读数与各阶段做到哪一步，**以
> [`docs/current-status.md`](../current-status.md) 为准** —— 它是"现在时"的唯一一处。
> 这里的每一行都是**镜像**：能力前进一格时，这一行要跟着改（第 25 / 33 / 43 轮各漏过一次）。

Previous capability snapshot (2026-10-10): S1–S6 all closed; §3-F numeric angles implemented with browser evidence; earlier entries through 2026-10-07. **现行任务只覆盖需要画图的高中题。** 旧全课程 H0–H4 的 43/141 来源盘点只供寻找候选；V0 已有四家族 12 条内部文字/坐标候选和 134 未审子型，**四家族的实际作图交付仍未完成**（题设核验与浏览器证据已齐，差教师/学生目视走查）；**真实 provider 作图质量与自动 Lean 均未交付**。原文核验已由 `planHasVerifiableFigure` 一处判断覆盖多面体 / 平面点 / 圆锥曲线 / 函数曲线与切线（V0b–V0d 的 Agent 入口已补），`solid.create_template` 的模板实体**仍刻意不进核验**。既有真实 provider 成本仍 `null`、条件垂直引理不是整题证明；**S1–S6 已于 2026-10-10 全部收口**（含 S3.4 题面驱动的棱柱正例、菱形底面、斜棱柱、S6 入口语法与"认不出就问路"的浏览器反例）；**§3-F 的底面点名数值角同日做到"能读、能造、能核"**（阶段 A + B1，含两条浏览器 spec 与各自的对照实验），**空间线重合的判据与求解设计已写但记"暂不实施"**（查实没有任何产品入口能声明该约束，见下表的约束拖动一行）；具体门禁读数与发布结论分别看 [当前状态](../current-status.md) / [发布门禁](agent-release-gate.md)，新设计 [V0–V3](../superpowers/specs/2026-10-06-diagram-scope-addendum.md)。

> **2026-10-06 V0a 中途记录**：受限三棱锥草稿与开关正反例已有针对性证据（7 文件/171 定向、单 spec 3/3）；浏览器坐标回代、图形目视与全量回归**已于同日补齐**（见 [当前状态](../current-status.md)），**V0a/V0 仍不计完成**。Lean 未自动调用；provider 成本及大样本读数不变。现时唯一读数/放行状态见 [当前状态](../current-status.md) 与 [发布门禁](agent-release-gate.md)。

## 历史Task 1→21计分镜像（非本轮编号）

| 唯一编号 | 以后必须测什么 | 现在 |
| --- | --- | --- |
| **1–5** | 同版旧功能基线、用户坏动作/预算轨迹、非法条件和能力声明的 RED→GREEN。 | **已完成（2026-10-12）**；逐条证据见[发布门禁](agent-release-gate.md)与主计划。 |
| **6–9** | 条件来源、宿主、Worker 同版本和离线真题工件，错图与留出反例。 | **已完成（2026-10-12）**。 |
| **10–16** | 三角→折角→立体→圆锥→函数→同草稿真画布的逐家族通过率；一族绿不提升其它家族。 | **已完成（2026-10-12）**；一族绿不提升其它家族。 |
| **17–19（Lean）** | 限定引理/整题命题分级、改图证明 stale、真桌面/固定工具链与无网发行；失败不挡正确作图。 | 四类历史受限目标存在；旧路径定向 Vitest **7 文件/88 项通过**，非新完整原题证明/真 Lean。 |
| **20–21** | 每族 pass@1/pass@3、成本/延迟/人评，先定阈值再授权付费；最后作图/自动 Lean 分别放行。 | **未测、未放行**；旧 8×3 工具环不是四族真题结果。 |

[历史主计划](../superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md)仅保留旧Task上下文；它不再决定本轮状态或顺序。旧N/V/Task数字不折算为新的R/T/P完成项。GitHub [实施取舍](../research/2026-10-11-github-agent-implementation-survey.md)仅为设计证据。

## Metrics

| Metric | Definition | Failure rule |
|---|---|---|
| pass@1 | One independent run satisfies every acceptance check | A tool receipt, draft creation, or revision increase alone is not success |
| pass@3 | At least one of three independent runs satisfies every check | A single in-run repair is not a third trial |
| Tool error rate | Rejected tool calls / all tool calls | Separate provider errors from geometry refusal |
| Semantic verification rate | Completed claims with complete verification evidence / completed claims | Unknown, not-supported, or missing evidence does not pass |
| Visual verification rate | Visual tasks with same-draft screenshot/layout evidence / visual tasks | Old-draft screenshots and blank canvases do not pass |
| Average latency | Total time to confirmable draft / successful runs | Keep failed-run latency separate |
| Average cost | Provider billable cost / successful runs | Missing billing data is null, never zero |

## Deferred-capability scorecard

| Capability | Status | Required evidence before enabling |
| --- | --- | --- |
| General nonlinear solving | **partial (N2, flag default off)** | model/unsat/unknown/timeout/diverged, residuals and reproducible seeds — **present**; **degrees of freedom still `null`**; no success rate on a real task set; not wired into any user path unless the switch is turned on |
| Constraint-preserving drag | **experimental; default off, user-openable (N3)** | `e2e/agent-constrained-drag.spec.ts` 已有开/关、过约束拒绝、冲突恢复和一步撤销用例；空间线 `coincident` 缺 3D 判据时触及定义点会 fail-closed，不等于已支持其求解。**2026-10-10 补**：判据与求解的[设计已写](../superpowers/specs/2026-10-10-spatial-line-coincidence-design.md)（阶段 A 判据 / 阶段 B 照二维那条规则求解），并**查实今天没有任何产品入口能声明这条约束**（题面解析不产出、`DRAFT_ACTION_IDS` 没有约束动作、界面没有约束编辑器，而能力表却把它记为 `available`）⇒ 记为**已设计、暂不实施**。仍欠真实题集成功率与其它空间判据覆盖；旧“缺恢复路径”不是现况。 |
| Open-ended problem compilation | **offline benchmark + small real-provider samples; not released as general diagram accuracy (N4)** | 21 题契约和离线抽取/见证读数是协议/局部判据；应用内 planning 已由用户运行三轮但每轮只覆盖前 3/21，工具环另有一轮 8×3（pass@1 1/8、pass@3 2/8）。已有两个人工可读性标注，每组 n=1；成本因缺经核对价目表保持 `null`，一例响应 >1 MiB 未测到。**旧“无人读标注/付费运行尚未发生”已过期**；以上也不是现行四类作图题准确率，不满足默认启用门禁。 |
| Formal proof | **one backend wired (N5 `lean4`); four goal classes closed** | proof-artifact schema + `verifyProofArtifact` + a closed short-goal vocabulary + a **backend admission gate** (`WIRED_PROOF_BACKENDS` is *derived* from passed review records, so "no review" cannot be wired in) + `npm run proof:smoke` ⇒ **`PROOF_BACKENDS {"wired":["lean4"],"reviewed":1,…}`**, 8 tests passing. Every first-batch goal has a route: collinear/coplanar via the constraint layer, **pythagorean via an explicit ⊥ + Pythagoras inference step** (modelled as `inference`, deliberately **not** aliased onto ⊥). **Measured (local, standalone, real Lean)**: (1) 2026-10-06 — a *general* `perpendicular` proposition (the **性质定理**: line ⊥ plane ⇒ ⊥ any line in it) reaches `formally_proved` with `axioms [propext, Classical.choice, Quot.sound]` in ~68 s; (2) 2026-10-10 — a second class `linePlanePerpendicular` (renamed from `planePerpendicular` — see below) (the **判定定理**: line ⊥ two *intersecting* lines in a plane ⇒ ⊥ the plane) also reaches `formally_proved` on the same three axioms in **68392 ms**, and its two premises **are literally the two ⊥ from the problem statement** (so this class is closer to premise resolution than class 1 — but the rest of the problem's givens are still *not* premises). In both classes the **same proposition with `sorry` exits 0 but stays `verified_instance`** (same exit code, opposite verdict), and the two classes use **different theorem names**, so one class's `#print axioms` report cannot be passed off as the other's (pinned by a test). **2026-10-10 (same day, still no product path)**: goals are now **resolved by name-shape** (`declaredProofGoalForObligation` — `perpendicular`/`parallel` each carry a line-line *and* a line-plane reading; plane⊥plane has **no** goal and returns `null`, which also fixed a real mis-mapping where the "line ⊥ plane" goal was *named* `planePerpendicular`, the parser's kind for **plane⊥plane**), and a **premise bridge** (`proofPremiseBridge.ts`) labels every premise `fromText` / `fromDerivation` (a **named** one-step theorem) / `fromFigure` (must be listed) / `invented` ⇒ **an invented premise fails the bridge: no proposition is generated at all**. This is *not* "the original problem is now formalised": the problem's other givens (base shape, P off-plane…) still never become premises. **Missing**: only **two** goal classes (curve properties / tangent-derivative / other solid relations still have no template); the IR→Lean translation is itself unproved; `statement` is still optional; **a flag-gated product call site now exists (`draftStore.stage`'s 8th argument; off by default, and with the flag off the draft preview carries **no** proof field at all) but there is still no UI surface for artifacts and the flag cannot be turned on from stored preferences** (the desktop now has a **narrow** `check_lean_proof` command — template-shape inspection *before* spawning, toolchain **configured** via env vars rather than discovered on PATH, fixed argv, wall-clock and output caps, and **no verdict computed in Rust** — but nothing in the product calls it yet); the mathlib revision is not pinned. **Caveat**: this test **times out at 300 s on a cold page cache** (the first run after a reboot), warm it is ~68–70 s — and it **also times out when run inside the parallel full suite**. Standalone, warm is its yardstick |
| Real provider | **both axes measured (planning n=3; tool loop 8×3)** | **two independent channels, two buttons, two own request counts** (merging them is not allowed — it would make "what did I click, what will it cost" unsayable). (1) the agent-tool-loop panel (设置 → 真实 provider 评测 → agent 工具环) runs the same **8×3 = 24** sweep through `createModelPlanner` → the loopback proxy; (2) the **dataset-planning** panel runs the **21-case benchmark set's first 3 cases × 1 round = 3 requests**, recording `planned` / `clarification` / `rejected` / `error` per case. Both are **two-step and spend money**: each first resolves the active profile and states the request count and target, and only an explicit confirm starts it; **the key never leaves the credential store**. **State of the numbers, split by axis** (2026-10-05 correction — this row used to say "No run has happened yet", which stopped being true): the **planning axis has been run twice** by the user (`planned 2/3`; under the current vocabulary that reads `clarification 1/3` — the model *asked* rather than failing; latency 13445 ms / 8465 ms; **n=3, empty-canvas conditions** ⇒ not "model planning ability", not the whole case set). The **pass@1 axis still has no number, and the reason is not "nobody ran it"**: that channel built its request as `{ userMessage } as never`, which the real `createModelPlanner` rejects **before any request is sent** (`TypeError … reading 'context'`; reproduced with a probe, `runModelCalls=0`), so it had **never worked at all**; it was fixed on 2026-10-05 (`90eba6e`) and **nobody had run it since — until 2026-10-05 later that day, when the user ran it** (`pass@1 1/8`, `pass@3 2/8`, tool selection 45/45, tool error rate 4/45, latency 4126 ms, attempts 24; single model, single sample, 8 cases × 3 rounds). `cost` stays `not measured` on both axes — the repo has no price table. **Missing**: a **price table** (so `cost` can never become a number), and any reading beyond the 3-case subset. **Human readability is no longer missing**: on 2026-10-06 the user annotated the readability of the bodies the third planning run produced — one `plan` case and one `clarification` case, **both judged `unreadable`** ⇒ `readable rate 0.000` in each group; the `rejected` group had **no cases** and honestly reads "unannotated (denominator = 0 annotated, not a score of 0)". **⚠️ That is n=1 per group — not a trend, and not a 21-case conclusion.** Additionally that run exposed a transport bound: one case could not be measured at all and reported `error` because **the model response exceeded 1 MiB** (`the response exceeded 1048576 bytes`, retried to the cap) — fail-closed and honest, but such cases are **not measurable today** |

> **Do not read "partial (N2)" as "the solving gate is passed."** What exists: a bounded, seed-reproducible search that produces a witness only when the same verifier passes it, behind a default-off switch, with a golden pin proving the off path is byte-identical to `4707b64`. What does not: degrees of freedom (always `null`), any real-task success rate, any browser end-to-end of the rescue path, and any product wiring of a solver backend.
>
> **Degrees of freedom, precisely (2026-10-05).** Two different questions now have two different answers, and neither is "done":
> - **Witness layer** (`apps/web`/`agent-core`): still `null`. It needs `ConstraintType` to express line⊥plane and dihedral angles; until then any number would be a partial sum that hides what it left out.
> - **Drag layer** (kernel `constraints3dProjection`): a **real first-order number** — movable axes minus the rank of the constraint Jacobian, computed at the final configuration. First-order only: at a non-smooth point (residuals that take an absolute value) or a degenerate configuration the rank can overstate local stiffness. The two layers share one rank implementation (`linear-algebra.ts`) but deliberately use different "movable" sets (bindings vs. `anchoredPointIds`).
>
> **Do not read "partial (N3)" as "the drag gate is passed", nor "harness + real-provider readings (N4)" as "open-ended understanding works".** N3's missing half is now a **success rate on real tasks** — its product entry and its browser positive/negative cases both exist; N4's missing half is still a **real provider**. See the per-capability notes above.
## Historical evidence（旧运行，非本轮成绩）

### 2026-10-04 geometry-diagram supplement

| Metric | Current reading | Boundary |
| --- | --- | --- |
| Supported static-instance verification | 3319 unit assertions + 186 browser assertions **as of 2026-10-04** (current counts in [当前状态](../current-status.md) §一) | Fixed/ offline candidates; not real-model accuracy |
| Unknown-condition blocking | Covered by unit, runtime, HostBridge and browser negative paths | Only supported high-precision obligation forms are judged |
| Real-provider geometry pass@1/pass@3 | **Measured: `pass@1 1/8`, `pass@3 2/8`** | One post-fix run on 2026-10-05, **user-run (the controller did not observe it**; internal consistency checked). Until 2026-10-05 the channel's request shape made the real planner throw before any request was sent (`90eba6e` fixed it). **Definition**: `passAt1` = cases whose **first** trial passed; `passAt3` = cases where **any** of 3 trials passed. **Not comparable** to the offline `pass@1 4/8` (deterministic regression on a different subject), and **not** the same axis as the 3-case planning channel |
| Witness-search success rate | **Implemented; offline reading measured, real-task rate not** | The search exists (N2), only returns a witness the same verifier passes, and sits behind a **default-off** switch — but it **is** reachable from the UI (设置 → 实验性功能 → 示意图见证搜索) and from the offline benchmark (`BENCHMARK_WITNESS … solveRate=0.048`, 2026-10-10 re-measured). What is still missing is a **success rate on a real task set** (the offline set is 21 cases and its code table is re-recorded whenever it changes). **2026-10-10**: the numeric-angle family moved from "unverified" to read/construct/verify (ring angles on 3-/4-gon bases; apex-touching angles via bounded root finding), each with browser evidence — that is a capability step, **not** a rate. |


`npm run eval:agent` runs the offline evaluator and prints the scorecard (it reuses vitest because this repo has no TS runner; the report lives in `apps/web/src/agent/fixtures/agentEvalReport.ts`).

| Scope | Status | Evidence |
|---|---|---|
| Deterministic code/tests | Measured (2026-10-05) | **308 Vitest files, 3590 passed, 1 todo**; `typecheck` and `lint` exit 0; Rust **238 passed / 3 ignored** in consecutive full runs after serialising the five tests that hit the real credential store (before: 1 red in 5 runs; discriminator: 1/15 parallel vs 0/20 single-threaded; after: **0/100** parallel — 60 then 40 more in a re-check); full e2e **186 passed** in 7 consecutive runs after making `projectWorldPoint` wait for the camera to settle (before: 4 of 6 runs failed the same `data-preview-hovering` assertion). **Both fixes are test-side; product behaviour unchanged.** |
| Offline deterministic pass@1 | Measured **4/8** | `npm run eval:agent`, 2026-09-29 — passes: `create-cube`, `create-tetrahedron`, `reject-degenerate-cube`, `visual-fit-drawn` |
| Offline deterministic pass@3 | Measured **4/8** | same run, 3 independent trials per task |
| Offline tool selection | Measured **45/45** | same run |
| Offline tool error rate | Measured **3/45** | same run |
| Deterministic check coverage | **7 of 8 tasks judged**, 1 unverifiable | Only `visual-fit` remains `not_supported`, because its prompt has no composition verb so the deterministic planner produces nothing to judge. `section-after-solid` and `modify-section` gained judges this round and now honestly report `failed` (the local planner issues no section actions / produces no candidate) |
| Real provider tool selection | **One live run recorded** | 2026-09-29, DeepSeek `deepseek-chat` (`tools` verified): the native channel published **exactly the 5 model-facing tools** (`tools=5` in the transport log) and the model called `plan_set_plan`. Still not a pass@1 measurement |
| Real drawing pass@1/pass@3 | Not measured | Offline geometry-instance/browser evidence is not a real-model rate. One problem was driven end to end (`docs/research/2026-09-28-agent-tool-loop-progress.md`, "Live run against a real provider") and the model's answer was independently correct — but one problem is not a rate, and the scene was not connected |
| Visual/layout evidence | **Local path measured; screenshot path not wired** | `visual-fit-drawn` is judged by `diagnoseLayout` on a candidate document with **no provider vision** (clipping 0, label overlaps 0). `render.capture` / `render.inspect_layout` and live-camera boxes remain unconnected |
| Cost/latency | **Latency measured on both real-provider axes; cost not measured** | Latency is real wall-clock on every real run (planning 13445 / 8465 / 18153 ms; tool loop 4126 ms), and it stays attached to each recorded reading. `cost` remains `not measured` on **every** axis because the repo has **no price table** — re-running cannot change that. The older note that "the printed latency covers the deterministic local planner only" no longer applies to the real-provider rows |

## Offline deterministic mode

The repository includes a deterministic local evaluator. Its result mode is `deterministic_local`; it is useful for protocol and geometry regressions but must not be presented as real-model accuracy. The printed report carries that banner on its first line, and the metrics it cannot measure say `not measured` rather than showing a number.

**These 3/7 numbers are a floor for the local deterministic planner, not a model score.** They are the baseline later phases must move; a change here means the planner, the geometry kernel, or the judge changed.

## Historical release gate（本轮合同见页首）

1. Every model-visible tool has strict input validation, a real handler, and a result-return path.
2. A task passes only with semantic evidence; visual tasks also need same-draft visual evidence.
3. pass@1, pass@3, tool error rate, semantic/visual verification, latency, and cost are measured before release.
4. Any regression in confirmation, CAS, cross-document reference, or "success without evidence" blocks release.

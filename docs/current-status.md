# MathCanvas 当前状态

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

> **2026-11-18 full-suite caveat:** A serialized full Vitest command (`--maxWorkers=1 --testTimeout=30000`) exceeded the 10-minute execution timeout, so no full-suite pass is claimed. Targeted tests, typecheck, document checks, and the exact-candidate browser check are reported separately.

> **2026-11-18 exact-candidate browser evidence (recorded replay only):** The earlier 41 browser checks used the default deterministic planner, not the DS action candidate. A new Playwright check exports the GK-S09 candidate only after the independent contract and production certificate pass, imports that exact normalized document into the actual browser, and verifies the same candidate hash, prism, sphere, six labels, and canvas visibility (1/1). File import is a rendering check, NOT native DS participation or isolated confirmation/delivery for that candidate. Both remain open.

> **2026-11-18 F9 per-request receipt gate**: Zero-cost tests reproduced and fixed the case where an earlier request had an action receipt but a later action request lost telemetry. Each `ds_action` request is now checked against its action-call count and missing data is marked `telemetry_missing`. The generic `eval:reliability` runner also requires `--confirm-paid`; it is not the native G3-F9 `ds_action` entry and does not replace new user authorization. No paid request was made.

> **2026-11-18 live authorization gate rechecked**: `--allow-paid --max-requests 3` is parsed as live, but the actual runner refuses to start when `DEEPSEEK_API_KEY` is absent (`no automatic spend`). No provider request or charge occurred; the next action still requires new explicit user authorization.

> **2026-11-18 Task 9 verification note**: The required 41 Playwright same-candidate/lifecycle tests passed. A default parallel `npm test` run reported 8 timeout failures in unrelated common-tangent suites; rerunning those 3 files serialized with `--maxWorkers=1 --testTimeout=30000` passed `46/46`. This is recorded as an environment/timeout verification caveat, not converted into a false full-suite pass. No paid DS call was made.

> **2026-11-18 Task 8 zero-cost checkpoint**: Added real `construct_circumsphere` and symbolic GK-S09 display-scale provenance. Frozen GK-S09 recorded action replay passes at display scales 1 and 2 with prism, sphere, contract, and certificate; targeted tests 183 passed, docs 22 passed, typecheck passed. Browser same-candidate verification and new authorized live DS remain pending; real historical GK-S09 remains two unclassified requests and 35 cases unrun.

> **2026-11-18 Task 7 parameter protocol first block (zero cost):** `construct_solid` now publishes a closed schema with supported kind values, positive dimensions, and named fields; the parser shares the same kind/field vocabulary and rejects unknown parameters. Targeted family/negative/missing-parameter checks pass, typecheck and test:docs pass, lint has 0 errors (34 pre-existing warnings). Per-family required-field rules and provider schema compatibility are not finished; Task 7 remains open. See [detailed plan](g3-final/G3-F9-GK-S09-detailed-repair-plan.md).

> **2026-11-18 Task 6 回执桥接（零付费）**：已增加 `runFrozenDsCaseTraced`，将真实 `ds_action` 逐请求/逐动作事件接入脱敏 `G3CaseTrace`，记录首次阻断码、图元变化和回执送达；零费伪 provider 验证缺参数和终止动作。旧 GK-S09 两次原始回执不可追溯，35题未测，实际费用未知。下一步 Task 7 参数 schema。详见 [详细修复计划](g3-final/G3-F9-GK-S09-detailed-repair-plan.md)。

> **2026-11-18 GK-S09详细实施计划已入档（仅文档）**：按[Task 6–9执行清单](g3-final/G3-F9-GK-S09-detailed-repair-plan.md)先补脱敏动作回执，再统一工具参数契约、符号尺度与真实外接球，最后零费整题回放及另获授权单题实测。本次不改作图代码、不发DS；旧真实GK-S09仍是2次请求无候选，35题未测，原因待回执定责。


## 2026-11-18 —— GK-S09 真实DS失败研究写入F9修复计划（文档，未新调用）

基于[纯文字题单题实测](audit/2026-11-17-g3-f9-text-only-pilot/README.md)记录的两次 `construct_solid`、无候选、**动作回执码缺失**，在[F9修复计划的Task 6–9](g3-final/G3-F9-kernel-action-repair-plan.md)补齐执行回执的脱敏观测、模型可见参数合同、`a>0` 符号示意和派生外接球能力、零费合同/证书闭环及下一轮受控复测。两次具体动作失败原因仍未知，不把接口风险写成已证实根因。本次仅文档，新增付费DS请求0次；F9真实36题与产品发布均未完成。

## 2026-11-17 —— 当前版真实 DS 纯文字试点：GK-S09两次构造请求但无候选

固定提交`89b00bcd`，零费用从当前源码重新打包复核立体构造19/21/15图元，定向86项通过；随后对 `inputMode=text_only` 的 GK-S09 用原生DeepSeek `ds_action` 发出**2次真实请求**（两次 `construct_solid`），没有候选，合同未通过；其余35题未测，证书/真实渲染/隔离提交未运行。usage输入3466/输出194 tokens，实际账单金额未知。当前入口未记录具体工具回执blockerCode，不能判定是模型参数还是内核拒绝；按首题失败即停，下一步先零费补脱敏动作回执与条件化三棱柱/外接球能力诊断。[逐题审计](audit/2026-11-17-g3-f9-text-only-pilot/README.md)。G3-DS未退出，不冒充36题实测成功率。

## 2026-11-17 —— F9 当前版零费复核通过，真实DS首题澄清后停批

在 `bff4d0eb` 当前源码重新打包测试，方锥/三棱柱/四面体构造分别产生19/21/15图元，旧 `accepted/0` 失效缺陷未复现；定向86/86、GK-S08录制回放1通过。随后GK-S08走原生 `ds_action` **1次真实请求**（输入1560、输出184 tokens，实际费用未知），模型首轮调用 `request_clarification`，未产生候选、未进入证书/真实DS画布/交付。该题为 `text_with_figure_reference`，本轮仅提交纯文字、无用户核对题图；澄清原因尚不能确定。按熔断其余35题未测，**不可称为当前36题0/36**。见[复测审计](audit/2026-11-17-g3-f9-current-retest/README.md)。本轮不自动扩大付费范围；G3-DS仍未退出。

## 2026-11-18 —— G3-F9 内核动作修复 **Task 0–5 零付费门禁全部完成**（0 新增付费；停在付费重授权闸口）

- **`G3-F9 Task 5`（0 付费全量端到端与发布门禁收口）已完成（0 新增付费）**：在 [g3DsFrozenCaseRunner.ts](../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) 将 `weldAutoGeneratedFaceVertices` 扩展至 `solid-\d+:v\d+` 并补全 [g3DsFrozenCaseRunner.test.ts](../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts) 的 `GK-S08`（`construct_point -> construct_solid -> query_measurement -> finish_candidate`）完整 `ds_action` 回放；**最后一次代码修改后**实测全通过：`npm test`（`557` 文件 `5883 passed | 1 todo`）、`typecheck`（退出 `0`）、`lint`（`0 errors`）与 Playwright E2E（`41 passed`，`0` 重试，详见 [Task 5 零付费审计](./audit/g3-f9-repair-t5-zero-cost/README.md)）。
- **明确诚实边界**：Task 0–5 全程 **0 新增付费 DeepSeek API 调用**；旧版本 `edacbf89` 上 `GK-S08` 的 `8 req` 试飞仍为 `0` 候选历史失败记录，其余 `35` 题仍未在修复后实测，`humanReviewed` 与 Windows UIA 仍保持 `pending`，现停待用户就锁定修订 + `GK-S08` 单题/上限明确批复。
- **`G3-F9 Task 4`（Live 多范围 / 多状态 / 多分支 `CandidateSet` 接线）已完成（0 新增付费）**：[coordinatorPorts.ts](../packages/agent-core/src/coordinatorPorts.ts)、[dsActionTools.ts](../apps/web/src/agent/dsActionTools.ts)、[modelPlanner.ts](../apps/web/src/agent/modelPlanner.ts)、[g3DsFrozenCaseRunner.ts](../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) 与 [drawingContracts.ts](../scripts/reliability-eval/drawingContracts.ts) 已打通 `ds_action` 分支画布隔离、`PlanOutcome.candidateSlices` 回传、开放折面 `buildOpenSurface` 拓扑核验及 `before_fold/after_fold` 独立证书认证（`g3DsFrozenCaseRunner.test.ts` + `dsActionTools.test.ts` + `modelPlanner.test.ts` + `drawingContracts.test.ts` **`4` 文件 `131 passed`**，`typecheck` 退出 `0`，`lint` `0 errors`，详见 [Task 4 审计报告](./audit/g3-f9-repair-t4/README.md)）。
- **`G3-F9 Task 3`（有界修复停滞保护与预算不双扣）已完成（0 新增付费）**：在 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 为每条动作回执附带 `toolName` + `progressSignature`，在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 精准区分“无进展连续相同签名（`<=2` 次熔断）”与“合法修复推进”，并消除 `beforeProviderRequest` 与 `ds_action` 内部 `network` 预算双扣。实测 `3` 文件 **`83 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task 3 审计](audit/g3-f9-repair-t3/README.md)，**下一步进入 Task 4（Live 多问 / 多状态 / 多分支 `CandidateSet` 接线）**。

- **`G3-F9 Task 2`（面/底座/折叠动作与真实内核读数）已完成（0 新增付费）**：在 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 落地 `construct_base`、`construct_face`、`construct_fold_state`、3D `construct_point` / `construct_segment` 及真实只读 `query_measurement`、`query_constraint_status`（同步支持 `rollback` 点表/切片清理，共线/非共面/退化折叠均拒绝，且 22 项 `DS_ACTION_CLOSED_SET` 已全数具备真实内核或受控只读实现）。实测 `4` 文件 **`27 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task 2 审计](audit/g3-f9-repair-t2/README.md)。

- **`G3-F9 Task 1`（`construct_solid` 经 `solveConstraint3d` 真实写入）已完成（0 新增付费）**：在 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 完成 `regular_pyramid`、`prism`、`perpendicular_pyramid` 与 `tetrahedron` 到 `solveConstraint3d` → `solid.create_polyhedron` → `SpeculativeCanvas.applyAction` 真实执行并维护 3D 顶点注册/回滚栈；实测 `3` 文件 **`17 passed`**、[solidContracts18.test.ts](scripts/reliability-eval/solidContracts18.test.ts) **`23 passed`**；入档 [Task 1 审计](audit/g3-f9-repair-t1/README.md)。

- **`G3-F9 Task 0`（工具状态真实性闸 + 无进展停机）已完成（0 新增付费）**：按 [修复计划](g3-final/G3-F9-kernel-action-repair-plan.md) 在 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 移除末尾默认 `accepted` 兜底并新增 `stateChanged` 与 `IMPLEMENTED_DS_ACTION_TOOLS` 工具发布过滤（未落地立体/面/折叠/查询动作统一返回 `blocked / unsupported_action`），在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 加入无进展 `no_progress` 及时停机。`dsActionTools.test.ts` 与 `modelPlanner.test.ts` 共 **`2` 文件 `75 passed`**（覆盖三族 `construct_solid` / `construct_face` 零费复现反例）、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task 0 审计](audit/g3-f9-repair-t0/README.md)。真实 DS 仍未重测（`GK-S08` 此前 8 请求试点无候选，其余 35 题未测）。

## 2026-11-17 —— F9三组零费用复测及新修复计划（真实DS未再调用）

当前修订 `0267dd61` 未修复立体动作假成功。三组不同形状的零付费内核复现均观察到 `construct_solid accepted/0 → construct_face accepted/0 → finish_candidate empty_candidate`，所以本轮**新增DS付费请求0次**，不把这三次称为“DS真实模型复测”；此前首题8次真实调用仍保留原报告。新增[针对性修复计划](g3-final/G3-F9-kernel-action-repair-plan.md)：先将虚假 accepted fail-closed，再接已有三维约束求解器、实现真实测量与停滞检测、最后打通live多状态CandidateSet，修复后重新授权单题真实回归。证据见[三组零费复现](audit/2026-11-17-g3-f9-repeat-probe/README.md)。F9、36题、人工/Windows门禁均未退出。

## 2026-11-17 —— F9 `ds_action` 首题真实试点失败，立体构造假成功（停止扩批）

用户确认沿用最多5美元/108次总请求，并将单题上限从3次改为8次。零费用验证 `dsActionTools` 与冻结题CandidateSet测试 **8/8**；原生干跑证明首轮发布动作级工具，不再用 `ds_intent`。仅对GK-S08发出**8次真实DS请求**（8条usage，输入17104/输出631 tokens），模型按顺序调用 `construct_solid` 等动作，最终 `finish_candidate` 前没有任何图元，`internal_budget` 停止，未进入数学合同/证书/画布验收；**其他35题未测，不是“F9 0/36”**。零费用内核探针证实 `construct_solid` 与 `construct_face` 返回 `accepted` 却均生成0图元，随后 `finish_candidate` 以 `empty_candidate` 拒绝；这是动作工具实现缺口，不能靠加请求修复。实际账单未知，停止剩余额度的付费调用；详见[首题真实试点审计](audit/2026-11-17-g3-f9-ds-action-pilot/README.md)。G3-DS与发布仍未退出。

## 2026-11-17 —— F9 新授权零费用接线复核：真实调用暂停

用户同意沿用最多5美元/108请求/单题3次，本轮**新增真实DS请求0次**。定向单测3文件78项通过，但 `ds_action` 正例最简单“两点一线段+finish”需4次模型响应，现有单题3次无法完成；冻结题runner的真实 `PlannerPort` 路径仍只产 `shared` 单候选，未闭环多状态/多分支。故未启动新一轮付费测试，也不能说F9新架构成功率已测；先零费接线、再确认单题上限方案，见[门禁审计](audit/2026-11-17-g3-f9-zero-cost-gate/README.md)。历史旧路由4题10请求不属于本轮授权的调用。
## 2026-11-17 —— F9 入场误用旧路由，四题后停止（F9 未完成）

本轮用户要求进入 F9，但临时实测入口错误地强制使用旧 `ds_intent`，而非 F2 新增 `ds_action`；真实调用4题10请求（9条usage，输入26627/输出19113 tokens），旧路径下完整合同0/4、1 partial、3 failed，尚未测另外32题，也未验证F9多状态真实候选/同候选浏览器交付。本轮未获得新的明确美元额度却沿用了已用尽的旧5美元预算，这是授权失误；发现后立即停批，绝不继续付费。真实平台账单未知。**不得把这个0/4写成新架构F9成绩；F9仍未测、G3-DS仍未退出。** 详见[误路由审计](audit/2026-11-17-g3-f9-route-mismatch/README.md)。下一步先零费验证F9入口确实启用动作级工具与多状态评分，再取得新的金额/请求授权。

## 2026-11-18 —— G3-DS 最终版实施（混合 B→C 路线）：**Task F0–F8 全部工程完结**（0 新增付费；真实 DS 仍 0/36；等待 Task F9 付费授权）

- **`Task F8`（真实画布交付一致与全仓终态回归）已完成（0 付费）**：在 [dsCandidateBundle.ts](packages/agent-core/src/dsCandidateBundle.ts) 与 [canvasEvidence.ts](apps/web/src/canvasEvidence.ts) 补齐 `speculativeOnly` 阻断、`screenshotCandidateHash` / `data-candidate-hash` 校验，并在 [drawing-reliability-36-render.spec.ts](e2e/drawing-reliability-36-render.spec.ts) 与 [drawing-reliability-lifecycle.spec.ts](e2e/drawing-reliability-lifecycle.spec.ts) 绑定全链同哈希断言。终态实测全过：`npm test` **`557` 文件 / `5875 passed | 1 todo`**、`typecheck` 退出 `0`、`lint` **`0 errors`**、`test:rust` 全过、`Playwright` **`41 passed`**（`0` 重试、`bridge_replay_passed`）与 `test:docs` 全过；入档 [Task F8 审计](audit/g3-final-f8/README.md)。
- **下一阶段唯一入口**：按 [G3-DS 最终版实施档案](g3-final/G3-DS-final-implementation-dossier.md) §12 申请 **Task F9（分层真实 DeepSeek 复测：Tier A→B→C）** 独立付费授权；未经授权不发起任何线上付费调用，真实 DS 仍记 `0/36`，`humanReviewed` 与 Windows 实机窗口签收仍保持阻断发布。

- **`Task F7`（定向局部修复闭环 `repairProgress`）已完成（0 付费）**：新建 [repairProgress.ts](packages/agent-core/src/repairProgress.ts) 与 [repairProgress.test.ts](packages/agent-core/src/repairProgress.test.ts)，锁定待修实体/约束与 `preservedObligationIds` 保护边界并强制单调进步停机；已在 [runState.ts](packages/agent-core/src/runState.ts)、[coordinatorPorts.ts](packages/agent-core/src/coordinatorPorts.ts)、[coordinator.ts](packages/agent-core/src/coordinator.ts)、[modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 与 [index.ts](packages/agent-core/src/index.ts) 完成全链路接线。`4` 文件 **`154 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F7 审计](audit/g3-final-f7/README.md)。

- **`Task F6`（折叠多状态分支谱系与统一候选评估）已完成（0 付费）**：在 [foldChain.ts](packages/agent-core/src/foldChain.ts) 新增镜像折叠 `foldMirrorPairAboutHinge`、折叠谱系 `buildFoldStateLineage` 与防哈希复用检验 `verifyFoldStateHashesDistinct`；在 [g3DsFrozenCaseRunner.ts](apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) 导出 `evaluateFrozenCandidateSet` 统一 Live 与 Offline 的 `CandidateSet` + `PolicyEvaluation` 路径，为 `pre_fold`/`post_fold`/分支各自绑定独立 `lineageKey` + `documentHash` + `candidateHash` 并阻断跨状态哈希碰撞。`4` 文件 **`27 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F6 审计](audit/g3-final-f6/README.md)。

- **`Task F5`（三维约束内核求解器 `constraintSolve3d`）已完成（0 付费）**：在 [constraints3d.ts](packages/geometry-kernel/src/constraints3d.ts) 与 [measurements3d.ts](packages/geometry-kernel/src/measurements3d.ts) 新增线面/面面关系、共面校验、3D 垂足投影与有向半边闭合拓扑校验 `verifyClosedPolyhedronTopology3`；新建 [constraintSolve3d.ts](packages/agent-core/src/solver/constraintSolve3d.ts) 与 [constraintSolve3d.test.ts](packages/agent-core/src/solver/constraintSolve3d.test.ts)（覆盖棱柱/棱锥/四面体/垂足/线面/面面/共面/闭合拓扑/内点定比及缺面/非共面反例），在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 收拢空间垂足与棱比例计算并导出至 [index.ts](packages/agent-core/src/index.ts)。`4` 文件 **`35 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F5 审计](audit/g3-final-f5/README.md)。

- **`Task F4`（二维与函数内核求解器 `constraintSolve2d`）已完成（0 付费）**：在 [planar-constraints.ts](packages/geometry-kernel/src/planar-constraints.ts) 与 [function-evidence.ts](packages/geometry-kernel/src/function-evidence.ts) 新增纯粹二维关系/定比/定义域证据辅助；新建 [constraintSolve2d.ts](packages/agent-core/src/solver/constraintSolve2d.ts) 与 [constraintSolve2d.test.ts](packages/agent-core/src/solver/constraintSolve2d.test.ts) 统一返回 `{ status, roots, selectedBranch, residual, domainStatus, constraintStatus }` 并覆盖平面约束、四类圆锥曲线-直线交点与焦点/离心率、函数定义域与切线/外点切线/公切线及无解退化反例；接入 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 并导出至 [index.ts](packages/agent-core/src/index.ts)。`4` 文件 **`93 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F4 审计](audit/g3-final-f4/README.md)。

- **`Task F3`（实体图 `EntityGraph`、约束图 `ConstraintGraph` 与三态观察）已完成（0 付费）**：新建 [entityGraph.ts](packages/agent-core/src/entityGraph.ts)、[constraintGraph.ts](packages/agent-core/src/constraintGraph.ts)、[kernelObservation.ts](packages/agent-core/src/kernelObservation.ts) 及单测 [entityGraph.test.ts](packages/agent-core/src/entityGraph.test.ts)、[constraintGraph.test.ts](packages/agent-core/src/constraintGraph.test.ts)，并在 [obligationIR.ts](packages/agent-core/src/obligationIR.ts)（`buildConstraintGraphFromObligationIR`）、[dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts)（`classifyDsIntentTriState`）与 [index.ts](packages/agent-core/src/index.ts) 完成导出接线，实现可序列化实体/约束依赖图、作用域继承裁定、待求参数表（区分方程可解与无依据缺失）与三态观察摘要；`4` 文件 **`33 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F3 审计](audit/g3-final-f3/README.md)。

- **`Task F2`（动作级 DS ToolSpec `dsActionTools.ts`）已完成（0 付费）**：在 [actionRegistry.ts](packages/agent-core/src/actionRegistry.ts) 导出 22 项动作闭集 `DS_ACTION_CLOSED_SET`（`declare_entity` … `finish_candidate` / `request_clarification`），新建 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 与 [dsActionTools.test.ts](apps/web/src/agent/dsActionTools.test.ts)（基于 `SpeculativeCanvas` 的单动作逐步构造、三态反馈 `accepted`/`repairable`/`blocked`、严禁立体手算顶点）；在 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts)（`mathcanvas.ds_action.prompt.v1`）、[modelToolPolicy.ts](apps/web/src/agent/modelToolPolicy.ts) 与 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 接入 `intentMode: "ds_action"` 多轮单动作闭环，校验重复 `toolCallId`、混合批与取消信号并保留 `ds_intent` / `legacy_actions` 兼容。`4` 文件 **`110 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F2 审计](audit/g3-final-f2/README.md)。
- **`Task F1`（探索候选隔离层 `speculativeCanvas.ts`）已完成（`15be4dfc`，0 付费）**：见 [Task F1 审计](audit/g3-final-f1/README.md)（`3` 文件 `47 passed`、`speculativeOnly` 阻断未晋升写入主画布）。
- **`Task F0`（冻结 `92981ebd` 真实 36 题失败真源）已完成（`f118c721`，0 付费）**：见 [2026-11-17-92981 基线记录](g3-final/retests/2026-11-17-92981/README.md)（36/36 全量首失败边界归因，`unknown = 0`，`mixed_read_plan = 0`）。

## 2026-11-17 —— 当前提交 `92981ebd` 真实 DS 36题再测：完整合同仍0/36

经用户新一轮最多5美元/冻结36题授权，原生 `deepseek-v4-flash` 强制 `ds_intent` 路线跑完36/36题，77次请求（≤108，单题≤3），76次有usage，记录输入211368/输出140132 tokens，**实际费用未知**。独立完整合同 **0/36**、1 partial（GK-S05）、35 failed；非空候选2题（GK-S05、GK-P09），其余34题无候选；原先7题的读场景与提交计划同批冲突本轮**0次**，但实体引用/必要参数/格式不合规阻断了大部分规划。数学与证书均未通过者不计入DS真实浏览器/受控交付，本轮二者**未测**。旧确定性36/36不能顶替，G3-DS仍未退出；用户/教师人工可读性与Windows实机仍待签。逐题/口径见[本轮审计](audit/2026-11-17-g3-ds-live-retest-92981/README.md)。本轮额度已用，不自动追加请求。

## 2026-11-17 —— G3-DS 失败驱动实施：**Task 0–Task 5 完成 + Task 6 前置零付费加固完成（等待 Task 6 付费授权）**（真实成绩仍 0/36）

- **零付费加固轮（[加固审计](audit/g3-ds-failure-driven-hardening/README.md)，0 付费）**：依据 DS5 失败模式与运行器接口联调排查并修复三批实际缺陷——① 将 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts) 升级至 `mathcanvas.ds_intent.prompt.v2`（修正 `ds_intent` 工具指引误推 `kind` 的冲突并补全 8 类策略 `params` 速查）并在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 补齐 `buildDsIntentToolSchema` 节点字段；② 修复 [g3DsFrozenCaseRunner.ts](apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) 对接 `PlannerPort` 时缺失 `plan.set_plan` / `AbortSignal` / `conversation` 必崩缺陷，并落地 `evaluateTask6LivePreflight` 与 `aggregateTask6FunnelReport` 预算/熔断门禁；③ 扩展 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts)（`common_tangent` 与源绑定 `tangent_at_x` 产出 `function.create_tangent`、`perpendicular_through_point`/`parallel_through_point`、缩放方程如 `4x^2+9y^2=36`、多动点 `solid_fold_along_hinge` 旋转，以及任一步骤未解出图元时的 `unresolved_construction` fail-closed 拦截）。全仓 `npm test`（`550` 文件 **`5850 passed | 1 todo`**）、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；**仍严格停在 Task 6 之前等待用户显式付费授权**。
- **`Task 5`（同版候选浏览器渲染与隔离受控交付门禁，零付费桥接）已完成（`b776d609`，0 付费）**：见 [Task 5 审计](audit/g3-ds-failure-driven-t5/README.md)（Playwright 零重试 `41 passed`、`test:rust` exit `0`、`manifest.json` 保守标 `bridge_replay_passed` 与 `humanReviewed: pending`）。
- **`Task 4`（多问/多状态/多分支同版评测入口 `g3DsFrozenCaseRunner.ts`）已完成（0 付费）**：见 [Task 4 审计](audit/g3-ds-failure-driven-t4/README.md)（`332d8e47`，`3` 文件 `65 passed`）。
- **`Task 3`（26 零候选与 10 错误候选失败签名能力族补齐）已完成（`375bb194`，0 付费回放）**：在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 补齐 `resolveConicFromEquation`（标准圆/抛物线/椭圆/双曲线方程直解）、`planar_point_on_host` 的正交 `conic_vertex` 与 `other_line_conic_intersection`（剔除已知重合交点，求解 `GK-P03`/`JT-P02` 类另一交点且退化不造点）、实体 `id/label` 全链路双注册及立体 `vertexNames` 作用域预登记（求解 `GK-S05` 类棱柱棱比与线段连接）；在 [dsDrawingIntent.test.ts](packages/agent-core/src/dsDrawingIntent.test.ts) 完成改名变体测试，在 [drawingCertificate.test.ts](packages/agent-core/src/verification/drawingCertificate.test.ts) 补齐 `GK-P08` `objCov=1, obCov=0` 表面齐全反例。证据见 [Task 3 审计](audit/g3-ds-failure-driven-t3/README.md)。
- **`Task 2`（施工单数学参数来源与编译 fail-closed `validateRequiredParameters`）已完成（`524b92f2`，0 付费调用）**：在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 新增并导出 `validateRequiredParameters`，取消 `function_curve_and_tangent` 中缺失 `expression`/`x0`/`domain` 时偷偷代用 `"x"`/`0`/`[-5,5]` 的旁路，强制要求参数来源并拒为 `missing_required_parameter` / `unproven_parameter` / `unsupported_construction`；`compileDsDrawingIntentToPlan` 遇到 `!dag.ok`（`cyclic_dependency`/`missing_host`/`cross_scope_violation`）或参数校验失败直接 fail-closed 拒出动作（不再退回未排序原顺序），同步更新 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts) 提示策略。证据见 [Task 2 审计](audit/g3-ds-failure-driven-t2/README.md)。
- **`Task 1`（空场景构造与已有场景观察分流 `modelToolPolicy.ts`）已完成（`3a803541`，0 付费调用）**：新增 [modelToolPolicy.ts](apps/web/src/agent/modelToolPolicy.ts) 并在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 与 [agentRunner.ts](apps/web/src/agent/agentRunner.ts) 接入互斥分阶段工具发布（由真实文档图元/选区/句柄判断，非题号路由）：`ds_intent` 空场景首轮只发 `plan_set_plan` 不附 `scene_inspect`；已有几何或选区首轮只发只读工具、回传后才切 `construct`，旧混合批次原子拒绝与取消/零预算/重复 `callId` fail-closed 全数保持。证据见 [Task 1 审计](audit/g3-ds-failure-driven-t1/README.md)。
- **`Task 0`（`G3CaseTrace` 阶段码、结构化诊断出口与输入审计）已完成（`6747fb72`，0 付费调用）**：新增 [g3DsCaseTrace.ts](apps/web/src/agent/fixtures/g3DsCaseTrace.ts)（`G3Boundary` 闭集、`recordBoundary` 保留首失败、`explainFirstFailure` 无证据报 `"unknown"`、`serializeG3CaseTrace` 拒绝 `prompt`/`apiKey`/`toolInput` 泄漏、`auditInputFigureDependency` 对 R4 四道缺图题 `GK-S02/GK-S03/JT-S06/JT-S07` 标记 `input_figure_missing` 阻断完整通过而不改分母 `36`），在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 接入 `onStructuredDiagnostic`，在 [examRunCoordinated.ts](apps/web/src/agent/fixtures/examRunCoordinated.ts) 接入可选脱敏 `onTrace`；基于历史 [DS5 36 题脱敏基线](audit/2026-11-17-g3-ds5-live-36/summary.json) 建立阶段覆盖表（`7` 题 `tool_protocol/mixed_read_plan`、`10` 题达 `verification`、`19` 题诚实标 `unknown`）。证据见 [Task 0 审计](audit/g3-ds-failure-driven-t0/README.md)。

## 2026-11-17 —— G3-DS 失败驱动升级设计入档（仅方案，真实成绩仍0/36）

基于当前修订 `f7cc9b76` 的[强制DS冻结36题实测](audit/2026-11-17-g3-ds5-live-36/README.md)，确定[升级设计](superpowers/specs/2026-11-17-g3-ds-failure-driven-design.md)和[新实施计划](superpowers/plans/2026-11-17-g3-ds-failure-driven-implementation-plan.md)为下一轮 G3-DS 执行入口：先记录可负责的失败边界，再修7题已证实的混合工具冲突，按26题零候选（立体17、平面9）和10题不完整候选修通用能力，最后对齐多状态口径与真实画布/交付。**本次只是设计/文档更新，没有作图代码修复或新增付费模型请求；最新真实DS完整合同仍0/36，G3-DS与发布未退出。** 旧DS0–DS4的离线/回放工程退出与当前真实DS成绩不合并；付费复测需重新授权预算，不能沿用前两轮。 另外 `GK-S02/GK-S03/JT-S06/JT-S07` 在R4原审计中仍是未获题图证实的 `text_with_figure_reference` 输入；若必须题图才能唯一构造，需用户确认题图或诚实澄清，不能拿纯文字假定36/36。
## 2026-11-17 —— 当前版本冻结36题 DS 原生实测：完整合同 0/36（否定性）

用户明确要求再次完整实测36题；沿用最多5美元上限，本轮强制 DS `ds_intent` 规划、绕过默认确定性优先路由，**36/36题已跑**，实际原生请求 **93/108**（每题≤3），记录 usage 输入 **211766** / 输出 **105984** tokens（91/93请求报告 usage），实际账单金额未知。完整合同 **0/36**、`partial=3`、`failed=33`，10题非空候选、26题无候选；9个候选 `verification=not_supported`、1个 `failed`，全体终态 `failed`、主画布0写入。至少7题同一批次返回只读场景工具与 `plan_set_plan` 被现有协议显式拒绝；28题用到单题3次额度但不能据此推断加重试有效。**本轮DS候选未达数学闸，未进行其逐题真实渲染或受控提交；G3-DS保持未退出，完整36题实测授权已消耗，不自动追加请求。** 脱敏逐题见[本轮审计](audit/2026-11-17-g3-ds5-live-36/README.md)。旧离线36/36与旧DS2/36是不同路径/版本，不覆盖本轮结果。
## 2026-11-17 —— DS5 已获授权的4题真实模型预检（0/4，整批未授权）

当前版本 `453821af` 在用户最多5美元授权下，原生保存的 `deepseek-v4-flash` 串行调用 **4/4 次**（每题最多1次），输入7793、输出395 tokens，费用真实账单未知；4题 `GK-S08/GK-S02/GK-S01/JT-S07` 均无非空候选、完整合同 **0/4**，主画布0写入。至少3题收到 `tool_calls` 终止；本轮一题只允许1次请求，不能外推多步工具环真实通过率或称端到端验收已完成。证据见[DS5 否定性预检](audit/2026-11-17-g3-ds5-live-preflight/README.md)。**4次请求已用完，不再自动追加；完整36题未调用、未获单独授权，G3-DS保持未退出。**

## 2026-11-16（America/Los_Angeles）—— 新增 G3-DS 实测主线（`DS0–DS4` 已完成，0 新增付费调用；已停在 `DS5` 付费授权门禁前）

用户将 G3 后续目标改为**保存的 DS 实际参与冻结36题端到端作图36/36**，不再用离线确定性通过率作为DS成功率；[G3-DS 实施计划](superpowers/plans/2026-11-16-g3-ds-live-upgrade-plan.md)分 DS0–DS5。历史强制DS规划实测（`06648346`，`deepseek-v4-flash`，0 新增付费请求）：完整合同 **2/36**（`GK-S08`、`GK-S09`；平面0/18、立体2/18），21 partial、13 failed、23有非空候选；`confirmable=4` 含 **2 例生产假阳性（`GK-P09` `obCov=0.00`、`JT-P09` `obCov=0.23`）**；另 `JT-S07`/`JT-S09` 合同覆盖全满（`1.00/1.00`）却被判 `not_supported`，`JT-S04` 停在 `terminal="waiting"`，且 5 题 `partial` + `JT-S09` 在 `req=1` 即死于 `validating` 无修复环；80次请求（单次上下文约 `67.5–69.8 KB`），报告 usage 输入1,724,928/输出66,549 tokens，费用未知；主画布0写入。

- **`DS0`（真实基线、脱敏账本与边界定位）已完成（`4ecbff24`，0 付费调用）**：新增 [dsLiveBaseline.ts](packages/agent-core/src/verification/dsLiveBaseline.ts) 严格脱敏汇总与防泄漏守卫、`examRunCoordinated` / `drawingContracts` 边界诊断辅助，并归档脱敏证据 [DS0 脱敏基线与边界定位](audit/2026-11-16-g3-ds-live-baseline/README.md) 与 [cases.json](audit/2026-11-16-g3-ds-live-baseline/cases.json)。
- **`DS1`（紧凑结构化施工单 `DsDrawingIntent` + 提示词瘦身 + 正交构造 DAG）已完成（`4c312268`，0 付费调用）**：新增 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts)（8 类正交策略直连内核求解器，禁止手算立体顶点、拒绝跨 scope/未声明引用/无来源常数、缺失题图自动澄清），在 [drawingIntent.ts](packages/agent-core/src/drawingIntent.ts) 注册 `ds.*` 算子、在 [obligationIR.ts](packages/agent-core/src/obligationIR.ts) 增加 `irClauseSummaryForPrompt`、并在 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts) / [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 落地紧凑 `ds_intent` 模式。证据见 [DS1 结构化施工单审计](audit/2026-11-17-g3-ds1-intent/README.md)。
- **`DS2`（4 类几何义务族正交求解与作用域隔离）已完成（`4aa6b570`，0 付费调用）**：在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 补齐圆锥曲线焦点/离心率求参、直线与圆锥曲线交点/切线、过曲线外点切线（数值求根+Symbolic Derivative）、四边形 `AD⊥DC` 四棱锥底座、线/面垂足连线及 `resolveAllowedScopes` / `compileDsDrawingIntentByScope` 分作用域编译。证据见 [DS2 义务族求解审计](audit/2026-11-17-g3-ds2-partial-families/README.md)。
- **`DS3`（生产证书双向真伪修复与 `validating` 有界修复环）已完成（`a9a3b898` + 本轮全量回归收敛，0 付费调用）**：在 [draftStore.ts](apps/web/src/agent/draftStore.ts) 封堵空 `prompt: ""` 证书旁路；在 [drawingCertificate.ts](packages/agent-core/src/verification/drawingCertificate.ts) 输出 `failedObligations`/`missingEntities`/`unresolvedClauses`/`candidateHash` 并拦截函数切线缺失与圆内最长/最短弦假阳性；在 [diagramObligations.ts](packages/agent-core/src/diagramObligations.ts) 与 [diagramVerification.ts](packages/agent-core/src/diagramVerification.ts) 修复 `JT-S07` 与 `JT-S09` 假阴性；在 [coordinator.ts](packages/agent-core/src/coordinator.ts)、[runState.ts](packages/agent-core/src/runState.ts) 与 [committerAdapter.ts](packages/agent-core/src/committerAdapter.ts) 打通有界 `validating -> repair` 环，并完成全量单测回归收敛。证据见 [DS3 生产证书与有界修复审计](audit/2026-11-17-g3-ds3-certificate-repair/README.md)。
- **`DS4`（同候选真实浏览器渲染、冻结复播工件与隔离工作区受控交付）已完成（0 付费调用）**：新增 [dsCandidateBundle.ts](packages/agent-core/src/dsCandidateBundle.ts)（`mathcanvas.ds_candidate_bundle.v1`）绑定 `{ runId, candidateHash, documentHash, cameraHash, viewportHash }` 与可复播桥接校验；在 [canvasEvidence.ts](apps/web/src/canvasEvidence.ts) 与 [ConfirmationPanel.tsx](apps/web/src/components/agent/ConfirmationPanel.tsx) 暴露 DOM hash 链；扩展 [drawing-reliability-36-render.spec.ts](e2e/drawing-reliability-36-render.spec.ts) 与 [drawing-reliability-lifecycle.spec.ts](e2e/drawing-reliability-lifecycle.spec.ts)。最终编辑后实测：**全量 Vitest `547` 文件 / `5824 passed | 1 todo`**、`typecheck`/`lint`（`0 errors, 34 warnings`）/`test:rust` 全过、`@draw/desktop` `no-bundle` 构建出 `mathcanvas-desktop.exe`（SHA-256 `46EF3F1E0812E1B3CD66B8D7DA72035592598F78FF5DFAC6A0E9CD5042AD7BA5`）、串行 Playwright **`40 passed`**（36 题同候选渲染 + 负例/受控交付，`warnCases=25`，`humanReviewed="pending"`，`dsLiveAuthorizedRun="pending_authorization"`）。证据见 [DS4 渲染与受控交付审计](audit/2026-11-17-g3-ds4-render-delivery/README.md)；**停在 `DS5` 付费实测授权门禁前**。
- **授权边界不变**：**已有36题调用不构成新一轮付费调用授权**，`DS5` 预检和整批均须用户先明确批准模型/题集、请求/token/费用上限及停止条件；用户/教师人工可读性与非沙盒 Windows 桌面窗口 UIA 仍是独立阻断，禁止宣称 G3-DS 或 G3 整体完成。

最后更新：2026-11-18；产品版本：v4.3.0；产品代码基线：59ea36133c47971f4252e71f7a0f5ba003dd1028。

## 2026-11-17 —— G3 渲染工程收尾（自动化通过，人工验收未关闭）

> 本节日期按执行主机记录；America/Los_Angeles 对应2026-11-16。实时结论：**G3-Math 保持已退出；T15 浏览器渲染自动化区块已验，但 G3-UX 尚待用户/教师逐题可读性及Windows桌面实机窗口签收，禁止写成G3整体完成或产品发布。**

- 冻结36题同候选真实浏览器渲染：**36/36**，单worker零重试；本轮全量浏览器首轮 **321/327**，查明并修复球体在3D对象索引缺失导致 empty_canvas/确认被拒，纠正3条过时的3D partial断言（改为验证真实对象盒及候选hash），将棱柱拖动用例定位到实体面内；最终完整E2E **327/327**，零重试。此前6项失败记录不删除。[36题渲染证据与回归复盘](audit/2026-11-17-g3-render-exit/README.md)。
- 单测：**544文件、5799通过、1 todo、0失败**；定向3D同步14项、类型检查、文档22项和Lint 0 error。同期桌面 `no-bundle` 构建退出0，可执行文件 SHA-256 `1cc02c296ec7fa0cf58e5cf943035e9d6fcf47396839427850fcdff003e7e983`；这不是窗口UIA或安装包验收。Lint仍有34条未使用警告（含隔离worktree重复扫描），不写0 warning。
- **视觉限制**：36张截图均有可测对象且无错误级诊断，但25题有警告（clipped_object 27次、tiny_object 26次）；自动状态 passed 允许warning，不等于所有曲线/点名均达到人类可读标准。[逐题审阅包](audit/2026-11-17-g3-render-exit/index.html)中 humanReviewed 仍 pending，AI抽检不可冒充教师签名。
- 本区块只用离线/确定性真实浏览器路径，**未调用已保存的DS模型**。按需使用真实模型前应固定请求/费用上限，并与先前用户“后续自己测”的保留安排核对；未授权的正式发布与P8均不启动。

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
| 功能实施 | R00/R01-A/R09-A/R10、G1（R02–R06）及G2（R07、R08、R09-B、R11）已完成；`B4`（`T01–T14`）、`T15`、`T01` 终审（R4）、Task 2 完整证书接线、Task 3/4 **`G3-Math`（36/36）** 及 **Task 6（`T16` 生命周期 + 290/290 Playwright + desktop `no-bundle` 构建）** 已完成；按用户指示**保留 DeepSeek 真实模型画图测试由用户后续执行**，交互式桌面窗口 UIA 与人工可读性签收/`P8` 仍未关闭，产品禁止发布 |

版本治理详见[main重启记录](audit/2026-11-15-main-restart/README.md)。前一轮探针仅确认缺陷，不是修复GREEN。

- **真实候选渲染与确认链续作已闭环**：确认前 2D 完整候选、3D Three.js 实际对象投影、Agent 页同候选预览及 consent/commit `rendered` 证据已接通；修复 remembered camera 初始出界。最终全量 Vitest **544 文件 / 5796 passed + 1 todo**、目标 Playwright **5/5**、类型检查、Lint（0 errors）与 Web 构建通过。证据：[真实候选渲染与确认链](audit/2026-11-17-g3-candidate-render/README.md)。36 题审阅包、桌面 UIA、人工 `humanReviewed` 与最终独立复核仍待完成。

- **Task 6（`T16` 对话作图全生命周期）与 G3 最终全量回归已收口（290/290 Playwright + 5794 Vitest）**：新增 [drawing-reliability-lifecycle.spec.ts](e2e/drawing-reliability-lifecycle.spec.ts)，曝光并修复 [AgentMessageList.tsx](apps/web/src/components/agent/AgentMessageList.tsx) 点击“丢弃草稿”或“确认并提交”后确认面板仍保留操作按钮的真实缺陷（`AgentPieces.test.tsx` 9/9 通过），同步修正 `planarDrawing.ts` 符号参数不变量分流与 `functionDrawingPlan.ts` 原文公式保留。最后一次代码编辑后：`npm run typecheck` exit 0、`npm run lint` 0 errors、`@draw/desktop` `no-bundle` 构建出 `mathcanvas-desktop.exe`（SHA-256 `826c6fc34b7bde2d23ff4620aa8e5ece6ca41630bbc361258585d901d91b9b0c`）、`eval:reliability -- --offline` 冒烟 **31/31**、36 题 **36/36**（覆盖率 1.0、`liveWrites=0`）、全量 Vitest **543 文件 / 5794 passed + 1 todo**、`npm run test:rust` 0 failed、全量串行 Playwright **290/290 passed**。**诚实边界**：用户明确要求保留已保存 DeepSeek 实测待其后续执行；当前沙盒窗口站隔离（`ENUM_TOTAL=0`）无法自动化操作桌面窗口；教师/用户人工可读性签收与 `P8` 未完成，**`G3-UX` 与发布仍保持待人工/桌面收口状态**。证据：[Task 6 交互生命周期证据](audit/2026-11-17-g3-interaction-exit/README.md) 与 [G3 阶段总验收汇总](audit/2026-11-17-g3-final/README.md)。

- **Task 4 立体 / 折叠 18 题闭环与 `G3-Math` 36/36 正式退出**：`solid.create_polyhedron`/`polyhedron3` 新增 `open?: boolean`（严格保持闭合体 ≥4 面 / ≥6 棱不变，开放面 `open === true` 走 `buildOpenSurface`）、`actionInputs.ts` 补齐 `solid.create_sphere.label`、`inspectPointAndPrimitiveIntegrity` 保留 `:vN`/`:pN` 复合点标、`solidVolume`（柱 `det/2`、锥 `det/6`）/ 分式根号 `dihedral` 余弦 / 翻折垂直与多作用域多状态（`scopePlans` / `statePlans` / `scopedStatePlans`）全线贯通 `solidDrawingPlan.ts` 与 `reliabilityEval.eval.test.ts`。`solidContracts18.test.ts` **23/23**（18/18 立体/折叠正例 + 4 项负向篡改反例）、`planarContracts18.test.ts` **23/23**、`drawingContracts.test.ts` **45/45**、`diagramObligations.test.ts` **109/109**、`eval:reliability -- --offline`（冒烟 **31/31** + 36 题 **`36 passed / 0 partial / 0 failed / 0 incomplete`**，对象/义务平均覆盖率均为 **100%**，`liveWrites=0`、`drawingCertificateStatus="passed"`）、`typecheck`、`lint`（0 errors）、Web 构建、`test:rust` 与全量 Vitest **543 文件 / 5793 passed + 1 todo** 全部通过，只读独立数学与合同复核 `SOUND (PASS)`。证据：[Task 4 G3-Math 36/36 退出证据](audit/2026-11-17-g3-math-exit/README.md)。**`G3-Math` 已退出**；下一步立即推进 Task 6（`T16` 生命周期 Playwright E2E + Windows 桌面 no-bundle 实测 + DeepSeek 实测）与 Task 7。

- **Task 3 平面 / 圆锥曲线 / 函数 18 题数学合同与协调器全链闭环已落地**：`excludedPoints` 端到端、`selectedScopeId`（含 `draftStore.stage` / `compileInProcess` / `parseObligationWithLegacy` / `verifyDiagramObligations`）与 `evaluateDrawingContractBranches` 已全线贯通；`verifyTangentLine` 拐点切线+防割线与 `pointOnCurve`/`collinear`/`pointLineCoord` 已落盘。`planarContracts18.test.ts` **23/23**（18 题全过 + 4 项篡改反例）、`eval:reliability -- --offline`（冒烟 3/3 + 36 题中 **18/18 平面全过**，`liveWrites=0`、`drawingCertificateStatus="passed"`；36 题暂 `18 passed / 2 partial / 16 failed`，对象覆盖 **54.17%**、义务覆盖 **52.31%**）、`typecheck`、`lint`（0 errors）、Web 构建与全量 Vitest **542 文件 / 5770 passed + 1 todo** 全部通过；`G3-Math` 尚未退出。证据：[Task 3 平面 18 题证据](audit/2026-11-17-g3-planar-18/README.md)。下一步立即进入 Task 4（18 道立体几何与折叠题闭环）。

- **Task 2 生产完整 `DrawingCertificateResult` 接线与统一评测接入已落地**：`drawingCertificate` 与 `certificateBinding` 已贯通 `DraftStore.stage` → `CommitterAdapter` → `HostBridge`（`preview`/`requestConsent`/`commit` 双向核验 `verifyCertificateFreshness`）→ `AgentRuntime`/`AgentRunner`/`agentStore` → `ConfirmationPanel`（阻断 `blocked`/`partial`/`unverified` 与关闭开关时静默通过）及 `reliabilityEval.eval.test.ts`。定向 10 文件 183 项、`typecheck`、`lint`（0 errors）、Web 构建、离线/36 题 `eval:reliability`、Playwright `e2e/drawing-reliability-render.spec.ts`（`2 passed`）与全量 Vitest **541 文件 / 5747 passed + 1 todo** 全部通过。证据：[Task 2 证书接线证据](audit/2026-11-17-g3-certificate-wiring/README.md)。下一步进入 Task 3（18 题平面几何与函数确定性构造/核验）。

- **T01 / P0 终审（R4）已通过，36 题契约 suite 获 `approved`**：针对 R3 五项阻断（`GK-P06` AB 弦宿主与三分支、`JT-P02` `y_P≠0` 与互异交点、`JT-S04` 闭合六面体与 `±90°` 镜像、`GK-S09/JT-S01/JT-S09` 命名立体防匿名替身、`points3Of/points2Of` 重复归一化标签/别名/错维点拦截）完成 RED→GREEN 修复；只读独立 reviewer 复核 `PASS`，`GK-S02/GK-S03/JT-S06/JT-S07` 保持 `text_with_figure_reference` 诚实未知边界。`drawingContracts.test.ts` 45/45、全量 Vitest **540 文件 / 5743 passed + 1 todo**、`typecheck` 与 `lint`（0 errors）通过；36 题离线 `eval:reliability` 基线为 **0 passed / 11 partial / 25 failed / 0 incomplete**（对象覆盖 **23.5%**、义务覆盖 **18.9%**）。证据：[P0 / T01 R4 终审与基线](audit/2026-11-17-g3-contract-review-r4/README.md)。下一步进入 Task 2（生产完整 `DrawingCertificateResult` 接线与统一评测入口）。

- **T15 真实画布渲染证据、分层视觉校验与标签布局已落地**：`renderEvidence.ts` 新增 `VisualEvidenceTier`（`structuredOnly` / `rendered` / `humanReviewed`）防升级与 `adjustLayoutWithoutMutatingMath`（标签避让不改数学坐标、开关关停落 `unverified`）；`renderLayoutInput.ts`、`canvasEvidence.ts`、`agentRunner.ts` 对齐 `rendered` / `structuredOnly` 口径；`planarDrawing.ts` 补齐显式直线与圆锥曲线求交；`renderEvidence.test.ts`+`planarDrawing.test.ts`+`canvasEvidence.test.ts`（47 项）与 Playwright `e2e/drawing-reliability-render.spec.ts`（`2 passed`，四族渲染与反例通过，AI 已抽检 `t15-conic-rendered.png` 与 `t15-solid-fold-rendered.png`，记为 `agent_visual_review`），全量 Vitest 540 文件/5742 通过+1todo、类型/Lint（0 errors）/Web 构建/离线评测通过。证据：[P7 / T15渲染可见性证据](audit/2026-11-17-p7-render-visibility/README.md)。当前按 `2026-11-16-g3-completion-plan.md` 持续推进 G3（下一步先关闭 r3 合同剩余 5 项阻断与 T01 复核）。

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

- **JT-S04 跨状态折叠谱系已落地**：新增 `fold-transform-3d` 与 `evaluateDrawingContractStates`，用真实 `F→E,+90°` 旋转关联前后候选，拒绝局部垂直/面环成立但非同一翻折的伪候选；缺状态返回 incomplete。39项目标测试、全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过。证据：[跨状态折叠谱系](audit/2026-11-16-g3-fold-lineage/README.md)。本区块未新增离线 reliability 读数，生产stage/runner和其他折叠合同仍未完成。

- **切线端点与目标直线已绑定**：GK-P05补O原点、P/Q与Aᵢ端点，GK-P07/JT-P04绑定P/A/B与命名切点，JT-P08每支EF均验证E/F在线上；错误切点、脱离目标直线均被拒绝。39项目标测试、全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[切线端点与目标直线](audit/2026-11-16-g3-tangent-endpoints/README.md)。参数域/最值和生产接线仍未完成。

- **函数表达式与公共切线参数域已落地**：GK-P04/GK-P09 以多项式系数核验全局函数表达式，GK-P04(2) 以独立推导的 `a≥−1` 核验 `x²+a` 与公共切线范围；微小偏移函数、低于下界的参数被拒绝，等价表达式可接受。39项目标测试、全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[函数表达式与公共切线参数域](audit/2026-11-16-g3-function-domains/README.md)。其余最值、生产接线与T01独立复审仍未完成。

- **三份结构化不可行诊断已补代数证据**：JT-P01 核验实际垂直平分线与椭圆的两个交点，JT-P04 核验真实切线/垂足并证明共圆矛盾，JT-P06 以焦点点积恒正确认无直角点；错误scope关键词、错误平分线和实际可行情形均拒绝。JT-P04测试候选已按斜率积−2重算。39项目标测试、全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[结构化不可行诊断](audit/2026-11-16-g3-infeasible-evidence/README.md)。生产诊断绑定、其余最值与独立复审仍未完成。

- **完整棱柱几何已补齐**：GK-S05 新增AD=2、AA₁⊥AD、上下底及三条侧棱向量，并核验第(1)问 B₂C₂=A₂D₂；JT-S02 新增三侧棱平移与三对对应边。斜四棱柱、短AD、错对应顶点与错误三棱柱均拒绝。39项目标测试、全量540文件/5735通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[完整棱柱几何](audit/2026-11-16-g3-prism-geometry/README.md)。其余最值、折叠和生产验收仍未完成。

- **平面动点最值已补解析合同**：GK-P07 最大面积20√5（P=(0,−5)）、JT-P03 最小|DE|=4/3（参数和−8）、JT-P07 最小点积1（竖直弦x=1）均验证实际几何与取等条件；合法但非最优候选、错误AB宿主被拒绝。42项目标测试、全量540文件/5738通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[平面动点最值](audit/2026-11-16-g3-planar-extrema/README.md)。立体剩余范围/折叠、生产验收与独立复审未关闭。

- **GK-S05(2) 二面角不可行已改为区间证明**：从真实A₂C₂铰链、D₂和BB₁端点重算 `cos²θ=3/(16t²−16t+7)`，`t∈[0,1]`，证明 `cosθ≤−√(3/7)<−1/2`，故120°不可达；错误几何、跨scope关键词和伪造P均拒绝。42项目标测试、全量540文件/5738通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[二面角区间不可行证据](audit/2026-11-16-g3-solid-infeasibility/README.md)。其他折叠/范围与生产验收未关闭。

- **JT-S04(2) 异面直线最小余弦已闭环**：独立解析得到最小值7√2/10在BE=6取得，折后BC/AD方向余弦与F→E、+90°真实谱系同候选核验；BE=5非最优与缺跨状态证据均拒绝。43项目标测试、全量540文件/5739通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[异面直线最小余弦](audit/2026-11-16-g3-fold-skew-min/README.md)。JT-S01/JT-S08及其他折叠、生产验收未关闭。

- **JT-S08 动点平面夹角范围已闭环**：纠正旧菱形底图为满足原题的梯形，补BC⊥AC与BC⊥CF两个证明方向；`cosθ=1/√(4+3t²)`，两端点 `t=0/1` 固定范围 `[1/√7,1/2]`，中间代表点与缺端点均不能通过。43项目标测试、全量540文件/5739通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[JT-S08动点范围](audit/2026-11-16-g3-jts08-range/README.md)。JT-S01与其他折叠、生产验收未关闭。

- **JT-S01 球半径与二面角最值已闭环**：独立解出指定O的球心及半径√5/2；第(2)问以CP投影推导最小余弦1/√3，两个镜像最优位置P=(3/2,−1/2,±1/√2)均通过，φ=90°非最优和错误半径被拒绝。43项目标测试、全量540文件/5739通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[JT-S01球半径与最值](audit/2026-11-16-g3-jts01-sphere-dihedral/README.md)。GK-S02、生产验收与独立复审未关闭。

- **GK-S02 文字可确定的折叠证据已补齐**：A→P 的 ±90° 真实旋转、按state的对象集合、EF⊥PD和面PCD/PBF正弦8/√65均验证；伪旋转、缺状态均拒绝。谱系聚合改用全状态实体并集，不再把折前无P误报为缺失。44项目标测试、全量540文件/5740通过+1todo、类型/Lint（0 errors/33既有warnings）/Web构建（640 modules）通过，未新增离线 reliability 读数。证据：[GK-S02折叠证据](audit/2026-11-16-g3-gks02-fold/README.md)。**未审核题图的面环与宿主仍未关闭**，T01不退出，下一步恢复第二独立reviewer全量复审。

- **第三轮独立复核已完成，suite仍不可批准（历史检查点，R3 阻断随后已于 2026-11-17 R4 全部收口）**：agent-0逐题确认16/18平面、10/18立体的case专属数学内容可批准，但未改任何审核标志。当时阻断为GK-P06的AB宿主、JT-P02退化交点、JT-S04镜像与闭合六面体、GK-S09/JT-S01/JT-S09指定实体绑定，以及全局重复规范化点标签覆盖。GK-S02/GK-S03/JT-S06/JT-S07题图来源保持诚实未知。证据：[第三轮独立全量复核](audit/2026-11-16-g3-contract-review-r3/README.md)。

### 当前执行范围与区块结果

前期授权阶段 **R00 → R01-A → R09-A → R10**、**G1（R02–R06）**、**G2（R07、R08、R09-B、R11）**、**`B4`（`P0–P6`：`T01–T14` + R4 + Task 2–4 `G3-Math` 36/36）** 及 **`B5` 浏览器端与编译验证（`T15` 渲染可见性 + `T16` 全生命周期 290/290 Playwright + desktop `no-bundle` 构建）** 均已完成闭环；应用户明确指示，**已保存 DeepSeek 真实模型画图测试保留由用户后续执行**，剩余打开项仅非沙盒交互式桌面窗口 UIA 走查、教师/用户人工可读性签收（`humanReviewed`）与 `P8` 安装包/冷机/发布门禁，发布阻断不解除。

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
| B4 / P0 / T01 36题黄金契约与统一口径 | **已完成（R4 终审通过）** | 经 R1–R3 整改并在 R4 闭环五项阻断（`GK-P06` 三分支与 AB 宿主、`JT-P02` 互异交点与 `y_P≠0`、`JT-S04` 闭合六面体与 `±90°` 镜像、`GK-S09/JT-S01/JT-S09` 防匿名替身、`points3Of/points2Of` 防重复别名覆盖），只读独立 reviewer 复核 `PASS`，suite 与 36 题全部转为 `approved`（4 题无题图保持 `text_with_figure_reference` 诚实未知）；详见[P0 / T01 R4 终审与基线](audit/2026-11-17-g3-contract-review-r4/README.md) |
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
| B4 / P4 / T14 最终候选绑定与原子确认 | **已完成（已并入 G3-Math 36/36 闭环）** | [P4 / T14原子提交与保鲜证据](audit/2026-11-16-p4-atomic-commit-staleness/README.md)、[Task 2 证书接线证据](audit/2026-11-17-g3-certificate-wiring/README.md)、[Task 3 平面 18 题证据](audit/2026-11-17-g3-planar-18/README.md)与[Task 4 G3-Math 36/36 退出证据](audit/2026-11-17-g3-math-exit/README.md)：`verifyCertificateFreshness` 与 `committedOnce` 已贯通生产 `DraftStore.stage → HostBridge → ConfirmationPanel`；36 题合同离线实测 **`36/36 passed`**，只读独立数学与合同复核 **`SOUND (PASS)`**，`G3-Math` 已正式退出 |
| B5 / P7 / T15 真实候选渲染与可见性 | **生产真实候选渲染已闭环；待 36 题审阅包与人工签收** | [真实候选渲染与确认链](audit/2026-11-17-g3-candidate-render/README.md)：2D 完整候选、3D Three.js 实际对象投影、Agent 页同候选预览及 consent/commit `rendered` 盒子/截图/相机绑定已通过；全量 Vitest **544 文件 / 5796 passed + 1 todo**、目标 Playwright **5/5**。36 题截图/联系表、桌面 UIA 与教师/用户 `humanReviewed` 仍待完成 |
| B5 / P7 / T16 全生命周期交互与桌面构建 | **浏览器 290/290 与 desktop `no-bundle` 构建通过；待非沙盒桌面实机走查** | [Task 6 交互与全量回归证据](audit/2026-11-17-g3-interaction-exit/README.md)、[G3 总验收汇总](audit/2026-11-17-g3-final/README.md)：新增 `e2e/drawing-reliability-lifecycle.spec.ts`（一次确认/撤销重做/保存重载/拖动/失效/取消零写入），修复提交后二次草稿按钮与解析保留漏洞；全量 Playwright **290 passed**、Vitest **543 文件 / 5794 passed + 1 todo**、eval 冒烟 **31/31** + 合同 **36/36**、`typecheck`、`lint`、`test:rust` 与 `@draw/desktop` `no-bundle` 构建全通过；非沙盒交互桌面窗口 UIA 走查与配图/OCR 独立计数待补 |
| 后续阶段范围 | **G3-Math 已退出；DeepSeek 实测保留用户后续执行；G3-UX 人工/桌面走查与 `P8` 未关** | `G3-Math`（36/36）已正式退出；应用户明确指示，**已保存 DeepSeek 真实模型画图测试保留由用户后续执行**；剩余打开项为非沙盒 Windows 桌面交互走查、人工可读性签收（`humanReviewed`）及 `P8`（未见题/成本/安装包/冷机/发布审批）；其他付费 provider 与产品发布继续保持关闭 |

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

### 2. 本轮阶段验收（7 件已解决、2 件待定；按 G3 实核更新）

P是画图能力验收阶段，R/T是实现工作包，G是跨任务门禁；不能相加为新的完成总数。R01-A/B、R09-A/B是任务切片，不把31项再拆成另一份重复计数。P0–P6 均已随 `G3-Math`（36/36）与 R4/Task 2–4 独立复核退出。

| 序号 | 阶段 | 状态 | 退出门槛摘要 |
| --- | --- | --- | --- |
| 1 | ~~P0 基准与测量~~ | **已退出（R4 终审通过）** | 36题来源/hash/span与合同在 R4 通过只读独立复核，suite 与 36 题全部转为 `approved`（4 题无题图保持诚实未知）；见[R4 终审](audit/2026-11-17-g3-contract-review-r4/README.md) |
| 2 | ~~P1 来源与语义合同~~ | **已退出（Task 2/3/4 实核通过）** | `ProblemContract` / `selectedScopeId` / 选问与改题失效已端到端贯通并通过跨 scope 反例与 36 题评测 |
| 3 | ~~P2 解析与归一化~~ | **已退出（Task 3/4 实核通过）** | 符号表达、角链、比例/位置分离与数值策略在平面 18 题及立体 18 题实测 100% 覆盖通过 |
| 4 | ~~P3 平面确定性构造~~ | **已退出（Task 3 平面 18/18 通过）** | `GK-P01..09` 与 `JT-P01..09` 18/18 确定性构造、独立核验及篡改反例（`planarContracts18.test.ts` 23/23）通过；见[平面 18 题证据](audit/2026-11-17-g3-planar-18/README.md) |
| 5 | ~~P4 立体与折叠构造~~ | **已退出（Task 4 立体 18/18 通过）** | `GK-S01..09` 与 `JT-S01..09` 18/18 及多状态折叠谱系、开放面与篡改反例（`solidContracts18.test.ts` 23/23）通过；见[G3-Math 退出证据](audit/2026-11-17-g3-math-exit/README.md) |
| 6 | ~~P5 有界求解与修复~~ | **已退出（Task 2–4 实核通过）** | 统一生产/离线入口有界求根、停滞阻断、预算消费与 `AbortSignal` 取消已接入并经 `eval:reliability` 31/31 + 36/36 实证 |
| 7 | ~~P6 独立完整验收~~ | **已退出（`G3-Math` 36/36 `SOUND`）** | `DrawingCertificateResult` 全链贯通，36 题离线实测 **36/36 passed**（对象/义务覆盖均 100%，`liveWrites=0`），只读独立复核 **`SOUND (PASS)`** |
| 8 | P7 真实画布与交互 | **浏览器端通过；待人工签收与非沙盒桌面实机走查** | `T15` 与 `T16` 浏览器生命周期 E2E（全量 Playwright 290/290）、Rust `test:rust` 与 `@draw/desktop` `no-bundle` 构建已通过；仍缺 36 题人工可读性签收（`humanReviewed`）与非沙盒 Windows 桌面窗口实机 UIA 走查 |
| 9 | P8 泛化与发布 | 未开始、未授权 | G1/G2 与 `G3-Math` 已就位；用户保留 DeepSeek 真实模型画图测试由其本人后续执行；盲测/成本/安装包/冷机/安全回滚与人工批准未开启 |

### 3. 下一步及授权边界

**下一步与留待用户事项**：`G3-Math`（36/36）已完成；最新[真实候选渲染与确认链](audit/2026-11-17-g3-candidate-render/README.md)为 **Vitest 544 文件 / 5796 passed + 1 todo**、目标 Playwright **5/5**。下一区块依次生成 36 题截图/联系表、补齐生命周期矩阵与 Windows 桌面 UIA、执行最终独立复核；用户/教师 `humanReviewed` 与 `P8` 保持未关闭，DeepSeek 实测仍按用户要求留待其本人后续执行。

全部实现须RED→GREEN、生产接线、反例/兼容与独立复核；安全补丁回退只能关闭入口，不能重新开放已知漏洞。历史版本和授权不自动继承。仅用户明确授权的保存DeepSeek可做真实评测；其他付费预算、依赖升级和产品发布不在本次范围内，不自动触发。

### 4. 记录和验证导航

- [下一轮导航](agent-next-round-progress.md)、[本轮过程日志](project-progress.md)。
- [本次文档对齐清单/核验](audit/2026-11-15-progress-alignment/README.md)：活动文件、历史导航边界、原件保真和本次新鲜文档测试。
- [历史原件](audit/2026-11-15-pre-reset/README.md)、[旧清理记录](audit/2026-11-15-project-cleanup/README.md)、[v4.3.0历史发布说明](release/v4.3.0.md)。

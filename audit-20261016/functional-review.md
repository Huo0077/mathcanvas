# 21 项设计任务功能审查

- 审查日期：2026-10-16（本机时区 America/Los_Angeles）。
- 项目：`D:/draw/draw`
- Git HEAD：`3632817016d5cab5e4939199467e0b557962b844`。
- 依据：`docs/superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md` 中 Task 1–21 的功能要求与退出条件。
- 方法：追踪实际入口到规划、编译、内核构造、条件核验、草稿、确认提交、画布及证明回包；运行当前源码的完整测试，并用额外离线探针寻找既有测试没有覆盖的反例。文档勾选不计为功能通过证据。
- 修改边界：未修改产品代码、未更改原计划状态；保留已有 `apps/desktop/src-tauri/Cargo.toml` 工作区改动。只添加审查日志、探针与本报告。没有发起真实 provider 请求、执行恶意 Lean 代码、下载大体积工具链或安装桌面包。

## 总结裁决

**不能认定 21 项全部完成，也不能据当前证据签收最终发布。** 既有 Web 能力与四族代表题链路可运行；Task 9、12、13、15、16、18、19 尚有原范围内的功能或验收缺口，Task 20、21 未完成。逐项口径为：12 项完成（限定原有支持范围）、7 项部分完成、2 项未完成。Task 12 的固定点—旋转点距离反求已完成，但原卡更一般目标关系的区间搜索尚未实现，因此按整张任务卡判部分完成。

- **普通作图**：本轮完整 Web 兼容回归通过；不等于真实模型四族真题质量及桌面发布已达标。
- **自动 Lean**：本轮不予发布放行。受限引理的分级防误报可验收，但迟到结果绑定、安全隔离与真实发行生命周期仍需闭环；不能宣称整题自动证明。

## 一、实际运行结果

| 验证 | 本轮结果 | 证据 |
|---|---|---|
| 完整单元/组件测试 | 391 个文件，4566 passed，1 todo，0 failed，exit 0；592.40 秒 | `audit-20261016/unit-verbose.log`、`unit.exit` |
| 完整浏览器测试 | 237 passed，0 failed，exit 0；6.0 分钟 | `audit-20261016/e2e.log`、`e2e.exit` |
| 类型检查 | exit 0 | `audit-20261016/typecheck.log`、`typecheck.exit` |
| lint | 0 error / 13 warnings，exit 0 | `audit-20261016/lint.log`、`lint.exit` |
| 证明/异步/UI/工具链/评测定向单测 | 25 文件、353 passed，exit 0（与完整单测重叠，不额外累加） | `audit-20261016/proof-targeted.log` |
| Task 9–15 定向复核 | 12 文件、220 passed，exit 0（与完整单测重叠） | `audit-20261016/tasks9-15-targeted.log` |
| 新增审查探针 | 7 项：1 failed / 6 passed；5 个绿灯确认缺陷现状，1 个绿灯确认 3D 测量边界；exit 1 | `audit-20261016/review-probes.log` |

注意：

1. 浏览器套件的 global setup 会构建当前源码并启动 preview，本轮不是拿旧打包产物测试。
2. 默认完整单测明确排除了真实 Lean 慢集成 `scripts/proof-spike/lean4EndToEnd.test.ts`。本轮未运行 `test:lean`、完整 Rust/桌面打包、当前安装包 UI/IPC 验收，不能把上述绿色数字称为这些路径的证据。
3. `unit.log` 是此前工具超时留下的不完整日志；结论只使用有 `unit.exit=0` 对应的 `unit-verbose.log`。探针日志与完整产品回归日志分开，不将刻意暴露缺陷的失败混进完整回归结果。
4. 新增探针中有五项断言“当前错误行为确实出现”，所以它们通过表示缺陷复现成功，并非产品行为正确。

## 二、已复现的问题与影响边界

### F1 / P1：证明等待期间草稿已失效，旧 stage 仍返回 verified

位置：

- `apps/web/src/agent/draftStore.ts:579–602`
- `apps/web/src/agent/automaticProofStage.ts:111–125`

复现：创建草稿 → 开启 proofExport 暂存 → 延迟假的证明通道 → 在等待期间 `store.invalidate(draftId, ...)` → 放回旧证明。

实际结果：`store.getPreview(draftId)` 已为 null，但原 `stage()` 仍返回 `ok:true`，其中 `proofAttempt.outcome="verified"`、`stale=null`。

原因：await 返回后仍使用闭包里的旧 `record`，未重新读取实时草稿或检查 invalidated/版本 CAS；`inputHash` 与 `backendVersion` 被填为相同空字符串，claim/goal ID 又从返回产物本身取来与自身对比。证明阶段返回值也未向下保留 artifact 的完整身份。

影响：Task 18 要求的“迟到结果标 stale 或丢弃”在 stage 层不成立。尚未证实此结果能绕过后续 HostBridge 最终提交的 CAS，因此不宣称一定污染正式文档。

证据：`review-probes.log` 的 `AUDIT_LATE_INVALIDATED`；可复跑 `proof-and-evaluation-probes.test.ts`。

### F2 / P1：评测授权的请求数没有约束实际执行次数

位置：`packages/agent-core/src/benchmark/examEvaluation.ts:428–452`。

复现：冻结表授权上限 1 次，请求字段也填写 1；注入完全不联网、只计数的 `runCase`。

实际结果：`allowed=1`，`calls=36`，返回 `ok=true`，报告 `requests=36`。

原因：门禁仅核查调用方声明的 requests，随后实际循环所有题目 × trialsPerCase；没有根据真实待执行工作量复核，也没有逐次额度闸。

影响：真实 provider 接入前必须修复，否则“用户只同意 N 次请求”不是硬限制。这里 36 次全部是离线 fake 调用，没有实际消费。

证据：`review-probes.log` 的 `AUDIT_REQUEST_LIMIT`。

### F3 / P2：人评未覆盖全部结果，仍可通过可读性指标

位置：`packages/agent-core/src/benchmark/examEvaluation.ts:297–322`。

复现：36 个 trial 中，每家族仅标注一项可读，共 4 项，其余 32 项没有可读性标注。

实际结果：四家族 unreadable 指标全部为 0、全部 passed；构造的模拟结果甚至使全部指标 passed。

原因：分母采用 `annotated.length`，没有完整覆盖率门禁或强制缺失标注 fail-closed。

影响：这些数值可以描述“已标注子集”的不可读比例，但不能用作全部结果已经人评的发布凭据。若未来仅抽样人评，需预先定义独立抽样规则和最低覆盖率，而不是缺失值自动排除。

证据：`review-probes.log` 的 `AUDIT_PARTIAL_HUMAN`。

### F4 / P2：NaN 预估费用能穿过授权门

位置：`packages/agent-core/src/benchmark/frozenThresholds.ts:208–217`。

复现：授权上限 $12，传入 `estimatedCostUsd: NaN`。

实际结果：`assertPaidRunAllowed` 返回 `ok:true`。

原因：只比较 `estimatedCostUsd > maxCostUsd`，未验证输入费用为非负有限数。

影响：无效费用估计被当成可执行。另需注意：运行器的实际费用超支检查在整轮执行结束之后，当前真实费用采集又会返回 null；这不是实时止损机制，不能承诺硬美元上限已落实。

证据：`review-probes.log` 的 `AUDIT_NAN_COST`。

### F5 / P2：用户主动隐藏的点被当成漏画标签

位置：`apps/web/src/canvasEvidence.ts:218–233`。

复现：文档中有 `label:"A", visible:false` 的点，画布按可见性设置不显示 A，调用 `hiddenPointLabels(doc, [])`。

正确期望：空数组（主动隐藏不是相机遮挡/漏画）。实际：`["A"]`。

原因：期望点名列表仅排除了细分顶点，没有排除 visible=false。

影响：视觉证据中的 hiddenLabels 会误报。没有证据显示它当前会阻断提交；这里明确报告的是诊断证据错误，不扩大成作图失败。

证据：`review-probes.log` 中唯一按正确期望失败的测试；`canvas-review-probe.test.ts:6–10`。

### F6 / P2：离线 oracle 没有验证条件覆盖率，空读数也会接受

位置：`packages/agent-core/src/benchmark/examSet.ts:340–348`。

复现：使用合成的、标记为独立复核的用例，oracle 列出 `|AB| = 8` 与 `|AC| = 6` 两条必要条件，却传入空测量数组。

实际结果：`judgeAgainstOracle(reviewed, [])` 返回 `accepted:true`、`reason="satisfied"`。

原因：函数只过滤调用者已经交出的 checks，完全没有把 checks 与 oracle 条件集合对齐；零条检查在逻辑上被当成全部满足。

影响：来源/防泄漏守卫可运行，但这个 oracle 函数不能单独保证“所有必要条件已从最终图回代”。本例是离线合成探针，不冒充已经存在的真实金标题目，也不宣称当前付费报告实际消费了该函数。Task 9 只能判工程工件部分完成，不能将这层绿灯签收为完整错图/欠定判据。

证据：`review-probes.log` 的 `AUDIT_EMPTY_ORACLE`；`oracle-review-probe.test.ts`。

## 三、重要验收边界

### 1. 指定题面夹具通过，不等于真实模型已掌握整类题

`apps/web/src/agent/localPlanner.ts:419` 的三角形入口使用 exact 题面；`:436` 翻折入口匹配“四边形/翻折/pc=4√3”特征后调用固定 `userFoldPlan()`。圆锥、函数也有预制题面入口。

真实 provider 激活时，`agentRunner.ts:500–522` 会选择 model planner，不是这一套本地样例路径。因此，两种结论必须分开：

- 当前指定样例的规划/编译/核验/确认/画布流程确实可以跑通。
- 同样能力能否经真实模型从任意合理改写、改数字题面到达，不能由这些 e2e 推出，属于 Task 20 未完成的质量验收。

完整单测里的 `frozenThresholds.local.test.ts` 还实际验证：冻结 12 道真题，三角/圆锥/函数各 0/3 本地命中；立体 1/3 有回应，但命中的是固定棱柱图，不是相应原题。因此 12/12 仍需要真实 provider 后才能判定成功率。此处不把安全澄清认作错误作图，也不把有回应认作题目已完成。

### 2. Task 16 的 3D 证据无法单凭诊断为空证明实体真实画出

`canvasEvidence.ts:247–251` 对 3D 使用 `objectsMeasurable=false`，只测 DOM 标签并移除 empty_canvas。探针构造“文档有未命名 3D 点、DOM 为空”的场景，诊断仍无 error。这是已声明的测量边界，不冒充发现 WebGL 当前坏了，但它不足以承担完整的 3D 可见性验收。

虚线段数与开关已经从 Three.js 生产层回报，不能说没有任何虚线证据。仍缺当前桌面入口、人评和可靠的 3D 实体/遮挡视觉验收。

`renderEvidenceStaleness` 有正确的 hash/draftId 比较及单测；本轮全仓检索只找到定义、导出和单测，没有找到产品消费点。浏览器用例证明改题/撤销会改变当前画布哈希，但不能代替“实际消费旧 RenderEvidence 时拒绝”的完整接线证明。

### 3. Task 17 不应被误解为已交付整题自动证明

分级报告确实区分 limited_lemma、whole_problem、unsupported；原卡明确允许没有完整 Lean 命题产物时不勾 whole_problem。因此应按“防止受限引理误报整题”的范围验收，不额外强迫它实现所有数学题的完整证明。

当前产品调用没有提供 wholeProblemProposition，完整原题证明不可达；这是能力边界，不应将“受限引理通过”写成“原题已证”。

### 4. Task 13、15、19 的当前实现缺口（不是仅据计划自述）

- **立体**：当前 action registry/输入、物化与 witness 链路覆盖 `solid.create_face`、折叠和已有实体；本轮检索未找到原卡“面上点依赖/展开”的完整 agent 产品动作—编译—独立回代—浏览器验收链路。已有旋转/展开相关内核函数不等价于该纵向交付已完成。
- **函数**：公切线已接通 `parseActionToolInput → compileActions → commitPatch → recomputeCurveTangent`，并由题面 `commonTangent` obligation 进入独立 `diagramVerification`。当前只支持两条显式 `function` 图元、`branch` 0/1；不支持圆/椭圆/任意曲线的公切线，也不构成形式证明、真实模型或桌面验收。
- **Lean 安全**：`apps/desktop/src-tauri/src/proof/source.rs:45–99` 使用固定子串黑名单与几条必备标记，并未对整份源码做严格模板白名单解析，也不是操作系统隔离。本轮不宣称已经成功执行逃逸 payload。
- **Lean 资源限制**：`apps/desktop/src-tauri/src/proof/mod.rs:245–268` 在 `wait_with_output()` 收集完 stdout/stderr 后才 `tail_of`。尾部 4000 字节限制只限制最终返回文本，不限制运行期间输出采集内存。这个结论来自当前实现，不冒充本轮已做内存压测。

## 四、未运行及不能据此签收的项目

- 真实 provider 的 12 题 × 3 次评测、真实 pass@1/pass@3、费用和时延。
- 真实 Lean 慢集成和当前 HEAD 的完整 Rust 回归。
- 当前桌面包安装、真实 UI → IPC → Lean → 用户确认 → 改题/撤销/切文档生命周期。
- 干净无网机器安装验收、当前发行来源及产物哈希、同 HEAD CI。
- 教师/学生读图及完整人评；相机转出视锥等尚未稳定复现的视觉反例。

本轮仅审查，没有因此替用户签署发布门禁。普通作图回归通过与自动 Lean 可发布是两把独立的锁。

## 五、逐项判定口径与当前已核定任务

“完成”仅表示原任务约定的功能切片已有当前实现和本轮可运行证据，不等于所有数学题通用、真实模型质量达标或桌面已发布。“部分完成”表示有真实功能，但原退出条件仍缺关键链路/证据，或存在直接反例。“未完成”表示关键验收尚未执行或不能放行。

| Task | 功能内容 | 审查判定 | 本轮依据与边界 |
|---|---|---|---|
| 1 | 旧能力与兼容基线 | 完成（当前兼容范围） | 文件读写、命名、撤销、旧开关/工作区、人工作图路径的单测与浏览器回归通过；历史“先量后改”的过程不能用本轮测试倒推重建。 |
| 2 | 22:36 失败重现与分类 | 完成 | 输出解析/runner/coordinator 测试通过，非法动作名与非法顶层形状分开反馈，不再混成一种泛化失败。 |
| 3 | 动作菜单/schema/工具合同 | 完成 | 动作目录、published schema、工具入参和现有 parser 的合同测试通过；不是只检查提示词文本。 |
| 4 | 共享预算与修复账本 | 完成 | generation/network 计数、消耗层级与停止原因测试通过；实际默认额度按当前代码而非旧文档数值验收。 |
| 5 | 非法输入与能力声明 | 完成 | null/畸形条件与非法 action 输入拒绝测试通过；constraint-authoring 能力声明与可到达操作保持一致。 |
| 6 | 可追溯 FigureIntent | 完成（已支持解析范围） | 条款 ID/源 span 与题面一致，额外 relations 不覆盖来源；不把尚未解析语句升级成已核验。 |
| 7 | 缺宿主安全物化 | 完成（已支持构造范围） | 点名冲突、未核验条件、环顺序错误有拒绝路径，物化用内核候选而非随机补点；当前相关测试通过。 |
| 8 | Worker/主线程同版 | 完成 | 编译结果、图元、报告、witnessSearch 标志与迟到回包测试通过；不等于桌面发行已通过。 |
| 9 | 真题离线评测工件 | 部分完成 | 开发/留出来源守卫、离线入口和错值拒绝测试可运行；当前题面为调研摘要、无正式金标，且已复现 oracle 对空测量返回 satisfied，缺完整条件覆盖核验。 |
| 10 | 边上分点/动态依赖 | 完成（已支持边上点范围） | 内核比例方向、重合/越界拒绝、落盘比例回代与依赖更新测试通过；namedPoints 的不相容同名分点确实拒绝，非仅存在旧 RED 注释。 |
| 11 | 三角形纵向交付 | 完成（构造与代表题链路） | SSA 两解、无解/欠定、面积、换点名及最终坐标独立回代测试通过；浏览器确认/撤销通过。真实模型泛化归 Task 20，不从本地 exact 题面推出。 |
| 12 | 目标距离反求折角 | 完成（支持范围内） | 固定距离解析求角与单折叠 planarAngle/dihedral/linePlaneAngle 有界搜索已接入 compilePlan；候选逐一回代完整题设。not-found 不冒充 unreachable，耦合多折叠、未支持关系仍拒绝。定向 212/212、原用户翻折浏览器链路 7/7。 |
| 13 | 立体纵向交付 | 部分完成（支持范围内） | 面上点与 `solid.unfold` 已进入真实 parse/compile/commit/render 链路；仍只支持已有 `polyhedron3` 和可展开范围，不覆盖任意曲面、自动展开树或人工视觉签收。 |
| 14 | 圆锥曲线纵向交付 | 完成（已支持圆锥曲线范围） | 实轴语义、参数反求、代数交点/重根/竖线、弦长/面积回代与错轴/丢交点拒绝测试通过；不把非圆锥曲线硬分类，也不将代表题成功当真实模型准确率。 |
| 15 | 函数/导数纵向交付 | 完成（支持范围内） | 函数公切线已完成产品动作、动态重算、删除级联、题面 obligation 与独立数值核验；支持两条显式 `function`、branch 0/1。`verified-numeric` 仍是实例级数值证据，不是形式证明；非函数曲线、真实模型、桌面/人工验收仍未完成。 |
| 16 | 真实画布/过期证据 | 部分完成 | 2D/3D 提交后实时证据消费与过期拒绝已修复并有浏览器证据；候选视觉门禁、3D/WebGL 可测性边界、桌面发行和人工可读性仍缺。 |
| 17 | 原题前提与受限引理分级 | 完成（分级防误报范围） | proof scope 和“额外题设不得升整题”测试通过；产品仍只有受限引理能力，whole_problem 未交付，不能宣称整题证明完成。 |
| 18 | 异步证明绑定/UI | 部分完成（生命周期修复） | 失效/被替换/并发暂存的迟到结果已拒绝并绑定原请求、题面哈希和后端版本；真实 Lean、桌面 proof 生命周期与发行验收仍未执行。 |
| 19 | Lean工具链/安全/发行 | 部分完成（实时输出修复） | 模板检查、固定工具链路径、墙钟超时和实时有界 stdout/stderr 尾部已实现并有 Rust 回归；严格操作系统隔离、真实 Lean 慢集成、桌面发行与安装验收仍未完成。 |
| 20 | 真实模型质量 | 未完成（门禁已修） | 本地预算、人评覆盖与 provider 请求门禁已有功能回归；没有真实 provider 的成功率/pass@k/费用/时延/人工评分，因此不能签收模型质量。 |
| 21 | 完整发布验收/分开裁决 | 未完成 | 当前完整 Web 回归通过；不能代替真实模型、Lean安全、桌面、CI、人评与来源哈希等独立证据。 |

## D1 功能补完记录（2026-10-16）

Task 12 的原缺口“更一般目标关系的有界搜索”已在真实产品编译入口补齐。搜索器有显式预算和不完备标记，有限残差回代后才发布；单元测试覆盖切线根、极点假根、非法预算和端点。固定距离解析支路改为逐候选尝试，避免第一支失败时漏掉第二支。Task 13 的面上点/展开产品入口、Task 15 的公切线动作到题面核验闭环仍保持部分完成，未被本区块的代表翻折题证据覆盖。

## 六、建议修复与复验顺序

1. 先修 Task 18 的实时身份/CAS 检查：await 后重读实时草稿、检查 invalidated 和版本，绑定原始请求 claim/condition/inputHash/backendVersion；本轮迟到探针应改成期望 stale/拒绝后真正复绿。
2. Task 9 补 oracle 必要条件覆盖与独立读数合同；Task 20 花钱前修复硬请求额度、无效费用输入、人评完整性；真实模型请求不能先发再只在报告里说超出。
3. 完成 Task 19 的严格模板/隔离执行、版本/路径核验、实时输出限制与真实桌面发行验收；自动 Lean 继续默认关闭。
4. 修 Task 16 的可见性诊断，补旧证据真实消费、3D 可见性与桌面/人评证据。
5. 保留本轮绿色兼容回归，将新发现反例纳入正式测试，再在同一冻结 HEAD 上补真实模型及发布门禁。不要直接把文档所有 task 勾为完成。

## 七、复跑审查探针

在项目根目录运行：

```powershell
npm.cmd exec vitest run -- --config audit-20261016/probe.vitest.config.ts --reporter=verbose
```

当前预期：7 项中 1 failed、6 passed。失败是可见性诊断缺陷；另五项绿灯是“错误现状复现成功”，一项记录 3D 测量边界。修复产品时应把这些缺陷现状断言改成正确合同，不能为了全绿删除探针。

## 2026-10-16 功能闭环增量：Task 13 面上点与 `solid.unfold`

本区块按真实运行链路验收，不以类型定义或文档存在作为完成依据。

- **面上点**：`dynamic.create_face_point` 已接通 `parseDraftAction → compileAction → commitPatch → resolveBoundPoint3`。测试覆盖面内坐标、跨文档引用、参数驱动更新、退化面与越界坐标拒绝；点以真实 `point3` 和 `onFace` binding 持久化。
- **多面体展开**：新增 `solid.unfold`，输入目标实体引用与 `[0,1]` 展开进度；编译为 `updatePrimitive`，由 `commitPatch` 写入文档的 `polyhedron3.unfoldProgress`。非多面体、越界/非有限进度、跨文档目标均拒绝。
- **渲染消费**：渲染器优先读取每个 `polyhedron3` 自身持久化的进度，未设置时才回退到 UI 全局进度；实体可独立展开。渲染测试通过 `sceneShell.dataset.unfoldObjects` 观察持久化值和 fallback 值。
- **新鲜证据**：定向测试 **6 个文件 / 28 个测试全部通过**；4 个相关 TypeScript 项目检查全部 exit 0；`npm run lint` exit 0（0 error，13 条既有 warning）。这是自动化闭环证据，不是人工视觉签收。
- **边界**：展开仅支持已有 `polyhedron3`，不声称任意曲面展开或自动选择展开树；Task 15、16、18、19、20、21 不因此升级。
- **提交**：功能提交 `4e0354a` 已推送到 `origin/main`。保留未提交的审查探针和桌面 Cargo 改动；本报告作为四份进度文档之一随区块提交。

## 2026-10-16 功能闭环增量：Task 15 函数公切线（支持范围内完成）

本区块按真实产品链路验收，不把几何内核单测或文档描述当成产品完成。

- **产品链路**：`function.create_tangent` 支持 `anchor.kind = common`、第二个函数源引用和 `branch`；动作经过 `parseActionToolInput → compileActions → commitPatch`，提交后由 `recomputeCurveTangent` 动态重算。删除第二个来源函数时，依赖公切线级联删除；修改任一来源函数时切线随之更新。
- **核验链路**：题面“两条公切线”解析为 `commonTangent` obligation；独立核验器重新计算 `commonTangents`，检查数量、branch 唯一性、两条来源函数身份、每条直线同时相切以及 slope/intercept 一致性。通过证据等级为 `verified-numeric`，报告范围仍是 `figure-instance`，`universalClaims` 仍为 `not-proven`。
- **支持边界**：当前只支持两条显式 `function` 图元和 branch `0/1`；非法 source、自引用、圆形 source、无解、缺 branch、重复 branch 均拒绝。非函数曲线公切线、形式证明、真实 provider 评测、人工教师/学生验收、完整桌面发行仍未完成。
- **新鲜证据**：`commonTangent.product.test.ts` 与 6 个既有合同/核验文件共 **7 个文件 / 138 个测试通过**；geometry-kernel、scene-graph、agent-core、dsl 四个 TypeScript 项目 `tsc --noEmit` 均 exit 0；`npm run lint` 0 error / 13 条既有 warning；`git diff --check` 通过。
- **判定**：Task 15 在上述支持范围内完成；不能把该结果外推为所有函数族、形式证明或真实模型准确率。

## 2026-10-16 功能闭环增量：Task 19 本地证明执行的实时输出上限

本区块只修复并验证一个明确的功能缺口：此前 `wait_with_output()` 会在进程运行期间累积全部 stdout/stderr，最终 `tail_of` 只限制返回文本，不能限制采集内存。现在两个管道由独立异步读取任务实时消费，每个只保留最后 4000 字节；墙钟超时会先杀进程、回收子进程，再丢弃半成品输出。

- `tokio` 启用 `io-util`，`capture_tail` 对 stdout/stderr 做有界流式读取；成功退出只返回尾部，超时/等待异常不返回半成品证明。

- 新增 Rust 单测覆盖跨 chunk 保留尾部和超大 chunk 不增长；`cargo check --lib` exit 0；`cargo test --lib proof` **2 passed / 0 failed**。

- 边界：这不是操作系统沙箱，也不等于真实 Lean 慢集成、桌面 UI/IPC 生命周期或发行安装验收；这些仍单独记账。

## 2026-10-16 ???? F1?Task 16 ???????????????

?????????????????????????????????

- `HostBridge` ????????????? `runId`?`draftId`?`draftVersion`??????????????????????????consent fail-closed??? `unverified_render`???????????????? consent ???????????
- no-op draft ???????????????? draft ????????????????commit ??????????? `stale_render`?
- ??????? `spatial-modeling` ?????????? `solid.unfold` ???? action ??????? `HostBridgeLike` ????????????? typecheck ??????????
- ???????????? 12/12?Task 16 ?? HostBridge / runtime / pipeline / compiler-repair ???????? 71/71????????? 8/8?Web typecheck exit 0?lint exit 0?13 ??? warning??`git diff --check` ???

**?????** `structured_only` ????????????????????????????? WebView/IPC/???????/???????????? Task 16 ?????????????????????????????????/??/??????????? renderer ???????????

## 2026-10-16 Functional audit: Task 9 gold cases and oracle evidence

This block records runtime evidence. Research summaries, structured fixtures, and documentation are not treated as independent human gold labels.

- **Runtime result:** Loaded `EXAM_CASES` and `HELD_OUT_CASES` directly. The development set has 8 cases and the held-out set has 4; `checkExamSet(EXAM_CASES, HELD_OUT_CASES)` returns no structural problems. However, `verifiedGoldCaseIds` is still `[]`; all 12 cases have `answerIndependentlyReviewed === false`; no case contains a valid oracle.
- **Functional guard result:** `judgeAgainstOracle` is fail-closed in the running implementation: an unreviewed case or an empty oracle returns `not_a_gold_case`; an independently reviewed synthetic case rejects empty or partial measurements, duplicate/extra measurements, non-finite values, and out-of-tolerance values, and accepts only when every required condition is measured exactly once. `packages/agent-core/src/benchmark/examSet.test.ts` passes 20/20.
- **Acceptance result:** Task 9 is **not complete**. The executable qualification rules and anti-false-pass oracle behavior are verified, but the repository has no real gold case with independent human answer review, usage permission, input hash, and expected figure evidence.
- **Non-substitutable evidence:** A survey summary is not a verbatim exam prompt; a re-published answer is not an independent review; a clean `checkExamSet` result validates dataset structure only and does not create a gold case. Real review records and evidence must be added before `verifiedGoldCaseIds` can be populated and a real exam evaluation can be accepted.
- **Boundary:** This block does not promote offline synthetic oracle checks, unit tests, or documentation into human acceptance. Real provider evaluation (Task 20) and desktop/manual acceptance (Task 21) remain open.

## 2026-10-16 Functional audit: Task 20 real provider evaluation

This block records a real product run through the installed desktop WebView and its confirmation UI. It is not inferred from fixtures, mock models, or the CLI placeholder.

- **Provider actually used:** `deepseek-v4-flash / deepseek-v4-flash`, configured as an OpenAI-compatible cloud profile. The desktop IPC reported a configured secret and provider health `degraded`: strict JSON and streaming verified; tool calling and vision failed during health checks.
- **題集 planning (3 real provider requests):** `planned 1/3`, `clarification 1/3`, `rejected 0/3`, `error 1/3`, `not measured 0/3`; measured-run average latency `21376 ms`; cost `not measured` because the application has no price table. Cases were `underdetermined-pyramid-base` (planned), `contradictory-two-lengths` (clarification), and `unsupported-expression` (error after three transport attempts). Human-readable annotations were `0/2`; this is unannotated, not a zero score.
- **Agent tool-ring evaluation:** the product reported `attempts 24`, `pass@1 1/8`, `pass@3 1/8`, `tool selection 45/45`, `tool error rate 6/45`, `visual verify not_supported` for `visual-fit`, average successful-run latency `1300 ms`, and cost `not measured`. The product did complete the requested run, but the result is a failing/insufficient quality result, not a release pass.
- **CLI boundary:** `npm run bench:agent -- --mode=real_provider` still records every case as `not_measured`; it is not counted as a real provider result. The numbers above came from the confirmed desktop product path and are kept separate from the deterministic-local and planning-contract tests.
- **Acceptance:** Task 20 is **partially complete**. The real provider execution and honest failure/latency readout are functional. The frozen four-family gold evaluation is still not complete: there is no valid independent gold oracle for the 12 frozen cases, the planning run has no human annotations, cost is unavailable, and the 8-case tool-ring result is far below a publishable quality claim. No pass is inferred from the existence of the report.
- **Evidence file:** `audit-20261016/task20-provider-ui.txt` contains the rendered product report captured after the run.

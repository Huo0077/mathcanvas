# MathCanvas 下一步：四家族 Agent 升级、旧能力兼容、缺陷修复与 Lean 收口

> **最后更新：2026-10-11。状态：本文件只有实施设计；下面的新任务尚未完成。** [四家族真题作图需求调研](../../research/2026-10-11-four-family-exam-diagram-survey.md)已在本轮完成，并独立记录卷别、题号、题型和可信边界；**本计划不再包含“以后去调研真题”任务**。现有代码能力与测试的现在时仅以 [当前状态](../../current-status.md) 为准；旧 [V0–V3 追踪](../../agent-next-round-progress.md)的读数保留为历史快照。

**Goal:** 在三角形、圆锥曲线、函数/导数、立体几何四家族内提高真实作图能力，**不回退已完成的手工绘图/Agent/保存导出/实验功能**；修复已确认缺陷，并把现有受限 Lean 证明路径按原题前提、产物有效性和桌面发行证据逐项收口。不能画或不能证明时如实解释。

**Architecture:** 作图主链：原题 → 来源明确的条件与图形意图 → 有界构造 → 最终图元独立回代 → 草稿/用户确认；兼容/修复主链：原有入口与 golden → 重现缺陷 → 最小修复 → 新旧路径同版回归；**可选的 Lean 主链**：已限定目标与全部可表达前提 → 受限桌面后端 → claim/input/toolchain 绑定的产物或明确的不支持状态。证明失败不阻断普通作图，实例图不自动升级为形式证明。

**Tech Stack:** TypeScript、React、Tauri、Vitest、Playwright；不另造平行编辑器，不把 Lean 的普遍证明当作作图门槛。

**Spec:** [四家族真题调研](../../research/2026-10-11-four-family-exam-diagram-survey.md)确定作图需求，[GitHub 实施调研](../../research/2026-10-11-github-agent-implementation-survey.md)确定取舍；[当前状态](../../current-status.md)和[发布门禁](../../acceptance/agent-release-gate.md)给既有功能与 Lean 真实边界。第 7 节是作图任务 1–13 的操作卡，第 8 节是兼容/证明/缺陷任务 14–18；**均未因写出文档而交付**。

## 全局约束（各区块共享）

- **新增作图范围只四类**：三角形、圆锥曲线、函数/导数、立体几何；其他科目内容不入**新增作图覆盖分母**。这不取消现有平面/立体/CAD/文件导出等旧能力的兼容门禁，也不取消已存在的受限 Lean 功能及其独立补完任务。跨家族综合题共同核验；“非标准曲线”不能硬塞圆锥曲线。
- **不硬编码原题答案**：真题是需求和留出验收的依据；改点名、比例、角度、符号或支路仍应有正确结局。原题条件要有来源锚点、覆盖报告和独立回代。
- **严格边界**：未知动作不猜测映射；未读/未核题设不能说整题核验；数值实例图不是普遍证明；`no_witness`、数学矛盾、未实现及超时不得混称。
- **预算/付费**：不得为了表面成功默认增加 `generation: 4` / `network: 6`、自动发起新付费 provider 请求。预算与真实模型评测的更改先给用户看成本/调用次数并征得明确同意。
- **兼容/回归**：先执行 Task 14，钉住现有人工 2D/3D/CAD、`.mgeo`/HTML、Agent 默认关/开旗、确认/撤销和桌面能力。证明开关 `proofExport` **已有设置入口且默认关**，不得误写“尚无入口”；普通作图不依赖 Lean。草稿绑定/Worker/主线程旧路径与新路径均保留；只在新路径和证明各自过门禁后考虑其对应开关。
- **历史诚实性**：已有的 12 条内部原创候选、V0 四家族局部浏览器证据、真实 provider 旧 8×3/3 条小样本都不等于四家族真题级成功率；本轮仅写设计，原用户翻折题仍未在真实 Agent 画出。

## 1. 当前基础和产品目标之间的距离

| 已有基础（不能抹掉） | 当前缺口（必须通过产品路径解决） |
| --- | --- |
| 注册的 `solid.create_face` 可生成开放面片、`solid.fold` 可按**已给定的角度**刚体翻折；受限条件可由系统构造 ABCD、`vertexNames` 能与最终坐标核对。 | 模型不声明 ABCD 宿主时无法替换构造结果；E/F 的定比分点与“折至 PC=4√3”求角未串成一份规格；立体翻折真题未有产品级真模型证据。 |
| 信封 schema/动作登记表是严格白名单；修复次数区分信封类一次、编译类两次。 | 最近 22:36 用户轨迹：`solid.create_polyhedron` 拼开放面失败后，修复轮编造 `solid.create_segment` ×3；UI 却统称“JSON 形状错误”；共享生成预算可能先于名义修复次数耗尽。 |
| 三角、圆锥、函数/切线和受限立体均有部分核验/浏览器样例；旧 N2 受限见证搜索可选开。 | 缺按真题组合关系的三角多解、动态圆锥弦/公切线、函数根数/参数、斜多面体/截面/目标条件翻折的可靠同轮构造与独立核验。 |
| 工作区切换引起本轮 `stale_draft` 的一处缺陷已修；证明有四种受限目标的实验能力。 | 用户编辑/外部换文档仍须阻断旧草稿；Worker/桌面/浏览器与视觉证据未系统覆盖真题；Lean 原题完整前提和发行链仍未验收，不能充当普通作图“完成”。 |

## 2. 目标合同：各层只负责一件事

1. **题面条件层（Agent Core）**：从原文或原文图中读点名、图形拓扑、条件与目标。每条保留原文位置、是否能判、单位、角的顶点/方向、图像定义域；读不懂则附 `unverified`，不得通过修复轮偷偷降低题设强度。
2. **图形意图层（Agent Core）**：模型优先表达“多边形 ABCD”“E 为 AD 上的定比分点”“沿 EF 翻折 AEF”“动直线与椭圆相交”“两曲线共有切线”，而非模型手写全部坐标/面环/散落线段。模型只在已发布的类型化词表中选；宿主缺席时明确要求补**结构**，不谎报“坐标已造好”。
3. **数学构造层（Geometry Kernel）**：先精确比例、根式/角/焦点关系及代数分支；不能闭式解时再用有界数值求根。分清满足条件的一个实例/多支/欠定/数学矛盾/不支持/超时，保留选择与误差界，不把“未搜索到”说成无解。
4. **独立核验层（Agent Core + Scene Graph）**：从**最终物化**的点、线、面、函数和曲线图元按原文条件重新量；核验器不得直接采用构造器的 `ok` 当题设满足。图纸修改、拖动、撤销、相机/截图来源变动后旧报告标 stale。
5. **产品执行层（Web/Desktop）**：一份经过核验的图形意图映射为原子草稿/事务；用户看到“已核验/示意/未核验/冲突”与不能完成的具体原因，再决定确认。2D/3D/函数视图的点名、边、角弧、相机、截图与计算同源。
6. **修复与预算层（Coordinator/Planner）**：反馈结构含错误类型、字段路径、有效动作或安全下步、停机条件和预算余量；预先拒绝没有额度的请求并保留最后一个有用的编译诊断。工具 schema、提示词动作菜单、解析器和动作处理器同源；未知动作**不自动翻译**为“类似动作”。

### 跨层最小数据合同（Task 4 先写类型与坏输入用例，Task 5 才接旧动作）

- `FigureIntentV1 = { version: 1; family: "triangle" | "conic" | "function" | "solid"; objects: NamedObject[]; relations: { sourceClauseId: string; kind: RelationKind; refs: string[]; value?: ExactOrApprox }[]; transformations: Transformation[] }`。一条 relation 的 ID 必须能追回 `obligationIR` 的原句；对**没有**可靠来源的关系不得假装来自原题。`NamedObject` 类型必须容纳点/线/开放面/闭合体/函数/曲线的不同拓扑，不用一组不带语义的顶点列表代替。
- `ConstructResult = { status: "candidate"; positions: Record<Name, Point>; freeChoices: Choice[]; residuals: Residual[] } | { status: "contradictory" | "unsupported" | "timeout"; diagnostics: Diagnostic[] }`。欠定但可画→`candidate` + `freeChoices`；数学矛盾与不能求全不混并。求解器不能直接填“题设全通过”。
- `DiagramVerificationReport` 仍由现有 `diagramVerification.ts` 负责：对**最终文档**每个原文 obligation 给 `passed | failed | unverified`、实测值/容差、对象绑定/版本；全部可判不意味着全部原题条件已读。`planCompiler` 和 `draftStore` 的 Worker 通路共用该报告，UI 不另外猜。
- `RepairStop = { code: "schema_invalid" | "unknown_action" | "compile_failed" | "budget_exhausted"; lastCause: Diagnostic; allowedChanges: string[]; remainingGeneration: number; remainingNetwork: number; canRetry: boolean }`。这只是 Task 1–3 的拟议端口形状；真正命名应和现有 `RepairRequest`/`BudgetSnapshot` 对齐，**不另造同名账本**。不让 UI 将 `unknown_action` 文本替换成“顶层 JSON 错”。

这些接口是**开发约束和拒收条件**，还不是产品代码。先让编译器、草稿层、Worker 的类型/反例测试全部失败在预期行为上，才允许改变模型可发布的 schema；严禁先改提示词再“希望模型会遵守”。
## 3. 原用户题贯穿验收（不是硬编码这道题）

原文“四边形 ABCD，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3；E/F 在边上定比分；AEF 沿 EF 翻至 PEF 且 PC=4√3”：先产生可核的 ABCD，再由比求 E/F，围绕 EF 由目标 PC **反求折角**，最终场景中 A/B/C/D/E/F/P 的点名与所有原题条件逐一回代。前后面片保留物理身份；正确解不依赖模型猜 P 坐标，不拿封闭四面体冒充两个开放面。改变根式、比例、折痕方向/端点、把条件改成矛盾、移走 ABCD 结构都要得到相应分支或清楚拒绝。**目前仅局部内核测试存在，整句真实桌面 Agent 仍失败；不可提前勾“已支持”。**

另配跨卷对照：2021/2024 三角边角面积与定比分点，2022/2025 椭圆/双曲线与动弦，2021/2024 外点切线与公切线及根数，2021/2024 的一般棱锥、2022/2023 的棱柱/棱台和 2025 的翻折。题面/预期图形结构均从[已完成的真题研究](../../research/2026-10-11-four-family-exam-diagram-survey.md)取得；工程实现必须防止只会画这一条翻折题。

## 4. 实施区块（作图、兼容、已确认缺陷和 Lean 各有独立出口）

### A. P0：修复计划合同、协议错误和成本账本

**修改范围**：`packages/agent-core/src/actionRegistry.ts`、`outputParser.ts`、`coordinator.ts`、`budget.ts`；`apps/web/src/agent/systemPrompt.ts`、`modelPlanner.ts`、`agentRunner.ts`。以小步骤按真实故障逐条先红后绿。

- [ ] **A1** 把用户 22:36 的两份失败计划做成跨 `planner → schema → stage → repair → UI` 的回归（只摘取必要字段，不把会话隐私入仓）：第一份少于四面的 `solid.create_polyhedron`，第二份三个未注册 `solid.create_segment`。分别报“平面片应使用 `solid.create_face` 且自身物化边”与“动作未注册”，而非同一句泛泛的 JSON 对象格式错误；保持未知动作严格拒绝。
- [ ] **A2** 动作合同单一来源与修复提示：使用真正允许的动作、必需输入和面/体差别；不加一个实际上没有 3D 单独线段语义的动作名来消除报错。对协议壳 `{"arguments":"..."}` 只给明确来源/形状诊断，未经证明等价不得自动解包。
- [ ] **A3** 记录每次模型、工具续接、修复的 generation/network 成本及停止原因；修复前预检剩余额度，预算终止也保留最近真实几何错误。默认额度保持不变，任何增加模型调用先另请用户裁决。

**出口**：上述用户轨迹可重复得到安全、具体诊断；已支持动作按同一 schema 真可达；旧合法计划及失败闭环均未回退。定向跑 `coordinator.test.ts`、`outputParser.test.ts`、`systemPrompt.test.ts`、`agentRunner.test.ts` 与新浏览器用例；核查额外 provider 请求数为 0（本区块离线验证）。

### B. P0：跨四家族的意图/条件合同与宿主缺席

**修改范围**：`packages/agent-core/src/obligationIR.ts`、`diagramObligations.ts`、`planCompiler.ts`、`solver/shapeGrammar.ts`、`solver/witnessSearch.ts`；`apps/web/src/agent/draftStore.ts`、Worker 适配层。沿用旧 `PlanEnvelope`/DSL 兼容路径，新增来源清晰、版本化的图形意图而非第二套解析器。

- [ ] **B1** 让模型声明点、环、面、曲线、函数、变换与联系对象（不要求先手算坐标）；`sourceSpan`/原话锚点、条件 ID、可判性在模型、编译、Worker、草稿、UI 中保持一致。旧 plan 的差异有明确迁移/降级口径。
- [ ] **B2** 模型完全漏画底面时判“缺结构”，而不是构造器救援后默默标完成；用户题面明确的宿主可由受约束意图构造时才自动生成，不能靠整句字符串或历史聊天猜对象。
- [ ] **B3** 对多条件图的“部分条件能读”的场景保留**原文全部义务**，模型改写经过既有四道阀；编译期、草稿层和 Worker/主线程复用同一题设核验触发及报告；有效/矛盾/欠定/未覆盖分型。

**出口**：漏 ABCD、改名/改比、额外未知原题条件的 RED→GREEN；原题八条条件全部有来源、可判和图元映射或显式未核验，不能有“图出来了但题设消失”的假绿。关旗 golden 仍保持其明确声明的兼容范围。

### C. P0：可组合求解与独立回代（先支撑原题，再泛化）

**修改范围**：`packages/geometry-kernel/src/witness/constructors.ts`、`solidShapeSpec.ts`、函数/圆锥求交与几何变换原语；`packages/agent-core/src/solver/`、`diagramVerification.ts`；`packages/scene-graph/src/actions/`。不把一套精确/数值数学判据复制到每一个调用层。

- [ ] **C1** 分点、垂足、线线/线面位置和参数化约束组合构造；`E=2/5 AD`、`F=1/2 AB` 的坐标由条件得出，随底面变化重算，多解选择写入可追溯假设。
- [ ] **C2** 面片翻折按目标距离/角/二面角求可行折角，枚举左右朝向和边界，保证刚体长度、非退化与连通；原用户题 `PC=4√3` 正例及将 PC 改成不可能值的反例都从图元独立量出来。
- [ ] **C3** 圆锥曲线动直线/动弦/切线、函数多交点/外点双切/公切线，先精确判重根和竖直线，再有界数值逼近；发现未覆盖或超时只给可读诊断，不给“已核对全部根”的假结论。

**出口**：构造成功、矛盾、欠定、未覆盖、超时分型各有测试；破坏构造或核验任一侧时对应原题正例与错图反例确实变红；不靠放宽容差“通过”错图。

### D. 四家族纵向交付包（共用 B/C，不按试卷编号特判）

| 包 | 必需的真题变形及工程边界 | 可验收的产品出口 | 进度 |
| --- | --- | --- | --- |
| **D-T 三角形** | 边角面积联立、分点/辅助线、SSA 与多解/退化/欠定；以调研中 2021/2022/2023/2024 的相关题型为原型 | 题面改名/改数/矛盾反例、实际 2D 画布角度/长度/点名回代，人工可读 | 未开始 |
| **D-C 圆锥曲线** | 椭圆/双曲线/抛物线参数反求、轴与焦点、动直线/弦/面积/切线/竖直分支、多曲线组合 | 真实曲线/交点图元与坐标回代、图形退化拒绝；非圆锥输入不能当某一曲线验收 | 未开始 |
| **D-F 函数与导数** | 定义域/分段/参数/多图、外点切线/公切/根数、极值/单调；采样与全称证明隔离 | 曲线、切点、断点和所有可判交点在画布可见；参数变化重绘，不能把画图说成证明 | 未开始 |
| **D-S 立体几何** | 多边形底面棱柱/棱锥直斜变体、球/圆柱/台体组合、分点/截面/翻折与二面角 | 真 3D 场景的顶点名/面环/虚实线/相机截图回代；原用户题完整回归和不同折叠真题 | 未开始 |

每包必须有**原题可用图、错误条件拒绝、欠定/多解、换名换数、实际浏览器画布**；先写会失败的业务测试，禁用“只断言提示文本或内核单函数”的假完成。`e2e/` 新增题目级专用 spec，按族独立复跑再跑全量；初始题库与未见过的留出题分开，避免把旧内部原创 12 条当真题证明。

### E. 实际场景、可读性、评测与默认启用门禁

**修改范围**：`apps/web/src/agent/` 真实草稿/确认/画布、场景图 2D/3D/函数适配与浏览器用例；`scripts/agent-eval.mjs` / 现有评测夹具；发布文档镜像。必要的 3D 约束拖动/空间线重合只在真实题有入口且阶段 D-S 依赖它时纳入，不把历史设计误当能力。

- [ ] **E1** 同一草稿内的截图、标签、图元、相机及点名来源一致，改题/撤销/拖动/切文档旧证据 stale；教师/学生实测“正确且看得懂”，视觉检查是独立门禁。
- [ ] **E2** 将本轮研究**已经确定**的原题来源、题号、原文条件与图形需求接入 Agent 的可执行评测夹具：按许可存来源链接/等级、题目输入、必要图/逐条件核验器、错图反例和留出集。测试 oracle 来自独立数学回代，**不用未经独立审定的转载解答当标准答案**；评析线索和无卷面来源仍不计金标。这是评测管线的工程接线，**不再安排任何“以后去调研真题”任务**。
- [ ] **E3** 在首次付费测量前冻结四族样本、通过条件和安全阈值；人批准后才做新 provider pass@1/pass@3、题设覆盖、失败阶段、成本/成功题、延迟与人评读图，旧 8×3 工具环或 3 条 planning 读数不得外推。缺价目表的成本记 `null`，不填 0。
- [ ] **E4** 正式验收默认开关、完整 e2e、全量非 Lean 单测、typecheck、lint、必要 Rust/打包、教师/学生走查和当前提交的 CI；Lean 自动证明的原题完整前提/发行链按 Task 15–17 **独立验收**，不能偷算作 Agent 作图成果。

**出口/停机规则**：已知错图被报告“全部条件通过”、题设无来源、欠定被误报为唯一、截图对应旧草稿、未授权新付费调用均阻止默认启用。每族按样本量和来源可信度公布通过/不支持/没测到的数字；正式阈值在运行付费/留出评测**之前**锁定，不事后挑阈值。

### F. 先守住既有功能（Task 14，P0，所有新代码之前）

**已有而不是下一步新发明的能力**：人工 2D/3D/CAD、保存与 `.mgeo`/HTML 导出、既有 S1–S6 局部形状、4 家族局部浏览器证据、Agent 默认关/开旗路径、确认/撤销与证明实验入口。先对当前 HEAD 跑可重复的旧路径基线，再改 Agent/Lean，避免“新真题过了、旧用户图坏了”。Task 14 按功能和来源记录旧读数及曾有抖动；历史旧提交的成功日志不得当新代码通过。

### G. 形式证明 Lean 的真实现况和待交付任务（Task 15–17，独立于普通作图）

| 现在有源代码/历史证据（不能删掉） | 仍未完成/不可越过的界限 | 实施任务 |
| --- | --- | --- |
| 受限四类目标 `perpendicular` / `linePlanePerpendicular` / `tangentSlope` / `lineInPlane` 的 canonical 模板和本机真跑；`proofPremiseBridge` 对前提标记 `fromText` / `fromDerivation` / `fromFigure` / `invented`。 | 模板前提有来源**不等于原题其余全部前提已经进 Lean 命题**；命题没有覆盖全题时只能称“受限目标/辅助引理”，不能说整题证明完成。曲线普遍性质/其它空间目标并未凭空支持。 | Task 15：原题条件清单与已形式化条件逐条对账，未纳入/无法表达就 fail-closed 或降级显示。 |
| `proofArtifact` 绑定 claim/inputHash/后端版本，检查 `#print axioms`、`sorryAx`；`automaticProof.ts` 不因失败阻断普通画图。设置 → 实验性功能已有 `proofExport` 开关且**默认关**，确认面板已能显示来源与“原题其余题设不进命题”。 | 真实桌面 UI 往返、编辑/切文档/重跑/慢证明返回后**产物与当前图/claim 是否仍相符**缺完整产品级验收；不能把浏览器“后端不可用”当桌面证明失败。 | Task 16：输入/工具链/证明产物版本和 stale，真实桌面与无工具链两路、用户可读降级。 |
| `proof/lean4/lakefile.toml` pin 具体 mathlib commit 与 `lake-manifest.json`，`lean-toolchain` pin 工具链；Rust `check_lean_proof` 只接窄模板、固定 argv/超时/输出上限。 | 7 GB 量级 mathlib/工具链如何在干净机器可用、冷缓存与热缓存耗时、离线/许可/无网隔离、打包来源和升级版本的 CI 仍未验收；不能默默带大依赖或放宽 Rust 源码白名单。 | Task 17：可复现的安装/可用性/沙箱/离线和包体决策，Lean 慢集成/Rust/桌面独立门禁。 |

**Lean 完成定义**：对**被接受的已覆盖目标**，证明产物的命题、每条来自原题的必要前提、系统引入的假设、后端版本/公理及草稿版本均可复核；条件缺失或模板不覆盖时显示受限引理/不支持，永不升到“整题已证”。用户可以继续确认正确作图，不强迫安装 Lean；真正完整原题证明只在整题所有必要前提均形式化并由后端验证的那一小类题显示。Lean/mathlib 的[上游项目](https://github.com/leanprover-community/mathlib4)只供 pin/缓存和类型边界参考，不能用上游能力充本仓已实现。

### H. 旧缺陷收口（Task 18；有确定复现才修，不把未测猜测写成 bug）

| 分类 | 记录与处理顺序 |
| --- | --- |
| **已见用户故障 P0** | 开放面错用 `solid.create_polyhedron` → 修复轮虚构 `solid.create_segment` → 泛化 JSON 错误：Task 1/2；共享预算挡修复且覆盖有用诊断：Task 3；未有真图前这些不能标“已修”。 |
| **能力声明/产品入口错位 P1** | `capabilities.ts` 把空间 `constraint-authoring` 记 `available`，而题面/Agent/界面均无 authoring 路径。先加“展示能力必须有用户路径”的红测试，再按**真实已有操作**收窄可用范围或明确实验/不可用；不要在没有用户需求的情况下暗中实现全空间重合约束。 |
| **边界输入 P1** | 既有台账指出 `relations:[null]` / `unverified:[null]` 非法值会抛：先确认通过哪条公共边界进入，再让 schema fail-closed 且保留字段路径，不能把它误报成数学矛盾。 |
| **文案/安全限制 P2（需裁决）** | 用户可见诊断曾报“题设要求 0”而 golden 钉着原文：独立复现、给出只改变文案的 diff 与 golden 迁移影响，**获用户同意后**才放宽该逐字合同。`>1MiB` 响应、未知空间约束、超时中止是安全限制，不擅自放大上限或误报“已经修好”。 |
| **已修历史回归** | 本轮换工作区导致的 `stale_draft`、根式/冒号比例读入、折后点名表、平面/立体工作区切换、顶点标签顺序等**不重新标未实现**；Task 14/18 把它们纳入回归，若再次失败才重新归类。 |

## 5. 历史未解问题与发布边界（每项都有归属）

| 遗留事项 | 归属 / 状态边界 |
| --- | --- |
| 误造 `solid.create_segment`、拿 `polyhedron` 画开放面、协议壳、泛化 JSON 错误、修复轮共享预算/有用诊断被覆盖 | **A**；截至本文件为用户现场失败，尚未修。不得“给更多重试”替代结构或动作合同。 |
| 缺 ABCD 宿主、B/C/D 系统构造只救有承载面的计划、E/F 未统一构造、`PC` 目标未求根 | **B/C/D-S**；`solid.fold` 的给定折角测试已存在，原整题仍未走通。 |
| 已修过的本轮换工作区 `stale_draft`、解析根号/冒号比例、折后点名表映射 | **Task 14/18 防回归**；不重报为“完全未实现”，用户自己编辑/导入/外部切换仍拒绝旧草稿。 |
| 三角 SSA、非首位数值角、n≥5 底面角、顶点作角、斜棱柱/空间约束入口等 | **C/D 对照真题逐项支持或安全拒绝**；现有 S1–S6 局部能力不代表所有变体已通过。 |
| 真 provider 小样本与 1 MiB 响应限制、成本缺定价、教师走查未做 | **E**；预算裁决与新付费请求先问用户；已有小样本与新真题评测不能混算。 |
| 四目标类的前提桥不等于原题完整命题、慢证明迟到/桌面真往返/Lean/mathlib 发行未验，已发布旧包比源码旧 | **Task 15–17 独立的 Lean 正确性/生命周期/发行门禁**；作图端成果不能升级成原题普遍证明，正确作图也不因 Lean 不可用而阻断。 |

## 6. 开工与收口操作（本文件的进度更新纪律）

- **固定顺序不再按任务号大小推断**：Task 14 先量旧能力；Task 1→2→3→18a 收紧协议与边界；Task 4→5 冻结图形意图/物化接口；Task 12a 验 Worker 同版；随后按四家族真实依赖执行 Task 6–11 与 Task 12b/13。Lean Task 15→16→17 依赖稳定的原文锚点与产物绑定，但有自己的门禁，不阻塞普通作图。精确前置和可并行范围只以本节 O1 表为准。
- 最少运行 `npm.cmd run typecheck`、`npm.cmd run lint`、针对区块的 `npm.cmd exec vitest run -- ...`、必要 `npm.cmd run test:e2e -- ...`；宣布“全库/全量通过”前必须在**该版本**真正运行对应全量命令。付费/provider、Rust/Lean、打包、人工走查分别给可核对记录，不能用其它门禁代替。
- 每交付一块更新 [当前状态](../../current-status.md)、[能力目录](../../feature-catalog.md)、[发布门禁](../../acceptance/agent-release-gate.md)、[记分卡](../../acceptance/agent-tool-loop-scorecard.md)、[README](../../../README.md)；本文件只勾**实际完成**的区块并写提交/测试证据，[项目进度归档](../../project-progress.md)只记过程，不改旧快照数字。
- 本轮文档没有产品代码/新运行证据。**下一次代码批次先做 Task 14 的旧路径兼容基线与 Task 1 的原用户轨迹最小复现**；A/B/C/D/E 与 Lean/缺陷任务今天均未勾。用户真实题成功、四族 provider 质量与原题级 Lean 均待实施和测量。

### O1 固定执行波次（2026-10-11；**Task ID 永不重排**）

以下是**唯一**可作为开工顺序的依赖表。表中“可并行”只表示不同实现切片在前置 GREEN 后**可以**互不阻塞，不要求调度子代理；同一文件（如 `planCompiler.ts`、`diagramVerification.ts`、`draftStore.ts`）不得同时由两块无协调地改。任一阶段失败先修对应 RED，不回头靠多调模型/放宽核验补绿。

| 波次/执行指针 | 前置已核证的出口 | 本次只做的工作 | 可以进入下一波的证据 |
| --- | --- | --- | --- |
| **W0：先保护历史** | 本轮文档计划可读、工作树状态已记录；尚不修改产品代码。 | **Task 14**：在当前 HEAD 跑旧 2D/3D/CAD/导出/Agent 开关/撤销与受限 Lean 单测。记录已知旧红灯的复现、原因和归属；未分类的旧红不跳过。 | 有日期/SHA/命令/输出与旧 golden 清单；若有真实旧缺陷，优先归 Task 18 或标明不阻碍哪一个切片，不伪写“基线全绿”。 |
| **W1：止住协议错误** | W0 有可复验基线。 | 严格顺序 **Task 1 → Task 2 → Task 3 → Task 18a**。18a 只管 `relations:[null]`/`unverified:[null]` 的公共 schema 边界；Task 18b 的能力表错位可在本波后独立做，最迟 Task 11 前。 | 22:36 双轮失败有正确诊断、动作菜单/处理器同源、生成账本不重复计费且没提默认额度；非法输入 fail-closed。更改同一 schema 的任务不并行。 |
| **W2：冻结共享意图接口** | W1 GREEN 且旧关旗路径回归。 | **Task 4 → Task 5 → Task 12a**（先只做 Worker/主线程的类型与版本同判）；`Task 13a` 的离线评测夹具可在 Task 5 GREEN 后接入，**不运行付费模型**。 | `FigureIntentV1`、原文条件 ID、宿主构造/别名及 `DiagramVerificationReport` 在编译/草稿/Worker 同版；缺宿主或未知从句如实拒绝。接口在此冻结；后续若改字段须重跑 W2+旧基线。 |
| **W3：四家族纵向切片** | W2 的共用合同 GREEN。 | **Task 9 圆锥、Task 10 函数**可分别启动；**Task 6 分点 → Task 8 三角**，并在 Task 6 后做 **Task 7 目标折角 → Task 11 立体**。Task 18b 空间 `constraint-authoring` 能力声明最迟在 Task 11 的用户路径验收前裁定。 | **每一族**自己的正例/错图/欠定/换数、实际画布入口与独立回代可独立验收；一族通过不得将另外三族标绿。旧导出/开关/点名每块复跑受影响切片。 |
| **W4：画布和真实质量** | 目标家族已过 W3 且有本族草稿；四族都过才讨论四族统一放行。 | **Task 12b**：同草稿真实截图/标注/相机/撤销/迟到数据；**Task 13b**：先冻结样本、阈值、费用，经用户授权才发 provider；**Task 13c**：全量、教师/学生、桌面和该 HEAD CI。 | 各族统计有真实分母/成本/失败阶段；图证据不能 stale 或遮挡；默认 Agent 只有在四族和旧功能门禁都过后才能另行裁决。 |
| **L：Lean 独立支线** | **Task 4** 的原题条件 ID 已稳定；**Task 12a** 的版本合同给 Task 16 使用。 | **Task 15** 原题与受限引理分级 → **Task 16** 迟到产物/UI → **Task 17** 本地真 Lean、Rust、离线/冷机/发行。可与 W3 四族**在不改同一接口时**并进；`Task 18c`（黄金样本文案）等用户裁决，不挡独立支线。 | 先保四类历史受限目标；全题证明仅在每个必要原题前提进入命题且真正被验后单独启用。Lean 不可用不挡正确作图；自动 Lean 的默认放行**另签门禁**，不随 Agent 作图一键开启。 |

**单一执行指针**：W0 的 Task 14 基线是下一项；其记录完成才进入 W1 Task 1。每个工作块只能从 `待做 → RED 已复现 → GREEN 定向 → 产品/兼容门禁 → 完成` 正向移动，必要时退回 `RED` 并登记原因；`docs/current-status.md` 的数字按当次 HEAD 写、旧进度文档不重排或复写。本计划的 Task 1–18 编号/链接固定；除非新用户要求或有可重复的 P0 安全/错图证据，不能因“更容易实现”临时调换波次。**确需调整**时，在此表记前置、影响文件、被推迟的验收和用户裁决，再同步各进度镜像；未授权付费、扩大模型额度、放宽 Lean 源码白名单不属于自动调整。

## 7. 作图升级可执行任务卡（Task 1–13）

> **执行入口与节奏**：在 `D:\draw\draw` 运行以下命令。每张卡只有一类可拒收的成果；先提交会因业务行为失败的测试并见到预期 RED，再修改生产代码、见到 GREEN，最后复跑所列旧测试。以下“新建”指将来实现时创建，**本轮仅文档，所有复选框均未勾**。GitHub 项目只借用[本轮源码调研](../../research/2026-10-11-github-agent-implementation-survey.md)明确列出的依赖传播/失败分类/视觉测试方法，不复制代码或加入依赖。凡提到真题，均引用[已完成的真题研究](../../research/2026-10-11-four-family-exam-diagram-survey.md)的题号及摘要；样本转换成测试工件是 Agent 验收的工程工作，不是重新安排研究。

### Task 1｜把 22:36 两轮错误变成有用、精确的失败（A1）

**文件**：改 `packages/agent-core/src/coordinator.test.ts`、`outputParser.test.ts`、`outputParser.ts`；改 `apps/web/src/agent/agentRunner.test.ts`、`agentRunner.ts`。不动动作语义或默认预算。

- [ ] 从用户轨迹只摘动作名、必需字段和两次状态迁移制成脱敏夹具：第一份不足四个面的 `solid.create_polyhedron`，第二份三个 `solid.create_segment`。**RED**：在第二轮 UI 必须出现“未注册动作 solid.create_segment”、其三个路径和先前“开放图形不要用闭合多面体”，不能被泛化成“JSON 顶层形状不合法”；目前后一条不满足。不得把这个动作自动改成别的动作。
- [ ] 把 `unknown_action` 与 `invalid_json` / 顶层形状分开生成可见诊断；在修复提示中按失败字段给“`solid.create_face` 自带面边；不要额外找 solid.create_segment”的**操作**，继续用严格 `parsePlanEnvelope` 作为安全闸。信封类额度用尽时用户仍能看到真正的上一条拒绝理由。
- [ ] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/coordinator.test.ts packages/agent-core/src/outputParser.test.ts apps/web/src/agent/agentRunner.test.ts --reporter=dot`。**GREEN** 应同时保住旧的合法计划、散文/不合法 JSON 被拒、不准静默跳过动作。**阶段成果是正确拒绝与反馈，不是这道题已经自动画出。**

### Task 2｜单一动作菜单与原生工具合同（A2）

**文件**：`packages/agent-core/src/actionIds.ts`、`actionRegistry.ts`、`schemas.ts` 与对应测试；`apps/web/src/agent/systemPrompt.ts`、`systemPrompt.test.ts`、`modelPlanner.test.ts`。现有处理器在 `packages/scene-graph/src/actions/index.ts`。

- [ ] **RED**：对全部 `DRAFT_ACTION_IDS` 枚举校验“处理器/输入 schema/工具发布/提示词菜单”一致；另给 `solid.create_segment`、未知字段及把 `{arguments:"..."}` 字符串当整个计划的反例。预期未知动作报路径/许可菜单而不是执行，协议壳未经声明不被偷偷拆开。
- [ ] 对齐注册表与 `buildPlanToolSchema`/`buildPolicyText`，按场景只发布相关动作及最少需要的输入说明；明确**开放的面→`solid.create_face`、闭合实体→`solid.create_polyhedron`、折→`solid.fold`**，面本身物化顶点/边。与已有的平面 `planar.create_segment` 严格区分；不要注册不存在语义的 3D 线段动作凑数。
- [ ] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/actionIds.test.ts packages/agent-core/src/schemas.test.ts apps/web/src/agent/systemPrompt.test.ts apps/web/src/agent/modelPlanner.test.ts --reporter=dot`；坏名字必须失败、合法动作必须可达。缩短提示词时断言未意外删除已有圆锥/函数/立体动作菜单。

### Task 3｜修复额度与真实生成账本一致（A3；不得自行加钱）

**文件**：`packages/agent-core/src/coordinator.ts`、`coordinator.test.ts`、`budget.test.ts`；`apps/web/src/agent/modelPlanner.ts`、`modelPlanner.test.ts`。

- [ ] **RED**：重放“初问→只读工具续接→编译修复→下一轮”四次 generation 消耗，同时断言每次发请求前 remaining 数、计费主体和最后几何错误。当前已有 `budget_repair` 盖掉原诊断、名义有编译类两次但第三轮请求送不出的反例。
- [ ] 定义一个**每次 provider 请求只由一个层计费**的账本合同；如果现有实现经测试确实重复计费，修复重复那一次；如果没有重复，保留成本限制并在修复前明确告知剩余次数。保留 `generation:4`、`network:6` 和信封/编译修复上限不变，不为过测试隐性加请求。用户需另行决定是否付费增加额度。
- [ ] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/budget.test.ts packages/agent-core/src/coordinator.test.ts apps/web/src/agent/modelPlanner.test.ts --reporter=dot`；未实际发出的请求不得计为成功修复；错误停止时保留最有用的原始错误和完整账本。

### Task 4｜定义跨四家族的图形意图与题面出处（B1/B3）

**文件**：新建 `packages/agent-core/src/figureIntent.ts`、`figureIntent.test.ts`；改 `diagramObligations.ts`、`obligationIR.ts`、`contracts.ts`、`index.ts` 及相关测试。先不改画布。

- [ ] **RED**：题面八条条件在解析、意图与核验报告间必须保持相同的条件 ID、原文片段位置与点名；混入第九条读不懂的条件必须随结果保留 `unverified`；条件无法表达时不能被模型自动改弱。兼容已有 `solid.*` 计划作为旧分支。
- [ ] 加版本化 `FigureIntent` 联合：`triangle|conic|function|solid` 的拓扑、命名对象、来源条件引用、派生点/变换关系。只容纳**结构和条件引用**，坐标由构造器决定；旧 `PlanEnvelope` 经窄适配继续可读。提议的 `sourceSpan` 应复用现有 `DiagramSourceSpan`，不要再手抄第三套。
- [ ] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/figureIntent.test.ts packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/obligationIR.test.ts --reporter=dot`；证明新联合对多解/未核/工作区都有有类型的去向，再开放模型输出它。

### Task 5｜缺宿主时安全地从意图落到现有动作（B2）

**文件**：新建 `packages/agent-core/src/figureMaterialisation.ts`、`.test.ts`；改 `planCompiler.ts`、`planCompiler.test.ts`、`apps/web/src/agent/draftStore.ts` 与 Worker 合同测试。

- [ ] **RED**：同一 ABCD 原文、模型完全没有 `solid.create_face` 宿主时，现有 `withWitnessCoordinates` 不能无中生有；为“题面明确平面四边形、点名唯一、已有条件能认”准备结构明确的生成测试，并配“两个竞争四边形”“点名和动作冲突”必须拒绝的反例。
- [ ] 将 `FigureIntent` 通过窄适配物化为已有 `solid.create_face` 等动作；**先校验形状/名字的唯一性，再生成宿主**，交给 `compilePlan` 和同一草稿事务；禁止为凑宿主填随机坐标后在核验器前跳过检查。若生成条件不足，反馈“缺结构/欠定并有自由选择”，不是“已经按题面生成 BCD”。
- [ ] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/figureMaterialisation.test.ts packages/agent-core/src/planCompiler.test.ts apps/web/src/agent/diagramDraftStage.test.ts apps/web/src/agent/workerContracts.test.ts --reporter=dot`；Worker 和主线程不得不同判，关旗旧路径与已宣称的 golden 保持兼容。

### Task 6｜派生分点与动态依赖（C1；先三角/四边形共用）

**文件**：`packages/geometry-kernel/src/witness/constructors.ts`、`witness/constructors.test.ts`、`dynamic-points.ts`；`packages/agent-core/src/diagramVerification.ts`、测试；`packages/geometry-kernel/src/dependency-graph.ts`、`packages/scene-graph/src/actions/index.ts` 的确需变化时才改。

- [ ] **RED**：ABCD 坐标变化后 E 必须仍在 AD 上且 AE:AD=2:5、F 必须仍在 AB 上且 AF:AB=1:2；交换 AD/DA 与 AF/FB 的输入时方向/比例不可乱；E/F 同名冲突、端点重合及两份计算得出不相容位置要拒绝。
- [ ] 把“点在已命名边上、按比例产生”变成由宿主点名和无量纲参数定义的派生对象（非模型手写点坐标），运行时投影/更新走现有依赖机制；`diagramVerification` 从最终点重新量比例而不直接相信参数值。借 GeoGebra 的**依赖设计模式**，不移植其代码。
- [ ] 运行 `npm.cmd exec vitest run -- packages/geometry-kernel/src/witness/constructors.test.ts packages/geometry-kernel/src/dynamic-measurements.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；改底面与撤销后草稿/坐标/报告需同版本，算出来的点能真正显示。

### Task 7｜由目标 PC 反求翻折角，不能只接收给定角（C2）

**文件**：`packages/geometry-kernel/src/rotation3d.ts`、`witness/constructors.ts`、对应新测试；`packages/scene-graph/src/actions/solidFoldAction.test.ts` 与 `actions/index.ts`；`packages/agent-core/src/diagramFoldPoints.test.ts`、`diagramVerification.ts`。

- [ ] **RED**：以用户原题中经独立回代的 ABCD/E/F 为输入，不提供模型猜的 P 或角，要求系统在允许的 `(0°,180°]` 中求出使 `PC=4√3` 的折角；反向折痕、修改 PC 无可行解、折痕退化/翻折后面重合分别判对。原先 `solid.fold(angle=90)` 的单测不得冒充这条 RED。
- [ ] 对**固定点到旋转后点的距离**优先利用 `rotateAboutAxis` 所确定的三角关系解析枚举候选角；更一般的目标关系才进行有上界的区间搜索，并把找不到根与不能证明无解分开。每一候选交既有 `solid.fold` 物化，核验器从最终 P/C 坐标重算 PC、折痕不动与被折面刚体长度；多支保留来源/选择，不凭 90° 特判。
- [ ] 运行 `npm.cmd exec vitest run -- packages/geometry-kernel/src/witness/constructors.test.ts packages/scene-graph/src/actions/solidFoldAction.test.ts packages/agent-core/src/diagramFoldPoints.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`。此任务过后仍需 Task 5/6 与真实产品 Task 12 才能说“整题能画”。

### Task 8｜三角形纵向交付包（D-T）

**文件**：`packages/geometry-kernel/src/witness/constructors.ts`、`packages/agent-core/src/solver/witnessSearch.ts`、`diagramVerification.ts`；扩 `packages/agent-core/src/solver/planarFigure.test.ts`；新建 `e2e/agent-exam-triangle.spec.ts`。

- [ ] **RED**：用真题研究的 2021/2022/2023/2024 边角面积/边上分点结构（遵守来源许可）加换点名、改角度、SSA 两解、无解、欠定、角顶点写错的错图；不能只断言“生成了点”。
- [ ] 先做边/角/面积联解与分支选择，再物化点边辅助线；已有 `planarAngle` 与自交判据只保留一份。输出自由度/两解选择来源；从实际图量边、角、面积、方向。
- [ ] `npm.cmd exec vitest run -- packages/agent-core/src/solver/planarFigure.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-exam-triangle.spec.ts --workers=1`。需有真实 2D 截图/可读标注与一步撤销，反例不能出“全部核验”。

### Task 9｜圆锥曲线纵向交付包（D-C）

**文件**：`packages/geometry-kernel/src/conics.ts`、`curve-intersections.ts`、`curve-tangents.ts` 及测试；`packages/agent-core/src/diagramObligations.ts`、`diagramVerification.ts`；扩 `e2e/agent-conic-kinds.spec.ts`，新建 `e2e/agent-exam-conic.spec.ts`。

- [ ] **RED**：2021/2022/2024/2025 真题的焦点/轴向/渐近线、动弦/面积、多曲线组合、相切/无交/竖直线、错轴反例；2024Ⅰ-11 非圆锥曲线必须明确不归为椭圆/双曲线。
- [ ] 优先复用现有椭圆/双曲线/抛物线 primitive 与交点内核；新求解只补真实缺的“条件反求曲线参数 + 动直线/弦/切线”接口，切触用代数重根或可验证切向条件，不用画面采样宣称恰有 n 个交点。用最终曲线参数、焦点和实际交点回代，残差与数值近似可见。
- [ ] `npm.cmd exec vitest run -- packages/geometry-kernel/src/conics.test.ts packages/geometry-kernel/src/curve-intersections.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-conic-kinds.spec.ts e2e/agent-exam-conic.spec.ts --workers=1`。错误轴/丢一交点测试必须真红。

### Task 10｜函数与导数纵向交付包（D-F）

**文件**：`packages/geometry-kernel/src/calculus.ts`、`evaluate.ts`、`curve-intersections.ts` 及测试；`packages/agent-core/src/diagramVerification.ts`；`apps/web/src/agent/localPlanner.ts` 与现有函数图入口；扩 `e2e/agent-function-tangent.spec.ts`，新建 `e2e/agent-exam-function.spec.ts`。

- [ ] **RED**：2021Ⅰ-7 外点双切线、2022Ⅰ-22 多交点、2024Ⅰ-7 三角图相交和第 13 题公切线；反例为断点被连线、错切点、漏近重根、把一个参数实例写成“所有参数成立”。
- [ ] 为函数定义域/参数来源/分段与切点建立类型化关系；可由代数或经独立验算的数值根构造切线/交点时才称已核验，“数值图像”与“全区间根数/单调性已证明”分开状态。图像随参数重绘、切点标签与导数读数同源；未覆盖的抽象函数题安全解释，不能编出唯一图。
- [ ] `npm.cmd exec vitest run -- packages/geometry-kernel/src/calculus.test.ts packages/geometry-kernel/src/curve-intersections.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-function-tangent.spec.ts e2e/agent-exam-function.spec.ts --workers=1`。同一题的数值画图成功不得升级为形式证明。

### Task 11｜立体几何纵向交付包（D-S）

**文件**：`packages/geometry-kernel/src/witness/constructors.ts`、`prism.ts`、`sections3d.ts`、`measurements3d.ts`，`packages/scene-graph/src/actions/index.ts`；扩 `packages/agent-core/src/diagramVerification.test.ts`；新建 `e2e/agent-exam-solid.spec.ts`。

- [ ] **RED**：研究中的 2021/2022 棱柱/棱锥、2023 棱台/棱柱、2024 四棱锥与 2025Ⅱ-17 翻折；变化底面数、顶点垂足不在中心、斜棱柱、棱上/面上点、二面角、展开与组合实体。必须有“图形很像但缺 B/C/D 或折后 P 错”的负例。
- [ ] 先复用 S1–S6 已有形状数据化与 `solid.create_face`/`fold`，仅对真题反例逼出的空间角/截面/组合关系补构造与核验；开放面片不装成 polyhedron，球/圆台近似保留误差文字。不为没有产品入口的空间 `coincident` 单独造隐形约束。
- [ ] `npm.cmd exec vitest run -- packages/geometry-kernel/src/witness/constructors.test.ts packages/scene-graph/src/actions/solidFoldAction.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-exam-solid.spec.ts --workers=1`。原用户题必须从输入到真实草稿/画布/确认/撤销，七点与八条题设逐一可查；仅内核单测通过不勾 D-S。

### Task 12｜Worker、场景依赖和可读画布同版本（E1）

**文件**：`apps/web/src/agent/geometryWorkerHost.ts`、`workerContracts.ts`、`draftStore.ts`、`agentRunner.ts` 及测试；已有 `packages/geometry-kernel/src/dependency-graph.ts`；新增 `e2e/agent-exam-visual-and-stale.spec.ts`。

- [ ] **12a／W2（共用版本合同）RED→GREEN**：Task 5 的同一图形意图经主线程/Worker 物化后的图元、条件 ID、点名和报告版本必须相同；输入改版后迟到 Worker 结果不能写进当前草稿。先写 `workerContracts.test.ts`/`geometryWorkerHost.test.ts` 会因版本或序列化不同变红的用例，再只调整 Worker/草稿传输。运行 `npm.cmd exec vitest run -- apps/web/src/agent/workerContracts.test.ts apps/web/src/agent/geometryWorkerHost.test.ts apps/web/src/agent/draftStore.test.ts --reporter=dot`。**此时不宣称视觉或桌面可用**；12a GREEN 才允许 Task 16 复用图版本合同。
- [ ] **12b／W4（画布/交互证据）RED→GREEN**：四家族每族已有真图后再加 `e2e/agent-exam-visual-and-stale.spec.ts`，用改题/改 AB/撤销/切文档/取消拖动和截图旧版本、点名遮挡、3D 虚实线/相机不可见做反例；仅查内存文档不算视觉通过。利用现有依赖图让分点→折面→交点随宿主重算，并把截图与证据绑草稿版本/哈希；运行 `npm.cmd run test:e2e -- e2e/agent-exam-visual-and-stale.spec.ts --workers=1`，浏览器/桌面各留真入口读数，教师/学生可读性另签收。数学真伪仍由独立核验器提供。

### Task 13｜离线真题评测工件、真实 provider 与发布决策（E2–E4）

**文件**：`apps/web/src/agent/fixtures/benchmarkPlanningEval.ts`、`scripts/agent-eval.mjs`、`packages/agent-core/src/benchmark/` 的现有指标和测试；`docs/acceptance/agent-release-gate.md`、`docs/current-status.md` 等镜像。

- [ ] **13a／W2（无付费评测工件）**：Task 5 后把**已完成调研**中许可允许的原题条件/图需求接到现有 `benchmarkPlanningEval.ts` 和 `scripts/agent-eval.mjs`：卷别、题号、来源等级、输入许可、必要图、独立条件回代/错图/欠定反例和留出集。先写“未审转载答案不能充 oracle、同一原题变式泄露进留出集”红例，再由离线工具转绿；这是 Agent 评测**工程接线**，不是将研究推给下轮。
- [ ] **13b／W4（真实质量）**：四族 Task 8–12b 各有端到端真图后，先离线拆出 plan/schema/构造/核验/可读性的失败分布；**在**看到付费结果前冻结每族样本、pass@1/pass@3 与人评/延迟/费用阈值并取得用户对请求数及最高费用的授权，方可运行真实 provider。一次成功、同轮修复成功与独立三次成功分别计，旧 8×3 工具环不替代真题四族结果。
- [ ] **13c／W4（发布收口）**：所涉区块 GREEN 后完整运行 `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd test -- --maxWorkers=2 --reporter=dot`（Lean 慢集成单列）及 `npm.cmd run test:e2e`；Rust/桌面桥变更另跑 Rust/打包。教师/学生读图、桌面来源/哈希、该 HEAD 的 CI 与默认开关单独留据。Task 15–17 的 Lean 证明另签门禁；**没有这些证据默认 Agent/自动 Lean 都不放行**，不能凭一题通过外推一族覆盖。

## 8. 旧功能、Lean 与已知缺陷：可直接执行任务卡（Task 14–18）

> **依赖与并行只看 O1 表**：Task 14 基线先行；Task 18a 排在 Task 2/3 后而在 Task 4 前，Task 18b 最迟在 Task 11 的可达性验收前。Task 15 等 Task 4 条件 ID 稳定；Task 16 等 Task 15 + Task 12a，Task 17 等 Task 16。可与四族数学切片在**不同时写共享合同文件**的前提下并行。Task 18c 的文案合同改动等用户裁决；Lean 放行与普通作图是两把不同的锁。

### Task 14｜保护已交付能力：升级前基线与每块后回归（P0）

**文件/测试**：新增 `apps/web/src/agent/legacyCompatibility.test.ts`（仅钉新旧合同差异，避免复制每个旧测试）；已有 `apps/web/src/agent/featureFlags.test.ts`、`planWorkspaces.test.ts`、`draftStore.test.ts`、`apps/web/src/persistence/fileExports.test.ts`、`packages/dsl/src/codec.test.ts`、`packages/agent-core/src/proof/proofArtifact.test.ts`；浏览器 `e2e/agent-planar-triangle.spec.ts`、`agent-conic-kinds.spec.ts`、`agent-function-tangent.spec.ts`、`agent-oblique-prism.spec.ts`、`agent-constrained-drag.spec.ts`、`html-export.spec.ts`、`next-phase-flag-entry.spec.ts`。

- [ ] **先量旧 HEAD，不先改实现**：将人工绘图、`.mgeo`/HTML 读写、已交付 S1–S6 实验入口、点名/撤销、默认关时旧路径、`proofExport` 设置入口/确认面板各跑一遍，记录命令、时间、失败类别、抖动复跑和当前工作树 SHA。存在红灯则先诊断是旧问题/环境/本轮变更，不能在新功能任务里将旧红灯悄悄标绿。
- [ ] **RED**：在新增兼容测试里故意使旧 `proofExport=false` 也出现证明栏、换工作区修复轮复发 `stale_draft`、丢失旧 `.mgeo` 点名、`dynamic.*` 又切进 3D；每种破坏应使对应旧测试/新增合同真红，恢复源码后复绿。只在确有覆盖缺口时增加一条测试，不为测试数量新造旧功能。
- [ ] 命令：`npm.cmd exec vitest run -- apps/web/src/agent/featureFlags.test.ts apps/web/src/agent/planWorkspaces.test.ts apps/web/src/agent/draftStore.test.ts apps/web/src/persistence/fileExports.test.ts packages/dsl/src/codec.test.ts packages/agent-core/src/proof/proofArtifact.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-planar-triangle.spec.ts e2e/agent-conic-kinds.spec.ts e2e/agent-function-tangent.spec.ts e2e/agent-oblique-prism.spec.ts e2e/agent-constrained-drag.spec.ts e2e/html-export.spec.ts e2e/next-phase-flag-entry.spec.ts --workers=1`。完整默认发布仍需全库/全量，定向通过只是基线。每完成 Task 1–13/15–18 的跨层改动后重复适用切片，发现旧路不同只能附明确受用户同意的迁移依据。

### Task 15｜Lean 命题真的是“原题”还是只有受限引理（P0，证明正确性）

**文件**：`packages/agent-core/src/proof/proofGoalReader.ts`、`proofGoals.ts`、`proofPremiseBridge.ts`、`canonicalProof.ts`、`lean4Adapter.ts`、`automaticProof.ts` 及同名测试；复用 `packages/agent-core/src/obligationIR.ts` 原文 span/ID。禁止更改 Rust 的模板白名单来给未证事实放行。

- [ ] **RED**：原题加上“底面形状、点在边上、P 在面外、给定角/长度”中任一必要条件，而 Lean 模板只用了两条垂直前提时，产物不得显示为“原题已证”；缺前提、`fromFigure` 无实际物化点名、`invented` 非空、题设与图互相矛盾时不能升 `formally_proved` 的**整题级**。已有四目标类作受限引理的正例必须继续有效。
- [ ] 建 `ProofScopeReport`：`goalSourceId`、每一原题条件的 `formalized | dischargedByNamedDerivation | figureAssumption | notRepresented` 与源 span、选定的图实例/自由参数，明确结局 `limited_lemma | whole_problem | unsupported`。**只证明模板定理时默认 `limited_lemma`**；只有全题每条必要前提与目标都进入 Lean 命题、没有未核验/假设/弱化，且后端验过，才可能 `whole_problem`。没有可用的曲线普遍性质模板时直报 unsupported，不把函数采样、实例图或 `sorry` 当证明。
- [ ] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/proof/proofGoalReader.test.ts packages/agent-core/src/proof/proofGoals.test.ts packages/agent-core/src/proof/proofPremiseBridge.test.ts packages/agent-core/src/proof/canonicalProof.test.ts packages/agent-core/src/proof/automaticProof.test.ts --reporter=dot`；四受限目标的原有真例仍通过，新增“多一条原题条件”的反例不得升整题。**没有新的完整原题 Lean 命题产物，不勾 whole_problem。**

### Task 16｜证明产物、旧图编辑和桌面 UI 的异步一致性（P0/P1）

**文件**：`packages/agent-core/src/proof/proofArtifact.ts`、`automaticProof.ts`；`apps/web/src/agent/automaticProofStage.ts`、`draftStore.ts`、`desktopProofChannel.ts`；`apps/web/src/components/settings/ExperimentalFeatures.tsx`、`components/agent/ConfirmationPanel.tsx` 与同名测试；新增 `e2e/agent-proof-lifecycle.spec.ts`（浏览器降级/设置入口）及需要桌面人工走查的步骤。

- [ ] **RED**：开启开关开始慢证明，在后端返回前改题/改图/撤销/切工作区/导入别的文档；旧产物必须标 `stale` 或丢弃，不能贴到新 claim 或图上。`claimId` 匹配但 `inputHash`/后端版本/自由选值不匹配一样拒；坏 IPC 不能变“已证明”；关旗无调用且确认面板没有证明栏。
- [ ] 让证明请求/回包/`ProofScopeReport` 绑同一草稿文档 ID、原文条件 ID、图版本/哈希、目标 claim 和后端版本；完成时先复查实时句柄，禁止迟到结果升级现有图。UI 分开显示“受限引理已证/原题完整证明（仅符合 Task 15 时）/不支持/超时/无桌面工具链/过期”，始终展示来源与系统附加选择；**证明失败或不可用不得阻断合题设的图的确认**。已有设置开关不新建第二个偏好存储。
- [ ] `npm.cmd exec vitest run -- packages/agent-core/src/proof/proofArtifact.test.ts packages/agent-core/src/proof/automaticProof.test.ts apps/web/src/agent/automaticProofStage.test.ts apps/web/src/agent/desktopProofChannel.test.ts apps/web/src/components/settings/ExperimentalFeatures.test.tsx apps/web/src/components/agent/ConfirmationPanel.test.tsx --reporter=dot`；`npm.cmd run test:e2e -- e2e/next-phase-flag-entry.spec.ts e2e/agent-proof-lifecycle.spec.ts --workers=1`。浏览器只能验“不可用但不影响作图”；**桌面真实开旗→一次 Lean→用户确认→改题/撤销**必须另留实际 UI/IPC/版本证据，不以 mock 冒充。

### Task 17｜Lean/mathlib 固定版本、安全边界与真实发行（P1，不自动下载）

**文件**：`proof/lean4/lean-toolchain`、`lakefile.toml`、`lake-manifest.json`、`README.md`；`packages/agent-core/src/proof/lean4Toolchain.ts`、`lean4Adapter.ts`、`proofBackendReview.ts`；`apps/desktop/src-tauri/src/proof/mod.rs`、`source.rs`、`commands/proof.rs`；`scripts/proof-spike/lean4EndToEnd.test.ts`、`lean4TemplateAllowlist.test.ts`。不把 7GB+ 的展开目录提交进 Git。

- [ ] **先固定现状**：比较 `lean-toolchain`、mathlib `rev = c20717ea…` 与 `lake-manifest.json`，记录 `lake env lean --version`、冷/热缓存、当前证明四类/公理白名单的实测输出。首次下载、升级 mathlib、复制缓存或改变桌面发行体积**需单独征得用户同意和许可核对**；不能因本任务默认运行 GB 级网络更新。现有工程 README 原来误称“四个工程文件”，lockfile 已在仓，文档纠为五个工程文件（另有 README）而不假称工具链随包。
- [ ] **RED**：无配置/错误版本/离线无缓存、模板里 `#eval`/任意 import/`sorry`/额外公理、进程超时/异常退出、证明内容与产物版本不符都不能升级结论。安全测试必须保持 Rust 侧的**仅模板源码、固定 argv、明确工具链路径、墙钟/输出限制**；若新需求只能靠放宽任意 Lean 源码执行，停止并另提安全设计。
- [ ] 本机已有已授权工具链时，先跑 `npm.cmd exec vitest run -- packages/agent-core/src/proof/lean4Toolchain.test.ts packages/agent-core/src/proof/lean4Adapter.test.ts scripts/proof-spike/lean4TemplateAllowlist.test.ts --reporter=dot`，再**单独**跑慢集成 `npm.cmd exec vitest run -- scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=1`、`npm.cmd run proof:smoke` 与 `npm.cmd run test:rust`。打包后在干净/无网的桌面上验证“明确不可用仍能画图”和“工具链可用才有真实证明”；冷、热运行耗时/版本/哈希/许可和包体如实列出。没有真桌面发行验收，就算本机 Lean 真跑绿也不标“已发布自动证明”。

### Task 18｜用户可见旧缺陷与能力声明的有界修复（P1/P2）

**文件**：`packages/agent-core/src/capabilities.ts`、`capabilities.test.ts`、`schemas.ts`、`schemas.test.ts`、`planCompiler.test.ts`；`apps/web/src/agent/agentRunner.test.ts` 与相应 UI；仅在诊断表明另一个真实入口出错时扩范围。

- [ ] **18a／W1（安全边界，必须在 Task 4 前）**：Task 2/3 的动作/预算合同 GREEN 后，先使 `relations:[null]`、`unverified:[null]` 的公共输入触发预期 RED：schema 必须给字段路径和 fail-closed 结果而非抛未捕获异常/报成数学矛盾；只改 `schemas.ts`/`schemas.test.ts` 的最窄处，`planCompiler.test.ts` 钉合法原样输入与关旗兼容。RED→GREEN 后才允许 Task 4 用这条边界接新的 `FigureIntent`。
- [ ] **18b／W3 前（公开能力真实可达，最迟 Task 11 前）**：先在 `capabilities.test.ts` 钉住空间 `constraint-authoring` 对 `coincident` 标 `available` 却没有题面/Agent/界面作者入口的负例；按**真实已有操作**收窄 `capabilities.ts` 的工作区/能力声明，不为修元数据暗造一个用户触不到的 3D 求解器。保留平面已可达能力与开关关路径。
- [ ] **18c／裁决支线**：“题设要求 0”用户文案若与旧 golden 冲突，先写用户可见 RED 和逐字段 diff，**等用户明确批准**放宽历史逐字合同再改；`>1MiB` 安全拒绝、未支持空间约束/超时上限不得静默放宽。`pointercancel` 等旧台账推断没有实机复现不捎带重构、不阻塞 W2。
- [ ] 分支各自运行 `npm.cmd exec vitest run -- packages/agent-core/src/capabilities.test.ts packages/agent-core/src/schemas.test.ts packages/agent-core/src/planCompiler.test.ts apps/web/src/agent/agentRunner.test.ts --reporter=dot`；只有改到真实交互时再加窄 e2e。每个 bug 记录现象、复现、RED/GREEN、关旗旧路和用户裁决；没实际判据保持待核。

## 9. 状态与完成定义（本文件为总进度，其他文档镜像）

| 波次 / 任务（按 O1 执行顺序；Task ID 不重排） | RED | GREEN/单元 | Browser/Worker | 真实 provider/人评 | 放行 |
| --- | --- | --- | --- | --- | --- |
| W0 / Task 14 旧功能基线 | 历史局部测试有记录；本版兼容基线未量 | 新旧对照未做 | 实机旧导出/拖动/开关未复测 | 不需付费 | W1 不可跳过未分类旧红 |
| W1 / Task 1–3 动作、协议、预算 | 用户原失败存在；回归 RED 未写 | 未做 | 未做 | 默认预算不增加 | 未放行 |
| W1 / Task 18a 边界输入 | `relations`/`unverified` null 待可复现 RED | 未修 | 旧合法输入回归未做 | 不需付费 | Task 4 前必过 |
| W2 / Task 4–5 来源意图与宿主 | 未做 | 未做 | 关旗及候选图元未核 | 不需付费 | 未放行 |
| W2 / Task 12a Worker 同版 | 未做 | 未做 | 回包迟到/版本合同未验 | 不需付费 | W3/Lean Task16 之前必过 |
| W2 / Task 13a 离线工件 | 未做 | 未做 | 初始/留出和错图 oracle 未接 | 不发 provider 请求 | 不冒称评测 |
| W3 / Task 6–7 分点/目标折角 | 给定角局部历史单测不算目标求角；新 RED 未做 | 未做 | 原题八条条件未有真图 | 不需付费 | 未放行 |
| W3 / Task 8–11 四家族 | 历史受限正例≠真题全族；新 RED 未做 | 未做 | 各族画布/反例未验 | 未做 | 一族通过不算四族绿 |
| W3 / Task 18b 能力表可达性 | 空间 authoring 无入口/能力表 available 待 RED | 未修 | 平面旧路回归未做 | 不需付费 | Task 11 用户路径前必过 |
| W4 / Task 12b 同草稿画布 | 未做 | 未做 | 截图/标签/相机/撤销未验 | 教师/学生读图未测 | 未放行 |
| W4 / Task 13b/c 质量和发行 | 未做 | 未做 | 桌面/当前 HEAD CI 未验 | 未经授权不运行付费请求 | 默认 Agent 未放行 |
| L / Task 15 Lean 原题范围 | 四类受限目标有历史本机证据；“额外前提遗漏” RED 未做 | 本轮旧路径定向 7 文件/88 项通过，**不含新范围** | 命题等级 UI 未验 | 与 provider 评测分开 | 整题证明未放行 |
| L / Task 16–17 Lean 生命周期/发行 | 后端与版本 pin 已存在；慢返回/无网/错版本 RED 未做 | 新链路未做 | 桌面真 UI/离线/沙箱未验 | 不自行下载 GB 级依赖 | 自动 Lean 未放行 |
| 等裁决 / Task 18c 用户文案 | 原 golden 与更可读的“题设要求 0”文案冲突 | 未获授权不改 | 不与安全上限合并修改 | 不需付费 | 不阻塞无关任务 |

**状态更新纪律**：实施者只在真实 RED/GREEN/浏览器与用户确认材料到手时更新这一行；一次提交不代表整个区块交付。`docs/current-status.md` 只记此时真正能跑的能力与日期化门禁，`docs/project-progress.md` 只归档当次命令/结果，[README](../../../README.md)/[能力目录](../../feature-catalog.md)/[发布门禁](../../acceptance/agent-release-gate.md)/[记分卡](../../acceptance/agent-tool-loop-scorecard.md)镜像已证的边界，历史记录不抹掉。
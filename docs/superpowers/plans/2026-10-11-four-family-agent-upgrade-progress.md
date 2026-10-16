# MathCanvas 下一步：四家族 Agent 升级、旧能力兼容、缺陷修复与 Lean 收口

> **最后更新：2026-10-15。** **两项与本计划有关的修订（都有现场读数）**：① **代际预算 4 → 6**（Task 2.1 原文那个 4 是在只读工具出现之前定的；一个"读场景"的工具轮要多花一次生成，用户那道三维题因此在修复轮死在 `budget exhausted`）—— 阈值与其余额度一字未动，`MAX_PLAN_ATTEMPTS` 已导出并挂上不变量用例；② **补点的宿主判据不再枚举形状**（原为多面体/平面片）—— 改成"输入里带 ≥3 个点名"，棱柱/棱锥/棱台/多面体/平面片一次全通；配套修掉"找棱靠 id 前缀"与"全补规则把不可构造题设算进来"（后者是"点名缺失"的真凶），并新增并列中点与面形状（正方形）两条读取器。**用户那道直三棱柱的题在代码里已跑通**（编译 ok + 题设核验 `passed`）。逐条读数见[当前状态](../../current-status.md)。状态：Task 1–18 已完成；Task 19–21 尚未完成，本文件对其余任务仍只有实施设计。 [四家族真题作图需求调研](../../research/2026-10-11-four-family-exam-diagram-survey.md)已在本轮完成，并独立记录卷别、题号、题型和可信边界；**本计划不再包含“以后去调研真题”任务**。现有代码能力与测试的现在时仅以 [当前状态](../../current-status.md) 为准；旧 [V0–V3 追踪](../../agent-next-round-progress.md)的读数保留为历史快照。

**Goal:** 在三角形、圆锥曲线、函数/导数、立体几何四家族内提高真实作图能力，**不回退已完成的手工绘图/Agent/保存导出/实验功能**；修复已确认缺陷，并把现有受限 Lean 证明路径按原题前提、产物有效性和桌面发行证据逐项收口。不能画或不能证明时如实解释。

**Architecture:** 作图主链：原题 → 来源明确的条件与图形意图 → 有界构造 → 最终图元独立回代 → 草稿/用户确认；兼容/修复主链：原有入口与 golden → 重现缺陷 → 最小修复 → 新旧路径同版回归；**可选的 Lean 主链**：已限定目标与全部可表达前提 → 受限桌面后端 → claim/input/toolchain 绑定的产物或明确的不支持状态。证明失败不阻断普通作图，实例图不自动升级为形式证明。

**Tech Stack:** TypeScript、React、Tauri、Vitest、Playwright；不另造平行编辑器，不把 Lean 的普遍证明当作作图门槛。

**Spec:** [四家族真题调研](../../research/2026-10-11-four-family-exam-diagram-survey.md)确定作图需求，[GitHub 实施调研](../../research/2026-10-11-github-agent-implementation-survey.md)确定取舍；[当前状态](../../current-status.md)和[发布门禁](../../acceptance/agent-release-gate.md)给既有功能与 Lean 真实边界。第 4 节是唯一连续的 Task 1–21 执行顺序；**均未因写出文档而交付**。

## 全局约束（各区块共享）

- **新增作图范围只四类**：三角形、圆锥曲线、函数/导数、立体几何；其他科目内容不入**新增作图覆盖分母**。这不取消现有平面/立体/CAD/文件导出等旧能力的兼容门禁，也不取消已存在的受限 Lean 功能及其独立补完任务。跨家族综合题共同核验；“非标准曲线”不能硬塞圆锥曲线。
- **不硬编码原题答案**：真题是需求和留出验收的依据；改点名、比例、角度、符号或支路仍应有正确结局。原题条件要有来源锚点、覆盖报告和独立回代。
- **严格边界**：未知动作不猜测映射；未读/未核题设不能说整题核验；数值实例图不是普遍证明；`no_witness`、数学矛盾、未实现及超时不得混称。
- **预算/付费**：不得为了表面成功默认增加 `generation: 4` / `network: 6`、自动发起新付费 provider 请求。预算与真实模型评测的更改先给用户看成本/调用次数并征得明确同意。
- **兼容/回归**：先执行 Task 1，钉住现有人工 2D/3D/CAD、`.mgeo`/HTML、Agent 默认关/开旗、确认/撤销和桌面能力。证明开关 `proofExport` **已有设置入口且默认关**，不得误写“尚无入口”；普通作图不依赖 Lean。草稿绑定/Worker/主线程旧路径与新路径均保留；只在新路径和证明各自过门禁后考虑其对应开关。
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

### 跨层最小数据合同（Task 6 先写类型与坏输入用例，Task 7 才接旧动作）

- `FigureIntentV1 = { version: 1; family: "triangle" | "conic" | "function" | "solid"; objects: NamedObject[]; relations: { sourceClauseId: string; kind: RelationKind; refs: string[]; value?: ExactOrApprox }[]; transformations: Transformation[] }`。一条 relation 的 ID 必须能追回 `obligationIR` 的原句；对**没有**可靠来源的关系不得假装来自原题。`NamedObject` 类型必须容纳点/线/开放面/闭合体/函数/曲线的不同拓扑，不用一组不带语义的顶点列表代替。
- `ConstructResult = { status: "candidate"; positions: Record<Name, Point>; freeChoices: Choice[]; residuals: Residual[] } | { status: "contradictory" | "unsupported" | "timeout"; diagnostics: Diagnostic[] }`。欠定但可画→`candidate` + `freeChoices`；数学矛盾与不能求全不混并。求解器不能直接填“题设全通过”。
- `DiagramVerificationReport` 仍由现有 `diagramVerification.ts` 负责：对**最终文档**每个原文 obligation 给 `passed | failed | unverified`、实测值/容差、对象绑定/版本；全部可判不意味着全部原题条件已读。`planCompiler` 和 `draftStore` 的 Worker 通路共用该报告，UI 不另外猜。
- `RepairStop = { code: "schema_invalid" | "unknown_action" | "compile_failed" | "budget_exhausted"; lastCause: Diagnostic; allowedChanges: string[]; remainingGeneration: number; remainingNetwork: number; canRetry: boolean }`。这只是 Task 2–4 的拟议端口形状；真正命名应和现有 `RepairRequest`/`BudgetSnapshot` 对齐，**不另造同名账本**。不让 UI 将 `unknown_action` 文本替换成“顶层 JSON 错”。

这些接口是**开发约束和拒收条件**，还不是产品代码。先让编译器、草稿层、Worker 的类型/反例测试全部失败在预期行为上，才允许改变模型可发布的 schema；严禁先改提示词再“希望模型会遵守”。
## 3. 原用户题贯穿验收（不是硬编码这道题）

原文“四边形 ABCD，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3；E/F 在边上定比分；AEF 沿 EF 翻至 PEF 且 PC=4√3”：先产生可核的 ABCD，再由比求 E/F，围绕 EF 由目标 PC **反求折角**，最终场景中 A/B/C/D/E/F/P 的点名与所有原题条件逐一回代。前后面片保留物理身份；正确解不依赖模型猜 P 坐标，不拿封闭四面体冒充两个开放面。改变根式、比例、折痕方向/端点、把条件改成矛盾、移走 ABCD 结构都要得到相应分支或清楚拒绝。**目前仅局部内核测试存在，整句真实桌面 Agent 仍失败；不可提前勾“已支持”。**

另配跨卷对照：2021/2024 三角边角面积与定比分点，2022/2025 椭圆/双曲线与动弦，2021/2024 外点切线与公切线及根数，2021/2024 的一般棱锥、2022/2023 的棱柱/棱台和 2025 的翻折。题面/预期图形结构均从[已完成的真题研究](../../research/2026-10-11-four-family-exam-diagram-survey.md)取得；工程实现必须防止只会画这一条翻折题。

**现有能力不因重编号消失**：四类受限 Lean 目标、默认关但设置可开启的 proofExport、产物的 claim/inputHash/版本检查，以及 mathlib lock 已存在；原题完整前提、迟到证明、干净机/无网与发行尚未验收。已有的 solid.create_face、给定角 solid.fold、四家族局部测试也不等于真实题全部可画。Task 1 先保全旧路径，Task 2 才开始修新问题。

## 4. 唯一的连续执行顺序（Task 1 → 21）

> **Task 1–Task 17 已于 2026-10-12 完成；下一项是 Task 18（证明产物异步绑定与可读 UI）。** Task 17 交付的是**"这一次到底证了什么"**：新模块 `packages/agent-core/src/proof/proofScope.ts` 给出 `ProofScopeReport` —— 每一条原题条件落四档之一（`formalized` 进了命题假设 / `dischargedByNamedDerivation` 由一条**点名定理**从它一步推出 / `figureAssumption` 只是**图上这一个实例**满足 / `notRepresented` 连读都没读出来），带原话 span（id 与区间直接取自 `buildObligationIR`，不另写一套编号）与系统替用户做的选择；结局只有 `limited_lemma | whole_problem | unsupported`，**默认受限引理**。判据逐条有读数：题面多一条必要条件（`AB=2`）⇒ 产物照样出也只报受限引理并列出那条没进命题的条件；前提指不出出处、或这一类没有模板 ⇒ `unsupported`（连命题都不生成）；后端没验过 ⇒ 永远不是整题（`sorry` 那一档在此被挡）；整题级还要求调用方**显式交出**"这份命题覆盖整道题"的产物声明 —— **今天没有产品调用方给得出它**，所以产品路径上这一档不可达（这正是计划那句"不勾 whole_problem"的代码形态）。`AutomaticProofResult.scope` 做成**必填**，那条升级说明也改成"证的是受限引理，不是整道题"（文案经 `automaticProofStage` 的 `detail` 到面板）。**边界**：范围报告**不**单独判"题设与图互相矛盾"（那在核验器那一侧）。Task 16 交付的是**真实画布与过期证据**：新 `apps/web/src/canvasEvidence.ts` 从**已经渲染出来的 DOM** 量对象盒子与点名标签（2D 读图元几何属性、3D 读标注覆盖层），诊断交给既有 `diagnoseLayout`（`label_overlap`＝点名遮挡、`clipped_object`＝出画布），画布根元素挂出内容哈希 / 计数 / 诊断码 / 相机看不见的点名 —— **仅查内存文档不算视觉通过**那句话由此有了可执行的读数；证据绑**内容哈希**（`RenderEvidence.documentHash` 必填）并由新判据 `renderEvidenceStaleness` 判过期：**看哈希不看版本号**（同一内容换一版草稿仍新鲜），`document_changed`（改题/撤销）与 `draft_replaced`（切文档）分开，**带截图也不改变结论**；`e2e/agent-exam-visual-and-stale.spec.ts` **6 passed**，四族各一次"画布自报的哈希 == 测试自己按 `canonicalContentHash` 口径规范化后用 `crypto.subtle` 摘要的那一份"。**本任务读数还抓到并修掉一条真缺陷**：翻折题落盘 9 个 `point3`、`E`/`F` 各画两遍（折片是与边上两点坐标逐位相同的副本）⇒ `compileSolidFold` 新增 `suppressedNames`（已有同名点时折片副本不再挂标签），渲染层同时不再拿**图元 id 当名字**画。**边界**：3D 虚实线 DOM 读不到、把点名转出视锥无确定性产品做法、"取消拖动"不是现有动作、教师/学生可读性签收属发布门禁。Task 13 的**原用户那道题已经端到端通过**（真实浏览器 / 草稿 / 确认 / 一步撤销），链路是：四个坐标 ⇒ 系统按定比分点建 `E`/`F` ⇒ 折叠**按点名取点** ⇒ 折角按 `PC=4√3` **反求**；负例（缺 `C` / 错的折角 + 缺 `C` / **手写的 `P`**）都挡得住。**记录的边界**：① **斜棱柱"明说倾角"是缺口**（解析器没有"所成角"的读取器；修它要同时定"底面是哪张平面"与"从最终坐标量线面角"的核验，是**设计决定**，未做）；② **面上点**与**展开**今天**没有产品入口**（宿主类型只收棱/线/曲线；没有 `solid.unfold` 这类动作）—— 按计划"不为没有产品入口的…单独造隐形约束"，记成边界而不是硬造；③ 垂足不在中心＝**常态**（有用例钉住）。同一时间只推进一个任务；Task n 的 RED、最小 GREEN、定向/适用旧路径复跑及验收记录未齐，不启动 Task n+1。这里的数字是**实际执行顺序**，不再用波次、并行支线或“先做 12a 后回到 8”解释编号。各任务的读数与归因写在各任务卡片里。

| 顺序 | 任务 | 退出条件（必须有运行证据） |
| --- | --- | --- |
| 1 | **Task 1：旧功能兼容基线 ✅（2026-10-12 完成）** | 同版旧工作区/导出/开关/撤销有记录（定向 6 文件 / 120 项改前全绿 ⇒ 本切片无旧红）；四处破坏各自先红后绿、变异已还原 |
| 2 | Task 2：用户真实失败重现 | 22:36 两轮坏计划能复现并精确分类，不误报顶层 JSON |
| 3 | Task 3：统一动作菜单与工具合同 | 未知动作拒绝；已发布动作、schema、处理器一致 |
| 4 | Task 4：预算及修复账本 | 每请求一次计费、错误不被预算原因吞没；不加额度 |
| 5 | Task 5：非法输入与空间能力声明 | null 输入 fail-closed、空间能力表只说可达功能；文案裁决留记录 |
| 6 | Task 6：四族来源意图 IR | 条件 ID、原文跨度和未核验状态跨层一致 |
| 7 | Task 7：无宿主安全物化 | ABCD 缺结构能安全构造或明确拒绝；旧 plan 不退化 |
| 8 | Task 8：Worker/主线程同版合同 | 版本/迟到结果不进入新草稿 |
| 9 | Task 9：离线真题评测工件 | 许可/题号/独立几何 oracle 与留出集有测试；不调用 provider |
| 10 | Task 10：派生分点与依赖 | E/F 比例随宿主变化且最终图独立回代 |
| 11 | Task 11：三角形真题纵向 | 正例/错图/欠定/换名及真实 2D 画布通过 |
| 12 | Task 12：由目标距离求折角 | **完成**：RED 建成（`foldAngle.test.ts` 6 条先全红 → 全绿，**不喂 P、不喂角**，求得唯一 `θ=90°`，并用罗德里格斯公式走**第二条独立路径**回代）；解析求解 `foldAnglesForTargetDistance` 四档结局分开（`solved`/`outside-range`/`unreachable` 报可达区间/`degenerate`）；**已接进 `compilePlan`**（`rescueWithSolvedFoldAngle`：错角 30° ⇒ 求出 90° 并通过核验、填对不抢、无目标距离不凭空反求），并修掉"草稿为 `null` 就退出"那个把救援挡在门外的守卫；**记录的边界**：更一般目标关系的上界区间搜索未做（计划写成条件式"才进行"）、两支角合法时另一支未披露、e2e 未做（计划原文：仍需 Task 16 的真实产品验收） |
| 13 | Task 13：立体几何真题纵向 | 棱柱/棱锥/组合/翻折/二面角真 3D 出口 |
| 14 | **Task 14：圆锥曲线真题纵向 ✅（2026-10-12 完成）** | 动弦/切线/竖直线/曲线组合与错轴负例通过 |
| 15 | **Task 15：函数与导数真题纵向 ✅（2026-10-12 完成）** | 外点双切线/公切线/多交点、断点与错切点反例、参数实例≠全称通过 |
| 16 | **Task 16：真实画布和 stale 证据 ✅（2026-10-12 完成）** | 四族画布/标签与草稿同版本、改题/撤销后旧证据 stale 通过 |
| 17 | **Task 17：Lean 原题前提与受限引理分级 ✅（2026-10-12 完成）** | 四受限目标保持；漏前提绝不称原题已证（`ProofScopeReport` 落地） |
| 18 | **Task 18：证明产物异步绑定与可读 UI ✅（2026-10-12 完成）** | 迟到/错 claim/版本被拒；浏览器不可用不挡作图 |
| 19 | Task 19：Lean 工具链与发行边界 | 窄 Rust、pin/无网/离线负例真验；未获下载许可安全关闭 |
| 20 | Task 20：四族真实 provider 质量 | 先授权及冻结阈值；pass@k/成本/失败阶段真实读数 |
| 21 | Task 21：整体验收与发布裁决 | 全量/人评/桌面/当前 CI 按作图与 Lean 两把锁分别裁决 |

**唯一推进规则**：每个任务依次记为 待做 → 业务 RED → 最小 GREEN → 定向/受影响旧路验收 → 完成；若旧测试预先红，Task 1 先归因并记录归属，未知旧红不能被新功能覆盖。每个任务结束时更新本文件状态和[当前状态](../../current-status.md)，然后才开始下一个。所有改动后触及共享合同都重跑此前完成任务的相关门禁。

**必须暂停的决策**：Task 5 的“题设要求 0”文案若需改逐字 golden，未获用户同意则保持旧文案并在任务中记为待裁决；Task 19 的 GB 级下载/工具链升级和 Task 20 的付费 provider 均须事先获得授权。未授权时不跳号：Task 19 只在“无工具链 fail-closed、Lean 仍默认关”的受限出口完成后才可进入 Task 20；Task 20 未获付费授权就暂停，Task 21 不得伪报四族质量已测。Task 21 对普通作图与自动 Lean **分别**作放行决定，证明未放行不妨碍已验收作图。

**稳定性**：Task ID 是唯一顺序；不因实现更容易而插队。新增可复现 P0 故障时先停在当前编号，在该任务下补 RED、修复和旧路证据；若确实必须修改前置任务，回退它的状态并重跑连续受影响任务后恢复执行，更新本表与 README/进度镜像。历史文档旧任务编号是当时记录，只从下方迁移对照查看，不能指挥现在执行。

## 5. 历史任务编号迁移（只为阅读旧进度）

| 旧版快照 | 当前唯一编号 |
| --- | --- |
| 旧 Task 14 | 新 Task 1 |
| 旧 Task 1–3 | 新 Task 2–4 |
| 旧 Task 18a/18b | 新 Task 5 |
| 旧 Task 4–5 | 新 Task 6–7 |
| 旧 Task 12a | 新 Task 8 |
| 旧 Task 13a | 新 Task 9 |
| 旧 Task 6 | 新 Task 10 |
| 旧 Task 8 | 新 Task 11 |
| 旧 Task 7 | 新 Task 12 |
| 旧 Task 11 | 新 Task 13 |
| 旧 Task 9–10 | 新 Task 14–15 |
| 旧 Task 12b | 新 Task 16 |
| 旧 Task 15–17 | 新 Task 17–19 |
| 旧 Task 13b/13c | 新 Task 20/21 |
| 旧 Task 18c | 新 Task 5 记录待裁决，不另行插队 |

## 6. 按数字顺序执行的任务卡

### Task 1｜保护已完成能力：执行前基线

**文件/测试**：新增 `apps/web/src/agent/legacyCompatibility.test.ts`（仅钉新旧合同差异，避免复制每个旧测试）；已有 `apps/web/src/agent/featureFlags.test.ts`、`planWorkspaces.test.ts`、`draftStore.test.ts`、`apps/web/src/persistence/fileExports.test.ts`、`packages/dsl/src/codec.test.ts`、`packages/agent-core/src/proof/proofArtifact.test.ts`；浏览器 `e2e/agent-planar-triangle.spec.ts`、`agent-conic-kinds.spec.ts`、`agent-function-tangent.spec.ts`、`agent-oblique-prism.spec.ts`、`agent-constrained-drag.spec.ts`、`html-export.spec.ts`、`next-phase-flag-entry.spec.ts`。

- [x] **先量旧 HEAD，不先改实现**：将人工绘图、`.mgeo`/HTML 读写、已交付 S1–S6 实验入口、点名/撤销、默认关时旧路径、`proofExport` 设置入口/确认面板各跑一遍，记录命令、时间、失败类别、抖动复跑和当前工作树 SHA。存在红灯则先诊断是旧问题/环境/本轮变更，不能在新功能任务里将旧红灯悄悄标绿。
      **2026-10-12 读数**（HEAD `e648b82e263cf9d77beffac149150fbb62b3afc1`；工作树另有 3 个桌面端版本文件改动）：定向单测**改前 6 文件 / 120 项全绿**（3.21 s）⇒ **本切片没有旧红，故不存在需要归因的历史旧红**（如实记成空集，不编造归因）；定向 e2e **23 通过 / 0 失败 / 0 抖动**（36.2 s；复跑 32.6 s，`PLAYWRIGHT_EXIT=0`）；`typecheck` exit 0；`lint` 0 error / 13 warning（与既有读数逐字相同）。附带一条工具纪律：第一次 e2e 的 `[exit code: 1]` 是 npm 写 stderr 触发的 `NativeCommandError`，**不是**测试失败，引用 e2e 退出码必须把两个流重定向进文件后取 `$LASTEXITCODE`。
- [x] **RED**：在新增兼容测试里故意使旧 `proofExport=false` 也出现证明栏、换工作区修复轮复发 `stale_draft`、丢失旧 `.mgeo` 点名、`dynamic.*` 又切进 3D；每种破坏应使对应旧测试/新增合同真红，恢复源码后复绿。只在确有覆盖缺口时增加一条测试，不为测试数量新造旧功能。
      **四处归因（全部先红后绿，变异源码已用 `git diff` 逐字节复核还原）**：① `proofExport` 撤旗闸 ⇒ **旧** `draftStore.test.ts` + `agentRuntime.test.ts` 真红；③ 解码剥 `label` ⇒ **旧** `codec.test.ts` **4 项**真红；④ `dynamic.` 投 `geometry3d` ⇒ **旧** `planWorkspaces.test.ts` 与新文件同时真红；② epoch↔generation 互相错标 ⇒ **没有任何旧用例**能抓（`draftStore.test.ts` 26 项、再加 `committerAdapter.test.ts` 共 **45 项全绿**），只有新增文件真红。**⇒ 覆盖缺口正是②**：消费方 `committerAdapter.ts:163` 的 `runSwitchedWorkspace && kind === "epoch"` 策略用例把这个值 mock 掉了，产生它的 `draftStore.assertFresh` 从没被问过 `kind`。新增 `apps/web/src/agent/legacyCompatibility.test.ts`（3 项）只钉两处缝：四类过期各自取值且四词互异、纯 `dynamic.*`/`parameter.*` 计划返回空数组不动用户工作区。**本批没有产品代码改动。**
- [x] 命令：`npm.cmd exec vitest run -- apps/web/src/agent/featureFlags.test.ts apps/web/src/agent/planWorkspaces.test.ts apps/web/src/agent/draftStore.test.ts apps/web/src/persistence/fileExports.test.ts packages/dsl/src/codec.test.ts packages/agent-core/src/proof/proofArtifact.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-planar-triangle.spec.ts e2e/agent-conic-kinds.spec.ts e2e/agent-function-tangent.spec.ts e2e/agent-oblique-prism.spec.ts e2e/agent-constrained-drag.spec.ts e2e/html-export.spec.ts e2e/next-phase-flag-entry.spec.ts --workers=1`。完整默认发布仍需全库/全量，定向通过只是基线。每完成 Task 2–21 的跨层改动后重复适用切片，发现旧路不同只能附明确受用户同意的迁移依据。
      **2026-10-12**：两条定向命令均执行且读数如上（单测加新守卫后 **7 文件 / 123 通过 / 0 失败**）。**全量也一并跑了**：全库 `npm test -- --maxWorkers=2` = **358 文件 / 4203 通过 + 6 skipped + 1 todo / 0 失败**（三份文档改完后在冻结树上复跑，168.43 s，exit 0）；全量 `npm run test:e2e` = **223 通过 / 0 失败 / 0 抖动**（2.4 m，exit 0）。**6 个 skipped 是真实 Lean 端到端用例（本机无 Lean 可执行文件）⇒ 这些读数不是 Lean 证据，Task 17–19 那把锁本批没有被验证。** 本行同时是本任务**之后**每次跨层改动要复跑的适用切片。

### Task 2｜重现并分类 22:36 的失败

**文件**：改 `packages/agent-core/src/coordinator.test.ts`、`outputParser.test.ts`、`outputParser.ts`；改 `apps/web/src/agent/agentRunner.test.ts`、`agentRunner.ts`。不动动作语义或默认预算。

- [x] 从用户轨迹只摘动作名、必需字段和两次状态迁移制成脱敏夹具：第一份不足四个面的 `solid.create_polyhedron`，第二份三个 `solid.create_segment`。**RED**：在第二轮 UI 必须出现“未注册动作 solid.create_segment”、其三个路径和先前“开放图形不要用闭合多面体”，不能被泛化成“JSON 顶层形状不合法”；目前后一条不满足。不得把这个动作自动改成别的动作。
- [x] 把 `unknown_action` 与 `invalid_json` / 顶层形状分开生成可见诊断；在修复提示中按失败字段给“`solid.create_face` 自带面边；不要额外找 solid.create_segment”的**操作**，继续用严格 `parsePlanEnvelope` 作为安全闸。信封类额度用尽时用户仍能看到真正的上一条拒绝理由。
- [x] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/coordinator.test.ts packages/agent-core/src/outputParser.test.ts apps/web/src/agent/agentRunner.test.ts --reporter=dot`。**GREEN** 应同时保住旧的合法计划、散文/不合法 JSON 被拒、不准静默跳过动作。**阶段成果是正确拒绝与反馈，不是这道题已经自动画出。**
      **2026-10-12 读数**：三处改动 —— `outputParser.ts`（成对的 `schemaFailureDetail` / `readSchemaFailureDetail` + `describeSchemaFailureForUser` + 修复提示里"别造动作名"那一支）、`coordinator.ts`（改用该生产方，**格式逐字未变**，故既有 golden 未动）、`agentRunner.ts`（`failed` 分支按死因分两句，并回带账本里先前 `was rejected:` 的原话）。**先红**：`outputParser.test.ts` 整文件 20 项失败（导出不存在）/ `coordinator.test.ts` 1 项 / `agentRunner.test.ts` 1 项；**GREEN**：3 文件 **124 通过 / 0 失败**。**变异**：短路新分支 ⇒ 前两个文件各红一条、`agentRunner.test.ts` 不红（用户话那条路有它自己的判据）⇒ 还原 124 全绿。Task 1 适用切片复跑 **7 文件 / 123 通过 / 0 失败**；`typecheck` exit 0；`lint` 0 error / 13 warning。**`solid.create_segment` 不会被自动翻译成别的动作，动作语义与默认预算一行未动**；原用户那道折面题照旧未解决。

### Task 3｜动作菜单与工具合同一致

**文件**：`packages/agent-core/src/actionIds.ts`、`actionRegistry.ts`、`schemas.ts` 与对应测试；`apps/web/src/agent/systemPrompt.ts`、`systemPrompt.test.ts`、`modelPlanner.test.ts`。现有处理器在 `packages/scene-graph/src/actions/index.ts`。

- [x] **RED**：对全部 `DRAFT_ACTION_IDS` 枚举校验“处理器/输入 schema/工具发布/提示词菜单”一致；另给 `solid.create_segment`、未知字段及把 `{arguments:"..."}` 字符串当整个计划的反例。预期未知动作报路径/许可菜单而不是执行，协议壳未经声明不被偷偷拆开。
- [x] 对齐注册表与 `buildPlanToolSchema`/`buildPolicyText`，按场景只发布相关动作及最少需要的输入说明；明确**开放的面→`solid.create_face`、闭合实体→`solid.create_polyhedron`、折→`solid.fold`**，面本身物化顶点/边。与已有的平面 `planar.create_segment` 严格区分；不要注册不存在语义的 3D 线段动作凑数。
- [x] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/actionIds.test.ts packages/agent-core/src/schemas.test.ts apps/web/src/agent/systemPrompt.test.ts apps/web/src/agent/modelPlanner.test.ts --reporter=dot`；坏名字必须失败、合法动作必须可达。缩短提示词时断言未意外删除已有圆锥/函数/立体动作菜单。

      **2026-10-12 读数（Task 3 收尾）**：四处改动 —— `systemPrompt.ts` 菜单新增"**面分三种，别混**"（开放的面→`solid.create_face` 自带面边 / 闭合实体→`solid.create_polyhedron` / 折→`solid.fold`；立体里没有线段动作，不要自己造动作名），且**该段只在 `actionIds` 含 `solid.*` 时出现**；`schemas.ts` 在 `kind` 读不出时**额外**按"所有 kind 字段并集"查未知字段，于是协议壳同时报 `unknown_kind@envelope.kind` 与 `unknown_field@envelope.arguments`。**先红两处**：`missing unknown_field in [{"code":"unknown_kind",…}]`（原先只报一句 `unexpected kind 'undefined'`）与 `expected '你是 MathCanvas 的构图助手…' to contain '开放的面'`。**GREEN**：4 文件 **134 通过 / 0 失败**。**我自己被判据抓住一次**：加上那段规则后**纯平面**那轮也出现了 `solid.create_face` ⇒ 判据当场红，改成按 `actionIds` 条件出现。**没有注册任何新动作**；"按场景只给最少需要的输入说明"只做到"菜单范围随本轮动作走"这一半。

### Task 4｜共享预算与修复账本

**文件**：`packages/agent-core/src/coordinator.ts`、`coordinator.test.ts`、`budget.test.ts`；`apps/web/src/agent/modelPlanner.ts`、`modelPlanner.test.ts`。

- [x] **RED**：重放“初问→只读工具续接→编译修复→下一轮”四次 generation 消耗，同时断言每次发请求前 remaining 数、计费主体和最后几何错误。当前已有 `budget_repair` 盖掉原诊断、名义有编译类两次但第三轮请求送不出的反例。
- [x] 定义一个**每次 provider 请求只由一个层计费**的账本合同；如果现有实现经测试确实重复计费，修复重复那一次；如果没有重复，保留成本限制并在修复前明确告知剩余次数。保留 `generation:4`、`network:6` 和信封/编译修复上限不变，不为过测试隐性加请求。用户需另行决定是否付费增加额度。
- [x] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/budget.test.ts packages/agent-core/src/coordinator.test.ts apps/web/src/agent/modelPlanner.test.ts --reporter=dot`；未实际发出的请求不得计为成功修复；错误停止时保留最有用的原始错误和完整账本。

      **2026-10-12 读数（Task 4）**：① **RED**：在既有"额度只够一次生成"用例上补断言 —— `expected 'budget exhausted: budget_repair' to contain 'compile_failed: degenerate_prism'`，正是"预算盖掉原始错误"那句病；**GREEN** 后 `stop(reason, lastError?, remaining?)` 三样一起给（原因 + 余量 + 用尽前最后一次真实失败，**附加**不是替换）。② **账本合同**：协调器管每次 `plan()` 调用、规划器管它为送回只读工具结果多发的往返；"每批一次、不是每工具一次"由既有 `modelPlanner.test.ts`「charges one generation per read-tool batch」钉住 ⇒ **没有重复计费**，第 6 次的闸是 `generation: 4` 本身（1+1+1+1），故**额度一行未动**（`budget.test.ts` 的 `DEFAULT_BUDGET_LIMITS` 断言照旧通过）。新增一条把合同写成可执行判据（两次往返 ⇒ `used.generation === 2` 且与 `network` 同步、且这一轮成功停在等确认）。**GREEN**：3 文件 **101 通过 / 0 失败**；Task 1 适用切片 7 文件 / 123 通过；`typecheck` exit 0；`lint` 0 error / 13 warning。**未做**：完整账本未逐笔记进事件流（只在失败那一条里给余量）；"未实际发出的请求不得计为成功修复"是**既有行为**、本批只是复验。

### Task 5｜非法输入与能力声明错位

**文件**：`packages/agent-core/src/capabilities.ts`、`capabilities.test.ts`、`schemas.ts`、`schemas.test.ts`、`planCompiler.test.ts`；`apps/web/src/agent/agentRunner.test.ts` 与相应 UI；仅在诊断表明另一个真实入口出错时扩范围。

- [x] **RED / schema**：从公共入口送入 relations:[null] / unverified:[null]，要求收到有路径的 fail-closed 诊断，而不是未捕获异常或“题设矛盾”。
- [x] **GREEN / schema**：只在 schemas.ts/schemas.test.ts 的边界收紧；planCompiler.test.ts 证明合法 relation 与关旗原样通过。
- [x] **RED→GREEN / 能力声明**：capabilities.test.ts 先证明空间 constraint-authoring 宣称 available 却没有题面/Agent/界面的 coincident 作者入口；按可到达的操作收窄 capabilities.ts，不为修元数据实现无人能用的隐形求解器；旧平面入口照常通过。
- [x] **用户待裁决文案**：记录“题设要求 0”的旧 golden 与更可读文案的差异；未经许可保留旧字面并登记待裁决，不将其当 Task 5 的自动代码改动。正常的 1 MiB 限制和超时拒绝不放宽。
- [x] 运行 npm.cmd exec vitest run -- packages/agent-core/src/capabilities.test.ts packages/agent-core/src/schemas.test.ts packages/agent-core/src/planCompiler.test.ts apps/web/src/agent/agentRunner.test.ts --reporter=dot；完成后才开始 Task 6。

      **2026-10-12 读数（Task 5）**：**真红两条** —— `TypeError: Cannot read properties of null (reading 'sourceText')`（`unverified: [null]`）与 `(reading 'role')`（`obligations: [null]`）；`normaliseObligationIR` 改成**逐条查形状**（非对象 / 字段不是字符串的条目丢掉；断言用"与没有题设同一种结局"，不是"没抛就算过"）。**能力表真红一条** —— `expected [ 'conics', 'geometry3d' ] to not include 'geometry3d'`；`constraint-authoring` 收窄为 `[...PLANAR]`，理由进 preconditions，**不为修元数据实现无人能用的隐形求解器**。**两条本来绿的**记为"钉住别退化"：`relations: [null]` 与 `relations: [42,"AB=2",[]]` 在传输层本来就是带路径的 fail-closed。**扩范围已按计划授权**（文件清单里没有 `witnessSearch.ts`，卡片写明"仅在诊断表明另一个真实入口出错时扩范围"）。**待裁决**：'题设要求 0' **一字未改**（`planCompiler4707b64.golden.json` 未被触碰），沿用当前状态「待裁决」表第 5 行。**typecheck 抓到 vitest 没抓到的**：`result.errors?.some` 在判别联合上报 TS2339，修好才 exit 0。GREEN：5 文件 **234 通过 / 0 失败**；Task 1 适用切片 7 文件 / 123 通过；`lint` 0 error / 13 warning。**1 MiB 限制与超时拒绝不放宽。**

### Task 6｜来源可追溯的四族图形意图

**文件**：新建 `packages/agent-core/src/figureIntent.ts`、`figureIntent.test.ts`；改 `diagramObligations.ts`、`obligationIR.ts`、`contracts.ts`、`index.ts` 及相关测试。先不改画布。

- [x] **RED**：题面八条条件在解析、意图与核验报告间必须保持相同的条件 ID、原文片段位置与点名；混入第九条读不懂的条件必须随结果保留 `unverified`；条件无法表达时不能被模型自动改弱。兼容已有 `solid.*` 计划作为旧分支。
- [x] 加版本化 `FigureIntent` 联合：`triangle|conic|function|solid` 的拓扑、命名对象、来源条件引用、派生点/变换关系。只容纳**结构和条件引用**，坐标由构造器决定；旧 `PlanEnvelope` 经窄适配继续可读。提议的 `sourceSpan` 应复用现有 `DiagramSourceSpan`，不要再手抄第三套。
- [x] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/figureIntent.test.ts packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/obligationIR.test.ts --reporter=dot`；证明新联合对多解/未核/工作区都有有类型的去向，再开放模型输出它。

      **2026-10-12 读数（Task 6）**：新增 `figureIntent.ts` + 测试 + `index.ts` 一处导出；**计划的 `diagramObligations.ts` / `obligationIR.ts` / `contracts.ts` 一行未改**（计划给的是候选范围；既有 `GeometryObligation` 与 `DiagramSourceSpan` 已经够用，能不动共享合同就不动）。**RED**：`Failed to resolve import "./figureIntent"` ⇒ **GREEN** 3 条全过（定向 3 文件 / 46 通过）。三条判据：① 条款与解析结果一一对应、`span.sourceText === prompt.slice(start,end)`、`refs` = 点名；② 缀上 `，sin∠PAB=0.5` 后前面几条一条不变、残留多出恰好一条且**指得出位置**；③ 塞一条来源追不回原句的关系 ⇒ `clauses` 逐字段不变（"对没有可靠来源的关系不得假装来自原题"）。**实测出的不一致（2026-10-12 已定因，不再挂"待澄清"）**：本卡 §3 那句话是**转述**，不是用户原话 —— 它把定比分点写成"E/F 在边上定比分"、**没有显式比例**；`packages/agent-core/src/figureIntent.test.ts:20` 的 `PROMPT` 逐字就是这句转述，所以**读出 6 条**（`AB=8` / `AD=5√3` / `∠BAD=30°` / `∠ADC=90°` / `CD=3` / `PC=4√3`）。**用户原话在 `e2e/agent-exam-solid.spec.ts:20-24`**（多出"点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2"），**它读出 8 条**，而且这个 8 被一条**绿的** e2e 逐条钉住（同文件 `:69` 断言面板里出现那 8 个条件串）。**8 − 6 = 那两条比例**，账对得上 ⇒ 差额的原因**证实**为"转述丢了显式比例"，既不是解析器缺陷，也不是我措辞的偏差。**⚠️ 还有一个同名不同源的 6，别读混**：§一里"第 11 轮实测 6 条"是拿**原话**测的（当时 Task 10 还没修好"部分比整体"），与这里的 6 是两回事；两处现已互相指认，`figureIntent.test.ts` 的注释也写明"这里的 `PROMPT` 是转述、原话读出 8"。**用户原话不存在"找不到"的问题** —— 它一直在仓库里（`diagramObligations.test.ts:67` 那条用例与 `e2e/agent-exam-solid.spec.ts:20-24` 逐字相同）。**未做**：`objects` 只到点名层（其余五支是 Task 7 的位置，这一层不猜拓扑）；`transformations` 只收不产；多解与工作区没进 `FigureIntent`；旧 `PlanEnvelope` 窄适配未写（本层纯新增，旧路径按构造仍可读）。

### Task 7｜缺宿主时安全物化

**文件**：新建 `packages/agent-core/src/figureMaterialisation.ts`、`.test.ts`；改 `planCompiler.ts`、`planCompiler.test.ts`、`apps/web/src/agent/draftStore.ts` 与 Worker 合同测试。

- [x] **RED**：同一 ABCD 原文、模型完全没有 `solid.create_face` 宿主时，现有 `withWitnessCoordinates` 不能无中生有；为“题面明确平面四边形、点名唯一、已有条件能认”准备结构明确的生成测试，并配“两个竞争四边形”“点名和动作冲突”必须拒绝的反例。
      **2026-10-12（第一项已完成）**：查实 `withWitnessCoordinates`（`planCompiler.ts:711`）要求**恰好一笔宿主动作在场**，宿主缺席时内核造了坐标也落不了盘。新增 `figureMaterialisation.ts` + 8 条用例：`planFigureMaterialisation` 是**纯函数**，产物要么是 `solid.create_face` 的**骨架（一个数字都没有**）、要么是六个各不相同的拒绝码。计划点名的三个要求各有一条用例（能造 / `competing_rings` / `name_conflict`），另加四条边界（现场真实形状 `E/F/P` 的既有宿主、没读出环、题设没读全、环上出现题面没有的点名）。**变异**：短路 `competing_rings` ⇒ `expected 'materialise' to be 'refused'` 真红，还原复绿。**诚实记**：本轮是先写完测试与实现再一起跑的，**没有 RED 读数**，故补做变异。**自己修掉一处夹具矛盾**：两个"拒"的夹具结构相同（都是三名字宿主与环有交集）却要求不同码 —— 改成"有交集 ⇒ name_conflict；无交集 ⇒ existing_host"，第二个夹具换成现场真实的 `E/F/P`。
- [x] 将 `FigureIntent` 通过窄适配物化为已有 `solid.create_face` 等动作；**先校验形状/名字的唯一性，再生成宿主**，交给 `compilePlan` 和同一草稿事务；禁止为凑宿主填随机坐标后在核验器前跳过检查。若生成条件不足，反馈“缺结构/欠定并有自由选择”，不是“已经按题面生成 BCD”。
      **2026-10-12（Worker 同判已补，任务收口）**：`geometryWorkerHost.planar.test.ts` 新增 `Task 7: the worker synthesises the missing host too` —— 同一份**没有宿主**的计划跨线程之后，图上照样出现系统补出来的 `A`/`B`/`C`/`D`，且断言 `posted[0].witnessSearch === true`（开关本身也必须过边界）。**变异**：关掉合成（`if (true || …) return null`）⇒ **两条路同时真红** —— 主线程 `expected 'unverified' to be 'passed'`，Worker `A 没有在 Worker 里被补出来: expected [] to include 'A'`（**与现场症状逐字相同**）。还原后定向 **6 文件 / 125 通过**；Task 1 适用切片 7 文件 / 123 通过；`typecheck` exit 0；`lint` 0 error / 13 warning。**golden 一个文件都没改。**
      **接线要点**：`existingHosts` 只认 `create_polyhedron` / `create_face`（第一版把**所有**动作都算宿主，夹具里的 `planar.create_point` 让判据判成 `existing_host` —— **判据把自己挡住了**；同一个词在两处含义不同必然分叉）。**端到端实证**：`planCompiler.test.ts` 新增一条 —— 计划只有一笔 `planar.create_point`（在可核验动作表里、不产出面）⇒ 系统补出平面四边形 ⇒ `diagramVerification.status === "passed"`，且落盘坐标**自算** `|AB|=8`、`|CD|=3`。**golden**：`planCompiler.test.ts` 68 项（含 `planCompiler.offPath.golden.test.ts`）全过。
- [x] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/figureMaterialisation.test.ts packages/agent-core/src/planCompiler.test.ts apps/web/src/agent/diagramDraftStage.test.ts apps/web/src/agent/workerContracts.test.ts --reporter=dot`；Worker 和主线程不得不同判，关旗旧路径与已宣称的 golden 保持兼容。
      **2026-10-12**：定向（含 `geometryWorkerHost.planar.test.ts` 与 `planCompiler.offPath.golden.test.ts`）= **6 文件 / 125 通过 / 0 失败**；关旗旧路径 golden 逐字节未变；Worker 同判见上一条的变异读数。

### Task 8｜Worker 与主线程同版合同

**文件**：apps/web/src/agent/geometryWorkerHost.ts、workerContracts.ts、draftStore.ts、agentRunner.ts 及对应测试。

- [x] **RED→GREEN（Worker 同版）**：Task 7 的同一图形意图经主线程/Worker 物化后的图元、条件 ID、点名和报告版本必须相同；输入改版后迟到 Worker 结果不能写进当前草稿。先写 `workerContracts.test.ts`/`geometryWorkerHost.test.ts` 会因版本或序列化不同变红的用例，再只调整 Worker/草稿传输。运行 `npm.cmd exec vitest run -- apps/web/src/agent/workerContracts.test.ts apps/web/src/agent/geometryWorkerHost.test.ts apps/web/src/agent/draftStore.test.ts --reporter=dot`。**此时不宣称视觉或桌面可用**；Task 8 GREEN 才允许 Task 18 复用图版本合同。
      **2026-10-12 读数**：① **等价**：`diagramDraftStage.test.ts` 新增"缺宿主输入两条路同版"（图元 / 报告 / 点名逐字相同）；**变异**掐掉 `witnessSearch` 转发 ⇒ `expected [ 1 个图元 ] to deeply equal [ 10 个图元 ]` —— **Worker 只有模型那一笔孤点、主线程多出系统补的四边形，两边都不报错**（连同两条既有等价用例一起真红）。② **迟到回包**：闸**本来就在**（`geometryWorkerClient` 四项核对，本批未改）；真缺陷在它下游 —— `compileInWorker` 的失败分支**不搬 `code`/`detail`**，于是"回包属于另一版"变成诊断为空、`stage` 只能说"编不出动作"（**误诊**）。**RED** `expected '' to contain 'stale_artifact'` ⇒ **GREEN** 用回包自己的 `code`+`detail` 造一条（`stage: transport`、`path: worker`）。定向 **6 文件 / 55 通过**；Task 1 适用切片 7 文件 / 123 通过。

**退出**：意图/图元/条件报告/版本序列化一致，迟到的 Worker 回包不能写进新版草稿；不以此宣布视觉或桌面可用。

### Task 9｜真题离线评测工件

**文件**：apps/web/src/agent/fixtures/benchmarkPlanningEval.ts、scripts/agent-eval.mjs、packages/agent-core/src/benchmark/ 及已有测试。

- [x] **RED→GREEN（无付费评测工件）**：Task 7 后把**已完成调研**中许可允许的原题条件/图需求接到现有 `benchmarkPlanningEval.ts` 和 `scripts/agent-eval.mjs`：卷别、题号、来源等级、输入许可、必要图、独立条件回代/错图/欠定反例和留出集。先写“未审转载答案不能充 oracle、同一原题变式泄露进留出集”红例，再由离线工具转绿；这是 Agent 评测**工程接线**，不是将研究推给下轮。

**退出**：离线样本可复跑、错图 oracle 会拒绝、开发样本与留出题无泄漏；本任务不得发送真实 provider 请求。
      **2026-10-12 完成**：读数与边界见 §7 表第 9 行；随仓题面全标 `survey-summary`（不拿摘要冒充原题）、`verifiedGoldCaseIds` 仍为空。

### Task 10｜边上分点和动态依赖

**文件**：`packages/geometry-kernel/src/witness/constructors.ts`、`witness/constructors.test.ts`、`dynamic-points.ts`；`packages/agent-core/src/diagramVerification.ts`、测试；`packages/geometry-kernel/src/dependency-graph.ts`、`packages/scene-graph/src/actions/index.ts` 的确需变化时才改。

- [x] **RED**：ABCD 坐标变化后 E 必须仍在 AD 上且 AE:AD=2:5、F 必须仍在 AB 上且 AF:AB=1:2；交换 AD/DA 与 AF/FB 的输入时方向/比例不可乱；E/F 同名冲突、端点重合及两份计算得出不相容位置要拒绝。
- [x] 把“点在已命名边上、按比例产生”变成由宿主点名和无量纲参数定义的派生对象（非模型手写点坐标），运行时投影/更新走现有依赖机制；`diagramVerification` 从最终点重新量比例而不直接相信参数值。借 GeoGebra 的**依赖设计模式**，不移植其代码。
- [x] 运行 `npm.cmd exec vitest run -- packages/geometry-kernel/src/witness/constructors.test.ts packages/geometry-kernel/src/dynamic-measurements.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；改底面与撤销后草稿/坐标/报告需同版本，算出来的点能真正显示。
      **2026-10-12 完成**：读数与边界见 §7 表第 10 行。

### Task 11｜三角形真题纵向交付

**文件**：`packages/geometry-kernel/src/witness/constructors.ts`、`packages/agent-core/src/solver/witnessSearch.ts`、`diagramVerification.ts`；扩 `packages/agent-core/src/solver/planarFigure.test.ts`；新建 `e2e/agent-exam-triangle.spec.ts`。

- [x] **RED**：用真题研究的 2021/2022/2023/2024 边角面积/边上分点结构（遵守来源许可）加换点名、改角度、SSA 两解、无解、欠定、角顶点写错的错图；不能只断言“生成了点”。
- [x] 先做边/角/面积联解与分支选择，再物化点边辅助线；已有 `planarAngle` 与自交判据只保留一份。输出自由度/两解选择来源；从实际图量边、角、面积、方向。
- [x] `npm.cmd exec vitest run -- packages/agent-core/src/solver/planarFigure.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-exam-triangle.spec.ts --workers=1`。需有真实 2D 截图/可读标注与一步撤销，反例不能出“全部核验”。
      **2026-10-12 完成**：读数与边界见 §7 表第 11 行；全量 e2e 未跑（计划原文的边界）。**2026-10-14 收口「`∠A` 单字母角不认」**：读取器先留占位、整句解析完由 `resolveStatedVertexAngle` **问形状从句的环**取邻点（与"底面"那条同一个形状；问不出来就不猜、如实落未核验），落成 `[前一个点名, 顶点, 后一个点名]` 后走**既有的** `planarAngle`（判据与构造一个字都没改）。端到端读数：`平面三角形ABC中，AB=8，∠A=30°，BC=4` ⇒ `verified_instance`，测试自己从坐标量出 30°。门禁：全量单测 **376 文件 / 4455 通过 + 1 todo / 0 失败**（44.51 s，exit 0）、`typecheck` exit 0、`lint` 0 error / 13 warning；**全量 e2e 236/237**（唯一一条是已记过的负载敏感抖动 `main-thread-responsiveness`，单独跑绿）。

### Task 12｜从目标距离反求折角

**文件**：`packages/geometry-kernel/src/rotation3d.ts`、`witness/constructors.ts`、对应新测试；`packages/scene-graph/src/actions/solidFoldAction.test.ts` 与 `actions/index.ts`；`packages/agent-core/src/diagramFoldPoints.test.ts`、`diagramVerification.ts`。

- [x] **RED**：以用户原题中经独立回代的 ABCD/E/F 为输入，不提供模型猜的 P 或角，要求系统在允许的 `(0°,180°]` 中求出使 `PC=4√3` 的折角；反向折痕、修改 PC 无可行解、折痕退化/翻折后面重合分别判对。原先 `solid.fold(angle=90)` 的单测不得冒充这条 RED。
- [x] 对**固定点到旋转后点的距离**优先利用 `rotateAboutAxis` 所确定的三角关系解析枚举候选角；更一般的目标关系才进行有上界的区间搜索，并把找不到根与不能证明无解分开。每一候选交既有 `solid.fold` 物化，核验器从最终 P/C 坐标重算 PC、折痕不动与被折面刚体长度；多支保留来源/选择，不凭 90° 特判。
- [x] 运行 `npm.cmd exec vitest run -- packages/geometry-kernel/src/witness/constructors.test.ts packages/scene-graph/src/actions/solidFoldAction.test.ts packages/agent-core/src/diagramFoldPoints.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`。此任务过后仍需 Task 16 的真实产品验收 才能说“整题能画”。
      **2026-10-12 完成**：读数与边界见 §7 表第 12 行；更一般目标关系的区间搜索未做，e2e 归 Task 16。
      **2026-10-16 功能补完**：新增有界关系搜索并接入 `compilePlan`，支持 `planarAngle`、`dihedral`、`linePlaneAngle` 的单折叠救援；有限搜索明确 `not-found` 不等于 `unreachable`，候选必须完整回代核验。解析固定距离每支逐一尝试。定向 212/212 与 Task 13 原用户浏览器链路 7/7 通过。Task 12 现按功能范围完成；Task 13/15 仍有独立缺口。**2026-10-14 收口「两支角合法时另一支未披露」**：`solved` 那一档只返回允许区间内的候选，另一支（`360° − θ`，"朝折痕另一侧折"）被区间过滤掉了 —— 而它同样满足题面那个距离（`C` 在底面内 ⇒ `P(−θ)` 与 `P(θ)` 到 `C` 等距）。修法是**拿同一个求解器、把区间放开**再问一次，差集写进假设文案（"另外还有 N 支折角（…）同样满足题面那个距离…系统没有取它们"）；判据不新写。新 `planCompiler.foldBranches.test.ts` 用用户原话跑完整 `compilePlan` 并自己核对（落盘 `|PC| = 4√3`、放开区间确实两支、刚好一支没取、且出现在文案里），旧四条 `faceRatios` 用例无回归。门禁：全量单测 **377 文件 / 4456 通过 + 1 todo / 0 失败**（43.54 s，exit 0）、`typecheck` exit 0、`lint` 0 error / 13 warning；**全量 e2e 236/237**（唯一一条是已记过的负载敏感抖动，单独跑绿）。

### Task 13｜立体几何真题纵向交付

**文件**：`packages/geometry-kernel/src/witness/constructors.ts`、`prism.ts`、`sections3d.ts`、`measurements3d.ts`，`packages/scene-graph/src/actions/index.ts`；扩 `packages/agent-core/src/diagramVerification.test.ts`；新建 `e2e/agent-exam-solid.spec.ts`。

- [x] **RED**：研究中的 2021/2022 棱柱/棱锥、2023 棱台/棱柱、2024 四棱锥与 2025Ⅱ-17 翻折；变化底面数、顶点垂足不在中心、斜棱柱、棱上/面上点、二面角、展开与组合实体。必须有“图形很像但缺 B/C/D 或折后 P 错”的负例。
- [x] 先复用 S1–S6 已有形状数据化与 `solid.create_face`/`fold`，仅对真题反例逼出的空间角/截面/组合关系补构造与核验；开放面片不装成 polyhedron，球/圆台近似保留误差文字。不为没有产品入口的空间 `coincident` 单独造隐形约束。
- [x] `npm.cmd exec vitest run -- packages/geometry-kernel/src/witness/constructors.test.ts packages/scene-graph/src/actions/solidFoldAction.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-exam-solid.spec.ts --workers=1`。原用户题必须从输入到真实草稿/画布/确认/撤销，七点与八条题设逐一可查；仅内核单测通过不勾 D-S。
      **2026-10-12 完成**：读数与边界见 §7 表第 13 行；面上点、展开仍为缺口。**2026-10-14 收口「斜棱柱明说倾角」**（该边界写下的三层一层不少）：`diagramObligations` 新增 `linePlaneAngle`（`AA′与底面所成角为45°` / `AA′与平面ABC所成角为60°` 都收；写"底面"时由 `resolveStatedBasePlane` 用**形状从句**落成底环点名，认不出就不猜）；`witnessSearch.statedLateralTilt` 只认"侧棱 + 底面"那一条并把**线面角换成与法向的夹角**（互为余角：题面 60° ⇒ 法向 30°）；`diagramVerification` 从**最终坐标**量 `sin θ = |v·n|/(|v||n|)`。顺带：题面明说的斜向不再写进 `freeValues`（新增 `SolidShapeSpec.lateralTiltSource`）。门禁：全量单测 **375 文件 / 4434 通过 + 1 todo / 0 失败**（46.93 s，exit 0）、`typecheck` exit 0、`lint` 0 error / 13 warning；**全量 e2e 三次各红一条负载敏感抖动**（`geometry3d-drag` 与 `main-thread-responsiveness`，两条单独跑都绿）—— 按本仓口径记为抖动，不说成全绿。

### Task 14｜圆锥曲线真题纵向交付

**文件**：`packages/geometry-kernel/src/conics.ts`、`curve-intersections.ts`、`curve-tangents.ts` 及测试；`packages/agent-core/src/diagramObligations.ts`、`diagramVerification.ts`；扩 `e2e/agent-conic-kinds.spec.ts`，新建 `e2e/agent-exam-conic.spec.ts`。

- [x] **RED**：2021/2022/2024/2025 真题的焦点/轴向/渐近线、动弦/面积、多曲线组合、相切/无交/竖直线、错轴反例；2024Ⅰ-11 非圆锥曲线必须明确不归为椭圆/双曲线。
- [x] 优先复用现有椭圆/双曲线/抛物线 primitive 与交点内核；新求解只补真实缺的“条件反求曲线参数 + 动直线/弦/切线”接口，切触用代数重根或可验证切向条件，不用画面采样宣称恰有 n 个交点。用最终曲线参数、焦点和实际交点回代，残差与数值近似可见。
- [x] `npm.cmd exec vitest run -- packages/geometry-kernel/src/conics.test.ts packages/geometry-kernel/src/curve-intersections.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-conic-kinds.spec.ts e2e/agent-exam-conic.spec.ts --workers=1`。错误轴/丢一交点测试必须真红。
      **2026-10-12 本任务**完成**（分四块：先修一条真缺陷，再补代数求解、条件反求与判据，最后 e2e）**。按计划「新增可复现 P0 故障时先停在当前编号、在该任务下补 RED / 修复 / 旧路证据」处理。**① RED**（`packages/geometry-kernel/src/conics.test.ts` 新增「双曲线的 axis 语义（实轴，不是参数方向）」2 条，先真红）：`axis=x 的点 (0, 2) 不在这条双曲线上: expected -1 to be close to 1`、`axis=x 的实轴顶点没落在曲线上: expected +0 to be 2`。**② 根因**：`axis` 的语义在两半代码里是**两套** —— 题面侧唯一声明是「实轴」（`diagramObligations.ts:150` 原文「`x²/… − y²/… = 1` 的实轴沿 x」），核验文案（`diagramVerification.ts:361`）、焦点/顶点标记（`GraphicsView.tsx:79`、`annotations.ts:18`）与 e2e 的意图也都按实轴；而**采样器 `sampleHyperbola`、隐式形式 `hyperbolaConicCoefficients`、约束 `hyperbolaConstraint` 三处**按「参数往哪边走」实现，算出的曲线**实轴垂直于声明** —— 三处互相自洽，所以测试全绿，净效果是**画出来的双曲线与它自己的实轴、焦点相差 90°**（`planar-constraints.ts` 的旧注释还专门论证过「按字面取是错的」）。**③ GREEN**：三处统一到实轴口径（`sampleHyperbola` 参数扫实轴坐标、`|坐标| < 半实轴` 无点、取 domain 绝对值上界以支持只看单侧的视野；`hyperbolaConicCoefficients` 的 `qxx/qyy` 改成 `±b²`/`∓a²`；`hyperbolaConstraint` 的 `evaluate`/`search`/`tangent` 同步，**切线改用隐式梯度**因此在顶点（斜率无穷大）也成立）；顺带修 `annotations.ts:21` 顶点距离三元式两支写同一个值、给渲染与导出加共用的 `hyperbolaDomain`（`axis: "y"` 时递 y 范围）、更正 `diagramVerification.ts` 里「只认 ellipse」那句过期注释。**④ 旧路证据**：`packages/geometry-kernel` 全包 **54 文件 / 753 通过**；`typecheck` exit 0；三个圆锥曲线 e2e **5 passed**（`agent-conic-kinds` / `agent-conic-ellipse` / `agent-conic-invariant`）。**⑤ 全量还抓出三处下游**：`App.test.tsx` 与 `scene-graph/curveTangents.test.ts` 的「给每种曲线作切线」红在双曲线（`status` 该是 `approximate` 却是 `undefined`）—— 根因是**约束层在缺口里返回 `null` 会让投影假报"找不到"**，改成「**约束层把参数夹到 ±半实轴**（它必须满射）/ **采样层留空**（折线不能把两支连起来）」后转绿；`scene-store.test.ts` 的「拖到另一支仍留在本支」把旧几何（`u=0 ⇒ (0, ±2)`、`u=6 ⇒ (6, −2√5)`）写死了，按新口径改成**顶点 `(3, 0)`** 与 **`(6, −2√3)`**。**其中 5 条把旧参数化写死的断言按新口径改正**（`conics.test.ts` 2 条形状断言、`curve-tangents.test.ts` 的切线参数集、`planar-constraints.test.ts` 2 条分支断言），每处都注明了理由。**⑥ 代数直线∩圆锥曲线已落地**（新模块 `packages/geometry-kernel/src/conic-line.ts` + 同名测试 8 条，先红后绿）：一元二次判别式给出**重数**，五档分开 —— `none` / `tangent`（重根）/ `secant` / `single`（与抛物线对称轴平行 ⇒ 恰好**一个**有限交点，**必须与"相切"分开**，否则"恰好一个交点"这句话在两种完全不同的几何之间来回漂）/ `degenerate`；**竖直线**单独成支（斜截式表达不了）；每个分支都带 `residual` 与 `tangency`（`|∇Q·d| / (|∇Q||d|)`，0 即真相切）两样可核读数。**过程中被自己的判据抓住两次**：① 用 `Δ` 绝对值当相切阈值时，切点恰好落在曲线上会让 `β²` 与 `4αγ` 同时为 0、阈值塌成 0，旋转椭圆那一支被判成 `none` ⇒ 改成**根间距相对根尺度**；② 容差量纲又写成 `(1e-9·rootScale)²`，比"切点只精确到机器精度"带来的噪声（实测 `spreadSquared ~ 1e-16`）还紧 ⇒ 改成 `1e-12·rootScale²`。`typecheck` exit 0；内核包 **55 文件 / 761 通过**。**⑦ 条件反求曲线参数已落地**（新模块 `packages/geometry-kernel/src/conic-parameters.ts` + 同名测试 15 条，先红后绿）：三条路径 —— **两焦点 + 曲线上一点**（椭圆 `2a = |PF₁| + |PF₂|` / 双曲线 `2a = | |PF₁| − |PF₂| |`，轴就是两焦点连线）、**焦点 + 准线**（抛物线，`p = |FL|`）、**统一式 `|PF| / dist(P,L) = e`**（`e<1` 椭圆 / `e=1` 抛物线 / `e>1` 双曲线 —— 离心率这一支由此进来）。三种结局分开：`solved` / `contradictory`（焦点落在准线上、`2a ≤ 2c`、点落在两焦点之间或中垂线上）/ `unsupported`（两焦点重合、离心率非正）。**残差在采样出来的曲线上逐点复核定义式**，不拿反求过程的中间量自证；**轴对齐时报轴对齐**（不写成 `axis:"x" + rotation:π/2` —— 核验器比的就是 `axis` 字段，那样会被判成"另一条曲线"）。**过程中三处自查**：① `axis:"y"` 的双曲线两个半轴字段是**换位**的（半实轴落 `radiusY`），与测试里的期望一致才算对；② 我一度按 DSL 的导出名去 import `ConicLine`，`typecheck` 立刻报 `TS2724` ⇒ 改成复用 `conic-line.ts` 里那份定义（"过两点的直线"只留一份）；③ **我又踩了一次仓库自己记过的坑** —— 用 `Set-Content` 改源码，把中文注释写成乱码并加上 BOM，`git checkout` 恢复后用编辑工具重做（那条"源码改动一律走编辑工具、不用 shell 重写文件"的纪律是有效的，是我违反了它）。`typecheck` exit 0、`lint` 0 error / 13 warning、内核包 **56 文件 / 776 通过**。**⑧ 新义务种类 `conicChord` 与它的判据已落地**（`diagramObligations.ts` + `diagramVerification.ts`，判据 13 条先红后绿）：题面 `…与直线 y=x+1 相交于 A、B 两点` / `…与直线 x=3 相切` / `…没有交点` 读成一条义务（`line` 是斜截式**或竖直线**，`expectation` 是**代数档位** `secant`/`tangent`/`single`/`none`）。判据两层缺一不可：① **定性** —— 把题面那条直线与**最终落盘**的曲线交给 `intersectLineWithConic`（判别式给重数），档位必须与题面声称的同名；② **定量** —— 代数算出来的**每一个**交点，图上都得有个点名落在那儿。**「丢一交点必须真红」现在真的会红**（旧实现只会 `null` ⇒ 未核验、永远不红）：失败文案逐字给出"代数上确实有 2 个交点（(−3, 0)、(3, 0)），但图上只找到 1 个 —— 丢了 1 个交点"。**三处设计决定**：① 新匹配器的范围**只吃"直线 + 情形"那一段**，绝不圈进曲线方程 —— 解析器按**字符占位**去重，圈进去会把 `conicAxes` 那条整条吞掉（症状是"半轴/轴突然不核验了"，且只在带直线的题面上出现），有一条判据专门钉"两条义务并存"；② **题面点了名才要求图上有点**（只写"相切"时题面主张的是相对位置，多要一个切点是替题面加戏）；③ 平面积点表**另取一份**（`FigureContext.planarPoints`，读 `point` 图元的 `label`）—— 原有那张 `candidatePoints` 只从多面体/面片的 `vertexNames` 建，圆锥曲线文档里它是空的（实测：拿它会把"两条都画对了"判成"丢了两个交点"）。**错轴那条也红**：半轴一样、轴反了的双曲线与 `y=0` 的交点从 (±3, 0) 变成 (0, ±2)，交点判据当场不认。**⑨ e2e 已建**（`e2e/agent-exam-conic.spec.ts`，2 条）：正例走**完整产品路径**（题面 → 本地规划器 → 隔离草稿 → 核验 → 确认 → 落盘 → 一步撤销），并在测试里**自己从落盘坐标算**那两个交点既在椭圆上、也在 `y = 0` 上、且正是 `x = ±3`；反例与正例**共用同一份计划**、只把题面里的直线改成 `y = 1`（代数交点是 `(±3√3/2, 1)`），于是"通过"不可能来自"计划恰好画对了"。反例的浏览器读数是 **fail-closed：确认面板根本不出现**（抄本仓既有的四条 fail-closed 口径：没草稿 / 运行落定且有话说 / 文档逐字未变 / 不占撤销历史）；判据"红"本身由单测钉死（「丢一交点 ⇒ failed」「错轴 ⇒ failed」）。**仍记的边界**：① 2024Ⅰ-11 非标准曲线的「明确不归类」判据**未做**；② 「动弦」做到了（交点个数与位置），**弦长/面积未接**；③ 反例那一侧在浏览器里是 fail-closed，**没有**"面板上出现一条红"的读数（单测有）。**全量 367 文件 / 4338 通过 + 1 todo / 0 失败**（553.04 s）、全量 e2e **227 通过**（首跑 1 条斜棱柱用例抖动 ⇒ 单独跑 3/3 绿 ⇒ 复跑全量 227/0，按本仓口径记为抖动而不是绿）、`typecheck` exit 0、`lint` 0 error / 13 warning、`docs-consistency` 4 文件 12 通过。

      **2026-10-14 边界收口（非标准曲线的「明确不归类」）**：调研 §C 对 `2024 新课标Ⅰ卷第 11 题`的原话是"非标准曲线，暂记范围外/跨家族候选，不伪装成椭圆/双曲线/抛物线"，而此前这类方程落进**通用**残留文案「原题出现了尚未被可靠解析的几何条件」—— 把**范围外**说成了**没写清楚**。修法：`diagramObligations.ts` 新增 `CURVE_EQUATION_TERM`（**小写** `x`/`y` 的平方项）与理由函数，两条残留路径共用同一句；命中时明说"没有归入本仓支持的三类标准圆锥曲线 ⇒ **明确不归类**（范围外）"。**反向判据**：`AB²=4`（大写=线段平方）照旧走通用文案，不许被贴该标签。**RED → GREEN**：修前实测拿到通用那句，两条断言都挂；修后 `diagramObligations.test.ts` 40 通过。门禁：全量单测 375 文件 / **4429 通过** + 1 todo / 0 失败（45.83 s，exit 0）、全量 e2e **237 通过**（2.0 m）、`typecheck` exit 0、`lint` 0 error / 13 warning。**仍未做**：弦长 / 面积未接。

      **2026-10-14 收口边界「弦长/面积未接」（先量后改）**：**面积那一半不是解析缺口** —— `△OAB的面积为3` 今天就读成 `area`（三个点名 + 值，核验器从最终坐标算），核不核得出来只取决于**图上有没有点名 `O`**（作图侧）；**弦长那一半是真缺口，而且比"未核验"更糟**：`弦 AB 的长为 3` 这种写法两条读取器都不认、句子里又没有 `=` ⇒ 残留扫描器也够不到 ⇒ **静默丢掉一条题设**。修法：`diagramObligations` 新增 `弦 AB 的长为 n`（连接词 `为/是/＝/=` 都收）与 `|AB|=n` 两条读取器，判据**复用 `fixedLength`**（不新造），根号写法照收。RED 三条先真红（`expected [] to deeply equal [ [ 'AB', 3 ] ]`）→ `diagramObligations.test.ts` **52 通过**。门禁：全量单测 **375 文件 / 4448 通过 + 1 todo / 0 失败**（44.06 s，exit 0）、**全量 e2e 237 通过（1.9 m，exit 0）**、`typecheck` exit 0、`lint` 0 error / 13 warning。

      **2026-10-14 收口边界「面积核验要求图上真有那个点名」**：解析几何里 `O` 约定为原点，而题目通常不画 `O` ⇒ `△OAB的面积为…` 卡在"点名缺失：O，未核验"。修法：`statedOriginNames`（一处判据）+ 在 `verifyDiagramObligations` 里补进**这一份核验用的点名表**（不动文档），披露写进那条判据的 `reason`。**三条不认约定的情形**：图上已有 `O`；题面用坐标定义过 `O`；题面用构造定义过 `O`（`O为 BD的中点` 一类）—— 最后一条是**实测逼出来的**（第一版只挡坐标 ⇒ 全量红 6 条），判据交给内核 `ratioParameterFor`。端到端用例：题面点名 O、图上没有 ⇒ 面积 `passed`、`actual = 1`、理由写明按原点取。门禁：全量单测 **378 文件 / 4459 通过 + 1 todo / 0 失败**（44.82 s，exit 0）、**全量 e2e 237 通过（2.0 m，exit 0）**、`typecheck` exit 0、`lint` 0 error / 13 warning。**下一件**：外点双切线/公切线的产品动作（探过路：要新锚点 + `analysisRecompute` + 内核"过外点求切线"，不是一轮的量）。

      **2026-10-15 加一条系统审计**（`examClauseCoverage.test.ts`）：**带具体条件的句子必须出现在 `givens` 或 `unverified` 里**（消失不行）。先量出的前提：随仓 12 道"真题题面"全是**主题摘要**（`survey-summary`），按"每句记账"卡会得到 6 条**假红**；于是判据分两段 —— 摘要那一批只卡"既有条件词又有数字"的句子（今天 0 条，等 verbatim 题面进仓才咬人），具体句那一批拿真实用过的问题句逐句卡。**审计照出一处真缺口**：「弦 AB 的**长度**是 3」读不出来（同样没有 `=`），已把 `的长度为/的长度是` 收进读取器。**对照组**（`弦 AB 大约 3` 必须被报出来）证明判据会咬人。门禁：全量单测 **379 文件 / 4481 通过 + 1 todo / 0 失败**、**全量 e2e 237 通过（1.9 m）**、`typecheck` exit 0、`lint` 0 error / 13 warning。

### Task 15｜函数与导数真题纵向交付

**文件**：`packages/geometry-kernel/src/calculus.ts`、`evaluate.ts`、`curve-intersections.ts` 及测试；`packages/agent-core/src/diagramVerification.ts`；`apps/web/src/agent/localPlanner.ts` 与现有函数图入口；扩 `e2e/agent-function-tangent.spec.ts`，新建 `e2e/agent-exam-function.spec.ts`。

- [x] **RED**：2021Ⅰ-7 外点双切线、2022Ⅰ-22 多交点、2024Ⅰ-7 三角图相交和第 13 题公切线；反例为断点被连线、错切点、漏近重根、把一个参数实例写成“所有参数成立”。
      **2026-10-12 完成**：`packages/geometry-kernel/src/function-evidence.test.ts`（19 条，先真红：模块不存在）逐条钉住四个真题形状与四类反例；判据层的四条红例写在 `packages/agent-core/src/diagramVerification.test.ts` 的 `Task 15: function-family premises`（先真红读数：断点题 `expected 'unverified' to be 'passed'` / 反例 `expected 'unverified' to be 'failed'`；尖点 `expected 'passed' to be 'failed'`；范围字段 `expected undefined to be 'figure-instance'`）。
- [x] 为函数定义域/参数来源/分段与切点建立类型化关系；可由代数或经独立验算的数值根构造切线/交点时才称已核验，“数值图像”与“全区间根数/单调性已证明”分开状态。图像随参数重绘、切点标签与导数读数同源；未覆盖的抽象函数题安全解释，不能编出唯一图。
      **2026-10-12 完成**：`EvidenceGrade = algebraic | verified-numeric | plot-only` 与 `complete` 两个字段分开；`functionLineRoots` / `functionIntersections` 在多项式次数 ≤ 2 时走**判别式**（重数结构精确，近重根 2e-5 也分得开），其余走"采样定界 + 牛顿抛光 + 独立回代"，`complete` 由"两分辨率一致 + 无落进判零带却不变号的格子"合成；`functionGraphEvidence` 给出分段与断点；`tangentsFromPoint` / `commonTangents` / `verifyTangentLine` / `differentiabilityAt` 各自独立回代。**边界（如实记）**：`complete` 是数值完备性、不是全区间根数/单调性的证明；抽象函数题**没有**实现"不能编出唯一图"的处置（今天没有产品入口产出这类图像 ⇒ 记成边界而不是造一个隐形判据）。**图像随参数重绘**由既有 `parameter.*` + 派生节点承担（本任务未改），**切点标签与导数读数同源**指面板里那条 `verified-numeric` 读数由核验器自己求导、不使用图元自报的 `slope`。
- [x] `npm.cmd exec vitest run -- packages/geometry-kernel/src/calculus.test.ts packages/geometry-kernel/src/curve-intersections.test.ts packages/agent-core/src/diagramVerification.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-function-tangent.spec.ts e2e/agent-exam-function.spec.ts --workers=1`。同一题的数值画图成功不得升级为形式证明。
      **2026-10-12 完成**：定向 `calculus.test.ts`（9）+ `curve-intersections.test.ts` + `diagramVerification.test.ts`（46）+ 新 `function-evidence.test.ts`（19）全绿；两个 e2e **3 passed**（26.9 s）、**全量 e2e 229 通过**（2.6 m，0 抖动）；全量单测 **368 文件 / 4364 通过 + 1 todo / 0 失败**（125.34 s，exit 0）；`typecheck` exit 0；`lint` **0 error / 13 warning**（与基线同数：新模块里那条 unused 已清）；`docs-consistency` 4 文件 12 通过。**"数值画图不得升级成形式证明"是类型上的**：`universalClaims` 只有 `not-proven` 一个取值，`grade` 把"折线上的比较"单列一档。

      **2026-10-14 收口边界「函数∩直线的交点数」**（边界原文：尚未有义务种类与匹配器 ⇒ "多交点"那一型进不了核验面板）：`diagramObligations` 新增 `functionLineIntersections`（斜截式 / 水平线 / 竖直线三条线形与圆锥曲线那一族同一套；个数中文与阿拉伯数字都认）；个数写在**前瞻**里、只占用「直线 …」那段（中间的 `f(x)=…` 已被函数定义读取器按字符占位收走，吃进来会因重叠整条跳过 —— 首版就是这么红的），数字后加 `(?![eE][+-]?\d)` 防 `y=1e-12` 被半读成 `y=1`；`obligationIR` 按**整数容差 0** 判性；`diagramVerification` 调 `functionLineRoots` 数**图上那条曲线**与题面那条直线的交点，`complete === false`（分辨不出近重根）时**如实未核验、不报 failed**，竖直线留白。门禁：全量单测 **375 文件 / 4442 通过 + 1 todo / 0 失败**（51.36 s，exit 0）、**全量 e2e 237 通过（2.2 m，exit 0）**、`typecheck` exit 0、`lint` 0 error / 13 warning。

      **2026-10-16 收口边界「外点双切线没有产品动作」**：`function.create_tangent` 新增锚点 `{ kind: "through", pointId, branch }` —— 判据**复用**内核 `tangentsFromPoint`（`tangentThroughPoint` 只做翻译并把"第几条"翻成切点参数），编译期与重算期**同一个求解器**，重算共用既有 `parameter` 那段收尾。契约九处落点由 typecheck 逐个逼出（动作输入类型 / dsl 存储类型 / dsl 校验 / 补丁校验 / 编译 / 重算 / 发布 schema / 登记表嵌套引用 / 检查器文案）。**只收函数曲线**（圆与圆锥曲线如实 `unsupported_source`）；**公切线**与题面层面的核验仍未做。4 条用例：`(0, −1)` 向 `y = x²` 两支各一条、重算后测试自算"过点且相切、两条不同"、`(0, 1)` 在里面 ⇒ `no_tangent`、圆 ⇒ `unsupported_source`。门禁：全量单测 **379 文件 / 4485 通过 + 1 todo / 0 失败**（44.18 s，exit 0）、**全量 e2e 237 通过（2.0 m，exit 0）**、`typecheck` exit 0、`lint` 0 error / 13 warning。

### Task 16｜真实画布和过期证据

**文件**：apps/web/src/agent/geometryWorkerHost.ts、workerContracts.ts、draftStore.ts、agentRunner.ts，packages/geometry-kernel/src/dependency-graph.ts；新建 e2e/agent-exam-visual-and-stale.spec.ts。

- [x] **RED→GREEN（画布/交互证据）**：四家族每族已有真图后再加 `e2e/agent-exam-visual-and-stale.spec.ts`，用改题/改 AB/撤销/切文档/取消拖动和截图旧版本、点名遮挡、3D 虚实线/相机不可见做反例；仅查内存文档不算视觉通过。利用现有依赖图让分点→折面→交点随宿主重算，并把截图与证据绑草稿版本/哈希；运行 `npm.cmd run test:e2e -- e2e/agent-exam-visual-and-stale.spec.ts --workers=1`，浏览器/桌面各留真入口读数，教师/学生可读性另签收。数学真伪仍由独立核验器提供。
      **2026-10-12 完成（两块：先交画布证据面与过期判据，再修掉本任务读数抓出的重复标签缺陷）**：① **证据绑哈希 + 过期判据**（`packages/agent-core/src/verification/renderEvidence.ts`）：`documentHash` 必填并纳入 `evidenceIdentityProblem`；新增 `renderEvidenceStaleness`（**看内容哈希、不看版本号**；`document_changed` 与 `draft_replaced` 分开；带截图不改结论）。RED 5 条 → 全绿 22 条。② **真实画布证据**（新 `apps/web/src/canvasEvidence.ts` + 接进 `GraphicsView.tsx` / `threeScene.tsx`）：从**已渲染的 DOM** 量盒子与点名标签，诊断交给既有 `diagnoseLayout`；画布根元素上挂 `data-document-hash` / `data-canvas-boxes` / `data-canvas-labels` / `data-canvas-diagnostics` / `data-canvas-diagnostic-errors` / `data-canvas-hidden-labels` / `data-canvas-objects-measurable`；3D 如实标 `objectsMeasurable=false` 且不报 `empty_canvas`。7 条单测先红后绿。③ **e2e 6 passed**（35.5 s，四族各一次 + 三向反例）：画布自报哈希 == **测试自己**按 `canonicalContentHash` 口径规范化、再用 `crypto.subtle` 摘要的那一份（两份独立实现）；撤销 ⇒ 哈希变 + 画布报空；**改题** ⇒ 换成另一版内容；**视图变化**（缩放 / 切工作区再切回）**不**作废证据。④ **修掉本任务读数抓出的真缺陷**：翻折题落盘 9 个 `point3`、`E`/`F` 各带一遍同名标签（折片是与边上那两点坐标逐位相同的副本）⇒ 画布把同一串字母画两遍（`label_overlap`）、文档里点名到坐标有歧义。`compileSolidFold` 新增 `suppressedNames`：**折痕两端在原图上已有同名点时，折片副本不再挂标签**（新顶点 `P` 照挂；原图没有同名点时一个都不抑制），RED 先红（`expected [ 'P', 'E', 'F' ] to deeply equal [ 'P' ]`）后绿；渲染层同时不再拿**图元 id 当名字**画（3D 覆盖层只画有名字的点、2D `<text>` 同一规则）。e2e 收紧成"七个标签、无 `label_overlap`"仍 **6 passed**；受影响旧用例 `workerRuntime.test.ts` 的"带名字的点"断言相应改成**恰好四个**（副本仍在、只是没名字）。
      **仍记的边界**：3D 虚实线在 Three.js 内部、DOM 读不到（这一层只给相机可见性与标签）；把点名转出视锥需要把相机推近到实体内部，产品入口没有确定性做法（"文档有名字而画布没画"那一支在单测里钉住）；**"取消拖动"不是现有产品动作**（没有 Escape 取消拖动），以"缩放 / 切工作区再切回不失效"这条读数代替；**教师/学生可读性签收未做**（属发布门禁那一侧）。
      **读数**：`canvasEvidence.test.ts` 7 通过、`renderEvidence.test.ts` 22 通过、`solidFoldAction.test.ts` 10 通过、新 e2e **6 passed**（35.5 s）；全量单测与全量 e2e 见[当前状态](../../current-status.md)。

**退出**：三角、立体、圆锥、函数四族实际画布/相机/标签均同草稿版本；改题或撤销后旧图证据 stale。截图不能替代条件回代。

      **2026-10-14 收口边界「3D 虚实线 DOM 读不到」**（边界原文：虚实线在 Three.js 内部、这一层只给相机可见性与标签）：虚线是 `createSolidGroup` 按开关建出来的，所以**由真的建了它的那一层**（`threeSceneContent` 的同步）数段数（顶点数 ÷ 2）并写进场景容器 dataset（`hiddenEdgeSegments` / `hiddenEdgesShown`，与既有 `dataset.sceneSyncs` 同一位置同一条纪律）；`threeScene.tsx` 只转述，`canvasEvidence` 新增 `hiddenEdges: { shown, segments }` 与两个属性 `data-canvas-hidden-edges-shown` / `data-canvas-hidden-edges`（缺省"没画、0 段"）。**开关与段数分开报** —— 只报开关会让"开着但一段都没建出来"看起来也正常。门禁：全量单测 **375 文件 / 4444 通过 + 1 todo / 0 失败**（44.31 s，exit 0）、**全量 e2e 237 通过（1.9 m，exit 0）**、`typecheck` exit 0、`lint` 0 error / 13 warning。**仍未做**：转出视锥无确定性产品做法、"取消拖动"不是现有动作、教师/学生签收未做。

### Task 17｜Lean 原题前提与受限引理分级

**文件**：`packages/agent-core/src/proof/proofGoalReader.ts`、`proofGoals.ts`、`proofPremiseBridge.ts`、`canonicalProof.ts`、`lean4Adapter.ts`、`automaticProof.ts` 及同名测试；复用 `packages/agent-core/src/obligationIR.ts` 原文 span/ID。禁止更改 Rust 的模板白名单来给未证事实放行。

- [x] **RED**：原题加上“底面形状、点在边上、P 在面外、给定角/长度”中任一必要条件，而 Lean 模板只用了两条垂直前提时，产物不得显示为“原题已证”；缺前提、`fromFigure` 无实际物化点名、`invented` 非空、题设与图互相矛盾时不能升 `formally_proved` 的**整题级**。已有四目标类作受限引理的正例必须继续有效。
      **2026-10-12 完成**：新 `packages/agent-core/src/proof/proofScope.test.ts` 8 条（先真红：`Failed to resolve import "./proofScope"`）。反例那条是题面多给一条 `AB=2`：产物照样出、模板定理照样成立，但范围报告把 `AB=2` 列在命题之外、结局 `limited_lemma`，说明文案也写着"受限引理"。**四受限目标的原例继续有效**：`packages/agent-core/src/proof` 全目录 **11 文件 / 172 通过**（含计划点名的五份 **51 通过**）。**"题设与图互相矛盾"这一条如实记成边界**（矛盾由核验器判，不在范围报告里另判一份）。
- [x] 建 `ProofScopeReport`：`goalSourceId`、每一原题条件的 `formalized | dischargedByNamedDerivation | figureAssumption | notRepresented` 与源 span、选定的图实例/自由参数，明确结局 `limited_lemma | whole_problem | unsupported`。**只证明模板定理时默认 `limited_lemma`**；只有全题每条必要前提与目标都进入 Lean 命题、没有未核验/假设/弱化，且后端验过，才可能 `whole_problem`。没有可用的曲线普遍性质模板时直报 unsupported，不把函数采样、实例图或 `sorry` 当证明。
      **2026-10-12 完成**：`ProofScopeReport` 的字段与四档分类如上表 §7 第 17 行。**判据只留一份**：id 与 span 直接取自 `buildObligationIR(set)`（不另写一套编号），分类只读**前提桥的结论**（哪些前提进了命题、哪些是图上补的、哪些是凭空编的）。`unsupported` 覆盖"没有这一类模板"（读目标时拒）与"前提指不出出处"（前提桥 `invented` 非空）；`whole_problem` 还要求调用方**显式交出**"这份命题覆盖整道题"的声明 —— **今天没有产品调用方给得出它**（本仓没有完整原题 Lean 命题产物）。**"不把函数采样、实例图或 `sorry` 当证明"**由 `backendVerified` 一道闸承担：它只由适配器的判据给出（`sorryAx`、表外公理、缺报告都会被拒），这一层不自己判。
- [x] 运行 `npm.cmd exec vitest run -- packages/agent-core/src/proof/proofGoalReader.test.ts packages/agent-core/src/proof/proofGoals.test.ts packages/agent-core/src/proof/proofPremiseBridge.test.ts packages/agent-core/src/proof/canonicalProof.test.ts packages/agent-core/src/proof/automaticProof.test.ts --reporter=dot`；四受限目标的原有真例仍通过，新增“多一条原题条件”的反例不得升整题。**没有新的完整原题 Lean 命题产物，不勾 whole_problem。**
      **2026-10-12 完成**：计划点名的那条命令 **5 文件 / 51 通过**；`automaticProof.test.ts` 另加两条集成用例（`verified` 那次带 `scope.outcome === "limited_lemma"` 且 `detail` 含"受限引理"；**同一道题多给一条 `AB=2` ⇒ 产物照出、范围报告说它没进命题**）。**没有勾 `whole_problem`**：产品路径上它不可达（见上一条）；规则本身有一条用例证明"条件全进命题 + 显式声明 + 后端验过 ⇒ 才可能整题"，而在途的两类目标（性质定理那一类依赖图上补的前提）**有假设就升不上去**。**读数**：全量单测 **370 文件 / 4386 通过 + 1 todo / 0 失败**（128.65 s，exit 0；同批并发跑全量 e2e 时出现过一次 CPU 饥饿导致的假红，单独复跑为 0 失败）；全量 e2e **235 通过**（3.1 m）；`typecheck` exit 0；`lint` 0 error / 13 warning。

### Task 18｜证明产物异步绑定与可读 UI

**文件**：`packages/agent-core/src/proof/proofArtifact.ts`、`automaticProof.ts`；`apps/web/src/agent/automaticProofStage.ts`、`draftStore.ts`、`desktopProofChannel.ts`；`apps/web/src/components/settings/ExperimentalFeatures.tsx`、`components/agent/ConfirmationPanel.tsx` 与同名测试；新增 `e2e/agent-proof-lifecycle.spec.ts`（浏览器降级/设置入口）及需要桌面人工走查的步骤。

- [x] **RED**：开启开关开始慢证明，在后端返回前改题/改图/撤销/切工作区/导入别的文档；旧产物必须标 `stale` 或丢弃，不能贴到新 claim 或图上。`claimId` 匹配但 `inputHash`/后端版本/自由选值不匹配一样拒；坏 IPC 不能变“已证明”；关旗无调用且确认面板没有证明栏。
      **2026-10-12 完成**：RED 7 条（`proofArtifact.test.ts` 的新 describe，先红："`proofAttemptStaleness` is not a function"）+ 草稿层 1 条（`draftStore.test.ts`：第二次暂存换了候选而证明块被跳过 ⇒ 那一栏必须翻 `stale`，先红在"detail 里没有'过期'"）。**"`claimId` 匹配但 `inputHash`/后端版本不匹配一样拒"**：`verifyProofArtifact` 的 `input-mismatch` 早就有，这一批把 `backendVersion` 也纳入（`backend_replaced`）。**"坏 IPC 不能变'已证明'"**沿用它既有的判据（`proofArtifact` 的 `backend-not-wired` / `missing-field` / `wrong-type` + `desktopProofChannel.normalizeProofChannelResult`），本批没有放宽任何一条。**"关旗无调用且面板没有证明栏"**既有证据保持（`draftStore.test.ts` 的"连 `proofAttempt` 这一栏都没有" + `next-phase-flag-entry.spec.ts` 的两条），新 spec 里也各有一半。
- [x] 让证明请求/回包/`ProofScopeReport` 绑同一草稿文档 ID、原文条件 ID、图版本/哈希、目标 claim 和后端版本；完成时先复查实时句柄，禁止迟到结果升级现有图。UI 分开显示“受限引理已证/原题完整证明（仅符合 Task 17 时）/不支持/超时/无桌面工具链/过期”，始终展示来源与系统附加选择；**证明失败或不可用不得阻断合题设的图的确认**。已有设置开关不新建第二个偏好存储。
      **2026-10-12 完成**：`ProofAttemptIdentity` 就是那五项（草稿 id / 文档内容哈希 / 版本 / claim / 目标条件出处 + `inputHash` + 后端版本），`ProofScopeReport` 里已有的 `goalSourceId` 直接进身份。**UI 分档**按上面的表；"始终展示来源与系统附加选择"沿用既有的两栏（`data-proof-source` 与「系统替你做的选择」），新 spec 里都有读数。**"不得阻断确认"**由 `e2e/agent-proof-lifecycle.spec.ts` 第一条真证明（不可用时确认按钮可点、且真的提交成功）。**不新建第二个偏好存储**：开关仍是 `mathcanvas:next-phase-preferences` 那一个键，`next-phase-flag-entry.spec.ts` 的"只写自己那个键"照旧通过。
- [x] `npm.cmd exec vitest run -- packages/agent-core/src/proof/proofArtifact.test.ts packages/agent-core/src/proof/automaticProof.test.ts apps/web/src/agent/automaticProofStage.test.ts apps/web/src/agent/desktopProofChannel.test.ts apps/web/src/components/settings/ExperimentalFeatures.test.tsx apps/web/src/components/agent/ConfirmationPanel.test.tsx --reporter=dot`；`npm.cmd run test:e2e -- e2e/next-phase-flag-entry.spec.ts e2e/agent-proof-lifecycle.spec.ts --workers=1`。浏览器只能验“不可用但不影响作图”；**桌面真实开旗→一次 Lean→用户确认→改题/撤销**必须另留实际 UI/IPC/版本证据，不以 mock 冒充。
      **2026-10-12 完成**：计划点名的那条单测命令 **6 文件 / 92 通过**；那条 e2e 命令 **9 passed**（既有 7 + 新 2）。**桌面那一段没有做，如实记成边界**：本机没有桌面壳与 Lean 工具链，所以"真跑一次 Lean 之后改题/撤销 ⇒ 标 stale"只有单测证据（`proofAttemptStaleness` 7 条 + 草稿层 1 条），**不以 mock 冒充真跑**；它真正的验收位置是 Task 19 的桌面/发行那一节。**读数**：全量单测 **370 文件 / 4396 通过 + 1 todo / 0 失败**（125.98 s，exit 0，单独跑）；全量 e2e **237 通过**（2.6 m，0 抖动）；`typecheck` exit 0；`lint` 0 error / 13 warning。

### Task 19｜Lean 固定工具链、安全与发行

**文件**：`proof/lean4/lean-toolchain`、`lakefile.toml`、`lake-manifest.json`、`README.md`；`packages/agent-core/src/proof/lean4Toolchain.ts`、`lean4Adapter.ts`、`proofBackendReview.ts`；`apps/desktop/src-tauri/src/proof/mod.rs`、`source.rs`、`commands/proof.rs`；`scripts/proof-spike/lean4EndToEnd.test.ts`、`lean4TemplateAllowlist.test.ts`。不把 7GB+ 的展开目录提交进 Git。

- [x] **先固定现状**：比较 `lean-toolchain`、mathlib `rev = c20717ea…` 与 `lake-manifest.json`，记录 `lake env lean --version`、冷/热缓存、当前证明四类/公理白名单的实测输出。首次下载、升级 mathlib、复制缓存或改变桌面发行体积**需单独征得用户同意和许可核对**；不能因本任务默认运行 GB 级网络更新。现有工程 README 原来误称“四个工程文件”，lockfile 已在仓，文档纠为五个工程文件（另有 README）而不假称工具链随包。
      **2026-10-12 完成（只读，零下载）**：新 `scripts/proof-spike/lean4Pin.test.ts` 4 条把这份工程定义钉住（两处 rev 必须逐字相同且是 40 位 commit、URL 是 mathlib4、`lean-toolchain` 是具体版本、**README 不许说过期的话**）；README 那条**先真红**（旧文写"manifest 不进仓库""换台机器复跑不保证同一份 mathlib"）→ 改写成"依赖闭包是钉住的"并保留两条真实代价。**实测**：`lean --version` 与 `lake env lean --version` 给出同一个串 `4.35.0-rc3 / commit 470d5ce1…`；`.lake` 展开 **7.00 GB**（mathlib olean 8615 个）⇒ **本机缓存已在，没有触发任何下载/升级**（停车条件未触发；换机器的首次下载仍要单独同意）。四类/公理白名单的实测输出见下一条。
- [x] **RED**：无配置/错误版本/离线无缓存、模板里 `#eval`/任意 import/`sorry`/额外公理、进程超时/异常退出、证明内容与产物版本不符都不能升级结论。安全测试必须保持 Rust 侧的**仅模板源码、固定 argv、明确工具链路径、墙钟/输出限制**；若新需求只能靠放宽任意 Lean 源码执行，停止并另提安全设计。
      **2026-10-12 完成（复核既有判据）**：这一批的判据**在 N5b 时就建好了**，本任务只复核并留读数 —— 三份定向测试 **74 通过**：`lean4Toolchain.test.ts`（无配置/版本目录解析/垫片与直接工具链的取舍）、`lean4Adapter.test.ts`（`sorry` 拒、自定义 `axiom` 拒、报告缺失拒、报告属于别的定理拒、形状不认识拒、**exit code 单独不算数**、编译错 `failed`、墙钟超时 `timeout`）、`scripts/proof-spike/lean4TemplateAllowlist.test.ts`（**读 Rust 源文件**，模板生成的 import/定理名与桌面白名单**双向**一致）。Rust 侧 `npm run test:rust` **250 通过 / 0 失败 / 3 ignored**。**没有放宽任何一条**：本批一行安全判据都没改。**"若新需求只能靠放宽任意 Lean 源码执行就停下"这件事本批没有发生**（本任务的需求全是钉住与读数）。
- [x] 本机已有已授权工具链时，先跑 `npm.cmd exec vitest run -- packages/agent-core/src/proof/lean4Toolchain.test.ts packages/agent-core/src/proof/lean4Adapter.test.ts scripts/proof-spike/lean4TemplateAllowlist.test.ts --reporter=dot`，再**单独**跑慢集成 `npm.cmd exec vitest run -- scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=1`、`npm.cmd run proof:smoke` 与 `npm.cmd run test:rust`。打包后在干净/无网的桌面上验证“明确不可用仍能画图”和“工具链可用才有真实证明”；冷、热运行耗时/版本/哈希/许可和包体如实列出。没有真桌面发行验收，就算本机 Lean 真跑绿也不标“已发布自动证明”。
      **2026-10-12 完成（本机那一半）**：定向三份 **74 通过**；慢集成 `npm run test:lean` **8 passed / 1195.4 s**（冷启动单独量 219.5 s；四类目标各 ~62 s 全部 `formally_proved / verified / exit=0`，公理恰好三个白名单；`sorry` 那次 **exit=0 而判 `failed`**；窄 import 64.4 s vs `import Mathlib` 588.4 s）；`npm run proof:smoke` **8 通过**（十栏审查含版本/许可/进程模型/原生依赖/启动预算/超时策略/失败行为/缓存与沙箱，**强沙箱"未测"如实写着**）；`npm run test:rust` **250 通过 / 0 失败 / 3 ignored**。**打包后在干净/无网桌面的验收没有做**（本机没有打包产物与另一台干净机器）⇒ **不标"已发布自动证明"**、不主张发行可用；"明确不可用仍能画图"这一条另有浏览器证据（Task 18 的 `e2e/agent-proof-lifecycle.spec.ts` 2 passed）。

      **2026-10-14 桌面那一半的补读数**：先纠正一条过期的话 —— 工作副本里**早就有** 0.1.0→3.3.13 的 MSI（最新 2026-10-11 16:23），但它们**早于当前 HEAD**，不能当当前版本的读数；于是在当前 HEAD（工作树干净）重跑 `npm --workspace @draw/desktop run bundle` **exit 0**：cargo `release` **38.86 s**，产出 `MathCanvas_3.3.14_x64_en-US.msi` **6.71 MB**（SHA256 `77A98F52…`）、`MathCanvas_3.3.14_x64-setup.exe` **4.96 MB**（`7FF8E01E…`）、`mathcanvas-desktop.exe` **16.66 MB**（`7F5D51C7…`）；冒烟启动刚构建的 exe（不是安装包）：窗口标题 `MathCanvas`、`CloseMainWindow` ⇒ **优雅退出 code 0**。**仍未做**：干净/无网机器上的发行验收（本机没有第二台干净机器）；在本机安装 MSI/NSIS（要管理员权限、会改动这台机器 —— 未获明确同意不做）。

### Task 20｜四族真实模型质量

**文件**：apps/web/src/agent/fixtures/benchmarkPlanningEval.ts、scripts/agent-eval.mjs、packages/agent-core/src/benchmark/ 及现有评测测试。

- [ ] **真实质量验收**：四族 Task 11–16 各有端到端真图后，先离线拆出 plan/schema/构造/核验/可读性的失败分布；**在**看到付费结果前冻结每族样本、pass@1/pass@3 与人评/延迟/费用阈值并取得用户对请求数及最高费用的授权，方可运行真实 provider。一次成功、同轮修复成功与独立三次成功分别计，旧 8×3 工具环不替代真题四族结果。
      **2026-10-12 完成免授权那一半（这一项仍未勾）**：① 冻结落地 `packages/agent-core/src/benchmark/frozenThresholds.ts`（+ 7 条用例）—— 12 道题**按题号**冻住，各族阈值与 `paidRuns: 0` 一起写死；② 停止条件落成 `assertPaidRunAllowed`（未授权一律拒、点头后仍受额度约束、顺序错了也拒）；③ 离线分布用**真实** `matchLocalIntent` 逐条核对：**0/3、0/3、0/3、1/3** 会被本地回应，而唯一被回应那条拿到的是**夹具图**⇒ **12/12 仍需 provider**，五层里只有 planning 拆得出来；④ **授权请求：36 个请求、最高 $12**（12 题 × 3 次；族上限 $0.25/题、立体 $0.40/题，最坏 $10.35）；⑤ **"授权一到就能跑"已建好**（`examEvaluation.ts` + 8 条用例，零网络）：请求清单可复算、执行入口先过授权闸（未授权时一次 `runCase` 都不调用）、记账口径写死（pass@1/pass@3/同轮修复分栏、人评没标为 `null`、阈值只对照不改写、少跑一条就抛）。**剩下的就是等用户点头** —— 未点头不发请求、不跳 Task 21。**⑥ 产品侧适配器也已接**（`examRunAdapter.ts` + 4 条用例）：单次规划请求 → 试验结局的唯一映射在 core，费用由注入读数给，抛错记 `error`；**边界**：修复回路在协调器里、端口看不到 ⇒ `repairedCount` 真跑时会是 0（要么接协调器的修复标记，要么如实读成"没走协调器"）。

      **2026-10-14 第二批（免授权）**：① **修掉一条会让付费那一跑"看起来在跑"的真缺陷** —— 上一版给规划器的请求是 `{ run, userMessage } as never`，而真实的 `createModelPlanner().plan()` 头一件事就读 `request.model.context`（`modelPlanner.ts:369`）⇒ 在任何请求发出**之前**抛 `TypeError`（RED 读数：`expected [] to deeply equal [ 'p-bench' ]`，transport 一次都没被调用；结局 36 条 `error`、花费 $0，而报告只看得到 pass@1 = 0）。请求改由 `planRequestFor`（产品同一份形状）组装。② **一次试验 = 规划 + 编译**（同一个 `compilePlan`），新增 `ExamFailureLayer` 四层与唯一判定 `examTrialVerdictOf`，把计划点名的五层里**上一批没有落点的四层**补上（可读性仍归人评）：模型没给计划 ⇒ `plan`；前四层编译被拒 ⇒ `schema`；后两层 ⇒ `construct`；编译过了但核验不是 `passed` ⇒ `verify`（与产品提交闸同一条判据）。层名只看第一条错误诊断，编译器没给原因就**不编层名**。③ **`repairPath` 落成字段**（本适配器 `not-driven`，且与"同轮修复"矛盾时**抛**）⇒ `repairedCount === 0` 只意味着"这一轮没走协调器"。④ 新增 `agentRunner.planWorkspaceFor`：工作区偏好次序**收成一处**，协调器与评测共用。门禁：全量单测 **375 文件 / 4427 通过 + 1 todo / 0 失败**（44.85 s，exit 0）；全量 e2e **237 通过**（2.0 m，exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning。**仍未做**：付费实测（未授权）、修复回路接线（端口看不到协调器的修复标记）。

      **2026-10-16 用户已授权（36 请求 / 上限 $12）；花钱前的诚实性前置已补**：仓里**没有价目表** ⇒ 费用**没测到就是 `null`**（`costUsd` 全线 `number | null`；“有一次算不出，那一族与总计就是 `null`”，不拿部分和冒充；超支核对只在钱算得出来时做；`costPerCase` 阈值**如实不通过**）。两条新用例（全表无费用 ⇒ 阈值条条不通过且成功读数不受影响；混一条 ⇒ 只那一族与总计为 `null`）。门禁：全量单测 **379 文件 / 4487 通过 + 1 todo / 0 失败**（44.37 s，exit 0）、`typecheck` exit 0、`lint` 0 error / 13 warning；**全量 e2e 236/237**（唯一一条是已记过的负载敏感抖动，单独跑绿）。**仍未做**：受闸入口（桌面壳 `--exam-run` 启动模式，用户选 B）→ 零成本干跑 → 把授权值写进冻结表 → 真跑 36 次。

**停止条件**：用户未同意请求数和最高费用，或样本/阈值未预先冻结，就停在 Task 20；不能跳去 Task 21。

### Task 21｜全量验收和作图／Lean 分别裁决

**文件**：docs/current-status.md、docs/acceptance/agent-release-gate.md、docs/acceptance/agent-tool-loop-scorecard.md、README.md 等状态镜像；若改产品代码，按本任务记录真实文件。

- [ ] **发布门禁**：所涉区块 GREEN 后完整运行 `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd test -- --maxWorkers=2 --reporter=dot`（Lean 慢集成单列）及 `npm.cmd run test:e2e`；Rust/桌面桥变更另跑 Rust/打包。教师/学生读图、桌面来源/哈希、该 HEAD 的 CI 与默认开关单独留据。Task 17–19 的 Lean 证明另签门禁；**没有这些证据默认 Agent/自动 Lean 都不放行**，不能凭一题通过外推一族覆盖。

**退出**：普通作图和自动 Lean 各有独立“可放行/继续默认关”的明确判定；已有旧能力不退化，完整编译、浏览器、桌面、CI 和人评证据可复核。Lean 被安全关闭时，不能把它写成整题自动证明已交付。

## 7. 唯一的进度表（下一项 Task 14）

| Task | 状态 | 退出证据 |
| --- | --- | --- |
| 1 | **完成**（2026-10-12） | 定向 6 文件 / 120 项**改前全绿**（无旧红可归因）；四处破坏先红后绿、变异还原；新增 `legacyCompatibility.test.ts`（3 项）钉住结构化过期判据的产生处与纯中性工作区路由；`typecheck` exit 0、`lint` 0 error / 13 warning |
| 2 | **完成**（2026-10-12） | 22:36 两轮坏计划各自有脱敏夹具；"造动作名"与"顶层形状不合法"分成两句不同的话（用户话 + 修复提示各一处）；先红三处、GREEN 3 文件 / 124 通过；变异两层各自可观测 |
| 3 | **完成**（2026-10-12） | 34 个目录动作在提示词菜单与工具发布两面上逐项对齐、范围外动作不漏入；"开放的面 / 闭合实体 / 折"三分法进菜单（仅在给立体动作那轮）；协议壳同时报 `unknown_kind` 与 `unknown_field`；先红两处、GREEN 4 文件 / 134 通过、全库 358 文件 / 4216 通过 |
| 4 | **完成**（2026-10-12） | 账本合同可执行（一次往返 = 一笔 `generation`+`network`，恰好一层记）；经测试**无重复计费**、额度一行未动；预算停止不再盖掉原始错误，改为"原因 + 余量 + 用尽前最后一次真实失败"；定向 3 文件 / 101 通过 |
| 5 | **完成**（2026-10-12） | 坏输入 fail-closed：`unverified:[null]` / `obligations:[null]` 原先各抛一条 `TypeError`，现逐条查形状；`constraint-authoring` 按可到达的操作收窄为只平面（动作目录里没有一个约束类动作）；"题设要求 0" 保持旧字面、登记待裁决；定向 5 文件 / 234 通过 |
| 6 | **完成**（2026-10-12） | 新增 `figureIntent.ts` 只读映射：条款与解析结果一一对应、`span` 按 `prompt.slice` 可核验、第九条残留带位置留下、模型 relations 改不动条款清单；`objects` 只到点名层（不猜拓扑）；**§3 那句读出 6 条而非"八条"的原因已定**：§3 是**转述**（定比分点写成"E/F 在边上定比分"、没有显式比例），`figureIntent.test.ts:20` 用的就是它；用户原话在 `e2e/agent-exam-solid.spec.ts:20-24`，读出 8 条并被绿的 e2e 逐条钉住，**8 − 6 = 那两条比例** |
| 7 | **完成**（2026-10-12） | 判据层 + 接线 + **端到端实证**（模型只给一个点 ⇒ 补出四边形 ⇒ 核验 passed，落盘坐标自算 \|AB\|=8、\|CD\|=3）；**Worker 与主线程同判有读数**：同一条用例在 Worker 侧跑通，且**变异（关掉合成）两条路同时真红**；golden 一个文件未改；修掉"把所有动作都当宿主"的自锁缺陷 |
| 8 | **完成**（2026-10-12） | 新合成路径纳入"两条路等价"判据（**变异读数**：丢掉 `witnessSearch` 转发 ⇒ Worker 只 1 个图元 vs 主线程 10 个，**两边都不报错**）；迟到回包的闸**本来就在**（`geometryWorkerClient` 四项核对），但补掉一处**误诊**：回包被拒的理由原先被吞掉、`stage` 只能说"编不出动作" ⇒ 现在带 `stale_artifact` 与原文；定向 6 文件 / 55 通过 |
| 9 | **完成**（2026-10-12） | 新增 `benchmark/examSet.ts`：开发集 8 条（四家族各两条）+ 留出集 4 条（**不同原题**），每条带卷别/题号/等级/许可；两条守卫（**转载答案不能充 oracle**、**留出集不许是开发题变式**）+ 错图 oracle 会拒；`verifiedGoldCaseIds` 仍为空且被钉住；随仓题面全标 `survey-summary`（**不拿摘要冒充原题**）；接进 `npm run eval:agent`；定向 4 文件 / 35 通过 |
| 10 | **完成**（2026-10-12） | 判据收成一处（内核 `ratioParameterFor`）：部分比整体 / 部分比部分 / **方向不许乱** / 无公共端点 / 越界 / 端点重合 / 非正比值；端到端 `AE:AD=2:5` 补出 `E` 并自算 `AE/AD=2/5`；**不相容位置拒绝**（先红 `expected true to be false`，诊断点名两条来源）；补出来的点是**派生对象**（`onHost` + 无量纲参数）；**宿主移动后的重算读数**（`AE/AD` 仍 2/5，牙齿检验读到 0.9827） |
| 11 | **完成**（2026-10-12，**§4 退出条件全部满足；任务卡第二项三条子项也都清了**） | 分类矩阵有读数：无解 ⇒ `unverified_instance` + `contradictory-planar`（不是"没找到"）、欠定 ⇒ `underdetermined-planar` 并点名缺哪个点、角顶点不在环上 ⇒ 拒绝、**换点名** ⇒ 环顺序跟着题面；**面积五层接通**（解析器 `area` 义务 + IR + 内核 `planarRuleFromArea` + 核验器自算 `½|AB×AC|`）；**真画布 e2e 已建**（`e2e/agent-exam-triangle.spec.ts`，1 passed / 8.0 s）；**SSA 已解得出来**（内核 `ray-circle`：射线 ∩ 圆，最多两解）；**"只保留一份"审计 = 单份**；**"两解选择来源" = 内核那行 `assumptions`**（我加的 `alternatives` 因重复已**撤回**）；**记录的边界**：全量 e2e 未跑；**`∠A` 单字母角已于 2026-10-14 收口**（读取器留占位 + `resolveStatedVertexAngle` 按形状从句的环取邻点，落成三个点名后走既有 `planarAngle`；端到端用例自算 30° 通过） |
| 12 | **完成**（2026-10-12） | RED 建成（`foldAngle.test.ts` 6 条先全红 → 全绿，**不喂 P、不喂角**，求得唯一 `θ=90°`，并用罗德里格斯公式走**第二条独立路径**回代）；解析求解 `foldAnglesForTargetDistance` 四档结局分开（`solved`/`outside-range`/`unreachable` 报可达区间/`degenerate`）；**已接进 `compilePlan`**（错角 30° ⇒ 求出 90° 并通过核验、填对不抢、无目标距离不凭空反求），并修掉"草稿为 `null` 就退出"那个把救援挡在门外的守卫；**记录的边界**：更一般目标关系的区间搜索未做、两支角合法时另一支未披露、e2e 未做（计划原文：仍需 Task 16 的真实产品验收） |
| 13 | **完成**（2026-10-12） | **原用户那道题端到端通过**（`e2e/agent-exam-solid.spec.ts` 1 passed / 8.3 s：八条逐条进核验且 `passed` ⇒ 提交 ⇒ 自算八条 + 刚体性 + 七点齐备 ⇒ 一步撤销）；夹具只给四个坐标（E/F 由系统按定比分点构造、折叠按点名取点、折角按 `PC=4√3` 反求 ⇒ **三环全串**）；**负例齐**（缺 `C` 的面片 / 错的折角 + 缺 `C` / **手写的 `P`** ⇒ `fold_not_rigid` 挡下）；**二面角定高**（内核早就会、产品路径够不着 ⇒ 已通，45°/60° 各自量得出来）；**棱柱点名**（`vertexNames` + 按动作判 ⇒ `AB=2` 进核验；没带点名的照旧 `核验=[]`）；**底面数两半**（正五棱锥代表形状造得出；五边形底面 + 角度条件如实拒绝"不换一个题面没说的形状"）；**组合实体跨阶段点名**（第二阶段量得到第一阶段建的点）；**边界已钉**：垂足不在中心＝常态（有用例）、面上点＝无产品入口（如实拒绝）、展开＝无动作、**斜棱柱明说倾角已于 2026-10-14 收口**（`linePlaneAngle` 义务：读得出、进 `lateralTiltDegrees`、并从最终坐标量得出来；`lateralTiltSource` 区分"题面明说"与"系统代表值"） |
| 14 | **完成**（2026-10-12） | ① 先修掉一条**真缺陷**（双曲线 `axis` 在三处实现里与声明相差 90°）；② **代数**直线∩圆锥曲线（五档含**竖直线**）；③ **条件反求曲线参数**（两焦点+一点 / 焦点+准线 / 焦点+准线+离心率）；④ **`conicChord` 义务与判据** —— **"丢一交点现在真的会红"**；⑤ **`e2e/agent-exam-conic.spec.ts` 已建**（正例走完整产品路径并从落盘坐标自算两个交点 + 一步撤销；反例共用同一份计划、只改题面里的直线 ⇒ **fail-closed，不给确认面板**）。读数见任务卡；全量 **367 文件 / 4338 通过 + 1 todo / 0 失败**，全量 e2e **227 通过**（首跑一条斜棱柱用例抖动、单独跑 3/3 绿、复跑全量 227/0），`typecheck` exit 0、`lint` 0 error / 13 warning |
| 15 | **完成**（2026-10-12） | 新模块 `packages/geometry-kernel/src/function-evidence.ts`（+ 19 条用例，**先真红**）：四真题形状都有读数 —— **2021 新高考Ⅰ卷 7 题**外点双切线（`(0, 0.5)` 向 `eˣ` 两条、`(0, 1)` 临界一条且报**退化**、`(0, 2)` 如实 `none`、`(0, −1)` 唯一一条）、**2022 新高考Ⅰ卷 22 题 / 2024 新课标Ⅰ卷 7 题**多交点（`sin x = 0.5` 在 `[−5,5]` 三条、`sin = cos` 三条，判据自己解 `π/6+2kπ`、`π/4+kπ` 回代）、**2024 新课标Ⅰ卷 13 题**公切线（`y=x²` 与 `y=−(x−2)²+1` 两条，斜率 **2±√2**，测试自己算两个切点与截距回代两条曲线）。**证据分两档字段**：`grade`（`algebraic` / `verified-numeric` / `plot-only`）+ `complete`（个数能不能当个数用）。**四类反例**：**断点被连线**（题面 `(x²−1)/(x−1)` 在 `x=1` 没定义、图上画成连续的 `x+1` ⇒ **红**，旧实现只会是"未核验"）、**错切点**（`|x|` 在 `x=0` 是尖点 ⇒ 旧判据用**中心差分**得到"斜率 0"从而**放行**，现在由**单侧差商**判"左右导数 −1 / +1" ⇒ **红**；另有"切点纵坐标不在曲线上"⇒ 红）、**漏近重根**（`(x−1)²−1e-10` 由判别式解出 1±1e-5；`cos x−1+1e-12` 这种分辨不出的情形如实 `complete: false` 而**不报"零个根"**）、**参数实例≠全称**（`judgeUniversalClaim` 把全称主张一律降级成 `at-parameters` + `plot-only` + `upheld: false`）。**判据侧**：`functionGraph` 新增**断点集合必须一致**（正例 `1/x` 从"未核验"变成 `passed` 并说清断在 x=0；反例红）、`tangentAt` 新增**可导性**与**整条直线是否相切**两问；每条函数族读数带 `evidence`；报告新增 `proofScope` / `universalClaims` / `proofScopeNote`（**`universalClaims` 只有 `not-proven` 一个取值**）并由 `proofScopeOf` **唯一**产出（`draftStore` 拼旧证据那条路用同一个函数）。**产品面**：面板显示证据等级与范围；两道夹具题（`1/x` 断点、`|x|` 尖点负例）。**e2e**：新建 `e2e/agent-exam-function.spec.ts`（2 passed：断点题走完整产品路径 + 测试自己在定义域上扫 129 点自算"恰好一处无定义"；尖点题 **fail-closed**）、扩 `e2e/agent-function-tangent.spec.ts`（两个证据等级 + 范围断言）。**黄金样本有据修订一次**：报告多出的三个字段进了 `planCompiler4707b64.golden.json`，重抓前用临时探针**逐字段对读**证明"差异恰好是那三个"（4 个有报告的用例各 3 条、其余 2 个零差异）并把这条写成断言，样本的修订记录改为 `revisions` 数组（2026-10-10 那条逐字保留）。**记录的边界**：① `algebraic` 只覆盖**多项式且次数 ≤ 2**（判别式给重数结构），次数 ≥ 3 与超越函数走 `verified-numeric`；② `complete` 是**数值完备性**（两个分辨率一致 + 无落进判零带却不变号的格子），**不是**"全区间根数已证明"（单调性/介值定理的证明没做）；③ 函数与直线的**交点数**尚未有义务种类与匹配器（`diagramObligations.ts` 不在本任务文件清单里）⇒ 真题里"多交点"那一型的产品入口仍是作图 + 内核读数，未进核验面板；④ 外点双切线/公切线**没有产品动作**（`function.create_tangent` 只表达"在某 x 处"），所以它们的产品面读数在本任务里是内核 + 单测，真画布验收归 Task 16；⑤ 反例在浏览器一侧的读数是 **fail-closed**（确认面板不出现），"面板上出现一条红"由单测钉住 |
| 16 | **完成**（2026-10-12，两块：**画布证据面 + 过期判据**，再**修掉读数抓出的重复标签缺陷**） | ① 证据绑**内容哈希**（`RenderEvidence.documentHash` 必填 + `evidenceIdentityProblem` 拒非法哈希）；② 新判据 `renderEvidenceStaleness`：**看哈希不看版本号**，`document_changed`（改题/撤销）与 `draft_replaced`（切文档）分开，**带截图不改结论**（RED 5 → 22 通过）；③ 新 `apps/web/src/canvasEvidence.ts`：从**已渲染的 DOM** 量对象盒子与点名标签，诊断交给既有 `diagnoseLayout`，画布根元素挂哈希/计数/诊断码/相机看不见的点名，3D 如实标"对象量不到"且**不谎报画布为空**（RED→GREEN 7 条）；接进 2D SVG 与 3D 场景；④ 新 `e2e/agent-exam-visual-and-stale.spec.ts` **6 passed**（四族各一次"画布报的哈希 == 测试自己按 `canonicalContentHash` 口径规范化后用 `crypto.subtle` 摘要的那一份" + 撤销/改题/视图变化三向）；⑤ **本任务读数抓到并修掉一条真缺陷**：翻折题落盘 9 个 `point3`、`E`/`F` 各带一遍同名标签（折片是与边上两点坐标逐位相同的副本）⇒ 画布把同一串字母画两遍、文档里"E 是哪一点"有歧义。修法两层：`compileSolidFold` 新增 `suppressedNames`（**折痕两端在原图上已有同名点时，折片副本不再挂标签**；新顶点 `P` 照挂；原图没有同名点时一个都不抑制 —— 反方向有用例守住），RED 在 `solidFoldAction.test.ts`；渲染层不再拿**图元 id 当名字**画（3D 标注覆盖层只画有名字的点、2D `<text>` 同名规则）。修后 e2e 收紧成"七个标签、无 `label_overlap`"并仍 **6 passed**。**记录的边界**：3D 虚实线在 Three.js 内部、DOM 读不到（这一层只给相机可见性与标签）；把点名转出视锥需把相机推近到实体内部，产品入口无确定性做法（"文档有名字而画布没画"那一支在单测里钉住）；**"取消拖动"不是现有产品动作**（无 Escape 取消拖动），以"缩放 / 切工作区再切回不失效"这条读数代替；**教师/学生可读性签收未做**（属发布门禁那一侧） |
| 17 | **完成**（2026-10-12） | 新模块 `packages/agent-core/src/proof/proofScope.ts` + 8 条用例（**先真红：模块不存在**）：`ProofScopeReport` 逐条给原题条件分四档（`formalized` / `dischargedByNamedDerivation` / `figureAssumption` / `notRepresented`）+ 源 span（复用 `buildObligationIR` 的 id 与区间）+ 系统替用户做的选择；结局三档 `limited_lemma` / `whole_problem` / `unsupported`。**判据逐条有读数**：① 题面多一条必要条件（`AB=2`）⇒ 出了产物也只报**受限引理**，并列出没进命题的那条；② 由**点名定理**一步推出的题设归 `dischargedByNamedDerivation` 且写出那一步叫什么（`PLANE_PERPENDICULAR_PROPERTY_THEOREM`）；③ 前提指不出出处 ⇒ `unsupported`（连命题都不生成）；④ 面 ⊥ 面这类没有模板 ⇒ `unsupported`（读目标时就拒）；⑤ 后端没验过 ⇒ 永远不是整题（`sorry` 那一档在此被挡）；⑥ `fromFigure` 的图上前提如实标出，并说清点名**在图上有没有物化**；⑦ 整题级要"逐条条件都进命题 + 调用方显式交出完整命题产物声明 + 后端验过"，且**系统补的图上前提会挡住它**。**接进产品路径**（`automaticProof.ts`）：`AutomaticProofResult.scope` **必填**（每条返回路径都要交出"证的是哪一档"），`verified` 那次连同说明文案一起写"证的是受限引理，不是整道题"（文案经 `automaticProofStage` 的 `detail` 到面板）；范围报告建不起来时如实给 `unsupported` 而**不编**。**记录的边界**：`whole_problem` 在产品路径上**不可达**（没有完整原题命题产物 ⇒ 没有调用方交得出那份声明），这正是计划那句"不勾 whole_problem"的代码形态；"题设与图互相矛盾"这一条**没有**在范围报告里单独判（矛盾在核验器那一侧判，报告只分类条件），如实记着 |
| 18 | **完成**（2026-10-12） | **① 一次异步证明"回来时还算不算数"**（`proofArtifact.ts` 新增 `ProofAttemptIdentity` + `proofAttemptStaleness`，RED 7 条先红后绿）：判据是**草稿 id + 内容哈希 + claim + 目标条件出处 + inputHash + 后端版本**，**看哈希不看版本号**（暂存同一份内容不算过期），六档分开 —— `draft_replaced`（切工作区/导入别的文档）/ `document_changed`（**改题/改图/撤销**）/ `claim_replaced` / `condition_replaced` / `input_changed` / `backend_replaced`；**没绑内容哈希一律过期**（fail-closed）；**没捕获的那几栏不参与判定**（调用方拿不到就不许拿它当判据）。与 `verifyProofArtifact` 的分工写在注释里：那条判**命题一级**（刻意不绑文档指纹，R51/R56），这条判**这一轮/这一份图**，所以 `document_changed` 的措辞是"**这一轮的 claim 不能凭它升级**"，不是"那条命题不再成立" —— 两句话分开。**② 草稿层接上**：证明块发起前捕获身份、跑完复查；`previewOf` **每次都重新判一次**（后续 `stage` 让候选内容变了而证明块没被重写时，那一栏会翻成 `stale`，`draftStore.test.ts` 有用例真红真绿），过期时只改结局与理由、**不抹掉产物**。**③ 界面分档**（`ConfirmationPanel`）：标题按范围报告写"**受限引理已证（不是整道题）**"/"原题完整证明"/"过期（这份结果说的是另一张图）"，并列出**没进命题的题面条件**与过期原因；`data-proof-scope` / `data-proof-stale` 供读数。**④ e2e**：新 `e2e/agent-proof-lifecycle.spec.ts` **2 passed** —— 浏览器里没有桌面工具链 ⇒ 那一段如实说"没跑成"、范围报告列出 `BC ∥ AD` 这类没进命题的条件、**确认按钮可用且真的提交成功**；开关关着 ⇒ 那一段根本不存在、同样提交得掉（为此新增夹具题面 `PROOF_GOAL_PROMPT`：同一只四棱锥 + 一句可形式化的目标；**实测踩到** `localPlanner.isAnalysisQuestion` 认"求"字 ⇒ 题面里必须留作图动词，否则本地规划器不认这条意图）。**边界（如实记）**：**桌面真实开旗 → 一次 Lean → 改题/撤销 ⇒ 标 `stale`** 的 UI/IPC/版本证据**没有做**（本机没有桌面 + 工具链），它的判据在单测里钉住，**不拿 mock 冒充真跑**；设置入口与"只写自己那个键"沿用既有证据（`next-phase-flag-entry.spec.ts` 7 passed）。 |
| 19 | **完成（本机那一半；真桌面发行验收仍未做，见下）**（2026-10-12） | **① 先固定现状（只读，零下载）**：`proof/lean4/` 的工程定义**逐条钉住**（新 `scripts/proof-spike/lean4Pin.test.ts` 4 条：`lakefile.toml` 的 mathlib rev == `lake-manifest.json` 的 `rev` == `inputRev`，且必须是 **40 位 commit** 而不是 `master`；URL 是 mathlib4；`lean-toolchain` 是具体版本而不是 latest；**README 必须写出当前钉住的 commit、且不许再说过期的话** —— 最后这条**先真红**：旧 README 还写着"manifest 不进仓库""换台机器复跑不保证同一份 mathlib"，与 2026-10-10 已钉住的事实矛盾；已改写成"依赖闭包是钉住的"，并保留两条真实代价：首次要下 GB 级东西、工具链不随包）。**实测读数（只读）**：`lean --version`（直接工具链）= `Lean (version 4.35.0-rc3, …, commit 470d5ce1400764999581fd26d5d72b00d990b0f4, Release)`，`lake env lean --version` 在 `proof/lean4` 里给出**同一个**串（说明 `lean-toolchain` 确实解析到那份工具链）；`~/.elan/toolchains/` 下 v4.34.1 与 v4.35.0-rc3 都在；`.lake` 展开 **7.00 GB**（mathlib olean **8615** 个，`Mathlib.olean` 在位）⇒ **本机缓存已在，本批没有触发任何下载/升级**（**停车条件未触发**；换机器时的首次下载仍需单独同意）。**② 安全判据复核（既有，本批全绿）**：三份定向测试 **74 通过**（`lean4Toolchain` / `lean4Adapter` / `lean4TemplateAllowlist`）—— `sorry` 拒、用户自定义 `axiom` 拒、报告缺失拒、报告属于别的定理拒、报告形状不认识拒、**exit code 单独不算数**、编译错 `failed`、进程级墙钟超时 `timeout`，以及"模板生成的 import/定理名 ↔ Rust 白名单"双向一致；Rust 侧 `npm run test:rust` **250 通过 / 0 失败 / 3 ignored**（17 个套件：能力集最小、只暴露具名 IPC、无通用命令、CSP、密钥无明文出口…）。**③ 真后端实测**：`npm run proof:smoke` **8 通过**（打出十栏后端审查：许可证读自工具链目录、`child-process` 进程模型、原生依赖清单、启动预算、两层超时策略、`sorry`/自定义 axiom 的失败行为、缓存与沙箱——**强沙箱下证明运行"未测"如实写着**）；`npm run test:lean` **8 passed / 1195.4 s**：冷启动单独量 **219.5 s**，四类目标各 ~62 s 全部 `formally_proved / verified / exit=0` 且公理恰好 `["propext","Classical.choice","Quot.sound"]`，`sorry` 那次 **exit=0 而判 `failed`**（真实后端上再证一次"退出码不算数"），窄 import **64.4 s** vs `import Mathlib` **588.4 s**（成本纪律有读数）。**未做（如实记）**：**打包后在干净/无网的桌面上的验收** —— 本机没有打包产物、也没有另一台干净机器，所以本任务**只主张"本机真跑绿 + 判据齐 + 工程定义钉住"**，**不主张"已发布/已发行"**（计划那句"没有真桌面发行验收，就算本机 Lean 真跑绿也不标已发布自动证明"照办）。 |
| 20 | **进行中（免授权部分已完成；付费那一步停在授权门口）**（2026-10-12） | **① 事先冻结（计划写死的先决条件）**：新 `packages/agent-core/src/benchmark/frozenThresholds.ts` + 同名测试（7 条）把四族的**样本按题号**（开发集 8 + 留出集 4，逐题带 `offlineAttemptability`）与 **pass@1 / pass@3 / 人评 unreadable 上限 / 延迟上限 / 单题费用上限**冻住，并记 `frozenOn: 2026-10-12`、`paidRuns: 0`（"事先冻结"这件事可证：跑过付费观测之后再谈冻结就拒）。**② 停止条件落成函数**：`assertPaidRunAllowed` 四道门 —— 先冻结（`paidRuns === 0`）、**先授权**（`authorization.status === "granted"`）、额度写清（`maxRequests`/`maxCostUsd` 正数 + `grantedBy` 有人）、这次请求不许超；**默认 `pending` ⇒ 一个请求都不发**（用例先红后绿，含"点头之后仍受额度约束""缺一栏照样拒"）。**③ 离线失败分布（不发任何请求）**：新 `apps/web/src/agent/fixtures/frozenThresholds.local.test.ts` 拿**真实的** `matchLocalIntent` 逐条核对 12 道真题题面 —— 实测 **triangle 0/3、conic 0/3、function 0/3、solid 1/3** 会被本地规划器**回应**，而唯一被回应的那一条（2023 新课标Ⅰ卷 18：`正四棱柱中多条棱上的点构成的空间关系。`）拿到的是**夹具那只正棱柱**、不是这道题（该用例自己的 `requiredFigure` 恰好写着"不能用假定立方体遮蔽原题条件"）⇒ **12/12 都仍需真实 provider 判定**；计划点名的五层里只有 planning 层拆得出来，其余四层"无从谈起"（**不是通过**）。**④ 授权请求（等用户点头）**：**36 个请求**（12 题 × 3 次独立试验）、**最高费用 $12**（族上限：三角/圆锥/函数 $0.25/题、立体 $0.40/题 ⇒ 最坏 $10.35，留余量）。**⑤ "授权一到就能跑"已经建好**（新 `packages/agent-core/src/benchmark/examEvaluation.ts` + 8 条用例，**一个网络请求都没有**）：`examRequestPlan` 打出请求清单（实测 `{"cases":12,"trialsPerCase":3,"requests":36,"worstCaseCostUsd":10.35,…}`）；`runExamEvaluation` **第一件事就是 `assertPaidRunAllowed`**（未授权时 `runCase` **一次都不被调用**，用例先红后绿），跑完再核对实际费用是否超授权上限；`summarizeExamEvaluation` 把记账口径写死 —— **pass@1 = 第一次就成**、**pass@3 = 三次独立里至少一次成**、**同轮修复成功单独一栏**、**人评没标就是 `null`**（不许当可读）、**阈值只对照不改写**（用例断言冻结表逐字不变）、**少跑一条或缺一个试次就抛**（不是"按有的算"）。**⑥ 产品侧适配器已接**（新 `apps/web/src/agent/fixtures/examRunAdapter.ts` + 4 条用例，零网络）：`createExamRunCase` 调一次产品侧规划器端口（`createModelPlanner()`）并把结果映射成试验结局 —— 结局映射的**唯一一处**在 core（`examTrialOutcomeOf`：计划 / 问路 / 回了一段解释 / 抛错各自一档）；**费用由注入的 `costOf` 给**（这一层不编价格）；**抛错记 `error` 并把原文带上**（不吞成"没跑"）。**如实记的边界**：修复发生在协调器的编译回路里、端口这一层看不到 ⇒ 这条适配器一律 `repaired: false`，所以真跑时 `repairedCount` 会是 0；要么把协调器的修复标记接进来，要么在报告里读成"这一轮没走协调器"。**⑦ 2026-10-14 第二批（免授权）**：修掉一条**会让付费那一跑"看起来在跑"的真缺陷**（请求只有 `{run, userMessage}` ⇒ 真实 `createModelPlanner` 在发请求前抛 `TypeError`；RED 实测 transport 调用 **0** 次），并把一次试验从"单次规划请求"改成**规划 + 编译**：新增 `ExamFailureLayer`（plan / schema / construct / verify）与唯一判定 `examTrialVerdictOf`、观测 `failureLayer`、报告 `failureLayers` 与 `repairPath`（`not-driven`，与"同轮修复"矛盾则抛）；工作区偏好次序抽成 `agentRunner.planWorkspaceFor` 供协调器与评测共用。门禁：全量单测 375 文件 / **4427 通过** + 1 todo / 0 失败（44.85 s，exit 0）、全量 e2e **237 通过**（2.0 m）、`typecheck` exit 0、`lint` 0 error / 13 warning。**未做**：真实 provider 的 pass@1/pass@3/人评/延迟/费用读数 —— **未获授权前不跑、也不跳到 Task 21**。 |
| 21 | 待做 | 尚无此任务的 RED→GREEN 与适用产品/兼容验收 |

**记录纪律**：只有 Task n 的业务 RED、最小 GREEN、受影响旧路径与实际产品门禁都记录完，才将第 n 行改为完成并启动 Task n+1。历史定向 Lean 单测 7 文件/88 项通过、文档门禁 4 文件/12 项通过是既有基线，不替 Task 17–19 的原题证明/真 Lean/桌面发行。若 Task 19 只验明安全不可用，它的证明状态仍是“默认关”，Task 21 不得据此宣布自动证明已发布。每次将日期/HEAD/命令/错误数写回 docs/current-status.md，其他进度文件只同步唯一指针。


## 2026-10-16 功能补完区块 A（Task 18）

实际补完异步证明生命周期：私有暂存 + 发布 CAS，失效/取代后不返回成功；原题与规范化题面分别绑定，保存真实形式输入哈希与后端版本。新增 5 个生命周期合同用例（含独立 review 发现的规范化碰撞，确认 RED 后 GREEN）。相关回归 4 文件 / 50 通过；全仓 typecheck exit 0；lint 0 error / 13 既有 warning。详细执行及边界见 `docs/superpowers/plans/2026-10-16-functional-completion.md`。**本区块功能修复已验，不外推真实 Lean/桌面发行已验，Task 20/21 仍未完成**。下一块 B：评测门禁。


## 2026-10-16 功能补完区块 B（Task 20 评测门禁）

实际修复并验证评测入口：固定工作量为 12 题 × 3 次 = 36，声明不一致在 provider 调用前拒绝；授权请求数/费用与本次预估费用拒绝 NaN、负数和非整数；人评未完整覆盖时 readability 指标为 null 且不通过；真实调用通过共享预算计数重试，超授权立即拒绝。评测合同测试 20/20、冻结授权与评测合计 28/28 通过；全仓 typecheck exit 0；lint 0 error / 13 既有 warning。此区块只验门禁，不冒充真实 provider、人评或桌面发行验收。详细执行见 `docs/superpowers/plans/2026-10-16-functional-completion.md`。

## 2026-10-16 功能补完 C1（Task 9：oracle 完整性）

已复现并修复：缺一条或全部实测读数时误判通过。现在按 oracle 条件名一一配对，缺失/重复/多余读数均拒绝；空 oracle 不能成为金标；无限数、非法容差及非实测状态不能通过。缺失项用明确的 missing 记录，不伪造测量值。新增 9 条边界测试，定向 20/20 通过；全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。

边界：此区块只补离线判据，不新增未经独立人工复核的真题答案，verifiedGoldCaseIds 仍为空。Task 16 仍在检查实际消费接线，区块 C 尚未整体验收。


### C2｜Task 16 真实画布证据消费（2026-10-16）
- 根因：旧实现只保存属性字符串；内容更新到下一次测量之间，旧读数仍会挂在新画布上。过期判据只在测试使用。
- 修复：2D/3D 保存真实测量快照，发布属性前用当前工作区与文档哈希消费证据。旧快照返回 stale，不发布旧盒子/标签/哈希读数；同哈希只换快照版本不误报。尚无实时文档绑定的读数为 unbound，不算通过。
- 区分结论：passed / partial / failed / stale / pending；3D WebGL 对象不可测只能 partial，即使 diagnostics 为空也不能 accepted；点名缺失判 failed；不能由调用方把不可测快照升级为可测。
- 验证：新增 5 条先红后绿；4 文件 55 条单测通过；真实浏览器 6/6（28.9 s），验证 2D accepted=true、3D partial/accepted=false、撤销后 failed/empty_canvas。首次 e2e 暴露旧选择器不能读取 stale 过渡态，改为稳定状态属性，并等待新测量再验空画布。
- 全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。
- 边界：这是提交后真实画布的证据消费，不是确认前候选图渲染，也不等于 HostBridge 在提交前已验证视觉。候选图视觉门禁、桌面画布与人工可读性仍未验收；Task 16 不据此升级为全部完成。数学条件仍由独立核验器判断。

## 2026-10-16 功能闭环增量：Task 13 面上点与 `solid.unfold`

本区块按真实运行链路验收，不以类型定义或文档存在作为完成依据。

- **面上点**：`dynamic.create_face_point` 已接通 `parseDraftAction → compileAction → commitPatch → resolveBoundPoint3`。测试覆盖面内坐标、跨文档引用、参数驱动更新、退化面与越界坐标拒绝；点以真实 `point3` 和 `onFace` binding 持久化。
- **多面体展开**：新增 `solid.unfold`，输入目标实体引用与 `[0,1]` 展开进度；编译为 `updatePrimitive`，由 `commitPatch` 写入文档的 `polyhedron3.unfoldProgress`。非多面体、越界/非有限进度、跨文档目标均拒绝。
- **渲染消费**：渲染器优先读取每个 `polyhedron3` 自身持久化的进度，未设置时才回退到 UI 全局进度；实体可独立展开。渲染测试通过 `sceneShell.dataset.unfoldObjects` 观察持久化值和 fallback 值。
- **新鲜证据**：定向测试 **6 个文件 / 28 个测试全部通过**；4 个相关 TypeScript 项目检查全部 exit 0；`npm run lint` exit 0（0 error，13 条既有 warning）。这是自动化闭环证据，不是人工视觉签收。
- **边界**：展开仅支持已有 `polyhedron3`，不声称任意曲面展开或自动选择展开树；Task 15、16、18、19、20、21 不因此升级。
- **提交**：功能提交 `4e0354a` 已推送到 `origin/main`。保留未提交的审查探针和桌面 Cargo 改动；本报告作为四份进度文档之一随区块提交。

## 2026-10-16 功能补完区块 D2（Task 15 函数公切线）

Task 15 的公切线缺口已在支持范围内补齐：新增 `function.create_tangent` 的 common anchor，接通 parse → compile → commit → recompute；题面 `commonTangent` obligation 接入独立验证。当前只收两条显式 `function` 图元和 branch 0/1，验证为实例级 `verified-numeric`，不外推形式证明。

验证：7 个定向文件 / 138 个测试通过；geometry-kernel、scene-graph、agent-core、dsl typecheck 均 exit 0；lint 0 error / 13 既有 warning；diff 检查通过。仍未覆盖非函数曲线、真实 provider、人工验收和完整桌面发行。

本区块代码与四份进度文档应独立提交并推送；提交号在推送后回填。

## 2026-10-16 功能补完区块 E1（Task 19 实时输出上限）

修复证明 runner 的真实资源问题：`wait_with_output()` 改为 stdout/stderr 并行流式读取，尾部缓冲固定为 4000 字节；超时杀进程并回收后不返回半成品。新增 2 条 Rust 回归；`cargo check --lib` exit 0，`cargo test --lib proof` 2/2 通过。

仅完成实时输出内存上限这一项；OS 隔离、真实 Lean 慢集成、桌面发行/安装验收仍未完成。

# Agent 发布前门禁

计划条目：`docs/superpowers/plans/2026-09-28-agent-tool-loop-implementation-plan.md` 的 **Task 6.3**
本文件是门禁的**当前读数**；机器判据在 `packages/agent-core/src/agentReleaseGate.test.ts`。

> **这份文件回答的问题是"能不能放行"，不是"做到哪一步了"。**
> 做到哪一步看 [`docs/current-status.md`](../current-status.md)（**N1–N6 的现状在这里**）与 [`docs/research/2026-09-28-agent-tool-loop-progress.md`](../research/2026-09-28-agent-tool-loop-progress.md) —— **后者只覆盖上一版"六阶段清单"以及它 2026-10-04 追加的那段 N1–N6 路线图，其余内容截至 2026-09-29**（它是快照，不是现况）。

## 2026-10-04 立体示意图升级补充

`b1ee3d3` 增加了支持题型的题设逐条核验和 fail-closed 确认路径；文档路线已在 `9fb64e0` 同步，本次审查在 `666d651` 修正。它改善了“错误候选图静默通过”的风险，但**没有满足真实 provider 评测门槛**，也没有把静态实例升级成形式证明。

下一轮要新增两条单独门槛：

- **Witness coverage**：受支持题型中，题设可追溯、候选可分类为 verified_instance / unverified_instance / no_witness；不允许空报告成功。
- **Real-provider baseline**：至少一组真实 provider 的 pass@1/pass@3、成本、延迟和人工可读性记录。

## 一句话结论

**还没到放行条件。** 五条门禁里**四条已达成**（其中三条由测试自动守住），
只有**一条**卡住：第 2 条**没有真实 provider 数据**，因此"预先约定阈值"无基线可比。
计划的最终阶段门槛原文是"只有所有门禁通过，才允许把 typed tool loop 设为默认运行路径"——
所以现在**不设**。

> **（2026-10-06 更新：上面这句"只有第 2 条卡住、因为**没有**真实 provider 数据"已过期）**
> 第 2 条**现在有数据了**（**只有成本仍无**），而形式证明那一条从"没有后端"变成"**接了一个后端、覆盖一类目标**"：
> - **题集 planning 轴：跑了三次**（用户在其桌面端运行、控制器未旁观）—— 前两次 `planned 2/3`（按今天的词表读作
>   `planned 2/3` + `clarification 1/3`），第三次 `planned 1/3 / clarification 1/3 / rejected 0/3 / **error 1/3**`、
>   `average latency 18153 ms`（那次 `error` 是**模型响应超过 1 MiB 上限**，如实报错而不是记成被拒）；
> - **agent 工具环 pass@1 轴：跑了一次** —— `pass@1 1/8` / `pass@3 2/8` / 工具选择 45/45 / 工具错误 4/45 / `attempts 24`；
> - **人工可读性：第一次有标注**（2026-10-06）—— `plan` 与 `clarification` 各 1 条、**都判 `unreadable`**
>   （**每组 n=1**：这是"这一次那两条读不懂"，**不是趋势**，也不是 21 条题集的结论）；
> - **形式证明**：接上了 `lean4`（十栏准入记录在案），**一类短目标**（`perpendicular`）的**一般命题**真的升到 `formally_proved`，
>   而同一命题换 `sorry` 停 `verified_instance` ⇒ "实例 / 采样 / 证明严格分级"**不再平凡成立**；
>   但**产品里仍没有入口、也没有产物通道**，且**只覆盖一类目标** ⇒ 门槛只判到"部分达成"。
> ⇒ **仍然不设**（typed tool loop 不作默认路径），但**理由换了**：不再是"没有数据"，而是
> ① **成本没有数字**（仓里没有价目表）；② 三条轴都是**小样本 / 空画布条件**（n=3 的子集、pass@1 是另一套 8 题），
> 不足以"预先约定阈值"；③ **形式证明只覆盖一类目标、且对用户不可用**。

> **第 2 条在 2026-10-05 有了路径、并且已经有了一半数字**（**2026-10-05 更正**：这一节原来写"但还没有数字"，
> 那句在当天就不再成立）。两件事**必须分开读**：
>
> 1. **题集 `planning` 轴**（设置 → 真实 provider 评测 → **题集 planning**）：**已经跑过两次**（用户在自己的桌面端跑的），
>    面板原文 `planned 2/3` / `rejected 1/3` / `error 0/3` / `not measured 0/3`、`average latency 13445 ms`（第一次）/ `8465 ms`（第二次）、
>    `cost not measured`、provider `deepseek-v4-flash`。**按现在的词表**那 1 条 `rejected` 其实是 **`clarification`**（模型在问、不是失败）。
>    **边界**：只有 3 条题（n=3）、而且是**空画布条件**下的规划请求 ⇒ 不是"模型规划能力"，也不是全题集结论。
> 2. **agent 工具环的 pass@1 轴**（同一面板上面那块，8 题 × 3 轮 = **24 次请求**）：**没有任何数字，而且原因不是"没跑"** ——
>    那条通道把请求写成 `{ userMessage } as never`，对真实 `createModelPlanner` **在发出任何请求之前**就抛
>    `TypeError: Cannot read properties of undefined (reading 'context')`（复核员用探针独立复现：`runModelCalls=0`），
>    面板还会永远停在"正在跑…"。**它从来没有真正工作过**；**2026-10-05 已修**（提交 `90eba6e`：请求形状收成
>    `@draw/agent-core` 的 `buildPlanRequest` 一处，与生产路径同构）。
>    **修好之后它真的会花钱**（24 次请求，两段式、点两下才发），**修好之后已经跑过一轮**（2026-10-05 第三次真实运行，用户运行、控制器未旁观：`pass@1 1/8` / `pass@3 2/8` / 工具选择 45/45 / 工具错误 4/45 / `attempts 24`）⇒ **这一栏已有读数**；仍然如实写 `not measured` 的只剩**成本**那一段（没有价目表）。
>
> **成本那一栏与上面无关，它永远需要一张价目表**：仓里没有 ⇒ `average cost` 写 `not measured`，不许编。

> **还有一处门槛今天"无法判定"，而且它不是缺工作，是缺决定**（详见下面一节）：
> ~~**N5 的证明出口**卡在**没有任何后端接入**（接之前要先交一份通过的审查记录）~~ **（2026-10-06：已接上 `lean4` —— 十栏准入记录 + 一个目标类的最小闭环；逐条更正见下面「N5 形式证明出口」那一节）**。
> ~~**N3 的浏览器验收**~~ **（2026-10-05 已补齐：入口 = 设置 → 实验性功能 → 约束拖动；浏览器正/反例见
> `e2e/agent-constrained-drag.spec.ts` —— 关着时同样的拖动改变 |AB|、打开后 |AB| 仍是 1）**。
> **"无法判定"与"已达成"是两件事** —— N5 那一条**到 2026-10-06 才可判定**，而且只判到**一类目标**（`perpendicular` 可达；共线 / 共面 / 勾股在解析层表达不出来）⇒ **仍然不许读成绿**。

## 逐条状态

| # | 计划原文 | 状态 | 判据 / 证据 |
| --- | --- | --- | --- |
| 1 | 类型检查、Agent 核心测试、Web Agent 测试、Rust provider 测试必须通过 | ✅ **已守住**（两条抖动都已修，且都有前后计数） | 读数在 `docs/current-status.md` §一「2026-10-05 N6 门禁复跑」与其后三节：单测 **303 文件 / 3529 通过 + 1 todo / 0 失败**、`typecheck` exit 0、`lint` 0 error / 13 warning。**e2e**：原来 6 次全量里 4 次红在同一条断言（`data-preview-hovering`），已修（`projectWorldPoint` 先等相机停稳）→ **修后连续 4 次全量 186 passed**。**`test:rust`**：原来五次里一次红（`tests/secrets.rs:149`），判别实验把范围缩到"并发"（默认并行 15 次红 1 次 / 单线程 20 次全绿）→ 5 处走真实凭据库的用例加锁 → **60 次并行全绿 + 3 次全量 236 通过 / 0 失败**。**两处修的都是测试侧**，产品行为未变。 |
| 2 | 代表任务 pass@1 和语义验证率达到预先约定阈值 | ❌ **有读数，但未达阈值（阈值本身也从未预先约定）** | 离线读数由 `npm run eval:agent` 打印：**pass@1 4/8、pass@3 4/8、工具选择 45/45、工具错误率 3/45**（**2026-10-05 更正**：这一格原来还写"**语义验证 4/8**" —— 那是**报告里 `semantic verify` 那一行，而它打的就是 `pass@1` 本身**（同一个 `percent(scorecard.passAt1)` 打印了两遍）。它不是第二个指标：`AgentEvalScorecard` 里没有独立的语义验证字段。**那一行已删除**（留白比留一个错的数诚实），而"**语义验证率**"这个被本条点名的指标**今天仍然没有被实现** —— 判据在仓里（`verification/taskVerification.ts` 的任务级语义验证器 + 记分卡给它的定义），要做就得真的去算它），模式是 `deterministic_local`。~~**真实 provider 的 pass@1 仍未测过**~~（**2026-10-06 更正**：**这一句已过期** —— pass@1 轴跑过一轮、`1/8`，见本节末与 §一；**2026-10-05 更正**：写它时仍成立，但**原因变了** —— 不是"还没跑"，而是**那条通道以前跑不了**：请求形状对真实规划器不成立，复核员用探针复现过 `TypeError … reading 'context'`、`runModelCalls=0`；**已在 `90eba6e` 修好**，而**修好之后还没人跑过**（**2026-10-06：已过期** —— 修好之后跑过一轮，`pass@1 1/8`）），所以"预先约定阈值"没有可对照的基线。**但路径已存在（2026-10-05）**：应用内「设置 → 真实 provider 评测」跑 `runProviderAgentEval`（同一套 8 题 × 3 轮 → `createModelPlanner` → 回环代理，**密钥不出凭据库**），**两段式**、**会花钱**、由人显式确认；跑之前那几栏如实写 `not measured`（含 `provider` 与 `average cost` —— 成本需要价目表，仓里没有）。**（2026-10-06 更正：这一格已经不是「无数据」）** 应用内两条真实通道都跑过了 —— 题集 `planning` 轴**三轮**（`planned 2/3`、`planned 2/3`、`planned 1/3` + `clarification 1/3` + `error 1/3`）、agent 工具环 pass@1 轴**一轮**（`pass@1 1/8` / `pass@3 2/8` / 工具选择 45/45 / 工具错误 4/45 / `attempts 24`），读数与口径逐条在 `docs/current-status.md` §一。**为什么这一格仍不判通过**：都是**小样本**（planning n=3；工具环 8 题、只跑了一轮），而且「**预先约定阈值**」这件事**从未发生** ⇒ 没有可对照的基线，**也绝不能把 `1/8` 追认成「达到阈值」**。 |
| 3 | 不允许出现模型可见但 dispatcher 未实现的工具 | ✅ 已守住（测试） | `agentReleaseGate.test.ts`：模型面发布的**每一个只读工具**都必须有真实执行路径；模型面上**唯一**的非只读工具是 `plan.set_plan`（精确集合，多一个就红）；`draft.confirm_commit` / `draft.stage_actions` / `draft.discard` / `draft.verify` **一个都不许**出现在模型面上 |
| 4 | 不允许出现未验证却声称完成的运行记录 | ✅ 已守住（测试） | `agentReleaseGate.test.ts` + `verification/completionGate.ts`：声明了验收条件的运行，报告不构成证据时**不得到达 `awaiting_confirmation`** |
| 5 | 视觉能力不可用时，必须有本地布局验证结果或明确 `not_supported` | ✅ **满足（按原文口径）** | 原文是"**或**"：有本地布局验证结果**或**明确 `not_supported`，两者都不缺。本地布局判据是纯算术、不需 provider vision（`renderEvidence.ts` + `layoutModel.ts`），`visual-fit-drawn` 正是用它拿到的 `clipped_object 0 / label_overlap 0`；provider vision 不可用的路径一律回 `not_supported`（`screenshotForProvider`）。**但仍要如实说明这不是"全都接好了"**：`render.capture` / `render.inspect_layout` 尚未成为 dispatcher handler，**对象出界**那一半用的是候选文档的确定性正投影、不是 live 场景的包围盒（live 场景目前没有任何读数通道暴露给 agent） |

## 第 2 条为什么不能靠"定一个阈值"糊过去

阈值必须有**可对照的基线**，而基线只能来自真实 provider 的读数。拿
`deterministic_local` 的 4/8 当基线是错的：那个模式跑的是本地确定性规划器，
**它的分数与模型能力无关**（计划的记分卡原文：`must not be presented as real-model accuracy`）。
给一个假基线定阈值，等于让"达到阈值"变成一句永远成立的话。

**要补的是数据，不是配置。** 需要一份真实 provider 的 pass@1 / pass@3 / 成本 / 延迟读数。

## 第 5 条还缺什么（不需要 provider）

"纯本地布局判据"已经在，缺的是把**真实渲染的盒子**喂给它：

- `render.capture` / `render.inspect_layout` 的 dispatcher handler；
- 从 live 场景算包围盒（`layoutModel.ts` 目前用确定性正投影，
  限界写在 `LAYOUT_MODEL_LIMITATIONS`：不读真实相机、标签盒子是估算、读不出位置的图元被跳过）。

这两件都**不需要 provider vision**，是第 5 条真正剩下的工作。

## 下一阶段新增门槛（设计中）

在启用通用求解、动态拖动或形式证明之前，新增以下门槛：

| 能力 | 必须有的证据 |
| --- | --- |
| 约束/非线性求解 | solver status、残差、自由度、失败约束、超时与可复现 seed |
| 动态拖动 | 真实浏览器中保持约束、拒绝过约束、一步撤销和恢复路径 |
| 开放题理解 | 抽取率、judgeability、求解率与人工审查分开统计 |
| 形式证明 | 可独立校验的 proof artifact；实例或采样不得冒充证明 |
| 真实 provider | pass@1/pass@3、成本、延迟和人工可读性 baseline |

### 2026-10-05 更新：其中一条已有部分证据（N2）

`witnessSearch`（默认**关**）已经能对**题面点名 + 关系、没有坐标**的题面生成一组见证坐标，并且：

- **有** solver 状态区分（`model` / `unsat` / `unknown` / `timeout`；`diverged` 与 `not_run` 在本批的构造下**结构性不可达**，代码里写明理由）、残差、可复现 seed、候选上限与超时预算；
- **有**"生成物必须回到同一个 verifier"的可执行证据（只有 `passed` 才可能是 `verified_instance`）；
- **有**"关闭开关时与基线逐字节相同"的 golden 钉（golden 由 BASE 实现本身跑出，6 输入 × 2 种生产形状）。

**但这一条门槛仍未达成**，缺的是：① **自由度**目前恒为 `null`（`ConstraintType` 表达不了线⊥面与角度；窄豁免，归 N3）；② 只有**一次运行**的后端可行性实测，**没有接入产品**，也没有真实题集上的成功率；③ **浏览器端**的救援路径端到端未验收（归 N4）。**不要把 N2 读成"求解门槛已过"。**

### 2026-10-05 更新：N3（动态拖动）与 N4（开放题）各自到了哪一步

**N3 动态拖动：从"design only"变成"内核与接线都有，但开关关着、验收未做"。**

- **已有的**：内核的点投影（`constraints3dProjection.ts`）、拖动层的**自由度与冗余诊断**、**可证的矛盾**判据（同一条线段两个不同长度；点既在线上又在面上而两者平行且不相交）、以及 `apps/web/src/constrainedDrag3.ts` + `App.tsx` 的 3D `onDragEnd` 接线。提交走**一次** `applyBatch`，所以一步撤销是白拿的。
- **没有的（按门槛原文逐条对）**：门槛要"**真实浏览器**中保持约束、拒绝过约束、一步撤销和恢复路径" ——
  - **保持约束**：只有**单元**证据（`constrainedDrag3.test.ts` 11 条），**没有浏览器用例**；
  - **拒绝过约束**：有（矛盾与"改不动"两条路径都有用例），但同样只在单元层；
  - **一步撤销**：**已补上用例**（`apps/web/src/constrainedDragUndo.test.ts`，用**真的** `useSceneStore`）：拖动真的改了坐标 → 整批只占**一步**历史 → 撤销一次回到原状；另一条钉住"被约束完全抵消的拖动（`noop`）一步历史都不占"。**注意范围**：它钉的是**规划器给出的一批** + store 的批/撤销语义，**`App.tsx` 那个调用点仍然没有被测**（要渲染 App 才碰得到，属于浏览器那一档）；
  - **恢复路径**：未做。
  - **并且**：`constrainedDrag` 开关**默认关**（关着时走原来的 `translatePrimitive3`）。**2026-10-05 起有产品入口**（设置 → 实验性功能 → 约束拖动，偏好存 `mathcanvas:next-phase-preferences`，且**只有这一个开关**能被偏好打开）—— 于是浏览器正/反例**可以写了**；**入口本身已经有浏览器验收**（`e2e/next-phase-flag-entry.spec.ts` 3 条，全量 e2e 189 通过）。**拖动行为那一半也补上了**（`e2e/agent-constrained-drag.spec.ts`，正/反例 2 条）：`fixedDistance` 约束下，**关着**时同样的拖动让 \|AB\| 变化、**打开后** \|AB\| **仍是 1**，并且正例里**先断言 A 真的动过**（不许用"没变"冒充"被约束住"）。**定向变异**：把 `enabled` 写死 `false` ⇒ 正例红（实测 \|AB\|=1.539）。所以 N3 计划 RED 里"浏览器正/反例"这一半**现在算完成**；全量 e2e 191 通过。这一条是 N3 验收的**唯一**障碍，需要产品决定（不是技术问题）。

**N4 开放题理解：有"载体"与两个覆盖率读数，**还没有任何真实读数**。**

- **已有的**：题集 schema + 校验器、凭据检查、运行记录与报告契约（**现在分 `extraction` / `witness` / `planning` 三层** —— `planning` 是 N4b 新增的，记的是"模型给的计划有没有被 `compilePlan` 接受"；CLI 那一路仍然只发前两层，所以下面那几条读数逐字未变）、
  **七类 × 3 条 = 21 条**题集、**每题最多 3 轮**的上限校验、**题设覆盖率**口径、`runner.mjs` + `npm run bench:agent`。
- **实测（抽取层，`deterministic_local`）**：`BENCHMARK_COVERAGE cases=21 covered=14 empty=7 error=0`；
  `BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727`（题设覆盖率 **72.7%**）。
  **读数不可比**：`covered` 从 `5/7` 到 `14/21` 是**题集换了**（新加的三类刻意偏难），只记录、不比较。
- **没有的**：门槛要"抽取率、judgeability、求解率与人工审查分开统计" —— 现在有抽取层的**题级覆盖**
  （`covered`）与**题设级覆盖**（premise rate），但 **judgeability / 人工审查两样仍然没有** —— **求解率第 48 轮补上了**（`BENCHMARK_WITNESS verified=1 unverified=20 no_witness=0 solveRate=0.048`，见证层与救援路径共用同一个离线入口）。**第 51 轮把那个 4.8% 解释开了**：判据**不是**瓶颈（`BENCHMARK_JUDGEABILITY supported=21 unsupported=3` —— 24 条题设里 21 条本来就判得了），卡住的是**构造阶段**，原因码 `BENCHMARK_WITNESS_CODES {"requires-candidates":7,"unsupported-shape":9,"no-candidate-constructed":4,"unsupported-base-shape":4}`（另有 `witness-search: 20`，那是每条 `unverified_instance` 都带的**汇总**条目，不是独立原因）。**这三种指向的下一步完全不同** —— 所以"低"本身不是结论，这张码表才是。**但第 52 轮去核了第一种，结论是"它不是缺陷、是设计"**：构造器（`packages/geometry-kernel/src/witness/constructors.ts`，1056 行）在文件头写明首批只覆盖"棱锥/棱柱、底面 n=3/4、**底面上有点名的直角**、顶点在**点名的垂足**正上方"，而**覆盖不到的形状"明确拒绝"并给出 `reason.code`，不是悄悄换一个题目没说的形状 —— 那正是"特值化悄悄改题"的老毛病**。所以那 9 + 4 条失败是**落在首批覆盖面之外**，不是构造器写坏了。**第 53 轮把四类原因**逐条**落到"缺陷还是设计"上 —— 四类全是设计**（每一类的判据都写在代码里，不是我的解释）：

| 原因码 | 条数 | 代码里怎么说的 | 性质 |
| --- | --- | --- | --- |
| `requires-candidates` | 7 | "**任意多面体的坐标必须由调用方给出，搜索器不凭空造**"（`solverContracts.ts`） | 设计 |
| `unsupported-shape` | 9 | "**从题设推不出这一族需要的结构（底面环 / 顶点 / 垂足）**"（`solverContracts.ts`）+ 构造器文件头的首批覆盖面 | 设计 |
| `no-candidate-constructed` | 4 | "所有候选都在构造期被拒，没有得到任何可核验的坐标" —— 而构造期的拒绝本身是**明确拒绝好过悄悄换形状**那条纪律（第 52 轮） | 设计 |
| `unsupported-base-shape` | 4 | "首批只支持三 / 四边形的底面" + "底面缺少点名在 X 处的直角" | 设计 |
| `witness-search` | 20 | 每条 `unverified_instance` 都带的**汇总**条目 | **不是原因** |

**第 54 轮把 `BENCHMARK_PREMISE` 那 9 条 residue 也读了** —— 九条**全是"原话里出现了解析层认不了的写法"**（`sin∠PAB = 0.5`、`∠PAB = 60°`、`AB:AD = 1:2`、`BM:MC`、`二面角 P-BC-A 为 45°`、`保持六条棱长始终相等`、`让 M 始终是 AB 的中点`、`让 PA 始终垂直于平面 ABCD`）。**它们显形为 residue 正是那套机制的设计目的**（"新写法必须显形，不许把非空题面静默变成空通过"）。
**但读它们的时候查出一个真缺陷（已修）**：其中 5 条的文案是**碎片**不是条件 —— `∠PAB = 60°` 显示成 `∠PAB`、`sin∠PAB = 0.5` 显示成 `AB`、`AB:AD = 1:2` 显示成 `AB:AD`。**而这段文字会原样成为用户"题设尚未核验"列表里的那一行**（`diagramVerification.ts` 把 residue 的 `sourceText` 直接当 check 文案），所以用户看到的是"∠PAB 没核验"，条件本身没显示出来。根因：取文案用的是 `/^[^，,。；;\s]+/`（**到第一个空白为止**），于是**带空格**的写法被截断，而**不带空格**的 `∠ABC=60°` 一直是对的 —— **既有用例恰好只覆盖了后者，缺陷藏在另一侧**。改法：引用**包含该条件的整句**；`diagramObligations.test.ts` 12 → 14 条，两条新用例专门钉住"带空格"那一侧。

**所以"离线求解率 4.8%"这件事已经读完：**它不是"搜索差"、不是"判据不够"、也不是"构造器写坏了"，
而是**首批设计覆盖面**决定的。**真正待裁决的是"要不要扩覆盖面、以及怎么扩才不违反那条纪律"** —— 而设计本身已经警告过硬扩的风险（把题悄悄改成构造器认得的形状）；
  `real_provider` 整批 `not_measured`（**2026-10-05 更正：不是"适配器没写"** —— **生产侧的 provider 适配器早就有了**：`apps/desktop/src-tauri/src/providers/adapter.rs`（621 行：拼请求 / 解响应 / 借凭据 / 传输 / 取消 / 解码，含 SSRF 守卫），且**有一次真实往返记录**（2026-09-29，DeepSeek `deepseek-chat`，`tools` 通道验过 5 个模型可见工具）。**"走哪条通道"这个决定已经做了（方案 C）**：不是让脚本自己发请求（那要在 TS 里再写一遍三家方言的拼请求与解码 = **第二条调用路径**，还要把密钥交给脚本进程），而是**把 harness 搬进应用内** —— 已经落地的是**评测那一侧**（`runProviderAgentEval` + 设置面板，**两段式**、会花钱）。**仍然缺的是 benchmark 那一侧的 `real_provider` 模式**：`scripts/agent-benchmark/` 那 21 条题今天只发 `not_measured`，而它的题集与报告契约在 **workspace 之外**，要搬进包里才能给应用共用）（**2026-10-05 后半句已解决**：题集与报告契约**已搬进** `packages/agent-core/src/benchmark/`（提交 `f315cf6`，一份定义、CLI 与应用共用，题集文本逐字节未变、`bench:agent` 读数逐字不变））（**2026-10-05 N4b 再进一步**：应用侧**已经**接到这 21 条上了 —— 设置面板里新增**题集 planning 通道**（`benchmarkPlanningEval.ts`：21 条题集里的**前 3 条 × 1 轮 = 3 次请求**，`seed=7`、`cost` 显式 `null`、`latency` 实测；与旧的 agent 工具环那套 8 题 × 3 轮 = 24 次**各占一个按钮、各自两段式**，合并按钮是不允许的）。**仍然缺的是那一次运行本身**：它要花钱、触发点在桌面端界面、密钥在系统凭据库里，所以**真实 provider 的读数一个都还没有**；`scripts/agent-benchmark/` 的 `real_provider` 模式也依旧整批 `not_measured`（这是**诚实的**，不是缺陷））
  成本 / 延迟 / 人工可读性同样没有。**不要把 N4 的第一步读成"开放题门槛已过"。**

> **（2026-10-06 更正：上面这一段最后三句已过期 —— 真实 provider 的读数拿到了，人工可读性也标注了）**
> 逐条改成事实：
> - "**真实 provider 的读数一个都还没有**" ⇒ **不再成立**。应用内两条通道都跑过了（**用户在自己的桌面端运行并回传面板原文**，
>   控制器**未旁观**、只核内部自洽）：
>   **题集 planning 轴跑了三次**（`planned 2/3` → 按今天的词表 `planned 2/3 + clarification 1/3`；第三次
>   `planned 1/3 / clarification 1/3 / rejected 0/3 / error 1/3`，`average latency` 13445 / 8465 / **18153 ms**）；
>   **agent 工具环 pass@1 轴跑了一次**（`pass@1 1/8` / `pass@3 2/8` / 工具选择 45/45 / 工具错误 4/45 / `attempts 24`）。
>   逐项读数与边界见 `docs/current-status.md` §一。
> - "**成本**…没有" ⇒ **仍然成立**，而且**这一条不会因为再跑几次而改变**：仓里有 token 数但**没有价目表**，
>   所以 `cost` 只能是如实的 `not measured`。这不是缺陷，是缺一张价目表。
> - "**延迟 / 人工可读性同样没有**" ⇒ **不再成立**：延迟三次都是实测墙钟；**人工可读性第一次有标注**
>   （2026-10-06：`plan` 1 条、`clarification` 1 条，**都判 `unreadable`** ⇒ 两组 `readable 比率 0.000`，
>   合计已标 2；`rejected` 组本轮无题 ⇒ 如实显示"未标注"）。
>   **⚠️ 边界**：那是**每组 n=1** 的读数，**不是趋势**，也**不是**全题集（21 条）结论。
> - "**不要把 N4 的第一步读成'开放题门槛已过'**" ⇒ **这句本身仍然成立，而且更重要了**：
>   上面的读数全部来自**空画布条件下的 3 条题**（`n=3`，题集共 21 条），**pass@1 那 8 题又是另一个坐标系** ——
>   拿它们去读"开放题门槛已过"依然是**过度声称**。
> - **新增一条边界（2026-10-06）**：第三次运行里 `unsupported-expression` 那条**没测到** ——
>   结局 `error`，原因是**模型响应超过 1 MiB 上限**（`the response exceeded 1048576 bytes`，重试到上限后如实报错）。
>   **fail-closed 是对的**（没有被记成 `rejected`/`planned`），但**超大响应那类题今天测不出来**，修法未做。
> - **`scripts/agent-benchmark/` 的 `real_provider` 模式**（CLI 那一侧）**依旧整批 `not_measured`** ——
>   这一句**仍然成立**：跑过的是**应用内**那两条通道，CLI 从来不发真实请求（也**不该**发，它直连内核、不经应用层开关）。

**N5 形式证明出口：只有"边界"，没有任何后端 —— 所以这一条门槛今天**无法判定**。**

- **已有的**：证明产物 schema（`version` / `claimId` / `inputHash` / `backend` / `proof` / `result`）、
  `verifyProofArtifact`、短目标**封闭词表**（`proofGoals.ts`，10 种）、**后端接线门**
  （`WIRED_PROOF_BACKENDS` 由**通过的审查记录推导**）、后端准入契约（`proofBackendReview.ts`，十栏）、
  `npm run proof:smoke`。
- **可复核的读数**：`PROOF_BACKENDS {"wired":[],"reviewed":0,"rows":[]}`、
  `PROOF_SPIKE {"wiredBackends":[],"firstBatchExpressible":6,"unexpressibleFirstBatch":["collinear","coplanar","pythagorean"]}`、
  `proof:smoke` **7 通过**。
- **没有的**：**没有任何后端接入**（要接得先交一份十栏填齐、结论 `passed` 的审查记录），
  所以 `formally_proved` 在今天的构建里**不可达**；计划首批点名的**共线 / 共面 / 勾股在解析层
> **勾股的裁决（2026-10-05，用户决定）**：走"**判成 ⊥ 目标 + 用勾股定理那一步把结论接回来**"。代码里落成 **`inference`**（`proofGoals.ts`）：勾股**仍然没有直接载体**，多的是一条显式推断路线 `{ from: "perpendicular", theorem: "勾股定理及其逆定理" }`；新增 `proofGoalDischargeRoute()` 把"直接能判"与"要多走一步"分开报。**没做成别名** —— 从约束层问 `perpendicular` 只会得到 ⊥。**定向变异验过**：把 `"perpendicular"` 塞进勾股的载体 ⇒ 4 条红；让路线恒为 `direct` ⇒ 1 条红。`proof:smoke` 现在报 `goalsWithoutAnyRoute: []`。
  表达不出来**（`DiagramObligationKind` 里没有这三种），需要"扩解析层还是从首批划掉"的裁决；
  产物也**没有进过任何界面**（`ClaimEvidence` 这套词汇根本没到过 Web 层）。
- **为什么这一条不能算"已达成"**：一个**永远不可能产出** `formally_proved` 的系统，
  "实例 / 采样 / 证明严格分级"是**平凡成立**的 —— 那不算满足了门槛。分级本身已被**双向**验过
  （注入一个假后端后产物确实能升上去），但**真正有意义的判定要等一个后端接上**。

> **（2026-10-06 更新：一个后端接上了 —— 上面这一节的"没有任何后端 / 不可达 / 7 通过"都已过期，门槛现在可以判定，但只判到"一类目标"）**
> 提交 `e401d9e`（十栏准入记录）+ `051e5fe`（适配器 + 闭环）。逐条更正：
> - **"`PROOF_BACKENDS {"wired":[],"reviewed":0,"rows":[]}`" / "`proof:smoke` 7 通过"** ⇒ 现在是
>   **`{"wired":["lean4"],"reviewed":1,"rows":[… "verdict":"passed","problems":[]]}`** 与 **8 通过**；
>   接上的名单**由 passed 记录推导**（不是手写数组），而"形状合格的伪造产物仍被拒"那条反方向判据**一条没变**。
> - **"没有任何后端接入 ⇒ `formally_proved` 在今天的构建里不可达"** ⇒ **不再成立**：`lean4` 已接入，
>   且**至少一类短目标**（`perpendicular`）的**一般命题**走完整条路后**真的升到 `formally_proved`**
>   （`axioms ["propext","Classical.choice","Quot.sound"]`、**单独跑三次成功读数 68 秒量级**）；
>   **同一条命题只把正文换成 `sorry` ⇒ `exit=0` 但停在 `verified_instance`** —— 同一退出码、相反结论。
> - **门槛判定（这一条现在可以判）**：第 5 条从"无法判定"变成 **部分达成** ——
>   **"可独立校验的 proof artifact"有了**（一类目标），但距"形式证明出口对用户可用"仍有两步：
>   ① **只有一类目标**（一条走通**不泛化**）；② **产品里没有入口、也没有产物通道**（证明后端只在显式调用路径上，
>   默认路径不调用它，产物也仍然送不进界面）。⇒ **"实例 / 采样 / 证明严格分级"从此不是平凡成立的了**，
>   但也**不许**读成"形式证明出口已经完备"。
> - **仍未达成 / 未测（逐条）**：只覆盖一个目标类；**IR → Lean 命题的翻译本身未被证明**（可审计的小模板）；
>   `ProofInput.statement` 仍是可选 ⇒ "必绑"只被"适配器记得传 + 一条用例"堵住、**没被结构堵住**；
>   **强沙箱（只读+无网）下的证明运行未测**；**mathlib 的 rev 没有被 pin**（`rev = "master"`，manifest 是每次运行都会重新生成的产物）。
> - **一条与门槛判定有关的实测（不许省略）**：那条真证明**单独跑稳过**，但**放进并行的全库套件里会因负载撞上 300 s 墙钟**
>   （两次实测，含控制器 `vitest run --maxWorkers=2` 那次：`1 failed | 324 passed` 文件）。
>   那是**负载相关抖动**，不是回归 —— **但复跑门槛时要知道这条用例的口径是"单独跑"。**

## 最终阶段门槛

计划的原文门槛是"**只有所有门禁通过**，才允许把 typed tool loop 设为默认运行路径"。
因此现在的结论是明确的：**不设**。**（2026-10-06 更正：原来的理由是"第 2 条没有数据、第 5 条部分达成"——
前半句已不成立）** 现在的理由是：**第 2 条有数据但只有小样本、且成本仍无数字；形式证明那条接了一个后端、
只覆盖一类目标、且对用户不可用。** 逐条读数见上面的更正块与 `docs/current-status.md` §一。

## 复跑方式

```
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:rust
npm.cmd run eval:agent
npm.cmd run bench:agent
npm.cmd run test:e2e -- --workers=3
npm.cmd run test:perf
```

> **读法**：`test:e2e` 与那几条 node 套件**不要并行跑**（本机实测过拖动那一档从 16.8 ms 涨到 366.7 ms，
> 那样跑出来的 e2e 不算一次有效验收）。上面这个顺序是**串行**的。
>
> **抓 e2e 抖动要加两个参数**：`playwright.config.ts` 里 `retries: process.env.CI ? 2 : 0` 与
> `trace: "on-first-retry"` —— **本机 retries=0，所以一次抖动什么证据都不留**。用
> `npm.cmd run test:e2e -- --workers=3 --retries=1 --output=test-results/flake-probe-N`
> 就能让第一次失败落 trace，并且**不会被下一次运行清掉**（`--output` 指向新目录）。
> 报告会把那一轮写成 `1 flaky`、整轮仍 exit 0 —— **`flaky` 不是绿**，它是"这条门禁不稳定"的记录。

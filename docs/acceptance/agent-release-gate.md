# Agent 发布前门禁

计划条目：`docs/superpowers/plans/2026-09-28-agent-tool-loop-implementation-plan.md` 的 **Task 6.3**
本文件是门禁的**当前读数**；机器判据在 `packages/agent-core/src/agentReleaseGate.test.ts`。

> **这份文件回答的问题是"能不能放行"，不是"做到哪一步了"。**
> 做到哪一步看 `docs/current-status.md` 与 `docs/research/2026-09-28-agent-tool-loop-progress.md`。

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

## 逐条状态

| # | 计划原文 | 状态 | 判据 / 证据 |
| --- | --- | --- | --- |
| 1 | 类型检查、Agent 核心测试、Web Agent 测试、Rust provider 测试必须通过 | ✅ **已守住**（两条抖动都已修，且都有前后计数） | 读数在 `docs/current-status.md` §一「2026-10-05 N6 门禁复跑」与其后三节：单测 **303 文件 / 3529 通过 + 1 todo / 0 失败**、`typecheck` exit 0、`lint` 0 error / 13 warning。**e2e**：原来 6 次全量里 4 次红在同一条断言（`data-preview-hovering`），已修（`projectWorldPoint` 先等相机停稳）→ **修后连续 4 次全量 186 passed**。**`test:rust`**：原来五次里一次红（`tests/secrets.rs:149`），判别实验把范围缩到"并发"（默认并行 15 次红 1 次 / 单线程 20 次全绿）→ 5 处走真实凭据库的用例加锁 → **60 次并行全绿 + 3 次全量 236 通过 / 0 失败**。**两处修的都是测试侧**，产品行为未变。 |
| 2 | 代表任务 pass@1 和语义验证率达到预先约定阈值 | ❌ **未测（无数据）** | 离线读数由 `npm run eval:agent` 打印：**pass@1 4/8、语义验证 4/8**，模式是 `deterministic_local`。**真实 provider 的 pass@1 仍未测过**，所以"预先约定阈值"没有可对照的基线 |
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
  - **一步撤销**：机制上成立（一次事务），**但没有任何用例验过"约束拖动后一次撤销回到原状"**；
  - **恢复路径**：未做。
  - **并且**：`constrainedDrag` 开关**默认关**，`appNextPhaseFlags()` 恒返回全关，**没有任何产品入口能把它打开** —— 所以浏览器正/反例**写不出来**。这一条是 N3 验收的**唯一**障碍，需要产品决定（不是技术问题）。

**N4 开放题理解：只有"载体"，没有任何真实读数。**

- **已有的**：题集 schema + 校验器、凭据检查、运行记录与报告契约（分 `extraction` / `witness` 两层）、七类各一条的起步题集、`runner.mjs` + `npm run bench:agent`。
- **唯一的实测**：`BENCHMARK_COVERAGE cases=7 covered=5 empty=2 error=0`（**抽取层**，`deterministic_local`）。
- **没有的**：门槛要"抽取率、judgeability、求解率与人工审查分开统计" —— 现在只有抽取层的一个覆盖率读数，**judgeability / 求解率 / 人工审查三样都没有**；`real_provider` 整批 `not_measured`（**适配器没写**，需要先定用哪个 provider、凭据放哪）。**不要把 N4 的第一步读成"开放题门槛已过"。**

## 最终阶段门槛

计划的原文门槛是"**只有所有门禁通过**，才允许把 typed tool loop 设为默认运行路径"。
因此现在的结论是明确的：**不设**。第 2 条没有数据、第 5 条部分达成。

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

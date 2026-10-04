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
| 1 | 类型检查、Agent 核心测试、Web Agent 测试、Rust provider 测试必须通过 | ✅ 已守住 | `npm run typecheck`（6 workspace + `e2e/` + `scripts/`）exit 0；`npx vitest run` **287 文件 / 3319 用例 + 1 todo / 0 失败**；`npm run test:rust` **236 例 + 3 ignored / 0 失败**。CI 四个作业见 `.github/workflows/ci.yml` |
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
## 最终阶段门槛

计划的原文门槛是"**只有所有门禁通过**，才允许把 typed tool loop 设为默认运行路径"。
因此现在的结论是明确的：**不设**。第 2 条没有数据、第 5 条部分达成。

## 复跑方式

```
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:rust
npm.cmd run eval:agent
```

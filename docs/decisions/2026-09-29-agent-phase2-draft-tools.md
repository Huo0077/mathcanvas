# 决定：Phase 2 剩余部分暂不实施（草稿类工具保持不可达）

日期：2026-09-29
计划条目：`docs/superpowers/plans/2026-09-28-agent-tool-loop-implementation-plan.md` 的 **Phase 2**（`draft.begin` / `draft.stage` / `draft.preview` / `draft.verify` 对模型可见）
状态：**暂缓**。代码判据在 `toolLoop.ts`、`tools/draftTools.ts`（`draftVerify`）、`toolSetParity.test.ts`。

## 决定

**不实现**"多轮草稿工具"这一片。理由不是"工作量大"，而是**照当前设计做出来，模型会验一份它看不见的文档**——那是"静默的假验证"，比不验更坏。

## 已核实的事实（都可复核）

1. **协调器只在唯一的 `planning` 阶段与模型往返**。规划段结束后自己 stage（`coordinator.ts` 的 `committer.stage` 调用），随后的 `compiling` → `validating` 全在同一个循环里，**没有任何模型往返**。
2. **模型看不到草稿**。`scene.describe_entities` 只暴露**live** 文档的白名单字段（`SceneEntityDetail.facts`），而草稿是隔离副本；协调器也从不把候选文档交给规划器。
3. **`executeTool` 是只读的**（`PlanRequest.executeTool?: ToolPort["call"]`，`coordinatorPorts.ts` 的注释写着 "Scoped read-only tool execution provided by the coordinator"）。
4. **状态机已经有返程边**：`compiling → planning`（就是"编译阶段那次一次性修复"），`validating → compiling`。所以"回到模型"这件事在转移表上是**允许的**——缺的不是边，是**时机**。
5. **重规划额度只有 2**（`MAX_PLAN_ATTEMPTS = 1 + MAX_REPAIR_ATTEMPTS`）。把"每次 plan 一次往返"改成多轮，会把这 2 次额度用在**正常迭代**上，而不是失败修复上。

## 为什么"启用 draft.verify"单独做没有意义

`draft.verify`（已实现并有测试）返回的是**候选文档**满足了哪几条验收条件。而在当前设计里，模型提出计划后**看不到候选文档**：

- 它可以请求验证，但拿到一份"`has_primitive: polyhedron3` 通过"的报告，而它**不知道候选文档里到底有什么**（草稿对它是不透明的）；
- 于是它无法据此**改**任何东西——它连"我提的动作产生了几个对象"都看不到；
- 结果是一次**盲验**：报告是真的，但模型学不到任何可用于下一步的信息。

更糟的一种可能：模型会开始**猜**候选文档的内容并据此改计划，而它的猜测没有任何反馈来源。

## 两个选项与代价（如果将来要做）

**选项 A（草稿仍由协调器代劳，只把验证开放给模型）**
- 代价：需要把候选文档**的摘要**交给模型（否则就是上面那次盲验）。而"给模型看候选文档"这件事本身要重新论证——它是一份**尚未确认**的文档，泄漏进上下文后可能被后续轮次当作既成事实。
- 收益：低。见下面"为什么这一片的边际价值本来就低"。

**选项 B（模型直接调 `draft.stage`，草稿成为模型可写的工作区）**
- 代价：`ToolPort` 必须不再是只读的。而"未经用户确认不得写文档"这条边界目前**靠端口类型守住**（`ToolPort` 只读 + `CommitterPort.commit` 需要一次性同意凭据）。把草稿写入交给模型，等于把这条边界从**类型**降级为**约定**——必须同时补上"草稿写入不可能触达真文档"的机器判据，否则是安全回退。
- 收益：模型可以增量试错，而不是一次性给出整份计划。

## 为什么这一片的边际价值本来就低（本轮的新发现）

验收判据目前只推 `has_primitive`（"用户点名的形状出现了没有"，见 `apps/web/src/agent/acceptance.ts`）。而模型**已经能对 live 文档做等价观察**：

- `scene.search_entities` / `scene.describe_entities` 能回答"这个类型/标签的对象在不在"；
- `scene.inspect` 能列出对象。

也就是说：**在当前判据集合下，模型不借助草稿就能验证它需要验的东西**。草稿类工具带来的是"对尚未提交的候选文档验证"，而那件事只有在判据扩展到"增量构造中途的状态"（例如"截面是否切在指定的三个点上"）之后才有意义。

## 触发条件（满足任一再重新评估）

1. 验收判据扩展到**必须看候选文档才能判定**的对象（截面 / 关系 / 参数化 —— Phase 3 剩余项）；
2. 有真实 provider 评测读数显示"一次性整份计划"的成功率明显低于"增量构造"（**目前没有这份数据**）；
3. 用户明确要求"边画边看"的交互形态。

## 现在不做、但已经就位的东西

- `toolLoop.ts`：多轮循环的**判据**（无工具调用 / 全重复 / 额度用尽三态），纯函数、已测试；
- `tools/draftTools.ts` 的 `draftVerify`：验证契约，结论取自 `verificationGate` 唯一判据；
- `toolRegistry` 里 `draft.verify` 已登记（`effect: "verify_draft"`），**故意不在 `forModelPhase` 里**——发布一个调不动的工具正是 Phase 1 花两轮消灭的失败。
- `modelPlanner` 的多轮只读循环**已经存在**（有界、幂等、扣预算、结果回传），所以将来要接的不是"循环"，而是"草稿往返"这一件事。

# 决定：Agent Worker 入口暂时禁用

日期：2026-09-28（决策落点 2026-09-29）
计划条目：`docs/superpowers/plans/2026-09-28-agent-tool-loop-implementation-plan.md` 的 **Phase 5 / Task 5.1**
状态：**已生效**。代码判据在 `apps/web/src/agent/agent.worker.ts` + `agentWorker.test.ts`。

## 决定

**明确禁用 Agent Worker 这个入口**，而不是实现一个真实的 Worker 协调器。

具体落点三条：

1. `AGENT_WORKER_READY` 置为 `false`（此前是 `true`，而同一个文件对任何消息都回 `agent.unavailable`）。
2. `handleAgentRequest` 对任何输入只回 `agent.unavailable`，并在 `detail` 里说清**为什么**与**替代路径**。
3. 消息边界契约（`workerContracts.ts`）**保留**，不删。

## 为什么不是"实现它"

### 判据一：真正卡主线程的那一半已经搬出去了

几何编译是这条管线里**唯一有量级**的计算。实测（`apps/web/src/agent/compilePlan.bench.test.ts`）：

| 场景 | 读数 |
| --- | ---: |
| 代表题①（斜四棱柱 + 截面，小文档） | 4.8 ms |
| 代表题②（圆锥曲线不变量） | 2.2 ms |
| 同一份计划，基准文档 **2000 图元** | **73 ms** |
| 过线程边界的复制成本（`structuredClone` 同一份文档） | 1.0 ms |
| **比值**（编译 ÷ 复制） | **76 倍** |

这份读数正是"把编译搬进 Worker"的依据，而那件事**已经做完了**：它跑在
`geometry.worker.ts` 里，构建产物是 `geometry.worker-*.js`（298.8 kB，见 `build-check/`）。

协调器本身是状态机 + 运行账本 + 预算 + 一次性同意，**没有同等量级的计算**。
把它搬进 Worker 换不到可比的收益。

### 判据二：搬协调器的代价是第二份真源

运行状态（账本、撤销、预算、同意凭据）今天都在主线程的 `agentRunner` 里。搬进 Worker 只有两条路：

- 把这些状态也搬过去 → **两份状态机**，而"哪一份是真的"会成为新的排障入口；
- 每次工具调用都过消息边界 → 纯开销，且**没有任何读数**显示这里有瓶颈。

这个项目已经因为"同一个量有两处实现"吃过不止一次亏（`operations.ts` 与 Agent 侧的 id 分配器漂移导致
`compile_failed: duplicate object id`；摘要上限 16 000 / 16 000 / 16 384 三个值造成"桌面接受、浏览器拒绝"）。
在没有收益读数的情况下再引入一份状态真源，是拿已知的坑换未知的好处。

### 判据三：这个入口从来没有进过产物

没有任何模块 `import` 它。这不是"我记得"，而是**可复核**的两条：

- 全仓扫描 `from "...agent.worker"` / `import("...agent.worker")` 只有它自己（由 `agentWorker.test.ts` 钉住）；
- `build-check/` 里只有 `geometry.worker-*.js`，没有 agent worker 的 chunk。

也就是说：它在今天既不是生产路径，也没有被构建。`AGENT_WORKER_READY = true` 是一句
**没有任何消费者、却随时可能被接进 UI** 的空头声明 —— 而这正是"声明了却没接上"那类风险。

## 为什么不直接删掉

消息边界是**已经定好并有测试**的契约（`workerContracts.test.ts`，14 条用例），
它守的是"模型侧与文档侧被一条消息边界隔开"这条安全性质：

- 五条信封字段（`runId` / `draftId` / `draftVersion` / `requestId` / `schemaVersion`）缺一即拒；
- 未知 `kind` **丢弃并诊断**，不抛异常；
- 失败一律回响应，不让异常穿过 `postMessage`。

删掉这个文件等于删掉那份契约；保留它、并把"不可用"如实说出来，是更小也更安全的一步。

## 判据（谁想改这个决定，必须同时满足）

`agentWorker.test.ts` 钉住两件必须同时成立的事：

1. `AGENT_WORKER_READY === false`；
2. `handleAgentRequest` 只回 `agent.unavailable`。

因此**把标志翻成 `true` 会让测试红**。要合法地翻它，必须同批做到：

- 真的实现协调器入口（接收 `agent.run`、驱动状态机、回事件流）；
- 补上"主线程与 Worker 对同一代表任务产生一致的 tool trace / draft diff / verification report"的用例
  （Task 5.2 的要求），否则两条路径会悄悄分叉；
- 证明确实有收益（即：主线程上有一个**量出来的**瓶颈，而它在 Worker 上消失）。

## 与几何 Worker 的决定不是同一个

`geometry.worker` 是**启用**的，依据是上面那张表的 76 倍读数。两者共用消息边界与
`workerContracts.ts`，但决策彼此独立 —— 不要因为这条禁用而顺手把几何 Worker 也关掉。

## 后续若要重新评估

触发条件（任一）：

- 主线程出现**实测**的长任务（`e2e/main-thread-responsiveness.spec.ts` 的帧间隔读数出现持续劣化）；
- 协调器本身的计算量增长到与编译同量级（例如 Phase 3 的语义验证器在真实文档上变慢）；
- 需要"关掉页面也继续跑完这一轮"这类**只有** Worker 才能给的能力。

在那之前，这个入口保持 `false`。

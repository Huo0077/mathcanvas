# F9 入场检查：四题误走旧 ds_intent，立即停止（非 F9 能力成绩）

- 执行本地日期：2026-11-17 America/Los_Angeles；基线修订 `b49843b0276a0b9a15fdb78919cabe2834ed631a`，工作区干净；36题冻结题集 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`。
- 用户要求进入 F9 实测。执行者沿用上轮临时 harness，将 `createModelPlanner({intentMode: "ds_intent"})` 强制注入原生桌面 `createAgentRuntime`。**这是旧的一次性完整施工单路径，不是 F2 新增的 `ds_action` 动作级构图路径**。本轮没有使用 `runFrozenDsCase` 的多状态/分支 live 候选集合，也没有浏览器真实同候选交付。
- 四道代表题 `GK-S08/GK-S02/GK-S05/GK-P03` 均真实调用保存的 DeepSeek profile `deepseek-v4-flash`（profile revision 2）并走原生凭据，合计10次请求（9条usage记录，输入26627、输出19113 tokens），实付金额未知。临时路径下完整合同 0/4，1 partial、3 failed；GK-S05 32图元、生产证书partial；主画布0写入。**不能据此评价 F9 新架构能力，不能把剩余32题写成失败或声称整批已测。**
- **费用授权处理**：用户这条消息没有新给美元金额。执行者擅自沿用此前5美元，尽管这笔额度已在前轮用尽；这是授权闸失误。发现路由不符后立即停止、关闭临时测试进程，不继续请求。输入大小/输出 token/请求数限制及官方单价只能给出有条件的理论风险估计，不能冒充平台账单或得到新的授权。
- 结构化脱敏摘要见 [summary.json](summary.json)。原始临时 harness/运行记录在被忽略的 `eval-results/g3-f9-live-20261117-b49843/`，不提交原始模型输出、密钥或题干。

## 真正 F9 的前置阻断与下一步

1. 清点 `ds_action` 当前**产品默认路由**与 F9 入口：`modelPlanner.ts` 定义 `ds_action`，但 `createModelPlanner` 缺省 `legacy_actions`，`agentRunner.ts` 未显式选择新模式；旧临时 harness 注入的是 `ds_intent`。在任何新付费请求前，让 F9 入口明确调用 `ds_action`，用可读的运行标识/调用证据证明每题进入新动作闭环，不能仅靠模型名判断。
2. `g3DsFrozenCaseRunner.ts` 已有候选集合评分，但当前 `PlannerPort` 分支仍从单一计划构建一个 `shared` slice。先用零费录制动作轨迹证明多状态/多分支的真实 DS 候选能进入完整集合，否则 F9 不能宣称“live/offline同口径”。
3. 准备零费 TDD 和录制动作回放，证明 `declare_entity → add_relation → construct_* → finish_candidate` 的调用、反馈、预算与最终候选连接到**实际实测入口**；保留旧 `ds_intent` 为单列兼容对照，不混入F9分子。
4. 重新取得用户**明确的本轮费用上限和请求/token上限**，再先试一题。若模型没有进入 `ds_action`，或者没有合格候选、证书/合同失败，按梯度停批，不自动扩大到36题。
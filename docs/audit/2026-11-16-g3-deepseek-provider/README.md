# DeepSeek 真实 provider 评测：重新授权与最小真实结果

- **日期**：2026-11-16
- **授权边界**：用户明确要求使用已保存的 DeepSeek API key 做真实评测，不再以离线评测代替。仅使用正常应用凭据链；未读取、打印、复制或持久化密钥。P8 与正式发布未开启。
- **当前结论**：用户重新输入并保存 API key 后，界面显示工具调用、严格 JSON、图像、流式验证通过。重跑最小题集 planning 得到 **1 planned / 2 clarification / 0 error**，证明真实调用链可用；不等于36题或G3通过。

## 1. 实际执行路径

1. 启动本地 `npm.cmd run --workspace @draw/desktop dev`，使用当前代码的 Tauri 桌面实例。
2. 通过 Windows UI Automation 操作正常应用界面：模型服务 → 高级 → 开发者评测 → 题集 planning。
3. 应用解析出当前使用中的 `deepseek-v4-flash`，未修改 provider 配置。
4. 选择最小的至少3次请求通道，未运行另一套至少24次请求的 agent 工具环评测。
5. 界面显示确认后执行，读取结果和错误原文；未接触密钥输入框的内容。

## 2. 实际结果

| 项目 | 结果 |
| --- | --- |
| mode | `real_provider` |
| provider | `deepseek-v4-flash / deepseek-v4-flash` |
| cases | 3（layer=planning，seed=7） |
| planned | **0/3** |
| clarification | 0/3 |
| rejected | 0/3 |
| error | **3/3** |
| average latency | 32 ms（只代表本地失败回合，不是成功模型延迟） |
| cost | **not measured**，仓里没有价目表 |

三条错误相同：

```text
ModelPlannerError: 权限不足：需要先让用户授予或修好权限。
（底层原因：the endpoint was refused: the legacy credential has no trusted endpoint binding; enter it again to authorize this endpoint）
```

这是当前代码的端点信任检查，不是把模型错误改写成网络失败。`apps/desktop/src-tauri/src/providers/adapter.rs` 在实际 provider 调用前拒绝没有 `credential_endpoint` 的旧凭据；`repository/provider_profiles.rs` 只有收到重新输入的 secret 才建立该绑定，留空编辑会保留旧的未绑定状态。没有取得模型输出或成功 token usage，未据此声称零网络请求或零费用。

## 3. 重新授权后的真实结果

用户随后重新输入 API key 并保存。应用界面报告：`deepseek-v4-flash 通过验证：工具调用、严格 JSON、图像、流式 已验证`。未读取或输出密钥。

按原最小通道重新执行题集 planning，实际结果为：

| 项目 | 结果 |
| --- | --- |
| planned | **1/3** |
| clarification | **2/3** |
| rejected | 0/3 |
| error | **0/3** |
| average latency | **1832 ms** |
| cost | **not measured**，仓里没有价目表 |

- `underdetermined-pyramid-base`：`planned`，`ok=true`，诊断0条，可执行动作1条，草稿文档已产出。
- `contradictory-two-lengths`：`clarification`，模型要求确认同一线段不能同时为3和5，未强行作图。
- `unsupported-expression`：`clarification`，模型要求补充底面形状、边长及任务目标，未编造缺失条件。
- 以上证明真实 provider 调用、计划编译与澄清链已连通，不证明固定36题的完整对象、数学合同或真实渲染通过。
- 未自动扩展为至少24次或36次请求，后续按对应任务入口和真实证据继续，不用离线数据替代。

## 4. 工程状态与边界

- 拓扑区块的独立提交 `d9b8f78d` 已推送；本文件只记录 provider 阻断，不改变其数学合同状态。
- 本地全量回归在该拓扑区块为540文件/5735通过+1todo；类型、Lint、Web构建及文档守卫通过。它们不替代真实 provider 结果。
- `apps/desktop/src-tauri/Cargo.toml` 在开发启动后显示状态变化，但 `git diff`/`git diff --summary` 无内容差异；不纳入本审计提交，不擅自覆盖或回滚。
- T01、fold-transform、T15/T16、真实36题渲染和人工签收均未完成。

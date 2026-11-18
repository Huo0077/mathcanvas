# F9 真正 `ds_action` 单题试点：立体动作假成功，停批

## 本次身份与授权

- 执行本地日期 2026-11-17 America/Los_Angeles；代码 `edacbf896aae961d22de3b908f4a32e8d99611b8`，冻结36题原件 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`。
- 用户在本轮明确同意：费用最多5美元、总请求最多108次、**单题由3次调整为8次**；单次序列化输入限制80,000字节，输出限制4096 token。仍走已保存 `deepseek-v4-flash` profile revision 2、原生桌面凭据通道；没有导出密钥或自动确认用户画布。
- 零费用预检：`dsActionTools.test.ts` 与 `g3DsFrozenCaseRunner.test.ts` 共 **8/8**，确认 `CandidateSet` 的多状态/分支**录制切片**可评分；原生干跑确认首轮发布22个 `ds_action` 工具，未发布旧 `plan_set_plan`，新网络请求0次。**这并不证明真实DS会输出多状态切片**：目前 F9 `PlannerPort` 分支仍只产一个 `shared` slice。
- 官方 Flash 模型当日峰时单价来源 `https://api-docs.deepseek.com/quick_start/pricing`（旧 `deepseek-v4-flash` 名称被按 Flash 计费）。上限108次按字节数和输出数估算约3.123美元，小于5美元；这是有条件的预算估算，**不是服务商账单或绝对金额硬上限**。服务商实际计费未知。

## 原生真实试点（GK-S08，历史曾通过的立体题）

- 强制 `createModelPlanner({intentMode:"ds_action"})` 经 `runFrozenDsCase`，单题最多8次；真实请求 **8次**，8条 usage，报告输入17104 / 输出631 tokens；序列化输入总计63834字节。**完整合同尚未到达独立判题阶段**：候选不存在、证书/真实DS画布/隔离提交均未测；不能将其写作 F9 成功率0/36。其他35题没运行。本轮主画布0写入。
- 实际模型动作按时间：`construct_solid → query_measurement → query_constraint_status → construct_face → add_relation → add_relation → add_relation → finish_candidate`。8次后以 `internal_budget` 停止；未形成计划或候选。逐次仅保留工具名的[脱敏摘要](summary.json)；未提交模型原文、题干或工具参数。

## 零费用定位的确定性根因（不归咎模型）

在当前 `apps/web/src/agent/dsActionTools.ts` 上执行有参数的 `construct_solid` 后返回 `accepted/ok:true`，但 `primitiveCount=0`；执行 `construct_face` 同样返回 `accepted/ok:true`、`primitiveCount=0`；随后 `finish_candidate` 返回 `repairable/empty_candidate`，无计划终态。代码中的 `construct_solid` 分支只拒绝手算顶点，其余直接返回 `accepted` 却**不调用任何几何构造/暂存动作**；`construct_face` 落入末尾默认 `accepted` 分支。`query_measurement` / `query_constraint_status` 也目前直接返回 `accepted`，不返回真实约束读数。模型因此接收到误导性的“成功”，继续花费请求，最终无法得到图。此问题属于**F2/F5产品接线缺口**；不能只扩大上限或放松合同。

## 停点与具体修复入口

1. **停止扩大付费范围**：本轮实际8/108次请求，剩余100请求并不意味着可以自动继续；在同一修订下再测必然重复浪费。费用实际金额未知，后续付费回归需先固定修复后 revision 并确认是否沿用剩余预算。
2. 零费先写RED：合法 `construct_solid` / `construct_face` 的 `SpeculativeCanvas.snapshot().primitiveCount > 0` 与 `finish_candidate` 成功；未知形状、缺必要参数、非法面环、退化点按 `repairable/blocked` 处理，**不得再虚报 accepted**。新增读工具测试要求 `query_measurement` / `query_constraint_status` 返回内核真实状态；无法提供时不发布。
3. 最小实现应复用 `packages/agent-core/src/solver/constraintSolve3d.ts`、`dsDrawingIntent.ts` 已有立体构造器及 `DraftStore`/动作注册表，不按题号造图。模型选择的参数必须有题设/推导依据；主画布、证书、CAS 和同候选哈希门禁不放宽。
4. F9 多状态/分支 live `PlannerPort` 路径仍只产 `shared` slice；下一次扩大到复杂题之前，必须零费证明 DS 动作结果可按 scope/state/branch 生成 CandidateSet 并通过 `evaluateFrozenCandidateSet`，不能用预造切片测试冒充真实 live 接线。
5. 修复后先零费 `ds_action` 正反例、真实浏览器隔离交付与类型/全量回归，再**一题**重试；一题经独立合同和证书通过方可进入下一层，冻结36题仍未开始。
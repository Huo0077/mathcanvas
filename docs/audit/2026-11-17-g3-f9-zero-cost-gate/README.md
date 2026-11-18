# F9 零费用接线门禁：暂停新一轮真实调用

- 当前修订 `0adc0c9fea610c35eba2b896b3ce709ba83c71ff`，工作区干净。用户重新确认“上限照旧”，本轮解释为最多5美元、整批最多108次、单题最多3次，单次输入≤80,000字节、输出≤4096 tokens。本检查**没有发出新的 DeepSeek API 请求，真实F9新架构成绩仍未测**。
- `npm.cmd exec -- vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts apps/web/src/agent/modelPlanner.test.ts --testTimeout=30000 --maxWorkers=2` 新鲜验证 3 文件/78项全部通过。

## 阻断一：动作级工具与单题3请求不匹配

`apps/web/src/agent/dsActionTools.test.ts` 的最小正例是 `construct_point(A)`、`construct_point(B)`、`construct_segment(AB)`、`finish_candidate`，明确需要**4次**模型响应。`apps/web/src/agent/modelPlanner.ts` 的 `ds_action` 分支在收到未结束动作后给模型反馈并发起下一请求；收到 `finish_candidate` 才产生最终计划。因此单题最多3次的既定预算不足以跑通这个已经通过单元测试的最小正例。不能靠静默增加单题请求、沿用旧 `ds_intent` 或把中间态当成功。

## 阻断二：实测入口与多状态验收尚未贯通

- `apps/web/src/agent/modelPlanner.ts` 缺省 `intentMode` 为 `legacy_actions`；必须在 F9 入口显式选择 `ds_action` 并记录实际发布/执行的工具名称。
- `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts` 的 `PlannerPort` 分支只从单份计划创建 `scopeId:"shared"` 的 slice；测试通过的 `CandidateSet` 多分支用例使用**预先构造好的 slices**，没有证明真实 DS 输出多个折叠状态/分支时会被生成并统一计分。不能用它冒充完整36题 F9 退出结果。

## 当前处理与待决策

零付费可继续实现/验证：①F9专用 `ds_action` 路由，逐动作结构化记录；②真实动作结果到 `CandidateSet` 的状态/分支接线；③与同一修订的证书和画布版本绑定；④按调整后的单题配额及总额做 fail-closed 熔断测试。仅有授权美元上限并不能替代可执行的单题配额；若仍坚持3次/题，需要另行设计在一次请求中合法完成多动作的**原子批次协议并测试**（当前代码对混合/多工具有安全限制），不是临时放宽闸门。本轮不新增付费调用，下一次先跑一题真实动作链，通过后再申请扩批。旧 `0adc0c9f` 记载的10次旧路由请求属于**上次误测**，本轮请求数为0，不合并。
# R09-A 最终接受产物计分证据（2026-11-15）

## 结论

R09-A 的实现已改为只按最终接受产物计分。早期轮次中的正确答案不能拯救最终被接受错误答案；被取消、失败、跨 run、哈希不符、类型不符或重复身份的产物均不计分。

## 实现

- 新增 `scripts/reliability-eval/finalOutcome.ts`：按 `runId + artifactId + contentHash + kind + terminal` 选择唯一最终产物。
- `awaiting_confirmation` 使用最后一个成功 stage 对应的 round；`completed` 使用最终回答。
- `canonicalContentHash` 绑定最终计划/答案内容；选择失败返回 `null`，不再回退到 `rounds.some(...)`。

## RED → GREEN

- RED：`finalOutcome.test.ts` 初次因模块不存在而失败，确认不是空测试或假通过。
- GREEN：4 项选择器测试通过，覆盖先对后错、先错后对、plan/answer 类型、取消、跨 run、错误哈希、重复身份、failed/waiting。
- `npm run typecheck` 通过。初次使用 `findLastIndex` 与项目 ES2022 目标不兼容，改为 `map(...).lastIndexOf(true)` 后通过。
- `npm run eval:reliability -- --offline`：3 项通过，生产评测路径可运行。
- 完整 `npm test -- --testTimeout=30000`：521 文件、5548 项通过、1 todo、0 失败。

## 边界

R09-A 只修复计分身份，不证明几何答案正确，也不等于 R09-B 的 schema/runtime 完整一致。旧报告与真实模型成绩未被重写，后续需要以新 metricVersion 重跑相应离线或经授权评测。

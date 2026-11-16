# P4 / T13 完整数学合同独立核验证书与变异拒绝矩阵证据

- **任务编号**：`T13`（P4 阶段，遵循 `implementation-task-ledger.json` DAG：`T01, T02, T05, T07, T08, T09, T10, T12 → T13`）
- **提交信息**：`feat(verification): certify complete contracts against final geometry`
- **日期**：2026-11-16
- **目标**：建立独立的数学核验证书与完成门禁，使“完整通过 / 部分核验 / 阻塞未通过”严格基于最终落地文档图元坐标、来源覆盖与实体绑定重算，彻底禁止采信构造器自报结论或空义务放行，并对缺失点、非有限坐标、曲线错绑、重复编号、旧证据哈希与漏条件变异一律阻断。

## 1. 交付内容

1. **完整数学核验证书与门禁模块**：
   - 新增 [`packages/agent-core/src/verification/drawingCertificate.ts`](../../../packages/agent-core/src/verification/drawingCertificate.ts)（经 [`packages/agent-core/src/index.ts`](../../../packages/agent-core/src/index.ts) 导出）：
     - `isDrawingRequestContract` 与 [`apps/web/src/agent/acceptance.ts`](../../../apps/web/src/agent/acceptance.ts) 的 `isDrawingPrompt`：严分作图请求与非作图闲聊问答，不因无几何条件误杀日常对话；
     - `evaluateMathGate`：强制拦截空必检集（`empty_required_contract`）、重复必检 ID（`duplicate_required_id`）、重复证据（`duplicate_evidence`）、非有限残差/坐标（`non_finite_evidence` / `non_finite_geometry`）、候选哈希不一致（`stale_candidate_binding`）、未覆盖源片段（`source_coverage_incomplete`）、必需实体缺失（`required_entity_missing`）以及任何非 `passed` 义务；
     - `certifyDrawingAgainstContract`：独立从 `document.primitives` 重算 `verifyDiagramObligations`、椭圆点残差（`conicResidualAt`）与函数曲线绑核（检测交换曲线），忽略不可信自报检查结果，区分 `passed` / `partial` / `blocked`，并在关闭完整证书开关时明确输出 `unverified`（`"未完整核验"`），不回退为旧 `passed`。
2. **门禁重复项与图元非有限数值防线**：
   - [`packages/agent-core/src/verification/completionGate.ts`](../../../packages/agent-core/src/verification/completionGate.ts)：新增重复检查编号拦截（`verification_self_inconsistent`）；
   - [`packages/agent-core/src/diagramVerification.ts`](../../../packages/agent-core/src/diagramVerification.ts)：在终态报告生成前全量扫描候选图元坐标字段，发现 `NaN`/`Infinity` 即追加 `non_finite_geometry` 失败项。
3. **合同覆盖与变异拒绝测试套件**：
   - 新建 [`packages/agent-core/src/verification/drawingCertificate.test.ts`](../../../packages/agent-core/src/verification/drawingCertificate.test.ts)（校验全部 36 题冻结合同 `cases` 结构完整、空/重 ID/NaN 拦截、闲聊豁免与回滚开关 `未完整核验`）；
   - 新建 [`packages/agent-core/src/verification/drawingMutation.test.ts`](../../../packages/agent-core/src/verification/drawingMutation.test.ts)（覆盖删点 `F₁`、篡改 `M` 脱离椭圆、注入 `NaN`、交换曲线 `f`/`g`、未覆盖源片段、把失败改写为 `unknown`、陈旧哈希拒收，以及添加无关辅助点不影响数学证书通过）。

## 2. RED → GREEN 与全量验证记录

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| RED（实现前） | `npm.cmd exec -- vitest run packages/agent-core/src/verification/drawingCertificate.test.ts packages/agent-core/src/verification/drawingMutation.test.ts --testTimeout=30000` | 按预期失败：`2 failed (2)`（`drawingCertificate` 模块尚未创建） |
| 定向 GREEN | `npm.cmd exec -- vitest run packages/agent-core/src/verification/drawingCertificate.test.ts packages/agent-core/src/verification/drawingMutation.test.ts packages/agent-core/src/verification/completionGate.test.ts --testTimeout=30000` | `3 passed (3) \| 16 passed (16)` |
| 全量 TypeScript 类型检查 | `npm.cmd run typecheck` | exit 0 |
| 全量 ESLint | `npm.cmd run lint` | exit 0（0 errors，33 pre-existing warnings） |
| Web 生产构建 | `npm.cmd run --workspace @draw/web build` | exit 0 |
| 离线评测 | `npm.cmd run eval:reliability -- --offline` | `1 passed (1) \| 3 passed (3)` |
| 全量 Vitest 套件（最终编辑后） | `npm.cmd test -- --testTimeout=30000` | `539 passed (539) \| 5701 passed \| 1 todo (5702)` |

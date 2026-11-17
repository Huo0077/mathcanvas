# DS3：生产证书双向真伪闭环与 `validating` 阶段有界修复

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（双向证书假阳性/假阴性修复、有界验证修复环、离线/回放 36 题契约与 31 题协调器冒烟全过）

## 1. 根因定位与交付产物

1. **修复生产证书假阳性放行（`GK-P09` `obCov=0.00`、`JT-P09` `obCov=0.23`）**：
   - 堵死 [draftStore.ts](../../../apps/web/src/agent/draftStore.ts) 的空题面旁路：`checked` 不再只依赖 `planHasVerifiableFigure` 白名单（当题面含可解析数学义务或非参数化数学/函数/切线/圆锥曲线特征时照常跑 `parseObligationWithLegacy` + `verifyDiagramObligations` + 真实 `effectivePrompt` 证书校验），同时保留纯参数操作 `parameter.create` 与无题设交互指令（如 `"画一个点"`、`"画一个立方体"`）原语义。
   - 在 [drawingCertificate.ts](../../../packages/agent-core/src/verification/drawingCertificate.ts) 补齐结构化生产诊断产出 `candidateHash`、`failedObligations`、`missingEntities`、`unresolvedClauses`，并增加未消费函数切线检查与“过点 P 的最长弦和最短弦分别是 XY 和 ZW”圆内垂直共点直径几何核验（缺失实体或几何不垂直/不过圆心直接判 `blocked`）。
2. **修复生产验证假阴性（`JT-S07`、`JT-S09` `object=1, obligation=1` 却报 `not_supported`）**：
   - [diagramObligations.ts](../../../packages/agent-core/src/diagramObligations.ts) `parseDiagramScope` 在 `partStart === undefined` 分支补齐 `（1）求... / （2）求...` 纯求解问句截断，避免 `JT-S07` 的 `（2）求二面角 A-CD-E 的余弦值` 渗入已知条件落成 `unparsed`。
   - [diagramVerification.ts](../../../packages/agent-core/src/diagramVerification.ts) 支持缺省动作清单 `neutralPlan`（`actions.length === 0`）直接检测 `function` / `circle` / `cube` / `sphere` / `polyhedron3`，并新增 `candidatePrismOrCube` 与 `solidPrismShape` 对 `cube` 及与球体共存正方体场景（`JT-S09`）的形状核验。
3. **打通 `coordinator.ts` 有界 `validating -> repair` 修复环（消除 `req=1` 验证即死）**：
   - 在 [contracts.ts](../../../packages/agent-core/src/contracts.ts) 新增 `MAX_VALIDATION_REPAIR_ATTEMPTS = 2`，在 [runState.ts](../../../packages/agent-core/src/runState.ts) 开放 `validating -> planning` 转移，并在 [coordinatorPorts.ts](../../../packages/agent-core/src/coordinatorPorts.ts) 与 [committerAdapter.ts](../../../packages/agent-core/src/committerAdapter.ts) 新增 `replaceDraft?: boolean` 以丢弃未展示的失败候选草稿、在修复轮从干净基线文档重新完整核验（避免触发 `staleEarlierObligations`）。
   - 在 [coordinator.ts](../../../packages/agent-core/src/coordinator.ts) 接入受 `repairTracker`（停滞/无进展即停）、预算及 `acceptance:none` 守卫制约的 `validating -> repair` 环，仅回传合法生产失败义务与提示，未获用户确认仍 `0` 写入主画布。

## 2. 验证结果

- `npm.cmd exec -- vitest run planarContracts18.test.ts solidContracts18.test.ts drawingCertificate.test.ts draftStore.test.ts coordinator.test.ts diagramObligations.test.ts diagramVerification.test.ts runState.test.ts committerAdapter.test.ts agentRunner.test.ts dsDrawingIntent.test.ts --testTimeout=30000`：**`11` 文件 / `438 passed (438)`**：
  - [drawingCertificate.test.ts](../../../packages/agent-core/src/verification/drawingCertificate.test.ts)（`8/8`）：覆盖 `GK-P09` 错表达式/缺切线阻断、`JT-P09` 缺圆 `M` 与未核验弦长阻断、`JT-S07` 合法五面体+中点通过、`JT-S09` 合法正方体+半球通过，以及篡改候选哈希与几何导致旧证书失效；
  - [draftStore.test.ts](../../../apps/web/src/agent/draftStore.test.ts)（`27/27`）：验证生产通道禁止 `prompt: ""` 旁路与漏句放行；
  - [coordinator.test.ts](../../../packages/agent-core/src/coordinator.test.ts)（`53/53`）：验证 `validating` 失败触发有界修复并带 `replaceDraft: true` 重验全题后进入 `awaiting_confirmation`（`commit` 未调用）、同一约束/哈希停滞立即停机、`acceptance:none` 不盲目重问；
  - [planarContracts18.test.ts](../../../scripts/reliability-eval/planarContracts18.test.ts)（`23/23`）与 [solidContracts18.test.ts](../../../scripts/reliability-eval/solidContracts18.test.ts)（`23/23`）：离线回放 36 题合同与生产证书全过；
  - [agentRunner.test.ts](../../../apps/web/src/agent/agentRunner.test.ts)（`71/71`）、[diagramObligations.test.ts](../../../packages/agent-core/src/diagramObligations.test.ts)（`109/109`）、[diagramVerification.test.ts](../../../packages/agent-core/src/diagramVerification.test.ts)（`70/70`）、[runState.test.ts](../../../packages/agent-core/src/runState.test.ts)（`27/27`）、[committerAdapter.test.ts](../../../packages/agent-core/src/committerAdapter.test.ts)（`20/20`）、[dsDrawingIntent.test.ts](../../../packages/agent-core/src/dsDrawingIntent.test.ts)（`7/7`）全过。
- `npm.cmd run eval:reliability -- --offline`：`31/31 passed`（对象与义务平均覆盖率 `1`，未变更前运行；随后针对 `coordinator`/`drawingCertificate` 收敛后再以 36 题定向契约 + 438 项全数通过验毕）。
- `npm.cmd run typecheck`：exit `0`
- `npm.cmd run lint`：exit `0`（`0 errors`，`34 warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：`8` 文件 / **`22 passed`**

## 3. 边界与下一步

- 本区块**0 新增付费 API 调用**，36 题与 31 题结构化回放通过**不计入 `DS live pass`**（最近一次 DS 实测仍保持 `2/36`）。
- 下一步进入 **`DS4`**（导出零费用可复播 `ds-candidate-bundle` 工件、补齐同 `{runId,candidateHash,documentHash,cameraHash,viewportHash}` 真实浏览器渲染与隔离工作区确认/撤销/重载/防迟到写入 E2E）。

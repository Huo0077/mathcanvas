# G3-DS Failure-Driven Task 5 审计记录：同版候选浏览器渲染与隔离受控交付门禁（零付费桥接）

> **边界声明（强制）**：本批次 **Task 5 零新增付费 DeepSeek API 调用**。浏览器 36 题渲染包与隔离受控交付回归均运行于确定性回放 / 离线桥接模式下；当前最新真实 DeepSeek 36 题完整数学合同成绩仍为 `0/36`（[2026-11-17-g3-ds5-live-36](../2026-11-17-g3-ds5-live-36/README.md)），`manifest.json` 的 `dsRenderGateStatus` 严格标为 `"bridge_replay_passed"`（绝不标为 `"dsLiveRendered"`），且 `humanReviewed.status` 与 `agent_visual_review.status` 均保持 `"pending"`。真实 **Task 6**（Live 预检 + 36 题在线复测）必须先获用户显式授权（模型名、测试范围、请求数/token/费用上限、连续失败熔断阈值）后方可启动。

## 1. 本轮改动与实现核对

1. **包级同版哈希链与分类门禁（[dsCandidateBundle.ts](../../../packages/agent-core/src/dsCandidateBundle.ts) & [dsCandidateBundle.test.ts](../../../packages/agent-core/src/dsCandidateBundle.test.ts)）**
   - 新增 `DsRenderDeliveryClassification = "dsLiveRendered" | "bridge_replay_passed" | "blocked"` 与 `BundleRenderDeliveryObservation` 扩展字段：`traceCandidateHash`（绑定 `G3CaseTrace` 候选哈希与 DOM `data-candidate-hash`）、`previousCameraHash`、`cameraMoved`、`mainCanvasWritesBeforeConfirm`。
   - `verifyBundleRenderAndDelivery` 新增阻断器：
     - `trace_candidate_hash_mismatch`：拦截追溯对象 `G3CaseTrace.candidateHash` 与当前包 / DOM `data-candidate-hash` 不一致；
     - `stale_camera_hash_after_orbit`：3D 视角移动后仍复用旧 `cameraHash` 时直接阻断；
     - `unconfirmed_write_to_main_canvas`：确认提交前写入主画布次数非零时直接阻断；
     - 仅当 `passed && bundleKind === "live_authorized" && provenance.dsInvoked && provenance.isLiveAuthorized` 时才允许分类为 `"dsLiveRendered"`，否则合成回放 / 离线桥接一律分类为 `"bridge_replay_passed"`，`humanReviewed` 固定保持 `"pending"`。
2. **浏览器 36 题渲染包与 3D 视角哈希校验（[drawing-reliability-36-render.spec.ts](../../../e2e/drawing-reliability-36-render.spec.ts)）**
   - `eval-results/g3-render-36/manifest.json` 明确写出 `"dsRenderGateStatus": "bridge_replay_passed"`、`"dsLiveAuthorizedRun": { "status": "pending_authorization", ... }` 及 `"humanReviewed": { "status": "pending", ... }`，保留单题诊断警告（如 `clipped_object`）。
   - 新增 E2E 用例 `Task 5 3D camera movement updates cameraHash and prevents reusing stale pre-orbit camera/screenshot hashes`：验证 3D 立体题目在 `geometry3d` 工作区提交后，拖拽 WebGL `<canvas>` 轨道视角会实时刷新 `[data-3d-scene="true"]` 上的 `data-camera-hash`（禁止复用拖拽前预存相机/截图哈希）。
3. **隔离工作区受控交付与撤销闭环（[drawing-reliability-lifecycle.spec.ts](../../../e2e/drawing-reliability-lifecycle.spec.ts)）**
   - 在 `DS4 controlled delivery` 用例中补全回退到主画布后的 `撤销` -> `重做` 哈希链断言及跨刷新持久化一致性校验。

## 2. 实测验证结果（最终代码编辑后全量复核）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| Task 5 包级门禁单测 | `npm.cmd exec -- vitest run packages/agent-core/src/dsCandidateBundle.test.ts --testTimeout=30000` | `1 passed (1)` / `3 passed (3)` |
| Task 5 Playwright E2E（0 重试） | `npm.cmd exec -- playwright test e2e/drawing-reliability-36-render.spec.ts e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0` | **`41 passed`**（含 36 题渲染包 + `DS4` 负向守卫 + `Task 5` 3D 相机哈希 + 3 条生命周期用例） |
| 全仓 TypeScript 类型检查 | `npm.cmd run typecheck` | exit `0` |
| 全仓 ESLint 检查 | `npm.cmd run lint` | exit `0`（`0 errors, 34 warnings`） |
| 全仓 Vitest 单元测试 | `npm.cmd test -- --testTimeout=30000` | **`550 passed (550)` / `5847 passed | 1 todo (5848)`** |
| 桌面端 Rust 测试集 | `npm.cmd run test:rust` | exit `0`（全部通过；`secrets::the_windows_backend_really_stores_and_deletes_a_credential` 为 Windows 凭据库显式手动项，按基线 `ignored`） |

## 3. 门禁状态与下一步

- **G3-DS Failure-Driven Task 0–Task 5 已全部落地并验证（0 新增付费 DS 调用）**。
- **停机等待边界**：下一步为 **Task 6（真实 DeepSeek 最小预检 + 冻结 36 题在线复测与四层漏斗诊断 + 人工/桌面实机验收排期）**，按计划红线在获得用户新的明确付费授权前**不发起任何在线模型请求**。

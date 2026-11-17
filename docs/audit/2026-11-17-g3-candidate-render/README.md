# G3 真实候选渲染与确认链子区块证据

- **日期**：2026-11-17
- **范围**：Task 5 / T15 续作；修复真实候选预览、3D 对象测量、候选绑定的 consent/commit 取证。
- **不在本区块**：36 题逐题截图/联系表、用户或教师 `humanReviewed`、Windows 桌面实机 UIA、DeepSeek 实测、P8。

## 实核缺口与 RED

1. `drawing-reliability-render.spec.ts` 新增确认前 2D 用例：真实返回画布后，旧实现 `[data-primitive-type="ellipse"]` 为 0，证明 Ghost 只画了少数简单图元且证据仍绑在基础文档。
2. 既有 3D 用例旧断言接受 `partial / objectsMeasurable=false`，与 G3 计划“不得以不可测充当通过”冲突；改为要求 `passed / true` 后实测失败。
3. `candidateRenderEvidence.test.ts` 在实现前因 `candidateRenderEvidenceFromCanvas is not a function` 失败，随后锁定同版盒子、截图、错误 hash 与 `partial` 拒收。
4. 生产改接真实候选后，完整 Vitest 初跑出现 3 文件 / 32 项失败，均来自没有画布的运行时测试边界；以测试端口替换外部画布后，真实 DraftStore / HostBridge / commit 逻辑的 76 项受影响测试全部通过。未给生产保留 `structuredOnly` 旁路。
5. 生命周期双击初跑未提交。实核诊断显示 remembered camera 跳过初次取景，窄画幅下对象实际出界（`clipped_object`）；只对初始已出界内容补一次自动取景后，两条生命周期均通过。

## 实现

- `GraphicsView.tsx`：草稿预览期间渲染完整候选，测量、标注与内容 hash 均绑定候选；保留现有 Ghost 标识并禁止预览画布写交互。
- `App.tsx` / `workspace-layout.css`：Agent 页在存在草稿时并排挂载同一真实候选画布，传统画布路径保持不变。
- `threeSceneRender.ts`：从 Three.js 实际对象投影布局盒子，同帧发布相机 hash；`threeSceneCamera.ts` 修复 remembered camera 的初始出界。
- `canvasEvidence.ts`：合并渲染器对象与 DOM 标签，发布视口、盒子、诊断和相机绑定；不可测仍只能是 `partial`。
- `renderLayoutInput.ts` / `agentRunner.ts`：consent/commit 读取当前真实画布的 `rendered` 证据与截图；hash、状态或证据形状不匹配均 fail-closed。
- `renderEvidence.ts`：增加 `mode: "rendered"`，继续与 `structuredOnly`、`humanReviewed` 分层。

## 最终验证

- 定向 Vitest：真实画布/证据 4 文件 **42/42**；受影响 runner/证明测试 3 文件 **76/76**。
- 完整 Vitest：`npm.cmd test -- --testTimeout=30000`，**544 文件 / 5796 passed + 1 todo / 0 failed**。
- 类型检查：`npm.cmd run typecheck`，exit 0。
- Lint：`npm.cmd run lint`，**0 errors**（34 条既有 warnings）。
- Web 构建：`npm.cmd run --workspace @draw/web build`，exit 0，643 modules。
- Playwright：`npm.cmd exec -- playwright test e2e/drawing-reliability-render.spec.ts e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0`，**5/5 passed**，含 2D 确认前完整候选、3D 对象测量、双击一次提交、撤销/重做/保存重载与绑定拖动。

## 边界

本区块不新增数学通过声明，不把 AI 看图写成人工签收，也不把浏览器证据写成 Windows 桌面证据。下一区块为冻结 36 题的同候选截图、索引、四族联系表和 `agent_visual_review`；用户/教师签收另留空位。

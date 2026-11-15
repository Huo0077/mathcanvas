# R08 证据摘要：E2E 与生产 UI / 合同重新对齐

## 审计发现与失败分类矩阵

本工作包针对基线审查记录的全量 Playwright 失败（`235 passed / 46 failed`、`232 passed / 49 failed` 与定向 `10 passed / 3 failed`）逐类分诊，严格区分**真实生产缺陷**、**架构演进导致的设计契约更新**与**旧版交互选择器漂移**，不在不核实的情况下篡改或放宽断言，不添加静默重试。

| 类别 | 涉及范围 | 根因与决策 | 处理结果 |
| --- | --- | --- | --- |
| 真实生产缺陷 | `parametricSolidPlan.ts`、`planCompiler.ts` | 定长参数化立体路由丢失 `外接球` / `内切球` 派生动作，且 `derived.create_circumsphere` 缺少来自内核计算结果的结构化披露 | 修复 `tryBuildParametricSolidPlan` 追加派生球动作；在 `compilePlanOnce` 新增 `derivedCircumsphereAssumptions` 动态输出球心等距与半径 `r=...` 披露 |
| 真实生产缺陷 | `apps/web/src/styles/workspace-layout.css` | `.clean-chrome` `z-index: 20` 低于画布内悬浮提示条 `.canvas-draft-banner`（`z-index: 50`）与 `.guidance-hint`（`z-index: 40`），导致存在 AI 草稿预览时 `更多工具` 下拉菜单项被遮挡拦截 | 将 `.clean-chrome` `z-index` 提升至 `100`（仍低于模态对话框 `1200/1210`） |
| 确定性路由与 R01-A 边界 | `rightPrismPlan.ts`、`deterministicProblemRoute.ts` | 带第 `(2)` 问选问约束的直三棱柱中点问题原先直接落入一般规划或因残留 `(1)`/`(2)` 标记被 R01-A 误拦截 | 新增 `tryBuildRightPrismMidpointsPlan` 返回 `{ plan, diagramPrompt }`，按既有 `scopedPyramidPlan` 口径剥离题号并写入 `草稿按第（2）问的条件构造。` 披露，保持 `diagramObligations.ts` R01-A 守卫不放宽 |
| 设计契约对齐 | `e2e/ribbon-ui.spec.ts` | 桌面检查器默认宽度常量已按布局调整为 `DEFAULT_INSPECTOR_WIDTH = 310`；`WorkspaceTabs.tsx` 仅作历史测试兼容保留，未挂载于 `App.tsx` | 更新 `ribbon-ui.spec.ts` 1440px 检查器宽度契约为 `308..312`，并在本证据记录 `WorkspaceTabs` legacy-compat 边界 |
| 设计契约对齐 | `e2e/three-grid-fade.spec.ts`、`e2e/geometry3d-camera-memory.spec.ts` | 3D 网格采用 `LineBasicMaterial` + `data-grid-extent` / `data-grid-ground-reach` 扩展覆盖；在画布正中拖动会直接命中位于原点的顶点 `A` / 立方体角点而触发直抓点移动而非旋转视角 | `three-grid-fade.spec.ts` 对齐 `LineBasicMaterial` 与零 WebGL Shader 错误契约；两份用例均改为在画布空白背景坐标处拖动旋转相机 |
| 几何顺序与 UI 导航对齐 | `e2e/pages/MathCanvasPage.ts` 及 24 份 `e2e/*.spec.ts` | `ModuleRail` 设置入口改为 `模型服务`（高级开关收口于 `设置分类: 高级` → `<details>实验性功能</details>`）；工具栏由旧 `Ribbon` / `固定功能区` 迁移为 `AppChrome`（`绘图工具`、`更多工具`、`文件` 与顶栏 `保存 .mgeo`）；3D 显示控制收口于 `视图选项`；Agent 空状态文案为 `把数学想法，画出来。`；属性栏标题为 `属性`；`witnessSearch` 顶点生成序可为 `[A,B,C,D,P]` | 抽取共享 `MathCanvasPage` Page Object；`agent-derived-sphere.spec.ts` 按 `byIndexLabels` 查找顶点并拖动顶点 `P`（保持矩形底面共圆）；清理全部过期定位器与旧选择器 |

## 关键文件与变更清单

- **核心与样式**：
  - [parametricSolidPlan.ts](../../../../packages/agent-core/src/parametricSolidPlan.ts)、[planCompiler.ts](../../../../packages/agent-core/src/planCompiler.ts)、[rightPrismPlan.ts](../../../../packages/agent-core/src/rightPrismPlan.ts)、[deterministicProblemRoute.ts](../../../../packages/agent-core/src/deterministicProblemRoute.ts)
  - [workspace-layout.css](../../../../apps/web/src/styles/workspace-layout.css)
- **单元/集成回归新增**：
  - [parametricSolidPlan.test.ts](../../../../packages/agent-core/src/parametricSolidPlan.test.ts)、[planCompiler.test.ts](../../../../packages/agent-core/src/planCompiler.test.ts)、[agentRuntime.test.ts](../../../../apps/web/src/agent/agentRuntime.test.ts)
- **E2E 页面对象与规格对齐**：
  - 新建 [MathCanvasPage.ts](../../../../e2e/pages/MathCanvasPage.ts)
  - 更新 `e2e/next-phase-flag-entry.spec.ts`、10 份 `e2e/agent-*.spec.ts`（`apex-angle` / `base-angle` / `derived-sphere` / `diagram-free-apex` / `exam-triangle` / `exam-visual-and-stale` / `oblique-prism-from-sentence` / `prism-path` / `proof-lifecycle` / `rhombus-base` / `solid-family-path`）、`e2e/app-modules.spec.ts`、`e2e/conversation-isolation.spec.ts`、`e2e/exact-forms.spec.ts`、`e2e/geometry3d-camera-memory.spec.ts`、`e2e/geometry3d-section.spec.ts`、`e2e/geometry3d.spec.ts`、`e2e/high-school-geometry-tasks.spec.ts`、`e2e/measurement-labels.spec.ts`、`e2e/ribbon-ui.spec.ts`、`e2e/solid-prism.spec.ts`、`e2e/three-grid-fade.spec.ts`、`e2e/workbench.spec.ts`

## 验证实证（均于最终改动后实测）

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 派生球与规划回归 | `npx vitest run packages/agent-core/src/parametricSolidPlan.test.ts packages/agent-core/src/planCompiler.test.ts` 与 `apps/web/src/agent/agentRuntime.test.ts` | `114 passed`、`90 passed` |
| 全量串行 E2E | `npx playwright test --workers=1 --retries=0 --reporter=line` | **286 passed (13.4m), 0 failed, 0 retries** |
| 默认并发 E2E | `npm.cmd run test:e2e -- --reporter=line`（`fullyParallel: true`，本机 16 workers，`retries=0`） | **282 passed, 4 failed (4.2m)**：4 项均为 16 路并发 Chromium/WebGL 争用下的 5s/30s 超时（`agent-flow.spec.ts:34`、`agent-exam-conic.spec.ts:121`、`high-school-geometry-tasks.spec.ts:309`、`workspace-persistence.spec.ts:55`），串行模式已确认 4 项均稳定通过，未篡改超时或开启静默重试 |
| 完整 Vitest | `npm.cmd test -- --testTimeout=30000` | **524 文件 / 5580 passed \| 1 todo (5581)**，0 failed |
| 类型检查 | `npm.cmd run typecheck` | 通过（全部 workspace + `e2e` + `scripts`） |
| 代码规范 | `npm.cmd run lint` | 通过（0 errors，32 既有 unused 警告） |
| Web 构建 | `npm.cmd run build --workspace @draw/web` | 通过（634 modules） |

## 边界与回滚

- **Legacy-compat 说明**：`apps/web/src/components/WorkspaceTabs.tsx` 仅由单元兼容测试 `WorkspaceTabs.test.tsx` 引用，生产入口已由 `AppChrome.tsx` 接管，未强行删除以免破坏历史组件单测，也不将其计作活动 Chrome。
- **并发与离线范围**：并发运行在 16-worker 高负载下存在 4 条时间敏感用例超时；`R08` 不修改 `playwright.config.ts` 的 `retries: 0` 纪律。
- **回滚**：可对 `R08` 提交执行 `git revert`；注意保留 `.clean-chrome` stacking context 与 `parametricSolidPlan` 外接球派生逻辑。

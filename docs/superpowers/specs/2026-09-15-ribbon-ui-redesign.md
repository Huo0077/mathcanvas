# MathCanvas Ribbon UI Redesign

**Date:** 2026-09-15
**Status:** Shared Ribbon baseline implemented and verified (2026-09-16); the 2026-09-16 follow-ups (Task 7-14, then the Task 15-18 CAD usability fixes recorded in `docs/superpowers/plans/2026-09-15-engineering-workbench-hierarchy.md`) are also implemented and verified. Reviewed 2026-09-17: the constraint and agent panels were removed from the right column at the user's request (their data model is untouched), and the planar canvas grid is now a fixed one-world-unit grid. Unrelated planned UI work remains planned.

## Goal

将 MathCanvas 三个工作区统一为经典桌面工具界面：顶部使用 Word 风格的可折叠 Ribbon，中间保持画布优先，左右面板承担对象导航与上下文属性编辑，底部状态栏解释当前工具和操作步骤。

## Product Decisions

- 新打开应用默认进入“平面几何”；界面名称由“圆锥曲线”改为“平面几何”，内部 `conics` workspace ID 保持不变，避免文档迁移。
- 顶部不再显示漂浮式工作区胶囊按钮；工作区入口只出现在第二层 Tab Bar。
- 现有几何数据、Scene Graph 操作、投影计算和导出能力保持不变；本次只重构界面组合和 UI 状态管理。
- 不引入新的 UI 依赖，继续使用 React、TypeScript、CSS variables、SVG 和现有图标体系。
- 平面几何和工程制图中的新点依次使用 `A`、`B`、`C` 等标签；3D 点沿用已有字母标签并在场景中可见。
- 所有可编辑图元都能从选中对象的默认属性区域重命名；名称变更继续通过现有 Scene Store 更新和文档持久化路径完成。
- 多模态功能区只保留“文字转换”和“图片转换”两个入口；当前没有转换服务，两项保持禁用并说明能力尚未接入。
- 右侧属性区不再展示约束 UI 或智能体面板；已有的真实测量操作保留在图元数据属性中，不与约束入口混放。

## Layout

### Global Shell

`AppShell` 使用纵向 Flexbox，并将可视区域限制为 `100vh`：

1. `Top Bar`：约 40px，包含 MathCanvas Logo、绿色模型状态、居中搜索框、打开/保存、撤销/重做、设置和头像。
2. `Tab Bar`：约 32px，包含文件、平面几何、立体几何、工程制图；右侧包含 Ribbon 展开/收起和图钉控制。
3. `Ribbon Body`：展开时约 80px，按命令组排列并用细分割线区分；收起时高度为 0。
4. `Workspace Body`：剩余高度，包含左侧导航、中间画布和右侧 Inspector。
5. `Status Bar`：固定在工作区底部，显示工具名称、创建阶段、单位、比例和诊断信息。

页面主体禁止因右侧面板内容增长而撑高；左右面板独立纵向滚动，中间画布按页面需要滚动。

### Ribbon

统一命令组包括：

- 基础图元：选择、点、直线、线段、射线、折线、圆、圆弧、抛物线、椭圆、双曲线、函数。
- 多模态输入：文字转换、图片转换。服务尚未接入时显示为明确禁用状态，不创建虚假的转换流程。
- 作业操作：删除对象、锁定对象。
- 文件输出：SVG、CSV、PNG。

每个工作区可以隐藏不适用命令或替换为上下文命令，但命令组位置和按钮视觉保持一致。Ribbon 的展开状态、当前 Tab 和临时悬浮状态属于 UI 状态，不写入 `.mgeo`。

折叠时支持 `Ctrl + F1`；点击任意 Tab 可临时悬浮打开 Ribbon，选择命令或点击外部区域后关闭。所有按钮保持键盘可达，并有文字或 `aria-label`。

### Inspector

右侧宽度固定在 `288–300px`，内部设置最大高度和独立滚动。无选中对象时只显示居中的引导图标、标题“未选择任何图元”和简短副标题；不显示 Agent 入口、约束内容或斜率、动画播放器等对象专属控件。

有选中对象时显示对象名称和锁定/删除快捷操作；名称输入应在默认可见的属性区域中，不要求先切换到外观页签。属性分区如下：

- 几何参数：默认展开，只显示当前对象的核心属性。
- 外观样式：默认收起，显示描边、线宽和线型。
- 约束：从通用属性手风琴和 CAD 属性页签中移除；保留既有文档中的约束数据，不执行数据迁移或删除。
- 测量：保留现有真实测量入口；符合条件时显示在图元数据属性区域，尤其支持选择两个面后创建二面角内角或外角测量。
- 动效演示：默认收起，显示播放/暂停和循环模式。

现有 PropertiesBar 的字段更新回调继续作为唯一数据写入入口，Inspector 只负责组合和展示上下文。属性区不挂载 AgentDock。

### Status Bar

状态提示由 `activeTool`、`creationStep`、当前选中对象、工作区和 3D 场景控制状态派生，不使用静态长说明。创建工具按步骤显示可执行动作；3D 法向量开关说明其显示效果，二面角演示开关明确区分示例读数与选择两个面后创建的真实测量，并指向属性数据区的测量操作。

## Cross-Page Migration

- `WorkspaceHeader` 拆分为共享 `AppShell`、`TopBar` 和 `WorkspaceTabs`，消除顶部与工作区内部的重复导航。
- `CommandBar` 迁移为共享 `Ribbon`，平面几何、立体几何和工程制图通过命令配置提供上下文命令。
- `EngineeringWorkbench` 继续复用三栏插槽，但由全局壳层统一承载；其工程制图投影视口和图层/图纸树不改变数据接口。
- `GeometryToolbar` 的平面与立体命令迁移到 Ribbon，保留原有创建回调和禁用原因。
- `PropertiesBar` 通过 `Inspector` 的 section 配置复用到三个工作区，避免复制几何编辑逻辑。
- 新增或整理的 UI 状态集中在 UI 层：Ribbon 展开状态、激活 Tab、Inspector section、当前工具和创建阶段；Scene Store 继续只管理文档、撤销和领域错误。
- `EngineeringWorkbench` 根据左右 Dock 开关状态调整网格列，让收起的侧栏空间归还给中间工程画布。
- `ThreeSceneView` 在独立的无交互标签层投影点名，并通过状态提示回调报告法向量和二面角控件状态。

## Responsive and Accessibility

- `375px`：Ribbon 组可横向滚动，左右面板变为可标记抽屉，画布保持可操作。
- `768px`：保留紧凑三栏布局，Ribbon 允许组内换行。
- `1024px` 及以上：使用完整三栏和固定 Inspector。
- 所有交互目标最小 44px，键盘焦点清晰，图标按钮有可读名称，折叠动画遵守 `prefers-reduced-motion`。
- 颜色、间距、边框、焦点环和面板宽度统一使用设计 Token；不在组件内散落新的视觉常量。

## Acceptance Criteria

1. 顶部只出现一套 Logo、搜索框、文件/历史操作和工作区入口；平面工作区标签显示“平面几何”，内部 workspace ID 不变。
2. Ribbon 可通过按钮和 `Ctrl + F1` 展开/收起，折叠时不占布局高度，悬浮呼出可关闭。
3. 三个工作区共享 Ribbon 结构，同时保留各自有效的创建、编辑和导出能力。
4. 右侧 Inspector 在无选中和有选中状态下均不撑破 `100vh`；侧栏不展示约束或 Agent 内容，名称编辑可用，已有测量能力仍可访问。
5. 平面和 3D 新点名称按字母序生成并显示在画布中；所有选中图元可重命名。
6. 底部状态栏能覆盖平面工具步骤，以及 3D 法向量和二面角控件的操作提示；示例读数不会被表述为真实几何测量。
7. CAD 收起任一侧栏后中间画布自动扩展；重新展开侧栏后恢复三栏布局。
8. 多模态入口恰为“文字转换”和“图片转换”，未接入服务时保持禁用并显示明确原因。
9. 现有单元测试、类型检查、构建和 Playwright 流程保持通过，并新增 Ribbon、属性、点标签、响应式和跨工作区 E2E 覆盖。

## Out of Scope

- 不改变 Geometry DSL、几何算法、投影算法或导出文件格式。
- 不新增文字/图片识别或转换后端、OCR、云端搜索、账号系统或画笔识别算法；本次仅整理转换入口并说明未接入状态。
- 不在本次改造中引入完整主题编辑器或第三方组件库。

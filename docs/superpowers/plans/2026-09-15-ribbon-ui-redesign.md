# MathCanvas Ribbon UI Redesign Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current session. Do not use subagent agents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MathCanvas 三个工作区统一为 40px Top Bar、32px Tab Bar、可折叠 Ribbon、100vh 三栏工作区、上下文 Inspector 和动态状态栏，并完成 2026-09-16 复核提出的命名、面板、工程画布及 3D 引导优化。

**Architecture:** 保留现有 Scene Store、Geometry DSL、PropertiesBar 字段回调和工程制图数据流，在 Web 层增加共享 App Chrome 与可配置 Ribbon。工具选择、Ribbon 展开、Inspector 手风琴和创建步骤属于 UI 状态；文档、撤销和领域错误继续由现有 store 管理。

**Tech Stack:** React 19, TypeScript, Vite, CSS variables, SVG, Vitest, Testing Library, Playwright。

**Spec:** `docs/superpowers/specs/2026-09-15-ribbon-ui-redesign.md`

## Global Constraints

- 新打开应用默认进入“平面几何”；该显示名称映射到现有 `conics` workspace ID，不迁移 `.mgeo` 数据。
- 顶部不再显示漂浮式工作区胶囊按钮；工作区入口只出现在第二层 Tab Bar。
- 现有几何数据、Scene Graph 操作、投影计算和导出能力保持不变；本次只重构界面组合和 UI 状态管理。
- 不引入新的 UI 依赖，继续使用 React、TypeScript、CSS variables、SVG 和现有图标体系。
- `AppShell` 使用纵向 Flexbox，并将可视区域限制为 `100vh`；左右面板独立纵向滚动，中间画布按页面需要滚动。
- 右侧宽度固定在 `288–300px`；不显示约束 UI 或 Agent 面板；真实 3D 测量操作仍可从图元数据属性访问。
- 所有交互目标最小 44px，键盘焦点清晰，图标按钮有可读名称，折叠动画遵守 `prefers-reduced-motion`。
- 平面及工程图中新建点按 `A`、`B`、`C` 顺序命名，3D 点名投影到画布；支持从默认可见的属性区重命名任意选中图元。
- 多模态组仅包含“文字转换”和“图片转换”；由于项目没有转换后端，入口保持禁用并给出准确原因。
- 不改变 Geometry DSL、几何算法、投影算法或导出文件格式；不新增账号系统、云端搜索、文字/图片转换后端或第三方组件库。

## File Map

- `apps/web/src/components/WorkspaceHeader.tsx`：仅负责 Top Bar 的品牌、状态、搜索和系统操作。
- `apps/web/src/components/AppChrome.tsx`：组合 Top Bar、工作区 Tab 和 Ribbon，提供共享页面壳层。
- `apps/web/src/components/Ribbon.tsx`：渲染可折叠、可悬浮的命令功能区。
- `apps/web/src/components/WorkspaceTabs.tsx`：渲染文件/工作区 Tab 及展开、图钉控制。
- `apps/web/src/ribbonCommands.ts`：按工作区生成 Ribbon 命令组，不包含几何算法。
- `apps/web/src/uiState.ts`：集中定义 Ribbon、Inspector 和工具步骤的 UI 状态类型及派生提示。
- `apps/web/src/components/EngineeringInspector.tsx`：组合空状态、对象头部和 Inspector sections。
- `apps/web/src/components/StatusBar.tsx`：渲染当前工具和创建阶段的动态提示。
- `apps/web/src/threeScene.tsx`：渲染 3D 点标签，并向 App 报告法向量/二面角控件状态。
- `apps/web/src/styles/tokens.css`、`apps/web/src/styles/global.css`：统一尺寸、颜色、滚动和响应式规则。
- `apps/web/src/App.tsx`：连接共享壳层、工作区命令配置、既有业务回调和 UI 状态。
- 对应 `*.test.tsx` 与 `e2e/*.spec.ts`：覆盖行为、键盘、响应式和跨页面迁移。

---

## Follow-up Scope (2026-09-16, completed)

本节补充已实施 Ribbon 基线之上的后续改动。Task 7-13 已于 2026-09-16 实现并通过完整验证，复选框据此勾选。所有改动在单个工作区内完成，未使用子代代理，未覆盖已有未提交改动；提交或推送仍需用户明确要求。

### Task 7: Rename the Planar Workspace and Improve Primitive Naming

**Files:**
- Modify: `apps/web/src/components/WorkspaceTabs.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Test: `apps/web/src/components/AppChrome.test.tsx`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Keep the `conics` workspace ID and document format; change only its visible label to “平面几何”.
- Keep `onUpdatePrimitive({ label })` as the one rename write path; make the name field available in the selected-object data area instead of requiring the appearance tab.
- `nextPointLabel(document)` assigns unused labels `A` through `Z`, then `P27`, `P28`, and onward; never change labels on existing documents.

- [x] **Step 1: Add failing workspace and rename tests**

```tsx
it("shows 平面几何 while keeping the conics workspace selected", () => {
  render(<AppChrome {...chromeProps} activeWorkspace="conics" />)
  expect(screen.getByRole("button", { name: "平面几何" })).toHaveAttribute("aria-pressed", "true")
  expect(screen.queryByRole("button", { name: "圆锥曲线" })).toBeNull()
})

it("creates planar points with alphabetic labels and renames a selected primitive", () => {
  // Use the existing App test store fixture; assert labels and the updated store document.
})
```

- [x] **Step 2: Run focused tests and confirm expected failures**

Run: `npm.cmd test -- apps/web/src/components/AppChrome.test.tsx apps/web/src/App.test.tsx`

Expected: the old workspace label remains, the first 2D point label is “新点 A”, and the name input is not available in the default data section.

- [x] **Step 3: Update visible workspace and point names**

Change the tab label only; preserve `conics` in `WorkspaceTabs.handleTab` and all document switching logic. Change the 2D label allocator to choose unused alphabetic labels, preserving collision avoidance and the existing post-`Z` fallback.

- [x] **Step 4: Make rename discoverable in the data section**

Move the existing “图元名称” field from the appearance-only rendering branch into the selected primitive's data branch. Keep its value bound to `selectedPrimitive.label`, route edits through `onUpdatePrimitive({ label })`, and keep styling controls in the appearance branch.

- [x] **Step 5: Re-run workspace and App tests**

Run: `npm.cmd test -- apps/web/src/components/AppChrome.test.tsx apps/web/src/App.test.tsx`

Expected: workspace label, alphabetic point names, rename display and stored label assertions pass.

### Task 8: Simplify the Multimodal Ribbon Group

**Files:**
- Modify: `apps/web/src/ribbonCommands.ts`
- Modify: `apps/web/src/uiState.ts`
- Modify: `apps/web/src/components/Ribbon.tsx`
- Test: `apps/web/src/ribbonCommands.test.ts`
- Test: `apps/web/src/components/Ribbon.test.tsx`

**Interfaces:**
- The `multimodal` group contains exactly `input-text-conversion` (“文字转换”) and `input-image-conversion` (“图片转换”).
- Both commands stay disabled until their conversion services exist; the `image` icon is added to the existing closed `RibbonIcon` union and icon renderer.

- [x] **Step 1: Assert the two command IDs, labels and unavailable reasons**

Add a command configuration test asserting the exact ordered pair and disabled reasons; add a Ribbon render test asserting the labels and disabled buttons.

- [x] **Step 2: Run focused tests and confirm expected failures**

Run: `npm.cmd test -- apps/web/src/ribbonCommands.test.ts apps/web/src/components/Ribbon.test.tsx`

Expected: the current quiz and pen commands violate the exact command list and the image command is absent.

- [x] **Step 3: Replace placeholders without claiming conversion support**

Replace quiz and pen entries with the two requested labels, stable IDs, accessible image/text icons, `disabled: true`, and reasons explaining that the corresponding conversion service is not connected. Do not add file upload, OCR, AI calls or conversion parsing in this change.

- [x] **Step 4: Re-run focused Ribbon tests**

Run: `npm.cmd test -- apps/web/src/ribbonCommands.test.ts apps/web/src/components/Ribbon.test.tsx`

Expected: exactly two multimodal actions render in the specified order and remain visibly unavailable.

### Task 9: Remove Inspector Constraints and Agent UI While Keeping Measurements

**Files:**
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `apps/web/src/components/InspectorTabs.tsx`
- Modify: `apps/web/src/components/EngineeringInspector.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/components/EngineeringInspector.test.tsx`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Remove the “几何约束” accordion, CAD “约束” tab and both `AgentDock` mounts from right inspectors.
- Keep constraint records and codecs untouched so opening older `.mgeo` files does not discard document data.
- Render existing measurement actions in selected-object data when the current selection supports them; keep persistent measurement result and delete controls unchanged.

- [x] **Step 1: Add failing inspector visibility and measurement regression tests**

Assert that neither generic nor CAD inspector exposes constraint or Agent UI. Keep a two-face selection fixture and assert that the “二面角内角” and “二面角外角” actions remain reachable from data properties.

- [x] **Step 2: Run focused tests and confirm expected failures**

Run: `npm.cmd test -- apps/web/src/components/EngineeringInspector.test.tsx apps/web/src/App.test.tsx`

Expected: constraint/Agent content is currently present and measurement controls are currently coupled to the constraints section.

- [x] **Step 3: Remove right-panel constraint and Agent presentation**

Remove the constraints tab/accordion rendering and unmount `AgentDock` from both standard and CAD inspectors. Preserve store constraint data, validation and file codecs; do not delete historical constraints from loaded documents.

- [x] **Step 4: Place supported measurement actions with object data**

Move the `visibleMeasurementOptions` card into the selected-object data branch. Preserve selection requirements, `onCreateMeasurement`, source IDs, result rendering and deletion behavior.

- [x] **Step 5: Re-run Inspector and App regression tests**

Run: `npm.cmd test -- apps/web/src/components/EngineeringInspector.test.tsx apps/web/src/App.test.tsx`

Expected: no right-panel constraint/Agent UI; measurement operations and existing data editing pass.

### Task 10: Expand the Engineering Canvas When Docks Collapse

**Files:**
- Modify: `apps/web/src/components/EngineeringWorkbench.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/components/EngineeringWorkbench.test.tsx`
- Test: `e2e/engineering-workbench.spec.ts`

**Interfaces:**
- Expose existing `leftOpen` and `rightOpen` state as stable `data-left-open` and `data-right-open` attributes on `.engineering-workbench`.
- Grid columns include only visible docks; the canvas remains `minmax(0, 1fr)` and may shrink without horizontal overflow.

- [x] **Step 1: Add failing dock-state layout assertions**

Test that closing the left dock sets `data-left-open="false"`, closing the right dock sets `data-right-open="false"`, and both closed states are representable without removing the canvas region.

- [x] **Step 2: Run the workbench test and confirm expected failure**

Run: `npm.cmd test -- apps/web/src/components/EngineeringWorkbench.test.tsx`

Expected: the workbench does not expose dock state attributes.

- [x] **Step 3: Bind grid columns to dock state**

Add the data attributes and CSS grid variants for left+right, left-only, right-only and no docks. Keep current dock widths and ensure the center column always receives the remaining width.

- [x] **Step 4: Verify dock toggling in unit and browser tests**

Run: `npm.cmd test -- apps/web/src/components/EngineeringWorkbench.test.tsx`

Run: `npm.cmd exec playwright test -- e2e/engineering-workbench.spec.ts`

Expected: all four dock states remain usable and the canvas expands when either dock closes.

### Task 11: Explain 3D Normal and Dihedral Controls in the Status Bar

**Files:**
- Modify: `apps/web/src/statusPrompts.ts`
- Modify: `apps/web/src/statusPrompts.test.ts`
- Modify: `apps/web/src/threeScene.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`
- Test: `e2e/geometry3d.spec.ts`

**Interfaces:**
- `ThreeSceneView` reports `"normals"`, `"dihedral-demo"` or `null` through an optional `onStatusPromptChange` callback whenever the corresponding display control changes.
- `resolveStatusPrompt` accepts the scene-control mode and returns actionable copy; normal prompts explain the displayed face normals, while dihedral copy distinguishes the sample angle display from actual selected-face measurements.

- [x] **Step 1: Add failing status prompt cases**

Test the normal hint, the explicit sample-angle caveat and the actual workflow: select exactly two faces, then use the data-properties “二面角内角/外角” actions.

- [x] **Step 2: Run prompt tests and confirm expected failures**

Run: `npm.cmd test -- apps/web/src/statusPrompts.test.ts`

Expected: the prompt resolver has no 3D scene-control state.

- [x] **Step 3: Report ThreeScene control state to App**

Add the optional callback; invoke it from normal/angle toggle handlers and clear it when both controls are off or the view unmounts. Let App pass the resulting hint to the existing bottom-left status prompt without changing the 3D scene's geometry state.

- [x] **Step 4: Verify prompt transitions and 3D browser flow**

Run: `npm.cmd test -- apps/web/src/statusPrompts.test.ts apps/web/src/App.test.tsx`

Run: `npm.cmd exec playwright test -- e2e/geometry3d.spec.ts`

Expected: the status prompt changes immediately on toggle and gives the correct real-measurement steps.

### Task 12: Render 3D Point Names in the Scene

**Files:**
- Modify: `apps/web/src/threeScene.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/threeScene.test.ts`
- Test: `e2e/geometry3d.spec.ts`

**Interfaces:**
- A pointer-transparent HTML overlay displays the existing `Point3Primitive.label` for every visible point and tracks camera projection and viewport resize.
- Labels use stable `data-point-label` attributes for browser assertions and do not participate in raycasting or selection.

- [x] **Step 1: Add failing 3D label assertions**

Add an E2E scenario that creates points A and B and asserts both `data-point-label="A"` and `data-point-label="B"` elements are visible after the scene renders. The browser assertion is the contract for the overlay, so no new geometry-kernel test is required.

- [x] **Step 2: Run focused 3D checks and confirm expected failure**

Run: `npm.cmd test -- apps/web/src/threeScene.test.ts`

Expected: no projected point-label output is produced for point3 primitives.

- [x] **Step 3: Project labels without changing the 3D domain model**

Create a separate overlay layer, project each visible point position through the active camera, position its label near the marker, and refresh positions in the existing render/resize lifecycle. Keep the layer pointer-transparent and dispose/remove stale labels when documents change.

- [x] **Step 4: Verify label updates in unit and browser tests**

Run: `npm.cmd test -- apps/web/src/threeScene.test.ts`

Run: `npm.cmd exec playwright test -- e2e/geometry3d.spec.ts`

Expected: labels A and B remain aligned with their points after orbit, pan, zoom and resize.

### Task 13: Regression Gate and Follow-up Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/project-progress.md`
- Test: existing UI unit and E2E suites

- [x] **Step 1: Run focused tests for each changed surface**

Run the targeted commands recorded in Tasks 7–12 and fix only failures caused by this follow-up scope.

- [x] **Step 2: Run complete verification**

Run in order: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:e2e`, and `git diff --check`.

Expected: tests, typecheck, build and E2E exit successfully; lint reports no errors. Record existing warnings without silently changing unrelated code.

- [x] **Step 3: Document completed behavior and limitations**

Update README and project progress with the visible “平面几何” label, alphabetic point labels, rename affordance, simplified Inspector, expanded CAD layout, 3D guidance/point labels and the fact that text/image conversion services remain unavailable.

- [x] **Step 4: Stop for user browser review**

Keep the local development server available for browser testing if already running. Do not commit or push to GitHub without a new explicit request.

### Task 14: Engineering Drawing Visual Rework (added 2026-09-16)

The follow-up scope above only made the CAD sheet *bigger*. User feedback: "我要的不是这种简单的放大，这样失去了美感，而且 ui 页面也不是很贴合" — so the drawing area got a real visual pass, audited first and measured in a real browser.

**Files:**
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/drawingGeometry.ts`
- Modify: `apps/web/src/components/DrawingSheetView.tsx`
- Modify: `apps/web/src/components/DrawingViewport.tsx`
- Modify: `apps/web/src/components/EngineeringDrawingView.tsx`
- Test: `apps/web/src/components/DrawingSheetView.test.tsx`
- Test: `e2e/engineering-workbench.spec.ts`

**Interfaces:**
- New drafting-surface tokens (`--color-drafting-surface`, `--color-drafting-grid`, `--color-paper`, `--color-paper-tint`, `--color-hairline`, `--color-hairline-strong`, `--shadow-sheet`); the brand accent stays reserved for current state.
- `sheetFitScale(available, paper)` stays the fit primitive; the sheet is scaled with CSS `zoom` (layout-affecting) instead of `transform: scale()` so scroll range and hit areas stay correct. `data-sheet-fit` / `data-sheet-scale` are the observable state, `zoom` is the user override on top of fit.
- `DrawingSheetView` owns the single CAD toolbar and accepts `projectionLinesControl` as a slot, so the whole CAD area has exactly one toolbar.

- [x] **Step 1: Audit and record the measurable defects** (scale-inflated chrome, three near-white layers, view rectangles outside the frame, spacing scaled with the sheet, silent fit, per-view button rows).
- [x] **Step 2: Fix the token layer and the sheet composition** (paper/frame/title block inside the frame, margin math owns the gap).
- [x] **Step 3: Rebuild the view frame chrome** (hairline frame, corner registration ticks, in-frame captions, hover/focus-only actions, calm empty state that does not intercept clicks).
- [x] **Step 4: Give fit an explicit zoom affordance** (fit / − / ＋ plus readout; zoomed sheets scroll instead of being cropped).
- [x] **Step 5: Repair the single-column regression** uncovered while verifying (canvas collapsed to 68px when the body became one column).
- [x] **Step 6: Re-run the complete verification gate** — see `docs/project-progress.md` (2026-09-16 视觉重做 section): 546 unit cases, 4 workspace typechecks, 0 lint errors, production build, 37/37 Playwright.

> **之后（Task 15-18，2026-09-16）**：Task 14 把 CAD 区域的工具栏收敛成**图纸外的一行**；随后针对三条用户反馈（2D 绘图控件混乱、3D 投影没有来源、立体几何拿不到截面/截线）又做了三组切片——绘图命令组进入那一行工具条（`DraftControlsRow`）、新增「投影来源：本图纸 / 立体几何」切换、以及虚线截面/截线预览 + 点击创建。它们不属于本计划的 Ribbon 范围，记录在 `docs/superpowers/plans/2026-09-15-engineering-workbench-hierarchy.md` 的「Follow-up: CAD usability fixes」与 `docs/superpowers/specs/2026-09-16-section-intersection-primitives-design.md`。当前门禁：68 测试文件 / 698 用例、E2E 47/47。

### Task 1: Build the Shared App Chrome

**Files:**
- Create: `apps/web/src/components/AppChrome.tsx`
- Create: `apps/web/src/components/WorkspaceTabs.tsx`
- Create: `apps/web/src/components/Ribbon.tsx`
- Create: `apps/web/src/uiState.ts`
- Modify: `apps/web/src/components/WorkspaceHeader.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/components/WorkspaceHeader.test.tsx`
- Test: `apps/web/src/components/Ribbon.test.tsx`
- Test: `apps/web/src/components/AppChrome.test.tsx`

**Interfaces:**
- `AppChrome` consumes `activeWorkspace`, `onWorkspaceChange`, `ribbonGroups`, `activeRibbonTab`, `ribbonExpanded`, `ribbonPinned`, `onRibbonTabChange`, `onRibbonExpandedChange`, `onRibbonPinnedChange`, and the existing file/history callbacks.
- `RibbonCommand` is `{ id: string; label: string; icon: RibbonIcon; prompt?: string; disabled?: boolean; disabledReason?: string }`.
- `RibbonIcon` is the closed union of `select | point | line | segment | ray | polyline | circle | arc | parabola | ellipse | hyperbola | function | text | quiz | pen | delete | lock | svg | csv | png`.
- `RibbonGroup` is `{ id: "base" | "multimodal" | "edit" | "export"; label: string; commands: RibbonCommand[] }`.
- `Ribbon` consumes `groups: RibbonGroup[]`, `activeTab: "file" | "home" | "insert" | "review" | "view" | null`, `expanded`, `pinned`, `onTabChange`, `onCommand(commandId: string)`, `onExpandedChange`, and `onPinnedChange`; it emits command IDs without knowing document operations.
- `WorkspaceTabs` emits `onTabChange(tab: "file" | Workspace)`, workspace changes and ribbon controls; the `文件` tab opens file commands and does not mutate the active workspace by itself.
- `uiState.ts` exports `RibbonUiState`, `InspectorSectionState` and `CreationStep` unions so App, Inspector and StatusBar share names without importing one another.

- [x] **Step 1: Write failing shell tests**

```tsx
it("renders the system actions and removes workspace pills from the top bar", () => {
  render(<WorkspaceHeader onOpen={() => {}} onSave={() => {}} />)
  expect(screen.getByRole("banner")).toHaveTextContent("MathCanvas")
  expect(screen.getByPlaceholderText("搜索工具、命令或定理..."))
  expect(screen.getByRole("button", { name: "打开 .mgeo" }))
  expect(screen.queryByRole("button", { name: "立体几何" })).not.toBeInTheDocument()
})

it("collapses the ribbon and temporarily opens it from a tab", async () => {
  const user = userEvent.setup()
  render(<Ribbon groups={groups} activeTab={null} expanded={true} pinned={false} onTabChange={() => {}} onCommand={() => {}} onExpandedChange={onExpandedChange} onPinnedChange={() => {}} />)
  await user.click(screen.getByRole("button", { name: "收起功能区" }))
  expect(onExpandedChange).toHaveBeenCalledWith(false)
})
```

- [x] **Step 2: Run focused tests and verify the expected failures**

Run: `npm.cmd test -- apps/web/src/components/WorkspaceHeader.test.tsx apps/web/src/components/Ribbon.test.tsx apps/web/src/components/AppChrome.test.tsx`

Expected: FAIL because the shared shell interfaces and the new search/ribbon structure do not exist.

- [x] **Step 3: Implement Top Bar, Tab Bar, and Ribbon primitives**

Move the existing brand, status, search, file, history, settings and profile controls into the 40px Top Bar. Render only the four required Tab Bar entries (`文件`, `圆锥曲线`, `立体几何`, `工程制图`) below it. Render command groups with compact SVG icons, labels, group dividers and a named collapse button; preserve accessible names for every icon-only control.

- [x] **Step 4: Add fold, pin, keyboard and outside-click behavior**

Use `ribbonExpanded`, `ribbonPinned` and `activeRibbonTab` as controlled UI state. Bind `Ctrl + F1` only when the active target is not an input, textarea, select or contenteditable element. In collapsed mode, opening a Tab renders an absolutely positioned Ribbon; selecting a command or clicking outside closes it unless pinned.

- [x] **Step 5: Run the focused shell tests and Web typecheck**

Run: `npm.cmd test -- apps/web/src/components/WorkspaceHeader.test.tsx apps/web/src/components/Ribbon.test.tsx apps/web/src/components/AppChrome.test.tsx`

Run: `npm.cmd run typecheck --workspace @draw/web`

Expected: PASS.

### Task 2: Migrate Commands Across All Workspaces

**Files:**
- Create: `apps/web/src/ribbonCommands.ts`
- Create: `apps/web/src/ribbonCommands.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/CommandBar.tsx`
- Modify: `apps/web/src/components/GeometryToolbar.tsx`
- Modify: `apps/web/src/store.ts`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- `createRibbonGroups(workspace, context): RibbonGroup[]` returns groups for `base`, `multimodal`, `edit` and `export`; each command has `id`, `label`, `icon`, `disabled`, `disabledReason` and an optional `prompt`.
- Existing `startCreation`, `addPoint`, `deleteSelected`, lock, export and workspace-switch callbacks remain the only domain entry points.

- [x] **Step 1: Write failing command configuration tests**

```ts
it("keeps the same base command order in planar and CAD workspaces", () => {
  const conics = createRibbonGroups("conics", emptyContext)
  const cad = createRibbonGroups("cad", emptyContext)
  expect(conics.find((group) => group.id === "base")?.commands.map((command) => command.id)).toEqual(expect.arrayContaining(["select", "add-point", "add-line", "add-circle", "add-function"]))
  expect(cad.find((group) => group.id === "export")?.commands.map((command) => command.id)).toEqual(["export-svg", "export-csv", "export-png"])
})

it("starts the application on the conics workspace", () => {
  expect(useSceneStore.getState().document.workspace).toBe("conics")
})
```

- [x] **Step 2: Run focused tests and verify the expected failures**

Run: `npm.cmd test -- apps/web/src/ribbonCommands.test.ts apps/web/src/App.test.tsx`

Expected: FAIL because commands are currently split between the CAD CommandBar and GeometryToolbar, and the initial workspace is not conics.

- [x] **Step 3: Define workspace-aware Ribbon groups**

Keep the base group order from the requirement. Map unsupported actions to disabled commands with a short reason instead of hiding their location; keep SVG/CSV/PNG enablement consistent with current workspace rules. Represent text input, quiz and pen annotation as stable command IDs with existing-entry callbacks or explicit disabled state when no implementation exists.

- [x] **Step 4: Wire command IDs to existing operations**

Replace duplicated CAD command definitions in `App.tsx` with `createRibbonGroups`. Route every enabled command to the existing callback, preserve selection guards and status errors, and leave `CommandBar` as a compatibility wrapper only if existing tests or non-CAD consumers still require it. Remove duplicate workspace controls from `GeometryToolbar`.

- [x] **Step 5: Set the conics default without losing workspace documents**

Change only the initial active document to `conics`; preserve the existing per-workspace document map and `switchWorkspace` behavior so geometry3d and CAD documents remain intact after switching.

- [x] **Step 6: Run command tests, App tests and typecheck**

Run: `npm.cmd test -- apps/web/src/ribbonCommands.test.ts apps/web/src/App.test.tsx`

Run: `npm.cmd run typecheck --workspace @draw/web`

Expected: PASS.

### Task 3: Enforce the 100vh Responsive Shell

**Files:**
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/components/EngineeringWorkbench.tsx`
- Modify: `apps/web/src/components/DrawingSheetView.tsx`
- Modify: `apps/web/src/components/GraphicsView.tsx`
- Test: `apps/web/src/components/EngineeringWorkbench.test.tsx`
- Test: `apps/web/src/components/DrawingSheetView.test.tsx`

**Interfaces:**
- `EngineeringWorkbench` continues to expose its existing slots and adds only UI layout attributes needed for collapsed docks and responsive drawers.
- CSS uses shared tokens for `--topbar-height`, `--tabbar-height`, `--ribbon-height`, `--panel-left-width` and `--panel-right-width`.

- [x] **Step 1: Write failing layout tests**

```tsx
it("keeps the workbench body inside a viewport-bounded shell", () => {
  render(<EngineeringWorkbench document={createEmptyDocument("cad")} mode="projection" onModeChange={() => {}} commandBar={<div />} leftDock={<div />} canvas={<div />} inspector={<div />} statusBar={<div />} />)
  expect(screen.getByRole("region", { name: "工程图视口" }).closest(".engineering-workbench")).toHaveAttribute("data-viewport-bounded", "true")
})
```

- [x] **Step 2: Run focused tests and verify the expected failure**

Run: `npm.cmd test -- apps/web/src/components/EngineeringWorkbench.test.tsx apps/web/src/components/DrawingSheetView.test.tsx`

Expected: FAIL because the viewport-bounded marker and new shell layout rules do not exist.

- [x] **Step 3: Implement the flex layout and independent scrolling**

Set the app root and shell to `min-height: 100vh; height: 100vh; overflow: hidden`. Give the body `min-height: 0`, make the center canvas the flexible column, and put `overflow-y: auto` only on left/right docks and their inner panel content. Set Inspector width to 288px by default and cap it at 300px.

- [x] **Step 4: Add responsive drawer behavior**

At 375px and 768px collapse docks into labelled drawers, keep the drawing surface usable, allow Ribbon groups to scroll horizontally, and preserve 44px command targets. At 1024px and above keep the full three-column composition.

- [x] **Step 5: Run layout tests, typecheck and lint**

Run: `npm.cmd test -- apps/web/src/components/EngineeringWorkbench.test.tsx apps/web/src/components/DrawingSheetView.test.tsx`

Run: `npm.cmd run typecheck --workspace @draw/web`

Run: `npm.cmd run lint`

Expected: tests and typecheck PASS; lint has no errors and only documented existing warnings.

### Task 4: Refactor the Context Inspector

**Files:**
- Modify: `apps/web/src/components/EngineeringInspector.tsx`
- Modify: `apps/web/src/components/InspectorTabs.tsx`
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `apps/web/src/components/AgentDock.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/components/EngineeringInspector.test.tsx`

**Interfaces:**
- `PropertiesBar` keeps all existing update callbacks and owns a small local accordion primitive because it is only used by this inspector.
- The planar and 3D object Inspector uses accordions; the CAD context Inspector retains its existing data/appearance/constraints/engineering tabs to preserve its drawing-tree context.

- [x] **Step 1: Write failing Inspector state tests**

```tsx
it("shows the concise empty state without object-specific controls", () => {
  const properties = createPropertiesFixture({ selectedPrimitive: null, selectedCount: 0 })
  render(<EngineeringInspector activeTab="data" onTabChange={() => {}} context={emptyInspectorContext} constraints={<div />} properties={properties} />)
  expect(screen.getByText("未选择任何图元")).toBeInTheDocument()
  expect(screen.getByText("在画布中点击点、直线或椭圆即可配置几何参数与外观参数。")).toBeInTheDocument()
  expect(screen.queryByText("斜率")).not.toBeInTheDocument()
})

it("opens geometry parameters and keeps other sections collapsed", async () => {
  const user = userEvent.setup()
  render(<InspectorAccordion id="geometry" label="几何参数" expanded={true} onExpandedChange={() => {}}><div>核心参数</div></InspectorAccordion>)
  expect(screen.getByRole("button", { name: "几何参数" })).toHaveAttribute("aria-expanded", "true")
  await user.click(screen.getByRole("button", { name: "几何参数" }))
})
```

- [x] **Step 2: Run focused tests and verify the expected failures**

Run: `npm.cmd test -- apps/web/src/components/InspectorAccordion.test.tsx apps/web/src/components/EngineeringInspector.test.tsx`

Expected: FAIL because the accordion primitive and concise empty state are not implemented.

- [x] **Step 3: Implement the empty state and selected-object header**

Render the centered icon, exact empty-state copy, and compact Agent drawer when there is no selection. For a selection render the object label, lock and delete actions in the header; remove explanatory template paragraphs and avoid mounting object-specific fields in the empty branch.

- [x] **Step 4: Split Inspector content into four accordions**

Default only `data`/“几何参数” open. Put appearance, constraints and animation content into independent collapsed regions. Keep constraint empty state to “暂无约束” plus “添加”; keep the existing field callbacks as the source of truth. Change Agent placeholder to “对选中的图元下达指令...”.

- [x] **Step 5: Run Inspector and App regression tests**

Run: `npm.cmd test -- apps/web/src/components/EngineeringInspector.test.tsx apps/web/src/App.test.tsx`

Run: `npm.cmd run typecheck --workspace @draw/web`

Expected: PASS.

### Task 5: Replace Static Footer Copy with Dynamic Status Prompts

**Files:**
- Create: `apps/web/src/statusPrompts.ts`
- Create: `apps/web/src/statusPrompts.test.ts`
- Modify: `apps/web/src/components/StatusBar.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/GeometryToolbar.tsx`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- `getStatusPrompt(context: StatusPromptContext): StatusPrompt` consumes `workspace`, `activeTool`, `creationStep`, `selectedLabels`, `creationLabel`, and `creationHint`, returning `text`, `kind`, and optional `icon`.
- The status bar remains present in every workspace; it does not mutate selection or document state.

- [x] **Step 1: Write failing prompt tests**

```ts
it("describes the next point in a two-step line creation", () => {
  expect(getStatusPrompt({ workspace: "conics", activeTool: "line", creationStep: "first-point", selectedLabels: [], creationLabel: "直线", creationHint: "" }).text).toContain("点击完成确定直线后的第一个点")
  expect(getStatusPrompt({ workspace: "conics", activeTool: "line", creationStep: "second-point", selectedLabels: [], creationLabel: "直线", creationHint: "" }).text).toContain("点击确定直线的第二个点")
})

it("shows the selected-object hint when selection mode has a selection", () => {
  expect(getStatusPrompt({ workspace: "conics", activeTool: "select", creationStep: null, selectedLabels: ["直线_1"], creationLabel: "", creationHint: "" }).text).toContain("已选中直线_1")
})
```

- [x] **Step 2: Run focused tests and verify the expected failures**

Run: `npm.cmd test -- apps/web/src/statusPrompts.test.ts apps/web/src/App.test.tsx`

Expected: FAIL because the current footer uses a static revision/workspace string and has no prompt resolver.

- [x] **Step 3: Implement the prompt state machine**

Cover select, point, line, segment/ray, circle, conic and function creation. Use the current creation step identifiers and callbacks; return short actionable copy with a small status icon and never duplicate long toolbar help text.

- [x] **Step 4: Connect the status resolver to all workspaces**

Pass the active tool, creation step and selected labels from `App`. Keep CAD prompts for projection/draft mode and preserve layer-blocked notices. Do not use an interval for ordinary prompt changes; update immediately from state transitions and reserve timing only for transient notices.

- [x] **Step 5: Run prompt, App and type checks**

Run: `npm.cmd test -- apps/web/src/statusPrompts.test.ts apps/web/src/App.test.tsx`

Run: `npm.cmd run typecheck --workspace @draw/web`

Expected: PASS.

### Task 6: Cross-Workspace Browser Acceptance and Documentation

**Files:**
- Modify: `e2e/workbench.spec.ts`
- Modify: `e2e/engineering-drawing.spec.ts`
- Modify: `e2e/engineering-workbench.spec.ts`
- Create: `e2e/ribbon-ui.spec.ts`
- Modify: `README.md`
- Modify: `docs/project-progress.md`

**Interfaces:**
- Browser tests use accessible names and `data-workspace`/`data-ribbon-expanded` attributes, not pixel coordinates for primary assertions.
- Documentation records the shared Ribbon behavior, keyboard shortcut, responsive rules, default conics workspace and known unsupported multimodal actions.

- [x] **Step 1: Write failing browser scenarios**

Cover: fresh load opens conics; Top Bar has no duplicate workspace pills; `Ctrl + F1` collapses and expands Ribbon; collapsed Tab hover/click opens a temporary panel; switching to geometry3d and CAD preserves usable command groups; Inspector empty and selected states remain within the viewport; status text changes between first and second creation steps.

- [x] **Step 2: Run the new scenarios to verify the expected failures**

Run: `npx playwright test e2e/ribbon-ui.spec.ts`

Expected: FAIL until the shared shell, responsive attributes and dynamic prompts are wired.

- [x] **Step 3: Implement browser-facing attributes and responsive behavior**

Use stable `data-ribbon-expanded` and `data-ribbon-pinned` attributes with accessible labels for browser assertions. Keep the drawing canvas and existing engineering drawing source IDs unchanged. At phone widths, expose mutually exclusive object-list and property-inspector drawers without changing document data.

- [x] **Step 4: Run the complete verification gate**

Run in order:

```text
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Expected: all commands exit successfully; lint has no errors; existing warnings and the Vite large-chunk warning are recorded without masking failures.

- [x] **Step 5: Update progress and hand off**

Record completed tasks, test counts, E2E viewport coverage, the default conics workspace, and any intentionally disabled multimodal commands in `docs/project-progress.md`. Do not create a Git commit or push unless the user explicitly requests delivery.

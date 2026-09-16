# Engineering Workbench Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MathCanvas 的 CAD 工作区改造成同时支持 2D 直接绘图和 3D 投影制图的经典 CAD 分层工作台。

**Architecture:** 保留现有 `GeometryDocument`、投影解析器和导出器，在 DSL 中增加可选的图层、图纸和视图布局数据；在 Web 层加入工作台壳、分层命令面板、三类树面板、上下文 Inspector 和图纸视口。所有投影几何仍由 `ProjectedDrawing` 派生，源对象通过稳定 ID 与投影视图联动。

**Tech Stack:** React 19, TypeScript, Vite, Zustand, SVG, Vitest, Testing Library, Playwright。

**Spec:** `docs/superpowers/specs/2026-09-15-engineering-workbench-design.md`

## Global Constraints

- 2D 绘图与 3D 投影工作流同等重要，统一入口为现有 `cad` 工作区。
- 投影几何、深度排序、工程标注和 SVG/DXF/PDF 导出继续复用 P7 实现。
- 新增文档字段必须是可选字段，旧 `.mgeo` 文件必须迁移到默认图层和默认图纸。
- 不引入新的 UI 依赖；复用现有 React、SVG 和 CSS token。
- 所有树节点、命令按钮、视口和图标按钮必须键盘可达并有可读名称。
- 实现阶段不自动创建 Git commit；仅在用户明确要求交付时，才执行提交和远程推送。

## Current Execution Boundary

- Task 1-7 已全部执行，并逐任务通过聚焦测试、Web 类型检查、全量单测、lint、build 与 Playwright E2E 验证。
- 完整验证门（`npm test` 51 文件 / 464 用例、`npm run typecheck`、`npm run lint` 0 error / 36 条既有 warning、`npm run build`、`npm run test:e2e` 24/24）在 Task 7 收尾时执行通过。
- 实现阶段未自动创建 Git commit；提交与远程推送仍需用户明确要求。
- **Task 7 之后的三条用户反馈修复（Task 15-18）已完成并推送**：2D 绘图命令搬出图纸、三维投影来源切换、截面/截线虚线预览与点击创建。见文末「Follow-up: CAD usability fixes」；截线部分的设计决策另见 `docs/superpowers/specs/2026-09-16-section-intersection-primitives-design.md`。

---

### Task 1: Add Layer, Sheet, and View Document Models

**Files:**
- Modify: `packages/dsl/src/types.ts`
- Modify: `packages/dsl/src/codec.ts`
- Modify: `packages/dsl/src/schema.ts`
- Test: `packages/dsl/src/codec.test.ts`
- Create: `packages/dsl/src/schema.test.ts`

**Interfaces:**
- Produces `LayerSpec`, `DrawingViewSpec`, `DrawingSheetSpec` and optional `GeometryDocument` fields consumed by Tasks 2–5.
- Produces `createDefaultCadLayout(document)` migration helper returning valid default layers, one sheet and four P7 views.

- [x] **Step 1: Write migration and round-trip tests**

Add tests for an old document without the new fields, a new document with nested layers and view placement, and invalid references. The migration test must assert that the old primitives remain unchanged and receive the default geometry layer.

```ts
it("migrates legacy CAD documents to default layers and views", () => {
  const restored = decodeMgeo(JSON.stringify(createEmptyDocument("cad")))
  expect(restored.layers?.map((layer) => layer.name)).toEqual(["几何", "尺寸", "辅助线", "注释"])
  expect(restored.drawingSheets).toHaveLength(1)
  expect(restored.drawingViews?.map((view) => view.kind)).toEqual(["front", "top", "left", "axonometric"])
})

it("round trips nested layer and sheet layout data", () => {
  const document = createDefaultCadLayout(createEmptyDocument("cad"))
  const restored = decodeMgeo(encodeMgeo(document))
  expect(restored.layers).toEqual(document.layers)
  expect(restored.drawingSheets).toEqual(document.drawingSheets)
  expect(restored.drawingViews).toEqual(document.drawingViews)
})
```

- [x] **Step 2: Run focused tests and verify the initial failures**

Run: `npm.cmd test -- packages/dsl/src/codec.test.ts packages/dsl/src/schema.test.ts`

Expected: FAIL because the new types and migration helper do not exist.

- [x] **Step 3: Define the serializable types and default layout**

Add the exact unions and fields from the spec. Implement `createDefaultCadLayout` with deterministic IDs: `layer-geometry`, `layer-dimension`, `layer-construction`, `layer-annotation`, `sheet-1`, and `view-front`, `view-top`, `view-left`, `view-axonometric`. Set the default sheet to A4 landscape and place the four views in a 2×2 layout.

- [x] **Step 4: Add codec defaults and schema validation**

When decoding, normalize missing arrays and IDs through `createDefaultCadLayout`. Validate unique layer, sheet and view IDs; reject unknown layer kinds, invalid parent IDs, non-positive view sizes, non-positive scales and sheet references to missing views. Preserve `engineeringAnnotations` exactly.

- [x] **Step 5: Run focused tests and workspace typecheck**

Run: `npm.cmd test -- packages/dsl/src/codec.test.ts packages/dsl/src/schema.test.ts`

Run: `npm.cmd run typecheck --workspace @draw/dsl`

Expected: PASS with no new failures.

### Task 2: Add Undoable Layer and Layout Operations

**Files:**
- Modify: `packages/scene-graph/src/operations.ts`
- Modify: `packages/scene-graph/src/patches.ts`
- Modify: `packages/scene-graph/src/index.ts`
- Test: `packages/scene-graph/src/patches.test.ts`
- Create: `packages/scene-graph/src/operations.test.ts`

**Interfaces:**
- Produces operations `addLayer`, `updateLayer`, `deleteLayer`, `setActiveLayer`, `addDrawingSheet`, `updateDrawingSheet`, `addDrawingView`, `updateDrawingView`, and `deleteDrawingView`.
- Each operation returns the existing `{ document, changed, error }` result shape and participates in existing undo/redo history.

- [x] **Step 1: Write operation tests**

Cover child-layer creation, active-layer protection, recursive delete, batch visibility/lock updates, view placement updates, and rejection of deleting a view still referenced by a sheet.

```ts
it("updates a child layer and restores it through undo", () => {
  const result = applyOperation(document, { op: "addLayer", layer: childLayer })
  expect(result.document.layers?.find((layer) => layer.id === childLayer.id)?.parentId).toBe("layer-geometry")
  expect(result.changed).toBe(true)
})
```

- [x] **Step 2: Run focused tests and verify failures**

Run: `npm.cmd test -- packages/scene-graph/src/patches.test.ts packages/scene-graph/src/operations.test.ts`

Expected: FAIL because the new operation discriminants and patch handlers do not exist.

- [x] **Step 3: Implement validated layer operations**

Use stable IDs, reject duplicate IDs and missing parents, prevent deletion of the last geometry layer, reparent or remove descendants according to the operation payload, and move objects from a deleted layer to the default geometry layer. Enforce `activeLayerId` always points to a visible, unlocked layer.

- [x] **Step 4: Implement validated sheet and view operations**

Allow view position, size, scale, visibility and projection-line updates. Reject zero or negative dimensions and scales. Keep view source IDs renderer-neutral and do not duplicate projected primitives into the document.

- [x] **Step 5: Run focused tests and all scene-graph tests**

Run: `npm.cmd test -- packages/scene-graph/src/patches.test.ts packages/scene-graph/src/operations.test.ts packages/scene-graph/src`

Expected: PASS with existing deletion/reference protections unchanged.

### Task 3: Build the Workbench Shell and Hierarchical Command Bar

**Files:**
- Create: `apps/web/src/components/EngineeringWorkbench.tsx`
- Create: `apps/web/src/components/CommandBar.tsx`
- Create: `apps/web/src/components/StatusBar.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/GeometryToolbar.tsx`
- Modify: `apps/web/src/components/WorkspaceHeader.tsx`
- Modify: `apps/web/src/styles/global.css`
- Create: `apps/web/src/components/CommandBar.test.tsx`
- Create: `apps/web/src/components/EngineeringWorkbench.test.tsx`

**Interfaces:**
- `EngineeringWorkbench` consumes the current document, selected IDs, active command, mode, and existing operation callbacks.
- `CommandBar` exposes `onCategoryChange(category)`, `onCommandChange(command)`, `onBack()`, and `onCancel()`.
- `StatusBar` consumes `commandPrompt`, `activeLayerName`, `unit`, `scale`, and `diagnosticCount`.

- [x] **Step 1: Write navigation and layout tests**

Assert that the first render shows only top-level categories, selecting `创建` reveals the creation commands, `返回` restores categories, `Esc` calls cancellation, and the shell renders left dock, central canvas slot, Inspector slot and bottom status.

- [x] **Step 2: Run focused tests and verify failures**

Run: `npm.cmd test -- apps/web/src/components/CommandBar.test.tsx apps/web/src/components/EngineeringWorkbench.test.tsx`

Expected: FAIL because the new components do not exist.

- [x] **Step 3: Implement the shell without changing geometry behavior**

Move file, undo/redo and save controls into the header; render `EngineeringWorkbench` for `cad`; keep `geometry3d`, `conics` and `calculus` behavior intact. Use slots/callbacks instead of duplicating object-edit logic from `App.tsx`.

- [x] **Step 4: Implement command hierarchy and keyboard cancellation**

Define categories `select`, `create`, `modify`, `annotate`, `inspect`, `export`. Use a stacked secondary panel with an explicit back button. Register a document-level `Escape` handler only when a command is active and never intercept input, textarea or select editing targets.

- [x] **Step 5: Add responsive and accessible CSS**

Use existing tokens for panel widths, spacing, borders and focus rings. At narrow widths turn the left and right docks into labelled drawers while the drawing canvas remains scrollable. Keep command targets at least 44px.

- [x] **Step 6: Run component tests and Web typecheck**

Run: `npm.cmd test -- apps/web/src/components/CommandBar.test.tsx apps/web/src/components/EngineeringWorkbench.test.tsx`

Run: `npm.cmd run typecheck --workspace @draw/web`

Expected: PASS with no regressions in existing component tests.

### Task 4: Add Model, Layer, and Drawing Trees

**Files:**
- Create: `apps/web/src/components/DocumentTreePanel.tsx`
- Create: `apps/web/src/components/LayerTree.tsx`
- Create: `apps/web/src/components/DrawingTree.tsx`
- Modify: `apps/web/src/components/AlgebraView.tsx`
- Modify: `apps/web/src/components/EngineeringWorkbench.tsx`
- Modify: `apps/web/src/store.ts`
- Create: `apps/web/src/components/LayerTree.test.tsx`
- Create: `apps/web/src/components/DrawingTree.test.tsx`

**Interfaces:**
- `DocumentTreePanel` switches `model`, `layers`, and `drawings` tabs without owning document mutations.
- `LayerTree` consumes `layers`, `activeLayerId`, and callbacks `onActivate`, `onToggleVisibility`, `onToggleLocked`, `onAdd`, `onDelete`.
- `DrawingTree` consumes `drawingSheets`, `drawingViews`, and callbacks `onSelectSheet`, `onSelectView`, `onToggleView`.

- [x] **Step 1: Write tree interaction tests**

Verify nested rendering, filter text, active-layer state, group visibility/lock actions, sheet-to-view expansion, view selection and source ID labels.

- [x] **Step 2: Run focused tests and verify failures**

Run: `npm.cmd test -- apps/web/src/components/LayerTree.test.tsx apps/web/src/components/DrawingTree.test.tsx`

Expected: FAIL because the new tree components do not exist.

- [x] **Step 3: Implement the three tree tabs**

Reuse `AlgebraView` row selection and visibility semantics for the model tab. Render layer parents before children with indentation, type badges, eye and lock actions. Render sheets with nested view rows and view kind/scale metadata.

- [x] **Step 4: Wire document operations and UI state**

Keep expanded node IDs, active tree tab and filter query in UI state. Route layer and view mutations through scene-graph operations. Persist only active tab and expanded IDs in local workspace preferences, not in `.mgeo`.

- [x] **Step 5: Run tree tests, store tests and typecheck**

Run: `npm.cmd test -- apps/web/src/components/LayerTree.test.tsx apps/web/src/components/DrawingTree.test.tsx apps/web/src/store.test.ts`

Run: `npm.cmd run typecheck --workspace @draw/web`

Expected: PASS.

### Task 5: Convert Fixed Views Into Sheet Viewports and Add 2D Mode

**Files:**
- Create: `apps/web/src/components/DrawingSheetView.tsx`
- Create: `apps/web/src/components/DrawingViewport.tsx`
- Modify: `apps/web/src/components/EngineeringDrawingView.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/projectionVisuals.ts`
- Modify: `apps/web/src/styles/global.css`
- Create: `apps/web/src/components/DrawingSheetView.test.tsx`
- Create: `apps/web/src/components/DrawingViewport.test.tsx`
- Modify: `apps/web/src/projectionVisuals.test.ts`

**Interfaces:**
- `DrawingSheetView` consumes one `DrawingSheetSpec`, its `DrawingViewSpec[]`, and `ProjectedDrawing[]`; emits `onViewSelect(viewId)` and `onViewLayoutChange(viewId, patch)`.
- `DrawingViewport` consumes `view`, optional `projectedDrawing`, `mode: "projection" | "draft"`, `selectedIds`, and `onSelect`.
- `resolveProjectedDrawing` remains the only projection geometry source for projection mode.

- [x] **Step 1: Write viewport and linkage tests**

Assert that a default sheet renders four viewports, view layout updates use the view ID, projection-line toggles remain temporary, 2D mode renders editable document primitives, and selecting a projected primitive emits its source ID.

- [x] **Step 2: Run focused tests and verify failures**

Run: `npm.cmd test -- apps/web/src/components/DrawingSheetView.test.tsx apps/web/src/components/DrawingViewport.test.tsx apps/web/src/projectionVisuals.test.ts`

Expected: FAIL because the sheet and viewport components do not exist.

- [x] **Step 3: Implement paper and viewport layout**

Render paper bounds and a title block from sheet metadata. Render each view at its persisted rectangle and scale. Make the active view visually distinct and provide `aria-label` values containing sheet and view names.

- [x] **Step 4: Preserve P7 projection and source selection**

Move the existing primitive/annotation rendering into `DrawingViewport`. Keep `sourceId` as the selection payload, use the current `onSelect` callback, and do not create derived primitives on click. Keep diagnostics and invalid annotation states visible in the viewport status region.

- [x] **Step 5: Cache shared projected drawings**

Add a memoized resolver at the workbench boundary keyed by `document.revision` and view kind. Compute each view’s `ProjectedDrawing` once per revision, pass the cached result to all viewports and exporters, and invalidate the cache after a document operation changes the revision.

- [x] **Step 6: Add direct 2D drafting mode**

Route existing point/line/segment/ray/polyline/circle/arc creation callbacks through the active 2D viewport. New primitives receive `activeLayerId`; reject creation when the active layer is hidden or locked and show the reason in `StatusBar`.

- [x] **Step 7: Run focused tests and existing engineering tests**

Run: `npm.cmd test -- apps/web/src/components/DrawingSheetView.test.tsx apps/web/src/components/DrawingViewport.test.tsx apps/web/src/components/EngineeringDrawingView.test.tsx apps/web/src/projectionVisuals.test.ts`

Expected: PASS with existing P7 selection, diagnostics and annotation coverage intact.

### Task 6: Split the Context Inspector and Complete User Flows

**Files:**
- Create: `apps/web/src/components/EngineeringInspector.tsx`
- Create: `apps/web/src/components/InspectorTabs.tsx`
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `apps/web/src/components/ConstraintPanel.tsx`
- Modify: `apps/web/src/components/EngineeringWorkbench.tsx`
- Modify: `apps/web/src/styles/global.css`
- Create: `apps/web/src/components/EngineeringInspector.test.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Interfaces:**
- `EngineeringInspector` consumes `selectedPrimitive`, `selectedIds`, active sheet/view/layer and existing property callbacks.
- `InspectorTabs` exposes `activeTab: "data" | "appearance" | "constraints" | "engineering"` and `onTabChange(tab)`.
- Existing `PropertiesBar` field update callbacks remain the source of truth for primitive edits.

- [x] **Step 1: Write Inspector and flow regression tests**

Cover no selection, one selection, multi-selection, 2D layer assignment, projection source metadata, constraint diagnostics, engineering annotation actions, and keyboard tab navigation.

- [x] **Step 2: Run focused tests and verify failures**

Run: `npm.cmd test -- apps/web/src/components/EngineeringInspector.test.tsx apps/web/src/App.test.tsx`

Expected: FAIL for the new Inspector behavior.

- [x] **Step 3: Split existing property sections into contextual tabs**

Keep object-specific update logic in `PropertiesBar`, but render it through Data and Appearance tabs. Show constraints and engineering annotations only when applicable. For multiple selection show only batch-safe actions.

- [x] **Step 4: Add sheet, layer and command context**

When nothing is selected, show active sheet, active view and active layer settings. Disable object-only commands without selection. Show source IDs and “来源已删除” for invalid projection references.

- [x] **Step 5: Run focused tests and full Web tests**

Run: `npm.cmd test -- apps/web/src/components/EngineeringInspector.test.tsx apps/web/src/App.test.tsx`

Run: `npm.cmd test -- apps/web/src/components`

Expected: PASS.

### Task 7: Add Migration, E2E Coverage, and Delivery Verification

**Files:**
- Modify: `apps/web/src/persistence/draftStorage.ts`
- Modify: `apps/web/src/persistence/engineeringExporters.ts`
- Modify: `README.md`
- Modify: `docs/project-progress.md`
- Create: `e2e/engineering-workbench.spec.ts`

**Interfaces:**
- Draft storage preserves active workspace and new document layout without changing the existing per-workspace key format.
- Exporters consume the persisted sheet/view layout where supported and continue to consume `ProjectedDrawing` for SVG/DXF/PDF geometry.

- [x] **Step 1: Write migration and persistence E2E tests**

Load a legacy `.mgeo`, create a layer and line in 2D mode, hide the layer, create a 3D projection sheet, change a view scale, refresh, and verify the layout and visibility state remain.

- [x] **Step 2: Add export regression assertions**

Verify SVG, DXF and PDF export still contain engineering annotations and source-linked projected geometry. Verify hidden or invalid views do not emit fabricated geometry.

- [x] **Step 3: Update user documentation**

Document the two CAD modes, the model/layer/drawing trees, active layer behavior, view layout controls, command cancellation and supported exports in `README.md` and `docs/project-progress.md`. Include the local development command `npm.cmd run dev` from `D:\draw\draw`.

- [x] **Step 4: Run the complete verification gate**

Run in order:

```text
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e
```

Expected: all commands exit successfully; lint may retain only the documented existing warnings; the final Git diff contains only the planned files and documentation.

---

## Follow-up: CAD usability fixes (Task 15-18, added 2026-09-16)

Task 7 交付后用户反馈三条可用性问题，逐条定位根因后实现。完整的测量数据、证据与提交映射见 `docs/project-progress.md` 的「工程制图可用性修复（Task 15-18）」小节。

**触发反馈（原话）**：「工程制图的 2d 绘图 ui 表现堪比灾难性，中间的画布内容十分混乱，而且工程绘图这个功能很难用，让人不知所云，3d 投影的模块一直显示暂无可投影的空间对象，根本不知道怎么用，立体几何的模块，我希望能够获取截面，截线图元，就像平面板块获取交点图元一样，当相交时，会显示虚线的截面和截线，点击获取图元」。

### Task 15: Move the 2D drafting commands off the drawing surface

**Files:**
- Create: `apps/web/src/components/DraftControlsRow.tsx`
- Modify: `apps/web/src/components/DrawingViewport.tsx`（导出 `DraftControls` / `DraftConstraint`，改为 `onDraftControls` 上报）
- Modify: `apps/web/src/components/DrawingSheetView.tsx`（`draftControlsSlot` 渲染位 + `publishDraftControls`）
- Modify: `apps/web/src/App.tsx`、`apps/web/src/styles/global.css`
- Test: `apps/web/src/components/DrawingSheetView.test.tsx`、`DrawingViewport.test.tsx`、`e2e/engineering-workbench.spec.ts`

**Decision:** 绘图命令属于**图纸外**的那一行工具条（与缩放控件同一行、保持单行 ≤ `--drawing-toolbar-height`），纸内只留画布与读数；读数文字按视图 `viewBox` 跨度换算（`readoutFontUserUnits(span) = span / 42`），不随纸张 CSS `zoom` 被放大。

- [x] **Step 1: Report draft state out of the viewport** (`onDraftControls`, `draftControlsHandledExternally` 抑制纸内旧行)。
- [x] **Step 2: Render the command row on the sheet toolbar** (`draftControlsSlot`，无插槽时回退到纸内渲染以保证组件可独立使用)。
- [x] **Step 3: Size the readout in viewBox units** and keep the toolbar on one row.
- [x] **Step 4: Cover it** — 单测断言命令在纸外、纸内不出现第二行；E2E `keeps the 2D drafting commands on the toolbar, off the drawing surface`。

### Task 16: Let the engineering drawing project the spatial workspace

**Files:**
- Create: `apps/web/src/projectionSource.ts`（`hasProjectableGeometry` / `projectionEmptyMessage`）
- Modify: `apps/web/src/components/EngineeringDrawingView.tsx`、`App.tsx`、`styles/global.css`
- Test: `apps/web/src/projectionSource.test.ts`、`components/EngineeringDrawingView.test.tsx`、`e2e/engineering-workbench.spec.ts`

**Decision:** 投影来源成为**显式状态**（`"cad" | "geometry3d"`），因为两份工作区文档相互独立；**图纸布局仍然只属于 CAD 文档**，切换来源不改图纸版式。空状态必须说清是哪一份文档为空、另一份里有没有模型。

- [x] **Step 1: Add the source model and empty-state copy** (可见性判定：隐藏对象与二维图元不算可投影内容)。
- [x] **Step 2: Wire the switch in the drawing toolbar** (`data-projection-source`、`aria-pressed`) and the "去立体几何" action。
- [x] **Step 3: Cover it** — 单测 3 个用例 + 组件用例 + E2E `projects the spatial workspace model instead of claiming there is nothing to project`。

### Task 17: Section and intersection-line primitives (spec-driven, C1-C4)

设计与已确认决策：`docs/superpowers/specs/2026-09-16-section-intersection-primitives-design.md`（第 8 节决策、第 9 节实现状态）。

- [x] **C1 内核**：`packages/geometry-kernel/src/intersections3d.ts` 的面环求交（两区间求交 + 共面短路 + 去重串联）。
- [x] **C2 DSL 与重算**：`intersectionLine` 图元、schema 校验、codec 往返、Scene Graph 重算与来源删除保护（`schemaVersion` 仍为 `"0.1"`）。
- [x] **C3 虚线预览**：`intersectionPreview3d.ts` + `threeScene.tsx` 的 `createPreviewGroup`，两级预览（悬停轻提示 / 选中两个对象完整预览）。
- [x] **C4 点击创建**：点击虚线预览写入持久化图元；优先级为 点/棱拾取 > 预览创建 > 选中来源。

### Task 18: Verification gate

- [x] `npm.cmd test` → **68 个测试文件、698 个用例通过**（本轮起始 64 / 670）。
- [x] `npm.cmd run typecheck` 4 个 workspace 通过；`npm.cmd run lint` 0 error / 39 条既有 warning；`npm.cmd run build` 通过。
- [x] `npm.cmd run test:e2e` → **47/47 通过**（本轮起始 43，新增 4 个用例）。
- [x] 逐片提交并推送：`9ca7d46` / `90f8743` / `b552994` / `1fbdda5` / `a52a74d` / `a775c39` / `68ec2a8` / `0435622` / `63d2dc9`。

**尚未实现（有意保留）**：剖切平面的法向量/偏移量仍不可调；圆/圆弧的修剪、布尔运算、实体真实剖切显示均不在范围内；圆柱/圆锥的面环为多边形近似，因此交线是折线。

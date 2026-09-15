# P7 工程制图 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有点驱动 3D 文档增加可同步、可选择、可导出的主视图、俯视图、左视图和轴测工程制图工作区。

**Architecture:** 保持 3D DSL/Scene Graph 为唯一源数据，在 `geometry-kernel` 提供纯投影函数，在 Web 层将源对象解析为 renderer-neutral 的 `ProjectedDrawing`，最后由 CAD 视图和 SVG/PDF/DXF adapter 消费同一份派生描述。视图布局、投影线和相机状态不进入文档或 undo history；用户创建的工程标注才进入兼容的可选文档字段。

**Tech Stack:** TypeScript、React 19、SVG、Three.js 现有 3D 数据、Zustand、Vitest、React Testing Library、Playwright、Vite。

**Spec:** `docs/superpowers/specs/2026-09-15-p7-engineering-drawing-design.md`

## Global Constraints

- 保持 `schemaVersion: "0.1"` 和旧 2D/3D `.mgeo` 可读；新增工程标注字段必须在旧文档缺省时回退为空数组。
- 3D 源 primitive 是唯一真源，投影、投影线和视图布局都是派生或临时 UI 状态。
- 几何投影与标注数值留在 `packages/geometry-kernel`；React 组件不重复实现几何算法。
- P7 不实现网格导入、布尔 CAD、完整隐藏线消除、自动尺寸布局或 Agent/P4/P5 能力。
- 每个任务必须遵循 RED → GREEN → REFACTOR，验证通过后单独 commit 并 push `origin/main`。
- 不用截图、WebGL framebuffer 或手写的示例坐标冒充工程图导出。

---

### Task 1: 正交投影内核

**Files:**
- Create: `packages/geometry-kernel/src/projections3d.ts`
- Test: `packages/geometry-kernel/src/projections3d.test.ts`
- Modify: `packages/geometry-kernel/src/index.ts`
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`

**Interfaces:**
- Produces `DrawingView = "front" | "top" | "left" | "axonometric"`.
- Produces `ProjectedPoint = { x: number; y: number; depth: number }`.
- Produces `projectVector3(point: Vector3, view: DrawingView): ProjectedPoint | null`.
- Produces `projectionBasis(view: DrawingView)` for deterministic axis tests.

- [x] **Step 1: Write the failing tests**

Add tests that project `{ x: 2, y: 3, z: 4 }` as front `{ x: 2, y: 3, depth: 4 }`, top `{ x: 2, y: 4, depth: 3 }`, and left `{ x: 4, y: 3, depth: 2 }`; test the axonometric basis is unit length and stable; test NaN/Infinity returns `null` and the input object is unchanged.

- [x] **Step 2: Verify RED**

Run `npm.cmd test -- --run packages/geometry-kernel/src/projections3d.test.ts`. Expected: import resolution fails because `projections3d.ts` does not exist.

- [x] **Step 3: Implement the minimal pure functions**

Use fixed world-axis bases for front/top/left and a fixed orthonormal equal-weight basis for axonometric. Check all three input coordinates with `Number.isFinite`, return `null` for invalid input, and calculate each output component with dot products. Export the module from the geometry-kernel index without importing Three.js.

- [x] **Step 4: Verify GREEN and package compatibility**

Run `npm.cmd test -- --run packages/geometry-kernel/src/projections3d.test.ts packages/geometry-kernel/src/geometry3d.test.ts` and `npm.cmd run typecheck --workspace @draw/geometry-kernel`. Expected: all focused tests and the package typecheck pass.

- [ ] **Step 5: Record and commit the slice**

Update the progress record with the four view conventions and focused test count, then run `git diff --check`, `git add packages/geometry-kernel docs/project-progress.md docs/feature-catalog.md`, `git commit -m "feat(p7): add orthographic projection kernel"`, and `git push origin main`.

### Task 2: Renderer-neutral projection descriptions

**Files:**
- Create: `apps/web/src/projectionVisuals.ts`
- Test: `apps/web/src/projectionVisuals.test.ts`
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`

**Interfaces:**
- Produces `ProjectedDrawing { view, primitives, projectionLines, annotations, diagnostics }`.
- Produces `resolveProjectedDrawing(document: GeometryDocument, view: DrawingView): ProjectedDrawing`.
- `ProjectedPrimitive` supports `point`, `polyline`, and `polygon`, each retaining a stable `sourceId`.
- Invalid or incomplete sources add a diagnostic and do not create a fake origin point or zero-length line.

- [x] **Step 1: Write failing resolver tests**

Build a document containing point3, edge3, face3, a polyhedron3 and one invalid reference. Assert each valid view keeps source IDs, face polygons are closed, depth is finite, invalid references create diagnostics, and template-generated topology is not rendered twice.

- [x] **Step 2: Verify RED**

Run `npm.cmd test -- --run apps/web/src/projectionVisuals.test.ts`. Expected: the resolver module/import is missing.

- [x] **Step 3: Implement source resolution and depth ordering**

Resolve point positions from the document index, call the kernel projection for every requested view, turn edges into ordered polylines and faces into closed polygons, and sort render records by a deterministic depth key. Reuse existing topology conventions rather than creating a second template builder.

- [x] **Step 4: Verify focused and existing 3D behavior**

Run `npm.cmd test -- --run apps/web/src/projectionVisuals.test.ts apps/web/src/threeScene.test.ts packages/dsl/src/codec.test.ts`. Expected: new resolver tests and all existing 3D/codec tests pass.

- [ ] **Step 5: Commit the renderer-neutral slice**

Run `git diff --check`, update the two product documents with only verified behavior, commit as `feat(p7): resolve projected drawing primitives`, and push `origin/main`.

### Task 3: CAD four-view workspace

**Files:**
- Create: `apps/web/src/components/EngineeringDrawingView.tsx`
- Create: `apps/web/src/components/EngineeringDrawingView.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/components/GeometryToolbar.tsx` only for CAD-safe actions and labels
- Modify: `apps/web/src/App.test.tsx`
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`

**Interfaces:**
- `EngineeringDrawingView` receives `{ document, selectedIds, onSelect }` and does not own document mutation.
- Four view panels consume `resolveProjectedDrawing` and expose `data-drawing-view="front|top|left|axonometric"` for E2E assertions.
- Each projected SVG element carries `data-source-id` and uses the existing selection callback.

- [ ] **Step 1: Write failing UI tests**

Add a workbench test that switches to “工程制图”, finds all four view panels, verifies an empty-state message for an empty document, and verifies a loaded 3D model produces stable source IDs in all panels.

- [ ] **Step 2: Verify RED**

Run `npm.cmd test -- --run apps/web/src/components/EngineeringDrawingView.test.tsx apps/web/src/App.test.tsx`. Expected: the CAD workspace still renders the planar GraphicsView and the new view markers are absent.

- [ ] **Step 3: Build the view from existing tokens and callbacks**

Render a responsive four-panel grid with semantic titles, visible focus styles, pointer-transparent diagnostics, and keyboard-accessible view controls. Keep panel spacing, colors, borders and typography in existing CSS tokens; do not add one-off inline layout math.

- [ ] **Step 4: Route only the CAD workspace through the new view**

In `App.tsx`, render `EngineeringDrawingView` for `document.workspace === "cad"`, keep `GraphicsView` for the existing planar workspaces, and keep `ThreeSceneView` for `geometry3d`. Preserve file save/open, undo/redo and Algebra View behavior.

- [ ] **Step 5: Verify browser behavior and commit**

Run the focused UI tests, `npm.cmd run typecheck`, and the CAD Playwright scenario. Commit as `feat(p7): add cad four view workspace` and push `origin/main` after `git diff --check` passes.

### Task 4: Projection-line linking and synchronized selection

**Files:**
- Modify: `apps/web/src/components/EngineeringDrawingView.tsx`
- Modify: `apps/web/src/projectionVisuals.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/components/EngineeringDrawingView.test.tsx`
- Test: `apps/web/src/App.test.tsx`
- Modify: `e2e/geometry3d.spec.ts` or create `e2e/engineering-drawing.spec.ts`
- Modify: `docs/project-progress.md`

**Interfaces:**
- `ProjectionLine` contains `sourceId`, origin view, target view, and projected endpoints.
- Selection callback always receives the source DSL ID, never a generated SVG node ID.
- A changed `document.revision` recomputes all four drawings; view-local selection state is not persisted.

- [ ] **Step 1: Write failing synchronization tests**

Select a source point/edge in one view and assert all matching elements expose the same selected state; update a source point through the existing property path and assert projected coordinates change in all four views; toggle projection lines and assert only temporary display state changes.

- [ ] **Step 2: Implement shared selection and revision-driven recompute**

Derive view data from the current document and selected IDs, add projection-line visibility as local component state, and avoid calling `apply` from projection rendering.

- [ ] **Step 3: Verify and commit**

Run focused UI tests plus the new browser scenario, then commit as `feat(p7): link engineering drawing views` and push `origin/main`.

### Task 5: Engineering annotations and document compatibility

**Files:**
- Modify: `packages/dsl/src/types.ts`
- Modify: `packages/dsl/src/schema.ts`
- Modify: `packages/dsl/src/codec.ts`
- Test: `packages/dsl/src/codec.test.ts`
- Create or modify: `packages/geometry-kernel/src/engineeringAnnotations.ts`
- Test: `packages/geometry-kernel/src/engineeringAnnotations.test.ts`
- Modify: `apps/web/src/projectionVisuals.ts`
- Modify: `apps/web/src/components/EngineeringDrawingView.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`

**Interfaces:**
- Add optional `engineeringAnnotations?: EngineeringAnnotation[]` to `GeometryDocument`; decoder defaults missing data to `[]`.
- `EngineeringAnnotation` contains `{ id, kind, sourceIds, view, value?, unit?, tolerance?, status, explanation }`.
- `resolveEngineeringAnnotation(document, annotation)` returns finite projected geometry or a diagnostic status; it never invents a coordinate.

- [ ] **Step 1: Write failing codec and kernel tests**

Test old documents without `engineeringAnnotations`, round-trip one linear annotation, reject missing source IDs, calculate a valid length/angle, and return `insufficient-data` for a deleted or degenerate source.

- [ ] **Step 2: Verify RED**

Run `npm.cmd test -- --run packages/dsl/src/codec.test.ts packages/geometry-kernel/src/engineeringAnnotations.test.ts`. Expected: the new types/functions are absent and old decode behavior remains the control case.

- [ ] **Step 3: Add backward-compatible data and pure calculations**

Extend schema validation and codec defaults without changing `schemaVersion`, implement linear/angle/tolerance status calculations in the kernel, and use the same result for UI and export.

- [ ] **Step 4: Add accessible annotation editing**

Expose only source-valid annotation actions in the CAD properties surface, show value/unit/status, and keep invalid/degenerate states visible without committing fake values.

- [ ] **Step 5: Verify round-trip and commit**

Run codec, kernel, App and CAD browser tests; commit as `feat(p7): add engineering annotations` and push `origin/main`.

### Task 6: SVG, PDF and DXF export adapters

**Files:**
- Create: `apps/web/src/persistence/engineeringExporters.ts`
- Test: `apps/web/src/persistence/engineeringExporters.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/GeometryToolbar.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/research/graphing-tools.md` with export/license decision
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`

**Interfaces:**
- All exporters consume `ProjectedDrawing[]` and `EngineeringAnnotation[]`; none call Three.js or recalculate projections.
- `exportEngineeringSvg` returns a string with view groups, source IDs, annotations and diagnostics.
- `exportEngineeringDxf` returns ASCII entities for lines, polylines and text with stable layers.
- `exportEngineeringPdf` uses the pinned `pdf-lib` dependency to write the same vector geometry to one or more pages; its license and version are recorded in `docs/research/graphing-tools.md` before the dependency is installed.

- [ ] **Step 1: Write failing exporter tests**

Assert SVG has four named view groups and source IDs, DXF has `SECTION/ENTITIES`, `LINE`/`LWPOLYLINE`/`TEXT`, and PDF output begins with a valid PDF header and contains the expected page count.

- [ ] **Step 2: Verify RED**

Run `npm.cmd test -- --run apps/web/src/persistence/engineeringExporters.test.ts`. Expected: exporter module/functions are absent.

- [ ] **Step 3: Add the reviewed PDF dependency and implement shared-description adapters**

Record the `pdf-lib` license/version decision, add the dependency, and serialize the existing projected line/polygon/annotation descriptions only; preserve finite-value filtering and diagnostics; never rasterize the 3D canvas.

- [ ] **Step 4: Add toolbar actions and download errors**

Add CAD-only SVG/PDF/DXF buttons with accessible labels, disabled/unsupported states, and the existing file-error feedback path. Keep 3D SVG/PNG restrictions unchanged.

- [ ] **Step 5: Verify and commit**

Run exporter tests, full test/typecheck/lint/build, CAD E2E download checks, `git diff --check`, then commit as `feat(p7): export engineering drawings` and push `origin/main`.

### Task 7: P7 release gate and documentation

**Files:**
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-15-p7-engineering-drawing.md`

- [ ] **Step 1: Run the complete verification matrix**

Run `npm.cmd test -- --run`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:e2e`, and `git diff --check`. Expected: all exit code 0; existing lint warnings and Vite chunk-size warning may remain documented, but no errors or failed tests.

- [ ] **Step 2: Check requirement coverage**

Verify the four views, model synchronization, source-ID selection, projection lines, annotations, SVG/PDF/DXF output, old `.mgeo` decode, undo semantics, and CAD empty/error states against the spec acceptance list.

- [ ] **Step 3: Record evidence and commit**

Write exact test counts, build output, E2E scenario names, export format checks and known limitations into the progress/catalog/README documents.

- [ ] **Step 4: Push the release slice**

Run `git status --short`, confirm only intended files are staged, commit as `docs(p7): record engineering drawing acceptance`, and push `origin/main`.

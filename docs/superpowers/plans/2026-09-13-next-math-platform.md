# Next Math Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the current geometry kernel, add ray/polyline intersections and editing, then deliver a minimal conics/calculus workspace slice with performance evidence.

**Architecture:** Preserve existing immutable DSL documents and Scene Graph operations. Add focused geometry helpers that return the existing discriminated `IntersectionResult`; keep UI adapters responsible for finite viewport rendering while kernel APIs remain coordinate-space based. Conics and calculus remain sampled MVP primitives with explicit validation and deterministic numeric APIs.

**Tech Stack:** TypeScript, React, Vite, Vitest, Playwright, existing `robust-predicates` dependency.

**Spec:** `docs/project-progress.md` and the approved numeric-robustness design.

## Global Constraints

- Do not modify Agent, Provider, routing, model configuration, or question-image parsing code.
- Preserve existing `line`, `segment`, `circle`, `arc`, and intersection API compatibility.
- Every behavior change requires a failing test before implementation.
- Run tests, typecheck, build, and relevant browser checks before marking a task complete.

### Task 1: Numeric and Documentation Risk Closure

**Files:**
- Modify: `packages/geometry-kernel/src/polyline.ts`
- Modify: `packages/geometry-kernel/src/polyline.test.ts`
- Modify: `docs/project-progress.md`
- Modify: `README.md`

- [x] Add extreme finite-coordinate tests for ray predicates, polyline distance, and length overflow behavior.
- [x] Implement scaled `Math.hypot` calculations and deterministic invalid-input handling.
- [x] Update the progress date and README capability list.
- [x] Run focused and full verification.

### Task 2: Ray and Polyline Intersection Kernel

**Files:**
- Modify: `packages/geometry-kernel/src/intersections.ts`
- Modify: `packages/geometry-kernel/src/index.ts`
- Modify: `packages/geometry-kernel/src/intersections.test.ts`

- [x] Add failing tests for ray-line, ray-circle, polyline-line, and polyline-circle intersections, including endpoint deduplication.
- [x] Implement parameter-filtered ray results and per-segment polyline aggregation using `IntersectionResult`.
- [x] Preserve existing infinite-line and circle wrappers.
- [x] Run geometry-kernel tests and typecheck.

### Task 3: Ray and Polyline Scene/UI Integration

**Files:**
- Modify: `packages/scene-graph/src/operations.ts`
- Modify: `packages/scene-graph/src/patches.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/GeometryToolbar.tsx`
- Modify: `apps/web/src/components/GraphicsView.tsx`
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] Add failing tests for ray creation, polyline completion, selection, persistence, and endpoint/vertex editing.
- [x] Add operation validation and immutable updates for ray/polyline edits.
- [x] Add finite viewport rendering and creation gestures without changing Agent surfaces.
- [x] Run unit, typecheck, build, and Playwright checks.

### Task 4: Conics and Calculus MVP Kernel

**Files:**
- Modify: `packages/dsl/src/types.ts`
- Modify: `packages/dsl/src/schema.ts`
- Modify: `packages/dsl/src/codec.test.ts`
- Create: `packages/geometry-kernel/src/conics.ts`
- Create: `packages/geometry-kernel/src/calculus.ts`
- Create: `packages/geometry-kernel/src/conics.test.ts`
- Create: `packages/geometry-kernel/src/calculus.test.ts`

- [ ] Add failing tests for parabola, ellipse, and hyperbola validation/serialization.
- [x] Add deterministic sampled points for conics with finite-domain guards.
- [x] Add function sampling, central-difference derivative, and trapezoidal integral APIs.
- [x] Run kernel and DSL verification.

### Task 5: Conics and Calculus MVP Workspace

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/GeometryToolbar.tsx`
- Modify: `apps/web/src/components/GraphicsView.tsx`
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] Add failing UI tests for workspace selection and sampled conic/function rendering.
- [ ] Add minimal workspace controls and SVG sampling display.
- [ ] Keep advanced symbolic solving and Agent behavior out of scope.
- [ ] Run Playwright and full verification.

### Task 6: Multi-Component Constraint Benchmark

**Files:**
- Modify: `packages/scene-graph/src/scene-store.test.ts`
- Modify: `docs/project-progress.md`

- [x] Add a fixed-size fixture with multiple independent constraint components.
- [x] Assert only the active component changes identity and remains within the performance budget.
- [x] Record fresh test, typecheck, build, and E2E evidence.

### Task 7: Discontinuous Function Plotting and Pannable Viewport

**Files:**
- Modify: `packages/geometry-kernel/src/calculus.ts`
- Modify: `packages/geometry-kernel/src/calculus.test.ts`
- Modify: `apps/web/src/functionGraph.ts`
- Modify: `apps/web/src/functionGraph.test.ts`
- Modify: `apps/web/src/viewport.ts`
- Modify: `apps/web/src/viewport.test.ts`
- Modify: `apps/web/src/components/GraphicsView.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `README.md`
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`

**Interfaces:**
- `sampleFunctionSegments` keeps returning separate finite sample runs and additionally rejects a sampled interval that crosses an unobserved vertical discontinuity.
- Viewport mapping accepts an explicit viewport `{ center: Coordinate; scale: number }`, while default arguments preserve the existing origin-centered behavior for non-UI callers.
- `GraphicsView` owns transient viewport state and exposes panning through middle-button drag or `Space` plus left-button drag; object drag and box selection remain separate.

- [x] Add a regression test where a singularity falls between two finite samples and assert no clipped segment becomes a vertical connector.
- [x] Add viewport mapping tests for a translated center and a UI test for panning without changing the scene document.
- [x] Implement discontinuity detection and pass the current visible world bounds to function clipping.
- [x] Implement dynamic viewport mapping, grid generation, infinite-object clipping, and explicit pan gesture handling.
- [x] Update product documentation and record fresh test, typecheck, build, and E2E evidence.

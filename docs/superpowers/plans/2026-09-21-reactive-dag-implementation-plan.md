# Reactive DAG Implementation Plan

> **For agentic workers:** Read the design spec before implementing. Execute tasks in order and run each task's tests before moving on.

**Goal:** Make parameters, constraints, triangle centers, circles, tangents, sections, measurements, and loci recompute through one cycle-safe incremental dependency graph.

**Architecture:** Add a pure evaluator graph beside existing primitive storage. Parameters are mutable sources; coordinates and derived geometry are evaluated values. Scene commits remain batched, while drag previews use transient graph snapshots and create one history entry on pointer release.

**Tech Stack:** TypeScript, `@draw/dsl`, `@draw/geometry-kernel`, `@draw/scene-graph`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-incremental-geometry-agent-and-conversations-design.md`

## Global Constraints

- Evaluators are pure and deterministic for a given graph snapshot.
- Cycles, missing sources, non-finite values, and degeneracy become structured diagnostics.
- Unconfirmed drag previews never enter undo history.
- Dynamic points store parameters and bindings, not duplicated coordinate truth.

### Task 1: Define graph and evaluator contracts

**Files:**
- Create: `packages/geometry-kernel/src/reactive/types.ts`
- Create: `packages/geometry-kernel/src/reactive/graph.ts`
- Create: `packages/geometry-kernel/src/reactive/evaluator.ts`
- Test: `packages/geometry-kernel/src/reactive/graph.test.ts`

- [x] Add failing tests for topological ordering, reverse dependency invalidation, missing-source diagnostics, and cycle detection.
- [x] Run focused tests and verify failure because the graph contracts are absent.
- [x] Implement `ReactiveGraph`, `addNode`, `setParameter`, `affectedNodes`, `evaluate`, and structured `EvaluationResult`.
- [x] Make evaluation reject cycles before calling any evaluator.
- [x] Run the focused tests and verify pass.

### Task 2: Implement parameterized point constraints

**Files:**
- Create: `packages/geometry-kernel/src/reactive/constraints.ts`
- Modify: `packages/dsl/src/types.ts`
- Modify: `packages/scene-graph/src/operations.ts`
- Test: `packages/geometry-kernel/src/reactive/constraints.test.ts`

- [x] Add tests for segment/line/circle parameters, face `u,v`, solid `u,v,w`, domain clamping, and invalid host errors.
- [x] Run focused tests and verify failure on missing evaluators.
- [x] Implement constraint evaluators using existing host geometry and strict domains.
- [x] Store generated parameter ownership so deleting a host removes orphan parameters.
- [x] Run focused tests and verify pass.

### Task 3: Add triangle centers and derived circles

**Files:**
- Create: `packages/geometry-kernel/src/reactive/triangleCenters.ts`
- Create: `packages/geometry-kernel/src/reactive/derivedCircles.ts`
- Modify: `packages/dsl/src/schema.ts`
- Test: `packages/geometry-kernel/src/reactive/triangleCenters.test.ts`

- [x] Add tests for centroid, incenter, circumcenter, orthocenter, excenter, inradius, circumradius, collinearity rejection, and moving-source recomputation.
- [x] Run focused tests and verify failure on absent center evaluators.
- [x] Implement stable plane-basis projection, weighted-center formulas, and tolerance-aware degeneracy results.
- [x] Register derived circle rules as graph nodes referencing center and source triangle nodes.
- [x] Run focused tests and verify pass.

### Task 4: Add tangent, section, measurement, and locus nodes

**Files:**
- Create: `packages/geometry-kernel/src/reactive/derivedNodes.ts`
- Create: `packages/geometry-kernel/src/reactive/locus.ts`
- Modify: `apps/web/src/threeScene.tsx`
- Modify: `apps/web/src/geometryCanvas.tsx`
- Test: `packages/geometry-kernel/src/reactive/derivedNodes.test.ts`
- Test: `apps/web/e2e/reactive-dynamic-objects.spec.ts`

- [x] Add tests for tangent updates, Solid section updates, measurement invalidation, adaptive locus subdivision, and transient Trace behavior.
- [x] Run focused tests and verify failure because derived nodes are not connected to rendering.
- [x] Connect graph evaluation results to existing preview/render paths without committing per pointer move.
- [x] Commit one compound operation on pointer release and preserve one-step undo.
- [x] Add browser coverage for moving a point and observing downstream tangent/circle/section updates.
- [x] Run focused tests and the Playwright scenario and verify pass.

### Task 5: Verify the Reactive DAG slice

- [x] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run test:e2e`.
- [x] Confirm deletion of a source produces `missing-source` rather than a world-origin fallback.
- [x] Confirm no unrelated graph nodes are evaluated when one parameter changes.

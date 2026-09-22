# Solid Prism Implementation Plan

> **For agentic workers:** Read the design spec before implementing. Execute tasks in order and run each task's tests before moving on.

**Goal:** Add a first-class `SolidPolyhedron` source model and deterministic `Prism(basePolygon, vector)` construction without breaking legacy `.mgeo` documents.

**Architecture:** Keep `polyhedron3` as the persisted/rendered compatibility shape while adding a construction descriptor as the source of truth. Generate vertices, edges, and faces through pure geometry-kernel functions; use stable Solid-scoped child IDs for downstream references.

**Tech Stack:** TypeScript, `@draw/dsl`, `@draw/geometry-kernel`, `@draw/scene-graph`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-incremental-geometry-agent-and-conversations-design.md`

## Global Constraints

- Prism side faces are generated from the base polygon and vector; agents may not assemble them as unrelated faces.
- Solid IDs use the document occupied-ID set; child IDs are deterministic under the Solid ID.
- Legacy template/from-points/from-faces documents remain readable.
- Exact, undefined, degenerate, and approximate solver results remain distinct.

### Task 1: Extend DSL construction types and codec

**Files:**
- Modify: `packages/dsl/src/types.ts`
- Modify: `packages/dsl/src/schema.ts`
- Modify: `packages/dsl/src/codec.ts`
- Test: `packages/dsl/src/schema.test.ts`
- Test: `packages/dsl/src/codec.test.ts`

- [x] Add failing tests for `solid.prism`, finite non-zero vector validation, simple polygon validation, and old-document round trips.
- [x] Run focused DSL tests and verify failure on unknown `prism` construction.
- [x] Add `SolidConstruction` prism fields and typed `SolidDerivedResult` status values.
- [x] Add strict schema validation without duplicating evaluator geometry checks.
- [x] Run focused DSL tests and verify pass.

### Task 2: Implement pure Prism topology

**Files:**
- Create: `packages/geometry-kernel/src/prism.ts`
- Modify: `packages/geometry-kernel/src/index.ts`
- Test: `packages/geometry-kernel/src/prism.test.ts`

**Interfaces:**
- `buildPrismTopology(basePolygon: readonly Vector3[], vector: Vector3): SolidTopology`.
- `validatePrismInput(...)` returns structured diagnostics.

- [x] Add tests for a triangular prism, an oblique quadrilateral prism, reversed winding, zero vector rejection, and self-intersecting base rejection.
- [x] Run the focused test and verify failure because the builder is absent.
- [x] Implement `Ti = Bi + vector`, bottom/top winding, and side face `[Bi,Bnext,Tnext,Ti]`.
- [x] Add coplanarity and parallel-edge property assertions with numeric tolerance.
- [x] Run `npm test -- packages/geometry-kernel/src/prism.test.ts` and verify pass.

### Task 3: Connect Solid source and stable child IDs

**Files:**
- Modify: `packages/scene-graph/src/actions/index.ts`
- Modify: `packages/scene-graph/src/actions/types.ts`
- Modify: `packages/scene-graph/src/patches.ts`
- Modify: `apps/web/src/solidTemplates.ts`
- Test: `packages/scene-graph/src/actions/idAllocator.test.ts`
- Test: `packages/scene-graph/src/patches.test.ts`

- [x] Add tests proving Solid creation skips occupied IDs and recreates identical child IDs after a topology recompute.
- [x] Run focused tests and verify duplicate-ID and unstable-child failures.
- [x] Add `solid.create_prism` compilation and use the document primitive ID set as allocator input.
- [x] Ensure legacy template migration remains readable and removes undefined presentation keys where required.
- [x] Run focused scene-graph tests and verify pass.

### Task 4: Add sections and sphere solver boundaries

**Files:**
- Create: `packages/geometry-kernel/src/solidDerived.ts`
- Modify: `packages/geometry-kernel/src/sections3d.ts`
- Test: `packages/geometry-kernel/src/solidDerived.test.ts`
- Test: `packages/geometry-kernel/src/sections3d.test.ts`

- [x] Add tests for box/tetrahedron circumcenters, non-spherical prism rejection, tetrahedron insphere, and section `none/point/segment/polygon` states.
- [x] Run focused tests and verify missing solver behavior.
- [x] Implement residual-checked circumsphere and insphere results; reject non-finite or degenerate inputs.
- [x] Reuse topology-adjacency section boundary ordering instead of centroid-angle sorting for non-convex loops.
- [x] Run focused geometry-kernel tests and verify pass.

### Task 5: Expose the Solid flow to UI and Agent

**Files:**
- Modify: `packages/dsl/src/schema.ts`
- Modify: `packages/agent-core/src/tools/draftTools.ts`
- Modify: `apps/web/src/agent/workerRuntime.ts`
- Test: `apps/web/src/agent/workerRuntime.test.ts`
- Test: `apps/web/e2e/solid-prism.spec.ts`

- [x] Add a worker test that compiles an oblique prism into an isolated draft and leaves the live document unchanged.
- [x] Implement action registration, draft compilation, preview counts, and Solid-derived diagnostics.
- [x] Add browser coverage for creating, moving, and sectioning an oblique prism.
- [x] Run the focused worker and Playwright tests and verify pass.

### Task 6: Verify the Solid slice

- [x] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e`, and `npm run test:rust`.
- [x] Verify old `.mgeo` fixtures load unchanged and new Prism documents round-trip through codec serialization.

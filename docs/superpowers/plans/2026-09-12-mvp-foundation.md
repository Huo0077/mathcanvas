# 多模态数理与工程交互绘图引擎 MVP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use TDD for each behavior and verification-before-completion before claiming a milestone is complete.

**Goal:** Deliver the first-week vertical slice described in the implementation plan: a React/Vite workbench that creates two lines, computes their intersection, updates it from a parameter slider, persists/restores a `.mgeo` document, and records UI changes as validated domain patches.

**Architecture:** Use a small npm-workspaces monorepo. `packages/dsl` owns versioned document types and JSON validation; `packages/scene-graph` owns dependency-aware document state and transactions; `packages/geometry-kernel` owns deterministic geometry calculations; `apps/web` renders the current document with SVG and dispatches domain operations. Rendering reads state but never becomes the source of truth.

**Tech Stack:** React, TypeScript, Vite, Zustand, Vitest, Playwright (smoke configuration), SVG overlay, npm workspaces.

**Spec:** `docs/multimodal-math-engine-implementation-plan.md`

## Global Constraints

- Every document has a `schemaVersion`, `revision`, and stable object IDs.
- UI and Agent changes enter through validated domain operations; no direct renderer mutation.
- Geometry calculations are deterministic and separated from React rendering.
- Use semantic UI tokens, accessible controls, visible focus states, and responsive layout.
- Follow TDD: write a failing test, observe the expected failure, implement the minimum, then refactor.

---

### Task 1: Monorepo and package boundaries

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `packages/dsl/package.json`
- Create: `packages/scene-graph/package.json`
- Create: `packages/geometry-kernel/package.json`

**Steps:**
- [ ] Write the workspace package manifests and TypeScript project references.
- [ ] Add React/Vite/Vitest dependencies and scripts.
- [ ] Run `npm install` and `npm run typecheck` to verify the empty scaffold.

### Task 2: DSL document model and `.mgeo` codec

**Files:**
- Create: `packages/dsl/src/types.ts`
- Create: `packages/dsl/src/schema.ts`
- Create: `packages/dsl/src/codec.ts`
- Test: `packages/dsl/src/codec.test.ts`

**Interfaces:**
- `createEmptyDocument(workspace): GeometryDocument`
- `encodeMgeo(document): string`
- `decodeMgeo(serialized): GeometryDocument`
- `validateDocument(document): ValidationResult`

**Steps:**
- [ ] Write tests for stable IDs, schema version, round-trip serialization, and rejection of missing required fields.
- [ ] Run the focused Vitest file and observe the expected failure.
- [ ] Implement the minimal typed document model and JSON codec.
- [ ] Re-run the focused test and then the package test suite.

### Task 3: Geometry kernel and dependency graph

**Files:**
- Create: `packages/geometry-kernel/src/types.ts`
- Create: `packages/geometry-kernel/src/intersections.ts`
- Create: `packages/geometry-kernel/src/evaluate.ts`
- Create: `packages/geometry-kernel/src/index.ts`
- Test: `packages/geometry-kernel/src/intersections.test.ts`
- Create: `packages/scene-graph/src/operations.ts`
- Create: `packages/scene-graph/src/scene-store.ts`
- Test: `packages/scene-graph/src/scene-store.test.ts`

**Interfaces:**
- `lineFromPoints(a, b): LinePrimitive`
- `intersectLines(first, second): Point | null`
- `applyOperation(document, operation): OperationResult`
- `recomputeDerivedObjects(document): GeometryDocument`

**Steps:**
- [ ] Write failing tests for line intersection, parallel lines, parameter updates, and derived intersection recomputation.
- [ ] Implement deterministic geometry functions and a topological recomputation pass.
- [ ] Add transaction boundaries and an undo/redo command stack around domain operations.
- [ ] Verify tests pass and cover invalid operations without mutating the prior document.

### Task 4: First React workbench and design tokens

**Files:**
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/src/components/WorkspaceHeader.tsx`
- Create: `apps/web/src/components/GeometryToolbar.tsx`
- Create: `apps/web/src/components/AlgebraView.tsx`
- Create: `apps/web/src/components/GraphicsView.tsx`
- Create: `apps/web/src/components/PropertiesBar.tsx`
- Create: `apps/web/src/components/AgentDock.tsx`
- Test: `apps/web/src/App.test.tsx`

**Steps:**
- [ ] Write a failing smoke test for the default two-line scene, intersection label, slider, and accessible buttons.
- [ ] Build the workbench using semantic tokens, CSS grid layout, SVG rendering, visible focus states, and 44px controls.
- [ ] Connect slider changes to `updateParameter` domain operations and display the derived intersection.
- [ ] Run the smoke test and inspect the responsive layout at desktop and narrow widths.

### Task 5: Persistence and UI-to-patch flow

**Files:**
- Create: `packages/scene-graph/src/patches.ts`
- Test: `packages/scene-graph/src/patches.test.ts`
- Create: `apps/web/src/persistence/mgeoStorage.ts`
- Test: `apps/web/src/persistence/mgeoStorage.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- `validatePatch(document, operation): PatchValidationResult`
- `commitPatch(store, operation): TransactionResult`
- `saveMgeo(document): void`
- `loadMgeo(serialized): GeometryDocument`

**Steps:**
- [ ] Write failing tests for patch validation, preview-before-commit, save/restore, and undo/redo.
- [ ] Implement patch validation and browser download/upload helpers.
- [ ] Wire toolbar and slider actions through the patch path only.
- [ ] Run the full unit suite and the browser smoke test.

### Task 6: Verification and first-week acceptance

**Files:**
- Modify: `README.md`
- Create: `docs/acceptance/2026-09-12-week-one.md`

**Steps:**
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and the Playwright smoke command.
- [ ] Verify the acceptance flow: create two lines, observe intersection, change a parameter, undo, redo, save, and restore.
- [ ] Record any unimplemented P0/P1 items explicitly instead of claiming broader completion.


# 3D Measurement Visualization and Quality Baseline Implementation Plan

> **For agentic workers:** Implement task-by-task with a test-first cycle. Do not commit unless the user explicitly requests it.

**Goal:** Complete the P6 v3 measurement UX and make lint, build, E2E startup, and undo history reliable.

**Architecture:** Keep measurement calculation in `packages/geometry-kernel` and document mutation in `packages/scene-graph`. Add a small pure Web visualization layer that resolves measurement geometry and screen-stable labels, then let `ThreeSceneView` own Three.js resource lifetime. Keep quality fixes at their existing boundaries: ESLint in repository configuration, Vite arguments in workspace scripts, and history trimming in the Zustand store.

**Tech Stack:** TypeScript, React 19, Vite 7, Three.js, Zustand, Vitest, Playwright, ESLint flat config.

**Spec:** `docs/superpowers/specs/2026-09-15-3d-measurement-quality-design.md`

## Global Constraints

- Preserve `schemaVersion: "0.1"` and existing 2D `.mgeo` compatibility.
- Do not add P7 engineering drawing features.
- Do not change Scene Graph measurement semantics or numeric result definitions.
- Release every new Three.js resource through the existing scene cleanup path.
- Every production behavior change needs a failing test before implementation.

---

### Task 1: Restore lint and deterministic Vite commands

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/package.json`
- Modify: `playwright.config.ts`

**Interfaces:**
- Produces a root `npm.cmd run lint` command that parses all project TypeScript and TSX files.
- Produces workspace build/preview commands that pass Vite's runner config loader without npm swallowing flags.

- [ ] **Step 1: Record the failing baseline**

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd exec -- playwright test
```

Expected: lint cannot find `eslint`; build or preview may fail while Vite writes `.vite-temp`.

- [ ] **Step 2: Add the minimal ESLint flat config and dependencies**

Add ESLint 9, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`. Ignore generated directories and use recommended correctness rules without introducing a formatting rewrite.

- [ ] **Step 3: Make workspace scripts explicit**

Change the web build and preview scripts to invoke Vite with `--configLoader runner`. Update Playwright's web server command to use the workspace preview script with the same loader and existing host/port flags.

- [ ] **Step 4: Verify quality commands**

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd exec -- playwright test
```

Expected: all commands exit successfully and Playwright starts its preview server without the `.vite-temp` permission failure.

---

### Task 2: Bound undo history without changing semantics

**Files:**
- Modify: `apps/web/src/store.ts`
- Modify: `apps/web/src/store.test.ts`

**Interfaces:**
- Export `MAX_HISTORY_ENTRIES = 100` for deterministic tests.
- Keep `apply`, preview, undo, redo, workspace switching, and replacement signatures unchanged.

- [ ] **Step 1: Write the failing test**

Add a store test that applies `MAX_HISTORY_ENTRIES + 1` distinct updates, expects exactly 100 history entries, undoes 100 times, and confirms the oldest snapshot is not reachable while recent snapshots remain valid.

- [ ] **Step 2: Verify red**

```powershell
npm.cmd test -- --run apps/web/src/store.test.ts
```

Expected: the new test fails because history currently grows without a limit.

- [ ] **Step 3: Implement minimal trimming**

Add one helper that retains the newest 100 snapshots. Use it for normal operations, preview commits, and redo history. Do not alter future ordering or preview cancellation.

- [ ] **Step 4: Verify green**

```powershell
npm.cmd test -- --run apps/web/src/store.test.ts
```

Expected: all store tests pass.

---

### Task 3: Add pure measurement visual descriptions

**Files:**
- Create: `apps/web/src/measurementVisuals.ts`
- Create: `apps/web/src/measurementVisuals.test.ts`
- Modify: `apps/web/src/threeScene.test.ts`

**Interfaces:**
- `resolveMeasurementVisual(document, measurementId): MeasurementVisual | null`
- `measurementLabelScale(cameraDistance, viewportHeight): number`
- `MeasurementVisual` contains `kind`, source IDs, finite label text/position, and optional vector/arc helper descriptions.

- [ ] **Step 1: Write failing tests**

Cover valid dihedral resolution, invalid measurements returning `null`, actual stored numeric values, and bounded label scaling when camera distance changes.

- [ ] **Step 2: Verify red**

```powershell
npm.cmd test -- --run apps/web/src/measurementVisuals.test.ts
```

Expected: the module and functions do not exist.

- [ ] **Step 3: Implement the renderer-neutral resolver**

Reuse `resolveDihedralMarker3`, existing point/line/face resolution, and the stored `Measurement3` value. Emit visuals only for valid finite measurements; never invent coordinates for insufficient or degenerate sources.

- [ ] **Step 4: Verify green**

```powershell
npm.cmd test -- --run apps/web/src/measurementVisuals.test.ts apps/web/src/threeScene.test.ts
```

Expected: focused geometry tests pass.

---

### Task 4: Integrate contextual entry and 3D canvas labels

**Files:**
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `apps/web/src/threeScene.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/threeScene.test.ts`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Keep `onCreateMeasurement(metric, dihedralKind?)` unchanged.
- Keep `ThreeSceneView` props unchanged; document and selected IDs remain the source of truth.

- [ ] **Step 1: Write failing UI/renderer tests**

Add tests that two adjacent selected faces expose interior and exterior dihedral actions, a valid dihedral renders its stored value rather than the example angle, and deleting the measurement removes the visual metadata.

- [ ] **Step 2: Verify red**

```powershell
npm.cmd test -- --run apps/web/src/App.test.tsx apps/web/src/threeScene.test.ts
```

Expected: the new assertions fail because contextual labeling and value overlays are incomplete.

- [ ] **Step 3: Implement contextual guidance**

Make the two-face selection state explicitly describe the two dihedral actions while preserving existing options for other valid selections. Do not auto-create measurements.

- [ ] **Step 4: Integrate visual objects**

Mount helper lines/arcs and screen-stable measurement labels from `MeasurementVisual`. Keep labels pointer-transparent, expose `data-measurement-label-count`, and include new objects in `disposeScene`.

- [ ] **Step 5: Add focused styling and verify**

Add a compact high-contrast label style using existing design tokens, then run:

```powershell
npm.cmd test -- --run apps/web/src/App.test.tsx apps/web/src/threeScene.test.ts apps/web/src/measurementVisuals.test.ts
```

Expected: all focused tests pass.

---

### Task 5: Full verification and documentation

**Files:**
- Modify: `docs/project-progress.md`
- Modify: `docs/feature-catalog.md`

- [ ] **Step 1: Run the complete suite**

```powershell
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd exec -- playwright test
```

Expected: every command exits with code 0.

- [ ] **Step 2: Check the diff**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only intended files are changed.

- [ ] **Step 3: Record fresh evidence**

Update progress counts and remove only the completed measurement-visualization limitation from the feature catalog. Keep numerical approximation wording and unrelated limitations intact.

- [ ] **Step 4: Re-run verification after source/config changes**

If the final pass changes source or configuration, rerun the complete suite; documentation-only changes require `git diff --check`.

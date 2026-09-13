# Dynamic Graphing Platform Implementation Plan

## Goal

Deliver the first usable slice of the approved dynamic graphing design: a richer safe expression language with function presets, then add persistent point labels and reference-aware interactions without breaking existing `.mgeo` files.

## Constraints

- Preserve the current `schemaVersion: "0.1"` codec until migration work has its own tests.
- Keep expression evaluation as a safe AST interpreter; never evaluate JavaScript supplied by users.
- Add a failing test before each behavior change.
- Keep property controls specific to the selected primitive and accessible by label/role.
- Verify tests, typecheck, build, and relevant browser coverage before each pushed slice.

## Tasks

### 1. Expand the expression kernel

- Extend the parser/evaluator with inverse trigonometric, hyperbolic, logarithmic, and constant aliases.
- Add regression tests for nested composite functions, domain-invalid values, and unknown functions.
- Keep the existing `ExpressionNode` shape compatible so Scene Graph parameter evaluation remains stable.

### 2. Add function preset metadata

- Add a typed preset catalog with categories, helper text, default domains, and safe expressions.
- Export the catalog from `@draw/geometry-kernel` and test that every preset compiles.
- Use the same compiler for preset selection and manual editing.

### 3. Integrate preset selection into the property bar

- Add an accessible grouped preset select to the function panel.
- Applying a preset updates expression and domain together while preserving manual edits afterward.
- Keep inline expression validation and the last valid rendered graph.

### 4. Strengthen point labeling interactions

- Add deterministic A/B/C/D label generation for newly created points without overwriting explicit labels.
- Add a focused point label editor test and keep current coordinate editing behavior.
- Render labels consistently for every point, including selected and derived point-like objects.

### 5. Add dynamic controls as a contained UI model

- Reuse existing `ParameterSpec` bounds and add a play/pause/stop session for one selected parameter.
- Keep animation frame changes out of undo history and honor reduced-motion preferences.
- Add unit tests for loop, once, and ping-pong boundary transitions before wiring the toolbar.

### 6. Verify and publish

- Run focused tests, full tests, typecheck, production build, and relevant Playwright checks.
- Update `docs/project-progress.md` and `docs/feature-catalog.md` only for verified behavior.
- Commit each coherent slice and push it to `origin/main`.

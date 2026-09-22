# Agent DSL and Parameter Audit Implementation Plan

> **For agentic workers:** Read the design spec before implementing. Execute tasks in order and run each task's tests before moving on.

**Goal:** Compile model plans into verified scene actions with strict references, parameter auditing, deterministic underdetermined defaults, one-shot repair, and auditable assumptions.

**Architecture:** Keep `PlanEnvelope` as the transport boundary and add a deterministic compiler pipeline: parse, audit, resolve references, complete parameters, validate geometry, and compile to isolated scene actions. The model never receives internal document authority fields.

**Tech Stack:** TypeScript, `@draw/agent-core`, `@draw/dsl`, `@draw/scene-graph`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-incremental-geometry-agent-and-conversations-design.md`

## Global Constraints

- Unknown actions and fields are rejected.
- Safe defaults are explicit assumptions; unsafe omissions become clarification.
- “Any”, “constant”, and “invariant” requests preserve symbolic parameters.
- Repair is limited to one request and shares the run budget.
- Compilation always targets an isolated draft and must preserve the live document.

### Task 1: Expand action registry and typed PlanEnvelope

**Files:**
- Modify: `packages/agent-core/src/schemas.ts`
- Modify: `packages/agent-core/src/contracts.ts`
- Modify: `packages/dsl/src/schema.ts`
- Test: `packages/agent-core/src/schemas.test.ts`
- Test: `packages/dsl/src/schema.test.ts`

- [x] Add failing tests for Prism, sphere, section, triangle center, tangent, locus, and symbolic conic actions.
- [x] Run focused schema tests and verify unknown action/field failures are reported with paths.
- [x] Add typed actions, assumptions, diagnostics, clarification questions, and repair envelopes.
- [x] Keep reference scopes closed over `draft alias` and `scene document/entity` forms.
- [x] Run focused tests and verify pass.

### Task 2: Implement parameter audit and completion

**Files:**
- Create: `packages/agent-core/src/parameterAudit.ts`
- Create: `packages/agent-core/src/defaultPolicies.ts`
- Test: `packages/agent-core/src/parameterAudit.test.ts`

**Interfaces:**
- `auditPlan(plan, context): AuditResult`.
- `completeMissingParameter(action, context): CompletionResult`.

- [x] Add tests for safe `t=0.4`, midpoint preservation when explicitly stated, inferred height, missing-host clarification, and contradictory constraints.
- [x] Run focused tests and verify failure because the audit module is absent.
- [x] Implement action-specific default policies; never use a universal zero or midpoint fallback.
- [x] Emit structured assumptions with `id`, `text`, `kind`, `value`, and `overridable`.
- [x] Run focused tests and verify pass.

### Task 3: Implement underdetermined witness selection

**Files:**
- Create: `packages/agent-core/src/underdetermined.ts`
- Test: `packages/agent-core/src/underdetermined.test.ts`
- Modify: `packages/agent-core/src/localPlanDefaults.ts`

- [x] Add tests for non-special triangle coordinates, horizontal default slope, default prism span/height, symbolic preservation for invariants, and non-degenerate validation.
- [x] Run focused tests and verify failure because witness selection is absent.
- [x] Implement deterministic priority: explicit constraints, non-degeneracy, anti-symmetry, small values, minimal complexity.
- [x] Validate generated witnesses through geometry-kernel predicates before returning them.
- [x] Run focused tests and verify pass.

### Task 4: Compile audited plans into scene actions

**Files:**
- Create: `packages/agent-core/src/planCompiler.ts`
- Modify: `packages/agent-core/src/tools/draftTools.ts`
- Modify: `apps/web/src/agent/workerRuntime.ts`
- Test: `packages/agent-core/src/planCompiler.test.ts`
- Test: `apps/web/src/agent/workerRuntime.test.ts`

- [x] Add tests for dependency ordering, occupied-ID allocation, isolated drafts, one-step repair, and unchanged live documents before confirmation.
- [x] Run focused tests and verify failure because plan compilation does not use the audit pipeline.
- [x] Implement the six stages and return structured diagnostics for each rejected stage.
- [x] Limit repair to one attempt and include only path/code/allowedChanges in the repair request.
- [x] Run focused tests and verify pass.

### Task 5: Update the production system prompt and model planner

**Files:**
- Create: `apps/web/src/agent/systemPrompt.ts`
- Modify: `apps/web/src/agent/modelPlanner.ts`
- Modify: `packages/agent-core/src/contextBuilder.ts`
- Test: `apps/web/src/agent/modelPlanner.test.ts`
- Test: `apps/web/src/agent/systemPrompt.test.ts`

- [x] Add tests asserting the prompt includes current binding, action registry, default rules, no-cross-conversation rule, and no hidden-reasoning output.
- [x] Run focused tests and verify failure because the production prompt is not centralized.
- [x] Implement the versioned prompt from the design, with context injected separately from policy text.
- [x] Make planner parsing accept only PlanEnvelope/clarification/answer and reject tool calls not present in the request.
- [x] Run focused tests and verify pass.

### Task 6: Add representative end-to-end题目回归

**Files:**
- Create: `apps/web/e2e/agent-oblique-prism.spec.ts`
- Create: `apps/web/e2e/agent-conic-invariant.spec.ts`
- Test: `apps/web/src/agent/agentRuntime.test.ts`

- [x] Add deterministic planner fixtures for the oblique-prism section and ellipse tangent invariant.
- [x] Assert the prism uses one Solid action, explicit midpoint parameters, a section node, and a movable boundary point.
- [x] Assert the conic invariant keeps a symbolic parameter and distinguishes numerical sampling from formal proof.
- [x] Run both browser scenarios and verify the live document remains unchanged until confirmation.

### Task 7: Verify the Agent DSL slice

- [x] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run test:e2e`.
- [x] Confirm all rejection paths include an actionable path/code and never claim completion without a commit receipt.
- [x] Record parameter omission rate, repair rate, clarification rate, and successful draft rate for the representative fixtures.

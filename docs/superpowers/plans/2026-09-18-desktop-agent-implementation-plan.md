# MathCanvas Desktop Agent Implementation Plan

> **For agentic workers:** Read `docs/superpowers/specs/2026-09-18-desktop-geometry-agent-design.md` first. Execute tasks in order, keep each task independently testable, and stop at every gate before starting the next stage.

**Goal:** Deliver a Windows-first Tauri desktop MathCanvas whose user-configured cloud/local models can safely understand, preview, and apply the existing 2D, 3D, and CAD capabilities, including planar and solid-geometry image input.

**Architecture:** Keep the existing TypeScript geometry kernel authoritative for geometry semantics. Add a typed Agent Core that produces isolated drafts, a trusted HostBridge that owns confirmation and document writes, and a Rust Tauri proxy/repository that owns provider transport, secrets, persistence, and compare-and-swap commits.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Vite 7, Three.js 0.186, Vitest 4, Playwright, Tauri 2, Rust async HTTP/TLS, SQLite, Windows Credential Manager.

**Spec:** `docs/superpowers/specs/2026-09-18-desktop-geometry-agent-design.md`

## Global Constraints

- Preserve the current manual workbench and `.mgeo` schema version `0.1`.
- Use one shared product action compiler for manual UI and Agent execution; do not add an Agent-only geometry implementation.
- Model output is untrusted data: no raw DSL, arbitrary `DomainOperation`, JavaScript, shell, file path, or credential-read capability is exposed to the model.
- Default Agent behavior is isolated preview → user confirmation → atomic commit → one undo snapshot.
- A write batch targets one document; cross-document reads use scoped source handles, and cross-document writes are separate confirmed steps.
- Every read/write result includes `status`, `summary`, `next_actions`, `artifacts`, and diagnostics; errors include a root-cause hint, safe retry, and stop condition.
- Current capability limits remain visible: unsupported/legacy/approximate results are not silently upgraded to success.
- API keys never enter plaintext `localStorage`, `.mgeo`, `.mcanvas`, transcripts, prompts, ordinary logs, or exported diagnostics.
- Rust loopback service binds only to loopback with an ephemeral session token, exact Origin/Host checks, finite endpoints, and no arbitrary upstream URL forwarding.
- Initial defaults: 180-second active run, 4 logical model generations, 6 network attempts, 24 tool calls, 32 staged actions per call, 128 actions per run, 256 user objects, 5,000 generated objects, 100,000 samples.
- Initial image limits: four images per run, 20 MiB and 40 megapixels per image, 2,048-pixel uploaded long edge by default.
- Initial history limits: 100 snapshots and 128 MiB soft memory budget; stale previews and consent expire instead of overwriting a newer head.
- Do not commit, push, or create branches while executing this plan unless the user separately requests it.

## Execution Rules

1. Run the failing test in each task before implementation.
2. Use `apply_patch` for source edits; keep unrelated user changes untouched.
3. A task is complete only when its listed focused tests pass and `git diff --check` is clean.
4. At a gate, record command output and stop if a required condition fails; do not skip to the next phase.
5. Keep each phase in a separate reviewable change set, but do not commit automatically.
6. Use the existing package names and path aliases; do not move the current geometry packages into Rust.

## Dependency Graph

```text
G0 execution safety
 ├─ contracts/schema ─ actions/registry ─ transactions/CAS
 ├─ source context/export preflight
 └─ draft/preview HostBridge
G1 desktop runtime (depends on G0 contracts)
 ├─ Tauri shell ─ SecretStore ─ provider adapters ─ local proxy
 └─ SQLite repository ─ project envelope ─ settings UI
G2 text Agent (depends on G0 + G1 proxy)
 ├─ coordinator/state machine ─ context/skills ─ recovery/observability
 └─ Agent UI ─ preview/consent/commit
P5 image input (depends on G2)
 ├─ attachments/ProblemIR ─ fact confirmation
 ├─ planar compiler
 └─ solid compiler
Release gates (depends on every stage)
 ├─ CAD/export parity ─ security ─ benchmarks/evals
 └─ Windows packaging/recovery/real-provider smoke tests
```

## G0 — Trusted Execution Bottom

### Task 0.1: Freeze the baseline and add the capability registry

**Files**
- Create: `packages/agent-core/package.json`, `packages/agent-core/tsconfig.json`, `packages/agent-core/src/index.ts`
- Create: `packages/agent-core/src/capabilities.ts`, `packages/agent-core/src/capabilities.test.ts`
- Modify: root `package.json` workspace list only if the new workspace is not matched by `apps/*`/`packages/*`
- Test: `packages/agent-core/src/capabilities.test.ts`

**Interfaces**
- `CapabilityStatus = "available" | "unsupported" | "legacy_readonly" | "temporarily_unavailable"`.
- `CapabilityDescriptor { id: string; status: CapabilityStatus; workspaces: Workspace[]; primitiveTypes: string[]; operationIds: string[]; preconditions: string[]; testIds: string[]; registryRevision: string }`.
- `getCapabilityRegistry(environment): CapabilityRegistry` returns a deterministic, sorted registry.
- The registry must map all 42 current primitive types and all 38 current `DomainOperation` variants to an available handler or an explicit blocked status.

- [ ] **Step 1: Write the failing registry coverage test.** Assert the registry contains the 42 types from `packages/dsl/src/types.ts` and the 38 operation IDs from `packages/scene-graph/src/operations.ts`; assert every entry has status, workspace, preconditions, and at least one test ID.
- [ ] **Step 2: Run the focused test.** Run `npm.cmd test -- packages/agent-core/src/capabilities.test.ts`; expect failure because the workspace and registry do not exist.
- [ ] **Step 3: Add the package and registry implementation.** Build the registry from a checked-in descriptor table; do not infer availability from a model response or from a UI label.
- [ ] **Step 4: Add blocked entries explicitly.** Mark `intersectionSolid` as legacy-readonly, 3D constraint solving as diagnosis-only, unsupported direct 3D SVG/PNG as unsupported, and any type without an action handler as temporarily unavailable.
- [ ] **Step 5: Run the focused test and typecheck.** Run `npm.cmd test -- packages/agent-core/src/capabilities.test.ts` and `npm.cmd run typecheck --workspace @draw/agent-core`; both must pass.

### Task 0.2: Define strict transport contracts and runtime schemas

**Files**
- Create: `packages/agent-core/src/contracts.ts`, `packages/agent-core/src/contracts.test.ts`
- Create: `packages/agent-core/src/schemas.ts`, `packages/agent-core/src/schemas.test.ts`
- Create: `packages/agent-core/src/ids.ts`
- Test: `packages/agent-core/src/contracts.test.ts`, `packages/agent-core/src/schemas.test.ts`

**Interfaces**
- `DocumentHandle { projectId; documentId; workspace; epoch; generation; contentHash }`.
- `RunContext { runId; conversationId; promptMessageId; target; sources; capabilityRevision; policyRevision }`.
- `ToolResult<T> { status; summary; next_actions; artifacts; payload; diagnostics; recovery? }`.
- `PlanEnvelope = Plan | Clarification | Answer`; unknown `kind`, fields, numeric non-finite values, and oversized arrays are rejected.
- `DraftAction` references new entities with `{ scope: "draft", alias }` and existing entities with scoped `EntityRef`; no raw primitive or operation union is accepted at the public boundary.

- [ ] **Step 1: Write schema rejection tests.** Cover unknown action IDs, unknown fields, duplicate action IDs, non-finite numbers, oversized strings/arrays, unscoped IDs, and `kind: "not-a-plan"`.
- [ ] **Step 2: Run the tests.** Run `npm.cmd test -- packages/agent-core/src/contracts.test.ts packages/agent-core/src/schemas.test.ts`; expect the tests to fail before schemas exist.
- [ ] **Step 3: Implement parse functions.** Export `parsePlanEnvelope(input: unknown): ParseResult<PlanEnvelope>` and `parseDraftAction(input: unknown): ParseResult<DraftAction>`; never cast `unknown` to a TypeScript type.
- [ ] **Step 4: Add deterministic IDs and hashes.** Export `newRunId()`, `newDraftId()`, and `canonicalContentHash(value)`; exclude timestamps and UI-only view state from the hash while including geometry and semantic project-envelope links.
- [ ] **Step 5: Verify.** Run the focused tests, `npm.cmd run typecheck --workspace @draw/agent-core`, and `git diff --check`.

### Task 0.3: Close the unknown-operation and false-change holes

**Files**
- Modify: `packages/scene-graph/src/patches.ts`
- Modify: `packages/scene-graph/src/operations.ts`
- Modify: `packages/scene-graph/src/patches.test.ts`
- Test: `packages/scene-graph/src/patches.test.ts`

**Interfaces**
- `validatePatch(document, operation)` must return invalid for an unknown runtime operation, even when TypeScript was bypassed.
- `commitPatch` must return `{ changed: false }` when execution produces no semantic document change; revision must not increase for no-op input.
- Add `isDomainOperation(value: unknown): value is DomainOperation` as the single runtime operation guard used by both validation and Agent adapters.

- [ ] **Step 1: Add failing tests.** Test an unknown op is rejected with `unknown operation`; test a valid but unchanged visibility/style update reports unchanged and leaves revision unchanged.
- [ ] **Step 2: Run `npm.cmd test -- packages/scene-graph/src/patches.test.ts`;** record the current failure that unknown operations are accepted.
- [ ] **Step 3: Implement the exhaustive runtime guard.** Add a default rejection path and make `applyOperation` report semantic change rather than unconditional recompute revision growth.
- [ ] **Step 4: Re-run the focused tests and the scene-graph suite.** Run `npm.cmd test -- packages/scene-graph/src/patches.test.ts packages/scene-graph/src/operations.test.ts packages/scene-graph/src/recomputeConsistency.test.ts`.
- [ ] **Step 5: Run `npm.cmd run typecheck --workspace @draw/scene-graph` and inspect the diff.** Do not change unrelated recompute behavior.

### Task 0.4: Add atomic transactions and order-independent deletion

**Files**
- Create: `packages/scene-graph/src/transactions.ts`, `packages/scene-graph/src/transactions.test.ts`
- Modify: `packages/scene-graph/src/operations.ts`, `packages/scene-graph/src/patches.ts`
- Modify: `apps/web/src/store.ts`, `apps/web/src/App.tsx`
- Modify: `packages/scene-graph/src/deletion-cascade.test.ts`
- Test: `packages/scene-graph/src/transactions.test.ts`, `packages/scene-graph/src/deletion-cascade.test.ts`

**Interfaces**
- `TransactionInput { base: GeometryDocument; operations: DomainOperation[]; expectedGeneration?: number }`.
- `planDeletion(document, ids): DeletionPlan` returns direct IDs, cascaded IDs, downgraded bindings, removed records, and errors.
- `commitTransaction(input): CommitResult` returns `{ changed; document; diff; errors; beforeHash; afterHash }` and executes all operations or none.
- `deleteObjects` is an internal batch operation; the public Agent action calls `planDeletion` and never loops individual `deleteObject` calls.

- [ ] **Step 1: Add regression tests.** Reproduce selection `[line,b,a]`; assert a single batch deletes the complete valid union. Add a locked dependent, a dangling reference, a mixed add/delete failure, and a success case that creates one revision.
- [ ] **Step 2: Run `npm.cmd test -- packages/scene-graph/src/transactions.test.ts packages/scene-graph/src/deletion-cascade.test.ts`;** expect the new atomic tests to fail against the current per-operation App loop.
- [ ] **Step 3: Implement plan-then-apply.** Validate every operation against a candidate document, calculate deletion closure once, apply into a clone, recompute, validate the final document, and return the original document on any error.
- [ ] **Step 4: Route manual store writes through the service.** Replace the App bulk deletion loop and `store.apply` internals with the transaction result while preserving the current one-operation undo behavior.
- [ ] **Step 5: Verify.** Run the focused tests, `npm.cmd test -- packages/scene-graph`, and `npm.cmd run typecheck --workspaces`.

### Task 0.5: Extract action handlers from App and PropertiesBar

**Files**
- Create: `packages/scene-graph/src/actions/types.ts`, `packages/scene-graph/src/actions/planar.ts`, `packages/scene-graph/src/actions/spatial.ts`, `packages/scene-graph/src/actions/dynamic.ts`, `packages/scene-graph/src/actions/cad.ts`
- Create: `packages/scene-graph/src/actions/index.ts`, `packages/scene-graph/src/actions/actions.test.ts`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/PropertiesBar.tsx`
- Test: `packages/scene-graph/src/actions/actions.test.ts`, existing App/PropertiesBar tests

**Interfaces**
- `compileActions(document, actions, context): CompileResult` consumes typed actions and returns a transaction-ready operation list plus semantic checks.
- `ActionContext { targetDocument; sourceDocuments; orderedSelection; capabilityRegistry; idAllocator; policy }`.
- Handlers cover current button semantics: templates, bindings, curve tangent anchor, circle dependencies, section materialization, intersections, offset/trim/extend, measurement, annotation, layer/drawing actions, and supported view proposals.

- [ ] **Step 1: Inventory each App/PropertiesBar callback.** Create a table in `packages/scene-graph/src/actions/actions.test.ts` mapping callback behavior to one handler and one existing test or a new test name.
- [ ] **Step 2: Write handler contract tests first.** Test one successful and one refusal path for template creation, bound point, tangent, section materialization, deletion, and CAD edit; assert no handler mutates its input document.
- [ ] **Step 3: Move pure construction and precondition logic.** Keep React callbacks as adapters that build `ActionContext` and call the compiler; do not change visual component state in this task.
- [ ] **Step 4: Add stable draft-local aliases and deterministic ID allocation.** Test retrying the same draft does not duplicate IDs and that generated topology remains hidden/user-visible according to `primitiveVisibility.ts`.
- [ ] **Step 5: Run `npm.cmd test -- packages/scene-graph/src/actions/actions.test.ts apps/web/src/App.test.tsx apps/web/src/components/PropertiesBar.test.tsx`;** then run workspace typecheck.

### G0 Gate

- [ ] `npm.cmd test -- packages/agent-core packages/scene-graph` passes.
- [ ] Runtime unknown operations are rejected; no-op commits do not increment revision.
- [ ] Batch deletion is atomic and order independent; manual UI still has one-step undo.
- [ ] A registry coverage test reports 42/42 primitive types and 38/38 operation variants mapped or explicitly blocked.
- [ ] No Agent or model network code has been added yet; only local deterministic contracts and shared action handlers exist.

Stop here for review. Do not start Tauri or model work if any G0 condition fails.

## G0.5 — Source Context, Drafts, and Preview

### Task 0.6: Add scoped source contexts and CAD preflight

**Files**
- Create: `packages/scene-graph/src/sourceContext.ts`, `packages/scene-graph/src/sourceContext.test.ts`
- Create: `apps/web/src/services/exportService.ts`, `apps/web/src/services/exportService.test.ts`
- Modify: `apps/web/src/projectionSource.ts`, `apps/web/src/projectionVisuals.ts`, `apps/web/src/components/EngineeringDrawingView.tsx`, `apps/web/src/App.tsx`
- Modify: `apps/web/src/persistence/engineeringExporters.ts`
- Test: source context, projection, engineering exporter tests

**Interfaces**
- `SourceContext { layout: DocumentHandle; geometry: DocumentHandle; viewId?: string }`.
- `resolveSourceEntity(sourceContext, EntityRef): ResolvedEntity | SourceUnavailable` requires matching document ID and current content hash.
- `buildExportPlan(input): ExportPlan` returns actual projected IDs, omissions, approximation, font loss, and source handles before producing a file.

- [ ] **Step 1: Add the reproducer test.** Empty CAD layout plus a spatial document containing one point3 must produce the same source count for display and export; same-name IDs in two documents must remain distinct.
- [ ] **Step 2: Run the focused projection/export tests and record the current mismatch.** Use `npm.cmd test -- apps/web/src/projectionVisuals.test.ts apps/web/src/projectionSource.test.ts apps/web/src/persistence/engineeringExporters.test.ts`.
- [ ] **Step 3: Implement `SourceContext` propagation.** Pass the selected source document through render, selection, annotation, diagnostics, and export; reject unavailable sources rather than falling back silently.
- [ ] **Step 4: Implement `ExportPlan` preflight.** Mark unsupported connection/locus/intersectionSet, direct 3D SVG/PNG, WinAnsi character loss, and unprojectable topology explicitly; require user acceptance for loss.
- [ ] **Step 5: Verify focused tests, `npm.cmd run typecheck --workspaces`, and an App-level source-switch test.**

### Task 0.7: Implement isolated drafts and compare-and-swap handles in TypeScript

**Files**
- Create: `apps/web/src/services/documentService.ts`, `apps/web/src/services/documentService.test.ts`
- Create: `apps/web/src/agent/draftStore.ts`, `apps/web/src/agent/draftStore.test.ts`
- Modify: `apps/web/src/store.ts`
- Test: document service and draft store tests

**Interfaces**
- `DocumentService.readHandle(workspace): Promise<DocumentSnapshot>`.
- `DocumentService.commit(candidate, expected, consent): Promise<CommitReceipt>`.
- `DraftStore.create(base, sourceContexts): DraftRecord`; `stage(draftId, actions, expectedDraftVersion)`; `invalidate(draftId, reason)`; `getPreview(draftId)`.

- [ ] **Step 1: Write tests for stale generation, epoch replacement, same-content ABA after undo, and one successful commit.** Assert a stale candidate never calls the live store replacement.
- [ ] **Step 2: Run `npm.cmd test -- apps/web/src/services/documentService.test.ts apps/web/src/agent/draftStore.test.ts`;** expect failures because the service is absent.
- [ ] **Step 3: Add generation/epoch/content-hash checks.** Treat every manual operation and undo/redo as a new generation; make workspace switching invalidate write consent.
- [ ] **Step 4: Add draft isolation.** Candidate documents are cloned/validated in memory and retain only a draft ID plus preview artifacts; no draft operation updates `useSceneStore`.
- [ ] **Step 5: Verify focused tests, existing store tests, and `npm.cmd run typecheck --workspaces`.

### Task 0.8: Add the HostBridge, worker message boundary, and consent record

**Files**
- Create: `apps/web/src/agent/hostBridge.ts`, `apps/web/src/agent/hostBridge.test.ts`
- Create: `apps/web/src/agent/agent.worker.ts`, `apps/web/src/agent/geometry.worker.ts`, `apps/web/src/agent/workerContracts.ts`
- Create: `apps/web/src/components/agent/DraftPreview.tsx`, `apps/web/src/components/agent/DraftPreview.test.tsx`
- Test: HostBridge, worker contract, preview component tests

**Interfaces**
- `HostBridge.preview(draftId): Promise<PreviewArtifact>`; `HostBridge.requestConsent(previewHash, effects): Promise<ConsentRecord>`; `HostBridge.commit(draftId, consent): Promise<CommitReceipt>`.
- `ConsentRecord { runId; draftId; draftVersion; previewHash; expectedHandles; allowedEffects; expiresAt; nonce }`.
- Worker messages always carry `runId`, `draftId`, `draftVersion`, `requestId`, and `schemaVersion`; unknown message kinds are dropped and diagnosed.

- [ ] **Step 1: Write tests for missing/expired/consumed consent, stale preview, wrong run ID, and a valid confirmation.
- [ ] **Step 2: Run `npm.cmd test -- apps/web/src/agent/hostBridge.test.ts apps/web/src/components/agent/DraftPreview.test.tsx`;** expect failures before the bridge exists.
- [ ] **Step 3: Implement the message validators and HostBridge.** Keep consent creation in Host/UI code; do not expose `commit` as a model-facing tool.
- [ ] **Step 4: Render isolated candidates through existing 2D/3D/CAD components.** Show user/derived/internal counts, assumptions, evidence, approximation, omitted exports, and the exact one-undo statement.
- [ ] **Step 5: Verify focused tests and manually exercise cancel, edit-live-document, switch-workspace, and confirm-preview paths in Playwright.

### G0.5 Gate

- [ ] A model-shaped action can only create an isolated draft.
- [ ] Display and export use the same scoped source context.
- [ ] A manual edit after preview makes the draft stale; it cannot overwrite the newer head.
- [ ] Consent is one-time, hash-bound, expires, and cannot be generated from assistant text.

Stop here for review. The rest of the plan depends on these document and preview guarantees.

## G1 — Tauri Desktop, Providers, Secrets, and Persistence

### Task 1.1: Scaffold the Tauri 2 desktop shell

**Files**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Modify: root `package.json`, `package-lock.json` only through the package manager
- Test: desktop build smoke test and existing web tests

**Interfaces**
- The desktop frontend imports the existing `apps/web` application without duplicating the geometry store.
- Rust exposes only named IPC commands; no generic command accepting JavaScript or shell text.
- `DesktopRuntime` reports `platform`, `appVersion`, `webviewVersion`, `transport`, `secretStore`, and `repository` health.

- [ ] **Step 1: Write a shell smoke test.** Start the Tauri dev/build configuration with a fake runtime and assert the web entry loads without changing workspace IDs.
- [ ] **Step 2: Run the smoke test and `npm.cmd run typecheck --workspace @draw/web`;** expect the desktop package to be absent.
- [ ] **Step 3: Add the smallest Tauri shell.** Configure a strict CSP, the existing web entry, a per-user data directory, and minimum capabilities; do not add shell, filesystem-wide, or opener permissions.
- [ ] **Step 4: Add a Rust `get_runtime_info` command.** Return no secret values and no filesystem paths outside the app data root.
- [ ] **Step 5: Verify web build and desktop shell build on Windows.** Record the installed WebView2 version and Rust/Tauri versions in the test artifact.

### Task 1.2: Implement the SecretStore abstraction and Windows backend

**Files**
- Create: `apps/desktop/src-tauri/src/secrets/mod.rs`, `apps/desktop/src-tauri/src/secrets/windows.rs`, `apps/desktop/src-tauri/src/secrets/memory.rs`
- Create: `apps/desktop/src-tauri/src/secrets/tests.rs`
- Create: `apps/web/src/services/secretClient.ts`, `apps/web/src/services/secretClient.test.ts`
- Modify: Tauri capability allowlist and command registration
- Test: Rust unit tests and frontend client tests

**Interfaces**
- Rust trait: `SecretStore { put(profile_id, secret) -> Result<()>; remove(profile_id) -> Result<()>; has(profile_id) -> Result<bool>; with_secret(profile_id, f) -> Result<T> }`.
- Frontend client: `saveSecret(profileId, value): Promise<SecretState>`, `removeSecret(profileId): Promise<void>`, `hasSecret(profileId): Promise<boolean>`; none returns plaintext.

- [ ] **Step 1: Write tests for put/has/remove, missing key, backend failure, and redacted error output.** Assert serialized logs and mock IPC responses contain no secret bytes.
- [ ] **Step 2: Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml secrets` and `npm.cmd test -- apps/web/src/services/secretClient.test.ts`;** expect failures before the trait/backends exist.
- [ ] **Step 3: Implement memory backend for tests and Windows Credential Manager backend for production.** Keep secret handling inside Rust and clear temporary buffers as far as platform APIs permit.
- [ ] **Step 4: Implement one-way frontend calls.** Clear the input after a successful save; display only `saved`, `missing`, or `error`.
- [ ] **Step 5: Verify the Windows backend on a real user profile.** Save, restart, detect, rotate, and delete a test key; confirm it is absent from project files, localStorage, and logs.

### Task 1.3: Add provider profile schemas and settings storage

**Files**
- Create: `packages/agent-core/src/providerContracts.ts`, `packages/agent-core/src/providerContracts.test.ts`
- Create: `apps/desktop/src-tauri/src/repository/provider_profiles.rs`
- Create: `apps/web/src/components/settings/ProviderSettings.tsx`, `apps/web/src/components/settings/ProviderSettings.test.tsx`
- Create: `apps/web/src/services/providerProfileClient.ts`, its test
- Modify: `apps/web/src/styles/agent.css` or shared token styles only through existing semantic tokens
- Test: schema, UI, and repository tests

**Interfaces**
- `ProviderProfile { id; name; protocol; dialect; baseUrl; modelId; secretRef?; capabilities; networkPolicy; revision }`.
- `ProviderProfileStore.list()`, `.upsert(profileWithoutSecret)`, `.remove(profileId)`, `.markHealth(profileId, health)`.
- `ProviderHealth { status; latencyMs?; capabilityEvidence[]; checkedAt; profileRevision }`.

- [ ] **Step 1: Write tests for required fields, HTTPS rules, duplicate names/IDs, secret omission, custom Base URL normalization, and profile revision increments.
- [ ] **Step 2: Build the settings UI test.** Assert labels are visible, key input is not persisted, submit shows loading then success/error, errors are focusable and link to fields, and keyboard navigation reaches every action.
- [ ] **Step 3: Run focused tests;** expect absent schemas, repository commands, and settings component failures.
- [ ] **Step 4: Implement profile CRUD without secrets.** Validate protocol/dialect allowlists, endpoint path rules, model ID length, and explicit local/LAN trust policy.
- [ ] **Step 5: Implement the CC Switch-style configuration list.** Add preset/custom selection, protocol/model fields, capability badges, latency/health state, test connection, duplicate, delete, and key status; use existing slate tokens and accessible button labels.
- [ ] **Step 6: Verify `npm.cmd test -- apps/web/src/components/settings apps/web/src/services/providerProfileClient.test.ts packages/agent-core/src/providerContracts.test.ts` and workspace typecheck.

### Task 1.4: Implement normalized provider adapters

**Files**
- Create: `apps/desktop/src-tauri/src/providers/mod.rs`, `openai_compatible.rs`, `anthropic.rs`, `ollama.rs`, `events.rs`, `adapters_tests.rs`
- Create: `packages/agent-core/src/modelEvents.ts`, `packages/agent-core/src/modelEvents.test.ts`
- Test: provider fixture files under `apps/desktop/src-tauri/test-fixtures/providers/`

**Interfaces**
- Rust trait: `ProviderAdapter::send(request: ProviderRequest, secret: SecretHandle, cancel: CancellationToken) -> Stream<ModelEvent>`.
- `ModelEvent = Started | Delta | ToolCall | Usage | Completed | Failed` with `requestId`, `attemptId`, and provider metadata.
- `ProviderRequest` is built from a validated profile and normalized messages; it has no caller-supplied arbitrary URL/header map.

- [ ] **Step 1: Add fixture tests for successful text, streaming chunks, tool calls, usage, malformed JSON, 401, 429, 5xx, and disconnect for each protocol.
- [ ] **Step 2: Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml providers`;** expect fixture tests to fail before adapters exist.
- [ ] **Step 3: Implement OpenAI-compatible path selection as an explicit dialect.** Do not assume every compatible service supports the same tools, JSON, vision, or streaming shape.
- [ ] **Step 4: Implement Anthropic Messages and Ollama message/image/event normalization.** Preserve provider-specific reasoning fields only as diagnostic metadata; do not treat them as tool results or facts.
- [ ] **Step 5: Add capability evidence probes.** Record declared/verified/failed per model/profile revision; a successful text ping must not mark vision or tools verified.
- [ ] **Step 6: Verify all fixtures, cancellation propagation, and `npm.cmd run typecheck --workspaces`.

### Task 1.5: Add the Rust loopback proxy and transport security

**Files**
- Create: `apps/desktop/src-tauri/src/proxy/mod.rs`, `routes.rs`, `auth.rs`, `limits.rs`, `redaction.rs`
- Create: `apps/desktop/src-tauri/src/proxy_tests.rs`
- Create: `apps/web/src/services/modelClient.ts`, `apps/web/src/services/modelClient.test.ts`
- Modify: Tauri command registration and desktop capability files
- Test: Rust proxy tests and browser transport tests

**Interfaces**
- Routes: `POST /v1/runs/{runId}/model`, `POST /v1/runs/{runId}/cancel`, `GET /v1/runs/{runId}/events`, `GET /v1/health`; no route accepts an upstream URL.
- Every request requires an ephemeral bearer token, exact Host, exact allowed Origin, run/profile revision, body-size limit, and a cancellation handle.
- `ModelClient.start/stream/cancel` returns normalized events and maps network failures to the error contract.

- [ ] **Step 1: Write tests for no token, wrong token, wrong Origin, wrong Host, arbitrary URL, redirect to another host, oversize body, CORS wildcard, and stale profile revision.
- [ ] **Step 2: Run the Rust proxy tests;** expect all security tests to fail before the route layer exists.
- [ ] **Step 3: Bind only to loopback on an ephemeral port.** Generate a random session token in Rust, pass it over trusted IPC, and never put it in a URL or persistent storage.
- [ ] **Step 4: Add fixed provider routes and SSRF defenses.** Validate scheme/host/path, prevent credential forwarding across redirects, restrict private/metadata addresses unless the profile explicitly trusts a local/LAN endpoint, and require TLS verification for cloud endpoints.
- [ ] **Step 5: Add streaming and cancellation.** Ensure a cancelled run cannot emit a tool event after cancellation and that disconnects do not commit partial output.
- [ ] **Step 6: Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml proxy` and browser client tests;** inspect logs for redacted Authorization/key values.

### Task 1.6: Add SQLite project repository, CAS, and crash recovery

**Files**
- Create: `apps/desktop/src-tauri/src/repository/mod.rs`, `schema.rs`, `migrations.rs`, `projects.rs`, `commits.rs`, `attachments.rs`, `recovery.rs`
- Create: `apps/desktop/src-tauri/src/repository_tests.rs`
- Create: `apps/desktop/src-tauri/src/project_package.rs`, tests
- Modify: `apps/web/src/services/documentService.ts` to call the repository adapter
- Test: migration, transaction, crash, and idempotency tests

**Interfaces**
- `ProjectRepository::read_head(project_id, document_id) -> DocumentSnapshot`.
- `ProjectRepository::commit(request: CommitRequest) -> CommitReceipt` checks epoch/generation/hash, consent nonce, idempotency key, semantic envelope size, and writes snapshot/history/events atomically.
- `ProjectRepository::lookup_commit(idempotency_key) -> CommitStatus` recovers a response lost after DB commit.
- `.mcanvas` package contains manifest, `.mgeo` documents, source/fact metadata, and optional content-hash attachments; never secrets.

- [ ] **Step 1: Write migration tests.** Create empty DB, migrate, reopen, migrate again, and inject a failed migration; assert the old DB remains usable.
- [ ] **Step 2: Write CAS/idempotency tests.** Cover stale generation, changed epoch, reused nonce, same request twice, same key with a different candidate hash, and crash between DB commit and UI response.
- [ ] **Step 3: Implement schema and atomic commit.** Store project/document heads, snapshots, commit records, run events, drafts, facts, source links, profiles without secrets, and attachment references.
- [ ] **Step 4: Implement attachment two-phase write.** Hash/size-check and atomically rename the blob first, then insert the DB reference; garbage-collect only unreferenced blobs.
- [ ] **Step 5: Implement `.mcanvas` export/import.** Validate relative paths, hashes, schema versions, attachment limits, and source links; retain `.mgeo` compatibility unchanged.
- [ ] **Step 6: Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml repository` and a Windows restart recovery smoke test.

### G1 Gate

- [ ] Tauri starts on Windows with WebView2 and the existing manual workbench.
- [ ] A cloud profile key is saved/read/deleted only through Windows Credential Manager; project and localStorage scans contain no key.
- [ ] Mock OpenAI-compatible, Anthropic, and Ollama streams normalize to the same ModelEvent contract.
- [ ] Proxy security tests reject cross-origin, arbitrary-URL, stale-profile, and oversize requests.
- [ ] A committed snapshot survives restart; repeated commit request returns the same receipt; stale commit leaves head unchanged.

Stop here for a Windows review and credential/security review before connecting the real Agent coordinator.

## G2 — Text Agent and Full-Function Tool Use

### Task 2.1: Implement the coordinator state machine and run ledger

**Files**
- Create: `packages/agent-core/src/coordinator.ts`, `packages/agent-core/src/coordinator.test.ts`
- Create: `packages/agent-core/src/runState.ts`, `packages/agent-core/src/runState.test.ts`
- Create: `packages/agent-core/src/budget.ts`, `packages/agent-core/src/budget.test.ts`
- Modify: `apps/web/src/agent/agent.worker.ts`, `apps/web/src/agent/workerContracts.ts`
- Test: coordinator, state, and budget suites

**Interfaces**
- `AgentCoordinator.start(runContext, userMessage): AsyncIterable<AgentEvent>`.
- `AgentCoordinator.cancel(runId): Promise<CancelResult>`.
- `RunLedger` transitions exactly through `created → preflight → observing → planning → compiling → validating → awaiting_confirmation → committing → completed`, or an explicit waiting/failed/cancelled/interrupted terminal path.
- `Budget.consume(kind, amount)` rejects before the limit; retry/fallback/repair share one budget.

- [ ] **Step 1: Write transition tests.** Cover a successful read-only run, a draft run, missing fact, invalid output, stale draft, user cancellation before commit, cancellation during commit, provider failure, and app interruption.
- [ ] **Step 2: Write budget tests.** Assert 4 logical generations, 6 network attempts, 24 tool calls, 32 actions/stage, 128 actions/run, context, time, and geometry budgets stop the run without head mutation.
- [ ] **Step 3: Run `npm.cmd test -- packages/agent-core/src/coordinator.test.ts packages/agent-core/src/runState.test.ts packages/agent-core/src/budget.test.ts`;** expect failures before the state machine exists.
- [ ] **Step 4: Implement explicit transitions and event emission.** Store `runId`, `promptMessageId`, `requestId`, `attemptId`, `toolCallId`, `draftVersion`, and current document handle on every event.
- [ ] **Step 5: Implement cancellation propagation.** Abort model stream, geometry worker, and tool call; discard late events unless commit status is queried by idempotency key.
- [ ] **Step 6: Verify focused tests and `npm.cmd run typecheck --workspace @draw/agent-core`.

### Task 2.2: Implement context assembly, skills, and entity observation

**Files**
- Create: `packages/agent-core/src/contextBuilder.ts`, `contextBuilder.test.ts`
- Create: `packages/agent-core/src/skills/manifest.ts`, `skills/catalog.ts`, `skills/*.json`
- Create: `packages/agent-core/src/toolRegistry.ts`, `toolRegistry.test.ts`
- Modify: `packages/agent-core/src/capabilities.ts`
- Test: context size, stale facts, pagination, skill admission, and registry tests

**Interfaces**
- `buildContext(runContext, observation, requestedSkillIds, budget): ModelContext`.
- `ToolRegistry.forPhase(phase, environment): ReadonlyArray<ToolDescriptor>` publishes 6–10 phase-specific tools.
- `SkillCatalog.load(skillId, capabilityRevision): SkillBundle` only loads packaged, hash-verified declarative content.

- [ ] **Step 1: Add tests for document scoping, duplicate labels, hidden tessellation omission, stale summary rejection, pagination, context budget, and unregistered skill rejection.
- [ ] **Step 2: Add the nine initial manifests.** Include planar basics, conics/tangents, functions, dynamic bindings, spatial modeling, sections/intersections, engineering drawing, image evidence, and safe recovery; each manifest names action IDs, limits, one success case, and one refusal case.
- [ ] **Step 3: Implement observation tools.** `scene.inspect`, `scene.search_entities`, `scene.describe_entities`, `scene.dependencies`, `scene.measure`, `scene.check_relations`, and `scene.capabilities` call real document/source services and return bounded envelopes.
- [ ] **Step 4: Implement context compaction.** Include live handles, confirmed facts, selected ordered refs, warnings, and only requested details; never include credentials, hidden tool instructions, or chain-of-thought.
- [ ] **Step 5: Run `npm.cmd test -- packages/agent-core/src/contextBuilder.test.ts packages/agent-core/src/toolRegistry.test.ts` and typecheck.

### Task 2.3: Implement model output channels and bounded recovery

**Files**
- Create: `packages/agent-core/src/modelGateway.ts`, `modelGateway.test.ts`
- Create: `packages/agent-core/src/outputParser.ts`, `outputParser.test.ts`
- Create: `packages/agent-core/src/recovery.ts`, `recovery.test.ts`
- Modify: `apps/web/src/services/modelClient.ts`
- Test: adapter mock integration tests

**Interfaces**
- `ModelGateway.generate(context, tools, profile): AsyncIterable<ModelEvent>` supports native tools, strict JSON, and text-envelope fallback.
- `parseModelEnvelope(input): ParseResult<PlanEnvelope>` permits one outer JSON fence removal, never arbitrary substring extraction or field repair.
- `RecoveryController.decide(error, state): RetryDecision` returns retry/refresh/revise/stop with a reason and budget cost.

- [ ] **Step 1: Write tests for native tool calls, strict JSON, one repair, repeated schema error, malformed partial stream, provider downgrade, and hidden reasoning fields.
- [ ] **Step 2: Run the parser/recovery tests and record failures.
- [ ] **Step 3: Implement the three channels.** Do not send a tool schema to providers that failed capability verification; return `CAPABILITY_UNAVAILABLE` when no safe channel remains.
- [ ] **Step 4: Implement recovery rules.** Retry only transport 429/5xx/connectivity within the shared budget; never retry auth, geometry, permission, or contradictory-fact failures automatically.
- [ ] **Step 5: Implement visible one-time schema repair.** Include exact JSON path errors in the second prompt; stop on the same schema failure or a second semantic no-op.
- [ ] **Step 6: Verify parser/recovery suites and provider fixture suites.

### Task 2.4: Connect typed tools to draft compilation

**Files**
- Create: `packages/agent-core/src/tools/sceneTools.ts`, `draftTools.ts`, `interactionTools.ts`
- Modify: `packages/scene-graph/src/actions/types.ts`, `packages/scene-graph/src/actions/index.ts`
- Modify: `apps/web/src/agent/hostBridge.ts`, `apps/web/src/agent/geometry.worker.ts`
- Test: `packages/agent-core/src/tools.test.ts`, `apps/web/src/agent/geometry.worker.test.ts`

**Interfaces**
- Read tools call observation services; `draft.create`, `draft.stage_actions`, `draft.validate`, `draft.preview`, and `draft.discard` call only DraftStore/GeometryActionCompiler.
- `interaction.ask_clarification` transitions the run to `waiting_input`; `interaction.propose_view` calls ViewService after UI policy; `interaction.propose_export` calls ExportPlan preflight.
- No tool function returns a fake `changed: true`; every write-like result references a draft artifact until Host consent.

- [ ] **Step 1: Test that a valid create-cube action produces only a draft and an invalid unknown action leaves the draft version unchanged.
- [ ] **Step 2: Test ambiguous label resolution, locked template topology, missing source document, and unsupported primitive/action responses.
- [ ] **Step 3: Implement tool handlers with phase/target/permission checks and bounded payloads.
- [ ] **Step 4: Connect the geometry worker to the existing compiler and return diff/check/artifact envelopes.
- [ ] **Step 5: Verify focused tools/worker tests and a Playwright draft-without-commit scenario.

### Task 2.5: Replace the demo Agent workspace with real runs

**Files**
- Modify: `apps/web/src/components/agent/AgentWorkspace.tsx`
- Modify: `apps/web/src/components/agent/AgentMessageList.tsx`, `AgentComposer.tsx`, `AgentConversationSidebar.tsx`
- Create: `apps/web/src/components/agent/RunStatus.tsx`, `ConfirmationPanel.tsx`, `AssumptionList.tsx`, `ToolTracePanel.tsx`
- Modify: `apps/web/src/agentStore.ts`, `apps/web/src/agentStore.test.ts`, `apps/web/src/styles/agent.css`
- Test: `apps/web/src/components/agent/AgentWorkspace.test.tsx`, `AgentPieces.test.tsx`, Playwright Agent specs

**Interfaces**
- `AgentWorkspace` subscribes to run events by `runId` and `conversationId`; it never creates a timer-based fake reply.
- Agent messages persist prompt, assistant summary, tool result references, attachments, draft status, and commit receipt; raw secrets and hidden reasoning are rejected.
- UI actions: stop, retry-safe, refresh context, revise, preview confirm, discard, return to canvas, and open affected entity.

- [ ] **Step 1: Add failing tests for second user prompt, conversation switching, late response, stop button, draft discard, confirmation, commit success, commit failure, and accessible error focus.
- [ ] **Step 2: Remove `composeDemoReply`/demo delay from the production path and route `sendPrompt` to Coordinator with promptMessageId.
- [ ] **Step 3: Render phase/status cards and a structured draft preview.** Loading has explicit progress; errors include a retry/revise action and field/fact links; no status relies only on color.
- [ ] **Step 4: Add confirmation modal/panel with exact changed IDs/counts, assumptions, source/target, approximation, deletion/lock warnings, and one-undo statement.
- [ ] **Step 5: Verify component tests, `npm.cmd run typecheck --workspace @draw/web`, and the Agent Playwright flow.

### Task 2.6: Add run telemetry and explicit diagnostics

**Files**
- Create: `packages/agent-core/src/events.ts`, `events.test.ts`
- Create: `apps/desktop/src-tauri/src/repository/run_events.rs`
- Create: `apps/web/src/components/agent/ToolTracePanel.tsx`
- Modify: provider proxy, coordinator, HostBridge, and agent store event plumbing
- Test: redaction and event-order tests

**Interfaces**
- Events include run/conversation/prompt/request/attempt/tool/draft/consent/commit IDs, phase, status, duration, usage, versions, and redacted diagnostics.
- `redactDiagnostic(value, knownSecrets): string` removes Authorization, key values, proxy passwords, and secret query values.
- `appendRunEvent` is append-only and idempotent by event ID; it never stores raw model reasoning or image bytes.

- [ ] **Step 1: Write ordering tests for normal completion, retry, cancellation, stale preview, and commit-receipt recovery.
- [ ] **Step 2: Write redaction tests using fake API keys in headers, prompts, URLs, errors, and tool payloads.
- [ ] **Step 3: Implement event emission at coordinator/proxy/HostBridge boundaries and store only bounded, redacted records.
- [ ] **Step 4: Render a user-facing trace with short summaries; keep detailed diagnostics behind an opt-in developer view.
- [ ] **Step 5: Run event/redaction tests and inspect a real run database for prohibited fields.

### G2 Gate

- [ ] A text request can inspect, construct, preview, confirm, commit, and undo a supported planar and spatial task.
- [ ] A model cannot write live state without a Host-created consent record.
- [ ] The production Agent no longer uses demo replies or the first-user-message lookup.
- [ ] Provider fallback, retry, repair, and cancellation are visible and budgeted.
- [ ] A 42/38 capability task matrix reports each supported item as available, blocked, or not yet implemented; no prompt-only claim of coverage remains.

Stop here for a product review with real configured models before image work.

## P5-A — Planar Image Input

### Task 3.1: Implement safe image attachment ingestion and crop transforms

**Files**
- Create: `apps/web/src/components/agent/ImageInput.tsx`, `ImageInput.test.tsx`
- Create: `packages/agent-core/src/attachments.ts`, `attachments.test.ts`
- Create: `apps/desktop/src-tauri/src/repository/attachments.rs`
- Modify: `apps/web/src/components/agent/AgentWorkspace.tsx`, HostBridge contracts
- Test: browser file/paste tests and Rust attachment tests

**Interfaces**
- `ingestImage(file): Promise<AttachmentDraft>` validates file header, MIME, dimensions, size, and pixel budget.
- `cropAttachment(id, crop, rotation): Promise<AttachmentVariant>` stores original hash, crop transform, normalized box, and upload hash.
- `AttachmentPolicy` enforces four images/run, 20 MiB/40 MP/image, and 2,048-pixel uploaded long edge unless the user explicitly selects higher quality.

- [ ] **Step 1: Write tests for PNG/JPEG/WebP headers, wrong extensions, SVG/PDF rejection, 20 MiB/40 MP overflow, EXIF orientation, crop mapping, and paste/drop/file picker input.
- [ ] **Step 2: Run focused attachment tests and record expected failures.
- [ ] **Step 3: Implement local decode, EXIF correction, EXIF removal, crop/rotate preview, and content hashing.** Do not upload the original when a crop variant is selected.
- [ ] **Step 4: Implement blob two-phase persistence and deletion/retention controls through the repository.
- [ ] **Step 5: Verify keyboard crop controls, visible upload target/provider, cancellation, and all attachment limits in Playwright.

### Task 3.2: Implement ProblemIR, evidence, and fact confirmation

**Files**
- Create: `packages/agent-core/src/problemIr.ts`, `problemIr.test.ts`
- Create: `apps/web/src/components/agent/FactConfirmation.tsx`, `FactConfirmation.test.tsx`
- Create: `apps/web/src/agent/imagePipeline.ts`, `imagePipeline.test.ts`
- Modify: context contracts and repository fact/source-link persistence
- Test: IR schema, contradiction, confidence, evidence-coordinate, and correction tests

**Interfaces**
- `ProblemIR` contains dimension, entities, facts, missing information, contradictions, goal, and schema version.
- `ProblemFact` contains origin (`user_text`, `image_text`, `image_symbol`, `visual_inference`, `layout_choice`), confidence, evidence, and confirmation state.
- `confirmFacts(ir, confirmations): ConfirmedProblem` marks rejected/superseded facts without deleting original evidence.

- [ ] **Step 1: Write tests for explicit text fact, visual right-angle inference, unknown length, conflicting labels, repeated alias, crop-coordinate mapping, and user correction precedence.
- [ ] **Step 2: Run IR/fact tests;** expect failures before schemas and confirmation UI exist.
- [ ] **Step 3: Implement strict IR parsing and evidence validation.** Confidence is metadata, not permission to commit; visual inference and layout choice default to pending.
- [ ] **Step 4: Implement the confirmation UI with original/cropped image, evidence boxes, editable value/unit fields, accept/reject, and contradiction summary.
- [ ] **Step 5: Persist confirmed facts/source links in the desktop envelope and verify a new run sees corrections instead of stale summaries.

### Task 3.3: Implement the planar image compiler

**Files**
- Create: `packages/scene-graph/src/actions/imagePlanar.ts`, `imagePlanar.test.ts`
- Create: `packages/agent-core/src/skills/image-evidence.json`, `planar-image-cases.json`
- Modify: action registry and capability descriptors
- Test: planar image compiler and dataset cases

**Interfaces**
- `compilePlanarProblem(problem, context): CompileResult` accepts only confirmed facts and registered planar actions.
- Layout-only coordinates create labeled layout positions, not metric geometry; explicit dimensions/relations create validated geometry parameters.
- Unsupported/ambiguous curve, tangent, or function facts return `MISSING_FACT` or `CAPABILITY_UNAVAILABLE` with evidence IDs.

- [ ] **Step 1: Add 25 planar cases covering triangle, circle, parallel/perpendicular lines, angle marks, intersection, conic, function, scale mismatch, OCR ambiguity, and contradictory facts.
- [ ] **Step 2: Write success/refusal assertions before implementation: explicit constraints become editable objects; visual-only measurements remain pending or become clearly labeled schematic values.
- [ ] **Step 3: Implement deterministic entity alias resolution, ID allocation, action compilation, and kernel validation; do not parse model-provided point coordinates as final answers without fact origin checks.
- [ ] **Step 4: Connect compiler output to DraftPreview and test one-step undo after confirmation.
- [ ] **Step 5: Run `npm.cmd test -- packages/scene-graph/src/actions/imagePlanar.test.ts packages/agent-core/src/problemIr.test.ts apps/web/src/agent/imagePipeline.test.ts` and the planar image Playwright cases.

## P5-B — Solid Geometry Image Input

### Task 4.1: Add solid ProblemIR rules and model modes

**Files**
- Create: `packages/agent-core/src/solidProblem.ts`, `solidProblem.test.ts`
- Modify: `packages/agent-core/src/problemIr.ts`, `apps/web/src/components/agent/FactConfirmation.tsx`
- Create: `packages/agent-core/src/skills/solid-image-evidence.json`
- Test: solid ambiguity/non-uniqueness cases

**Interfaces**
- `SolidInterpretationMode = "condition_driven" | "legal_schematic"`.
- Condition-driven mode requires sufficient topology and dimensions/relations; schematic mode records every normalized size and camera/layout choice as `layout_choice` with `scaleUnknown: true`.
- `evaluateSolidSufficiency(problem): "ready" | "ask" | "schematic_only" | "reject"` never converts a confidence score into a dimension.

- [ ] **Step 1: Add 25 solid cases: cube, cuboid, pyramid, cylinder, cone, prism, section, occluded edge, missing height, non-unique perspective, contradictory topology, and insufficient labels.
- [ ] **Step 2: Write tests that a single perspective image cannot produce a precise height/volume without confirming conditions, and that an explicit “schematic is acceptable” response produces a visible disclaimer.
- [ ] **Step 3: Implement sufficiency and contradiction checks for Z-up, closed topology, positive sizes, coplanar faces, and source/section dependencies.
- [ ] **Step 4: Add a UI mode choice and display “题设精确模型” versus “合法示意模型”; mode is included in draft hash and confirmation.
- [ ] **Step 5: Run the solid ProblemIR test suite and inspect all fact evidence in the preview.

### Task 4.2: Implement deterministic solid construction and section compilation

**Files**
- Create: `packages/scene-graph/src/actions/imageSolid.ts`, `imageSolid.test.ts`
- Modify: existing spatial/section action handlers and capability registry
- Modify: `apps/web/src/components/agent/DraftPreview.tsx`
- Test: solid compiler, topology, section, intersection, and bound-point cases

**Interfaces**
- `compileSolidProblem(problem, context): CompileResult` produces existing `cube`, `pyramid`, `cylinder`, `cone`, explicit `polyhedron3`, `plane3`, `section`, and materialized topology only through registered handlers.
- A section action receives a source draft alias and a plane in `dot(normal, point) + constant = 0` form; z=2 uses normal `(0,0,1)` and constant `-2`.
- Generated topology is not presented as independent user geometry; multi-loop/holes/status remain in the preview artifact.

- [ ] **Step 1: Add tests for a confirmed cube/section, schematic pyramid, missing-height refusal, materialized multi-loop section, invalid closed topology, and host-bound point preservation.
- [ ] **Step 2: Run the new tests before implementation and capture failures.
- [ ] **Step 3: Compile only confirmed inputs through existing `buildSolid`, `sectionMaterialization`, host binding, and intersection logic; never accept model-supplied vertices/volume as authoritative.
- [ ] **Step 4: Add source/assumption cards to the 3D preview, including generated object count, approximation, camera choice, and unknown scale.
- [ ] **Step 5: Verify one atomic confirmation/undo and a refusal that leaves the live document unchanged.

### Task 4.3: Finish image end-to-end orchestration

**Files**
- Modify: `apps/web/src/agent/imagePipeline.ts`, `apps/web/src/components/agent/AgentWorkspace.tsx`
- Modify: `packages/agent-core/src/coordinator.ts`, `contextBuilder.ts`, `toolRegistry.ts`
- Create: `e2e/agent-image-planar.spec.ts`, `e2e/agent-image-solid.spec.ts`, fixture metadata under `e2e/fixtures/agent-images/`
- Test: Playwright image workflows with mocked provider responses

**Interfaces**
- `imagePipeline` sends only the user-approved attachment variant to the selected vision profile and returns ProblemIR events.
- The same Coordinator/draft/consent/commit path is used for text and images; image mode adds evidence and confirmation states only.

- [ ] **Step 1: Add mocked provider responses for explicit planar, ambiguous planar, explicit solid, schematic solid, malformed IR, provider-without-vision, and cancellation.
- [ ] **Step 2: Implement upload → extract → fact confirmation → compile → preview → confirmation → commit event sequencing.
- [ ] **Step 3: Add tests for retaining original/intermediate evidence after extraction failure and for not re-uploading unchanged crops on fact correction.
- [ ] **Step 4: Run `npm.cmd run test:e2e -- e2e/agent-image-planar.spec.ts e2e/agent-image-solid.spec.ts`;** verify no API key or original image appears in the browser transcript fixture.
- [ ] **Step 5: Record P5-A/P5-B dataset accuracy, refusal accuracy, and object-validity results separately.

### P5 Gate

- [ ] Planar and solid images both produce editable drafts only after fact/assumption confirmation.
- [ ] An insufficient perspective image asks for information or explicitly creates a schematic; it never returns a precise fabricated dimension.
- [ ] A failed extraction retains original, crop, intermediate IR, and diagnostics without writing geometry.
- [ ] Confirmed image construction uses the same atomic transaction and undo path as text construction.

## G5 — Output Parity, Security, Evaluation, and Release

### Task 5.1: Complete CAD source/export parity

**Files**
- Modify: `apps/web/src/services/exportService.ts`, `apps/web/src/persistence/engineeringExporters.ts`, `apps/web/src/persistence/exporters.ts`
- Modify: `apps/web/src/projectionVisuals.ts`, `apps/web/src/components/EngineeringDrawingView.tsx`
- Create: `apps/web/src/services/exportService.test.ts` cases for every supported/omitted type
- Test: `e2e/agent-cad-source.spec.ts`, `e2e/agent-export-preflight.spec.ts`

**Interfaces**
- `ExportPlan` is the only input accepted by export UI and native file writer.
- `exportPlan.sourceHandles` must match the render/annotation source context; stale plan returns `EXPORT_PLAN_STALE`.
- `ExportResult` reports format, artifact ID, actual primitive count, omitted IDs/types, font loss, approximation, and source hash.

- [ ] **Step 1: Add tests for spatial source projection, duplicate IDs across documents, source deletion, `view.sourceIds`, connection/locus/intersectionSet omissions, 3D SVG/PNG refusal, and WinAnsi text loss.
- [ ] **Step 2: Run the focused export/projection tests and record existing mismatches.
- [ ] **Step 3: Implement source-aware export planning and preflight; block incomplete output by default and require an explicit user acceptance for listed loss.
- [ ] **Step 4: Keep file output separate from geometry commit.** A file failure must return a retryable export error without undoing a successful geometry commit.
- [ ] **Step 5: Verify SVG/CSV/DXF/PDF/.mgeo/.mcanvas paths in Playwright and native file dialogs; inspect output manifests.

### Task 5.2: Add security and adversarial test suite

**Files**
- Create: `packages/agent-core/src/security.test.ts`
- Create: `apps/desktop/src-tauri/src/security_tests.rs`
- Create: `e2e/agent-security.spec.ts`
- Create: `scripts/scan-agent-artifacts.mjs`
- Test: hostile prompts, image text, model output, files, proxy, logs, and permission cases

**Interfaces**
- `scan-agent-artifacts` exits nonzero on secret patterns, raw Authorization, unredacted known key values, unsafe HTML/SVG, arbitrary shell/file tools, or unbounded endpoint tools.
- Security failures return explicit error envelopes and never call `DocumentService.commit`.

- [ ] **Step 1: Add at least 100 adversarial fixtures.** Include prompt injection in image/text, unknown op/field, raw JS/shell, path traversal, UNC path, malicious SVG/CSV formula, model URL SSRF, bad Origin/Host, stale consent, replay nonce, and cross-document ID confusion.
- [ ] **Step 2: Run `npm.cmd test -- packages/agent-core/src/security.test.ts` and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml security_tests`;** expect failures for each missing gate.
- [ ] **Step 3: Add code-level validation, not prompt-only instructions.** Reject before provider call where possible; otherwise sanitize at transport/renderer boundaries and refuse commit on any violation.
- [ ] **Step 4: Run `node scripts/scan-agent-artifacts.mjs` against database fixtures, logs, dist assets, test artifacts, and project packages.
- [ ] **Step 5: Run the security Playwright suite in a clean profile and verify the UI still offers recovery actions instead of a blank error screen.

### Task 5.3: Add performance, cost, and deterministic evaluation harness

**Files**
- Create: `packages/agent-eval/` package with `runner.ts`, `cases.ts`, `metrics.ts`, `report.ts`
- Create: `e2e/fixtures/agent-cases/` with the 240-case manifest and mock provider responses
- Create: `scripts/run-agent-eval.mjs`, `scripts/run-agent-benchmark.mjs`
- Test: evaluation runner unit tests and selected end-to-end cases

**Interfaces**
- `EvalCase { id; workspace; promptOrImage; providerProfile; expectedFacts; expectedActions; expectedStatus; forbiddenEffects; tolerance; timeout }`.
- `EvalResult { pass; status; committedDiff; refusalCorrect; toolCalls; retries; tokens; latency; cost; diagnostics }`.
- Reports split pass@1/pass@3, supported/refusal, provider/model, 2D/3D/CAD/image, and security groups; failures remain counted.

- [ ] **Step 1: Add runner tests for deterministic geometry comparison, expected refusal, forbidden live mutation, no-op success, cancellation, and provider fixture replay.
- [ ] **Step 2: Create the 240-case manifest: 40 planar, 30 dynamic/tangent, 25 functions, 45 3D, 30 CAD/files, 25 planar images, 25 solid images, and 20 security/recovery cases.
- [ ] **Step 3: Implement metrics for pass@1, pass@3, refusal precision, unsupported honesty, retries, tools, cost, latency, stop delay, and memory; compare numeric values using per-metric tolerance/residual.
- [ ] **Step 4: Add benchmark profiles for browser/jsdom, real WebGL, Windows Tauri, Ollama, and mocked cloud providers; label network/provider results separately from deterministic kernel results.
- [ ] **Step 5: Run `node scripts/run-agent-eval.mjs --fixture` and publish JSON/Markdown reports with model/profile/compiler/registry revisions.

### Task 5.4: Finish Windows packaging, migration, and recovery

**Files**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`, `capabilities/default.json`, installer configuration
- Create: `apps/desktop/scripts/check-webview2.ps1`, migration/recovery fixtures, and Windows smoke test script
- Modify: repository migration/recovery code and project package tests
- Test: Windows installation, upgrade, uninstall, offline, WebView2, data-directory, and disk-full scenarios

**Interfaces**
- Installer never includes secrets, test fixtures, or development endpoints.
- `check-webview2.ps1` returns a nonzero code with a user-readable remediation when the supported WebView2 runtime is absent.
- Migration is versioned, backed up, atomic, and never executes downloaded scripts.

- [ ] **Step 1: Add a clean-machine installation test.** Verify the app starts, opens the existing manual workbench, creates an offline point, and closes without an Agent profile.
- [ ] **Step 2: Add upgrade/migration tests for an old `.mgeo`, an old project DB, unknown future schema, interrupted migration, and a full data directory.
- [ ] **Step 3: Configure signed production bundle metadata, strict CSP, minimum Tauri capabilities, user data location, and WebView2 detection.
- [ ] **Step 4: Test app restart after model generation, DB commit before UI receipt, network interruption, disk-full attachment, and corrupted blob.
- [ ] **Step 5: Run the release build and install it from the produced artifact; record hashes and versions in the release report.

### Task 5.5: Add final documentation and operator runbook

**Files**
- Create: `docs/agent/user-guide.md`
- Create: `docs/agent/provider-matrix.md`
- Create: `docs/agent/security-model.md`
- Create: `docs/agent/troubleshooting.md`
- Create: `docs/agent/evaluation-report-template.md`
- Modify: `README.md`, `docs/feature-catalog.md`, `docs/project-progress.md`
- Test: Markdown link/check script and copy review

**Interfaces**
- User guide explains profile setup, key lifecycle, privacy, text/image flow, confirmation, undo, unsupported results, and local-only mode.
- Provider matrix records protocol/dialect/model/capability evidence date, not marketing assumptions.
- Troubleshooting maps every error code to a safe retry and stop condition; it never tells users to paste keys into logs.

- [ ] **Step 1: Document a first-run cloud and Ollama setup, including the exact data sent and how to delete a profile/key/session.
- [ ] **Step 2: Document planar/solid image limitations and the distinction between precise and schematic models.
- [ ] **Step 3: Document operator diagnostics, redacted run IDs, export-loss confirmations, stale preview recovery, and DB backup/restore.
- [ ] **Step 4: Update feature catalog to mark P4/P5 status from actual gates, not planned capabilities; keep historical entries labeled.
- [ ] **Step 5: Run the Markdown link checker and review every command against the released package names.

### Final Release Gate

- [ ] `npm.cmd test -- --reporter=dot` passes with the final test count recorded.
- [ ] `npm.cmd run typecheck` and `npm.cmd run lint` pass; `npm.cmd run build` produces the documented web and desktop artifacts.
- [ ] `npm.cmd run test:e2e` passes the manual, Agent text, Agent image, CAD source, export, security, and recovery suites on the supported Windows environment.
- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passes; native install/restart/key/proxy/repository smoke tests pass.
- [ ] Registry coverage remains 42/42 primitive types and 38/38 operation variants mapped or explicitly blocked.
- [ ] Eval report meets the design target: pass@1 ≥ 90%, pass@3 ≥ 97% on the supported task set, 100% confirmed-fact safety for committed image tasks, zero unauthorized head mutations, and zero known-key artifact leaks.
- [ ] Unsupported/approximate/unknown provider capabilities are displayed honestly; no provider brand is called fully supported without model/profile evidence.
- [ ] Release artifacts, hashes, migration backup behavior, rollback instructions, and known limitations are documented.

## Implementation Checkpoints and Stop Conditions

| Checkpoint | Required evidence | Stop immediately when |
| --- | --- | --- |
| After G0 | focused unit tests, registry report, transaction diff tests | unknown operation accepted, partial delete, or draft mutates live state |
| After G0.5 | source parity, stale CAS, preview/consent Playwright | source falls back silently or old preview can commit |
| After G1 | Windows SecretStore/proxy/repository evidence | key appears in files/logs, proxy accepts arbitrary URL, or commit is not idempotent |
| After G2 | real/mock provider run traces and undo | demo reply remains, late response writes, or model claims success without receipt |
| After P5 | planar/solid datasets and fact reports | visual inference becomes hard geometry without confirmation |
| Before release | full unit/type/lint/build/e2e/native/eval/security | any release gate is missing or results are not attributable to a version |

When a gate fails, preserve the failing fixture, record the exact error code and revision, and fix the smallest responsible layer. Do not compensate with a longer prompt, an extra hidden model pass, a larger retry limit, or an automatic destructive operation.

## Plan Self-Review

- [ ] The design spec sections are represented: desktop/proxy (Tasks 1.1–1.6), typed tools/state (Tasks 2.1–2.6), planar/solid image flow (Tasks 3.1–4.3), source/export (Task 5.1), security (Task 5.2), budgets/evaluation (Task 5.3), persistence/packaging (Task 5.4), and user operations (Task 5.5).
- [ ] Every task has explicit files, interfaces, focused tests, expected precondition/failure behavior, and a verification command.
- [ ] No task grants the model raw DSL, arbitrary operations, shell, filesystem, or credential access.
- [ ] All operations that can alter geometry pass through the same transaction/compiler path and are subject to a version-bound confirmation.
- [ ] All 42 primitive types and 38 operation variants are covered by the capability registry gate rather than implied by prompt text.
- [ ] Planar and solid image inputs retain original/intermediate evidence and distinguish confirmed conditions from visual inference and layout choices.
- [ ] The plan does not claim that current source code already implements P4/P5, Rust/Tauri, real-provider support, or native verification.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-18-desktop-agent-implementation-plan.md`. Execute G0 first and stop at each gate. The next implementation request should begin with Task 0.1, then proceed in dependency order; do not begin G1 or model traffic until the G0 gate is green.

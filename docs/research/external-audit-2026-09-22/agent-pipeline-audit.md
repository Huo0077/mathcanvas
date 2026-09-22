# Audit — the Agent pipeline (`packages/agent-core/**`, `apps/web/src/agent/**`)

Scope: transport schemas, parameter audit, underdetermined witness selection, plan compiler, coordinator,
ports, context builder, system prompt, model planner, draft store, worker runtime, agent runner, host bridge,
observation. Revision audited: `30dda29` (feature round `7cff139`..`30dda29`).

Method: **read** the code and its call sites (nothing in the repo was modified except this file). Five focused
probes were written **outside the repo** (`D:\draw\_audit\*.probe.ts`) and run with
`npx vitest run --config D:\draw\_audit\vitest.config.mjs` from `D:\draw\draw`; each finding below quotes the
observed output. The already-existing suites for the audited scope were also run once:
`npx vitest run packages/agent-core/src apps/web/src/agent` → **46 files / 614 passed + 1 todo** (green, so
none of the findings below is caught today). No Playwright, no dev server, no full suite, no git writes.

The known gaps listed in the newest batch section of `docs/project-progress.md` (items ①–⑩: §8.1 boundary
walk, Reactive-DAG preview ownership, per-document conversation product choice, retraction has no UI,
witness only reachable for prisms, five centres/spheres `unsupported_action`, single-vertex template edits,
`approximate`/`degenerate` unreachable + no real-provider payload assertion, the `no object <id>` /
`invalid_json` echo channels, duplicate truncation warnings) were **excluded** from this report.

---

## Critical

### C1. The one-shot consent binds the document **as it is at the moment the user clicks confirm**, not as it was when the preview was rendered — so a draft compiled against revision N is committed onto the document the user edited after seeing the preview (design §1.2 / §5.4 "check generation at commit" is vacuous)

**Files/lines**

- `apps/web/src/agent/hostBridge.ts:150-171` — `requestConsent(draftId)` reads `dependencies.live()` **at consent
  time** (`:152`), takes `const handle = current.handle` (`:154`) and stores it as
  `expectedHandles: { target: handle, sources: [] }` (`:165`).
- `apps/web/src/agent/hostBridge.ts:200-205` — `commit` is the Compare-and-Swap: it compares the live handle to
  `consent.expectedHandles.target`, i.e. to the handle captured milliseconds earlier in `requestConsent`.
- `apps/web/src/agent/hostBridge.ts:196-198` — `stale_preview` compares the draft's *current* `previewHash` /
  `draftVersion` against the consent record, which was minted from that same current preview. Both checks are
  therefore self-referential.
- The draft's real base is recorded (`apps/web/src/agent/draftStore.ts:51,230-239`, `assertFresh`) and *is*
  checked — but only in `stage` (`packages/agent-core/src/committerAdapter.ts:100`), never on the confirm path.
- Production ordering: `apps/web/src/agent/agentRunner.ts:583` → `apps/web/src/agent/agentRuntime.ts:387-392`
  (`requestConsent` immediately followed by `commit`), while the draft was created earlier, at stage time
  (`committerAdapter.ts:95-97`).
- The only test for this gate uses the **opposite** order — `apps/web/src/agent/pipeline.test.ts:80-104`
  requests consent *before* the manual edit.

**Minimal failing scenario** (probe `D:\draw\_audit\consent-base.probe.ts`, real `DraftStore` + real `HostBridge`)

1. `doc` = empty conics document, revision 0. `drafts.create(doc, handleOf(doc))`, stage one `planar.create_point`
   → `ok`.
2. The user edits the canvas while the confirmation panel is on screen: `doc = { ...doc, revision: 1, primitives:
   [{ id: "point-manual", … }] }`.
3. Click 确认并提交: `bridge.requestConsent(draftId)` → `bridge.commit(draftId, consent.record)`.

Observed

```text
A receipt: {"ok":true,"receipt":{"changed":true,"draftId":"draft_1"}}
  doc ids: ["point-manual","point-1"]   revision: 2   editedRevision: 1
B (consent minted before the edit, the order the test uses): {"ok":false,"reason":"stale_source"}
```

Wrong: the commit succeeds and lands the draft's `point-1` on top of the user's post-preview edit; the preview the
user confirmed (`candidate = base@1 + actions`) is not the document that resulted (`base@1 + user edit + actions`).
`stale_source` only fires when the document changes *between* the confirm click and the synchronous commit. The
`generation` half of §5.4's check can never disagree, because both sides are read in the same tick.

Expected: `commit` refuses with `stale_source` whenever the live document differs from the draft's base
(epoch/generation/contentHash), exactly as `assertFresh` already defines it — the user must re-preview.

**Smallest fix**: in `hostBridge.commit`, before the CAS block (`:200`), ask the draft store:

```ts
const freshness = drafts.assertFresh(draftId, current.handle)
if (!freshness.ok) return { ok: false, reason: "stale_source", detail: freshness.detail }
```

(`HostBridgeDependencies.drafts` is already the full `DraftStore`, and `assertFresh` is already implemented and
tested.) Optionally also bind the consent's `expectedHandles.target` to the draft's base handle instead of the
current one, so the CAS keeps meaning what its comment claims.

---

## Important

### I1. A genuinely no-op commit is reported as a **failed run** (`no_change` is unreachable through the real bridge), and the run is never retired

**Files/lines**

- `apps/web/src/agent/hostBridge.ts:215-216` — validation passed, but `if (!result.changed) return { ok: false,
  reason: "no_change" }`. The `ok: true, receipt: { changed: false }` shape the bridge's own type advertises
  (`apps/web/src/agent/hostBridge.ts:75`, `:222`) is never produced.
- `packages/agent-core/src/committerAdapter.ts:137-145` — `ok: false` + `reason: "no_change"` falls through to
  `return { status: "rejected", detail: "no_change" }`; the `receipt.changed ? "committed" : "no_change"` branch
  at `:139` is dead.
- `packages/agent-core/src/coordinator.ts:466-471` — the `no_change → completed ("nothing needed to change")`
  branch is therefore unreachable; the run takes `:474-475` instead.
- `apps/web/src/agent/agentRuntime.ts:393` — the `receipt.changed === false → "no_change"` mapping is dead too.
- `apps/web/src/agent/agentRunner.ts:585-589` records `{ status: "failed", detail: "no_change" }` for the user,
  and `:618-622` does **not** retire the run (only `committed`/`no_change` retire), so the panel stays and every
  further click repeats the failure.

**Minimal failing scenario** (probe `D:\draw\_audit\no-change2.probe.ts`; `point-1` is already at (5,5))

Plan = one `object.update_inputs` writing the values the object already has
(`inputs: { target: {scope:"scene",ref:{documentId,entityId:"point-1"}}, patch: { x: 5, y: 5 } }`); drive the real
`createCommitterAdapter` → `stage` → `HostBridge.requestConsent` → `commit`.

Observed: `adapter stage: {"ok":true,…}` then
`adapter commit outcome (what the coordinator switches on): {"status":"rejected","detail":"no_change"}`;
the coordinator ends `failed: commit refused: no_change`, the user sees “没有完成 · commit refused: no_change”
for a plan that legitimately needed no change.

Expected: `{ status: "no_change" }` → coordinator `completed` (`the document was updated` / `nothing needed to
change` are the two honest outcomes), the run retires, the panel disappears.

**Smallest fix**: `return { ok: true, receipt: { changed: false, draftId } }` when `!result.changed` in
`hostBridge.commit`. Either side of the seam alone is enough (the adapter's existing `:139` mapping already
handles it); fixing the bridge keeps `CommitReason["no_change"]` and the `ok:true` receipt shape truthful.

### I2. `planCompiler` resolves only the **first** registered reference field, so the second reference of three registered actions can never point at an alias created in the same plan — and it is reported as the wrong error, wasting the single repair attempt

**Files/lines**

- `packages/agent-core/src/planCompiler.ts:338-340` — `const reference = referenceFieldsFor(action.actionId)[0]`
  (the rest of `:338-419` only ever touches that one field).
- The registry **does** declare multiple references, and its own comment says the list exists exactly because
  “只登记一个的后果是另一个既不解析也不校验 … 把‘别名没解析’误报成‘跨文档’”:
  `packages/agent-core/src/schemas.ts:455` (`dynamic.bind_point`: `target`, `host`),
  `:479` (`dynamic.bind_curve`: `target`, `pathId`), `:492` (`dynamic.set_radius_rule`: `circleId`, `pointId`).
- Consumers that expect the resolved value: `packages/scene-graph/src/actions/index.ts:274-276` (`host.documentId`),
  `:386-388` (`pathId`), `:405-406` (`pointId`).

**Minimal failing scenario** (probe `D:\draw\_audit\multiref.probe.ts`, real `compilePlan`)

Plan: `planar.create_circle { alias: "c" }` followed by
`dynamic.bind_curve { target: {scope:"scene",ref:{…,"point-1"}}, pathId: "draft:c", parameter: 0.5 }`
(the documented alias form for a same-batch object, §6.1).

Observed

```text
bind_curve ok: false  →  action_compile/path_not_found@envelope.actions[1]: no path draft:c
aliases: {"c":"circle-1"}                       // the alias IS known
bind_point ok: false  →  action_compile/cross_document_reference@envelope.actions[1]:
                          a binding must stay inside the target document     // host was {scope:"draft",alias:"c"}
```

Expected: `pathId`/`host` resolved through `aliases` exactly like `target` is (then `circle-1` is found and the
plan compiles); when it genuinely cannot be resolved, `unresolved_alias` — not `path_not_found`/`cross_document_reference`.
Because the reason is wrong, the one permitted repair is aimed at the wrong field and the run ends `failed`.

**Smallest fix**: iterate `referenceFieldsFor(action.actionId)` and run the existing per-field resolution for
each entry (the `list` / nested handling is already field-agnostic), e.g. wrap the current body in
`for (const reference of referenceFieldsFor(action.actionId)) { … }`.

### I3. A failure while reading the conversation record (desktop IPC) rejects `agentRunner.run` before the coordinator starts and leaves the conversation wedged: the pinned assistant message stays `pending` forever, the composer stays disabled, and the rejection is swallowed by `void onRun(...)`

**Files/lines**

- `apps/web/src/agent/agentRunner.ts:144-152` — the `try/catch` covers only `revalidateFacts`.
- `apps/web/src/agent/agentRunner.ts:155` — `await conversationRepository().readRecord(conversation.id)` is
  **outside** that `try`, directly contradicting the comment two lines below (“仓储读不到 … 就当作‘还没有长期记忆’”).
- `apps/web/src/conversationRepository.ts:741-746` — `desktopReadRecord` calls `refused(result)` on an IPC failure,
  i.e. it **throws** `ConversationRepositoryError` (only “no conversation …” maps to `null`).
- `apps/web/src/agent/agentRunner.ts:355-376` — `runPrompt` has no `try` around the pre-`coordinator.start`
  phase (`selectPlanner` + `readConversationSource` + `createAgentRuntime`), and the pin was taken at `:363`.
- `apps/web/src/components/agent/AgentWorkspace.tsx:77` — `void onRun?.(promptMessage.id, …)` (unhandled
  rejection); `apps/web/src/App.tsx:469-471` forwards straight to `agentRunner.run`. Composer busy state comes
  from `pendingReplyId` (`AgentWorkspace.tsx:114`).

**Minimal failing scenario** (probe `D:\draw\_audit\repo-throw.probe.ts`: a repository whose `readRecord` throws
`ipc failed: no such peer`, exactly what `desktopReadRecord` does when the shell answers an error)

```text
sendPrompt("画一个圆")           → pending before: true
await runner.run(userMessage.id) → run rejected with: ipc failed: no such peer   (threw: true)
pending after: true
assistant message state: [{"role":"user","pending":false},{"role":"assistant","pending":true}]
```

Wrong: no run event, no failure recorded, `pendingReplyId` stays set → the composer stays `busy`, the assistant
bubble shows “thinking” forever, and the only user-visible outcome is a console rejection.

Expected: the run reports a failure (or degrades to “no long-term memory” + one diagnostic line, which is what
the adjacent comment promises) and clears the pin.

**Smallest fix**: put `readRecord` in the same `try/catch` as `revalidateFacts` (degrade to `record = null` and
`recordDiagnostic`), and/or wrap the body of `runPrompt` after `pinRun` so any thrown error ends the pinned run
via `failPendingReply({ code: "run_failed", … })`.

### I4. For every production run the run ledger ends at `awaiting_confirmation` even when the document **was** committed: `committing` / `completed` are unreachable outside tests, so the durable `run_events` record never says the run wrote anything

**Files/lines**

- `apps/web/src/agent/agentRuntime.ts:341` — the coordinator is built with `consent: undefined` (hard-coded).
- `apps/web/src/agent/agentRunner.ts:464` — `coordinator.start({ run, userMessage })` never passes `confirmed`.
- `packages/agent-core/src/coordinator.ts:454-457` — with `!request.confirmed || !dependencies.consent` the
  generator returns while the ledger is still `awaiting_confirmation`.
- The commit itself goes around the coordinator: `apps/web/src/agent/agentRunner.ts:583` → `agentRuntime.ts:387-392`
  → `HostBridge.commit`. `grep "confirmed: true"` finds only tests (`packages/agent-core/src/coordinator.test.ts`,
  `apps/web/src/agent/agentRuntime.test.ts`), and there is no way to *resume* a run: `coordinator.start` always
  restarts at `preflight`, and `RunLedger.transition` has no `awaiting_confirmation → completed` edge
  (`packages/agent-core/src/runState.ts:82`).
- Those ledger events are persisted per event (`apps/web/src/agent/agentRunner.ts:491-513` →
  `appendRunEvent` → `run_events`).

**Minimal failing scenario** (probe `D:\draw\_audit\ledger.probe.ts`, real `createAgentRuntime`, then exactly what
`agentRunner.confirm` does)

```text
phases after start: ["preflight","observing","planning","compiling","validating","awaiting_confirmation"]
confirmDraft outcome: {"status":"committed"}
document primitives: ["point-1"]
ledger phases: [... "validating","awaiting_confirmation"]   phase now: awaiting_confirmation
```

Wrong: the durable record of a run that changed the document is indistinguishable from one still waiting for the
user for the rest of the process's life — the ledger never becomes terminal after a commit (`TERMINAL_PHASES` is
reached only on `failed`/`cancelled`/`interrupted`), so `committing`, `completed` and the coordinator-side consent
gate are exercised by tests only.

Expected: the ledger advances `awaiting_confirmation → committing → completed` (or `failed`) on the real confirm
path, so §9's “failure never fakes completion” also holds in the other direction.

**Smallest fix**: keep the host-bridge commit where it is, but let the runner advance the ledger after
`confirmDraft()` — the minimal honest form is a coordinator method (e.g. `recordHostCommit(outcome)`) that
transitions `awaiting_confirmation → committing → completed|failed`; alternatively make `start` resumable from
`awaiting_confirmation` with a host-minted `consent` instead of re-running `preflight`/`observing`/`planning`.

---

## Minor

### M1. `actions_per_stage` is never reset, so the repair round shares one allowance with the first stage and an otherwise legal plan dies as “budget exhausted”

**Files/lines**: `packages/agent-core/src/budget.ts:24,83,116-118` (`beginStage()` resets it and says so);
`packages/agent-core/src/coordinator.ts:387-388` charges `actions_per_stage` before **each** stage; `beginStage`
has **no caller outside `budget.test.ts`** (`grep -n beginStage packages apps`), so it degenerates into a second
per-run counter that the repair attempt also draws on.

**Minimal failing scenario** (probe `D:\draw\_audit\per-stage.probe.ts`: 20-action plan, committer fails once with
a repair request, then succeeds)

```text
actions=20 limits={}                        → failed:budget exhausted: budget_actions_per_stage
                                              stage calls: 1  remaining actions_per_stage: 12  actions_per_run: 108
actions=20 limits={"actions_per_stage":20}  → same
```

Wrong: the per-stage limit (32 by default) was respected by every single stage, and `actions_per_run` still has
108 actions left; the run reports a budget exhaustion that did not happen and loses its repair.
Expected: `budget.beginStage()` before each charge (or charge once, inside the store that actually stages).

**Related, same class**: `packages/agent-core/src/skills/manifest.ts:52,96,114,123` declare
`limits.actionsPerStage` / `actionsPerRun` per skill, they are carried into `ModelContext.skills[].limits`, and
`grep` shows they are **never consumed** (only asserted for self-consistency in `skills/catalog.test.ts`), so a
32-action plan is accepted for a manifest that declares 8 per stage.

### M2. The context budget (and `time` / `geometry` budgets) are never charged: `buildContext` accepts a `Budget` and never uses it

**Files/lines**: `packages/agent-core/src/contextBuilder.ts:107` (`budget: Budget` in the input, no other
reference in the file); `packages/agent-core/src/coordinator.ts:190-205` passes it, and `:241` only logs
`facts.length` / `messages.length`; `estimatedCharacters` (`contextBuilder.ts:96-97,199`) is never compared with
`DEFAULT_BUDGET_LIMITS.context`; `packages/agent-core/src/budget.ts:50-59,128` lists `context` / `time` /
`geometry` among the kinds and in `exhausted()`.
**Observed**: `grep -n 'consume("context"|consume("time"|consume("geometry"'` over the whole repo → no match; the
three limbs of `exhausted()` can never be true, and a scene summary longer than 32k characters is still sent.
**Expected**: either charge `context` from `estimatedCharacters` (and stop/warn when the band is exhausted) or
remove the kinds — a declared budget that nothing charges is what the budget module's own doc calls “装饰”.

### M3. A plan that references a real object **outside the first 12 observed objects** dead-ends in `waiting` with a message that does not name the object

**Files/lines**: `packages/agent-core/src/sceneObservation.ts:57-58` (`DEFAULT_ENVELOPE_LIMIT = 12`);
`apps/web/src/agent/agentRuntime.ts:272-275` (`scene.inspect(target.handle.documentId)` — no limit, so both
`factIds` and the fact texts stop at 12); `packages/agent-core/src/coordinator.ts:349-355` (any `factIds` entry
outside `observation.factIds` → `waiting`); `apps/web/src/agent/agentRunner.ts:550-557` — the user message for
`waiting` is built from `active.questions()` only, which is undefined on this path, so the ledger's
“waiting for the user to confirm: `<id>`” never reaches the user.
**Observed**: with a 29-object document (the size the newest batch's own real run had), “把 solid-1 …” where
`solid-1` is object #13 produces “这一步需要你补充信息。” with no object named and no way to answer it; the
conversation context/derived readings were deliberately raised to the hard cap, the entity list was not.
**Expected**: either observe with a limit derived from the document size (the fact-set check is a consistency
gate, not a display), or say which fact is missing (the ledger already knows).

### M4. Two smaller audit-surface gaps

- **Contradictions are only detected between two `parameter.create` actions** (`packages/agent-core/src/parameterAudit.ts:316-329`).
  `parameter.create θ = 0` followed by `parameter.set θ = 1` in the same plan silently ends with θ = 1 (the
  doc-comment at `:282-288` promises “后写的赢” is exactly what must not happen); `set`-vs-`set` is the same.
  Fix: key the map by `(actionId ∈ {create,set})` + `id` and compare values.
- **A compiler-raised clarification is reported as a failure** (`ask_user`/`missing_required_field` →
  `apps/web/src/agent/draftStore.ts:204-212` → `packages/agent-core/src/coordinator.ts:418-434` → `failed`).
  The coordinator only reaches `waiting` for a `clarification` envelope or missing facts
  (`coordinator.ts:351-365`), so “圆的半径是多少？” arrives as `run_failed`. Expected: the questions the
  compiler already produced should take the `waiting` path (`agentRuntime.ts:334-338` already has the
  `questions()` surface the UI reads).

---

## Checked and found clean (read; and where noted, run)

- **`runState.ts` transition table / terminal handling** — `record()` returns `null` and `transition()` returns
  `run_finished` after `TERMINAL_PHASES`, so a late model/worker event cannot mutate a retired run
  (`runState.ts:158-188`); the `compiling → planning` repair edge is only used by the repair branch
  (`coordinator.ts:307-310`); `awaiting_confirmation → completed` is (deliberately) absent.
- **“One repair only” is per run and shared with the budget** — `repairsStarted` lives inside `run()`
  (`coordinator.ts:284`), is bumped on both the transport-parse path (`:332-335`) and the compile path
  (`:419-428`), and every repair attempt spends the same `generation`/`network` budget (`:300`). No third attempt
  is possible (`MAX_PLAN_ATTEMPTS = 1 + MAX_REPAIR_ATTEMPTS`, loop bound at `:297`).
- **Budget order-of-operations** — `consume` rejects before deducting (`budget.ts:105-114`), and every
  coordinator step spends *before* the port call (`coordinator.ts:172,244-245,300,387-388`), so a refusal cannot
  leave a half-applied step. The model planner's retry spend is guarded by `RecoveryState.remaining`
  (`recovery.ts:195-198` + `modelPlanner.ts:346-368`), so `network`/`generation` cannot be over-drawn by retries.
- **Draft isolation and per-run draft ownership** — `createAgentRuntime` builds a fresh `DraftStore` per runtime
  (`agentRuntime.ts:188`), `draftStore.create` clones the base (`draftStore.ts:120-123,143`), `stage` never writes
  the base document and leaves it untouched on failure (`draftStore.ts:188-213`), and `invalidate` removes the
  record (`:241-244`); nothing in the audited path shares a draft between runs.
- **Consent mechanics other than C1** — minted nonce set (`minted`) blocks hand-built records
  (`hostBridge.ts:179`, `hostBridge.test.ts:223-242`), one-time consumption (`:219-220`), TTL (`:181`),
  `runId` binding (`:180`),
  conversation binding vs the *current* conversation (`:188-191`), and the preview-hash/draft-version check
  (`:196-198`) are all present and unit-tested.
- **`committerAdapter` freshness on the stage path** — `assertFresh` is called before every `stage`
  (`committerAdapter.ts:100-101`), and `stale_draft_version` is kept distinct from `stale_draft`
  (`:110-127`).
- **Observation boundaries** — per-document resolution, `contentFingerprint` handle validation (`stale_source`),
  duplicate-label diagnostics and bounded paging (`sceneObservation.ts:216-340`); the four derived statuses are
  transported, not re-derived.
- **Transport schema** — unknown fields/actions/kinds, non-finite numbers, unscoped references, duplicate
  `actionKey` and empty action lists are all rejected with stable codes (`schemas.ts:105-118,931-1045`), and
  names that are not identifier-shaped are withheld from both `detail` and `path` (`isEchoableName`,
  `schemas.ts:88-117`). The `canonicalContentHash` ↔ JSON alignment (undefined dropped, non-finite still
  rejected with a path) is coherent with `contentFingerprint`.
- **Worker boundary** — `parseWorkerRequest` / `parseWorkerResponse` never throw, validate the five envelope
  fields, cap actions/operations, and require `changed`/`diff`/`artifact` (`workerContracts.ts:136-236`);
  `handleGeometryRequest` converts every failure into `geometry.error` (`workerRuntime.ts:52-98`).
- **Prompt/context separation** — policy text is generated from the registry (`systemPrompt.ts:109-123,175-247`)
  and scene/conversation data is injected separately (`:274-339`); diagnostics/assumptions are rendered field by
  field rather than serialized (`:148-172`), so no model-authored prose can reach the policy section through the
  repair block (the remaining id-echo channels are the known gap ⑨).
- **Run-event ledger hygiene** — `appendRunEvent` never throws and separates “no desktop shell” from “IPC
  failed” (`runEventClient.ts:49-66`); `events.ts` redacts by default and refuses reasoning/image fields.

## Not verified / limits of this audit

- No real provider payload was inspected (there is no configured profile on this machine); C1/I1/I4 probes use the
  real `DraftStore` + real `HostBridge` + real `createAgentRuntime`, but not a real model.
- The desktop IPC path of I3 was exercised with a throwing repository stub (the `desktopReadRecord` branch that
  throws is read, not run); the wedged-state consequence was observed directly.
- Probes and their vitest config live in `D:\draw\_audit\` (outside the repo) and can be re-run with
  `npx vitest run --config D:\draw\_audit\vitest.config.mjs` from `D:\draw\draw`.

# Audit: document model, edits and persistence (scope: `packages/scene-graph/**`, `apps/web/src/store.ts`, `apps/web/src/persistence/**`, `solidTemplates.ts`, `sceneContentSignature.ts`, document-mutating parts of `App.tsx`)

Round inspected: local commits `7cff139`..`30dda29` (Solid/Prism + Reactive DAG + Agent DSL + conversations, plus the收口 round).
Method: read the code end-to-end in the scoped files (plus the DSL schema/codec, the Rust repository, and the consumers in `apps/web/src`), traced each suspicion to its consumers, then **ran probes** for the four claims that could be executed.
Probes live **outside the repo** in `D:\draw\.audit-probe\` (`vitest.config.mjs` aliases the workspace packages to their sources); nothing in `D:\draw\draw` was modified except this report.

Known gaps in `docs/project-progress.md` (the newest batch section + the “如实缺口” list) were read first and are **not** re-reported (single-vertex template edits being refused, the `it.todo` about sections not following a translated solid, the same-alias re-stage gap, the `style: undefined` produced by `buildSolidTemplate`, the missing fact-retraction entry point, etc.).

---

## C1 — Critical: the project repository can never restore the stored document (it probes with a freshly generated document id)

**Where**
- `apps/web/src/services/documentPersistence.ts:90-92` — `restore()` builds `const fresh = dependencies.emptyDocument()` and then calls `repository.readHead(projectId, fresh.metadata.id)`.
- `apps/web/src/App.tsx:538-542` — the `emptyDocument` dependency is `() => createEmptyDocument("conics")`, and `packages/dsl/src/codec.ts:20-23,40` gives every call a **new random** id (`doc-${crypto.randomUUID()}`).
- `apps/desktop/src-tauri/src/repository/projects.rs:143-162` — `read_head` is `SELECT … WHERE project_id = ?1 AND document_id = ?2` and returns `NotFound` when no row matches (there is no “latest document of the project” fallback).
- `apps/web/src/App.tsx:549-571` — when `restored.created` is true the App **ignores `restored.document`** and falls through to the localStorage draft path.
- The unit test cannot catch it: `apps/web/src/services/documentPersistence.test.ts:34-39` uses a fake `readHead` that ignores `documentId` and always returns the stored snapshot.

**Repro (probe, `D:\draw\.audit-probe\persistence.probe.ts`, run with `node_modules\.bin\vitest run --config D:\draw\.audit-probe\vitest.config.mjs`; the double filters by `document_id` exactly like `projects.rs`)**
```
PROBE launch1 restored.created = true   calls = ["readHead(doc-0b1c2892-…)","create(doc-0b1c2892-…)"]
PROBE launch2 restored.created = true primitives = 0   calls = ["readHead(doc-9abcd083-…)","create(doc-9abcd083-…)"]
PROBE rows after launch 2 = ["doc-0b1c2892-…","doc-9abcd083-…"]      (one new row per launch)
PROBE app would use the repository document? false
```
and for the first autosave of a session whose in-memory document id is the one the store will actually keep (the store’s module-level document / the restored draft — both different from the freshly created row):
```
PROBE save of the initial document = {"ok":false,"code":"not_found","detail":"no document doc-65d4495f-…"}
```
**Wrong vs expected.** Expected (per the design comments in `documentPersistence.ts:22-29` and `App.tsx:528-536`: “仓储先答，因为它才是权威”): on launch 2 the repository returns the document that was committed on launch 1. Observed: `readHead` misses every time, a brand-new empty document row is inserted on every launch, and the App always falls back to localStorage. Worse, the autosave then commits with `document_id = <the store’s document id>` against `expected = <the freshly created row>`, so on a fresh install the Rust side answers `no document …` and **the repository never receives the user’s document at all** (it only starts working after the id is created by an “open file”/import, i.e. `reset()` → `replaceEpoch` → `create`).

Masking: the localStorage draft (`App.tsx:607-608`) is what actually restores the canvas and the document id, and `persistenceErrorShownRef` shows the repository failure **once** (`App.tsx:616-621`). So the canvas looks fine while the “authoritative” transactional layer holds only empty documents — and the only working persistence layer is the one whose write failures are deliberately swallowed (`persistence/draftStorage.ts:55-60`, quota/privacy mode). If that write is ever refused (quota), the work is gone while the app claims a project library.

**Smallest fix.** Let `restore()` probe with the id the session will really use, e.g. `App` passes `documentId: () => loadDraft(loadActiveWorkspace() ?? "conics")?.metadata.id ?? localStorage.getItem("mathcanvas:last-document-id")`, with `restore()` falling back to `create` when the probe misses (and writing that id on every successful save). The robust variant is a Rust `read_latest_document_head(project_id)` (`ORDER BY updated_at DESC LIMIT 1`) used as the fallback for `not_found`. Either way the test double must be made to filter by `documentId` so this cannot regress, and the browser path (`not_a_desktop_shell` → localStorage-only) must keep behaving exactly as it does today.

---

## C2 — Important: one interaction pushes **two** undo entries, and a single undo leaves the “moving circle” off its fixed point

**Where**
- `apps/web/src/App.tsx:1303-1330` — `handleDragEnd` commits the drag, then, for every curve whose `rotationAbout.pivot.primitiveId` is the dragged point, issues a **second** `apply(...)`.
- `apps/web/src/App.tsx:1383-1396` — `anchorRotation` (“set the selected point as the fixed point”) likewise issues two `apply(...)` calls for one button press.
- `apps/web/src/store.ts:91-101,115-124` — every `apply` pushes its own history entry; `applyBatch` (`store.ts:102-114`, tested in `store.test.ts:81-99`) exists precisely so one interaction is one step.

**Repro (probe, `D:\draw\.audit-probe\undo.probe.ts`, replaying `handleDragEnd`’s exact arithmetic against the real store: add point (3,0) → add circle centre (0,0) r=3 with `rotationAbout.pivot = point-1` → drag the point by (1,1)).**
```
before drag:   pivot(3,0)  center(0,0)  r=3  dist=3      onPoint=true   history=2
after drag:    pivot(4,1)  center(1,1)  r=3  dist=3      onPoint=true   history=4
after ONE undo:pivot(4,1)  center(0,0)  r=3  dist=4.1231 onPoint=false  history=3
after TWO undos:pivot(3,0) center(0,0)  r=3  dist=3      onPoint=true   history=2
```
**Wrong vs expected.** Expected: `Ctrl+Z` once returns to the pre-drag document (one drag = one step, as `operations.test.ts:230` asserts for the operation layer). Observed: the first undo lands on the intermediate document produced by the *first* `apply` only — pivot moved, `rotationAbout.baseCenter` not moved — which is a state that was **never rendered** (both applies run in the same event handler). Because `resolveCurveRotation`/`placedConic` recompute `center` from `pivot + baseCenter + angle`, that intermediate state is a circle that no longer passes through its own fixed point (distance 4.123 vs radius 3) — the exact failure the comment at `App.tsx:1262-1268` says the second apply exists to prevent. Redo then “repairs” it, so the corruption is invisible until the user stops undoing halfway and keeps editing/saving.

**Smallest fix.** Commit the interaction as one transaction: since the second patch is computed from the post-first-apply document (`App.tsx:1306-1317`), `applyBatch([translateOp, ...curveOps])` reproduces it exactly (operations are applied in order on the same base — see `transactions.ts:99-136`). Better, add a store-level `applySequence`/transaction helper that computes the later operations against the working copy, so future multi-step interactions cannot drift apart again. Same treatment for `anchorRotation` (2 ops) and for the `delta` loop when several curves share one pivot.

---

## C3 — Important: deleting a Prism deletes only the `polyhedron3`, leaving all 26 derived children in the document and on the canvas

**Where**
- `packages/scene-graph/src/operations.ts:2364-2390` — `deletionTargets` collects a solid’s family **only** for `construction?.kind === "template"` (`2368`); a prism (`kind: "prism"`) never matches, and the `while (added)` closure at `2378-2388` only pulls in objects that `cascadeSources` (`2260-2294`) names — `point3`/`edge3`/`face3` name nothing, so they are never added.
- `packages/scene-graph/src/actions/index.ts:211-252` — `compileSolidPrism` creates those children as ordinary **visible** `point3`/`edge3`/`face3` (no `tessellation` flag), so `apps/web/src/primitiveVisibility.ts:15-22` keeps them user-visible and `threeScene.tsx:499-514` draws each of them.
- `apps/web/src/threePicking.ts:96-112` — by design (“the `polyhedron3` *is* the object the user created … the vertices/edges/faces are its derived topology”), clicking any child resolves to the solid, i.e. the user experiences the prism as one object.

**Repro (probe, `D:\draw\.audit-probe\prism.probe.ts`).**
```
PROBE prism child count = 26
PROBE deletionTargets(solid-1) = ["solid-1"]        plan.primitives size = 1
PROBE validateDeletion = {"valid":true}
PROBE removed.changed = true
PROBE survivors = 26 ["point3:solid-1:v0", …]
PROBE document still encodes = ok
(control) template cube: deletionTargets(cube-1) size = 28, survivors = 0
```
**Wrong vs expected.** Expected: deleting the prism removes the family, exactly as for a template solid (`operations.ts:2350-2363` states the rule: the parts “exist only to draw the solid, so for deletion they are the same object”). Observed: the polyhedron disappears from the object list while its 8 vertices, 12 edges and 6 faces stay — the prism is still drawn, the faces/edges are now individually selectable and draggable, and nothing warns the user. The document stays schema-valid, so it also survives save/load in this half-deleted shape.

**Smallest fix.** Make the family rule construction-agnostic: in `deletionTargets`, match `construction?.kind === "template" || construction?.kind === "prism"` (and, for the same reason, a `fromFaces` topology that carries `sourceId`, which today is also unreachable for the family lookup at `2439/2452`). Adding a regression test next to `scene-store.test.ts:1495-1538` (delete a prism → 1 primitive left, 0 children) is cheap and would have caught this.

---

## C4 — Important: a planar `point` may be written with a dangling `onPath.pathId`; the point then silently freezes (import path accepts what the create path refuses)

**Where**
- `packages/dsl/src/schema.ts:300-313` — `point.binding.kind === "onPath"` is checked only for `typeof pathId === "string"`; the existence/type of the referenced path is **never** checked, although the very same branch (line 309) verifies the sibling `parameterId` and `point3`’s `onHost.hostId` is checked against `referenceType(byId, hostId)` at line 333.
- `packages/scene-graph/src/patches.ts:272-398` — `updatePrimitive` validates every field of the patch except `binding`/`binding3`; `operations.ts:2425` writes `patch.binding` verbatim.
- Consequence in the engine: `operations.ts:1438-1445` (`resolveBoundPoint` → `pathConstraint` miss → `null`) and `operations.ts:2024-2027` (recompute returns `undefined`), so the point keeps its stored coordinates forever; `dragBoundPoint` (`1425-1436`) also returns `null`, so the “bound” point drags like a free point.
- Contrast: the create path refuses this — `actions/index.ts:378-397` (`dynamic.bind_curve`) checks `findPrimitive(pathId)` exists.

**Repro (probe, `D:\draw\.audit-probe\misc.probe.ts`).**
```
PROBE encodeMgeo with a dangling pathId = accepted
PROBE decodeMgeo with a dangling pathId = accepted
PROBE point after recompute = {"id":"point-1",…,"x":7,"y":7,"binding":{"kind":"onPath","pathId":"ghost-1","parameter":0.5}}
PROBE dragged = true  →  {"x":8,"y":7,…, "binding":{"kind":"onPath","pathId":"ghost-1",…}}
```
Entry points: `decodeMgeo` (open a `.mgeo`, project-package import, a hand-edited file, or any document written by an older/other tool) and any caller that passes `patch.binding` to `updatePrimitive` (`apps/web/src/components/PropertiesBar.tsx:675-710` is such a caller, though its select only offers existing paths today). The document then round-trips through `encodeMgeo`/`decodeMgeo` forever, and the UI shows it as “path-bound” while it behaves as a frozen free point.

**Wrong vs expected.** Expected (stated in `schema.ts:304-309` and in `apps/web/src/store.test.ts:169-187`, which covers only the 3D case): “悬空引用会让点静默冻住，必须在校验期挡住”. Observed: the 2D path reference is the one dangling reference left unguarded.

**Smallest fix.** In `schema.ts:302-303` also require `["line","segment","ray","circle","arc","polyline","ellipse","parabola","hyperbola","function"].includes(referenceType(byId, value.binding.pathId) ?? "")`; and in `patches.ts` add a `isPointPathBindingPatch(document, patch.binding)` guard mirroring the existing `isPointReferencePatch`/`isCurveRotationPatch` helpers (patch-level rejection so `commitPatch` reports it as a patch error rather than a generic document error).

---

## M1 — Minor: a Prism’s construction descriptor is not re-checked after a drag/rotation, so it contradicts the vertices

**Where.** `operations.ts:2594-2609` (`translatePrimitive3`) and `2610-2628` (`rotatePrimitive3`) move a `polyhedron3`’s vertices without ever re-running the descriptor check; the I4 check exists **only** in the `updatePrimitive` `point3` branch (`2430-2455`, `prismMatchesVertices` at `368-390`). Spec §1.2 (“Solid 构造描述是真源，顶点、棱、面是确定性派生拓扑”) and the intent recorded in `scene-store.test.ts:1495-1523` therefore stop holding after any whole-solid drag/rotate.

**Repro (probe, `D:\draw\.audit-probe\misc.probe.ts`; square prism, base z=0, vector (1,0.5,3)).**
```
translatePrimitive3 delta (5,0,0): changed=true
  descriptor = {kind:"prism", base:{polygon:[{0,0,0},{4,0,0},{4,3,0},{0,3,0}]}, vector:{1,0.5,3}}
  actual v0  = {5,0,0}
rotatePrimitive3 30° about y:       changed=true, document still encodes = ok
  descriptor unchanged, actual v0 = {-0.415,0,1.451}
```
**Wrong vs expected.** Expected: after a whole-solid rigid move the descriptor either follows the vertices or is downgraded to `fromFaces` (the policy the same file applies to a numeric vertex edit). Observed: the document keeps claiming “I am the prism extruded from this base by this vector” for a solid that no longer is. I could not find a user-visible symptom today (rendering, sections, sphere readings and the derived-readings panel all read `vertexIds`/positions via `solidTopology3`/`polyhedronSectionTopology`; `encodeMgeo` re-validates the descriptor itself, which is still well-formed), so this is recorded as robustness/spec drift, not a live corruption. It also silently “uses up” `prismMatchesVertices`: the next single-vertex edit flips the notation to `fromFaces` with `sourceId`, and from then on `deletionTargets` still cannot find the family (see C3).

**Smallest fix.** Call the same check from both rigid-move paths (drag and rotate): for each `polyhedron3` whose `vertexIds` were moved, keep the `prism` descriptor only if `prismMatchesVertices(candidate, construction, next.primitives)` (recomputed *after* the move), otherwise rewrite it to `{ kind: "fromFaces", sourceIds: [...faceIds], sourceId: candidate.id }`.

---

## M2 — Minor: `commitTransaction` (the batch / Agent / draft write path) never validates the resulting document, unlike `commitPatch`

**Where.** `packages/scene-graph/src/patches.ts:580-591` — `commitPatch` validates the whole document after applying and refuses if it becomes invalid (the fix for “edit accepted → `encodeMgeo` throws at save time”). `packages/scene-graph/src/transactions.ts:99-136` — `commitTransaction` validates each operation with `validatePatch` and applies it, but **never** calls `validateDocument` on the result. `transactions.ts:96-98` and `patches.ts:574-578` both call it “the same unique write entry” as `commitPatch`; the Agent chain uses it end-to-end (`packages/agent-core/src/planCompiler.ts:278`, `apps/web/src/agent/hostBridge.ts:214`, `apps/web/src/agent/draftStore.ts:178-217`), and `store.applyBatch` (`store.ts:102-114`) is the human path.

**Repro.** `store.test.ts:169-187` shows the asymmetry directly: the same `updatePrimitive` that `apply` rejects is accepted by `applyBatch([...])` if `validatePatch` alone is satisfied. I tried to build a *reachable* operation for which that matters (a `point3` position edit is not exposed to the Agent — `UPDATABLE_INPUT_FIELDS` at `actions/index.ts:70` has no `position3`, and the geometric breaking cases in `validatePatch` — `size3`, `radius*`, polyline/segment degeneracy, `rotationAbout`/`anchor`/`radiusFrom` references — are all already rejected there), and did **not** find one, so I report this as a latent hole rather than a live bug.

**Smallest fix.** Add, at the end of `commitTransaction` (after the `afterHash === beforeHash` short-circuit): `const validation = validateDocument(current); if (!validation.valid) return { changed: false, document: base, diff: EMPTY_DIFF, errors: [\`the transaction would make the document invalid: ${validation.errors.slice(0,3).join(", ")}\`], beforeHash, afterHash: beforeHash }`. `agent-core`’s `planCompiler` should then surface the same diagnostic it already surfaces for per-operation failures.

---

## M3 — Minor: a batch style change silently skips locked members while the batch hide/show refuses the whole selection

**Where.** `patches.ts:527-542` validates `setPrimitivesStyle` (ids, style values) but **not** `locked`; `operations.ts:2730-2749` skips locked members with `continue` and reports nothing. For the same multi-selection, `setPrimitivesVisible` is refused outright when any selected object is locked (`patches.ts:563`).

**Repro.** Select object A (unlocked) + object B (locked), primary = A so `editable` is true (`PropertiesBar.tsx:465`), change the stroke colour → A changes colour, B does not, no error is shown; press “hide” on the same selection → nothing happens at all, with `error = "selection contains locked object"`. Expected: one policy for both batch modifiers (either refuse with a message, or apply to the unlocked members and say so).

**Smallest fix.** Mirror the `setPrimitivesVisible` guard (`patches.ts:563`) for `setPrimitivesStyle`, or make `applyOperation` return an error naming the skipped ids.

---

## Checked and found clean (with the reason)

- **`contentFingerprint` / `normalizeForComparison` vs JSON semantics** (`transactions.ts:15-30`, `operations.ts:192-210`): rebuilt objects preserve the original key order, `undefined` values are dropped exactly like `JSON.stringify`, and the one deliberate normalisation (`visible: true` ≡ missing, `locked` not) is implemented identically in both copies. I found no pair of semantically different documents that compares equal, and no same-content pair that compares unequal (the `style: undefined` / `label: undefined` producer was already fixed in `solidTemplates.ts:28-32`).
- **`sceneContentSignature.topologyOf`** (`sceneContentSignature.ts:69-80`) still uses the pre-I4 rule (`isSourceIdConstruction(...) && sourceIds.includes(sourceId)`), so it returns `""` for prisms and for `fromFaces` topologies. I traced the signature closure (`primitiveDependencies` + `templateRelations`, `operations.ts:584-665,1650-1664`) and the affected consumer (`threeScene.tsx:529-538`): the same polyhedron and its vertex positions are already inside `of(primitive.id)`’s transitive closure (the polyhedron is reachable through `section.sourceId`, and its `vertexIds` through its own dependencies), so no stale-mesh path exists. Not reported.
- **Deletion cascade for everything else**: template families, measurements, annotations, engineering annotations, constraints, group pruning (including the “fewer than 2 members ⇒ dissolve” rule), host-bound points downgraded to free with their position kept, `radiusFrom` rules dropped instead of dangling, planar `derived` bindings downgraded, orphaned `ownerId` driver parameters reclaimed (and referenced ones kept) — read together with `deletion-cascade.test.ts`, `scene-store.test.ts:751-830` and `curveTangents.test.ts:311-352`; no dangling reference or over-deletion found beyond C3.
- **`validatePatch` vs `applyOperation` field-by-field for `updatePrimitive`**: every patch field is guarded on both sides (including the `EDITABLE_GEOMETRY_TYPES`/`geometryPatchKeys` split for style-only edits on derived objects, the ray/segment/polyline degeneracy rules, and the arc/circle field split). The only gaps are the 2D `binding` field (C4) and the missing whole-document check in `commitTransaction` (M2).
- **Undo/redo identity**: documents are only ever replaced by fresh `structuredClone`-derived objects (`operations.ts:2407`), history/future hold whole snapshots, `redo` restores the same ids (verified in the C2 probe: ids `point-1`/`circle-1` survive undo→redo), and `MAX_HISTORY_ENTRIES` trimming (`store.ts:59-61`) keeps the newest snapshots.
- **`store.ts`**: workspace caching in `workspaceDocuments`, the `commitCandidate` content-fingerprint guard plus the revision bump (`store.ts:140-164`), and the “no-op batch leaves history untouched” path all behave as documented.
- **`draftStorage.ts`**: `saveDraft` encodes *before* the `try` so an invalid document is surfaced rather than swallowed; `loadDraft`’s three-way distinction (garbage JSON / JSON that cannot be decoded → quarantined under a side key / good) does not delete user work; quota failures on workbench/view preferences are deliberately ignored. No defect found (the quota swallow only becomes dangerous because of C1 — see there).
- **`migrateLegacySolids`** (`solidTemplates.ts:53-66`): idempotent, keeps user-edited labels, writes no `undefined` keys, and does not touch prisms. Clean.
- **Id allocation**: `createIdAllocator` (`actions/index.ts:35-57`) never hands out an occupied id (including sparse sets, repeated aliases, and cross-kind), `nextPrimitiveId` (human path, `App.tsx:67-71`) agrees with it, and prism child ids are a pure function of the solid id (`compileSolidPrism`, verified byte-identical in `idAllocator.test.ts:104-117`). The known same-alias re-stage gap is in the progress document and is not re-reported.
- **`decodeMgeo` migration fills** (`codec.ts:168-190`): it fills `groups`/`measurements`/`engineeringAnnotations` but not the equally-required `annotations`/`constraints`/`dynamics`. I could not construct a realistic file from any tool in this tree that lacks the latter three (every writer here starts from `createEmptyDocument`), so I did not raise it.
- **No paste/clipboard path exists** anywhere in `apps/web/src` (`grep clipboardData|onPaste` → no matches), so the “rules enforced on paste” question is moot.
- **Save/load symmetry**: `save`, `saveDraft` and `decodeMgeo` all funnel through `encodeMgeo`/`validateDocument` with the same `PRISM_SEMANTICS` validator (`codec.ts:13-18,80-84`), so create/import/save agree on prism geometry (C4 is the one exception where the schema itself is too weak, not where two paths disagree).

## Probe artifacts (outside the repo)
`D:\draw\.audit-probe\vitest.config.mjs`, `prism.probe.ts`, `undo.probe.ts`, `persistence.probe.ts`, `misc.probe.ts`.
Run from anywhere: `D:\draw\draw\node_modules\.bin\vitest.cmd run --config D:\draw\.audit-probe\vitest.config.mjs`. The `IDENTIFIER_HASH=…` lines are provenance markers. (Vitest exits 1 because Node prints a `localStorage` ExperimentalWarning on stderr in the `node` environment; the tests themselves pass.)

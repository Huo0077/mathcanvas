# Audit — desktop shell, its storage, and the conversation layer

Scope: `apps/desktop/src-tauri/**` (repository, migrations, IPC commands, secrets, proxy, shell/security config) and
the TypeScript that talks to it (`apps/web/src/services/**`, `conversationRepository.ts`, `conversationFacts.ts`,
`conversationSummary.ts`, `agentStore*.ts`). Revision audited: `30dda29` (feature round `fdb28a8`..`16a7ed1`).

Method: **read** the code (nothing was modified except this file). One focused test was **run**:
`npm run test:rust -- --test conversations` → `24 passed; 0 failed` (3.62 s, no recompile) — that confirms the
repository layer behaves as read below, and that the existing Rust conversation tests do not cover the new findings.
No Playwright, no dev server, no full suite. Findings marked "(read-only evidence)" were established by reading the
code and its call sites; I say so explicitly rather than claiming a run.

Known gaps from the newest batch of `docs/project-progress.md` were excluded from this report (Agent-switched
workspace keeps the old binding, retraction has no UI, `unsupported_action` for the five centres, single-vertex
template edits rejected, `approximate`/`degenerate` unreachable, `no object <id>` echo channel, etc.).

---

## Critical

### C1. Every desktop launch regenerates the document id it probes for, so SQLite never becomes the source of truth for documents — each launch instead creates one junk empty document, and every autosave afterwards fails with `not_found`

**Files/lines**

- `apps/web/src/services/documentPersistence.ts:90-92` — `restore()` does `const fresh = dependencies.emptyDocument()` then
  `repository.readHead(projectId, fresh.metadata.id)`.
- `apps/web/src/App.tsx:538-542` — the only production construction: `emptyDocument: () => createEmptyDocument("conics")`.
- `packages/dsl/src/codec.ts:20-23, 40` — `createEmptyDocument` stamps `metadata.id = createId("doc")`,
  and `createId` is `crypto.randomUUID()` (fallback `Math.random()`): a **new id on every call**.
- `apps/web/src/store.ts:64` — the live document is built by a *separate* `createEmptyDocument("conics")` call, so its
  `metadata.id` is never the id the adapter probed with.
- `apps/desktop/src-tauri/src/repository/projects.rs:143-163` (`read_head` filters `WHERE project_id = ?1 AND document_id = ?2`),
  `:240` (`commit` re-reads the head by `request.document_id`).
- Test blind spot: `apps/web/src/services/documentPersistence.test.ts:34-39` — the fake `readHead`/`create`/`commit`
  **ignore the `documentId` argument** and return the stored snapshot regardless, so no unit test can see an id mismatch.

**Minimal failing scenario (read-only evidence)**

1. Desktop, no localStorage draft (fresh profile, or the draft was cleared).
2. Launch. `restore()` builds `fresh` with a brand-new id, say `doc-a1b2`, and calls
   `read_document_head("local", "doc-a1b2")`. There has never been a row with a freshly generated id, so Rust returns
   `NotFound` ("no document doc-a1b2 in project local"), the adapter calls `create_document("local","doc-a1b2",…)`
   and stores that handle as its in-memory `head` (`documentPersistence.ts:114-121`).
3. The canvas document is a *different* object with a *different* id, `doc-9f3c` (`store.ts:64`); `restore()` reports
   `created: true`, so `App.tsx:550` deliberately does **not** apply the restored document — the two ids stay diverged.
4. Draw a point. The autosave effect (`App.tsx:616`) calls `persistence.save(document)`; because `head` is non-null and
   the fingerprint differs, it goes straight to `repository.commit(projectId, document /* doc-9f3c */, expected /* handle of doc-a1b2 */)`
   (`documentPersistence.ts:144`).
5. Rust `commit` → `read_head("local","doc-9f3c")` → `NotFound` → the command returns
   `no document doc-9f3c in project local`, which `documentRepository.ts:76` classifies as `not_found`
   (not `stale_head`, so the adapter's recovery branch at `documentPersistence.ts:151` never runs and `head` is never fixed).

**Observed**: `documents`/`snapshots` gain one *empty* document (new random id) **per launch** and never receive the
user's edits; the app shows `本地项目库保存失败，改动只保留在会话内：no document doc-9f3c in project local` once
(`App.tsx:617-620`). After a restart the work reappears only because `saveDraft`/`loadDraft`
(`App.tsx:608`, `App.tsx:559`, `persistence/draftStorage.ts:42,70`) — i.e. **localStorage is the de-facto store**,
which is exactly what design §5.1/§9 says it must not be.
**Expected**: the document is committed (generation 2, snapshot written) and `read_document_head` returns it on the
next launch; no junk rows.

**Second, user-visible symptom of the same root cause (cross-session context loss)**: the Agent conversation binding
uses `document.metadata.id` (`useAgentDocumentBinding.ts:31,47`, `agentRunner.ts:96`), and `switchWorkspace` mints a
new document for a workspace it has not seen yet (`store.ts:137`). `loadDraft` is only called once, for the last
active workspace (`App.tsx:505-506, 559`). So after a restart, opening any workspace other than the last active one
produces a **different document id**, and `list_conversations` (which filters by project *and* document *and* workspace,
`repository/conversations.rs:433-448`) returns an **empty list** — the rows are still in SQLite under the old
document id but are unreachable from the UI.

**Smallest fix**: give the project a single, persisted document identity and use it on both the probe and the commit
path — e.g. remember the id per workspace (`mathcanvas:document-id:<workspace>`), pass it as `emptyDocument()`'s id,
and adopt the stored document (and its id) into the store instead of discarding it when `created` is true; add a
`read_document_head_for_project`/`read_latest_document` command if you prefer the repository to answer "my document".
Cheap hardening in the meantime: in `save()`, if `document.metadata.id !== head.documentId`, do not send a commit for
a document that cannot exist — align or fail loudly. And make the fake repository in
`documentPersistence.test.ts:34-39` respect its `documentId` argument; that one change would have caught this.

---

## Important

### I2. `import_package` stores the package's attachments but never records a reference to them, so the panel reports "no attachments" for the imported version and the next garbage collection deletes them

**Files/lines**

- `apps/desktop/src-tauri/src/lib.rs:635-665` — `import_package` validates via `package::import`, then writes documents
  one by one. It never calls `record_attachment`/`reference_attachments`; only `outcome.stored_attachments.len()` is
  reported back (`:662`).
- `apps/desktop/src-tauri/src/repository/package.rs:396-401` — the import only calls `blobs.write(...)` (blob on disk,
  no DB row).
- `apps/desktop/src-tauri/src/repository/projects.rs:430-461` — `record_attachment` / `reference_attachments` exist and
  are used by `put_attachment` only (`lib.rs:557-561`).
- `apps/desktop/src-tauri/src/lib.rs:582-590` + `repository/blobs.rs:168-208` (GC via `referenced_blobs`,
  `GC_GRACE_MS = 60_000` at `blobs.rs:84`).
- `apps/desktop/src-tauri/src/repository/projects.rs:450-461, 480-493` — `attachments_of`/`reference_attachments` are the
  only writers/readers of `snapshot_attachments`.

**Repro (read-only evidence)**

1. Export a project with one attachment (`.mcanvas`) from install A.
2. In install B: 项目包… → import that package. The panel reports `已导入 1 份文档（1 个附件）`
   (`components/ProjectPackagePanel.tsx:188`) and `import_package` really did write the blob bytes.
3. The panel's reference list refreshes through `read_document_attachments(project, doc, generation)`
   (`lib.rs:673-677`) → `attachments_of` → **empty**, so the UI says "这一版快照还没有引用任何附件"
   (`ProjectPackagePanel.tsx:114-126, 260-263`).
4. Press 回收孤儿附件 (`ProjectPackagePanel.tsx:222-225` → `collect_attachments`) more than 60 s after the import:
   `referenced_blobs()` does not contain the imported hash, so `BlobStore::collect_garbage` **deletes the file**.

**Observed**: the imported attachment is silently lost from disk (and any later export of that document omits it);
the DB and the UI both claim the imported snapshot references nothing, while the package manifest said it did.
**Expected**: the imported generation's attachments are recorded as referenced (they are exactly the `attachments`
list of the manifest, whose hashes were already verified against their bytes), so they survive GC and appear in the list.

**Smallest fix**: in `import_package`, after each document is written, call `record_attachment(hash, size, media_type)`
and `reference_attachments(project_id, document_id, generation, hashes)` for the manifest's attachments — the
hashes/sizes/media types are already in `outcome.manifest.attachments`, and `ImportOutcome` already carries
`stored_attachments`. (Today the imported blob is only kept alive by luck: nothing else references it.)

### I3. `read_attachment` joins an unvalidated caller string into a filesystem path — an arbitrary-file-read primitive over IPC (and `BlobStore::verify` shares it)

**Files/lines**

- `apps/desktop/src-tauri/src/lib.rs:568-572` — `read_attachment(app, content_hash: String)` passes the argument
  straight to `blobs.read(&content_hash)` and returns the bytes base64-encoded to the webview. There is no check that
  it looks like a SHA-256.
- `apps/desktop/src-tauri/src/repository/blobs.rs:105-107` — `fn blob_path(&self, content_hash: &str) -> PathBuf { self.root.join("blobs").join(content_hash) }`.
  `Path::join` **replaces** the whole path when the argument is absolute, and does not normalise `..`.
- `apps/desktop/src-tauri/src/repository/blobs.rs:143-149` (`read`) and `:156-161` (`verify`) are the users of it.
- Coverage blind spot: `tests/shell_smoke.rs:117-200` asserts an exact list of command *names* and greps for
  `read_file`/`run_shell`; it cannot see that a "content hash" parameter is an arbitrary path.
  `tests/repository_package.rs:112-118` *does* test traversal — but only for **archive entry names**, never for blob names.

**Repro (read-only evidence)**

`read_attachment(content_hash = "..\\..\\projects.db")` → `blob_path` = `<appdata>/attachments/blobs/../../projects.db`
= the whole project database, returned to the webview as base64 (WAL contents included). An absolute path works too
(`"C:\\Windows\\win.ini"`), and `"..\\..\\providers.json"` yields the provider configuration.

**Reachability (stated honestly)**: no UI path feeds a document-derived hash into `read_attachment` today
(`components/ProjectPackagePanel.tsx` only lists/upload/GCs; `readAttachment` is called from tests only). So this is a
*latent* hole rather than a live exploit — but the command is registered and callable by any code running in the
WebView, which is precisely the boundary the allowlist exists to draw, and it becomes Critical the moment a caller
passes a hash that came out of a document or a package. The sibling commands take unvalidated paths too
(`export_package(destination)`, `import_package(path)`, `lib.rs:597, 635`), so "no generic command accepting an
arbitrary path" is not actually true of this shell.

**Smallest fix (3 lines)**: reject anything that is not 64 lower-case hex characters in `read_attachment` *and* inside
`BlobStore::blob_path` (return `Ok(None)`/`HashMismatch` instead of a path) — content addressing means a valid name is
always a SHA-256. Keep the names in `shell_smoke.rs` and add a blob-name test to `repository_package.rs` next to the
archive one.

### I4. `import_package` writes N documents in N separate transactions — a mid-loop failure leaves a partial import, which the package layer says it prevents

**Files/lines**: `apps/desktop/src-tauri/src/lib.rs:642-656`; the module contract it contradicts is at
`repository/package.rs:307-316` ("先把整包验完，再落下任何东西 … 那种部分导入是最难收拾的状态") and `lib.rs:629-631`.

**Repro (read-only evidence)**: a package with 3 documents; the write of document #3 fails (disk full, DB locked,
`io`) → documents #1 and #2 are already committed (`replace_epoch`/`create` each commit their own transaction), and the
command returns an error. The user is left with two of the three documents and no receipt saying which.
Additionally the `match repository.read_head(...)` at `:647-654` treats **any** error as "the document does not exist"
and calls `create`, which then fails with a misleading `already exists` (see M5) instead of surfacing the read error.

**Expected**: nothing is written unless every document can be written (one transaction, or a pre-flight +
compensating delete), or the response enumerates exactly what was written.

**Smallest fix**: wrap the document loop in a single `ProjectRepository` transaction (add
`replace_or_create_many(&mut self, project_id, epoch, documents)` that opens one transaction and reuses
`replace_epoch`/`create`'s statements), and propagate `read_head` errors other than `NotFound` instead of folding them
into the `create` branch.

---

## Minor

### M5. `ProjectRepository::create` reports **every** insert failure as "already exists" (`StaleHead`), and the TS client classifies anything containing "generation" as `stale_head`

`repository/projects.rs:169-177` — `INSERT INTO documents …` maps any `rusqlite::Error` to
`RepositoryError::StaleHead { detail: "document {id} already exists: {error}" }`. A full disk, a locked DB or a
permission error therefore reaches the UI as "document X already exists" and is classified by
`services/documentRepository.ts:77` as `stale_head` ("re-read and save again"), which is the wrong next action. This is
the "error mapping that hides a failure" shape the audit asked about. Smallest fix: match
`rusqlite::Error::SqliteFailure{ code: ConstraintViolation, .. }` → `StaleHead`, everything else → `Io`.

### M6. A required input field is silently ignored on the desktop: `upsert_fact` never uses `input.created_at`

`repository/conversations.rs:660-673` binds `?7 = now` for both `created_at` and `updated_at`, so the caller's
`created_at` (a required field of `ConversationFactInput`, `:216`, sent by the client at
`services/conversationClient.ts:112` and `agentStore.ts:706`) is dropped, while the browser fallback honours it
(`conversationRepository.ts:511`). Same `saveFact` call, different `createdAt` on the two backends. The repository's own
doctrine is that a silently-dropped field is worse than a refusal ("静默削掉会让调用方以为存进去了"). Fix: either use
`input.created_at` or remove it from the input type (and validate it).

### M7. The browser fallback's size gates are *not* the same numbers as Rust's, although the comments claim they are

`conversationRepository.ts:410-412` has `MAX_MESSAGE_CHARS = 32_000`, `MAX_SUMMARY_CHARS = 16_000`,
`MAX_FACT_VALUE_CHARS = 8_000` with the comment "上限与判据在这里与本仓库的那一份**逐字对齐**", but
`repository/conversations.rs:53-59` has `32 * 1024`, `16 * 1024`, `8 * 1024`. The two also count differently: TS uses
`String.length` (UTF-16 code units) while Rust uses `chars().count()`. A 32 100-character message (or 20 000 emoji,
i.e. 40 000 UTF-16 units) is accepted on the desktop and **refused** in the browser fallback with
"message content is N characters, over the 32000 limit". Fix: derive both from one number and count code points.

### M8. `archive()` advances `updated_at` while its docstring says it must not

`repository/conversations.rs:483-493`: the comment above the statement says archiving "**不推进** `updated_at`" (so that
un-archiving keeps the true last-spoken order), but the SQL is
`SET archived_at = ?1, updated_at = ?1`. The browser fallback implements the documented behaviour
(`conversationRepository.ts:517-526`). Currently invisible because archived rows are filtered out of `list`
(`:436`) and there is no un-archive command — but the two backends disagree and the comment is wrong. Fix: drop
`updated_at` from that UPDATE (and delete the archived conversation from the ordering assumptions), or correct the
comment if the bump is intended.

### M9. The "no secret-shaped field" guard does not look inside arrays, although both copies claim "any depth"

`repository/provider_profiles.rs:134-149` (`contains_secret_field`) returns `None` as soon as a value is not an object,
so it never descends into an array; `services/providerProfileClient.ts:58-67` (`findSecretField`) has the same hole
(`Array.isArray(value)` → `null`). Because `CapabilityEvidence` has no `deny_unknown_fields`, a payload such as
`{"capabilities":[{"feature":"vision","status":"unknown","apiKey":"sk-…"}]}` is not refused — it is **silently trimmed**
by deserialisation, which is exactly the outcome the comments say is more dangerous than an error. (No leak: the typed
re-serialisation drops it, so nothing is persisted.) Fix: recurse into array elements in both functions.

### M10. The proxy's per-request admission never evaluates the profile-revision rule, and the HTTP handlers bypass `security::parse_route` entirely

`proxy/server.rs:347-350` always passes `profile_revision: None, current_profile_revision: 0`, so
`security::admit`'s `stale_profile_revision` branch (`proxy/security.rs:188-192`) can never trigger on the real request
path even though the module header claims "每个请求都过一遍判据 … profile 修订号都会变". The same middleware also never
calls `parse_route`, so the "no route accepts an upstream URL" check (`security.rs:52-54`) is not on the live path
(the axum routes match the path directly and the handlers return 501 for `model`/`events`). Impact is currently nil
(nothing is forwarded), but the safety story this file tells is stronger than what the socket enforces. Fix: have the
middleware parse the route/query through `security::parse_route` and pass the profile revision from the request's
profile lookup, or mark the claim as not-yet-wired.

---

## Checked and found clean (so the next audit does not repeat it)

- **Migrations** (`repository/migrations.rs`): forward-only, each step in its own transaction with `user_version`
  advanced inside the same transaction; a database from a newer build is detected and named (both versions in the
  message); injected failing migrations leave the old schema usable (pinned by `tests/conversations.rs`).
- **Foreign keys**: `PRAGMA foreign_keys = ON` at open (`projects.rs:135-137`), the cascade is declared *and* the delete
  path deletes messages/facts explicitly so a connection with the pragma off cannot leave orphans
  (`conversations.rs:495-520`); `conversation_facts.source_message_id` must be a message of the same conversation
  (`:645-658`) — cross-conversation evidence is refused.
- **Message ordering/idempotency**: `append_message` allocates `MAX(sequence)+1` and inserts in one transaction;
  a replayed id returns `false` **without consuming a sequence** and without `INSERT OR IGNORE` swallowing a genuine
  sequence collision (`conversations.rs:524-570`). Bounded reads keep the **newest** messages/facts
  (`:576-592`, `:695-711`), `list` keeps the newest conversations with a deterministic `updated_at DESC, id ASC`
  tiebreak (`:433-448`).
- **Boundary validation** on all eight conversation commands (ids, workspace enum, fact status enum, message/summary/
  fact sizes, credential prefix) exists in the repository *and* is repeated at the command entry (`lib.rs:738-820`);
  `deny_unknown_fields` on `NewConversation`/`ConversationBinding`/`ConversationMessageInput`/`ConversationFactInput`/
  `RunEventInput` really rejects `reasoning`/`imageBytes`/`candidateDocument` instead of trimming them.
- **Credential prefix rule**: `contains_credential_prefix` splits on token characters before looking for `sk-`/`sk_`,
  so `task-1`/`risk-free` and 64-hex commit hashes are not false positives; the TS copy is character-for-character the
  same rule (`conversationRepository.ts:414-431`). `redact` for the ledger is default-deny (≥32-char token runs,
  `bearer…`, known prefixes) and truncation is by `char`, not byte (`run_events.rs:99-155`).
- **Secrets**: no command or return type can carry plaintext (`secrets/mod.rs:67-77`, pinned by
  `tests/shell_smoke.rs:208-220`); the Windows backend collapses `keyring` errors to fixed strings and never forwards
  error text (`secrets/windows.rs:41-49`); the memory fallback reports `backend() == "memory"` so the UI can warn
  (`secrets/memory.rs:54-56`); `with_secret`'s closure keeps the plaintext inside one HTTP call
  (`providers/adapter.rs:390-448`).
- **Proxy transport security**: loopback-only bind with an ephemeral port, 16-byte random token compared in constant
  time, exact `Host`/`Origin` matching, body limit, no redirect following, `no_proxy()`, rustls only, and
  `allow_upstream` re-checked inside the transport (`proxy/security.rs:160-195, 209-261`; `adapter.rs:481-541`).
- **`.mcanvas` container/import**: stored-only entries, CRC verified, ZIP64/encryption refused, unsafe names
  (`..`, absolute, drive letter, backslash) refused, declared-vs-present entries checked in both directions,
  document and attachment hashes re-verified against their content, manifest size/count limits, no secrets in the
  package (pinned by `tests/repository_package.rs`, incl. the traversal set at `:112-118`).
- **Conversation summary/facts layering**: summaries are stored per document (`summaryOfDocument`/`withDocumentSummary`),
  facts carry `documentId` and are filtered on both the injection path (`agentRunner.ts:165-178`) and the builder
  (`contextBuilder.ts:326-364`), stale/retracted facts never enter the context (`agentRunner.ts:178`), and
  `fitSummaryBook` shrinks/drops within the 16 K budget and reports what it dropped
  (`conversationSummary.ts:242-294`, `agentStore.ts:745-751`).
- **No logging of secrets or paths**: no `console.*` in production TS, no `println!`/`tracing` in the desktop crate,
  and `get_runtime_info` only exposes the data-root *directory name*
  (`runtime.rs:50-66`, pinned by its own test asserting no `Users`/`AppData` substring).
- **`agentStore` projection discipline**: writes go through `commitAfter` (repository first, projection second),
  `setBinding` is guarded by a monotonically increasing request id, the projection is replaced wholesale (never merged),
  and run targets are keyed by `runId` so late events land on their own conversation
  (`agentStore.ts:171-187, 570-608, 500-530`); consent is one-shot, bind to `previewHash` + conversation + document CAS
  and refuses nonces the bridge never minted (`hostBridge.ts:105-223`).

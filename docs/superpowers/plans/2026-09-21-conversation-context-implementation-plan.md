# Conversation Context Implementation Plan

> **For agentic workers:** Read the design spec before implementing. Execute tasks in order and run each task's tests before moving on.

**Goal:** Persist independent document-bound Agent conversations and inject the correct history, summary, and confirmed facts into every planning request.

**Architecture:** SQLite is the desktop source of truth; the existing Zustand store remains a UI projection with a browser fallback. Conversation identity, document binding, and document generation are fixed into every run so late events cannot cross-write into another conversation.

**Tech Stack:** Rust, SQLite/rusqlite, Tauri named IPC, TypeScript, Zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-incremental-geometry-agent-and-conversations-design.md`

## Global Constraints

- A conversation is bound to one project, document, and workspace.
- Unconfirmed drafts never become confirmed conversation facts.
- SQLite is authoritative in desktop mode; localStorage is only a browser/test fallback.
- Do not persist API keys, hidden chain-of-thought, candidate documents, or image bytes.
- A run always carries `runId`, `conversationId`, `documentId`, and `documentGeneration`.

### Task 1: Add conversation repository schema

**Files:**
- Modify: `apps/desktop/src-tauri/src/repository/migrations.rs`
- Create: `apps/desktop/src-tauri/src/repository/conversations.rs`
- Modify: `apps/desktop/src-tauri/src/repository/mod.rs`
- Test: `apps/desktop/src-tauri/tests/conversations.rs`

**Interfaces:**
- Produce `ConversationRecord`, `ConversationMessageRecord`, and `ConversationFactRecord`.
- Produce repository methods `create`, `list`, `read_messages`, `append_message`, `update_summary`, `upsert_fact`, `archive`, and `delete`.

- [x] Write migration tests for schema version 3, foreign-key ownership, per-conversation sequence uniqueness, and reopening an older database.
- [x] Run `npm run test:rust -- --test conversations` and verify the new tests fail because version 3 tables and methods are absent.
- [x] Add the version 3 migration with `conversations`, `conversation_messages`, and `conversation_facts` tables and indexes.
- [x] Implement repository methods with bounded reads, deterministic ordering, and idempotent message IDs.
- [x] Run `npm run test:rust -- --test conversations` and verify all repository tests pass.

### Task 2: Expose named Tauri conversation commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/repository/mod.rs`
- Create: `apps/web/src/services/conversationClient.ts`
- Test: `apps/web/src/services/conversationClient.test.ts`
- Test: `apps/desktop/src-tauri/tests/shell_smoke.rs`

**Interfaces:**
- IPC commands: `create_conversation`, `list_conversations`, `read_conversation`, `append_conversation_message`, `update_conversation_summary`, `update_conversation_fact`, `archive_conversation`, `delete_conversation`.
- TypeScript client methods mirror these commands and return typed records.

- [x] Add client tests with a mocked `invoke` asserting exact command names and serialized payloads.
- [x] Run the focused Vitest test and verify it fails because the client and commands do not exist.
- [x] Add named Rust commands that validate IDs, workspace values, message size, and fact status before repository calls.
- [x] Implement the client with desktop detection and a local fallback adapter boundary.
- [x] Update the explicit IPC command allowlist in `shell_smoke.rs`.
- [x] Run `npm test -- apps/web/src/services/conversationClient.test.ts` and `npm run test:rust -- --test shell_smoke`; verify both pass.

### Task 3: Replace localStorage records with a conversation repository adapter

**Files:**
- Modify: `apps/web/src/agentStore.ts`
- Create: `apps/web/src/conversationRepository.ts`
- Test: `apps/web/src/agentStore.test.ts`
- Test: `apps/web/src/conversationRepository.test.ts`

**Interfaces:**
- `ConversationRepository.loadList(binding): Promise<AgentConversation[]>`.
- `ConversationRepository.append(message): Promise<void>`.
- `ConversationRepository.saveSummary(...)` and `ConversationRepository.saveFact(...)`.

- [x] Add tests proving two bindings load separate conversation lists and that a deleted conversation cannot reappear from a stale local cache.
- [x] Run the focused tests and verify the new repository calls are absent.
- [x] Implement the adapter with SQLite IPC in desktop mode and the existing localStorage serializer in browser mode.
- [x] Make `createConversation`, `selectConversation`, `deleteConversation`, and message mutations update the in-memory projection only after the repository operation succeeds.
- [x] Run the focused store and repository tests and verify pass.

### Task 4: Inject conversation context into planning

**Files:**
- Modify: `packages/agent-core/src/contracts.ts`
- Modify: `packages/agent-core/src/contextBuilder.ts`
- Modify: `apps/web/src/agent/agentRunner.ts`
- Modify: `apps/web/src/agent/modelPlanner.ts`
- Test: `packages/agent-core/src/contextBuilder.test.ts`
- Test: `apps/web/src/agent/agentRunner.test.ts`

**Interfaces:**
- Add `ConversationContext` containing binding, summary, confirmed facts, recent messages, observation, and optional draft view.
- Extend `PlannerPort.plan` with `conversation: ConversationContext` while keeping local planner compatibility.

- [x] Add tests proving current scene facts outrank stale messages, recent messages are bounded by token budget, and drafts are excluded from confirmed facts.
- [x] Run focused tests and verify the planner does not receive conversation history.
- [x] Implement deterministic context ordering and token-budget truncation.
- [x] Pin conversation/document resolution once per run and pass the same context to repair attempts.
- [x] Run `npm test -- packages/agent-core/src/contextBuilder.test.ts apps/web/src/agent/agentRunner.test.ts` and verify pass.

### Task 5: Persist summaries, facts, and cross-conversation event routing

**Files:**
- Modify: `apps/web/src/agent/agentRunner.ts`
- Modify: `apps/web/src/agentStore.ts`
- Create: `apps/web/src/conversationSummary.ts`
- Test: `apps/web/src/agentStore.runStatus.test.ts`
- Test: `apps/web/e2e/conversation-isolation.spec.ts`

- [x] Add tests for summary rollover, confirmed commit facts, discarded draft exclusion, and late events written to their original conversation.
- [x] Run the focused tests and verify the new persistence assertions fail.
- [x] Implement structural summary compaction after the configured token threshold; retain raw messages in SQLite.
- [x] Update committed runs with document generation and created-object facts; never update facts on discard or failed compile.
- [x] Add the browser test: create in conversation A, switch to B, verify isolation, switch back to A, then continue the original reference.
- [x] Run `npm test -- apps/web/src/agentStore.runStatus.test.ts` and `npm run test:e2e -- e2e/conversation-isolation.spec.ts`.

### Task 6: Verify the conversation slice

- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e`, and `npm run test:rust`.
- [x] Confirm no key-like string, candidate document content, or hidden reasoning is persisted by scanning conversation payload fixtures.
- [ ] Record the measured test counts and any pre-existing warnings in the project progress document.

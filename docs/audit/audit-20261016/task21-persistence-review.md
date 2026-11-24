# Task 21 multi-document persistence independent review

Reviewer: Socrates. Scope: documentPersistence.ts and its tests; inactive-workspace restart hydration excluded.

Initial review reproduced two Important defects (no Critical): (1) adopting a different-content stale head allowed the next queued save to overwrite the external edit; (2) global reset invalidation discarded another document's queued final edit while reporting success. Permanent regressions independently failed as intended (2 failed / 22 passed).

Fix: only identical-content readback may advance the cached conflict head; import eras and queue replacement are per document. Persistence/repository/hook suites: 43 passed. Independent re-review: both Important findings resolved, no new reproducible Critical/Important, persistence 24/24 passed. Reviewer used the existing direct vitest entry and made no source changes. Its initial review accidentally invoked pnpm dependency installation; this was reported, not hidden. No dependency manifests/lockfiles changed in this block.

Native verification uses the isolated audit identity, not the user's installed app. Original save/SQLite sequence and active restart passed; switching to an inactive workspace after restart exposed a distinct pending hydration defect, explicitly not accepted here. Revised isolated build initially failed due to the audit executable still running; after stopping only that process, rebuild passed. Build warnings remain in logs. No standard packaged/clean-machine/offline or human acceptance is claimed.

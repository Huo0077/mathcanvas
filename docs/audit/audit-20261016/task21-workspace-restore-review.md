# Independent review: workspace restart recovery

Reviewer: Socrates (01a14708-0ee3-74a0-840e-d25a278897ef), read-only; no dependencies installed or files changed by reviewer.

1. Initial Important: startup latest fallback was still global when a remembered id was missing or belonged to another workspace. Added two RED regressions and reused workspace-filtered recovery at startup.
2. Follow-up Important: foreign remembered id + requested workspace empty could create under the foreign id, and cold/cached save/reset could overwrite that owner. Four permanent regressions failed before the correction. Recovery allocates a new id only for a known foreign owner, while unowned stable ids stay stable. Save and reset reject cross-workspace reuse before writes.
3. Final review: previous Important eliminated; no new reproducible Critical/Important found in this bounded repair. Reviewer checked the diff but did not rerun tests in this final pass. Main-run verification separately recorded 4 suites/68 tests and current full suite 402 files/4691 passed/1 todo.

This is not independent gold annotation, user acceptance, or clean/offline release acceptance.

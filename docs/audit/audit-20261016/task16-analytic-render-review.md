# Task 16 analytic candidate gate: independent functional review

Base: 8b7783e3b8f4341a622dfed05cb9dcfdf098f936. Scope: layoutModel.ts/tests, agentRunner.test.ts and geometry3d-sphere.spec.ts.

## First review and remediation

The independent read-only reviewer found a P1: invalid analytic primitives could be silently omitted while a valid point supplied a passing viewport. Reproduced with independent mixed-object regressions: 14 failed / 24 passed. Invalid supported primitives now return failed layout rather than being skipped. Rotation, sphere depth, finite sampling windows, and every sampled point are checked. Unsupported geometry remains distinct from invalid supported geometry. Sampling is reused once per analytic primitive.

Coverage was strengthened with per-type numerical dimension checks (rotation, both axes, signed parabola focal parameters), mixed invalid cases, and independent cube topology cardinality/reference checks before the sphere no-write deep equality. An unused inspection helper was removed; final lint is back to 13 existing warnings. The structured-only mode remains explicit in agentRunner; this is not actual candidate DOM/screenshot coverage.

## Final independent re-review

The same reviewer re-read the four source/test files and independently ran layoutModel.test.ts and agentRunner.test.ts: 2 files / 96 tests passed. The P1 is resolved; no new blocking issue was found and the change is suitable to commit. The reviewer did not edit source, stop processes, or run full build/E2E. Full-suite counts below were run by the parent, not attributed to the reviewer.

## Fresh final parent verification

- Full unit: 404 files / 4741 passed / 1 todo, exit 0.
- Full browser: 239 passed, exit 0. Global setup rebuilt current source before preview; not a reused old build.
- Workspace typecheck: exit 0.
- Lint: exit 0, 0 errors / 13 existing warnings.
- Logs: task16-analytic-final-{unit,e2e,typecheck,lint}.txt/.exit.
- Regression reproduction: task16-analytic-invalid-red.txt/.exit (14 failed /24 passed), followed by task16-analytic-invalid-green.txt/.exit (96 passed).

The historical 234 passed /5 failed browser run in final-e2e.txt remains unchanged. Task 16 stays partial; real pre-confirmation visual evidence, full WebGL measurement, human readability and desktop release acceptance remain separate gates. Goal stays active.

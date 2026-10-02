# 球体与球截面 Implementation Plan

> **For agentic workers:** Follow `test-driven-development`, `systematic-debugging` and `verification-before-completion`; execute tasks inline unless the user explicitly requests delegation. `- [ ]` means no verified GitHub-delivered evidence yet.

**Goal:** Deliver an editable analytic sphere with exact plane sections, visible 3D rendering, orthographic CAD projection, honest degeneracy/unsupported diagnostics, measurement, persistence, undo and tested creation paths.

**Architecture:** The `.mgeo` document stores `sphere.center/radius`; Three.js mesh and sampled section fill are display caches, never mathematical sources. Geometry kernel owns analytic sphere-plane math; scene-graph owns transactions/dependencies; UI/Agent/CAD consume the same document contract. Never pass a sphere into convex polyhedron boolean clipping as an approximation.

**Tech Stack:** TypeScript, `@draw/dsl`, `@draw/geometry-kernel`, `@draw/scene-graph`, React 19, Three.js, Vitest, Playwright; Tauri WebView reuses the Web build.

**Spec:** [`../specs/2026-10-01-sphere-and-sections-design.md`](../specs/2026-10-01-sphere-and-sections-design.md).

## Global constraints

- A `sphere` has a finite center and finite radius strictly greater than zero. No persisted `segments` or fabricated `polyhedron3` topology.
- Ball ∩ plane is mathematically exact: circle / tangent point / none. Other sphere boolean intersections are explicitly unsupported, never silently approximated.
- A preview changes no document revision, confirmation is one transaction, and existing `.mgeo` fixtures stay valid.
- For each task: test must go red for the named behavior, implement minimally, run focused tests/typecheck, update `docs/current-status.md` and `docs/project-progress.md`, commit, push and compare `git rev-parse HEAD` to `git ls-remote origin refs/heads/main`. Then check the new CI before checking the task box. No unrelated local file is staged.
- Do not publish a new installer from version 3.0.1 after the current tag: source tag, app version, artifact hashes and installation evidence must match before release work is marked done.

## Task 1 — Persist and validate the sphere document type

**Files:** `packages/dsl/src/types.ts`, `schema.ts`, `primitiveTypeNames.ts`, `schema.test.ts`, `codec.test.ts`; `packages/agent-core/src/capabilities.ts`, `capabilities.test.ts`; `apps/web/src/components/inspectorLabels.ts`, `primitiveStyle.ts`, `persistence/exporters.ts`, `persistence/exporters.test.ts`. `codec.ts` 只在现有泛型 JSON 往返不足时修改。

**Interfaces:** Produce `SpherePrimitive { id: string; type: "sphere"; center: Vector3; radius: number } & PrimitivePresentation` within `PrimitiveSpec`. Consumers must narrow on `primitive.type === "sphere"`.

**交付证据（2026-10-01）：** 契约 RED→GREEN；全库 269/3110 + 1 todo、e2e 171/171、typecheck/lint 通过。Agent `sphere` 明确 `temporarily_unavailable`，仅完成文档类型而非球体功能。代码提交 `ca03ed5` 已推送并核对远端 SHA，CI run `36908959733` checks/build/rust/e2e 四项成功后本 Task 才勾选；球体画布/解析截面仍未实现。

- [x] Write schema and codec tests that first fail when adding a sphere to a geometry3d document:
```ts
const sphere = { id: "sphere-1", type: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 } as const
const document = { ...createEmptyDocument("geometry3d"), primitives: [sphere] }
expect(validateDocument(document).valid).toBe(true)
expect(decodeMgeo(encodeMgeo(document)).primitives).toContainEqual(sphere)
expect(validateDocument({ ...document, primitives: [{ ...sphere, radius: 0 }] }).valid).toBe(false)
```
- [x] Run `npm.cmd test -- packages/dsl/src/schema.test.ts packages/dsl/src/codec.test.ts`; confirm the new tests fail for missing type/schema, not test setup.
- [x] Add type/union and finite-positive schema validation; verify old fixture and round-trip tests remain byte/geometry compatible. Run the same tests and `npm.cmd run typecheck`.
- [x] Update progress docs, commit only this slice, push and verify remote SHA and CI; check this task only after proof.

## Task 2 — Exact sphere-plane mathematics and degeneracy

**Files:** create `packages/geometry-kernel/src/sphere.ts` and `sphere.test.ts`; modify `index.ts`, `quadrics.ts`, `section-quadric.ts` and the corresponding analytic tests if reusing the `Conic3` kernel.

**Interfaces:** `spherePlaneSection3({center,radius}, {normal,constant})` returns `{kind:"circle",center,radius,conic,loops}` / `{kind:"point",point}` / `{kind:"empty",distance}`, or a typed diagnostic (`{kind:"invalid",code,detail}`) for invalid input. **实现说明（2026-10-01）**：第三种的拼法是 `"empty"` 而不是本文原写的 `"none"` —— `Conic3Kind` 是内核既有枚举，`"none"` 是 DSL `Section3Classification` 的产品层拼法；映射（`empty` → `classification:"none"`、`visible=false`）在 Task 4 的 `sectionRecompute` 一层做。The spherical quadric has no cylinder/cone axial caps.

**交付证据（2026-10-01）：** `packages/geometry-kernel/src/sphere.ts` 新增 `spherePlaneSection3`；RED 起点 `Failed to resolve import "./sphere"`、GREEN `sphere.test.ts` **13/13**，连 `quadrics.test.ts` + `section-quadric.test.ts` 共 **35/35**；`tsc -p packages/geometry-kernel/tsconfig.json` 与 eslint exit 0；变异检查（相对容差改绝对量）恰好 2 条尺度用例变红。代码提交 `22bd7a2` 已推送并核对远端 SHA，CI run `36963752920` 的 checks/build/rust/e2e **四项全绿**后才勾选。**偏离计划一处（有意）**：不相交拼作 `"empty"` 而非 `"none"` —— `Conic3Kind` 是内核既有枚举，`"none"` 是 DSL `Section3Classification` 的产品层拼法，映射放 Task 4。截圆尚未接进 `SectionPrimitive`，球仍无 3D 渲染。

- [x] Add failing cases for sphere C=(1,2,3), r=5 cut by z=6 → centre (1,2,6), radius 4; z=8 → point (1,2,8); z=9 → none; `{normal:(0,0,2),constant:-12}` equivalent to z=6; zero normal and non-positive radius reject. Assert conic coefficients and sampled points satisfy `|X−C|²=r²` rather than merely appearing round.
```ts
const sphere = { center: { x: 1, y: 2, z: 3 }, radius: 5 }
expect(spherePlaneSection3(sphere, { normal: { x: 0, y: 0, z: 1 }, constant: -6 })).toMatchObject({ kind: "circle", center: { x: 1, y: 2, z: 6 }, radius: 4 })
```
- [x] Run `npm.cmd test -- packages/geometry-kernel/src/sphere.test.ts` to observe the intended failures. **（实测 RED = `Failed to resolve import "./sphere"`，0 test collected —— 缺的是模块本身，不是夹具/环境）**
- [x] Implement the scale-aware distance classification and full `[0,2π]` circle piece in the shared analytic layer. Keep cylinder/cone cap clipping unchanged. Run sphere, `quadrics`, and `section-quadric` tests plus typecheck. **（`section-quadric.ts` 与 `quadrics.ts` 未改动：球没有 `bounds`，`sectionQuadric3` 仍如实返回 `null` 回退既有路径；端面弦裁剪对圆柱/圆锥逐字不变）**
- [x] Update progress docs, commit/push, verify SHA/CI before checking the task. **（`22bd7a2`；远端 SHA 已核对；CI `36963752920` 四项全绿）**

## Task 3 — Scene transactions and numerical measurement

**Files:** `packages/scene-graph/src/apply.ts`, `operations.ts`, `transforms.ts`, `graph.ts`, `patches.ts`, scene-store tests; `packages/geometry-kernel/src/measurements3d.ts` and tests.

**Interfaces:** Create via `addPrimitive`; numerical edit via `updatePrimitive` patch `{ center3, radius3 }`; `translatePrimitive3` moves the sphere and its dependent section in one undo step. `calculateMeasurement3` returns `4πr²` for area and `4πr³/3` for volume with `exact-input` precision.

**交付证据（2026-10-01）：** 代码提交 `44353ad` 已推送并核对远端 SHA，CI run `36964580061` 的 checks/build/rust/e2e **四项全绿**后才勾选。**实测**：球用例 4 个文件 **27/27**（`sphere.test.ts` 13 + `sphereMeasurements.test.ts` 4 + `sphereTransactions.test.ts` 7 + `apps/web/src/sphereHistory.test.ts` 3）；全库 `vitest run --maxWorkers=3` **272 文件 / 3134 项 + 1 todo / 0 失败**；`npm run typecheck` exit 0；`npm run lint` exit 0（0 error / 13 warning）。**关键门是两道白名单**：`EDITABLE_GEOMETRY_TYPES` 与 `isFreeDraggable3`（`transforms.ts`）—— 只加 `apply.ts` 的球分支仍会被 `"object is not editable"` / `"not draggable"` 挡下，这是本 Task 第一次 RED 的现场。**一处范围说明**：本 Task 原清单里的「source section recompute」**不在此交付** —— 球当时还不是 `SectionPrimitive` 的来源；该子项由 **Task 4**（"edit sphere radius and re-evaluate both cached points and exact coefficients"）覆盖，见下。**未做**：Task 4–9 全部。

- [x] Add failing tests: create C/r, move centre by (2,0,0), edit r 5→4, undo/redo once, persist/reopen, source section recompute; r=0/NaN must atomically reject. Verify area for r=2 is `16π`, volume `32π/3` with the production calculator. **（`source section recompute` 归 Task 4，理由见上；其余全部落地并实测。撤销/重做在 `apps/web/src/sphereHistory.test.ts`：改半径=一步撤销、撤销后球仍在、**被拒绝的编辑不压历史**——否则下一次 Ctrl+Z 会变成空操作）**
```ts
const edited = commitPatch(document, { op: "updatePrimitive", id: "sphere-1", patch: { radius3: 4 } })
expect(edited.changed).toBe(true)
expect(edited.document.primitives.find((item) => item.id === "sphere-1")).toMatchObject({ radius: 4 })
```
- [x] Run focused `scene-store`, `patches`, `recomputeConsistency`, `measurements3d` tests to confirm RED. **（实跑这 4 个文件 = 126/126 通过，用来确认**没有回归**；本 Task 的 **RED 来自新增的三个聚焦文件**（4 条失败，原因是球的编辑/平移被上述两道白名单挡下），而不是靠改动既有文件制造红）**
- [x] Add the smallest operation/validation/dependency branches; do not generate faceted child primitives. Run focused tests and typecheck. **（球不物化任何子对象：新增用例显式断言文档里 `polyhedron3` 数量为 0、保存往返后图元总数仍为 1）**
- [x] Update progress docs, commit/push and verify SHA/CI. **（`44353ad`；CI `36964580061` 四项全绿）**

## Task 4 — Exact section integration and unsupported boolean gate

**Files:** `packages/scene-graph/src/sectionRecompute.ts`, `solidGeometry.ts`, `deletion.ts`, corresponding section/intersection tests; `apps/web/src/solidCommands.ts` for the section button.

**Interfaces:** A sphere `SectionPrimitive` records exact full circle, tangent point or none from Task 2. `sectionPlaneThroughSource` defaults to a plane through the sphere centre. New sphere Boolean operations return `commitPatch(...).changed=false` with `unsupported` error; defensive recompute of historical cached intersections returns `insufficient-data`, never a fake polyhedron.

**交付证据（2026-10-01，两批）：** 代码提交 `2e76a45`（截面接入）与 `145319c`（布尔门禁）已推送并核对远端 SHA；CI run `36964580061` 为 Task 3，本 Task 的 CI 为 `145319c` 触发的 run（checks/build/rust/e2e 四项 success，见 `current-status.md` 第四节 E1）。**实测**：`sphereSection.test.ts` **10/10**（截面 7 + 布尔门禁 3，两批各自的 RED→GREEN 都记录在 `docs/project-progress.md`）；点名的那组截面 / 交测试（16 个文件）**163/163**；全库 `vitest run --maxWorkers=3` **274 文件 / 3147 项 + 1 todo / 0 失败**；`npm run typecheck` exit 0；`npm run lint` exit 0（0 error / 13 warning）。**未做**：`apps/web/src/solidCommands.ts` 的截面按钮"选中球就能切"、球截面 e2e；`deletion.ts` **未改**（球的删除沿用既有语义，全库含 `deletion-cascade` 全绿，但**不等于**球的删除级联已被专门验证）。

- [x] Write failing tests for z=6 circle `section.exact.kind="circle"`, radius 4, z=8 single visible point, z=9 none and no stale exact loop; edit sphere radius and re-evaluate both cached points and exact coefficients. Try adding `intersectionSolid` with a sphere via `commitPatch`: assert `changed=false`, original document identity and `unsupported` error; defensive recompute of an old cached intersection produces `insufficient-data`. **（全部落地。切点按 spec §3 判 `classification:"point"` / `status:"exact"` / **`visible:true`** —— 这与多面体路径刻意不同，那边相切时把截面藏起来。布尔门禁另加一条**反向对照**"两个立方体照样放行"，否则"一律拒绝"也能让拒绝那两条变绿）**
```ts
const section = recomputeSection(cutAtZ6, sphere, new Map([[sphere.id, sphere]]))
expect(section.exact?.kind).toBe("circle")
expect(section.status).toBe("exact")
```
- [x] Run focused `sectionRecompute` / `section-materialization` / `intersectionSolid` tests for RED. **（本 Task 的 **RED 来自新增的 `sphereSection.test.ts`**（截面上半 7/7 全红、门禁下半 3 条全红），原因是"线还没接上"而不是既有文件被改坏；点名的这组文件改成**回归**跑：16 个文件 **163/163 通过**，用来证明没有连带破坏）**
- [x] Route sphere through the analytic section before any `polyhedron3` fallback; keep existing section and deletion semantics. Run the tests and typecheck, update docs, commit/push and verify CI. **（球分支写在 `recomputeSection` 里 `polyhedron3` 回退**之前**，且球压根走不到那条回退（没有物化拓扑）；`analyticSectionBoundary` 仍是"源 + 平面 → 解析边界"的唯一一处映射。删除语义未改，全库 0 失败）**

## Task 5 — 3D sphere mesh, identity and visible tangent point

**Files:** `apps/web/src/threePrimitives.ts`, `threeSceneContent.ts`, `threePicking.ts` where needed, `sceneFit.ts` and tests; `e2e/geometry3d-sphere.spec.ts`.

**Interfaces:** `createSolidGroup(sphere, selected, options)` produces only render objects with `primitiveId/type="sphere"`; it never persists mesh vertices. Screen-quality mesh density may change without changing `.mgeo`. A tangent section draws a marker rather than an invisible 0-point mesh.

- [ ] Add tests/e2e that fail before sphere rendering: a sphere at C=(1,2,3), r=5 is visible and selectable; camera orbit changes its projection but not stored C/r; no dense selectable latitude/longitude edges; tangent section point is visible.
```ts
const group = createSolidGroup(sphere, false)
expect(group.children.some((child) => child.userData.primitiveId === sphere.id && child.userData.primitiveType === "sphere")).toBe(true)
expect(group.children.filter((child) => child.userData.primitiveType === "edge3")).toHaveLength(0)
```
- [ ] Implement mesh/picking/fit and reuse current materials/tokens. Run focused Three tests and sphere e2e, visually inspect an actual frame, typecheck/lint.
- [ ] Record actual evidence in progress docs; commit/push and verify SHA/CI.

## Task 6 — Manual creation, preview and property editing

**Files:** `apps/web/src/spatialSolidWizardModel.ts`, `components/SpatialSolidWizard.tsx`, `spatialSolidCommands.ts`, `solidCommands.ts`, `components/PropertiesBar.tsx`, `components/inspectorModel.ts` if needed; their existing tests and `e2e/geometry3d-sphere.spec.ts`.

**Interfaces:** `SolidPreset` adds `sphere` with `center`/`radius`. An unconfirmed wizard edit changes preview only; confirm issues one `addPrimitive`. Inspector uses the same `updatePrimitive { center3, radius3 }` as Task 3. Section creation accepts the selected sphere.

- [ ] RED e2e: set C=(1,2,3), r=5, watch uncommitted preview and unchanged object count; confirm once, edit radius 5→4, undo in one step, save/reload, create plane cut and read exact circle. Invalid radius shows a reason and leaves document untouched.
```ts
await page.getByRole("combobox", { name: "立体类型" }).selectOption("sphere")
await page.getByRole("spinbutton", { name: "半径" }).fill("5")
await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-sphere-count", "0") // not confirmed
```
- [ ] Implement the preset and fields by reusing existing `Vector3Fields`/`CoordinateField`; do not create a dead four-point-construction button. Run wizard model/component tests, e2e, typecheck/lint.
- [ ] Update docs, commit/push and verify SHA/CI.

## Task 7 — Engineering projections and exports

**Files:** `apps/web/src/projectionVisuals.ts`, `projectionVisuals.test.ts`, `apps/web/src/persistence/engineeringExporters.ts` only if the common `ProjectedPrimitive.polyline` contract needs a change; `e2e/engineering-drawing.spec.ts` / new sphere e2e.

**Interfaces:** A sphere projects to a closed circle of radius 5 in front/top/left/axonometric with projected centre matching the source centre. `sourceId` stays the sphere id; exporters consume the same renderer-neutral polyline.

- [ ] Add failing tests for C=(1,2,3), r=5: all four orthographic views have equal circular radii, no extra mesh edges; a hidden sphere yields no projection. E2e exports SVG/DXF/PDF and asserts a sphere outline in each, not just non-empty files.
```ts
const outlines = resolveProjectedDrawing(document, "front").primitives.filter((item) => item.sourceId === "sphere-1")
expect(outlines).toMatchObject([{ kind: "polyline", closed: true }])
```
- [ ] Implement analytic projection sampling using view bases; do not project the triangles of a display mesh. Run focused projection/export tests and e2e; update docs, commit/push, verify CI.

## Task 8 — Agent action only when the product path exists

**Files:** `packages/agent-core/src/actionIds.ts`, `actionRegistry.ts`, `actionInputs.ts`, `actionSchemas.test.ts`, `toolSetParity.test.ts`; `packages/scene-graph/src/actions/types.ts`, `actions/index.ts`, `actions/actions.test.ts`; Agent e2e.

**Interfaces:** Publish `solid.create_sphere` only after all three layers accept `{alias,center,radius}` with finite centre/r>0. Missing centre/radius is `ask_user`; provider output may not silently default them. Compiler emits the same `SpherePrimitive` as the manual path and does not claim unsupported Boolean tools.

- [ ] Write tests that fail for action registry/schema mismatch, invalid radius, alias collision, missing inputs, one confirmed scene transaction and saved round trip.
```ts
const parsed = parseActionToolInput("solid.create_sphere", { alias: "S", center: { x: 1, y: 2, z: 3 }, radius: 5 }, "step-1")
expect(parsed.ok).toBe(true)
```
- [ ] Implement registry, schema and compiler together (not one unchecked layer ahead of the others). Run agent parity tests, scene action tests and e2e, then docs/commit/push/CI.

## Task 9 — Full product gate and release decision

**Files:** `e2e/geometry3d-sphere.spec.ts`, `docs/current-status.md`, `docs/feature-catalog.md`, `docs/project-progress.md`, `CHANGELOG.md`; release packaging only after a separately selected version/tag.

- [ ] Run `npm.cmd test -- --maxWorkers=3`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test:e2e -- --workers=3`, `npm.cmd run test:rust`, `npm.cmd run test:perf`; report counts/warnings/ignored tests, not a generic “all green”.
- [ ] E2e cover numeric creation, exact circle/tangent/empty, edited persistence, undo, camera/selection, CAD views and export, deliberate unsupported sphere Boolean operation.
- [ ] Audit spec §5 row by row against real files/test output. Update `current-status.md`, feature catalog and progress; push, verify remote SHA and every CI job. Only then mark sphere capability complete. A new desktop Release still needs a matching versioned installer plus installation evidence.

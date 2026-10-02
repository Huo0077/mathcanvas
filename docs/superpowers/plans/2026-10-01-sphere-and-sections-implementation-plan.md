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

**交付证据（2026-10-01，两批）：** 代码提交 `43e4bb8`（球网格 + 不许经纬网 + 拾取）与 `cd72faf`（相切点标记 + 浏览器验收 + 修掉「有球却说画布是空的」），均已推送并由 CI run #46 / #47 四项全绿。**实测**：`threeSphere.test.ts` **8/8**、`e2e/geometry3d-sphere.spec.ts` **1/1**（变异：从 `visibleSolids` 拿掉 `sphere` → 当场红）。**「visually inspect an actual frame」这条要求真的做了**，并抓出一处真缺陷：`threeScene.tsx` 的 `hasGeometry` 漏了 `sphere`，于是球画在中间、上面却压着「这里什么都没有」的提示；已修并钉进 e2e。**两条判据只落在单元层**：无密集可选中经纬线（浏览器里没有可读读数可观察）、相切点标记是否真的画出来（当时还没有界面能切球 —— 已在 Task 6 补上，端到端目前验到「过球心那一刀给出精确圆」）。

**Files:** `apps/web/src/threePrimitives.ts`, `threeSceneContent.ts`, `threePicking.ts` where needed, `sceneFit.ts` and tests; `e2e/geometry3d-sphere.spec.ts`.

**Interfaces:** `createSolidGroup(sphere, selected, options)` produces only render objects with `primitiveId/type="sphere"`; it never persists mesh vertices. Screen-quality mesh density may change without changing `.mgeo`. A tangent section draws a marker rather than an invisible 0-point mesh.

- [x] Add tests/e2e that fail before sphere rendering: a sphere at C=(1,2,3), r=5 is visible and selectable; camera orbit changes its projection but not stored C/r; no dense selectable latitude/longitude edges; tangent section point is visible.
```ts
const group = createSolidGroup(sphere, false)
expect(group.children.some((child) => child.userData.primitiveId === sphere.id && child.userData.primitiveType === "sphere")).toBe(true)
expect(group.children.filter((child) => child.userData.primitiveType === "edge3")).toHaveLength(0)
```
- [x] Implement mesh/picking/fit and reuse current materials/tokens. Run focused Three tests and sphere e2e, visually inspect an actual frame, typecheck/lint.
- [x] Record actual evidence in progress docs; commit/push and verify SHA/CI.

## Task 6 — Manual creation, preview and property editing

**交付证据（2026-10-01，两批）：** 代码提交 `04c0c88`（常用立体加球预设）与 `537ed69`（属性栏编辑 + 工具栏切球），均已推送并由 CI run #48 / #49 四项全绿。**实测**：`spatialSphereWizard.test.ts` **7/7**（RED 起点 5/7 红）、`SpatialSolidWizard.test.tsx` **6/6**、`e2e/geometry3d-sphere.spec.ts` **4/4** —— 覆盖本条点名的全部行为：未确认前预览不动文档、确认一次成球、改半径 5→4、一步撤销、保存/刷新、切一刀读出精确圆（`data-section-exact-kind=circle`）、非法半径如实报原因且文档不动。全库 **276 文件 / 3163 项通过 + 1 todo / 0 失败**；`typecheck` / `lint` exit 0。**实现时踩到的名单**：`packages/dsl/src/schema.ts` 里**另有一份** `solidTypes`，只改 UI 侧会「按钮可点、什么都没发生」—— 单元测试全绿，跑 e2e 才暴露。

**Files:** `apps/web/src/spatialSolidWizardModel.ts`, `components/SpatialSolidWizard.tsx`, `spatialSolidCommands.ts`, `solidCommands.ts`, `components/PropertiesBar.tsx`, `components/inspectorModel.ts` if needed; their existing tests and `e2e/geometry3d-sphere.spec.ts`.

**Interfaces:** `SolidPreset` adds `sphere` with `center`/`radius`. An unconfirmed wizard edit changes preview only; confirm issues one `addPrimitive`. Inspector uses the same `updatePrimitive { center3, radius3 }` as Task 3. Section creation accepts the selected sphere.

- [x] RED e2e: set C=(1,2,3), r=5, watch uncommitted preview and unchanged object count; confirm once, edit radius 5→4, undo in one step, save/reload, create plane cut and read exact circle. Invalid radius shows a reason and leaves document untouched.
```ts
await page.getByRole("combobox", { name: "立体类型" }).selectOption("sphere")
await page.getByRole("spinbutton", { name: "半径" }).fill("5")
await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-sphere-count", "0") // not confirmed
```
- [x] Implement the preset and fields by reusing existing `Vector3Fields`/`CoordinateField`; do not create a dead four-point-construction button. Run wizard model/component tests, e2e, typecheck/lint.
- [x] Update docs, commit/push and verify SHA/CI.

## Task 7 — Engineering projections and exports

**交付证据（2026-10-01）：** 代码提交 `488e8ad`（球投影）与 `91ac837`（夹具清点同步），已推送并由 CI run #52 四项全绿（#51 曾因夹具个数红过一次，见下）。**实测**：`apps/web/src/sphereProjection.test.ts` **5/5**（RED 起点 4/5 红，`expected [] to have a length of 1`）；`e2e/engineering-drawing.spec.ts` **5/5**（逐个视图点名「第 N 个视图里恰好一条球轮廓」，而不是「总共 4 条」）；全库 **277 文件 / 3168 项 + 1 todo / 0 失败**；`typecheck` / `lint` exit 0。**只画轮廓、不投影显示网格的三角形**；采样仍是既有的 `polyline` 图元，所以 `DrawingViewport` 与 `engineeringExporters` 一个字都没改。**CI 抓到的一件事**：新增夹具 `cad-sphere.mgeo` 会让 `e2e/solid-prism.spec.ts` 里「打开每一只随仓库发布的夹具」那条硬编码计数（14 → 15）失败 —— 本地只跑受影响的 spec 不足以替代全量 e2e；修完复跑全量 e2e **176 通过 / 0 失败**。**如实说明**：新增 e2e 的 RED 没有被独立观察到（只观察到单元用例的 RED）。**未做**：Task 8–9。


**Files:** `apps/web/src/projectionVisuals.ts`, `projectionVisuals.test.ts`, `apps/web/src/persistence/engineeringExporters.ts` only if the common `ProjectedPrimitive.polyline` contract needs a change; `e2e/engineering-drawing.spec.ts` / new sphere e2e.

**Interfaces:** A sphere projects to a closed circle of radius 5 in front/top/left/axonometric with projected centre matching the source centre. `sourceId` stays the sphere id; exporters consume the same renderer-neutral polyline.

- [x] Add failing tests for C=(1,2,3), r=5: all four orthographic views have equal circular radii, no extra mesh edges; a hidden sphere yields no projection. E2e exports SVG/DXF/PDF and asserts a sphere outline in each, not just non-empty files.
```ts
const outlines = resolveProjectedDrawing(document, "front").primitives.filter((item) => item.sourceId === "sphere-1")
expect(outlines).toMatchObject([{ kind: "polyline", closed: true }])
```
- [x] Implement analytic projection sampling using view bases; do not project the triangles of a display mesh. Run focused projection/export tests and e2e; update docs, commit/push, verify CI.

## Task 8 — Agent action only when the product path exists

**Files:** `packages/agent-core/src/actionIds.ts`, `actionRegistry.ts`, `actionInputs.ts`, `actionSchemas.test.ts`, `toolSetParity.test.ts`; `packages/scene-graph/src/actions/types.ts`, `actions/index.ts`, `actions/actions.test.ts`; Agent e2e.

**Interfaces:** Publish `solid.create_sphere` only after all three layers accept `{alias,center,radius}` with finite centre/r>0. Missing centre/radius is `ask_user`; provider output may not silently default them. Compiler emits the same `SpherePrimitive` as the manual path and does not claim unsupported Boolean tools.

**交付证据（2026-10-01）：** 代码提交 `46e5279` 已推送并由 CI run #54 四项全绿。**三层一起接**：动作层 `SolidCreateSphereAction` + `compileSolidSphereAction`（球只落一个图元，与手工路径同一种文档）；传输层 `actionIds` + `actionInputs`（只挡畸形、缺字段合法、半径非正按字段路径拒绝）；登记层 `actionRegistry`（`center`/`radius` 都 `ask_user`）+ `capabilities`（球翻成 `available`）+ `skills/manifest`（技能动作表与 `CAPABILITY_FOR_ACTION`）。**实测**：`sphereAction.test.ts` **7/7**（RED 起点 3/5 红 `unknown_action`；现已覆盖本条点名的 invalid radius / missing inputs / **alias 碰撞** / **一次确认的事务 + 保存往返**）、`actionSchemas.test.ts` **15/15**、`agent-core` 全包 **40 文件 / 521 项**、全库 **278 文件 / 3178 项 + 1 todo / 0 失败**、`typecheck`/`lint` exit 0。**"registry/schema 不一致"这条不是靠新写用例，而是靠既有的机器闸门**：`CAPABILITY_FOR_ACTION` 是 `Record<DraftActionIdName, string>`（漏登记编译不过），加上 `actionIds` / `capabilities` / `catalog`（内容哈希）/ `actionFieldParity` 四条用例 —— 它们在本批**确实把我挡下来了**（这一发现同时更正了 `current-status.md` 里"没有机器挡住"那条过重的表述）。**未做**：**Agent 端到端**（真模型跑一轮"画一个半径 5 的球"）—— 下面 bullet 2 因此**不勾**。

**补记（2026-10-01，同日稍晚；提交 `1806239`，CI run #59 四项全绿）：Agent 端到端已交付。** 浏览器里没有模型服务，规划器用的是**确定性本地规划器**；一旦产出计划，下游（传输校验 → 动作编译 → 隔离草稿 → 用户确认 → 原子落盘 → 撤销）与真实模型**走同一条**，所以给它加一条球指令就能把那条链路真的跑一遍。改动：`localPlanner.ts` 新增 `SPHERE` 构建器 + 条目 + 导出 `SPHERE_PROMPT`（半径从原话读第一个数字、读不到取 `DEFAULT_SOLID_SIZE`；**触发词只认「球体」、刻意不认裸词「球」** —— 裸词会把"求外接球半径"那类**分析题**拉进来去新建一只球，与既有"认正四面体、不认裸四面体"同一条纪律）。`e2e/geometry3d-sphere.spec.ts` 新增一条走**真界面**的用例（Agent 工作区 → 发送 → 确认改动面板 → 确认并提交 → 返回画布 → 一步撤销），断言"停在确认（会新增 1 个对象）/ 确认前零改动 / 确认后对象行 = 1 且文档里半径 5 / 一步 Ctrl+Z 归零"。**实测**：`localPlanner.test.ts` 加 3 条（RED 起点 3 条全红）→ **25/25**、球 e2e **6/6**、全库 **278 文件 / 3182 项 + 1 todo / 0 失败**、`typecheck`/`lint` exit 0、`tsc -p e2e/tsconfig.json` exit 0。**顺带查实一条既有隐患（未修，记为发现）**："这个正方体的内切球半径是多少"命中的是**既有的「正方体」条目** —— 规划器会去新建一只正方体而不是回答读数问题；与文档里早记过的"裸词四面体会命中分析题"同一类，修不修需单独定口径。

- [x] Write tests that fail for action registry/schema mismatch, invalid radius, alias collision, missing inputs, one confirmed scene transaction and saved round trip.
```ts
const parsed = parseActionToolInput("solid.create_sphere", { alias: "S", center: { x: 1, y: 2, z: 3 }, radius: 5 }, "step-1")
expect(parsed.ok).toBe(true)
```
- [x] Implement registry, schema and compiler together (not one unchecked layer ahead of the others). Run agent parity tests, scene action tests and e2e, then docs/commit/push/CI.

## Task 9 — Full product gate and release decision

**交付证据（2026-10-01）：三条 bullet 全部勾上，但"宣布球体能力整体交付"这一句按规格**没有**做 —— 它被发布边界挡着（见末尾）。**

- **bullet 1（六条门禁逐条报数）**：当次全量复跑 —— 全库 **278 文件 / 3179→3182 项通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` exit 0（**0 error / 13 warning**，既有基线）；`test:rust` **16 二进制 / 236 通过 / 0 失败 / 3 ignored**；`test:perf` **9/9**（`drag/300-frames` 682.5 ms ≈ 2.3 ms/帧，60 fps 预算 16.7 ms/帧；校准档 1× ≈6 ms vs 4× ≈16–22 ms）；**全量 e2e 本机 175 通过 / 1 失败** —— 那条失败（`geometry3d.spec.ts:277` 相机平移的 `toBeCloseTo`）经核实为**既有环境敏感**用例（回到球体工作之前的 `91ac837` 同样失败，且期望值逐次在 1.98/1.99 间变），**不是本批引入**，但**本机 e2e 因此不能当放行依据**，以 CI 的 `e2e` 作业为准（#52/#54/#55/#56/#57/#58/#59/#60 均 success）。
- **bullet 2（e2e 覆盖清单）**：**全部落到浏览器层** —— `e2e/geometry3d-sphere.spec.ts` **7 条**：数值创建（向导 + Agent 一句话）、精确圆（工具栏过球心）、**切点**、**空集**（后两例由"整数步方向键"走到：默认刀口常数 `-3`，五次 `ArrowUp` ⇒ `-8` 精确相切、再一次 ⇒ `-9` 空集，断言 `circle → point(点数 1) → empty(点数 0 不留旧点)`）、编辑后持久化、撤销、相机与选择、CAD 四视图与三件套导出（`engineering-drawing.spec.ts`）、**刻意的不支持布尔**（球参与的布尔交**一个预览都不给**，并以"两个立方体**有**预览"作反向对照）。
  - **一处自我更正**：切点/空集起初被我判成"验不了"（理由是"种一份草稿再读读数走不通" —— 恢复路径信任保存下来的派生字段、不重跑 `recomputeDerivedObjects`，该结论**本身是对的**）。**但"因此验不了"是错的**：改成**让应用自己算**（工具栏切一刀 → 方向键挪刀口）就能稳定走到。留档在用例注释里。
- **bullet 3（spec §5 逐行审计）**：六行逐条对真实文件与测试输出 —— 五行成立；**「工程图/导出与测量」那一行查出一处静默缺口并修掉**：`measurementVisuals.ts` 的 `pointPositions`（硬编码类型名单）**漏了 `sphere`**，于是球的面积/体积测量让 `resolveMeasurementVisual` 返回 `null`、**画布上一个字都不画**，而属性栏照样有数字（所以是静默的）；这是**同一张名单第二次漏配**（此前漏 `polyhedron3`）。已加球分支（落点取球心），RED `expected null not to be null` → GREEN。文档（`current-status.md` / `feature-catalog.md` / `project-progress.md` / `CHANGELOG.md`）均已更新，提交推送并逐个核对 SHA 与 CI。
- **为什么当时没有写"球体能力已完成"**：spec §6 与 §5 末句都要求"新的桌面 Release 需要一个匹配版本的安装包 + 安装证据"。当时发布三件套属 `current-status.md` §四 **D 类**，按计划要求**由用户先决定版本与是否发布**，不能由实现方自行宣布。
  **2026-10-02 更新（用户已决定 v3.1.0，发布已完成）**：版本真值 `3.0.1 → 3.1.0`（提交 `33facf1`）；根构建 exit 0（并核实外壳前端 `build-check/mathcanvas-current` 确为新鲜产物、含「球体」与 `create_sphere`）；`tauri build` 产出 MSI 6,848,512 B / NSIS 5,030,195 B / 裸 exe 17,190,400 B；注解 tag `v3.1.0`（→ `165e4fb`）已推送；**GitHub Release 已发布**（非 draft）：<https://github.com/Huo0077/mathcanvas/releases/tag/v3.1.0>，3 个资产**重下载后 SHA-256 与本地全部 MATCH**，匿名 API `releases/latest` 亦已返回 `v3.1.0`。
  **仍然不能声称"安装可用"的那一半**：**本机安装实测（装 → 启动 → 卸载）没做**（§四 D2，需用户决定）。因此本计划的口径是：**源码、安装包、Release 三者一一对应且哈希可复核 = 已交付；"本机装过一遍"= 未做。**

**Files:** `e2e/geometry3d-sphere.spec.ts`, `docs/current-status.md`, `docs/feature-catalog.md`, `docs/project-progress.md`, `CHANGELOG.md`; release packaging only after a separately selected version/tag.

- [x] Run `npm.cmd test -- --maxWorkers=3`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test:e2e -- --workers=3`, `npm.cmd run test:rust`, `npm.cmd run test:perf`; report counts/warnings/ignored tests, not a generic “all green”.
- [x] E2e cover numeric creation, exact circle/tangent/empty, edited persistence, undo, camera/selection, CAD views and export, deliberate unsupported sphere Boolean operation.
- [x] Audit spec §5 row by row against real files/test output. Update `current-status.md`, feature catalog and progress; push, verify remote SHA and every CI job. Only then mark sphere capability complete. A new desktop Release still needs a matching versioned installer plus installation evidence.

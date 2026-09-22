# Audit: geometry kernel + DSL schema/codec (scope: `packages/geometry-kernel/**`, `packages/dsl/**`)

Round inspected: local commits `7cff139`..`30dda29` (Solid/Prism, Reactive DAG, Agent DSL, conversations, plus the 收口 round).
Method: read the scoped sources end-to-end, traced each suspicion into its consumers (in `packages/scene-graph` and `apps/web` where the reachability matters), then **ran probes** for every finding below that could be executed.
Probe harness lives **outside the repo** in `D:\draw\.audit-tmp\` and is kept there so every number below can be re-run: `vitest.config.ts` roots there and aliases `@draw/dsl` / `@draw/geometry-kernel` to the workspace sources; run

```
cd D:\draw\draw; node_modules\.bin\vitest.cmd run --config D:\draw\.audit-tmp\vitest.config.ts
```

Files: `cost.test.ts` (I1), `prismplane.test.ts` (I2), `winding.test.ts` (I3), `probe.test.ts` (I4 + M1 + M2), `final.test.ts` (M3 + the "checked clean" figure-eight probe). All 5 files / 8 cases pass; the assertions there only *print* the observed behaviour, they do not fail, because the point is to exhibit it. Nothing inside `D:\draw\draw` was created or modified except this report.

The "如实缺口" list in `docs/project-progress.md` (newest batch section + the itemized known gaps) was read first and is **not** re-reported here: `approximate`/`degenerate` having no production source, the §8.1 "P on one edge only" limitation, the `it.todo` about sections not following a translated solid, single-vertex template edits being refused, `style: undefined` from `buildSolidTemplate`, the reachability-only-through-store retraction entry point, `truncated_derived` duplicate warnings, etc.

Counts: **0 Critical / 4 Important / 3 Minor**.

---

## I1 — Important: `solveCircumsphere3` enumerates all `C(n,4)` vertex subsets (plus a growing linear-scan dedupe) — a user-reachable multi-minute freeze

**Where**
- `packages/geometry-kernel/src/solidDerived.ts:164-186` — the four nested loops over vertex indexes (`for first … for fourth`), the `solveLinearSystem` call, and the `seenCenters.some(…)` dedupe at line 177. Lines 180-182 compute the radius/residual and `return exact` on the first acceptance.
- Reachability (this is what makes it a user bug, not a curiosity): `packages/scene-graph/src/operations.ts:1311-1325` (`solidStatusReport`) calls `solveCircumsphere3` for **every** `polyhedron3` whose topology reads out; `apps/web/src/components/PropertiesBar.tsx:505-513` calls `solidStatusReport(sceneDocument)` for the **whole document** whenever any primitive is selected (`if (!selectedPrimitive) return []` is the only guard, so the comment at 496-498 claiming "only the selected solid is computed" does not describe the code); `packages/agent-core/src/sceneObservation.ts:328` calls it for every observation.

**Input** — a prism whose base polygon is *not* cyclic (an irregular polygon), which is exactly what `solid.create_prism` accepts (`basePolygon` is an arbitrary world-point list; the 3-D parameter audit puts no vertex-count cap on it). Probe: `baseCount` points with radius `3 + 0.7·sin(1.7·i)` extruded by `(0,0,4)`.

**Wrong behaviour (measured, `D:\draw\.audit-tmp\cost.test.ts`)**
```
I1 nonCyclic baseCount=8  vertices=16  status=undefined  elapsed=103ms
I1 nonCyclic baseCount=9  vertices=18  status=undefined  elapsed=246ms
I1 nonCyclic baseCount=10 vertices=20  status=undefined  elapsed=684ms
I1 nonCyclic baseCount=11 vertices=22  status=undefined  elapsed=1538ms    (≈2.4-2.8x per +2 vertices)
I1 cyclic     segments=32 vertices=64  status=exact      elapsed=0ms
I1 insphere   baseCount=11             status=undefined  elapsed=2ms        (same input, iterative solver)
```
Extrapolating the same curve: 32 vertices ≈ minutes, 48 vertices ≈ hours. A regular/cyclic polygon exits early (a 32-segment cylinder = 64 vertices returns `exact` in 0 ms), so the blow-up only shows on non-cyclic input — i.e. never in the repo's own tests, which all use cubes, tetrahedra and regular prisms.

**Expected.** A circumsphere candidate is *unique* for any affinely independent 4-subset, so the scan is unnecessary: the first successfully solved subset either passes the all-vertex residual check (`exact`) or proves no circumsphere exists (`undefined`). Cost should be O(n) (one solve + one residual sweep), not O(n⁴)·O(|seenCenters|).

**Smallest fix.** Take the first `solution` that `solveLinearSystem` returns and decide right there:
```ts
if (!solution) continue
…
if (radius <= tolerance) return { status: "degenerate", reason: "…" }   // was: continue
return Math.max(...distances) - Math.min(...distances) <= tolerance
  ? { status: "exact", value: { center: candidate, radius } }
  : { status: "undefined", reason: "该多面体没有外接球：…" }
```
(keep the loop only to skip *singular* subsets). Secondarily, replace `seenCenters.some(…)` with a quantised `Set` key — the linear scan over a list that grows with the number of subsets is what turns the asymptotics from bad into catastrophic.

---

## I2 — Important: `base.plane` + a **3-D** polygon disables prism geometry validation on *both* the import and the save path

**Where**
- `packages/dsl/src/schema.ts:447-460` — the injected geometric judge (`prismConstructionValidator`) is only invoked when `planeBase === undefined` (line 456), while `validPolygon` (line 453-454) accepts either 2-D or 3-D points whenever `base.plane` is present (`isFiniteCoordinate` only checks `x`/`y`, so a `{x,y,z}` point passes).
- `packages/dsl/src/codec.ts:96-113` — `withPrismBasePolygon` only lifts/rewrites the base when `isPrismPlaneBase(base)` is true, and `packages/geometry-kernel/src/prism.ts:93-105` requires every polygon point to have **no** `z` key. So the "plane + 3-D polygon" spelling is never lifted, keeps its `plane`, and therefore never reaches the semantics hook.
- The intended invariant is stated in `codec.ts:6-18` and `schema.ts:280-291`: "创建路径与导入路径用的是同一份判据".

**Input (probe, `D:\draw\.audit-tmp\prismplane.test.ts`)** — the same three bases the existing test `packages/dsl/src/codec.test.ts:594-610` uses to prove rejection, but with `base = { plane: { origin: (0,0,0), normal: (0,0,1) }, polygon: <3-D points> }`:
- bow-tie base `(0,0,0),(4,4,0),(4,0,0),(0,4,0)` + vector `(0,0,3)`,
- non-coplanar base `(0,0,0),(4,0,0),(4,3,0),(0,3,1)` + vector `(0,0,3)`,
- zero-volume base `(0,0,0),(4,0,0),(4,3,0),(0,3,0)` + vector `(2,0,0)`.

**Wrong behaviour (measured)**
```
I2 control bowtie (no plane): rejected: Invalid geometry document: solid-bowtie prism base is invalid: 棱柱底面多边形自交。
I2 bowtie+plane:             accepted
I2 warped+plane:             accepted
I2 validateDocument(flat + plane) = {"valid":true}
I2 encodeMgeo(flat + plane)       = accepted
```
So a `.mgeo` (or an in-memory document about to be saved) can carry a self-intersecting, non-coplanar, or zero-volume prism and pass `decodeMgeo`/`validateDocument`/`encodeMgeo` unharmed. Downstream recompute from that descriptor (`scene-store` re-materialises the prism from `base.polygon`) is then the first place the geometry is questioned, if ever.

**Expected.** The geometric judge must run on every spelling whose polygon is already in world coordinates; only the genuinely 2-D form (which the codec lifts before validation) may skip it — that is what the comment at `schema.ts:456-459` says it does.

**Smallest fix (schema.ts:456).** Key the skip on the polygon's shape, not on the presence of the plane:
```ts
const polygonIsPlanarInput = polygon !== undefined && polygon.every((point) => isRecord(point) && !("z" in point))
…
else if (options.prismConstructionValidator && !polygonIsPlanarInput) { … }
```

---

## I3 — Important: `facesOutwards` uses only the first three ring points, so a ring that starts with collinear points is flipped the wrong way

**Where** — `packages/geometry-kernel/src/prism.ts:331-344` (`facesOutwards`; the normal is `cross(ring[1]-ring[0], ring[2]-ring[0])` at line 336) used at line 380 to normalise every face, plus the contract in `SolidTopology` (lines 32-36): "环绕方向一律规范成**朝外**（`(p1-p0)×(p2-p0)` 就是外法向）".

**Why it happens.** If `ring[0..2]` are collinear the cross product is the zero vector, `dot(normal, outward) > 0` is false, and the ring is reversed — regardless of which way the face actually pointed. The same file takes care to solve this problem for its other two judgements (`baseNormal` at 172-190 and `projectForIntersection` at 199-215 exist *because* "模型给出的多边形在边上多带一个共线点是很常见的"), but not for the winding normal.

**Input (probe, `D:\draw\.audit-tmp\winding.test.ts`)**
```
base = (2,0,0), (1,0,0), (0,0,0), (0,1,0), (2,1,0)      // valid pentagon, first three collinear,
vector = (0,0,3)                                        // wound CW = already outward for the base
validatePrismInput → {"ok":true}
```
**Wrong behaviour (measured, Newell normal · (faceCentre − solidCentroid))**
```
face 0 (base) ring [4,3,2,1,0]  newellDot = -6      ← base face points INTO the solid
face 1 (top)  ring [9,8,7,6,5]  newellDot = +6
faces 2..6 (sides)              newellDot = +2.4 … +7.2
```
The same base passed CCW (where the input ring really was inward) is normalised correctly, and a plain rectangle base is normalised correctly — so this is a coin-flip branch, not a systematic convention.

**Expected.** All face rings outward, as the type's docstring promises: the base face of a prism extruded along `+z` must have `−z` as its normal. The bug affects rendering normals/back-face culling and anything that reads the face normal (e.g. the properties bar's "current orientation" reading and section normals).

**Smallest fix (prism.ts:332-343).** Use a robust ring normal (Newell, or the first non-collinear triple — `baseNormal(ring.map(i => vertices[i]))` already exists) and treat a zero normal as "orientation unknown, keep the ring as given" instead of flipping:
```ts
const normal = baseNormal(ring.map((index) => vertices[index]))
if (lengthVector3(normal) === 0) return true
…
return normal.x * outward.x + normal.y * outward.y + normal.z * outward.z > 0
```

---

## I4 — Important: triangle centres/radii report a valid small triangle as degenerate (tolerance is not actually relative)

**Where** — `packages/geometry-kernel/src/reactive/triangleCenters.ts:65-69`. The docstring on `TriangleOptions.tolerance` (lines 38-40) says the degeneracy judge is **relative** ("相对容差（除以最长边²）"), but line 67 clamps the scale with `Math.max(1, |AB|, |AC|)`, which makes the tolerance absolute `1e-9` for every model smaller than one unit.

**Input (probe, `D:\draw\.audit-tmp\probe.test.ts`)**
```
A = (0,0,0), B = (1e-5,0,0), C = (0,1e-5,0)             // a perfectly good right triangle
triangleCenter("circumcenter", …) → {"status":"degenerate","reason":"三点共线（或重合），三角形没有自身的二维基底。"}
triangleRadius("inradius", …)     → same degenerate
triangleCenter("circumcenter", A(0,0,0), B(1,0,0), C(0,1,0)) → {"status":"exact","value":{"x":0.5,"y":0.5,"z":0}}
```
**Wrong behaviour.** `|（B−A)×(C−A)| = 1e-10 ≤ tolerance·scale² = 1e-9` → every centre except `centroid` (`triangleCenter2`/`triangleRadius2`, the `triangleCircleNodes` incircle/circumcircle, and the `kind:"triangle"` radius rule in the DSL) answers "collinear". The break-even is at a leg of ≈3.2e-5, so any drawing/triangle at that scale silently loses its incircle/circumcircle.

**Expected.** `exact` with the true centre `(5e-6, 5e-6, 0)` and radii; degeneracy must be judged relative to the triangle's own size.

**Smallest fix (line 67).** Drop the unit clamp (`const scale = Math.max(|AB|, |AC|)`) — the cross-product length already carries the right units — and keep a separate absolute floor only for the exactly-zero case (`if (!(scale > 0)) return true`).

*Related, same idiom, lower impact:* `packages/dsl/src/schema.ts:153` (`areCoplanarPoint3s`) also clamps with `Math.max(1, …)`, which makes the coplanarity tolerance *looser* (absolute 1e-8) for sub-unit models; that direction is harmless in practice, so it is not a numbered finding.

---

## M1 — Minor: `sampleLocus`'s `maxJump` can only *loosen* jump detection (documented as the stricter of the two)

**Where** — `packages/geometry-kernel/src/locus-sampling.ts:150-156`:
```ts
const jumpThreshold = Math.max(
  typicalStep * jumpFactor,
  Math.max(typicalStep, 1e-9),
  Number.isFinite(options.maxJump ?? Number.POSITIVE_INFINITY) ? (options.maxJump as number) : 0
)
```
The option is documented (lines 34-35) as "单步的绝对上限（世界单位）。与 `jumpFactor` 取**更严**的那个" — stricter means `min`, the code takes `max`.

**Input (probe, `D:\draw\.audit-tmp\probe.test.ts`)**
```ts
evaluate = (t) => ({ x: t, y: t < 0.5 ? t : t + 0.2 })   // 0.2-sized step at t = 0.5, median step 0.1
sampleLocus(evaluate, { domain: [0,1], samples: 11 })                    → branches=1 breaks=[]
sampleLocus(evaluate, { domain: [0,1], samples: 11, maxJump: 0.05 })     → branches=1 breaks=[]
sampleLocus(evaluate, { domain: [0,1], samples: 11, maxJump: 100 })      → branches=1 breaks=[]
```
**Wrong behaviour.** `maxJump: 0.05` is a no-op (threshold stays `0.1·4 = 0.4`, so the 0.2 step is chained into one branch); a `maxJump` *larger* than `jumpFactor·median` does raise the threshold, i.e. it makes detection weaker. The documented behaviour would give `threshold = min(0.4, 0.05) = 0.05` → 2 branches and a break at ≈0.5.

**Expected.** `Math.min(jumpFactor·median, maxJump)` with the `1e-9` term kept as a separate lower bound.

**Honest reachability note.** No in-repo caller passes `maxJump` today (`reactive/locus.ts:66` and `apps/web/src/reactivePreview.ts:241` only forward it), so this is a latent public-API defect, not a live wrong render.

**Smallest fix.** Make the threshold the *stricter* of the two while keeping the degenerate-median floor: `threshold = min(typicalStep · jumpFactor, maxJump)`, with the `1e-9` term applied only when `typicalStep === 0` (the current unconditional `Math.max(…, typicalStep, 1e-9)` also guarantees `threshold ≥ typicalStep`, which by itself prevents any tightening below the median step):

```ts
const byAbsolute = Number.isFinite(options.maxJump ?? Number.POSITIVE_INFINITY) ? (options.maxJump as number) : Number.POSITIVE_INFINITY
const jumpThreshold = typicalStep === 0
  ? Math.max(byAbsolute === Number.POSITIVE_INFINITY ? 1e-9 : byAbsolute, 1e-9)
  : Math.min(typicalStep * jumpFactor, byAbsolute)
```

---

## M2 — Minor: `liftPrismBasePolygon`'s in-plane basis is left-handed and transposes the 2-D coordinates, contradicting its own contract

**Where** — `packages/geometry-kernel/src/prism.ts:118-143` (the basis at 129-137, the lift at 138-142). The docstring claims: "`u = n × axis` 归一化、`v = u × n`，于是 `(u, v, n)` 是正交右手系 … 抬升结果就是 `origin + (x, y, 0)`". But `u × v = u × (u × n) = −n` **always**, i.e. the basis is left-handed for every normal, and for `normal = +z` the reference axis chosen first is `+x`, giving `u = +y`, `v = +x`.

**Input (probe, `D:\draw\.audit-tmp\probe.test.ts`)** — the spec §3.2 example:
```
plane.origin = (0,0,2), normal = (0,0,1)
polygon      = (0,0), (4,0), (5,2), (1,2)
lifted       = (0,0,2), (0,4,2), (2,5,2), (2,1,2)
documented   = (0,0,2), (4,0,2), (5,2,2), (1,2,2)
```
**Wrong behaviour.** The bottom face is the *transpose* `(x,y) → (y,x)` of the requested one: a reflection of the plane's own `(x,y)`. For the spec's parallelogram example the result is still a rigid image (a parallelogram is centrally symmetric), but for a non-centrally-symmetric base polygon — e.g. `(0,0),(4,0),(5,2),(1,3)` — the imported solid is the mirror placement of the requested figure, and every world-coordinate consumer (the cut plane, the specified midpoints, measurements) sees the mirrored placement. `packages/dsl/src/codec.test.ts:566-573` deliberately asserts only "on the plane + edge lengths preserved" ("免得把测试绑在基底的**朝向**上"), so nothing pins or catches this.

**Expected.** For `normal = +z`, `u = +x`, `v = +y` (as the docstring states), and a right-handed `(u, v, n)`.

**Smallest fix.** Choose the reference axis as the least-parallel axis but build the basis with `u = cross(axis, normal)`, `v = cross(normal, u)` (for `normal = +z` and the axis tie broken to `+y`, this yields exactly `u = +x, v = +y`), or keep the current basis and correct the docstring/include the resulting coordinates in the test's assertion — either way, stop claiming `origin + (x, y, 0)` for a mapping that produces `origin + (y, x, 0)`.

---

## M3 — Minor: `buildPrism` silently returns an **inside-out** solid for a CW-wound base, while `buildPrismTopology` normalises the same input

**Where** — `packages/geometry-kernel/src/solid-builders.ts:342-352` (`buildPrism` generates rings `[reversed base, base-order top, sides]` and hands them to `buildFromPoints`), `buildFromPoints` checks only *relative* winding (`inconsistent-winding`, line 327) and `|volume|` (line 337), versus `packages/geometry-kernel/src/prism.ts:374-380`, which normalises every ring to outward.

**Input (probe, `D:\draw\.audit-tmp\final.test.ts`)**: base `(0,0),(2,0),(2,2),(0,2)` CCW vs `(0,2),(2,2),(2,0),(0,0)` CW, vector `(0,0,3)`.
**Wrong behaviour (measured)**: `validatePrismInput` accepts both and `buildPrismTopology` builds both; `buildPrism` returns **no diagnostics** for both, but the signed volume of its output is `+72` for the CCW base and `−72` for the CW base — every face normal of the CW case points inward (consistently, so `inconsistent-winding` never fires and `|volume|` passes).

**Expected.** Either normalise (like `buildPrismTopology`, which the production `solid.create_prism` path uses) or reject the inside-out result; the two exported prism builders must not disagree about orientation for the same input.

**Honest reachability note.** `buildPrism`/`buildSolid("prism")` have **no in-repo production caller** (the app materialises prisms through `compileSolidPrism` → `buildPrismTopology`, and templates via `buildCube`/`buildCylinder`, which are always CCW), so this is a latent kernel-API divergence. The round's cross-implementation consistency test (`packages/geometry-kernel/src/solid-builders.test.ts:107-140`) compares accept/reject only, which is why the orientation drift survived it.

**Smallest fix.** In `buildPrism` (and `buildFrustum`), orient the bottom ring relative to the extrusion vector before delegating — or have `buildFromPoints` report "all normals inward" as a diagnostic instead of only relative inconsistency.

---

## Checked and found clean (coverage, so the reader knows what was actually examined)

Read end-to-end, no finding:

- `packages/geometry-kernel/src/prism.ts` — `validatePrismInput` (independent diagnostic collection, scale-relative tolerances, `degenerate-volume` for a vector parallel to the base; agrees with `buildPrism` on the shared accept/reject inputs, verified by running both on the same bases), `buildPrismTopology` vertex/edge/face derivation and `Ti = Bi + v` formulas (faces/edges close, every edge belongs to exactly two faces in the exercised cases).
- `packages/geometry-kernel/src/sections3d.ts` — `sectionPolyhedron3` + `chainSectionLoops`. Traced and then **ran** the hard cases (`D:\draw\.audit-tmp\final.test.ts` for the figure-eight): plane through an edge shared by two faces (duplicate segments are absorbed by the `used` edge set), plane through a vertex triangle, and a **vertex-touching figure-eight** (two tetrahedra sharing an apex, cut so the section is two triangles joined at the shared vertex) →
  `status=polygon points=3 loops=3,3`, `[0,0,0],[0.5,0.5,0],[0,0,1]` and `[-0.5,-0.5,0],[0,0,0],[0,0,-1]` — both triangles correct, never merged into a self-intersecting 6-point loop. Degenerate plane normals and "no loop closed" are reported as `insufficient-data` rather than fabricated.
- `packages/geometry-kernel/src/solidDerived.ts` — `solveInsphere3`'s iteration terminates (bounded region + strictly increasing `best` + step halving), the four-state honesty (no `approximate` masquerading as `exact`), the box fast path's corner + octant test, and `sectionSolid3`'s single-source-of-truth sectioning.
- `packages/geometry-kernel/src/reactive/**` — `graph.ts` in full: reverse-closure recovery for **deleted** seeds (scan of declared dependencies), cycle rejection *before* any evaluator runs, `selfReferential` handling, rejected non-finite parameter writes that survive a following `evaluate`, signature-based pruning keyed on result-object identity, and the `dependency-graph.dirtyClosure` topo-filter being compensated by the BFS over `dependentsOf` for cycle members. `constraints.ts` / `derivedNodes.ts` / `derivedCircles.ts` / `triangleCenters.ts` / `locus.ts`: evaluators read only their `inputs`, are wrapped by `runEvaluator`'s non-finite sweep, and `applyParameterBounds`/`normalizeHostParameter` are the single domain-semantics implementation. `createTransientTrace` is bounded (sliding window); `sampleLocusFromGraph` restores the pre-sampling parameter value.
- Grep for module-level mutable state in the kernel (`^\s*(let|var)`) — every hit is function-local, so the "pure evaluator" invariant holds for the reactive layer.
- `packages/geometry-kernel/src/geometry3d.ts`, `hosts3.ts` (orientation by signed volume, convexity probe, `clampPointIntoSolid3`'s bisection fallback, `closedFacePlanes3` degeneracy gates), `solid-builders.ts`'s template/round-solid hidden-topology logic and segment cap.
- `packages/dsl/src/codec.ts` — the three decode-time migrations (`withSectionClassification`, `withCircleTrackCenter`, `withPrismBasePolygon`) are idempotent, run before `validateDocument`, and do not throw on legacy files; the wrapped-vs-bare document form both decode; `encodeMgeo`/`decodeMgeo` preserve primitives bit-for-bit (the repo's own round-trip tests were read).
- `packages/dsl/src/schema.ts` (all 937 lines) — parameter entries (id/key/value/min/max/step/ownerId), reference integrity for faces/edges/polyhedra/intersections/measurements/engineering annotations/groups/constraints, layer–sheet–view id uniqueness and cross-references, and `metadata.name`. The only validation gap I could turn into a wrong-behaviour repro is I2.

## Not covered by this pass (honest gaps)

- `boolean3d.ts`, `intersections3d.ts`, `measurements3d.ts`, `unfold3d.ts`, `quadrics.ts`, `section-quadric.ts`, `intersection-surfaces.ts`, `exact-forms.ts`, `polynomial.ts`, `planar-constraints.ts`, `dynamic-measurements.ts` were only skimmed for the specific things I needed; they were not audited claim-by-claim.
- `packages/dsl/src/schema.ts` does not validate the *shape* of `dynamics` entries at all (only "must be an array"). I did **not** report it: `grep` finds no consumer of `document.dynamics` anywhere in the repo, so no wrong behaviour follows today.
- I did not evaluate the React/UI layers, `packages/scene-graph`, `packages/agent-core` or the Rust side beyond tracing reachability for the findings above.

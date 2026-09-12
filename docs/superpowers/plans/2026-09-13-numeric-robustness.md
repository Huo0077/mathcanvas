# Math Kernel Numeric Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scale-aware numeric comparisons, explicit intersection classifications, and robust orientation predicates while preserving the existing intersection API and transactional Scene Graph behavior.

**Architecture:** Keep pure numeric policy and geometric algorithms inside `@draw/geometry-kernel`. Add detailed discriminated-result APIs beside compatibility wrappers, then migrate Scene Graph recomputation to the detailed APIs so valid empty geometry and invalid inputs have different transaction outcomes.

**Tech Stack:** TypeScript 5.9, Vitest 3, npm workspaces, `robust-predicates@3.0.3`

**Spec:** `docs/superpowers/specs/2026-09-13-numeric-robustness-design.md`

## Global Constraints

- Do not modify Agent, Provider Router, model configuration, prompt, or image parsing code.
- Do not change `schemaVersion` or the serialized `.mgeo` shape.
- Keep `intersectLines`, `intersectLineCircle`, and `intersectCircles` source-compatible.
- Use immutable per-call numeric policy; do not add mutable global tolerance state.
- Reject non-finite input before tolerance comparisons.
- Two-point results must be ordered by parameter along the first input primitive.
- Before Task 1, preserve the existing verified but uncommitted grouping/constraint work in a separate commit; do not mix it with numeric-robustness commits.

---

### Task 1: Scale-Aware Numeric Policy

**Files:**
- Create: `packages/geometry-kernel/src/numeric.ts`
- Create: `packages/geometry-kernel/src/numeric.test.ts`
- Modify: `packages/geometry-kernel/src/index.ts`

**Interfaces:**
- Consumes: finite JavaScript numbers.
- Produces: `NumericPolicy`, `defaultNumericPolicy`, `scaledTolerance`, `nearlyZero`, `nearlyEqual`, and `allFinite`.

- [x] **Step 1: Write failing numeric policy tests**

```ts
import { describe, expect, it } from "vitest"

import { allFinite, defaultNumericPolicy, nearlyEqual, nearlyZero, scaledTolerance } from "./numeric"

describe("numeric policy", () => {
  it("scales tolerance with operand magnitude", () => {
    expect(scaledTolerance([1, 2], defaultNumericPolicy)).toBeCloseTo(2e-11)
    expect(scaledTolerance([1e9, 2e9], defaultNumericPolicy)).toBeCloseTo(0.02)
  })

  it("compares small and large values consistently", () => {
    expect(nearlyEqual(1, 1 + 5e-12)).toBe(true)
    expect(nearlyEqual(1e9, 1e9 + 0.005)).toBe(true)
    expect(nearlyZero(5e-13, [1])).toBe(true)
  })

  it("rejects non-finite input", () => {
    expect(allFinite([0, 1, Number.NaN])).toBe(false)
    expect(() => scaledTolerance([Number.POSITIVE_INFINITY])).toThrow("numeric inputs must be finite")
  })
})
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run packages/geometry-kernel/src/numeric.test.ts`  
Expected: FAIL because `./numeric` does not exist.

- [x] **Step 3: Implement immutable numeric policy**

```ts
export interface NumericPolicy {
  absoluteTolerance: number
  relativeTolerance: number
}

export const defaultNumericPolicy: Readonly<NumericPolicy> = Object.freeze({
  absoluteTolerance: 1e-12,
  relativeTolerance: 1e-11
})

export function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

export function scaledTolerance(values: readonly number[], policy: NumericPolicy = defaultNumericPolicy): number {
  if (!allFinite(values)) throw new Error("numeric inputs must be finite")
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)))
  return Math.max(policy.absoluteTolerance, policy.relativeTolerance * scale)
}

export function nearlyZero(value: number, scaleValues: readonly number[], policy: NumericPolicy = defaultNumericPolicy): boolean {
  return Math.abs(value) <= scaledTolerance([value, ...scaleValues], policy)
}

export function nearlyEqual(first: number, second: number, policy: NumericPolicy = defaultNumericPolicy): boolean {
  return Math.abs(first - second) <= scaledTolerance([first, second], policy)
}
```

Export `./numeric` from `packages/geometry-kernel/src/index.ts`.

- [x] **Step 4: Run focused tests and type checking**

Run: `npm.cmd test -- --run packages/geometry-kernel/src/numeric.test.ts`  
Expected: 3 tests PASS.

Run: `npm.cmd run typecheck --workspace @draw/geometry-kernel`  
Expected: exit code 0.

- [x] **Step 5: Commit the numeric policy**

```bash
git add packages/geometry-kernel/src/numeric.ts packages/geometry-kernel/src/numeric.test.ts packages/geometry-kernel/src/index.ts
git commit -m "feat: centralize geometry numeric policy"
```

---

### Task 2: Detailed and Robust Line Intersections

**Files:**
- Modify: `packages/geometry-kernel/package.json`
- Modify: `package-lock.json`
- Modify: `packages/geometry-kernel/src/types.ts`
- Modify: `packages/geometry-kernel/src/intersections.ts`
- Modify: `packages/geometry-kernel/src/intersections.test.ts`

**Interfaces:**
- Consumes: `NumericPolicy` from Task 1 and `orient2d` from `robust-predicates@3.0.3`.
- Produces: `IntersectionResult` and `intersectLinesDetailed(first, second, policy?)` while preserving `intersectLines(first, second)`.

- [x] **Step 1: Install the focused robust predicate dependency**

Run: `npm.cmd install robust-predicates@3.0.3 --workspace @draw/geometry-kernel`  
Expected: `packages/geometry-kernel/package.json` and `package-lock.json` record version `3.0.3`.

- [x] **Step 2: Add failing line classification and scale tests**

Add imports for `intersectLinesDetailed` and these tests:

```ts
it.each([1e-9, 1, 1e9])("classifies scaled line intersections at scale %s", (scale) => {
  const result = intersectLinesDetailed(
    { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2 * scale, y: 2 * scale } },
    { id: "b", type: "line", a: { x: 0, y: 2 * scale }, b: { x: 2 * scale, y: 0 } }
  )
  expect(result.kind).toBe("point")
  if (result.kind === "point") expect(result.point).toEqual({ x: scale, y: scale })
})

it("distinguishes parallel and coincident lines", () => {
  expect(intersectLinesDetailed(
    { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
    { id: "b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 3 } }
  )).toEqual({ kind: "none", reason: "parallel" })
  expect(intersectLinesDetailed(
    { id: "a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 2 } },
    { id: "b", type: "line", a: { x: 4, y: 4 }, b: { x: 6, y: 6 } }
  )).toEqual({ kind: "coincident" })
})

it("classifies zero-length and non-finite lines as degenerate", () => {
  expect(intersectLinesDetailed(
    { id: "a", type: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 } },
    { id: "b", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
  ).kind).toBe("degenerate")
  expect(intersectLinesDetailed(
    { id: "a", type: "line", a: { x: Number.NaN, y: 0 }, b: { x: 1, y: 1 } },
    { id: "b", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }
  ).kind).toBe("degenerate")
})
```

- [x] **Step 3: Run line tests and verify RED**

Run: `npm.cmd test -- --run packages/geometry-kernel/src/intersections.test.ts`  
Expected: FAIL because `intersectLinesDetailed` is not exported.

- [x] **Step 4: Add the discriminated result type**

```ts
export type IntersectionResult =
  | { kind: "none"; reason: "disjoint" | "parallel" }
  | { kind: "point"; point: Coordinate }
  | { kind: "tangent"; point: Coordinate }
  | { kind: "points"; points: [Coordinate, Coordinate] }
  | { kind: "coincident" }
  | { kind: "degenerate"; reason: string }
```

- [x] **Step 5: Implement detailed line intersection**

Use `allFinite` before arithmetic and `nearlyZero` for direction-length degeneracy. Normalize both direction vectors before testing their determinant so fixtures scaled to `1e-9` and `1e9` share a dimensionless parallelism decision. Use `orient2d` to distinguish parallel from coincident. Return `{ kind: "point", point }` only when both coordinates are finite.

Keep the wrapper exact:

```ts
export function intersectLines(first: LinePrimitive, second: LinePrimitive): Coordinate | null {
  const result = intersectLinesDetailed(first, second)
  return result.kind === "point" ? result.point : null
}
```

- [x] **Step 6: Run focused tests and type checking**

Run: `npm.cmd test -- --run packages/geometry-kernel/src/numeric.test.ts packages/geometry-kernel/src/intersections.test.ts`  
Expected: all focused tests PASS, including existing wrapper tests.

Run: `npm.cmd run typecheck --workspace @draw/geometry-kernel`  
Expected: exit code 0.

- [x] **Step 7: Commit robust line intersections**

```bash
git add packages/geometry-kernel/package.json package-lock.json packages/geometry-kernel/src/types.ts packages/geometry-kernel/src/intersections.ts packages/geometry-kernel/src/intersections.test.ts
git commit -m "feat: classify robust line intersections"
```

---

### Task 3: Detailed Circle Intersection Classification

**Files:**
- Modify: `packages/geometry-kernel/src/intersections.ts`
- Modify: `packages/geometry-kernel/src/intersections.test.ts`

**Interfaces:**
- Consumes: `IntersectionResult`, `NumericPolicy`, `allFinite`, `nearlyEqual`, and `nearlyZero`.
- Produces: `intersectLineCircleDetailed` and `intersectCirclesDetailed`; preserves array-returning wrappers.

- [x] **Step 1: Add failing line-circle tests**

```ts
it.each([1e-9, 1, 1e9])("classifies line-circle tangency at scale %s", (scale) => {
  const result = intersectLineCircleDetailed(
    { id: "line", type: "line", a: { x: -2 * scale, y: scale }, b: { x: 2 * scale, y: scale } },
    { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: scale }
  )
  expect(result.kind).toBe("tangent")
  if (result.kind === "tangent") expect(result.point).toEqual({ x: 0, y: scale })
})

it("orders two line-circle points by the line parameter", () => {
  const result = intersectLineCircleDetailed(
    { id: "line", type: "line", a: { x: 2, y: 0 }, b: { x: -2, y: 0 } },
    { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 1 }
  )
  expect(result).toEqual({ kind: "points", points: [{ x: 1, y: 0 }, { x: -1, y: 0 }] })
})
```

- [x] **Step 2: Add failing circle-circle tests**

```ts
it("distinguishes tangent, coincident, and disjoint circles", () => {
  const first = { id: "first", type: "circle" as const, center: { x: 0, y: 0 }, radius: 2 }
  expect(intersectCirclesDetailed(first, { id: "tangent", type: "circle", center: { x: 4, y: 0 }, radius: 2 }).kind).toBe("tangent")
  expect(intersectCirclesDetailed(first, { id: "same", type: "circle", center: { x: 0, y: 0 }, radius: 2 })).toEqual({ kind: "coincident" })
  expect(intersectCirclesDetailed(first, { id: "inside", type: "circle", center: { x: 0.5, y: 0 }, radius: 0.25 })).toEqual({ kind: "none", reason: "disjoint" })
})

it("rejects invalid circle geometry", () => {
  expect(intersectCirclesDetailed(
    { id: "first", type: "circle", center: { x: 0, y: 0 }, radius: 0 },
    { id: "second", type: "circle", center: { x: 2, y: 0 }, radius: 1 }
  ).kind).toBe("degenerate")
})
```

- [x] **Step 3: Run circle tests and verify RED**

Run: `npm.cmd test -- --run packages/geometry-kernel/src/intersections.test.ts`  
Expected: FAIL because the two detailed circle functions do not exist.

- [x] **Step 4: Implement normalized line-circle classification**

Translate coordinates relative to the circle center and divide by `max(radius, directionLength)` before computing the quadratic. Classify a tolerance-sized discriminant as `tangent`; clamp only that value to zero. Sort two roots numerically before constructing the tuple.

Keep the wrapper exact:

```ts
export function intersectLineCircle(line: LinePrimitive, circle: CirclePrimitive): Coordinate[] {
  const result = intersectLineCircleDetailed(line, circle)
  if (result.kind === "point" || result.kind === "tangent") return [result.point]
  return result.kind === "points" ? result.points : []
}
```

- [x] **Step 5: Implement normalized circle-circle classification**

Validate finite centers and positive radii. Normalize all lengths by `max(first.radius, second.radius, centerDistance)`. Detect coincident circles before dividing by center distance. For two points, keep current deterministic order: positive perpendicular offset first, negative offset second.

Keep the wrapper exact:

```ts
export function intersectCircles(first: CirclePrimitive, second: CirclePrimitive): Coordinate[] {
  const result = intersectCirclesDetailed(first, second)
  if (result.kind === "point" || result.kind === "tangent") return [result.point]
  return result.kind === "points" ? result.points : []
}
```

- [x] **Step 6: Run all kernel tests**

Run: `npm.cmd test -- --run packages/geometry-kernel/src`  
Expected: numeric, intersection, expression, and constraint tests PASS.

Run: `npm.cmd run typecheck --workspace @draw/geometry-kernel`  
Expected: exit code 0.

- [x] **Step 7: Commit detailed circle intersections**

```bash
git add packages/geometry-kernel/src/intersections.ts packages/geometry-kernel/src/intersections.test.ts
git commit -m "feat: classify robust circle intersections"
```

---

### Task 4: Scene Graph Detailed Result Integration

**Files:**
- Modify: `packages/scene-graph/src/operations.ts`
- Modify: `packages/scene-graph/src/scene-store.test.ts`

**Interfaces:**
- Consumes: `intersectLinesDetailed`, `intersectLineCircleDetailed`, and `intersectCirclesDetailed`.
- Produces: deterministic derived-object updates where valid empty results hide objects and degenerate results throw to the existing rollback boundary.

- [x] **Step 1: Add failing Scene Graph classification tests**

```ts
it("hides a valid parallel intersection without rejecting the transaction", () => {
  const document = createEmptyDocument("calculus")
  document.parameters.offset = { id: "offset", value: 1 }
  document.primitives = [
    { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
    { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 1 } },
    { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
  ]
  const result = applyOperation(document, { op: "setParameter", id: "offset", value: 2 })
  expect(result.changed).toBe(true)
  expect(result.document.primitives[2]).toMatchObject({ visible: false })
})

it("rolls back recomputation for a degenerate intersection source", () => {
  const document = createEmptyDocument("calculus")
  document.primitives = [
    { id: "line-a", type: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 } },
    { id: "line-b", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
    { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
  ]
  const result = applyOperation(document, { op: "toggleVisibility", id: "line-b", visible: false })
  expect(result.changed).toBe(false)
  expect(result.document).toBe(document)
  expect(result.error).toContain("degenerate line intersection")
})
```

- [x] **Step 2: Run Scene Graph tests and verify RED**

Run: `npm.cmd test -- --run packages/scene-graph/src/scene-store.test.ts`  
Expected: the degenerate rollback test FAILS because legacy wrappers collapse it to an empty result.

- [x] **Step 3: Replace the resolver return contract**

Change `resolveIntersection` to return `IntersectionResult`. In `recomputeDerivedObjects`, map results as follows:

```ts
if (result.kind === "degenerate") throw new Error(`degenerate intersection: ${result.reason}`)
if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
if (result.kind === "point" || result.kind === "tangent") return { ...primitive, ...result.point, visible: true }
const point = result.points[primitive.solutionIndex ?? 0]
return { ...primitive, ...point, visible: true }
```

Use the corresponding detailed function for each primitive type. Do not alter DSL fields.

- [x] **Step 4: Run Scene Graph and kernel regression tests**

Run: `npm.cmd test -- --run packages/geometry-kernel/src packages/scene-graph/src`  
Expected: all kernel and Scene Graph tests PASS.

Run: `npm.cmd run typecheck --workspace @draw/scene-graph`  
Expected: exit code 0.

- [x] **Step 5: Commit Scene Graph migration**

```bash
git add packages/scene-graph/src/operations.ts packages/scene-graph/src/scene-store.test.ts
git commit -m "feat: handle detailed intersection outcomes"
```

---

### Task 5: Verification, Performance Guard, and Progress Record

**Files:**
- Modify: `packages/scene-graph/src/scene-store.test.ts`
- Modify: `docs/project-progress.md`

**Interfaces:**
- Consumes: completed numeric robustness behavior from Tasks 1–4.
- Produces: regression evidence and an updated next-step marker pointing to constraint-graph performance optimization.

- [x] **Step 1: Extend the existing performance test with near-degenerate geometry**

Add two near-parallel source lines and one derived intersection to the existing 1000-primitive fixture while preserving a total of 1000 primitives. Assert the recomputation stays below the existing 100 ms threshold and the unrelated primitive retains object identity.

```ts
expect(document.primitives).toHaveLength(1000)
expect(recomputed.primitives.at(-1)).toBe(unrelated)
expect(elapsed).toBeLessThan(100)
```

- [x] **Step 2: Run the performance regression test**

Run: `npm.cmd test -- --run packages/scene-graph/src/scene-store.test.ts`  
Expected: all tests PASS and the performance assertion remains below 100 ms.

- [x] **Step 3: Run complete verification**

Run: `npm.cmd test`  
Expected: all test files PASS with zero failed tests.

Run: `npm.cmd run typecheck`  
Expected: all four workspaces exit with code 0.

Run: `npm.cmd run build`  
Expected: Vite Web build and all three core package builds exit with code 0.

Run: `npm.cmd run test:e2e`  
Expected: all Chromium tests PASS.

Run: `git diff --check`  
Expected: exit code 0 and no whitespace errors.

- [x] **Step 4: Update the progress record with actual evidence**

Add a completed entry for scale-aware numeric policy, explicit intersection outcomes, robust orientation, and Scene Graph degenerate rollback. Replace test counts only with numbers from Step 3. Set the next mathematical-kernel item to constraint-component incremental solving. Do not mark calculus or Agent work complete.

- [x] **Step 5: Verify scope isolation**

Run: `git diff --name-only HEAD~4`  
Expected: only `package-lock.json`, `packages/geometry-kernel/**`, `packages/scene-graph/**`, and `docs/project-progress.md`; no Agent or Provider paths.

- [ ] **Step 6: Commit verification and documentation**

```bash
git add packages/scene-graph/src/scene-store.test.ts docs/project-progress.md
git commit -m "test: verify robust geometry recomputation"
```

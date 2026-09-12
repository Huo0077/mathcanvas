# Math Kernel Numeric Robustness Design

**Date:** 2026-09-13  
**Status:** Approved for planning  
**Scope:** `packages/geometry-kernel` and the Scene Graph integration that consumes geometry results

## Goal

Make geometric predicates and intersections deterministic across near-degenerate, very large, and very small coordinate ranges without changing the Geometry DSL or touching Agent, Provider, routing, or image-parsing work.

## Current Problems

- Intersection algorithms use unrelated hard-coded thresholds such as `1e-9` and `1e-12`.
- `null` and empty arrays collapse distinct outcomes including parallel, coincident, disjoint, tangent, and degenerate inputs.
- Absolute thresholds change behavior when the same geometry is scaled.
- Scene Graph recomputation cannot distinguish a valid empty result from invalid geometry.
- The existing public functions are already consumed by Scene Graph code and tests, so replacing them directly would create unnecessary migration risk.

## Reference Projects

- JSXGraph separates geometric algorithms from broader numerical utilities and keeps rendering outside the mathematical source of truth.
- Flatten.js centralizes floating-point comparisons, but its mutable global tolerance and object model will not be copied.
- `robust-predicates` uses adaptive precision for orientation tests and is suitable as a focused dependency.
- function-plot separates invalid numeric samples and discontinuities from valid point sequences; this principle will be used later for calculus work, not implemented in this slice.

No external source code will be copied. Only compatible public packages and architectural ideas may be used.

## Architecture

### Numeric Policy

Add `packages/geometry-kernel/src/numeric.ts` with an immutable policy:

```ts
export interface NumericPolicy {
  absoluteTolerance: number
  relativeTolerance: number
}

export const defaultNumericPolicy: Readonly<NumericPolicy>

export function scaledTolerance(
  values: readonly number[],
  policy?: NumericPolicy
): number

export function nearlyZero(
  value: number,
  scaleValues: readonly number[],
  policy?: NumericPolicy
): boolean

export function nearlyEqual(
  first: number,
  second: number,
  policy?: NumericPolicy
): boolean
```

The default policy is passed explicitly or selected locally. It must not be mutable global state. All calculations must reject non-finite inputs before applying tolerance logic.

### Detailed Intersection Results

Add discriminated result types in `packages/geometry-kernel/src/types.ts`:

```ts
export type IntersectionResult =
  | { kind: "none"; reason: "disjoint" | "parallel" }
  | { kind: "point"; point: Coordinate }
  | { kind: "tangent"; point: Coordinate }
  | { kind: "points"; points: [Coordinate, Coordinate] }
  | { kind: "coincident" }
  | { kind: "degenerate"; reason: string }
```

Implement detailed functions:

```ts
intersectLinesDetailed(first, second, policy?): IntersectionResult
intersectLineCircleDetailed(line, circle, policy?): IntersectionResult
intersectCirclesDetailed(first, second, policy?): IntersectionResult
```

Existing `intersectLines`, `intersectLineCircle`, and `intersectCircles` remain as compatibility wrappers during this phase. They preserve current return types while delegating to detailed functions.

### Robust Predicates

Use the `robust-predicates` package only for orientation and collinearity decisions where ordinary determinant arithmetic becomes unreliable. Do not introduce a second geometry object model or expose the dependency through DSL types.

Circle intersection classification remains local because orientation predicates do not solve discriminant stability. Circle calculations use normalized coordinates and scale-aware tolerances, and clamp small negative round-off values to zero only when within tolerance.

### Scene Graph Integration

`packages/scene-graph/src/operations.ts` consumes detailed results internally:

- `none` hides a derived intersection as a valid empty result.
- `point`, `tangent`, and `points` update coordinates and visibility.
- `coincident` hides the single-point derived object because it has infinitely many solutions.
- `degenerate` throws a deterministic error so `applyOperation` rolls back the transaction.

The Geometry Document schema and serialized `.mgeo` shape do not change in this slice.

## Numerical Rules

- Comparisons combine an absolute floor with a relative term based on operand magnitude.
- Direction degeneracy is measured against the direction vector scale, not a fixed world-coordinate epsilon.
- Line coincidence requires both robust collinearity and parallel direction.
- Tangency is a classified result, not inferred from array length by consumers.
- Returned points must be finite.
- Two-point results have deterministic ordering based on the parameter along the first input primitive.
- Scaling a fixture by `1e-9`, `1`, or `1e9` must preserve its result kind when mathematically equivalent.

## Error Handling

- Non-finite coordinates or radii produce `degenerate`.
- Zero or near-zero direction lines produce `degenerate` in detailed APIs.
- Non-positive circle radii produce `degenerate`.
- Compatibility wrappers map `degenerate` to their historical empty result, while Scene Graph uses detailed results and rolls back.
- Error messages identify the invalid primitive category without exposing internal numeric implementation details.

## Testing

Unit tests will cover:

- Ordinary line-line, line-circle, and circle-circle intersections.
- Parallel versus coincident lines.
- Near-parallel lines at multiple coordinate scales.
- Exact and near tangency.
- Coincident circles and contained disjoint circles.
- Degenerate lines, invalid radii, and non-finite inputs.
- Deterministic ordering of two-point results.
- Compatibility wrapper behavior.

Scene Graph tests will cover:

- Valid empty intersections hide the derived primitive.
- Tangent and two-point results select the requested solution deterministically.
- Degenerate inputs roll back without incrementing revision.

Performance tests will verify that the robust path does not materially regress the existing 1000-primitive recomputation check. No strict microbenchmark is added because CI timing is noisy.

## Migration Sequence

1. Add numeric policy utilities and tests.
2. Add detailed line-line results and compatibility wrapper tests.
3. Add detailed line-circle and circle-circle results.
4. Integrate `robust-predicates` for orientation decisions.
5. Migrate Scene Graph to detailed results and rollback behavior.
6. Run unit tests, type checking, build, and the existing browser tests.
7. Update `docs/project-progress.md` with measured verification evidence.

## Non-Goals

- No Agent, Provider Router, model configuration, prompt, or image parsing changes.
- No ellipse, parabola, hyperbola, derivative, or function plotting implementation.
- No DSL schema-version change.
- No wholesale adoption of JSXGraph or Flatten.js.
- No arbitrary-precision arithmetic for all calculations.
- No constraint-solver performance optimization; that is the next independent phase.

## Success Criteria

- All intersection categories are explicit in detailed APIs.
- Equivalent scaled fixtures produce the same classification.
- Scene Graph rolls back degenerate recomputation and preserves valid empty results.
- Existing public intersection functions remain source-compatible.
- Existing tests, type checking, build, and browser tests pass.
- No files associated with Agent or Provider work are modified.

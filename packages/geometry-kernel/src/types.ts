import type { ArcPrimitive, CirclePrimitive, Coordinate, LinePrimitive } from "@draw/dsl"

export type { ArcPrimitive, CirclePrimitive, Coordinate, LinePrimitive }

export type IntersectionResult =
  | { kind: "none"; reason: string }
  | { kind: "point"; point: Coordinate }
  | { kind: "tangent"; point: Coordinate }
  /** Curves that are not a line or a circle can cross more than twice, so this is an open list, not a pair. */
  | { kind: "points"; points: Coordinate[] }
  | { kind: "coincident" }
  | { kind: "degenerate"; reason: string }

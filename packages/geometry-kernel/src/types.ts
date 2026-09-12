import type { ArcPrimitive, CirclePrimitive, Coordinate, LinePrimitive } from "@draw/dsl"

export type { ArcPrimitive, CirclePrimitive, Coordinate, LinePrimitive }

export type IntersectionResult =
  | { kind: "none"; reason: string }
  | { kind: "point"; point: Coordinate }
  | { kind: "tangent"; point: Coordinate }
  | { kind: "points"; points: [Coordinate, Coordinate] }
  | { kind: "coincident" }
  | { kind: "degenerate"; reason: string }

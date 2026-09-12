export type Workspace = "calculus" | "conics" | "cad" | "geometry3d"

export interface Coordinate {
  x: number
  y: number
}

export interface ParameterSpec {
  id: string
  value: number
  expression?: string
  min?: number
  max?: number
  step?: number
  label?: string
}

export interface PointPrimitive {
  id: string
  type: "point"
  x: number
  y: number
  label?: string
  visible?: boolean
  locked?: boolean
}

export interface LinePrimitive {
  id: string
  type: "line"
  a: Coordinate
  b: Coordinate
  slopeParameter?: string
  label?: string
  visible?: boolean
  locked?: boolean
}

export interface SegmentPrimitive {
  id: string
  type: "segment"
  a: Coordinate
  b: Coordinate
  label?: string
  visible?: boolean
  locked?: boolean
}

export interface CirclePrimitive {
  id: string
  type: "circle"
  center: Coordinate
  radius: number
  label?: string
  visible?: boolean
  locked?: boolean
}

export interface ArcPrimitive {
  id: string
  type: "arc"
  center: Coordinate
  radius: number
  startAngle: number
  endAngle: number
  label?: string
  visible?: boolean
  locked?: boolean
}

export interface IntersectionPrimitive {
  id: string
  type: "intersection"
  lineA: string
  lineB: string
  x: number
  y: number
  label?: string
  visible?: boolean
  locked?: boolean
}

export interface LineCircleIntersectionPrimitive {
  id: string
  type: "lineCircleIntersection"
  lineId: string
  circleId: string
  solutionIndex?: 0 | 1
  x: number
  y: number
  label?: string
  visible?: boolean
  locked?: boolean
}

export interface CircleCircleIntersectionPrimitive {
  id: string
  type: "circleIntersection"
  circleA: string
  circleB: string
  solutionIndex?: 0 | 1
  x: number
  y: number
  label?: string
  visible?: boolean
  locked?: boolean
}

export type PrimitiveSpec =
  | PointPrimitive
  | LinePrimitive
  | SegmentPrimitive
  | CirclePrimitive
  | ArcPrimitive
  | IntersectionPrimitive
  | LineCircleIntersectionPrimitive
  | CircleCircleIntersectionPrimitive

export interface ConstraintSpec {
  id: string
  type: "parallel" | "perpendicular" | "coincident"
  targets: string[]
}

export interface DynamicSpec {
  id: string
  type: "slider" | "locus"
  target: string
  parameter?: string
}

export interface AnnotationSpec {
  id: string
  text: string
  target?: string
  x?: number
  y?: number
}

export interface DocumentMetadata {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface GeometryDocument {
  schemaVersion: "0.1"
  revision: number
  workspace: Workspace
  coordinateSystems: string[]
  parameters: Record<string, ParameterSpec>
  primitives: PrimitiveSpec[]
  constraints: ConstraintSpec[]
  dynamics: DynamicSpec[]
  annotations: AnnotationSpec[]
  metadata: DocumentMetadata
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] }

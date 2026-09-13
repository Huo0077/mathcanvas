export type Workspace = "calculus" | "conics" | "cad" | "geometry3d"

export interface Coordinate {
  x: number
  y: number
}

export interface PrimitiveStyle {
  stroke?: string
  fill?: string
  strokeWidth?: number
  opacity?: number
  dash?: string
}

export interface PrimitivePresentation {
  label?: string
  visible?: boolean
  locked?: boolean
  style?: PrimitiveStyle
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

export interface PointPrimitive extends PrimitivePresentation {
  id: string
  type: "point"
  x: number
  y: number
}

export interface LinePrimitive extends PrimitivePresentation {
  id: string
  type: "line"
  a: Coordinate
  b: Coordinate
  slopeParameter?: string
}

export interface SegmentPrimitive extends PrimitivePresentation {
  id: string
  type: "segment"
  a: Coordinate
  b: Coordinate
}

export interface RayPrimitive extends PrimitivePresentation {
  id: string
  type: "ray"
  a: Coordinate
  b: Coordinate
}

export interface PolylinePrimitive extends PrimitivePresentation {
  id: string
  type: "polyline"
  points: Coordinate[]
}

export interface ParabolaPrimitive extends PrimitivePresentation {
  id: string
  type: "parabola"
  vertex: Coordinate
  focalParameter: number
  axis: "x" | "y"
  rotation?: number
}

export interface EllipsePrimitive extends PrimitivePresentation {
  id: string
  type: "ellipse"
  center: Coordinate
  radiusX: number
  radiusY: number
  rotation?: number
}

export interface HyperbolaPrimitive extends PrimitivePresentation {
  id: string
  type: "hyperbola"
  center: Coordinate
  radiusX: number
  radiusY: number
  axis: "x" | "y"
  rotation?: number
}

export interface FunctionPrimitive extends PrimitivePresentation {
  id: string
  type: "function"
  expression: string
  domain: [number, number]
  samples?: number
}

export interface CirclePrimitive extends PrimitivePresentation {
  id: string
  type: "circle"
  center: Coordinate
  radius: number
}

export interface ArcPrimitive extends PrimitivePresentation {
  id: string
  type: "arc"
  center: Coordinate
  radius: number
  startAngle: number
  endAngle: number
}

export interface IntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "intersection"
  lineA: string
  lineB: string
  x: number
  y: number
}

export interface LineCircleIntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "lineCircleIntersection"
  lineId: string
  circleId: string
  solutionIndex?: 0 | 1
  x: number
  y: number
}

export interface CircleCircleIntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "circleIntersection"
  circleA: string
  circleB: string
  solutionIndex?: 0 | 1
  x: number
  y: number
}

export interface CurveIntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "curveIntersection"
  objectA: string
  objectB: string
  solutionIndex?: 0 | 1
  x: number
  y: number
}

export type PrimitiveSpec =
  | PointPrimitive
  | LinePrimitive
  | SegmentPrimitive
  | RayPrimitive
  | PolylinePrimitive
  | ParabolaPrimitive
  | EllipsePrimitive
  | HyperbolaPrimitive
  | FunctionPrimitive
  | CirclePrimitive
  | ArcPrimitive
  | IntersectionPrimitive
  | LineCircleIntersectionPrimitive
  | CircleCircleIntersectionPrimitive
  | CurveIntersectionPrimitive

export interface ConstraintSpec {
  id: string
  type: "parallel" | "perpendicular" | "coincident"
  targets: string[]
}

export interface GroupSpec {
  id: string
  label?: string
  members: string[]
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
  groups: GroupSpec[]
  constraints: ConstraintSpec[]
  dynamics: DynamicSpec[]
  annotations: AnnotationSpec[]
  metadata: DocumentMetadata
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] }

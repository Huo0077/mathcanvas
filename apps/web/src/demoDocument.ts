import type { GeometryDocument, LinePrimitive } from "@draw/dsl"
import { createEmptyDocument } from "@draw/dsl"
import { applyOperation, recomputeDerivedObjects } from "@draw/scene-graph"

export function createDemoDocument(): GeometryDocument {
  let document = createEmptyDocument("calculus")
  const lines: LinePrimitive[] = [
    { id: "line-axis", type: "line", a: { x: -8, y: 0 }, b: { x: 8, y: 0 }, label: "y = 0" },
    { id: "line-slope", type: "line", a: { x: -8, y: -4 }, b: { x: 8, y: 4 }, slopeParameter: "slope", label: "参数直线" }
  ]
  document = applyOperation(document, { op: "addPrimitive", primitive: lines[0] }).document
  document = applyOperation(document, { op: "addPrimitive", primitive: lines[1] }).document
  document = applyOperation(document, { op: "setParameter", id: "slope", value: 0.5 }).document
  document.primitives.push({ id: "intersection-main", type: "intersection", lineA: lines[0].id, lineB: lines[1].id, x: 0, y: 0, label: "交点 P" })
  document.parameters.slope = { id: "slope", value: 0.5, min: 0.15, max: 0.85, step: 0.05, label: "直线斜率" }
  return recomputeDerivedObjects(document)
}

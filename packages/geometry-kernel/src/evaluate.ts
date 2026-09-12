import type { GeometryDocument, LinePrimitive } from "@draw/dsl"

export function evaluateLineParameters(document: GeometryDocument, line: LinePrimitive): LinePrimitive {
  if (!line.slopeParameter) return line
  const parameter = document.parameters[line.slopeParameter]
  if (!parameter) return line
  return { ...line, b: { ...line.b, y: line.a.y + parameter.value * (line.b.x - line.a.x) } }
}

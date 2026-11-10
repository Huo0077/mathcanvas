import type { GeometryDocument } from "@draw/dsl"
import type { DraftAction } from "@draw/scene-graph"
import { parseShapeClause } from "../solver/shapeGrammar"
import { normalizeGeometryPrompt } from "../latexNormalisation"
import { parseDiagramObligations } from "../diagramObligations"
import type { StructuralDrawingCheck } from "./drawingCertificate"

/** Independent metric/topology check for the one named-free cube template family. */
export function verifyCubeDrawingStructure(prompt: string, candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck | null {
  const phrase = /正方体|立方体/u.exec(prompt)?.[0]
  if (!phrase) return null
  const before = new Set(base.primitives.map(item => item.id))
  const solids = candidate.primitives.filter((item): item is Extract<GeometryDocument["primitives"][number], { type: "polyhedron3" }> => item.type === "polyhedron3" && !before.has(item.id))
  if (solids.length !== 1) return null
  const solid = solids[0]!
  if (solid.construction?.kind !== "template" || solid.construction.templateId !== "cube"
    || solid.vertexIds.length !== 8 || solid.edgeIds.length !== 12 || solid.faceIds.length !== 6) return null
  const ids = [...solid.vertexIds, ...solid.edgeIds, ...solid.faceIds]
  const created = candidate.primitives.filter(item => !before.has(item.id))
  // A cube-only request must not quietly add unrelated geometry alongside its topology.
  if (created.length !== ids.length + 2 || created.filter(item => item.type === "cube").length !== 1
    || created.some(item => item.id !== solid.id && item.type !== "cube" && !ids.includes(item.id))) return null
  if (new Set(ids).size !== ids.length) return null
  const primitives = new Map(candidate.primitives.map(item => [item.id, item]))
  const vectors = new Map<string, { x: number; y: number; z: number }>()
  for (const id of solid.vertexIds) {
    const point = primitives.get(id)
    if (point?.type !== "point3") return null
    vectors.set(id, point.position)
  }
  const values = [...vectors.values()]
  if (values.some(v => ![v.x, v.y, v.z].every(Number.isFinite))) return null
  const diff = (a: typeof values[number], b: typeof values[number]) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const dot = (a: typeof values[number], b: typeof values[number]) => a.x * b.x + a.y * b.y + a.z * b.z
  const cross = (a: typeof values[number], b: typeof values[number]) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  const adjacency = new Map(solid.vertexIds.map(id => [id, [] as string[]]))
  const keys = new Set<string>()
  let sideSquared: number | null = null
  for (const edgeId of solid.edgeIds) {
    const edge = primitives.get(edgeId)
    if (edge?.type !== "edge3") return null
    const [a, b] = edge.pointIds
    if (!a || !b || a === b || !vectors.has(a) || !vectors.has(b)) return null
    const key = [a, b].sort().join("|")
    if (keys.has(key)) return null
    keys.add(key)
    adjacency.get(a)!.push(b)
    adjacency.get(b)!.push(a)
    const lengthSquared = dot(diff(vectors.get(a)!, vectors.get(b)!), diff(vectors.get(a)!, vectors.get(b)!))
    if (sideSquared === null) sideSquared = lengthSquared
    if (!(sideSquared > 1e-12) || Math.abs(lengthSquared - sideSquared) > sideSquared * 1e-8) return null
  }
  const tolerance = (sideSquared ?? 0) * 1e-8
  for (const [id, neighbours] of adjacency) {
    if (neighbours.length !== 3) return null
    const vectorsAt = neighbours.map(other => diff(vectors.get(other)!, vectors.get(id)!))
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      if (Math.abs(dot(vectorsAt[i]!, vectorsAt[j]!)) > tolerance) return null
    }
  }
  const faceUse = new Map([...keys].map(key => [key, 0]))
  for (const faceId of solid.faceIds) {
    const face = primitives.get(faceId)
    if (face?.type !== "face3" || face.pointIds.length !== 4 || new Set(face.pointIds).size !== 4
      || face.pointIds.some(id => !vectors.has(id))) return null
    for (let i = 0; i < 4; i++) {
      const key = [face.pointIds[i]!, face.pointIds[(i + 1) % 4]!].sort().join("|")
      if (!faceUse.has(key)) return null
      faceUse.set(key, faceUse.get(key)! + 1)
    }
    const [a, b, c, d] = face.pointIds.map(id => vectors.get(id)!)
    const normal = cross(diff(b!, a!), diff(c!, a!))
    if (dot(normal, normal) < tolerance * tolerance || Math.abs(dot(normal, diff(d!, a!))) > tolerance * Math.sqrt(sideSquared!)) return null
  }
  if ([...faceUse.values()].some(count => count !== 2)) return null
  return { sourceText: phrase, status: "passed", entityIds: [solid.id] }
}
/** Checks original named rings against the materialised topology, not the model's coordinates alone. */
export function verifyNamedSolidDrawingStructure(prompt: string, actions: readonly DraftAction[], candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck[] {
  const shape = parseShapeClause(prompt)
  if (!shape || (shape.family !== "pyramid" && shape.family !== "prism")) return []
  if (!prompt.includes(shape.phrase)) return []
  const sourceIds = new Set(base.primitives.map(item => item.id))
  const solids = candidate.primitives.filter((item): item is Extract<GeometryDocument["primitives"][number], { type: "polyhedron3" }> => item.type === "polyhedron3" && !sourceIds.has(item.id))
  const declared = actions.filter(item => item.actionId === "solid.create_polyhedron" && Array.isArray((item.inputs as { faces?: unknown }).faces)
    && ((item.inputs as { faces: unknown[] }).faces.length >= 4))
  if (solids.length !== 1 || declared.length !== 1) return []
  const solid = solids[0]!
  const inputs = declared[0]!.inputs as unknown as { vertexNames?: string[] }
  const names = inputs.vertexNames
  const expected = shape.family === "prism" ? shape.base.length * 2 : shape.base.length + 1
  if (!names || names.length !== expected || solid.vertexIds.length !== expected
    || solid.faceIds.length !== (shape.family === "prism" ? shape.base.length + 2 : shape.base.length + 1)
    || solid.edgeIds.length !== (shape.family === "prism" ? shape.base.length * 3 : shape.base.length * 2)
    || new Set(names).size !== names.length || new Set(solid.vertexIds).size !== expected) return []
  const required = [...shape.base, ...(shape.top ?? []), ...(shape.apex ? [shape.apex] : [])]
  if (required.length !== expected || required.some(name => !names.includes(name))) return []
  const byId = new Map(candidate.primitives.map(item => [item.id, item]))
  const vertices = new Map<string, { id: string; position: { x: number; y: number; z: number } }>()
  for (const [index, name] of names.entries()) {
    const id = solid.vertexIds[index]!
    const point = byId.get(id)
    if (point?.type !== "point3" || (point.label !== undefined && point.label !== name)
      || ![point.position.x, point.position.y, point.position.z].every(Number.isFinite)) return []
    vertices.set(name, { id, position: point.position })
  }
  const pos = (name: string) => vertices.get(name)!.position
  const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z
  const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  const [a, b, c] = shape.base
  const normal = cross(sub(pos(b!), pos(a!)), sub(pos(c!), pos(a!)))
  const norm2 = dot(normal, normal)
  if (norm2 < 1e-12) return []
  const tolerance = Math.sqrt(norm2) * 1e-7
  if (shape.base.some(name => Math.abs(dot(normal, sub(pos(name), pos(a!)))) > tolerance)) return []
  const faces = solid.faceIds.map(id => byId.get(id))
  if (faces.some(face => face?.type !== "face3")) return []
  const hasFace = (ring: readonly string[]) => faces.some(face => face?.type === "face3" && face.pointIds.length === ring.length
    && ring.every(name => face.pointIds.includes(vertices.get(name)!.id)))
  if (!hasFace(shape.base)) return []
  if (shape.family === "pyramid") {
    const apex = shape.apex!
    if (Math.abs(dot(normal, sub(pos(apex), pos(a!)))) <= tolerance) return []
    for (let i = 0; i < shape.base.length; i++) {
      if (!hasFace([shape.base[i]!, shape.base[(i + 1) % shape.base.length]!, apex])) return []
    }
  } else {
    const top = shape.top!
    if (!hasFace(top)) return []
    const shift = sub(pos(top[0]!), pos(shape.base[0]!))
    if (Math.abs(dot(normal, shift)) <= tolerance) return []
    if (shape.base.some((name, i) => {
      const d = sub(pos(top[i]!), pos(name))
      const error = sub(d, shift)
      return dot(error, error) > 1e-12
    })) return []
    for (let i = 0; i < shape.base.length; i++) {
      if (!hasFace([shape.base[i]!, shape.base[(i + 1) % shape.base.length]!, top[(i + 1) % top.length]!, top[i]!])) return []
    }
    const straight = dot(cross(shift, normal), cross(shift, normal)) <= norm2 * dot(shift, shift) * 1e-10
    if (shape.modifier === "直" && !straight || shape.modifier === "斜" && straight) return []
    if (shape.modifier === "正") {
      if (!straight) return []
      const sides = shape.base.map((name, i) => {
        const edge = sub(pos(shape.base[(i + 1) % shape.base.length]!), pos(name))
        return dot(edge, edge)
      })
      if (sides.some(value => Math.abs(value - sides[0]!) > sides[0]! * 1e-8)) return []
      if (shape.base.length > 3) return [] // Equal sides alone do not establish a regular polygon.
    }
  }
  const checks: StructuralDrawingCheck[] = [{ sourceText: shape.phrase, status: "passed", entityIds: [solid.id] }]
  const rightTrapezoid = new RegExp(`(?:底面)?${shape.base.join("")}(?:为|是)直角梯形`, "u").exec(prompt)
  if (rightTrapezoid) {
    if (shape.base.length !== 4) return []
    const [A, B, C, D] = shape.base.map(pos)
    const AB = sub(B!, A!), CD = sub(D!, C!), AD = sub(D!, A!), BC = sub(C!, B!)
    if (dot(cross(AB, CD), cross(AB, CD)) > dot(AB, AB) * dot(CD, CD) * 1e-10
      || Math.abs(dot(AB, AD)) > Math.sqrt(dot(AB, AB) * dot(AD, AD)) * 1e-8
      || dot(cross(AD, BC), cross(AD, BC)) <= dot(AD, AD) * dot(BC, BC) * 1e-10) return []
    checks.push({ sourceText: rightTrapezoid[0], status: "passed", entityIds: [solid.id] })
  }
  return checks
}
/** Text-bound right-trapezoid fold check; unsupported phrasings remain unverified. */
export function verifyFoldedTrapezoidStructure(prompt: string, actions: readonly DraftAction[], candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck[] {
  const shape = /在直角梯形([A-Z]{4})中/u.exec(prompt)
  const fold = /将△([A-Z]{3})沿([A-Z]{2})折起成△([A-Z]{3})/u.exec(prompt)
  const rotation = /固定([A-Z])、([A-Z])，将点([A-Z])绕直线([A-Z]{2})旋转([0-9.]+)°得到点([A-Z])/u.exec(prompt)
  if (!shape || (!fold && !rotation)) return []
  const [A, B, C, D] = shape[1]!.split("")
  const hinge = fold?.[2] ?? rotation?.[4]
  const moving = fold ? fold[1]!.split("").find(name => !hinge!.includes(name)) : rotation?.[3]
  const dest = fold ? fold[3]!.split("").find(name => !hinge!.includes(name)) : rotation?.[6]
  if (!A || !B || !C || !D || hinge !== A + C || moving !== D || !dest || [A, B, C, D].includes(dest)
    || rotation && (rotation[1] !== A || rotation[2] !== C || Number(rotation[5]) !== 90)) return []
  const newItems = candidate.primitives.filter(item => !new Set(base.primitives.map(p => p.id)).has(item.id))
  const labelled = new Map<string, { x: number; y: number; z: number }>()
  for (const item of newItems) if (item.type === "point3" && item.label && [A, B, C, D, dest].includes(item.label)) {
    if (labelled.has(item.label) || ![item.position.x, item.position.y, item.position.z].every(Number.isFinite)) return []
    labelled.set(item.label, item.position)
  }
  if ([A, B, C, D, dest].some(name => !labelled.has(name))) return []
  const pos = (name: string) => labelled.get(name)!
  const sub = (u: typeof pos extends (...a: never[]) => infer R ? R : never, v: typeof pos extends (...a: never[]) => infer R ? R : never) => ({ x: u.x - v.x, y: u.y - v.y, z: u.z - v.z })
  const dot = (u: ReturnType<typeof sub>, v: ReturnType<typeof sub>) => u.x * v.x + u.y * v.y + u.z * v.z
  const cross = (u: ReturnType<typeof sub>, v: ReturnType<typeof sub>) => ({ x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x })
  const ab = sub(pos(B), pos(A)), cd = sub(pos(D), pos(C)), ad = sub(pos(D), pos(A)), bc = sub(pos(C), pos(B))
  const normal = cross(ab, sub(pos(C), pos(A)))
  const norm2 = dot(normal, normal)
  if (norm2 <= 1e-12 || Math.abs(dot(normal, ad)) > Math.sqrt(norm2) * 1e-7
    || dot(cross(ab, cd), cross(ab, cd)) > dot(ab, ab) * dot(cd, cd) * 1e-10
    || Math.abs(dot(ab, ad)) > Math.sqrt(dot(ab, ab) * dot(ad, ad)) * 1e-8
    || dot(cross(ad, bc), cross(ad, bc)) <= dot(ad, ad) * dot(bc, bc) * 1e-10) return []
  const fixed = actions.filter(item => item.actionId === "solid.create_face")
  const folded = actions.filter(item => item.actionId === "solid.fold")
  if (fixed.length !== 1 || folded.length !== 1) return []
  const input = folded[0]!.inputs as unknown as { hinge?: { from: string; to: string }; apex?: string; apexAs?: string; vertexNames?: string[] }
  if (input.hinge?.from !== A || input.hinge.to !== C || input.apex !== D || input.apexAs !== dest
    || input.vertexNames?.length !== 3 || [A, C, D].some(name => !input.vertexNames!.includes(name))) return []
  const faces = newItems.filter((item): item is Extract<GeometryDocument["primitives"][number], { type: "face3" }> => item.type === "face3")
  if (faces.length !== 2) return []
  const byId = new Map(candidate.primitives.map(item => [item.id, item]))
  const includesPositions = (face: typeof faces[number], names: string[]) => face.pointIds.length === 3 && names.every(name => face.pointIds.some(id => {
    const point = byId.get(id)
    if (point?.type !== "point3") return false
    const delta = sub(point.position, pos(name))
    return dot(delta, delta) < 1e-10
  }))
  const fixedFace = faces.find(item => includesPositions(item, [A, B, C]))
  const foldedFace = faces.find(item => includesPositions(item, [A, C, dest]))
  if (!fixedFace || !foldedFace || fixedFace.id === foldedFace.id) return []
  const p = pos(dest)
  const d2 = (x: string, y: string) => { const v = sub(pos(x), pos(y)); return dot(v, v) }
  if (Math.abs(d2(dest, A) - d2(D, A)) > 1e-8 || Math.abs(d2(dest, C) - d2(D, C)) > 1e-8
    || Math.abs(dot(normal, sub(p, pos(A)))) <= Math.sqrt(norm2) * 1e-8) return []
  const foldedNormal = cross(sub(pos(C), pos(A)), sub(p, pos(A)))
  if (Math.abs(dot(normal, foldedNormal)) > Math.sqrt(norm2 * dot(foldedNormal, foldedNormal)) * 1e-8) return []
  const checks: StructuralDrawingCheck[] = [
    { sourceText: shape[0], status: "passed", entityIds: [fixedFace.id, foldedFace.id] },
    { sourceText: fold?.[0] ?? rotation![0], status: "passed", entityIds: [foldedFace.id] }
  ]
  if (rotation) {
    const reference = /CD指折前线段/u.exec(prompt)
    const segment = newItems.find(item => (item.type === "segment3" || item.type === "edge3") && item.label?.includes("CD(折前)"))
    if (!reference || !segment || (segment.type !== "segment3" && segment.type !== "edge3")) return []
    const endpoints = segment.pointIds.map(id => byId.get(id)).filter(item => item?.type === "point3")
    if (endpoints.length !== 2 || !endpoints.some(item => item?.label === C) || !endpoints.some(item => item?.label === D)) return []
    checks.push({ sourceText: reference[0], status: "passed", entityIds: [segment.id] })
  }
  return checks
}
/** Numeric point command: text, identity and the actual staged coordinates must all agree. */
export function verifyPointDrawingStructure(prompt: string, candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck | null {
  const match = /(?:画|作|绘制)\s*点\s*([A-Z])\s*\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,，]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\)/u.exec(prompt)
  if (!match) return null
  const x = Number(match[2]), y = Number(match[3])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const before = new Set(base.primitives.map(item => item.id))
  const points = candidate.primitives.filter(item => !before.has(item.id) && (item.type === "point" || item.type === "point3"))
  if (points.length !== 1) return null
  const point = points[0]!
  const position = point.type === "point3" ? point.position : point.type === "point" ? point : null
  if (!position || point.label !== match[1] || Math.abs(position.x - x) > 1e-9 || Math.abs(position.y - y) > 1e-9
    || point.type === "point3" && Math.abs(point.position.z) > 1e-9) return null
  return { sourceText: match[0], status: "passed", entityIds: [point.id] }
}
/** One new, finite analytic primitive of the original named family. Numerical givens are checked separately. */
export function verifyAnalyticDrawingStructure(prompt: string, candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck | null {
  const family = /椭圆|双曲线|抛物线|球体/u.exec(prompt)
  if (!family) return null
  const expectedType = ({ 椭圆: "ellipse", 双曲线: "hyperbola", 抛物线: "parabola", 球体: "sphere" } as const)[family[0] as "椭圆" | "双曲线" | "抛物线" | "球体"]
  const prior = new Set(base.primitives.map(item => item.id))
  const relevant = candidate.primitives.filter(item => !prior.has(item.id) && ["ellipse", "hyperbola", "parabola", "sphere"].includes(item.type))
  if (relevant.length !== 1 || relevant[0]?.type !== expectedType) return null
  const item = relevant[0]
  if (item.type === "ellipse" || item.type === "hyperbola") {
    if (![item.center.x, item.center.y, item.radiusX, item.radiusY].every(Number.isFinite) || item.radiusX <= 0 || item.radiusY <= 0) return null
  } else if (item.type === "parabola") {
    if (![item.vertex.x, item.vertex.y, item.focalParameter].every(Number.isFinite) || item.focalParameter <= 0) return null
  } else if (item.type === "sphere") {
    if (![item.center.x, item.center.y, item.center.z, item.radius].every(Number.isFinite) || item.radius <= 0) return null
  }
  return { sourceText: family[0], status: "passed", entityIds: [item.id] }
}
export function verifyRegularTetrahedronStructure(prompt: string, candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck[] {
  const phrase = /正四面体\s*([A-Z]{4})/u.exec(prompt)
  if (!phrase) return []
  const names = phrase[1]!.split("")
  if (new Set(names).size !== 4) return []
  const prior = new Set(base.primitives.map(item => item.id))
  const solids = candidate.primitives.filter((item): item is Extract<GeometryDocument["primitives"][number], { type: "polyhedron3" }> => item.type === "polyhedron3" && !prior.has(item.id))
  if (solids.length !== 1) return []
  const solid = solids[0]!
  if (solid.vertexIds.length !== 4 || solid.edgeIds.length !== 6 || solid.faceIds.length !== 4) return []
  const byId = new Map(candidate.primitives.map(item => [item.id, item]))
  const points = solid.vertexIds.map(id => byId.get(id))
  if (points.some(point => point?.type !== "point3")) return []
  const vertex = points.map(point => point as Extract<typeof point, { type: "point3" }> )
  if (new Set(vertex.map(point => point.label)).size !== 4 || vertex.some(point => !point.label || !names.includes(point.label) || ![point.position.x, point.position.y, point.position.z].every(Number.isFinite))) return []
  const vec = (a: number, b: number) => ({ x: vertex[a]!.position.x - vertex[b]!.position.x, y: vertex[a]!.position.y - vertex[b]!.position.y, z: vertex[a]!.position.z - vertex[b]!.position.z })
  const dot = (a: ReturnType<typeof vec>, b: ReturnType<typeof vec>) => a.x * b.x + a.y * b.y + a.z * b.z
  const cross = (a: ReturnType<typeof vec>, b: ReturnType<typeof vec>) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  const expected = new Set<string>()
  let side2 = 0
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    expected.add([solid.vertexIds[i], solid.vertexIds[j]].sort().join("|"))
    const length2 = dot(vec(i, j), vec(i, j))
    if (side2 === 0) side2 = length2
    if (!Number.isFinite(length2) || length2 <= 1e-12 || Math.abs(length2 - side2) > side2 * 1e-8) return []
  }
  const volume6 = dot(cross(vec(1, 0), vec(2, 0)), vec(3, 0))
  if (Math.abs(volume6) <= side2 * Math.sqrt(side2) * 1e-8) return []
  const observedEdges = new Set<string>()
  for (const id of solid.edgeIds) {
    const edge = byId.get(id)
    if (edge?.type !== "edge3") return []
    const key = [...edge.pointIds].sort().join("|")
    if (!expected.has(key) || observedEdges.has(key)) return []
    observedEdges.add(key)
  }
  if (observedEdges.size !== 6) return []
  const observedFaces = new Set<string>()
  for (const id of solid.faceIds) {
    const face = byId.get(id)
    if (face?.type !== "face3" || face.pointIds.length !== 3 || new Set(face.pointIds).size !== 3 || face.pointIds.some(vertexId => !solid.vertexIds.includes(vertexId))) return []
    const key = [...face.pointIds].sort().join("|")
    if (observedFaces.has(key)) return []
    observedFaces.add(key)
  }
  if (observedFaces.size !== 4) return []
  const checks: StructuralDrawingCheck[] = [{ sourceText: phrase[0], status: "passed", entityIds: [solid.id] }]
  const edgeLength = /\u68f1\u957f\u4e3a\s*(\d+(?:\.\d+)?)/u.exec(prompt)
  if (edgeLength) {
    const stated = Number(edgeLength[1])
    if (!Number.isFinite(stated) || stated <= 0 || Math.abs(side2 - stated * stated) > stated * stated * 1e-8) return []
    checks.push({ sourceText: edgeLength[0], status: "passed", entityIds: [solid.id] })
  }
  return checks
}
/** Only the literal function expression and one staged graph are certified; monotonicity is a separate answer claim. */
export function verifyFunctionDrawingStructure(prompt: string, candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck | null {
  const original = /\$f\(x\)\s*=\s*[^$\n]+\$|f\(x\)\s*=\s*[^\s，。；\n]+/u.exec(prompt)?.[0]
  if (!original) return null
  const normalized = normalizeGeometryPrompt(prompt)
  const graph = parseDiagramObligations(normalized).givens.filter(item => item.kind === "functionGraph" && item.expression)
  if (graph.length !== 1 || !graph[0]?.expression) return null
  const before = new Set(base.primitives.map(item => item.id))
  const functions = candidate.primitives.filter((item): item is Extract<GeometryDocument["primitives"][number], { type: "function" }> => item.type === "function" && !before.has(item.id))
  if (functions.length !== 1) return null
  const drawn = functions[0]!
  if (drawn.expression.replace(/\s+/gu, "") !== graph[0].expression.replace(/\s+/gu, "") || !Number.isFinite(drawn.domain[0])
    || !Number.isFinite(drawn.domain[1]) || drawn.domain[0] >= drawn.domain[1]) return null
  return { sourceText: original, status: "passed", entityIds: [drawn.id] }
}
/** Validates the staged geometry of the specifically named AC fold without trusting the planner\u0027s angle. */
export function verifyRectangleFoldStructure(prompt: string, actions: readonly DraftAction[], candidate: GeometryDocument, base: GeometryDocument): StructuralDrawingCheck[] {
  const rectangle = /矩形\s*ABCD/u.exec(prompt)
  const clause = /沿对角线\s*AC\s*把\s*△ABC\s*折起/u.exec(prompt)
  if (!rectangle || !clause) return []
  const folds = actions.filter(item => item.actionId === "solid.fold")
  const fixed = actions.filter(item => item.actionId === "solid.create_face")
  if (folds.length !== 1 || fixed.length !== 1) return []
  const foldedInputs = folds[0]!.inputs as unknown as { vertexNames?: string[]; vertices?: readonly { x: number; y: number; z: number }[]; hinge?: { from: string; to: string }; apex?: string; apexAs?: string }
  if (foldedInputs.hinge?.from !== "A" || foldedInputs.hinge.to !== "C" || foldedInputs.apex !== "B" || foldedInputs.apexAs !== "B′"
    || foldedInputs.vertexNames?.join("") !== "ABC" || foldedInputs.vertices?.length !== 3) return []
  const prior = new Set(base.primitives.map(item => item.id))
  const fresh = candidate.primitives.filter(item => !prior.has(item.id))
  const faces = fresh.filter((item): item is Extract<GeometryDocument["primitives"][number], { type: "face3" }> => item.type === "face3")
  if (faces.length !== 2) return []
  const byId = new Map(candidate.primitives.map(item => [item.id, item]))
  const named = new Map<string, { x: number; y: number; z: number }>()
  for (const item of fresh) if (item.type === "point3" && item.label && ["A", "C", "D", "B′"].includes(item.label)) {
    if (named.has(item.label) || ![item.position.x, item.position.y, item.position.z].every(Number.isFinite)) return []
    named.set(item.label, item.position)
  }
  if (["A", "C", "D", "B′"].some(name => !named.has(name))) return []
  const A = named.get("A")!, C = named.get("C")!, D = named.get("D")!, P = named.get("B′")!
  const sub = (a: typeof A, b: typeof A) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const dot = (a: typeof A, b: typeof A) => a.x * b.x + a.y * b.y + a.z * b.z
  const cross = (a: typeof A, b: typeof A) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  const B = { x: A.x + C.x - D.x, y: A.y + C.y - D.y, z: A.z + C.z - D.z }
  const [preA, preB, preC] = foldedInputs.vertices
  if (!preA || !preB || !preC || dot(sub(preA, A), sub(preA, A)) > 1e-10 || dot(sub(preC, C), sub(preC, C)) > 1e-10
    || dot(sub(preB, B), sub(preB, B)) > 1e-10) return []
  const normal = cross(sub(C, A), sub(D, A))
  const normal2 = dot(normal, normal)
  if (normal2 <= 1e-12 || dot(sub(P, A), sub(P, A)) <= 1e-12) return []
  const foldedNormal = cross(sub(C, A), sub(P, A))
  if (dot(foldedNormal, foldedNormal) <= 1e-12 || Math.abs(dot(normal, foldedNormal)) > Math.sqrt(normal2 * dot(foldedNormal, foldedNormal)) * 1e-8) return []
  const sameLength = (first: typeof A, second: typeof A, third: typeof A, fourth: typeof A) => Math.abs(dot(sub(first, second), sub(first, second)) - dot(sub(third, fourth), sub(third, fourth))) <= 1e-8
  if (!sameLength(P, A, B, A) || !sameLength(P, C, B, C)) return []
  const includesPositions = (face: typeof faces[number], points: readonly (typeof A)[]) => face.pointIds.length === 3 && points.every(position => face.pointIds.some(id => {
    const item = byId.get(id)
    return item?.type === "point3" && dot(sub(item.position, position), sub(item.position, position)) <= 1e-10
  }))
  const fixedFace = faces.find(item => includesPositions(item, [A, C, D]))
  const movingFace = faces.find(item => includesPositions(item, [A, C, P]))
  if (!fixedFace || !movingFace || fixedFace.id === movingFace.id) return []
  return [{ sourceText: clause[0], status: "passed", entityIds: [fixedFace.id, movingFace.id] }]
}
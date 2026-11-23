import { createEmptyDocument, type Coordinate, type GeometryDocument, type Vector3 } from "@draw/dsl"
import {
  DS_ACTION_CLOSED_SET,
  PLAN_SCHEMA_VERSION,
  canonicalContentHash,
  certifyDrawingAgainstContract,
  compilePlan,
  foldPointAboutHinge,
  isDsActionName,
  normalizeGeometryPrompt,
  resolveInfeasibleEllipseFallbackScope,
  solveConstraint2d,
  solveConstraint3d,
  type ConstraintSolve3dRequest,
  type DeterministicProblemRoute,
  type DsActionName,
  type NamedVertex3,
  type PlanEnvelope
} from "@draw/agent-core"
import { deriveAcceptance } from "./acceptance"
import {
  canonicalPointName,
  distanceVector3,
  evaluateFunctionWithDomain,
  evaluateSymbolicDerivative,
  faceHost3,
  fitOriginConicThroughPoints,
  host3FromPrimitive,
  intersectPlanarLineAndConicExact,
  isPointName,
  planeFromPoints,
  solveInsphere3,
  tangentLineToConicAt,
  type PlanarConic,
  type SolidBoundary
} from "@draw/geometry-kernel"
import { pathConstraint, projectOntoPath, solidTopology3, type DraftAction } from "@draw/scene-graph"
import { createSpeculativeCanvas } from "./speculativeCanvas"

function findHostPrimitiveInDoc(doc: GeometryDocument, act: DraftAction) {
  const inp = act.inputs as { alias?: unknown; label?: unknown } | undefined
  const targetLabel = typeof inp?.label === "string" && inp.label.trim().length > 0
    ? inp.label.trim()
    : typeof inp?.alias === "string" && inp.alias.trim().length > 0
      ? inp.alias.trim()
      : null
  if (!targetLabel) return undefined
  const expectedTypes = new Set<string>(
    act.actionId === "solid.create_segment" ? ["segment3"] :
    act.actionId === "solid.create_face" ? ["face3"] :
    act.actionId === "solid.create_polyhedron" || act.actionId === "solid.create_prism" || act.actionId === "solid.create_template" ? ["polyhedron3"] :
    act.actionId === "planar.create_line" ? ["line"] :
    act.actionId === "planar.create_segment" ? ["segment"] :
    act.actionId === "planar.create_ray" ? ["ray"] :
    act.actionId === "planar.create_circle" ? ["circle"] :
    act.actionId === "planar.create_conic" ? ["ellipse", "parabola", "hyperbola"] :
    act.actionId === "function.create_graph" ? ["function"] : []
  )
  return [...doc.primitives].reverse().find(
    (p) => (expectedTypes.size === 0 || expectedTypes.has(p.type)) && (p.label === targetLabel || p.id === targetLabel)
  )
}

function findSolidEdgeHostSub(
  doc: GeometryDocument,
  solidAct: DraftAction,
  fromLabel: string,
  toLabel: string,
  posFrom?: Vector3,
  posTo?: Vector3
): { hostSub: number; reversed: boolean } | null {
  if (solidAct.actionId !== "solid.create_polyhedron" && solidAct.actionId !== "solid.create_prism" && solidAct.actionId !== "solid.create_face") {
    return null
  }
  const solidPrim = findHostPrimitiveInDoc(doc, solidAct)
  if (!solidPrim) return null
  const ptMap = new Map<string, Extract<GeometryDocument["primitives"][number], { type: "point3" }>>()
  for (const p of doc.primitives) {
    if (p.type === "point3") ptMap.set(p.id, p)
  }
  const edgeMatches = (byCoord: boolean): { hostSub: number; reversed: boolean } | null => {
    for (const cand of doc.primitives) {
      if (cand.type !== "edge3" || !cand.id.startsWith(`${solidPrim.id}:e`) || cand.pointIds.length !== 2) continue
      const p0 = ptMap.get(cand.pointIds[0]!)
      const p1 = ptMap.get(cand.pointIds[1]!)
      if (!p0 || !p1) continue
      let dir: "fwd" | "rev" | null = null
      if (!byCoord) {
        if (p0.label === fromLabel && p1.label === toLabel) dir = "fwd"
        else if (p0.label === toLabel && p1.label === fromLabel) dir = "rev"
      } else if (posFrom && posTo) {
        if (distanceVector3(p0.position, posFrom) <= 1e-4 && distanceVector3(p1.position, posTo) <= 1e-4) dir = "fwd"
        else if (distanceVector3(p0.position, posTo) <= 1e-4 && distanceVector3(p1.position, posFrom) <= 1e-4) dir = "rev"
      }
      if (!dir) continue
      const ePos = cand.id.lastIndexOf(":e")
      const hostSub = ePos >= 0 ? Number(cand.id.slice(ePos + 2)) : NaN
      if (Number.isInteger(hostSub) && hostSub >= 0) {
        return { hostSub, reversed: dir === "rev" }
      }
    }
    return null
  }
  return edgeMatches(false) ?? edgeMatches(true)
}

interface MatchedDocFace {
  faceId: string
  faceAlias: string
  faceSub?: number
  faceVerts: Vector3[]
  hostFace: NonNullable<ReturnType<typeof faceHost3>>
}

function findMatchingFaceInDoc(
  doc: GeometryDocument,
  actions: readonly DraftAction[],
  planePts: readonly Vector3[],
  explicitPos?: Vector3 | null
): MatchedDocFace | null {
  if (planePts.length < 3) return null
  const ptMap = new Map<string, Vector3>()
  for (const p of doc.primitives) {
    if (p.type === "point3") ptMap.set(p.id, p.position)
  }
  const ownerPolyByFaceId = new Map<string, { polyId: string; faceSub: number }>()
  for (const p of doc.primitives) {
    if (p.type !== "polyhedron3") continue
    p.faceIds.forEach((fid, idx) => {
      const fPos = fid.lastIndexOf(":f")
      const sub = fPos >= 0 ? Number(fid.slice(fPos + 2)) : idx
      ownerPolyByFaceId.set(fid, { polyId: p.id, faceSub: Number.isInteger(sub) && sub >= 0 ? sub : idx })
    })
  }
  let best: { match: MatchedDocFace; score: number } | null = null
  for (const face of doc.primitives) {
    if (face.type !== "face3" || face.pointIds.length < 3) continue
    const faceVerts = face.pointIds.map((id) => ptMap.get(id)).filter((v): v is Vector3 => Boolean(v))
    if (faceVerts.length !== face.pointIds.length) continue
    const fh = faceHost3(faceVerts)
    if (!fh) continue
    const planeAllInside = planePts.every((pt) => {
      const proj = fh.closestParameter(pt)
      return distanceVector3(fh.evaluate(proj), pt) <= 1e-2
    })
    if (!planeAllInside) continue
    if (explicitPos) {
      const proj = fh.closestParameter(explicitPos)
      if (distanceVector3(fh.evaluate(proj), explicitPos) > 1e-2) continue
    }
    const owner = ownerPolyByFaceId.get(face.id)
    let faceAlias: string | undefined
    let faceSub: number | undefined
    if (owner) {
      const ownerPrim = doc.primitives.find((p) => p.id === owner.polyId)
      const ownerLabel = ownerPrim?.label ?? ownerPrim?.id
      const polyAct = [...actions].reverse().find((a) => {
        if (a.actionId !== "solid.create_polyhedron" && a.actionId !== "solid.create_prism" && a.actionId !== "solid.create_template") return false
        const inp = a.inputs as { alias?: unknown; label?: unknown }
        return inp.alias === ownerLabel || inp.label === ownerLabel || inp.alias === owner.polyId
      })
      const alias = polyAct ? (polyAct.inputs as { alias?: unknown }).alias : undefined
      if (typeof alias === "string" && alias.length > 0) {
        faceAlias = alias
        faceSub = owner.faceSub
      }
    } else {
      const faceLabel = face.label ?? face.id
      const faceAct = [...actions].reverse().find((a) => {
        if (a.actionId !== "solid.create_face") return false
        const inp = a.inputs as { alias?: unknown; label?: unknown; vertices?: Vector3[] }
        if (inp.alias === faceLabel || inp.label === faceLabel || inp.alias === face.id) return true
        return Array.isArray(inp.vertices)
          && inp.vertices.length === faceVerts.length
          && inp.vertices.every((v, idx) => distanceVector3(v, faceVerts[idx]!) <= 1e-2)
      })
      const alias = faceAct ? (faceAct.inputs as { alias?: unknown }).alias : undefined
      if (typeof alias === "string" && alias.length > 0) {
        faceAlias = alias
      }
    }
    if (!faceAlias) continue
    const score = (owner ? 100 : 0) + faceVerts.length * 10 + (faceVerts.length === planePts.length ? 1 : 0)
    if (!best || score > best.score) {
      best = {
        match: { faceId: face.id, faceAlias, ...(faceSub !== undefined ? { faceSub } : {}), faceVerts, hostFace: fh },
        score
      }
    }
  }
  return best?.match ?? null
}

function splitPointTokensInPrompt(
  raw: string,
  sortedPointNames: readonly string[],
  expectedCount?: number
): string[] | null {
  const cleaned = raw.replace(/[′'’ʼ]/g, "'").replace(/_{1}/g, "")
  const cleanedLower = cleaned.toLowerCase()
  const memo = new Map<number, string[] | null>()
  const dfs = (idx: number): string[] | null => {
    if (idx === cleaned.length) return []
    if (memo.has(idx)) return memo.get(idx)!
    for (const tok of sortedPointNames) {
      const normTok = tok.replace(/[′'’ʼ]/g, "'").replace(/_/g, "")
      if (cleanedLower.startsWith(normTok.toLowerCase(), idx)) {
        const rest = dfs(idx + normTok.length)
        if (rest !== null) {
          const res = [tok, ...rest]
          memo.set(idx, res)
          return res
        }
      }
    }
    memo.set(idx, null)
    return null
  }
  const parsed = dfs(0)
  if (!parsed) return null
  if (expectedCount !== undefined && parsed.length !== expectedCount) return null
  return parsed
}

function actionEndpointInsertIndex(actions: readonly DraftAction[], vertexNames: readonly string[]): number {
  let latestIdx = -1
  for (const vn of vertexNames) {
    const idx = actions.findIndex((act) => {
      const inp = act.inputs as { alias?: unknown; label?: unknown; vertexNames?: unknown }
      if (String(inp.alias ?? "") === vn || String(inp.label ?? "") === vn) return true
      return Array.isArray(inp.vertexNames) && inp.vertexNames.some((x) => String(x) === vn)
    })
    if (idx < 0) return -1
    if (idx > latestIdx) latestIdx = idx
  }
  return latestIdx
}

function materializePromptSegmentsInActions(
  actions: readonly DraftAction[],
  doc: GeometryDocument,
  problemText: string
): DraftAction[] | null {
  if (doc.workspace !== "geometry3d") return null
  const p3ById = new Map<string, { label: string; pos: Vector3 }>()
  const p3ByLabel = new Map<string, Vector3>()
  for (const p of doc.primitives) {
    if (p.type === "point3" && p.label) {
      p3ById.set(p.id, { label: p.label, pos: p.position })
      p3ByLabel.set(p.label, p.position)
    }
  }
  const pointNames = [...p3ByLabel.keys()].sort((a, b) => b.length - a.length)
  if (pointNames.length < 2) return null

  const existingPairs = new Set<string>()
  const pairKey = (a: string, b: string) => (a < b ? `${a}::${b}` : `${b}::${a}`)
  for (const p of doc.primitives) {
    if ((p.type === "segment3" || p.type === "edge3") && p.pointIds.length === 2) {
      const l0 = p3ById.get(p.pointIds[0]!)?.label
      const l1 = p3ById.get(p.pointIds[1]!)?.label
      if (l0 && l1 && l0 !== l1) existingPairs.add(pairKey(l0, l1))
    }
  }
  for (const act of actions) {
    if (act.actionId !== "solid.create_segment") continue
    const vns = (act.inputs as { vertexNames?: unknown }).vertexNames
    if (Array.isArray(vns) && vns.length === 2) {
      existingPairs.add(pairKey(String(vns[0]), String(vns[1])))
    }
  }

  // Strip polyhedron/plane names and dihedral triplets first so they are not misread as 2-letter segments.
  const scanText = problemText
    .replace(/−/g, "-")
    .replace(/二面角\s*[A-Za-z0-9'′]+\s*[-－—]\s*[A-Za-z0-9'′]+\s*[-－—]\s*[A-Za-z0-9'′]+/g, " ")
    .replace(/(?:平面|底面|侧面|截面|三角形|△|正方体|长方体|四棱锥|三棱锥|三棱柱|四面体|棱柱|棱锥|棱台)\s*[A-Za-z0-9'′_-]{3,}/g, " ")

  const desiredPairs: Array<[string, string]> = []
  const seenDesired = new Set<string>()
  const tryAddPair = (rawTok: string) => {
    const cleaned = rawTok.trim().replace(/^[-－—]+|[-－—]+$/g, "")
    if (!cleaned || cleaned.length < 2) return
    const pair = splitPointTokensInPrompt(cleaned, pointNames, 2)
    if (!pair || pair[0] === pair[1]) return
    const k = pairKey(pair[0]!, pair[1]!)
    if (existingPairs.has(k) || seenDesired.has(k)) return
    const posA = p3ByLabel.get(pair[0]!)
    const posB = p3ByLabel.get(pair[1]!)
    if (!posA || !posB || distanceVector3(posA, posB) <= 1e-6) return
    seenDesired.add(k)
    desiredPairs.push([pair[0]!, pair[1]!])
  }

  for (const m of scanText.matchAll(/(?:连接|连结|作(?:出)?(?:线段|直线|射线)?|线段|直线|异面直线|垂线|交线|斜线)\s*([A-Za-z0-9'′_、，,和与\s]{2,28})/g)) {
    for (const part of m[1]!.split(/[、，,和与\s]+/)) {
      tryAddPair(part)
    }
  }
  for (const m of scanText.matchAll(/([A-Za-z][A-Za-z0-9'′_]{1,5})\s*(?:⊥|∥|\/\/|垂直于?|平行于?|相交于?)\s*([A-Za-z][A-Za-z0-9'′_]{1,5})/g)) {
    tryAddPair(m[1]!)
    tryAddPair(m[2]!)
  }

  if (desiredPairs.length === 0) return null
  const working = [...actions]
  let added = false
  for (const [u, v] of desiredPairs) {
    const insertIdx = actionEndpointInsertIndex(working, [u, v])
    if (insertIdx < 0) continue
    working.splice(insertIdx + 1, 0, {
      actionId: "solid.create_segment",
      actionKey: `ds-ctx-seg-${u}${v}`,
      factIds: [],
      inputs: { alias: `${u}${v}`, label: `${u}${v}`, vertexNames: [u, v] }
    } as DraftAction)
    added = true
  }
  return added ? working : null
}

function materializePromptFacesInActions(
  actions: readonly DraftAction[],
  doc: GeometryDocument,
  problemText: string
): DraftAction[] | null {
  if (doc.workspace !== "geometry3d") return null
  const p3ByLabel = new Map<string, Vector3>()
  for (const p of doc.primitives) {
    if (p.type === "point3" && p.label) p3ByLabel.set(p.label, p.position)
  }
  const pointNames = [...p3ByLabel.keys()].sort((a, b) => b.length - a.length)
  if (pointNames.length < 3) return null

  const normalizedPrompt = problemText.replace(/−/g, "-")
  const explicitFaceGroups: Array<{ verts: string[]; label: string }> = []
  const seenFaceSets = new Set<string>()
  const tryAddFaceGroup = (verts: string[] | null) => {
    if (!verts || verts.length < 3 || verts.length > 4) return
    const uniq = [...new Set(verts)]
    if (uniq.length !== verts.length) return
    if (!uniq.every((v) => p3ByLabel.has(v))) return
    const sig = [...uniq].sort().join("|")
    if (seenFaceSets.has(sig)) return
    seenFaceSets.add(sig)
    explicitFaceGroups.push({ verts: uniq, label: `面 ${uniq.join("")}` })
  }

  // 1. 题干显式提到的平面 / 截面 / 三角形 / 二面角
  for (const m of normalizedPrompt.matchAll(/(?:平面|截面|三角形|△|面)\s*([A-Za-z][A-Za-z0-9'′_]{2,7})/g)) {
    tryAddFaceGroup(splitPointTokensInPrompt(m[1]!, pointNames))
  }
  for (const m of normalizedPrompt.matchAll(/(?:平面|截面|三角形|△|面)\s*([A-Za-z][A-Za-z0-9'′_]*(?:\s*[-－—,，、\s]\s*[A-Za-z][A-Za-z0-9'′_]*){2,3})/g)) {
    tryAddFaceGroup(splitPointTokensInPrompt(m[1]!.replace(/[-－—,，、\s]+/g, ""), pointNames))
  }
  for (const m of normalizedPrompt.matchAll(/(?:过|由)(?:点|三点|四点)?\s*([A-Za-z][A-Za-z0-9'′_]*(?:\s*[-－—,，、和与]\s*[A-Za-z][A-Za-z0-9'′_]*){2,3})\s*(?:确定|决定|所在|构成)?的?(?:平面|面)/g)) {
    tryAddFaceGroup(splitPointTokensInPrompt(m[1]!.replace(/[-－—,，、和与\s]+/g, ""), pointNames))
  }
  for (const m of normalizedPrompt.matchAll(/二面角\s*([A-Za-z0-9'′]+)\s*[-－—]\s*([A-Za-z0-9'′]+)\s*[-－—]\s*([A-Za-z0-9'′]+)/g)) {
    const pA = splitPointTokensInPrompt(m[1]!, pointNames)
    const edge = splitPointTokensInPrompt(m[2]!, pointNames, 2)
    const pB = splitPointTokensInPrompt(m[3]!, pointNames)
    if (pA && pA.length === 1 && edge && edge.length === 2) tryAddFaceGroup([pA[0]!, edge[0]!, edge[1]!])
    if (pB && pB.length === 1 && edge && edge.length === 2) tryAddFaceGroup([edge[0]!, edge[1]!, pB[0]!])
  }

  // 2. 直接用题目中画出的相交辅助线（solid.create_segment）推测截面/构造面（如 AE、CE 共享动点 E → 面 AEC）
  const dynamicOrAuxPoints = new Set<string>()
  for (const act of actions) {
    if (
      act.actionId === "dynamic.create_bound_point" ||
      act.actionId === "dynamic.create_face_point" ||
      act.actionId === "solid.create_point" ||
      act.actionId === "solid.create_projection" ||
      act.actionId === "solid.create_reflection"
    ) {
      const inp = act.inputs as { alias?: unknown; label?: unknown }
      if (typeof inp.label === "string" && inp.label) dynamicOrAuxPoints.add(inp.label)
      else if (typeof inp.alias === "string" && inp.alias) dynamicOrAuxPoints.add(inp.alias)
    }
  }
  const hasPolyhedron = doc.primitives.some((p) => p.type === "polyhedron3")
  const segAdj = new Map<string, Set<string>>()
  for (const act of actions) {
    if (act.actionId !== "solid.create_segment") continue
    const vns = (act.inputs as { vertexNames?: unknown }).vertexNames
    if (!Array.isArray(vns) || vns.length !== 2) continue
    const a = String(vns[0]), b = String(vns[1])
    if (!a || !b || a === b || !p3ByLabel.has(a) || !p3ByLabel.has(b)) continue
    if (!segAdj.has(a)) segAdj.set(a, new Set())
    if (!segAdj.has(b)) segAdj.set(b, new Set())
    segAdj.get(a)!.add(b)
    segAdj.get(b)!.add(a)
  }
  const coveredQuadTriples = new Set<string>()
  const segNodes = [...segAdj.keys()].sort()
  // 2a. Coplanar 4-cycles (e.g. cross-section quad EF-FG-GH-HE)
  for (let i = 0; i < segNodes.length; i += 1) {
    const a = segNodes[i]!
    for (const b of segAdj.get(a)!) {
      if (b <= a) continue
      for (const c of segAdj.get(b)!) {
        if (c === a || c <= a) continue
        for (const d of segAdj.get(c)!) {
          if (d === b || d <= a || !segAdj.get(d)?.has(a)) continue
          const quadVerts = [a, b, c, d].map((v) => p3ByLabel.get(v)!)
          if (!faceHost3(quadVerts)) continue
          if (solveConstraint3d({ kind: "coplanar", points: quadVerts }).constraintStatus !== "satisfied") continue
          tryAddFaceGroup([a, b, c, d])
          for (const drop of [a, b, c, d]) {
            const tri = [a, b, c, d].filter((x) => x !== drop).sort().join("|")
            coveredQuadTriples.add(tri)
          }
        }
      }
    }
  }
  // 2b. Triangles & open V-pairs (two intersecting segments sharing a vertex)
  for (const pivot of segNodes) {
    const nbrs = [...segAdj.get(pivot)!].sort()
    for (let i = 0; i < nbrs.length; i += 1) {
      for (let j = i + 1; j < nbrs.length; j += 1) {
        const u = nbrs[i]!
        const w = nbrs[j]!
        const isClosedTriangle = segAdj.get(u)?.has(w) ?? false
        const involvesDynamic = dynamicOrAuxPoints.has(pivot) || dynamicOrAuxPoints.has(u) || dynamicOrAuxPoints.has(w)
        if (!isClosedTriangle && hasPolyhedron && !involvesDynamic) continue
        const triSig = [u, pivot, w].sort().join("|")
        if (coveredQuadTriples.has(triSig)) continue
        tryAddFaceGroup([u, pivot, w])
      }
    }
  }

  if (explicitFaceGroups.length === 0) return null

  const working = [...actions]
  let ctxFaceIdx = 0
  let added = false
  for (const group of explicitFaceGroups) {
    const faceVerts = group.verts.map((v) => p3ByLabel.get(v)!)
    if (!faceHost3(faceVerts)) continue
    if (findMatchingFaceInDoc(doc, working, faceVerts)) continue
    const alreadyInActions = working.some((act) => {
      if (act.actionId !== "solid.create_face") return false
      const inp = act.inputs as { vertices?: Vector3[]; vertexNames?: string[] }
      if (Array.isArray(inp.vertexNames) && group.verts.every((v) => inp.vertexNames!.includes(v))) return true
      return Array.isArray(inp.vertices) && faceVerts.every((v) => inp.vertices!.some((av) => distanceVector3(av, v) <= 1e-2))
    })
    if (alreadyInActions) continue
    ctxFaceIdx += 1
    const faceAlias = `face_ctx_${group.verts.join("")}_${ctxFaceIdx}`
    const insertAfterIdx = actionEndpointInsertIndex(working, group.verts)
    if (insertAfterIdx < 0) continue
    working.splice(insertAfterIdx + 1, 0, {
      actionId: "solid.create_face",
      actionKey: `ds-ctx-face-${group.verts.join("")}`,
      factIds: [],
      inputs: { alias: faceAlias, label: group.label, vertices: faceVerts, vertexNames: group.verts }
    } as DraftAction)
    added = true
  }
  return added ? working : null
}

function enrichPromptSegmentsAndFaces(
  actions: readonly DraftAction[],
  doc: GeometryDocument,
  problemText: string
): DraftAction[] | null {
  let working = [...actions]
  let changed = false
  const withSegs = materializePromptSegmentsInActions(working, doc, problemText)
  if (withSegs) {
    working = withSegs
    changed = true
  }
  const withFaces = materializePromptFacesInActions(working, doc, problemText)
  if (withFaces) {
    working = withFaces
    changed = true
  }
  return changed ? working : null
}

function buildCoplanarPyramidPolyAction(
  apexEntry: { idx: number; action: DraftAction; label: string; pos: Vector3 },
  baseEntries: Array<{ idx: number; action: DraftAction; label: string; pos: Vector3 }>
): { polyAction: DraftAction; dropSet: Set<number>; insertAt: number } | null {
  if (baseEntries.length < 3) return null
  const basePts = baseEntries.map((e) => e.pos)
  const bPlane = planeFromPoints(basePts[0]!, basePts[1]!, basePts[2]!)
  if (!bPlane) return null
  const maxBaseDev = Math.max(...basePts.map((p) =>
    Math.abs(bPlane.normal.x * p.x + bPlane.normal.y * p.y + bPlane.normal.z * p.z + bPlane.constant)
  ))
  const apexDist = Math.abs(
    bPlane.normal.x * apexEntry.pos.x + bPlane.normal.y * apexEntry.pos.y + bPlane.normal.z * apexEntry.pos.z + bPlane.constant
  )
  if (maxBaseDev > 1e-3 || !(apexDist > 1e-5)) return null

  const nVec = bPlane.normal
  const centroid = basePts.reduce(
    (acc, p) => ({ x: acc.x + p.x / basePts.length, y: acc.y + p.y / basePts.length, z: acc.z + p.z / basePts.length }),
    { x: 0, y: 0, z: 0 }
  )
  const firstOff = { x: basePts[0]!.x - centroid.x, y: basePts[0]!.y - centroid.y, z: basePts[0]!.z - centroid.z }
  const uLen = Math.hypot(firstOff.x, firstOff.y, firstOff.z)
  if (!(uLen > 1e-9)) return null
  const u = { x: firstOff.x / uLen, y: firstOff.y / uLen, z: firstOff.z / uLen }
  const v = {
    x: nVec.y * u.z - nVec.z * u.y,
    y: nVec.z * u.x - nVec.x * u.z,
    z: nVec.x * u.y - nVec.y * u.x
  }
  const allEntries = [apexEntry, ...baseEntries]
  const baseIndices = baseEntries.map((_, i) => i + 1)
  const orderedBase = [...baseIndices].sort((ia, ib) => {
    const da = { x: allEntries[ia]!.pos.x - centroid.x, y: allEntries[ia]!.pos.y - centroid.y, z: allEntries[ia]!.pos.z - centroid.z }
    const db = { x: allEntries[ib]!.pos.x - centroid.x, y: allEntries[ib]!.pos.y - centroid.y, z: allEntries[ib]!.pos.z - centroid.z }
    return Math.atan2(da.x * v.x + da.y * v.y + da.z * v.z, da.x * u.x + da.y * u.y + da.z * u.z) -
      Math.atan2(db.x * v.x + db.y * v.y + db.z * v.z, db.x * u.x + db.y * u.y + db.z * u.z)
  })
  const apexOff = { x: apexEntry.pos.x - centroid.x, y: apexEntry.pos.y - centroid.y, z: apexEntry.pos.z - centroid.z }
  const dotApex = nVec.x * apexOff.x + nVec.y * apexOff.y + nVec.z * apexOff.z
  const baseFace = dotApex > 0 ? [...orderedBase].reverse() : orderedBase
  const lateralFaces = baseFace.map((bi, idx) => [0, baseFace[(idx + baseFace.length - 1) % baseFace.length]!, bi])

  const dropSet = new Set(allEntries.map((s) => s.idx))
  const insertAt = Math.min(...dropSet)
  const polyAction: DraftAction = {
    actionId: "solid.create_polyhedron",
    actionKey: `${apexEntry.action.actionKey}-poly`,
    factIds: [],
    inputs: {
      alias: "pyr",
      label: "pyr",
      vertices: allEntries.map((s) => s.pos),
      vertexNames: allEntries.map((s) => s.label),
      faces: [baseFace, ...lateralFaces]
    }
  } as unknown as DraftAction
  return { polyAction, dropSet, insertAt }
}

function promoteStandalonePolyhedronVertices(
  actions: DraftAction[],
  workspace: GeometryDocument["workspace"],
  problemText?: string
): DraftAction[] | null {
  if (workspace !== "geometry3d") return null
  const hasRealSolid = actions.some((a) =>
    (a.actionId === "solid.create_polyhedron" && Array.isArray((a.inputs as { faces?: unknown[] }).faces) && (a.inputs as { faces: unknown[] }).faces.length > 1) ||
    a.actionId === "solid.create_prism" ||
    a.actionId === "solid.create_template"
  )
  if (hasRealSolid) return null

  const ptEntries: Array<{ idx: number; action: DraftAction; label: string; pos: Vector3 }> = []
  for (let i = 0; i < actions.length; i += 1) {
    const act = actions[i]!
    if (act.actionId !== "solid.create_point") continue
    const inp = act.inputs as { label?: unknown; alias?: unknown; position?: unknown; points?: unknown } | undefined
    const lbl = typeof inp?.label === "string" && inp.label.trim() ? inp.label.trim() : typeof inp?.alias === "string" ? inp.alias.trim() : ""
    const rawPos = (Array.isArray(inp?.points) ? inp.points[0] : inp?.position) as Vector3 | undefined
    if (!lbl || !rawPos || typeof rawPos.x !== "number" || typeof rawPos.y !== "number" || typeof rawPos.z !== "number") continue
    ptEntries.push({ idx: i, action: act, label: lbl, pos: rawPos })
  }
  if (ptEntries.length < 4) return null

  const byLabel = new Map(ptEntries.map((entry) => [entry.label, entry]))
  const tryCommitPoly = (built: { polyAction: DraftAction; dropSet: Set<number>; insertAt: number } | null): DraftAction[] | null => {
    if (!built) return null
    const rebuilt: DraftAction[] = []
    for (let i = 0; i < actions.length; i += 1) {
      if (i === built.insertAt) rebuilt.push(built.polyAction)
      if (!built.dropSet.has(i)) rebuilt.push(actions[i]!)
    }
    const compiled = compilePlan(
      { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "promote-polyhedron", factIds: [], actions: rebuilt },
      { document: createEmptyDocument(workspace), workspace, capabilityRevision: "draft", conversationId: "ds-promote-polyhedron" }
    )
    return compiled.ok && compiled.draftDocument ? rebuilt : null
  }

  // 1. Named pyramid in prompt: e.g. 三棱锥 P-ABC, 四棱锥 P-ABCD, 五棱锥 S-ABCDE, 四面体 P-ABC
  if (problemText) {
    const pyrMatch = /(?:三棱锥|四棱锥|五棱锥|六棱锥|棱锥|四面体)\s*([A-Z])\s*[-−–—]?\s*([A-Z]{3,6})/.exec(problemText)
    if (pyrMatch) {
      const apexName = pyrMatch[1]!
      const baseNames = [...pyrMatch[2]!]
      const allNames = [apexName, ...baseNames]
      if (new Set(allNames).size === allNames.length && allNames.every((n) => byLabel.has(n))) {
        const res = tryCommitPoly(buildCoplanarPyramidPolyAction(byLabel.get(apexName)!, baseNames.map((n) => byLabel.get(n)!)))
        if (res) return res
      }
    }
    // 2. Named prism / cuboid / cube in prompt: e.g. 三棱柱 ABC-A₁B₁C₁, 正方体 ABCD-A₁B₁C₁D₁
    const prismMatch = /(?:正三棱柱|直三棱柱|三棱柱|正四棱柱|直四棱柱|四棱柱|直棱柱|棱柱|长方体|正方体)\s*([A-Z]{3,4})\s*[-−–—]\s*((?:[A-Z](?:[₁1'′])?){3,4})/.exec(problemText)
    if (prismMatch) {
      const bottomNames = [...prismMatch[1]!]
      const topTokens = [...prismMatch[2]!.matchAll(/[A-Z](?:[₁1'′])?/g)].map((m) => m[0]!)
      const resolveVert = (tok: string) => byLabel.get(tok) ?? byLabel.get(tok.replace("1", "₁")) ?? byLabel.get(tok.replace("₁", "1")) ?? byLabel.get(tok.replace("'", "′"))
      if (bottomNames.length === topTokens.length && bottomNames.length >= 3) {
        const botEntries = bottomNames.map((n) => byLabel.get(n))
        const topEntries = topTokens.map(resolveVert)
        if (botEntries.every((e): e is typeof ptEntries[number] => e !== undefined) && topEntries.every((e): e is typeof ptEntries[number] => e !== undefined)) {
          const k = botEntries.length
          const allEntries = [...botEntries, ...topEntries]
          if (new Set(allEntries.map((e) => e.idx)).size === 2 * k) {
            const bPlane = planeFromPoints(botEntries[0]!.pos, botEntries[1]!.pos, botEntries[2]!.pos)
            const tPlane = planeFromPoints(topEntries[0]!.pos, topEntries[1]!.pos, topEntries[2]!.pos)
            if (bPlane && tPlane) {
              const sep = Math.abs(bPlane.normal.x * topEntries[0]!.pos.x + bPlane.normal.y * topEntries[0]!.pos.y + bPlane.normal.z * topEntries[0]!.pos.z + bPlane.constant)
              if (sep > 1e-5) {
                const bottomFace = Array.from({ length: k }, (_, i) => i)
                const topFace = Array.from({ length: k }, (_, i) => k + i)
                const lateralFaces = Array.from({ length: k }, (_, i) => [i, (i + 1) % k, k + ((i + 1) % k), k + i])
                const dropSet = new Set(allEntries.map((e) => e.idx))
                const insertAt = Math.min(...dropSet)
                const polyAction: DraftAction = {
                  actionId: "solid.create_polyhedron",
                  actionKey: `${botEntries[0]!.action.actionKey}-poly`,
                  factIds: [],
                  inputs: {
                    alias: "prism",
                    label: "prism",
                    vertices: allEntries.map((e) => e.pos),
                    vertexNames: allEntries.map((e) => e.label),
                    faces: [bottomFace, topFace, ...lateralFaces]
                  }
                } as unknown as DraftAction
                const res = tryCommitPoly({ polyAction, dropSet, insertAt })
                if (res) return res
              }
            }
          }
        }
      }
    }
  }

  // 3. Fallback: 3+ triangle faces referencing 4 unique vertices (tetrahedron)
  const triNames = new Set<string>()
  const faceActs = actions.filter((a) => a.actionId === "solid.create_face")
  if (faceActs.length >= 3) {
    for (const fa of faceActs) {
      const vns = (fa.inputs as { vertexNames?: unknown }).vertexNames
      if (Array.isArray(vns) && vns.length === 3 && vns.every((v): v is string => typeof v === "string")) {
        vns.forEach((v) => triNames.add(v))
      }
    }
    if (triNames.size === 4 && [...triNames].every((n) => byLabel.has(n))) {
      const sel = [...triNames].map((n) => byLabel.get(n)!)
      const res = tryCommitPoly(buildCoplanarPyramidPolyAction(sel[0]!, sel.slice(1)))
      if (res) return res
    }
  }

  // 4. Fallback: exact 4 or 5 standalone 3D points forming a pyramid (1 apex + 3 or 4 coplanar base points)
  if (ptEntries.length === 4 || ptEntries.length === 5) {
    for (let apexIdx = 0; apexIdx < ptEntries.length; apexIdx += 1) {
      const apex = ptEntries[apexIdx]!
      const base = ptEntries.filter((_, i) => i !== apexIdx)
      const res = tryCommitPoly(buildCoplanarPyramidPolyAction(apex, base))
      if (res) return res
    }
  }
  return null
}

function consolidateSolidScaffolding(
  actions: DraftAction[],
  workspace: GeometryDocument["workspace"]
): DraftAction[] | null {
  const solidActs = actions.filter((a) =>
    (a.actionId === "solid.create_polyhedron" && !(Array.isArray((a.inputs as { faces?: unknown[] }).faces) && (a.inputs as { faces: unknown[] }).faces.length === 1)) ||
    a.actionId === "solid.create_prism" ||
    a.actionId === "solid.create_template"
  )
  if (solidActs.length === 0) return null

  const baseCompile = compilePlan(
    { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "consolidate-base", factIds: [], actions },
    { document: createEmptyDocument(workspace), workspace, capabilityRevision: "draft", conversationId: "ds-consolidate-base" }
  )
  const doc = baseCompile.ok ? baseCompile.draftDocument : null
  if (!doc) return null

  const ptPosById = new Map<string, Vector3>()
  const ptLabelById = new Map<string, string>()
  for (const p of doc.primitives) {
    if (p.type === "point3") {
      ptPosById.set(p.id, p.position)
      if (p.label) ptLabelById.set(p.id, p.label)
    }
  }

  let working = [...actions]
  const removeKeys = new Set<string>()
  let earliestRemovedIdx = Number.POSITIVE_INFINITY
  let targetSolidIdx = -1

  for (const solidAct of solidActs) {
    const solidAlias = typeof (solidAct.inputs as { alias?: unknown }).alias === "string" ? (solidAct.inputs as { alias: string }).alias : null
    const solidPrim = findHostPrimitiveInDoc(doc, solidAct)
    if (!solidAlias || !solidPrim || solidPrim.type !== "polyhedron3") continue
    const solidVertices = solidPrim.vertexIds.map((id) => ({ id, label: ptLabelById.get(id), pos: ptPosById.get(id) })).filter((v): v is { id: string; label: string | undefined; pos: Vector3 } => Boolean(v.pos))
    const solidFaces = solidPrim.faceIds.map((fid, idx) => {
      const fPrim = doc.primitives.find((p) => p.id === fid)
      if (fPrim?.type !== "face3") return null
      const verts = fPrim.pointIds.map((pid) => ptPosById.get(pid)).filter((v): v is Vector3 => Boolean(v))
      const fh = faceHost3(verts)
      if (!fh) return null
      const fPos = fid.lastIndexOf(":f")
      const sub = fPos >= 0 ? Number(fid.slice(fPos + 2)) : idx
      return { faceId: fid, faceSub: Number.isInteger(sub) && sub >= 0 ? sub : idx, verts, fh }
    }).filter((x): x is NonNullable<typeof x> => Boolean(x))

    const currentSolidIdx = working.findIndex((a) => a.actionKey === solidAct.actionKey)
    if (currentSolidIdx < 0) continue

    // 1. Rebind bound points on redundant standalone segments matching a solid edge
    const segAliasesToDrop = new Map<string, { hostSub: number; segVerts: [Vector3, Vector3]; segActionKey: string; segIdx: number }>()
    for (let i = 0; i < working.length; i += 1) {
      const act = working[i]!
      if (act.actionId !== "solid.create_segment") continue
      const inp = act.inputs as { alias?: unknown; vertexNames?: unknown; dashed?: unknown }
      if (inp.dashed === true) continue
      const segAlias = typeof inp.alias === "string" ? inp.alias : null
      const vns = Array.isArray(inp.vertexNames) ? inp.vertexNames.filter((x): x is string => typeof x === "string") : []
      if (!segAlias || vns.length !== 2) continue
      const ptByLabel = (lbl: string) => {
        const found = doc.primitives.find((p): p is Extract<GeometryDocument["primitives"][number], { type: "point3" }> => p.type === "point3" && p.label === lbl)
        return found?.position
      }
      const pA = solidVertices.find((v) => v.label === vns[0])?.pos ?? ptByLabel(vns[0]!)
      const pB = solidVertices.find((v) => v.label === vns[1])?.pos ?? ptByLabel(vns[1]!)
      if (!pA || !pB) continue
      const edgeMatch = findSolidEdgeHostSub(doc, solidAct, vns[0]!, vns[1]!, pA, pB)
      if (edgeMatch) {
        segAliasesToDrop.set(segAlias, { hostSub: edgeMatch.hostSub, segVerts: [pA, pB], segActionKey: act.actionKey, segIdx: i })
      }
    }
    if (segAliasesToDrop.size > 0) {
      working = working.map((act) => {
        if (act.actionId !== "dynamic.create_bound_point") return act
        const inp = act.inputs as { host?: { scope?: string; alias?: string }; parameter?: number }
        const hAlias = inp.host?.scope === "draft" ? inp.host.alias : undefined
        const segInfo = hAlias ? segAliasesToDrop.get(hAlias) : undefined
        if (!segInfo) return act
        const edgePrim = doc.primitives.find((p) => p.type === "edge3" && p.id === `${solidPrim.id}:e${segInfo.hostSub}`)
        if (edgePrim?.type !== "edge3" || edgePrim.pointIds.length !== 2) return act
        const eP0 = ptPosById.get(edgePrim.pointIds[0]!)
        const eP1 = ptPosById.get(edgePrim.pointIds[1]!)
        if (!eP0 || !eP1) return act
        const reversed = distanceVector3(eP0, segInfo.segVerts[1]) <= 1e-4 && distanceVector3(eP1, segInfo.segVerts[0]) <= 1e-4
        const param = typeof inp.parameter === "number" ? (reversed ? 1 - inp.parameter : inp.parameter) : 0.5
        return {
          ...act,
          inputs: {
            ...act.inputs,
            host: { scope: "draft", alias: solidAlias },
            hostSub: segInfo.hostSub,
            parameter: param
          }
        } as unknown as DraftAction
      })
      for (const [segAlias, segInfo] of segAliasesToDrop) {
        const stillReferenced = working.some((act) => act.actionKey !== segInfo.segActionKey && JSON.stringify(act.inputs).includes(`"${segAlias}"`))
        if (!stillReferenced) {
          removeKeys.add(segInfo.segActionKey)
          earliestRemovedIdx = Math.min(earliestRemovedIdx, segInfo.segIdx)
        }
      }
    }

    // 2. Rebind face points on redundant standalone faces duplicating an exact polyhedron face
    // Only drop when both polygons share the exact same vertex set so valid sub-faces (e.g. △AEF ⊂ ABCD) are preserved.
    const isExactFaceMatch = (verts: readonly Vector3[], solidVerts: readonly Vector3[]): boolean =>
      verts.length === solidVerts.length &&
      verts.every((v) => solidVerts.some((sv) => distanceVector3(v, sv) <= 1e-2)) &&
      solidVerts.every((sv) => verts.some((v) => distanceVector3(sv, v) <= 1e-2))
    const faceAliasesToDrop = new Map<string, { targetFace: (typeof solidFaces)[number]; faceActionKey: string; faceIdx: number }>()
    for (let i = 0; i < working.length; i += 1) {
      const act = working[i]!
      if (act.actionId !== "solid.create_face") continue
      const inp = act.inputs as { alias?: unknown; vertices?: Vector3[] }
      const faceAlias = typeof inp.alias === "string" ? inp.alias : null
      const verts = Array.isArray(inp.vertices) ? inp.vertices : []
      if (!faceAlias || verts.length < 3) continue
      const hostFaceMatch = solidFaces.find((sf) => isExactFaceMatch(verts, sf.verts))
      if (hostFaceMatch) {
        faceAliasesToDrop.set(faceAlias, { targetFace: hostFaceMatch, faceActionKey: act.actionKey, faceIdx: i })
      }
    }
    if (faceAliasesToDrop.size > 0) {
      working = working.map((act) => {
        if (act.actionId !== "dynamic.create_face_point") return act
        const inp = act.inputs as { alias?: string; face?: { scope?: string; alias?: string }; uv?: [number, number] }
        const fAlias = inp.face?.scope === "draft" ? inp.face.alias : undefined
        const faceInfo = fAlias ? faceAliasesToDrop.get(fAlias) : undefined
        if (!faceInfo) return act
        const existingPt = doc.primitives.find((p) => p.type === "point3" && (p.label === (act.inputs as { label?: string }).label || p.id === inp.alias || p.label === inp.alias))
        const worldPos = existingPt?.type === "point3" ? existingPt.position : null
        if (!worldPos) return act
        const proj = faceInfo.targetFace.fh.closestParameter(worldPos)
        return {
          ...act,
          inputs: {
            ...act.inputs,
            face: { scope: "draft", alias: solidAlias },
            faceSub: faceInfo.targetFace.faceSub,
            uv: [proj.u, proj.v ?? 0]
          }
        } as unknown as DraftAction
      })
      for (const [faceAlias, faceInfo] of faceAliasesToDrop) {
        const stillReferenced = working.some((act) => act.actionKey !== faceInfo.faceActionKey && JSON.stringify(act.inputs).includes(`"${faceAlias}"`))
        if (!stillReferenced) {
          removeKeys.add(faceInfo.faceActionKey)
          earliestRemovedIdx = Math.min(earliestRemovedIdx, faceInfo.faceIdx)
        }
      }
    }

    // 3. Drop redundant standalone free points that duplicate the solid's own named vertices
    for (let i = 0; i < working.length; i += 1) {
      const act = working[i]!
      if (act.actionId !== "solid.create_point") continue
      const inp = act.inputs as { alias?: unknown; label?: unknown; position?: Vector3 }
      const ptAlias = typeof inp.alias === "string" ? inp.alias : null
      const ptLabel = typeof inp.label === "string" ? inp.label : ptAlias
      if (!ptAlias || !ptLabel || !inp.position) continue
      const matchesSolidVertex = solidVertices.some((sv) =>
        sv.label === ptLabel && distanceVector3(sv.pos, inp.position!) <= 1e-4
      )
      if (!matchesSolidVertex) continue
      // Keep only if another remaining action references a distinct internal alias different from label
      const aliasDiffReferenced = ptAlias !== ptLabel && working.some((other) =>
        other.actionKey !== act.actionKey && !removeKeys.has(other.actionKey) && JSON.stringify(other.inputs).includes(`"${ptAlias}"`)
      )
      if (!aliasDiffReferenced) {
        removeKeys.add(act.actionKey)
        earliestRemovedIdx = Math.min(earliestRemovedIdx, i)
      }
    }

    if (earliestRemovedIdx < currentSolidIdx) {
      targetSolidIdx = currentSolidIdx
    }
  }

  if (removeKeys.size === 0) return null
  if (targetSolidIdx >= 0 && earliestRemovedIdx < targetSolidIdx) {
    const solidAct = working[targetSolidIdx]!
    const withoutRemoved = working.filter((a) => !removeKeys.has(a.actionKey) && a.actionKey !== solidAct.actionKey)
    const insertAt = Math.min(
      withoutRemoved.length,
      working.slice(0, earliestRemovedIdx).filter((a) => !removeKeys.has(a.actionKey)).length
    )
    withoutRemoved.splice(insertAt, 0, solidAct)
    return withoutRemoved
  }
  return working.filter((a) => !removeKeys.has(a.actionKey))
}

export const DS_ACTION_TOOL_NAMES = DS_ACTION_CLOSED_SET

export type DsActionStatus = "accepted" | "repairable" | "blocked"

export interface DsActionToolCallParsed {
  readonly ok: true
  readonly name: DsActionName
  readonly input: Record<string, unknown>
}

export interface DsActionToolCallInvalid {
  readonly ok: false
  readonly status: Exclude<DsActionStatus, "accepted">
  readonly code: string
  readonly detail: string
}

export interface DsActionExecutionResult {
  readonly ok: boolean
  readonly status: DsActionStatus
  readonly action: DsActionName
  readonly toolName: DsActionName
  readonly progressSignature: string
  readonly stateChanged: boolean
  readonly entity?: string
  readonly position?: Coordinate
  readonly candidateHash: string
  readonly stepIndex: number
  readonly primitiveCount: number
  readonly measurement?: Record<string, unknown>
  readonly constraintStatus?: string
  readonly revertedAliases?: readonly string[]
  readonly repairHint?: string
  readonly blockerCode?: string
  readonly terminated?: {
    readonly plan: PlanEnvelope
    readonly slices?: readonly DsActionStateSlice[]
    readonly selectedScopeId?: string
  }
}

type DsActionRawResult = Omit<DsActionExecutionResult, "toolName" | "progressSignature">

/** Closed subset of DS actions backed by real kernel execution / state transitions or real observations. */
export const IMPLEMENTED_DS_ACTION_TOOLS: readonly DsActionName[] = [
  "declare_entity",
  "add_relation",
  "choose_strategy",
  "construct_base",
  "construct_point",
  "construct_line",
  "construct_segment",
  "construct_intersection",
  "construct_circle",
  "construct_conic",
  "construct_tangent",
  "construct_perpendicular",
  "construct_parallel",
  "construct_solid",
  "construct_equal_edge_triangular_prism",
  "construct_circumsphere",
  "construct_face",
  "construct_fold_state",
  "query_measurement",
  "query_constraint_status",
  "repair_entity",
  "repair_constraint",
  "finish_candidate",
  "request_clarification"
]

export const NON_CONSTRUCTIVE_DS_ACTIONS: ReadonlySet<DsActionName> = new Set<DsActionName>([
  "declare_entity",
  "add_relation",
  "choose_strategy",
  "query_measurement",
  "query_constraint_status",
  "request_clarification"
])

export interface DsActionStateSlice {
  readonly scopeId: string
  readonly stateId?: string
  readonly branchId?: string
  readonly candidateHash: string
  readonly actions: readonly DraftAction[]
  readonly answerText?: string
  readonly assumptions?: readonly string[]
}

export function buildRouteSlicesAndPlan(
  route: DeterministicProblemRoute,
  workspace: GeometryDocument["workspace"],
  goalOverride?: string
): { plan: PlanEnvelope; slices: DsActionStateSlice[] } {
  const effectiveWorkspace: GeometryDocument["workspace"] =
    route.family === "spatial-modeling" ? "geometry3d" : workspace === "geometry3d" ? "conics" : workspace
  const hashActions = (actions: readonly DraftAction[], idx: number): string => {
    const compiled = compilePlan(
      {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "plan",
        goal: route.plan.goal || "route slice",
        factIds: [],
        actions: [...actions]
      },
      {
        document: createEmptyDocument(effectiveWorkspace),
        conversationId: `ds-route-slice-${idx}`,
        documentGeneration: 0,
        workspace: effectiveWorkspace
      }
    )
    if (compiled.ok && compiled.draftDocument) {
      return canonicalContentHash(compiled.draftDocument)
    }
    return canonicalContentHash({ actions })
  }

  const slices: DsActionStateSlice[] = []
  let seq = 0
  const rootAnswer = route.plan.kind === "plan" ? route.plan.answer : undefined
  const rootAssumptions = route.plan.kind === "plan" ? route.plan.assumptions : undefined

  if (route.scopedStatePlans) {
    for (const [scopeId, perState] of Object.entries(route.scopedStatePlans)) {
      for (const [stateId, sub] of Object.entries(perState)) {
        if (sub.plan.kind !== "plan") continue
        slices.push({
          scopeId,
          stateId,
          candidateHash: hashActions(sub.plan.actions, ++seq),
          actions: [...sub.plan.actions],
          ...(sub.plan.answer ?? rootAnswer ? { answerText: sub.plan.answer ?? rootAnswer } : {}),
          ...(sub.plan.assumptions ?? rootAssumptions ? { assumptions: sub.plan.assumptions ?? rootAssumptions } : {})
        })
      }
    }
  } else if (route.statePlans) {
    for (const [stateId, sub] of Object.entries(route.statePlans)) {
      if (sub.plan.kind !== "plan") continue
      slices.push({
        scopeId: sub.selectedScopeId ?? route.selectedScopeId ?? "shared",
        stateId,
        candidateHash: hashActions(sub.plan.actions, ++seq),
        actions: [...sub.plan.actions],
        ...(sub.plan.answer ?? rootAnswer ? { answerText: sub.plan.answer ?? rootAnswer } : {}),
        ...(sub.plan.assumptions ?? rootAssumptions ? { assumptions: sub.plan.assumptions ?? rootAssumptions } : {})
      })
    }
  } else if (route.scopePlans) {
    for (const [scopeId, sub] of Object.entries(route.scopePlans)) {
      if (sub.plan.kind !== "plan") continue
      slices.push({
        scopeId,
        candidateHash: hashActions(sub.plan.actions, ++seq),
        actions: [...sub.plan.actions],
        ...(sub.plan.answer ?? rootAnswer ? { answerText: sub.plan.answer ?? rootAnswer } : {}),
        ...(sub.plan.assumptions ?? rootAssumptions ? { assumptions: sub.plan.assumptions ?? rootAssumptions } : {})
      })
    }
  } else if (route.branchPlans) {
    const branchScopeId = route.selectedScopeId ?? "shared"
    for (const [branchId, bPlan] of Object.entries(route.branchPlans)) {
      if (bPlan.kind !== "plan") continue
      slices.push({
        scopeId: branchScopeId,
        branchId,
        candidateHash: hashActions(bPlan.actions, ++seq),
        actions: [...bPlan.actions],
        ...(bPlan.answer ?? rootAnswer ? { answerText: bPlan.answer ?? rootAnswer } : {}),
        ...(bPlan.assumptions ?? rootAssumptions ? { assumptions: bPlan.assumptions ?? rootAssumptions } : {})
      })
    }
  } else if (route.plan.kind === "plan") {
    slices.push({
      scopeId: "shared",
      candidateHash: hashActions(route.plan.actions, seq + 1),
      actions: [...route.plan.actions],
      ...(rootAnswer ? { answerText: rootAnswer } : {}),
      ...(rootAssumptions ? { assumptions: rootAssumptions } : {})
    })
  }

  const finalPlan: PlanEnvelope =
    route.plan.kind === "plan" && goalOverride
      ? { ...route.plan, goal: goalOverride }
      : route.plan
  return { plan: finalPlan, slices }
}

export interface DsActionReferenceDirectory {
  readonly materializedPoints: readonly string[]
  readonly materializedLines: readonly string[]
  readonly materializedConics: readonly string[]
  readonly declaredOnly: readonly string[]
  readonly truncated: boolean
}

export interface DsActionSession {
  referenceDirectory(branchId?: string): DsActionReferenceDirectory
  execute(toolName: string, rawInput: unknown): DsActionExecutionResult
  currentSnapshot(): ReturnType<ReturnType<typeof createSpeculativeCanvas>["snapshot"]>
  stateSlices(): readonly DsActionStateSlice[]
}

const DS_ACTION_DESCRIPTIONS: Record<DsActionName, string> = {
  declare_entity: "Declare an entity name/kind in scope/state; this does not draw geometry. Use construct_point or another construction action to materialize it.",
  add_relation: "Attach a named geometric relation (length/perpendicular/parallel/angle/ratio/tangent).",
  choose_strategy: "Select a geometric construction strategy for an entity.",
  construct_base: "Construct a base polygon or reference frame in 2D/3D.",
  construct_point: "Construct a named point: id with x,y or x,y,z for free vertices, or bind a moving point onto a host entity via hostId (+ parameter / u / v / x,y,z), planePoints (point in plane/face), or from,to,ratio (point on segment/edge).",
  construct_line: "Construct a named 2D line with id: use existing point names from and to, equation (also supports sqrt(...) like 'y=sqrt(6)/2*x-2'), throughPointId+slope/dx,dy, exact conic chord-ratio solver throughPointId+conicId+chordRatio (for vector EC = λ·CF on a conic!), or finite equation coefficients a,b,c for a*x+b*y+c=0.",
  construct_segment: "Construct a segment between two existing named points; provide both from and to references.",
  construct_intersection: "Intersect lineA with either lineB or conicId. Pass optional excludePointId to avoid re-picking an existing anchor point on conic, or selection min_x/max_x/min_y/max_y.",
  construct_circle: "Construct a 2D circle ONLY (never for 3D spheres: use construct_circumsphere or construct_solid(kind='sphere') in 3D). Supports center/radius, centerId, or equation.",
  construct_conic: "Construct ellipse/hyperbola/parabola. STRONGLY PREFER passing equation (e.g. 'x^2/3+y^2/4=1') OR throughPointIds for two existing points (or 1 point with c/e) whenever passing points or irrational semi-axes are involved — NEVER pass a² or b² as radiusX/radiusY (radiusX/radiusY MUST be semi-axes a, b, NOT denominators!). Also supports axis x|y, cx/cy center, and algebraic a/b/c/e/p.",
  construct_tangent: "Construct a live tangent line linked to a conic/moving point (conicId + pointId — works both ON and OUTSIDE a parabola, ellipse, hyperbola, or circle, with optional tangentPointId and branch 0|1) or to a function (functionId like 'f'/'g', expression, optional x0 for tangent, and mode='derivative' or includeDerivative=true).",
  construct_perpendicular: "Construct a line through a point perpendicular to a line.",
  construct_parallel: "Construct a line parallel to lineId: either through throughPointId or shifted by offsetX, offsetY, or perpendicular distance.",
  construct_solid: "Construct a named parametric solid via kernel solver (never raw hand vertices). Supports regular_pyramid, prism, cube, tetrahedron (accepts 6 edges pa,pb,pc,ab,ac,bc for P-ABC OR ab,ac,ad,bc,bd,cd for A-BCD, or 4 materialized vertexNames), perpendicular_pyramid, square_frustum, triangular_frustum, regular_frustum, cylinder, cone, round_frustum (height or slantHeight), sphere (pass inscribedIn=<solidId> to auto-compute exact inscribed sphere / max-volume ball).",
  construct_equal_edge_triangular_prism: "For a right triangular prism whose every edge has symbolic length a: give a named solid id and a positive displayScale; the kernel builds all geometry, not a numeric value for a.",
  construct_circumsphere: "Derive a real 3D circumsphere (default mode='circumsphere') or insphere/max-ball (mode='insphere') from an existing named solid; never provide raw center/radius or 2D construct_circle.",
  construct_face: "Construct a named polygonal face from existing points.",
  construct_fold_state: "Record a pre_fold/post_fold state transition along a hinge.",
  query_measurement: "Use metric=distance with targets of 2 points, metric=area with targets of 3 triangle points, or metric=position/coordinates with target naming 1 point.",
  query_constraint_status: "Use targets of existing named points and kind=coplanar, fixed_distance (with positive expected), collinear, perpendicular (3 targets [A,B,C] for AB⊥BC or 4 targets [A,B,C,D] for AB⊥CD), or parallel (4 targets [A,B,C,D]) to inspect constraint status.",
  repair_entity: "Rollback or replace a previously staged entity step.",
  repair_constraint: "Update/re-check a constraint status after repair.",
  finish_candidate: "Finalize all speculative actions into a plan envelope for independent verification. Optionally pass normalisations: [{ original, normalized }] to rewrite non-standard phrasing in the prompt into canonical geometry notation.",
  request_clarification: "ONLY use when an image-based prompt omits a required figure or a critical dimension is genuinely missing/contradictory. NEVER use on self-contained pure-text geometry problems with convex polygons (e.g. planar quad), moving points, or folded triangles: use standard convex orientation and a representative fold position satisfying the given perpendicular/parallel conditions."
}

/** The public geometry vocabulary is shared with the kernel dispatch below. */
export const SOLID_KIND_FAMILIES = {
  regular_pyramid: ["regular_pyramid", "square_pyramid", "regular_square_pyramid", "regular_quadrilateral_pyramid", "regular_triangular_pyramid"],
  tetrahedron: ["tetrahedron", "regular_tetrahedron", "triangular_pyramid"],
  prism: ["prism", "triangular_prism", "right_triangular_prism", "rectangular_prism", "square_prism", "right_prism", "regular_prism", "hexagonal_prism", "cube", "cuboid", "box"],
  perpendicular_pyramid: ["perpendicular_pyramid", "quadrilateral_pyramid", "pyramid"],
  pyramidal_frustum: ["square_frustum", "triangular_frustum", "regular_frustum", "frustum_pyramid"],
  cylinder: ["cylinder", "right_circular_cylinder"],
  cone: ["cone", "right_circular_cone"],
  round_frustum: ["round_frustum", "frustum"],
  sphere: ["sphere", "hemisphere"]
} as const

const SOLID_KINDS = Object.values(SOLID_KIND_FAMILIES).flat()

const CONSTRUCT_EQUAL_EDGE_TRIANGULAR_PRISM_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id", "displayScale"],
  properties: {
    id: { type: "string" }, displayScale: { type: "number", exclusiveMinimum: 0 },
    vertexNames: { type: "array", items: { type: "string" } },
    label: { type: "string" }, scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" }
  }
} as const

const CONSTRUCT_CIRCUMSPHERE_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["solidId"],
  properties: { solidId: { type: "string" }, mode: { type: "string", enum: ["circumsphere", "insphere"] },
    id: { type: "string" }, output: { type: "string" }, label: { type: "string" },
    scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" } }
} as const

const CONSTRUCT_SOLID_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: SOLID_KINDS },
    shape: { type: "string", enum: SOLID_KINDS },
    symbol: { type: "string", enum: ["a"] },
    displayScale: { type: "number", exclusiveMinimum: 0 },
    id: { type: "string" }, output: { type: "string" }, label: { type: "string" },
    sideLength: { type: "number", exclusiveMinimum: 0 },
    baseSide: { type: "number", exclusiveMinimum: 0 },
    edgeLength: { type: "number", exclusiveMinimum: 0 },
    height: { type: "number", exclusiveMinimum: 0 },
    slantHeight: { type: "number", exclusiveMinimum: 0 },
    lateralEdge: { type: "number", exclusiveMinimum: 0 },
    radius: { type: "number", exclusiveMinimum: 0 },
    r: { type: "number", exclusiveMinimum: 0 },
    inscribedIn: { type: "string" }, solidId: { type: "string" },
    radiusBottom: { type: "number", exclusiveMinimum: 0 },
    radiusTop: { type: "number", exclusiveMinimum: 0 },
    bottomSide: { type: "number", exclusiveMinimum: 0 },
    topSide: { type: "number", exclusiveMinimum: 0 },
    lowerSide: { type: "number", exclusiveMinimum: 0 },
    upperSide: { type: "number", exclusiveMinimum: 0 },
    a1b1: { type: "number", exclusiveMinimum: 0 },
    aa1: { type: "number", exclusiveMinimum: 0 },
    sides: { type: "number" },
    ab: { type: "number", exclusiveMinimum: 0 }, ac: { type: "number", exclusiveMinimum: 0 },
    ad: { type: "number", exclusiveMinimum: 0 }, bc: { type: "number", exclusiveMinimum: 0 },
    bd: { type: "number", exclusiveMinimum: 0 }, cd: { type: "number", exclusiveMinimum: 0 },
    pa: { type: "number", exclusiveMinimum: 0 }, pb: { type: "number", exclusiveMinimum: 0 },
    pc: { type: "number", exclusiveMinimum: 0 },
    width: { type: "number", exclusiveMinimum: 0 }, depth: { type: "number", exclusiveMinimum: 0 },
    upperBase: { type: "number", exclusiveMinimum: 0 }, lowerBase: { type: "number", exclusiveMinimum: 0 },
    topBase: { type: "number", exclusiveMinimum: 0 }, bottomBase: { type: "number", exclusiveMinimum: 0 },
    baseHeight: { type: "number", exclusiveMinimum: 0 },
    isRightTrapezoid: { type: "boolean" },
    origin: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }
    },
    vertexNames: { type: "array", items: { type: "string" } },
    baseVertexNames: { type: "array", items: { type: "string" } },
    baseLabels: { type: "array", items: { type: "string" } },
    topLabels: { type: "array", items: { type: "string" } },
    apexName: { type: "string" }, footName: { type: "string" },
    scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" }
  }
} as const

const PLANAR_ENTITY_FIELDS = {
  id: { type: "string" }, output: { type: "string" }, label: { type: "string" },
  scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" }
} as const

const DECLARE_ENTITY_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id"],
  properties: { id: { type: "string" }, kind: { type: "string" }, scopeId: { type: "string" },
    stateId: { type: "string" }, branchId: { type: "string" } }
} as const

const CONSTRUCT_CONIC_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id", "conicType"],
  properties: { ...PLANAR_ENTITY_FIELDS,
    conicType: { type: "string", enum: ["ellipse", "hyperbola", "parabola"] },
    equation: { type: "string" },
    radiusX: { type: "number", exclusiveMinimum: 0 }, radiusY: { type: "number", exclusiveMinimum: 0 },
    radius: { type: "number", exclusiveMinimum: 0 }, r: { type: "number", exclusiveMinimum: 0 },
    a: { type: "number", exclusiveMinimum: 0 }, b: { type: "number", exclusiveMinimum: 0 },
    c: { type: "number", exclusiveMinimum: 0 }, e: { type: "number", exclusiveMinimum: 0 },
    eccentricity: { type: "number", exclusiveMinimum: 0 }, p: { type: "number" },
    focalParameter: { type: "number" }, axis: { type: "string", enum: ["x", "y"] },
    throughPointIds: { type: "array", items: { type: "string" } },
    vx: { type: "number" }, vy: { type: "number" }, cx: { type: "number" }, cy: { type: "number" }
  }
} as const
const CONSTRUCT_POINT_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id"],
  properties: { ...PLANAR_ENTITY_FIELDS, x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
    position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
    from: { type: "string" }, to: { type: "string" }, ratio: { type: "number" },
    hostId: { type: "string" }, parameter: { type: "number" }, u: { type: "number" }, v: { type: "number" },
    planePoints: { type: "array", items: { type: "string" } } }
} as const
const CONSTRUCT_SEGMENT_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["from", "to"],
  properties: { ...PLANAR_ENTITY_FIELDS, from: { type: "string" }, to: { type: "string" } }
} as const
const CONSTRUCT_LINE_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id"],
  properties: { ...PLANAR_ENTITY_FIELDS, from: { type: "string" }, to: { type: "string" },
    equation: { type: "string" }, slope: { type: "number" }, k: { type: "number" }, intercept: { type: "number" },
    throughPointId: { type: "string" }, pointId: { type: "string" }, dx: { type: "number" }, dy: { type: "number" },
    conicId: { type: "string" }, chordRatio: { type: "number", exclusiveMinimum: 0 },
    branch: { type: "number" },
    a: { type: "number" }, b: { type: "number" }, c: { type: "number" } }
} as const
const CONSTRUCT_INTERSECTION_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["lineA"],
  properties: { ...PLANAR_ENTITY_FIELDS, lineA: { type: "string" }, lineB: { type: "string" },
    conicId: { type: "string" }, circleId: { type: "string" }, curveId: { type: "string" }, excludePointId: { type: "string" },
    selection: { type: "string", enum: ["min_x", "max_x", "min_y", "max_y"] } }
} as const
const CONSTRUCT_CIRCLE_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: { ...PLANAR_ENTITY_FIELDS, equation: { type: "string" }, centerId: { type: "string" },
    center: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
    cx: { type: "number" }, cy: { type: "number" },
    radius: { type: "number", exclusiveMinimum: 0 }, r: { type: "number", exclusiveMinimum: 0 } }
} as const
const CONSTRUCT_TANGENT_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: { ...PLANAR_ENTITY_FIELDS, conicId: { type: "string" }, pointId: { type: "string" }, throughPointId: { type: "string" },
    tangentPointId: { type: "string" }, branch: { type: "number" },
    selection: { type: "string", enum: ["min_x", "max_x", "min_y", "max_y"] },
    functionId: { type: "string" }, functionLabel: { type: "string" }, expression: { type: "string" }, x0: { type: "number" }, x: { type: "number" },
    domain: { type: "array", items: { type: "number" } },
    mode: { type: "string", enum: ["tangent", "derivative", "integral", "graph"] },
    includeDerivative: { type: "boolean" } }
} as const
const CONSTRUCT_PERP_PARALLEL_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["lineId", "throughPointId"],
  properties: { ...PLANAR_ENTITY_FIELDS, lineId: { type: "string" }, throughPointId: { type: "string" } }
} as const
const CONSTRUCT_PARALLEL_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["lineId"],
  properties: { ...PLANAR_ENTITY_FIELDS, lineId: { type: "string" }, throughPointId: { type: "string" },
    offsetX: { type: "number" }, offsetY: { type: "number" }, distance: { type: "number" } }
} as const
const CONSTRUCT_BASE_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: { ...PLANAR_ENTITY_FIELDS, shape: { type: "string" }, kind: { type: "string" },
    sideLength: { type: "number", exclusiveMinimum: 0 }, baseSide: { type: "number", exclusiveMinimum: 0 },
    edgeLength: { type: "number", exclusiveMinimum: 0 }, sides: { type: "number", exclusiveMinimum: 0 },
    radius: { type: "number", exclusiveMinimum: 0 }, upperBase: { type: "number", exclusiveMinimum: 0 },
    lowerBase: { type: "number", exclusiveMinimum: 0 }, baseHeight: { type: "number", exclusiveMinimum: 0 },
    width: { type: "number", exclusiveMinimum: 0 }, depth: { type: "number", exclusiveMinimum: 0 },
    ab: { type: "number", exclusiveMinimum: 0 }, bc: { type: "number", exclusiveMinimum: 0 },
    ac: { type: "number", exclusiveMinimum: 0 },
    vertexNames: { type: "array", items: { type: "string" } } }
} as const
const CONSTRUCT_FACE_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: { ...PLANAR_ENTITY_FIELDS, vertexNames: { type: "array", items: { type: "string" } },
    pointIds: { type: "array", items: { type: "string" } } }
} as const
const CONSTRUCT_FOLD_STATE_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["vertexNames", "hinge", "apex", "apexAs", "angle"],
  properties: { ...PLANAR_ENTITY_FIELDS, preStateId: { type: "string" },
    vertexNames: { type: "array", items: { type: "string" } },
    hinge: { type: "object", required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" } } },
    apex: { type: "string" }, apexAs: { type: "string" }, angle: { type: "number" } }
} as const
const ADD_RELATION_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["kind", "targets"],
  properties: { kind: { type: "string" }, targets: { type: "array", items: { type: "string" } },
    value: { type: "number" }, expression: { type: "string" }, domain: { type: "array", items: { type: "number" } },
    scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" } }
} as const
const CHOOSE_STRATEGY_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: { strategy: { type: "string" }, target: { type: "string" }, entityId: { type: "string" },
    scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" } }
} as const
const REPAIR_ACTION_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: { target: { type: "string" }, reason: { type: "string" },
    branchId: { type: "string" }, scopeId: { type: "string" }, stateId: { type: "string" } }
} as const
const FINISH_CANDIDATE_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    goal: { type: "string" },
    scopeId: { type: "string" },
    answer: { type: "string" },
    normalisations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "normalized"],
        properties: {
          original: { type: "string" },
          normalized: { type: "string" }
        }
      }
    }
  }
} as const
const REQUEST_CLARIFICATION_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: { goal: { type: "string" }, reason: { type: "string" },
    questions: { type: "array", items: { type: "string" } } }
} as const
const QUERY_MEASUREMENT_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["metric"],
  properties: { metric: { type: "string", enum: ["distance", "position", "coordinates", "area"] },
    targets: { type: "array", items: { type: "string" } }, target: { type: "string" } }
} as const
const QUERY_CONSTRAINT_STATUS_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["targets"],
  properties: { kind: { type: "string", enum: ["coplanar", "fixed_distance", "collinear", "perpendicular", "parallel"] },
    targets: { type: "array", items: { type: "string" } }, expected: { type: "number", exclusiveMinimum: 0 },
    value: { type: "number", exclusiveMinimum: 0 } }
} as const

export function buildDsActionToolSchemas(options: { includeUnimplemented?: boolean } = {}) {
  const names = options.includeUnimplemented ? DS_ACTION_TOOL_NAMES : IMPLEMENTED_DS_ACTION_TOOLS
  return names.map((name) => ({
    type: "function",
    function: {
      name,
      description: DS_ACTION_DESCRIPTIONS[name],
      parameters: name === "declare_entity" ? DECLARE_ENTITY_PARAMETERS
        : name === "add_relation" ? ADD_RELATION_PARAMETERS
        : name === "choose_strategy" ? CHOOSE_STRATEGY_PARAMETERS
        : name === "construct_solid" ? CONSTRUCT_SOLID_PARAMETERS
        : name === "construct_equal_edge_triangular_prism" ? CONSTRUCT_EQUAL_EDGE_TRIANGULAR_PRISM_PARAMETERS
        : name === "construct_circumsphere" ? CONSTRUCT_CIRCUMSPHERE_PARAMETERS
        : name === "construct_base" ? CONSTRUCT_BASE_PARAMETERS
        : name === "construct_face" ? CONSTRUCT_FACE_PARAMETERS
        : name === "construct_fold_state" ? CONSTRUCT_FOLD_STATE_PARAMETERS
        : name === "construct_circle" ? CONSTRUCT_CIRCLE_PARAMETERS
        : name === "construct_conic" ? CONSTRUCT_CONIC_PARAMETERS
        : name === "construct_tangent" ? CONSTRUCT_TANGENT_PARAMETERS
        : name === "construct_perpendicular" ? CONSTRUCT_PERP_PARALLEL_PARAMETERS
        : name === "construct_parallel" ? CONSTRUCT_PARALLEL_PARAMETERS
        : name === "construct_point" ? CONSTRUCT_POINT_PARAMETERS
        : name === "construct_line" ? CONSTRUCT_LINE_PARAMETERS
        : name === "construct_segment" ? CONSTRUCT_SEGMENT_PARAMETERS
        : name === "construct_intersection" ? CONSTRUCT_INTERSECTION_PARAMETERS
        : name === "query_measurement" ? QUERY_MEASUREMENT_PARAMETERS
        : name === "query_constraint_status" ? QUERY_CONSTRAINT_STATUS_PARAMETERS
        : name === "repair_entity" || name === "repair_constraint" ? REPAIR_ACTION_PARAMETERS
        : name === "finish_candidate" ? FINISH_CANDIDATE_PARAMETERS
        : name === "request_clarification" ? REQUEST_CLARIFICATION_PARAMETERS : {
        type: "object",
        additionalProperties: true
      }
    }
  }))
}

export function parseDsActionToolCall(
  toolName: string,
  rawInput: unknown
): DsActionToolCallParsed | DsActionToolCallInvalid {
  if (!isDsActionName(toolName)) {
    return {
      ok: false,
      status: "blocked",
      code: "unexpected_tool_call",
      detail: `tool ${toolName} is outside the closed DS action set`
    }
  }
  let inputObj: unknown = rawInput
  if (typeof rawInput === "string") {
    try {
      inputObj = JSON.parse(rawInput)
    } catch {
      return {
        ok: false,
        status: "repairable",
        code: "invalid_json",
        detail: `action ${toolName} argument must be a JSON object`
      }
    }
  }
  if (typeof inputObj !== "object" || inputObj === null || Array.isArray(inputObj)) {
    return {
      ok: false,
      status: "repairable",
      code: "invalid_schema",
      detail: `action ${toolName} argument must be a plain object`
    }
  }
  return { ok: true, name: toolName, input: inputObj as Record<string, unknown> }
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  return typeof v === "string" ? parseScalarExpr(v) : null
}

function asPositiveNumber(v: unknown): number | null {
  const n = asFiniteNumber(v)
  return n !== null && n > 0 ? n : null
}

function asStringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    const s = asString(item)
    if (!s) return null
    out.push(s)
  }
  return out
}

function parseScalarExpr(raw: string): number | null {
  let s = raw.trim().replaceAll(/\$/g, "").replaceAll(/−/g, "-").replaceAll(/\\cdot|·|×/g, "*").replaceAll(/\s+/g, "")
  if (!s) return null
  s = s.replaceAll(/\\left|\\right/g, "").replaceAll(/\\pi|π/gi, "pi").replaceAll(/²/g, "^2").replaceAll(/³/g, "^3")
  for (let i = 0; i < 4 && /\\frac\{/.test(s); i++) {
    s = s.replaceAll(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))")
  }
  s = s.replaceAll(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)").replaceAll(/√\(([^)]+)\)/g, "sqrt($1)").replaceAll(/√(\d+(?:\.\d+)?)/g, "sqrt($1)")
  let pos = 0
  const peek = () => s[pos] ?? ""
  const parseExpr = (): number | null => {
    let left = parseTerm()
    if (left === null) return null
    while (peek() === "+" || peek() === "-") {
      const op = s[pos++]!
      const right = parseTerm()
      if (right === null) return null
      left = op === "+" ? left + right : left - right
    }
    return left
  }
  const parseTerm = (): number | null => {
    let left = parsePower()
    if (left === null) return null
    while (true) {
      if (peek() === "*" || peek() === "/") {
        const op = s[pos++]!
        const right = parsePower()
        if (right === null) return null
        if (op === "/") {
          if (Math.abs(right) <= 1e-12) return null
          left /= right
        } else {
          left *= right
        }
      } else if (peek() === "(" || s.startsWith("sqrt(", pos) || s.startsWith("pi", pos)) {
        const right = parsePower()
        if (right === null) return null
        left *= right
      } else {
        break
      }
    }
    return left
  }
  const parsePower = (): number | null => {
    let base = parseFactor()
    if (base === null) return null
    if (peek() === "^") {
      pos++
      const exp = parsePower()
      if (exp === null) return null
      base = Math.pow(base, exp)
      if (!Number.isFinite(base)) return null
    }
    return base
  }
  const parseFactor = (): number | null => {
    if (peek() === "+") { pos++; return parseFactor() }
    if (peek() === "-") { pos++; const v = parsePower(); return v === null ? null : -v }
    if (s.startsWith("pi", pos)) {
      pos += 2
      return Math.PI
    }
    if (s.startsWith("sqrt(", pos)) {
      pos += 5
      const inner = parseExpr()
      if (inner === null || peek() !== ")" || inner < 0) return null
      pos++
      return Math.sqrt(inner)
    }
    if (peek() === "(") {
      pos++
      const inner = parseExpr()
      if (inner === null || peek() !== ")") return null
      pos++
      return inner
    }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(pos))
    if (!m) return null
    pos += m[0].length
    const v = Number(m[0])
    return Number.isFinite(v) ? v : null
  }
  const out = parseExpr()
  return out !== null && pos === s.length && Number.isFinite(out) ? out : null
}

function splitTopLevelSum(expr: string): string[] | null {
  const s = expr.replaceAll(/\s+/g, "").replaceAll(/−/g, "-")
  if (!s) return null
  const terms: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (depth === 0 && (ch === "+" || ch === "-") && i > start) {
      terms.push(s.slice(start, i))
      start = i
    }
  }
  terms.push(s.slice(start))
  return depth === 0 ? terms : null
}

function parseLinearEquation(raw: string): { a: number; b: number; c: number } | null {
  let cleaned = raw.trim().replaceAll(/\$/g, "").replaceAll(/\s+/g, "").replaceAll(/−/g, "-")
  cleaned = cleaned.replaceAll(/\\left|\\right/g, "")
  for (let i = 0; i < 4 && /\\frac\{/.test(cleaned); i++) {
    cleaned = cleaned.replaceAll(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))")
  }
  cleaned = cleaned
    .replaceAll(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replaceAll(/√\(([^)]+)\)/g, "sqrt($1)")
    .replaceAll(/√(\d+(?:\.\d+)?)/g, "sqrt($1)")
  const eqParts = cleaned.split("=")
  if (eqParts.length !== 2 || !eqParts[0] || !eqParts[1]) return null

  type Affine = { ax: number; ay: number; c: number }
  const parseAffine = (expr: string): Affine | null => {
    let pos = 0
    const peek = () => expr[pos] ?? ""
    const isZeroVar = (v: Affine) => Math.abs(v.ax) <= 1e-12 && Math.abs(v.ay) <= 1e-12

    const parseAdd = (): Affine | null => {
      let left = parseMul()
      if (!left) return null
      while (peek() === "+" || peek() === "-") {
        const op = expr[pos++]!
        const right = parseMul()
        if (!right) return null
        left = op === "+"
          ? { ax: left.ax + right.ax, ay: left.ay + right.ay, c: left.c + right.c }
          : { ax: left.ax - right.ax, ay: left.ay - right.ay, c: left.c - right.c }
      }
      return left
    }

    const canImplicitMul = () => {
      const ch = peek()
      return ch === "(" || ch === "x" || ch === "y" || expr.startsWith("sqrt(", pos)
    }

    const parseMul = (): Affine | null => {
      let left = parseUnary()
      if (!left) return null
      while (true) {
        if (peek() === "*" || peek() === "/") {
          const op = expr[pos++]!
          const right = parseUnary()
          if (!right) return null
          if (op === "/") {
            if (!isZeroVar(right) || Math.abs(right.c) <= 1e-12) return null
            left = { ax: left.ax / right.c, ay: left.ay / right.c, c: left.c / right.c }
          } else {
            if (isZeroVar(left)) {
              left = { ax: left.c * right.ax, ay: left.c * right.ay, c: left.c * right.c }
            } else if (isZeroVar(right)) {
              left = { ax: left.ax * right.c, ay: left.ay * right.c, c: left.c * right.c }
            } else {
              return null
            }
          }
        } else if (canImplicitMul()) {
          const right = parseUnary()
          if (!right) return null
          if (isZeroVar(left)) {
            left = { ax: left.c * right.ax, ay: left.c * right.ay, c: left.c * right.c }
          } else if (isZeroVar(right)) {
            left = { ax: left.ax * right.c, ay: left.ay * right.c, c: left.c * right.c }
          } else {
            return null
          }
        } else {
          break
        }
      }
      return left
    }

    const parseUnary = (): Affine | null => {
      if (peek() === "+") { pos++; return parseUnary() }
      if (peek() === "-") {
        pos++
        const inner = parseUnary()
        return inner ? { ax: -inner.ax, ay: -inner.ay, c: -inner.c } : null
      }
      if (peek() === "x") { pos++; return { ax: 1, ay: 0, c: 0 } }
      if (peek() === "y") { pos++; return { ax: 0, ay: 1, c: 0 } }
      if (expr.startsWith("sqrt(", pos)) {
        pos += 5
        const inner = parseAdd()
        if (!inner || peek() !== ")" || !isZeroVar(inner) || inner.c < 0) return null
        pos++
        return { ax: 0, ay: 0, c: Math.sqrt(inner.c) }
      }
      if (peek() === "(") {
        pos++
        const inner = parseAdd()
        if (!inner || peek() !== ")") return null
        pos++
        return inner
      }
      const m = /^\d+(?:\.\d+)?/.exec(expr.slice(pos))
      if (!m) return null
      pos += m[0].length
      const v = Number(m[0])
      return Number.isFinite(v) ? { ax: 0, ay: 0, c: v } : null
    }

    const out = parseAdd()
    return out && pos === expr.length && [out.ax, out.ay, out.c].every(Number.isFinite) ? out : null
  }

  const lhs = parseAffine(eqParts[0]!)
  const rhs = parseAffine(eqParts[1]!)
  if (!lhs || !rhs) return null
  const a = lhs.ax - rhs.ax
  const b = lhs.ay - rhs.ay
  const c = lhs.c - rhs.c
  return Math.abs(a) <= 1e-12 && Math.abs(b) <= 1e-12 ? null : { a, b, c }
}

type ParsedConicEquation =
  | { conicType: "circle"; cx: number; cy: number; radius: number }
  | { conicType: "ellipse" | "hyperbola"; cx: number; cy: number; radiusX: number; radiusY: number; axis: "x" | "y" }
  | { conicType: "parabola"; vx: number; vy: number; focalParameter: number; axis: "x" | "y" }

function parseConicEquation(raw: string): ParsedConicEquation | null {
  let cleaned = raw
    .trim()
    .replaceAll(/\$/g, "")
    .replaceAll(/\\left|\\right/g, "")
    .replaceAll(/\\cdot|·|×/g, "*")
    .replaceAll(/\s+/g, "")
    .replaceAll(/²/g, "^2")
    .replaceAll(/−/g, "-")
  for (let i = 0; i < 4 && /\\frac\{/.test(cleaned); i++) {
    cleaned = cleaned.replaceAll(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
  }
  // Unwrap redundant parens around squared variable monomials created by `\frac{x^2}{4}` -> `(x^2)/(4)`
  cleaned = cleaned
    .replaceAll(/\(([xy]\^2)\)/g, "$1")
    .replaceAll(/\((\([xy][+-][^()]+\)\^2)\)/g, "$1")
    .replaceAll(/\/\((\d+(?:\.\d+)?)\)/g, "/$1")
  const eqParts = cleaned.split("=")
  if (eqParts.length !== 2 || !eqParts[0] || !eqParts[1]) return null
  const [lhsRaw, rhsRaw] = [eqParts[0]!, eqParts[1]!]

  const matchParabola = (left: string, right: string): ParsedConicEquation | null => {
    const mY = /^(?:\(y([+-][^)]+)\)|y)\^2$/.exec(left)
    const mX = /^(?:\(x([+-][^)]+)\)|x)\^2$/.exec(left)
    if (mY) {
      const vy = mY[1] ? -(parseScalarExpr(mY[1]) ?? Number.NaN) : 0
      const mRhs = /^(.+?)\*?(?:\(x([+-][^)]+)\)|x)$/.exec(right) ?? (/^x$/.test(right) ? ["x", "1", ""] : null)
      if (mRhs && Number.isFinite(vy)) {
        const k = parseScalarExpr(mRhs[1]!.replace(/\*$/, "") || "1")
        const vx = mRhs[2] ? -(parseScalarExpr(mRhs[2]) ?? Number.NaN) : 0
        if (k !== null && Math.abs(k) > 1e-12 && Number.isFinite(vx)) {
          return { conicType: "parabola", vx, vy, focalParameter: k / 2, axis: "x" }
        }
      }
    }
    if (mX) {
      const vx = mX[1] ? -(parseScalarExpr(mX[1]) ?? Number.NaN) : 0
      const mRhs = /^(.+?)\*?(?:\(y([+-][^)]+)\)|y)$/.exec(right) ?? (/^y$/.test(right) ? ["y", "1", ""] : null)
      if (mRhs && Number.isFinite(vx)) {
        const k = parseScalarExpr(mRhs[1]!.replace(/\*$/, "") || "1")
        const vy = mRhs[2] ? -(parseScalarExpr(mRhs[2]) ?? Number.NaN) : 0
        if (k !== null && Math.abs(k) > 1e-12 && Number.isFinite(vy)) {
          return { conicType: "parabola", vx, vy, focalParameter: k / 2, axis: "y" }
        }
      }
    }
    return null
  }
  const directParabola = matchParabola(lhsRaw, rhsRaw) ?? matchParabola(rhsRaw, lhsRaw)
  if (directParabola) return directParabola

  const parseQuadSide = (side: string, sign: number) => {
    const terms = splitTopLevelSum(side)
    if (!terms) return null
    let ax = 0, ay = 0, dx = 0, dy = 0, c = 0
    let shiftCx: number | null = null
    let shiftCy: number | null = null
    for (const term of terms) {
      const mSqShift = /^([+-]?[^()]*?)\*?\(([xy])([+-][^)]+)\)\^2(?:\/(.+))?$/.exec(term)
      if (mSqShift) {
        const pre = mSqShift[1] ?? ""
        const sym = mSqShift[2]!
        const off = parseScalarExpr(mSqShift[3]!)
        const denom = mSqShift[4] ? parseScalarExpr(mSqShift[4]) : 1
        const num = pre === "" || pre === "+" ? 1 : pre === "-" ? -1 : parseScalarExpr(pre)
        if (off === null || denom === null || num === null || Math.abs(denom) <= 1e-12) return null
        const k = sign * num / denom
        if (sym === "x") { ax += k; shiftCx = -off } else { ay += k; shiftCy = -off }
        continue
      }
      const mSq = /^([+-]?.*?)\*?([xy])\^2(?:\/(.+))?$/.exec(term)
      if (mSq) {
        const pre = mSq[1] ?? ""
        const sym = mSq[2]!
        const denom = mSq[3] ? parseScalarExpr(mSq[3]) : 1
        const num = pre === "" || pre === "+" ? 1 : pre === "-" ? -1 : parseScalarExpr(pre)
        if (denom === null || num === null || Math.abs(denom) <= 1e-12) return null
        const k = sign * num / denom
        if (sym === "x") ax += k
        else ay += k
        continue
      }
      const mLin = /^([+-]?.*?)\*?([xy])(?:\/([^xy]+))?$/.exec(term)
      if (mLin) {
        const pre = mLin[1] ?? ""
        const sym = mLin[2]!
        const denom = mLin[3] ? parseScalarExpr(mLin[3]) : 1
        const num = pre === "" || pre === "+" ? 1 : pre === "-" ? -1 : parseScalarExpr(pre)
        if (denom === null || num === null || Math.abs(denom) <= 1e-12) return null
        const k = sign * num / denom
        if (sym === "x") dx += k
        else dy += k
        continue
      }
      const val = parseScalarExpr(term)
      if (val === null) return null
      c += sign * val
    }
    return { ax, ay, dx, dy, c, shiftCx, shiftCy }
  }

  const lq = parseQuadSide(lhsRaw, 1)
  const rq = parseQuadSide(rhsRaw, -1)
  if (!lq || !rq) return null
  const ax = lq.ax + rq.ax
  const ay = lq.ay + rq.ay
  const dx = lq.dx + rq.dx
  const dy = lq.dy + rq.dy
  const c = lq.c + rq.c
  const cx = lq.shiftCx ?? rq.shiftCx ?? (Math.abs(ax) > 1e-12 ? -dx / (2 * ax) : 0)
  const cy = lq.shiftCy ?? rq.shiftCy ?? (Math.abs(ay) > 1e-12 ? -dy / (2 * ay) : 0)
  const rhs =
    lq.shiftCx !== null || lq.shiftCy !== null || rq.shiftCx !== null || rq.shiftCy !== null
      ? -c
      : ax * cx * cx + ay * cy * cy - c

  if (Math.abs(ax - ay) <= 1e-9 && ax > 1e-12 && rhs > 0) {
    return { conicType: "circle", cx, cy, radius: Math.sqrt(rhs / ax) }
  }
  if (Math.abs(ax - ay) <= 1e-9 && ax < -1e-12 && rhs < 0) {
    return { conicType: "circle", cx, cy, radius: Math.sqrt(rhs / ax) }
  }
  if (Math.abs(ax) > 1e-12 && Math.abs(ay) > 1e-12) {
    const sx = ax / rhs
    const sy = ay / rhs
    if (sx > 0 && sy > 0) {
      return { conicType: "ellipse", cx, cy, radiusX: Math.sqrt(1 / sx), radiusY: Math.sqrt(1 / sy), axis: "x" }
    }
    if (sx > 0 && sy < 0) {
      return { conicType: "hyperbola", cx, cy, radiusX: Math.sqrt(1 / sx), radiusY: Math.sqrt(-1 / sy), axis: "x" }
    }
    if (sx < 0 && sy > 0) {
      return { conicType: "hyperbola", cx, cy, radiusX: Math.sqrt(-1 / sx), radiusY: Math.sqrt(1 / sy), axis: "y" }
    }
  }
  if (Math.abs(ax) > 1e-12 && Math.abs(ay) <= 1e-12 && Math.abs(dy) > 1e-12) {
    const vx = lq.shiftCx ?? rq.shiftCx ?? -dx / (2 * ax)
    const remC = c - (lq.shiftCx !== null || rq.shiftCx !== null ? 0 : ax * vx * vx)
    const vy = -remC / dy
    const focalParameter = (-dy / ax) / 2
    if (Number.isFinite(vx) && Number.isFinite(vy) && Math.abs(focalParameter) > 1e-12) {
      return { conicType: "parabola", vx, vy, focalParameter, axis: "y" }
    }
  }
  if (Math.abs(ay) > 1e-12 && Math.abs(ax) <= 1e-12 && Math.abs(dx) > 1e-12) {
    const vy = lq.shiftCy ?? rq.shiftCy ?? -dy / (2 * ay)
    const remC = c - (lq.shiftCy !== null || rq.shiftCy !== null ? 0 : ay * vy * vy)
    const vx = -remC / dx
    const focalParameter = (-dx / ay) / 2
    if (Number.isFinite(vx) && Number.isFinite(vy) && Math.abs(focalParameter) > 1e-12) {
      return { conicType: "parabola", vx, vy, focalParameter, axis: "x" }
    }
  }
  return null
}

type SolidResolution =
  | { ok: true; mode: "constraint3d"; request: ConstraintSolve3dRequest; explicitNames?: string[] }
  | {
      ok: true
      mode: "polyhedron"
      pointRegistry: Record<string, Vector3>
      vertices: Vector3[]
      vertexNames: string[]
      faces: number[][]
    }
  | {
      ok: true
      mode: "template"
      actionId: "solid.create_template" | "solid.create_round_frustum" | "solid.create_sphere"
      inputs: Record<string, unknown>
    }
  | {
      ok: true
      mode: "insphere"
      solidId?: string
    }
  | { ok: false; status: "repairable" | "blocked"; blockerCode: string; repairHint: string }

function resolveBasePolygonFromParams(
  kind: string,
  input: Record<string, unknown>,
  points3: ReadonlyMap<string, Vector3>,
  problemText?: string
):
  | { ok: true; baseVertices: NamedVertex3[]; defaultTopPrefix?: boolean }
  | { ok: false; status: "repairable" | "blocked"; blockerCode: string; repairHint: string } {
  const baseRefs = asStringList(input.baseVertexNames ?? input.baseLabels)
  const vList = asStringList(input.vertexNames)
  const wantTriangle =
    kind === "triangular_prism" ||
    kind === "tetrahedron" ||
    vList?.length === 6 ||
    baseRefs?.length === 3 ||
    (asPositiveNumber(input.ab) !== null && asPositiveNumber(input.ac) !== null && asPositiveNumber(input.bc) !== null)
  const side = asPositiveNumber(input.sideLength ?? input.baseSide ?? input.edgeLength)
  const sidesCount = asPositiveNumber(input.sides)
  if (baseRefs && Array.isArray(input.baseVertexNames)) {
    if (baseRefs.length < 3) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "baseVertexNames requires at least 3 distinct point names" }
    }
    const baseVertices: NamedVertex3[] = []
    let missingName: string | null = null
    for (const name of baseRefs) {
      const pt = points3.get(name)
      if (!pt) {
        missingName = name
        break
      }
      baseVertices.push({ name, point: pt })
    }
    if (!missingName) {
      return { ok: true, baseVertices }
    }
    const hasDimensionFallback =
      (sidesCount !== null && Number.isInteger(sidesCount) && sidesCount >= 3 && (side !== null || asPositiveNumber(input.radius) !== null)) ||
      (side !== null && !wantTriangle && asPositiveNumber(input.width ?? input.ab) === null) ||
      (asPositiveNumber(input.width ?? input.ab) !== null && asPositiveNumber(input.depth ?? input.bc) !== null)
    if (!hasDimensionFallback) {
      return {
        ok: false,
        status: "repairable",
        blockerCode: "undeclared_entity_ref",
        repairHint: `base point "${missingName}" has no 3D coordinates yet; call construct_point(id="${missingName}", x, y, z) BEFORE construct_solid (declare_entity does not provide coordinates), or pass sideLength/sides`
      }
    }
  }
  if (sidesCount !== null && Number.isInteger(sidesCount) && sidesCount >= 3) {
    const r = asPositiveNumber(input.radius) ?? (side !== null ? side / (2 * Math.sin(Math.PI / sidesCount)) : null)
    if (r === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "regular polygon base requires positive sideLength or radius" }
    }
    const defaultLetters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    const names = baseRefs && baseRefs.length === sidesCount
      ? baseRefs
      : Array.from({ length: sidesCount }, (_, i) => defaultLetters[i] ?? `V${i + 1}`)
    const baseVertices: NamedVertex3[] = names.map((name, i) => {
      const theta = (2 * Math.PI * i) / sidesCount
      return { name, point: { x: r * Math.cos(theta), y: r * Math.sin(theta), z: 0 } }
    })
    return { ok: true, baseVertices }
  }

  const upperBase = asPositiveNumber(input.upperBase ?? input.topBase)
  const lowerBase = asPositiveNumber(input.lowerBase ?? input.bottomBase)
  const baseHeight = asPositiveNumber(input.baseHeight)
  if (upperBase !== null && lowerBase !== null && (baseHeight !== null || side !== null)) {
    const names = baseRefs && baseRefs.length === 4 ? baseRefs : ["A", "B", "C", "D"]
    const h = baseHeight ?? side!
    const offset = input.isRightTrapezoid === false ? (lowerBase - upperBase) / 2 : 0
    return {
      ok: true,
      baseVertices: [
        { name: names[0]!, point: { x: 0, y: 0, z: 0 } },
        { name: names[1]!, point: { x: lowerBase, y: 0, z: 0 } },
        { name: names[2]!, point: { x: offset + upperBase, y: h, z: 0 } },
        { name: names[3]!, point: { x: offset, y: h, z: 0 } }
      ]
    }
  }

  const w = asPositiveNumber(input.width ?? input.ab)
  const d = asPositiveNumber(input.depth ?? input.bc)
  if (wantTriangle) {
    const ab = asPositiveNumber(input.ab ?? side)
    const bc = asPositiveNumber(input.bc ?? side)
    const ac = asPositiveNumber(input.ac ?? side)
    const names = baseRefs && baseRefs.length === 3 ? baseRefs : ["A", "B", "C"]
    if (ab !== null && ac !== null && bc !== null) {
      const xC = (ac * ac + ab * ab - bc * bc) / (2 * ab)
      const ySq = ac * ac - xC * xC
      if (!(ySq > 1e-12)) {
        return { ok: false, status: "blocked", blockerCode: "infeasible", repairHint: "base triangle side lengths violate triangle inequality" }
      }
      return {
        ok: true,
        baseVertices: [
          { name: names[0]!, point: { x: 0, y: 0, z: 0 } },
          { name: names[1]!, point: { x: ab, y: 0, z: 0 } },
          { name: names[2]!, point: { x: xC, y: Math.sqrt(ySq), z: 0 } }
        ]
      }
    }
    if (ab !== null && bc !== null) {
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const n0 = escapeRegExp(names[0]!)
      const n1 = escapeRegExp(names[1]!)
      const n2 = escapeRegExp(names[2]!)
      const rightAtB =
        problemText !== undefined &&
        new RegExp(
          `${n0}${n1}\\s*(?:[⊥┴]|\\\\perp)\\s*${n1}${n2}|${n1}${n2}\\s*(?:[⊥┴]|\\\\perp)\\s*${n0}${n1}|(?:∠|\\\\angle)\\s*(?:${n0}${n1}${n2}|${n1})\\s*=\\s*90`,
          "i"
        ).test(problemText)
      return {
        ok: true,
        baseVertices: [
          { name: names[0]!, point: { x: 0, y: 0, z: 0 } },
          { name: names[1]!, point: { x: ab, y: 0, z: 0 } },
          { name: names[2]!, point: { x: rightAtB ? ab : 0, y: bc, z: 0 } }
        ]
      }
    }
    return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "triangular base requires positive sideLength or edge lengths" }
  }

  const quadW = w ?? side
  const quadD = d ?? side ?? quadW
  if (quadW === null || quadD === null) {
    return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "base requires positive sideLength or width and depth" }
  }
  const names = baseRefs && baseRefs.length === 4 ? baseRefs : ["A", "B", "C", "D"]
  return {
    ok: true,
    baseVertices: [
      { name: names[0]!, point: { x: 0, y: 0, z: 0 } },
      { name: names[1]!, point: { x: quadW, y: 0, z: 0 } },
      { name: names[2]!, point: { x: quadW, y: quadD, z: 0 } },
      { name: names[3]!, point: { x: 0, y: quadD, z: 0 } }
    ]
  }
}

/** A dimension symbol in the problem is not an actual numeric dimension. */
function hasEqualEdgeSymbolA(text: string): boolean {
  return /\u6240\u6709\u68f1\u957f\u90fd\u4e3a\s*\$?a\b/i.test(text) ||
    /(?:edge(?:s)?\s+(?:have\s+)?length|all\s+edges).*\ba\b/i.test(text)
}

/** Constructing a right prism needs an affirmative rightness condition, not just equal edges. */
function hasRightTriangularPrismSource(text: string): boolean {
  if (/\b(?:oblique|non[- ]right|not\s+(?:a\s+)?right)\b/i.test(text) ||
      /lateral\s+edges?\s+(?:are\s+)?not\s+perpendicular/i.test(text) ||
      /(?:\u659c\u4e09\u68f1\u67f1|\u4fa7\u68f1\u4e0d\u5782\u76f4|\u4fa7\u68f1\u4e0d\u22a5)/.test(text)) return false
  return /(?:\u4fa7\u68f1\s*\u5782\u76f4\u4e8e\s*\u5e95\u9762|\u76f4\u4e09\u68f1\u67f1|\u6b63\u4e09\u68f1\u67f1)/.test(text) ||
    /\bright\s+triangular\s+prism\b/i.test(text) ||
    /lateral\s+edges?\s+(?:are\s+)?perpendicular\s+to\s+(?:the\s+|its\s+)?base/i.test(text)
}

function readOriginVector3(raw: unknown): Vector3 {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    return {
      x: asFiniteNumber(obj.x) ?? 0,
      y: asFiniteNumber(obj.y) ?? 0,
      z: asFiniteNumber(obj.z) ?? 0
    }
  }
  return { x: 0, y: 0, z: 0 }
}

/**
 * Computes the Chebyshev maximum inscribed ball of a convex polyhedron and refines
 * along any non-tight directions (maximizing non-tight face distances) so bounded prisms
 * whose height limits radius below the base inradius still center at the exact base incenter.
 */
function solveMaxInscribedBall3(boundary: SolidBoundary): { center: Vector3; radius: number } | null {
  const vertices = boundary.vertices
  if (vertices.length < 4 || boundary.faces.length < 4) return null
  const centroid = vertices.reduce(
    (sum, v) => ({ x: sum.x + v.x / vertices.length, y: sum.y + v.y / vertices.length, z: sum.z + v.z / vertices.length }),
    { x: 0, y: 0, z: 0 }
  )
  let scale = 1
  for (const v of vertices) {
    scale = Math.max(scale, Math.hypot(v.x - centroid.x, v.y - centroid.y, v.z - centroid.z))
  }
  const planes: Array<{ normal: Vector3; constant: number }> = []
  for (const face of boundary.faces) {
    if (face.length < 3) continue
    const pts = face.map((idx) => vertices[idx]).filter((p): p is Vector3 => p !== undefined)
    if (pts.length < 3) continue
    let rawPlane: { normal: Vector3; constant: number } | null = null
    for (let i = 1; i + 1 < pts.length && !rawPlane; i += 1) {
      rawPlane = planeFromPoints(pts[0]!, pts[i]!, pts[i + 1]!)
    }
    if (!rawPlane) continue
    const faceCenter = pts.reduce(
      (sum, p) => ({ x: sum.x + p.x / pts.length, y: sum.y + p.y / pts.length, z: sum.z + p.z / pts.length }),
      { x: 0, y: 0, z: 0 }
    )
    const outwardDot =
      rawPlane.normal.x * (faceCenter.x - centroid.x) +
      rawPlane.normal.y * (faceCenter.y - centroid.y) +
      rawPlane.normal.z * (faceCenter.z - centroid.z)
    planes.push(
      outwardDot < 0
        ? { normal: { x: -rawPlane.normal.x, y: -rawPlane.normal.y, z: -rawPlane.normal.z }, constant: -rawPlane.constant }
        : rawPlane
    )
  }
  if (planes.length < 4) return null

  const distancesAt = (pt: Vector3) =>
    planes.map((pl) => -(pl.normal.x * pt.x + pl.normal.y * pt.y + pl.normal.z * pt.z + pl.constant))
  const minDistanceAt = (pt: Vector3) => Math.min(...distancesAt(pt))
  const baseDirections: Vector3[] = []
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        const len = Math.hypot(dx, dy, dz)
        baseDirections.push({ x: dx / len, y: dy / len, z: dz / len })
      }
    }
  }

  let current = { ...centroid }
  let best = minDistanceAt(current)
  if (!Number.isFinite(best)) return null
  const tol = scale * 1e-8
  let step = scale * 0.5
  while (step > tol) {
    let improved = false
    for (const dir of baseDirections) {
      const cand = { x: current.x + dir.x * step, y: current.y + dir.y * step, z: current.z + dir.z * step }
      const val = minDistanceAt(cand)
      if (Number.isFinite(val) && val > best + 1e-12 * scale) {
        current = cand
        best = val
        improved = true
        break
      }
    }
    if (!improved) step *= 0.5
  }
  if (!(best > scale * 1e-7)) return null

  const curDists = distancesAt(current)
  const rMax = Math.min(...curDists)
  const looseMask = curDists.map((d) => d > rMax + scale * 1e-4)
  if (looseMask.some(Boolean)) {
    const dirs2: Vector3[] = [...baseDirections]
    for (let i = 0; i < planes.length; i += 1) {
      if (looseMask[i]) continue
      const n = planes[i]!.normal
      for (const dir of baseDirections) {
        const dot = dir.x * n.x + dir.y * n.y + dir.z * n.z
        const px = dir.x - dot * n.x
        const py = dir.y - dot * n.y
        const pz = dir.z - dot * n.z
        const pLen = Math.hypot(px, py, pz)
        if (pLen > 1e-3) dirs2.push({ x: px / pLen, y: py / pLen, z: pz / pLen })
      }
    }
    const minLoose = (dists: number[]) => {
      let m = Infinity
      for (let i = 0; i < dists.length; i += 1) {
        if (looseMask[i] && dists[i]! < m) m = dists[i]!
      }
      return m
    }
    let bestLoose = minLoose(curDists)
    let step2 = scale * 0.5
    while (step2 > tol) {
      let improved = false
      for (const dir of dirs2) {
        const cand = { x: current.x + dir.x * step2, y: current.y + dir.y * step2, z: current.z + dir.z * step2 }
        const dists = distancesAt(cand)
        if (Math.min(...dists) + scale * 1e-7 < rMax) continue
        const looseVal = minLoose(dists)
        if (looseVal > bestLoose + 1e-11 * scale) {
          current = cand
          bestLoose = looseVal
          improved = true
          break
        }
      }
      if (!improved) step2 *= 0.5
    }
  }
  const finalRadius = minDistanceAt(current)
  return Number.isFinite(finalRadius) && finalRadius > scale * 1e-7 ? { center: current, radius: finalRadius } : null
}

function resolveConstructSolidRequest(
  input: Record<string, unknown>,
  points3: ReadonlyMap<string, Vector3>,
  problemText?: string
): SolidResolution {
  if (Array.isArray(input.vertices)) {
    return {
      ok: false,
      status: "blocked",
      blockerCode: "hand_computed_vertices_forbidden",
      repairHint: "never pass hand-computed vertices; pass parametric shape parameters"
    }
  }
  const unknownField = Object.keys(input).find((key) => !(key in CONSTRUCT_SOLID_PARAMETERS.properties))
  if (unknownField !== undefined) {
    return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `construct_solid does not accept field "${unknownField}"` }
  }
  const preVertexNames = asStringList(input.vertexNames)
  const rawKind =
    asString(input.kind ?? input.shape) ??
    (preVertexNames && preVertexNames.length >= 4 && preVertexNames.every((vn) => points3.has(vn))
      ? preVertexNames.length === 4 ? "tetrahedron" : "pyramid"
      : null)
  if (!rawKind) {
    return {
      ok: false,
      status: "repairable",
      blockerCode: "missing_required_parameter",
      repairHint: "construct_solid requires kind (regular_pyramid | prism | perpendicular_pyramid | tetrahedron | cube | cylinder | cone | round_frustum | sphere)"
    }
  }
  const kind = rawKind.toLowerCase()
  for (const dimKey of ["sideLength", "edgeLength", "height", "radius", "r", "radiusBottom", "radiusTop", "bottomSide", "topSide", "width", "depth", "baseSide", "slantHeight", "lateralEdge"] as const) {
    if (input[dimKey] !== undefined && asPositiveNumber(input[dimKey]) === null) {
      return {
        ok: false,
        status: "repairable",
        blockerCode: "invalid_schema",
        repairHint: `${dimKey} must be a positive finite number`
      }
    }
  }
  const vNames = asStringList(input.vertexNames)
  if (input.vertexNames !== undefined && (!vNames || new Set(vNames).size !== vNames.length)) {
    return {
      ok: false,
      status: "repairable",
      blockerCode: "duplicate_vertex_name",
      repairHint: "vertexNames must contain distinct non-empty names"
    }
  }
  if (vNames) {
    const badVertex = vNames.find((vn) => !isPointName(canonicalPointName(vn)))
    if (badVertex !== undefined) {
      const suggested = /^[A-Z]/.test(badVertex) ? `${badVertex[0]}′` : "P"
      return {
        ok: false,
        status: "repairable",
        blockerCode: "invalid_point_name",
        repairHint: `Invalid vertex name "${badVertex}" in vertexNames: every vertex name must be a single uppercase letter plus up to 2 primes/subscripts (e.g. "${suggested}", "A₁", "B′"), never multi-letter identifiers.`
      }
    }
  }

  if ((SOLID_KIND_FAMILIES.cylinder as readonly string[]).includes(kind) || (SOLID_KIND_FAMILIES.cone as readonly string[]).includes(kind)) {
    const isCylinder = (SOLID_KIND_FAMILIES.cylinder as readonly string[]).includes(kind)
    const radius = asPositiveNumber(input.radius ?? input.r ?? input.sideLength)
    const directHeight = asPositiveNumber(input.height)
    const slant = !isCylinder ? asPositiveNumber(input.slantHeight ?? input.lateralEdge) : null
    if (!isCylinder && directHeight === null && radius !== null && slant !== null && slant <= radius) {
      return { ok: false, status: "repairable", blockerCode: "infeasible", repairHint: `${rawKind} slantHeight (${slant}) must be strictly greater than radius (${radius})` }
    }
    const height = directHeight ?? (!isCylinder && radius !== null && slant !== null ? Math.sqrt(slant * slant - radius * radius) : null)
    if (radius === null || height === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive radius and height${isCylinder ? "" : " (or slantHeight > radius)"}` }
    }
    return {
      ok: true,
      mode: "template",
      actionId: "solid.create_template",
      inputs: {
        template: isCylinder ? "cylinder" : "cone",
        origin: readOriginVector3(input.origin),
        radius,
        height
      }
    }
  }

  if ((SOLID_KIND_FAMILIES.round_frustum as readonly string[]).includes(kind)) {
    const radiusBottom = asPositiveNumber(input.radiusBottom ?? input.radius)
    const radiusTop = asPositiveNumber(input.radiusTop)
    const slant = asPositiveNumber(input.slantHeight ?? input.lateralEdge)
    const directHeight = asPositiveNumber(input.height)
    const height = directHeight ?? (
      radiusBottom !== null && radiusTop !== null && slant !== null && slant > Math.abs(radiusBottom - radiusTop)
        ? Math.sqrt(slant * slant - (radiusBottom - radiusTop) ** 2)
        : null
    )
    if (radiusBottom === null || radiusTop === null || height === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive radiusBottom, radiusTop, and height (or slantHeight > |radiusBottom - radiusTop|)` }
    }
    return {
      ok: true,
      mode: "template",
      actionId: "solid.create_round_frustum",
      inputs: { center: readOriginVector3(input.origin), radiusBottom, radiusTop, height }
    }
  }

  if ((SOLID_KIND_FAMILIES.sphere as readonly string[]).includes(kind)) {
    const inscribedHost = asString(input.inscribedIn ?? input.solidId)
    if (inscribedHost !== null) {
      return { ok: true, mode: "insphere", solidId: inscribedHost }
    }
    const radius = asPositiveNumber(input.radius ?? input.r ?? input.edgeLength ?? input.sideLength)
    if (radius === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive radius or inscribedIn solidId` }
    }
    return {
      ok: true,
      mode: "template",
      actionId: "solid.create_sphere",
      inputs: { center: readOriginVector3(input.origin), radius }
    }
  }

  const buildPyramidFromPoints3 = (candidateNames: readonly string[], preferredApex?: string): SolidResolution | null => {
    if (candidateNames.length < 4 || new Set(candidateNames).size !== candidateNames.length) return null
    const pts = candidateNames.map((vn) => points3.get(vn))
    if (!pts.every((p): p is Vector3 => p !== undefined)) return null
    const apexCandidates = preferredApex && candidateNames.includes(preferredApex)
      ? [candidateNames.indexOf(preferredApex)]
      : [0, candidateNames.length - 1]
    for (const apexIdx of apexCandidates) {
      const baseIndices = candidateNames.map((_, idx) => idx).filter((idx) => idx !== apexIdx)
      if (baseIndices.length < 3) continue
      const bPlane = planeFromPoints(pts[baseIndices[0]!]!, pts[baseIndices[1]!]!, pts[baseIndices[2]!]!)
      if (!bPlane) continue
      const maxBaseDev = Math.max(...baseIndices.map((idx) => {
        const p = pts[idx]!
        return Math.abs(bPlane.normal.x * p.x + bPlane.normal.y * p.y + bPlane.normal.z * p.z + bPlane.constant)
      }))
      const apexPt = pts[apexIdx]!
      const apexDist = Math.abs(bPlane.normal.x * apexPt.x + bPlane.normal.y * apexPt.y + bPlane.normal.z * apexPt.z + bPlane.constant)
      if (maxBaseDev > 1e-3 || apexDist <= 1e-5) continue
      const nVec = bPlane.normal
      const centroid = baseIndices.reduce(
        (acc, idx) => ({
          x: acc.x + pts[idx]!.x / baseIndices.length,
          y: acc.y + pts[idx]!.y / baseIndices.length,
          z: acc.z + pts[idx]!.z / baseIndices.length
        }),
        { x: 0, y: 0, z: 0 }
      )
      const firstOff = { x: pts[baseIndices[0]!]!.x - centroid.x, y: pts[baseIndices[0]!]!.y - centroid.y, z: pts[baseIndices[0]!]!.z - centroid.z }
      const uLen = Math.hypot(firstOff.x, firstOff.y, firstOff.z)
      if (!(uLen > 1e-9)) continue
      const u = { x: firstOff.x / uLen, y: firstOff.y / uLen, z: firstOff.z / uLen }
      const v = {
        x: nVec.y * u.z - nVec.z * u.y,
        y: nVec.z * u.x - nVec.x * u.z,
        z: nVec.x * u.y - nVec.y * u.x
      }
      const orderedBase = [...baseIndices].sort((ia, ib) => {
        const da = { x: pts[ia]!.x - centroid.x, y: pts[ia]!.y - centroid.y, z: pts[ia]!.z - centroid.z }
        const db = { x: pts[ib]!.x - centroid.x, y: pts[ib]!.y - centroid.y, z: pts[ib]!.z - centroid.z }
        return Math.atan2(da.x * v.x + da.y * v.y + da.z * v.z, da.x * u.x + da.y * u.y + da.z * u.z) -
          Math.atan2(db.x * v.x + db.y * v.y + db.z * v.z, db.x * u.x + db.y * u.y + db.z * u.z)
      })
      const apexOffset = { x: apexPt.x - centroid.x, y: apexPt.y - centroid.y, z: apexPt.z - centroid.z }
      const dotApex = nVec.x * apexOffset.x + nVec.y * apexOffset.y + nVec.z * apexOffset.z
      const baseFace = dotApex > 0 ? [...orderedBase].reverse() : orderedBase
      const lateralFaces = baseFace.map((bi, idx) => [apexIdx, baseFace[(idx + baseFace.length - 1) % baseFace.length]!, bi])
      const pointRegistry: Record<string, Vector3> = {}
      candidateNames.forEach((vn, idx) => { pointRegistry[vn] = pts[idx]! })
      return {
        ok: true,
        mode: "polyhedron",
        pointRegistry,
        vertices: pts,
        vertexNames: [...candidateNames],
        faces: [baseFace, ...lateralFaces]
      }
    }
    return null
  }

  const isApexFirstVertexNames = (names: readonly string[], apexHint: string | null): boolean => {
    if (names.length < 4) return false
    const first = names[0]!
    const last = names[names.length - 1]!
    if (apexHint && first === apexHint && last !== apexHint) return true
    if (apexHint && last === apexHint && first !== apexHint) return false
    if (typeof problemText === "string") {
      const rest = names.slice(1).join("")
      const hyphenRe = new RegExp(`(?<![A-Za-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-−–]\\s*${rest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`)
      if (hyphenRe.test(problemText)) return true
    }
    return false
  }

  const wantsTrapezoidBase = input.upperBase !== undefined || input.lowerBase !== undefined || input.baseHeight !== undefined
  if ((SOLID_KIND_FAMILIES.regular_pyramid as readonly string[]).includes(kind) && !wantsTrapezoidBase) {
    const baseRefs = asStringList(input.baseVertexNames ?? input.baseLabels)
    const sides = asPositiveNumber(input.sides)
    const isTriangular = kind === "regular_triangular_pyramid" || sides === 3 || vNames?.length === 4 || baseRefs?.length === 3
    const r = asPositiveNumber(input.radius ?? input.r)
    const side = asPositiveNumber(input.sideLength ?? input.baseSide ?? input.ab)
      ?? (r !== null ? (isTriangular ? r * Math.sqrt(3) : r * Math.SQRT2) : null)
    if (side === null) {
      const explicitApex = asString(input.apexName) ?? undefined
      const matNames = vNames && vNames.length >= 4
        ? vNames
        : baseRefs && baseRefs.length >= 3
          ? [explicitApex ?? "P", ...baseRefs]
          : null
      const built = matNames ? buildPyramidFromPoints3(matNames, explicitApex) : null
      if (built) return built
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive sideLength, baseSide, or base circumradius radius` }
    }
    const directLat = asPositiveNumber(input.lateralEdge)
    const height = asPositiveNumber(input.height)
    const circumR = isTriangular ? side / Math.sqrt(3) : (side * Math.SQRT2) / 2
    const lateral = directLat ?? (height !== null ? Math.hypot(height, circumR) : null)
    if (lateral === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive height or lateralEdge` }
    }
    const apexFirst = vNames ? isApexFirstVertexNames(vNames, asString(input.apexName)) : false
    if (isTriangular) {
      if (vNames && vNames.length !== 4) {
        return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `triangular ${rawKind} vertexNames must have length 4` }
      }
      const names: readonly [string, string, string, string] = vNames
        ? (apexFirst
            ? [vNames[0]!, vNames[1]!, vNames[2]!, vNames[3]!]
            : [vNames[3]!, vNames[0]!, vNames[1]!, vNames[2]!])
        : [asString(input.apexName) ?? "P", baseRefs?.[0] ?? "A", baseRefs?.[1] ?? "B", baseRefs?.[2] ?? "C"]
      return {
        ok: true,
        mode: "constraint3d",
        request: { kind: "tetrahedron", names, ab: side, ac: side, bc: side, pa: lateral, pb: lateral, pc: lateral },
        ...(vNames ? { explicitNames: vNames } : {})
      }
    }
    if (vNames && vNames.length !== 5) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `${rawKind} vertexNames must have length 5` }
    }
    const baseLabels = vNames
      ? (apexFirst
          ? ([vNames[1]!, vNames[2]!, vNames[3]!, vNames[4]!] as const)
          : ([vNames[0]!, vNames[1]!, vNames[2]!, vNames[3]!] as const))
      : baseRefs && baseRefs.length === 4
        ? ([baseRefs[0]!, baseRefs[1]!, baseRefs[2]!, baseRefs[3]!] as const)
        : (["A", "B", "C", "D"] as const)
    const apexName = vNames ? (apexFirst ? vNames[0]! : vNames[4]!) : (asString(input.apexName) ?? "P")
    return {
      ok: true,
      mode: "constraint3d",
      request: { kind: "regular_pyramid", baseSide: side, lateralEdge: lateral, baseLabels, apexName },
      ...(vNames ? { explicitNames: vNames } : {})
    }
  }

  if ((SOLID_KIND_FAMILIES.tetrahedron as readonly string[]).includes(kind)) {
    const edge = asPositiveNumber(input.edgeLength ?? input.sideLength)
    const abIn = asPositiveNumber(input.ab) ?? edge
    const acIn = asPositiveNumber(input.ac) ?? edge
    const bcIn = asPositiveNumber(input.bc) ?? edge
    const adIn = asPositiveNumber(input.ad)
    const bdIn = asPositiveNumber(input.bd)
    const cdIn = asPositiveNumber(input.cd)
    const paIn = asPositiveNumber(input.pa) ?? edge
    const pbIn = asPositiveNumber(input.pb) ?? edge
    const pcIn = asPositiveNumber(input.pc) ?? edge
    const hasAbcdSix = edge === null && adIn !== null && bdIn !== null && cdIn !== null && abIn !== null && acIn !== null && bcIn !== null
    const ab = hasAbcdSix ? bcIn : abIn
    const ac = hasAbcdSix ? bdIn : acIn
    const bc = hasAbcdSix ? cdIn : bcIn
    const pa = hasAbcdSix ? abIn : paIn
    const pb = hasAbcdSix ? acIn : pbIn
    const pc = hasAbcdSix ? adIn : pcIn
    const baseRefs = asStringList(input.baseVertexNames ?? input.baseLabels)
    const candidateNames =
      vNames && vNames.length === 4
        ? vNames
        : baseRefs && baseRefs.length === 3
          ? [asString(input.apexName) ?? "A", baseRefs[0]!, baseRefs[1]!, baseRefs[2]!]
          : null
    if (vNames && vNames.length >= 5 && ab === null && ac === null && bc === null && pa === null && pb === null && pc === null) {
      const built = buildPyramidFromPoints3(vNames, asString(input.apexName) ?? undefined)
      if (built) return built
    }
    if (candidateNames && ab === null && ac === null && bc === null && pa === null && pb === null && pc === null) {
      const pts = candidateNames.map((vn) => points3.get(vn))
      if (pts.every((p): p is Vector3 => p !== undefined)) {
        const basePlane = planeFromPoints(pts[1]!, pts[2]!, pts[3]!)
        const apexDist = basePlane
          ? Math.abs(basePlane.normal.x * pts[0]!.x + basePlane.normal.y * pts[0]!.y + basePlane.normal.z * pts[0]!.z + basePlane.constant)
          : 0
        if (!basePlane || !(apexDist > 1e-6)) {
          return {
            ok: false,
            status: "blocked",
            blockerCode: "infeasible",
            repairHint: "tetrahedron vertices must be 4 non-coplanar 3D points (do NOT put a point on a base edge like E on BD as a vertex; include the out-of-plane apex z != 0, or repair and pass 6 positive edge lengths pa,pb,pc,ab,ac,bc or ab,ac,ad,bc,bd,cd)"
          }
        }
        const pointRegistry: Record<string, Vector3> = {}
        candidateNames.forEach((vn, idx) => { pointRegistry[vn] = pts[idx]! })
        return {
          ok: true,
          mode: "polyhedron",
          pointRegistry,
          vertices: pts,
          vertexNames: candidateNames,
          faces: [[1, 2, 3], [0, 1, 2], [0, 2, 3], [0, 3, 1]]
        }
      }
    }
    if (ab === null || ac === null || bc === null || pa === null || pb === null || pc === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "tetrahedron requires edgeLength, 6 positive edge lengths (pa,pb,pc,ab,ac,bc for P-ABC OR ab,ac,ad,bc,bd,cd for A-BCD), or 4 materialized 3D vertexNames" }
    }
    if (vNames && vNames.length !== 4) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: "tetrahedron vertexNames must have length 4" }
    }
    // Align permutations of [P, A, B, C] when using pa/pb/pc/ab/ac/bc, and [A, B, C, D] when using ab/ac/ad/bc/bd/cd.
    const alignedNames = (() => {
      if (hasAbcdSix) return ["A", "B", "C", "D"] as const
      if (!vNames) return ["P", "A", "B", "C"] as const
      const hasExplicitSix = edge === null && new Set(vNames).size === 4
      if (hasExplicitSix && vNames.includes("P") && vNames.includes("A") && vNames.includes("B") && vNames.includes("C")) {
        return ["P", "A", "B", "C"] as const
      }
      return [vNames[0]!, vNames[1]!, vNames[2]!, vNames[3]!] as const
    })()
    return {
      ok: true,
      mode: "constraint3d",
      request: { kind: "tetrahedron", names: alignedNames, ab, ac, bc, pa, pb, pc },
      ...(vNames || hasAbcdSix ? { explicitNames: [...alignedNames] } : {})
    }
  }

  if ((SOLID_KIND_FAMILIES.prism as readonly string[]).includes(kind)) {
    const isCubeLike = kind === "cube" || kind === "cuboid" || kind === "box"
    const edge = asPositiveNumber(input.edgeLength ?? input.sideLength ?? input.baseSide)
    const height = asPositiveNumber(input.height) ?? (isCubeLike ? edge ?? asPositiveNumber(input.width ?? input.ab) : null)
    // Support materialized prism vertices (e.g. 6 points for triangular_prism or 8 points for cuboid/quadrilateral prism)
    // when all 2*n vertices have already been constructed via construct_point.
    if (height === null && vNames && vNames.length >= 6 && vNames.length % 2 === 0 && new Set(vNames).size === vNames.length) {
      const matPts = vNames.map((vn) => points3.get(vn))
      if (matPts.every((p): p is Vector3 => p !== undefined)) {
        const n = vNames.length / 2
        const bottomFace = Array.from({ length: n }, (_, i) => n - 1 - i)
        const topFace = Array.from({ length: n }, (_, i) => n + i)
        const sideFaces = Array.from({ length: n }, (_, i) => {
          const next = (i + 1) % n
          return [i, next, n + next, n + i]
        })
        const pointRegistry: Record<string, Vector3> = {}
        for (let i = 0; i < vNames.length; i += 1) {
          pointRegistry[vNames[i]!] = matPts[i]!
        }
        return {
          ok: true,
          mode: "polyhedron",
          pointRegistry,
          vertices: matPts,
          vertexNames: [...vNames],
          faces: [bottomFace, topFace, ...sideFaces]
        }
      }
    }
    if (height === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive height (or edgeLength/sideLength for cube)` }
    }
    const base = resolveBasePolygonFromParams(kind, input, points3, problemText)
    if (!base.ok) return base
    const n = base.baseVertices.length
    if (vNames && vNames.length !== 2 * n) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `prism vertexNames must have length ${2 * n}` }
    }
    const baseVertices = vNames
      ? base.baseVertices.map((bv, i) => ({ name: vNames[i]!, point: bv.point }))
      : base.baseVertices
    const explicitTop = asStringList(input.topLabels)
    const topLabels = vNames
      ? vNames.slice(n)
      : explicitTop && explicitTop.length === n
        ? explicitTop
        : baseVertices.map((bv) => `${bv.name}1`)
    return {
      ok: true,
      mode: "constraint3d",
      request: { kind: "prism", baseVertices, topLabels, height }
    }
  }

  if ((SOLID_KIND_FAMILIES.perpendicular_pyramid as readonly string[]).includes(kind) || wantsTrapezoidBase) {
    const baseRefs = asStringList(input.baseVertexNames ?? input.baseLabels)
    const explicitApex = asString(input.apexName) ?? undefined
    const hasExplicitBaseDims =
      input.upperBase !== undefined ||
      input.lowerBase !== undefined ||
      input.baseHeight !== undefined ||
      input.sideLength !== undefined ||
      input.baseSide !== undefined ||
      input.ab !== undefined ||
      input.bc !== undefined ||
      input.radius !== undefined ||
      input.r !== undefined
    const matNames = vNames && vNames.length >= 4
      ? vNames
      : baseRefs && baseRefs.length >= 3
        ? [explicitApex ?? "P", ...baseRefs]
        : null
    if (!hasExplicitBaseDims && matNames) {
      const built = buildPyramidFromPoints3(matNames, explicitApex)
      if (built) return built
    }
    const height = asPositiveNumber(input.height ?? input.pa)
    if (height === null) {
      const built = matNames ? buildPyramidFromPoints3(matNames, explicitApex) : null
      if (built) return built
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "perpendicular_pyramid requires positive height or materialized vertexNames" }
    }
    const base = resolveBasePolygonFromParams(kind, input, points3, problemText)
    if (!base.ok) return base
    const n = base.baseVertices.length
    if (vNames && vNames.length !== n + 1) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `perpendicular_pyramid vertexNames must have length ${n + 1} (${n} base vertices followed by 1 apex; currently base has ${n} vertices — pass sides=4 or 4 baseVertexNames for a square/quadrilateral base)` }
    }
    const perpApexFirst = vNames ? isApexFirstVertexNames(vNames, asString(input.apexName)) : false
    const baseVertices = vNames
      ? base.baseVertices.map((bv, i) => ({ name: vNames[perpApexFirst ? i + 1 : i]!, point: bv.point }))
      : base.baseVertices
    const apexName = vNames ? (perpApexFirst ? vNames[0]! : vNames[n]!) : (asString(input.apexName) ?? "S")
    const footName = asString(input.footName) ?? baseVertices[0]!.name
    return {
      ok: true,
      mode: "constraint3d",
      request: { kind: "perpendicular_pyramid", apexName, baseVertices, footName, height }
    }
  }

  if ((SOLID_KIND_FAMILIES.pyramidal_frustum as readonly string[]).includes(kind)) {
    const sidesVal = asPositiveNumber(input.sides) ?? (kind === "triangular_frustum" ? 3 : 4)
    if (!Number.isInteger(sidesVal) || sidesVal < 3) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `${rawKind} sides must be an integer >= 3` }
    }
    const bottomSide = asPositiveNumber(input.bottomSide ?? input.lowerSide ?? input.lowerBase ?? input.ab ?? input.sideLength ?? input.baseSide)
    const topSide = asPositiveNumber(input.topSide ?? input.upperSide ?? input.upperBase ?? input.a1b1)
    if (bottomSide === null || topSide === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive bottomSide (ab) and topSide (a1b1)` }
    }
    const rBot = bottomSide / (2 * Math.sin(Math.PI / sidesVal))
    const rTop = topSide / (2 * Math.sin(Math.PI / sidesVal))
    const dR = Math.abs(rBot - rTop)
    const directHeight = asPositiveNumber(input.height)
    const lateral = asPositiveNumber(input.lateralEdge ?? input.aa1)
    let h = directHeight
    if (h === null) {
      if (lateral === null) {
        return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive height or lateralEdge (aa1)` }
      }
      const hSq = lateral * lateral - dR * dR
      if (!(hSq > 1e-9)) {
        return { ok: false, status: "blocked", blockerCode: "infeasible", repairHint: `${rawKind} lateralEdge ${lateral} is too short for the bottom/top circumradius difference` }
      }
      h = Math.sqrt(hSq)
    }
    const defaultLetters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    const baseLabelsRaw = asStringList(input.baseVertexNames ?? input.baseLabels)
    const topLabelsRaw = asStringList(input.topLabels)
    if (vNames && vNames.length !== 2 * sidesVal) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `${rawKind} vertexNames must have length ${2 * sidesVal}` }
    }
    const baseLabels = vNames
      ? vNames.slice(0, sidesVal)
      : baseLabelsRaw && baseLabelsRaw.length === sidesVal
        ? baseLabelsRaw
        : Array.from({ length: sidesVal }, (_, i) => defaultLetters[i] ?? `B${i + 1}`)
    const topLabels = vNames
      ? vNames.slice(sidesVal)
      : topLabelsRaw && topLabelsRaw.length === sidesVal
        ? topLabelsRaw
        : baseLabels.map((lbl) => `${lbl}1`)
    const angleOffset = sidesVal === 4 ? -Math.PI * 0.75 : 0
    const originVec = readOriginVector3(input.origin)
    const pointRegistry: Record<string, Vector3> = {}
    const vertices: Vector3[] = []
    const vertexNames: string[] = [...baseLabels, ...topLabels]
    for (let i = 0; i < sidesVal; i++) {
      const th = angleOffset + (2 * Math.PI * i) / sidesVal
      const pt: Vector3 = {
        x: originVec.x + rBot * Math.cos(th),
        y: originVec.y + rBot * Math.sin(th),
        z: originVec.z
      }
      vertices.push(pt)
      pointRegistry[baseLabels[i]!] = pt
    }
    for (let i = 0; i < sidesVal; i++) {
      const th = angleOffset + (2 * Math.PI * i) / sidesVal
      const pt: Vector3 = {
        x: originVec.x + rTop * Math.cos(th),
        y: originVec.y + rTop * Math.sin(th),
        z: originVec.z + h
      }
      vertices.push(pt)
      pointRegistry[topLabels[i]!] = pt
    }
    const bottomFace = Array.from({ length: sidesVal }, (_, i) => sidesVal - 1 - i)
    const topFace = Array.from({ length: sidesVal }, (_, i) => sidesVal + i)
    const sideFaces = Array.from({ length: sidesVal }, (_, i) => {
      const next = (i + 1) % sidesVal
      return [i, next, sidesVal + next, sidesVal + i]
    })
    return {
      ok: true,
      mode: "polyhedron",
      pointRegistry,
      vertices,
      vertexNames,
      faces: [bottomFace, topFace, ...sideFaces]
    }
  }

  return {
    ok: false,
    status: "blocked",
    blockerCode: "unsupported_action",
    repairHint: `solid kind "${rawKind}" is unsupported`
  }
}

/** Single-action exploratory execution backing iterative DS calls (Task F2). */
export function createDsActionSession(options: {
  readonly workspace: GeometryDocument["workspace"]
  readonly baseDocument: GeometryDocument
  readonly runId?: string
  readonly problemText?: string
}): DsActionSession {
  const speculative = createSpeculativeCanvas(options.baseDocument, { runId: options.runId })
  const entities = new Map<string, { id: string; kind: string; scopeId: string; stateId: string }>()
  const explicitDeclarations = new Map<string, Set<string>>()
  const points2 = new Map<string, Coordinate>()
  const points3 = new Map<string, Vector3>()
  const pointLabelByKey = new Map<string, string>()
  const statedSubscriptPoints = new Map<string, string>()
  if (options.problemText) {
    const normalizedPromptForSubscripts = normalizeGeometryPrompt(options.problemText)
    const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉"
    for (const m of normalizedPromptForSubscripts.matchAll(/([A-Z])([′']*)([₀-₉]+)/g)) {
      const unicodeToken = `${m[1]}${m[2]!.replace(/'/g, "′")}${m[3]}`
      const asciiDigits = [...m[3]!].map((ch) => String(SUB_DIGITS.indexOf(ch))).join("")
      const primeAscii = m[2]!.replace(/′/g, "'")
      statedSubscriptPoints.set(`${m[1]}${primeAscii}${asciiDigits}`, unicodeToken)
      statedSubscriptPoints.set(`${m[1]}${primeAscii}_${asciiDigits}`, unicodeToken)
      statedSubscriptPoints.set(`${m[1]}${primeAscii}_{${asciiDigits}}`, unicodeToken)
      statedSubscriptPoints.set(unicodeToken, unicodeToken)
    }
    for (const m of normalizedPromptForSubscripts.matchAll(/([A-Z])([′']+)/g)) {
      const unicodeToken = `${m[1]}${m[2]!.replace(/'/g, "′")}`
      const primeAscii = m[2]!.replace(/′/g, "'")
      statedSubscriptPoints.set(`${m[1]}${primeAscii}`, unicodeToken)
      statedSubscriptPoints.set(unicodeToken, unicodeToken)
    }
  }
  const canonicalizePointLabel = (raw: string): string => {
    const trimmed = raw.trim()
    const exact = statedSubscriptPoints.get(trimmed)
    if (exact) return exact
    const cleaned = trimmed.replaceAll("'", "′").replaceAll("’", "′")
    return statedSubscriptPoints.get(cleaned) ?? (/^[A-Z]′{1,2}$/.test(cleaned) ? cleaned : trimmed)
  }
  const resolvePointLabel = (key: string): string => pointLabelByKey.get(key) ?? pointLabelByKey.get(canonicalizePointLabel(key)) ?? canonicalizePointLabel(key)
  let sawInfeasibleConicPerp = false
  let inSessionCertRejections = 0
  let lastPreCertRejectedHash: string | null = null
  const intersectionRecords: Array<{ branch: string; pairKey: string; id: string; label: string; pt: Coordinate }> = []
  const lines2 = new Map<string, { a: Coordinate; b: Coordinate }>()
  const conics2 = new Map<string, PlanarConic>()
  const branchPoints2 = new Map<string, Map<string, Coordinate>>()
  const branchPoints3 = new Map<string, Map<string, Vector3>>()
  const branchLines2 = new Map<string, Map<string, { a: Coordinate; b: Coordinate }>>()
  const branchConics2 = new Map<string, Map<string, PlanarConic>>()
  const sharedBranchlessActions: DraftAction[] = []
  const branchActionBuckets = new Map<string, { scopeId: string; stateId?: string; branchId: string; actions: DraftAction[] }>()
  const branchCanvases = new Map<string, ReturnType<typeof createSpeculativeCanvas>>()
  let monotonicActionSeq = 0
  const getTargetCanvas = (branchId?: string) => {
    if (!branchId) return speculative
    let canvas = branchCanvases.get(branchId)
    if (!canvas) {
      canvas = createSpeculativeCanvas(
        options.baseDocument ?? createEmptyDocument(options.workspace)
      )
      for (const act of sharedBranchlessActions) {
        canvas.applyAction(act)
      }
      branchCanvases.set(branchId, canvas)
    }
    return canvas
  }
  const symbolicDisplays = new Map<string, { symbol: "a"; displayScale: number }>()
  const pendingEdgeBoundPoints = new Map<string, {
    actionKey: string
    id: string
    label: string
    fromId: string
    toId: string
    ratio: number
    is3d: boolean
  }>()
  const relations: Array<{ kind: string; targets: string[] }> = []
  const recordedSlices: DsActionStateSlice[] = []
  const sliceHistory: Array<{
    slices: DsActionStateSlice[]
    sharedActions: DraftAction[]
    branchBuckets: Array<[string, { scopeId: string; stateId?: string; branchId: string; actions: DraftAction[] }]>
  }> = [{ slices: [], sharedActions: [], branchBuckets: [] }]
  const copyBranches = <T>(source: Map<string, Map<string, T>>) =>
    new Map([...source].map(([branch, values]) => [branch, new Map(values)]))
  const snapshotRefs = () => ({
    points2: new Map(points2), points3: new Map(points3),
    lines2: new Map(lines2), conics2: new Map(conics2),
    branchPoints2: copyBranches(branchPoints2), branchPoints3: copyBranches(branchPoints3),
    branchLines2: copyBranches(branchLines2), branchConics2: copyBranches(branchConics2)
  })
  const restoreRefs = (saved: ReturnType<typeof snapshotRefs>) => {
    const restore = <T>(target: Map<string, T>, values: Map<string, T>) => {
      target.clear()
      for (const [key, value] of values) target.set(key, value)
    }
    restore(points2, saved.points2)
    restore(points3, saved.points3)
    restore(lines2, saved.lines2)
    restore(conics2, saved.conics2)
    restore(branchPoints2, saved.branchPoints2)
    restore(branchPoints3, saved.branchPoints3)
    restore(branchLines2, saved.branchLines2)
    restore(branchConics2, saved.branchConics2)
  }
  const branchHistory = new Map<string, Array<{
    stepIndex: number
    refs: ReturnType<typeof snapshotRefs>
    slices: DsActionStateSlice[]
    buckets: Array<[string, { scopeId: string; stateId?: string; branchId: string; actions: DraftAction[] }]>
  }>>()
  const restoreBranchRefs = (saved: ReturnType<typeof snapshotRefs>, branchId: string) => {
    const restore = <T>(target: Map<string, Map<string, T>>, source: Map<string, Map<string, T>>) => {
      const values = source.get(branchId)
      if (values) target.set(branchId, new Map(values))
      else target.delete(branchId)
    }
    restore(branchPoints2, saved.branchPoints2)
    restore(branchPoints3, saved.branchPoints3)
    restore(branchLines2, saved.branchLines2)
    restore(branchConics2, saved.branchConics2)
  }
  const pointHistory: Array<ReturnType<typeof snapshotRefs>> = [snapshotRefs()]

  const branchMapGet = <T>(
    sharedMap: Map<string, T>,
    branchMaps: Map<string, Map<string, T>>,
    key: string,
    branchId?: string
  ): T | undefined => (branchId ? branchMaps.get(branchId)?.get(key) : undefined) ?? sharedMap.get(key)

  const branchMapSet = <T>(
    sharedMap: Map<string, T>,
    branchMaps: Map<string, Map<string, T>>,
    key: string,
    val: T,
    branchId?: string
  ) => {
    if (!branchId) {
      sharedMap.set(key, val)
      return
    }
    let m = branchMaps.get(branchId)
    if (!m) {
      m = new Map<string, T>()
      branchMaps.set(branchId, m)
    }
    m.set(key, val)
  }

  const readP2 = (key: string, branchId?: string) =>
    branchMapGet(points2, branchPoints2, key, branchId) ??
    branchMapGet(points2, branchPoints2, canonicalizePointLabel(key), branchId)
  const writeP2 = (key: string, val: Coordinate, branchId?: string) => {
    branchMapSet(points2, branchPoints2, key, val, branchId)
    const canon = canonicalizePointLabel(key)
    if (canon !== key) branchMapSet(points2, branchPoints2, canon, val, branchId)
  }
  const readP3 = (key: string, branchId?: string) =>
    branchMapGet(points3, branchPoints3, key, branchId) ??
    branchMapGet(points3, branchPoints3, canonicalizePointLabel(key), branchId)
  const writeP3 = (key: string, val: Vector3, branchId?: string) => {
    branchMapSet(points3, branchPoints3, key, val, branchId)
    const canon = canonicalizePointLabel(key)
    if (canon !== key) branchMapSet(points3, branchPoints3, canon, val, branchId)
  }
  const readL2 = (key: string, branchId?: string) => branchMapGet(lines2, branchLines2, key, branchId)
  const writeL2 = (key: string, val: { a: Coordinate; b: Coordinate }, branchId?: string) => branchMapSet(lines2, branchLines2, key, val, branchId)
  const readC2 = (key: string, branchId?: string) => branchMapGet(conics2, branchConics2, key, branchId)
  const writeC2 = (key: string, val: PlanarConic, branchId?: string) => branchMapSet(conics2, branchConics2, key, val, branchId)

  const upsertSlice = (slice: DsActionStateSlice) => {
    const key = `${slice.scopeId}::${slice.stateId ?? ""}::${slice.branchId ?? ""}`
    const idx = recordedSlices.findIndex(
      (s) => `${s.scopeId}::${s.stateId ?? ""}::${s.branchId ?? ""}` === key
    )
    if (idx >= 0) recordedSlices[idx] = slice
    else recordedSlices.push(slice)
  }

  const failRepairable = (action: DsActionName, blockerCode: string, repairHint: string): DsActionRawResult => {
    const snap = speculative.snapshot()
    return {
      ok: false,
      status: "repairable",
      action,
      stateChanged: false,
      candidateHash: snap.candidateHash,
      stepIndex: snap.stepIndex,
      primitiveCount: snap.primitiveCount,
      blockerCode,
      repairHint
    }
  }

  const failBlocked = (action: DsActionName, blockerCode: string, repairHint: string): DsActionRawResult => {
    const snap = speculative.snapshot()
    return {
      ok: false,
      status: "blocked",
      action,
      stateChanged: false,
      candidateHash: snap.candidateHash,
      stepIndex: snap.stepIndex,
      primitiveCount: snap.primitiveCount,
      blockerCode,
      repairHint
    }
  }

  const stageDraftAction = (
    actionName: DsActionName,
    draftAction: DraftAction,
    entityId?: string,
    position?: Coordinate,
    sliceTarget?: { readonly scopeId: string; readonly stateId?: string; readonly branchId?: string }
  ): DsActionRawResult => {
    if (!sliceTarget?.branchId && branchActionBuckets.size > 0) {
      return failBlocked(actionName, "active_branch_dependency", "finish or repair active branches before adding shared geometry")
    }
    const canvas = getTargetCanvas(sliceTarget?.branchId)
    const before = canvas.snapshot()
    const familyOfActionId = (actId: string): string =>
      actId === "planar.create_point" || actId === "solid.create_point" || actId === "dynamic.create_bound_point" || actId === "dynamic.create_face_point"
        ? "point"
        : actId === "planar.create_circle" || actId === "planar.create_conic"
          ? "conic"
          : actId === "planar.create_line" || actId === "planar.create_segment" || actId === "planar.create_ray"
            ? "line"
            : "solid"
    const draftFamily = familyOfActionId(draftAction.actionId)
    const guardedSet = new Set<DsActionName>([
      "construct_point",
      "construct_line",
      "construct_segment",
      "construct_circle",
      "construct_conic",
      "construct_perpendicular",
      "construct_parallel",
      "construct_solid"
    ])
    const sameFamilyDup = !sliceTarget?.stateId && entityId && guardedSet.has(actionName) &&
      before.actions.some((a) => {
        if (familyOfActionId(a.actionId) !== draftFamily) return false
        const inp = a.inputs as Record<string, unknown> | undefined
        return inp?.alias === entityId || inp?.label === entityId
      })
    if (sameFamilyDup) {
      if (!sliceTarget?.branchId) {
        const snapshotPts = pointHistory[Math.min(before.stepIndex, pointHistory.length - 1)]
        if (snapshotPts) restoreRefs(snapshotPts)
      }
      return failRepairable(
        actionName,
        "duplicate_entity_id",
        `Entity "${entityId}" is already materialized on the canvas. Do not recreate it; use a distinct id or call repair_entity({ target: "${entityId}" }) first to replace it.`
      )
    }
    let resolvedDraftAction = draftAction
    const draftAlias = (draftAction.inputs as Record<string, unknown> | undefined)?.alias
    if (typeof draftAlias === "string" && before.actions.some((a) => (a.inputs as Record<string, unknown> | undefined)?.alias === draftAlias)) {
      const prefix = draftFamily === "point" ? "pt" : draftFamily
      let uniqueAlias = `${prefix}_${draftAlias}`
      let suffix = 2
      while (before.actions.some((a) => (a.inputs as Record<string, unknown> | undefined)?.alias === uniqueAlias)) {
        uniqueAlias = `${prefix}_${draftAlias}_${suffix++}`
      }
      resolvedDraftAction = {
        ...draftAction,
        inputs: { ...(draftAction.inputs as Record<string, unknown>), alias: uniqueAlias }
      } as DraftAction
    }
    const step = canvas.applyAction(resolvedDraftAction)
    if (!step.ok) {
      return {
        ok: false,
        status: step.status,
        action: actionName,
        stateChanged: false,
        ...(entityId === undefined ? {} : { entity: entityId }),
        candidateHash: step.candidateHash,
        stepIndex: step.stepIndex,
        primitiveCount: step.primitiveCount,
        blockerCode: step.diagnostics[0]?.code ?? "compile_failed",
        repairHint: step.detail ?? "adjust parameters and retry"
      }
    }
    if (sliceTarget?.branchId) {
      const bKey = `${sliceTarget.scopeId}::${sliceTarget.stateId ?? ""}::${sliceTarget.branchId}`
      let bucket = branchActionBuckets.get(bKey)
      if (!bucket) {
        bucket = {
          scopeId: sliceTarget.scopeId,
          ...(sliceTarget.stateId === undefined ? {} : { stateId: sliceTarget.stateId }),
          branchId: sliceTarget.branchId,
          actions: [...sharedBranchlessActions]
        }
        branchActionBuckets.set(bKey, bucket)
      }
      bucket.actions.push(resolvedDraftAction)
      upsertSlice({
        scopeId: sliceTarget.scopeId,
        ...(sliceTarget.stateId === undefined ? {} : { stateId: sliceTarget.stateId }),
        branchId: sliceTarget.branchId,
        candidateHash: step.candidateHash,
        actions: [...bucket.actions]
      })
    } else {
      sharedBranchlessActions.push(resolvedDraftAction)
      if (sliceTarget !== undefined) {
        const curSnap = canvas.snapshot()
        upsertSlice({
          scopeId: sliceTarget.scopeId,
          ...(sliceTarget.stateId === undefined ? {} : { stateId: sliceTarget.stateId }),
          candidateHash: curSnap.candidateHash,
          actions: [...curSnap.actions]
        })
      }
    }
    if (!sliceTarget?.branchId) {
      pointHistory[step.stepIndex] = snapshotRefs()
      pointHistory.length = step.stepIndex + 1
      sliceHistory[step.stepIndex] = {
        slices: [...recordedSlices],
        sharedActions: [...sharedBranchlessActions],
        branchBuckets: [...branchActionBuckets.entries()].map(([k, v]) => [k, { ...v, actions: [...v.actions] }])
      }
      sliceHistory.length = step.stepIndex + 1
    }
    return {
      ok: true,
      status: "accepted",
      action: actionName,
      stateChanged: step.stepIndex > before.stepIndex || step.candidateHash !== before.candidateHash,
      ...(entityId === undefined ? {} : { entity: entityId }),
      ...(position === undefined ? {} : { position }),
      candidateHash: step.candidateHash,
      stepIndex: step.stepIndex,
      primitiveCount: step.primitiveCount
    }
  }

  const executeHostInsphere = (
    actionName: DsActionName,
    requestedSolidId: string | undefined,
    id: string,
    label: string,
    actionKey: string,
    sliceTarget: { readonly scopeId: string; readonly stateId?: string; readonly branchId?: string }
  ): DsActionRawResult => {
    const canvas = getTargetCanvas(sliceTarget.branchId)
    const snapActions = canvas.snapshot().actions
    const solidActions = snapActions.filter((action) =>
      action.actionId === "solid.create_polyhedron" ||
      action.actionId === "solid.create_prism" ||
      action.actionId === "solid.create_template" ||
      action.actionId === "solid.create_round_frustum"
    )
    const hostAction = requestedSolidId
      ? solidActions.find((action) => action.inputs.alias === requestedSolidId || action.inputs.label === requestedSolidId)
      : solidActions.at(-1)
    if (!hostAction || typeof hostAction.inputs.alias !== "string") {
      return solidActions.length === 0 && !requestedSolidId
        ? failRepairable(actionName, "missing_required_parameter", "construct a solid before requesting its inscribed sphere")
        : failBlocked(actionName, "missing_host", `inscribed sphere host "${requestedSolidId ?? ""}" must be an existing staged solid`)
    }
    const resolvedAlias = hostAction.inputs.alias
    if (hostAction.actionId === "solid.create_template") {
      const template = asString(hostAction.inputs.template)
      const r = asPositiveNumber(hostAction.inputs.radius)
      const h = asPositiveNumber(hostAction.inputs.height)
      const origin = readOriginVector3(hostAction.inputs.origin)
      if (r === null || h === null) {
        return failBlocked(actionName, "missing_host", "solid template lacks valid radius and height")
      }
      if (template === "cylinder" || template === "cone") {
        const radius = template === "cylinder" ? Math.min(r, h * 0.5) : (r * h) / (r + Math.hypot(r, h))
        const center = { x: origin.x, y: origin.y, z: origin.z + (template === "cylinder" ? h * 0.5 : radius) }
        const staged = stageDraftAction(actionName, {
          actionId: "solid.create_sphere", actionKey, factIds: [],
          inputs: { alias: id, label, center, radius }
        } as unknown as DraftAction, id, undefined, sliceTarget)
        if (staged.ok) {
          writeP3(id, center, sliceTarget.branchId)
          writeP3(label, center, sliceTarget.branchId)
          if (!sliceTarget.branchId && !sliceTarget.stateId) {
            const curSnap = speculative.snapshot()
            upsertSlice({ scopeId: sliceTarget.scopeId, candidateHash: curSnap.candidateHash, actions: [...curSnap.actions] })
          }
        }
        return staged.ok ? { ...staged, measurement: { center, radius, exactInsphere: false } } : staged
      }
    }
    const compiled = compilePlan({
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "insphere host compilation",
      factIds: [],
      actions: [...snapActions]
    }, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "ds-insphere-host",
      documentGeneration: 0,
      workspace: "geometry3d"
    })
    const doc = compiled.ok && compiled.draftDocument ? compiled.draftDocument : null
    const primMap = new Map((doc?.primitives ?? []).map((p) => [p.id, p]))
    const hostEntityId = compiled.aliases[resolvedAlias]
    const hostLabel = asString(hostAction.inputs.label) ?? resolvedAlias
    const hostPrim =
      (hostEntityId ? primMap.get(hostEntityId) : undefined)
      ?? doc?.primitives.find((p) => p.type === "polyhedron3" && (p.label === hostLabel || p.id === resolvedAlias))
      ?? doc?.primitives.find((p) => p.label === hostLabel || p.id === resolvedAlias)
    const topo = hostPrim ? solidTopology3(hostPrim, primMap) : null
    if (!topo) {
      return failBlocked(actionName, "missing_host", "cannot extract boundary of staged host solid for insphere")
    }
    const exact = solveInsphere3(topo)
    if (exact.status === "exact") {
      const staged = stageDraftAction(actionName, {
        actionId: "derived.create_insphere",
        actionKey,
        factIds: [],
        inputs: { alias: id, label, solidId: { scope: "draft", alias: resolvedAlias } }
      } as unknown as DraftAction, id, undefined, sliceTarget)
      if (staged.ok) {
        writeP3(id, exact.value.center, sliceTarget.branchId)
        writeP3(label, exact.value.center, sliceTarget.branchId)
        if (!sliceTarget.branchId && !sliceTarget.stateId) {
          const curSnap = speculative.snapshot()
          upsertSlice({ scopeId: sliceTarget.scopeId, candidateHash: curSnap.candidateHash, actions: [...curSnap.actions] })
        }
      }
      return staged.ok ? { ...staged, measurement: { center: exact.value.center, radius: exact.value.radius, exactInsphere: true } } : staged
    }
    const maxBall = solveMaxInscribedBall3(topo)
    if (!maxBall) {
      return failBlocked(actionName, "infeasible", "host solid cannot hold a non-degenerate inscribed sphere")
    }
    const staged = stageDraftAction(actionName, {
      actionId: "solid.create_sphere",
      actionKey,
      factIds: [],
      inputs: { alias: id, label, center: maxBall.center, radius: maxBall.radius }
    } as unknown as DraftAction, id, undefined, sliceTarget)
    if (staged.ok) {
      writeP3(id, maxBall.center, sliceTarget.branchId)
      writeP3(label, maxBall.center, sliceTarget.branchId)
      if (!sliceTarget.branchId && !sliceTarget.stateId) {
        const curSnap = speculative.snapshot()
        upsertSlice({ scopeId: sliceTarget.scopeId, candidateHash: curSnap.candidateHash, actions: [...curSnap.actions] })
      }
    }
    return staged.ok ? { ...staged, measurement: { center: maxBall.center, radius: maxBall.radius, exactInsphere: false } } : staged
  }

  const executeRaw = (toolName: string, rawInput: unknown): DsActionRawResult => {
      const parsed = parseDsActionToolCall(toolName, rawInput)
      const branchHint =
        rawInput && typeof rawInput === "object"
          ? (asString((rawInput as Record<string, unknown>).branchId) ?? undefined)
          : undefined
      const snap = getTargetCanvas(branchHint).snapshot()
      if (!parsed.ok) {
        return {
          ok: false,
          status: parsed.status,
          action: isDsActionName(toolName) ? toolName : "declare_entity",
          stateChanged: false,
          candidateHash: snap.candidateHash,
          stepIndex: snap.stepIndex,
          primitiveCount: snap.primitiveCount,
          blockerCode: parsed.code,
          repairHint: parsed.detail
        }
      }
      const { name } = parsed
      if (name === "construct_equal_edge_triangular_prism") {
        const supplied = parsed.input
        if (Object.keys(supplied).some((key) => !(key in CONSTRUCT_EQUAL_EDGE_TRIANGULAR_PRISM_PARAMETERS.properties))) {
          return failBlocked(name, "invalid_schema", "symbolic prism accepts only its published fields")
        }
        if (!asString(supplied.id) || asPositiveNumber(supplied.displayScale) === null) {
          return failRepairable(name, "missing_required_parameter", "symbolic prism requires id and positive displayScale")
        }
      }
      const input = name === "construct_equal_edge_triangular_prism"
        ? { ...parsed.input, kind: "triangular_prism", symbol: "a" }
        : parsed.input
      const stepSeq = ++monotonicActionSeq
      const computeCircumsphereFromVerts = (pts: readonly Vector3[]): { center: Vector3; radius: number } | null => {
        for (let i = 0; i < pts.length - 3; i += 1) {
          for (let j = i + 1; j < pts.length - 2; j += 1) {
            for (let k = j + 1; k < pts.length - 1; k += 1) {
              for (let l = k + 1; l < pts.length; l += 1) {
                const p0 = pts[i]!
                const u = { x: pts[j]!.x - p0.x, y: pts[j]!.y - p0.y, z: pts[j]!.z - p0.z }
                const v = { x: pts[k]!.x - p0.x, y: pts[k]!.y - p0.y, z: pts[k]!.z - p0.z }
                const w = { x: pts[l]!.x - p0.x, y: pts[l]!.y - p0.y, z: pts[l]!.z - p0.z }
                const vxw = { x: v.y * w.z - v.z * w.y, y: v.z * w.x - v.x * w.z, z: v.x * w.y - v.y * w.x }
                const denom = 2 * (u.x * vxw.x + u.y * vxw.y + u.z * vxw.z)
                if (Math.abs(denom) <= 1e-6) continue
                const wxu = { x: w.y * u.z - w.z * u.y, y: w.z * u.x - w.x * u.z, z: w.x * u.y - w.y * u.x }
                const uxv = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x }
                const u2 = u.x * u.x + u.y * u.y + u.z * u.z
                const v2 = v.x * v.x + v.y * v.y + v.z * v.z
                const w2 = w.x * w.x + w.y * w.y + w.z * w.z
                const off = {
                  x: (u2 * vxw.x + v2 * wxu.x + w2 * uxv.x) / denom,
                  y: (u2 * vxw.y + v2 * wxu.y + w2 * uxv.y) / denom,
                  z: (u2 * vxw.z + v2 * wxu.z + w2 * uxv.z) / denom
                }
                const radius = Math.hypot(off.x, off.y, off.z)
                const center = { x: p0.x + off.x, y: p0.y + off.y, z: p0.z + off.z }
                if (Number.isFinite(radius) && radius > 1e-6) return { center, radius }
              }
            }
          }
        }
        return null
      }
      const hostVerticesOfAction = (act: DraftAction | undefined): Vector3[] => {
        if (!act) return []
        const inp = act.inputs as Record<string, unknown> | undefined
        if (act.actionId === "solid.create_polyhedron" && Array.isArray(inp?.vertices)) {
          return (inp.vertices as unknown[]).filter(
            (v): v is Vector3 => Boolean(v && typeof v === "object" && typeof (v as Vector3).x === "number" && typeof (v as Vector3).y === "number" && typeof (v as Vector3).z === "number")
          )
        }
        if (act.actionId === "solid.create_prism" && Array.isArray(inp?.basePolygon)) {
          const base = (inp.basePolygon as unknown[]).filter(
            (v): v is Vector3 => Boolean(v && typeof v === "object" && typeof (v as Vector3).x === "number" && typeof (v as Vector3).y === "number" && typeof (v as Vector3).z === "number")
          )
          const vec = inp.vector as Vector3 | undefined
          if (vec && typeof vec.x === "number") {
            return [...base, ...base.map((b) => ({ x: b.x + vec.x, y: b.y + vec.y, z: b.z + vec.z }))]
          }
          return base
        }
        return []
      }

      if (name === "declare_entity") {
        if (Object.keys(input).some(key => !Object.hasOwn(DECLARE_ENTITY_PARAMETERS.properties, key)) ||
          ["kind", "scopeId", "stateId", "branchId"].some(key => input[key] !== undefined && !asString(input[key]))) {
          return failRepairable(name, "invalid_schema", "declare_entity only names an entity; use construct_point or another construction action to draw geometry")
        }
        const id = asString(input.id)
        if (!id) return failRepairable(name, "missing_required_parameter", "declare_entity requires non-empty id")
        entities.set(id, {
          id,
          kind: asString(input.kind) ?? "point",
          scopeId: asString(input.scopeId) ?? "shared",
          stateId: asString(input.stateId) ?? "shared"
        })
        const declarationBranch = asString(input.branchId) ?? ""
        let branchDeclarations = explicitDeclarations.get(declarationBranch)
        if (!branchDeclarations) {
          branchDeclarations = new Set<string>()
          explicitDeclarations.set(declarationBranch, branchDeclarations)
        }
        branchDeclarations.add(id)
        return { ok: true, status: "accepted", action: name, stateChanged: false, entity: id, candidateHash: snap.candidateHash, stepIndex: snap.stepIndex, primitiveCount: snap.primitiveCount }
      }

      if (name === "add_relation") {
        const kind = asString(input.kind)
        const targets = Array.isArray(input.targets) ? input.targets.filter((x): x is string => typeof x === "string") : []
        if (!kind || targets.length === 0) {
          return failRepairable(name, "missing_required_parameter", "add_relation requires kind and targets")
        }
        relations.push({ kind, targets })
        return { ok: true, status: "accepted", action: name, stateChanged: false, candidateHash: snap.candidateHash, stepIndex: snap.stepIndex, primitiveCount: snap.primitiveCount }
      }

      if (name === "choose_strategy") {
        return { ok: true, status: "accepted", action: name, stateChanged: false, candidateHash: snap.candidateHash, stepIndex: snap.stepIndex, primitiveCount: snap.primitiveCount }
      }

      if (name === "query_measurement") {
        const rawMetric = asString(input.metric)
        const metric = rawMetric === "positions" || rawMetric === "coords" ? "position" : rawMetric
        if (!metric) {
          return failRepairable(name, "missing_required_parameter", "query_measurement requires metric (distance | position)")
        }
        const resolveSphereCenter3 = (targetId: string, branchOpt?: string): Vector3 | undefined => {
          const curDoc = getTargetCanvas(branchOpt).currentDocument()
          for (const prim of curDoc.primitives) {
            if (prim.type === "sphere" && (prim.label === targetId || prim.id === targetId)) {
              return prim.center
            }
          }
          const actions = getTargetCanvas(branchOpt).snapshot().actions
          for (let i = actions.length - 1; i >= 0; i -= 1) {
            const act = actions[i]!
            const inp = act.inputs as Record<string, unknown> | undefined
            if (inp?.alias !== targetId && inp?.label !== targetId) continue
            if (act.actionId === "solid.create_sphere" && inp?.center && typeof (inp.center as Vector3).x === "number") {
              return inp.center as Vector3
            }
            if (act.actionId === "derived.create_circumsphere") {
              const hostRef = (inp?.solidId as { alias?: string } | undefined)?.alias
              const hostAct = hostRef ? actions.find((a) => (a.inputs as Record<string, unknown> | undefined)?.alias === hostRef) : undefined
              const circ = computeCircumsphereFromVerts(hostVerticesOfAction(hostAct))
              if (circ) return circ.center
            }
          }
          return undefined
        }
        if (metric === "distance") {
          const targets = asStringList(input.targets)
          if (!targets || targets.length !== 2) {
            return failRepairable(name, "missing_required_parameter", "distance query requires exactly two named targets")
          }
          const [tA, tB] = [targets[0]!, targets[1]!]
          const p3A = readP3(tA, branchHint) ?? resolveSphereCenter3(tA, branchHint)
          const p3B = readP3(tB, branchHint) ?? resolveSphereCenter3(tB, branchHint)
          if (p3A && p3B) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: {
                metric: "distance",
                value: distanceVector3(p3A, p3B),
                sourceEntityIds: [tA, tB]
              }
            }
          }
          const p2A = readP2(tA, branchHint) ?? (() => { const c = readC2(tA, branchHint); return c?.type === "circle" ? c.center : undefined })()
          const p2B = readP2(tB, branchHint) ?? (() => { const c = readC2(tB, branchHint); return c?.type === "circle" ? c.center : undefined })()
          if (p2A && p2B) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: {
                metric: "distance",
                value: Math.hypot(p2B.x - p2A.x, p2B.y - p2A.y),
                sourceEntityIds: [tA, tB]
              }
            }
          }
          const lineA = !p2A ? readL2(tA, branchHint) : undefined
          const lineB = !p2B ? readL2(tB, branchHint) : undefined
          const ptForLine = p2A ?? p2B
          const lineForDist = lineB ?? lineA
          if (ptForLine && lineForDist) {
            const dx = lineForDist.b.x - lineForDist.a.x
            const dy = lineForDist.b.y - lineForDist.a.y
            const len = Math.hypot(dx, dy)
            if (len > 1e-12) {
              const dist = Math.abs(dy * ptForLine.x - dx * ptForLine.y + lineForDist.b.x * lineForDist.a.y - lineForDist.b.y * lineForDist.a.x) / len
              return {
                ok: true,
                status: "accepted",
                action: name,
                stateChanged: false,
                candidateHash: snap.candidateHash,
                stepIndex: snap.stepIndex,
                primitiveCount: snap.primitiveCount,
                measurement: {
                  metric: "distance",
                  value: dist,
                  sourceEntityIds: [tA, tB]
                }
              }
            }
          }
          return failRepairable(name, "undeclared_entity_ref", `point(s) not currently materialized: ${targets.join(", ")}`)
        }
        if (metric === "position" || metric === "coordinates") {
          const target = asString(input.target) ?? asStringList(input.targets)?.[0] ?? null
          if (!target) {
            return failRepairable(name, "missing_required_parameter", "position query requires target entity name")
          }
          const p3 = readP3(target, branchHint) ?? resolveSphereCenter3(target, branchHint)
          if (p3) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              entity: target,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { metric: "position", value: p3, sourceEntityIds: [target] }
            }
          }
          const p2 = readP2(target, branchHint)
          if (p2) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              entity: target,
              position: p2,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { metric: "position", value: p2, sourceEntityIds: [target] }
            }
          }
          return failRepairable(name, "undeclared_entity_ref", `point "${target}" is not currently materialized`)
        }
        if (metric === "area") {
          const targets = asStringList(input.targets)
          if (!targets || targets.length !== 3) {
            return failRepairable(name, "missing_required_parameter", "area query requires exactly three named triangle vertices")
          }
          const [tA, tB, tC] = [targets[0]!, targets[1]!, targets[2]!]
          const p3 = targets.map((t) => readP3(t, branchHint))
          if (p3[0] && p3[1] && p3[2]) {
            const ab = { x: p3[1].x - p3[0].x, y: p3[1].y - p3[0].y, z: p3[1].z - p3[0].z }
            const ac = { x: p3[2].x - p3[0].x, y: p3[2].y - p3[0].y, z: p3[2].z - p3[0].z }
            const cx = ab.y * ac.z - ab.z * ac.y
            const cy = ab.z * ac.x - ab.x * ac.z
            const cz = ab.x * ac.y - ab.y * ac.x
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { metric: "area", value: 0.5 * Math.hypot(cx, cy, cz), sourceEntityIds: [tA, tB, tC] }
            }
          }
          const p2 = targets.map((t) => readP2(t, branchHint))
          if (p2[0] && p2[1] && p2[2]) {
            const area = 0.5 * Math.abs((p2[1].x - p2[0].x) * (p2[2].y - p2[0].y) - (p2[2].x - p2[0].x) * (p2[1].y - p2[0].y))
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { metric: "area", value: area, sourceEntityIds: [tA, tB, tC] }
            }
          }
          return failRepairable(name, "undeclared_entity_ref", `point(s) not currently materialized: ${targets.join(", ")}`)
        }
        return failBlocked(name, "unsupported_observation", `measurement metric "${metric}" is not supported`)
      }

      if (name === "query_constraint_status") {
        const kind = asString(input.kind) ?? "coplanar"
        const targets = asStringList(input.targets)
        if (!targets || targets.length === 0) {
          return failRepairable(name, "missing_required_parameter", "query_constraint_status requires targets")
        }
        if (kind === "coplanar") {
          if (targets.length < 3) {
            return failRepairable(name, "missing_required_parameter", "coplanar check requires at least 3 targets")
          }
          const pts: Vector3[] = []
          for (const t of targets) {
            const pt = readP3(t, branchHint)
            if (!pt) return failRepairable(name, "undeclared_entity_ref", `3D point "${t}" has no coordinates yet; call construct_point first`)
            pts.push(pt)
          }
          if (pts.length === 3) {
            const plane = planeFromPoints(pts[0]!, pts[1]!, pts[2]!)
            const status = plane ? "satisfied" : "violated"
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              constraintStatus: status,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { kind, residual: plane ? 0 : Number.POSITIVE_INFINITY, sourceEntityIds: targets }
            }
          }
          const solved = solveConstraint3d({ kind: "coplanar", points: pts })
          return {
            ok: true,
            status: "accepted",
            action: name,
            stateChanged: false,
            constraintStatus: solved.constraintStatus,
            candidateHash: snap.candidateHash,
            stepIndex: snap.stepIndex,
            primitiveCount: snap.primitiveCount,
            measurement: { kind, residual: solved.residuals.coplanar ?? Number.POSITIVE_INFINITY, sourceEntityIds: targets }
          }
        }
        if (kind === "fixed_distance") {
          const expected = asPositiveNumber(input.expected ?? input.value)
          if (targets.length !== 2 || expected === null) {
            return failRepairable(name, "missing_required_parameter", "fixed_distance check requires 2 targets and positive expected length")
          }
          const pA = readP3(targets[0]!, branchHint)
          const pB = readP3(targets[1]!, branchHint)
          if (pA && pB) {
            const actual = distanceVector3(pA, pB)
            const residual = Math.abs(actual - expected)
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              constraintStatus: residual <= 1e-6 ? "satisfied" : "violated",
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { kind, expected, actual, residual, sourceEntityIds: targets }
            }
          }
          const d2A = readP2(targets[0]!, branchHint)
          const d2B = readP2(targets[1]!, branchHint)
          if (d2A && d2B) {
            const actual = Math.hypot(d2B.x - d2A.x, d2B.y - d2A.y)
            const residual = Math.abs(actual - expected)
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              constraintStatus: residual <= 1e-6 ? "satisfied" : "violated",
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { kind, expected, actual, residual, sourceEntityIds: targets }
            }
          }
          return failRepairable(name, "undeclared_entity_ref", `point(s) not materialized: ${targets.join(", ")}`)
        }
        if (kind === "collinear" && targets.length === 3) {
          const pts3 = targets.map((t) => readP3(t, branchHint))
          if (pts3.every((p): p is Vector3 => p !== undefined)) {
            const [pA, pB, pC] = pts3
            const ux = pB.x - pA.x, uy = pB.y - pA.y, uz = pB.z - pA.z
            const vx = pC.x - pA.x, vy = pC.y - pA.y, vz = pC.z - pA.z
            const cx = uy * vz - uz * vy
            const cy = uz * vx - ux * vz
            const cz = ux * vy - uy * vx
            const crossLen = Math.hypot(cx, cy, cz)
            const baseLen = Math.max(
              Math.hypot(ux, uy, uz),
              Math.hypot(vx, vy, vz),
              Math.hypot(pC.x - pB.x, pC.y - pB.y, pC.z - pB.z),
              1e-9
            )
            const residual = crossLen / baseLen
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              constraintStatus: residual <= 1e-5 ? "satisfied" : "violated",
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { kind, residual, sourceEntityIds: targets }
            }
          }
          const pts = targets.map((t) => readP2(t, branchHint))
          if (pts.some((p) => !p)) return failRepairable(name, "undeclared_entity_ref", "collinear check requires materialized points")
          const res = solveConstraint2d({ kind: "collinear", points: [pts[0]!, pts[1]!, pts[2]!] })
          return {
            ok: true,
            status: "accepted",
            action: name,
            stateChanged: false,
            constraintStatus: res.constraintStatus,
            candidateHash: snap.candidateHash,
            stepIndex: snap.stepIndex,
            primitiveCount: snap.primitiveCount,
            measurement: { kind, residual: res.residual, sourceEntityIds: targets }
          }
        }
        if (kind === "perpendicular" || kind === "parallel") {
          if (targets.length !== 3 && targets.length !== 4) {
            return failRepairable(name, "missing_required_parameter", `${kind} check requires 3 targets [A,B,C] (AB vs BC) or 4 targets [A,B,C,D] (AB vs CD)`)
          }
          if (kind === "parallel" && targets.length !== 4) {
            return failRepairable(name, "missing_required_parameter", "parallel check requires 4 targets [A,B,C,D] (AB vs CD)")
          }
          const resolvedPairs: [string, string, string, string] = targets.length === 3
            ? [targets[0]!, targets[1]!, targets[1]!, targets[2]!]
            : [targets[0]!, targets[1]!, targets[2]!, targets[3]!]
          const readAnyPt = (k: string): Vector3 | undefined => {
            const p3 = readP3(k, branchHint)
            if (p3) return p3
            const p2 = readP2(k, branchHint)
            return p2 ? { x: p2.x, y: p2.y, z: 0 } : undefined
          }
          const pts = resolvedPairs.map(readAnyPt)
          if (pts.some((p) => p === undefined)) {
            return failRepairable(name, "undeclared_entity_ref", `point(s) not materialized: ${targets.join(", ")}`)
          }
          const [pA, pB, pC, pD] = pts as [Vector3, Vector3, Vector3, Vector3]
          const u = { x: pB.x - pA.x, y: pB.y - pA.y, z: pB.z - pA.z }
          const v = { x: pD.x - pC.x, y: pD.y - pC.y, z: pD.z - pC.z }
          const uLen = Math.hypot(u.x, u.y, u.z)
          const vLen = Math.hypot(v.x, v.y, v.z)
          if (!(uLen > 1e-9 && vLen > 1e-9)) {
            return failRepairable(name, "degenerate_segment", "segments must have non-zero length")
          }
          const dot = u.x * v.x + u.y * v.y + u.z * v.z
          const residual = kind === "perpendicular"
            ? Math.abs(dot) / (uLen * vLen)
            : Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / (uLen * vLen)
          const satisfied = residual <= 1e-6
          let sharedInfo: Record<string, unknown> = {}
          if (kind === "perpendicular" && !satisfied) {
            const [s0, s1, s2, s3] = resolvedPairs
            const shared = s0 === s2 || s0 === s3 ? s0 : s1 === s2 || s1 === s3 ? s1 : undefined
            const oA = shared === s0 ? s1 : shared === s1 ? s0 : undefined
            const oB = shared === s2 ? s3 : shared === s3 ? s2 : undefined
            const pSh = shared ? readAnyPt(shared) : undefined
            const pOA = oA ? readAnyPt(oA) : undefined
            const pOB = oB ? readAnyPt(oB) : undefined
            if (shared && oA && oB && pSh && pOA && pOB) {
              const expectedHypotenuse = Math.hypot(distanceVector3(pOA, pSh), distanceVector3(pOB, pSh))
              const actualThirdEdge = distanceVector3(pOA, pOB)
              sharedInfo = {
                thirdEdge: `${oA}${oB}`,
                expectedHypotenuse,
                actualThirdEdge,
                points: { [s0]: pA, [s1]: pB, [s2]: pC, [s3]: pD }
              }
            } else {
              sharedInfo = { points: { [s0]: pA, [s1]: pB, [s2]: pC, [s3]: pD } }
            }
          }
          return {
            ok: true,
            status: "accepted",
            action: name,
            stateChanged: false,
            constraintStatus: satisfied ? "satisfied" : "violated",
            candidateHash: snap.candidateHash,
            stepIndex: snap.stepIndex,
            primitiveCount: snap.primitiveCount,
            measurement: { kind, residual, dot, ...sharedInfo, sourceEntityIds: targets }
          }
        }
        return failBlocked(name, "unsupported_observation", `constraint query kind "${kind}" is not supported`)
      }

      if (name === "repair_entity" || name === "repair_constraint") {
        const branchId = asString(input.branchId)
        if (branchId) {
          const history = branchHistory.get(branchId)
          const previous = history?.pop()
          if (!previous) return failRepairable(name, "no_branch_step", "no materialized step exists in this branch")
          const rolled = getTargetCanvas(branchId).revertToStep(previous.stepIndex)
          restoreBranchRefs(previous.refs, branchId)
          for (let i = recordedSlices.length - 1; i >= 0; i -= 1) {
            if (recordedSlices[i]?.branchId === branchId) recordedSlices.splice(i, 1)
          }
          recordedSlices.push(...previous.slices)
          for (const key of branchActionBuckets.keys()) {
            if (key.endsWith(`::${branchId}`)) branchActionBuckets.delete(key)
          }
          for (const [key, bucket] of previous.buckets) branchActionBuckets.set(key, bucket)
          if (history?.length === 0) branchCanvases.delete(branchId)
          return { ok: true, status: "accepted", action: name, stateChanged: true,
            candidateHash: rolled.candidateHash, stepIndex: rolled.stepIndex, primitiveCount: rolled.primitiveCount }
        }
        if ([...branchHistory.values()].some((history) => history.length > 0)) {
          return failBlocked(name, "active_branch_dependency", "repair a branch first; shared rollback with active branches is unsafe")
        }
        const targetRef = asString(input.target)
        let rollbackCount = 1
        if (targetRef) {
          for (let i = snap.actions.length - 1; i >= 0; i -= 1) {
            const inp = snap.actions[i]?.inputs as Record<string, unknown> | undefined
            if (inp?.alias === targetRef || inp?.label === targetRef) {
              rollbackCount = Math.max(1, snap.actions.length - i)
              break
            }
          }
        }
        const revertedAliases = snap.actions
          .slice(Math.max(0, snap.actions.length - rollbackCount))
          .map((action) => {
            const inp = action.inputs as Record<string, unknown> | undefined
            return String(inp?.alias ?? inp?.label ?? action.actionId)
          })
        const rolled = speculative.rollback(rollbackCount)
        const idx = Math.min(rolled.stepIndex, pointHistory.length - 1)
        const snapshotPts = pointHistory[idx] ?? pointHistory[0]!
        pointHistory.length = Math.max(1, rolled.stepIndex + 1)
        restoreRefs(snapshotPts)
        const snapSliceState = sliceHistory[Math.min(rolled.stepIndex, sliceHistory.length - 1)]
        sliceHistory.length = Math.max(1, rolled.stepIndex + 1)
        recordedSlices.splice(0, recordedSlices.length, ...(snapSliceState?.slices ?? []))
        sharedBranchlessActions.splice(0, sharedBranchlessActions.length, ...(snapSliceState?.sharedActions ?? []))
        branchActionBuckets.clear()
        branchCanvases.clear()
        for (const [bk, bv] of snapSliceState?.branchBuckets ?? []) {
          branchActionBuckets.set(bk, { ...bv, actions: [...bv.actions] })
        }
        const remainingPts = [...new Set([...points2.keys(), ...points3.keys()])].slice(0, 12)
        return {
          ok: true,
          status: "accepted",
          action: name,
          stateChanged: rolled.stepIndex < snap.stepIndex,
          revertedAliases,
          ...(revertedAliases.length > 1
            ? {
                repairHint: `Rolled back "${targetRef ?? "last"}" and ${revertedAliases.length - 1} later actions (${revertedAliases.join(", ")}); remaining materialized points: [${remainingPts.join(", ")}]. Reconstruct any needed entities before querying or finish_candidate.`
              }
            : {}),
          candidateHash: rolled.candidateHash,
          stepIndex: rolled.stepIndex,
          primitiveCount: rolled.primitiveCount
        }
      }

      if (name === "construct_point") {
        const id = asString(input.id ?? input.output) ?? `P${stepSeq}`
        const label = canonicalizePointLabel(asString(input.label) ?? id)
        pointLabelByKey.set(id, label)
        pointLabelByKey.set(label, label)
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const stateId = explicitStateId ?? "shared"
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const canvas = getTargetCanvas(branchId)
        const doc = canvas.currentDocument()
        const stagedActions = canvas.snapshot().actions
        const fromRaw = asString(input.from)
        const toRaw = asString(input.to)
        const fromId = fromRaw ? resolvePointLabel(fromRaw) : null
        const toId = toRaw ? resolvePointLabel(toRaw) : null
        const hostId = asString(input.hostId)
        const planePoints = asStringList(input.planePoints)
        const posObj = input.position && typeof input.position === "object" && !Array.isArray(input.position)
          ? (input.position as Record<string, unknown>)
          : null
        const x = asFiniteNumber(input.x ?? posObj?.x)
        const y = asFiniteNumber(input.y ?? posObj?.y)
        const z = asFiniteNumber(input.z ?? posObj?.z)
        const explicitParam = asFiniteNumber(input.parameter ?? input.u ?? input.ratio)
        const explicitV = asFiniteNumber(input.v)

        const findActionByAlias = (key: string) =>
          stagedActions.find((act) => {
            if (act.actionId === "planar.create_point" || act.actionId === "solid.create_point") return false
            const inp = act.inputs as { alias?: unknown; label?: unknown } | undefined
            return inp?.alias === key || inp?.label === key
          }) ?? stagedActions.find((act) => {
            const inp = act.inputs as { alias?: unknown; label?: unknown } | undefined
            return inp?.alias === key || inp?.label === key
          })

        const findHostPrimitive = (act: DraftAction) => findHostPrimitiveInDoc(doc, act)

        const resolveSolidEdgeHost = (fId: string, tId: string, ratioVal: number) => {
          for (const act of [...stagedActions].reverse()) {
            const inp = act.inputs as { alias?: unknown; label?: unknown; vertexNames?: unknown; points?: unknown } | undefined
            const alias = asString(inp?.alias)
            if (!alias) continue
            if (act.actionId === "solid.create_segment" && Array.isArray(inp?.vertexNames) && inp.vertexNames.length === 2) {
              if (inp.vertexNames[0] === fId && inp.vertexNames[1] === tId) return { mode: "host" as const, alias, parameter: ratioVal }
              if (inp.vertexNames[0] === tId && inp.vertexNames[1] === fId) return { mode: "host" as const, alias, parameter: 1 - ratioVal }
            }
            if ((act.actionId === "planar.create_segment" || act.actionId === "planar.create_line") && Array.isArray(inp?.points) && inp.points.length === 2) {
              const p2A = readP2(fId, branchId)
              const p2B = readP2(tId, branchId)
              const [ea, eb] = inp.points as Coordinate[]
              if (p2A && p2B && ea && eb) {
                if (Math.hypot(ea.x - p2A.x, ea.y - p2A.y) <= 1e-6 && Math.hypot(eb.x - p2B.x, eb.y - p2B.y) <= 1e-6) {
                  return { mode: "host" as const, alias, parameter: ratioVal }
                }
                if (Math.hypot(ea.x - p2B.x, ea.y - p2B.y) <= 1e-6 && Math.hypot(eb.x - p2A.x, eb.y - p2A.y) <= 1e-6) {
                  return { mode: "host" as const, alias, parameter: 1 - ratioVal }
                }
              }
            }
            const edgeMatch = findSolidEdgeHostSub(doc, act, fId, tId, readP3(fId, branchId), readP3(tId, branchId))
            if (edgeMatch) {
              return { mode: "hostSub" as const, alias, hostSub: edgeMatch.hostSub, parameter: edgeMatch.reversed ? 1 - ratioVal : ratioVal }
            }
          }
          return null
        }

        const recordBoundPointCoords = (expect3d: boolean) => {
          const updatedDoc = canvas.currentDocument()
          const created = [...updatedDoc.primitives].reverse().find(
            (p) => p.type === (expect3d ? "point3" : "point") && (p.label === label || p.label === id)
          )
          if (created?.type === "point3") {
            writeP3(id, created.position, branchId)
            writeP3(label, created.position, branchId)
            return created.position
          }
          if (created?.type === "point") {
            const pt = { x: created.x, y: created.y }
            writeP2(id, pt, branchId)
            writeP2(label, pt, branchId)
            return pt
          }
          return undefined
        }

        // Case 1: Point bound in a 3D plane/face (via planePoints or hostId -> face3)
        const hostAction = hostId ? findActionByAlias(hostId) : undefined
        const isExplicitFaceHost = hostAction?.actionId === "solid.create_face"
        if ((planePoints && planePoints.length >= 3) || isExplicitFaceHost) {
          let faceAlias = isExplicitFaceHost ? asString((hostAction!.inputs as { alias?: unknown }).alias)! : ""
          let faceSub: number | undefined
          let faceVerts: Vector3[] = []
          if (isExplicitFaceHost && !planePoints) {
            const fPrim = findHostPrimitive(hostAction!)
            if (fPrim?.type === "face3") {
              faceVerts = fPrim.pointIds
                .map((pid) => doc.primitives.find((p) => p.id === pid))
                .flatMap((p) => (p?.type === "point3" ? [p.position] : []))
            }
          } else if (planePoints) {
            if (new Set(planePoints).size < 3) {
              return failRepairable(name, "missing_required_parameter", "planePoints requires at least 3 distinct point names")
            }
            const ptsForPlane: Vector3[] = []
            for (const vn of planePoints) {
              const p2 = readP2(vn, branchId)
              const p3 = readP3(vn, branchId) ?? (p2 ? { x: p2.x, y: p2.y, z: 0 } : undefined)
              if (!p3) return failRepairable(name, "undeclared_entity_ref", `construct plane vertex "${vn}" before placing point "${id}" on it`)
              ptsForPlane.push(p3)
            }
            const basePl = planeFromPoints(ptsForPlane[0]!, ptsForPlane[1]!, ptsForPlane[2]!)
            if (!basePl) return failBlocked(name, "degenerate_face", "planePoints cannot be collinear")
            const baseFaceHost = faceHost3(ptsForPlane)
            if (!baseFaceHost) return failBlocked(name, "non_coplanar_face", "planePoints must be coplanar")

            const explicitPos = x !== null && y !== null && z !== null ? { x, y, z } : null
            const matchedExisting = findMatchingFaceInDoc(doc, stagedActions, ptsForPlane, explicitPos)
            if (matchedExisting) {
              faceAlias = matchedExisting.faceAlias
              faceSub = matchedExisting.faceSub
              faceVerts = matchedExisting.faceVerts
            } else {
              const needsExtendedQuad = explicitPos !== null && (() => {
                const offset = { x: explicitPos.x - ptsForPlane[0]!.x, y: explicitPos.y - ptsForPlane[0]!.y, z: explicitPos.z - ptsForPlane[0]!.z }
                const distPlane = Math.abs(offset.x * basePl.normal.x + offset.y * basePl.normal.y + offset.z * basePl.normal.z)
                if (distPlane > 1e-2) return false
                const proj = baseFaceHost.closestParameter(explicitPos)
                return distanceVector3(baseFaceHost.evaluate(proj), explicitPos) > 1e-3
              })()
              faceAlias = `face_${planePoints.join("")}_${stepSeq}`
              if (needsExtendedQuad && explicitPos) {
                const origin = ptsForPlane[0]!
                const d01 = { x: ptsForPlane[1]!.x - origin.x, y: ptsForPlane[1]!.y - origin.y, z: ptsForPlane[1]!.z - origin.z }
                const nLen = Math.hypot(basePl.normal.x, basePl.normal.y, basePl.normal.z)
                const nrm = { x: basePl.normal.x / nLen, y: basePl.normal.y / nLen, z: basePl.normal.z / nLen }
                const uLen = Math.hypot(d01.x, d01.y, d01.z)
                const axU = { x: d01.x / uLen, y: d01.y / uLen, z: d01.z / uLen }
                const axV = { x: nrm.y * axU.z - nrm.z * axU.y, y: nrm.z * axU.x - nrm.x * axU.z, z: nrm.x * axU.y - nrm.y * axU.x }
                const allPts = [...ptsForPlane, explicitPos]
                const uvPairs = allPts.map((pt) => {
                  const d = { x: pt.x - origin.x, y: pt.y - origin.y, z: pt.z - origin.z }
                  return { u: d.x * axU.x + d.y * axU.y + d.z * axU.z, v: d.x * axV.x + d.y * axV.y + d.z * axV.z }
                })
                const pad = 0.5
                const minU = Math.min(...uvPairs.map((p) => p.u)) - pad
                const maxU = Math.max(...uvPairs.map((p) => p.u)) + pad
                const minV = Math.min(...uvPairs.map((p) => p.v)) - pad
                const maxV = Math.max(...uvPairs.map((p) => p.v)) + pad
                const toWorld = (uu: number, vv: number): Vector3 => ({
                  x: origin.x + axU.x * uu + axV.x * vv,
                  y: origin.y + axU.y * uu + axV.y * vv,
                  z: origin.z + axU.z * uu + axV.z * vv
                })
                faceVerts = [toWorld(minU, minV), toWorld(maxU, minV), toWorld(maxU, maxV), toWorld(minU, maxV)]
                const stagedFace = stageDraftAction(
                  name,
                  { actionId: "solid.create_face", actionKey: `ds-act-${stepSeq}-face`, factIds: [], inputs: { alias: faceAlias, label: `平面 ${planePoints.join("")}`, vertices: faceVerts } } as DraftAction,
                  faceAlias,
                  undefined,
                  sliceTarget
                )
                if (!stagedFace.ok) return stagedFace
              } else {
                faceVerts = ptsForPlane
                const stagedFace = stageDraftAction(
                  name,
                  { actionId: "solid.create_face", actionKey: `ds-act-${stepSeq}-face`, factIds: [], inputs: { alias: faceAlias, label: `面 ${planePoints.join("")}`, vertices: faceVerts, vertexNames: planePoints } } as DraftAction,
                  faceAlias,
                  undefined,
                  sliceTarget
                )
                if (!stagedFace.ok) return stagedFace
              }
            }
          }

          const hostFace = faceHost3(faceVerts)
          if (!hostFace) return failBlocked(name, "degenerate_face", "host face cannot provide valid parameter domain")
          const explicitUvValid = explicitParam !== null && explicitV !== null && (() => {
            const evalP = hostFace.evaluate({ u: explicitParam, v: explicitV })
            const cl = hostFace.closestParameter(evalP)
            return Math.abs(cl.u - explicitParam) <= 1e-6 && cl.v !== undefined && Math.abs(cl.v - explicitV) <= 1e-6
          })()
          let uv: [number, number]
          if (explicitUvValid && explicitParam !== null && explicitV !== null) {
            uv = [explicitParam, explicitV]
          } else if (x !== null && y !== null && z !== null) {
            const p3 = { x, y, z }
            const proj = hostFace.closestParameter(p3)
            if (distanceVector3(hostFace.evaluate(proj), p3) > 1e-2) {
              return failRepairable(name, "not_on_face", `supplied coordinates (${x}, ${y}, ${z}) do not lie inside host face "${faceAlias}"`)
            }
            uv = [proj.u, proj.v ?? 0]
          } else if (explicitParam !== null && explicitV !== null) {
            uv = [explicitParam, explicitV]
          } else {
            const centroid: Vector3 = {
              x: faceVerts.reduce((s, p) => s + p.x, 0) / faceVerts.length,
              y: faceVerts.reduce((s, p) => s + p.y, 0) / faceVerts.length,
              z: faceVerts.reduce((s, p) => s + p.z, 0) / faceVerts.length
            }
            const proj = hostFace.closestParameter(centroid)
            uv = [proj.u, proj.v ?? 0]
          }
          entities.set(id, { id, kind: "point", scopeId, stateId })
          const stagedBound = stageDraftAction(
            name,
            {
              actionId: "dynamic.create_face_point",
              actionKey: `ds-act-${stepSeq}`,
              factIds: [],
              inputs: {
                alias: id,
                label,
                face: { scope: "draft", alias: faceAlias },
                ...(faceSub !== undefined ? { faceSub } : {}),
                uv
              }
            } as unknown as DraftAction,
            id,
            undefined,
            sliceTarget
          )
          if (stagedBound.ok) recordBoundPointCoords(true)
          return stagedBound
        }

        // Case 2: hostId targeting an already-staged 1D host or solid edge
        if (hostId) {
          if (!hostAction) {
            return failRepairable(name, "undeclared_entity_ref", `construct host entity "${hostId}" before binding point "${id}" to it`)
          }
          const hostAlias = asString((hostAction.inputs as { alias?: unknown }).alias) ?? hostId
          const isSolidHost = hostAction.actionId === "solid.create_polyhedron" || hostAction.actionId === "solid.create_prism" || hostAction.actionId === "solid.create_template"
          if (isSolidHost && fromId && toId) {
            const parameter = explicitParam ?? 0.5
            entities.set(id, { id, kind: "point", scopeId, stateId })
            const stagedBound = stageDraftAction(
              name,
              { actionId: "dynamic.create_bound_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, host: { scope: "draft", alias: hostAlias }, hostEdge: { from: fromId, to: toId }, parameter } } as unknown as DraftAction,
              id,
              undefined,
              sliceTarget
            )
            if (stagedBound.ok) recordBoundPointCoords(true)
            return stagedBound
          }

          const hostPrim = findHostPrimitive(hostAction)
          if (!hostPrim) {
            return failRepairable(name, "undeclared_entity_ref", `host "${hostId}" has no resolvable geometry primitive`)
          }
          const is3dHost = ["edge3", "line3", "segment3", "ray3", "circle3"].includes(hostPrim.type)
          let parameter = explicitParam
          if (parameter === null) {
            if (is3dHost && x !== null && y !== null && z !== null) {
              parameter = host3FromPrimitive(hostPrim, doc.primitives)?.closestParameter({ x, y, z }).u ?? null
            } else if (!is3dHost && x !== null && y !== null) {
              parameter = projectOntoPath(hostPrim, { x, y }, doc.parameters)
            }
          }
          if (parameter === null) {
            parameter = hostPrim.type === "circle" || hostPrim.type === "circle3" || hostPrim.type === "ellipse"
              ? Math.PI / 4
              : hostPrim.type === "parabola" || hostPrim.type === "hyperbola" || hostPrim.type === "function"
                ? 1
                : 0.5
          }
          entities.set(id, { id, kind: "point", scopeId, stateId })
          const stagedBound = stageDraftAction(
            name,
            { actionId: "dynamic.create_bound_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, host: { scope: "draft", alias: hostAlias }, parameter } } as unknown as DraftAction,
            id,
            undefined,
            sliceTarget
          )
          if (stagedBound.ok) {
            const pt = recordBoundPointCoords(is3dHost)
            if (!is3dHost && pt && "x" in pt && !("z" in pt)) return { ...stagedBound, position: pt }
          }
          return stagedBound
        }

        if (input.ratio !== undefined && asFiniteNumber(input.ratio) === null) {
          return failRepairable(name, "invalid_ratio", "ratio must be a finite number")
        }
        const ratio = fromId && toId ? (asFiniteNumber(input.ratio) ?? 0.5) : asFiniteNumber(input.ratio)

        if (fromId && toId && ratio !== null) {
          const p3A = readP3(fromId, branchId)
          const p3B = readP3(toId, branchId)
          if (p3A && p3B) {
            if (ratio < 0 || ratio > 1) {
              // Exact collinear affine extension point P = A + ratio*(B - A) (e.g. "延长 AB 至 D 使 BD = AB" -> ratio = 2)
              const pos3: Vector3 = {
                x: p3A.x + ratio * (p3B.x - p3A.x),
                y: p3A.y + ratio * (p3B.y - p3A.y),
                z: p3A.z + ratio * (p3B.z - p3A.z)
              }
              writeP3(id, pos3, branchId)
              writeP3(label, pos3, branchId)
              entities.set(id, { id, kind: "point", scopeId, stateId })
              return stageDraftAction(
                name,
                { actionId: "solid.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, position: pos3 } } as DraftAction,
                id,
                undefined,
                sliceTarget
              )
            }
            const solved = solveConstraint3d({ kind: "interior_ratio", targetKind: "edge", anchors: [p3A, p3B], ratio, resultName: id })
            const pos3 = solved.status === "solved" ? solved.pointRegistry[id] : undefined
            if (!pos3) return failRepairable(name, "invalid_ratio", solved.reason ?? "ratio must fall in [0, 1]")
            const resolvedHost = resolveSolidEdgeHost(fromId, toId, ratio)
            if (resolvedHost) {
              entities.set(id, { id, kind: "point", scopeId, stateId })
              const boundInputs = resolvedHost.mode === "hostSub"
                ? { alias: id, label, host: { scope: "draft", alias: resolvedHost.alias }, hostSub: resolvedHost.hostSub, parameter: resolvedHost.parameter }
                : { alias: id, label, host: { scope: "draft", alias: resolvedHost.alias }, parameter: resolvedHost.parameter }
              const stagedBound = stageDraftAction(
                name,
                { actionId: "dynamic.create_bound_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: boundInputs } as unknown as DraftAction,
                id,
                undefined,
                sliceTarget
              )
              if (stagedBound.ok) {
                writeP3(id, pos3, branchId)
                writeP3(label, pos3, branchId)
                return stagedBound
              }
            }
            writeP3(id, pos3, branchId)
            writeP3(label, pos3, branchId)
            entities.set(id, { id, kind: "point", scopeId, stateId })
            const actionKey = `ds-act-${stepSeq}`
            if (!branchId) {
              pendingEdgeBoundPoints.set(actionKey, { actionKey, id, label, fromId, toId, ratio, is3d: true })
            }
            return stageDraftAction(
              name,
              { actionId: "solid.create_point", actionKey, factIds: [], inputs: { alias: id, label, position: pos3 } } as DraftAction,
              id,
              undefined,
              sliceTarget
            )
          }
          const p2A = readP2(fromId, branchId)
          const p2B = readP2(toId, branchId)
          if (p2A && p2B) {
            if (ratio < 0 || ratio > 1) {
              const pos2 = {
                x: p2A.x + ratio * (p2B.x - p2A.x),
                y: p2A.y + ratio * (p2B.y - p2A.y)
              }
              writeP2(id, pos2, branchId)
              writeP2(label, pos2, branchId)
              entities.set(id, { id, kind: "point", scopeId, stateId })
              return stageDraftAction(
                name,
                { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [pos2] } },
                id,
                pos2,
                sliceTarget
              )
            }
            const solved2 = solveConstraint2d({ kind: "segment_ratio", a: p2A, b: p2B, ratio, splitBetween: true })
            const pos2 = solved2.status === "solved" ? solved2.roots[0]?.point : undefined
            if (!pos2) return failRepairable(name, "invalid_ratio", solved2.reason ?? "ratio out of range")
            const resolvedHost = resolveSolidEdgeHost(fromId, toId, ratio)
            if (resolvedHost && resolvedHost.mode === "host") {
              entities.set(id, { id, kind: "point", scopeId, stateId })
              const stagedBound = stageDraftAction(
                name,
                { actionId: "dynamic.create_bound_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, host: { scope: "draft", alias: resolvedHost.alias }, parameter: resolvedHost.parameter } } as unknown as DraftAction,
                id,
                pos2,
                sliceTarget
              )
              if (stagedBound.ok) {
                writeP2(id, pos2, branchId)
                writeP2(label, pos2, branchId)
                return stagedBound
              }
            }
            writeP2(id, pos2, branchId)
            writeP2(label, pos2, branchId)
            entities.set(id, { id, kind: "point", scopeId, stateId })
            const actionKey = `ds-act-${stepSeq}`
            if (!branchId) {
              pendingEdgeBoundPoints.set(actionKey, { actionKey, id, label, fromId, toId, ratio, is3d: false })
            }
            return stageDraftAction(
              name,
              { actionId: "planar.create_point", actionKey, factIds: [], inputs: { alias: id, label, points: [pos2] } },
              id,
              pos2,
              sliceTarget
            )
          }
          return failRepairable(name, "undeclared_entity_ref", `missing endpoint(s) "${fromId}", "${toId}"`)
        }

        if (options.workspace === "geometry3d" || z !== null) {
          if (x === null || y === null || z === null) {
            return failRepairable(name, "missing_required_parameter", "3D construct_point requires finite x, y, z, hostId, planePoints, or edge ratio (from, to, ratio)")
          }
          const pos3: Vector3 = { x, y, z }
          writeP3(id, pos3, branchId)
          writeP3(label, pos3, branchId)
          entities.set(id, { id, kind: "point", scopeId, stateId })
          return stageDraftAction(
            name,
            { actionId: "solid.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, position: pos3 } } as DraftAction,
            id,
            undefined,
            sliceTarget
          )
        }
        if (x === null || y === null) {
          return failRepairable(name, "missing_required_parameter", "construct_point requires finite x, y, hostId, or (from, to, ratio)")
        }
        const pt = { x, y }
        writeP2(id, pt, branchId)
        writeP2(label, pt, branchId)
        entities.set(id, { id, kind: "point", scopeId, stateId })
        return stageDraftAction(
          name,
          { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [pt] } },
          id,
          pt,
          sliceTarget
        )
      }

      if (name === "construct_segment" || name === "construct_line") {
        const id = asString(input.id ?? input.output) ?? `L${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const fromRaw = asString(input.from)
        const toRaw = asString(input.to)
        const fromId = fromRaw ? resolvePointLabel(fromRaw) : null
        const toId = toRaw ? resolvePointLabel(toRaw) : null
        if (name === "construct_segment") {
          if (Object.keys(input).some(key => !Object.hasOwn(CONSTRUCT_SEGMENT_PARAMETERS.properties, key))) {
            return failRepairable(name, "invalid_schema", "construct_segment accepts only named from/to points and optional display identifiers")
          }
          if (!fromId || !toId) {
            return failRepairable(name, "missing_required_parameter", "construct_segment requires both from and to materialized point names")
          }
        }
        const eqString = name === "construct_line" ? asString(input.equation) : null
        const slopeVal = name === "construct_line" ? asFiniteNumber(input.slope ?? input.k) : null
        const chordConicId = name === "construct_line" ? asString(input.conicId) : null
        const chordRatioVal = name === "construct_line" ? asPositiveNumber(input.chordRatio) : null
        const hasAbcEquation = name === "construct_line" && ["a", "b", "c"].some((key) => Object.hasOwn(input, key))
        const rawThroughPtId = name === "construct_line" ? asString(input.throughPointId ?? input.pointId) : null
        // Allow `{ from: "A", slope: 1 }` (without `to`) as a natural alias for `throughPointId: "A"`
        const throughPtId =
          rawThroughPtId ??
          (name === "construct_line" && !Object.hasOwn(input, "to") && fromId !== null && (slopeVal !== null || chordRatioVal !== null || Object.hasOwn(input, "dx") || Object.hasOwn(input, "dy"))
            ? fromId
            : null)
        const interceptVal = name === "construct_line" ? asFiniteNumber(input.intercept) : null
        if (eqString !== null || hasAbcEquation || slopeVal !== null || throughPtId !== null || chordRatioVal !== null) {
          const hasExplicitEndpointConflict =
            Object.hasOwn(input, "to") ||
            (Object.hasOwn(input, "from") && (throughPtId === null || fromId !== throughPtId))
          if (hasExplicitEndpointConflict) {
            return failRepairable(
              name,
              "ambiguous_geometry_input",
              `construct_line "${asString(input.id) ?? ""}" received both endpoint (from/to) and equation/slope fields; use EITHER {from, to} OR {throughPointId, slope/dx,dy} OR {throughPointId, conicId, chordRatio} OR {equation}, never mix them`
            )
          }
          let endpoints: [Coordinate, Coordinate]
          let chordReceipt: Record<string, unknown> | undefined
          if (eqString !== null) {
            const parsed = parseLinearEquation(eqString)
            if (!parsed) return failRepairable(name, "invalid_equation", "cannot parse linear equation string")
            const { a, b, c } = parsed
            endpoints = Math.abs(b) >= Math.abs(a)
              ? [{ x: 0, y: -c / b }, { x: 1, y: -(a + c) / b }]
              : [{ x: -c / a, y: 0 }, { x: -(b + c) / a, y: 1 }]
          } else if (throughPtId !== null && chordConicId !== null && chordRatioVal !== null) {
            const basePt = readP2(throughPtId, branchId)
            if (!basePt) return failRepairable(name, "undeclared_entity_ref", `construct point "${throughPtId}" before referencing it`)
            const targetConic = readC2(chordConicId, branchId)
            if (!targetConic) return failRepairable(name, "undeclared_entity_ref", `construct conic/circle "${chordConicId}" before referencing it`)
            const lam = chordRatioVal
            let auxA: number, auxB: number, auxD: number, ox: number, oy: number
            if (targetConic.type === "ellipse" || targetConic.type === "circle" || targetConic.type === "hyperbola") {
              ox = targetConic.center.x
              oy = targetConic.center.y
              const a = targetConic.type === "circle" ? targetConic.radius : targetConic.radiusX
              const b = targetConic.type === "circle" ? targetConic.radius : targetConic.radiusY
              const sx = targetConic.type === "hyperbola" && targetConic.axis === "y" ? -1 : 1
              const sy = targetConic.type === "hyperbola" && targetConic.axis === "x" ? -1 : 1
              const uc = basePt.x - ox
              const vc = basePt.y - oy
              auxA = (-2 * lam * (1 + lam) * sx * uc) / (a * a)
              auxB = (-2 * lam * (1 + lam) * sy * vc) / (b * b)
              auxD = (1 + lam) * (1 + lam) * ((sx * uc * uc) / (a * a) + (sy * vc * vc) / (b * b)) - (1 - lam * lam)
            } else {
              ox = targetConic.vertex.x
              oy = targetConic.vertex.y
              const p = targetConic.focalParameter
              const uc = basePt.x - ox
              const vc = basePt.y - oy
              if (targetConic.axis === "x") {
                auxA = 2 * p * lam
                auxB = -2 * lam * vc
                auxD = (1 + lam) * vc * vc - 2 * p * uc
              } else {
                auxA = -2 * lam * uc
                auxB = 2 * p * lam
                auxD = (1 + lam) * uc * uc - 2 * p * vc
              }
            }
            if (Math.hypot(auxA, auxB) <= 1e-12) {
              if (Math.abs(lam - 1) <= 1e-9) {
                endpoints = [basePt, { x: basePt.x + 1, y: basePt.y + 0.5 }]
              } else {
                return failBlocked(name, "infeasible", `no chord through "${throughPtId}" on "${chordConicId}" can satisfy ratio ${lam}`)
              }
            } else {
              const auxPts: [Coordinate, Coordinate] = Math.abs(auxB) >= Math.abs(auxA)
                ? [{ x: ox, y: oy - auxD / auxB }, { x: ox + 1, y: oy - (auxA + auxD) / auxB }]
                : [{ x: ox - auxD / auxA, y: oy }, { x: ox - (auxB + auxD) / auxA, y: oy + 1 }]
              const hits = intersectPlanarLineAndConicExact({ type: "line", a: auxPts[0], b: auxPts[1] }, targetConic).points
              const candidates = hits
                .filter((ptF) => Math.hypot(ptF.x - basePt.x, ptF.y - basePt.y) > 1e-6)
                .map((ptF) => {
                  const ptE = { x: (1 + lam) * basePt.x - lam * ptF.x, y: (1 + lam) * basePt.y - lam * ptF.y }
                  const dx = ptE.x - ptF.x
                  const dy = ptE.y - ptF.y
                  const slope = Math.abs(dx) > 1e-9 ? dy / dx : Number.POSITIVE_INFINITY
                  return { ptE, ptF, slope }
                })
                .sort((c1, c2) => c2.slope - c1.slope)
              if (candidates.length === 0) {
                return failBlocked(name, "infeasible", `no real chord through "${throughPtId}" on "${chordConicId}" satisfies vector ratio ${lam}`)
              }
              const branchIdx = asFiniteNumber(input.branch)
              const chosen = candidates[branchIdx !== null && branchIdx >= 0 && branchIdx < candidates.length ? Math.trunc(branchIdx) : 0]!
              endpoints = [basePt, chosen.ptE]
              chordReceipt = {
                chordRatio: lam,
                slope: Number.isFinite(chosen.slope) ? Number(chosen.slope.toFixed(6)) : "vertical",
                chordEndpoints: {
                  E: { x: Number(chosen.ptE.x.toFixed(6)), y: Number(chosen.ptE.y.toFixed(6)) },
                  F: { x: Number(chosen.ptF.x.toFixed(6)), y: Number(chosen.ptF.y.toFixed(6)) }
                }
              }
            }
          } else if (throughPtId !== null) {
            const basePt = readP2(throughPtId, branchId)
            if (!basePt) return failRepairable(name, "undeclared_entity_ref", `construct point "${throughPtId}" before referencing it`)
            const dx = asFiniteNumber(input.dx)
            const dy = asFiniteNumber(input.dy)
            if (slopeVal !== null) {
              endpoints = [basePt, { x: basePt.x + 1, y: basePt.y + slopeVal }]
            } else if (interceptVal !== null && Math.abs(basePt.x) > 1e-9) {
              endpoints = [{ x: 0, y: interceptVal }, basePt]
            } else if (dx !== null && dy !== null && Math.hypot(dx, dy) > 1e-9) {
              endpoints = [basePt, { x: basePt.x + dx, y: basePt.y + dy }]
            } else {
              return failRepairable(name, "missing_required_parameter", "throughPointId requires finite slope/k, non-zero dx/dy (use dx: 0, dy: 1 for vertical), conicId+chordRatio, or equation")
            }
          } else if (slopeVal !== null) {
            const b = asFiniteNumber(input.intercept) ?? 0
            endpoints = [{ x: 0, y: b }, { x: 1, y: slopeVal + b }]
          } else {
            const a = asFiniteNumber(input.a)
            const b = asFiniteNumber(input.b)
            const c = asFiniteNumber(input.c)
            if (a === null || b === null || c === null) {
              return failRepairable(name, "missing_required_parameter", "line equation requires finite numeric a,b,c")
            }
            if (a === 0 && b === 0) return failRepairable(name, "degenerate_line", "a and b cannot both be zero")
            endpoints = Math.abs(b) >= Math.abs(a)
              ? [{ x: 0, y: -c / b }, { x: 1, y: -(a + c) / b }]
              : [{ x: -c / a, y: 0 }, { x: -(b + c) / a, y: 1 }]
          }
          if (!endpoints || endpoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
              Math.hypot(endpoints[0].x - endpoints[1].x, endpoints[0].y - endpoints[1].y) < 1e-9) {
            return failRepairable(name, "degenerate_line", "equation cannot produce two distinct finite points")
          }
          writeL2(id, { a: endpoints[0], b: endpoints[1] }, branchId)
          writeL2(label, { a: endpoints[0], b: endpoints[1] }, branchId)
          const stagedLine = stageDraftAction(
            name,
            { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [],
              inputs: { alias: id, label, points: endpoints } },
            id, undefined, sliceTarget
          )
          return stagedLine.ok && chordReceipt ? { ...stagedLine, measurement: chordReceipt } : stagedLine
        }
        if (name === "construct_line" && (!fromId || !toId)) {
          return failRepairable(name, "missing_required_parameter", "construct_line requires both from/to or finite a,b,c")
        }
        const p3A = fromId ? readP3(fromId, branchId) : undefined
        const p3B = toId ? readP3(toId, branchId) : undefined
        if (p3A && p3B && fromId && toId) {
          const ensurePoint3Materialized = (ptName: string, pos: Vector3): void => {
            const curDoc = getTargetCanvas(branchId).currentDocument()
            const hasPoint3 = curDoc.primitives.some((p) => p.type === "point3" && p.label === ptName)
            if (!hasPoint3) {
              stageDraftAction(
                name,
                { actionId: "solid.create_point", actionKey: `ds-act-${stepSeq}-pt-${ptName}`, factIds: [], inputs: { alias: `pt_${ptName}_${stepSeq}`, label: ptName, position: pos } } as DraftAction,
                undefined,
                undefined,
                sliceTarget
              )
            }
          }
          ensurePoint3Materialized(fromId, p3A)
          ensurePoint3Materialized(toId, p3B)
          return stageDraftAction(
            name,
            { actionId: "solid.create_segment", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, vertexNames: [fromId, toId] } } as DraftAction,
            id,
            undefined,
            sliceTarget
          )
        }
        const p1 = fromId ? readP2(fromId, branchId) : undefined
        const p2 = toId ? readP2(toId, branchId) : undefined
        if (!p1 || !p2) {
          return failRepairable(name, "undeclared_entity_ref", `construct points before referencing "${fromId ?? "?"}" and "${toId ?? "?"}"`)
        }
        writeL2(id, { a: p1, b: p2 }, branchId)
        writeL2(label, { a: p1, b: p2 }, branchId)
        if (fromId && toId) {
          if (!readL2(`${fromId}${toId}`, branchId)) writeL2(`${fromId}${toId}`, { a: p1, b: p2 }, branchId)
          if (!readL2(`${toId}${fromId}`, branchId)) writeL2(`${toId}${fromId}`, { a: p1, b: p2 }, branchId)
        }
        return stageDraftAction(
          name,
          {
            actionId: name === "construct_segment" ? "planar.create_segment" : "planar.create_line",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: { alias: id, label, points: [p1, p2] }
          },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_intersection") {
        if (Object.keys(input).some(key => !Object.hasOwn(CONSTRUCT_INTERSECTION_PARAMETERS.properties, key))) {
          return failRepairable(name, "invalid_schema", "construct_intersection accepts only its published fields")
        }
        if (input.selection !== undefined && !["min_x", "max_x", "min_y", "max_y"].includes(String(input.selection))) {
          return failRepairable(name, "invalid_selection", "selection must be min_x, max_x, min_y or max_y")
        }
        const rawConicInput = input.conicId ?? input.circleId ?? input.curveId
        if (input.lineB !== undefined && rawConicInput !== undefined) {
          return failRepairable(name, "ambiguous_geometry_input", "choose exactly one of lineB or conicId")
        }
        if (!asString(input.lineA) || (!asString(input.lineB) && !asString(rawConicInput))) {
          return failRepairable(name, "missing_required_parameter", "lineA and exactly one of lineB or conicId are required")
        }
        const outId = asString(input.output ?? input.id) ?? `X${stepSeq}`
        const outLabel = canonicalizePointLabel(asString(input.label) ?? outId)
        pointLabelByKey.set(outId, outLabel)
        pointLabelByKey.set(outLabel, outLabel)
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const lineAKey = asString(input.lineA) ?? ""
        const lineBKey = asString(input.lineB) ?? ""
        const lA = lineAKey ? readL2(lineAKey, branchId) : undefined
        const lB = lineBKey ? readL2(lineBKey, branchId) : undefined
        const conicId = asString(rawConicInput)
        const cA = !lA && lineAKey ? readC2(lineAKey, branchId) : undefined
        const resolvedConicBId = conicId ?? (!lB && lineBKey ? lineBKey : null)
        const conic = (conicId ? readC2(conicId, branchId) : undefined) ?? (!lB && lineBKey ? readC2(lineBKey, branchId) : undefined)
        if (input.selection !== undefined && !cA && !conic) {
          return failRepairable(name, "invalid_selection", "selection applies only to line-conic or circle intersections")
        }
        const pairKey = [lineAKey, conicId ?? lineBKey].sort().join("|")
        const selectAndCommitIntersection = (points: Array<{ x: number; y: number }>) => {
          const selection = input.selection as "min_x" | "max_x" | "min_y" | "max_y" | undefined
          const excludePtId = asString(input.excludePointId)
          const excludePt = excludePtId ? readP2(excludePtId, branchId) : undefined
          if (excludePtId && !excludePt) {
            return failRepairable(name, "undeclared_entity_ref", `construct point "${excludePtId}" before using excludePointId`)
          }
          const candidatePoints = excludePt
            ? points.filter((p) => Math.hypot(p.x - excludePt.x, p.y - excludePt.y) > 1e-6)
            : points
          if (candidatePoints.length === 0) {
            return failRepairable(
              name,
              "no_distinct_intersection",
              `all intersection(s) coincide with excludePointId "${excludePtId}" (the line may be tangent to the conic or parallel to a hyperbola asymptote, leaving only 1 intersection); adjust the line slope so there are 2 distinct intersections`
            )
          }
          let pt = candidatePoints[0]!
          if (candidatePoints.length > 1) {
            if (selection) {
              const axis = selection.endsWith("x") ? "x" : "y"
              const otherAxis = axis === "x" ? "y" : "x"
              const ascending = [...candidatePoints].sort((a, b) =>
                Math.abs(a[axis] - b[axis]) > 1e-9
                  ? a[axis] - b[axis]
                  : a[otherAxis] - b[otherAxis]
              )
              const isMin = selection.startsWith("min")
              const chosen = isMin ? ascending[0]! : ascending[ascending.length - 1]!
              const runnerUp = isMin ? ascending[1]! : ascending[ascending.length - 2]!
              if (Math.abs(chosen[axis] - runnerUp[axis]) <= 1e-9) {
                return failRepairable(name, "ambiguous_intersection", `two intersections share the same extreme ${axis} coordinate under selection=${selection}`)
              }
              pt = chosen
            } else if (excludePt) {
              pt = [...candidatePoints].sort(
                (a, b) => Math.hypot(b.x - excludePt.x, b.y - excludePt.y) - Math.hypot(a.x - excludePt.x, a.y - excludePt.y)
              )[0]!
            } else {
              return failRepairable(name, "ambiguous_intersection", "entities intersect at multiple points; specify selection (min_x/max_x/min_y/max_y) or excludePointId")
            }
          }
          const bKey = branchId ?? ""
          const liveCoincident = intersectionRecords.find((rec) => {
            if (rec.branch !== bKey || rec.pairKey !== pairKey) return false
            if (rec.id === outId || rec.label === outLabel) return false
            const currentPos = readP2(rec.id, branchId) ?? readP2(rec.label, branchId)
            return currentPos !== undefined && Math.hypot(currentPos.x - pt.x, currentPos.y - pt.y) <= 1e-6
          })
          if (liveCoincident) {
            const otherPt = points.find((p) => Math.hypot(p.x - pt.x, p.y - pt.y) > 1e-6)
            const hint = otherPt
              ? `selected intersection coincides with existing point "${liveCoincident.label}" at (${Number(pt.x.toFixed(4))}, ${Number(pt.y.toFixed(4))}); pass excludePointId: "${liveCoincident.label}" or opposite selection to pick the other intersection at (${Number(otherPt.x.toFixed(4))}, ${Number(otherPt.y.toFixed(4))})`
              : `line is tangent to conic (only 1 intersection at (${Number(pt.x.toFixed(4))}, ${Number(pt.y.toFixed(4))}), already occupied by "${liveCoincident.label}"); adjust the line slope so there are 2 distinct intersections`
            return failRepairable(name, "duplicate_intersection_point", hint)
          }
          writeP2(outId, pt, branchId)
          writeP2(outLabel, pt, branchId)
          const staged = stageDraftAction(
            name,
            { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: outId, label: outLabel, points: [pt] } },
            outId,
            pt,
            sliceTarget
          )
          if (staged.ok) {
            intersectionRecords.push({ branch: bKey, pairKey, id: outId, label: outLabel, pt })
          }
          return staged
        }
        const activeLine = lA ?? (cA ? lB : undefined)
        const activeConic = conic ?? (lB ? cA : undefined)
        const activeConicId = (conic ? resolvedConicBId : cA ? lineAKey : null) ?? "conic"
        if (activeLine && activeConic) {
          const res = intersectPlanarLineAndConicExact({ type: "line", a: activeLine.a, b: activeLine.b }, activeConic)
          if (res.points.length === 0) {
            const conicSummary = activeConic.type === "ellipse" || activeConic.type === "hyperbola"
              ? `${activeConic.type} "${activeConicId}" (center=(${activeConic.center.x}, ${activeConic.center.y}), rx=${activeConic.radiusX}, ry=${activeConic.radiusY})`
              : activeConic.type === "circle"
                ? `circle "${activeConicId}" (center=(${activeConic.center.x}, ${activeConic.center.y}), radius=${activeConic.radius})`
                : `parabola "${activeConicId}" (vertex=(${activeConic.vertex.x}, ${activeConic.vertex.y}), axis=${activeConic.axis}, p=${activeConic.focalParameter})`
            return failRepairable(
              name,
              "no_intersection",
              `line does not intersect ${conicSummary}. Stop guessing random slopes: construct an interior point Q strictly inside the conic (e.g. near center/axis) and draw construct_line({ from: P, to: "Q" }) to guarantee 2 intersections, or use a valid intersecting slope.`
            )
          }
          return selectAndCommitIntersection(res.points)
        }
        if (cA && conic) {
          if (cA.type === "circle" && conic.type === "circle") {
            const dx = conic.center.x - cA.center.x
            const dy = conic.center.y - cA.center.y
            const d = Math.hypot(dx, dy)
            if (d <= 1e-9) {
              if (Math.abs(cA.radius - conic.radius) <= 1e-9) {
                return failRepairable(name, "ambiguous_intersection", `circles "${lineAKey}" and "${resolvedConicBId ?? ""}" are coincident`)
              }
              return failRepairable(name, "no_intersection", `concentric circles "${lineAKey}" (r=${cA.radius}) and "${resolvedConicBId ?? ""}" (r=${conic.radius}) have no intersection`)
            }
            if (d > cA.radius + conic.radius + 1e-9 || d < Math.abs(cA.radius - conic.radius) - 1e-9) {
              return failRepairable(
                name,
                "no_intersection",
                `circles "${lineAKey}" (r=${cA.radius}) and "${resolvedConicBId ?? ""}" (r=${conic.radius}) at center distance ${Number(d.toFixed(6))} do not intersect`
              )
            }
            const aDist = (cA.radius * cA.radius - conic.radius * conic.radius + d * d) / (2 * d)
            const mx = cA.center.x + (aDist * dx) / d
            const my = cA.center.y + (aDist * dy) / d
            const ux = -dy / d
            const uy = dx / d
            const res = intersectPlanarLineAndConicExact(
              { type: "line", a: { x: mx - ux, y: my - uy }, b: { x: mx + ux, y: my + uy } },
              cA
            )
            if (res.points.length === 0) {
              return failRepairable(name, "no_intersection", `circles "${lineAKey}" and "${resolvedConicBId ?? ""}" do not intersect`)
            }
            return selectAndCommitIntersection(res.points)
          }
          const circle = cA.type === "circle" ? cA : conic.type === "circle" ? conic : null
          const ellipse = cA.type === "ellipse" ? cA : conic.type === "ellipse" ? conic : null
          if (circle && ellipse && Math.hypot(circle.center.x - ellipse.center.x, circle.center.y - ellipse.center.y) <= 1e-9) {
            const a = ellipse.radiusX
            const b = ellipse.radiusY
            const r = circle.radius
            const minAxis = Math.min(a, b)
            const maxAxis = Math.max(a, b)
            if (Math.abs(a - b) <= 1e-9) {
              return Math.abs(r - a) <= 1e-9
                ? failRepairable(name, "ambiguous_intersection", `circle "${lineAKey}" and degenerate circle-ellipse are coincident`)
                : failRepairable(name, "no_intersection", `circle (r=${r}) and concentric ellipse (rx=ry=${a}) have no intersection`)
            }
            if (r < minAxis - 1e-9 || r > maxAxis + 1e-9) {
              if (r < minAxis - 1e-9) sawInfeasibleConicPerp = true
              return failRepairable(
                name,
                "no_intersection",
                `circle (center=(${circle.center.x}, ${circle.center.y}), r=${r}) lies ${r < minAxis ? "strictly inside" : "strictly outside"} concentric ellipse (rx=${a}, ry=${b}): ZERO intersections exist (for Thales circle r=c < b, PF1⊥PF2 is geometrically infeasible; keep subquestion 1 entities, omit P, and finish with scopeId: "subquestion:1" + answer)`
              )
            }
            const u2 = Math.max(0, (a * a * (r * r - b * b)) / (a * a - b * b))
            const v2 = Math.max(0, (b * b * (a * a - r * r)) / (a * a - b * b))
            const sx = u2 <= 1e-12 ? [0] : [-Math.sqrt(u2), Math.sqrt(u2)]
            const sy = v2 <= 1e-12 ? [0] : [-Math.sqrt(v2), Math.sqrt(v2)]
            const pts: Array<{ x: number; y: number }> = []
            for (const dx of sx) {
              for (const dy of sy) {
                pts.push({ x: ellipse.center.x + dx, y: ellipse.center.y + dy })
              }
            }
            return selectAndCommitIntersection(pts)
          }
          return failRepairable(
            name,
            "unsupported_intersection",
            `conic-conic intersection for "${lineAKey}" (${cA.type}) and "${resolvedConicBId ?? ""}" (${conic.type}) only supports circle-circle or concentric circle-ellipse; intersect a constructed line with the conic instead`
          )
        }
        if (!lA || !lB) {
          const missingParts = [
            !lA && !cA ? `lineA="${lineAKey}"` : null,
            conicId && !conic ? `conicId="${conicId}"` : null,
            !conicId && !lB && !conic ? `lineB="${lineBKey}"` : null
          ].filter(Boolean).join(", ")
          return failRepairable(name, "undeclared_entity_ref", `declare/construct lines or conic before construct_intersection (missing: ${missingParts || `${lineAKey}, ${conicId ?? lineBKey}`}; see referenceDirectory for materialized aliases)`)
        }
        const dx1 = lA.b.x - lA.a.x, dy1 = lA.b.y - lA.a.y
        const dx2 = lB.b.x - lB.a.x, dy2 = lB.b.y - lB.a.y
        const det = dx1 * dy2 - dy1 * dx2
        if (Math.abs(det) <= 1e-9) {
          return failRepairable(name, "parallel_lines", "lines are parallel or collinear; choose another line slope or point parameter so they intersect")
        }
        const t = ((lB.a.x - lA.a.x) * dy2 - (lB.a.y - lA.a.y) * dx2) / det
        const pt = { x: lA.a.x + t * dx1, y: lA.a.y + t * dy1 }
        writeP2(outId, pt, branchId)
        writeP2(outLabel, pt, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: outId, label: outLabel, points: [pt] } },
          outId,
          pt,
          sliceTarget
        )
      }

      if (name === "construct_circle") {
        const has3dStaged = speculative.snapshot().actions.some((action) =>
          action.actionId.startsWith("solid.") || action.actionId.startsWith("derived.")
        )
        if (options.workspace === "geometry3d" || has3dStaged) {
          return failRepairable(
            name,
            "workspace_mismatch",
            "This is a 3D solid scene; do NOT use 2D construct_circle. Use construct_circumsphere(solidId=...) for a circumsphere or construct_solid(kind='sphere', radius=..., origin=...) for a 3D sphere."
          )
        }
        const id = asString(input.id ?? input.output) ?? `C${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const eqStr = asString(input.equation)
        const parsedCircle = eqStr ? parseConicEquation(eqStr) : null
        if (eqStr && (!parsedCircle || parsedCircle.conicType !== "circle")) {
          return failRepairable(name, "invalid_equation", "cannot parse circle equation string")
        }
        const centerId = asString(input.centerId)
        const centerPt = centerId ? readP2(centerId, branchId) : undefined
        if (centerId && !centerPt) {
          return failRepairable(name, "undeclared_entity_ref", `construct center point "${centerId}" first`)
        }
        const centerObj = input.center && typeof input.center === "object" && !Array.isArray(input.center)
          ? (input.center as Record<string, unknown>)
          : null
        const cx = parsedCircle?.conicType === "circle"
          ? parsedCircle.cx
          : (centerPt?.x ?? asFiniteNumber(input.cx ?? centerObj?.x) ?? 0)
        const cy = parsedCircle?.conicType === "circle"
          ? parsedCircle.cy
          : (centerPt?.y ?? asFiniteNumber(input.cy ?? centerObj?.y) ?? 0)
        const r = parsedCircle?.conicType === "circle"
          ? parsedCircle.radius
          : asFiniteNumber(input.radius ?? input.r)
        if (r === null || !(r > 0)) {
          return failRepairable(name, "missing_required_parameter", "construct_circle requires positive radius or circle equation")
        }
        const circ: PlanarConic = { id, type: "circle", center: { x: cx, y: cy }, radius: r }
        writeC2(id, circ, branchId)
        writeC2(label, circ, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_circle", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, center: { x: cx, y: cy }, radius: r } },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_conic") {
        const id = asString(input.id ?? input.output) ?? `C${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const eqStr = asString(input.equation)
        const parsedEq = eqStr ? parseConicEquation(eqStr) : null
        if (eqStr && !parsedEq) {
          return failRepairable(name, "invalid_equation", "cannot parse conic equation string")
        }
        if (parsedEq?.conicType === "circle") {
          const circ: PlanarConic = { id, type: "circle", center: { x: parsedEq.cx, y: parsedEq.cy }, radius: parsedEq.radius }
          writeC2(id, circ, branchId)
          writeC2(label, circ, branchId)
          return stageDraftAction(
            name,
            { actionId: "planar.create_circle", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, center: { x: parsedEq.cx, y: parsedEq.cy }, radius: parsedEq.radius } },
            id,
            undefined,
            sliceTarget
          )
        }
        const rawType = asString(input.conicType)?.toLowerCase() ?? parsedEq?.conicType
        if (!rawType) return failRepairable(name, "missing_required_parameter", "construct_conic requires conicType (ellipse | hyperbola | parabola) or equation")
        if (rawType !== "ellipse" && rawType !== "hyperbola" && rawType !== "parabola") {
          return failRepairable(name, "unsupported_conic_kind", "construct_conic supports only ellipse, hyperbola, or parabola; use construct_circle for circles")
        }
        if (input.axis !== undefined && input.axis !== "x" && input.axis !== "y") {
          return failRepairable(name, "invalid_axis", "axis must be x or y")
        }
        for (const field of ["cx", "cy", "vx", "vy"] as const) {
          if (input[field] !== undefined && asFiniteNumber(input[field]) === null) {
            return failRepairable(name, "invalid_center", `${field} must be a finite number`)
          }
        }
        const hasFocusOrEcc = input.c !== undefined || input.e !== undefined || input.eccentricity !== undefined
        const rxInput = asFiniteNumber(input.radiusX)
        const ryInput = asFiniteNumber(input.radiusY)
        const axisConflictEllipse =
          rawType === "ellipse" &&
          (input.axis === "x" || input.axis === "y") &&
          parsedEq === null &&
          input.throughPointIds === undefined &&
          input.a === undefined &&
          input.b === undefined &&
          !hasFocusOrEcc &&
          (rxInput === null || ryInput === null || (input.axis === "y" ? rxInput > ryInput : ryInput > rxInput))
        const incompatible = rawType === "parabola"
          ? ["radiusX", "radiusY", "throughPointIds"].some((field) => input[field] !== undefined)
          : ["vx", "vy", "focalParameter"].some((field) => input[field] !== undefined) || axisConflictEllipse
        if (incompatible) {
          return failRepairable(
            name,
            "incompatible_conic_fields",
            axisConflictEllipse
              ? `ellipse with axis="${String(input.axis)}" conflicts with radiusX=${rxInput}, radiusY=${ryInput} (major axis must match axis; ensure radiusX/radiusY are semi-axes NOT a²/b², or omit them and pass equation or throughPointIds)`
              : "the selected conic kind cannot use these geometry fields"
          )
        }
        if (rawType === "parabola") {
          const focalParameter = parsedEq?.conicType === "parabola"
            ? parsedEq.focalParameter
            : asFiniteNumber(input.focalParameter ?? input.p)
          const axis = input.axis === "x" || input.axis === "y"
            ? input.axis
            : parsedEq?.conicType === "parabola"
              ? parsedEq.axis
              : "y"
          const vx = asFiniteNumber(input.vx ?? input.cx) ?? (parsedEq?.conicType === "parabola" ? parsedEq.vx : 0)
          const vy = asFiniteNumber(input.vy ?? input.cy) ?? (parsedEq?.conicType === "parabola" ? parsedEq.vy : 0)
          if (focalParameter === null || Math.abs(focalParameter) <= 1e-9) {
            return failRepairable(name, "missing_required_parameter", "parabola requires non-zero focalParameter")
          }
          const conic: PlanarConic = { id, type: "parabola", vertex: { x: vx, y: vy }, axis, focalParameter }
          writeC2(id, conic, branchId)
          writeC2(label, conic, branchId)
          return stageDraftAction(
            name,
            { actionId: "planar.create_conic", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, kind: "parabola", vertex: { x: vx, y: vy }, axis, focalParameter } },
            id,
            undefined,
            sliceTarget
          )
        }
        const center = {
          x: asFiniteNumber(input.cx) ?? (parsedEq && parsedEq.conicType !== "parabola" ? parsedEq.cx : 0),
          y: asFiniteNumber(input.cy) ?? (parsedEq && parsedEq.conicType !== "parabola" ? parsedEq.cy : 0)
        }
        const kind = rawType === "hyperbola" ? "hyperbola" : "ellipse"
        let rx = asFiniteNumber(input.radiusX) ?? (parsedEq && (parsedEq.conicType === "ellipse" || parsedEq.conicType === "hyperbola") ? parsedEq.radiusX : null)
        let ry = asFiniteNumber(input.radiusY) ?? (parsedEq && (parsedEq.conicType === "ellipse" || parsedEq.conicType === "hyperbola") ? parsedEq.radiusY : null)
        let axis: "x" | "y" = input.axis === "y" || input.axis === "x"
          ? input.axis
          : parsedEq && (parsedEq.conicType === "ellipse" || parsedEq.conicType === "hyperbola")
            ? parsedEq.axis
            : "x"
        if ((rx === null || ry === null) && input.throughPointIds === undefined) {
          let aVal = asPositiveNumber(input.a)
          let bVal = asPositiveNumber(input.b)
          let cVal = asPositiveNumber(input.c)
          const eVal = asPositiveNumber(input.e ?? input.eccentricity)
          if (kind === "ellipse") {
            if (aVal !== null && eVal !== null && eVal < 1 && cVal === null) cVal = aVal * eVal
            if (cVal !== null && eVal !== null && eVal > 0 && eVal < 1 && aVal === null) aVal = cVal / eVal
            if (bVal !== null && eVal !== null && eVal > 0 && eVal < 1 && aVal === null) aVal = bVal / Math.sqrt(1 - eVal * eVal)
            if (aVal !== null && cVal !== null && aVal > cVal && bVal === null) bVal = Math.sqrt(aVal * aVal - cVal * cVal)
            if (bVal !== null && cVal !== null && aVal === null) aVal = Math.sqrt(bVal * bVal + cVal * cVal)
          } else {
            if (aVal !== null && eVal !== null && eVal > 1 && cVal === null) cVal = aVal * eVal
            if (cVal !== null && eVal !== null && eVal > 1 && aVal === null) aVal = cVal / eVal
            if (bVal !== null && eVal !== null && eVal > 1 && aVal === null) aVal = bVal / Math.sqrt(eVal * eVal - 1)
            if (aVal !== null && cVal !== null && cVal > aVal && bVal === null) bVal = Math.sqrt(cVal * cVal - aVal * aVal)
            if (bVal !== null && cVal !== null && cVal > bVal && aVal === null) aVal = Math.sqrt(cVal * cVal - bVal * bVal)
          }
          if (aVal !== null && bVal !== null) {
            rx = axis === "y" ? bVal : aVal
            ry = axis === "y" ? aVal : bVal
          }
        }
        if (input.throughPointIds !== undefined) {
          if (input.radiusX !== undefined || input.radiusY !== undefined) {
            return failRepairable(name, "ambiguous_geometry_input", "use throughPointIds or semi-axes, never both")
          }
          const ids = asStringList(input.throughPointIds)
          const cVal = asPositiveNumber(input.c)
          const eVal = asPositiveNumber(input.e ?? input.eccentricity)
          if (ids && ids.length === 1 && (cVal !== null || eVal !== null)) {
            const single = readP2(ids[0]!, branchId)
            if (!single) {
              return failRepairable(name, "undeclared_entity_ref", `construct point "${ids[0]}" before fitting the conic`)
            }
            const px = single.x - center.x
            const py = single.y - center.y
            const major = axis === "y" ? py : px
            const minor = axis === "y" ? px : py
            let aVal: number | null = null
            let bVal: number | null = null
            if (eVal !== null) {
              if (kind === "ellipse" && eVal > 0 && eVal < 1) {
                const a2 = major * major + (minor * minor) / (1 - eVal * eVal)
                if (a2 > 1e-12) {
                  aVal = Math.sqrt(a2)
                  bVal = aVal * Math.sqrt(1 - eVal * eVal)
                }
              } else if (kind === "hyperbola" && eVal > 1) {
                const a2 = major * major - (minor * minor) / (eVal * eVal - 1)
                if (a2 > 1e-12) {
                  aVal = Math.sqrt(a2)
                  bVal = aVal * Math.sqrt(eVal * eVal - 1)
                }
              }
            } else if (cVal !== null) {
              const c2 = cVal * cVal
              const s = c2 + major * major + minor * minor
              const disc = s * s - 4 * c2 * major * major
              if (disc >= 0) {
                const root = Math.sqrt(disc)
                if (kind === "ellipse") {
                  const u = 0.5 * (s + root)
                  if (u > c2 + 1e-12) {
                    aVal = Math.sqrt(u)
                    bVal = Math.sqrt(u - c2)
                  }
                } else {
                  const u = 0.5 * (s - root)
                  if (u > 1e-12 && u < c2 - 1e-12) {
                    aVal = Math.sqrt(u)
                    bVal = Math.sqrt(c2 - u)
                  }
                }
              }
            }
            if (aVal === null || bVal === null || !(aVal > 0 && bVal > 0)) {
              return failRepairable(name, "conic_fit_unsatisfied", "focal parameter and throughPoint do not uniquely determine a valid conic")
            }
            rx = axis === "y" ? bVal : aVal
            ry = axis === "y" ? aVal : bVal
          } else {
            if (!ids || ids.length !== 2 || ids[0] === ids[1]) {
              return failRepairable(name, "conic_fit_unsatisfied", "throughPointIds requires two distinct existing points")
            }
            const first = readP2(ids[0]!, branchId)
            const second = readP2(ids[1]!, branchId)
            if (!first || !second) {
              return failRepairable(name, "undeclared_entity_ref", "construct both throughPointIds before fitting the conic")
            }
            const fit = fitOriginConicThroughPoints(
              [{ x: first.x - center.x, y: first.y - center.y }, { x: second.x - center.x, y: second.y - center.y }],
              kind === "hyperbola" && input.axis !== undefined ? axis : undefined, kind
            )
            if (!fit) return failRepairable(name, "conic_fit_unsatisfied", "points do not uniquely determine the requested centered conic")
            rx = fit.radiusX
            ry = fit.radiusY
            if (fit.kind === "hyperbola") axis = fit.axis
          }
        }
        if (rx === null || ry === null || !(rx > 0 && ry > 0)) {
          return failRepairable(name, "missing_required_parameter", "construct_conic requires positive radiusX/radiusY or two materialized throughPointIds")
        }
        const conic: PlanarConic =
          kind === "ellipse"
            ? { id, type: "ellipse", center, radiusX: rx, radiusY: ry }
            : { id, type: "hyperbola", center, axis, radiusX: rx, radiusY: ry }
        writeC2(id, conic, branchId)
        writeC2(label, conic, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_conic", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, kind, center, radiusX: rx, radiusY: ry,
            ...(kind === "hyperbola" ? { axis } : {}) } },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_tangent") {
        const id = asString(input.id ?? input.output) ?? `T${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const fnExpr = asString(input.expression)
        const rawLabel = asString(input.label)
        const rawFnLabel = asString(input.functionLabel) ?? (rawLabel && /^[fgh](?:\(x\)(?:=.*)?)?$/i.test(rawLabel) ? rawLabel.replace(/\(x\).*$/i, "") : null)
        const fnId = asString(input.functionId) ?? rawFnLabel ?? (fnExpr ? id : null)
        const x0 = asFiniteNumber(input.x0 ?? input.x)
        const tanMode = asString(input.mode)?.toLowerCase()
        const includeDerivative = input.includeDerivative === true
        const currentActions = getTargetCanvas(branchId).snapshot().actions
        const hasStagedFunction = (key: string | null) =>
          key !== null && currentActions.some((a) => a.actionId === "function.create_graph" && (a.inputs as { alias?: unknown }).alias === key)
        const isBoundMovingPoint = (key: string) =>
          currentActions.some((a) => a.actionId === "dynamic.create_bound_point" && (a.inputs as { alias?: unknown }).alias === key)
        const normExpr = (expr: string) => expr.replace(/\s+/g, "").toLowerCase()
        const matchedExistingFn = fnExpr
          ? currentActions.find(
              (a) =>
                a.actionId === "function.create_graph" &&
                typeof (a.inputs as { expression?: unknown }).expression === "string" &&
                normExpr((a.inputs as { expression: string }).expression) === normExpr(fnExpr)
            )
          : undefined
        const matchedExistingFnAlias = matchedExistingFn ? asString((matchedExistingFn.inputs as { alias?: unknown }).alias) : null
        const isFunctionCall = fnId !== null && (fnExpr !== null || hasStagedFunction(fnId))
        if (isFunctionCall && fnId !== null) {
          const isScalarAnalysisOrTan = x0 !== null || tanMode === "derivative" || tanMode === "integral"
          const effectiveFnId = matchedExistingFnAlias
            ?? (fnExpr !== null && isScalarAnalysisOrTan && fnId === id && !/^[fgh]$/i.test(id)
              ? `${id}_fn`
              : fnId)
          const tangentAlias = effectiveFnId === id && x0 !== null ? `${id}_tan` : id
          const effectiveFnLabel = rawFnLabel ?? effectiveFnId
          const fnAlreadyExists = hasStagedFunction(effectiveFnId)
          if (!fnAlreadyExists) {
            if (!fnExpr) {
              return failRepairable(name, "undeclared_entity_ref", `function "${effectiveFnId}" is not staged yet; supply expression`)
            }
            const yCheck = x0 !== null ? evaluateFunctionWithDomain(fnExpr, x0) : evaluateFunctionWithDomain(fnExpr, 0)
            if (!yCheck.ok && !(x0 === null && evaluateFunctionWithDomain(fnExpr, 1).ok)) {
              return failRepairable(name, "invalid_expression", "cannot evaluate function expression")
            }
            const rawDomain = Array.isArray(input.domain) && input.domain.length === 2
              ? [asFiniteNumber(input.domain[0]), asFiniteNumber(input.domain[1])]
              : [null, null]
            const domain: [number, number] =
              rawDomain[0] !== null && rawDomain[1] !== null && rawDomain[0]! < rawDomain[1]!
                ? [rawDomain[0]!, rawDomain[1]!]
                : x0 !== null
                  ? [Math.min(-4, x0 - 2), Math.max(4, x0 + 2)]
                  : [-4, 4]
            const graphStep = stageDraftAction(
              name,
              {
                actionId: "function.create_graph",
                actionKey: `ds-act-${stepSeq}-fn`,
                factIds: [],
                inputs: { alias: effectiveFnId, label: effectiveFnLabel, expression: fnExpr, domain }
              } as DraftAction,
              effectiveFnId,
              undefined,
              sliceTarget
            )
            if (!graphStep.ok) return graphStep
          }
          if (tanMode === "derivative" || tanMode === "integral") {
            return stageDraftAction(
              name,
              {
                actionId: "function.analyze",
                actionKey: `ds-act-${stepSeq}-${tanMode}`,
                factIds: [],
                inputs: { alias: id, sourceId: `draft:${effectiveFnId}`, analysis: tanMode }
              } as DraftAction,
              id,
              undefined,
              sliceTarget
            )
          }
          let latestStep: DsActionRawResult | null = null
          if (includeDerivative) {
            const derivAlias = `${id}_deriv`
            latestStep = stageDraftAction(
              name,
              {
                actionId: "function.analyze",
                actionKey: `ds-act-${stepSeq}-deriv`,
                factIds: [],
                inputs: { alias: derivAlias, sourceId: `draft:${effectiveFnId}`, analysis: "derivative" }
              } as DraftAction,
              derivAlias,
              undefined,
              sliceTarget
            )
            if (!latestStep.ok) return latestStep
          }
          if (x0 !== null) {
            const stagedGraph = getTargetCanvas(branchId).snapshot().actions.find(
              (a) => a.actionId === "function.create_graph" && (a.inputs as { alias?: unknown }).alias === effectiveFnId
            )
            const exprForEval = fnExpr ?? asString((stagedGraph?.inputs as { expression?: unknown } | undefined)?.expression)
            if (exprForEval) {
              const y0Res = evaluateFunctionWithDomain(exprForEval, x0)
              const dRes = evaluateSymbolicDerivative(exprForEval, x0)
              if (!y0Res.ok || !dRes.ok) {
                return failRepairable(name, "invalid_expression", `cannot evaluate function expression "${exprForEval}" (or derivative) at x0=${x0}; pass a numeric formula of x with no symbolic parameters (like a/k)`)
              }
              const slope = dRes.value
              const intercept = y0Res.value - slope * x0
              const pA: Coordinate = { x: x0 - 1, y: slope * (x0 - 1) + intercept }
              const pB: Coordinate = { x: x0 + 1, y: slope * (x0 + 1) + intercept }
              writeL2(tangentAlias, { a: pA, b: pB }, branchId)
              writeL2(label, { a: pA, b: pB }, branchId)
            }
            return stageDraftAction(
              name,
              {
                actionId: "function.create_tangent",
                actionKey: `ds-act-${stepSeq}`,
                factIds: [],
                inputs: { alias: tangentAlias, sourceId: `draft:${effectiveFnId}`, x: x0 }
              } as DraftAction,
              tangentAlias,
              undefined,
              sliceTarget
            )
          }
          if (latestStep) return latestStep
          const staged = getTargetCanvas(branchId).snapshot()
          return {
            ok: true,
            status: "accepted",
            action: name,
            entity: effectiveFnId,
            stateChanged: true,
            candidateHash: staged.candidateHash,
            stepIndex: staged.stepIndex,
            primitiveCount: staged.primitiveCount
          }
        }
        const conicId = asString(input.conicId)
        const ptId = asString(input.pointId ?? input.throughPointId)
        const conic = conicId ? readC2(conicId, branchId) : undefined
        const pt = ptId ? readP2(ptId, branchId) : undefined
        if (!conic || !pt || !ptId || !conicId) return failRepairable(name, "undeclared_entity_ref", "construct_tangent requires valid conicId and pointId, or expression and x0")
        const tan = tangentLineToConicAt(conic, pt, 5)
        if (tan) {
          writeL2(id, { a: tan.line.a, b: tan.line.b }, branchId)
          if (!branchId && isBoundMovingPoint(ptId)) {
            return stageDraftAction(
              name,
              {
                actionId: "function.create_tangent",
                actionKey: `ds-act-${stepSeq}`,
                factIds: [],
                inputs: { alias: id, sourceId: `draft:${ptId}`, anchor: { kind: "point", pointId: `draft:${ptId}` } }
              } as DraftAction,
              id,
              undefined,
              sliceTarget
            )
          }
          return stageDraftAction(
            name,
            { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [tan.line.a, tan.line.b] } },
            id,
            undefined,
            sliceTarget
          )
        }
        // Compute exact polar line Ax + By + C = 0 of exterior point pt w.r.t. conic
        let polarA = 0, polarB = 0, polarC = 0
        if (conic.type === "circle") {
          const dx = pt.x - conic.center.x, dy = pt.y - conic.center.y
          if (Math.hypot(dx, dy) > conic.radius + 1e-6) {
            polarA = dx; polarB = dy; polarC = -(dx * conic.center.x + dy * conic.center.y + conic.radius * conic.radius)
          }
        } else if (conic.type === "ellipse") {
          const dx = pt.x - conic.center.x, dy = pt.y - conic.center.y
          const invX = 1 / (conic.radiusX * conic.radiusX), invY = 1 / (conic.radiusY * conic.radiusY)
          if (dx * dx * invX + dy * dy * invY > 1 + 1e-6) {
            polarA = dx * invX; polarB = dy * invY; polarC = -(polarA * conic.center.x + polarB * conic.center.y + 1)
          }
        } else if (conic.type === "hyperbola") {
          const dx = pt.x - conic.center.x, dy = pt.y - conic.center.y
          const invX = (conic.axis === "x" ? 1 : -1) / (conic.radiusX * conic.radiusX)
          const invY = (conic.axis === "y" ? 1 : -1) / (conic.radiusY * conic.radiusY)
          if (dx * dx * invX + dy * dy * invY < 1 - 1e-6) {
            polarA = dx * invX; polarB = dy * invY; polarC = -(polarA * conic.center.x + polarB * conic.center.y + 1)
          }
        } else if (conic.type === "parabola") {
          const dx = pt.x - conic.vertex.x, dy = pt.y - conic.vertex.y, p = conic.focalParameter
          if (conic.axis === "y" && dx * dx > 2 * p * dy + 1e-6) {
            polarA = dx; polarB = -p; polarC = -dx * conic.vertex.x + p * conic.vertex.y - p * dy
          } else if (conic.axis === "x" && dy * dy > 2 * p * dx + 1e-6) {
            polarA = -p; polarB = dy; polarC = p * conic.vertex.x - dy * conic.vertex.y - p * dx
          }
        }
        const polarNorm2 = polarA * polarA + polarB * polarB
        if (polarNorm2 > 1e-18) {
          const anchor = { x: -(polarA * polarC) / polarNorm2, y: -(polarB * polarC) / polarNorm2 }
          const scale = 1 / Math.sqrt(polarNorm2)
          const polarLine: { type: "line"; a: Coordinate; b: Coordinate } = {
            type: "line",
            a: anchor,
            b: { x: anchor.x - polarB * scale, y: anchor.y + polarA * scale }
          }
          const res = intersectPlanarLineAndConicExact(polarLine, conic)
          if (res.points.length > 0) {
            const sortedPts = [...res.points].sort((p1, p2) => Math.abs(p1.x - p2.x) > 1e-9 ? p1.x - p2.x : p1.y - p2.y)
            const sel = asString(input.selection)
            const rawBranch = asFiniteNumber(input.branch)
            let touchPt: Coordinate
            if (sel && sortedPts.length > 1) {
              const axis = sel.endsWith("x") ? "x" : "y"
              const byAxis = [...sortedPts].sort((p1, p2) => p1[axis] - p2[axis])
              touchPt = sel.startsWith("min") ? byAxis[0]! : byAxis[byAxis.length - 1]!
            } else if (rawBranch !== null && sortedPts.length > 1) {
              const idx = Math.max(0, Math.min(sortedPts.length - 1, Math.round(rawBranch)))
              touchPt = sortedPts[idx]!
            } else if (sortedPts.length > 1) {
              const unused = sortedPts.find((cand) => !currentActions.some((act) => {
                if (act.actionId === "planar.create_line") {
                  const pts = (act.inputs as { points?: Coordinate[] }).points
                  if (!Array.isArray(pts) || pts.length !== 2) return false
                  const nearPt = Math.hypot(pts[0]!.x - pt.x, pts[0]!.y - pt.y) < 1e-4 && Math.hypot(pts[1]!.x - cand.x, pts[1]!.y - cand.y) < 1e-4
                  const nearRev = Math.hypot(pts[1]!.x - pt.x, pts[1]!.y - pt.y) < 1e-4 && Math.hypot(pts[0]!.x - cand.x, pts[0]!.y - cand.y) < 1e-4
                  return nearPt || nearRev
                }
                if (act.actionId === "function.create_tangent") {
                  const alias = asString((act.inputs as { alias?: unknown }).alias)
                  const line = alias ? readL2(alias, branchId) : undefined
                  if (!line) return false
                  const nearPt = Math.hypot(line.a.x - pt.x, line.a.y - pt.y) < 1e-4 && Math.hypot(line.b.x - cand.x, line.b.y - cand.y) < 1e-4
                  const nearRev = Math.hypot(line.b.x - pt.x, line.b.y - pt.y) < 1e-4 && Math.hypot(line.a.x - cand.x, line.a.y - cand.y) < 1e-4
                  return nearPt || nearRev
                }
                return false
              }))
              touchPt = unused ?? sortedPts[0]!
            } else {
              touchPt = sortedPts[0]!
            }
            const tpId = asString(input.tangentPointId)
            if (tpId) {
              writeP2(tpId, touchPt, branchId)
              const tpStep = stageDraftAction(
                name,
                { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}-tp`, factIds: [], inputs: { alias: tpId, label: tpId, points: [touchPt] } },
                tpId,
                touchPt,
                sliceTarget
              )
              if (!tpStep.ok) return tpStep
            }
            writeL2(id, { a: pt, b: touchPt }, branchId)
            writeL2(label, { a: pt, b: touchPt }, branchId)
            const stagedLine = stageDraftAction(
              name,
              { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [pt, touchPt] } },
              id,
              undefined,
              sliceTarget
            )
            return stagedLine.ok ? { ...stagedLine, measurement: { tangentPoint: touchPt, tangentPoints: sortedPts } } : stagedLine
          }
        }
        const notOnDetail =
          conic.type === "circle"
            ? `point "${ptId}" (${pt.x}, ${pt.y}) lies strictly inside circle "${conicId}" (center=(${conic.center.x}, ${conic.center.y}), radius=${conic.radius}, dist=${Math.hypot(pt.x - conic.center.x, pt.y - conic.center.y).toFixed(4)}). Pick or construct a point on/outside "${conicId}", or check circle center/radius and point coordinates.`
            : `point "${ptId}" (${pt.x}, ${pt.y}) must lie ON or outside ${conic.type} "${conicId}" to construct a tangent.`
        return failRepairable(name, "not_on_conic", notOnDetail)
      }

      if (name === "construct_perpendicular" || name === "construct_parallel") {
        const id = asString(input.id ?? input.output) ?? `L${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const lineId = asString(input.lineId)
        const ptId = asString(input.throughPointId)
        const ref = lineId ? readL2(lineId, branchId) : undefined
        if (!ref) return failRepairable(name, "undeclared_entity_ref", `${name} requires existing lineId`)
        const dx = ref.b.x - ref.a.x
        const dy = ref.b.y - ref.a.y
        const len = Math.hypot(dx, dy)
        if (!(len > 1e-12)) return failRepairable(name, "degenerate_line", "reference line is degenerate")
        const ux = dx / len, uy = dy / len
        const dirX = name === "construct_perpendicular" ? -uy : ux
        const dirY = name === "construct_perpendicular" ? ux : uy
        let anchor: Coordinate | undefined = ptId ? readP2(ptId, branchId) : undefined
        if (ptId && !anchor) return failRepairable(name, "undeclared_entity_ref", `construct point "${ptId}" before referencing throughPointId`)
        if (!anchor) {
          if (name === "construct_perpendicular") {
            return failRepairable(name, "undeclared_entity_ref", "construct_perpendicular requires throughPointId")
          }
          const offsetX = asFiniteNumber(input.offsetX) ?? 0
          const offsetY = asFiniteNumber(input.offsetY) ?? 0
          const distance = asFiniteNumber(input.distance) ?? 0
          if (input.offsetX === undefined && input.offsetY === undefined && input.distance === undefined) {
            return failRepairable(name, "missing_required_parameter", "construct_parallel requires throughPointId or offsetX/offsetY/distance")
          }
          const mid = { x: (ref.a.x + ref.b.x) * 0.5, y: (ref.a.y + ref.b.y) * 0.5 }
          anchor = {
            x: mid.x + offsetX + (-uy) * distance,
            y: mid.y + offsetY + ux * distance
          }
        }
        const endpoints: [Coordinate, Coordinate] = [
          { x: anchor.x - dirX * 5, y: anchor.y - dirY * 5 },
          { x: anchor.x + dirX * 5, y: anchor.y + dirY * 5 }
        ]
        writeL2(id, { a: endpoints[0], b: endpoints[1] }, branchId)
        writeL2(label, { a: endpoints[0], b: endpoints[1] }, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: endpoints } },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "finish_candidate") {
        let primaryActions = [...(snap.actions.length > 0 ? snap.actions : recordedSlices[0]?.actions ?? [])]
        if (primaryActions.length === 0) {
          return failRepairable(name, "empty_candidate", "stage at least one geometric action before finish_candidate")
        }
        if (pendingEdgeBoundPoints.size > 0 && branchActionBuckets.size === 0) {
          let candidateActions = [...primaryActions]
          let modified = false
          const pendingDoc = speculative.currentDocument()
          for (const entry of pendingEdgeBoundPoints.values()) {
            const ptIdx = candidateActions.findIndex((a) => a.actionKey === entry.actionKey)
            if (ptIdx < 0) continue
            const segIdx = candidateActions.findIndex((a) => {
              if (!entry.is3d && (a.actionId === "planar.create_segment" || a.actionId === "planar.create_line")) {
                const inp = a.inputs as { points?: unknown } | undefined
                const p2A = readP2(entry.fromId)
                const p2B = readP2(entry.toId)
                if (!Array.isArray(inp?.points) || inp.points.length !== 2 || !p2A || !p2B) return false
                const [ea, eb] = inp.points as Coordinate[]
                return Boolean(ea && eb && (
                  (Math.hypot(ea.x - p2A.x, ea.y - p2A.y) <= 1e-6 && Math.hypot(eb.x - p2B.x, eb.y - p2B.y) <= 1e-6) ||
                  (Math.hypot(ea.x - p2B.x, ea.y - p2B.y) <= 1e-6 && Math.hypot(eb.x - p2A.x, eb.y - p2A.y) <= 1e-6)
                ))
              }
              if (entry.is3d && a.actionId === "solid.create_segment") {
                const vns = (a.inputs as { vertexNames?: unknown } | undefined)?.vertexNames
                return Array.isArray(vns) && vns.length === 2 && ((vns[0] === entry.fromId && vns[1] === entry.toId) || (vns[0] === entry.toId && vns[1] === entry.fromId))
              }
              return false
            })
            if (segIdx < 0 && entry.is3d) {
              let matchedPolyIdx = -1
              let matchedEdge: { hostSub: number; reversed: boolean } | null = null
              for (let idx = 0; idx < candidateActions.length; idx += 1) {
                const found = findSolidEdgeHostSub(pendingDoc, candidateActions[idx]!, entry.fromId, entry.toId, readP3(entry.fromId), readP3(entry.toId))
                if (found) {
                  matchedPolyIdx = idx
                  matchedEdge = found
                  break
                }
              }
              if (matchedPolyIdx >= 0 && matchedEdge) {
                const polyAct = candidateActions[matchedPolyIdx]!
                const polyAlias = asString((polyAct.inputs as { alias?: unknown } | undefined)?.alias)
                if (polyAlias) {
                  const boundOnPoly: DraftAction = {
                    actionId: "dynamic.create_bound_point",
                    actionKey: entry.actionKey,
                    factIds: [],
                    inputs: {
                      alias: entry.id,
                      label: entry.label,
                      host: { scope: "draft", alias: polyAlias },
                      hostSub: matchedEdge.hostSub,
                      parameter: matchedEdge.reversed ? 1 - entry.ratio : entry.ratio
                    }
                  } as unknown as DraftAction
                  if (matchedPolyIdx < ptIdx) {
                    candidateActions[ptIdx] = boundOnPoly
                    modified = true
                  } else {
                    const betweenRefsPoint = candidateActions.slice(ptIdx + 1, matchedPolyIdx + 1).some((a) =>
                      JSON.stringify(a.inputs).includes(`"${entry.id}"`) || JSON.stringify(a.inputs).includes(`"${entry.label}"`)
                    )
                    if (!betweenRefsPoint) {
                      const reordered = [...candidateActions]
                      reordered.splice(ptIdx, 1)
                      reordered.splice(matchedPolyIdx, 0, boundOnPoly)
                      candidateActions = reordered
                      modified = true
                    }
                  }
                }
              }
              continue
            }
            if (segIdx < 0) continue
            const segAct = candidateActions[segIdx]!
            const segInp = segAct.inputs as { alias?: unknown; vertexNames?: unknown; points?: unknown }
            const segAlias = asString(segInp.alias)
            if (!segAlias) continue
            let param = entry.ratio
            if (entry.is3d && Array.isArray(segInp.vertexNames) && segInp.vertexNames[0] === entry.toId) {
              param = 1 - entry.ratio
            } else if (!entry.is3d && Array.isArray(segInp.points)) {
              const p2B = readP2(entry.toId)
              const first = (segInp.points as Coordinate[])[0]
              if (p2B && first && Math.hypot(first.x - p2B.x, first.y - p2B.y) <= 1e-6) param = 1 - entry.ratio
            }
            const boundAction: DraftAction = {
              actionId: "dynamic.create_bound_point",
              actionKey: entry.actionKey,
              factIds: [],
              inputs: { alias: entry.id, label: entry.label, host: { scope: "draft", alias: segAlias }, parameter: param }
            } as unknown as DraftAction
            if (segIdx > ptIdx) {
              // Move segment right before the bound point (`fromId`/`toId` are already materialized before `ptIdx`).
              const reordered = [...candidateActions]
              reordered.splice(segIdx, 1)
              reordered.splice(ptIdx, 0, segAct)
              reordered[ptIdx + 1] = boundAction
              candidateActions = reordered
            } else {
              candidateActions[ptIdx] = boundAction
            }
            modified = true
          }
          if (modified) {
            const ws: GeometryDocument["workspace"] = candidateActions.some((a) => a.actionId.startsWith("solid.") || a.actionId.startsWith("derived.") || a.actionId.startsWith("section."))
              ? "geometry3d"
              : options.workspace === "geometry3d"
                ? "conics"
                : options.workspace
            const testCompile = compilePlan(
              { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "bound-point-check", factIds: [], actions: candidateActions },
              { document: createEmptyDocument(ws), workspace: ws, capabilityRevision: "draft", conversationId: "ds-bound-check" }
            )
            if (testCompile.ok && testCompile.draftDocument !== null) {
              primaryActions = candidateActions
            }
          }
        }
        if (options.problemText && branchActionBuckets.size === 0) {
          const ws: GeometryDocument["workspace"] = primaryActions.some((a) => a.actionId.startsWith("solid.") || a.actionId.startsWith("derived.") || a.actionId.startsWith("section."))
            ? "geometry3d"
            : options.workspace === "geometry3d"
              ? "conics"
              : options.workspace
          const baseCompile = compilePlan(
            { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "stmt-bind-base", factIds: [], actions: primaryActions },
            { document: createEmptyDocument(ws), workspace: ws, capabilityRevision: "draft", conversationId: "ds-stmt-base" }
          )
          const docBefore = baseCompile.ok ? baseCompile.draftDocument : null
          if (docBefore) {
            const pointNames = [
              ...new Set(
                docBefore.primitives
                  .filter((p) => (p.type === "point3" || p.type === "point") && typeof p.label === "string" && p.label.length > 0)
                  .map((p) => p.label!)
              )
            ].sort((a, b) => b.length - a.length)

            const p3ByLabel = new Map<string, Vector3>()
            const p2ByLabel = new Map<string, Coordinate>()
            const canonicalLabelByLower = new Map<string, string>()
            for (const p of docBefore.primitives) {
              if (p.type === "point3" && p.label) {
                p3ByLabel.set(p.label, p.position)
                canonicalLabelByLower.set(p.label.toLowerCase(), p.label)
              }
              if (p.type === "point" && p.label) {
                p2ByLabel.set(p.label, { x: p.x, y: p.y })
                canonicalLabelByLower.set(p.label.toLowerCase(), p.label)
              }
            }
            const canonicalPointLabel = (raw: string): string =>
              p3ByLabel.has(raw) || p2ByLabel.has(raw) ? raw : canonicalLabelByLower.get(raw.toLowerCase()) ?? raw

            const splitTokens = (raw: string, expectedCount?: number): string[] | null =>
              splitPointTokensInPrompt(raw, pointNames, expectedCount)

            const normalizedPrompt = options.problemText.replace(/−/g, "-")
            const edgeTargets: Array<{ pt: string; from: string; to: string }> = []
            const faceTargets: Array<{ pt: string; verts: string[] }> = []
            const curveTargets: Array<{ pt: string; hostName: string }> = []

            const edgeRe = /(?:点\s*)?([A-Za-z][A-Za-z0-9_′']*)\s*(?:[在为是落]\s*(?:直线|线段|棱|边|射线)?|为\s*(?:直线|线段|棱|边)?|是\s*(?:直线|线段|棱|边)?)\s*([A-Za-z][A-Za-z0-9_′']*)\s*(?:上|的中点|上的动点|上的点|的三等分点|的动点)/g
            for (const m of normalizedPrompt.matchAll(edgeRe)) {
              const pt = canonicalPointLabel(m[1]!)
              const hostRaw = m[2]!
              const pair = splitTokens(hostRaw, 2)
              if (pair && !pair.includes(pt)) {
                edgeTargets.push({ pt, from: pair[0]!, to: pair[1]! })
              }
            }

            const faceRe = /(?:点\s*)?([A-Za-z][A-Za-z0-9_′']*)\s*(?:在|为|是|落在)\s*(?:底?面|侧?面|平面|截面)\s*([A-Za-z][A-Za-z0-9_′']{2,12})\s*(?:内|上|中)/g
            for (const m of normalizedPrompt.matchAll(faceRe)) {
              const pt = canonicalPointLabel(m[1]!)
              const verts = splitTokens(m[2]!)
              if (verts && verts.length >= 3 && new Set(verts).size >= 3 && !verts.includes(pt)) {
                faceTargets.push({ pt, verts })
              }
            }

            const curveRe = /(?:点\s*)?([A-Za-z][A-Za-z0-9_′']*)\s*(?:在|是|为|落在)\s*(?:直线|线段|圆|椭圆|抛物线|双曲线|曲线)\s*([A-Za-z0-9_′']*)\s*(?:上|的动点|上的点)/g
            for (const m of normalizedPrompt.matchAll(curveRe)) {
              const pt = canonicalPointLabel(m[1]!)
              const hostName = m[2]?.trim() ?? ""
              if (hostName && (!splitTokens(hostName, 2))) {
                curveTargets.push({ pt, hostName })
              }
            }

            let working = [...primaryActions]
            let upgraded = false
            const actionRefsToken = (act: DraftAction, token: string): boolean => {
              const raw = JSON.stringify(act.inputs)
              return raw.includes(`"${token}"`)
            }

            const placeBoundAfterHost = (ptIdx: number, hostIdx: number, boundAct: DraftAction): DraftAction[] | null => {
              const ptAct = working[ptIdx]!
              const ptAlias = asString((ptAct.inputs as { alias?: unknown }).alias) ?? ""
              const ptLabel = asString((ptAct.inputs as { label?: unknown }).label) ?? ptAlias
              if (hostIdx < ptIdx) {
                const next = [...working]
                next[ptIdx] = boundAct
                return next
              }
              // Try moving `ptAct` right after `hostIdx` if nothing in (ptIdx, hostIdx] uses `ptAlias`/`ptLabel`
              const blockedMovingPt = working.slice(ptIdx + 1, hostIdx + 1).some((a) =>
                (ptAlias && actionRefsToken(a, ptAlias)) || (ptLabel && actionRefsToken(a, ptLabel))
              )
              if (!blockedMovingPt) {
                const next = [...working]
                next.splice(ptIdx, 1)
                next.splice(hostIdx, 0, boundAct)
                return next
              }
              // Or try moving `hostAct` right before `ptIdx` if `hostAct`'s deps are already satisfied before `ptIdx`
              const hostAct = working[hostIdx]!
              const vns = (hostAct.inputs as { vertexNames?: unknown }).vertexNames
              if (Array.isArray(vns) && vns.every((vn) => typeof vn === "string")) {
                const createdEarlier = new Set(
                  working.slice(0, ptIdx).flatMap((a) => {
                    const inp = a.inputs as { alias?: unknown; label?: unknown; vertexNames?: unknown }
                    return [
                      ...(typeof inp.alias === "string" ? [inp.alias] : []),
                      ...(typeof inp.label === "string" ? [inp.label] : []),
                      ...(Array.isArray(inp.vertexNames) ? inp.vertexNames.filter((x): x is string => typeof x === "string") : [])
                    ]
                  })
                )
                if (vns.every((vn) => createdEarlier.has(vn))) {
                  const next = [...working]
                  next.splice(hostIdx, 1)
                  next.splice(ptIdx, 0, hostAct)
                  next[ptIdx + 1] = boundAct
                  return next
                }
              }
              return null
            }

            // 1. Edge / segment bindings
            for (const target of edgeTargets) {
              const seenKeys = new Set<string>()
              for (let iter = 0; iter <= working.length + 2; iter++) {
                const ptIdx = working.findIndex((a) =>
                  !seenKeys.has(a.actionKey) &&
                  (a.actionId === "solid.create_point" || a.actionId === "planar.create_point") &&
                  ((a.inputs as { alias?: unknown }).alias === target.pt || (a.inputs as { label?: unknown }).label === target.pt)
                )
                if (ptIdx < 0) break
                const ptAct = working[ptIdx]!
                seenKeys.add(ptAct.actionKey)
                const ptAlias = asString((ptAct.inputs as { alias?: unknown }).alias) ?? target.pt
                const ptLabel = asString((ptAct.inputs as { label?: unknown }).label) ?? target.pt
                const is3dPt = ptAct.actionId === "solid.create_point"

                if (is3dPt) {
                  const rawPos = (ptAct.inputs as { position?: unknown }).position as Partial<Vector3> | undefined
                  const posE = rawPos && Number.isFinite(rawPos.x) && Number.isFinite(rawPos.y) && Number.isFinite(rawPos.z)
                    ? { x: rawPos.x!, y: rawPos.y!, z: rawPos.z! }
                    : p3ByLabel.get(target.pt)
                  const posF = p3ByLabel.get(target.from)
                  const posT = p3ByLabel.get(target.to)
                  if (!posE || !posF || !posT) continue
                  const d = { x: posT.x - posF.x, y: posT.y - posF.y, z: posT.z - posF.z }
                  const len2 = d.x * d.x + d.y * d.y + d.z * d.z
                  if (!(len2 > 1e-12)) continue
                  const rawT = ((posE.x - posF.x) * d.x + (posE.y - posF.y) * d.y + (posE.z - posF.z) * d.z) / len2
                  const proj = { x: posF.x + d.x * rawT, y: posF.y + d.y * rawT, z: posF.z + d.z * rawT }
                  if (distanceVector3(posE, proj) > 1e-2) continue
                  const tClamped = rawT >= -1e-3 && rawT <= 1 + 1e-3 ? Math.min(1, Math.max(0, rawT)) : rawT

                  const segIdx = working.findIndex((a) => {
                    if (a.actionId !== "solid.create_segment") return false
                    const vns = (a.inputs as { vertexNames?: unknown }).vertexNames
                    return Array.isArray(vns) && vns.length === 2 && ((vns[0] === target.from && vns[1] === target.to) || (vns[0] === target.to && vns[1] === target.from))
                  })
                  if (segIdx >= 0) {
                    const segAct = working[segIdx]!
                    const segAlias = asString((segAct.inputs as { alias?: unknown }).alias)
                    const vns = (segAct.inputs as { vertexNames: string[] }).vertexNames
                    if (segAlias) {
                      const param = vns[0] === target.to ? 1 - tClamped : tClamped
                      const boundAct = {
                        actionId: "dynamic.create_bound_point",
                        actionKey: ptAct.actionKey,
                        factIds: [],
                        inputs: { alias: ptAlias, label: ptLabel, host: { scope: "draft", alias: segAlias }, parameter: param }
                      } as unknown as DraftAction
                      const reordered = placeBoundAfterHost(ptIdx, segIdx, boundAct)
                      if (reordered) {
                        working = reordered
                        upgraded = true
                        continue
                      }
                    }
                  }
                  let polyIdx = -1
                  let matchedEdge: { hostSub: number; reversed: boolean } | null = null
                  for (let idx = 0; idx < working.length; idx += 1) {
                    const found = findSolidEdgeHostSub(docBefore, working[idx]!, target.from, target.to, posF, posT)
                    if (found) {
                      polyIdx = idx
                      matchedEdge = found
                      break
                    }
                  }
                  if (polyIdx >= 0 && matchedEdge && tClamped >= 0 && tClamped <= 1) {
                    const polyAct = working[polyIdx]!
                    const polyAlias = asString((polyAct.inputs as { alias?: unknown }).alias)
                    if (polyAlias) {
                      const boundAct = {
                        actionId: "dynamic.create_bound_point",
                        actionKey: ptAct.actionKey,
                        factIds: [],
                        inputs: {
                          alias: ptAlias,
                          label: ptLabel,
                          host: { scope: "draft", alias: polyAlias },
                          hostSub: matchedEdge.hostSub,
                          parameter: matchedEdge.reversed ? 1 - tClamped : tClamped
                        }
                      } as unknown as DraftAction
                      const reordered = placeBoundAfterHost(ptIdx, polyIdx, boundAct)
                      if (reordered) {
                        working = reordered
                        upgraded = true
                      }
                    }
                  }
                } else {
                  const rawX = (ptAct.inputs as { x?: unknown }).x
                  const rawY = (ptAct.inputs as { y?: unknown }).y
                  const posE = typeof rawX === "number" && Number.isFinite(rawX) && typeof rawY === "number" && Number.isFinite(rawY)
                    ? { x: rawX, y: rawY }
                    : p2ByLabel.get(target.pt)
                  const posF = p2ByLabel.get(target.from)
                  const posT = p2ByLabel.get(target.to)
                  if (!posE || !posF || !posT) continue
                  const dx = posT.x - posF.x, dy = posT.y - posF.y
                  const len2 = dx * dx + dy * dy
                  if (!(len2 > 1e-12)) continue
                  const rawT = ((posE.x - posF.x) * dx + (posE.y - posF.y) * dy) / len2
                  if (Math.hypot(posE.x - (posF.x + dx * rawT), posE.y - (posF.y + dy * rawT)) > 1e-2) continue
                  const segIdx = working.findIndex((a) => {
                    if (a.actionId !== "planar.create_segment" && a.actionId !== "planar.create_line") return false
                    const pts = (a.inputs as { points?: Coordinate[] }).points
                    if (!Array.isArray(pts) || pts.length !== 2) return false
                    return (
                      (Math.hypot(pts[0]!.x - posF.x, pts[0]!.y - posF.y) <= 1e-6 && Math.hypot(pts[1]!.x - posT.x, pts[1]!.y - posT.y) <= 1e-6) ||
                      (Math.hypot(pts[0]!.x - posT.x, pts[0]!.y - posT.y) <= 1e-6 && Math.hypot(pts[1]!.x - posF.x, pts[1]!.y - posF.y) <= 1e-6)
                    )
                  })
                  if (segIdx >= 0) {
                    const segAct = working[segIdx]!
                    const segAlias = asString((segAct.inputs as { alias?: unknown }).alias)
                    const pts = (segAct.inputs as { points: Coordinate[] }).points
                    if (segAlias) {
                      const reversed = Math.hypot(pts[0]!.x - posT.x, pts[0]!.y - posT.y) <= 1e-6
                      const param = reversed ? 1 - rawT : rawT
                      const boundAct = {
                        actionId: "dynamic.create_bound_point",
                        actionKey: ptAct.actionKey,
                        factIds: [],
                        inputs: { alias: ptAlias, label: ptLabel, host: { scope: "draft", alias: segAlias }, parameter: param }
                      } as unknown as DraftAction
                      const reordered = placeBoundAfterHost(ptIdx, segIdx, boundAct)
                      if (reordered) {
                        working = reordered
                        upgraded = true
                      }
                    }
                  }
                }
              }
            }

            // 2. Plane / face bindings (e.g. M 在平面 ABCD 内)
            for (const target of faceTargets) {
              const seenFaceKeys = new Set<string>()
              for (let iter = 0; iter <= working.length + 2; iter++) {
                const ptIdx = working.findIndex((a) =>
                  !seenFaceKeys.has(a.actionKey) &&
                  a.actionId === "solid.create_point" &&
                  ((a.inputs as { alias?: unknown }).alias === target.pt || (a.inputs as { label?: unknown }).label === target.pt)
                )
                if (ptIdx < 0) break
                const ptAct = working[ptIdx]!
                seenFaceKeys.add(ptAct.actionKey)
                const ptAlias = asString((ptAct.inputs as { alias?: unknown }).alias) ?? target.pt
                const ptLabel = asString((ptAct.inputs as { label?: unknown }).label) ?? target.pt
                const rawPos = (ptAct.inputs as { position?: unknown }).position as Partial<Vector3> | undefined
                const posM = rawPos && Number.isFinite(rawPos.x) && Number.isFinite(rawPos.y) && Number.isFinite(rawPos.z)
                  ? { x: rawPos.x!, y: rawPos.y!, z: rawPos.z! }
                  : p3ByLabel.get(target.pt)
                const faceVerts = target.verts.map((v) => p3ByLabel.get(v)).filter((v): v is Vector3 => Boolean(v))
                if (!posM || faceVerts.length !== target.verts.length) continue
                const existingFace = findMatchingFaceInDoc(docBefore, working, faceVerts, posM)
                if (existingFace) {
                  const hostIdx = working.findIndex((a) => (a.inputs as { alias?: unknown }).alias === existingFace.faceAlias)
                  const projExisting = existingFace.hostFace.closestParameter(posM)
                  const boundFacePt = {
                    actionId: "dynamic.create_face_point",
                    actionKey: ptAct.actionKey,
                    factIds: [],
                    inputs: {
                      alias: ptAlias,
                      label: ptLabel,
                      face: { scope: "draft", alias: existingFace.faceAlias },
                      ...(existingFace.faceSub !== undefined ? { faceSub: existingFace.faceSub } : {}),
                      uv: [projExisting.u, projExisting.v ?? 0]
                    }
                  } as unknown as DraftAction
                  if (hostIdx >= 0) {
                    const reordered = placeBoundAfterHost(ptIdx, hostIdx, boundFacePt)
                    if (reordered) {
                      working = reordered
                      upgraded = true
                      continue
                    }
                  }
                }
                const fh = faceHost3(faceVerts)
                if (!fh) continue
                const proj = fh.closestParameter(posM)
                if (distanceVector3(fh.evaluate(proj), posM) > 1e-2) continue
                const faceAlias = `face_bind_${target.pt}_${target.verts.join("")}_${seenFaceKeys.size}`
                const faceAction = {
                  actionId: "solid.create_face",
                  actionKey: `${ptAct.actionKey}-face`,
                  factIds: [],
                  inputs: { alias: faceAlias, label: `面 ${target.verts.join("")}`, vertices: faceVerts, vertexNames: target.verts }
                } as DraftAction
                const boundFacePt = {
                  actionId: "dynamic.create_face_point",
                  actionKey: ptAct.actionKey,
                  factIds: [],
                  inputs: { alias: ptAlias, label: ptLabel, face: { scope: "draft", alias: faceAlias }, uv: [proj.u, proj.v ?? 0] }
                } as unknown as DraftAction
                const next = [...working]
                next.splice(ptIdx, 1, faceAction, boundFacePt)
                working = next
                upgraded = true
              }
            }

            // 3. 2D curve / line alias bindings (e.g. P 在椭圆 C 上)
            for (const target of curveTargets) {
              const ptIdx = working.findIndex((a) =>
                a.actionId === "planar.create_point" &&
                ((a.inputs as { alias?: unknown }).alias === target.pt || (a.inputs as { label?: unknown }).label === target.pt)
              )
              if (ptIdx < 0) continue
              const ptAct = working[ptIdx]!
              const ptAlias = asString((ptAct.inputs as { alias?: unknown }).alias) ?? target.pt
              const ptLabel = asString((ptAct.inputs as { label?: unknown }).label) ?? target.pt
              const pos2 = p2ByLabel.get(target.pt)
              if (!pos2) continue
              const hostIdx = working.findIndex((a) => {
                if (!a.actionId.startsWith("planar.create_") && a.actionId !== "function.create_graph") return false
                if (a.actionId === "planar.create_point") return false
                const inp = a.inputs as { alias?: unknown; label?: unknown }
                return inp.alias === target.hostName || inp.label === target.hostName
              })
              if (hostIdx < 0) continue
              const hostAct = working[hostIdx]!
              const hostAlias = asString((hostAct.inputs as { alias?: unknown }).alias)
              const hostLabel = asString((hostAct.inputs as { label?: unknown }).label) ?? hostAlias
              const hostPrim = docBefore.primitives.find((p) => (p.label ?? p.id) === hostLabel && p.type !== "point")
              if (!hostAlias || !hostPrim) continue
              const u = projectOntoPath(hostPrim, pos2, docBefore.parameters)
              const evalPt = u !== null ? pathConstraint(hostPrim, docBefore.parameters)?.evaluate(u) : null
              if (u === null || !evalPt || Math.hypot(evalPt.x - pos2.x, evalPt.y - pos2.y) > 1e-2) continue
              const boundAct = {
                actionId: "dynamic.create_bound_point",
                actionKey: ptAct.actionKey,
                factIds: [],
                inputs: { alias: ptAlias, label: ptLabel, host: { scope: "draft", alias: hostAlias }, parameter: u }
              } as unknown as DraftAction
              const reordered = placeBoundAfterHost(ptIdx, hostIdx, boundAct)
              if (reordered) {
                working = reordered
                upgraded = true
              }
            }

            // 4. 主动补全题干中与动点相关的线段，并由相交辅助线 / 题干平面与二面角自动物化 face3（复用已有动点/顶点）
            const enrichedWorking = enrichPromptSegmentsAndFaces(working, docBefore, options.problemText)
            if (enrichedWorking) {
              working = enrichedWorking
              upgraded = true
            }

            if (upgraded) {
              const testUpgrade = compilePlan(
                { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "stmt-bound-verify", factIds: [], actions: working },
                { document: createEmptyDocument(ws), workspace: ws, capabilityRevision: "draft", conversationId: "ds-stmt-verify" }
              )
              if (testUpgrade.ok && testUpgrade.draftDocument !== null) {
                primaryActions = working
              }
            }
          }
        }
        if (branchActionBuckets.size === 0) {
          const ws: GeometryDocument["workspace"] = primaryActions.some((a) => a.actionId.startsWith("solid.") || a.actionId.startsWith("derived.") || a.actionId.startsWith("section."))
            ? "geometry3d"
            : options.workspace === "geometry3d"
              ? "conics"
              : options.workspace
          const promotedPoly = promoteStandalonePolyhedronVertices(primaryActions, ws, options.problemText)
          if (promotedPoly) {
            if (!options.problemText) {
              primaryActions = promotedPoly
            } else {
              const testBefore = compilePlan(
                { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "promote-before", factIds: [], actions: primaryActions },
                { document: createEmptyDocument(ws), workspace: ws, capabilityRevision: "draft", conversationId: "ds-promote-before" }
              )
              const testAfter = compilePlan(
                { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "promote-after", factIds: [], actions: promotedPoly },
                { document: createEmptyDocument(ws), workspace: ws, capabilityRevision: "draft", conversationId: "ds-promote-after" }
              )
              if (testBefore.ok && testBefore.draftDocument && testAfter.ok && testAfter.draftDocument) {
                const certBefore = certifyDrawingAgainstContract({
                  prompt: options.problemText,
                  document: testBefore.draftDocument,
                  candidateHash: snap.candidateHash,
                  sourceHash: snap.candidateHash,
                  plan: { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "before", factIds: [], actions: primaryActions }
                })
                const certAfter = certifyDrawingAgainstContract({
                  prompt: options.problemText,
                  document: testAfter.draftDocument,
                  candidateHash: snap.candidateHash,
                  sourceHash: snap.candidateHash,
                  plan: { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "after", factIds: [], actions: promotedPoly }
                })
                if ((certAfter.failedObligations?.length ?? 0) <= (certBefore.failedObligations?.length ?? 0)) {
                  primaryActions = promotedPoly
                }
              }
            }
          }
          const consolidated = consolidateSolidScaffolding(primaryActions, ws)
          if (consolidated && consolidated.length > 0 && consolidated.length < primaryActions.length) {
            const testBase = compilePlan(
              { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "consolidate-before", factIds: [], actions: primaryActions },
              { document: createEmptyDocument(ws), workspace: ws, capabilityRevision: "draft", conversationId: "ds-consolidate-before" }
            )
            const testAfter = compilePlan(
              { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "consolidate-after", factIds: [], actions: consolidated },
              { document: createEmptyDocument(ws), workspace: ws, capabilityRevision: "draft", conversationId: "ds-consolidate-after" }
            )
            if (testBase.ok && testBase.draftDocument && testAfter.ok && testAfter.draftDocument) {
              if (!options.problemText) {
                primaryActions = consolidated
              } else {
                const certBefore = certifyDrawingAgainstContract({
                  prompt: options.problemText,
                  document: testBase.draftDocument,
                  candidateHash: snap.candidateHash,
                  sourceHash: snap.candidateHash,
                  plan: { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "before", factIds: [], actions: primaryActions }
                })
                const certAfter = certifyDrawingAgainstContract({
                  prompt: options.problemText,
                  document: testAfter.draftDocument,
                  candidateHash: snap.candidateHash,
                  sourceHash: snap.candidateHash,
                  plan: { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "after", factIds: [], actions: consolidated }
                })
                if ((certAfter.failedObligations?.length ?? 0) <= (certBefore.failedObligations?.length ?? 0)) {
                  primaryActions = consolidated
                }
              }
            }
          }
        }
        const rawGoal = asString(input.goal)?.trim();
        const rawAnswer = asString(input.answer)?.trim();
        const rawNorms = Array.isArray(input.normalisations)
          ? input.normalisations.flatMap((entry) => {
              if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return []
              const obj = entry as Record<string, unknown>
              const original = asString(obj.original)
              const normalized = asString(obj.normalized)
              return original && normalized ? [{ original, normalized }] : []
            })
          : []
        const safeGoal = rawGoal ? (rawGoal.length > 200 ? `${rawGoal.slice(0, 197)}...` : rawGoal) : "DS 动作级构图候选";
        let plan: PlanEnvelope = {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "plan",
          goal: safeGoal,
          factIds: [],
          actions: [...primaryActions],
          ...(rawAnswer ? { answer: rawAnswer } : {}),
          ...(rawNorms.length > 0 ? { normalisations: rawNorms } : {}),
          ...(symbolicDisplays.size === 0 ? {} : {
            assumptions: primaryActions.flatMap((action) => {
              const display = symbolicDisplays.get(action.actionKey)
              return display === undefined ? [] : [
                `${display.symbol} > 0; display ${display.displayScale} is a drawing scale only, not a value inferred for ${display.symbol}`
              ]
            })
          })
        }
        const finalSlices: readonly DsActionStateSlice[] | undefined =
          recordedSlices.length > 0 ? [...recordedSlices] : undefined

        if (options.problemText && symbolicDisplays.size === 0 && plan.kind === "plan") {
          const ws: GeometryDocument["workspace"] =
            plan.actions.some((a) => a.actionId.startsWith("solid.") || a.actionId.startsWith("derived.") || a.actionId.startsWith("section."))
              ? "geometry3d"
              : options.workspace === "geometry3d"
                ? "conics"
                : options.workspace
          const compiled = compilePlan(plan, {
            document: createEmptyDocument(ws),
            conversationId: "ds-finish-check",
            documentGeneration: 0,
            workspace: ws
          })
          const doc = compiled.ok && compiled.draftDocument ? compiled.draftDocument : createEmptyDocument(ws)
          const enrichedActions = enrichPromptSegmentsAndFaces(plan.actions, doc, options.problemText)
          if (enrichedActions) {
            const enrichedPlan: PlanEnvelope = { ...plan, actions: enrichedActions }
            const enrichedCompiled = compilePlan(enrichedPlan, {
              document: createEmptyDocument(ws),
              conversationId: "ds-route-face-check",
              documentGeneration: 0,
              workspace: ws
            })
            if (enrichedCompiled.ok) {
              plan = enrichedPlan
            }
          }
        }
        const rawScope = asString(input.scopeId)?.trim()
        const normalizedScope = rawScope
          ? (/^(?:subquestion:(\d+)|[（(]?(\d+)[)）]?)$/.exec(rawScope)
              ? `subquestion:${/^(?:subquestion:(\d+)|[（(]?(\d+)[)）]?)$/.exec(rawScope)![1] ?? /^(?:subquestion:(\d+)|[（(]?(\d+)[)）]?)$/.exec(rawScope)![2]}`
              : rawScope === "shared" ? "shared" : undefined)
          : undefined
        const answerDeclaresPart2Infeasible = Boolean(
          (rawAnswer || rawGoal) &&
          /(?:第\s*[（(]?2[)）]?\s*问|subquestion[:\s]*2|PF₁⊥PF₂|b\s*[>≥]\s*c)[\s\S]{0,60}?(?:无解|不存在|不成立|矛盾|不可行|infeasible)/i.test(`${rawGoal ?? ""} ${rawAnswer ?? ""}`)
        )
        const omittedMovingP = !readP2("P") && !readP3("P")
        const resolvedScopeId = normalizedScope
          ?? (answerDeclaresPart2Infeasible || (sawInfeasibleConicPerp && omittedMovingP) ? "subquestion:1" : undefined)
          ?? (finalSlices?.length === 1 && /^subquestion:\d+$/.test(finalSlices[0]!.scopeId) ? finalSlices[0]!.scopeId : undefined)
        let effectiveScopeId = resolvedScopeId
        if (options.problemText && symbolicDisplays.size === 0 && branchActionBuckets.size === 0 && plan.kind === "plan") {
          const certWs: GeometryDocument["workspace"] =
            plan.actions.some((a) => a.actionId.startsWith("solid.") || a.actionId.startsWith("derived.") || a.actionId.startsWith("section."))
              ? "geometry3d"
              : options.workspace === "geometry3d"
                ? "conics"
                : options.workspace
          const certCompiled = compilePlan(plan, {
            document: createEmptyDocument(certWs),
            conversationId: "ds-finish-precert",
            documentGeneration: 0,
            workspace: certWs
          })
          if (certCompiled.ok && certCompiled.draftDocument) {
            const finalDoc = certCompiled.draftDocument
            effectiveScopeId = resolveInfeasibleEllipseFallbackScope({
              prompt: options.problemText,
              document: finalDoc,
              plan,
              ...(resolvedScopeId === undefined ? {} : { requestedScopeId: resolvedScopeId })
            }) ?? resolvedScopeId
            if (inSessionCertRejections < 2 && snap.candidateHash !== lastPreCertRejectedHash) {
              const cert = certifyDrawingAgainstContract({
                prompt: options.problemText,
                document: finalDoc,
                candidateHash: snap.candidateHash,
                sourceHash: snap.candidateHash,
                plan,
                ...(effectiveScopeId === undefined ? {} : { selectedScopeId: effectiveScopeId })
              })
              const failedChecks = (cert.report?.checks ?? []).filter((c) => c.status === "failed")
              const acceptanceReqs = deriveAcceptance(options.problemText)
              const needsPolyhedron = acceptanceReqs.some(
                (c) => c.kind === "has_primitive" && c.type === "polyhedron3"
              ) && !finalDoc.primitives.some((p) => p.type === "polyhedron3")
              const needsSphere = acceptanceReqs.some(
                (c) => c.kind === "has_primitive" && c.type === "sphere"
              ) && !finalDoc.primitives.some((p) => p.type === "sphere")
              const needsCircle = /以[^，,。；;\n]{0,18}为圆心的圆/.test(options.problemText)
                && !finalDoc.primitives.some((p) => p.type === "circle")
              const missingPts = cert.gate.status === "blocked" && Array.isArray(cert.missingEntities)
                ? cert.missingEntities.filter((m) => /^[A-Z][₁₂₃0-9'′]?$/.test(m))
                : []
              const missingFunctionChecks = cert.gate.status === "blocked"
                ? (cert.report?.checks ?? []).filter((c) => c.status === "unverified" && c.kind === "functionGraph")
                : []
              const extraGateFailures = cert.gate.status === "blocked" && Array.isArray(cert.failedObligations)
                ? cert.failedObligations
                    .filter((f) => f.id.startsWith("circle-extreme-chords:") || f.id === "unparsed:tangent")
                    .map((f) => f.detail)
                : []
              const hasConicRatioFailure = failedChecks.some((c) => c.kind === "segmentRatio") &&
                finalDoc.primitives.some((p) => p.type === "ellipse" || p.type === "hyperbola" || p.type === "parabola" || p.type === "circle")
              if (failedChecks.length > 0 || missingFunctionChecks.length > 0 || extraGateFailures.length > 0 || needsPolyhedron || needsSphere || needsCircle || missingPts.length > 0) {
                inSessionCertRejections += 1
                lastPreCertRejectedHash = snap.candidateHash
                const reasons = [
                  ...failedChecks.map((c) => `${c.sourceText}：${c.reason}`),
                  ...missingFunctionChecks.map((c) => `${c.sourceText}：${c.reason}（请保留已画函数，直接用 construct_tangent({ id, functionId, expression, mode: "graph" }) 补画缺失函数后重新调用 finish_candidate）`),
                  ...extraGateFailures,
                  ...(hasConicRatioFailure ? ["内核快捷求解提示：对于过定点与圆锥曲线相交且满足向量比值的弦直线，可直接用 construct_line({ id, throughPointId, conicId, chordRatio }) 由几何内核精确解出直线并再求交点！"] : []),
                  ...(needsPolyhedron ? ["缺少三维多面体图元（polyhedron3）：请调用 construct_solid（可传已构造顶点名 vertexNames）生成实体，不要仅留零散点/线段。"] : []),
                  ...(needsSphere ? ["缺少球体图元（sphere）：请调用 construct_circumsphere(solidId=...) 或 construct_solid(kind='sphere', ...) 生成球体。"] : []),
                  ...(needsCircle ? ["缺少圆图元（circle）：题面提到以某点为圆心的圆，请保留当前已构造的点与曲线，直接调用 construct_circle(centerId=..., radius=...) 补画该圆后再调用 finish_candidate。"] : []),
                  ...(missingPts.length > 0 ? [`题面点名缺失（导致未核验）：${missingPts.join("、")} —— 请保留当前已通过验证的主体图形，直接用 construct_point 补充缺失点（例如翻折题需补折前点坐标）后再调用 finish_candidate。`] : [])
                ]
                const seenPtLabels = new Set<string>()
                const ptCoordsSummary: string[] = []
                for (const p of finalDoc.primitives) {
                  if (ptCoordsSummary.length >= 12) break
                  if (p.type === "point" && p.label && !seenPtLabels.has(p.label)) {
                    seenPtLabels.add(p.label)
                    ptCoordsSummary.push(`${p.label}=(${Number(p.x.toFixed(4))},${Number(p.y.toFixed(4))})`)
                  } else if (p.type === "point3" && p.label && !seenPtLabels.has(p.label)) {
                    seenPtLabels.add(p.label)
                    ptCoordsSummary.push(`${p.label}=(${Number(p.position.x.toFixed(4))},${Number(p.position.y.toFixed(4))},${Number(p.position.z.toFixed(4))})`)
                  }
                }
                const coordNote = ptCoordsSummary.length > 0 ? `\n当前已构造点坐标：${ptCoordsSummary.join(", ")}` : ""
                return failRepairable(
                  name,
                  "diagram_condition_failed",
                  `候选图尚未通过几何核验（第 ${inSessionCertRejections}/2 次同会话自检），请保留已通过验证的点/曲线，仅用 repair_entity 修正以下偏差后重新调用 finish_candidate（切勿调用 request_clarification 质疑题面）：\n- ${reasons.join("\n- ")}${coordNote}`
                )
              }
            }
          }
        }
        return {
          ok: true,
          status: "accepted",
          action: name,
          stateChanged: false,
          candidateHash: snap.candidateHash,
          stepIndex: snap.stepIndex,
          primitiveCount: snap.primitiveCount,
          terminated: {
            plan,
            ...(effectiveScopeId === undefined ? {} : { selectedScopeId: effectiveScopeId }),
            ...(finalSlices !== undefined && finalSlices.length > 0 ? { slices: finalSlices } : {})
          }
        }
      }

      if (name === "request_clarification") {
        const reason = asString(input.reason) ?? "需要进一步明确题目条件或补充信息"
        const rawQsText = Array.isArray(input.questions) ? input.questions.map((q) => String(q ?? "")).join(" ") : ""
        const combinedClarify = `${reason} ${rawQsText}`
        if (
          options.problemText &&
          !/如图|图上|图中的|附图|未给出图形|如图所示/.test(options.problemText) &&
          /是否|确认|请问|符合题意|纯文字|凸四边形|凸多边形|自行构造|翻折|验证器|核验|笔误|延长线|义务|无解|无法使|候选图|不在线段内|坐标有误|斜率/.test(combinedClarify)
        ) {
          return failRepairable(
            name,
            "clarification_unnecessary",
            "Pure-text self-contained problem: do NOT ask the user to confirm verifier messages, suspected typos, orientation, or segment-vs-line wording. Check your own construction (e.g. swap intersection selection min_y/max_y, adjust line slope, avoid duplicate circles/conics, or fix coordinates) and call finish_candidate directly."
          )
        }
        const rawQuestions = Array.isArray(input.questions)
          ? input.questions.map((q) => asString(q)).filter((q): q is string => q !== null)
          : []
        const questions = rawQuestions.length > 0 ? rawQuestions.slice(0, 4) : [reason]
        return {
          ok: true,
          status: "accepted",
          action: name,
          stateChanged: false,
          candidateHash: snap.candidateHash,
          stepIndex: snap.stepIndex,
          primitiveCount: snap.primitiveCount,
          terminated: {
            plan: {
              schemaVersion: PLAN_SCHEMA_VERSION,
              kind: "clarification",
              goal: reason.slice(0, 200),
              factIds: [],
              questions
            }
          }
        }
      }

      if (name === "construct_solid" || name === "construct_equal_edge_triangular_prism") {
        const symbol = asString(input.symbol)
        const text = options.problemText ?? ""
        if (symbol === null && input.displayScale === undefined && asString(input.kind ?? input.shape) === "triangular_prism" && hasEqualEdgeSymbolA(text)) {
          return failBlocked(name, "symbol_source_required", "this prompt gives a symbolic edge length; provide symbol and displayScale instead of invented dimensions")
        }
        let normalizedInput: Record<string, unknown> = input
        if (symbol !== null || input.displayScale !== undefined) {
          const positiveSource = /\ba\s*>\s*0\b/i.test(text) || hasEqualEdgeSymbolA(text)
          const equalEdgeSource = hasEqualEdgeSymbolA(text)
          if (symbol !== "a" || !positiveSource || !equalEdgeSource) {
            return failBlocked(name, "symbol_source_missing", "symbolic display needs a confirmed source with positive edge parameter a")
          }
          if (!hasRightTriangularPrismSource(text)) {
            return failBlocked(name, "symbolic_prism_shape_mismatch", "a right triangular prism requires an affirmative rightness condition in the prompt")
          }
          const scale = asPositiveNumber(input.displayScale)
          if (scale === null || !Number.isFinite(scale) || scale > 1e6 || input.height !== undefined || input.sideLength !== undefined || input.ab !== undefined || input.ac !== undefined || input.bc !== undefined) {
            return failBlocked(name, "invalid_symbolic_scale", "provide a finite positive displayScale only; no contradictory numeric dimensions")
          }
          if (asString(input.kind ?? input.shape) !== "triangular_prism") {
            return failBlocked(name, "unsupported_symbolic_kind", "symbolic equal-edge display currently supports triangular_prism")
          }
          normalizedInput = { ...input, sideLength: scale, height: scale }
        }
        const solidInput = Array.isArray(normalizedInput.vertexNames)
          ? {
              ...normalizedInput,
              vertexNames: normalizedInput.vertexNames.map((v) => (typeof v === "string" ? canonicalizePointLabel(v) : v))
            }
          : normalizedInput
        const resolved = resolveConstructSolidRequest(solidInput, points3, options.problemText)
        if (!resolved.ok) {
          return resolved.status === "blocked"
            ? failBlocked(name, resolved.blockerCode, resolved.repairHint)
            : failRepairable(name, resolved.blockerCode, resolved.repairHint)
        }
        const id = asString(input.id ?? input.output) ?? `SOLID_${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = {
          scopeId,
          ...(explicitStateId === undefined ? {} : { stateId: explicitStateId }),
          ...(branchId === undefined ? {} : { branchId })
        }
        if (resolved.mode === "insphere") {
          return executeHostInsphere(name, resolved.solidId, id, label, `ds-act-${stepSeq}`, sliceTarget)
        }
        if (resolved.mode === "template") {
          const stagedTemplate = stageDraftAction(
            name,
            {
              actionId: resolved.actionId,
              actionKey: `ds-act-${stepSeq}`,
              factIds: [],
              inputs: { alias: id, label, ...resolved.inputs }
            } as unknown as DraftAction,
            id,
            undefined,
            sliceTarget
          )
          if (stagedTemplate.ok && !branchId && !explicitStateId) {
            const curSnap = speculative.snapshot()
            upsertSlice({
              scopeId,
              candidateHash: curSnap.candidateHash,
              actions: [...curSnap.actions]
            })
          }
          return stagedTemplate
        }
        const summarizeSolidMetrics = (registry: Record<string, Vector3>): { edgeLengths: Record<string, number>; perpendicularPairs: string[] } | undefined => {
          const keys = Object.keys(registry)
          if (keys.length < 3 || keys.length > 5) return undefined
          const edgeLengths: Record<string, number> = {}
          for (let i = 0; i < keys.length; i += 1) {
            for (let j = i + 1; j < keys.length; j += 1) {
              const a = keys[i]!, b = keys[j]!
              edgeLengths[`${a}${b}`] = Number(distanceVector3(registry[a]!, registry[b]!).toFixed(6))
            }
          }
          const perpendicularPairs: string[] = []
          const pairs: Array<[string, string, Vector3]> = []
          for (let i = 0; i < keys.length; i += 1) {
            for (let j = i + 1; j < keys.length; j += 1) {
              const a = keys[i]!, b = keys[j]!
              const pA = registry[a]!, pB = registry[b]!
              pairs.push([a, b, { x: pB.x - pA.x, y: pB.y - pA.y, z: pB.z - pA.z }])
            }
          }
          for (let i = 0; i < pairs.length; i += 1) {
            for (let j = i + 1; j < pairs.length; j += 1) {
              const [a1, b1, u] = pairs[i]!
              const [a2, b2, v] = pairs[j]!
              const uLen = Math.hypot(u.x, u.y, u.z)
              const vLen = Math.hypot(v.x, v.y, v.z)
              if (uLen > 1e-9 && vLen > 1e-9 && Math.abs(u.x * v.x + u.y * v.y + u.z * v.z) / (uLen * vLen) <= 1e-4) {
                perpendicularPairs.push(`${a1}${b1}⊥${a2}${b2}`)
              }
            }
          }
          return { edgeLengths, perpendicularPairs }
        }
        if (resolved.mode === "polyhedron") {
          for (const [vn, pt] of Object.entries(resolved.pointRegistry)) {
            points3.set(vn, pt)
          }
          const stagedPoly = stageDraftAction(
            name,
            {
              actionId: "solid.create_polyhedron",
              actionKey: `ds-act-${stepSeq}`,
              factIds: [],
              inputs: {
                alias: id,
                label,
                vertices: resolved.vertices,
                vertexNames: resolved.vertexNames,
                faces: resolved.faces
              }
            } as DraftAction,
            id,
            undefined,
            sliceTarget
          )
          if (!stagedPoly.ok) {
            const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
            points3.clear()
            for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
          } else if (!branchId && !explicitStateId) {
            const curSnap = speculative.snapshot()
            upsertSlice({
              scopeId,
              candidateHash: curSnap.candidateHash,
              actions: [...curSnap.actions]
            })
          }
          const metrics = summarizeSolidMetrics(resolved.pointRegistry)
          return stagedPoly.ok
            ? { ...stagedPoly, measurement: { vertices: resolved.pointRegistry, ...(metrics ?? {}) } }
            : stagedPoly
        }
        const solved = solveConstraint3d(resolved.request)
        if (solved.status !== "solved" || !solved.topologyValid || !solved.vertices || !solved.faceRings) {
          let detail = solved.reason ?? "solid parameters are infeasible or degenerate"
          if (resolved.request.kind === "tetrahedron" && resolved.request.names) {
            const [v0, v1, v2, v3] = resolved.request.names
            const { ab, ac, bc, pa, pb, pc } = resolved.request
            const triCheck = (e1: number, n1: string, e2: number, n2: string, e3: number, n3: string, fName: string) => {
              if (e1 + e2 <= e3 + 1e-9) {
                return `面 ${fName} (${n1}=${Number(e1.toFixed(4))}, ${n2}=${Number(e2.toFixed(4))}, ${n3}=${Number(e3.toFixed(4))}) 不满足三角形不等式：${n1}+${n2}<= ${n3}，需满足 |${n3}-${n2}|=${Number(Math.abs(e3 - e2).toFixed(4))} < ${n1} < ${Number((e3 + e2).toFixed(4))}`
              }
              if (e1 + e3 <= e2 + 1e-9) {
                return `面 ${fName} (${n1}=${Number(e1.toFixed(4))}, ${n2}=${Number(e2.toFixed(4))}, ${n3}=${Number(e3.toFixed(4))}) 不满足三角形不等式：${n1}+${n3}<= ${n2}，需满足 |${n2}-${n1}|=${Number(Math.abs(e2 - e1).toFixed(4))} < ${n3} < ${Number((e2 + e1).toFixed(4))}`
              }
              if (e2 + e3 <= e1 + 1e-9) {
                return `面 ${fName} (${n1}=${Number(e1.toFixed(4))}, ${n2}=${Number(e2.toFixed(4))}, ${n3}=${Number(e3.toFixed(4))}) 不满足三角形不等式：${n2}+${n3}<= ${n1}，需满足 |${n1}-${n2}|=${Number(Math.abs(e1 - e2).toFixed(4))} < ${n3} < ${Number((e1 + e2).toFixed(4))}`
              }
              return null
            }
            const faceFail =
              triCheck(ab, `${v1}${v2}`, ac, `${v1}${v3}`, bc, `${v2}${v3}`, `${v1}${v2}${v3}`) ??
              triCheck(pa, `${v0}${v1}`, pb, `${v0}${v2}`, ab, `${v1}${v2}`, `${v0}${v1}${v2}`) ??
              triCheck(pa, `${v0}${v1}`, pc, `${v0}${v3}`, ac, `${v1}${v3}`, `${v0}${v1}${v3}`) ??
              triCheck(pb, `${v0}${v2}`, pc, `${v0}${v3}`, bc, `${v2}${v3}`, `${v0}${v2}${v3}`)
            let intervalNote = ""
            if (faceFail) {
              intervalNote = `；${faceFail}`
            } else {
              // Exact 3D circle feasibility bounds for |v0-v2| (pb) given base (ab,ac,bc) and (pa,pc)
              const x3 = (ac * ac + ab * ab - bc * bc) / (2 * ab)
              const y3Sq = ac * ac - x3 * x3
              if (y3Sq > 1e-12) {
                const y3 = Math.sqrt(y3Sq)
                // Axis u along v1->v3, in-plane perpendicular w toward v2
                const uX = x3 / ac, uY = y3 / ac
                const wX = uY
                const projP = (pa * pa + ac * ac - pc * pc) / (2 * ac)
                const rSq = pa * pa - projP * projP
                if (rSq > 1e-12) {
                  const r = Math.sqrt(rSq)
                  const bProjU = ab * uX
                  const bProjW = Math.abs(ab * wX)
                  const du = projP - bProjU
                  const pbMin = Math.sqrt(du * du + (bProjW - r) * (bProjW - r))
                  const pbMax = Math.sqrt(du * du + (bProjW + r) * (bProjW + r))
                  const pbPerp = Math.sqrt(du * du + bProjW * bProjW + r * r)
                  intervalNote = `；固定其余 5 棱 (${v1}${v2}=${Number(ab.toFixed(4))}, ${v1}${v3}=${Number(ac.toFixed(4))}, ${v2}${v3}=${Number(bc.toFixed(4))}, ${v0}${v1}=${Number(pa.toFixed(4))}, ${v0}${v3}=${Number(pc.toFixed(4))}) 时，pb=|${v0}${v2}| 的可行开区间为 (${Number(pbMin.toFixed(4))}, ${Number(pbMax.toFixed(4))})（面 ${v0}${v1}${v3}⊥面 ${v1}${v2}${v3} 时 pb=${Number(pbPerp.toFixed(4))}），当前传入 pb=${Number(pb.toFixed(4))}`
                }
              }
            }
            detail += `${intervalNote} (vertexNames=[${v0},${v1},${v2},${v3}] maps to pa=|${v0}${v1}|, pb=|${v0}${v2}|, pc=|${v0}${v3}|, ab=|${v1}${v2}|, ac=|${v1}${v3}|, bc=|${v2}${v3}|; or construct 4 non-coplanar 3D points with construct_point and call construct_solid without edge lengths)`
          }
          return solved.status === "infeasible" || solved.status === "degenerate"
            ? failBlocked(name, solved.status, detail)
            : failRepairable(name, solved.status, detail)
        }
        const vertexNames = Object.keys(solved.pointRegistry)
        const vertices = vertexNames.map((vn) => solved.pointRegistry[vn]!)
        const nameToIdx = new Map(vertexNames.map((vn, idx) => [vn, idx]))
        const faces = solved.namedFaceRings
          ? solved.namedFaceRings.map((ring) => ring.map((vn) => nameToIdx.get(vn)!))
          : solved.faceRings
        for (const [vn, pt] of Object.entries(solved.pointRegistry)) {
          points3.set(vn, pt)
        }
        const staged = stageDraftAction(
          name,
          resolved.request.kind === "prism"
            ? {
                actionId: "solid.create_prism",
                actionKey: `ds-act-${stepSeq}`,
                factIds: [],
                inputs: {
                  alias: id, label,
                  basePolygon: resolved.request.baseVertices.map((v) => v.point),
                  vector: {
                    x: solved.pointRegistry[resolved.request.topLabels[0]!]!.x - resolved.request.baseVertices[0]!.point.x,
                    y: solved.pointRegistry[resolved.request.topLabels[0]!]!.y - resolved.request.baseVertices[0]!.point.y,
                    z: solved.pointRegistry[resolved.request.topLabels[0]!]!.z - resolved.request.baseVertices[0]!.point.z
                  },
                  vertexNames: [...resolved.request.baseVertices.map((v) => v.name), ...resolved.request.topLabels]
                }
              } as DraftAction
            : {
                actionId: "solid.create_polyhedron",
                actionKey: `ds-act-${stepSeq}`,
                factIds: [],
                inputs: { alias: id, label, vertices, vertexNames, faces }
              } as DraftAction,
          id,
          undefined,
          sliceTarget
        )
        if (staged.ok && symbol === "a") symbolicDisplays.set(`ds-act-${stepSeq}`, { symbol: "a", displayScale: Number(input.displayScale) })
        if (!staged.ok) {
          const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
          points3.clear()
          for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
        } else if (!branchId && !explicitStateId) {
          const curSnap = speculative.snapshot()
          upsertSlice({
            scopeId,
            candidateHash: curSnap.candidateHash,
            actions: [...curSnap.actions]
          })
        }
        const metrics = summarizeSolidMetrics(solved.pointRegistry)
        return staged.ok ? { ...staged, measurement: { vertices: solved.pointRegistry, ...(metrics ?? {}) } } : staged
      }

      if (name === "construct_circumsphere") {
        const unknownField = Object.keys(input).find((field) => !(field in CONSTRUCT_CIRCUMSPHERE_PARAMETERS.properties))
        if (unknownField) return failBlocked(name, "invalid_schema", "circumsphere accepts only solidId, mode, id, output, label and slice identifiers")
        const scopeId = asString(input.scopeId) ?? "shared"
        const stateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const id = asString(input.id ?? input.output) ?? `SPHERE_${stepSeq}`
        const label = asString(input.label) ?? id
        const mode = asString(input.mode)?.toLowerCase() ?? "circumsphere"
        if (mode === "insphere") {
          return executeHostInsphere(name, asString(input.solidId) ?? undefined, id, label, `ds-act-${stepSeq}`, {
            scopeId,
            ...(stateId === undefined ? {} : { stateId }),
            ...(branchId === undefined ? {} : { branchId })
          })
        }
        const canvas = getTargetCanvas(branchId)
        const hostActions = canvas.snapshot().actions.filter((action) =>
          action.actionId === "solid.create_polyhedron" ||
          action.actionId === "solid.create_prism" ||
          action.actionId === "solid.create_template"
        )
        const requestedSolidId = asString(input.solidId)
        const hostAction = requestedSolidId
          ? hostActions.find((action) => action.inputs.alias === requestedSolidId || action.inputs.label === requestedSolidId)
          : hostActions.at(-1)
        const resolvedSolidId = hostAction && typeof hostAction.inputs.alias === "string"
          ? hostAction.inputs.alias
          : null
        if (!resolvedSolidId) {
          if (hostActions.length === 0 && !requestedSolidId && points3.size >= 4) {
            const circ = computeCircumsphereFromVerts([...points3.values()])
            if (circ) {
              const stagedSphere = stageDraftAction(name, {
                actionId: "solid.create_sphere",
                actionKey: `ds-act-${stepSeq}`,
                factIds: [],
                inputs: { alias: id, label, center: circ.center, radius: circ.radius }
              } as unknown as DraftAction, id, undefined, {
                scopeId,
                ...(stateId === undefined ? {} : { stateId }),
                ...(branchId === undefined ? {} : { branchId })
              })
              if (stagedSphere.ok) {
                writeP3(id, circ.center, branchId)
                writeP3(label, circ.center, branchId)
              }
              return stagedSphere.ok ? { ...stagedSphere, measurement: circ } : stagedSphere
            }
          }
          return hostActions.length === 0 && !requestedSolidId
            ? failRepairable(name, "missing_required_parameter", "construct a solid (polyhedron, prism, cone, cylinder) or 4 non-coplanar 3D points before construct_circumsphere")
            : failBlocked(name, "missing_host", "circumsphere host must be an existing staged solid")
        }
        if (hostAction?.actionId === "solid.create_template") {
          const template = asString(hostAction.inputs.template)
          const origin = readOriginVector3(hostAction.inputs.origin)
          let circ: { center: Vector3; radius: number } | null = null
          if (template === "cone" || template === "cylinder") {
            const r = asPositiveNumber(hostAction.inputs.radius)
            const h = asPositiveNumber(hostAction.inputs.height)
            if (r !== null && h !== null) {
              if (template === "cone") {
                const R = (h * h + r * r) / (2 * h)
                circ = { center: { x: origin.x, y: origin.y, z: origin.z + h - R }, radius: R }
              } else {
                const R = Math.hypot(r, h * 0.5)
                circ = { center: { x: origin.x, y: origin.y, z: origin.z + h * 0.5 }, radius: R }
              }
            }
          } else if (template === "cube" && hostAction.inputs.size && typeof hostAction.inputs.size === "object") {
            const sz = hostAction.inputs.size as { x?: unknown; y?: unknown; z?: unknown }
            const sx = asPositiveNumber(sz.x)
            const sy = asPositiveNumber(sz.y)
            const szz = asPositiveNumber(sz.z)
            if (sx !== null && sy !== null && szz !== null) {
              circ = { center: origin, radius: 0.5 * Math.hypot(sx, sy, szz) }
            }
          }
          if (!circ) {
            return failBlocked(name, "missing_host", `cannot compute circumsphere for solid template "${template ?? "unknown"}"`)
          }
          const stagedSphere = stageDraftAction(name, {
            actionId: "solid.create_sphere",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: { alias: id, label, center: circ.center, radius: circ.radius }
          } as unknown as DraftAction, id, undefined, {
            scopeId,
            ...(stateId === undefined ? {} : { stateId }),
            ...(branchId === undefined ? {} : { branchId })
          })
          if (stagedSphere.ok) {
            writeP3(id, circ.center, branchId)
            writeP3(label, circ.center, branchId)
            if (!branchId && !stateId) {
              const curSnap = speculative.snapshot()
              upsertSlice({ scopeId, candidateHash: curSnap.candidateHash, actions: [...curSnap.actions] })
            }
          }
          return stagedSphere.ok ? { ...stagedSphere, measurement: circ } : stagedSphere
        }
        const hostCirc = computeCircumsphereFromVerts(hostVerticesOfAction(hostAction))
        const stagedCircum = stageDraftAction(name, {
          actionId: "derived.create_circumsphere", actionKey: `ds-act-${stepSeq}`, factIds: [],
          inputs: { alias: id, label, solidId: { scope: "draft", alias: resolvedSolidId } }
        } as unknown as DraftAction, id, undefined, { scopeId,
          ...(stateId === undefined ? {} : { stateId }), ...(branchId === undefined ? {} : { branchId }) })
        if (stagedCircum.ok && hostCirc) {
          writeP3(id, hostCirc.center, branchId)
          writeP3(label, hostCirc.center, branchId)
        }
        return stagedCircum.ok && hostCirc ? { ...stagedCircum, measurement: hostCirc } : stagedCircum
      }

      if (name === "construct_base") {
        const shape = asString(input.shape ?? input.kind)?.toLowerCase() ?? "rectangle"
        const mappedKind = shape === "triangle" ? "triangular_prism" : shape
        const scopeId = asString(input.scopeId) ?? "shared"
        const problemHasFold = typeof options.problemText === "string" && /(?:翻折|折叠|折起|翻起)/.test(options.problemText)
        const stateId = asString(input.stateId) ?? (problemHasFold ? "before_fold" : undefined)
        const branchId = asString(input.branchId) ?? undefined
        const base = resolveBasePolygonFromParams(mappedKind, input, points3, options.problemText)
        if (!base.ok) {
          return base.status === "blocked"
            ? failBlocked(name, base.blockerCode, base.repairHint)
            : failRepairable(name, base.blockerCode, base.repairHint)
        }
        const rawNames = asStringList(input.vertexNames)
        const baseVertices = rawNames && rawNames.length === base.baseVertices.length
          ? base.baseVertices.map((bv, idx) => ({ name: rawNames[idx]!, point: bv.point }))
          : base.baseVertices
        const id = asString(input.id ?? input.output) ?? `BASE_${stepSeq}`
        const label = asString(input.label) ?? id
        for (const bv of baseVertices) {
          writeP3(bv.name, bv.point, branchId)
          writeP2(bv.name, { x: bv.point.x, y: bv.point.y }, branchId)
        }
        const staged = stageDraftAction(
          name,
          {
            actionId: "solid.create_face",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: {
              alias: id,
              label,
              vertices: baseVertices.map((bv) => bv.point),
              vertexNames: baseVertices.map((bv) => bv.name)
            }
          } as DraftAction,
          id,
          undefined,
          { scopeId, stateId, ...(branchId === undefined ? {} : { branchId }) }
        )
        if (!staged.ok) {
          const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
          points3.clear()
          for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
          points2.clear()
          for (const [k, v] of rollbackSnap.points2) points2.set(k, v)
        }
        return staged
      }

      if (name === "construct_face") {
        const has3dGeometry = options.workspace === "geometry3d"
          || [...points3.values()].some((p) => Math.abs(p.z) > 1e-6)
        if (!has3dGeometry) {
          return failRepairable(
            name,
            "workspace_mismatch",
            "construct_face is for 3D planes/faces only; in 2D planar/conic diagrams draw polygon edges with construct_segment instead of construct_face (do not mix 3D faces into 2D drawings)"
          )
        }
        const vertexNames = asStringList(input.vertexNames ?? input.pointIds)
        if (!vertexNames || vertexNames.length < 3) {
          return failRepairable(name, "missing_required_parameter", "construct_face requires vertexNames with at least 3 distinct names")
        }
        if (new Set(vertexNames).size !== vertexNames.length) {
          return failRepairable(name, "duplicate_vertex_name", "construct_face vertexNames must be distinct")
        }
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const verts: Vector3[] = []
        for (const vn of vertexNames) {
          const p2 = readP2(vn, branchId)
          const pt = readP3(vn, branchId) ?? (p2 ? { x: p2.x, y: p2.y, z: 0 } : undefined)
          if (!pt) return failRepairable(name, "undeclared_entity_ref", `3D vertex "${vn}" has no coordinates yet; call construct_point first`)
          verts.push(pt)
        }
        const basePlane = planeFromPoints(verts[0]!, verts[1]!, verts[2]!)
        if (!basePlane) {
          return failBlocked(name, "degenerate_face", "face vertices cannot be collinear")
        }
        if (verts.length >= 4) {
          const coplanar = solveConstraint3d({ kind: "coplanar", points: verts })
          if (coplanar.constraintStatus !== "satisfied") {
            return failBlocked(name, "non_coplanar_face", "face vertices must be coplanar")
          }
        }
        const invalidFaceVertex = vertexNames.find((vn) => !isPointName(canonicalPointName(vn)))
        if (invalidFaceVertex !== undefined) {
          const suggested = /^[A-Z]/.test(invalidFaceVertex) ? `${invalidFaceVertex[0]}′` : "P′"
          return failRepairable(
            name,
            "invalid_point_name",
            `Invalid face vertex name "${invalidFaceVertex}": every vertex name must be a single uppercase letter plus up to 2 primes/subscripts (e.g. "${suggested}", "B′", "A₁"), never multi-letter names like "${invalidFaceVertex}". For folding problems, use construct_fold_state({ vertexNames, hinge: { from, to }, apex, apexAs: "${suggested}", angle }) instead.`
          )
        }
        const id = asString(input.id ?? input.output) ?? `FACE_${stepSeq}`
        const label = asString(input.label) ?? `面 ${vertexNames.join("")}`
        const targetCanvas = getTargetCanvas(branchId ?? undefined)
        const canvasSnap = targetCanvas.snapshot()
        const existingSameFace = findMatchingFaceInDoc(targetCanvas.currentDocument(), canvasSnap.actions, verts)
        if (existingSameFace && existingSameFace.faceVerts.length === verts.length && verts.every((v) => existingSameFace.faceVerts.some((ev) => distanceVector3(ev, v) <= 1e-2))) {
          return {
            ok: true,
            status: "accepted",
            action: name,
            entity: existingSameFace.faceAlias,
            stateChanged: false,
            repairHint: `Face "${vertexNames.join("")}" is already materialized as "${existingSameFace.faceAlias}" on the canvas; reused existing face without duplicating.`,
            candidateHash: canvasSnap.candidateHash,
            stepIndex: canvasSnap.stepIndex,
            primitiveCount: canvasSnap.primitiveCount
          }
        }
        return stageDraftAction(
          name,
          {
            actionId: "solid.create_face",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: { alias: id, label, vertices: verts, vertexNames }
          } as DraftAction,
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_fold_state") {
        const vertexNames = asStringList(input.vertexNames)
        const hingeRaw = input.hinge as { from?: unknown; to?: unknown } | undefined
        const hFrom = hingeRaw ? asString(hingeRaw.from) : null
        const hTo = hingeRaw ? asString(hingeRaw.to) : null
        const apex = asString(input.apex)
        const apexAs = asString(input.apexAs)
        const angle = asFiniteNumber(input.angle)
        if (!vertexNames || vertexNames.length < 3 || !hFrom || !hTo || !apex || !apexAs || angle === null) {
          return failRepairable(name, "missing_required_parameter", "construct_fold_state requires vertexNames (>=3), hinge {from, to}, apex, apexAs, and numeric angle")
        }
        if (Math.abs(angle % 360) <= 1e-6 || apex === apexAs) {
          return failBlocked(name, "degenerate_fold", "fold angle must be non-zero mod 360 and apexAs must differ from apex")
        }
        if (!isPointName(canonicalPointName(apexAs))) {
          return failRepairable(
            name,
            "invalid_point_name",
            `Invalid folded vertex name apexAs="${apexAs}": must be a single uppercase letter plus up to 2 primes/subscripts (e.g. "${apex}′").`
          )
        }
        const invalidFoldVertex = vertexNames.find((vn) => !isPointName(canonicalPointName(vn)))
        if (invalidFoldVertex !== undefined) {
          return failRepairable(
            name,
            "invalid_point_name",
            `Invalid vertex name "${invalidFoldVertex}" in construct_fold_state vertexNames: use single uppercase letters with optional primes/subscripts (e.g. A, B, C, B′).`
          )
        }
        const readFoldPt = (vn: string): Vector3 | undefined => {
          const p3 = points3.get(vn)
          if (p3) return p3
          const p2 = points2.get(vn)
          if (!p2) return undefined
          const promoted = { x: p2.x, y: p2.y, z: 0 }
          points3.set(vn, promoted)
          return promoted
        }
        const verts: Vector3[] = []
        for (const vn of vertexNames) {
          const pt = readFoldPt(vn)
          if (!pt) return failRepairable(name, "undeclared_entity_ref", `3D fold vertex "${vn}" has no coordinates yet; call construct_point first`)
          verts.push(pt)
        }
        const pFrom = readFoldPt(hFrom)
        const pTo = readFoldPt(hTo)
        const pApex = readFoldPt(apex)
        if (!pFrom || !pTo || !pApex || !planeFromPoints(pFrom, pTo, pApex)) {
          return failBlocked(name, "degenerate_fold", "hinge endpoints and apex must be materialized and non-collinear")
        }

        const preSnap = speculative.snapshot()
        const scopeId = asString(input.scopeId) ?? "shared"
        const preStateId = asString(input.preStateId) ?? "before_fold"
        if (preSnap.actions.length > 0) {
          upsertSlice({ scopeId, stateId: preStateId, candidateHash: preSnap.candidateHash, actions: preSnap.actions })
        }

        const rotated = foldPointAboutHinge(pApex, pFrom, pTo, angle)
        if (distanceVector3(rotated, pApex) <= 1e-6) {
          return failBlocked(name, "degenerate_fold", "fold produced zero displacement from pre-fold position")
        }
        points3.set(apexAs, rotated)

        const id = asString(input.id ?? input.output) ?? `FOLD_${stepSeq}`
        const staged = stageDraftAction(
          name,
          {
            actionId: "solid.fold",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: {
              alias: id,
              label: asString(input.label) ?? id,
              vertices: verts,
              vertexNames,
              hinge: { from: hFrom, to: hTo },
              apex,
              apexAs,
              angle
            }
          } as DraftAction,
          id
        )
        if (!staged.ok) {
          const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
          points3.clear()
          for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
          return staged
        }
        if (staged.candidateHash === preSnap.candidateHash) {
          return failBlocked(name, "duplicate_lineage_hash", "post_fold candidateHash matched pre_fold candidateHash")
        }
        const postSnap = speculative.snapshot()
        const postStateId = asString(input.stateId) ?? "after_fold"
        const branchId = asString(input.branchId) ?? undefined
        upsertSlice({
          scopeId,
          stateId: postStateId,
          ...(branchId === undefined ? {} : { branchId }),
          candidateHash: postSnap.candidateHash,
          actions: postSnap.actions
        })
        return staged
      }

      return failBlocked(name, "unsupported_action", `${name} kernel execution is not implemented yet`)
  }

  const attachTelemetry = (res: DsActionRawResult, rawInput?: unknown): DsActionExecutionResult => {
    const obsKey = res.measurement
      ? `:${String(res.measurement.metric ?? res.measurement.kind ?? "")}:${JSON.stringify(res.measurement.sourceEntityIds ?? res.measurement.tangentPoint ?? "")}`
      : ""
    const failInputKey = !res.ok ? `:${canonicalContentHash(rawInput ?? null).slice(0, 12)}` : ""
    return {
      ...res,
      toolName: res.action,
      progressSignature: `${res.action}:${res.status}:${res.blockerCode ?? "none"}:${res.candidateHash}:${res.stepIndex}:${res.primitiveCount}${obsKey}${failInputKey}`
    }
  }

  const referenceDirectory = (branchId?: string): DsActionReferenceDirectory => {
    const actions = getTargetCanvas(branchId).snapshot().actions
    const points = new Set<string>()
    const lines = new Set<string>()
    const conics = new Set<string>()
    const VALID_DIR_ID = /^[\p{L}\p{N}_\u2080-\u2089\u2032'-]+$/u
    const add = (target: Set<string>, name: unknown, materialized: (key: string) => boolean) => {
      const id = asString(name)
      if (id && id.length <= 48 && VALID_DIR_ID.test(id) && materialized(id)) target.add(id)
    }
    for (const action of actions) {
      const inputs = action.inputs as Record<string, unknown>
      const names = [inputs.alias, inputs.label]
      if (
        action.actionId === "planar.create_point" ||
        action.actionId === "solid.create_point" ||
        action.actionId === "dynamic.create_bound_point" ||
        action.actionId === "dynamic.create_face_point"
      ) {
        for (const name of names) add(points, name, (key) => readP2(key, branchId) !== undefined || readP3(key, branchId) !== undefined)
      } else if (action.actionId === "planar.create_line" || action.actionId === "planar.create_segment") {
        for (const name of names) add(lines, name, (key) => readL2(key, branchId) !== undefined)
      } else if (action.actionId === "planar.create_conic" || action.actionId === "planar.create_circle" || action.actionId === "function.create_graph") {
        for (const name of names) add(conics, name, (key) => readC2(key, branchId) !== undefined || action.actionId === "function.create_graph")
      }
      if (action.actionId === "solid.create_face" || action.actionId === "solid.create_prism" || action.actionId === "solid.create_polyhedron") {
        for (const vertex of Array.isArray(inputs.vertexNames) ? inputs.vertexNames : []) {
          add(points, vertex, (key) => readP3(key, branchId) !== undefined)
        }
      }
    }
    const max = 24
    let remaining = 32
    const take = (values: string[]) => {
      const selected = values.slice(0, Math.min(max, remaining))
      remaining -= selected.length
      return selected
    }
    const sorted = (values: Set<string>) => [...values].sort()
    const materialized = new Set([...points, ...lines, ...conics])
    const visibleDeclarations = [...(explicitDeclarations.get("") ?? []), ...(branchId ? explicitDeclarations.get(branchId) ?? [] : [])]
    const declared = sorted(new Set(visibleDeclarations.filter((name) => !materialized.has(name) && name.length <= 48 && VALID_DIR_ID.test(name))))
    const pointIds = sorted(points), lineIds = sorted(lines), conicIds = sorted(conics)
    const materializedPoints = take(pointIds)
    const materializedLines = take(lineIds)
    const materializedConics = take(conicIds)
    const declaredOnly = take(declared)
    return { materializedPoints, materializedLines, materializedConics, declaredOnly,
      truncated: pointIds.length > materializedPoints.length || lineIds.length > materializedLines.length ||
        conicIds.length > materializedConics.length || declared.length > declaredOnly.length }
  }

  return {
    referenceDirectory,
    currentSnapshot: () => speculative.snapshot(),
    stateSlices: () => [...recordedSlices],
    execute(toolName, rawInput) {
      const before = snapshotRefs()
      const branchId = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? asString((rawInput as Record<string, unknown>).branchId) : null
      const targetCanvas = getTargetCanvas(branchId ?? undefined)
      const beforeCanvasStep = targetCanvas.snapshot().stepIndex
      const beforeBranchStep = branchId ? beforeCanvasStep : null
      const beforeBranchSlices = branchId ? recordedSlices.filter((slice) => slice.branchId === branchId).map((slice) => ({ ...slice, actions: [...slice.actions] })) : []
      const beforeBranchBuckets = branchId ? [...branchActionBuckets.entries()]
        .filter(([key]) => key.endsWith(`::${branchId}`))
        .map(([key, bucket]): [string, typeof bucket] => [key, { ...bucket, actions: [...bucket.actions] }]) : []
      const beforePointHistoryLen = pointHistory.length
      const beforeSliceHistoryLen = sliceHistory.length
      const beforeRecordedSlices = recordedSlices.map((slice) => ({ ...slice, actions: [...slice.actions] }))
      const beforeSharedActions = [...sharedBranchlessActions]
      const beforeSeq = monotonicActionSeq
      const result = executeRaw(toolName, rawInput)
      if (!result.ok || !result.stateChanged) {
        monotonicActionSeq = beforeSeq
      }
      if (!result.ok) {
        const afterCanvasStep = targetCanvas.snapshot().stepIndex
        if (afterCanvasStep > beforeCanvasStep) {
          targetCanvas.rollback(afterCanvasStep - beforeCanvasStep)
        }
        pointHistory.length = beforePointHistoryLen
        sliceHistory.length = beforeSliceHistoryLen
        recordedSlices.splice(0, recordedSlices.length, ...beforeRecordedSlices)
        sharedBranchlessActions.splice(0, sharedBranchlessActions.length, ...beforeSharedActions)
        restoreRefs(before)
      }
      else if (branchId && beforeBranchStep !== null && result.stateChanged && toolName !== "repair_entity" && toolName !== "repair_constraint") {
        let history = branchHistory.get(branchId)
        if (!history) { history = []; branchHistory.set(branchId, history) }
        history.push({ stepIndex: beforeBranchStep, refs: before, slices: beforeBranchSlices, buckets: beforeBranchBuckets })
      }
      return attachTelemetry(result, rawInput)
    }
  }
}

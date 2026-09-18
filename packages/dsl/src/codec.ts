import { validateDocument } from "./schema"
import type { DrawingSheetSpec, DrawingViewSpec, GeometryDocument, LayerSpec, Section3Classification, Workspace } from "./types"

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}-${uuid ?? Math.random().toString(36).slice(2, 10)}`
}

export function createEmptyDocument(workspace: Workspace): GeometryDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: "0.1",
    revision: 0,
    workspace,
    coordinateSystems: workspace === "geometry3d" ? ["cartesian-3d"] : ["cartesian-2d"],
    parameters: {},
    primitives: [],
    groups: [],
    constraints: [],
    dynamics: [],
    annotations: [],
    measurements: [],
    engineeringAnnotations: [],
    metadata: { id: createId("doc"), name: "Untitled geometry", createdAt: now, updatedAt: now }
  }
}

const defaultLayers: LayerSpec[] = [
  { id: "layer-geometry", name: "几何", kind: "geometry", visible: true, locked: false, printable: true },
  { id: "layer-dimension", name: "尺寸", kind: "dimension", visible: true, locked: false, printable: true },
  { id: "layer-construction", name: "辅助线", kind: "construction", visible: true, locked: false, printable: false },
  { id: "layer-annotation", name: "注释", kind: "annotation", visible: true, locked: false, printable: true }
]

const defaultViews: DrawingViewSpec[] = [
  { id: "view-front", kind: "front", x: 40, y: 40, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false },
  { id: "view-top", kind: "top", x: 360, y: 40, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false },
  { id: "view-left", kind: "left", x: 40, y: 280, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false },
  { id: "view-axonometric", kind: "axonometric", x: 360, y: 280, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false }
]

export function createDefaultCadLayout(document: GeometryDocument): GeometryDocument {
  const layers = document.layers ?? defaultLayers.map((layer) => ({ ...layer }))
  const drawingViews = document.drawingViews ?? (document.workspace === "cad" ? defaultViews.map((view) => ({ ...view })) : [])
  const drawingSheets = document.drawingSheets ?? [{
    id: "sheet-1",
    name: "工程图纸",
    paper: "A4",
    orientation: "landscape",
    scale: 1,
    viewIds: drawingViews.map((view) => view.id)
  } satisfies DrawingSheetSpec]

  return {
    ...document,
    layers,
    drawingViews,
    drawingSheets,
    activeLayerId: document.activeLayerId ?? layers.find((layer) => layer.kind === "geometry")?.id ?? layers[0]?.id,
    activeSheetId: document.activeSheetId ?? drawingSheets[0]?.id
  }
}

export function encodeMgeo(document: GeometryDocument): string {
  const result = validateDocument(document)
  if (!result.valid) throw new Error(`Invalid geometry document: ${result.errors.join(", ")}`)
  return JSON.stringify({ format: "mgeo", formatVersion: "0.1", document }, null, 2)
}

/** Legacy documents stored sections before the classification field existed; derive it from the stored points. */
function classifySectionPoints(points: unknown): Section3Classification {
  if (!Array.isArray(points)) return "insufficient-data"
  if (points.length === 0) return "none"
  if (points.length === 1) return "point"
  if (points.length === 2) return "segment"
  return "polygon"
}

function withSectionClassification(primitives: unknown): unknown {
  if (!Array.isArray(primitives)) return primitives
  return primitives.map((primitive) => {
    if (!primitive || typeof primitive !== "object") return primitive
    const candidate = primitive as { type?: unknown; points?: unknown; classification?: unknown }
    return candidate.type === "section" && candidate.classification === undefined
      ? { ...candidate, classification: classifySectionPoints(candidate.points) }
      : primitive
  })
}

/**
 * 旧文档的轨道圆：`circle3` 曾经存 `centerId`（引用一个点当圆心），现在是**自带** `center`。
 *
 * 必须在 `validateDocument` **之前**做——`decodeMgeo` 对不合法文档是 `throw`，顺序反了旧文件会因为
 * "字段不合法"直接打不开（那不是少一个功能，是用户的文件打不开）。codec 里已有同款先例：
 * `withSectionClassification` 也是在校验前给旧截面补字段。
 *
 * 引用的点不存在时（只有手改过的文件才会出现；旧版本的引用保护挡着 UI 删除）**丢掉这一条轨道**：
 * 它的圆心无从得知，宁可少一条，也不能让整份文件打不开。
 */
function withCircleTrackCenter(primitives: unknown): unknown {
  if (!Array.isArray(primitives)) return primitives
  const positions = new Map<string, unknown>()
  for (const primitive of primitives) {
    const point = primitive as { id?: unknown; type?: unknown; position?: unknown } | null
    if (point && typeof point === "object" && point.type === "point3" && typeof point.id === "string") positions.set(point.id, point.position)
  }
  const migrated: unknown[] = []
  for (const primitive of primitives) {
    const track = primitive as { type?: unknown; centerId?: unknown; center?: unknown } | null
    // 已经是新形状（或根本不是轨道圆）就原样放行——这条保证迁移**幂等**。
    if (!track || typeof track !== "object" || track.type !== "circle3" || track.center !== undefined) {
      migrated.push(primitive)
      continue
    }
    const center = typeof track.centerId === "string" ? positions.get(track.centerId) : undefined
    if (center === undefined) continue
    const { centerId: _legacy, ...rest } = track as Record<string, unknown>
    migrated.push({ ...rest, center })
  }
  return migrated
}

export function decodeMgeo(serialized: string): GeometryDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error("Invalid .mgeo JSON")
  }
  const rawCandidate = parsed && typeof parsed === "object" && "document" in parsed ? (parsed as { document: unknown }).document : parsed
  const candidate = rawCandidate && typeof rawCandidate === "object"
    ? {
      ...rawCandidate,
      groups: "groups" in rawCandidate ? (rawCandidate as { groups: unknown }).groups : [],
      measurements: "measurements" in rawCandidate ? (rawCandidate as { measurements: unknown }).measurements : [],
      engineeringAnnotations: "engineeringAnnotations" in rawCandidate ? (rawCandidate as { engineeringAnnotations: unknown }).engineeringAnnotations : [],
      primitives: withCircleTrackCenter(withSectionClassification((rawCandidate as { primitives?: unknown }).primitives))
    }
    : rawCandidate
  const migrated = candidate && typeof candidate === "object"
    ? createDefaultCadLayout(candidate as GeometryDocument)
    : candidate
  const result = validateDocument(migrated)
  if (!result.valid) throw new Error(`Invalid geometry document: ${result.errors.join(", ")}`)
  return migrated as GeometryDocument
}

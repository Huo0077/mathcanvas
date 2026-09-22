import { isPrismPlaneBase, liftPrismBasePolygon, validatePrismSolidConstruction } from "@draw/geometry-kernel"

import { validateDocument, type DocumentValidationOptions } from "./schema"
import type { DrawingSheetSpec, DrawingViewSpec, GeometryDocument, LayerSpec, Section3Classification, Workspace } from "./types"

/**
 * **文档校验的可注入几何判据**（Fix round 2 / I6）。
 *
 * `@draw/dsl` 不能依赖 `@draw/geometry-kernel`（内核依赖 DSL，反向会成环），所以棱柱的
 * "共面 / 自交 / 零体积"由这一层注入。注入之后**创建路径与导入路径用的是同一份判据**：
 * 创建走 `compileSolidPrism`（直接调 `validatePrismInput`），导入与保存走这里。
 */
const PRISM_SEMANTICS: DocumentValidationOptions = {
  prismConstructionValidator: ({ polygon, vector }) => {
    const validation = validatePrismSolidConstruction(polygon, vector)
    return validation.ok ? [] : validation.diagnostics.map((diagnostic) => diagnostic.message)
  }
}

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
  const result = validateDocument(document, PRISM_SEMANTICS)
  if (!result.valid) throw new Error(`Invalid geometry document: ${result.errors.join(", ")}`)
  return JSON.stringify({ format: "mgeo", formatVersion: "0.1", document }, null, 2)
}

/**
 * **规格 §3.2 的棱柱输入形式 → 世界顶点**（Fix round 2 / I6 + Deviation 5）。
 *
 * 规格给的是 `base.plane`（原点 + 法向）与**二维**多边形点；存储形式仍是世界顶点 ——
 * 不引入第二份几何真源（见 `PrismConstruction`）。抬升必须发生在**解析边界、校验之前**：
 * `decodeMgeo` 对不合法文档是 `throw`，顺序反了照规格写的文件会因为"缺 z"直接打不开。
 * 与 `withCircleTrackCenter` / `withSectionClassification` 是同一条流水线、同一个理由。
 *
 * 抬升是纯函数且**幂等**：已经是三维点的文档原样放行，抬过之后再存再读不再变。
 */
function withPrismBasePolygon(primitives: unknown): unknown {
  if (!Array.isArray(primitives)) return primitives
  return primitives.map((primitive) => {
    if (!primitive || typeof primitive !== "object") return primitive
    const candidate = primitive as { type?: unknown; construction?: { kind?: unknown; base?: unknown; vector?: unknown } }
    if (candidate.type !== "polyhedron3" || candidate.construction?.kind !== "prism") return primitive
    const base = candidate.construction.base
    if (!isPrismPlaneBase(base)) return primitive
    return {
      ...candidate,
      construction: {
        ...candidate.construction,
        // 只留下多边形：平面是**输入形式**的辅助信息，存储形式里没有它的位置。
        base: { polygon: liftPrismBasePolygon(base) }
      }
    }
  })
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
      primitives: withPrismBasePolygon(withCircleTrackCenter(withSectionClassification((rawCandidate as { primitives?: unknown }).primitives)))
    }
    : rawCandidate
  const migrated = candidate && typeof candidate === "object"
    ? createDefaultCadLayout(candidate as GeometryDocument)
    : candidate
  const result = validateDocument(migrated, PRISM_SEMANTICS)
  if (!result.valid) throw new Error(`Invalid geometry document: ${result.errors.join(", ")}`)
  return migrated as GeometryDocument
}

import { createDocumentHandle } from "@draw/scene-graph"
import type { GeometryDocument } from "@draw/dsl"

/** 投影来源：本图纸文档，或立体几何文档（工作区文档各自独立）。 */
export type ProjectionSource = "cad" | "geometry3d"

/** 可投影内容 = 至少有一个可见的空间对象；用来判断"这个来源是不是空的"。 */
export function hasProjectableGeometry(document: GeometryDocument | null | undefined): boolean {
  if (!document) return false
  const projectable = ["point3", "line3", "segment3", "ray3", "edge3", "face3", "polyhedron3", "cube", "pyramid", "cylinder", "cone"]
  return document.primitives.some((primitive) => projectable.includes(primitive.type) && primitive.visible !== false)
}

/** 空视图提示：说明"现在看的是哪份文档"，并在另一份文档有内容时指向下一步。 */
export function projectionEmptyMessage(source: ProjectionSource, cadHasGeometry: boolean, spatialHasGeometry: boolean): string {
  if (source === "geometry3d") return spatialHasGeometry ? "暂无可投影的空间对象" : "立体几何工作区还没有可投影的对象"
  if (!cadHasGeometry && spatialHasGeometry) return "本图纸没有可投影对象；立体几何里已有模型"
  return "暂无可投影的空间对象"
}

/**
 * **显示与导出共用的来源选择**（Task 0.6 Step 3）。
 *
 * 计划的要求是"display and export use the same scoped source context"。实测到的真实缺陷是：
 * `EngineeringDrawingView` 会按 `projectionSource` 选文档，而 `App` 生成导出内容时**永远**用当前
 * 工作区文档 —— 于是切到"投影立体几何"之后，四个视图显示立方体，导出的 SVG/DXF/PDF 里却是
 * 本图纸那份（往往是空的）内容。
 *
 * 所以这条选择只能有**一处**：显示与导出都调用它。
 * `geometry3d` 来源缺文档时回退到本图纸，与显示侧的历史行为一致（`?? document`）。
 */
export function resolveProjectionSource(source: ProjectionSource, layoutDocument: GeometryDocument, spatialDocument?: GeometryDocument | null): GeometryDocument {
  return source === "geometry3d" && spatialDocument ? spatialDocument : layoutDocument
}

/** 上下文里两份文档的句柄来源：跨文档引用必须能说清"读的是哪两份"。 */
export function projectionSourceHandles(layoutDocument: GeometryDocument, spatialDocument: GeometryDocument | null | undefined, projectId: string) {
  return {
    layout: createDocumentHandle(layoutDocument, projectId),
    geometry: createDocumentHandle(spatialDocument ?? layoutDocument, projectId)
  }
}

/** 来源上下文的两份文档：作用域解析必须在**两份**里找，不能假定来源就在布局文档里。 */
export interface ProjectionSourceDocuments {
  layoutDocument: GeometryDocument
  spatialDocument: GeometryDocument | null | undefined
}

/**
 * **来源解析**（Task 0.6 Step 3 后半）：把来源 id 解析成"它在不在、叫什么"。
 *
 * 这层存在的理由同样是一个真实缺陷：`sourceLabels` 与检查器的"投影来源"列表过去
 * **只查布局文档**（`document.primitives`），于是切到"投影立体几何"之后，
 * 明明看得见的空间对象会被标成**"来源已删除"**。
 *
 * `preferred` 是"当前显示的那份文档"（即 `resolveProjectionSource` 的结果）：
 * 同名的 id 在两份文档里都存在时（这正是 `SourceContext` 要解决的场景），
 * **以当前正在显示的那一份为准**，这样标签与用户眼前的内容一致。
 * 只在两份都找不到时才算 `missing` —— "看不见"与"被删了"是两件事，不能混。
 */
export function resolveProjectionSourceEntity(id: string, preferred: GeometryDocument, documents: ProjectionSourceDocuments): { label: string; missing: boolean } {
  const candidates = [preferred, documents.layoutDocument, documents.spatialDocument].filter((candidate): candidate is GeometryDocument => Boolean(candidate))
  for (const document of candidates) {
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    if (primitive) return { label: primitive.label ?? id, missing: false }
  }
  return { label: id, missing: true }
}

/** 一批来源 id 的标签表；`sourceLabels` 风格的调用点用它，避免再各写一份查找。 */
export function resolveProjectionSourceLabels(ids: Iterable<string>, preferred: GeometryDocument, documents: ProjectionSourceDocuments): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const id of ids) labels[id] = resolveProjectionSourceEntity(id, preferred, documents).label
  return labels
}
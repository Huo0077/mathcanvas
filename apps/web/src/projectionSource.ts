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

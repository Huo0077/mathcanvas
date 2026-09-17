import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate, templateEdgeLabel, templatePointLabel, type SolidBuildResult } from "@draw/geometry-kernel"

type LegacySolid = Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>

function hasTemplateFor(primitives: PrimitiveSpec[], sourceId: string): boolean {
  return primitives.some((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" && primitive.construction.sourceIds.includes(sourceId))
}

/**
 * 把**已经物化过**的模板子对象对齐到当前的可见性口径。
 *
 * 升级前的圆类实体是"每个细分顶点一个点、每条母线一条棱"物化出来的，文档里存的是那份结果：
 * 用户反馈"圆锥中间还有好多点、有太多母线"说的就是它。这里一个子对象都不重建——位置可能是用户拖过的、
 * 名字可能是用户改过的——只补两件事：
 * - 新口径里隐藏的（细分顶点 / 母线）标 `tessellation: true` 并去掉标签；
 * - 新口径里可见的只有在标签**还是旧口径自动生成**的时候才重编（`A…Z/P27…`、`棱 N`），
 *   用户自己起的名字原样保留，哪怕因此让自动编号出现空档。
 */
function realignTemplateChildren(primitives: PrimitiveSpec[], fresh: SolidBuildResult): PrimitiveSpec[] {
  const targetById = new Map(fresh.primitives.map((primitive) => [primitive.id, primitive]))
  return primitives.map((existing) => {
    const target = targetById.get(existing.id)
    if (!target) return existing
    if (existing.type === "point3" && target.type === "point3") {
      if (target.tessellation === true) return { ...existing, tessellation: true, label: undefined }
      const automatic = templatePointLabel(fresh.vertexIds.indexOf(existing.id))
      return existing.label === undefined || existing.label === automatic ? { ...existing, label: target.label } : existing
    }
    if (existing.type === "edge3" && target.type === "edge3") {
      if (target.tessellation === true) return { ...existing, tessellation: true, label: undefined }
      const automatic = templateEdgeLabel(fresh.edgeIds.indexOf(existing.id))
      return existing.label === undefined || existing.label === automatic ? { ...existing, label: target.label } : existing
    }
    return existing
  })
}

export function migrateLegacySolids(document: GeometryDocument): GeometryDocument {
  const migrated = structuredClone(document) as GeometryDocument
  const legacySolids = migrated.primitives.filter((primitive): primitive is LegacySolid => ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type))
  for (const legacy of legacySolids) {
    const result = buildSolidTemplate(legacy)
    if (result.diagnostics.length > 0) continue
    if (!hasTemplateFor(migrated.primitives, legacy.id)) {
      migrated.primitives.push(...result.primitives)
      continue
    }
    migrated.primitives = realignTemplateChildren(migrated.primitives, result)
  }
  return migrated
}

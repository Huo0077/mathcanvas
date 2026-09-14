import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

type LegacySolid = Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>

function hasTemplateFor(primitives: PrimitiveSpec[], sourceId: string): boolean {
  return primitives.some((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "template" && primitive.construction.sourceIds.includes(sourceId))
}

export function migrateLegacySolids(document: GeometryDocument): GeometryDocument {
  const migrated = structuredClone(document) as GeometryDocument
  const legacySolids = migrated.primitives.filter((primitive): primitive is LegacySolid => ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type))
  for (const legacy of legacySolids) {
    if (hasTemplateFor(migrated.primitives, legacy.id)) continue
    const result = buildSolidTemplate(legacy)
    if (result.diagnostics.length === 0) migrated.primitives.push(...result.primitives)
  }
  return migrated
}

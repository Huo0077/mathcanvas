import type { GeometryDocument } from "@draw/dsl"
import { compileAction, createIdAllocator, type DomainOperation, type SolidDerivedStatus } from "@draw/scene-graph"

/** Keep geometry and dependency creation in the shared action compiler. */
export function derivedSphereDrawing(document: GeometryDocument, entry: SolidDerivedStatus) {
  const kind = entry.code === "derived.circumsphere" ? "circumsphere" : entry.code === "derived.insphere" ? "insphere" : null
  if (kind === null) return undefined
  const existing = document.primitives.filter(p => p.type === "sphere" && p.derivedFrom?.kind === kind && p.derivedFrom.solidId === entry.solidId)
  const visible = existing.some(p => p.visible !== false)
  const text = existing.length === 0 ? "作图" : visible ? "隐藏" : "显示"
  const label = kind === "circumsphere" ? "外接球" : "内切球"
  return {
    text, label: `${text}${label}`,
    disabled: !visible && entry.status !== "exact",
    operations(): { operations: DomainOperation[]; error?: string } {
      // An obsolete visible sphere may be hidden, but never resurrect an invalid one.
      if (!visible && entry.status !== "exact") return { operations: [], error: entry.message }
      if (existing.length > 0) return { operations: [{ op: "setPrimitivesVisible", ids: existing.map(p => p.id), visible: !visible }] }
      const result = compileAction({
        actionId: kind === "circumsphere" ? "derived.create_circumsphere" : "derived.create_insphere",
        actionKey: "inspector-derived-sphere", factIds: [],
        inputs: { alias: "inspector-sphere", solidId: { documentId: document.metadata.id, entityId: entry.solidId }, label }
      }, {
        targetDocument: document, targetWorkspace: document.workspace, orderedSelection: [],
        capabilityRevision: "inspector.1", idAllocator: createIdAllocator(document.primitives.map(p => p.id))
      })
      return {
        operations: result.operations.map(op => op.op === "addPrimitives" ? {
          ...op, primitives: op.primitives.map(p => ({ ...p, style: { ...p.style, opacity: 0.25 } }))
        } : op),
        error: result.diagnostics[0]?.message
      }
    }
  }
}

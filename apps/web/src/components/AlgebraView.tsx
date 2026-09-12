import type { PrimitiveSpec } from "@draw/dsl"

interface AlgebraViewProps { primitives: PrimitiveSpec[]; selectedIds: string[]; onSelect: (id: string, additive: boolean) => void; onToggle: (id: string, visible: boolean) => void }

export function AlgebraView({ primitives, selectedIds, onSelect, onToggle }: AlgebraViewProps) {
  return <aside className="panel"><section className="panel-section"><h2 className="panel-title">Algebra View</h2>{primitives.map((primitive) => <div className={`object-row${selectedIds.includes(primitive.id) ? " selected" : ""}`} key={primitive.id} onClick={(event) => onSelect(primitive.id, event.shiftKey)}><div className="object-meta"><span className="object-dot" aria-hidden="true" /><span className="object-name">{primitive.label ?? primitive.id}</span>{primitive.locked && <span className="lock-badge" aria-label="已锁定">锁</span>}</div><button className="icon-button" aria-label={`${primitive.visible === false ? "显示" : "隐藏"} ${primitive.label ?? primitive.id}`} onClick={(event) => { event.stopPropagation(); onToggle(primitive.id, primitive.visible === false) }}>{primitive.visible === false ? "○" : "●"}</button></div>)}</section></aside>
}

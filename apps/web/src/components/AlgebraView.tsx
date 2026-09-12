import type { PrimitiveSpec } from "@draw/dsl"

interface AlgebraViewProps { primitives: PrimitiveSpec[]; selectedId: string | null; onSelect: (id: string) => void; onToggle: (id: string, visible: boolean) => void }

export function AlgebraView({ primitives, selectedId, onSelect, onToggle }: AlgebraViewProps) {
  return <aside className="panel"><section className="panel-section"><h2 className="panel-title">Algebra View</h2>{primitives.map((primitive) => <div className={`object-row${selectedId === primitive.id ? " selected" : ""}`} key={primitive.id} onClick={() => onSelect(primitive.id)}><div className="object-meta"><span className="object-dot" aria-hidden="true" /><span className="object-name">{primitive.label ?? primitive.id}</span></div><button className="icon-button" aria-label={`${primitive.visible === false ? "显示" : "隐藏"} ${primitive.label ?? primitive.id}`} onClick={(event) => { event.stopPropagation(); onToggle(primitive.id, primitive.visible === false) }}>{primitive.visible === false ? "○" : "●"}</button></div>)}</section></aside>
}

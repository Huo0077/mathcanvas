import type { PrimitiveSpec } from "@draw/dsl"

interface AlgebraViewProps { primitives: PrimitiveSpec[]; selectedIds: string[]; onSelect: (id: string, additive: boolean) => void; onToggle: (id: string, visible: boolean) => void }

function VisibilityIcon({ visible }: { visible: boolean }) {
  return <svg className="row-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{visible ? <><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2" /></> : <><path d="m4 4 16 16M10.6 6.9A10.8 10.8 0 0 1 12 7c5.8 0 9 5 9 5a16.7 16.7 0 0 1-3.2 3.4M6.4 6.4C4.2 7.7 3 10 3 12c0 0 3.2 5 9 5 1.1 0 2.1-.2 3-.5" /></>}</svg>
}

function LockIcon() {
  return <svg className="row-lock-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></svg>
}

export function AlgebraView({ primitives, selectedIds, onSelect, onToggle }: AlgebraViewProps) {
  return <aside className="panel"><section className="panel-section algebra-panel"><div className="panel-heading"><div><span className="panel-kicker">对象管理</span><h2 className="panel-title">代数区</h2></div><span className="object-count">{primitives.length}</span></div><div className="object-list">{primitives.map((primitive) => <div className={`object-row${selectedIds.includes(primitive.id) ? " selected" : ""}`} key={primitive.id} onClick={(event) => onSelect(primitive.id, event.shiftKey)}><div className="object-meta"><span className="object-dot" data-object-type={primitive.type} aria-hidden="true" /><span className="object-name">{primitive.label ?? primitive.id}</span>{primitive.locked && <span className="lock-badge" aria-label="已锁定"><LockIcon /></span>}</div><button className="icon-button" aria-label={`${primitive.visible === false ? "显示" : "隐藏"} ${primitive.label ?? primitive.id}`} title={primitive.visible === false ? "显示对象" : "隐藏对象"} onClick={(event) => { event.stopPropagation(); onToggle(primitive.id, primitive.visible === false) }}><VisibilityIcon visible={primitive.visible !== false} /></button></div>)}</div></section></aside>
}

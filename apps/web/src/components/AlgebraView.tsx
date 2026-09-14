import { useState, type ReactNode } from "react"

import type { Measurement3, Polyhedron3Primitive, PrimitiveSpec, Workspace } from "@draw/dsl"

interface AlgebraViewProps { primitives: PrimitiveSpec[]; selectedIds: string[]; onSelect: (id: string, additive: boolean) => void; onToggle: (id: string, visible: boolean) => void; measurements?: Measurement3[]; workspace?: Workspace }

const measurementLabels: Record<Measurement3["metric"], string> = { length: "长度", distance: "距离", angle: "角度", area: "面积", volume: "体积", dihedral: "二面角" }

function VisibilityIcon({ visible }: { visible: boolean }) {
  return <svg className="row-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{visible ? <><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2" /></> : <><path d="m4 4 16 16M10.6 6.9A10.8 10.8 0 0 1 12 7c5.8 0 9 5 9 5a16.7 16.7 0 0 1-3.2 3.4M6.4 6.4C4.2 7.7 3 10 3 12c0 0 3.2 5 9 5 1.1 0 2.1-.2 3-.5" /></>}</svg>
}

function LockIcon() {
  return <svg className="row-lock-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></svg>
}

interface RowProps {
  label: string
  type: string
  visible: boolean
  locked: boolean
  selected: boolean
  depth?: number
  expanded?: boolean
  onToggleExpand?: () => void
  onSelect: (additive: boolean) => void
  onToggle: () => void
}

function ObjectRow({ label, type, visible, locked, selected, depth = 0, expanded, onToggleExpand, onSelect, onToggle }: RowProps) {
  return <div className={`object-row${selected ? " selected" : ""}${depth > 0 ? " object-row-child" : ""}`} onClick={(event) => onSelect(event.shiftKey)}>
    <div className="object-meta">
      {onToggleExpand && <button className="icon-button row-expand" aria-label={`${expanded ? "收起" : "展开"} ${label} 的子对象`} title={expanded ? "收起子对象" : "展开子对象"} onClick={(event) => { event.stopPropagation(); onToggleExpand() }}>{expanded ? "▾" : "▸"}</button>}
      <span className="object-dot" data-object-type={type} aria-hidden="true" />
      <span className="object-name">{label}</span>
      {locked && <span className="lock-badge" aria-label="已锁定"><LockIcon /></span>}
    </div>
    <button className="icon-button" aria-label={`${visible ? "隐藏" : "显示"} ${label}`} title={visible ? "隐藏对象" : "显示对象"} onClick={(event) => { event.stopPropagation(); onToggle() }}><VisibilityIcon visible={visible} /></button>
  </div>
}

/** Topology groups render as an expandable 顶点/棱/面 subtree under their owning solid. Template topology keeps the
 * template label and is suffixed so it stays distinguishable from the editable parameter row. */
function solidGroupLabel(solid: Polyhedron3Primitive, byId: Map<string, PrimitiveSpec>): string {
  const construction = solid.construction
  const templateLabel = construction?.kind === "template" ? byId.get(construction.sourceIds[0])?.label : undefined
  const base = solid.label ?? templateLabel ?? solid.id
  return construction?.kind === "template" ? `${base} 拓扑` : base
}

export function AlgebraView({ primitives, selectedIds, onSelect, onToggle, measurements = [], workspace }: AlgebraViewProps) {
  const [expandedSolids, setExpandedSolids] = useState<string[]>([])
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  const solids = workspace === "geometry3d" ? primitives.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3") : []
  const childIds = new Set(solids.flatMap((solid) => [...solid.vertexIds, ...solid.edgeIds, ...solid.faceIds]))
  const topLevel = childIds.size > 0 ? primitives.filter((primitive) => !childIds.has(primitive.id)) : primitives

  const renderRow = (primitive: PrimitiveSpec, depth = 0): ReactNode => <ObjectRow
    key={primitive.id}
    label={primitive.label ?? primitive.id}
    type={primitive.type}
    visible={primitive.visible !== false}
    locked={Boolean(primitive.locked)}
    selected={selectedIds.includes(primitive.id)}
    depth={depth}
    onSelect={(additive) => onSelect(primitive.id, additive)}
    onToggle={() => onToggle(primitive.id, primitive.visible === false)}
  />
  const renderGroup = (label: string, ids: string[]): ReactNode => {
    const children = ids.map((id) => byId.get(id)).filter((primitive): primitive is PrimitiveSpec => Boolean(primitive))
    if (children.length === 0) return null
    return <div className="object-group" key={label}><div className="object-group-label">{label}</div>{children.map((child) => renderRow(child, 1))}</div>
  }

  const renderSolid = (solid: Polyhedron3Primitive): ReactNode => {
    const label = solidGroupLabel(solid, byId)
    const expanded = expandedSolids.includes(solid.id)
    return <div className="object-tree" key={solid.id}>
      <ObjectRow
        label={label}
        type={solid.type}
        visible={solid.visible !== false}
        locked={Boolean(solid.locked)}
        selected={selectedIds.includes(solid.id)}
        expanded={expanded}
        onToggleExpand={() => setExpandedSolids((current) => current.includes(solid.id) ? current.filter((id) => id !== solid.id) : [...current, solid.id])}
        onSelect={(additive) => onSelect(solid.id, additive)}
        onToggle={() => onToggle(solid.id, solid.visible === false)}
      />
      {expanded && <div className="object-subtree">{renderGroup("顶点", solid.vertexIds)}{renderGroup("棱", solid.edgeIds)}{renderGroup("面", solid.faceIds)}</div>}
    </div>
  }

  return <aside className="panel"><section className="panel-section algebra-panel"><div className="panel-heading"><div><span className="panel-kicker">对象管理</span><h2 className="panel-title">代数区</h2></div><span className="object-count">{primitives.length}</span></div><div className="object-list">
    {topLevel.map((primitive) => primitive.type === "polyhedron3" ? renderSolid(primitive) : renderRow(primitive))}
    {measurements.length > 0 && <div className="object-group"><div className="object-group-label">教学测量</div>{measurements.map((measurement) => <div className="object-row measurement-row" key={measurement.id}><div className="object-meta"><span className="object-dot" data-object-type="measurement3" aria-hidden="true" /><span className="object-name">{measurementLabels[measurement.metric]}测量</span><span className="measurement-status" data-status={measurement.status}>{measurement.status}</span></div><small className="measurement-source">{measurement.sourceIds.join("、")} · {measurement.precision === "numeric-approximation" ? "数值近似" : "输入精确"}</small><small className="measurement-explanation">{measurement.explanation}</small></div>)}</div>}
  </div></section></aside>
}

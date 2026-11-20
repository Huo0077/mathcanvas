import { useState, type ReactNode } from "react"

import type { Face3Primitive, Measurement3, ParameterSpec, Polyhedron3Primitive, PrimitiveSpec, Workspace } from "@draw/dsl"

import { isTessellationPrimitive } from "../primitiveVisibility"
import { formatPrimitiveDisplayLabel } from "../primitiveDisplayName"
import { measurementFormSuffix } from "../measurementForms"
import { MEASUREMENT_METRIC_LABELS } from "../measurementLabels"

interface AlgebraViewProps {
  primitives: PrimitiveSpec[]
  selectedIds: string[]
  onSelect: (id: string, additive: boolean) => void
  onToggle: (id: string, visible: boolean) => void
  measurements?: Measurement3[]
  /** 文档里的参数表。给出时会在列表底部渲染「参数」分组，可以改值/上下界/步长/名称，也能新建与删除。 */
  parameters?: Record<string, ParameterSpec>
  workspace?: Workspace
  filter?: string
  className?: string
  id?: string
  draftPreview?: boolean
  onSetParameter?: (id: string, patch: { value?: number; min?: number; max?: number; step?: number; label?: string }) => void
  onDeleteParameter?: (id: string) => void
  onAddParameter?: () => void
  onSelectMany?: (ids: string[]) => void
  onClearSelection?: () => void
  onDeleteSelected?: () => void
}

const measurementLabels = MEASUREMENT_METRIC_LABELS

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
  multiSelect?: boolean
  depth?: number
  expanded?: boolean
  onToggleExpand?: () => void
  onSelect: (additive: boolean) => void
  onToggle: () => void
  /** 宿主绑定的自然参数与宿主 id（Fix round 1 / I11）：让浏览器用例断言的**几何事实**。 */
  bindingParameter?: number
  bindingHostId?: string
}

function ObjectRow({ label, type, visible, locked, selected, multiSelect = false, depth = 0, expanded, onToggleExpand, onSelect, onToggle, bindingParameter, bindingHostId }: RowProps) {
  return <div
    className={`object-row${selected ? " selected" : ""}${depth > 0 ? " object-row-child" : ""}`}
    onClick={(event) => onSelect(multiSelect || event.shiftKey)}
    /**
     * **宿主绑定的参数与宿主进 DOM**（Fix round 1 / I11）。
     *
     * 在此之前浏览器用例只能断言行**文案**（"E（中点）"），于是"参数其实是 0.4"
     * 这种回归（只要标签还写着中点）照样通过。挂成 `data-*` 之后，e2e 断的是几何事实而非标签。
     */
    data-binding-parameter={bindingParameter === undefined ? undefined : String(bindingParameter)}
    data-binding-host={bindingHostId}
  >
    <div className="object-meta">
      {multiSelect && (
        <input
          type="checkbox"
          className="object-select-checkbox"
          checked={selected}
          aria-label={`勾选 ${label}`}
          onChange={() => onSelect(true)}
          onClick={(event) => event.stopPropagation()}
        />
      )}
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
  const ownerId = construction?.kind === "template"
    ? construction.sourceIds[0]
    : construction?.kind === "fromFaces" && construction.sourceId && construction.sourceId !== solid.id
      ? construction.sourceId
      : undefined
  const templateLabel = ownerId ? byId.get(ownerId)?.label : undefined
  const base = solid.label ?? templateLabel ?? solid.id
  return ownerId ? `${base} 拓扑` : base
}

export function AlgebraView({ primitives, selectedIds, onSelect, onToggle, measurements = [], parameters, workspace, filter = "", className = "panel", id, draftPreview = false, onSetParameter, onDeleteParameter, onAddParameter, onSelectMany, onClearSelection, onDeleteSelected }: AlgebraViewProps) {
  const [search, setSearch] = useState("")
  const [expandOverrides, setExpandOverrides] = useState<Record<string, boolean>>({})
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const isNodeExpanded = (nodeId: string, defaultExpanded: boolean) => expandOverrides[nodeId] ?? defaultExpanded
  const toggleNodeExpanded = (nodeId: string, defaultExpanded: boolean) => {
    setExpandOverrides((current) => ({ ...current, [nodeId]: !(current[nodeId] ?? defaultExpanded) }))
  }
  /**
   * 参数分组：动点自动生成的驱动参数带 `ownerId`，标注出它属于哪个对象，
   * 这样"这是谁在动"一眼可见；用户手工创建的参数则没有归属。
   */
  const parameterEntries = parameters ? Object.values(parameters).filter((parameter) => !filter.trim() || (parameter.label ?? parameter.id).toLowerCase().includes(filter.trim().toLowerCase())) : []
  const parameterOwnerLabel = (parameter: ParameterSpec) => {
    if (!parameter.ownerId) return null
    const owner = primitives.find((primitive) => primitive.id === parameter.ownerId)
    return owner ? `驱动 ${owner.label ?? owner.id}` : `驱动已删除的 ${parameter.ownerId}`
  }
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  const solids = workspace === "geometry3d" ? primitives.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3") : []
  const solidChildIds = new Set(solids.flatMap((solid) => [...solid.vertexIds, ...solid.edgeIds, ...solid.faceIds]))
  const standaloneFaces = workspace === "geometry3d"
    ? primitives.filter((primitive): primitive is Face3Primitive => primitive.type === "face3" && !solidChildIds.has(primitive.id))
    : []
  const faceChildIds = new Set(
    standaloneFaces.flatMap((face) => [
      ...face.pointIds.filter((pid) => pid.startsWith(`${face.id}:`)),
      ...(face.edgeIds ?? []).filter((eid) => eid.startsWith(`${face.id}:`))
    ])
  )
  const childIds = new Set([...solidChildIds, ...faceChildIds])
  const query = (filter || search).trim().toLowerCase()
  const matchesQuery = (primitive: PrimitiveSpec): boolean => {
    if (!query) return true
    const display = formatPrimitiveDisplayLabel(primitive, byId).toLowerCase()
    const raw = (primitive.label ?? primitive.id).toLowerCase()
    return display.includes(query) || raw.includes(query)
  }
  const hasMatchingChild = (ids: readonly string[]): boolean =>
    ids.some((cid) => {
      const child = byId.get(cid)
      return child !== undefined && !isTessellationPrimitive(child) && matchesQuery(child)
    })
  const baseTopLevel = childIds.size > 0 ? primitives.filter((primitive) => !childIds.has(primitive.id)) : primitives
  const topLevel = baseTopLevel.filter((primitive) => {
    if (!query) return true
    if (matchesQuery(primitive)) return true
    if (primitive.type === "polyhedron3") {
      return hasMatchingChild([...primitive.vertexIds, ...primitive.edgeIds, ...primitive.faceIds])
    }
    if (primitive.type === "face3") {
      return hasMatchingChild([
        ...primitive.pointIds.filter((pid) => pid.startsWith(`${primitive.id}:`)),
        ...(primitive.edgeIds ?? []).filter((eid) => eid.startsWith(`${primitive.id}:`))
      ])
    }
    return false
  })
  const visiblePrimitiveCount = primitives.filter((primitive) => !isTessellationPrimitive(primitive)).length

  const renderRow = (primitive: PrimitiveSpec, depth = 0): ReactNode => {
    /** 宿主绑定（`onHost` / `onPath`）的参数与宿主：这是"这个点在哪里"的可断言事实。 */
    const binding = (primitive as { binding?: { kind?: string; parameter?: number; hostId?: string; pathId?: string } }).binding
    const isBound = binding?.kind === "onHost" || binding?.kind === "onPath"
    return <ObjectRow
      key={primitive.id}
      label={formatPrimitiveDisplayLabel(primitive, byId)}
      type={primitive.type}
      visible={primitive.visible !== false}
      locked={Boolean(primitive.locked)}
      selected={selectedIds.includes(primitive.id)}
      multiSelect={multiSelectMode}
      depth={depth}
      onSelect={(additive) => onSelect(primitive.id, additive)}
      onToggle={() => onToggle(primitive.id, primitive.visible === false)}
      {...(isBound && typeof binding?.parameter === "number" ? { bindingParameter: binding.parameter } : {})}
      {...(isBound ? { bindingHostId: binding?.hostId ?? binding?.pathId } : {})}
    />
  }
  const renderGroup = (label: string, ids: string[]): ReactNode => {
    const children = ids
      .map((id) => byId.get(id))
      .filter((primitive): primitive is PrimitiveSpec => primitive !== undefined && !isTessellationPrimitive(primitive) && (!query || matchesQuery(primitive)))
    if (children.length === 0) return null
    return <div className="object-group" key={label}><div className="object-group-label">{label}</div>{children.map((child) => renderRow(child, 1))}</div>
  }

  const renderSolid = (solid: Polyhedron3Primitive): ReactNode => {
    const label = solidGroupLabel(solid, byId)
    const defaultExpanded = solid.construction?.kind !== "template"
    const expanded = Boolean(query) || isNodeExpanded(solid.id, defaultExpanded)
    return <div className="object-tree" key={solid.id}>
      <ObjectRow
        label={label}
        type={solid.type}
        visible={solid.visible !== false}
        locked={Boolean(solid.locked)}
        selected={selectedIds.includes(solid.id)}
        multiSelect={multiSelectMode}
        expanded={expanded}
        onToggleExpand={() => toggleNodeExpanded(solid.id, defaultExpanded)}
        onSelect={(additive) => onSelect(solid.id, additive)}
        onToggle={() => onToggle(solid.id, solid.visible === false)}
      />
      {expanded && <div className="object-subtree">{renderGroup("顶点", solid.vertexIds)}{renderGroup("棱", solid.edgeIds)}{renderGroup("面", solid.faceIds)}</div>}
    </div>
  }

  const renderFaceTree = (face: Face3Primitive): ReactNode => {
    const ownedVertices = face.pointIds.filter((pid) => pid.startsWith(`${face.id}:`))
    const ownedEdges = (face.edgeIds ?? []).filter((eid) => eid.startsWith(`${face.id}:`))
    if (ownedVertices.length === 0 && ownedEdges.length === 0) return renderRow(face)
    const label = formatPrimitiveDisplayLabel(face, byId)
    const expanded = Boolean(query) || isNodeExpanded(face.id, false)
    return <div className="object-tree" key={face.id}>
      <ObjectRow
        label={label}
        type={face.type}
        visible={face.visible !== false}
        locked={Boolean(face.locked)}
        selected={selectedIds.includes(face.id)}
        multiSelect={multiSelectMode}
        expanded={expanded}
        onToggleExpand={() => toggleNodeExpanded(face.id, false)}
        onSelect={(additive) => onSelect(face.id, additive)}
        onToggle={() => onToggle(face.id, face.visible === false)}
      />
      {expanded && <div className="object-subtree">{renderGroup("顶点", ownedVertices)}{renderGroup("棱", ownedEdges)}</div>}
    </div>
  }

  const standaloneFaceIds = new Set(standaloneFaces.map((face) => face.id))
  const visibleSolids = workspace === "geometry3d"
    ? topLevel.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3")
    : []
  const visibleStandaloneFaces = workspace === "geometry3d"
    ? topLevel.filter((primitive): primitive is Face3Primitive => primitive.type === "face3" && standaloneFaceIds.has(primitive.id))
    : []
  const otherTopLevel = workspace === "geometry3d"
    ? topLevel.filter((primitive) => primitive.type !== "polyhedron3" && !standaloneFaceIds.has(primitive.id))
    : topLevel

  const allTopSelected = topLevel.length > 0 && topLevel.every((primitive) => selectedIds.includes(primitive.id))

  return <aside id={id} className={className} data-mobile-dock="objects"><section className="panel-section algebra-panel"><div className="panel-heading"><div><h2 className="panel-title">对象</h2></div><div className="algebra-heading-actions">{draftPreview && <span className="object-draft-badge" title="AI 草稿预览（确认写入后落盘）">预览</span>}<button type="button" className={`algebra-multiselect-toggle${multiSelectMode ? " is-active" : ""}`} aria-pressed={multiSelectMode} title="开启后可直接用鼠标勾选多个图元" onClick={() => setMultiSelectMode((current) => !current)}>多选</button><span className="object-count" title={`共 ${visiblePrimitiveCount} 个可见图元（含基本点、线/棱、面）`}>{visiblePrimitiveCount}</span></div></div><input className="clean-object-search" aria-label="查找对象" placeholder="查找对象…" value={search} onChange={(event) => setSearch(event.target.value)} />{multiSelectMode && <div className="algebra-multiselect-bar" role="toolbar" aria-label="图元多选操作"><span className="algebra-multiselect-count">已选 {selectedIds.length} 项</span><div className="algebra-multiselect-actions"><button type="button" className="algebra-mini-btn" disabled={topLevel.length === 0} onClick={() => {
    const topIds = topLevel.map((primitive) => primitive.id)
    if (topIds.length === 0) return
    if (allTopSelected) {
      if (onClearSelection) onClearSelection()
      else topIds.forEach((id) => onSelect(id, true))
      return
    }
    if (onSelectMany) onSelectMany([...new Set([...selectedIds, ...topIds])])
    else topIds.filter((id) => !selectedIds.includes(id)).forEach((id) => onSelect(id, true))
  }}>{allTopSelected ? "取消全选" : "全选"}</button><button type="button" className="algebra-mini-btn" disabled={selectedIds.length === 0} onClick={() => {
    if (onClearSelection) onClearSelection()
    else selectedIds.forEach((id) => onSelect(id, true))
  }}>清空</button>{onDeleteSelected && <button type="button" className="algebra-mini-btn is-danger" disabled={selectedIds.length === 0} onClick={onDeleteSelected}>删除所选</button>}</div></div>}<div className="object-list">
    {workspace === "geometry3d" ? <>
      {visibleSolids.map((solid) => renderSolid(solid))}
      {visibleStandaloneFaces.length > 0 && (
        <div className="object-group object-group-standalone-faces" data-face-group="true">
          <div className="object-group-label">{`面（构造 / 辅助 · ${visibleStandaloneFaces.length}）`}</div>
          {visibleStandaloneFaces.map((face) => renderFaceTree(face))}
        </div>
      )}
      {otherTopLevel.map((primitive) => renderRow(primitive))}
    </> : topLevel.map((primitive) => primitive.type === "polyhedron3" ? renderSolid(primitive) : primitive.type === "face3" ? renderFaceTree(primitive) : renderRow(primitive))}
    {measurements.length > 0 && <div className="object-group"><div className="object-group-label">教学测量</div>{measurements.map((measurement) => {
      const valText = measurement.value !== undefined && Number.isFinite(measurement.value)
        ? `${measurement.value.toFixed(3)}${measurement.unit ?? ""}${measurementFormSuffix(measurement)}`
        : "—"
      const angleDegText = (measurement.metric === "dihedral" || measurement.metric === "angle") && measurement.value !== undefined && Number.isFinite(measurement.value)
        ? `${((measurement.value * 180) / Math.PI).toFixed(1)}°`
        : ""
      const isSelectedSources = measurement.sourceIds.length > 0 && measurement.sourceIds.every((id) => selectedIds.includes(id))
      return <button
        type="button"
        className={`object-row measurement-row${isSelectedSources ? " selected" : ""}`}
        key={measurement.id}
        title="点击在画布与右侧属性栏定位该测量"
        onClick={() => {
          if (measurement.sourceIds.length === 0) return
          if (onSelectMany) onSelectMany(measurement.sourceIds)
          else onSelect(measurement.sourceIds[0]!, false)
        }}
      >
        <div className="object-meta"><span className="object-dot" data-object-type="measurement3" aria-hidden="true" /><span className="object-name">{measurement.metric === "dihedral" ? (measurement.dihedralKind === "exterior" ? "二面角外角" : "二面角内角") : `${measurementLabels[measurement.metric]}测量`}</span><span className="measurement-status" data-status={measurement.status}>{measurement.status}</span></div>
        <small className="measurement-value-line">{valText}{angleDegText ? ` (${angleDegText})` : ""}</small>
        <small className="measurement-source">{measurement.sourceIds.join("、")} · {measurement.precision === "numeric-approximation" ? "数值近似" : "输入精确"}</small>
        {measurement.explanation && <small className="measurement-explanation">{measurement.explanation}</small>}
      </button>
    })}</div>}
    {parameters && <div className="object-group" data-parameter-group="true"><div className="object-group-label">参数</div>
      {parameterEntries.length === 0 && <div className="object-empty">还没有参数。拖动一个绑定到曲线上的点会自动生成它的驱动参数。</div>}
      {parameterEntries.map((parameter) => {
        const owner = parameterOwnerLabel(parameter)
        return <div className="object-row parameter-row" key={parameter.id} data-parameter-id={parameter.id}>
          <div className="object-meta">
            <span className="object-dot" data-object-type="parameter" aria-hidden="true" />
            <span className="object-name">{parameter.label ?? parameter.id}</span>
            {owner && <span className="parameter-owner">{owner}</span>}
          </div>
          <div className="parameter-fields">
            <label>值<input aria-label={`参数值 ${parameter.id}`} type="number" step="any" value={parameter.value} onChange={(event) => onSetParameter?.(parameter.id, { value: Number(event.target.value) })} /></label>
            <label>最小<input aria-label={`参数最小 ${parameter.id}`} type="number" step="any" value={parameter.min ?? ""} placeholder="—" onChange={(event) => onSetParameter?.(parameter.id, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
            <label>最大<input aria-label={`参数最大 ${parameter.id}`} type="number" step="any" value={parameter.max ?? ""} placeholder="—" onChange={(event) => onSetParameter?.(parameter.id, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
            <label>步长<input aria-label={`参数步长 ${parameter.id}`} type="number" step="any" value={parameter.step ?? ""} placeholder="—" onChange={(event) => onSetParameter?.(parameter.id, { step: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
            <label>名称<input aria-label={`参数名称 ${parameter.id}`} type="text" value={parameter.label ?? ""} placeholder={parameter.id} onChange={(event) => onSetParameter?.(parameter.id, { label: event.target.value })} /></label>
          </div>
          <div className="property-actions"><button type="button" aria-label={`删除参数 ${parameter.id}`} onClick={() => onDeleteParameter?.(parameter.id)}>删除参数</button></div>
        </div>
      })}
      {onAddParameter && <div className="property-actions"><button type="button" aria-label="新建参数" onClick={onAddParameter}>新建参数</button></div>}
    </div>}
  </div></section></aside>
}

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
  /** AI 隔离草稿预览中的图元（在确认写入前展示于独立的 `.object-draft-row` 分组，不影响主文档 `.object-row` 隔离契约）。 */
  draftPrimitives?: PrimitiveSpec[]
  draftMeasurements?: Measurement3[]
  draftWorkspace?: Workspace
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
  isDraft?: boolean
  onToggleExpand?: () => void
  onSelect: (additive: boolean) => void
  onToggle?: () => void
  /** 宿主绑定的自然参数与宿主 id（Fix round 1 / I11）：让浏览器用例断言的**几何事实**。 */
  bindingParameter?: number
  bindingHostId?: string
}

function ObjectRow({ label, type, visible, locked, selected, multiSelect = false, depth = 0, expanded, isDraft = false, onToggleExpand, onSelect, onToggle, bindingParameter, bindingHostId }: RowProps) {
  const rowBaseClass = isDraft ? "object-draft-row" : "object-row"
  return <div
    className={`${rowBaseClass}${selected ? " selected" : ""}${depth > 0 ? " object-row-child" : ""}`}
    onClick={(event) => onSelect(multiSelect || event.shiftKey)}
    /**
     * **宿主绑定的参数与宿主进 DOM**（Fix round 1 / I11）。
     *
     * 在此之前浏览器用例只能断言行**文案**（"E（中点）"），于是"参数其实是 0.4"
     * 这种回归（只要标签还写着中点）照样通过。挂成 `data-*` 之后，e2e 断的是几何事实而非标签。
     */
    data-binding-parameter={bindingParameter === undefined ? undefined : String(bindingParameter)}
    data-binding-host={bindingHostId}
    data-draft-primitive={isDraft ? "true" : undefined}
  >
    <div className="object-meta">
      {multiSelect && !isDraft && (
        <input
          type="checkbox"
          className="object-select-checkbox"
          checked={selected}
          aria-label={`勾选 ${label}`}
          onChange={() => onSelect(true)}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      {onToggleExpand && <button type="button" className="icon-button row-expand" aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"} ${label} 的子对象`} title={expanded ? "收起子对象" : "展开子对象"} onClick={(event) => { event.stopPropagation(); onToggleExpand() }}>{expanded ? "▾" : "▸"}</button>}
      <span className="object-dot" data-object-type={type} aria-hidden="true" />
      <span className="object-name">{label}</span>
      {locked && <span className="lock-badge" aria-label="已锁定"><LockIcon /></span>}
    </div>
    {onToggle && <button type="button" className="icon-button" aria-label={`${visible ? "隐藏" : "显示"} ${label}`} title={visible ? "隐藏对象" : "显示对象"} onClick={(event) => { event.stopPropagation(); onToggle() }}><VisibilityIcon visible={visible} /></button>}
  </div>
}

/**
 * 决定多面体在对象树中的默认展开态：
 * - 草稿预览中的实体全部默认展开，让用户第一时间核对关键点、棱、面；
 * - 模板实体（立方体/圆柱/圆锥拓扑）与缺少 construction 元数据的旧文档保持折叠；
 * - 手工向导生成的独立模板多面体（如单独的「三棱锥 1」）或无命名顶点的独立斜棱柱（`P1..P8`）保持折叠；
 * - 其余由 Agent 或题目构造的多面体（带命名顶点如 `P-ABCD`/`ABC-A₁B₁C₁`，或场景含辅助点/线/面）默认展开，
 *   避免关键点、棱、面被藏在折叠行内造成“图元丢失”的错觉。
 */
const MANUAL_WIZARD_SOLID_LABEL = /^(?:正?三棱锥|正?四棱锥|正?五棱锥|正?六棱锥|正四面体|正?三棱柱|正?四棱柱)\s+\d+$/

function shouldDefaultExpandSolid(
  solid: Polyhedron3Primitive,
  byId: Map<string, PrimitiveSpec>,
  allPrimitives: readonly PrimitiveSpec[],
  isDraft: boolean
): boolean {
  if (isDraft) return true
  if (!solid.construction || solid.construction.kind === "template") return false
  const ownedIds = new Set<string>([solid.id, ...solid.vertexIds, ...solid.edgeIds, ...solid.faceIds])
  const hasExternalPrimitives = allPrimitives.some((primitive) => !ownedIds.has(primitive.id) && !isTessellationPrimitive(primitive))
  if (!hasExternalPrimitives) {
    if (
      solid.construction.kind === "prism" &&
      !solid.label &&
      solid.vertexIds.length > 0 &&
      solid.vertexIds.every((id) => /^P\d+$/.test(byId.get(id)?.label ?? ""))
    ) {
      return false
    }
    if (solid.label && MANUAL_WIZARD_SOLID_LABEL.test(solid.label)) {
      return false
    }
  }
  return true
}

function shouldDefaultExpandFace(
  ownedVertices: readonly string[],
  byId: Map<string, PrimitiveSpec>,
  isDraft: boolean
): boolean {
  if (isDraft) return true
  return ownedVertices.some((pid) => Boolean(byId.get(pid)?.label?.trim()))
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

export function AlgebraView({ primitives, selectedIds, onSelect, onToggle, measurements = [], parameters, workspace, filter = "", className = "panel", id, draftPreview = false, draftPrimitives, draftMeasurements = [], draftWorkspace, onSetParameter, onDeleteParameter, onAddParameter, onSelectMany, onClearSelection, onDeleteSelected }: AlgebraViewProps) {
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
  const query = (filter || search).trim().toLowerCase()

  const buildTreeView = (items: PrimitiveSpec[], itemWorkspace: Workspace | undefined, isDraft: boolean) => {
    const byId = new Map(items.map((primitive) => [primitive.id, primitive]))
    const solids = itemWorkspace === "geometry3d"
      ? items.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3")
      : []
    const solidChildIds = new Set(solids.flatMap((solid) => [...solid.vertexIds, ...solid.edgeIds, ...solid.faceIds]))
    const standaloneFaces = itemWorkspace === "geometry3d"
      ? items.filter((primitive): primitive is Face3Primitive => primitive.type === "face3" && !solidChildIds.has(primitive.id))
      : []
    const faceChildIds = new Set(
      standaloneFaces.flatMap((face) => [
        ...face.pointIds.filter((pid) => pid.startsWith(`${face.id}:`)),
        ...(face.edgeIds ?? []).filter((eid) => eid.startsWith(`${face.id}:`))
      ])
    )
    const childIds = new Set([...solidChildIds, ...faceChildIds])
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
    const baseTopLevel = childIds.size > 0 ? items.filter((primitive) => !childIds.has(primitive.id)) : items
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
    const visibleCount = items.filter((primitive) => !isTessellationPrimitive(primitive)).length
    const keyPrefix = isDraft ? "draft:" : ""

    const renderRow = (primitive: PrimitiveSpec, depth = 0): ReactNode => {
      /** 宿主绑定（`onHost` / `onPath`）的参数与宿主：这是"这个点在哪里"的可断言事实。 */
      const binding = (primitive as { binding?: { kind?: string; parameter?: number; hostId?: string; pathId?: string } }).binding
      const isBound = binding?.kind === "onHost" || binding?.kind === "onPath"
      return <ObjectRow
        key={`${keyPrefix}${primitive.id}`}
        label={formatPrimitiveDisplayLabel(primitive, byId)}
        type={primitive.type}
        visible={primitive.visible !== false}
        locked={Boolean(primitive.locked)}
        selected={selectedIds.includes(primitive.id)}
        multiSelect={multiSelectMode}
        depth={depth}
        isDraft={isDraft}
        onSelect={(additive) => onSelect(primitive.id, additive)}
        onToggle={isDraft ? undefined : () => onToggle(primitive.id, primitive.visible === false)}
        {...(isBound && typeof binding?.parameter === "number" ? { bindingParameter: binding.parameter } : {})}
        {...(isBound ? { bindingHostId: binding?.hostId ?? binding?.pathId } : {})}
      />
    }
    const renderGroup = (label: string, ids: string[]): ReactNode => {
      const children = ids
        .map((cid) => byId.get(cid))
        .filter((primitive): primitive is PrimitiveSpec => primitive !== undefined && !isTessellationPrimitive(primitive) && (!query || matchesQuery(primitive)))
      if (children.length === 0) return null
      return <div className="object-group" key={`${keyPrefix}${label}`}><div className="object-group-label">{label}</div>{children.map((child) => renderRow(child, 1))}</div>
    }
    const renderSolid = (solid: Polyhedron3Primitive): ReactNode => {
      const label = solidGroupLabel(solid, byId)
      const defaultExpanded = shouldDefaultExpandSolid(solid, byId, items, isDraft)
      const nodeKey = `${keyPrefix}${solid.id}`
      const expanded = Boolean(query) || isNodeExpanded(nodeKey, defaultExpanded)
      return <div className="object-tree" key={nodeKey}>
        <ObjectRow
          label={label}
          type={solid.type}
          visible={solid.visible !== false}
          locked={Boolean(solid.locked)}
          selected={selectedIds.includes(solid.id)}
          multiSelect={multiSelectMode}
          expanded={expanded}
          isDraft={isDraft}
          onToggleExpand={() => toggleNodeExpanded(nodeKey, defaultExpanded)}
          onSelect={(additive) => onSelect(solid.id, additive)}
          onToggle={isDraft ? undefined : () => onToggle(solid.id, solid.visible === false)}
        />
        {expanded && <div className="object-subtree">{renderGroup("顶点", solid.vertexIds)}{renderGroup("棱", solid.edgeIds)}{renderGroup("面", solid.faceIds)}</div>}
      </div>
    }
    const renderFaceTree = (face: Face3Primitive): ReactNode => {
      const ownedVertices = face.pointIds.filter((pid) => pid.startsWith(`${face.id}:`))
      const ownedEdges = (face.edgeIds ?? []).filter((eid) => eid.startsWith(`${face.id}:`))
      if (ownedVertices.length === 0 && ownedEdges.length === 0) return renderRow(face)
      const label = formatPrimitiveDisplayLabel(face, byId)
      const defaultExpanded = shouldDefaultExpandFace(ownedVertices, byId, isDraft)
      const nodeKey = `${keyPrefix}${face.id}`
      const expanded = Boolean(query) || isNodeExpanded(nodeKey, defaultExpanded)
      return <div className="object-tree" key={nodeKey}>
        <ObjectRow
          label={label}
          type={face.type}
          visible={face.visible !== false}
          locked={Boolean(face.locked)}
          selected={selectedIds.includes(face.id)}
          multiSelect={multiSelectMode}
          expanded={expanded}
          isDraft={isDraft}
          onToggleExpand={() => toggleNodeExpanded(nodeKey, defaultExpanded)}
          onSelect={(additive) => onSelect(face.id, additive)}
          onToggle={isDraft ? undefined : () => onToggle(face.id, face.visible === false)}
        />
        {expanded && <div className="object-subtree">{renderGroup("顶点", ownedVertices)}{renderGroup("棱", ownedEdges)}</div>}
      </div>
    }

    const standaloneFaceIds = new Set(standaloneFaces.map((face) => face.id))
    const visibleStandaloneFaces = itemWorkspace === "geometry3d"
      ? topLevel.filter((primitive): primitive is Face3Primitive => primitive.type === "face3" && standaloneFaceIds.has(primitive.id))
      : []
    const mainTopLevel = itemWorkspace === "geometry3d"
      ? topLevel.filter((primitive) => !standaloneFaceIds.has(primitive.id))
      : topLevel

    const content = itemWorkspace === "geometry3d" ? <>
      {mainTopLevel.map((primitive) => primitive.type === "polyhedron3" ? renderSolid(primitive) : renderRow(primitive))}
      {visibleStandaloneFaces.length > 0 && (
        <div className="object-group object-group-standalone-faces" data-face-group="true">
          <div className="object-group-label">{`面（构造 / 辅助 · ${visibleStandaloneFaces.length}）`}</div>
          {visibleStandaloneFaces.map((face) => renderFaceTree(face))}
        </div>
      )}
    </> : topLevel.map((primitive) => primitive.type === "polyhedron3" ? renderSolid(primitive) : primitive.type === "face3" ? renderFaceTree(primitive) : renderRow(primitive))

    return { topLevel, visibleCount, content }
  }

  const committedTree = buildTreeView(primitives, workspace, false)
  const visiblePrimitiveCount = committedTree.visibleCount
  const topLevel = committedTree.topLevel
  const hasDraftTree = draftPreview && Array.isArray(draftPrimitives) && draftPrimitives.length > 0
  const draftTree = hasDraftTree ? buildTreeView(draftPrimitives, draftWorkspace ?? workspace, true) : null

  const allTopSelected = topLevel.length > 0 && topLevel.every((primitive) => selectedIds.includes(primitive.id))

  const renderMeasurementRow = (measurement: Measurement3, isDraft: boolean) => {
    const valText = measurement.value !== undefined && Number.isFinite(measurement.value)
      ? `${measurement.value.toFixed(3)}${measurement.unit ?? ""}${measurementFormSuffix(measurement)}`
      : "—"
    const angleDegText = (measurement.metric === "dihedral" || measurement.metric === "angle") && measurement.value !== undefined && Number.isFinite(measurement.value)
      ? `${((measurement.value * 180) / Math.PI).toFixed(1)}°`
      : ""
    const sourceIds = measurement.sourceIds ?? []
    const isSelectedSources = sourceIds.length > 0 && sourceIds.every((sourceId) => selectedIds.includes(sourceId))
    return <button
      type="button"
      className={`${isDraft ? "object-draft-row" : "object-row"} measurement-row${isSelectedSources ? " selected" : ""}`}
      key={`${isDraft ? "draft:" : ""}${measurement.id}`}
      title="点击在画布与右侧属性栏定位该测量"
      onClick={() => {
        if (sourceIds.length === 0) return
        if (onSelectMany) onSelectMany(sourceIds)
        else onSelect(sourceIds[0]!, false)
      }}
    >
      <div className="object-meta"><span className="object-dot" data-object-type="measurement3" aria-hidden="true" /><span className="object-name">{measurement.metric === "dihedral" ? (measurement.dihedralKind === "exterior" ? "二面角外角" : "二面角内角") : `${measurementLabels[measurement.metric]}测量`}</span><span className="measurement-status" data-status={measurement.status}>{measurement.status}</span></div>
      <small className="measurement-value-line">{valText}{angleDegText ? ` (${angleDegText})` : ""}</small>
      <small className="measurement-source">{sourceIds.join("、")} · {measurement.precision === "numeric-approximation" ? "数值近似" : "输入精确"}</small>
      {measurement.explanation && <small className="measurement-explanation">{measurement.explanation}</small>}
    </button>
  }

  return <aside id={id} className={className} data-mobile-dock="objects"><section className="panel-section algebra-panel"><div className="panel-heading"><div><h2 className="panel-title">对象</h2></div><div className="algebra-heading-actions">{draftPreview && <span className="object-draft-badge" title="AI 草稿预览（确认写入后落盘）">{draftTree ? `预览 ${draftTree.visibleCount}` : "预览"}</span>}<button type="button" className={`algebra-multiselect-toggle${multiSelectMode ? " is-active" : ""}`} aria-pressed={multiSelectMode} title="开启后可直接用鼠标勾选多个图元" onClick={() => setMultiSelectMode((current) => !current)}>多选</button><span className="object-count" title={`共 ${visiblePrimitiveCount} 个可见图元（含基本点、线/棱、面）`}>{visiblePrimitiveCount}</span></div></div><input className="clean-object-search" aria-label="查找对象" placeholder="查找对象…" value={search} onChange={(event) => setSearch(event.target.value)} />{multiSelectMode && <div className="algebra-multiselect-bar" role="toolbar" aria-label="图元多选操作"><span className="algebra-multiselect-count">已选 {selectedIds.length} 项</span><div className="algebra-multiselect-actions"><button type="button" className="algebra-mini-btn" disabled={topLevel.length === 0} onClick={() => {
    const topIds = topLevel.map((primitive) => primitive.id)
    if (topIds.length === 0) return
    if (allTopSelected) {
      if (onClearSelection) onClearSelection()
      else topIds.forEach((topId) => onSelect(topId, true))
      return
    }
    if (onSelectMany) onSelectMany([...new Set([...selectedIds, ...topIds])])
    else topIds.filter((topId) => !selectedIds.includes(topId)).forEach((topId) => onSelect(topId, true))
  }}>{allTopSelected ? "取消全选" : "全选"}</button><button type="button" className="algebra-mini-btn" disabled={selectedIds.length === 0} onClick={() => {
    if (onClearSelection) onClearSelection()
    else selectedIds.forEach((selId) => onSelect(selId, true))
  }}>清空</button>{onDeleteSelected && <button type="button" className="algebra-mini-btn is-danger" disabled={selectedIds.length === 0} onClick={onDeleteSelected}>删除所选</button>}</div></div>}<div className="object-list">
    {draftTree && (
      <div className="object-group object-group-draft" data-draft-preview-group="true">
        <div className="object-group-label">{`AI 预览图元（待确认写入 · ${draftTree.visibleCount}）`}</div>
        {draftTree.content}
        {draftMeasurements.length > 0 && (
          <div className="object-group">
            <div className="object-group-label">预览测量</div>
            {draftMeasurements.map((measurement) => renderMeasurementRow(measurement, true))}
          </div>
        )}
      </div>
    )}
    {committedTree.content}
    {measurements.length > 0 && <div className="object-group"><div className="object-group-label">教学测量</div>{measurements.map((measurement) => renderMeasurementRow(measurement, false))}</div>}
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

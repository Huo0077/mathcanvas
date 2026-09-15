import type { LayerSpec } from "@draw/dsl"

const layerKindLabels: Record<LayerSpec["kind"], string> = {
  geometry: "几何",
  dimension: "尺寸",
  construction: "辅助",
  annotation: "注释",
  reference: "引用"
}

export function TreeEyeIcon({ visible }: { visible: boolean }) {
  return <svg className="row-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{visible ? <><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2" /></> : <><path d="m4 4 16 16M10.6 6.9A10.8 10.8 0 0 1 12 7c5.8 0 9 5 9 5a16.7 16.7 0 0 1-3.2 3.4M6.4 6.4C4.2 7.7 3 10 3 12c0 0 3.2 5 9 5 1.1 0 2.1-.2 3-.5" /></>}</svg>
}

export function TreeLockIcon({ locked }: { locked: boolean }) {
  return <svg className="row-lock-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="10" width="12" height="10" rx="2" />{locked ? <path d="M9 10V7a3 3 0 0 1 6 0v3" /> : <path d="M9 10V7a3 3 0 0 1 6 0" />}</svg>
}

interface LayerTreeProps {
  layers: LayerSpec[]
  activeLayerId: string | null
  expandedIds: string[]
  filter: string
  onToggleExpanded: (id: string) => void
  onActivate: (id: string) => void
  onToggleVisibility: (id: string, visible: boolean) => void
  onToggleLocked: (id: string, locked: boolean) => void
  onAdd: (parentId?: string) => void
  onDelete: (id: string) => void
}

interface LayerNode {
  layer: LayerSpec
  depth: number
  children: LayerNode[]
}

/** Depth-first tree that keeps parents before children and only links parents that really exist. */
function buildLayerTree(layers: LayerSpec[], filter: string): LayerNode[] {
  const hasRealParent = (layer: LayerSpec) => Boolean(layer.parentId) && layers.some((candidate) => candidate.id === layer.parentId)
  const childrenOf = (parentId: string | undefined) => layers.filter((layer) => (hasRealParent(layer) ? layer.parentId : undefined) === parentId)

  const query = filter.trim().toLowerCase()
  const matching = new Set<string>()
  if (query) {
    for (const layer of layers) {
      if (!layer.name.toLowerCase().includes(query)) continue
      // A matching node keeps its ancestors and its whole subtree so the hierarchy stays navigable.
      let current: LayerSpec | undefined = layer
      while (current) {
        matching.add(current.id)
        current = layers.find((candidate) => candidate.id === current?.parentId)
      }
      const stack = [layer.id]
      while (stack.length > 0) {
        const id = stack.pop()!
        matching.add(id)
        for (const child of childrenOf(id)) stack.push(child.id)
      }
    }
  }

  const build = (parentId: string | undefined, depth: number): LayerNode[] => childrenOf(parentId)
    .filter((layer) => !query || matching.has(layer.id))
    .map((layer) => ({ layer, depth, children: build(layer.id, depth + 1) }))

  return build(undefined, 0)
}

export function LayerTree({ layers, activeLayerId, expandedIds, filter, onToggleExpanded, onActivate, onToggleVisibility, onToggleLocked, onAdd, onDelete }: LayerTreeProps) {
  const nodes = buildLayerTree(layers, filter)
  const geometryLayerCount = layers.filter((layer) => layer.kind === "geometry").length

  const renderNode = (node: LayerNode) => {
    const { layer, depth, children } = node
    const expanded = expandedIds.includes(layer.id)
    const visible = layer.visible !== false
    const locked = Boolean(layer.locked)
    const deleteBlocked = layer.kind === "geometry" && geometryLayerCount <= 1
    return <li key={layer.id} className={`tree-item${layer.id === activeLayerId ? " is-active" : ""}`} data-layer-id={layer.id} data-depth={depth} data-active={layer.id === activeLayerId}>
      <div className="tree-row" style={{ paddingLeft: `${depth * 14}px` }}>
        {children.length > 0
          ? <button className="icon-button row-expand" type="button" aria-label={`${expanded ? "收起" : "展开"} ${layer.name} 的子图层`} aria-expanded={expanded} onClick={() => onToggleExpanded(layer.id)}>{expanded ? "▾" : "▸"}</button>
          : <span className="tree-spacer" aria-hidden="true" />}
        <button type="button" className="tree-name" aria-pressed={layer.id === activeLayerId} title={`激活 ${layer.name}`} onClick={() => onActivate(layer.id)}>{layer.name}</button>
        <span className="tree-badge" data-layer-kind={layer.kind}>{layerKindLabels[layer.kind]}</span>
        <button className="icon-button" type="button" aria-label={`${visible ? "隐藏" : "显示"} ${layer.name}`} aria-pressed={!visible} title={visible ? "隐藏图层" : "显示图层"} onClick={() => onToggleVisibility(layer.id, !visible)}><TreeEyeIcon visible={visible} /></button>
        <button className="icon-button" type="button" aria-label={`${locked ? "解锁" : "锁定"} ${layer.name}`} aria-pressed={locked} title={locked ? "解锁图层" : "锁定图层"} onClick={() => onToggleLocked(layer.id, !locked)}><TreeLockIcon locked={locked} /></button>
        <button className="icon-button" type="button" aria-label={`在 ${layer.name} 下新建子图层`} title="新建子图层" onClick={() => onAdd(layer.id)}>＋</button>
        <button className="icon-button" type="button" aria-label={`删除 ${layer.name}`} title={deleteBlocked ? "至少保留一个几何图层" : "删除图层"} disabled={deleteBlocked} onClick={() => onDelete(layer.id)}>✕</button>
      </div>
      {children.length > 0 && expanded && <ul className="tree-sublist">{children.map(renderNode)}</ul>}
    </li>
  }

  return <div className="layer-tree">
    <div className="tree-actions"><button type="button" onClick={() => onAdd()}>新建图层</button></div>
    <ul className="tree-list">{nodes.map(renderNode)}</ul>
  </div>
}

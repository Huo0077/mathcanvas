import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react"
import { useId } from "react"

export type TreeTab = "model" | "layers" | "drawings"

interface DocumentTreePanelProps {
  activeTab: TreeTab
  onTabChange: (tab: TreeTab) => void
  filter: string
  onFilterChange: (value: string) => void
  /** Slots owned by App; the panel switches between them without mutating the document itself. */
  model: ReactNode
  layers: ReactNode
  drawings: ReactNode
}

const tabs: { id: TreeTab; label: string }[] = [
  { id: "model", label: "模型树" },
  { id: "layers", label: "图层树" },
  { id: "drawings", label: "图纸树" }
]

export function DocumentTreePanel({ activeTab, onTabChange, filter, onFilterChange, model, layers, drawings }: DocumentTreePanelProps) {
  const panelId = useId()
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const content = active.id === "layers" ? layers : active.id === "drawings" ? drawings : model
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === active.id)
    const offset = event.key === "ArrowRight" ? 1 : -1
    onTabChange(tabs[(index + offset + tabs.length) % tabs.length].id)
  }

  return <div className="document-tree-panel">
    <div className="tree-tabs" role="tablist" aria-label="文档树" onKeyDown={handleKeyDown}>
      {tabs.map((tab) => <button
        key={tab.id}
        type="button"
        role="tab"
        id={`${panelId}-tab-${tab.id}`}
        aria-selected={tab.id === active.id}
        aria-controls={`${panelId}-panel`}
        tabIndex={tab.id === active.id ? 0 : -1}
        onClick={() => onTabChange(tab.id)}
      >{tab.label}</button>)}
    </div>
    <label className="tree-filter"><span className="tree-filter-label">过滤</span><input aria-label="过滤树节点" placeholder="按名称过滤" value={filter} onChange={(event) => onFilterChange(event.target.value)} /></label>
    <div className="tree-panel-body" role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-tab-${active.id}`}>{content}</div>
  </div>
}

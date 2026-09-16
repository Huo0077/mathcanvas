import type { KeyboardEvent as ReactKeyboardEvent } from "react"

/** The CAD inspector shows data, appearance and engineering annotations; constraint and agent UI are not part of it. */
export type InspectorTab = "data" | "appearance" | "engineering"

interface InspectorTabsProps {
  activeTab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
}

const tabs: { id: InspectorTab; label: string }[] = [
  { id: "data", label: "数据" },
  { id: "appearance", label: "外观" },
  { id: "engineering", label: "工程标注" }
]

export function InspectorTabs({ activeTab, onTabChange }: InspectorTabsProps) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === activeTab)
    const offset = event.key === "ArrowRight" ? 1 : -1
    onTabChange(tabs[(index + offset + tabs.length) % tabs.length].id)
  }

  return <div className="inspector-tabs" role="tablist" aria-label="属性面板标签" onKeyDown={handleKeyDown}>
    {tabs.map((tab) => <button
      key={tab.id}
      type="button"
      role="tab"
      id={`inspector-tab-${tab.id}`}
      aria-selected={tab.id === activeTab}
      aria-controls="inspector-panel"
      data-active={tab.id === activeTab}
      tabIndex={tab.id === activeTab ? 0 : -1}
      onClick={() => onTabChange(tab.id)}
    >{tab.label}</button>)}
  </div>
}

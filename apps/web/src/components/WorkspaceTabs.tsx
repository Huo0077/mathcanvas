import type { Workspace } from "@draw/dsl"

import type { RibbonTabId } from "../uiState"

interface WorkspaceTabsProps {
  activeWorkspace: Workspace
  activeTab: RibbonTabId | null
  expanded: boolean
  pinned: boolean
  onWorkspaceChange: (workspace: Workspace) => void
  onTabChange: (tab: RibbonTabId | null) => void
  onExpandedChange: (expanded: boolean) => void
  onPinnedChange: (pinned: boolean) => void
}

const tabs: { id: RibbonTabId | Workspace; label: string }[] = [
  { id: "file", label: "文件" },
  { id: "conics", label: "圆锥曲线" },
  { id: "geometry3d", label: "立体几何" },
  { id: "cad", label: "工程制图" }
]

export function WorkspaceTabs({ activeWorkspace, activeTab, expanded, pinned, onWorkspaceChange, onTabChange, onExpandedChange, onPinnedChange }: WorkspaceTabsProps) {
  const handleTab = (id: RibbonTabId | Workspace) => {
    if (id === "file") {
      onTabChange(activeTab === "file" ? null : "file")
      return
    }
    if (id === "conics" || id === "geometry3d" || id === "cad" || id === "calculus") {
      onWorkspaceChange(id)
      if (!expanded) onTabChange("home")
      return
    }
    onTabChange(id)
  }

  return <nav className="workspace-tabs-bar" aria-label="工作模式">
    <div className="workspace-tabs" role="group" aria-label="工作区标签">{tabs.map((tab) => {
      const isActive = tab.id === "file" ? activeTab === "file" : activeWorkspace === tab.id
      return <button key={tab.id} type="button" aria-pressed={isActive} data-active={isActive} onClick={() => handleTab(tab.id)}>{tab.label}</button>
    })}</div>
    <div className="workspace-tabs-controls" role="group" aria-label="功能区控制" data-ribbon-control>
      <button type="button" aria-label={expanded ? "收起功能区" : "展开功能区"} aria-expanded={expanded} onClick={() => { onExpandedChange(!expanded); if (expanded) onTabChange(null) }}>{expanded ? "⌃" : "⌄"}</button>
      <button type="button" aria-label={pinned ? "取消固定功能区" : "固定功能区"} aria-pressed={pinned} onClick={() => onPinnedChange(!pinned)}>{pinned ? "●" : "○"}</button>
    </div>
  </nav>
}

import type { Workspace } from "@draw/dsl"

import type { RibbonTabId } from "../uiState"
import { HeaderIcon } from "./HeaderIcon"

/**
 * 工作区标签栏。
 *
 * 2026-09-18 按用户口径：顶栏那组命令（搜索 / 文件 / 撤销重做 / 设置）**下沉到这一栏的右端**
 * —— 用户口径「把顶部的 MathCanvas 一栏中图片的内容放到下面一栏（平面几何、立体几何）的右端」。
 * 按钮的无障碍名字一个都没改（只是换了位置），所以既有的 `getByRole("button", { name })`
 * 查询与 e2e 用例不受影响。功能区折叠 / 固定两个开关留在最右，位置与语义不变。
 */
interface WorkspaceTabsProps {
  activeWorkspace: Workspace
  activeTab: RibbonTabId | null
  expanded: boolean
  pinned: boolean
  onWorkspaceChange: (workspace: Workspace) => void
  onTabChange: (tab: RibbonTabId | null) => void
  onExpandedChange: (expanded: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  onOpen?: () => void
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

const tabs: { id: RibbonTabId | Workspace; label: string }[] = [
  { id: "file", label: "文件" },
  // The visible name changed to 平面几何; the `conics` ID and `.mgeo` format stay untouched.
  { id: "conics", label: "平面几何" },
  { id: "geometry3d", label: "立体几何" },
  { id: "cad", label: "工程制图" }
]

export function WorkspaceTabs({ activeWorkspace, activeTab, expanded, pinned, onWorkspaceChange, onTabChange, onExpandedChange, onPinnedChange, onOpen, onSave, onUndo, onRedo, canUndo, canRedo }: WorkspaceTabsProps) {
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
    <div className="workspace-tabs-actions">
      <label className="search-box"><HeaderIcon name="search" /><input aria-label="搜索" placeholder="搜索工具、命令或定理..." /></label>
      <div className="topbar-commands" role="group" aria-label="文件与历史">
        {onOpen && <button type="button" onClick={onOpen}>打开 .mgeo</button>}
        {onSave && <button type="button" onClick={onSave}>保存 .mgeo</button>}
        {onUndo && <button type="button" onClick={onUndo} disabled={canUndo === false} title={canUndo === false ? "没有可撤销的操作（Ctrl+Z）" : "撤销 (Ctrl+Z)"}>撤销</button>}
        {onRedo && <button type="button" onClick={onRedo} disabled={canRedo === false} title={canRedo === false ? "没有可重做的操作（Ctrl+Y）" : "重做 (Ctrl+Y)"}>重做</button>}
      </div>
      <button className="topbar-icon" type="button" aria-label="设置"><HeaderIcon name="settings" /></button>
      <div className="workspace-tabs-controls" role="group" aria-label="功能区控制" data-ribbon-control>
        <button type="button" aria-label={expanded ? "收起功能区" : "展开功能区"} aria-expanded={expanded} onClick={() => { onExpandedChange(!expanded); if (expanded) onTabChange(null) }}>{expanded ? "⌃" : "⌄"}</button>
        <button type="button" aria-label={pinned ? "取消固定功能区" : "固定功能区"} aria-pressed={pinned} onClick={() => onPinnedChange(!pinned)}>{pinned ? "●" : "○"}</button>
      </div>
    </div>
  </nav>
}

import type { Workspace } from "@draw/dsl"

import type { RibbonGroup, RibbonTabId } from "../uiState"
import { Ribbon } from "./Ribbon"
import { WorkspaceTabs } from "./WorkspaceTabs"

/**
 * 传统工作区的 chrome：**工作区标签栏 + 功能区**。
 *
 * 顶栏（`WorkspaceHeader`）不在这里 —— 2026-09-18 按用户口径重排之后，顶栏只剩品牌一件事，
 * 而它那组命令与搜索框已经下沉到标签栏右端。把它留在 `AppChrome` 里会让人以为
 * "顶栏属于工作区 chrome"，其实它不是。
 */
interface AppChromeProps {
  activeWorkspace: Workspace
  onWorkspaceChange: (workspace: Workspace) => void
  ribbonGroups: RibbonGroup[]
  activeRibbonTab: RibbonTabId | null
  ribbonExpanded: boolean
  ribbonPinned: boolean
  onRibbonTabChange: (tab: RibbonTabId | null) => void
  onRibbonCommand?: (commandId: string) => void
  onRibbonExpandedChange: (expanded: boolean) => void
  onRibbonPinnedChange: (pinned: boolean) => void
  onOpen?: () => void
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

export function AppChrome({ activeWorkspace, onWorkspaceChange, ribbonGroups, activeRibbonTab, ribbonExpanded, ribbonPinned, onRibbonTabChange, onRibbonCommand = () => {}, onRibbonExpandedChange, onRibbonPinnedChange, onOpen, onSave, onUndo, onRedo, canUndo, canRedo }: AppChromeProps) {
  return <>
    <WorkspaceTabs activeWorkspace={activeWorkspace} activeTab={activeRibbonTab} expanded={ribbonExpanded} pinned={ribbonPinned} onWorkspaceChange={onWorkspaceChange} onTabChange={onRibbonTabChange} onExpandedChange={onRibbonExpandedChange} onPinnedChange={onRibbonPinnedChange} onOpen={onOpen} onSave={onSave} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} />
    <Ribbon groups={ribbonGroups} activeTab={activeRibbonTab} expanded={ribbonExpanded} pinned={ribbonPinned} onTabChange={onRibbonTabChange} onCommand={onRibbonCommand} onExpandedChange={onRibbonExpandedChange} onPinnedChange={onRibbonPinnedChange} showControls={false} />
  </>
}

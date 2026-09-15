import type { Workspace } from "@draw/dsl"

import type { RibbonGroup, RibbonTabId } from "../uiState"
import { Ribbon } from "./Ribbon"
import { WorkspaceHeader } from "./WorkspaceHeader"
import { WorkspaceTabs } from "./WorkspaceTabs"

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
    <WorkspaceHeader onOpen={onOpen} onSave={onSave} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} />
    <WorkspaceTabs activeWorkspace={activeWorkspace} activeTab={activeRibbonTab} expanded={ribbonExpanded} pinned={ribbonPinned} onWorkspaceChange={onWorkspaceChange} onTabChange={onRibbonTabChange} onExpandedChange={onRibbonExpandedChange} onPinnedChange={onRibbonPinnedChange} />
    <Ribbon groups={ribbonGroups} activeTab={activeRibbonTab} expanded={ribbonExpanded} pinned={ribbonPinned} onTabChange={onRibbonTabChange} onCommand={onRibbonCommand} onExpandedChange={onRibbonExpandedChange} onPinnedChange={onRibbonPinnedChange} showControls={false} />
  </>
}

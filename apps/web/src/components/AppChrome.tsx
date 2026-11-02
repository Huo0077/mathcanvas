import { useMemo } from "react"
import type { Workspace } from "@draw/dsl"

import type { RibbonGroup, RibbonTabId } from "../uiState"
import type { SearchableCommand } from "./commandSearchModel"
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
  /** 打开项目包面板（`.mcanvas` 导出/导入 + 附件）。与上面两个同属文件级动作。 */
  onPackage?: () => void
  /** 打开设置模块（N3 实验性功能的入口）。 */
  onSettings?: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  /** 当前生效的工具 id（传给 Ribbon 高亮当前正在画的工具或选择工具）。 */
  activeCommandId?: string | null
}

export function AppChrome({ onSettings, activeWorkspace, onWorkspaceChange, ribbonGroups, activeRibbonTab, ribbonExpanded, ribbonPinned, onRibbonTabChange, onRibbonCommand = () => {}, onRibbonExpandedChange, onRibbonPinnedChange, onOpen, onSave, onPackage, onUndo, onRedo, canUndo, canRedo, activeCommandId = null }: AppChromeProps) {
  const searchableCommands = useMemo<SearchableCommand[]>(
    () => ribbonGroups.flatMap((group) => group.commands.map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      prompt: cmd.prompt,
      group: group.label,
      disabled: cmd.disabled,
      disabledReason: cmd.disabledReason
    }))),
    [ribbonGroups]
  )
  return <>
    <WorkspaceTabs onSettings={onSettings} activeWorkspace={activeWorkspace} activeTab={activeRibbonTab} expanded={ribbonExpanded} pinned={ribbonPinned} onWorkspaceChange={onWorkspaceChange} onTabChange={onRibbonTabChange} onExpandedChange={onRibbonExpandedChange} onPinnedChange={onRibbonPinnedChange} onOpen={onOpen} onSave={onSave} onPackage={onPackage} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} searchableCommands={searchableCommands} onCommand={onRibbonCommand} />
    <Ribbon groups={ribbonGroups} activeTab={activeRibbonTab} expanded={ribbonExpanded} pinned={ribbonPinned} onTabChange={onRibbonTabChange} onCommand={onRibbonCommand} onExpandedChange={onRibbonExpandedChange} onPinnedChange={onRibbonPinnedChange} showControls={false} activeCommandId={activeCommandId} />
  </>
}

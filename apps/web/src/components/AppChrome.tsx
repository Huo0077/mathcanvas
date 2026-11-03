import { useEffect, useMemo, useRef, useState } from "react"
import type { Workspace } from "@draw/dsl"

import type { RibbonGroup } from "../uiState"
import type { SearchableCommand } from "./commandSearchModel"
import { RibbonGlyph } from "./Ribbon"
import { WorkspaceHeader } from "./WorkspaceHeader"
import { CommandSearch } from "./CommandSearch"
import { HeaderIcon } from "./HeaderIcon"
import { WORKSPACE_DEFINITIONS } from "../shellModules"

/** Two-row workspace chrome with secondary commands in dismissible menus. */
interface AppChromeProps {
  activeWorkspace: Workspace
  onWorkspaceChange: (workspace: Workspace) => void
  ribbonGroups: RibbonGroup[]
  onRibbonCommand?: (commandId: string) => void
  onOpen?: () => void
  onSave?: () => void
  /** 打开项目包面板（`.mcanvas` 导出/导入 + 附件）。与上面两个同属文件级动作。 */
  onPackage?: () => void
  /** 打开设置模块（N3 实验性功能的入口）。 */
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  /** 当前生效的工具 id（传给 Ribbon 高亮当前正在画的工具或选择工具）。 */
  activeCommandId?: string | null
}

export function AppChrome({
  activeWorkspace, onWorkspaceChange, ribbonGroups, onRibbonCommand = () => {},
  onOpen, onSave, onPackage, onUndo, onRedo, canUndo, canRedo, activeCommandId = null
}: AppChromeProps) {
  const [menu, setMenu] = useState<"file" | "construct" | "tools" | null>(null)
  const chromeRef = useRef<HTMLDivElement>(null)
  const commands = ribbonGroups.flatMap((group) => group.commands)
  const searchableCommands = useMemo<SearchableCommand[]>(() => ribbonGroups.flatMap((group) =>
    group.commands.map((command) => ({ ...command, group: group.label }))
  ), [ribbonGroups])
  const primaryIds = ["select-tool", "create-point", "draw-point3", "create-line", "draw-segment3", "create-circle"]
  const primary = commands.filter((command) => primaryIds.includes(command.id))
  const menuGroups = ribbonGroups.filter((group) => menu === "file"
    ? group.id === "export"
    : menu === "construct"
      ? ["solids", "construct"].includes(group.id)
      : group.id !== "export")
  const closeMenu = () => setMenu(null)

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!chromeRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        chromeRef.current?.querySelector<HTMLButtonElement>('[data-menu-trigger][aria-expanded="true"]')?.focus()
        setMenu(null)
      }
    }
    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", dismiss)
      document.removeEventListener("keydown", escape)
    }
  }, [])

  const toggleMenu = (next: typeof menu) => setMenu((current) => current === next ? null : next)
  const execute = (commandId: string) => {
    onRibbonCommand(commandId)
    closeMenu()
  }

  return <div className="clean-chrome" ref={chromeRef}>
    <WorkspaceHeader title={{ conics: "平面几何", geometry3d: "立体几何", cad: "工程图纸", calculus: "函数探索" }[activeWorkspace]}>
      <CommandSearch commands={searchableCommands} onRun={execute} />
      <button type="button" className="clean-button" data-menu-trigger aria-expanded={menu === "file"} onClick={() => toggleMenu("file")}>文件 <span aria-hidden="true">⌄</span></button>
      <button type="button" className="clean-button primary" aria-label="保存 .mgeo" onClick={onSave}>保存</button>
    </WorkspaceHeader>
    <div className="clean-toolbar" role="toolbar" aria-label="绘图工具">
      <div className="clean-workspaces" role="group" aria-label="工作区标签">
        {WORKSPACE_DEFINITIONS.map((workspace) => <button key={workspace.id} type="button"
          aria-pressed={activeWorkspace === workspace.id}
          onClick={() => { onWorkspaceChange(workspace.id); closeMenu() }}>{workspace.label}</button>)}
      </div>
      <div className="clean-primary-tools">
        {primary.map((command) => <button key={command.id} type="button" className="clean-icon-button"
          aria-label={command.label} title={command.prompt ?? command.label}
          aria-pressed={activeCommandId === command.id}
          disabled={command.disabled} onClick={() => execute(command.id)}>
          <RibbonGlyph name={command.icon} />
        </button>)}
        {ribbonGroups.some((group) => group.id === "solids") && <button type="button" className="clean-button"
          data-menu-trigger aria-expanded={menu === "construct"} onClick={() => toggleMenu("construct")}><HeaderIcon name="cube" />构造 <span aria-hidden="true">⌄</span></button>}
      </div>
      <div className="clean-toolbar-end">
        <button type="button" className="clean-button" data-menu-trigger aria-expanded={menu === "tools"} onClick={() => toggleMenu("tools")}>更多工具 <span aria-hidden="true">⌄</span></button>
        <button type="button" className="clean-icon-button" aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>↶</button>
        <button type="button" className="clean-icon-button" aria-label="重做" title="重做 (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>↷</button>
      </div>
    </div>
    {menu && <div className="clean-command-menu" data-menu={menu} role="region" aria-label={menu === "file" ? "文件菜单" : "工具菜单"}>
      {menu === "file" && <div className="clean-menu-group">
        <h3>文件</h3>
        <button type="button" onClick={() => { onOpen?.(); closeMenu() }}>打开 .mgeo</button>
        <button type="button" onClick={() => { onPackage?.(); closeMenu() }}>项目包…</button>
      </div>}
      {menuGroups.map((group) => <div className="clean-menu-group" key={group.id}>
        <h3>{group.label}</h3>
        {group.commands.filter((command) => !primaryIds.includes(command.id)).map((command) => <button type="button" key={command.id} disabled={command.disabled}
          title={command.disabled ? command.disabledReason : command.prompt}
          aria-pressed={activeCommandId === command.id} onClick={() => execute(command.id)}>
          <RibbonGlyph name={command.icon} />{command.label}
        </button>)}
      </div>)}
    </div>}
  </div>
}

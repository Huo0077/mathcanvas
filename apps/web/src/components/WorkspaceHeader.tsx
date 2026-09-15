import type { Workspace } from "@draw/dsl"

const workspaceTabs: { value: Workspace; label: string; icon: "grid" | "curve" | "cube" }[] = [
  { value: "geometry3d", label: "立体几何", icon: "cube" },
  { value: "cad", label: "工程制图", icon: "grid" },
  { value: "conics", label: "圆锥曲线", icon: "curve" }
]

function HeaderIcon({ name }: { name: "grid" | "curve" | "integral" | "cube" | "search" | "settings" | "user" }) {
  const paths = {
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    curve: <><path d="M4 17c3-8 6-10 9-5s5 4 7-5" /><path d="M4 20h16" /></>,
    integral: <path d="M16 4c-4 0-3 4-3 8s1 8-3 8M10 4h8M7 20h8" />,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4.5 7.8 12 12l7.5-4.2M12 12v9" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4 4" /></>,
    settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 0 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1A2 2 0 0 1 3 15.1l.1-.1A2 2 0 0 0 1.7 11.6h-.2a2 2 0 0 1 0-4h.2A2 2 0 0 0 3.1 4.2L3 4.1A2 2 0 0 1 5.8 1.3l.1.1a2 2 0 0 0 3.4-1.4v-.2a2 2 0 0 1 4 0V0a2 2 0 0 0 3.4 1.4l.1-.1A2 2 0 0 1 19.6 4l-.1.1a2 2 0 0 0 1.4 3.4h.2a2 2 0 0 1 0 4h-.2a2 2 0 0 0-1.5 3.5Z" transform="translate(0 3) scale(.72)" /></>,
    user: <><circle cx="12" cy="8" r="3.3" /><path d="M5.5 20c.7-3.5 2.8-5.2 6.5-5.2s5.8 1.7 6.5 5.2" /></>
  }
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

interface WorkspaceHeaderProps {
  activeWorkspace: Workspace
  onWorkspaceChange: (workspace: Workspace) => void
  /** File and history commands belong to the global shell, not to a geometry toolbar. */
  onUndo?: () => void
  onRedo?: () => void
  onSave?: () => void
  onOpen?: () => void
  /** False greys the button out, so "nothing to undo" is visible instead of a click that does nothing. */
  canUndo?: boolean
  canRedo?: boolean
}

export function WorkspaceHeader({ activeWorkspace, onWorkspaceChange, onUndo, onRedo, onSave, onOpen, canUndo, canRedo }: WorkspaceHeaderProps) {
  return <header className="topbar">
    <div className="topbar-leading">
      <div className="brand"><span className="brand-mark" aria-hidden="true">∑</span><span>MathCanvas</span></div>
      <div className="model-status" aria-label="模型状态：最佳"><span className="health-dot" aria-hidden="true" /><span><small>模型状态</small><strong>最佳</strong></span></div>
    </div>
    <nav className="workspace-tabs" aria-label="工作区">{workspaceTabs.map((workspace) => <button key={workspace.value} type="button" aria-pressed={activeWorkspace === workspace.value} data-active={activeWorkspace === workspace.value} onClick={() => onWorkspaceChange(workspace.value)}><HeaderIcon name={workspace.icon} /><span>{workspace.label}</span></button>)}</nav>
    <div className="topbar-actions"><div className="topbar-commands" role="group" aria-label="文件与历史">{onOpen && <button type="button" onClick={onOpen}>打开 .mgeo</button>}{onSave && <button type="button" onClick={onSave}>保存 .mgeo</button>}{onUndo && <button type="button" onClick={onUndo} disabled={canUndo === false} title={canUndo === false ? "没有可撤销的操作（Ctrl+Z）" : "撤销 (Ctrl+Z)"}>撤销</button>}{onRedo && <button type="button" onClick={onRedo} disabled={canRedo === false} title={canRedo === false ? "没有可重做的操作（Ctrl+Y）" : "重做 (Ctrl+Y)"}>重做</button>}</div><label className="search-box"><HeaderIcon name="search" /><input aria-label="搜索" placeholder="搜索" /></label><button className="topbar-icon" type="button" aria-label="设置"><HeaderIcon name="settings" /></button><button className="topbar-icon profile-button" type="button" aria-label="用户中心"><HeaderIcon name="user" /></button></div>
  </header>
}

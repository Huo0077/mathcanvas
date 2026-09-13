import type { Workspace } from "@draw/dsl"

const workspaceTabs: { value: Workspace; label: string }[] = [
  { value: "cad", label: "解析几何" },
  { value: "conics", label: "圆锥曲线" },
  { value: "calculus", label: "微积分" },
  { value: "geometry3d", label: "三维几何" }
]

interface WorkspaceHeaderProps {
  activeWorkspace: Workspace
  onWorkspaceChange: (workspace: Workspace) => void
}

export function WorkspaceHeader({ activeWorkspace, onWorkspaceChange }: WorkspaceHeaderProps) {
  return <header className="topbar"><div className="brand"><span className="brand-mark" aria-hidden="true">∑</span><span>MathCanvas</span></div><nav className="workspace-tabs" aria-label="工作区">{workspaceTabs.map((workspace) => <button key={workspace.value} type="button" aria-pressed={activeWorkspace === workspace.value} data-active={activeWorkspace === workspace.value} onClick={() => onWorkspaceChange(workspace.value)}>{workspace.label}</button>)}</nav></header>
}

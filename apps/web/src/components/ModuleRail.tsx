import type { Workspace } from "@draw/dsl"

import { APP_MODULES, WORKSPACE_DEFINITIONS, isWorkspaceId, type AppModuleId } from "../shellModules"

/**
 * 应用最左侧的**顶级模块**导航（模块 A 传统工作区 / 模块 B Agent 工作区）。
 *
 * 两条规则写在这里，而不是散在 `App.tsx` 里：
 * - 模块按钮的可见文本与无障碍名字分开（`aria-label` + `aria-describedby`）：可见的是"传统工作区 /
 *   Agent"两行短文案，读屏拿到的是完整名字"Agent 工作区"。
 * - 只有模块 A 才有工作区入口。Agent 区不需要画布，显示一排点不动的工作区按钮只会让人猜不透。
 */
interface ModuleRailProps {
  activeModule: AppModuleId
  onModuleChange: (module: AppModuleId) => void
  activeWorkspace: Workspace
  onWorkspaceChange?: (workspace: Workspace) => void
}

function RailIcon({ name }: { name: "drafting" | "agent" }) {
  const paths = name === "drafting"
    ? <><path d="M3.5 6.5h17v11h-17z" /><path d="M7 20.5h10" /><path d="m6.5 14 3.2-3.6 2.6 2.2 3-3.9 2.2 2" /></>
    : <><path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.8L12 18l-1.7-5.5L5 10.7 10.3 9 12 3.5Z" /><path d="M18.5 16.5l.7 2 2 .7-2 .8-.7 2-.8-2-2-.8 2-.7.8-2Z" /></>
  return <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
}

export function ModuleRail({ activeModule, onModuleChange, activeWorkspace, onWorkspaceChange }: ModuleRailProps) {
  return <nav className="app-rail" aria-label="全局模块">
    <span className="app-rail-mark" aria-hidden="true">∑</span>
    <ul className="app-rail-modules">
      {APP_MODULES.map((module, index) => {
        const current = module.id === activeModule
        const hintId = `rail-hint-${module.id}`
        return <li key={module.id}>
          <button
            type="button"
            className="app-rail-button"
            data-active={current}
            aria-pressed={current}
            aria-label={module.label}
            aria-describedby={hintId}
            onClick={() => onModuleChange(module.id)}
          >
            <RailIcon name={module.icon} />
            <span className="app-rail-visual" aria-hidden="true">{index === 0 ? "传统" : "Agent"}</span>
          </button>
          <span className="app-rail-hint" id={hintId}>{module.hint}</span>
        </li>
      })}
    </ul>
    {activeModule === "traditional" && <div className="app-rail-workspaces" role="group" aria-label="工作区">
      <span className="app-rail-label" aria-hidden="true">工作区</span>
      <ul>
        {WORKSPACE_DEFINITIONS.map((workspace) => {
          const current = workspace.id === activeWorkspace
          return <li key={workspace.id}>
            {/* 无障碍名字加"跳转到"前缀：标签栏里已经有一个叫「平面几何」的按钮了。
                同名不只是读屏时分不清，**Playwright 的 `getByRole(name)` 是子串匹配**，
                所以侧栏入口叫「平面几何」会把 e2e 里 157 处 `name: "平面几何"` 全部变成
                "命中两个元素"（本地实测 38 个用例因此变红）。可见文本保持短名，
                读屏与自动化测试拿到的是无歧义的"跳转到平面几何"。 */}
            <button type="button" className="app-rail-workspace" data-active={current} aria-pressed={current} aria-label={`跳转到${workspace.label}`} onClick={() => onWorkspaceChange?.(workspace.id)}>{workspace.label}</button>
          </li>
        })}
      </ul>
    </div>}
    {activeModule === "agent" && isWorkspaceId(activeWorkspace) && <p className="app-rail-footnote" aria-hidden="true">对话式作图<br />画布仍在左侧模块</p>}
  </nav>
}

import type { Workspace } from "@draw/dsl"

import { APP_MODULES, WORKSPACE_DEFINITIONS, isWorkspaceId, type AppModuleId } from "../shellModules"

/**
 * 应用最左侧的**顶级模块**导航（模块 A 传统工作区 / 模块 B Agent 工作区 / 模块 C 模型服务）。
 *
 * 两条规则写在这里，而不是散在 `App.tsx` 里：
 * - 模块按钮的可见文本与无障碍名字分开（`aria-label` + `aria-describedby`）：可见的是两三字短文案，
 *   读屏拿到的是完整名字"Agent 工作区"。
 * - 只有模块 A 才有工作区入口。Agent 区不需要画布，显示一排点不动的工作区按钮只会让人猜不透。
 */
interface ModuleRailProps {
  activeModule: AppModuleId
  onModuleChange: (module: AppModuleId) => void
  activeWorkspace: Workspace
  onWorkspaceChange?: (workspace: Workspace) => void
}

/** 按钮上的**可见短文案**。用一张表而不是 `index === 0 ? …` 的三元链：
 *  模块从两个变三个时，三元链会**默默**把第三个也显示成"Agent"（第一版就是这样）。 */
const RAIL_VISUALS: Record<AppModuleId, string> = { traditional: "传统", agent: "Agent", settings: "服务" }

function RailIcon({ name }: { name: "drafting" | "agent" | "settings" }) {
  const paths = name === "drafting"
    ? <><path d="M3.5 6.5h17v11h-17z" /><path d="M7 20.5h10" /><path d="m6.5 14 3.2-3.6 2.6 2.2 3-3.9 2.2 2" /></>
    : name === "agent"
      ? <><path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.8L12 18l-1.7-5.5L5 10.7 10.3 9 12 3.5Z" /><path d="M18.5 16.5l.7 2 2 .7-2 .8-.7 2-.8-2-2-.8 2-.7.8-2Z" /></>
      // 模型服务：三排滑杆的"设置"图标（与其它图标同为极细线性、无填充）。
      : <><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 12h4" /><path d="M12 12h8" /><circle cx="10" cy="12" r="2" /><path d="M4 17h10" /><path d="M18 17h2" /><circle cx="16" cy="17" r="2" /></>
  return <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
}

export function ModuleRail({ activeModule, onModuleChange, activeWorkspace, onWorkspaceChange }: ModuleRailProps) {
  return <nav className="app-rail" aria-label="全局模块">
    <span className="app-rail-mark" aria-hidden="true">∑</span>
    <ul className="app-rail-modules">
      {APP_MODULES.map((module) => {
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
            <span className="app-rail-visual" aria-hidden="true">{RAIL_VISUALS[module.id]}</span>
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

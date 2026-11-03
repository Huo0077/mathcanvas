import { APP_MODULES, type AppModuleId } from "../shellModules"
import { BrandMarkIcon } from "./BrandMarkIcon"

interface ModuleRailProps {
  activeModule: AppModuleId
  onModuleChange: (module: AppModuleId) => void
}

const RAIL_VISUALS: Record<AppModuleId, string> = { traditional: "画布", agent: "Agent", settings: "设置" }

function RailIcon({ name }: { name: "drafting" | "agent" | "settings" }) {
  const paths = name === "drafting"
    ? <><path d="M3.5 6.5h17v11h-17z" /><path d="M7 20.5h10" /><path d="m6.5 14 3.2-3.6 2.6 2.2 3-3.9 2.2 2" /></>
    : name === "agent"
      ? <><path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.8L12 18l-1.7-5.5L5 10.7 10.3 9 12 3.5Z" /><path d="M18.5 16.5l.7 2 2 .7-2 .8-.7 2-.8-2-2-.8 2-.7.8-2Z" /></>
      // 模型服务：三排滑杆的"设置"图标（与其它图标同为极细线性、无填充）。
      : <><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 12h4" /><path d="M12 12h8" /><circle cx="10" cy="12" r="2" /><path d="M4 17h10" /><path d="M18 17h2" /><circle cx="16" cy="17" r="2" /></>
  return <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
}

export function ModuleRail({ activeModule, onModuleChange }: ModuleRailProps) {
  return <nav className="app-rail" aria-label="全局模块">
    <span className="app-rail-mark" aria-hidden="true"><BrandMarkIcon /></span>
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
  </nav>
}

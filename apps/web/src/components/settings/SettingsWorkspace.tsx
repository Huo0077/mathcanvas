import { loadReducedMotion, saveReducedMotion } from "../../uiPreferences"
import { useState } from "react"
import { ProviderSettings } from "./ProviderSettings"
import { ExperimentalFeatures } from "./ExperimentalFeatures"
import { ProviderEval } from "./ProviderEval"

export function SettingsWorkspace({ unavailableReason, onBack }: { unavailableReason?: string; onBack: () => void }) {
  const [reducedMotion, setReducedMotion] = useState(loadReducedMotion)
  const [tab, setTab] = useState("models")
  return <div className="settings-page">
    <div className="settings-content">
      <div className="settings-page-heading">
        <div><h1>设置</h1><p>管理模型连接与工作偏好。</p></div>
        <button type="button" className="clean-button" onClick={onBack}>返回画布</button>
      </div>
      <div className="settings-page-tabs" role="group" aria-label="设置分类">
        <button type="button" aria-pressed={tab === "models"} onClick={() => setTab("models")}>模型服务</button>
        <button type="button" aria-pressed={tab === "preferences"} onClick={() => setTab("preferences")}>偏好设置</button>
        <button type="button" aria-pressed={tab === "advanced"} onClick={() => setTab("advanced")}>高级</button>
      </div>
      <div hidden={tab !== "models"}><ProviderSettings unavailableReason={unavailableReason} /></div>
      <div hidden={tab !== "preferences"} className="settings-preferences">
        <label><span><strong>减少动态效果</strong><small>关闭界面过渡动画，让操作更平静。</small></span>
          <input type="checkbox" role="switch" checked={reducedMotion} onChange={(event) => {
            setReducedMotion(event.target.checked)
            saveReducedMotion(event.target.checked)
          }} />
        </label>
      </div>
      <div hidden={tab !== "advanced"}>
        <details className="settings-advanced"><summary>实验性功能</summary><ExperimentalFeatures /></details>
        <details className="settings-advanced"><summary>开发者评测</summary><ProviderEval /></details>
      </div>
    </div>
  </div>
}

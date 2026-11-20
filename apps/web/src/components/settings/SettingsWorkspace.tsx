import { useState } from "react"
import { loadViewPreference3d, saveViewPreference3d, type ViewPreference3d } from "../../persistence/draftStorage"
import {
  loadAgentAutoClear,
  loadAutoOpenProperties,
  loadFontScale,
  loadReducedMotion,
  saveAgentAutoClear,
  saveAutoOpenProperties,
  saveFontScale,
  saveReducedMotion,
  type UiFontScale
} from "../../uiPreferences"
import { ProviderSettings } from "./ProviderSettings"
import { ExperimentalFeatures } from "./ExperimentalFeatures"

export function SettingsWorkspace({ unavailableReason, onBack }: { unavailableReason?: string; onBack: () => void }) {
  const [reducedMotion, setReducedMotion] = useState(loadReducedMotion)
  const [fontScale, setFontScale] = useState<UiFontScale>(loadFontScale)
  const [view3d, setView3d] = useState<ViewPreference3d>(loadViewPreference3d)
  const [agentAutoClear, setAgentAutoClear] = useState(loadAgentAutoClear)
  const [autoOpenProperties, setAutoOpenProperties] = useState(loadAutoOpenProperties)
  const [tab, setTab] = useState<"models" | "preferences">("models")

  const updateView3d = (patch: Partial<ViewPreference3d>) => {
    const next = { ...view3d, ...patch }
    setView3d(next)
    saveViewPreference3d(next)
  }

  return <div className="settings-page">
    <div className="settings-content">
      <div className="settings-page-heading">
        <div><h1>设置</h1><p>管理模型连接、画布默认行为、工作偏好与实验性能力。</p></div>
        <button type="button" className="clean-button" onClick={onBack}>返回画布</button>
      </div>
      <div className="settings-page-tabs" role="group" aria-label="设置分类">
        <button type="button" aria-pressed={tab === "models"} onClick={() => setTab("models")}>模型服务</button>
        <button type="button" aria-pressed={tab === "preferences"} onClick={() => setTab("preferences")}>偏好设置</button>
      </div>
      <div hidden={tab !== "models"}><ProviderSettings unavailableReason={unavailableReason} /></div>
      <div hidden={tab !== "preferences"} className="settings-preferences-stack">
        <section className="settings-preferences" aria-label="界面与视觉偏好">
          <div className="settings-group-header">
            <h3>界面与视觉</h3>
            <p>控制工作台排版尺度、动效与属性栏联动节奏。</p>
          </div>
          <label>
            <span><strong>界面字号与阅读密度</strong><small>舒适大字会适当放大菜单、面板标签与读数字体，适合高分辨率屏与课堂投影。</small></span>
            <select
              aria-label="界面字号与阅读密度"
              value={fontScale}
              onChange={(event) => {
                const next = event.target.value === "comfortable" ? "comfortable" : "normal"
                setFontScale(next)
                saveFontScale(next)
              }}
            >
              <option value="normal">标准紧凑</option>
              <option value="comfortable">舒适大字</option>
            </select>
          </label>
          <label>
            <span><strong>减少动态效果</strong><small>关闭界面过渡与弹性动画，让切换和展开操作更平静。</small></span>
            <input type="checkbox" role="switch" aria-label="减少动态效果" checked={reducedMotion} onChange={(event) => {
              setReducedMotion(event.target.checked)
              saveReducedMotion(event.target.checked)
            }} />
          </label>
          <label>
            <span><strong>选中或测量时自动展开属性栏</strong><small>发起二面角、面积等教学测量或点选对象时，若右侧属性栏折叠则自动展开。</small></span>
            <input type="checkbox" role="switch" aria-label="选中或测量时自动展开属性栏" checked={autoOpenProperties} onChange={(event) => {
              setAutoOpenProperties(event.target.checked)
              saveAutoOpenProperties(event.target.checked)
            }} />
          </label>
        </section>

        <section className="settings-preferences" aria-label="三维画布默认选项">
          <div className="settings-group-header">
            <h3>三维视图默认行为</h3>
            <p>新建或打开立体几何场景时生效；你仍可随时在画布左上角与右侧属性栏即时覆盖。</p>
          </div>
          <label>
            <span><strong>默认开启自动取景</strong><small>增删或生成三维图形后自动调整相机视角以框住全部图元；手动旋转后不再打扰。</small></span>
            <input type="checkbox" role="switch" aria-label="默认开启自动取景" checked={view3d.autoFit} onChange={(event) => updateView3d({ autoFit: event.target.checked })} />
          </label>
          <label>
            <span><strong>默认显示三维旋转环</strong><small>选中可旋转的三维对象时直接显示 X/Y/Z 三色调节环；关闭可保持画面整洁。</small></span>
            <input type="checkbox" role="switch" aria-label="默认显示三维旋转环" checked={view3d.showRotationHandles} onChange={(event) => updateView3d({ showRotationHandles: event.target.checked })} />
          </label>
        </section>

        <section className="settings-preferences" aria-label="AI 助手行为偏好">
          <div className="settings-group-header">
            <h3>AI 助手工作偏好</h3>
            <p>控制同屏共创与智能作图过程中的上下文行为。</p>
          </div>
          <label>
            <span><strong>新题绘图自动清空旧图元</strong><small>开启后，提出完整新题目时自动清理旧图元重新作图；关闭或明确说「保留原图」时会在当前图形上叠加。</small></span>
            <input type="checkbox" role="switch" aria-label="新题绘图自动清空旧图元" checked={agentAutoClear} onChange={(event) => {
              setAgentAutoClear(event.target.checked)
              saveAgentAutoClear(event.target.checked)
            }} />
          </label>
        </section>

        <section className="settings-preferences" aria-label="实验性功能">
          <ExperimentalFeatures />
        </section>
      </div>
    </div>
  </div>
}

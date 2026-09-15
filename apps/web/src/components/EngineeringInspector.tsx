import type { ReactNode } from "react"

import { InspectorTabs, type InspectorTab } from "./InspectorTabs"
import { PropertiesBar, type InspectorSection, type PropertiesBarProps } from "./PropertiesBar"

export interface InspectorContext {
  sheetName: string
  viewName: string | null
  layerName: string
  layerVisible: boolean
  layerLocked: boolean
  commandPrompt: string
  unit: string
  /** Layer of the currently selected 2D object, when one is selected. */
  selectedLayerName?: string | null
}

export interface InspectorSource {
  id: string
  label: string
  missing: boolean
}

interface EngineeringInspectorProps {
  activeTab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  context: InspectorContext
  sources?: InspectorSource[]
  /** Constraint diagnostics live in their own panel; the shell only places it. */
  constraints: ReactNode
  properties: PropertiesBarProps
}

const tabLabels: Record<InspectorTab, string> = { data: "数据", appearance: "外观", constraints: "约束", engineering: "工程标注" }

export function EngineeringInspector({ activeTab, onTabChange, context, sources = [], constraints, properties }: EngineeringInspectorProps) {
  const sections: InspectorSection[] = [activeTab]
  const hasSelection = properties.selectedCount > 0

  return <div className="engineering-inspector" role="region" aria-label="工程上下文检查器">
    <InspectorTabs activeTab={activeTab} onTabChange={onTabChange} />
    <div className="inspector-panel" role="tabpanel" id="inspector-panel" aria-label={`${tabLabels[activeTab]}面板`}>
      {activeTab === "constraints" && constraints}
      {activeTab === "data" && !hasSelection && <div className="inspector-context" aria-label="当前上下文">
        <h3>当前上下文</h3>
        <ul>
          <li data-context="sheet"><span>当前图纸</span><strong>{context.sheetName}</strong></li>
          <li data-context="view"><span>当前视图</span><strong>{context.viewName ?? "全部视图"}</strong></li>
          <li data-context="layer"><span>当前图层</span><strong>{context.layerName}</strong><small>{context.layerVisible === false ? "已隐藏" : context.layerLocked ? "已锁定" : "可编辑"}</small></li>
          <li data-context="unit"><span>单位</span><strong>{context.unit}</strong></li>
          <li data-context="command"><span>命令</span><strong>{context.commandPrompt}</strong></li>
        </ul>
      </div>}
      {activeTab === "data" && hasSelection && context.selectedLayerName && <div className="inspector-context" aria-label="对象图层">
        <ul><li data-context="selected-layer"><span>所在图层</span><strong>{context.selectedLayerName}</strong></li></ul>
      </div>}
      {activeTab === "data" && sources.length > 0 && <div className="inspector-sources" aria-label="投影来源">
        <h3>投影来源</h3>
        <ul>{sources.map((source) => <li key={source.id} data-source-id={source.id} data-missing={source.missing ? "true" : "false"}>
          <strong>{source.label} ({source.id})</strong>
          {source.missing && <small className="inspector-source-missing">来源已删除</small>}
        </li>)}</ul>
      </div>}
      <PropertiesBar {...properties} sections={sections} />
    </div>
  </div>
}

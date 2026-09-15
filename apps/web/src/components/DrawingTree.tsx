import type { DrawingSheetSpec, DrawingViewSpec } from "@draw/dsl"

import { TreeEyeIcon } from "./LayerTree"

const viewKindLabels: Record<DrawingViewSpec["kind"], string> = {
  model: "模型视图",
  front: "主视图",
  top: "俯视图",
  left: "左视图",
  axonometric: "轴测图"
}

const paperLabels: Record<DrawingSheetSpec["paper"], string> = { A4: "A4", A3: "A3", A2: "A2", custom: "自定义" }

interface DrawingTreeProps {
  sheets: DrawingSheetSpec[]
  views: DrawingViewSpec[]
  activeSheetId: string | null
  activeViewId: string | null
  expandedIds: string[]
  filter: string
  sourceLabels?: Record<string, string>
  onToggleExpanded: (id: string) => void
  onSelectSheet: (id: string) => void
  onSelectView: (id: string) => void
  onToggleView: (id: string, visible: boolean) => void
}

function sourceSummary(sourceIds: string[] | undefined, labels: Record<string, string>): string {
  if (!sourceIds || sourceIds.length === 0) return "全部空间对象"
  return sourceIds.map((id) => labels[id] ? `${labels[id]} (${id})` : id).join("、")
}

export function DrawingTree({ sheets, views, activeSheetId, activeViewId, expandedIds, filter, sourceLabels = {}, onToggleExpanded, onSelectSheet, onSelectView, onToggleView }: DrawingTreeProps) {
  const query = filter.trim().toLowerCase()
  const sheetMatches = (sheet: DrawingSheetSpec) => sheet.name.toLowerCase().includes(query)
  const viewMatches = (view: DrawingViewSpec) => viewKindLabels[view.kind].toLowerCase().includes(query) || view.id.toLowerCase().includes(query)

  const rows = sheets.map((sheet) => {
    const sheetViews = sheet.viewIds
      .map((viewId) => views.find((candidate) => candidate.id === viewId))
      .filter((view): view is DrawingViewSpec => Boolean(view))
      .filter((view) => !query || sheetMatches(sheet) || viewMatches(view))
    return { sheet, views: sheetViews }
  }).filter((row) => !query || sheetMatches(row.sheet) || row.views.length > 0)

  return <div className="drawing-tree">
    <ul className="tree-list">
      {rows.map(({ sheet, views: sheetViews }) => {
        const expanded = expandedIds.includes(sheet.id)
        return <li key={sheet.id} className={`tree-item${sheet.id === activeSheetId ? " is-active" : ""}`} data-sheet-id={sheet.id} data-depth="0" data-active={sheet.id === activeSheetId}>
          <div className="tree-row">
            <button className="icon-button row-expand" type="button" aria-label={`${expanded ? "收起" : "展开"} ${sheet.name} 的视图`} aria-expanded={expanded} onClick={() => onToggleExpanded(sheet.id)}>{expanded ? "▾" : "▸"}</button>
            <button type="button" className="tree-name" aria-pressed={sheet.id === activeSheetId} title={`选择图纸 ${sheet.name}`} onClick={() => onSelectSheet(sheet.id)}>{sheet.name}</button>
            <span className="tree-badge">{paperLabels[sheet.paper]} {sheet.orientation === "landscape" ? "横向" : "纵向"}</span>
            <span className="tree-meta">{sheet.viewIds.length} 个视图</span>
          </div>
          {expanded && sheetViews.length > 0 && <ul className="tree-sublist">
            {sheetViews.map((view) => {
              const visible = view.visible !== false
              return <li key={view.id} className={`tree-item${view.id === activeViewId ? " is-active" : ""}`} data-view-id={view.id} data-depth="1" data-active={view.id === activeViewId}>
                <div className="tree-row" style={{ paddingLeft: "14px" }}>
                  <span className="tree-spacer" aria-hidden="true" />
                  <button type="button" className="tree-name" aria-pressed={view.id === activeViewId} title={`选择视图 ${viewKindLabels[view.kind]}`} onClick={() => onSelectView(view.id)}>{viewKindLabels[view.kind]}</button>
                  <button className="icon-button" type="button" aria-label={`${visible ? "隐藏" : "显示"} ${viewKindLabels[view.kind]}`} aria-pressed={!visible} title={visible ? "隐藏视图" : "显示视图"} onClick={() => onToggleView(view.id, !visible)}><TreeEyeIcon visible={visible} /></button>
                  <span className="tree-meta">比例 {view.scale}</span>
                  <span className="tree-meta">来源 {sourceSummary(view.sourceIds, sourceLabels)}</span>
                </div>
              </li>
            })}
          </ul>}
        </li>
      })}
    </ul>
  </div>
}

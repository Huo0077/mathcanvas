import type { KeyboardEvent as ReactKeyboardEvent } from "react"

import type { DraftConstraint } from "./DrawingViewport"
import type { GeometryEditRequest } from "../draftEditing"

/**
 * 2D 绘图命令区的状态契约。状态与落点逻辑留在 `DrawingViewport`（它需要 SVG 的实时矩形来解析指针），
 * 但渲染位置由外层决定——目前渲染在**图纸之外**的工具栏上。
 *
 * 为什么不能在图纸里：图纸外层带 CSS `zoom`（适应窗口 / 用户缩放），控件一起缩放会变大并与画布内容重叠，
 * 这正是 2026-09-16 用户反馈的"画布内容十分混乱"。
 */
export interface DraftControls {
  constraint: DraftConstraint
  cycleConstraint: () => void
  gridSnap: boolean
  toggleGridSnap: () => void
  coordinateDraft: string
  setCoordinateDraft: (value: string) => void
  dynamicDistance: string
  setDynamicDistance: (value: string) => void
  dynamicAngle: string
  setDynamicAngle: (value: string) => void
  offsetDistance: string
  setOffsetDistance: (value: string) => void
  /** 创建锚点存在时才显示长度/角度动态输入。 */
  hasAnchor: boolean
  lengthPlaceholder: string
  anglePlaceholder: string
  submitCoordinate: () => void
  submitDistance: () => void
  submitAngle: () => void
  coordinateError: string | null
  /** 有修改类命令（偏移/修剪/延伸）时才渲染那一行。 */
  canEdit: boolean
  offsetEnabled: boolean
  trimExtendEnabled: boolean
  applyEdit: (request: GeometryEditRequest) => void
  selectedCount: number
}

/** 命令区本体：坐标 / 动态输入 / 角度约束 / 栅格捕捉 / 偏移-修剪-延伸。 */
export function DraftControlsRow({ controls }: { controls: DraftControls }) {
  const enter = (submit: () => void) => (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    submit()
  }

  return <>
    <label className="drawing-toolbar-field"><span>坐标</span><input aria-label="坐标输入" value={controls.coordinateDraft} placeholder="10,20 / @10,5 / @20<45" onChange={(event) => controls.setCoordinateDraft(event.target.value)} onKeyDown={enter(controls.submitCoordinate)} /></label>
    {controls.hasAnchor && <>
      <label className="drawing-toolbar-field"><span>长度</span><input aria-label="输入长度" value={controls.dynamicDistance} placeholder={controls.lengthPlaceholder} onChange={(event) => controls.setDynamicDistance(event.target.value)} onKeyDown={enter(controls.submitDistance)} /></label>
      <label className="drawing-toolbar-field"><span>角度</span><input aria-label="输入角度" value={controls.dynamicAngle} placeholder={controls.anglePlaceholder} onChange={(event) => controls.setDynamicAngle(event.target.value)} onKeyDown={enter(controls.submitAngle)} /></label>
    </>}
    <button type="button" aria-label="切换角度约束" aria-pressed={controls.constraint !== "free"} data-draft-constraint={controls.constraint} title="自由 → 正交 → 45° 极轴；按住 Shift 可临时正交" onClick={controls.cycleConstraint}>{controls.constraint === "free" ? "自由" : controls.constraint === "ortho" ? "正交" : "45° 极轴"}</button>
    <button type="button" aria-label="切换栅格捕捉" aria-pressed={controls.gridSnap} data-draft-grid-snap={controls.gridSnap ? "on" : "off"} title="把落点对齐到最细可见网格；对象捕捉仍然优先" onClick={controls.toggleGridSnap}>栅格捕捉</button>
    {controls.canEdit && <>
      <label className="drawing-toolbar-field"><span>偏移距离</span><input aria-label="偏移距离" value={controls.offsetDistance} onChange={(event) => controls.setOffsetDistance(event.target.value)} /></label>
      <button type="button" data-draft-edit="offset" disabled={!controls.offsetEnabled} title="按偏移距离新建一个平行对象（正值在行进方向左侧，负值在右侧）；需恰好选中一个图元" onClick={() => { const distance = Number(controls.offsetDistance); controls.applyEdit({ kind: "offset", distance: Number.isFinite(distance) ? distance : 0 }) }}>偏移</button>
      <button type="button" data-draft-edit="trim" disabled={!controls.trimExtendEnabled} title="先选边界、再选被修剪的对象；保留目标 a 端所在的一半" onClick={() => controls.applyEdit({ kind: "trim" })}>修剪</button>
      <button type="button" data-draft-edit="extend" disabled={!controls.trimExtendEnabled} title="先选边界、再选被延伸的对象；把目标 b 端拉到边界" onClick={() => controls.applyEdit({ kind: "extend" })}>延伸</button>
    </>}
    <span className="drawing-toolbar-hint" data-draft-toolbar-hint="true" title={controls.canEdit ? "偏移需选中 1 个图元；修剪/延伸需选中 2 个图元（先边界、后目标）" : "Tab 切换角度约束；长度/角度在开始创建后出现"}>{controls.canEdit ? "回车落点 · Tab 换角度 · 偏移 1 个 / 修剪延伸 2 个" : "回车落点 · Tab 换角度"}</span>
    {controls.coordinateError && <span className="drawing-viewport-input-error" role="alert">{controls.coordinateError}</span>}
  </>
}

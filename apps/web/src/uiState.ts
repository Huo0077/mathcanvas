export type RibbonIcon = "select" | "point" | "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | "parabola" | "ellipse" | "hyperbola" | "function" | "text" | "image" | "delete" | "lock" | "rotate" | "svg" | "csv" | "png"

export interface RibbonCommand {
  id: string
  label: string
  icon: RibbonIcon
  prompt?: string
  disabled?: boolean
  disabledReason?: string
}

/**
 * 功能区分组 id。
 *
 * `base` 只给平面几何（一组 12 个命令，一行放得下）。
 * 立体几何（以及 CAD 投影模式）的 18 个空间命令按"这一步在做什么"拆成三组 ——
 * `draw` / `solids` / `construct`。拆的理由是宽度：那 18 个命令挤在一组时实需 1466px，
 * 比 1280px 窗口下的整个功能区（1208px）还宽，导致后面三组全被挤出屏幕。
 * 拆开之后每一组都能单独折叠，"收起我不用的那部分"才真正可用。
 */
export type RibbonGroupId = "base" | "draw" | "solids" | "construct" | "multimodal" | "edit" | "export"

export interface RibbonGroup {
  id: RibbonGroupId
  label: string
  commands: RibbonCommand[]
}

export type RibbonTabId = "file" | "home" | "insert" | "review" | "view"

export type CreationStep = "first-point" | "second-point" | "center" | "through-point" | "vertex" | "control-point" | "formula" | null

export interface RibbonUiState {
  activeTab: RibbonTabId
  expanded: boolean
  pinned: boolean
}

export type InspectorSectionState = "data" | "appearance" | "constraints" | "engineering"

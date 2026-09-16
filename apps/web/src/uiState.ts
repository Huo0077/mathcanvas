export type RibbonIcon = "select" | "point" | "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | "parabola" | "ellipse" | "hyperbola" | "function" | "text" | "image" | "delete" | "lock" | "svg" | "csv" | "png"

export interface RibbonCommand {
  id: string
  label: string
  icon: RibbonIcon
  prompt?: string
  disabled?: boolean
  disabledReason?: string
}

export type RibbonGroupId = "base" | "multimodal" | "edit" | "export"

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

export type PromptCreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null

/** Display control currently switched on in the 3D scene. They are temporary display state, never document state. */
export type SceneControlMode = "normals" | "dihedral-demo"

interface StatusPromptState {
  mode: PromptCreationMode
  selectedCount: number
  selectedLabel: string | null
  hasCenter: boolean
  hasStart: boolean
  pointCount: number
  sceneControl?: SceneControlMode | null
}

/**
 * The 3D scene's own display switches need an explanation, because "测量二面角" only draws a sample angle
 * for the axes — it does not measure the faces the user selected. Say so, and name the real workflow.
 */
export function resolveSceneControlPrompt(sceneControl: SceneControlMode): string {
  if (sceneControl === "normals") return "法向量已显示：每个可见面的外法向量由面顶点顺序算出，随朝向和剖切结果一起更新。"
  return "这里显示的是坐标轴夹角的示例值，不读取你的选择；要测量实际二面角，请按住 Alt 点实体表面单独选两个面，再在右侧属性区点「二面角内角」或「二面角外角」。"
}

/**
 * 3D 虚线预览的状态提示。预览分两级（设计规格第 8 节）：未选中对象时只在状态栏说明，
 * 选中两个对象后画布给出完整预览与标签。
 */
export function resolveIntersectionPreviewPrompt(preview: { kind: string; label: string; reason?: string } | null, hovering: boolean): string | null {
  if (!preview) return null
  if (preview.kind === "insufficient") return preview.reason ?? null
  if (preview.kind === "none") return null
  if (preview.kind === "section") return `${preview.label}：这是穿过实体的默认剖切平面，点工具栏「创建截面」可保存为图元。`
  return hovering ? `${preview.label}：点击即可创建为截线图元。` : `${preview.label}：把指针移到虚线上可创建为截线图元。`
}

export function resolveStatusPrompt({ mode, selectedCount, selectedLabel, hasCenter, hasStart, pointCount, sceneControl = null }: StatusPromptState): string {
  if (mode === "line") return hasCenter ? "第2步：点击确定直线的第二个点（按住 Shift 锁定水平/垂直）" : "第1步：点击确定直线的第一个点"
  if (mode === "segment") return hasCenter ? "第2步：点击确定线段的终点" : "第1步：点击确定线段的起点"
  if (mode === "ray") return hasCenter ? "第2步：点击确定射线的经过点" : "第1步：点击确定射线的起点"
  if (mode === "polyline") return `点击添加折线顶点（当前 ${pointCount} 个），双击结束`
  if (mode === "circle") return hasCenter ? "第2步：移动鼠标并点击确定通过点" : "第1步：点击确定圆心位置"
  if (mode === "arc") {
    if (!hasCenter) return "第1步：点击确定圆心位置"
    return hasStart ? "第3步：点击确定圆弧终点" : "第2步：点击确定圆弧起点"
  }
  if (sceneControl) return resolveSceneControlPrompt(sceneControl)
  if (selectedCount > 0) return `已选中${selectedLabel ?? "图元"} · 拖动控制点调整形态，按 Delete 键删除`
  return "点击图元查看属性，或在画布中拖拽框选多个对象"
}

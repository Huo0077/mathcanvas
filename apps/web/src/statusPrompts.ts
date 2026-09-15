export type PromptCreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null

interface StatusPromptState {
  mode: PromptCreationMode
  selectedCount: number
  selectedLabel: string | null
  hasCenter: boolean
  hasStart: boolean
  pointCount: number
}

export function resolveStatusPrompt({ mode, selectedCount, selectedLabel, hasCenter, hasStart, pointCount }: StatusPromptState): string {
  if (mode === "line") return hasCenter ? "第2步：点击确定直线的第二个点（按住 Shift 锁定水平/垂直）" : "第1步：点击确定直线的第一个点"
  if (mode === "segment") return hasCenter ? "第2步：点击确定线段的终点" : "第1步：点击确定线段的起点"
  if (mode === "ray") return hasCenter ? "第2步：点击确定射线的经过点" : "第1步：点击确定射线的起点"
  if (mode === "polyline") return `点击添加折线顶点（当前 ${pointCount} 个），双击结束`
  if (mode === "circle") return hasCenter ? "第2步：移动鼠标并点击确定通过点" : "第1步：点击确定圆心位置"
  if (mode === "arc") {
    if (!hasCenter) return "第1步：点击确定圆心位置"
    return hasStart ? "第3步：点击确定圆弧终点" : "第2步：点击确定圆弧起点"
  }
  if (selectedCount > 0) return `已选中${selectedLabel ?? "图元"} · 拖动控制点调整形态，按 Delete 键删除`
  return "点击图元查看属性，或在画布中拖拽框选多个对象"
}

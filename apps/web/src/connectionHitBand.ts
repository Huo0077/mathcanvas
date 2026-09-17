/**
 * 连线的命中带几何。
 *
 * 单独成模块（而不是留在 `GraphicsView.tsx` 里）：组件文件只导出组件，
 * 混着导出普通函数会让 `react-refresh` 报警——这是这个仓库既有的约定。
 */
export interface SegmentEndpoints {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

/** 连线命中带在两端各让出的**屏幕像素**。 */
export const CONNECTION_HIT_INSET_PX = 16

/**
 * 把一条线段的命中带从两端缩进 `inset`（世界单位）；太短时至少保留一半长度可选。
 *
 * 为什么要缩进：连线在点**之后**渲染，而它的命中带是 18px 宽（±9px），
 * 于是端点（动点 / 连着的定点）正中心的那一下指针按下会落在连线上；连线是派生对象、
 * 拖不动，拖动还会退化成框选——端点看起来"抓不住"。缩进之后端点那一小块归还给点本身。
 */
export function insetSegment(endpoints: SegmentEndpoints, inset: number): SegmentEndpoints {
  const dx = endpoints.end.x - endpoints.start.x
  const dy = endpoints.end.y - endpoints.start.y
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length < 1e-9) return endpoints
  const applied = Math.min(Math.max(inset, 0), length * 0.25)
  const ux = (dx / length) * applied
  const uy = (dy / length) * applied
  return { start: { x: endpoints.start.x + ux, y: endpoints.start.y + uy }, end: { x: endpoints.end.x - ux, y: endpoints.end.y - uy } }
}

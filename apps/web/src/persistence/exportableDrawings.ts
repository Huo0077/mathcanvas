import type { DrawingViewSpec } from "@draw/dsl"

import type { ProjectedDrawing } from "../projectionVisuals"

/**
 * 只导出**图纸上还留着可见**的视图：隐藏的视图绝不产出凭空补出来的几何。
 * 没有持久化规格的视图保留它投影出来的内容。
 *
 * ## 为什么它单独立一个模块（而不是留在 `engineeringExporters.ts` 里）
 *
 * 这条判断用的是**同步**的 `useMemo`（`App.tsx` 的 `exportableEngineeringDrawings`），
 * 而同一个文件里的 `exportEngineeringPdf` 静态 import 了 `pdf-lib`（实测 **429 kB**，
 * gzip 178 kB）。两者放在一起的后果是：只要有一个同步调用点，`pdf-lib` 就被拉进**入口 chunk**，
 * 哪怕用户这一辈子不点一次"导出 PDF" —— 实测入口单 chunk 2 066 kB、构建时那条
 * "Some chunks are larger than 500 kB" 的警告就是这么来的。
 *
 * 拆开之后这个模块**零重依赖**（只有类型 import，编译后不剩任何 import），
 * `pdf-lib` 于是只从动态 `import()` 可达，Rollup 才会把它切成按需加载的独立 chunk。
 */
export function selectExportableDrawings(drawings: ProjectedDrawing[], views: DrawingViewSpec[] = []): ProjectedDrawing[] {
  if (views.length === 0) return drawings
  return drawings.filter((drawing) => views.find((view) => view.kind === drawing.view)?.visible !== false)
}

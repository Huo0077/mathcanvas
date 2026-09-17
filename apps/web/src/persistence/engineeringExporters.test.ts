import { describe, expect, it } from "vitest"

import { PDFDocument } from "pdf-lib"

import type { DrawingViewSpec } from "@draw/dsl"

import { exportEngineeringDxf, exportEngineeringPdf, exportEngineeringSvg, selectExportableDrawings } from "./engineeringExporters"
import type { ProjectedDrawing } from "../projectionVisuals"

function drawing(): ProjectedDrawing[] {
  return [{
    view: "front",
    primitives: [
      { kind: "point", sourceId: "point-a", point: { x: 1, y: 2, depth: 0 } },
      { kind: "polyline", sourceId: "edge-ab", points: [{ x: 1, y: 2, depth: 0 }, { x: 3, y: 2, depth: 0 }], closed: false },
      { kind: "polygon", sourceId: "face-abc", points: [{ x: 1, y: 2, depth: 0 }, { x: 3, y: 2, depth: 0 }, { x: 2, y: 4, depth: 0 }, { x: 1, y: 2, depth: 0 }], depth: 0 }
    ],
    projectionLines: [{ sourceId: "point-a", from: { x: 1, y: 2, depth: 0 }, to: { x: 2, y: 3, depth: 0 }, originView: "front", targetView: "top" }],
    annotations: [{ id: "dimension-1", sourceIds: ["point-a", "point-b"], kind: "linear", text: "dimension-1: 5.000 mm", position: { x: 2, y: 2, depth: 0 }, explanation: "", status: "valid" }],
    diagnostics: ["broken-edge: insufficient-data"]
  }]
}

describe("engineering drawing exporters", () => {
  it("exports projected views, source IDs, annotations, and diagnostics as SVG", () => {
    const svg = exportEngineeringSvg(drawing())

    expect(svg).toContain('data-drawing-view="front"')
    expect(svg).toContain('data-source-id="point-a"')
    expect(svg).toContain("dimension-1: 5.000 mm")
    expect(svg).toContain("broken-edge: insufficient-data")
  })

  it("exports projected lines, polylines, and annotation text as ASCII DXF", () => {
    const dxf = exportEngineeringDxf(drawing())

    expect(dxf).toContain("SECTION")
    expect(dxf).toContain("ENTITIES")
    expect(dxf).toContain("LINE")
    expect(dxf).toContain("LWPOLYLINE")
    expect(dxf).toContain("TEXT")
    expect(dxf).toContain("point-a")
  })

  it("writes a vector PDF from the same projected descriptions", async () => {
    const pdf = await exportEngineeringPdf(drawing())
    const header = new TextDecoder().decode(pdf.slice(0, 5))

    expect(header).toBe("%PDF-")
    expect(pdf.byteLength).toBeGreaterThan(500)
  })

  /**
   * 体检发现的真缺陷：PDF 用的是 `StandardFonts.Helvetica`（只有 WinAnsi 字符集），
   * 而注释文本与**诊断信息是应用自己生成的中文**。只要图纸里有一条中文诊断（很常见），
   * `drawText` 就抛 WinAnsi 编码错误，整个"导出 PDF"直接失败。
   */
  it("exports a PDF even when annotations and diagnostics contain text Helvetica cannot encode", async () => {
    const chinese = drawing()
    chinese[0] = {
      ...chinese[0],
      annotations: [{ ...chinese[0].annotations[0], text: "尺寸 1：5.000 毫米" }],
      diagnostics: ["棱 ab 数据不足：缺少端点"]
    }

    const pdf = await exportEngineeringPdf(chinese)

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-")
  })

  it("keeps engineering annotations and source ids out of a hidden view's export", () => {
    const views: DrawingViewSpec[] = [
      { id: "view-front", kind: "front", x: 0, y: 0, width: 10, height: 10, scale: 1, visible: false, showProjectionLines: false },
      { id: "view-top", kind: "top", x: 0, y: 0, width: 10, height: 10, scale: 1, visible: true, showProjectionLines: false }
    ]
    const topDrawing: ProjectedDrawing = { ...drawing()[0], view: "top" }

    const exportable = selectExportableDrawings([...drawing(), topDrawing], views)
    expect(exportable.map((candidate) => candidate.view)).toEqual(["top"])

    const svg = exportEngineeringSvg(exportable)
    expect(svg).toContain('data-drawing-view="top"')
    expect(svg).not.toContain('data-drawing-view="front"')
  })

  it("keeps every projected view when the document has no persisted layout", () => {
    expect(selectExportableDrawings(drawing(), [])).toHaveLength(1)
  })

  /**
   * 体检发现的真缺陷：SVG / DXF / PDF 三个导出器都硬写 `slice(0, 4)`，而 `addDrawingView`
   * 允许文档拥有超过四个视图——第 5 个之后的视图会被**静默丢掉**（导出文件里少了几张图，没有任何提示）。
   */
  it("exports every view instead of silently dropping the fifth one", async () => {
    const views = ["front", "top", "left", "axonometric", "front"] as const
    const drawings: ProjectedDrawing[] = views.map((view, index) => ({ ...drawing()[0], view, primitives: [{ kind: "point", sourceId: `point-${index}`, point: { x: index, y: index, depth: 0 } }] }))

    const svg = exportEngineeringSvg(drawings)
    expect(svg.match(/data-drawing-view=/g)).toHaveLength(5)
    // 第 5 张排在第三行，画布必须跟着长高，否则它落在视口之外等于没导出。
    expect(Number(/viewBox="0 0 1000 (\d+)"/.exec(svg)?.[1])).toBeGreaterThan(700)

    const dxf = exportEngineeringDxf(drawings)
    for (let index = 0; index < views.length; index += 1) expect(dxf).toContain(`point-${index}`)

    const pdf = await PDFDocument.load(await exportEngineeringPdf(drawings))
    expect(pdf.getPageCount()).toBe(5)
  })

  /**
   * 同一次体检：`drawingBounds` 用 `Math.min(...points.map(...))` 展开实参，点数一多就
   * `RangeError: Maximum call stack size exceeded`——导出直接失败（而且和图纸内容无关，纯粹是点数）。
   */
  it("computes bounds for a very large drawing without blowing the argument stack", () => {
    const points = Array.from({ length: 300_000 }, (_, index) => ({ x: index % 1000, y: -index, depth: 0 }))
    const huge: ProjectedDrawing[] = [{ ...drawing()[0], primitives: [{ kind: "polyline", sourceId: "edge-huge", points, closed: false }] }]

    expect(() => exportEngineeringSvg(huge)).not.toThrow()
    const svg = exportEngineeringSvg(huge)
    expect(svg).toContain('data-source-id="edge-huge"')
  })

  /**
   * 同一次体检：诊断文本的行号用 `diagnostics.indexOf(diagnostic)` 求，重复的诊断会全部落到
   * 第一行（互相覆盖），而且整体是 O(n²)。
   */
  it("stacks repeated diagnostics on separate lines", () => {
    const repeated: ProjectedDrawing[] = [{ ...drawing()[0], diagnostics: ["同名诊断", "同名诊断", "同名诊断"] }]

    const svg = exportEngineeringSvg(repeated)
    const ys = [...svg.matchAll(/class="diagnostic" x="-3.8" y="([-\d.]+)"/g)].map((match) => Number(match[1]))

    expect(ys).toHaveLength(3)
    expect(new Set(ys).size).toBe(3)
  })
})

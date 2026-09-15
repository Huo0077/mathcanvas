import { describe, expect, it } from "vitest"

import { exportEngineeringDxf, exportEngineeringPdf, exportEngineeringSvg } from "./engineeringExporters"
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
})

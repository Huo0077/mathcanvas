import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { exportCsv, exportSvg } from "./exporters"

describe("document exporters", () => {
  it("exports visible geometry as standalone SVG", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 2, y: 1, label: "测试点" },
      { id: "line-1", type: "line", a: { x: -1, y: 0 }, b: { x: 1, y: 2 } },
      { id: "hidden", type: "point", x: 0, y: 0, visible: false }
    ]

    const svg = exportSvg(document)

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('fill="#3d5afe"')
    expect(svg).toContain('stroke="#172033"')
    expect(svg).not.toContain('cx="400" cy="320" r="6"')
  })

  it("exports primitive metadata and escaped CSV data", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 2, y: 1, label: '点, "A"' }]

    const csv = exportCsv(document)

    expect(csv).toContain("id,type,label,visible,locked,data")
    expect(csv).toContain('point-1,point,"点, ""A""",true,false')
    expect(csv).toContain('"{""x"":2,""y"":1}"')
  })

  it("exports point-driven 3D data without presentation fields", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "point3-1", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" }, label: "A", visible: false }]

    const csv = exportCsv(document)

    expect(csv).toContain("point3-1,point3,A,false,false")
    expect(csv).toContain('"{""position"":{""x"":1,""y"":2,""z"":3},""binding"":{""kind"":""free""}}"')
    expect(csv).not.toContain('"label":"A"')
  })

  it("uses the canvas scale when exporting circles", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 1 }]

    expect(exportSvg(document)).toMatch(/<circle[^>]+r="33\.333333333333[0-9]+"/)
    expect(exportSvg(document)).not.toContain("<ellipse")
  })

  it("exports visible annotations at their anchored positions", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 2, y: 1 }]
    document.annotations = [{ id: "annotation-1", text: "A", anchor: { kind: "primitive", primitiveId: "point-1", feature: "point" }, offset: { x: 0.25, y: 0.25 } }]

    const svg = exportSvg(document)

    expect(svg).toContain('data-annotation-id="annotation-1"')
    expect(svg).toContain(">A</text>")
  })

  it("keeps function branches separate around undefined values", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "function-1", type: "function", expression: "1/x", domain: [-1, 1], samples: 128 }]

    expect(exportSvg(document).match(/<polyline/g)).toHaveLength(2)
  })
})

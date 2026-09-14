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

  it("exports sections with their classification and measurements as their own rows", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "solid-1", type: "polyhedron3", vertexIds: ["a", "b", "c", "d"], edgeIds: ["e1", "e2", "e3", "e4", "e5", "e6"], faceIds: ["f1", "f2", "f3", "f4"] },
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [{ x: 0, y: 0, z: 0 }], classification: "point", status: "approximate" }
    ]
    document.measurements = [{ id: "measurement3-1", kind: "measurement3", sourceIds: ["f1", "f2"], metric: "dihedral", dihedralKind: "exterior", value: 60, unit: "°", precision: "numeric-approximation", status: "valid", explanation: "以公共棱为轴计算。" }]

    const csv = exportCsv(document)

    expect(csv).toContain('""classification"":""point""')
    expect(csv).toContain("measurement3-1,measurement3,二面角外角,true,false")
    expect(csv).toContain('""value"":60,""unit"":""°""')
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

import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { WORLD_BOUNDS, worldToSvg, rayToViewport } from "../viewport"
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

  /**
   * 体检发现的真缺陷：导出侧的 `viewportRay` 自己重写了一遍射线裁剪，并且把 x 方向的限位写反了
   *（`unit.x > 0` 却用 `minX`），于是"从左侧向右射出的射线"在导出文件里停在左边缘，
   * 而画布上它是横穿视口的。导出必须复用画布那份 `rayToViewport`。
   */
  it("clips an exported ray with the same viewport rule as the canvas", () => {
    const document = createEmptyDocument("calculus")
    const ray = { id: "ray-1", type: "ray" as const, a: { x: -20, y: 0 }, b: { x: -19, y: 0 } }
    document.primitives = [ray]

    const shared = rayToViewport(ray, WORLD_BOUNDS)
    // 画布上：向右的射线要一直画到视口右边界。
    expect(shared.b.x).toBeCloseTo(WORLD_BOUNDS.maxX, 9)
    const expectedX2 = worldToSvg({ x: shared.b.x, y: 0 }).x

    const svg = exportSvg(document)
    const start = worldToSvg({ x: ray.a.x, y: 0 })
    // 起点在视口之外（x = -20），网格线不会从那里出发，所以这一段必然是这条射线。
    const rayFragment = svg.split("<line").find((fragment) => fragment.startsWith(` x1="${start.x}" y1="${start.y}"`))

    expect(rayFragment, "the exported ray segment is missing").toBeDefined()
    // 旧实现在这里画到左边界（x2 ≈ 0），画布与导出因此不一致。
    expect(rayFragment).toContain(`x2="${expectedX2}"`)
  })

  it("exports primitive metadata and escaped CSV data", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 2, y: 1, label: '点, "A"' }]

    const csv = exportCsv(document)

    expect(csv).toContain("id,type,label,visible,locked,data")
    expect(csv).toContain('point-1,point,"点, ""A""",true,false')
    expect(csv).toContain('"{""x"":2,""y"":1}"')
  })

  /**
   * 体检发现的真缺陷：CSV 带中文标签却没有 BOM。Excel（Windows）会按本地 ANSI 解码，
   * 打开就是乱码——这正是"导出 CSV 给同事看"最常见的用法。
   */
  it("starts the CSV with a byte-order mark so spreadsheet apps read Chinese labels correctly", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 2, y: 1, label: "测试点" }]

    expect(exportCsv(document).startsWith("\uFEFF")).toBe(true)
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

import { createEmptyDocument } from "@draw/dsl"
import { canonicalContentHash } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { canvasEvidenceAttributes, canvasEvidenceOf, hiddenPointLabels, measureRenderedCanvas, namedPointLabels } from "./canvasEvidence"

/**
 * **真实画布证据**（Task 16）。
 *
 * 计划原话：**"仅查内存文档不算视觉通过"**。所以这一层的每一个数都从**已经渲染出来的
 * DOM** 上量：对象盒子来自 `[data-primitive-type]` 组里那些真实图元元素的几何属性，
 * 标签盒子来自真实的 `<text>` / 3D 覆盖层标签，诊断再交给 `diagnoseLayout`
 *（判据只有一处，这里不重写）。
 *
 * 用例自己构造 SVG 元素（`createElementNS`），因此测的是"**从渲染结果量**"这条路径，
 * 而不是"从文档推"——后者正是计划点名不算数的那一种。
 */

it("**3D 虚实线**：`shown` 与「这次画了几段」分开报，缺省如实是没画（Task 16 边界）", () => {
  /**
   * 虚线画在 WebGL 里、DOM 量不到，所以这两个数由**真的建了它的那一层**
   *（`threeSceneContent` 的同步）写进 dataset，这一层只转述。
   * **`shown`（开关）与段数（画面上真有）是两件事**：只报开关会让"开着但一段都没画出来"
   * 看起来也正常。
   */
  const geometry = createEmptyDocument("geometry3d")
  const root = document.createElement("div")
  const withEdges = canvasEvidenceAttributes(canvasEvidenceOf({ document: geometry, root, viewport: { width: 400, height: 300 }, objectsMeasurable: false, hiddenEdges: { shown: true, segments: 12 } }), false)
  expect(withEdges["data-canvas-hidden-edges-shown"]).toBe("true")
  expect(withEdges["data-canvas-hidden-edges"]).toBe("12")

  // 缺省（2D 画布、或调用方没给）⇒ 如实"没画、0 段"，不编一个数。
  const bare = canvasEvidenceAttributes(canvasEvidenceOf({ document: geometry, root, viewport: { width: 400, height: 300 } }))
  expect(bare["data-canvas-hidden-edges-shown"]).toBe("false")
  expect(bare["data-canvas-hidden-edges"]).toBe("0")
})

const SVG = "http://www.w3.org/2000/svg"

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

/** 一棵最小的"渲染结果"：一个点对象（带标签）+ 一条线段 + 一个椭圆折线。 */
function renderedCanvas(): SVGSVGElement {
  const svg = svgElement("svg", { viewBox: "0 0 400 300" })
  const point = svgElement("g", { "data-primitive-type": "point" })
  point.append(svgElement("circle", { cx: 40, cy: 60, r: 4 }), svgElement("text", { x: 50, y: 64 }))
  ;(point.querySelector("text") as SVGTextElement).textContent = "A"
  const segment = svgElement("g", { "data-primitive-type": "segment" })
  segment.append(svgElement("line", { x1: 10, y1: 10, x2: 110, y2: 90 }))
  const ellipse = svgElement("g", { "data-primitive-type": "ellipse" })
  ellipse.append(svgElement("polyline", { points: "0,0 200,0 200,100 0,100 0,0" }))
  svg.append(point, segment, ellipse)
  return svg
}

describe("Task 16: canvas evidence is measured from the rendered DOM", () => {
  it("measures one object box per rendered primitive, in the renderer's own coordinate space", () => {
    const measured = measureRenderedCanvas(renderedCanvas())
    expect(measured.boxes.filter((box) => box.kind === "object")).toHaveLength(3)
    // 圆 (cx=40, cy=60, r=4) ⇒ x=36, y=56, 8×8；盒子就是元素的几何，不是文档里的数。
    const point = measured.boxes.find((box) => box.id.startsWith("point#"))!
    expect(point).toMatchObject({ x: 36, y: 56, width: 8, height: 8, kind: "object", shape: "marker" })
    const segment = measured.boxes.find((box) => box.id.startsWith("segment#"))!
    expect(segment).toMatchObject({ x: 10, y: 10, width: 100, height: 80, shape: "shape" })
    const ellipse = measured.boxes.find((box) => box.id.startsWith("ellipse#"))!
    expect(ellipse).toMatchObject({ x: 0, y: 0, width: 200, height: 100, shape: "shape" })
  })

  it("measures label boxes from the rendered text elements and names them by their text", () => {
    const measured = measureRenderedCanvas(renderedCanvas())
    expect(measured.renderedLabels).toEqual(["A"])
    const label = measured.boxes.find((box) => box.kind === "label")!
    expect(label.id).toBe("label:A")
    expect(label.width).toBeGreaterThan(0)
    expect(label.height).toBeGreaterThan(0)
  })

  it("counts a label the canvas did not render as invisible from this camera, and ignores unnamed points", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives.push(
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A" },
      { id: "p-b", type: "point3", position: { x: 1, y: 0, z: 0 }, label: "B" },
      { id: "p-c", type: "point3", position: { x: 0, y: 1, z: 0 }, label: "C" },
      // 圆类实体的细分顶点：本质上是内部顶点，画布不展示 ⇒ 不计入"看不见的点名"。
      { id: "p-t", type: "point3", position: { x: 0, y: 0, z: 1 }, label: "T", tessellation: true },
      { id: "p-anon", type: "point3", position: { x: 2, y: 0, z: 0 } }
    )
    expect(namedPointLabels(document)).toEqual(["A", "B", "C"])
    // 画布只渲染出 A、B ⇒ C 在当前相机下没被画出来。
    expect(hiddenPointLabels(document, ["A", "B"])).toEqual(["C"])
    // 全都在画面上时一个都不该报（不许把"相机没问题"说成有问题）。
    expect(hiddenPointLabels(document, ["A", "B", "C"])).toEqual([])
  })

  it("reports overlapping point labels through the existing layout judgement", () => {
    // 两个点几乎画在同一个位置 —— 2D 画布上就是"点名叠在一起"（标签盒由渲染出的 `<text>` 量得）。
    const svg = svgElement("svg", { viewBox: "0 0 400 300" })
    for (const [name, x, y] of [["A", 100, 100], ["B", 102, 102]] as const) {
      const group = svgElement("g", { "data-primitive-type": "point" })
      group.append(svgElement("circle", { cx: x, cy: y, r: 4 }))
      const text = svgElement("text", { x, y })
      text.textContent = name
      group.append(text)
      svg.append(group)
    }
    const evidence = canvasEvidenceOf({ document: createEmptyDocument("conics"), root: svg, viewport: { width: 400, height: 300 } })
    expect(evidence.diagnostics.map((entry) => entry.code)).toContain("label_overlap")
    const attributes = canvasEvidenceAttributes(evidence)
    expect(attributes["data-canvas-diagnostics"]).toContain("label_overlap")
    // 标签叠了是**警告**：图上东西都在、只是有一处小瑕疵 —— 不许被读成"看不见"。
    expect(attributes["data-canvas-diagnostic-errors"]).toBe("")
  })

  it("keeps both boxes when the same letter is drawn twice, so the overlap is judged", () => {
    // 同一个点名画两遍（翻折题的折片与边上的点同名）——证据**不许自己去重**，
    // 否则"画了两遍"这件事会在取证这一步被抹掉，而它正是"点名遮挡"要报的。
    const svg = svgElement("svg", { viewBox: "0 0 400 300" })
    for (const x of [200, 200]) {
      const group = svgElement("g", { "data-primitive-type": "point" })
      group.append(svgElement("circle", { cx: x, cy: 150, r: 4 }))
      const text = svgElement("text", { x: x + 10, y: 154 })
      text.textContent = "E"
      group.append(text)
      svg.append(group)
    }
    const measured = measureRenderedCanvas(svg)
    expect(measured.boxes.filter((box) => box.kind === "label")).toHaveLength(2)
    // 名字集合去重（用来与文档点名求差），盒子不去重。
    expect(measured.renderedLabels).toEqual(["E"])
    const evidence = canvasEvidenceOf({ document: createEmptyDocument("geometry3d"), root: svg, viewport: { width: 400, height: 300 }, objectsMeasurable: false })
    expect(evidence.diagnostics.map((entry) => entry.code)).toContain("label_overlap")
  })

  it("does not cry 'empty canvas' for the 3D canvas, where the shapes live inside WebGL", () => {
    // 3D 的图形画在 WebGL 里，DOM 里只剩下点标注覆盖层 ⇒ 不许把"量不到对象"说成"画布是空的"。
    const shell = document.createElement("div")
    shell.setAttribute("data-3d-scene", "true")
    const label = document.createElement("div")
    label.setAttribute("data-point-id", "vertex-a")
    label.textContent = "A"
    label.style.left = "120px"
    label.style.top = "80px"
    shell.append(label)
    const document3d = createEmptyDocument("geometry3d")
    document3d.primitives.push(
      { id: "vertex-a", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A" },
      { id: "vertex-b", type: "point3", position: { x: 1, y: 0, z: 0 }, label: "B" }
    )
    const evidence = canvasEvidenceOf({ document: document3d, root: shell, viewport: { width: 800, height: 600 }, objectsMeasurable: false })
    expect(evidence.diagnostics.map((entry) => entry.code)).not.toContain("empty_canvas")
    expect(evidence.boxes.filter((box) => box.kind === "label")).toHaveLength(1)
    // 相机看不见 B（覆盖层里没有它）—— 这才是 3D 那一侧该说的话。
    expect(evidence.hiddenLabels).toEqual(["B"])
    expect(canvasEvidenceAttributes(evidence, false)["data-canvas-objects-measurable"]).toBe("false")
  })

  it("binds the evidence to the document it is rendering, by content hash and revision", () => {
    const document = createEmptyDocument("conics")
    document.primitives.push({ id: "a", type: "point", x: 0, y: 0, label: "A" })
    const evidence = canvasEvidenceOf({ document, root: renderedCanvas(), viewport: { width: 400, height: 300 } })
    expect(evidence.documentHash).toBe(canonicalContentHash(document))
    expect(evidence.documentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(evidence.revision).toBe(document.revision)
    const attributes = canvasEvidenceAttributes(evidence)
    expect(attributes["data-document-hash"]).toBe(evidence.documentHash)
    expect(attributes["data-canvas-boxes"]).toBe(String(evidence.boxes.filter((box) => box.kind === "object").length))
    expect(attributes["data-canvas-labels"]).toBe("1")
  })
})


describe("canvas evidence consumption", () => {
  it("rejects an old rendered snapshot after document content changes", () => {
    const geometry = createEmptyDocument("conics")
    const evidence = canvasEvidenceOf({ document: geometry, root: renderedCanvas(), viewport: { width: 400, height: 300 } })
    geometry.primitives.push({ id: "new-point", type: "point", x: 2, y: 3 })
    const consumed = canvasEvidenceAttributes(evidence, true, geometry)
    expect(consumed["data-canvas-evidence-status"]).toBe("stale")
    expect(consumed["data-canvas-evidence-accepted"]).toBe("false")
    expect(consumed["data-canvas-evidence-stale-reason"]).toBe("document_changed")
    expect(consumed["data-canvas-boxes"]).toBeUndefined()
  })

  it("does not invalidate same-content evidence just for its snapshot version", () => {
    const geometry = createEmptyDocument("conics")
    const evidence = canvasEvidenceOf({ document: geometry, root: renderedCanvas(), viewport: { width: 400, height: 300 } })
    const consumed = canvasEvidenceAttributes({ ...evidence, revision: evidence.revision + 1 }, true, geometry)
    expect(consumed["data-canvas-evidence-status"]).toBe("passed")
    expect(consumed["data-canvas-evidence-accepted"]).toBe("true")
  })

  it("does not call unmeasurable WebGL objects visually passed", () => {
    const geometry = createEmptyDocument("geometry3d")
    const evidence = canvasEvidenceOf({ document: geometry, root: document.createElement("div"), viewport: { width: 400, height: 300 }, objectsMeasurable: false })
    const consumed = canvasEvidenceAttributes(evidence, false, geometry)
    expect(consumed["data-canvas-evidence-status"]).toBe("partial")
    expect(consumed["data-canvas-evidence-accepted"]).toBe("false")
    // A caller cannot upgrade the scope after measurement.
    expect(canvasEvidenceAttributes(evidence, true, geometry)["data-canvas-evidence-status"]).toBe("partial")
  })

  it("rejects missing point labels even when no layout diagnostic fired", () => {
    const geometry = createEmptyDocument("geometry3d")
    geometry.primitives.push({ id: "p", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "P" })
    const evidence = canvasEvidenceOf({ document: geometry, root: document.createElement("div"), viewport: { width: 400, height: 300 }, objectsMeasurable: false })
    const consumed = canvasEvidenceAttributes(evidence, false, geometry)
    expect(consumed["data-canvas-evidence-status"]).toBe("failed")
    expect(consumed["data-canvas-hidden-labels"]).toBe("P")
  })

  it("rejects a snapshot from a different workspace", () => {
    const geometry = createEmptyDocument("conics")
    const evidence = canvasEvidenceOf({ document: geometry, root: renderedCanvas(), viewport: { width: 400, height: 300 } })
    const consumed = canvasEvidenceAttributes(evidence, true, createEmptyDocument("geometry3d"))
    expect(consumed["data-canvas-evidence-status"]).toBe("stale")
    expect(consumed["data-canvas-evidence-stale-reason"]).toBe("draft_replaced")
  })
})

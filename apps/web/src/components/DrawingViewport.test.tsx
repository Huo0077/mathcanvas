import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type DrawingViewSpec, type GeometryDocument } from "@draw/dsl"

import { resolveProjectedDrawing } from "../projectionVisuals"
import { DrawingViewport } from "./DrawingViewport"

const projectionView: DrawingViewSpec = { id: "view-front", kind: "front", x: 0, y: 0, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false }
const draftView: DrawingViewSpec = { id: "view-model", kind: "model", x: 0, y: 0, width: 300, height: 220, scale: 1, visible: true, showProjectionLines: false }

function pointDocument(): GeometryDocument {
  return { ...createEmptyDocument("cad"), primitives: [{ id: "point3-1", type: "point3", position: { x: 2, y: 3, z: 4 }, label: "A" }] }
}

function draftDocument(): GeometryDocument {
  return {
    ...createEmptyDocument("cad"),
    primitives: [
      { id: "line-1", type: "line", a: { x: -2, y: -1 }, b: { x: 2, y: 1 }, label: "直线 1" },
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 1, label: "圆 1" }
    ]
  }
}

describe("drawing viewport", () => {
  it("renders projected geometry and reports the stable source id on selection", () => {
    const onSelect = vi.fn()
    const document = pointDocument()
    render(<DrawingViewport view={projectionView} sheetName="工程图纸" mode="projection" document={document} selectedIds={[]} projectedDrawing={resolveProjectedDrawing(document, "front")} onSelect={onSelect} />)

    const target = screen.getByRole("button", { name: /point3-1/ })
    expect(target.getAttribute("data-source-id")).toBe("point3-1")
    fireEvent.click(target)
    expect(onSelect).toHaveBeenCalledWith("point3-1", false)
  })

  it("keeps the projection-line toggle temporary", () => {
    const document = pointDocument()
    const { rerender } = render(<DrawingViewport view={projectionView} sheetName="工程图纸" mode="projection" document={document} selectedIds={[]} projectedDrawing={resolveProjectedDrawing(document, "front")} onSelect={() => {}} />)

    expect(screen.queryAllByTestId("projection-line")).toHaveLength(0)

    rerender(<DrawingViewport view={projectionView} sheetName="工程图纸" mode="projection" document={document} selectedIds={[]} projectedDrawing={resolveProjectedDrawing(document, "front")} projectionLinesOverride onSelect={() => {}} />)
    expect(screen.getAllByTestId("projection-line").length).toBeGreaterThan(0)
  })

  it("shows an empty state instead of fabricated geometry", () => {
    const document = createEmptyDocument("cad")
    render(<DrawingViewport view={projectionView} sheetName="工程图纸" mode="projection" document={document} selectedIds={[]} projectedDrawing={resolveProjectedDrawing(document, "front")} onSelect={() => {}} />)

    expect(screen.getByText("暂无可投影的空间对象")).toBeTruthy()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("reports scale and visibility changes with the view id", () => {
    const onLayoutChange = vi.fn()
    render(<DrawingViewport view={projectionView} sheetName="工程图纸" mode="projection" document={pointDocument()} selectedIds={[]} onSelect={() => {}} onLayoutChange={onLayoutChange} />)

    fireEvent.click(screen.getByRole("button", { name: "放大 主视图" }))
    expect(onLayoutChange).toHaveBeenCalledWith("view-front", { scale: 1.5 })

    fireEvent.click(screen.getByRole("button", { name: "缩小 主视图" }))
    expect(onLayoutChange).toHaveBeenCalledWith("view-front", { scale: 0.5 })

    fireEvent.click(screen.getByRole("button", { name: "隐藏 主视图" }))
    expect(onLayoutChange).toHaveBeenCalledWith("view-front", { visible: false })
  })

  it("renders editable document primitives in 2D drafting mode", () => {
    const onSelect = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={["line-1"]} onSelect={onSelect} />)

    const target = screen.getByRole("button", { name: /直线 1/ })
    expect(target.getAttribute("data-primitive-id")).toBe("line-1")
    expect(target.getAttribute("data-selected")).toBe("true")

    fireEvent.click(screen.getByRole("button", { name: /圆 1/ }))
    expect(onSelect).toHaveBeenCalledWith("circle-1", false)
  })

  it("maps a drafting click on the paper to document coordinates", () => {
    const onCreateAt = vi.fn()
    // 用空文档：这条用例只验证像素→图纸坐标的映射，吸附行为由下面的 snap 用例单独覆盖。
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)

    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.click(svg, { clientX: 200, clientY: 100 })

    const [minX, minY, width, height] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number)
    // 视口中心必须映射到窗口中心；`+ 0` 只是把 -0 归一成 0（落点坐标统一收敛，不留浮点尘埃）。
    expect(onCreateAt).toHaveBeenCalledWith({ x: minX + width / 2, y: -(minY + height / 2) + 0 })
  })

  it("filters out drafting primitives that live on a hidden layer", () => {
    const document: GeometryDocument = {
      ...createEmptyDocument("cad"),
      layers: [{ id: "layer-hidden", name: "隐藏层", kind: "geometry", visible: false, locked: false, printable: true }],
      primitives: [{ id: "point-1", type: "point", x: 0, y: 0, layerId: "layer-hidden", label: "点 1" }]
    }
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={document} selectedIds={[]} onSelect={() => {}} />)

    expect(screen.queryByRole("button", { name: /点 1/ })).toBeNull()
    expect(screen.getByText("当前图层还没有二维图元")).toBeTruthy()
  })

  it("keeps the drafting window fixed instead of re-fitting it to the drawn content", () => {
    const empty = render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} />)
    const emptyViewBox = empty.getByRole("img", { name: /模型视图/ }).getAttribute("viewBox")

    // 画了图元之后窗口必须一模一样，否则画下第一个点整个坐标系就会跳。
    const filled = render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={[]} onSelect={() => {}} />)
    const filledViewBox = filled.getAllByRole("img", { name: /模型视图/ })[0].getAttribute("viewBox")

    expect(emptyViewBox).toBe("-50 -50 100 100")
    expect(filledViewBox).toBe(emptyViewBox)
  })

  it("draws a drafting grid that thins out when zoomed out", () => {
    const narrow = render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} />)
    const majorCount = narrow.container.querySelectorAll(".engineering-drawing-grid-major line").length
    expect(majorCount).toBeGreaterThan(0)

    const wide = render(<DrawingViewport view={{ ...draftView, id: "view-wide", scale: 0.1 }} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} />)
    // 缩小到 0.1 倍时窗口跨 1000，主网格必须自动加粗，否则会画出上百条线。
    expect(wide.container.querySelectorAll(".engineering-drawing-grid-major line").length).toBeLessThanOrEqual(majorCount * 2)
  })

  it("snaps the drafting click to an existing endpoint and labels the snap", () => {
    const onCreateAt = vi.fn()
    const document: GeometryDocument = {
      ...createEmptyDocument("cad"),
      primitives: [{ id: "segment-1", type: "segment", a: { x: 10, y: 10 }, b: { x: 30, y: 10 }, label: "线段 1" }]
    }
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={document} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)

    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    // 窗口 -50..50 映射到 400px：端点 (10,10) 在 (240, 160)。指针偏 4px 仍应吸到端点上。
    fireEvent.pointerMove(svg, { clientX: 244, clientY: 164, pointerId: 1 })
    expect(svg.querySelector('[data-draft-snap="endpoint"]')).toBeTruthy()

    fireEvent.click(svg, { clientX: 244, clientY: 164 })
    expect(onCreateAt).toHaveBeenCalledWith({ x: 10, y: 10 })
  })

  it("previews the object being drawn and reports its length and angle", () => {
    render(
      <DrawingViewport
        view={draftView}
        sheetName="工程图纸"
        mode="draft"
        document={createEmptyDocument("cad")}
        selectedIds={[]}
        creation={{ mode: "line", center: { x: 0, y: 0 } }}
        onSelect={() => {}}
        onCreateAt={() => {}}
      />
    )
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    fireEvent.pointerMove(svg, { clientX: 300, clientY: 200, pointerId: 1 })

    expect(svg.querySelector('[data-draft-preview="line"]')).toBeTruthy()
    // 从原点拖到 (25, 0)：长度 25、角度 0°。
    expect(svg.querySelector("[data-draft-readout]")?.textContent).toBe("25 · 0°")
  })

  it("constrains the preview to an axis while Shift is held", () => {
    const onCreateAt = vi.fn()
    render(
      <DrawingViewport
        view={draftView}
        sheetName="工程图纸"
        mode="draft"
        document={createEmptyDocument("cad")}
        selectedIds={[]}
        creation={{ mode: "line", center: { x: 0, y: 0 } }}
        onSelect={() => {}}
        onCreateAt={onCreateAt}
      />
    )
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // 按住 Shift 时 y 被压到 0；不按时保留自由落点。目标点 (30, 3) 对应像素 (320, 188)。
    fireEvent.click(svg, { clientX: 320, clientY: 188, shiftKey: true })
    expect(onCreateAt).toHaveBeenCalledWith({ x: 30, y: 0 })

    onCreateAt.mockClear()
    fireEvent.click(svg, { clientX: 320, clientY: 188 })
    expect(onCreateAt).toHaveBeenCalledWith({ x: 30, y: 3 })
  })

  it("snaps free placement to the grid only while grid snapping is on", () => {
    const onCreateAt = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // 默认关闭：像素 (292, 228) 落在 (23, -7)，不被量化。
    fireEvent.click(svg, { clientX: 292, clientY: 228 })
    expect(onCreateAt).toHaveBeenCalledWith({ x: 23, y: -7 })

    const toggle = screen.getByRole("button", { name: "切换栅格捕捉" })
    expect(toggle.getAttribute("data-draft-grid-snap")).toBe("off")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("data-draft-grid-snap")).toBe("on")

    onCreateAt.mockClear()
    fireEvent.click(svg, { clientX: 292, clientY: 228 })
    // 比例 1 时次网格不可见，因此按主网格 10 量化。
    expect(onCreateAt).toHaveBeenCalledWith({ x: 20, y: -10 })
  })

  it("lets object snap win over grid snapping", () => {
    const onCreateAt = vi.fn()
    const document: GeometryDocument = {
      ...createEmptyDocument("cad"),
      // 端点故意落在非整格坐标上，这样"吸到端点"与"吸到网格"能被区分开。
      primitives: [{ id: "segment-1", type: "segment", a: { x: 3.5, y: 7.25 }, b: { x: 13.5, y: 7.25 }, label: "线段 1" }]
    }
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={document} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    fireEvent.click(screen.getByRole("button", { name: "切换栅格捕捉" }))
    fireEvent.click(svg, { clientX: 214, clientY: 171 })

    expect(onCreateAt).toHaveBeenCalledWith({ x: 3.5, y: 7.25 })
  })

  it("snaps to intersections and quadrant points, not just endpoints", () => {
    const document: GeometryDocument = {
      ...createEmptyDocument("cad"),
      primitives: [
        { id: "s1", type: "segment", a: { x: -20, y: -10 }, b: { x: 20, y: -10 }, label: "水平线" },
        { id: "s2", type: "segment", a: { x: 6, y: -30 }, b: { x: 6, y: 10 }, label: "竖直线" },
        { id: "c1", type: "circle", center: { x: -30, y: 20 }, radius: 20, label: "圆" }
      ]
    }
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={document} selectedIds={[]} onSelect={() => {}} onCreateAt={() => {}} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // 交点 (6, -10) → 像素 (224, 240)
    fireEvent.pointerMove(svg, { clientX: 224, clientY: 240, pointerId: 1 })
    expect(svg.querySelector('[data-draft-snap="intersection"]')).toBeTruthy()

    // 圆的象限点 (-10, 20) → 像素 (160, 120)
    fireEvent.pointerMove(svg, { clientX: 160, clientY: 120, pointerId: 1 })
    expect(svg.querySelector('[data-draft-snap="quadrant"]')).toBeTruthy()
  })

  it("cycles overlapping snap candidates with Tab", () => {
    const onCreateAt = vi.fn()
    const document: GeometryDocument = {
      ...createEmptyDocument("cad"),
      // 端点 (0,0) 同时落在另一条线段上：同一位置既有"端点"也有"最近点"。
      primitives: [
        { id: "s1", type: "segment", a: { x: 0, y: 0 }, b: { x: 30, y: 0 }, label: "线段 1" },
        { id: "s2", type: "segment", a: { x: 0, y: -20 }, b: { x: 0, y: 20 }, label: "线段 2" }
      ]
    }
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={document} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // (2, 2) → 像素 (208, 192)：容差内同时有端点/交点/中点/最近点。
    fireEvent.pointerMove(svg, { clientX: 208, clientY: 192, pointerId: 1 })
    const layer = svg.querySelector('[data-draft-snap-candidates]')!
    const total = Number(layer.getAttribute("data-draft-snap-candidates"))
    expect(total).toBeGreaterThan(1)
    const first = svg.querySelector("[data-draft-snap]")!.getAttribute("data-draft-snap")

    fireEvent.keyDown(svg, { key: "Tab" })
    expect(svg.querySelector("[data-draft-snap]")!.getAttribute("data-draft-snap")).not.toBe(first)

    // 点击必须落在 Tab 选中的那个候选上。
    const label = svg.querySelector(".engineering-drawing-snap-label")!.textContent ?? ""
    expect(label).toContain("2/")
    fireEvent.click(svg, { clientX: 208, clientY: 192 })
    expect(onCreateAt).toHaveBeenCalledTimes(1)
  })

  it("shows grip handles for the selected draft primitive and drags an endpoint", () => {
    const onDragEnd = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={["line-1"]} onSelect={() => {}} onDragEnd={onDragEnd} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // line-1 是 (-2,-1) → (2,1)：端点在窗口 -50..50、400px 视口下映射到 (192,204) 与 (208,196)。
    expect(svg.querySelectorAll("[data-draft-handle]")).toHaveLength(2)
    const handleA = svg.querySelector('[data-draft-handle="a"]')!

    fireEvent.pointerDown(handleA, { clientX: 192, clientY: 204, pointerId: 9, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 172, clientY: 204, pointerId: 9 })
    fireEvent.pointerUp(svg, { clientX: 172, clientY: 204, pointerId: 9 })

    expect(onDragEnd).toHaveBeenCalledWith("line-1", { kind: "update", patch: { a: { x: -7, y: -1 } } })
  })

  it("ignores a grip drag that never really moved", () => {
    const onDragEnd = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={["line-1"]} onSelect={() => {}} onDragEnd={onDragEnd} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    fireEvent.pointerDown(svg.querySelector('[data-draft-handle="b"]')!, { clientX: 208, clientY: 196, pointerId: 9, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 208.5, clientY: 196.5, pointerId: 9 })
    fireEvent.pointerUp(svg, { clientX: 208.5, clientY: 196.5, pointerId: 9 })

    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it("does not offer draft handles when nothing is selected", () => {
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={[]} onSelect={() => {}} onDragEnd={() => {}} />)

    expect(screen.getByRole("img", { name: /模型视图/ }).querySelectorAll("[data-draft-handle]")).toHaveLength(0)
  })

  it("translates a draft primitive when its body is dragged away from the grips", () => {
    const onDragEnd = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={["line-1"]} onSelect={() => {}} onDragEnd={onDragEnd} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // line-1 的中点 (0,0) 距离两个端点各 2.24 世界单位，超出 2 单位的夹点容差 → 判为整体平移。
    const body = svg.querySelector('[data-primitive-id="line-1"]')!
    fireEvent.pointerDown(body, { clientX: 200, clientY: 200, pointerId: 4, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 208, clientY: 200, pointerId: 4 })
    fireEvent.pointerUp(svg, { clientX: 208, clientY: 200, pointerId: 4 })

    expect(onDragEnd).toHaveBeenCalledWith("line-1", { kind: "translate", delta: { x: 2, y: 0 } })
  })

  it("box-selects with the direction deciding the mode", () => {
    const onBoxSelect = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={[]} onSelect={() => {}} onBoxSelect={onBoxSelect} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // 右 → 左：相交选择，拖动过程中矩形就带上了语义。
    fireEvent.pointerDown(svg, { clientX: 250, clientY: 150, pointerId: 3, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 250, pointerId: 3 })
    expect(svg.querySelector('[data-draft-box="crossing"]')).toBeTruthy()
    fireEvent.pointerUp(svg, { clientX: 150, clientY: 250, pointerId: 3 })
    expect(onBoxSelect).toHaveBeenCalledWith({ minX: -12.5, minY: -12.5, maxX: 12.5, maxY: 12.5 }, "crossing")

    // 左 → 右：窗口选择。
    onBoxSelect.mockClear()
    fireEvent.pointerDown(svg, { clientX: 150, clientY: 250, pointerId: 3, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 250, clientY: 150, pointerId: 3 })
    expect(svg.querySelector('[data-draft-box="window"]')).toBeTruthy()
    fireEvent.pointerUp(svg, { clientX: 250, clientY: 150, pointerId: 3 })
    expect(onBoxSelect).toHaveBeenCalledWith({ minX: -12.5, minY: -12.5, maxX: 12.5, maxY: 12.5 }, "window")
  })

  it("does not start a box selection while a creation is pending", () => {
    const onBoxSelect = vi.fn()
    render(
      <DrawingViewport
        view={draftView}
        sheetName="工程图纸"
        mode="draft"
        document={draftDocument()}
        selectedIds={[]}
        creation={{ mode: "line", center: null }}
        onSelect={() => {}}
        onBoxSelect={onBoxSelect}
      />
    )
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    fireEvent.pointerDown(svg, { clientX: 250, clientY: 150, pointerId: 3, button: 0 })
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 250, pointerId: 3 })
    fireEvent.pointerUp(svg, { clientX: 150, clientY: 250, pointerId: 3 })

    expect(svg.querySelector("[data-draft-box]")).toBeNull()
    expect(onBoxSelect).not.toHaveBeenCalled()
  })

  it("places a point from a typed absolute coordinate", () => {
    const onCreateAt = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)

    const input = screen.getByLabelText("坐标输入") as HTMLInputElement
    fireEvent.change(input, { target: { value: "12, -8" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onCreateAt).toHaveBeenCalledWith({ x: 12, y: -8 })
    expect(input.value).toBe("")
  })

  it("places a point from a typed relative and polar coordinate", () => {
    const onCreateAt = vi.fn()
    render(
      <DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} creation={{ mode: "line", center: { x: 10, y: 5 } }} onSelect={() => {}} onCreateAt={onCreateAt} />
    )

    const input = screen.getByLabelText("坐标输入") as HTMLInputElement
    fireEvent.change(input, { target: { value: "@5,0" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onCreateAt).toHaveBeenCalledWith({ x: 15, y: 5 })

    onCreateAt.mockClear()
    fireEvent.change(input, { target: { value: "@10<90" } })
    fireEvent.keyDown(input, { key: "Enter" })
    const point = onCreateAt.mock.calls[0][0] as { x: number; y: number }
    expect(point.x).toBeCloseTo(10, 9)
    expect(point.y).toBeCloseTo(15, 9)
  })

  it("explains a bad coordinate instead of placing a wrong point", () => {
    const onCreateAt = vi.fn()
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)

    const input = screen.getByLabelText("坐标输入")
    fireEvent.change(input, { target: { value: "abc" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onCreateAt).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("坐标")
  })

  it("offers dynamic length and angle fields only while a creation is anchored", () => {
    const onCreateAt = vi.fn()
    const { rerender } = render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)
    expect(screen.queryByLabelText("输入长度")).toBeNull()

    rerender(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={createEmptyDocument("cad")} selectedIds={[]} creation={{ mode: "line", center: { x: 0, y: 0 } }} onSelect={() => {}} onCreateAt={onCreateAt} />)
    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    // 指针放在 (3,4) 方向：输入长度 10 → 落点 (6,8)。
    fireEvent.pointerMove(svg, { clientX: 212, clientY: 184, pointerId: 1 })
    const length = screen.getByLabelText("输入长度") as HTMLInputElement
    fireEvent.change(length, { target: { value: "10" } })
    fireEvent.keyDown(length, { key: "Enter" })

    const point = onCreateAt.mock.calls.at(-1)?.[0] as { x: number; y: number }
    expect(point.x).toBeCloseTo(6, 6)
    expect(point.y).toBeCloseTo(8, 6)
  })
})

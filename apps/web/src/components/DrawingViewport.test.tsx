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
    render(<DrawingViewport view={draftView} sheetName="工程图纸" mode="draft" document={draftDocument()} selectedIds={[]} onSelect={() => {}} onCreateAt={onCreateAt} />)

    const svg = screen.getByRole("img", { name: /模型视图/ })
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.click(svg, { clientX: 200, clientY: 100 })

    const [minX, minY, width, height] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number)
    expect(onCreateAt).toHaveBeenCalledWith({ x: minX + width / 2, y: -(minY + height / 2) })
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
})

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"

import { EngineeringDrawingView } from "./EngineeringDrawingView"

function pointDocument(): GeometryDocument {
  return {
    ...createEmptyDocument("cad"),
    primitives: [{ id: "point-a", type: "point3", position: { x: 2, y: 3, z: 4 }, label: "A" }]
  }
}

describe("engineering drawing view", () => {
  it("renders four labeled empty view panels", () => {
    render(<EngineeringDrawingView document={createEmptyDocument("cad")} selectedIds={[]} onSelect={() => {}} />)

    expect(screen.getAllByRole("region")).toHaveLength(4)
    expect(screen.getByRole("region", { name: "主视图" }).dataset.drawingView).toBe("front")
    expect(screen.getByRole("region", { name: "俯视图" }).dataset.drawingView).toBe("top")
    expect(screen.getByRole("region", { name: "左视图" }).dataset.drawingView).toBe("left")
    expect(screen.getByRole("region", { name: "轴测图" }).dataset.drawingView).toBe("axonometric")
    expect(screen.getAllByText("暂无可投影的空间对象")).toHaveLength(4)
  })

  it("keeps stable source IDs across all views and selects the source object", () => {
    const onSelect = vi.fn()
    render(<EngineeringDrawingView document={pointDocument()} selectedIds={[]} onSelect={onSelect} />)

    const sourceButtons = screen.getAllByRole("button", { name: /point-a/ })
    expect(sourceButtons).toHaveLength(4)
    expect(sourceButtons.every((button) => button.getAttribute("data-source-id") === "point-a")).toBe(true)

    fireEvent.click(sourceButtons[0])
    expect(onSelect).toHaveBeenCalledWith("point-a", false)
  })

  it("shares selected state, recomputes coordinates, and toggles projection lines locally", () => {
    const document = pointDocument()
    const { rerender } = render(<EngineeringDrawingView document={document} selectedIds={["point-a"]} onSelect={() => {}} />)

    expect(screen.getAllByRole("button", { name: /point-a/ }).every((button) => button.getAttribute("data-selected") === "true")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "显示投影线" }))
    expect(screen.getAllByRole("img").length).toBe(4)
    expect(screen.getAllByTestId("projection-line").length).toBeGreaterThan(0)

    const updatedDocument = { ...document, revision: document.revision + 1, primitives: [{ ...document.primitives[0], position: { x: 6, y: 3, z: 4 } }] }
    rerender(<EngineeringDrawingView document={updatedDocument} selectedIds={["point-a"]} onSelect={() => {}} />)
    const projectedX = screen.getAllByRole("button", { name: /point-a/ }).map((button) => Number(button.querySelector("circle")?.getAttribute("cx")))
    expect(projectedX[0]).toBe(6)
    expect(projectedX[1]).toBe(6)
    expect(projectedX[2]).toBe(4)
    expect(projectedX[3]).toBeCloseTo(3 * Math.SQRT1_2)

    fireEvent.click(screen.getByRole("button", { name: "隐藏投影线" }))
    expect(screen.queryAllByTestId("projection-line")).toHaveLength(0)
  })
})

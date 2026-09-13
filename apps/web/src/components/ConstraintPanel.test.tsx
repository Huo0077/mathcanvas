import type { PrimitiveSpec } from "@draw/dsl"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConstraintPanel } from "./ConstraintPanel"

const primitives: PrimitiveSpec[] = [
  { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, label: "基准线" },
  { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 1 }, label: "平行线" }
]

describe("ConstraintPanel", () => {
  it("shows constraint status and supports deletion", () => {
    const onDelete = vi.fn()
    render(<ConstraintPanel constraints={[{ id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] }]} primitives={primitives} error={null} onDelete={onDelete} onDeleteMany={vi.fn()} />)

    expect(screen.getByText("平行")).toBeTruthy()
    expect(screen.getByText("已满足")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "删除约束 parallel-1" }))
    expect(onDelete).toHaveBeenCalledWith("parallel-1")
  })

  it("announces a conflict with a recovery hint", () => {
    render(<ConstraintPanel constraints={[]} primitives={primitives} error="constraint solving failed to converge" onDelete={vi.fn()} onDeleteMany={vi.fn()} />)

    expect(screen.getByRole("alert").textContent).toContain("删除冲突约束")
    expect(screen.getByText("constraint solving failed to converge")).toBeTruthy()
  })
})

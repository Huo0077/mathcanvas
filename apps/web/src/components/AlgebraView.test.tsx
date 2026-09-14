import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { Measurement3, Polyhedron3Primitive, PrimitiveSpec } from "@draw/dsl"

import { AlgebraView } from "./AlgebraView"

const solid: Polyhedron3Primitive = {
  id: "solid-cube-1",
  type: "polyhedron3",
  vertexIds: ["vertex-a", "vertex-b", "vertex-c"],
  edgeIds: ["edge-ab"],
  faceIds: ["face-abc"],
  construction: { kind: "template", templateId: "cube-1", sourceIds: ["cube-1"] }
}

const primitives: PrimitiveSpec[] = [
  { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" },
  solid,
  { id: "vertex-a", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A" },
  { id: "vertex-b", type: "point3", position: { x: 1, y: 0, z: 0 }, label: "B" },
  { id: "vertex-c", type: "point3", position: { x: 0, y: 1, z: 0 }, label: "C" },
  { id: "edge-ab", type: "edge3", pointIds: ["vertex-a", "vertex-b"], label: "AB" },
  { id: "face-abc", type: "face3", pointIds: ["vertex-a", "vertex-b", "vertex-c"], label: "ABC" },
  { id: "line-free", type: "line3", definition: { kind: "throughPoints", pointIds: ["vertex-b", "vertex-c"] }, label: "空间直线 1" }
]

const measurements: Measurement3[] = [
  { id: "measurement3-1", kind: "measurement3", sourceIds: ["vertex-a", "vertex-b"], metric: "distance", value: 1, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "由两个空间点 vertex-a、vertex-b 的坐标计算距离。" }
]

describe("algebra view spatial tree", () => {
  it("nests vertices, edges and faces under an expandable solid row", () => {
    const onSelect = vi.fn()
    render(<AlgebraView primitives={primitives} measurements={measurements} workspace="geometry3d" selectedIds={[]} onSelect={onSelect} onToggle={() => {}} />)

    expect(screen.queryByText("顶点")).toBeNull()
    expect(screen.queryByText("A")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }))

    expect(screen.getByText("顶点")).toBeTruthy()
    expect(screen.getByText("棱")).toBeTruthy()
    expect(screen.getByText("面")).toBeTruthy()
    expect(screen.getByText("A")).toBeTruthy()
    expect(screen.getByText("空间直线 1")).toBeTruthy()

    fireEvent.click(screen.getByText("A"))
    expect(onSelect).toHaveBeenCalledWith("vertex-a", false)
  })

  it("collapses the subtree again", () => {
    render(<AlgebraView primitives={primitives} measurements={[]} workspace="geometry3d" selectedIds={[]} onSelect={() => {}} onToggle={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" }))
    fireEvent.click(screen.getByRole("button", { name: "收起 立方体 1 拓扑 的子对象" }))

    expect(screen.queryByText("顶点")).toBeNull()
  })

  it("toggles visibility for the solid group itself", () => {
    const onToggle = vi.fn()
    render(<AlgebraView primitives={primitives} measurements={[]} workspace="geometry3d" selectedIds={[]} onSelect={() => {}} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole("button", { name: "隐藏 立方体 1 拓扑" }))

    expect(onToggle).toHaveBeenCalledWith("solid-cube-1", false)
  })

  it("lists measurements with their source explanation", () => {
    render(<AlgebraView primitives={primitives} measurements={measurements} workspace="geometry3d" selectedIds={[]} onSelect={() => {}} onToggle={() => {}} />)

    expect(screen.getByText("距离测量")).toBeTruthy()
    expect(screen.getByText("由两个空间点 vertex-a、vertex-b 的坐标计算距离。")).toBeTruthy()
    expect(screen.getByText("vertex-a、vertex-b · 数值近似")).toBeTruthy()
  })

  it("keeps a flat object list for planar workspaces", () => {
    render(<AlgebraView primitives={[{ id: "point-1", type: "point", x: 0, y: 0, label: "点 1" }]} selectedIds={[]} onSelect={() => {}} onToggle={() => {}} />)

    expect(screen.queryByRole("button", { name: /子对象/ })).toBeNull()
    expect(screen.getByText("点 1")).toBeTruthy()
  })
})

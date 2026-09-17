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

  /**
   * 用户要求："立体里的圆相关的内容不要这么多标点啊，只需要四个点就够了。"
   * 圆柱 / 圆锥近似的细分顶点（带 `tessellation` 标记）不是用户对象：它们仍在文档里支撑面 / 棱 /
   * 交线计算，但对象列表不该把它们列出来——48 段圆柱会一次冒出 88 行。
   */
  it("keeps tessellation vertices of a round solid out of the object list", () => {
    const tessellated: PrimitiveSpec[] = [
      { id: "cylinder-1", type: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48, label: "圆柱 1" },
      {
        id: "solid-cylinder-1",
        type: "polyhedron3",
        vertexIds: ["quad-a", "quad-b", "hidden-1", "hidden-2"],
        edgeIds: ["edge-quad", "edge-generatrix"],
        faceIds: ["face-quad"],
        construction: { kind: "template", templateId: "cylinder", sourceIds: ["cylinder-1"] }
      },
      { id: "quad-a", type: "point3", position: { x: 2, y: 0, z: 0 }, label: "A" },
      { id: "quad-b", type: "point3", position: { x: 0, y: 2, z: 0 }, label: "B" },
      { id: "hidden-1", type: "point3", position: { x: 1, y: 1, z: 0 }, tessellation: true },
      { id: "hidden-2", type: "point3", position: { x: -1, y: 1, z: 0 }, tessellation: true },
      { id: "edge-quad", type: "edge3", pointIds: ["quad-a", "quad-b"], label: "棱 1" },
      { id: "edge-generatrix", type: "edge3", pointIds: ["quad-a", "hidden-1"], tessellation: true },
      { id: "face-quad", type: "face3", pointIds: ["quad-a", "quad-b", "hidden-1"], label: "面 1" }
    ]
    render(<AlgebraView primitives={tessellated} measurements={[]} workspace="geometry3d" selectedIds={[]} onSelect={() => {}} onToggle={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "展开 圆柱 1 拓扑 的子对象" }))

    expect(screen.getByText("A")).toBeTruthy()
    expect(screen.getByText("B")).toBeTruthy()
    // 两个细分顶点既不在列表里，也不该留一个空壳分组。
    expect(globalThis.document.querySelectorAll('[data-object-type="point3"]')).toHaveLength(2)
    // 母线同理："有太多母线，用不上这些"——48 段圆柱的 48 条母线一条都不该出现在列表里。
    expect(globalThis.document.querySelectorAll('[data-object-type="edge3"]')).toHaveLength(1)
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

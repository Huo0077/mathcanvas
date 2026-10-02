import * as THREE from "three"
import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { createSolidGroup, createSolidMesh, visibleSolids } from "./threePrimitives"

/**
 * 球的**渲染**（实施计划 Task 5 的单元那一半）。
 *
 * 三条判据，每条都对着一个具体的坏结果：
 * ① **不许出现经纬网**：`EdgesGeometry(SphereGeometry)` 会把球面拆成几十条"棱"——它们看得见、
 *    也**选得中**，于是用户点球面会选到一条虚构的边。spec 明确不要"密集的可选中经纬线"。
 * ② **文档里没有网格**：渲染对象按球心/半径现搭，`.mgeo` 只存 `{center, radius}`。所以
 *    "改网格密度会不会改文档"这个问题在结构上就不成立 —— 这里把它钉住，防止有人把网格塞进图元。
 * ③ **位置就是球心**：圆柱/圆锥要把 y 抬 `height/2`（它们的 `center` 是底面中心），球不是 ——
 *    照抄那条偏移会让球整体上移半个半径。
 */

const SPHERE = { id: "sphere-1", type: "sphere" as const, center: { x: 1, y: 2, z: 3 }, radius: 5 }

describe("sphere rendering", () => {
  it("draws the sphere itself and nothing that could be mistaken for a wireframe", () => {
    const group = createSolidGroup(SPHERE, false)

    const own = group.children.filter((child) => child.userData.primitiveId === "sphere-1")
    expect(own.length).toBeGreaterThan(0)
    expect(own.some((child) => child.userData.primitiveType === "sphere")).toBe(true)

    // 一条线都不该有：球没有棱，画出来的任何"棱"都是网格的经纬线。
    expect(group.children.filter((child) => (child as THREE.LineSegments).isLineSegments)).toHaveLength(0)
    expect(group.children.filter((child) => child.userData.primitiveType === "edge3")).toHaveLength(0)
  })

  it("keeps the wireframe away even when hidden edges or normals are switched on", () => {
    const group = createSolidGroup(SPHERE, false, { showHiddenEdges: true, showNormals: true })

    expect(group.children.filter((child) => (child as THREE.LineSegments).isLineSegments)).toHaveLength(0)
    // 显示法向是另一回事（它是三个箭头，不是球面的边），仍然照常显示。
    expect(group.children.some((child) => child.userData.visualRole === "normal")).toBe(true)
  })

  it("puts the mesh at the sphere centre with the document radius, and never at centre + radius/2", () => {
    const mesh = createSolidMesh(SPHERE, false)

    expect(mesh.position.toArray()).toEqual([1, 2, 3])
    expect(mesh.userData).toMatchObject({ primitiveId: "sphere-1", primitiveType: "sphere" })
    const geometry = mesh.geometry as THREE.SphereGeometry
    expect(geometry.type).toBe("SphereGeometry")
    expect(geometry.parameters.radius).toBe(5)
    expect(geometry.parameters.widthSegments).toBeGreaterThan(8)
    expect(geometry.parameters.heightSegments).toBeGreaterThan(8)
  })

  it("survives a save/reopen unchanged, because the mesh lives only in the render layer", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ ...SPHERE }]

    expect(visibleSolids(document).map((primitive) => primitive.id)).toEqual(["sphere-1"])
    // 图元上没有几何缓存字段：网格是画布现搭的，文档只认球心与半径。
    const stored = visibleSolids(document)[0]
    expect(Object.keys(stored).sort()).toEqual(["center", "id", "radius", "type"])
  })

  it("drops a hidden sphere while keeping a visible one — the filter is per object, not all-or-nothing", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ ...SPHERE }, { ...SPHERE, id: "sphere-2", visible: false }]

    // 反向对照：只留下可见的那一个。少了它，"把球整个排除在 visibleSolids 之外"也能让下面那句变绿。
    expect(visibleSolids(document).map((primitive) => primitive.id)).toEqual(["sphere-1"])
    expect(visibleSolids({ ...document, primitives: [{ ...SPHERE, visible: false }] })).toHaveLength(0)
  })
})

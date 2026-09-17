import { describe, expect, it } from "vitest"
import * as THREE from "three"

import type { IntersectionSolidPrimitive } from "@draw/dsl"

import { createIntersectionSolidGroup } from "./threePrimitives"

/** 两个交叠立方体的布尔交集：x∈[0,2]、y∈[-2,2]、z∈[-2,2] 的长方体。 */
const solid = (): IntersectionSolidPrimitive => ({
  id: "intersectionSolid-1",
  type: "intersectionSolid",
  sourceIds: ["cube-a", "cube-b"],
  vertices: [
    { x: 0, y: -2, z: -2 }, { x: 2, y: -2, z: -2 }, { x: 2, y: 2, z: -2 }, { x: 0, y: 2, z: -2 },
    { x: 0, y: -2, z: 2 }, { x: 2, y: -2, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }
  ],
  faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  volume: 32,
  area: 64,
  status: "polyhedron",
  label: "交面 1"
})

const faces = (group: THREE.Object3D): THREE.Mesh[] => {
  const found: THREE.Mesh[] = []
  group.traverse((object) => {
    // 组本身也挂着同一个 visualRole（和图元一致）；这里只要面片。
    if (object instanceof THREE.Mesh && object.userData.visualRole === "intersection-solid") found.push(object)
  })
  return found
}

const opacityOf = (group: THREE.Object3D): number => {
  const material = faces(group)[0].material
  return (Array.isArray(material) ? material[0] : material).opacity
}

describe("已创建的交面图元怎么画", () => {
  it("draws every face of the boolean intersection, pickable and translucent", () => {
    const group = createIntersectionSolidGroup(solid(), false)!

    expect(faces(group)).toHaveLength(6)
    // 面片可拾取：点了它才算"选中这个交面图元"，否则创建出来就点不到了。
    expect(faces(group).every((mesh) => mesh.userData.primitiveId === "intersectionSolid-1")).toBe(true)
    // 半透明：交面常常嵌在别的实体里，不透明会把它后面的东西全挡掉。
    expect(opacityOf(group)).toBeLessThan(0.5)
    // 描边：没有棱的话，半透明的多面体在深色面上看不出形状。
    let edges = 0
    group.traverse((object) => { if (object.userData.visualRole === "intersection-solid-edge") edges += 1 })
    expect(edges).toBe(1)
  })

  it("makes the selected intersection solid more solid", () => {
    expect(opacityOf(createIntersectionSolidGroup(solid(), true)!)).toBeGreaterThan(opacityOf(createIntersectionSolidGroup(solid(), false)!))
  })

  it("draws nothing for an empty intersection instead of a placeholder", () => {
    // 来源不再相交时重算出来的交面是空的：画一个占位形状会让"已经没有了"看起来像还在。
    expect(createIntersectionSolidGroup({ ...solid(), vertices: [], faces: [] }, false)).toBeNull()
  })
})

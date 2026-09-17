import { describe, expect, it } from "vitest"
import * as THREE from "three"

import type { IntersectionFacePrimitive, IntersectionPoint3Primitive, IntersectionSolidPrimitive } from "@draw/dsl"

import { createIntersectionFaceGroup, createIntersectionPointGroup, createIntersectionSolidGroup } from "./threePrimitives"

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

describe("已创建的交面 / 交点图元怎么画", () => {
  const face = (): IntersectionFacePrimitive => ({
    id: "intersectionFace-1",
    type: "intersectionFace",
    sourceIds: ["cube-a", "cube-b"],
    points: [{ x: 0, y: -2, z: -2 }, { x: 2, y: -2, z: -2 }, { x: 2, y: -2, z: 2 }, { x: 0, y: -2, z: 2 }],
    normal: { x: 0, y: -1, z: 0 },
    area: 8,
    hint: { x: 1, y: -2, z: 0 },
    status: "valid",
    label: "交面 1"
  })

  const point = (): IntersectionPoint3Primitive => ({
    id: "intersectionPoint3-1",
    type: "intersectionPoint3",
    sourceIds: ["cube-a", "cube-b"],
    position: { x: 2, y: -2, z: 2 },
    hint: { x: 2, y: -2, z: 2 },
    status: "valid",
    label: "交点 1"
  })

  const roleOf = (object: THREE.Object3D, role: string): THREE.Object3D[] => {
    const found: THREE.Object3D[] = []
    object.traverse((child) => { if (child.userData.visualRole === role) found.push(child) })
    return found
  }

  it("draws one 交面 as a filled patch plus its outline, and honours the user's fill colour", () => {
    const group = createIntersectionFaceGroup(face(), false)!

    const patches = roleOf(group, "intersection-face")
    expect(patches).toHaveLength(1)
    expect(patches[0].userData.primitiveId).toBe("intersectionFace-1")
    expect(roleOf(group, "intersection-face-edge")).toHaveLength(1)

    // 用户反馈："我需要一个交面内部填充颜色可以更改的功能"——填色必须真的来自图元样式。
    const styled = createIntersectionFaceGroup({ ...face(), style: { fill: "#22cc88", opacity: 0.5, stroke: "#0044ff" } }, false)!
    const patch = roleOf(styled, "intersection-face")[0] as THREE.Mesh
    const material = (Array.isArray(patch.material) ? patch.material[0] : patch.material) as THREE.MeshBasicMaterial
    expect(material.color.getHexString()).toBe("22cc88")
    expect(material.opacity).toBeCloseTo(0.5, 6)
    const edge = roleOf(styled, "intersection-face-edge")[0] as THREE.LineSegments
    expect((edge.material as THREE.LineBasicMaterial).color.getHexString()).toBe("0044ff")
  })

  it("draws nothing for a 交面 without a usable ring instead of a placeholder", () => {
    expect(createIntersectionFaceGroup({ ...face(), points: [] }, false)).toBeNull()
  })

  it("draws one 交点 as a pickable handle-sized marker", () => {
    const group = createIntersectionPointGroup(point(), false)!

    expect(group.userData.primitiveId).toBe("intersectionPoint3-1")
    expect(group.userData.primitiveType).toBe("intersectionPoint3")
    expect(group.position.x).toBeCloseTo(2, 6)
    expect(group.position.y).toBeCloseTo(-2, 6)
    expect(group.position.z).toBeCloseTo(2, 6)
    // 选中时换个颜色，和空间点手柄同一套视觉语言。
    const selected = createIntersectionPointGroup(point(), true)!
    expect((selected.material as THREE.MeshBasicMaterial).color.getHexString()).not.toBe(((group.material) as THREE.MeshBasicMaterial).color.getHexString())
  })
})

describe("已创建的交集整体（旧文档仍要画得出来）", () => {
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

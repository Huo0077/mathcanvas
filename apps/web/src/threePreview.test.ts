import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"

import { createPreviewGroup, disposeObject } from "./threePrimitives"
import type { ThreeScenePreview } from "./threeScenePreview"

/**
 * 虚线预览要画什么。
 *
 * 用户反馈："我需要的是交面、交线和交点，而不是创建对象之后中间出现一个大截面。"
 * 于是单实体被选中时，预览**只画那圈交线（切出来的边界）与它的交点**，
 * 不再铺一块半透明剖切面盖在图形中间——那块面片属于"创建出来的截面"（交面），
 * 创建之后才出现；交线两端 / 环上的顶点则正是用户要看到的交点。
 */

const roles = (group: THREE.Object3D): string[] => {
  const found: string[] = []
  group.traverse((object) => {
    const role = object.userData.visualRole
    if (typeof role === "string") found.push(role)
  })
  return found
}

const countRole = (group: THREE.Object3D, role: string): number => roles(group).filter((value) => value === role).length

const sectionPreview = (): ThreeScenePreview => ({
  key: "section:cube-1",
  kind: "section",
  sourceIds: ["cube-1"],
  segments: [],
  points: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }],
  label: "默认剖切平面截面 · 3 边形",
  plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
  sourceId: "cube-1"
})

const intersectionPreview = (): ThreeScenePreview => ({
  key: "pair:cube-a|cube-b:线",
  kind: "intersection",
  sourceIds: ["cube-a", "cube-b"],
  segments: [
    { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } },
    { a: { x: 1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 1 } }
  ],
  points: [],
  label: "面交线 · 2 段"
})

/** 两个交叠立方体的布尔交集：x∈[0,2]、y∈[-2,2]、z∈[-2,2] 的长方体。 */
const solidPreview = (): ThreeScenePreview => ({
  key: "pair:cube-a|cube-b:面",
  kind: "solid",
  sourceIds: ["cube-a", "cube-b"],
  segments: [],
  points: [],
  vertices: [
    { x: 0, y: -2, z: -2 }, { x: 2, y: -2, z: -2 }, { x: 2, y: 2, z: -2 }, { x: 0, y: 2, z: -2 },
    { x: 0, y: -2, z: 2 }, { x: 2, y: -2, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }
  ],
  faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  volume: 32,
  area: 64,
  label: "交面 · 6 面"
})

/** 取第一个带该角色的材质的透明度（用来断言面片是半透明的，不是一块挡视线的实心面）。 */
const opacityOfRole = (group: THREE.Object3D, role: string): number | null => {
  let opacity: number | null = null
  group.traverse((object) => {
    if (object.userData.visualRole !== role || opacity !== null) return
    const mesh = object as THREE.Mesh
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (material) opacity = material.opacity
  })
  return opacity
}

describe("虚线预览的画法", () => {
  it("draws the cut boundary and its vertices, and no filled cut plane", () => {
    const group = createPreviewGroup(sectionPreview(), true, () => undefined)
    const found = roles(group)

    expect(found).toContain("intersection-preview-line")
    expect(found).not.toContain("section-preview-plane")
    // 三角环 → 3 个交点标记（闭合用的重复点只算一次）
    expect(countRole(group, "intersection-preview-point")).toBe(3)
  })

  it("marks the endpoints of an intersection line", () => {
    const group = createPreviewGroup(intersectionPreview(), true, () => undefined)

    expect(countRole(group, "intersection-preview-line")).toBe(1)
    // 两段共享一个端点 → 3 个交点
    expect(countRole(group, "intersection-preview-point")).toBe(3)
  })

  it("fills an intersection solid as a translucent patch with its own edges and vertices", () => {
    const group = createPreviewGroup(solidPreview(), false, () => undefined)

    // 交面预览画的是**重叠区域本身**：半透明面片 + 面环 + 顶点（交点）。
    expect(countRole(group, "intersection-preview-face")).toBe(6)
    expect(countRole(group, "intersection-preview-edge")).toBeGreaterThan(0)
    expect(countRole(group, "intersection-preview-point")).toBe(8)
    const opacity = opacityOfRole(group, "intersection-preview-face")
    expect(opacity).not.toBeNull()
    // 半透明：交面是"还没创建"的提示，不能像创建出来的实体那样挡住图形。
    expect(opacity!).toBeLessThan(0.5)
    expect(group.userData.excludeFromFit).toBe(true)
  })

  it("highlights the patch under the pointer and keeps it clickable either way", () => {
    const idle = createPreviewGroup(solidPreview(), false, () => undefined)
    const hovered = createPreviewGroup(solidPreview(), true, () => undefined)

    // 指针落在交面上时更实一点，但仍然不是不透明（其余交面还在底下要看得到）。
    expect(opacityOfRole(hovered, "intersection-preview-face")!).toBeGreaterThan(opacityOfRole(idle, "intersection-preview-face")!)
    /**
     * 命中区与悬停状态解耦：点击时**按点击位置重新判定**，如果命中区只在"已经悬停"时才存在，
     * 就变成先有鸡还是先有蛋——原地点击（没有 pointermove）永远命中不了。
     */
    expect((idle.userData.hitTargets as THREE.Object3D[]).length).toBe(6)
    expect((hovered.userData.hitTargets as THREE.Object3D[]).length).toBe(6)
  })

  it("keeps the preview out of picking and out of the fit bounds", () => {
    const group = createPreviewGroup(sectionPreview(), true, () => undefined)

    expect(group.userData.excludeFromFit).toBe(true)
    const markers: THREE.Object3D[] = []
    group.traverse((object) => {
      if (object.userData.visualRole === "intersection-preview-point") markers.push(object)
    })
    // 交点标记只是画给人看的，不能抢走点击（点击由不可见的命中带负责）。
    for (const marker of markers) expect(marker.raycast({} as never, [] as never)).toBeUndefined()
  })

  it("does not free the shared marker resources when one preview group goes away", () => {
    /**
     * 所有预览的交点标记共用同一份几何与材质（`previewPointGeometry` / `previewPointMaterial`）。
     * 多份预览同时存在时，重建 / 移除**一份**不能把还在被其它预览使用的共享资源释放掉
     *（单份预览时代几乎不会触发，改成列表之后动一个来源就会重建它相关的每一对）。
     */
    const group = createPreviewGroup(intersectionPreview(), false, () => undefined)
    const markers: THREE.Mesh[] = []
    group.traverse((object) => {
      if (object.userData.visualRole === "intersection-preview-point") markers.push(object as THREE.Mesh)
    })
    expect(markers.length).toBeGreaterThan(0)
    const geometry = markers[0].geometry
    const material = markers[0].material as THREE.Material
    const geometryDispose = vi.spyOn(geometry, "dispose")
    const materialDispose = vi.spyOn(material, "dispose")

    disposeObject(group)

    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    // 自己那份几何（虚线、命中带）照旧要释放：那是每份预览各自分配的。
    const line = [...(group.children as THREE.Object3D[])].find((child) => child.userData.visualRole === "intersection-preview-line") as THREE.Line | undefined
    expect(line?.geometry.attributes.position).toBeTruthy()
  })
})

import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { createPreviewGroup } from "./threePrimitives"
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
  kind: "section",
  segments: [],
  points: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }],
  label: "默认剖切平面截面 · 3 边形",
  plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
  sourceId: "cube-1"
})

const intersectionPreview = (): ThreeScenePreview => ({
  kind: "intersection",
  segments: [
    { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } },
    { a: { x: 1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 1 } }
  ],
  points: [],
  label: "面交线 · 2 段"
})

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
})

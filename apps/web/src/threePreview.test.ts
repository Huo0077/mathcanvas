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
  label: "交线 · 2 段"
})

/** 交集的**一个面**（y=-2 那一面，4 个顶点、面积 8）——交面预览就是"一个表面"，不是整只盒子。 */
const facePreview = (): ThreeScenePreview => ({
  key: "pair:cube-a|cube-b:面0",
  kind: "face",
  sourceIds: ["cube-a", "cube-b"],
  segments: [],
  points: [{ x: 0, y: -2, z: -2 }, { x: 2, y: -2, z: -2 }, { x: 2, y: -2, z: 2 }, { x: 0, y: -2, z: 2 }],
  normal: { x: 0, y: -1, z: 0 },
  area: 8,
  hint: { x: 1, y: -2, z: 0 },
  label: "交面 · 4 边形（面积 8.00）"
})

/** 交线的拐点（交点预览）。 */
const pointPreview = (): ThreeScenePreview => ({
  key: "pair:cube-a|cube-b:点0",
  kind: "point",
  sourceIds: ["cube-a", "cube-b"],
  segments: [],
  points: [],
  position: { x: 2, y: -2, z: 2 },
  hint: { x: 2, y: -2, z: 2 },
  label: "交点"
})

/**
 * 曲面区域（圆柱侧带）的交面预览：`points` 是"外环 + 另一圈**反向**缝合"的多边形，
 * `outerRingLength` 是前导外环的顶点数。这里用 8 段的两个圆环做一个最小可算的样本
 * （上环 z=+1 逆着角度递增走一圈，下环 z=−1 反向缝在后面）。
 */
const BAND_SEGMENTS = 8
const BAND_RADIUS = 2
const BAND_HALF = 1

const bandPreview = (): ThreeScenePreview => {
  const hoop = (z: number) => Array.from({ length: BAND_SEGMENTS }, (_, index) => {
    const angle = (index * Math.PI * 2) / BAND_SEGMENTS
    return { x: BAND_RADIUS * Math.cos(angle), y: BAND_RADIUS * Math.sin(angle), z }
  })
  const bottom = hoop(-BAND_HALF)
  return {
    key: "pair:cube-a|cyl-a:面2",
    kind: "face",
    sourceIds: ["cube-a", "cyl-a"],
    segments: [],
    points: [...hoop(BAND_HALF), ...Array.from({ length: BAND_SEGMENTS }, (_, index) => bottom[BAND_SEGMENTS - 1 - index])],
    outerRingLength: BAND_SEGMENTS,
    normal: { x: 0, y: 0, z: 1 },
    area: 2 * Math.PI * BAND_RADIUS * (2 * BAND_HALF),
    hint: { x: 0, y: 0, z: 0 },
    label: "交面 · 圆柱面（面积 50.27，网格近似）"
  }
}

/** 面片网格的三角形顶点（非索引几何，三个一组）。 */
const trianglesOf = (mesh: THREE.Mesh): { x: number; y: number; z: number }[][] => {
  const attribute = mesh.geometry.getAttribute("position")
  const triangles: { x: number; y: number; z: number }[][] = []
  for (let index = 0; index + 2 < attribute.count; index += 3) {
    triangles.push([0, 1, 2].map((offset) => ({ x: attribute.getX(index + offset), y: attribute.getY(index + offset), z: attribute.getZ(index + offset) })))
  }
  return triangles
}

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

  it("fills one 交面 as a single translucent patch with its own edges and vertices", () => {
    const group = createPreviewGroup(facePreview(), false, () => undefined)

    /**
     * 交面预览画的是**一个表面**（用户口径："我需要的交面只是一个表面，而不是所有相交的表面"）：
     * 一块半透明面片 + 它自己那圈边 + 4 个顶点，而不是整只交集的 6 个面。
     */
    expect(countRole(group, "intersection-preview-face")).toBe(1)
    expect(countRole(group, "intersection-preview-edge")).toBe(1)
    expect(countRole(group, "intersection-preview-point")).toBe(4)
    const opacity = opacityOfRole(group, "intersection-preview-face")
    expect(opacity).not.toBeNull()
    // 半透明：交面是"还没创建"的提示，不能像创建出来的实体那样挡住图形。
    expect(opacity!).toBeLessThan(0.5)
    expect(group.userData.excludeFromFit).toBe(true)
    // 面片本身就是命中区：点"这一块面"即创建这一面的交面图元。
    expect((group.userData.hitTargets as THREE.Object3D[]).length).toBe(1)
  })

  it("fills a curved 交面 preview as a ring strip between its hoops, not as a fan across the hole", () => {
    /**
     * 曲面区域的预览面片就是**命中区**：扇形三角化会把两圈之间的洞整块填掉，于是"鼠标落在洞上"
     * 也算落在这块交面上——高亮的位置和使用者看到的那条带子对不上。所以和创建出来的交面一样，
     * 缝合带必须按环向条带三角化（同一套配对规则）。
     */
    const group = createPreviewGroup(bandPreview(), false, () => undefined)
    const mesh = group.children.find((child) => child.userData.visualRole === "intersection-preview-face") as THREE.Mesh | undefined
    expect(mesh).toBeTruthy()

    const triangles = trianglesOf(mesh!)
    // 8 条环向边各缝两片，且**每一片都跨在两圈之间**（z 跨满 −1…+1）。
    expect(triangles).toHaveLength(2 * BAND_SEGMENTS)
    for (const triangle of triangles) {
      const zs = triangle.map((vertex) => vertex.z)
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2 * BAND_HALF, 6)
    }
  })

  it("marks the corners of a planar 交面 preview but no mesh vertex of a curved one", () => {
    /**
     * 平面区域：预览的顶点就是这一面的拐角，四个都标出来（与既有行为一致）。
     */
    expect(countRole(createPreviewGroup(facePreview(), false, () => undefined), "intersection-preview-point")).toBe(4)

    /**
     * 曲面区域（缝合带）：`points` 是网格多边形（48 段侧带 = 96 个顶点），那些点**不是**任何几何意义上的
     * 交点——把每个网格顶点都标成点，画布上就是两圈密密麻麻的点（与既有口径冲突："光滑交线一个采样点
     * 都不标"），缝合处那两个拐角也只是我们拼接多边形的接缝。真正的交点标记由**交线**预览负责。
     */
    expect(countRole(createPreviewGroup(bandPreview(), false, () => undefined), "intersection-preview-point")).toBe(0)
  })

  it("fills a cone-like 交面 preview around its pole, and marks no vertices on it", () => {
    /**
     * 圆锥侧面那种区域：`points[0]` 是**极点**（锥尖，在曲面内部、不在边界环上）。预览面片就是命中区，
     * 按边界环铺会把它填成底面那团圆盘——点圆锥侧面命中的是那张圆盘，曲面照样拿不到。
     */
    const hoop = Array.from({ length: BAND_SEGMENTS }, (_, index) => {
      const angle = (index * Math.PI * 2) / BAND_SEGMENTS
      return { x: BAND_RADIUS * Math.cos(angle), y: BAND_RADIUS * Math.sin(angle), z: -BAND_HALF }
    })
    const conePreview: ThreeScenePreview = {
      ...bandPreview(),
      key: "pair:cone-a|cyl-a:面0",
      points: [{ x: 0, y: 0, z: BAND_HALF }, ...hoop],
      poleIndex: 0,
      outerRingLength: undefined,
      label: "交面 · 圆锥面（面积 20.11，网格近似）"
    }
    const group = createPreviewGroup(conePreview, false, () => undefined)
    const mesh = group.children.find((child) => child.userData.visualRole === "intersection-preview-face") as THREE.Mesh | undefined
    const triangles = trianglesOf(mesh!)

    // 每条底面边与极点围一片 ⇒ 8 片，且每片恰有一个顶点在极点上。
    expect(triangles).toHaveLength(BAND_SEGMENTS)
    for (const triangle of triangles) expect(triangle.filter((vertex) => Math.abs(vertex.z - BAND_HALF) < 1e-6)).toHaveLength(1)
    // 曲面区域不标网格顶点（避免"密密麻麻的点"），极点也不算交点。
    expect(countRole(group, "intersection-preview-point")).toBe(0)
    // 虚线边界也不含极点：只有底面那 8 条边。
    const edge = group.children.find((child) => child.userData.visualRole === "intersection-preview-edge") as THREE.LineSegments
    const positions = edge.geometry.getAttribute("position")
    for (let vertex = 0; vertex < positions.count; vertex += 1) expect(positions.getZ(vertex)).toBeCloseTo(-BAND_HALF, 6)
  })

  it("draws one 交点 as a marker with its own hit area", () => {
    const group = createPreviewGroup(pointPreview(), false, () => undefined)

    expect(countRole(group, "intersection-preview-point")).toBe(1)
    // 只有一个点，按像素点它太小：命中区要更宽一点（不可见的球），否则"点交点"是在找针。
    expect(countRole(group, "intersection-preview-hit")).toBe(1)
    expect((group.userData.hitTargets as THREE.Object3D[]).length).toBe(1)
    // 标记本身不参与拾取。
    const marker = group.children.find((child) => child.userData.visualRole === "intersection-preview-point")
    expect(marker?.raycast({} as never, [] as never)).toBeUndefined()
  })

  it("highlights the patch and the marker under the pointer, and keeps them clickable either way", () => {
    const idle = createPreviewGroup(facePreview(), false, () => undefined)
    const hovered = createPreviewGroup(facePreview(), true, () => undefined)

    // 指针落在交面上时更实一点，但仍然不是不透明（其余交面还在底下要看得到）。
    expect(opacityOfRole(hovered, "intersection-preview-face")!).toBeGreaterThan(opacityOfRole(idle, "intersection-preview-face")!)
    /**
     * 命中区与悬停状态解耦：点击时**按点击位置重新判定**，如果命中区只在"已经悬停"时才存在，
     * 就变成先有鸡还是先有蛋——原地点击（没有 pointermove）永远命中不了。
     */
    expect((idle.userData.hitTargets as THREE.Object3D[]).length).toBe(1)
    expect((hovered.userData.hitTargets as THREE.Object3D[]).length).toBe(1)

    // 交点标记的高亮靠放大：小圆点变实心很难分辨，放大一圈更直观。
    const idleMarker = createPreviewGroup(pointPreview(), false, () => undefined).children.find((child) => child.userData.visualRole === "intersection-preview-point")
    const hoveredMarker = createPreviewGroup(pointPreview(), true, () => undefined).children.find((child) => child.userData.visualRole === "intersection-preview-point")
    expect(hoveredMarker!.scale.x).toBeGreaterThan(idleMarker!.scale.x)
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

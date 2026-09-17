import { describe, expect, it } from "vitest"
import * as THREE from "three"

import type { IntersectionFacePrimitive, IntersectionPoint3Primitive, IntersectionSolidPrimitive } from "@draw/dsl"
import { circleConic3 } from "@draw/geometry-kernel"

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

  /**
   * 曲面区域（圆柱 / 圆锥侧带）的多边形：外环在前、其余环**反向**缝合在后，配对规则是
   * `points[长度 − 1 − i] ↔ points[i]`（内核 `outerRingLength` 就是前导外环的顶点数）。
   *
   * 这里用 8 段的两个圆环做一个最小可算的样本：上环（z=+1）逆着角度递增走一圈，下环（z=−1）反向
   * 缝在后面（`tail[j] = bottom[L − 1 − j]`，最后一个点与 `points[0]` 同一个环向角 ⇒ 收尾边是一条母线）。
   */
  const RING_SEGMENTS = 8
  const RING_RADIUS = 2
  const RING_HALF_HEIGHT = 1
  const hoop = (z: number): { x: number; y: number; z: number }[] => Array.from({ length: RING_SEGMENTS }, (_, index) => {
    const angle = (index * Math.PI * 2) / RING_SEGMENTS
    return { x: RING_RADIUS * Math.cos(angle), y: RING_RADIUS * Math.sin(angle), z }
  })
  const bandPoints = (): { x: number; y: number; z: number }[] => {
    const top = hoop(RING_HALF_HEIGHT)
    const bottom = hoop(-RING_HALF_HEIGHT)
    return [...top, ...Array.from({ length: RING_SEGMENTS }, (_, index) => bottom[RING_SEGMENTS - 1 - index])]
  }
  const bandFace = (): IntersectionFacePrimitive => ({
    ...face(),
    id: "intersectionFace-band",
    points: bandPoints(),
    outerRingLength: RING_SEGMENTS,
    normal: { x: 0, y: 0, z: 1 },
    area: 2 * Math.PI * RING_RADIUS * (2 * RING_HALF_HEIGHT),
    areaExact: false
  })

  /** 网格的三角形顶点（非索引几何，三个一组）。 */
  const trianglesOf = (mesh: THREE.Mesh): { x: number; y: number; z: number }[][] => {
    const attribute = mesh.geometry.getAttribute("position")
    const triangles: { x: number; y: number; z: number }[][] = []
    for (let index = 0; index + 2 < attribute.count; index += 3) {
      triangles.push([0, 1, 2].map((offset) => ({ x: attribute.getX(index + offset), y: attribute.getY(index + offset), z: attribute.getZ(index + offset) })))
    }
    return triangles
  }

  const triangleArea = (triangle: { x: number; y: number; z: number }[]): number => {
    const [first, second, third] = triangle
    const ab = { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z }
    const ac = { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z }
    return Math.hypot(ab.y * ac.z - ab.z * ac.y, ab.z * ac.x - ab.x * ac.z, ab.x * ac.y - ab.y * ac.x) / 2
  }

  it("fills a merged curved region as a ring strip between its two hoops, not as a fan across the hole", () => {
    const group = createIntersectionFaceGroup(bandFace(), false, 0.001)!
    const patches = roleOf(group, "intersection-face")
    expect(patches).toHaveLength(1)
    const triangles = trianglesOf(patches[0] as THREE.Mesh)

    // 8 段两个环 ⇒ 8 条环向边各缝两片三角形。
    expect(triangles).toHaveLength(2 * RING_SEGMENTS)
    /**
     * 条带的**每一片都跨在两圈之间**（z 跨满 −1…+1）。扇形三角化里绝大多数片只落在一圈上
     * （z 跨度为 0），还会横穿圆柱内部——这条断言就是那样失败的。
     */
    for (const triangle of triangles) {
      const zs = triangle.map((vertex) => vertex.z)
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2 * RING_HALF_HEIGHT, 6)
    }
    // 面积 = 内接多边形的侧带面积（周长 × 高），与文档里的网格近似面积同一口径。
    const stripArea = 2 * RING_RADIUS * Math.sin(Math.PI / RING_SEGMENTS) * RING_SEGMENTS * 2 * RING_HALF_HEIGHT
    expect(triangles.reduce((sum, triangle) => sum + triangleArea(triangle), 0)).toBeCloseTo(stripArea, 4)

    // 平面区域（凸多边形，没有拼接）仍然走扇形：4 边形 = 2 片三角形。
    const flat = trianglesOf(roleOf(createIntersectionFaceGroup(face(), false)!, "intersection-face")[0] as THREE.Mesh)
    expect(flat).toHaveLength(2)
  })

  it("fills a cone-like region around its pole instead of painting its base disc", () => {
    /**
     * 圆锥侧面那种区域：边界只有底面那圈圆，**极点**（锥尖）在曲面内部、不在边界环上。
     *
     * 只按边界环扇形铺的话，这张"圆锥面"会被填成底面那团圆盘——用户反馈"交出一大堆面，但是无法获取
     * 那个曲面"，一半的原因就在这里（另一半是内核压根没把这种区域分出来）。所以填充必须绕极点铺开。
     */
    const coneFace = (): IntersectionFacePrimitive => ({
      ...face(),
      id: "intersectionFace-cone",
      points: [{ x: 0, y: 0, z: 2 }, ...hoop(0)],
      poleIndex: 0,
      normal: { x: 0, y: 0, z: 1 },
      area: RING_SEGMENTS * 0.5 * 2 * RING_RADIUS * 2 * Math.sin(Math.PI / RING_SEGMENTS),
      areaExact: false
    })

    const group = createIntersectionFaceGroup(coneFace(), false)!
    const triangles = trianglesOf(roleOf(group, "intersection-face")[0] as THREE.Mesh)

    // 8 条底面边各与极点围一片三角形（不是"从底圆第一点扇形铺开"的 6 片底面三角片）。
    expect(triangles).toHaveLength(RING_SEGMENTS)
    for (const triangle of triangles) {
      // 每片都含极点（0,0,2），另两个顶点在底面上。
      expect(triangle.some((vertex) => Math.hypot(vertex.x, vertex.y) < 1e-6 && Math.abs(vertex.z - 2) < 1e-6)).toBe(true)
      expect(triangle.filter((vertex) => Math.abs(vertex.z) < 1e-6)).toHaveLength(2)
    }
    // 面积是**锥面**的面积（比底面圆盘大），不是底面圆盘那一块。
    const meshLateral = triangles.reduce((sum, triangle) => sum + triangleArea(triangle), 0)
    expect(meshLateral).toBeGreaterThan(Math.PI * RING_RADIUS * RING_RADIUS)

    // 极点**不是边界上的点**：多边形兜底的边界只画底面那 8 条边。
    const polygon = roleOf(createIntersectionFaceGroup({ ...coneFace(), poleIndex: 0 }, false)!, "intersection-face-edge")[0] as THREE.LineSegments
    const positions = polygon.geometry.getAttribute("position")
    expect(positions.count).toBe(RING_SEGMENTS * 2)
    for (let vertex = 0; vertex < positions.count; vertex += 1) expect(Math.abs(positions.getZ(vertex))).toBeLessThan(1e-6)
  })

  it("tessellates a curved region by screen error and snaps every vertex onto the true surface", () => {
    /**
     * 用户口径："我需要的只是那个相交的曲面，但是在我们的图里面，相交那个曲面是由很多三角形拼出来的。"
     *
     * 区域的多边形来自**网格**（默认 48 段），照它铺出来就是一圈平面三角形：默认缩放下能看出竖条纹、
     * 放大后侧影是多边形。给了 `surface` + 屏幕误差容差之后，每个三角形按需均分、每个新顶点都吸到
     * 真正的曲面上——弦高 ≤ 容差，画面上就是一条光滑曲面（与 A1 的"真圆"同一套思路）。
     */
    const cylinder = { kind: "cylinder" as const, origin: { x: 0, y: 0, z: -RING_HALF_HEIGHT }, axis: { x: 0, y: 0, z: 1 }, radius: RING_RADIUS, height: 2 * RING_HALF_HEIGHT }
    const coarse = createIntersectionFaceGroup(bandFace(), false, 0.001)!
    const smooth = createIntersectionFaceGroup({ ...bandFace(), surface: cylinder }, false, 0.001)!
    const coarseTriangles = trianglesOf(roleOf(coarse, "intersection-face")[0] as THREE.Mesh)
    const smoothTriangles = trianglesOf(roleOf(smooth, "intersection-face")[0] as THREE.Mesh)

    // 容差 0.001、R=2：8 段的弦高 2(1−cos(π/8))≈0.152 ⇒ 需要 √(0.152/0.001)≈13 份 ⇒ 明显多于粗网格。
    expect(smoothTriangles.length).toBeGreaterThan(coarseTriangles.length)
    /**
     * 关键性质：**每个顶点都落在真正的圆柱面上**（径向恰好 R）。粗网格的顶点本来也在圆上，但它的面片
     * 是弦（中点离曲面 0.152 远）；细分之后每片都贴着曲面——这才是"不是由三角形拼出来的"。
     */
    for (const triangle of smoothTriangles) {
      for (const vertex of triangle) expect(Math.abs(Math.hypot(vertex.x, vertex.y) - RING_RADIUS)).toBeLessThan(1e-6)
    }
    // 每片的最大弦高 ≤ 容差（这里按"面片质心吸回曲面后的偏差 ≤ 容差"等价量测）。
    const worstSagitta = smoothTriangles.reduce((worst, triangle) => {
      const centroid = { x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3, y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3, z: (triangle[0].z + triangle[1].z + triangle[2].z) / 3 }
      const radial = Math.hypot(centroid.x, centroid.y)
      return Math.max(worst, radial > 1e-9 ? Math.abs(radial - RING_RADIUS) : 0)
    }, 0)
    expect(worstSagitta).toBeLessThan(0.001)
    // 没有曲面定义时保持原样的网格铺法（旧文档 / 平面区域行为不变）。
    expect(coarseTriangles).toHaveLength(2 * RING_SEGMENTS)
  })

  it("draws the created 交面's analytic boundary as real circles when the document carries exactLoops", () => {
    const loops = [RING_HALF_HEIGHT, -RING_HALF_HEIGHT].map((z) => {
      const conic = circleConic3({ x: 0, y: 0, z }, { x: 0, y: 0, z: 1 }, RING_RADIUS)!
      return [{ kind: "conic" as const, conic, parameterRange: [0, Math.PI * 2] as [number, number] }]
    })
    const group = createIntersectionFaceGroup({ ...bandFace(), exactLoops: loops }, false, 0.001)!

    const edges = roleOf(group, "intersection-face-edge")
    // 两圈各一条**真曲线**（`THREE.Line`），不是一圈 8 段弦（`LineSegments`）。
    expect(edges).toHaveLength(2)
    for (const [index, edge] of edges.entries()) {
      expect(edge).toBeInstanceOf(THREE.Line)
      expect(edge).not.toBeInstanceOf(THREE.LineSegments)
      const attribute = (edge as THREE.Line).geometry.getAttribute("position")
      // R=2、tol=0.001 ⇒ 100 段：远多于原来那 8 段弦，而且每个顶点都**落在圆上**（弦的端点也在圆上，
      // 所以关键是多出来的那些点全都在半径 2 上）。
      expect(attribute.count).toBeGreaterThan(RING_SEGMENTS * 2)
      expect(edge.userData.segmentCount).toBe(attribute.count - 1)
      for (let vertex = 0; vertex < attribute.count; vertex += 1) {
        expect(Math.abs(Math.hypot(attribute.getX(vertex), attribute.getY(vertex)) - RING_RADIUS)).toBeLessThan(1e-6)
        expect(attribute.getZ(vertex)).toBeCloseTo(loops[index][0].conic.center!.z, 6)
      }
    }
    // 填色照旧在：解析边界只换**边界**，不换填充（填充仍是网格多边形，拾取/面积要它）。
    expect(roleOf(group, "intersection-face")).toHaveLength(1)

    // 没给容差（或容差不可用）时如实退回多边形边界：绝不拿 NaN / 无穷去采样。
    const polygon = roleOf(createIntersectionFaceGroup({ ...bandFace(), exactLoops: loops }, false)!, "intersection-face-edge")
    expect(polygon).toHaveLength(1)
    expect(polygon[0]).toBeInstanceOf(THREE.LineSegments)
    expect(roleOf(createIntersectionFaceGroup({ ...bandFace(), exactLoops: loops }, false, Number.NaN)!, "intersection-face-edge")[0]).toBeInstanceOf(THREE.LineSegments)
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

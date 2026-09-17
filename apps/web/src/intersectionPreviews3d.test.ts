import * as THREE from "three"
import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument, type Vector3 } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { computeIntersectionPreviews3d, intersectionMarkerPoints } from "./intersectionPreviews3d"
import { ROUND_SOLID_SEGMENTS } from "./solidDefaults"
import { toScenePreview } from "./threeScenePreview"
import { createPreviewGroup } from "./threePrimitives"

/** 一份"实体源 + 物化拓扑"一起进文档的文档：与 App 创建实体的方式一致。 */
function cubeDocument(solids: { id: string; origin: Vector3; size?: Vector3 }[]): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = solids.flatMap((solid) => {
    const primitive = { id: solid.id, type: "cube" as const, origin: solid.origin, size: solid.size ?? { x: 4, y: 4, z: 4 } }
    return [primitive, ...buildSolidTemplate(primitive).primitives]
  })
  return document
}

/** 圆类实体（圆柱）：用来验证"曲面相交时交点标记不能按折线顶点密密麻麻地标"。 */
function cylinderDocument(solids: { id: string; center: Vector3; rotation?: Vector3 }[]): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = solids.flatMap((solid) => {
    const primitive = { id: solid.id, type: "cylinder" as const, center: solid.center, radius: 2, height: 6, segments: ROUND_SOLID_SEGMENTS, rotation: solid.rotation }
    return [primitive, ...buildSolidTemplate(primitive).primitives]
  })
  return document
}

const overlapPair = [{ id: "cube-a", origin: { x: -2, y: -2, z: -2 } }, { id: "cube-b", origin: { x: 0, y: -2, z: -2 } }]

describe("automatic 3D intersection previews", () => {
  it("enumerates every overlapping pair without any selection", () => {
    const result = computeIntersectionPreviews3d(cubeDocument([...overlapPair, { id: "cube-far", origin: { x: 40, y: -2, z: -2 } }]))

    // 交叠区间是 x∈[0,2]、y∈[-2,2]、z∈[-2,2]：交集的每一面都各自是一份可点预览。
    const faces = result.previews.filter((preview) => preview.kind === "face")
    expect(faces.length).toBeGreaterThan(0)
    expect(faces.every((preview) => preview.sourceIds.join() === "cube-a,cube-b")).toBe(true)
    // 离得远的那一对不该出现在画布上：它是噪声，且会白白算一遍布尔交集。
    expect(result.previews.some((preview) => preview.sourceIds.includes("cube-far"))).toBe(false)
    expect(result.candidates).toBe(3)
  })

  it("gives a crossing pair a 交线 preview plus one clickable preview per 交面 and per 交点", () => {
    const result = computeIntersectionPreviews3d(cubeDocument(overlapPair))

    const line = result.previews.find((preview) => preview.kind === "intersection")
    expect(line?.sourceIds).toEqual(["cube-a", "cube-b"])
    expect(line?.segments.length).toBeGreaterThan(0)
    expect(line?.label).toContain("交线")

    /**
     * 交面是**一个表面**（用户口径："我需要的交面只是一个表面，而不是所有相交的表面"）：
     * 交集的每一面各自是一份可点预览，而不是整只半透明盒子。
     * 交叠区间是 2×4×4：两个 4×4 的切口面（16）与四个 2×4 的侧面（8），面积和 = 64。
     */
    const faces = result.previews.filter((preview) => preview.kind === "face")
    expect(faces).toHaveLength(6)
    expect(faces.map((preview) => preview.points.length)).toEqual([4, 4, 4, 4, 4, 4])
    expect(faces.reduce((total, preview) => total + preview.area, 0)).toBeCloseTo(64, 6)
    expect(faces.some((preview) => Math.abs(preview.area - 16) < 1e-6)).toBe(true)
    expect(faces.some((preview) => Math.abs(preview.area - 8) < 1e-6)).toBe(true)
    // 每份面预览都带着"我该被建成哪一面"的形心（点击创建时写进 `hint`），key 也各自独立。
    const bottom = faces.find((preview) => Math.abs(preview.area - 8) < 1e-6 && preview.points.every((point) => Math.abs(point.y + 2) < 1e-6))
    expect(bottom?.hint.y).toBeCloseTo(-2, 6)
    expect(faces.every((preview) => preview.key.startsWith("pair:cube-a|cube-b:面"))).toBe(true)

    // 交点是交线的拐点：交叠区那一圈矩形有 8 个拐点（x=0 与 x=2 各 4 个）。
    const points = result.previews.filter((preview) => preview.kind === "point")
    expect(points).toHaveLength(8)
    expect(points.every((preview) => preview.label === "交点")).toBe(true)
    for (const point of points) {
      expect(Math.abs(point.position.x) < 1e-6 || Math.abs(point.position.x - 2) < 1e-6).toBe(true)
    }
  })

  /**
   * 用户口径："当两个图形相交时，我们不仅需要能获取交面的图元，也要突出交线和交点的图元。"
   * 圆类实体（圆柱 / 圆锥）的交线是**光滑折线**（48 段近似），旧实现把每个顶点都标成一个交点，
   * 一对圆柱会冒出上百个点标记。用户后续拍板："只标真正的角点（转折 ≥ 18°），光滑交线不标点"——
   * 于是这种交线只剩交线与交面可点，不再有"沿交线均匀取样"补出来的圆点。
   */
  it("leaves a smooth round-solid crossing without 交点 markers", () => {
    const result = computeIntersectionPreviews3d(cylinderDocument([
      { id: "cyl-a", center: { x: 0, y: 0, z: 0 } },
      { id: "cyl-b", center: { x: 0, y: 0, z: 0 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
    ]))

    // 交线与交面照旧突出：交线有很多小段（光滑），交面至少一个面片。
    const line = result.previews.find((preview) => preview.kind === "intersection")
    expect(line).toBeDefined()
    expect(line!.segments.length).toBeGreaterThan(20)
    expect(result.previews.some((preview) => preview.kind === "face")).toBe(true)

    // 一个采样点都没有：剩下的只有"交线拐到底面圆环上"的真角点，而且都落在圆柱底面圆的边上。
    const points = result.previews.filter((preview) => preview.kind === "point")
    expect(points.length).toBeLessThanOrEqual(4)
    expect(points.every((preview) => Math.abs(Math.hypot(preview.position.x, preview.position.y) - 2) < 1e-6)).toBe(true)
    // 截断计数同样不该把它算成"没画全"。
    expect(result.truncatedPoints).toBe(0)
  })

  it("marks the corners of a crossing and nothing on a smooth one", () => {
    const ring = (count: number, radius: number, z: number) => Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count
      return { a: { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z }, b: { x: radius * Math.cos(angle + Math.PI * 2 / count), y: radius * Math.sin(angle + Math.PI * 2 / count), z } }
    })
    const rectangle = [
      { a: { x: 0, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 } },
      { a: { x: 2, y: 0, z: 0 }, b: { x: 2, y: 2, z: 0 } },
      { a: { x: 2, y: 2, z: 0 }, b: { x: 0, y: 2, z: 0 } },
      { a: { x: 0, y: 2, z: 0 }, b: { x: 0, y: 0, z: 0 } }
    ]

    // 矩形的四个角：与旧行为一致。
    const corners = intersectionMarkerPoints(rectangle)
    expect(corners).toHaveLength(4)
    expect(corners.every((point) => (point.x === 0 || point.x === 2) && (point.y === 0 || point.y === 2))).toBe(true)

    // 24 边形（每段转 15° < 18° 阈值）处处光滑 → 一个标记都不给。
    expect(intersectionMarkerPoints(ring(24, 2, 0))).toEqual([])
    // 48 段（圆柱 / 圆锥的默认精度，每段转 7.5°）同理。
    expect(intersectionMarkerPoints(ring(48, 2, 0))).toEqual([])
    // 稀疏的六边形（每段转 60°）处处是角点 → 每个顶点都算，且受上限约束。
    expect(intersectionMarkerPoints(ring(6, 2, 0))).toHaveLength(6)
    expect(intersectionMarkerPoints(ring(6, 2, 0), { maxMarkers: 4 })).toHaveLength(4)
    // 阈值是参数：调到 5° 时 15° 的转折也算角点（上限同时放开）。
    expect(intersectionMarkerPoints(ring(24, 2, 0), { turnThresholdDegrees: 5, maxMarkers: 100 })).toHaveLength(24)
    expect(intersectionMarkerPoints([])).toEqual([])
  })

  it("reports a contained solid as 交面 previews without inventing a 交线 or a 交点", () => {
    const result = computeIntersectionPreviews3d(cubeDocument([
      { id: "cube-outer", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-inner", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    ]))

    // 公共部分是里面那个立方体：它的 6 个面都可见可点（面积 6×4 = 24）。
    const faces = result.previews.filter((preview) => preview.kind === "face")
    expect(faces).toHaveLength(6)
    expect(faces.reduce((total, preview) => total + preview.area, 0)).toBeCloseTo(24, 6)
    // 但两个表面根本不相交：不能编出交线，也不能编出交点。
    expect(result.previews.filter((preview) => preview.kind === "intersection")).toEqual([])
    expect(result.previews.filter((preview) => preview.kind === "point")).toEqual([])
  })

  it("skips pairs whose boxes do not touch", () => {
    const result = computeIntersectionPreviews3d(cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 40, y: -2, z: -2 } }
    ]))

    expect(result.previews).toEqual([])
    expect(result.skippedPairs).toBe(1)
  })

  it("reuses unchanged pairs instead of recomputing them on every document change", () => {
    const document = cubeDocument(overlapPair)
    const first = computeIntersectionPreviews3d(document)
    expect(first.computedPairs).toBe(1)
    expect(first.reusedPairs).toBe(0)

    const second = computeIntersectionPreviews3d(document, { previous: first.cache })
    expect(second.computedPairs).toBe(0)
    expect(second.reusedPairs).toBe(1)
    expect(second.previews).toEqual(first.previews)

    // 动了一个来源：这一对必须重算，且交面跟着新位置变（x 方向重叠由 2 变成 3）。
    const moved = cubeDocument([overlapPair[0], { id: "cube-b", origin: { x: -1, y: -2, z: -2 } }])
    const third = computeIntersectionPreviews3d(moved, { previous: second.cache })
    expect(third.computedPairs).toBe(1)
    // 交叠区间变成 3×4×4：4×4 的切口面变成 16，2×4 的侧面变成 3×4 = 12。
    const areas = third.previews.filter((preview) => preview.kind === "face").map((preview) => preview.area)
    expect(areas.filter((area) => Math.abs(area - 16) < 1e-6)).toHaveLength(2)
    expect(areas.filter((area) => Math.abs(area - 12) < 1e-6)).toHaveLength(4)

    // 彻底挪开：预览消失（包围盒先筛掉，连交线都不用算）。
    const apart = cubeDocument([overlapPair[0], { id: "cube-b", origin: { x: 40, y: -2, z: -2 } }])
    const fourth = computeIntersectionPreviews3d(apart, { previous: third.cache })
    expect(fourth.previews).toEqual([])
    expect(fourth.skippedPairs).toBe(1)
  })

  it("caps how many boolean intersections a single sweep computes", () => {
    // 三个两两交叠的立方体：3 对都有交集，但布尔交集只允许算 1 对。
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const result = computeIntersectionPreviews3d(document, { maxBooleanPairs: 1 })

    // 只有第一对拿到了"算布尔交集"的配额，所以只有它的 6 个面出现在画布上。
    expect(result.previews.filter((preview) => preview.kind === "face")).toHaveLength(6)
    expect(result.truncatedPairs).toBe(2)
    // 交线不受封顶影响：它是"哪里相交"的基本信息，画出来很便宜。
    expect(result.previews.filter((preview) => preview.kind === "intersection").length).toBeGreaterThan(1)
  })

  it("caps the faces of a single pair and says that pair was cut short", () => {
    const result = computeIntersectionPreviews3d(cubeDocument(overlapPair), { maxFacesPerPair: 2 })

    // 一个立方体对立方体的交集有 6 个面，只画前 2 个；"这一对没画全"必须能被说出来。
    expect(result.previews.filter((preview) => preview.kind === "face")).toHaveLength(2)
    expect(result.truncatedPairs).toBe(1)
  })

  it("gives a capped pair its 交面 back as soon as the budget allows", () => {
    // 三个两两交叠的立方体：3 对都有交面，但配额只允许算 1 对。
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const first = computeIntersectionPreviews3d(document, { maxBooleanPairs: 1 })
    expect(first.previews.filter((preview) => preview.kind === "face")).toHaveLength(6)
    expect(first.truncatedPairs).toBe(2)

    /**
     * 换一次配额再扫：被挤掉的那两对必须能补上。
     * 受限的结果一旦按"完整结果"缓存下来，它们就会**永久**只剩交线——即使配额腾出来了也回不来。
     */
    const second = computeIntersectionPreviews3d(document, { previous: first.cache, maxBooleanPairs: 3 })
    expect(second.previews.filter((preview) => preview.kind === "face")).toHaveLength(18)
    expect(second.truncatedPairs).toBe(0)
  })

  it("keeps the cap stable across sweeps and keeps reporting what it could not compute", () => {
    const document = cubeDocument([
      { id: "cube-a", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-b", origin: { x: 0, y: -2, z: -2 } },
      { id: "cube-c", origin: { x: 1, y: -2, z: -2 } }
    ])
    const first = computeIntersectionPreviews3d(document, { maxBooleanPairs: 2 })
    expect(first.previews.filter((preview) => preview.kind === "face")).toHaveLength(12)

    // 第二次扫描（文档没变）：沿用的交面同样占配额，因此结果与第一次逐字节一致，
    // 截断说明也必须**每次都报**——不然用户看到"有一对相交却没有面片"却没有任何解释。
    const second = computeIntersectionPreviews3d(document, { previous: first.cache, maxBooleanPairs: 2 })
    expect(second.previews.filter((preview) => preview.kind === "face")).toHaveLength(12)
    expect(second.truncatedPairs).toBe(1)
    expect(second.previews).toEqual(first.previews)
  })

  it("counts a capped pair that has no crossing line at all", () => {
    // 完全包含：两个表面根本不相交，所以连交线都没有——它被配额挤掉时同样是"少了一处交面"，
    // 不能因为没有交线就不计数（那样用户完全看不到解释）。
    const document = cubeDocument([
      { id: "cube-outer", origin: { x: -2, y: -2, z: -2 } },
      { id: "cube-inner", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    ])
    const result = computeIntersectionPreviews3d(document, { maxBooleanPairs: 0 })

    expect(result.previews).toEqual([])
    expect(result.truncatedPairs).toBe(1)
  })

  it("groups a cylinder's 50 mesh patches into three clickable 交面 previews", () => {
    /**
     * 本片存在的理由（A2）：立方体 ∩ 圆柱的布尔交集按网格面片铺预览是 **50 份**——
     * 48 个侧面细条（法向各不相同，逐面预览既吃配额又让用户点不到"那一整块"）+ 2 个圆盘。
     * 按支撑曲面分组之后只剩 **3 份**：一个圆柱侧带 + 两个端面圆盘。
     */
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    // 圆柱底面 z=-3、高 6（顶面 z=3）：立方体 z∈[-2,2] 正好从中间切出一段高 4 的侧带。
    const cylinder = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: -3 }, radius: 2, height: 6, segments: ROUND_SOLID_SEGMENTS }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, cylinder, ...buildSolidTemplate(cylinder).primitives]

    const result = computeIntersectionPreviews3d(document)
    const faces = result.previews.filter((preview) => preview.kind === "face")

    expect(faces).toHaveLength(3)
    // 一个区域一份预览，key 仍是 `pair:<a>|<b>:面<i>`（i 是区域序号）。
    expect(faces.map((preview) => preview.key)).toEqual(["pair:cube-a|cyl-a:面0", "pair:cube-a|cyl-a:面1", "pair:cube-a|cyl-a:面2"])
    expect(result.truncatedPairs).toBe(0)
    // 面积降序：曲面侧带最大（48 个网格面片求和 ≈ 50.23，如实标"网格近似"），两个圆盘各是精确的 π·2²。
    expect(faces[0].label).toContain("圆柱面")
    expect(faces[0].label).toContain("网格近似")
    expect(Math.abs(faces[0].area - 2 * Math.PI * 2 * 4) / (2 * Math.PI * 2 * 4)).toBeLessThan(0.001)
    for (const disc of faces.slice(1)) {
      expect(Math.abs(disc.area - Math.PI * 4)).toBeLessThan(1e-9)
      expect(Math.abs(disc.normal.z)).toBeCloseTo(1, 12)
    }
    // 每份都还是可点面片：顶点环参与填充与拾取（曲面区域是**整条带**的缝合多边形，两圈首尾相接）。
    expect(faces.every((preview) => preview.points.length >= 3)).toBe(true)
    expect(faces.every((preview) => preview.hint.x === preview.points.reduce((sum, point) => sum + point.x / preview.points.length, 0))).toBe(true)
  })

  it("keeps the browser fixture (cube + contained cylinder) at three 交面 previews", () => {
    /**
     * `e2e/three-intersection-previews.spec.ts` 用的文档：立方体 4×4×4 + 完全落在它里面的圆柱（R=1.5, h=4）。
     * 浏览器那边读的是 `data-preview-face-count`；把"应该是 3"先钉在单元测试里，
     * e2e 就只是在核验同一件事在真实画布上没有被渲染层改掉。
     */
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const cylinder = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: -2 }, radius: 1.5, height: 4, segments: ROUND_SOLID_SEGMENTS }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, cylinder, ...buildSolidTemplate(cylinder).primitives]

    const faces = computeIntersectionPreviews3d(document).previews.filter((preview) => preview.kind === "face")

    expect(faces).toHaveLength(3)
    expect(faces.map((preview) => preview.key)).toEqual(["pair:cube-a|cyl-a:面0", "pair:cube-a|cyl-a:面1", "pair:cube-a|cyl-a:面2"])
    // 侧带是**整条带**的多边形（两圈各 48 个点），形心落在侧带中腰而不是圆心——这正是"点侧带建出整条带"的前提。
    expect(faces[0].points).toHaveLength(2 * ROUND_SOLID_SEGMENTS)
    expect(faces[0].hint.z).toBeCloseTo(0, 9)
    expect(Math.abs(faces[0].hint.x) + Math.abs(faces[0].hint.y)).toBeLessThan(1e-9)
    expect(Math.abs(faces[0].area - 2 * Math.PI * 1.5 * 4) / (2 * Math.PI * 1.5 * 4)).toBeLessThan(0.001)
  })

  it("makes the lateral band preview clickable from ordinary viewpoints, unlike a single hoop", () => {
    /**
     * "点得到"这件事要**测出来**，不能只靠读代码推理。
     *
     * 用画布同一套 `createPreviewGroup` 把侧带那份预览建成真正的网格（命中区就是它的面片），再从一台普通
     * 透视相机朝侧带表面上的世界点打射线（与画布拾取同一套射线：只打命中区）。对照组是修复前的行为——
     * `points` 只有最大的那一圈环。
     */
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const cylinder = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: -2 }, radius: 1.5, height: 4, segments: ROUND_SOLID_SEGMENTS }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, cylinder, ...buildSolidTemplate(cylinder).primitives]

    const band = computeIntersectionPreviews3d(document).previews.filter((preview) => preview.kind === "face")[0]

    /** 多少个"相机方位 × 侧带上的世界点"真的能点到这份预览的命中区。 */
    const clickHits = (points: Vector3[]): number => {
      const group = createPreviewGroup(toScenePreview({ ...band, points }, []), false, () => undefined)
      const targets = (group.userData.hitTargets as THREE.Object3D[] | undefined) ?? []
      if (targets.length === 0) return 0
      const raycaster = new THREE.Raycaster()
      let hits = 0
      for (let step = 0; step < 12; step += 1) {
        const azimuth = step * Math.PI / 6
        const eye = new THREE.Vector3(Math.cos(azimuth) * 10, Math.sin(azimuth) * 10, 5)
        // 只试朝向相机那一侧的点（背面的点本来就被实体挡住，不参与"点得到"的判定）。
        for (const offset of [-1, -0.5, 0, 0.5, 1]) {
          for (const z of [-1, 0, 1]) {
            const angle = azimuth + offset * Math.PI / 6
            const target = new THREE.Vector3(1.5 * Math.cos(angle), 1.5 * Math.sin(angle), z)
            raycaster.set(eye, target.clone().sub(eye).normalize())
            if (raycaster.intersectObjects(targets, false).length > 0) hits += 1
          }
        }
      }
      return hits
    }

    const total = 12 * 5 * 3
    const stitched = clickHits(band.points)
    const hoopOnly = clickHits(band.points.slice(0, ROUND_SOLID_SEGMENTS))

    // 缝合后的侧带多边形在大多数视角下都点得到（实测 122/180）；只给一圈环则大多点不到、命中数只有它的一半
    //（实测 60/180——它的填充是那一圈弦围出来的圆盘，覆盖不到侧带中腰）。
    expect(stitched).toBeGreaterThan(hoopOnly)
    expect(stitched).toBeGreaterThanOrEqual(total / 2)
  })

  it("counts the per-pair 交面 quota by regions, not by mesh patches", () => {
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const cylinder = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: -3 }, radius: 2, height: 6, segments: ROUND_SOLID_SEGMENTS }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, cylinder, ...buildSolidTemplate(cylinder).primitives]

    // 这一对有 3 个区域，只允许画 2 个：多出来的那一块必须被如实报成"交面没画全"。
    const result = computeIntersectionPreviews3d(document, { maxFacesPerPair: 2 })

    expect(result.previews.filter((preview) => preview.kind === "face")).toHaveLength(2)
    expect(result.truncatedPairs).toBe(1)
  })

  it("groups the App 默认圆柱（center x=3）as well, not only an origin-centered one", () => {
    /**
     * App 新建的圆柱是 `center:{x:3,y:0,z:0}`（`addDefaultSolid`），圆锥在 `{x:-3,y:0,z:3}`：
     * 分组用的"顶点是否在二次曲面上"必须按**世界坐标的 bounds 帧**判，不能按 `quadric3FromPrimitive` 的矩阵
     * （实测那是个局部矩阵：真曲面点 (4.5,0,1) 上 `quadricValueAt = 18` 而不是 0）。
     */
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: 1, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const cylinder = { id: "cyl-a", type: "cylinder" as const, center: { x: 3, y: 0, z: -3 }, radius: 2, height: 6, segments: ROUND_SOLID_SEGMENTS }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, cylinder, ...buildSolidTemplate(cylinder).primitives]

    const faces = computeIntersectionPreviews3d(document).previews.filter((preview) => preview.kind === "face")

    expect(faces).toHaveLength(3)
    expect(faces[0].label).toContain("圆柱面")
    // 侧带的兜底环仍然绕在 x=3 那根轴上（世界坐标）。
    expect(faces[0].points.every((point) => Math.abs(Math.hypot(point.x - 3, point.y) - 2) < 1e-9)).toBe(true)
  })

  it("no longer lets a 48-segment cylinder's tessellation eat the 交面 budget", () => {
    /**
     * 圆柱是**多边形近似**：按网格面片铺预览时，默认分段数（48）直接决定预算——
     * 上限比"48 个侧面 + 两个底面"还小时用户就会看到"交面没画全"。
     * 按支撑曲面分组之后，分段数不再进预算：这一对只有 3 个区域（一个侧带 + 两个端面）。
     */
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const cylinder = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: -1 }, radius: 1.5, height: 2, segments: ROUND_SOLID_SEGMENTS }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, cylinder, ...buildSolidTemplate(cylinder).primitives]

    const result = computeIntersectionPreviews3d(document)

    expect(ROUND_SOLID_SEGMENTS).toBeGreaterThanOrEqual(48)
    expect(result.truncatedPairs).toBe(0)
    expect(result.previews.filter((preview) => preview.kind === "face")).toHaveLength(3)
  })

  it("gives 圆柱 ∩ 圆锥 one 圆锥面 preview instead of 48 triangle patches (user-reported)", () => {
    /**
     * 用户实测反馈："曲面交面相当乱，交出一大堆面，但是无法获取那个曲面。"
     *
     * 实测：圆锥整体落在圆柱里（两者同底同高）时，布尔交集就是圆锥自己——48 个侧面三角形 + 1 个底面圆盘。
     * 修复前这 48 片**一片都认不出属于圆锥面**（锥尖在轴上：`radiusAt` 的 `ratio > 0` 把顶点判成"不在面上"，
     * 而顶点的 `atan2(0,0)` 又把张角量成 93°…116°），于是画布上有 49 份"交面"预览，全是小三角，
     * 点哪一块都拿不到那张曲面；修复后是 **2 份**：一张圆锥面 + 一个底面圆盘。
     */
    const document = createEmptyDocument("geometry3d")
    const cylinder = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 1.5, height: 4, segments: ROUND_SOLID_SEGMENTS }
    const cone = { id: "cone-a", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: 1.5, height: 4, segments: ROUND_SOLID_SEGMENTS }
    document.primitives = [cylinder, ...buildSolidTemplate(cylinder).primitives, cone, ...buildSolidTemplate(cone).primitives]

    const result = computeIntersectionPreviews3d(document)
    const faces = result.previews.filter((preview) => preview.kind === "face")

    expect(faces).toHaveLength(2)
    expect(faces[0].label).toContain("圆锥面")
    expect(faces[0].label).toContain("网格近似")
    expect(faces[1].label).toContain("48 边形")
    // 曲面区域知道自己的前导外环有多长（渲染方靠它按环向条带填充）。
    expect(faces[0].outerRingLength).toBeUndefined() // 圆锥这个区域的边界只有底面那一圈
    expect(result.truncatedPairs).toBe(0)
  })

  it("only treats top-level solids as candidates", () => {
    const document = cubeDocument(overlapPair)
    // 模板物化出来的 point3/edge3/face3/polyhedron3 与面、平面都不该参与自动求交：
    // 一个立方体自己就有 6 个面，按面两两求交会瞬间刷出几十条噪声交线。
    document.primitives = [...document.primitives,
      { id: "face-1", type: "face3", pointIds: ["cube-a-point-1", "cube-a-point-2", "cube-a-point-3"] },
      { id: "plane-1", type: "plane3", definition: { kind: "pointNormal", pointId: "cube-a-point-1", normal: { x: 0, y: 0, z: 1 } } } as never
    ]
    const result = computeIntersectionPreviews3d(document)

    expect(result.candidates).toBe(2)
    expect(result.previews.every((preview) => !preview.sourceIds.includes("face-1") && !preview.sourceIds.includes("plane-1"))).toBe(true)
  })
})

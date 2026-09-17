import { describe, expect, it } from "vitest"

import { intersectConvexPolyhedra3, type Polyhedron3Input, type SolidIntersectionResult } from "./boolean3d"
import { mergeIntersectionSurfaces3, type IntersectionSurfaceRegion } from "./intersection-surfaces"
import { coneQuadric3, conic3PointAt, cylinderQuadric3, type Quadric3 } from "./quadrics"
import type { CurvePiece3 } from "./section-quadric"

/**
 * 交面按支撑曲面分组的验收（A2）。
 *
 * 用户口径："重要的问题还在交面上，圆柱和立方体交面会被切成很多个片，这样很不合理。"
 * 实测：立方体(4×4×4) ∩ 圆柱(R=2, h=6, 48 段) 的布尔交集有 **50 个面片**——
 * 2 个圆盘（12.5305）+ 48 个侧面细条（1.0465 × 48），那 48 个细条**法向各不相同**，
 * 所以"合并共面片"一片都减不掉。分组必须按**支撑曲面**做，下面每条用例钉住一件事实。
 */

const CUBE_ORIGIN = { x: -2, y: -2, z: -2 }
const CUBE_SIZE = 4
const RADIUS = 2
const HEIGHT = 6
const SEGMENTS = 48
/** 圆柱底面在 z=-3、顶面在 z=3：立方体（z∈[-2,2]）从中间切出一段高 4 的侧带。 */
const BASE_Z = -3
/** 立方体 z=±2 两个切面之间的侧带高度。 */
const CUT_HEIGHT = 4

const cylinderPrimitive = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: BASE_Z }, radius: RADIUS, height: HEIGHT, segments: SEGMENTS }
const cylinderQuadric = cylinderQuadric3(cylinderPrimitive)

/** 立方体（`origin` 是**角点**，与 DSL 的 `cube` 一致；内核的布尔交集的输入就是顶点表 + 面索引环）。 */
function cubePolyhedron(origin = CUBE_ORIGIN, size = CUBE_SIZE): Polyhedron3Input {
  const low = origin
  const high = { x: origin.x + size, y: origin.y + size, z: origin.z + size }
  const corner = (x: 0 | 1, y: 0 | 1, z: 0 | 1) => ({ x: x === 0 ? low.x : high.x, y: y === 0 ? low.y : high.y, z: z === 0 ? low.z : high.z })
  return {
    vertices: [corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0), corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1)],
    faces: [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
  }
}

/** 圆柱的多面体近似：与 `solid-builders.ts` 的 `buildCylinder` 逐点同源（角度从 +x 起、逆时针）。 */
function cylinderPolyhedron(radius = RADIUS, height = HEIGHT, segments = SEGMENTS, baseZ = BASE_Z): Polyhedron3Input {
  const ring = (z: number) => Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z }
  })
  const vertices = [...ring(baseZ), ...ring(baseZ + height)]
  const faces: number[][] = [
    Array.from({ length: segments }, (_, index) => segments - 1 - index),
    Array.from({ length: segments }, (_, index) => segments + index)
  ]
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments
    faces.push([index, next, segments + next, segments + index])
  }
  return { vertices, faces }
}

/** 圆锥的多面体近似：与 `buildCone` 同源（底面环 + 顶点，侧面是三角形）。 */
function conePolyhedron(radius = RADIUS, height = HEIGHT, segments = SEGMENTS, baseZ = BASE_Z): Polyhedron3Input {
  const base = Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: baseZ }
  })
  const vertices = [...base, { x: 0, y: 0, z: baseZ + height }]
  const faces: number[][] = [Array.from({ length: segments }, (_, index) => segments - 1 - index)]
  for (let index = 0; index < segments; index += 1) faces.push([index, (index + 1) % segments, segments])
  return { vertices, faces }
}

/** 来源描述：立方体没有解析二次曲面，圆柱有一张（web 层给的正是 `quadric3FromPrimitive` 的结果）。 */
function sources(quadric: Quadric3 | undefined = cylinderQuadric): { quadric?: Quadric3 }[] {
  return [{ quadric: undefined }, { quadric }]
}

/** 立方体 ∩ 圆柱：本片的主角（50 个面片的那一对）。 */
function cubeCylinderIntersection(): SolidIntersectionResult {
  return intersectConvexPolyhedra3(cubePolyhedron(), cylinderPolyhedron())
}

/** 只覆盖半圈的那种切法：立方体只留 x ≥ 0 的一半，侧带被 x=0 平面在**母线**方向切断。 */
function halfCylinderIntersection(): SolidIntersectionResult {
  return intersectConvexPolyhedra3(cubePolyhedron({ x: 0, y: -2, z: -2 }, CUBE_SIZE), cylinderPolyhedron())
}

const bandOf = (regions: IntersectionSurfaceRegion[]) => regions.find((region) => region.kind === "cylinder")!
const discsOf = (regions: IntersectionSurfaceRegion[]) => regions.filter((region) => region.kind === "plane")

const distance = (first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) =>
  Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)

/** 采样一个片段（含两端）：参数在 `parameterRange` 上等分。 */
function samplePiece(piece: CurvePiece3, steps = 8): { x: number; y: number; z: number }[] {
  if (piece.kind === "segment") return [piece.a, piece.b]
  const [from, to] = piece.parameterRange
  return Array.from({ length: steps + 1 }, (_, index) => conic3PointAt(piece.conic, from + (to - from) * (index / steps))!).filter(Boolean)
}

function pieceEndpoints(piece: CurvePiece3): { x: number; y: number; z: number }[] {
  if (piece.kind === "segment") return [piece.a, piece.b]
  return [conic3PointAt(piece.conic, piece.parameterRange[0])!, conic3PointAt(piece.conic, piece.parameterRange[1])!]
}

type Triple = { x: number; y: number; z: number }

/**
 * 缝合多边形的**有向带面积**。
 *
 * "外环在前、其余环反向接上"的意思就是：后半段的第 `i` 个点落在 `points[len − 1 − i]`。把这个拼接
 * 三角化（每条环向边与下一圈对应边之间两片三角形）就是这个多边形张成的带面。
 *
 * 非平面的多环多边形没有唯一的"面积"；能说清的就是它张成的那条带面——圆柱侧带 = `2πRh′`。
 * 圆柱轴是 z，所以"朝外"就是 `(x, y, 0)` 方向；符号用来说清这个多边形有没有缝反。
 */
function stitchedBandArea(points: Triple[], ringLength: number): number {
  const cross = (first: Triple, second: Triple): Triple => ({ x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x })
  const take = (from: Triple, to: Triple): Triple => ({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z })
  const signed = (a: Triple, b: Triple, c: Triple): number => {
    const normal = cross(take(a, b), take(a, c))
    const length = Math.hypot(normal.x, normal.y, normal.z)
    const radial = Math.hypot((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)
    if (length <= 0 || radial <= 0) return 0
    const outward = (normal.x * (a.x + b.x + c.x) + normal.y * (a.y + b.y + c.y)) / (3 * radial)
    return (outward >= 0 ? 1 : -1) * length / 2
  }
  let total = 0
  for (let index = 0; index < ringLength; index += 1) {
    const next = (index + 1) % ringLength
    const first = points[index]
    const second = points[next]
    const inner = points[points.length - 1 - index]
    const innerNext = points[points.length - 1 - next]
    total += signed(first, second, innerNext) + signed(first, innerNext, inner)
  }
  return total
}

describe("mergeIntersectionSurfaces3", () => {
  it("turns the 50 mesh patches of 立方体 ∩ 圆柱 into three regions", () => {
    const intersection = cubeCylinderIntersection()
    // 现状自证：布尔交集自己就是 50 个面片（这条用例存在的全部理由）。
    expect(intersection.status).toBe("polyhedron")
    expect(intersection.faces).toHaveLength(50)

    const regions = mergeIntersectionSurfaces3(intersection, sources())

    expect(regions).toHaveLength(3)
    expect(regions.filter((region) => region.kind === "plane")).toHaveLength(2)
    expect(regions.filter((region) => region.kind === "cylinder")).toHaveLength(1)
    // 面积降序：最大的那块是圆柱侧带（50.23），圆盘（12.57）排在后面。
    expect(regions[0].kind).toBe("cylinder")
    expect(regions.map((region) => region.area)).toEqual([...regions.map((region) => region.area)].sort((first, second) => second - first))
  })

  it("reports both discs with the exact area πr²", () => {
    const regions = mergeIntersectionSurfaces3(cubeCylinderIntersection(), sources())
    const discs = discsOf(regions)

    expect(discs).toHaveLength(2)
    for (const disc of discs) {
      // 精确的圆盘面积是 πr²（网格 48 边形只有 12.5305）：既然边界是解析圆，读数就不许说成近似。
      expect(Math.abs(disc.area - Math.PI * RADIUS * RADIUS)).toBeLessThan(1e-9)
      expect(disc.areaExact).toBe(true)
      // 圆盘的法向就是圆柱轴 ±z。
      expect(Math.abs(disc.normal.z)).toBeCloseTo(1, 12)
      expect(Math.hypot(disc.normal.x, disc.normal.y)).toBeLessThan(1e-12)
    }
    // 两个圆盘分别在 z=-2 与 z=+2（那正是立方体的两个切面）。
    expect(discs.map((disc) => Math.round(disc.points[0].z)).sort((first, second) => first - second)).toEqual([-2, 2])
  })

  it("gives each disc an analytic circular boundary of radius r", () => {
    const discs = discsOf(mergeIntersectionSurfaces3(cubeCylinderIntersection(), sources()))

    for (const disc of discs) {
      expect(disc.exactLoops).toBeDefined()
      expect(disc.exactLoops!).toHaveLength(1)
      const loop = disc.exactLoops![0]
      // 圆盘边界是一整个圆：一个闭圆锥曲线片段，参数区间是整整一圈。
      expect(loop).toHaveLength(1)
      const piece = loop[0]
      expect(piece.kind).toBe("conic")
      if (piece.kind !== "conic") return
      expect(piece.conic.kind).toBe("circle")
      expect(piece.conic.semiMajor).toBeCloseTo(RADIUS, 9)
      expect(Math.abs(Math.abs(piece.parameterRange[1] - piece.parameterRange[0]) - Math.PI * 2)).toBeLessThan(1e-9)
      // 性质断言：解析边界上的采样点确实落在半径 R 的圆柱面上。
      for (const point of samplePiece(piece, 48)) {
        expect(Math.abs(Math.hypot(point.x, point.y) - RADIUS)).toBeLessThan(1e-9)
        expect(Math.abs(Math.abs(point.z) - 2)).toBeLessThan(1e-9)
      }
    }
  })

  it("reports the lateral band as one approximate region within 0.1% of the true 2πRh′", () => {
    const band = bandOf(mergeIntersectionSurfaces3(cubeCylinderIntersection(), sources()))
    const trueBand = 2 * Math.PI * RADIUS * CUT_HEIGHT

    // 侧面区域是 48 个网格面片的**面积求和**：如实标近似，且一定是内接多边形的偏小值。
    expect(band.areaExact).toBe(false)
    expect(Math.abs(band.area - trueBand) / trueBand).toBeLessThan(0.001)
    expect(band.area).toBeLessThan(trueBand)
    // 曲面区域的法向是该二次曲面的**轴**。
    expect(Math.abs(band.normal.z)).toBeCloseTo(1, 12)
  })

  it("describes the band's two boundary rings as conic pieces on the radius-r cylinder", () => {
    const intersection = cubeCylinderIntersection()
    const band = bandOf(mergeIntersectionSurfaces3(intersection, sources()))
    const loops = band.exactLoops

    expect(loops).toBeDefined()
    expect(loops!).toHaveLength(2)
    const levels: number[] = []
    for (const loop of loops!) {
      // 一圈弧落在同一个圆上：整环就是一个 conic 片段（不是 48 段折线）。
      expect(loop.every((piece) => piece.kind === "conic")).toBe(true)
      for (const piece of loop) {
        if (piece.kind !== "conic") continue
        // 参数区间由端点角度给出，因此两端必须能被 `conic3PointAt` 复现成**网格上的真实顶点**。
        for (const endpoint of pieceEndpoints(piece)) {
          expect(intersection.vertices.some((vertex) => distance(vertex, endpoint) < 1e-9)).toBe(true)
        }
        const sampled = samplePiece(piece, 24)
        for (const point of sampled) {
          expect(Math.abs(Math.hypot(point.x, point.y) - RADIUS)).toBeLessThan(1e-9)
        }
        // 整条弧落在同一个轴向坐标上（两圈弧各自贴着一个切面）。
        levels.push(sampled[0].z)
        expect(Math.max(...sampled.map((point) => Math.abs(point.z - sampled[0].z)))).toBeLessThan(1e-9)
      }
    }
    expect(levels.map((level) => Math.round(level)).sort((first, second) => first - second)).toEqual([-2, 2])
  })

  it("keeps a band that only covers part of the circumference as one region with segment pieces", () => {
    const intersection = halfCylinderIntersection()
    const regions = mergeIntersectionSurfaces3(intersection, sources())

    // 侧带只绕了半圈：边界里出现"落在切平面上"的母线，必须如实用 segment 片段，而不是编一段圆弧。
    const band = bandOf(regions)
    expect(regions.filter((region) => region.kind === "cylinder")).toHaveLength(1)
    const pieces = (band.exactLoops ?? []).flat()
    expect(pieces.some((piece) => piece.kind === "segment")).toBe(true)
    expect(pieces.some((piece) => piece.kind === "conic")).toBe(true)
    // 平面来源（x=0 那道切口 16、两个半圆盘）一个都不许被吸进曲面区域。
    const planes = discsOf(regions)
    expect(planes).toHaveLength(3)
    expect(planes.some((plane) => Math.abs(plane.area - 16) < 1e-9)).toBe(true)
    // 全区域的面积和 = 布尔交集的表面积（分组不重不漏）。
    const total = regions.reduce((sum, region) => sum + region.area, 0)
    const faceTotal = intersection.faceAreas.reduce((sum, value) => sum + value, 0)
    expect(Math.abs(total - faceTotal)).toBeLessThan(1e-9)
    // 半圆盘的边界是"圆弧 + 弦"：面积只能用网格多边形，不许说精确。
    const halfDiscs = planes.filter((plane) => Math.abs(plane.area - 16) > 1e-9)
    expect(halfDiscs.every((plane) => plane.areaExact === false)).toBe(true)
  })

  it("keeps 立方体 ∩ 立方体 at 6 plane regions with the ungrouped areas", () => {
    const intersection = intersectConvexPolyhedra3(cubePolyhedron(), cubePolyhedron({ x: 0, y: -2, z: -2 }))
    const regions = mergeIntersectionSurfaces3(intersection, sources(undefined))

    // 两个平面实体：行为不变——6 个平面区域，面积与旧实现（逐面）逐位相同。
    expect(intersection.faces).toHaveLength(6)
    expect(regions).toHaveLength(6)
    expect(regions.every((region) => region.kind === "plane")).toBe(true)
    expect(regions.every((region) => region.areaExact === true)).toBe(true)
    expect(regions.every((region) => region.exactLoops === undefined)).toBe(true)
    const areas = regions.map((region) => region.area).sort((first, second) => second - first)
    expect(areas).toEqual([...intersection.faceAreas].sort((first, second) => second - first))
    expect(areas.filter((area) => Math.abs(area - 16) < 1e-9)).toHaveLength(2)
    expect(areas.filter((area) => Math.abs(area - 8) < 1e-9)).toHaveLength(4)
  })

  it("groups a cone's lateral patches into one cone region with circular hoops", () => {
    /**
     * 圆锥侧面同样是"一张连续曲面被切成几十片"（48 段：底面环 48 片三角形；立方体在 z=±2 处切两刀，
     * 顶点 z=3 落在立方体之外，所以交出来是一段圆台）。半径随高度线性收缩，两圈弧的半径因此不同——
     * 这正是"按端点角度给参数区间"必须按**各自的轴向坐标**取圆的原因。
     */
    const conePrimitive = { id: "cone-a", type: "cone" as const, center: { x: 0, y: 0, z: BASE_Z }, radius: RADIUS, height: HEIGHT, segments: SEGMENTS }
    const intersection = intersectConvexPolyhedra3(cubePolyhedron(), conePolyhedron())
    const regions = mergeIntersectionSurfaces3(intersection, [{}, { quadric: coneQuadric3(conePrimitive) }])

    expect(intersection.faces.length).toBeGreaterThan(SEGMENTS)
    expect(regions.filter((region) => region.kind === "cone")).toHaveLength(1)
    expect(regions.filter((region) => region.kind === "plane")).toHaveLength(2)
    const band = regions.find((region) => region.kind === "cone")!
    expect(band.areaExact).toBe(false)
    expect(Math.abs(band.normal.z)).toBeCloseTo(1, 12)
    expect(band.exactLoops).toHaveLength(2)
    // z=-2 处半径 2(1−1/6)=5/3、z=+2 处半径 2(1−5/6)=1/3（轴向坐标从底面 z=-3 起算）。
    const sampled = band.exactLoops!.flatMap((loop) => loop.flatMap((piece) => samplePiece(piece, 8)))
    const radii = [...new Set(sampled.map((point) => Math.round(Math.hypot(point.x, point.y) * 1e6)))].map((value) => value / 1e6).sort((first, second) => first - second)
    expect(radii).toHaveLength(2)
    expect(radii[0]).toBeCloseTo(1 / 3, 6)
    expect(radii[1]).toBeCloseTo(5 / 3, 6)
    const levels = [...new Set(sampled.map((point) => Math.round(point.z)))].sort((first, second) => first - second)
    expect(levels).toEqual([-2, 2])
  })

  it("groups a cylinder whose axis is not the z axis (App 默认圆柱在 x=3)", () => {
    /**
     * App 新建的圆柱在 `center:{x:3,y:0,z:0}`（App.tsx 的 `addDefaultSolid`），圆锥在 `{x:-3,y:0,z:3}`——
     * 也就是说"顶点全在二次曲面上"绝不能靠 `quadric3FromPrimitive` 的矩阵判：实测那是个**局部**矩阵
     * （真曲面点 (4.5,0,1) 上 `quadricValueAt = 18`，应为 0）。这条用例把世界坐标这件事钉住。
     */
    const offAxis = { id: "cyl-a", type: "cylinder" as const, center: { x: 3, y: 0, z: BASE_Z }, radius: RADIUS, height: HEIGHT, segments: SEGMENTS }
    const plain = cylinderPolyhedron()
    const shifted: Polyhedron3Input = { vertices: plain.vertices.map((vertex) => ({ ...vertex, x: vertex.x + 3 })), faces: plain.faces }
    // 立方体 x∈[1,5]、y∈[-2,2]、z∈[-2,2]：把 x=3 那根圆柱从中间切出一段高 4 的侧带。
    const intersection = intersectConvexPolyhedra3(cubePolyhedron({ x: 1, y: -2, z: -2 }, CUBE_SIZE), shifted)
    const regions = mergeIntersectionSurfaces3(intersection, [{}, { quadric: cylinderQuadric3(offAxis) }])

    expect(regions).toHaveLength(3)
    expect(regions.filter((region) => region.kind === "cylinder")).toHaveLength(1)
    // 圆柱区域的轴就是世界 +z，顶点环的径向距离都以 (3,0) 为心。
    const band = regions.find((region) => region.kind === "cylinder")!
    for (const piece of (band.exactLoops ?? []).flat()) {
      for (const point of samplePiece(piece, 8)) {
        expect(Math.abs(Math.hypot(point.x - 3, point.y) - RADIUS)).toBeLessThan(1e-9)
      }
    }
  })

  /**
   * 侧带预览必须**点得到**：`points` 不能只是最大的那个环。
   *
   * 只给一圈圆的话，填充是一条很细的环（画布上几乎看不见），而且预览的形心（`hint`）落在圆心——
   * 点侧带时"离 hint 最近"认领到的是隔壁那两个圆盘。外环 + 其余环**反向**缝成一条闭合多边形之后，
   * 填充 / 拾取 / 形心全都对得上这条带；`exactLoops` 仍然是解析边界。
   */
  it("stitches the band's rings into one closed polygon that spans the whole 2πRh′ band", () => {
    const stitched = bandOf(mergeIntersectionSurfaces3(cubeCylinderIntersection(), sources())).points
    // 两圈各 48 个网格点：外环在前、另一圈反向在后（单环区域不做拼接，见下一条）。
    expect(stitched).toHaveLength(2 * SEGMENTS)

    /**
     * 闭合。内核（与 DSL）的环约定是**首尾不重复**，所以"闭合"= 收尾那条边真的把两圈缝在一起，
     * 也就是一条**母线**：两端落在同一环向角上（平面投影重合）、轴向相差一个带高。
     * 只给一圈时这条边是一条弦（轴向差 0）——这条断言就是那样失败的。
     */
    const first = stitched[0]
    const last = stitched[stitched.length - 1]
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThan(1e-9)
    expect(Math.abs(last.z - first.z)).toBeCloseTo(CUT_HEIGHT, 9)

    // 有向带面积为正：外环在前、另一圈反向，缝出来的带面朝半径外侧。
    const signed = stitchedBandArea(stitched, SEGMENTS)
    const trueBand = 2 * Math.PI * RADIUS * CUT_HEIGHT
    expect(signed).toBeGreaterThan(0)
    // 48 段内接带面比真值小 0.07%（别处已钉过）；这里只要求"几个百分点"以内。
    expect(Math.abs(signed - trueBand) / trueBand).toBeLessThan(0.03)
  })

  it("leaves a region with a single boundary ring exactly as it was", () => {
    // 圆盘的边界本来就是一个闭环：点数不变、没有第二圈被缝进来、也没有复制一个首点收尾。
    for (const disc of discsOf(mergeIntersectionSurfaces3(cubeCylinderIntersection(), sources()))) {
      expect(disc.points).toHaveLength(SEGMENTS)
      expect(disc.points[disc.points.length - 1]).not.toEqual(disc.points[0])
      for (const point of disc.points) expect(Math.abs(Math.hypot(point.x, point.y) - RADIUS)).toBeLessThan(1e-9)
    }
  })

  it("returns nothing for a pair that does not intersect, and never throws on degenerate input", () => {
    const apart = intersectConvexPolyhedra3(cubePolyhedron(), cubePolyhedron({ x: 40, y: -2, z: -2 }))
    expect(mergeIntersectionSurfaces3(apart, sources())).toEqual([])

    const degenerate: SolidIntersectionResult = { status: "insufficient-data", vertices: [], faces: [], faceNormals: [], faceAreas: [], volume: 0, area: 0, explanation: "", diagnostics: [] }
    expect(mergeIntersectionSurfaces3(degenerate, sources())).toEqual([])

    const flatOnly: SolidIntersectionResult = { ...degenerate, status: "point", vertices: [{ x: 0, y: 0, z: 0 }] }
    expect(mergeIntersectionSurfaces3(flatOnly, sources())).toEqual([])

    // 非有限坐标：不猜、不抛，如实返回空。
    const broken = cubeCylinderIntersection()
    broken.vertices[0] = { x: Number.NaN, y: 0, z: 0 }
    expect(mergeIntersectionSurfaces3(broken, sources())).toEqual([])

    // 来源没有二次曲面时就**如实**按面片逐个给平面区域（50 个），绝不假装它们属于某张曲面。
    const noQuadric = mergeIntersectionSurfaces3(cubeCylinderIntersection(), [])
    expect(noQuadric).toHaveLength(50)
    expect(noQuadric.every((region) => region.kind === "plane" && region.exactLoops === undefined)).toBe(true)
  })
})

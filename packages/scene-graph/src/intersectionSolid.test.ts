import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import type { PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, commitPatch, getDependencyIndex, recomputeDerivedObjects } from "./index"

/** 两个沿 X 轴错开、彼此交叠的立方体模板（各带物化拓扑）：交叠区间是 2×4×4 的长方体。 */
function overlappingCubes() {
  const document = createEmptyDocument("geometry3d")
  const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const second = { id: "cube-b", type: "cube" as const, origin: { x: 0, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  document.primitives = [first, ...buildSolidTemplate(first).primitives, second, ...buildSolidTemplate(second).primitives]
  return document
}

/** 一个立方体完全落在另一个里面。 */
function nestedCubes() {
  const document = createEmptyDocument("geometry3d")
  const outer = { id: "cube-outer", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const inner = { id: "cube-inner", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
  document.primitives = [outer, ...buildSolidTemplate(outer).primitives, inner, ...buildSolidTemplate(inner).primitives]
  return document
}

const pending = (sourceIds: [string, string]) => ({
  id: "solid-1",
  type: "intersectionSolid" as const,
  sourceIds,
  vertices: [],
  faces: [],
  volume: 0,
  area: 0,
  status: "none" as const
})

/** 一个待重算的「交面」（交集的单个平面面片）：hint 取要认领那一面的形心。 */
const pendingFace = (sourceIds: [string, string], hint: { x: number; y: number; z: number }) => ({
  id: "face-1",
  type: "intersectionFace" as const,
  sourceIds,
  points: [],
  normal: { x: 0, y: 0, z: 0 },
  area: 0,
  hint,
  status: "none" as const
})

/** 一个待重算的「交点」。 */
const pendingPoint = (sourceIds: [string, string], hint: { x: number; y: number; z: number }) => ({
  id: "point-1",
  type: "intersectionPoint3" as const,
  sourceIds,
  position: { x: 0, y: 0, z: 0 },
  hint,
  status: "none" as const
})

/** 把一条待重算的派生图元加进文档并重算，返回重算后的它。 */
function withPending(document: ReturnType<typeof overlappingCubes>, primitive: { id: string } & Record<string, unknown>) {
  const withPrimitive = applyOperation(document, { op: "addPrimitive", primitive: primitive as never }).document
  return recomputeDerivedObjects(withPrimitive).primitives.find((candidate) => candidate.id === primitive.id)
}

function resolved(document: ReturnType<typeof overlappingCubes>, sourceIds: [string, string] = ["cube-a", "cube-b"]) {
  const withSolid = applyOperation(document, { op: "addPrimitive", primitive: pending(sourceIds) }).document
  const solid = recomputeDerivedObjects(withSolid).primitives.find((primitive) => primitive.id === "solid-1")
  if (solid?.type !== "intersectionSolid") throw new Error("expected intersectionSolid")
  return solid
}

describe("intersection face and point primitives", () => {
  it("materialises exactly one face of the intersection, the one nearest its hint", () => {
    const document = overlappingCubes()
    // 交叠区间是 x∈[0,2]、y∈[-2,2]、z∈[-2,2]；y=-2 那一面（4×2 = 8）的形心是 (1,-2,0)。
    const face = withPending(document, pendingFace(["cube-a", "cube-b"], { x: 1, y: -2, z: 0 }))

    expect(face?.type).toBe("intersectionFace")
    if (face?.type !== "intersectionFace") throw new Error("expected intersectionFace")
    expect(face.status).toBe("valid")
    expect(face.visible).toBe(true)
    // 只是**一个**面：4 个顶点、面积 8，而不是整只交集的 6 个面 64。
    expect(face.points).toHaveLength(4)
    expect(face.area).toBeCloseTo(8, 6)
    // 法向朝交集外：y=-2 那一面朝 -y。
    expect(face.normal.y).toBeCloseTo(-1, 6)
    // 认领之后 hint 跟着走，下一次重算继续认同一面。
    expect(face.hint.y).toBeCloseTo(-2, 6)
    expect(face.points.every((point) => Math.abs(point.y + 2) < 1e-6)).toBe(true)
  })

  it("keeps claiming the same face after the sources move", () => {
    const document = overlappingCubes()
    const withFace = applyOperation(document, { op: "addPrimitive", primitive: pendingFace(["cube-a", "cube-b"], { x: 1, y: -2, z: 0 }) as never }).document
    const initial = recomputeDerivedObjects(withFace).primitives.find((primitive) => primitive.id === "face-1")
    if (initial?.type !== "intersectionFace") throw new Error("expected intersectionFace")

    // 把立方体 B 沿 y 挪 1：交叠区间变成 y∈[-1,2]，y=-2 那一面不存在了，
    // 于是它认领**最近**的那一面 y=-1（4×2=8），而不是跳到底面或对面去。
    const edited = applyOperation(withFace, { op: "translatePrimitive3", id: "cube-b", delta: { x: 0, y: 1, z: 0 } }).document
    const moved = recomputeDerivedObjects(edited).primitives.find((primitive) => primitive.id === "face-1")
    if (moved?.type !== "intersectionFace") throw new Error("expected intersectionFace")
    expect(moved.status).toBe("valid")
    expect(moved.area).toBeCloseTo(8, 6)
    expect(moved.points.every((point) => Math.abs(point.y + 1) < 1e-6)).toBe(true)
  })

  it("explains a face that no longer exists instead of keeping stale geometry", () => {
    const document = createEmptyDocument("geometry3d")
    const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const faraway = { id: "cube-far", type: "cube" as const, origin: { x: 40, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    document.primitives = [first, ...buildSolidTemplate(first).primitives, faraway, ...buildSolidTemplate(faraway).primitives]

    const face = withPending(document, pendingFace(["cube-a", "cube-far"], { x: 1, y: -2, z: 0 }))
    if (face?.type !== "intersectionFace") throw new Error("expected intersectionFace")
    expect(face.status).toBe("none")
    expect(face.visible).toBe(false)
    expect(face.points).toEqual([])
    expect(face.diagnostic).toContain("没有重叠")
  })

  it("materialises exactly one intersection point, the one nearest its hint", () => {
    const document = overlappingCubes()
    // 公共交线是 x=2 与 x=0 两处的一圈矩形；其中一个拐点是 (2,-2,2)。
    const point = withPending(document, pendingPoint(["cube-a", "cube-b"], { x: 2, y: -2, z: 2 }))

    expect(point?.type).toBe("intersectionPoint3")
    if (point?.type !== "intersectionPoint3") throw new Error("expected intersectionPoint3")
    expect(point.status).toBe("valid")
    expect(point.visible).toBe(true)
    expect(point.position.x).toBeCloseTo(2, 6)
    expect(point.position.y).toBeCloseTo(-2, 6)
    expect(point.position.z).toBeCloseTo(2, 6)
    // 认领之后 hint 跟着走。
    expect(point.hint.x).toBeCloseTo(2, 6)
  })

  it("has no intersection point when one solid contains the other", () => {
    // 完全包含时两个表面根本不相交：没有交点（也没有交线），这是数学事实而不是缺省。
    const document = nestedCubes()
    const point = withPending(document, pendingPoint(["cube-outer", "cube-inner"], { x: -1, y: -1, z: -1 }))
    if (point?.type !== "intersectionPoint3") throw new Error("expected intersectionPoint3")
    expect(point.status).toBe("none")
    expect(point.visible).toBe(false)
    expect(point.diagnostic).toContain("没有交点")
  })

  it("follows and dies with its sources, exactly like the other derived objects", () => {
    const document = overlappingCubes()
    const withFace = applyOperation(document, { op: "addPrimitive", primitive: pendingFace(["cube-a", "cube-b"], { x: 1, y: -2, z: 0 }) as never }).document
    const withBoth = applyOperation(withFace, { op: "addPrimitive", primitive: pendingPoint(["cube-a", "cube-b"], { x: 2, y: -2, z: 2 }) as never }).document

    const index = getDependencyIndex(withBoth)
    expect(index.get("cube-a")).toContain("face-1")
    expect(index.get("cube-a")).toContain("point-1")

    const deleted = commitPatch(withBoth, { op: "deleteObject", id: "cube-b" })
    expect(deleted.changed).toBe(true)
    expect(deleted.document.primitives.some((primitive) => primitive.id === "face-1" || primitive.id === "point-1")).toBe(false)
  })
})

describe("intersection face primitive (A2 support-surface regions)", () => {
  const RADIUS = 2
  const CUT_HEIGHT = 4
  const TRUE_BAND = 2 * Math.PI * RADIUS * CUT_HEIGHT

  type Face = Extract<PrimitiveSpec, { type: "intersectionFace" }>

  /** 立方体(4×4×4) 与一个模板圆柱（`center` 是底面中心）：布尔交集被切成 50 片的那一对。 */
  function cubeAndCylinder(cylinder: { center: { x: number; y: number; z: number }; height: number }) {
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    // 底面 z=-3、高 6：立方体（z∈[-2,2]）从中间切出一段高 4 的侧带，两个圆盘半径正好是 R。
    const solid = { id: "cyl-a", type: "cylinder" as const, center: cylinder.center, radius: RADIUS, height: cylinder.height, segments: 48 }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, solid, ...buildSolidTemplate(solid).primitives]
    return document
  }

  /** 重算后的交面图元（找不到就抛，免得断言全落在 undefined 上）。 */
  function faceOf(document: ReturnType<typeof cubeAndCylinder>, id = "face-1"): Face {
    const face = recomputeDerivedObjects(document).primitives.find((primitive) => primitive.id === id)
    if (face?.type !== "intersectionFace") throw new Error("expected intersectionFace")
    return face
  }

  /** 解析边界上每圈圆弧所在的轴向高度（sorted、去重）：来源一动它必须跟着动。 */
  function hoopLevels(face: Face): number[] {
    const levels = (face.exactLoops ?? []).flatMap((loop) => loop.flatMap((piece) => piece.kind === "conic" && piece.conic.center ? [Math.round(piece.conic.center.z)] : []))
    return [...new Set(levels)].sort((first, second) => first - second)
  }

  it("materialises the whole lateral band (one region) when the hint sits on the band", () => {
    // 画布上的侧带预览给出的 hint 就是缝合多边形的形心 (0,0,0)——点它现在必须建出**整条带**。
    const face = withPending(cubeAndCylinder({ center: { x: 0, y: 0, z: -3 }, height: 6 }), pendingFace(["cube-a", "cyl-a"], { x: 0, y: 0, z: 0 }))
    if (face?.type !== "intersectionFace") throw new Error("expected intersectionFace")

    expect(face.status).toBe("valid")
    // 曲面区域的面积是网格面片求和：如实标近似，且落在真值 2πRh′ 的 1% 以内。
    expect(face.areaExact).toBe(false)
    expect(Math.abs(face.area - TRUE_BAND) / TRUE_BAND).toBeLessThan(0.01)
    // 解析边界：两圈圆弧（这正是"一个表面"的样子，而不是一个网格小片）。
    expect(face.exactLoops).toHaveLength(2)
    for (const loop of face.exactLoops!) {
      for (const piece of loop) {
        expect(piece.kind).toBe("conic")
        if (piece.kind !== "conic") continue
        expect(piece.conic.kind).toBe("circle")
        expect(piece.conic.semiMajor).toBeCloseTo(RADIUS, 9)
      }
    }
    expect(hoopLevels(face)).toEqual([-2, 2])
    // 多边形是两圈首尾相接的整条带（96 个网格点），不是 48 个点的一圈细环。
    expect(face.points).toHaveLength(96)
    expect(face.hint.x).toBeCloseTo(0, 6)
    expect(face.hint.z).toBeCloseTo(0, 6)
  })

  it("materialises the exact disc (closed-form area) when the hint sits on a disc", () => {
    // 圆盘预览的 hint 就是圆盘形心 (0,0,2)；它认领到的是平面上那块圆盘，不是侧带。
    const face = withPending(cubeAndCylinder({ center: { x: 0, y: 0, z: -3 }, height: 6 }), pendingFace(["cube-a", "cyl-a"], { x: 0, y: 0, z: 2 }))
    if (face?.type !== "intersectionFace") throw new Error("expected intersectionFace")

    expect(face.status).toBe("valid")
    // 边界是整圆 ⇒ 面积有闭式 πr²，读数必须说精确。
    expect(face.areaExact).toBe(true)
    expect(Math.abs(face.area - Math.PI * RADIUS * RADIUS)).toBeLessThan(1e-9)
    expect(Math.abs(face.normal.z)).toBeCloseTo(1, 9)
    // 那一圈解析边界就是这个圆：半径 r、圆心在 (0,0,2)。
    expect(face.exactLoops).toHaveLength(1)
    const piece = face.exactLoops![0][0]
    expect(piece.kind).toBe("conic")
    if (piece.kind !== "conic") return
    expect(piece.conic.kind).toBe("circle")
    expect(piece.conic.semiMajor).toBeCloseTo(RADIUS, 9)
    expect(piece.conic.center?.z).toBeCloseTo(2, 9)
    expect(face.points).toHaveLength(48)
  })

  it("recomputes both the area and the analytic boundary when the source moves (no stale boundary)", () => {
    // 圆柱高 2（z∈[-1,1]）整个落在立方体里：交面就是圆柱自己——侧带高 2、两圈在 z=±1。
    const document = cubeAndCylinder({ center: { x: 0, y: 0, z: -1 }, height: 2 })
    const withFace = applyOperation(document, { op: "addPrimitive", primitive: pendingFace(["cube-a", "cyl-a"], { x: 0, y: 0, z: 0 }) as never }).document
    const initial = faceOf(withFace)
    const initialArea = 2 * Math.PI * RADIUS * 2

    expect(initial.areaExact).toBe(false)
    expect(Math.abs(initial.area - initialArea) / initialArea).toBeLessThan(0.01)
    expect(hoopLevels(initial)).toEqual([-1, 1])

    // 把圆柱加高（高 2 → 3，顶面 z=2 正好贴着立方体顶面）：侧带变高、面积 ×1.5，
    // 上圈圆弧必须从 z=1 挪到 z=2——旧的解析边界留在这里就会读出"面积变了、边界没变"的鬼话。
    const edited = applyOperation(withFace, { op: "updatePrimitive", id: "cyl-a", patch: { height: 3 } }).document
    const moved = faceOf(edited)

    expect(moved.areaExact).toBe(false)
    expect(Math.abs(moved.area - initial.area * 1.5) / (initial.area * 1.5)).toBeLessThan(0.01)
    expect(hoopLevels(moved)).toEqual([-1, 2])
  })

  it("clears a stale analytic boundary when the region no longer exists", () => {    const document = cubeAndCylinder({ center: { x: 0, y: 0, z: -3 }, height: 6 })
    const withFace = applyOperation(document, { op: "addPrimitive", primitive: pendingFace(["cube-a", "cyl-a"], { x: 0, y: 0, z: 0 }) as never }).document
    const initial = faceOf(withFace)
    expect(initial.exactLoops).toBeDefined()
    expect(initial.areaExact).toBeDefined()

    // 圆柱整块挪出立方体：交面不存在了，上一轮的解析边界与精度标注都不许留下。
    const moved = applyOperation(withFace, { op: "translatePrimitive3", id: "cyl-a", delta: { x: 40, y: 0, z: 0 } }).document
    const gone = faceOf(moved)

    expect(gone.status).toBe("none")
    expect(gone.points).toEqual([])
    expect(gone.exactLoops).toBeUndefined()
    expect(gone.areaExact).toBeUndefined()
  })
  /**
   * 曲面区域的 `points` 是"外环 + 其余环反向缝合"的多边形（A2）：渲染方要知道**前导外环**有多长，
   * 才能把它三角化成环向条带。从 `points[0]` 扇形铺开的话，48 段的侧带会被画成那张圆盘——中间的洞整块被填掉。
   */
  it("writes the leading outer ring length for the claimed lateral band", () => {
    const face = withPending(cubeAndCylinder({ center: { x: 0, y: 0, z: -3 }, height: 6 }), pendingFace(["cube-a", "cyl-a"], { x: 0, y: 0, z: 0 }))
    if (face?.type !== "intersectionFace") throw new Error("expected intersectionFace")

    expect(face.status).toBe("valid")
    // 48 段的侧带缝成 96 个点，前导外环是其中 48 个。
    expect(face.outerRingLength).toBe(48)
    expect(face.points).toHaveLength(96)
    expect(face.points).toHaveLength(2 * face.outerRingLength!)
  })

  it("leaves outerRingLength unset when the claimed region is planar", () => {
    // 圆盘：边界只有一圈，`points` 就是那个环本身。
    const disc = withPending(cubeAndCylinder({ center: { x: 0, y: 0, z: -3 }, height: 6 }), pendingFace(["cube-a", "cyl-a"], { x: 0, y: 0, z: 2 }))
    if (disc?.type !== "intersectionFace") throw new Error("expected intersectionFace")
    expect(disc.status).toBe("valid")
    expect(disc.points).toHaveLength(48)
    expect(disc.outerRingLength).toBeUndefined()

    // 两个交叠立方体的交面全是平面区域：一个都不许带这个字段。
    const plane = withPending(overlappingCubes(), pendingFace(["cube-a", "cube-b"], { x: 1, y: -2, z: 0 }))
    if (plane?.type !== "intersectionFace") throw new Error("expected intersectionFace")
    expect(plane.status).toBe("valid")
    expect(plane.points).toHaveLength(4)
    expect(plane.outerRingLength).toBeUndefined()
  })

  /**
   * 陈旧字段必须被摘掉：`outerRingLength` 与 `exactLoops` / `areaExact` 一样是**派生**的
   * （这一轮算什么就写什么），来源一动它就可能对不上当前几何。留着它，渲染方会把一块**平面多边形**
   * 当成环向条带缝——填充直接画错。
   *
   * 这里没法走"先认领侧带、再改来源让它改认平面"的路径：交面是派生图元，`patches.ts` 的
   * `editable` 列表不接受它的 `sourceIds` 补丁。所以直接按契约把上一轮的字段种在待重算的图元上。
   */
  it("clears a stale outerRingLength when the claimed region is planar", () => {
    const document = cubeAndCylinder({ center: { x: 0, y: 0, z: -3 }, height: 6 })
    const stale = { ...pendingFace(["cube-a", "cyl-a"], { x: 0, y: 0, z: 0 }), outerRingLength: 48 }
    const withFace = applyOperation(document, { op: "addPrimitive", primitive: stale as never }).document
    // 先按契约自证：侧带那一轮确实会写这个字段（否则下面清掉的可能是本来就没有的东西）。
    expect(faceOf(withFace).outerRingLength).toBe(48)

    // 换成两只立方体：同一个面此刻认领的是平面区域 x=0（形心 (0,0,0)，正好还是 hint）。
    const cubes = overlappingCubes()
    const planeFace = withPending(cubes, { ...pendingFace(["cube-a", "cube-b"], { x: 1, y: -2, z: 0 }), outerRingLength: 48 })
    if (planeFace?.type !== "intersectionFace") throw new Error("expected intersectionFace")
    expect(planeFace.status).toBe("valid")
    expect(planeFace.normal.y).toBeCloseTo(-1, 6)
    expect(planeFace.outerRingLength).toBeUndefined()
  })
})

describe("intersection solid primitive", () => {
  it("materialises the boolean intersection of two overlapping cubes", () => {
    const solid = resolved(overlappingCubes())

    expect(solid.status).toBe("polyhedron")
    expect(solid.visible).toBe(true)
    // 交叠区间是 x∈[0,2]、y∈[-2,2]、z∈[-2,2]：体积 2×4×4 = 32。
    expect(solid.volume).toBeCloseTo(32, 6)
    // 表面积 = 2×16（两个 4×4 切口面）+ 4×8（四个 2×4 侧面）= 64。
    expect(solid.area).toBeCloseTo(64, 6)
    expect(solid.faces.length).toBe(6)
    for (const vertex of solid.vertices) {
      expect(vertex.x).toBeGreaterThanOrEqual(-1e-6)
      expect(vertex.x).toBeLessThanOrEqual(2 + 1e-6)
      expect(Math.abs(vertex.y)).toBeLessThanOrEqual(2 + 1e-6)
      expect(Math.abs(vertex.z)).toBeLessThanOrEqual(2 + 1e-6)
    }
  })

  it("returns the contained solid when one source sits inside the other", () => {
    // 布尔交集不是"切一刀"：完全包含时结果就是里面那个实体自己（体积 8、表面积 24）。
    const solid = resolved(nestedCubes(), ["cube-outer", "cube-inner"])

    expect(solid.status).toBe("polyhedron")
    expect(solid.volume).toBeCloseTo(8, 6)
    expect(solid.area).toBeCloseTo(24, 6)
  })

  it("keeps a flat intersection visible but reports that it has no volume", () => {
    const document = createEmptyDocument("geometry3d")
    const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    // 沿 X 方向正好贴面：交集是 4×4 的一块面，体积为 0。
    const second = { id: "cube-c", type: "cube" as const, origin: { x: 2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    document.primitives = [first, ...buildSolidTemplate(first).primitives, second, ...buildSolidTemplate(second).primitives]

    const solid = resolved(document, ["cube-a", "cube-c"])
    expect(solid.status).toBe("flat")
    expect(solid.visible).toBe(true)
    expect(solid.volume).toBeCloseTo(0, 6)
    expect(solid.area).toBeCloseTo(16, 4)
    expect(solid.diagnostic).toContain("没有体积")
  })

  it("explains sources that do not overlap instead of keeping stale geometry", () => {
    const document = createEmptyDocument("geometry3d")
    const first = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const faraway = { id: "cube-far", type: "cube" as const, origin: { x: 40, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    document.primitives = [first, ...buildSolidTemplate(first).primitives, faraway, ...buildSolidTemplate(faraway).primitives]

    const solid = resolved(document, ["cube-a", "cube-far"])
    expect(solid.status).toBe("none")
    expect(solid.visible).toBe(false)
    expect(solid.vertices).toEqual([])
    expect(solid.faces).toEqual([])
    expect(solid.diagnostic).toContain("没有重叠")
  })

  it("explains a missing source and a source that is not a solid", () => {
    const missing = resolved(overlappingCubes(), ["cube-a", "gone"])
    expect(missing.status).toBe("insufficient-data")
    expect(missing.visible).toBe(false)
    expect(missing.diagnostic).toContain("不存在")

    // 面不是实体：布尔交集要的是"有体积的东西"，这里必须给诊断而不是硬算一个面出来。
    const document = overlappingCubes()
    const face = { id: "face-1", type: "face3" as const, pointIds: ["cube-a-point-1", "cube-a-point-2", "cube-a-point-3"] }
    const withFace = { ...document, primitives: [...document.primitives, face] }
    const flat = recomputeDerivedObjects({
      ...withFace,
      primitives: [...withFace.primitives, pending(["cube-a", "face-1"])]
    }).primitives.find((primitive) => primitive.id === "solid-1")
    if (flat?.type !== "intersectionSolid") throw new Error("expected intersectionSolid")
    expect(flat.status).toBe("insufficient-data")
    expect(flat.diagnostic).toContain("实体")
  })

  it("keeps resolving a template solid whose topology was turned into an explicit face set", () => {
    /**
     * 用户按数值改一个模板顶点时，`updatePrimitive` 会把这条物化拓扑从 `construction.kind: "template"`
     * 翻成 `"fromFaces"`。如果只认 `template`，这个实体就会从自动预览里**静默消失**，
     * 交面还会给出误导性的诊断（"来源必须是实体"——它明明是实体）。
     *
     * 这里用**棱锥**做这一刀：把顶点（塔尖）沿 x 挪 1，四个侧面仍然是平面，实体仍然是凸的，
     * 所以正确的行为是"照常算出交集"，而不是"找不到拓扑"。
     */
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    const pyramid = { id: "pyr-a", type: "pyramid" as const, baseCenter: { x: 0, y: 0, z: -2 }, baseSize: { x: 4, y: 4 }, height: 4 }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, pyramid, ...buildSolidTemplate(pyramid).primitives]

    const withSolid = applyOperation(document, { op: "addPrimitive", primitive: pending(["cube-a", "pyr-a"]) }).document
    const before = recomputeDerivedObjects(withSolid).primitives.find((primitive) => primitive.id === "solid-1")
    if (before?.type !== "intersectionSolid") throw new Error("expected intersectionSolid")
    // 棱锥整个落在立方体里：交集就是棱锥自己（1/3 · 16 · 4）。
    expect(before.status).toBe("polyhedron")
    expect(before.volume).toBeCloseTo(64 / 3, 6)

    const apex = withSolid.primitives.find((primitive) => primitive.type === "point3" && primitive.id.startsWith("pyr-a-point") && primitive.position.z === 2)
    if (apex?.type !== "point3") throw new Error("expected the pyramid apex")
    const edited = applyOperation(withSolid, { op: "updatePrimitive", id: apex.id, patch: { position3: { ...apex.position, x: 1 } } }).document
    const flipped = edited.primitives.find((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "fromFaces")
    const construction = flipped?.type === "polyhedron3" ? flipped.construction : undefined
    // 归属必须一起带走：否则这个实体就再也找不到自己的拓扑了。
    expect(construction?.kind).toBe("fromFaces")
    expect(construction?.kind === "fromFaces" ? construction.sourceId : undefined).toBe("pyr-a")

    const solid = recomputeDerivedObjects(edited).primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "intersectionSolid") throw new Error("expected intersectionSolid")
    expect(solid.status).toBe("polyhedron")
    expect(solid.visible).toBe(true)
    // 塔尖仍在立方体内：交集还是整个棱锥，体积不变。
    expect(solid.volume).toBeCloseTo(64 / 3, 6)
  })

  it("blames the geometry, not the source type, when an edited template becomes non-convex", () => {
    // 把立方体的**一个角**沿 x 挪 1 会让相邻三个面不再共面（实体不再是凸的）：内核就该说这件事，
    // 而不是因为"找不到拓扑"给出"来源必须是实体"这种风马牛不相及的诊断。
    const document = overlappingCubes()
    const withSolid = applyOperation(document, { op: "addPrimitive", primitive: pending(["cube-a", "cube-b"]) }).document
    const vertex = withSolid.primitives.find((primitive) => primitive.id === "cube-a-point-1")
    if (vertex?.type !== "point3") throw new Error("expected cube-a-point-1")

    const edited = applyOperation(withSolid, { op: "updatePrimitive", id: "cube-a-point-1", patch: { position3: { ...vertex.position, x: vertex.position.x - 1 } } }).document
    const solid = recomputeDerivedObjects(edited).primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "intersectionSolid") throw new Error("expected intersectionSolid")

    expect(solid.status).toBe("insufficient-data")
    expect(solid.diagnostic).not.toContain("来源必须是实体")
    expect(solid.diagnostic).toContain("凸")
  })

  it("is a pure derived object: it follows its sources and is deleted with them", () => {
    const document = overlappingCubes()
    const withSolid = applyOperation(document, { op: "addPrimitive", primitive: pending(["cube-a", "cube-b"]) }).document

    const index = getDependencyIndex(withSolid)
    expect(index.get("cube-a")).toContain("solid-1")

    const deleted = commitPatch(withSolid, { op: "deleteObject", id: "cube-a" })
    expect(deleted.changed).toBe(true)
    expect(deleted.document.primitives.some((primitive) => primitive.id === "solid-1")).toBe(false)
  })
})

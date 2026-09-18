import { describe, expect, it } from "vitest"

import { createDefaultCadLayout, createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { axisRotationMatrix3, buildSolidTemplate, composeEuler3, eulerRotationMatrix3, multiplyRotationMatrix3, rotatePointAboutAxis3, templateSolidPivot } from "@draw/geometry-kernel"

import { commitPatch } from "./patches"
import { planeThroughPoints, sectionDistanceToPlane, sectionPivot, sectionPlaneOffset, sectionPlaneThroughSource } from "./operations"

function cadDocument() {
  return createDefaultCadLayout(createEmptyDocument("cad"))
}

describe("template solid orientation", () => {
  const cone = { id: "cone-1", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: 1, height: 4, segments: 4 }

  function coneDocument() {
    const document = createEmptyDocument("geometry3d")
    return commitPatch(document, { op: "addPrimitives", primitives: [cone, ...buildSolidTemplate(cone).primitives] }).document
  }

  const apexId = (document: ReturnType<typeof coneDocument>) => (document.primitives.find((primitive) => primitive.type === "polyhedron3") as { vertexIds: string[] }).vertexIds.at(-1)!
  const positionOf = (document: ReturnType<typeof coneDocument>, id: string) => (document.primitives.find((primitive) => primitive.id === id) as { position: { x: number; y: number; z: number } }).position

  it("stores the orientation and drags the generated topology with it", () => {
    const document = coneDocument()
    const apex = apexId(document)

    expect(positionOf(document, apex).z).toBeCloseTo(4, 6)

    const rotated = commitPatch(document, { op: "updatePrimitive", id: "cone-1", patch: { rotation3: { x: Math.PI / 2, y: 0, z: 0 } } })

    expect(rotated.changed).toBe(true)
    expect((rotated.document.primitives.find((primitive) => primitive.id === "cone-1") as { rotation: { x: number } }).rotation.x).toBeCloseTo(Math.PI / 2, 10)
    // The vertices belong to the template, so they must follow the new orientation instead of staying upright.
    expect(positionOf(rotated.document, apex).z).toBeCloseTo(2, 6)
    expect(positionOf(rotated.document, apex).y).toBeCloseTo(-2, 6)
  })

  it("merges a single axis so the other angles are preserved", () => {
    const document = coneDocument()
    const leaned = commitPatch(document, { op: "updatePrimitive", id: "cone-1", patch: { rotation3: { x: Math.PI / 2, y: 0, z: 0 } } }).document
    const turned = commitPatch(leaned, { op: "updatePrimitive", id: "cone-1", patch: { rotation3: { z: Math.PI } } }).document

    expect((turned.primitives.find((primitive) => primitive.id === "cone-1") as { rotation: { x: number; y: number; z: number } }).rotation).toMatchObject({ x: Math.PI / 2, z: Math.PI })
  })
})

describe("plane patch size", () => {
  function planeDocument() {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p0", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p1", type: "point3", position: { x: 4, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p2", type: "point3", position: { x: 0, y: 4, z: 0 }, binding: { kind: "free" } },
      { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["p0", "p1", "p2"] } }
    ]
    return document
  }

  const planeOf = (document: ReturnType<typeof planeDocument>) => document.primitives.find((primitive) => primitive.id === "plane-abc") as { halfSize?: number }

  it("stores an explicit half extent", () => {
    const sized = commitPatch(planeDocument(), { op: "updatePrimitive", id: "plane-abc", patch: { halfSize: 6 } })

    expect(sized.changed).toBe(true)
    expect(planeOf(sized.document).halfSize).toBe(6)
  })

  it("returns the plane to automatic sizing when the size is cleared", () => {
    const sized = commitPatch(planeDocument(), { op: "updatePrimitive", id: "plane-abc", patch: { halfSize: 6 } }).document
    const cleared = commitPatch(sized, { op: "updatePrimitive", id: "plane-abc", patch: { halfSize: null } })

    expect(cleared.changed).toBe(true)
    // Removed rather than set to zero, so the stored document carries no stale size.
    expect("halfSize" in planeOf(cleared.document)).toBe(false)
  })
})

describe("free 3D drag", () => {
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }

  function cubeDocument() {
    const document = createEmptyDocument("geometry3d")
    return commitPatch(document, { op: "addPrimitives", primitives: [cube, ...buildSolidTemplate(cube).primitives] }).document
  }

  const primitiveById = (document: ReturnType<typeof cubeDocument>, id: string) => document.primitives.find((candidate) => candidate.id === id)!
  const positionOf = (document: ReturnType<typeof cubeDocument>, id: string) => (primitiveById(document, id) as { position: { x: number; y: number; z: number } }).position
  /** The materialised topology the canvas draws for the cube; its ids are allocated by the builder. */
  const generatedTopology = (document: ReturnType<typeof cubeDocument>) => primitiveById(document, "cube-1-polyhedron-27") as unknown as { vertexIds: string[]; edgeIds: string[] }

  it("moves a template solid and every point it generated", () => {
    const document = cubeDocument()
    const generatedPointId = generatedTopology(document).vertexIds[0]
    const before = positionOf(document, generatedPointId)

    const moved = commitPatch(document, { op: "translatePrimitive3", id: "cube-1", delta: { x: 2, y: 0, z: -3 } })

    expect(moved.changed).toBe(true)
    expect((primitiveById(moved.document, "cube-1") as { origin: { x: number; y: number; z: number } }).origin).toEqual({ x: 1, y: -1, z: -4 })
    // The generated topology is what the canvas actually draws, so it has to follow the anchor.
    expect(positionOf(moved.document, generatedPointId)).toEqual({ x: before.x + 2, y: before.y, z: before.z - 3 })
  })

  it("keeps a template solid's size when it is dragged", () => {
    const moved = commitPatch(cubeDocument(), { op: "translatePrimitive3", id: "cube-1", delta: { x: 5, y: 5, z: 5 } })

    expect((primitiveById(moved.document, "cube-1") as { size: { x: number; y: number; z: number } }).size).toEqual({ x: 2, y: 2, z: 2 })
  })

  it("moves a point-driven object by moving the points it references", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "segment-ab", type: "segment3", pointIds: ["p-a", "p-b"] }
    ]

    const moved = commitPatch(document, { op: "translatePrimitive3", id: "segment-ab", delta: { x: 0, y: 1, z: 2 } })

    expect(moved.changed).toBe(true)
    expect(positionOf(moved.document, "p-a")).toEqual({ x: 0, y: 1, z: 2 })
    expect(positionOf(moved.document, "p-b")).toEqual({ x: 2, y: 1, z: 2 })
  })

  /**
   * 轨道圆（`circle3`）**自带圆心坐标**，是一个独立对象。
   *
   * 用户口径："我要的轨道圆是点在圆上而不是圆跟着点走，而且圆要可以缩放旋转。"
   * 早期实现存的是 `centerId`（引用一个点当圆心）——拖那个点圆就跟着走、点还删不掉（实测删除得到
   * `object is referenced by another object: point3-1`）。现在圆自己走自己的。
   */
  it("moves a circle track by moving its own centre, and leaves every point alone", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-centre", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } },
      { id: "orbit-1", type: "circle3", center: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
    ]

    const moved = commitPatch(document, { op: "translatePrimitive3", id: "orbit-1", delta: { x: 0, y: -1, z: 4 } })

    expect(moved.changed).toBe(true)
    expect((moved.document.primitives.find((primitive) => primitive.id === "orbit-1") as { center: { x: number; y: number; z: number } }).center).toEqual({ x: 1, y: 1, z: 7 })
    // 圆不引用任何点：拖圆不会把点也带走（这正是"点在圆上而不是圆跟着点走"的另一半）。
    expect(positionOf(moved.document, "p-centre")).toEqual({ x: 1, y: 2, z: 3 })
  })

  it("turns a circle track's normal without moving its centre", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-centre", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } },
      { id: "orbit-1", type: "circle3", center: { x: 1, y: 2, z: 3 }, normal: { x: 1, y: 0, z: 0 }, radius: 2 }
    ]

    const rotated = commitPatch(document, { op: "rotatePrimitive3", id: "orbit-1", axis: "z", degrees: 90 })

    expect(rotated.changed).toBe(true)
    const orbit = rotated.document.primitives.find((primitive) => primitive.id === "orbit-1") as { center: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }
    // 绕自己转：圆心不动、法向转过 90°（+X → +Y）。
    expect(orbit.center).toEqual({ x: 1, y: 2, z: 3 })
    expect(orbit.normal.x).toBeCloseTo(0, 12)
    expect(orbit.normal.y).toBeCloseTo(1, 12)
    expect(positionOf(rotated.document, "p-centre")).toEqual({ x: 1, y: 2, z: 3 })
  })

  it("lets the point that used to be the centre be deleted, because the track no longer references it", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-centre", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "orbit-1", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
    ]

    const deleted = commitPatch(document, { op: "deleteObject", id: "p-centre" })

    expect(deleted.changed).toBe(true)
    // 圆自己的几何还在（它不再挂在那个点上）。
    expect(deleted.document.primitives.some((primitive) => primitive.id === "orbit-1")).toBe(true)
    expect(deleted.document.primitives.some((primitive) => primitive.id === "p-centre")).toBe(false)
  })

  it("moves a point-driven line's endpoints so the line follows", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["p-a", "p-b"] } }
    ]

    const moved = commitPatch(document, { op: "translatePrimitive3", id: "line-ab", delta: { x: 1, y: 1, z: 1 } })

    expect(positionOf(moved.document, "p-a")).toEqual({ x: 1, y: 1, z: 1 })
    expect(positionOf(moved.document, "p-b")).toEqual({ x: 3, y: 1, z: 1 })
  })

  it("leaves a bound point to the object that binds it", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["p-a", "p-b"] } },
      { id: "p-mid", type: "point3", position: { x: 1, y: 0, z: 0 }, binding: { kind: "derived", feature: "midpoint", sourceIds: ["p-a", "p-b"] } }
    ]

    const rejected = commitPatch(document, { op: "translatePrimitive3", id: "p-mid", delta: { x: 1, y: 0, z: 0 } })

    expect(rejected.changed).toBe(false)
    expect(rejected.error).toContain("not draggable")
    // Dragging the line the midpoint hangs off still carries it along.
    const moved = commitPatch(document, { op: "translatePrimitive3", id: "line-ab", delta: { x: 3, y: 0, z: 0 } })
    expect(positionOf(moved.document, "p-mid")).toEqual({ x: 4, y: 0, z: 0 })
  })

  it("refuses to drag generated topology out of its parent solid", () => {
    const document = cubeDocument()
    const generatedEdgeId = generatedTopology(document).edgeIds[0]

    const rejected = commitPatch(document, { op: "translatePrimitive3", id: generatedEdgeId, delta: { x: 1, y: 0, z: 0 } })

    expect(rejected.changed).toBe(false)
    expect(rejected.error).toContain("not draggable")
  })

  it("refuses a locked object and a non-finite drag", () => {
    expect(commitPatch(cubeDocument(), { op: "translatePrimitive3", id: "cube-1", delta: { x: 1, y: 0, z: Number.NaN } }).changed).toBe(false)

    const locked = commitPatch(cubeDocument(), { op: "toggleLock", id: "cube-1", locked: true }).document
    expect(commitPatch(locked, { op: "translatePrimitive3", id: "cube-1", delta: { x: 1, y: 0, z: 0 } }).changed).toBe(false)
  })

  it("is one undoable step per committed drag", () => {
    const document = cubeDocument()
    const moved = commitPatch(document, { op: "translatePrimitive3", id: "cube-1", delta: { x: 1, y: 1, z: 1 } }).document
    // A drag is dispatched as one operation, so the previous document is the whole undo step.
    expect((primitiveById(moved, "cube-1") as { origin: { x: number } }).origin.x).toBe(0)
    expect((primitiveById(document, "cube-1") as { origin: { x: number } }).origin.x).toBe(-1)
  })
})

/**
 * 拖动旋转（用户口径："我希望能给立体图形增加旋转功能，就像我想要一个横着的圆柱，可以在图中拖着圆柱旋转，
 * 也可以在右侧属性栏设置为 90 度。"）。
 *
 * 一条不变量贯穿所有用例：**半径 / 边长 / 大小这些"物体自身量"不能被旋转改掉**——转了之后量变了就是实现错了。
 */
describe("3D rotation", () => {
  const positionOfVector = (document: { primitives: PrimitiveSpec[] }, id: string) => (document.primitives.find((primitive) => primitive.id === id) as unknown as { position: { x: number; y: number; z: number } }).position
  const normalOf = (vector: { x: number; y: number; z: number }) => {
    const length = Math.hypot(vector.x, vector.y, vector.z)
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
  }

  function trackDocument() {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-centre", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } },
      // 法向沿 +X：圆轨道立在 y-z 平面里，绕 Z 转过 90° 就该指向 +Y —— 一个一眼能看出来的变化。
      { id: "orbit-1", type: "circle3", center: { x: 1, y: 2, z: 3 }, normal: { x: 1, y: 0, z: 0 }, radius: 2 }
    ]
    return document
  }

  it("turns a circle track about its own centre, leaving centre, radius and normal length alone", () => {
    const rotated = commitPatch(trackDocument(), { op: "rotatePrimitive3", id: "orbit-1", axis: "z", degrees: 90 })

    expect(rotated.changed).toBe(true)
    // 枢轴缺省 = 它拥有的点的形心；圆只有一个圆心点，所以圆心不动。
    const centre = positionOfVector(rotated.document, "p-centre")
    expect(centre.x).toBeCloseTo(1, 12)
    expect(centre.y).toBeCloseTo(2, 12)
    expect(centre.z).toBeCloseTo(3, 12)
    const orbit = rotated.document.primitives.find((primitive) => primitive.id === "orbit-1") as unknown as { normal: { x: number; y: number; z: number }; radius: number }
    expect(orbit.radius).toBe(2)
    expect(orbit.normal.x).toBeCloseTo(0, 12)
    expect(orbit.normal.y).toBeCloseTo(1, 12)
    expect(orbit.normal.z).toBeCloseTo(0, 12)
  })

  it("turns a spatial face about its centroid, preserving the centroid, the side lengths and the normal's turn", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-c", type: "point3", position: { x: 0, y: 2, z: 0 }, binding: { kind: "free" } },
      { id: "face-abc", type: "face3", pointIds: ["p-a", "p-b", "p-c"] }
    ]
    const centroidBefore = { x: 2 / 3, y: 2 / 3, z: 0 }
    const sideBefore = Math.hypot(2, 0, 0)

    const rotated = commitPatch(document, { op: "rotatePrimitive3", id: "face-abc", axis: "x", degrees: 90 })

    expect(rotated.changed).toBe(true)
    const [a, b, c] = ["p-a", "p-b", "p-c"].map((id) => positionOfVector(rotated.document, id))
    const centroidAfter = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 }
    expect(centroidAfter.x).toBeCloseTo(centroidBefore.x, 12)
    expect(centroidAfter.y).toBeCloseTo(centroidBefore.y, 12)
    expect(centroidAfter.z).toBeCloseTo(centroidBefore.z, 12)
    // 边长是物体自身量：旋转是刚体变换，边长必须一字不差地保留。
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeCloseTo(sideBefore, 12)
    expect(Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z)).toBeCloseTo(sideBefore, 12)
    // 面的法向是**算出来的**（点变它就变），这里按定义重算一次，确认它真的转过了 90°。
    const edge1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const edge2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
    const normal = normalOf({ x: edge1.y * edge2.z - edge1.z * edge2.y, y: edge1.z * edge2.x - edge1.x * edge2.z, z: edge1.x * edge2.y - edge1.y * edge2.x })
    expect(normal.x).toBeCloseTo(0, 12)
    expect(normal.y).toBeCloseTo(-1, 12)
    expect(normal.z).toBeCloseTo(0, 12)
  })

  it("turns a point-normal plane's stored normal so the drawn plane follows", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-0", type: "point3", position: { x: 1, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "plane-0", type: "plane3", definition: { kind: "pointNormal", pointId: "p-0", normal: { x: 1, y: 0, z: 0 } } }
    ]

    const rotated = commitPatch(document, { op: "rotatePrimitive3", id: "plane-0", axis: "z", degrees: 90 })

    expect(rotated.changed).toBe(true)
    const plane = rotated.document.primitives.find((primitive) => primitive.id === "plane-0") as unknown as { definition: { normal: { x: number; y: number; z: number } } }
    // 只转参考点、不转存下来的法向，画出来的平面就会"读数说转了、画面没转"。
    expect(plane.definition.normal.x).toBeCloseTo(0, 12)
    expect(plane.definition.normal.y).toBeCloseTo(1, 12)
    expect(positionOfVector(rotated.document, "p-0").x).toBeCloseTo(1, 12)
  })

  it("turns a point-driven line by turning both of its points", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "p-a", type: "point3", position: { x: -1, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 1, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["p-a", "p-b"] } }
    ]

    const rotated = commitPatch(document, { op: "rotatePrimitive3", id: "line-ab", axis: "z", degrees: 90 })

    expect(rotated.changed).toBe(true)
    const a = positionOfVector(rotated.document, "p-a")
    const b = positionOfVector(rotated.document, "p-b")
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1, 12)
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(1, 12)
    // 直线绕自身中点转：中点不动、方向从 X 变成 Y。
    expect(b.y - a.y).toBeCloseTo(2, 12)
  })

  describe("template solids", () => {
    const cylinder = { id: "cyl-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 1, height: 4, segments: 8 }

    function cylinderDocument() {
      const document = createEmptyDocument("geometry3d")
      return commitPatch(document, { op: "addPrimitives", primitives: [cylinder, ...buildSolidTemplate(cylinder).primitives] }).document
    }

    const solidOf = (document: ReturnType<typeof cylinderDocument>) => document.primitives.find((primitive) => primitive.id === "cyl-1") as unknown as { center: { x: number; y: number; z: number }; radius: number; height: number; rotation?: { x: number; y: number; z: number } }
    const solidPrimitive = (document: ReturnType<typeof cylinderDocument>) => document.primitives.find((primitive) => primitive.id === "cyl-1") as Extract<PrimitiveSpec, { type: "cylinder" }>

    it("writes the euler field for a solid that had never been turned", () => {
      const rotated = commitPatch(cylinderDocument(), { op: "rotatePrimitive3", id: "cyl-1", axis: "x", degrees: 90 })

      expect(rotated.changed).toBe(true)
      const solid = solidOf(rotated.document)
      expect(solid.rotation?.x).toBeCloseTo(Math.PI / 2, 12)
      expect(solid.rotation?.y ?? 0).toBeCloseTo(0, 12)
      expect(solid.rotation?.z ?? 0).toBeCloseTo(0, 12)
      // 绕自身中心转：定位锚点不动，半径与高也不动。
      expect(solid.center).toEqual({ x: 0, y: 0, z: 0 })
      expect(solid.radius).toBe(1)
      expect(solid.height).toBe(4)
    })

    it("carries the generated topology with the new orientation", () => {
      const document = cylinderDocument()
      const polyhedron = document.primitives.find((primitive) => primitive.type === "polyhedron3") as unknown as { vertexIds: string[] }
      // 顶环上的顶点：转 90° 之后竖直的轴该躺成 −Y 方向，这个点最能说明问题。
      const vertexId = polyhedron.vertexIds.find((id) => positionOfVector(document, id).z > 3)!

      const rotated = commitPatch(document, { op: "rotatePrimitive3", id: "cyl-1", axis: "x", degrees: 90 })

      // 画布上真正画出来的是这些物化顶点：它们不跟过来，用户看到的圆柱就"没转"。
      const before = positionOfVector(document, vertexId)
      const after = positionOfVector(rotated.document, vertexId)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(-2, 9)
      expect(after.z).toBeCloseTo(2, 9)
    })

    /**
     * 组合矩阵等价性：**先按原朝向摆好、再绕世界轴转**（`R_axis · R_euler`），不是把角度直接加到某个字段上。
     * 这条是"拖着转"和属性栏角度共用的语义，写错了在连续两次旋转时会露馅。
     */
    it("composes with the existing orientation instead of replacing it", () => {
      const leaned = commitPatch(cylinderDocument(), { op: "rotatePrimitive3", id: "cyl-1", axis: "x", degrees: 90 }).document
      const turned = commitPatch(leaned, { op: "rotatePrimitive3", id: "cyl-1", axis: "z", degrees: 90 })

      const solid = solidOf(turned.document)
      const expected = multiplyRotationMatrix3(axisRotationMatrix3("z", Math.PI / 2), eulerRotationMatrix3({ x: Math.PI / 2, y: 0, z: 0 }))
      const actual = eulerRotationMatrix3(solid.rotation ?? { x: 0, y: 0, z: 0 })
      for (let index = 0; index < 9; index += 1) expect(actual[index]).toBeCloseTo(expected[index], 9)
      // 与 `composeEuler3` 同一份实现：读数与矩阵不会各说各话。
      expect(solid.rotation?.x).toBeCloseTo(composeEuler3({ x: Math.PI / 2, y: 0, z: 0 }, "z", Math.PI / 2).x, 12)
    })

    it("orbits the solid around an explicit pivot", () => {
      const document = cylinderDocument()
      const pivot = { x: 0, y: 4, z: 0 }
      const centreBefore = templateSolidPivot(solidPrimitive(document))

      const rotated = commitPatch(document, { op: "rotatePrimitive3", id: "cyl-1", axis: "x", degrees: 90, pivot })

      const solid = solidOf(rotated.document)
      const centreAfter = templateSolidPivot(solidPrimitive(rotated.document))
      const expected = rotatePointAboutAxis3(centreBefore, pivot, "x", Math.PI / 2)
      expect(centreAfter.x).toBeCloseTo(expected.x, 12)
      expect(centreAfter.y).toBeCloseTo(expected.y, 12)
      expect(centreAfter.z).toBeCloseTo(expected.z, 12)
      // 中心真的挪了位置（不是"读数转了、实体还杵在原地"）。
      expect(Math.hypot(centreAfter.y - centreBefore.y, centreAfter.z - centreBefore.z)).toBeGreaterThan(1)
      expect(solid.rotation?.x).toBeCloseTo(Math.PI / 2, 12)
    })

    it("refuses generated topology, a locked solid and a non-finite angle", () => {
      const document = cylinderDocument()
      const polyhedronId = (document.primitives.find((primitive) => primitive.type === "polyhedron3") as { id: string }).id
      expect(commitPatch(document, { op: "rotatePrimitive3", id: polyhedronId, axis: "x", degrees: 90 }).changed).toBe(false)
      expect(commitPatch(document, { op: "rotatePrimitive3", id: "cyl-1", axis: "w" as "x", degrees: 90 }).changed).toBe(false)
      expect(commitPatch(document, { op: "rotatePrimitive3", id: "cyl-1", axis: "x", degrees: Number.NaN }).changed).toBe(false)

      const locked = commitPatch(document, { op: "toggleLock", id: "cyl-1", locked: true }).document
      expect(commitPatch(locked, { op: "rotatePrimitive3", id: "cyl-1", axis: "x", degrees: 90 }).changed).toBe(false)
    })

    it("is one undoable step per committed rotation", () => {
      const document = cylinderDocument()
      const rotated = commitPatch(document, { op: "rotatePrimitive3", id: "cyl-1", axis: "x", degrees: 90 }).document
      // 一次拖动 = 一次操作：撤销只要退回上一个文档。
      expect(solidOf(document).rotation).toBeUndefined()
      expect(solidOf(rotated).rotation?.x).toBeCloseTo(Math.PI / 2, 12)
    })
  })
})

describe("section plane", () => {
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }

  function sectionDocument() {
    const document = createEmptyDocument("geometry3d")
    return commitPatch(document, { op: "addPrimitives", primitives: [cube, ...buildSolidTemplate(cube).primitives] }).document
  }

  const sectionOf = (document: ReturnType<typeof sectionDocument>, id = "section-1") => document.primitives.find((candidate) => candidate.id === id) as Extract<PrimitiveSpec, { type: "section" }>
  /** Mean of one coordinate over a point list: a rigid translation shows up here even at a single point. */
  const meanCoordinate = (points: { x: number; y: number; z: number }[], axis: "x" | "y" | "z") => points.reduce((sum, point) => sum + point[axis], 0) / Math.max(points.length, 1)

  function withSection() {
    const document = sectionDocument()
    const plane = sectionPlaneThroughSource(document, "cube-1")!
    return commitPatch(document, { op: "addPrimitive", primitive: { id: "section-1", type: "section", sourceId: "cube-1", plane, points: [], classification: "none", status: "undefined" } }).document
  }

  it("starts as the horizontal plane through the solid's middle", () => {
    const document = withSection()

    // 世界是 Z 轴朝上：默认剖切面是过实体中心的**水平面**（法向 +Z），立方体 y 跨度 -1..1、z 跨度 -1..1。
    expect(sectionOf(document).plane).toEqual({ normal: { x: 0, y: 0, z: 1 }, constant: -0 })
    expect(sectionOf(document).classification).toBe("polygon")
    expect(sectionOf(document).points).toHaveLength(4)
  })

  it("moves the cutting plane along its normal and re-derives the section in the same commit", () => {
    const document = withSection()
    const before = sectionPlaneOffset(sectionOf(document).plane)
    // A positive distance pushes the plane along the normal (here +Y), so the cut rises.
    const moved = commitPatch(document, { op: "moveSectionPlane", id: "section-1", distance: 0.5 })

    expect(moved.changed).toBe(true)
    expect(sectionPlaneOffset(sectionOf(moved.document).plane) - before).toBeCloseTo(0.5, 10)
    // Same square, shifted up: every section point must carry the new height, not the old one.
    for (const point of sectionOf(moved.document).points) expect(point.z).toBeCloseTo(0.5, 6)
  })

  it("shows a smaller section as the plane approaches a face, and hides it once it is past the solid", () => {
    const document = withSection()
    const nearFace = commitPatch(document, { op: "moveSectionPlane", id: "section-1", distance: 0.95 }).document
    const pastSolid = commitPatch(nearFace, { op: "moveSectionPlane", id: "section-1", distance: 0.2 }).document

    expect(sectionOf(nearFace).classification).toBe("polygon")
    // A cut beyond the solid has no points at all: it must not leave a stale square on screen.
    expect(sectionOf(pastSolid).points).toHaveLength(0)
    expect(sectionOf(pastSolid).visible).toBe(false)
  })

  it("keeps a rotated plane's normal untouched so distance stays in world units", () => {
    const document = sectionDocument()
    // A deliberately un-normalised normal: 1 world unit must still mean 1 unit of travel.
    const plane = { normal: { x: 0, y: 3, z: 4 }, constant: -5 }
    const withTilted = commitPatch(document, { op: "addPrimitive", primitive: { id: "section-2", type: "section", sourceId: "cube-1", plane, points: [], classification: "none", status: "undefined" } }).document
    const offsetBefore = sectionPlaneOffset(sectionOf(withTilted, "section-2").plane)

    const moved = commitPatch(withTilted, { op: "moveSectionPlane", id: "section-2", distance: 1 })

    const stored = sectionOf(moved.document, "section-2").plane
    // Normalising while also moving the plane makes it drift by (|n| - 1) extra units, so keep the normal as-is.
    expect(stored.normal).toEqual(plane.normal)
    expect(sectionPlaneOffset(stored) - offsetBefore).toBeCloseTo(1, 10)
  })

  it("rejects moving something that is not a section, a locked section, or a non-finite distance", () => {
    const document = withSection()

    expect(commitPatch(document, { op: "moveSectionPlane", id: "cube-1", distance: 1 }).changed).toBe(false)
    expect(commitPatch(document, { op: "moveSectionPlane", id: "section-1", distance: Number.NaN }).changed).toBe(false)

    const locked = commitPatch(document, { op: "toggleLock", id: "section-1", locked: true }).document
    expect(commitPatch(locked, { op: "moveSectionPlane", id: "section-1", distance: 1 }).changed).toBe(false)
  })

  it("tilts the plane about a given pivot so the cut still crosses the solid", () => {
    const document = withSection()
    // Rotating about the plane's own closest point to the origin slides the plane out of the solid
    // (measured: distance from the origin fell from 1.5 to 0.15). A tipped knife must pivot *through* the
    // solid, so the UI passes the solid's centre.
    const centre = { x: 0, y: 0, z: 0 }
    const turned = commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "x", degrees: 30, pivot: centre })

    expect(turned.changed).toBe(true)
    const after = sectionOf(turned.document)
    expect(Math.hypot(after.plane.normal.x, after.plane.normal.y, after.plane.normal.z)).toBeCloseTo(1, 10)
    // The plane still passes through the pivot, so the cut stays inside the cube (no -0 / +0 games).
    expect(sectionDistanceToPlane(after.plane, centre)).toBeCloseTo(0, 10)
    expect(after.points.length).toBeGreaterThanOrEqual(3)
  })

  it("keeps the cut inside the solid across a run of tilts", () => {
    const document = withSection()
    const centre = { x: 0, y: 0, z: 0 }
    let turned = document
    // Tilts that keep the normal off the axis-aligned knife-edge stay well-behaved.
    for (const [axis, degrees] of [["x", 30], ["y", 45], ["z", 40]] as const) {
      turned = commitPatch(turned, { op: "rotateSectionPlane", id: "section-1", axis, degrees, pivot: centre }).document
      // Whatever the tilt, the plane goes through the solid's centre, so there is always a real section.
      expect(sectionDistanceToPlane(sectionOf(turned).plane, centre)).toBeCloseTo(0, 10)
      expect(sectionOf(turned).points.length).toBeGreaterThanOrEqual(3)
    }
    const normal = sectionOf(turned).plane.normal
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 10)
  })

  it("turns a horizontal plane into a vertical one at 90°", () => {
    const document = withSection()
    const turned = commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "x", degrees: 90, pivot: { x: 0, y: 0, z: 0 } })

    const after = sectionOf(turned.document)
    // The orientation is exactly what was asked for, and the plane still passes through the pivot.
    // 默认法向是 +Z，绕 X 轴转 90° 之后变成 ±Y —— 也就是从水平剖切面变成竖直剖切面。
    expect(after.plane.normal.x).toBeCloseTo(0, 10)
    expect(Math.abs(after.plane.normal.y)).toBeCloseTo(1, 10)
    expect(after.plane.normal.z).toBeCloseTo(0, 10)
    expect(sectionDistanceToPlane(after.plane, { x: 0, y: 0, z: 0 })).toBeCloseTo(0, 10)
    // 轴对齐法向曾经在这里解析失败：旋转出来的法向带 ~1e-17 的残差，同一个交点在不同面上算出的
    // 坐标差几个 ulp，固定小数位的键分不开它们，于是"连不成闭合边界"。点键改成按模型尺度量化后
    // 轴对齐也能正常成环——这条断言就是那个悬崖的回归。
    expect(after.status).toBe("approximate")
    expect(after.points).toHaveLength(4)
  })

  it("derives a pivot at the centre of a point set", () => {
    expect(sectionPivot([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }])).toEqual({ x: 2, y: 1, z: 0 })
    expect(sectionPivot([])).toBeNull()
  })

  it("accepts an explicit plane, so a face can become the cutting plane", () => {
    const document = withSection()

    const plane = planeThroughPoints([{ x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: -1, z: 1 }])!
    const applied = commitPatch(document, { op: "setSectionPlane", id: "section-1", normal: plane.normal, constant: plane.constant })

    expect(applied.changed).toBe(true)
    // The cube's x = 1 face is the cut: the section is that whole square.
    const after = sectionOf(applied.document)
    expect(after.plane.normal.x).toBeCloseTo(1, 10)
    expect(after.points).toHaveLength(4)
    for (const point of after.points) expect(point.x).toBeCloseTo(1, 6)
  })

  it("rejects a degenerate or non-finite plane, and a rotation with a bad axis", () => {
    const document = withSection()

    expect(commitPatch(document, { op: "setSectionPlane", id: "section-1", normal: { x: 0, y: 0, z: 0 }, constant: 0 }).changed).toBe(false)
    expect(commitPatch(document, { op: "setSectionPlane", id: "section-1", normal: { x: 0, y: 1, z: 0 }, constant: Number.NaN }).changed).toBe(false)
    expect(commitPatch(document, { op: "setSectionPlane", id: "cube-1", normal: { x: 0, y: 1, z: 0 }, constant: 0 }).changed).toBe(false)
    expect(commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "w" as "x", degrees: 15 }).changed).toBe(false)
    expect(commitPatch(document, { op: "rotateSectionPlane", id: "section-1", axis: "x", degrees: Number.NaN }).changed).toBe(false)
  })

  it("refuses to build a plane from points that do not lie in one", () => {
    // Any three points are coplanar, so the real test needs a fourth off the plane.
    expect(planeThroughPoints([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }])).toBeNull()
    // A warped quadrilateral: the first three define one plane, the fourth sits clearly off it.
    expect(planeThroughPoints([{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }, { x: -1, y: 0, z: 1 }, { x: 0, y: -1, z: 0.5 }])).toBeNull()
    expect(planeThroughPoints([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBeNull()
    // A real face ring still resolves, and its plane is the face's own.
    const face = planeThroughPoints([{ x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 }])
    expect(face).not.toBeNull()
    expect(Math.abs(face!.normal.z)).toBeCloseTo(1, 10)
    expect(face!.constant).toBeCloseTo(1, 10)
  })

  it("moves the section together with its source when the solid is dragged", () => {
    const document = withSection()
    const centreBefore = meanCoordinate(sectionOf(document).points, "x")
    // Drag the cube sideways: the horizontal cut plane still crosses it, so the section must follow.
    const moved = commitPatch(document, { op: "translatePrimitive3", id: "cube-1", delta: { x: 2, y: 0, z: 0 } })

    // A section names its source by id, so it is not in the dependency index: without an explicit re-derive
    // here the drawn cut would keep its old coordinates while the solid moves away from it.
    expect(sectionOf(moved.document).status).toBe("approximate")
    expect(sectionOf(moved.document).points).toHaveLength(4)
    expect(meanCoordinate(sectionOf(moved.document).points, "x") - centreBefore).toBeCloseTo(2, 6)
    // The plane itself is document state the user may have positioned: dragging the solid must not reset it.
    expect(sectionOf(moved.document).plane.constant).toEqual(sectionOf(document).plane.constant)
  })
})

describe("engineering workbench operations", () => {
  it("adds a child layer and activates it", () => {
    const document = cadDocument()
    const layer = { id: "layer-detail", name: "细节", parentId: "layer-geometry", kind: "geometry" as const, visible: true, locked: false, printable: true }

    const added = commitPatch(document, { op: "addLayer", layer } as never)
    const activated = commitPatch(added.document, { op: "setActiveLayer", id: layer.id } as never)

    expect(added.changed).toBe(true)
    expect(activated.document.layers).toContainEqual(layer)
    expect(activated.document.activeLayerId).toBe(layer.id)
  })

  it("reassigns primitives when deleting a layer", () => {
    const document = cadDocument()
    document.layers!.push({ id: "layer-detail", name: "细节", parentId: "layer-geometry", kind: "geometry", visible: true, locked: false, printable: true })
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2, layerId: "layer-detail" }]

    const result = commitPatch(document, { op: "deleteLayer", id: "layer-detail", reassignTo: "layer-geometry" } as never)

    expect(result.changed).toBe(true)
    expect(result.document.layers?.some((layer) => layer.id === "layer-detail")).toBe(false)
    expect(result.document.primitives[0].layerId).toBe("layer-geometry")
  })

  it("updates a drawing view layout without changing its projected source", () => {
    const document = cadDocument()
    const result = commitPatch(document, { op: "updateDrawingView", id: "view-front", patch: { x: 80, y: 90, width: 420, scale: 2 } } as never)
    const view = result.document.drawingViews?.find((candidate) => candidate.id === "view-front")

    expect(result.changed).toBe(true)
    expect(view).toMatchObject({ x: 80, y: 90, width: 420, height: 220, scale: 2, kind: "front" })
  })

  it("rejects deleting a view referenced by a sheet", () => {
    const document = cadDocument()

    const result = commitPatch(document, { op: "deleteDrawingView", id: "view-front" } as never)

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.error).toContain("drawing view is referenced by a sheet")
  })
})

describe("function analysis deletion", () => {
  /** A legacy calculus document: the analysis objects exist only to describe the function they came from. */
  function documentWithFunctionAnalysis() {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "fn-1", type: "function", expression: "x*x", domain: [-6, 6], samples: 128, label: "旧函数" },
      { id: "derivative-1", type: "derivative", sourceId: "fn-1", order: 1, domain: [-6, 6], samples: 128, points: [], status: "approximate" },
      { id: "tangent-1", type: "tangent", sourceId: "fn-1", x: 1, point: { x: 1, y: 1 }, slope: 2, a: { x: -6, y: -11 }, b: { x: 6, y: 13 }, status: "approximate" },
      { id: "normal-1", type: "normal", sourceId: "fn-1", x: 1, point: { x: 1, y: 1 }, slope: -0.5, a: { x: -6, y: 4.5 }, b: { x: 6, y: -1.5 }, status: "approximate" },
      { id: "secant-1", type: "secant", sourceId: "fn-1", x1: -1, x2: 1, points: [{ x: -1, y: 1 }, { x: 1, y: 1 }], slope: 0, a: { x: -6, y: 1 }, b: { x: 6, y: 1 }, status: "approximate" },
      { id: "integral-1", type: "integral", sourceId: "fn-1", domain: [-1, 1], steps: 64, points: [], area: 0.66, status: "approximate" },
      { id: "analysis-1", type: "analysisSet", sourceId: "fn-1", domain: [-6, 6], samples: 128, results: [], status: "approximate" },
      { id: "keep-line", type: "line", a: { x: -1, y: 3 }, b: { x: 1, y: 3 }, label: "保留直线" }
    ] as PrimitiveSpec[]
    return document
  }

  it("deletes a function together with its derived analysis objects", () => {
    const document = documentWithFunctionAnalysis()

    const result = commitPatch(document, { op: "deleteObject", id: "fn-1" })

    expect(result.changed).toBe(true)
    expect(result.document.primitives.map((primitive) => primitive.id)).toEqual(["keep-line"])
  })

  it("deletes one derived analysis object without touching the source function", () => {
    const document = documentWithFunctionAnalysis()

    const result = commitPatch(document, { op: "deleteObject", id: "derivative-1" })

    expect(result.changed).toBe(true)
    expect(result.document.primitives.map((primitive) => primitive.id)).toContain("fn-1")
    expect(result.document.primitives.map((primitive) => primitive.id)).not.toContain("derivative-1")
  })
})

/**
 * 解析截面（A1 第 2 片）：源是圆柱 / 圆锥时，`recomputeSection` 除了照旧写多边形边界，
 * 还要写**精确**的圆锥曲线片段环（`section.exact`）并把状态升为 `exact`——弯曲边界已经精确，
 * 不该再说"数值近似"。多边形字段继续写，拾取与旧消费方仍读它。
 */
describe("analytic section of round solids", () => {
  const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 3, segments: 48 }
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }

  function documentWithSection(source: { id: string; type: "cylinder" | "cube" }, plane: { normal: { x: number; y: number; z: number }; constant: number }) {
    const document = createEmptyDocument("geometry3d")
    const solid = source.type === "cylinder" ? cylinder : cube
    const withSolid = commitPatch(document, { op: "addPrimitives", primitives: [solid, ...buildSolidTemplate(solid).primitives] }).document
    return commitPatch(withSolid, { op: "addPrimitive", primitive: { id: "section-1", type: "section", sourceId: source.id, plane, points: [], classification: "none", status: "undefined" } }).document
  }

  const sectionOf = (document: ReturnType<typeof documentWithSection>) => document.primitives.find((candidate) => candidate.id === "section-1") as Extract<PrimitiveSpec, { type: "section" }>

  it("writes the exact circle for a perpendicular cut and keeps the polygon boundary too", () => {
    const section = sectionOf(documentWithSection(cylinder, { normal: { x: 0, y: 0, z: 1 }, constant: -1 }))

    expect(section.exact?.kind).toBe("circle")
    expect(section.exact?.loops).toHaveLength(1)
    expect(section.status).toBe("exact")
    // 多边形路径照旧：拾取与旧消费方仍读 points / classification。
    expect(section.classification).toBe("polygon")
    expect(section.points.length).toBeGreaterThanOrEqual(3)
  })

  it("turns the exact boundary into an ellipse when the plane is tilted", () => {
    const degrees = (value: number) => (value * Math.PI) / 180
    const withCircle = documentWithSection(cylinder, { normal: { x: 0, y: 0, z: 1 }, constant: -1 })
    const theta = degrees(30)
    const tilted = commitPatch(withCircle, { op: "setSectionPlane", id: "section-1", normal: { x: Math.sin(theta), y: 0, z: Math.cos(theta) }, constant: -1.2 * Math.cos(theta) }).document
    const section = sectionOf(tilted)

    expect(section.exact?.kind).toBe("ellipse")
    expect(section.exact?.loops[0].length).toBeGreaterThanOrEqual(1)
    expect(section.status).toBe("exact")
  })

  it("leaves a polygon source without an analytic boundary", () => {
    const section = sectionOf(documentWithSection(cube, { normal: { x: 0, y: 0, z: 1 }, constant: 0 }))

    expect(section.exact).toBeUndefined()
    expect(section.status).toBe("approximate")
    expect(section.classification).toBe("polygon")
  })
})

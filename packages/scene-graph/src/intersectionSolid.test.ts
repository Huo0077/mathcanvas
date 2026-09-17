import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
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

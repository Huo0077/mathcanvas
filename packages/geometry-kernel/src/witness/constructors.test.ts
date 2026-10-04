import { describe, expect, it } from "vitest"

import { areCoplanar, crossVector3, distanceVector3, dotVector3, subtractVector3, type Vector3 } from "../geometry3d"
import { dihedralAngleDetail3 } from "../markers3d"
import { buildFromPoints, createBuilderContext } from "../solid-builders"

import { constructPrismWitness, constructPyramidWitness, type PyramidConstructRequest, type WitnessRelation } from "./constructors"
import { candidateResiduals } from "./residuals"

/**
 * **解析见证构造**（N2 子任务 2a；计划 N2 RED 项）。
 *
 * 这一层只做**纯几何**：题面点名的顶点 + 题面陈述的关系 → 一组候选坐标。
 * 它不判断"这张图是否满足题设"（那是 2b 的 `verifyDiagramObligations` + `buildFromPoints`），
 * 只保证构造本身确定性、可复算，并且拒绝时**给出结构化的理由**而不是抛异常。
 *
 * 三条 RED 判据（控制器 R17）在这里各有一组用例：
 * 1. 确定性：同输入同输出、无 RNG（还有一条源码级守卫）；
 * 2. 退化 / 尺度守卫：拒绝要带 `code`，不能抛、不能悄悄返回坏候选；
 * 3. 独立回代：用内核自己的距离 / 角度函数重算被要求的关系，**不复用构造过程的中间量**。
 */

const TOLERANCE = 1e-9

function indexOf(witness: { names: string[] }, name: string): number {
  const index = witness.names.indexOf(name)
  expect(index, `witness should name ${name}`).toBeGreaterThanOrEqual(0)
  return index
}

/** 按 `buildOrder` 重排出的坐标数组：与 `points` 是同一套下标空间（构造器承诺）。 */
function orderedPoints(witness: { points: Vector3[]; buildOrder: number[] }): Vector3[] {
  return witness.buildOrder.map((index) => witness.points[index])
}

/** 面的内二面角（度）。两个环由**用例自己**按题面顺序给出，不借构造过程。 */
function interiorDihedralDegrees(firstRing: Vector3[], secondRing: Vector3[], hingeStart: Vector3, hingeEnd: Vector3): number {
  const detail = dihedralAngleDetail3(firstRing, secondRing, hingeStart, hingeEnd)
  expect(detail, "the kernel must be able to measure this dihedral angle").not.toBeNull()
  return detail ? detail.interiorDegrees : Number.NaN
}

/** 由三点算平面单位法向（用例自己的中间量，与构造无关）。 */
function unitNormal(first: Vector3, second: Vector3, third: Vector3): Vector3 {
  const normal = crossVector3(subtractVector3(second, first), subtractVector3(third, first))
  const length = Math.hypot(normal.x, normal.y, normal.z)
  return { x: normal.x / length, y: normal.y / length, z: normal.z / length }
}

function vectorLength(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

/**
 * 代表题的题面关系（`apps/web/src/agent/representativeFixtures.ts` 的 `PYRAMID_RELATIONS`）：
 * `PA ⊥ 平面 ABCD`、`BC ∥ AD`、`AB ⊥ AD`。**没有显式坐标** —— 这正是 R18 钉死的第一批情形。
 */
const PYRAMID_RELATIONS: WitnessRelation[] = [
  { kind: "perpendicular", segments: [["P", "A"], ["A", "B"], ["A", "D"]] },
  { kind: "parallel", segments: [["B", "C"], ["A", "D"]] },
  { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] }
]

function pyramidRequest(overrides: {
  relations?: WitnessRelation[]
  base?: string[]
  apex?: PyramidConstructRequest["apex"]
} = {}): PyramidConstructRequest {
  return {
    shape: "pyramid",
    base: overrides.base ?? ["A", "B", "C", "D"],
    apex: overrides.apex ?? { at: "P" },
    relations: overrides.relations ?? PYRAMID_RELATIONS
  }
}

describe("constructPyramidWitness", () => {
  it("reconstructs the representative P-ABCD pyramid exactly, and the kernel accepts the topology", () => {
    const result = constructPyramidWitness(
      pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 4 } } })
    )
    expect(result.status).toBe("candidate")
    if (result.status !== "candidate") return
    const witness = result.witness

    /**
     * 下标空间只有一套：`points` / `faces` / `buildOrder` 都按「底面环 + 顶点」的原生顺序。
     * 代表题夹具的 `[P, A, B, C, D]` 顺序由 `PYRAMID_VERTICES` 自己表达，构造器不替它重排
     *（重排过一次：`faces` 是原生下标、`buildOrder` 是夹具下标，两者一混内核就报 `non-planar-base`）。
     */
    expect(witness.buildOrder).toEqual([0, 1, 2, 3, 4])
    expect(witness.names).toEqual(["A", "B", "C", "D", "P"])
    expect(witness.points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 },
      { x: 0, y: 0, z: 4 }
    ])
    expect(orderedPoints(witness)).toEqual(witness.points)
    // 底面环就是 [A, B, C, D]；P 是第 5 个（下标 4）。
    expect(new Set(witness.faces[0])).toEqual(new Set([0, 1, 2, 3]))
    expect(indexOf(witness, "P")).toBe(4)
    // 按题面顺序 [P, A, B, C, D] 取坐标，正好等于代表题夹具的 `PYRAMID_VERTICES`。
    const at = (name: string): Vector3 => witness.points[indexOf(witness, name)]
    expect(["P", "A", "B", "C", "D"].map(at)).toEqual([
      { x: 0, y: 0, z: 4 },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 }
    ])

    /**
     * 面环**按规则构造**（底面 + 每个底棱一个侧面 + 朝外归一化），不是手推 ——
     * 焊死"拓扑能过内核"这件事。绕向若不对，`buildFromPoints` 会报 `inconsistent-winding` / `non-planar-base`。
     */
    const faces = witness.faces
    expect(faces).toHaveLength(5)
    for (const face of faces) expect(face.length).toBeGreaterThanOrEqual(3)
    const built = buildFromPoints({ vertices: orderedPoints(witness), faces }, createBuilderContext("witness"))
    expect(built.diagnostics).toEqual([])
    expect(built.polyhedronId).toBeDefined()
  })

  it("re-verifies every stated relation with kernel distance and angle functions (no constructor intermediates)", () => {
    // 高显式给 4：自由示例值取 1 会让"高"退化成一个与本题无关的单位值，而这条用例要钉的是
    // "三条题面关系在真实几何上成立"。
    const result = constructPyramidWitness(
      pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 4 } } })
    )
    expect(result.status).toBe("candidate")
    if (result.status !== "candidate") return
    const { points, names } = result.witness
    const at = (name: string): Vector3 => points[names.indexOf(name)]
    const A = at("A")
    const B = at("B")
    const C = at("C")
    const D = at("D")
    const P = at("P")

    /**
     * ① PA ⊥ 平面 ABCD：线面垂直 ⇔ 线段**平行于**底面法向（把判据写成"PA 与法向点积为 0"是写反了 ——
     * 那说的是"PA 落在底面内"）。两种等价写法都钉住：叉积为零（平行），且 PA 与 AB、AD 都垂直。
     */
    const normal = unitNormal(A, B, D)
    expect(vectorLength(crossVector3(subtractVector3(P, A), normal))).toBeLessThan(TOLERANCE)
    expect(Math.abs(dotVector3(subtractVector3(P, A), subtractVector3(B, A)))).toBeLessThan(TOLERANCE)
    expect(Math.abs(dotVector3(subtractVector3(P, A), subtractVector3(D, A)))).toBeLessThan(TOLERANCE)
    expect(areCoplanar([A, B, C, D])).toBe(true)
    expect(vectorLength(crossVector3(subtractVector3(B, A), subtractVector3(D, A)))).toBeGreaterThan(TOLERANCE)

    // ② BC ∥ AD：叉积为零且方向点积为正（平行，不是反向共线）。
    expect(vectorLength(crossVector3(subtractVector3(C, B), subtractVector3(D, A)))).toBeLessThan(TOLERANCE)
    expect(dotVector3(subtractVector3(C, B), subtractVector3(D, A))).toBeGreaterThan(0)

    // ③ AB ⊥ AD。
    expect(Math.abs(dotVector3(subtractVector3(B, A), subtractVector3(D, A)))).toBeLessThan(TOLERANCE)

    // 独立量尺：高、底棱、以及 P-AB / P-AD 两个侧面的内二面角都是 90°（线面垂直的可见后果）。
    expect(distanceVector3(P, A)).toBeCloseTo(4, 9)
    expect(distanceVector3(A, B)).toBeCloseTo(2, 9)
    expect(distanceVector3(A, D)).toBeCloseTo(3, 9)
    expect(distanceVector3(B, C)).toBeCloseTo(3, 9)
    expect(interiorDihedralDegrees([A, B, C, D], [P, A, B], A, B)).toBeCloseTo(90, 6)
    expect(interiorDihedralDegrees([A, B, C, D], [P, A, D], A, D)).toBeCloseTo(90, 6)
  })

  it("derives the apex height from a stated lateral edge length instead of copying a constant", () => {
    const result = constructPyramidWitness(
      pyramidRequest({
        apex: { at: "P", foot: "A", height: { kind: "lateral-edge", edge: ["P", "B"], length: 5 } }
      })
    )
    expect(result.status).toBe("candidate")
    if (result.status !== "candidate") return
    const { points, names } = result.witness
    const A = points[names.indexOf("A")]
    const B = points[names.indexOf("B")]
    const P = points[names.indexOf("P")]

    // 回代：|PB| 就是题面给的长度（由 `distanceVector3` 独立重算，不看 h 的中间量）。
    expect(distanceVector3(P, B)).toBeCloseTo(5, 9)
    // 且仍在 A 的正上方（PA 保持线面垂直）；h = √(5² − |AB|²) = √21。
    expect(distanceVector3(P, A)).toBeCloseTo(Math.sqrt(5 * 5 - 2 * 2), 9)
    expect(P.x).toBeCloseTo(A.x, 12)
    expect(P.y).toBeCloseTo(A.y, 12)
    expect(result.witness.freeValues.some((entry) => entry.includes("PB"))).toBe(true)
  })

  it("derives the apex height from a stated dihedral angle so the kernel measures exactly that angle", () => {
    /**
     * 垂足取 A、铰链取底棱 CD（**A 不在 CD 上**）：这是"顶点在 A 正上方"这一族里
     * 二面角真的随高变化的取法 —— 若铰链含垂足（或含顶点），那一组平面里必有一个过垂线，
     * 二面角就被钉死，高再怎么变也量不出题面那个角（那些情形由求根器失败 → 结构化拒绝兜住）。
     *
     * 解析值可以手算核对：`∠P-CD-A` 等于直角三角形 P-A-F 在 F 处的那个角（F 是 A 到 CD 的垂足），
     * 满足 `tan θ = h / |AF|`；本底面里 `|AF|` = 3（AB 方向的尺寸），所以 `h = 3·tan 60° = 3√3`。
     */
    const degrees = 60
    const result = constructPyramidWitness(
      pyramidRequest({
        relations: [
          ...PYRAMID_RELATIONS,
          { kind: "dihedral", segments: [["P", "C", "D"], ["A", "C", "D"]], value: degrees, unit: "degree" } satisfies WitnessRelation
        ],
        apex: { at: "P", foot: "A", height: { kind: "dihedral", angleRelation: "P-C-D" } }
      })
    )
    if (result.status !== "candidate") {
      throw new Error(`expected a candidate, got ${JSON.stringify(result)}`)
    }
    const { points, names, freeValues } = result.witness
    const at = (name: string): Vector3 => points[names.indexOf(name)]
    const A = at("A")
    const C = at("C")
    const D = at("D")

    // 独立回代：用内核自己的二面角度量核对最终坐标，并与手算的解析值比较。
    const measured = interiorDihedralDegrees([at("P"), C, D], [A, C, D], C, D)
    expect(measured).toBeCloseTo(degrees, 6)
    expect(distanceVector3(at("P"), A)).toBeCloseTo(3 * Math.tan((degrees * Math.PI) / 180), 6)
    // 顶点仍在 A 的正上方。
    expect(at("P").x).toBeCloseTo(A.x, 12)
    expect(at("P").y).toBeCloseTo(A.y, 12)
    // 求出来的高必须写进 freeValues 让用户看见。
    expect(freeValues.some((entry) => entry.includes("60"))).toBe(true)
  })

  it("rejects an apex that projects onto a base-ring vertex with a structured reason instead of throwing", () => {
    const result = constructPyramidWitness(
      pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 0 } } })
    )
    expect(result.status).toBe("rejected")
    if (result.status !== "rejected") return
    expect(result.code).toBe("degenerate-height")
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.detail?.points).toContain("P")
  })

  it("rejects a degenerate base with a structured reason", () => {
    const zeroEdge = constructPyramidWitness(
      pyramidRequest({
        base: ["A", "B", "C"],
        relations: [
          { kind: "perpendicular", segments: [["A", "B"], ["A", "C"]] },
          { kind: "segment-length", segments: [["A", "B"]], value: 0 }
        ],
        apex: { at: "P" }
      })
    )
    expect(zeroEdge.status).toBe("rejected")
    if (zeroEdge.status === "rejected") {
      expect(zeroEdge.code).toBe("degenerate-base")
      expect(zeroEdge.message.length).toBeGreaterThan(0)
    }
  })

  it("rejects a base ring that cannot define a polygon at all", () => {
    const tooSmall = constructPyramidWitness(pyramidRequest({ base: ["A", "B"] }))
    expect(tooSmall.status).toBe("rejected")
    if (tooSmall.status === "rejected") {
      expect(tooSmall.code).toBe("base-ring-too-small")
      expect(tooSmall.message.length).toBeGreaterThan(0)
    }
  })

  it("rejects non-finite inputs and unsupported base shapes as values, never exceptions", () => {
    const missingApex = constructPyramidWitness({ shape: "pyramid", base: ["A", "B", "C"], apex: null, relations: [] })
    expect(missingApex.status).toBe("rejected")
    if (missingApex.status === "rejected") expect(missingApex.code).toBe("missing-apex")

    const nonFinite = constructPyramidWitness(
      pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: Number.POSITIVE_INFINITY } } })
    )
    expect(nonFinite.status).toBe("rejected")
    if (nonFinite.status === "rejected") expect(nonFinite.code).toBe("non-finite-value")

    const repeatedApex = constructPyramidWitness(pyramidRequest({ apex: { at: "A" } }))
    expect(repeatedApex.status).toBe("rejected")
    if (repeatedApex.status === "rejected") expect(repeatedApex.code).toBe("duplicate-name")

    /**
     * 底面点名了两个**内部直角** ⇒ 直角梯形（矩形是更强的假设）⇒ 拒绝。
     *
     * 两条直角边分别点名在 A 与 B 处：`AB ⊥ AD` 与 `AB ⊥ BC`。这正是"用 `relation.segments.some`
     * 直接查两个端点"会漏判的那种输入 —— 一个关系里含多条边时，两次独立查询会各自命中同一条边。
     */
    const trapezoid = constructPyramidWitness(
      pyramidRequest({
        relations: [
          { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] },
          { kind: "parallel", segments: [["B", "C"], ["A", "D"]] },
          { kind: "perpendicular", segments: [["A", "B"], ["B", "C"]] }
        ]
      })
    )
    expect(trapezoid.status, `trapezoid: ${JSON.stringify(trapezoid)}`).toBe("rejected")
    if (trapezoid.status === "rejected") expect(trapezoid.code).toBe("unsupported-base-shape")

    // 五边形底面：首批不支持（只有 n = 3 / 4）。
    const pentagon = constructPyramidWitness(
      pyramidRequest({
        base: ["A", "B", "C", "D", "E"],
        relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "E"]] }]
      })
    )
    expect(pentagon.status, `pentagon: ${JSON.stringify(pentagon)}`).toBe("rejected")
    if (pentagon.status === "rejected") expect(pentagon.code).toBe("unsupported-base-shape")

    // 完全没点名环首的直角 ⇒ 底面无法唯一确定。
    const skewed = constructPyramidWitness(
      pyramidRequest({
        relations: [{ kind: "parallel", segments: [["A", "B"], ["C", "D"]] }, { kind: "parallel", segments: [["B", "C"], ["A", "D"]] }]
      })
    )
    expect(skewed.status).toBe("rejected")
    if (skewed.status === "rejected") expect(skewed.code).toBe("unsupported-base-shape")
  })

  it("does not mutate the request and is deterministic across repeated calls (no RNG)", () => {
    const request = pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 4 } } })
    const before = JSON.stringify(request)
    const first = constructPyramidWitness(request)
    const second = constructPyramidWitness(request)
    expect(JSON.stringify(request)).toBe(before)
    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))

    /**
     * **无 RNG 的证据**：连跑 25 次、逐字节比较。构造器里任何 `Math.random` / 时间 / Map 迭代
     * 顺序依赖都会让某一轮不同 —— 这比读源码扫关键字更直接（测试环境是 jsdom，没有 `node:fs`）。
     */
    const fingerprint = JSON.stringify(first)
    for (let round = 0; round < 25; round += 1) {
      expect(JSON.stringify(constructPyramidWitness(pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 4 } } })))).toBe(fingerprint)
    }
    // 参数顺序不同但语义相同的请求也应给出同一组坐标（不依赖对象键顺序）。
    expect(constructPyramidWitness(pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 4 } } }))).toEqual(first)
  })

  it("rejects candidates whose magnitudes are not representable relative to each other", () => {
    const result = constructPyramidWitness(
      pyramidRequest({
        apex: { at: "P", foot: "A", height: { kind: "fixed", value: 1e12 } },
        relations: [...PYRAMID_RELATIONS, { kind: "segment-length", segments: [["A", "B"]], value: 1e-3 }]
      })
    )
    expect(result.status).toBe("rejected")
    if (result.status !== "rejected") return
    expect(result.code).toBe("extreme-scale")
  })
})

describe("constructPrismWitness", () => {
  it("extrudes the base ring by the stated vector and re-verifies the prism properties", () => {
    const result = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "C"],
      relations: [
        { kind: "perpendicular", segments: [["A", "B"], ["A", "C"]] },
        { kind: "segment-length", segments: [["A", "B"]], value: 3 },
        { kind: "segment-length", segments: [["A", "C"]], value: 4 }
      ],
      extrusion: { kind: "vector", vector: { x: 0, y: 0, z: 5 } }
    })
    expect(result.status).toBe("candidate")
    if (result.status !== "candidate") return
    const { points, names, faces } = result.witness
    const at = (name: string): Vector3 => points[names.indexOf(name)]

    // 顶点顺序 [A, B, C, A′, B′, C′]（与 `buildPrismTopology` 的 B 环 + T 环同序）。
    expect(result.witness.buildOrder).toEqual([0, 1, 2, 3, 4, 5])
    expect(names).toEqual(["A", "B", "C", "A′", "B′", "C′"])
    expect(orderedPoints(result.witness)).toEqual([at("A"), at("B"), at("C"), at("A′"), at("B′"), at("C′")])

    // 每个顶面顶点 = 底面对应点 + 向量（用内核距离独立回代）。
    const extrusion = { x: 0, y: 0, z: 5 }
    for (const name of ["A", "B", "C"]) {
      const top = { x: at(name).x + extrusion.x, y: at(name).y + extrusion.y, z: at(name).z + extrusion.z }
      expect(distanceVector3(at(`${name}′`), top)).toBeLessThan(TOLERANCE)
    }
    // 全等：底棱与顶棱等长、侧棱等长且平行。
    expect(distanceVector3(at("A′"), at("B′"))).toBeCloseTo(distanceVector3(at("A"), at("B")), 9)
    expect(distanceVector3(at("A"), at("A′"))).toBeCloseTo(5, 9)
    expect(distanceVector3(at("B"), at("B′"))).toBeCloseTo(5, 9)
    expect(Math.abs(dotVector3(subtractVector3(at("A′"), at("A")), subtractVector3(at("B′"), at("B"))))).toBeCloseTo(25, 9)

    // 拓扑由规则生成（底面 + 顶面 + 侧面 + 朝外归一化），内核必须接受。
    const built = buildFromPoints({ vertices: orderedPoints(result.witness), faces }, createBuilderContext("witness"))
    expect(built.diagnostics).toEqual([])
  })

  it("rejects an extrusion parallel to the base (zero volume) with a structured reason", () => {
    const result = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "C"],
      relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "C"]] }],
      extrusion: { kind: "vector", vector: { x: 1, y: 0, z: 0 } }
    })
    expect(result.status).toBe("rejected")
    if (result.status !== "rejected") return
    expect(result.code).toBe("degenerate-extrusion")
    expect(result.detail?.points).toContain("A")
  })

  it("rejects an unknown extrusion and a duplicated vertex name without throwing", () => {
    const unknown = constructPrismWitness({ shape: "prism", base: ["A", "B", "C"], relations: [], extrusion: { kind: "unknown" } })
    expect(unknown.status).toBe("rejected")
    if (unknown.status === "rejected") expect(unknown.code).toBe("missing-extrusion")

    const duplicated = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "A"],
      relations: [],
      extrusion: { kind: "vector", vector: { x: 0, y: 0, z: 2 } }
    })
    expect(duplicated.status).toBe("rejected")
    if (duplicated.status === "rejected") expect(duplicated.code).toBe("duplicate-name")
  })
})

describe("candidateResiduals", () => {
  const unitSquare: Vector3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 }
  ]

  it("accepts a healthy point set and reports its shape / scale measurements", () => {
    const report = candidateResiduals({ points: unitSquare })
    expect(report.acceptable).toBe(true)
    expect(report.diagnostics).toEqual([])
    expect(report.metrics.vertexCount).toBe(4)
    expect(report.metrics.diameter).toBeCloseTo(Math.SQRT2, 12)
    expect(report.metrics.minEdgeLength).toBeCloseTo(1, 12)
    expect(report.metrics.maxEdgeLength).toBeCloseTo(1, 12)
    expect(report.metrics.aspectRatio).toBeCloseTo(Math.SQRT2, 12)
    expect(report.metrics.coplanar).toBe(true)
  })

  it("rejects a zero-length edge with `degenerate-edge` and a reason, not an exception", () => {
    const report = candidateResiduals({
      points: [...unitSquare.slice(0, 3), { x: 1, y: 1, z: 0 }]
    })
    expect(report.acceptable).toBe(false)
    expect(report.diagnostics.map((entry) => entry.code)).toContain("degenerate-edge")
    expect(report.metrics.minEdgeLength).toBe(0)
    for (const entry of report.diagnostics) expect(entry.message.length).toBeGreaterThan(0)
  })

  it("rejects a collinear ring and a non-coplanar base with the matching codes", () => {
    const collinear = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 }
      ]
    })
    expect(collinear.acceptable).toBe(false)
    expect(collinear.diagnostics.map((entry) => entry.code)).toContain("degenerate-collinear")

    const nonPlanar = candidateResiduals({ points: [...unitSquare.slice(0, 3), { x: 0, y: 1, z: 0.5 }] })
    expect(nonPlanar.acceptable).toBe(false)
    expect(nonPlanar.diagnostics.map((entry) => entry.code)).toContain("non-coplanar-base")
    expect(nonPlanar.metrics.coplanar).toBe(false)
  })

  it("rejects an extreme aspect ratio with `extreme-aspect-ratio` and reports the ratio", () => {
    const report = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1e-9, y: 0, z: 0 },
        { x: 1e-9, y: 1e3, z: 0 },
        { x: 0, y: 1e3, z: 0 }
      ]
    })
    expect(report.acceptable).toBe(false)
    expect(report.diagnostics.map((entry) => entry.code)).toContain("extreme-aspect-ratio")
    expect(report.metrics.aspectRatio).toBeGreaterThan(1e6)
  })

  it("rejects non-finite and non-representable candidate coordinates", () => {
    const nonFinite = candidateResiduals({ points: [{ x: Number.NaN, y: 0, z: 0 }, ...unitSquare.slice(1)] })
    expect(nonFinite.acceptable).toBe(false)
    expect(nonFinite.diagnostics.map((entry) => entry.code)).toContain("non-finite-value")

    const mixedMagnitude = candidateResiduals({ points: [{ x: 1e140, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] })
    expect(mixedMagnitude.acceptable).toBe(false)
    expect(mixedMagnitude.diagnostics.map((entry) => entry.code)).toContain("magnitude-unrepresentable")
  })

  it("checks face rings when they are supplied", () => {
    const healthy = candidateResiduals({ points: unitSquare, faces: [{ indexes: [0, 1, 2, 3] }] })
    expect(healthy.acceptable).toBe(true)

    const zeroAreaFace = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }
      ],
      faces: [{ indexes: [0, 1, 2, 3] }, { indexes: [0, 1, 4] }]
    })
    expect(zeroAreaFace.acceptable).toBe(false)
    expect(zeroAreaFace.diagnostics.map((entry) => entry.code)).toContain("degenerate-collinear")
  })
})

/**
 * 结构对照（不是数值断言）：`candidateResiduals` 的判据是**纯形状 / 尺度**的，
 * 它不认识题设。题设验收属于 2b 的 `verifyDiagramObligations`（控制器 R15）。
 * 这条用例把"两套判据各管什么"写死在测试里，避免以后有人把题设核验搬进内核。
 */
describe("residual scope (R15)", () => {
  it("does not claim problem-statement acceptance: a rectangle that violates no stated relation still passes", () => {
    const report = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 }
      ],
      source: "free-choice"
    })
    expect(report.acceptable).toBe(true)
    expect(report.source).toBe("free-choice")
  })
})

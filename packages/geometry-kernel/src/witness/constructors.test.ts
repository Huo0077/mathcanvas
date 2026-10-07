import { describe, expect, it } from "vitest"

import { areCoplanar, crossVector3, distanceVector3, dotVector3, subtractVector3, type Vector3 } from "../geometry3d"
import { dihedralAngleDetail3 } from "../markers3d"
import { buildFromPoints, createBuilderContext } from "../solid-builders"

import { constructPrismWitness, constructPyramidWitness, constructWitnessShape, type PrismConstructRequest, type PyramidConstructRequest, type WitnessConstructRequest, type WitnessRelation } from "./constructors"
import { isPointName } from "../pointNames"
import { candidateResiduals, polygonResiduals } from "./residuals"

/**
 * **解析见证构造**（N2 子任务 2a；计划 N2 RED 项）。
 *
 * 这一层只做**纯几何**：题面点名的顶点 + 题面陈述的关系 → 一组候选坐标。
 * 它不判断"这张图是否满足题设"（那是 2b 的 `verifyDiagramObligations` + `buildFromPoints`），
 * 只保证构造本身确定性、可复算，并且拒绝时**给出结构化的理由**而不是抛异常。
 *
 * 三条 RED 判据（控制器 R17）在这里各有一组用例：
 * 1. 确定性：同输入同输出（连跑 25 次逐字节比较；**没有**"扫源码找 RNG"的守卫 —— 测试环境无 `node:fs`）；
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
  it("constructs a triangle with an explicitly named right angle at B, not only at ring start A", () => {
    const request = pyramidRequest({
      base: ["A", "B", "C"], apex: { at: "P", foot: "B", height: { kind: "fixed", value: 4 } },
      relations: [
        { kind: "perpendicular", segments: [["P", "B"], ["A", "B"], ["B", "C"]] },
        { kind: "perpendicular", segments: [["A", "B"], ["B", "C"]] }
      ]
    })
    const result = constructPyramidWitness(request)
    expect(result.status, result.status === "rejected" ? result.message : "constructed").toBe("candidate")
    if (result.status !== "candidate") return
    const at = (name: string) => result.witness.points[indexOf(result.witness, name)]
    const ba = subtractVector3(at("A"), at("B"))
    const bc = subtractVector3(at("C"), at("B"))
    expect(dotVector3(ba, bc)).toBeCloseTo(0, 10)
    expect(at("P").x).toBeCloseTo(at("B").x, 10)
    expect(at("P").y).toBeCloseTo(at("B").y, 10)
    expect(at("P").z).toBeGreaterThan(0)
    expect(result.witness.names).toEqual(["A", "B", "C", "P"])
    expect(buildFromPoints({ vertices: orderedPoints(result.witness), faces: result.witness.faces }, createBuilderContext()).diagnostics).toEqual([])
  })
  it("does not invent a base right corner from apex-to-base perpendicular relations", () => {
    const result = constructPyramidWitness(pyramidRequest({
      base: ["A", "B", "C"], apex: { at: "P", foot: "B" },
      relations: [{ kind: "perpendicular", segments: [["P", "B"], ["A", "B"], ["B", "C"]] }]
    }))
    expect(result.status, result.status === "rejected" ? result.message : "constructed").toBe("candidate")
    if (result.status !== "candidate") return
    const at = (name: string) => result.witness.points[indexOf(result.witness, name)]
    const ab = subtractVector3(at("B"), at("A"))
    const ac = subtractVector3(at("C"), at("A"))
    const pb = subtractVector3(at("P"), at("B"))
    expect(Math.abs(dotVector3(ab, ac))).toBeGreaterThan(0.1) // no unstated right corner
    expect(Math.abs(dotVector3(pb, ab))).toBeLessThan(TOLERANCE)
    expect(Math.abs(dotVector3(pb, subtractVector3(at("C"), at("B"))))).toBeLessThan(TOLERANCE)
  })
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
    /**
     * 用户可见的 explanation 必须**如实**说这是有界求根而不是解析闭式
     *（复核 round 1 Important 1 ③：早先一律写"由题面条件解析求出"）。
     */
    const origin = result.witness.assumptions.find((entry) => entry.includes("顶点 P 取在垂足 A 正上方"))
    expect(origin, `assumptions: ${JSON.stringify(result.witness.assumptions)}`).toBeDefined()
    expect(origin).toContain("求根")
    expect(origin).toContain("非解析闭式")
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

    /**
     * 同一句物理事实的**另一种编码**：把"在 B 处两条边互相垂直"拆成两条单段关系。
     * 复核 round 1 Minor 9：早先要求"一条关系同时含两条边"，这种编码会 fail-open ——
     * 题面明说的直角梯形会被静默建成矩形。
     */
    const splitEncoding = constructPyramidWitness(
      pyramidRequest({
        relations: [
          { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] },
          { kind: "parallel", segments: [["B", "C"], ["A", "D"]] },
          { kind: "perpendicular", segments: [["B", "A"]] },
          { kind: "perpendicular", segments: [["B", "C"]] }
        ]
      })
    )
    expect(splitEncoding.status, `split-encoding: ${JSON.stringify(splitEncoding)}`).toBe("rejected")
    if (splitEncoding.status === "rejected") expect(splitEncoding.code).toBe("unsupported-base-shape")

    /**
     * **环首直角也可以拆成两条单段关系**（与上面梯形用例同一编码轴的反面）：
     * `[["A","B"]]` + `[["A","D"]]` 说的是"在 A 处两条底边垂直"，必须照样建出候选。
     */
    const splitRightAngle = constructPyramidWitness(
      pyramidRequest({
        relations: [
          { kind: "perpendicular", segments: [["A", "B"]] },
          { kind: "perpendicular", segments: [["A", "D"]] },
          { kind: "parallel", segments: [["B", "C"], ["A", "D"]] }
        ]
      })
    )
    expect(splitRightAngle.status, `split-right-angle: ${JSON.stringify(splitRightAngle)}`).toBe("candidate")

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

  it("supports a pentagon / hexagon base as a regular representative when the base states no angle", () => {
    /**
     * S2：用户裁决的首批范围是**任意 3–6 边底面**。n = 5 / 6 且题面**没有**点名底面上的角度时，
     * 取一组**正 n 边形**代表 —— 与三角形的"普通三角形示例"同一个口径：题面没限定形状时，
     * 给一张符合直觉、且满足全部可核条件的图（用户早先的裁决）。
     *
     * 题面**点名了**底面上的角度或平行条件时仍拒绝（正 n 边形满足不了它），
     * 那条由上面"五边形底面 + 环首直角"的用例守着 —— 明确拒绝好过悄悄换一个形状。
     */
    for (const ring of [["A", "B", "C", "D", "E"], ["A", "B", "C", "D", "E", "F"]]) {
      const result = constructPyramidWitness(pyramidRequest({ base: ring, relations: [] }))
      expect(result.status, `ring ${ring.length}: ${JSON.stringify(result)}`).toBe("candidate")
      if (result.status !== "candidate") continue
      const { names, points } = result.witness
      expect(names.slice(0, ring.length)).toEqual(ring)
      const at = (name: string): Vector3 => points[names.indexOf(name)]!
      const sides = ring.map((name, index) => distanceVector3(at(name), at(ring[(index + 1) % ring.length]!)))
      for (const side of sides) expect(side).toBeCloseTo(sides[0]!, 9)
      for (const name of ring) expect(at(name).z).toBe(0)
    }
  })

  it("accepts `PB ⊥ AB` / `PB ⊥ BC` (line-perpendicular-to-base) instead of reading them as a base corner", () => {    /**
     * 复核 round 2 / Important A（R21）的**正例**：`PB ⊥ AB` 与 `PB ⊥ BC` 是"侧棱 ⊥ 平面 ABCD"
     * 的自然写法（两条件一起才说明 PB 垂直于底面），不是"底面在 B 处有直角"。
     * 垂足不在环首（这里垂足是 B）是被支持的，所以这个输入必须能建出候选 ——
     * round 1 的修法曾把探测扩大到全局，把它误拒成"直角梯形"。
     */
    const result = constructPyramidWitness({
      shape: "pyramid",
      base: ["A", "B", "C", "D"],
      relations: [
        { kind: "perpendicular", segments: [["P", "B"], ["B", "A"]] },
        { kind: "perpendicular", segments: [["P", "B"], ["B", "C"]] },
        { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] }
      ],
      apex: { at: "P", foot: "B", height: { kind: "fixed", value: 4 } }
    })
    expect(result.status, `line-perp-base: ${JSON.stringify(result)}`).toBe("candidate")
    if (result.status !== "candidate") return
    const { points, names } = result.witness
    const at = (name: string): Vector3 => points[names.indexOf(name)]
    const P = at("P")
    const B = at("B")

    // 独立回代：PB 真的垂直于底面（与两条底边方向都垂直），且顶点在 B 的正上方。
    expect(Math.abs(dotVector3(subtractVector3(P, B), subtractVector3(at("A"), B)))).toBeLessThan(TOLERANCE)
    expect(Math.abs(dotVector3(subtractVector3(P, B), subtractVector3(at("C"), B)))).toBeLessThan(TOLERANCE)
    expect(P.x).toBeCloseTo(B.x, 12)
    expect(P.y).toBeCloseTo(B.y, 12)
    expect(distanceVector3(P, B)).toBeCloseTo(4, 9)
  })

  it("labels a directly given height as such, not as `derived from the statement`", () => {
    // 复核 round 2 / Minor D：`fixed` 高没有被求解，文案不能说"由题面条件解析求出"。
    const result = constructPyramidWitness(pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 4 } } }))
    expect(result.status).toBe("candidate")
    if (result.status !== "candidate") return
    const origin = result.witness.assumptions.find((entry) => entry.includes("顶点 P 取在垂足 A 正上方"))
    expect(origin, `assumptions: ${JSON.stringify(result.witness.assumptions)}`).toContain("题面直接给定")
    expect(origin).not.toContain("解析求出")
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
     * **无 RNG 的证据**：连跑 25 次、逐字节比较。这条只对"被跑到的这条路径"成立 ——
     * 它证明的是"重复调用结果逐位相同"，不是"源码里没有非确定性 API"
     *（复核 round 1 Minor 7：早先的注释声称有一个"源码级守卫"，那个守卫并不存在）。
     */
    const fingerprint = JSON.stringify(first)
    for (let round = 0; round < 25; round += 1) {
      expect(JSON.stringify(constructPyramidWitness(pyramidRequest({ apex: { at: "P", foot: "A", height: { kind: "fixed", value: 4 } } })))).toBe(fingerprint)
    }
  })

  it("rejects type-valid requests with missing fields as values instead of throwing (2b adapter inputs)", () => {
    /**
     * 复核 round 1 Important 2：这条契约（"不抛异常"）早先可被证伪 ——
     * `relations: undefined` 与 `extrusion: { kind: "vector" }` 都会在实现里被无守卫解引用。
     * 这正是 2b 从题面适配时最容易产生的形状（关系还没抽出来 / 向量还没算出来）。
     */
    const missingRelations = { shape: "pyramid", base: ["A", "B", "C"], apex: { at: "P" }, relations: undefined } as unknown as PyramidConstructRequest
    expect(() => constructPyramidWitness(missingRelations)).not.toThrow()
    const relationsResult = constructPyramidWitness(missingRelations)
    expect(relationsResult.status).toBe("rejected")
    if (relationsResult.status === "rejected") expect(relationsResult.code).toBe("invalid-input")

    const missingVector = {
      shape: "prism",
      base: ["A", "B", "C"],
      relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "C"]] }],
      extrusion: { kind: "vector" }
    } as unknown as PrismConstructRequest
    expect(() => constructPrismWitness(missingVector)).not.toThrow()
    const vectorResult = constructPrismWitness(missingVector)
    expect(vectorResult.status).toBe("rejected")
    if (vectorResult.status === "rejected") expect(vectorResult.code).toBe("invalid-input")

    // 顶层分派也守住了同一个字段。
    const dispatched = constructWitnessShape({ shape: "prism", base: ["A", "B", "C"], extrusion: { kind: "unknown" } } as unknown as WitnessConstructRequest)
    expect(dispatched.status).toBe("rejected")
    if (dispatched.status === "rejected") expect(dispatched.code).toBe("invalid-input")
  })

  it("rejects a non-finite stated side length instead of silently substituting a free value", () => {
    /**
     * 复核 round 1 Important 3：`statedLength` 早先对"题面没提"与"题面给了 NaN/Infinity"都返回
     * `null`，于是非有限值被 `freeLength` 换成系统示例值 2 / 3 —— 题面给的数字消失。
     */
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = constructPyramidWitness(
        pyramidRequest({ relations: [...PYRAMID_RELATIONS, { kind: "segment-length", segments: [["A", "B"]], value }] })
      )
      expect(result.status, `value ${value}`).toBe("rejected")
      if (result.status === "rejected") expect(result.code).toBe("non-finite-value")
    }
    // 同一份输入里的另一条边（没给长度）仍然照常取自由值 —— 拒绝只针对那个真的坏掉的值。
    const healthy = constructPyramidWitness(
      pyramidRequest({ relations: [...PYRAMID_RELATIONS, { kind: "segment-length", segments: [["A", "B"]], value: 5 }] })
    )
    expect(healthy.status).toBe("candidate")
    if (healthy.status === "candidate") {
      expect(distanceVector3(healthy.witness.points[0], healthy.witness.points[1])).toBeCloseTo(5, 9)
    }
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
    // 顶面点名必须满足内核的**共享**定义（`pointNames`）：否则核验器的 `vertexNames` 检查会把整张表判为不可靠。
    expect(names.every((name) => isPointName(name))).toBe(true)
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

  it("handles a point-pair extrusion from base vertices as an in-plane vector (zero volume)", () => {
    /**
     * 复核 round 1 Minor 8：`extrusion: { kind: "points" }` 这条分支 2b 能触达，却完全没有用例。
     *
     * 这条分支的语义是 `to − from`，而两个端点都必须是**底面环上的**点名顶点 ——
     * 底面环的点一律构造在 z = 0 平面上，所以这条分支产出的向量**永远落在底面内**，
     * 必然被零体积判据拒绝。这是接口的固有边界（真实可用的拉伸向量要么显式给，
     * 要么等 2b 引入"环外点名顶点"的概念），所以这里把两种结局都钉住。
     */
    const inPlane = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "C"],
      relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "C"]] }],
      extrusion: { kind: "points", from: "C", to: "A" }
    })
    expect(inPlane.status).toBe("rejected")
    if (inPlane.status === "rejected") expect(inPlane.code).toBe("degenerate-extrusion")

    // 端点不是底面点名顶点 ⇒ 结构化拒绝，不抛异常。
    const unnamed = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "C"],
      relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "C"]] }],
      extrusion: { kind: "points", from: "A", to: "T" }
    })
    expect(unnamed.status).toBe("rejected")
    if (unnamed.status === "rejected") expect(unnamed.code).toBe("missing-height-reference")
  })

  it("names the top-face vertices without collisions when the base already uses primed names", () => {
    /**
     * 底面点名里已经有 `A′`（题面 `ABCD-A′B′C′D′` 那一类）时，顶面必须另起名字。
     *
     * **用户 2026-10-07 裁决：按扩语法处理** —— 顶面叫 `A′′`（字母 + 两个后缀合法）。
     * 于是本用例从"记录一处已知缺口"变成"钉住裁决后的正确行为"：
     * ① 每个名字都必须在共享词表里；② 底面第三个名已经占了 `A′`，
     * 所以 `A` 的顶面走**下一个一层后缀**（`A₁`），而 `A′` 的顶面正好是裁决点名的 `A′′`。
     */
    const result = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "A′"],
      relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "A′"]] }],
      extrusion: { kind: "vector", vector: { x: 0, y: 0, z: 2 } }
    })
    expect(result.status).toBe("candidate")
    if (result.status !== "candidate") return
    const { names } = result.witness
    expect(names.slice(0, 3)).toEqual(["A", "B", "A′"])
    expect(new Set(names).size).toBe(names.length)
    expect(names.slice(3)).toEqual(["A₁", "B′", "A′′"])
    // 裁决之后**不许**再有词表外的名字：`A′2` 那种写法（字母 + 撇 + ASCII 数字）已经不该出现。
    expect(names.filter((name) => !isPointName(name))).toEqual([])
    expect(names).not.toContain("A′2")
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

  it("checks ring coplanarity on the face path too (same criteria as polygonResiduals)", () => {
    /**
     * 复核 round 1 Minor 6：给了面环的路径早先只查"每环共线"，不查共面，与导出的
     * `polygonResiduals` 口径不一致 —— 而构造器与 2b 走的正是这条路径。
     */
    const nonPlanarRing = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0.5 },
        { x: 0, y: 0, z: 2 }
      ],
      faces: [{ indexes: [0, 1, 2, 3] }, { indexes: [0, 1, 4] }]
    })
    expect(nonPlanarRing.acceptable).toBe(false)
    expect(nonPlanarRing.diagnostics.map((entry) => entry.code)).toContain("non-coplanar-base")
    // 与单环判据给出同一个结论（两条路径不再分叉）。
    expect(polygonResiduals([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0.5 }]).diagnostics.map((entry) => entry.code)).toContain("non-coplanar-base")
  })

  it("keeps the scale guards meaningful on large models (no false rejects, no blind spots)", () => {
    /**
     * 复核 round 1 Minor 5：两处尺度守卫的单位曾经不一致 ——
     * 共线判据拿长度比 `diameter²`（大模型上误判共线），共面判据拿长度比 `diameter²`
     * （大模型上容忍上千单位的离面顶点）。这里用 1e5 / 1e6 量级的模型钉住两个方向。
     */
    const largeThin = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1e5, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      ]
    })
    // 1e5 × 1 的细长三角形是**合法**的（长宽比 1e5 < 上限 1e6），不能被误判成共线。
    expect(largeThin.diagnostics.map((entry) => entry.code)).not.toContain("degenerate-collinear")
    expect(largeThin.acceptable).toBe(true)

    const largeNonPlanar = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1e6, y: 0, z: 0 },
        { x: 1e6, y: 1e6, z: 0 },
        { x: 0, y: 1e6, z: 0.5 }
      ]
    })
    // 离面 0.5 个单位的顶点在 1e6 量级的模型上是**真实的**非共面，守卫不能失明。
    expect(largeNonPlanar.acceptable).toBe(false)
    expect(largeNonPlanar.diagnostics.map((entry) => entry.code)).toContain("non-coplanar-base")

    // 反方向：真正共线的大模型仍然要被判共线（阈值没有松到失去判别力）。
    const largeCollinear = candidateResiduals({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1e6, y: 0, z: 0 },
        { x: 5e5, y: 0, z: 0 }
      ]
    })
    expect(largeCollinear.diagnostics.map((entry) => entry.code)).toContain("degenerate-collinear")
  })

  it("rejects a mixed-magnitude candidate on the face path too", () => {
    // 复核 round 1 Minor 4：`candidateResiduals` 的量级守卫早先只看 `max`，`min` 侧的负值漏掉。
    const report = candidateResiduals({
      points: [
        { x: -1e140, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 }
      ],
      faces: [{ indexes: [0, 1, 2] }, { indexes: [0, 1, 3] }, { indexes: [0, 2, 3] }, { indexes: [1, 2, 3] }]
    })
    expect(report.acceptable).toBe(false)
    expect(report.diagnostics.map((entry) => entry.code)).toContain("magnitude-unrepresentable")
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


describe("V0a free triangular base with no stated angle", () => {
  it("chooses a reproducible non-degenerate, non-right, non-isosceles witness without inventing a right corner", () => {
    const request: PyramidConstructRequest = { shape: "pyramid", base: ["A", "B", "C"], apex: { at: "D", foot: "A" }, relations: [] }
    const first = constructPyramidWitness(request)
    const second = constructPyramidWitness(request)
    expect(first.status, first.status === "rejected" ? first.message : "constructed").toBe("candidate")
    expect(second).toEqual(first)
    if (first.status !== "candidate") return
    const at = (name: string) => first.witness.points[indexOf(first.witness, name)]
    const ab = subtractVector3(at("B"), at("A")), ac = subtractVector3(at("C"), at("A"))
    const lengths = [distanceVector3(at("A"), at("B")), distanceVector3(at("A"), at("C")), distanceVector3(at("B"), at("C"))]
    expect(vectorLength(crossVector3(ab, ac))).toBeGreaterThan(0.1)
    expect(Math.abs(dotVector3(ab, ac))).toBeGreaterThan(0.1)
    expect(new Set(lengths.map((value) => value.toFixed(6))).size).toBe(3)
    expect(at("D").z).toBeGreaterThan(at("A").z)
    expect(buildFromPoints({ vertices: orderedPoints(first.witness), faces: first.witness.faces }, createBuilderContext()).diagnostics).toEqual([])
  })
})

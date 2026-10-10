import { describe, expect, it } from "vitest"

import { areCoplanar, crossVector3, distanceVector3, dotVector3, subtractVector3, type Vector3 } from "../geometry3d"
import { dihedralAngleDetail3 } from "../markers3d"
import { buildFromPoints, createBuilderContext } from "../solid-builders"

import { constructFrustumWitness, constructPrismWitness, constructPyramidWitness, constructShapeFromSpec, constructWitnessShape, type FrustumConstructRequest, type PrismConstructRequest, type PyramidConstructRequest, type WitnessConstructRequest, type WitnessRelation } from "./constructors"
import { isPointName } from "../pointNames"
import type { SolidShapeSpec } from "./solidShapeSpec"
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
     * **直角梯形底面 ⇒ 构造出来，而不是拒绝**（2026-10-10 §3-F；这一段此前钉的是"拒绝"）。
     *
     * 底面点名了两个**内部直角**：`AB ⊥ AD` 与 `AB ⊥ BC`（外加 `BC ∥ AD`）。
     * 2026-10-10 之前这里拒绝，理由写在当时的注释里 ——"矩形是比题面更强的假设"。
     * 那个理由本身没错，**错的是结论**：这两条垂直把 `AB` 钉成了两条平行边的**公垂线**，
     * 底面是**闭式可构造**的直角梯形（`A=(0,0)`、`B=(w,0)`、`C=(w,c)`、`D=(0,d)`，`c ≠ d`），
     * 不需要"通用非线性求解"。所以"首批不做求解"这个借口在这一支上不成立 —— 改成构造，
     * 并把代表值（`AB` 与两条平行边的长）写进 `freeValues` / `assumptions`。
     *
     * 判据全部**自算**，不读构造方的自述：题面那三条逐条成立，
     * 外加两条"没有多加题面没说的东西"——`AD ≠ BC`（等长就是矩形）与 `C`、`D` 处**不是**直角。
     *
     * 两种编码都要认：一条关系里给全（`AB ⊥ AD` 与 `AB ⊥ BC`），
     * 或把"在 B 处垂直"拆成两条单段关系（复核 round 1 Minor 9 的那条编码轴）。
     */
    const rightTrapezoid = (relations: WitnessRelation[]) => {
      const result = constructPyramidWitness(pyramidRequest({ relations }))
      expect(result.status, `right-trapezoid: ${JSON.stringify(result)}`).toBe("candidate")
      if (result.status !== "candidate") throw new Error("unreachable")
      const { points, names } = result.witness
      const at = (name: string): Vector3 => points[names.indexOf(name)]!
      const ab = subtractVector3(at("B"), at("A"))
      const ad = subtractVector3(at("D"), at("A"))
      const bc = subtractVector3(at("C"), at("B"))
      const cd = subtractVector3(at("D"), at("C"))
      // ① 题面点名的三条，逐条自己算。
      expect(Math.abs(dotVector3(ab, ad)), "AB ⊥ AD").toBeLessThan(TOLERANCE)
      expect(Math.abs(dotVector3(ab, bc)), "AB ⊥ BC").toBeLessThan(TOLERANCE)
      expect(Math.abs(crossVector3(bc, ad).z), "BC ∥ AD").toBeLessThan(TOLERANCE)
      // ② 没有多加题面没说的特殊性。
      expect(Math.abs(distanceVector3(at("A"), at("D")) - distanceVector3(at("B"), at("C"))), "AD ≠ BC（等长就是矩形）").toBeGreaterThan(1e-6)
      expect(Math.abs(dotVector3(bc, cd)), "C 处不是直角").toBeGreaterThan(1e-6)
      expect(Math.abs(dotVector3(ad, cd)), "D 处不是直角").toBeGreaterThan(1e-6)
      // ③ 底面非退化（四个点互异、面积不为零）。
      expect(Math.abs(crossVector3(ab, ad).z)).toBeGreaterThan(1e-6)
    }

    rightTrapezoid([
      { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] },
      { kind: "parallel", segments: [["B", "C"], ["A", "D"]] },
      { kind: "perpendicular", segments: [["A", "B"], ["B", "C"]] }
    ])

    /**
     * 同一句物理事实的**另一种编码**：把"在 B 处两条边互相垂直"拆成两条单段关系。
     * 复核 round 1 Minor 9：早先要求"一条关系同时含两条边"，这种编码会 fail-open ——
     * 题面明说的直角梯形会被静默建成矩形。现在两支走**同一个构造**，所以两条都要判到底。
     */
    rightTrapezoid([
      { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] },
      { kind: "parallel", segments: [["B", "C"], ["A", "D"]] },
      { kind: "perpendicular", segments: [["B", "A"]] },
      { kind: "perpendicular", segments: [["B", "C"]] }
    ])

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

/**
 * **底面是菱形**（S3）：四条边两两相等 ⇒ 菱形，边长自由、**角度取代表值**。
 *
 * 为什么角度不自由：`菱形` 只约束"四边相等"，没说角是多少 —— 取一个代表值（60°）并写进假设，
 * 与 n ≥ 5 的"正 n 边形代表"同一条口径（`deriveRepresentativePolygon`）。
 * 而**直角不许取**：四边相等 + 直角 = 正方形，那是题面没说的额外特殊性
 * （与候选池里"两条自由底边不许取相等"是同一条账）。
 */
describe("底面是菱形（S3）", () => {
  const chain = [
    { kind: "equal-length" as const, segments: [["A", "B"], ["B", "C"]] },
    { kind: "equal-length" as const, segments: [["B", "C"], ["C", "D"]] },
    { kind: "equal-length" as const, segments: [["C", "D"], ["D", "A"]] }
  ]

  it("四边相等 + 给定边长 ⇒ 构造出菱形（四边彼此相等，且**不是**正方形）", () => {
    const result = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "C", "D"],
      relations: [...chain, { kind: "segment-length", segments: [["A", "B"]], value: 2 }],
      extrusion: { kind: "vector", vector: { x: 0, y: 0, z: 3 } }
    })

    expect(result.status, JSON.stringify(result)).toBe("candidate")
    if (result.status !== "candidate") return
    const { points, names } = result.witness
    const at = (name: string): Vector3 => points[names.indexOf(name)]!

    const sides = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]].map(([from, to]) => distanceVector3(at(from!), at(to!)))
    for (const side of sides) expect(side, JSON.stringify(sides)).toBeCloseTo(sides[0]!, 9)
    expect(sides[0]).toBeCloseTo(2, 9)

    // 不是正方形：A 处的内角不是直角（否则题面说的"菱形"被悄悄升级成正方形）。
    const alongAb = subtractVector3(at("B"), at("A"))
    const alongAd = subtractVector3(at("D"), at("A"))
    expect(Math.abs(dotVector3(alongAb, alongAd))).toBeGreaterThan(1e-6)

    // 底面非退化、且这确实是菱形（对角线互相垂直平分 —— 菱形的等价判据，用内核自己的向量算子算）。
    expect(distanceVector3(at("A"), at("C"))).toBeGreaterThan(1e-6)
    const ac = subtractVector3(at("C"), at("A"))
    const bd = subtractVector3(at("D"), at("B"))
    expect(Math.abs(dotVector3(ac, bd))).toBeLessThan(1e-6)
  })

  it("菱形**同时点名直角** ⇒ 明确拒绝（那是正方形，首批不造）", () => {
    const result = constructPrismWitness({
      shape: "prism",
      base: ["A", "B", "C", "D"],
      relations: [...chain, { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] }],
      extrusion: { kind: "vector", vector: { x: 0, y: 0, z: 3 } }
    })

    expect(result.status).toBe("rejected")
    if (result.status !== "rejected") return
    expect(result.code).toBe("unsupported-base-shape")
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

/**
 * **按 `SolidShapeSpec` 构造**（S2.1 内核侧）。
 *
 * 编排层从此只交两样：**形状描述**与**它替自由标量选定的值**。这里钉两件事：
 * ① 它和"调用方自己拼请求"**产出同一组坐标**（换接口不换行为）；
 * ② 未知的标量 id **明确拒绝** —— 不凭空取值，也不静默忽略。
 */
describe("constructShapeFromSpec", () => {
  const SPEC: SolidShapeSpec = {
    family: "pyramid",
    base: ["A", "B", "C", "D"],
    apex: { at: "P", foot: "A" },
    relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] }],
    freeScalars: [
      { id: "base-edge-1", kind: "base-edge", targets: ["A", "B"], candidates: [2, 3, 4] },
      { id: "height", kind: "height", targets: ["P"], candidates: [2, 3] }
    ]
  }

  it("spec + 取值 ⇒ 与手工拼请求产出**同一组坐标**", () => {
    const fromSpec = constructShapeFromSpec(SPEC, [{ id: "base-edge-1", value: 2 }, { id: "height", value: 3 }])
    const byHand = constructWitnessShape({
      shape: "pyramid",
      base: ["A", "B", "C", "D"],
      apex: { at: "P", foot: "A", height: { kind: "free", value: 3 } },
      relations: [
        { kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] },
        { kind: "segment-length", segments: [["A", "B"]], value: 2 }
      ]
    })
    expect(fromSpec.status).toBe("candidate")
    expect(byHand.status).toBe("candidate")
    if (fromSpec.status !== "candidate" || byHand.status !== "candidate") return
    expect(fromSpec.witness.points).toEqual(byHand.witness.points)
    expect(fromSpec.witness.names).toEqual(byHand.witness.names)
  })

  it("未知的自由标量 id ⇒ 明确拒绝，不凭空取值", () => {
    const result = constructShapeFromSpec(SPEC, [{ id: "not-a-scalar", value: 1 }])
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.code).toBe("invalid-input")
      expect(result.message.length).toBeGreaterThan(0)
    }
  })

  const FRUSTUM: SolidShapeSpec = {
    family: "frustum",
    base: ["A", "B", "C", "D"],
    top: ["A′", "B′", "C′", "D′"],
    relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] }],
    freeScalars: [
      { id: "height", kind: "height", targets: ["A′"], candidates: [2] },
      { id: "top-scale", kind: "top-scale", targets: ["A′", "B′", "C′", "D′"], candidates: [0.5] }
    ]
  }
  const FRUSTUM_CHOICES = [{ id: "height", value: 2 }, { id: "top-scale", value: 0.5 }]

  it("台体：顶环**逐一对应**底环时构造成功", () => {
    const result = constructShapeFromSpec(FRUSTUM, FRUSTUM_CHOICES)
    expect(result.status, JSON.stringify(result)).toBe("candidate")
  })

  it("台体：顶环点数与底环不同 ⇒ 拒绝（对应关系说不清）", () => {
    const result = constructShapeFromSpec({ ...FRUSTUM, top: ["A′", "B′", "C′"] }, FRUSTUM_CHOICES)
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") expect(result.message).toContain("点数不同")
  })

  it("台体：顶环名字对不上 ⇒ 拒绝，**不按顺序硬配**", () => {
    /**
     * `ABCD-A′C′B′D′` 这种写法：点数一样，但第 2 位对不上。
     * 按顺序硬配会画出一张**顶环错配**的图，而且看起来还挺像那么回事 —— 那正是 S4.2 要拦的。
     */
    const result = constructShapeFromSpec({ ...FRUSTUM, top: ["A′", "C′", "B′", "D′"] }, FRUSTUM_CHOICES)
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.code).toBe("unsupported-base-shape")
      expect(result.message).toContain("不按顺序硬配")
    }
  })
})

/**
 * **台体**（S4）：底面环 + 平行顶面环，顶面是底面的**相似缩小**。
 *
 * 判据一律**自己在测试里重算**（质心、相似比、两底平行、顶棱 = 底棱 × k），
 * 不读构造过程中的中间量 —— 那等于拿实现自证。
 */
describe("constructFrustumWitness", () => {
  const SQUARE: FrustumConstructRequest = {
    shape: "frustum",
    base: ["A", "B", "C", "D"],
    relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] }],
    extrusion: { kind: "vector", vector: { x: 0, y: 0, z: 2 } },
    scale: 0.5
  }

  it("顶面 = 底面按**质心**相似缩小 0.5 再上移 2（自己算一遍回代）", () => {
    const result = constructFrustumWitness(SQUARE)
    expect(result.status, JSON.stringify(result)).toBe("candidate")
    if (result.status !== "candidate") return
    const { names, points, faces } = result.witness
    const at = (name: string): Vector3 => points[names.indexOf(name)]!
    const ring = ["A", "B", "C", "D"]
    const count = ring.length
    const sums = ring.reduce((total, name) => ({ x: total.x + at(name).x, y: total.y + at(name).y, z: total.z + at(name).z }), { x: 0, y: 0, z: 0 })
    const centroid: Vector3 = { x: sums.x / count, y: sums.y / count, z: sums.z / count }
    for (const name of ring) {
      const top = at(`${name}′`)
      expect(top.x).toBeCloseTo(centroid.x + (at(name).x - centroid.x) * 0.5, 9)
      expect(top.y).toBeCloseTo(centroid.y + (at(name).y - centroid.y) * 0.5, 9)
      expect(top.z).toBeCloseTo(at(name).z + 2, 9)
    }
    // 两底平行：顶面四点同高；顶棱 = 底棱 × 0.5。
    expect(new Set(ring.map((name) => at(`${name}′`).z)).size).toBe(1)
    expect(distanceVector3(at("A′"), at("B′"))).toBeCloseTo(distanceVector3(at("A"), at("B")) * 0.5, 9)
    expect(distanceVector3(at("B′"), at("C′"))).toBeCloseTo(distanceVector3(at("B"), at("C")) * 0.5, 9)
    // 拓扑由规则生成，内核必须接受。
    expect(buildFromPoints({ vertices: orderedPoints(result.witness), faces }, createBuilderContext()).diagnostics).toEqual([])
  })

  it("相似比不是 (0,1) ⇒ 明确拒绝：1 是棱柱、0 是棱锥顶点，两个端点都不是台体", () => {
    for (const scale of [1, 0, -0.5, Number.NaN]) {
      const result = constructFrustumWitness({ ...SQUARE, scale })
      expect(result.status, `scale=${String(scale)}`).toBe("rejected")
      if (result.status === "rejected") expect(result.code).toBe("invalid-input")
    }
  })

  it("`{kind:\"points\"}` 的拉伸来源 ⇒ 如实拒绝（底面顶点全在 z = 0，差向量落在底面内）", () => {
    const result = constructFrustumWitness({ ...SQUARE, extrusion: { kind: "points", from: "A", to: "B" } })
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") expect(result.code).toBe("unsupported-base-shape")
  })
})

/**
 * **底面点名一个数值角**（§3-F，2026-10-10）：`∠ABC=60°`。
 *
 * 判据**自算**：拿构造出来的坐标自己量那个内部角（`acos` 两条边的方向向量），
 * 不读构造过程留下的任何量。另加两条"没有多加题面没说的东西"：两条邻边**不等长**
 * （等长就是等腰三角形）与三角形非退化。
 */
describe("底面点名数值角（§3-F）", () => {
  const angleAt = (result: { witness: { points: Vector3[]; names: string[] } }, vertex: string, first: string, third: string): number => {
    const at = (name: string): Vector3 => result.witness.points[result.witness.names.indexOf(name)]!
    const alongFirst = subtractVector3(at(first), at(vertex))
    const alongThird = subtractVector3(at(third), at(vertex))
    const cosine = dotVector3(alongFirst, alongThird) / (Math.hypot(alongFirst.x, alongFirst.y, alongFirst.z) * Math.hypot(alongThird.x, alongThird.y, alongThird.z))
    return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
  }

  it("放出来的三角形真的满足那个角，而且没有多加「等腰」这种题面没说的特殊性", () => {
    const result = constructPyramidWitness(pyramidRequest({
      base: ["A", "B", "C"],
      relations: [{ kind: "planarAngle", targets: ["A", "B", "C"], value: 60, unit: "degree" }]
    }))

    expect(result.status, JSON.stringify(result)).toBe("candidate")
    if (result.status !== "candidate") return
    expect(angleAt(result, "B", "A", "C")).toBeCloseTo(60, 6)
    // 两条邻边不等长（等长是等腰三角形 —— 题面只说了那个角）。
    const at = (name: string): Vector3 => result.witness.points[result.witness.names.indexOf(name)]!
    expect(Math.abs(distanceVector3(at("B"), at("A")) - distanceVector3(at("B"), at("C")))).toBeGreaterThan(1e-6)
    // 三点不共线（角的内部角不是 0/180）。
    expect(Math.abs(crossVector3(subtractVector3(at("A"), at("B")), subtractVector3(at("C"), at("B"))).z)).toBeGreaterThan(1e-6)
  })

  it("角在哪个顶点都认（顶点是 `targets` 的中间那个），且退化与超范围一律拒绝", () => {
    // 顶点换成 A：`∠BAC=45°`。
    const atApexA = constructPyramidWitness(pyramidRequest({
      base: ["A", "B", "C"],
      relations: [{ kind: "planarAngle", targets: ["B", "A", "C"], value: 45, unit: "degree" }]
    }))
    expect(atApexA.status, JSON.stringify(atApexA)).toBe("candidate")
    if (atApexA.status === "candidate") expect(angleAt(atApexA, "A", "B", "C")).toBeCloseTo(45, 6)

    for (const value of [0, 180, -30]) {
      const result = constructPyramidWitness(pyramidRequest({
        base: ["A", "B", "C"],
        relations: [{ kind: "planarAngle", targets: ["A", "B", "C"], value, unit: "degree" }]
      }))
      expect(result.status, `value=${String(value)}`).toBe("rejected")
      if (result.status === "rejected") expect(result.code).toBe("degenerate-base")
    }
  })

  it("四边形底面也认（角在环上第二位）：那个角成立，而且没有顺手做出平行/直角/等腰", () => {
    const result = constructPyramidWitness(pyramidRequest({
      relations: [{ kind: "planarAngle", targets: ["A", "B", "C"], value: 60, unit: "degree" }]
    }))

    expect(result.status, JSON.stringify(result)).toBe("candidate")
    if (result.status !== "candidate") return
    const at = (name: string): Vector3 => result.witness.points[result.witness.names.indexOf(name)]!
    // ① 题面那个角成立（自算）。
    expect(angleAt(result, "B", "A", "C")).toBeCloseTo(60, 6)

    // ② **没有顺手做出别的特殊关系** —— 这是这一支最要紧的判据。
    const cross = (from: Vector3, to: Vector3, other: Vector3, onto: Vector3): number => {
      const first = subtractVector3(to, from)
      const second = subtractVector3(onto, other)
      return first.x * second.y - first.y * second.x
    }
    // 两组对边都不平行（否则就成了梯形/平行四边形）。
    expect(Math.abs(cross(at("A"), at("D"), at("B"), at("C"))), "AD ∦ BC").toBeGreaterThan(1e-6)
    expect(Math.abs(cross(at("A"), at("B"), at("D"), at("C"))), "AB ∦ DC").toBeGreaterThan(1e-6)
    // 四个顶点都不是直角，也没有两条相邻边等长。
    const corner = (before: string, vertexName: string, after: string): number =>
      dotVector3(subtractVector3(at(before), at(vertexName)), subtractVector3(at(after), at(vertexName)))
    for (const [before, name, after] of [["A", "B", "C"], ["B", "C", "D"], ["C", "D", "A"], ["D", "A", "B"]] as const) {
      expect(Math.abs(corner(before, name, after)), `${name} 处不是直角`).toBeGreaterThan(1e-6)
    }
    const sides = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]].map(([from, to]) => distanceVector3(at(from!), at(to!)))
    for (let index = 0; index < sides.length; index += 1) {
      expect(Math.abs(sides[index]! - sides[(index + 1) % sides.length]!), `相邻边 ${String(index)} 不等长`).toBeGreaterThan(1e-6)
    }
    // ③ 环是凸的（连续三条边的转向同号）且非退化。
    const turn = (from: string, to: string, next: string): number => {
      const first = subtractVector3(at(to), at(from))
      const second = subtractVector3(at(next), at(to))
      return first.x * second.y - first.y * second.x
    }
    const turns = [turn("A", "B", "C"), turn("B", "C", "D"), turn("C", "D", "A"), turn("D", "A", "B")]
    expect(Math.abs(turns[0]!)).toBeGreaterThan(1e-6)
    for (const value of turns) expect(Math.sign(value), JSON.stringify(turns)).toBe(Math.sign(turns[0]!))
  })

  it("四边形底面的角不在环上第二位 ⇒ 如实拒绝（代表方向那条规则在那里不成立）", () => {
    const result = constructPyramidWitness(pyramidRequest({
      relations: [{ kind: "planarAngle", targets: ["B", "C", "D"], value: 60, unit: "degree" }]
    }))
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") expect(result.code).toBe("unsupported-base-shape")
  })
})

/**
 * **环外点参与的数值角（§3-F 阶段 B / B1）**：顶点在底面环上、**恰一条腿的另一个端点是本题顶点**
 * （`∠DBA`、`∠PBA`）。未知量只有**顶点的高** `h`，用与二面角 `solveDihedralHeight` **同一套**的
 * 有界求根解出来（固定步数、无 RNG、失败如实拒绝，不给近似值）。
 *
 * 判据一律**自算**（拿返回的坐标算内部角，不读构造方的自述），并要求**旁证**：
 * 顶点在垂足正上方时那个角随 `h` 单调（`h=|AB|·tan θ`），所以解析解必须与求根结果一致。
 *
 * 这一族今天**什么都出不来**（设计 §0 的探针实测：搜索里的自由高是个常量，根本试不到别的高），
 * 所以下面每条在改动前都是红的。
 */
describe("环外点参与的数值角（§3-F 阶段 B）", () => {
  /** 拿返回的坐标自己算内部角（与核验器同一个定义），**不读**构造方的任何自述。 */
  const interiorAngle = (result: { witness: { points: Vector3[]; names: string[] } }, vertex: string, first: string, second: string): number => {
    const at = (name: string): Vector3 => result.witness.points[indexOf(result.witness, name)]!
    const alongFirst = subtractVector3(at(first), at(vertex))
    const alongSecond = subtractVector3(at(second), at(vertex))
    const magnitudes = vectorLength(alongFirst) * vectorLength(alongSecond)
    return (Math.acos(Math.min(1, Math.max(-1, dotVector3(alongFirst, alongSecond) / magnitudes))) * 180) / Math.PI
  }

  /** 三角形底面 `ABC` + 顶点 `D` 在 `A` 正上方：`∠DBA` 就是这一族的代表题面。 */
  const apexAngleRequest = (targets: string[], value: number): PyramidConstructRequest => ({
    shape: "pyramid",
    base: ["A", "B", "C"],
    apex: { at: "D", foot: "A" },
    relations: [{ kind: "planarAngle", targets, value, unit: "degree" }]
  })

  /** 用户在面板上看得见的那两段文字（"系统自选了哪些值"与"系统替你做了什么"）合起来读。 */
  const userVisibleText = (result: { witness: { freeValues: string[]; assumptions: string[] } }): string =>
    [...result.witness.freeValues, ...result.witness.assumptions].join("；")

  it("∠DBA=60°：按那个角有界求根求高，角自算成立，且与解析解 h=|AB|·tanθ 一致", () => {
    const result = constructPyramidWitness(apexAngleRequest(["D", "B", "A"], 60))
    expect(result.status, result.status === "rejected" ? `${result.code}: ${result.message}` : "constructed").toBe("candidate")
    if (result.status !== "candidate") return

    // ① 题面那个角**自算**成立。
    expect(interiorAngle(result, "B", "D", "A")).toBeCloseTo(60, 6)

    // ② 旁证：顶点在垂足正上方 ⇒ 解析解就是 |AB|·tan60°，求根结果必须与它一致。
    const at = (name: string): Vector3 => result.witness.points[indexOf(result.witness, name)]!
    const height = at("D").z - at("A").z
    const expected = distanceVector3(at("A"), at("B")) * Math.tan((60 * Math.PI) / 180)
    expect(height, `求根得到 h=${String(height)}，解析解 h=${String(expected)}`).toBeCloseTo(expected, 6)

    // ③ 用户要看得见"这个高是怎么来的"（不是系统随手挑的一个值）。
    expect(userVisibleText(result)).toContain("有界求根")
  })

  it("∠DBA=120°：允许范围内没有满足它的高 ⇒ 如实拒绝，不编一个近似值", () => {
    const result = constructPyramidWitness(apexAngleRequest(["D", "B", "A"], 120))
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.code).toBe("unsupported-angle-shape")
      expect(result.message).toContain("120")
    }
  })

  it("∠DAB=60°（A 是垂足）⇒ 如实报矛盾，并说出那个角恒为多少度", () => {
    const result = constructPyramidWitness(apexAngleRequest(["D", "A", "B"], 60))
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.code).toBe("contradictory-angle")
      expect(result.message).toContain("恒为 90")
      expect(result.message).toContain("60")
    }
  })

  it("∠DAB=90°（A 是垂足）⇒ 仍然通过，并说明它由其它条件必然成立", () => {
    const result = constructPyramidWitness(apexAngleRequest(["D", "A", "B"], 90))
    expect(result.status, result.status === "rejected" ? `${result.code}: ${result.message}` : "constructed").toBe("candidate")
    if (result.status !== "candidate") return
    expect(interiorAngle(result, "A", "D", "B")).toBeCloseTo(90, 6)
    expect(userVisibleText(result)).toContain("必然成立")
    expect(userVisibleText(result)).toContain("90")
  })

  it("∠ADB=60°（顶点本身是角的顶点）⇒ 如实拒绝，文案指到「两个未知量」", () => {
    const result = constructPyramidWitness(apexAngleRequest(["A", "D", "B"], 60))
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.code).toBe("unsupported-angle-shape")
      expect(result.message).toContain("顶点")
    }
  })

  it("两个点名角同时在场 ⇒ 如实拒绝（本层不做联立）", () => {
    const result = constructPyramidWitness({
      shape: "pyramid",
      base: ["A", "B", "C"],
      apex: { at: "D", foot: "A" },
      relations: [
        { kind: "planarAngle", targets: ["D", "B", "A"], value: 60, unit: "degree" },
        { kind: "planarAngle", targets: ["D", "C", "A"], value: 50, unit: "degree" }
      ]
    })
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.code).toBe("unsupported-angle-shape")
      expect(result.message).toContain("联立")
    }
  })

  it("题面同时给了高又给 B1 角 ⇒ 高仍按题面（构造期不做联立），角由核验器如实判", () => {
    const result = constructPyramidWitness({
      shape: "pyramid",
      base: ["A", "B", "C"],
      apex: { at: "D", foot: "A", height: { kind: "fixed", value: 1 } },
      relations: [{ kind: "planarAngle", targets: ["D", "B", "A"], value: 60, unit: "degree" }]
    })
    expect(result.status, result.status === "rejected" ? `${result.code}: ${result.message}` : "constructed").toBe("candidate")
    if (result.status !== "candidate") return
    // 高就是题面给的 1：**不**为了那个角去改题面给的值。
    const at = (name: string): Vector3 => result.witness.points[indexOf(result.witness, name)]!
    expect(at("D").z - at("A").z).toBeCloseTo(1, 10)
  })
})

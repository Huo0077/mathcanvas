import { crossVector3, dotVector3, lengthVector3, subtractVector3, type SolidShapeSpec, type Vector3 } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import type { GeometryObligation } from "../claimEvidence"
import { parseObligationWithLegacy } from "../obligationIR"
import { selectWitness, type PolyhedronWitness } from "../underdetermined"
import type { WitnessSearchInput } from "./solverContracts"
import { isIdentityBuildOrder, searchWitness, specForPrompt } from "./witnessSearch"

/**
 * **见证搜索的 RED 用例**（N2 子任务 2b；计划 N2 的 `Interfaces` / `RED` 与裁决 R13/R15/R16/R25/R26）。
 *
 * 这一层要回答的问题只有一个：**题面只有关系、没有数值时，系统能不能自己给出一组通过核验的坐标**，
 * 以及在给不出的时候**如实说出是哪一种给不出**。所以用例的重心不是"选出了哪组数"，
 * 而是四条：
 *
 * 1. **同一 seed 结果稳定**（R26：同一 seed 同一顺序、同一结果）；
 * 2. **极大长宽比的候选不优先**（题面没给尺寸时不许交出一根"杆子"）；
 * 3. **退化 / 矛盾 / 超时三者分类不同**（R25：三值 `status` 不变，原因落到 `ClaimEvidence.status`）；
 * 4. **既有 `selectWitness` 行为逐字不变**（R13：polyhedron 的筛选与排序只有一份实现）。
 *
 * 夹具一律取自**原话解析的真实产出**（`parseObligationIR`），不手写 obligation 数组 ——
 * 手写的夹具会在解析器改句型时悄悄与生产脱节，而这一层的输入恰恰就是那份 IR。
 */

const PYRAMID = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥"
/** 题面点名了侧棱长：顶点高由它解析求出（h = 10），底面尺寸仍然自由 —— 用来验"极值不优先"。 */
const PYRAMID_TALL = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，PA=10，画出这个四棱锥"
/** 题面点名了底面**对角线**：解析构造给不出，只能靠自由标量的有限网格兜底。 */
const PYRAMID_DIAGONAL = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，AC=5，画出这个四棱锥"
/** 同一条线段被给了两个长度：题设自相矛盾，搜索器能给出冲突证据。 */
const PYRAMID_CONTRADICTORY = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，BD=2，BD=3，画出这个四棱锥"
/** 线段两个端点都在它自称垂直的平面内：题设自相矛盾（且不需要算几何就能判定）。 */
const PYRAMID_LINE_IN_PLANE = "在四棱锥 P-ABCD 中，AB ⊥ 平面 ABCD，AB ⊥ AD，画出这个四棱锥"
/** 极端长宽比：内核的尺度判据会拒掉全部候选。 */
const PYRAMID_EXTREME = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，AB=1，AD=1000000，画出这个四棱锥"
/** 构造得出来、但题设数值对不上：只有统一核验器能拦它（搜索器不许自证）。 */
const PYRAMID_WRONG_DIAGONAL = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，AB=2，AD=3，BD=4，画出这个四棱锥"
/** 题面点名了一个构造器不会生成的点（中点 O）：核验器只能报"未核验"。 */
const PYRAMID_MIDPOINT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，O为BD的中点，画出这个四棱锥"
/** 首批题型之外的真实题面（中点 / 等边 / 面面垂直 / 二面角 / 比例分点）。 */
const TRIANGLE_PYRAMID = "在三棱锥 A-BCD 中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证 OA⊥CD"
/** `PYRAMID_UNVERIFIED_PROMPT` 那把：可构造的题面后面缀了一个解析器读不出的子句（residue）。 */
const PYRAMID_RESIDUE = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，画出这个四棱锥，∠ABC=60°"
/** 点名了一个自由点 Q：构造器不会生成它，核验器的点名映射也点不到。 */
const PYRAMID_FREE_POINT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，任取点 Q，画出示意图"
/** 题面把底面两条边与顶点高都钉死了 ⇒ 一个自由标量都不剩（网格不该再产候选）。 */
const PYRAMID_FULLY_STATED = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，AB ⊥ AD，AB=2，AD=3，PA=10，画出这个四棱锥"

const SEARCH: Omit<WitnessSearchInput, "obligations"> = { shape: "pyramid", seed: 7, maxCandidates: 40, timeoutMs: 5000 }

/**
 * 题设按**产品路径的同一份形状**取：`parseObligationWithLegacy(prompt).ir`（裁决 R32）。
 *
 * 搜索器收 IR（而不是裸 `GeometryObligation[]`）就是为了让残留 `unverified` 与自由选择
 * 一起进核验器 —— 夹具也照产品的方式构造，免得测试比生产"干净"。
 */
function obligationsOf(prompt: string, extra: readonly GeometryObligation[] = []): WitnessSearchInput["obligations"] {
  const parsed = parseObligationWithLegacy(prompt)
  return { obligations: [...parsed.ir.obligations, ...extra], unverified: [...parsed.ir.unverified] }
}

function search(prompt: string, overrides: Partial<WitnessSearchInput> = {}) {
  return searchWitness({ ...SEARCH, obligations: obligationsOf(prompt), ...overrides })
}

/**
 * **五边形底面**（S2 接线；内核已支持 n = 3–6，这里验"题面能不能走到内核"）。
 *
 * 2026-10-07 读码查实：内核 `deriveBasePolygon` 已支持 5 / 6 边，但这条能力**当时从产品路径走不到** ——
 * ① 解析器的平面子模式只认 3–4 个点名（`平面ABCDE` 匹配不上）；
 * ② 搜索层 `lineAndPlane` 只认 5 / 6 个 targets（= 线段 2 + 平面 3/4）。
 * 这条用例钉的就是整条链：一句"五棱锥 + `PA ⊥ 平面 ABCDE`"必须能产出通过核验的候选。
 */
describe("五边形底面", () => {
  const PENTAGON = "在五棱锥 P-ABCDE 中，PA ⊥ 平面 ABCDE，画出这个五棱锥"

  it("五棱锥的题面能走到内核并产出候选", () => {
    const result = search(PENTAGON)
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  it("六棱锥同样走得通（上界 6 也验一条）", () => {
    const result = search("在六棱锥 P-ABCDEF 中，PA ⊥ 平面 ABCDEF，画出这个六棱锥")
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  it("题面点名了底面直角时**不许**拿正五边形顶替（fail-closed）", () => {
    /**
     * 正五边形的边既不垂直也不平行。题面若在底面上点名了 `AB ⊥ BC`，
     * 正五边形代表**满足不了它** —— 此时正确行为是**不给通过核验的候选**，
     * 而不是画一张看起来正常、却不符合题意的图（本仓最忌讳的"悄悄换一个题面没说的形状"）。
     */
    const result = search("在五棱锥 P-ABCDE 中，PA ⊥ 平面 ABCDE，AB ⊥ BC，画出这个五棱锥")
    expect(result.status, JSON.stringify(result)).toBe("unverified_instance")
    // 收窄到带 `reasons` 的那一支（`WitnessSearchResult` 是判别联合，`reasons` 只在未核验这一支上）。
    if (result.status !== "unverified_instance") return
    /**
     * 而且要**说得出**是哪一种给不出：候选池照常枚举（3 个），但**每一个都在构造期被拒**，
     * 拒绝理由带机器可读的 `unsupported-base-shape`，句子明说"满足不了它、不换一个题面没说的形状"。
     * 钉这条是因为：给不出**不是问题**，说不出为什么才是 —— 用户得知道改哪一句。
     */
    expect(result.reasons.join(" "), JSON.stringify(result)).toContain("unsupported-base-shape")
  })
})

/**
 * **迁移护栏**（计划 Task 2.1 的第一步）。
 *
 * 把"今天这条题产出什么坐标"钉成**逐字**快照。接下来要把棱锥路径迁到 `SolidShapeSpec`
 * （自由标量从 spec 读，而不是写死的"两条底边 + 高"）—— 那次迁移**不许改变**同一题的结果：
 * 一旦自由标量的候选顺序或取值变了，这里必须红，而不是靠"看起来还是那个四面体"。
 *
 * 为什么钉**坐标**而不是钉 assumptions 文案：文案会随措辞改，坐标是几何本身。
 */
describe("S2 迁移护栏（坐标逐字不变）", () => {
  it("标准四棱锥题：候选坐标与今天逐字相同", () => {
    const result = search(PYRAMID)
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
    if (result.status !== "verified_instance") return
    expect(JSON.stringify(result.candidate.vertices)).toBe('[{"x":0,"y":0,"z":0},{"x":2,"y":0,"z":0},{"x":2,"y":3,"z":0},{"x":0,"y":3,"z":0},{"x":0,"y":0,"z":1}]')
  })
})

/** 按点名取坐标：结果里的 `names` / `vertices` 是同一套下标空间。 */
function coordinates(candidate: PolyhedronWitness): (name: string) => Vector3 {
  const byName = new Map(candidate.names.map((name, index) => [name, candidate.vertices[index]]))
  return (name: string) => {
    const point = byName.get(name)
    if (!point) throw new Error(`候选里没有点名 ${name}：${candidate.names.join("、")}`)
    return point
  }
}

function span(first: Vector3, second: Vector3): number {
  return lengthVector3(subtractVector3(first, second))
}

/** 失败时把结果里的原因原样带出来（判别联合的另外两支各说各的字段名）。 */
function describeResult(result: ReturnType<typeof search>): string {
  if (result.status === "no_witness") return result.failures.join(" / ")
  if (result.status === "unverified_instance") return result.reasons.join(" / ")
  return "verified_instance"
}

describe("witness search: analytic construction for the first batch", () => {
  it("verifies an explicitly right-angled triangular base at B without guessing another condition", () => {
    const prompt = "在三棱锥 P-ABC 中，PB⊥平面ABC，AB⊥BC，画出示意图"
    const result = search(prompt)
    expect(result.status, describeResult(result)).toBe("verified_instance")
    if (result.status !== "verified_instance") return
    const at = coordinates(result.candidate)
    const ba = subtractVector3(at("A"), at("B"))
    const bc = subtractVector3(at("C"), at("B"))
    expect(Math.abs(dotVector3(ba, bc)) / (lengthVector3(ba) * lengthVector3(bc))).toBeLessThan(1e-9)
    expect(at("P").x).toBeCloseTo(at("B").x, 10)
    expect(at("P").y).toBeCloseTo(at("B").y, 10)
    expect(result.evidence.residuals).toHaveProperty("AB⊥BC")
    expect(result.evidence.residuals).toHaveProperty("PB⊥平面ABC")
  })
  it("answers a fully relational pyramid with a verified instance judged by the shared verifier", () => {
    const result = search(PYRAMID)

    expect(result.status).toBe("verified_instance")
    if (result.status !== "verified_instance") throw new Error(describeResult(result))
    const at = coordinates(result.candidate)

    // 底面四点落在 z = 0，顶点在垂足 A 的正上方（这正是题面 PA ⊥ 平面 ABCD 的那条构造）。
    for (const name of ["A", "B", "C", "D"]) expect(at(name).z).toBeCloseTo(0, 12)
    expect(at("P").x).toBeCloseTo(at("A").x, 12)
    expect(at("P").y).toBeCloseTo(at("A").y, 12)
    expect(at("P").z).toBeGreaterThan(0)

    // 两条点名关系按内核自己的度量独立回代。
    const ab = subtractVector3(at("B"), at("A"))
    const ad = subtractVector3(at("D"), at("A"))
    const bc = subtractVector3(at("C"), at("B"))
    expect(Math.abs(dotVector3(ab, ad)) / (lengthVector3(ab) * lengthVector3(ad))).toBeLessThan(1e-9)
    expect(lengthVector3(crossVector3(bc, ad)) / (lengthVector3(bc) * lengthVector3(ad))).toBeLessThan(1e-9)

    // 证据必须来自统一词表（R16）：三值结果 + `ClaimEvidence`，逐条残差来自核验器。
    expect(result.evidence.status).toBe("verified_instance")
    expect(result.evidence.solver).toBe("model")
    expect(Object.keys(result.evidence.residuals).sort()).toEqual(["AB ⊥ AD", "BC ∥ AD", "PA ⊥ 平面 ABCD"])
    for (const residual of Object.values(result.evidence.residuals)) {
      expect(residual).not.toBeNull()
      expect(Math.abs(residual ?? Number.NaN)).toBeLessThan(1e-6)
    }
    // 系统自选的值必须看得见（设计 §1 验收判据 4）。
    expect(result.assumptions.join(" ")).toContain("系统自选")
    // 解析构造优先：第一个候选（解析默认值）就通过，不必动用网格。
    expect(result.assumptions.join(" ")).toContain("candidates=1")
  })

  it("gives the same result for the same seed, and records that seed", () => {
    const first = JSON.stringify(search(PYRAMID))
    for (let round = 0; round < 4; round += 1) expect(JSON.stringify(search(PYRAMID))).toBe(first)
    // 结果里必须留着 seed（Global Constraints：求解结果保留 seed），否则"可重现"无从核对。
    const recorded = search(PYRAMID)
    if (recorded.status !== "verified_instance") throw new Error(describeResult(recorded))
    expect(recorded.assumptions.join(" ")).toContain("seed=7")
  })

  it("lets the seed reorder candidates that tie on every preference key", () => {
    // `AC=5` 只有 (3,4) 与 (4,3) 两组小整数解，而它们在 sizeKey / 可读性上完全并列 ——
    // 于是"返回哪一个"完全由 seed 决定的排列说了算。只断言配置行里的 `seed=` 会恒过
    // （换个 seed 那行必然不同），所以这里断言**同一份题面在不同 seed 下真的出现过两种取向**。
    const orientations = new Set<string>()
    for (let seed = 0; seed < 12; seed += 1) {
      const result = search(PYRAMID_DIAGONAL, { seed })
      expect(result.status, `seed=${seed}`).toBe("verified_instance")
      if (result.status !== "verified_instance") throw new Error(describeResult(result))
      const at = coordinates(result.candidate)
      const edges = [span(at("A"), at("B")), span(at("A"), at("D"))].map((value) => value.toFixed(6))
      orientations.add(edges.join("×"))
    }
    expect([...orientations].sort()).toEqual(["3.000000×4.000000", "4.000000×3.000000"])
  })

  it("does not prefer an extremely stretched candidate that does verify", () => {
    // 解析默认底面 2×3、高 10：长宽比明显偏斜，但它确实是合格候选。
    const capped = search(PYRAMID_TALL, { maxCandidates: 1 })
    expect(capped.status).toBe("verified_instance")
    if (capped.status !== "verified_instance") throw new Error(describeResult(capped))
    const analytic = coordinates(capped.candidate)
    expect(analytic("P").z).toBeCloseTo(10, 9)
    expect(span(analytic("A"), analytic("B"))).toBeCloseTo(2, 9)

    // 放开候选上限后，同一题面必须换成更耐看的候选，而不是沿用那根"杆子"。
    const full = search(PYRAMID_TALL)
    expect(full.status).toBe("verified_instance")
    if (full.status !== "verified_instance") throw new Error(describeResult(full))
    const preferred = coordinates(full.candidate)
    expect(preferred("P").z).toBeCloseTo(10, 9)
    const edges = [span(preferred("A"), preferred("B")), span(preferred("A"), preferred("D"))]
    expect(Math.min(...edges)).toBeGreaterThanOrEqual(3)
  })

  it("falls back to the bounded grid over the free scalars the constructor exposes", () => {
    const result = search(PYRAMID_DIAGONAL)

    expect(result.status).toBe("verified_instance")
    if (result.status !== "verified_instance") throw new Error(describeResult(result))
    const at = coordinates(result.candidate)
    // AC = 5 在默认的 2×3 底面上是 √13；只有把自由的底面边长取到 3 与 4 才对得上。
    expect(span(at("A"), at("C"))).toBeCloseTo(5, 9)
    const edges = [span(at("A"), at("B")), span(at("A"), at("D"))].sort((left, right) => left - right)
    expect(edges[0]).toBeCloseTo(3, 9)
    expect(edges[1]).toBeCloseTo(4, 9)
    // 网格选出来的自由标量必须写进 assumptions（否则用户看不见系统替他定了什么）。
    expect(result.assumptions.join(" ")).toContain("搜索器自选")
  })

  it("spends no candidate slot on a grid entry identical to the analytic candidate", () => {
    // 题面把两条底边与顶点高都钉死了 ⇒ 没有任何自由标量，网格无从变化，不该再产一个
    // 与解析候选逐字节相同的候选（否则白吃一个 `maxCandidates` 名额、虚增 `candidates=N`）。
    const result = search(PYRAMID_FULLY_STATED)

    expect(result.status).toBe("verified_instance")
    if (result.status !== "verified_instance") throw new Error(describeResult(result))
    expect(result.assumptions.join(" ")).toContain("candidates=1")
  })
})

describe("witness search: budget and classification", () => {
  it("really stops at the candidate cap instead of pretending the problem is unsolvable", () => {
    const capped = search(PYRAMID_DIAGONAL, { maxCandidates: 1 })
    expect(capped.status).toBe("unverified_instance")
    if (capped.status !== "unverified_instance") throw new Error("expected the analytic candidate to fail AC=5")
    expect(capped.reasons.join(" ")).toContain("candidate-cap-exhausted")
    expect(capped.reasons.join(" ")).toContain("candidates=1")
    // 上限只是"没试完"，不许被读成题设不成立。
    expect(capped.reasons.join(" ")).not.toContain("不存在")

    // 同一题面在上限足够时是能解的 —— 这正是"上限真的生效、且是它挡住了答案"的证据。
    expect(search(PYRAMID_DIAGONAL, { maxCandidates: 40 }).status).toBe("verified_instance")
  })

  it("reports budget exhaustion as a timeout, never as a missing witness", () => {
    const result = search(PYRAMID, { timeoutMs: 0 })

    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") throw new Error("expected the zero budget to stop the search")
    expect(result.evidence.status).toBe("timeout")
    expect(result.evidence.solver).toBe("timeout")
    const text = result.reasons.join(" ")
    expect(text).toContain("budget-timeout")
    expect(text).toContain("在预算内")
    expect(text).toContain("没有找到")
    // 文案纪律（R25）：超时不得被写成"不存在见证"。
    expect(text).not.toContain("不存在")
    expect(text).toContain("candidates=0")
  })

  it("classifies contradictory givens as inconsistent with conflict evidence", () => {
    const result = search(PYRAMID_CONTRADICTORY)

    expect(result.status).toBe("no_witness")
    if (result.status !== "no_witness") throw new Error("expected no witness for a contradictory problem")
    expect(result.evidence.status).toBe("inconsistent")
    expect(result.evidence.solver).toBe("unsat")
    const text = result.failures.join(" ")
    expect(text).toContain("contradictory-obligations")
    expect(text).toContain("BD=2")
    expect(text).toContain("BD=3")
  })

  it("classifies a line that lies inside the plane it claims to be perpendicular to", () => {
    const result = search(PYRAMID_LINE_IN_PLANE)

    expect(result.status).toBe("no_witness")
    if (result.status !== "no_witness") throw new Error("expected the contradiction to be reported")
    expect(result.evidence.status).toBe("inconsistent")
    expect(result.failures.join(" ")).toContain("contradictory-line-plane")
  })

  it("keeps degenerate, contradictory and timeout outcomes distinguishable", () => {
    const degenerate = search(PYRAMID_EXTREME)
    const contradictory = search(PYRAMID_CONTRADICTORY)
    const timeout = search(PYRAMID, { timeoutMs: 0 })

    const classified = [degenerate, contradictory, timeout].map((result) => `${result.status}/${result.evidence.status}`)
    expect(new Set(classified).size).toBe(3)
    expect(classified).toEqual(["unverified_instance/unknown", "no_witness/inconsistent", "unverified_instance/timeout"])
    // "系统尚不支持"这一桶要带上内核真正的拒绝码，否则无法与"矛盾"分开排查。
    if (degenerate.status !== "unverified_instance") throw new Error("expected only rejects from the constructor")
    // 2a 把残差里的 `extreme-aspect-ratio` 归一成拒绝码 `extreme-scale`（细节留在 message 里）。
    expect(degenerate.reasons.join(" ")).toContain("extreme-scale")
    expect(degenerate.reasons.join(" ")).toContain("长宽比")
    expect(degenerate.reasons.join(" ")).toContain("no-candidate-constructed")
    expect(degenerate.reasons.join(" ")).toContain("candidates=3")
  })

  it("refuses to certify a candidate the shared verifier rejects, and says which given failed", () => {
    const result = search(PYRAMID_WRONG_DIAGONAL)

    expect(result.status).toBe("no_witness")
    if (result.status !== "no_witness") throw new Error("expected the verifier to reject BD=4")
    expect(result.evidence.status).toBe("unknown")
    const text = result.failures.join(" ")
    expect(text).toContain("no-candidate-verified")
    expect(text).toContain("BD=4")
    // 整池都跑过了：解析候选 + 2 个自由高的网格候选（取值表只有 2、3）。
    expect(text).toContain("candidates=3")
    // 实测残差进证据（R25：保留残差），"没找到"不许被读成"题设矛盾"。
    expect(result.evidence.residuals["BD=4"]).toBeCloseTo(Math.sqrt(13) - 4, 9)
    expect(text).not.toContain("不存在")
    expect(text).not.toContain("矛盾")
  })
})

/**
 * **直棱柱**（S3 第一刀）。
 *
 * 旧注释把棱柱卡住的原因写成两条依赖：解析层认不出 `A′`、核验器只认 `/^[A-Z]$/`。
 * **两条都已由 S1.2 / S1.3 解开**，所以这里钉的是新能力本身 ——
 * 题面写 `AA′⊥平面ABC` 时，搜索层要能读出底面环与拉伸方向并产出**通过核验**的候选。
 *
 * 斜棱柱这一批**不做**：内核的 `{kind:"points"}` 拉伸分支按设计不可用（底面顶点全在 z = 0），
 * 需要先有"环外点名顶点"的概念 —— 那是后续批次的事，不在这里硬凑。
 */
describe("直棱柱", () => {
  const PRISM = "在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个三棱柱"

  it("侧棱⊥底面的写法能读出底面环与拉伸方向并产出候选", () => {
    const result = search(PRISM, { shape: "prism" })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  it("顶面点名与内核约定不一致（AA₁）时如实拒绝，不擅自改名", () => {
    const result = search("在三棱柱ABC-A₁B₁C₁中，AA₁⊥平面ABC，画出这个三棱柱", { shape: "prism" })
    expect(result.status, JSON.stringify(result)).toBe("unverified_instance")
    if (result.status !== "unverified_instance") return
    expect(result.reasons.join(" "), JSON.stringify(result)).toContain("unsupported-shape")
    // 理由要**说得出怎么改**：按内核的顶面命名约定写 `A′`。
    expect(result.reasons.join(" ")).toContain("A′")
  })

  it("六边形底面的直棱柱：底面走**正六边形代表**（与棱锥共用同一条底面规则）", () => {
    const result = search("在六棱柱ABCDEF-A′B′C′D′E′F′中，AA′⊥平面ABCDEF，画出这个六棱柱", { shape: "prism" })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  /**
   * **底面点名两个直角的直角梯形**（2026-10-10 §3-F）。
   *
   * 2026-10-10 之前这一族**逐条拒绝**（内核那侧的原话是"矩形是比题面更强的假设 ⇒ 拒绝"，
   * 参数见 `constructors.test.ts` 的同名判据）。那条理由没错，但结论过宽：环首直角 +
   * B 处直角把 `AB` 钉成了两条平行边的**公垂线**，底面闭式可构造，而且 `parallel` /
   * `perpendicular` 两条判据核验器本来就有。
   *
   * 这一条证的是**端到端**：句子进去 ⇒ 造出来 ⇒ **核验器逐条查过** ⇒ `verified_instance`。
   * 内核那侧只证"造出了候选"，"核验通过"是另一回事。
   */
  it("底面点名两个直角的直角梯形也走通（构造 + 逐条核验）", () => {
    const result = search("在四棱柱ABCD-A′B′C′D′中，AA′⊥平面ABCD，AB⊥AD，AB⊥BC，画出这个四棱柱", { shape: "prism" })
    expect(result.status, describeResult(result)).toBe("verified_instance")
  })

  it("底面两个直角 + 另一组对边平行 ⇒ 题面自己说的就是矩形，照样走通", () => {
    const result = search("在四棱柱ABCD-A′B′C′D′中，AA′⊥平面ABCD，AB⊥AD，AB⊥BC，AB∥DC，画出这个四棱柱", { shape: "prism" })
    expect(result.status, describeResult(result)).toBe("verified_instance")
  })

  /**
   * **自相矛盾的题面要拒，不许挑一个**：`AB ∥ DC` 与两条直角合起来**推出**矩形
   *（四条边两两垂直 ⇒ 对边相等），而题面又给了 `AD=3`、`BC=5`。
   * 挑一个就是把矛盾静默吞掉 —— 那正是这一层最不该做的事。
   */
  it("矩形那一支里两条高度给了不同值 ⇒ 如实拒绝，不替题面挑一个", () => {
    const result = search("在四棱柱ABCD-A′B′C′D′中，AA′⊥平面ABCD，AB⊥AD，AB⊥BC，AB∥DC，AD=3，BC=5，画出这个四棱柱", { shape: "prism" })
    expect(result.status, describeResult(result)).not.toBe("verified_instance")
  })

  it("底面点名了直角时仍拒绝：正五边形代表满足不了它（棱柱与棱锥共用同一条规则）", () => {
    const result = search("在五棱柱ABCDE-A′B′C′D′E′中，AA′⊥平面ABCDE，AB⊥BC，画出这个五棱柱", { shape: "prism" })
    expect(result.status, JSON.stringify(result)).not.toBe("verified_instance")
    if (result.status !== "unverified_instance") return
    // 拒绝要说得出是"底面形状满足不了"，而不是含糊的"没找到"。
    expect(result.reasons.join(" "), JSON.stringify(result)).toContain("unsupported-base-shape")
  })

  /**
   * **S1.4 裁决的端到端落点**（用户 2026-10-07：底面已用 `A′` 时顶面叫 `A′′`，按**扩语法**处理）。
   *
   * 这条题面的底面**自己**就带撇（`A′B′C′`），顶面因此只能是 `A′′B′′C′′`。裁决之前内核会退化出
   * `A′2` 那种词表外的名字，核验器于是把整张点名表判为不可靠 —— 这条路永远拿不到核验；
   * 现在两后缀合法（`A′′` 在词表里），整条链走通。
   */
  it("底面自己带撇时（A′B′C′-A′′B′′C′′）也走通：顶面按裁决叫 A′′", () => {
    const result = search("在三棱柱A′B′C′-A′′B′′C′′中，A′A′′⊥平面A′B′C′，画出这个三棱柱", { shape: "prism" })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  /**
   * **S3.3 反例：题面自称"侧棱 ⊥ 底面"，但它自己给的数据让底面根本立不起来**。
   *
   * `AB=BC=1, AC=2` ⇒ A、B、C **共线**，那个"底面"面积为 0 —— 棱柱不存在。
   * 这一条要拦的是最坏的一种错：**照着题面的字面把图摆出来**（三个点确实能在一条线上摆好），
   * 于是用户看到一只扁成一片的"棱柱"，而画面上没有任何东西提示它是退化的。
   * 正确的行为是**拒绝**，并且说得出是底面的数据自相矛盾。
   */
  it("底面三点共线时**拒绝**，不把退化的『棱柱』画出来", () => {    const result = search("在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，AB=1，BC=1，AC=2，画出这个三棱柱", { shape: "prism" })
    expect(result.status, JSON.stringify(result)).not.toBe("verified_instance")
    /**
     * 拒绝的**种类**也要对：`no-candidate-constructed` 说的是"候选都在**构造期**被拒"，
     * 也就是内核看出那个底面立不起来 —— 不是"搜完了没找到"（`no-candidate-verified`），
     * 更不是"预算用尽"（`candidate-cap-exhausted`）。三种拒绝的含义不同，混起来就等于没说清原因。
     */
    if (result.status === "unverified_instance") {
      expect(result.reasons.join(" "), JSON.stringify(result)).toContain("no-candidate-constructed")
      expect(result.reasons.join(" ").length).toBeGreaterThan(0)
    }
  })
})

/**
 * **台体（S4）：由调用方给出形状描述。**
 *
 * 台体的几何**不是从某一句题设读出来的**（棱锥/棱柱靠"侧棱 ⊥ 底面"那句定底环与拉伸），
 * 所以它走"调用方交 spec"那条路 —— 将来由入口语法（S6）从题面产出这份 spec。
 * 这里钉三件事：① spec 驱动能产出**通过核验**的候选；② 图真的是台体（顶棱短于底棱，自己量）；
 * ③ 没有 spec、或 spec 的 family 与 shape 不一致时**明确拒绝**，不猜。
 */
describe("台体（调用方给出形状描述）", () => {
  const FRUSTUM_SPEC: SolidShapeSpec = {
    family: "frustum",
    base: ["A", "B", "C", "D"],
    top: ["A′", "B′", "C′", "D′"],
    relations: [{ kind: "perpendicular", segments: [["A", "B"], ["A", "D"]] }],
    freeScalars: [
      { id: "height", kind: "height", targets: ["A′"], candidates: [2, 3] },
      { id: "top-scale", kind: "top-scale", targets: ["A′", "B′", "C′", "D′"], candidates: [0.5, 0.6] }
    ]
  }
  const PROMPT = "在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台"

  it("spec 驱动的台体产出通过核验的候选，且顶棱**真的**比底棱短", () => {
    const result = searchWitness({ ...SEARCH, shape: "frustum", spec: FRUSTUM_SPEC, obligations: obligationsOf(PROMPT) })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
    if (result.status !== "verified_instance") return
    const at = coordinates(result.candidate)
    const base = lengthVector3(subtractVector3(at("B"), at("A")))
    const top = lengthVector3(subtractVector3(at("B′"), at("A′")))
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(base)
    // 两底平行：四个顶面点同高，且高 > 0。
    const heights = ["A′", "B′", "C′", "D′"].map((name) => at(name).z)
    expect(new Set(heights.map((value) => value.toFixed(9))).size).toBe(1)
    expect(heights[0]!).toBeGreaterThan(0)
  })

  it("没有形状描述 ⇒ 如实拒绝：不替题面语法猜底环 / 顶环 / 相似比", () => {
    const result = searchWitness({ ...SEARCH, shape: "frustum", obligations: obligationsOf(PROMPT) })
    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") return
    expect(result.reasons.join(" "), JSON.stringify(result)).toContain("unsupported-shape")
  })

  it("spec 的 family 与 shape 不一致 ⇒ 明确拒绝，不猜哪一个对", () => {
    const result = searchWitness({ ...SEARCH, shape: "pyramid", spec: FRUSTUM_SPEC, obligations: obligationsOf(PROMPT) })
    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") return
    expect(result.reasons.join(" "), JSON.stringify(result)).toContain("不一致")
  })
})

/**
 * **S6 接线：题面 → 形状描述**（`specForPrompt`）。
 *
 * 这条链是"题面 → 入口语法 → spec → 搜索 → 通过核验的候选"，也是**规划器要用的那根线**。
 * 钉四件事：
 * ① 台体整条链走通（它那两个环只能来自入口语法，没有别的来源）；
 * ② 棱锥 / 棱柱的 spec 与既有推导给出**同一组顶点**（入口语法只是又读了一遍，不是另一套判断）；
 * ③ 认不出 ⇒ 问路，**不产出 spec**；
 * ④ 两处各读一遍、读出来的底环**不是同一组顶点** ⇒ 也问路，不挑一个信。
 */
describe("S6 接线：题面 → 形状描述", () => {
  const givensOf = (prompt: string) => obligationsOf(prompt).obligations.filter((obligation) => obligation.role === "given")

  it("四棱台的题面：spec ⇒ 通过核验的候选（整条链走通）", () => {
    const prompt = "在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台"
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
    if (shaped.status !== "ok") return
    expect(shaped.spec.family).toBe("frustum")
    // 自由标量里必须有相似比：没有它台体根本构造不出来（内核会以缺相似比拒掉）。
    expect(shaped.spec.freeScalars.map((scalar) => scalar.kind)).toContain("top-scale")
    const result = searchWitness({ ...SEARCH, shape: "frustum", spec: shaped.spec, obligations: obligationsOf(prompt) })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
    if (result.status !== "verified_instance") return
    const at = coordinates(result.candidate)
    expect(lengthVector3(subtractVector3(at("B′"), at("A′")))).toBeLessThan(lengthVector3(subtractVector3(at("B"), at("A"))))
  })

  /**
   * **菱形底面**（S3）：题面「底面 ABCD 是菱形」⇒ spec ⇒ **通过核验**的候选。
   *
   * 判据自己算（不读核验器的结论）：四条边两两相等、且**不是正方形**（A 处不是直角）。
   * 「菱形」在解析层被拆成三条链式 `equalLength`（见 `diagramObligations`），
   * 于是它走的是**既有**的等长判据 —— 没有第二套"菱形数学"。
   */
  it("菱形的题面：spec ⇒ 通过核验的候选，且四边真的相等、不是正方形", () => {
    const prompt = "在四棱柱ABCD-A′B′C′D′中，底面ABCD是菱形，AA′⊥平面ABCD，画出这个四棱柱"
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
    if (shaped.status !== "ok") return
    expect(shaped.spec.family).toBe("prism")
    /**
     * **四边相等 ⇒ 自由底边只有一条**：`AD` 由 `AB` 决定。把它也标成"系统自选"是**假的自由**，
     * 而且候选池那条"两条自由底边不许取相等"会让每个候选都与"四边相等"打架。
     */
    expect(shaped.spec.freeScalars.filter((scalar) => scalar.kind === "base-edge")).toHaveLength(1)

    const result = searchWitness({ ...SEARCH, shape: "prism", spec: shaped.spec, obligations: obligationsOf(prompt) })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
    if (result.status !== "verified_instance") return
    const at = coordinates(result.candidate)
    const sides = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]].map(([from, to]) => lengthVector3(subtractVector3(at(to!), at(from!))))
    for (const side of sides) expect(side, JSON.stringify(sides)).toBeCloseTo(sides[0]!, 6)
    const alongAb = subtractVector3(at("B"), at("A"))
    const alongAd = subtractVector3(at("D"), at("A"))
    const cosine = Math.abs(dotVector3(alongAb, alongAd)) / (lengthVector3(alongAb) * lengthVector3(alongAd))
    expect(cosine, "A 处不能是直角 —— 那说明菱形被悄悄画成了正方形").toBeGreaterThan(0.1)
  })

  /**
   * **斜棱柱第一刀：自相矛盾的题面必须被拒**（S3）。
   *
   * `在斜三棱柱ABC-A′B′C′中，AA′⊥平面ABC` 里，"斜"说侧棱**不**垂直于底面，
   * 而 `AA′⊥平面ABC` 说它垂直 —— 两句互相矛盾。修饰词此前被正则吃掉，
   * 于是这种句子会被**当成直棱柱画出来**并一路绿到提交（题面说斜、系统画直）。
   * 判据：入口层就**问路**（`unrecognised`），并说清矛盾在哪。
   */
  it("斜三棱柱 + 「侧棱 ⊥ 底面」⇒ 入口层就拒绝（题面自相矛盾），不静默画成直棱柱", () => {
    const prompt = "在斜三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个斜三棱柱"
    const shaped = specForPrompt(prompt, givensOf(prompt))

    expect(shaped.status, JSON.stringify(shaped)).toBe("unrecognised")
    if (shaped.status === "unrecognised") {
      expect(shaped.reason).toContain("斜")
      expect(shaped.reason).toContain("⊥")
    }
  })

  /**
   * **斜棱柱正例**（S3）：题面只说"斜"、没说斜多少 ⇒ 系统取**代表斜向**并写进假设
   * （与"正 n 边形代表""菱形代表角 60°"同一条口径）。
   *
   * 判据自己在候选坐标上算，两条：
   * - **真的斜**：侧棱与底面法向的夹角余弦明显小于 1（直棱柱会是 1）；
   * - **是棱柱**：三条侧棱是同一条向量（顶面 = 底面的平移），不是各自拉长。
   */
  it("斜三棱柱：spec 带代表斜向 ⇒ 通过核验的候选，侧棱真的斜、且顶面是底面的平移", () => {
    const prompt = "在斜三棱柱ABC-A′B′C′中，AB=2，画出这个斜三棱柱"
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
    if (shaped.status !== "ok") return
    expect(shaped.spec.lateralTiltDegrees, JSON.stringify(shaped.spec)).toBeGreaterThan(0)

    const result = searchWitness({ ...SEARCH, shape: "prism", spec: shaped.spec, obligations: obligationsOf(prompt) })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
    if (result.status !== "verified_instance") return
    const at = coordinates(result.candidate)
    const normal = crossVector3(subtractVector3(at("B"), at("A")), subtractVector3(at("C"), at("A")))
    const lateral = subtractVector3(at("A′"), at("A"))
    const cosine = Math.abs(dotVector3(lateral, normal)) / (lengthVector3(lateral) * lengthVector3(normal))
    expect(cosine, "侧棱与底面法向平行 ⇒ 画成了直棱柱").toBeLessThan(0.99)
    for (const [foot, top] of [["A", "A′"], ["B", "B′"], ["C", "C′"]] as [string, string][]) {
      const edge = subtractVector3(at(top), at(foot))
      expect(lengthVector3(subtractVector3(edge, lateral)), `${foot}${top} 不是同一条平移向量`).toBeLessThan(1e-9)
    }
  })
  /**
   * **反例**：菱形 + 点名直角 = 正方形。题面说的是菱形，**不许**把更强的形状画出来；
   * 而这条路径此前会走"环首直角 ⇒ 矩形"把题面静默画成矩形（本批的内核 RED 里实测）。
   */
  it("菱形 + 点名直角 ⇒ 不给通过核验的候选，理由是「正方形」", () => {
    const prompt = "在四棱柱ABCD-A′B′C′D′中，底面ABCD是菱形，AB⊥AD，AA′⊥平面ABCD，画出这个四棱柱"
    const shaped = specForPrompt(prompt, givensOf(prompt))
    if (shaped.status !== "ok") {
      expect(JSON.stringify(shaped)).toContain("unsupported-base-shape")
      return
    }
    const result = searchWitness({ ...SEARCH, shape: "prism", spec: shaped.spec, obligations: obligationsOf(prompt) })
    expect(result.status, JSON.stringify(result)).not.toBe("verified_instance")
    expect(JSON.stringify(result)).toContain("unsupported-base-shape")
  })

  it("棱锥 / 棱柱：spec 的底环与既有推导同集合，且这份 spec 真能搜出通过核验的候选", () => {
    const pyramid = specForPrompt(PYRAMID, givensOf(PYRAMID))
    expect(pyramid.status, JSON.stringify(pyramid)).toBe("ok")
    if (pyramid.status === "ok") expect([...pyramid.spec.base].sort()).toEqual(["A", "B", "C", "D"])

    const prismPrompt = "在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个三棱柱"
    const prism = specForPrompt(prismPrompt, givensOf(prismPrompt))
    expect(prism.status, JSON.stringify(prism)).toBe("ok")
    if (prism.status !== "ok") return
    expect([...prism.spec.base].sort()).toEqual(["A", "B", "C"])
    const result = searchWitness({ ...SEARCH, shape: "prism", spec: prism.spec, obligations: obligationsOf(prismPrompt) })
    expect(result.status, JSON.stringify(result)).toBe("verified_instance")
  })

  it("认不出的题面 ⇒ 问路（不产出 spec）", () => {
    const shaped = specForPrompt("画一个四棱锥", [])
    expect(shaped.status).toBe("unrecognised")
    if (shaped.status === "unrecognised") expect(shaped.reason).toContain("形状从句")
  })

  it("形状从句与『侧棱 ⊥ 底面』读出来的底环不是同一组顶点 ⇒ 问路，不挑一个信", () => {
    /**
     * 题面写 `P-ABCD`，而"⊥"那句点名的是 `PEFG` 那一套 —— 两处**各读一遍，读不一样**。
     * 这种题面本身自相矛盾，正确行为是问路（而不是挑一边当准）。
     */
    const prompt = "在四棱锥P-ABCD中，PE⊥平面EFG，画出这个四棱锥"
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status, JSON.stringify(shaped)).toBe("unrecognised")
    if (shaped.status === "unrecognised") expect(shaped.reason).toContain("不是同一组顶点")
  })
})

describe("witness search: unsupported inputs stay unsupported", () => {  it("does not invent coordinates for the shapes it cannot derive from the givens", () => {
    const prism = search(PYRAMID, { shape: "prism" })
    expect(prism.status).toBe("unverified_instance")
    if (prism.status !== "unverified_instance") throw new Error("expected a pyramid prompt under the prism family to stay unverified")
    expect(prism.reasons.join(" ")).toContain("unsupported-shape")
    expect(prism.evidence.status).toBe("unknown")

    const polyhedron = search(PYRAMID, { shape: "polyhedron" })
    expect(polyhedron.status).toBe("unverified_instance")
    if (polyhedron.status !== "unverified_instance") throw new Error("expected polyhedra to require caller-provided candidates")
    expect(polyhedron.reasons.join(" ")).toContain("requires-candidates")
  })

  it("reports a given the shared verifier cannot judge as unverified instead of passed", () => {
    const result = search(PYRAMID_MIDPOINT)

    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") throw new Error("expected an unverified outcome")
    const text = result.reasons.join(" ")
    expect(text).toContain("unverified-obligation")
    expect(text).toContain("O为BD的中点")
  })

  it("treats a given the verifier could only 'pass' by its unknown-kind fallback as unjudgeable", () => {
    // 核验器对不认识的 kind 会退化成"按 parallel 量"（`diagramVerification.ts` 的 calculate 尾部），
    // 于是这条 claim 会**被量出来并 passed** —— 但它并不是"系统理解了这条题设"。
    // 判性不是 `supported` 时就绝不能升格成 `verified_instance`（裁决 R34 / M3）。
    const unjudgeable: GeometryObligation = {
      id: "obligation-extra",
      role: "given",
      kind: "proposition",
      sourceText: "本题另有一个尚未支持的条件",
      start: 0,
      end: 0,
      // 这四个点名正好让"退化成 parallel"量得过（底面 BC ∥ AD），所以它**不是**被核验器拦下的。
      targets: ["B", "C", "A", "D"],
      judgeability: "ambiguous"
    }

    const result = searchWitness({ ...SEARCH, obligations: obligationsOf(PYRAMID, [unjudgeable]) })

    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") throw new Error("expected an unverified outcome")
    expect(result.reasons.join(" ")).toContain("unjudgeable-obligation")
  })

  it("keeps the real beyond-first-batch problem out of verified_instance", () => {
    const result = search(TRIANGLE_PYRAMID)

    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") throw new Error("expected the triangle-pyramid problem to stay unsupported")
    expect(result.evidence.status).toBe("unknown")
  })
})

/**
 * **喂给核验器的题设必须与产品路径**同一份（裁决 R32）。
 *
 * 解析器把读不出的子句**故意**留成 residue（`diagramObligations.ts`："必须显形为 unverified，
 * 不能把非空题面静默变成空通过"），核验器再把 residue 变成**强制的 unverified check**；
 * 而只要有 unverified 就不可能 `passed`。所以搜索器若把 residue 丢掉，就等于**精确地关掉那道守卫**：
 * 它能对一个产品路径会判 `unverified` 的题面貌似 `verified_instance`。
 */
describe("witness search: the verifier receives the same forced information as the product path", () => {
  it("refuses to certify a problem whose parse left residue", () => {
    const result = search(PYRAMID_RESIDUE)

    expect(result.status).not.toBe("verified_instance")
    expect(result.status).toBe("unverified_instance")
    if (result.status !== "unverified_instance") throw new Error("expected the residue to block certification")
    const text = result.reasons.join(" ")
    expect(text).toContain("unverified-obligation")
    expect(text).toContain("∠ABC=60°")
  })

  it("refuses to certify a candidate that cannot map a named free point", () => {
    const result = search(PYRAMID_FREE_POINT)

    expect(result.status).not.toBe("verified_instance")
    if (result.status !== "unverified_instance") throw new Error("expected the unmapped free point to block certification")
    expect(result.reasons.join(" ")).toContain("自由点 Q")
  })
})

describe("witness search: kernel interface premises stay asserted", () => {
  it("treats a non-identity buildOrder as unusable instead of guessing an index space", () => {
    // `faces` 与 `points` 共用同一套下标空间，这件事的前提是 `buildOrder` 恒等（2a 的接口注释）。
    // 一旦这条前提破了，`faces` 与重排后的顶点就不再同序 —— 那会**静默**换一组几何，
    // 所以本层宁可拒绝也不猜。
    expect(isIdentityBuildOrder([0, 1, 2, 3, 4], 5)).toBe(true)
    expect(isIdentityBuildOrder([], 0)).toBe(true)
    expect(isIdentityBuildOrder([1, 0, 2, 3, 4], 5)).toBe(false)
    expect(isIdentityBuildOrder([0, 1, 2], 5)).toBe(false)
    expect(isIdentityBuildOrder([0, 1, 2, 3, 5], 5)).toBe(false)
  })
})

describe("witness search: the legacy polyhedron facade delegates instead of duplicating", () => {
  const PYRAMID_WITNESS: PolyhedronWitness = {
    vertices: [
      { x: 0, y: 0, z: 4 },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 }
    ],
    names: ["v0", "v1", "v2", "v3", "v4"],
    faces: [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
  }
  const RELATIONS = [
    { id: "PA-perp-base", kind: "perpendicular" as const, targets: [{ vertex: "v0" }, { vertex: "v1" }, { vertex: "v1" }, { vertex: "v2" }, { vertex: "v3" }] }
  ]

  it("still picks the readable candidate and explains the skipped one through the facade", () => {
    const tall: PolyhedronWitness = { ...PYRAMID_WITNESS, vertices: [{ x: 0, y: 0, z: 100 }, ...PYRAMID_WITNESS.vertices.slice(1)] }

    const result = selectWitness({ kind: "polyhedron", prompt: "画一张四棱锥示意图", candidates: [tall, PYRAMID_WITNESS], relations: RELATIONS })

    expect(result.status).toBe("witness")
    if (result.status !== "witness" || result.value.kind !== "polyhedron") throw new Error("expected a polyhedron witness")
    expect(result.value.vertices[0].z).toBe(4)
    expect(result.assumption.text).toContain("示例值")
    expect(result.considered.join(" ")).toContain("候选 0")
    expect(result.considered.join(" ")).toContain("候选 1")
  })

  it("still rejects with no_acceptable_witness when no candidate survives", () => {
    const skewed: PolyhedronWitness = { ...PYRAMID_WITNESS, vertices: [{ x: 1, y: 0, z: 4 }, ...PYRAMID_WITNESS.vertices.slice(1)] }

    const result = selectWitness({ kind: "polyhedron", prompt: "画出这个四棱锥", candidates: [skewed], relations: RELATIONS })

    expect(result.status).toBe("rejected")
    expect(result.diagnostics.some((entry) => entry.code === "no_acceptable_witness")).toBe(true)
    expect(result.considered.join(" ")).toContain("未满足 PA-perp-base")
  })
})

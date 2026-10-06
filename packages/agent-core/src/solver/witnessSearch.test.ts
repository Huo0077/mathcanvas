import { crossVector3, dotVector3, lengthVector3, subtractVector3, type Vector3 } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import type { GeometryObligation } from "../claimEvidence"
import { parseObligationWithLegacy } from "../obligationIR"
import { selectWitness, type PolyhedronWitness } from "../underdetermined"
import type { WitnessSearchInput } from "./solverContracts"
import { isIdentityBuildOrder, searchWitness } from "./witnessSearch"

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

describe("witness search: unsupported inputs stay unsupported", () => {
  it("does not invent coordinates for the shapes it cannot derive from the givens", () => {
    const prism = search(PYRAMID, { shape: "prism" })
    expect(prism.status).toBe("unverified_instance")
    if (prism.status !== "unverified_instance") throw new Error("expected prisms to be unsupported in the first batch")
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

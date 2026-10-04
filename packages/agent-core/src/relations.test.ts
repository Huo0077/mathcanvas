import { describe, expect, it } from "vitest"
import { diagnoseConstraints3, type Vector3 } from "@draw/geometry-kernel"
import type { ConstraintSpec, PrimitiveSpec } from "@draw/dsl"

import { RELATION_TOLERANCE, missingRelationKinds, relationKindsInText, relationResidual, verifyRelations, type Relation, type RelationTarget } from "./relations"

/**
 * **关系判据**（设计 2026-10-03 §5.3）。
 *
 * 这一层要回答的唯一问题是："题目说的那条关系，在这组坐标上**真的成立**吗？"
 *
 * 为什么判据必须与内核同源：内核 `constraints3d.ts` 已经在算同一种残差（它吃图元 id），
 * 这里吃坐标（因为要在草稿物化**之前**判定）。两处各写一套数学的后果不是"重复"，
 * 而是**两套容差**：同一组几何在一处算满足、在另一处算不满足，而没人知道该信哪个。
 * 所以最后一条用例把它钉死。
 */
const at = (x: number, y: number, z: number): Vector3 => ({ x, y, z })

/** 用户报障那一道：四棱锥 P-ABCD，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD。 */
const PYRAMID: Record<string, Vector3> = {
  P: at(0, 0, 4),
  A: at(0, 0, 0),
  B: at(2, 0, 0),
  C: at(2, 3, 0),
  D: at(0, 3, 0)
}

const lookupIn = (table: Record<string, Vector3>) => (target: RelationTarget): Vector3 | null => table[target.vertex] ?? null

const lookup = lookupIn(PYRAMID)

describe("relation residuals", () => {
  it("accepts a perpendicular that really holds", () => {
    // PA 方向 (0,0,1)；AB 方向 (1,0,0) —— 点积 0。
    const residual = relationResidual({ kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }] }, lookup)

    expect(residual).not.toBeNull()
    expect(residual!).toBeLessThan(RELATION_TOLERANCE)
  })

  it("reports a real residual for a perpendicular that does not hold", () => {
    // PB 与 BA 的夹角不是直角，不该算满足。
    const residual = relationResidual({ kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "B" }, { vertex: "B" }, { vertex: "A" }] }, lookup)

    expect(residual).not.toBeNull()
    expect(residual!).toBeGreaterThan(RELATION_TOLERANCE)
  })

  it("accepts parallel and rejects its negative", () => {
    // BC (0,1,0) 与 AD (0,1,0) —— 平行。
    expect(relationResidual({ kind: "parallel", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] }, lookup)!).toBeLessThan(RELATION_TOLERANCE)
    // AB (1,0,0) 与 BC (0,1,0) —— 垂直，不是平行。
    expect(relationResidual({ kind: "parallel", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "B" }, { vertex: "C" }] }, lookup)!).toBeGreaterThan(RELATION_TOLERANCE)
  })

  it("measures line-perpendicular-to-plane through the plane normal", () => {
    // PA ⊥ 平面 ABCD：线方向 (0,0,1) 与底面法向 (0,0,4) 同向。
    const residual = relationResidual(
      { kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] },
      lookup
    )

    expect(residual).not.toBeNull()
    expect(residual!).toBeLessThan(RELATION_TOLERANCE)
  })

  it("accepts coplanar and rejects a point off the plane", () => {
    expect(relationResidual({ kind: "coplanar", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "C" }, { vertex: "D" }] }, lookup)!).toBeLessThan(RELATION_TOLERANCE)
    expect(relationResidual({ kind: "coplanar", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "C" }, { vertex: "P" }] }, lookup)!).toBeGreaterThan(RELATION_TOLERANCE)
  })

  it("measures equal length, ratio and midpoint", () => {
    // AB = 2、AD = 3 → 不等长；BC = 3、AD = 3 → 等长。
    expect(relationResidual({ kind: "equalLength", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }, lookup)!).toBeGreaterThan(RELATION_TOLERANCE)
    expect(relationResidual({ kind: "equalLength", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] }, lookup)!).toBeLessThan(RELATION_TOLERANCE)
    // BC / AD = 1；AB / BC = 2/3（`ratio` 的语义是 **第二个线段 ÷ 第一个**，
    // 所以 {B,C,A,B} 问的是 AB/BC，不是 BC/AB —— 写这条时我自己先搞反过一次）。
    expect(relationResidual({ kind: "ratio", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }], value: 1 }, lookup)!).toBeLessThan(RELATION_TOLERANCE)
    expect(relationResidual({ kind: "ratio", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "B" }], value: 2 / 3 }, lookup)!).toBeLessThan(RELATION_TOLERANCE)
    // 反过来说"AB/BC = 1.5"就该不成立，这条钉住顺序不是随手写的。
    expect(relationResidual({ kind: "ratio", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "B" }], value: 1.5 }, lookup)!).toBeGreaterThan(RELATION_TOLERANCE)
    // M 是 AD 的中点。
    const withMidpoint = lookupIn({ ...PYRAMID, M: at(0, 1.5, 0) })
    expect(relationResidual({ kind: "midpoint", targets: [{ vertex: "M" }, { vertex: "A" }, { vertex: "D" }] }, withMidpoint)!).toBeLessThan(RELATION_TOLERANCE)
    // 取 D 当"中点"就不成立。
    expect(relationResidual({ kind: "midpoint", targets: [{ vertex: "D" }, { vertex: "A" }, { vertex: "C" }] }, lookup)!).toBeGreaterThan(RELATION_TOLERANCE)
  })

  it("returns null (not zero) when a target is missing, so it can never read as satisfied", () => {
    const missingP = (target: RelationTarget): Vector3 | null => (target.vertex === "P" ? null : PYRAMID[target.vertex] ?? null)

    expect(relationResidual({ kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }] }, missingP)).toBeNull()
  })

  it("refuses a relation whose target count cannot express it", () => {
    // 只有两个顶点算不上"线⊥线"，也定不出平面 —— 不许当成满足。
    expect(relationResidual({ kind: "perpendicular", targets: [{ vertex: "A" }, { vertex: "B" }] }, lookup)).toBeNull()
    expect(relationResidual({ kind: "coplanar", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "C" }] }, lookup)).toBeNull()
    // ratio 没给 value 也算不了。
    expect(relationResidual({ kind: "ratio", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] }, lookup)).toBeNull()
  })

  it("treats a degenerate line as unmeasurable rather than satisfied", () => {
    // A 与 A 重合：没有方向。
    expect(relationResidual({ kind: "parallel", targets: [{ vertex: "A" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }] }, lookup)).toBeNull()
  })
})

describe("verifyRelations", () => {
  it("reports which declared relations failed, with their residuals", () => {
    const declared: Relation[] = [
      { id: "r1", kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] },
      // 故意写一条不成立的：AB ∥ AD。
      { id: "r2", kind: "parallel", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }
    ]

    const result = verifyRelations(declared, lookup)

    expect(result.ok).toBe(false)
    expect(result.failures.map((failure) => failure.id)).toEqual(["r2"])
    expect(result.failures[0].residual).toBeGreaterThan(RELATION_TOLERANCE)
  })

  it("passes the pyramid's three stated relations when the coordinates honour them", () => {
    const declared: Relation[] = [
      { id: "PA-perp-base", kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] },
      { id: "BC-parallel-AD", kind: "parallel", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] },
      { id: "AB-perp-AD", kind: "perpendicular", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }
    ]

    const result = verifyRelations(declared, lookup)

    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it("fails a relation whose vertex name does not exist, instead of silently passing it", () => {
    // "无法判定"不许读成"已满足"：否则模型写错一个点名就静默过关。
    const result = verifyRelations([{ id: "typo", kind: "parallel", targets: [{ vertex: "Q" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }], lookup)

    expect(result.ok).toBe(false)
    expect(result.failures[0].residual).toBeNull()
    expect(result.failures[0].detail).toContain("顶点来源")
  })

  it("accepts an empty declaration list as vacuously satisfied", () => {
    expect(verifyRelations([], lookup)).toEqual({ ok: true, failures: [] })
  })
})

/**
 * **覆盖度校对**（设计 2026-10-03 §5.2）。
 *
 * 它防的是这一类静默错误：题面明说"PA ⊥ 平面 ABCD、BC ∥ AD"，模型只声明了平行，
 * 于是"垂直"这条**根本没人验**，而系统照样宣布"关系全部成立"。
 *
 * 边界同样重要：覆盖度**只查"有没有回应"**，不试图从自然语言里抠出是哪四个点 ——
 * 那是模型声明表的职责。第一、三条用例把这条边界钉住。
 */
describe("relation coverage", () => {
  it("finds the relation keywords in the user's own words", () => {
    const prompt = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥"

    const kinds = relationKindsInText(prompt)

    expect(kinds.has("perpendicular")).toBe(true)
    expect(kinds.has("parallel")).toBe(true)
  })

  it("demands an answer for every keyword the prompt used", () => {
    const prompt = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD"

    // 模型只声明了平行，漏掉了垂直 → 必须报出来。
    expect(missingRelationKinds(prompt, [{ kind: "parallel", targets: [] }])).toEqual(["perpendicular"])
  })

  it("does not demand a kind the prompt never mentioned", () => {
    // 只说了共面，就只该要求共面；不能因为"没声明垂直"而报错。
    expect(missingRelationKinds("四个点共面", [{ kind: "coplanar", targets: [] }])).toEqual([])
    expect(missingRelationKinds("画一个四棱锥，底面是矩形", [])).toEqual([])
  })

  it("recognises the metric relations by their Chinese phrasings", () => {
    expect(relationKindsInText("M 是 AD 的中点").has("midpoint")).toBe(true)
    expect(relationKindsInText("AB 与 CD 等长").has("equalLength")).toBe(true)
    expect(relationKindsInText("BC 与 AD 的长度相等").has("equalLength")).toBe(true)
    expect(relationKindsInText("BC 与 AD 之比为 3 比 2").has("ratio")).toBe(true)
    expect(relationKindsInText("这四个点共面").has("coplanar")).toBe(true)
  })

  /**
   * **误报是这张表最贵的错误**：覆盖度每次误报都会把一次正常作图拒回去重做。
   * 这几条来自实测 —— 它们对应的两个夹具在第一版宽口径下**真的红了**。
   */
  it("does not fire on an angle that is not a relation between two objects", () => {
    // "一角 60°" 是"一个角"，不是"AB ⊥ AD"那种两个对象之间的关系。
    expect(relationKindsInText("底面边长 2、一角 60° 的菱形斜四棱柱").has("perpendicular")).toBe(false)
  })

  it("does not fire on everyday words that merely contain relation characters", () => {
    // "比如" / "相比" 里的"比"；口语里的"相等"。宽口径会在这里误报。
    expect(relationKindsInText("比如画一个棱柱，相比上一个更大").has("ratio")).toBe(false)
    // 注意"比 2"这种写法仍然算比例（之比/比值/比例 三选一即可）。
    expect(relationKindsInText("BC 与 AD 之比为 3 比 2").has("ratio")).toBe(true)
  })

  it("does not read a point name as a ratio", () => {
    // 裸的点名里有 "P:" / "AD:"，不能把冒号当成比例号。
    expect(relationKindsInText("在四棱锥 P-ABCD 中，PA 垂直 平面 ABCD").has("ratio")).toBe(false)
  })

  it("does not read an unknown declared kind as a ratio", () => {
    // 放行名单里没有的种类不许被当成"已经回应了比例"。
    const unknown = [{ kind: "tangent" } as unknown as Relation]
    expect(missingRelationKinds("BC 与 AD 之比为 3 比 2", unknown)).toEqual(["ratio"])
  })

  it("counts a declared kind as answering its own Chinese phrasing", () => {
    // 中文题面 vs 英文 kind 之间那道语言缝：声明了 ratio 就是回应了"比例"。
    expect(missingRelationKinds("BC 与 AD 之比为 3 比 2", [{ kind: "ratio", targets: [] }])).toEqual([])
    expect(missingRelationKinds("这四个点共面", [{ kind: "coplanar", targets: [] }])).toEqual([])
  })

  it("is not fooled by one kind name containing another as a substring", () => {
    // **真踩过的坑**：`JSON.stringify(["parallel"])` 里含有 `"perp` 这一段，
    // 于是"用子串判断声明表里有没有 perpendicular"会**误判为已回应**，
    // 漏掉的垂直就这么静默通过了。这条用例专门钉住它。
    expect(missingRelationKinds("PA 垂直 平面 ABCD，BC 平行 AD", [{ kind: "parallel", targets: [] }])).toEqual(["perpendicular"])
    // 反向：声明了垂直、漏了平行，同样必须报出来。
    expect(missingRelationKinds("PA 垂直 平面 ABCD，BC 平行 AD", [{ kind: "perpendicular", targets: [] }])).toEqual(["parallel"])
  })
})

/**
 * **同源核对**：同一组几何，一处让内核算、一处让本模块算，判据必须落在同一个结论上。
 *
 * 这条是本文件唯一真正重要的断言 —— 别的用例钉的是"数学对不对"，它钉的是
 * "我们**没有第二套几何判据**"。少了它，两处慢慢分叉是迟早的事，而且分叉时
 * 两边各自的测试都还是绿的。
 */
describe("same-source check against the geometry kernel", () => {
  const primitives: PrimitiveSpec[] = [
    { id: "P", type: "point3", position: PYRAMID.P },
    { id: "A", type: "point3", position: PYRAMID.A },
    { id: "B", type: "point3", position: PYRAMID.B },
    { id: "C", type: "point3", position: PYRAMID.C },
    { id: "D", type: "point3", position: PYRAMID.D },
    { id: "AB", type: "segment3", pointIds: ["A", "B"] },
    { id: "AD", type: "segment3", pointIds: ["A", "D"] },
    { id: "BC", type: "segment3", pointIds: ["B", "C"] }
  ]

  const agrees = (constraint: ConstraintSpec, relation: Relation): void => {
    const kernel = diagnoseConstraints3([constraint], primitives, RELATION_TOLERANCE)[0]
    const ours = relationResidual(relation, lookup)
    expect(ours, relation.id).not.toBeNull()
    // 内核的 satisfied 与"我们算出的残差在同一个容差内"必须一致。
    expect(kernel.satisfied, `${relation.id}: kernel residual ${String(kernel.residual)} vs ours ${String(ours)}`).toBe(ours! <= RELATION_TOLERANCE)
    /**
     * **残差本身也必须对得上，不能只对布尔**。
     *
     * 这条是补上的：第一版只比 `satisfied`，于是 `planeNormalFrom` 忘了归一（残差被 `|n|`
     * 缩放）照样全绿 —— 0 与非 0 不受缩放影响，结论一致而数值全错。用"只看布尔"的判据去证明
     * "两处判定一致"，只能证明一半。
     */
    expect(kernel.residual, `${relation.id}: kernel ${String(kernel.residual)} vs ours ${String(ours)}`).toBeCloseTo(ours!, 12)
  }

  it("agrees on a positive perpendicular and a negative one", () => {
    agrees(
      { id: "pos", type: "perpendicular", targets: ["AB", "AD"], tolerance: RELATION_TOLERANCE },
      { id: "pos", kind: "perpendicular", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }
    )
    agrees(
      { id: "neg", type: "perpendicular", targets: ["AB", "BC"], tolerance: RELATION_TOLERANCE },
      { id: "neg", kind: "perpendicular", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "B" }, { vertex: "C" }] }
    )
  })

  it("agrees on parallel, both ways", () => {
    agrees(
      { id: "pos", type: "parallel", targets: ["BC", "AD"], tolerance: RELATION_TOLERANCE },
      { id: "pos", kind: "parallel", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] }
    )
    agrees(
      { id: "neg", type: "parallel", targets: ["AB", "BC"], tolerance: RELATION_TOLERANCE },
      { id: "neg", kind: "parallel", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "B" }, { vertex: "C" }] }
    )
  })

  it("agrees on coplanar, both ways", () => {
    agrees(
      { id: "pos", type: "coplanar", targets: ["A", "B", "C", "D"], tolerance: RELATION_TOLERANCE },
      { id: "pos", kind: "coplanar", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "C" }, { vertex: "D" }] }
    )
    agrees(
      { id: "neg", type: "coplanar", targets: ["A", "B", "C", "P"], tolerance: RELATION_TOLERANCE },
      { id: "neg", kind: "coplanar", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "C" }, { vertex: "P" }] }
    )
  })
})

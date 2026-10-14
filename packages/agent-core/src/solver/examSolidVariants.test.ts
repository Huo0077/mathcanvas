import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import type { Vector3 } from "@draw/geometry-kernel"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { parseObligationWithLegacy } from "../obligationIR"
import { compilePlan } from "../planCompiler"
import { searchWitness, specForPrompt } from "./witnessSearch"

/**
 * **Task 13 真题变式：题面给"二面角"时，顶点的高由它求出来**（2026-10-12）。
 *
 * ## 这一条挡的是什么
 *
 * 内核里**早就**有"由二面角求顶点高"那一支（`deriveApexHeight` 的 `dihedral` 分支、
 * 连它的单测都在 `constructors.test.ts`）—— 但它要的是
 * `apex.height = { kind: "dihedral", angleRelation }`，而**编排层从不设它**，
 * 而且 `kernelRelations` 连 `dihedral` 这条题设**都没有映射**：
 * 于是"题面给了二面角"这件事在**产品路径上等于没发生**，高只能自由取。
 * 这正是计划 Task 13 RED 点名的"二面角"那一格。
 *
 * ## 判据
 *
 * ① 搜索拿到 `verified_instance`；② **自己算**那个二面角（两个半平面各自的垂线方向夹角），
 * 与题面写的 45° 比 —— 不读面板结论、也不读构造过程留下的量。
 */

const PROMPT = (degrees: number): string => `在四棱锥P-ABCD中，PA⊥平面ABCD，AB⊥AD，二面角P-CD-A=${degrees}°，画出这个四棱锥`

const givensOf = (prompt: string) =>
  parseObligationWithLegacy(prompt).ir.obligations.filter((obligation) => obligation.role === "given")

describe("Task 13 变式 —— 二面角定高", () => {
  /**
   * **两个角各来一遍**（45° 与 60°）：如果高是"按这个角求出来的"，那两个角就该各自量得出来；
   * 若哪里写死了一个值，第二遍就会红。这比"只测一遍"更能说明"它是从题面算的"。
   */
  for (const stated of [45, 60]) {
    it(`题面给了二面角 ${stated}° ⇒ 高由它求出来，且从最终坐标量出来正是那个角`, () => {
    const prompt = PROMPT(stated)
    const parsed = parseObligationWithLegacy(prompt)
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
    if (shaped.status !== "ok") return

    const result = searchWitness({
      obligations: parsed.ir,
      shape: shaped.recognised.family,
      spec: shaped.spec,
      seed: 1,
      maxCandidates: 8,
      timeoutMs: 10_000
    })
    const why = result.status === "verified_instance"
      ? "verified_instance"
      : result.status === "no_witness"
        ? result.failures.join(" / ")
        : result.reasons.join(" / ")
    expect(result.status, `今天读到的是：${why}`).toBe("verified_instance")
    if (result.status !== "verified_instance") return

    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    const must = (name: string): Vector3 => {
      const found = at.get(name)
      if (found === undefined) throw new Error(`候选里没有点名 ${name}；现有：${[...at.keys()].join("、")}`)
      return found
    }
    const subtract = (left: Vector3, right: Vector3): Vector3 => ({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z })
    const dot = (left: Vector3, right: Vector3): number => left.x * right.x + left.y * right.y + left.z * right.z
    const cross = (left: Vector3, right: Vector3): Vector3 => ({
      x: left.y * right.z - left.z * right.y,
      y: left.z * right.x - left.x * right.z,
      z: left.x * right.y - left.y * right.x
    })
    const norm = (value: Vector3): number => Math.hypot(value.x, value.y, value.z)

    /**
     * **自己算二面角 `P-CD-A`**：沿折痕 `CD` 取一条方向，把 `C→P` 与 `C→A` 各自**去掉沿折痕的分量**，
     * 剩下两个半平面内的垂线方向，它们的夹角就是那个二面角。
     */
    const c = must("C")
    const d = must("D")
    const hinge = subtract(d, c)
    const drop = (vector: Vector3): Vector3 => {
      const scale = dot(vector, hinge) / dot(hinge, hinge)
      return { x: vector.x - scale * hinge.x, y: vector.y - scale * hinge.y, z: vector.z - scale * hinge.z }
    }
    const alongToP = drop(subtract(must("P"), c))
    const alongToA = drop(subtract(must("A"), c))
    expect(norm(alongToP)).toBeGreaterThan(1e-9)
    expect(norm(alongToA)).toBeGreaterThan(1e-9)
    const degrees = (Math.acos(Math.min(1, Math.max(-1, dot(alongToP, alongToA) / (norm(alongToP) * norm(alongToA))))) * 180) / Math.PI
    expect(degrees, `自算二面角 P-CD-A = ${degrees.toFixed(4)}°，题面写的是 ${stated}°`).toBeCloseTo(stated, 4)
    // 顺带钉住"这确实是一只四棱锥"：底面四点共面（法向非零）且顶点离开底面。
    expect(norm(cross(subtract(must("B"), must("A")), subtract(must("D"), must("A"))))).toBeGreaterThan(1e-9)
    expect(Math.abs(must("P").z - must("A").z)).toBeGreaterThan(1e-9)
    })
  }
})

/**
 * **Task 13 变式「棱柱上的点名」**（2026-10-12）—— 探针，先把今天的实情钉出来。
 *
 * 计划点名要"2021 / 2022 的**棱柱**与棱锥"以及"棱上 / 面上点"。而 `solid.create_prism` 的载荷只有
 * `basePolygon` / `vector` / `label`：**没有 `vertexNames`** —— 棱柱的顶点是**没有名字**的。
 * 于是题面里 `AB=2`、`D 为 AA′ 的中点` 这类**按名字**说的条件会怎么样？
 * 这条先把它如实量出来（红也要看清是"哪种红"）。
 */
describe("Task 13 变式 —— 棱柱上的点名（探针）", () => {
  it("棱柱顶点没有名字时，题面里 `AB=2` 这条按名字说的条件会怎么样", () => {
    const prompt = "在正三棱柱ABC-A′B′C′中，AB=2，画出这个正三棱柱"
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "正三棱柱（模型只报底面与拉伸向量，没有点名）",
      factIds: [],
      actions: [{
        actionId: "solid.create_prism",
        actionKey: "prism",
        factIds: [],
        inputs: {
          alias: "prism",
          basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: Math.sqrt(3), z: 0 }],
          vector: { x: 0, y: 0, z: 3 }
        }
      }]
    } as unknown as PlanEnvelope

    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt, conversationId: "prism-names", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`) ?? []
    const labels = (result.draftDocument?.primitives ?? []).flatMap((primitive) => (primitive.type === "point3" && (primitive as { label?: unknown }).label !== undefined ? [(primitive as { label?: unknown }).label] : []))

    /**
     * **今天的实情（缺口，本轮只钉住、未修）** —— 实测 `ok=true；核验=[]；带名字的点=[P1…P6]；诊断=[]`：
     *
     * 1. 棱柱的顶点被编成 **`P1…P6`**（模板自己的顺序编号），**不是题面里的 `A`/`B`/`C`/`A′`…**；
     * 2. 因此 `planHasVerifiableFigure` **刻意**不把 `solid.create_prism` 算进"能让题面点名的顶点拿到坐标"
     *    那一族 —— 它的注释原话是"`solid.create_template` 也会给子对象编 A、B、C…，但那是**模板自己的
     *    顺序编号**，与题面点名不是一回事"，这条理由**逐字适用于今天的棱柱**；
     * 3. 结果是：题面里的 `AB=2` **一条都不进核验**（`核验=[]`），而这一轮 `ok=true` ——
     *    **静默通过**。对"2021/2022 的棱柱题"来说，这是"画得像 ≠ 题设成立"最彻底的一种形态。
     *
     * **修法方向（两步，缺一不可）**：① 让 `solid.create_prism` 收 `vertexNames`（底面 n 个 + 顶面 n 个，
     * 与题面 `ABC-A′B′C′` 一一对应）并给子对象打上这些名字；② `planHasVerifiableFigure` 对棱柱改成
     * **按动作判**（**带了点名**才算"可核验"）—— 不能无条件加进那个集合，否则"只画个棱柱"的题面
     * 会去核验并不存在的点名，反而把本来能过的挡住（那正是它注释里排除模板的理由）。
     */
    expect(labels, `带名字的点：${JSON.stringify(labels)}`).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"])
    expect(checks, "棱柱的题设今天一条都不进核验").toEqual([])
    expect(result.ok, "而且这一轮是**静默通过**").toBe(true)
  })

  /**
   * **修好之后的那一半：棱柱带上点名 ⇒ 核验真的跑起来，`AB=2` 按名字量得到。**
   *
   * 两步都落在这条用例上：① `solid.create_prism` 收 `vertexNames`（底面 n 个 + 顶面 n 个）并给子对象打名字；
   * ② `planHasVerifiableFigure` 对棱柱**按动作判**（带了点名才算可核验）。
   *
   * 判据自己算：底面上 `A`、`B` 两点的距离必须是 2（题面写的就是 `AB=2`），
   * 而且要能看见"`AB=2` 这条**进了核验**"（`核验=[]` 那种静默才是要堵的洞）。
   */
  it("棱柱带上点名 ⇒ `AB=2` 进核验并按名字量出来（坐标自己算）", () => {
    const prompt = "在正三棱柱ABC-A′B′C′中，AB=2，画出这个正三棱柱"
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "正三棱柱（底面 + 顶面逐一对应的点名）",
      factIds: [],
      actions: [{
        actionId: "solid.create_prism",
        actionKey: "prism",
        factIds: [],
        inputs: {
          alias: "prism",
          basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: Math.sqrt(3), z: 0 }],
          vector: { x: 0, y: 0, z: 3 },
          vertexNames: ["A", "B", "C", "A′", "B′", "C′"]
        }
      }]
    } as unknown as PlanEnvelope

    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt, conversationId: "prism-names", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`) ?? []
    const find = (label: string): Vector3 => {
      const found = (result.draftDocument?.primitives ?? []).find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
      if (found?.type !== "point3") throw new Error(`文档里没有点名 ${label}；核验=[${checks.join("；")}]；诊断=[${result.diagnostics.map((entry) => entry.code).join("、")}]`)
      return found.position
    }

    // ① 点名真的落在棱柱的顶点上（底面三个 + 顶面三个）。
    const labels = (result.draftDocument?.primitives ?? []).flatMap((primitive) => (primitive.type === "point3" && (primitive as { label?: unknown }).label !== undefined ? [(primitive as { label?: unknown }).label] : []))
    expect(labels, `带名字的点：${JSON.stringify(labels)}`).toEqual(["A", "B", "C", "A′", "B′", "C′"])
    // ② 题面那条 `AB=2` **进了核验**（不再是一条都不跑），而且量出来确实成立。
    expect(checks.some((entry) => entry.startsWith("AB=2:")), `核验=[${checks.join("；")}]`).toBe(true)
    expect(checks.find((entry) => entry.startsWith("AB=2:")), `核验=[${checks.join("；")}]`).toBe("AB=2:passed")
    // ③ **自己算**：A 到 B 的距离 = 2。
    const a = find("A")
    const b = find("B")
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(2, 9)
  })

  /**
   * **底面数变化**（Task 13 变式）：底面从四边形换成**五边形**。实测到的是**两半**，
   * 两半都要钉住 —— 这不是"能/不能"一条线，而是"哪一类能、哪一类如实拒绝"。
   *
   * ① **正五棱锥**：底面走"正 5 边形代表"（与"正 n 边形代表""菱形代表角 60°"同一条口径）⇒ 构造得出来；
   * ② **五边形底面 + 题面给的角度条件**（`AB⊥BC`）：正五边形代表**满足不了**它，
   *    而这一支**不换一个题面没说的形状** ⇒ **如实拒绝**，理由逐字说清。
   *
   * ②那种拒绝是**对的**（换了形状就是替用户改题）；它记在这里是为了以后谁要补"五边形底面联立"时，
   * 知道今天的边界**画在哪一条线上**。
   */
  it("五棱锥：正五棱锥（代表形状）造得出来；而五边形底面 + 角度条件 ⇒ 如实拒绝、不换形状", () => {
    /** 几何自算用的小工具（两个用例共用）。 */
    const geometry = (name: string, at: Map<string, Vector3>) => {
      const must = (label: string): Vector3 => {
        const found = at.get(label)
        if (found === undefined) throw new Error(`候选里没有点名 ${label}；现有：${[...at.keys()].join("、")}`)
        return found
      }
      const subtract = (left: Vector3, right: Vector3): Vector3 => ({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z })
      const dot = (left: Vector3, right: Vector3): number => left.x * right.x + left.y * right.y + left.z * right.z
      const cross = (left: Vector3, right: Vector3): Vector3 => ({
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x
      })
      const norm = (value: Vector3): number => Math.hypot(value.x, value.y, value.z)
      return { must, subtract, dot, cross, norm, name }
    }

    // ① 正五棱锥：代表形状 ⇒ 造得出来。
    const regular = "在正五棱锥P-ABCDE中，PA⊥平面ABCDE，画出这个正五棱锥"
    const regularShaped = specForPrompt(regular, givensOf(regular))
    expect(regularShaped.status, JSON.stringify(regularShaped)).toBe("ok")
    if (regularShaped.status !== "ok") return
    const regularResult = searchWitness({ obligations: parseObligationWithLegacy(regular).ir, shape: regularShaped.recognised.family, spec: regularShaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
    const regularWhy = regularResult.status === "verified_instance" ? "verified_instance" : regularResult.status === "no_witness" ? regularResult.failures.join(" / ") : regularResult.reasons.join(" / ")
    expect(regularResult.status, `正五棱锥今天读到的是：${regularWhy}`).toBe("verified_instance")
    if (regularResult.status === "verified_instance") {
      const at = new Map(regularResult.candidate.names.map((name, index) => [name, regularResult.candidate.vertices[index]!]))
      const { must, subtract, dot, cross, norm } = geometry("regular", at)
      // 五个底面点**共面**，而顶点离开底面（不是压平的一片）。
      const normal = cross(subtract(must("B"), must("A")), subtract(must("C"), must("A")))
      expect(norm(normal)).toBeGreaterThan(1e-9)
      for (const name of ["D", "E"]) {
        expect(Math.abs(dot(normal, subtract(must(name), must("A")))) / norm(normal), `${name} 到平面 ABC 的距离`).toBeLessThan(1e-6)
      }
      expect(Math.abs(dot(normal, subtract(must("P"), must("A")))) / norm(normal), "顶点到到底面的距离").toBeGreaterThan(1e-6)
    }

    // ② 五边形底面 + 题面角度条件 ⇒ 如实拒绝（**不换一个题面没说的形状**）。
    const angled = "在五棱锥P-ABCDE中，PA⊥平面ABCDE，AB⊥BC，画出这个五棱锥"
    const angledShaped = specForPrompt(angled, givensOf(angled))
    expect(angledShaped.status, JSON.stringify(angledShaped)).toBe("ok")
    if (angledShaped.status !== "ok") return
    const angledResult = searchWitness({ obligations: parseObligationWithLegacy(angled).ir, shape: angledShaped.recognised.family, spec: angledShaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
    const angledWhy = angledResult.status === "verified_instance" ? "verified_instance" : angledResult.status === "no_witness" ? angledResult.failures.join(" / ") : angledResult.reasons.join(" / ")
    expect(angledResult.status, `今天读到的是：${angledWhy}`).not.toBe("verified_instance")
    expect(angledWhy, `今天读到的是：${angledWhy}`).toMatch(/正 5 边形代表满足不了它/)
    expect(angledWhy, `今天读到的是：${angledWhy}`).toMatch(/不换一个题面没说的形状/)
  })

  /**
   * **斜棱柱的"明说倾角"**（Task 13 变式）—— 探针，**两个不同的角**各来一遍。
   *
   * `specForObliquePrism` 的设计口径是"题面只说'斜'、**没说斜多少** ⇒ 取一个代表值（60°）并写进假设"。
   * 那么题面**明说**了倾角时呢？实测：解析器里**没有"所成角"这个词的读取器**，
   * 于是这句话既进不了 `relations`，也改不动 `lateralTiltDegrees`。
   *
   * 判据就是**两个不同的角**：如果那个代表值真的与题面无关，两遍读出来的就该是**同一个数**。
   * （同一族的"二面角"当初也是这样被抓出来的：45° 与 60° 量出来都是 45.000。）
   */
  it("斜棱柱明说倾角：45° 与 60° 取到的斜向**不再相同**，而且就是题面那个角的余角", () => {
    const tiltOf = (degrees: number): number => {
      const prompt = `在斜三棱柱ABC-A′B′C′中，AB=2，AA′与底面所成角为${degrees}°，画出这个斜三棱柱`
      const shaped = specForPrompt(prompt, givensOf(prompt))
      expect(shaped.status, `${degrees}°：${JSON.stringify(shaped)}`).toBe("ok")
      if (shaped.status !== "ok") return Number.NaN
      return shaped.spec.lateralTiltDegrees ?? Number.NaN
    }
    /**
     * `lateralTiltDegrees` 的口径是**与底面法向**的夹角，而题面写的是**线面角** ——
     * 两者互为余角。这两个数**不能写反**：写 45° 时恰好都是 45°（掩盖错误的那种巧合），
     * 写 60° 时才分得开（法向 30° vs 线面 60°）。所以两条都用上。
     */
    expect(tiltOf(45), "写 45° ⇒ 与法向 45°").toBeCloseTo(45, 6)
    expect(tiltOf(60), "写 60° ⇒ 与法向 30°（不是 60°）").toBeCloseTo(30, 6)
    expect(tiltOf(45), "题面那个角真的进了链 ⇒ 两个角不再取到同一个数").not.toBeCloseTo(tiltOf(60), 6)
  })

  /**
   * **端到端那一条**：题面明说 45°，搜到的实例必须**真的**满足 45° —— 由测试**自己从坐标量**。
   *
   * 这一条同时钉住三层：解析层读得出（`linePlaneAngle`）、构造层用它（`lateralTiltDegrees`）、
   * 核验层量得出来（`diagramVerification` 的线面角判据）。少了第三层就是"读得懂但没人核" ——
   * 那比读不懂更糟（本仓把这句话写在修法方向上）。
   */
  it("斜三棱柱明说倾角 45° ⇒ 实例真的满足（自己从最终坐标量线面角）", () => {
    const prompt = "在斜三棱柱ABC-A′B′C′中，AB=2，AA′与底面所成角为45°，画出这个斜三棱柱"
    const parsed = parseObligationWithLegacy(prompt)
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
    if (shaped.status !== "ok") return

    const result = searchWitness({ obligations: parsed.ir, shape: shaped.recognised.family, spec: shaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
    const why = result.status === "verified_instance"
      ? "verified_instance"
      : result.status === "no_witness"
        ? result.failures.join(" / ")
        : result.reasons.join(" / ")
    expect(result.status, `今天读到的是：${why}`).toBe("verified_instance")
    if (result.status !== "verified_instance") return

    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    const must = (name: string): Vector3 => {
      const found = at.get(name)
      if (found === undefined) throw new Error(`候选里没有点名 ${name}；现有：${[...at.keys()].join("、")}`)
      return found
    }
    const subtract = (left: Vector3, right: Vector3): Vector3 => ({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z })
    const dot = (left: Vector3, right: Vector3): number => left.x * right.x + left.y * right.y + left.z * right.z
    const cross = (left: Vector3, right: Vector3): Vector3 => ({
      x: left.y * right.z - left.z * right.y,
      y: left.z * right.x - left.x * right.z,
      z: left.x * right.y - left.y * right.x
    })
    const norm = (value: Vector3): number => Math.hypot(value.x, value.y, value.z)

    // 线面角 = arcsin(|v·n| / (|v||n|))，v 是侧棱 AA′、n 是底面 ABC 的法向。
    const a = must("A")
    const direction = subtract(must("A′"), a)
    const normal = cross(subtract(must("B"), a), subtract(must("C"), a))
    expect(norm(direction)).toBeGreaterThan(1e-9)
    expect(norm(normal)).toBeGreaterThan(1e-9)
    const sine = Math.abs(dot(direction, normal)) / (norm(direction) * norm(normal))
    const degrees = (Math.asin(Math.min(1, Math.max(0, sine))) * 180) / Math.PI
    expect(degrees, `自算 AA′ 与底面 ABC 的线面角 = ${degrees.toFixed(4)}°`).toBeCloseTo(45, 3)
  })

  /**
   * **组合实体**（Task 13 变式）：**第二阶段的题设能不能量到第一阶段建出来的点**。
   *
   * 产品里的组合实体天然是**两个阶段**（先一只实体、再在上面加一只），而核验要能同时看见
   * 两个阶段的点名 —— 判据就落在那一条**跨阶段**的条件上（`PB=5`：`B` 来自第一阶段那只正方体，
   * `P` 来自第二阶段那只四棱锥）。
   *
   * 两段都是**真编译**出来的：第一阶段直接拿它的 `draftDocument` 当第二阶段的底稿。
   */
  it("组合实体：第二阶段的题设量得到第一阶段建的点（跨阶段点名）", () => {
    const cubePrompt = "在正方体ABCD-A′B′C′D′中，棱长为2，画出这个正方体"
    const cube = compilePlan(
      {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "plan",
        goal: "正方体 ABCD-A′B′C′D′（棱长 2）",
        factIds: [],
        actions: [{
          actionId: "solid.create_polyhedron",
          actionKey: "cube",
          factIds: [],
          inputs: {
            alias: "cube",
            vertexNames: ["A", "B", "C", "D", "A′", "B′", "C′", "D′"],
            vertices: [
              { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 },
              { x: 0, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }
            ],
            faces: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
          }
        }]
      } as unknown as PlanEnvelope,
      { document: createEmptyDocument("geometry3d"), prompt: cubePrompt, conversationId: "composite", documentGeneration: 0 }
    )
    expect(cube.ok, cube.diagnostics.map((entry) => entry.detail).join("；")).toBe(true)
    const base = cube.draftDocument
    if (base === null) throw new Error("第一阶段没有产出草稿")

    /**
     * 第二阶段：在正方体上方加一只四棱锥（底面正是正方体的顶面），而题面里那条 `PB=5`
     * **一边是第一阶段的正方体的顶点 `B`，一边是第二阶段的顶点 `P`**。
     */
    const pyramidPrompt = "在四棱锥P-A′B′C′D′中，PA′⊥平面A′B′C′D′，且PB=5，在这个正方体上方画出这个四棱锥"
    const pyramid = compilePlan(
      {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "plan",
        goal: "正方体上方的四棱锥 P-A′B′C′D′，且 PB=5",
        factIds: [],
        actions: [{
          actionId: "solid.create_polyhedron",
          actionKey: "pyramid",
          factIds: [],
          inputs: {
            alias: "pyramid",
            vertexNames: ["P", "A′", "B′", "C′", "D′"],
            vertices: [
              /** `P` 取在 `A′` 正上方且 `|PB| = 5`：`B=(2,0,0)`、`P=(0,0,h)` ⇒ `h = √(25−4) = √21`。 */
              { x: 0, y: 0, z: Math.sqrt(21) }, { x: 0, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }
            ],
            faces: [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]]
          }
        }]
      } as unknown as PlanEnvelope,
      { document: base, prompt: pyramidPrompt, conversationId: "composite", documentGeneration: base.revision }
    )

    const checks = pyramid.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`) ?? []
    const document = pyramid.draftDocument
    const labels = (document?.primitives ?? []).flatMap((primitive) => (primitive.type === "point3" && (primitive as { label?: unknown }).label !== undefined ? [(primitive as { label?: unknown }).label] : []))
    const read = (label: string): Vector3 | null => {
      const found = (document?.primitives ?? []).find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
      return found?.type === "point3" ? found.position : null
    }
    const p = read("P")
    const b = read("B")
    const distance = p === null || b === null ? Number.NaN : Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z)

    /**
     * **钉住"跨阶段点名"这件事**：把两阶段的点名与那条跨阶段条件都打出来。
     * `PB=5` 若是 `unverified`/缺失，说明第二阶段看不到第一阶段建的点 —— 那正是组合实体的关键一格。
     */
    expect(read("B"), `第一阶段的正方体顶点 B 在第二阶段的文档里：labels=${JSON.stringify(labels)}；ok=${String(pyramid.ok)}；诊断=[${pyramid.diagnostics.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join("；")}]`).not.toBeNull()
    expect(p, `第二阶段的顶点 P：labels=${JSON.stringify(labels)}`).not.toBeNull()
    expect(distance, `自算 PB=${distance}（P=(${p?.x},${p?.y},${p?.z})、B=(${b?.x},${b?.y},${b?.z})）`).toBeCloseTo(5, 6)
    const pbCheck = checks.find((entry) => entry.startsWith("PB=5:"))
    expect(pbCheck, `核验=[${checks.join("；")}]；诊断=[${pyramid.diagnostics.map((entry) => entry.code).join("、")}]`).toBe("PB=5:passed")
  })

  /**
   * **Task 13 剩下两个变式的**边界**（不是缺口，是"今天没有产品入口"）—— 都钉成判据。**
   *
   * ① **面上点**：`dynamic.create_bound_point` 的宿主只收**棱 / 线 / 曲线**
   *（`SPATIAL_HOST_TYPES = {edge3, line3, segment3, ray3, circle3}`，**没有 `face3`、也没有 `polyhedron3`**）。
   *   所以"点在面上"今天**没有产品入口** —— 它必须**如实拒绝**（`unsupported_host`），而不是悄悄把点放到别处。
   * ② **顶点垂足不在中心**：这一支**本来就支持**且是常态（`PA⊥平面ABCD` 的垂足就是顶点 `A`，不是底面中心）——
   *   钉住它，免得以后有人把"垂足在中心"当默认假设写进去。
   */
  it("面上点：宿主不是棱/线 ⇒ 如实拒绝（没有产品入口）；顶点垂足不在中心 ⇒ 本来就是常态", () => {
    // ① 把点绑在**实体本身**（不是某条棱）⇒ 没有对应宿主类型 ⇒ 拒绝。
    const boundToSolid = compilePlan(
      {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "plan",
        goal: "把一点绑在实体上（不是棱上）",
        factIds: [],
        actions: [
          {
            actionId: "solid.create_polyhedron",
            actionKey: "cube",
            factIds: [],
            inputs: {
              alias: "cube",
              vertexNames: ["A", "B", "C", "D", "A′", "B′", "C′", "D′"],
              vertices: [
                { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 },
                { x: 0, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }
              ],
              faces: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
            }
          },
          { actionId: "dynamic.create_bound_point", actionKey: "E", factIds: [], inputs: { alias: "E", host: { scope: "draft", alias: "cube" }, parameter: 0.5, label: "E" } }
        ]
      } as unknown as PlanEnvelope,
      { document: createEmptyDocument("geometry3d"), prompt: "在正方体ABCD-A′B′C′D′中，E为面上一点，画出这个正方体", conversationId: "face-point", documentGeneration: 0 }
    )
    const codes = boundToSolid.diagnostics.map((entry) => entry.code)
    expect(codes, `诊断=[${JSON.stringify(boundToSolid.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`))}]`).toContain("unsupported_host")
    const labels = (boundToSolid.draftDocument?.primitives ?? []).flatMap((primitive) => (primitive.type === "point3" && (primitive as { label?: unknown }).label !== undefined ? [(primitive as { label?: unknown }).label] : []))
    expect(labels, "被拒的那一笔**一条图元都不产出**").not.toContain("E")

    // ② 顶点垂足不在中心：`PA⊥平面ABCD` ⇒ `P` 就在 `A` 正上方（`x`、`y` 与 `A` 相同）。
    const pyramidPrompt = "在四棱锥P-ABCD中，PA⊥平面ABCD，AB⊥AD，画出这个四棱锥"
    const shaped = specForPrompt(pyramidPrompt, givensOf(pyramidPrompt))
    expect(shaped.status).toBe("ok")
    if (shaped.status !== "ok") return
    const searched = searchWitness({ obligations: parseObligationWithLegacy(pyramidPrompt).ir, shape: shaped.recognised.family, spec: shaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
    expect(searched.status, JSON.stringify(searched)).toBe("verified_instance")
    if (searched.status !== "verified_instance") return
    const at = new Map(searched.candidate.names.map((name, index) => [name, searched.candidate.vertices[index]!]))
    const apex = at.get("P")
    const foot = at.get("A")
    expect(apex, "候选里要有顶点 P").toBeDefined()
    expect(foot, "候选里要有垂足 A").toBeDefined()
    expect(Math.hypot(apex!.x - foot!.x, apex!.y - foot!.y), "垂足就该在 A 正上方（不是底面中心）").toBeLessThan(1e-9)
    expect(Math.abs(apex!.z - foot!.z), "顶点确实离开了底面").toBeGreaterThan(1e-9)
  })
})

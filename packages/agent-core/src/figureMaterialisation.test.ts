import { describe, expect, it } from "vitest"

import { buildFigureIntent, type FigureIntent } from "./figureIntent"
import { materialisedHostAction, planFigureMaterialisation, type CandidateRing } from "./figureMaterialisation"
import { parseObligationWithLegacy } from "./obligationIR"

/**
 * **Task 7（2026-10-12）：缺宿主时的安全物化 —— 先判能不能造，再谈怎么造。**
 *
 * ## 要解决的那件事
 *
 * 现场那条题面里点了 `B`、`C`、`D`，而模型交的计划**根本没有声明那个平面四边形**
 *（图上只有 `A`、`E`、`F`、`P`）。于是 `withWitnessCoordinates` **没有宿主可以替换** ——
 * 内核就算把坐标造出来了也落不了盘。这一层要回答的就是"**能不能替它补一个宿主**"。
 *
 * ## 为什么先有一个"不造"的层
 *
 * "补宿主"是**无中生有**：系统替模型造一笔它没写过的动作。所以判据必须在**动手之前**跑完 ——
 * 计划原话："**先校验形状/名字的唯一性，再生成宿主**……禁止为凑宿主填随机坐标后在核验器前跳过检查"。
 * 这一层因此是**纯函数**：给同样的输入说同样的话，**不碰文档、不产坐标**（坐标归内核构造器）。
 *
 * 三条判据对计划卡片的三个要求：① 题面明确平面四边形、点名唯一、条件都能认 ⇒ **造**；
 * ② **两个竞争四边形** ⇒ 拒；③ **点名和动作冲突** ⇒ 拒。
 */
const PROMPT = "四边形 ABCD，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3"

function intentOf(prompt = PROMPT): FigureIntent {
  return buildFigureIntent({ prompt, ir: parseObligationWithLegacy(prompt).ir, family: "solid" })
}

/** 题面里那个环（形状从句读出来的东西；这一层**不自己猜顺序**）。 */
const ABCD: CandidateRing = { shape: "四边形", names: ["A", "B", "C", "D"], closed: false, sourceClauseIds: [] }

const NO_HOSTS: readonly { actionId: string; vertexNames?: readonly string[] }[] = []

describe("Task 7 — 缺宿主时的安全物化", () => {
  it("materialises a planar host when the题面 names one ring, the names are unique, and no host exists", () => {
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [ABCD], existingHosts: NO_HOSTS })

    expect(decision.status).toBe("materialise")
    if (decision.status !== "materialise") throw new Error("expected a materialisation")
    // **开放的面**用 `solid.create_face`（闭合实体才用 create_polyhedron）—— 这一条不许猜。
    expect(decision.action.actionId).toBe("solid.create_face")
    // 环上的点名按原话顺序原样带过去（核验器的点名表就是照它建的）。
    expect(decision.action.vertexNames).toEqual(["A", "B", "C", "D"])
    // **不产坐标**：坐标由构造器决定，这一层连一个数字都不许写。
    expect(JSON.stringify(decision.action)).not.toMatch(/\d/)
  })

  it("refuses when two competing rings claim the same题面", () => {
    const other: CandidateRing = { shape: "四边形", names: ["A", "B", "D", "C"], closed: false, sourceClauseIds: [] }
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [ABCD, other], existingHosts: NO_HOSTS })

    expect(decision.status).toBe("refused")
    if (decision.status !== "refused") throw new Error("expected a refusal")
    expect(decision.code).toBe("competing_rings")
    // 说清"为什么"，而不只是"不行"。
    expect(decision.detail.length).toBeGreaterThan(0)
  })

  it("refuses when the plan already names a point that the ring would redeclare", () => {
    const conflicting = [{ actionId: "solid.create_face", vertexNames: ["B", "E", "F"] }]
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [ABCD], existingHosts: conflicting })

    expect(decision.status).toBe("refused")
    if (decision.status !== "refused") throw new Error("expected a refusal")
    // 已经有一笔动作在用 `B` 这个名字 ⇒ 再造一个 `B` 会让点名表指向两个不同的点。
    expect(decision.code).toBe("name_conflict")
    expect(decision.detail).toContain("B")
  })

  it("refuses when a host already exists, because there is nothing to synthesise", () => {
    // **现场的真实形状**：模型那版计划里只有 `A`、`E`、`F`、`P`，没有 `B`/`C`/`D`。
    // 一个**与环上的点名没有交集**的既有宿主 ⇒ 这份计划有自己的图形，不该再补一个四边形。
    const existing = [{ actionId: "solid.create_face", vertexNames: ["E", "F", "P"] }]
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [ABCD], existingHosts: existing })

    expect(decision.status).toBe("refused")
    if (decision.status !== "refused") throw new Error("expected a refusal")
    expect(decision.code).toBe("existing_host")
  })

  it("refuses when no ring was read from the题面, instead of inventing one", () => {
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [], existingHosts: NO_HOSTS })

    expect(decision.status).toBe("refused")
    if (decision.status !== "refused") throw new Error("expected a refusal")
    expect(decision.code).toBe("no_named_ring")
  })

  it("refuses when a题设 is still unread, instead of building structure on a partial reading", () => {
    // 第九条读不懂 ⇒ "已有条件能认"这一条**不成立**，于是不许替它造结构。
    const partial = intentOf(`${PROMPT}，sin∠PAB=0.5`)
    const decision = planFigureMaterialisation({ intent: partial, candidates: [ABCD], existingHosts: NO_HOSTS })

    expect(decision.status).toBe("refused")
    if (decision.status !== "refused") throw new Error("expected a refusal")
    expect(decision.code).toBe("unverified_conditions")
  })

  it("refuses a ring whose names the题面 never mentioned", () => {
    const invented: CandidateRing = { shape: "四边形", names: ["A", "B", "C", "Z"], closed: false, sourceClauseIds: [] }
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [invented], existingHosts: NO_HOSTS })

    expect(decision.status).toBe("refused")
    if (decision.status !== "refused") throw new Error("expected a refusal")
    // `Z` 是这一层自己编出来的点名 —— 编出来的点会让核验器去核一条题面没有的条件。
    expect(decision.code).toBe("not_a_planar_ring")
    expect(decision.detail).toContain("Z")
  })

  it("refuses a ring that is not a planar face (fewer than three distinct names)", () => {
    const degenerate: CandidateRing = { shape: "线段", names: ["A", "B"], closed: false, sourceClauseIds: [] }
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [degenerate], existingHosts: NO_HOSTS })

    expect(decision.status).toBe("refused")
    if (decision.status !== "refused") throw new Error("expected a refusal")
    expect(decision.code).toBe("not_a_planar_ring")
  })
})

/**
 * **窄适配**：把"能造"这个判断变成一笔真正的动作。
 *
 * 判据只认一件事：**判断题面那个环与内核构造出来的候选是不是同一个环** ——
 * 点名**逐个同序**相同、顶点数对得上。内核的候选已经按题面条件核验过，
 * 所以坐标**原样取它的**；而顺序若对不上（`A,B,D,C` 对 `A,B,C,D`），
 * 画出来的是**另一只四边形**（很可能是自交的那一只），必须拒绝而不是"反正集合一样"。
 */
describe("Task 7 — 窄适配：把判断变成一笔动作", () => {
  const CANDIDATE = { names: ["A", "B", "C", "D"], vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: 1, z: 0 }, { x: 7, y: 4, z: 0 }] }

  function decisionFor(ring: CandidateRing = ABCD) {
    const decision = planFigureMaterialisation({ intent: intentOf(), candidates: [ring], existingHosts: NO_HOSTS })
    if (decision.status !== "materialise") throw new Error("expected a materialisation to adapt")
    return decision
  }

  it("turns the decision plus the kernel's candidate into a real solid.create_face action", () => {
    const adapted = materialisedHostAction(decisionFor(), CANDIDATE, "quad")

    expect(adapted.ok).toBe(true)
    if (!adapted.ok) throw new Error("expected an action")
    expect(adapted.action.actionId).toBe("solid.create_face")
    expect(adapted.action.inputs.alias).toBe("quad")
    expect(adapted.action.inputs.vertexNames).toEqual(["A", "B", "C", "D"])
    // 坐标**取内核构造的那一份**，这一层一个数字都不自己算。
    expect(adapted.action.inputs.vertices).toEqual(CANDIDATE.vertices)
  })

  it("refuses when the constructed ring names are not the题面 ring, name by name", () => {
    // 集合一样、**顺序不同** ⇒ 画出来的是另一只（很可能自交）四边形。
    const reordered = { names: ["A", "B", "D", "C"], vertices: CANDIDATE.vertices }
    const adapted = materialisedHostAction(decisionFor(), reordered, "quad")

    expect(adapted.ok).toBe(false)
    if (adapted.ok) throw new Error("expected a refusal")
    expect(adapted.code).toBe("ring_name_order_mismatch")
  })

  it("refuses when the constructed ring is a different set of points", () => {
    const other = { names: ["A", "B", "C", "Z"], vertices: CANDIDATE.vertices }
    const adapted = materialisedHostAction(decisionFor(), other, "quad")

    expect(adapted.ok).toBe(false)
    if (adapted.ok) throw new Error("expected a refusal")
    expect(adapted.code).toBe("ring_name_order_mismatch")
  })

  it("refuses when the candidate carries a different number of vertices than names", () => {
    const short = { names: ["A", "B", "C", "D"], vertices: CANDIDATE.vertices.slice(0, 3) }
    const adapted = materialisedHostAction(decisionFor(), short, "quad")

    expect(adapted.ok).toBe(false)
    if (adapted.ok) throw new Error("expected a refusal")
    expect(adapted.code).toBe("candidate_shape_mismatch")
  })

  it("refuses to adapt a decision that was itself a refusal", () => {
    const refused = planFigureMaterialisation({ intent: intentOf(), candidates: [], existingHosts: NO_HOSTS })
    const adapted = materialisedHostAction(refused, CANDIDATE, "quad")

    expect(adapted.ok).toBe(false)
    if (adapted.ok) throw new Error("expected a refusal")
    expect(adapted.code).toBe("not_materialised")
  })
})

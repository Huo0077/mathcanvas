import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **Task 12（2026-10-12）：折角是系统**求**出来的，不是模型填进来的。**
 *
 * 现场那一句（连发 7 次不通）：
 * > 平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。点E在AD上，且AE:AD=2:5；
 * > 点F在AB上，且AF:AB=1:2。将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。
 *
 * 这句话里**没有折角**。下面这份计划故意把折角填成 **30°**（错的）：
 * 于是"能 `passed`"就只可能是因为系统**按 `PC=4√3` 把角反求出来**并换掉了它。
 *
 * 坐标与 `solidFoldAction.test.ts` 逐字相同（同一组独立回代的真坐标）：
 * `A=(0,0,0)`、`B=(8,0,0)`、`D=(7.5,5√3/2,0)`、`C=(9,√3,0)`、`E=(3,√3,0)`、`F=(4,0,0)`。
 */

const PROMPT = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")

const A = { x: 0, y: 0, z: 0 }
const B = { x: 8, y: 0, z: 0 }
const C = { x: 9, y: Math.sqrt(3), z: 0 }
const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }
const E = { x: 3, y: Math.sqrt(3), z: 0 }
const F = { x: 4, y: 0, z: 0 }

/** **错的**折角：题面没给角，模型猜了一个。 */
const GUESSED_ANGLE = 30

function foldPlan(angle: number): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "四边形 ABCD，三角形 AEF 沿 EF 翻折成 PEF",
    factIds: [],
    actions: [
      { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D], label: "四边形 ABCD" } },
      { actionId: "solid.fold", actionKey: "flap", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], vertices: [A, E, F], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle } }
    ]
  } as unknown as PlanEnvelope
}

function compile(angle: number, prompt: string = PROMPT) {
  return compilePlan(foldPlan(angle), { document: createEmptyDocument("geometry3d"), prompt, conversationId: "fold-angle", documentGeneration: 0 })
}

describe("Task 12 — 折角反求（接进编译路径）", () => {
  it("计划填了一个**错的**折角 30°，题面只说 PC=4√3 ⇒ 系统求出 90° 并通过核验", () => {
    const result = compile(GUESSED_ANGLE)

    // **先查"反求到底有没有发生"**：没有这一句，后面的失败分不清"没救"与"救了但没通过"。
    const probeText = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")
    expect(probeText, `反求没有发生；assumptions：${probeText}`).toMatch(/反求/)

    const why = result.diagramVerification === undefined
      ? "没有核验报告"
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")

    /**
     * **自己算**：从**最终坐标**量 `|PC|`（不读面板结论、也不读求解器的中间量）。
     *
     * 折后的 `P` 按点名从文档里找；找不到就如实抛错（把现有标签打出来），
     * 而不是静默跳过 —— 那正是 `diagramFoldPoints` 那一族用例管的事。
     */
    const document = result.draftDocument
    if (document === null) throw new Error("expected a draft document")
    const labels = document.primitives.flatMap((primitive) => (primitive.type === "point3" ? [(primitive as { label?: unknown }).label] : []))
    const find = (label: string) => {
      const found = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
      if (found?.type !== "point3") throw new Error(`文档里没有点名 ${label}；现有标签：${JSON.stringify(labels)}`)
      return found.position
    }
    const p = find("P")
    const c = find("C")
    expect(Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z), `落盘的 P=${JSON.stringify(p)}`).toBeCloseTo(4 * Math.sqrt(3), 6)

    // 折角**是求出来的**这件事必须说给用户听（题面没给过它）。
    const text = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")
    expect(text, `assumptions：${text}`).toMatch(/反求/)
    expect(text, `assumptions：${text}`).toMatch(/90/)

    // 刚体性：`|PE| = |AE|`；而且 `P` 真的离开了原平面（折起来了）。
    const e = find("E")
    expect(Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z)).toBeCloseTo(Math.hypot(A.x - E.x, A.y - E.y, A.z - E.z), 9)
    expect(Math.abs(p.z)).toBeGreaterThan(1e-9)
  })

  it("**只救不抢**：填对了（90°）时不起反求、也不多出一句假设", () => {
    const result = compile(90)
    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    const text = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")
    expect(text).not.toMatch(/反求/)
  })

  it("题面没给目标距离时，**不许**凭空反求（错的角照样是错的）", () => {
    // 同一份计划、同一个错角，但把题面里的 `PC=4√3` 去掉 ⇒ 没有任何"反求"的依据。
    const result = compile(GUESSED_ANGLE, PROMPT.replace("，使得PC=4√3", ""))
    const text = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")
    expect(text, `assumptions：${text}`).not.toMatch(/反求/)
    /**
     * **这一轮 `passed` 是对的，不是漏网**（我一开始把这里断言成"不许通过"，实测把我纠正了）：
     * 把 `PC=4√3` 从句子里去掉，**那条条件就不在题面里了**（核验报告里根本没有它），
     * 于是错的折角**没有任何可违反的条件** —— 剩下的七条确实全成立。
     * 真正该挡的负例是"**条件还在、而反求没有依据**"，见下一条。
     */
    expect(result.diagramVerification?.status).toBe("passed")
  })

  /**
   * **负例：错的折角 + 图里缺了 `C`**（Task 13 的 RED 原话要这种"图形很像但缺 C"的例子）。
   *
   * `PC=4√3` 还在题面里，但折后要量的那个 `C` **不在图上** ⇒ 反求**没有目标点可用**（如实不救），
   * 而那条条件也就核不过。这条同时挡住两件事：**不许把缺的 `C` 蒙出来**、**不许绕开那条条件**。
   */
  it("负例：错的折角 + 图里缺 C ⇒ 反求没有依据、`PC=4√3` 核不过，不许通过", () => {
    const plan = foldPlan(GUESSED_ANGLE) as Extract<PlanEnvelope, { kind: "plan" }>
    const face = plan.actions[0] as unknown as { inputs: { vertexNames: string[]; vertices: unknown[] } }
    // 拿掉 C（顶点名单与坐标同时拿掉，保持两个平行数组等长）。
    face.inputs.vertexNames = ["A", "B", "D"]
    face.inputs.vertices = [A, B, D]

    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "fold-angle", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`) ?? []
    const text = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")

    expect(text, `assumptions：${text}`).not.toMatch(/反求/)
    expect(result.diagramVerification?.status, checks.join("；")).not.toBe("passed")
    // `C` 不许被悄悄补出来（它不是中点、也不是定比分点）。
    const labels = (result.draftDocument?.primitives ?? []).flatMap((primitive) => (primitive.type === "point3" ? [(primitive as { label?: unknown }).label] : []))
    expect(labels, `文档里的点名：${JSON.stringify(labels)}`).not.toContain("C")
  })
})

import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **Task 13 第三项（2026-10-12）：`E`/`F` 由系统按定比分点**构造**出来，不是夹具给的坐标。**
 *
 * 计划 Task 13 那句"棱上/面上点"的构造，在**开放面片**（`solid.create_face`）这一支上一直没走过：
 * Task 10 的定比分点补建（`constructiblePoint` + `materialisedPointActions`）当初是**为多面体写的**
 *（`plan.actions.filter(action => action.actionId === "solid.create_polyhedron")`，
 * 而且**要求恰好一笔**）—— 而用户那道题的宿主是一只平面四边形**面片**。
 *
 * 这一条就是那件事的最小判据：计划里**只有那只四边形面片**，没有 `E`、没有 `F`；
 * 题面说了两个定比分点。系统只能自己把 `E`、`F` 建在 `AD`、`AB` 上。
 *
 * 判据一律**自己从落盘坐标算**，不读面板结论。
 */

const PROMPT = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。"
].join("")

const A = { x: 0, y: 0, z: 0 }
const B = { x: 8, y: 0, z: 0 }
const C = { x: 9, y: Math.sqrt(3), z: 0 }
const D = { x: 7.5, y: (5 * Math.sqrt(3)) / 2, z: 0 }

/** **只有四边形**：计划里没有 `E`、没有 `F`（这正是这一条的要点）。 */
function faceOnlyPlan(): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "平面四边形 ABCD，E/F 是 AD/AB 上的定比分点",
    factIds: [],
    actions: [
      { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D], label: "四边形 ABCD" } }
    ]
  } as unknown as PlanEnvelope
}

describe("Task 13 — 面片上的定比分点由系统构造", () => {
  it("计划里只有四边形面片、没有 E/F，题面给两个定比分点 ⇒ 系统把 E、F 建在 AD、AB 上", () => {
    const result = compilePlan(faceOnlyPlan(), { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "face-ratios", documentGeneration: 0 })

    const why = result.diagramVerification === undefined
      ? "没有核验报告"
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")

    const document = result.draftDocument
    if (document === null) throw new Error("expected a draft document")
    const labels = document.primitives.flatMap((primitive) => (primitive.type === "point3" ? [(primitive as { label?: unknown }).label] : []))
    const find = (label: string) => {
      const found = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
      if (found?.type !== "point3") throw new Error(`文档里没有点名 ${label}；现有标签：${JSON.stringify(labels)}`)
      return found.position
    }
    const a = find("A")
    const b = find("B")
    const d = find("D")
    const e = find("E")
    const f = find("F")
    const distance = (left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

    // **自己算**那两条定比分点（不读面板结论）。
    expect(distance(a, e) / distance(a, d), "AE:AD").toBeCloseTo(2 / 5, 9)
    expect(distance(a, f) / distance(a, b), "AF:AB").toBeCloseTo(1 / 2, 9)
    // 在线段上（不是延长线）：到两端的距离之和等于整条边。
    expect(distance(a, e) + distance(e, d), "E 在 AD 上").toBeCloseTo(distance(a, d), 9)
    expect(distance(a, f) + distance(f, b), "F 在 AB 上").toBeCloseTo(distance(a, b), 9)

    // 补建这件事**必须看得见**（题面没直接给坐标）。
    const text = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")
    expect(text, `assumptions：${text}`).toMatch(/E/)
    expect(text, `assumptions：${text}`).toMatch(/F/)
  })

  /**
   * **负例：图形很像，但少了一个点名的顶点**（Task 13 的 RED 原话："必须有'图形很像但缺 B/C/D…'的负例"）。
   *
   * 这里把 `C` 从面片的顶点里拿掉：四条边还在、`A`/`B`/`D` 都在、图看着仍是"一只四边形"，
   * 但 `CD=3` 与 `∠ADC=90°` 这两条**没有任何坐标能核** ⇒ **不许通过**。
   *
   * 而且这一条同时挡住"**用补建把缺的点蒙出来**"：`C` 不是中点、也不是定比分点，
   * 补建那一支**没有规则**能造它 —— 它必须如实拒绝，而不是造一个看起来合理的 `C`。
   */
  it("负例：面片少了顶点 C，`CD=3` 与 `∠ADC=90°` 无坐标可核 ⇒ 不许通过", () => {
    const plan = faceOnlyPlan() as Extract<PlanEnvelope, { kind: "plan" }>
    const action = plan.actions[0] as unknown as { inputs: { vertexNames: string[]; vertices: unknown[] } }
    // 拿掉 C（顶点名单与坐标**同时**拿掉，保持两个平行数组等长）。
    action.inputs.vertexNames = ["A", "B", "D"]
    action.inputs.vertices = [A, B, D]

    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "face-ratios", documentGeneration: 0 })
    const checks = result.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`) ?? []
    expect(result.diagramVerification?.status, checks.join("；")).not.toBe("passed")
    // 缺的那个点**不许**被悄悄补出来（它不是中点、也不是定比分点，补建没有规则能造它）。
    const labels = (result.draftDocument?.primitives ?? []).flatMap((primitive) => (primitive.type === "point3" ? [(primitive as { label?: unknown }).label] : []))
    expect(labels, `文档里的点名：${JSON.stringify(labels)}`).not.toContain("C")
  })

  /**
   * **串成一条链（前两环）**：`E`/`F` 由**同一份计划里前面几笔**按定比分点建出来，
   * 折叠那一笔**一个坐标都不带**、按 `vertexNames` 从文档取点。
   *
   * 计划里**只有**：四边形面片的四个坐标 + 两条"点名建点"（`hostEdge` + `parameter`）+
   * 折叠的**点名与折角**。`E`/`F` 的坐标**没有任何一处写出来** —— 它们由系统按
   * `AE:AD=2:5` / `AF:AB=1:2` 算出来，折叠用的也正是这些算出来的点。
   *
   * 折角这里给的是**对的 90°**：第三环"折角反求"已由 Task 12 的用例单独钉住；
   * 三环一次串完还要求反求那一支也能解析"点名建点"的坐标，见下面那条**已知边界**。
   */
  it("前两环串起来：E/F 由前面几笔按定比分点建出来，折叠按点名取点（不带坐标）", () => {
    /**
     * **参数按哪一头量** —— 这里曾经是个**实测到的缺陷**，同一轮里修掉了。
     *
     * `dynamic.create_bound_point` 的 `parameter` 是沿**宿主棱自己的 `pointIds` 顺序**量的，
     * 而 `hostEdge: {from, to}` 原先**不改变**那个顺序。这只面片的 `A—D` 棱存的是 `D→A`，
     * 所以"从 `A` 量 2/5"当时必须写成 `3/5` —— 写 `2/5` 会得到 `AE:AD = 3/5`、核验 `failed`。
     *
     * **修法**：朝向归一收在**写绑定的那一处**（`compileCreateBoundPoint` 按 `hostEdge` 的
     * `{from,to}` 判、相反时取 `1 − parameter`），而 `materialisedPointActions` **不再自己翻**
     * （两边各翻一次会翻回去 —— 我先在补建里翻，加上动作那一翻，`E` 落到 `3/5`、
     * `AE:AD` 停在 `unverified`，这是修的过程中实测到的症状）。
     * 所以现在这里写的就是**题面那个方向**的 `2/5`。
     */
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "四边形 ABCD + 边上定比分点 E/F + 沿 EF 翻折（坐标全部由系统算）",
      factIds: [],
      actions: [
        { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D], label: "四边形 ABCD" } },
        { actionId: "dynamic.create_bound_point", actionKey: "E", factIds: [], inputs: { alias: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5, label: "E" } },
        { actionId: "dynamic.create_bound_point", actionKey: "F", factIds: [], inputs: { alias: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 1 / 2, label: "F" } },
        { actionId: "solid.fold", actionKey: "flap", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 90 } }
      ]
    } as unknown as PlanEnvelope

    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "face-ratios", documentGeneration: 0 })
    const why = result.diagramVerification === undefined
      ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`).join("；")}`
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")

    const document = result.draftDocument
    if (document === null) throw new Error("expected a draft document")
    const labels = document.primitives.flatMap((primitive) => (primitive.type === "point3" ? [(primitive as { label?: unknown }).label] : []))
    const find = (label: string) => {
      const found = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
      if (found?.type !== "point3") throw new Error(`文档里没有点名 ${label}；现有标签：${JSON.stringify(labels)}`)
      return found.position
    }
    const a = find("A")
    const b = find("B")
    const d = find("D")
    const e = find("E")
    const f = find("F")
    const p = find("P")
    const distance = (left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

    // 两个分点由系统算出来（**计划里没有任何一处写出它们的坐标**）。
    expect(distance(a, e) / distance(a, d), "AE:AD").toBeCloseTo(2 / 5, 9)
    expect(distance(a, f) / distance(a, b), "AF:AB").toBeCloseTo(1 / 2, 9)
    // 折叠**真的用了这两个点**：折痕两端一点没动，折后 `|PE| = |AE|`、`|PF| = |AF|`。
    expect(distance(p, e), "|PE| = |AE|").toBeCloseTo(distance(a, e), 9)
    expect(distance(p, f), "|PF| = |AF|").toBeCloseTo(distance(a, f), 9)
  })

  /**
   * **三环全串起来**（Task 13，2026-10-12）：计划里**一个 `E`/`F`/折角都没给** ——
   *
   * 1. `E`/`F` 由**前面几笔** `dynamic.create_bound_point` 按定比分点建出来（没有 `vertices` 数组）；
   * 2. 折叠那一笔**不带坐标**，按 `vertexNames` 从文档取点；
   * 3. 折角填的是**错的 30°**，题面只说 `PC=4√3` ⇒ 由 **Task 12 的折角反求**算出来。
   *
   * 第三环原先接不上：反求那一支只从计划的 `vertices`/`vertexNames` 取坐标，而"点名建点"没有那个数组。
   * 修法是**不再自己写一套**，而是把折叠那几笔**摘掉再编译一次**，从那份"折之前"的文档里按点名取 ——
   * 复用 `compileOnce`，所以"点在棱上的位置怎么算"仍然**只有一份判据**。
   */
  it("三环串起来：计划里没有 E/F 坐标、也没有折角，系统自己把它们都算出来", () => {
    const FOLD_PROMPT = [
      "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
      "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
      "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
    ].join("")

    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "四边形 ABCD + 边上定比分点 E/F + 沿 EF 翻折且 PC=4√3（E/F 与折角全部由系统算）",
      factIds: [],
      actions: [
        { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertexNames: ["A", "B", "C", "D"], vertices: [A, B, C, D], label: "四边形 ABCD" } },
        { actionId: "dynamic.create_bound_point", actionKey: "E", factIds: [], inputs: { alias: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 2 / 5, label: "E" } },
        { actionId: "dynamic.create_bound_point", actionKey: "F", factIds: [], inputs: { alias: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 1 / 2, label: "F" } },
        { actionId: "solid.fold", actionKey: "flap", factIds: [], inputs: { alias: "flap", vertexNames: ["A", "E", "F"], hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 30 } }
      ]
    } as unknown as PlanEnvelope

    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: FOLD_PROMPT, conversationId: "face-ratios", documentGeneration: 0 })
    const why = result.diagramVerification === undefined
      ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}@${entry.path}: ${entry.detail}`).join("；")}`
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")

    const document = result.draftDocument
    if (document === null) throw new Error("expected a draft document")
    const labels = document.primitives.flatMap((primitive) => (primitive.type === "point3" ? [(primitive as { label?: unknown }).label] : []))
    const find = (label: string) => {
      const found = document.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)
      if (found?.type !== "point3") throw new Error(`文档里没有点名 ${label}；现有标签：${JSON.stringify(labels)}`)
      return found.position
    }
    const a = find("A")
    const b = find("B")
    const c = find("C")
    const d = find("D")
    const e = find("E")
    const f = find("F")
    const p = find("P")
    const distance = (left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

    // 第一环：两个分点由系统按定比分点算出来（计划里没有它们的坐标）。
    expect(distance(a, e) / distance(a, d), "AE:AD").toBeCloseTo(2 / 5, 9)
    expect(distance(a, f) / distance(a, b), "AF:AB").toBeCloseTo(1 / 2, 9)
    // 第三环：折角由系统按 `PC=4√3` 反求出来（计划里填的是错的 30°）。
    expect(distance(p, c), "PC").toBeCloseTo(4 * Math.sqrt(3), 6)
    const text = result.assumptions.map((item) => (typeof item === "string" ? item : item.text)).join(" / ")
    expect(text, `assumptions：${text}`).toMatch(/反求/)
    // 第二环：折叠用的是那两个算出来的点（刚体性）。
    expect(distance(p, e), "|PE| = |AE|").toBeCloseTo(distance(a, e), 9)
    expect(distance(p, f), "|PF| = |AF|").toBeCloseTo(distance(a, f), 9)
  })
})

import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"

/**
 * **三角形的三个心：重心 / 垂心 / 旁心**（2026-10-20，把"心"这一族收口）。
 *
 * 内心与角平分线已经接了（前两批），这一批补齐另外三个 —— 它们此前**只会"如实未核验"**：
 *
 * | 心 | 判据（都从最终坐标自己算） |
 * | --- | --- |
 * | 重心 | `O = (A + B + C) / 3` |
 * | 垂心 | `O` 落在**三条高线**上（到三条高线的距离都为 0） |
 * | 旁心 | `O` 是**三个旁心之一**（到最近的那个旁心距离为 0） |
 *
 * **旁心为什么要"三个之一"**：一个三角形有**三个**旁心（对应三个顶点），而题面写
 * `O 是 △ABC 的旁心` 说的是"它是某一个旁心"，没说哪一个 —— 三个任何一个都对。
 * 判据因此取"到最近的旁心"的距离，**不挑一个猜**（挑一个就是把"任意一个"读成了"那个"）。
 *
 * **三个心必须分得开**（这是判据的意义所在）：用例里每个心都拿另外两个心的位置试过一遍。
 */
const centers = (prompt: string) =>
  parseDiagramObligations(prompt).givens
    .filter((item) => item.kind === "centroid" || item.kind === "orthocenter" || item.kind === "excenter")
    .map((item) => `${item.kind}:${item.targets.join("")}`)

describe("三个心的读取器", () => {
  it("`O为△ABC的重心` / `垂心` / `旁心` 各读成一条义务", () => {
    expect(centers("在△ABC中，O为△ABC的重心。")).toEqual(["centroid:OABC"])
    expect(centers("在△ABC中，O为△ABC的垂心。")).toEqual(["orthocenter:OABC"])
    expect(centers("在△ABC中，O为△ABC的旁心。")).toEqual(["excenter:OABC"])
  })

  it("`点O是△ABC的重心` 也读得出", () => {
    expect(centers("点O是△ABC的重心。")).toEqual(["centroid:OABC"])
  })
})

/**
 * `T1 = A(0,0)、B(6,0)、C(2,4)`：重心 `(8/3, 4/3)`、垂心 `(2, 2)`（自己算：
 * `AB` 水平 ⇒ 从 `C` 出发的高是 `x = 2`；`BC` 斜率 `−1` ⇒ 从 `A` 出发的高是 `y = x`）。
 */
const T1 = { a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, c: { x: 2, y: 4 } }

/** `T2 = A(0,0)、B(6,0)、C(0,8)`（6-8-10）：内心 `(2,2)`、旁心 `(12,12)`、`(−6,6)`、`(4,−4)`。 */
const T2 = { a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, c: { x: 0, y: 8 } }

const point = (name: string, position: { x: number; y: number }) =>
  ({ actionId: "planar.create_point", actionKey: name, factIds: [], inputs: { alias: name, points: [position], label: name } })

function run(triangle: typeof T1, o: { x: number; y: number }, prompt: string) {
  const plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "三角形的心",
    factIds: [],
    actions: [point("A", triangle.a), point("B", triangle.b), point("C", triangle.c), point("O", o)]
  } as unknown as PlanEnvelope
  return compilePlan(plan, { document: createEmptyDocument("conics"), prompt, conversationId: "triangle-centers", documentGeneration: 0 })
}

const describeChecks = (result: ReturnType<typeof run>) =>
  (result.diagramVerification?.checks ?? []).map((check) => `${check.kind}:${check.status}:${check.reason}`).join("；")

const statusOf = (result: ReturnType<typeof run>) => result.diagramVerification?.status

describe("重心：O = (A + B + C) / 3", () => {
  const PROMPT = "在△ABC中，O为△ABC的重心。"

  it("O(8/3, 4/3) ⇒ passed", () => {
    const result = run(T1, { x: 8 / 3, y: 4 / 3 }, PROMPT)
    expect(statusOf(result), describeChecks(result)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => check.kind)).toEqual(["centroid"])
  })

  it("拿垂心 (2,2) 冒充重心 ⇒ failed", () => {
    expect(statusOf(run(T1, { x: 2, y: 2 }, PROMPT))).toBe("failed")
  })
})

describe("垂心：落在三条高线上", () => {
  const PROMPT = "在△ABC中，O为△ABC的垂心。"

  it("O(2, 2) ⇒ passed", () => {
    expect(statusOf(run(T1, { x: 2, y: 2 }, PROMPT)), "T1 的垂心就是 (2,2)").toBe("passed")
  })

  it("拿重心 (8/3, 4/3) 冒充垂心 ⇒ failed", () => {
    expect(statusOf(run(T1, { x: 8 / 3, y: 4 / 3 }, PROMPT))).toBe("failed")
  })
})

describe("旁心：三个旁心之一", () => {
  const PROMPT = "在△ABC中，O为△ABC的旁心。"

  it.each([[12, 12], [-6, 6], [4, -4]])("O(%s, %s) 是某一个旁心 ⇒ passed", (x, y) => {
    const result = run(T2, { x, y }, PROMPT)
    expect(statusOf(result), describeChecks(result)).toBe("passed")
  })

  it("拿内心 (2,2) 冒充旁心 ⇒ failed（它在三角形里面，不是旁心）", () => {
    expect(statusOf(run(T2, { x: 2, y: 2 }, PROMPT))).toBe("failed")
  })

  it("拿三条高的交点 / 一般点冒充 ⇒ failed", () => {
    expect(statusOf(run(T2, { x: 3, y: 3 }, PROMPT))).toBe("failed")
  })
})

import { parsePlanEnvelope } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createLocalPlanner, LOCAL_INTENTS } from "./localPlanner"

/**
 * 本地确定性规划器的性质。
 *
 * 它最重要的性质不是"认识几句指令"，而是**认不出时问路，而不是编一个答案** ——
 * 那正是"演示回复"与"真实运行"的分界线。
 */
async function plan(prompt: string) {
  const planner = createLocalPlanner()
  return (await planner.plan({ userMessage: prompt } as never)).plan
}

describe("local planner translates the commands it knows", () => {
  it("builds a cube with the size the user asked for", async () => {
    const envelope = await plan("建一个棱长 3 的立方体")

    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") throw new Error("expected a plan")
    expect(envelope.actions).toHaveLength(1)
    expect(envelope.actions[0].actionId).toBe("solid.create_template")
    // 尺寸要来自指令，而不是写死的默认值。
    expect(envelope.actions[0].inputs).toMatchObject({ template: "cube", size: { x: 3, y: 3, z: 3 } })
  })

  it("falls back to a sane size when the prompt has no number", async () => {
    const envelope = await plan("建一个立方体")

    if (envelope.kind !== "plan") throw new Error("expected a plan")
    expect(envelope.actions[0].inputs).toMatchObject({ size: { x: 2, y: 2, z: 2 } })
  })

  it("recognises a planar point request", async () => {
    const envelope = await plan("画一个点")

    if (envelope.kind !== "plan") throw new Error("expected a plan")
    expect(envelope.actions[0].actionId).toBe("planar.create_point")
  })

  it("answers a read-only question without producing any action", async () => {
    // 只读回答**不可能**改文档 —— 这条性质比"回答得对不对"更重要。
    const envelope = await plan("现在有什么")

    expect(envelope.kind).toBe("answer")
    if (envelope.kind === "plan") throw new Error("a read-only question must not produce actions")
  })

  it("produces envelopes the real schema accepts", async () => {
    // 规划器的输出必须能过 `parsePlanEnvelope`，否则它在真实运行里一定会被拒。
    for (const prompt of ["建一个棱长 3 的立方体", "画一个点", "现在有什么"]) {
      const envelope = await plan(prompt)
      expect(parsePlanEnvelope(envelope).ok, prompt).toBe(true)
    }
  })

  it("every declared intent produces a schema-valid envelope", async () => {
    for (const intent of LOCAL_INTENTS) {
      const envelope = intent.build({ prompt: "3", size: 3 })
      expect(parsePlanEnvelope(envelope).ok, intent.all.join("+")).toBe(true)
    }
  })
})

describe("local planner never invents an answer", () => {
  it("asks a question when it does not recognise the prompt", async () => {
    // 关键词：**clarification**，不是 answer。前者把运行推进到"等待补充信息"，
    // 后者会让用户以为系统听懂了。
    const envelope = await plan("帮我算一下这个三角形的重心和外心，并比较它们的距离")

    expect(envelope.kind).toBe("clarification")
  })

  it("says plainly that there is no model service", async () => {
    const envelope = await plan("随便说点什么")

    if (envelope.kind !== "clarification") throw new Error("expected a clarification")
    // 如实告知能力边界，而不是含糊其辞。
    expect(envelope.questions.join(" ")).toContain("没有接入模型服务")
  })

  it("does not claim the request was understood", async () => {
    const envelope = await plan("把刚才那个东西放大一点")

    if (envelope.kind !== "clarification") throw new Error("expected a clarification")
    expect(envelope.goal).toContain("无法识别")
  })

  it("keeps the refusal deterministic so tests are not flaky", async () => {
    const first = await plan("未知指令")
    const second = await plan("未知指令")

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

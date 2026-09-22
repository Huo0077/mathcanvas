import { parsePlanEnvelope, SKILL_MANIFESTS } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createLocalPlanner, LOCAL_INTENTS, localIntentSkillIds, matchLocalIntent } from "./localPlanner"

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

  /**
   * **斜棱柱**（Solid/Prism 切片 Task 5）。
   *
   * 指令产出的必须是 `solid.create_prism` —— **不是**一堆 `solid.create_template`，
   * 也不是把六个面拼起来（规格 §7 明令禁止"把散面拼成 Prism"）。底面多边形与拉伸向量
   * 都由这一笔动作携带，侧面交给内核按 `[Bi, B(i+1), T(i+1), Ti]` 生成。
   */
  it("builds an oblique prism from a base polygon and an extrusion vector", async () => {
    const envelope = await plan("画一个斜棱柱")

    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") throw new Error("expected a plan")
    expect(envelope.actions).toHaveLength(1)
    expect(envelope.actions[0].actionId).toBe("solid.create_prism")
    const inputs = envelope.actions[0].inputs as { basePolygon?: unknown; vector?: unknown }
    expect(Array.isArray(inputs.basePolygon)).toBe(true)
    expect((inputs.basePolygon as unknown[]).length).toBeGreaterThanOrEqual(3)
    // 向量必须非零，而且**带水平分量**：否则那是一只直棱柱，"斜"字就没了意义。
    expect(inputs.vector).toMatchObject({ x: 1, z: 3 })
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

/**
 * **指令 → 技能清单**。
 *
 * 运行器必须在**建运行时之前**知道这条指令要用哪些技能（`requestedSkillIds` 决定上下文里
 * 的可用动作，而上下文是发请求前组装的）。所以有 `localIntentSkillIds` 这一层。
 *
 * 最要紧的一条性质：它与 `plan()` 的匹配**必须一致** —— 两边各写一遍"包含哪些词"的判断
 * 一旦分叉，就会出现"上下文里没有这个技能、但规划器产出了它的动作"，
 * 表现为莫名其妙的编译失败。所以两者共用 `matchLocalIntent`，这里把这条钉住。
 */
describe("the local planner declares which skills an instruction needs", () => {
  it("asks for the spatial skill when the instruction is about a solid", () => {
    expect(localIntentSkillIds("建一个棱长 3 的立方体")).toEqual(["spatial-modeling"])
    expect(localIntentSkillIds("画一个斜棱柱")).toEqual(["spatial-modeling"])
  })

  it("asks for the planar skill when the instruction is about a planar point", () => {
    expect(localIntentSkillIds("画一个点")).toEqual(["planar-basics"])
  })

  it("asks for nothing when the instruction only reads the scene", () => {
    // 只读提问不产生动作，给一个用不上的动作菜单只会误导模型。
    expect(localIntentSkillIds("现在有什么")).toEqual([])
  })

  it("asks for nothing when it does not recognise the instruction", () => {
    expect(localIntentSkillIds("帮我算一下这个三角形的重心")).toEqual([])
  })

  it("declares the skills of the very intent the planner will actually use", async () => {
    // 一致性：`plan()` 与 `localIntentSkillIds()` 必须落在**同一条**指令上。
    for (const prompt of ["建一个棱长 3 的立方体", "画一个点", "现在有什么"]) {
      const intent = matchLocalIntent(prompt)
      expect(intent, prompt).not.toBeNull()
      expect(localIntentSkillIds(prompt)).toEqual(intent!.skillIds)

      /**
       * 更有用的一条：**产出的动作必须真的在声明的技能里**。
       *
       * 否则上下文会告诉模型"你可以用这几个动作"，而计划里却出现一个没声明的动作 ——
       * 那正是"清单与实际不符"，也是两边判断分叉后最先出现的症状。
       */
      const envelope = await plan(prompt)
      if (envelope.kind !== "plan") continue
      const declared = new Set(SKILL_MANIFESTS.filter((manifest) => intent!.skillIds.includes(manifest.id)).flatMap((manifest) => manifest.actionIds))
      for (const action of envelope.actions) expect(declared.has(action.actionId), `${prompt} → ${action.actionId}`).toBe(true)
    }
  })

  it("keeps the skill ids it names inside the shipped catalogue", () => {
    const catalogue = new Set(SKILL_MANIFESTS.map((manifest) => manifest.id))
    for (const intent of LOCAL_INTENTS) {
      for (const skillId of intent.skillIds) expect(catalogue.has(skillId), `${intent.all.join("+")} → ${skillId}`).toBe(true)
    }
  })
})

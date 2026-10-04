import { DEFAULT_SOLID_SIZE, compilePlan, parsePlanEnvelope, SKILL_MANIFESTS } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createLocalPlanner, LOCAL_INTENTS, localIntentSkillIds, matchLocalIntent, SPHERE_PROMPT } from "./localPlanner"
import { PYRAMID_PROMPT, PYRAMID_UNVERIFIED_PROMPT } from "./representativeFixtures"

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

/**
 * **球**（球体切片 Task 8 的端到端那一半）：本地确定性规划器也能把一句话变成一只球。
 *
 * 判据两条：
 * ① 半径**从原话里读**，编译后草稿里恰好**一个** `sphere` 图元（球不物化子对象）；
 * ② **不许劫持分析题** —— "外接球 / 内切球"里都有"球"字，但它们要的是**读数**，不是新建一只球。
 */
describe("the sphere intent", () => {
  it("builds a sphere from the radius in the sentence, and compiles to exactly one primitive", async () => {
    const envelope = await plan("画一个球体，半径 5")

    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return
    expect(envelope.actions).toHaveLength(1)
    expect(envelope.actions[0].actionId).toBe("solid.create_sphere")
    expect(envelope.actions[0].inputs).toMatchObject({ center: { x: 0, y: 0, z: 0 }, radius: 5 })

    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(envelope, { document, workspace: "geometry3d", prompt: "画一个球体，半径 5", conversationId: "eval", documentGeneration: document.revision })
    expect(compiled.ok).toBe(true)
    // 球是解析体：草稿里就它自己，没有点 / 棱 / 面 / polyhedron3。
    expect(compiled.draftDocument?.primitives).toHaveLength(1)
    expect(compiled.draftDocument?.primitives[0]).toMatchObject({ type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 5 })
  })

  it("falls back to the shared default radius when the sentence has no number", async () => {
    const envelope = await plan("画一个球体")

    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return
    expect(envelope.actions[0].inputs).toMatchObject({ radius: DEFAULT_SOLID_SIZE })
  })

  it("does not hijack an analysis question that merely mentions a sphere", () => {
    /**
     * 这两句里都有"球"，但它们要的是**读数**（外接球 / 内切球半径），不是新建一只球。
     *
     * 断言写成"命中的**不是球那条**"而不是"认不出"：`内切球` 那句会命中**既有的「正方体」条目**
     *（它一直在那儿，与本切片无关）—— 那是一条**独立的**既有隐患，记在归档里，
     * 不在这里冒充成球的问题。
     */
    const sphereIntent = LOCAL_INTENTS.find((intent) => intent.all.includes("球体"))
    expect(sphereIntent, "球那条应该已经登记").toBeDefined()
    expect(matchLocalIntent("求这个四面体的外接球半径并画出球")).not.toBe(sphereIntent)
    expect(matchLocalIntent("这个正方体的内切球半径是多少")).not.toBe(sphereIntent)
    // 具体写法才认。
    expect(matchLocalIntent(SPHERE_PROMPT)).toBe(sphereIntent)
  })
})

describe("local planner translates the commands it knows", () => {
  it("replays only the exact condition-checked pyramid fixture offline", async () => {
    const matched = matchLocalIntent(PYRAMID_PROMPT)
    expect(matched).not.toBeNull()
    expect(matchLocalIntent(`${PYRAMID_PROMPT}，AB=7`)).toBeNull()
    const envelope = await plan(PYRAMID_PROMPT)
    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return
    expect(envelope.actions[0].inputs).toMatchObject({ vertexNames: ["P", "A", "B", "C", "D"] })
    const document = createEmptyDocument("geometry3d")
    expect(compilePlan(envelope, { document, prompt: PYRAMID_PROMPT }).diagramVerification?.status).toBe("passed")
  })

  it("routes the exact unsupported-angle representative to the same deterministic gate, never a verified claim", async () => {
    expect(matchLocalIntent(PYRAMID_UNVERIFIED_PROMPT)).not.toBeNull()
    const envelope = await plan(PYRAMID_UNVERIFIED_PROMPT)
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(envelope, { document, prompt: PYRAMID_UNVERIFIED_PROMPT })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("unverified")
  })
  it("builds a cube with the size the user asked for", async () => {
    const envelope = await plan("建一个棱长 3 的立方体")

    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") throw new Error("expected a plan")
    expect(envelope.actions).toHaveLength(1)
    expect(envelope.actions[0].actionId).toBe("solid.create_template")
    // 尺寸要来自指令，而不是写死的默认值。
    expect(envelope.actions[0].inputs).toMatchObject({ template: "cube", size: { x: 3, y: 3, z: 3 } })
  })

  it("places a cube by its actual center when the user asks for the origin", async () => {
    const envelope = await plan("画一个棱长 3、中心在原点的立方体")
    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return
    expect(envelope.actions[0].inputs).toMatchObject({ origin: { x: -1.5, y: -1.5, z: -1.5 }, size: { x: 3, y: 3, z: 3 } })
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(envelope, { document, workspace: "geometry3d", prompt: "画一个棱长 3、中心在原点的立方体", conversationId: "eval", documentGeneration: document.revision })
    expect(compiled.ok).toBe(true)
    const cube = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "cube")
    expect(cube).toMatchObject({ type: "cube", origin: { x: -1.5, y: -1.5, z: -1.5 }, size: { x: 3, y: 3, z: 3 } })
  })

  it("does not mistake center coordinates for the requested edge length", async () => {
    const envelope = await plan("画一个中心在(1,2,3)、棱长为 4 的立方体")
    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return
    expect(envelope.actions[0].inputs).toMatchObject({ origin: { x: -1, y: 0, z: 1 }, size: { x: 4, y: 4, z: 4 } })
  })

  it("does not silently replace an explicitly invalid zero edge length with a default", async () => {
    const envelope = await plan("画一个棱长为 0 的立方体")
    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return
    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(envelope, { document, workspace: "geometry3d", prompt: "画一个棱长为 0 的立方体", conversationId: "eval", documentGeneration: document.revision })
    expect(compiled.ok).toBe(false)
    expect(compiled.draftDocument).toBeNull()
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
   * **正四面体**（用户口径直接要它）。
   *
   * 以前动作层没有这个形状，模型只能拿三棱柱冒充（用户现场：要正四面体，拿到三棱柱）。现在：
   * ① 有了独立动作 `solid.create_tetrahedron`；② 本地规划器也认这几句 —— 于是**没有模型服务**时
   * 也能真的把它建出来，棱长从原话里读。
   */
  it("builds a tetrahedron with the edge length the user asked for", async () => {
    const envelope = await plan("画一个正四面体 ABCD，棱长为 3")

    // 传输层合同先过一遍：这条动作是新的，`parsePlanEnvelope` 不认识就等于模型/规划器都发不出去。
    expect(parsePlanEnvelope(envelope).ok).toBe(true)
    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") throw new Error("expected a plan")
    expect(envelope.actions).toHaveLength(1)
    expect(envelope.actions[0].actionId).toBe("solid.create_tetrahedron")
    expect(envelope.actions[0].inputs).toMatchObject({ baseCenter: { x: 0, y: 0, z: 0 }, edge: 3 })
  })

  it("falls back to the shared solid default when a tetrahedron prompt has no number", async () => {
    const envelope = await plan("画一个正四面体")

    if (envelope.kind !== "plan") throw new Error("expected a plan")
    // 默认值只有一处（`localPlanDefaults` 的 `DEFAULT_SOLID_SIZE`），不在这里再抄一个数。
    expect(envelope.actions[0].inputs).toMatchObject({ edge: DEFAULT_SOLID_SIZE })
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

/**
 * **分析题不该被当成建模指令**（2026-10-02 查实的既有隐患）。
 *
 * 现场：把"这个正方体的内切球半径是多少"喂进本地规划器，命中的是既有的「正方体」条目 ——
 * 它会**去新建一只正方体**，而用户要的是一个读数。这与"不认裸词四面体 / 裸词球"是同一条
 * 纪律（见 `localPlanner.ts` 里那两条注释）：认不出时**老实问路**，比悄悄改文档好。
 *
 * 判据刻意不是"答得对不对"（本地规划器不接模型、答不了读数），而是**不许悄悄改文档**。
 */
describe("analysis questions", () => {
  it("does not turn an inscribed-sphere question into a new cube", async () => {
    const envelope = await plan("这个正方体的内切球半径是多少")

    expect(envelope.kind).toBe("clarification")
  })

  it("does not turn an 'external sphere' question into a new cube either", async () => {
    const envelope = await plan("求这个正方体的外接球半径")

    expect(envelope.kind).toBe("clarification")
  })

  it("still builds a cube when the sentence actually asks for one", async () => {
    const envelope = await plan("建一个棱长 3 的立方体")

    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return
    expect(envelope.actions[0]?.actionKey).toBe("cube")
  })

  it("keeps the sphere prompt working, because it does say 'draw'", async () => {
    // 反向对照：`SPHERE_PROMPT` 里既有"画"也有"半径" —— 挡的必须是"只问读数"的句子，
    // 不能连"画一个半径 5 的球体"一起挡掉。
    const envelope = await plan(SPHERE_PROMPT)

    expect(envelope.kind).toBe("plan")
  })
})

import { DEFAULT_SOLID_SIZE, compilePlan, parsePlanEnvelope, SKILL_MANIFESTS } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createLocalPlanner, LOCAL_INTENTS, localIntentSkillIds, matchLocalIntent, SPHERE_PROMPT } from "./localPlanner"
import { CONIC_ELLIPSE_PROMPT, FUNCTION_TANGENT_PROMPT, PYRAMID_PROMPT, PYRAMID_UNVERIFIED_PROMPT, PLANAR_TRIANGLE_PROMPT } from "./representativeFixtures"

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


describe("V0a opt-in local free-apex diagram intent", () => {
  const prompt = "在三棱锥D-ABC中，AD⊥平面ABC，自由点D，画示意图"
  it("does not alter the default local planner when witness search is off", async () => {
    expect(matchLocalIntent(prompt)).toBeNull()
    const result = (await createLocalPlanner().plan({ userMessage: prompt } as never)).plan
    expect(result.kind).toBe("clarification")
  })

  it("uses named points and verified candidate construction once explicitly enabled", async () => {
    expect(localIntentSkillIds(prompt, { enableFreeApex: true })).toContain("spatial-modeling")
    const result = (await createLocalPlanner({ enableFreeApex: true }).plan({ userMessage: prompt } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind !== "plan") return
    expect(result.actions[0].actionId).toBe("solid.create_polyhedron")
    expect(result.actions[0].inputs).toMatchObject({ vertexNames: ["A", "B", "C", "D"] })
    const doc = createEmptyDocument("geometry3d")
    const compiled = compilePlan(result, { document: doc, prompt, diagramWitnessSearch: true, conversationId: "local-diagram", documentGeneration: doc.revision })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.draftDocument?.primitives.some((item) => item.type === "polyhedron3")).toBe(true)
  })

  it("takes vertex names from a bounded grammar rather than hardcoding D-ABC", async () => {
    const another = "在三棱锥P-XYZ中，PX⊥平面XYZ，自由点P，画示意图"
    const result = (await createLocalPlanner({ enableFreeApex: true }).plan({ userMessage: another } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind === "plan") expect(result.actions[0].inputs).toMatchObject({ vertexNames: ["X", "Y", "Z", "P"] })
  })

  it("does not silently drop an extra length, above-plane condition or pure analysis request", async () => {
    for (const input of [`${prompt}，AB=7`, "在三棱锥D-ABC中，AD⊥平面ABC，D在底面ABC上方，画示意图", "在三棱锥D-ABC中，AD⊥平面ABC，求高是多少"]) {
      const result = (await createLocalPlanner({ enableFreeApex: true }).plan({ userMessage: input } as never)).plan
      expect(result.kind, input).toBe("clarification")
    }
  })

  /**
   * **原话写死的坐标必须真的进图**（计划 V0a 点名的独立 RED 条件）。
   *
   * 只管"这句话认不认"：坐标段固定落在「中，」与「⊥」之间。**开关关着时一个字也不认**，
   * 所以它不改变默认规划器的行为。
   */
  const coordinatePrompt = "在三棱锥D-ABC中，A=(0,0,0)，AD⊥平面ABC，自由点D，画示意图"

  it("keeps the explicit-coordinate sentence invisible while the flag is off", () => {
    expect(matchLocalIntent(coordinatePrompt)).toBeNull()
    expect(localIntentSkillIds(coordinatePrompt)).toEqual([])
  })

  it("accepts the bounded explicit-coordinate sentence and honours the stated coordinate", async () => {
    expect(localIntentSkillIds(coordinatePrompt, { enableFreeApex: true })).toContain("spatial-modeling")
    const built = (await createLocalPlanner({ enableFreeApex: true }).plan({ userMessage: coordinatePrompt } as never)).plan
    expect(built.kind).toBe("plan")
    if (built.kind !== "plan") return
    const vertices = (built.actions[0].inputs as unknown as { vertices: { x: number; y: number; z: number }[] }).vertices
    // 「题面说 A=(0,0,0)」与「候选把 A 放在 (0,0,0)」必须是同一件事，不是各说各的。
    expect(vertices[0]).toEqual({ x: 0, y: 0, z: 0 })
    const doc = createEmptyDocument("geometry3d")
    const compiled = compilePlan(built, { document: doc, prompt: coordinatePrompt, diagramWitnessSearch: true, conversationId: "local-diagram", documentGeneration: doc.revision })
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.some((check) => check.sourceText === "A=(0,0,0)" && check.status === "passed")).toBe(true)
  })

  it("refuses any diagram when the stated coordinate is not one the candidate can honour", async () => {
    // 同一个句式、只改一个数：这一条**不能**因为"形状对得上"就放行。
    const conflicting = "在三棱锥D-ABC中，A=(5,5,5)，AD⊥平面ABC，自由点D，画示意图"
    /**
     * **先把"假绿"堵掉**：如果这句话压根不被认识，`clarification` 也会成立，
     * 那条断言就什么都没证明。所以先钉住"它**被认出来了**"，再钉"仍然拒绝"。
     */
    expect(matchLocalIntent(conflicting, { enableFreeApex: true })).not.toBeNull()
    const result = (await createLocalPlanner({ enableFreeApex: true }).plan({ userMessage: conflicting } as never)).plan
    expect(result.kind).toBe("clarification")
    // 被认出来之后，拒绝的理由必须是"题设没被核验"，而不是"我又不认识这条指令了"。
    if (result.kind === "clarification") expect(result.questions.join(" ")).toContain("核验")
  })

  it("does not accept coordinates for the free apex or for a vertex outside the named base", () => {
    // 顶点是**自由点**：给它写死坐标等于换了一条题设；环外名字更是这套窄语法没承诺过的写法。
    for (const input of [
      "在三棱锥D-ABC中，D=(0,0,2)，AD⊥平面ABC，自由点D，画示意图",
      "在三棱锥D-ABC中，Q=(0,0,0)，AD⊥平面ABC，自由点D，画示意图",
      "在三棱锥D-ABC中，A=(0,0)，AD⊥平面ABC，自由点D，画示意图"
    ]) {
      expect(matchLocalIntent(input, { enableFreeApex: true }), input).toBeNull()
    }
  })
})

/**
 * **V0b：平面直角三角形的本地入口**。
 *
 * 这一条与上一条（三棱锥）最重要的区别：它**不挂在实验开关后面**。
 * 开关管的是"见证搜索"（欠定题候选的搜索），而这里是既有的夹具路径，
 * 与 `PYRAMID_PROMPT` 同类 —— 默认就该能跑。
 */
describe("V0b local planar right triangle", () => {
  it("is reachable without enabling any experimental flag", () => {
    expect(matchLocalIntent(PLANAR_TRIANGLE_PROMPT)).not.toBeNull()
    expect(localIntentSkillIds(PLANAR_TRIANGLE_PROMPT)).toContain("planar-basics")
  })

  it("names the three vertices with planar points so the premise verifier has a name table", async () => {
    const result = (await createLocalPlanner().plan({ userMessage: PLANAR_TRIANGLE_PROMPT } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind !== "plan") return
    // 三条**点名**的点动作 —— 线段动作的端点只是匿名坐标，建不出点名表。
    expect(result.actions.map((action) => action.actionId)).toEqual(["planar.create_point", "planar.create_point", "planar.create_point"])
    expect(result.actions.map((action) => (action.inputs as { label?: string }).label)).toEqual(["A", "B", "C"])

    const document = createEmptyDocument("conics")
    const compiled = compilePlan(result, { document, prompt: PLANAR_TRIANGLE_PROMPT, conversationId: "local-planar", documentGeneration: document.revision })
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    // 核验器按**真实落盘**的坐标逐条量，结论必须真的来自那张图。
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.map((item) => `${item.sourceText}:${item.status}`)).toEqual(["AB⊥AC:passed"])
  })

  it("does not claim a different triangle than the one it draws", async () => {
    // 反向对照：把夹具挪成 C 落在 AB 上（三点共线），同一条题设**必须**不通过。
    const result = (await createLocalPlanner().plan({ userMessage: PLANAR_TRIANGLE_PROMPT } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind !== "plan") return
    const moved = { ...result, actions: result.actions.map((action, index) => index === 2 ? { ...action, inputs: { ...action.inputs, points: [{ x: 3, y: 0 }] } } : action) }
    const document = createEmptyDocument("conics")
    const compiled = compilePlan(moved as typeof result, { document, prompt: PLANAR_TRIANGLE_PROMPT, conversationId: "local-planar", documentGeneration: document.revision })
    expect(compiled.diagramVerification?.status).toBe("failed")
    expect(compiled.ok).toBe(false)
  })
})

/**
 * **V0c：椭圆的本地入口**。
 *
 * 与平面三角那条同一条纪律（精确匹配、不挂实验开关），但有一处**关键不同**：
 * 题面是**方程**，两个半轴已经被分母钉死，所以**没有"系统自选"**这回事。
 * 这条用例把那个区别钉住 —— 免得哪天有人给它加一句"系统自选了示例值"，
 * 而那会让用户以为他看到的是条随手挑的曲线。
 */
describe("V0c local ellipse", () => {
  it("is reachable without enabling any experimental flag", () => {
    expect(matchLocalIntent(CONIC_ELLIPSE_PROMPT)).not.toBeNull()
    expect(localIntentSkillIds(CONIC_ELLIPSE_PROMPT)).toContain("conics-tangents")
  })

  it("builds the one ellipse the equation determines, and says it was not a free choice", async () => {
    const result = (await createLocalPlanner().plan({ userMessage: CONIC_ELLIPSE_PROMPT } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind !== "plan") return
    expect(result.actions.map((action) => action.actionId)).toEqual(["planar.create_conic"])
    expect(result.actions[0].inputs).toMatchObject({ kind: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 })
    // 题面把半轴钉死了 ⇒ 不许出现"系统自选示例值"那种话。
    const said = (result.assumptions ?? []).join(" ")
    expect(said).toContain("唯一确定")
    expect(said).not.toContain("示例值")

    const document = createEmptyDocument("conics")
    const compiled = compilePlan(result, { document, prompt: CONIC_ELLIPSE_PROMPT, conversationId: "local-conic", documentGeneration: document.revision })
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    // 判据的说明必须**带上焦点** —— 半轴对调的后果就是焦点换轴。
    expect(compiled.diagramVerification?.checks[0]?.reason).toContain("焦点")
  })

  it("does not certify an ellipse whose semi-axes were swapped on the way out", async () => {
    const result = (await createLocalPlanner().plan({ userMessage: CONIC_ELLIPSE_PROMPT } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind !== "plan") return
    // 同一条题面、只把两个半轴对调 —— 焦点随之从 x 轴换到 y 轴，那是**另一条曲线**。
    const swapped = { ...result, actions: result.actions.map((action) => ({ ...action, inputs: { ...action.inputs, radiusX: 2, radiusY: 3 } })) }
    const document = createEmptyDocument("conics")
    const compiled = compilePlan(swapped as typeof result, { document, prompt: CONIC_ELLIPSE_PROMPT, conversationId: "local-conic", documentGeneration: document.revision })
    expect(compiled.diagramVerification?.status).toBe("failed")
    expect(compiled.ok).toBe(false)
  })
})

/**
 * **V0d：函数图像与切线一起画出来**（计划点名的出口："真函数图和切线同时显示"）。
 *
 * ## 这里夹带了一次探针
 *
 * 内核 `compileTangent` 的注释写着"几何留空、只写 anchor：**重算**会把真正的切点与切向填进去"。
 * 那就意味着：**编译完的草稿里那条切线的 `slope` 可能是占位值**（0），
 * 而我的切线判据正是拿它与自己算的 `f′(x)` 比。
 *
 * 于是有两条路：真值被填进去了（判据在比真东西），或者没填（判据在比一个占位 0）。
 * **`x = 1` 这一例分不出这两者** —— `f′(1) = 0`，占位值恰好也是 0。
 * 所以在下面用 **`x = 2`**（`f′(2) = 9`）再试一次：若重算没发生，这一例会被误判为"错斜率"。
 */
describe("V0d local function graph with its tangent", () => {
  it("is reachable without any experimental flag and asks for both skill lists", () => {
    expect(matchLocalIntent(FUNCTION_TANGENT_PROMPT)).not.toBeNull()
    // 曲线由 `functions` 创建、切线由 `conics-tangents` 作 —— 少给一份，模型就少一个动作。
    expect(localIntentSkillIds(FUNCTION_TANGENT_PROMPT)).toEqual(expect.arrayContaining(["functions", "conics-tangents"]))
  })

  it("compiles into a real curve plus its tangent and passes both clauses", async () => {
    const result = (await createLocalPlanner().plan({ userMessage: FUNCTION_TANGENT_PROMPT } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind !== "plan") return
    const document = createEmptyDocument("conics")
    const compiled = compilePlan(result, { document, prompt: FUNCTION_TANGENT_PROMPT, conversationId: "local-fn", documentGeneration: document.revision })
    expect(compiled.ok, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe(true)
    expect(compiled.draftDocument?.primitives.filter((primitive) => primitive.type === "function")).toHaveLength(1)
    expect(compiled.draftDocument?.primitives.filter((primitive) => primitive.type === "tangent")).toHaveLength(1)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`)).toEqual(["f(x)=x³−3x:passed", "x=1 处的切线:passed"])
  })

  it("also accepts a tangent at x = 2, which is where a placeholder slope would show up", async () => {
    const result = (await createLocalPlanner().plan({ userMessage: FUNCTION_TANGENT_PROMPT } as never)).plan
    expect(result.kind).toBe("plan")
    if (result.kind !== "plan") return
    /**
     * 同一份计划，但**题面与切点一起**挪到 `x = 2`：那里 `f′(2) = 9`，而编译器留的占位斜率是 0。
     * 判据若比的是占位值，这一例必然红；只有真的按函数求了导才会通过。
     *
     * **不能只挪切点、不挪题面** —— 那造出的是"图画在 x=2、题面要 x=1"，
     * 判据拒绝它才是对的（我第一版就是这么写的，红得理直气壮，是我错了）。
     */
    const movedPrompt = FUNCTION_TANGENT_PROMPT.replace("x=1", "x=2")
    const moved = { ...result, actions: result.actions.map((action) => action.actionId === "function.create_tangent" ? { ...action, inputs: { ...action.inputs, x: 2 } } : action) }
    const document = createEmptyDocument("conics")
    const compiled = compilePlan(moved as typeof result, { document, prompt: movedPrompt, conversationId: "local-fn", documentGeneration: document.revision })
    expect(compiled.diagramVerification?.status, compiled.diagnostics.map((item) => item.detail).join("; ")).toBe("passed")
    // 而且真的是"在那一点的切线"：斜率 9 ≈ f′(2)，不是占位 0。
    const tangent = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "tangent") as { x: number; slope: number } | undefined
    expect(tangent?.x).toBeCloseTo(2, 9)
    expect(tangent?.slope).toBeCloseTo(9, 6)
  })
})

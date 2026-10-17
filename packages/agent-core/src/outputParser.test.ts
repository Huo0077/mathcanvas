import { describe, expect, it } from "vitest"

import {
  CANONICAL_FENCE, describeRepairPrompt, describeSchemaFailureForUser, parseFencedTextEnvelope,
  parseModelEnvelope, parseStrictJsonEnvelope, readSchemaFailureDetail, schemaFailureDetail
} from "./outputParser"

/**
 * **Task 2：22:36 那两轮失败**（计划 §6 Task 2）。
 *
 * 夹具只保留**动作名、必需字段与两次状态迁移** —— 原话、题目参数与坐标一律不进来
 *（计划原话："从用户轨迹只摘动作名、必需字段和两次状态迁移制成脱敏夹具"）。
 *
 * 现场的形状：第一轮模型拿 `solid.create_polyhedron` 去拼**开放**的平面图形（四边形 + 翻折片），
 * 死在"至少四个面"；**引擎给了正确建议**（改用 `solid.create_face`）之后，第二轮它**自己造了一个
 * 动作名** `solid.create_segment` ×3。而用户在界面上看到的是"模型的回答不符合计划合同的形状……
 * 计划必须是一个 JSON 对象（schemaVersion / kind / goal，外加 actions）" —— **那是一句误诊**：
 * 那一份信封的顶层形状**完全合法**，错的是三个动作名。
 */
const ROUND_ONE_OPEN_FIGURE = JSON.stringify({
  schemaVersion: "mathcanvas.plan.v1",
  kind: "plan",
  goal: "平面四边形与翻折片（脱敏）",
  factIds: [],
  actions: [{
    actionId: "solid.create_polyhedron",
    actionKey: "quad",
    factIds: [],
    inputs: { alias: "quad", faces: [[0, 1, 2, 3]], vertexNames: ["A", "B", "C", "D"] }
  }]
})

const ROUND_TWO_INVENTED_SEGMENT = JSON.stringify({
  schemaVersion: "mathcanvas.plan.v1",
  kind: "plan",
  goal: "平面四边形与翻折片（脱敏）",
  factIds: [],
  actions: [0, 1, 2].map((index) => ({ actionId: "solid.create_wire", actionKey: `seg-${index}`, factIds: [], inputs: {} }))
})

/**
 * Task 2.3 Step 1 里属于解析器的几条：**strict JSON、one repair、provider downgrade**，
 * 以及"绝不抠取、绝不修补"这两条安全边界。
 */
const validPlan = {
  schemaVersion: "mathcanvas.plan.v1",
  kind: "plan",
  goal: "画一个立方体",
  factIds: ["size-four"],
  actions: [{ actionId: "solid.create_template", actionKey: "solid", factIds: ["size-four"], inputs: { alias: "solid", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } } }]
}

const json = JSON.stringify(validPlan)

describe("Task 2 — an unregistered action is not a malformed envelope", () => {
  it("round-trips the ledger's schema-failure line back into field errors", () => {
    const failed = parseStrictJsonEnvelope(ROUND_TWO_INVENTED_SEGMENT)
    if (failed.ok) throw new Error("expected a failure")

    const detail = schemaFailureDetail(failed.errors)
    const read = readSchemaFailureDetail(detail)

    // 生产方与消费方是同一个模块里的一对；解析回来的路径必须逐条对得上。
    expect(read.map((entry) => entry.path)).toEqual(["envelope.actions[0].actionId", "envelope.actions[1].actionId", "envelope.actions[2].actionId"])
    expect(read.every((entry) => entry.code === "unknown_action")).toBe(true)
  })

  it("names the invented action and all three of its paths, instead of blaming the envelope's shape", () => {
    const first = parseStrictJsonEnvelope(ROUND_ONE_OPEN_FIGURE)
    const second = parseStrictJsonEnvelope(ROUND_TWO_INVENTED_SEGMENT)
    if (first.ok || second.ok) throw new Error("expected both rounds to fail")

    const message = describeSchemaFailureForUser(schemaFailureDetail(second.errors), [schemaFailureDetail(first.errors)])

    // ① 点名那个不存在的动作。
    expect(message).toContain("solid.create_wire")
    // ② 三个路径都要在（用户/模型才知道是三笔都写错了，不是一笔）。
    for (const index of [0, 1, 2]) expect(message).toContain(`envelope.actions[${index}].actionId`)
    // ③ 上一轮引擎已经给过的建议要一起回到用户面前 —— 那正是模型走偏的原因。
    expect(message).toContain("solid.create_face")
    // ④ **不许**把"动作名不认识"说成"顶层 JSON 形状不合法"。
    expect(message).not.toContain("计划必须是一个 JSON 对象")
  })

  it("still blames the top-level shape when the top-level shape really is wrong", () => {
    const array = parseStrictJsonEnvelope("[1, 2, 3]")
    if (array.ok) throw new Error("expected a failure")

    const message = describeSchemaFailureForUser(schemaFailureDetail(array.errors), [])

    // 反例：真的不是对象时，原来那句"计划必须是一个 JSON 对象"是对的，必须留下。
    expect(message).toContain("计划必须是一个 JSON 对象")
    expect(message).not.toContain("solid.create_face")
  })
})

describe("strict JSON channel", () => {
  it("accepts a bare JSON object", () => {
    const result = parseStrictJsonEnvelope(json)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.channel).toBe("strict_json")
  })

  it("refuses a fenced block, because this channel means bare JSON", () => {
    // 通道的语义要**可区分**：严格 JSON 通道不接受围栏，文本通道接受一层。
    // 若两个通道一样宽容，"按通道降级"就没有意义。
    const result = parseStrictJsonEnvelope(`${CANONICAL_FENCE}\n${json}\n\`\`\``)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unexpected_prose")
  })

  it("refuses prose even when a valid plan is embedded in it", () => {
    // 这是最关键的一条：**不抠取**。
    const result = parseStrictJsonEnvelope(`好的，我来画一个立方体：\n${json}\n需要我继续吗？`)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unexpected_prose")
  })

  it("refuses a non-string and an empty string", () => {
    expect(parseStrictJsonEnvelope({ kind: "plan" }).ok).toBe(false)
    expect(parseStrictJsonEnvelope("   ").ok).toBe(false)
  })
})

describe("fenced text channel", () => {
  it("accepts exactly one outer json fence", () => {
    const result = parseFencedTextEnvelope(`${CANONICAL_FENCE}\n${json}\n\`\`\``)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.channel).toBe("fenced_text")
  })

  it("accepts bare JSON too, so a downgrade never makes things worse", () => {
    const result = parseFencedTextEnvelope(json)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.channel).toBe("fenced_text")
  })

  it("refuses an unterminated fence instead of guessing the end", () => {
    const result = parseFencedTextEnvelope(`${CANONICAL_FENCE}\n${json}`)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unterminated_fence")
  })

  it("refuses a nested fence block", () => {
    const nested = `${CANONICAL_FENCE}\n{"kind":"plan","answer":"\`\`\`json\\n{}\\n\`\`\`"}\n\`\`\``
    const result = parseFencedTextEnvelope(nested)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unexpected_prose")
  })

  it("refuses a fence that is not json", () => {
    const result = parseFencedTextEnvelope("```javascript\nconst x = 1\n```")

    expect(result.ok).toBe(false)
  })

  it("refuses prose outside the fence", () => {
    const result = parseFencedTextEnvelope(`这是计划：\n${CANONICAL_FENCE}\n${json}\n\`\`\``)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unexpected_prose")
  })

  it("refuses prose with no fence at all", () => {
    const result = parseFencedTextEnvelope(`好的，我来画一个立方体：\n${json}`)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unexpected_prose")
  })
})

describe("no field repair", () => {
  it("rejects a plan whose numeric field arrived as a string instead of coercing it", () => {
    // 修补等于替模型做决定，而用户确认的是模型**原样**说的话。
    const tampered = JSON.stringify({ ...validPlan, actions: [{ ...validPlan.actions[0], inputs: { ...validPlan.actions[0].inputs, size: { x: "4", y: 4, z: 4 } } }] })

    const result = parseStrictJsonEnvelope(tampered)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("schema_invalid")
  })

  it("rejects a plan with an extra field instead of dropping it", () => {
    const tampered = JSON.stringify({ ...validPlan, note: "顺便把颜色也改了" })

    const result = parseStrictJsonEnvelope(tampered)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("schema_invalid")
  })

  it("reports schema failures with exact field paths", () => {
    const broken = JSON.stringify({ ...validPlan, actions: [{ ...validPlan.actions[0], actionId: "planar.create_dragon" }] })

    const result = parseStrictJsonEnvelope(broken)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // 路径必须精确到字段，修复提示才可执行（计划 Step 5）。
      expect(result.errors.some((error) => error.path.includes("actions[0]"))).toBe(true)
      expect(result.payload).toBe(broken)
    }
  })
})

describe("repair prompt", () => {
  it("names the exact field paths and forbids extra prose", () => {
    const broken = JSON.stringify({ ...validPlan, actions: [{ ...validPlan.actions[0], actionId: "planar.create_dragon" }] })
    const result = parseStrictJsonEnvelope(broken)
    if (result.ok) throw new Error("expected a failure")

    const prompt = describeRepairPrompt(result)

    expect(prompt).toContain("actions[0]")
    expect(prompt).toContain("只返回一个 JSON 对象")
    // 严格通道下要明说不要围栏，否则第二次还是同一种失败。
    expect(prompt).toContain("不要用代码围栏")
  })

  it("allows a single fence when the failure was prose on the text channel", () => {
    const result = parseFencedTextEnvelope(`说明：\n${json}`)
    if (result.ok) throw new Error("expected a failure")

    const prompt = describeRepairPrompt(result)

    expect(prompt).toContain("只包一层")
  })

  it("does not echo the model's own words back into the prompt", () => {
    // 把散文原样送回去会变成自我强化的循环，也让提示词被模型自己的输出污染。
    const result = parseStrictJsonEnvelope(`好的，我来画一个：\n${json}`)
    if (result.ok) throw new Error("expected a failure")

    const prompt = describeRepairPrompt(result)

    expect(prompt).not.toContain("好的，我来画一个")
  })

  /**
   * **点名缺了哪个顶层字段**（2026-10-04，来自真实运行）。
   *
   * 用户现场的模型两次都没给出合法信封：一次连 `kind` 都没有，一次把
   * `schemaVersion`/`kind`/`goal`/`factIds`/`assumptions` 都写了、**却漏了 `actions`**。
   * 引擎只回一句 `invalid_type@envelope.actions: expected an array`，模型并不知道
   * "kind 为 plan 时 actions 必填"这条合同细节，于是第二轮照样漏。
   *
   * 修复提示是唯一能让第二轮不同的东西，所以它必须点名**具体缺哪个键**。
   */
  it("names the missing top-level fields, because 'expected an array' tells the model nothing", () => {
    // 复刻现场那次：goal / assumptions 都写了，就是没有 actions。
    const withoutActions = JSON.stringify({
      schemaVersion: "mathcanvas.plan.v1",
      kind: "plan",
      goal: "建立满足题设的三棱锥",
      factIds: [],
      assumptions: ["取 BD 在 x 轴上"]
    })
    const result = parseStrictJsonEnvelope(withoutActions)
    if (result.ok) throw new Error("expected a failure")

    const prompt = describeRepairPrompt(result)

    expect(prompt).toContain("actions")
    expect(prompt).toContain("缺了顶层必填字段")
  })

  it("names kind as missing when the envelope has no kind at all", () => {
    // 复刻现场第一次尝试：连 kind 都没有。
    const result = parseStrictJsonEnvelope(JSON.stringify({ schemaVersion: "mathcanvas.plan.v1", actions: [{}] }))
    if (result.ok) throw new Error("expected a failure")

    const prompt = describeRepairPrompt(result)

    expect(prompt).toContain("kind")
  })

  /**
   * **一个面环都没给时，提示要说出两条出路**（2026-10-11 用户现场；2026-10-17 更新）。
   *
   * 用户那道题是"平面四边形 + 翻折片"——**开放的**平面图形。模型每次都拿
   * `solid.create_polyhedron` 去表达；当时它要求至少四个面，于是每次都收到
   * 同一句 `a polyhedron needs at least four faces`。**那句话没告诉它正确答案**：
   * 我们其实有 `solid.create_face`（能力表里就有）。修复提示是唯一能让下一轮不同的东西，
   * 所以它必须在这里说出那个动作的名字。
   *
   * 2026-10-17 用户裁定"让现有 action 兼容 1 个面"之后，单面四边形本身**不再报错**；
   * 仍然会撞这条提示的是"连一个面环都没给"（模型现场的第一稿就是 `faces: []`）。
   * 这时两句都要说：**补一个面环**（平面多边形），或者**改用 `solid.create_face`**。
   */
  it("names solid.create_face when a polyhedron is given no face ring at all", () => {
    const openFigure = JSON.stringify({
      schemaVersion: "mathcanvas.plan.v1",
      kind: "plan",
      goal: "平面四边形 ABCD 与翻折片",
      factIds: [],
      actions: [{
        actionId: "solid.create_polyhedron",
        actionKey: "quad",
        factIds: [],
        inputs: {
          alias: "quad",
          faces: [],
          vertexNames: ["A", "B", "C", "D"],
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: Math.sqrt(3), z: 0 }, { x: 7.5, y: 2.5 * Math.sqrt(3), z: 0 }]
        }
      }]
    })
    const result = parseStrictJsonEnvelope(openFigure)
    if (result.ok) throw new Error("expected a failure")

    const prompt = describeRepairPrompt(result)

    expect(prompt).toContain("solid.create_face")
    expect(prompt).toContain("平面多边形")
  })

  it("accepts the single-face planar polygon the old repair was written for", () => {
    /**
     * 同一个动作、同样的四个顶点，**只给一个面环**现在是合法的平面四边形
     * （物化成 `face3`）—— 这正是用户裁定要的兼容形态。
     */
    const planarQuad = JSON.stringify({
      schemaVersion: "mathcanvas.plan.v1",
      kind: "plan",
      goal: "平面四边形 ABCD",
      factIds: [],
      actions: [{
        actionId: "solid.create_polyhedron",
        actionKey: "quad",
        factIds: [],
        inputs: {
          alias: "quad",
          faces: [[0, 1, 2, 3]],
          vertexNames: ["A", "B", "C", "D"],
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: Math.sqrt(3), z: 0 }, { x: 7.5, y: 2.5 * Math.sqrt(3), z: 0 }]
        }
      }]
    })
    const result = parseStrictJsonEnvelope(planarQuad)

    expect(result.ok, result.ok ? "" : result.errors.map((error) => `${error.code}@${error.path}`).join(", ")).toBe(true)
  })

  /**
   * **Task 2：模型自己造动作名时，提示里必须点名那个名字并说"别造"。**
   *
   * 现场第二轮：模型把 `solid.create_segment` 写了三次。原提示只给出三条路径
   *（`envelope.actions[0..2].actionId: unregistered action '…'`），**没有说"这个动作不存在、
   * 你该用哪个"** —— 而它上一轮刚被同一类问题挡过一次，每一轮只有一次修复机会。
   *
   * **2026-10-15：那个名字后来真的实现了**（立体里的线段动作 ⇒ `solid.create_segment`，
   * 见 `solidSegment.test.ts`）。这条用例要的是"**不存在的**动作名能被点名"，所以夹具换成
   * 一个今天仍然不存在的名字（`solid.create_wire`）—— 覆盖不变，现场记录也照旧留着。
   */
  it("names the invented solid action and tells the model not to look for it", () => {
    const invented = JSON.stringify({
      ...validPlan,
      actions: [0, 1, 2].map((index) => ({ actionId: "solid.create_wire", actionKey: `seg-${index}`, factIds: [], inputs: {} }))
    })
    const result = parseStrictJsonEnvelope(invented)
    if (result.ok) throw new Error("expected a failure")

    const prompt = describeRepairPrompt(result)

    expect(prompt).toContain("solid.create_wire")
    expect(prompt).toContain("solid.create_face")
    expect(prompt).toContain("不要自己造动作名")
  })

  it("does not mention solid.create_face for unrelated failures", () => {
    // 泛谈会稀释提示：只在真的撞上那堵墙时才说这一句。
    const unrelated = JSON.stringify({ ...validPlan, actions: [{ ...validPlan.actions[0], actionId: "planar.create_dragon" }] })
    const result = parseStrictJsonEnvelope(unrelated)
    if (result.ok) throw new Error("expected a failure")

    expect(describeRepairPrompt(result)).not.toContain("solid.create_face")
  })

  it("stays silent about missing fields when the payload is unreadable", () => {
    // 不是合法 JSON / 不是对象时**不猜** —— 只给原有的字段路径错误。
    const result = parseStrictJsonEnvelope("not json at all")
    if (result.ok) throw new Error("expected a failure")

    expect(describeRepairPrompt(result)).not.toContain("缺了顶层必填字段")
  })
})

describe("channel dispatch", () => {
  it("routes to the requested channel", () => {
    const strict = parseModelEnvelope(json, "strict_json")
    const fenced = parseModelEnvelope(`${CANONICAL_FENCE}\n${json}\n\`\`\``, "fenced_text")

    expect(strict.ok).toBe(true)
    expect(fenced.ok).toBe(true)
  })

  it("rejects an unknown channel instead of falling back to a lenient one", () => {
    const result = parseModelEnvelope(json, "anything_goes" as never)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unknown_channel")
  })
})

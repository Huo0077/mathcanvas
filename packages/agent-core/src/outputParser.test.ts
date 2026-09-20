import { describe, expect, it } from "vitest"

import { CANONICAL_FENCE, describeRepairPrompt, parseFencedTextEnvelope, parseModelEnvelope, parseStrictJsonEnvelope } from "./outputParser"

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

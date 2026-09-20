import { describe, expect, it } from "vitest"

import { canSendImages, planModelRequest, selectChannel, type ProviderCapabilities, type ProviderProfile } from "./modelGateway"

/**
 * Task 2.3 Step 1/3 的网关部分：**provider downgrade** 与
 * "Do not send a tool schema to providers that failed capability verification"。
 */
function profile(capabilities: Partial<ProviderCapabilities> = {}): ProviderProfile {
  return {
    id: "profile-1",
    dialect: "openai-compatible",
    modelId: "some-model",
    capabilities: { tools: "unknown", json: "unknown", vision: "unknown", ...capabilities }
  }
}

describe("channel selection", () => {
  it("uses native tools only when tool support is verified", () => {
    const selection = selectChannel(profile({ tools: "verified" }), true)

    expect(selection.ok).toBe(true)
    if (selection.ok) expect(selection.channel).toBe("native_tools")
  })

  it("refuses rather than sending a tool schema to an unverified provider", () => {
    // 会静默忽略工具的服务上，模型会在散文里"描述"它想调用什么，而画布什么都不会变。
    const selection = selectChannel(profile({ tools: "declared" }), true)

    expect(selection.ok).toBe(false)
    if (!selection.ok) {
      expect(selection.reason).toBe("CAPABILITY_UNAVAILABLE")
      expect(selection.missing).toEqual(["tools"])
      expect(selection.detail).toContain("declared")
    }
  })

  it("treats a failed tool probe as unavailable too", () => {
    const selection = selectChannel(profile({ tools: "failed" }), true)

    expect(selection.ok).toBe(false)
  })

  it("uses strict JSON when JSON output is verified and tools are not needed", () => {
    const selection = selectChannel(profile({ json: "verified" }), false)

    expect(selection.ok).toBe(true)
    if (selection.ok) expect(selection.channel).toBe("strict_json")
  })

  it("falls back to the text envelope when JSON support is not verified", () => {
    // 文本信封不需要额外能力：解析器自己会剥一层围栏并做 schema 校验。
    const selection = selectChannel(profile(), false)

    expect(selection.ok).toBe(true)
    if (selection.ok) expect(selection.channel).toBe("fenced_text")
  })

  it("still falls back to the text envelope when JSON support failed", () => {
    const selection = selectChannel(profile({ json: "failed" }), false)

    expect(selection.ok).toBe(true)
    if (selection.ok) expect(selection.channel).toBe("fenced_text")
  })
})

describe("request planning", () => {
  it("sends the tool schema only on the native-tools channel", () => {
    const native = planModelRequest({ profile: profile({ tools: "verified" }), context: {}, needsTools: true })
    const text = planModelRequest({ profile: profile({ json: "verified" }), context: {}, needsTools: false })

    expect(native.ok && native.sendToolSchema).toBe(true)
    expect(text.ok && text.sendToolSchema).toBe(false)
  })

  it("refuses the whole request when tools are needed but unverified", () => {
    const plan = planModelRequest({ profile: profile({ tools: "unknown" }), context: {}, needsTools: true })

    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toBe("CAPABILITY_UNAVAILABLE")
  })

  it("never sends images to a provider without verified vision", () => {
    // 计划 Task 2.3 明确要求："a successful text ping must not mark vision verified"。
    const plan = planModelRequest({ profile: profile({ tools: "verified", vision: "declared" }), context: {}, needsTools: false, withImages: true })

    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.reason).toBe("CAPABILITY_UNAVAILABLE")
      expect(plan.missing).toEqual(["vision"])
    }
  })

  it("sends images when vision is verified", () => {
    const plan = planModelRequest({ profile: profile({ vision: "verified" }), context: {}, needsTools: false, withImages: true })

    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.sendImages).toBe(true)
  })

  it("does not require vision when no images are requested", () => {
    const plan = planModelRequest({ profile: profile({ vision: "failed" }), context: {}, needsTools: false, withImages: false })

    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.sendImages).toBe(false)
  })

  it("reports vision availability separately from the text channel", () => {
    expect(canSendImages(profile({ vision: "verified" }))).toBe(true)
    expect(canSendImages(profile({ vision: "declared" }))).toBe(false)
    expect(canSendImages(profile())).toBe(false)
  })
})

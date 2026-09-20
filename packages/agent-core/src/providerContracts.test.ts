import { describe, expect, it } from "vitest"

import { containsSecretField, isCapabilityVerified, normalizeBaseUrl, parseProviderProfile, type ProviderProfile } from "./providerContracts"

/**
 * Provider 配置契约（Task 1.3 Step 1）。
 *
 * 计划逐条点名的六件事各有用例：required fields / HTTPS rules / duplicate names & IDs /
 * **secret omission** / custom Base URL normalization / profile revision increments。
 *
 * 最要紧的一条是 **secret omission**：配置里**永远**只有引用，没有密钥。
 * 而且判据是"出现即拒绝"，不是"忽略掉" —— 忽略会让调用方以为自己刚把密钥存进去了。
 */
function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "openai-main",
    name: "OpenAI",
    protocol: "openai_compatible",
    dialect: "openai_native",
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-5",
    networkPolicy: "cloud",
    capabilities: [],
    ...overrides
  }
}

function accepted(overrides: Record<string, unknown> = {}, existing: readonly ProviderProfile[] = []): ProviderProfile {
  const result = parseProviderProfile(valid(overrides), existing)
  if (!result.ok) throw new Error(`expected the profile to be accepted, got ${JSON.stringify(result.errors)}`)
  return result.value
}

function rejectedWith(overrides: Record<string, unknown>, code: string, existing: readonly ProviderProfile[] = []): void {
  const result = parseProviderProfile(valid(overrides), existing)
  expect(result.ok, `expected ${code} but the profile was accepted`).toBe(false)
  if (!result.ok) expect(result.errors.map((error) => error.code)).toContain(code)
}

describe("provider profile basics", () => {
  it("accepts a well-formed cloud profile and starts its revision at 1", () => {
    const profile = accepted()

    expect(profile.id).toBe("openai-main")
    expect(profile.revision).toBe(1)
    expect(profile.baseUrl).toBe("https://api.openai.com/v1")
    expect(profile.secretRef).toBeUndefined()
  })

  it("requires the fields the plan names", () => {
    for (const field of ["id", "name", "protocol", "dialect", "baseUrl", "modelId", "networkPolicy"] as const) {
      rejectedWith({ [field]: undefined }, "missing_field")
    }
  })

  it("rejects an unknown protocol or a dialect that does not belong to it", () => {
    rejectedWith({ protocol: "gemini" }, "unknown_protocol")
    rejectedWith({ dialect: "something_else" }, "unknown_dialect")
    // 协议与方言必须配套：`anthropic_messages` 配 `ollama` 是"选错了适配器"，
    // 而那种错在发请求时表现为 404/400，看起来像服务坏了。
    rejectedWith({ protocol: "ollama", dialect: "anthropic_messages" }, "dialect_protocol_mismatch")
  })

  it("caps the model id length so a pasted paragraph cannot become a model name", () => {
    rejectedWith({ modelId: "m".repeat(200) }, "string_too_long")
  })
})

describe("the profile never carries the secret itself", () => {
  it("refuses a profile that carries an api key instead of a reference", () => {
    // **出现即拒绝**，不是忽略：忽略会让调用方以为自己刚把密钥存进去了。
    rejectedWith({ apiKey: "sk-live-1234" }, "secret_not_allowed")
    rejectedWith({ secret: "sk-live-1234" }, "secret_not_allowed")
    rejectedWith({ token: "sk-live-1234" }, "secret_not_allowed")
  })

  it("allows secretRef, because that is a reference and not the secret", () => {
    const profile = accepted({ secretRef: "openai-main" })

    expect(profile.secretRef).toBe("openai-main")
  })

  it("detects a secret field anywhere in the object, at any depth", () => {
    // 写盘前的最后一道门用结构检查而不是字符串扫描 —— 密钥可能藏在嵌套对象里。
    expect(containsSecretField({ a: { b: { apiKey: "sk-x" } } })).toBe(true)
    expect(containsSecretField({ a: { b: { secretRef: "openai-main" } } })).toBe(false)
    expect(containsSecretField({ network: { policy: "cloud" } })).toBe(false)
  })
})

describe("base URL normalisation and the HTTPS rule", () => {
  it("trims whitespace, drops the trailing slash and the query string", () => {
    // 粘贴进来的 URL 一定带空白；`…/v1` 与 `…/v1/` 是同一个端点，留着两个会让重复检测漏掉。
    expect(normalizeBaseUrl("  https://api.openai.com/v1/  ")).toEqual({ ok: true, url: "https://api.openai.com/v1" })
    expect(normalizeBaseUrl("https://api.deepseek.com/v1?key=oops#frag")).toEqual({ ok: true, url: "https://api.deepseek.com/v1" })
  })

  it("refuses credentials embedded in the URL", () => {
    const result = normalizeBaseUrl("https://user:pass@api.openai.com/v1")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("embedded")
  })

  it("refuses a relative or non-http URL", () => {
    expect(normalizeBaseUrl("/v1").ok).toBe(false)
    expect(normalizeBaseUrl("ftp://api.openai.com").ok).toBe(false)
  })

  it("requires https for a cloud endpoint", () => {
    rejectedWith({ baseUrl: "http://api.openai.com/v1", networkPolicy: "cloud" }, "https_required")
  })

  it("refuses a cloud profile that points at a private or loopback address", () => {
    // 最常见的 SSRF 形状：让服务端去访问云元数据服务。
    rejectedWith({ baseUrl: "https://169.254.169.254/latest/meta-data" }, "private_address_denied")
    rejectedWith({ baseUrl: "https://127.0.0.1:11434/v1" }, "private_address_denied")
    rejectedWith({ baseUrl: "https://192.168.1.10/v1" }, "private_address_denied")
  })

  it("allows http and private addresses once the user declares lan or local", () => {
    // 这是**用户显式选择**的信任，不是默认放开。
    const local = accepted({ baseUrl: "http://127.0.0.1:11434/v1", networkPolicy: "local", protocol: "ollama", dialect: "ollama_native" })
    const lan = accepted({ baseUrl: "http://192.168.1.10:8000/v1", networkPolicy: "lan", id: "lan-box", name: "LAN box" })

    expect(local.baseUrl).toBe("http://127.0.0.1:11434/v1")
    expect(lan.networkPolicy).toBe("lan")
  })
})

describe("duplicates and revisions", () => {
  it("refuses a second profile with the same display name", () => {
    const existing = [accepted()]
    rejectedWith({ id: "openai-backup" }, "duplicate_name", existing)
  })

  it("increments the revision when an existing profile is saved again", () => {
    const first = accepted()
    const second = accepted({ modelId: "gpt-5-mini" }, [first])

    expect(second.revision).toBe(first.revision + 1)
    expect(second.modelId).toBe("gpt-5-mini")
  })

  it("keeps the revision climbing across several saves", () => {
    let profiles: ProviderProfile[] = []
    for (const model of ["a", "b", "c"]) {
      profiles = [accepted({ modelId: model }, profiles)]
    }

    expect(profiles[0].revision).toBe(3)
  })

  it("allows a profile to keep its own name when it is updated", () => {
    // 改名之外的更新不该被自己的名字判成重复。
    const first = accepted()
    const updated = accepted({ modelId: "gpt-5-mini" }, [first])

    expect(updated.name).toBe(first.name)
  })
})

describe("capability evidence is only trusted when it is verified and current", () => {
  it("does not trust a declared capability", () => {
    // `declared` 是"文档里说支持"，不是"我们验过"。
    const profile = accepted({ capabilities: [{ feature: "vision", status: "declared" }] })
    const health = { status: "ok" as const, capabilityEvidence: [], checkedAt: 1, profileRevision: profile.revision }

    expect(isCapabilityVerified(profile.capabilities, "vision", profile.revision, health)).toBe(false)
  })

  it("does not trust evidence that belongs to an older revision of the profile", () => {
    const profile = accepted({ capabilities: [{ feature: "tools", status: "verified" }] })
    const staleHealth = { status: "ok" as const, capabilityEvidence: [], checkedAt: 1, profileRevision: profile.revision - 1 }

    expect(isCapabilityVerified(profile.capabilities, "tools", profile.revision, staleHealth)).toBe(false)
  })

  it("trusts verified evidence that matches the current revision", () => {
    const profile = accepted({ capabilities: [{ feature: "tools", status: "verified", checkedAt: 42 }] })
    const health = { status: "ok" as const, capabilityEvidence: profile.capabilities, checkedAt: 42, profileRevision: profile.revision }

    expect(isCapabilityVerified(profile.capabilities, "tools", profile.revision, health)).toBe(true)
  })
})

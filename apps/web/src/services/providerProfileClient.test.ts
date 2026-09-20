import { afterEach, describe, expect, it } from "vitest"

import { findSecretField, isVerified, listProviderProfiles, readProviderHealth, removeProviderProfile, saveProfileWithSecret, upsertProviderProfile, type ProviderProfile } from "./providerProfileClient"

/**
 * Provider 配置客户端（Task 1.3 Step 1/3）。
 *
 * 两条最要紧的性质：
 * 1. **密钥字段一个都不许过** —— 在发 IPC **之前**就拦下（否则用户看到的是"保存失败"，
 *    而真正的原因是"这个字段根本不该出现在配置里"）；
 * 2. 与 `secretClient` 同一套失败口径：**没有桌面外壳 ≠ IPC 失败**。
 */
const internalsKey = "__TAURI_INTERNALS__"

function installInvoke(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  Object.defineProperty(globalThis, internalsKey, { configurable: true, writable: true, value: { invoke } })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, internalsKey)
})

const profile: ProviderProfile = {
  id: "openai",
  name: "OpenAI",
  protocol: "openai_compatible",
  dialect: "openai_native",
  baseUrl: "https://api.openai.com/v1",
  modelId: "gpt-5",
  secretRef: "openai",
  capabilities: [],
  networkPolicy: "cloud",
  revision: 1
}

describe("provider profile client", () => {
  it("lists profiles through the named command", async () => {
    const commands: string[] = []
    installInvoke(async (command) => { commands.push(command); return [profile] })

    const result = await listProviderProfiles()

    expect(commands).toEqual(["list_provider_profiles"])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(1)
  })

  it("sends the profile and the expected revision so a stale write can be refused", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => { calls.push({ command, args }); return { ...profile, revision: 2 } })

    const result = await upsertProviderProfile({ ...profile }, 1)

    expect(calls[0].command).toBe("upsert_provider_profile")
    expect(calls[0].args).toEqual({ profile: { ...profile }, expectedRevision: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.revision).toBe(2)
  })

  it("refuses a profile that carries a secret before it ever reaches the shell", async () => {
    const commands: string[] = []
    installInvoke(async (command) => { commands.push(command); return profile })

    const result = await upsertProviderProfile({ ...profile, apiKey: "sk-live-1234" })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("secret_not_allowed")
      expect(result.detail).toContain("apiKey")
      expect(result.detail).toContain("secretRef")
    }
    // 关键：**一次 IPC 都没发**。
    expect(commands).toEqual([])
  })

  it("finds a secret field nested anywhere, but lets secretRef through", () => {
    expect(findSecretField({ a: { b: { token: "x" } } })).toBe("token")
    expect(findSecretField({ secretRef: "openai", name: "OpenAI" })).toBeNull()
    expect(findSecretField({ provider: { auth: { password: "x" } } })).toBe("password")
  })

  it("separates 'no desktop shell' from 'ipc failed'", async () => {
    const browser = await listProviderProfiles()
    expect(browser.ok).toBe(false)
    if (!browser.ok) expect(browser.code).toBe("no_desktop_shell")

    installInvoke(async () => { throw new Error("ipc closed") })
    const failed = await listProviderProfiles()
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.code).toBe("ipc_failed")
      expect(failed.detail).toContain("ipc closed")
    }
  })

  it("removes a profile and reads its health record", async () => {
    installInvoke(async (command) => (command === "provider_health" ? { status: "ok", capabilityEvidence: [], checkedAt: 1, profileRevision: 1 } : null))

    const removed = await removeProviderProfile("openai")
    const health = await readProviderHealth("openai")

    expect(removed.ok).toBe(true)
    expect(health.ok).toBe(true)
    if (health.ok) expect(health.value?.status).toBe("ok")
  })
})

describe("capture the secret first, then the profile — with a rollback", () => {
  it("saves the secret first and points the profile at it", async () => {
    const commands: string[] = []
    installInvoke(async (command) => {
      commands.push(command)
      if (command === "save_secret") return "saved"
      return { ...profile, revision: 2 }
    })

    const result = await saveProfileWithSecret({ ...profile }, { secret: "sk-live-1234" })

    // 顺序有意义：密钥先落地，配置才敢指向它。
    expect(commands).toEqual(["save_secret", "upsert_provider_profile"])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.secretSaved).toBe(true)
      expect(result.profile.revision).toBe(2)
    }
  })

  it("does not write the profile when the secret cannot be stored", async () => {
    const commands: string[] = []
    installInvoke(async (command) => {
      commands.push(command)
      if (command === "save_secret") throw new Error("the credential store refused the operation")
      return profile
    })

    const result = await saveProfileWithSecret({ ...profile }, { secret: "sk-live-1234" })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("secret_failed")
    // 关键：配置**一次都没写** —— 否则会出现"配置指向一个不存在的密钥"。
    expect(commands).toEqual(["save_secret"])
  })

  it("rolls the secret back when the profile cannot be written", async () => {
    const commands: string[] = []
    installInvoke(async (command) => {
      commands.push(command)
      if (command === "save_secret") return "saved"
      if (command === "remove_secret") return null
      throw new Error("the provider configuration is not valid JSON")
    })

    const result = await saveProfileWithSecret({ ...profile }, { secret: "sk-live-1234" })

    expect(result.ok).toBe(false)
    // 回滚：不留孤儿条目在凭据库里。
    expect(commands).toEqual(["save_secret", "upsert_provider_profile", "remove_secret"])
  })

  it("skips the credential store entirely when no secret was typed", async () => {
    const commands: string[] = []
    installInvoke(async (command) => { commands.push(command); return profile })

    const result = await saveProfileWithSecret({ ...profile })

    expect(commands).toEqual(["upsert_provider_profile"])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.secretSaved).toBe(false)
  })
})

describe("capability evidence is only trusted when it is verified and current", () => {
  it("does not trust a declared capability", () => {
    const declared = { ...profile, capabilities: [{ feature: "vision", status: "declared" as const }] }
    const health = { status: "ok" as const, capabilityEvidence: [], checkedAt: 1, profileRevision: 1 }

    expect(isVerified(declared, "vision", health)).toBe(false)
  })

  it("does not trust evidence from an older revision of the profile", () => {
    const verified = { ...profile, capabilities: [{ feature: "tools", status: "verified" as const }] }
    const stale = { status: "ok" as const, capabilityEvidence: [], checkedAt: 1, profileRevision: profile.revision - 1 }

    expect(isVerified(verified, "tools", stale)).toBe(false)
  })

  it("trusts verified evidence that matches the current revision", () => {
    const verified = { ...profile, capabilities: [{ feature: "tools", status: "verified" as const, checkedAt: 5 }] }
    const health = { status: "ok" as const, capabilityEvidence: verified.capabilities, checkedAt: 5, profileRevision: profile.revision }

    expect(isVerified(verified, "tools", health)).toBe(true)
  })
})


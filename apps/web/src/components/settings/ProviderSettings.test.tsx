import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ProviderHealth, ProviderProfile } from "../../services/providerProfileClient"
import { ProviderSettings } from "./ProviderSettings"
import { slug } from "./providerSettingsFields"

/**
 * Provider 设置（Task 1.3 Step 2）。
 *
 * 计划逐条点名要断言的五件事：**标签可见** / **密钥输入不持久化** /
 * 提交有加载态与成败 / **错误可聚焦且指向字段** / **键盘可达每一项**。
 *
 * 这里用的 client 是**替身**，但替身换的是 IPC 那一层 —— 组件里的校验、顺序、
 * 清空、状态文案全部是真的。这与 `agentRuntime.test.ts` 的做法相反是有意的：
 * 那边要证明"部件能一起跑"，这边要证明"界面在这些情况下说什么"。
 */
function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: "openai",
    name: "OpenAI",
    protocol: "openai_compatible",
    dialect: "openai_native",
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-5",
    secretRef: "openai",
    capabilities: [],
    networkPolicy: "cloud",
    revision: 1,
    ...overrides
  }
}

function makeClient(
  options: {
    profiles?: ProviderProfile[]
    saveFails?: string
    health?: ProviderHealth | null
    hasSecret?: boolean
    /** 探测的结论（缺省＝探测失败，用来验证界面如实报错）。 */
    probe?: { ok: true; health: ProviderHealth } | { ok: false; detail: string }
  } = {}
) {
  const saved: Record<string, unknown>[] = []
  const checked: { profileId: string; revision: number }[] = []
  const client = {
    list: vi.fn(async () => options.profiles ?? []),
    save: vi.fn(async (candidate: Record<string, unknown>) => {
      saved.push(candidate)
      if (options.saveFails) return { ok: false as const, code: options.saveFails, detail: "the credential store refused the operation" }
      return { ok: true as const, profile: profile({ id: String(candidate.id), name: String(candidate.name), modelId: String(candidate.modelId), revision: 2 }) }
    }),
    remove: vi.fn(async () => {}),
    health: vi.fn(async () => options.health ?? null),
    hasSecret: vi.fn(async () => options.hasSecret ?? false),
    check: vi.fn(async (profileId: string, revision: number) => {
      checked.push({ profileId, revision })
      return options.probe ?? { ok: false as const, detail: "the provider could not be reached" }
    })
  }
  return { client, saved, checked }
}

async function fillBasicFields(name = "My Provider", model = "gpt-5") {
  const { fireEvent } = await import("@testing-library/react")
  fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: name } })
  fireEvent.change(screen.getByLabelText("模型名"), { target: { value: model } })
  fireEvent.change(screen.getByLabelText("接口地址"), { target: { value: "https://api.example.com/v1" } })
}

describe("provider settings", () => {
  it("gives every input a visible label instead of relying on placeholders", async () => {
    const { client } = makeClient()
    render(<ProviderSettings client={client} />)

    // `getByLabelText` 只有在**真的**有关联的 <label> 时才找得到。
    for (const label of ["预设", "显示名称", "接口地址", "模型名", "密钥"]) {
      expect(screen.getByLabelText(new RegExp(`^${label}`)), label).toBeTruthy()
    }
  })

  it("says plainly when there is no desktop shell instead of pretending to save", async () => {
    const { client } = makeClient()
    render(<ProviderSettings client={client} unavailableReason="密钥与配置需要桌面版（Windows 应用）；当前在浏览器里运行。" />)

    expect(screen.getByRole("status").textContent).toContain("桌面版")
  })

  it("keeps the secret out of the profile it sends", async () => {
    const { client, saved } = makeClient()
    const { fireEvent } = await import("@testing-library/react")
    render(<ProviderSettings client={client} />)
    await fillBasicFields()
    fireEvent.change(screen.getByLabelText(/^密钥/), { target: { value: "sk-live-1234" } })

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(saved).toHaveLength(1))
    const sent = saved[0]
    // profile 里**只有引用**；密钥本体走的是另一个入口（`save` 的 options）。
    expect(sent.secretRef).toBe("my-provider")
    expect(JSON.stringify(sent)).not.toContain("sk-live-1234")
    expect(Object.keys(sent)).not.toContain("apiKey")
    expect(Object.keys(sent)).not.toContain("secret")
  })

  it("clears the secret input after a successful save", async () => {
    const { client } = makeClient()
    const { fireEvent } = await import("@testing-library/react")
    render(<ProviderSettings client={client} />)
    await fillBasicFields()
    const secret = screen.getByLabelText(/^密钥/) as HTMLInputElement
    fireEvent.change(secret, { target: { value: "sk-live-1234" } })

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已保存"))
    expect(secret.value).toBe("")
  })

  it("shows a loading state while saving and reports the outcome afterwards", async () => {
    let release: (() => void) | null = null
    const { client } = makeClient()
    client.save = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { ok: true as const, profile: profile({ revision: 2 }) }
    })
    const { fireEvent } = await import("@testing-library/react")
    render(<ProviderSettings client={client} />)
    await fillBasicFields()

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "保存中…" })).toBeTruthy())
    expect((screen.getByRole("button", { name: "保存中…" }) as HTMLButtonElement).disabled).toBe(true)
    release!()
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已保存"))
  })

  it("refuses an empty model name and focuses the field that needs fixing", async () => {
    const { client, saved } = makeClient()
    const { fireEvent } = await import("@testing-library/react")
    render(<ProviderSettings client={client} />)
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "My Provider" } })
    fireEvent.change(screen.getByLabelText("接口地址"), { target: { value: "https://api.example.com/v1" } })
    // 模型名留空。

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0))
    // **一次 IPC 都没发**，而且焦点落在出错的字段上。
    expect(saved).toHaveLength(0)
    expect(document.activeElement).toBe(screen.getByLabelText(/^模型名/))
  })

  it("reports a failed save with a reason the user can act on", async () => {
    const { client } = makeClient({ saveFails: "secret_failed" })
    const { fireEvent } = await import("@testing-library/react")
    render(<ProviderSettings client={client} />)
    await fillBasicFields()

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("the credential store refused"))
  })

  it("lists what is already configured, with key and health state in words", async () => {
    const { client } = makeClient({
      profiles: [profile()],
      hasSecret: true,
      health: { status: "degraded", latencyMs: 900, capabilityEvidence: [], checkedAt: 5, profileRevision: 1 }
    })
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(screen.getByText("OpenAI")).toBeTruthy())
    expect(screen.getByText("已配置密钥")).toBeTruthy()
    expect(screen.getByText("不稳定")).toBeTruthy()
    // 能力徽章必须是"未验证"（没有 verified 证据）。
    expect(screen.getAllByText("工具调用未验证").length).toBeGreaterThan(0)
  })

  it("marks a capability as verified only when the evidence is verified and current", async () => {
    const verified = profile({ capabilities: [{ feature: "tools", status: "verified", checkedAt: 3 }] })
    const { client } = makeClient({
      profiles: [verified],
      health: { status: "ok", capabilityEvidence: verified.capabilities, checkedAt: 3, profileRevision: verified.revision }
    })
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(screen.getByText("工具调用已验证")).toBeTruthy())
    expect(screen.getByText("图像未验证")).toBeTruthy()
  })

  it("offers a reachable delete action for every configured service", async () => {
    const { client } = makeClient({ profiles: [profile()] })
    render(<ProviderSettings client={client} />)

    const remove = await screen.findByRole("button", { name: "删除 OpenAI" })
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(remove)

    await waitFor(() => expect(client.remove).toHaveBeenCalledWith("openai"))
  })

  it("only probes when the user asks, and says the probe costs four requests", async () => {
    // 打开设置就自动探测会在用户不知情的时候花掉他的额度。所以按钮上要写明代价。
    const { client, checked } = makeClient({ profiles: [profile()], hasSecret: true })
    render(<ProviderSettings client={client} />)

    const probe = await screen.findByRole("button", { name: "探测能力" })
    expect(probe.getAttribute("title")).toContain("4 次请求")
    // **按下去之前一次都没发。**
    expect(checked).toEqual([])

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(probe)

    await waitFor(() => expect(checked).toEqual([{ profileId: "openai", revision: 1 }]))
  })

  it("will not probe a service that has no credential, because it could only fail", async () => {
    const { client, checked } = makeClient({ profiles: [profile()], hasSecret: false })
    render(<ProviderSettings client={client} />)

    const probe = await screen.findByRole("button", { name: "探测能力" })

    expect((probe as HTMLButtonElement).disabled).toBe(true)
    expect(checked).toEqual([])
  })

  it("updates the badges from the probe and marks only the verified ones", async () => {
    const health: ProviderHealth = {
      status: "degraded",
      latencyMs: 300,
      checkedAt: 9,
      profileRevision: 1,
      capabilityEvidence: [
        { feature: "streaming", status: "verified", checkedAt: 9 },
        { feature: "tools", status: "unknown", checkedAt: undefined, detail: "the provider replied with text instead of calling the probe tool" },
        { feature: "json", status: "failed", checkedAt: 9, detail: "not a JSON object" }
      ]
    }
    const { client } = makeClient({ profiles: [profile()], hasSecret: true, probe: { ok: true, health } })
    render(<ProviderSettings client={client} />)

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(await screen.findByRole("button", { name: "探测能力" }))

    await waitFor(() => expect(screen.getByText("流式已验证")).toBeTruthy())
    // **`unknown` 不是已验证** —— 这是那一整套判据在界面上的落点。
    expect(screen.getByText("工具调用未验证")).toBeTruthy()
    expect(screen.getByText("严格 JSON未验证")).toBeTruthy()
    // 而状态说明要如实说"没验出任何能力"是**未知**，不是"不支持"。
    await waitFor(() => expect(screen.getByText(/已探测 OpenAI：流式 已验证/)).toBeTruthy())
  })

  it("reports a failed probe with the reason instead of leaving the badges silently unverified", async () => {
    const { client } = makeClient({ profiles: [profile()], hasSecret: true, probe: { ok: false, detail: "the profile has no credential stored" } })
    render(<ProviderSettings client={client} />)

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(await screen.findByRole("button", { name: "探测能力" }))

    await waitFor(() => expect(screen.getByText(/探测 OpenAI 未完成：the profile has no credential stored/)).toBeTruthy())
  })
})

describe("slug", () => {
  it("builds a stable identifier from the display name", () => {
    expect(slug("My Provider")).toBe("my-provider")
    expect(slug("  OpenAI  ")).toBe("openai")
  })

  it("falls back to a generic id for a name that has no ascii characters", () => {
    // 中文名字也要能用 —— 回退成一个稳定值，而不是空 id（空 id 会被后端拒）。
    expect(slug("我的服务")).toBe("profile")
  })

  it("returns nothing when there is no name at all, so validation can catch it", () => {
    expect(slug("   ")).toBe("")
  })
})

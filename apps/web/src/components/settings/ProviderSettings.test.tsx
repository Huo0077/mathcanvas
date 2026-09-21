import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ProviderHealth, ProviderProfile } from "../../services/providerProfileClient"
import { ProviderSettings } from "./ProviderSettings"
import { HEALTH_LABELS, PRESETS, reasonFor, slug } from "./providerSettingsFields"

/**
 * **模型服务**（Task 1.3 Step 5 / Task 1.4 Step 5）。
 *
 * ## 这一轮（2026-09-21）界面重做成 CC Switch 那种清单
 *
 * 用户口径："有加号可以添加 apikey，添加完成并且通过验证之后，在界面可以出现
 * 刚刚填入的一栏，能同时存在很多栏，并且能够主动在不同的模型中进行切换"。
 *
 * 所以这一组用例的重心也跟着变了。除了原来那五条（标签可见 / 密钥不进 profile /
 * 加载态 / 错误指向字段 / 键盘可达），这里还钉住三件事：
 * 1. **表单默认收起**（清单是主角，而不是一张永远占着半屏的表单）；
 * 2. **验证通过的结论会落到那一栏的徽章上**，而 `unknown`/`failed` **不算已验证**；
 * 3. **切换只改"用哪个"**，不碰任何配置，也不默认选第一份。
 *
 * 替身换的是 IPC 那一层，组件里的校验、顺序、清空、状态文案全部是真的。
 */
function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  const id = overrides.id ?? "openai"
  return {
    id,
    name: "OpenAI",
    protocol: "openai_compatible",
    dialect: "openai_native",
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-5",
    // **`secretRef` 跟着 id 走**：它是凭据库里那一格的名字。写死成 "openai" 会让
    // 第二份配置去查第一份的密钥格，而那正是"两栏看起来都有密钥"的来源。
    secretRef: id,
    capabilities: [],
    networkPolicy: "cloud",
    revision: 1,
    ...overrides
  }
}

function health(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return { status: "ok", latencyMs: 120, capabilityEvidence: [], checkedAt: 9, profileRevision: 1, ...overrides }
}

interface ClientOptions {
  profiles?: ProviderProfile[]
  saveFails?: string
  record?: Record<string, ProviderHealth | null>
  keyed?: Record<string, boolean>
  active?: string | null
  probe?: Record<string, { ok: true; health: ProviderHealth } | { ok: false; detail: string }>
  forgetSecretFails?: boolean
}

function makeClient(options: ClientOptions = {}) {
  const saved: Record<string, unknown>[] = []
  const savedSecrets: { profileId: string; secret: string }[] = []
  const checked: { profileId: string; revision: number }[] = []
  const selected: string[] = []
  /**
   * 替身**真的记住**刚才写了什么。
   *
   * 界面在保存之后会重新拉一次列表 —— 一个不记住的替身会让"保存之后那一栏出现"
   * 这件事永远测不出来，而"那一栏出现"正是用户口径里最要紧的一步。
   */
  const committed: ProviderProfile[] = [...(options.profiles ?? [])]
  /**
   * 替身也**记住验证结论** —— 真实现里 `provider_check` 会把证据写进存储，
   * 而界面保存之后会重新拉一次健康记录。不记住的话，"验证通过之后徽章亮起来"
   * 这件事看起来像失败，其实是替身没把状态存下来。
   */
  const recorded: Record<string, ProviderHealth> = {}
  for (const [id, entry] of Object.entries(options.record ?? {})) {
    if (entry) recorded[id] = entry
  }

  const client = {
    list: vi.fn(async () => committed),
    save: vi.fn(async (candidate: Record<string, unknown>, saveOptions: { secret?: string; expectedRevision?: number }) => {
      saved.push(candidate)
      if (saveOptions.secret) savedSecrets.push({ profileId: String(candidate.id), secret: saveOptions.secret })
      if (options.saveFails) return { ok: false as const, code: options.saveFails, detail: "the credential store refused the operation" }
      const written = profile({ id: String(candidate.id), name: String(candidate.name), modelId: String(candidate.modelId), revision: 2 })
      const existing = committed.findIndex((entry) => entry.id === written.id)
      if (existing >= 0) committed[existing] = written
      else committed.push(written)
      return { ok: true as const, profile: written }
    }),
    remove: vi.fn(async () => {}),
    forgetSecret: vi.fn(async () => {
      if (options.forgetSecretFails) throw new Error("the credential store is unavailable")
    }),
    health: vi.fn(async (profileId: string) => recorded[profileId] ?? null),
    hasSecret: vi.fn(async (profileId: string) => options.keyed?.[profileId] ?? false),
    check: vi.fn(async (profileId: string, revision: number) => {
      checked.push({ profileId, revision })
      const outcome = options.probe?.[profileId] ?? { ok: false as const, detail: "the provider could not be reached" }
      if (outcome.ok) {
        // 真实现把**这次探测时的修订号**写进证据；替身照做 —— 否则"证据属于哪一版"
        // 这条判据在测试里永远对不上。
        recorded[profileId] = { ...outcome.health, profileRevision: outcome.health.profileRevision || revision }
      } else {
        // **探不通就没有新证据**：真实现不会写记录，而留着上一次的结论会让界面
        // 一直显示一份已经不成立的"已验证"。
        delete recorded[profileId]
      }
      return outcome
    }),
    select: vi.fn(async (profileId: string) => {
      selected.push(profileId)
    }),
    active: vi.fn(async () => options.active ?? null)
  }
  return { client, saved, savedSecrets, checked, selected }
}

/** 打开"添加"表单并填好一份最小的配置。 */
async function fillNewProfile(name = "DeepSeek", model = "deepseek-chat", secret = "sk-test-0001") {
  const { fireEvent } = await import("@testing-library/react")
  fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }))
  fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: name } })
  fireEvent.change(screen.getByLabelText("模型名"), { target: { value: model } })
  fireEvent.change(screen.getByLabelText(/接口地址/), { target: { value: "https://api.example.com/v1" } })
  fireEvent.change(screen.getByLabelText(/API key/), { target: { value: secret } })
}

/** 一条用例画完就清干净：这条文件里同一段文字会在很多用例里出现，残留的 DOM 会让
 * `getByText` 报"找到多个"，而那个错误看起来像组件的问题。 */
afterEach(() => cleanup())

describe("adding a model service", () => {
  it("keeps the form out of the way until the plus button is pressed", async () => {
    // 清单是主角。一张永远占着半屏的空表单会让"我现在有哪些配置"变得不好读。
    const { client } = makeClient()
    render(<ProviderSettings client={client} />)

    expect(screen.queryByLabelText("显示名称")).toBeNull()
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }))

    expect(screen.getByLabelText("显示名称")).toBeTruthy()
    expect(screen.getByRole("button", { name: "添加模型服务" }).getAttribute("aria-expanded")).toBe("true")
  })

  it("gives every field a visible label instead of relying on placeholders", async () => {
    const { client } = makeClient()
    render(<ProviderSettings client={client} />)
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }))

    // `getByLabelText` 只有在**真的**有关联的 <label> 时才找得到。
    for (const label of ["预设", "显示名称", "接口地址", "模型名", "API key"]) {
      expect(screen.getByLabelText(new RegExp(`^${label}`)), label).toBeTruthy()
    }
  })

  it("says plainly when there is no desktop shell instead of pretending to save", async () => {
    const { client } = makeClient()
    render(<ProviderSettings client={client} unavailableReason="密钥与配置需要桌面版（Windows 应用）；当前在浏览器里运行。" />)

    expect(screen.getAllByRole("status").map((node) => node.textContent ?? "").join(" ")).toContain("桌面版")
    // **不去问 IPC**：在浏览器里跑是正常状态，而一条 `no_desktop_shell: …` 的原始报错
    // 会把一件正常的事显示成故障。
    expect(client.list).not.toHaveBeenCalled()
  })

  it("keeps the secret out of the profile it sends", async () => {
    const { client, saved, savedSecrets } = makeClient()
    render(<ProviderSettings client={client} />)
    await fillNewProfile()

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    await waitFor(() => expect(saved.length).toBe(1))
    // 配置里**只有引用**：密钥本体走凭据库，profile 对象里没有任何能装密钥的位置。
    const serialized = JSON.stringify(saved[0])
    for (const forbidden of ["sk-test-0001", '"secret"', "apiKey", "api_key", "Authorization"]) {
      expect(serialized, forbidden).not.toContain(forbidden)
    }
    expect(savedSecrets).toEqual([{ profileId: "deepseek", secret: "sk-test-0001" }])
  })

  it("clears the secret input after a successful save", async () => {
    // 计划 Step 4："Clear the input after a successful save" —— 清空是一个函数，不是一句口号。
    const { client } = makeClient()
    render(<ProviderSettings client={client} />)
    await fillNewProfile()

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    // 保存成功之后表单收起，所以"清空"这件事由**重新打开表单时输入框是空的**来证明。
    await waitFor(() => expect(screen.queryByLabelText("显示名称")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }))
    expect((screen.getByLabelText(/API key/) as HTMLInputElement).value).toBe("")
  })

  it("refuses an empty model name instead of saving something that cannot be used", async () => {
    const { client, saved } = makeClient()
    render(<ProviderSettings client={client} />)
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }))
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "DeepSeek" } })
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "sk-x" } })
    fireEvent.change(screen.getByLabelText(/接口地址/), { target: { value: "https://api.example.com/v1" } })

    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    expect(screen.getAllByRole("alert").map((node) => node.textContent ?? "").join(" ")).toContain("模型名")
    expect(saved).toEqual([])
  })

  it("refuses to add a service with no credential, because it could only ever fail", async () => {
    const { client, saved } = makeClient()
    render(<ProviderSettings client={client} />)
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }))
    fireEvent.change(screen.getByLabelText("显示名称"), { target: { value: "DeepSeek" } })
    fireEvent.change(screen.getByLabelText("模型名"), { target: { value: "deepseek-chat" } })
    fireEvent.change(screen.getByLabelText(/接口地址/), { target: { value: "https://api.example.com/v1" } })

    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    expect(screen.getAllByRole("alert").map((node) => node.textContent ?? "").join(" ")).toContain("API key")
    expect(saved).toEqual([])
  })

  it("reports a failed save with a reason the user can act on", async () => {
    const { client } = makeClient({ saveFails: "secret_not_allowed" })
    render(<ProviderSettings client={client} />)
    await fillNewProfile()

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("不能带密钥字段"))
  })

  it("verifies the service it just added and only then calls it usable", async () => {
    // 用户口径："添加完成并且通过验证之后，在界面可以出现刚刚填入的一栏"。
    const { client, checked } = makeClient({
      probe: {
        deepseek: {
          ok: true,
          health: health({ profileRevision: 2, capabilityEvidence: [{ feature: "streaming", status: "verified", checkedAt: 9 }] })
        }
      }
    })
    render(<ProviderSettings client={client} />)
    await fillNewProfile()

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    await waitFor(() => expect(checked).toEqual([{ profileId: "deepseek", revision: 2 }]))
    await waitFor(() => expect(screen.getByText(/通过验证：流式 已验证/)).toBeTruthy())
    await waitFor(() => expect(screen.getByText("流式已验证")).toBeTruthy())
  })

  it("keeps the new row visible when verification does not pass, and says why", async () => {
    // 配置是真的存下来了。把已经存下来的东西藏起来比显示一条红的更让人困惑。
    const { client } = makeClient({ probe: { deepseek: { ok: false, detail: "the provider rejected the credential (401)" } } })
    render(<ProviderSettings client={client} />)
    await fillNewProfile()

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    await waitFor(() => expect(screen.getByText(/未通过验证：the provider rejected the credential/)).toBeTruthy())
  })

  it("selects the first service automatically, because that is the obvious next step", async () => {
    const { client, selected } = makeClient({ probe: { deepseek: { ok: true, health: health({ profileRevision: 2 }) } } })
    render(<ProviderSettings client={client} />)
    await fillNewProfile()

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(screen.getByRole("button", { name: /保存并验证/ }))

    await waitFor(() => expect(selected).toEqual(["deepseek"]))
  })
})

describe("the list of model services", () => {
  it("shows one row per service with its key and health state in words", async () => {
    const { client } = makeClient({
      profiles: [profile(), profile({ id: "deepseek", name: "DeepSeek", modelId: "deepseek-chat" })],
      keyed: { openai: true, deepseek: false },
      record: { openai: health({ status: "degraded" }) }
    })
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(screen.getByText("OpenAI")).toBeTruthy())
    expect(screen.getByText("DeepSeek")).toBeTruthy()
    expect(screen.getByText(/^2 个配置/)).toBeTruthy()
    expect(screen.getByText("已配置密钥")).toBeTruthy()
    expect(screen.getByText("未配置密钥")).toBeTruthy()
    // 状态词本身就是信息：`degraded` 读作"部分可用"，而不是"正常"或"失败"。
    expect(screen.getByText(HEALTH_LABELS.degraded)).toBeTruthy()
  })

  it("offers an empty state that leads somewhere", async () => {
    const { client } = makeClient()
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(screen.getByText("还没有配置任何模型服务。")).toBeTruthy())
    expect(screen.getByRole("button", { name: /添加第一个/ })).toBeTruthy()
  })

  it("marks the capability verified only when the evidence is verified and current", async () => {
    const verified = profile({ capabilities: [{ feature: "tools", status: "verified", checkedAt: 3 }] })
    const stale = profile({ id: "deepseek", name: "DeepSeek", capabilities: [{ feature: "tools", status: "verified", checkedAt: 3 }] })
    const { client } = makeClient({
      profiles: [verified, stale],
      record: {
        openai: health({ capabilityEvidence: verified.capabilities, profileRevision: verified.revision }),
        // 证据属于**上一版**配置：它不该被采信。
        deepseek: health({ capabilityEvidence: stale.capabilities, profileRevision: stale.revision - 1 })
      }
    })
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(screen.getByText("工具调用已验证")).toBeTruthy())
    // 而那一份的四个徽章全是"未验证"（含工具调用）。
    expect(document.querySelectorAll('[data-badge="capability"][data-feature="tools"][data-verified="false"]').length).toBe(1)
  })

  it("does not call a declared capability verified", async () => {
    const declared = profile({ capabilities: [{ feature: "vision", status: "declared" }] })
    const { client } = makeClient({ profiles: [declared], record: { openai: health() } })
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(screen.getByText("图像未验证")).toBeTruthy())
  })

  it("says which service is in use and refuses to switch to the one already in use", async () => {
    const { client } = makeClient({ profiles: [profile()], active: "openai" })
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(document.querySelector('[data-badge="active"]')).toBeTruthy())
    expect(screen.getByText(/正在使用 OpenAI/)).toBeTruthy()
    const button = screen.getByRole("button", { name: "OpenAI 正在使用" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it("switches between services without touching any configuration", async () => {
    // "在不同模型之间主动切换"就是改一个字段：切换**不该**顺带改任何 profile。
    const { client, selected, saved } = makeClient({
      profiles: [profile(), profile({ id: "deepseek", name: "DeepSeek" })],
      active: "openai"
    })
    render(<ProviderSettings client={client} />)

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(await screen.findByRole("button", { name: "使用 DeepSeek" }))

    await waitFor(() => expect(selected).toEqual(["deepseek"]))
    // 切换**不该**顺带写任何配置（能力证据挂在修订号上，切换推高修订号会把徽章全清掉）。
    expect(saved).toEqual([])
  })

  it("does not claim a service is in use when nothing has been chosen yet", async () => {
    // 默认选第一份会让"我还没选"与"我选了第一份"变成同一件事。
    const { client } = makeClient({ profiles: [profile()], active: null })
    render(<ProviderSettings client={client} />)

    await waitFor(() => expect(screen.getByText(/还没有选择使用哪一个/)).toBeTruthy())
    expect(document.querySelector('[data-badge="active"]')).toBeNull()
  })

  it("takes the credential out of the credential store when the service is deleted", async () => {
    const { client } = makeClient({ profiles: [profile()], keyed: { openai: true } })
    render(<ProviderSettings client={client} />)

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(await screen.findByRole("button", { name: "删除 OpenAI" }))

    await waitFor(() => expect(client.remove).toHaveBeenCalledWith("openai"))
    // 删的是这个 profile 的 `secretRef`（它是凭据库里的那一格的名字）。
    await waitFor(() => expect(client.forgetSecret).toHaveBeenCalledWith("openai"))
  })

  it("still deletes the service when the credential store cannot be reached", async () => {
    // 密钥库碰不到时**不能把删除也一起卡住**；但也不假装干净了。
    const { client } = makeClient({ profiles: [profile()], keyed: { openai: true }, forgetSecretFails: true })
    render(<ProviderSettings client={client} />)

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(await screen.findByRole("button", { name: "删除 OpenAI" }))

    await waitFor(() => expect(client.remove).toHaveBeenCalledWith("openai"))
    await waitFor(() => expect(screen.getByText(/配置已删除/)).toBeTruthy())
    expect(screen.getByText(/密钥可能还在/)).toBeTruthy()
  })

  it("only verifies when the user asks, and says the verification costs four requests", async () => {
    const { client, checked } = makeClient({ profiles: [profile()], keyed: { openai: true } })
    render(<ProviderSettings client={client} />)

    const verifyButton = await screen.findByRole("button", { name: "验证 OpenAI" })
    expect(verifyButton.getAttribute("title")).toContain("4 次请求")
    // **按下去之前一次都没发。**
    expect(checked).toEqual([])

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(verifyButton)

    await waitFor(() => expect(checked).toEqual([{ profileId: "openai", revision: 1 }]))
  })

  it("will not verify a service that has no credential, because it could only fail", async () => {
    const { client, checked } = makeClient({ profiles: [profile()], keyed: { openai: false } })
    render(<ProviderSettings client={client} />)

    const verifyButton = (await screen.findByRole("button", { name: "验证 OpenAI" })) as HTMLButtonElement

    expect(verifyButton.disabled).toBe(true)
    expect(checked).toEqual([])
  })

  it("updates the badges from verification and reports a failure with its reason", async () => {
    const { client } = makeClient({
      profiles: [profile(), profile({ id: "deepseek", name: "DeepSeek" })],
      keyed: { openai: true, deepseek: true },
      probe: {
        openai: {
          ok: true,
          health: health({
            status: "degraded",
            // 证据必须属于**当前修订号**（这里是 1），否则它在界面上不算数。
            profileRevision: 1,
            capabilityEvidence: [
              { feature: "streaming", status: "verified", checkedAt: 9 },
              { feature: "tools", status: "unknown", detail: "the provider replied with text instead of calling the probe tool" },
              { feature: "json", status: "failed", checkedAt: 9, detail: "not a JSON object" }
            ]
          })
        },
        deepseek: { ok: false, detail: "the profile deepseek has no credential stored" }
      }
    })
    render(<ProviderSettings client={client} />)

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(await screen.findByRole("button", { name: "验证 OpenAI" }))

    await waitFor(() => expect(screen.getByText("流式已验证")).toBeTruthy())
    /**
     * **`unknown` 不是已验证** —— 这是那一整套判据在界面上的落点。
     *
     * 断言按**这一栏自己的徽章**来，而不是按"页面上有没有这段文字"：
     * DeepSeek 那一栏还没验证过，它的四个徽章也全是"未验证"，
     * 所以同一段文字在页面上本来就会出现不止一次。
     */
    const badgeOf = (profileId: string, feature: string) =>
      document.querySelector(`li[data-profile-id="${profileId}"] [data-feature="${feature}"]`)
    expect(badgeOf("openai", "tools")?.textContent).toContain("未验证")
    expect(badgeOf("openai", "json")?.textContent).toContain("未验证")
    // 而"流式"那一栏确实是已验证 —— 同一份证据里两档状态同时存在。
    expect(badgeOf("openai", "streaming")?.textContent).toContain("已验证")

    fireEvent.click(screen.getByRole("button", { name: "验证 DeepSeek" }))
    await waitFor(() => expect(screen.getByText(/未通过验证：the profile deepseek has no credential stored/)).toBeTruthy())
  })

  it("opens the editor prefilled with the service it is editing", async () => {
    const { client } = makeClient({ profiles: [profile()], keyed: { openai: true } })
    render(<ProviderSettings client={client} />)

    const { fireEvent } = await import("@testing-library/react")
    fireEvent.click(await screen.findByRole("button", { name: "编辑 OpenAI" }))

    expect((screen.getByLabelText("显示名称") as HTMLInputElement).value).toBe("OpenAI")
    expect((screen.getByLabelText("模型名") as HTMLInputElement).value).toBe("gpt-5")
    // 编辑时密钥留空表示不改，而提示要说明这一点。
    expect(screen.getByLabelText(/API key/).getAttribute("placeholder")).toContain("保持现有密钥")
  })
})

describe("slug and reasons", () => {
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

  it("tells the user what to do about each failure code", () => {
    expect(reasonFor("no_desktop_shell", "x")).toContain("桌面版")
    expect(reasonFor("secret_not_allowed", "x")).toContain("API key")
    expect(reasonFor("ipc_failed", "connection reset")).toContain("connection reset")
    expect(reasonFor("anything_else", "the detail")).toBe("the detail")
  })

  it("keeps every preset that has an address pointing at https for cloud services", () => {
    // 云端必须 https 这条判据在 Rust 侧也查一遍，但预设这一层就不该给出 http 的云端地址。
    // 「自定义」那条的地址是**空的**（等用户填），所以它不在这条判据里。
    for (const preset of PRESETS.filter((candidate) => candidate.networkPolicy === "cloud" && candidate.baseUrl.length > 0)) {
      expect(preset.baseUrl.startsWith("https://"), preset.label).toBe(true)
    }
  })
})

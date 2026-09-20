import { useCallback, useEffect, useId, useRef, useState } from "react"

import { clearSecretInput, hasSecret } from "../../services/secretClient"
import { reasonFor, slug } from "./providerSettingsFields"
import {
  isVerified,
  listProviderProfiles,
  readProviderHealth,
  removeProviderProfile,
  saveProfileWithSecret,
  type NetworkPolicy,
  type ProviderHealth,
  type ProviderProfile,
  type ProviderProtocol
} from "../../services/providerProfileClient"

/**
 * **Provider 设置**（Task 1.3 Step 5，CC Switch 风格的配置列表）。
 *
 * 计划 Step 2 点名的五条，逐条落在这里：
 * 1. **标签可见** —— 每个输入都有 `<label>`（不是靠 placeholder 当标签）；
 * 2. **密钥输入不持久化** —— 它只是一个 `useState`，**从不**进 localStorage、
 *    也**从不**进 profile 对象（profile 里只有 `secretRef`）；
 * 3. **提交有加载态与成败** —— 按钮在等待时禁用并显示"保存中"，成败各有文字；
 * 4. **错误可聚焦、并指向字段** —— 错误摘要是一条 `role="alert"`，且每个字段
 *    自己的错误紧挨着输入（`aria-describedby`），点摘要里那一条会把焦点移到对应输入；
 * 5. **键盘可达每一件事** —— 全部用原生 `<button>` / `<input>` / `<select>`，
 *    没有需要自己实现键盘语义的自定义控件。
 *
 * ## 一条刻意的取舍：这个界面**不测试连接**
 *
 * 计划 Step 5 提到 "test connection"，但真实连通性要等 Task 1.5 的回环代理
 * （密钥不能到前端来，所以请求必须由 Rust 侧发）。在那之前放一个"测试连接"按钮
 * 只能有两种结局：**假装成功**，或者**永远失败**。两者都比没有更糟 —— 所以这里
 * 只显示**已有的健康证据**（`ProviderHealth`），并如实标"未验证"。
 */

export interface ProviderSettingsProps {
  /** 测试注入用；缺省走真实 IPC。 */
  client?: {
    list(): Promise<ProviderProfile[]>
    save(profile: Record<string, unknown>, options: { secret?: string; expectedRevision?: number }): Promise<{ ok: true; profile: ProviderProfile } | { ok: false; code: string; detail: string }>
    remove(profileId: string): Promise<void>
    health(profileId: string): Promise<ProviderHealth | null>
    hasSecret(profileId: string): Promise<boolean>
  }
  /** 后端不可用时的说明（浏览器里跑就是这种情况）。 */
  unavailableReason?: string
}

/** 预设：常见服务的协议 / 方言 / 基址。**只有这三样**，模型名留给用户填。 */
const PRESETS: { label: string; protocol: ProviderProtocol; dialect: ProviderProfile["dialect"]; baseUrl: string; networkPolicy: NetworkPolicy }[] = [
  { label: "OpenAI", protocol: "openai_compatible", dialect: "openai_native", baseUrl: "https://api.openai.com/v1", networkPolicy: "cloud" },
  { label: "DeepSeek", protocol: "openai_compatible", dialect: "deepseek", baseUrl: "https://api.deepseek.com/v1", networkPolicy: "cloud" },
  { label: "Anthropic", protocol: "anthropic", dialect: "anthropic_messages", baseUrl: "https://api.anthropic.com/v1", networkPolicy: "cloud" },
  { label: "Ollama（本机）", protocol: "ollama", dialect: "ollama_native", baseUrl: "http://127.0.0.1:11434/v1", networkPolicy: "local" },
  { label: "自定义", protocol: "openai_compatible", dialect: "generic_compatible", baseUrl: "", networkPolicy: "cloud" }
]

const FEATURE_LABELS: Record<string, string> = { tools: "工具调用", json: "严格 JSON", vision: "图像", streaming: "流式" }
const HEALTH_LABELS: Record<ProviderHealth["status"], string> = { unknown: "未检测", ok: "正常", degraded: "不稳定", failed: "失败" }

interface FieldErrors {
  id?: string
  name?: string
  baseUrl?: string
  modelId?: string
  secret?: string
  general?: string
}

export function ProviderSettings({ client, unavailableReason }: ProviderSettingsProps) {
  const realClient = useRef({
    list: async () => {
      const result = await listProviderProfiles()
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
      return result.value
    },
    save: async (profile: Record<string, unknown>, options: { secret?: string; expectedRevision?: number }) => {
      const result = await saveProfileWithSecret(profile, options)
      return result.ok ? { ok: true as const, profile: result.profile } : { ok: false as const, code: result.code, detail: result.detail }
    },
    remove: async (profileId: string) => {
      const result = await removeProviderProfile(profileId)
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
    },
    health: async (profileId: string) => {
      const result = await readProviderHealth(profileId)
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
      return result.value
    },
    hasSecret: async (profileId: string) => {
      const result = await hasSecret(profileId)
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
      return result.value
    }
  })
  const api = client ?? realClient.current

  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [health, setHealth] = useState<Record<string, ProviderHealth | null>>({})
  const [keyPresent, setKeyPresent] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string>("")
  const [presetIndex, setPresetIndex] = useState(0)
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [modelId, setModelId] = useState("")
  const [secret, setSecret] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "failed"; message: string }>({ kind: "idle", message: "" })
  const secretInput = useRef<HTMLInputElement>(null)
  const errorRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const fieldId = useId()

  const refresh = useCallback(async () => {
    try {
      const loaded = await api.list()
      setProfiles(loaded)
      const nextHealth: Record<string, ProviderHealth | null> = {}
      const nextKey: Record<string, boolean> = {}
      for (const profile of loaded) {
        nextHealth[profile.id] = await api.health(profile.id)
        nextKey[profile.id] = profile.secretRef ? await api.hasSecret(profile.secretRef) : false
      }
      setHealth(nextHealth)
      setKeyPresent(nextKey)
    } catch (error) {
      setErrors({ general: error instanceof Error ? error.message : String(error) })
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  const preset = PRESETS[presetIndex]
  const editing = profiles.find((profile) => profile.id === selectedId)

  function applyPreset(index: number): void {
    setPresetIndex(index)
    const next = PRESETS[index]
    setBaseUrl(next.baseUrl)
    // 预设只带协议与基址；模型名与名字留给用户 —— 猜一个模型名比留空更糟。
  }

  function startNew(): void {
    setSelectedId("")
    setName("")
    setModelId("")
    setSecret("")
    applyPreset(presetIndex)
    setErrors({})
    setStatus({ kind: "idle", message: "" })
  }

  function startEdit(profile: ProviderProfile): void {
    setSelectedId(profile.id)
    setName(profile.name)
    setBaseUrl(profile.baseUrl)
    setModelId(profile.modelId)
    setSecret("")
    const index = PRESETS.findIndex((candidate) => candidate.protocol === profile.protocol && candidate.dialect === profile.dialect)
    if (index >= 0) setPresetIndex(index)
    setErrors({})
    setStatus({ kind: "idle", message: "" })
  }

  /** 本地前置校验：**在**发 IPC 之前，把能说清的错误说清楚。 */
  function validate(): FieldErrors {
    const found: FieldErrors = {}
    const id = editing ? editing.id : slug(name)
    if (id.length === 0) found.id = "请先填一个显示名称（它会用来生成标识）"
    if (name.trim().length === 0) found.name = "显示名称不能为空"
    if (modelId.trim().length === 0) found.modelId = "模型名不能为空"
    if (baseUrl.trim().length === 0) found.baseUrl = "接口地址不能为空"
    else {
      try {
        const parsed = new URL(baseUrl.trim())
        if (presetIndex !== PRESETS.length - 1 && parsed.protocol !== "https:" && preset.networkPolicy === "cloud") found.baseUrl = "云端端点必须用 https；本机或局域网请选对应预设"
      } catch {
        found.baseUrl = "接口地址必须是完整的绝对地址（含 https://）"
      }
    }
    return found
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const found = validate()
    if (Object.keys(found).length > 0) {
      setErrors(found)
      setStatus({ kind: "failed", message: "有字段需要先修正" })
      // 错误可聚焦：把焦点移到第一个出错的输入。
      const first = Object.keys(found)[0]
      errorRefs.current[first]?.focus()
      return
    }

    setErrors({})
    setStatus({ kind: "saving", message: "保存中…" })
    const id = editing ? editing.id : slug(name)
    const profile = {
      id,
      name: name.trim(),
      protocol: preset.protocol,
      dialect: preset.dialect,
      baseUrl: baseUrl.trim(),
      modelId: modelId.trim(),
      // **只有引用**：密钥本体走凭据库，profile 里永远只有这个名字。
      secretRef: id,
      capabilities: editing?.capabilities ?? [],
      networkPolicy: preset.networkPolicy,
      revision: editing?.revision ?? 0
    }

    const result = await api.save(profile, { secret, expectedRevision: editing?.revision })
    if (!result.ok) {
      setStatus({ kind: "failed", message: reasonFor(result.code, result.detail) })
      setErrors({ general: reasonFor(result.code, result.detail) })
      return
    }

    // 计划 Step 4："Clear the input after a successful save" —— 清空是一个函数，不是一句口号。
    clearSecretInput(secretInput.current)
    setSecret("")
    setSelectedId(result.profile.id)
    setStatus({ kind: "saved", message: `已保存 ${result.profile.name}（第 ${result.profile.revision} 版）` })
    await refresh()
  }

  async function remove(profile: ProviderProfile): Promise<void> {
    try {
      await api.remove(profile.id)
      if (selectedId === profile.id) startNew()
      setStatus({ kind: "saved", message: `已删除 ${profile.name}` })
      await refresh()
    } catch (error) {
      setStatus({ kind: "failed", message: error instanceof Error ? error.message : String(error) })
    }
  }

  return <section className="provider-settings" aria-label="模型服务设置">
    <header className="provider-settings-head">
      <h3>模型服务</h3>
      <p className="provider-settings-hint">
        密钥保存在 Windows 凭据管理器里，配置里只有它的**名字**（不落盘、不进日志）。
      </p>
      {unavailableReason && <p className="provider-settings-unavailable" role="status">{unavailableReason}</p>}
    </header>

    {errors.general && <p className="provider-settings-error" role="alert">
      {errors.general}
      <button type="button" onClick={() => errorRefs.current.name?.focus()}>去修正</button>
    </p>}

    <ul className="provider-settings-list" aria-label="已配置的服务">
      {profiles.map((profile) => <li key={profile.id} data-profile-id={profile.id} data-selected={profile.id === selectedId}>
        <button type="button" className="provider-settings-pick" aria-pressed={profile.id === selectedId} onClick={() => startEdit(profile)}>
          {profile.name}
        </button>
        <span className="provider-settings-badges">
          <span data-badge="protocol">{profile.protocol}</span>
          <span data-badge="key" data-present={keyPresent[profile.id] === true}>
            {keyPresent[profile.id] ? "已配置密钥" : "未配置密钥"}
          </span>
          <span data-badge="health" data-health={health[profile.id]?.status ?? "unknown"}>
            {HEALTH_LABELS[health[profile.id]?.status ?? "unknown"]}
          </span>
          {/* 能力徽章：**只有 verified 才算**（declared 是"文档里说支持"）。 */}
          {["tools", "json", "vision", "streaming"].map((feature) => <span key={feature} data-badge="capability" data-feature={feature} data-verified={isVerified(profile, feature, health[profile.id] ?? null)}>
            {FEATURE_LABELS[feature]}{isVerified(profile, feature, health[profile.id] ?? null) ? "已验证" : "未验证"}
          </span>)}
        </span>
        <button type="button" onClick={() => void remove(profile)} aria-label={`删除 ${profile.name}`}>删除</button>
      </li>)}
      {profiles.length === 0 && <li className="provider-settings-empty">还没有配置任何模型服务。</li>}
    </ul>

    <form className="provider-settings-form" onSubmit={(event) => void submit(event)} noValidate>
      <h4>{editing ? `编辑 ${editing.name}` : "新增服务"}</h4>

      <p className="provider-settings-field">
        <label htmlFor={`${fieldId}-preset`}>预设</label>
        <select id={`${fieldId}-preset`} value={presetIndex} onChange={(event) => applyPreset(Number(event.target.value))}>
          {PRESETS.map((candidate, index) => <option key={candidate.label} value={index}>{candidate.label}</option>)}
        </select>
      </p>

      <p className="provider-settings-field">
        <label htmlFor={`${fieldId}-name`}>显示名称</label>
        <input
          id={`${fieldId}-name`}
          ref={(node) => { errorRefs.current.name = node }}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={errors.name || errors.id ? true : undefined}
          aria-describedby={errors.name || errors.id ? `${fieldId}-name-error` : undefined}
        />
        {(errors.name || errors.id) && <span id={`${fieldId}-name-error`} className="provider-settings-field-error" role="alert">{errors.name ?? errors.id}</span>}
      </p>

      <p className="provider-settings-field">
        <label htmlFor={`${fieldId}-base-url`}>接口地址</label>
        <input
          id={`${fieldId}-base-url`}
          ref={(node) => { errorRefs.current.baseUrl = node }}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          aria-invalid={errors.baseUrl ? true : undefined}
          aria-describedby={errors.baseUrl ? `${fieldId}-base-url-error` : undefined}
        />
        {errors.baseUrl && <span id={`${fieldId}-base-url-error`} className="provider-settings-field-error" role="alert">{errors.baseUrl}</span>}
      </p>

      <p className="provider-settings-field">
        <label htmlFor={`${fieldId}-model`}>模型名</label>
        <input
          id={`${fieldId}-model`}
          ref={(node) => { errorRefs.current.modelId = node }}
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          aria-invalid={errors.modelId ? true : undefined}
          aria-describedby={errors.modelId ? `${fieldId}-model-error` : undefined}
        />
        {errors.modelId && <span id={`${fieldId}-model-error`} className="provider-settings-field-error" role="alert">{errors.modelId}</span>}
      </p>

      <p className="provider-settings-field">
        <label htmlFor={`${fieldId}-secret`}>密钥{editing && keyPresent[editing.id] ? "（已配置，留空表示不改）" : ""}</label>
        <input
          id={`${fieldId}-secret`}
          ref={secretInput}
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          aria-describedby={`${fieldId}-secret-hint`}
        />
        <span id={`${fieldId}-secret-hint`} className="provider-settings-hint">保存后这个输入框会被清空；密钥只进凭据管理器。</span>
      </p>

      <div className="provider-settings-actions">
        <button type="submit" disabled={status.kind === "saving"}>
          {status.kind === "saving" ? "保存中…" : "保存"}
        </button>
        <button type="button" onClick={startNew}>新建</button>
      </div>
      {status.kind === "saved" && <p className="provider-settings-status" role="status">{status.message}</p>}
      {status.kind === "failed" && <p className="provider-settings-status" role="status">{status.message}</p>}
    </form>
  </section>
}



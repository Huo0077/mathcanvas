/**
 * **新增 / 编辑一份模型服务**（Task 1.3 Step 5，CC Switch 风格的添加表单）。
 *
 * ## 这一层只做表单，不做布局
 *
 * 它与「列表」分开住（`ProviderSettings.tsx`），因为两者的关注点不同：
 * 列表管"有哪些、用哪个、能不能连"，表单管"这些字段怎么填、错了怎么指出"。
 * 挤在一个文件里时，改布局会碰到校验、改校验会碰到布局。
 *
 * ## 表单里的五条纪律（计划 Step 2 逐条点名）
 *
 * 1. **标签可见**：每个输入都有自己的 `<label>`，不靠 placeholder 当标签；
 * 2. **密钥输入不持久化**：它只是一个 `useState`，从不进 localStorage、也从不进 profile 对象
 *   （profile 里只有 `secretRef`）；
 * 3. **提交有加载态与成败**：按钮在等待时禁用并改文案；
 * 4. **错误可聚焦并指向字段**：错误摘要是一条 `role="alert"`，每个字段自己的错误紧挨输入
 *   （`aria-describedby`），点摘要里那一条会把焦点移到对应输入；
 * 5. **键盘可达每一件事**：全部用原生控件，没有需要自己实现键盘语义的东西。
 *
 * ## 一个刻意的顺序：**先验证、再添加**
 *
 * 用户口径是"添加完成并且通过验证之后，在界面可以出现刚刚填入的一栏"。所以
 * `保存并验证` 走的顺序是：保存（写凭据库 + 写配置）→ 立刻跑一次能力探测 →
 * 只有探测**发出过请求并拿到回答**才算"接口通了"。没通过时**那一栏仍然出现**
 * （配置是真的存下来了），但状态如实显示"未通过验证"，并且能就地重试 ——
 * 把已经存下来的配置丢掉不给看，比显示一条红的更让人困惑。
 */

import { useState } from "react"

import type { ProviderHealth, ProviderProfile, ProviderProtocol } from "../../services/providerProfileClient"
import { PRESETS, slug } from "./providerSettingsFields"
import { XIcon } from "./icons"

export interface ProviderDraft {
  id: string
  name: string
  protocol: ProviderProtocol
  dialect: ProviderProfile["dialect"]
  baseUrl: string
  modelId: string
  networkPolicy: ProviderProfile["networkPolicy"]
  revision: number
}

export interface ProviderFormResult {
  ok: boolean
  /** 失败原因（人话，直接显示）。 */
  detail?: string
  /** 保存成功后的这一份（带上新的修订号）。 */
  profile?: ProviderProfile
  /** 是否在这次提交里写了密钥。 */
  secretSaved?: boolean
  /** 保存成功但探测没通过时，探测给出的原因。 */
  probeDetail?: string
  /** 探测拿回来的健康记录（通过了才有意义）。 */
  health?: ProviderHealth
}

export interface ProviderFormProps {
  /** 空表示新增；有值表示编辑哪一份。 */
  editing: ProviderDraft | null
  /** 这一份现在有没有密钥（编辑时用来提示"留空表示不改"）。 */
  hasSecret: boolean
  submitLabel: string
  onSubmit(draft: ProviderDraft, secret: string): Promise<ProviderFormResult>
  onCancel(): void
}

interface FieldErrors {
  id?: string
  name?: string
  baseUrl?: string
  modelId?: string
  secret?: string
}

export function ProviderForm({ editing, hasSecret, submitLabel, onSubmit, onCancel }: ProviderFormProps) {
  const [presetIndex, setPresetIndex] = useState(() => {
    const found = PRESETS.findIndex((preset) => preset.protocol === editing?.protocol && preset.dialect === editing.dialect)
    return found >= 0 ? found : 0
  })
  const [name, setName] = useState(editing?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? PRESETS[0].baseUrl)
  const [modelId, setModelId] = useState(editing?.modelId ?? "")
  // 密钥只在内存里过一手：**从不**写进 profile、从不落盘、从不进日志。
  const [secret, setSecret] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")

  const preset = PRESETS[presetIndex]

  function validate(): FieldErrors {
    const found: FieldErrors = {}
    const id = editing ? editing.id : slug(name)
    if (id.length === 0) found.id = "需要一个名字（它决定这份配置的 id）"
    if (name.trim().length === 0) found.name = "填一个名字，列表里靠它区分"
    if (baseUrl.trim().length === 0) found.baseUrl = "填接口地址（例如 https://api.openai.com/v1）"
    if (modelId.trim().length === 0) found.modelId = "填模型名（例如 gpt-4o-mini）"
    // 新增时**必须有密钥**：没有密钥的配置按下去只会 401，而"添加"这个动作的
    // 前提就是"我有一把钥匙"。编辑时留空表示不改。
    if (!editing && secret.trim().length === 0) found.secret = "填 API key（它会存进 Windows 凭据管理器，不落盘）"
    return found
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const found = validate()
    if (Object.keys(found).length > 0) {
      setErrors(found)
      setFailure("有字段需要先修正")
      return
    }
    setErrors({})
    setFailure("")
    setBusy(true)
    const draft: ProviderDraft = {
      id: editing ? editing.id : slug(name),
      name: name.trim(),
      protocol: preset.protocol,
      dialect: preset.dialect,
      baseUrl: baseUrl.trim(),
      modelId: modelId.trim(),
      networkPolicy: preset.networkPolicy,
      revision: editing?.revision ?? 0
    }
    const result = await onSubmit(draft, secret)
    setBusy(false)
    if (!result.ok) {
      setFailure(result.detail ?? "保存失败")
      return
    }
    // 成功之后**清空密钥输入**：计划 Step 4："Clear the input after a successful save"。
    setSecret("")
  }

  return <form className="provider-form" onSubmit={(event) => void submit(event)} noValidate aria-label={editing ? `编辑 ${editing.name}` : "添加模型服务"}>
    <div className="provider-form-head">
      <h4>{editing ? `编辑「${editing.name}」` : "添加模型服务"}</h4>
      <button type="button" className="provider-icon-button" onClick={onCancel} aria-label="收起表单">
        <XIcon />
      </button>
    </div>

    {failure && <p className="provider-form-error" role="alert">{failure}</p>}

    <div className="provider-form-grid">
      <label className="provider-field provider-field-wide">
        <span>预设</span>
        <select
          value={presetIndex}
          onChange={(event) => {
            const next = Number(event.target.value)
            setPresetIndex(next)
            // 预设只带协议与基址；模型名与名字留给用户 —— 猜一个模型名比留空更糟。
            setBaseUrl(PRESETS[next].baseUrl)
          }}
        >
          {PRESETS.map((candidate, index) => <option key={candidate.label} value={index}>{candidate.label}</option>)}
        </select>
      </label>

      <label className="provider-field">
        <span>显示名称</span>
        <input
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          aria-invalid={errors.name || errors.id ? true : undefined}
          aria-describedby={errors.name || errors.id ? "provider-name-error" : undefined}
          placeholder="My OpenAI"
        />
        {(errors.name || errors.id) && <small id="provider-name-error" className="provider-field-error" role="alert">{errors.name ?? errors.id}</small>}
      </label>

      <label className="provider-field">
        <span>模型名</span>
        <input
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          aria-invalid={errors.modelId ? true : undefined}
          aria-describedby={errors.modelId ? "provider-model-error" : undefined}
          placeholder="gpt-4o-mini"
        />
        {errors.modelId && <small id="provider-model-error" className="provider-field-error" role="alert">{errors.modelId}</small>}
      </label>

      <label className="provider-field provider-field-wide">
        <span>接口地址</span>
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          aria-invalid={errors.baseUrl ? true : undefined}
          aria-describedby={errors.baseUrl ? "provider-url-error" : undefined}
          placeholder="https://api.openai.com/v1"
        />
        {errors.baseUrl && <small id="provider-url-error" className="provider-field-error" role="alert">{errors.baseUrl}</small>}
      </label>

      <label className="provider-field provider-field-wide">
        <span>API key{editing && hasSecret ? "（已配置，留空表示不改）" : ""}</span>
        <input
          type="password"
          value={secret}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setSecret(event.target.value)}
          aria-invalid={errors.secret ? true : undefined}
          aria-describedby={errors.secret ? "provider-secret-error" : "provider-secret-hint"}
          placeholder={editing && hasSecret ? "留空保持现有密钥" : "sk-…"}
        />
        {errors.secret
          ? <small id="provider-secret-error" className="provider-field-error" role="alert">{errors.secret}</small>
          : <small id="provider-secret-hint" className="provider-field-hint">存进 Windows 凭据管理器；配置里只有它的名字。</small>}
      </label>
    </div>

    <div className="provider-form-actions">
      <button type="submit" className="provider-button-primary" disabled={busy}>
        {busy ? "保存并验证中…" : submitLabel}
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>取消</button>
    </div>
  </form>
}


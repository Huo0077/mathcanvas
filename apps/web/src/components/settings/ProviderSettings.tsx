/**
 * **模型服务**（模块 C，Task 1.3 Step 5 / Task 1.4 Step 5）。
 *
 * ## 这一屏的形态：一份可以有很多栏、随时切来切去的清单
 *
 * 用户口径（2026-09-21）："像 ccswitch 那样，首先有加号可以添加 apikey，
 * 添加完成并且通过验证之后，在界面可以出现刚刚填入的一栏，能同时存在很多栏，
 * 并且能够主动在不同的模型中进行切换"。
 *
 * 于是它是一份**清单**，不是一张表单：
 * - 左上角一个**加号**（`添加`）打开表单；表单收起时清单是主角；
 * - 每一份配置是**一栏**，一栏里能看到：名字、模型名、协议、有没有密钥、
 *   健康状态、四个能力徽章；
 * - **正在使用的那一栏有明确的标记**（左侧竖条 + `使用中` 徽章 + 按钮变成禁用态）；
 * - 每一栏都有 `使用` —— 切换只改一个字段，不改任何配置（见 Rust 侧 `select`）；
 * - 每一栏都有 `验证` —— 它在**用户按下去时**才发请求（四发，见 `provider_check`）。
 *
 * ## 三个刻意的取舍
 *
 * 1. **不默认选第一份**。`使用中` 这个标记必须对应一次真的选择，否则用户分不清
 *    "模型没配"与"我配了但没选"。
 * 2. **验证失败时那一栏仍然出现**。配置是真的存下来了；把已经存下来的东西藏起来
 *    比显示一条红的更让人困惑。状态如实说"未通过验证"，并且能就地重试。
 * 3. **"验证"的代价写在按钮上**（`title`）而不是只在文档里：一次验证花掉四发真请求。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { hasSecret } from "../../services/secretClient"
import {
  checkProviderCapabilities,
  isVerified,
  listProviderProfiles,
  readActiveProviderProfile,
  readFailureContract,
  readProviderHealth,
  removeProviderProfile,
  saveProfileWithSecret,
  selectProviderProfile,
  type ProviderHealth,
  type ProviderProfile
} from "../../services/providerProfileClient"
import { ProviderForm, type ProviderDraft, type ProviderFormResult } from "./ProviderForm"
import { FEATURE_LABELS, HEALTH_LABELS, reasonFor } from "./providerSettingsFields"
import { BoltIcon, CheckIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons"

export interface ProviderSettingsProps {
  /** 测试注入用；缺省走真实 IPC。 */
  client?: {
    list(): Promise<ProviderProfile[]>
    save(profile: Record<string, unknown>, options: { secret?: string; expectedRevision?: number }): Promise<{ ok: true; profile: ProviderProfile } | { ok: false; code: string; detail: string }>
    remove(profileId: string): Promise<void>
    /** 把凭据库里那一格删掉（删服务时必须一起做，否则留下孤儿密钥）。 */
    forgetSecret(secretRef: string): Promise<void>
    health(profileId: string): Promise<ProviderHealth | null>
    hasSecret(profileId: string): Promise<boolean>
    /** 跑一次能力探测（**会花掉四发真请求**）。返回失败原因供界面如实显示。 */
    check(profileId: string, revision: number): Promise<{ ok: true; health: ProviderHealth } | { ok: false; detail: string }>
    /** 切换当前使用的配置。 */
    select(profileId: string): Promise<void>
    /** 现在在用哪一份（`null`＝还没选过）。 */
    active(): Promise<string | null>
  }
  /** 后端不可用时的说明（浏览器里跑就是这种情况）。 */
  unavailableReason?: string
}

/** 一栏当前处在什么状态。**状态词本身就是信息**，颜色只是冗余的一层。 */
type RowState = "idle" | "probing" | "verified" | "unverified"

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
    forgetSecret: async (secretRef: string) => {
      // 复用 `secretClient` 的 `removeSecret`：它已经处理了"没有桌面外壳"与
      // "IPC 失败"两种情况，而这两条路径在设置界面里都被测过。
      const { removeSecret } = await import("../../services/secretClient")
      const result = await removeSecret(secretRef)
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
    },
    check: async (profileId: string, revision: number) => {
      const result = await checkProviderCapabilities(profileId, revision)
      if (!result.ok) {
        // 优先显示 Rust 那条**带分类**的失败（它说清了是认证、地址还是没密钥）。
        const contract = readFailureContract(new Error(result.detail))
        return { ok: false as const, detail: contract ? contract.message : `${result.code}: ${result.detail}` }
      }
      return { ok: true as const, health: result.value }
    },
    select: async (profileId: string) => {
      const result = await selectProviderProfile(profileId)
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
    },
    active: async () => {
      const result = await readActiveProviderProfile()
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`)
      return result.value
    }
  })
  const api = client ?? realClient.current

  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [health, setHealth] = useState<Record<string, ProviderHealth | null>>({})
  const [keyPresent, setKeyPresent] = useState<Record<string, boolean>>({})
  const [activeId, setActiveId] = useState<string>("")
  /** 空表示表单收起；`null` 表示"新增"；有值表示在编辑那一份。 */
  const [editing, setEditing] = useState<ProviderDraft | null | undefined>(undefined)
  const [probing, setProbing] = useState("")
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({ kind: "idle", message: "" })

  const refresh = useCallback(async () => {
    // **没有桌面外壳时不去问 IPC。** 在浏览器里跑是正常状态（不是错误），
    // 而"每次打开设置都弹一句 `no_desktop_shell: …`"会把一件正常的事显示成故障。
    // 上面那条 `unavailableReason` 已经把话说清楚了。
    if (unavailableReason) {
      setProfiles([])
      setStatus({ kind: "idle", message: "" })
      return
    }
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
      setActiveId((await api.active()) ?? "")
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }, [api, unavailableReason])

  useEffect(() => { void refresh() }, [refresh])

  /** 这一栏的状态。四态各有各的词 —— 不把"未知"显示成"失败"。 */
  const stateOf = useCallback((profile: ProviderProfile): RowState => {
    if (probing === profile.id) return "probing"
    const record = health[profile.id]
    if (!record || record.profileRevision !== profile.revision) return "idle"
    const verified = ["tools", "json", "vision", "streaming"].some((feature) => isVerified(profile, feature, record))
    if (record.status === "failed") return "unverified"
    return verified ? "verified" : "unverified"
  }, [health, probing])

  /** 这一栏的说明句：说清"现在是什么状态、下一步该做什么"。 */
  const noteOf = useCallback((profile: ProviderProfile): string => {
    const record = health[profile.id]
    if (probing === profile.id) return "正在验证：会发出 4 次请求（文本、JSON、一张 1×1 的图、一次工具调用）"
    if (!record) return "还没验证过。按「验证」才知道这个模型真的支持哪些能力。"
    if (record.profileRevision !== profile.revision) return "配置改过了，上一次的验证结果已经过期。"
    if (record.status === "failed") return "上次验证失败：接口连不上或凭据不对。"
    const verified = ["tools", "json", "vision", "streaming"].filter((feature) => isVerified(profile, feature, record))
    if (verified.length === 0) return "已连通，但这次没能验证出任何能力（结论是「未知」，不是「不支持」）。"
    return `已验证：${verified.map((feature) => FEATURE_LABELS[feature] ?? feature).join("、")}`
  }, [health, probing])

  async function use(profile: ProviderProfile): Promise<void> {
    try {
      await api.select(profile.id)
      setActiveId(profile.id)
      setStatus({ kind: "ok", message: `已切换到 ${profile.name}` })
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * **验证一栏**（用户按下去才发生）。
   *
   * 四发真请求，所以：①只在点击时跑；②跑的时候按钮禁用并如实说在验证；
   * ③失败时**显示原因**，而不是留一个"未验证"让用户猜。
   */
  async function verify(profile: ProviderProfile, quiet = false): Promise<string | undefined> {
    setProbing(profile.id)
    if (!quiet) setStatus({ kind: "idle", message: `正在验证 ${profile.name}（会发出 4 次请求）…` })
    const result = await api.check(profile.id, profile.revision)
    setProbing("")
    if (!result.ok) {
      setStatus({ kind: "error", message: `${profile.name} 未通过验证：${result.detail}` })
      return result.detail
    }
    setHealth((current) => ({ ...current, [profile.id]: result.health }))
    const verified = result.health.capabilityEvidence.filter((entry) => entry.status === "verified").map((entry) => FEATURE_LABELS[entry.feature] ?? entry.feature)
    setStatus({
      kind: "ok",
      message: verified.length > 0
        ? `${profile.name} 通过验证：${verified.join("、")} 已验证`
        : `${profile.name} 已连通，但没能验证出任何能力`
    })
    return undefined
  }

  /**
   * **保存（并验证）**。
   *
   * 用户口径里的顺序是"添加完成并且通过验证之后，在界面出现这一栏"。所以：
   * 保存成功 → 立刻验证 → 验证没过时那一栏**仍然出现**（配置是真的存下来了），
   * 只是状态如实说"没通过"。把已经存下来的东西藏起来更让人困惑。
   */
  async function save(draft: ProviderDraft, secret: string): Promise<ProviderFormResult> {
    // **在写下之前**记下"这是不是第一份配置"。`await` 之后 `profiles` 可能已经变了。
    const hadAnyBefore = profiles.length > 0
    const profile = {
      id: draft.id,
      name: draft.name,
      protocol: draft.protocol,
      dialect: draft.dialect,
      baseUrl: draft.baseUrl,
      modelId: draft.modelId,
      // **只有引用**：密钥本体走凭据库，profile 里永远只有这个名字。
      secretRef: draft.id,
      capabilities: profiles.find((entry) => entry.id === draft.id)?.capabilities ?? [],
      networkPolicy: draft.networkPolicy,
      revision: draft.revision
    }
    const result = await api.save(profile, { secret: secret.length > 0 ? secret : undefined, expectedRevision: draft.revision > 0 ? draft.revision : undefined })
    if (!result.ok) {
      return { ok: false, detail: reasonFor(result.code, result.detail) }
    }
    setEditing(undefined)
    await refresh()

    // 保存之后**立刻验证**：这一栏是不是"能用"要靠证据说话，而不是靠用户点进去看。
    //
    // 新增的**第一份**自动设为"使用中"：用户刚填完钥匙，下一步显然是"用它"。
    // 判据用**保存之前**的列表长度（`hadAnyBefore`），而不是这一次渲染闭包里的
    // `profiles` —— 那个读数在 await 之后可能已经过时，而"是不是第一份"必须是在
    // 这次写下之前就定下来的事实。
    if (!hadAnyBefore && activeId.length === 0) {
      try {
        await api.select(result.profile.id)
        setActiveId(result.profile.id)
      } catch {
        // 选不上不是保存失败：那一栏已经在列表里了。
      }
    }
    const probeDetail = await verify(result.profile, true)
    return { ok: true, profile: result.profile, secretSaved: secret.length > 0, probeDetail, health: health[result.profile.id] ?? undefined }
  }

  async function remove(profile: ProviderProfile): Promise<void> {
    try {
      await api.remove(profile.id)
      if (editing?.id === profile.id) setEditing(undefined)
      /**
       * **把凭据库里那一格也删掉**。
       *
       * 不做这一步的话，用户"删掉服务"之后会在凭据管理器里留下一份孤儿密钥：
       * 他看不到它（配置没了），但它确实占着那一格 —— 而且下次用同一个 id
       * 建一份配置时会**悄悄继承**那份旧密钥。
       *
       * 顺序与保存相反：保存是"先密钥、后配置"（否则配置指向一个不存在的密钥），
       * 删除是"先配置、后密钥"（否则配置指向一个已经不存在的密钥）。
       */
      let secretNote = ""
      try {
        await api.forgetSecret(profile.secretRef ?? profile.id)
      } catch (error) {
        secretNote = `；但密钥可能还在凭据管理器里（${error instanceof Error ? error.message : String(error)}）`
      }
      setStatus({ kind: "ok", message: `已删除 ${profile.name}（配置已删除${secretNote}）` })
      await refresh()
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }

  const count = profiles.length
  const activeProfile = useMemo(() => profiles.find((profile) => profile.id === activeId) ?? null, [profiles, activeId])

  return <section className="provider-settings" aria-label="模型服务">
    <header className="provider-settings-head">
      <div className="provider-settings-title">
        <h3>模型服务</h3>
        <p className="provider-settings-sub">{count === 0 ? "还没有配置" : `${count} 个配置`}{activeProfile ? ` · 正在使用 ${activeProfile.name}` : " · 还没有选择使用哪一个"}</p>
      </div>
      <button
        type="button"
        className="provider-button-add"
        onClick={() => setEditing(editing === null ? undefined : null)}
        aria-expanded={editing === null}
        aria-controls="provider-form-region"
        /* 可见文字在「添加」与「收起」之间切换，而**可访问名保持不变** ——
           一个会随状态改名的按钮会让"同一个控件"在读屏与测试里变成两个。 */
        aria-label="添加模型服务"
      >
        <PlusIcon />
        {editing === null ? "收起" : "添加"}
      </button>
    </header>

    {unavailableReason && <p className="provider-settings-unavailable" role="status">{unavailableReason}</p>}

    <div id="provider-form-region">
      {editing !== undefined && <ProviderForm
        key={editing?.id ?? "new"}
        editing={editing}
        hasSecret={editing ? keyPresent[editing.id] === true : false}
        submitLabel="保存并验证"
        onSubmit={save}
        onCancel={() => setEditing(undefined)}
      />}
    </div>

    <ul className="provider-list" data-count={count}>
      {profiles.map((profile) => {
        const state = stateOf(profile)
        const record = health[profile.id]
        const isActive = profile.id === activeId
        const keyed = keyPresent[profile.id] === true
        return <li key={profile.id} data-profile-id={profile.id} data-active={isActive} data-state={state}>
          <div className="provider-row-head">
            <span className="provider-row-name">
              {profile.name}
              {isActive && <span className="provider-badge-active" data-badge="active"><CheckIcon size={12} />使用中</span>}
            </span>
            <span className="provider-row-meta">{profile.modelId} · {profile.protocol} · {profile.networkPolicy === "cloud" ? "云端" : profile.networkPolicy === "lan" ? "局域网" : "本机"}</span>
          </div>

          <div className="provider-row-badges">
            <span className="provider-badge" data-badge="key" data-present={keyed}>{keyed ? "已配置密钥" : "未配置密钥"}</span>
            <span className="provider-badge" data-badge="health" data-health={record?.status ?? "unknown"}>{HEALTH_LABELS[record?.status ?? "unknown"]}</span>
            {["tools", "json", "vision", "streaming"].map((feature) => {
              const verified = isVerified(profile, feature, record ?? null)
              return <span key={feature} className="provider-badge" data-badge="capability" data-feature={feature} data-verified={verified}>
                {FEATURE_LABELS[feature]}{verified ? "已验证" : "未验证"}
              </span>
            })}
          </div>

          <p className="provider-row-note" data-note={state}>{noteOf(profile)}</p>

          <div className="provider-row-actions">
            <button
              type="button"
              className={isActive ? "provider-button-use" : "provider-button-use provider-button-use-idle"}
              onClick={() => void use(profile)}
              disabled={isActive}
              aria-label={isActive ? `${profile.name} 正在使用` : `使用 ${profile.name}`}
            >
              {isActive ? "使用中" : "使用"}
            </button>
            <button
              type="button"
              onClick={() => void verify(profile)}
              disabled={probing !== "" || !keyed}
              title={keyed ? "会发出 4 次请求（文本、JSON、一张 1×1 的图、一次工具调用）" : "先配置密钥再验证"}
              aria-label={`验证 ${profile.name}`}
            >
              <BoltIcon size={14} />{probing === profile.id ? "验证中…" : "验证"}
            </button>
            <button
              type="button"
              onClick={() => setEditing({ id: profile.id, name: profile.name, protocol: profile.protocol, dialect: profile.dialect, baseUrl: profile.baseUrl, modelId: profile.modelId, networkPolicy: profile.networkPolicy, revision: profile.revision })}
              aria-label={`编辑 ${profile.name}`}
            >
              <PencilIcon size={14} />编辑
            </button>
            <button type="button" className="provider-button-danger" onClick={() => void remove(profile)} aria-label={`删除 ${profile.name}`}>
              <TrashIcon size={14} />删除
            </button>
          </div>
        </li>
      })}
      {count === 0 && <li className="provider-list-empty">
        <p>还没有配置任何模型服务。</p>
        <button type="button" className="provider-button-add" onClick={() => setEditing(null)}><PlusIcon />添加第一个</button>
      </li>}
    </ul>

    {/* 状态行：`aria-live` 让读屏也能听到"存住了 / 没通过"。 */}
    <p className="provider-status" data-kind={status.kind} role="status" aria-live="polite">{status.message}</p>
  </section>
}

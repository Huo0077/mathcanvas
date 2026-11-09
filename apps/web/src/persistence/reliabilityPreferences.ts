/**
 * **独立候选配置的引用（W8，2026-11-09）**。
 *
 * 只保存**一份已有配置的 id**：密钥留在原生凭据库，这里连副本都不放。
 * 读的时候严格净化 —— 坏 JSON、非字符串、超长、以及任何疑似密钥字段一律丢弃，
 * 于是"设置被改坏了"只会退化成"未授权独立候选"，不会退化成"用了另一份密钥"。
 */
const KEY = "mathcanvas:reliability-preferences"

export interface ReliabilityPreferences {
  /** `null` = 没有授权独立候选；有值 = 用户明确选了这一份配置做交叉验证。 */
  independentProfileId: string | null
}

const EMPTY: ReliabilityPreferences = { independentProfileId: null }

export function readReliabilityPreferences(): ReliabilityPreferences {
  let raw: string | null
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY)
  } catch {
    return { ...EMPTY }
  }
  if (raw === null) return { ...EMPTY }
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY }
    const id = (value as Record<string, unknown>).independentProfileId
    if (typeof id !== "string" || id.trim().length === 0 || id.length > 128) return { ...EMPTY }
    return { independentProfileId: id.trim() }
  } catch {
    return { ...EMPTY }
  }
}

/** 只写 id：任何额外字段（例如误传的 `apiKey`）都不会落库。 */
export function writeReliabilityPreferences(preferences: { independentProfileId: string | null }): boolean {
  const id = preferences.independentProfileId
  if (id !== null && (typeof id !== "string" || id.trim().length === 0 || id.length > 128)) return false
  try {
    localStorage.setItem(KEY, JSON.stringify({ independentProfileId: id === null ? null : id.trim() }))
    return true
  } catch {
    return false
  }
}

export function setIndependentProfileId(profileId: string | null): boolean {
  return writeReliabilityPreferences({ independentProfileId: profileId })
}

export function hasAuthorizedIndependentProfile(): boolean {
  return readReliabilityPreferences().independentProfileId !== null
}

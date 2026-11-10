/**
 * **灰度比例（W11，2026-11-09）**。
 *
 * 新安装默认 **100% 文字能力**；用户显式存储的 0% 仍优先。
 * 只存一个整数（0—100），坏数据退化成 0；不得把损坏配置当作新安装。
 */
const KEY = "mathcanvas:reliability-rollout"

export const DEFAULT_ROLLOUT_PERCENTAGE = 100

export function readRolloutPercentage(): number {
  let raw: string | null
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY)
  } catch {
    return 0
  }
  if (raw === null) return DEFAULT_ROLLOUT_PERCENTAGE
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return 0
    const percentage = (value as Record<string, unknown>).percentage
    if (typeof percentage !== "number" || !Number.isFinite(percentage)) return 0
    return Math.min(100, Math.max(0, Math.trunc(percentage)))
  } catch {
    return 0
  }
}

export function setRolloutPercentage(percentage: number): boolean {
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return false
  const clamped = Math.min(100, Math.max(0, Math.trunc(percentage)))
  try {
    localStorage.setItem(KEY, JSON.stringify({ percentage: clamped }))
    return true
  } catch {
    return false
  }
}

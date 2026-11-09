/**
 * **灰度比例（W11，2026-11-09）**。
 *
 * 默认 **0%**：没有人在设置里显式调过，就一个开关都不开。
 * 只存一个整数（0—100），坏数据退化成 0 —— 宁可不开，也不要"因为设置写坏而全量打开"。
 */
const KEY = "mathcanvas:reliability-rollout"

export const DEFAULT_ROLLOUT_PERCENTAGE = 0

export function readRolloutPercentage(): number {
  let raw: string | null
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY)
  } catch {
    return DEFAULT_ROLLOUT_PERCENTAGE
  }
  if (raw === null) return DEFAULT_ROLLOUT_PERCENTAGE
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return DEFAULT_ROLLOUT_PERCENTAGE
    const percentage = (value as Record<string, unknown>).percentage
    if (typeof percentage !== "number" || !Number.isFinite(percentage)) return DEFAULT_ROLLOUT_PERCENTAGE
    return Math.min(100, Math.max(0, Math.trunc(percentage)))
  } catch {
    return DEFAULT_ROLLOUT_PERCENTAGE
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

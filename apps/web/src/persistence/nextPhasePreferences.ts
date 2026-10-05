/**
 * **N3 的第一个产品入口：那个布尔的"值从哪来"**（2026-10-05，用户批准）。
 *
 * ## 为什么需要它
 *
 * `agentNextPhaseFlags()` 从 N1 起就是"开关从哪来"的**唯一答案**，但它一直返回**全关**的一份；
 * 于是"约束拖动"这个能力**代码在、却没有入口** —— 浏览器验收根本写不出来
 *（见 `docs/current-status.md` §一.2 第 1 条，那一格挂了很久）。这里补上的就是入口：
 * **用户在「设置 → 实验性功能」里打开或关掉**。
 *
 * ## 为什么单独一个键，而不是塞进 `WorkbenchPreferences`
 *
 * 那个接口自己写着"**只存视图状态**"（`treeTab` / `expandedIds`）。把**功能开关**塞进去会让它的
 * 含义名不副实。这里的先例是 `draftStorage.ts` 的 `mathcanvas:3d-view`：**一件事一个键，
 * 各自一对 load/save**。
 *
 * ## 降级口径：读不出 / 存不下都当作「关」
 *
 * 与 `loadViewPreference3d` 同一条口径 —— 存储里可能是任何东西（旧版本写的、手改的、
 * 别的程序写的）。**读偏好绝不允许把坏数据变成"开"**（"开"会换掉拖动路径），
 * 也绝不允许抛异常把整个工作台带崩。
 *
 * 因此判定用的是 `=== true`，而不是真值判断：`{"constrainedDrag":"yes"}` 必须读成**关**。
 */
export const NEXT_PHASE_PREFERENCES_KEY = "mathcanvas:next-phase-preferences"

interface NextPhasePreferences {
  constrainedDrag?: unknown
}

/** `localStorage` 在非浏览器环境（有些单测、SSR 预渲染）里可能不存在 —— 那就当作没存过。 */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/** 读「约束拖动」这个实验性开关。**没存过 / 坏数据 / 存不下，一律是 `false`。** */
export function loadConstrainedDragEnabled(): boolean {
  const store = storage()
  if (store === null) return false
  try {
    const serialized = store.getItem(NEXT_PHASE_PREFERENCES_KEY)
    if (serialized === null) return false
    const parsed = JSON.parse(serialized) as NextPhasePreferences | null
    if (parsed === null || typeof parsed !== "object") return false
    return parsed.constrainedDrag === true
  } catch {
    return false
  }
}

/**
 * 写「约束拖动」这个实验性开关。
 *
 * **只改这一个键的值，其它键原样保留** —— 将来这里会有第二个、第三个实验性开关，
 * 而"写一个键把别的键抹掉"是那种要到用户抱怨才发现的毛病。
 *
 * 存不下（隐私模式、配额满）**不抛异常**：这一次的意图不保留，界面照常能用。
 */
export function saveConstrainedDragEnabled(enabled: boolean): void {
  const store = storage()
  if (store === null) return
  try {
    const serialized = store.getItem(NEXT_PHASE_PREFERENCES_KEY)
    const parsed = serialized === null ? null : (JSON.parse(serialized) as unknown)
    const base = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
    store.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({ ...base, constrainedDrag: enabled }))
  } catch {
    // 见上：存不下属于可接受降级。
  }
}

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
  witnessSearch?: unknown
  proofExport?: unknown
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
/**
 * 读「见证搜索」开关（Phase N2）—— **2026-10-15 用户裁决：默认开、可显式关掉**。
 *
 * ## 为什么改成默认开
 *
 * 这条救援的纪律是「**只救不抢**」（`planCompiler.rescuedByWitnessSearch`）：
 * 第一遍的核验**通过**时它一步都不动（`not-needed`）；只有核验**没通过**（未核验 / 失败）时，
 * 才按题面条件搜一组坐标，而且**第二遍必须真的通过**才采用，否则原样交回第一遍并标明坐标来源。
 * 也就是说它**不可能**让一份本来能过的计划变差，只能把"本来会停在门禁上"的那一轮救回来 ——
 * 而用户现场连续几次失败（三棱柱、四棱锥 ×3、Rt△ABC 折起）全都停在这条路上：
 * 模型手写的坐标不满足题面条件，而系统明明有"按题面造坐标"的能力却默认关着。
 *
 * 所以按用户裁决把它变成**默认行为**；`false` 仍然有效（用户在设置里关掉它）。
 *
 * ## 语义（与之前那条"坏数据读成关"的差别，写清楚）
 *
 * **只有显式 `false` 才算关**；没存过、JSON 坏掉、值不是布尔（例如字符串 `"true"`）
 * 一律按**默认（开）**读 —— 一条乱码不该悄悄关掉一个默认能力（真要关，设置里有开关）。
 * 这与 `constrainedDrag` / `proofExport` 那两条**默认关**的实验开关口径相反，是刻意的：
 * 它们是"打开会改变行为、必须显式选择"，而这一条是"默认就该跑、可以关掉"。
 */
export function loadWitnessSearchEnabled(): boolean {
  const store = storage()
  if (store === null) return true
  try {
    const serialized = store.getItem(NEXT_PHASE_PREFERENCES_KEY)
    if (serialized === null) return true
    const parsed = JSON.parse(serialized) as unknown
    return !(parsed !== null && typeof parsed === "object" && (parsed as { witnessSearch?: unknown }).witnessSearch === false)
  } catch {
    return true
  }
}

/** 只写自己的键，不能清掉已选择的约束拖动和其它偏好。 */
export function saveWitnessSearchEnabled(enabled: boolean): void {
  const store = storage()
  if (store === null) return
  try {
    const serialized = store.getItem(NEXT_PHASE_PREFERENCES_KEY)
    const parsed = serialized === null ? null : (JSON.parse(serialized) as unknown)
    const base = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    store.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({ ...base, witnessSearch: enabled }))
  } catch {
    // An unwritable preference cannot enable the capability in agentNextPhaseFlags().
  }
}

/**
 * 读「形式证明导出」这个实验性开关（§3-D，2026-10-10）。
 *
 * 与上面两个同一条口径：**没存过 / 坏数据 / 存不下，一律 `false`**（判定用 `=== true`）。
 * 这一条尤其要紧：打开它意味着"跑完作图之后会去起一个 Lean 进程"，而"读偏好"绝不允许
 * 把坏数据变成"开"。
 */
export function loadProofExportEnabled(): boolean {
  const store = storage()
  if (store === null) return false
  try {
    const serialized = store.getItem(NEXT_PHASE_PREFERENCES_KEY)
    if (serialized === null) return false
    const parsed = JSON.parse(serialized) as NextPhasePreferences | null
    return parsed !== null && typeof parsed === "object" && parsed.proofExport === true
  } catch {
    return false
  }
}

/** 只写自己的键（与 `saveWitnessSearchEnabled` 同样的理由：写一个键不许把别的抹掉）。 */
export function saveProofExportEnabled(enabled: boolean): void {
  const store = storage()
  if (store === null) return
  try {
    const serialized = store.getItem(NEXT_PHASE_PREFERENCES_KEY)
    const parsed = serialized === null ? null : (JSON.parse(serialized) as unknown)
    const base = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    store.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({ ...base, proofExport: enabled }))
  } catch {
    // 存不下 ⇒ 下次读到的是关（安全的那一侧）。
  }
}

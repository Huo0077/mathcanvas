/**
 * 覆盖层增量同步：按 key 复用 DOM 节点，而不是每次重画都 `replaceChildren()` 重建。
 *
 * 3D 视口上有两层 HTML 覆盖层（测量标注、点标注）。它们以前每帧都整体重建，
 * 而"每帧"包括拖动、相机过渡、窗口缩放——实测一次拖动里每秒重建 60 次。
 * 重建的代价不只是分配：
 *  1) 测量标注带 `role="status"`，节点被换掉等于"出现了一条新消息"，读屏软件会把同一条标注
 *     反复播报（无障碍上的真问题，不只是性能）；
 *  2) 元素的 CSS 过渡/动画随重建不断重播，拖动时表现为标注闪烁。
 *
 * 语义：`entries` 是这一刻**应该存在**的节点集合。
 *  - 不在其中的 key → 节点被删除；
 *  - `visible: false` → 节点保留但 `hidden`（相机转出视野再转回来时不重建，也不会被读屏读到）；
 *  - 其余情况只在真正变化时写 DOM（文本、dataset、位置、顺序）。
 */
export interface OverlayEntry {
  /** 稳定标识：同一个对象在多次同步之间必须保持同一个 key。 */
  key: string
  text: string
  visible: boolean
  /** 相对覆盖层左上角的像素位置（居中偏移由 CSS 的 transform 负责）。 */
  left: number
  top: number
  dataset?: Record<string, string>
}

export interface OverlaySyncResult {
  created: number
  /** 至少改动过一次的节点数（文本、dataset、位置、可见性、顺序都算）。 */
  updated: number
  removed: number
}

interface OverlayRecord {
  node: HTMLElement
  text: string
  visible: boolean
  left: number
  top: number
  dataset: Record<string, string>
}

const overlayRecords = new WeakMap<HTMLElement, Map<string, OverlayRecord>>()

/** 只给测试用：丢掉某个覆盖层记住的节点，让用例之间互不影响（生产代码不需要）。 */
export function forgetOverlay(host: HTMLElement): void {
  overlayRecords.delete(host)
}

export function syncOverlay(
  host: HTMLElement,
  entries: readonly OverlayEntry[],
  create: (entry: OverlayEntry) => HTMLElement
): OverlaySyncResult {
  let records = overlayRecords.get(host)
  if (!records) {
    records = new Map<string, OverlayRecord>()
    overlayRecords.set(host, records)
  }
  const result: OverlaySyncResult = { created: 0, updated: 0, removed: 0 }
  const alive = new Set<string>()

  entries.forEach((entry, index) => {
    alive.add(entry.key)
    let record = records.get(entry.key)
    if (!record) {
      record = { node: create(entry), text: "", visible: true, left: Number.NaN, top: Number.NaN, dataset: {} }
      records.set(entry.key, record)
      result.created += 1
    }
    const { node } = record
    let touched = false
    if (record.text !== entry.text) {
      node.textContent = entry.text
      record.text = entry.text
      touched = true
    }
    if (record.visible !== entry.visible) {
      node.hidden = !entry.visible
      record.visible = entry.visible
      touched = true
    }
    const dataset = entry.dataset ?? {}
    for (const [name, value] of Object.entries(dataset)) {
      if (record.dataset[name] === value) continue
      node.dataset[name] = value
      touched = true
    }
    for (const name of Object.keys(record.dataset)) {
      if (name in dataset) continue
      delete node.dataset[name]
      touched = true
    }
    record.dataset = { ...dataset }
    if (entry.visible && (record.left !== entry.left || record.top !== entry.top)) {
      node.style.left = `${entry.left}px`
      node.style.top = `${entry.top}px`
      record.left = entry.left
      record.top = entry.top
      touched = true
    }
    // 顺序按 entries 来：否则同一位置上的两个标注会随重建顺序上下颠倒地跳。
    if (host.children[index] !== node) {
      host.insertBefore(node, host.children[index] ?? null)
      touched = true
    }
    if (touched) result.updated += 1
  })

  for (const [key, record] of records) {
    if (alive.has(key)) continue
    record.node.remove()
    records.delete(key)
    result.removed += 1
  }
  return result
}

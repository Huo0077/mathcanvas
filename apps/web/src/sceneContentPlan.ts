/**
 * 内容同步的差分计划（纯函数）。
 *
 * 场景内容以前是"每次同步全清全建"：改一个图元、点一下选中、展开动画的每一帧，
 * 都要把整场对象（连网格与坐标轴）释放再重建。3D 覆盖层已经改成按 key 增量（见 `overlaySync.ts`），
 * 这里把同一套思路用到场景对象上：**签名没变就沿用原对象**，只重建真正变了的那几个。
 *
 * 抽成纯函数是为了让"不该重建就不许重建"这条规则能被单测钉住——它是这次改动唯一的判据。
 */
export interface ContentEntry {
  /** 稳定标识：同一个场景对象在多次同步之间必须保持不变。 */
  key: string
  /** 影响这个对象外观的全部输入（自己 + 依赖 + 视图状态）的签名。 */
  signature: string
}

export interface ContentSyncPlan {
  /** 需要新建（或重建）的 key，按本次 entries 的顺序。 */
  created: string[]
  /** 签名未变、可以直接沿用的 key。 */
  reused: string[]
  /** 上次还在、这次不再需要的 key（调用方负责释放）。 */
  removed: string[]
  /** 本次同步后场景里应有的内容顺序（即 entries 的顺序，重复 key 只保留一次）。 */
  order: string[]
}

export function planContentSync(previous: ReadonlyMap<string, string>, entries: readonly ContentEntry[]): ContentSyncPlan {
  const plan: ContentSyncPlan = { created: [], reused: [], removed: [] as string[], order: [] }
  const seen = new Set<string>()
  for (const item of entries) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    plan.order.push(item.key)
    if (previous.get(item.key) === item.signature) plan.reused.push(item.key)
    else plan.created.push(item.key)
  }
  for (const key of previous.keys()) {
    if (!seen.has(key)) plan.removed.push(key)
  }
  return plan
}

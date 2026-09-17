import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { getDependencyIndex } from "@draw/scene-graph"

/**
 * 内容签名：决定"这个场景对象要不要重建"。
 *
 * 3D 场景过去每次同步都 `clearContent()` 全清全建——改一个图元、点一下选中、
 * 展开动画的每一帧，都要把整场对象（连网格与坐标轴）释放再重建。现在按**签名**
 * 判断：签名没变就沿用原对象（差分与执行见 `sceneContentPlan.ts` 和 `threeScene.tsx`）。
 *
 * 签名的判据必须是**这个对象真正读到的东西**：
 *  - 它自己的数据；
 *  - 它依赖的图元——取**传递闭包**而不是直接依赖：面 `face3` 只存 `pointIds`，
 *    而建立在面上的二面角标注读的是顶点的实际坐标，只算一层就会漏掉顶点移动；
 *  - 调用方给的视图状态（选中、显示开关、展开进度、面片尺寸……）。
 *
 * 反过来，把整份文档塞进签名就等于没做增量，所以这里刻意只走依赖闭包。
 */
export interface ContentSigner {
  /** 图元自身 + 依赖闭包 + `extra`（视图状态）。 */
  of(id: string, extra?: string): string
  /** 由多个引用（测量、标注这类不在依赖图里的对象）合成签名。 */
  ofReferences(ids: readonly string[], extra?: string): string
  /** 某个模板实体物化出来的拓扑签名。截面面片的尺寸取自它，必须跟着它变。 */
  topologyOf(sourceId: string): string
}

export function createContentSigner(document: GeometryDocument): ContentSigner {
  const primitives = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const jsonCache = new Map<string, string>()
  const jsonOf = (id: string): string => {
    const cached = jsonCache.get(id)
    if (cached !== undefined) return cached
    const primitive = primitives.get(id)
    const value = primitive ? JSON.stringify(primitive) : `missing:${id}`
    jsonCache.set(id, value)
    return value
  }
  /** 依赖索引给的是"谁跟着谁"，这里反过来用：每个图元依赖哪些图元。 */
  const dependencies = new Map<string, string[]>()
  for (const [parentId, children] of getDependencyIndex(document)) {
    for (const childId of children) {
      const list = dependencies.get(childId) ?? []
      list.push(parentId)
      dependencies.set(childId, list)
    }
  }
  const closureCache = new Map<string, string>()
  const closureOf = (id: string): string => {
    const cached = closureCache.get(id)
    if (cached !== undefined) return cached
    const parts: string[] = []
    const seen = new Set<string>([id])
    const stack = [...(dependencies.get(id) ?? [])]
    while (stack.length) {
      const next = stack.pop()!
      if (seen.has(next)) continue
      seen.add(next)
      parts.push(jsonOf(next))
      for (const parent of dependencies.get(next) ?? []) stack.push(parent)
    }
    // 顺序不能取决于遍历次序，否则图元数组顺序一变就会误判成"内容变了"。
    parts.sort()
    const value = parts.join("")
    closureCache.set(id, value)
    return value
  }
  const topologyCache = new Map<string, string>()
  const topologyOf = (sourceId: string): string => {
    const cached = topologyCache.get(sourceId)
    if (cached !== undefined) return cached
    const value = document.primitives
      .filter((primitive) => primitive.type === "polyhedron3" && primitive.construction?.sourceIds.includes(sourceId))
      .map((primitive: PrimitiveSpec) => jsonOf(primitive.id) + closureOf(primitive.id))
      .join("")
    topologyCache.set(sourceId, value)
    return value
  }

  return {
    of: (id, extra = "") => `${jsonOf(id)}|${closureOf(id)}|${extra}`,
    ofReferences: (ids, extra = "") => ids.map((id) => `${jsonOf(id)}|${closureOf(id)}`).join("|") + `|${extra}`,
    topologyOf
  }
}

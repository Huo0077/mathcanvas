import type { PrimitiveSpec, TangentAnchor } from "@draw/dsl"

/**
 * 能长出切线的**来源曲线**。
 *
 * 用户口径："曲线包括抛物线，双曲线，圆，椭圆。" 另外两条在这里是有理由的，不是顺手加的：
 * - `function`：函数图像的切线在文档里早就存在（数值导数算出来的），入口本来就在函数属性面板里；
 *   把它列进来，界面才能**用同一句提示**说清"哪些曲线能作切线"，而不会出现两套互相矛盾的名单。
 * - `arc`：圆弧是圆的一部分，切线与圆完全同源（内核的 `arcConstraint` 与 `circleConstraint` 共用实现）。
 *   不列它才是奇怪的：用户看不出"为什么整圆可以、圆弧不行"。
 *
 * 直线 / 线段 / 射线 / 折线**不在**列：它们处处是自身的切线，"作切线"没有数学含义。
 *
 * 提示文案与按钮可用性都从这里取，避免两处各写一份名单后走偏
 * （与 `dynamicPointPaths.ts` 同一个理由：提示里说的候选必须与真的能点的完全一致）。
 */
export const TANGENT_SOURCE_TYPES = ["circle", "arc", "parabola", "ellipse", "hyperbola", "function"] as const

export function isTangentSource(primitive: PrimitiveSpec | null | undefined): primitive is PrimitiveSpec {
  return Boolean(primitive && (TANGENT_SOURCE_TYPES as readonly string[]).includes(primitive.type))
}

export function tangentSources(primitives: readonly PrimitiveSpec[]): PrimitiveSpec[] {
  return primitives.filter((primitive) => isTangentSource(primitive))
}

/**
 * 「创建切线」时切点落在哪里：**曲线自然参数的原点**。
 *
 * 四条曲线的参数 0 都恰好是一个顶点（圆的右顶点、椭圆的长轴端点、双曲线的顶点、抛物线的顶点），
 * 所以这是用户预期里"那条切线"，而不是曲线上一个随机位置。之后可以在右侧拖「切点参数」滑到任意处。
 */
export const DEFAULT_TANGENT_PARAMETER = 0

export function defaultTangentAnchor(): TangentAnchor {
  return { kind: "parameter", parameter: DEFAULT_TANGENT_PARAMETER, branch: 0 }
}

/**
 * 检查器里显示"这条切线切在哪里"。
 *
 * 动点定位要**点名那个点**：用户唯一的线索就是它，写成"跟随某个点"等于没说。
 * 找不到那个点时如实说"点已不存在"，而不是显示一个空字符串让面板看起来坏掉了。
 */
export function tangentAnchorLabel(anchor: TangentAnchor | undefined, pointLabel: (id: string) => string | null): string {
  if (!anchor) return "函数图像上的横坐标"
  if (anchor.kind === "point") {
    const label = pointLabel(anchor.pointId)
    return label ? `跟随动点 ${label}` : "定位点已不存在"
  }
  return `曲线参数 ${Number.isFinite(anchor.parameter) ? anchor.parameter.toFixed(3) : "—"}`
}

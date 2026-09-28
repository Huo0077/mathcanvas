import type { LayoutBox, LayoutModel } from "./renderEvidence"

/**
 * **把一份文档变成屏幕上的盒子**（Phase 4 / Task 4.2 的纯计算部分）。
 *
 * ## 这一层在做什么、不做什么
 *
 * 它做的是**一次确定性的正投影**：把文档里能读到坐标的图元投影到屏幕上，给出包围盒。
 * 它**不**读真实相机、不做透视、不碰 DOM、不截屏。
 *
 * 为什么先用正投影：真正卡住"能不能发现明显布局错误"的不是投影精度，而是
 * **有没有一条不依赖模型、不依赖浏览器的判据**。一条投影不准但完全确定的路径，
 * 能发现"对象被画到画布外面去了"这类错误；而"看起来像不像"本来就不该由几何判据回答。
 * 真实的相机取景属于渲染层（`threeScene`），接线时替换这一个函数即可 ——
 * 判据（`diagnoseLayout`）不需要改。
 *
 * ## 为什么屏幕 y 要取反
 *
 * 数学坐标 y 向上，屏幕坐标 y 向下。不取反的话"上方出界"会被报成"下方出界"，
 * 而这种错误在读数上完全看不出来（都是 `clipped_object`）。所以这里显式取反。
 *
 * ## 为什么只收"能读到位置"的图元
 *
 * 读不出位置的图元（例如由别的对象派生出来的曲线）**直接跳过**，而不是给它编一个盒子。
 * 编一个假盒子会让"布局没问题"这句话变成假的来源不明；跳过它则只会漏报，
 * 而漏报是这一层明确接受的局限（见文件末）。
 */

/** 屏幕投影的参数。默认值让一份"棱长 3 的立方体"落在视口中央且不贴边。 */
export interface LayoutModelOptions {
  /** 每个数学单位对应多少像素。 */
  pixelsPerUnit: number
  /** 屏幕四周留出的空白（像素）。 */
  padding: number
  /** 视口的宽高比（宽 ÷ 高）。 */
  aspectRatio: number
  /** 标签盒子的估算尺寸（像素）：文本布局是渲染层的事，这里只给一个固定档位。 */
  labelSize: { width: number; height: number }
}

export const DEFAULT_LAYOUT_MODEL_OPTIONS: LayoutModelOptions = {
  pixelsPerUnit: 60,
  padding: 24,
  aspectRatio: 4 / 3,
  labelSize: { width: 28, height: 14 }
}

interface Point {
  x: number
  y: number
}

/**
 * **这个图元是不是真正展示给用户的标注**。
 *
 * 为什么需要它（本轮实测发现）：模板实体物化出来的顶点/棱/面**带着内部编号标签**
 * （`solid-1-point-1`…），但它们是构造记法，不是用户标的字。
 * 把它们当成要显示的标签之后，一个**完全正常**的立方体会被判出 4 条 `label_overlap`
 * ——正投影下前后两层的顶点标签必然重合。那是**假报警**，而假报警会被学会忽略，
 * 比没有检查器更糟。
 *
 * 判据是"这个图元是不是立体构造物化出来的内部子对象"。**实测有两套命名**：
 * - 模板实体的族：`cube-1-point-1` / `cube-1-edge-15` / `cube-1-face-1`
 *   （见 `deletion-cascade.test.ts` 的注释："模板实体的 id 序列是 cube-1-point-1…、cube-1-edge-15…"）；
 * - 棱柱拓扑的族：`solidId:v0` / `solidId:e0` / `solidId:f0`（见 `buildPrismTopology`）。
 *
 * 两套都要认 —— 只认一套会让另一套的顶点标签继续被当成用户标注，假报警照旧。
 * 用**结构**判而不是类型名列表，是因为类型名列表会随 DSL 新增图元而静默过期。
 */
function isInternalConstructionPart(id: string): boolean {
  return /(:|-)(v|e|f)\d+$/.test(id) || /-(point|edge|face)-\d+$/.test(id)
}

/** 从图元里读出一个平面位置：2D 点用 `{x,y}`，3D 点用 `position:{x,y,z}`。 */
function positionOf(primitive: Record<string, unknown>): Point | null {
  const position = primitive.position
  if (typeof position === "object" && position !== null) {
    const { x, y } = position as Record<string, unknown>
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) return { x, y }
  }
  const { x, y } = primitive
  if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) return { x, y }
  return null
}

/**
 * 一个图元的**世界坐标包围盒**（数学坐标，y 向上）。
 *
 * 有顶点族的（模板 / 点集多面体）取全部顶点的范围 —— 那才是"这个实体占多大地方"。
 * 顶点读不出来时退化成它自己的位置点。两者都没有就是 `null`（跳过）。
 */
function worldBoundsOf(document: { primitives: readonly Record<string, unknown>[] }, primitive: Record<string, unknown>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points: Point[] = []
  const vertexIds = primitive.vertexIds
  if (Array.isArray(vertexIds)) {
    for (const id of vertexIds) {
      const vertex = document.primitives.find((entry) => entry.id === id)
      if (vertex) {
        const point = positionOf(vertex)
        if (point) points.push(point)
      }
    }
  }
  if (points.length === 0) {
    const own = positionOf(primitive)
    if (own) points.push(own)
  }
  if (points.length === 0) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/**
 * **一份文档 → 一个布局模型**（视口 + 盒子）。
 *
 * 视口不是外部给的，而是**从内容推出来的**：这正是"对象有没有出界"这个问题的前提 ——
 * 如果视口是固定画布，那"出界"取决于相机取景；而这里问的是
 * **"这份文档自己占的那一块地方，整体放进一个比例合适的画布时，有没有被裁掉"**。
 *
 * 判据是确定的：所有内容按 `pixelsPerUnit` 缩放后加上 `padding`，再按 `aspectRatio`
 * 补足较窄的那一边。因此同一份文档永远得到同一组读数。
 */
export function buildLayoutModel(document: { primitives: readonly Record<string, unknown>[] }, options: LayoutModelOptions = DEFAULT_LAYOUT_MODEL_OPTIONS): LayoutModel {
  const entries: { id: string; label: string | undefined; bounds: { minX: number; minY: number; maxX: number; maxY: number } }[] = []
  for (const primitive of document.primitives) {
    const bounds = worldBoundsOf(document, primitive)
    if (!bounds) continue
    const id = typeof primitive.id === "string" ? primitive.id : null
    if (id === null) continue
    entries.push({ id, label: typeof primitive.label === "string" ? primitive.label : undefined, bounds })
  }

  if (entries.length === 0) {
    // 读不出任何位置 → 视口退化。调用方据此报 `degenerate_viewport`/`empty_canvas`，
    // 而不是收到一组编出来的坐标。
    return { viewport: { width: 0, height: 0 }, boxes: [] }
  }

  const minX = Math.min(...entries.map((entry) => entry.bounds.minX))
  const minY = Math.min(...entries.map((entry) => entry.bounds.minY))
  const maxX = Math.max(...entries.map((entry) => entry.bounds.maxX))
  const maxY = Math.max(...entries.map((entry) => entry.bounds.maxY))
  const scale = options.pixelsPerUnit
  const contentWidth = (maxX - minX) * scale
  const contentHeight = (maxY - minY) * scale

  /**
   * 视口 = 内容 + 两侧留白，再按比例补足较窄的一边。
   * 内容为一点（宽高皆 0）时仍会得到 `2 * padding` 的正尺寸视口 —— 不会退化成 0。
   */
  const width = Math.max(contentWidth + options.padding * 2, (contentHeight + options.padding * 2) * options.aspectRatio, options.padding * 2)
  const height = Math.max(contentHeight + options.padding * 2, width / options.aspectRatio, options.padding * 2)

  /** 内容居中：把世界坐标的原点挪到画布中间。 */
  const offsetX = (width - contentWidth) / 2
  const offsetY = (height - contentHeight) / 2
  const toScreen = (point: Point): Point => ({
    x: offsetX + (point.x - minX) * scale,
    // 屏幕 y 向下，数学 y 向上 —— 必须取反（见文件头注释）。
    y: offsetY + (maxY - point.y) * scale
  })

  const boxes: LayoutBox[] = []
  for (const entry of entries) {
    const topLeft = toScreen({ x: entry.bounds.minX, y: entry.bounds.maxY })
    const bottomRight = toScreen({ x: entry.bounds.maxX, y: entry.bounds.minY })
    boxes.push({
      id: entry.id,
      kind: "object",
      x: topLeft.x,
      y: topLeft.y,
      // 一个孤立的点在世界坐标里宽高为 0 —— 给它一个**最小的可见尺寸**，
      // 否则它会被判成"面积为 0"，而"点太小看不见"与"点根本没画"是两件事。
      width: Math.max(bottomRight.x - topLeft.x, 2),
      height: Math.max(bottomRight.y - topLeft.y, 2),
      /**
       * 只有一个位置点、又没有顶点族的实体是**记号**（点 / 顶点）；
       * 其余的按图形算。判据用的是"它有没有铺开"这件事本身，而不是类型名列表 ——
       * 类型名列表会随 DSL 新增图元而静默过期。
       */
      shape: entry.bounds.maxX === entry.bounds.minX && entry.bounds.maxY === entry.bounds.minY ? "marker" : "shape"
    })
    if (entry.label !== undefined && !isInternalConstructionPart(entry.id)) {
      /**
       * 标签盒子摆在对象右上角。**这是估算，不是测量**：真实文本排版在渲染层。
       * 之所以仍然给出它，是因为"两个标签叠在一起"这件事只要盒子足够接近真实，
       * 就能被发现；而完全不报则等于这条判据不存在。
       */
      boxes.push({
        id: `${entry.id}#label`,
        kind: "label",
        x: topLeft.x,
        y: Math.max(0, topLeft.y - options.labelSize.height),
        width: options.labelSize.width,
        height: options.labelSize.height
      })
    }
  }

  return { viewport: { width, height }, boxes }
}

/**
 * **这一层明确接受的局限**（写成常量，免得它只存在于某段注释里）：
 *
 * 1. 正投影，不读真实相机 —— 透视下的出界这一层看不见；
 * 2. 标签盒子是估算尺寸，不是文本测量的结果；
 * 3. 读不出位置的图元被跳过（漏报），不会被编一个盒子出来。
 *
 * 这三条都不是"以后再说"，而是这一层的定位：它是**确定性回归信号**，
 * 不是"画得好不好看"的判据。真实取景由渲染层接线替换。
 */
export const LAYOUT_MODEL_LIMITATIONS: readonly string[] = [
  "orthographic projection only; the live camera is not read",
  "label boxes use an estimated size instead of measured text extents",
  "primitives without a readable position are skipped rather than given a fabricated box"
]

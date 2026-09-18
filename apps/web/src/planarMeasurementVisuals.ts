import type { Coordinate, GeometryDocument, Measurement3 } from "@draw/dsl"
import { entityResolverFor, type MeasurableEntity } from "@draw/geometry-kernel"

/**
 * 平面（2D）画布上的**常驻测量数字**。
 *
 * 用户口径："我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏
 *（这一点无论是平面几何还是立体几何都要优化）。"
 *
 * 两条纪律：
 * 1. **不猜位置**——来源点缺失、退化、值不是有限数时**不产出**标签（画一个错的数字比不画更糟）；
 * 2. **一个测量只有一个数**——文本与右侧属性栏是同一份（`值 + 单位`，3 位小数），
 *    画布上出现的数字与属性栏读到的必须一字不差。
 */
export interface PlanarMeasurementLabel {
  id: string
  text: string
  position: Coordinate
  /** 来源被选中时高亮：数字常驻之后，"我选中的是哪一条"必须仍然一眼看得出。 */
  selected: boolean
}

const METRIC_NAMES: Record<Measurement3["metric"], string> = { length: "长度", distance: "距离", angle: "角度", area: "面积", volume: "体积", perimeter: "周长", radius: "半径", dihedral: "二面角" }

/** 与属性栏同一份文本；退化 / 无值时返回 `null`（不画假数字）。 */
export function planarMeasurementText(measurement: Measurement3): string | null {
  if (measurement.status !== "valid" || measurement.value === undefined || !Number.isFinite(measurement.value)) return null
  const name = measurement.metric === "dihedral"
    ? (measurement.dihedralKind === "exterior" ? "二面角外角" : "二面角内角")
    : METRIC_NAMES[measurement.metric]
  return `${name}：${measurement.value.toFixed(3)}${measurement.unit ?? ""}`
}

const midpoint = (first: Coordinate, second: Coordinate): Coordinate => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 })

const centroid = (points: Coordinate[]): Coordinate => points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })

/**
 * 标签放在哪儿（按度量类型）：
 * - 长度 = 两点中点；
 * - 距离 = **垂足与第三点的中点**（三点情形；两点情形就是两点中点）——把数字摆在垂线段中间，
 *   而不是摆在被测量的那个点上，不然看不出量的是哪一段；
 * - 角度 = 顶点沿**角平分线**外偏一点（不压在顶点上，也不压住某一条边）；
 * - 面积 = 三个来源点的形心（正落在图形内部）。
 *
 * 位置算不出来（点重合、直线退化）时返回 `null`：那说明这份测量的几何本身站不住，
 * 此时多半 `status` 也已不是 `valid`，两条防线都拦着，不会画出一个凭空飘着的数字。
 */
export function planarMeasurementPosition(measurement: Measurement3, points: Coordinate[]): Coordinate | null {
  if (measurement.metric === "length" && points.length >= 2) return midpoint(points[0], points[1])
  if (measurement.metric === "distance") {
    if (points.length === 2) return midpoint(points[0], points[1])
    const [first, second, target] = points
    if (!first || !second || !target) return null
    const dx = second.x - first.x
    const dy = second.y - first.y
    const lengthSquared = dx * dx + dy * dy
    if (!(lengthSquared > 1e-24)) return null
    // 垂足 = 直线上的投影点；`signedDistanceToLine` 量的是同一份几何（见内核）。
    const ratio = ((target.x - first.x) * dx + (target.y - first.y) * dy) / lengthSquared
    return midpoint({ x: first.x + dx * ratio, y: first.y + dy * ratio }, target)
  }
  if (measurement.metric === "angle" && points.length >= 3) {
    /**
     * 顶点固定是**第 2 个选中的点**（下标 1）：平面角度的按钮就写着
     * 「角度（第二个点作顶点）」（见 `spatialTools.planarMeasurementOptions`），内核的
     * `evaluatePlanarMeasurement` 也按 `vertexIndex ?? 1` 取顶点——三处说的是同一件事。
     */
    const index = 1
    const vertex = points[index]
    const others = points.filter((_, position) => position !== index)
    if (!vertex || others.length < 2) return null
    const first = { x: others[0].x - vertex.x, y: others[0].y - vertex.y }
    const second = { x: others[1].x - vertex.x, y: others[1].y - vertex.y }
    const lengthFirst = Math.hypot(first.x, first.y)
    const lengthSecond = Math.hypot(second.x, second.y)
    if (!(lengthFirst > 1e-12) || !(lengthSecond > 1e-12)) return null
    const bisector = { x: first.x / lengthFirst + second.x / lengthSecond, y: first.y / lengthFirst + second.y / lengthSecond }
    const lengthBisector = Math.hypot(bisector.x, bisector.y)
    // 平角（两边正好相反）时角平分线退化为零向量：改取其中一条边的法向，仍然偏在角的内外一侧。
    const direction = lengthBisector > 1e-12
      ? { x: bisector.x / lengthBisector, y: bisector.y / lengthBisector }
      : { x: -first.y / lengthFirst, y: first.x / lengthFirst }
    const offset = Math.max(0.2, 0.25 * Math.min(lengthFirst, lengthSecond))
    return { x: vertex.x + direction.x * offset, y: vertex.y + direction.y * offset }
  }
  if (measurement.metric === "area" && points.length >= 3) return centroid(points)
  return null
}

/**
 * 实体版的标签位置。
 *
 * 与点版的区别只在新来源上：
 * - 单个圆类（面积 / 周长 / 半径）⇒ 摆在**圆心**；
 * - 两条线类（夹角）⇒ 摆在两条线中点连线的中点（两线平行时那是中间地带，相交时也在交点附近）；
 * - 其余情形仍然走点版逻辑（点 + 线类的垂距沿用三点那套垂足）。
 */
export function planarMeasurementPositionFor(measurement: Measurement3, entities: MeasurableEntity[]): Coordinate | null {
  if (entities.length === 1 && entities[0].kind === "circle") return entities[0].center
  const lines = entities.filter((entity): entity is Extract<MeasurableEntity, { kind: "line" }> => entity.kind === "line")
  if (measurement.metric === "angle" && entities.length === 2 && lines.length === 2) {
    return midpoint(midpoint(lines[0].a, lines[0].b), midpoint(lines[1].a, lines[1].b))
  }
  if (measurement.metric === "distance" && lines.length === 1) {
    const target = entities.find((entity) => entity.kind === "point")
    if (target?.kind === "point") {
      const { a, b } = lines[0]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSquared = dx * dx + dy * dy
      if (!(lengthSquared > 1e-24)) return null
      const ratio = ((target.position.x - a.x) * dx + (target.position.y - a.y) * dy) / lengthSquared
      return midpoint({ x: a.x + dx * ratio, y: a.y + dy * ratio }, target.position)
    }
  }
  // 点类来源：交回既有实现（它同时负责三点角度与垂距的摆法）。
  const points = entities.filter((entity) => entity.kind === "point").map((entity) => entity.position)
  return planarMeasurementPosition(measurement, points)
}

/** 画布上要画的全部测量数字（按文档顺序）。 */
export function planarMeasurementVisuals(document: GeometryDocument, selectedIds: readonly string[] = []): PlanarMeasurementLabel[] {
  /**
   * 来源解析成**实体**：以前只认点，于是"圆的面积""两线夹角"这类测量在画布上根本没有数字
   * （用户口径里的"常驻数字"只对点类测量成立）。
   */
  const resolve = entityResolverFor(document.primitives)
  const labels: PlanarMeasurementLabel[] = []
  for (const measurement of document.measurements) {
    const text = planarMeasurementText(measurement)
    if (!text) continue
    // 来源缺失就不产出：位置无从谈起，硬摆一个会指向空气。
    const entities = measurement.sourceIds.map((id) => resolve(id))
    if (entities.some((entity) => !entity)) continue
    const position = planarMeasurementPositionFor(measurement, entities as MeasurableEntity[])
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue
    labels.push({ id: measurement.id, text, position, selected: measurement.sourceIds.some((id) => selectedIds.includes(id)) })
  }
  return labels
}

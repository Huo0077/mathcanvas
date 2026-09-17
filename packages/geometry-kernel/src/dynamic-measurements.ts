import type { Coordinate } from "@draw/dsl"

import { createDependencyGraph, type DependencyGraph } from "./dependency-graph"

/**
 * 动态测量（Dynamic Measurements）
 *
 * 测量对象是依赖图上的**叶子节点**：它自己不参与几何重算，只观察一组几何实体，吐出一个标量。
 * 这样设计的两个好处：
 *
 *   1. 测量的重算天然被剪枝 —— 一次拖拽里如果斜率没变，夹角就不会被重算；
 *   2. UI 层只需要"拉"和"推"两个入口：`readings()` 拉全量，`subscribe()` 推增量。
 *      渲染层永远不自己算几何，只读读数，于是画布与面板不可能显示不一致的值。
 *
 * 现状：纯函数部分（`evaluatePlanarMeasurement` 及下面那些几何量）是生产路径，
 * 应用与场景图都在用；订阅引擎 `createMeasurementEngine` 尚未接线，
 * 详见本文件"测量引擎"一节开头的说明。
 *
 * 状态语义（与 3D 测量保持一致）：
 *   valid              有确定的值
 *   degenerate         几何退化（重合点、零向量、三点共线导致面积为零）
 *   insufficient-data  引用的对象缺失或坐标无定义
 *   numeric-failure    计算结果非有限（溢出/定义域外）
 */

export type PlanarMetric =
  | "length"
  | "distance"
  | "angle"
  | "slope"
  | "area"
  | "signedArea"
  | "radius"
  | "ratio"
  | "coordinate"
  | "perimeter"

export type MeasurementStatus = "valid" | "degenerate" | "insufficient-data" | "numeric-failure"

export interface PlanarMeasurement {
  id: string
  metric: PlanarMetric
  /** 参与测量的实体 id，顺序有意义（角度是 [A, V, B]，周长是顶点环）。 */
  sourceIds: string[]
  /**
   * 角度语义：
   *   interior  内角，[0, π]
   *   exterior  外角，2π − interior
   *   oriented  有向角 atan2(cross, dot)，(−π, π]，可以区分顺时针/逆时针
   * 缺省 interior。
   */
  angleKind?: "interior" | "exterior" | "oriented"
  /** 角顶点在 `sourceIds` 中的下标，缺省 1（即 [A, V, B] 的 V）。 */
  vertexIndex?: number
  /** `coordinate` 取哪个分量。 */
  component?: "x" | "y"
  /** 显示精度（小数位数），只影响 `display` 字段，不影响数值。 */
  precision?: number
  label?: string
}

export interface MeasurementReading {
  id: string
  metric: PlanarMetric
  label?: string
  value: number | null
  /** 长度类为 "u"，角度类为 "rad"。 */
  unit: string
  /** 角度专用的度数表示，避免每个消费方各写一遍换算。 */
  degrees?: number
  status: MeasurementStatus
  explanation: string
  /** 数值的格式化串，尊重 `precision`。 */
  display: string | null
  sourceIds: string[]
}

export type CoordinateResolver = (id: string) => Coordinate | null

// ---------------------------------------------------------------------------
// 基础几何量的纯函数实现
// ---------------------------------------------------------------------------

export function lengthBetween(first: Coordinate, second: Coordinate): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

/**
 * 夹角。
 * 用 `atan2(|cross|, dot)` 而不是 `acos(dot / (|u||v|))`：后者在角度接近 0 或 π 时
 * 会因为浮点误差把参数推出 [-1, 1] 得到 NaN，这是几何软件里最常见的"角度突然变成 NaN"的来源。
 */
export function angleBetween(vertex: Coordinate, first: Coordinate, second: Coordinate, kind: "interior" | "exterior" | "oriented" = "interior"): number | null {
  const ux = first.x - vertex.x
  const uy = first.y - vertex.y
  const vx = second.x - vertex.x
  const vy = second.y - vertex.y
  const uLength = Math.hypot(ux, uy)
  const vLength = Math.hypot(vx, vy)
  if (!(uLength > 1e-12) || !(vLength > 1e-12)) return null
  const cross = ux * vy - uy * vx
  const dot = ux * vx + uy * vy
  if (kind === "oriented") return Math.atan2(cross, dot)
  const interior = Math.atan2(Math.abs(cross), dot)
  return kind === "exterior" ? Math.PI * 2 - interior : interior
}

/** 有向面积：逆时针为正。三角形 = 叉积的一半，多边形 = 鞋带公式的一半。 */
export function signedPolygonArea(points: readonly Coordinate[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }
  return sum / 2
}

export function polygonPerimeter(points: readonly Coordinate[]): number {
  if (points.length < 2) return 0
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    total += lengthBetween(points[index], points[(index + 1) % points.length])
  }
  return total
}

/**
 * 点到直线的有符号距离（用前两个点定义直线）。
 * 返回 `null` 表示这两个点重合、直线退化。
 */
export function signedDistanceToLine(first: Coordinate, second: Coordinate, point: Coordinate): number | null {
  const dx = second.x - first.x
  const dy = second.y - first.y
  const length = Math.hypot(dx, dy)
  if (!(length > 1e-12)) return null
  return ((point.x - first.x) * dy - (point.y - first.y) * dx) / length
}

function invalid(measurement: PlanarMeasurement, status: MeasurementStatus, explanation: string): MeasurementReading {
  return {
    id: measurement.id,
    metric: measurement.metric,
    ...(measurement.label === undefined ? {} : { label: measurement.label }),
    value: null,
    unit: measurement.metric === "angle" ? "rad" : "u",
    status,
    explanation,
    display: null,
    sourceIds: [...measurement.sourceIds]
  }
}

function formatValue(value: number, precision: number | undefined): string {
  const digits = Math.min(12, Math.max(0, precision ?? 4))
  const rounded = Number(value.toFixed(digits))
  // 消掉 "-0"：把 −1e-15 度显示成 "-0.0000°" 会被当成真实的负角。
  return Object.is(rounded, -0) ? (0).toFixed(digits) : rounded.toFixed(digits)
}

/**
 * 求一个测量的读数。纯函数：只依赖 `resolve` 给出的点坐标，不持有任何状态。
 * 因此它同时可以用于"画布上实时显示"和"离线导出读数表"。
 */
export function evaluatePlanarMeasurement(measurement: PlanarMeasurement, resolve: CoordinateResolver): MeasurementReading {
  const { metric, sourceIds } = measurement
  const points: (Coordinate | null)[] = sourceIds.map((id) => resolve(id))
  const missing = points.some((point) => !point)
  if (missing && metric !== "coordinate") {
    return invalid(measurement, "insufficient-data", "引用的几何对象不存在或坐标无定义。")
  }
  const solid = (): Coordinate[] => points.filter((point): point is Coordinate => Boolean(point))
  const nonFinite = (value: number) => !Number.isFinite(value)
  const succeed = (value: number, unit: string, degrees?: number): MeasurementReading => {
    if (nonFinite(value)) return invalid(measurement, "numeric-failure", "测量计算结果不是有限数。")
    return {
      id: measurement.id,
      metric,
      ...(measurement.label === undefined ? {} : { label: measurement.label }),
      value,
      unit,
      ...(degrees === undefined || nonFinite(degrees) ? {} : { degrees }),
      status: "valid",
      explanation: "",
      display: formatValue(value, measurement.precision),
      sourceIds: [...sourceIds]
    }
  }

  switch (metric) {
    case "length": {
      if (points.length < 2 || !points[0] || !points[1]) return invalid(measurement, "insufficient-data", "长度需要两个点。")
      const distance = lengthBetween(points[0], points[1])
      if (distance <= 1e-12) return invalid(measurement, "degenerate", "两个点重合，长度为 0。")
      return succeed(distance, "u")
    }
    case "distance": {
      if (points.length < 2) return invalid(measurement, "insufficient-data", "距离需要一个点与一条由两点定义的直线。")
      if (points.length === 2 && points[0] && points[1]) {
        const distance = lengthBetween(points[0], points[1])
        if (distance <= 1e-12) return invalid(measurement, "degenerate", "两个点重合，距离为 0。")
        return succeed(distance, "u")
      }
      const [first, second, target] = points
      if (!first || !second || !target) return invalid(measurement, "insufficient-data", "距离需要三个有效点。")
      const distance = signedDistanceToLine(first, second, target)
      if (distance === null) return invalid(measurement, "degenerate", "定义直线的两点重合。")
      return succeed(Math.abs(distance), "u")
    }
    case "angle": {
      if (points.length < 3) return invalid(measurement, "insufficient-data", "角度需要三个点 [A, V, B]。")
      const index = Math.min(Math.max(measurement.vertexIndex ?? 1, 0), points.length - 1)
      const vertex = points[index]
      const others = solid().filter((point) => point !== vertex)
      if (!vertex || others.length < 2) return invalid(measurement, "insufficient-data", "角顶点缺失。")
      const radians = angleBetween(vertex, others[0], others[1], measurement.angleKind ?? "interior")
      if (radians === null) return invalid(measurement, "degenerate", "角的一边退化为零向量。")
      return succeed(radians, "rad", radians * 180 / Math.PI)
    }
    case "slope": {
      if (points.length < 2 || !points[0] || !points[1]) return invalid(measurement, "insufficient-data", "斜率需要两个点。")
      const deltaX = points[1].x - points[0].x
      if (Math.abs(deltaX) <= 1e-12) return invalid(measurement, "degenerate", "两点竖直，斜率不存在（无穷大）。")
      return succeed((points[1].y - points[0].y) / deltaX, "")
    }
    case "area":
    case "signedArea": {
      const polygon = solid()
      if (polygon.length < 3) return invalid(measurement, "insufficient-data", "面积至少需要三个点。")
      const area = signedPolygonArea(polygon)
      if (Math.abs(area) <= 1e-12) return invalid(measurement, "degenerate", "三点共线，面积为 0。")
      return succeed(metric === "signedArea" ? area : Math.abs(area), "u²")
    }
    case "perimeter": {
      const polygon = solid()
      if (polygon.length < 3) return invalid(measurement, "insufficient-data", "周长至少需要三个点。")
      return succeed(polygonPerimeter(polygon), "u")
    }
    case "radius": {
      if (!points[0]) return invalid(measurement, "insufficient-data", "半径需要一个圆或一个圆心加一个圆上点。")
      if (points.length >= 2 && points[1]) {
        const radius = lengthBetween(points[0], points[1])
        return radius <= 1e-12 ? invalid(measurement, "degenerate", "圆心与圆上点重合。") : succeed(radius, "u")
      }
      return invalid(measurement, "insufficient-data", "半径需要圆心与圆上点两个对象。")
    }
    case "ratio": {
      if (points.length < 4) return invalid(measurement, "insufficient-data", "比值需要两段线段（四个点）。")
      const [a, b, c, d] = points
      if (!a || !b || !c || !d) return invalid(measurement, "insufficient-data", "比值引用的点缺失。")
      const denominator = lengthBetween(c, d)
      if (denominator <= 1e-12) return invalid(measurement, "degenerate", "作为分母的线段长度为 0。")
      return succeed(lengthBetween(a, b) / denominator, "")
    }
    case "coordinate": {
      const point = points[0]
      if (!point) return invalid(measurement, "insufficient-data", "坐标测量引用的点不存在。")
      return succeed(measurement.component === "y" ? point.y : point.x, "u")
    }
    default:
      return invalid(measurement, "insufficient-data", `不支持的测量类型：${String(metric)}`)
  }
}

// ---------------------------------------------------------------------------
// 测量引擎（属性监听器）
// ---------------------------------------------------------------------------
/*
 * ⚠️ 未接入的公开 API：`createMeasurementEngine` 目前**没有生产调用者**。
 *
 * 应用里的测量走的是场景图那条路：测量是依赖图的叶子，`recomputeDerivedObjects`
 * 在每次改动后统一重算，读数由 `evaluatePlanarMeasurement` 算出
 * （见 `packages/scene-graph/src/operations.ts` 的 `recomputeMeasurements` 与 `apps/web/src/App.tsx`）。
 * 所以"测量会不会被漏算"由场景图的剪枝保证，不靠这里的订阅。
 *
 * 留着的理由：它提供的是另一条通道——**拉（`readings()`）推（`subscribe()`）**、
 * 变化判定以"上一次对外报告的值"为基准（连续小幅漂移会累积到容差后上报，而不是被逐步吞掉）、
 * 并且自带状态迁移（valid ↔ 退化）的区分。将来若要做"读数表实时刷新"或"离线导出读数序列"，
 * 正确的接线方式是：把**同一个** `DependencyGraph` 通过 `options.graph` 传进来（不要各建一张图），
 * 在几何改动后调用 `update(changedIds)`，UI 只处理 `changed` / `statusChanged`。
 *
 * 接线之前不要在两个地方各算一遍读数：那会让同一个测量出现两个真值来源。
 */

export interface MeasurementChangeSet {
  /** 本次重算涉及的全部读数（按测量定义顺序）。 */
  readings: MeasurementReading[]
  /** 值真的变了的读数 —— UI 只需要处理这一部分。 */
  changed: MeasurementReading[]
  /** 状态从 valid 变成非 valid（或反向）的读数，用于提示"图形退化了"。 */
  statusChanged: MeasurementReading[]
}

export interface MeasurementEngine {
  readonly graph: DependencyGraph
  define(measurement: PlanarMeasurement): void
  remove(id: string): boolean
  has(id: string): boolean
  read(id: string): MeasurementReading | undefined
  readings(): readonly MeasurementReading[]
  /**
   * 几何变化后刷新。
   * `changedIds` 是刚被改动的几何对象；引擎只在依赖图里找**真正依赖它们**的测量，其余不动。
   */
  update(changedIds: readonly string[]): MeasurementChangeSet
  refreshAll(): MeasurementChangeSet
  /**
   * 订阅值变化。回调只收到变化的读数，且变化判定带容差 ——
   * 拖拽时浮点噪声会让第 12 位小数每次都变，不设容差的话 UI 会被无意义的重绘淹没。
   */
  subscribe(listener: (change: MeasurementChangeSet) => void): () => void
}

export interface MeasurementEngineOptions {
  /** 与几何对象共享的依赖图。测量会作为叶子节点加进去。 */
  graph?: DependencyGraph
  /** 读取某个几何对象的当前坐标。返回 null 表示该对象不是点或坐标无定义。 */
  positions: () => ReadonlyMap<string, Coordinate>
  /** 数值变化的相对容差，缺省 1e-9。 */
  tolerance?: number
}

/** 建一个测量引擎。注意：**当前没有生产调用者**，接线方式见上方"未接入的公开 API"说明。 */
export function createMeasurementEngine(options: MeasurementEngineOptions): MeasurementEngine {
  const graph = options.graph ?? createDependencyGraph()
  const tolerance = options.tolerance ?? 1e-9
  const definitions = new Map<string, PlanarMeasurement>()
  const readings = new Map<string, MeasurementReading>()
  /**
   * 上一次**对外报告**过的读数，专门用来做变化判定。
   *
   * 不能拿"上一次算出来的值"当基准：那样连续的小幅漂移会被逐步吞掉 —— 每一步都相对上一步很小，
   * 于是永远不通知，UI 会一直显示一个已经偏离很远的旧值。以报告值为基准，漂移会累积，
   * 累积量一旦跨越容差就通知一次。
   */
  const reported = new Map<string, MeasurementReading>()
  const listeners = new Set<(change: MeasurementChangeSet) => void>()

  const nodeId = (id: string) => `measure:${id}`

  const changedBeyondTolerance = (next: MeasurementReading, previous: MeasurementReading | undefined): boolean => {
    if (!previous) return true
    if (next.status !== previous.status) return true
    if (next.value === null || previous.value === null) return next.value !== previous.value
    const scale = Math.max(1, Math.abs(next.value), Math.abs(previous.value))
    return Math.abs(next.value - previous.value) > tolerance * scale
  }

  const compute = (ids: readonly string[]): MeasurementChangeSet => {
    const positions = options.positions()
    const resolve: CoordinateResolver = (id) => positions.get(id) ?? null
    const changed: MeasurementReading[] = []
    const statusChanged: MeasurementReading[] = []
    const touched: MeasurementReading[] = []
    for (const id of ids) {
      const definition = definitions.get(id)
      if (!definition) continue
      const previous = reported.get(id)
      const next = evaluatePlanarMeasurement(definition, resolve)
      readings.set(id, next)
      touched.push(next)
      if (changedBeyondTolerance(next, previous)) {
        changed.push(next)
        reported.set(id, next)
      }
      if (previous && previous.status !== next.status) statusChanged.push(next)
    }
    return { readings: touched, changed, statusChanged }
  }

  const engine: MeasurementEngine = {
    graph,
    define(measurement) {
      definitions.set(measurement.id, { ...measurement, sourceIds: [...measurement.sourceIds] })
      // 每个测量是依赖图上的一个叶子：依赖它的全部来源对象。
      graph.addNode(nodeId(measurement.id), measurement.sourceIds)
    },
    remove(id) {
      if (!definitions.delete(id)) return false
      readings.delete(id)
      reported.delete(id)
      graph.removeNode(nodeId(id))
      return true
    },
    has: (id) => definitions.has(id),
    read: (id) => readings.get(id),
    readings: () => [...definitions.keys()].map((id) => readings.get(id)).filter((reading): reading is MeasurementReading => Boolean(reading)),
    update(changedIds) {
      // 脏闭包把"几何变更"和"测量叶子"连起来；只取测量节点，几何重算不归本引擎管。
      const dirty = graph.dirtyClosure(changedIds)
      const ids = new Set(dirty.filter((id) => id.startsWith("measure:")).map((id) => id.slice("measure:".length)))
      // 从未求过值的测量必须补算，否则它永远等不到一次"自己变脏"的机会。
      for (const id of definitions.keys()) if (!readings.has(id)) ids.add(id)
      const change = compute([...ids])
      if (change.changed.length > 0) {
        for (const listener of [...listeners]) listener(change)
      }
      return change
    },
    refreshAll() {
      const change = compute([...definitions.keys()])
      if (change.readings.length > 0) {
        for (const listener of [...listeners]) listener(change)
      }
      return change
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
  return engine
}

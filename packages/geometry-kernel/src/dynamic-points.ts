import type { Coordinate } from "@draw/dsl"

import type { ConstraintProjection, PlanarConstraint, ProjectOptions } from "./planar-constraints"

/**
 * 动点（Dynamic Point）
 *
 * 核心不变式：**参数是唯一真值，坐标是它的派生缓存。**
 *
 *     point = constraint.evaluate(parameter, branch)
 *
 * 任何一次更新都只写 `parameter` / `branch`，坐标随即由约束重新求值。这样点永远**精确落在**约束上，
 * 不会像"先算坐标再事后吸附"的实现那样在连续拖动后慢慢漂离曲线（动态几何软件最经典的数值缺陷）。
 *
 * 自由度说明：本抽象描述的是**单自由度**的点（被一条曲线约束）。完全自由的点有 2 个自由度，
 * 不属于 `PlanarConstraint` 模型，仍走文档里直接改 x/y 的老路径 —— 这条边界是有意划的，
 * 把自由点硬塞进参数化模型只会让两边都变复杂。
 */

export interface DynamicPointState {
  readonly id: string
  readonly constraintId: string
  readonly point: Coordinate
  readonly parameter: number
  readonly branch: number
  /** 约束在该参数处有定义。为 false 时 `point` 是最后一次有效的坐标。 */
  readonly valid: boolean
}

export interface PointMoveResult {
  /** 坐标真的动了（超出容差）。false 时调用方**不应**标脏依赖图。 */
  changed: boolean
  point: Coordinate
  parameter: number
  branch: number
  /** 请求位置到约束的吸附距离。拖动时可以用来提示"点跟不上鼠标"。 */
  snapDistance: number
  /** 投影/迭代收敛。false 表示这次移动的结果不可信，UI 可以拒绝提交。 */
  converged: boolean
  /** 参数被边界截断（线段端点、圆弧端点、函数定义域端点）。 */
  clamped: boolean
}

const MOTION_EPSILON = 1e-12

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** 周期参数折叠到 [min, max)，避免长时间动画后参数无限增大而丢精度。 */
function wrapParameter(parameter: number, min: number, max: number): number {
  const span = max - min
  if (!(span > 0) || !Number.isFinite(span)) return parameter
  const offset = (parameter - min) % span
  return min + (offset < 0 ? offset + span : offset)
}

export class DynamicPoint {
  readonly id: string
  readonly constraint: PlanarConstraint

  private parameterValue: number
  private branchValue: number
  private pointValue: Coordinate
  private validValue: boolean

  constructor(id: string, constraint: PlanarConstraint, initial: { parameter?: number; branch?: number } = {}) {
    this.id = id
    this.constraint = constraint
    this.branchValue = clamp(Math.round(initial.branch ?? 0), 0, Math.max(0, constraint.branchCount - 1))
    const bounds = constraint.parameterBounds(this.branchValue)
    const seeded = initial.parameter ?? (Number.isFinite(bounds.min) ? bounds.min : 0)
    this.parameterValue = bounds.wrap ? wrapParameter(seeded, bounds.min, bounds.max) : seeded
    const point = constraint.evaluate(this.parameterValue, this.branchValue)
    this.pointValue = point ?? { x: Number.NaN, y: Number.NaN }
    this.validValue = Boolean(point)
  }

  get state(): DynamicPointState {
    return {
      id: this.id,
      constraintId: this.constraint.id,
      point: { ...this.pointValue },
      parameter: this.parameterValue,
      branch: this.branchValue,
      valid: this.validValue
    }
  }

  get position(): Coordinate {
    return { ...this.pointValue }
  }

  /** 把 {parameter, branch} 写进去并同步坐标。所有状态变更的唯一出口。 */
  private apply(parameter: number, branch: number, snapDistance: number, converged: boolean, clamped: boolean): PointMoveResult {
    const bounds = this.constraint.parameterBounds(branch)
    const previousPoint = this.pointValue
    const previousParameter = this.parameterValue
    this.branchValue = branch
    this.parameterValue = parameter
    const point = this.constraint.evaluate(parameter, branch)
    if (point) {
      this.pointValue = point
      this.validValue = true
    } else {
      // 约束在目标参数处无定义（例如函数图像的间断点）：保留上一次的有效坐标，
      // 但参数**照写**，这样把 x 拖回定义域时点会立刻恢复，而不是卡在原地。
      this.validValue = false
    }
    const changed = this.validValue
      ? Math.hypot(this.pointValue.x - previousPoint.x, this.pointValue.y - previousPoint.y) > MOTION_EPSILON
      : Math.abs(parameter - previousParameter) > MOTION_EPSILON
    return {
      changed,
      point: { ...this.pointValue },
      parameter: this.parameterValue,
      branch: this.branchValue,
      snapDistance,
      converged,
      clamped
    }
  }

  /**
   * 拖拽入口：把点移到离 `desired` 最近的合法位置。
   *
   * 反向映射由约束负责，动点只做三件事：
   *   1. 把上一次的参数传下去，换取**连续性**（不换分支、不跳到曲线另一端）；
   *   2. 把投影出来的点重新用 `evaluate` 求值，保证坐标严格落在曲线上；
   *   3. 报告吸附距离与是否被边界截断。
   */
  moveTo(desired: Coordinate, options: ProjectOptions = {}): PointMoveResult {
    const projection = this.constraint.project(desired, {
      previousParameter: options.previousParameter ?? this.parameterValue,
      previousBranch: options.previousBranch ?? this.branchValue,
      maxIterations: options.maxIterations,
      tolerance: options.tolerance
    })
    if (!projection) {
      // 投影失败（退化约束）。不动参数，明确报告未收敛，让调用方回滚。
      return {
        changed: false,
        point: { ...this.pointValue },
        parameter: this.parameterValue,
        branch: this.branchValue,
        snapDistance: Number.POSITIVE_INFINITY,
        converged: false,
        clamped: false
      }
    }
    return this.commit(projection.parameter, projection.branch, projection.distance, projection.converged, projection.clamped)
  }

  /**
   * 参数入口：滑块 / 动画 / 轨迹采样都走这里。
   * 与 `moveTo` 共享同一个提交路径，因此"拖出来的点"和"播放出来的点"在依赖图里完全等价。
   */
  setParameter(parameter: number, branch?: number): PointMoveResult {
    if (!Number.isFinite(parameter)) {
      return { changed: false, point: { ...this.pointValue }, parameter: this.parameterValue, branch: this.branchValue, snapDistance: Number.NaN, converged: false, clamped: false }
    }
    const targetBranch = clamp(Math.round(branch ?? this.branchValue), 0, Math.max(0, this.constraint.branchCount - 1))
    const clamped = this.constrain(parameter, targetBranch)
    return this.commit(clamped.parameter, targetBranch, 0, true, clamped.clamped)
  }

  /** 按住不动时其他实体变化导致约束本身改变（例如 A、B 被拖动），用这个重新求值。 */
  refresh(): PointMoveResult {
    const clamped = this.constrain(this.parameterValue, this.branchValue)
    return this.commit(clamped.parameter, this.branchValue, 0, true, clamped.clamped)
  }

  distanceTo(point: Coordinate): number {
    return this.constraint.residual(point)
  }

  private constrain(parameter: number, branch: number): { parameter: number; clamped: boolean } {
    const bounds = this.constraint.parameterBounds(branch)
    if (bounds.wrap) return { parameter: wrapParameter(parameter, bounds.min, bounds.max), clamped: false }
    const bounded = clamp(parameter, bounds.min, bounds.max)
    return { parameter: bounded, clamped: Math.abs(bounded - parameter) > MOTION_EPSILON }
  }

  private commit(parameter: number, branch: number, snapDistance: number, converged: boolean, clamped = false): PointMoveResult {
    // 非有限的参数不允许写入。指针事件的坐标可能是 NaN（事件被取消、缩放矩阵退化等），
    // 一旦写进状态，点会永久消失且再也拖不回来 —— 宁可直接拒绝这一次移动。
    if (!Number.isFinite(parameter)) {
      return {
        changed: false,
        point: { ...this.pointValue },
        parameter: this.parameterValue,
        branch: this.branchValue,
        snapDistance,
        converged: false,
        clamped: false
      }
    }
    const constrained = this.constrain(parameter, branch)
    return this.apply(constrained.parameter, branch, snapDistance, converged, clamped || constrained.clamped)
  }
}

export function createDynamicPoint(id: string, constraint: PlanarConstraint, initial?: { parameter?: number; branch?: number }): DynamicPoint {
  return new DynamicPoint(id, constraint, initial)
}

/**
 * 拖拽会话。
 *
 * 直接 `moveTo(pointer)` 会让点瞬移到光标下，手感是"跳"。真实交互里抓取点与被抓图元的相对位置必须保持：
 * 会话在开始时记录一次偏移，之后每帧都把 `pointer - offset` 送进 `moveTo`。
 * 偏移量用**初始参数处**的切向投影表示，这样沿曲线拖动时手感恒定，而不是按屏幕像素死记。
 */
export interface DragSession {
  readonly offset: Coordinate
  update(pointer: Coordinate): PointMoveResult
}

export function beginDrag(point: DynamicPoint, pointer: Coordinate): DragSession {
  const origin = point.position
  const offset = { x: pointer.x - origin.x, y: pointer.y - origin.y }
  return {
    offset,
    update: (next: Coordinate) => point.moveTo({ x: next.x - offset.x, y: next.y - offset.y })
  }
}

/** 一批动点的批量更新结果，供依赖图决定从哪里开始重算。 */
export interface PointUpdateBatch {
  changedPointIds: string[]
  movedConstraintIds: string[]
  results: Map<string, PointMoveResult>
}

export function movePoints(points: readonly DynamicPoint[], targets: ReadonlyMap<string, Coordinate>): PointUpdateBatch {
  const results = new Map<string, PointMoveResult>()
  const changedPointIds: string[] = []
  const movedConstraintIds = new Set<string>()
  for (const point of points) {
    const target = targets.get(point.id)
    if (!target) continue
    const result = point.moveTo(target)
    results.set(point.id, result)
    if (!result.changed) continue
    changedPointIds.push(point.id)
    movedConstraintIds.add(point.constraint.id)
  }
  return { changedPointIds, movedConstraintIds: [...movedConstraintIds], results }
}

/** 沿约束扫一遍参数并收集驱动出来的从动点坐标 —— 轨迹采样的最小接口。 */
export function traceParameters(
  point: DynamicPoint,
  parameters: readonly number[],
  branch?: number
): (Coordinate | null)[] {
  const restore = point.state
  const traced = parameters.map((parameter) => {
    const result = point.setParameter(parameter, branch)
    return result.converged && Number.isFinite(result.point.x) && Number.isFinite(result.point.y) ? result.point : null
  })
  point.setParameter(restore.parameter, restore.branch)
  return traced
}

export type { ConstraintProjection }

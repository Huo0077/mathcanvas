import type { Coordinate } from "@draw/dsl"

import { sampleLocus } from "../locus-sampling"
import { coordinateInput, degenerateDiagnostic, missingSourceDiagnostic, resolvedValue } from "./evaluator"
import type { ReactiveGraph } from "./graph"
import type { EvaluationResult, LocusNode } from "./types"

/**
 * **轨迹与交互轨迹**（设计规格 §4.4）。
 *
 * 规格把两者分得很清楚：
 *
 * - 持久化 `Locus` 是文档里的对象，用**自适应采样**算出来；
 * - 交互临时 `Trace` 不产生历史节点，用户抬手后可以选择把它保留为 Locus。
 *
 * `sampleLocusFromGraph` 把这两件事接起来：它只驱动**一个参数节点**，靠图的增量求值把
 * "参数 → 动点坐标"取回来（不是整份文档重算一遍），再把采样交给既有的 `sampleLocus`
 * （自适应细分、跨断点分支）。采样结束后参数回到原处 —— 预览不能顺手改真值。
 *
 * `createTransientTrace` 是 Trace 的内存缓冲：**不写文档、不进撤销历史、不产生图节点**。
 */

export interface LocusGraphSamplingOptions {
  readonly graph: ReactiveGraph
  /** 被驱动的动点节点。 */
  readonly pointId: string
  /** 驱动参数节点。 */
  readonly parameterId: string
  readonly domain: readonly [number, number]
  readonly samples?: number
  readonly tolerance?: number
  readonly jumpFactor?: number
  readonly maxJump?: number
  readonly maxDepth?: number
  readonly breakDepth?: number
  readonly maxEvaluations?: number
  readonly branch?: number
}

export interface LocusGraphSamplingResult {
  /** 按参数顺序排列的连通分支（消费方不要跨分支连线）。 */
  readonly branches: readonly (readonly Coordinate[])[]
  /** 驱动了几次图求值（增量预算的读数）。 */
  readonly evaluations: number
  readonly breaks: readonly number[]
  readonly truncated: boolean
}

const DEFAULT_SAMPLES = 64

export function sampleLocusFromGraph(options: LocusGraphSamplingOptions): LocusGraphSamplingResult {
  const previous = options.graph.parameterValue(options.parameterId)
  /** 复用的读取缓冲：每个采样点只换这一个键，避免每帧新建 Map。 */
  const sampleInputs = new Map<string, EvaluationResult<unknown>>()
  const drive = (parameter: number): Coordinate | null => {
    options.graph.setParameter(options.parameterId, parameter)
    options.graph.evaluate([options.parameterId])
    sampleInputs.set(options.pointId, options.graph.result(options.pointId) as EvaluationResult<unknown>)
    return coordinateInput(sampleInputs, options.pointId)
  }
  const result = sampleLocus(drive, {
    domain: options.domain,
    samples: options.samples ?? DEFAULT_SAMPLES,
    ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    ...(options.jumpFactor === undefined ? {} : { jumpFactor: options.jumpFactor }),
    ...(options.maxJump === undefined ? {} : { maxJump: options.maxJump }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.breakDepth === undefined ? {} : { breakDepth: options.breakDepth }),
    ...(options.maxEvaluations === undefined ? {} : { maxEvaluations: options.maxEvaluations }),
    ...(options.branch === undefined ? {} : { branch: options.branch })
  })
  // 采样是**只读遍历**：参数必须回到采样前的那一个（否则一次"看轨迹"就改了真值）。
  if (previous !== undefined) {
    options.graph.setParameter(options.parameterId, previous)
    options.graph.evaluate([options.parameterId])
  }
  return { branches: result.branches.map((branch) => branch.points), evaluations: result.evaluations, breaks: result.breaks, truncated: result.truncated }
}

/**
 * 交互时的临时轨迹缓冲。
 *
 * 它只活在内存里：`record` 只是往数组里塞一个点，**不写文档、不压历史、不建节点** ——
 * 这正是"未确认的拖动预览不得进入撤销历史"这条不变式在轨迹上的体现。
 * 用户抬手后可以把这个缓冲区交给 `locusNode`（或写成一个 Locus 图元）保留下来。
 */
export interface TransientTrace {
  record(point: Coordinate): void
  readonly points: readonly Coordinate[]
  clear(): void
}

export const DEFAULT_TRACE_POINTS = 512

export function createTransientTrace(options: { maxPoints?: number } = {}): TransientTrace {
  const maxPoints = Math.max(1, Math.floor(options.maxPoints ?? DEFAULT_TRACE_POINTS))
  let buffer: Coordinate[] = []
  return {
    record(point) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
      buffer.push({ x: point.x, y: point.y })
      // 滑动窗口：交互轨迹是"就地滚动"的缓冲区，长时间拖动不会把内存吃掉。
      if (buffer.length > maxPoints) buffer = buffer.slice(buffer.length - maxPoints)
    },
    get points() {
      return buffer.map((point) => ({ ...point }))
    },
    clear() {
      buffer = []
    }
  }
}

export interface LocusNodeOptions {
  /** 采样结果节点（值形如 `{ branches: Coordinate[][] }`）。 */
  readonly samplesId: string
}

/**
 * 持久化轨迹节点：读**已经采好的分支**并检查它们的可用性。
 *
 * 采样本身需要"驱动参数 → 求值 → 取点"的循环，纯 evaluator 做不了（那会形成自引用），
 * 所以采样结果由 `sampleLocusFromGraph` 算好之后写进一个来源节点，轨迹节点只负责校验与传播：
 * 空轨迹 / 少于两点的分支都是**退化**（画不出线），而不是"零条线所以画没有"。
 */
export function locusNode(id: string, options: LocusNodeOptions): LocusNode {
  return {
    kind: "locus",
    id,
    dependsOn: [options.samplesId],
    evaluate(inputs) {
      const value = resolvedValue(inputs.get(options.samplesId)) as { branches?: unknown } | undefined
      if (!value || !Array.isArray(value.branches)) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.samplesId, `轨迹采样 ${options.samplesId} 没有可用的分支数据。`) }
      const branches = value.branches as unknown[]
      if (branches.length === 0) return { status: "degenerate", diagnostic: degenerateDiagnostic(id, "轨迹没有采到任何点（动点在参数域内没有定义）。") }
      const points: Coordinate[][] = []
      for (const branch of branches) {
        if (!Array.isArray(branch) || branch.length < 2) return { status: "degenerate", diagnostic: degenerateDiagnostic(id, "轨迹的某个分支少于两个点，连不成线。") }
        const coordinates: Coordinate[] = []
        for (const entry of branch) {
          const point = entry as { x?: unknown; y?: unknown }
          if (typeof point?.x !== "number" || typeof point?.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return { status: "degenerate", diagnostic: degenerateDiagnostic(id, "轨迹里含非有限点。") }
          }
          coordinates.push({ x: point.x, y: point.y })
        }
        points.push(coordinates)
      }
      return { status: "exact", value: points }
    }
  }
}

/** 适配层用：把采样结果写成来源节点的值。 */
export const locusSamplesValue = (branches: readonly (readonly Coordinate[])[]): { branches: readonly (readonly Coordinate[])[] } => ({ branches })

import type { Coordinate, ParameterSpec, Vector3 } from "@draw/dsl"

import { wrapParameter } from "../dynamic-points"
import { normalizeAzimuth, type Host3, type Host3Parameter } from "../hosts3"
import type { ParameterBounds, PlanarConstraint } from "../planar-constraints"
import { invalidDomainDiagnostic, invalidHostDiagnostic, missingSourceDiagnostic, nonFiniteDiagnostic, resolvedValue } from "./evaluator"
import type { ConstraintNode, EvaluationResult } from "./types"

/**
 * **参数化点约束**（设计规格 §4.1/§4.2）。
 *
 * 规格支持的约束：线段 / 直线 / 棱上的一维参数、圆周角度、面上的 `u,v`、实体内部的 `u,v,w`。
 * 这一层把"文档曲线 / 宿主"翻译成**求值节点**：
 *
 * ```text
 * 参数节点(真值) --dependsOn--> 约束节点 --> 坐标(派生缓存)
 * ```
 *
 * 三件事只在**这里**定义一次，别处不许再写一遍：
 * - 参数域语义：闭合宿主（圆、空间圆轨道）**折回**，有界宿主（线段、棱、面、实体）**夹回**，
 *   无界宿主（直线、射线、平面）不截断；`clamped` 如实报告"这个参数被边界截断了"；
 * - 失败语义：宿主解析不了 → `invalid_host`；参数非有限 → `non_finite`；参数处约束无定义 → `invalid_domain`；
 * - 生成参数的归属：`t-<点id>` + `ownerId = 点id`（宿主被删、点降级为自由点之后它就是孤儿）。
 *
 * 注意"折回"**不算**截断：圆上的参数 `θ + 2π` 与 `θ` 是同一个点，把它记成 clamped 会让 UI
 * 对一次正常绕圈报警。
 */

export interface ConstrainedPoint2 {
  readonly point: Coordinate
  readonly parameter: number
  readonly branch: number
  /** 参数被有界宿主的边界截断（线段端点、圆弧端点、面的边界）。 */
  readonly clamped: boolean
}

export interface ConstrainedPoint3 {
  readonly point: Vector3
  readonly parameter: Host3Parameter
  readonly clamped: boolean
}

const MOTION_EPSILON = 1e-12

const unique = (ids: readonly string[]): string[] => [...new Set(ids)]

/** 参数域语义只此一份（规格 §4.2 的"严格域"）。折回与切线、动点共用同一个实现。 */
export function applyParameterBounds(parameter: number, bounds: ParameterBounds): { parameter: number; clamped: boolean } {
  if (bounds.wrap) return { parameter: wrapParameter(parameter, bounds.min, bounds.max), clamped: false }
  const bounded = Math.min(Math.max(parameter, bounds.min), bounds.max)
  return { parameter: bounded, clamped: Math.abs(bounded - parameter) > MOTION_EPSILON }
}

/**
 * **3D 宿主参数的归一化**：闭合宿主（空间圆轨道）折回 `[0, 2π)`，有界宿主（棱 / 面 / 实体内）夹回，
 * 无界宿主（直线 / 平面）原样。
 *
 * 这是与 `applyParameterBounds` 同一套语义的三维版本，**文档层与图共用这一份**：
 * `scene-graph` 的 `resolveBoundPoint3` 直接调它。分成两份实现时两边对"圆周角 π/2 + 4π"
 * 会给出不同的点（一边折回、一边夹到 2π），而它们本该是同一个点。
 */
export function normalizeHostParameter(host: Host3, axis: "u" | "v" | "w", value: number): number {
  if (!Number.isFinite(value)) return value
  const domain = host.domain[axis]
  if (domain === undefined) return value
  if (axis === "u" && host.domain.closedU) return normalizeAzimuth(value)
  return Math.min(Math.max(value, domain[0]), domain[1])
}

function resolvedNumber(inputs: ReadonlyMap<string, EvaluationResult<unknown>>, id: string): number | null {
  const value = resolvedValue(inputs.get(id))
  return typeof value === "number" ? value : null
}

export interface PlanarPointNodeOptions {
  /** 已经解析好的平面约束；宿主不存在 / 类型不支持时给 `null`（节点仍然存在，报 `invalid_host`）。 */
  readonly constraint: PlanarConstraint | null
  /** 参数真源节点（文档参数）。缺省表示这个点没有驱动参数，用 `parameter` 字面量（老文档）。 */
  readonly parameterId?: string
  /** 没有 `parameterId` 时的字面量参数。 */
  readonly parameter?: number
  readonly branch?: number
  /** 额外来源（曲线图元）节点：只参与失效传播，不参与求值。 */
  readonly hostIds?: readonly string[]
}

export function planarPointNode(id: string, options: PlanarPointNodeOptions): ConstraintNode<ConstrainedPoint2> {
  const branch = options.branch ?? 0
  const literal = options.parameter ?? 0
  const dependsOn = unique([...(options.hostIds ?? []), ...(options.parameterId === undefined ? [] : [options.parameterId])])
  return {
    kind: "constraint",
    id,
    dependsOn,
    evaluate(inputs) {
      if (!options.constraint) return { status: "undefined", diagnostic: invalidHostDiagnostic(id, "宿主曲线不存在或类型不支持，动点无法求值。") }
      let parameter = literal
      if (options.parameterId !== undefined) {
        const value = resolvedNumber(inputs, options.parameterId)
        if (value === null) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, options.parameterId, `驱动参数 ${options.parameterId} 没有可用的数值。`) }
        parameter = value
      }
      if (!Number.isFinite(parameter)) return { status: "undefined", diagnostic: nonFiniteDiagnostic(id, "parameter", `参数不是有限数：${String(parameter)}`) }
      const bounded = applyParameterBounds(parameter, options.constraint.parameterBounds(branch))
      const point = options.constraint.evaluate(bounded.parameter, branch)
      if (!point) return { status: "undefined", diagnostic: invalidDomainDiagnostic(id, `参数 ${bounded.parameter} 处约束没有定义。`) }
      return { status: "exact", value: { point, parameter: bounded.parameter, branch, clamped: bounded.clamped } }
    }
  }
}

export interface HostPointNodeOptions {
  /** 已经解析好的空间宿主；解析不出来时给 `null`（节点仍然存在，报 `invalid_host`）。 */
  readonly host: Host3 | null
  /** 参数真源节点：一维宿主给 1 个、面 2 个、实体内 3 个。缺省用 `parameter` 字面量。 */
  readonly parameterIds?: readonly string[]
  readonly parameter?: Host3Parameter
  /** 额外来源（棱 / 面 / 实体）节点：只参与失效传播。 */
  readonly hostIds?: readonly string[]
}

const AXES = ["u", "v", "w"] as const

export function hostPointNode(id: string, options: HostPointNodeOptions): ConstraintNode<ConstrainedPoint3> {
  const parameterIds = options.parameterIds ?? []
  const literal = options.parameter ?? { u: 0 }
  const dependsOn = unique([...(options.hostIds ?? []), ...parameterIds])
  return {
    kind: "constraint",
    id,
    dependsOn,
    evaluate(inputs) {
      const host = options.host
      if (!host) return { status: "undefined", diagnostic: invalidHostDiagnostic(id, "宿主不存在或无法解析，动点无法求值。") }
      const parameter: { u: number; v?: number; w?: number } = { u: literal.u }
      let clamped = false
      for (const [index, axis] of AXES.entries()) {
        const parameterId = parameterIds[index]
        let value: number | undefined
        if (parameterId === undefined) {
          value = literal[axis]
        } else {
          const resolved = resolvedNumber(inputs, parameterId)
          if (resolved === null) return { status: "undefined", diagnostic: missingSourceDiagnostic(id, parameterId, `驱动参数 ${parameterId} 没有可用的数值。`) }
          value = resolved
        }
        if (value === undefined) {
          // 宿主没有这一维（面宿主没有 w）：忽略即可，不是错误。
          continue
        }
        if (!Number.isFinite(value)) return { status: "undefined", diagnostic: nonFiniteDiagnostic(id, axis, `宿主参数 ${axis} 不是有限数：${String(value)}`) }
        const normalized = normalizeHostParameter(host, axis, value)
        // 折回不是截断（圆上的 θ + 2π 是同一个点），只有真的被域边界夹住才算 clamped。
        if (Math.abs(normalized - value) > MOTION_EPSILON && !(axis === "u" && host.domain.closedU)) clamped = true
        if (axis === "u") parameter.u = normalized
        else parameter[axis] = normalized
      }
      return { status: "exact", value: { point: host.evaluate(parameter), parameter, clamped } }
    }
  }
}

/**
 * 自动生成的驱动参数 id：`t-<点id>`。
 *
 * 这是内核提供的**唯一实现**（检查器、轨迹、适配层都该调它）。注意 `PropertiesBar.tsx` 里
 * 另有一份等价的本地拼法（那份改动不在本切片的文件范围内，留给检查器的所有者迁移）。
 */
export function generatedParameterId(pointId: string): string {
  return `t-${pointId}`
}

export interface GeneratedHostParameterOptions {
  readonly pointId: string
  readonly value: number
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly label?: string
}

/**
 * 为一个动点生成驱动参数。
 *
 * `ownerId` 是这个参数**存在的原因**（那个点）：删掉点之后它就没有引用者了，
 * `scene-graph` 的删除计划按"带 `ownerId` 且无人引用"回收它，于是宿主被删、点被降级为自由点时
 * 不会留下孤儿参数。
 */
export function generatedHostParameter(options: GeneratedHostParameterOptions): ParameterSpec {
  return {
    id: generatedParameterId(options.pointId),
    value: options.value,
    ...(options.min === undefined ? {} : { min: options.min }),
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.step === undefined ? {} : { step: options.step }),
    ...(options.label === undefined ? {} : { label: options.label }),
    ownerId: options.pointId
  }
}

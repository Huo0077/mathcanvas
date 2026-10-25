/**
 * **连续折叠的依赖表示与分类**（T6，2026-10-24）。
 *
 * ## 为什么需要这一层
 *
 * 读取器（`figureIntent.readFoldTransformations`）能按出现顺序读出多条翻折，但它给出的是
 * **一堆互不相干的条目**：第二条折叠说的是"折谁、绕谁、折成谁"，却没说"折的是**第一次折后**的那张面"。
 * 于是下游只能猜——而"第二次折叠引用的是初始坐标"是这类题里最容易发生、也最难察觉的错。
 *
 * 这一层只做三件事：
 * 1. 把多条折叠串成**有顺序、有输入/输出状态**的链，并写出每一步依赖哪一步；
 * 2. 对多折叠输入给出**准确的分类**（可解的顺序链 / 折角未知 / 引用没有串起来）；
 * 3. 提供一个**确定性的折点工具**（绕任意直线旋转），让"明确角度"的链可以被数值验证。
 *
 * ## 它**不**做什么
 *
 * - 不求解未知的多个折角。那需要联立求解（独立里程碑）：这一层只如实报告"还缺哪些角"。
 * - 不生成动作、不写文档。构造仍属于 `planCompiler` / 内核。
 */

import type { FigureTransformation } from "./figureIntent"
import { readFoldTransformations } from "./figureIntent"

/** 与 `geometry-kernel` 的 `Vector3` 同形；这里只依赖三元组，不引入包级耦合。 */
export interface FoldPoint3 {
  x: number
  y: number
  z: number
}

export interface FoldChainStep {
  /** 从 1 开始，与题面里的出现顺序一致。 */
  index: number
  transformation: FigureTransformation
  /** 这一步作用在哪个状态上：0 = 初始图形，n = 第 n 步折叠之后。 */
  inputState: number
  outputState: number
  /** 明确给出的折角（度）。缺省 = 题面没给。 */
  angleDegrees?: number
  /** 依赖了哪几步产出的点（例如第二次折叠依赖第一次的 `apexAs`）。 */
  dependsOn: number[]
}

export type FoldChainClassification =
  | { status: "none" }
  /** 只有一次折叠：构造走已有的单折路径。 */
  | { status: "single"; steps: FoldChainStep[] }
  /** 顺序链：每一步都引用前面某一步产出的点，且每一步的折角都明确。 */
  | { status: "sequential_resolvable"; steps: FoldChainStep[] }
  /**
   * 多折叠但这一层**不**接：`reason` 说清是哪一种，`unknowns` 列出还缺的自由度。
   * 返回"不支持"而不是"猜一个"，是本层唯一允许的失败方式。
   */
  | {
      status: "unsupported"
      reason: "fold_angle_unknown" | "reference_not_chained"
      steps: FoldChainStep[]
      unknowns: string[]
      detail: string
    }

/** 一句折叠里明确写出的折角（`翻折 90°` / `折起 60 度`）。 */
const ANGLE_PATTERN = /(?:翻折|折叠|折起|翻起)\s*(?:至|成|到)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:°|度)/g

/**
 * 读出每一步的折角。
 *
 * 只认**紧跟动作词**的那个数字：`沿EF翻折，使PC=4√3` 里的 `4` 不是折角，
 * 它是终态约束里的系数——把它当折角会让整条链跑偏，而错误看起来完全合法。
 */
export function readFoldAngles(prompt: string): (number | undefined)[] {
  return [...prompt.matchAll(ANGLE_PATTERN)].map((match) => {
    const value = Number(match[1])
    return Number.isFinite(value) && value > 0 && value < 360 ? value : undefined
  })
}

/**
 * **把题面里的多条折叠串成链并分类**。
 *
 * 判据（三条，缺一不可）：
 * 1. 只有一条 ⇒ `single`；
 * 2. 多于一条时，**第 k 条必须引用前面某一步产出的点**（`apexAs`，或该步涉及的折后点名）。
 *    引用不串起来的多折叠不是"顺序折叠"，而是"同一起始状态上的多次独立折叠"——
 *    那时坐标按哪一步算都不对，必须如实拒绝；
 * 3. 串起来之后，**每一步的折角都要明确**，否则剩下的自由度是"两个未知折角联立"——
 *    那是另一个里程碑，这里只报告缺哪几个角。
 */
export function buildFoldChain(prompt: string): FoldChainClassification {
  const transformations = readFoldTransformations(prompt)
  if (transformations.length === 0) return { status: "none" }

  const produced = new Map<string, number>()
  const steps: FoldChainStep[] = []
  for (const [position, transformation] of transformations.entries()) {
    const index = position + 1
    const dependsOn = new Set<number>()
    // 这一步用到的点名里，哪些是前面某一步产出的（初始图形的点不算依赖）。
    for (const name of [transformation.hinge.from, transformation.hinge.to, transformation.apex]) {
      const owner = produced.get(name)
      if (owner !== undefined && owner < index) dependsOn.add(owner)
    }
    const angle = transformation.angleDegrees
    steps.push({
      index,
      transformation,
      // 折一次就多一个状态；输入状态取决于它依赖的最后一步。
      inputState: dependsOn.size === 0 ? 0 : Math.max(...dependsOn),
      outputState: index,
      ...(angle === undefined ? {} : { angleDegrees: angle }),
      dependsOn: [...dependsOn].sort((left, right) => left - right)
    })
    // 折完之后，折后点名属于**这一步之后**的状态。
    produced.set(transformation.apexAs, index)
  }

  if (steps.length === 1) return { status: "single", steps }

  const unchained = steps.filter((step) => step.index > 1 && step.dependsOn.length === 0)
  if (unchained.length > 0) {
    return {
      status: "unsupported",
      reason: "reference_not_chained",
      steps,
      unknowns: unchained.map((step) => `第 ${step.index} 条折叠引用的不是前面折出来的点`),
      detail: "多条折叠之间没有引用关系：它们看起来是同一个初始图形上的多次独立折叠，按任何顺序算都不可靠。"
    }
  }

  const angleUnknown = steps.filter((step) => step.angleDegrees === undefined)
  if (angleUnknown.length > 0) {
    return {
      status: "unsupported",
      reason: "fold_angle_unknown",
      steps,
      unknowns: angleUnknown.map((step) => `第 ${step.index} 条折叠的折角`),
      detail: "顺序链的引用是明确的，但缺折角：多个未知折角需要联立求解，本层不做。"
    }
  }

  return { status: "sequential_resolvable", steps }
}

/* ------------------------------------------------------------------------- *
 * 确定性的折点工具
 * ------------------------------------------------------------------------- */

function subtract(point: FoldPoint3, origin: FoldPoint3): FoldPoint3 {
  return { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z }
}

function add(point: FoldPoint3, offset: FoldPoint3): FoldPoint3 {
  return { x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z }
}

function scale(vector: FoldPoint3, factor: number): FoldPoint3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }
}

function dot(left: FoldPoint3, right: FoldPoint3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function cross(left: FoldPoint3, right: FoldPoint3): FoldPoint3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  }
}

function length(vector: FoldPoint3): number {
  return Math.sqrt(dot(vector, vector))
}

/**
 * **绕一条直线（折痕）把点转一个角度**——连续折叠里"第二次折的是第一次折后的图形"就靠它。
 *
 * 用 Rodrigues 公式（轴必须归一化；轴退化成一点时**原样返回**，因为"绕一个点折"没有定义）。
 * 这是纯函数，不给任何默认角度：折角从题面读，读不到就是未知（见 `buildFoldChain`）。
 */
export function foldPointAboutHinge(point: FoldPoint3, from: FoldPoint3, to: FoldPoint3, angleDegrees: number): FoldPoint3 {
  const axis = subtract(to, from)
  const axisLength = length(axis)
  if (!(axisLength > 0) || !Number.isFinite(angleDegrees)) return { ...point }
  const unit = scale(axis, 1 / axisLength)
  const radians = (angleDegrees * Math.PI) / 180
  const offset = subtract(point, from)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  // v·cosθ + (k × v)·sinθ + k·(k·v)·(1−cosθ)
  const rotated = add(add(scale(offset, cos), scale(cross(unit, offset), sin)), scale(unit, dot(unit, offset) * (1 - cos)))
  return add(from, rotated)
}

import type { ConstraintSpec, LinePrimitive } from "@draw/dsl"

export interface ConstraintSolveResult {
  lines: Map<string, LinePrimitive>
  converged: boolean
  /**
   * 无法满足、因而被跳过的约束 id：目标直线退化成一个点（`|b − a| ≈ 0`）时，
   * 平行 / 垂直 / 共线在这条"线"上都**没有定义**——既投影不了，残差也量不出来。
   *
   * 旧实现在这里返回残差 0（"完美满足"），于是求解器第一轮就宣布收敛、几何一动不动，
   * 却报告"约束已满足"：一个静默的空操作。现在这类约束被显式列出来，调用方据此给出准确的诊断，
   * 而不是把"没做"伪装成"做到了"。
   */
  unsatisfiable: string[]
}

/** 退化直线（两端点重合）的判据：低于它就认为这条线没有方向。 */
const DEGENERATE_LINE_EPSILON = 1e-12

function isDegenerateLine(line: LinePrimitive): boolean {
  return direction(line).length < DEGENERATE_LINE_EPSILON
}

function direction(line: LinePrimitive): { x: number; y: number; length: number } {
  const x = line.b.x - line.a.x
  const y = line.b.y - line.a.y
  return { x, y, length: Math.hypot(x, y) }
}

function oriented(unit: { x: number; y: number }, reference: { x: number; y: number }): { x: number; y: number } {
  return unit.x * reference.x + unit.y * reference.y < 0 ? { x: -unit.x, y: -unit.y } : unit
}

export function projectLineConstraint(first: LinePrimitive, second: LinePrimitive, type: ConstraintSpec["type"]): LinePrimitive {
  const firstDirection = direction(first)
  const secondDirection = direction(second)
  if (firstDirection.length < 1e-12 || secondDirection.length < 1e-12) return second

  const firstUnit = { x: firstDirection.x / firstDirection.length, y: firstDirection.y / firstDirection.length }
  const currentSecondUnit = { x: secondDirection.x / secondDirection.length, y: secondDirection.y / secondDirection.length }
  const targetUnit = type === "perpendicular" ? { x: -firstUnit.y, y: firstUnit.x } : firstUnit
  const projectedUnit = oriented(targetUnit, currentSecondUnit)
  const center = { x: (second.a.x + second.b.x) / 2, y: (second.a.y + second.b.y) / 2 }
  const projectedCenter = type === "coincident"
    ? {
        x: first.a.x + firstUnit.x * ((center.x - first.a.x) * firstUnit.x + (center.y - first.a.y) * firstUnit.y),
        y: first.a.y + firstUnit.y * ((center.x - first.a.x) * firstUnit.x + (center.y - first.a.y) * firstUnit.y)
      }
    : center
  const halfLength = secondDirection.length / 2

  return {
    ...second,
    a: { x: projectedCenter.x - projectedUnit.x * halfLength, y: projectedCenter.y - projectedUnit.y * halfLength },
    b: { x: projectedCenter.x + projectedUnit.x * halfLength, y: projectedCenter.y + projectedUnit.y * halfLength }
  }
}

export function constraintResidual(first: LinePrimitive, second: LinePrimitive, type: ConstraintSpec["type"]): number {
  const firstDirection = direction(first)
  const secondDirection = direction(second)
  if (firstDirection.length < 1e-12 || secondDirection.length < 1e-12) return 0
  const cross = firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x
  const dot = firstDirection.x * secondDirection.x + firstDirection.y * secondDirection.y
  const scale = firstDirection.length * secondDirection.length
  if (type === "parallel") return Math.abs(cross) / scale
  if (type === "perpendicular") return Math.abs(dot) / scale
  const offset = { x: second.a.x - first.a.x, y: second.a.y - first.a.y }
  const directionError = Math.abs(cross) / scale
  const offsetError = Math.abs(offset.x * firstDirection.y - offset.y * firstDirection.x) / firstDirection.length
  return Math.max(directionError, offsetError)
}

function activeConstraints(constraints: ConstraintSpec[], activeLineIds?: ReadonlySet<string>, activeConstraintIds?: ReadonlySet<string>): ConstraintSpec[] {
  if (activeConstraintIds !== undefined) return constraints.filter((constraint) => activeConstraintIds.has(constraint.id))
  if (activeLineIds === undefined) return constraints
  const neighbors = new Map<string, string[]>()
  for (const constraint of constraints) {
    if (constraint.targets.length !== 2) continue
    const [first, second] = constraint.targets
    const firstNeighbors = neighbors.get(first)
    if (firstNeighbors) firstNeighbors.push(second)
    else neighbors.set(first, [second])
    const secondNeighbors = neighbors.get(second)
    if (secondNeighbors) secondNeighbors.push(first)
    else neighbors.set(second, [first])
  }
  const component = new Set<string>()
  const queue = [...activeLineIds]
  for (let index = 0; index < queue.length; index += 1) {
    const lineId = queue[index]
    if (component.has(lineId)) continue
    component.add(lineId)
    queue.push(...(neighbors.get(lineId) ?? []))
  }
  return constraints.filter((constraint) => constraint.targets.length === 2 && constraint.targets.every((target) => component.has(target)))
}

export function solveLineConstraints(lines: Map<string, LinePrimitive>, constraints: ConstraintSpec[], maxIterations?: number, tolerance = 1e-8, activeLineIds?: ReadonlySet<string>, activeConstraintIds?: ReadonlySet<string>): ConstraintSolveResult {
  const projected = new Map(lines)
  const selectedConstraints = activeConstraints(constraints, activeLineIds, activeConstraintIds).filter((constraint) => ["parallel", "perpendicular", "coincident"].includes(constraint.type) && constraint.targets.every((target) => lines.has(target)))
  const unsatisfiable = selectedConstraints
    .filter((constraint) => constraint.targets.length === 2 && constraint.targets.some((target) => {
      const line = lines.get(target)
      return line !== undefined && isDegenerateLine(line)
    }))
    .map((constraint) => constraint.id)
  const solvable = selectedConstraints.filter((constraint) => !unsatisfiable.includes(constraint.id))
  const iterationLimit = maxIterations ?? Math.max(12, solvable.length + 1)
  for (let iteration = 0; iteration < iterationLimit; iteration += 1) {
    for (const constraint of solvable) {
      if (constraint.targets.length !== 2) continue
      const first = projected.get(constraint.targets[0])
      const second = projected.get(constraint.targets[1])
      if (!first || !second) continue
      projected.set(second.id, projectLineConstraint(first, second, constraint.type))
    }
    if (solvable.every((constraint) => {
      if (constraint.targets.length !== 2) return true
      const first = projected.get(constraint.targets[0])
      const second = projected.get(constraint.targets[1])
      return !first || !second || constraintResidual(first, second, constraint.type) <= tolerance
    })) return { lines: projected, converged: true, unsatisfiable }
  }
  return { lines: projected, converged: false, unsatisfiable }
}

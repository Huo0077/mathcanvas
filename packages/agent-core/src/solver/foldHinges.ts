import type { PlanEnvelope } from "../contracts"

/**
 * **翻折计划的两种结构清洗**（2026-10-19，用户翻折题）。
 *
 * 模型有时把“折起来的三角形”同时写成一张平面片和一笔 fold，E/F 只是折片自己的顶点，
 * 没有 bound point。剪角需要 E/F“在宿主边上”，折角反求也需要折前文档里有 E/F。
 *
 * 这里做两件纯结构变换：
 * 1. 删掉点名集合与折片完全相同的冗余 `solid.create_face`；
 * 2. 从折片的 A/E/F 坐标反推 E/F 在 A 的两条邻边上的参数，物化成
 *    `dynamic.create_bound_point`，并去掉 fold 里过期的 `vertices`。
 *
 * **不替换坐标、不猜折角**：坐标仍由见证搜索给，折角仍由反求/核验给。
 */

type Plan = Extract<PlanEnvelope, { kind: "plan" }>
type PlanAction = Plan["actions"][number]

/**
 * 模型给的点常带四舍五入（`(3, 1.7321)`），反推出来的参数会差几 ppm，核验的比值容差
 * 过不去。把落在简单分数附近的参数收敛回去（2/5、1/2 这类）；**只在误差 ≤ 5e-4 时收敛**，
 * 不改变真正任意的比例。
 */
function snapToSimpleRatio(value: number): number {
  for (let denominator = 1; denominator <= 20; denominator += 1) {
    const numerator = Math.round(value * denominator)
    if (numerator < 0 || numerator > denominator) continue
    if (Math.abs(value - numerator / denominator) <= 5e-4) return numerator / denominator
  }
  return value
}

export function removeRedundantFoldFaces(plan: Plan): Plan {
  const fold = plan.actions.find((action) => action.actionId === "solid.fold")
  if (fold === undefined) return plan
  const foldNames = (fold.inputs as { vertexNames?: unknown }).vertexNames
  if (!Array.isArray(foldNames)) return plan
  const names = foldNames.filter((name): name is string => typeof name === "string")
  const wanted = new Set(names)
  if (wanted.size !== names.length || wanted.size < 3) return plan
  const actions = plan.actions.filter((action) => {
    if (action.actionId !== "solid.create_face") return true
    const declared = (action.inputs as { vertexNames?: unknown }).vertexNames
    if (!Array.isArray(declared) || declared.length !== wanted.size) return true
    return !declared.every((name) => typeof name === "string" && wanted.has(name))
  })
  return actions.length === plan.actions.length ? plan : { ...plan, actions }
}

export function materialiseFoldHinges(plan: Plan): Plan {
  const cleaned = removeRedundantFoldFaces(plan)
  const fold = cleaned.actions.find((action) => action.actionId === "solid.fold")
  if (fold === undefined) return cleaned
  const foldInputs = fold.inputs as { vertexNames?: unknown; vertices?: unknown }
  const foldNames = Array.isArray(foldInputs.vertexNames)
    ? foldInputs.vertexNames.filter((name): name is string => typeof name === "string") : []
  const foldVertices = Array.isArray(foldInputs.vertices) ? foldInputs.vertices as { x: number; y: number; z: number }[] : []
  if (foldNames.length !== 3 || foldVertices.length !== 3) return cleaned
  const apex = foldNames[0]!

  const host = cleaned.actions.find((action) => action.actionId === "solid.create_face")
  if (host === undefined) return cleaned
  const hostInputs = host.inputs as { alias?: unknown; vertexNames?: unknown; vertices?: unknown }
  const ring = Array.isArray(hostInputs.vertexNames)
    ? hostInputs.vertexNames.filter((name): name is string => typeof name === "string") : []
  const positions = Array.isArray(hostInputs.vertices) ? hostInputs.vertices as { x: number; y: number; z: number }[] : []
  const apexIndex = ring.indexOf(apex)
  if (apexIndex < 0 || ring.length !== positions.length) return cleaned
  const hostAlias = typeof hostInputs.alias === "string" ? hostInputs.alias : host.actionKey
  const count = ring.length
  const adjacent = [ring[(apexIndex - 1 + count) % count]!, ring[(apexIndex + 1) % count]!]
  const apexPosition = positions[apexIndex]!
  const span = Math.max(1, ...positions.map((entry) => Math.max(Math.abs(entry.x), Math.abs(entry.y), Math.abs(entry.z))))
  const existing = new Set(cleaned.actions.flatMap((action) => {
    if (action.actionId !== "dynamic.create_bound_point") return []
    const inputs = action.inputs as { label?: unknown; alias?: unknown }
    return [String(inputs.label ?? ""), String(inputs.alias ?? "")]
  }))

  const additions: PlanAction[] = []
  for (const name of foldNames.slice(1)) {
    if (existing.has(name)) continue
    const index = foldNames.indexOf(name)
    const point = foldVertices[index]
    if (point === undefined) return cleaned
    let placed = false
    for (const other of adjacent) {
      const otherIndex = ring.indexOf(other)
      if (otherIndex < 0) continue
      const end = positions[otherIndex]!
      const dx = end.x - apexPosition.x
      const dy = end.y - apexPosition.y
      const dz = end.z - apexPosition.z
      const lengthSquared = dx * dx + dy * dy + dz * dz
      if (lengthSquared === 0) continue
      const t = ((point.x - apexPosition.x) * dx + (point.y - apexPosition.y) * dy + (point.z - apexPosition.z) * dz) / lengthSquared
      if (t < -1e-6 || t > 1 + 1e-6) continue
      const projection = { x: apexPosition.x + dx * t, y: apexPosition.y + dy * t, z: apexPosition.z + dz * t }
      if (Math.hypot(point.x - projection.x, point.y - projection.y, point.z - projection.z) > span * 1e-3) continue
      additions.push({
        actionId: "dynamic.create_bound_point",
        actionKey: `fold-hinge-${name}`,
        factIds: [],
        inputs: {
          alias: name,
          label: name,
          host: { scope: "draft", alias: hostAlias },
          hostEdge: { from: apex, to: other },
          parameter: snapToSimpleRatio(Math.max(0, Math.min(1, t)))
        }
      } as unknown as PlanAction)
      placed = true
      break
    }
    if (!placed) return cleaned
  }
  if (additions.length === 0) return cleaned

  const inputs = fold.inputs as Record<string, unknown>
  const { vertices: _stale, ...rest } = inputs
  const foldWithoutVertices = { ...fold, inputs: rest } as PlanAction
  const actions: PlanAction[] = []
  for (const action of cleaned.actions) {
    if (action === fold) {
      actions.push(...additions)
      actions.push(foldWithoutVertices)
      continue
    }
    actions.push(action)
  }
  return { ...cleaned, actions }
}

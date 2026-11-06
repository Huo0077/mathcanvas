import { PLAN_SCHEMA_VERSION, type DraftAction, type PlanEnvelope } from "./contracts"
import { normalizeGeometryPrompt } from "./latexNormalisation"

// Match the full midpoint/line-plane angle problem. Extra givens and other target planes go to the planner.
const RIGHT_PRISM = new RegExp([
  // Geometry normalization can turn a numbered heading such as "15. 如图" into "15,如图".
  String.raw`^(?:\d+[.,])?(?:如图[,，])?在直三棱柱(?<a>[A-Z])(?<b>[A-Z])(?<c>[A-Z])[-−–]\k<a>(?<top>[1′])\k<b>\k<top>\k<c>\k<top>中[,，]`,
  String.raw`∠\k<a>\k<c>\k<b>=90°[,，]\k<a>\k<c>=\k<b>\k<c>[,，](?<d>[A-Z])[,，、](?<e>[A-Z])分别为\k<a>\k<b>[,，、]\k<a>\k<c>\k<top>的中点[.。]`,
  String.raw`\(1\)(?:求证|证明)[:：]?\k<d>\k<e>(?:∥|平行于)平面\k<b>\k<c>\k<c>\k<top>\k<b>\k<top>[;；.。]`,
  String.raw`\(2\)设\k<c>\k<c>\k<top>=(?<height>\d+(?:\.\d+)?)[,，](?:直线)?\k<d>\k<e>与平面\k<a>\k<c>\k<c>\k<top>\k<a>\k<top>所成的角为(?<angle>\d+(?:\.\d+)?)°[,，]求(?:直线)?\k<d>\k<e>到平面\k<b>\k<c>\k<c>\k<top>\k<b>\k<top>的距离[.。]?$`
].join(""))

export function rightPrismMidpointsPlan(prompt: string): Extract<PlanEnvelope, { kind: "plan" }> | null {
  const normalized = normalizeGeometryPrompt(prompt).normalize("NFKC").replace(/\s+/g, "").replace(/\\\./g, ".").replace(/'/g, "′")
  const names = RIGHT_PRISM.exec(normalized)?.groups
  if (!names) return null
  const { a, b, c, d, e, top } = names
  if (new Set([a, b, c, d, e]).size !== 5) return null
  const height = Number(names.height)
  const angle = Number(names.angle)
  if (!Number.isFinite(height) || height <= 0 || angle <= 0 || angle >= 90) return null
  const leg = angle === 45 ? height : height * Math.tan(angle * Math.PI / 180)
  if (!Number.isFinite(leg) || leg <= 0) return null

  const suffix = top === "1" ? "₁" : top
  const a1 = a + suffix
  const b1 = b + suffix
  const c1 = c + suffix
  const line = d + e
  const parallelPlane = b + c + c1 + b1
  const anglePlane = a + c + c1 + a1
  const diagonal = a + c1
  const distance = angle === 45 ? `${height / 2}` : `(${height}/2)tan ${angle}° ≈ ${Number((leg / 2).toPrecision(12))}`
  const answer = [
    `（1）在 △${a}${b}${c1} 中，${d}、${e} 分别是 ${a}${b}、${diagonal} 的中点，所以 ${line} ∥ ${b}${c1}。${b}${c1} 在平面 ${parallelPlane} 内，而 ${d} 在 ${a}${b} 的内部，${a}${b} 与该平面只交于 ${b}，故 ${line} ∥ 平面 ${parallelPlane}。`,
    `（2）令 ${a}${c}=${b}${c}=t。取 ${c} 为原点，${c}${a}、${c}${b}、${c}${c1} 分别为三条坐标轴的正向。${d}=(t/2,t/2,0)，${e}=(t/2,0,${height}/2)，所以 ${line} 的方向向量可取 (0,−t,${height})。平面 ${anglePlane} 为 y=0，线面角的正切为 t/${height}，得 t=${height}tan ${angle}°${angle === 45 ? `=${height}` : ""}。平面 ${parallelPlane} 为 x=0，故 ${line} 到该平面的距离为 t/2=${distance}。`
  ].join("\n\n")
  const segment = (from: string, to: string, alias: string): DraftAction => ({
    actionId: "solid.create_segment", actionKey: alias, factIds: [], inputs: { alias, vertexNames: [from, to], label: from + to }
  })

  return {
    schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "重建直三棱柱并求线面距离", factIds: [], answer,
    // Draft-scope references are resolved by the compiler before executing these actions.
    actions: [
      {
        actionId: "solid.create_prism", actionKey: "prism", factIds: [],
        inputs: {
          alias: "prism", label: `${a}${b}${c}-${a1}${b1}${c1}`, vertexNames: [a, b, c, a1, b1, c1],
          basePolygon: [{ x: leg, y: 0, z: 0 }, { x: 0, y: leg, z: 0 }, { x: 0, y: 0, z: 0 }],
          vector: { x: 0, y: 0, z: height }
        }
      },
      segment(a, c1, "diagonal"),
      segment(b, c1, "parallel-diagonal"),
      { actionId: "dynamic.create_bound_point", actionKey: "midpoint-base", factIds: [], inputs: { alias: "midpoint-base", label: d, host: { scope: "draft", alias: "prism" }, hostEdge: { from: a, to: b }, parameter: 0.5 } },
      { actionId: "dynamic.create_bound_point", actionKey: "midpoint-diagonal", factIds: [], inputs: { alias: "midpoint-diagonal", label: e, host: { scope: "draft", alias: "diagonal" }, parameter: 0.5 } },
      segment(d, e, "midpoint-segment")
    ] as unknown as DraftAction[]
  }
}

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { normalizeGeometryPrompt } from "./latexNormalisation"
import { splitNumberedProblem } from "./numberedProblem"
import { parseShapeClause } from "./solver/shapeGrammar"
import { solidWitnessActions } from "./solver/witnessSearch"

// A right triangle on each side of the base diagonal, with the apex above
// its first endpoint. The proof and the construction have separate givens.
export function tryBuildScopedPyramidPlan(prompt: string): { plan: PlanEnvelope; diagramPrompt: string } | null {
  const sections = splitNumberedProblem(prompt) ?? splitNumberedProblem(normalizeGeometryPrompt(prompt))
  if (sections?.parts.length !== 2) return null
  const stem = normalizeGeometryPrompt(sections.stem)
  const [proof, measurement] = sections.parts.map(part => {
    const marker = `（${part.number}）`
    return normalizeGeometryPrompt(marker + part.text).slice(marker.length)
  })
  const common = stem.trimEnd().replace(/\.$/, "。")
  const shape = parseShapeClause(common)
  if (shape?.family !== "pyramid" || shape.base.length !== 4 || !shape.apex || shape.modifier) return null
  const [a, b, c, d] = shape.base as [string, string, string, string]
  const p = shape.apex
  const ad = a + d
  const ac = a + c
  const pa = p + a
  const bc = b + c
  const ab = a + b
  const pb = p + b
  const dc = d + c
  const base = shape.base.join("")
  const face = p + bc

  // Match the subquestions and check all their givens before selecting the drawing scope.
  const compactProof = proof.replace(/\s/g, "")
  const compactMeasurement = measurement.replace(/\s/g, "")
  const proofPattern = new RegExp(`^若${ad}⊥${pb}[，,](?:试?证明|求证)[：:]?${ad}(?:∥|//)平面${face}[。；;.]?$`)
  if (!proofPattern.test(compactProof)) return null
  if (!compactMeasurement.startsWith(`若${ad}⊥${dc}`) || !new RegExp(`[，,]求${ad}[。；;.]?$`).test(compactMeasurement)) return null

  const shared = parseDiagramObligations(common)
  const diagramPrompt = [common, measurement.trim()].join("\n")
  const diagram = parseDiagramObligations(diagramPrompt)
  if (diagram.unverified.length || diagram.givens.length !== shared.givens.length + 2) return null
  if (!shared.givens.some(({ kind, targets }) => kind === "perpendicular" && targets.join("") === pa + base)) return null
  if (!diagram.givens.some(({ kind, targets }) => kind === "perpendicular" && targets.join("") === ad + dc)) return null
  const sine = diagram.givens.find(({ kind, targets }) => kind === "dihedralSine" && targets.join("") === a + c + p + d)?.value
  if (sine === undefined || sine >= 1) return null
  const lengths = new Map(shared.givens.filter(({ kind }) => kind === "fixedLength").map(({ targets, value }) => [targets.join(""), value]))
  const height = lengths.get(pa)
  const diagonal = lengths.get(ac)
  const firstLeg = lengths.get(ab)
  const secondLeg = lengths.get(bc)
  if (height === undefined || diagonal === undefined || firstLeg === undefined || secondLeg === undefined) return null
  if (Math.abs(Math.hypot(firstLeg, secondLeg) / diagonal - 1) > 1e-10) return null

  // x-axis along AC. AD ⟂ DC gives x_D = AD²/AC. Projecting CD onto
  // the cross-section normal to CP gives sin²θ = AD²(AC² + PA²) / (AC²(AD² + PA²)).
  const sineSquared = sine ** 2
  const tSquared = sineSquared * height ** 2 / (1 + (height / diagonal) ** 2 - sineSquared)
  const t = Math.sqrt(tSquared)
  if (!(t > 0 && t < diagonal)) return null
  const vertices = [
    { x: 0, y: 0, z: 0 },
    { x: firstLeg ** 2 / diagonal, y: -firstLeg * secondLeg / diagonal, z: 0 },
    { x: diagonal, y: 0, z: 0 },
    { x: tSquared / diagonal, y: t * Math.sqrt(1 - (t / diagonal) ** 2), z: 0 },
    { x: 0, y: 0, z: height }
  ]
  const actions = solidWitnessActions({
    names: [a, b, c, d, p],
    vertices,
    faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
  }, "dihedral-pyramid")
  const roundedSquare = Math.round(tSquared)
  const result = roundedSquare > 0 && Math.abs(tSquared - roundedSquare) <= 8 * Number.EPSILON * roundedSquare
    ? `= ${Number.isInteger(Math.sqrt(roundedSquare)) ? Math.sqrt(roundedSquare) : `√${roundedSquare}`}`
    : `≈ ${Number(t.toPrecision(8))}`
  const scope = "草稿按第（2）问的条件构造。"
  return {
    diagramPrompt,
    plan: {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "画出符合第（2）问题设的四棱锥",
      factIds: [],
      assumptions: [scope],
      answer: [
        `（1）${ab}² + ${bc}² = ${ac}²，故 ${ab} ⟂ ${bc}。${pa} ⟂ 底面 ${base}，因此 ${pa} ⟂ ${ad}。结合 ${ad} ⟂ ${pb}，得 ${ad} ⟂ 平面 ${p + ab}，所以 ${ad} ⟂ ${ab}。底面内 ${ad} 和 ${bc} 都垂直于 ${ab}，于是 ${ad} ∥ ${bc}。${bc} 在平面 ${face} 内，且 ${a} 在该平面外，故 ${ad} ∥ 平面 ${face}。`,
        `（2）设 ${ad}=t、${ac}=L、${pa}=h，二面角为 θ。取 ${ac} 为 x 轴，${a} 为原点。由 ${ad} ⟂ ${dc}，${d} 的横坐标为 t²/L，到 ${ac} 的距离为 t√(1−t²/L²)。在垂直于 ${c + p} 的截面中，${c + d} 沿平面 ${p + ac} 的分量长度为 (L−t²/L)h/√(L²+h²)，垂直该平面的分量长度为 t√(1−t²/L²)。因此 sin²θ = t²(L²+h²)/[L²(t²+h²)]。代入题设，得 ${ad} ${result}。`,
        scope
      ].join("\n\n"),
      actions
    }
  }
}

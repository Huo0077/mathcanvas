import path from "node:path"
import { expect, it } from "vitest"
import {
  buildLineInPlaneStatement, buildLinePlanePerpendicularStatement,
  buildPerpendicularStatement, buildTangentSlopeStatement, canonicalProofBody,
  type PremiseBridgeGoal, type Lean4ProofGoalInput
} from "@draw/agent-core"

// Rust consumes this same snapshot through include_str!, so admission tests use
// actual adapter output, not handwritten 'template-shaped' approximations.
it("keeps desktop admission fixtures identical to all four real generators", async () => {
  const fixtures: { name: string; source: string }[] = []
  for (const renamed of [false, true]) {
    const [a, b, c, p, d, f] = renamed ? ["A1", "B_2", "C'", "P'", "D9", "curve_2'"] : ["A", "B", "C", "P", "D", "f"]
    const goals: PremiseBridgeGoal[] = [
      { goalKind: "perpendicular", lineA: { first: p!, second: a! }, planePoints: [a!, b!, c!], lineB: { first: b!, second: d! } },
      { goalKind: "linePlanePerpendicular", line: { first: p!, second: a! }, planeLines: [{ first: a!, second: b! }, { first: c!, second: a! }] },
      { goalKind: "tangentSlope", tangentSlope: { functionName: f! } },
      { goalKind: "lineInPlane", line: { first: b!, second: d! }, planePoints: [a!, b!, c!] }
    ]
    for (const goal of goals) {
      const input: Lean4ProofGoalInput = { prompt: "admission", claimSourceText: "limited lemma", goalKind: goal.goalKind, proof: canonicalProofBody(goal)!.body }
      const spec = goal.goalKind === "perpendicular" ? buildPerpendicularStatement({ ...input, perpendicular: goal }, 400_000)
        : goal.goalKind === "linePlanePerpendicular" ? buildLinePlanePerpendicularStatement({ ...input, linePlanePerpendicular: goal }, 400_000)
        : goal.goalKind === "lineInPlane" ? buildLineInPlaneStatement({ ...input, lineInPlane: goal }, 400_000)
        : buildTangentSlopeStatement({ ...input, tangentSlope: goal.tangentSlope }, 400_000)
      fixtures.push({ name: goal.goalKind + (renamed ? "-renamed" : ""), source: spec.source })
    }
  }
  await expect(JSON.stringify(fixtures, null, 2) + "\n").toMatchFileSnapshot(path.join(process.cwd(), "apps/desktop/src-tauri/tests/fixtures/lean-admission.json"))
})

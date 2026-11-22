import {
  certifyDrawingAgainstContract,
  compilePlan,
  createBudget,
  createTargetedRepairTracker,
  normalizeGeometryPrompt,
  parseDiagramObligations,
  shouldAutoClearSceneForPrompt,
  verifyDiagramObligations
} from "@draw/agent-core"
import { createEmptyDocument, type Workspace } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createDsActionSession } from "./dsActionTools"
import { createDraftStore } from "./draftStore"
import { createModelPlanner } from "./modelPlanner"
import { buildSystemPrompt } from "./systemPrompt"

interface DsActionStep {
  tool: string
  input: Record<string, unknown>
}

interface RealExamCase {
  id: string
  category: "planar" | "solid"
  workspace: Workspace
  prompt: string
  steps: DsActionStep[]
  goal: string
}

async function runRealExamFullPipeline(testCase: RealExamCase) {
  const normalized = normalizeGeometryPrompt(testCase.prompt)
  const rawObligations = parseDiagramObligations(normalized)
  // For multi-part exam prompts where exactly one subquestion introduces drawing premises,
  // mirror draftStore/planCompiler/drawingCertificate unique-premise scope selection.
  let obligations = rawObligations
  if (rawObligations.parts && rawObligations.parts.length > 0 && rawObligations.unverified.some((u) => u.sourceText === "各小问的条件")) {
    const sharedOnly = parseDiagramObligations(normalized, { selectedScopeId: "shared" })
    const premiseParts = rawObligations.parts.filter((part) => part.obligations.givens.length > sharedOnly.givens.length)
    if (premiseParts.length === 1) {
      obligations = parseDiagramObligations(normalized, { selectedPart: premiseParts[0]!.number })
    }
  }
  const baseDoc = createEmptyDocument(testCase.workspace)
  const session = createDsActionSession({
    workspace: testCase.workspace,
    baseDocument: baseDoc,
    problemText: testCase.prompt
  })

  for (const [idx, step] of testCase.steps.entries()) {
    const res = session.execute(step.tool, step.input)
    if (!res.ok) {
      throw new Error(`[${testCase.id}] step ${idx} (${step.tool}) failed: ${res.blockerCode ?? res.status} — ${res.repairHint ?? ""}`)
    }
  }

  const finished = session.execute("finish_candidate", { goal: testCase.goal })
  if (!finished.ok || finished.terminated?.plan.kind !== "plan") {
    throw new Error(`[${testCase.id}] finish_candidate failed: ${finished.blockerCode ?? finished.status} — ${finished.repairHint ?? ""}`)
  }

  const plan = finished.terminated.plan
  const compiled = compilePlan(plan, {
    document: baseDoc,
    workspace: testCase.workspace,
    conversationId: `real-exam-${testCase.id}`,
    documentGeneration: 0
  })
  if (!compiled.ok || !compiled.draftDocument) {
    throw new Error(`[${testCase.id}] compilePlan failed: ${JSON.stringify(compiled.diagnostics)}`)
  }

  const verification = verifyDiagramObligations(obligations, plan, compiled.draftDocument, baseDoc, {
    prompt: normalized
  })

  const certificate = certifyDrawingAgainstContract({
    prompt: testCase.prompt,
    document: compiled.draftDocument,
    baseDocument: baseDoc,
    plan,
    candidateHash: finished.candidateHash,
    sourceHash: finished.candidateHash
  })

  const store = createDraftStore()
  const record = store.create(baseDoc)
  const staged = await store.stage(
    record.draftId,
    plan.actions,
    record.draftVersion,
    testCase.prompt
  )

  return { normalized, obligations, plan, compiled, verification, certificate, staged }
}

const FRESH_REAL_EXAM_CASES: readonly RealExamCase[] = [
  // =========================================================================
  // 8 Fresh Plane / Analytic / Function Gaokao & Mock Exam Problems
  // (Zero overlap with drawing-contracts-36 / dev-smoke / explicit-solid)
  // =========================================================================
  {
    id: "EX-P01",
    category: "planar",
    workspace: "conics",
    prompt: "已知椭圆 C：x²/9 + y²/5 = 1，左、右焦点分别为 F₁、F₂，过 F₂ 且倾斜角为 60° 的直线 l 交椭圆 C 于 A、B 两点，求 △ABF₁ 的周长。",
    goal: "绘制椭圆 C: x²/9+y²/5=1、焦点 F₁/F₂ 及过 F₂ 倾斜角 60° 的焦点弦 AB",
    steps: [
      { tool: "construct_conic", input: { id: "C", conicType: "ellipse", equation: "\\frac{x^2}{9} + \\frac{y^2}{5} = 1" } },
      { tool: "construct_point", input: { id: "F₁", x: -2, y: 0 } },
      { tool: "construct_point", input: { id: "F₂", x: 2, y: 0 } },
      { tool: "construct_line", input: { id: "l", from: "F₂", slope: Math.sqrt(3) } },
      { tool: "construct_intersection", input: { id: "A", lineA: "l", conicId: "C", selection: "max_x" } },
      { tool: "construct_intersection", input: { id: "B", lineA: "l", conicId: "C", excludePointId: "A" } },
      { tool: "construct_segment", input: { id: "AF₁", from: "A", to: "F₁" } },
      { tool: "construct_segment", input: { id: "BF₁", from: "B", to: "F₁" } }
    ]
  },
  {
    id: "EX-P02",
    category: "planar",
    workspace: "conics",
    prompt: "已知抛物线 C：y² = 8x，原点为 O，过点 P(8, 0) 的直线交抛物线 C 于 A、B 两点，且 OA⊥OB，求直线 AB 的方程。",
    goal: "绘制抛物线 y²=8x 与过 (8,0) 满足 OA⊥OB 的垂直弦 AB",
    steps: [
      { tool: "construct_conic", input: { id: "C", conicType: "parabola", equation: "y^2 = 8x" } },
      { tool: "construct_point", input: { id: "O", x: 0, y: 0 } },
      { tool: "construct_point", input: { id: "P", x: 8, y: 0 } },
      { tool: "construct_line", input: { id: "l", equation: "x - y - 8 = 0" } },
      { tool: "construct_intersection", input: { id: "A", lineA: "l", conicId: "C", selection: "max_y" } },
      { tool: "construct_intersection", input: { id: "B", lineA: "l", conicId: "C", excludePointId: "A" } },
      { tool: "construct_segment", input: { id: "OA", from: "O", to: "A" } },
      { tool: "construct_segment", input: { id: "OB", from: "O", to: "B" } }
    ]
  },
  {
    id: "EX-P03",
    category: "planar",
    workspace: "conics",
    prompt: "已知双曲线 C：x²/4 - y²/5 = 1 的左、右焦点分别为 F₁、F₂，点 P 为双曲线右支上一点，且 PF₁⊥PF₂，求 △PF₁F₂ 的面积。",
    goal: "绘制双曲线 x²/4-y²/5=1、焦点 F₁/F₂ 及右支上满足 PF₁⊥PF₂ 的点 P",
    steps: [
      { tool: "construct_conic", input: { id: "C", conicType: "hyperbola", equation: "\\frac{x^2}{4} - \\frac{y^2}{5} = 1" } },
      { tool: "construct_point", input: { id: "F₁", x: -3, y: 0 } },
      { tool: "construct_point", input: { id: "F₂", x: 3, y: 0 } },
      // On x²/4 - y²/5 = 1 and x² + y² = 9 => 9x²/20 = 14/5 => x² = 56/9, y² = 25/9
      { tool: "construct_point", input: { id: "P", x: Math.sqrt(56) / 3, y: 5 / 3 } },
      { tool: "construct_segment", input: { id: "PF₁", from: "P", to: "F₁" } },
      { tool: "construct_segment", input: { id: "PF₂", from: "P", to: "F₂" } }
    ]
  },
  {
    id: "EX-P04",
    category: "planar",
    workspace: "conics",
    prompt: "已知圆 C：(x - 2)² + (y + 1)² = 5，直线 l：x - 2y - 1 = 0 与圆 C 交于 A、B 两点，求弦 AB 的长。",
    goal: "绘制圆 C:(x-2)²+(y+1)²=5 及直线 x-2y-1=0 与圆的交点 A、B",
    steps: [
      { tool: "construct_circle", input: { id: "C", cx: 2, cy: -1, radius: Math.sqrt(5) } },
      { tool: "construct_line", input: { id: "l", equation: "x - 2y - 1 = 0" } },
      { tool: "construct_intersection", input: { id: "A", lineA: "l", conicId: "C", selection: "min_x" } },
      { tool: "construct_intersection", input: { id: "B", lineA: "l", conicId: "C", excludePointId: "A" } },
      { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } }
    ]
  },
  {
    id: "EX-P05",
    category: "planar",
    workspace: "conics",
    prompt: "在 △ABC 中，AB = 4，AC = 3，∠BAC = 60°，点 D 在边 BC 上，BD = 2DC，求 AD 的长。",
    goal: "绘制满足 AB=4, AC=3, ∠BAC=60° 的 △ABC 及边 BC 上的三等分点 D",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0 } },
      { tool: "construct_point", input: { id: "B", x: 4, y: 0 } },
      { tool: "construct_point", input: { id: "C", x: 1.5, y: 1.5 * Math.sqrt(3) } },
      { tool: "construct_point", input: { id: "D", from: "B", to: "C", ratio: 2 / 3 } },
      { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } },
      { tool: "construct_segment", input: { id: "AC", from: "A", to: "C" } },
      { tool: "construct_segment", input: { id: "BC", from: "B", to: "C" } },
      { tool: "construct_segment", input: { id: "AD", from: "A", to: "D" } }
    ]
  },
  {
    id: "EX-P06",
    category: "planar",
    workspace: "conics",
    prompt: "在平行四边形 ABCD 中，AB = 4，AD = 2，∠BAD = 60°，点 E 为 CD 的中点，求 AE 的长。",
    goal: "绘制平行四边形 ABCD 及边 CD 的中点 E",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0 } },
      { tool: "construct_point", input: { id: "B", x: 4, y: 0 } },
      { tool: "construct_point", input: { id: "D", x: 1, y: Math.sqrt(3) } },
      { tool: "construct_point", input: { id: "C", x: 5, y: Math.sqrt(3) } },
      { tool: "construct_point", input: { id: "E", from: "C", to: "D", ratio: 0.5 } },
      { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } },
      { tool: "construct_segment", input: { id: "BC", from: "B", to: "C" } },
      { tool: "construct_segment", input: { id: "CD", from: "C", to: "D" } },
      { tool: "construct_segment", input: { id: "DA", from: "D", to: "A" } },
      { tool: "construct_segment", input: { id: "AE", from: "A", to: "E" } }
    ]
  },
  {
    id: "EX-P07",
    category: "planar",
    workspace: "calculus",
    prompt: "已知函数 $f(x) = e^x - 2x$，求曲线 $y = f(x)$ 在点 $(0, 1)$ 处的切线方程。",
    goal: "绘制函数 f(x) = exp(x) - 2*x 及在 x=0 处的切线",
    steps: [
      { tool: "construct_tangent", input: { id: "t1", functionId: "f", expression: "exp(x) - 2*x", domain: [-3, 3], x0: 0 } }
    ]
  },
  {
    id: "EX-P08",
    category: "planar",
    workspace: "calculus",
    prompt: "绘制函数 $y = \\ln(x + 2) + 0.5x$",
    goal: "绘制函数 y = ln(x + 2) + 0.5*x",
    steps: [
      { tool: "construct_tangent", input: { id: "y", mode: "graph", expression: "ln(x + 2) + 0.5*x", domain: [-1.8, 6] } }
    ]
  },

  // =========================================================================
  // 8 Fresh 3D Solid Geometry Gaokao & Mock Exam Problems
  // =========================================================================
  {
    id: "EX-S01",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在长方体 ABCD-A₁B₁C₁D₁ 中，AB = 2，AD = 3，AA₁ = 4，点 E 为棱 CC₁ 的中点，求点 C 到平面 BDE 的距离。",
    goal: "绘制长方体 ABCD-A₁B₁C₁D₁ 及棱 CC₁ 中点 E 与截面 BDE",
    steps: [
      { tool: "construct_solid", input: { id: "BOX", kind: "cuboid", width: 2, depth: 3, height: 4, vertexNames: ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"] } },
      { tool: "construct_point", input: { id: "E", from: "C", to: "C₁", ratio: 0.5 } },
      { tool: "construct_face", input: { id: "F_BDE", vertexNames: ["B", "D", "E"] } }
    ]
  },
  {
    id: "EX-S02",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在正三棱锥 P-ABC 中，AB = 2，PA = 3，点 M 为 BC 的中点，求侧棱 PA 与底面 ABC 所成角的余弦值。",
    goal: "绘制正三棱锥 P-ABC 及底边 BC 中点 M",
    steps: [
      { tool: "construct_solid", input: { id: "PYR", kind: "tetrahedron", vertexNames: ["P", "A", "B", "C"], ab: 2, ac: 2, bc: 2, pa: 3, pb: 3, pc: 3 } },
      { tool: "construct_point", input: { id: "M", from: "B", to: "C", ratio: 0.5 } },
      { tool: "construct_segment", input: { id: "PM", from: "P", to: "M" } },
      { tool: "construct_segment", input: { id: "AM", from: "A", to: "M" } }
    ]
  },
  {
    id: "EX-S03",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在直三棱柱 ABC-A₁B₁C₁ 中，AC⊥BC，AC = 2，BC = 2，AA₁ = 3，点 D 为 AB 的中点，求证：AC₁∥平面 B₁CD。",
    goal: "绘制直三棱柱 ABC-A₁B₁C₁、底边 AB 中点 D 及截面 B₁CD",
    steps: [
      { tool: "construct_point", input: { id: "C", x: 0, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "A", x: 2, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "B", x: 0, y: 2, z: 0 } },
      { tool: "construct_point", input: { id: "C₁", x: 0, y: 0, z: 3 } },
      { tool: "construct_point", input: { id: "A₁", x: 2, y: 0, z: 3 } },
      { tool: "construct_point", input: { id: "B₁", x: 0, y: 2, z: 3 } },
      { tool: "construct_solid", input: { id: "PRISM", kind: "triangular_prism", vertexNames: ["A", "B", "C", "A₁", "B₁", "C₁"] } },
      { tool: "construct_point", input: { id: "D", from: "A", to: "B", ratio: 0.5 } },
      { tool: "construct_face", input: { id: "F_B1CD", vertexNames: ["B₁", "C", "D"] } }
    ]
  },
  {
    id: "EX-S04",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在四棱锥 P-ABCD 中，底面 ABCD 是边长为 2 的正方形，PA⊥平面 ABCD，PA = 2，E 为 PD 的中点，求证：PB∥平面 EAC。",
    goal: "绘制四棱锥 P-ABCD、正方形底面 ABCD 及棱 PD 中点 E",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "B", x: 2, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "C", x: 2, y: 2, z: 0 } },
      { tool: "construct_point", input: { id: "D", x: 0, y: 2, z: 0 } },
      { tool: "construct_point", input: { id: "P", x: 0, y: 0, z: 2 } },
      { tool: "construct_solid", input: { id: "PYR", kind: "perpendicular_pyramid", vertexNames: ["A", "B", "C", "D", "P"] } },
      { tool: "construct_point", input: { id: "E", from: "P", to: "D", ratio: 0.5 } },
      { tool: "construct_face", input: { id: "F_EAC", vertexNames: ["E", "A", "C"] } }
    ]
  },
  {
    id: "EX-S05",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在四棱锥 P-ABCD 中，底面 ABCD 是菱形，AB = 2，∠BAD = 60°，△PAD 是等边三角形，平面 PAD⊥平面 ABCD，M 为 PB 的中点，求二面角 M-AD-C 的大小。",
    goal: "绘制菱形底面与等边垂直侧面四棱锥 P-ABCD 及 PB 中点 M",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "D", x: 2, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "B", x: 1, y: Math.sqrt(3), z: 0 } },
      { tool: "construct_point", input: { id: "C", x: 3, y: Math.sqrt(3), z: 0 } },
      { tool: "construct_point", input: { id: "P", x: 1, y: 0, z: Math.sqrt(3) } },
      { tool: "construct_solid", input: { id: "PYR", kind: "perpendicular_pyramid", vertexNames: ["A", "B", "C", "D", "P"] } },
      { tool: "construct_point", input: { id: "M", from: "P", to: "B", ratio: 0.5 } }
    ]
  },
  {
    id: "EX-S06",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 中，E、F 分别为棱 AB、BC 的中点，求证：EF⊥平面 BB₁D₁D。",
    goal: "绘制棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 及棱中点 E、F",
    steps: [
      { tool: "construct_solid", input: { id: "CUBE", kind: "cube", edgeLength: 2, vertexNames: ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"] } },
      { tool: "construct_point", input: { id: "E", from: "A", to: "B", ratio: 0.5 } },
      { tool: "construct_point", input: { id: "F", from: "B", to: "C", ratio: 0.5 } },
      { tool: "construct_segment", input: { id: "EF", from: "E", to: "F" } }
    ]
  },
  {
    id: "EX-S07",
    category: "solid",
    workspace: "geometry3d",
    prompt: "已知圆锥的底面半径为 2，高为 3，求该圆锥的母线长与侧面积。",
    goal: "绘制底面半径为 2、高为 3 的圆锥",
    steps: [
      { tool: "construct_solid", input: { id: "CONE", kind: "cone", radius: 2, height: 3 } }
    ]
  },
  {
    id: "EX-S08",
    category: "solid",
    workspace: "geometry3d",
    prompt: "已知：在三棱锥 $P-ABC$ 中，$PA \\perp$ 平面 $ABC$，$AB = \\frac{3}{2}$，$AC = 2$，$\\angle BAC = 90^\\circ$，$PA = \\frac{\\sqrt{3}}{2}$，取 $BC$ 的中点 $M$，求 $PM$ 的长。",
    goal: "绘制含分数与根号棱长的 LaTeX 三棱锥 P-ABC 及中点 M",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "B", x: 1.5, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "C", x: 0, y: 2, z: 0 } },
      { tool: "construct_point", input: { id: "P", x: 0, y: 0, z: Math.sqrt(3) / 2 } },
      { tool: "construct_solid", input: { id: "PYR", kind: "tetrahedron", vertexNames: ["P", "A", "B", "C"] } },
      { tool: "construct_point", input: { id: "M", from: "B", to: "C", ratio: 0.5 } },
      { tool: "construct_segment", input: { id: "PM", from: "P", to: "M" } }
    ]
  },

  // =========================================================================
  // Wave 2: 8 MORE Fresh Plane / Analytic / Function Problems (EX-P09..EX-P16)
  // =========================================================================
  {
    id: "EX-P09",
    category: "planar",
    workspace: "conics",
    prompt: "已知圆 C 的圆心为 (1, -2)，半径为 5，直线 l：x - y + 1 = 0 与圆 C 交于 A、B 两点，点 P(4, 2) 在圆 C 上，求 △PAB 的面积。",
    goal: "绘制圆心 (1,-2) 半径 5 的圆 C、交弦 AB 及圆上点 P(4,2)",
    steps: [
      { tool: "construct_circle", input: { id: "C", cx: 1, cy: -2, radius: 5 } },
      { tool: "construct_line", input: { id: "l", equation: "x - y + 1 = 0" } },
      { tool: "construct_intersection", input: { id: "A", lineA: "l", circleId: "C", selection: "min_x" } },
      { tool: "construct_intersection", input: { id: "B", lineA: "l", circleId: "C", excludePointId: "A" } },
      { tool: "construct_point", input: { id: "P", x: 4, y: 2 } },
      { tool: "construct_segment", input: { id: "PA", from: "P", to: "A" } },
      { tool: "construct_segment", input: { id: "PB", from: "P", to: "B" } },
      { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } }
    ]
  },
  {
    id: "EX-P10",
    category: "planar",
    workspace: "conics",
    prompt: "在 △ABC 中，AB = 4，BC = 6，cos∠ABC = 1/2，延长 AB 至 D 使 BD = AB，求 CD 的长。",
    goal: "绘制满足 cos∠ABC=1/2 的 △ABC 及延长线点 D(ratio=2)",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0 } },
      { tool: "construct_point", input: { id: "B", x: 4, y: 0 } },
      { tool: "construct_point", input: { id: "C", x: 1, y: 3 * Math.sqrt(3) } },
      { tool: "construct_point", input: { id: "D", from: "A", to: "B", ratio: 2 } },
      { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } },
      { tool: "construct_segment", input: { id: "BC", from: "B", to: "C" } },
      { tool: "construct_segment", input: { id: "AC", from: "A", to: "C" } },
      { tool: "construct_segment", input: { id: "BD", from: "B", to: "D" } },
      { tool: "construct_segment", input: { id: "CD", from: "C", to: "D" } }
    ]
  },
  {
    id: "EX-P11",
    category: "planar",
    workspace: "conics",
    prompt: "在 △ABC 中，AB = 6，AC = 8，∠BAC = 90°，点 G 是 △ABC 的重心，点 I 是 △ABC 的内心，点 H 是 △ABC 的垂心，求 GI 的长。",
    goal: "绘制直角三角形 ABC 及重心 G、内心 I、垂心 H",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0 } },
      { tool: "construct_point", input: { id: "B", x: 6, y: 0 } },
      { tool: "construct_point", input: { id: "C", x: 0, y: 8 } },
      { tool: "construct_point", input: { id: "G", x: 2, y: 8 / 3 } },
      { tool: "construct_point", input: { id: "I", x: 2, y: 2 } },
      { tool: "construct_point", input: { id: "H", x: 0, y: 0 } },
      { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } },
      { tool: "construct_segment", input: { id: "AC", from: "A", to: "C" } },
      { tool: "construct_segment", input: { id: "BC", from: "B", to: "C" } }
    ]
  },
  {
    id: "EX-P12",
    category: "planar",
    workspace: "calculus",
    prompt: "绘制函数 y = |x - 1| + 0.5x",
    goal: "绘制绝对值函数 y = abs(x - 1) + 0.5*x",
    steps: [
      { tool: "construct_tangent", input: { id: "y", mode: "graph", expression: "abs(x - 1) + 0.5*x", domain: [-4, 6] } }
    ]
  },
  {
    id: "EX-P13",
    category: "planar",
    workspace: "calculus",
    prompt: "已知函数 f(x) = x² - 4x + 5，求曲线 y = f(x) 在 x = 3 处的切线方程。",
    goal: "绘制函数 f(x) = x^2 - 4*x + 5 及在 x=3 处的切线",
    steps: [
      { tool: "construct_tangent", input: { id: "t3", functionId: "f", expression: "x^2 - 4*x + 5", domain: [-1, 6], x0: 3 } }
    ]
  },
  {
    id: "EX-P14",
    category: "planar",
    workspace: "conics",
    prompt: "已知椭圆 C：x²/16 + y²/12 = 1，左、右焦点分别为 F₁、F₂。(Ⅰ)求椭圆 C 的离心率；(Ⅱ)在(Ⅰ)的条件下，直线 x = 2 与椭圆 C 相交于 A、B 两点，求 △ABF₁ 的面积。",
    goal: "绘制两问罗马数字椭圆题 C: x²/16+y²/12=1 及焦弦 x=2",
    steps: [
      { tool: "construct_conic", input: { id: "C", conicType: "ellipse", equation: "\\frac{x^2}{16} + \\frac{y^2}{12} = 1" } },
      { tool: "construct_point", input: { id: "F₁", x: -2, y: 0 } },
      { tool: "construct_point", input: { id: "F₂", x: 2, y: 0 } },
      { tool: "construct_line", input: { id: "l", equation: "x = 2" } },
      { tool: "construct_intersection", input: { id: "A", lineA: "l", conicId: "C", selection: "max_y" } },
      { tool: "construct_intersection", input: { id: "B", lineA: "l", conicId: "C", excludePointId: "A" } },
      { tool: "construct_segment", input: { id: "AF₁", from: "A", to: "F₁" } },
      { tool: "construct_segment", input: { id: "BF₁", from: "B", to: "F₁" } }
    ]
  },
  {
    id: "EX-P15",
    category: "planar",
    workspace: "calculus",
    prompt: "已知函数 f(x) = x e^x，求曲线 y = f(x) 在 x = 1 处的切线方程。",
    goal: "绘制函数 f(x) = x * exp(x) 及在 x=1 处的切线",
    steps: [
      { tool: "construct_tangent", input: { id: "t1", functionId: "f", expression: "x * exp(x)", domain: [-3, 3], x0: 1 } }
    ]
  },
  {
    id: "EX-P16",
    category: "planar",
    workspace: "conics",
    prompt: "在 $\\Delta ABC$ 中，$AB = 3$ $AC = 4$ $\\angle BAC = 90^\\circ$，点 $D$ 为 $BC$ 的中点，求 $AD$ 的长。",
    goal: "绘制无标点相邻 LaTeX 块直角三角形 ABC 及斜边中点 D",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0 } },
      { tool: "construct_point", input: { id: "B", x: 3, y: 0 } },
      { tool: "construct_point", input: { id: "C", x: 0, y: 4 } },
      { tool: "construct_point", input: { id: "D", from: "B", to: "C", ratio: 0.5 } },
      { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } },
      { tool: "construct_segment", input: { id: "AC", from: "A", to: "C" } },
      { tool: "construct_segment", input: { id: "BC", from: "B", to: "C" } },
      { tool: "construct_segment", input: { id: "AD", from: "A", to: "D" } }
    ]
  },

  // =========================================================================
  // Wave 2: 8 MORE Fresh 3D Solid Geometry Problems (EX-S09..EX-S16)
  // =========================================================================
  {
    id: "EX-S09",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 中，球 O 的半径为 √3，求球 O 的表面积。",
    goal: "绘制棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 及其外接球 O（半径 √3）",
    steps: [
      { tool: "construct_solid", input: { id: "CUBE", kind: "cube", edgeLength: 2, vertexNames: ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"] } },
      { tool: "construct_circumsphere", input: { solidId: "CUBE", id: "O" } }
    ]
  },
  {
    id: "EX-S10",
    category: "solid",
    workspace: "geometry3d",
    prompt: "已知圆锥的底面半径为 3，母线长为 5，求该圆锥的体积与外接球半径。",
    goal: "绘制底面半径 3、母线长 5 的圆锥及其外接球",
    steps: [
      { tool: "construct_solid", input: { id: "CONE", kind: "right_circular_cone", radius: 3, slantHeight: 5 } },
      { tool: "construct_circumsphere", input: { solidId: "CONE", id: "O" } }
    ]
  },
  {
    id: "EX-S11",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在正四棱锥 P-ABCD 中，AB = 2，PA = 3，求正四棱锥 P-ABCD 的高。",
    goal: "绘制使用中式顶前顶点序 [P,A,B,C,D] 的正四棱锥 P-ABCD",
    steps: [
      { tool: "construct_solid", input: { id: "PYR", kind: "regular_square_pyramid", baseSide: 2, lateralEdge: 3, vertexNames: ["P", "A", "B", "C", "D"] } }
    ]
  },
  {
    id: "EX-S12",
    category: "solid",
    workspace: "geometry3d",
    prompt: "已知圆柱的底面直径为 4，高为 6，求该圆柱的侧面积与外接球表面积。",
    goal: "绘制底面直径 4、高 6 的圆柱及其外接球",
    steps: [
      { tool: "construct_solid", input: { id: "CYL", kind: "right_circular_cylinder", radius: 2, height: 6 } },
      { tool: "construct_circumsphere", input: { solidId: "CYL", id: "O" } }
    ]
  },
  {
    id: "EX-S13",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在正三棱柱 ABC-A₁B₁C₁ 中，AB = 2，AA₁ = 3，点 G 是 △A₁BC 的重心，求 AG 的长。",
    goal: "绘制正三棱柱 ABC-A₁B₁C₁ 及空间斜面 △A₁BC 的 3D 重心 G",
    steps: [
      { tool: "construct_solid", input: { id: "PRISM", kind: "right_triangular_prism", baseSide: 2, height: 3, vertexNames: ["A", "B", "C", "A₁", "B₁", "C₁"] } },
      { tool: "construct_point", input: { id: "G", x: 1, y: Math.sqrt(3) / 3, z: 1 } },
      { tool: "construct_face", input: { id: "F_A1BC", vertexNames: ["A₁", "B", "C"] } },
      { tool: "construct_segment", input: { id: "AG", from: "A", to: "G" } }
    ]
  },
  {
    id: "EX-S14",
    category: "solid",
    workspace: "geometry3d",
    prompt: "已知棱长为 2 的正四面体 ABCD，求其外接球的半径。",
    goal: "绘制棱长为 2 的正四面体 ABCD 及其外接球",
    steps: [
      { tool: "construct_solid", input: { id: "TET", kind: "regular_tetrahedron", edgeLength: 2, vertexNames: ["A", "B", "C", "D"] } },
      { tool: "construct_circumsphere", input: { solidId: "TET", id: "O" } }
    ]
  },
  {
    id: "EX-S15",
    category: "solid",
    workspace: "geometry3d",
    prompt: "在四棱锥 P-ABCD 中，底面 ABCD 是边长为 2 的正方形，PA⊥平面 ABCD，四棱锥 P-ABCD 的体积为 4，求 PA 的长。",
    goal: "绘制底面边长 2、体积为 4（PA=3）的四棱锥 P-ABCD",
    steps: [
      { tool: "construct_point", input: { id: "A", x: 0, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "B", x: 2, y: 0, z: 0 } },
      { tool: "construct_point", input: { id: "C", x: 2, y: 2, z: 0 } },
      { tool: "construct_point", input: { id: "D", x: 0, y: 2, z: 0 } },
      { tool: "construct_point", input: { id: "P", x: 0, y: 0, z: 3 } },
      { tool: "construct_solid", input: { id: "PYR", kind: "perpendicular_pyramid", vertexNames: ["P", "A", "B", "C", "D"] } }
    ]
  },
  {
    id: "EX-S16",
    category: "solid",
    workspace: "geometry3d",
    prompt: "已知长方体 ABCD-A₁B₁C₁D₁ 的长、宽、高分别为 2、3、4，点 E、F、G 分别为棱 AB、BC、CC₁ 的中点，求平面 EFG 截长方体所得截面的周长。",
    goal: "绘制长宽高分别为 2、3、4 的长方体及三并列中点 E、F、G",
    steps: [
      { tool: "construct_solid", input: { id: "BOX", kind: "cuboid", width: 2, depth: 3, height: 4, vertexNames: ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"] } },
      { tool: "construct_point", input: { id: "E", from: "A", to: "B", ratio: 0.5 } },
      { tool: "construct_point", input: { id: "F", from: "B", to: "C", ratio: 0.5 } },
      { tool: "construct_point", input: { id: "G", from: "C", to: "C₁", ratio: 0.5 } },
      { tool: "construct_face", input: { id: "F_EFG", vertexNames: ["E", "F", "G"] } }
    ]
  }
]

describe("Real Gaokao & Mock Exam Generalization (32 Fresh Plane + Solid Problems)", () => {
  for (const testCase of FRESH_REAL_EXAM_CASES) {
    it(`${testCase.id} (${testCase.category}): passes obligations, verification, certificate, and draftStore stage`, async () => {
      const result = await runRealExamFullPipeline(testCase)
      expect(result.obligations.unverified, `${testCase.id} unverified`).toEqual([])
      expect(result.verification.status, `${testCase.id} verification checks: ${JSON.stringify(result.verification.checks)}`).toBe("passed")
      expect(result.certificate.certificateStatus, `${testCase.id} certificate: ${result.certificate.summary}`).toBe("passed")
      expect(result.staged.ok, `${testCase.id} staged`).toBe(true)
      if (result.staged.ok) {
        expect(result.staged.preview.diagramVerification?.status).toBe("passed")
        expect(result.staged.preview.drawingCertificate?.certificateStatus).toBe("passed")
      }
    })
  }
})

describe("DeepSeek ds_action instability hardening (real failure modes)", () => {
  it("recovers from DeepSeek leaked native tokens, DSML tags, text-only drift with toolChoice=required, and preserves constructions on trailing finish_candidate rejection", async () => {
    let turn = 0
    const capturedRequests: Array<{ toolChoice?: string; maxOutputTokens?: number; messages: Array<{ role: string; content: string; reasoningContent?: string }> }> = []

    const planner = createModelPlanner({
      intentMode: "ds_action",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "ds-live-sim",
          modelId: "deepseek-chat",
          dialect: "openai",
          revision: 1,
          maxOutputTokens: 8192,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async (req) => {
        capturedRequests.push({
          ...(req.toolChoice === undefined ? {} : { toolChoice: req.toolChoice }),
          ...(req.maxOutputTokens === undefined ? {} : { maxOutputTokens: req.maxOutputTokens }),
          messages: req.messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.reasoningContent ? { reasoningContent: m.reasoningContent } : {})
          }))
        })
        turn += 1
        if (turn === 1) {
          // Turn 1: DeepSeek returns plain derivation text with zero tool calls -> triggers nudge + toolChoice="required"
          return {
            ok: true,
            events: [
              { kind: "delta" as const, requestId: "r-1", attemptId: "a-1", text: "我们先设 A(0,0), B(4,0), C(0,3)。" },
              { kind: "completed" as const, requestId: "r-1", attemptId: "a-1", stopReason: "stop" }
            ]
          }
        }
        if (turn === 2) {
          // Turn 2: DeepSeek leaks native V3/R1 tool tokens in text delta with reasoning metadata
          return {
            ok: true,
            events: [
              { kind: "started" as const, requestId: "r-2", attemptId: "a-2", model: "deepseek-chat", metadata: { reasoning: "construct triangle vertices first" } },
              {
                kind: "delta" as const,
                requestId: "r-2",
                attemptId: "a-2",
                text:
                  "<｜tool▁call▁begin｜>function<｜tool▁sep｜>construct_point\n```json\n{\"id\":\"A\",\"x\":0,\"y\":0}\n```<｜tool▁call▁end｜>\n" +
                  "<｜tool▁call▁begin｜>function<｜tool▁sep｜>construct_point\n```json\n{\"id\":\"B\",\"x\":4,\"y\":0}\n```<｜tool▁call▁end｜>"
              },
              { kind: "completed" as const, requestId: "r-2", attemptId: "a-2", stopReason: "stop" }
            ]
          }
        }
        if (turn === 3) {
          // Turn 3: DeepSeek emits DSML XML invoke to construct C and segments
          return {
            ok: true,
            events: [
              {
                kind: "delta" as const,
                requestId: "r-3",
                attemptId: "a-3",
                text:
                  "<｜DSML｜invoke name=\"construct_point\"><｜DSML｜parameter name=\"id\">C</｜DSML｜parameter><｜DSML｜parameter name=\"x\">0</｜DSML｜parameter><｜DSML｜parameter name=\"y\">3</｜DSML｜parameter></｜DSML｜invoke>" +
                  "<｜DSML｜invoke name=\"finish_candidate\"><｜DSML｜parameter name=\"goal\">直角三角形 ABC</｜DSML｜parameter></｜DSML｜invoke>"
              },
              { kind: "completed" as const, requestId: "r-3", attemptId: "a-3", stopReason: "stop" }
            ]
          }
        }
        return {
          ok: true,
          events: [
            { kind: "tool_call" as const, requestId: `r-${turn}`, attemptId: `a-${turn}`, toolCallId: `fin-${turn}`, toolId: "finish_candidate", input: { goal: "直角三角形 ABC" } }
          ]
        }
      }
    })

    const outcome = await planner.plan({
      run: {
        runId: "ds-hardening-1",
        conversationId: "conv-ds-1",
        promptMessageId: "msg-1",
        target: { projectId: "local", documentId: "doc-1", workspace: "conics", epoch: "e-1", generation: 0, contentHash: "h" },
        sources: [],
        textProfileId: "ds-live-sim",
        capabilityRevision: "2026-09-19.1",
        policyRevision: "local"
      },
      userMessage: "在直角三角形 ABC 中，∠A=90°，AB=4，AC=3。",
      budget: createBudget({ network: 10, generation: 10, tool: 20 }),
      signal: new AbortController().signal,
      model: {
        tools: [{ id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "Propose plan", phases: ["planning"], workspaces: [] }],
        context: {
          preamble: "MathCanvas",
          handles: { target: { projectId: "local", documentId: "doc-1", workspace: "conics", epoch: "e-1", generation: 0, contentHash: "h" }, sources: [] },
          binding: { conversationId: "conv-ds-1", projectId: "local", documentId: "doc-1", generation: 0 },
          workspace: "conics",
          facts: [],
          derived: [],
          selectedRefs: [],
          skills: [],
          availableActions: ["planar.create_point", "planar.create_segment"],
          warnings: [],
          estimatedCharacters: 64
        }
      },
      conversation: {
        binding: { conversationId: "conv-ds-1", projectId: "local", documentId: "doc-1", workspace: "conics", generation: 0 },
        summary: "",
        facts: [],
        messages: [],
        observation: { facts: [], summary: "" },
        warnings: [],
        estimatedCharacters: 0
      }
    })

    expect("plan" in outcome && outcome.plan.kind === "plan").toBe(true)
    expect(capturedRequests[0]?.maxOutputTokens).toBe(8192)
    expect(capturedRequests[1]?.toolChoice).toBe("required")
    // Reasoning content from Turn 2 is preserved in Turn 3 message history for DeepSeek thinking models.
    expect(capturedRequests[2]?.messages.some((m) => m.role === "tool_call" && m.reasoningContent === "construct triangle vertices first")).toBe(true)
  })

  it("never injects legacy plan_set_plan / JSON-envelope repair hints into ds_action repair prompts", () => {
    const prompt = buildSystemPrompt({
      channel: "native_tools",
      canPlan: true,
      intentMode: "ds_action",
      repair: {
        reason: "invalid_json",
        attempt: 1,
        hint: "请只返回一个 JSON 对象，如果这一轮发布了「plan_set_plan」，就直接调用它，否则用文本返回 JSON 信封。",
        errors: [{ code: "invalid_json", path: "envelope", detail: "not json" }],
        allowedChanges: ["envelope.actions"]
      },
      context: {
        preamble: "MathCanvas",
        handles: { target: { projectId: "local", documentId: "doc-1", workspace: "conics", epoch: "e-1", generation: 0, contentHash: "h" }, sources: [] },
        binding: { conversationId: "conv-1", projectId: "local", documentId: "doc-1", generation: 0 },
        workspace: "conics",
        facts: [],
        derived: [],
        selectedRefs: [],
        skills: [],
        availableActions: ["planar.create_point"],
        warnings: [],
        estimatedCharacters: 64
      }
    })

    expect(prompt.policy).not.toMatch(/就直接调用它，否则用文本返回 JSON 信封/)
    expect(prompt.policy).toMatch(/严禁输出 JSON 信封或调用 plan_set_plan/)
  })

  it("recovers mid-session from finish_reason=length and targeted unknown_tool hallucinations without losing staged geometry", async () => {
    let turn = 0
    const receivedToolResults: string[] = []
    const planner = createModelPlanner({
      intentMode: "ds_action",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "ds-live-sim-2",
          modelId: "deepseek-chat",
          dialect: "openai",
          revision: 1,
          maxOutputTokens: 8192,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async (req) => {
        for (const msg of req.messages) {
          if (msg.role === "tool_result") receivedToolResults.push(msg.content)
        }
        turn += 1
        if (turn === 1) {
          // Turn 1: Valid first geometry step
          return {
            ok: true,
            events: [
              { kind: "tool_call" as const, requestId: "r-1", attemptId: "a-1", toolCallId: "c-1", toolId: "construct_solid", input: { id: "CONE", kind: "cone", radius: 3, slantHeight: 5 } },
              { kind: "completed" as const, requestId: "r-1", attemptId: "a-1", stopReason: "tool_calls" }
            ]
          }
        }
        if (turn === 2) {
          // Turn 2: DeepSeek hits max_tokens truncation (finish_reason = "length") mid-session
          return {
            ok: true,
            events: [
              { kind: "delta" as const, requestId: "r-2", attemptId: "a-2", text: "接下来我们求外接球半径 R = (h^2 + r^2) / (2h) = ..." },
              { kind: "completed" as const, requestId: "r-2", attemptId: "a-2", stopReason: "length" }
            ]
          }
        }
        if (turn === 3) {
          // Turn 3: DeepSeek hallucinates an unknown tool name `construct_sphere`
          return {
            ok: true,
            events: [
              { kind: "tool_call" as const, requestId: "r-3", attemptId: "a-3", toolCallId: "c-3", toolId: "construct_sphere", input: { solidId: "CONE" } },
              { kind: "completed" as const, requestId: "r-3", attemptId: "a-3", stopReason: "tool_calls" }
            ]
          }
        }
        // Turn 4: Uses the exact tool suggested in repairHint + finishes
        return {
          ok: true,
          events: [
            { kind: "tool_call" as const, requestId: "r-4", attemptId: "a-4", toolCallId: "c-4", toolId: "construct_circumsphere", input: { solidId: "CONE", id: "O" } },
            { kind: "tool_call" as const, requestId: "r-4", attemptId: "a-4", toolCallId: "c-5", toolId: "finish_candidate", input: { goal: "圆锥及外接球" } },
            { kind: "completed" as const, requestId: "r-4", attemptId: "a-4", stopReason: "tool_calls" }
          ]
        }
      }
    })

    const outcome = await planner.plan({
      run: {
        runId: "ds-hardening-2",
        conversationId: "conv-ds-2",
        promptMessageId: "msg-2",
        target: { projectId: "local", documentId: "doc-2", workspace: "geometry3d", epoch: "e-2", generation: 0, contentHash: "h" },
        sources: [],
        textProfileId: "ds-live-sim-2",
        capabilityRevision: "2026-09-19.1",
        policyRevision: "local"
      },
      userMessage: "已知圆锥的底面半径为 3，母线长为 5，求该圆锥的外接球半径。",
      budget: createBudget({ network: 12, generation: 12, tool: 20 }),
      signal: new AbortController().signal,
      model: {
        tools: [{ id: "plan.set_plan", kind: "control", effect: "propose_plan", description: "Propose plan", phases: ["planning"], workspaces: [] }],
        context: {
          preamble: "MathCanvas",
          handles: { target: { projectId: "local", documentId: "doc-2", workspace: "geometry3d", epoch: "e-2", generation: 0, contentHash: "h" }, sources: [] },
          binding: { conversationId: "conv-ds-2", projectId: "local", documentId: "doc-2", generation: 0 },
          workspace: "geometry3d",
          facts: [],
          derived: [],
          selectedRefs: [],
          skills: [],
          availableActions: ["solid.create_template", "solid.create_sphere"],
          warnings: [],
          estimatedCharacters: 64
        }
      },
      conversation: {
        binding: { conversationId: "conv-ds-2", projectId: "local", documentId: "doc-2", workspace: "geometry3d", generation: 0 },
        summary: "",
        facts: [],
        messages: [],
        observation: { facts: [], summary: "" },
        warnings: [],
        estimatedCharacters: 0
      }
    })

    expect("plan" in outcome && outcome.plan.kind === "plan").toBe(true)
    if ("plan" in outcome && outcome.plan.kind === "plan") {
      // Staged cone from Turn 1 survived length truncation + unknown tool recovery
      expect(outcome.plan.actions.some((a) => a.actionId === "solid.create_template")).toBe(true)
      expect(outcome.plan.actions.some((a) => a.actionId === "solid.create_sphere")).toBe(true)
    }
    expect(receivedToolResults.some((txt) => txt.includes("construct_circumsphere"))).toBe(true)
  })
})

describe("Verification edge cases (bare prompts, fold-first wording, neutral-plan cert, repair progress)", () => {
  it("certifies everyday bare drawing prompts without false unverified or coverage blocks", async () => {
    const bareCases: RealExamCase[] = [
      {
        id: "BARE-01",
        category: "planar",
        workspace: "calculus",
        prompt: "绘制函数 y = 2sin(2x)",
        goal: "绘制函数 y = 2*sin(2*x)",
        steps: [{ tool: "construct_tangent", input: { id: "y", mode: "graph", expression: "2*sin(2*x)", domain: [-Math.PI, Math.PI] } }]
      },
      {
        id: "BARE-02",
        category: "planar",
        workspace: "conics",
        prompt: "画一个直角三角形",
        goal: "画一个直角三角形 ABC",
        steps: [
          { tool: "construct_point", input: { id: "A", x: 0, y: 0 } },
          { tool: "construct_point", input: { id: "B", x: 3, y: 0 } },
          { tool: "construct_point", input: { id: "C", x: 0, y: 4 } },
          { tool: "construct_segment", input: { id: "AB", from: "A", to: "B" } },
          { tool: "construct_segment", input: { id: "AC", from: "A", to: "C" } },
          { tool: "construct_segment", input: { id: "BC", from: "B", to: "C" } }
        ]
      }
    ]
    for (const testCase of bareCases) {
      const result = await runRealExamFullPipeline(testCase)
      expect(result.obligations.unverified, testCase.id).toEqual([])
      expect(result.certificate.certificateStatus, `${testCase.id}: ${result.certificate.summary}`).toBe("passed")
      expect(result.staged.ok, testCase.id).toBe(true)
    }
  })

  it("verifies fold-first phrasing (将矩形 ABCD 沿对角线 AC 翻折，AB=4，BC=2，使平面 ABC⊥平面 ACD)", () => {
    const prompt = "将矩形 ABCD 沿对角线 AC 翻折，AB=4，BC=2，使平面 ABC ⊥ 平面 ACD。"
    const baseDoc = createEmptyDocument("geometry3d")
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: baseDoc, problemText: prompt })
    expect(session.execute("construct_base", { shape: "rectangle", width: 4, depth: 2, vertexNames: ["A", "B", "C", "D"] }).ok).toBe(true)
    expect(session.execute("construct_fold_state", { vertexNames: ["A", "B", "C"], hinge: { from: "A", to: "C" }, apex: "B", apexAs: "B′", angle: 90 }).ok).toBe(true)
    const finished = session.execute("finish_candidate", { goal: "矩形 ABCD 沿 AC 翻折 90°" })
    expect(finished.ok && finished.terminated?.plan.kind === "plan", JSON.stringify(finished)).toBe(true)
    if (!finished.ok || finished.terminated?.plan.kind !== "plan") return
    const compiled = compilePlan(finished.terminated.plan, {
      document: baseDoc,
      workspace: "geometry3d",
      conversationId: "fold-first-test",
      documentGeneration: 0
    })
    expect(compiled.ok && compiled.draftDocument !== undefined).toBe(true)
    if (!compiled.ok || !compiled.draftDocument) return
    const obligations = parseDiagramObligations(normalizeGeometryPrompt(prompt))
    const report = verifyDiagramObligations(obligations, finished.terminated.plan, compiled.draftDocument, baseDoc, {
      prompt: normalizeGeometryPrompt(prompt)
    })
    expect(report.status, JSON.stringify(report.checks)).toBe("passed")
  })

  it("certifies circle & function tangent documents cleanly even without a plan (neutral-plan fallback)", async () => {
    const tangentCase = FRESH_REAL_EXAM_CASES.find((c) => c.id === "EX-P13")!
    const tangentRes = await runRealExamFullPipeline(tangentCase)
    const neutralTangentCert = certifyDrawingAgainstContract({
      prompt: tangentCase.prompt,
      document: tangentRes.compiled.draftDocument!,
      candidateHash: "neutral-t",
      sourceHash: "neutral-t"
    })
    expect(neutralTangentCert.certificateStatus, neutralTangentCert.summary).toBe("passed")

    const circleCase = FRESH_REAL_EXAM_CASES.find((c) => c.id === "EX-P09")!
    const circleRes = await runRealExamFullPipeline(circleCase)
    const neutralCircleCert = certifyDrawingAgainstContract({
      prompt: circleCase.prompt,
      document: circleRes.compiled.draftDocument!,
      candidateHash: "neutral-c",
      sourceHash: "neutral-c"
    })
    expect(neutralCircleCert.certificateStatus, neutralCircleCert.summary).toBe("passed")
  })

  it("excludes synthetic drawingCertificate aggregate from repairProgress so single-obligation repairs get a second chance", () => {
    const tracker = createTargetedRepairTracker({ maxRounds: 3 })
    const round1 = tracker.evaluate({
      candidateHash: "hash-1",
      checks: [
        { id: "obl-1", status: "failed", detail: "AB=4: 偏差 0.8" },
        { id: "drawingCertificate", status: "failed", detail: "数学证书未通过（partial）" }
      ],
      maxResidual: 0.8
    })
    expect(round1.allowRepair).toBe(true)

    // Round 2 shrinks residual on obl-1 (0.8 -> 0.05) while synthetic drawingCertificate is still present
    const round2 = tracker.evaluate({
      candidateHash: "hash-2",
      checks: [
        { id: "obl-1", status: "failed", detail: "AB=4: 偏差 0.05" },
        { id: "drawingCertificate", status: "failed", detail: "数学证书未通过（partial）" }
      ],
      maxResidual: 0.05
    })
    expect(round2.allowRepair).toBe(true)
    expect(round2.stopReason).toBeUndefined()
  })

  it("auto-clears standalone Chinese exam prompts starting with 在...中 / 将...翻折 while preserving incremental edit prompts", () => {
    expect(shouldAutoClearSceneForPrompt("在 △ABC 中，AB = 4，BC = 6，cos∠ABC = 1/2，求 BD 的长。", false)).toBe(true)
    expect(shouldAutoClearSceneForPrompt("在长方体 ABCD-A₁B₁C₁D₁ 中，AB = 2，AD = 3，AA₁ = 4，求距离。", false)).toBe(true)
    expect(shouldAutoClearSceneForPrompt("在棱长为 2 的正方体 ABCD-A₁B₁C₁D₁ 中，E、F 分别为 AB、BC 的中点，求证：EF⊥平面 BB₁D₁D。", false)).toBe(true)
    expect(shouldAutoClearSceneForPrompt("将矩形 ABCD 沿对角线 AC 翻折，AB=4，BC=2，使平面 ABC⊥平面 ACD。", false)).toBe(true)
    expect(shouldAutoClearSceneForPrompt("建一个棱长 2 的立方体", false)).toBe(false)
    expect(shouldAutoClearSceneForPrompt("在现有长方体中增加中点 E", false)).toBe(false)
    expect(shouldAutoClearSceneForPrompt("在 △ABC 中，AB = 4，求 AC。", true)).toBe(false)
  })

  it("prioritizes newly created point labels over stale base canvas labels during verification", () => {
    const baseDoc = createEmptyDocument("conics")
    baseDoc.primitives.push(
      { id: "stale-a", type: "point", x: 99, y: 99, label: "A" } as never,
      { id: "stale-b", type: "point", x: -88, y: 77, label: "B" } as never
    )
    const prompt = "在 △ABC 中，AB = 4，BC = 6，cos∠ABC = 1/2，求 AC 的长。"
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics"), problemText: prompt })
    expect(session.execute("construct_point", { id: "A", x: 0, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "B", x: 4, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "C", x: 1, y: 3 * Math.sqrt(3) }).ok).toBe(true)
    const finished = session.execute("finish_candidate", { goal: "△ABC" })
    expect(finished.ok && finished.terminated?.plan.kind === "plan").toBe(true)
    if (!finished.ok || finished.terminated?.plan.kind !== "plan") return
    const compiled = compilePlan(finished.terminated.plan, {
      document: baseDoc,
      workspace: "conics",
      conversationId: "stale-label-priority",
      documentGeneration: 0
    })
    expect(compiled.ok && compiled.draftDocument !== undefined).toBe(true)
    if (!compiled.ok || !compiled.draftDocument) return
    const obligations = parseDiagramObligations(normalizeGeometryPrompt(prompt))
    const report = verifyDiagramObligations(obligations, finished.terminated.plan, compiled.draftDocument, baseDoc, {
      prompt: normalizeGeometryPrompt(prompt)
    })
    expect(report.status, JSON.stringify(report.checks)).toBe("passed")
  })

  it("rejects multi-letter vertex names like Df immediately in construct_face and construct_fold_state while allowing D₀", () => {
    const baseDoc = createEmptyDocument("geometry3d")
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: baseDoc })
    expect(session.execute("construct_base", { shape: "rectangle", width: 4, depth: 2, vertexNames: ["A", "B", "C", "D"] }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "Df", x: 1, y: 1, z: 2 }).ok).toBe(true)
    const badFace = session.execute("construct_face", { vertexNames: ["A", "C", "Df"] })
    expect(badFace.ok).toBe(false)
    expect(badFace.blockerCode).toBe("invalid_point_name")

    const badFold = session.execute("construct_fold_state", {
      vertexNames: ["A", "B", "C"],
      hinge: { from: "A", to: "C" },
      apex: "B",
      apexAs: "Bf",
      angle: 90
    })
    expect(badFold.ok).toBe(false)
    expect(badFold.blockerCode).toBe("invalid_point_name")

    const goodFold = session.execute("construct_fold_state", {
      vertexNames: ["A", "B", "C"],
      hinge: { from: "A", to: "C" },
      apex: "B",
      apexAs: "B₀",
      angle: 90
    })
    expect(goodFold.ok).toBe(true)
  })
})

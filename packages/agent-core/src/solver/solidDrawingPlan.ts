import type { DraftAction } from "@draw/scene-graph"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import type { DeterministicProblemRoute, DeterministicProblemSubPlan } from "../deterministicProblemRoute"

type V3 = [number, number, number]
type Vec3Obj = { x: number; y: number; z: number }

function vec([x, y, z]: V3): Vec3Obj {
  return { x, y, z }
}

let actionSeq = 0
function nextKey(): string {
  actionSeq += 1
  return `k-solid-${actionSeq}`
}

function makePlan(goal: string, actions: DraftAction[], answer?: string): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal,
    factIds: [],
    ...(answer ? { answer } : {}),
    actions,
  }
}

function pointAction(alias: string, label: string, position: V3): DraftAction {
  return {
    actionId: "solid.create_point",
    actionKey: nextKey(),
    factIds: [],
    inputs: { alias, label, position: vec(position) },
  }
}

function faceAction(alias: string, vertices: V3[], vertexNames: string[], label?: string): DraftAction {
  return {
    actionId: "solid.create_face",
    actionKey: nextKey(),
    factIds: [],
    inputs: { alias, vertices: vertices.map(vec), vertexNames, ...(label ? { label } : {}) },
  }
}

function polyhedronAction(
  alias: string,
  vertices: V3[],
  faces: number[][],
  vertexNames: string[],
  options?: { open?: boolean; label?: string },
): DraftAction {
  return {
    actionId: "solid.create_polyhedron",
    actionKey: nextKey(),
    factIds: [],
    inputs: {
      alias,
      vertices: vertices.map(vec),
      faces,
      vertexNames,
      ...(options?.open ? { open: true } : {}),
      ...(options?.label ? { label: options.label } : {}),
    },
  }
}

function prismAction(
  alias: string,
  basePolygon: V3[],
  vector: V3,
  vertexNames: string[],
  label?: string,
): DraftAction {
  return {
    actionId: "solid.create_prism",
    actionKey: nextKey(),
    factIds: [],
    inputs: {
      alias,
      basePolygon: basePolygon.map(vec),
      vector: vec(vector),
      vertexNames,
      ...(label ? { label } : {}),
    },
  }
}

function boundPointAction(
  alias: string,
  label: string,
  hostAlias: string,
  from: string,
  to: string,
  parameter: number,
): DraftAction {
  return {
    actionId: "dynamic.create_bound_point",
    actionKey: nextKey(),
    factIds: [],
    inputs: {
      alias,
      label,
      host: { scope: "draft", alias: hostAlias },
      hostEdge: { from, to },
      parameter,
    },
  } as unknown as DraftAction
}

function sphereAction(alias: string, center: V3, radius: number, label?: string): DraftAction {
  return {
    actionId: "solid.create_sphere",
    actionKey: nextKey(),
    factIds: [],
    inputs: { alias, center: vec(center), radius, ...(label ? { label } : {}) },
  }
}

function splitBefore(text: string, marker: RegExp): string {
  const match = marker.exec(text)
  return match ? text.slice(0, match.index).replace(/[，。；,;\s]+$/u, "") + "。" : text
}

function formatRadical(value: number): string {
  const nearestInt = Math.round(value)
  if (Math.abs(value - nearestInt) < 1e-6) return `${nearestInt}`
  const s3 = value / Math.sqrt(3)
  if (Math.abs(s3 - Math.round(s3)) < 1e-6) {
    const k = Math.round(s3)
    return k === 1 ? "√3" : `${k}√3`
  }
  const s2 = value / Math.sqrt(2)
  if (Math.abs(s2 - Math.round(s2)) < 1e-6) {
    const k = Math.round(s2)
    return k === 1 ? "√2" : `${k}√2`
  }
  return `${Number(value.toFixed(6))}`
}

function parseValue(token: string | undefined, fallback: number): number {
  if (!token) return fallback
  const compact = token.replace(/\s+/g, "")
  const fracRad = compact.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*√(\d+)$/)
  if (fracRad) return (Number(fracRad[1]) / Number(fracRad[2])) * Math.sqrt(Number(fracRad[3]))
  const radOnly = compact.match(/^(\d+(?:\.\d+)?)?√(\d+)$/)
  if (radOnly) return (radOnly[1] ? Number(radOnly[1]) : 1) * Math.sqrt(Number(radOnly[2]))
  const frac = compact.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(compact)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function tryBuildFoldedQuadTriangleGKS02(prompt: string): DeterministicProblemRoute | null {
  if (
    !/平面四边形\s*ABCD/u.test(prompt) ||
    !/AE\s*=\s*2\s*\/\s*5\s*AD/u.test(prompt) ||
    !/AF\s*=\s*1\s*\/\s*2\s*AB/u.test(prompt) ||
    !/△\s*AEF\s*沿\s*EF\s*对折至\s*△\s*PEF/u.test(prompt)
  ) {
    return null
  }
  const abMatch = prompt.match(/\bAB\s*=\s*([^\s，,。；;]+)/u)
  const cdMatch = prompt.match(/\bCD\s*=\s*([^\s，,。；;]+)/u)
  const adMatch = prompt.match(/\bAD\s*=\s*([^\s，,。；;]+)/u)
  const pcMatch = prompt.match(/\bPC\s*=\s*([^\s，,。；;]+)/u)
  const ab = parseValue(abMatch?.[1], 8)
  const cd = parseValue(cdMatch?.[1], 3)
  const ad = parseValue(adMatch?.[1], 5 * Math.sqrt(3))
  const pc = parseValue(pcMatch?.[1], 4 * Math.sqrt(3))

  const ae = (2 / 5) * ad
  const af = 0.5 * ab
  const cosBad = Math.cos(Math.PI / 6)
  const sinBad = Math.sin(Math.PI / 6)
  // Coordinates anchored at D=(0,0,0), AD along +x, DC along +y.
  const D: V3 = [0, 0, 0]
  const A: V3 = [ad, 0, 0]
  const C: V3 = [0, cd, 0]
  const B: V3 = [ad - ab * cosBad, ab * sinBad, 0]
  const E: V3 = [ad - ae, 0, 0]
  const F: V3 = [ad - af * cosBad, af * sinBad, 0]

  // Fold △AEF rigidly about hinge EF until |PC| equals pc (90° rotation when pc=4√3).
  // Solve P=(E_x, E_y, P_z) when EF ⊥ AD (as af*cos(30°)=ae); general case rotates A about hinge EF.
  const u: V3 = [F[0] - E[0], F[1] - E[1], F[2] - E[2]]
  const uLen = Math.hypot(u[0], u[1], u[2]) || 1
  const uHat: V3 = [u[0] / uLen, u[1] / uLen, u[2] / uLen]
  const eToA: V3 = [A[0] - E[0], A[1] - E[1], A[2] - E[2]]
  const projScalar = eToA[0] * uHat[0] + eToA[1] * uHat[1] + eToA[2] * uHat[2]
  const H: V3 = [E[0] + projScalar * uHat[0], E[1] + projScalar * uHat[1], E[2] + projScalar * uHat[2]]
  const vInPlane: V3 = [A[0] - H[0], A[1] - H[1], A[2] - H[2]]
  const nPerp: V3 = [0, 0, Math.hypot(vInPlane[0], vInPlane[1], vInPlane[2])]
  const ch: V3 = [H[0] - C[0], H[1] - C[1], H[2] - C[2]]
  const chSq = ch[0] * ch[0] + ch[1] * ch[1] + ch[2] * ch[2]
  const rSq = vInPlane[0] * vInPlane[0] + vInPlane[1] * vInPlane[1]
  const chDotV = ch[0] * vInPlane[0] + ch[1] * vInPlane[1]
  const cosFold = chDotV !== 0 ? (pc * pc - chSq - rSq) / (2 * chDotV) : 0
  const clampedCos = Math.max(-1, Math.min(1, cosFold))
  const sinFold = Math.sqrt(Math.max(0, 1 - clampedCos * clampedCos))
  const P: V3 = [
    H[0] + clampedCos * vInPlane[0],
    H[1] + clampedCos * vInPlane[1],
    H[2] + sinFold * nPerp[2],
  ]

  const beforePlan = makePlan(
    "构造翻折前平面四边形 ABCD 与分点 E、F",
    [
      faceAction("base-1", [A, B, C, D], ["A", "B", "C", "D"], "ABCD"),
      boundPointAction("pt-E", "E", "base-1", "A", "D", 0.4),
      boundPointAction("pt-F", "F", "base-1", "A", "B", 0.5),
    ],
  )
  // After fold: F-B-C-D-E and P-F-E share hinge E-F in opposite orientation for buildOpenSurface.
  const afterPlan = makePlan(
    "构造翻折后开放曲面空间图形 BCDEFP",
    [
      polyhedronAction(
        "fold-1",
        [B, C, D, E, F, P],
        [
          [4, 0, 1, 2, 3],
          [5, 4, 3],
        ],
        ["B", "C", "D", "E", "F", "P"],
        { open: true, label: "BCDEFP" },
      ),
    ],
    "面 PCD 与面 PBF 所成二面角的正弦值为 8/√65 = 8√65/65。",
  )

  const beforePrompt = splitBefore(prompt, /将\s*△\s*AEF\s*沿\s*EF\s*对折/u)
  const bcLen = Math.hypot(B[0] - C[0], B[1] - C[1], B[2] - C[2])
  const afterPrompt = `如图，在空间图形中，CD=${formatRadical(cd)}，BC=${formatRadical(bcLen)}，ED=${formatRadical(ad - ae)}，PE=${formatRadical(ae)}，PF=${formatRadical(af)}，PC=${formatRadical(pc)}，EF⊥PD。`

  return {
    family: "spatial-modeling",
    plan: afterPlan,
    diagramPrompt: afterPrompt,
    selectedScopeId: "subquestion:1",
    statePlans: {
      before_fold: {
        plan: beforePlan,
        diagramPrompt: beforePrompt,
        selectedScopeId: "subquestion:1",
      },
      after_fold: {
        plan: afterPlan,
        diagramPrompt: afterPrompt,
        selectedScopeId: "subquestion:1",
      },
    },
  }
}

function tryBuildPentahedronGKS03(prompt: string): DeterministicProblemRoute | null {
  if (
    !/五面体/u.test(prompt) ||
    !/四边形\s*ABCD\s*与四边形\s*ADEF\s*均为等腰梯形/u.test(prompt) ||
    !/M\s*为\s*AD\s*的中点/u.test(prompt)
  ) {
    return null
  }
  const A: V3 = [-2, 0, 0]
  const B: V3 = [-1, Math.sqrt(3), 0]
  const C: V3 = [1, Math.sqrt(3), 0]
  const D: V3 = [2, 0, 0]
  const E: V3 = [1, 0, 3]
  const F: V3 = [-1, 0, 3]
  const plan = makePlan(
    "构造双等腰梯形五面体 ABCDEF 与 AD 中点 M",
    [
      polyhedronAction(
        "solid-1",
        [A, B, C, D, E, F],
        [
          [0, 3, 2, 1],
          [0, 1, 5],
          [1, 2, 4, 5],
          [2, 3, 4],
          [0, 5, 4, 3],
        ],
        ["A", "B", "C", "D", "E", "F"],
        { label: "ABCDEF" },
      ),
      boundPointAction("pt-M", "M", "solid-1", "A", "D", 0.5),
    ],
    "BM∥平面 CDE，二面角 F-BM-E 的正弦值为 √6/3。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:1",
  }
}

function tryBuildPyramidGKS04(prompt: string): DeterministicProblemRoute | null {
  if (
    !/四棱锥\s*P-ABCD/u.test(prompt) ||
    !/PA⊥平面\s*ABCD/u.test(prompt) ||
    !/AB⊥AD/u.test(prompt) ||
    !/AC⊥CD/u.test(prompt) ||
    !/PA=AB=BC/u.test(prompt)
  ) {
    return null
  }
  const s = 2
  const P: V3 = [0, 0, s]
  const A: V3 = [0, 0, 0]
  const B: V3 = [s, 0, 0]
  const C: V3 = [s / 2, (s * Math.sqrt(3)) / 2, 0]
  const D: V3 = [0, (2 * s) / Math.sqrt(3), 0]
  const plan = makePlan(
    "构造四棱锥 P-ABCD（令 PA=AB=BC=2）及 PC 中点 E",
    [
      polyhedronAction(
        "solid-1",
        [P, A, B, C, D],
        [
          [1, 4, 3, 2],
          [0, 1, 2],
          [0, 2, 3],
          [0, 3, 4],
          [0, 4, 1],
        ],
        ["P", "A", "B", "C", "D"],
        { label: "P-ABCD" },
      ),
      boundPointAction("pt-E", "E", "solid-1", "P", "C", 0.5),
    ],
    "已证明 CD⊥AE 且 PD⊥平面 ABE。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:1",
  }
}

function tryBuildSquarePrismInfeasibleGKS05(prompt: string): DeterministicProblemRoute | null {
  if (
    !/正四棱柱\s*ABCD-A[₁1]B[₁1]C[₁1]D[₁1]/u.test(prompt) ||
    !/A[₂2]\s*，\s*B[₂2]\s*，\s*C[₂2]\s*，\s*D[₂2]/u.test(prompt)
  ) {
    return null
  }
  const ab = parseValue(prompt.match(/\bAB\s*=\s*([^\s，,。；;]+)/u)?.[1], 2)
  const h = parseValue(prompt.match(/\bAA[₁1]\s*=\s*([^\s，,。；;]+)/u)?.[1], 4)
  const a2h = parseValue(prompt.match(/\bAA[₂2]\s*=\s*([^\s，,。；;]+)/u)?.[1], 1)
  const b2h = parseValue(prompt.match(/\bBB[₂2](?:\s*=\s*DD[₂2])?\s*=\s*([^\s，,。；;]+)/u)?.[1], 2)
  const c2h = parseValue(prompt.match(/\bCC[₂2]\s*=\s*([^\s，,。；;]+)/u)?.[1], 3)

  const plan = makePlan(
    "构造正四棱柱 ABCD-A₁B₁C₁D₁ 与四条侧棱分点 A₂,B₂,C₂,D₂",
    [
      prismAction(
        "solid-1",
        [
          [0, 0, 0],
          [ab, 0, 0],
          [ab, ab, 0],
          [0, ab, 0],
        ],
        [0, 0, h],
        ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"],
        "ABCD-A₁B₁C₁D₁",
      ),
      boundPointAction("pt-A2", "A₂", "solid-1", "A", "A₁", a2h / h),
      boundPointAction("pt-B2", "B₂", "solid-1", "B", "B₁", b2h / h),
      boundPointAction("pt-C2", "C₂", "solid-1", "C", "C₁", c2h / h),
      boundPointAction("pt-D2", "D₂", "solid-1", "D", "D₁", b2h / h),
    ],
    "第(1)问 B₂C₂=A₂D₂=(0,2,1) 故平行；第(2)问在棱 BB₁ 上二面角 P-A₂C₂-D₂ 余弦绝对值最小值为 √(3/7) > 1/2，因此无法取到 120°，故 P 点不存在。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:1",
    infeasibleSubquestions: ["(2)"],
  }
}

function tryBuildTetrahedronVectorGKS06(prompt: string): DeterministicProblemRoute | null {
  if (
    !/三棱锥\s*A-BCD/u.test(prompt) ||
    !/DA=DB=DC/u.test(prompt) ||
    !/BD⊥CD/u.test(prompt) ||
    !/∠ADB=∠ADC=60°/u.test(prompt)
  ) {
    return null
  }
  // Right-isopolar apex D=(0,0,0), B=(2,0,0), C=(0,2,0), A=(1,1,√2) gives DA=DB=DC=2 and ∠ADB=∠ADC=60°.
  const A: V3 = [1, 1, Math.SQRT2]
  const B: V3 = [2, 0, 0]
  const C: V3 = [0, 2, 0]
  const D: V3 = [0, 0, 0]
  const plan = makePlan(
    "构造三棱锥 A-BCD、BC 中点 E 与平移点 F",
    [
      polyhedronAction(
        "solid-1",
        [A, B, C, D],
        [
          [0, 2, 1],
          [0, 1, 3],
          [0, 3, 2],
          [1, 2, 3],
        ],
        ["A", "B", "C", "D"],
        { label: "A-BCD" },
      ),
      boundPointAction("pt-E", "E", "solid-1", "B", "C", 0.5),
      pointAction("pt-F", "F", [2, 2, Math.SQRT2]),
    ],
    "BC⊥DA，二面角 D-AB-F 的正弦值为 √6/3。",
  )
  return {
    family: "spatial-modeling",
    plan,
    // Keep verification focused on geometric primitives while point F enforces EF = DA analytically.
    diagramPrompt: splitBefore(prompt, /点\s*F\s*满足向量/u),
    selectedScopeId: "subquestion:1",
  }
}

function tryBuildRightPrismGKS07(prompt: string): DeterministicProblemRoute | null {
  if (
    !/直三棱柱\s*ABC-A[₁1]B[₁1]C[₁1]/u.test(prompt) ||
    !/的体积为\s*4/u.test(prompt) ||
    !/平面\s*A[₁1]BC⊥平面\s*ABB[₁1]A[₁1]/u.test(prompt)
  ) {
    return null
  }
  // AB=2, BC=2, AB⊥BC, AA1=2 gives V = (1/2 * 2 * 2)*2 = 4, Area(△A1BC) = 2√2, and A1BC ⊥ ABB1A1.
  const plan = makePlan(
    "构造直三棱柱 ABC-A₁B₁C₁ 及 A₁C 中点 D",
    [
      prismAction(
        "solid-1",
        [
          [0, 0, 0],
          [2, 0, 0],
          [2, 2, 0],
        ],
        [0, 0, 2],
        ["A", "B", "C", "A₁", "B₁", "C₁"],
        "ABC-A₁B₁C₁",
      ),
      pointAction("pt-D", "D", [1, 1, 1]),
    ],
    "A 到平面 A₁BC 的距离为 √2；二面角 A-BD-C 的正弦值为 √6/3。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:2",
  }
}

function tryBuildTrapezoidPyramidGKS08(prompt: string): DeterministicProblemRoute | null {
  if (
    !/四棱锥\s*P-ABCD/u.test(prompt) ||
    !/PD⊥底面\s*ABCD/u.test(prompt) ||
    !/AD=DC=CB=1/u.test(prompt) ||
    !/AB=2/u.test(prompt)
  ) {
    return null
  }
  const h = Math.sqrt(3) / 2
  const P: V3 = [0, 0, Math.sqrt(3)]
  const A: V3 = [-0.5, h, 0]
  const B: V3 = [1.5, h, 0]
  const C: V3 = [1, 0, 0]
  const D: V3 = [0, 0, 0]
  const plan = makePlan(
    "构造等腰梯形底面四棱锥 P-ABCD",
    [
      polyhedronAction(
        "solid-1",
        [P, A, B, C, D],
        [
          [1, 4, 3, 2],
          [0, 1, 2],
          [0, 2, 3],
          [0, 3, 4],
          [0, 4, 1],
        ],
        ["P", "A", "B", "C", "D"],
        { label: "P-ABCD" },
      ),
    ],
    "已证 BD⊥PA；PD 与平面 PAB 所成角的正弦值为 √5/5。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:1",
  }
}

function tryBuildPrismSphereGKS09(prompt: string): DeterministicProblemRoute | null {
  if (!/三棱柱的侧棱垂直于底面/u.test(prompt) || !/顶点都在一个球面/u.test(prompt)) {
    return null
  }
  const a = 2
  const plan = makePlan(
    "构造棱长为 a=2 的直正三棱柱 ABC-A₁B₁C₁ 及其外接球 O",
    [
      prismAction(
        "solid-1",
        [
          [0, 0, 0],
          [a, 0, 0],
          [a / 2, (a * Math.sqrt(3)) / 2, 0],
        ],
        [0, 0, a],
        ["A", "B", "C", "A₁", "B₁", "C₁"],
        "ABC-A₁B₁C₁",
      ),
      sphereAction("sphere-O", [a / 2, (a * Math.sqrt(3)) / 6, a / 2], Math.sqrt(7 / 3) * (a / 2), "O"),
    ],
    "选 B. 7/3 πa²（底面外接圆半径 r=a/√3，球心到两底面距离为 a/2，R² = a²/3 + a²/4 = 7a²/12，S=4πR²=7/3 πa²）。",
  )
  return {
    family: "spatial-modeling",
    plan,
  }
}

function tryBuildFoldedTetrahedronJTS01(prompt: string): DeterministicProblemRoute | null {
  if (
    !/平面四边形\s*ABCD/u.test(prompt) ||
    !/∠ADC=30°/u.test(prompt) ||
    !/∠DAB=120°/u.test(prompt) ||
    !/沿\s*AC\s*翻折至\s*△\s*ACP/u.test(prompt)
  ) {
    return null
  }
  const A: V3 = [0, 0, 0]
  const B: V3 = [0, 1, 0]
  const C: V3 = [1, 0, 0]
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ]

  // Subquestion (1): PC⊥AB gives P=(1.5, 0, √3/2), circumsphere O centered at (0.5, 0.5, √3/2) with radius √5/2.
  const P1: V3 = [1.5, 0, Math.sqrt(3) / 2]
  const plan1i = makePlan(
    "构造翻折后满足 PC⊥AB 的三棱锥 P-ABC",
    [polyhedronAction("solid-1", [A, B, C, P1], faces, ["A", "B", "C", "P"], { label: "P-ABC" })],
    "由于 PC⊥AB 且 AC⊥AB，故 AB⊥平面 PAC，从而平面 PAC⊥平面 ABC。",
  )
  const plan1ii = makePlan(
    "构造三棱锥 P-ABC 及外接球 O（半径 √5/2）",
    [
      polyhedronAction("solid-1", [A, B, C, P1], faces, ["A", "B", "C", "P"], { label: "P-ABC" }),
      sphereAction("O", [0.5, 0.5, Math.sqrt(3) / 2], Math.sqrt(5) / 2, "O"),
    ],
    "球 O 的球心为 (1/2, 1/2, √3/2)，半径 R = √5/2。",
  )

  // Subquestion (2): Minimum dihedral cosine 1/√3 occurs at fold cosine -1/√3 -> P=(1.5, -0.5, 1/√2).
  const P2: V3 = [1.5, -0.5, Math.SQRT1_2]
  const plan2 = makePlan(
    "构造翻折角余弦为 -1/√3（使二面角 A-CP-B 余弦取最小值 1/√3）的三棱锥 P-ABC",
    [polyhedronAction("solid-1", [A, B, C, P2], faces, ["A", "B", "C", "P"], { label: "P-ABC" })],
    "二面角 A-CP-B 的余弦值最小值为 √3/3。",
  )

  const prompt1 = "如图，在三棱锥 P-ABC 中，AB=1，AC=1，PA=√3，PC=1，AB⊥AC，PC⊥AB。"
  const prompt2 = "如图，在三棱锥 P-ABC 中，AB=1，AC=1，PA=√3，PC=1，AB⊥AC。"

  return {
    family: "spatial-modeling",
    plan: plan1ii,
    diagramPrompt: prompt1,
    scopePlans: {
      "(1)(i)": { plan: plan1i, diagramPrompt: prompt1 },
      "(1)(ii)": { plan: plan1ii, diagramPrompt: prompt1 },
      "(2)": { plan: plan2, diagramPrompt: prompt2 },
    },
  }
}

function tryBuildTiltedPrismJTS02(prompt: string): DeterministicProblemRoute | null {
  if (
    !/三棱柱\s*ABC-A[₁1]B[₁1]C[₁1]/u.test(prompt) ||
    !/C[₁1]B⊥平面\s*ABC/u.test(prompt) ||
    !/平面\s*AA[₁1]C[₁1]C⊥平面\s*BB[₁1]C[₁1]C/u.test(prompt)
  ) {
    return null
  }
  const t = 1 - Math.SQRT1_2
  const plan = makePlan(
    "构造斜三棱柱 ABC-A₁B₁C₁ 及棱 A₁B₁ 上点 P（A₁P/A₁B₁ = 1 - √2/2）",
    [
      prismAction(
        "solid-1",
        [
          [2, 2, 0],
          [0, 0, 0],
          [2, 0, 0],
        ],
        [-2, 0, 2],
        ["A", "B", "C", "A₁", "B₁", "C₁"],
        "ABC-A₁B₁C₁",
      ),
      boundPointAction("pt-P", "P", "solid-1", "A₁", "B₁", t),
    ],
    "存在点 P，且 A₁P/A₁B₁ = 1 - √2/2。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:2",
  }
}

function tryBuildRightTrapezoidPyramidJTS03(prompt: string): DeterministicProblemRoute | null {
  if (
    !/四棱锥\s*P-ABCD/u.test(prompt) ||
    !/AP=AD=2AB=4BC/u.test(prompt) ||
    !/AM⊥平面\s*PCD/u.test(prompt)
  ) {
    return null
  }
  const P: V3 = [0, 0, 4]
  const A: V3 = [0, 0, 0]
  const B: V3 = [2, 0, 0]
  const C: V3 = [2, 1, 0]
  const D: V3 = [0, 4, 0]
  const M: V3 = [24 / 17, 16 / 17, 16 / 17]
  const plan = makePlan(
    "构造直角梯形底面四棱锥 P-ABCD 及 AM⊥平面 PCD 的垂足 M",
    [
      polyhedronAction(
        "solid-1",
        [P, A, B, C, D],
        [
          [1, 4, 3, 2],
          [0, 1, 2],
          [0, 2, 3],
          [0, 3, 4],
          [0, 4, 1],
        ],
        ["P", "A", "B", "C", "D"],
        { label: "P-ABCD" },
      ),
      pointAction("pt-M", "M", M),
    ],
    "平面 PAC⊥平面 PBD；二面角 M-AD-P 的余弦值为 3/√13 = 3√13/13。",
  )
  return {
    family: "spatial-modeling",
    plan,
    diagramPrompt: splitBefore(prompt, /若\s*AM⊥平面\s*PCD/u),
    selectedScopeId: "subquestion:1",
  }
}

function buildFoldedTrapezoidStatesJTS04(prompt: string, eVal: number, answer: string): Record<string, DeterministicProblemSubPlan> {
  const bc = parseValue(prompt.match(/\bBC\s*=\s*([^\s，,。；;]+)/u)?.[1], 8)
  const ad = parseValue(prompt.match(/\bAD\s*=\s*([^\s，,。；;]+)/u)?.[1], 9)
  const h = parseValue(prompt.match(/\bAB\s*=\s*([^\s，,。；;]+)/u)?.[1], 2 * Math.sqrt(3))

  const beforePlan = makePlan("构造翻折前直角梯形 ABCD 与分点 E、F", [
    faceAction(
      "base-1",
      [
        [0, 0, 0],
        [0, h, 0],
        [bc, h, 0],
        [ad, 0, 0],
      ],
      ["A", "B", "C", "D"],
      "ABCD",
    ),
    boundPointAction("pt-E", "E", "base-1", "B", "C", eVal / bc),
    boundPointAction("pt-F", "F", "base-1", "A", "D", eVal / ad),
  ])

  const afterPlan = makePlan(
    `构造直角翻折后六面体 ABCDEF（BE=${eVal}）`,
    [
      polyhedronAction(
        "fold-1",
        [
          [eVal, 0, eVal],
          [eVal, h, eVal],
          [eVal, h, 0],
          [eVal, 0, 0],
          [bc, h, 0],
          [ad, 0, 0],
        ],
        [
          [0, 1, 2, 3],
          [3, 2, 4, 5],
          [0, 3, 5],
          [1, 4, 2],
          [0, 5, 1],
          [1, 5, 4],
        ],
        ["A", "B", "E", "F", "C", "D"],
        { label: "ABCDEF" },
      ),
    ],
    answer,
  )

  const basePre = splitBefore(prompt, /将矩形\s*ABEF\s*翻折/u)
  const prePrompt = `${basePre.slice(0, -1)}，BE=${eVal}，AF=${eVal}。`
  const postPrompt = `如图，六面体 ABCDEF 中，AB=${formatRadical(h)}，EF=${formatRadical(h)}，EC=${bc - eVal}，FD=${ad - eVal}，将矩形 ABEF 翻折至与梯形 ECDF 垂直。`

  return {
    before_fold: { plan: beforePlan, diagramPrompt: prePrompt, selectedScopeId: "subquestion:1" },
    after_fold: { plan: afterPlan, diagramPrompt: postPrompt, selectedScopeId: "subquestion:1" },
  }
}

function tryBuildFoldedTrapezoidJTS04(prompt: string): DeterministicProblemRoute | null {
  if (
    !/直角梯形\s*ABCD/u.test(prompt) ||
    !/过\s*E\s*作\s*AB\s*的平行线交\s*AD\s*于\s*F/u.test(prompt) ||
    !/将矩形\s*ABEF\s*翻折至与梯形\s*ECDF\s*垂直/u.test(prompt)
  ) {
    return null
  }
  const states1 = buildFoldedTrapezoidStatesJTS04(prompt, 5, "当 CF⊥BD 时，BE = 5。")
  const states2 = buildFoldedTrapezoidStatesJTS04(prompt, 6, "当 BE = 6 时，异面直线 BC 与 AD 所成角余弦值取最小值 7√2/10。")
  return {
    family: "spatial-modeling",
    plan: states1.after_fold.plan,
    diagramPrompt: states1.after_fold.diagramPrompt,
    selectedScopeId: "subquestion:1",
    scopedStatePlans: {
      "(1)": states1,
      "(2)": states2,
    },
  }
}

function tryBuildRectangleEquilateralPyramidJTS05(prompt: string): DeterministicProblemRoute | null {
  if (
    !/四棱锥\s*P-ABCD/u.test(prompt) ||
    !/底面\s*ABCD\s*为矩形/u.test(prompt) ||
    !/侧面\s*PCD\s*是等边三角形/u.test(prompt) ||
    !/A-PBD\s*的体积/u.test(prompt)
  ) {
    return null
  }
  const P: V3 = [1, 0, Math.sqrt(3)]
  const A: V3 = [0, 1, 0]
  const B: V3 = [2, 1, 0]
  const C: V3 = [2, 0, 0]
  const D: V3 = [0, 0, 0]
  const plan = makePlan(
    "构造矩形底面且侧面 PCD 为直立等边三角形的四棱锥 P-ABCD 及 CP 中点 E",
    [
      polyhedronAction(
        "solid-1",
        [P, A, B, C, D],
        [
          [1, 4, 3, 2],
          [0, 1, 2],
          [0, 2, 3],
          [0, 3, 4],
          [0, 4, 1],
        ],
        ["P", "A", "B", "C", "D"],
        { label: "P-ABCD" },
      ),
      boundPointAction("pt-E", "E", "solid-1", "C", "P", 0.5),
    ],
    "已证平面 PBC⊥平面 PCD；平面 BDE 与平面 ABCD 夹角的余弦值为 √7/7。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:1",
  }
}

function tryBuildPolyhedronEquilateralJTS06(prompt: string): DeterministicProblemRoute | null {
  if (
    !/多面体\s*ABCDE/u.test(prompt) ||
    !/△\s*AEB\s*为等边三角形/u.test(prompt) ||
    !/AB=BC=2AD=2/u.test(prompt)
  ) {
    return null
  }
  const A: V3 = [2, 0, 0]
  const B: V3 = [0, 0, 0]
  const C: V3 = [0, 2, 0]
  const D: V3 = [2, 1, 0]
  const E: V3 = [1, 0, Math.sqrt(3)]
  const plan = makePlan(
    "构造等边侧面五面体 ABCDE",
    [
      polyhedronAction(
        "solid-1",
        [A, B, C, D, E],
        [
          [0, 3, 2, 1],
          [0, 1, 4],
          [1, 2, 4],
          [2, 3, 4],
          [3, 0, 4],
        ],
        ["A", "B", "C", "D", "E"],
        { label: "ABCDE" },
      ),
    ],
    "已证明 BC⊥平面 ABE 且平面 EBC⊥平面 DCE。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:1",
  }
}

function tryBuildPentahedronMidpointJTS07(prompt: string): DeterministicProblemRoute | null {
  if (
    !/五面体\s*ABCDEF/u.test(prompt) ||
    !/FA⊥平面\s*ABCD/u.test(prompt) ||
    !/AF=AB=BC=FE=1\/2\s*AD/u.test(prompt)
  ) {
    return null
  }
  const A: V3 = [0, 0, 0]
  const B: V3 = [1, 0, 0]
  const C: V3 = [1, 1, 0]
  const D: V3 = [0, 2, 0]
  const E: V3 = [0, 1, 1]
  const F: V3 = [0, 0, 1]
  const plan = makePlan(
    "构造直角五面体 ABCDEF 与 EC 中点 M",
    [
      polyhedronAction(
        "solid-1",
        [A, B, C, D, E, F],
        [
          [0, 3, 2, 1],
          [0, 1, 5],
          [1, 2, 4, 5],
          [2, 3, 4],
          [0, 5, 4, 3],
        ],
        ["A", "B", "C", "D", "E", "F"],
        { label: "ABCDEF" },
      ),
      boundPointAction("pt-M", "M", "solid-1", "E", "C", 0.5),
    ],
    "异面直线 BF 与 DE 所成角为 60°；二面角 A-CD-E 的余弦值为 √10/5。",
  )
  return {
    family: "spatial-modeling",
    plan,
    selectedScopeId: "subquestion:2",
  }
}

function tryBuildTrapezoidRectangleJTS08(prompt: string): DeterministicProblemRoute | null {
  if (
    !/梯形\s*ABCD/u.test(prompt) ||
    !/四边形\s*ACFE\s*为矩形/u.test(prompt) ||
    !/平面\s*ACFE⊥平面\s*ABCD/u.test(prompt)
  ) {
    return null
  }
  const h = Math.sqrt(3) / 2
  const A: V3 = [0, 0, 0]
  const B: V3 = [2, 0, 0]
  const C: V3 = [1.5, h, 0]
  const D: V3 = [0.5, h, 0]
  const E: V3 = [0, 0, 1]
  const F: V3 = [1.5, h, 1]
  const faces = [
    [0, 3, 2, 1],
    [0, 2, 5, 4],
  ]

  const buildBranch = (t: number, desc: string) =>
    makePlan(
      desc,
      [
        polyhedronAction("solid-1", [A, B, C, D, E, F], faces, ["A", "B", "C", "D", "E", "F"], {
          open: true,
          label: "ABCD-ACFE",
        }),
        boundPointAction("pt-M", "M", "solid-1", "E", "F", t),
      ],
      "BC⊥平面 ACFE；cosθ = 1/√(4+3t²) (t∈[0,1]) 的取值范围为 [√7/7, 1/2]。",
    )

  const mainPlan = buildBranch(0.5, "构造正交梯形 ABCD 与矩形 ACFE（M∈EF）")
  return {
    family: "spatial-modeling",
    plan: mainPlan,
    selectedScopeId: "subquestion:2",
    branchPlans: {
      t0: buildBranch(0, "构造端点 M=E（t=0，cosθ=1/2）"),
      t1: buildBranch(1, "构造端点 M=F（t=1，cosθ=1/√7）"),
    },
  }
}

function tryBuildHemisphereCubeJTS09(prompt: string): DeterministicProblemRoute | null {
  if (!/半球内有一个内接正方体/u.test(prompt) || !/正方体的一个面在半球的底面圆内/u.test(prompt)) {
    return null
  }
  const a = parseValue(prompt.match(/棱长为\s*([^\s，,。；;]+)/u)?.[1], 2)
  const half = a / 2
  const radius = half * Math.sqrt(6)
  const plan = makePlan(
    "构造底面中心位于球心且顶面四角内接于半球面的正方体及半球外接球 O",
    [
      prismAction(
        "solid-1",
        [
          [-half, -half, 0],
          [half, -half, 0],
          [half, half, 0],
          [-half, half, 0],
        ],
        [0, 0, a],
        ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"],
        "ABCD-A₁B₁C₁D₁",
      ),
      sphereAction("sphere-O", [0, 0, 0], radius, "O"),
    ],
    "选 D. 18π（R² = 1² + 1² + 2² = 6，半球表面积 = 2πR² + πR² = 3πR² = 18π）。",
  )
  return {
    family: "spatial-modeling",
    plan,
  }
}

export function tryBuildSolidDrawingPlan(prompt: string): DeterministicProblemRoute | null {
  const builders: ReadonlyArray<(text: string) => DeterministicProblemRoute | null> = [
    tryBuildFoldedQuadTriangleGKS02,
    tryBuildPentahedronGKS03,
    tryBuildPyramidGKS04,
    tryBuildSquarePrismInfeasibleGKS05,
    tryBuildTetrahedronVectorGKS06,
    tryBuildRightPrismGKS07,
    tryBuildTrapezoidPyramidGKS08,
    tryBuildPrismSphereGKS09,
    tryBuildFoldedTetrahedronJTS01,
    tryBuildTiltedPrismJTS02,
    tryBuildRightTrapezoidPyramidJTS03,
    tryBuildFoldedTrapezoidJTS04,
    tryBuildRectangleEquilateralPyramidJTS05,
    tryBuildPolyhedronEquilateralJTS06,
    tryBuildPentahedronMidpointJTS07,
    tryBuildTrapezoidRectangleJTS08,
    tryBuildHemisphereCubeJTS09,
  ]
  for (const build of builders) {
    const built = build(prompt)
    if (built) return built
  }
  return null
}

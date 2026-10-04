import type { Circle3Primitive, ConstraintSpec, ConstraintType, GeometryDocument, Plane3Primitive, PrimitiveSpec } from "@draw/dsl"
import { constraintResidual3 } from "@draw/geometry-kernel"

/**
 * **约束 IR 与自由度诊断**（设计 2026-10-04 §5 Phase N1："给每个对象计算自由度、残差和冲突集合"）。
 *
 * ## 这一版**不接任何外部 solver**（N1 的边界）
 *
 * 所以自由度不是"解出来"的，而是**算出来**的：把文档里每个显式自由参数当成一根坐标轴，
 * 用现有内核的残差函数对参数做一次数值微分，得到约束映射的雅可比 `J`，于是
 *
 * ```text
 * 剩余自由度 = 参数总数 − 规范自由度(整体平移/旋转) − rank(J)
 * ```
 *
 * 这个算法的取舍必须写清楚，否则"自由度 5"会被当成解算器的结论：
 * - **秩而不是条数**：重复的、冗余的约束不会各减一格。把它们算成两条正是"过约束"误报的来源
 *   （`constraintIR.test.ts` 有一条重复定长约束的用例盯着它）。
 * - **规范自由度按构型定**：0 个点 = 0；1 个点 = 3；≥2 个不同点 = 6（3 平移 + 3 旋转）。
 *   **不是**每点 3 —— 那样任何一条约束都会立刻把自由度算成负数。
 * - **只数显式参数化的图元**：点自身的绑定自由度（自由点 3、线上点 1、面上点 2 …）、
 *   圆的 `center/normal/radius`、平面的法向。派生点（`kind: "derived"`）的坐标由来源算出，
 *   **本版不把来源展开**，所以它的缓存坐标不参与秩 —— 这是 N1 已知边界，不是"它没有自由度"。
 * - **求解器状态本版恒为 `not_run`**（见 `claimEvidence.ts`）：没有 solver 就没有
 *   `model/un sat/timeout/diverged`，编一个出来会让 UI 显示一个从未发生过的失败。
 */

export interface FreeDegreesObject {
  id: string
  kind: string
  /** 这个对象自带的标量参数个数（自由点 = 3）。派生对象为 0，不进列表。 */
  dof: number
}

export interface ConstraintResidual {
  constraintId: string
  /** 约束种类（`ConstraintSpec.type`）。 */
  subject: string
  /** 残差；能算出来时恒为非负。 */
  residual: number
  /** 是否**超出容差**。与"不支持"是两件事：冲突是一个结论，不支持是没有判据。 */
  conflict: boolean
}

export interface UnsupportedConstraint {
  constraintId: string
  reason: string
}

export interface FreeDegreesReport {
  /** 全部显式标量参数个数（点的坐标、圆的参数……）。 */
  totalDof: number
  /** 整体平移/旋转的自由度（不改变形状的那些）。 */
  gaugeDof: number
  /** 约束独立压掉的自由度 = `rank(J)`。 */
  constraintDof: number
  /** 剩下的自由度；`0` = 形状刚性。 */
  residualDof: number
  /** 逐对象的参数个数（只列有参数的）。 */
  objects: FreeDegreesObject[]
  /** 逐条**有判据**的约束残差（与 `constraints` 里的顺序一致）。 */
  residuals: ConstraintResidual[]
  /** 残差超容差的约束 id。 */
  conflicts: string[]
  /** 内核没有空间判据、或点名对不上的约束（**不是**"已满足"）。 */
  unsupported: UnsupportedConstraint[]
  /** 有判据的约束条数。 */
  supported: number
}

const DEFAULT_TOLERANCE = 1e-6
/** 数值微分的步长：1e-6 与各处的残差容差同量级，一阶差分仍然稳定。 */
const DERIVATIVE_STEP = 1e-6

/** 内核**没有空间判据**的约束：`coincident` 是平面（2D）约束，`constraintResidual3` 对它恒返回 null。 */
const NO_SPATIAL_JUDGE: ReadonlySet<ConstraintType> = new Set<ConstraintType>(["coincident"])

interface ScalarParameter {
  primitiveId: string
  /** 该图元在 `document.primitives` 里的下标（避免每次都 `find`）。 */
  ownerIndex: number
  get: (primitive: PrimitiveSpec) => number
  set: (primitive: PrimitiveSpec, value: number) => void
}

function numberAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN
}

/** 一个空间点的**自身参数个数**：绑定决定它还有多少能动的量（自由点 3、线上点 1……）。 */
function pointDof(primitive: Extract<PrimitiveSpec, { type: "point3" }>): number {
  const binding = primitive.binding
  if (binding === undefined || binding.kind === "free") return 3
  if (binding.kind === "onLine" || binding.kind === "onHost") return 1
  if (binding.kind === "onPlane" || binding.kind === "onFace" || binding.kind === "onSurface") return 2
  if (binding.kind === "inSolid") return 3
  // derived：坐标由来源算出，本版不展开来源 → 不计参数。
  return 0
}

/**
 * 一个**平面点**（`type: "point"`）的参数个数。与 `pointDof` 同构，但 `PointBinding`
 * 只有三支：`free | onPath | derived`。
 *
 * ## 为什么必须有这个函数，而不是在 `parametersOf` 里判"有没有 binding"
 *
 * 那正是限定复核 round 2 抓到的缺陷机制：**存在性分叉**会把"显式写成 `{ kind: "free" }`"的
 * 自由点判成 1（它明明是 2），把 `derived` 判成 1（契约说它 0）。而这两种形状在生产上
 * **真的会出现**：`packages/scene-graph/src/deletion.ts` 在删除宿主/来源时会把 2D 点重写成
 * `{ kind: "free" }`，`apps/web/src/components/inspectorModel.ts` 在更新时也写同一形状。
 *
 * 所以判据必须落在**判别联合的种类**上，而不是"那个字段在不在"。
 */
function planarPointDof(primitive: Extract<PrimitiveSpec, { type: "point" }>): number {
  const binding = primitive.binding
  if (binding === undefined || binding.kind === "free") return 2
  if (binding.kind === "onPath") return 1
  // derived：坐标由来源算出，本版不展开来源 → 不计参数（与 `pointDof` 的 derived 同义）。
  return 0
}

/**
 * 可扰动的标量参数。**只列显式参数化的量，而且只列绑定真正留下的那些量**：
 * 自由点 3 个坐标轴、线上/宿主上的点 1 个、面上/曲面上的点 2 个（派生点 0 个）；
 * 圆的 `center/normal/radius`；平面点法式的 `normal.*`。
 *
 * ## 受约束点为什么只暴露绑定留下的轴（复核 Important 4 / 裁决 R9）
 *
 * 这一版**不把绑定建模成约束**（那需要一条"点必须在宿主上"的残差，属于 N2/N3 的工作），
 * 所以没有任何东西会替它扣掉被绑掉的自由度。若这里仍然返回三个位置轴，
 * `objects[].dof` 与 `totalDof` 就会把"线上点"报成 3 —— 与文件头和 `pointDof` 的承诺直接矛盾，
 * 而且 `pointDof` 的 1/2 分支成了死代码。
 *
 * 于是口径是：**绑定是模型的一部分**，可动方向就是它留下的那些轴（1 个轴用坐标的一个分量代表、
 * 2 个轴用两个分量代表）。坐标与参数不同步是"哪一根轴当代表"的近似，但**轴数**是绑定唯一确定的 ——
 * 而自由度诊断要的正是轴数。
 *
 * ## 另外两件刻意不做的事
 *
 * - **不给平面法向做单位化**、也**不手工扣掉**"法向长度不影响残差"：内核的残差函数自己会归一
 *   （`planeNormal` 先 `normalizeVector3`），所以缩放任一分量对残差没有一阶影响 ——
 *   那种"没有影响的参数"会被有限差分自动判成 0 列。手工扣掉等于把内核的实现细节抄第二遍。
 * - **不给 `onHost`/`onLine` 的 `parameter` 再加一根轴**：`parameter` 是那根轴的缓存
 *   （`Point3Binding.onHost` 的注释写明它由 `parameterId` 驱动时只是缓存），
 *   再加一根会把线上点报成 2 个自由度。驱动它的文档参数属于 N3 的动态约束范围。
 */
function parametersOf(primitive: PrimitiveSpec, ownerIndex: number): ScalarParameter[] {
  const at = (key: string): ScalarParameter => ({
    primitiveId: primitive.id,
    ownerIndex,
    get: (current) => numberAt((current as unknown as Record<string, unknown>)[key]),
    set: (current, value) => { (current as unknown as Record<string, number>)[key] = value }
  })
  const positionAt = (axis: "x" | "y" | "z"): ScalarParameter => ({
    primitiveId: primitive.id,
    ownerIndex,
    get: (current) => numberAt((current as Extract<PrimitiveSpec, { type: "point3" }>).position[axis]),
    set: (current, value) => { (current as Extract<PrimitiveSpec, { type: "point3" }>).position[axis] = value }
  })
  const vectorAt = (owner: "center" | "normal", axis: "x" | "y" | "z"): ScalarParameter => ({
    primitiveId: primitive.id,
    ownerIndex,
    get: (current) => {
      const holder = (current as Circle3Primitive | Plane3Primitive) as unknown as { center?: Record<string, number>; normal?: Record<string, number> }
      const vector = owner === "center" ? holder.center : holder.normal
      return vector === undefined ? Number.NaN : numberAt(vector[axis])
    },
    set: (current, value) => {
      const holder = (current as Circle3Primitive | Plane3Primitive) as unknown as { center?: Record<string, number>; normal?: Record<string, number> }
      const vector = owner === "center" ? holder.center : holder.normal
      if (vector !== undefined) vector[axis] = value
    }
  })

  // 暴露的轴数 = 绑定的自由度（自由点 3、线上点 1、面上点 2、派生点 0）——
  // 与 `dofOf` 共用同一个 `pointDof`，所以"逐对象报的数"与"雅可比扰动的轴"不可能分叉。
  if (primitive.type === "point3") return [positionAt("x"), positionAt("y"), positionAt("z")].slice(0, pointDof(primitive))
  // 2D 点同一条纪律：按**绑定的种类**取轴（自由 2、轨道上 1、派生 0），
  // **不按"有没有 binding"** —— 存在性分叉会把显式 `{kind:"free"}` 的自由点报成 1。
  if (primitive.type === "point") return [at("x"), at("y")].slice(0, planarPointDof(primitive))
  if (primitive.type === "circle3") {
    return [
      vectorAt("center", "x"), vectorAt("center", "y"), vectorAt("center", "z"),
      vectorAt("normal", "x"), vectorAt("normal", "y"), vectorAt("normal", "z"),
      at("radius")
    ]
  }
  // 平面点法式：法向是显式参数（三个分量里有两个独立方向，有限差分自己会判出来）。
  // 三点式平面的坐标在它引用的点里，这里不重复计。
  if (primitive.type === "plane3") {
    return primitive.definition.kind === "pointNormal"
      ? [vectorAt("normal", "x"), vectorAt("normal", "y"), vectorAt("normal", "z")]
      : []
  }
  return []
}

/** 逐对象的参数个数（与 `parametersOf` 同源：两处各算一次必然分叉）。 */
function dofOf(primitive: PrimitiveSpec, ownerIndex: number): number {
  return parametersOf(primitive, ownerIndex).length
}

/**
 * 规范自由度：整体平移与旋转**不改变形状**，所以它们不算"还没定的形状自由度"。
 *
 * 按构型定（不是"每点 3"）：0 个不同点 → 0；1 个 → 3（只剩平移，那个点自身的 3 个
 * 自由度已经被平移全部吃掉）；≥2 个 → 6（3 平移 + 3 旋转）。
 */
function gaugeDofOf(document: GeometryDocument): number {
  const distinct = new Set(document.primitives.flatMap((primitive) => primitive.type === "point3"
    ? [`${primitive.position.x},${primitive.position.y},${primitive.position.z}`]
    : []))
  if (distinct.size === 0) return 0
  return distinct.size === 1 ? 3 : 6
}

/**
 * 数值雅可比的一行：逐参数做**前向差分**，每次只扰动一个分量、随后立刻还原。
 *
 * 关键性质：**只改参数，不重建文档**。重建会让手工构造的引用（例如 `newPrism` 里
 * "闭包共享的数组"）与文档里的 id 脱钩，于是"算不出来"被误报成一条冲突。
 */
function jacobianRow(
  document: GeometryDocument,
  constraint: ConstraintSpec,
  parameters: readonly ScalarParameter[],
  baseline: number
): number[] {
  return parameters.map((parameter) => {
    const owner = document.primitives[parameter.ownerIndex]
    if (owner === undefined) return 0
    const original = parameter.get(owner)
    if (!Number.isFinite(original)) return 0
    try {
      parameter.set(owner, original + DERIVATIVE_STEP)
      const perturbed = constraintResidual3(constraint, document.primitives)
      return perturbed === null ? 0 : (perturbed - baseline) / DERIVATIVE_STEP
    } finally {
      // **还原放在 `finally`**：内核若对某种输入抛异常，"诊断把文档改了"会成为
      // 一个只在异常路径上出现的隐性破坏（调用方拿回的是被扰动过的坐标）。
      parameter.set(owner, original)
    }
  })
}

/**
 * 秩（Gram–Schmidt，带绝对阈值）。返回的就是**独立约束个数**。
 *
 * 用秩而不是条数：`J` 的行相关时（重复约束、由别的约束推出来的约束）多出来的那些行
 * 不减少自由度 —— 把它们算进去，"过约束"就会被误报成"自由度 −1"。
 *
 * 阈值是**绝对**的，而且只用在"单位方向还剩多少长度"上：内核的残差函数自己就是
 * 归一化过的（长度差/比例/夹角/法向点积），所以雅可比的分量本身就与坐标尺度无关。
 * 这里若再按参数尺度缩放，大坐标文档会把`近相关的行`判成独立，秩被高估。
 */
function rankOf(rows: readonly number[][]): number {
  const basis: number[][] = []
  for (const row of rows) {
    let remaining = [...row]
    for (const kept of basis) {
      const projection = kept.reduce((sum, value, index) => sum + value * remaining[index], 0)
      remaining = remaining.map((value, index) => value - projection * kept[index])
    }
    const norm = Math.hypot(...remaining)
    if (norm > 1e-8) basis.push(remaining.map((value) => value / norm))
  }
  return basis.length
}

/**
 * **自由度诊断**（N1 的出口）。
 *
 * @param document 候选/当前文档。**只读**：扰动都会还原（`jacobianRow` 里逐个还原）。
 * @param constraints 文档里的空间约束（`GeometryDocument.constraints`）。
 * @param tolerance 残差容差；缺省 `1e-6`（与内核 `diagnoseConstraint3` 的默认值一致）。
 */
export function reportFreeDegrees(document: GeometryDocument, constraints: readonly ConstraintSpec[], tolerance = DEFAULT_TOLERANCE): FreeDegreesReport {
  const perPrimitive = document.primitives.map((primitive, index) => parametersOf(primitive, index))
  const parameters = perPrimitive.flat()
  const objects: FreeDegreesObject[] = document.primitives
    .map((primitive, index) => ({ id: primitive.id, kind: primitive.type, dof: dofOf(primitive, index) }))
    .filter((entry) => entry.dof > 0)

  const known = new Set(document.primitives.map((primitive) => primitive.id))
  const residuals: ConstraintResidual[] = []
  const supported: ConstraintSpec[] = []
  const unsupported: UnsupportedConstraint[] = []
  for (const constraint of constraints) {
    if (NO_SPATIAL_JUDGE.has(constraint.type)) {
      unsupported.push({ constraintId: constraint.id, reason: `内核没有 ${constraint.type} 的空间判据（它是平面约束），没有核验过。` })
      continue
    }
    const missing = constraint.targets.filter((target) => !known.has(target))
    if (missing.length > 0) {
      unsupported.push({ constraintId: constraint.id, reason: `点名 ${missing.join("、")} 在这份文档里不存在，无法核验（不是“已满足”）。` })
      continue
    }
    const residual = constraintResidual3(constraint, document.primitives)
    if (residual === null) {
      unsupported.push({ constraintId: constraint.id, reason: "点名都取到了，但这组几何退化（例如两点重合或方向为零），残差算不出来。" })
      continue
    }
    supported.push(constraint)
    residuals.push({
      constraintId: constraint.id,
      subject: constraint.type,
      residual,
      // 阈值取"调用方给的容差"与"这条约束自己的容差"里更宽的那个（内核的判据同义）。
      conflict: residual > Math.max(tolerance, constraint.tolerance ?? 0)
    })
  }

  const rows = supported.map((constraint) => {
    const baseline = constraintResidual3(constraint, document.primitives)
    return baseline === null ? [] : jacobianRow(document, constraint, parameters, baseline)
  })
  const constraintDof = rankOf(rows)
  const totalDof = parameters.length
  const gaugeDof = gaugeDofOf(document)
  return {
    totalDof,
    gaugeDof,
    constraintDof,
    residualDof: Math.max(0, totalDof - gaugeDof - constraintDof),
    objects,
    residuals,
    conflicts: residuals.filter((entry) => entry.conflict).map((entry) => entry.constraintId),
    unsupported,
    supported: supported.length
  }
}

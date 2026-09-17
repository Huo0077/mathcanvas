/**
 * 解析二次曲面层：把圆柱 / 圆锥 / 平面写成对称 4×4 二次型，并做**精确**的平面求交。
 *
 * 用户口径："我不要一个逼近的圆，我需要一个真的圆，这个曲面的相交太难受了。"
 *
 * 于是这里不碰多边形近似：`segments` 字段对本模块的任何结果都没有影响（它降级为渲染 LOD 提示）。
 * 平面与二次曲面的交线是圆锥曲线，做法与 GeoGebra 的 `AlgoIntersectPlaneQuadric` 一致——
 * 一次矩阵乘法 `C = PᵀQP`，再按不变量表分类（见
 * `docs/superpowers/specs/2026-09-17-analytic-quadrics-design.md` §5.2）。
 *
 * 本模块是纯函数、零依赖（不引 three.js）：模型层不许读渲染几何。
 */
import type { ConePrimitive, Conic3, Conic3Coefficients, Conic3Frame, Conic3Kind, Conic3Line, CylinderPrimitive, PrimitiveSpec } from "@draw/dsl"

import { addVector3, crossVector3, dotVector3, normalizeVector3, scaleVector3, subtractVector3, type Plane3, type Vector3 } from "./geometry3d"

/** 圆锥曲线的文档类型定义在 DSL 里（内核依赖 DSL，反向依赖会破坏分层）；这里再导出，内核 API 保持不变。 */
export type { Conic3, Conic3Coefficients, Conic3Frame, Conic3Kind, Conic3Line }

export interface Quadric3Bounds {
  /** 轴向单位向量（局部 +z 经旋转后的世界方向）。 */
  axis: Vector3
  /** 底面中心（世界坐标）。 */
  origin: Vector3
  height: number
  radius: number
}

/**
 * 二次曲面 `xᵀQx = 0`（`x = (x, y, z, 1)`，`Q` 为行主序 16 个元素的对称矩阵）。
 *
 * `bounds` 只对**有限实体**（圆柱 / 圆锥）存在：裁剪到端面要用它；平面没有边界，因此不带。
 */
export interface Quadric3 {
  kind: "cylinder" | "cone" | "plane"
  matrix: number[]
  bounds?: Quadric3Bounds
}

/**
 * 圆的判定阈值：半轴相对差 `(a − b) ≤ CIRCLE_RELATIVE_TOLERANCE · a`，即"两个半轴在 12 位有效数字内相等"。
 *
 * 为什么不是比 `|A − C|`：斜切圆柱时 `|A − C| = sin²θ`，阈值 `1e-9` 作用在它上面的判别力只有
 * `√ε ≈ 0.0018°`——连"倾斜 1e-3° 必须报椭圆"都判不出来（`sin²θ = 3.05e-10 < 1e-9`）。
 * 换成半轴相对差后判别力约 `8e-5°`，两边都有用例钉住（`quadrics.test.ts`）。
 */
export const CIRCLE_RELATIVE_TOLERANCE = 1e-12

/** 零判定的相对阈值：先系统归一化（除以系数最大绝对值），再与它比较。 */
const ZERO_RELATIVE_TOLERANCE = 1e-12

/** 与 `threePrimitives.ts` 的 `planeBasisFrom` 同一套约定：`helper` 的选取与 `u`/`v` 的构造都一致。 */
export function planeFrame3(plane: Plane3): Conic3Frame {
  const lengthSq = dotVector3(plane.normal, plane.normal)
  const normal = lengthSq > 1e-12 ? scaleVector3(plane.normal, 1 / Math.sqrt(lengthSq)) : { x: 0, y: 0, z: 1 }
  const origin = lengthSq > 1e-12 ? scaleVector3(normal, -plane.constant / Math.sqrt(lengthSq)) : { x: 0, y: 0, z: 0 }
  const helper = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const u = normalizeVector3(crossVector3(helper, normal))
  const v = crossVector3(normal, u)
  return { origin, u, v, normal }
}

function multiply4(first: number[], second: number[]): number[] {
  const result = new Array<number>(16).fill(0)
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0
      for (let index = 0; index < 4; index += 1) sum += first[row * 4 + index] * second[index * 4 + column]
      result[row * 4 + column] = sum
    }
  }
  return result
}

function transpose4(matrix: number[]): number[] {
  const result = new Array<number>(16).fill(0)
  for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) result[row * 4 + column] = matrix[column * 4 + row]
  return result
}

/** 绕 pivot 的 X→Y→Z 欧拉旋转矩阵（与 `solid-builders.ts` 的 `rotateAboutPivot` 逐行同源）。 */
function rotationMatrix(rotation: Vector3): number[] {
  const [cx, sx] = [Math.cos(rotation.x), Math.sin(rotation.x)]
  const [cy, sy] = [Math.cos(rotation.y), Math.sin(rotation.y)]
  const [cz, sz] = [Math.cos(rotation.z), Math.sin(rotation.z)]
  return [
    cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz,
    cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz,
    -sy, sx * cy, cx * cy
  ]
}

function applyMatrix(matrix: number[], vector: Vector3): Vector3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z
  }
}

/** 圆柱（局部：底面在 z=0、轴为 +z、半径 R、高 h）：`x² + y² = R²`。 */
function cylinderLocalMatrix(radius: number): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, -radius * radius
  ]
}

/** 圆锥（局部：底面在 z=0、顶点在 (0,0,h)、半径 R）：`x² + y² = R²(1 − z/h)²`，即 `x² + y² − k²(h−z)² = 0`。 */
function coneLocalMatrix(radius: number, height: number): number[] {
  const k = radius / height
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -k * k, k * k * height,
    0, 0, k * k * height, -k * k * height * height
  ]
}

/**
 * 把局部二次型搬到世界坐标：`Q_world = Tᵀ Q_local T`，
 * `T` 是世界 → 局部的刚体变换 `x_local = Mᵀ(x_world − pivotWorld) + pivotLocal`（绕轴中点旋转，与物化层同 pivot）。
 */
function buildSolidQuadric(kind: "cylinder" | "cone", matrix: number[], center: Vector3, radius: number, height: number, rotation: Vector3 | undefined): Quadric3 {
  const pivotLocal = { x: 0, y: 0, z: height / 2 }
  if (!rotation || (rotation.x === 0 && rotation.y === 0 && rotation.z === 0)) {
    return { kind, matrix, bounds: { axis: { x: 0, y: 0, z: 1 }, origin: { ...center }, height, radius } }
  }
  const linear = rotationMatrix(rotation)
  const linearTransposed = [
    linear[0], linear[3], linear[6],
    linear[1], linear[4], linear[7],
    linear[2], linear[5], linear[8]
  ]
  const pivotWorld = addVector3(center, pivotLocal)
  const offset = subtractVector3(pivotLocal, applyMatrix(linearTransposed, pivotWorld))
  const transform = [
    linearTransposed[0], linearTransposed[1], linearTransposed[2], offset.x,
    linearTransposed[3], linearTransposed[4], linearTransposed[5], offset.y,
    linearTransposed[6], linearTransposed[7], linearTransposed[8], offset.z,
    0, 0, 0, 1
  ]
  const worldMatrix = multiply4(transpose4(transform), multiply4(matrix, transform))
  const axis = applyMatrix(linear, { x: 0, y: 0, z: 1 })
  const origin = subtractVector3(pivotWorld, applyMatrix(linear, pivotLocal))
  return { kind, matrix: worldMatrix, bounds: { axis, origin, height, radius } }
}

export function cylinderQuadric3(primitive: CylinderPrimitive): Quadric3 {
  return buildSolidQuadric("cylinder", cylinderLocalMatrix(primitive.radius), primitive.center, primitive.radius, primitive.height, primitive.rotation)
}

export function coneQuadric3(primitive: ConePrimitive): Quadric3 {
  return buildSolidQuadric("cone", coneLocalMatrix(primitive.radius, primitive.height), primitive.center, primitive.radius, primitive.height, primitive.rotation)
}

/** 平面 `n·x + c = 0`：写成 `xᵀQx = 2(n·x + c)`（整体缩放不改变零点集）。 */
export function planeQuadric3(plane: Plane3): Quadric3 {
  const { normal, constant } = plane
  return {
    kind: "plane",
    matrix: [
      0, 0, 0, normal.x,
      0, 0, 0, normal.y,
      0, 0, 0, normal.z,
      normal.x, normal.y, normal.z, 2 * constant
    ]
  }
}

/** 只有圆柱 / 圆锥有解析二次型；平面由调用方直接给 `Plane3`（DSL 的 `plane3` 图元要解析点表，属上层职责）。 */
export function quadric3FromPrimitive(primitive: PrimitiveSpec): Quadric3 | null {
  if (primitive.type === "cylinder") return cylinderQuadric3(primitive)
  if (primitive.type === "cone") return coneQuadric3(primitive)
  return null
}

/** `xᵀQx`：性质测试用它验证"解析曲线上的点确实在曲面上"。 */
export function quadricValueAt(quadric: Quadric3, point: Vector3): number {
  const q = quadric.matrix
  return (
    q[0] * point.x * point.x + q[5] * point.y * point.y + q[10] * point.z * point.z +
    (q[1] + q[4]) * point.x * point.y + (q[2] + q[8]) * point.x * point.z + (q[6] + q[9]) * point.y * point.z +
    // 线性项在对称矩阵里存了两份（`Q_03` 与 `Q_30`）：只取一份会让圆锥这类带线性项的曲面残差减半。
    (q[3] + q[12]) * point.x + (q[7] + q[13]) * point.y + (q[11] + q[14]) * point.z + q[15]
  )
}

/** 模型尺度：性质测试与容差用它，避免绝对阈值。 */
export function quadricScaleOf(quadric: Quadric3): number {
  const bounds = quadric.bounds
  if (bounds) return Math.max(Math.abs(bounds.radius), Math.abs(bounds.height), 1)
  return Math.max(...quadric.matrix.map((value) => Math.abs(value)), 1)
}

/** `PᵀQP`：`P` 的列是平面的 `origin / u / v`，得到平面内的 3×3 圆锥曲线矩阵。 */
function conicMatrix(frame: Conic3Frame, quadricMatrix: number[]): Conic3Coefficients {
  const columns = [
    [frame.origin.x, frame.origin.y, frame.origin.z, 1],
    [frame.u.x, frame.u.y, frame.u.z, 0],
    [frame.v.x, frame.v.y, frame.v.z, 0]
  ]
  const value = (row: number, column: number) => {
    let sum = 0
    for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) sum += columns[row][i] * quadricMatrix[i * 4 + j] * columns[column][j]
    return sum
  }
  /**
   * 列序是 `[origin, u, v]`，所以平面点的齐次坐标是 `y = (1, s, t)`：
   * `y₀ = 1` 对应**常数项**，`y₁ = s`、`y₂ = t`。次序弄反会让所有圆都变成双曲线（实测踩过）。
   */
  return [value(1, 1), 2 * value(1, 2), value(2, 2), 2 * value(0, 1), 2 * value(0, 2), value(0, 0)]
}

function framePoint(frame: Conic3Frame, s: number, t: number): Vector3 {
  return addVector3(frame.origin, addVector3(scaleVector3(frame.u, s), scaleVector3(frame.v, t)))
}

function frameDirection(frame: Conic3Frame, s: number, t: number): Vector3 {
  return addVector3(scaleVector3(frame.u, s), scaleVector3(frame.v, t))
}

interface EigenPair { first: { value: number; vector: { s: number; t: number } }; second: { value: number; vector: { s: number; t: number } } }

/** 2×2 对称阵 `[[A, B/2], [B/2, C]]` 的闭式特征分解（`first.value ≥ second.value`）。 */
function eigenDecompose(A: number, B: number, C: number): EigenPair {
  const half = B / 2
  const root = Math.hypot(A - C, B)
  const larger = (A + C + root) / 2
  const smaller = (A + C - root) / 2
  let firstVector = { s: 1, t: 0 }
  if (Math.abs(half) > 1e-15) {
    const length = Math.hypot(half, larger - A)
    firstVector = { s: half / length, t: (larger - A) / length }
  } else if (A < C) {
    firstVector = { s: 0, t: 1 }
  }
  return { first: { value: larger, vector: firstVector }, second: { value: smaller, vector: { s: -firstVector.t, t: firstVector.s } } }
}

function makeConic(frame: Conic3Frame, kind: Conic3Kind, coefficients: Conic3Coefficients, extras: Partial<Conic3> = {}): Conic3 {
  return { kind, frame, coefficients, closed: false, ...extras }
}

/** 退化有心二次曲线的中心（`4AC − B² ≠ 0`）。 */
function centreOf(A: number, B: number, C: number, D: number, E: number): { s: number; t: number } {
  const denominator = 4 * A * C - B * B
  return { s: (-2 * C * D + B * E) / denominator, t: (B * D - 2 * A * E) / denominator }
}

/**
 * 分类 + 规范化。先**系统归一化**（除以系数最大绝对值）再比 `1e-12`：
 * 行列式的元素量级一大在浮点里就失去意义，所以尺度必须先进来。
 */
function classifyConic3(coefficients: Conic3Coefficients, frame: Conic3Frame): Conic3 {
  const scale = Math.max(...coefficients.map((value) => Math.abs(value)))
  if (!Number.isFinite(scale) || scale <= 0) return makeConic(frame, "insufficient-data", coefficients)
  const [A, B, C, D, E, F] = coefficients.map((value) => value / scale) as Conic3Coefficients
  const quadraticDiscriminant = B * B - 4 * A * C
  const determinant = A * (C * F - (E * E) / 4) - (B / 2) * ((B / 2) * F - (E * D) / 4) + (D / 2) * ((B * E) / 4 - (C * D) / 2)
  const delta = Math.abs(quadraticDiscriminant) <= ZERO_RELATIVE_TOLERANCE ? 0 : quadraticDiscriminant
  const delta3 = Math.abs(determinant) <= ZERO_RELATIVE_TOLERANCE ? 0 : determinant

  if (delta3 !== 0) {
    if (delta < 0) {
      const centre = centreOf(A, B, C, D, E)
      const constant = A * centre.s * centre.s + B * centre.s * centre.t + C * centre.t * centre.t + D * centre.s + E * centre.t + F
      const eigen = eigenDecompose(A, B, C)
      const firstSquared = -constant / eigen.first.value
      const secondSquared = -constant / eigen.second.value
      if (!(firstSquared > 0) || !(secondSquared > 0)) return makeConic(frame, "empty", coefficients, { center: framePoint(frame, centre.s, centre.t) })
      const semiMajor = Math.sqrt(Math.max(firstSquared, secondSquared))
      const semiMinor = Math.sqrt(Math.min(firstSquared, secondSquared))
      const majorEigen = firstSquared >= secondSquared ? eigen.first : eigen.second
      const minorEigen = firstSquared >= secondSquared ? eigen.second : eigen.first
      const centerWorld = framePoint(frame, centre.s, centre.t)
      const major = frameDirection(frame, majorEigen.vector.s, majorEigen.vector.t)
      const minor = frameDirection(frame, minorEigen.vector.s, minorEigen.vector.t)
      if (semiMajor - semiMinor <= CIRCLE_RELATIVE_TOLERANCE * semiMajor) {
        return makeConic(frame, "circle", coefficients, { center: centerWorld, semiMajor, semiMinor, eccentricity: 0, axes: { major, minor }, closed: true })
      }
      const focalDistance = Math.sqrt(Math.max(0, semiMajor * semiMajor - semiMinor * semiMinor))
      return makeConic(frame, "ellipse", coefficients, {
        center: centerWorld,
        semiMajor,
        semiMinor,
        eccentricity: Math.sqrt(Math.max(0, 1 - (semiMinor / semiMajor) ** 2)),
        axes: { major, minor },
        foci: [addVector3(centerWorld, scaleVector3(major, focalDistance)), addVector3(centerWorld, scaleVector3(major, -focalDistance))],
        closed: true
      })
    }
    if (delta > 0) {
      const centre = centreOf(A, B, C, D, E)
      const constant = A * centre.s * centre.s + B * centre.s * centre.t + C * centre.t * centre.t + D * centre.s + E * centre.t + F
      const eigen = eigenDecompose(A, B, C)
      const firstSquared = -constant / eigen.first.value
      const secondSquared = -constant / eigen.second.value
      const transverseEigen = firstSquared > 0 ? eigen.first : eigen.second
      const conjugateEigen = firstSquared > 0 ? eigen.second : eigen.first
      const transverse = Math.sqrt(Math.max(firstSquared, secondSquared))
      const conjugate = Math.sqrt(Math.max(-Math.min(firstSquared, secondSquared), 0))
      if (!(transverse > 0)) return makeConic(frame, "insufficient-data", coefficients)
      const centerWorld = framePoint(frame, centre.s, centre.t)
      const major = frameDirection(frame, transverseEigen.vector.s, transverseEigen.vector.t)
      const minor = frameDirection(frame, conjugateEigen.vector.s, conjugateEigen.vector.t)
      const focalDistance = Math.sqrt(transverse * transverse + conjugate * conjugate)
      return makeConic(frame, "hyperbola", coefficients, {
        center: centerWorld,
        semiMajor: transverse,
        semiMinor: conjugate,
        eccentricity: Math.sqrt(1 + (conjugate / transverse) ** 2),
        axes: { major, minor },
        foci: [addVector3(centerWorld, scaleVector3(major, focalDistance)), addVector3(centerWorld, scaleVector3(major, -focalDistance))]
      })
    }
    // 抛物线：无中心，旋转到主轴后是 `λ η² + L ξ + M η + F = 0`（`ξ` 沿"平"的方向、`L ≠ 0`）。
    const eigen = eigenDecompose(A, B, C)
    const alongFirst = D * eigen.first.vector.s + E * eigen.first.vector.t
    const alongSecond = D * eigen.second.vector.s + E * eigen.second.vector.t
    const flatIsFirst = Math.abs(eigen.first.value) <= Math.abs(eigen.second.value)
    const flatLinear = flatIsFirst ? alongFirst : alongSecond
    const curveEigen = flatIsFirst ? eigen.second : eigen.first
    const curveLinear = flatIsFirst ? alongSecond : alongFirst
    if (Math.abs(flatLinear) <= ZERO_RELATIVE_TOLERANCE || curveEigen.value === 0) return makeConic(frame, "insufficient-data", coefficients)
    const axisCoordinate = -curveLinear / (2 * curveEigen.value)
    const flatCoordinate = -(curveEigen.value * axisCoordinate * axisCoordinate + curveLinear * axisCoordinate + F) / flatLinear
    const focalParameter = Math.abs(flatLinear / (4 * curveEigen.value))
    const opensAlongFlat = -flatLinear / curveEigen.value > 0
    const vertex = flatIsFirst ? framePoint(frame, flatCoordinate, axisCoordinate) : framePoint(frame, axisCoordinate, flatCoordinate)
    const major = flatIsFirst
      ? frameDirection(frame, opensAlongFlat ? 1 : -1, 0)
      : frameDirection(frame, 0, opensAlongFlat ? 1 : -1)
    const minor = flatIsFirst ? frameDirection(frame, 0, 1) : frameDirection(frame, 1, 0)
    return makeConic(frame, "parabola", coefficients, {
      vertex,
      focalParameter,
      eccentricity: 1,
      axes: { major, minor },
      foci: [addVector3(vertex, scaleVector3(major, focalParameter))]
    })
  }

  if (delta < 0) {
    const centre = centreOf(A, B, C, D, E)
    const constant = A * centre.s * centre.s + B * centre.s * centre.t + C * centre.t * centre.t + D * centre.s + E * centre.t + F
    if (Math.abs(constant) <= ZERO_RELATIVE_TOLERANCE) return makeConic(frame, "point", coefficients, { point: framePoint(frame, centre.s, centre.t) })
    return makeConic(frame, "empty", coefficients)
  }

  if (delta > 0) {
    // 两条相交直线：都过中心，方向是二次型的零方向 `v₁/√λ₁ ± v₂/√(−λ₂)`。
    const centre = centreOf(A, B, C, D, E)
    const eigen = eigenDecompose(A, B, C)
    if (!(eigen.first.value > 0) || !(eigen.second.value < 0)) return makeConic(frame, "insufficient-data", coefficients)
    const firstScale = 1 / Math.sqrt(eigen.first.value)
    const secondScale = 1 / Math.sqrt(-eigen.second.value)
    const normalize2d = (vector: { s: number; t: number }) => {
      const length = Math.hypot(vector.s, vector.t)
      return { s: vector.s / length, t: vector.t / length }
    }
    const firstDirection = normalize2d({
      s: eigen.first.vector.s * firstScale + eigen.second.vector.s * secondScale,
      t: eigen.first.vector.t * firstScale + eigen.second.vector.t * secondScale
    })
    const secondDirection = normalize2d({
      s: eigen.first.vector.s * firstScale - eigen.second.vector.s * secondScale,
      t: eigen.first.vector.t * firstScale - eigen.second.vector.t * secondScale
    })
    return makeConic(frame, "lines", coefficients, {
      lines: [
        { through: { s: centre.s, t: centre.t }, direction: firstDirection },
        { through: { s: centre.s, t: centre.t }, direction: secondDirection }
      ]
    })
  }

  // δ = 0 且 Δ = 0：平行线 / 一条直线（重根）/ 空集。二次部是完全平方 `(p s + q t)²`。
  const quadratic = A > ZERO_RELATIVE_TOLERANCE ? { p: Math.sqrt(A), q: B / (2 * Math.sqrt(A)) } : { p: 0, q: Math.sqrt(C) }
  const norm = quadratic.p * quadratic.p + quadratic.q * quadratic.q
  if (!(norm > 0)) return makeConic(frame, "insufficient-data", coefficients)
  const lambda = (D * quadratic.p + E * quadratic.q) / norm
  if (Math.hypot(D - lambda * quadratic.p, E - lambda * quadratic.q) > 1e-6) return makeConic(frame, "insufficient-data", coefficients)
  const inside = (lambda * lambda) / 4 - F
  const directionLength = Math.hypot(quadratic.q, quadratic.p)
  const direction = { s: -quadratic.q / directionLength, t: quadratic.p / directionLength }
  const lineThrough = (value: number) => ({ s: (quadratic.p * value) / norm, t: (quadratic.q * value) / norm })
  if (inside > ZERO_RELATIVE_TOLERANCE) {
    const root = Math.sqrt(inside)
    return makeConic(frame, "lines", coefficients, {
      lines: [
        { through: lineThrough(-lambda / 2 + root), direction },
        { through: lineThrough(-lambda / 2 - root), direction }
      ]
    })
  }
  if (Math.abs(inside) <= ZERO_RELATIVE_TOLERANCE) return makeConic(frame, "line", coefficients, { lines: [{ through: lineThrough(-lambda / 2), direction }] })
  return makeConic(frame, "empty", coefficients)
}

/** 平面 ∩ 二次曲面：`C = PᵀQP`，再分类。 */
export function intersectPlaneQuadric3(plane: Plane3, quadric: Quadric3): Conic3 {
  const frame = planeFrame3(plane)
  return classifyConic3(conicMatrix(frame, quadric.matrix), frame)
}

/** 解析曲线上的点。`branch` 只在 `line` / `lines` 时有意义（选第几条直线）。 */
export function conic3PointAt(conic: Conic3, parameter: number, branch = 0): Vector3 | null {
  const axes = conic.axes
  if (conic.kind === "circle" || conic.kind === "ellipse") {
    if (!conic.center || !axes || conic.semiMajor === undefined || conic.semiMinor === undefined) return null
    return addVector3(conic.center, addVector3(scaleVector3(axes.major, conic.semiMajor * Math.cos(parameter)), scaleVector3(axes.minor, conic.semiMinor * Math.sin(parameter))))
  }
  if (conic.kind === "hyperbola") {
    if (!conic.center || !axes || conic.semiMajor === undefined || conic.semiMinor === undefined) return null
    const sign = branch === 0 ? 1 : -1
    return addVector3(conic.center, addVector3(scaleVector3(axes.major, sign * conic.semiMajor * Math.cosh(parameter)), scaleVector3(axes.minor, conic.semiMinor * Math.sinh(parameter))))
  }
  if (conic.kind === "parabola") {
    if (!conic.vertex || !axes || !conic.focalParameter) return null
    return addVector3(conic.vertex, addVector3(scaleVector3(axes.major, (parameter * parameter) / (4 * conic.focalParameter)), scaleVector3(axes.minor, parameter)))
  }
  if (conic.kind === "line" || conic.kind === "lines") {
    const lines = conic.lines
    if (!lines || lines.length === 0) return null
    const line = lines[Math.min(Math.max(branch, 0), lines.length - 1)]
    return framePoint(conic.frame, line.through.s + parameter * line.direction.s, line.through.t + parameter * line.direction.t)
  }
  if (conic.kind === "point") return conic.point ? { ...conic.point } : null
  return null
}

/** 圆锥曲线所在的平面（渲染与拾取要用）。 */
export function conic3Plane(conic: Conic3): Plane3 {
  return { normal: { ...conic.frame.normal }, constant: -dotVector3(conic.frame.normal, conic.frame.origin) }
}

/** 平面标架：与 `planeFrame3` 同一套约定，但原点由调用方给定（圆心 / 已知点）。 */
function frameThroughPoint(normal: Vector3, origin: Vector3): Conic3Frame {
  const unit = normalizeVector3(normal)
  const safeNormal = lengthOf(unit) > 0.5 ? unit : { x: 0, y: 0, z: 1 }
  const helper = Math.abs(safeNormal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const u = normalizeVector3(crossVector3(helper, safeNormal))
  return { origin: { ...origin }, u, v: crossVector3(safeNormal, u), normal: safeNormal }
}

function lengthOf(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

/**
 * 直接构造一个**精确圆**（不走 `PᵀQP`）：圆柱 / 圆锥的边界圆与 DSL 的 `circle3` 都用它。
 *
 * 半径非有限或 ≤ 0 时返回 `null`——不编一个"看着像"的圆。
 */
export function circleConic3(center: Vector3, normal: Vector3, radius: number): Conic3 | null {
  if (!Number.isFinite(radius) || radius <= 0) return null
  if (![center.x, center.y, center.z, normal.x, normal.y, normal.z].every((value) => Number.isFinite(value))) return null
  const frame = frameThroughPoint(normal, center)
  return {
    kind: "circle",
    frame,
    // 帧内 `s² + t² = R²`。
    coefficients: [1, 0, 1, 0, 0, -radius * radius],
    center: { ...center },
    semiMajor: radius,
    semiMinor: radius,
    eccentricity: 0,
    axes: { major: frame.u, minor: frame.v },
    closed: true
  }
}

/**
 * 圆类实体的**边界圆**：圆柱两个（上下底），圆锥一个（底）。
 *
 * 画布用它们画真圆，替代 48 段折线——多边形环棱仍留在文档里（手柄 / 面片 / 拾取要它）。
 */
export function rimCircles3(primitive: PrimitiveSpec): Conic3[] {
  const quadric = quadric3FromPrimitive(primitive)
  const bounds = quadric?.bounds
  if (!bounds) return []
  const circles: Conic3[] = []
  const base = circleConic3(bounds.origin, bounds.axis, bounds.radius)
  if (base) circles.push(base)
  if (quadric.kind === "cylinder") {
    const topCenter = addVector3(bounds.origin, scaleVector3(bounds.axis, bounds.height))
    const top = circleConic3(topCenter, bounds.axis, bounds.radius)
    if (top) circles.push(top)
  }
  return circles
}

/** DSL 的空间圆图元 → 解析圆（圆心由点表解析）。 */
export function conic3FromCircle3(primitive: Extract<PrimitiveSpec, { type: "circle3" }>, points: Map<string, { position: Vector3 }>): Conic3 | null {
  const center = points.get(primitive.centerId)?.position
  if (!center) return null
  return circleConic3(center, primitive.normal, primitive.radius)
}

/** 一个读数：数值 + **它是不是精确的**。两者必须一起给，否则调用方只能猜。 */
export interface Conic3Measure {
  value: number
  /** `true` 表示闭式解（圆周长 `2πr`、圆/椭圆面积 `πab`）；`false` 表示数值近似（椭圆周长）。 */
  exact: boolean
}

/**
 * 圆 / 椭圆的面积：`πab`（**精确**）。抛物线与双曲线不封闭、退化的没有面积，一律返回 `null`。
 */
export function conic3Area(conic: Conic3): Conic3Measure | null {
  if (conic.kind !== "circle" && conic.kind !== "ellipse") return null
  const semiMajor = conic.semiMajor
  const semiMinor = conic.semiMinor
  if (semiMajor === undefined || semiMinor === undefined || !(semiMajor > 0) || !(semiMinor > 0)) return null
  return { value: Math.PI * semiMajor * semiMinor, exact: true }
}

/**
 * 圆 / 椭圆的周长。
 *
 * 圆是**精确**的 `2πr`；椭圆没有初等闭式，用第二类完全椭圆积分的级数
 * `p = 2πa[1 − Σ ((2n−1)!!/(2n)!!)² e^{2n}/(2n−1)]` 算，并如实标 `exact: false`——
 * 绝不把级数结果说成精确值。级数在近圆时收敛很快；`e → 1`（压扁的椭圆）收敛慢，所以给项数上限。
 */
export function conic3Perimeter(conic: Conic3): Conic3Measure | null {
  if (conic.kind !== "circle" && conic.kind !== "ellipse") return null
  const semiMajor = conic.semiMajor
  const semiMinor = conic.semiMinor
  if (semiMajor === undefined || semiMinor === undefined || !(semiMajor > 0) || !(semiMinor > 0)) return null
  if (conic.kind === "circle" || Math.abs(semiMajor - semiMinor) <= CIRCLE_RELATIVE_TOLERANCE * semiMajor) {
    return { value: 2 * Math.PI * semiMajor, exact: true }
  }
  const eccentricitySquared = Math.max(0, 1 - (semiMinor / semiMajor) ** 2)
  let term = 1        // ((2n−1)!!/(2n)!!)² · e^{2n} 的比值累积
  let power = 1       // e^{2n}
  let sum = 0
  for (let n = 1; n <= 64; n += 1) {
    const ratio = (2 * n - 1) / (2 * n)
    term *= ratio * ratio
    power *= eccentricitySquared
    const contribution = (term * power) / (2 * n - 1)
    sum += contribution
    if (contribution <= 1e-17) break
  }
  return { value: 2 * Math.PI * semiMajor * (1 - sum), exact: false }
}

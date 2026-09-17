# 解析二次曲面与"真圆"（A1）设计

> **状态**：设计已与用户确认（2026-09-17）。用户口径："我不要一个逼近的圆，我需要一个真的圆，这个曲面的相交太难受了。"
> **本次范围**：A1 —— 平面 ∩ 二次曲面解析化 + 真曲线渲染 + 全链路适配（第一组，见 §3）。
> **不在本次范围**：A2（二次曲面互交）、A3 的逐像素光线求交。见 §4。
> **与既有文档的关系**：本文档只描述解析层这一次改动；`docs/project-progress.md` 仍是唯一进度记录，`docs/feature-catalog.md` 在实现后同步。

---

## 1. 背景与用户口径

立体几何里的圆柱 / 圆锥目前是**多边形近似**：48 段棱柱 / 棱锥，物化出 96 个顶点、144 条棱、50 个面，并全部进文档（`solid-builders.ts`、`solidDefaults.ts` 的 `ROUND_SOLID_SEGMENTS = 48`）。用户要三件事：

1. **真圆**：圆不是 48 边形，放大到任何级别都不该看出棱。
2. **曲面相交不难受**：平面切曲面、曲面与曲面相交要给出**数学对象**，不是折线。
3. **其他内容一起适配**：不许出现"检查器说是椭圆、导出/投影/测量还是折线"的割裂。

用户已选定目标 **A（数学上真圆）**：圆 / 椭圆 / 交线是解析对象，求交、截面、测量按解析公式算。明确**不**引入 CAD 内核（见 §10 的取舍证据）。

---

## 2. 现状与根因（证据）

| 层 | 现状 | 证据 |
| --- | --- | --- |
| 文档对象 | 圆柱 / 圆锥 = 48 边形棱柱 / 棱锥，96 顶点 + 144 棱 + 50 面全部物化进文档 | `packages/geometry-kernel/src/solid-builders.ts`、`apps/web/src/solidDefaults.ts:12` |
| 求交 | 面环 × 面环求线段，交线必为折线（圆柱↔圆柱实测 96 段） | `packages/geometry-kernel/src/intersections3d.ts` |
| 布尔交面 | 凸多面体半空间裁剪，纯多边形 | `packages/geometry-kernel/src/boolean3d.ts` |
| 截面 | 平面 × 多边形边，截面是 48+N 边形 | `packages/geometry-kernel/src/sections3d.ts` |
| 重算入口 | `recomputeSection` 直接调 `sectionPolyhedron3(topology.vertices, topology.faces, plane)` | `packages/scene-graph/src/operations.ts:563-567` |
| 测量 | 面积 = 面顶点三角剖分，体积 = 闭合多面体 | `packages/geometry-kernel/src/measurements3d.ts:112-119` |
| 展开 | 通用多面体展开，圆柱侧面展成 48 个矩形 | `packages/geometry-kernel/src/unfold3d.ts:160` |
| 投影 | 投影 48 边形的点环 | `apps/web/src/projectionVisuals.ts:218-232` |
| 导出 | 2D 圆/弧已是真曲线，**椭圆是 160 段折线**，3D 图元全部返回空串 | `apps/web/src/persistence/exporters.ts:33,62,63,68` |
| 框选 | 圆弧按 24 段采样判定"完全在框内" | `packages/geometry-kernel/src/selection.ts:42-96` |
| 3D 解析圆 | DSL 已有 `circle3`（`centerId/normal/radius`），但画布从未渲染、导出返回空串 | `packages/dsl/src/types.ts:518+`、`exporters.ts:62` |
| 已有的解析面 | 圆柱面 / 圆锥面**已经有解析参数化宿主**，但只用于动点绑定 | `packages/geometry-kernel/src/hosts3.ts:178-230` |

**近似的量化代价**（推算，非实测 UI 读数）：

- 48 段圆的最大弦高偏差 `1 − cos(π/48) = 0.002141`，屏幕半径超过约 **467 px** 就超过 1 像素 → 这就是"放大看出棱"的量级来源（[MathWorld sagitta](https://mathworld.wolfram.com/Sagitta.html)）。
- 圆柱体积读数是内接 48 边形的值，比真值**约小 0.28%**（`48·sin(7.5°)/(2π) = 0.997152`）；侧面积约小 0.07%。
- 交点标记现在靠"转折 ≥ 18°"启发式挑选——这个阈值本身就是多边形近似逼出来的补丁（`apps/web/src/intersectionPreviews3d.ts`）。

**为什么可以用解析层而不是重写对象模型**：`polyhedron3` 的 `vertexIds/edgeIds/faceIds` 契约被约 30 个文件消费（schema、依赖图、级联删除、拾取、投影、导出、截面物化、展开、对象树），而它是**派生物**（模板生成、加载时补齐）。因此多边形继续当"手柄 + 面片填充 + 展开基底"的内部实现，解析层只负责回答数学问题，契约不动。

---

## 3. 目标与验收（A1）

1. 平面切圆柱 → 截面是**真圆 / 真椭圆**（连续曲线）；检查器给出中心、半轴、离心率；面积用 `πab` 精算。
2. 平面切圆锥 → 圆 / 椭圆 / 抛物线 / 双曲线四类结论由算法判定并显示（含离心率）。
3. 平面与柱面平行、相切、在外 → 两条平行线 / 一条直线 / 空集，逐条如实报出。
4. 圆柱 / 圆锥边界圆、截面曲线在任何缩放下都不出棱（屏幕误差 < 0.5 px）。
5. **第一组适配**（不做即自相矛盾）：3D 边界圆与截面真曲线渲染、平面∩曲面解析化、布尔交面边界、测量精确化、投影出真椭圆、圆柱/圆锥解析展开、检查器属性、SVG 导出、框选与捕捉、场景签名、旧档兼容。逐项验收见 §5.5。
6. `circle3`（空间圆）真正画出来并且可选中、可导出（它现在完全没渲染）。
7. 旧文档行为不变：没有解析字段的文档走原路径，读数与现在一致。

---

## 4. 不在本次范围

- **A2：二次曲面 ∩ 二次曲面**（圆柱↔圆柱那类）。另立 spec，但调研已经把路线摸清（记档在 `docs/research/quadric-intersection-algorithms.md`）：
  - **闭式可解的情形**（课程里真的会出现的那些）：平行/同轴圆柱对 → 0/1/2 条直线、重合、空；**等半径且轴相交 → 恰好两条平面椭圆**（半轴 `R/sin(A/2)` 与 `R/cos(A/2)`；正交时退化为 `z = ±x`）；**垂直且异半径 → 闭式参数化 `x = a cos t, y = a sin t, z = ±√(b²−a²sin²t)`**（两支、周期）；共轴回转体 → 圆；球∩球 → 根轴平面上的圆。
  - **剩下的异半径斜交是四次空间曲线**（曲线非平面，不是圆锥曲线），只能追踪或走解析代数；OCCT 有解析类（`IntAna_IntQuadQuad`，最多 12 条参数曲线）与数值追踪（`IntPatch_ImpImpIntersection`），但前者是多周量级的移植。
  - **最便宜的一条**：先追踪，再**吸附**成精确圆锥曲线（BRL-CAD `curve_fitting()` 的做法：取 6 点解圆锥曲线 + 全部采样点在容差内才提升为精确椭圆，否则如实退回折线）。这条能把用户看到的折线几乎清干净，而不必移植四次代数。
  - A2 的诚实状态词要按 OCCT 的 `IntAna_ResultType` 设计（`Empty / Same / Point / Line / Conic(...) / Traced(...)`），并保留一个"**已知有解、但拒绝猜**"的显式状态（对应 `IntAna_NoGeometricSolution`）。
  - **本次只留接口**：`intersectionLine` 增加可选解析字段的位置；内核 `intersectQuadricQuadric3` 的签名由 A2 决定，A1 不写空壳。
- **A3：逐像素光线求交（POV-Ray 式）**、GPU 曲面细分着色器。理由见 §5.6 与 §10。
- **删除 `segments` 字段或取消多边形物化**：那是 C 方案（B-rep 重写），明确不做。
- **球 / 环面等新实体**：DSL 暂无这些实体，不新增。
- 2D 平面画布的 `ellipse/parabola/hyperbola` 折线渲染：**只做共用采样策略这一处**（§5.5 第 12 项），不改 2D 的交互模型。

---

## 5. 架构

### 5.1 内核解析层：`packages/geometry-kernel/src/quadrics.ts`（新文件）

纯函数、零新依赖（不引入线性代数库，自己写 3×3 对称特征分解的 Jacobi 迭代）。

```ts
/** 二次曲面：`xᵀ Q x = 0` 的对称 4×4 矩阵（世界坐标）。 */
export interface Quadric3 {
  kind: "cylinder" | "cone" | "plane"
  /** 行主序 16 个元素，`Q[3][3] = 0` 的齐次二次型（与 `Conic3.coefficients` 不是一回事）。 */
  matrix: number[]
  /** 有限实体的边界数据（轴向范围 / 半径 / 顶点位置），裁剪与测量要用。 */
  bounds: { axis: Vector3; origin: Vector3; height: number; radius: number }
}

export function cylinderQuadric3(primitive: CylinderPrimitive): Quadric3
export function coneQuadric3(primitive: ConePrimitive): Quadric3
export function planeQuadric3(plane: Plane3): Quadric3
export function quadric3FromPrimitive(primitive: SolidPrimitive | Plane3): Quadric3 | null
```

矩阵构造按 OpenCascade / GeoGebra 的同一套约定（`A x² + B xy + C y² + D xz + E yz + F z² + G x + H y + I z + J = 0`，对称化后写成 4×4）。旋转用实体已有的 `rotation` 字段，与 `solid-builders.ts` 的 `rotateAboutPivot` 保持同一套语义（同一 pivot，同一顺序）。

### 5.2 圆锥曲线：分类与参数（同一文件）

```ts
export interface Conic3Frame { origin: Vector3; u: Vector3; v: Vector3; normal: Vector3 }

export type Conic3Kind =
  | "circle" | "ellipse" | "parabola" | "hyperbola"
  | "line" | "lines" | "point" | "empty" | "insufficient-data"

/** 平面内二次曲线：`A x² + B xy + C y² + D x + E y + F = 0`（`[A,B,C,D,E,F]`）。 */
export type Conic3Coefficients = [number, number, number, number, number, number]

export interface Conic3 {
  kind: Conic3Kind
  frame: Conic3Frame
  /** 平面内系数——**精确真源**（`PᵀQP` 的结果，见下）。 */
  coefficients: Conic3Coefficients
  /** 以下是从系数解出的规范数据，供界面与渲染使用；退化情形下按 kind 取用。 */
  center?: Vector3        // 圆/椭圆/双曲线
  semiMajor?: number      // 圆/椭圆 a ≥ b > 0；双曲线 a > 0
  semiMinor?: number      // 圆 = a；椭圆 b；双曲线 b
  focalParameter?: number // 抛物线 p（焦点到准线距离）
  eccentricity?: number   // 圆 0、椭圆 (0,1)、抛物线 1、双曲线 > 1
  foci?: Vector3[]        // 椭圆/双曲线两个，抛物线一个
  vertex?: Vector3        // 抛物线顶点
  /** `lines`：两条平行线的平面内法向偏移；`line`：单条直线偏移；`point`：那个点。 */
  lines?: { offset: number }[]
  point?: Vector3
  /** 闭合曲线（圆 / 椭圆）为 `true`，参数域 `[0, 2π)`；抛物线 / 双曲线 / 直线为 `false`。 */
  closed: boolean
}

/** 平面 ∩ 二次曲面：直接把圆锥曲线矩阵算成 `Pᵀ · Q · P`（`P` 是平面的 3×4 参数矩阵）。 */
export function intersectPlaneQuadric3(plane: Plane3, quadric: Quadric3): Conic3
```

**分类规则**（写死，不许含糊）：

设二次部判别式 `δ = B² − 4AC`（与经典不变量表里的 `J = AC − B²/4` 同号，`δ = −4J`）、`Δ = det(3×3 系数矩阵)`（经典表里的 `Δ`）。下表与 [MathWorld 的二次曲线不变量表](https://mathworld.wolfram.com/QuadraticCurve.html)（Beyer 1987）一致，只是把 `J` 换成了同号的 `δ`。

| 条件 | 结论 |
| --- | --- |
| `δ < 0` 且 `Δ < 0` | 椭圆（`a = b` 时进一步判圆，见下） |
| `δ < 0` 且 `Δ = 0` | 一点 |
| `δ < 0` 且 `Δ > 0` | 空集 |
| `δ = 0` 且 `Δ ≠ 0` | 抛物线 |
| `δ = 0` 且 `Δ = 0` | 平行线 / 一条（重根）/ 空集，由 `D² − 4AF`（在 `A ≠ 0` 的规范化下）符号决定 |
| `δ > 0` 且 `Δ ≠ 0` | 双曲线 |
| `δ > 0` 且 `Δ = 0` | 两条相交直线 |

**零判定一律按模型尺度**：`δ` / `Δ` 与输入矩阵同量纲，先按 `Q` 的最大绝对值 `s` 归一化（`δ/s²`、`Δ/s³`），再与 `1e-12` 比较；不使用绝对阈值（与仓库既有的 `quantumFor` 尺度约定一致）。三条一手先例支持这个做法：GeoGebra 的 `classifyQuadric()` 把 3×3 主子式与 `max³ · STANDARD_PRECISION_CUBE` 比较（三次量用立方缩放）；OCCT 平面∩圆柱用**半径缩放**的 `sint < Tol/radius` 区分圆与椭圆；OCCT 圆柱∩圆柱用**相对**半径差 `|R1−R2|/max(R1,R2) ≤ 1e-13`。反例同样明确：OCCT 的 `InitTolerances()` 用绝对容差（`1e-14`、`Precision::Confusion()`），那是建立在"CAGD 模型在归一化单位空间"的前提上——学生在一个作图里建半径 1000、另一个里建 0.01，绝对容差必然失效，所以不能照抄。
（若将来发现边界情形仍在闪，备选是 Eberly 的 Geometric Tools 做法：**精确有理数 + 笛卡尔符号法则**做分类、完全不用 epsilon，Boost 1.0 许可可移植，代价是引入一个小的 `BigInt` 有理数层——A1 先不上，记在 `docs/research/quadric-intersection-algorithms.md` §9.3。）

**"圆"的判定阈值必须写死并测边界**：`kind: "circle"` 要求 `|A − C| ≤ ε·max(|A|,|C|)` 且 `|B| ≤ ε·max(|A|,|C|)`，`ε = 1e-9`。这意味着"两个半轴在 9 位有效数字内相等"才算圆——**故意倾斜 1e-3° 的切面必须报椭圆**（写进测试）。判定不通过时如实报 `ellipse` 并给出 `eccentricity`，不四舍五入成圆。

参数化（渲染与采样共用；闭合曲线参数域 `[0, 2π)`）：

- 圆 / 椭圆：`p(t) = origin + a·cos(t)·u + b·sin(t)·v`
- 抛物线：`p(t) = vertex + (t²/(2p))·u + t·v`（`u` 指向开口方向）
- 双曲线：两支 `p±(t) = center ± (a·cosh t)·u + (b·sinh t)·v`
- 直线 / 平行线：`p(t) = origin + offset·u + t·v`

### 5.3 有限实体的裁剪：`section` 的解析边界

无界柱面 ∩ 平面给出完整圆锥曲线，但**有限实体**的截面还要被端面裁掉。所以截面的解析边界是**片段环**，不是单条曲线：

```ts
export type CurvePiece3 =
  | { kind: "conic"; conic: Conic3; parameterRange: [number, number] }
  | { kind: "segment"; a: Vector3; b: Vector3 }

/** 平面切一个有限二次曲面实体：解析结论 + 外环 / 内部环（每环由圆锥曲线弧与端面弦拼成）。 */
export function sectionQuadric3(source: Quadric3, plane: Plane3): { kind: Conic3Kind; loops: CurvePiece3[][] } | null
```

裁剪规则（写清楚，避免"画出一条超出实体的椭圆"）：

- **圆柱**：柱面参数 `z ∈ [0, h]`（轴向）。把圆锥曲线限制在两条端面平面之间得到参数区间；区间端点落在端面内的部分，用一个 `segment` 片段补回端面上的弦。平面含轴线（两条平行线）时同样裁剪到 `[0, h]`。
- **圆锥**：底端面 + 顶点；过顶点的退化情形直接给 `point` / `lines`。
- **球**：不实现（DSL 里没有球实体，本次不新增实体类型）。
- 返回 `null` 表示"这个来源不是二次曲面实体"（例如 `polyhedron3`），调用方回退到既有多边形路径。返回的 `kind` 已按 §5.4 的规则处理过"无界相交非空、但有限实体截出来是空"这一情形。
- **外部同款**：GeoGebra 的 `AlgoIntersectPlaneQuadricLimited` 用同一条思路（先拿精确圆锥曲线，再与上下端面圆求交，把结果压成四个路径参数），退化分支有 `setSinglePoint` / `setUndefined` / NaN 参数，且有按对象自身尺寸的相对容差 `isEpsilonToX(min − parameter, max − min)`。它的**诚实缺口**是 `default: // degenerate conics not handled`（退化圆锥曲线 + 有限实体不处理）；我们的片段环表示能覆盖到退化情形，但要在 `feature-catalog` 里写清我们覆盖到哪、哪里仍走回退。

### 5.4 DSL 变更（保持最小）

**只加两个可选字段 + 复用已有的 `circle3`**，不新增文档图元类型、不改既有联合类型：

1. `SectionPrimitive.exact?: { kind: Conic3Kind; loops: CurvePiece3[][] }` —— 解析结论与解析边界。旧文档没有这个字段，行为完全不变。`kind` 的取值规则（不留给实现猜）：平面与**无界**二次曲面的交为 `empty` → `empty`；与**有限实体**截出的环为空（平面擦过实体之外）→ `empty`；退化情形按 `point` / `line` / `lines`；否则为 `circle` / `ellipse` / `parabola` / `hyperbola`。环由多种片段拼成时（圆锥曲线弧 + 端面弦）`kind` 仍取那条圆锥曲线的类型。
2. `IntersectionFacePrimitive.exactLoops?: CurvePiece3[][]` —— 交面边界里的圆弧（§5.5 第 5 项）。
3. `circle3` 复用（不加新类型）：渲染、检查器、拾取、导出都接上——它已是解析圆，只是一直没被画出来。
4. `Section3Classification` **不加值**：它描述的是"多边形边界的形态"，而 `codec.ts:71` 与 `operations.ts:354` 两处都会按点数重新推导它；给联合类型加值会让旧档推导与文档声明不一致。解析结论一律从 `exact.kind` 读。
5. `polyhedron3` / `cylinder` / `cone` / `segments` **一律不动**。

`schema.ts` 校验：`exact.loops` 必须是数组的数组；每个片段的 `kind` 属于 `conic|segment`；`conic.coefficients` 是 6 个有限数；`conic.frame` 的四个向量都是有限数；`parameterRange` 两个有限数且 `min ≤ max`；`exact.kind` 属于 `Conic3Kind` 枚举。`codec` 按普通可选字段处理（旧档读入后该字段为 `undefined`；派生字段不参与旧档的推导）。

### 5.5 适配面（逐项 + 验收）

| # | 位置 | 改法 | 验收 |
| --- | --- | --- | --- |
| 1 | `sections3d.ts` / `operations.ts:recomputeSection` | 来源是圆柱/圆锥时先走 `sectionQuadric3`，写 `exact`（`kind` + `loops`）；多边形 `points/loops/classification` 继续按原样写（拾取与旧消费方） | 平面 z=1 切 R=2 圆柱 → `exact.kind: "circle"`、半径精确 2、中心 (0,0,1) |
| 2 | 3D 截面渲染 | `threePrimitives.ts` 新增 `createCurvePieces3(pieces, options)`：解析片段按屏幕误差细分后成线 | 放大 20× 后弦高 < 0.5 px（量细分点数） |
| 3 | 3D 圆柱 / 圆锥边界圆 | 边界从解析圆锥曲线画；多边形棱仍作为手柄/面片 | 上底圆渲染为真圆；`circle3` 与它一致 |
| 4 | 平面 ∩ 曲面求交 | 与截面共用 `intersectPlaneQuadric3`（平面来源时走解析，两个实体时保持既有路径） | 平面↔圆柱求交与同参数截面结果逐点一致 |
| 5 | 布尔交面边界 | `intersectionFace` 增加可选解析边界（与截面同一 `CurvePiece3`） | 圆柱 ∩ 立方体：交面边界含圆弧时是真圆弧 |
| 6 | 测量 | 圆柱 `V = πr²h`、侧面积 `2πrh`；圆锥 `V = πr²h/3`、侧面积 `πr√(r²+h²)`；`precision` 从 `"numeric-approximation"` 升为 `"exact-input"` | 读数与闭式值相等（1e-12）；精度标注随之更新 |
| 7 | 投影（工程制图） | 圆的投影是解析椭圆：中心投影 + 二次型变换 | 视线与圆平面夹角 θ 时投影椭圆离心率 = `sin θ`（1e-9） |
| 8 | 展开 | 圆柱 → `2πR × h` 矩形 + 两个圆；圆锥 → 扇形（母线长 `l = √(r²+h²)`，圆心角 `2πr/l`） | 展开矩形宽 = `2πR`、高 = `h`；扇形半径 = `l`、圆心角 = `2πr/l` |
| 9 | SVG 导出 | 椭圆导出 `<ellipse>`；`circle3` 与解析截面按真曲线导出 | 导出串含 `<ellipse`；R=2 圆的半径属性 = `2·scale` |
| 10 | 框选 / 捕捉 | 圆、圆弧、圆锥曲线的"完全在框内"用解析判定（遍历极值点 + 端点，不再采样弦） | 边界用例：弦鼓起 1e-6 但曲线出框 → 判为不在框内 |
| 11 | 检查器 / 对象列表 | 截面显示中心、半轴、离心率、焦点；`circle3` 显示半径与法向 | 面板出现"离心率"且数值与闭式一致 |
| 12 | 2D 画布圆锥曲线采样 | 与 §5.6 共用同一采样函数（只换采样策略，不动交互） | 椭圆放大后不再出棱；既有测试全绿 |
| 13 | 场景签名 | `sceneContentSignature` 把 `section.exact` / `intersectionFace.exactLoops` 并入签名 | 改剖切面 → 重建；不动 → 不重建（既有 `data-scene-builds` 断言) |
| 14 | DSL / schema / codec | §5.4 | schema 用例：合法通过、非法字段被拒；旧档读入不变 |

### 5.6 渲染政策

- **模型层永不读 `BufferGeometry`**：求交、包含、相切、测量、捕捉一律走 §5.1-5.3 的闭式。加一条测试断言：解析路径不 import 任何 three.js 模块。
- **曲线按屏幕误差细分**：`segmentsForCircle(R, tol) = max(3, ceil(π / acos(1 − tol/R)))`，`tol = 0.5px × 世界单位每像素`。曲线总长超过阈值时用 `ceil(总段数)` 上限保护（上限 `8192`，超出时如实标注）。**外部同款**：GeoGebra 的 `DrawConic3D` 按类型分发到解析绘制器（`arcEllipse` / `circle` / `hyperbolaBranch` / `parabola`），圆的段数就是 `brush.calcArcLongitudesNeeded(e1, π, getView3D().getScale())`——段数由当前视图尺度算出，既不固定也不烘进几何。
- **描边**用 three.js `Line2` + `LineMaterial`（圆帽与 AA 在 r186 源码里是真实现；`worldUnits = true` 给透视正确粗细）。注意它**不重采样**，采样点由我们给。
- **滞回**：相机缩放（世界单位每像素）变化超过 2× 才重算细分，不逐帧重建。
- **填充圆盘**用 SDF quad（`sdCircle(p, r) = length(p) − r` + `fwidth` 一像素 AA，自己写 `ShaderMaterial`）。A1 里只用于"圆盘 / 圆环"这类真实例；曲线描边走上面的 `Line2` 路径。
- **拾取**：优先解析判定（`|p − center| ≤ r`，与缩放无关，`threePicking.ts` 已有命中优先级结构）；确需逐像素时再上 GPU ID 拾取（`RGBA32I` + `setViewOffset` + `readRenderTargetPixelsAsync`），A1 不预先实现。
- **曲面填充**：保留网格 + 解析法向（着色已光滑），分段数由屏幕线性误差驱动并夹到 `[3, MAX_SOLID_SEGMENTS]`；**不做**逐像素光线求交。
- **不做**：GPU 几何 / 曲面细分着色器——WebGL2 只有 vertex + fragment（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/createShader)），WebGPU 的曲面细分提案已关闭（[gpuweb#15](https://github.com/gpuweb/gpuweb/issues/15)）。

---

## 6. 数据流

```
创建圆柱（Document.cylinder，含 segments=48 与物化拓扑）
        │
   拖动剖切面 / 新建截面
        │
operations.recomputeSection
        ├── 来源是 cylinder/cone → quadric3FromPrimitive → sectionQuadric3(quadric, plane)
        │        → exact: { kind: "circle" | "ellipse" | … , loops: CurvePiece3[][] }
        └── 其它来源 → 既有的 sectionPolyhedron3（多边形 points/loops，路径不变）
        │
   同一个事务里写回 section 图元（polygon 字段与解析字段并存）
        │
   ├── 画布：createCurvePieces3(section.exact.loops) 按屏幕误差细分 → Line2 / SDF
   ├── 检查器：Conic3 的规范数据（中心 / 半轴 / 离心率 / 焦点）
   ├── 投影：圆 → 解析椭圆
   ├── 展开：圆柱 → 2πR × h 矩形
   └── 导出：SVG <ellipse> / <circle>
```

- 依赖图与级联不变：`section.sourceId` 已在依赖图里（`scene-graph/src/operations.ts` 的 `primitiveDependencies`），解析字段只是同一事务里的派生数据。
- 签名：`section.exact` 的规范化串并入 `sceneContentSignature`，避免"改了剖切面却不重建"。
- 旧档：无 `section.exact` → 画布走折线路径 → 与今天一致。

---

## 7. 退化与诚实

| 情形 | 结论 | 是否给折线 |
| --- | --- | --- |
| 平面 ⊥ 轴切圆柱 | `circle`，半径 = R，中心 = 轴 ∩ 平面 | 否 |
| 平面斜切圆柱（与轴夹角 θ） | `ellipse`，`b = R`、`a = R/cos θ`、离心率 `= sin θ` | 否 |
| 平面 ∥ 轴，`offset < R` | `lines`（两条平行线） | 否 |
| 平面 ∥ 轴，`offset = R` | `line`（一条切线） | 否 |
| 平面 ∥ 轴，`offset > R` | `empty` | 否 |
| 平面过圆锥顶点 | `point` 或 `lines`（两条相交直线） | 否 |
| 平面仅切圆锥于顶点 | `point` | 否 |
| 平面在实体外 | `empty` | 否 |
| 平面恰好切于柱面（相切） | `line` | 否 |
| 来源不是二次曲面实体 | `sectionQuadric3` 返回 `null` | **是**，回退既有多边形路径并保持 `numeric-approximation` |
| 系数非有限 / 退化输入 | `insufficient-data` + 诊断 | 否 |

- 解析不可用时**明确回退**并在状态/检查器里标注数值近似，不假装精确。
- 椭圆周长没有初等闭式：用级数计算并如实标注为数值近似（面积 `πab` 是精确的）。这条不能含糊——圆周长 `2πr`、圆柱/圆锥的体积与侧面积才是精确闭式。

---

## 8. 测试策略（RED → GREEN）

纪律沿用仓库既有做法：**先写失败用例（RED，跑出真实失败信息）→ 实现 → GREEN**，不确认的缺陷只记录不猜改。

1. **分类与参数（内核，逐情形一例，断言精确值）**：上表每一行一个用例，断言半径 / 半轴 / 离心率 / 中心 / 所在平面；`empty` 与 `insufficient-data` 断言不给几何。
2. **圆判定的边界**：`ε = 1e-9` 的两侧各一例——正切（`B = 0`、`A = C`）报 `circle`；倾斜 1e-3° 报 `ellipse` 且离心率 > 0。
3. **性质测试（两条，把"确实更准"钉住）**：
   - 解析曲线参数化点上代回 `Quadric3` 隐式方程，残差 `< 1e-9 · scale²`；
   - 解析曲线与同参数 48 边形折线的最大偏差 `< R·(1 − cos(π/48))·1.05`（即确实不超过弦高上界）。
4. **裁剪**：斜切圆柱且切到端面时，环由"椭圆弧 + 端面弦"拼成，闭合且每片端点落在端面平面上（1e-9）。
5. **适配项**：§5.5 表格的"验收"列逐条一例（含投影离心率 = `sin θ`、展开宽 = `2πR`、SVG 含 `<ellipse>`、框选边界用例、签名变化触发重建）。
6. **渲染采样**：`segmentsForCircle` 的单测（`R` 与 `tol` 的单调性、下限 3、上限保护），以及"放大后细分点变多"的浏览器用例。
7. **回归**：旧文档（无 `section.exact`）读入后截面点数与今天完全一致。
8. **门禁**：`typecheck` 4 个 workspace、`npm.cmd test`、`lint` 0 error、生产构建、Playwright 全绿，数字以 `docs/project-progress.md` 的"当前基线"为准并同步更新。

---

## 9. 迁移与兼容

- **不迁移、不重写**：`section.exact` / `intersectionFace.exactLoops` 是纯增量字段；没有它们的文档行为不变。多边形物化与 `segments` 字段保留（`segments` 从"曲率真源"降级为"渲染 LOD 提示"）。
- **`circle3`**：本就存在，只是没渲染；接上渲染后旧文档里若已有 `circle3`（例如面积测量的来源），它会开始出现在画布上——这是修复，需要在 `docs/feature-catalog.md` 说明。
- **许可**：本仓库没有 LICENSE 文件；本方案**不引入任何新依赖**（无 WASM、无 CAD 内核、无线性代数库），因此不触及 LGPL 等问题（对比见 §10）。
- **性能**：解析层是纯函数、每次重算只做常数级矩阵运算；主要成本在渲染细分，已用滞回与上限控制。

---

## 10. 外部参考与取舍（三份调研 + 一份补充的结论）

1. **GeoGebra 也只做到"平面 ∩ 二次曲面"**：`AlgoIntersectPlaneQuadric.intersectPlaneQuadric()` 就是 `cm = Pᵀ·Q·P`，输出带 3×3 圆锥曲线矩阵的 `GeoConic3D`（[IntersectPath 命令](https://geogebra.github.io/docs/manual/en/commands/IntersectPath/)）；**有限实体的裁剪也是精确的**（`AlgoIntersectPlaneQuadricLimited`：圆锥曲线与上下端面圆求交，存成四个路径参数；它自己的缺口是 `default: // degenerate conics not handled`）；**渲染的段数由视图尺度算**（`DrawConic3D.updateCircle` → `brush.calcArcLongitudesNeeded(e1, π, getView3D().getScale())`）——A1 的 §5.3 与 §5.6 都有同款外部实现；二次曲面互交只实现了球∩球，其余组合 `setUndefined()`（[IntersectConic](https://geogebra.github.io/docs/manual/en/commands/IntersectConic/)）。**结论：A1 的做法与教学软件的成熟做法一致。** A2 的路线与参考见 `docs/research/quadric-intersection-algorithms.md`（含 Trocado / Gonzalez-Vega / dos Santos, *Intersecting Two Quadrics with GeoGebra*，CAI 2019，DOI 10.1007/978-3-030-21363-3_20，[zbMATH](https://zbmath.org/1434.68718)——正文付费，未读到，不得当作算法依据）。
2. **网格 CSG 一律排除**：`manifold`（541 KB）的 API 自己就是 `circularSegments`，`three-bvh-csg` 输出 `intersectionEdges: Line3[]`（线段汤）——**按构造就没有真圆**。
3. **OCCT-WASM 家族能给真圆，但代价明确**：`occt-wasm` 的 `.wasm` 实测 **22.0 MB**（README 声称 brotli 约 4.5 MB，属厂商口径）、**LGPL-2.1**、要求 WASM SIMD + tail calls（Chrome/Edge 114+、Safari 17.2+、Firefox 121+）、异步初始化 + 句柄手动 `release()`；且**OCCT 没有展开实体的 API**，文档格式也必须停止存多边形。**结论：只有连对象模型一起换成 B-rep（C 方案）才划算，本次不做。**
4. **渲染**：three.js r186 的 `Curve` **没有误差驱动采样**（`getPoints(divisions)` 是按参数均分）；`Line2`/`LineMaterial` 的圆帽与 AA 是真实现（每段 6 个三角形，48 段 = 288 个三角形）但不重采样；SDF 圆的精确公式与 `fwidth` AA 有据可依；WebGL2 无几何/曲面细分阶段。**结论：解析模型 + 我们自己的误差驱动采样 + `Line2` 描边 + SDF 填充是浏览器里的标准答案。**

---

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 圆判定阈值把"几乎是圆"误报成圆 | 阈值写死 `1e-9` 相对量 + 边界测试（倾斜 1e-3° 必须报椭圆） |
| 裁剪写错导致"椭圆画出实体之外" | 裁剪规则写成表 + 每情形端点在端面平面上的断言 |
| `section.exact` 与多边形字段不一致（画布与拾取打架） | 两者在同一次重算里生成；性质测试断言"解析曲线上的点到多边形环的偏差 < 弦高上界" |
| 渲染细分拖慢场景 | `tol = 0.5px` + 2× 滞回 + 段数上限 8192，超出时如实标注 |
| 适配面清单很大，一次做完风险高 | §12 的切片顺序，每一片独立可验收、可提交 |
| 旧文档回归 | 逐条回归用例（§8.7）+ 门禁全套 |

---

## 12. 实施顺序（每片独立可交付、可提交）

> **最小可交付核心是第 1-3 片**（解析层 + 截面解析化 + 真曲线渲染）：做完这三片，"平面切圆柱得到真圆/真椭圆、放大不出棱"就已经成立，可以独立验收；第 4-8 片是适配面，按顺序追加，每片都能单独提交。

1. **内核解析层**：`quadrics.ts`（矩阵、分类、`intersectPlaneQuadric3`）+ 单测与性质测试（§8.1-8.3）。
2. **裁剪与截面解析化**：`sectionQuadric3` + DSL `section.exact` + schema/codec + `recomputeSection` 接线（§8.4）。
3. **真曲线渲染**：误差驱动采样 + `createCurvePieces3` + `Line2` 描边 + 3D 边界圆 + `circle3` 渲染；渲染采样单测与浏览器用例。
4. **检查器与对象列表**：圆锥曲线属性（中心 / 半轴 / 离心率 / 焦点）。
5. **测量精确化**：闭式体积/面积 + 精度标注；椭圆周长如实标近似。
6. **投影与展开**：投影出真椭圆；圆柱/圆锥解析展开。
7. **导出与框选/捕捉**：SVG `<ellipse>` / `<circle>`；解析框选判定。
8. **签名与回归收尾**：签名并入解析字段、旧档回归、文档与门禁、提交推送。

> 下一份 spec（A2：二次曲面互交）在本轮验收通过后开始。**三份调研（含一份补充）已全部归档**在 `docs/research/quadric-intersection-algorithms.md`（GeoGebra 源码级结论、OCCT 三层结构与 `IntAna_IntQuadQuad` 更正、BRL-CAD 的圆锥曲线吸附、Eberly 的精确有理数分类、openNURBS 闭式例程、负面结果清单、未确认清单），A2 直接以它为输入。

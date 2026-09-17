# 平面几何动点系统设计（Dynamic Point Engine）

- 日期：2026-09-17
- 范围：平面（2D）几何的动点、约束、响应式重算、动态测量与轨迹求取
- 状态：**已全部交付**——内核模块（`planar-constraints.ts` / `dynamic-points.ts` / `locus-sampling.ts`）、场景图集成（依赖边 + 拓扑重算 + 增量 ≡ 全量的性质测试）、视图集成（画布拖动 / 路径参数 / 轨迹）都在产品里。2026-09-17 的全身大体检又修掉本模块的几处缺陷：顺时针弧的参数越域与反序参数域、`parameterBounds` 返回共享可变对象、非有限输入返回 `∞` 坐标、隐式约束残差在梯度退化时的量纲错误、投影迭代上限未归一化。3D 动点沿用既有 `Point3Binding` 机制，不在本文范围内。

## 1. 背景与现状差距

引擎已经具备"静态几何计算内核"（`packages/geometry-kernel`）与"文档 + 操作 + 重算"的场景图
（`packages/scene-graph`）。引入动点后暴露出的四个具体缺口：

| 缺口 | 现状 | 后果 |
| --- | --- | --- |
| 约束没有统一抽象 | `resolveBoundPoint` 里一串 `if (path.type === ...)`，各自手写参数化 | 新增曲线类型要改重算管线；`parabola` / `ellipse` / `hyperbola` 直接落到 `return null`，绑定它们的点**静默不动** |
| 重算没有拓扑序 | `getAffectedPrimitiveIds` 做 BFS 得到脏集，然后按**数组顺序**各重算一次 | 只在"对象恰好按依赖顺序创建"时正确；`recomputeBoundPoint3s` 之所以要"最多重跑 N 遍直到不动"，正是缺拓扑序的症状 |
| 轨迹不在内核里 | 轨迹在视图层算：`GraphicsView.locusSegments` 对每个采样点跑一次**整文档重算** | 128 个采样点 = 128 次全量重算；且所有点连成一条折线，跨渐近线时画出不存在的竖线 |
| 测量没有增量通道 | 3D 测量由 `calculateMeasurement3` 在每次重算时全量算一遍 | 一次拖拽要重算所有测量；UI 无法区分"值真的变了"和"浮点噪声" |

本文给出四个维度的设计，均已落地为带测试的内核模块。

## 2. 总体架构

```
                    ┌─────────────────────────────────────────┐
   用户拖拽  ──────▶ │ DynamicPoint.moveTo(pointer)            │
   滑块/动画 ──────▶ │ DynamicPoint.setParameter(t)            │
                    └───────────────┬─────────────────────────┘
                                    │ 只写 parameter，坐标由约束重算
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ PlanarConstraint                        │
                    │   evaluate(t) → Coordinate              │  ← 正向映射
                    │   project(q)  → { t, point, distance }  │  ← 反向映射（最近点）
                    │   residual(q) → number                  │  ← 违反度
                    └───────────────┬─────────────────────────┘
                                    │ changedPointIds
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ DependencyGraph / ReactiveGraph         │
                    │   dirtyClosure(changedIds) : 拓扑序子序列 │
                    └───────────────┬─────────────────────────┘
                        ┌───────────┴───────────┐
                        ▼                       ▼
            ┌────────────────────┐   ┌────────────────────────┐
            │ 几何实体增量重算     │   │ MeasurementEngine      │
            │ （场景图 / 视图）    │   │ （依赖图叶子，带剪枝）   │
            └────────────────────┘   └────────────────────────┘
                        │
                        ▼
            ┌─────────────────────────────────────────────┐
            │ sampleLocus(evaluate, domain) → branches[]   │
            │ （渐近线/间断点切分，自适应细分）              │
            └─────────────────────────────────────────────┘
```

分层原则：**内核不持有文档状态**。约束、依赖图、测量引擎都只接受回调/数据，不知道
`GeometryDocument` 的存在，因此可以脱机测试（142 个内核单元测试全部不依赖 React 或文档模型），
也能被 3D 轨迹复用。

## 3. 维度 1：动点数据结构与约束模型

### 3.1 约束 = 一维曲线 + 自然参数

```ts
export interface PlanarConstraint {
  readonly kind: ConstraintKind
  readonly id: string
  readonly branchCount: number                              // 双曲线 = 2，其余 = 1
  parameterBounds(branch?: number): ParameterBounds         // { min, max, wrap }
  evaluate(parameter: number, branch?: number): Coordinate | null
  project(desired: Coordinate, options?: ProjectOptions): ConstraintProjection | null
  residual(point: Coordinate): number
  tangent(parameter: number, branch?: number): Coordinate | null
}
```

**为什么是这三个原语。** 动点的全部自由度被压缩成一个标量参数，"点沿曲线运动"就是"参数在区间内变化"。
于是拖拽与动画统一成同一个状态更新：

```
拖拽 = project(鼠标位置) → t → evaluate(t)
动画 = t += Δt                → evaluate(t)
```

两条路径写同一个参数，下游依赖图完全不需要区分用户是拖出来的还是播放出来的。

**参数语义按种类固定，不统一归一化到 `[0, 1]`。** 统一归一化会让非线性约束在参数域上分布极不均匀
（抛物线在顶点附近参数变化极慢、远端极快），牛顿法与采样都会退化：

| 约束 | 参数 | 域 |
| --- | --- | --- |
| `segment` / `ray` / `line` | 仿射比例 t | `[0,1]` / `[0,∞)` / `(-∞,∞)` |
| `circle` / `arc` | 角度 θ（弧度） | 周期 2π / `[startAngle, endAngle]` |
| `ellipse` | 离心角 θ | 周期 2π |
| `hyperbola` | 轴向参数 u，分两支 | `(-∞,∞)`，`branchCount = 2` |
| `parabola` | 轴向参数 u | `(-∞,∞)` |
| `polyline` | **按弧长**归一化的比例 | `[0,1]` |
| `functionGraph` | x 本身 | 函数定义域 |
| `implicitCurve` | 无自然参数（只支持投影） | — |

折线取弧长参数化而非"按顶点序号"：后者会让长边拖得飞快、短边几乎不动。
代价是顶点处两个 t 映射到同一点 —— 但**弧长参数在顶点处是唯一的**，所以并不存在歧义。

### 3.2 一维线性约束：参数化映射

闭式解，无迭代。设 `d = b − a`，`L² = |d|²`：

```
evaluate(t) = a + t·d
project(q): t_raw = ((q − a)·d) / L² ,  t = clamp(t_raw, min, max)
residual(p): |p − foot(clamp(t_raw))|        // foot = 投影点
```

三个要点：

1. **投影就是一次点积**，直线/射线/线段的差别全部由 `parameterBounds` 承载，不需要三份实现。
2. `residual` 必须是"到**约束集**的欧氏距离"，而不是"到无限直线的垂距"。
   早期实现用了后者，线段 `(0,0)-(4,0)` 上的点 `(7,0)` 会得到 `0` 而不是 `3`（单测捕获）。
3. `clamped` 标记把"参数被边界截断"与"普通吸附"区分开，UI 可以据此提示"已经拖到端点"。
   直线的参数域是整条实轴，因此永不截断。

### 3.3 非线性隐函数约束：参数控制 与 投影最近点

对圆锥曲线 `F(x, y) = Ax² + Bxy + Cy² + Dx + Ey + F = 0`，两条更新路线**都要有**：

**(a) 参数控制（正向）** —— 具名圆锥曲线有精确参数化，用于轨迹采样与动画：

```
ellipse   : P(θ) = c + R(φ)·(a·cosθ, b·sinθ)                  θ ∈ [0, 2π)
hyperbola : P(u) = c + R(φ)·(u, ±b·√(1 + u²/a²))              u ∈ (-∞, ∞)，± 为分支
parabola  : P(u) = v + R(φ)·(u²/2p, u)   （axis "y": 交换分量）u ∈ (-∞, ∞)
```

这套参数化**精确、光滑、无分支问题**（椭圆）或**分支显式**（双曲线），采样时不会遇到
"两个解该取哪个"的歧义。

注意 `sampleHyperbola` 的约定容易被字面误读：`axis: "x"` 表示**参数沿 x 方向跑**，
局部点是 `(u, ±b√(1+u²/a²))`，因此横轴其实落在 **y** 方向上。隐式系数必须与之匹配：

```
axis "x":  Y²/b² − X²/a² = 1  →  a²Y² − b²X² − a²b² = 0   (qxx = −b², qyy = +a²)
axis "y":  X²/b² − Y²/a² = 1  →  a²X² − b²Y² − a²b² = 0   (qxx = +a², qyy = −b²)
```

按字面取 `axis "x" → b²X² − a²Y²` 是错的：在 `u = 0` 的顶点 `(0, b)` 上会算出 `−72` 而不是 `0`。
测试用"隐式形式必须在参数化采样点上取零"这一交叉校验捕获了它。

**(b) 投影最近点（反向）** —— 任意 `F(x, y) = 0` 都支持，用**拉格朗日–牛顿法**：

```
问题：  min ½|p − q|²   s.t.  F(p) = 0

拉格朗日条件：
        G(p, λ) = [ p − q + λ·∇F(p) ]  = 0
                  [ F(p)            ]

雅可比：
        J = [ I + λ·H(p)    ∇F(p) ]
            [ ∇F(p)ᵀ         0    ]        H = ∇²F

迭代：  解 3×3 线性系统  J·[Δp; Δλ] = −G，再做带回退的线搜索
```

对二次曲线 `H` 是常数矩阵（`H = [[2A, B], [B, 2C]]`），收敛是二次的，通常 3~5 次迭代到机器精度。
回退线搜索是必需的：隐式约束的牛顿步可能把点甩到很远处，必须保证残差单调下降。
多起点（`curve.seed` 或默认的一圈偏移点）用来绕开局部极小 —— 隐式曲线可能有多支，
单起点会系统性地落到错误的一支上。

**拖动连续性优先于"全局最近点"。** `ProjectOptions.previousParameter` / `previousBranch`
是对拖拽语义的显式编码：

- 双曲线：给定 `previousBranch` 就**只在该分支搜索**。跨过渐近线时不换支，这才是拖拽想要的行为。
- 椭圆：给定上一次参数就对半周期加密搜索，避免陡峭段上最近点跳变。

`residual` 对隐式约束用一阶估计 `|F| / |∇F|`（便宜，适合命中测试），
在椭圆 `a=4, b=1` 的 `(6,0)` 处给 `20/12 ≈ 1.67` 而真值是 `2`；需要精确距离时用 `project().distance`。
这一点在代码与测试里都写明了，不让调用方误以为是精确值。

### 3.4 `DynamicPoint`：唯一不变式

```ts
export class DynamicPoint {
  readonly id: string
  readonly constraint: PlanarConstraint
  private parameterValue: number
  private branchValue: number
  private pointValue: Coordinate     // 缓存，永远等于 constraint.evaluate(parameter, branch)
  ...
}
```

**参数是唯一真值，坐标是它的派生缓存。** 任何一次更新都只写 `parameter` / `branch`，
坐标随即由约束重新求值。这样点永远**精确落在**约束上，不会像"先算坐标再事后吸附"的实现那样
在连续拖动后慢慢漂离曲线 —— 那是动态几何软件最经典的数值缺陷。

其他被测试固定的行为：

- `changed` 只在坐标真的动了（超出 `1e-12`）时为 `true`。这是"下游不该被无意义地标脏"的第一道闸门。
- `setParameter` 对周期约束折叠到 `[min, max)`（避免长时间动画后参数无限增大而丢精度），
  对有界约束截断并置 `clamped`；非有限参数直接拒绝，**不写入状态**。
  指针事件的坐标可能是 `NaN`（事件被取消、缩放矩阵退化），一旦写进状态点会永久消失且拖不回来。
- 约束在该参数处无定义（函数图像的间断点）时 `valid = false`，但**参数照写**，
  这样把 x 拖回定义域时点会立刻恢复，而不是卡在原地。
- `refresh()` 用于约束本身改变了（例如函数表达式背后的量变了）时重新求值。
- 自由点（2 个自由度）**不属于** `PlanarConstraint` 模型，仍走文档直接改 x/y 的路径。
  这条边界是有意划的：把自由点硬塞进参数化模型只会让两边都变复杂。

`beginDrag` 记录抓取偏移，避免拖拽开始时点瞬移到光标下；`traceParameters` 扫完参数后恢复原状态，
是轨迹采样的最小接口。

## 4. 维度 2：响应式依赖图与拓扑更新

### 4.1 数据结构与算法

```ts
export interface DependencyGraph {
  addNode(id, dependsOn?): void
  dependenciesOf(id): readonly string[]     // 上游
  dependentsOf(id): readonly string[]       // 下游（拖拽时沿这个方向 BFS）
  topologicalOrder(): readonly string[]     // Kahn，缓存到结构变化为止
  dirtyClosure(changedIds): string[]        // 脏闭包，按拓扑序返回
  findCycle(): string[]                     // 返回一条具体的环路径
  readonly version: number
}
```

复杂度：

```
脏闭包   O(V + E)   —— 从变更点沿 dependents 边 BFS
拓扑序   O(V + E)   —— Kahn，用插入顺序做稳定的平局裁决；结构不变则命中缓存
重算     O(脏集)    —— 按全局拓扑序**过滤**脏集
```

第三步是关键：**脏集是全局拓扑序的子序列，所以"过滤"天然给出依赖优先的顺序**，
每次拖拽不需要重跑拓扑排序。

### 4.2 无冗余重算：剪枝

```ts
export interface ReactiveNode<T> {
  id: string
  dependsOn: readonly string[]
  compute(inputs: ReadonlyMap<string, T>): T
  equals?(next: T, previous: T): boolean     // 返回 true ⇒ 上游没变 ⇒ 剪掉全部下游
}
```

`update(changedIds)` 的语义：

1. `changedIds` 里的节点被视为"值刚刚被外部写好了"（`setValue`），只向下游传播，不重新 `compute`；
2. 其余处于脏闭包中的节点按拓扑序重算；
3. 某个节点结果未变（`equals` 判定）⇒ 它**及其全部下游**被剪掉，记入 `report.pruned`；
4. `compute` 抛异常 ⇒ 记入 `report.errors`，**保留上一次的值**，并剪掉其下游 ——
   宁可显示过期数据，也不要让一个坏节点把整张图清空，更不能用过期值去算下游。

第 3 条是"无冗余"的来源。测试用调用计数器显式验证：一次拖拽里若斜率没变，交点与面积根本不会被调用。

### 4.3 与现有实现的关系

现有 `getAffectedPrimitiveIds` 做的是 BFS 脏集，然后 `recomputeDerivedObjects` 按**数组顺序**重算。
它只在对象恰好按依赖顺序创建时正确。`recomputeBoundPoint3s` 之所以要

```ts
for (let pass = 0; pass < primitives.length; pass += 1) { ... if (!changed) return }
```

"最多重跑 N 遍直到不动"，正是缺拓扑序的症状。用拓扑序可以一趟算完，且能**证明**没有冗余。

**已接入主流程。** `recomputeDerivedObjects` 现在按 `topologicalRecomputeOrder(document, changedIds)`
给出的顺序重算，并且在每算完一个对象后**立刻更新查找表**，因此下游读到的是刚算出来的上游值，
而不是本趟开始前的快照。两处历史包袱随之删除：

- `recomputeBoundPoint3s` 的"最多重跑 N 遍直到不动"循环已移除，一趟即可收敛；
- 单趟遍历里的 `map` 改成了带查找表更新的 `for` 循环（`recomputePrimitive` 是原来的类型分派链，
  抽出来只为让循环能按拓扑序走）。

两个安全措施写在 `topologicalRecomputeOrder` 里：

- 依赖里**只有真实存在的图元**才建边。`slopeParameter` / `parameterId` 这类参数 id 不是图元，
  它们的值在参数求值的前置步骤已经应用过，不需要参与排序；
- 环里的节点不会出现在拓扑序中，直接过滤会**静默漏算**，所以按文档顺序补在末尾。

## 5. 维度 3：动态测量与关系计算

### 5.1 测量是依赖图的叶子

```ts
export interface PlanarMeasurement {
  id: string
  metric: "length" | "distance" | "angle" | "slope" | "area" | "signedArea"
        | "radius" | "ratio" | "coordinate" | "perimeter"
  sourceIds: string[]                       // 角度是 [A, V, B]，周长是顶点环
  angleKind?: "interior" | "exterior" | "oriented"
  vertexIndex?: number
  component?: "x" | "y"
  precision?: number
}
```

`define(m)` 会在共享依赖图上加一个叶子节点 `measure:<id>`，依赖它的全部来源对象。
于是测量**天然继承剪枝**：一次拖拽里如果斜率没变，夹角就不会被重算。

状态语义（与 3D 测量保持一致）：
`valid` / `degenerate`（几何退化：重合点、零向量、三点共线）/ `insufficient-data`（引用缺失）/
`numeric-failure`（结果非有限）。**非 `valid` 时 `value` 恒为 `null`**，不让 `0` 和"无意义"混淆。

### 5.2 属性监听器的拉/推双通道

```ts
export interface MeasurementEngine {
  define(measurement): void
  read(id): MeasurementReading | undefined
  readings(): readonly MeasurementReading[]
  update(changedIds): { readings; changed; statusChanged }
  refreshAll(): MeasurementChangeSet
  subscribe(listener): () => void
}
```

- **拉**：`readings()` 给全量快照，渲染层直接读，永远不自己算几何 ——
  于是画布与面板不可能显示不一致的值。
- **推**：`subscribe()` 只回调**值真的变了**的读数。

关键的容差语义：变化判定的基准是**上一次对外报告过的值**，不是上一次算出来的值。
用后者会把连续小幅漂移逐步吞掉 —— 每一步相对上一步都很小，于是永远不通知，
UI 一直显示一个已经偏离很远的旧值。以报告值为基准，漂移会累积，累积量跨越容差就通知一次。
两者的区别被一个专门的测试固定（3 → 3.02 逐步微调，第 3 步才触发通知）。

角度计算用 `atan2(|cross|, dot)` 而不是 `acos(dot / (|u||v|))`：
后者在角度接近 0 或 π 时会把参数推出 `[-1, 1]` 得到 `NaN`，这是几何软件里
"角度突然变成 NaN"最常见的来源。`oriented` 模式保留方向（区分顺时针/逆时针），
`interior` / `exterior` 分别给 `[0, π]` 与 `2π − interior`。

几何量本身（`lengthBetween`、`signedPolygonArea`、`polygonPerimeter`、`angleBetween`、
`signedDistanceToLine`）都是纯函数，既可在线实时算，也可离线导出读数表。

### 5.3 接入应用的取舍：复用 `Measurement3`，不新增 DSL 类型

平面测量此前完全没有入口（`measurementOptionsFor` 对非 `geometry3d` 直接返回空数组），
所以画布上选两个点看不到任何测量按钮。接入时**没有新增一套平面测量类型**：

- `Measurement3Metric` 已经包含 `length` / `distance` / `angle` / `area`；
- `Measurement3Status` 与内核的 `MeasurementStatus` 逐字相同（`valid` / `degenerate` /
  `insufficient-data` / `numeric-failure`）。

因此归档格式、对象列表（`AlgebraView`）、检查器与导出器**一行都不用改**，只需要两个接入点：

1. `spatialTools.measurementOptionsFor`：平面工作区按选择形状给出选项
   （2 个点 → 长度；3 个点 → 角度 / 面积 / 距离）；
2. `scene-graph` 新增 `calculatePlanarMeasurement`，并按工作区把测量路由到
   `evaluatePlanarMeasurement`（`geometry3d` 仍走 `calculateMeasurement3`）。

两处映射：`dihedralKind`（interior / exterior）同时承载平面角的取角方式，沿用已有的按钮签名；
平面量都是数值计算的，所以 `precision` 固定为 `numeric-approximation`。

测量重算现在也只针对**来源进了脏集**的那些：来源都没变时保留上一次的读数。
这是依赖图剪枝在测量上的体现 —— 拖一个与某测量无关的点不会触发它重算。

代价（记为后续工作）：`kind: "measurement3"` 这个名字用在平面测量上名不副实，
将来若要区分，应把它改成 `measurement` 并加一个坐标系字段。

### 5.4 参数管理：驱动参数的可见性与生命周期

动点绑定曲线时会自动生成一个专属驱动参数 `t-<点id>`。它此前**不可见、也不会被回收**：
用户看不到是谁在驱动那个点，删掉点之后参数还留在文档里。

**可见性。** 代数区（`AlgebraView`）底部新增「参数」分组，每个参数可改值、最小、最大、步长、名称。
自动生成的驱动参数用 `ParameterSpec.ownerId` 标注归属，列表里显示成「驱动 A」，
一眼看出"这是谁在动"；手工创建的参数没有归属标签。

**生命周期。** 删除对象时做一次**孤儿驱动参数清扫**，三条判据同时成立才回收：

1. 带 `ownerId`（说明是自动生成的，不是用户手工建的）；
2. 归属对象已经不在文档里；
3. 没有任何图元引用它（`parameterIsReferenced` 检查 `slopeParameter` / `binding.parameterId` /
   `locus.parameterId` / 模板实体的 `construction.parameterIds`）。

判据刻意是"孤儿"而不是"本次被删"：先删点 A（参数因被点 B 共用而保留）、再删点 B 时，
A 早已不在本次删除集里 —— 只看删除集就永远收不掉它（实测踩到过）。

`deleteParameter` 在参数仍被引用时**拒绝**，理由与"删掉动点所在曲线"一致：
绑定里的 `parameterId` 一旦悬空，点会静默冻住。

`setParameter` 操作扩展为可同时带上 `min` / `max` / `step` / `label` / `ownerId`，
所以新建驱动参数是**一次提交**，而且拖动滑块（只带 `value`）不会抹掉已有元数据。

**已知限制**：清空「最小/最大/步长」输入框暂时等于不改（`patch.field ?? current.field`
无法区分"没提供"与"要清空"）。要支持清空需要把操作签名改成显式的 `null`。

## 6. 维度 4：轨迹求取

### 6.1 离散采样：三阶段算法

```
输入：evaluate: t → Coordinate | null，domain [t0, t1]，samples N

阶段 1  均匀粗扫
        P₀ = { t₀ + k·(t₁−t₀)/(N−1) }，逐个求值（带参数缓存，共享端点不重复算）
        median = 全部"两端都有定义"的相邻步长的**中位数**
        阈值 = max(median × jumpFactor, median, maxJump)

阶段 2  定位断点
        对每个可疑相邻对（端点无定义，或步长 > 阈值）二分 breakDepth 次：
            mid = (lo + hi)/2
            若 p(mid) 无定义              → 断点在 mid
            若两侧步长都 ≤ 阈值/2         → 这一对其实连续，只是粗扫步长太大（放弃）
            否则往更长的一侧收缩，把断点夹在中间
        收敛后的位置记入 breaks

阶段 3  形状自适应细分（**不跨断点**）
        对每个连续段内的相邻对递归：
            deviation = 中点到弦的**线段距离**
            若 deviation ≤ tolerance 或 depth ≥ maxDepth → 停（中点不必保留）
            否则二分并把中点插入结果
输出：branches[]（每条 = 一段连续折线）、breaks[]、evaluations、undefinedCount、truncated
```

三个设计要点：

1. **中位数而非均值**做跳跃基准。均值会被异常跳跃本身污染，中位数不会 ——
   这是区分"真正的断点"和"正常的粗步长"的关键。
2. **断点先定，细分后做**。细分只在连续段内部加密，绝不会跨过断点，
   因此不可能把两支重新连起来。
3. **曲率驱动而非长度驱动**。直线段上不额外加点（`deviation = 0` 直接返回），
   急弯处才二分加密。这直接决定了一次拖拽要付多少次"整文档重算"。

**为什么必须有断点切分。** 旧实现把所有采样点连成一条折线。对 `y = 1/(t−1)` 这类轨迹，
跨过 `t = 1` 的相邻采样点会被连成一条横贯画面的竖线 —— 那是不存在的图形。
测试断言了决定性性质：**任何一条分支都不能同时含有渐近线两侧的点**（按 `sign(y)` 判定分支纯度）。

求值顺序约定：自适应细分会产生非单调的求值顺序（先算大步的中点，再回头补算它的半边）。
因此 `evaluate` 必须是参数的**纯函数**；若求值器依赖预热状态，先用 `monotoneWarmup`
沿参数升序驱到稳定。

### 6.2 代数推导：结式消元

从一组几何约束方程直接消去动点参数，得到轨迹的隐式代数方程。
输入输出示例（这是验收测试）：

```
输入：  u² + v² − 1 = 0          （P = (u,v) 在单位圆上）
        2x − u − 2 = 0            （M = (x,y) 是 A(2,0) 与 P 的中点）
        2y − v = 0
消去：  u, v
输出：  4x² + 4y² − 8x + 3 = 0    （圆心 (1,0)、半径 1/2 的圆）
```

即"中点轨迹是圆"的**代数证明**，而不是"采样看起来像圆"。

实现要点：

1. **系数是精确有理数（BigInt 分数）**，整个消元过程没有浮点误差累积。
   几何输入常是 `0.5`、`1/3` 这类数，先用连分数收敛把它们吸附到最简分数
   （`0.30000000000000004 → 3/10`）。
2. **结式用 Sylvester 矩阵 + Bareiss 无分数消元**：

   ```
   A[i][j] = (A[k][k]·A[i][j] − A[i][k]·A[k][j]) / prevPivot      （多项式精确除法）
   det = A[n−1][n−1]
   ```

   Bareiss 的中间除法在多项式环上仍然整除，因此结果精确。不能整除就说明输入退化，
   明确返回 `null` 而不是返回一条错误的曲线。
3. **所有多项式共享同一套变量表，被消变量位置留 0，绝不删除变量名。**
   指数向量是按位置相加的，一旦某个多项式少了一维，与其他多项式相乘时指数就会错位。
   实测：正是这个原因让"中点轨迹"消元得到 `3/7` 而不是 `−1/3`。
4. **Sylvester 矩阵必须是完整方阵**：每一行 `size` 列。按 `row.map(...)` 生成只会产出
   `row.length` 列（该多项式次数 + 1），矩阵就不是方阵，Bareiss 会在越界处读到 `undefined`。
5. **逐次结式消元会产生增根因子**：先消 u 再消 v，结果可能是真正轨迹方程乘以某些多余因子。
   这是结式法的固有性质（权威做法是 Gröbner 基），因此返回值标注 `extraneous`，
   取零集时不影响正确性，但绘制前最好用 `polynomialEvaluate` 在样本点筛一遍。

隐式方程要画出来还需要等值线化：`sampleImplicitPolynomial` 用 **marching squares**，
每格看四角符号，变号就在边上线性插值出交点；变号 4 次（鞍点）时用单元中心值裁决连接方式，
否则会出现经典的交叉连线瑕疵。

验收测试用**尺度不变**的方式校验（因为零集只定到非零标量倍数）：
`P(1,0)/P(0,0) = −1/3`、`P(2,0)/P(0,0) = 1`、`P(1,0.5) = 0`，
外加 65 个数值采样点全部评到零、以及"沿半径外移 0.25 的点必须评到非零"。

## 7. 接口清单

| 模块 | 主要导出 |
| --- | --- |
| `planar-constraints.ts` | `PlanarConstraint`、`ConstraintProjection`、`linearConstraint` / `segmentConstraint` / `lineConstraint` / `rayConstraint`、`circleConstraint` / `arcConstraint`、`polylineConstraint`、`functionGraphConstraint`、`ellipseConstraint` / `hyperbolaConstraint` / `parabolaConstraint` / `conicConstraint`、`conicCoefficients` / `conicValue` / `conicGradient`、`implicitCurveConstraint` / `implicitConicConstraint`、`projectToImplicitCurve` |
| `dynamic-points.ts` | `DynamicPoint`、`createDynamicPoint`、`beginDrag`、`movePoints`、`traceParameters` |
| `dependency-graph.ts` | `createDependencyGraph`、`createReactiveGraph`、`topologicalLayers` |
| `dynamic-measurements.ts` | `evaluatePlanarMeasurement`、`createMeasurementEngine`、`angleBetween`、`signedPolygonArea`、`polygonPerimeter`、`signedDistanceToLine`、`lengthBetween` |
| `locus-sampling.ts` | `sampleLocus`、`monotoneWarmup` |
| `polynomial.ts` | `rational` / `rationalFromNumber`、`polynomialFromTerms` / `polynomialEvaluate` / `coefficientsIn` / `polynomialDivideExact`、`resultant`、`eliminate` / `implicitize`、`sampleImplicitPolynomial` |

## 8. 集成与验证

### 8.1 场景图：绑定参数改用自然参数

`resolveBoundPoint` 与 `dragBoundPoint` 现在共用同一个工厂 `pathConstraint(path, parameters)`，
**绑定参数就是该约束的自然参数**，不再一律归一化到 `[0, 1]`：

| 曲线 | 绑定参数 |
| --- | --- |
| 直线 / 射线 / 线段 | 仿射比例 t（直线与射线**不截断**） |
| 圆 / 弧 / 椭圆 | 角度 θ（弧度） |
| 折线 | 按弧长归一化的比例 |
| 函数图像 | x 本身 |

**为什么必须改。** 原来的实现在最后一步做 `clamp(t, 0, 1)`，对直线是致命的：
直线在画布上横贯整个视野，但点被锁在 `a..b` 这一段里 —— 用户看到一条长线，
点却只能在中间一小段滑动（实测：`b=(1,0)` 的直线上，点拖到 x=10.5 会被截到 x=1）。
现在正向映射（`evaluate`）与反向映射（`project`）由内核同一份约束定义保证互逆，
"能滑多远"由曲线自己的参数域决定：直线无限、射线半无限、线段与折线有界、
圆与椭圆整周、函数限于它的定义域。

**参数窗口。** 滑块、动画与轨迹扫描需要一个**有限**窗口，由 `parameterWindow(path, parameters)`
给出：有界约束用它的参数域；无界约束（直线 ±2 个 `a→b` 长度、射线 `[0,3]`、
抛物线与双曲线按焦参数/半径取对称窗口）取一个与图形自身尺度成比例的窗口。
注意这个窗口**只决定滑块和轨迹扫多远，拖动本身不受它限制** —— 拖拽直接写参数值，不做区间截断。

**破坏性变更。** `PointBinding.parameter` 的语义变了。直线/线段/射线与折线不受影响
（归一化比例恰好等于自然参数），但**圆、弧、椭圆的旧绑定会移位**
（旧文档里 `parameter: 0.25` 表示"四分之一周"，现在表示 0.25 弧度）。
本地草稿（`draftStorage`）里若有这类绑定，重新绑定一次即可。

**抛物线与双曲线：靠绑定自带的 `domain` 支持。** 它们的自然参数是无界的轴向参数 u，
所以 `PointBinding` 上新增了两个可选字段：

```ts
{ kind: "onPath"; pathId: string; parameterId?: string; parameter: number
  domain?: [number, number]   // 仅无界自然参数的曲线需要：滑块/轨迹的扫描窗口
  branch?: 0 | 1 }            // 双曲线分支，拖动时按它保持不跳支
```

`parameterWindow` 的取值优先级是：曲线自身的参数域（有界曲线）→ 绑定里的 `domain`
→ 与图形尺度成比例的默认窗口（抛物线 `±2|p|`、双曲线 `±2·radiusX`、直线 `±2` 个 `a→b` 长度、射线 `[0,3]`）。
绑定不带 `domain` 也能用（自动回退），属性栏给出「参数域起/止」两个输入框可以随时放宽。
编辑 `domain` 后「路径参数」框和动画滑块会立刻跟着变 —— 两者读同一个窗口，
而不是读驱动参数上那份可能已经过期的 min/max。

双曲线的 `branch` 会一路传到内核的 `project(desired, { previousBranch })`，
所以把点往上拖也不会跳到对面那一支。悬空的 `pathId` 仍是安静的 no-op（不改坐标、不抛错）。

**引用的保护与级联。** 绑定与轨迹都是引用，删除时要区别对待（`patches.ts` 的 `isReferenced`
与 `operations.ts` 的 `deletionTargets`）：

- **删掉动点所在的曲线 → 拒绝**（"object is referenced by another object"）。
  否则会留下悬空的 `pathId`，点静默冻住，用户看不出原因。原实现只覆盖了 `point3` 的绑定，
  二维点被漏掉了；现在补上。
- **删掉被轨迹追踪的点 → 级联删除该轨迹**。轨迹是纯派生对象，只为描述那个点的运动而存在，
  处理方式与导函数跟着源函数走一致。这里不能改成"拒绝"：悬空的 `sourcePointId` 过不了
  `locus` 的 schema 校验，`encodeMgeo` 会抛，等于**整份文档存不下去**。

两条都经由 `commitPatch` → `validatePatch`，而 UI 的唯一写入口 `store.apply` 走的正是 `commitPatch`，
所以不存在绕过校验的路径。

**持久化。** `.mgeo` 保存（`mgeoStorage`）与草稿自动保存（`draftStorage`）都走
`encodeMgeo` / `decodeMgeo`，而 codec 是整份文档的 JSON 直通，所以 `binding`（含 `domain` / `branch`）、
驱动参数与 `locus` 都会原样往返。回归测试不止断言字段还在，还**重新加载后拖一下**
确认约束依然生效（`mgeoStorage.test.ts`）。
（`exporters.ts` 里那条只写 `{x, y}` 的是 SVG/数据导出，不承担存档职责，丢弃约束是有意的。）

### 8.2 视图

`GraphicsView.locusSegments` 改写为调用内核 `sampleLocus`，返回 `Coordinate[][]` 分支数组，
渲染层逐条画 `polyline`。收益：

- 跨渐近线/间断点的轨迹不再画出不存在的竖线；
- 细分容差按"世界坐标下的可视精度"给（约 `1/400` 个视野宽度），
  由 `maxEvaluations = max(samples × 8, 256)` 兜住"整文档重算"的预算。

### 8.3 两个点之间的线段（connection）

"让动点和另一个动点（或曲线上的定点）连成线段"用的是既有的 `ConnectionPrimitive`
（`kind: "segment"` + `startPointId` / `endPointId`），不是 `segment` 图元 ——
后者存的是两个**坐标**，连上去会在点移动时脱节。

创建入口与渲染本来就有（功能区「连接选中点」，`GraphicsView` 从点实时解析端点），
但 `packages/scene-graph` 里完全没有 `connection` 的处理，因此补了三件事：

1. **依赖登记**：`primitiveDependencies` 把 `startPointId` / `endPointId` / `control.thirdPointId`
   算作依赖。没有这一步，端点移动时连接不在受影响集合里，任何下游都看不到它。
2. **解析成真实几何**：`sampledSource` 在求交前把连接解析成 `segment` / `line` / `ray`。
   否则"两个动点之间连的线段"只是一根装饰线 —— 量不了、也交不了。
   抛物线连接用的是二次贝塞尔控制点，不是真正的抛物线，故不在此列。
3. **删除级联**：`deletionTargets` 把引用被删点的连接一并删除。不级联会留下悬空引用，
   而 schema 要求端点必须存在 —— **整份文档会存不下去**（与 8.1 的轨迹是同一个坑）。

顺带把连接移出可拖拽集合（`interaction.ts` 的 `derivedTypes`）：它不含自己的坐标，
"拖这条线段"没有意义，要拖的是端点。此前拖它会被当成 `translatePrimitive` 静默地什么都不做。

连接有一个值得记下的好性质：**它一个坐标都不存，所以永远不会过期**。
测试断言了移动端点后连接图元本身逐字段不变，变化只发生在渲染 / 求交时的解析结果上。

### 8.4 验证证据

```
npm run typecheck                     → 4 个 workspace 全部通过，无 TS 错误
npx vitest run                        → 73 个测试文件、933 个测试全部通过
```

新增测试（193 个 = 142 个内核单元测试 + 4 个场景图集成测试 + 5 个场景图拓扑序测试
+ 6 个平面测量测试 + 4 个平面测量选项/UI 测试）：

| 文件 | 测试数 | 覆盖重点 |
| --- | --- | --- |
| `planar-constraints.test.ts` | 45 | 三种线性约束的截断/残差/切向、退化不产生 NaN、弧端点吸附、折线弧长参数、函数图像陡峭段最近点、椭圆/双曲线/抛物线参数化与 `sampleParabola` 等既有约定的一致性、隐式系数在参数化采样点上取零、拉格朗日投影落回曲线、`DynamicPoint` 全部不变式 |
| `dependency-graph.test.ts` | 27 | 双向边、拓扑序的依赖优先与稳定性、环路径的边方向、脏闭包的序与去重、`ReactiveGraph` 的剪枝/异常隔离/快照隔离、分层 |
| `dynamic-measurements.test.ts` | 30 | 每个 metric 的取值与四种状态、角度不产生 NaN、`-0.00` 不出现、只重算依赖变更的测量、容差抑制噪声与**累积漂移最终上报**、订阅/退订、外部依赖图 |
| `locus-sampling.test.ts` | 15 | 直线不细分、曲率驱动细分并验证弦误差、渐近线分支纯度、跳跃/无定义/空洞切分、求值预算截断、单调预热 |
| `polynomial.test.ts` | 25 | 有理数吸附、多元运算、精确除法、结式的已知值与符号情形、**中点轨迹消元**的尺度不变校验、增根标记、隐式等值线 |
| `scene-store.test.ts`（新增 4 个） | +4 | 椭圆绑定（离心角/旋转/参数表驱动）、无规范参数时保持不动、斜率参数驱动的直线上动点 |

### 8.5 删除：派生对象级联，用户内容仍然受保护

规则是"**纯派生对象随来源一起删除**"，而不是要求用户先手动清干净再删。

`cascadeSources` 定义哪些对象是纯派生的：交点家族（`intersection` / `lineCircleIntersection` /
`circleIntersection` / `curveIntersection` / `intersectionSet`）、轨迹、连接、导函数/切线/积分区域/分析集。
`deletionTargets` 用**固定点迭代**求这个闭包，不能只扫一趟 ——
"点 → 连接 → 连接与圆的交点"这类链条一趟只能收到中间那层。

**边界（有意保留）**：注释、分组、约束、测量、工程标注指向被删对象时**仍然拒绝删除**。
它们是用户自己写下的教学内容，不该因为删一个图形就被默默抹掉。这一点有 5 个既有测试保护，
所以"交点身上挂了个标签"这种情形仍会要求用户先处理标签 —— 这是刻意的取舍，不是遗漏
（我一度放宽成"级联对象身上的附着物自动清理"，被那 5 个测试挡了回来）。

3D 的点-线-面拓扑也不在级联范围内（`line3` 依赖的 `point3` 仍然删不掉），
因为那些顶层拓扑不是"纯派生"的，用户应当明确处理。

### 8.6 测试捕获并修复的缺陷

| 缺陷 | 性质 |
| --- | --- |
| 弧投影对"角度刚过 2π 起点"的点吸附到错误端点 | 算法错误（角度差在 `[0,2π)` 上不可比较） |
| 非有限指针坐标永久破坏点状态 | 健壮性 |
| `linearConstraint.residual` 对线段外的点返回 0 | 语义错误（无限直线 vs 约束集） |
| `hyperbolaConicCoefficients` 的 `axis` 语义搞反 | 数学错误（顶点处 `−72` 而非 `0`） |
| `coefficientsIn` 删掉被消变量导致指数错位 | 数据模型不变式被破坏（消元得 `3/7` 而非 `−1/3`） |
| Sylvester 矩阵行长度不足 | 越界读取 `undefined` |
| `recomputeAll` 把源节点当种子，`compute` 从不执行 | 语义错误 |
| 测量容差以"上次计算值"为基准，漂移永不通知 | 设计错误 |

## 9. 已知限制与后续工作

1. **消元法仍未接入 UI**。依赖图与平面测量都已经进了主流程，但 `resultant` / `eliminate`
   还没有调用方，属于"内核可用、产品未用"。
2. **平面测量复用了 `Measurement3`**（`kind: "measurement3"`）。功能正确，但命名名不副实；
   将来应改成 `measurement` 并加坐标系字段。可用的度量也只有 length / distance / angle / area，
   内核里的 `ratio` / `perimeter` / `radius` / `coordinate` / `signedArea` / `slope` 还没有 UI 入口
   （因为 `Measurement3Metric` 里没有对应项）。
3. **抛物线/双曲线的 `onPath` 绑定**已通过 `PointBinding.domain`（+ `branch`）支持。
   但 `domain` 只决定滑块与轨迹的扫描窗口，**要拖到更远需要手动放宽它**（属性栏的「参数域起/止」）；
   默认给的是与图形尺度成比例的窗口（抛物线 `±2|p|`、双曲线 `±2·radiusX`）。
4. **隐式约束的 `residual` 是一阶估计**，不适合作为精确距离使用；需要精确值请用 `project()`。
5. **结式消元的增根因子**只做标记不做自动剔除；Gröbner 基可以避免，但实现成本高得多。
6. **参数面板不支持清空**「最小/最大/步长」（见 5.4 的已知限制）。
7. **3D 动点**仍是既有 `Point3Binding` 机制（`onLine` / `onPlane` / `derived`），
   尚未接入本套 `PlanarConstraint` / `DynamicPoint` 抽象。约束模型与依赖图都是维度无关的，
   接入主要是补 3D 约束实现。

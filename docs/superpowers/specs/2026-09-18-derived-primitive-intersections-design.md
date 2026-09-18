# 由动点引申出来的图元：成为一等图元（2026-09-18）

> **状态**：**已交付**（2026-09-18，8 个 TDD 切片逐片提交）。设计经用户确认（三处选择：范围 **B**、测量 **A**、"可以"）；逐片 RED→GREEN 证据、一处我自己写错的测试与门禁数字见 `docs/project-progress.md` 的「由动点引申出来的图元：成为一等图元」一节。实施计划：`docs/superpowers/plans/2026-09-18-derived-primitive-intersections.md`。

用户口径（原文，三句）：

1. 「由动点引申出来的图元（如切线，动圆）**也需要能够反映和其他图元的交点**」
2. 「也需要**具有正常图元的基本功能**」
3. 「同时我们把**切线画长一点点**」

## 1. 实测到的现状（探针读数，不是推测）

探针是一次性文件（跑完即删，未进仓库）。

| 现状 | 证据 |
| --- | --- |
| **切线完全不能求交**（不是少，是没有） | 文档里放 直线 / 动圆 / 圆 / 切线，`computeIntersectionPreviews` 枚举出的图元对 = `line-1×circle-1 \| line-1×circle-2 \| circle-1×circle-2`，**切线参与的 = 0 个** |
| **动圆今天已经能求交** | 动圆就是一个普通 `circle`（带 `rotationAbout`）。把动圆绕定点由 0° 转到 90°：圆心 `(4,0) → (2,2)`，`intersectionSet` 的交点跟着从 `x=5.73/2.27` 变成 `x=0.27/3.73` —— **依赖链与重算是通的** |
| **DSL 也拦着** | 用切线当 `intersectionSet` 的来源，`validateDocument` 直接报 `intersection set references invalid objects` |
| 「能求交的类型」有 **5 处副本** | ① `packages/geometry-kernel/src/curve-intersections.ts`（`SampledPrimitive` 联合类型 + `samplePrimitive`）② `apps/web/src/intersectionPreview.ts`（`sampledTypes`）③ `apps/web/src/App.tsx`（`intersectionTypes`）④ `packages/dsl/src/schema.ts`（`sampledTypes`）⑤ `packages/scene-graph/src/operations.ts`（`isSampledPrimitive` + `sampledSource`） |
| **切线长度已有入口** | `TangentPrimitive.halfLength`（检查器可改）；缺省由 `curveTangentHalfLength(source)` 按来源尺度给：圆/弧 `max(r,1)`、椭圆/双曲线 `max(rx,ry,1)`、抛物线 `max(2p,1)`、**函数 = 定义域半宽** |
| **平面测量只认点** | `evaluatePlanarMeasurement` 把 `sourceIds` 逐个过 `CoordinateResolver` 变成**坐标**；`apps/web/src/spatialTools.ts` 的 `planarMeasurementOptions` 要求所选**全是点**（立体那边却接受线/面/体） |
| 已可用、本轮不需要动的 | 切线的点选、样式（颜色/线宽/虚线/透明度）、隐藏、锁定、删除、对象列表、导出、检查器读数 |

**术语**（本文件统一）：**派生图元** = `tangent` / `normal` / `secant` / `derivative` / `integral` / `analysisSet`，以及由动点驱动的 `circle`（动圆）与 `ellipse`。

## 2. 目标 / 非目标

**目标**

1. 切线 / 法线 / 割线 / 导函数 / 积分区域能被其他图元求交（预览、手动创建、持久化交点三条路都要通），并与已有图元一样出现在交点读数里。
2. 平面测量接受"线类"与"圆类"来源：**切线与直线的夹角**、点到直线的距离、**动圆的面积 / 周长 / 半径**。
3. 切线的缺省绘制长度加长（曲线来源），显式 `halfLength` 不受影响。

**非目标**

- `analysisSet` 不进求交名单（见 §3.6，它有理由）。
- 不动工程制图工作区的捕捉与引用（用户选择 A，不含该项）。
- 不引入每类型注册表（YAGNI，见 §3.1 的取舍）。
- 不改求交算法本身：仍是"采样 + 线段求交"，`approximate: true` 的语义不变。

## 3. 设计

### 3.1 唯一真源放在 `@draw/dsl`

依赖方向是 `dsl → geometry-kernel → scene-graph → web`（`packages/dsl` 的 `dependencies` 是空的）。所以真源**必须放 dsl**：`schema.ts` 要用的东西不能来自 kernel（会成环）。

在 `packages/dsl/src/types.ts`（或新建 `sampled-types.ts`）导出：

```ts
export const SAMPLED_PRIMITIVE_TYPES = ["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function", "tangent", "normal", "secant", "derivative", "integral"] as const
export type SampledPrimitiveType = (typeof SAMPLED_PRIMITIVE_TYPES)[number]
export function isSampledPrimitiveType(type: string): type is SampledPrimitiveType
```

内核的 `SampledPrimitive` 改成从这张表**派生**：`Extract<PrimitiveSpec, { type: SampledPrimitiveType }>`；`samplePrimitive` 的 `switch` 加一个 `never` 穷尽性检查 —— 于是"往表里加了类型却忘了写采样"从"运行期悄悄没有交点"变成**编译错误**。这正是本轮缺陷的根因防线。

**取舍**：另两个候选是"只补 5 处副本"（改动最小，但副本继续漂移，这次的缺陷就是这么来的）与"每类型注册表"（最可扩展，但当前只有 3+2 个类型，为它引入注册机制不划算）。选前者式的**单一常量表 + 派生类型**，不引入注册表。

### 3.2 内核采样：每个新类型贡献什么几何

| 类型 | 采样 | 理由 |
| --- | --- | --- |
| `tangent` / `normal` / `secant` | `[[a, b]]`（一条线段） | 它们画出来就是 `a→b` 这条线段；交点落在**看得见的那一段**上，与用户所见一致 |
| `derivative` | `[points]`（折线） | 存的就是采样点（`DerivativePrimitive.points`），与 `polyline` 同类 |
| `integral` | `[points]`（折线，区域的上边界） | 画的曲线就是上边界；填充是装饰，不参与求交 |

**退化规则**：这三个直线类与两个曲线类都带 `status`。`status !== "approximate"`（即 `undefined` / `failed`）时采样返回空 —— 一个算不出来的切线与任何东西都没有交点，不能拿上次的 `a/b` 残值去求交。

### 3.3 五处副本收敛

| 位置 | 改法 |
| --- | --- |
| kernel `curve-intersections.ts` | 类型从 dsl 派生；`samplePrimitive` 补三个新分支 + 穷尽性检查 |
| dsl `schema.ts` | 删掉本地 `sampledTypes`，改用 `isSampledPrimitiveType`（顺带让 `curveIntersection` / `intersectionSet` 接受新来源） |
| scene-graph `operations.ts` | `isSampledPrimitive` / `sampledSource` 改用同一个谓词（持久化交点的重算因此自动覆盖新类型） |
| web `intersectionPreview.ts` | 删掉本地 `sampledTypes`，改用同一个谓词（预览自动覆盖新类型） |
| web `App.tsx` | `intersectionTypes` 改用同一个谓词（手动"由选中对象创建交点"不再漏） |

交点本身的依赖登记（`primitiveDependencies` 里 `objectA`/`objectB`）**已经是通用的**，不需要改。

### 3.4 平面测量改成实体感知

内核新增"可测量实体"与解析器：

```ts
export type MeasurableEntity =
  | { kind: "point"; position: Coordinate }
  | { kind: "line"; a: Coordinate; b: Coordinate }          // 直线 / 线段 / 射线 / 切线 / 法线 / 割线
  | { kind: "circle"; center: Coordinate; radius: number }  // 圆 / 弧 / 动圆
export type EntityResolver = (id: string) => MeasurableEntity | null
```

`evaluatePlanarMeasurement(measurement, resolveEntity)` 保留现有分支（点类度量一字不变），新增组合：

| 度量 | 来源 | 值 | 单位 |
| --- | --- | --- | --- |
| `angle` | 两条线类 | 两个方向的**夹角**（锐角，`[0, π/2]`） | `rad` |
| `distance` | 一个点 + 一条线类 | 点到直线垂距 | `u` |
| `area` | 一个圆类 | `πr²` | `u²` |
| `perimeter` | 一个圆类 | `2πr` | `u` |
| `radius` | 一个圆类 | `r` | `u` |

- **两线夹角取锐角**（`[0, π/2]`）与三点角度的 `[0, π]` 是**两套语义**，选项文案里分别写"夹角（两条线）"与"角度（第二个点作顶点）"，避免用户以为读错了。夹角固定取锐角，因此**不引入新的角度语义字段**（`Measurement3` 现有字段够用）。
- **分派按"度量 × 实体种类"**，不是按来源个数：2 个来源既可能是"两点 → 长度"，也可能是"两线 → 夹角"，所以求值器先看 `metric`、再看每个来源解出来的 `kind`。
- **不给切线提供"长度"**：切线的 `a/b` 是**可视长度**（`halfLength` 决定），不是几何事实；量它只会得到一个由绘制参数决定的假数字。切线的可用度量是"与另一条直线的夹角"与"点到它的距离"。
- **`perimeter` / `radius` 两个度量名要进文档层**：`Measurement3["metric"]` 现在是 `length | distance | angle | area | volume | dihedral`，需要加 `perimeter` 与 `radius`，并同步校验（`schema.ts`）、右侧读数名（`AlgebraView`）、画布文本（`planarMeasurementText`）与标签位置。
- 界面层的选项表（`apps/web/src/spatialTools.ts` 的 `planarMeasurementOptions`）按上表放宽；`resolve` 由 scene-graph 侧提供实体（点 → `position`；线类 → `a/b`；圆类 → `center/radius`），点专用的旧解析器保留为适配器，现有单测不必重写。

### 3.5 切线的默认绘制长度

`curveTangentHalfLength` 的**曲线来源**分支统一乘一个具名系数 `CURVE_TANGENT_LENGTH_FACTOR = 1.5`：

- 圆/弧 `max(r,1)×1.5`、椭圆/双曲线 `max(rx,ry,1)×1.5`、抛物线 `max(2p,1)×1.5`。
- **函数来源不改**：函数切线的半长 = 定义域半宽，乘 1.5 会让切线画出定义域之外，看起来像画错了。
- 显式写了 `halfLength` 的一律照旧（检查器里那个框仍然优先）。

### 3.6 `analysisSet` 为什么排除

`AnalysisSetPrimitive` 存的是 `results: AnalysisResult[]` —— **离散的零点/极值/拐点**，本身没有曲线几何。把它当"曲线求交"的来源，数学上就是"这些点里哪些落在另一条曲线上"，那不是交点的定义。排除并在功能目录里写明理由，避免以后被当成漏做。

## 4. 数据流（一张图）

```
用户画一条曲线 ──► 建切线（tangent，anchor 参数/点）
                         │
        ┌────────────────┴─────────────────┐
        ▼                                  ▼
  预览（web）                        持久化交点（scene-graph）
  isSampledPrimitiveType ─┐          isSampledPrimitiveType ─┐
                          ├─ 同一张表 ─┤                     ├─ 同一张表
  内核 samplePrimitive ◄──┘          schema 校验 ◄───────────┘
        │                                  │
        └──► 采样线段求交 ─────────────────► intersectionSet / curveIntersection
                    │
                    └──► 画布交点标记 ──► 点击创建 ──► 交点成为普通点图元（可测量、可命名）
```

测量的数据流：选中来源 → `planarMeasurementOptions` 给出可用度量 → 写入 `Measurement3` → 重算时 `evaluatePlanarMeasurement` 用实体解析器求值 → 画布数字（`planarMeasurementText` / `planarMeasurementPosition`）。

## 5. 错误与退化

- **来源算不出来**（`status !== "approximate"`）：不采样、不求交，如实没有交点；不显示任何数字。
- **直线退化**（`a === b`、切线方向为零）：采样返回空；测量返回 `degenerate` 并说明原因（沿用现有 `invalid(...)` 文案风格）。
- **圆半径非正**：`area`/`perimeter`/`radius` 返回 `degenerate`，不返回 0。
- **悬空引用**：`insufficient-data`（现有语义）。
- **交点精确性**：仍标 `approximate: true`，与函数图像的求交同一口径，不谎称精确。

## 6. 测试策略（TDD：先红后绿）

1. **dsl**：`isSampledPrimitiveType` 覆盖新类型；`validateDocument` 接受"切线/导函数当交点来源"的文档（**今天必红**：实测报 `references invalid objects`）。
2. **kernel**：`samplePrimitive` 对新类型返回预期几何、`status !== "approximate"` 返回空；`tangent × line`、`normal × circle`、`derivative × line`、`integral × line` 求交得到预期交点；实体感知测量的每个新组合（含两条平行线的夹角 = 0、退化圆 → `degenerate`）。
3. **scene-graph**：持久化 `intersectionSet` 的来源是切线、且切线被**动点驱动**移动时，交点跟着走（沿用现有的"增量 ≡ 全量"性质测试夹具）。
4. **app**：预览枚举包含切线对；`planarMeasurementOptions` 对"切线 + 直线"给出"夹角"、对圆给出面积/周长/半径；`planarMeasurementText` 的单位（`u²` / `u` / `rad`）；切线缺省长度确实变长、显式 `halfLength` 不变。
5. **e2e（浏览器）**：画圆 → 建切线 → 画一条与切线相交的直线 → 画布上出现交点可点击标记 → 点它生成交点图元；选中切线与直线 → 量"夹角" → 画布上出现数字且与属性栏一致。

**门禁**：与仓库既有口径相同（typecheck 4 workspace、`npm test`、lint 0 error、生产构建、Playwright 全量），每片跑完再提交。

## 7. 风险与边界

- **性能**：预览是全文档两两配对（`O(n²)` 对，每对采样求交）。本轮把可求交类型从 10 类扩到 15 类，**图元对数量本身不变**（配对只看"是不是可求交对象"），但新增的"曲线类"会让采样变多。要在实施时按现有方法实测一次（例如 50 图元 / 8 条曲线）并把读数写进进度文档；已有增量机制（`recomputeFor` + `previous`）不受影响。
- **切线求交的范围是"看得见的那一段"**：用户把切线画长一点，交点区间就大一点 —— 这是符合直觉的，但要在功能目录里写明（不是"无限长的直线求交"）。
- **`Measurement3["metric"]` 扩容**会让旧文档的度量名集合变大，但**旧文档逐位不变**（只是允许出现新的度量名）。
- **不改 schemaVersion**：本轮没有破坏性字段变化。

## 8. 兼容性

- 旧文档：可以打开、可以保存，行为不变（`analysisSet` 仍不可求交、函数来源切线长度不变）。
- 已有测试：`SampledPrimitive` 从"手写联合"变成"派生联合"，成员集合**只增不减**，现有断言不受影响；新增成员会让 `samplePrimitive` 的穷尽性检查在漏写时编译失败 —— 这是有意的。

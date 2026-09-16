# 截面 / 截线图元交互设计（Slice C）

**日期：** 2026-09-16
**状态：** 设计待实现
**用户原话：** 「立体几何的模块，我希望能够获取截面，截线图元，就像平面板块获取交点图元一样，当相交时，会显示虚线的截面和截线，点击获取图元」

## 1. 目标与非目标

**目标**：把"截面 / 截线"从"必须先手动点创建"的命令，变成**看得见、点得到**的图元，与平面板块的交点心智模型一致：

1. 当两个空间对象**相交**时，画布上直接出现**虚线预览**（截面多边形 / 截线），不需要先点命令。
2. 悬停预览对象时高亮并给出说明（这是哪两个对象的什么交、当前是线交还是多边形交）。
3. **点击即创建**持久化图元（进入文档、可撤销、随来源重算），与平面点击交点保存为 `intersection` 图元一致。

**非目标（本切片不做）**：

- 不做布尔运算（并/差/交实体）——只做"交线/截面"的几何提取。
- 不做面上的真实裁剪渲染（不把实体切开显示内部），只画交线/截面。
- 不引入 CSG 依赖；沿用现有 `sections3d` 的平面—面环求交算法。

## 2. 现状盘点（已实现，可复用）

| 能力 | 位置 | 复用方式 |
| --- | --- | --- |
| 平面与面环求交、边界串联、分类（none/point/segment/polygon/insufficient-data） | `packages/geometry-kernel/src/sections3d.ts` | 直接调用，不重写 |
| `section` 图元（来源实体 + 平面、点集、分类、状态） | `packages/dsl` types/schema | 复用其字段与校验 |
| 默认剖切平面穿过来源包围盒中心 | `sectionPlaneThroughSource` | 作为"任意两实体相交"的候选平面之一 |
| 3D 拾取（点 > 棱 > 面 > 线 > 实体，Alt 保留子元素） | `threeScene.tsx` `pickRaycastHit3` / `resolveSelectableHit` | 预览对象的拾取沿用同一优先级 |
| 截面渲染（半透明填充 + 有序边界线） | `threeScene.tsx` `createSectionMesh` | 预览复用同款渲染，改虚线 + 低不透明度 |
| 来源删除保护、随来源重算 | `scene-graph` operations | `section` 已有；新增图元沿用 |
| 平面交点：悬停预览 → 点击持久化 | `GraphicsView` + `intersectionPreview` | 交互范式模板 |

**已确认的缺口**（需要在实现中补齐）：

- 没有"面与面相交"的**独立**内核入口：现在只有"平面与实体"求交。两个 `face3` 之间的交线、或者一个 `face3` 与另一个实体的交线，都需要先确定一个**承载平面**。
- 没有"预览即派生"的渲染层：现在的 `section` 只能由命令创建。
- 拾取结果里没有"交集预览"这个概念（`IntersectionPreview` 只存在于平面）。

## 3. 交互设计

### 3.1 什么算"相交"，以及预览什么

| 选中/悬停情况 | 预览内容 | 说明文案 |
| --- | --- | --- |
| 已选中一个实体/多面体（`cube`/`pyramid`/`cylinder`/`cone`/`polyhedron3`） | 现有行为：默认剖切平面（穿过包围盒中心）与它的截面，**虚线段**（点交为点） | 「默认剖切平面截面 · 多边形，N 条边」 |
| 已选中两个空间对象且都含面环（实体×实体、面×实体、面×面） | 两者**面环之间**的公共交线（逐面求交、去重、串联） | 「面交线 · N 段（来源 A 与 B）」 |
| 悬停到某条已存在的预览交线/截面上 | 高亮该对象 + 文案 | 「点击创建为图元」 |
| 只有面、且两面共面 | 不预览（共面重叠不是交线） | 悬停说明「两面共面，没有确定的交线」 |

**关键取舍：不为"任意两实体"猜一个剖切平面。** 两个实体相交时，它们的真实交线来自**面环求交**（A 的每个面 × B 的每个面 → 线段集合 → 去重串联），而不是"随便切一刀"。只有当用户选中**单个**实体时才使用"默认剖切平面"（这是已有的、教学上合理的语义）。

### 3.2 新建图元类型 vs 复用 `section`

**决定：新增 `intersectionLine`（截线）图元，其余复用 `section`。**

- `section` 已经有"来源 + 平面 + 点集 + 分类 + 状态"，语义是"一个平面切一个实体"，不该被塞进"两面交线"。
- 截线需要：`sourceIds: [string, string]`（两个来源）、`segments: [{a, b}]`、`status`。字段小、语义清晰、可校验、可往返。
- `schemaVersion` 保持 `"0.1"`：新图元类型是**可选**的，旧文件不受影响；未知类型在旧版本里只会被忽略（与既有做法一致）。

### 3.3 交互流程（与平面交点一致）

```
悬停（未选中任何东西）
  → 若指针下有可交的两个对象（面环相交）→ 计算交线 → 画虚线预览 + 文案
  → 点击 → apply({ op: "addPrimitive", primitive: { type: "intersectionLine", … } })
  → 新图元进入文档、可撤销、随来源重算；预览消失（它已经实体化）

选中一个实体
  → 画默认剖切平面截面预览（虚线）
  → 点击预览 → 创建 section（与现有「创建截面」命令等价，但更直接）
```

**与现有命令的关系**：保留工具栏「创建截面」入口（键盘/明确路径），预览点击只是同一操作的快捷方式。两者走同一个 `addSection`。

## 4. 内核设计（`packages/geometry-kernel`）

新增到 `sections3d.ts`（或新建 `intersections3d.ts`，倾向后者以免 sections3d 继续膨胀）：

```ts
export interface Segment3 { a: Vector3; b: Vector3 }

/**
 * 两个面环之间的交线。逐面求交（面 i × 面 j 当且仅当两面的支撑平面不平行），
 * 得到线段集合后按端点容差去重（同一交线会被两个相邻面各算一次），再按共线合并。
 * 共面面环返回空数组（不是零长度线段）。
 */
export function intersectFaceSets(a: Vector3[][], b: Vector3[][]): Segment3[]

/** 实体的可见面环；模板实体取生成的 polyhedron，点驱动取 face3 引用的点。 */
export function faceRingsOf(document: GeometryDocument, id: string): Vector3[][]

/** 组装预览：两个来源 → 交线段；无交返回空。 */
export function resolveIntersectionPreview(document: GeometryDocument, sourceIds: [string, string]): {
  segments: Segment3[]
  classification: "none" | "segment" | "polyline"
  /** 面共面、来源缺面、退化输入等，都给出可读原因而不是空数组。 */
  diagnostics: string[]
}
```

**数值要求**（沿用既有数值策略）：平行判定用尺度化容差 `numeric.ts` 的现有工具；端点去重用 `1e-6 × 尺度`；共线合并只在方向夹角 < 1e-6 rad 时进行；所有输出必须是有限值，否则返回空 + 诊断。

## 5. Slave 层与文档层

- `packages/dsl`：新增 `IntersectionLinePrimitive`：

  ```ts
  interface IntersectionLinePrimitive {
    id: string
    type: "intersectionLine"
    sourceIds: [string, string]
    segments: Segment3[]          // 随来源重算
    status: "valid" | "degenerate" | "insufficient-data"
    label?: string
    visible?: boolean
    locked?: boolean
    style?: PrimitiveStyle
  }
  ```

  校验：`sourceIds` 恰好两个、存在且不是自己；`segments` 每段端点有限；`status` 合法。
- `packages/scene-graph`：`addPrimitive` 覆盖新类型；重算时若来源是它引用的两个对象则重算 `segments`；来源删除保护（`isReferenced` 已按 sourceIds 通用处理，需确认覆盖新字段名）。
- `apps/web/src/threeScene.tsx`：预览层与实体图元都用**虚线**渲染（`LineDashedMaterial` + `computeLineDistances`），预览用低不透明度 + 强调色，实体图元用用户样式；`data-section-preview` / `data-intersection-line` 供 e2e 断言。
- `apps/web/src/components/PropertiesBar.tsx`：选中截线后显示来源、段数、状态、诊断；沿用现有卡片风格。
- `AlgebraView`：截线作为普通图元行（已有通用渲染），标签形如「截线 1」。

## 6. 切片与验收门槛

按可独立验证的顺序实现，每片完成后跑门禁并提交：

| 片 | 内容 | 验收 |
| --- | --- | --- |
| C1 | 内核 `intersectFaceSets` / `faceRingsOf` / `resolveIntersectionPreview` + 单测 | 相交立方体、共面面、平行面、退化输入、去重与共线合并；RED→GREEN |
| C2 | DSL `intersectionLine` 类型 + schema 校验 + codec 往返 + Scene Graph 重算与删除保护 | codec/schema/operations 单测；旧文档不受影响 |
| C3 | 画布**虚线预览** + 悬停高亮 + 文案（未选中时的自动预览） | `threeScene.test.ts` + e2e：真实浏览器里悬停出现 `[data-section-preview]` |
| C4 | **点击创建**：预览 → 持久化图元 + 撤销/重做 + 属性面板 | e2e：点击后图元出现在代数区、revision 增加、可撤销；属性面板显示来源 |
| C5 | 文档与进度记录 | README / feature-catalog / project-progress 更新 |

**每片的门槛**：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run lint`（0 error）、`npm.cmd run build`、`npm.cmd run test:e2e`、`git diff --check`。

## 7. 风险与已知边界

- **圆柱/圆锥的面环是 24 边形近似**：交线是折线而非解析椭圆弧。界面必须说明"近似"，不能假装精确（沿用测量里 `numeric-approximation` 的做法）。
- **共面面环**（两个 `face3` 完全共面）没有唯一交线：必须明确报"共面"而不是画一条任意线。
- **预览成本**：逐面求交是 O(面数²)，模板实体 6×6=36、圆柱 24×24=576。预览只在**选中两个对象后**计算，并按 `revision + 选择` 缓存，不会每帧重算。
- **点击与选中的冲突**：预览对象是派生渲染，点击应"创建图元"而不是"选中来源"。这与平面 "创建进行中点击图元 = 落点" 的既有取舍一致，需在实现时用同一套优先级（预览对象优先于其来源）。

## 8. 待确认（实现前需要你拍板）

1. **预览触发条件**：是"选中两个对象后自动出现"（我倾向这个，干扰最小），还是"悬停即预览任意可交对象"（更主动，但画布上可能频繁闪现代码）？
2. **两个实体相交时**：只画**面交线**（真实交线，我的建议），还是也允许"默认剖切平面"当作一条可选预览？
3. **截线图元是否独立类型**：我建议新增 `intersectionLine`；如果你希望**零新增类型**，备选是把交线存成 `section`（那会牺牲语义，`section` 会被用来表示两种不同的东西）。

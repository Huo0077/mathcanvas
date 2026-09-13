# 动态数学绘图平台设计规格

**日期：** 2026-09-13  
**状态：** 待用户审阅  
**关联调研：** [`docs/research/graphing-tools.md`](../../research/graphing-tools.md)  
**目标版本：** Geometry DSL `0.2`，兼容读取 `0.1`

## 1. 目标与非目标

本规格把函数预设、复合表达式、点和标注、动点和轨迹、连接关系、交点集合、动画控制和特异化属性栏统一到现有 DSL、Geometry Kernel 与 Scene Graph 中。

本阶段不实现完整计算机代数系统、任意用户脚本、隐式曲线的通用符号求解、三维图形或 GeoGebra 级别的全量工具集。采样曲线的结果必须明确标记为数值近似。

## 2. 设计原则

- **关系优先。** 只要用户创建的是“点之间的连接”或“点在路径上”，文档保存引用关系，不保存一次性的屏幕坐标作为唯一真相。
- **纯几何内核。** 坐标变换、投影、采样、交点和特征计算由 `packages/geometry-kernel` 提供，React 组件不复制算法。
- **渐进式属性栏。** 先显示当前图元最重要的少量属性；高级特征、采样、动画和样式通过折叠区展开。
- **可解释反馈。** 输入错误、数值近似、无定义域、无交点、退化几何和约束冲突都显示原因和恢复建议。
- **可访问交互。** 每个输入有可见标签，键盘和按钮可以替代拖拽，焦点环保持可见，动画服从 `prefers-reduced-motion`。

## 3. 函数系统

### 3.1 表达式能力

函数对象继续保存 `expression`、`domain` 和 `samples`，但表达式管线拆为：

```ts
compileExpression(source: string): CompiledExpression
evaluateCompiledExpression(compiled: CompiledExpression, variables: Record<string, number>): number
sampleFunction(compiled: CompiledExpression, domain: [number, number], samples: number): SampledSegment[]
```

编译阶段只允许数学 DSL 的 token，不执行 JavaScript。预设和手写表达式共享同一编译器、缓存和错误模型。

第一批函数包括：

- 常量：`pi`、`e`；
- 基本运算：加、减、乘、除、幂和括号；
- 初等函数：`abs`、`sqrt`、`exp`、`log`、`log10`；
- 三角函数：`sin`、`cos`、`tan`；
- 反三角函数：`asin`、`acos`、`atan`；
- 双曲函数：`sinh`、`cosh`、`tanh`。

复合函数通过嵌套调用和普通运算表达，例如 `exp(-x^2) * cos(2*x)`。参数环境可解析 `a*sin(b*x+c)+d`，但参数必须来自已声明的 `ParameterSpec`，不能隐式创建全局变量。

### 3.2 预设目录

预设是 UI 元数据，不是另一种数学求值实现：

```ts
interface FunctionPreset {
  id: string
  label: string
  expression: string
  category: "basic" | "exponential" | "logarithmic" | "trigonometric" | "hyperbolic" | "composite"
  defaultDomain: [number, number]
  helperText: string
}
```

属性栏提供分类、搜索、预览和“应用预设”操作。应用后仍允许编辑表达式。预设列表的键盘导航、当前项状态和错误提示使用语义化表单控件。

### 3.3 采样和错误

采样器遇到 `NaN`、无穷值或超出可视范围的值时结束当前线段并开始新线段，不能跨越渐近线连线。错误分为：解析错误、未知函数、缺少变量、定义域无效和采样失败。属性栏在输入下方显示 inline validation，同时保留上一次合法渲染，避免输入一个字符时图像消失。

## 4. 点、路径和动点

### 4.1 点绑定

点保留自由坐标兼容性，并增加可选绑定：

```ts
type PointBinding =
  | { kind: "free" }
  | { kind: "onPath"; pathId: string; parameterId?: string; parameter: number }
  | { kind: "derived"; sourceId: string; feature: string }
```

- `free` 点直接编辑 `x/y`。
- `onPath` 点由路径参数驱动；路径参数可以绑定滑块，也可以使用点自身的归一化参数。
- `derived` 点由图元特征生成，例如椭圆焦点、抛物线顶点或双曲线渐近线上的特征点；用户不能直接改写其坐标。

动点面板显示路径名称、参数当前值、范围和吸附步长。拖拽路径时更新参数，键盘方向键和数值输入提供等价操作。

### 4.2 标点和标注

点的 `label` 用于 A/B/C/D 等短标签；更长文本和特征说明使用独立 `AnnotationSpec`：

```ts
interface AnnotationSpec {
  id: string
  text: string
  anchor:
    | { kind: "coordinate"; x: number; y: number }
    | { kind: "primitiveFeature"; primitiveId: string; feature: string }
    | { kind: "point"; pointId: string }
  offset?: { x: number; y: number }
  visible?: boolean
}
```

“标记特征”操作根据图元类型提供不同候选：圆心/半径端点，椭圆中心/顶点/焦点，双曲线中心/顶点/焦点/渐近线，抛物线顶点/焦点/准线，函数上的指定点、切线和截距。标注锚点跟随来源变化，不复制静态坐标。

### 4.3 轨迹

轨迹是独立的派生图元：

```ts
interface LocusPrimitive {
  id: string
  type: "locus"
  sourcePointId: string
  parameterId: string
  domain: [number, number]
  samples: number
}
```

轨迹生成器在参数域采样，每段保存连续有限点；轨迹支持显隐、清除和重新采样，不反向修改动点或路径。

## 5. 点连接和曲线连接

### 5.1 引用关系

新增连接图元用于表达“通过点创建”的语义：

```ts
interface ConnectionPrimitive extends PrimitivePresentation {
  id: string
  type: "connection"
  kind: "segment" | "line" | "ray" | "polyline" | "parabola"
  startPointId: string
  endPointId: string
  control?: {
    vertex?: { x: number; y: number }
    axis?: "x" | "y"
    focalParameter?: number
    thirdPointId?: string
  }
}
```

已有静态 `segment`、`line`、`ray` 和 `polyline` 继续兼容；新连接图元在 Scene Graph 重算成渲染所需几何。点被移动、锁定或删除时，依赖检查提供可解释错误。

### 5.2 抛物线约束

两个点只能确定无穷多条抛物线，因此创建 `kind: "parabola"` 时必须满足下列至少一项：

- 给出顶点、轴向和焦参数；
- 给出顶点、轴向和第三点；
- 给出三个不共线且能唯一确定所选模型的点，并由向导显示解的假设。

如果信息不足，创建操作被拒绝并在属性栏说明“还需要顶点、焦参数、轴向或第三点”，不能自动猜测旋转或焦参数。

## 6. 交点集合

交点对象保存来源引用和解选择，而不是只保存一个孤立坐标：

```ts
interface IntersectionSetPrimitive extends PrimitivePresentation {
  id: string
  type: "intersectionSet"
  objectA: string
  objectB: string
  points: Array<{ x: number; y: number; kind: "point" | "tangent" | "approximate" }>
  selectedIndex?: number
}
```

内核结果继续区分 `none`、`point`、`tangent`、`points`、`coincident` 和 `degenerate`。属性栏显示来源、交点数量、每个交点坐标、精确/近似状态和“在画布中标记全部”按钮。无交点和重合对象是有效状态，不产生错误坐标；退化输入才回滚操作。

旧的 `intersection`、`lineCircleIntersection`、`circleIntersection` 和 `curveIntersection` 作为兼容读取格式保留，迁移后可以由集合视图展示。

## 7. 动态演变

### 7.1 参数与会话

持久化的参数继续使用 `ParameterSpec` 的值、最小值、最大值和步长。播放期间使用临时会话：

```ts
interface AnimationSession {
  parameterId: string
  value: number
  direction: 1 | -1
  mode: "loop" | "once" | "pingPong"
  playing: boolean
  speed: number
}
```

播放、暂停、停止、速度、循环模式和当前值都在动态工具条中可见。帧内只更新会话和派生渲染，不写入 undo history；暂停或停止时按一次操作提交最终参数。多个参数同时播放时共享一个 animation clock，但每个参数保留自己的方向和边界。

### 7.2 可访问和减弱动画

`prefers-reduced-motion: reduce` 时默认不自动播放，仍允许用户按步前进。播放按钮必须有文本标签和 `aria-pressed`/`aria-label`，暂停后保留当前参数和轨迹状态。

## 8. 特异化属性栏

属性栏分为公共区和图元区：

- 公共区：名称、可见性、锁定、描边、填充、线宽、透明度、线形和删除。
- 点：坐标、标签、绑定来源、标记特征。
- 线：端点、斜率、方向角、截距、斜率参数和连接引用。
- 圆/圆弧：圆心、半径、周长/面积或圆心角/弧长。
- 椭圆：中心、长短半轴、旋转角、焦点、离心率、面积和顶点。
- 双曲线：中心、轴向、半轴、旋转角、焦点、离心率、顶点和渐近线。
- 抛物线：顶点、轴向、焦参数、焦点、准线和旋转角。
- 函数：预设、表达式、定义域、采样数、值域、断点、导数/切线/积分工具。
- 交点/轨迹：来源、数量、解索引、近似状态、采样范围和重算按钮。

高级区默认折叠，但不能隐藏当前图元的关键属性。所有输入有可见 label、合法范围、错误消息和键盘操作；拖动端点时显示吸附、约束和当前坐标。

## 9. DSL、迁移和兼容性

当前 `schemaVersion: "0.1"` 文件继续可读。`0.2` 迁移规则如下：

1. 缺少新数组或字段时使用空数组、`visible: true` 和 `binding: { kind: "free" }` 的默认值。
2. 旧静态点、线段和线保持原语义，不根据相同坐标猜测点引用。
3. 旧动态 `slider`/`locus` 记录映射到新的参数与轨迹模型；无法解析的引用保留为不可见并报告迁移警告。
4. 旧交点对象转换为单项 `IntersectionSetPrimitive` 视图时保留原 ID、来源和解索引。
5. 迁移先校验、再写入新 revision；失败时返回原文档和可定位错误，不产生半迁移文件。
6. 保存时只写当前受支持版本；导入时拒绝未知的必需字段，忽略未来版本的可选展示字段并给出提示。

迁移测试覆盖 `0.1 -> 0.2`、重复 ID、丢失引用、非法表达式、退化抛物线连接和不可见交点。

## 10. 测试策略

- DSL：类型、schema、codec、迁移和 round-trip 测试。
- Geometry Kernel：函数解析/复合求值、采样断点、路径参数、特征点、旋转和交点集合测试。
- Scene Graph：引用传播、局部重算、删除保护、事务回滚、动画提交不污染历史。
- UI：优先 `getByRole`、`getByLabelText` 和可见文本；覆盖每种图元的特异化属性栏、错误反馈、键盘替代、拖拽更新和预设应用。
- E2E：函数预设到图像、A/B 点到连接线、动点到轨迹、交点列表、动画播放/暂停/停止、保存恢复和减少动画模式。
- 性能：函数采样缓存、轨迹重新采样、1000 个图元下的局部重算和动画帧预算。

实现阶段继续遵循 TDD：先添加失败测试，再更新 DSL、内核、Scene Graph 和 UI；每个可验证切片完成后运行单元测试、类型检查、构建和相关 Playwright 检查。

## 11. 验收标准

- 用户可以从属性栏选择常见函数预设，也可以输入并验证复合函数。
- 用户可以创建 A/B/C/D 点、给点标注、将点绑定到路径并生成轨迹。
- 用户通过点引用创建线段、直线、射线和满足额外约束的抛物线连接；移动点后连接实时更新。
- 用户可以查看交点集合和每个交点位置，并区分无交点、相切、近似和退化状态。
- 右侧栏随选中图元切换，显示该图元的关键数学属性和可编辑字段。
- 动画有播放、暂停、停止、循环/单次/往返控制，且不会逐帧污染撤销历史。
- `.mgeo` 能兼容读取现有 `0.1` 文件，并能通过迁移测试保存为新版本。

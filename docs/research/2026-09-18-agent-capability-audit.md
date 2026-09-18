# MathCanvas：Agent 设计前全功能审阅

日期：2026-09-18。实际仓库：`D:\draw\draw`。

## 1. 结论与证据边界

本次先审阅产品功能、DSL、几何内核、Scene Graph、工作台调用链和现有测试，不实施修复、不提前确定 Agent 工具设计。

核对到 **42 种图元、38 种领域操作、8 种测量指标、8 种约束类型**。覆盖平面几何、函数分析、立体几何、工程制图，以及选择、样式、图层、文件、历史和视图交互。仅开放 `addPrimitive` 或给模型一份 DSL，不能覆盖产品全部能力。

当前 Agent 是本地演示回复，并未接入真实模型、几何执行、预览提交和桌面代理。因此，本报告建立的是后续必须满足的能力覆盖基线，不能证明尚未实现的 Agent 已经熟练使用产品。

审阅开始的 HEAD 是 `d350c2a`；收尾时观察到 HEAD 已变为 `f57b814`，此前用户的测量形式识别等改动已进入提交。未覆盖、回退或修改这些实现。测试结果对应本次运行时的工作区，不是两个提交间的完整回归比较。

### 本次实际验证

| 验证 | 实际结果 | 能说明什么 |
| --- | --- | --- |
| `npm.cmd test -- --reporter=dot` | 134 个测试文件、1567 个测试通过，退出码 0 | 当前 Vitest 测试集通过 |
| `npm.cmd run typecheck` | 四个 workspace 均通过，退出码 0 | 当前 TS 类型检查通过 |
| 当前源码的 Vite SSR 最小诊断 | 未知操作、批量删除、投影来源问题得到复现 | 已有测试之外存在接入风险 |
| 测试源文件清点 | 167 个 `.test.ts/.test.tsx/.spec.ts` 文件 | 包括 e2e 源文件，不等于本次执行文件数 |

单元测试环境输出了 jsdom 不支持 canvas/WebGL 的警告，但测试退出码为 0。**不据此宣称真实 3D 渲染正确**。本次没有执行浏览器 e2e、像素检查、原生安装包测试或真实供应商 API 测试；也没有运行完整 build/lint。

审阅使用 `agent-architecture-audit` 检查层间边界，使用 `agent-harness-construction` 约束能力、前置条件与真实结果观察；发现异常后按 `systematic-debugging` 先做最小复现，并按 `verification-before-completion` 区分证据与推断。

## 2. 接入前必须处理的问题

这里的优先级针对后续接入不可信模型输出，不表示当前已联网的 Agent 存在攻击事件。

### P1：未知操作被接受，并报告 changed

入口：`packages/scene-graph/src/patches.ts:172`、`:540`，`packages/scene-graph/src/operations.ts:2082`。

最小复现：向空 CAD 文档提交 `{ op: "not-a-domain-operation" }`。

- `validatePatch` 返回 `{ valid: true }`。
- `commitPatch` 返回 `changed: true`，revision 增加 1。
- 原因：校验由多个已知操作分支组成，末尾没有拒绝未知操作；执行末尾仍进入重算/修订更新。

现有 TypeScript 类型只约束可信编译期调用，不能替代模型 JSON 的运行时校验。后续接入门槛：严格判别联合 schema、未知字段策略、数值/大小预算、操作白名单、执行前后真实差异检查；不能以 revision 增长作为绘图成功证据。

### P1：批量删除预校验与实际提交不一致

入口：`packages/scene-graph/src/patches.ts:161`，`apps/web/src/App.tsx:1191`。

最小场景：空间点 `a`、`b`，引用这两个点的空间直线 `line`；选择顺序为 `[line, b, a]`。

- `validateDeletion(document, ids)` 按并集校验，通过。
- 按 App 的反向循环逐项调用 `deleteObject`：点 a、b 被引用保护拒绝，line 删除成功。
- 最终 a、b 留下：用户要求的批量删除只部分完成。

已有 `deletion-cascade.test.ts` 验证了并集预校验，未证明 App 循环执行原子性。接入门槛：删除计划和执行采用相同对象集合；混合操作支持全有或全无、一次撤销，不依赖模型猜测删除顺序。

### P1：跨工作区投影显示与导出来源不一致

入口：`apps/web/src/components/EngineeringDrawingView.tsx:35`，`apps/web/src/App.tsx:241`、`:260`。

- 屏幕投影可选择立体几何文档，但导出数组由当前 CAD 文档计算。
- 最小场景：空 CAD 图纸 + 含一个 point3 的立体几何文档。显示来源包含 1 个图元，App 导出计算来源包含 0 个。
- `projectedDrawingForView` 目前只按视图 kind 投影，没有使用 `view.sourceIds` 做过滤；不能承诺文档中的来源过滤已完整实现。
- 投影选择/工程标注仍存在绑定当前 CAD 文档的调用链；跨文档重名 ID 可能导致错误路由。这一项是源码集成风险，未作为已复现的选错对象缺陷报告。

接入门槛：观察、选择、标注、诊断、预览与导出共用显式来源上下文；显示适配与持久化图纸版式分开，不承诺当前导出完全复刻屏幕图纸。

### P2：导出和投影并不覆盖全部可显示图元

入口：`apps/web/src/persistence/exporters.ts:58`，`apps/web/src/projectionVisuals.ts:200`，`apps/web/src/projectionSource.ts:6`。

- 平面 SVG 对 connection、locus、intersectionSet 返回空内容；analysisSet 也没有对应导出图形。普通 SVG 不包含测量标注层。这是源码可见的输出覆盖限制，不能对用户称完整画布导出。
- 平面 SVG 使用默认固定世界范围，而不是 GraphicsView 当前平移/缩放范围；点标记样式也不等于画布全部展示样式。
- CAD 当前直接输出 point3、edge3、face3、circle3；polyhedron3 主要通过独立棱/面拓扑呈现。line3、segment3、ray3、plane3、section 等并没有在该输出循环中直接投影。
- 未物化的模板产生诊断；只有一个带引用的 polyhedron3 也不等于自动生成全部投影线面。
- 空来源谓词遗漏 circle3，却包含若干当前未直接投影的类型：不能仅凭 `hasProjectableGeometry` 判断最终输出有内容。
- PDF 使用 Helvetica/WinAnsi，中文及部分数学字符替换为 `?`；PDF 是每视图一页，不是当前图纸版式的完整印刷输出。

接入门槛：导出前返回支持/遗漏清单和实际几何数量；中文字体与完整图纸输出属于需要明确排期的能力，不可隐藏损失。

### P2：高级流程缺少统一、可验证执行入口

入口：`apps/web/src/App.tsx:665`、`:798`、`:850`、`:1165`，`apps/web/src/components/PropertiesBar.tsx:567`，`apps/web/src/store.ts:65`。

- 模板创建、宿主绑定、截面物化、绕定点旋转等流程包含多步语义，部分位于组件闭包。
- `addPrimitives` 只原子添加图元，不是参数 + 图元 + 标注 + 测量的通用事务。
- 绕定点旋转等当前流程存在多次独立提交；绑定动点也可能先建参数再改绑定。
- `store.apply` 返回 void，没有结构化成功/失败结果；目前没有基于预览 revision 的过期提交拒绝契约。
- 相机、透明面、展开、捕捉、投影来源等状态散落在组件本地状态，不能仅用 DomainOperation 调用。

接入门槛：先提炼和测试现有产品语义，不让模型绕过产品逻辑自己拼半成品。

### P2：当前 Agent 对话只是演示，不能当作真实运行时复用

入口：`apps/web/src/components/agent/AgentWorkspace.tsx:45`，`apps/web/src/agentStore.ts:125`。

- 回复来自 `composeDemoReply`；effect 取会话中第一个 user 消息，而不是本次请求消息。
- `pendingReplyId` 为全局单值，尚无真实请求 ID、取消、会话/工作区归属与模型重试生命周期。
- 真实模型接入需要独立验证会话切换、卸载、取消、迟到回复和重复请求；不是只替换演示回复函数。

## 3. 图元能力矩阵：42/42 类型清点

标记：UI = 当前有产品入口或交互流程；派生 = 来源与参数生成，计算字段不能由模型伪造；DSL = 文档/领域/内核存在，不等于专用 UI 可用；兼容 = 旧文件读写保留，不开放新建。

权威类型入口：`packages/dsl/src/types.ts:781`。所有新增/修改还要经过当前文档校验和重算，不以本表代替 schema。

| 图元 | 当前入口/地位 | 必须掌握的语义与限制 |
| --- | --- | --- |
| `point` | UI | 自由/路径/派生绑定；绑定参数而非坐标是编辑真值 |
| `point3` | UI | 世界坐标及多种宿主绑定；解绑保留位置 |
| `line3` | UI + DSL | 点驱动定义；两个点不能重合；依赖保护 |
| `segment3` | DSL | 点引用、有限范围；无单独 Ribbon 创建入口 |
| `ray3` | DSL | 起点/经过点、半无限范围；无单独 Ribbon 创建入口 |
| `plane3` | UI + DSL | 三点不共线或定义形式；显示面片不是无限平面本身 |
| `circle3` | UI | 圆心/法向/半径独立存储；选三点创建不是三点外接圆 |
| `edge3` | 模板/物化 + DSL | 点引用、面关联；不能与 line3 互换 |
| `face3` | UI/物化 + DSL | 有序共面闭合边界、非退化；孔/多环按类型与结果检查 |
| `polyhedron3` | 模板 + DSL/内核 | 顶点/棱/面引用；合法封闭拓扑，内核还支持 prism/frustum/fromPoints |
| `line` | UI | 无限直线；端点是定义，不是长度 |
| `segment` | UI | 有限两端点；长度与编辑语义明确 |
| `ray` | UI | 起点和方向，不是直线或线段 |
| `polyline` | UI | 有序顶点；创建双击结束，offset 为斜接规则 |
| `connection` | UI 高级流程 | 引用两个点，直连/控制曲线；普通 SVG 当前遗漏 |
| `locus` | UI 高级流程、派生 | 绑定源点 + 参数窗口采样；不是任意手画曲线 |
| `parabola` | UI | 顶点、焦参数、方向、旋转；注意软件焦参数约定 |
| `ellipse` | UI | 两个半轴、中心、旋转；SVG 可用真 ellipse |
| `hyperbola` | UI | 两支、轴向与参数；不能把不同支连起来 |
| `function` | UI | 安全表达式、定义域、采样；不连续必须分段 |
| `derivative` | UI 高级流程、派生 | 一/二阶数值导数，非符号推导；无定义状态不可隐去 |
| `tangent` | UI 高级流程、派生 | 函数 x 定位或曲线 anchor；参数/点引用不能混用 |
| `normal` | DSL/内核、派生 | 与切线共用来源规则；不能声称所有法线已有专用 UI |
| `secant` | DSL/内核、派生 | 两个计算位置、退化/垂直状态 |
| `integral` | UI 高级流程、派生 | 数值积分与区域；signed area 与几何面积要区分 |
| `analysisSet` | DSL/内核、派生 | 数值零点/极值/拐点及诊断，不是精确证明 |
| `cube` | UI 模板 | origin/size/rotation；创建同时物化关联拓扑 |
| `pyramid` | UI 模板 | 基底中心/尺寸/高度/旋转，Z 朝上 |
| `cylinder` | UI 模板 | 圆柱参数 + 细分；默认 48、最多 256 段 |
| `cone` | UI 模板 | 圆锥参数 + 细分；侧面绑定与基底需区分 |
| `section` | UI、派生 | 平面与来源实体相交，可空/点/线/多环；物化后独立 |
| `intersectionLine` | UI 相交预览持久化、派生 | 多段结果、sourceIds 和真实状态 |
| `intersectionSolid` | 兼容 | 历史 Boolean 结果保留读取/渲染，不开放新建 |
| `intersectionFace` | UI 相交预览持久化、派生 | 环、孔、hint、面积/近似边界不能丢 |
| `intersectionPoint3` | UI 相交预览持久化、派生 | 来源/hint 追踪多解；无交不能伪造点 |
| `circle` | UI | 可独立、圆心跟随点、半径依赖；旋转约束影响缩放语义 |
| `arc` | UI | 起止角、方向和大弧；不是完整圆 |
| `intersection` | UI、派生 | 两条线来源与求交状态 |
| `lineCircleIntersection` | UI、派生 | 多解索引/hint，切点/无交状态 |
| `circleIntersection` | UI、派生 | 两圆多解，重合不等于两个普通交点 |
| `curveIntersection` | UI、派生 | 采样数值交点；解索引可大于 1，hint 保持连续 |
| `intersectionSet` | UI 高级流程、派生 | 两对象全部交点；与独立交点实体不同 |

## 4. 领域操作矩阵：38/38 操作清点

入口：`packages/scene-graph/src/operations.ts:55`，校验入口 `patches.ts:172`。表中“检查”是接入后必须落实的契约，并非断言当前每个字段都已严格校验。

测试索引：A = `patches.test.ts`/领域操作相关测试；D = `deletion-cascade.test.ts`；P = 参数/表达式相关测试；G = 分组/对齐/样式相关测试；L = 图层相关测试；V = 图纸/视图相关测试；S = 3D 平移/旋转/截面相关测试。索引用于定位现有测试族，不表示每行有独立成功与拒绝测试。

| 操作 | 必须检查/观察 | 测试族 |
| --- | --- | --- |
| `addPrimitive` | 类型/唯一 ID/引用/所属工作区/非退化；重算后实际实体 | A |
| `addPrimitives` | 批内 ID/引用/整文档合法；仅图元新增批次 | A |
| `updatePrimitive` | ID、锁定、可编辑类型/字段；派生几何只改输入 | A |
| `toggleLock` | 指定目标与最终锁定状态，不是“翻转一次”的含糊语义 | A/G |
| `setParameter` | finite、范围、step、ownerId；依赖重算结果 | P/A |
| `deleteParameter` | 被引用检查；不能留下悬空绑定 | P/A |
| `setParameterExpression` | 安全解析、未知变量、循环、非有限结果 | P/A |
| `addAnnotation` | 文本/锚点/特征/偏移；来源存在、显示位置 | A |
| `deleteAnnotation` | ID 存在，记录注销 | A/D |
| `addEngineeringAnnotation` | 种类/来源/视图/单位/公差/结果状态 | A |
| `deleteEngineeringAnnotation` | ID 与来源上下文，记录注销 | A/D |
| `addConstraint` | 类型/目标数量与类型/残差；不承诺自动求解 3D | A |
| `deleteConstraint` | ID、注销、诊断更新；补直接契约测试 | D/待补 |
| `addMeasurement` | metric/有序 sourceIds/单位/精度/实际重算 | A |
| `deleteMeasurement` | ID、注销，不删除源几何 | A/D |
| `deleteObject` | 依赖计划/锁定/级联/绑定降级；批删缺陷见上 | A/D |
| `toggleVisibility` | 明确 visible，锁定及实际可见集合 | A/G |
| `createGroup` | 成员存在/重复/重叠策略；组不替代几何宿主 | A/G |
| `deleteGroup` | 只解散组，不误删成员 | G |
| `alignPrimitives` | 6 种 alignment/支持类型/锁定及下游影响 | A/G |
| `setPrimitivesLocked` | 全部目标 ID/状态，补直接契约测试 | G/待补 |
| `setPrimitivesVisible` | 全部目标/锁定规则/最终状态 | A/G |
| `setPrimitivesStyle` | 颜色/线宽/透明度/虚线；undefined 的清除语义 | A/G |
| `addLayer` | 唯一 ID/层级/类型/visible/locked/printable | L/A |
| `updateLayer` | 字段合法、层级无环、继承影响；补直接测试 | L/待补 |
| `deleteLayer` | 子层与对象重分配，reassignTo 合法 | L/A |
| `setActiveLayer` | 图层存在与绘图状态；新增对象进入正确层 | L/A |
| `addDrawingSheet` | ID/图幅/比例/有效 viewIds；补直接测试 | V/待补 |
| `updateDrawingSheet` | ID/比例/图幅/引用；补直接测试 | V/待补 |
| `addDrawingView` | ID/kind/位置/正尺寸/比例/sourceIds | V/A |
| `updateDrawingView` | 持久化布局与显示缩放分离；sourceIds 的实现限制 | V/A |
| `deleteDrawingView` | 先处理图纸引用，不留下 dangling viewIds | V/A |
| `translatePrimitive` | 可移动对象、二维 delta、绑定/旋转/派生后果 | A |
| `translatePrimitive3` | 世界 delta、点驱动对象/模板所有权、关联更新 | S/A |
| `rotatePrimitive3` | 世界 axis、degrees、pivot、真实依赖闭包 | S/A |
| `moveSectionPlane` | section 目标、有符号法向距离、截面重算 | S/A |
| `rotateSectionPlane` | axis/degrees/pivot；不能省略枢轴语义说明 | S/A |
| `setSectionPlane` | 非零有限法向/constant、平面归一约定、重算结果 | S/A |

静态扫描未找到 `deleteConstraint`、`setPrimitivesLocked`、`updateLayer`、`addDrawingSheet`、`updateDrawingSheet` 的直接操作字符串测试引用。间接调用、参数化测试、级联测试可能覆盖部分行为；这不是“完全没有测试”的证明。后续需要逐操作成功/拒绝/无变化契约测试。

## 5. 领域操作之外的全产品能力

| 功能族 | 当前实现入口 | 能力覆盖要求与边界 |
| --- | --- | --- |
| 顶级传统/Agent 模块 | App、AgentWorkspace | 不因对话切换销毁用户几何；演示模式与真实执行明确分开 |
| 工作区隔离 | store.switchWorkspace、App | conics/geometry3d/cad 各自文档；calculus 为兼容 ID，独立 UI 已退役；不能默认共享 ID 或几何 |
| 创建命令与指引 | ribbonCommands、guidance、App | 命令前置条件与创建步骤；Esc 分级取消；禁用功能不能假装可用 |
| 对象发现与选择 | AlgebraView、树、App、selection 内核 | 名称歧义、选择顺序、Shift 加选、Alt 子拓扑选择；左→右包含/右→左相交框选；复杂曲线相交框选有局限 |
| 公共属性与样式 | PropertiesBar、primitiveStyle | 名称/颜色/填充/虚线/线宽/透明度；不要每个功能复制一套默认规则 |
| 分组/对齐/锁定/显隐 | operations、App | group 不是宿主；锁定与级联影响；对齐不是所有类型都支持 |
| 平面动点与轨迹 | dynamicPointPaths、PropertiesBar、pathConstraint | 支持 line/segment/ray/polyline/circle/arc/function/ellipse/parabola/hyperbola；自然参数、分支与连续 hint |
| 圆心跟随/半径依赖/绕定点 | circlePlacement、curveRotation、App | 调半径时同步旋转 baseCenter；定点引用会动；不能只改一个 radius 字段冒充完整操作 |
| 点间连线 | App、connection 几何 | 两点 ID 与曲线控制规则；与普通两端点快照线段区分 |
| 平面求交 | intersectionPreview、sampledTypes、recompute | 支持表不等于全部图元；connection/locus/analysisSet 不在共用 15 类采样相交表中；多解/hint/预算 |
| 函数输入与预设 | functionPresets、表达式内核、PropertiesBar | 16 个预设、20 个白名单函数、安全 AST；支持 pi/e；不接受 JS 或隐式乘法，必须显式规范化 |
| 函数分析 | App、函数内核、recompute | 导函数/切法线/割线/积分/零点极值拐点；数值近似、定义域、无定义与垂直情况 |
| 2D 几何编辑 | draftEditing、editing 内核 | offset 新建、正值左侧；trim/extend 有序边界/目标，保留 a 端/延伸 b 端；目标只支持线类 |
| 精确落点与捕捉 | DrawingViewport、DraftControlsRow、drafting 内核 | 绝对/相对/极坐标、长度/角度、正交/极轴/栅格/对象捕捉；确定几何输入优先于模拟鼠标 |
| 3D 构造 | spatialTools、buildSolid、App | 点线面/四模板/空间圆；内核通用多面体能力不等于已有专用 UI；闭合/共面/非零体积检查 |
| 3D 宿主绑定 | hosts3d、PropertiesBar、App | onHost/onFace/onSurface/inSolid 以及既有 onLine/onPlane/derived；参数真值、范围夹取、宿主移动跟随、解绑/删宿主降级 |
| 模板及隐藏细分 | template-sync、primitiveVisibility | 计算对象与用户对象分开；圆柱/圆锥保留象限用户点，其余 tessellation 对象不能默认列成用户可编辑点 |
| 截面和物化 | section 内核、sectionMaterialization、App | 空/退化/闭合/多环/孔；物化后成为独立点棱面，删除来源不影响它们 |
| 3D 相交预览 | intersections3d、sceneIntersectionPreview、App | 结果类型与持久化分开、避免重复、配额截断必须可观察；曲面 Boolean 是凸网格近似，不是精确 CAD 曲面布尔 |
| 测量 | spatialTools、measurements 内核、measurementForms | 8 指标：length/angle/area/volume/distance/dihedral/perimeter/radius；sourceIds 顺序和目标类型决定可测内容 |
| 约束 | constraints、constraints3d、DSL | 8 类型：parallel/perpendicular/coincident/pointOnLine/pointOnPlane/collinear/coplanar/fixedDistance；旧数据保留但约束面板已移除 |
| 2D 标注 | annotations、PropertiesBar、exporters | 坐标或对象特征锚点、文本、偏移；XML 转义与被删来源级联 |
| 工程标注 | engineeringAnnotations 内核、EngineeringInspector | linear/angular/tolerance 有 Ribbon；fillet/chamfer 是 DSL 种类，不能默认已有实体倒角/圆角构造 |
| 图层与图纸 | DrawingTree、LayerTree、EngineeringInspector、operations | 图层层级/继承/可打印/active；图纸/视图布局与输出支持分别验收 |
| 工程模型/投影视图 | EngineeringWorkbench、EngineeringDrawingView | source=document+workspace；四视图 front/top/left/axonometric；投影现有限制与导出来源问题见上 |
| 2D 显示视口 | GraphicsView、viewport | 平移、指针中心缩放、重置、固定 1 世界单位网格；本地 viewport 没有领域操作入口 |
| 3D 显示与相机 | threeScene、viewPreference3d | 旋转/平移/纵深/缩放/fit/reset/autoFit、透明面/隐藏边/法向、展开；不把显示变化当几何修改 |
| 3D 二面角展示 | threeScene、真实测量入口 | 画布开关是坐标轴示例角；真实二面角必须选两个面做测量，内角/外角明确 |
| 工程显示适配 | DrawingSheetView、DrawingViewport | fit/zoom/滚动、视图 scale/visible、投影线；临时开关与持久化字段分开 |
| 文件与恢复 | mgeo codec、draftStorage、App | .mgeo 版本校验/迁移/解码/打开/保存；浏览器本地草稿与恢复确认；当前不是服务端上传 |
| 输出 | exporters、engineeringExporters、App | SVG/CSV/PNG/.mgeo；CAD SVG/DXF/PDF；3D 直接 SVG/PNG 禁用；CSV 不是无损项目格式 |
| 撤销/重做 | store | 100 条历史；一次领域操作一个快照；replace/switchWorkspace 清历史；当前不满足混合批次一次撤销 |
| 面板/Ribbon/响应式 | uiState、App、global.css | 折叠/临时呼出/固定、左右停靠/树搜索、检查器；界面支持不等于几何能力，需要另列视图契约 |
| 播放、文字/图片转换 | Ribbon、dynamic 内核 | 播放 UI 按要求移除；转换入口仍禁用；内核保留不构成可用用户功能 |

## 6. Agent 必须知道的几何规则

1. **单位逐字段定义。** 世界 Z 朝上、右手系；几何 rotation/rotation3 常为弧度；rotatePrimitive3/rotateSectionPlane 接收 degrees；测量角值和工程标注单位不能统一猜测。长度未配置物理单位时是世界单位。
2. **有序引用不能乱排。** 三点角的第二点为顶点；三点 distance 是第三点到第一、第二点定义的线；trim/extend 是先边界后目标；面是有序边界，实体是引用拓扑。
3. **测量有前置条件。** 两线 planar angle 是锐角范围；三点角与二面角语义不同；体积需要合法实体，area/perimeter/radius 依目标类型判断，不能把无穷直线当有限长度。
4. **约束诊断不等于求解。** `solvePoint3Constraints` 当前返回原点位，仅计算诊断；不能靠 addConstraint 声称自动移动点实现 3D 构造。3D 等长/等角不在现有八类型中。
5. **绑定参数是真值。** 不能直接改被绑定点坐标；路径参数、uv、uvw、分支、宿主局部定义各不相同；宿主失效和解绑要给出明确降级结果。
6. **派生对象存来源，不存模型臆造答案。** 重算由内核进行，保留 none/degenerate/insufficient-data/numeric-failure 等状态；无交不能“找个看起来像”的点代替。
7. **符号显示不是符号证明。** exact-forms/measurementForms 对数值进行常见形式识别；保留 raw value、残差、精度和诊断，不把识别到的根式当精确约束已成立。
8. **曲面显示与布尔精度分开。** 解析圆/椭圆、平滑显示、网格求交、面积/体积近似可能使用不同精度来源，必须报告各自 certainty。
9. **截面不总是一个多边形。** 空、点、线、多环、孔都可能存在；物化要求闭合边界，不能丢内环或把多块拼成单面。
10. **当前工具表就是边界。** 可渲染、可绑定、可求交、可投影、可导出是不同集合；遇到不支持类型要解释、提出受控替代或请求确认。
11. **表达式是有限安全语言。** 变量/参数存在、无环、finite；使用白名单数学函数，不执行脚本；非法输入保持原文档不变。
12. **依赖与所有权分开。** 用户创建点、模板管理点、隐藏细分点和派生点应可区分；编辑模板子对象前明确究竟改变哪个宿主。

## 7. 下一阶段设计的硬性验收基线

这是设计准入与验收要求，不是本次对 Agent 的提前实现。

- 对上述每个当前支持功能，明确可调用入口、运行时输入契约、前置条件、目标工作区/文档/版本、真实输出、错误码、副作用与撤销行为。不存在可调用入口的能力单列待提炼，不能用提示词掩盖。
- 对每个执行能力至少给出成功任务、拒绝/恢复任务；对选择顺序、派生失效、多解、锁定、删除、单位和跨工作区再给边界任务。只有测试通过才能标记 Agent 掌握。
- 观察包括真实新增/更新/删除 ID、测量值、状态/残差、近似与截断、未覆盖导出对象；必要时核对渲染。空操作、部分执行、过期文档不许返回 success。
- 使用自然语言名称时先解析实体；重名请求澄清或返回候选，不让模型猜 ID。工具结果保留足够但有界的结构化上下文，不反复灌入完整拓扑/全部历史。
- 预览用隔离文档执行，不能修改用户草稿；确认时校验版本；混合批次原子提交，一次撤销。预览期间用户手动编辑、切换文档或取消时不得覆盖新内容。
- API key、模型返回、图像/OCR 与文件内容均是不可信边界；模型只能发出批准的结构化意图，不能执行任意 JS、shell、文件路径或凭证读取。

### 必须验收的组合任务

| 任务 | 成功与拒绝标准 |
| --- | --- |
| 平面动点 + 圆心跟随 + 半径关系 + 切线 + 轨迹 | 参数改变后全部依赖同步；非法表达式/无切线时不伪造结果；整体可撤销 |
| 函数 + 导函数 + 零点/极值 + 定积分 | 定义域/不连续分段正确；结果注明数值近似；未定义区间解释失败 |
| CAD 精确坐标 + 捕捉 + offset/trim/extend + 图层样式 | 有序目标与端点语义正确；不支持目标不修改；新对象入正确图层 |
| 3D 模板 + 面上/体内动点 + 点驱动线面 + 旋转 | 宿主变换与绑定点同步；隐藏細分不污染用户对象；角度单位明确 |
| 3D 多环截面 + 物化 + 删除来源 | 环/孔保留；物化对象独立；删除执行不出现部分成功或悬空引用 |
| 两实体相交 + 二面角/体积测量 | 无交/退化与近似如实报告；示例角不当真实值；预算截断可见 |
| 立体几何 → CAD 投影 → 工程标注 → 导出 | 同一 source 上观察/选取/导出；重名 ID 不错路由；中文损失或图元遗漏提前提示 |
| 打开旧 .mgeo + 修订 + 保存 + 恢复 + 撤销 | 迁移保留用户标签/位置；坏文件拒绝；清历史规则与批次撤销验收 |
| 两轮对话 + 切会话/工作区 + 取消 + 迟到响应 | 本轮 prompt 与请求 ID 匹配；不跨文档写入；取消后不提交、不冒领成功 |

对于图像任务还必须分别覆盖平面与立体几何；显式题设、视觉推断、示意排版分开保存。透视图不能唯一确定的长度/角度必须请求确认，不能声称恢复了唯一精确 3D 模型。

## 8. 与已确认 P4/P5 产品方向的衔接

保留已确认的 Tauri 2、Windows 优先、Rust 本地代理、SecretStore/Windows Credential Manager、用户自带 API key、CC Switch 风格供应商配置方向。当前仓库中这些原生/API 功能尚不能作为已实现能力审阅。

保留 OpenAI-compatible、Anthropic Messages、Ollama 三类适配方向；国产模型通过供应商预设/自定义 Base URL 覆盖。协议兼容不自动证明视觉、工具调用、严格结构化输出、上下文窗口等能力兼容；需按具体供应商/模型探测与测试。

后续实施方案应先安排运行时校验、事务与来源路由等准入问题，再安排能力入口提炼与可执行评测，最后接入模型编排。P4/P5 默认遵循“结构化提取 → 确定性几何计算 → 预览 → 确认 → 原子提交”，而不是从模型返回 JSON 直接修改用户文档。

真实供应商、网络代理、凭证泄露防护、原生窗口、安装/升级和真实 WebGL 的验证必须另外实施。本次只新增审阅文档，没有修复代码，也没有保证 Agent 已经达到熟练使用标准。

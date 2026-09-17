# 3D 视口与几何内核重构设计（2026-09-17）

> 本设计覆盖三项用户需求：①3D 动点约束滑动 + 截面几何；②3D 视口 Auto-Fit；③依赖树/生命周期与多交点定位。
> 三者共用同一条架构脊柱（求值层 / 渲染管道 / 内核几何），因此写在同一份设计里，但**分三个区块、各配一份实施计划、各自独立提交**。

## 0. 背景、现场事实与目标

### 0.1 需求原文（用户）

1. 重写 3D 动点的射线拾取与参数约束投影，使动点严格沿宿主线段或曲面平滑滑动，拖拽时实时响应并同步驱动下游依赖图元重绘；优化截面逻辑，计算几何体与平面的实际截交闭合多边形，只渲染剖出的切面轮廓与半透明填充，并可**获取截面图元**。
2. 实现 3D 视口自适应缩放（Auto-Fit）：按可见图元世界坐标 AABB 动态计算最佳视锥与相机距离，在图元加载、增删或越界时平滑重置视角并保留 30% 安全边距。
3. 修复图元依赖树与多交点定位：重构图元生命周期与 DAG；清理测量标注引入的循环引用与残留监听；删除宿主时级联注销测量组件，杜绝"图元无法删除"；修正多实根被折叠的问题，为每个解分配独立实体，并在光标划过时按**屏幕像素距离**就近吸附。

### 0.2 已核实的现场事实（全部带证据；两路只读测绘，未改任何文件）

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | 3D 绑定（非 `free`）的点**当前完全拖不动**，且**没有任何 UI 入口**能创建 3D 绑定 | `threeScene.tsx:1363`、`operations.ts:208-221`（`point3` 仅 `free` 可拖）、`App.tsx:570` |
| F2 | **任何 App 重渲染都会整场景重建并新建 `WebGLRenderer`/canvas**；依赖数组含非 memo 的 `onSelect`；展开动画每帧触发一次全量重建（一次展开约 15–20 个 WebGL 上下文） | `threeScene.tsx:1543`、`App.tsx:393`、`threeScene.tsx:1019-1035`、`1539-1540`、`1050-1052` |
| F3 | 同一个模板实体存在**三套几何、两种朝上约定**：three 网格与 `solidSectionGeometry` 是 Y-up 遗留，`buildSolidTemplate` 物化拓扑是 Z-up（与 `README.md:107`、`threeScene.tsx:166` 一致） | `threeScene.tsx:531-574`、`operations.ts:271-304`、`solid-builders.ts:330-368` |
| F4 | 默认剖切面取自 Y-up 顶点表而重算走 Z-up 拓扑 ⇒ 棱锥/圆柱/圆锥默认刀口错位（上一轮实测：圆锥默认截面 1 点且 `visible:false`） | `operations.ts:423-427`、`492-499`、`501-514` |
| F5 | `solidSectionGeometry` 的圆锥回退几何退化：建了上下两个同半径环，顶点与上环同高 ⇒ 实为"顶面封口的圆柱" | `operations.ts:287-302` |
| F6 | 截面只保留**一条**闭合环（最大周长），多连通/带孔截面丢几何 | `sections3d.ts:137`、`139` |
| F7 | 截面拖动**第一次 move 必然跳变**：anchor 被改成 `section.points[0]`，而位移基准是"指针在屏幕平面的落点" | `threeScene.tsx:1356-1360` vs `1364-1365` |
| F8 | 拖动截面时**剖切面片不跟随**（面片未设 `primitiveId`） | `threeScene.tsx:1112-1113`、`356` |
| F9 | 用户对截面的「隐藏」会被重算覆写回 `true` | `operations.ts:508`、`513` |
| F10 | 多选删除被**逐个 id 预校验**卡死：选中 `point-a` 与其上的 `line-ab`，两个都删不掉 | `App.tsx:685-690`、`patches.ts:372`、`96` |
| F11 | 批量删除中途失败被静默吞掉（`apply` 的错误随后被下一次成功清空） | `App.tsx:693-699`、`store.ts:75`、`82` |
| F12 | **多解折叠在下游**：预览按每个解生成，但 App 把索引 clamp 成 `0\|1`，DSL 类型也只允许两值 | `intersectionPreview.ts:40-43`、`App.tsx:537`、`types.ts:435/445/455`、`operations.ts:1003` |
| F13 | 解的顺序**不稳定**（随直线端点点序、两圆心相对位置翻转）⇒ 拖动来源后已保存的交点会换解 | `intersections.ts:136-139`、`170-173` |
| F14 | 2D 悬停/点击选哪个交点由 **SVG 绘制顺序**决定，不看像素距离 | `GraphicsView.tsx:272`、`intersectionPreview.ts:34-48` |
| F15 | 采样去重容差 `1e-4·max(1,\|x\|,\|y\|)` 会把远处相邻的真实交点合并 | `curve-intersections.ts:13` |
| F16 | 测量/标注**不产生循环引用、也没有未注销监听**（逐点核对 18 处注册/清理；`packages/*` 零事件注册） | 测绘报告 A3/A4；`dynamic-measurements.ts` 无 UI 调用者；`PropertiesBar.tsx:455` 缺 `cancelAnimationFrame` |
| F17 | 真实问题是：测量/标注**阻止删除宿主**；`dynamic-measurements.ts` 的订阅引擎是死代码；3D overlay **每帧 `replaceChildren` 重建全部 label** | `patches.ts:83`、`schema.ts:629/569/421/589`、`threeScene.tsx:1218-1255` |
| F18 | 相机只在 `metadata.id` 变化时拟合；用**包围球**、边距 1.25、距离被夹死在 `[3,60]`、无过渡动画 | `threeScene.tsx:1286-1289`、`130-138`、`117-119` |
| F19 | 相机状态不持久化，离开 3D 工作区即丢失 | `threeScene.tsx:928`、`931`、`App.tsx:1020`、`draftStorage.ts:10-52` |

> **对需求原文的一处诚实纠正**：需求 3 说"清理添加测量标注时产生的循环引用与残留监听"。测绘结论是**不存在**这类环与监听泄漏（F16）。本设计按**真实问题**（F17）来修，不虚构修复对象。

### 0.3 目标与非目标

**目标**：动点严格贴宿主且拖拽跟手、下游实时跟随；截面是真实闭合多边形且可物化为独立图元；视角自动适配且不抢用户操作；删除不再出现"删不掉"，多解各自独立且按像素就近命中。

**非目标（YAGNI，明确不做）**：B-Rep / 实体布尔；CGAL / OCCT / Manifold / libigl 等 C++/WASM 引入；全精度自适应谓词（Shewchuk）；ECS 代句柄体系；截面 SVG 化与二维布尔；`three-mesh-bvh`（本期不引入，仅当"指针到三角网格最近点"成为瓶颈时再评估）。

## 1. 调研结论与取舍

| 主题 | 借鉴 | 来源（许可证） | 本项目怎么用 |
| --- | --- | --- | --- |
| 点沿宿主滑动 | 射线与"过锚点、法向=视线的参考平面"求交 → 位移 → 按宿主自由度清零/投影 | three.js `DragControls` / `TransformControls`（MIT） | 保留现有 `dragWorldPoint`（`threeScene.tsx:298`）作为**指针→世界**的唯一入口，再把结果投影到宿主参数域 |
| 点沿宿主滑动 | "点永远由宿主参数生成，绝不自由漂移"；按宿主类型分派 `projectPointToX` | JSXGraph Glider（MIT / LGPL-3.0+） | 直接采纳为 `Host3Constraint` 的**唯一不变式**：参数是真值、坐标是派生缓存 |
| 平面截交 | 面-平面求交的**符号化 8 位码**分类；"共面边只接受其中一个码"，否则会产生非法边界 | trimesh `intersections.py`（MIT） | 重写 `faceSectionRing` 的退化分支（顶点相切 / 共面边） |
| 平面截交 | 线段成环走**顶点图遍历**，`所有顶点度数 == 2 ⇒ 闭合`；孔洞按包含关系判定 | trimesh `path/traversal.py`（MIT） | 替换现有 `chainSectionLoops` 的贪心走法，支持多环 |
| 平面截交 | 定向规则（面法向 × pq × 平面正交向量构成右手系） | CGAL `Polygon_mesh_slicer`（GPL/LGPL+商业） | 统一环的方向，供填充三角化使用 |
| 平面截交**渲染** | stencil 双面计数 + cap 平面 | three.js 官方 `webgl_clipping_stencil`（MIT） | **不采用**：它只能"看起来像"截面，拿不到几何。本期要的是**可物化的真实多边形**（需求 1），所以自己求交，但渲染仍用"轮廓 + 半透明填充" |
| DAG 与删除 | 依赖列表 + 环检测 + 拓扑排序作为**独立可查 API**；`breakDependency` 反向清理依赖者 | FreeCAD `Document::getDependencyList`、`breakDependency`（LGPL-2.1） | 求值层保持独立模块；删除改为"派生对象级联注销" |
| 级联注销 | 级联必须在**祖先表 + 后代表 + 子表**三处同时做，只删一处必然泄漏 | JSXGraph `element.js`（MIT / LGPL-3.0+） | 级联实现要同时更新依赖索引与文档数组，并补一条"三处一致"的测试 |
| 多解 | 多解归属由**初值决定**（吸引域）；需要"求解成功但解无效"的显式状态 | SolveSpace 技术文档（GPL，仅参考）；FreeCAD planegcs `GCS.h`（LGPL-2.1+） | 每个交点实体保存 `hint` 坐标作为初值，重算取**距 hint 最近的解** |
| 就近吸附 | 容差固定为**屏幕像素 ÷ zoom**；多候选按屏幕距离排序取最近；禁止自吸附 | tldraw `SnapManager`（自定义许可，仅算法参考）、Excalidraw `SNAPPING`（MIT） | 2D 预览命中改为像素距离最近；容差沿用现有 12–14px 口径 |

## 2. 架构总览

```
packages/dsl            数据与校验：新增绑定变体、截面 loops、交点 hint（schemaVersion 保持 "0.1"）
packages/geometry-kernel 纯几何：Host3Constraint 求值/投影、截面成环与分类、求交多解
packages/scene-graph     求值层：依赖索引 + 拓扑重算 + 删除级联（唯一改动文档的地方）
apps/web                 交互与渲染：threeScene 场景同步（增量）+ 交互状态机 + Inspector/Auto-Fit
```

三块改动的落点：

| 区块 | kernel | scene-graph | dsl | web |
| --- | --- | --- | --- | --- |
| 一 A 动点 | 新增 `hosts3.ts`（evaluate/project/residual/domain） | `resolveBoundPoint3` 接入宿主、脏集与拓扑序 | `Point3Binding` 新增变体 | 绑定 UI、拖动状态机、预览求值 |
| 一 B 截面 | `sections3d.ts` 重写（多环 + 退化） | `solidSectionGeometry` 统一 Z-up、默认平面 (0,0,1)、物化操作 | `SectionPrimitive.loops?` | 渲染轮廓+填充、面片跟随、转为图元入口 |
| 二 Auto-Fit | — | — | — | `fitCameraState` 重写（AABB 八角 + 0.3 边距）、触发与缓动、开关与偏好 |
| 三 生命周期/多解 | `curve-intersections.ts` 容差、`intersections.ts` 解序稳定化 | 删除级联、模板同步 dirty 化、多解重算取最近解 | `solutionIndex: number` + `hint` | 2D 像素就近命中、overlay 增量更新 |

## 3. 区块一 A：3D 动点宿主约束

### 3.1 数据结构（DSL，向后兼容）

`Point3Binding` 新增三个变体，保留 `free / onLine / onPlane / derived`：

```
| { kind: "onHost"; hostId: string; parameter: number }        // line3 / segment3 / ray3 / edge3
| { kind: "onFace"; faceId: string; uv: [number, number] }     // face3（含多面体的面）
| { kind: "onSurface"; solidId: string; uv: [number, number] } // cylinder / cone 侧面（角度, 轴向）
```

- `parameter` / `uv` 是**自然参数**：线段/棱为 `[0,1]`、射线为 `[0,∞)`、直线无界；圆柱 `u ∈ [0,2π)`、`v ∈ [0,1]`；圆锥 `u ∈ [0,2π)`、`v ∈ [0,1]`（顶点处半径 0，投影需夹取）。
- `schemaVersion` 保持 `"0.1"`；旧文档缺字段时行为不变；`schema.ts` 补引用存在性校验（对应测绘 D8 的教训：校验必须查存在性）。

### 3.2 内核 API（`packages/geometry-kernel/src/hosts3.ts`）

```
export interface Host3 { kind; domain: [number, number]; closed: boolean
  evaluate(u: number, v?: number): Vector3
  project(p: Vector3): { uv: [number, number]; distance: number }
  residual(p: Vector3): number }

export function host3FromSource(source: PrimitiveSpec, context): Host3 | null
export function projectPointOntoHost3(host: Host3, p: Vector3): { uv: [number, number]; point: Vector3; distance: number }
```

- 与 2D `planar-constraints.ts` 同构（`evaluate / project / residual / domain`），代码可对照阅读。
- `project` 一律**先求全局最近点、再夹到宿主定义域**（线段夹 `[0,1]`，射线夹 `[0,∞)`，圆环 `u` 折回 `[0,2π)`）。曲面用解析投影（圆柱：`atan2` + 轴向夹取；圆锥：解析式 + 一次一维细化兜底），不使用迭代全局搜索。
- **唯一不变式**（来自 JSXGraph Glider）：参数是唯一真值、`position` 是派生缓存；`resolveBoundPoint3` 每次都由参数重算坐标，因此连续拖动不会累积漂移。

### 3.3 交互状态机

| 阶段 | 行为 |
| --- | --- |
| `pointerdown` | 命中点 → 若 `binding.kind !== "free"` 则进入**宿主拖动会话**（不再被 `isFreeDraggable3` 拒绝）；记录宿主、当前参数、指针屏幕坐标 |
| `pointermove` | 指针 → 参考平面（`dragWorldPoint`）→ 世界点 `q` → `host.project(q)` 得 `uv` → `host.evaluate(uv)` 得新坐标 → 写入**拖动会话**（不提交文档）→ 更新该点的 three 对象 + 用**预览求值**更新下游 → 每帧 `render()` |
| `pointerup` | 一次 `updatePrimitive3`-类操作提交参数（一步撤销）；`pointercancel` 等价于丢弃 |
| `Esc` | 丢弃本次拖动，恢复原参数与视觉 |

- 下游实时重绘：新增 `previewDerivedPositions(document, { pointId, position })`（scene-graph，纯函数）只重算**受影响闭包**内的对象并返回 `Map<primitiveId, Vector3[] | transform>`，渲染层据此原地更新 three 对象——**不 clone 文档、不重建场景、不进撤销历史**。
- 拖动期间暂停 Auto-Fit；拖动结束若内容越界则由 Auto-Fit 接管（见第 5 节）。

### 3.4 渲染管道去重建化（方案 A，已确认）

1. `WebGLRenderer` / canvas / `ResizeObserver` **只在挂载时创建一次**；文档变化时只清空场景子对象并重建图元对象（不再 `renderer.dispose()` + `new WebGLRenderer`）。
2. 场景效应依赖数组去掉 `document` 与 `onSelect` 的函数身份：文档与回调一律经 ref 读取，改为命令式 `syncScene(document)`；`syncScene` 按 `primitiveId` 做**增删改**：新增/删除对象、已有对象只更新变化的属性（位置/样式/可见性），不再全量重建。
3. `unfoldProgress` 等纯视觉状态不再进依赖数组：展开动画只更新展开组的变换，不触发 `syncScene`。
4. 保留 `data-*` 读数（`data-camera-*`、`data-drag-frames`、`data-section-*`），新增 `data-scene-rebuilds` 计数以便回归断言"拖动 N 帧不重建"。

## 4. 区块一 B：截面几何

1. **统一几何来源**：`solidSectionGeometry` 重写为 **Z-up**（底面在 XY、高沿 +Z），修掉圆锥退化（F5）；`sourceVertices` 与 `recomputeSection` 使用**同一份顶点**（优先物化拓扑，缺失时用修正后的回退几何）。
2. **默认剖切面**：法向 `(0,0,1)`、过来源 AABB 的 z 中心（Z-up 世界的真水平面）。这会改 `operations.test.ts`、`scene-store.test.ts` 与相关 e2e 的期望值，一并更新。
3. **全部闭合环**：`sectionPolyhedron3` 返回 `loops: Vector3[][]`（按面积降序）+ 分类；`Section3Result.points` 保留为最大环（兼容现有消费方）。退化处理采纳 trimesh 的符号化分类：顶点相切、共面边只取一侧码；成环改为**顶点图遍历 + 度数判据**，支持多环与孔。
4. **DSL**：`SectionPrimitive` 新增可选 `loops?: Vector3[][]`；`points` 仍为最大环（旧文档、旧消费方不变）。
5. **渲染**：对每个环画**闭合轮廓 + 半透明填充**（三角化按环的定向处理孔）；剖切面片**只在截面被选中或正在调整时**显示，并随拖动一起移动（修 F8）；截面拖动 anchor 修正为"按下点"（修 F7）；用户显式隐藏不再被重算覆写（修 F9，`visible` 与几何有效性分离）。
6. **获取截面图元**：新增「转为图元」动作，把每个环物化为独立 `point3 + edge3 + face3`（复用 `createBuilderContext` / `buildFromPoints` 的 id 规范），**与来源解耦**：不写 `sourceId`、删宿主不受影响、可移动可求交可测量。一次动作 = 一个 patch = 一步撤销。

## 5. 区块二：3D 视口 Auto-Fit

- **AABB 拟合**（替代包围球）：把 AABB 的八个角投影到相机右/上/前三个轴，取 `halfRight = Σ|rightᵢ|·halfᵢ`（上、前同理），则
  `distance ≥ halfUp / tan(vfov/2) + halfForward` 且 `distance ≥ halfRight / tan(hfov/2) + halfForward`，取两者较大值。
- **边距 30%**：`distance = required / (1 - FIT_MARGIN)`，`FIT_MARGIN = 0.3`（画面留 30%）。
- **距离夹取**：把 `[3, 60]` 放宽为按内容尺度相对的限制（`[0.05, 1e4]`），修掉"小模型不能靠近、大模型看不全"。
- **触发**：① 文档加载/工作区切换（现行为）；② 图元**增删**；③ 内容**越界**（AABB 任一角投影出视锥外）。
- **不抢用户**：用户手动旋转/平移/缩放后置 `cameraTouched`；除非内容越界，不再自动重置。新增「自动取景」开关（默认开，关闭后只保留手动按钮）。
- **平滑**：`requestAnimationFrame` 对 `target` 与 `distance` 做约 250ms 缓出插值；`prefersReducedMotion` 时直接跳变。拖动/编辑进行中暂停。
- **持久化**：开关与相机状态写入本地工作台偏好（`draftStorage`），修掉 F19（切工作区回来视角丢失）。

**验收**：单测断言 AABB 八角拟合的数值（含极端扁长盒）；e2e 断言"打开含 1 单位四面体的文件后 `data-camera-distance` 落在合理区间、图形占屏比 ≥ 某阈值"、"新增远处图元后自动拟合"、"用户转过视角后新增近处图元不重置"、"拖动过程中相机不动"。

## 6. 区块三：生命周期与多解

### 6.1 删除级联语义（已确认：全部派生与标注级联）

| 类型 | 旧行为 | 新行为 |
| --- | --- | --- |
| 交点 / 轨迹 / 连接 / 函数分析族 | 级联删除 | 不变 |
| **测量**（2D 与 3D，`Measurement3`） | **阻止删除** | **随宿主级联注销** |
| **2D 标注 `annotations`** | 阻止删除 | 随目标级联注销 |
| **工程标注 `engineeringAnnotations`** | 阻止删除 | 随来源级联注销 |
| **约束 `constraints`** | 阻止删除 | 来源消失时回收该约束 |
| **分组 `groups`** | 阻止删除 | 自动移除被删成员；空分组保留 |
| 锁定对象 | 拒绝 | 不变（唯一保留的拒绝理由） |

- 批量删除改为**按并集**校验（修 F10）：先算 `deletionTargets` 的并集，再对该并集做一次引用校验。
- 循环内失败改为聚合上报（修 F11）。
- 级联必须**同时**更新：文档数组、依赖索引、`schema` 允许的引用集合（F17 的 schema 约束）——并补一条"级联后文档仍能通过 schema 校验且可保存"的测试（JSXGraph 三表同改的教训）。

### 6.2 求值层与副作用清理

- `syncTemplateTopology` 改为**仅在模板参数真正变化时**执行（脏集驱动），修掉"每次操作重算全部模板"的 O(模板面数) 开销，以及"用户拖过的顶点被静默弹回"（`operations.ts:874-889`、`941`）。
- `resolveBoundPoint3` 接入 3.1 的宿主约束；依赖索引同时登记宿主（点 → 宿主），删除宿主时点随宿主级联注销或降级为 `free`（**取后者**：点的位置保留、绑定解除，符合"用户内容不静默消失"）。
- 删除 `dynamic-measurements.ts` 中无人调用的订阅引擎（或明确标注为未接入的公开 API 并加使用说明），补 `PropertiesBar.tsx:455` 的 `cancelAnimationFrame`。
- 3D 测量/点标注 overlay 改为**增量更新**（按 id diff），不再每帧 `replaceChildren` 重建全部 DOM。

### 6.3 多解实体（`solutionIndex` + `hint`）

- `solutionIndex` 由 `0 | 1` 放宽为 `number`（非负整数）；`lineCircleIntersection / circleIntersection / curveIntersection` 新增可选 `hint: Coordinate`。
- 创建时写入用户点击的那个解的下标与坐标；重算时**取距 `hint` 最近的解**（`hint` 缺失时退回下标），从而在解的数量或顺序变化时不串位（修 F12/F13，采纳 SolveSpace 的吸引域语义）。
- 解的顺序本身稳定化：`intersectLineCircleDetailed` / `intersectCirclesDetailed` 返回的解统一按**坐标字典序**排序，从根上消除顺序翻转（F13）。
- 采样去重容差改为自适应（`1e-9 · max(1, 尺度)` + 相对间距），修 F15。
- 2D 预览命中改为**按屏幕像素距离就近**（`GraphicsView` 记录预览的屏幕坐标，指针最近的候选在 14px 容差内胜出）；重叠时不再由 DOM 顺序决定（修 F14）。3D 沿用 `pickTolerance`（7px）但同样加"最近优先"平局规则。

## 7. 错误处理与降级

| 情形 | 行为 |
| --- | --- |
| 宿主被删除 | 绑定点降级为 `free`（保留位置），并在状态栏说明 |
| 宿主退化（零长线段、圆锥顶点） | `project` 返回域内端点，`residual` 标记 `degenerate`，不写入非有限参数 |
| 非有限输入 | 一律拒绝并保持上一次合法状态（沿用现有 `Number.isFinite` 校验风格） |
| 截面无交 / 相切 | `classification: none / point`，几何不渲染，但**对象保留**且不覆写用户的 `visible` |
| 多环 | 全部渲染与物化；填充按环定向处理孔 |
| 空场景 Auto-Fit | 回到默认视角（现有语义），但不清空用户开关状态 |
| 旧 `.mgeo` | 全部新增字段可选，`schemaVersion` 保持 `"0.1"`，旧文件行为不变 |

## 8. 测试策略（TDD）

每片先写失败用例（RED），实现后转 GREEN；门禁为 `typecheck` / `lint` / `npm test` / `npm run build` / `npm run test:e2e` 全绿。

**单测**
- 内核：宿主 `evaluate/project/residual` 的往返与域夹取（含圆锥顶点、零长线段、圆环折回）；截面多环与退化（顶点相切、共面边、非凸、带孔）；解序稳定性与去重容差。
- scene-graph：拖动预览求值只重算受影响闭包；删除级联的并集校验与 schema 一致性；模板同步只在参数变化时执行（用调用计数断言）；多解按 `hint` 就近匹配（构造形状变化使解数增减）。
- web：`fitCameraState` 的 AABB 数值（扁长盒、点集、单点）；`GraphicsView` 就近命中（两个重合预览按像素距离取最近）；场景同步不重建（`data-scene-rebuilds` 在拖动 20 帧内不增长）。

**e2e**
- 拖 3D 动点沿棱滑动：点始终在棱上（用 `data-*` 读数断言残差 < 容差）、下游线段跟随、一次 Ctrl+Z 复位、拖动期间不重建。
- 截面：四个模板的默认截面都是 `polygon` 且点数 ≥3；转动到 45° 仍有效；「转为图元」后删宿主，图元仍在。
- Auto-Fit：加载小模型后距离落在合理区间；新增远处图元后自动拟合；用户转过相机后新增近处图元不重置。
- 删除：选中"点 + 依赖它的线"一次删掉；删除带测量的宿主后测量一并消失且不被拒绝。
- 多解：直线与 `sin(x)` 的第 5 个交点能被创建且落在点击处；拖动后不串位。

## 9. 实施顺序与提交切分

| 片 | 范围 | 产出与提交 |
| --- | --- | --- |
| 0 | 本设计文档 | `docs: add the 3D viewport and kernel refactor design` |
| 1A-1 | 渲染管道去重建化（方案 A） | 单测 + e2e：拖动不重建、展开不重建 |
| 1A-2 | `hosts3.ts` + 绑定 DSL/schema + 重算接入 | 内核与 scene-graph 单测 |
| 1A-3 | 拖动状态机 + 预览求值 + 绑定 UI | App/e2e |
| 1B-1 | 几何统一 Z-up + 默认平面 (0,0,1) + 圆锥回退修正 | 内核/operations 单测与既有期望更新 |
| 1B-2 | 多环截面 + 渲染 + 面片跟随 + anchor 修正 | 内核 + e2e |
| 1B-3 | 「转为图元」物化 | scene-graph + App + e2e |
| 2 | Auto-Fit（AABB/边距/触发/缓动/开关/持久化） | web 单测 + e2e |
| 3-1 | 删除级联与批量并集校验（含 schema 一致性） | scene-graph/patches + App 测试更新 |
| 3-2 | 求值层清理（模板 dirty 化、死代码、rAF、overlay 增量） | 单测 + 性能断言 |
| 3-3 | 多解实体（`solutionIndex` + `hint` + 就近吸附） | 内核/scene-graph/web 单测 + e2e |

每片结束：更新 `docs/project-progress.md`（含 RED→GREEN 证据与实测数字）与 `docs/feature-catalog.md`，跑全套门禁，`git fetch` 后提交并推送，核验两端 ref 一致。

### 9.1 实施状态（2026-09-17：全部完成）

| 片 | 状态 | 提交 |
| --- | --- | --- |
| 0 设计文档 | 完成 | `4f793a5` |
| 1A-1 渲染管道去重建化 | 完成 | `2210d21`、`9427296` |
| 1A-2 `hosts3.ts` + 绑定 DSL/schema | 完成 | `f23ba72`、`5b2702b` |
| 1A-3 拖动状态机与绑定 UI | 完成 | `659dbc2`、`9acd7ee` |
| 1B 截面（Z-up / 多环 / 「转为图元」） | 完成 | `18babf7` |
| 2 Auto-Fit | 完成 | `859741a`、`27236bf` |
| 3-1 删除级联与批量并集校验 | 完成 | `97e13e1` |
| 3-2 求值层清理与画布尺寸稳定性 | 完成 | `57d3b2a` |
| 3-3 多解实体与就近吸附 | 完成 | `eb26b83` |

**队列之外补齐的四项**（排查与实测阶段发现，均已提交）：F15 采样求交去重尺度改为"只看图形自身尺寸"（`1671289`）；设计第 8 节要求的"四个模板默认截面"验收覆盖（`6f1c144`）；相机与取景数学抽到 `apps/web/src/threeCamera.ts`（`79ebce5`，lint 56 → 42 条 warning）；背景坐标系随内容与相机自适应、3D 画布填满所在网格行（`17e8964`，用户报告的"背景坐标系太小 / 画布太小"）。

**收尾时的实测门禁**：单测 **89 文件 / 1021 用例**；`typecheck` 4 个 workspace；`lint` 0 error / 42 warning；生产构建通过；Playwright **73/73**。

**仍未做（明确记录）**：①`syncScene` 按 `primitiveId` 的整场增量 diff（1A-1b）——只有拖动路径已增量（`refreshPrimitiveObject`），展开动画每帧仍重建几何；②相机状态不跨工作区保留；③`threeScene.tsx` 里那些纯几何构造器（网格/拾取/拖动工具）仍与组件同文件，可再拆模块。

## 10. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| `syncScene` 增量同步引入渲染回归（漏更新） | 保留"全量重建"开关用于对照；`data-scene-rebuilds` + e2e 快照；分片提交便于回滚 |
| 默认平面改为 (0,0,1) 改变既有行为 | 既有测试期望一并更新并在进度文档记录；`.mgeo` 不受影响（平面是文档数据） |
| 删除级联改语义（4–5 个既有测试期望变化） | 变更前先改测试并在提交信息里说明"行为变更"；`schema` 与删除语义同批修改，保证可保存 |
| 多解 `hint` 匹配在新旧文档间不一致 | `hint` 缺失时退回下标，行为与今天一致；补往返测试 |
| 圆锥/圆柱曲面投影在极端参数下失稳 | 解析解 + 域夹取 + 退化诊断；补边界用例（顶点、母线） |
| 工作量最大的片（1A-1、3-1）阻塞后续 | 这两片排在最前，先落地再往上叠功能 |

## 附：需求与条款对照

| 需求 | 对应章节 |
| --- | --- |
| 动点严格沿宿主线段/曲面滑动、拖拽实时响应并驱动下游 | 3.1–3.3 |
| 截面真实截交闭合多边形、只渲染轮廓与填充、可获取截面图元 | 4.1–4.6 |
| 3D 视口 Auto-Fit（AABB、30% 边距、加载/增删/越界、平滑） | 第 5 节 |
| 生命周期与 DAG、级联注销测量、杜绝删不掉 | 6.1–6.2 |
| 多实根独立实体 + 屏幕像素就近吸附 | 6.3 |

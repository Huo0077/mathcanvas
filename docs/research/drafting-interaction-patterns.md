# 开源项目 2D 工程绘图交互模式调研

**调研日期：** 2026-09-16
**用途：** 为 CAD 工作区「2D 绘图」模式（`DrawingViewport`，`mode === "draft"`）的**下一片**交互工作提供可追溯的开源参考。
**边界：** 只借鉴公开的产品行为、交互约定和架构思想，不复制第三方源代码、资源或专有实现。本轮不引入任何运行时依赖。

## 现状基线（已实现，本轮不再调研）

`apps/web/src/drafting.ts`（2026-09-16）已经落地了一个纯几何内核，下列能力**已完成**，本文不再重复论证：

| 已实现能力 | 实现位置 |
| --- | --- |
| 稳定坐标窗口（以原点为中心、跨 `DRAFT_DEFAULT_SPAN = 100`，只随 `view.scale` 缩放） | `draftWindow` / `draftWindowSpan`（`drafting.ts` L63-L71） |
| 屏幕像素 → 图纸坐标换算 + 0.001 收敛 | `clientToDraft`（L74-L80） |
| 网格显示（主 10mm / 次 1mm，次网格 ≥8px 才画，主网格 ≤60 条） | `draftGrid`（L86-L94）、`DrawingViewport.tsx` L331 |
| 对象捕捉：**端点 / 中点 / 圆心** + `endpoint > midpoint > center` 优先级 + 同级取最近 | `draftSnapCandidates`（L107-L127）、`resolveDraftSnap`（L133-L145）、`priority`（L61） |
| 捕捉半径按**屏幕像素**给（`DRAFT_SNAP_PIXELS = 12`），缩放后手感一致 | L50、`DrawingViewport.tsx` L264 |
| 正交 / 45° 极轴角度约束 + Shift 临时正交 | `constrainAngle`（L157-L167）、`DrawingViewport.tsx` L268 |
| 橡皮筋预览 + 实时长度/角度（或半径）读数 | `draftMeasurement`（L170-L174）、`renderCreationPreview`、L295-L303、L337 |
| 捕捉标记（`engineering-drawing-snap-marker`）+ 捕捉名称标签（`snapLabels`） | L338-L342 |

结论：**"画不准 / 坐标系会跳 / 没有预览"这三个原始反馈已解决**。用户反馈"不好画图"的剩余来源在下一节的清单里。

## 尚未实现的部分（本轮重点）

> **2026-09-16 更新：** 本文清单**已全部落地**：交点 / 垂足 / 最近点 / 象限点 / 切点捕捉、捕捉候选循环切换（Tab）、栅格捕捉接入捕捉链、极轴阈值触发、夹点编辑、框选方向语义与 Esc 分级、动态输入与命令行坐标、命中容差，以及最后一片「偏移 / 修剪 / 延伸」（内核 `packages/geometry-kernel/src/editing.ts`，映射 `apps/web/src/draftEditing.ts`，视口按钮在 `DrawingViewport.tsx`）。命中容差这一项挖出的根因比预期严重：`non-scaling-stroke` 下 `0.022` 的线宽实测渲染成 `0.04px` 的**隐形线**、命中带约 `0.1px`，即整张工程图既看不清也点不中，现已改为像素量级 + 14px 透明命中带。动态输入的位置有一处刻意取舍：放在视口工具栏而不是光标旁（图纸带 CSS zoom，浮层定位/清晰度不稳），键盘流一致。偏移只做"平行复制"（折线走斜接），修剪/延伸目前只支持直线、线段、射线；圆/圆弧的修剪（拆成多段圆弧）仍不在范围内，遇到会明确报错而不是猜。详见 `docs/project-progress.md`。

| 缺口 | 现状证据 |
| --- | --- |
| **交点 / 垂足 / 切点 / 最近点捕捉** | `SnapKind = "endpoint" \| "midpoint" \| "center" \| "grid"`（`drafting.ts` L23）；`draftSnapCandidates` 只推端点/中点/圆心三类 |
| **象限点捕捉** | 圆/圆弧只推 `center`（L124），没有 `center ± r` 的四个象限点 |
| **捕捉候选循环切换（Tab）** | `resolveDraftSnap` 只返回**单个**最优候选（L133-L145），没有候选数组，也没有循环状态 |
| **栅格捕捉接入捕捉链** | `snapToGrid`（L148-L151）已实现但**从未被调用**；`draftGridSnapStep`（L97-L100）同样未被调用；`SnapKind` 里的 `"grid"` 是死分支 |
| **极轴"阈值触发"语义** | `constrainAngle`（L157-L167）对**所有**角度都取最近 45° 倍数，等于"永久锁定 45°"，不是极轴追踪（追踪应仅在光标接近跟踪角时才吸附） |
| **正交与极轴互斥 / 键盘开关** | `DraftConstraint = "free" \| "ortho" \| "polar45"` 是循环按钮（`DrawingViewport.tsx` L322），**没有 F8/F10** |
| **动态输入 / 命令行坐标输入** | `<svg>` 无 `tabIndex`、无 `onKeyDown`，键盘事件只在 `window` 上处理 Esc/Delete（`App.tsx`） |
| **夹点编辑** | `interaction.ts` 的 `getDragHandle` / `createDragAction` 被 `GraphicsView.tsx`（数学模式）使用（L161、L6），**draft 视口完全没接**；draft 图元只有 `onClick` 选中 |
| **框选方向语义** | draft 视口无框选；`App.tsx` 的 `selectBox` 只有"完全包含"一种语义，且由 `GraphicsView` 触发 |
| **偏移 / 修剪 / 延伸** | 无 |
| **捕捉优先级缺 `nearest` 兜底** | 无 `nearest` 类型；指针落在实体上但没有特征点时完全自由 → 无法"沿线滑动取点" |

---

## 参考项目

### Web 端 CAD / 绘图 / Sketch 库与工具

| 项目 | GitHub | 许可证 | 本次关注点 |
| --- | --- | --- | --- |
| JSketcher | [xibyte/jsketcher](https://github.com/xibyte/jsketcher) | **Autodrop3d 自定义许可，非 OSI**（要求修改以 PR + 不可撤销版权转让回贡） | 浏览器内 2D 参数化草图：工具态机、捕捉落点即加"重合"约束、坐标语法解析器 |
| Excalidraw | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | MIT | 吸附阈值 8px÷zoom、gap 吸附、`distance ≤ tolerance` 命中、多点折线中点增删 |
| JSXGraph | [jsxgraph/jsxgraph](https://github.com/jsxgraph/jsxgraph) | MIT / LGPL-3.0 双许可（[README](https://raw.githubusercontent.com/jsxgraph/jsxgraph/master/README.md)） | 吸附引擎 API 形状：`attractors` + `attractorDistance` + `attractorUnit`、双阈值、hover 高亮、`showInfobox` |
| tldraw | [tldraw/tldraw](https://github.com/tldraw/tldraw) | **自定义生产许可，非 MIT**（`LICENSE.md`，需 license key） | 捕捉指示器 SVG overlay、`snapType: 'point' \| 'align'`、`create` 型把手、Shift 15° |
| Konva | [konvajs/konva](https://github.com/konvajs/konva) | MIT | `dragBoundFunc`/`anchorDragBoundFunc` 钩子、`rotationSnaps + rotationSnapTolerance`、`hitStrokeWidth` |
| Fabric.js | [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js) | MIT | 自定义 `Control` 夹点、`perPixelTargetFind` + Canvas 级 `targetFindTolerance` |
| Paper.js | [paperjs/paper.js](https://github.com/paperjs/paper.js) | MIT（[license](https://paperjs.org/license/)） | `getNearestPoint` / `getNearestLocation`（曲线最近点，含参数化位置）、`hitTest({tolerance, class})` |
| OpenJSCAD | [jscad/OpenJSCAD.org](https://github.com/jscad/OpenJSCAD.org) | MIT | 代码驱动建模 → 反例 |
| Snap.svg | [adobe-webplatform/Snap.svg](https://github.com/adobe-webplatform/Snap.svg) | Apache-2.0 | `Snap.closestPoint` 的路径最近点参考实现；库已多年不活跃 |

### 桌面开源 CAD 的交互范式（只借鉴思想，不引入代码）

| 项目 | 主页 / GitHub | 许可证 | 本次关注点 |
| --- | --- | --- | --- |
| QCAD | [qcad/qcad](https://github.com/qcad/qcad) | **GPL-3.0**（[license](https://qcad.org/en/documentation/license)，+ 专有插件例外） | `RSnap` 类层次（每种捕捉一个类）、auto snap、修剪/偏移工具族、Tab 跳选项栏 |
| LibreCAD | [LibreCAD/LibreCAD](https://github.com/LibreCAD/LibreCAD) | **GPL-2.0** | 捕捉清单、Exclusive Snap Mode、**相对零点 `rz` 可设可锁**、Snap Distance |
| FreeCAD Sketcher | [FreeCAD/FreeCAD](https://github.com/FreeCAD/FreeCAD) | **LGPL-2.1** | 网格吸附阈值 = 栅格间距 20%、"snapping is just a drawing aid, it does not produce additional constraints"、DOF/求解状态文案 |
| SolveSpace | [solvespace/solvespace](https://github.com/solvespace/solvespace) | **GPL-3.0** | 画线自动插 point-coincident；过约束高亮并提示可删哪条；参考尺寸 vs 驱动尺寸 |
| OpenSCAD | [openscad/openscad](https://github.com/openscad/openscad) | **GPL-2.0** | 纯脚本建模 → 反例 |

许可证以各仓库当前 `LICENSE`、`README`、`package.json` 与 GitHub 元数据为准（2026-09-16 核对）。**tldraw 与 JSketcher 都不能按 MIT 依赖对待**，理由见文末"不借鉴清单"。

---

## 关键交互技术

### 1. 扩展对象捕捉：交点 / 垂足 / 切点 / 最近点 / 象限点

**用户怎么操作。** 把光标移到两条线的交叉处，出现"叉"形标记与"交点"标签，点击即得到**数学精确**的交点；把光标移到一个端点附近再移到另一条线上，出现直角符号与"垂足"；在圆附近出现切线符号与"切点"；把光标停在一条线上（没有特征点）时出现沙漏形标记与"最近点"，点击得到一个**真正落在线上的点**（而不是有微小偏差的自由点）。

**为什么必须先做这一组。** 现在 `SnapKind` 只有三类（`drafting.ts` L23），缺 `nearest` 兜底意味着"沿线滑动取点"根本无法表达——用户只能去猜坐标。而在工程图里，"点在线上"是最常用的约束意图。

**参考做法。**

- **AutoCAD** 的 AutoSnap 明确由四件组成：Marker（形状**取决于捕捉类型**）+ Tooltip（名称）+ Magnet（把光标锁到最近的捕捉点）+ Aperture box（判定区域）；并明确 `If you have set more than one running object snap, you can press Tab to cycle through the available object snaps.`（[About Setting Visual Aids for Object Snaps](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-MAC-Core/files/GUID-9882004A-97FA-446A-84AB-13E061965034.htm)）。形状约定：端点=方块、中点=三角、圆心=圆、交点=叉、垂足=直角符号、切点=切线符号、最近点=沙漏、象限点=菱形。
- **QCAD** 把每种捕捉做成 `RSnap` 的子类（`RSnapEndpoint`、`RSnapMiddle`、`RSnapCenter`、`RSnapIntersection`、`RSnapPerpendicular`、`RSnapTangential`、`RSnapCoordinatePolar`…），由捕捉引擎按实体类型分派（[RSnap 类参考](https://qcad.org/doc/qcad/latest/developer/class_r_snap.html)、[RSnapCoordinatePolar](https://qcad.org/doc/qcad/3.0/developer/class_r_snap_coordinate_polar.html)）；其功能页列出完整集合：free / grid / endpoints / points on entities / perpendicular / tangential / center / middle / middle between two points / reference points / 距端点给定距离 / intersections / **auto snap**（[features](https://qcad.org/en/documentation/features)）。
- **LibreCAD** 的清单可直接当验收表：`se` 端点（含圆的**象限点**）、`sn` 对象上（nearest）、`sc` 圆心、`sm` 中点（该文档还给了一个好扩展——"Middle points" 设为 2 可吸三等分点）、`sd` 距端点给定距离、`si` 交点（文档明确 **"this does not currently work for polylines"**，是已知缺口，我们可以做得更好）（[Snapping](https://docs.librecad.org/en/latest/ref/snaps.html)）。
- **Paper.js** 提供现成算法形状：`PathItem.getNearestPoint(point)`、`PathItem.getNearestLocation(point) → CurveLocation`，`CurveLocation` 带 offset / 曲线参数——**把捕捉结果表达成参数而不只是坐标**，对后续"点在线上"的约束语义极有价值（[PathItem](https://paperjs.org/reference/pathitem/)、[Path](https://paperjs.org/reference/path/)）。

**我们该怎么做。**

1. `SnapKind` 扩展为 `endpoint | intersection | quadrant | center | midpoint | perpendicular | tangent | nearest | grid`。
2. 新增几何计算。**这些属于几何算法，应落在 `packages/geometry-kernel`，不要在 `drafting.ts` 里手写第二套。** 需要的原语：
   - 线段×线段、线段×圆/圆弧、圆×圆、线段/圆×射线、线段/圆×折线各段的交点；
   - 点→线段/射线/折线的垂足（投影参数 t 必须落在实体**自身范围**内，否则不是垂足——这正是 `docs/research/graphing-tools.md` 记录的"线段、射线和圆弧的交点需要按自身范围过滤"同一条原则）；
   - 过基准点向圆作切线得到切点（仅当基准点在圆外；圆上有两个解，取距离近者，用 Tab 循环两者）；
   - 点→实体的最近点（线段用 clamp 投影；圆用径向投影；圆弧需先投影到角度范围再 clamp 到端点）。
3. 每个候选沿用现有 `SnapCandidate` 形状并补 `sourceId`，以便把"这个端点来自哪条线"写进文档引用（呼应 `graphing-tools.md` 的"连接保存引用"决策）。
4. **范围过滤是必须的，不是优化。** 无限延伸的直线与线段必须区别对待：`PrimitiveSpec` 里 `line` / `ray` / `segment` 是三种类型，垂足、交点、最近点都要按类型决定参数范围。

### 2. 捕捉优先级与 Tab 循环切换

**用户怎么操作。** 当两个候选（比如一条线的端点恰好也是一条线的中点）都在容差内时，默认给出优先级更高者；**按 Tab** 在候选之间循环，标记与标签同步切换。

**事实。** AutoCAD 官方只给"Tab 循环"这一条冲突消解机制，**没有给出各捕捉模式之间的固定优先顺序**（[About Setting Visual Aids for Object Snaps](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-MAC-Core/files/GUID-9882004A-97FA-446A-84AB-13E061965034.htm)、[Drafting Tab](https://help.autodesk.com/cloudhelp/2022/ENG/AutoCAD-Core/files/GUID-33A0F8E8-9981-4111-AD73-128B20D7975C.htm)）。LibreCAD 用 "Exclusive Snap Mode" 开关表达"只允许一种捕捉" vs "多种可同时有效"（[Snapping](https://docs.librecad.org/en/latest/ref/snaps.html)）。tldraw 用明确分层："`points` … have higher priority than `outline`"，且手柄捕捉"checks snap points first, then falls back to the nearest point on any outline"（[Snapping](https://tldraw.dev/sdk-features/snapping)）。JSXGraph 把阈值叫 `attractorDistance`，并让 `attractorUnit` 可选 `'screen' | 'user'`（[src/options.js](https://unpkg.com/jsxgraph@1.13.3/src/options.js)）。

**我们该怎么做。** 现有 `resolveDraftSnap` 已经把优先级 + 同级取近做成纯函数（L133-L145），只需两步改动：

1. **把返回值从"单个最优"改成"有序候选数组"**，例如新增 `rankDraftSnaps(raw, candidates, tolerance): DraftSnap[]`，保留 `resolveDraftSnap` 作为"取数组第 0 项"的薄封装，避免破坏现有调用点与测试。
2. **优先级顺序**（在现有 `endpoint=0 < midpoint=1 < center=2` 基础上扩展；**`nearest` 必须排最后**，因为 AutoCAD 的 magnet 是"locks the crosshairs onto the **nearest** object snap location"，若 `nearest` 不垫底它会因数学上总是最近而吃掉一切）：

   `endpoint 0 < intersection 1 < quadrant 2 < center 3 < midpoint 4 < perpendicular 5 < tangent 6 < nearest 7 < grid 8`

3. **Tab 循环**：视口持有 `cycleIndex` 状态，`keydown` 的 Tab 递增并取模；候选集变化（指针移动超过容差）时重置为 0。**Tab 要 `preventDefault()`**，否则焦点会跳走——这是现在 `<svg>` 没有 `tabIndex` 反而"歪打正着"的一点，加键盘支持时别丢掉。
4. 提供一个"独占捕捉"开关（LibreCAD 的 Exclusive Snap Mode），给想要绝对可控的用户。

### 3. 极轴追踪要"阈值触发"，并且正交与极轴互斥

**用户怎么操作。** 打开极轴后，只在光标方向**接近** 15°/30°/45°/90° 倍数时才吸附并显示一条跟踪矢量；偏离了就自由移动。正交与极轴不能同时开。

**事实。** AutoCAD 的极轴角度是 "90-degree divisors, such as 45, 30, and 15 degrees"，并把光标限制在指定角度上、显示临时对齐路径与提示（[Drafting Tab](https://help.autodesk.com/cloudhelp/2022/ENG/AutoCAD-Core/files/GUID-33A0F8E8-9981-4111-AD73-128B20D7975C.htm)、[About Polar Tracking and PolarSnap](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-7EC3C63D-EA4E-4E65-A676-C3A3627E3F19.htm)）；**F8 与 F10 互斥**，F8 "Locks cursor movement to horizontal or vertical"，F10 极轴追踪（[Function Key Reference](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-Core/files/GUID-ACAA0279-047D-458E-889F-60BBFDD40489.htm)）。**正交在有对象捕捉时被忽略**——"输入坐标或指定对象捕捉时正交被忽略"（[About Orthogonal Locking](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-C3B5D7B3-8057-4D8B-A3A2-0F5F0778BF37.htm)）。**PolarSnap** 进一步把距离限制为增量（0、4、8、12…）（[About Polar Tracking and PolarSnap](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-7EC3C63D-EA4E-4E65-A676-C3A3627E3F19.htm)）。Konva 的 `rotationSnaps` + `rotationSnapTolerance`（默认 5）是同构的"角度吸附 + 容差"设计（[Rotation_Snaps](https://konvajs.org/docs/select_and_transform/Rotation_Snaps.html)、[Transformer API](https://konvajs.org/docs/api/Konva.Transformer.html)）。

**我们该怎么做。**

- `constrainAngle`（L157-L167）改为**两段**语义：新增 `snapAngle(origin, point, stepDegrees, toleranceDegrees)`，**只有当 `|θ - θ'| ≤ tolerance`（建议 3°，或屏幕横向偏离 ≤8px，取先满足者）时才返回吸附点，否则返回原始点**。保留 `constrainAngle` 作为无阈值版本（正交用，正交永远生效）。
- 正交与极轴改为**互斥二选一**，并加 F8 / F10；Shift 保持"对当前是否开启取反"的临时替代键（[Autodesk 支持](https://www.autodesk.com/support/technical/article/caas/tsarticles/ts/6pCskzjZiRJ3X4tJkB753X.html)、[Arkance](https://ukcommunity.arkance.world/hc/en-us/articles/21550796546194-AutoCAD-Tip-Giving-your-AutoCAD-productivity-a-lift-with-Shift)）。
- **保留现有正确优先级**：`resolvePointer`（L261-L271）先捕捉再角度约束，注释也写明了理由——这与 AutoCAD"指定对象捕捉时正交被忽略"一致，**不要改反**。
- 状态栏/按钮文案要显示当前模式（"正交" / "极轴 45°（按住 Shift 临时关闭）"），不要只显示一个循环按钮的当前值。

### 4. 命令行与动态输入（坐标精确化）

**用户怎么操作。** 画线过程中不点鼠标，直接敲数字出现输入框，输入长度 → **Tab** 跳到角度字段 → 输入角度 → **Enter** 落点。或直接敲坐标。

**事实。** AutoCAD F12 原文：`Displays distances and angles near the cursor and accepts input as you use **Tab between fields**`（[Function Key Reference](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-Core/files/GUID-ACAA0279-047D-458E-889F-60BBFDD40489.htm)）。动态输入工具提示由指针输入 / 尺寸输入 / 动态提示三部分组成；**第二点及之后默认采用相对极坐标（无需 `@`），`#` 前缀强制绝对坐标**；按住 F12 可临时关闭（[About Using Dynamic Input Tooltips](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-3EBD4C17-F0A5-49FA-B131-4AABE2E727DB.htm)）。**AutoCAD 坐标语法**三格式为绝对 `x,y`、相对 `@dx,dy`、极坐标 `@dist<angle`。

**一个现代 Web 实现的状态机可以直接照抄**（[Building a Web CAD: How We Implemented Precise X,Y Coordinate Input](https://dev.to/kulman_lab_9ff2748a5207d1/building-a-web-cad-how-we-implemented-precise-xy-coordinate-input-2i55)）：敲数字进 X → **`,` 或空格锁 X 并跳 Y** → 输入 Y 后 **Enter/空格提交** → **Y 为空时退格自动跳回 X** → **Esc 只清输入缓冲、不取消命令**；且该逻辑挂在全局"点捕捉 + 输入解析引擎"上，因此 Line / Polyline / Arc / Circle / Ellipse / Rectangle / Spline / Move / Copy / Rotate / Scale / Mirror / Dimension 一次性全部获得该能力。**架构结论：动态输入不要写进每个绘图工具，要写成"点输入解析器"。**

**JSketcher 的解析器**（源码级）支持 `x,y`、`@x,y`、`r<angle`、`@r<angle` 四种形式，报错文案为 `"wrong input, point is expected: x,y | @x,y | r<polar | @r<polar"`，配合 `sendSpecifyPointHint()` 的 "specify point" 提示与 `TerminalView` 组件——说明它走**命令行/提示行**模型（[tool.js](https://github.com/xibyte/jsketcher/blob/main/web/app/sketcher/tools/tool.js)）。**注意：JSKetcher 的许可要求任何修改以 PR + 不可撤销版权转让回贡给 Autodrop3d LLC，未购商业许可而不回贡则全部授权失效**（[LICENSE](https://raw.githubusercontent.com/xibyte/jsketcher/main/LICENSE)）——**只抄语法语义，不抄代码**。

**Onshape** 的做法更弱但也值得知道：点击即"放置尺寸并同时打开数值输入框"，输入后按 Enter 生效；尺寸默认驱动（driving），会过约束时转为参考（driven）（[Onshape Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm)）。

**我们该怎么做（三档，按成本递增）。**

1. **最低成本、立刻可做**：`statusPrompts.ts` 的提示文案里给出坐标语法示例，**并真的实现它**。当前 `statusPrompts.ts` 已经不再有"Shift 锁水平/垂直"的空头承诺（该文案已随 `drafting.ts` 落地而修正），要保持这个标准。
2. **中成本、建议作为下一片**：新建 `apps/web/src/draftingInput.ts` 纯函数解析器：
   - 输入 `x,y` → 绝对；`@dx,dy` → 相对基准点；`@d<a` 或 `d<a` → 相对极坐标（按 AutoCAD，第二点默认相对极坐标，可省略 `@`）；`#x,y` → 强制绝对。
   - 字段模型按模式：line/segment/ray/polyline → `[长度] Tab [角度]`；circle → `[半径]`；arc → `[半径] Tab [起始角] Tab [终止角]`。
   - 退格跨字段回退、Esc 只清缓冲。
   - 接线方式：给 `<svg>` 加 `tabIndex={0}` 并在 `creation !== null` 时接管可打印字符，**不要抢 `window` 上已有的 Esc/Delete**。
   - 输入中禁用捕捉吸附（否则标记会跟着字段跳动），提交后清空缓冲并重新聚焦画布。
3. **高成本、本阶段不做**：完整命令行窗口（需要工具注册表、命令别名、历史回放），对教学场景收益有限。

**配套：相对零点。** LibreCAD 的 `Set relative zero` / `Lock relative zero`（[Snapping](https://docs.librecad.org/en/latest/ref/snaps.html)）说明相对坐标的原点应是**用户可设的显式状态**，而不是"上一点"。这直接决定"重复画一排同尺寸孔"是否顺手——建议在 draft 视图加相对零点显示与重置入口。

### 5. 网格吸附接入捕捉链

**事实。** FreeCAD 的规则可直接采用：光标到栅格线的距离 ≤ **栅格间距的 20%** 时吸附，且**网格不可见时吸附依然生效**；原文明确 `Snapping only works while creating geometry. Note that snapping is just a drawing aid, it does not produce additional constraints.`（[Sketcher Dialog](https://wiki.freecad.org/Sketcher_Dialog)）。tldraw 把网格吸附作为与 bounds snapping **独立**的系统，由 `TLInstance.isGridMode` 控制（[Snapping](https://tldraw.dev/sdk-features/snapping)）。Excalidraw 用 `SNAP_DISTANCE = 8`、`getSnapDistance(zoom) = SNAP_DISTANCE / zoomValue`（[snapping.ts](https://cdn.jsdelivr.net/gh/excalidraw/excalidraw@master/packages/excalidraw/snapping.ts)）。

**我们该怎么做。** `snapToGrid`（L148-L151）和 `draftGridSnapStep`（L97-L100）**已经写好了但从未被调用**，接上即可：

- 在 `resolvePointer` 里，`resolveDraftSnap` 返回 `null` 且角度约束未命中时，再尝试栅格：判定 `distance(raw, snapped) <= min(gridStep * 0.2, tolerance)`（FreeCAD 口径与屏幕像素口径取**更宽松**者，两个口径都要在设置里可见，因为缩放表现不同）。
- `SnapKind` 里的 `"grid"` 死分支因此被激活，`snapLabels` 补一个"栅格"条目。
- **栅格必须排在对象捕捉之后**（对象捕捉 > 正交/极轴 > 栅格捕捉），与 AutoCAD 语义一致（[About Orthogonal Locking](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-C3B5D7B3-8057-4D8B-A3A2-0F5F0778BF37.htm) 记录了捕捉优先于正交）。
- **网格模式与对象吸附模式在 Excalidraw 里是互斥的**：`actionToggleGridMode` 打开时会把 `objectsSnapModeEnabled` 置为 false，反向亦然（源码级，`packages/excalidraw/actions`）。即"要么吸栅格、要么吸对象"是经过实践的二选一，而不是叠加。这与 AutoCAD 的"正交 / 极轴互斥"是同一类设计取舍——**界面上不要让用户同时打开互相争夺落点的两套吸附**，建议照此把开关做成互斥组（对象捕捉是基础能力可常开，栅格吸附与角度约束互斥）。
- **网格线不得计入任何"按内容自适应"的边界计算**——当前 draft 已改用固定窗口（L243），要保持这个前提，否则缩放会随光标漂移。

### 6. 夹点（grip）编辑

**用户怎么操作。** 选中一条线，两端出现方块夹点，拖拽即改端点；圆心夹点拖拽改半径；折线顶点夹点拖拽改顶点，拖某段中点还能插入新顶点。

**事实。** AutoCAD 在端点/中点/圆心放方块夹点，拖拽即编辑。Fabric.js 用可自定义的 `Control`（归一化坐标 −0.5…0.5 + 像素 `offsetX/offsetY` + 可替换的 `actionHandler` / `cursorStyleHandler`），并提供 `setControlsVisibility` 逐个显隐（[Control.d.ts](https://cdn.jsdelivr.net/npm/fabric@7.4.0/dist/src/controls/Control.d.ts)、[Configuring controls](https://www.fabricjs.com/docs/configuring-controls/)）。Konva 的 `Transformer` 提供 `enabledAnchors`（八个具名锚点）、`anchorSize`、`keepRatio`、`boundBoxFunc`、`anchorDragBoundFunc`（[Transformer.ts](https://cdn.jsdelivr.net/gh/konvajs/konva@master/src/shapes/Transformer.ts)）。Excalidraw 的多点编辑把"选中点索引"与"中点悬停坐标"分离成独立状态（`selectedPointsIndices` / `segmentMidPointHoveredCoords`），拖拽时才落成真实点（[linearElementEditor.ts](https://cdn.jsdelivr.net/gh/excalidraw/excalidraw@master/packages/element/src/linearElementEditor.ts)）。Paper.js 用 `divideAt(location)` 在曲线某处插入段，对应"拖中点插入点"（[Path](https://paperjs.org/reference/path/)）。tldraw 把手分 `vertex` / `virtual` / **`create`（专用于在折线上插入新点）** / `clone` 四类（[Handles](https://tldraw.dev/docs/handles)）。

**我们该怎么做。** **不要重写，直接接入已有的 `interaction.ts`。**

- `getDragHandle(primitive, pointer, tolerance)`（L32-L56）已覆盖 point / line / segment / ray / polyline（`vertex-${index}`）/ circle（`radius`）/ arc（`startAngle` / `endAngle` / `radius`）/ ellipse 等的把手判定；`createDragAction`（L58-L81）已生成 `translate` 或 `update` 补丁。`GraphicsView.tsx` 已在用（L161 起拖、L6 导入）。
- draft 视口要做的只是：渲染 `data-drag-handle` 方块（照抄 `GraphicsView.tsx` L260 的约定），`onPointerDown` 调 `getDragHandle` 并 `setPointerCapture`，`onPointerUp` 调 `createDragAction` → 走 `App.tsx` 已有的 `handleDragEnd`（它已是 `apply` 补丁，天然进 undo 历史）。
- **唯一必须改的是容差**：`getDragHandle` 默认 `tolerance = 0.35` 是**世界单位、不随缩放变化**，draft 视口必须传 `DRAFT_SNAP_PIXELS / pixelsPerWorldUnit`（与 `DrawingViewport.tsx` L264 的算法一致），否则图纸放大后会"到处都能抓到把手"。
- 折线顶点插入/删除可以用 Excalidraw 的"中点拖拽"作为第二步（成本低、覆盖大量重画场景）。

### 7. 框选方向语义与 Esc 分级

**用户怎么操作。** 从左往右拖框 = 只选中**完全被框住**的对象；从右往左拖框 = 只要**碰到框**就选中。两种模式的框颜色/线型不同。

**事实。** 这是 AutoCAD 标准约定，方向由起止点 x 决定（[Get direction of window selection](https://blog.autodesk.io/get-direction-of-window-selection/)、[Changing window selection behavior](https://www.autodesk.com/es/support/technical/article/caas/sfdcarticles/sfdcarticles/ESP/Changing-window-selection-behavior.html)）。Excalidraw 用 `hitElementItself` / `hitElementBoundingBox` 区分两种命中，判定统一走 `distance <= tolerance`（[collision.ts](https://cdn.jsdelivr.net/gh/excalidraw/excalidraw@master/packages/element/src/collision.ts)）。

**我们该怎么做。**

- `App.tsx` 的 `selectBox` 目前只有"完全包含"一种语义，加一个方向参数；`crossing` 模式下按图元做相交判定（线段用与矩形四边的相交测试，圆用"圆心到矩形距离 ≤ r"，折线逐段）。
- 框选预览：Window 实线蓝、Crossing 虚线绿——桌面 CAD 的强约定，成本近零。
- **Esc 分级**：当前 `App.tsx` 的 Esc 处理一次性清掉 `creationStep` + `activeCommand` + `guidance`。建议改为：第一次 Esc 取消**未完成的绘制**（清 `creationStep`），第二次清空选择，第三次无操作。否则折线画到一半按 Esc 会连选择一起丢。
- **重复上一个命令**：无创建模式时按 Enter/空格重回上次的 `creationMode`（AutoCAD 约定，需在 `App.tsx` 记 `lastCreationMode`）。

### 8. 命中容差（"细线点不中"）

**事实。** Konva 的 `hitStrokeWidth` 默认 `'auto'`（= strokeWidth），细线可调大以便点击（[Shape API](https://konvajs.org/api/Konva.Shape.html#hitStrokeWidth)）。Fabric.js v7 用 `perPixelTargetFind: true` + **Canvas 级**（不是对象属性）`targetFindTolerance`（[Canvas#targetFindTolerance](https://www.fabricjs.com/api/classes/canvas/#targetfindtolerance)）。Paper.js 的 `hitTest({tolerance})` **默认 `settings.hitTolerance = 0`，必须显式传**（[PaperScope#settings](https://paperjs.org/reference/paperscope/)）。

**Excalidraw 的公式最值得直接采用**（源码级，`packages/excalidraw/components/App.tsx` 的 `getElementHitThreshold` 与 `packages/common/src/constants.ts`）：

```
threshold = Math.max(strokeWidth / 2 + 0.1, 0.85 * (DEFAULT_COLLISION_THRESHOLD / zoom))
```

`DEFAULT_COLLISION_THRESHOLD` 由 `SIDE_RESIZING_THRESHOLD`（= 2 × `DEFAULT_TRANSFORM_HANDLE_SPACING`）推出，源码注释明确警告 0.85 这个系数不得再调低；净效果是 **100% 缩放下约 6.8px、并按 1/zoom 缩放**。其命中判定统一走 `distanceToElement()`（点到轮廓距离，`packages/element/src/distance.ts` 的唯一导出）+ `distance <= threshold`；重叠消解时额外把阈值折半（`threshold = getElementHitThreshold(el) / 2`），并用 `INVISIBLY_SMALL_ELEMENT_SIZE = 0.1` 排除退化元素。

**我们该怎么做。** 现有 draft 图元只有视觉描边（`global.css` 的 `.engineering-drawing-primitive` 系列），没有命中层。两条零依赖路线，建议**同时**采用：

1. `GraphicsView.tsx`（L281-L295）已在用 **18px 透明描边**的做法，draft 视口照抄同一约定（简单、与现有代码一致）；
2. 需要"沿线取点 / 最近点捕捉"时改用**参数化距离容差**，直接套 Excalidraw 的形状：`max(strokeWidth/2 + 0.1, 0.85 * (base / zoom))`，其中 `base` 取我们的 `DRAFT_SNAP_PIXELS = 12` 或 8。**这条公式同时服务命中与捕捉，避免两套容差互相打架**（现在 `DrawingViewport.tsx` L264 只有捕捉一处容差，接夹点时 `getDragHandle` 又会有第三套——务必统一到一个函数）。

### 9. 偏移 / 修剪 / 延伸（明确列为下一片）

**事实。** QCAD 功能页列出 Trim / Extend / Offset 等标准修改工具（[features](https://qcad.org/en/documentation/features)）；FreeCAD Sketcher 有 `Sketcher Trimming` / `Sketcher Extend` / `Sketcher Offset`（[Sketcher Dialog 导航](https://wiki.freecad.org/Sketcher_Dialog)）。Excalidraw 的"拖中点插入/删除顶点"是更轻量的替代（[linearElementEditor.ts](https://cdn.jsdelivr.net/gh/excalidraw/excalidraw@master/packages/element/src/linearElementEditor.ts)）。

**我们该怎么做。** 这三个工具**依赖第 1 节的交点/最近点原语**，所以必须排在其后：修剪 = 用交点把图元切成两段并删掉指针侧；延伸 = 把图元端点投到目标实体的交点；偏移 = 沿法向平移并重建（线段/圆弧可直接算，折线需处理连接处）。**本轮不做**，但第 1 节的几何原语要按"能被修剪复用"的粒度设计（返回参数 t / 弧长而不是只有坐标）。

---

## 针对本仓库的优先级建议

**下一片（建议直接做，全部纯 SVG/React，零新依赖）**

| 顺序 | 改动 | 落点 | 依据 |
| --- | --- | --- | --- |
| **N1** | **`SnapKind` 扩展 + 交点/垂足/切点/最近点/象限点计算**，几何算法进 `packages/geometry-kernel`（按 `line`/`ray`/`segment` 类型做范围过滤） | `apps/web/src/drafting.ts` L23、L107-L127；`packages/geometry-kernel` | [QCAD RSnap 分层](https://qcad.org/doc/qcad/latest/developer/class_r_snap.html)、[LibreCAD 捕捉清单](https://docs.librecad.org/en/latest/ref/snaps.html)、[Paper.js getNearestLocation](https://paperjs.org/reference/pathitem/) |
| **N2** | **`rankDraftSnaps` 返回有序候选 + Tab 循环**（`nearest` 垫底，Tab 需 `preventDefault`） | `drafting.ts` L133-L145 → 新增函数；`DrawingViewport.tsx` 加 `cycleIndex` + `onKeyDown` | [AutoCAD Tab 循环](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-MAC-Core/files/GUID-9882004A-97FA-446A-84AB-13E061965034.htm)、[tldraw points > outline](https://tldraw.dev/sdk-features/snapping) |
| **N3** | **极轴改为阈值触发（±3°）+ 正交/极轴互斥 + F8/F10** | `drafting.ts` 新增 `snapAngle`（保留 `constrainAngle`）；`DrawingViewport.tsx` L240、L268、L322 | [Function Key Reference](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-Core/files/GUID-ACAA0279-047D-458E-889F-60BBFDD40489.htm)、[Polar Tracking](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-7EC3C63D-EA4E-4E65-A676-C3A3627E3F19.htm)、[Konva rotationSnapTolerance](https://konvajs.org/docs/select_and_transform/Rotation_Snaps.html) |
| **N4** | **接线 `snapToGrid` + `draftGridSnapStep`**（目前已写未用），`grid` 排在对象捕捉之后 | `drafting.ts` L97-L100、L148-L151 接入 `DrawingViewport.tsx` `resolvePointer` | [FreeCAD 20% 栅格吸附](https://wiki.freecad.org/Sketcher_Dialog)、[Excalidraw 8px÷zoom](https://cdn.jsdelivr.net/gh/excalidraw/excalidraw@master/packages/excalidraw/snapping.ts) |
| **N5** | **draft 视口接入 `interaction.ts` 夹点**（容差必须传屏幕像素换算值，不要用默认 0.35） | `DrawingViewport.tsx` 渲染 `data-drag-handle`（照抄 `GraphicsView.tsx` L260）、pointerdown/up → `App.tsx` `handleDragEnd` | [Fabric Control](https://cdn.jsdelivr.net/gh/fabric@7.4.0/dist/src/controls/Control.d.ts)、[Konva Transformer](https://cdn.jsdelivr.net/gh/konvajs/konva@master/src/shapes/Transformer.ts) |
| **N6** | **框选 + 方向语义 + Esc 分级 + 重复上一命令** | `App.tsx` `selectBox`；`App.tsx` Esc 处理 | [窗口选择方向](https://blog.autodesk.io/get-direction-of-window-selection/) |
| **N7** | **`apps/web/src/draftingInput.ts`**：`x,y` / `@dx,dy` / `@d<a` / `#x,y` + Tab 切字段 + 退格跨字段 + Esc 只清缓冲 | 新建模块；`DrawingViewport.tsx` 加 `tabIndex` | [F12 Tab between fields](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-Core/files/GUID-ACAA0279-047D-458E-889F-60BBFDD40489.htm)、[Web CAD 输入状态机](https://dev.to/kulman_lab_9ff2748a5207d1/building-a-web-cad-how-we-implemented-precise-xy-coordinate-input-2i55)、[JSketcher 语法](https://github.com/xibyte/jsketcher/blob/main/web/app/sketcher/tools/tool.js) |
| **N8** | **命中层（18px 透明描边或参数化距离容差）** | `DrawingViewport.tsx` 图元渲染 | [Konva hitStrokeWidth](https://konvajs.org/api/Konva.Shape.html#hitStrokeWidth)、[Excalidraw collision](https://cdn.jsdelivr.net/gh/excalidraw/excalidraw@master/packages/element/src/collision.ts) |
| **N9** | **相对零点（可设、可锁）** | draft 视图状态 + `draftingInput.ts` | [LibreCAD relative zero](https://docs.librecad.org/en/latest/ref/snaps.html) |

**其后一片**：偏移 / 修剪 / 延伸（依赖 N1 的几何原语，且原语要按"返回参数 t / 弧长"的粒度设计）。

**P1（需要新依赖或较大改造，先评估，本轮不建议做）**

| 改动 | 参考 | 代价与许可证风险 |
| --- | --- | --- |
| 几何约束求解（重合/水平/垂直/平行/相切/等长） | JSketcher、SolveSpace、FreeCAD | JSketcher 许可要求回贡 + 版权转让（非 OSI）；SolveSpace 是 **GPL-3.0**，其求解器若链接进前端产物有 GPL 传染风险。**只借鉴交互思想**。若将来确需，纯 JS 轻量求解器（JSketcher 证明纯 JS 数值求解足以支撑 16 种约束）远小于引入第三方 |
| 曲线最近点/交点的高阶能力 | Paper.js（MIT） | 可接受，但 Paper.js 是 canvas-only 框架，与 SVG 主架构冲突；只借鉴 API 形状 |
| 完整橡皮筋 + 夹点框架 | Konva（MIT，~56KB gzip）、Fabric.js（MIT，~92KB gzip） | canvas 后端，且 **Fabric/Konva/Paper 都没有 SVG 渲染器**（Fabric 只有 `toSVG()` 导出，Konva 连 SVG 导出都没有），与 `vector-effect: non-scaling-stroke` 的矢量线宽策略、以及 `ProjectedDrawing[] → SVG/DXF/PDF` 导出链直接冲突。**明确不引入** |
| 反应式交互状态管理 | `@tldraw/state`（MIT，无渲染依赖） | 许可证干净、无渲染耦合，是本清单里唯一"可选的 MIT 依赖"。但当前 `useState` + 纯函数已够用，**暂不引入** |

**架构要求（比功能本身更重要）。** 交点/垂足/切点/最近点/象限点的计算属于几何算法，必须进 `packages/geometry-kernel`，`apps/web/src/drafting.ts` 只做"候选生成 + 优先级排序 + 容差筛选"的编排。理由：`drafting.ts` 现在 174 行、职责清晰，把 5 种新捕捉的几何计算塞进去会立刻失控；`DrawingViewport.tsx` 已经 354 行，更不能承接几何。这也符合 `docs/research/graphing-tools.md` 的"几何内核与 UI 分离"结论。

---

## 不在本次借鉴的内容（许可证与架构边界）

- **不引入 tldraw / `@tldraw/editor`。** 其 `package.json` 为 `"license": "SEE LICENSE IN LICENSE.md"`（[tldraw](https://unpkg.com/tldraw@5.4.2/package.json)、[@tldraw/editor](https://unpkg.com/@tldraw/editor@5.4.2/package.json)），该 `LICENSE.md` 是专有 "tldraw license"：生产环境使用被禁止、不得停用 License Key 强制校验、hobby 许可必须显示水印，官方亦自述 "it is not permissively licensed … would not be Open Source by any definition"（[License 文档](https://tldraw.dev/community/license)、[LICENSE.md](https://cdn.jsdelivr.net/gh/tldraw/tldraw@main/LICENSE.md)）。**只借鉴文档化的交互设计**（SVG overlay 指示器、`snapType: 'point' | 'align'`、`create` 型把手、Shift 15°）。只有 `@tldraw/state` 等低层包是 MIT。
- **不引入 JSketcher 代码或 WASM。** 其 LICENSE 首行是 `Copyright 2022 Autodrop3d LLC`，并附带"任何修改必须以 git pull request 形式连同**不可撤销的版权转让**提交给 Autodrop3d LLC；未购买商业许可而不回贡将导致本许可授予的全部权限失效"（[LICENSE](https://raw.githubusercontent.com/xibyte/jsketcher/main/LICENSE)）；GitHub 元数据为 `NOASSERTION`。**不能当作 MIT/GPL 依赖评估。** 同时纠正一条常见误解：**它没有打包 SolveSpace**，2D 求解器是自研纯 JS。
- **不复制 GPL/AGPL 桌面 CAD 代码。** LibreCAD（**GPL-2.0**）、QCAD（**GPL-3.0**，+ 商业双许可）、SolveSpace（**GPL-3.0**）、OpenSCAD（**GPL-2.0**）只作交互范式参考；FreeCAD（**LGPL-2.1**）相对宽松但 C++/Qt 无法复用。
- **不引入 canvas 渲染框架（Konva / Fabric.js / Paper.js / Excalidraw 的渲染层）。** 与现有 SVG 渲染架构、`vector-effect: non-scaling-stroke` 线宽策略、以及 SVG/DXF/PDF 导出链冲突。
- **不引入 Snap.svg。** Apache-2.0 无许可风险，但活跃度低、无容差命中、路径只是 `d` 字符串，对已用原生 SVG 的 React 19 + TS 应用属负收益。**只参考两处实现**：`Snap.snapTo(values, value, tolerance=10)` 的网格吸附语义，以及 `Snap.closestPoint(path, x, y)` 的路径最近点（几十行可原生实现，利用 SVG 的 `getTotalLength`/`getPointAtLength` 扫一遍再二分细化）。注意**不存在 `Snap.path.getClosestPoint`**。
- **不引入 OpenJSCAD / OpenSCAD 的脚本式建模。** 代码驱动范式与点击式绘图是两条路，塞进绘图模式只会让交互更复杂。
- **不引入"以屏幕坐标为真相"的第二套吸附状态。** 所有捕捉必须在世界坐标完成，屏幕像素只用于换算容差（现有 `DrawingViewport.tsx` L264 已是正确写法，要保持）。
- **不让吸附产生隐藏状态。** 采纳 FreeCAD 明文原则：`snapping is just a drawing aid, it does not produce additional constraints`（[Sketcher Dialog](https://wiki.freecad.org/Sketcher_Dialog)）。吸附只改这一次落点的坐标，不在文档里留"被吸附过"的标记，否则 undo/重做和 DSL 纯洁性都会被污染。
- **不因本轮调研新增任何运行时依赖。** N1–N9 全部可用现有 React + SVG + `drafting.ts` + `interaction.ts` 完成。

## 许可证速查（2026-09-16 核对）

| 宽松（可用于依赖） | 传染性 / 非标准（只借鉴思想） |
| --- | --- |
| Excalidraw — MIT；Konva — MIT；Fabric.js — MIT（v7.4.0）；Paper.js — MIT；JSXGraph — MIT/LGPL-3.0 双许可（可选 MIT）；Snap.svg — Apache-2.0；OpenJSCAD — MIT；`@tldraw/state` — MIT；**FreeCAD — LGPL-2.1** | tldraw / `@tldraw/editor` — **自定义生产许可，非 MIT**；**JSketcher — Autodrop3d 自定义许可 + 强制回贡/版权转让**；**LibreCAD — GPL-2.0**；**QCAD — GPL-3.0（+ 商业双许可）**；**SolveSpace — GPL-3.0**；**OpenSCAD — GPL-2.0** |

许可证信息以各仓库当前 `LICENSE`、`README`、`package.json` 和发布版本为准。MathCanvas 不直接嵌入上述项目代码；如果未来引入依赖，必须在引入前重新核对版本、许可证和许可证兼容性。

## 结论

1. **稳定坐标窗口 / 橡皮筋预览 / 端点中点圆心捕捉 / 正交已经落地**（`drafting.ts` + `DrawingViewport.tsx`），"画不准、坐标系会跳"的原始问题已解决；本轮的增量价值全部在"尚未实现"那一节。
2. **下一片的第一优先级是扩展捕捉类型（交点/垂足/切点/最近点/象限点）+ Tab 循环**。现在缺 `nearest` 兜底，用户无法表达"点在线上"这一最常用的工程意图；而 `SnapKind`、`SnapCandidate`、`resolveDraftSnap` 的形状已经允许增量扩展，改动面小、收益大。
3. **`rankDraftSnaps` 与 `snapAngle` 是两个纯函数级别的改动**，`snapToGrid` / `draftGridSnapStep` 甚至已经写好只是没接线——这三件事加起来的成本远低于它们带来的手感提升。
4. **夹点编辑不要重写**：`interaction.ts` 的 `getDragHandle` / `createDragAction` 已被数学模式验证，draft 视口只需接线并把容差换成屏幕像素换算值。
5. **几何算法进 `packages/geometry-kernel`**，且要按"返回参数 t / 弧长"的粒度设计，为后面的修剪/延伸/偏移留出复用面。
6. **交互范式可以自由借鉴，代码和依赖不行。** 收益最高的 N1–N9 全部零新依赖；本清单里唯一许可证干净的第三方是 `@tldraw/state`（MIT），但当前架构不需要它。

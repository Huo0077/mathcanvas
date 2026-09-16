# MathCanvas 项目进度

> 这份文件是项目的单一进度记录。每完成一个可验证的切片，就更新“已完成”和“下一步”，并附上验证证据。

**最后更新：** 2026-09-16
**当前阶段：** P0-P6 与 P7 工程制图已完成；MathCanvas 统一 Ribbon UI 基线、2026-09-16 后续 UI 优化（Task 7-13）与**工程制图视觉重做（Task 14）**均已完成。新会话进入内部 `conics` 工作区（界面显示「平面几何」），三个工作区共用可折叠命令区，CAD 保留工程树与上下文检查器，窄屏增加对象/属性抽屉。右侧检查器已移除约束与智能体展示（约束数据保留），3D 画布显示点名并在底部提示法向量/示例二面角状态；工程制图采用「制图台 + 图纸」层次，图纸等比适应并带显式缩放入口。P4 Agent 与 P5 题图解析仍在排除范围内。
**总体状态：** 开发中

### CAD 2D 绘图交互重做（2026-09-16）

- **用户反馈**：「工程绘图似乎不好画图」，要求参考开源项目优化。
- **复现与根因**（读 `DrawingViewport` 实测，三条都是硬伤，不只是手感）：
  1. **坐标系随内容跳**：`draftBounds(document)` 按已画内容自适应算 viewBox，空文档是 `-4..4`；画下第一个点后窗口立刻缩放到该点附近 → 用户落第二个点时参照系已经换了，等于没法连续作图。
  2. **创建过程零反馈**：`creationStep` 只存在于 `App`，没有传给视口，所以画直线/圆/圆弧/折线时画布上什么都不显示，必须点完最后一下才知道对不对。
  3. **没有捕捉与约束**：点击直接按像素换算成图纸坐标（会是 `-13.7264957` 这种值），既无法对齐已有端点/中点/圆心，也无法画水平线；同时 2D 模式下 `view.scale` 完全没被使用，标题栏的 −/＋ 是死按钮。
- **修复**（纯 SVG/React，无新依赖）：
  - 新增 `apps/web/src/drafting.ts` 纯内核：`draftWindow`（固定窗口，比例 1 跨 100，只随 `view.scale` 缩放）、`draftGrid`（主 10mm 自适应加粗 + 次 1mm 仅在屏幕间距 ≥8px 时显示）、`clientToDraft`（像素→图纸坐标，y 向上，落点收敛到 0.001）、`draftSnapCandidates`（端点/中点/圆心）、`resolveDraftSnap`（**捕捉优先级 端点 > 中点 > 圆心**，同级取最近，容差外返回 null 以保留自由落点）、`constrainAngle`（正交 90°/极轴 45° 投影）、`draftMeasurement`（长度 + 0–360° 方位角）。
  - `DrawingViewport`：2D 模式改用固定窗口与栅格；新增指针悬停 → 捕捉 → 角度约束的解析链路（**捕捉优先于正交**，用户明确指到端点时不被拽到轴线上）；渲染橡皮筋预览（直线/线段/射线/折线/圆/圆弧与最终形状同构）、捕捉标记与类型标签、实时「长度 · 角度」读数；标题栏新增「自由 → 正交 → 45°」切换按钮，按住 `Shift` 可临时正交。做图元绑定：这些图层都是临时 UI 状态，不写进 `.mgeo`。
  - `DrawingSheetView` / `App`：把进行中的 `creationStep` 透传给绘图视口，仅用于预览。
- **RED→GREEN 证据**：`drafting.test.ts` 16 个用例先因模块不存在整体失败；`DrawingViewport.test.tsx` 新增 5 个用例先在旧实现上失败（固定窗口 `expected "0 -48.4 100.7 100.7" to be "-50 -50 100 100"`、捕捉标记不存在、`[data-draft-preview]` 不存在等）。实现后全部通过。过程中修掉两个自己写错的断言（缺自适应网格导致缩小后画 202 条主网格线；像素→坐标换算算错）。
- **既有测试的行为微调**：「maps a drafting click on the paper to document coordinates」改用空文档作为夹具——旧夹具的线段端点落在 12px 捕捉半径内，会被新吸附正确吸住，而这条用例本意只是验证坐标映射；另把 `-0` 归一为 `0`。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例断言拖动时有预览与读数、画完 `viewBox` 与画前完全一致、指针靠近已有端点时出现 `[data-draft-snap="endpoint"]`。
- **回归**：全量单测 60 个测试文件、567 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条既有 warning（无新增）；生产构建通过；Playwright 38/38 通过。
- **开源调研（已完成）**：`docs/research/drafting-interaction-patterns.md`（176 行、89 条来源链接、27 处许可证标注）。文档以「现状基线（已实现）」+「尚未实现」开头，把调研重点放在未完成部分：交点/垂足/切点/最近点/象限点捕捉、捕捉候选 Tab 循环、动态输入与命令行坐标、夹点编辑、框选方向语义、命中容差、偏移/修剪/延伸；并给出「不借鉴」清单与许可证速查（QCAD 是 **GPL-3.0**、JSketcher 为 Autodrop3d 自定义许可，均不能按宽松依赖评估）。
- **本轮补完的两项（调研文档点名的缺口）**：
  1. **栅格捕捉接线**：`snapToGrid` + 新增 `draftGridSnapStep`（取最细可见网格：次网格可见时 1mm，否则主网格）此前是死代码；现在标题栏有独立开关，捕捉优先级为 **对象捕捉 > 栅格捕捉 > 角度约束**（有专门的用例：端点位于非整格坐标 `(3.5, 7.25)` 时，开了栅格捕捉仍然吸到端点）。
  2. **极轴语义修正**：`constrainAngle` 原先对所有角度都取最近 45° 倍数 —— 那不是极轴追踪而是"把光标永久锁在 45° 的倍数上"。现在加了 `thresholdDegrees`：正交（含 Shift）**始终**压到轴上，45° 极轴**只在指针偏离射线 ≤4° 时**吸附，否则保持自由落点。
- **本轮抓到的一个真实缺陷**：`resolvePointer` 的返回值被 TypeScript 推断成 `snap: string | null`，`npm run typecheck` 报 TS2345。`vite build` 只做类型擦除，不会发现这类错误——这正是 typecheck 必须单独跑的原因。已用显式返回类型修掉。
- **RED→GREEN 证据（本轮）**：`drafting.test.ts` 新增 4 个用例（最细网格步长、正交严格性、极轴阈值内/外）与 `DrawingViewport.test.tsx` 新增 2 个用例（栅格捕捉默认关闭→开启后量化到 10mm；对象捕捉优先于栅格捕捉），实现后 33 个聚焦用例通过。
- **回归（本轮结束）**：全量单测 60 个测试文件、572 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条既有 warning（无新增）；生产构建通过；Playwright 38/38 通过（e2e 新增断言：栅格捕捉开关从 `off` → `on`，且远离图元处出现 `[data-draft-snap="grid"]`）。
- **仍未做**：动态输入与命令行坐标（`@dx,dy` / `@d<a`）、框选方向语义（左→右包含 / 右→左相交）、命中容差、切点捕捉、偏移/修剪/延伸。优先级与开源参考见该文档的「针对本仓库的优先级建议」。

### 偏移 / 修剪 / 延伸（调研清单最后一片，2026-09-16 已完成）

- **内核几何**（新增 `packages/geometry-kernel/src/editing.ts`，13 个用例）：`offsetPrimitive`（直线类沿**行进方向左侧**平移，负值右侧；圆/圆弧改半径且拒绝 ≤ 0；折线逐段偏移后用相邻偏移线求**斜接点**，折返平行时退回直接平移顶点）、`trimPrimitive`（目标支撑直线 ∩ 边界，边界按自身范围过滤、目标不过滤，保留靠近 `near` 的一半）、`extendPrimitive`（只接受落在当前跨度**之外**的交点；边界落在跨度内时返回 null，那是修剪该干的事）。三个函数只返回几何结果，不依赖 scene-graph。
- **Web 映射**（新增 `apps/web/src/draftEditing.ts`，11 个用例）：`resolveGeometryEdit` 做前置条件校验并组装文档补丁。
- **写错后改掉的语义**：真正的 OFFSET 应**新建**一个平行对象，我最初实现成"把选中对象移走"——那是移动命令。现在偏移 → `create`，修剪/延伸 → `update`；复制时**不继承 `slopeParameter`**（副本不该继续被原对象的参数驱动）。typecheck 还抓到我漏了类型收窄（圆没有 a/b，不能修剪），已补显式判断与用例。
- **视口 UI**：绘图视口新增「偏移距离 + 偏移 / 修剪 / 延伸」，按选中数量门控（偏移需 1 个、修剪/延伸需 2 个），规则写进按钮 `title`，成败走 CAD 状态栏提示。
- **浏览器里挖出的真实 bug（本片最大收获）**：偏移之后再画图元会被**静默丢弃**——`data-revision` 不变、`role="alert"` 为空、CSV 导出（权威文档内容）里也没有新对象，但状态栏流程正常走完。定位过程：先在 jsdom 复现同一流程（**正常**，说明不是 store/App 逻辑）→ 浏览器探针确认连续两次创建**本来正常**（所以与偏移有关）→ 用 CSV 导出排除"只是没渲染" → 用 `data-revision` 排除"apply 生效了"。结论：`creationStep` 被清空但没有任何 apply，唯一符合的路径是**点到已有图元时 `updateSelection` 清掉了创建状态**——即 2D 绘图视口缺少"创建优先"的点选语义（数学画布 `GraphicsView.handleObjectClick` 早就有），而我这一轮刚把命中带加宽到 14px，于是"第二点落在已有图元附近"就更容易触发。
  - **修复**：`DrawingViewport` 新增 `handleDraftPrimitiveClick`——创建进行中点图元走 `onCreateAt`（并保留吸附与 Tab 候选序号），没有创建时才选中。同时把 `resolvePointer` 改成显式接收 `svg/clientX/clientY`，这样从图元组的事件里也能取到正确的元素矩形。
  - **回归测试**：`DrawingViewport.test.tsx` 新增 2 个用例（创建中点击图元 → 落点且**不**选中，落点仍是吸附后的端点 (2,1)；无创建时点击 → 选中）。
- **RED→GREEN 证据**：`editing.test.ts` 13 个用例先因模块不存在整体失败；`draftEditing.test.ts` 10 个用例先因模块不存在失败，改语义后又补了 1 个（圆不能修剪）；e2e「offsets, trims and extends」在修复前**必定失败**（延伸按钮拿不到 2 个选中）。
- **浏览器实测**：e2e 覆盖偏移（1→2 个图元、revision 增加、状态栏"已偏移"、副本与原线平行且有间距）+ 延伸（短竖线拉到边界、高度增加、状态栏"已延伸"）+ 修剪（穿线被剪短、状态栏"已修剪"）；选择用模型树行点选（命中带可能重叠，树行是确定性的，顺序正好是"先边界后目标"）。
- **回归**：全量单测 65 个测试文件、672 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 43/43 通过。
- **边界**：偏移只做平行复制（不做等距曲线族的自交清理）；修剪/延伸只支持直线、线段、射线；圆/圆弧修剪（拆成多段圆弧）明确列为未实现，遇到会报错而不是猜。

### 切点捕捉 + 工程图线宽与命中容差（调研清单收尾 ①②⑦，2026-09-16 已完成）

- **切点捕捉**（调研清单里的最后一种捕捉类型）：
  - 内核 `snap-geometry.ts` 新增 `tangentPointsOnPrimitive(primitive, from)`：直角三角形 C-T-P 在 T 处为直角，切点相对 C→P 方向偏转 ±`acos(r/d)`；锚点在圆内返回空、正好在圆上只有一条（切点即锚点）、圆弧只保留扫过范围内的切点。
  - `drafting.ts` 的 `SnapKind` 增加 `tangent` 并插在 `perpendicular` 之后（`nearest` 仍然垫底）；候选只在有创建锚点时生成；视口标签显示「切点」。
  - 测试里发现一个真实细节：锚点在圆心正上方时 `(0,5)` 同时是**垂足**和**象限点**，而象限点优先级更高——所以"垂足必然胜出"的断言是错的，改成断言两类候选的相对顺序（这也顺带证明了去重与优先级确实生效）。
- **命中容差（调研第 8 项「细线点不中」）——挖出的根因比预期严重**：
  - 用临时 Playwright 探针实测：绘图图元的 `getComputedStyle().strokeWidth === "0.04px"`，`vector-effect: non-scaling-stroke` 下这个值就是**屏幕像素**，所以整张工程图本来就是一条约 `0.04px` 的**隐形线**；`elementFromPoint` 在离中心 `1px` 处就已经点不中（命中带约 `0.1px`）。即"不好画图"的一半原因是**看不见也点不中**。
  - 修复一（可见）：`.engineering-drawing-primitive` 与 `.engineering-drawing-draft` 的线宽从 `0.018/0.022/0.04` 改为 `1.4/1.6`、选中 `2.4`（单位就是屏幕像素）。
  - 修复二（可点）：绘图与投影图元各加一条 **14px 透明命中带**（`data-drawing-hit="true"`）。
  - **两次被 CSS 级联击败**（都由 e2e 度量发现，而不是肉眼）：`.engineering-drawing-hit`（0,1,0）先被 `.engineering-drawing-draft line`（0,1,1）覆盖；提成 `(0,2,0)` 后又被 `.engineering-drawing-draft.is-selected line`（0,2,1）覆盖。最终改为**内联样式**给宽度（inline 胜过任何选择器），CSS 只留 `cursor`。
  - 第三次失败是单位搞错：`non-scaling-stroke` 意味着宽度**本身就是像素**，而我先填了世界单位的 `2.69`（≈2.7px 带）。改成直接给 `14`。
  - 还纠正了自己一个错误度量：最初用 `getBoundingClientRect().height` 当"渲染高度"（量到 0.085），但 SVG 的 gBCR **不包含** `non-scaling-stroke` 的描边宽度，这个数不能用；真正的证据是计算线宽。
- **RED→GREEN 证据**：`snap-geometry.test.ts` +4（两个切点、圆内/圆上退化、圆弧扫过范围、直线无切线）；`drafting.test.ts` +2（切点候选只在有锚点时生成、切点排在垂足之后）；新增 e2e `e2e/engineering-drawing-hit.spec.ts`——断言计算线宽 ≥ 1px、`elementFromPoint` 在离中心 0/2/5px 处都命中图元、点击离线 5px 处确实选中而不是新建图元。**这个 e2e 用例在修复前必然失败**（线宽 0.04、1px 就点不中），它同时钉住了两个缺陷。
- **回归**：全量单测 63 个测试文件、642 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 42/42 通过。
- **清单状态**：调研文档的优先级 ①②④⑤⑥⑦ 与「栅格捕捉接入捕捉链」「极轴阈值触发」全部完成；只剩原文就标注为"更后一片"的**偏移 / 修剪 / 延伸**。

### CAD 2D 绘图命令行坐标 + 动态输入（调研优先级 ⑥，2026-09-16 已完成）

- **依据**：调研文档「命令行与动态输入（坐标精确化）」——拖得再准也不如敲数字，尤其是工程图里的整数尺寸。
- **解析器**（新增 `apps/web/src/draftCoordinate.ts`，13 个用例）：支持 AutoCAD 的三种写法——绝对 `12,34`、相对 `@10,5`、极坐标 `@20<45`；另接受空格分隔与**全角逗号**（中文输入法下不用切换），负小数可解析；相对/极坐标**必须有基点**，否则报错而不是悄悄按原点算；单数字不是坐标（交给动态输入的长度字段）；非有限值（如 `1e999`）被拒。另有 `parseDraftDistance`（必须 > 0）、`parseDraftAngle`（归一化到 0–360）、`applyDistance`（只改长度、保留指针方向，指针压在锚点上时退回 +x 避免除零）、`applyAngle`（只改角度、保留长度）、`formatDraftCoordinate`。
- **接线**（`DrawingViewport.tsx`）：视口工具栏新增「坐标」输入框（回车提交，落点走与鼠标点击**同一条** `onCreateAt` 路径）；创建进行中额外显示「长度 / 角度」两个字段，其 placeholder 实时显示当前指针的尺寸，回车按输入值落点（只改一个维度、另一个沿用指针）。非法输入在工具栏给出说明且不落点。
- **一个刻意的取舍**：动态输入放在视口工具栏，**不做光标旁浮层**。图纸带 CSS `zoom`，在 SVG 里用 `foreignObject` 放 HTML 输入框的定位与清晰度都不稳；固定位置换来可测、可控，键盘流（输入 → 回车）完全一致。这是本片与调研文档描述的差异，已写入功能目录。
- **RED→GREEN 证据**：`draftCoordinate.test.ts` 13 个用例（先因模块不存在整体失败）；`DrawingViewport.test.tsx` 新增 4 个（绝对坐标落点并清空输入、相对与极坐标、非法输入只报错不落点、长度/角度字段只在有锚点时出现且按 10 得到 (6,8)）。
- **e2e 的两次失败尝试（值得记录）**：想在浏览器里断言"敲进去的 40mm 就是屏幕上 40mm 的比例"，先按 padding + `preserveAspectRatio` 较小边估算比例 → 差 3.98px；再改用坐标读数自校准（两次 hover 反推每单位像素）→ 差 64px（很可能受吸附影响）。最终把精确几何留给单测（`@40<0` → 基点 +(40,0) 已有精确断言），e2e 只断言与布局无关的事实：敲完确实生成了一条**水平**、有明显长度的线段，输入框被清空，revision 增加。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例——点第一个点后键入 `@40<0` 回车生成线段 → 选中后两个夹点 y 相同、间距 > 30px。
- **回归**：全量单测 63 个测试文件、636 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 41/41 通过。

### CAD 2D 绘图方向框选 + Esc 分级（调研优先级 ⑤，2026-09-16 已完成）

- **依据**：调研文档「框选方向语义与 Esc 分级」——左→右为窗口选择、右→左为相交选择，且 Esc 要分级而不是一次性全清。
- **几何判定进内核**：新增 `packages/geometry-kernel/src/selection.ts`，导出 `pointInSelectionBox` / `primitiveInSelectionBox`（window）/ `primitiveCrossesSelectionBox`（crossing）/ `selectPrimitivesInBox`。要点：
  - 圆的"圆周是否穿过框"用**半径 ∈ [圆心到框的最近距离, 圆心到框内最远角落距离]** 判定：大圆把框整个套住时圆周并不经过框，不该被相交框选选中（去掉上界就会误选，这一点用变异检验确认过）。
  - 无界直线/射线按定义它的两个端点判定（保留数学画布的历史语义），相交模式下用一个足够长的线段近似它去和框的四条边求交。
  - 圆弧没有解析的框相交判定，按**与渲染相同的 24 段**采样，保证"看到的形状"和"选中的形状"一致；折线按其各段。
  - 顺手把 `curve-intersections.ts` 里的 `segmentIntersection` 由私有改为导出，框选与采样求交共用一份实现。
- **方向语义接线**：`drafting.ts` 新增 `boxSelectionMode`（方向→语义）与 `normalizeSelectionBox`；`GraphicsView` 与 `DrawingViewport` 都在拖动时就带上语义，矩形分别用 `data-selection-mode` / `data-draft-box` 标记，样式上窗口选择实线、相交选择绿色虚线（一眼可辨）。CAD 2D 绘图新增框选：空白处按下拖框才启动，**有创建挂起或按到图元/夹点时不启动**（否则会把"点第一个点"或"拖夹点"误判成框选）。
- **Esc 分级**（`App.tsx`）：创建/CAD 命令 → 操作指引 → 选择，逐级取消；没有待取消的动作时保持不动，不会误删文档。
- **过程中修掉的两个真实缺陷**：
  1. **`keydown` effect 依赖数组陈旧**：`creationStep` / `activeCommand` / `guidance` 都不在依赖里，分级 Esc 读到的全是旧值、按下去毫无反应。已补齐依赖。
  2. **`selection.ts` 重复的 circle 分支**：恢复变异时把整个分支写重了，第二个分支被 TypeScript 窄化成 `never` 而报错——由 `npm run typecheck` 抓到（`vite build` 只做类型擦除，发现不了）。
- **变异检验（两次，结果不同）**：第一次删掉 crossing 的"包含即相交"早返回 —— **没被抓到**，因为该性质对每种类型都是结构性成立的，这个变异是语义等价的、什么也没证明；第二次去掉圆的"最远距离"上界 —— 被抓住（"套住框的大圆"用例 `expected true to be false`）。这说明第一版测试的强度边界，也说明变异检验本身需要挑真正有区别的变异。
- **RED→GREEN 证据**：`selection.test.ts` 13 个用例（两种语义、圆的相切/套住/穿过、无界图元、折线与圆弧采样、跳过 `point3`）；`drafting.test.ts` +2（方向→语义、矩形归一）；`DrawingViewport.test.tsx` +2（拖动中矩形带正确语义并在松手时提交、有创建挂起时不启动框选）；`App.test.tsx` +1（Esc 分级：先关指引、再清选择、文档不变——这条用例第一次写错，暴露了"指引优先于选择"的真实顺序）。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例——画线段后右→左拖框（断言 `data-draft-box="crossing"` 出现 → 线段 `data-selected="true"` → `data-revision` 不变），再左→右拖一个不完整包含的框（断言 `data-draft-box="window"` → 不选中）。
- **回归**：全量单测 62 个测试文件、619 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 40/40 通过。
- **边界**：数学画布的函数、圆锥曲线与派生曲线仍只有"完全包含"语义（没有解析的框相交几何）；CAD 绘图还没有「先框选再执行移动/删除」的命令式工作流，框选目前只改选择状态。

### CAD 2D 绘图夹点编辑（调研优先级 ④，2026-09-16 已完成）

- **依据**：调研文档把「夹点编辑」列在捕捉之后，并明确要求**直接复用 `interaction.ts`，但容差必须按屏幕像素换算，不能用默认 0.35**。
- **做了什么**：
  - `interaction.ts` 新增 `primitiveHandlePoints(primitive)`，把控制点几何从 `GraphicsView` 里提出来成为共享纯函数（线段/射线端点、折线顶点、抛物线顶点与旋转、圆半径、圆弧起止角与半径中点、椭圆/双曲线三轴）；`GraphicsView` 改为调用它，**两个视口不再各写一份手柄几何**（派生对象、锁定对象、无手柄图元一律返回空数组）。
  - `DrawingViewport` 新增夹点：选中图元才显示控制点；按下控制点 → `createDragAction(primitive, handle, origin, current)`；按下图元本体 → 先用 `getDragHandle(primitive, point, gripTolerance)` 判断是否落在控制点上，否则整体平移。拖动期间用 `applyOperation` 生成**临时文档**做预览（端点移动时关联交点跟着重算），指针抬起才把 `DragAction` 交给 App 提交成一次可撤销改动；位移小于半个夹点半径视为误触，不提交。
  - 容差换算：`gripTolerance(width) = DRAFT_GRIP_PIXELS / width * span`（`DRAFT_GRIP_PIXELS = 8`）。调研文档点名的这个坑是真的——默认 0.35 世界单位在跨度 100 的窗口里只有约 1.7px。
  - `DrawingSheetView` / `App` 透传 `onDragEnd`，与数学画布共用 `handleDragEnd`（`translatePrimitive` / `updatePrimitive`）。
- **RED→GREEN 证据**：`interaction.test.ts` 新增 3 个用例（端点手柄、折线/圆/圆弧手柄、锁定与派生对象无手柄）；`DrawingViewport.test.tsx` 新增 4 个（选中才显示夹点、拖端点提交 `update` 动作、微小位移不提交、拖本体提交 `translate`）。实现后 28 个聚焦用例通过。
- **过程中修掉的自己的错**：测试里把端点 `(-2,-1)` 的像素位置算成 `clientY 208`（实际 204，窗口 400px / 跨度 100 → 4px 每单位）；另一个用例拿半径 1 的小圆测"拖本体"，但 8px 夹点容差等于 2 世界单位，圆心的按下被正确判成半径编辑——改成拖线段本体（中点距端点 2.24 单位，超出容差）才测到翻译语义。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例——画线段 → 点本体选中 → 断言出现 `[data-draft-handle="a"]` → 按住拖动（断言 `data-draft-dragging` 由 true 变 false）→ `data-revision` 增加 → 夹点位置随端点移动。
- **回归**：全量单测 61 个测试文件、601 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 39/39 通过。

### CAD 2D 绘图捕捉扩展（调研优先级 ① ②，2026-09-16 已完成）

- **依据**：`docs/research/drafting-interaction-patterns.md` 把「扩展捕捉类型」与「捕捉候选排序 + Tab 循环」列为最值得先做的两项；本切片按该优先级实施。
- **几何原语落在内核**（文档要求，不在 UI 里重复实现几何）：新增 `packages/geometry-kernel/src/snap-geometry.ts`，导出 `nearestPointOnPrimitive` / `perpendicularPointOnPrimitive` / `quadrantPointsOnPrimitive` / `planarIntersections`。实现要点：
  - 图元先拆成「支撑直线 + 范围规则」或「圆 + 范围规则」两种原子（折线拆成多段、圆弧按扫过角过滤），范围判定统一在原子层，因此"看起来在图元上"和"真的在图元上"一致。
  - `nearest` **夹取**到实体自身范围（线段收到端点、射线收到起点、圆弧收到扫过范围内的最近端点），这是"实体上最近点"的数学定义；`perpendicular` **不夹取**——脚点落在实体之外时垂足不存在。
  - 交点复用既有 `intersectLinesDetailed` / `intersectLineCircleDetailed` / `intersectCirclesDetailed`，只补范围过滤与去重，不重写求交算法。
- **候选编排与排序**（`apps/web/src/drafting.ts`）：`SnapKind` 扩展为 `endpoint | intersection | midpoint | center | quadrant | perpendicular | nearest | grid`；新增 `rankDraftSnaps(raw, candidates, { tolerance, primitives })` 返回**按优先级 → 距离排序**的候选数组，并按位置去重（两条线段共端点时"端点"与"交点"重合，只保留优先级更高的）。`nearest` 由指针位置决定，不能预先列举，因此只在排序时按 `primitives` 现算，并**固定排在最后**——否则它在数学上永远最近，会吃掉所有其他候选。`resolveDraftSnap` 保留旧签名（返回最优候选）以兼容既有调用与测试。
- **视口接线**（`DrawingViewport.tsx`）：候选按「文档 + 锚点」`useMemo` 缓存（交点计算是 O(n²)，不能每次指针移动重算）；垂足需要创建锚点，因此把 `creationAnchor` 作为 `from` 传入；命中多个候选时按 **Tab** 循环（`<svg>` 在 2D 模式获得 `tabIndex`，`onKeyDown` 里 `preventDefault`），标记标签显示「交点 2/3（Tab 切换）」与 `data-draft-snap-candidates`，让状态可被测试与 e2e 断言。
- **RED→GREEN 证据**：`snap-geometry.test.ts` 15 个用例（象限点、圆弧扫过范围、最近点夹取、垂足不夹取、线段/直线/圆/圆/折线/圆弧求交与范围过滤）；`drafting.test.ts` 新增 6 个（象限点、交点、垂足需要锚点、按优先级去重、`nearest` 垫底、极轴阈值）；`DrawingViewport.test.tsx` 新增 2 个（交点与象限点捕捉标记、Tab 循环后点击落在第 2 个候选上）。实现后 40 个聚焦用例通过。
- **本轮修掉的两个自己写错的地方**（都由门禁而不是肉眼发现）：`drafting.ts` 里旧的 `*_PRIORITY` 常量未删除导致重复声明（esbuild transform 直接失败）；`nearestPointOnPrimitive` 里 `candidate` 的初值从未被使用，被 ESLint `no-useless-assignment` 判为 **error**。另外把「圆弧最近点在扫过范围外」的语义从"返回 null"改成"夹取到圆弧端点"，并修正了测试里标错方向的"下半圆"用例（0°→90° 的四分之一圆弧才是可判定的）。
- **回归**：全量单测 61 个测试文件、594 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 38/38 通过（e2e 增加"实体中段给最近点"的断言）。

### Ribbon UI 重构（2026-09-15）

- [x] 统一 Top Bar、工作区 Tab 和 Ribbon；移除重复的工作区按钮与旧命令入口。
- [x] 实现折叠、临时呼出、图钉固定和 `Ctrl + F1` 快捷键；修复折叠态点击图钉时被外部点击逻辑提前关闭的问题。
- [x] 默认工作区使用内部 `conics`；保留立体几何、CAD 和旧 `.mgeo` 兼容。
- [x] Inspector 显示精简空状态、对象名称及锁定/删除快捷操作。
- [x] 底部状态提示覆盖选择、创建阶段和 CAD；Escape 取消命令并恢复默认提示。
- [x] 390px 手机视口采用对象列表/属性检查器抽屉；修复内容超过 `100vh`、顶部搜索框遮挡标签的问题。
- [x] 将旧 E2E 选择器迁移到新 Ribbon 命令和 Inspector 交互。

**Ribbon 基线验证（2026-09-16）：** `npm.cmd test` 为 59 个测试文件、533 个用例通过；四个 workspace 类型检查通过；ESLint 0 error、40 warnings；Web 生产构建通过；Playwright 34/34 通过，覆盖桌面、平板、手机视口、Ribbon 折叠/临时呼出/固定、CAD 工作流与 `.mgeo` 往返。修复后的操作指引浮层不再覆盖状态栏，Ribbon 外部点击回归通过。Vite bundle 仍提示超过 500 KB（约 1.52 MB，gzip 约 476 KB）；jsdom 的 Three.js WebGL 未实现提示不影响测试结果。

### 2026-09-16 后续 UI 优化（Task 7-13，已完成）

- [x] 将工作区显示名从“圆锥曲线”改为“平面几何”，保留内部 `conics` ID 和旧文件兼容。
- [x] 将平面几何新点默认名统一为 `A、B、C`（`Z` 之后回退 `P27`…），补充 3D 场景点名显示。
- [x] 将图元重命名入口移动到默认可见的「几何参数」区（原先只在需展开的「外观样式」里）。
- [x] 将多模态入口收敛为“文字转换”和“图片转换”；服务未接入时保持禁用并说明原因。
- [x] 从右侧属性区移除约束和智能体展示，但保留约束数据和真实测量能力。
- [x] 根据 Dock 展开状态扩大工程制图中间画布。
- [x] 修复工程制图图纸本身没有铺满画布的问题（按可用区域等比缩放并居中）。
- [x] 工程制图视觉重做（Task 14）：制图台 + 图纸层次、图框与图签、视图框刻度、显式缩放与响应式修复。
- [x] 在选择法向量、测量二面角时补充左下角操作提示。

详细设计与分任务步骤见 [`docs/superpowers/specs/2026-09-15-ribbon-ui-redesign.md`](./superpowers/specs/2026-09-15-ribbon-ui-redesign.md) 和 [`docs/superpowers/plans/2026-09-15-ribbon-ui-redesign.md`](./superpowers/plans/2026-09-15-ribbon-ui-redesign.md)。

#### Task 7：平面几何改名、A/B/C 点名与重命名入口

- **可见名称**：`WorkspaceTabs` 的标签改为「平面几何」，`conics` ID、`.mgeo` 数据与工作区切换逻辑不变；`AppChrome.test.tsx` 断言新标签存在且「圆锥曲线」不再出现，`App.test.tsx`、`e2e/ribbon-ui.spec.ts`、`e2e/workbench.spec.ts` 的选择器同步迁移。
- **点名**：`App.tsx` 的 `nextPointLabel()` 由 `新点 A` 改为按未占用字母分配 `A`…`Z`，`Z` 之后回退 `P27`、`P28`…；测试用新的 `pointObjectRows()` 辅助函数按 `.object-name` 精确匹配单字母，避免 `getAllByText("A")` 命中坐标或其他文本。
- **重命名**：`PropertiesBar` 把「图元名称」输入框放进默认展开的 `data` 区（外观区仍保留同一字段的样式编辑），新增用例断言默认 `aria-expanded=true` 的「几何参数」区即可改名，并断言改动写回文档标签。
- **RED→GREEN 证据**：`App.test.tsx` 新增「assigns sequential point labels…」与「renames a selected primitive from the default data section」两个用例，在改名逻辑尚未接入时前者断言 `["A","B","C"]` 会失败（旧实现得到 `["新点 A","新点 B","新点 C"]`），后者在字段仍只存在于外观区时找不到可见输入框。

#### Task 8：多模态组收敛为两个禁用入口

- `ribbonCommands.ts` 的 `multimodal` 组现在只包含 `input-text-conversion`（文字转换）与 `input-image-conversion`（图片转换），两者 `disabled: true`，`disabledReason` 明确写「服务尚未接入，暂不可用」；`uiState.ts` 的 `RibbonIcon` 用 `image` 取代 `quiz`/`pen`，`Ribbon.tsx` 增加对应图标并删除旧图标。
- **证据**：`ribbonCommands.test.ts` 断言恰好两个 ID、两个标签、全部禁用及准确原因；`Ribbon.test.tsx` 断言禁用按钮渲染、`title` 说明原因、点击不触发 `onCommand`，并断言「抢答题」「画笔标注」已不存在。

#### Task 9：移除右侧约束与智能体展示，保留测量

- `PropertiesBar` 删除「几何约束」手风琴、三维约束工具卡和「暂无约束」空状态，移除 `onCreateConstraint` 属性与 `constraintOptions`；`InspectorTabs`/`EngineeringInspector` 的 CAD 页签收敛为 数据/外观/工程标注，`EngineeringInspector` 不再接收 `constraints` 插槽；`App.tsx` 卸载两处 `AgentDock`、移除 `ConstraintPanel` 插槽与 `addConstraint`/`nextConstraintId`，并删除不再引用的 `AgentDock.tsx`。
- **保留**：`document.constraints`、Scene Graph 约束操作、`.mgeo` 编码与 `ConstraintPanel`/`spatialTools` 内核均未删除；教学测量入口本就在 `data` 区，移除约束后仍在原处。
- **证据**：`App.test.tsx` 新增用例断言通用与 CAD 检查器中都不存在「几何约束」「暂无约束」「+添加」「智能体 (Agent)」「约束」页签，同时文档 `constraints` 字段仍存在；`EngineeringInspector.test.tsx` 断言没有约束插槽、并断言两个面的选择仍能从数据页签创建「二面角内角/外角」；`e2e/workbench.spec.ts` 把旧的「约束列表/已满足/删除约束」用例改为「打开含约束的旧 `.mgeo` 不再显示约束界面，但导出的 `.mgeo` 里约束记录仍有 1 条」。

#### Task 10：停靠面板收起后扩大工程画布

- `EngineeringWorkbench` 在 `.engineering-workbench` 上暴露 `data-left-open` / `data-right-open`；`global.css` 的 `.workbench-body` 按四种停靠组合给出网格列（左右都开＝250px + 1fr + 右侧宽度，单开一侧只保留可见列，都收起＝单列 1fr），中间画布始终占满剩余宽度。
- **证据**：`EngineeringWorkbench.test.tsx` 新增用例断言两个数据属性随按钮切换、画布区域始终存在、都收起时 `.workbench-body` 只剩一个子元素、重新展开后恢复两个。

#### Task 11：法向量与二面角示例的底部提示

- `statusPrompts.ts` 新增 `SceneControlMode`（`normals` / `dihedral-demo`）与 `resolveSceneControlPrompt()`；`resolveStatusPrompt()` 接受可选的 `sceneControl`，创建步骤优先，其次是场景显示提示。法向量提示说明它画的是各可见面的外法向量；二面角提示明确「显示的是坐标轴夹角的示例值，不读取你的选择」，并给出 `Alt` 单选两个面、再点「二面角内角/外角」的真实流程。
- `ThreeSceneView` 新增可选 `onStatusPromptChange`，用 `lastControlRef` 记录**最后切换**的开关（两个开关可以同时打开，提示跟随最近一次操作），App 用 `sceneControl` 状态把它交给状态栏；卸载时清空提示。
- **证据**：`statusPrompts.test.ts` 新增 3 个用例（法向量文案、示例值 + Alt + 两个测量按钮名、创建步骤优先于场景提示）；`e2e/geometry3d.spec.ts` 新增用例在真实浏览器里先开法向量看到「外法向量」，再开「测量二面角」看到「示例值」和 `Alt`，关闭后提示消失。

#### Task 12：3D 画布点名标注

- `ThreeSceneView` 新增 `three-point-label-overlay`（`aria-label="三维点标注"`）：在既有 render 循环里把每个可见 `point3` 投影到视口，用像素偏移（+10 / −10）生成带 `data-point-label` 与 `data-point-id` 的 `span`；标注层 `pointer-events: none`、`z-index: 1`，不参与 Raycaster 拾取，随相机旋转/缩放与 `ResizeObserver` 更新，文档变化时整体重建。
- **证据**：`e2e/geometry3d.spec.ts` 新增用例断言两个空间点各有一个标注、点名 `A`/`B` 可见、标注层 `pointer-events: none`，并断言「适应视图」后标注位置随之变化（说明它跟着相机走而不是留在原地）。

#### 追加修复：工程制图图纸没有铺满画布

- **现象与定位**（真实浏览器量测，1600×1000）：`.drawing-sheet` 只有 684×524，而中间画布可用区是 1058×744 —— A4 横向图纸的固定像素尺寸（594×420 + 24 边距，随视图包围盒增大）比工作区小得多，图纸看起来是一张浮在灰色底色里的小卡片。这不是停靠面板的问题（Task 10 只解决了列宽）。
- **真正的根因（第一轮修复没有生效的原因）**：`.workbench-canvas-slot` 里除了 `.engineering-drawing` 还有「显示投影线」工具栏（`.engineering-drawing-toolbar`）。画布列本身不是**确定高度的容器**，也没有把高度传下去，所以 `.engineering-drawing` 一直被内容撑到 556px（工具栏 44px + 内容 524px），中间 188px 永远是空白；只加 `height: 100%` 并不生效，因为百分比高度在这种 auto-height 块里无法解析。
- **修复**：
  - `.workbench-canvas-slot` 改为 `display: flex; flex-direction: column; height: 100%; overflow: hidden`，工具栏 `flex: 0 0 auto`，`.engineering-drawing` 用 `flex: 1 1 auto; height: 100%` 吃掉剩余全部高度。
  - `drawingGeometry.ts` 新增 `sheetFitScale(available, paper)`：等比缩放系数 = `min(可用宽/纸宽, 可用高/纸高)`，容器或纸张无有效尺寸时退回 1（PDF 式 zoom-to-fit，圆仍是圆）。
  - `DrawingSheetView` 把纸放进新的 `.drawing-sheet-area` 布局盒，用 `ResizeObserver` 量盒子实际尺寸算出 `fit`，对纸张应用 `transform: scale(fit)` + `transform-origin: center`，并在纸上写 `data-sheet-fit` 便于断言/排查；缩放走 CSS transform，视图内部的 SVG 与文字按比例放大不变形。
  - 诊断 `<details>` 作为 flex 兄弟留在图纸下方（`flex: 0 0 auto`），长内容仍可滚动查看，不会被裁掉。
- **实测效果**：1600×1000 下纸张由 684×524 变为 **856×656**（`data-sheet-fit=1.252`，占画布高度 88%），四个视图面板由 300×220 变为 **376×275**；`2D 绘图` 的单张模型视图为 991×712（fit 1.604，覆盖 94% × 96%）；两侧面板都收起时为同一张纸居中；390×844 手机视口自动缩到 fit 0.599（宽 370 / 可用 390）且无横向或纵向溢出。
- **回归**：`DrawingSheetView.test.tsx` 新增 3 个用例（缩放算法三种比例、无尺寸时退回 1:1、纸张渲染在专用布局盒内且 jsdom 下保持 1:1）；全量单测 59 个文件、**545** 个用例通过；`npm.cmd run test:e2e` 36/36 通过；`test:e2e` 与构建均重新执行。

### 工程制图视觉重做（Task 14，2026-09-16 已完成）

**用户反馈**：上一版只是把图纸整体放大，失去了美感，UI 也不贴合，要求"有美感一点"。

**加载的方法技能**：`redesign`（先审计再改，保留行为）+ `design-doctrine`（token by intent、八种状态、一个视觉焦点、不许 emoji）。`design-taste-frontend` 明确把自己限定在落地页/作品集，并把 dashboard 与稠密产品 UI 划为不适用范围，因此这里只借用它的"设计读法"（先判断受众与语境），不套用其页面级规则。

**审计（先量后改，1600×1000 真实浏览器）**：

| # | 病症（可测量） | 根因 |
|---|---|---|
| 1 | fit 把整个 DOM 一起拉大，视图标题/按钮/圆角/线宽按 1.25–1.6 倍膨胀 | 用 `transform: scale()` 缩放包含 UI 的整张纸 |
| 2 | 纸张、视图框、画布三层几乎同色（#ffffff / #f8f7fc / #f4f4f8），没有视觉焦点 | 复用通用面板 token，缺制图专用表面色 |
| 3 | 视图框越出图框：视图右/下边到 1148/888，图框内沿只到 1205/951 且右下角被标题栏占用 | 标题栏被挤进纸边距，纸张尺寸只按"视图包围盒 + 16px"算 |
| 4 | 面板内边距/间距跟着缩放（16px → 20–26px），刚"填满"又把空间吃掉 | 制图版式沿用通用 spacing |
| 5 | 自动 fit 没有任何比例读数或缩放入口，"被放大"像 bug | fit 是隐式行为 |
| 6 | 每个视图常驻 3 个按钮 + 两行标题 + 虚线空状态板 | 通用面板模板套在图纸上 |

**修复（按 token → 版式 → 组件 → 状态顺序）**：

- **tokens.css 新增制图表面语义 token**：`--color-drafting-surface: #e6e9f1`、`--color-drafting-grid: #dde1ec`、`--color-paper: #fff`、`--color-paper-tint: #fbfcfe`、`--color-hairline(#c6ccdb)/--color-hairline-strong`、`--shadow-sheet`、`--sheet-panel-padding/--sheet-panel-gap`。品牌紫只保留给"当前状态"，工程线稿改走冷灰墨色。
- **画布**：`.drawing-sheet-area` 变成 24px 制图底纹 + 内阴影的工作台面；纸张白 #fff 落在上面成为唯一视觉焦点。
- **纸张版式**：底色改为纯白纸 + 内缩 12px 的深墨图框 + 只在框线上点两处分区刻度；标题栏移到图框内右下角，做成真正的图签（工程图纸 / 图幅 A4 横 / 比例 1:1 / 4 视图 / 显示 111%），与视图框对齐而不是叠在视图上。
- **构图数学**：`sheetPaperSize` 的边距从 16 提到 100，并重写注释说明它的职责是"把图框和标题栏都留在视图之外"；实测视图框已完全落在图框内（视图 383–1148 / 框 353–1205）。
- **视图框**：细线 + 左上右下双角定位刻度（像工程图视图而不是白卡片）；标题压在图内左上（`工程视图` 小字 + `主视图`），状态在右上；3 个操作按钮改为悬停/聚焦才出现的胶囊（触摸设备用 `@media (hover: none)` 常驻），从"每个视图一排按钮"变成"需要时才在"。
- **缩放不再只是放大**：`DrawingSheetView` 增加 `zoom` 状态与工具栏"适应窗口 / − / ＋ + 比例读数"，纸张写 `data-sheet-fit`、`data-sheet-scale`，读数为 `fit × zoom`；缩放改用 **CSS `zoom`** 而不是 `transform: scale()`——`zoom` 参与布局，所以放大后滚动范围正确、fit 后不会留下未缩放的占位高度顶出滚动条；fit 状态 `overflow: hidden`，放大后 `data-zoomed` 切换成可滚动，整张纸仍可及（不再被裁掉）。
- **工具栏收敛**：整个 CAD 区域只有一个工具栏（原来图纸外面一个、纸里四个），`EngineeringDrawingView` 把「显示投影线」作为插槽交给 `DrawingSheetView`，比例读数居右。
- **空状态**：不再画坐标轴占位板，也不放虚线框；每个视图只留标题右侧的「空视图」，绘图视口为空时仍可点下第一笔（`pointer-events: none`）。
- **响应式回归修复**：`height: 100%` 只在 ≥981px 的多列布局里传递；单列布局下三块内容会均分高度并与行高互相撑，实测把 CAD 画布压成 68px（图纸 26×20）。现在 ≤980px 时画布 `height: auto; min-height: 46vh`，390×844 实测画布 388px 高、图纸 358×283（fit 0.58），无横向溢出。

**验证（全部重新执行）**：

- 单测：59 个文件、**546** 个用例通过（`DrawingSheetView.test.tsx` 从 6 个增到 9 个：位置改为按中心定位 + zoom 控件行为 + 「空视图不再画坐标轴」的对应断言）。
- 类型检查 4 个 workspace 通过；ESLint 0 error、40 条既有 warning（无新增）；生产构建通过。
- E2E：**37/37 通过**，新增 `fills the drafting area with the sheet and keeps an explicit display scale`，断言 fit 后纸张不超过可用区且在约束轴向上占比 > 0.9、比例读数与 `data-sheet-scale` 一致、放大后变成可滚动、适应窗口后恢复且不再溢出。
- 过程中修掉的既有 E2E 假设：`比例 1.5` 原本写在视图元信息行里（该行已按新设计移除），改为按「缩小 主视图」按钮是否可用判断视图比例已持久化；`放大 主视图` 现在需要先 hover 面板（控件默认收起）。

#### Task 13：完整验证
- `npm.cmd test`：59 个测试文件、542 个用例通过（追加图纸铺满修复后为 545 个，视觉重做后为 546 个）。
- `npm.cmd run typecheck`：4 个 workspace 通过。
- `npm.cmd run lint`：0 error、40 条既有 warning（无新增）。
- `npm.cmd run build`：Web 与 3 个 package 构建通过；Vite 仍提示主 bundle 超过 500 KB（约 1.51 MB，gzip 约 476 KB）。
- `npm.cmd run test:e2e`：37/37 通过（含本轮的 3D 提示、点名标注、约束数据与图纸填充用例）。
- 修正的验证流程问题：`npm.cmd exec playwright test` 直接运行时不会重新构建，预览服务固定读取 `build-check/mathcanvas-current`，因此源码改动必须通过 `npm.cmd run test:e2e`（先构建再跑）验证，否则会看到上一次构建的旧行为。

## 已完成

### P0 技术验证

- [x] 建立 npm workspaces monorepo：`apps/web`、`packages/dsl`、`packages/geometry-kernel`、`packages/scene-graph`
- [x] 初始化 React + TypeScript + Vite 工作台
- [x] 建立 Geometry DSL v0.1、`schemaVersion`、revision 和稳定对象 ID
- [x] 实现 `.mgeo` JSON 保存/恢复 codec 与可见文件打开入口
- [x] 实现点、线、圆的数据类型；完成两条直线和交点 SVG 渲染
- [x] 实现参数滑块 → Domain Operation → DAG 派生重算 → 交点更新
- [x] 实现 Algebra View、显示/隐藏、撤销/重做
- [x] 实现 Domain Patch 校验：重复 ID、缺失引用、非法参数和不存在对象拦截
- [x] “添加点”通过 Domain Operation 提交，并同步到 Algebra View 与画布
- [x] 建立 React Testing Library UI smoke tests
- [x] 配置 Playwright Chromium 与可回收的本地 preview 测试服务器
- [x] 通过浏览器 smoke test 验证工作台加载、滑块更新和添加点
- [x] 实现表达式 AST：数字、变量、括号、加减乘除和确定性求值
- [x] 将表达式接入 `ParameterSpec`，支持参数引用和链式重算
- [x] 循环引用、未知变量和非法表达式失败回滚
- [x] 点、线、圆及圆弧图元支持；新增直线-圆和圆-圆交点计算
- [x] 依赖关系传播与局部派生对象重算
- [x] 约束目标校验、引用保护和非法 Patch 回滚
- [x] 平行、垂直、重合约束的确定性几何投影
- [x] 圆、圆弧的画布多点击创建和属性编辑
- [x] 直线的画布双点击创建和端点属性编辑
- [x] 选择工具、对象删除和 Delete/Backspace 键盘交互
- [x] 删除引用对象时的依赖保护和 Patch 错误反馈
- [x] 对象锁定、框选和 Shift 多选操作
- [x] Playwright `.mgeo` 文件选择与恢复流程
- [x] 线段 DSL、画布双击创建、独立渲染和端点属性编辑
- [x] 1000 个图元下的增量重算性能回归测试
- [x] 多约束迭代求解、冲突检测与失败事务回滚
- [x] 持久化对象分组、六向对齐和批量显隐/锁定编辑
- [x] 数值鲁棒性：尺度化容差、鲁棒交点分类与退化回滚
- [x] 近平行几何纳入 1000 图元增量重算性能回归
- [x] 约束图按受影响分量局部求解，避免无关线重复投影
- [x] 射线与折线 DSL、校验及基础几何度量
- [x] 射线/折线补丁边界校验与退化输入防护
- [x] 射线/折线与直线、圆的详细交点内核
- [x] 圆锥曲线采样与微积分数值 MVP 内核
- [x] 多组件约束局部求解性能基准

### 验证证据

- `npm test`：15 个测试文件、108 个测试通过
- `npm run typecheck`：4 个 workspace 通过
- `npm run build`：Web bundle 与 3 个核心 package 构建通过
- `npm run test:e2e`：5 个 Chromium 浏览器用例通过

## 环境状态

- [x] npm、TypeScript、Vite、Vitest 已配置
- [x] Playwright 浏览器测试环境已安装并验证
- [x] 浏览器插件连接曾因当前环境的 `process` 属性冲突失败；已改用项目内 Playwright Chromium 验收

## 当前进行中

### 阶段状态

- P0：已完成
- P1：主体已完成，包含数值鲁棒性、约束局部求解、射线/折线交点和圆锥/微积分数值内核
- P2：基础几何编辑已完成；射线/折线、圆锥曲线、函数采样和采样交点联合交互已接入

- [x] P1：表达式 AST 最小能力（数字、变量、加减乘除、括号）
- [x] 将表达式求值接入参数环境，为后续函数图像和导数做基础
- [x] P1：圆、圆弧和基础交点内核
- [x] P1：依赖 DAG 局部传播及约束 Patch 校验
- [x] P1：平行、垂直、重合约束投影求解
- [x] P2：圆、圆弧的基础交互创建和属性编辑
- [x] P2：直线的基础交互创建和端点属性编辑
- [x] P2：选择、删除和键盘交互
- [x] P2：对象锁定、框选和多选
- [x] P2：线段构造和直线/线段差异化渲染
- [x] P1：1000 个图元增量重算性能回归
- [x] P1：多约束冲突检测与求解失败回滚
- [x] P2：对象分组、对齐和批量属性编辑
- [x] P1：尺度化数值策略与显式交点结果分类
- [x] P1：近平行几何性能回归覆盖
- [x] P1：约束图分量局部求解与增量重算接入
- [x] P2：射线方向判断、折线长度与点到折线距离
- [x] P2：射线/折线专用 UI 回归测试与属性编辑完善
- [x] P2：圆锥曲线和函数采样工作区渲染与属性编辑
- [x] P2：圆锥曲线交点与函数/曲线联合交互
- [x] P1：射线/折线非法输入在 Scene Graph 边界拒绝
- [x] P1：射线/折线与直线、圆交点过滤与端点去重
- [x] P1：抛物线、椭圆、双曲线采样
- [x] P1：函数采样、数值导数与梯形积分
- [x] P1：多组件约束性能基准
- [x] P1：大规模多组件约束增量求解优化，覆盖 1000/5000/10000 条线
- [x] P2：工作区独立文档切换与状态往返保留
- [x] P2：SVG 与 CSV 导出
- [x] P2：约束可视化列表、满足状态与冲突恢复提示
- [x] P2：PNG 导出、导出错误反馈与本地草稿自动保存
- [x] P2：约束批量清理与数值误差诊断
- [x] P2：属性检查器整体 UI 优化，统一卡片层级、图元类型徽标、双列字段、响应式布局和可见焦点态
- [x] P2：中间画布横向填充工作区，函数编辑框的 Backspace/Delete 不再误删函数图元
- [x] P2：函数公式键盘支持光标插入、嵌套函数和带底数对数；画布支持坐标悬停与点击创建持久交点
- [x] P2：函数无定义区间与采样渐近线断线保护；画布支持动态视口中心、鼠标中键或 `Space + 左键` 平移
- [x] P3-1：表达式编译缓存与有细化上限的自适应函数采样接入绘图、属性值域、导出和采样交点
- [x] P3-2：一阶/二阶中心差分导数内核，覆盖非有限邻域
- [x] P3-3：基于自适应样本的零点、极值和拐点数值检测
- [x] P3-4：可持久化一阶/二阶导函数图元，保存来源引用并联动重算
- [x] P3-5：可持久化切线、法线和割线图元，保存来源引用并联动重算
- [x] P3-6：积分区域、零点/极值/拐点分析集合和结构化数值诊断
- [x] P3-7：微积分分析工具、属性状态、Algebra View 条目和画布标记集成
- [x] P3-8：P3 文档、完整测试、类型检查、构建和 E2E 验证
- [x] P6-1：3D 向量、平面、射线—平面求交和二面角基础几何内核
- [x] P6-2：3D DSL 类型、几何校验、`.mgeo` round-trip 和旧 2D 文档兼容
- [x] P6-3：参数化立方体 Three.js 场景、geometry3d 工作区入口和 WebGL 降级状态
- [x] P6-4：棱锥、圆柱和圆锥参数化 Three.js 模型与创建入口
- [x] P6-5：3D 相机旋转、平移、缩放、重置和空间拾取
- [x] P6-6：隐藏边、透明面、法向量和选中态显示
- [x] P6-7：剖切平面、截面计算和截面派生对象
- [x] P6-8：立方体展开/折叠布局与动画
- [x] P6-9：二面角测量显示
- [x] P6-10：`geometry3d` 工作区、Algebra View 和立体属性栏集成
- [x] P6-11：P6 文档、完整验证、review、commit、push

### P6 v2：点驱动通用立体几何（分片实施中）

- [x] 方案 C 已确认：基础对象采用点、线、面驱动，参数化实体作为快捷模板。
- [x] 完成点、线、面、拓扑、builder、依赖重算、拾取和教学反馈的设计规格。
- [x] 完成十个可独立验证切片的实施计划，明确测试、类型检查、构建、E2E、review、commit 和 push 门槛。
- [x] P6 v2-1：3D DSL 基础对象与旧文档兼容。
- [x] P6 v2-2：纯三维几何与可注册实体 builder。
- [x] P6 v2-3：Scene Graph 依赖索引与拓扑重算。
- [x] P6 v2-4：点线面课堂构造工具与关键点交互。
- [x] P6 v2-5：四类固定实体迁移为统一拓扑模板。
- [x] P6 v2-6：空间拾取、约束与教学测量。
- [x] P6 v2-7：通用剖切与截面派生对象。
- [x] P6 v2-8：拓扑展开布局与折叠动画。
- [x] P6 v2-9：二面角与空间关系教学标记。
- [x] P6 v2-10：工作区整合、兼容、文档与最终验收。

- P6 v2-8 聚焦测试：`unfold3d.test.ts` 8 个、`scene-store.test.ts` 40 个、`threeScene.test.ts` 17 个用例通过
- P6 v2-8 全量单测：34 个测试文件、316 个用例通过
- P6 v2-8 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-8 浏览器验证：Playwright 10 个用例通过，新增“展开点驱动拓扑为平面展开图并折回”用例
- P6 v2-8 实现：新增 `unfold3d`（共享棱邻接 BFS、沿铰链递归旋转展平、折叠进度、重叠诊断、面朝向无关的展开侧判定）；`resolvePolyhedronTopology` 提供任意多面体拓扑；3D 画布按拓扑渲染展开图（每面填充 + 边界 + `unfolded-face-<i>` 子部件 ID），折叠姿态仍为临时 UI 状态，并支持 `prefers-reduced-motion`

- P6 v2-9 聚焦测试：`markers3d.test.ts` 9 个、`measurements3d.test.ts` 7 个、`threeScene.test.ts` 18 个用例通过
- P6 v2-9 全量单测：35 个测试文件、327 个用例通过
- P6 v2-9 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-9 浏览器验证：Playwright 11 个用例通过，新增“解释二面角内角/外角并绘制公共棱、角弧与法向量标记”用例
- P6 v2-9 实现：新增 `markers3d`（公共棱上的内角二面角，与面环缠绕方向无关；外角为补角；`dihedralMarker3` 输出公共棱、角弧和朝外法向量；点线/点面垂足），二面角测量改为报告内角并记录 `dihedralKind`，属性栏提供“二面角内角/外角”两个入口，画布在选中来源面时绘制公共棱、角弧与法向量标记

- P6 v2-10 聚焦测试：`codec.test.ts` 27 个（含点驱动 3D 文档含拓扑/截面/二面角测量的完整往返）、`App.test.tsx` 54 个（含 3D 工作区往返、WebGL 降级提示、导出入口门控、非法构造提示、单步撤销重做）、`exporters.test.ts` 7 个（含截面分类与测量行导出）用例通过
- P6 v2-10 全量单测：35 个测试文件、334 个用例通过
- P6 v2-10 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-10 浏览器验证：Playwright 11 个用例通过
- P6 v2-10 整合修复：立体几何工作区明确禁用 SVG/PNG 投影导出（导出入口不再静默生成空文件，改为禁用并在提示中说明将在 P7 工程制图接入，SVG/PNG 在平面工作区保持可用，`.mgeo` 与 CSV 在 3D 保持可用）
- P6 v2-10 验收对照：任意点驱动多面体可创建编辑（Slice 4-5）、四类模板仍可用（Slice 5）、派生对象按来源重算（Slice 3/6/7）、3D 对象可保存恢复并进入代数区（codec 往返 + 代数区子树）、错误与近似状态可解释（约束/测量/截面/展开诊断）

## 下一步

### P6 v3：立体几何可用性修复（已完成）

用户在真实浏览器里实测立体几何区，列出 6 个问题；另按要求顺带完成 1 项选取判定优化。逐个先定位根因（浏览器实测取证据），再写失败测试，最后实现。

| # | 用户报告的现象 | 定位到的根因 | 状态 |
|---|---|---|---|
| 1 | 无法修改立体几何图形的颜色；"每个图形只能改一次颜色，然后被锁定" | `.three-canvas-shell` 没有高度约束，被右侧属性面板内容撑到 **1902px**（视口仅 720px），相机宽高比变成 0.39，立体中心落在屏幕外 951px；同时 `visibleSolids()` 把模板实体排除出场景，画布射线永远命中不到实体本身，只能命中"棱" | ✅ 已验收 |
| 2 | 端点的模型过大 | `createPoint3Mesh` 用写死的**世界单位**半径 0.14（实测 9px），随手势缩放变化；圆柱 24 分段产生 48 个顶点、屏距仅 11px，挤成"串珠" | ✅ 已完成 |
| — | （用户要求顺带）对象选取判定 | `pickRaycastHit3` 按**类型优先级**排序再比深度，导致立体背后的顶点抢走点击；`raycaster.params.Line.threshold` 用 three.js 默认的 **1 个世界单位**（立方体棱长才 4） | ✅ 已完成 |
| 3 | 无法正常删除图形，删除后棱和点依然存在 | `deleteObject` 只删单个图元；模板实体被**自己生成的拓扑**引用，触发 `isReferenced` 保护而无法删除；删掉拓扑又留下孤立的顶点/棱/面 | ✅ 已完成 |
| 4 | 无法构建平面，更不用说合适大小的平面 | `threeScene.tsx` **完全没有 `plane3` 渲染分支**（创建成功但画不出来）；默认点 `(n%3)*2, floor(n/3)*2, z=0` 让前三点共线（建平面必然报 `plane3 points are collinear`）且全部落在 z=0；界面无任何操作引导；相机固定 16 单位，1 单位图形打开即是一个点 | ✅ 已验收 |
| 5 | 无法测量二面角，或者测量方法不明确 | 功能本身正确（实测四面体二面角 **45.000°** 与手算一致、状态 valid、画布有标记），入口已在选中两个面时明确提供内角/外角按钮和说明 | ✅ 已完成 |
| 6 | 测量结果无法可视化清晰地表现在画布中 | 有效测量现在会在 3D 画布显示实际数值标签，二面角继续绘制公共棱、角弧和法向量；辅助标记的屏幕恒定缩放保留为视觉细化项 | ✅ 已验收 |

### P6 v3 遗留与待决

- ✅ **5 号**：选中两个面后，属性面板直接提供二面角内角/外角入口和测量解释。
- ✅ **6 号**：测量结果已直接标注在画布上；辅助法向量和角弧已保留，屏幕恒定缩放作为后续视觉细化。
- ⚠️ **选中态高亮色完全覆盖填充色**（`face3` / `plane3` / 实体都一样，改完颜色需取消选中才可见），属 6 号范围，已与用户确认后处理。 → ✅ **已修复**（见下方「P6 v3-7」）。
- ❓ **点立方体的"面"会选中整个立体**：这是本轮修复 1 号时引入的判定规则（模板实体的棱/面归属所属实体），生成的顶点仍可直接选中以保留点驱动编辑。若产品希望"点面=选面"，需改判定方式，待确认。
- ❓ 平面目前只有**自动尺寸**（按所属图形包围盒自适应，即用户要求的"合适大小"），还没有手动拖动/缩放平面边界的入口（视角移动问题已在「P6 v3-8」单独解决，平面边界拖动仍未做）。
- ✅ **模板实体的朝向**：原本四个模板全部锁死沿世界 +Z，现已支持三轴朝向（见「P6 v3-9」）。

### P6 v3-8 视角不再只能在原点附近打转（已完成）

- **用户的判断与实测不符，先复现再改**：用真实浏览器读取页面已暴露的 `data-camera-target` 取硬数据 —— 平移**本来就有**（中键拖动、Shift+左键拖动都会改变枢轴）：初始 `0.00,0.00,0.00` → Shift 拖动后 `-3.66,0.00,0.00` → 中键拖动后 `-3.66,7.50,0.00`。所以不是"锁死在原点"。
- **实测定位到的 4 个真实缺陷**：
  1. **完全不可发现**：3D 工作区可见文案里没有任何一句提到平移，界面上只有「适应视图」「重置视角」。这是找不到功能的直接原因。
  2. **永远动不了 Z**：`panCameraState` 只写 `x` 和 `y`，三次手势后 `target.z` 始终是 `0.00`；z 方向偏心的图形无论怎么拖都无法居中。
  3. **方向是世界轴对齐而非跟随屏幕**：`target.x += -deltaX * distance * 1.5`。相机旋转后横向拖动不再对应屏幕横向，手感变成"拖了却往怪方向跑"。
  4. **没有任何范围限制**：可以无限平移把图形丢出画面。
- **修复**：
  - `panCameraState` 改为沿**相机自身基向量**平移（`cameraBasis` 由 azimuth/elevation 推出 right / up / forward），新增第三个 `forward` 分量用于沿视线纵深移动；横向拖动现在在世界 X 与 Z 上同时产生位移。
  - 新增 `clampCameraTarget`：把枢轴夹在以**当前图形包围盒**中心、半径为 `3 × 包围盒半径`（`PAN_RANGE_FACTOR`）的范围内；场景没有几何时退回原点周围 ±12（`EMPTY_BOUNDS_PAN_LIMIT`）。
  - 交互与可发现性：新增「平移视角」按钮（`aria-pressed` + 画布 `data-pan-mode` + `grab/grabbing` 光标），开启后左键拖动即平移；画布左下角常驻手势提示「左键拖动旋转 · 中键或 Shift+左键拖动平移 · Ctrl+拖动沿视线前后移动 · 滚轮缩放」；`Ctrl`（或 `Cmd`）拖动沿视线纵深移动。
  - 「适应视图」的提示文案补充说明它同时把视角中心移回图形。
- **RED→GREEN 证据**：`threeScene.test.ts` 新增 3 个用例，先在旧实现上失败并给出正确原因（`expected { x: 2, y: +0, z: +0 } to deeply equal { x: +0, y: +0, z: -2 }`，即横向拖动错误地只改世界 X）；实现后通过。
- **浏览器实测**：初始 `0.00,0.00,0.00` → Shift+右拖 `-3.02,0.00,3.02`（X/Z 同步、Y 不动，正是方位角 45° 的相机右向量）→ Ctrl+上拖 `2.50,4.50,8.53`（位移 `(5.5,4.5,5.5)` 恰为视线方向）→ 连续 8 次大幅拖动后停在 `-9.25,4.50,9.25`（受限，不再无限增长）→「适应视图」回到 `0.00,0.00,0.00`；「平移视角」按钮 `aria-pressed=true`、画布 `data-pan-mode=true`，开启后普通左键拖动确实平移而非旋转。
- **回归**：全量单测 51 个测试文件、469 个用例通过；4 个 workspace 类型检查通过；lint 0 error、**37 条 warning**（较基线 36 多 1 条，来自新增的可测试纯函数 `clampCameraTarget` 导出触发的既有 `react-refresh/only-export-components` 规则，属既有规则的重复计数）；生产构建通过；Playwright **26/26** 通过（新增 2 个视角导航用例）。

### P6 v3-9 参数化实体支持三轴朝向（已完成）

- **用户报告**：生成圆锥等图形时，图形只能朝向一个方向。
- **根因（代码级证据）**：`packages/geometry-kernel/src/solid-builders.ts` 里四个模板全部硬编码沿世界 +Z 生成 —— `buildCube` 用 `buildPrism({ vector: {x:0, y:0, z:size.z} })`；`buildPyramid` 把顶点固定在 `baseCenter.z + height`；`buildCylinder` 沿 `{x:0, y:0, height}` 拉伸；`buildCone` 把顶点固定在 `center.z + height`。数据模型里也没有任何朝向字段（`ConePrimitive`/`CylinderPrimitive` = `{center, radius, height, segments}`，`PyramidPrimitive` = `{baseCenter, baseSize, height}`，`CubePrimitive` = `{origin, size}`），属性面板只暴露这些。
- **同时确认「拖生成点来定向」这条路走不通**：`packages/scene-graph/src/operations.ts` 的 `syncTemplateTopology`（L551-566）在 L617 **每次重算都会执行**，把模板生成的每个 `point3` 位置按模板参数写回，手动移动的顶点会被弹回原位。
- **修复**：
  - `packages/dsl/src/types.ts` 新增 `SolidRotation`（弧度，X → Y → Z）与四类模板的可选 `rotation` 字段；`schema.ts` 校验必须是三个有限弧度；旧 `.mgeo` 缺该字段时行为完全不变。
  - `solid-builders.ts` 新增 `rotateAboutPivot` 与 `templatePivot`（立方体取包围盒中心，棱锥/圆柱/圆锥取轴线中点），在 `buildSolidTemplate` 里对**已生成的顶点**统一应用旋转 —— 一处改动覆盖四个模板，刚校验过的拓扑也不会被刚体旋转破坏；渲染、投影、导出、测量因此全部自动跟随。
  - `packages/scene-graph` 的 `PrimitiveUpdatePatch` 新增 `rotation3?: Partial<Vector3>`（按轴合并，未给出的轴保留原角度）；`updatePrimitive` 在四类模板上写入 `rotation`。
  - 属性面板新增「朝向」卡片：三个按度输入的角度框（`step=15`，可精确输入 45/90）、「归零」按钮与各轴「+90°」快捷按钮，并说明旋转顺序与轴心。
- **RED→GREEN 证据**：`solid-builders.test.ts` 新增 4 个用例，先在旧实现上失败并给出正确原因（`expected +0 to be close to -2`、`expected 2 to be close to 6`、`expected 2 to be close to 2.8284271247461903`，即旋转被完全忽略）；实现后通过。另在 `codec.test.ts` 新增 3 个用例（朝向往返、旧文档保持直立、非有限角度被拒绝），`operations.test.ts` 新增 2 个用例（朝向写入文档且生成拓扑跟随、按轴合并不影响其他轴）。
- **浏览器实测**：默认圆锥（半径 1.5、高度 3）包尺寸 `3.10,3.10,3.10`；高度改为 6 后 `3.10,3.10,6.10`；点「绕 X 轴 +90°」后变为 `3.10,6.10,3.10`，输入框显示 `90`，刷新后从草稿恢复仍为 `90`。截图对照确认圆锥由「轴沿世界 Z（屏幕上横躺）」变为「轴沿世界 −Y（屏幕上竖直朝下）」。
- **顺带纠正文档**：`docs/feature-catalog.md` 原写「编辑生成点后可脱离模板独立修改」，与 `syncTemplateTopology` 的实际行为相反，已改为明确说明并指向朝向参数。
- **回归**：全量单测 51 个测试文件、478 个用例通过；4 个 workspace 类型检查通过；lint 0 error、37 条 warning（与上一轮持平）；生产构建通过；Playwright 27/27 通过。

### P6 v3-11 立体几何改为 Z 轴朝上（已完成）

- **用户反馈**：立体几何的 xyz 轴不符合直觉，要求 Z 轴在上。
- **根因**：整个 3D 视图按 Three.js 默认的 **Y 朝上**搭建 —— `applyCameraState` 把仰角放在 Y 上（`position.y = target.y + distance·sin(elevation)`），`cameraBasis` 的 `right/up` 也按 Y-up 推导；`camera.up` 从未设置，一直是默认的 `(0,1,0)`；`THREE.GridHelper` 生成的网格在 XZ 平面（那是 Y-up 的地面）。
- **修复**：
  - `applyCameraState`：相机位置改为 `(cos el·cos az, cos el·sin az, sin el)`，仰角绕世界 **Z** 抬起；同时显式 `camera.up.set(0, 0, 1)`，否则 `lookAt` 会带着默认的 Y-up 产生滚转。该函数改为导出以便直接断言相机姿态。
  - `cameraBasis`：`forward` 与 `right` 按 Z-up 重新推导，平移方向继续跟随屏幕。
  - 网格：`grid.rotation.x = Math.PI / 2`，把 Three.js 的 XZ 地面转成 **XY** 地面。`AxesHelper` 本身沿世界轴绘制，无需改动，因此蓝色 +Z 自然朝上。
- **RED→GREEN 证据**：`threeScene.test.ts` 先改期望再看失败 —— `expected { x: +0, y: +0, z: -2 } to deeply equal { x: +0, y: +2, z: +0 }`（平移基向量仍是 Y-up）；新增 1 个用例断言 `camera.up === (0,0,1)`、仰角 0 时相机在 `+X`、仰角 90 时相机升到 `+Z`。实现后 36 个用例通过。
- **浏览器实测**：截图确认蓝色 +Z 竖直朝上、网格平铺为地面、立方体为 3/4 俯视；`data-content-bounds` 仍为 `0.00,0.00,0.00 size 4.10,4.10,2.10`（几何本身未变，只有视角改变）。E2E 里按世界点投影点击顶点的辅助函数 `projectDefaultCamera` 也同步改成 Z-up（否则"点顶点不穿透"用例会点到实体上）。
- **回归**：全量单测 51 个测试文件、484 个用例通过；4 个 workspace 类型检查通过；生产构建通过；Playwright 30/30 通过。lint 0 error、**38 条 warning**（较 37 多 1 条，来自导出 `applyCameraState` 以便测试相机姿态所触发的既有 `react-refresh/only-export-components` 规则）。
### 功能键操作指引（左下角小浮层）（已完成）

- **用户报告**：一些功能使用不明确，点击功能按键时左下角应该有清晰指引（例如"计算二面角要如何操作"）；指引不要过大，只在点击那些按键时才出现。
- **复现与根因**：立体几何与圆锥曲线工作区**没有任何状态提示面**——CAD 有 `StatusBar` 的命令提示，平面/3D 只有底部一行 `footer-note`（revision 与创建模式）。因此两件事说不清：① 多步创建（直线/圆/圆弧）与一键创建的下一步；② 前置条件不足时的原因。后者此前走 `setFileError`，弹出的是"请先按住 Shift 依次点选 2 个空间点"这类**报错**，而二面角真正的卡点（模板实体的面默认选中整个实体，要按 Alt 才能单独选面）根本没有出口。
- **修复**：
  - 新增 `apps/web/src/guidance.ts`：纯函数 `guidanceFor(action)` 把「点了什么 + 前置条件是否满足」映射为一句指引，覆盖平面创建、圆锥曲线、函数与函数分析、空间构造、截面、模板实体、6 类测量（含二面角内/外角）、8 类约束、3 个点驱动工具；`point3Tool` 会带上"还差几个空间点"。
  - 新增 `apps/web/src/components/GuidanceHint.tsx`：小浮层，`role="status"` + `aria-label="操作指引"` + 闭合按钮；`global.css` 用 `position: fixed; left/bottom: 18px`、`max-width: 420px`、`0.75rem` 字号把它压成一行到两行。
  - 出现/消失规则：只在功能键点击时写入；切换工作区、`Esc`、点 `×`、一步创建动作完成时清空；点另一个功能键被替换。用 `pendingCreationRef` 区分"多步创建结束"与"一次性指引"，避免把后者一起清掉。
  - 前置条件不足改为给指引：3D 的空间直线/平面/面创建、测量的 insufficient-data/degenerate 分支不再弹红色报错。
  - 二面角补上真正的入口提示：选中立方体/棱锥/圆柱/圆锥时提示 `Alt + 点击` 可单独选中棱或面。
- **RED→GREEN 证据**：`guidance.test.ts`（9 个用例，含逐条断言文案 ≤64 字）与 `GuidanceHint.test.tsx` 先在模块不存在时整体失败；`App.test.tsx` 新增 5 个用例，先在旧实现上失败（`Unable to find role="status" name="操作指引"`）。实现后全部通过。
- **既有测试的行为改写**：`App.test.tsx` 的 "explains an invalid spatial construction instead of creating objects" 原先断言红色 `alert`，现在断言左下角指引（这是本次要求的行为变更，不是绕过失败）。
- **过程中自修的两个错**：`addPoint` 里多写的一行 `setSelectedIds` 撞坏了 2 条既有用例（已还原为原语义）；新写的二面角用例选了立方体的**对面**（面 1 + 面 2，二面角本就退化），改为相邻的面 1 + 面 3，与既有 e2e 一致。
- **浏览器实测**：`e2e/geometry3d.spec.ts` 新增用例断言指引**贴在左下角**（`x < 视口宽/2`、底边在视口下方 60% 以下）、宽度 < 480px、点击"添加立方体"先出现实体指引、关闭后归零、只选面不弹、点"二面角内角"后出现含"公共棱/外角"的指引。
- **回归**：全量单测 54 个测试文件、516 个用例通过；4 个 workspace 类型检查通过；lint 0 error、38 条既有 warning（无新增）；生产构建通过；Playwright 32/32 通过。
- **边界**：CAD 工程制图工作台未接入这个浮层——它已有自己的 `StatusBar` 命令提示与 `notice` 通道，重复提示反而会打架；指引不做自动超时消失（用显式关闭/Esc/操作完成，避免"看着看着没了"）。

### 圆锥曲线工作区四项修复（画布缩放 / 交点全显 / 函数入口 / 函数可删）（已完成）

- **用户报告**（圆锥曲线部分）：1) 画布不能缩放；2) 线之间的交点只显示一个；3) 应该能加入 `exp`、简单三角函数等简单函数，似乎可以和微积分部分稍作整合；4) 无法删除函数。
- **复现与根因**（先复现再定位，全部用真实代码实测）：
  1. **缩放**：`GraphicsView` 只有中键拖动与 `Space+左键拖动` 平移，没有滚轮也没有按钮；而且圆与圆弧半径写死 `WORLD_SCALE`，与 `viewport.scale` 脱钩，所以即使加了缩放，圆也会画错。
  2. **交点只显示一个（两个独立缺陷）**：内核 `intersectSampledPrimitives` 把结果截断成 `[unique[0], unique[1]]` —— 实测直线与 `sin(x)` 有 6 个交点只显示 2 个，折线—直线、折线—圆同样截断；`GraphicsView` 的 `persistentPairs` 按“整对”过滤预览 —— 实测直线与圆 2 个交点，保存其中一个后剩下 0 个。
  3. **函数入口**：`onAddFunction` 传进了工具栏却从未渲染（退役切片的守卫测试还断言它不存在），而内核、DSL、`PropertiesBar` 的函数编辑区与 `functionPresets` 都还在。
  4. **无法删除函数**：`isReferenced()` 把 `derivative/tangent/normal/secant/integral/analysisSet` 当普通引用者，所以含派生分析对象的函数删除时报 `object is referenced by another object`（探针实测画布点击、代数区、键盘三种入口全部失败）。
- **修复**：
  - **内核**：`IntersectionResult.points` 由 `[Coordinate, Coordinate]` 放宽为 `Coordinate[]`；`intersectSampledPrimitives`、`intersectPolylineLineDetailed`、`intersectPolylineCircleDetailed` 返回全部去重交点，并用 `MAX_CURVE_INTERSECTIONS = 64` 兜住 `sin(1/x)` 这类病态输入。
  - **画布**：`viewport.ts` 新增 `zoomViewportAt`（以指针为锚点，锚点世界坐标保持不动）、`clampZoom`（0.05×～40×）、`zoomViewport`、`gridStep`（自适应网格步长）；`GraphicsView` 用原生 `wheel` 监听（`passive: false`，否则页面跟着滚）缩放，新增「放大画布 / 缩小画布 / 重置视图」按钮与百分比读数，圆与圆弧半径改用 `viewport.scale`，网格按缩放自适应。
  - **交点显示**：只有 `intersectionSet`（会实体化整对全部解）隐藏整对预览，单个交点图元只隐藏自己那个坐标，拖动时实时预览也不受影响。
  - **函数**：工具栏恢复「添加函数」；属性栏新增「常用函数预设」下拉（预设文案中文化：指数函数 `e^x`、正弦 `sin(x)`、双曲、高斯等，选择预设同时套用其课堂定义域）与「创建导函数 / 创建切线 / 创建积分区域」；`App.addFunctionAnalysis` 生成合法图元，`applyOperation` 在同一补丁内完成派生重算。
  - **删除**：`deletionTargets()` 把函数的派生分析对象并入同一对象一起删除，沿用模板实体拓扑的既有先例（`isReferenced` 通过 `ignoredReferrers` 放行）。
- **RED→GREEN 证据**：新增 `packages/geometry-kernel/src/curve-intersections.test.ts` 4 个用例，先在旧实现上失败（`expected [ { x: 1, y: +0 }, { x: +0, y: 1 } ] to have a length of 3 but got 2`）；`operations.test.ts` 新增函数分析删除 2 个用例先失败（`expected false to be true`）；`viewport.test.ts` 新增 4 个缩放用例先失败（`(0 , zoomViewportAt) is not a function`）；`App.test.tsx` 新增/改写 9 个用例先失败（`Unable to find role="button" name="添加函数"` 等），实现后全部通过。
- **回归**：全量单测 52 个测试文件、501 个用例通过；4 个 workspace 类型检查通过；lint 0 error、38 条既有 warning（无新增）；生产构建通过；Playwright 31/31 通过（新增「圆锥曲线画布缩放 + 直线与正弦的多个交点」浏览器用例）。
- **与退役切片的取舍**：微积分**工作区标签**继续退役，不恢复第四个标签；本次只把「添加函数 + 导数 / 切线 / 积分」入口放回圆锥曲线工作区，属于用户明确要求的回补，因此退役切片的守卫测试改为「标签不存在，但圆锥曲线提供添加函数」。
- **仍未做**：函数预设下拉只覆盖内核已有预设，没有自定义参数化 `a*sin(b*x+c)+d` 表单；`analysisSet`（零点 / 极值 / 拐点）与法线 / 割线仍未接入界面入口；保存的交点仍受既有的来源删除保护（删除被交点引用的图元会先提示）。

### 微积分工作区退役（切片 1 已完成，代码清理待续）

- **用户要求**：微积分部分用不到，删除。
- **已确认范围**：删 UI 与内核、保留 DSL 图元类型与解码路径（旧 `.mgeo` 仍可打开、只能查看/删除）；默认工作区改为 `geometry3d`。
- **切片 1（界面与默认，已完成并全绿）**：
  - `WorkspaceHeader` 工作区标签移除「微积分」，并把图标从"按下标取"改为每个标签自带，避免删项后图标错位。
  - `store.ts` 初始文档由 `createDemoDocument()`（calculus）改为 `withDocumentLayout(createEmptyDocument("geometry3d"))` —— 启动不再有任何演示内容。
  - `draftStorage.loadActiveWorkspace` 白名单去掉 `"calculus"`，旧草稿不会把应用带回已退役的工作区。
  - `GeometryToolbar` 的 `isPlanarWorkspace` 收窄为仅 `conics`。
  - 测试夹具 `createDemoDocument()` 改为 `conics` 文档（内容不变：两条直线 + 交点 + 斜率参数），因此平面画布相关用例无需逐个改工作区。
  - 新增 `e2e/fixtures/planar-demo.mgeo`（由 `createDemoDocument()` 经 `encodeMgeo` 生成），替代原先"启动即有演示内容"的假设。
- **切片的验证**：全量单测 51 个测试文件、484 个用例通过；Playwright 30/30 通过（含加载 `workspace: "calculus"` 文档仍能正常打开的兼容用例，以及"微积分标签不存在"的断言）。
- **切片 1b：可见入口清零（已完成）**：圆锥曲线工具栏的「添加函数图像」已移除；函数检查器里的「创建导函数/切线/法线/割线/积分区域/分析结果」按钮行与 `createDerivedAnalysis` 辅助函数已删除。微积分图元因此在任何工作区都无法再新建，遗留的内核/渲染/导出代码不再可达。
- **守卫测试（把你提的两条要求钉死）**：
  - `draftStorage.test.ts`：残留的 `active-workspace = "calculus"` 偏好不会让应用重新进入已退役工作区。
  - `App.test.tsx`：外壳里不存在「微积分」按钮；圆锥曲线工作区不存在「添加函数图像」（但抛物线/椭圆仍在）；加载含 `workspace: "calculus"` 与 `function` 图元的旧文档仍能打开、对象仍列出（可查看/删除）而不抛错。
  - `e2e/workbench.spec.ts`：全新会话停在「立体几何」，且「微积分」标签数量为 0。
  - 随之删除 7 个依赖函数/微积分入口的 App 用例。
- **按你的决定保留**：DSL 图元类型与 schema、`PropertiesBar` 的函数编辑区、`GraphicsView` 的函数/派生渲染分支、导出相关行、内核 `calculus.ts` 与 `operations.ts` 的重算分支。这些只在打开旧 `.mgeo` 时可达，不会再产生新的微积分对象。
### P7 修复：工图工作台的撤销与重做（已完成）

- **用户报告**：工程制图工作区里「重做」按键没有反应、「撤销」按键不能撤销。
- **先复现再定位**：用真实浏览器读页面已暴露的 `data-revision` 实测，撤销/重做**对命令栏创建、2D 绘图、图层增删与显隐、视图比例调整都是有效的**（revision 依次 1→2→3→2→1，重做回到 1）。所以问题不在 store 的 history/future 机制。
- **实测到的两个真实缺陷**：
  1. **键盘快捷键完全没有实现**：全项目只有 3 处 `keydown` 监听，分别处理 Escape / Delete / Backspace；`ctrlKey` 唯一用处是 3D 视角的纵深平移。实测 `Ctrl+Z`、`Ctrl+Y`、`Ctrl+Shift+Z` 按下后 revision 均停在 1 不动 —— 这是"按键没反应"最直接的原因。
  2. **撤销/重做按钮从不进入禁用态**：项目里没有任何 `canUndo`/`canRedo` 计算（grep 无结果），空历史时按钮依然可点，点了没有任何反馈。另外草稿恢复走的是 `replace()`，会清空 history，所以刷新后内容还在但"撤不掉"，而按钮看起来仍然可用 —— 观感就是"撤销失效"。
- **修复**：
  - `App.tsx` 新增 `historyShortcut(event)`：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y 重做，带 `preventDefault()`；用既有的 `isTextEditingTarget` 跳过输入框/文本域/下拉/可编辑区，不抢文本框里的撤销。监听器依赖补上 `undo`/`redo`。
  - `WorkspaceHeader` 新增 `canUndo`/`canRedo`：为 `false` 时按钮 `disabled`，并给出「没有可撤销的操作（Ctrl+Z）」这类提示；`App.tsx` 从 store 的 `history.length`/`future.length` 计算。
- **RED→GREEN 证据**：`App.test.tsx` 新增 3 个用例，先在旧实现上失败并给出正确原因（`expected [ { id: 'point3-1', … } ] to have a length of +0 but got 1`、`expected false to be true`），实现后通过；其中"不抢文本框快捷键"的用例作为反向守卫。
- **浏览器实测**：`Ctrl+Z` revision 1→0、`Ctrl+Y` 0→1、`Ctrl+Shift+Z` 1→2；按钮禁用态随历史正确切换（绘图后 undo 可用/redo 禁用 → 撤销后 undo 禁用/redo 可用 → 重做后反过来）。
- **回归**：全量单测 51 个测试文件、484 个用例通过；4 个 workspace 类型检查通过；lint 0 error、37 条 warning（无新增）；生产构建通过；Playwright 30/30 通过。
### P6 v3-10 模板子元素可选取 + 平面可手动定尺寸（已完成）

- **修复一：模板实体的棱/面取不到**。既有规则（`templateTopologyOwners` + `resolveSelectableHit`）把落在模板生成棱/面上的命中映射回所属实体，这是 P6 v3 第 1 号修复让实体"能被点选"的关键，因此不能简单推翻。改为 `resolveSelectableHit(id, owners, keepSubElement)`：默认行为不变，**按住 Alt 点击**时保留命中到的棱/面本身。
- **修复二：平面只有自动尺寸**。`plane3` 新增可选 `halfSize`（画出面片的半边长，世界单位）；`createPlane3Mesh` 用 `primitive.halfSize ?? autoHalfSize`，缺省时仍按场景自适应。属性面板新增「平面大小」卡片：半边长数值输入（留空＝自动）与「恢复自动」按钮；`halfSize: null` 会把字段从文档里删除而不是存 0。
- **顺带修掉两个会拦住这次改动的既有缺口**：
  1. `updatePrimitive` 的几何白名单在 `patches.ts` 与 `operations.ts` 里**各有一份**，两份都不含 `plane3`，所以平面此前根本无法通过属性面板修改任何几何。两份都已补上 `plane3`。
  2. `rotation3`（上一轮新增）此前没有任何 patch 校验，非有限角度可以写进文档。现已补上 per-axis 有限性校验与类型校验，`halfSize` 同样补上正数与类型校验。
- **RED→GREEN 证据**：`threeScene.test.ts` 新增 2 个用例，并**临时移除新行为实跑确认它们会失败**（`expected 2.8284270825993416 to be close to 7.0710678118654755`、`expected 'cube-1' to be 'face-1'`），恢复后通过。另新增 `operations.test.ts` 2 个（写入半边长、清空后字段被移除）、`codec.test.ts` 2 个（半边长往返、非正数被拒）。
- **浏览器实测**：普通点击立方体得到「立方体」，Alt+点击同一位置得到「空间面」；平面在有三点时自动尺寸下 x 跨度约 7，填入半边长 8 后跨度翻倍以上，点「恢复自动」回到原值。
- **回归**：全量单测 51 个测试文件、484 个用例通过；4 个 workspace 类型检查通过；lint 0 error、37 条 warning（无新增）；生产构建通过；Playwright 29/29 通过。
### P6 v3-7 修复 1 条遗留：选中态不再覆盖填充色（已完成）

- **根因**：选中态是通过**改写材质基础色**实现的。`createPlane3Mesh` 用 `colour = selected ? "#4c3ac7" : style.fill` 同时充当面片、外框和两条中心引导线的颜色；`createFace3Mesh` 同样用 `color: selected ? "#4c3ac7" : style.fill`。用户刚改完颜色看到的是强调紫，只有取消选中才露出真实填充色。
- **修复**：改成与 `solidMaterial` 一致的**非破坏式**做法——`face3` 与 `plane3` 的材质 `color` 永远取用户填充色；选中提示改由附加的强调色外框承担（`face3` 新增 `face3-outline` `LineLoop` 子对象，`plane3` 的外框与中心引导线在选中时取强调色），并保留选中时略高的面片不透明度。
- **顺带确认**：模板实体（立方体/棱锥/圆柱/圆锥）**本来就没有这个 bug**——`solidMaterial` 一直保留 `color: style.fill` 并用加性 `emissive`（强度 0.28）表达选中，实测选中状态下立方体填充色仍清晰可辨，因此本轮未改动实体渲染。
- **RED→GREEN 证据**：`threeScene.test.ts` 新增 2 个用例，先在旧实现上失败并给出正确原因（`expected '4c3ac7' to be 'ff0000'`），修复后通过；实测选中与未选中截图对照，`plane3` 与 `face3` 在选中态下均显示用户所选的红色填充，外框为强调色。
- **回归**：全量单测 51 个测试文件、466 个用例通过；4 个 workspace 类型检查通过；lint 0 error、36 条既有 warning；生产构建通过；Playwright 24/24 通过。

### P6 v3 验收结果

- 单元/UI 测试：37 个测试文件、360 个用例通过。
- 类型检查：4 个 workspace 通过。
- Lint：0 个 error，保留 36 个既有 hooks、Fast Refresh 和未使用类型 warning。
- 生产构建：Web 与 3 个 package 构建通过；Vite 仍提示主 chunk 超过 500 KB。
- 浏览器验收：17 个 Playwright 用例通过，命令退出码为 0；预览服务在 Windows 上由 `e2e/global-setup.mjs` 启动并通过 teardown 关闭。
- 工作区检查：`git diff --check` 通过，测试结束后 4173 端口无残留服务。

### 之后

P7-1 至 P7-6 与工程工作台层次化改造 Task 1-7 均已完成；P4 Agent、P5 题图解析保持在排除范围内。CAD 工作台的后续可选方向（手动拖动视口边界、B-rep/DWG 导入、自动尺寸布局）仍属于设计文档中的明确限制。

### P7-1 验收结果

- 新增 `DrawingView`、`ProjectionBasis`、`ProjectedPoint` 和 `projectVector3`，投影计算位于 `packages/geometry-kernel`，不依赖 Three.js 或 DOM。
- 主视图显示 X/Y，俯视图显示 X/Z，左视图显示 Z/Y；轴测图使用固定正交基并返回深度值。
- RED 阶段确认缺失模块失败；GREEN 阶段投影与 3D 几何聚焦测试 8 个用例通过，geometry-kernel 类型检查通过。
- P7-1 完整验收：全量单测 38 个测试文件、363 个用例通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 17 个用例通过；`git diff --check` 通过。

### P7-2 验收结果

- 新增 `resolveProjectedDrawing(document, view)`，输出 renderer-neutral 的点、棱折线和闭合面多边形，并保留 DSL 稳定 `sourceId`。
- 缺失点引用、未物化模板和投影退化进入 `diagnostics`，不伪造世界原点、不生成零长度线段；`polyhedron3` 只作为拓扑容器校验，不重复绘制子拓扑。
- 解析结果按有限深度和稳定源 ID 排序；P7-2 聚焦测试 4 个用例通过，与 Three.js/DSL codec 回归合计 59 个用例通过，Web 类型检查通过。
- P7-2 完整验收：全量单测 39 个测试文件、367 个用例通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 17 个用例通过；`git diff --check` 通过。

### P7-3 验收结果

- `cad` 工作区现在渲染主视图、俯视图、左视图和轴测图四个语义面板；每个 SVG 图元保留 `data-source-id`，支持点击、Enter/Space 键盘选择和可见焦点。
- 空文档显示可读空状态；投影诊断以可展开状态展示；CAD 工具栏隐藏二维/三维创建入口，暂时禁用尚未实现的 SVG/PNG 导出。
- P7-3 聚焦 UI 测试 59 个用例通过；完整验收：40 个测试文件、370 个单测通过，四个 workspace 类型检查通过，Lint 0 errors（保留 36 个既有 warnings），生产构建通过，Playwright 18 个用例通过；`git diff --check` 通过。

### P7-4 验收结果

- `ProjectionLine` 保留稳定 `sourceId`、`originView`、`targetView` 和有限投影端点；每个可见 `point3` 源对象在当前视图与其他视图之间生成对应关系，原点等重合投影不被错误丢弃。
- CAD 视图通过共享 `selectedIds` 同步四个面板的选中态；投影线由本地按钮控制，不进入文档、撤销历史或删除/锁定操作；文档 revision 变化会重新计算四个视图。
- P7-4 聚焦测试：`projectionVisuals` 5 个、`EngineeringDrawingView` 3 个、`App` 58 个用例通过；浏览器场景覆盖 CAD 源 ID 选择、12 条投影线显示/隐藏和选中态保留。
- P7-4 完整验收：40 个测试文件、373 个单测通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 19 个用例通过；`git diff --check` 通过。

### P7-5 工程标注与文档兼容

- 新增可选文档字段 `engineeringAnnotations`，旧 `.mgeo` 缺失时解码为空数组；schema 校验稳定 ID、来源、视图、状态、单位和公差，保持 `schemaVersion: "0.1"`。
- `geometry-kernel` 新增线性尺寸、角度和公差解析：从点或棱来源计算值与投影位置，缺失来源和退化来源分别返回 `insufficient-data` / `degenerate`，不伪造坐标。
- Scene Graph 新增工程标注新增/删除操作，并阻止删除仍被工程标注引用的来源对象；Web 投影描述和四视图消费同一份解析结果，展示有效数值及无效诊断。
- CAD 属性栏新增线性尺寸、角度、公差创建入口；创建操作进入文档与 undo history，来源对象移动后随 `revision` 自动重算。
- P7-5 完整验收：41 个测试文件、385 个单测通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 20/20 通过；`git diff --check` 通过。

### P7-6 工程图导出

- 新增共享 `ProjectedDrawing[]` 导出适配器：SVG 输出四视图、稳定源 ID、工程标注和诊断；DXF 输出 `SECTION/ENTITIES` 中的 `LINE`、`LWPOLYLINE`、`POINT` 和 `TEXT`；PDF 使用 `pdf-lib@1.17.1` 输出矢量页面。
- CAD 工具栏启用 SVG、DXF、PDF 下载，3D 工作区仍禁用投影 SVG/PNG；现有平面 SVG/PNG/CSV 行为保持不变。
- 依赖许可证与边界已记录在 `docs/research/graphing-tools.md`，导出器不调用 Three.js 或重复计算投影。
- P7-6 完整验收：42 个测试文件、388 个单测通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 21/21 通过；`git diff --check` 通过。

### 工程工作台层次化改造：Task 1-7（全部完成）

- [x] **Task 1：图层、图纸和视图文档模型**：新增可选 `layers`、`drawingViews`、`drawingSheets`、`activeLayerId` 和 `activeSheetId` 字段；旧 `.mgeo` 自动解释为默认几何层、默认图纸和四个 P7 视图。
- [x] **Task 2：可撤销图层与布局操作**：新增图层、活动图层、图纸和视图的 Scene Graph 操作；删除图层时重分配图元，删除被引用视图或来源时保持引用保护。
- [x] **兼容与校验**：保持 `schemaVersion: "0.1"`，校验图层父子关系、活动引用、视图尺寸/比例和图纸视图引用；历史图元未指定 `layerId` 时不改写存储数据。
- [x] **Task 3：工作台壳、分层命令栏和状态栏**：新增 `CommandBar`（选择/创建/修改/标注/检查/导出六个一级类别、堆叠二级面板、`返回`、仅在命令激活时拦截 `Esc` 且不抢输入框焦点）、`StatusBar`（命令提示、捕捉、坐标、单位、比例、当前图层、诊断数、拒绝原因）和 `EngineeringWorkbench`（模式切换 + 左右停靠面板开关 + 命令区/画布区/Inspector 区/状态区四个插槽）。文件、撤销、重做和保存从 `GeometryToolbar` 上移到 `WorkspaceHeader`，CAD 工作区不再渲染大杂烩工具栏。
- [x] **Task 4：模型树、图层树和图纸树**：新增 `DocumentTreePanel`（三个标签页 + 共享过滤 + 方向键切换）、`LayerTree`（父子缩进、当前层、显隐、锁定、新建子图层、删除保护）、`DrawingTree`（图纸展开视图、类型/比例/来源标签、视图显隐）。`AlgebraView` 支持 `filter`；`store.ts` 增加 `treeTab`/`expandedIds`/`filterQuery` 与 setter，`draftStorage.ts` 增加只保存标签页与展开节点的本地工作台偏好。
- [x] **Task 5：图纸视口与 2D 直接绘图**：`EngineeringDrawingView` 从固定四卡片改为 `DrawingSheetView` + `DrawingViewport`；纸张、标题栏、视口矩形/比例/显隐全部来自持久化文档字段，`sheetPaperSize` 保证被移出或放大的视口不被裁剪。新增 `drawingGeometry.ts` 承载布局数学；`2D 绘图` 模式下绘图视口始终可点击，创建回调走活动视口，新图元带 `activeLayerId`，当前图层隐藏或锁定时拒绝创建并在状态栏说明。投影线开关保持临时 UI 状态。
- [x] **Task 6：上下文 Inspector 与完整流程**：`PropertiesBar` 新增 `sections` 过滤（23 处区块按 数据/外观/约束/工程标注 分类），新增 `InspectorTabs`（方向键切换）与 `EngineeringInspector`（四页签、无选择时的图纸/视图/图层/单位/命令上下文、所选对象所在图层、投影来源列表与「来源已删除」诊断）。`AgentDock` 增加 `showConstraints` 以避免约束面板重复；CAD Inspector 通过 `propertiesBarProps` 复用同一份字段更新逻辑。
- [x] **Task 7：迁移、E2E 与交付验证**：`engineeringExporters` 新增 `selectExportableDrawings`，隐藏视图不参与导出也不生成伪造几何；新增旧 `.mgeo` 迁移与草稿布局往返测试；重写 `e2e/engineering-drawing.spec.ts` 适配新壳，新增 `e2e/engineering-workbench.spec.ts`。
- [x] **聚焦验证**：`npm.cmd test -- packages/dsl/src/codec.test.ts packages/dsl/src/schema.test.ts packages/scene-graph/src/operations.test.ts`：3 个测试文件、41 个测试通过。
- [x] **类型验证**：`@draw/dsl` 与 `@draw/scene-graph` workspace 类型检查通过。

### Task 3-7 验证证据

- Task 3：`CommandBar.test.tsx` 6 个、`EngineeringWorkbench.test.tsx` 5 个用例通过；Web 类型检查通过；lint 保持 0 error。
- Task 4：`LayerTree.test.tsx` 8 个、`DrawingTree.test.tsx` 5 个用例通过；`store.test.ts` 6 个、`draftStorage.test.ts` 4 个用例通过；App 层新增图层树与图纸树联动用例。
- Task 5：`DrawingViewport.test.tsx` 7 个、`DrawingSheetView.test.tsx` 5 个、`EngineeringDrawingView.test.tsx` 4 个用例通过；App 层新增视图比例持久化、2D 绘图写入活动图层、隐藏图层拒绝创建 3 个用例。
- Task 6：`EngineeringInspector.test.tsx` 9 个用例通过；App 层工程标注用例改为先进入「工程标注」页签。
- Task 7：`engineeringExporters.test.ts` 5 个、`draftStorage.test.ts` 6 个用例通过；`e2e/engineering-drawing.spec.ts` 4 个、`e2e/engineering-workbench.spec.ts` 3 个用例通过（共 24 个 Playwright 用例）。
- 全量：`npm.cmd test` 51 个测试文件、484 个用例通过；`npm.cmd run typecheck` 4 个 workspace 通过；`npm.cmd run lint` 0 error、37 条 warning；`npm.cmd run build` 通过；`npm.cmd run test:e2e` 30/30 通过。

> 射线/折线、圆锥曲线和函数采样已接入工具栏、SVG 渲染、属性编辑和 UI 回归测试；选中两条可采样曲线即可创建持久化交点。

## 进度更新规则

- 每次完成一个独立可验证切片后更新本文件。
- 未运行验证命令的内容不得标记为完成。
- 浏览器级验证、单元测试、类型检查和构建分别记录，不互相替代。

## GitHub 协作

- [x] 创建公开仓库，远程地址 `https://github.com/Huo0077/mathcanvas.git`
- [x] 配置远程地址并同步远程 `main` 分支
- [x] 本地 `main` 已设置跟踪 `origin/main`
- [x] 通过远程分支检查确认 `origin/main` 可访问

### 本地与 GitHub 进度对比（2026-09-16 更新）

- 上一轮推送前对比：本地 `main` 为 `48096b4`，`origin/main` 为 `86eb7f3`，本地领先 2 个提交、没有落后提交；那一轮把远程操作指引、统一 Ribbon 基线、测量入口修复与状态栏浮层避让同步到了 GitHub。
- 本轮（Task 7-13 与 Task 14）在本地实现并通过验证后，按用户明确要求一并提交并推送；推送后 `main` 与 `origin/main` 指向同一提交，以推送后的 Git 状态核验为准。
- 本轮同步范围：平面几何改名、A/B/C 与 3D 画布点名、重命名入口前移、多模态入口收敛、右侧面板精简（约束/智能体展示移除、数据保留）、CAD 画布随停靠面板扩大、法向量/二面角底部提示、**工程制图视觉重做**（制图台 + 图纸、图框与图签、视图框刻度、显式缩放、单列响应式修复），以及对应的单测/E2E 与文档。

下一步：由用户在本地浏览器验收本轮 UI 优化与工程制图视觉重做；P4 Agent 与 P5 题图解析保持排除。

## 最新验证证据

- **P6 v3 全量单测**：35 个测试文件、**353** 个用例通过（本轮起始 337，新增 16 个全部是回归用例）
- **P6 v3 类型检查**：4 个 workspace 通过
- **P6 v3 浏览器验证**：Playwright **17** 个用例通过（本轮起始 12，新增 5 个：实体点选反复改色、顶点拾取不穿透、删除实体连带拓扑并可撤销、被引用时仍拒绝删除、平面可建可见、打开图形自动取景）
- **P6 v3-1 修复 1 号**：实测画布 `1902px → 760px`，相机宽高比 `0.39 → 1.77`；点击探测 25 点全部只能命中"棱"、命中不到实体 → 修复后 24/77 点命中「立方体 1」，空白处回落 ∅；连续改 3 次填充色，6 个面全部同步
- **P6 v3-2 修复 2 号与选取判定**：用 `System.Drawing` 对截图做连通域测量，顶点手柄 `9px → 6px`，且默认/放大/缩小三个缩放级别都是 6px（旧实现在距离 3 时约 14px）；点最近的顶点手柄得到点 G（点驱动编辑保留），偏 24px 回落到实体，点"背面被遮挡顶点"的投影位置得到实体而非穿透选中
- **P6 v3-3 修复 3 号**：删除「立方体 1」由 28 个图元 → 0 且代数区清空、无报错（旧行为：`object is referenced by another object`，一个都删不掉）；删除「立方体 1 拓扑」同样清空（旧行为：留下 8 点 + 12 棱 + 6 面）；撤销后 28 个图元完整恢复
- **P6 v3-4 修复 4 号**：默认前三点 `A(0,0,0) B(3,0,0) C(0,3,0)`，叉积 `(0,0,9) ≠ 0` 不再共线；建平面后 `data-plane-count=1`（旧为 0，因为根本没有渲染分支），无报错；打开 1 单位四面体 `.mgeo` 相机 `distance 16.00 → 3.32`、`target (0,0,0) → (0.50,0.50,0.50)`，编辑时相机不再跳动
- **P6 v3 新增测试资产**：`e2e/fixtures/tetrahedron.mgeo`（四面体 A(0,0,0) B(0,0,1) C(1,0,0) D(1,1,1)，4 点 + 6 棱 + 4 面），用于取景与二面角回归
- **本轮质量与功能验证**：37 个测试文件、360 个单元/UI 用例通过；4 个 workspace 类型检查通过；ESLint 可执行并无错误（保留 36 条已有风格/依赖警告）；Web 生产构建通过并使用隔离输出目录；新增二面角入口、测量标签、撤销历史上限、展开动画收敛和预览服务退出回归。
- **本轮浏览器验证**：17/17 个 Playwright 用例通过，包括展开/折叠和二面角流程；预览服务改为 global setup/teardown 同进程管理，Windows 下命令正常退出。
- **工程工作台 Task 3-7 最新验证**：`npm.cmd test` 通过，51 个测试文件、464 个测试通过；`npm.cmd run typecheck` 通过，4 个 workspace 无类型错误；`npm.cmd run lint` 通过，0 error、36 条既有 warning（新增组件原本多出 6 条 `react-refresh/only-export-components` warning，已通过抽出 `drawingGeometry.ts` 并把仅内部使用的布局辅助函数改为非导出消除，回到既有基线）；`npm.cmd run build` 通过；`npm.cmd run test:e2e` 通过，24/24 个 Playwright 用例通过。
- **Z 轴朝上验证**：`npm.cmd test` 51 个测试文件、484 个用例通过（新增 1 个相机姿态用例先 RED 后 GREEN，另改 1 个平移基向量用例的期望）；lint 0 error、38 条 warning；生产构建通过；Playwright 30/30 通过；截图确认 +Z 朝上、网格为 XY 地面。
- **微积分工作区退役（切片 1）验证**：`npm.cmd test` 51 个测试文件、484 个用例通过；Playwright 30/30 通过；启动默认工作区为 `geometry3d`，工作区标签中不再出现「微积分」，加载含 `workspace: "calculus"` 的旧 `.mgeo` 仍能正常打开。
- **P7 撤销/重做修复验证**：`npm.cmd test` 51 个测试文件、484 个用例通过（新增 3 个 App 用例先 RED 后 GREEN）；lint 0 error、37 条 warning；生产构建通过；Playwright 30/30 通过（新增 1 个撤销/重做用例）；实测 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 生效且按钮禁用态随历史切换。
- **P6 v3-10 子元素选取与平面尺寸验证**：`npm.cmd test` 51 个测试文件、484 个用例通过；lint 0 error、37 条 warning；生产构建通过；Playwright 29/29 通过（普通点击选实体、Alt 点击选面、平面半边长写入与恢复自动均在真实浏览器验证）。
- **P6 v3-9 朝向能力验证**：`npm.cmd test` 51 个测试文件、478 个用例通过（新增 4 个内核、3 个 codec、2 个 Scene Graph 用例，内核 4 个先 RED 后 GREEN）；lint 0 error、37 条 warning；生产构建通过；Playwright 27/27 通过；浏览器实测包尺寸随朝向改变且刷新后保留。
- **P6 v3-8 视角导航验证**：`npm.cmd test` 51 个测试文件、469 个用例通过（新增 3 个相机用例先 RED 后 GREEN）；lint 0 error、37 条 warning；生产构建通过；Playwright 26/26 通过（新增 2 个视角导航用例）；浏览器实测枢轴沿相机轴向移动、纵深可平移且被夹在图形周围的有限范围内。
- **P6 v3-7 选中态修复验证**：`npm.cmd test` 51 个测试文件、466 个用例通过（新增 2 个 `threeScene.test.ts` 用例先 RED 后 GREEN）；4 个 workspace 类型检查通过；lint 0 error、36 条既有 warning；生产构建通过；Playwright 24/24 通过；浏览器截图对照确认 `plane3` 与 `face3` 选中态下显示用户所选填充色。
- **已知验证提示**：Vite 仍提示主 bundle 超过 500 KB；Vitest 的 3D UI 测试在 jsdom 中输出 Three.js WebGL context 未实现提示，但测试结果为通过；本轮新增组件已由 `CommandBar`、`EngineeringWorkbench`、`LayerTree`、`DrawingTree`、`DrawingViewport`、`DrawingSheetView`、`EngineeringInspector` 七个测试文件覆盖。

### 历史证据

- `npm test`：15 个测试文件、108 个测试通过
- P6-3 聚焦测试：`apps/web/src/threeScene.test.ts` 通过
- P6-3 全量测试：25 个测试文件、203 个测试通过
- `npm.cmd run typecheck`：4 个 workspace 通过
- P6-3 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-3 浏览器验证：Playwright 被宿主环境的 Vite `.vite-temp` `EPERM` 阻断，未标记为通过
- P6-4 聚焦测试：`apps/web/src/threeScene.test.ts` 的 4 个用例通过
- P6-4 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-4 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-5 聚焦测试：`apps/web/src/threeScene.test.ts` 的 6 个用例通过
- P6-5 Web 构建：待完整验证后记录
- P6-5 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-6 聚焦测试：`apps/web/src/threeScene.test.ts` 的 7 个用例通过
- P6-6 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-6 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-7 聚焦内核/DSL/Scene Graph 测试：48 个用例通过
- P6-7 Web 构建：待完整验证后记录
- P6-7 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-8 聚焦测试：`apps/web/src/threeScene.test.ts` 的 8 个用例通过
- P6-8 Web 构建：待完整验证后记录
- P6-8 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-9 聚焦内核测试：`packages/geometry-kernel/src/geometry3d.test.ts` 通过
- P6-9 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-9 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-10 聚焦测试：3D 属性栏 UI 与 Scene Graph 3D patch 更新测试通过
- P6-10 浏览器验证：Playwright 3D 用例通过，覆盖立方体、棱锥、圆柱和圆锥创建及属性编辑
- P6-10 类型检查：四个 workspace 通过；生产构建通过
- P6-10 review：无 Critical/Important 问题；修复 Three.js 挂载点删除 React 控件和重置按钮覆盖控制组问题
- P6-11 最终验证：全量单测 25 个测试文件、215 个用例通过；全量 Playwright 6 个用例通过；生产构建通过；`git diff --check` 通过
- P6 v2-1 验证：DSL codec 23 个用例通过；CSV exporter 6 个用例通过；全量单测 25 个测试文件、219 个用例通过；四个 workspace 类型检查通过；隔离目录 Vite 生产构建通过；`git diff --check` 通过
- P6 v2-2 验证：geometry3d 与 solid-builders 聚焦 19 个用例通过；全量单测 26 个测试文件、235 个用例通过；四个 workspace 类型检查通过；隔离目录 Vite 生产构建通过；`git diff --check` 通过
- P6 v2-3 验证：Scene Graph 聚焦 31 个用例通过；全量单测 26 个测试文件、240 个用例通过；四个 workspace 类型检查通过；`git diff --check` 通过
- P6 v2-4 验证：UI 聚焦测试 53 个用例通过；全量单测 26 个测试文件、245 个用例通过；四个 workspace 类型检查通过；隔离目录 Vite 生产构建通过；`git diff --check` 通过；浏览器验证因宿主环境浏览器绑定 `Cannot redefine property: process` 阻断，未标记为通过
- P6 v2-5 验证：DSL、builder、迁移和 Scene Graph 聚焦测试 73 个用例通过；四个 workspace 类型检查通过；Web 生产构建通过；3D 模板 Playwright 用例 1 个通过；`git diff --check` 通过
- P6 v2-6 聚焦测试：`measurements3d.test.ts` 4 个、`constraints3d.test.ts` 2 个、`patches.test.ts` 23 个、`scene-store.test.ts` 34 个、`AlgebraView.test.tsx` 5 个、`store.test.ts` 1 个用例通过
- P6 v2-6 全量单测：32 个测试文件、286 个用例通过（本轮新增 `store.test.ts`、`AlgebraView.test.tsx`、`spatialTools.test.ts` 三个测试文件，并为测量重算、测量删除、补丁校验、拾取优先级/子部件、空间工具门控和 `.mgeo` 测量往返补充用例；同时修复了 Slice 5 拓扑迁移遗留的 2 个 App UI 失败用例）
- P6 v2-6 类型检查：四个 workspace 通过
- P6 v2-6 Web 生产构建：`vite build` 通过
- P6 v2-6 浏览器验证：Playwright 8 个用例通过，其中新增“空间点拾取并创建教学测量”“顶点/棱/面子树展开”2 个 3D 用例；本机需先执行 `npx playwright install chromium` 安装浏览器
- P6 v2-6 修复：测试未重置整个 store 造成跨测试文档污染（改为在 `beforeEach` 完整重置，保留 `replace` 按工作区合并的语义，避免打开文件后把其他工作区的内存文档和草稿一起覆盖）、`addMeasurement` 缺少形状与字段校验会抛异常并接受非法 metric、测量来源缺失时用世界原点伪造点面距离、单个面/圆错误提供“长度”入口、点在线/点在面的来源顺序依赖点击顺序、App 工具栏误删圆柱/圆锥入口
- P6 v2-6 review：只读 code review 发现并修复了上述数据丢失路径与伪造坐标问题；等长/等角未纳入 DSL，约束投影求解、二面角内角/外角、固定距离输入入口等未完成项已写入功能目录的“明确限制”
- P6 v2-7 聚焦测试：`sections3d.test.ts` 9 个、`scene-store.test.ts` 39 个、`patches.test.ts` 24 个、`threeScene.test.ts` 15 个、`codec.test.ts` 26 个用例通过
- P6 v2-7 全量单测：33 个测试文件、305 个用例通过
- P6 v2-7 review 修复：只读 review 发现非凸截面按质心角度排序会插入跨凹口的对角边，改为沿面邻接串联边界并补充 L 形非凸用例；`sectionPlaneThroughSource` 在无法解析来源顶点时返回 null 而不是伪造 y=1.5 剖切面；`intersectPlaneSegment` 增加显式容差参数并透传
- P6 v2-7 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-7 浏览器验证：Playwright 9 个用例通过，新增“剖切点驱动拓扑并得到可见截面”用例
- P6 v2-7 修复：剖切来源支持任意 `polyhedron3`（含模板生成拓扑），默认剖切平面改为穿过来源包围盒中心，截面点按剖切平面内角度排序并给出 none/point/segment/polygon/insufficient-data 分类，来源实体纳入删除保护
- P6 v2-6 边界：`docs/feature-catalog.md` 与实施计划同步更新；Slice 6 只覆盖拾取/约束/测量，截面仍在 Slice 7
- P6-8 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-7 Web 构建：`vite build` 使用隔离 `outDir` 通过
- 默认 `npm.cmd run build`：当前沙箱因 Vite 写入 `.vite-temp`/`dist` 返回 `EPERM`；使用 `vite build apps/web --configLoader runner --outDir D:\\draw\\build-check\\mathcanvas-current` 完成等价 Web 构建验证
- `npm.cmd exec playwright test`：5 个 Chromium 浏览器用例通过
- `npm.cmd run lint`：未执行成功，仓库当前未安装 `eslint` 命令
- GitHub：P2 修复与 P3-1 之前的提交均已推送到 `origin/main`

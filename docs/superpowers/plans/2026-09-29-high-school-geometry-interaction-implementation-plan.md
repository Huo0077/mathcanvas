# 高中数学立体绘图交互 Implementation Plan（待评审）

> **For agentic workers:** 实施前必须先阅读对应任务说明，并在用户确认后逐任务执行；每项按“失败测试 → 最小实现 → 回归”推进。当前所有复选框均未开始，本轮不得执行实现。

**Goal:** 让立体几何从“先加点再多选”变成可在画布按步骤直接作图，并补齐高中常见棱柱/棱锥、教学表达入口。

**Architecture:** 把创建会话与 3D 射线拾取/工作平面投影分开，预览只存在于 UI；落盘统一经过 `scene-graph` 的事务与现有构造器。新入口优先复用已有 DSL 类型、已有实体拓扑、撤销和相机，避免视图侧自造第二份几何事实。

**Tech Stack:** React 19、TypeScript、Zustand、Three.js 0.186、Vitest、Playwright、npm workspaces。

**Spec:** `docs/superpowers/specs/2026-09-29-high-school-geometry-interaction-design.md`

## Global Constraints

- 这是**待审阅草案**：先确认需求范围和手势规则，确认之前只允许调整文档。
- 保持旧 `.mgeo` 文件可读、点/棱/面依赖 ID 稳定、一次构造一步撤销；几何判定留在 `geometry-kernel`/`scene-graph`，UI 不重复求解。
- 保持现有 Alt 子图元选择、Shift 多选、旋转手柄、宿主点、剖切和自动取景可用；创建时不得触发视角抢夺。
- 遇到退化、不可判定或缺能力，明示“不支持/需要补充条件”，不伪造结果。
- 首期不增大型几何/AI 依赖；截图识图和球体/球截面不纳入本核心实施计划。
- 每个切片完成后以当次命令结果复核，不引用过期日志；不要在文档内提前勾选未做的任务。

## 文件职责与阶段

| 阶段 | 责任文件 | 独立可验收结果 |
| --- | --- | --- |
| P0a：输入解释 | 新建 `apps/web/src/spatialCreationSession.ts`、`spatialPick.ts`；修改 `threeSceneInteraction.ts` | 工具状态、拾取与工作平面投影可独立测试 |
| P0b：提交与 UI | 新建 `spatialCreationCommands.ts`、`threeCreationPreview.ts`；修改 `App.tsx`、`threeScene.tsx`、`ribbonCommands.ts`、`components/GeometryToolbar.tsx`、`useKeyboardShortcuts.ts` | 从画布一次画点/线/面，Esc 可取消，一步撤销 |
| P1a：实体入口 | 修改 `creationCommands.ts` 或新建聚焦的 `spatialSolidCommands.ts`，修改 Ribbon/工具栏/属性面板 | 棱柱、三棱锥、四棱锥、正方体/长方体入口可用 |
| P1b：教学表达 | 视已有 `PrimitivePresentation.style` 复用情况修改 `threeSceneContent.ts`、`components/PropertiesBar.tsx`，必要时修改 `packages/dsl/src/types.ts`/`schema.ts` | 教学虚线、隐藏棱和点名状态不会混淆 |
| 门禁 | 相关 `*.test.ts(x)`、`e2e/geometry3d*.spec.ts`、`docs/feature-catalog.md` | 六类样题、旧文档、相机/撤销回归 |

**阶段切分**：先交付 P0（不依赖新实体）；通过教师样题试用后再决定 P1 顺序。以下接口是拟议精确契约，实施时若与现有类型冲突，应先修订本计划并标出影响，不能悄悄改名。

---

### Task 1：锁定行为基线与优先级（P0）

**Files:** Modify `e2e/geometry3d.spec.ts`；Test `apps/web/src/spatialTools.test.ts`、`apps/web/src/threeScene.test.ts`。

**Interfaces:** Consumes existing `point3ToolAvailability` and `ThreeSceneView`；Produces baseline tests for old selection and camera behavior.

- [ ] 在现有 e2e 中增加基线用例：默认选择、Shift 两点多选创建空间直线、Alt 点击实体子图元、相机旋转/拖动、Esc、撤销与文档恢复；保存当前 UI 行为作为对照（不改运行时代码）。
- [ ] 运行 `npm test -- apps/web/src/spatialTools.test.ts apps/web/src/threeScene.test.ts` 与 `npm run test:e2e -- e2e/geometry3d.spec.ts`，记录真实通过/失败及测试环境问题；新增测试在改造前能验证旧行为。
- [ ] 将“添加立方体”实际尺寸与名称不一致（当前默认尺寸 `4×4×2`）、棱柱有内核但缺手工入口记录为待修的交互债；不要误把它们写成“内核缺失”。

### Task 2：独立的创建状态机（P0）

**Files:** Create `apps/web/src/spatialCreationSession.ts`、`apps/web/src/spatialCreationSession.test.ts`；Modify `apps/web/src/guidance.ts`。

**Interfaces:** Produces `type SpatialTool = 'point3' | 'segment3' | 'line3' | 'ray3' | 'plane3' | 'face3'`，`type SpatialCreationSession = { tool: SpatialTool; anchors: Array<{ pointId?: string; position: {x:number;y:number;z:number} }> }`，`advanceSpatialCreation(session, anchor)` 与 `cancelSpatialCreation()`；`face3` 用 Enter 完成，其他模式达到所需点数完成。

- [ ] 写失败测试：线段恰好两点完成、平面三点完成、空间面不足三点不能提交、连续点重复不接受、Esc/切工作区取消后没有草稿对象；结果区分 `needs-more | ready | rejected(reason)`。
- [ ] 运行 `npm test -- apps/web/src/spatialCreationSession.test.ts`，确认**因新模块/行为未实现而失败**，不是测试配置错误。
- [ ] 实现纯状态转换和逐步中文提示，不在该文件执行 React 状态或几何落盘；空间面 Enter 时检查至少三点，退化校验委托 Task 4。
- [ ] 再运行上项测试，核对全部通过并覆盖首点/末点相同的边界。

### Task 3：确定性的 3D 拾取与工作平面（P0）

**Files:** Create `apps/web/src/spatialPick.ts`、`apps/web/src/spatialPick.test.ts`；Modify `apps/web/src/threeSceneInteraction.ts`（只注入拾取结果与创建分支）；视需要复用 `threePick.ts`/现有 raycast 文件的接口。

**Interfaces:** Produces `type WorkPlane = 'xy'|'xz'|'yz'|{faceId:string}` 和 `type SpatialAnchor = {position:Vector3; pointId?:string; source:'point'|'edge'|'face'|'work-plane'}`；`resolveSpatialAnchor(hit, ray, plane): SpatialAnchor | {reason:string}`。`hit` 须使用已有拾取与可见性规则，`ray` 不在 React 层重建几何。

- [ ] 写失败测试：已有点优先于边/面，空白射线落在 `z=0`，切 XZ/YZ 后世界坐标准确；射线与工作面近平行时返回明确失败；隐藏或锁定对象不被当作可吸附目标。
- [ ] 运行 `npm test -- apps/web/src/spatialPick.test.ts` 并核对失败原因。
- [ ] 最小实现复用 Three.js 射线与现有拾取次序；面与边的最近点/投影若现有内核没有可靠 API，只显示预览不做隐式绑定，不允许凭像素猜宿主参数。
- [ ] 运行聚焦单测，并补相机斜视、面背侧、距离容差、重叠点测试。

### Task 4：一次事务的画布创建（P0）

**Files:** Create `apps/web/src/spatialCreationCommands.ts`、`apps/web/src/spatialCreationCommands.test.ts`；Modify `apps/web/src/App.tsx`、`apps/web/src/point3ToolCommands.ts`（保留旧命令），必要时 `packages/scene-graph/src/actions/index.ts`（仅已有编译器不能表达时）。

**Interfaces:** Consumes `SpatialCreationSession`、`SpatialAnchor`；Produces `commitSpatialCreation(document, session): {operations: DomainOperation[]; selectedId:string} | {error:string}`。从 `pointId` 引用既有点；空白锚点按顺序创建新的 `point3`；`line3`/`plane3` 使用 `throughPoints`，线段/射线/面引用同一批点 ID。

- [ ] 写失败测试：两次空白点击生成 2 点 + 1 线，已有点复用而不重复建点，三点共线建平面拒绝且文档零变化，Alt/Shift 原有高级建图路径照常；一次构造只增加一步撤销历史。
- [ ] 运行 `npm test -- apps/web/src/spatialCreationCommands.test.ts`，确认是预期失败。
- [ ] 用现有 ID 分配和 `applyBatch`/等价的场景事务提交**整批**操作；内核验收失败时全批不提交，不能先写点后报错。既有 `addLine3/addPlane3/addFace3` 保留为“先选后建”快捷方式。
- [ ] 运行聚焦单测、`npm test -- apps/web/src/point3ToolCommands.test.ts`（若该文件不存在则选择已有 `apps/web/src/spatialTools.test.ts`），验证一步撤销和保存/加载往返。

### Task 5：状态提示、预览和画布交互（P0）

**Files:** Create `apps/web/src/threeCreationPreview.ts`、`apps/web/src/threeCreationPreview.test.ts`；Modify `apps/web/src/threeScene.tsx`、`apps/web/src/threeSceneInteraction.ts`、`apps/web/src/ribbonCommands.ts`、`apps/web/src/components/GeometryToolbar.tsx`、`apps/web/src/useKeyboardShortcuts.ts`、`apps/web/src/statusPrompts.ts`；Test `e2e/geometry3d-creation.spec.ts`。

**Interfaces:** `ThreeSceneView` 增加只读 `creationSession?: SpatialCreationSession | null`、`onCreationAnchor?: (anchor:SpatialAnchor)=>void`、`workPlane?: WorkPlane`；悬停生成 `threeCreationPreview`，**仅预览**、不能写文档。

- [ ] 写失败 e2e：选线段→第一点预览→第二点提交；空白落点/已有点引用；Esc 取消不改文档；平面选择方式可见；从工具按钮可选“选择工具”退出；状态提示步骤数明确。
- [ ] 运行 `npm run test:e2e -- e2e/geometry3d-creation.spec.ts`，确认行为未实现而失败。
- [ ] 实现创建会话覆盖在原拾取分支之上但**在预览点击之后优先决定**；悬停辅助标记展示目标、世界坐标与工作平面，不渲染为持久图元；模式切换/工作区切换取消未提交状态。
- [ ] 重新运行创建 e2e、`e2e/geometry3d-drag.spec.ts`、`e2e/geometry3d-camera-memory.spec.ts`、`e2e/three-intersection-previews.spec.ts`，核对相机/拖动/交点预览未回退。

### Task 6：立体模板和棱柱的手工入口（P1）

**Files:** Create `apps/web/src/spatialSolidCommands.ts`、`apps/web/src/spatialSolidCommands.test.ts`；Modify `apps/web/src/creationCommands.ts`（保留兼容旧按钮）、`apps/web/src/ribbonCommands.ts`、`apps/web/src/components/GeometryToolbar.tsx`、`apps/web/src/components/PropertiesBar.tsx`；Test `e2e/solid-prism.spec.ts`、`e2e/geometry3d-creation.spec.ts`。

**Interfaces:** Consumes `compileSolidPrism(solidId, basePolygon, vector, label)`、`compileTemplateSolid(solidId, primitive)`；Produces `createPrismFromBase(base: Vector3[], vector: Vector3)` 与尺寸校验（参数均为有限正数，斜棱柱向量不得零长）。创建交互暂以“选择底面点 + 高度/三维向量数值输入”为首版，复杂指针拉伸后置。

- [ ] 写失败测试：任意三角形/四边形底面生成正棱柱、斜棱柱；模板正方体三边相等，长方体三边可不同且名称正确；一般棱锥底面三角形/四边形 + 顶点；共线底面或零向量拒绝且无残留。
- [ ] 运行 `npm test -- apps/web/src/spatialSolidCommands.test.ts` 并核对预期失败。
- [ ] 复用既有棱柱编译器与模板拓扑；一般棱锥若现有构造器不支持，不手写散面的持久语义，先扩内核/场景的纯构造测试再接 UI；新按钮首先展示预设参数与放置位置，不再固定扔到不同象限。原“添加立方体”旧文档只改新建时的名称/默认形状，不迁移旧对象的尺寸。
- [ ] 运行棱柱单测、`npm run test:e2e -- e2e/solid-prism.spec.ts`，加保存/恢复、移动顶点、一步撤销、截面/量测回归断言。

### Task 7：教学线型与可见性语义（P1，先审查再做）

**Files:** Modify `apps/web/src/components/PropertiesBar.tsx`、`apps/web/src/threeSceneContent.ts`；只有需要持久化教学覆盖时才修改 `packages/dsl/src/types.ts`、`schema.ts`、`codec.test.ts`；Test `apps/web/src/threeSceneContent.test.ts`、`e2e/geometry3d-creation.spec.ts`。

**Interfaces:** Existing `PrimitivePresentation.style?.dash` is preferred for explicit instructional dashes；the view-only hidden-edge toggle remains independent. If `dash` schema or 3D line renderer lacks support, add it through DSL/schema/renderer together; do not convert all hidden edges into persisted dashed lines.

- [ ] 写失败测试：一条教学辅助线存/取仍为虚线；切换自动隐藏棱只改变显示层，不改教学线型；旋转视角后顶点标签仍与对象对应。
- [ ] 运行 `npm test -- apps/web/src/threeSceneContent.test.ts packages/dsl/src/codec.test.ts`，记录预期失败。
- [ ] 补属性入口和 Three.js 线型渲染（复用现有 `style.dash`；如果已有可用则仅加 UI 与测试），保持现有剖切/交线自身的颜色与预览虚线不混入教学线型。
- [ ] 复跑聚焦测试和相关 e2e；确认旧无样式文档渲染不变。

### Task 8：样题验收与发布决策（P0/P1 收尾）

**Files:** Create `e2e/high-school-geometry-tasks.spec.ts`；Modify `docs/feature-catalog.md`、本任务说明的验收记录小节（如需补充验收结果）。

**Interfaces:** Uses the released tool and test selectors, no new production API.

- [ ] 把任务说明 S1–S4 中六类题转成可重放的操作序列，分别覆盖三棱锥/四棱锥、斜棱柱、异长长方体、圆锥截面、点线面构造、旧文档恢复；每题断言对象类型、坐标/尺寸、依赖、保存、撤销，而非只断言截图存在。
- [ ] 执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run test:e2e -- e2e/high-school-geometry-tasks.spec.ts`；记录通过数和未覆盖风险。桌面包装有改动时才追加 `npm run test:rust`。
- [ ] 实际做一次教师/学生走查：比较从空白到“三点一面”的主操作数、误操作数和恢复路径；目标 ≤8 次主操作、不必按 Shift。达不到则记录改进项，不用“代码已通过”代替可用性。
- [ ] 更新 `docs/feature-catalog.md` 明确“实际已完成”和 P2/独立探索未完成项目，并请用户再决定是否启动球体、截图识图与扩展导出。

## 不在此计划内，但保留明确入口

- **球体与球截面**：需独立设计 `sphere` 文档类型、构造/截交/投影与退化语义，批准后另立方案和实施计划；不能把“外接球读数”冒充球图元。
- **图片→可编辑数学图**：单列探索与质量门禁（样题集、标注歧义、人工核对、真实 provider 结果、草稿确认）；当前 Agent 发布门禁不允许直接宣称“截一张图就能正确生成所有高中图”。
- **平面/函数逐题补缺与导出 HTML/GGB**：对现有能力做教师样题盘点再单独排期；视频所示导出能力不是本项目已交付功能。

## 自检与交接

- 覆盖检查：任务 2–5 对应 S1，任务 6 对应 S2/S3，任务 7 对应 S4，任务 8 跨场景验收；S5/S6/S7 明确独立门禁，不混充本期交付。
- 契约检查：`SpatialAnchor` 在任务 3 定义，被任务 4/5 消费；`SpatialCreationSession` 在任务 2 定义，被任务 4/5 消费；提交只走任务 4 的场景事务。
- 开始实现的门槛：**用户确认任务说明中的范围、三项待拍板问题和本实施计划之后，才能勾选任务并修改产品代码**。建议先执行 P0，到此停一次请用户体验，再决定是否执行 P1。
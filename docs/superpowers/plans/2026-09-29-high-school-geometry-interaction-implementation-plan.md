# 高中数学立体绘图交互 Implementation Plan（实施中）

> **For agentic workers:** 实施前先读对应任务说明；用户已确认立体优先并允许分期实施。以下勾选表示已有可核对证据，**未勾选项和 Task 8 仍需完成**；每项继续按“失败测试 → 最小实现 → 回归”推进。

**Goal:** 让立体几何从“先加点再多选”变成可在画布按步骤直接作图，并补齐高中常见棱柱/棱锥、教学表达入口。

**Architecture:** 把创建会话与 3D 射线拾取/工作平面投影分开，预览只存在于 UI；落盘统一经过 `scene-graph` 的事务与现有构造器。新入口优先复用已有 DSL 类型、已有实体拓扑、撤销和相机，避免视图侧自造第二份几何事实。

**Tech Stack:** React 19、TypeScript、Zustand、Three.js 0.186、Vitest、Playwright、npm workspaces。

**Spec:** `docs/superpowers/specs/2026-09-29-high-school-geometry-interaction-design.md`

## 执行快照（2026-09-29，功能分支，尚未并入 main）

| 任务 | 状态与已核证据 | 尚缺证据/工作 |
| --- | --- | --- |
| 1. 基线 | **清单两条已勾选**：`e2e/geometry3d.spec.ts` 22→**24 项**（新增 Shift 两点→创建空间直线端到端、Esc 分级基线），24/24 通过；`spatialTools.test.ts` + `threeScene.test.ts` **74/74**；其余四条在他处已有回归（默认选择与 Alt 子图元在同文件、相机旋转在 `geometry3d-drag.spec.ts`、撤销在 drag/section/solid-prism、文档恢复在同文件"打开后取景"与六类样题）。默认 `4×4×2` 尺寸债已改并记录 | **这些是改造后补的对照，不是改造前基线** —— 改造已完成，无法再取"改造前"读数；计划原文"新增测试在改造前能验证旧行为"一句已无法事后满足 |
| 2. 创建会话 | **清单四项全部勾选**：`spatialCreationSession.test.ts` 先红后绿，4→**10 项**（补齐 point3 一点完成 / line3+ray3 两点完成 / face3 永不自动完成 / 首末点重合 / 非有限坐标 / 拒绝原因文案）；Esc 与切工作区取消由两条 e2e 覆盖并各带变异；状态函数、Esc/Enter/退一步路径已接入 | 取消用 `updateSpatialSession(null)`，没有另造计划中的 `cancelSpatialCreation()` 导出（**命名差异，非缺失**）；中文步骤提示由 `App.tsx` 提供 |
| 3. 3D 落点 | `spatialPick.test.ts` 11 项及创建 e2e 已验证 XY/XZ/YZ/选中面、已有点与近平行拒绝、相机斜视/面背侧/距离容差/重叠点；**"隐藏或锁定不被吸附"两半都有据**（隐藏构造性挡在场景外；锁定由创建拾取层过滤，自带对照的 e2e + 变异） | 选中面接口实际传 `normal/constant`，不是原计划的 `{faceId}`（**接口差异，非缺失**）；悬停目标名/世界坐标已由 `[data-creation-readout]` 覆盖 |
| 4. 原子创建 | `spatialCreationCommands.test.ts` 验证已存在点复用、共线拒绝、`applyBatch` 一步撤销；旧 Alt/Shift 路径回归通过 | 直接作图的新文档保存/重新打开往返需纳入代表样题 |
| 5. 画布 UI | **任务项全部勾选**：创建 e2e 9 项（原 5 项 + 工作区切换取消、优先于预览点击、选择工具退出、悬停读数）9/9 通过；悬停的目标名/世界坐标/工作平面由 `[data-creation-readout]` 断言，选择工具退出补齐；相机/拖动/求交预览旧回归通过 | 无（本任务清单内条目已逐条有回归或定向变异检查） |
| 6. 实体入口 | 构造器、参数面板、未保存预览、正方体/长方体、三/四棱柱和棱锥 e2e 通过；旧 `.mgeo` fixture 可打开 | 从手工入口创建后的依赖/保存/量测/截面组合用例仍待 Task 8 |
| 7. 教学线型 | `threeTeachingLines.test.ts` 与 `geometry3d-teaching-lines.spec.ts` 先红后绿；`style.dash` 与“隐藏边”保持独立，旧无样式线仍用实线 | 旋转视角后的标签遮挡、选中线时三色旋转环遮挡教学图面的体验尚未通过样题验收 |
| 8. 样题与发布决策 | **进行中（第 1、4 项已勾选；三批样题 + 两处修复 + 三块补充用例已上传，提交 `cecc1fe`、`0166845`、`1a82c97`、`4968051`、`e25cacb`、`07ac450`、`75e63a6`、`7067d3a`、`f48d579`）**：`e2e/high-school-geometry-tasks.spec.ts` **7 项覆盖全部六类**（三/四棱锥、斜三棱柱、异长长方体、圆锥截面、空间直线与平面的关系、已有文档恢复与撤销），7/7 通过；两处查实缺陷均已修并各带回归；Task 3/4/6 的补充用例各带定向变异检查；`docs/feature-catalog.md` 已收口（本期已完成 / 未完成 + 待用户决定项）。第 2 项的门禁**本轮再复跑**：`typecheck` exit 0 / `lint` 0 error 13 warning / 全库单测 **266 文件 3072 项通过 + 1 todo**（241 s）/ 样题 spec **7/7** 全通过，**但 `npm run build`（= `build --workspaces`，含 `@draw/desktop` 的 Tauri/Rust 打包）未跑**（本轮目标把桌面打包划归用户侧），故第 2 项仍未勾选 | 完整 `npm run build`（桌面打包，用户侧）；全量 `npm run test:e2e`；教师/学生操作数与误操作调查（用户侧） |

**已实现的文件/接口与原计划的差异（明示而非悄悄改名）**：3D 指针创建采用 `threeScene.tsx` 的捕获事件 + `threeSceneEffect.ts` 的稳定运行时，不直接往既有 `threeSceneInteraction.ts` 选择/旋转分支塞模式；传统工作台实际入口是 `ribbonCommands.ts` 而非未挂载的 `components/GeometryToolbar.tsx`；实体表单为新建 `SpatialSolidWizard.tsx`/`spatialSolidWizardModel.ts`；3D 教学线材质位于 `threePrimitives.ts`，原有 DSL 的 `PrimitivePresentation.style.dash` 已足够，无需修改 schema。当前功能目录、测试读数和未完成项见 [专题进度](../../research/2026-09-29-high-school-geometry-interaction-progress.md)。

## Global Constraints

- **用户已确认任务范围**：立体交互优先；球体/球截面与截图绘图后置。未完成验收前不得宣称整期交付。
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

- [x] 在现有 e2e 中增加基线用例：默认选择、Shift 两点多选创建空间直线、Alt 点击实体子图元、相机旋转/拖动、Esc、撤销与文档恢复；保存当前 UI 行为作为对照（不改运行时代码）。**（2026-09-29 六条逐条落地：① 默认选择 = `geometry3d.spec.ts` 的"点实体本体选中并反复换色"（空白处点击时属性栏标题不存在，点中后为"立方体 1"）；② **Shift 两点多选创建空间直线** = 本轮新增，原用例只断言到"按钮可用"，现补到真的点下去建出"空间直线 1"，并以操作提示"对象 3"钉住"引用已有两点、没有偷偷另建点"（变异：让 `addLine3` 额外建两个重复点 → 当场红）；③ Alt 点击实体子图元 = 同文件"用 Alt 取到模板面而不是整个实体"；④ 相机旋转/拖动 = 旋转由 `geometry3d-drag.spec.ts` 的"关掉拖动开关后左键回到环绕"覆盖，平移由 `geometry3d.spec.ts` 的沿相机轴平移 + 平移模式左键拖两条覆盖；⑤ **Esc** = 本轮新增（3D 里 Esc 分级：先撤进行中的创建/命令与指引，最后才清空选择；用例断言尘埃落定后属性栏不再编辑任何对象而对象行数一个不少 —— Esc 不是删除。变异：把该档 `setSelectedIds([])` 改成 `deleteSelected()` → 红在行数断言）；⑥ 撤销与文档恢复 = 撤销由 `geometry3d-drag.spec.ts`"一次自由拖动一步撤销"、`geometry3d-section.spec.ts`、`solid-prism.spec.ts` 覆盖，文档恢复由 `geometry3d.spec.ts` 的"打开图形后自动取景"与 `high-school-geometry-tasks.spec.ts` 的第六类（刷新后逐 id 恢复 + 保存往返）覆盖。全程**未改运行时代码**（`git diff --stat -- apps packages` 为空）。**注意：这是改造完成后的后补回归，不是改造前的对照基线**，Task 1 表格行已如实标注）**
- [x] 运行 `npm test -- apps/web/src/spatialTools.test.ts apps/web/src/threeScene.test.ts` 与 `npm run test:e2e -- e2e/geometry3d.spec.ts`，记录真实通过/失败及测试环境问题；新增测试在改造前能验证旧行为。**（2026-09-29 复跑读数：`spatialTools.test.ts` 16 项 + `threeScene.test.ts` 58 项 = **74/74 通过**；`e2e/geometry3d.spec.ts` 22→**24 项、24/24 通过**；测试环境问题无（Playwright globalSetup 每次重建 `apps/web` 到 `build-check/mathcanvas-current` 并预览在 4173）；`tsc -p e2e/tsconfig.json` 与 `eslint e2e/geometry3d.spec.ts` 均 exit 0。**但"新增测试在改造前能验证旧行为"这一句已无法事后满足** —— 改造早已完成，这两条新用例只能特征化**当前**行为；它记录的是"现在的旧路径长什么样"，不能宣称成改造前基线）**
- [x] 将“添加立方体”实际尺寸与名称不一致（当前默认尺寸 `4×4×2`）、棱柱有内核但缺手工入口记录为待修的交互债；不要误把它们写成“内核缺失”。

### Task 2：独立的创建状态机（P0）

**Files:** Create `apps/web/src/spatialCreationSession.ts`、`apps/web/src/spatialCreationSession.test.ts`；Modify `apps/web/src/guidance.ts`。

**Interfaces:** Produces `type SpatialTool = 'point3' | 'segment3' | 'line3' | 'ray3' | 'plane3' | 'face3'`，`type SpatialCreationSession = { tool: SpatialTool; anchors: Array<{ pointId?: string; position: {x:number;y:number;z:number} }> }`，`advanceSpatialCreation(session, anchor)` 与 `cancelSpatialCreation()`；`face3` 用 Enter 完成，其他模式达到所需点数完成。

- [x] 写失败测试：线段恰好两点完成、平面三点完成、空间面不足三点不能提交、连续点重复不接受、Esc/切工作区取消后没有草稿对象；结果区分 `needs-more | ready | rejected(reason)`。**（2026-09-29 六条子句逐条落地：前四条与"三种结果"在模块新建那轮就已先红后绿（见下一项），本轮把剩余边界补到 `spatialCreationSession.test.ts` 4→**10 项**：point3 一个锚点即 `ready`；line3 / ray3 两点 `ready`（补齐 `requiredAnchors` 表）；**face3 无论 4 个点都仍是 `needs-more`，只有 Enter 能收尾**；收尾点与首点重合被拒且**会话不前移**；非有限坐标被拒并带自己的原因（脏数据不留进会话）；未完成图形拒绝提交时的**原因文案**逐字钉住。**"Esc/切工作区取消后没有草稿对象"** 由两条 e2e 覆盖并各带定向变异（`geometry3d-creation.spec.ts` 的 Esc 取消、切换工作区取消），二者都断言对象行数为 0。三处变异（去掉 `Number.isFinite` 守卫 / 去掉重合点守卫 / 把 `face3:3` 塞进 `requiredAnchors`）各自精确抓红对应用例；**顺带查明 face3 不自动完成有"两层独立守卫"**：① 表里没有 `face3` 条目（查表落空，`>= undefined` 恒假）、② 显式 `session.tool !== "face3"`；只拆任一层都仍绿，两层同拆才红。`npm run typecheck` exit 0、该文件 10/10）**
- [x] 运行 `npm test -- apps/web/src/spatialCreationSession.test.ts`，确认**因新模块/行为未实现而失败**，不是测试配置错误。
- [x] 实现纯状态转换和逐步中文提示，不在该文件执行 React 状态或几何落盘；空间面 Enter 时检查至少三点，退化校验委托 Task 4。
- [x] 再运行上项测试，核对全部通过并覆盖首点/末点相同的边界。

### Task 3：确定性的 3D 拾取与工作平面（P0）

**Files:** Create `apps/web/src/spatialPick.ts`、`apps/web/src/spatialPick.test.ts`；Modify `apps/web/src/threeSceneInteraction.ts`（只注入拾取结果与创建分支）；视需要复用 `threePick.ts`/现有 raycast 文件的接口。

**Interfaces:** Produces `type WorkPlane = 'xy'|'xz'|'yz'|{faceId:string}` 和 `type SpatialAnchor = {position:Vector3; pointId?:string; source:'point'|'edge'|'face'|'work-plane'}`；`resolveSpatialAnchor(hit, ray, plane): SpatialAnchor | {reason:string}`。`hit` 须使用已有拾取与可见性规则，`ray` 不在 React 层重建几何。

- [x] 写失败测试：已有点优先于边/面，空白射线落在 `z=0`，切 XZ/YZ 后世界坐标准确；射线与工作面近平行时返回明确失败；隐藏或锁定对象不被当作可吸附目标。**（2026-09-29 六条全部成立，前四条在既有用例里覆盖 —— 已有点优先 / 空白落 `z=0` / XZ+YZ 精确 / 近平行如实拒绝；**最后一条的两半现在都有据**：**隐藏**是构造性的（`threeSceneContent.ts` 先 `filter(isUserVisiblePrimitive)` 再建对象，隐藏图元根本不进场景，射线碰不到）；**锁定**由 `threeSceneEffect.ts` 的 `resolveCreationAt` 负责（`visible === false || locked || 生成的 point3` 一律丢弃命中），新增一条**自带对照**的 e2e 实证 —— 同一屏幕坐标未锁定读"已有点 (0.00, 0.00, 0.00)"、锁定后读"工作平面 XY (…)"、解锁后又读回"已有点"，且点本身仍在画布上；定向变异（摘掉 `primitive?.locked`）当场红，提交 `3e66ce1`。**⚠️ 更正**：此前本项被我记成"锁定那一半未实现、属产品判断" —— 那是在**错的层次**上核对（只看纯函数 `resolveSpatialAnchor`，它不认识文档），已就地更正 `docs/current-status.md`。另需澄清：`isUserVisiblePrimitive` 不看 `locked` 是**对的**，它是渲染可见性判据，锁定不改变可见性）**
- [x] 运行 `npm test -- apps/web/src/spatialPick.test.ts` 并核对失败原因。
- [x] 最小实现复用 Three.js 射线与现有拾取次序；面与边的最近点/投影若现有内核没有可靠 API，只显示预览不做隐式绑定，不允许凭像素猜宿主参数。
- [x] 运行聚焦单测，并补相机斜视、面背侧、距离容差、重叠点测试。**（2026-09-29 完成：`apps/web/src/spatialPick.test.ts` 7→11 项，四项各钉一条性质；三次定向变异证过都能红且不误伤其它用例；提交 `07ac450`）**

### Task 4：一次事务的画布创建（P0）

**Files:** Create `apps/web/src/spatialCreationCommands.ts`、`apps/web/src/spatialCreationCommands.test.ts`；Modify `apps/web/src/App.tsx`、`apps/web/src/point3ToolCommands.ts`（保留旧命令），必要时 `packages/scene-graph/src/actions/index.ts`（仅已有编译器不能表达时）。

**Interfaces:** Consumes `SpatialCreationSession`、`SpatialAnchor`；Produces `commitSpatialCreation(document, session): {operations: DomainOperation[]; selectedId:string} | {error:string}`。从 `pointId` 引用既有点；空白锚点按顺序创建新的 `point3`；`line3`/`plane3` 使用 `throughPoints`，线段/射线/面引用同一批点 ID。

- [x] 写失败测试：两次空白点击生成 2 点 + 1 线，已有点复用而不重复建点，三点共线建平面拒绝且文档零变化，Alt/Shift 原有高级建图路径照常；一次构造只增加一步撤销历史。
- [x] 运行 `npm test -- apps/web/src/spatialCreationCommands.test.ts`，确认是预期失败。
- [x] 用现有 ID 分配和 `applyBatch`/等价的场景事务提交**整批**操作；内核验收失败时全批不提交，不能先写点后报错。既有 `addLine3/addPlane3/addFace3` 保留为“先选后建”快捷方式。
- [x] 运行聚焦单测、`npm test -- apps/web/src/point3ToolCommands.test.ts`（若该文件不存在则选择已有 `apps/web/src/spatialTools.test.ts`），验证一步撤销和保存/加载往返。**（2026-09-29 完成：该文件存在，聚焦三文件 18/18；**一步撤销**由 `spatialCreationCommands.test.ts` 的既有用例覆盖并复跑确认；**保存/加载往返**新增 `mgeoRoundTrip.test.ts` 第 5 条 —— 画布新建的点/线/面经真实入口落盘后 id 与几何不变、三种引用写法都仍指着存在的点、重开后引用旧点会复用；变异检查证过；提交 `7067d3a`）**

### Task 5：状态提示、预览和画布交互（P0）

**Files:** Create `apps/web/src/threeCreationPreview.ts`、`apps/web/src/threeCreationPreview.test.ts`；Modify `apps/web/src/threeScene.tsx`、`apps/web/src/threeSceneInteraction.ts`、`apps/web/src/ribbonCommands.ts`、`apps/web/src/components/GeometryToolbar.tsx`、`apps/web/src/useKeyboardShortcuts.ts`、`apps/web/src/statusPrompts.ts`；Test `e2e/geometry3d-creation.spec.ts`。

**Interfaces:** `ThreeSceneView` 增加只读 `creationSession?: SpatialCreationSession | null`、`onCreationAnchor?: (anchor:SpatialAnchor)=>void`、`workPlane?: WorkPlane`；悬停生成 `threeCreationPreview`，**仅预览**、不能写文档。

- [x] 写失败 e2e：选线段→第一点预览→第二点提交；空白落点/已有点引用；Esc 取消不改文档；平面选择方式可见；从工具按钮可选“选择工具”退出；状态提示步骤数明确。**（2026-09-29 六条逐条落地并复核：① 选线段→提交 = `geometry3d-creation.spec.ts` 第 1 条（点第一个锚点后操作提示出现"第 2"、移动后点第二下得"空间线段 1"、`data-creation-tool` 归零），其中**第一点预览**由图元级单测 `threeCreationPreview.test.ts` 钉住（`segment3` + 1 个已提交锚点 + 悬停点 → 预览折线 `[锚点, 悬停点]`，且会话对象不变 = 只预览不写文档）；② 空白落点/已有点引用 = XZ 用例（空白落在 XZ 面得 (1,0,2)，再以该已有点画线仍只有 3 个对象 = 复用不重复建点）；③ Esc 取消 = 第 2 条（取消后文档里没有 "A"）；④ 平面选择可见 = 工具条「立体绘制工作平面」组切 XZ 后落点 Y≈0、Z≈2；⑤ 选择工具退出 = 新增第 9 条，见任务项实现记录；⑥ 步骤数明确 = 第 1 条断言 `操作提示` 含"第 2"。`geometry3d-creation.spec.ts` **9/9**）**
- [x] 运行 `npm run test:e2e -- e2e/geometry3d-creation.spec.ts`，确认行为未实现而失败。
- [x] 实现创建会话覆盖在原拾取分支之上但**在预览点击之后优先决定**；悬停辅助标记展示目标、世界坐标与工作平面，不渲染为持久图元；模式切换/工作区切换取消未提交状态。**（2026-09-29 完成：① **悬停读数** —— 画布上 `[data-creation-readout]` 显示"吸附目标 + 世界坐标 + 工作平面"，不写文档（e2e 断言对象行数全程不变），提交 `8e700dd`；② **模式切换取消**由既有 e2e「互斥」覆盖、**工作区切换取消**新增 e2e（摘掉清会话即红）；③ **优先于预览点击**新增 e2e：点交面预览只落地一个空间点、不多出交面图元、预览不被消耗 —— 证伪过程查明该优先级有**两层独立守卫**（组件捕获阶段拦截 + 拾取层的点/棱优先规则），两层同时打破才会红；提交 `cc07ab2`。④ **从工具按钮退出**无需新代码 —— `handleRibbonCommand` 对任何非 `draw-` 命令已统一 `updateSpatialSession(null)`，本轮只补回归（提交 `d41e41a`），并做定向变异：把这句改成 `select-tool` 不清会话后新用例立刻红。`e2e/geometry3d-creation.spec.ts` 9/9）**
- [x] 重新运行创建 e2e、`e2e/geometry3d-drag.spec.ts`、`e2e/geometry3d-camera-memory.spec.ts`、`e2e/three-intersection-previews.spec.ts`，核对相机/拖动/交点预览未回退。

### Task 6：立体模板和棱柱的手工入口（P1）

**Files:** Create `apps/web/src/spatialSolidCommands.ts`、`apps/web/src/spatialSolidCommands.test.ts`；Modify `apps/web/src/creationCommands.ts`（保留兼容旧按钮）、`apps/web/src/ribbonCommands.ts`、`apps/web/src/components/GeometryToolbar.tsx`、`apps/web/src/components/PropertiesBar.tsx`；Test `e2e/solid-prism.spec.ts`、`e2e/geometry3d-creation.spec.ts`。

**Interfaces:** Consumes `compileSolidPrism(solidId, basePolygon, vector, label)`、`compileTemplateSolid(solidId, primitive)`；Produces `createPrismFromBase(base: Vector3[], vector: Vector3)` 与尺寸校验（参数均为有限正数，斜棱柱向量不得零长）。创建交互暂以“选择底面点 + 高度/三维向量数值输入”为首版，复杂指针拉伸后置。

- [x] 写失败测试：任意三角形/四边形底面生成正棱柱、斜棱柱；模板正方体三边相等，长方体三边可不同且名称正确；一般棱锥底面三角形/四边形 + 顶点；共线底面或零向量拒绝且无残留。
- [x] 运行 `npm test -- apps/web/src/spatialSolidCommands.test.ts` 并核对预期失败。
- [x] 复用既有棱柱编译器与模板拓扑；一般棱锥若现有构造器不支持，不手写散面的持久语义，先扩内核/场景的纯构造测试再接 UI；新按钮首先展示预设参数与放置位置，不再固定扔到不同象限。原“添加立方体”旧文档只改新建时的名称/默认形状，不迁移旧对象的尺寸。
- [ ] 运行棱柱单测、`npm run test:e2e -- e2e/solid-prism.spec.ts`，加保存/恢复、移动顶点、一步撤销、截面/量测回归断言。**（2026-09-29 部分落地：`e2e/solid-prism.spec.ts` 5→6 项、6/6 通过 —— 新增**量测**（体积 48，读属性栏卡片）与**保存/恢复**（`kind:"prism"`、8 顶点、顶面 = 底面 +(1,0.5,3)、重开包围盒逐字一致）；一步撤销与截面回归由既有两条用例覆盖。**"移动顶点"未落地，根因已复核更正**（不是"静默丢弃"）：棱柱侧面是四边形，改一个顶点会让相邻三个面不共面，被文档校验器按 `face3 points are not coplanar` 整笔退回，界面**会**弹告警、输入框弹回原值；存储层本身支持（会翻成 `fromFaces`），它先过不了校验层。真正的缺口是"没有一条能改单顶点的路径"（拆三角形 or 放宽共面要求，属产品决定），见 `docs/current-status.md` 的如实缺口。故本项**保持未勾选**）**

### Task 7：教学线型与可见性语义（P1，先审查再做）

**Files:** Modify `apps/web/src/components/PropertiesBar.tsx`、`apps/web/src/threePrimitives.ts`（执行时发现线材质实际由此文件构造，未动 `threeSceneContent.ts`）；只有需要持久化教学覆盖时才修改 `packages/dsl/src/types.ts`、`schema.ts`、`codec.test.ts`；Test `apps/web/src/threeTeachingLines.test.ts`、`e2e/geometry3d-teaching-lines.spec.ts`。

**Interfaces:** Existing `PrimitivePresentation.style?.dash` is preferred for explicit instructional dashes；the view-only hidden-edge toggle remains independent. If `dash` schema or 3D line renderer lacks support, add it through DSL/schema/renderer together; do not convert all hidden edges into persisted dashed lines.

- [x] 写失败测试：一条教学辅助线存/取仍为虚线；切换自动隐藏棱只改变显示层，不改教学线型；旋转视角后顶点标签仍与对象对应。**（2026-09-29 完成：前两条由 `threeTeachingLines.test.ts` 的既有用例覆盖（`.mgeo` 往返保虚线、与"隐藏边"独立）并复跑确认；**第三条新加** —— `e2e/geometry3d-teaching-lines.spec.ts` 增至 2 项，对每个 `[data-point-id]` 断言锚点等于它自己那个顶点的投影（±2px，旋转前后各一遍）；变异检查（偏移 +10→+60）当场报 50px；提交 `5bd2444`。顺带查实"指针抬起前最后一次相机移动不触发渲染"并记入如实缺口）**
- [x] 运行 `npm test -- apps/web/src/threeTeachingLines.test.ts packages/dsl/src/codec.test.ts` 及 `e2e/geometry3d-teaching-lines.spec.ts`，确认新材质和「教学线型」入口在实现前按预期失败。
- [x] 补属性入口和 Three.js 线型渲染（复用现有 `style.dash`；如果已有可用则仅加 UI 与测试），保持现有剖切/交线自身的颜色与预览虚线不混入教学线型。
- [x] 复跑聚焦测试和相关 e2e；确认旧无样式文档渲染不变。

### Task 8：样题验收与发布决策（P0/P1 收尾）

**Files:** Create `e2e/high-school-geometry-tasks.spec.ts`；Modify `docs/feature-catalog.md`、本任务说明的验收记录小节（如需补充验收结果）。

**Interfaces:** Uses the released tool and test selectors, no new production API.

- [x] 把任务说明 S1–S4 中六类题转成可重放的操作序列，分别覆盖三棱锥/四棱锥、斜棱柱、异长长方体、圆锥截面、点线面构造、旧文档恢复；每题断言对象类型、坐标/尺寸、依赖、保存、撤销，而非只断言截图存在。**（2026-09-29 完成：`e2e/high-school-geometry-tasks.spec.ts` 7 项、六类全部覆盖、7/7 通过，提交 `cecc1fe` / `0166845` / `1a82c97`；三批各做过变异检查）**
- [ ] 执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run test:e2e -- e2e/high-school-geometry-tasks.spec.ts`；记录通过数和未覆盖风险。桌面包装有改动时才追加 `npm run test:rust`。**（2026-09-29 复跑读数：`npm run typecheck` exit 0（6 workspace + `e2e/` + `scripts/`）；`npm run lint` exit 0、**0 error / 13 warning**；`npm test -- --maxWorkers=3` **266 文件 / 3072 通过 + 1 todo / 0 失败**（241 s）；`e2e/high-school-geometry-tasks.spec.ts` **7/7**。**唯一没跑的是 `npm run build`** —— 查实根脚本是 `npm run build --workspaces`，**包含 `@draw/desktop` 的 Tauri/Rust 打包**，而本轮目标明确把桌面打包划归用户侧、不在范围内（此前一次尝试在 180 s 超时中止），故本项**保持未勾选**。未覆盖风险：全量 `npm run test:e2e`（47 个 spec）仍未复跑，本轮只跑了 3D 相关的两组共 15 个 spec 与该样题 spec；`npm run test:perf` / `npm run test:rust` 未复跑）**
- [ ] 实际做一次教师/学生走查：比较从空白到“三点一面”的主操作数、误操作数和恢复路径；目标 ≤8 次主操作、不必按 Shift。达不到则记录改进项，不用“代码已通过”代替可用性。
- [x] 更新 `docs/feature-catalog.md` 明确“实际已完成”和 P2/独立探索未完成项目，并请用户再决定是否启动球体、截图识图与扩展导出。**（2026-09-29 完成：新增「本期收口」一节 —— 已交付六项（各指当次测试证据）与未交付五项（球体与球截面、截图识图、HTML/GGB 导出、平面函数逐题补缺、教师走查与桌面打包），并明确"需要你决定是否启动"；提交 `f48d579`）**

## 不在此计划内，但保留明确入口

- **球体与球截面**：需独立设计 `sphere` 文档类型、构造/截交/投影与退化语义，批准后另立方案和实施计划；不能把“外接球读数”冒充球图元。
- **图片→可编辑数学图**：单列探索与质量门禁（样题集、标注歧义、人工核对、真实 provider 结果、草稿确认）；当前 Agent 发布门禁不允许直接宣称“截一张图就能正确生成所有高中图”。
- **平面/函数逐题补缺与导出 HTML/GGB**：对现有能力做教师样题盘点再单独排期；视频所示导出能力不是本项目已交付功能。

## 自检与交接

- 覆盖检查：任务 2–5 对应 S1，任务 6 对应 S2/S3，任务 7 对应 S4，任务 8 跨场景验收；S5/S6/S7 明确独立门禁，不混充本期交付。
- 契约检查：`SpatialAnchor` 在任务 3 定义，被任务 4/5 消费；`SpatialCreationSession` 在任务 2 定义，被任务 4/5 消费；提交只走任务 4 的场景事务。
- 开始实现的门槛已由用户在 2026-09-29 确认（立体优先，球体和截图绘图后置）。P0 及部分 P1 已实现；**Task 8 分批推进中**（第一、二批共五类样题已上传，提交 `cecc1fe`、`0166845`；只差「已有文档恢复与撤销」，其余缺口未完成）。用户最新要求：**每完成一个小区块就及时上传 GitHub，并同步更新进度文档**。
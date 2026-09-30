# 变更记录

> **这份文件记"改了什么"，不记"现在什么样"，也不记"当时怎么想的"。**
> - **当前状态**（门禁读数、做到哪一步、还差什么）看 [`docs/current-status.md`](docs/current-status.md) —— 那是"现在时"的**唯一**一处；
> - **过程与证据**（每一轮的 RED→GREEN、被推翻的判断、实测读数、误报清单）看 [`docs/project-progress.md`](docs/project-progress.md) —— 那是**归档**；
> - **架构与能力清单**看 [`docs/feature-catalog.md`](docs/feature-catalog.md)。

## 2026-09-29 —— Task 8 第 2 项门禁复跑（代码侧四条全绿；`npm run build` 属用户侧仍未跑）

- 实施计划 Task 8 那条"执行 `typecheck` / `lint` / `test` / `build` / 样题 e2e"的门禁，本轮把**代码侧四条**在同一个 HEAD 上复跑：
  - `npm run typecheck` **exit 0**（6 个 workspace + `e2e/` + `scripts/`）；
  - `npm run lint` **exit 0，0 error / 13 warning**（与既有基线一致）；
  - `npm test -- --maxWorkers=3` **266 文件 / 3072 项通过 + 1 todo / 0 失败**（241 s；比上一批多 6 项 = 创建状态机补的边界用例）；
  - `e2e/high-school-geometry-tasks.spec.ts` **7/7 通过**（六类代表题）。
- **唯一没跑的是 `npm run build`，原因已查实并写明**：根脚本是 `npm run build --workspaces`，**包含 `@draw/desktop` 的 Tauri/Rust 打包**；本轮目标明确把桌面打包划归用户侧、不在范围内（此前一次尝试在 180 s 超时中止）。所以这一项**保持未勾选**，不拿"web 构建通过"冒名顶替桌面打包。
- **未覆盖风险如实记录**：全量 `npm run test:e2e`（47 个 spec）仍未复跑 —— 本轮只跑了 3D 相关的两组共 15 个 spec 加样题 spec；`npm run test:perf` 与 `npm run test:rust` 未复跑。
- 本批**只改文档**（门禁复跑不产生代码变更）：`git diff --stat -- apps packages` 为空。

## 2026-09-29 —— Task 2 边界补齐：创建状态机的六条子句

- 实施计划 Task 2 那条"写失败测试"列的六件事，前四条与"三种结果"在模块新建那轮就已先红后绿；本轮把剩余边界补到 `apps/web/src/spatialCreationSession.test.ts`（4→**10 项**，模块本身**零改动**——补的是已实现行为的表征）：
  - `point3` 一个锚点即 `ready`；`line3` / `ray3` 两点 `ready`（补齐 `requiredAnchors` 表）；
  - **`face3` 无论多少个点都不会自作主张 `ready`**（4 点仍是 `needs-more`，只有 Enter 收尾）；
  - 收尾点与**首点重合**被拒，且**会话不前移**（多边形不会被悄悄封口又少一条边）；
  - **非有限坐标**（NaN）被拒并带自己的原因，脏数据不留进会话，拒后仍能正常继续；
  - 未完成图形拒绝提交时的**原因文案**逐字钉住。
- **"Esc / 切工作区取消后没有草稿对象"** 由两条 e2e 覆盖并各带定向变异（`geometry3d-creation.spec.ts` 的 Esc 取消、切换工作区取消），都断言对象行数为 0。
- **三处变异各自精确抓红**：去掉 `Number.isFinite` 守卫 / 去掉重合点守卫 / 把 `face3: 3` 塞进 `requiredAnchors` 表 → 恰好红在对应用例上。
- **顺带查明 `face3` 不自动完成有"两层独立守卫"**：① `requiredAnchors` 表里**没有** `face3` 条目（查表落空，`>= undefined` 恒假）；② 显式判断 `session.tool !== "face3"`。**只拆任一层都仍绿，两层同时拆才红** —— 与 Task 5 那条优先级守卫同一个模式，已写进文档。
- **类型门禁抓到一个 vitest 抓不到的问题**：第一版直接写 `finishSpatialCreation(...).reason`，运行时 10/10 绿，但 `tsc` 报 TS2339（联合类型 `SpatialCreationResult` 上 `reason` 只存在于 `rejected` 分支）。改成先断言 `status` 再按分支收窄后 `npm run typecheck` exit 0。
- 本批读数：`npm run typecheck` exit 0；`eslint` 该文件 exit 0；`spatialCreationSession.test.ts` **10/10**；产品运行时代码零差异。

## 2026-09-29 —— Task 1 基线补齐：Esc 分级 + Shift 两点建线端到端

- 实施计划 Task 1 那条"在现有 e2e 中增加基线用例（**不改运行时代码**）"里，`e2e/geometry3d.spec.ts` 缺两条，本轮补上（22→**24 项**，24/24 通过）：
  - **Shift 两点多选 → 创建空间直线**：原有用例只断言到"由选中点创建空间直线"按钮变可用就停了，**没有点下去**。现在补到真的建出"空间直线 1"，并用操作提示 `对象 3` 钉住"引用已有两点、没有偷偷另建点"。变异：让 `addLine3` 额外建两个重复点 → 当场红。
  - **Esc 基线**：查代码确认 3D 的 Esc 是**分级**的（`useKeyboardShortcuts.ts`：先撤进行中的创建/命令与指引，再关指引，最后才清空选择）。用例钉住最后一档的**不变量**：尘埃落定后属性栏不再编辑任何对象（`.inspector-selected-heading h3` 消失），而**对象行数一个不少** —— Esc 不是删除，Delete 才是。变异：把该档 `setSelectedIds([])` 改成 `deleteSelected()` → 红在行数断言。
- **一次假设出错并当场修正**：最初想用 `data-preview-face-count="6"` 证明"实体还在画布上"，实测拿到 **0** —— 那个属性数的是**交面预览**的虚面（模板实体下恒为 0），不是实体自己的六个面。改为 DOM 层面的"Esc 前后对象行数不变"，判据与语义都对得上。
- **如实标注**：这两条是**改造完成后补的对照回归**，不是改造前的基线。改造早已完成，"新增测试在改造前能验证旧行为"这一句已无法事后满足；计划 Task 1 表格行与两条勾选项都写明了这一点。
- 六条基线各自的落点已逐条记入计划：默认选择与 Alt 子图元在 `geometry3d.spec.ts` 自身，相机旋转在 `geometry3d-drag.spec.ts`，撤销在 drag/section/solid-prism，文档恢复在"打开图形后自动取景"与六类样题。
- 本批读数：`tsc -p e2e/tsconfig.json` exit 0；`eslint e2e/geometry3d.spec.ts` exit 0；`e2e/geometry3d.spec.ts` **24/24**；`spatialTools.test.ts` 16 + `threeScene.test.ts` 58 = **74/74**。**产品文件零改动**（`git diff --stat -- apps packages` 为空，两条变异均已恢复）。

## 2026-09-29 —— Task 5 清单收齐：从「选择工具」退出

- 实施计划 Task 5 那条"写失败 e2e"列的六件事，前五件与"步骤数明确"此前已各有覆盖，**只剩"从工具按钮可选『选择工具』退出"没有回归**。补上（`e2e/geometry3d-creation.spec.ts` 增至 9 项）。
- **先查代码再写用例**：这条**不需要新代码** —— `App.tsx` 的 `handleRibbonCommand` 对任何非 `draw-` 开头的命令统一先 `updateSpatialSession(null)` 再执行，`选择工具`（`ribbonCommands.ts` 的 `select-tool`）正好走这条。所以本批只补回归，没有产品改动。
- **用例判据**（不满足于"按钮点了没报错"）：绘制线段 → 点第一个锚点（`data-creation-anchors="1"`）→ 点「选择工具」→ 工具与锚点双双归零、对象行数仍为 0（未提交的锚点不落盘）→ **再点画布空白，仍然创建不出任何东西**（确认退出后回到的是"选择"语义，而不只是状态显示被清掉）。
- **变异检查**：把 `handleRibbonCommand` 里那句统一清会话改成"`select-tool` 时不清"，用例立刻红在 `data-creation-tool` 仍为 `segment3`。已恢复，`App.tsx` 与 HEAD **无差异**（`git diff --stat` 只有 spec 一个文件）。
- **六条子要求逐条复核后**才勾选计划项：① 选线段→提交 = 第 1 条用例，其中**第一点预览**由图元级单测 `threeCreationPreview.test.ts` 钉住（`segment3` + 1 已提交锚点 + 悬停点 → 折线 `[锚点, 悬停点]`，且会话对象未被改动）；② 空白落点/已有点引用 = XZ 用例；③ Esc 取消不改文档 = 第 2 条；④ 平面选择可见 = 工具条切 XZ 后落点 Y≈0、Z≈2；⑤ 选择工具退出 = 本批新增；⑥ 步骤数明确 = 第 1 条断言操作提示含"第 2"。
- 本批读数：`tsc -p e2e/tsconfig.json` exit 0；`eslint e2e/geometry3d-creation.spec.ts` exit 0；该 spec **9/9 通过**。**全库单测未复跑**：只改 `e2e/` 下的文件，而 `vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— Task 5 收口：工作区切换取消 + 绘制优先于预览点击

- 实施计划 Task 5 第 2 项的最后两件没被钉住的事（悬停读数在上一节、模式切换取消由既有「互斥」用例覆盖）。两条都**先查代码确认已实现**，再补回归；该计划项至此可如实勾选。
- **切换工作区取消未提交状态**（`App.tsx` 的 `handleWorkspaceChange` 有 `updateSpatialSession(null)`）：用例 → 绘制线段 → 点第一个锚点后断言**未提交的第一步不落盘**（对象行数仍为 0）→ 切到平面几何再切回 → 工具退出、锚点归零、对象行数仍为 0。变异（摘掉那句清会话）当场红。
- **创建会话优先于预览点击**：指针压在交面预览上点一下，落地的必须是**空间点**、不能多出交面图元，且预览不被这一下消耗（夹具 `overlapping-cubes.mgeo`，配方同 `three-intersection-previews.spec.ts`）。
- **证伪花了三次，过程本身有价值**：① 只摘抬手的 `stopPropagation` → 仍绿；② 两处 `stopPropagation` 都摘 → 仍绿，而排查读数 `point|point3-1|precise|hover|front` 说明交互层确实看到了这次抬手，只是它自己的"点/棱优先于创建"规则让预览输了；③ 再把"预览总是赢"（`previewBeatsPick` 恒真）也打破 → 用例红，如实报出多出一个 `intersectionFace`。**结论：这条优先级有两层独立守卫**（组件捕获阶段拦截 + 拾取层的点/棱优先规则），只破一层不足以让它失效。三次变异全部恢复，三个产品文件与 HEAD **无差异**。
- 本批读数：`eslint` 该文件 exit 0；`tsc -p e2e/tsconfig.json` exit 0；该 spec **8/8 通过**（新增两条）。**全库单测未复跑**：只改 e2e 文件，`vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— Task 5 补充：3D 绘制时的悬停读数（含一处"说一套做一套"的修正）

- 实施计划 Task 5 那条"**悬停辅助标记展示目标、世界坐标与工作平面，不渲染为持久图元**"里，**读数**部分落地（可视辅助——虚线引导 + 小球标记——此前已有）。做法沿用 2D 画布的既有形状：画布上一个只读小条 `[data-creation-readout]`（与 `data-coordinate-readout` 同款），全程不写文档。
- 新纯函数 `apps/web/src/creationHoverReadout.ts`：一个字符串说清三件事 —— 吸附到了什么（已有点 / 棱·线 / 面 / 工作平面）、世界坐标（两位小数）、落在哪张工作平面上。**吸附到对象时不提工作平面**：位置由那个对象决定，再说一句会让人以为它参与了定位；被拒绝时如实给原因。
- 接线走最小改动：`previewCreationAt` 由 `void` 改为**返回拾取结果**，`threeScene.tsx` 自己格式化（不必新增 ref/prop）；指针离开画布、切换工作平面时清掉读数。
- **顺带修掉一处"说一套做一套"**：吸附到已有点时，落点原来取的是**射线命中点**（点手柄球面上的一点，默认相机下实测 `(0.04, 0.04, 0.04)`），而创建出来的图元引用的又是那个点本身 —— 读数因此显示一个**不是那个点坐标**的数字。现在直接换成该点自己的坐标（预览标记也随之更准）。`resolveSpatialAnchor` 那一层不动：它只按命中物回答，不认识文档。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；全库单测 **266 文件 / 3066 项通过 + 1 todo / 0 失败**（248 s）；`e2e/geometry3d-creation.spec.ts` **6/6 通过**。变异检查（让读数不再区分吸附目标）精确抓红两条用例、另两条保持绿。

## 2026-09-29 —— 更正："改不动顶点"不是静默丢弃，而是被共面校验拒绝

- **要更正的是我自己的记录**：本文件同日「Task 6 补充」一节把"属性栏改棱柱顶点坐标"记成**静默丢弃（无任何提示）**。本轮走 UI 的真实路径（`commitPatch` —— `store.apply` 调的就是它）复核，那条**不准确**。
- **实测（两条独立证据）**：
  - 单测：`commitPatch(prism, patchPoint3("solid-1:v6", { x: 0, y: 0, z: 9 }))` → `changed=false`，`error = "the change would make the document invalid: face3 points are not coplanar…"`，文档一个字节都没动。
  - 浏览器（一次性探针，用完即删）：改坐标后输入框弹回原值，同时页面**确实有** `role="alert"`，文案就是这一句。
- **根因**：棱柱（与模板实体一样）的侧面是**四边形**；改一个顶点会让相邻三个面立刻不共面，而文档校验器要求 `face3` 的点共面 → **校验层**把整笔退回。存储层本身支持（`apply.ts` 会把描述翻成 `fromFaces` 再写顶点），它先过不了校验层 —— "存储层能改"不等于"属性栏能改"。
- **另一条现象很可能同源**：拖顶点手柄后 Ctrl+Z 被拒，报的是**同一条**信息（推断：那次拖动被拒、没有历史，于是 Ctrl+Z 撤掉了"创建棱柱"这一步，画面变空、`data-content-bounds` 读出 NaN）。**推断未逐条验证，已如实标注**。
- 新增**表征用例**（`scene-store.test.ts`）：钉住"被拒 + 明确原因 + 文档未变"。它不把"改不动"当成正确行为 —— 哪天真的能改，它会红，提醒改的人同时更新缺口记录与告警文案。
- **仍未修**（属产品决定）：给用户一条能改单顶点的路径（把受影响的面拆成三角形，或放宽共面要求）。
- 本批读数：`eslint` 该文件 exit 0；`npm run typecheck` exit 0；`scene-store.test.ts` **103/103**；全库单测 **265 文件 / 3062 项通过 + 1 todo / 0 失败**（277 s）；`npm run lint` 0 error / 13 warning。

## 2026-09-29 —— Task 7 补充：旋转视角后顶点标签仍逐点对齐

- 实施计划 Task 7 的最后一个未勾选项落地。前两条（教学虚线存/取仍是虚线、切换"隐藏边"只改显示层）已由 `threeTeachingLines.test.ts` 的既有用例覆盖并在本批复跑确认；**第三条此前没有覆盖**。
- 新增用例（`e2e/geometry3d-teaching-lines.spec.ts`，该 spec 增至 2 项）不满足于"标签还在画面上"，而是**逐点对齐**：钉住立方体原点 `(-2,-2,-2)`（4×4×4 ⇒ 八个顶点都是 `[-2,2]³` 的角，这条当前置条件先断言），再对每个 `[data-point-id]` 断言其锚点等于**它自己那个顶点**的投影 —— 期望值按 `pointLabels.ts` 的规则算（`left = (ndcX·0.5+0.5)·宽 + 10`、`top = (−ndcY·0.5+0.5)·高 − 10`），容差 2px；旋转前后各查一遍，并用 `data-camera-azimuth` 确认**真的转了**（否则这条会空过）。
- **变异检查**：把 `pointLabels.ts` 的横向偏移 `+10` 改成 `+60`，用例立刻报 **50px** 偏差（= 60−10）；变异已恢复，产品文件与 HEAD **无差异**。
- **顺带查实一条行为（已记入 `docs/current-status.md` 的如实缺口）**：**指针抬起前的最后一次相机移动不会触发渲染** —— 拖动结束后标签（连同画面）停在上一帧的相机状态，与当前相机读数差约 **30px**，且**不会自行收敛**（轮询 5 秒仍不齐），要等下一次交互才追平。用例因此在拖动后再抖 2px 强制重画一帧，才断言"已对齐的最终状态"。
- 本批读数：`eslint` 该文件 exit 0；`tsc -p e2e/tsconfig.json` exit 0；该 spec **2/2 通过**。**全库单测未复跑**：只改 e2e 文件，`vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— 功能目录收口（Task 8 第 4 项）

- `docs/feature-catalog.md` 新增「**本期收口（2026-09-29）：实际已完成 / 未完成**」一节，放在「当前已实现」与「下一阶段功能」之间，回答"本期到底交付了什么、什么没有"：
  - **已交付**（每条都能指到当次测试证据）：立体画布直接绘制（P0）、常用立体参数面板（P1）、立体教学线型（P1）、截面与解析圆锥曲线读数（A1）、六类高中代表题的可重放验收（`e2e/high-school-geometry-tasks.spec.ts`，7 项）、两处缺陷修复。
  - **未交付、需要你决定是否启动**：① 球体与球截面（P2 独立评审；现有"外接球 / 内切球读数"**不是**球图元）；② 题目截图 → 可编辑数学图（独立质量门禁，当前发布门禁不允许宣称"一键生成"）；③ HTML / GeoGebra 导出（已交付的导出是 `.mgeo` / SVG / CSV / PNG 与工程图的 SVG / DXF / PDF）；④ 平面 / 函数题型逐题补缺；⑤ 教师 / 学生走查与完整桌面打包。
  - **已知但未修的缺陷**三条（锁定对象仍可拾取；棱柱"移动顶点"两条路都不通；实体源测量没有画布数字）。
- 同时修掉 `docs/current-status.md` 里两处**已经过时**的表述：第 59 行还把"六类教学样题的组合验收"列为未完成（Task 8 第 1 项已勾选），第 60 行还写着"`docs/feature-catalog.md` 收口还没做"。
- 本批只改文档（`docs/feature-catalog.md`、`docs/current-status.md`），**未跑** lint / 单测 / 构建：这里没有可执行产物；口径以当次已记录的读数为准。

## 2026-09-29 —— Task 4 补充：画布新建的空间图元也有 `.mgeo` 往返用例

- 计划 Task 4 的待办落地：**一步撤销**由既有用例覆盖（`spatialCreationCommands.test.ts` 的 "undoes the whole drawing gesture in one step through the real scene store"，本次复跑确认）；**保存/加载往返此前没有覆盖** —— `mgeoRoundTrip.test.ts` 原有 4 条只测工作台文档、绑定动点、点集多面体与双曲线绑定，**没有一条**测本期新加的"在 3D 画布上按步骤落点建图元"。本批补上第 5 条。
- 新用例走真实入口（`commitSpatialCreation` + `applyOperation`，与 App 落盘同一条路）：画线段 / 直线 / 面 → `recomputeDerivedObjects` → `encodeMgeo` → `decodeMgeo`，断言：
  - 图元数量与 id 集合不变（7 点 / 1 段 / 1 线 / 1 面，id 无重复）；
  - **依赖仍然指着存在的点** —— 线段 `pointIds`、直线 `definition.pointIds`、面 `pointIds` **各查一遍**（只查一条会漏掉另一种引用写法）；
  - 几何逐值不变；
  - **重开之后还能用**：在重开出来的文档上再画一条线段引用旧点，必须**复用**那个点（只新造另一个点）—— 沿用本文件"光断言字段还在不够"的惯例。
- **变异检查**：把 `commitSpatialCreation` 的复用分支禁掉后，只有这条新用例变红、其余 4 条保持绿；变异已恢复，`spatialCreationCommands.ts` 与 HEAD **无差异**。
- 顺带记一笔类型摩擦（**不是缺陷**）：`SpatialAnchor.position` 在类型上必填，而复用分支并不读它；用例给的是那个点自己的坐标，不是随手编的假值。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；全库单测 **265 文件 / 3061 项通过 + 1 todo / 0 失败**（277 s）；聚焦三文件 18/18。

## 2026-09-29 —— Task 6 补充：棱柱的量测与保存/恢复（"移动顶点"未落地）

- 计划 Task 6 的补充验收里，**量测 + 保存/恢复**落地（`e2e/solid-prism.spec.ts` 由 5 项增至 **6 项**，6/6 通过）：
  - **量测**：底面 4×4、垂直高 3 ⇒ **体积 48**（斜棱柱体积只取决于底面积与垂直高，与斜度无关 —— 同时验证"按向量拉伸"没把体积算错）。读数断言落在**属性栏的测量卡片**上。
  - **保存/恢复**：走页面自己的「保存 .mgeo」产物，核对棱柱以 `construction.kind === "prism"` 落盘、共 8 个顶点、**顶面四点 = 底面四点各加拉伸向量 `(1, 0.5, 3)`**；重新打开后包围盒与保存前**逐字一致**。
- **"移动顶点"这一半没有落地**（计划里该项保持未勾选）。探测过程查出两条实测记录：
  1. **属性栏改棱柱顶点坐标被静默丢弃**：输入框弹回原值、文档不变、**没有任何提示**。模板实体那条"按数值改顶点即翻成 `fromFaces`"的路径没有给棱柱这一支，而棱柱是**构造驱动**的（`base`+`vector` 是真源，8 个顶点只是缓存，见 `packages/dsl/src/types.ts`）。
  2. **拖顶点手柄后 Ctrl+Z 被校验拒绝**：`data-drag-target` 读到**不是**实体；随后撤销时报 `the change would make the document invalid: face3 points are not coplanar`。而从**实体中心**拖动那条既有用例撤销是好的 —— 差别就在抓取点。
- 两条都写进 `docs/current-status.md` 的如实缺口，**没有**在用例里把失败交互钉成"预期行为"；一度写出来的顶点拖拽用例**整条撤掉**（与既有"从中心拖动"重复，且期望值无法诚实钉住）。
- 顺带记一条读数缺口：`measurementVisuals.ts` 的 `pointPositions` **没有 `polyhedron3` 分支**，所以实体源（如体积）的测量**在画布上没有数字**，只能去属性栏读。
- 本批读数：`eslint` 该文件 exit 0；`tsc -p e2e/tsconfig.json` exit 0；该 spec **6/6 通过**。**全库单测未复跑**：只改 e2e 文件，`vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— Task 3 补充：spatialPick 的四条边界用例

- 计划 Task 3 的第二条未勾选项落地：`apps/web/src/spatialPick.test.ts` 从 7 项增至 **11 项**，四条新用例各钉一条真性质：
  - **相机斜视**：斜射线落点精确等于射线与工作平面的交点（`z=0` → `(10,10,0)`；`z=3` 的已选面 → `(7,7,3)`）。
  - **面背侧**：命中点在工作平面**后面**时，落点是命中点本身 `(1,2,-4)`，**不是**该射线与 `z=0` 的交点 `(2,3,0)` —— 命中优先且不替用户猜深度。
  - **距离容差**：`1e-8` 阈值两侧都钉住 —— `1e-9` 如实拒绝；`1e-6` 接受、落点仍在平面上（`y=0`）但 `x > 1e5`，那个"远得离谱"正是阈值存在的理由。
  - **重叠点**：坐标完全重合的两个点，"复用哪一个"只由**命中**决定（回 `point-2` 的 id），不按坐标反查。
- **变异检查**：三次定向变异各自抓红对应用例、其余保持绿 —— 阈值 `1e-8`→`1e-12` 抓红容差用例；让"命中优先"失效抓红背侧与重叠点用例；交点参数减半抓红斜视用例。每次变异后都已恢复，`spatialPick.ts` 与 HEAD **无差异**（已核对）。
- **顺带核对计划同一条里的"隐藏或锁定对象不被当作可吸附目标"**：**隐藏**这一半成立且是构造性的（`threeSceneContent.ts` 先 `filter(isUserVisiblePrimitive)` 再建对象，隐藏图元根本不进场景）；**锁定**那一半不成立（该判据只看 `visible` 与 `tessellation`）。已记入 `docs/current-status.md` 的如实缺口，留作产品判断。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；该文件 **11/11** 通过。**全库单测未复跑**：本批只加测试文件、不涉及产品代码。

## 2026-09-29 —— 修复：「距离」测量不再依赖选择顺序

- **缺陷**（2026-09-29 查实）：属性栏只要"1 个空间点 + 1 个空间平面"就给出「距离」按钮，**与点击顺序无关**（`spatialTools.measurementOptionsFor`）；而内核 `evaluateMeasurement3` 的 distance 分支固定按 `sourceIds[0]` 是点、`[1]` 是平面/直线取数（`pointFromPrimitive` 对 `plane3` 返回 `null`）。于是**先点平面、再选点**会落到"距离需要两个空间点"的兜底：按钮可点、面板无数字、画布不出标签。
- **修法**：在 distance 分支开头把"点那一侧"换到前面（只在 `sources[0]` 不是点、`sources[1]` 是点时才换），取数与说明文案都用交换后的那一对；`measurement.sourceIds` 记的仍是**用户的选择顺序**。三种组合一起受益：点 + 平面(`pointNormal`)、点 + 平面(`throughPoints`)、点 + 直线。
- **TDD 证据（红 → 绿）**：内核新用例 `measurements3d.test.ts` 的 "measures a point-to-plane distance whichever of the two was selected first" 修复前红（plane-first 得到 `insufficient-data`、`value` 为 `undefined`），修复后绿（该文件 10/10）；浏览器侧回归（`e2e/high-school-geometry-tasks.spec.ts` 的线面关系用例）改成**两种顺序都必须量出 3.000u** —— 修复前"平面先选"画布上没有标签（`data-measurement-labels` = 0），修复后两种顺序都绿。说明文案也钉住了：必须写"由点 p 到平面 plane"，不能因为交换而说反。
- 本批读数：全库单测 **265 文件 / 3056 项通过 + 1 todo / 0 失败**（278 s；比上批多 1 项 = 新增的内核用例）；`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning（基线未变）；`npm --workspace @draw/web run build` exit 0；e2e 该文件 7/7 通过。

## 2026-09-29 —— 修复：恢复草稿后第一次改动不落盘（会丢用户数据）

- **缺陷**（2026-09-29 查实）：页面加载恢复草稿后，用户的**第一次改动不会写进草稿**。真机实测：刷新后加一个立方体 → 对象列表出现「立方体 1」，而 `mathcanvas:draft:geometry3d` 仍是 84 个 id；再加第二个才一次跳到 140。后果：刷新后只改一次就关页面，那次改动从 localStorage 草稿里丢失（桌面仓储那一份也在同一个 `return` 之后，一起被跳过）。
- **根因**：`apps/web/src/useDraftPersistence.ts` 自动保存里 `skipNextDraftSaveRef`（本意"刚恢复的内容不要立刻回写"）与 `restoreSettledRef` 的**判断顺序**错了。恢复那一侧先置 skip 再 `replace(...)`，而 settled 是在 restore 那个 promise 的 `.finally()` 里置位 —— 两者赛跑；恢复自身那次变化触发的 effect 若先跑，就在"还没 settled"那一步直接 return、**没有消费 skip**，这支"跳过"最终被用户恢复后的第一次改动吃掉。
- **修法**：把 skip 的消费移到 settled 判断**之前**（一行顺序调换）。不会变松：恢复**自身**那次变化消费掉 skip，用户的第一次改动照常写；"恢复没结束就一个字都不写"这条守卫仍在（skip 为假时依然先看 settled）。
- **回归测试钉在浏览器侧**（`e2e/high-school-geometry-tasks.spec.ts` 的旧文档用例）：刷新恢复后**第一次**改动必须写回草稿。它在本修复前是红的（Expected 112 / Received 84），修复后转绿 —— 所以这条回归确实抓得住。为什么不是单测：真机顺序是 React 调度与 promise `.finally` 的赛跑，而 `useDraftPersistence.test.tsx` 的 harness 里 `rerender` 发生在 `await` 之后、复现不出这条缝（那 9 条单测钉的是**语义**，本修复前后都绿，已复跑确认）。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；`npm test -- --maxWorkers=3` **265 文件 / 3055 项通过 + 1 todo / 0 失败**（280 s）；`npm --workspace @draw/web run build` exit 0；e2e 该文件 7/7 通过。

## 2026-09-29 —— Task 8 第三批：已有文档恢复与撤销（六类代表题齐了）

- 第三批落地第六类「已有文档恢复与撤销」，`e2e/high-school-geometry-tasks.spec.ts` 增至 **7 项**，六类代表题**全部覆盖**。
- 判据走两条真链路（夹具 `overlapping-cubes.mgeo`：**只有模板实体、没有拓扑**的三只立方体）：
  - **迁移**：打开后 `migrateLegacySolids` 物化子对象；夹具自己的图元**按原序在前**、子对象追加在后；总数 = 3 + 3×27（8 点 + 12 棱 + 6 面 + 1 多面体）。
  - **几何不变**：三只立方体的 `origin`/`size` 逐值不变；物化出来的拓扑按产品**自己**判定"已物化"的 `construction = { kind: "template", sourceIds: [模板 id] }` 认领来源，并核对每只 8 个顶点、包围盒恰为 `origin..origin+4`。
  - **恢复**：刷新后草稿仍在 localStorage、应用把它装回文档、**id 列表逐项相同**（把已物化的拓扑再迁一遍就会多出一套子对象，这条能抓住）。
  - **撤销**：加载旧文档后新建一个立方体再撤销，对象列表回到"只有旧文档"（含拓扑行），落库草稿也回到刷新前那一份。
- **变异检查**：把 `cube-far` 的期望原点改成 15 → 用例当场红（Expected 15 / Received 14）。
- **顺带查实第二处真缺陷（已记档、未修）**：**页面加载恢复草稿后，用户的第一次改动不会写进草稿**。实测：刷新后加一个立方体 → 对象列表出现「立方体 1」，而 `mathcanvas:draft:geometry3d` 仍是 84 个 id；再加第二个 → 草稿一次跳到 140（两次一起补上）。机制：`useDraftPersistence.ts` 的 `skipNextDraftSaveRef`（本意"刚恢复的内容不要立刻回写"）被**用户那次改动**吃掉，而不是被恢复自身那次变化吃掉。后果：刷新后只改一次就关页面，那次改动从草稿里丢失。用例没有把这条有缺陷的通道当观测口径，缺陷另见 `docs/current-status.md` 的如实缺口。
- **Task 8 第 2 项的门禁本轮补齐**（当次复跑）：`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test -- --maxWorkers=3` **265 文件 / 3055 项通过 + 1 todo / 0 失败**（202 s）、`npm --workspace @draw/web run build` exit 0（入口 1 694.22 kB，与既有读数一致 —— 本批只改 e2e）。
- **仍未做**：全量 `npm run test:e2e`（只跑了本文件 7 项）；完整 `npm run build`（含桌面 Rust 打包）；教师/学生走查；`docs/feature-catalog.md` 的"已完成 / 未完成"收口。

## 2026-09-29 —— Task 8 第二批：圆锥截面与空间直线和平面的关系

Task 8 第二批落两类样题（六类累计五类）：**圆锥截面**与**空间直线与平面的关系**。判据全部取"算得出来的数"。

- **圆锥截面**按解析读数核对（`conicMetrics.ts`）：默认圆锥 `tanα = 1.5/3`，剖切面法向与锥轴夹角 θ ⇒ `e = sinθ / cosα`。水平切（默认刀口 z = 1.5）半径由 `r(z) = 1.5·(1 − z/3)` 算出 = 0.750、离心率 0、面积给闭式 `πr²` 且与半径自洽；绕 Y 转 60°（β = 30° > α）⇒ 椭圆，e ≈ 0.968；再转 15°（β = 15° < α）⇒ **双曲线**，e ≈ 1.080 —— 圆柱永远切不出这个结论，所以它是锥特有的判据。
- **变异检查**：把锥半径写成 2.0，期望半径算成 1.000，而应用报 **0.750** —— 断言非空，并反证默认刀口在 z = 1.5。
- 一步撤销：旋转走 `rotateSectionPlane`（**文档编辑**），退一步从双曲线回到椭圆，而不是把截面整块删掉。
- **空间直线与平面的关系**由**平面方程**判定：`plane3` 并不存法向，所以法向与常数在测试里由三点叉积独立算出。面内直线满足 `n·d ≈ 0` 且 `n·P + c ≈ 0`；平行不共面的那条 `n·d ≈ 0` 但偏移 = 3。两条线一起断言，才能把这两种关系区分开。产品自身的读数也测到了：点 F 到平面 z=0 的「距离」= **3.000u**，对象列表里该测量 `data-status=valid`。
- **顺带查实一处真缺陷（已记入 `docs/current-status.md` 的如实缺口，本批只记档不修）**：`spatialTools.measurementOptionsFor` 只要"1 个空间点 + 1 个空间平面"就提供「距离」，但内核 `evaluateMeasurement3` 的 distance 分支要求 `sourceIds[0]` 是点、`[1]` 是平面（`pointFromPrimitive` 对 `plane3` 返回 null）。**平面选在前**时按钮照样出现，却只得到一条 `invalid` 读数、画布不出数字。用例按可用顺序断言，没有把错误行为当正确行为钉住。
- 本批读数：该文件 **6/6 通过**（`e2e/high-school-geometry-tasks.spec.ts`）；`tsc -p e2e/tsconfig.json` exit 0；`eslint` 该文件 exit 0；全仓 lint **0 error / 13 warning**（基线未变）。**单测未复跑**：`vitest.config.ts` 的 `include` 不含 `e2e/`，本批只改 e2e 文件、不涉及产品代码。
- **未做**：第六类「已有文档恢复与撤销」；全量 `npm run test:e2e`；教师/学生走查；桌面打包。

## 2026-09-29 —— Task 8 第一批：四类立体样题的精确几何验收

Task 8（六类代表题整合验收）**分批落地**，本批先落四类：三棱锥、四棱锥、斜三棱柱、异长长方体。新增 `e2e/high-school-geometry-tasks.spec.ts`，每题断言类型与名称、**精确几何**、拓扑依赖、保存与一步撤销；期望值按 `spatialSolidWizardModel` 的口径独立算出，不照抄界面读数。

- 几何判据举例：三棱锥顶点 `(3,0,±5)`、四棱锥顶点 `(3,0.5,±5)`、斜三棱柱每个底点 `+(1,-2,5)`；保存断言走页面自己的「保存 .mgeo」下载产物，再重新打开核对顶点集合**逐点一致**。高度取绝对值：底面法向朝上/朝下由 `planeThroughPoints` 的定向决定，两种都是同一个棱锥，不算数学判据。
- **变异检查（证明断言非空）**：把顶点 x 的期望值改成 4，用例当场红（Expected 4 / Received 3）。
- 记下一处真实的结构差异：模板实体（立方体）的展开按钮是「展开 X **拓扑** 的子对象」，多面体实体（棱柱/棱锥）是「展开 X 的子对象」；用例按实际结构断言，并把差异写进注释。
- 本批复跑读数：全库单测 **265 文件 / 3055 项通过 + 1 todo / 0 失败**（236 s）、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（基线未变）、本文件 4/4 通过、e2e 的 `tsc -p e2e/tsconfig.json` exit 0（Web 构建由 e2e 的 `globalSetup` 现场执行）。
- **未做（不得读成六题验收完成）**：圆锥截面、空间直线与平面的关系、已有文档恢复与撤销三类样题；全量 `npm run test:e2e`；教师/学生走查；桌面打包。

## 2026-09-29 —— 高中数学立体绘图交互（功能分支，尚未发布）

- 立体工作区增加按步骤在画布放点并创建空间线段/直线/射线/平面/面的流程；新增 XY/XZ/YZ/已选面工作平面、暂态预览、取消与一步撤销，保留原有先选点后建图元的高级入口。
- 「常用立体」面板新增正方体、长方体、三/四棱柱（含倾斜）、三/四棱锥参数输入与**未保存**预览；确认后整族图元一次写入文档。原「添加立方体」新建默认边长更正为 `4×4×4`，旧 `.mgeo` 对象不改尺寸。
- 空间直线、线段、射线、棱的「教学线型」可保存实线/虚线/点线；Three.js 线材质使用线距离；教师手动线型独立于仅影响视图的「隐藏边」开关。修正两条仍按旧 `4×4×2` 断言截面与体内点范围的单测。
- 本批功能在 `feat/high-school-geometry-interaction` 分支，**不等同已发布的 v3.0 安装包**；通过全库单测 265 文件/3055 项（1 todo）、类型检查、lint 0 错/13 条既有警告、Web 构建，以及选定 7 个 3D e2e spec 的 44 项。完整 e2e、Rust 测试和新桌面打包本轮未完成。后续任务见 [实施计划](docs/superpowers/plans/2026-09-29-high-school-geometry-interaction-implementation-plan.md)。

## 2026-09-29 —— 发布 v3.0（带 typed tool loop 的桌面版）

版本号从 `0.2.0` 跳到 `3.0.0`（**项目自己的版本策略**，不是 semver 意义上的破坏性变更；tag 用 `v3.0`）。打包器里的版本必须是合法 semver，所以文件与安装包写 `3.0.0`，Release 标签写 `v3.0`。

- 改 `apps/desktop/src-tauri/tauri.conf.json` 与 `Cargo.toml` 的 version 为 `3.0.0`（`Cargo.lock` 由 cargo 自动跟进）。
- 重新打包，产出：免安装 `mathcanvas-desktop.exe`（16.38 MB）、NSIS `MathCanvas_3.0.0_x64-setup.exe`（4.79 MB）、MSI `MathCanvas_3.0.0_x64_en-US.msi`（6.52 MB）。**exe 内嵌版本经 Windows 文件属性核实为 `3.0.0`**。
- 发布说明见 [`docs/release/v3.0.md`](docs/release/v3.0.md)（含三个产物的 SHA-256、实测读数、以及**六条如实缺口**）。
- **如实**：两个安装包只验证了**构建成功**，没有在本机实际安装过；免安装 exe 在本机启动、渲染，并跑过真实 provider 链路。

## 2026-09-29 —— 第四十七批：Agent typed tool loop 六阶段收口（含真实 provider 实跑）

计划的六项未完成项逐项落地或**书面暂缓**，没有一项是静默缺失的。详细过程与逐条证据见 [`docs/research/2026-09-28-agent-tool-loop-progress.md`](docs/research/2026-09-28-agent-tool-loop-progress.md)，放行判据见 [`docs/acceptance/agent-release-gate.md`](docs/acceptance/agent-release-gate.md)。

- **Phase 1（阶段门槛达成）**：字段形状的真源从 `actionSchemas.ts` 的私有集合搬进 `actionRegistry`（`FIELD_KINDS` + 逐动作**必填**的 `rawFieldTypes`，拿到编译期保证）；`DISPATCHABLE_TOOL_IDS` 不再手抄，改为从 `readToolSchemas.toolInputs` **推导**。"工具目录 = schema = dispatcher" 两个方向都有测试守住。
- **Phase 2（判据完成，剩余按决策暂缓）**：多轮循环的额度判据抽成纯函数 `toolLoop.ts`；`draft.verify` 契约落地（结论取自 `verificationGate`，模型不能自选验证对象）。**模型面草稿工具按决策暂缓**，见 [`docs/decisions/2026-09-29-agent-phase2-draft-tools.md`](docs/decisions/2026-09-29-agent-phase2-draft-tools.md)：模型看不见草稿，现在启用会变成**盲验**。
- **Phase 3（完成且在生产中生效）**：完整判据链 —— `deriveAcceptance`（用户原话 → 验收条件）→ `taskAcceptance`（条件 → 报告）→ `verificationGate`（报告算不算证据）→ **协调器在 `validating` 之后拦截**。报告不构成证据时进不了确认面板。判题器新增截面/关系判据，**8 条代表任务里 7 条可判定**。
- **Phase 4（本地判据可判定）**：纯本地布局诊断（`renderEvidence.ts` + `layoutModel.ts`，不需 provider vision），`visual-fit-drawn` 靠它通过；标签叠加这半条接到真实投影。live 截图路径未接线。
- **Phase 5（已决策）**：Agent Worker 入口**明确禁用**（`AGENT_WORKER_READY` 从 `true` 改为 `false`——它原本与"只会回 `agent.unavailable`"自相矛盾），见 [`docs/decisions/2026-09-28-agent-worker-strategy.md`](docs/decisions/2026-09-28-agent-worker-strategy.md)。
- **Phase 6（除真实读数外完成）**：新增 `npm run eval:agent`；运行账本记录四个版本号与结构化工具痕迹（**痕迹也落库**，两个摘要走同一把脱敏尺子）；发布门禁文档 + 机器判据 + CI 接线。**离线 pass@1 = 4/8**（模式 `deterministic_local`，**不是模型准确率**）。
- **Review 修复（两处严重缺陷）**：`modelPlanner` 的只读工具批次改为**一趟判完、再原子执行**。修复前：①与只读调用同批到达的合法计划被**静默丢弃**（实测第一轮的计划无声消失、最终采用第二轮重发的）；②批次非原子（9 调的批次在执行 **4 个之后**才抛错，模型付了钱看不到结果）。现在任一调用不是已发布的只读工具即**整批显式拒绝、0 执行**，且所有判据都在第一个 `await` 之前跑完。
- **真实 provider 实跑（2026-09-29）**：用项目自己的 planner（真实提示词、动作登记表、原生工具通道），只把传输换成直连 DeepSeek（`deepseek-chat`，`tools` 能力已验证），喂一道椭圆题："中心在原点、焦点在 x 轴、过 P(2,1)、离心率 √2/2，求标准方程"。**模型自己推出 `x²/6+y²/3=1` 并给出两个动作**（建椭圆 + 标点 P），2.3 秒一轮完成；传输日志 `tools=5` 正是模型面那 5 个工具。**如实缺口**：单题不构成 pass@1；场景未接，多轮观察循环未被压到；`deriveAcceptance` 对圆锥曲线返回空（形状表里没有椭圆/抛物线/双曲线），所以这次运行的完成门禁仍是惰性的。
- **门禁**：`npm run typecheck` exit 0；`npx vitest run` **257 文件 / 3010 用例 + 1 todo / 0 失败**；`npm run test:rust` **242 例 + 3 ignored / 0 失败**；`npm run lint` 0 error / 13 warning（基线）。

## 2026-09-26 —— 第四十六批：修两处**现场故障**（"把正方体沿对角面剖开，标出截面"连挂两次）

这不是重构，是用户在**装好的桌面版里**连着碰到的两次失败。两处都在"Agent 说的话编译器没接住"，症状却完全不同 —— 一次报"找不到对象"，一次报"截面平面非法"。分开记。

### 故障一：同一份计划里刚建出来的对象，后一步引用不到（`target_not_found: no object cube`）

用户那句话，规划器给的是三步：建正方体 → 建截面 → 标出截面。后两步把前一步刚建的对象写成了**场景引用 / 裸名字**（`cube`、`diagSection`），而别名表只认 `{scope:"draft", alias:"cube"}` 那种显式草稿引用 —— 整轮死在 `compile_failed: target_not_found … no object cube`，第 2、3 步接着报 `no object diagSection`（级联，两个诊断其实是一个原因）。

判据本身没有歧义：**别名表里只有"这一份计划里、这一步之前"已经建出来的对象**，命中就是那个刚建的对象，不可能是别的。所以 `planCompiler.resolveReferences` 的两条分支（裸字符串 / 场景作用域）都改成：先按别名查，查不到再报 `target_not_found`。宽容是有边界的 ——

- **编造的 id 依旧被拒**（`section("nowhere")` 仍报 `target_not_found`）；
- **形状错误的引用仍在传输层就被拒**：`sourceId` 收的是裸 id 字符串，喂 `{documentId, entityId}` 这种对象形状报 `invalid_type`、路径落在 `envelope.actions[1].inputs.sourceId`，而不是拖到引用解析时变成一句"找不到对象"（两种失败的性质完全两样，混起来排障会走错方向）。

三条都钉进了 `planCompiler.test.ts`。

### 故障二：登记表承诺的"过三个点"，这一层根本没实现（`section plane is invalid`）

第一处修完，同一句话在第二批上又挂了，换了一个症状：

```
commit_rejected: action_compile: envelope.actions[1]: operation 0: section plane is invalid
   （随后级联 target_not_found … no object sec1）
```

根因在**两处口径不一致**。`actionRegistry` 里 `section.create` 把 `plane` 登记成可选 + 默认策略 `ask_user`，而那句默认问题**明确承诺了两种写法**："截面用哪个平面？给法向与常数，**或者说明它过哪三个点**。" 可 `actionInputs.parseActionInputs` 里**没有 `section.create` 分支** —— `plane` 走默认分支原样透传，"过三个点"那种写法（也就是"沿对角面剖开"最自然的写法）一路走到**文档校验器**才被拒（`packages/dsl/src/schema.ts` 只认 `{normal, constant}`）。更要命的是它报的是**动作级**路径（`envelope.actions[1]`），于是那条"一次性修复"够不到字段、改不动它 —— 用户看到的就只有一句"编译失败"。

修法：`actionInputs.ts` 补 `section.create` 分支 + `normalizeSectionPlane`，把**三种写法收成一种**（单位法向 + 常数）：

- 规范形 `{normal, constant}`；法向不是单位向量则归一化，**常数同步缩放**（`n·x + c = 0` 两边同除 `|n|`）—— 只归一化法向、常数不动，平面就被换掉了，在立方体上正好表现为"切歪"；
- **过三点** `{points: […3]}`（`throughPoints` 也收）：叉积求法向，常数由第一个点定；
- **点 + 法向** `{point, normal}`（`origin` 也收）；
- 坐标两种写法都收（`{x,y,z}` 与 `[x,y,z]`）—— 模型两种都会写。

失败时**错误路径落在字段上**（`action.inputs.plane` / `…plane.normal`），码是 `invalid_plane` / `degenerate_plane`（三点共线）—— 这样那条一次性修复才够得到它。

同批把 `sourceId` 的判据一并收进这个分支（裸 id 字符串，非字符串报 `invalid_type`）—— 它原先靠默认分支兜着，新分支一写就容易顺手丢掉。

`plane` **缺省仍旧放行**：它登记了 `ask_user`，由审计去问用户（`planCompiler.test.ts` 与 `parameterAudit.test.ts` 都钉着"缺平面 → `questions` 里出现 `envelope.actions[0].inputs.plane`"）。在传输层替用户挑一个平面，等于替他改题。

### 验收

`npm run typecheck` exit 0（含 `e2e/`、`scripts/` 三段）；`npm run lint` **0 error / 13 warning**；`npm test` **238 文件 / 2812 用例**通过 + 1 todo（新增 1 条平面归一化用例）；`npx playwright test` **141 用例全绿**；`npm run build` exit 0（web 产物 + 桌面外壳 `mathcanvas-desktop.exe` 16.34 MB，重建于 12:11）。

**实机复核做到哪一步（如实划界）**：桌面版**已重新构建并启动**（进程 `Responding=True`、窗口标题 `MathCanvas`），确认加载的是这一轮的产物；但**没有**在自动化里驱动真实模型把那句话复现一遍 —— 上面的证据都是**单元层与编译层**的（`schemas.test.ts` 三种平面写法等价 + 共线按字段路径拒绝；`planCompiler.test.ts` 别名回退 + 场景引用形状仍被拒）。**"实机走通"这句话此刻还没有证据**，它留给用户在窗口里确认。这条口径与本仓库其它地方一致：**没有读数的结论不写成结论**。

## 2026-09-25（续）—— 方案 2 第三十一批：Rust `lib.rs` 992→912，代理与密钥两组搬进 `src/commands/`

## 2026-09-25（续）—— 方案 2 第三十二批：Rust `lib.rs` 912→447，四组命令全部搬进 `src/commands/`

## 2026-09-25（续）—— 方案 2 第三十三批：Rust `lib.rs` 447→168 —— 拆分完成

## 2026-09-25（续）—— 方案 2 第三十四批：`agent-core/schemas.ts` 1300→560（切出三块）

## 2026-09-25（续）—— 方案 2 第三十五批：`schemas.ts` 560→180 —— 解析层切开，评审点名的六个文件全部拆完

## 2026-09-25（续）—— 方案 2 第三十六批：`operations.ts` 2670→2430（删除级联与种类判据）

## 2026-09-25（续）—— 方案 2 第三十七批：`operations.ts` 2430→2211（依赖图与绕定点旋转的喂料层）

## 2026-09-25（续）—— 方案 2 第三十八批：`operations.ts` 2211→1961（路径查询 + 解析类图元的重算）

## 2026-09-25（续）—— 方案 2 第三十九批：`operations.ts` 1961→1651（三维变换与可编辑性判据）

## 2026-09-25（续）—— 方案 2 第四十批：`operations.ts` 1651→1505（截面与交的重算）

## 2026-09-25（续）—— 方案 2 第四十一批：`operations.ts` 1505→1310（三维对象怎么解析成几何）

## 2026-09-25（续）—— 方案 2 第四十二批：`operations.ts` 1310→1152（交面 / 交点并入 sectionRecompute）

## 2026-09-25（续）—— 方案 2 第四十三批：`operations.ts` 1152→850（重算主族整块搬走）

## 2026-09-25（续）—— 方案 2 第四十四批：`operations.ts` 850→307 —— 写入口搬走，方案 2 收口

## 2026-09-25（续）—— 第四十五批：`scripts/` 纳入 `tsc`；推送恢复后 CI 四作业全绿

两件事，一件补门禁、一件收交付。

### 1. `scripts/` 纳入类型检查（补上最后一个已知缺口）

此前只有 `apps/web/src`、各 package 与 `e2e/` 被 `tsc` 检查，`scripts/preview-server.test.ts` 一直只被 vitest 转译执行 —— 它的类型错误不会在门禁里现形（几轮前那条 `mkdtemp` 的 ENOENT 就是这么漏到 CI 才发现的）。现在新增：

- `scripts/tsconfig.json`（与 `e2e/tsconfig.json` 同形：`extends` 基础配置 + `include: ["."]`）；
- `scripts/nodeTypes.d.ts`：**只声明脚本真的用到的** node 面（`spawn` / `once` / `mkdir` / `mkdtemp` / `rm` / `writeFile` / `path` / `process` / `__dirname`）；
- 根 `typecheck` 末尾追加 `tsc -p scripts/tsconfig.json`。

**继续刻意不装 `@types/node`**（与 `e2e/nodeTypes.d.ts` 同一条理由）：它一旦进 `node_modules/@types`，所有没写 `types` 的 tsconfig 都会自动全局引入，`setTimeout` 的返回类型从 `number` 变成 `NodeJS.Timeout`，动摇一批好端端的应用代码。实测：补完当场 `tsc -p scripts/tsconfig.json` **exit 0**（最小面刚好覆盖用例所用）。

### 2. 推送恢复，CI 四作业全绿

代理恢复之后 15 个提交一次性推上（`6aa8e95..1cfb322`），CI 在 **`1cfb322` 上四作业全部成功**（`checks` / `build` / `e2e` / `rust`）—— 也就是说：方案 2 的全部拆分（`operations.ts` 2817→307、`schemas.ts` 1300→180、Rust `lib.rs` 992→168、`threeScene.tsx`、`App.tsx`、`PropertiesBar.tsx`）在 CI 上**完整跑过一遍并全绿**。

**验收**：`npm run typecheck` exit 0（现含三段）、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**；CI run #5（`1cfb322`）四作业 success。

切出 `apply.ts`（564 行）：**文档层唯一的写入口** `applyOperation`，连同它自己用的四个 helper（`normalizeForComparison` / `documentChanged` / `requireFinite` / `applyDeletionPlan`）、`OperationResult` 与 `parameterIsReferenced`。

**为什么必须一起搬**：上一轮我试过只搬 `applyOperation`，`tsc` 当场列出四个**值级回头依赖**（那四个 helper 与 `parameterIsReferenced` 还留在 `operations.ts` 里）—— 那就是运行时环。把它们一起搬走，环自然消失。这一轮把"动刀前先查值级回头依赖"补进了流程，于是照单执行、一次过。

**`operations.ts` 最终 307 行**，只剩两样东西：文档层的**创建 / 更新命令**（`createPoint3` / `createLine3` / `createFace3` / `createPolyhedron3` / `patchPoint3`、类型 `DomainOperation` / `Patch` 族、`solidStatusReport`）与**十一个模块的再导出**（包的公开面一行未改）。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 43，按读数清掉 30 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

切出 `recompute.ts`（323 行）：`recomputeDerivedObjects`（"改了一处之后按拓扑序把该跟着变的对象重算一遍"的唯一入口）连同它**内部的两个嵌套函数**（`pickSolution` / `recomputePrimitive`）与 `calculatePlanarMeasurement`。

嵌套是刻意的：它们要闭包持有 `primitiveMap` 与 `parameters`，每算完一个对象就就地更新，好让下游读到刚算出来的上游值。所以搬动**逐行原样、只导出外层那一个** —— 给嵌套函数加 `export` 在语法上非法，这正是前一轮回滚的原因。

## 上一轮中止之后改掉的做法（这一轮因此一次过）

上一轮我在"向上跳过注释行找函数结尾"这条规则上栽了（注释正文也被当成可跳过，边界退到注释内部）。这一轮换成**按大括号配平**从函数名向下找结尾：

1. 先跑一次**只读勘查**：算出 `recomputeDerivedObjects` 的 382..638、`calculatePlanarMeasurement` 的 652..681，并把两端行内容打出来核对；
2. 再一次性搬迁 382..681（含中间那段文档注释），接线、`tsc`、跑包内测试。

前半段一行未改，后半段只补 import（四轮，每轮以 `tsc` 收口）。搬完 lint 从 13 涨到 63，按读数清掉 **50 个多余 import**，回到 13。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

这一批不是"再切一块"，而是**解环**：上一批发现 `recomputePrimitive` 调用 `recomputeIntersectionFace`，而后者留在 `operations.ts` 里 —— 只要 `recomputePrimitive` 还想搬走，就必须先把交面那一族挪到它该在的地方。

于是把 `recomputeIntersectionFace` / `recomputeIntersectionPoint3`（含它们的来源解析与区域认领）以及四个小几何辅助（`dedupePoints3` / `centroidOfPoints` / `extentOf` / `distanceBetween` / `dotBetween`）**并入 `sectionRecompute.ts`**（165→**326** 行）。现在 `operations.ts`（**1152** 行）里剩下的只有：文档层的创建 / 更新命令、重算主族（`recomputeDerivedObjects`，内含嵌套的 `pickSolution` / `recomputePrimitive`）、以及 `applyOperation` 那一族。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 25，按读数清掉 12 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

切出 `resolve3d.ts`（217 行）：**绑定点的坐标怎么解**（`resolveBoundPoint` / `resolveBoundPoint3` / `dragBoundPoint`）、**宿主参数怎么取**（`bindingParameterValue` / `bindingTupleValue`）、**截面怎么物化**（`sectionMaterialization`）、**模板拓扑怎么同步**（`syncTemplateTopology`）、**交面 / 交体怎么由来源推出来**（`resolveIntersection`）。

## 一次失败的尝试与它的教训（这一批最值得记的）

我原本想一次把 535..1044 整块搬走（含 `recomputeDerivedObjects` / `recomputePrimitive`），结果编译器给出 `TS1184: Modifiers cannot appear here`：**`pickSolution` 与 `recomputePrimitive` 其实是 `recomputeDerivedObjects` 内部的嵌套函数**（这个文件的风格把嵌套声明也顶格写），我那句"给切片里每个顶层 `function` 加 `export`"的机械改写因此把修饰符加到了嵌套函数上。

更麻烦的是它还会带来**运行时环**：`recomputePrimitive` 调用 `recomputeIntersectionFace`，而后者留在 `operations.ts` 里。

处置：**整批回滚**（`git checkout` + 删掉半成品模块），改搬一个**不含嵌套函数、也不回调 operations 的连续区间**（535..733，纯解析层）。搬完一次 `tsc` 通过。教训很具体：**"整块搬走"之前先确认区间里有没有被嵌套定义的函数，以及被搬走的代码会不会回调留在原处的函数** —— 前者让改写非法，后者让模块成环。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 35，按读数清掉 22 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

切出 `sectionRecompute.ts`（165 行）：**截面与交的重算** —— 截面（含解析边界：源是圆柱 / 圆锥时给出精确的圆锥曲线片段环，写进 `section.exact`）、交线 / 交体、以及交面图元（布尔交集的**一个区域**，按支撑曲面分组后的一块）。两条用户口径随代码搬走：**"我需要的交面只是一个表面，而不是所有相交的表面"**（分组之前圆柱侧面被切成 48 个细条）；**多边形来源不需要解析层**。`solidTopology3` 与那个私有联合类型 `SolidIntersectionOutcome` 跟着一起搬。

**过程**：这一批把"边界探测"的坑踩全了 —— 又是文档注释、又是把上一轮已经搬走的东西第二次插入（`SolidIntersectionOutcome` 出现两次 → 5 条类型错误全是它的连锁反应），最后一律靠"切完立刻 `tsc`"逐个收口。搬完 lint 从 13 涨到 28，按读数清掉 **15 个多余 import**，回到 13。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 1961 行降到 **1651 行**，切出 `transforms.ts`（约 320 行）：平移与旋转怎么落到文档上（`translatePrimitive` / `translatePrimitive3` / `rotatePrimitive3`）、以及"这个对象能不能被拖动 / 绕定点旋转"（`isFreeDraggable3` / `isRotatable3` / `managedPointIds` / `templateTopologyIds` / `EDITABLE_GEOMETRY_TYPES`）。三条口径随代码搬走：模板实体与物化拓扑必须**一起动**；棱柱构造描述可能不再成立时要**改记成显式面环**；旋转的判据是"有自己的一族点"。

`PrimitiveBounds` 这个私有 interface 也跟着 `primitiveBounds` 搬过去（它本来就是那只包围盒的形状）。

**过程**：边界探测又踩了同一种坑（把函数结尾定在下一段的文档注释上），这次直接用"向上跳过注释行再取 `}`"定住；随后补了四轮导入（`CurveRotation` / `SolidConstruction` / `WorldAxis3` / `curveRotationOf` / `rotatePointAboutAxis3` 等），每轮都以 `tsc` 收口。搬完 lint 涨到 30，按读数清掉 **17 个多余 import**，回到 13（基线）。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 2211 行降到 **1961 行**，切出 `analysisRecompute.ts`（272 行）。它装两半：

- **路径查询**：`pathConstraint` / `parameterWindow` / `projectOntoPath` —— 把一条曲线当成"带参数的路径"来问；
- **解析类图元的重算**：导数 / 切线 / 法线 / 割线 / 积分 / 分析集 —— 几何**全部**由来源函数算出来，自己不含独立参数。

两半**必须同一个文件**：解析类图元要按来源函数在自己的域上求值，而那正是路径查询那一层在做的事 —— 分开就会成环。这已经是本次拆分里第三次由**依赖方向**决定归属（前两次是 `primitiveKinds` 与 `curveRotation`）。

**这一批的过程值得记**：边界探测连着踩了两次坑 —— 先是把函数结尾定在了下一段的文档注释上（`block end mismatch: */`），改成"向上跳过注释行再取 `}`"才对；接着因为同一个 import 被两轮接线各写了一遍，`tsc` 报 7 条 `TS2300 Duplicate identifier`，最后按"同类 import 只留第一行"合并掉。**每一步都靠"切完立刻 `tsc`"才没有走远**。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 39，按 lint 读数清掉 26 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 2430 行降到 **2211 行**，切出两块：

- `graph.ts`（200 行）：**依赖图** —— `primitiveDependencies` / `templateRelations` / `getDependencyIndex` / `getAffectedPrimitiveIds` / `topologicalRecomputeOrder`，以及那两条**实测出来**的口径（"实体 → 子对象"这条边曾经不存在，导致绑定点留在原地；截面 / 交面只声明依赖实体，导致按数值改顶点后留下旧截面）；
- `curveRotation.ts`（61 行）：**绕定点旋转的"喂料层"** —— 把文档里的两种定点写法喂给内核的 `placedConic`（"圆心是点图元"的圆明确不参与，两种能力各自独立）。

`curveRotation.ts` 这次是被**编译器逼出来的**：`graph.ts` 需要 `curveRotationPivotId`，而它原本住在 `operations.ts` 里 —— 直接 import 就成环，所以先把这一族挪到两边都能引用的地方。这与上一批 `primitiveKinds` 的成因完全一样：**拆文件的顺序由依赖方向决定，不由行数决定**。

**踩到的两个坑（都记下来）**：

1. PowerShell 变量**大小写不敏感**：我又一次同时用了 `$g`（路径）与 `$G`（内容数组），后者覆盖前者，"写回补丁"静默失败 —— 上一批刚记过同一条，这一批又犯。这也是为什么每次都要**单独验证补丁是否真的落盘**；
2. `ConicPlacement` 属于 `@draw/geometry-kernel` 而不是 `@draw/dsl`（照抄 import 时想当然），`tsc` 当场报出来。

**验收**：`npx tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完先涨到 22，按 lint 读数清掉 9 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 2670 行降到 **2430 行**，切出两块：

- `deletion.ts`（238 行）：**删除的级联判据** —— `cascadeSources` / `deletionPlan` / `deletionTargets` / `unbindDeletedHost` / `topologyReferences` / `expandTopologyCluster` / `layerDescendantIds` / `DeletionPlan`。判据是**派生性**（交点、轨迹、连接完全由来源决定，自己不含独立几何）而不是"有没有人引用"；被引用的普通图元被删时，引用方要改指向或解绑；
- `primitiveKinds.ts`（37 行）：三个纯种类判据（`isPlaceableConic` / `isSourceIdConstruction` / `functionAnalysisSourceId`）。它们被 `deletion` 与 `operations` **两边**用到，放任何一边都会成环 —— 所以单独一个文件。

## 上一轮失败之后换回的做法（值得记下来）

上一轮我用"从函数起始行往后找第一行恰好是 `}`"来自动定边界，切错了括号配平（`tsc` 报 14 条 `TS1128`），整批回滚。这一轮换回**最笨但可靠**的三步：①先把起点/终点那几行**读出来逐行确认**（含注释归属，这个文件里相邻函数的文档注释会互相贴住）；②按行号切片；③**切完立刻 `tsc` + 包内测试**。三段都一次过。

顺带记一个我自己犯的**工具坑**（这轮真踩了）：PowerShell 变量**大小写不敏感**，我同时用 `$d`（路径）与 `$D`（文件内容数组）时后者把前者覆盖了，于是"写回补丁"这一步静默失败。表现是：补丁没写进去，但错误信息看起来像"代码还是错的"。

**验收**：`npx tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过（含 `deletion-cascade` 与 `recomputeConsistency` 两个正对口的用例）、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（基线）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/agent-core/src/schemas.ts` 从 560 行降到 **180 行**（原始 **1300 → 180，−86%**）。这一批切出两块：

- `actionInputs.ts`（305 行）：**逐个动作的 inputs 校验**（那个最大的 switch）；
- `actionAudit.ts`（103 行）：**分类与审计说明**（哪些动作"登记了但还不支持"、每个动作对界面该说什么、修复请求怎么生成）。

`ActionId`（`keyof typeof ACTIONS`）也跟着登记表搬进 `actionRegistry.ts` —— 它是表的键，表在哪儿它就该在哪儿；`schemas.ts` 里只留 `export type { ActionId } from "./actionRegistry"`。

**结果**：评审 md 方案 2 点名的六个文件全部拆分完成（`PropertiesBar` 1069→298、`App.tsx` 2000→809、`threeScene.tsx` 1807→269 + 七个阶段模块、Rust `lib.rs` 992→168、`agent-core/schemas.ts` 1300→180、`operations.ts` 2817→2662 做过一轮）。**公开面照旧一行未改**（靠 `schemas.ts` 里的再导出）。

**这一批的收官复跑（全套门禁，各组单独跑）**：`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（基线）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**、`npm run test:perf` exit 0（`addPrimitives/1000-planar` 4.3ms、`recomputeDerivedObjects/100-solid` 22.2ms、`solidStatusReport/100-solid` 5.5ms、`encodeMgeo/large` 5.0ms、`roundTrip/large-mgeo` 17.7ms、`denseIntersections/200x200` 1.7ms、`drag/300-frames` 702.8ms —— 与归档读数同一区间，**没有回归**）、`npm run test:rust` exit 0（232 例 + 3 ignored）。

`packages/agent-core/src/schemas.ts` 从 1300 行降到 **560 行**，切出三块：

- `schemaReaders.ts`（219 行）：**运行时校验的基础读取层** —— 有限数、有界字符串 / 数组、平面与空间坐标、作用域引用、字段白名单，以及"模型写的名字能不能原样写进诊断"的回显判据；
- `actionRegistry.ts`（436 行）：**动作登记表**（`ActionSpec` / `ACTIONS` / 种类常量 / `FieldPolicy` / `ActionAuditDescription`）；
- `hashing.ts`（145 行）：**确定性 ID 与规范化哈希**（`newRunId` / `newDraftId` / `canonicalContentHash` / `sha256Hex*`）。

## 这次拆分的**真正约束**是依赖方向，不是行数

第一版把回显判据（`isEchoableName`）和它的调用者 `rejectUnknownFields` 一起放进读取层，编译立刻报 `Cannot find name ACTIONS` —— 因为回显判据要读**登记表**。若把表留在 `schemas.ts`，就成了"读取层 → schemas → 读取层"的环。于是这一批真正的工作量落在**登记表先独立出来**：表是纯数据，切出去之后依赖方向变成 `schemas → schemaReaders → actionRegistry`，无环。这条顺序（先认清"谁是数据的真源"）比"哪一块行数多"重要得多。

## 公开面一行未改

`index.ts` 是 `export * from "./schemas"`，所以搬走的东西必须在 `schemas.ts` 里**转出去**：`export { isEchoableName } from "./schemaReaders"`、`export { canonicalContentHash, newDraftId, newRunId, sha256Hex, sha256HexBytes } from "./hashing"`、`export { ACTIONS, type ActionAuditDescription, type FieldPolicy } from "./actionRegistry"`。于是包外调用方（含 `apps/web` 的 Agent 运行时）一行都不用改。

**验收**：`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（回到基线；搬完先涨到 29 条，都是两个文件里多带的 import，按 lint 读数逐条清掉）、`npm test` **238 文件 / 2810 用例通过**、`npx playwright test` **141/141**。

`lib.rs` 从 447 行降到 **168 行**（原始 **992 → 168，−83%**）。这一批搬的是最后一组：`src/commands/providers.rs`（296 行）—— `provider_run` / `provider_cancel` / provider 配置的增删查与健康检查 / `provider_check` / `get_runtime_info`，加上只被它们用的 `ProfileStoreState` 与 `store_error`。

`lib.rs` 现在只剩：模块声明、六个 import、`RepositoryState` / `BlobState` 两个托管状态、`run()`（建托管状态 + 一张命令清单）。

接口税总计（三批累计）：命令加 `pub`；`RepositoryState.repository` / `BlobState.blobs` / `ProfileStoreState.store` 三个字段改成 `pub(crate)`（根模块的 `run()` 仍要构造它们）；`ProxyState` / `ProxyRuntime` 各加一个构造器；根模块导入从"什么都用"瘦到六个。

六组命令模块共约 925 行，`lib.rs` 减掉 824 行 —— 差额约 100 行就是这些模块头、导入与可见性成本，如实记在这里。

**验收**：`cargo check --all-targets` exit 0、`cargo clippy --all-targets` **零警告**、`npm run test:rust` **exit 0**（232 例通过 + 3 ignored，含那两条扫全树的守护性断言）。

`lib.rs` 从 912 行降到 **447 行**（原始 992 → 447，**−55%**）。这一批搬了两组：

- `src/commands/repository.rs`（372 行）：项目仓储 8 条 + 附件与 `.mcanvas` 6 条 + 运行账本 3 条，**合成一个文件**，因为它们碰的是同一份托管状态（SQLite 与附件目录）—— GC 与导入导出要同时问两边，分开只会让那条跨状态的判据难读。两个 base64 辅助函数（只被附件命令用）也一起搬过去；
- `src/commands/conversations.rs`（120 行）：「多会话」八条命令。

接口税与前一批同形：命令加 `pub`，`RepositoryState.repository` / `BlobState.blobs` 改成 `pub(crate)`（根模块里剩下的 provider 命令仍要读它们），`lib.rs` 侧不再需要 `CommitReceipt` / `CommitRequest` / `DocumentSnapshot` 三个导入。

**这一批只改了注释与 import 两处就通过**：`cargo check --all-targets` exit 0、`cargo clippy --all-targets` 零警告、`npm run test:rust` **exit 0**（232 例通过 + 3 ignored，含那两条守护性断言）。原因是上一批已经把可见性口径与守护断言的扫描范围都定下来了 —— **先搬小组合、把接口摸清，再搬大块**，这是这一批一次过的直接原因。

`apps/desktop/src-tauri/src/lib.rs` 从 992 行降到 **912 行**：

- `src/commands/mod.rs`（模块头，13 行）、`src/commands/proxy.rs`（`ProxyState` / `ProxyRuntime` + `proxy_session` / `proxy_cancel`，81 行）、`src/commands/secrets.rs`（`SecretStoreState` + 三个密钥命令，40 行）；
- 命令**逐行搬**，只加了可见性（`pub fn`、`pub(crate) session`）与两个构造器（`ProxyState::new` / `ProxyRuntime::new`）—— 那是 Rust 侧的"接口税"：字段私有 + 结构体在别的文件里，就必须有一个能构造它的入口；
- 读数是**逐条编译出来的**：先 `cargo check --all-targets` 把 10 条 `E0425`/`E0599`/`E0616` 一次列清（缺 `SecretStore` trait 导入、`lib.rs` 里剩下的 provider 命令仍在用 `ProxyState`/`SecretStoreState`、私有字段被根模块访问），修完 `cargo clippy --all-targets` 零警告。

## 拆这个文件的**真正障碍**：一份守护性断言把它钉住了

`tests/shell_smoke.rs` 原来要求**所有**命令都写在 `src/lib.rs`：它按 `lib.rs` 的文本数 `#[tauri::command]` 的条数（"不多不少"），并逐条在 `lib.rs` 里找 `fn <名字>(`。所以这个文件不是"没人拆"，而是**拆了必红**。这一批把那份断言的口径从"扫 lib.rs"改成"扫整棵树"（`src/lib.rs` + `src/commands/*.rs`）：**意图没变、覆盖面更大** —— 它守的仍是"只暴露具名命令、没有泛型命令、没有通用 shell / 文件读写出口"，登记清单也仍逐字写在测试里（比对时只取路径的最后一段，于是命令换文件不影响那份清单）。

顺带记一条**没能复现的现象**：改完注释空行后第一次 `npm run test:rust` 退出码 101（输出被丢弃，没留下现场），随后连跑三次都是 0。如实记在这里，不当作已解释。
## 2026-09-25 —— CI 的首次运行：三红一绿，三个红都是"门禁自己不自足"

推上去之后 CI 跑起来了（run #1，commit `96ff89f`）。四个作业里 **`e2e` 绿**（42 spec / 141 用例，含它自己重建 + preview），另外三个红。三条原因都不是产品代码的问题，而是**门禁默认了"本机恰好有的东西"**：

1. **`checks`** 红在 `scripts/preview-server.test.ts`（`Test timed out in 5000ms`）。它先等 `http://127.0.0.1:4173/` 返回 200，而那要求 `build-check/mathcanvas-current` 里有一份构建 —— **本机一直有**（跑过构建），CI 上没有（构建是另一个作业）。`vite preview` 对着空目录照样起得来，只是每个请求都 404，于是轮询一直到 vitest 的 5 秒超时。修法：这条用例测的是"服务器收到 SIGTERM 会不会退出"，与产物内容无关，所以**它自己造一份最小产物 + 自己选端口**（`PREVIEW_OUT_DIR` / `PREVIEW_PORT` 两道环境变量缝，默认值不变、e2e 那条路不受影响）；同时给用例自己的 30 秒超时，让失败信息落在"服务器没就绪"而不是 vitest 的超时上；`preview-server.mjs` 在产物缺失时**明确警告**（这类"起来了但都 404"的现象以前没有任何提示）。**复现方式**：把真实产物挪走再跑 —— 旧写法必红，新写法 384ms 绿。
2. **`build`** 红在根目录的 `npm run build`（= `--workspaces`）：它连带去跑 `apps/desktop` 的 `build`，而那个脚本是 `tauri build --no-bundle`，需要 WebKitGTK 之类的系统依赖（只有 `rust` 作业装了）。修法：这个作业**只构建 web 工作区** —— 与它自己注释里"Windows Tauri 打包刻意不进 CI"一致。
3. **`rust`** 红在 `shell_smoke` 的 `the_web_entry_the_shell_loads_exists_and_is_the_web_build`：它断言外壳加载的那份 web 产物**真的在**（`build-check/mathcanvas-current/index.html`，失败信息里就写着该跑哪条命令），而 `cargo test` **不会**执行 `tauri.conf.json` 的 `beforeBuildCommand`（那是 `tauri build` 的事）。修法：作业里先 `npm run build --workspace @draw/web` 再跑 `npm run test:rust`。

**同批补上的读数**：`npm run test:rust` 本机复跑 **232 例通过 + 3 ignored / 0 失败**（此前几个阶段一直标注"未复跑"）。**顺带记下的缺口**：`scripts/` 下的测试还没纳入 `tsc`（与 `e2e/` 当初一样），本阶段没做。

### 第二、三次运行：又两处"本机绿、Linux 红"，以及一条排查能力

`26763e7`（run #2）之后 **`build` 转绿**，`checks` 与 `rust` 仍红。按 **check 注解**逐条定位（注解是公开可读的，而 cargo/vitest 的日志下载要仓库管理员权限）：

4. **`checks`**：上一版修法自己在 CI 上红了 —— `mkdtemp` 报 `ENOENT`，因为干净检出里**没有** `build-check/`（被 `.gitignore` 忽略），而 `mkdtemp` 不会替你建父目录（本机有那个目录，所以本机看不出来）。修法：先 `mkdir(parent, { recursive: true })`。
5. **`rust`**：`runtime.rs` 的 `never_leaks_a_filesystem_path_beyond_the_data_root_directory_name` 用 `Path::new(r"C:\Users\...\AppData\Roaming\com.mathcanvas.app")` 造输入 —— **反斜杠在 Linux 上不是分隔符**，那边整串只有一段，`file_name()` 返回整串，于是"只留最后一段目录名"这条断言在 Linux 上必红（cargo 退出 101）。修法：改成 `Path::new("C:").join("Users").join(...)`，两边各按自己的分隔符分段，测的还是同一件事。

**顺带加的一条排查能力**：cargo 的失败只写在日志里，而日志要管理员权限 —— "哪条用例红了"在注解里看不到（第 5 条是靠读代码定位的）。所以 `rust` 作业在失败时把 `panicked at` 那几行抬成 `::error` 注解（注解公开可读），下次不必再猜。

**结果**：run #3 / `f10ee8e` —— `checks` / `build` / `e2e` / `rust` **四个作业全绿**。

## 2026-09-24 —— 按《MathCanvas 项目梳理与优化建议》逐方案落地

一条主线：**把"同一件事在两处各写一遍"这类结构性缺陷收掉**，并把评审点名的性能与工程问题按读数处理。逐方案结果：

**方案 1（P0）统一实体构造与拓扑物化**
模板实体在文档里本是**两件东西**（用户编辑的参数化图元 + 由它物化出来的一族拓扑），手工按钮落两件、`solid.create_template` 只落一件 —— 于是"用 Agent 建的立方体，旋转角不起作用"。修法是动作层加**唯一入口** `compileTemplateSolid`（刻意不传自定义 `BuilderContext`，与 `syncTemplateTopology` 的默认命名逐字一致），手工按钮改调同一入口。验收：手工与 Agent 同参数创建四类模板产出**逐字节相同**的文档。

**方案 2（P1）拆分过大的编排与领域文件**（进行中，已开三十批）
`operations.ts` 2817→2662（`solidGeometry.ts`）、`PropertiesBar.tsx` 1069→**298**（`inspectorFields.tsx` 字段控件 / `inspectorLabels.ts` 名字与归属 / `inspectorReadings.tsx` 派生读数组件 / `inspectorModel.ts` **检查器模型**：面板从此只负责画）、`App.tsx` 2000→**809**（`persistence/fileExports.ts`、`documentIds.ts`、`creationCommands.ts` 九条创建命令、`solidCommands.ts` 七条截面与宿主绑定命令、`recordCommands.ts` 五条记录命令、`structureCommands.ts` 三条结构命令、`anchorRotationCommands.ts` 两条定点旋转命令、`point3ToolCommands.ts` 六条三维工具命令、`previewCommands.ts` 两条预览创建命令、`selectionCommands.ts` 七条选择命令、`canvasStatusPrompt.ts` 状态栏推导、`draftingCommands.ts` 2D 创建流程、`appViewState.ts` **派生视图状态**：选中了谁 / 能不能建某类对象 / 活动图层能不能画 / 标注与定点旋转的入参够不够，23 个字段的纯计算、`useDraftPersistence.ts` **启动恢复与自动保存**：两个 effect + 它们之间的时序守卫 + "换一世"的 `reset` 入口、`commandDispatch.ts` **命令分发**：CAD 与功能区两张 switch 表 + 换 CAD 模式、`useKeyboardShortcuts.ts` **键盘快捷键**：Esc 分级 / Delete / 撤销重做）、`threeScene.tsx` 1807→**269**（那个 1445 行的挂载期效应整块搬进 `threeSceneEffect.ts`，随后按阶段切出**七块**：`threeSceneCamera`（相机取景）/ `threeScenePreviewHover`（预览悬停）/ `threeSceneRender`（一帧绘制 + 两层标签 + 容差档位与手柄缩放）/ `threeSceneGrid`（网格与坐标轴落位）/ `threeSceneInteraction`（指针按下·移动·抬起、拖拽会话、拾取判定）/ `threeSceneContent`（**内容同步**：`contentRecords` + `keepContent` 增量重建 + 整场 `syncContent` + `refreshPrimitiveObject`）/ `threeSceneDragVisuals`（**拖动期间的画面**：半径预览 / 手柄落位 / 场景重建后补画），效应本体 1445→**489** 行。七块合计 **1696** 行 —— 切出去的是 956 行，其余 **740** 行是各块的 `deps` 接口、工厂签名与头注释，这笔"接口税"如实记在这里。切成工厂的**直接收益**当场兑现：`threeSceneContent` 过去整块住在效应里、只能靠整页 e2e 从外面看，现在能喂一份文档进去问它"你到底重建了什么" —— 新增 6 条用例钉住重建粒度（沿用不换实例、只重建改动的那一个、删图元时记录回到 3 条静态对象、就地重建画在 `points` 表的坐标上、就地重建后整场同步不产生第二个对象）。`appViewState` 同理：那批派生状态过去只有**渲染整棵 App** 才能验，现在喂一份文档就能问 —— 新增 8 条用例钉住"空选中不算全锁定 / 全可见"、截面只认模板实体、交点只认 `@draw/dsl` 那张可采样表、空间工具"只认空间点"、线性与角标注各自独立计数（1 点 + 1 棱 → 线性可用而角不可用）、定点旋转要"一个点 + 一条未锁定的封闭曲线"、活动图层被隐藏 / 锁定时的那句提示。写这批用例时当场纠正了我自己的一个错判：混着选 1 点 + 1 棱时线性标注**是可用**的（那条棱自己就够），我原先以为两种入口都该关着。`useDraftPersistence` 是第三种收益：它那两条时序守卫本来**只能靠整页 e2e 间接证明**（一条是探针抓出来的、一条是 e2e 抓出来的），搬成 hook 时留了一道能控制 `restore()` 何时返回的缝，于是新增 9 条用例直接钉住它们 —— 恢复在途时一个字都不写、恢复自己带来的那次变化只跳过一次、用户先动手就不覆盖、切走工作区就不覆盖、网页版退回草稿、仓储本该可用却失败要如实说且照样放行自动保存、`not_a_desktop_shell` 不弹提示、保存失败只报一次，以及"换一世"那个入口。`commandDispatch` 是同一件事的第三次兑现：两张 switch 表过去与二十来个闭包 handler 挤在一起、只能点界面验，现在 12 条用例喂替身 handler 问"这一步该谁做、谁必须没被调到"（图层挡住时只提示不创建、`inspect-diagnostics` 必须拿到更新函数而不是布尔值、CAD 工作区里功能区命令整条转给 CAD 表 —— 连"只在功能区表里的 `create-cube` 在 CAD 工作区什么都不会发生"这条看着像 bug 的当前口径也钉住了）。搬键盘处理时**顺手修掉两处搬之前就存在的依赖问题**：①依赖数组里有 `document` 与 `apply`，函数体一个都没读 —— 后果不是"多订阅一次"：`document` 每次编辑都换身份，等于**每提交一笔操作就把键盘监听摘下来再挂回去**；②`deleteSelected` 漏写，而函数体真的调它（基线那条 lint 警告就是它），漏掉意味着"某次改动之后 Delete 走的还是旧的闭包"。修完基线 14 → **13** 条警告。9 条新用例直接往 `window` 发按键：撤销/重做按平台修饰键、输入框里 Ctrl+Z 不许撤销整篇文档、`Alt+Ctrl+Z` 不算快捷键、Esc 分级（先取消创建、再关指引、最后才清选择）、Delete/Backspace `preventDefault`、输入框里 Delete 不删对象、卸载后监听摘掉。切法是"**依赖对象 + 原文搬**"：跨阶段的可变值先变成**稳定容器**（`copy` / `clear` / 就地 push），搬动的行一行不改；每一步都以 `geometry3d-*` 那组 e2e 验收）。切的过程中又抓到第三条**顺序坑**：内容同步要用渲染工厂交出的 `syncPointHandleScales` 先把点手柄按屏幕尺寸缩放、再算内容包围盒与面片尺寸（否则同一份内容算出偏小的包围盒，实测 7.02 vs 7.11），所以内容工厂只能排在渲染工厂**之后** —— 这与"初始 `syncContent()` 必须排在工厂调用之后"其实是同一条约束的两端）。
`inspectorModel` 的接口刻意只写**三项**（选中的图元、选中的 id、一个更新回调），而不是整个 `PropertiesBarProps`（三十多个字段里绝大多数只被 JSX 透传）—— 于是这段逻辑第一次能**脱离整棵面板**直接测（新增 7 条用例：类型收窄、只对带斜率参数的直线显示该字段、锁定对象拒绝编辑、空选中不产出读数、标签回退到 id）。
口径：搬移一律**逐行原样搬**，并核对"新位置每一行都能在旧位置的删除行里找到"（`PropertiesBar` 搬走的 326 行、`structureCommands` 的 37 行、`anchorRotationCommands` 的 45 行、`point3ToolCommands` 的 65 行、`previewCommands` 的 85 行、`selectionCommands` 的 33 行、`draftingCommands` 的 74 行全部可追溯（`canvasStatusPrompt` 的 40 行里有 **1 行刻意改写**：`hoveredPreview !== null` 换成入参 `hovering`；`draftingCommands` 另有 4 行是把 `CreationStep` 这个一行类型别名**改写成等价的 interface**，字段没变；`threeSceneContent` 的 494 行里有 **1 行只动了换行**（旧位置把一句属于 `syncCounts` 的说明粘在了 `contentRecords` 那一行行尾，搬过去时放回它该在的那一行），`appViewState` 的 43 行里也有 **1 行只动了换行**（`cadAnnotationSources` 的箭头函数体被挤在同一行 —— 旧文件里的排版残留，拆开）；`useDraftPersistence` 是两个 effect：里面 **7 处 `useSceneStore.getState()` 换成了入参 `readLive()`**（守卫必须读"当前值"而不是 effect 闭包里的 `document`，这正是当初那三条用例失败的原因），另 **1 处**给持久化适配器留了注入缝（`persistence ?? createDocumentPersistence({`），其余逐行未改；两个依赖数组补上了 `setFileError`（它是 `useState` setter、身份稳定，但作为 hook 入参必须写进依赖，否则 lint 会如实报出来））；对不上的只有新写的签名 / 参数解构 / 返回值，以及 `anchorRotationCommands` 里**一处刻意**的改写：原来直接写 App 的 `pendingSelectionRef`，现在走依赖里的 `setPendingSelection` 回调）；组件与纯值分文件是 `react-refresh` 的硬要求（混在一起整块面板会丢热更新状态）。上面这批新模块各自补了用例（`creationCommands` 7、`solidCommands` 6、`recordCommands` 5、`structureCommands` 7、`anchorRotationCommands` 5、`point3ToolCommands` 6、`previewCommands` 7、`selectionCommands` 8、`canvasStatusPrompt` 8、`draftingCommands` 8、`inspectorModel` 7），把"该是空操作时空操作"（选中不是曲线的对象、动点没绑轨道、自由点没有宿主参数、没有选中就没有标注、来源不够不落盘、**锁定对象拒绝编辑**）、"删除走**与 Agent 同一份**动作编译器且整批一步撤销"、"切线定位写成对点的引用而不是坐标快照"、"标注锚点是对图元的引用"、"**空间点按格点摆放，前三点不共线**"、"圆轨道三点共线时如实拒绝、建完即与那些点脱钩"、"**线圆交点把线与圆的顺序摆正**（字段名有方向）"、"框选左→右只选完全包含、曲线两个方向都只按包含判"、"**加选是切换**（再点一次取消）、点选会清掉创建步骤"、"手工建实体时拓扑与参数化图元同一次落盘"这几条不变式钉住 —— 它们都是搬动中最容易悄悄走样的一类行为。

**方案 3（P1）接入几何 Worker** —— 已完成
实测依据：大文档上 `compilePlan` 要 **73 ms**，而过线程边界的复制只要 **1.0 ms**（**76 倍**）。落地为 `geometryWorkerClient`（按 `requestId` 配对、核信封、超时、丢弃过期响应）+ `geometryCompileStrategy`（两条路并排 + 等价性证据）+ `geometryWorkerHost`（**每页一份**的懒建单例、`pagehide` 终止、起不来时**如实降级**）。
接线过程中抓到两处"会静默变差"的地方并修掉：客户端此前**丢弃失败产物**（`repair`/`planDiagnostics`/`assumptions`/`questions` 到了主线程门口又被扔掉）；兜底路自己抄了一份"就地编译"却**漏传用户原话**，导致同一份计划在两条路上编出不同结果。

**方案 4（P2）工作区级代码分包** —— 入口单 chunk 2 066.63 kB → 约 1 636 kB（−21%），导出器另成 `engineeringExporters` 按需 chunk。

**方案 5（P2）正式 CI 门禁** —— `.github/workflows/ci.yml` 四个作业按成本分层（`checks` = typecheck + lint + Vitest + 性能趋势、`build`、`e2e`、`rust`）。
本轮补上：**e2e 也过类型检查**（此前 42 个 spec 只被 Playwright 转译、从不被 `tsc` 检查；补上后当场查出 23 个类型错误）。

**方案 6（P2）文档与过期注释收口** —— `docs/current-status.md`（现在时）与 `docs/project-progress.md`（归档）分开，归档头已降级说明；本文即评审点名的"版本变更记录"。

**方案 7（持续）大型场景性能基准** —— 八条 node 场景（1000 图元编辑、100 实体重算、密集两两相交、依赖 DAG 局部重算、连续拖动 300 帧、较大 `.mgeo` 存取等）+ 浏览器里的**主线程响应性**读数。
`longtask` API 在本机不可用（声称支持、连一次故意阻塞 200 ms 都不报，已用空白页探针证实），改用**帧间隔**并带量具标定断言。

**同批修掉的既有问题**（都不是新功能，是"早该如此"）：
- 确认面板的对象计数在方案 1 之后按新口径（一个立方体 28 个对象），两条还停在旧口径的 e2e 用例被改正 —— 而 `e2e` 是 CI 必修作业，等于 CI 此前一直是红的；
- 几何 Worker 的契约缺 `completionAssumptions` / `repair` / `planDiagnostics` / `assumptions` / `questions`，缺任何一项都会在接线后**静默降级**（确认面板变空、可修的计划变得不可修、该问用户的被报成"编译失败"）。

**门禁读数**（本机实测，明细见 `docs/current-status.md`）：`npm test` 238 文件 / 2810 用例通过 + 1 todo；`npm run typecheck` 6 workspace + e2e 全 exit 0；`npm run lint` 0 error / **13** warning（基线从 14 降 1 —— 见下"顺手修掉的两处依赖问题"）；`npx playwright test` 42 spec / 141 用例全绿。（**读读数要看每一条自己的 exit code**：把几条门禁串在一条命令里跑时，整条命令的退出码来自**最后一条**，前面某一条失败会被吞掉 —— 本阶段就因此漏看过一次 `tsc` 的失败，后来改成逐条取 `$LASTEXITCODE`。）

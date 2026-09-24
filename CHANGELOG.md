# 变更记录

> **这份文件记"改了什么"，不记"现在什么样"，也不记"当时怎么想的"。**
> - **当前状态**（门禁读数、做到哪一步、还差什么）看 [`docs/current-status.md`](docs/current-status.md) —— 那是"现在时"的**唯一**一处；
> - **过程与证据**（每一轮的 RED→GREEN、被推翻的判断、实测读数、误报清单）看 [`docs/project-progress.md`](docs/project-progress.md) —— 那是**归档**；
> - **架构与能力清单**看 [`docs/feature-catalog.md`](docs/feature-catalog.md)。

## 2026-09-24 —— 按《MathCanvas 项目梳理与优化建议》逐方案落地

一条主线：**把"同一件事在两处各写一遍"这类结构性缺陷收掉**，并把评审点名的性能与工程问题按读数处理。逐方案结果：

**方案 1（P0）统一实体构造与拓扑物化**
模板实体在文档里本是**两件东西**（用户编辑的参数化图元 + 由它物化出来的一族拓扑），手工按钮落两件、`solid.create_template` 只落一件 —— 于是"用 Agent 建的立方体，旋转角不起作用"。修法是动作层加**唯一入口** `compileTemplateSolid`（刻意不传自定义 `BuilderContext`，与 `syncTemplateTopology` 的默认命名逐字一致），手工按钮改调同一入口。验收：手工与 Agent 同参数创建四类模板产出**逐字节相同**的文档。

**方案 2（P1）拆分过大的编排与领域文件**（进行中，已开二十九批）
`operations.ts` 2817→2662（`solidGeometry.ts`）、`PropertiesBar.tsx` 1069→**298**（`inspectorFields.tsx` 字段控件 / `inspectorLabels.ts` 名字与归属 / `inspectorReadings.tsx` 派生读数组件 / `inspectorModel.ts` **检查器模型**：面板从此只负责画）、`App.tsx` 2000→**809**（`persistence/fileExports.ts`、`documentIds.ts`、`creationCommands.ts` 九条创建命令、`solidCommands.ts` 七条截面与宿主绑定命令、`recordCommands.ts` 五条记录命令、`structureCommands.ts` 三条结构命令、`anchorRotationCommands.ts` 两条定点旋转命令、`point3ToolCommands.ts` 六条三维工具命令、`previewCommands.ts` 两条预览创建命令、`selectionCommands.ts` 七条选择命令、`canvasStatusPrompt.ts` 状态栏推导、`draftingCommands.ts` 2D 创建流程、`appViewState.ts` **派生视图状态**：选中了谁 / 能不能建某类对象 / 活动图层能不能画 / 标注与定点旋转的入参够不够，23 个字段的纯计算、`useDraftPersistence.ts` **启动恢复与自动保存**：两个 effect + 它们之间的时序守卫 + "换一世"的 `reset` 入口、`commandDispatch.ts` **命令分发**：CAD 与功能区两张 switch 表 + 换 CAD 模式、`useKeyboardShortcuts.ts` **键盘快捷键**：Esc 分级 / Delete / 撤销重做）、`threeScene.tsx` 1807→**269**（那个 1445 行的挂载期效应整块搬进 `threeSceneEffect.ts`，随后按阶段切出**六块**：`threeSceneCamera`（相机取景）/ `threeScenePreviewHover`（预览悬停）/ `threeSceneRender`（一帧绘制 + 两层标签 + 容差档位与手柄缩放）/ `threeSceneGrid`（网格与坐标轴落位）/ `threeSceneInteraction`（指针按下·移动·抬起、拖拽会话、拾取判定）/ `threeSceneContent`（**内容同步**：`contentRecords` + `keepContent` 增量重建 + 整场 `syncContent` + `refreshPrimitiveObject`），效应本体 1445→**559** 行。六块合计 1570 行 —— 切出去的是 886 行，其余约 680 行是各块的 `deps` 接口、工厂签名与头注释，这笔"接口税"如实记在这里。切成工厂的**直接收益**当场兑现：`threeSceneContent` 过去整块住在效应里、只能靠整页 e2e 从外面看，现在能喂一份文档进去问它"你到底重建了什么" —— 新增 6 条用例钉住重建粒度（沿用不换实例、只重建改动的那一个、删图元时记录回到 3 条静态对象、就地重建画在 `points` 表的坐标上、就地重建后整场同步不产生第二个对象）。`appViewState` 同理：那批派生状态过去只有**渲染整棵 App** 才能验，现在喂一份文档就能问 —— 新增 8 条用例钉住"空选中不算全锁定 / 全可见"、截面只认模板实体、交点只认 `@draw/dsl` 那张可采样表、空间工具"只认空间点"、线性与角标注各自独立计数（1 点 + 1 棱 → 线性可用而角不可用）、定点旋转要"一个点 + 一条未锁定的封闭曲线"、活动图层被隐藏 / 锁定时的那句提示。写这批用例时当场纠正了我自己的一个错判：混着选 1 点 + 1 棱时线性标注**是可用**的（那条棱自己就够），我原先以为两种入口都该关着。`useDraftPersistence` 是第三种收益：它那两条时序守卫本来**只能靠整页 e2e 间接证明**（一条是探针抓出来的、一条是 e2e 抓出来的），搬成 hook 时留了一道能控制 `restore()` 何时返回的缝，于是新增 9 条用例直接钉住它们 —— 恢复在途时一个字都不写、恢复自己带来的那次变化只跳过一次、用户先动手就不覆盖、切走工作区就不覆盖、网页版退回草稿、仓储本该可用却失败要如实说且照样放行自动保存、`not_a_desktop_shell` 不弹提示、保存失败只报一次，以及"换一世"那个入口。`commandDispatch` 是同一件事的第三次兑现：两张 switch 表过去与二十来个闭包 handler 挤在一起、只能点界面验，现在 12 条用例喂替身 handler 问"这一步该谁做、谁必须没被调到"（图层挡住时只提示不创建、`inspect-diagnostics` 必须拿到更新函数而不是布尔值、CAD 工作区里功能区命令整条转给 CAD 表 —— 连"只在功能区表里的 `create-cube` 在 CAD 工作区什么都不会发生"这条看着像 bug 的当前口径也钉住了）。搬键盘处理时**顺手修掉两处搬之前就存在的依赖问题**：①依赖数组里有 `document` 与 `apply`，函数体一个都没读 —— 后果不是"多订阅一次"：`document` 每次编辑都换身份，等于**每提交一笔操作就把键盘监听摘下来再挂回去**；②`deleteSelected` 漏写，而函数体真的调它（基线那条 lint 警告就是它），漏掉意味着"某次改动之后 Delete 走的还是旧的闭包"。修完基线 14 → **13** 条警告。9 条新用例直接往 `window` 发按键：撤销/重做按平台修饰键、输入框里 Ctrl+Z 不许撤销整篇文档、`Alt+Ctrl+Z` 不算快捷键、Esc 分级（先取消创建、再关指引、最后才清选择）、Delete/Backspace `preventDefault`、输入框里 Delete 不删对象、卸载后监听摘掉。切法是"**依赖对象 + 原文搬**"：跨阶段的可变值先变成**稳定容器**（`copy` / `clear` / 就地 push），搬动的行一行不改；每一步都以 `geometry3d-*` 那组 e2e 验收）。切的过程中又抓到第三条**顺序坑**：内容同步要用渲染工厂交出的 `syncPointHandleScales` 先把点手柄按屏幕尺寸缩放、再算内容包围盒与面片尺寸（否则同一份内容算出偏小的包围盒，实测 7.02 vs 7.11），所以内容工厂只能排在渲染工厂**之后** —— 这与"初始 `syncContent()` 必须排在工厂调用之后"其实是同一条约束的两端）。
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

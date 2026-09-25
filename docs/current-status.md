# MathCanvas 当前状态

> **这是"现在时"的唯一一处。** 本文件只回答三个问题：现在能跑吗、已经做完什么、还差什么。
> 历史过程（每一轮的 RED→GREEN 证据、被推翻的方案、实测读数、误报清单）在
> [`docs/project-progress.md`](project-progress.md) —— 那是**归档**，里面的数字是"当时实测"，
> 不是当前值。两份文件分工明确：**要当前值看这里，要过程看归档。**

**最后更新：** 2026-09-25 00:35（方案 2 第二十九批：键盘处理搬出 `App.tsx`；表里的门禁读数都是最近一次改动后复跑的实测值）。

## 一、现在能不能跑（可复核的门禁读数）

| 命令 | 当前读数 |
| --- | --- |
| `npm test` | **238 个测试文件 / 2810 个用例通过 + 1 个 todo（零失败）** |
| `npm run typecheck` | **6 个 workspace + `e2e/`（42 个 spec）全部 exit 0** |
| `npm run lint` | **0 error / 13 warning**（基线从 14 降到 13：搬键盘处理时补上了漏写的 `deleteSelected` 依赖，那条警告随之消失） |
| `npm run build` | exit 0 —— 入口 **1 635.70 kB（gzip 470.70 kB）** + 按需 chunk `engineeringExporters` **433.81 kB（gzip 179.75 kB）** + `geometry.worker` **304.32 kB** |
| `npm run test:perf` | 八条场景（`packages/scene-graph`），见下；另有 `apps/web/src/agent/compilePlan.bench.test.ts` 量编译成本 |
| `npm run test:e2e` | Playwright **42 个 spec / 141 条用例全绿**（本机整套实跑，含主线程响应性读数；**不要与 `npm test` 并行跑**，见下表下面的说明） |
| `npm run test:rust` | **232 例通过 + 3 ignored / 0 失败**（2026-09-25 本机复跑，走 `scripts/toolchain.mjs` 补 PATH） |

**性能读数**（`npm run test:perf`，本机实测；定位是**趋势与报警器**，不是性能目标）：

| 场景 | 读数 | 它对应什么 |
| --- | ---: | --- |
| `addPrimitives/1000-planar` | ~6 ms | 1000 图元文档里的一笔编辑（每拖一下都要付） |
| `recomputeDerivedObjects/100-solid` | ~24 ms | 打开一份 100 实体（约 2800 图元）的文档 |
| `solidStatusReport/100-solid` | ~5 ms | 属性面板每次选中都跑（历史 G1 退化的现场） |
| `encodeMgeo/large` | ~4 ms | 保存 / Agent 提交算内容指纹 |
| `roundTrip/large-mgeo` | ~15–20 ms | 打开文件的另一半：解码 + 全量重算 |
| `denseIntersections/200x200` | ~1.5 ms | 密集两两相交（线性扩展：16 倍密度 → 6.2 ms） |
| `drag/300-frames` | ~750 ms（≈2.5 ms/帧） | 连续拖动 300 帧；60 fps 预算 16.7 ms/帧，**余量充足** |
| `dag/*` + 校准 | 见 `PERF` 行 | 局部/全量等价性判据 + "计时本身没坏"的校准 |

**主线程响应性读数**（`npx playwright test e2e/main-thread-responsiveness.spec.ts`，输出 `PERF frame-gap`；单独跑 / 整套并行跑各一次）：

| 阶段 | 单独跑 | 整套并行跑 | 它对应什么 |
| --- | ---: | ---: | --- |
| 载入（冷启动 + 首帧） | max 99.9 ms | max 266.6 ms | 整个 bundle 的解析执行 + 首次渲染；并行跑时被其它 worker 抢 CPU，所以**不当门禁** |
| 拖动动点 24 步 | max 16.8 ms（p95 16.8） | max 116.7 ms（p95 33.5） | "每帧都要重算"的那类交互 —— 60 fps 预算是 16.7 ms |
| 故意阻塞 200 ms（量具标定） | max 183.3 ms | max 200.0 ms | **证明量具是准的**：连这都测不出来就说明是仪器坏了 |

> **这一条读数怕机器负载**：把整套 node 单测（2700 多条）与这套 e2e **并行**跑时，拖动那一档读到过 **366.7 ms**（单跑 16.8 ms，差 22 倍，阈值 250 ms）—— 所以"两套一起跑"的结果不算一次有效的 e2e 验收；CI 里它们本来就是两个作业。

**门禁已经自动化**：`.github/workflows/ci.yml`（`checks` = typecheck + lint + Vitest、`build`、`e2e`、`rust`）。

**e2e 现在也过类型检查**（本轮补上，此前**一处都没有**）：`e2e/` 不在任何 workspace 里，`apps/web/tsconfig.json` 只 include `src`，所以 42 个 spec 一直只被 Playwright **转译**、从不被 `tsc` 检查 —— 补上之后当场查出 **23 个类型错误**（既包括 `null` 没判、`Element` 当成 `SVGCircleElement` 用这类真问题，也包括找不到 node 内建类型）。现在 `npm run typecheck` 末尾会跑 `tsc -p e2e/tsconfig.json`。
选择**不装** `@types/node` 而只写一份最小声明（`e2e/nodeTypes.d.ts`）：它一旦进 `node_modules/@types`，所有没写 `types` 的 tsconfig 都会自动全局引入，`setTimeout` 的返回类型会从 `number` 变成 `NodeJS.Timeout`，动摇应用侧现在好端端的代码 —— 为给测试补类型而付这个代价不划算。
读数会随提交变化，**以 CI 最近一次运行为准**；上表是本地实测值。

## 二、按评审方案：做到哪一步了

**一句话进度（估计，口径写明）**：七条方案里**六条已完成并验收**，只剩方案 2 在进行 —— 按**目标等权**算方案 2 约 **70%**（`PropertiesBar` / `App.tsx` / `threeScene.tsx` 三个目标达标，`threeSceneEffect.ts` 残块约 90%，`agent-core/src/schemas.ts` 与 Rust `lib.rs` 两个文件**一行未动**）；折成整条：**按方案条数 ≈96%，按工作量加权 ≈85%**。剩下的量估计还有 5–8 轮。

| 方案 | 优先级 | 状态 | 一句话 |
| --- | --- | --- | --- |
| 1. 统一实体构造与拓扑物化 | P0 | ✅ **已完成并验收** | 见下节 |
| 2. 拆分过大的编排和领域文件 | P1 | 🔶 **已开三十一批** | `operations.ts` 2817→2662、`PropertiesBar.tsx` 1069→298（→`inspectorFields` / `inspectorLabels` / `inspectorReadings` / `inspectorModel`）、`App.tsx` 2000→**809**（→`fileExports` / `documentIds` / `creationCommands` / `solidCommands` / `recordCommands` / `structureCommands` / `anchorRotationCommands` / `point3ToolCommands` / `previewCommands` / `selectionCommands` / `canvasStatusPrompt` / `draftingCommands` / `appViewState` / `useDraftPersistence` / `commandDispatch` / `useKeyboardShortcuts`）、`threeScene.tsx` 1807→269（→`threeSceneEffect` + **七个阶段模块**）、Rust `lib.rs` 992→**912**（→`src/commands/`） |
| 3. 接入几何 Worker | P1 | ✅ **已完成并验收** | 宿主生命周期 + 如实降级；契约缺口全部填上 |
| 4. 工作区级代码分包 | P2 | ✅ **已完成** | 入口单 chunk 2 066.63 → 1 629.80 kB（−21.1%） |
| 5. 正式 CI 门禁 | P2 | ✅ **已完成** | 四个作业按成本分层 |
| 6. 文档与过期注释收口 | P2 | ✅ **已完成**（当前 / 归档 / 变更记录三份分工） | 点名注释已修；`docs/current-status.md` 是"现在时"的唯一一处，变更记录见 `CHANGELOG.md` |
| 7. 大型场景性能基准 | 持续 | ✅ **已完成（八条场景 + 主线程响应性）** | 覆盖评审点名的场景，含密集相交、连续拖动 300 帧与浏览器里的帧间隔读数 |

### 方案 1（P0）：已完成，且逐条验收过

- **根因**：模板实体在文档里是**两件东西**（用户编辑的参数化图元 + 由它物化出来的一族拓扑）。手工按钮一次落盘两件，`solid.create_template` 只落盘第一件；没有 `polyhedron3` 拓扑时渲染落到"直接画模板"的分支，而那条分支**不读 `rotation`**。
- **修法**：动作层加唯一入口 `compileTemplateSolid`（刻意不传自定义 `BuilderContext`，与 `syncTemplateTopology` 的默认命名逐字一致），手工按钮改调同一入口，`DEFAULT_SOLID_SEGMENTS` 下沉到内核。
- **逐条验收**：①手工与 Agent 同参数创建四类模板 → **逐字节相同的文档**（4 条参数化用例）；②改朝向之后物化顶点**真的跟着转**（逐顶点比对解析值）；③确认面板的对象计数**如实**（一个立方体 28 个对象，全部计 `user`）；④长时记忆记的是**实体**而不是它的拓扑子对象。

### 方案 3（P1）：已完成（客户端 + 宿主生命周期 + 如实降级）

**已交付**：`apps/web/src/agent/geometryWorkerClient.ts` —— 宿主侧客户端，正是评审说"缺的那一块"。
它负责建 Worker、按 `requestId` 配对响应、核对外层信封、超时、丢弃过期响应、卸载。四条纪律各有具体的坏结果，也都各有用例：
①按 `requestId` 配对（不配 → 预览串版，最难复现的一类）；②核对 `runId` / `draftId` / `draftVersion`（旧版草稿的结果**不许**覆盖新预览）；③超时（否则界面永久卡在"处理中"）；④Worker 崩了要**如实失败**，不静默降级。
Worker 是**注入**的，所以这些规则在 jsdom 里能直接测（**10 条用例**）；生产侧由 `spawnGeometryWorker()` 用评审原文那个写法建真 Worker。

**宿主生命周期与降级在 `apps/web/src/agent/geometryWorkerHost.ts`**（**7 条用例**）：每个页面一份（同页面调两次必须是**同一只**）、丢弃单例时终止、`pagehide` 时终止（不终止就是泄漏线程）、能建 Worker 时**真的**走 Worker、建不起来时降级到**同一个** `compileInProcess` 且**用户原话照样传下去**、以及"降级要说出原因（每页一次）"。第 5 条是**回归用例**：它用同一份计划配两句原话（"画一个任意棱柱" vs "画一个棱柱"）断言结局**必须不同** —— 差别只可能来自"原话有没有传下去"，而兜底路上的那份副本正是漏传了它。这条用例**反向验证过**：把 `userMessage` 人为丢掉，它当场失败。

**还有 `apps/web/src/agent/geometryCompileStrategy.ts`**：把"同步编"与"交给 Worker 编"并排放在一处，并用**同一组代表题**证明**两条路的产物逐字节相同**（**5 条用例**，含"基准文档已有 `point-1` 时两条路都得从 `point-2` 接着发号"与"编不过时两条路都如实失败"）。为什么值得单独一个文件：两条路会**长期并存**（Worker 只在值得的场景启用），一旦它们对同一份计划给出不同结果，就会变成"某个形状只能在这一条路上编出来"—— 而这个项目已经几次因为"同一个判断写了两遍"吃过亏。用例里的假 Worker **真的**把消息交给 `handleGeometryRequest`，所以覆盖的是真链路，只把"线程"换成了函数调用。

**接线前的三处前置**（都是"接线之后会静默变差"的地方，所以先填）：

1. **契约缺口三个都填了**：`WorkerSuccess.completionAssumptions`（否则搬进 Worker 之后确认面板上"系统替你定了什么"会**静默变空**，用户会确认一件他没看过的事）；`WorkerFailure.repair` / `planDiagnostics` / `assumptions`（否则"编不过的计划"比现在**更难修** —— 协调器的一次性修复完全依赖它们）；`WorkerFailure.questions`（否则"本该问用户"的计划被报成笼统的 `compile_failed`，用户看到的是"编译失败"而不是"请你确认底面在哪"）。三处都在 `workerRuntime` 与 `parseWorkerResponse` 两侧钉了用例。
2. **`stage` 已异步化，编译策略可替换**：`DraftStore.stage` 返回 `Promise`，并新增 `CompileStrategy` 注入参数（默认就是原来那条"在当前线程上跑 `compilePlan`"，行为逐字不变）。`DraftStorePort.stage` / `preflight` → `Promise`，`DraftTools.stageActions` / `validate` → `Promise`，`CommitterAdapter` 与 `agentRuntime` 两处 `await`。有一条用例专门钉"注入的策略真的被调用、且它的产物真的落进草稿" —— **否则"可以换一条路"就是一句空话**，而这正是这个功能此前"能测不能跑"的成因（`geometry.worker.ts` 一直存在，但没有任何调用点）。
3. **`stage` 只要 7 个字段，而契约承诺 13 个** —— 这件事在收口时被查出来，并把类型改诚实了：新增 `StagedCompileResult`（`ok` / `draftDocument` / `operations` / `diagnostics` / `questions` / `assumptions` / `repair`），`CompileStrategy` 用它作返回类型。原因是 `PlanCompileResult` 里的 `actions` / `aliases` / `plan` / `completions` / `verification` **Worker 的响应并不携带**，而 `stage` 一个都不读；若返回类型仍写完整的 `PlanCompileResult`，"从 Worker 返回"就必然要**编造**那 5 个字段。收窄之后：两条实现都只交出真正被用到的东西，而哪天 `stage` 真需要新字段会**编译不过**，而不是悄悄拿到 `undefined`。

**接线（2026-09-24 完成）**：`apps/web/src/agent/geometryWorkerHost.ts` 把客户端绑成 `DraftStore` 要的那条 `CompileStrategy`。

- **Worker 的生命周期必须比一次运行长**：`createAgentRuntime` 是**每轮运行**建一次的（`agentRunner.ts` 的 `run()` 里调它），所以 Worker **不能在那里 `new`** —— 那会变成"每轮 Agent 运行泄漏一个 Worker"。改法是**模块级的懒建单例**（每个页面一份，`pagehide` 时 `terminate`）。懒建还有一个实际好处：没有 Worker 的测试环境不该因为"只是装配了一个运行时"就付建线程的代价。
- **必须能降级，而且降级必须如实**：`spawnGeometryWorker()` 用 `new Worker(new URL(...), { type: "module" })`，这条路径在**没有 `Worker` 的环境里直接抛**（node / vitest / 某些 WebView 设置）。实测后果是整轮运行从 `awaiting_confirmation` 变成 `failed` —— 让"这台机器没有 Worker"把一次作图变成失败，比"就地算"明显更糟。所以降级为**就地编译**，并往开发者控制台留一条能读的原因（每个页面只报一次：这条失败是必然的、不是偶发，每次编译都打会把控制台刷满）。这与评审警告的"静默降级"不是一回事：那说的是"明明能走 Worker 却悄悄不走"，这里是"这台环境压根没有 Worker"，而且它**说出来**了。

**接线时抓到的两件事**（都是用例如实抓出来的，不是顺手改的）：

- **客户端不再丢弃失败产物**（`geometryWorkerClient.ts`）：契约补上了 `repair` / `planDiagnostics` / `assumptions` / `questions`，但客户端此前只留 `code` + `detail` —— 于是"契约补上了"等于白补，数据到了主线程门口又被扔掉，**表现与没补一模一样**。已修 + 用例。
- **兜底路必须落在同一个 `compileInProcess` 上**：兜底最初自己抄了一份"就地编译"，而那份副本**漏传了 `prompt`（用户原话）**。后果很实：同一份计划在"默认路"与"兜底路"上编出**不同结果** —— 原话里带"任意"的棱柱计划本该被审计拒绝，在兜底路上却变成了澄清提问（`agentRuntime.test.ts` 与 `compilerRepair.test.ts` 各有一条用例当场抓到）。现在两条路只有**一处**实现（`draftStore.compileInProcess`），`geometryCompileStrategy` 只是转出去 —— 这种分叉不可能再长出来。

**关于"有没有更窄的缝"**（查实过，没有）：`CommitterPort.stage` **本来就是 `Promise`**、协调器**本来就 `await`** 它 → 那一侧零成本；`ToolPort.call` 也已经是 `Promise`，所以**工具派发本来就支持异步工具**。但把 Worker 只挂在 `CommitterPort` 一侧**不行** —— 两个端口**刻意共用一个草稿存储**（`agentRuntime.test.ts` 有一条用例钉着"tools 与 committer 共用同一个 draft store"），分叉会让模型看到的草稿与提交的不是同一份。`preflight` 同样经 `DraftStorePort` 暴露，也不是"另一条路"。

**所以接线的工作量已经是"接一根线"**：`DraftStore.stage` 与 `DraftStorePort.stage` 都已异步、编译策略已有注入点、契约两个缺口都已填 —— 剩下的是在 `agentRuntime.ts` 里造客户端、绑定策略、并把 `dispose` 挂到运行时的清理路径上。

**已有数据（本阶段实测，`compilePlan.bench.test.ts`）** —— 这是方案 3 那个决定的输入：

| 场景 | 读数 |
| --- | ---: |
| 代表题①（斜四棱柱 + 截面，小文档） | **4.8 ms** |
| 代表题②（圆锥曲线不变量） | **2.2 ms** |
| 同一份计划，基准文档 **2000 图元** | **73 ms** |
| **过线程边界的复制成本**（`structuredClone` 同一份 2000 图元文档） | **1.0 ms** |
| **比值**（编译 ÷ 复制） | **76 倍** |

**结论（本轮据读数更正过一次）**：
1. **典型文档上编译只要个位数毫秒**，而评审点名的目标场景是"约 100 个三维实体"；P0 之后一个立方体就是 28 个图元，所以约 2800 图元才是**真实**的大文档档位 —— 也就是上表第三行那一档，**约 70 ms 的主线程卡在"确认"这一步**。
2. **成本在"算"，不在"读文档"**：拆开量过 2000 图元的 `id` 数组（0.01 ms）、`new Map`（0.05 ms）、`createIdAllocator`（0.07 ms）—— 都不是瓶颈，瓶颈是 `compilePlan` 自己的扫描/校验。这一点决定 Worker 值不值：成本若在"读文档"，Worker 也要读一遍等于白搬；成本在"算"，Worker 就能把它挪出主线程。
3. **入场费可以忽略**：复制只要 **1.0 ms**，而编译 **73 ms** —— 花 1 ms 换掉 70 ms 的主线程卡顿，收益约 **76 倍**。

**因此方案 3 值得接线**（上一轮我按"复制成本可能抵消收益"判断为"暂不接线"，**那个判断基于没量过的假设，已被上面两条读数推翻**）。**已接线**（见本节开头），接线的成本确实只是那一处契约决定，**不是重写管线**。

**教训（已更正）**：此前几轮把这条记成"接进去要把 `stage()` **及其调用方全部**改成异步 —— 那是 Agent 管线的深度改造"。**那个判断是错的**：协调器本来就是异步的。一个记错的阻塞理由会让后来人**不去做本来做得到的事**，所以这条更正本身也是"如实"的一部分。

## 三、还没做的（按建议顺序）

1. **方案 2 剩下的**：`App.tsx`（**809 行**，已无"有状态的整块"，剩下的是装配与 JSX）与 `threeSceneEffect.ts`（**489 行**；组件 `threeScene.tsx` **269 行**；已按阶段切出**七块**：`threeSceneCamera.ts`（相机取景）、`threeScenePreviewHover.ts`（预览悬停）、`threeSceneRender.ts`（一帧的绘制 + 两层标签覆盖层 + 曲线容差档位与手柄缩放）、`threeSceneGrid.ts`（网格与坐标轴落位）、`threeSceneContent.ts`（**内容同步**：`keepContent` 增量重建 + 整场 `syncContent` + `refreshPrimitiveObject`，604 行）、`threeSceneInteraction.ts`（指针按下 / 移动 / 抬起、拖拽会话、拾取判定 481 行）、`threeSceneDragVisuals.ts`（**拖动期间的画面**：半径预览 / 手柄落位 / 场景重建后补画），手法是"依赖对象 + 原文搬"；跨阶段的 `let` 一律改成稳定容器（`copy` / `clear` / 就地 push）），之后是 `agent-core/src/schemas.ts` 与 Rust `lib.rs` 剩下的三组（providers / 项目仓储与附件 / 多会话）—— Rust 侧第一批已经开了：`lib.rs` 992→**912**，代理与密钥两组搬进 `src/commands/`。
   已拆出的部分：`PropertiesBar`（1069→298）的字段控件 / 名字与归属 / 派生读数 / **检查器模型**（`inspectorModel.ts`：只依赖三项，因此能脱离面板单独测）；`App.tsx`（2000→**809**）的导出、id 分配、九条创建命令（`creationCommands.ts`）、七条截面与宿主绑定命令（`solidCommands.ts`）、五条记录命令（`recordCommands.ts`）、三条结构命令（`structureCommands.ts`）、两条定点旋转命令（`anchorRotationCommands.ts`）、六条三维工具命令（`point3ToolCommands.ts`）、两条预览创建命令（`previewCommands.ts`）、七条选择与批量操作命令（`selectionCommands.ts`）、一条状态栏推导（`canvasStatusPrompt.ts`）、四条 2D 创建流程（`draftingCommands.ts`）、**派生视图状态**（`appViewState.ts`：选中了谁 / 能不能建某类对象 / 活动图层能不能画 / 标注与定点旋转的入参够不够，23 个字段的纯计算）、**启动恢复与自动保存**（`useDraftPersistence.ts`：两个 effect + 它们之间的时序守卫 + "换一世"的 `reset` 入口）、**命令分发**（`commandDispatch.ts`：CAD 那一张 switch 表 + 功能区那一张 + 换 CAD 模式，95 行原文搬）、**键盘快捷键**（`useKeyboardShortcuts.ts`：Esc 分级 / Delete / 撤销重做；搬动时顺手修掉两处依赖问题）。`agent-core/src/schemas.ts` 与 Rust `lib.rs` 按评审排在更后。
   - **`App.tsx` 里已经没有"有状态的整块"了**：命令分发、恢复与自动保存、键盘处理、派生状态全部搬完，剩下的 800 余行绝大多数是界面装配（各面板的 props 与 JSX）。要按"先定接口再搬"做。
      派生状态搬成**纯函数**之后第一次能直接问（过去只有渲染整棵 App 才能验）：新增 8 条用例钉住"空选中不算全锁定 / 全可见"、截面只认模板实体、交点只认 `@draw/dsl` 那张可采样表（圆 + 圆可以、圆 + 立方体不行）、空间工具"只认空间点"这条前提（混进一个平面点就全关）、线性与角标注各自独立计数（1 点 + 1 棱 → 线性可用、角不可用）、定点旋转要"一个点 + 一条未锁定的封闭曲线"、以及活动图层被隐藏 / 锁定时那句提示。
      启动恢复那一段更值：它那两条守卫本来是"只能靠整页 e2e 间接证明"的（一条是探针抓出来的、一条是 e2e 抓出来的），搬成 hook 时给它留了一道能控制 `restore()` 何时返回的缝，于是新增 9 条用例直接钉住 —— 恢复在途时**一个字都不写**（否则初始空文档会覆盖上一轮的草稿）、恢复自己带来的那次变化只跳过一次而用户下一次改动照常写、用户在恢复返回前动过手就**不覆盖**、切走工作区就不覆盖、网页版退回 localStorage 草稿、仓储本该可用却失败要**如实说且照样放行自动保存**、`not_a_desktop_shell` 不弹提示、保存失败**只报一次**，以及"换一世"那个 `reset` 入口。
      命令分发搬出来同样直接兑现：两张 switch 表过去与二十来个闭包 handler 挤在组件体里、只有点界面才能验，现在新增 12 条用例喂替身 handler 问"这一步该谁做、谁必须没被调到" —— 图层挡住时**只提示不创建**、非创建类命令在图层被挡时照常工作且清掉上一条提示、`select-all` / `modify-hide|show` / `inspect-sources`（投影来源去重）分别送到谁手里、`inspect-diagnostics` 拿到的必须是**更新函数**（连点两次要真的来回切）、导出按格式分派、未知 id 只做"进入命令"那一组动作，以及 CAD 工作区里功能区命令**整条转给 CAD 表**（连"只在功能区表里的 `create-cube` 在 CAD 工作区什么都不会发生"这条看着像 bug、其实是当前口径的行为也钉住了）。
      键盘处理最后一块搬完，顺带修掉两处**搬之前就存在**的依赖问题：依赖数组里有 `document` 与 `apply` 而函数体一个都没读（后果不是"多订阅一次"——`document` 每次编辑都换身份，等于**每提交一笔操作就把监听摘下来再挂回去**），以及 `deleteSelected` 漏写（基线那条 lint 警告就是它，补上后基线 14 → 13）。新增 9 条用例直接往 `window` 发按键：撤销/重做按平台修饰键、输入框里按 Ctrl+Z **不许**撤销整篇文档、`Alt+Ctrl+Z`（输入法组合）不算快捷键、Esc **分级**（先取消创建、再关指引、最后才清选择，且前者不得顺手清选择）、Delete/Backspace 删选中并 `preventDefault`、输入框里按 Delete **不删对象**、空选中不删、卸载后监听真的摘掉。
   - `threeScene.tsx` 现在**只剩装配**（269 行）：那个 **1445 行的挂载期效应整块**搬进 `threeSceneEffect.ts`（逐行原样；接口 = 组件作用域里被读到的那些 ref），随后按阶段切出**七块**。切法是先把 `sceneBounds` / `previewGroups` / `objectIndex` / `viewportHeight` 这批**共享可变局部量**收进一个 runtime 对象，再按阶段搬；每切一块跑一遍 `geometry3d-*` 那组 e2e。效应本体 **1445 → 489 行**，剩下的是**装配与编排**：建场景 / 相机 / 渲染器、七个阶段工厂的调用顺序、监听注册与注销、尺寸变化、键盘处理。
      `threeSceneContent` 搬出来之后第一次能**单独测**（它过去整块住在效应里，只能从整页外面看）：新增 6 条用例，钉住"重建粒度"这一类不变式 —— 同一份内容第二次同步要**沿用**（对象实例都不换）、只改一个图元时**只有那一个**重建（栅格与坐标轴不许跟着重建）、图元被删时收掉记录并如实计数（`sceneContent` 从 4 回到 3，那 3 条是栅格 / 主栅格 / 坐标轴）、`refreshPrimitiveObject` 画在 `points` 表里的坐标上、以及"就地重建之后紧接一次整场同步不会画出第二个对象"。
       `threeSceneDragVisuals` 是"拖动期间的画面"（拖动时文档不提交，画面全靠它）：半径预览按宿主参数**同半径**重算动点坐标，所以点始终贴在新的圆周上；三色环按构建时的轨道半径算同一个比例，**避免逐帧累积**；场景因选中 / 尺寸变化被重建后按**累计量**补画一次（旋转按累计角度、缩放按预览半径、平移按累计位移）。搬动里唯一的改写是那一处**必要的**：原来直接写 `resumeDragVisualRef.current = () => {...}`，现在工厂交出 `resumeDragVisual`、由调用方赋值 —— 语义不变，但从此这一段能在别处被单独调。
   - 这一块为什么不能"顺手再搬一段"：效应内部那批局部量是**跨阶段共享**的（`sceneBounds` 由内容同步写、被取景与指针读），先拆阶段就得在那一千多行里逐处改写引用 —— 其中还埋着 `const document = documentRef.current` 这种与 DOM 全局同名的局部，盲改会静默改错。**顺序也是坑**：搬完之后初始 `syncContent()` 必须排在取景 / 绘制工厂调用**之后**（放在前面会 TDZ 崩溃，而 typecheck、lint、2700 多条单测全绿，只有 e2e 抓得到）；预览悬停的工厂调用则要**前移**到指针处理之前，否则 `raycasterAt` / `previewHitAt` 在定义前被引用；**内容同步的工厂也不能紧跟容器声明** —— 它要用渲染工厂交出的 `syncPointHandleScales` 先把手柄按屏幕尺寸缩放、再算内容包围盒与面片尺寸（否则同一份内容会算出偏小的包围盒，实测 7.02 vs 7.11），所以只能排在渲染工厂之后。

## 四、如实缺口（不是缺陷，是没做或做不到）

- **CI 的首次运行是"三红一绿"，三个红都不是产品代码的问题，而是门禁自己要不要自足**（2026-09-25，run #1 / `96ff89f`；run #2 又暴露出两处，run #3 / `f10ee8e` **四个作业全绿**；两条修复提交 `26763e7` / `f10ee8e`，见 `CHANGELOG.md` 同日那一节）：
  1. `checks` 红在 `scripts/preview-server.test.ts` —— 它等 `127.0.0.1:4173` 返回 200，而那需要 `build-check/` 里有一份构建；本机一直有，CI 上没有（构建在另一个作业里），于是轮询到 vitest 的 5 秒超时。修法：用例自己造最小产物 + 随机端口，**不再依赖本机恰好有构建**（把真实产物挪走后复跑，仍然绿）。
  2. `build` 红在根目录的 `npm run build`（= `--workspaces`）连带去跑 `apps/desktop` 的 `tauri build`，而那个作业没有装 WebKitGTK。修法：这个作业只构建 web 工作区 —— 与它自己注释里"桌面打包刻意不进 CI"一致。
  3. `rust` 红在 `shell_smoke` 的 `the_web_entry_the_shell_loads_exists_and_is_the_web_build`：它断言外壳加载的 web 产物**真的在**，而 `cargo test` 不会跑 `tauri.conf.json` 的 `beforeBuildCommand`。修法：作业里先 `npm run build --workspace @draw/web` 再跑测试。
- **Rust `lib.rs` 的"大"有一半是被一份**守护性断言**钉住的**（2026-09-25 拆它时发现）：`tests/shell_smoke.rs` 原来要求**所有** `#[tauri::command]` 都写在 `src/lib.rs` 里（它按 `lib.rs` 的文本数 `#[tauri::command]` 的条数、并逐条找 `fn <名字>(`）。也就是说这个文件不是"没人拆"，而是"拆了就会红"。这一批把那份断言的口径从"扫 lib.rs"改成"扫整棵树"（`src/lib.rs` + `src/commands/*.rs`）—— **意图没变，覆盖面反而更大**：它现在守的是"只暴露具名命令、没有泛型命令、没有通用 shell / 文件读写出口"这条性质，而不是"命令住哪个文件"。登记清单仍逐字写在测试里（比对时只取路径的**最后一段**）。
- **`scripts/` 下的测试仍未纳入 `tsc`**（只有 `apps/web/src`、各 package 与 `e2e/` 被类型检查）：`scripts/preview-server.test.ts` 是 vitest 转译执行的。它的类型错误不会在门禁里现形 —— 与"e2e/ 曾经一样"的同一个缺口，补法也一样（一份最小 tsconfig），本阶段没做。

- **几何 Worker 已接线，但"值不值"这条结论仍是**依据本轮读数**得出的**（编译 73 ms vs 复制 1 ms，约 76 倍）；**不是"管线全同步"** —— 那个判断此前记错了，已更正。降级路径（没有 `Worker` 的环境就地算）有独立用例，见方案 3 一节。
- **性能上的一件事还没做**：把 `applyOperation` 每次从整份文档 `structuredClone` 的成本降下来。基准显示这一档**固定成本压过增量收益**（局部重算比全量还慢）。注意这与方案 3 不是同一件事：编译那 73 ms 花在**算**上（复制只占 1 ms），所以 Worker 对它是有效杠杆；而重算那一档的固定成本才是复制。
- **主 bundle 仍超 500 kB 警告**：入口 1 636 kB 里是应用代码 ≈877 kB + React 221 kB + Three 530 kB。`three` 仍在入口 —— 立体几何是首屏可达的顶级模块，拆它要连带改 `threeScene.tsx` 的装配方式。
- **`npm run test:rust` 已复跑**（2026-09-25）：**232 例通过 + 3 ignored / 0 失败** —— Rust 侧本阶段零改动，复跑是为了量它、并查清首次 CI 里 rust 作业为什么红（见下一条）。
- **确认面板不按属主实体归并子对象**：用户要"一个立方体"，面板会说"会新增 28 个对象"。计数本身没错（28 个对象确实都会进文档），但"要不要按实体归并着说"是产品判断 —— 与方案 1 里"对象树以拓扑为依据"是同一个问题的另一面。**连带影响**：`agent-flow.spec.ts` 里有两条用例还在按"一个立方体 = 一个对象"断言（`共 2 个` / `会新增 1 个对象`），方案 1 之后它们必然为红 —— 已改成断言**不会随计数口径漂移**的性质（"共 N 个"必须大于"本次新增"，即草稿落在已有内容之上），同批 e2e 里 `solid-prism` / `agent-oblique-prism` 一直是按新口径断言的。
- **`longtask` API 在本机不可用（实测，不是猜的）**：评审方案 7 点名要的 `PerformanceObserver({ type: "longtask" })` 在**空白页**上、对一次**故意阻塞 200 ms** 的主线程占用，`observed` 与 `performance.getEntriesByType("longtask")` **都是空的**，而 `supportedEntryTypes` 里**确实**列着 `longtask`（Chromium 153 / Playwright headless）—— 即"声称支持、什么也不报"（一次性探针复核过，用完即删）。所以主线程读数改用**帧间隔**（`requestAnimationFrame` 间隔）实现：同一个 200 ms 阻塞必定表现为 ≥200 ms 的空档，量具灵敏度可以自证（用例里就有这条标定断言）。见 `e2e/main-thread-responsiveness.spec.ts`。
- **引用进度档案一律用小节标题，不写行号**：`project-progress.md:<行号>` 形式的引用会随任何一次编辑静默失效（本阶段就发生过三处，已全部改成按标题引用）。

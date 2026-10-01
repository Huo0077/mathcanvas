# MathCanvas 当前状态

> **这是"现在时"的唯一一处。** 本文件只回答三个问题：现在能跑吗、已经做完什么、还差什么。
> 历史过程（每一轮的 RED→GREEN 证据、被推翻的方案、实测读数、误报清单）在
> [`docs/project-progress.md`](project-progress.md) —— 那是**归档**，里面的数字是"当时实测"，
> 不是当前值。两份文件分工明确：**要当前值看这里，要过程看归档。**

**最后更新：** 2026-10-01（根脚本 `npm.cmd run build` exit 0；**本地全量端到端测试 169/169 通过**。此前连续四次 GitHub CI 的 checks/build/rust 均通过、e2e 失败；修正三份 e2e 的过时几何输入后本地复跑转绿，**新提交的 GitHub CI 尚待核实**。其余未完成项见文末总清单；历史门禁读数不能冒充当次复跑）。

## 一、现在能不能跑（可复核的门禁读数）

| 命令 | 本轮实际结果与范围 |
| --- | --- |
| `npm test -- --maxWorkers=3` | **266 个测试文件 / 3072 个用例通过 + 1 todo / 0 失败**（全库；比上一批多 6 项 = 创建状态机补的边界用例） |
| `npm run typecheck` | 6 个 workspace，以及 `e2e/` 与 `scripts/` 类型检查，全部 exit 0（本轮复跑） |
| `npm run lint` | exit 0，**0 error / 13 warning**（已有基线警告，并非全部无警告；本轮复跑） |
| `npm.cmd run build`（2026-10-01） | **exit 0**：根脚本遍历全部工作区；桌面 `tauri build --no-bundle` 完成 release exe（不是 MSI/NSIS 打包），Web 前置构建和工作区构建均通过，4 个 packages 的 `tsc -p tsconfig.json` 全通过。Web 入口 1701.84 kB，仍有 >500 kB 分块及混用动态/静态 import 警告；Rust 有 linker 消息警告。首次沙箱内尝试因 `Cargo.toml` 写入拒绝而失败，获准在沙箱外复跑成功。**不代表**全量 e2e、Rust 测试、性能测试或安装包实机验证通过。 |
| `npm --workspace @draw/web run build` | exit 0；入口 1694.22 kB、`engineeringExporters` 433.81 kB、`geometry.worker` 310.99 kB；仍有 >500 kB chunk 警告 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01） | **169 / 169 通过，exit 0**（全量；Windows 本地）。修正 3 份旧 e2e 的测试几何输入：默认立方体已是 4×4×4，旧用例仍按 4×4×2 取剖切面/内切球；拖动截面的原落点在屏幕上与棱重合，棱按设计优先。修正前本地 165/169；**GitHub CI 状态在本提交推送后另行核实**。 |
| 7 个相关 3D Playwright spec | **50 / 50 通过**（本批复跑；含创建、实体面板、原立体交互、旋转环、求交预览、棱柱旧文件、教学虚线；比 `a53b034` 记录的 44 项多 6 项 = 此后各批新增的用例）；**第二组 7 spec / 36 项也通过**（创建、棱柱、六类样题、拖动、相机记忆、求交预览、教学线型）；全量 2026-10-01 的新读数见上行（这里仍保留当时两组局部回归的历史读数） |
| `e2e/high-school-geometry-tasks.spec.ts`（Task 8 三批合计） | **7 / 7 通过**（本轮复跑）：三棱锥、四棱锥、斜三棱柱、异长长方体、圆锥截面、空间直线与平面的关系、已有文档恢复与撤销 —— **六类代表题全部覆盖**；断言顶点坐标、三边尺寸、拉伸向量、解析圆锥曲线离心率、平面方程判定的线面关系、旧文档迁移后的拓扑几何、刷新后逐 id 恢复、拓扑依赖、保存往返与一步撤销（三批各做过变异检查）；另含两条回归：**恢复后第一次改动必须写回草稿**（修复前红 Expected 112 / Received 84、修复后绿）与**点到平面距离与选择顺序无关**（两种顺序都量出 3.000u） |
| `apps/web/src/spatialPick.test.ts`（Task 3 补充用例） | **11 / 11 通过**：新增相机斜视（斜射线落点精确）、面背侧（命中优先于工作平面、不猜深度）、距离容差（`1e-8` 阈值两侧都钉住）、重叠点（身份来自命中而非坐标反查）；三次定向变异各自抓红对应用例 |
| `e2e/solid-prism.spec.ts`（Task 6 补充） | **6 / 6 通过**：新增棱柱**体积 48**的读数（属性栏卡片；实体源在画布上没有数字）与**保存/恢复**往返（`construction.kind === "prism"`、8 顶点、顶面 = 底面 `+(1,0.5,3)`、重开后包围盒逐字一致） |
| `apps/web/src/persistence/mgeoRoundTrip.test.ts`（Task 4 补充） | **5 / 5 通过**：新增"画布新建的点 / 线段 / 直线 / 面"往返 —— id 集合与几何不变、三种引用写法（线段 `pointIds`、直线 `definition.pointIds`、面 `pointIds`）都仍指着存在的点，且重开后再引用旧点会**复用**（变异检查证过） |
| `e2e/geometry3d-teaching-lines.spec.ts`（Task 7 补充） | **2 / 2 通过**：新增「旋转视角后顶点标签仍逐点对齐」—— 对每个 `[data-point-id]` 断言其锚点等于**它自己那个顶点**的投影（±2px），旋转前后各查一遍，并用 `data-camera-azimuth` 确认真转了；变异检查（偏移 +10→+60）当场报 50px |
| `e2e/geometry3d-creation.spec.ts`（Task 5 / Task 3） | **10 / 10 通过**：创建悬停读数（工作平面 + 世界坐标 / 已有点 + **该点自己的**坐标，且**对象行数全程不变**）、切换工作区取消未提交状态（锚点归零、无半成品）、**创建优先于预览点击**（点交面预览只落地一个空间点，不多出交面图元、预览不被消耗）、**从「选择工具」退出**（工具与锚点归零、未提交锚点不落盘、退出后点空白回到选择语义不创建）、**锁定对象不被吸附**（同一坐标：未锁定读"已有点"、锁定读"工作平面 XY"、解锁又读回"已有点"，且点仍在画布上） |
| `e2e/geometry3d.spec.ts`（Task 1 基线补充） | **24 / 24 通过**（22→24）：新增 **Shift 两点多选→创建空间直线**（原用例只到"按钮可用"，现真的点下去建出对象，并以操作提示"对象 3"钉住复用已有两点不另建）与 **Esc 分级基线**（属性栏不再编辑任何对象、而对象行数一个不少 —— Esc 不是删除）；各带一条定向变异 |
| `apps/web/src/spatialCreationSession.test.ts`（Task 2 边界） | **10 / 10 通过**（4→10）：point3 一点完成 / line3+ray3 两点完成 / **face3 无论多少点都不自动完成、只有 Enter 收尾** / 首末点重合被拒且会话不前移 / 非有限坐标被拒且不留脏数据 / 拒绝提交的原因文案；三处变异各自精确抓红，并查明 face3 有"两层独立守卫" |
| `apps/web/src/spatialTools.test.ts` + `threeScene.test.ts`（Task 1 基线） | **74 / 74 通过**（16 + 58） |
| `npm --workspace @draw/desktop run bundle`（2026-09-30） | 当次桌面端 `tauri build` exit 0，产出 v3.0.0 release exe / MSI / NSIS，免安装 exe 做过启动实测；与 **2026-10-01 根脚本 `npm.cmd run build` 的 v3.0.1 `--no-bundle` 构建是两次不同的验证**，不要把它们混成"本版安装包已安装"。 |
| `npm run test:rust` / `npm run test:perf` | 本轮均未复跑；此前读数只能当历史基线，不能写成现状 |

**性能读数（2026-09-26 历史基线，本轮未复跑）**（`npm run test:perf`，当时本机实测；定位是**趋势与报警器**，不是性能目标）：

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

**主线程响应性读数（2026-09-26 历史基线，本轮未复跑）**（`npx playwright test e2e/main-thread-responsiveness.spec.ts`，输出 `PERF frame-gap`；单独跑 / 整套并行跑各一次）：

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

## 本轮高中几何交互（功能分支，**2026-09-30 已合并进 `main`**；**同日已打出桌面端 MSI / NSIS**）

- **P0 已在功能分支完成**：直接在 3D 画布按步骤作空间点/线段/直线/射线/平面/面；XY/XZ/YZ/选中面工作平面落点、只预览不落盘、Esc 取消/Enter 完成、一笔事务一步撤销；保留原 Shift 多选和 Alt 选子对象路径。
- **P1 已完成**：常用立体参数面板可创建正方体、长方体、三/四棱柱（含斜棱柱）、三/四棱锥；改变参数显示未保存 3D 预览、确认后提交；原快速「添加立方体」新建尺寸更正为 4×4×4。教学线型模块支持独立空间线/棱的实线、虚线和点线，并保留到 `.mgeo`；「隐藏边」是另一套只影响视图的开关。**旧文件尺寸不迁移**。
- **仍未完成**：教师/学生走查（用户侧）；单顶点编辑已定修法（拆三角形）**待实施**。根脚本 `npm run build` 和本地全量 `npm run test:e2e` 已在 2026-10-01 实际跑通；GitHub 最新 CI 仍须核实。旋转环在 v3.0.1 默认关闭，仍需教学样题走查。球体、截图自动绘图、HTML/GGB 导出尚未交付（球体与球截面已决定启动，需另立方案）。逐模块证据见 [高中几何进度](research/2026-09-29-high-school-geometry-interaction-progress.md)、[功能目录](feature-catalog.md) 与 [实施计划](superpowers/plans/2026-09-29-high-school-geometry-interaction-implementation-plan.md)。
- **Task 8 三批已落地并上传**（提交 `cecc1fe`、`0166845`、`1a82c97`）：`e2e/high-school-geometry-tasks.spec.ts` 六类代表题转成可重放操作序列，2026-09-29 的样题 e2e **7/7**；当次 `typecheck` exit 0、`lint` 0 error / 13 warning、全库单测 266 文件 / 3072 项通过 + 1 todo。**2026-10-01 单独补跑根脚本 `npm.cmd run build`，exit 0**（Web、桌面 release exe 和 4 个 packages）。计划 Task 8 第 2 项所列命令已有分次实测，仍不能视为整期验收完成：本地全量 e2e 于 2026-10-01 达到 169/169，教师/学生走查仍未做。
- **Task 8 第 4 项已收口**（提交 `f48d579`）：[功能目录](feature-catalog.md) 新增「本期收口（2026-09-29）：实际已完成 / 未完成」一节 —— 分别列出**已交付**（画布直接绘制 / 常用立体 / 教学线型 / 解析截面读数 / 六类样题可重放验收 / 两处缺陷修复）与**未交付且需要你决定是否启动**（球体与球截面、截图识图、HTML 与 GGB 导出、平面函数逐题补缺、教师走查与完整桌面打包），并写明「都在功能分支、未打包」（**2026-09-30 更正：该分支已通过 PR #1 合并进 `main`，见文末「本轮结束时的交接」**）。
## 二、按评审方案：做到哪一步了

**一句话进度（估计，口径写明）**：**七条方案全部落地并验收**；方案 2 的六个目标文件全部拆分完成（`operations.ts` 也走到 **2817→307**）。剩下的是**可选**项与长尾（`operations.ts` 内仍可细分、`App.tsx` 与 `threeSceneEffect.ts` 内仍可细分）。门禁面已无已知缺口（`e2e/` 与 `scripts/` 都进了 `tsc`）。

| 方案 | 优先级 | 状态 | 一句话 |
| --- | --- | --- | --- |
| 1. 统一实体构造与拓扑物化 | P0 | ✅ **已完成并验收** | 见下节 |
| 2. 拆分过大的编排和领域文件 | P1 | 🔶 **已开四十六批** | `operations.ts` 2817→**307**（→ 十一个模块）、`PropertiesBar.tsx` 1069→298（→`inspectorFields` / `inspectorLabels` / `inspectorReadings` / `inspectorModel`）、`App.tsx` 2000→**809**（→`fileExports` / `documentIds` / `creationCommands` / `solidCommands` / `recordCommands` / `structureCommands` / `anchorRotationCommands` / `point3ToolCommands` / `previewCommands` / `selectionCommands` / `canvasStatusPrompt` / `draftingCommands` / `appViewState` / `useDraftPersistence` / `commandDispatch` / `useKeyboardShortcuts`）、`threeScene.tsx` 1807→269（→`threeSceneEffect` + **七个阶段模块**）、Rust `lib.rs` 992→**168**（→`src/commands/` 五组）、`agent-core/schemas.ts` 1300→**180**（→`schemaReaders` / `actionRegistry` / `hashing` / `actionInputs` / `actionAudit`） |
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

### 实机现场故障（2026-09-26，第四十六批）：一句话连挂两次，两次根因不同

用户在**装好的桌面版**里说"把正方体沿对角面剖开，标出截面"，连着碰到两次失败。两次都不是"模型不听话"，而是**Agent 说的话编译器没接住**；症状完全两样，所以分开记。

**第一次：`compile_failed: target_not_found … no object cube`（随后级联 `no object diagSection`）。**
规划器给的三步是"建正方体 → 建截面 → 标出截面"，但后两步把前一步**刚建出来的对象**写成了场景引用 / 裸名字（`cube`、`diagSection`），而别名表只认显式的 `{scope:"draft", alias}`。判据没有歧义：别名表里只有"这一份计划里、这一步之前"建出来的对象，命中就是那个刚建的对象。修法：`planCompiler.resolveReferences` 的两条分支（裸字符串 / 场景作用域）都先按别名查，查不到才报 `target_not_found`。宽容有边界 —— **编造的 id 仍旧被拒**；**形状错误的引用仍在传输层被拒**（`sourceId` 只收裸 id 字符串，喂对象形状报 `invalid_type` 且路径落在 `envelope.actions[1].inputs.sourceId`），不会拖到引用解析时变成一句"找不到对象"。三条都钉进了 `planCompiler.test.ts`。

**第二次：`commit_rejected: action_compile … section plane is invalid`（随后级联 `no object sec1`）。**
根因是**登记表承诺 ≠ 实现**：`section.create` 的默认问题是"截面用哪个平面？给法向与常数，**或者说明它过哪三个点**"，可 `actionInputs.parseActionInputs` 里**没有 `section.create` 分支** —— `plane` 走默认分支原样透传，"过三个点"那种写法（"沿对角面剖开"最自然的写法）一路走到**文档校验器**才被拒，而且报的是**动作级**路径，那条"一次性修复"够不到字段、改不动它，用户只看到一句"编译失败"。
修法：补 `section.create` 分支 + `normalizeSectionPlane`，把**三种写法收成一种**（单位法向 + 常数）：规范形 `{normal, constant}`（法向非单位向量则归一化，**常数同步缩放** —— 只归一化法向会把平面换掉，在立方体上正好是"切歪"）、**过三点** `{points:[…3]}`（`throughPoints` 也收，叉积求法向）、**点 + 法向** `{point, normal}`（`origin` 也收），坐标 `{x,y,z}` 与 `[x,y,z]` 两种写法都收。失败时错误路径**落在字段上**（`…inputs.plane`），码是 `invalid_plane` / `degenerate_plane`（三点共线），修复请求因此够得到它。同批把 `sourceId` 的判据一并收进这个分支。
**`plane` 缺省仍旧放行**：它登记着 `ask_user`，由审计去问用户（"缺平面 → `questions` 里出现 `envelope.actions[0].inputs.plane`"这条既有用例仍在钉）。在传输层替用户挑一个平面，等于替他改题。

**这两次暴露的是同一类风险**：动作登记表（`actionRegistry`）是"我们承诺收什么"的**唯一**声明处，而逐动作校验（`actionInputs`）里少一个分支，承诺就落空 —— 而且是**静默**落空（透传出去，直到文档校验器才被拒，报的还是够不到的路径）。判据：**登记表里写了 `ask_user` 问题、或写了可选字段的每个动作，都必须在校验层有一个显式分支**；新加一条测试钉住三种平面写法的等价性 + 共线时按字段路径拒绝。



## 三、还没做的（按建议顺序）

1. **方案 2 剩下的**：`App.tsx`（**809 行**，已无"有状态的整块"，剩下的是装配与 JSX）与 `threeSceneEffect.ts`（**489 行**；组件 `threeScene.tsx` **269 行**；已按阶段切出**七块**：`threeSceneCamera.ts`（相机取景）、`threeScenePreviewHover.ts`（预览悬停）、`threeSceneRender.ts`（一帧的绘制 + 两层标签覆盖层 + 曲线容差档位与手柄缩放）、`threeSceneGrid.ts`（网格与坐标轴落位）、`threeSceneContent.ts`（**内容同步**：`keepContent` 增量重建 + 整场 `syncContent` + `refreshPrimitiveObject`，604 行）、`threeSceneInteraction.ts`（指针按下 / 移动 / 抬起、拖拽会话、拾取判定 481 行）、`threeSceneDragVisuals.ts`（**拖动期间的画面**：半径预览 / 手柄落位 / 场景重建后补画），手法是"依赖对象 + 原文搬"；跨阶段的 `let` 一律改成稳定容器（`copy` / `clear` / 就地 push）），评审 md 点名的六个文件**全部拆完**（`agent-core/src/schemas.ts` 也已 1300→**180**）—— **Rust 侧已完成**：`lib.rs` 992→**168 行**（只剩模块声明、两个托管状态、`run()` 与命令清单），其余全部搬进 `src/commands/` 六组：proxy / secrets / conversations / repository（项目仓储 + 附件 + 运行账本，因碰同一份托管状态合成一个文件）/ providers。
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
- **`scripts/` 下的测试已纳入 `tsc`**（2026-09-25 补）：新增 `scripts/tsconfig.json` 与一份**最小的 node 类型声明**（`scripts/nodeTypes.d.ts`，只声明脚本真的用到的 `spawn` / `once` / `mkdtemp` 等）—— 与 `e2e/` 同一套做法，同样**刻意不装 `@types/node`**（它会全局引入并改变应用侧 `setTimeout` 的类型）。根 `typecheck` 现在末尾跑三段：workspaces + `e2e/tsconfig.json` + `scripts/tsconfig.json`。

- **几何 Worker 已接线，但"值不值"这条结论仍是**依据本轮读数**得出的**（编译 73 ms vs 复制 1 ms，约 76 倍）；**不是"管线全同步"** —— 那个判断此前记错了，已更正。降级路径（没有 `Worker` 的环境就地算）有独立用例，见方案 3 一节。
- **性能上的一件事还没做**：把 `applyOperation` 每次从整份文档 `structuredClone` 的成本降下来。基准显示这一档**固定成本压过增量收益**（局部重算比全量还慢）。注意这与方案 3 不是同一件事：编译那 73 ms 花在**算**上（复制只占 1 ms），所以 Worker 对它是有效杠杆；而重算那一档的固定成本才是复制。
- **主 bundle 仍超 500 kB 警告**：入口 1 614 kB 里是应用代码 ≈855 kB + React 221 kB + Three 530 kB。`three` 仍在入口 —— 立体几何是首屏可达的顶级模块，拆它要连带改 `threeScene.tsx` 的装配方式。
- **`npm run test:rust` 已复跑**（2026-09-25）：**232 例通过 + 3 ignored / 0 失败** —— Rust 侧本阶段零改动，复跑是为了量它、并查清首次 CI 里 rust 作业为什么红（见下一条）。
- **确认面板不按属主实体归并子对象**：用户要"一个立方体"，面板会说"会新增 28 个对象"。计数本身没错（28 个对象确实都会进文档），但"要不要按实体归并着说"是产品判断 —— 与方案 1 里"对象树以拓扑为依据"是同一个问题的另一面。**连带影响**：`agent-flow.spec.ts` 里有两条用例还在按"一个立方体 = 一个对象"断言（`共 2 个` / `会新增 1 个对象`），方案 1 之后它们必然为红 —— 已改成断言**不会随计数口径漂移**的性质（"共 N 个"必须大于"本次新增"，即草稿落在已有内容之上），同批 e2e 里 `solid-prism` / `agent-oblique-prism` 一直是按新口径断言的。
- **`longtask` API 在本机不可用（实测，不是猜的）**：评审方案 7 点名要的 `PerformanceObserver({ type: "longtask" })` 在**空白页**上、对一次**故意阻塞 200 ms** 的主线程占用，`observed` 与 `performance.getEntriesByType("longtask")` **都是空的**，而 `supportedEntryTypes` 里**确实**列着 `longtask`（Chromium 153 / Playwright headless）—— 即"声称支持、什么也不报"（一次性探针复核过，用完即删）。所以主线程读数改用**帧间隔**（`requestAnimationFrame` 间隔）实现：同一个 200 ms 阻塞必定表现为 ≥200 ms 的空档，量具灵敏度可以自证（用例里就有这条标定断言）。见 `e2e/main-thread-responsiveness.spec.ts`。
- **`section.create` 的平面已收口，但"登记表承诺 ≠ 校验层实现"这类风险只是**被识别出来**，没有机器挡住**（2026-09-26，见 §二「实机现场故障」）：`actionRegistry` 是"我们承诺收什么"的唯一声明处，而 `actionInputs` 里**少一个分支就静默落空** —— 字段会原样透传，直到文档校验器才被拒，报的还是够不到的**动作级**路径（那条一次性修复因此改不动它）。这一批把 `section.create` 补上了（三种平面写法收成一种，且共线时按**字段路径**拒绝），并留了判据："登记表里写了 `ask_user` 问题、或写了可选字段的每个动作都必须在校验层有显式分支"。**但这条判据目前只写在文档里**，没有一个测试逐动作核对登记表与 `parseActionInputs` 的分支覆盖面 —— 下一个新动作照样可能漏。
- **平面写法上刻意只收三种**：规范形 `{normal, constant}`、过三点 `{points|throughPoints: […3]}`、点 + 法向 `{point|origin, normal}`（坐标 `{x,y,z}` / `[x,y,z]` 都收）。**不做**的：用两个方向向量定平面、用字符串别名指代平面（`"diagonal"`）、用曲面/多边形顶点集反推 —— 遇到这些会如实按 `invalid_plane` 拒绝并给出字段路径，而不是猜。
- **（已闭环，留档；不再是缺口）本轮查实并修掉两处真缺陷** —— 2026-09-29：① **恢复草稿后第一次改动不落盘**（会丢用户数据；提交 `4968051`）—— 根因是 `useDraftPersistence.ts` 里 `skipNextDraftSaveRef` 与 `restoreSettledRef` 的判断顺序赛跑（skip 被用户恢复后的第一次改动吃掉），修法是先消费 skip 再判 settled、两条原有守卫都不变松；回归钉在浏览器侧（修复前红 Expected 112 / Received 84、修复后绿），单测那 9 条钉语义、前后都绿。② **「距离」测量在"平面先选"时只得到无效读数**（提交 `e25cacb`）—— 根因是内核 distance 分支固定按 `sourceIds[0]` 是点取数（`pointFromPrimitive` 对 `plane3` 返回 `null`），修法是把"点那一侧"换到前面、`measurement.sourceIds` 仍记用户的选择顺序；回归在内核（`measurements3d.test.ts`，修复前红）与浏览器（两种顺序都量出 3.000u）两侧都有。详见 `CHANGELOG.md` 同日两节。
- **（已闭环，留档；此前那条"锁定不被吸附未实现"的记录是错的）「隐藏或锁定对象不被当作可吸附目标」两半现在都成立** —— 2026-09-29 复核更正。**更正的原因是我在错的层次上核对**：当时只看了纯函数 `resolveSpatialAnchor`（它只按命中物回答、**不认识文档**，所以不可能知道 `locked`），没看真正的过滤点 —— `threeSceneEffect.ts` 的 `resolveCreationAt` 里 `primitive.visible === false || primitive.locked || （生成的 point3）` 一律丢弃命中。**隐藏**那一半是构造性的（`threeSceneContent.ts` 先 `filter(isUserVisiblePrimitive)` 再建对象，隐藏图元根本不进场景），**锁定**那一半由上面那道门禁负责：锁定对象仍看得见、仍能选中，但创建时不再被吸附（退回工作平面）。证据是一条自带对照的 e2e（`e2e/geometry3d-creation.spec.ts`）：同一屏幕坐标，未锁定读"已有点 (0.00, 0.00, 0.00)"、锁定后读"工作平面 XY (…)"、解锁后又读回"已有点"；定向变异（摘掉 `primitive?.locked`）当场红。顺带澄清一处容易混的地方：`primitiveVisibility.ts` 的 `isUserVisiblePrimitive` 确实**不看** `locked` —— 那是**渲染可见性**判据，锁定不改变可见性，这正是我们要的语义；吸附门禁在创建拾取那一层，两件事不在一个函数里。
- **"改不动一个顶点"的真根因：面必须共面（2026-09-29 复核更正，尚未修）** —— 计划 Task 6 里"移动顶点"那一半因此**没有落地**。
  - **更正**：此前这里记的是"属性栏改棱柱顶点坐标被**静默丢弃**、无任何提示"。走 UI 的真实路径复核后，那条**不准确**：`commitPatch`（`store.apply` 调的就是它）返回 `changed=false` + `error = "the change would make the document invalid: face3 points are not coplanar…"`，浏览器实测输入框弹回原值的同时**页面确实弹出了 `role="alert"`**，文案就是这一句（用一次性探针实测，探针已删）。
  - **根因**：棱柱（与模板实体一样）的侧面是**四边形**；改一个顶点会让相邻三个面立刻不共面，而文档校验器要求 `face3` 的点共面 → **校验层**把整笔退回。存储层本身是支持这件事的（`apply.ts` 会把描述翻成 `fromFaces` 再写顶点），但它先过不了校验层 —— 所以"存储层能改"不等于"属性栏能改"。
  - **另一条现象很可能是同一根因**：拖顶点手柄之后按 Ctrl+Z 被拒，报的是**同一条** `face3 points are not coplanar`。**推断**（未逐条验证）：那次拖动本身被拒、没有留下历史，于是 Ctrl+Z 撤掉的是上一步"创建棱柱"，画面因此变空、`data-content-bounds` 读出 NaN。
  - **真正缺的是"一条能改单顶点的路径"**：**用户已决定修法 —— 把受影响的面拆成三角形**（保持 `face3` 共面校验严格不变），待排期实施；"放宽共面要求"这条未被采纳（会让"面"的概念变松，求交/截面都要处理非平面多边形）。
  - 证据：`packages/scene-graph/src/scene-store.test.ts` 的表征用例钉住"被拒 + 明确原因 + 文档未变"（`changed=false`、`error` 含该文案、顶点未动）；探测过程见 [`2026-09-29-high-school-geometry-interaction-progress.md`](research/2026-09-29-high-school-geometry-interaction-progress.md)。
- **实体源的测量在画布上没有数字（2026-09-29 查实，尚未修）**：`measurementVisuals.ts` 的 `pointPositions` 没有 `polyhedron3` 分支（只认点 / 线 / 段 / 棱 / 射线 / 面 / 平面 / 模板实体），于是 `resolveMeasurementVisual` 对"实体体积"这类测量返回 `null`，**画布上不画数字**，只能去属性栏的测量卡片读。用户口径本来是"测量结果要在图中浮现一个数字"（见 `measurementVisuals.ts` 顶部注释），所以这一条是**与口径不符的缺口**；修法：给 `polyhedron3` 补一个标签落点（例如拓扑顶点均值或包围盒中心）。
- **指针抬起前最后一次相机移动不触发渲染（2026-09-29 查实，尚未修）**：拖动结束后，画面（含 `.three-point-label` 标签）停在**上一帧**的相机状态上，与 `data-camera-azimuth` 等读数所表示的当前相机差约 **30px**，而且**不会自行收敛** —— 实测轮询 5 秒仍不齐，要等下一次交互（再动一下指针）才追平。影响：快速拖动并松手后，画面会比手停的位置差一点，动一下鼠标才对齐。证据：`e2e/geometry3d-teaching-lines.spec.ts` 的标签用例就是这条的现场（用例在拖动后再抖 2px 强制重画一帧，才断言"已对齐的最终状态"；抖动前后同一条断言一个红一个绿）。修法方向：`threeSceneEffect` 里指针抬起（`pointerup`）时补一次 `render()`，或让相机更新统一排进 rAF 后必渲染。
- **引用进度档案一律用小节标题，不写行号**：`project-progress.md:<行号>` 形式的引用会随任何一次编辑静默失效（本阶段就发生过三处，已全部改成按标题引用）。

## 四、未完成任务总清单（2026-10-01 更新；本文件是"还差什么"的**唯一**权威处）

> 口径：只有**当次真正跑过**的才写进「一、现在能不能跑」；这里列的是**还没做/还没跑**的事。
> 分五类，A 类是实施计划里仍未勾选的条目，B/C/D 类是计划外但已查实或已知未做的，E 类需要你决定是否启动。

**A. 实施计划内仍未勾选（2 项，逐条对应计划里的 `- [ ]`）**

1. **Task 6 的「移动顶点」/ 单顶点编辑**（计划里**唯一**还差的代码侧功能项）：棱柱与模板实体的侧面是四边形，改一个顶点会让相邻三个面不共面，被文档校验器的 `face3` 共面要求**整笔退回**（界面会弹 `role="alert"` 并弹回原值）。**用户已定修法：把受影响的面拆成三角形**（保持共面校验严格不变）—— **待实施**。详见下方「如实缺口」第一条。
2. **Task 8 第 3 项教师/学生走查**（主操作数 ≤8、不必按 Shift、误操作与恢复路径）：**用户侧**，未做。

**B. 计划外、已查实但未修的缺口（2 项，下方「如实缺口」有代码位置与修法方向）**

1. **实体源（体积等）的测量在画布上没有数字** —— `measurementVisuals.ts` 的 `pointPositions` 缺 `polyhedron3` 分支，只能去属性栏读；与"测量结果要在图中浮现一个数字"的口径不符。
2. **指针抬起前最后一次相机移动不触发渲染** —— 拖动松手后画面与标签停在上一帧（与相机读数差约 **30px**），**不自行收敛**，要再动一下指针才追平。

**已从待办移除（2026-10-01）**：根脚本 `npm.cmd run build` 已 exit 0；三色旋转环在 v3.0.1 默认关闭并有定向 e2e。教师场景目视检查仍归 A 类走查，不视为已做。
**C. 未复跑的门禁（2 条；本地全量 e2e 169/169 读数见第一节，GitHub CI 待核）**

1. `npm run test:perf`（本机性能读数仍是 2026-09-26 的历史基线；GitHub CI 的 checks 另有性能趋势读数）。
2. `npm run test:rust`（本机未复跑；GitHub 最近多次 CI 的 rust 作业均成功，不能代替本机读数）。

**D. 发布与仓库收尾（3 项）**

1. 桌面产物**没有**推到 GitHub Release（产物在 git 忽略的 `target/` 下）。
2. **没有**在本机安装 MSI/NSIS（"打包成功"≠"装过"）。
3. 远端分支 `origin/feat/high-school-geometry-interaction`（已通过 PR #1 合并）**仍存在、未删除**；其 tip 的文档是**过时版本**（写着"未合并 `main`/未打包"）。**待你决定是否删除。**

**E. 已决定或待决定、尚未启动（4 项）**

1. **球体与球截面**（P2，独立评审）：用户**已决定启动** —— 按实施计划"不在此计划内"一节，需先设计 `sphere` 文档类型、构造/截交/投影与退化语义，**另立方案与实施计划**后再动代码。现有的"外接球/内切球读数"不是可编辑球图元。
2. **题目截图 → 可编辑数学图**（独立探索）：**未启动**，需要单列质量门禁（样题集、歧义标注、真实 provider 结果、草稿确认）。
3. **HTML / GeoGebra 导出**：**未启动**（已交付的导出是 `.mgeo` / SVG / CSV / PNG 与工程图 SVG/DXF/PDF）。
4. **平面 / 函数题型逐题补缺**：**未排期**（需先做教师样题盘点）。

**历史痕迹（不是待办，留档以免误读）**：本轮共 9 次提交推送到功能分支，随后该分支通过 **PR #1** 合并进 `main`（合并提交 `3b1f770`，2026-09-30 12:46:30；父提交 `4d35b9d` + `e016f37`，两者都用 `git merge-base --is-ancestor` 核实过）。本地 `main` 已于 2026-09-30 由 `4d35b9d` 快进到 `origin/main` 的 `0d22ab4`（当时落后 53 个提交），并在其上重做了文档普查（`a22dba9`、`1676452`）。


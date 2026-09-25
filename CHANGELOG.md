# 变更记录

> **这份文件记"改了什么"，不记"现在什么样"，也不记"当时怎么想的"。**
> - **当前状态**（门禁读数、做到哪一步、还差什么）看 [`docs/current-status.md`](docs/current-status.md) —— 那是"现在时"的**唯一**一处；
> - **过程与证据**（每一轮的 RED→GREEN、被推翻的判断、实测读数、误报清单）看 [`docs/project-progress.md`](docs/project-progress.md) —— 那是**归档**；
> - **架构与能力清单**看 [`docs/feature-catalog.md`](docs/feature-catalog.md)。

## 2026-09-25（续）—— 方案 2 第三十一批：Rust `lib.rs` 992→912，代理与密钥两组搬进 `src/commands/`

## 2026-09-25（续）—— 方案 2 第三十二批：Rust `lib.rs` 912→447，四组命令全部搬进 `src/commands/`

## 2026-09-25（续）—— 方案 2 第三十三批：Rust `lib.rs` 447→168 —— 拆分完成

## 2026-09-25（续）—— 方案 2 第三十四批：`agent-core/schemas.ts` 1300→560（切出三块）

## 2026-09-25（续）—— 方案 2 第三十五批：`schemas.ts` 560→180 —— 解析层切开，评审点名的六个文件全部拆完

## 2026-09-25（续）—— 方案 2 第三十六批：`operations.ts` 2670→2430（删除级联与种类判据）

## 2026-09-25（续）—— 方案 2 第三十七批：`operations.ts` 2430→2211（依赖图与绕定点旋转的喂料层）

## 2026-09-25（续）—— 方案 2 第三十八批：`operations.ts` 2211→1961（路径查询 + 解析类图元的重算）

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

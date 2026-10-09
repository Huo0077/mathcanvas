# 变更记录

> **这份文件记"改了什么"，不记"现在什么样"，也不记"当时怎么想的"。**
> - **当前状态**（门禁读数、做到哪一步、还差什么）看 [`docs/current-status.md`](docs/current-status.md) —— 那是"现在时"的**唯一**一处；
> - **过程与证据**（每一轮的 RED→GREEN、被推翻的判断、实测读数、误报清单）看 [`docs/project-progress.md`](docs/project-progress.md) —— 那是**归档**；
> - **架构与能力清单**看 [`docs/feature-catalog.md`](docs/feature-catalog.md)。



## 2026-10-10 —— V2 GREEN ③ 第二半：web 侧接线（桌面通道 + **不可信 IPC 回包**的逐字段校验）；**仍然只差一个调用点**

**这一块加 `apps/web/src/agent/desktopProofChannel.ts`**：把库里的端口接到桌面命令上。**如实说清：接线有了，但**没有任何产品流程在跑完作图之后调用它** —— 缺口③还差最后那一步（一个调用点）。**

**三条边界**：① **浏览器里不是错误，是一种状态** —— 没有 `__TAURI_INTERNALS__` 就是浏览器，通道返回 `unavailable` + 一句人能读的理由（"形式证明后端需要桌面外壳，作图不受影响"），**不抛、不假装**；② **IPC 回来的东西是不可信输入** —— `check_lean_proof` 的返回值**逐字段校验**（`outcome` 必须在四个词里、`exitCode` 是数字或 `null`、`stdout`/`stderr` 是字符串、`durationMs` 是有限数字），形状不对一律 `failed` + 指明**是哪一栏**不对，**绝不允许畸形回包变成"验证通过"**；③ **命令名与参数逐字固定**（`check_lean_proof` + `{ source, timeoutMs }`）：不接受可执行文件路径、不接受 shell 文本 —— 跑什么由桌面侧的**环境变量**决定。

**一处容易混的分流**：外壳在、但这一趟 IPC 抛了 ⇒ 那是 `failed`（"没调到"），**不是** `unavailable`（"这台机器上没配"）。两件事对用户意义不同（前者可能是 bug，后者是环境）。

**判据（7 条，`desktopProofChannel.test.ts`，注入 `__TAURI_INTERNALS__` 造出两种环境）**：浏览器里如实报不可用且**一个 IPC 都不发**；桌面里命令名与参数逐字固定、送出去的是**模板生成的源码**；**9 种畸形回包逐个按失败处理**（`undefined` / `null` / 数字 / 字符串 / 数组 / 缺字段 / `exitCode` 是字符串 / `stdout` 是数字 / `durationMs` 是字符串）；形状对的回包**逐字段原样交回**（判据那层要看 `#print axioms` 原文）；IPC 抛 ⇒ `rejected` 状态照旧；桌面回包说"没配" ⇒ 如实照抄那句话。

**门禁**：`typecheck` exit 0（**它又抓到一条 vitest 看不见的错**：测试常量里 `planeLines` 写成数组而非元组 ⇒ TS2345 —— 与上一块同型，说明"跑过测试"确实不等于"过了类型门"）；`lint` 0 error / 13 warning（基线）；targeted 7 passed；全库非 Lean **341 文件 / 4020 通过 + 1 todo / 0 失败 / exit 0**（519.39 s；比上一读数 **+1 文件 / +8 通过**，其中 7 条是本块新增，另 1 条是上一轮那条既有抖动这次没再现）；全量 e2e **217 通过 / 1 failed** —— 那条红是**既有抖动** `main-thread-responsiveness.spec.ts:108`（帧间隔阈值 `toBeLessThan(250)` 被负载顶破），**孤立复跑两次均 1 passed / 23.9 s**，与本块无关（本块只新增了一个**没有别处 import** 的 web 模块）。

## 2026-10-10 —— V2 GREEN ③ 第一半：库里的**自动调用与产物通道**（通道端口 + 编排 + 判据）；产品路径**仍未接**

**这一块加一个新模块**（`packages/agent-core/src/proof/automaticProof.ts`），把已有的三块接成一条链：**题设 → 前提桥 → 适配器（生成命题 / 跑 / 判公理 / 造产物 / 过校验器）→ 证据状态**。**如实说清：这是缺口③的**第一半** —— 库里有一条会去调 Lean 的路了，但**还没有任何产品代码调用它**。**

**顺序是刻意的：先问该不该跑，再看跑出来什么。** 四道门任何一道不过，通道**一次都不会被调用**（不是"先花三分钟再说不行"）：① 旗关着（`proofExport` 默认关）⇒ `flag_off`；② 后端没给正文 ⇒ `no_proof_body`；③ 目标类不在适配器覆盖范围 ⇒ `goal_unsupported`；④ **前提桥说有一条前提指不出出处 ⇒ `premises_unresolved`**（拒绝理由点名那条凭空编的前提）。

**通道是端口，不是实现**：`ProofChannel` 是注入的（桌面壳里是 Tauri 命令 `check_lean_proof`；浏览器里是 `unavailableProofChannel(理由)` ⇒ 如实报"这台机器上没法跑"）。`channelAsRunner` 把通道翻译成适配器要的 `Lean4Runner`；通道的 `failed`（起不来）**会把说明放进 `stderr`** —— 否则人只会看到一句"退出码 null"却不知道为什么。**结局词表封闭**：`flag_off / no_proof_body / goal_unsupported / premises_unresolved / toolchain_unavailable / timeout / rejected / verified / internal_error`。

**三条边界写在模块头**：① **不判定**（成没成只由公理白名单说）；② **不猜前提**；③ **不阻塞作图**（这个函数**不抛**，最坏情况是 `internal_error` + 状态原样返回 —— 通道抛、模板抛都被接住）。

**顺带核实并钉住一条上游性质（很要紧）**：解析层**会跳过"求证"从句** —— 实测 `求证 PA ⊥ 平面 ABC` ⇒ **0 条给定**，而 `已知 PA ⊥ 平面 ABC，求证 PA ⊥ BC` ⇒ 给定里**有** `PA ⊥ 平面 ABC`。少了这条性质，前提桥会**拿目标的结论当自己的前提**（循环证明），而那是静默的。这条已写成用例里的一个断言（`expect(obligations.givens).toEqual([])`）。

**判据（11 条，`automaticProof.test.ts`，全部用假通道 —— CI 上没有 Lean）**：旗关着/没正文/前提指不出出处/表外目标类 ⇒ **通道一次都没被调用**；送进通道的源码**确实是模板生成的那种**（生成标记 + 唯一允许的 import + 白名单定理名 + 正文原样照抄）；真报告 ⇒ `formally_proved` 且产物 `claimId` 对得上、**过了校验器**；`sorry` 的报告 ⇒ 停在原地；工具链没配 ⇒ `toolchain_unavailable`；超时 ⇒ `timeout`；通道自己抛 ⇒ `internal_error` 且状态照旧。

**门禁**：`packages/agent-core/src/proof` **8 文件 / 136 通过**（比上一读数 +11 = 这个新模块的用例）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；全库非 Lean **340 文件 / 4012 通过 + 1 todo / 1 failed**（521.03 s）——**那一条红是既有抖动**：`apps/web/src/persistence/fileExports.test.ts:189`（CAD 导出用例）报 `Test timed out in 5000ms`，**孤立复跑两次全过**（各 9 passed，用例本身 843 ms）——本仓 `current-status` 早已记过这条抖动（单跑三次全过、约 0.69 s），**不是本块引入的回归**；全量 e2e 见下一条读数。

**仍未做（缺口的另一半）**：**没有任何产品路径调用它** —— 桌面壳里跑完一次作图之后"对可证明的 claim 调一次"这件事没做，`proofLevelStatus.ts` 里那条"默认路径不调用它"**今天仍然成立**。

## 2026-10-10 —— V2 GREEN ④：桌面上有了一条**窄的**证明运行命令（Rust 侧第一次有 proof 入口）

**这一块改 Rust**（`apps/desktop/src-tauri/`），把 V2 GREEN 缺口④从"Rust 侧一个 proof / lean 命令都没有"变成"有一条**受限的**命令"。**它不接产品路径**（那是缺口③，仍未做）。

**为什么这条命令必须窄**（这是本块的设计核心）：Lean 不是计算器 —— `#eval`、`IO.Process.run`、`@[extern]` 都能让它去干编译之外的事，所以"把一段文本交给编译器执行"本身就是一个**代码执行面**。做法是三条：

1. **只接受我们自己模板生成的那种文件**（`proof/source.rs` 的 `inspect_template_source`，**在起进程之前**跑）：必须带生成标记、恰好一条允许的 `import`、一条有上限的 `set_option maxHeartbeats`（≤ 4_000_000）、一条针对**白名单定理名**（`draw_perpendicular_goal` / `draw_line_plane_perpendicular_goal`）的 `#print axioms`；并且**一个字都不许出现**能执行代码 / 反射 / 扩语法的关键字（`#eval` / `IO.` / `System.` / `unsafe` / `extern` / `run_cmd` / `elab` / `macro` / `syntax` / `initialize` / `include` 等 15 个）。**形状不对 ⇒ 不执行任何东西**（有一条用例专门钉这个：给一个绝不存在的 lake 路径，结果仍是"没有执行任何东西"）。
2. **工具链是"配上去的"，不是"从 PATH 里捡来的"**：只认 `DRAW_LEAN_LAKE` / `DRAW_LEAN_PROJECT` 两个环境变量。**刻意不做 PATH 搜索** —— 从 PATH 捡一个叫 `lake` 的东西，等于让任何能改 PATH 的人决定我们执行什么。没配置 ⇒ `unavailable`（**不是**"证不出来"），理由点名缺哪一个。
3. **固定 argv + 两层上限**：`lake env lean <临时文件>`（没有 shell、没有可拼接参数）、墙钟超时（默认 180 s，前端给的值再夹到 10 分钟）、输出只留尾部 4 KB（并把 UTF-8 切边修好）。

**这一层不做判定**：它只回答"进程怎么结束的"（`exited` / `failed` / `timeout` / `unavailable` + `exit_code` + stdout/stderr）。**"这条证明算不算成立"仍只在 TS 侧判定**（`checkAxiomsReport` 的公理白名单）—— 判据只有一处，Rust 不复制一份。所以这里**没有 `verified` 这个词**：`exit=0` 连 `sorry` 都满足。

**命令与治理**：`check_lean_proof`（跑一次）与 `lean_proof_availability`（只回答"这台机器配没配"）。两个名字都**逐字写进** `tests/shell_smoke.rs` 的 `named` 清单（那份清单要守的就是"新增命令必须在那里写下名字"这条摩擦），并注册进唯一的 `generate_handler!`。两条都**不接受可执行文件路径、不接受 shell 文本**——跑什么由环境变量决定，不由请求决定。为 `tokio` 加了 `process` feature（同一个 crate，没有新增依赖）。

**门禁（Rust 侧）**：`npm run test:rust` ⇒ **247 passed / 0 failed / 3 ignored**，其中 `tests/proof_command.rs` 新增 **9 条**（接受模板形状；逐个拒 8 个逃逸关键字；拒"不是我们的模板"的四种写法（没有标记 / 换宽 import / 两条 import / 多一条 set_option）；**拒针对别的定理的 `#print axioms` 与干脆删掉报告**；拒把预算写成摆设的 `maxHeartbeats`；拒超大文件；工具链"配置而非发现"的四条分支；`tail_of` 不切坏 UTF-8；**形状不过的文件一个字都不执行**）。**本块没有改任何 TS 文件**（只有 Rust 与文档），所以 TS 那几条门禁（typecheck / lint / 非 Lean 全库 / e2e）**不重跑**，沿用同日上一条读数。**如实留着的**：**真去起 `lake env lean` 的那条路，本块没有在测试里跑过**（要配上两个环境变量；而且冷缓存第一次会撞超时）—— 交付/打包里怎么带 Lean 与 mathlib（7.5 GB、许可证、发行环境）属于"默认启用前"那批审查，**未决**。

## 2026-10-10 —— V2 GREEN ② 第二刀：**前提桥**（每条前提指得出出处，凭空编的前提直接失败）

**这一块加一个新模块**（`packages/agent-core/src/proof/proofPremiseBridge.ts`），把 adapter 文件头一直写着的那条诚实边界（"模板里的前提是模板给的"）变成**机器可查**的东西。

**四类来源，逐条标**：① **`fromText`** —— 这条前提**就是题面里的哪一句**（带 `sourceText`，能指给用户看）；② **`fromDerivation`** —— 题面没直接说，但**一步定理**接得出来（今天只有"线 ⊥ 面 ⇒ 它 ⊥ 平面内任意一条线"这一条路，**那一步要点名**，与 `pythagorean` 的纪律一致：推断必须出现在证明里、不许别名掉）；③ **`fromFigure`** —— 题面没说、由**图形构造**蕴含（"B、D 都是底面上的顶点" ⇒ "BD 落在底面内"），**必须列出来**，因为它确实是系统补的；④ **`invented`** —— 既不在题面、也不由图形蕴含 ⇒ **凭空加前提**。

**fail-closed 的那一条**：**只要有 `invented`，`ok` 就是 `false`，不许生成命题**。它与"证不出来"是两件不同的事：那是 Lean 跑完的结论，这里说的是**连命题都还没资格生成**。

**判据（7 条，`proofPremiseBridge.test.ts`）**：两条前提逐字来自题面并指得出原句；性质定理那条路里"目标线落在平面内"如实标成 `fromFigure`；**题面没给垂直 ⇒ 桥失败**（`invented` 里就是那条被模板塞过的前提）；**「面⊥面」不许被当成「线⊥面」这条前提**（与上一块的目标消解同一口径）；**「线⊥面」那一步不能乱用**（平面里没有的那条线接不出来）；题面两条垂直**没有共享端点**时，第二条不能当判定定理的前提（`PB ⊥ BC` 不是 `PA ⊥ BC`）。

**如实说清两件事**：① **这不是"原题前提桥已完成"** —— 它做的是**把前提分类并 fail-closed**，原题其余题设（底面形状、P 在平面外…）**仍然不进命题**；② 过程中有**两条用例的期望是我自己写错的**（标签按目标/题面的点名渲染，我按另一个点名写了），实现是对的，期望当场改成正确的读法 —— 记在这里，免得被读成"实现改过判据"。

**门禁**：`packages/agent-core/src/proof` **7 文件 / 125 通过**（比上一读数 +7 = 这 7 条新用例）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；全库非 Lean 与全量 e2e 见下一条读数。**变异**：把 `ok` 写死 `true`（fail-open）⇒ 三条用例红；去掉"那条线得真在那个平面里"的判断 ⇒ DE 那条用例红（详见 [进度归档](docs/project-progress.md)）。

## 2026-10-10 —— V2 GREEN ② 第一刀：按**点名形状**消解目标；修掉「面⊥面被当成线⊥面」这个真错配（并把上一块的类**改名**）

**这一块改代码 + 改一处（错的）语义映射**：第二份计划 V2 GREEN 的缺口②（前提消解）的第一刀。**只做了"题设 → 目标"这一步，原题前提桥仍未做**。

**查实的错配（这是本块最要紧的一条）**：解析层 `diagramObligations.ts` 里 ① `perpendicular` 这**一个**题设种类承载**两种**题设 —— 「线⊥线」（点名 = 2+2）与「线⊥面」（点名 = 2+3..6），读的是同一批正则；② `parallel` 同样承载「线∥线」与「线∥面」；③ `planePerpendicular` 是**面⊥面**（`diagramVerification.ts:436` 比的是**两个法向量**）。
而证明目标词表里那条写着"线垂直于平面"的目标**原来叫 `planePerpendicular`**，并且把解析层的 `planePerpendicular` 声明成了它的载体 —— **那是错的**：一条"平面⊥平面"的题设会被读成"线⊥面"这个目标，拿它去配模板就会**证一条别的命题**。今天没有产品路径去自动调用（缺口③），所以一直没被触发；**但缺口③一旦接上，第一步就会踩到它**。RED 用例把这条错配当场钉了下来（`expected { goal: 'planePerpendicular', … } to be null`）。

**改法（四条）**：① 目标**改名** `planePerpendicular` → `linePlanePerpendicular`（解析层那个 kind 不动，它叫得没错）；② **去掉那条错的载体声明**：面⊥面今天**没有**证明目标，如实返回 `null`；③ 新增 **`declaredProofGoalForObligation({ kind, targets })`** —— 按**点名个数**分流（4 = 线与线，≥5 = 线与面），与 `diagramVerification` 里 `planeCount = vertices.length - 2` 那套判法**同一口径**、不是新发明；读不出模板的读法（线∥面、面⊥面、点名个数不对）**一律 `null`**；④ 只给 kind 时，`declaredProofGoal` 在 **`ambiguous`** 那一栏如实标 `true`（`perpendicular` / `parallel`），**不静默按一种读法下结论**。

**连带改名（同一提交）**：上一块（`03a7a87`）加的 Lean 目标类跟着改名 —— `goalKind: "linePlanePerpendicular"`、输入字段 `linePlanePerpendicular`、定理名 `draw_line_plane_perpendicular_goal`、`buildLinePlanePerpendicularStatement`。**改名后真跑复验**：`status=formally_proved` / `judgement=verified` / `exit=0` / **68321 ms**（改名前的读数是 68392 ms，同一量级）。**理由写在校验点**：名不副实会直接变成"证错命题"，所以名字必须跟着语义走。

**RED → GREEN**：`proofGoals.test.ts` 新增一组 5 条（面⊥面不许被当成线⊥面、4 vs ≥5 两种读法、线∥面如实 null、只有 kind 时要标歧义、消解出的目标真在词表里）—— RED 时 **5 failed**（含那条真错配），实现后全绿；`packages/agent-core/src/proof` 六个文件 **118 passed**。

**门禁**：`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`proof:smoke` **8/8**、`PROOF_BACKENDS {"wired":["lean4"],"reviewed":1}`；全库非 Lean 见下一条读数；全量 e2e 见下一条。**变异**：把错的载体加回去 ⇒ 错配那条红；让形状入口不看点名个数 ⇒ 两种读法那两条红；把 `ambiguous` 恒为 `false` ⇒ 歧义那条红（详见 [进度归档](docs/project-progress.md)）。

## 2026-10-10 —— V2 GREEN 第一刀：证明出口从**一类**加到**两类**（判定定理在本机真跑通过）

**这一块改代码**：第二份计划 V2 GREEN 的缺口①（"逐类可信翻译只到一类"）的第一刀。**只补一类，缺口①仍未补完**。
> **⚠️ 本块里的那个类名当天就改了**：`planePerpendicular` → `linePlanePerpendicular`（原因见上一条：解析层同名 kind 指的是面⊥面），定理名也随之改为 `draw_line_plane_perpendicular_goal`。**下面这段正文保留当时的名字，是历史记录。**

**加了什么**：`planePerpendicular`（`packages/agent-core/src/proof/lean4Adapter.ts`）—— **判定定理**那一半："线 ⊥ 平面内两条**相交**直线 ⇒ 线 ⊥ 该平面"。它与原有那一类是**方向相反的两个定理**：`perpendicular` 是**性质定理**（已知 ⊥ 面 ⇒ ⊥ 面内任意线，前提 `hu` 是模板塞的），新类是**判定定理**（前提是两个内积为 0，**正好就是题面里那两条垂直**）。生成的命题形状：

```lean
theorem draw_plane_perpendicular_goal {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]
    (P A B C : E) (h1 : inner ℝ (A - P) (B - A) = 0) (h2 : inner ℝ (A - P) (C - A) = 0) :
    (A - P) ∈ (Submodule.span ℝ ({B - A, C - A} : Set E))ᗮ
```

**实测（本机真跑，不是判据层的假 runner）**：`scripts/proof-spike/lean4EndToEnd.test.ts` 新增一条 gated 用例 —— **`status=formally_proved` / `judgement=verified` / `exit=0` / 68392 ms / axioms `["propext","Classical.choice","Quot.sound"]`**；同一条命题也写进仓内对照文件 `proof/lean4/DrawProof.lean`（`lake env lean DrawProof.lean` exit 0，报告逐字同形）。**证明正文不是猜的**：`induction hy using Submodule.span_induction` 必须**显式给 motive**（`refine … ?_ ?_ ?_ ?_` 会让 Lean 把目标猜成 `∀ x ∈ ?m, …`，实测 Type mismatch），且这个 mathlib revision 的 `p` 作用在**成员证明**上 —— 这两条是内核逼出来的，记在文件与用例注释里。

**三条判据（新增 7 条单元用例，`lean4Adapter.test.ts` 42 → 49）**：① **两类用两个不同的定理名**，否则一份 `#print axioms` 报告能让另一类升到 `formally_proved`（"报告是另一类的 ⇒ 拒"有用例）；② **"相交"必须是输入给的**：两条平面线不共点（平行/异面）或共点两个（同一条线写两遍）⇒ **抛**，不猜一个平面出来；③ 命题形状逐字钉住（两个前提的表达、结论里的 `span`、一般命题无坐标）。

**如实留着的**：**前提桥仍然没做** —— 判定定理那两个前提**确实**是题面那两条垂直（比性质定理更接近原题），但**原题其余题设**（底面形状、P 在平面外…）仍不在命题里；**曲线性质 / 切线·导数 / 其余立体关系仍无模板**；产品侧自动调用与产物通道、Rust 侧 proof/lean 命令**都没做**。**不许把这一块读成"V2 GREEN 做完了"。**

**门禁**：`typecheck` exit 0（**它抓出一条 vitest 看不见的错**：测试辅助函数的 `planeLines` 写成数组而非元组，运行期全绿、只有 `tsc` 报 TS2345 —— 这就是"跑过测试"不等于"过了类型门"的现成例子）；`lint` 0 error / 13 warning（基线）；全库非 Lean **338 文件 / 3990 通过 + 1 todo / 0 失败 / exit 0**（524.30 s；比上次读数 +7 条，正好是新增用例）；全量 e2e **218 通过 / 0 失败**（2.6 m）；`proof:smoke` 8/8。**变异**：摘掉"相交"判据 ⇒ 那两条用例变红；把新类改成与第一类**同名** ⇒ "两类同名"与"报告冒充"两条变红（详见 [进度归档](docs/project-progress.md)）。

## 2026-10-10 —— V2 实测归因更正：冷缓存，热跑复现 `formally_proved`（行为未改，只改一条失败文案）

**这一块只改一个测试的失败文案**，其余是对上一条记录的更正 —— 上一条把 `judgement=timeout` 记成"本机今天不成立、原因未定论"，**补跑后归因确定：那是冷缓存的第一次运行。**

**证据（两条命令紧挨着跑）**：① 全套单跑 `npx vitest run scripts/proof-spike/lean4EndToEnd.test.ts` = **3 passed / 1 failed / 1030.47 s**，红的是 `status=verified_instance judgement=timeout exit=null 300015 ms`（撞 300 s 进程级墙钟）。② 紧接着只跑那条 `-t "真证明"` = **1 passed / 69071 ms**，读数 **`status=formally_proved` / `judgement=verified` / `exit=0` / axioms `["propext","Classical.choice","Quot.sound"]`**。**69071 vs 文档里的 68277 ms** ⇒ 同一量级（差 1.2%），**历史读数复现**。

**机理**：mathlib 展开后每工程 **7.5 GB olean**，第一趟要把它们读进页缓存，成本全落第一趟 —— `timeout` 是"只读了一次"的产物，**不是能力缺失**；适配器两次行为都对（冷跑如实报 `timeout`、不返回半成品）。同次导入宽度 narrow=69021 ms（与历史 68 s 吻合）/ full Mathlib=583065 ms（历史约 150 s，本机慢约 4 倍）。

**改动**：只改 `scripts/proof-spike/lean4EndToEnd.test.ts` 那条断言的失败文案，把"**冷跑超时 ≠ 回归，先热跑一次再判**"写进去，避免下一个人重复这次误判。**改完又跑了第三次：`67954 ms` / `verified` / `exit=0`（同一读数，证明改的是文案不是判据）。** **不改预算、不放宽判据**（预算不是病因）；`typecheck` exit 0、`lint` 0 error / 13 warning（基线）复核通过。**同步更正** `current-status` §一 那一行（改为冷/热两读并列，"不得当作当前能力"改为"能力成立但首次要热缓存"）与 V2 计划实测节。**V2 实测仍不勾**：桌面真 UI 未做 + Rust 侧无任何 proof/lean 命令（缺口④），两件要一起做。

## 2026-10-10 —— V2 对账：RED 全对上；**真实 Lean 集成本机今天red（timeout）**，GREEN 缺口逐条写清

**这一块不改代码**：第二份计划的 V2 逐条对账。三条里 **RED 勾上**，**GREEN 与实测都不勾** —— 后者有一个必须当场说清的读数。

**RED：逐条对上（`proof:smoke` 8/8 通过）** —— `sorry`（`lean4Adapter.test.ts:86`，它的 exit code 是 0，退出码在这层不算数）、自定义 `axiom`（`:94`）、**证明了别的定理**（`:116`："报告是别的定理的也拒，名字必须逐字对上"）、**删题设/换目标**（`:258`：命题原文进 `statement` 栏，模板一改产物就对不上）、**未接后端**（`:190` + `proofArtifact.test.ts:97`）、**超时**（`:178`/`:358`：进程级墙钟超时如实报 `timeout`，绝不把被杀掉那次算通过）、**旧 run 回包**（`workerContracts.test.ts:125`）、**升级边界**（`proofArtifact.test.ts:77/97/187`、`lean4Adapter.test.ts:329/479`：篡改产物喂回闭环状态**不升**）。

**GREEN：部分（四条缺口，逐条指得出落点）** —— ① 逐类可信翻译**只到一类**（只有 `perpendicular` 那条带假设的垂直性引理；曲线性质 / 切线·导数 / 立体关系都没有）；② **前提消解 / 原题前提桥没有**（今天的命题是**一般命题**，不是"这道题"）；③ **产品侧自动调用与产物通道没有**；④ **受限桌面调用没有** —— Rust 侧**一个 proof/lean 命令都没有**（全树 grep 只有一处无关字样，241 个 Rust 测试里没有证明相关）。已有的那半照实记：报告白名单 + `#print axioms`、目标词表与载体、产物绑定、接入名单**由 passed 记录推导**、工具链缺失 ⇒ gated 跳过不静默通过、`proofExport` 默认 `false`（`featureFlags.test.ts:30`）；"默认启用前"那批审查已有一份很详细的 `proofBackendReview` 记录，**但其中一条自己写着未测：强沙箱（只读 + 无网络）下的证明运行未测**。

**实测：不勾 —— 本机今天没复现那条历史读数（这是本批最重要的一条如实记录）**。单跑 `npx vitest run scripts/proof-spike/lean4EndToEnd.test.ts`（**1030.47 s**）得 **3 passed / 1 failed**：红的是"**真证明 ⇒ `formally_proved`**"，实际是 **`status=verified_instance judgement=timeout exit=null 300015 ms`**（撞 300 s 进程级墙钟被强杀；适配器如实报 `timeout`、不返回半成品 —— 行为本身是对的）。同次导入宽度：**narrow = 69021 ms**（与历史 68 s 吻合）/ **full Mathlib = 583065 ms**（历史约 150 s，**本机慢约 4 倍**）。`sorry` 那条仍正确（`exit=0` 但 `judgement=failed`，报 `sorryAx`）。
**⇒ 文档里那句"真内核闭环成立、`formally_proved`、68277 ms"是 2026-10-06 的历史读数，本机今天不成立。** `current-status` §一 那一行**已就地更正并标注**（历史读数与今天的未复现并列，明确"本行不得当作当前能力"）。**原因未定论**：是预算（300 s）不足还是导入宽度没裁到 narrow，下一步先测"真证明那一轮实际用的导入宽度"。**不记为通过、不记为抖动。**
> **⚠️ 本条结论已被下一条更正取代** —— 见《V2 实测归因更正：冷缓存，热跑复现 `formally_proved`》：那是首次运行的冷缓存成本，热跑 69071 ms 得 `formally_proved` / `verified`。

**桌面真 UI 未做**（无人值守下也做不了）：真桌面里跑一次自动 Lean 并核对产物要人操作，列进"等你点头"。

## 2026-10-10 —— V1 对账：四类题可重复构造/拒绝、拖动不被拖坏、一步撤销（并修正一处我自己留下的过期摘要）

**这一块不改代码**：第二份计划的 V1 三条（RED / GREEN / 发布前条件）逐条对账后勾上，并把两处如实留着的东西写清。

**RED 逐族落点（都在，逐条读过）**：**三角** —— `planCompiler.test.ts:971` 同一句话、同一套动作，只把 C 挪到 `AB` 射线上 ⇒ `AB⊥AC: failed` 且 `ok=false`（**这就是点名的 `AB∥AC` 反例**）；`:979` 点名点没进文档 ⇒ `unverified`（不按"没有就跳过"）。**圆锥曲线** —— `diagramVerification.test.ts:327`（半轴一样、**轴反了** ⇒ failed）与 `:333`（半轴互换 ⇒ failed）：只比数值不比轴就会放行。**切线** —— `diagramVerification.test.ts:244`（`tangentAt: failed`）。**空间线面** —— `relations.test.ts` 残差 + `planCompiler` 的 `relation_not_satisfied`。**合法自由点图要绿**：四家族浏览器正例 15 passed。**无空间判据不得被拖坏**：`constrainedDrag3.test.ts`（关开关 passthrough、斜拖贴回平面、沿法向拖**完全抵消并如实报 `noop`**、冗余约束不阻止提交但要提示、锁定/绑定点交给旧路径）。**三值与主张状态分离**：`claimEvidence.test.ts` + benchmark 契约；**未核验不当通过**：`agentRunner.test.ts:45`（逐条中文列出且**不提供确认**）。

**GREEN**：四家族都复用**既有**图元，自由点走有界数值见证搜索，多图时取直觉代表并**把"系统自选了什么"写进 assumptions**（用户确认前可见），矛盾/超时/不支持按**各自独立状态**拒绝伪提交。**一处如实留着（不是漏，是裁决）**：`ClaimEvidence.degreesOfFreedom` 仍为 `null`（R33，理由在 `witnessSearch.ts:64-66/785-801` —— 拿见证候选自证会把公共尺度自由度"算掉"；`claimEvidence.test.ts:48` 钉住）。**"数值自由度"与"系统替你选了哪些值"是两件事**：后者有列，前者没算。**不要把这条读成"V1 已列出自由度"。**

**发布前条件**：四家族各有实际浏览器图 + 核验 + 失败说明；关旗旧路径不变（golden + 关旗浏览器反例）；**12 条内部文字/坐标候选一条都没有被当成 V1 的证据**。

**顺带修正一处我自己留下的过期摘要**：`current-status` §四 F 的"S1–S6 立体扩宽"那一段是我在 S3 菱形那一轮写的，里面写着"斜棱柱未做、S6 未收口、`freeApexIntentFor` 尚未退役"—— 斜棱柱与 S6 收口之后**忘了回填**，本批改掉。**这正是我一开始审查进度文档时批的那类漂移（"改了这里、漏了那里"），我自己又犯了一次**；教训：每块收口要按"文档四处同步"清单逐文件回读，而不是凭印象。

**当次读数**：全库非 Lean **338 文件 / 3983 通过 + 1 todo / 0 失败**（526.39 s）；**全量 e2e 218 通过 / 0 失败**（2.5 m）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；文档门禁 7/7。

## 2026-10-10 —— V0 对账：机器那半已齐、出口**仍不勾**（缺的是"人看图"这一步）

**这一块不改代码**：第二份计划（`2026-10-06-diagram-agent-auto-lean-implementation-plan.md`）的 V0 出口逐条对账，并把"区块收口"那一格如实勾掉。

**出口六条逐条取证**（明细表在计划里）：
- **可重放的实际图元/函数图**：四家族浏览器正例 **15 passed**（V0a 立体 6 条 / V0b 平面三角 1 / V0c 圆锥曲线 3 + 符号参数 2 / V0d 函数与切线 1 / 欠定 2），每条都是**提交后重放**：读落盘坐标或参数、由测试自己算；
- **内核逐条核验**：定向 **6 文件 / 157 通过**（`planCompiler` / `draftStore` / `workerContracts` / `planar-constraints` / `diagramScope` / `goldCases`）；
- **模糊输入拒绝确认**：`agent-underdetermined-diagram`（额外未支持条件可见且**不能提交**）、`agent-conic-invariant`（符号参数保留、数值采样如实标注、等用户）、`agent-diagram-free-apex`（"在底面上方"不静默丢 + 与题面矛盾的坐标被拒）；
- **欠定"有可用图"与"答案不唯一"同时为真**：欠定四棱锥**以示例呈现**、可确认、一步撤销；自由点用例面板写明"不是普遍证明"；
- **关旗旧路径有真浏览器反例**：开关关着时同一句题面**不产点、不产草稿、不占撤销历史**；
- **每例的可目检图**：`docs/evidence/` 六张，**本批逐张看过并记录所见** —— V0a 底面 B/A/C 在地面网格、顶点 D 在其上方；V0b C 在 A 正上方 ⇒ AC⊥AB；V0c 椭圆横长竖短（半轴 3/2）、双曲线左右两支、抛物线开口朝 +x；V0d 三次曲线 + 过局部极小点的水平切线（与 f′(1)=0 一致）。**六张都与各自的标签/方程相符。**

**出口为什么还是不勾**：它自己写着"**没有 e2e 与**人看图确认**时此项保持未勾**"。机器那半（e2e / 独立回代 / 反例 / 截图）齐了，**"人看图"这一步机器证据顶替不了** —— 需要教师/学生看这四类图确认"看得懂、直觉对"，记在 [当前状态](../../current-status.md) §四 A（不需要管理员，但必须由人做）。**本项按纪律留在未勾，不用机器证据冒充。**

**V0 区块收口：勾上**（定向 + 四家族 e2e + 全库非 Lean + 全量 e2e + typecheck/lint + 文档同步 + 数据卫生 + 六张截图目视核对 + commit/push + `git ls-remote` 核对）。

**当次读数**：定向（V0 点名的六个文件）**6 文件 / 157 通过**；四家族 + 反例 e2e **15 passed**（单跑）；全库非 Lean **338 文件 / 3983 通过 + 1 todo / 0 失败**（524.02 s）；**全量 e2e 218 通过 / 0 失败**（2.5 m）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；文档门禁 7/7。

## 2026-10-10 —— S6 收口：窄正则的"退役"评估后**决定保留**（附证据），浏览器正例逐族对账

**这一块没改产品代码** —— Task 6.1/6.2/6.3 早就在，本批做的是：把 6.2 唯一剩下的那一格（`freeApexIntentFor` 窄正则退役）**评估到底**、把 6.4 逐族核实、把 6.5 收口。

**6.2 的决定：保留，不是漏做。** 用探针把 V0a 那族句子逐条喂给两条路，量出那条窄正则的契约里有一件不能丢的事 —— 它**必须传 `spatialPointConditions: true`**。实测（两侧都会变，方向相反）：

| 题面写法 | 见证搜索（默认） | 带 `spatialPointConditions` |
| --- | --- | --- |
| `A=(0,0,0)` / `D=(0,0,2)`（等号坐标） | `unverified_instance` | **`verified_instance`** |
| `自由点D在底面ABC上方` / `D(0,0,2)`（无等号） | **`verified_instance`** ⚠ | `unverified_instance` |

丢了选项：写死的坐标**进不了图**（题面说 A 在原点、图上不是）；"在底面上方"与无等号坐标则会**静默通过**。而 `solidShapeIntentFor` 那层**刻意避开整个三棱锥族**（`V0A_TERRITORY`），两条路各有各的契约。所以"退役"实际要做的不是删 35 行，而是把 V0a 的整套契约搬进形状族（含这条选项、含那套刻意拒绝、还要改 V0a 的单元与 e2e）—— 风险落在一个**实验开关后的既有能力**上，收益只是删掉一段并不重复的代码。**决定保留，并把承重性钉成永久判据**：`packages/agent-core/src/planCompiler.test.ts` 新增两条（"空间点条件：这个开关是承重的"），上表两个方向都钉住；谁以后要接管这件事，这两条会先红。

**6.4 逐族对账**（出口要"读真实落盘坐标独立回代题设，每族至少一条"）：棱锥 `agent-solid-family-path`（五棱锥）、棱柱 `agent-prism-path` + `agent-oblique-prism-from-sentence` + `agent-rhombus-base`、棱台 `agent-solid-family-path`（台体）、球 `agent-derived-sphere`（含本批补的"拖宿主 ⇒ 球跟着重算"）。四族齐，且都是"落盘坐标 → 测试自己算"。

**如实留着的边界**：无点名表的说法仍走夹具、"球"的关系仍**有意不认**（认了也造不出来）；覆盖度没有穷尽口径 —— 按设计 §6 的纪律"认不出就问路"。

**一处我自己在同一批里犯又当场改掉的编辑事故**：改计划时我的一次替换把 **Task 6.3 那一段**一起覆盖掉了（old_string 含它、new_string 没带上）；重读文件时立刻发现并原样补回。**没有内容丢失**，但记下来：批量文档编辑必须回读确认，不能只看"编辑成功"的回执。

**当次读数**：定向（planCompiler + golden + witnessSearch + shapeGrammar + localPlanner）**5 文件 / 189 通过**；全库非 Lean **338 文件 / 3983 通过 + 1 todo / 0 失败**（521.95 s）；**全量 e2e 216 通过 / 2 失败 ⇒ 单跑复绿，记为负载抖动**（两条都是渲染/性能敏感的既有用例：`geometry3d-teaching-lines`（相机旋转后的标签锚点投影）与 `main-thread-responsiveness`（帧间隔 350 ms > 250 ms 阈值，本仓记录过的负载敏感项）；**单跑该两条 3 passed / exit 0**，且**本块没改产品代码**）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；文档门禁 7/7。

## 2026-10-10 —— S5 拖动那一半：宿主一动球跟着变（查实两次失败尝试的根因，两处修复）

**这一格的来历**：计划里 5.5 的"拖宿主 ⇒ 球跟着变"在 2026-10-07 **三次都没做成**（拖顶点 / 拖实体 / 先选中再拖），当时如实记为待办。本批把它做成了 —— 根因不是"这一版不支持"，而是**两个原因叠在一起**。

**根因（用 `data-drag-target` 探针查实，不是猜）**：
1. **外接球把宿主整个包住**：射线命中的**最近**物体永远是那只球 —— 三个候选按下点（形心 / 顶点 / 底面中心）的探针读数**全是** `solid:sphere-1->sphere`。用户"按在实体上"，其实按在球上。
2. **派生球被当成了可自由拖动**：`isFreeDraggable3` 对 `sphere` 一律返回 true，可派生球的球心与半径由宿主算出来（`derivedFrom`），拖它只会被下一次重算覆盖 —— "看起来能拖、其实是假的"。

两件事叠起来，症状就是"按在实体上怎么拖都不动"，看着像产品不支持。

**修法两处**：
- `isFreeDraggable3`：派生球不可自由拖动（自己带几何的球仍可拖，没把判据扩大化）。**顺带补上一个洞**：这个判断**此前全仓没有一条用例**，本批新增 `packages/scene-graph/src/transforms.test.ts`（自由点 / 绑定点 / 自由顶点棱柱 / 派生球，4 条）。
- `pickRaycastHit3` 新增可选的 `accept` 过滤（按"**可拖**"筛候选），`threeSceneInteraction` 的拖动分支按"解析后的用户级对象 + `isFreeDraggable3`"传它 —— 于是射线**穿过**那只拖不动的球，抓到底下的宿主。非拖动路径（普通点选、剖面取面、半径手柄）**不带这个过滤**，行为逐字不变。

**判据（e2e 自己算，四条）**：顶点真的动了；**只有它动**（拖的是一个顶点，不是"整只实体悄悄平移"）；球**跟着重算**（不再是旧的那一只）；而且**仍是新顶点组的外接球**（这才是"不是过期数据"）。拖**顶点**是刻意的：外接球的顶点本来就在球面上，顶点一动球心或半径**必须**变，"有没有重算"因此不含糊。

**红→绿**：拖动断言先写后跑，**修前实测红**（"拖动之后宿主顶点没有动"，正是最初症状）；两处修完后 **1 passed**。
**变异**：把 `isFreeDraggable3` 里派生球那行改回 `return true` ⇒ **两层同时真红**（单元"派生球不可自由拖动"+ 浏览器复现最初症状），反向编辑还原后全绿。
**回归**：拖动相关 e2e（`agent-derived-sphere` + `geometry3d-drag` + `agent-constrained-drag`）**16 passed**。

**同时结掉两格**：**Task 5.4**（"若 `recomputeDerivedObjects` 接不进去就停下报告"—— 条件没发生，这条路接进去了，如实勾掉）；**5.1/5.3 的"面板没有专门呈现"**核实为**已做**（`EngineeringInspector` + `derivedCodeLabels` 的「派生球」+ 组件用例，`derived.sphere_stale` 只在出问题时出现）。

**本批我自己搞出来的两处问题（如实记）**：
1. **过滤条件第一版写错了，打红三条既有用例**：我最初把"可拖"写成 `isFreeDraggable3`，而**绑定点**（沿宿主 / 轨道拖，走参数域那条路）在它眼里是**不可拖**的 —— 于是过滤把绑定点筛掉，拾取落到它后面的线/圆上（`three-orbit-tracks` 的读数逐字是 `line:circle3-1->circle3`）。全量 e2e **4 failed**（`geometry3d-host-drag`、`three-orbit-tracks` ×2；另一条是既有负载抖动的 `main-thread-responsiveness`）。**修法**：把"能不能开拖动会话"抽成**一条共用口径** `canStartDragSession`（点：自由的走自由拖动、绑定的走参数域拖动；其余交 `isFreeDraggable3`），过滤与拖动分支同用它 —— 这才是"同一个判断只写一遍"。三条 spec 复跑 **5 passed**，全量 **218 passed / 0 failed**。
2. **我自己引入的第 14 条 lint 警告**：改写断言后 `agent-derived-sphere.spec.ts` 的 `subtract` helper 没人用了（基线 13 条 → 14）。删掉后回到 13 条。

**当次读数**：全库非 Lean **338 文件 / 3981 通过 + 1 todo / 0 失败**（522.06 s）；**全量 e2e 218 通过 / 0 失败**（2.4 m）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。

## 2026-10-10 —— S4 收口：台体（出口三条逐条核实 + 变异，无新代码）

**这一块没有改代码**（4.1 / 4.2 / 4.3 于 2026-10-07 落地），补的是收口那一格。出口三条逐条核实：① **正例成立**（内核「顶环逐一对应底环 ⇒ 构造成功」+ 浏览器 `agent-solid-family-path.spec.ts` 的台体那条：落盘坐标自算"顶棱 = 底棱 × 同一比例且小于 1"）；② **上下底说不清 ⇒ 明确拒绝**（点数不同、名字对不上两条反例 —— **不按顺序硬配**）；③ **文档写明圆台是多边形近似** —— `current-status` 里早有"段数 + 弦高误差 + 对象标签写（近似）"，**本批把 `feature-catalog` 的 S4 行也补上了这句**（此前只提"圆台"二字，没写"近似"）。

**变异（当场做，两个方向都看过）**：短路 `constructShapeFromSpec` 里"上下底逐一对应"那条判据 ⇒ **2 条真红**，红法是 `expected 'candidate' to be 'rejected'` —— 即**没有这条判据就会静默造出一只张冠李戴的台体**。反向编辑还原 ⇒ 复绿（**没有用 `git checkout`**）。

**定向**：内核构造 43、`solid-builders`、`witnessSearch`、规划器、关旗 golden ⇒ **5 文件 / 194 通过**。
**当次读数**：全库非 Lean **337 文件 / 3977 通过 + 1 todo / 0 失败**（434.94 s）；**全量 e2e 218 通过 / 0 失败**（2.5 m）；`typecheck` exit 0；`lint` 0 error / 13 warning。

## 2026-10-10 —— S3 斜棱柱：题面说"斜"就说得出"斜"（代表斜向 + 假设，S3 收口）

**口径（用户裁决；此后用户改为"自主模式"：直接选推荐方案并写进文档）**：走**代表斜向**那一支 —— 题面只说"斜"、没说斜多少 ⇒ 系统取代表值（侧棱与底面法向成 **60°**、朝底面 +x 一侧倾斜）并**写进 assumptions**，与"正 n 边形代表""菱形代表角 60°"同一条口径。**不做**"用题面的角把方向钉死"（`∠A′AB=60°`）：那要计划 Task 3.1 说的"环外点名顶点"概念 + 角度求解，已写进计划的"明确不做"。

**三处落地**：
1. **修饰词不再是隐形的**：`SHAPE_CLAUSE` 里「正/斜/直」原本是**非捕获组**，`RecognisedShape` 也没有这个字段 ⇒ `在斜三棱柱ABC-A′B′C′中，AA′⊥平面ABC` 会被**当成直棱柱画出来**（题面说斜、系统画直，一路绿到提交）。现在它是 `RecognisedShape.modifier`（**没写就是 `undefined`**，不许默认成"直"）。
2. **自相矛盾的题面在入口层问路**：`斜…棱柱` 与「线段 ⊥ 平面」同时出现 ⇒ `unrecognised` 并说清矛盾（"斜棱柱的侧棱不垂直于底面"）。
3. **斜棱柱正例**：没有"侧棱 ⊥ 底面"可读时，两个环只能来自**入口语法**（与台体同一条理由）⇒ `specForObliquePrism` + `SolidShapeSpec.lateralTiltDegrees`（这是本仓 YAGNI 约束要求的那一次"顶层字段落地"）。内核按它算拉伸向量（`undefined` = 直棱柱，**原路径逐字不变**），并把代表斜向写进 `freeValues` —— **用户确认之前就看得到"斜多少是系统定的"**。

**红→绿都看过红**：修饰词（`undefined` vs `'斜'`）、自相矛盾（修前 `ok` ⇒ 画成直棱柱）、正例（修前 `unrecognised`：`题面没有给出「某条侧棱 ⊥ 底面」的写法`）。
**变异**：忽略代表斜向（拉伸向量写死竖直）⇒ 该红的是真红 —— 报"侧棱与底面法向平行 ⇒ 画成了直棱柱"（余弦 1），还原后复绿。
**浏览器正例**：`e2e/agent-oblique-prism-from-sentence.spec.ts` **1 passed** —— 面板 `题设核验 = passed`、**面板上写着"斜向"那句假设**、提交后按落盘坐标自算"三条侧棱同一条向量（顶面是底面的平移）"且"侧棱与法向不平行"。

**S3 收口（Task 3.5）**：出口点名的四类形状**各有正反例** —— 正棱柱（3–6 边 / 点名角度 ⇒ 拒绝）、菱形底面（正例 / 菱形+直角=正方形 ⇒ 拒绝）、斜棱柱（正例 / 斜+⊥ ⇒ 问路）、正六边形底面（代表正多边形 / 点名角度 ⇒ 拒绝）。

**仍未做**：S6 收口（`freeApexIntentFor` 窄正则退役、6.4/6.5），以及本文件别处记着的"用角条件钉死方向"。

## 2026-10-10 —— S3 菱形底面：题面「底面 ABCD 是菱形」（有名字表入口，不新造数学）

**用户裁决**（本批开工前问的那一句）：**只接有名字表的题面** —— `在四棱柱ABCD-A′B′C′D′中，底面ABCD是菱形，AA′⊥平面ABCD，画出这个四棱柱`；**不给无点名表的说法替用户编一套点名**（设计 §19 那句「底面是菱形、侧棱垂直底面的四棱柱」继续走既有夹具那条路，不在本批）。

**落法：把"菱形"变成已有的判据，而不是新的几何。**
- **解析层**（`diagramObligations`）：新增读取器，把「底面 ABCD 是菱形」拆成**三条已有的 `equalLength`**（`AB=BC`、`BC=CD`、`CD=DA`，链式经传递性覆盖四条边）。为此把读取器的契约从"一条判据"放宽到"一条或**一组**判据"（一个句型蕴含多条时用）。环不是四边形（如「底面ABCDE是菱形」）⇒ 读不出，并**显形为 `unverified`**（把 `菱形` 加进"未被消费的强几何信号"那道扫描），不静默丢掉。
- **核验层**：**不改**。等长判据只有一处（`diagramVerification` 的 `equalLength`），"菱形 ⇒ 四边相等"是**定义**，不是第二套数学。
- **内核**（`constructors.ts`）：新增 `WitnessRelation` 的 `equal-length` 档 + `hasEqualSideChain` + `deriveRhombusBase`。菱形由构造保证四边相等，**代表角 60°**（题面只说"菱形"、没说角 —— 与 n ≥ 5 的"正 n 边形代表"同一条口径，并写进 assumptions）。三条 fail-closed 拒绝：**同时点名直角 ⇒ 正方形（题面说的是菱形，不画更强的形状）**、题面给了两个不同边长 ⇒ 自相矛盾、边长零或负 ⇒ 退化。
- **搜索层**：`kernelRelations` 把 `equalLength` 映射成 `equal-length`；`orderedBaseWithFreeEdges` 对菱形**只给一条自由底边**（`AD` 由 `AB` 决定 —— 把 `AD` 也说成"系统自选"是假的自由，而且候选池那条"两条自由底边不许取相等"会让每个候选都与四边相等打架）。
- **`obligationIR`**：求证段的目标句遇到"一组判据"的句型返回 `null`（**认不出**），**不取第一条** —— 拿 `AB=BC` 当"证明是菱形"的目标是把主张悄悄降级。

**红→绿（三层都看过红）**：解析器两条（`ABC D` 菱形 ⇒ 三条等长；五边形环 ⇒ unverified）修前实测 `[]` / 无 unverified；内核两条（四边相等 + 给定边长 ⇒ 菱形；菱形 + 直角 ⇒ 拒绝）修前实测 `unsupported-base-shape` / **`candidate`（被静默画成矩形 —— 这正是要拦的那种）**；端到端两条（spec ⇒ `verified_instance`；菱形 + 直角 ⇒ 不给通过核验的候选）。

**变异**：短路"四边相等 + 直角 ⇒ 正方形"那条拒绝 ⇒ **2 条真红**（内核 + 端到端），还原后复绿。

**证据与读数**：解析器 **24/24**；内核 **43/43**；定向 **13 文件 / 382 通过**（含关旗逐字不变 golden）；**浏览器 `e2e/agent-rhombus-base.spec.ts` 1 passed**（提交后在浏览器里**自算**：底面四边两两相等、A 处不是直角、四条侧棱都与底面法向平行）；全库非 Lean **337 文件 / 3974 通过 + 1 todo / 0 失败**（440.21 s）；**全量 e2e 217 通过 / 0 失败**（2.5 m）；`typecheck` exit 0；`lint` 0 error / 13 warning。
**一次抖动如实记**：本块首次全量 e2e 是 216 通过 / 1 失败，红的是 `conversation-isolation.spec.ts:52`（会话隔离）—— **单跑 1 passed / exit 0**，同树第二次全量 **217/0** ⇒ 记为抖动，不记为回归。

**事故与教训（我自己的，照本仓惯例记下来）**：做变异验证时我用了 `git checkout -- packages/geometry-kernel/src/witness/constructors.ts` 还原，而那个文件当时**有未提交的菱形实现** —— 于是连同实现一起被还原掉，4 条用例立刻变红（"测试在、实现在不在"）。按本会话里的改动记录**逐条重新落地**后复绿；之后的变异改用**反向编辑**（不再对含未提交改动的文件用 `git checkout`）。**没有数据丢失，但这是一次纯粹自找的返工。**

**仍未做**：斜棱柱（要"环外点名顶点"概念，属设计级）、S6 收口、`freeApexIntentFor` 窄正则退役。

## 2026-10-10 —— S6.3 反例收口：认不出来就问路（**只加判据，不改产品行为**）

**缺口**：设计 §6 的纪律是"**认不出一律问路，绝不悄悄改文档**"。正例那一侧已经有三个浏览器 spec
（`agent-solid-family-path` / `agent-prism-path` / `agent-derived-sphere`），但**"认不出"这一侧**
在浏览器里只有一条 —— 而且它验的是**实验开关关着**，不是**读不懂**。S6 的出口明写"认得出与认不出
两类反例齐全"，所以这里补的是那份缺的判据。

**补的判据**：新增 `e2e/agent-unreadable-prompt.spec.ts`，覆盖三类读不懂的题面 ——
分析题（`这个四棱台的体积是多少`）/ 非立体题（`画出 y = x³ − 3x 的图像`）/
说法与形状对不上（`在四棱柱ABC-A′B′C′中，AA′⊥平面ABC`）。每条四个判据：
① 确认面板（"确认并提交"）不出现；② 运行状态卡落定（不是永远转的"进行中"）且对用户说了话；
③ 草稿键 `mathcanvas:draft:geometry3d` 前后**逐字相同**；④ 回画布后对象列表为空、且「撤销」仍禁用
（"画布上没东西"与"画了又被撤掉"看起来一样，只有撤销栈能区分）。

**如实记：三条用例一写就绿，没有 RED。** 行为本来就是对的 —— 规划器层有 `shapeGrammar.test.ts`
那批反例与 `localPlanner` 的"裸词与问读数不认"，运行时单元层有 `agentRunner.test.ts` 的
"认不出 ⇒ `waiting` + 无草稿 + 文档 0 图元"。本批补的是 **S6 出口点名要的浏览器判据本身**，
不是修了一个坏行为；把它写成"修复"会是假的。

**读数**：新 spec **3 passed**（21.1 s）；**全量 e2e 216 passed / 0 failed**（2.4 m —— 加上本批 3 条之后从 213 涨到 216）；
`typecheck` exit 0；`lint` 0 error / 13 warning；文档门禁 `scripts/docs-consistency` **7/7**。
**本批没有改产品代码**，所以全库非 Lean 单测仍是同日 S3.4 那条读数（337 文件 / 3968 通过 + 1 todo）。

**一条待裁决（本批查实，未改）**：`waiting` 这一支经
`failPendingReply({ code: "needs_more_information" })` 收尾（`agentRunner.ts:801`），
而 `RunStatus` 的 failure 分支把标签写成**"没有完成"**（`data-status="error"`）——
也就是说"**我问你一个问题**"与"**这次没做成**"在界面上共用同一个词。
判据**刻意不钉**这个标签：钉死文案会造出"一改措辞就红"的假门禁。

## 2026-10-10 —— S3.4 解除：题面驱动的直棱柱到不了面板，根因是**关系抽取的点名块字母表**（已修）

**症状**：`在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个三棱柱` 在界面上走得到规划、也走得到暂存，
但"确认改动"面板始终不出现 —— `e2e/agent-prism-path.spec.ts` 从 2026-10-07 起以 `test.fixme` 挂着。

**根因**（先把那份**已知的本地计划**塞进真实暂存路径做确定性复现，再把诊断落到具体规则）：
`relationExtraction.ts` 的"点名块"字母表是 `[A-Z][A-Z0-9]*`，**`′` 不在其中** ⇒ `AA′` 被切成 `AA`
⇒ 读成**自己到自己**的退化线段 ⇒ `AA′ ⊥ 平面ABC` 的 targets 成了 `v0,v0,…`、残差算不出来
⇒ `planCompiler` 判 `relation_not_satisfied`（一次**失败**，不是"未核验"）⇒ 编译失败 ⇒
协调器把那唯一一次修复交给模型 —— 而这条关系是**系统从原话抽出来的**，`envelope.relations` 只是投影，
模型根本改不动 ⇒ `run_failed` ⇒ 面板永不出现。**上一轮的定位"卡在计划 → 面板之间"到此收到具体一行代码。**

**修法（一处，最小）**：抽取器的点名块与拆分改为复用 **S1 的唯一定义**（`pointNames.ts` 的
`POINT_NAME_SUFFIXES` + `splitPointNames`），四处写死的 `[A-Z][A-Z0-9]*`（点名块 / 两种中点句型 /
`平面` 前缀）**并到同一份**。**数字仍留在块里**：`A1B1` 这类 ASCII 下标必须整块交给 `splitPointNames`
否掉 —— 块一旦在数字处断开，`AA1` 会被读成 `AA`（同一个退化线段），"读不出"就被悄悄升级成"读成了一个错的"。

**判据（三处，红→绿都看过）**：
- `relationExtraction.test.ts`：带撇线段 `AA′` ⇒ targets `v0,v3,…`（修前 `v0,v0,…`）；带撇平面
  `平面A′B′C′` ⇒ 仍是面（修前被读成 1 个点）；`A1B1` 仍读不出（S1 契约的诚实性护栏）。
- `diagramDraftStage.test.ts`：同一句题面走**真实暂存路径** ⇒ `ok` 且 `diagramVerification.status = passed`
  （修复前这条逐字复现 `compile_failed` + `relation_not_satisfied` + 那条改不动的修复请求）。
- `e2e/agent-prism-path.spec.ts`：`test.fixme` 转正 ⇒ **1 passed（18.2 s）** —— 面板出现、
  `题设核验 = passed`、提交后浏览器里**自算**的几何判据（三条侧棱彼此相等、每条都与底面法向平行）全过。

**读数**：全库非 Lean **337 文件 / 3968 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
`lint` 0 error / 13 warning（基线）；关旗逐字不变契约 `planCompiler.offPath.golden` 仍 **13/13**；
相关 e2e（`agent-solid-family-path` / `agent-derived-sphere` / `agent-round-frustum` / `next-phase-flag-entry`）**9 passed**；
**全量 e2e 213 passed / 0 failed**（2.5 m —— 那条 `test.fixme` 转正之后不再有 skipped）。

**仍未做**：斜棱柱（要"环外点名顶点"概念）、菱形底面、S6 收口、`freeApexIntentFor` 窄正则退役；
画布顶点标签与 `vertexNames` 错位、球状态词表仍待裁决。**本次不宣称 S3 整块收口** —— Task 3.4 只是那一格。

## 2026-10-07 —— S3.4 调试轮：把"题面驱动的棱柱画不出来"的根因**缩小到运行时校验那一步**（无代码提交）

**这一轮不提交代码**，只把根因查实（三处临时插桩已全部还原，工作树干净）。上一轮给的定位是"卡在计划 → 面板之间"，太粗；现在有四条证据：

1. **失败的是哪一份计划**：报错字段是 `envelope.relations` —— 那是**模型信封**才有的字段，本地规划器的计划里没有它 ⇒ 出问题的是**模型那一份**，不是本地那一份。
2. **本地规划器到底认没认**：在 `createLocalPlanner.plan` 里插一行日志、并把浏览器 console 转出来 ⇒ `flag:true, matched:["棱柱"]` —— **认领成功**（不是"没认出来"这条）。
3. **本地计划本身退不退化**：把坐标打出来 ⇒ `A(0,0,0) B(2,0,0) C(1.2,2.7495,0)` + `z=2` 顶环，**六个点互不重合**、干净的竖直拉伸。报错里那句"这组坐标退化（例如两点重合）"**描述的不是它**。
4. **于是矛盾指路**：本地计划是在**更早一步**被拒的，运行时因此去问模型要一次修复（页面读数里有 `规划 asking for the one repair (1/1)`），修复也错 ⇒ `compile_failed` ⇒ `run_failed` ⇒ **没有面板**。
   **对照**：台体那一句的步骤表里有"校验 checking the staged draft against the document 成功 / 等待你确认"，**棱柱这一句没有** —— 差别落在"暂存 → 校验"之间。

**下一手（已写进计划 Task 3.4 与追踪文档）**：在单测里用 `compilePlan` 直接编译那份**已知**的本地计划（确定性复现，几秒一次），把诊断落到具体哪条规则；再对 `agentRuntime` 的暂存 / 校验边界插桩。**若三次修法都不成立，按纪律停下来讨论架构，不继续试。**

**工具链**：本轮所有插桩都是临时的，收尾用 `git checkout --` 还原并用 `git status` 核对干净；`e2e/agent-prism-path.spec.ts` 仍是 `test.fixme`（判据已写好），**不写成通过**。

## 2026-10-07 —— S3.3 落地 + 一处**真阻塞**被查出来（题面驱动的棱柱在界面上到不了面板）

**做成的两件**：

- **S3.3 反例（底面共线）**：`在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，AB=1，BC=1，AC=2` ⇒ A、B、C **共线**，那个"底面"面积为 0。系统**拒绝**（`no-candidate-constructed`：候选都在**构造期**被内核拒；不是"搜完没找到"，也不是"预算用尽"—— 三种拒绝含义不同，用例把种类也钉住了）。要拦的是最坏的一种错：照着字面把三个点摆在一条线上，用户看到一只扁成一片的"棱柱"而没有任何提示。
- **规划器的一条规则改了**：单关键词夹具（`{all:["棱柱"]}`，为"画一个斜棱柱"这类**简短请求**而写）以前会把**带点名表的题面**也接走 —— 实测后果是题面里的 `AA′ ⊥ 平面ABC` **永远不会被核验**：用户拿到一只固定尺寸的斜四棱柱，面板里**连"题设核验"那块都没有**。现在夹具加了 `exclude: /[A-Za-z]′/`（**有撇 = 这是题面**），让入口语法 + 见证搜索那条线去接；原来钉住旧行为的那条用例改写为新规则，并补上"简短请求仍走夹具"的另一半。

**查出的阻塞（S3.4 未完成，如实记）**：

- 同样这句题面在界面**走得到规划**（页面读数：`规划 asking for a plan 成功`、`暂存草稿 staging 1 action(s) 成功`），但"确认改动"面板**始终不出现**（等到 30 s 超时仍无）。
- 对照：台体与五棱锥那两句**同样走见证搜索**，面板照常出现 ⇒ 差别不在"这条线慢"，而在这一句产出的计划与它们不同。
- **单元层是通的**：同样这句题面 ⇒ `kind: "plan"`、动作 `solid.create_polyhedron`、假设里有"自选"。**卡在"计划 → 面板"之间**，不是卡在规划本身。
- 因此新增的浏览器用例以 **`test.fixme`** 挂着（几何判据已经写好：三条侧棱彼此相等、每条都与底面法向平行），**不写成通过**；下一批要查的就是那一段（首要怀疑：这一句没有可核验的题设 ⇒ 面板换了形态）。
- 读数：全库非 Lean **3964 通过 + 1 todo / 0 失败**；**e2e 212 通过 + 1 skipped**（就是这条 fixme）；`typecheck` exit 0；`lint` 0 error / 13 warning。

## 2026-10-07 —— 收口核对：**全量 e2e 212/212**、CI 五连绿，状态文档改写成当前实况

- **全量 Playwright 跑了一遍**（这是十几轮里第一次跑全量，此前只跑单个文件）：**212/212 通过（1.8 分钟）**，含本批新增的三条（派生球浏览器证据、圆台、点名声明的形状族）。这十几轮改过规划器、动作层、场景图与 DSL 类型，全量绿是"没有把产品弄坏"的正面证据。
- **CI 逐 run 核对**：**#211 / `29a5970`、#210 / `1893825`、#209 / `d61fe72`、#208 / `580727f`、#207 / `f77d067` 四个 job 全绿**（最新一次推送 `baae5f0` 的 run 结论待取）。
- **状态文档改写成实况**：`current-status.md` 的那块增量原本停在"S1–S3 进行中、S4/S5/S6 未做"，现在按 S1–S6 逐块写清（S1/S2/S4/S5 ✅，S3/S6 🟡，两处待裁决）。**顺带改掉一句过期的话**：`agent-next-round-progress.md` 结尾一直写着"四族形状本身仍无产品代码" —— 那是几个批次前的实况，现在四族都有**规划器夹具 + 动作 + 面板读数 + 浏览器证据**，所以改成"产品路径已通，仍未做的是斜棱柱与菱形底面"。**过期的话比没有话更坏**，这条正是本轮最该改的东西。
- 读数：全库非 Lean **3963 通过 + 1 todo / 0 失败**；**e2e 212/212**；`typecheck` exit 0；`lint` 0 error / 13 warning。

## 2026-10-07 —— S5 收尾：**"这只球与宿主对不上"在属性面板上看得到**（并修好"点开球一片空白"）

- 上一批那条 `derived.sphere_stale` 读数**能出现在面板上**了，本批补的是它落到用户眼前所需的**两处**：
  1. **选中那只球时也要看得到**：面板按"选中的图元 → 它属于哪只实体"取读数（`derivedSolidIdsOf`），
     而那个函数**不认识 `sphere`**（返回空数组）⇒ 用户点开球时整块"派生读数"**一片空白** ——
     而那恰恰是最该看到"这球还算不算数"的时刻。现在带 `derivedFrom` 的球返回 `[宿主 id, 球 id]`。
  2. **行标题的兜底**：`derivedCodeLabels` 补上 `derived.sphere_stale`（内部枚举名不进界面）。
- **实测发现面板的做法比兜底更好**：读数带 `sourceId` 时，面板用**那只球自己的标签**做行标题
  （"外接球 | 不存在 | 球心到各顶点等距（1.73…），但那个距离与这只球的半径 5.00 不符"）——
  所以用例钉的是"标题是**用户给那只球起的名字**、且内部枚举名绝不出现"，而不是钉我那个兜底文案。
- **一条如实记下的别扭**：状态徽章对这个读数显示"**不存在**"。四态词表（精确/数值近似/不存在/退化）
  说的是**内核的结论**，而这里的事实是"这只球**存在**、但它的主张不成立" —— 词表没有第四种说法可用，
  所以准确意思压在那句 message 上。要不要给词表加一档，属**待裁决**（改它会牵动 `derivedStatusLabels`
  那个"内核多一个状态就编译不过"的守卫）。
- 读数：面板用例 + 核验用例两个文件 **24/24**；全库非 Lean **3963 通过 + 1 todo / 0 失败**（150.84 s，**+1**）；`typecheck` exit 0；`lint` 0 error / 13 warning。

## 2026-10-07 —— S4.3 开闸：把**圆台**交给模型（并重签清单哈希）

- `spatial-modeling` 的 `actionIds` 加上 `solid.create_round_frustum`，自述里补一句**怎么用**：给 `center` / `radiusBottom` / `radiusTop` / `height`（`segments` 可省，默认 48），形状由内核按**多边形近似**物化 —— **不要自己写几十个顶点**；**两个半径相等会被当场拒绝**（那是圆柱）。
- **清单是签名的**：改 `actionIds` 必须重签 `EXPECTED_HASHES`（哈希只覆盖动作名与上限）。新哈希用 `manifestHash(manifest)` 现算（`ae1acdff…` → `4532e2f5…`）。
- `agentRuntime.test.ts` 那条**逐字钉住可用动作清单**的用例同步到 **10 个**，并把"圆台为什么是今天补的"写进注释。
- 读数：技能目录 + 运行时 + 输入校验三个文件 **55/55**；全库非 Lean **3962 通过 + 1 todo / 0 失败**（149.96 s）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **如实记其性质**：这是**行为变更** —— 模型看到的工具箱又变了一次。本地规划器与浏览器用例不读这份清单，所以本地读数不变；**真实 provider 的质量基线要重测**（需用户批准付费运行）。
- **S4.3 到此收口**：内核构造 → 文档路径（多边形近似 + 既有多面体动作）→ 参数化动作 → 交给模型；"近似"这件事在**假设与对象标签**上如实声明（含弦高误差），浏览器证据（`agent-round-frustum.spec.ts`）证明从一句话到画布上那 96 顶点 / 50 面真的走通。

## 2026-10-07 —— S4.3 第三刀：**圆台成为参数化动作**（模型/规划器给三个数，形状由内核算）

- 新增 `solid.create_round_frustum`（`{center, radiusBottom, radiusTop, height, segments?}`）：**参数化动作 → 内核形状 → 物化成 `polyhedron3`**，与 `solid.create_prism` / `solid.create_tetrahedron` / `solid.create_regular_pyramid` 同一条路。于是"圆台"不再要求调用方自己写 96 个顶点，也**不需要新图元**。
- **一处几何、两处用法**：抽出内核的 `roundFrustumShape(input)`（只算顶点与面环），注册表入口 `buildSolid("roundFrustum", …)` 与动作层的 `compileSolidRoundFrustum` **共用它** —— 与 `regularPyramidShape` / `regularTetrahedronShape` 同一个角色。顺带把校验收进那个函数（`null` = 不合法），注册表那条分支因此缩成一行。
- **两条拒绝口径**：两个半径相等 ⇒ 形状为 `null` ⇒ **一条操作都不产出**，诊断写"那是圆柱"（`invalid_round_frustum`）；非立体几何工作区 ⇒ `workspace_mismatch`。
- **工具链又逼出两处必须登记的字段**（`actionSchemas.test.ts` 直接报 `no field kind registered for …radiusBottom` / `…segments`）：`FIELD_KINDS` 里补了 `radiusBottom` / `radiusTop`（数字）与 `segments`（整数）。这正是那张表存在的理由 —— 新增同义字段时必须显式说一句，否则 schema 生成与校验会各说各话。
- 读数：定向 12 个文件 **214/214**（含新用例：一条 `polyhedron3` + 96 点 + 50 面、两环半径与高度**按顶点顺序**自算、上下底不许反、相等半径全拒、工作区拒绝）；`actionIds.test.ts` 计数 31 → **32**；全库非 Lean **3962 通过 + 1 todo / 0 失败**（151.29 s，**+3**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **仍未做**：把它**交给模型**（进 `spatial-modeling` 的 `actionIds` + 重签清单哈希 + 运行时那条逐字清单）—— 与派生球那次同样的"先修接缝、再开闸"的顺序，本批已经把动作与校验这一侧做完了。

## 2026-10-07 —— S4.3 第二刀：**圆台走到画布上**（多边形近似 + 既有多面体动作，不加新图元）

- 新增 `roundFrustumPolyhedron`（`agent-core/localPlanDefaults.ts`，本仓"只放数值与构造"的那个文件）：调内核 `buildSolid("roundFrustum", …)`，把**两个环的顶点**与**面环下标**整理出来交给 `solid.create_polyhedron` —— 设计里台体那一条写死的"**不新增 DSL 图元**"因此成立。
- 新增代表题六（`localPlanner` 的 `ROUND_FRUSTUM_PROMPT = "画一个圆台，上底半径 1、下底半径 2、高 3"`）：**假设里如实写出这是近似、差多少**（段数 + **弦高误差** `R(1 − cos(π/N))`），对象标签写"圆台（近似）" —— 这就是设计 §S4.3 点名的"在**文档与面板**上声明是近似"，且面板显示的就是这份 assumptions。
- **一条专门拦"画反"的判据**：题面写"上底 1、下底 2"，所以前 48 个顶点（下底环）到轴心必须是 **2**、后 48 个必须是 **1**。只数顶点个数是拦不住上下底对调的。
- **浏览器证据**（`e2e/agent-round-frustum.spec.ts`，**1/1**）：从这句话走到画布上的实体 —— 草稿里 96 个顶点、50 个面，两环半径与高度按**落盘坐标**自己算，标签与假设都写着"近似"。这条同时回答了另一件没人问过的事：**编译器 / 草稿 / 渲染扛得住 96 顶点 50 面这个规模**。
- 读数：`localPlanDefaults.test.ts` **3/3**、`localPlanner.test.ts` **58/58**（+1）、该 e2e **1/1**；全库非 Lean **3959 通过 + 1 todo / 0 失败**（150.18 s，**+4**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **仍未做**：把圆台作为**模型可选的动作**（今天它经本地规划器可达；让模型自己写 96 个顶点是另一回事，属产品决定）。

## 2026-10-07 —— S4.3 第一刀：**圆台**的内核构造（多边形近似，与圆柱 / 圆锥同一套口径）

- 新增内核构造器 `roundFrustum`（`buildSolid("roundFrustum", {center, radiusBottom, radiusTop, height, segments})`）：两个平行圆面 + 侧面四边形的**多边形近似**，分段口径照抄 `cylinder` / `cone`（默认 48、上限 256）。
- **两条口径写进代码**：
  - **它是近似，就必须叫近似**：注册表的标签是"圆台**近似**"，与"圆柱近似""圆锥近似"同一措辞 —— 用户要的是看得见、量得出的圆台，不是一只假装自己是圆的 48 边形；
  - **两个半径相等 ⇒ 明确拒绝**（`invalid-input`，理由里写 "equal radii make a cylinder"）。画一只叫"圆台"的圆柱就是本仓最忌讳的**悄悄改题**。
- **判据不读自述**：用例从**落盘的顶点坐标**自己算 —— 下底 64 个点到轴心等距 `R`、同高；上底等距 `r`、`z + h`；面数 `segments + 2` 且每个侧面都是**四边形**（三角形的话那是圆锥）；最后**算体积**并与解析公式 `πh(R² + Rr + r²)/3` 比 —— 多边形近似应当**略小**且误差 2% 以内。这一条才真正说明"它是一只圆台"，而不是"两个同轴圆环叠在一起"。
- **变异**：把上底半径改成下底半径（也就是画成圆柱）⇒ 用例当场红（`expected 2 to be close to 1`）；还原复绿。
- 读数：该文件 **37/37**（+2）；全库非 Lean **3955 通过 + 1 todo / 0 失败**（150.04 s，**+2 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **仍未做（S4.3 的其余部分）**：圆台的**文档路径**（DSL 图元 / 动作 / 模板清单 —— 需要一次单独的产品决定，因为它是"新增一种近似实体"）；以及设计点名的"**在文档与面板上如实声明是近似**"（今天只有内核的标签与注释声明了）。

## 2026-10-07 —— S5 核验：**"这只球还是不是它宿主的球"** 成为一条读数（直接几何，不问求解器）

- 新增 `derivedSphereLink.ts`：从文档**自己的坐标**复核每一只派生球，三种结果 ——
  - `holds`：它就是宿主的球（外接球：球心到**每个**顶点等距且等于半径；内切球：球心到**每个**面等距且等于半径）；
  - `violated`：**直接几何说不成立**（球被改过 / 重算没跑到），理由里**两边的数都写出来**（到顶点的距离 vs 这只球的半径；或最远 / 最近的差）；
  - `outdated`：宿主**现在没有**这种球了（顶点被拉走）⇒ 画面上那只是**上一次能解出来的那一个** —— 这正是"保留上一次几何、不伪造近似球"那条口径的必然结果，**不是缺陷，但必须说出来**。
- **判据刻意不读求解器**：那只球本来就是 `solveCircumsphere3` / `solveInsphere3` 算出来的，**拿它复核它自己等于没复核**（同一个 bug 会同时出现在两边）。求解器在这里只回答另一个问题 ——"宿主现在**还有没有**这种球"（存在性），那个问题它才是权威。设计 §4.1 的原话是"外接球核验**到各顶点等距**、内切球核验**到各面相切**"，所以这里**自己算距离**。
- 接进 `solidStatusReport`：**只在出问题时**多一行 `derived.sphere_stale`（`solidId` = 宿主、`sourceId` = 是哪只球，与 `derived.section` 的记法一致）。没问题时**一行噪声都不加**。
- 意义：设计那条"**物化但不重算被否决**"从此不只是"我们避开了"，而是"**过期了看得出来**" —— 用户与模型读到的都是文档，这条读数就在文档上。
- **两次只有 `typecheck` 拦得住的错**（vitest 全绿的那种，本轮各一次）：① `DerivedSolidResult` 的非精确支不止一种，`undefined`/`degenerate` 带 `reason` 而 `approximate` 带 `residual` ⇒ 直接读 `.reason` 是 `TS2339`；② `SolidBoundary` 的字段是 `readonly` 数组，传给"可变数组"形参是 `TS2345`。
- 读数：该文件 **4/4**；**变异**（短路"等距且等于半径"那条判据）⇒ `violated` 用例红（`expected [] to have a length of 1`），证明判据在咬；全库非 Lean **3953 通过 + 1 todo / 0 失败**（147.19 s，**+4 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **仍未做**：面板/画布对派生球的**专门呈现**（读数已经能报"过期了"，但界面上还没有那一行）；浏览器里"拖宿主 ⇒ 球跟着变"的操作路径（R17 试了三次没成，单元层有证据）。

## 2026-10-07 —— S5 浏览器证据：**外接球真的出现在画布上，而且落盘的球真的是外接球**

- 新增**代表题五**（`PYRAMID_CIRCUMSPHERE_PROMPT` = 四棱锥那句 + `的外接球`）：同一只四棱锥，**多一笔派生动作** `derived.create_circumsphere`，宿主写成**草稿内引用**（`{scope:"draft", alias:"pyramid"}`）。球心与半径**不在计划里**。
- 新增 `e2e/agent-derived-sphere.spec.ts`（**1/1 通过**）：核验面板 `passed`、假说明确写着"外接球由内核从四棱锥的五个顶点解出来"；提交后从 `.mgeo` 草稿里读**真实落盘**的顶点与球，**自己算**"球心到每个顶点等距且等于半径" —— 不读面板结论、也不读构造方的自述。对象列表里确认它在。
- **一个没做成的步骤，如实记**：想在浏览器里拖**宿主**、看球跟着变，试了三次（拖多面体顶点 / 拖实体 / 先选中对象行再拖）**都没让实体动起来**。所以这条**没写成通过**。它在**单元层**有证据（`derivedSphereRule.test.ts`：移动四面体一个顶点后球心独立解出 `(1,1,2)`、到四顶点等距、依赖链 `顶点 → 实体 → 球` 钉住）；缺的是"这一版界面上怎么把宿主弄动"的操作路径 —— 记为待办。
- **又撞上那条标签缺陷**（R10 记过、待裁决）：计划里 `vertexNames: ["P","A","B","C","D"]`，落盘标签却是 **`A…E`** —— 画布标签**按位置顺延**、与 `vertexNames` 无关。所以本用例的几何判据一律走**拓扑下标**，并把标签不一致**逐字钉住**。
- **一次只有 `typecheck` 拦得住的错**（vitest 全绿）：`PlanEnvelope` 是**判别联合**，我直接 `...plan` 并读 `plan.actions` ⇒ `TS2339`。修法是先收窄到 `kind === "plan"` 那一支 —— 又一次印证"vitest 不做类型检查"。
- 读数：该 e2e **1/1**；`localPlanner.test.ts` **57/57**；全库非 Lean **3949 通过 + 1 todo / 0 失败**（154.29 s）；`typecheck` exit 0（修联合收窄后复跑）；`lint` 0 error / 13 warning。

## 2026-10-07 —— S5 开闸：把派生球**交给模型**（外接球 / 内切球进入空间建模技能）

- `spatial-modeling` 技能的 `actionIds` 加上 `derived.create_circumsphere` / `derived.create_insphere`，自述里补一句**怎么用**：`solidId` 写**宿主实体的引用**（`{scope:"draft",alias:…}`），球心与半径**由内核算、不用给也不收**；宿主没有对应的球（例如长方体没有内切球）时那笔会**当场拒绝**，并且**明说不要改用 `solid.create_sphere` 编一个球**。
- **开闸之前先把接缝修好了**（上一批）：否则模型每次调用都会被校验层拒，而且理由会说"引用没作用域"，把矛头指向模型。顺序本身就是结论：**先修接缝，再开闸。**
- **清单是要签名的**：改 `actionIds` 必须重签 `EXPECTED_HASHES`（哈希只覆盖**语义**内容：动作名与上限，改文案不影响）。这一次是 `catalog.test.ts` 的 `hash_mismatch` 把我拦住的 —— 机制按设计起作用；新哈希用 `manifestHash(manifest)` 现算（`npx tsx` 一次性算出，没有往仓库里加依赖）。
- `agentRuntime.test.ts` 里那条**逐字钉住可用动作清单**的用例同步更新（现在 9 个动作），并把"为什么这两个是 2026-10-07 才补的"写进注释。
- 读数：技能目录 + 运行时 + 输入校验三个文件 **55/55**；全库非 Lean **3949 通过 + 1 todo / 0 失败**（153.93 s）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **如实记其性质**：这是一次**行为变更** —— 模型看到的工具箱变了。本地规划器/e2e 不依赖这份清单，所以本地读数不会因此改变；但**真实 provider 的质量基线要重测**才谈得上结论（那需要用户批准付费运行，属 §四 的未完成项）。
- **仍未做**：派生球在**面板与画布**上的呈现（今天它会正常落盘并被渲染成球——`sphere` 图元本来就有渲染路径 —— 但没有针对"这是一只派生球"的专门读数或提示）。

## 2026-10-07 —— 修掉上一批"只在测试里成立"的缺陷：派生球的宿主字段是**作用域引用**

- **上一批我发出去的动作，规划器其实填不进去**。`derived.create_circumsphere` / `derived.create_insphere` 的 `solidId`：
  - 校验层收的是**作用域引用**（`{scope:"draft", alias}` 或 `{scope:"scene", ref:{documentId, entityId}}`，与 `dynamic.create_bound_point` 的 `host` **同一套**），我却写成了 `boundedString` —— 一个对象进来会被判 `invalid_type`；
  - 编译层读的是**已解析**的 `{documentId, entityId}`（"引用解析"那一层的产物），我却在编译里把这个字段当裸 id 去查实体。
  - 两处叠起来，**规划器/模型根本没有办法引用宿主**；而我的单元用例是**直接构造动作对象**交给 `compileActions` 的，**绕过了校验层**，所以全绿。这正是"vitest 不查类型、也不替你走接缝"的又一种表现。
- 修法三处：动作层类型 `solidId: SceneReference`；校验层改 `readScopedReference`；编译层读 `inputs.solidId.entityId` 并**先核文档身份**（拿别的文档的 id 算球，会算出一只与眼前这张图无关的球 ⇒ `host_not_found`）。
- **补一条走接缝的用例**（这才是防复发的关键）：`actionSchemas.test.ts` 新增一条 —— `{scope:"draft", alias}` 收得下、`{scope:"scene", ref}` 被摊平成 `{documentId, entityId}`、**裸字符串被拒且路径落在 `tool.inputs.solidId`**。教训写进代码注释：**"直接构造动作对象"的用例看不见校验层，凡是新动作都要有一条从 `parseActionToolInput` 走的用例。**
- 读数：`derivedSphereCompile.test.ts` **4/4**（宿主引用按已解析形状给，另加"引用指向别的文档"这条反例）；`actionSchemas.test.ts` 全绿；全库非 Lean **3949 通过 + 1 todo / 0 失败**（154.17 s，**+1 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。

## 2026-10-07 —— S5 第二刀：**派生球成为可编译的动作**（外接球 / 内切球，解不出就拒绝）

- 新增 `derived.create_circumsphere` / `derived.create_insphere`：输入**只有宿主实体的 id** —— 球心与半径由内核从宿主算出来（`solveCircumsphere3` / `solveInsphere3`，与 `solidStatusReport` 给模型看的那两条读数**同一个求解器**）。**不让调用方填球心半径**：填得出来就等于允许编一个不成立的球。
- **五层一次贯通**（工具链按设计逐个逼出来）：动作层 `types.ts`（两个 id 各一个接口）、`actionIds.ts`、`actionRegistry.ts`（两条 spec，`solidId` 走**作用域引用**）、`actionInputs.ts`（只收 `solidId`）、`actions/index.ts`（`compileDerivedSphereAction` + 分派）、`skills/manifest.ts`（`Record<DraftActionId, …>` 守卫直接编译失败，逼我补上能力映射）。**`actionAudit` 里那两条"认得出但承载不了"随之删除**，笼统的 `derived.create_sphere` 仍留着并说明"要哪个球就说哪个"。
- **解不出来就拒绝整条动作**（设计 §4.1）：长方体没有内切球时**一条操作都不产出**，诊断说清"这只实体没有内切球" —— 不许把半径 1 的"最大内接球"当内切球交出去。这与"已经存在的球在宿主动了时保留旧几何"不冲突：那是**跟踪**，这里是**新造**。
- 落盘的球带 `derivedFrom` 绑定 ⇒ 此后跟着宿主重算（不会退回"物化但不重算"）。用例（4/4）：立方体外接球 `(1,1,1)`/`√3`、内切球 `(1,1,1)`/`1` 且绑定逐字正确；长方体内切球拒绝 + 诊断；缺宿主 / 非立体工作区各自诊断。
- **三次自己踩的坑（都记下）**：① 我用 **PowerShell 文本替换改源码**（本仓明令禁止）⇒ 文件变成**非法 UTF-8**、读都读不了，只能删掉重写 —— 那条规矩正是为这个存在的；② `compileActions` 参数写反（真实签名 `(文档, 动作, 上下文)`），红读数 `actions is not iterable` 纠正；③ 反例夹具写了 `workspace = "geometry"`（`Workspace` 里没这个值）—— **vitest 全绿、只有 `typecheck` 拦得住**，又一次印证"vitest 不做类型检查"这条老账。
- 读数：全库非 Lean **3948 通过 + 1 todo / 0 失败**（153.35 s，**+4 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning（**修正 workspace 字面量后复跑**）。
- **仍未做**：这两个动作**还没交给模型**（不在空间建模技能的动作清单里 —— 那会改可用动作与提示词，属需要单独测量的行为变更）；派生球在**面板与画布**上的呈现。

## 2026-10-07 —— 定性上一批留下的缺口：**长方体根本没有内切球**（不是夹具错、也不是求解器错）

- 上一批把"手工盒子的内切球返回 `undefined`"记成待查（夹具面绕向 or 求解器）。**查清了**：
  - **不是绕向**：内切球求解器按"面心相对形心的方向"把每个面法向**翻成朝外**（`solidDerived.ts` 那一步），所以绕向不影响判据。我按绕向"修"了一版，红读数**原样不动** —— 那正是"我的假设错了"的证据（写进用例注释，免得下次再猜一遍）。
  - **也不是求解器错**：`2 × 4 × 6` 到三对面的距离是 `1 / 2 / 3`，**没有到六面等距的点** ⇒ 它**根本没有内切球**。规格 §3.4 的口径正是"不满足时返回 `undefined`"：把半径 1 的**最大内接球**交出去会被用户读成"这个盒子的内切球半径是 1"，而那句话是错的。
- 用例因此按**口径**拆开：正例用**立方体**（到六面等距 ⇒ 外接球 `(1,1,1)`/`√3`、内切球 `(1,1,1)`/`1` 两条都精确）；**长方体**只断言外接球精确，并**显式钉住"没有内切球 ⇒ 保留占位几何"**（不交近似球）。
- 这条区分值得写进文档：**"内切球"= 到每个面都等距**，不是"最大的内接球" —— 两者的差别在长方体上正好可见。
- 读数：`derivedSphereRule.test.ts` **4/4**；全库非 Lean **3944 通过 + 1 todo / 0 失败**（152.86 s）；`typecheck` exit 0；`lint` 0 error / 13 warning。

## 2026-10-07 —— S5.1 第一刀：**派生球接进依赖图与重算**（球是派生量，不是抄下来的数）

- **先查"是不是已经有别的机制在做"**（本仓的老账）：**球的两个解早就在内核里** —— `solveCircumsphere3` / `solveInsphere3`（`solidDerived.ts`，三值口径 + "解不出来给 `undefined` 而不给近似"），`solidStatusReport` 也已经把它们当**读数**报给模型（`derived.circumsphere` / `derived.insphere`）。缺的从来不是几何，而是**承载它的对象与重算路径** —— `actionAudit` 里那句"内核能解，但 DSL 还没有承载球的图元与重算路径"就是缺口原文。
- 按 **2D 派生圆**那份既有先例（`CirclePrimitive.radiusFrom`）照做，一共三处：
  - DSL：`SpherePrimitive.derivedFrom?: { kind: "circumsphere" | "insphere"; solidId }` —— `center` / `radius` 从此是**派生缓存**；
  - 依赖图：`sphere` 依赖宿主实体**一条边**就够（实体已经依赖它的顶点 / 棱 / 面，`getAffectedPrimitiveIds` 取传递闭包 ⇒ "拖一个顶点 ⇒ 实体 ⇒ 球"整条链自动成立）；多写"球 → 每个顶点"反而会绕过实体那一层；
  - 重算：`recompute.ts` 的 `sphere` 分支用**与 `solidStatusReport` 同一个求解器**（否则"面板说有这么个球"与"画布上那个球"会是两个结论）。**解不出来就保留上一次的几何**，不伪造近似球 —— 与"来源解析不了就保持不动"的既有约定一致。
- **判据自己算**（`derivedSphereRule.test.ts`，4/4）：盒子外接球 = 包围盒中心 + 半对角线（`(1,2,3)`、`√14`）；四面体移动一个顶点后**独立解出**球心 `(1,1,2)`、半径 `√6`（对称性 + 等距方程），并拿这个球心去量四个顶点证明它真的过它们；依赖链 `["p-d"] → 球` 成立；无解时保留上一次几何。
- **一条如实钉住的缺口**：同一个手工盒子的**内切球**走 `solveInsphere3` 得到 `undefined`（探针读数 `8v/6f undefined`）。两种可能（我的夹具面绕向不一致 / 求解器对这类输入有缺口）**本批不替它选**，只把当前行为钉住并记为待查。
- **两次自己踩的坑（如实记）**：① 先用 `patch: { position: … }` 移动顶点 —— 那个 op 的字段是 **`position3`**（或直接用 `patchPoint3` 助手），于是"球没动"的红读数其实在说"顶点没动"；② 最初把内切球也当成应当精确，红读数才把上面那条缺口暴露出来。
- 读数：`derivedSphereRule.test.ts` **4/4**；全库非 Lean **3944 通过 + 1 todo / 0 失败**（153.52 s，**+4 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。CI 另核：**#198 / `951b4bb`、#197 / `9b8bc9b` 四 job 全绿**。
- **仍未做（S5 的其余部分）**：**创建**这种球的动作与界面入口（`derived.create_circumsphere` / `derived.create_insphere` 仍只在 `actionAudit` 里作"未实现"声明）；球在面板上的读数与画布渲染；圆台近似（S4.3）。

## 2026-10-07 —— S6.4 浏览器证据：台体 / 五棱锥走界面路径（并查实**标签不跟题面**这条缺陷）

- 新增 `e2e/agent-solid-family-path.spec.ts`（3 条，全绿）：① 台体题面在开关打开时**核验面板 `passed`**、可确认，落盘坐标**自己算一遍**是台体（底面环首直角、两底平行且顶面在上、**顶棱 = 底棱 × 同一比例且 < 1**）；② 五棱锥落盘是**五个互不重合的共面点**且 `PA ⊥ 底面`；③ 开关关闭时同一句**不产出草稿、不占撤销历史**（"认不出一律问路、不改文档"的浏览器判据）。
- **查实两条缺陷，都是这个文件跑出来的**（此前只在文档里写着"可能"）：
  - **画布顶点标签是按位置顺延的字母，与 `vertexNames` 无关**。实测：`P-ABCDE` 的顶点在草稿里叫 **`F`**；棱柱/台体的 `A′…D′` 变成 **`E…H`**。后果具体到用户：`P-ABCDE` 这套点名在画布上**不存在**，而核验面板按 `vertexNames` 核过题设 —— **"面板说通过"与"用户看到的点名"不是同一套**。修法（标签跟随 `vertexNames` / 扩标签词表）牵动动作编译与渲染，属**待裁决**；本批只用下标判几何 + 把不一致逐字钉住。
  - **自由标量的文案会误导**：台体的假设行原样打印 `targets`，于是出现 `A′ = 2`（其实是**高**）与 `A′B′C′D′ = 0.5`（其实是**相似比**）。已修：高写"高"、相似比写"顶面相似比"，底面边仍写点名。
- **一次自己写错的判据**（如实记）：五棱锥那条我先把"直线 ⊥ 平面"写成**点积为零**——方向写反了（直线垂直于平面 ⇒ 方向向量与法向**平行**，消失的是叉积）。用例当场红（`Received 1.3143`），改成"叉积 ≈ 0 且 |点积| 取满"后通过。
- 读数：该 e2e 文件 **3/3**；全库非 Lean 与 lint 见下条提交说明；`typecheck` exit 0。

## 2026-10-07 —— S6.3：入口语法接进**界面路径**（规划器认整族形状说法）

- `localPlanner` 新增意图 `solidShapeIntentFor`：题面里认得出形状从句（`在四棱台ABCD-A′B′C′D′中` 这类）时，走**入口语法 + 见证搜索**那条线，产出真的 `solid.create_polyhedron` 动作。于是**台体与五 / 六棱锥第一次有了界面路径**（此前只有离线入口 / 救援路径可达）。
- **顺序是刻意的：夹具优先**。这条兜底放在精确夹具**之后** —— 夹具是逐字钉住的代表题，让形状族抢先会把它们从既有路径上挤走（那是行为变更，不是新增）。用例里钉住这一点：`在三棱柱…` 仍产出 `solid.create_prism`（既有棱柱夹具用的是**宽松**触发词 `all: ["棱柱", …]`，任何棱柱题面都被它先接走 —— 所以这一层的实际增量只剩台体与五 / 六棱锥）。
- **V0a 的地盘不抢**（这条是**被两条既有用例逼出来的**）：我最初的兜底把 V0a **刻意拒绝**的题面（带 `自由点 / 任取点` 的、或带"D 在底面 ABC 上方"这类空间条件的）也接过来画了 —— 那等于用另一端悄悄推翻 V0a 的拒绝口径，是**行为变更**。守卫取整个**三棱锥族**：三棱锥归 V0a（它的拒绝口径是按这个族写的），这一层接四 / 五 / 六棱锥、台体。
- **开关纪律**：这条意图挂在既有实验开关后面，**开关关着一律不认**（照旧"老实问路"）—— 实验路径不许在默认路径上生效。
- 变异：把兜底短路 ⇒ 「开关开着」那条当场红（`expected null not to be null`）。
- 读数：`localPlanner.test.ts` **57/57**（+5）；全库非 Lean **3940 通过 + 1 todo / 0 失败**（152.26 s，**+5 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 14 warning（其中一条是我留下的未用常量，已删）。
- **仍未做**：`freeApexIntentFor` 窄正则退役（今天两条路并存，各有各的地盘）；"问路"的浏览器判据；圆台近似口径（S4.3）；S5 球关系。

## 2026-10-07 —— S6.2：入口语法接进**离线入口**（台体第一次从题面走通到通过核验的候选）

- `witnessSearchInput`（`planCompiler.ts`）—— **救援路径与离线入口共用的那一处** —— 现在先问入口语法（`specForPrompt`）：认得出形状从句时，**族与 spec 都由它给**；认不出时退回"题面提到哪个词"那条更弱的正则。**接线之前的行为逐字不变**（`planCompiler` / benchmark / 搜索三处 105 条用例原样通过）。
- **台体因此第一次能从题面走通**：`在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台` ⇒ `searchWitnessForPrompt` ⇒ **`verified_instance`**。接线之前 `棱台` 落到"任意多面体"那条，只会报"系统尚不支持"。
- **兜底也认 `棱台`** ⇒ 报 `frustum`（而不是"任意多面体"）：于是读不出的台体题面拿到的理由是**台体自己的那句**（"需要底环 / 顶环 / 相似比"），而不是对台体来说是假话的"任意多面体的坐标要由调用方给"。
- 变异：把 `witnessSearchInput` 恢复成"只用正则" ⇒ 台体那条用例当场红（`unverified_instance` + "台体需要调用方给出形状描述"）—— 证明这条接线是承重的。
- 读数：`planCompiler.test.ts` **57/57**（+3）；全库非 Lean **3935 通过 + 1 todo / 0 失败**（152.31 s，**+3 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **仍未做**：`localPlanner` 里"用户在界面上说一句就出草稿"那条路径（今天台体只在**离线入口 / 救援路径**可达，规划器夹具还没接）；`freeApexIntentFor` 窄正则退役；"问路"的浏览器判据。

## 2026-10-07 —— S6 接线：**题面 → 形状描述 → 通过核验的候选**（台体整条链走通）

- 新增 `specForPrompt(prompt, givens)`（`witnessSearch.ts`）：把**入口语法**（`parseShapeClause`）、形状推导、自由标量表三样接起来。规划器与离线 benchmark 都从这里拿 spec，再交给 `searchWitness({ shape, spec })` —— **一份解析两处用**，两个读数才可比（设计 §3.2）。
- **台体的两个环只能来自入口语法**（它的几何不是从某一句题设读出来的），所以这条链对台体是**唯一**入口：`在四棱台ABCD-A′B′C′D′中，AB⊥AD` ⇒ spec（底环 + 顶环 + 相似比 `0.5 / 0.6 / 0.75`）⇒ **`verified_instance`**，用例自己量顶棱短于底棱、两底平行。
- **"两处各读一遍"的交叉校验**：形状从句与"侧棱 ⊥ 底面"那句各读一遍，读出来的底环**不是同一组顶点** ⇒ **问路**，不挑一个信。顺序可以不同（环首由内核规则定），**集合不同**说明有一边读错了。
- 变异：把这条交叉校验短路 ⇒ 反例当场红 —— 返回 `ok`，spec 的底环是 `[E,F,G]` 而题面写的是 `ABCD`，正是它要拦的**静默错配**。
- 读数：搜索 + 语法两个文件 **53/53**（+4）；全库非 Lean **3932 通过 + 1 todo / 0 失败**（151.70 s，**+4 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **仍未做**：把这根线接进 `localPlanner`（今天规划器仍走既有夹具，`freeApexIntentFor` 的窄正则也未退役）；"问路"的浏览器判据；圆台近似口径（S4.3）。

## 2026-10-07 —— S6 第一刀：入口语法模块 `shapeGrammar`（认形状说法，认不出就问路）

- 新建 `packages/agent-core/src/solver/shapeGrammar.ts`（设计 §3.2 表里的**第一层**）：把题面里那段 **`在…中` 从句**认成形状 —— `在[正|斜|直]?[三四五六]?（棱锥|棱柱|棱台）<点名表>中`。棱锥是"锥顶-底环"（`P-ABCD`），棱柱/棱台是"底环-顶环"（`ABCD-A′B′C′D′`）。
- **逐条核，任一条不成立就返回 `null`（= 问路）**：每个名字都得是本仓点名（含 `A′` / `A₁` / `A′′`）；底环 3–6 个点名（内核上界）；中文数词必须与环长一致（写"四棱锥"却给 5 个点名是**题面自相矛盾**）；棱柱 / 棱台的顶环必须与底环**逐一对应**（`A′` ↔ `A`，与内核 `withPrimes`、S4.2 是**同一条规则**，用 `canonicalPointName` 归一所以 `A'` 也认）；锥顶不许同时是底面顶点。
- **两条有意的不认**：① **球与多面体的关系**（`在球O中…`）—— S5 还没落地，认一个现在**造不出来**的形状只会把"做不到"推后到更深的层，那时错误信息离用户更远；② **没有 `在…中` 从句的说法**（`底面边长 2 的棱柱`）—— 没有点名表就产不出 spec，而替用户编一套点名正是本仓最忌讳的悄悄改题，这类继续走既有夹具。
- **变异**：把"顶环逐一对应"整段短路 ⇒ `ABCD-A′C′B′D′` 那条反例当场红（`expected {family:'prism',…} to be null`）—— 没有它就会把**错位的顶环**当成一个合法棱柱认下来。
- 读数：该文件 **15/15**；全库非 Lean **3928 通过 + 1 todo / 0 失败**（151.60 s，**+15 = 新文件**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **仍未做（S6 的其余部分）**：① 把识别到的形状**组装成 `SolidShapeSpec`**（自由标量 + 关系来自解析器）并接到 `searchWitness`；② `localPlanner.freeApexIntentFor` 的窄正则退役、改调本模块；③ 分析题 / 非立体题的**问路**浏览器判据。

## 2026-10-07 —— S4.2：上下底的**对应关系**说不清就明确拒绝（不按顺序硬配）

- 台体的顶环必须**逐一对应**底环：点数不同 ⇒ 拒绝；任一位对不上 ⇒ 拒绝。判据就是命名约定（`A′` 对应 `A`），与内核 `withPrimes` 派生顶面名的那条规则**同源** —— 一份规则，两处用。
- **显式不做的事**：**不按顺序硬配**。`ABCD-A′C′B′D′` 这种写法点数一样、名字错位，硬配会画出一张**顶环错配**的图，而且看起来还挺像那么回事 —— 那正是这条守卫要拦的。
- 变异：把对应判据短路（`if (false && …)`）⇒ 两条反例用例当场红（`expected 'candidate' to be 'rejected'`），证明没有它就会**静默造出**错配的图；还原复绿。
- 读数：内核该文件 **41/41**（+3）；全库非 Lean **3913 通过 + 1 todo / 0 失败**（151.38 s，**+3 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **S4 出口三条已兑现两条**：正例成立 ✓、上下底关系说不清 ⇒ 明确拒绝 ✓（`unsupported-base-shape`）；**仍缺**圆台的多边形近似口径（S4.3）。

## 2026-10-07 —— S4 搜索层：台体走"调用方给形状描述"那条路（并把候选池抽成泛型）

- `WitnessSearchInput` 新增可选 `spec?: SolidShapeSpec`（**调用方给的形状描述**）：有它时搜索层**不再从题面推形状**（那是入口语法 S6 的活），直接按 spec 枚举自由标量、交内核 `constructShapeFromSpec` 构造。**`family` 与 `shape` 不一致 ⇒ 明确拒绝**（不猜哪一个对）；没有它时行为与从前**逐字相同**（31 条既有用例原样通过）。
- **台体的正确入口就是它**：台体的几何不是从某一句题设读出来的（棱锥/棱柱靠"侧棱 ⊥ 底面"那句定底环与拉伸），所以没有 spec 的 `shape: "frustum"` **如实拒绝**，并说明"需要调用方给底环 / 顶环 / 相似比"。
- **候选池抽成泛型**：从"写死两条底边 + 高"改成**对 spec 里每个自由标量做笛卡尔积**（按 spec 顺序、seed 决定取值顺序），只保留一条特例 —— 两条自由底边不许取相等（不许顺手把底面做成正方形）。于是台体的 `top-scale`（相似比）**不需要改编排层**就进了网格：这正是设计 §3.2"加新形状时不改编排层"要换来的东西。
- **端到端证据**：`shape: "frustum"` + spec ⇒ `verified_instance`，且用例**自己量**顶棱短于底棱、四个顶面点同高且高 > 0；另两条反例（没有 spec / family 不匹配）⇒ 明确拒绝。
- 读数：该文件 **34/34**（+3）；全库非 Lean **3910 通过 + 1 todo / 0 失败**（151.16 s，**+3 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。CI 另核：**#191 / `404e3c1`、#190 / `efab639` 四 job 全绿**。
- **仍未做**：圆台的多边形近似口径（S4.3）；"上下底对应关系说不清 ⇒ 拒绝"的**题面侧**判据（S4.2；内核侧已按命名约定派生顶面名）。

## 2026-10-07 —— S4 内核侧：**台体构造落地**（棱柱的平移 → 相似 + 平移）

- 新增 `constructFrustumWitness`：底面环 + **与底面平行**的顶面环，顶面是底面**按质心相似缩小 `scale` 倍**再平移得到的截面 —— 这正是"用平行于底面的平面截棱锥"的定义。走既有 `polyhedron3` 装配路径，**不新增 DSL 图元**（`packages/dsl/src/schema.ts` 未动）。
- **相似中心取质心而不是环首点**：换一个环首不应该改变这张图（同一个台体）。这条有变异证明 —— 把中心改成环首点 ⇒ 用例当场红（`expected +0 to be close to 0.5`，顶面顶点塌到底面顶点上）。
- **两条"这两个端点都不是台体"的守卫**：`scale = 1` 是棱柱、`scale = 0` 是棱锥顶点，所以相似比必须**严格**落在 `(0, 1)`，否则 `invalid-input` 明确拒绝（NaN / 负数一并拒）。
- **一条诚实的边界**：题面若点名侧棱长度（`AA′=5`），那个长度**不等于高** —— 侧棱还带水平分量，要与相似比联立才解得出高。本批**不做这个联立**，于是在 `constructShapeFromSpec` 里如实拒绝，绝不把侧棱长当成高用（那会画出一个错的台体还自称通过）。
- **判据不读实现**：用例自己重算质心、自己按 0.5 回代顶面坐标、自己比 `顶棱 = 底棱 × 0.5`、自己跑一遍拓扑装配；`{kind:"points"}` 拉伸来源照旧如实拒绝（与棱柱同源：底面顶点全在 z = 0）。
- 读数：内核该文件 **38/38**（+3）；全库非 Lean **3907 通过 + 1 todo / 0 失败**（151.29 s，**+3 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **本块只到内核**：搜索层的"题面 → 台体结构"、圆台的多边形近似口径、以及"上下底对应关系说不清 ⇒ 拒绝"的题面侧判据尚未做。

## 2026-10-07 —— S2.1 内核侧：内核按 `SolidShapeSpec` 构造（编排层的请求拼装退场）

- 内核新增 `constructShapeFromSpec(spec, choices)`：编排层只交**形状描述**与**它替自由标量选定的值**（`ShapeScalarChoice { id, value }`，id 与 `spec.freeScalars[].id` 对应）。未知 id **明确拒绝**（`invalid-input`），不凭空取值。
- **"取值 → 内核请求"那张翻译表搬进内核**：它整张都是内核词汇（`segment-length` / `WitnessHeightSpec` / `WitnessExtrusionSpec` 的两种拉伸来源）。留在编排层等于让每个调用方各维护一份内核词汇表 —— 与设计 §3.2"加新形状时**不改编排层**"直接冲突。
- **agent-core 删掉三处拼装代码**：`requestFor`、`heightSpecFromSpec`、`statedLateralHeight`；`PyramidStructure.heightSpec` 与 `PrismStructure.statedHeight` 两个字段一并删除（结构只留"底面环 + 顶点/垂足 + 关系 + 自由底边"）。`CandidatePlan` 从"带着一个内核请求"改成"带着 spec + 取值"。
- **"高是不是自由的"只在一处判**：内核导出 `shapeHeightIsFree(spec)`，编排层用它决定要不要把 `height` 列成自由标量 —— 否则这句话会在两处各写一遍，然后慢慢分叉。
- **行为逐字不变**：坐标护栏（四棱锥那五个坐标）与全部既有用例原样通过；新增两条内核用例：① spec + 取值与"手工拼请求"产出**同一组坐标**；② 未知 id 明确拒绝。
- **一次返工如实记**：删 `heightSpecFor` 时我漏了它本身（只改了调用点），`typecheck` 报 `Cannot find name 'WitnessHeightSpec'` 才逼出来 —— 与我上一批"机械替换漏调用点"是同一类错，教训也一样：**改完先跑 typecheck**。
- 读数：内核该文件 **35/35**（+2）；全库非 Lean **3904 通过 + 1 todo / 0 失败**（152.81 s，**+2 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- **用户裁决**：底面点名里已经用了 `A′` 时，顶面对应点叫 **`A′′`** —— 走**扩语法**那条路（"明确拒绝整道题"被否掉）。
- 词表随之扩到 **字母 + 至多两个后缀**：`A`、`A′`、`A₁`、`A′′`、`A′₁` 合法；**三层不算**（`A′′′`）。ASCII 数字后缀（`A′2`、`A1`）**任何时候**都不算。
- **内核命名改成"枚举词表内的候选 + 造不出就返回 `null`"**：`derivedNameCandidates` 按"先一层、再两层"的优先顺序给候选（底面已带一层时只剩一层可加 ⇒ 正好落在裁决点名的 `A′′`）；`withPrimes` 比较时按**规范字形**（`′` 与 `'` 是同一个后缀的两种字形，不归一就会出现同一个点以两种写法同时进表）；候选耗尽则**明确拒绝**（`unsupported-base-shape`），**不再硬拼** `A′2` 那种词表外的名字。
- **端到端证据**：题面 `在三棱柱A′B′C′-A′′B′′C′′中，A′A′′⊥平面A′B′C′`（**底面自己就带撇**）现在整条链走通、`verified_instance`。裁决前内核会退化出 `A′2`，核验器把整张点名表判为不可靠 —— 这条路**永远拿不到核验**。
- **变异**：把词表改回"只允许一个后缀" ⇒ **三层 4 条红**（词表自身 2 条、内核冲突用例 1 条、端到端棱柱用例 1 条 —— 后者连"侧棱 ⊥ 底面"这句都读不出来了）；还原复绿。
- 读数：定向 5 文件 / **123 通过**；全库非 Lean **3902 通过 + 1 todo / 0 失败**（120.39 s，**+3 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。

## 2026-10-07 —— S3 续：棱柱底面覆盖到 3–6 边（并钉住"满足不了就拒绝"）

- 补两条用例，把 S3 出口点名的底面覆盖做实：**六边形底面的直棱柱**产出通过核验的候选（与棱锥**共用同一条底面规则** —— 上一批把 `orderedBaseWithFreeEdges` 抽出来就是为了这个）；**五棱柱底面点名 `AB⊥BC`** 时仍拒绝，理由带机器可读的 `unsupported-base-shape`（正五边形代表满足不了它）。
- **仍未做，如实记**：**菱形底面**。四边形的底面现在只有"环首直角 ⇒ 矩形"这一条路；菱形要的是"四边相等"这类约束，内核还没有对应构造，所以**不算进已完成**。斜棱柱同样未做（等"环外点名顶点"概念）。
- 读数：该文件 **30/30**（+2）；全库非 Lean **3899 通过 + 1 todo / 0 失败**（147.91 s，**+2 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- 搜索层此前对 `shape: "prism"` **直接提前返回**，理由写在注释里：① "原话解析只保留单个大写字母（`A′` 会被截成 `A`）"；② "核验器的点名映射只接受 `/^[A-Z]$/`"。**两条都已由 S1.2 / S1.3 解开** —— 注释却还留着，正是本仓最警惕的那类"过期的话"。
- 新增 `derivePrismStructure`：从"侧棱 ⊥ 底面"那句读**底面环**（平面点名）与**拉伸方向**（垂足 → 顶面点）；底面环上的自由底边与棱锥**共用同一份规则**（把 `orderedBaseWithFreeEdges` 从 `derivePyramidStructure` 抽出来，两族各写一遍必然分叉）。
- **只做直棱柱**（`AA′⊥底面` 那句就是直棱柱的定义）：内核 `WitnessExtrusionSpec` 的 `{kind:"points"}` 分支**按设计不可用**（底面顶点一律建在 z = 0，`to − from` 必落在底面内 ⇒ 零体积判据），所以拉伸只能给向量 ⇒ **斜棱柱要等"环外点名顶点"的概念**。这条边界写在拒绝文案与代码注释里，不硬凑一个题面没说的形状。
- **顶面点名约定**：内核顶面命名由 `withPrimes` 生成（`A` → `A′`），题面写 `AA′` 与内核一致；写 `AA₁` 时**如实拒绝并说清怎么改**（"本批不做名字映射"）—— 不擅自把题面写的名字换掉。ASCII 撇 `'` 与 `′` 视为同一后缀的两种字形，比较前归一。
- 读数：该文件 **28/28**（新增 2 条：直棱柱通过核验、`AA₁` 的诚实拒绝）；全库非 Lean **3897 通过 + 1 todo / 0 失败**（148.47 s，**+2 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- 新增 `packages/geometry-kernel/src/witness/solidShapeSpec.ts`（设计 §3.1 的 `SolidShapeSpec` / `FreeScalar`，含 YAGNI 约束）并从内核 barrel 扁平导出 —— 这是四层共用的形状词汇。
- **搜索层的候选池改成读 spec**：`candidatePool(spec, input)` 的网格轴来自 `spec.freeScalars`（0–2 条 `base-edge` + 自由高），`requestFor(spec, …)` 由 spec 构造内核请求；**高的来源从 spec 自己的 relations 读回来**（`PA=10` 已被 `kernelRelations` 译成 `segment-length`）—— 于是不必在 spec 之外再夹带一个 `WitnessHeightSpec`，也就没有"同一个判断写两遍"。
- **口径写进类型注释**：`candidates` 只存**固定值表**；seed 决定的顺序留在搜索层（放进 spec 会让同一份形状描述随 seed 变形）。
- **行为逐字不变**：上一轮立的坐标护栏（`A(0,0,0) B(2,0,0) C(2,3,0) D(0,3,0)` + `P(0,0,1)`）**原样通过**；全库非 Lean **3895 通过 + 1 todo / 0 失败**（用例数不变 —— 本批只换载体）。
- **一处自己造的坑如实记**：替换 `requestFor` 时漏了 `grid.push` 那一行的调用点，`typecheck` 报 `Cannot find name 'structure'`，**18 条用例同时红**（同一个 ReferenceError）。教训：一次机械替换要么全改，要么先跑 `typecheck` 再跑测试 —— 这次是机器先抓住的。
- 读数：定向 3 文件 / **90 通过**（含坐标护栏）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- 计划 Task 2.1 的第一步按要求先做：把标准四棱锥题（`PYRAMID`）的**候选坐标钉成逐字快照** —— `A(0,0,0) B(2,0,0) C(2,3,0) D(0,3,0)` + `P(0,0,1)`。接下来把棱锥路径迁到 `SolidShapeSpec` 时，只要自由标量的候选顺序或取值变了，这条必须红。钉**坐标**而不是 assumptions 文案：文案会改，坐标是几何本身。
- **CI 如实记两条**：#181 / `05a8109` 与 #180 / `82e85ae` 四个 job 全绿；**#182 / `2532c1a` 整条 `cancelled`** —— 而那条提交里**确实有一个类型错误**。结论很直白：**取消 = 没有门禁拦住它**。上一轮是我自己补跑 `typecheck` 才发现的，**不能**把它记成"CI 会拦住"。
- 读数：该文件 **26/26**；`typecheck` exit 0。



- 补上计划里 S2 出口点名的两类用例：**六棱锥**端到端（`verified_instance`）与**反例**「题面在底面上点名了 `AB ⊥ BC`」（正五边形满足不了它 ⇒ **不给通过核验的候选**）。
- **反例的实际行为比我以为的更好，我原来的断言是错的（如实记）**：我先假设"构造层拒绝 ⇒ 候选池为空（`candidates=0`）"，跑出来是 **候选池照常枚举 3 个、每一个都在构造期被拒**，而且理由逐条落到用户面前：
  - `no-candidate-constructed: 3 个候选都在构造期被拒，没有得到任何可核验的坐标。`
  - `unsupported-base-shape: 底面点名了角度或平行条件，正 5 边形代表满足不了它，不换一个题面没说的形状。（3 个候选）`

  于是断言改成钉**用户看得见的那件事**：不是"给不出"，而是"**说得出为什么**、且带机器可读的 `unsupported-base-shape`"——给不出不是问题，说不出为什么才是。
- 读数：该文件 **25/25**；全库非 Lean **331 文件 / 3894 通过 + 1 todo / 0 失败**（147.21 s，**+2 = 本批两条新用例**）。



- 上一批只做了内核（底面支持 5 / 6 边），但读码查实**这条能力从产品路径走不到**，一共三道闸：① 解析器的平面子模式只认 **3–4 个**点名 ⇒ `平面ABCDE` 整句消失；② 搜索层的 `lineAndPlane` 只认 **5 / 6 个** targets（= 线段 2 + 平面 3/4）；③ 核验器的线面判据只处理"**恰好四点**"平面。
- **三道闸一起打开**（都按 3–6 的同一口径）：`PLANE_NAME` 扩到 3–6；`lineAndPlane` 收 5–8 个 targets；核验器改成"多余的点先核**共面**、再把前三点交给既有的线面残差"。
- **顺带修掉一处"假的自由"**：`derivePyramidStructure` 在 n ≥ 5 时仍按 `[3] : [2]` 取第三条边，把正五边形的**对角线 `AC`** 当成"系统自选的自由底边"。n ≥ 5 现在**没有自由底边**（正 n 边形由一条边长定全部，那条边长由内核写进 `freeValues`）。
- **RED 逐段暴露**（比一次性断言更有信息量）：第一版红在搜索层，报文是 `题面没有给出「某条线段 ⊥ 某个点名平面」的写法` —— **题面明明给了**（`PA ⊥ 平面 ABCDE`），是解析层没产出来；所以那句报错在多边形底面上是**误导**。补上解析层后，红转移到核验层（`点名缺失、图形退化或角度无法计算`）。
- **变异**：把核验器新加的 `planeCount` 写死成 3 ⇒ **9 条**红（新的五边形用例 + 既有的四边形平面用例），说明那条分支同时罩住 4 点与 5–6 点平面；还原复绿。
- 读数：定向 4 文件 / **109 通过**；全库非 Lean **331 文件 / 3892 通过 + 1 todo / 0 失败**（148.47 s，**+1 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- 用户裁决的首批范围是**任意 3–6 边底面**；内核 `deriveBasePolygon` 此前对 n ∉ {3,4} 一律拒绝（`首批只支持三 / 四边形的底面`）。
- 现在 n = 5 / 6 先分流到新的 `deriveRepresentativePolygon`：题面**没限定**底面形状时取一组**正 n 边形** —— 与三角形的"普通三角形示例"同一个口径（欠定就给一张符合直觉且满足全部**可核**条件的图），并在 `assumptions` 里写明"这是系统自选的代表形状，不是题面唯一确定的图形"。
- **满足不了就拒绝，绝不换形状**：题面点名了底面上的**角度或平行**条件 ⇒ 拒绝；环上给了**两个不同**边长 ⇒ 拒绝。**RED→GREEN**：新用例先红，实收 `"首批只支持三 / 四边形的底面，收到 5 个顶点。"`。
- **变异**：把那道"点名了角度就拒绝"的守卫短路 ⇒ **既有的**五边形用例当场红，而红的内容正是"题面明说 `AB ⊥ AE`、系统却给出正五边形"（`candidate` 而非 `rejected`）—— 本仓最忌讳的"悄悄换一个题面没说的形状"。还原复绿。
- **两处被机器逼出来的修正（如实记）**：① 正六边形的 `sin(π) = 1.2e-16` 触发内核**"量级跨度过大"**守卫被**如实拒绝** —— 修在**构造侧**（浮点噪声按回 0），没有放宽那条守卫；② 我把 `statedLength` 的返回值当成了数字，`typecheck` 报 `WitnessStatedValue` 不可赋给 `number` —— 改成按 `value` 去重、用 `raw` 出文案。
- 读数：内核该文件 **33/33**；全库非 Lean **331 文件 / 3891 通过 + 1 todo / 0 失败**（148.50 s，**+1 = 新用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。
- **本块只做了底面**：`SolidShapeSpec` 骨架与棱锥路径迁移（计划 Task 2.1）**尚未开始**；关旗旧路径因此未受影响。



- **块级变异**（把共享词表里的**撇**那一支去掉、只留下标）：**三层同时变红、共 5 条** —— 词表自身 2 条、内核顶面命名 2 条（含正常路径"名字逐个合格"那条）、核验器 1 条。
- **变异逼出一个我自己的覆盖缺口**：那一轮里**解析层全绿** —— 说明"解析器认撇"此前没有任何用例真的咬住过（S1.2 写用例时我把撇那条替换成了下标版，撇这一支因此失去覆盖）。已补一条撇的解析用例，并且**是在变异态下先看到它红**（`expected [] to deeply equal [ 'perpendicular' ]`）再还原的。
- **关旗逐字不变契约复跑**：`planCompiler.offPath.golden.test.ts` **13/13** —— S1 的"现有行为逐字不变"有判据支撑，不是靠"我觉得没影响"。
- 读数：定向 5 文件 / **102 通过**；全库非 Lean **331 文件 / 3890 通过 + 1 todo / 0 失败**（148.65 s，**+1 = 新补的撇用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- `withPrimes` 不再自己写撇字符：`POINT_NAME_PRIME` 从 `pointNames` 取 —— "点名由哪些字符组成"现在只有一处定义（与 `POINT_NAME_SOURCE` 是同一件事的两面）。
- **查实一处真缺口（本块不擅自修）**：`withPrimes` 的冲突回退产 `A′2` / `A′′`，两者都**不在**共享定义里（点名 = 一个字母 + **一个**可选撇或下标）。后果是核验器的 `vertexNames` 检查会把**整张表**判为不可靠 ⇒ "底面本身就带撇"的棱柱拿不到逐条核验（fail-closed，不是静默通过）。
  - **两条修法都需要裁决**：① 扩语法（允许第二个后缀，`A′′` / `A′₁` 合法）；② 明确拒绝这种底面并给 `code`。**不擅自选** —— 那会改掉一个被注释与用例同时钉住的行为。
  - **证据落成断言**：正常路径产出的名字**逐个**满足共享定义（新增断言）；冲突路径今天那两个不合格名字**逐字**记下来，并注明"记录不等于认可 —— 谁动这里就得同时处理这个缺口"。
- 读数：定向 4 文件 / **88 通过**；全库非 Lean **331 文件 / 3889 通过 + 1 todo / 0 失败**（126.73 s，**用例数不变 = 本批只给既有用例加断言**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- `diagramVerification.ts` 的两处点名判断（`candidatePoints` 的 `vertexNames` 检查、扫 `label` 的那一步）都从 `/^[A-Z]$/` 改为内核的 `isPointName` —— 与解析层（S1.2）**同一份**定义；注释里那句"点名形状是 `[A-Z]`"也一并改对。
- **RED 先写、真红**：两条正例（下标 `A₁`、撇 `A′`）实现前实收 `expected 'unverified' to be 'passed'` —— 点名表建不出来时 `candidatePoints` 返回 `null`，所有依赖点名的题设一律落成"候选图缺少唯一、可靠的顶点名映射"。
- **两处调用点各有证据**：`vertexNames` 那处由**实现前的红**证明；`label` 那处由**变异**证明 —— 把 label 检查改回 `/^[A-Z]$/` ⇒ `O₁` 那条当场红（`unverified` vs `passed`），还原复绿。
- **一条 ASCII 反例**：顶点名里混进 `A1` ⇒ **整张表判为不可靠**，`AB=1` 如实 `unverified`（不按题面顺序猜坐标）。这是"别顺手多认"的守卫。
- **一次操作事故如实记**：变异之后的还原被工具守卫连拒（同一调用被判重复），**一度把工作树留在变异态**；下一轮先读文件确认现场，再用同一条 `edit` 还原成功。教训：**变异与还原要成对落地**，被挡就先确认现场，别把它们拆到两轮里。
- 读数：定向 5 文件 / **130 通过**；全库非 Lean **331 文件 / 3889 通过 + 1 todo / 0 失败**（146.44 s，**+4 = 本批新增用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- `diagramObligations.ts` 的规则**不再写死** `[A-Z]{2}` / `[A-Z]{3,4}`：线段 / 三角 / 平面三个子模式都从内核的 `POINT_NAME_SOURCE` 拼出来；`names()` 由 `[...value]` 改为 `splitPointNames`；内核 barrel 补 `export * from "./pointNames"`。
- **RED 先写、真红**：三条新用例（下标 / 撇 / ASCII 边界）先跑 ⇒ 前两条 `expected [] to deeply equal [ 'perpendicular' ]`（今天就是 0 条给定）；第三条（ASCII 写法）**本来就该**没有给定并如实报未核验 —— 它当时已经通过，这正是"别顺手多认"的守卫。
- **一处我自己写错的期望（用例先红、我改正后记在案）**：第一版对"线段⊥平面"也断言了 `planeLengths: [2, 4]`。读码后发现那个字段只属于 `平面X⊥平面Y`：下游 `witnessSearch.lineAndPlane` 是**按 targets 的点名个数**还原切点的，它的注释本来就写着"线面垂直不带 `planeLengths`"。**是期望错了，不是代码错了** —— 改成钉真正成立的性质（`targets.slice(2)` 正好是平面那四个点名），另加一条 `平面A₁B₁C₁D₁⊥平面ABCD` 把 `planeLengths` 按**点名个数**算钉住（按字串长度会得到 8 与 4）。
- **变异**：把 `names` 改回 `[...value]` ⇒ 两条带下标/带撇的用例当场红，实收 `['A','A','₁','A','B','C','D']` —— 那正是"`A₁` 被拆成 `A` + `₁`、于是核验看的是另一个点名"的机器可读现场；还原复绿。
- 读数：定向 7 文件 / **189 通过**；全库非 Lean **331 文件 / 3885 通过 + 1 todo / 0 失败**（146.30 s，**+3 = 本批新增用例**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- 新增 `packages/geometry-kernel/src/pointNames.ts` + 4 条用例：点名 = **一个大写字母 + 可选的撇或下标**（`A′` / `A'` / `A₁`）；**ASCII `A1` 不算点名** —— 它必须留在"读不出"那一侧（进 `unverified` 显形），不许被凑合解析成 `A₁`。
- **RED 是行为失败，不是"模块不存在"**：先按今天的行为（`[...value]` 按码位拆字）写最小实现 ⇒ 用例实收 `expected [ 'A', '′', 'B' ] to deeply equal [ 'A′', 'B' ]`；换成真正的定义后 **4/4 绿**。
- `splitPointNames` 只在**拆出的点名正好铺满输入**时返回结果；有看不懂的字符返回 `[]`（"拆不出"），不把看不懂的部分丢掉、把剩下的当成功。
- **变异**：把 `POINT_NAME_SOURCE` 改回 `[A-Z]` ⇒ 恰好是带撇/带下标那 **2 条**变红，还原复绿（文件仍可解析，所以那个红是判据命中，不是语法错误）。
- **本批不改行为**：解析器 / 核验器 / 内核**还没有调用它**，也还没进内核 barrel —— 接线是计划里 S1.2–S1.4 的事。写清楚，免得把"模块存在"读成"棱柱能画了"。
- 读数：新用例 4/4；全库非 Lean **331 文件 / 3882 通过 + 1 todo / 0 失败**（146.05 s，**+1 文件 / +4 用例 = 新文件本身**）；`typecheck` exit 0；`lint` 0 error / 13 warning。



- 2026-10-06 那次范围裁决（"智能体只能处理三棱锥的问题也要解决，要能处理大部分形状"）当时**只有设计**；本批补上 [实施计划](docs/superpowers/plans/2026-10-07-solid-shape-coverage-implementation-plan.md)：S1 点名语法收口 → S2 spec 骨架 + 棱锥迁移 → S3 棱柱 → S4 台体 → S5 球关系 → S6 入口语法，每块给 RED 用例、可跑命令、出口与收口清单。
- **写计划前把设计引用的 16 个路径逐个 `Test-Path` 核过**（设计 §1.1 自己就吃过"照注释写"的亏），并把两条本仓约定写进计划头：计划放 `docs/superpowers/plans/`（不是 skill 默认的 `docs/plans/`）、工作直接在 `main` 上按块提交。
- **S1 的 RED 特意设计成"行为失败"**：先按今天的行为（`[...value]` 拆字）写最小实现，让 `splitPointNames("A′B")` 实收 `["A","′","B"]` 再变绿 —— 本仓口径是"文件不存在/权限报错不算行为 RED"。
- **同步三处会过期的说法**：设计里"实施计划见 plans 目录下对应文件"、`current-status` §四 F 的"实施计划尚未编写"、追踪表的"目前只有设计，没有产品代码"（改为**已有计划、仍无产品代码**）。
- 读数：本批只改文档、未跑产品测试；`docs-consistency` **2 文件 / 7 通过**。



- **改法不是调大超时、也不是重试到绿**：把"读状态"和"派发按下"放进**同一个页内 JS 任务** —— 先读 `before`、`dispatchEvent("pointerdown")`、立刻读 `after`。`threeSceneEffect.ts` 把 `cancelFitAnimation()` 挂在 `pointerdown` 监听器的**第一行**、同步执行，所以这两个读数精确夹住这一次取消：**`before === "running"` 却拿不到 `"cancelled"` 就是真红**；`before` 已是 `"done"` 只说明没抢到窗口，换一轮重试。竞速从此只决定"能不能拿到窗口"，不再决定"断言真假"。
- **为什么不用真实 `page.mouse.down()`**：真实事件的到达时刻在页外，测试无从知道它落下时动画还在不在跑 —— 那正是上一批那条假红的来源（trace 里 `running` → `done`）。真实拖动由 `geometry3d-drag.spec.ts` 其余 8 条用例覆盖。
- **变异证明判据仍然咬人**：把 `handlePointerDownForCamera` 里的 `cancelFitAnimation()` 注释掉 ⇒ 该用例当场红，消息是「按下时取景动画正在跑，却没有被取消」、`Expected "cancelled" / Received "running"`；还原后复绿，且**工作树里不留任何源码改动**（`git status` 只剩那条 spec）。
- **顺带查了一遍同类竞速（结果是"没有第二处"）**：全仓 `e2e/` 里 `waitForFunction` 只有本条一处；相机相关的用例（`geometry3d-camera-memory` / `geometry3d-autofit` / `helpers/projection.ts`）**早已**用"读数连续两次一致"的 settle 口径处理同一类竞速（`projection.ts` 文件头记着四次同类抖动）。**本条是唯一不能 settle 的场合** —— 要断言的正是"动画还在跑时按下会怎样" —— 所以它用同任务内夹住同步取消。同时把这条用例上方那段已经说错的旧判据注释（"抓不到就明确失败"）改成与新写法一致，免得注释替代码说谎。
- 读数：该用例 `--repeat-each=5` **5/5 通过**（每次约 0.8 s；原先一次约 13 s，因为它过去要等满 5 秒的失败轮询）；还原后 `--repeat-each=3` **3/3**；全量 e2e **207 通过 / 0 失败**（1.8 m）；`typecheck` exit 0。
- **CI 一并补记**：`9e05ea4` 的 **run #176 四个 job 全绿**（`build` / `checks` / `e2e` / `rust`）；前一条 `98a0055` 的 #175 同样全绿；`e238ac0` 的 #174 被随后的推送按 concurrency 取消，`e2e` 的 `steps` 为空 —— **那次并没有真的跑过**，既不能说绿也不能说红。§一 那行仍写着 run #136 的 CI 读数已按本次实测改写。



- **依赖归位**（旧审查 §五 记的「未修」两条）：`apps/web` 的 `@vitejs/plugin-react` 由 `dependencies` 移到 `devDependencies`；根 `package.json` 上多余的 `three` 删掉 —— 真正 import `three` 的全在 `apps/web`，`packages/*` 一处都没有。
- **动依赖就要重跑整轮**（审查自己写的要求）：`npm install` exit 0；`package-lock.json` 的改动**逐行核过 —— 只有 112 处 `"dev": true` 翻转 + 5 行声明搬家，没有增删任何包**；`npm ls three` 现在只经 `@draw/web` 解析；typecheck exit 0；lint 0 error / 13 warning（与基线相同）；web 生产构建 exit 0（4.97 s）；全库非 Lean **330 文件 / 3878 通过 + 1 todo / 0 失败**（146.74 s）。
- **顺带的好处（就是审查点名的那个后果）**：插件归位后，它那条 Babel 链在 lockfile 里被标成 `dev` —— **生产安装（`--omit=dev`）不会再带上构建期依赖**。
- **全量 e2e 首跑 1 红，而这次手里有现场**（上一批把本地 `trace` 改成 `retain-on-failure` 就是为了这一天）：`geometry3d-drag.spec.ts:95` 断言 `cancelled`、实收 **`done`**。
  - trace 里的属性序列是 `running` → `done` →（`data-drag-target` 出现，说明按下**确实落在画布上**）仍是 `done`：**动画在鼠标按下之前就自己跑完了**，根本没有"在飞的动画"可取消。
  - 读代码确认**产品行为正确**：`threeSceneCamera.ts` 的 `cancelFitAnimation()` 在 `fitAnimation === null` 时直接返回、**不报任何状态**，而取景动画只有约 250 ms。
  - 所以这是**用例侧的竞态**：`waitForFunction` 看见 `running` 要一次往返，`page.mouse.down()` 再要一次，负载高时两者之和超过动画剩余时间。单独跑该文件 **9/9 通过（18.8 s）**；随后全量 e2e 重跑 **207 通过 / 0 失败**。
  - **本批不修它**：改测试要有自己的 RED 与变异证据，不塞进依赖批次。下一批的改法方向已定：输了竞速就重跑整轮，**但"按下时仍在 `running` 却没变成 `cancelled`"必须红**，并配变异证明判据还在咬人。
  - 原始现场（那份 2.3 MB trace 解包后重新打包）留在工作区 `flake-evidence/`，**不在版本控制里**；上面引用的就是它。
- **一处如实说明**：本批只改依赖归属、不触及运行时代码；那条红由 trace 直接给出机制，是用例竞态，不是本批引入的。

## 2026-10-06 —— 让本地偶发**可诊断**：失败时留下 trace

- **现象**：全量 e2e 连续两轮各出现一条单条偶发（重跑即绿），两次都**没能查下去**。
- **根因（配置层面的，不是产品）**：`playwright.config.ts` 里本地 `retries: 0`，而 `trace` 写的是 `"on-first-retry"` —— **两个凑在一起等于本地从不留 trace**。于是偶发红一次之后，手里除了"它红过"什么都没有，只能靠猜。
- **改法**：本地 `trace: "retain-on-failure"`，CI 保持 `"on-first-retry"`（那边有重试，对"第一次尝试"留证更省体积）。**这不掩盖失败** —— retries 仍是 0，红就是红；它只保证下一次红的时候有一份可看的现场。
- **没有顺手做的事（说清楚为什么不）**：没有调大 Playwright 默认的 5 秒 `expect` 超时。调大等于**放宽门禁**，而我们现在还不知道那两次红到底是"负载下超时"还是"真的错了"——**先拿到证据再决定**，不先改判据。仓库里已经记过一次"5 秒超时在负载下会偶发"，但"见过类似现象"不等于"这次就是它"。
- 读数：本批全量 e2e **207 通过 / 0 失败**（含两次全绿复跑）；`typecheck` exit 0（提交前本轮又复跑一次，仍 exit 0）；文档一致性 `scripts/docs-consistency/` **2 文件 / 7 通过**。
- **一并在案的未完成 → 2026-10-07 已解除**：本批之前两个提交（`d78fa94`、`8b51ec2`）与本批提交当时确实推不上去（`git ls-remote` 报 `Recv failure: Connection was reset`，exit 128）；次日网络恢复后**连同镜像同步批次一并推送成功**，`git ls-remote origin refs/heads/main` 与本地 HEAD 均为 `e238ac0`。
- **顺手修掉一处文档漂移**：`agent-next-round-progress.md` 那张表写着「`docs/evidence/` 五张」，实际已是 **6 张**（上一批补了双曲线与抛物线两张截图，只同步了 `current-status`，漏了这张表）；同表「待查偶发」那格补上"本地已留 trace"这件事，远端列改为不再逐一枚举未推送的提交（改列最后已推送的 SHA，避免再加一个提交就又过期）。

## 2026-10-06 —— V0c 三类圆锥曲线各有浏览器证据（补上不对称）

- 上一批把双曲线与抛物线接进判据后，V0c 的浏览器证据**仍然只有椭圆那一张** —— 于是文档里"V0c 三类已覆盖"这句话的举证是不对称的。本批补上 `e2e/agent-conic-kinds.spec.ts` 两条用例与两张截图。
- **独立回代的口径是按各自的焦点公式各算一遍**（不读面板结论），这正好说明"为什么轴必须是判据的一部分"：椭圆 `c² = a² − b²`、焦点在长轴；双曲线 `c² = a² + b²`、焦点在实轴；抛物线 `y² = 2px`、焦点在 `(p/2, 0)`。三者都在测试里自己算。
- **两张图已目视核对**：双曲线是**两支上下开口**（实轴沿 x），抛物线**向右开口**（对称轴 x），对象清单各 1 项、标签就是题面方程。一并收进 `docs/evidence/`。
- 本地入口与夹具同步补齐（精确匹配、不挂实验开关）；单测里另有一条**轴反例**：半轴一个不动、只把轴反过来 ⇒ 判据拒绝 —— 因为那两条曲线互为镜像。
- **一条值得下一轮专门查的现象**：全量 e2e **连续第二轮**出现"单条偶发"（本批首次跑 1 failed / 206 passed，重跑 207 全绿；上一轮那次是 `agent-underdetermined-diagram.spec.ts`，单独跑与重跑都过）。两轮都**没有**改动那些 spec，也都没抓到本批新 spec。按负载敏感记录，**但连续两轮就不再是偶然**，已列为待查项。
- 读数：全库非 Lean **330 文件 / 3878 通过 + 1 todo / 0 失败**（147.73 s，**+4 = 本批新增单测**）；全量 e2e **207 通过 / 0 失败**（**+2 = 新 spec 的两条**）；typecheck exit 0、lint 0 error / 13 既有 warning。

## 2026-10-06 —— V0c 补齐：双曲线与抛物线也进核验（轴是曲线的一部分）

- 圆锥曲线原先只认椭圆。现在双曲线（`x²/9−y²/4=1` 与 y 在前的写法）与抛物线（`y²=4x` / `x²=4y`）都会解析并核验。
- **这两种的判据必须"既比数值、又比轴"**：`x²/a² − y²/b² = 1` 与轴对调版是**两条互为镜像的曲线**（半轴一模一样也一样不是同一条），`y² = 2px` 与 `x² = 2py` 更是开口方向不同。轴单独判、**不与数值差混在一起** —— 混进去的话"轴反了"会被报成"差了多少"，而用户看到的两个半轴其实完全一样，那句话会让人以为系统算错了数。
- **`y² = 4x` 里的 `4` 是 `2p`，不是 `p`**：焦准距 `p = 2`。这个坑与上一批"分母是半轴的平方"是同一类 —— 直接把系数当参数，错得很像对的。这条写进 `parabolaAxis` 的注释。
- **变异**：让双曲线的轴判定恒假 ⇒ "轴反了"那条当场红，还原后复绿。
- **一次操作失误如实记**：第一次变异我把整个 `if` 块删掉、只留条件行，文件成了**语法错误**（"no tests"），变异没给出信号。改成"条件恒假但保留代码块"之后才拿到干净的红。**破坏性验证要保证改完仍能解析**，否则你看到的红是解析失败，不是判据命中。
- 读数：全库非 Lean **330 文件 / 3874 通过 + 1 todo / 0 失败**（147.87 s，**+6 = 本批新增用例**）；全量 e2e **205 通过 / 0 失败**；typecheck exit 0、lint 0 error / 13 既有 warning。
- **V0c 现在三类圆锥曲线都覆盖**。仍未做：计划的 `V0 出口` 要的"人看图确认"（§四 A）。

## 2026-10-06 —— 作图证据固化：把"人看图确认"变成可执行的一件事

- **背景**：计划 `V0 出口` 的最后一条是"没有 e2e 与**人看图确认**时保持未勾"。机器那半已经给全，另一半要人真的看一眼图 —— 而图原先只落在 `test-results/`，那是 **gitignore 的目录，任何一次 e2e 都会覆盖**：想看图的人得先自己把测试跑一遍，还未必跑的是与文档同一版代码。
- 新增 `docs/evidence/`：四张浏览器截图（V0a 四面体 / V0b 平面三角 / V0c 椭圆 / V0d 曲线与切线）+ 一份说明（每张拍的是哪条题面、看图时该确认什么、怎么重新生成）。**约 820 KB**，是这份目录唯一的成本。
- **逐张目视时抓到一处与计划措辞不符的地方**：V0b 的夹具按"让核验器拿到点名表"的需要只建了三个 `planar.create_point`，而计划 V0b 写的是"A/B/C 实际点**线段**" —— 题面说"三角形"，画布上是**三个孤立的点**。已补上三条边；核验逻辑不受影响（点名表只认带标签的点，线段端点只是匿名坐标）。刷新后的截图已**再次目视**：A/B/C 三点 + 三条边、直角在 A。
- 顺带把 `localPlanner.test.ts` 里那条断言改稳：原先钉"动作列表恰好是三笔点动作"，夹具加边就会**误伤**；现在钉的是要守的性质 ——"三个点名点都在"。
- **一次偶发如实记录**：本批首次全量 e2e 出现 `agent-underdetermined-diagram.spec.ts` 单条失败；单独跑与随后重跑全量（**205 通过 / 0 失败**）都通过，且该 spec 与本批改动无关（夹具只在 `PLANAR_TRIANGLE_PROMPT` 那条精确匹配的入口上）。按负载敏感记一次，不当作已修或未修。
- 读数：全库非 Lean **330 文件 / 3868 通过 + 1 todo / 0 失败**（147.13 s）；全量 e2e **205 通过 / 0 失败**；typecheck exit 0、lint 0 error / 13 既有 warning。

## 2026-10-06 —— V0d 收口：曲线与切线一起画出来；并修掉"题面写 x=1、系统画在 x=0"

- 本地新增精确匹配夹具与入口（`画出 f(x)=x³−3x 的图像与它在 x=1 处的切线`），要 `functions` 与 `conics-tangents` **两份**技能清单（曲线与切线各归一份）。浏览器证据：提交后读草稿里真实落盘的曲线与切线，**测试自己用中心差分求导**（与核验器那条实现无关，是第三份独立读数）再比对；截图已目视核对 —— 三次曲线（一极大一极小）与切在右侧极小点上的**水平切线**同时显示，工作区标签为**平面几何**。
- **探针揪出一个真缺陷**：夹具里写明 `x: 1`，编译出来的切线却画在 **x = 0**。根因是登记表给 `function.create_tangent` 的 `anchor` 配了默认值 `{kind:"parameter", parameter:0}`，**它会盖掉题面写明的 `x`** —— 更糟的是它让 `compileTangent` 里"都不给就按 `x` 定位"那一支**永远不可达**。已去掉该默认（给了 `x` 就按 `x`；两样都没给仍落到 `x = 0`，与原来同解，所以是纯修复）。
  - 顺带证明**这处错一旦发生会被判据挡住**：核验器给出的正是"切点画在 x = 0，题设要求 x = 1"，而不是静默放行。
  - 这条探针的价值在于**我特意选了 `x = 2` 再试一次** —— `x = 1` 那一例分不出"斜率是真算的"还是"用了占位 0"（`f′(1)` 恰好也是 0）。第二例确认斜率真的按函数算（`f′(2) = 9`）。
- **两处连带的记账**（都不藏着）：① 触发器 `VERIFIABLE_FIGURE_ACTION_IDS` 起初漏了 `function.*` 两笔，端到端压根不核验 —— 之前的单测直接调 `verifyDiagramObligations` 绕过了这一层，是本地入口用例把它逼出来的；② `agentDslMetrics.test.ts` 钉死的 `auditedSlots` 由 55 变 54、遗漏率 0.055 → 0.056，因为登记表少了一个默认字段：**改的是被测实现，代价在断言里如实记账**，不是为了让测试变绿而调数。
- 读数：全库非 Lean **330 文件 / 3868 通过 + 1 todo / 0 失败**（146.96 s）；全量 e2e **205 通过 / 0 失败**（+1 = 新 spec）；typecheck exit 0、lint **0 error / 13 warning**（回到基线）。
- **V0d 测试面已齐**。仍未做：双曲线 / 抛物线；计划的 `V0 出口` / `V0 区块收口` 覆盖四家族，**两项仍不能勾**。

## 2026-10-06 —— V0d 续：函数定义那一句也判了；并修掉一处"路由到已退役工作区"的真错

- **函数定义**：新增题设种类 `functionGraph`（题面 `f(x)=x³−3x`）。判据**按函数值比、不按字符串比** —— 题面写 `x³−3x`、图元里存 `x^3-3*x`，字符串比会把同一条曲线判成"不是这条函数"；而"先化简再比"要自己写一套化简，判据就变成"我的化简对不对"。取 9 个采样点比函数值，**边界如实写进代码注释**：采样等价**不是**符号证明，它报的是"在这 9 个点上没发现差异"。解析侧只做**纯字形替换**（上标转 `^`、`−` 转 `-`、只补 `数字×x` 这一种隐式乘号），不做数学变形 —— `log10(x)` 因此不会被误改成乘法。
- **修掉上一批自己引入的真错**：`function.*` 被路由到了 **`calculus`**，而那个工作区**已经退役**（`App.test.tsx` 钉着"外壳里不再提供"、`draftStorage` 钉着"旧草稿不许重开它"、`useAgentDocumentBinding` 只给三个在役工作区做绑定）。后果是 Agent 会把用户切进一个界面上不存在的工作区，而**全量测试全绿** —— 因为**没有任何用例问过"这个动作该去哪个工作区"**。已改为 `conics`（函数图像现在就住在平面几何），并新增 `planWorkspaces.test.ts`：钉住函数族去 `conics`，且**遍历全部动作 id、任何一族都不许路由到 `calculus``。
- **教训**：这个事实**早就写在仓库里** —— `docs/research/2026-09-18-agent-capability-audit.md` 写着"calculus 为兼容 ID，独立 UI 已退役"。改路由时我只看了 DSL 的 `Workspace` 联合类型里有它。**类型里有 ≠ 界面上有。**
- 读数：全库非 Lean **330 文件 / 3865 通过 + 1 todo / 0 失败**（127.62 s，**+7 = 本批新增用例**：3 条曲线判据 + 4 条路由守卫）；全量 e2e **204 通过 / 0 失败**；typecheck exit 0、lint 0 error / 13 既有 warning。**变异**：让曲线差恒为 0 ⇒ "画了另一条函数"那条当场红。
- **未做（V0d 未收口）**：本地入口与浏览器证据；双曲线 / 抛物线。

## 2026-10-06 —— V0d 切线判据：核验器自己求导，不读图元里的斜率

- 新增题设种类 `tangentAt`（题面 `在 x=1 处的切线`）与解析匹配器。**这条 obligation 只记横坐标，斜率一个字不记** —— 斜率不由题面给出，而由函数决定。
- **判据不读图元里那个 `slope`**：内核重算切线时会把它写进图元，拿它当判据就是**拿系统自证** —— 无论切在哪、算成什么，图元里的数都会"符合"它自己。所以核验器用**中心差分**从表达式独立求导再比。两个数都比：切点**横坐标**（切在不在题面说的位置）与该点**导数**（斜率对不对）。对 `x³ − 3x`：`f′(1) = 0`，而 `f′(2) = 9`。
- **没有来源函数时如实报"未核验"，不退化成"那就只查横坐标吧"** —— 那只核验了一半，却看起来像全过了。有专门用例钉住这条。
- **变异**：把斜率差强制为 0（等价于改回"自证"）⇒ "错斜率不能正常确认"那条当场红，还原后复绿。
- 读数：全库非 Lean **329 文件 / 3858 通过 + 1 todo / 0 失败**（145.77 s，**+4 = 本批新增用例**）；全量 e2e **204 通过 / 0 失败**；typecheck exit 0、lint 0 error / 13 既有 warning。
- **未做（V0d 未收口）**：本地入口与浏览器证据；另外 `f(x)=x³−3x` 这种**带函数定义**的完整题面里，函数表达式那一句**还没有匹配器**，所以整句会如实落在"未核验"上（下一批补）；双曲线 / 抛物线仍走"解析器不认识 ⇒ 未核验"。

## 2026-10-06 —— V0d 起步：Agent 第一次能创建函数图像

- **补上一个从入口就断掉的动作**：`packages/dsl` 一直有 `type: "function"` 图元、场景图也能重算它的导数与切线，但动作表里**只有** `function.analyze` / `function.create_tangent` —— 两个都要求**先有一条曲线**。于是"求 f 的导数"能表达，"先把 f 画出来"不能。新增 `function.create_graph`（表达式 + **有界**定义域）。
- **跨了七处接线，其中三处是机器逼着改齐的**：`actionIds`（**28 → 29**）、`actionRegistry`（登记表条目 + 新字段种类 `interval`）、`actionInputs`（区间读取：长度恰好 2、两个有限数、`lo < hi`）、`actionSchemas`（区间 → 数字数组 schema；`lo < hi` 不写进 schema —— JSON Schema 表达不了元素间的大小关系）、`skills/manifest`（`CAPABILITY_FOR_ACTION` 是 `Record<DraftActionIdName, string>`，**漏登记直接 `tsc` 报错**）、`scene-graph` 的动作类型与编译器、`agentRunner` 的工作区路由。
- **解析在编译期就做一次**：用内核同一个 `compileExpression` 试解析，失败就结构化拒绝 —— 静默落一张画不出来的图比拒绝更糟（用户会以为"画好了"）。反例用例额外断言**错误不是 `unknown_action`**，堵掉"动作不认识时反例也通过"那种假绿。
- **`functions` 技能重签**：它的自述一直写着"创建函数图像"，而 `actionIds` 里没有任何一笔能创建它 —— 现在补上，并按纪律重签 `EXPECTED_HASHES`（哈希只覆盖**语义**内容：动作名与上限，改文案不该让清单失效）。
- **工作区路由**：`function.*` → `calculus`。顺带收掉一处**顺序决定行为**的风险：目标工作区原先取 `wanted[0]`，而那是动作在计划里的先后（模型随手写的顺序），现按固定偏好次序取。
- 读数：全库非 Lean **329 文件 / 3854 通过 + 1 todo / 0 失败**（146.94 s，**+2 = 本批新增用例**）；全量 e2e **204 通过 / 0 失败**；typecheck exit 0、lint 0 error / 13 既有 warning。
- **未做**：`f′(1)=0` 那条切线判据、本地入口与浏览器证据 —— **V0d 未收口**。

## 2026-10-06 —— V0c 浏览器证据：椭圆与它的焦点

- 本地新增一条**精确匹配**夹具意图（`椭圆 x²/9+y²/4=1，画示意图`），与平面三角那条同一条纪律（不挂实验开关）。**一处关键不同**：题面是**方程**，两个半轴已被分母钉死（`√9 = 3`、`√4 = 2`），所以**没有"系统自选示例值"**这回事 —— 夹具的假设里如实写明"由题面方程唯一确定"。
- 浏览器证据：新 spec 提交后读**草稿里真实落盘的半轴**，在测试里**自己算焦点**（`c = √(a²−b²)`）并与题面要求的 `(±√5, 0)` 比对；另断言长轴确实在 x 轴上（半轴对调正是会改掉这件事）。截图已目视核对：椭圆**明显宽于高**，与方程一致；对象清单 1 项、标签就是那个方程。
- **一处措辞被用例逼着改**：夹具假设初稿写的是"不是系统自选的**示例值**"，而面板逐字显示 —— 用户扫一眼只会看到"示例值"三个字。改成正面陈述"由题面方程唯一确定"。判据是"整句不许出现『示例值』"，正是它把这句话挡下来的。
- 读数：定向 1 文件 45/45；全库非 Lean **329 文件 / 3852 通过 + 1 todo / 0 失败**（+3 = 本批新增单测）；全量 e2e **204 通过 / 0 失败**（**+1 = 新 spec**）；typecheck exit 0、lint 0 error / 13 既有 warning。
- **仍未做**：双曲线 / 抛物线（题面写法与判据都没做，它们仍走"解析器不认识 ⇒ 未核验"这条诚实路径）；V0d（导数函数图像）。

## 2026-10-06 —— V0c：圆锥曲线的题设也逐条核验（半轴与焦点）

- **接上第二类"没有点名"的图形**：原文核验此前只认带点名的动作（多面体、平面点），而圆锥曲线**没有顶点名**，于是它连"题面说的是图里哪个东西"都定不下来。本批把触发条件从 `declaresPointNames` 改名为 `planHasVerifiableFigure`（并加上 `planar.create_conic`），新增 `candidateConic` —— 与多面体同一条"**恰好一条**"纪律：多一条就返回 `null`（表现为"未核验"，而不是"通过"）。
- **题面侧**：新增题设种类 `conicAxes` 与椭圆方程匹配器（`x²/9+y²/4=1`、y 在前的写法、`x^2` 也收）。判据只比两个半轴，但**结论带焦点** —— 焦点是半轴的函数（`c = √(a²−b²)`），半轴对调会把焦点从 `(±√5, 0)` 挪到 `(0, ±√5)`，那是**另一条曲线**；只说"两个数换了位置"用户看不出后果。
- **一处自己犯的错，被用例当场抓住**：第一版把方程分母直接当半轴（报出 `(9, 4)` 而不是 `(3, 2)`），正面用例立刻红。已改成开方，并把这条教训写进注释 —— 这个错看起来完全合理，只有把正确答案摆出来才发现。
- 读数：定向 2 文件 72/72；全库非 Lean **329 文件 / 3849 通过 + 1 todo / 0 失败**（144.50 s，**+4 = 本批新增用例数**）；全量 e2e **203 通过 / 0 失败**；typecheck exit 0、lint 0 error / 13 既有 warning。
- **变异**：把解析出的两个半轴对调 ⇒ **4 条 V0c 用例全红**，还原后复绿 —— 证明这条判据是"**分轴**"的，不是只看大小。
- **操作教训（成本真实）**：本批中途我用 PowerShell 的 `Set-Content` 做批量重命名，把两个源码文件的中文写成了乱码（diff 从几十行炸到 662 行），只能 `git checkout` 回滚重做。**这个仓库的源码不能用 PowerShell 文本替换，只能用 `edit` 工具。**
- **未做**：V0c 的浏览器证据（本地入口 + 真实椭圆截图目检）；双曲线 / 抛物线（题面写法与判据都没做，它们仍走"解析器不认识 ⇒ 未核验"这条诚实路径）。

## 2026-10-06 —— V0b：平面直角三角形走通，并揪出一处"同一个判断写两遍"

- 本地新增一条**精确匹配**的夹具意图（`在三角形ABC中，AB⊥AC，画示意图`）：三个**点名**的平面点，边长由系统自选并写进 `assumptions` 给用户看，`C` 取在过 `A` 且垂直于 `AB` 的那条线上（题面欠定，只给一个代表点）。**不挂实验开关**——开关管的是"见证搜索"，而这条走的是与 `PYRAMID_PROMPT` 同类的夹具路径。
- 浏览器证据：新 spec 在提交后读**草稿里真实落盘的坐标**，用**自算的点积**独立复核 `AB⊥AC`，并断言三点不共线、点名恰好是 A/B/C；截图可目检。
- **本批最重要的发现是一处"同一个判断写了两遍"**：核验的触发条件此前在 `planCompiler`（编译期）与 `draftStore`（草稿层再核验）**各写了一份** `action.actionId === "solid.create_polyhedron"`。上一批只改了编译器那份，于是**编译期核验确实跑了，而用户在面板上什么也看不到**——面板那份报告来自草稿层。**单元测试抓不到它**（`compilePlan` 的用例只走编译期那一条），是浏览器用例先红的。现收成一个导出的 `declaresPointNames`，两处共用，并补了草稿层的单元守卫。
- **Worker 那一侧也补上了**（计划点名的测试面）：新 `geometryWorkerHost.planar.test.ts` 用**假线程 + 生产真策略**证明两件事——① 原话真的装进了请求信封（少了它，Worker 侧的核验触发条件根本不成立）；② 同一份计划只把 `C` 挪到 `AB` 上，**跨线程之后照样拒绝**，而这正是"Worker 里真的逐条量过"的读数（拒绝只可能来自拿到原话之后的核验）。写法上如实记一条：最初我在这里断言 `diagramVerification`，红了才发现**那条通道按设计不走回程**——`compileInWorker` 只映射文档/操作/假设/被物化动作，核验报告由 `draftStore` 重新算一遍；断言它等于要求一条故意不存在的传输。
- 读数：定向 3 文件 110/110；全库非 Lean **329 文件 / 3845 通过 + 1 todo / 0 失败**（146.80 s，**+7 = 本批新增用例数**：5 单测 + 2 Worker 契约）；全量 e2e **203 通过 / 0 失败**（**+1 = 新 spec**）；typecheck exit 0、lint 0 error / 13 既有 warning。
- **变异两次**：去掉 2D 分支 ⇒ 平面用例红；把草稿层换回重复触发条件 ⇒ 新守卫红。两次还原后都复绿。
- **一次操作失误如实记**：做第二次变异时我先破坏、再还原，而还原调用被工具护栏连续判为"重复调用"挡住，工作树一度停在"未使用的导入 + 旧触发条件"的半修状态。教训是**先准备好还原路径，再做破坏性验证**。
- **V0b 的测试面已齐**（本地入口、浏览器证据、草稿层守卫、Worker 契约四条都在）；**仍未做**：教师可读性走查（属 §四 独立验收），V0c–V0d。

## 2026-10-06 —— V0b 起步：平面图形接进同一套题设核验

- **修一个与 V0a 同类的洞**：原文题设核验的触发条件此前写死 `solid.create_polyhedron`，于是**任何平面图形都从不进入核验**——「动作编译成功」等于「图符合题意」。触发条件改为带注释的 `POINT_NAMING_ACTION_IDS`（`solid.create_polyhedron` + `planar.create_point`）；**刻意不含 `solid.create_template`**，因为它给子对象编的 `A`、`B`、`C`… 是模板自己的顺序编号、不是题面点名，算进来会破坏关旗黄金样本。
- 核验器的点名表新增 **2D `point`**（补 `z = 0` 后交给同一套判据，不为 2D 另开数学分支）；多面体那一支改为「计划里真的有它时才跑」，**多面体在场时的守卫逐字未改**。
- 读数：RED 3 条全红 → GREEN；全库非 Lean **328 文件 / 3838 通过 + 1 todo / 0 失败**（145.54 s，+3 = 本批新增用例数）；`typecheck` exit 0；**`planCompiler.offPath.golden.test.ts` 仍逐字节相同**。变异：去掉 2D 分支 ⇒ 正例与反例各一条变红，还原后复绿。
- **V0b 未收口**：本地入口、浏览器正例与截图目视、`workerContracts`/`draftStore` 侧用例、全量 e2e 均未做。

## 2026-10-06 —— V0a 出口判据齐备：拒绝不占撤销历史的浏览器证据

- 补上 V0a 出口条件里唯一还没被浏览器证据覆盖的一条：**拒绝不占撤销历史**。两条拒绝用例（未知「在底面上方」条件、与候选不符的错坐标）现在各自断言「撤销」按钮仍 `disabled` —— 这是浏览器里唯一能看见撤销栈的读数；此前只断言"画布上没东西"，而"没画"与"画了又被撤掉"在画布上长得一样。
- 至此计划 V0a 点名的出口条件**逐条都有可复跑证据**（真浏览器四面体 + 截图目检、条件状态一致且由独立回代复核、两条拒绝用例的撤销栈断言、自由点图不宣称唯一、文字坐标/方位不静默丢、全库 3835 与 e2e 202 全绿、变异命中）。
- 读数：单 spec 浏览器 **6/6**（12.2 s）、全量 e2e **202 通过 / 0 失败**、`typecheck` exit 0、`lint` 0 error / 13 既有 warning。
- **口径**：这一批说「V0a **出口判据齐备**」，不说「V0a 完成」—— 区块收口另要求同步 `feature-catalog` / `project-progress` / `README` 与门禁文档，本批未做。**V0 整体仍未验收**（V0b–V0d 未开始）。

## 2026-10-06 —— V0a 门禁全表复测：Lean 证据在本机不可复现、离线码表已变

- 把 §一 里那批门禁逐条重跑一遍，读数如实更新：生产构建成功（入口 1,861.85 kB / gzip 548.43 kB，比上次记的 1,803.76 kB 又长了约 58 kB）；Rust **238 通过 / 3 ignored / 0 失败**；`proof:smoke` **8 通过**；性能 **9/9**、`drag/300-frames` **625.9 ms**；许可扫描通过且快照重写后工作树无变化；离线评测 `pass@1 4/8`、`pass@3 4/8`、工具选择 `45/45`、工具错误 `3/45`；离线 benchmark `solveRate=0.048`、`PREMISE 0.727`、`EXTRACTION 14/21`。
- **两条发现（都不是"跑绿了"，是"读数的含义变了"）**：
  - **本机没有 Lean 工具链**（无 `elan`/`lean`/`lake`，`proof/lean4/.lake` 不存在）。因此文档里那条真内核 `formally_proved`（68277 ms）是**更早某台装了 Lean 的机器上的历史读数，本机不可复现**。该用例显式 gated，本次如实打印「本机没有找到 Lean 可执行文件」并 skip，**没有静默通过**（1 passed / 3 skipped）。
  - **离线 benchmark 见证层码表与旧记录不同**：多出 `"unverified-obligation":26`，`no-candidate-constructed` 4→2、`unsupported-base-shape` 4→2。总量仍自洽（`verified=1`、`solveRate=0.048` 未变），但**不是同一个分布**，是拉取进来的那批提交改变了构成。
- 本批只复测与记录，**没有改产品代码**。

## 2026-10-06 —— V0a 收口：显式坐标正反例、浏览器独立回代与截图目检

- 受限三棱锥句型新增**底面顶点的显式坐标**写法（`A=(0,0,0)`）：坐标段只接受底面环上的点、且必须被坐标吃干净，顶点仍是自由点（给它写死坐标等于换题设）；题面写的坐标与候选不符时**明确拒绝**，不产出草稿、不占撤销历史。
- 离线见证入口改为与救援路径**共用同一份解析**（`parseObligationWithLegacy` + 显式 `spatialPointConditions`）。此前 `searchWitnessForPrompt` 固定不带这个开关，于是救援路径在 V0a 开关下认得出原话坐标、离线入口认不出 —— 同一道题两条路看到的是**不同题设**。缺省仍是 `false`，`bench:agent` 见证层的历史读数因此不受影响。
- 浏览器证据补齐计划 V0a 点名的三项：读应用自己写回的 `.mgeo` 草稿里**真实落盘的坐标**并在测试内**独立回代**题设（不读面板结论）、**成对**的显式坐标正反例（正例钉住"这个句式被接受"，反例才谈得上证明"拒绝是因为题设不成立"）、可目检截图并已目视核对（顶点 D、垂足 A、底面 B/C，对象清单 15 项）。新用例还钉住"下标顺序与标签必须指同一个顶点"。
- **变异验证**：把坐标守卫短路掉，`does not accept coordinates for the free apex or for a vertex outside the named base` 当场变红，还原后复绿。
- 读数：受限定向 `localPlanner` + `planCompiler` 2 文件 86/86；单 spec 浏览器 **6/6**；全库非 Lean **328 文件 / 3835 通过 + 1 todo / 0 失败**（143.88 s，比改动前 +4 条，正是本批新增的单测数）；全量 e2e **202 通过 / 0 失败**（1.0 m，比改动前 +3 条，正是本批新增的浏览器用例数）；typecheck exit 0、lint 0 error / 13 既有 warning。Lean 慢集成与桌面产物本批**未跑**。
- **本批查实一个未修缺陷**：画布顶点标签按 `templatePointLabel(index)` 按下标自动生成，而核验器用 `vertexNames` 的下标；两者顺序不同时（如 `P-ABCD`）"核验通过"所指与用户按标签读到的**不是同一个顶点**。修它会撞上 `planCompiler.offPath.golden.test.ts` 的"关旗与 `4707b64` 逐字节相同"契约，故只记录待裁决。**V0a 未验收**：教师/学生走查、MSI、真实 Lean、付费 provider 仍未做。

## 2026-10-06 —— 全仓进度文档对齐：修过期状态和历史边界

- 对齐当前状态、README、能力目录、记分卡、开关/依赖审查和旧研究/验收进度。旧 N3 恢复路径已验、N4 真实 provider 和少量人工标注已发生，不再保留为当前“尚无”；旧全课程路线非现行作图任务。V0a 的 171 定向单测/单份 e2e 3/3 仅为 WIP 证据，尚未全量验收；本批仅文档，没有新增产品证明或付费请求。

## 2026-10-06 —— V0a 中途保存：自由顶点示意图受限入口（未验收）

- 在显式开启见证搜索的狭窄三棱锥句型中，原话坐标进入题设核验，普通三角底面可取一般位置的自由示意值；未知“上方”条件标未核验。默认关闭时不改变旧入口。定向 171/171、单 spec 浏览器 3/3、typecheck exit 0、lint 0 error/13 旧 warning。**全量回归、真实图的浏览器独立回代和截图目检缺失；V0a/V0 未交付。** 代码以 WIP `4ee71e8` 保存。

## 2026-10-06 —— V0a 计划修订：坐标与“在上方”不得被单条垂直关系吞掉

- 查证现有原文解析可核线面垂直，但不能据此声称顶点坐标/上方条件也被核验；V0a 追加错坐标/下方顶点负例与不支持时 `unverified` 确认门禁。本批只改计划和进度文档，产品判据尚未修。

## 2026-10-06 —— V0 产品接线调查与实施顺序（只有文档）

- 点名原文题设核验目前只在 `solid.create_polyhedron` 路径触发；平面曲线动作与函数分析/切线不能代替题设核验，Agent 缺函数图像创建动作。将 V0a–V0d 按真实模块、RED 文件和浏览器正反例拆成独立区块；本批不声称产生新图或证明。

## 2026-10-06 —— 作图题范围修订：四家族候选/欠定自由点与非作图排除

- 依据最新用户裁决，将现行 Agent/自动 Lean 目标限定为**实际需要画图的高中题**。保留旧全课程索引作历史来源参考，新增作图任务级意图与四家族题集（三角/圆锥曲线/导数函数图/立体几何）12 条正反/欠定内部坐标/文字候选，替换尚未推送的纯集合/数列/纯恒等式例；四条欠定例可有自由选择，**不是**数学内核或浏览器已验证图元。
- 范围与内部案例/既有目录/来源/文档守卫共 5 文件 35/35；自由点示意候选清空变异能让对应测试变红，恢复后复绿，typecheck exit 0、lint 0 error/13 既有 warning；正式作图、教师验收与自动 Lean 尚未实施，不声明全课程覆盖。

## 2026-10-06 —— H0b3a：高考机构评析来源与逐题金标分离

- 登记 2025 上海评析和 2026 全国卷评析两篇官方公开材料，按上海/全国Ⅰ/全国Ⅱ分成三份卷别来源、八个候选课程标签；只存元数据和来源 SHA，不存原题或答案。来源审计拒绝非考试机构域名、伪造“已核实整卷”、混淆卷别；完整题目/答案仍未核验，金标 0。
- 高考来源 5/5，连课程目录/文档守卫 22/22；typecheck exit 0，lint 0 error/13 既有 warning。此步不是开放题正确率或 Lean 支持的证据。

## 2026-10-06 —— H0b2：选修 A–D 64 条正式要求与 E 类非穷尽举例

- 选修 A–D 登记 64 条规定性一级要求，E 类仅登记 10 个明确为“例如”的举例，开放的 4 类 E 课程单列 `openEndedUnits`、静态清册不得报穷尽。累计 43 上层项、131 条规定性一级要求及 10 个举例，全部未分类、无金标准/高考标签，Lean 未扩域。
- 定向 15/15，连文档守卫 17/17；typecheck exit 0、lint 0 error / 13 既有 warning。全库和真 Lean 本块未复跑，H0 仍未完成。

## 2026-10-06 —— H0b1：必修/选择性必修 67 条正文一级要求入独立来源索引

- 对照 2025 标准正文为 22 个必修/选择性必修单元登记 67 条一级要求和 5 条选学标记；目录仍一律未定命题性质、无金标准，高考标签 0，选修正文未拆。缺官方子型/未分类时不能报就绪，不冒充 Lean 证明。
- 新定向 12/12，连文档一致性 14/14；typecheck exit 0，lint 0 error / 13 既有 warning。全库、浏览器和真 Lean 本块未重跑。

## 2026-10-06 —— H0a：2025 高中课程表层来源索引与 fail-closed 清册审计

- 登记 43 条带 PDF 页码/来源 SHA 的必修、选择性必修和选修 A–E 来源条目，独立的可编辑清册全部保持未拆原子题型，`exam` 明确 `not_measured`；删项/重复/缺金标/竞赛混入不允许伪造“目录就绪”；非命题任务单独归类，不产生虚假的形式证明。
- 定向 9/9，来源 SHA 篡改变异实测会红；非 Lean 慢集成全库 Vitest exit 0（未记录可复核总数）；全工作区类型检查、lint（0 error / 13 既有 warning）通过。**H0 尚未完成，未声称高中题型已覆盖或 Lean 已自动调用。**

## 2026-10-06 —— 重新规划高中全题型 Agent 与自动 Lean（文档区块）

- 新增 2025 修订课程标准/高考全题型的自动 Lean 设计、H0–H4 实施计划、审查问题/任务进度追踪；竞赛题另表。旧 N1–N6 仅为历史阶段完成，不构成新目标验收。
- 对齐当前状态、功能目录、README、发布门禁和记分卡；把真实 provider 既有小样本、Lean 一类条件引理与原题未证、教师走查与 MSI 管理员验收分别列明。**本批无功能代码、无新增付费请求，不宣称新目标已实现。**

## 2026-10-06 —— N3 空间线重合约束缺少判据时安全拒绝

- 实验性约束拖动下，空间线 `coincident` 的定义点（含投影连带点）发生位移将按独立原因码拒绝，保留草稿与撤销历史；关闭开关、禁用约束、无关点、零位移不误拦。未实现 3D 线重合求解。
- 定向单测 18/18；非 Lean 慢集成全库 324 文件 / 3781 通过 + 1 todo；浏览器 196/196；类型检查、lint（0 error / 13 warning）和 web 构建 exit 0。Lean 慢集成本区块未单独重跑。

## 2026-10-06 —— 修掉 CI 上第一次真跑就红的 6 条：`lean4Toolchain.test.ts` 偷偷依赖了宿主平台

- **怎么发现的**：推送 `ab0721e` 后核对 CI（run #135）—— `build` / `rust` / `e2e` 三个 job 全绿，**`checks` 红在 "Unit and UI tests (Vitest)"**（同一个 job 里 typecheck 与 lint 都是 success）。
- **红了什么**：`packages/agent-core/src/proof/lean4Toolchain.test.ts` 的六条断言 ——
  `expected undefined to be 'elan-shim' / 'PATH' / 'env:DRAW_LEAN4_TOOLCHAIN_BIN' / 'elan-toolchain:…'`。
- **根因（不是抖动）**：那六条用例的假文件系统写的是 `lean.exe` / `lake.exe`，**但后缀是从宿主平台推的**
  （`process.platform === "win32" ? ".exe" : ""`）。Linux 上拼出来的候选是 `.../lean`，而假文件系统里只有 `.../lean.exe`
  ⇒ 解析返回 `null` ⇒ 断言读到 `undefined`。**它们一直在偷偷依赖"跑测试的机器是 Windows"**，所以开发机上一路全绿。
  这不是新引入的行为，而是**这批测试第一次真正在 Linux 上跑**（上一批的 CI run #134 四个 job 全是 `cancelled`、steps 为空）。
- **修法（最小）**：六条 Windows 形状的用例**显式注入** `exeSuffix: ".exe"`（PATH 那条再加 `pathSeparator: ";"`）；
  文件头把这条规则写下来（"新加 Windows 形状的用例必须注入后缀"），免得下次再漏。
  **生产代码一行未动** —— 解析器的平台推断本身是对的，错的是测试没把自己那台"假机器"说清楚。
- **本地证据（RED 与 GREEN 都做实）**：控制器把 `process.platform` 伪装成 `linux` 再跑同一条文件
  ⇒ **复现 CI 的 `6 failed | 5 passed`**（同样六条、同样报错文本）；注入后缀后**同一伪装下 `11 passed`**；
  拆掉伪装后在真实 Windows 上 **`11 passed`**。
- **故意没有加的东西**：**没有**加"宿主平台无关"那种会 mutate `process` 全局的回归测试 ——
  它自己就注入后缀，**bug 在也照样绿（那是假门禁）**；而且 CI 跑 Node 22，`process.platform` 是否可写没有保证，
  加进去等于用一个新的平台假设去换掉旧的。**假门禁比没有门禁更坏**，这一条按那条纪律办。
- **CI 复核（修复后实测）**：**run #136 / `2fd2533` 四个 job 全绿** —— `build` / `checks` / `e2e` / `rust`；其中 `checks` 里 typecheck、lint、单测、**性能趋势**、**评测记分卡**每一步都 success（后两步在 #135 里因前一步失败被跳过，这一轮真的跑了）。**`checks` 从 #135 的红变成绿，就是这条修复的目的**。

## 2026-10-06 —— 进度文档全量校对：把活文档里仍在说假话的**状态句**改对，并补 N3–N6 的归档条目

- **怎么找的**：对 `docs/**/*.md` 做了一次关键词扫（`N4` / `N5` / `N6` / `not_measured` / `未测` / `门禁` / `后端` / `pass@1` …），逐行判断是**历史引用**还是**现行状态句** —— 历史引用（过程记录、当时的实测）一律保留，**现行状态句里已经为假的就地改对**，而不是只在后面追加一条更正。
- **改对了哪些（都曾是"今天"层面的假话）**：
  - `docs/current-status.md` 抬头：`最后更新` 2026-10-05 → **2026-10-06**；"真实 provider 评测**只差一次会花钱的运行**" → **已经跑过**（planning 轴三轮 + agent 工具环一轮）；"`real_provider` 仍整批 `not_measured`" → 应用内**已跑过**（CLI 侧仍 `not_measured`，并写明它直连内核、从不发真实请求）；"**没有接任何后端**，所以今天没有任何产物能升到 `formally_proved`" → **已接一个后端 `lean4`（十栏准入在案）**，一类目标可达；"那次付费运行**仍未跑过**…真实 provider 的读数**一个都还没有**" → 已跑过，读数在 §一。
  - 同一文件「下一轮 Agent 方向」标题与 §四 E 的清单：`N3` / `N4` / `N5` / `N6` 四条从"已开工 / 尚未实施 / 状态到第 N 步"改成**实施并复核 + 出口达成 / 收口**；`N5 四步` / `N6 十五步` / `N5 进行中` / `已更新到第四步` / `已更新到第十四步` 这些进度刻度换成完成态。
  - `docs/acceptance/agent-release-gate.md`：第 2 条门槛的状态格 `❌ **未测（无数据）**` → **有读数、但未达阈值（阈值本身也从未预先约定）**；"**还没有人在修好之后跑过**" → **已经跑过一轮**（`pass@1 1/8` 等，附口径）；"**N5 的证明出口卡在没有任何后端接入**"与"`pass@1` **仍未测过**"就地划掉并给出当日更正；"N5 那一条不许读成绿"补上"**到 2026-10-06 才可判定，且只判到一类目标**"。**结论一个字没改**：仍然是**不放行**。
  - `docs/feature-catalog.md`：N4 / N5 两行的**行首标签**里"（N4，骨架 + …已接线）""（N5，**只做了边界**）"与"`WIRED_PROOF_BACKENDS` **今天为空**"等过期说法改掉；**两行的 `⬜` 有意保留** —— 该文件的 `⬜` 记的是"**用户可用能力是否发布**"，而 N5 仍**没有界面入口与产物通道**、N4 仍只有小样本，行尾原有的理由句**依然成立**。
  - `README.md`：路线一条从"**N1、N2 已完成**"改为**N3–N6 的计划均已推完**，并**同时写明只有 N3 有产品入口**、N4 读数仍是小样本、N5 没有界面通道；"真实 provider 的 pass@1 / pass@3 / 成本 / 延迟**还没有形成可用于放行的测量数据**"改为**已有小样本读数、成本仍缺价目表、仍不足以放行**。
  - 实施计划第 3 行的状态行：`N5 进行中…出口 :616 未勾` / `N6 收口等 N5b 的真实产物` → **N5 出口已达成（`:616` 已勾）+ N6 已收口（37 项检查项全部勾选）**。
  - `docs/acceptance/agent-tool-loop-scorecard.md`：`harness only (N4 step 1–7 + N4a/N4b)` → `harness + real-provider readings (N4 exit achieved 2026-10-06)`，包括正文里引用旧标签的那一句。
- **顺带修掉两处代码注释里的同类假话（都在实际生产文件里）**：`apps/web/src/agent/featureFlags.ts` 与 `featureFlags.test.ts` 写着 `openProblemCompiler` / `proofExport` "**还没交付**" —— 2026-10-06 复核，N4 / N5 都已交付、出口都已勾，而这两个开关**至今没有任何生产读取点**（名字只出现在开关表、默认值、测试与注释里，`apps/` `packages/` `scripts/` 全扫过）。注释改成"**属于 N4 / N5 的产品侧、至今没有读取点**"。N6 的验收文档 `docs/acceptance/next-phase-flag-and-dependency-review.md` 同步加一条 2026-10-06 更正：**"占位 / 没有读取点"这半句仍成立，"等 N4 / N5 实现"这半句已过期**（N4 走评测面板、N5 走只读状态面，都没读这两个开关），并写明**将来真把开放题编译或证明导出接进产品时，矩阵里那一格必须重审**。
- **新增归档**：`docs/project-progress.md` 补上 `2026-10-06` 一条（N3 出口的三条浏览器用例、N4 的人工可读性与真实读数、N5 的 Lean 4 后端闭环、N6 收口），含复核抓出的 8 条真缺陷（证明正文引用了不存在的变量、`git stash -u` 带走 `.gitignore` 导致 6.3 GB `.lake` 一度不再被忽略、`.lake` 被 eslint 扫、三份无 BOM 的 `.ps1` 会静默吃掉一行代码、两条哨兵断言假设生产未接线、界面里的过期断言、准入记录里的成本数字、`lake-manifest.json` 会弄脏工作树）与控制器当次复跑的门禁读数。
- **一条守卫盖不住的东西（记下来，不是本批修的）**：`scripts/docs-consistency/progress-claims.test.ts` 只拦"状态行把**已有执行记录**的阶段说成 `尚未实施`"这一种写法（正则 `N(\d)[^N]{0,12}尚未实施`）。本次那行过期状态行写的是"`N5 进行中`…出口 `:616` 未勾 / `N6` 收口等 N5b 的真实产物" —— **同一个意思、另一种措辞，它一条都没红**（本批全量里那两个守卫文件都是过的）。守卫自己的注释写了为什么不钉正文措辞（"一改措辞就红的假门禁"），所以这不是它的 bug，而是**已知的空隙**：**措辞一换，状态行就又能漂到执行记录后面去**。要真堵住得让状态行**从记录派生**（生成而不是手写），那是一个设计决定，不在本批。
- **如实留着的边界**：`cost` 仍然**没有数字**（仓里没有价目表）；21 条题集只跑了前 3 条；人工可读性**每组 n=1**；形式证明**只覆盖一类目标**（`perpendicular`）、**IR → Lean 的翻译本身未被证明**、**产品里没有证明入口与产物通道**；Lean 端到端放进**并行的**全量套件会撞 300 s 墙钟（单独跑三次成功）⇒ 记为**负载抖动、不是回归**。**发布门禁结论不变：不放行。**
## 2026-10-06 —— N6 收口：计划复选框**全部达成**（37/37）；三类证据统一进"当前读数总表"

- **计划的复选框现在全部勾上**：最后两格是 N6 的 `:903`（更新所有进度文档和发布门禁 + **统一记录三类证据**）与 `:917`（整个计划的收尾检查点）。
  两格都写明"**勾的是计划要求的出口，不是产品已经完备**"，并把仍未达成的项逐条列在注记里。
- **三类证据都进了 `docs/current-status.md` §一 的同一份表**：
  - **真实 provider**：题集 planning **三次**运行 + agent 工具环 **pass@1 一次** + **人工可读性第一次标注**（三行，
    每行都带"用户提供、控制器未旁观"与各自边界：n=3 子集、空画布条件、**每组 n=1 不是趋势**）；
  - **动态拖动**：新增一行 **`8 passed / exit 0`（2026-10-06 02:20 实测）**，并写明口径是**针对性**跑那两个 spec（**不是**全量 e2e）；
  - **proof artifact**：新增一行（`lean4` 十栏准入 + 一类目标的一般命题升到 `formally_proved`，同一命题换 `sorry` 停 `verified_instance`），
    并写明"**单独跑才是它的口径**"——放进并行的全库套件会因负载撞 300 s 墙钟（两次实测）。
- **发布门禁四处更正**：N5 那一节的"**没有任何后端** / `formally_proved` **不可达** / `proof:smoke` **7 通过**"全部过期；
  `一句话结论`（原来写"只有第 2 条卡住，因为**没有**真实 provider 数据"）与 `最终阶段门槛`（**结论仍是"不设"**，
  但理由换成"成本无数字 + 三条轴都是小样本 + 形式证明只覆盖一类目标且对用户不可用"）。
- **记分卡**的 Formal proof 行改成"**接了一个后端 / 一类目标闭环**"，并把仍未达成的项逐条列出（含"并行全库套件里会超时"这条口径）。
- **功能清单** N5 行与"N4 / N5 都还没有对用户可用的出口"那句各加一条更正：
  **N4 那一半已不成立**（真实 provider 通道能用、且用户已用过三次）；**N5 那一半仍然成立**（接上了后端，但产品里没有入口、产物也送不进界面）。
- **如实留着（不许含糊）**：`cost` **没有数字**（仓里没有价目表）；三条轴都是**小样本**；形式证明**只覆盖一类目标**。

## 2026-10-06 —— N5 出口达成：接上第一个真实后端（Lean 4 过十栏准入）+ 一个目标类的**真内核闭环**

- **提交**：`e401d9e`（十栏准入记录 + 把"接上的名单"钉死）、`051e5fe`（适配器 + `perpendicular` 的**一般命题**闭环 + **仓内** Lean 小工程 `proof/lean4/`）。
- **十栏准入成立**：`npm run proof:smoke` ⇒ **8 通过**（此前 7），
  `PROOF_BACKENDS {"wired":["lean4"],"reviewed":1,"rows":[… "verdict":"passed","problems":[]]}` —— 接上名单**由 passed 记录推导**；
  **形状合格的伪造产物仍全部 `backend-not-wired`**（反方向判据没被"接了一个后端"冲掉）。
  十栏逐项都是实测值，其中两个不显眼但重要的数：**直调工具链 `bin/lean.exe` 138/134/125 ms vs 走 elan 垫片 1657/1799/1865 ms**
  （适配器因此**优先解析工具链自己的 `bin/`**，垫片只当兜底）。
- **闭环成立（真内核裁决）**：`perpendicular` 的**一般命题**（`∀ E D u v`，不是某组坐标）⇒ **`formally_proved`**、
  `axioms ["propext","Classical.choice","Quot.sound"]`、**68.3 s**；**同一条命题只把正文换成 `sorry` ⇒ `exit=0` 但停在 `verified_instance`** ——
  **同一退出码、相反结论**，只有 axioms 报告能把它们分开（这正是十栏 `failureBehaviour` 那一栏的全部理由）。
  端到端用例**显式 gated**（CI 上没有 Lean/mathlib，而 CI 跑 `npm test`、`vitest.config.ts` 含 `scripts/**/*.test.ts`）：
  不满足条件就**打印理由并 skip**（"一条静默的 skip 与一条静默的通过一样坏"），**判据层全部用假输出，在 CI 上永远跑**。
- **一次真实的排障（说明"两条判据缺一不可"）**：第一轮端到端**红** —— 生成的证明体最后一步写成 `exact hu v hv`，而**签名里根本没有 `v`**
  （模板从另一份抽象文件抄了参数名）。**只留"拒 `sorry`"那条判据的话，这个 bug 会被永远掩盖**。
  控制器**独立复算**过正确形式（自己的探针工程、真内核）：`rw [Submodule.mem_orthogonal'] at hu; exact hu (D - B) hv` ⇒ 只依赖三个白名单公理。
- **由"接上后端"暴露并修掉的三处**：
  ① **`eslint` 会去 lint `.lake/`**（它**不读 `.gitignore`**）：mathlib 的依赖包自带 JS ⇒ 建过 Lean 工程的机器上
     `npm run lint` 从 `0 error / 13 warning` 变成 **14298 problems（14247 errors）**，而 **CI 上（无 `.lake`）仍是 0 error** ——
     同一提交两处结论不同。已按该文件**既有**的同一条原则（"别人生成的产物不算我们的源码"）加 `"**/.lake/**"`。
  ② **两条"生产名单是空的"哨兵**（`apps/web/src/components/agent/proofLevel.test.tsx`）：`expect(WIRED_PROOF_BACKENDS).toEqual([])`
     与一条**硬写** `10 栏填齐` 的断言 ⇒ 改成**显式注入"接上 0 个"**来钉那一支的文案，并**删掉名单字面量**
     （"名单恰好是什么"的精确钉子**只留 `scripts/proof-spike/smoke.test.ts` 一处**）。
  ③ **四处已过期的话**（`ConfirmationPanel.tsx` / `ProofLevelNotice.tsx` / `proofLevelStatus.ts`）："今天 `[]`／今天 `0`／**全仓零生产者**"。
     最后那条**性质变了**：现在**确实有东西能产出 artifact**（适配器的显式调用路径），但**默认路径不调用它**、**也没有产物进界面的通道** ⇒
     "不做产物查看器"的理由从"没有生产者"改成这两条事实。
- **仍未达成（不许含糊）**：只覆盖**一个目标类**（一条真目标走通**不泛化**）；**IR → Lean 命题的翻译本身未被证明**（可审计的小模板）；
  `ProofInput.statement` **仍是可选** ⇒ "必绑"只被"适配器记得传 + 一条用例"堵住、**没被结构堵住**；**强沙箱下的证明运行未测**；
  **mathlib 的 rev 没有被 pin**（`lakefile.toml` 是 `rev = "master"`，而 `lake-manifest.json` 是**每次运行都会重新生成**的产物，已加进 `proof/lean4/.gitignore`）
  ⇒ **十栏里那个 mathlib commit 是"实测值"，不是"从仓库可复算"的保证**。

## 2026-10-06 —— 复核 o1/o2：把"同屏字面相反"的那句口径改准，并钉住新分支的说明文案

- **窄复核结论 `Approved`**（N1/N2/N3 它都自己变异验过咬在正确的地方；无 Important/Critical），带出两条 Minor 观察，
  **控制器直接处置**（小改动，不再开一轮）。
- **o1：一屏两句话字面相反。** 报告里那句「分母只算**有对象可读**的轮次」与面板新写的
  「**没有可判的对象**…**仍然算在这一组的分母里**」在同一屏上互相打脸。**代码从头到尾只有一套口径**（按 `status` 分组），
  矛盾**只在措辞**：`rejected` 里"模型什么都没给"的那一类**确实没有正文**，但它**仍在分母里**（已裁决的边界）。
  ⇒ 报告那句改成**按结局定义**：「分母 = 本层结局为 `planned` / `clarification` / `rejected` 的轮次
  （`not_measured` / `error` 不进；正文为空但结局是 `rejected` 的那些**仍算在分母里**）」，
  并在函数注释里写明**为什么分母不能用"有没有正文"定义**。
  **教训**：同一处口径在两个地方各写一句人话，就一定会长出两个版本。
- **o2：新分支那句说明本身没被钉。** 复核指出用例找的「（这一条没有正文可读）」由 `<pre>` 满足 ⇒
  **把那段 `<p>` 整段删掉照样绿**（"不给按钮"那一半是真钉住的）。⇒ 补两条断言
  （"没有可判的对象" + "仍然算在这一组的分母里"），并**自己变异证明它会咬人**：
  把那段 `<p>` 缩回裸句子 ⇒ 该用例红在新断言（`ProviderEval.test.tsx:252/253`），随后**逐字节还原**（blob `05e04106…` == HEAD）。
- **如实记一条不在本批范围的同类**：`benchmarkPlanningEval.test.ts:217` 的 `evidence.length > 0` 是**同一恒真类**（N4b 遗留），本批没碰。
- **验证**：`vitest run benchmarkPlanningEval.test.ts ProviderEval.test.tsx` ⇒ **2 文件 / 31 通过 exit 0**；
  变异态下那条新用例红（`1 failed | 8 skipped`）；还原后 blob 与 HEAD 相同。

## 2026-10-06 —— N5a 复核修正：`十栏` 改成推导、给"词"加类型钉；窄复核把我原本要加的字段**劝掉了**

- **复核 → 修正 → 窄复核**：N5a（R51/R56 输入绑定 + 只读「证明级别」状态面）复核判 **`Approved with minors`**
  （1 Important + 4 Minor）⇒ 提交 `4e54479`（M1）/ `24a5866`（I1 + M2）⇒ 窄复核判 **`Approved`**（新发现 1 条 Minor）
  ⇒ 控制器**一行修掉**后收口。
- **I1（Important）：那句"每一句都由 `facts` 推出，没有常量句"是假话。** 两处：
  ① 今天**就在渲染**的那句里把「**十栏**」**写死**（不来自 `facts`，也不来自 `PROOF_BACKEND_REVIEW_FIELDS.length`）；
  ② 另一分支里那份「题设原话 + claim 原话 + …」是 `ProofInput` 的**第二份手抄副本**。
  **修法与它的取舍**：数字改成**推导**；清单改成「与这份输入的**全部绑定项**都吻合」**不逐项列举** ——
  理由是字段名是**标识符**，要印成人话还得再有一张"字段名→中文"表，**那张表就是同一份副本又抄了一遍**
  （在用户可读文案这一侧，"推导"**消不掉副本**，只是搬了个家）；
  **词**（`formally_proved` / `verified` / `passed`）改用**类型常量**钉住 —— 改名 ⇒ `tsc` 红
  （复核实测 `error TS2820`），**但这条钉只挡"改名"、不挡"语义漂移"**（新增一个"也算成功"的状态不会让它红），
  注释的措辞恰好只声称了它做得到的那件事。**"值靠推导、词靠类型"这个分法我认可**。
- **M1**：`goal: ""` 与"不传 goal"是两个哈希这处**已知不对称**写进注释并补钉子 ——
  **首跑即绿，如实记为钉子、不是 RED**（对应的防御早就在了）。
- **M2 / M5（可达性）**：用例改成只渲染**可达**组合（`wired` 是从审查记录里**过滤**出来的 ⇒
  `reviewedCount >= wired.length` 是生产不变量）。窄复核抓到 `proofLevel.test.tsx:106` **仍然**注入不可达组合
  ⇒ **控制器一行修掉**，于是"用例只渲染可达的组合"这句话**在代码里成立**。
  **如实记一句**：`24a5866` 的提交信息写"两处注入补上"，而当时**只改到 3/4 处** —— **那句话说过头了**（错在提交信息，不在代码行为）。
- **⚠️ 窄复核把我原本要加的东西劝掉了（这一批最值得记的一条）**：我怀疑"推导本身没有判据"，
  要求它**用真实变异回答、不许机制推理**。它的实测：
  - **把推导写回字面量 `10` ⇒ 9 条全绿，一条都不红** —— 那个变异与实现**观察等价**；
  - 但**真正的回归形态判得住**：契约加第 11 栏 + 文案冻结在 `10`（**且先把哨兵改成 `toBe(11)`**）⇒
    **只红"审查栏契约是几栏"那条**，报错 `expected '…交一份 10 栏填齐…' to contain '11 栏填齐'`。
  - ⇒ **裁决：不给 `ProofLevelFacts` 加 `reviewFieldCount`**。加字段只会把判据从"**文案对不对**"换成
    "**实现有没有读变量**"，而真正的危害路径已被那条哨兵挡住；它还会背离 `ProofLevelFacts` 自己那句注释
    （"两个字段都来自包根导出，**没有第三个来源**"）。**这与 R52 同源：能靠结构保证的，就不靠"多一个成员"。**
- **一条过程事故（实施者自报，值得按字面记下来）**：它用 `git checkout -- <file>` 还原变异，
  而**修复当时还没提交** ⇒ **把自己的修复还原成了旧版**，三条读数全部作废。改成**逐字节备份 + 备份还原**
  （证据从"`git status` 干净"改成 **blob 哈希 == 备份**）。
  **教训**：工作树上有**未提交改动**时用 `git checkout --` 还原变异，会把"你的改动"和"你的变异"**一起抹掉** ——
  **那种情况下"`git status` 干净"恰恰意味着还原过头了。**
- **验证**：`vitest run packages/agent-core/src/proof apps/web/src/components/agent` ⇒ **12 文件 / 123 通过 exit 0**；
  控制器改完 M5 后 `apps/web/src/components/agent` ⇒ **9 文件 / 75 通过 exit 0**；`typecheck` 0；`eslint` **0 error / 13 warning**。

## 2026-10-06 —— N4e 的两轮复核修正：把"**宣称了没钉的保护**"钉住（提交 `c68998e` / `99cf2d8`）

- **背景**：N4e 交付后复核给出 **`Changes requested`**（1 Critical + 1 Important + 8 Minor），两轮修完；**判题逻辑一个字未改**
  （第二轮实施者用 `git diff --quiet HEAD~1 HEAD -- benchmarkPlanningEval.ts` = exit 0 证明这一点）。
- **第一轮 `c68998e`（C1 + I1 + m1–m8）**：
  - **C1（Critical）**：`readableBody` 把仓里**明确标注为"不可信"**的信封当可信结构读 —— 信封来自 `modelPlanner` 的三个出口
    （工具通道解析失败 ⇒ **原样**交出 `toolCall.input`；文本通道 ⇒ 交出**原始字符串**）。坏形状会让 `try` 内抛、
    `catch` 里**又调一次同一个无保护的构造**⇒**二次抛出逃出函数 ⇒ 整批 reject、一条读数都留不下**，
    **钱已经花掉的那几次请求的诊断全丢** —— 与本批"不许让诊断留在内存里没渲染"的立项理由正相反。
    修法两条：**全函数防御**（非对象/非数组/非字符串一律返回 `""`，**不抛**）+ **正文在 `try` 内算一次、`catch` 复用**。
    副产品比防御更强：信封不再需要活得比 `try` 长 ⇒ **"在 `catch` 里重算"在类型层面已不可表达**。
  - **I1**：兜底那句 `` `只读回答：${envelope.answer}` `` 对"根本不是信封"的输入会渲染出 `只读回答：undefined`，
    而面板把它当"模型给的那段东西"摆出来、旁边就是三个标注按钮 ⇒ **人会给我们自己拼出来的 `undefined` 打可读性分**。
    该兜底已删除。
  - 8 条 Minor 一并处置（把 `humanReadability` 的"**键必须在**"从一句注释换成**真类型级判据**；
    `BENCHMARK_RUN_REQUIRED_FIELDS` 补**逐项相等**哨兵；等等）。
- **第二轮 `99cf2d8`（复核要求的"补钉"）**：复核员把 `clarification` 支路与 `actionId` 两道防御**删掉**后发现
  **该文件 19 条既有用例一条都不红** —— 于是判 `Changes requested`（理由与它上一轮判 m1/m2 同一把尺子：
  **宣称了没钉的保护**）。本轮补上：**坏澄清必须仍记 `rejected`（不是 `error`）**、**坏 `actionId` 不许渲染出 `1. undefined`**、
  以及把 **恒真的** `evidence.length > 0` 换成**内容**断言（复核员的原话：它由报告契约保证，**不能独立变红**）。
  **控制器自己也做了一次变异**（删 `questions` 闸）⇒ 红成 `['error','error','error']` vs `['rejected',…]`，
  随后**逐字节还原**（blob `493d0b89…` == HEAD）。
- **一处行为改动（唯一的产品改动）**：没有正文的条目**不再给三个标注按钮** —— "给不给按钮"交给**同一个谓词** `hasReadableBody`，
  该支显示「没有可判的对象，所以不提供标注；它仍然算在这一组的分母里」。
  **分母口径一个字没动**（`rejected` 组仍含"什么都没给"）：那一类会**一直显示"未标注"**，
  而那是**诚实的** —— 没有可判对象就不该让人对着空气打分。上一版"同屏显示'没有正文可读'+三个按钮"的自相矛盾随之消失。
- **一条如实记录的限制**：这一轮 5 条变异里 4 条是**字节级**还原（`git checkout` + blob 比对），
  第 5 条（面板那条）因为改动属于**本轮未提交的新代码**，`git checkout` 会把整个改动丢掉，所以用的是**反向 edit** ——
  **它不是字节级证据**，实施者主动申报了这一点。
- **一条过期的自述（如实记）**：实施者报告结尾写"本批仍然没有标注（样本 0），`:324` 依然不能勾" ——
  那句话在它开工时是对的，但**同一天用户就跑了一次并实际标注**（见下一条），所以**已过期**；以计划与 `current-status` 为准。

## 2026-10-06 —— N4 出口达成：人工可读性**第一次真的被标注**，计划 `:324` / `:347` 勾上

- **那件"只能由人做的事"发生了**：用户在桌面端跑第三次题集 planning（3 题 × 1 轮，`seed=7`），
  并在只读「人读区」里**逐条给那几段正文打了分** —— 这是这个仓库里**第一次有人真的读模型的计划 / 提问正文并标注可读性**。
- **读数原文**：`planned 1/3` / `clarification 1/3` / `rejected 0/3` / **`error 1/3`** / `not measured 0/3`；
  `average latency 18153 ms (measured runs only)`；`cost not measured`。
  **人工可读性**：`plan` `已标 1 / 未标 0`、`clarification` `已标 1 / 未标 0`，两条**都判 `unreadable`**
  ⇒ 两组 `readable 比率 0.000`；`rejected` 组本轮**没有题** ⇒ 如实显示「未标注（分母 = 已标 0，不是 0 分）」；**合计已标 2**。
- **来源如实标注**：**用户提供的实测**（控制器**未旁观**那次运行），控制器只核内部自洽：
  `3 = 1+1+0+1+0`、标注 `2 = 1+1`、层与 seed 对得上、`cost` 如实 `not measured`。
- **⚠️ 读法边界（写进文档，防止被读成趋势）**：那是**每组 n=1** 的两个 `0.000` ——
  它说的是"**这一次**有一条计划、一条提问，判的人都说看不懂"，**不是**"模型的可读性差"，也**不是**全题集（21 条）的结论。
  判断者是**"一个不懂实现的人"**（这是口径要求的），不是实现者。
- **计划勾选**：`:324`（"每题最多 3 轮，记录抽取率、求解率、题设覆盖率、verified/unverified/no_witness、成本、延迟和人工可读性"）
  —— **七项里六项此前已在位，人工可读性这一项本次到位** ⇒ 勾；`:347`（N4 收尾检查点）随之勾，
  并**保留"那条建议的提交信息从未被使用"这个事实**（本阶段工作分散在二十多次提交里，勾的是"阶段收尾"，不是"提交信息必须长那样"）。
  **仍然没有数字的只有成本** —— 它是 `not measured`，理由是**仓里没有价目表**（不是没做，也不会因为再跑几次而改变）。
- **同一次运行暴露的一条新边界（已记、未修）**：`unsupported-expression` 那条**没测到**，结局是 **`error`**，
  原因是**模型响应超过了 1 MiB 上限**（`传输失败已尝试 3 次（上限 3）… the response exceeded 1048576 bytes`）。
  **fail-closed 的行为是对的**（它没有被记成 `rejected`/`planned`），但**超大响应那类题今天测不出来** ——
  上限做成可配、或换传输方式，**都还没做**。这同时解释了 `planned` 从 `2/3` 变成 `1/3`：
  **分母没变，是那一条从"有结论"变成了"没测到"**。
- **文档同步（这本批的重点之一：把已经变成假话的句子改准，而不是留着自己烂）**：
  `current-status.md` §一 那一行补第三次运行与标注读数、§一 注释里"仍然既没有字段也没有标注"那句**两次关掉的经过**（字段与呈现 = N4e；实际标注 = 本次）、
  §四 E 的 N4 段两处更正（`:324` 已达成；**"那条 24 次通道仍然是坏的"也过期了** —— `90eba6e` 已修好且已跑过）；
  `agent-release-gate.md`（"真实 provider 的读数一个都还没有"→ 列出两条轴的读数；"延迟 / 人工可读性同样没有"→ **只有成本仍无**）；
  `agent-tool-loop-scorecard.md` 三行（Real provider 两轴都测了、pass@1 那行从 `Not measured` 改成 `Measured: 1/8 / 2/8`、
  Cost/latency 从 `Not measured` 改成"**延迟已测、成本未测**"）；`feature-catalog.md` 的 N4 行同步，
  并**故意保留 ⬜**：成本没有数字、21 条只跑了 3 条、且存在测不出来的题 ⇒ "能力已发布"还不是事实。
- **进程工具的一处静默失效修复（提交 `1232e43`）**：`scripts/sdd/*.ps1` 是 BOM-less UTF-8 + 中文注释，
  而 Windows PowerShell 5.1 按 ANSI（本机 CP936）读它们 —— **UTF-8 中文的第三个字节会与紧随的换行配成一个双字节**，
  于是**换行被吞、下一行代码被并进注释、那一行从 AST 里消失，而解析错误数为 0**。
  实测复现（最小两行注释 + 一行赋值 ⇒ `PARSE-ERRORS: 0` 而那条赋值不见了），并发现**仓里那三个脚本当时只是"运气好"**。
  修法是给它们加 UTF-8 BOM（各 +3 字节，`git diff --numstat` 每文件 `1/1`，只有第一行），
  并用权威检查器（比较 `[Text.Encoding]::Default` 与 UTF-8 视图的**行数**）复验。
  **注意**：这一处提交会让 `bom-check` 报 `mismatches=3` —— 那是**故意加的 BOM**，不是误删。

## 2026-10-05 —— 人工可读性：先把"要读的东西"呈现出来（N4e）；pass@1 轴第一次真实读数；删掉一个假指标

- **N4e（提交 `dbe6fb1`）：人工可读性的一整套口径与呈现**。两次真实运行暴露了前置条件 ——
  报告里只有**计数**与**证据串**，没有"模型给的那段东西"，于是任何"可读性"标注都是**凭印象**。现在：
  ① harness 从**内存里的信封**取正文（计划的 `goal`+动作摘要 / 澄清的问题 / 只读回答），与 `runs` **一一配对**；
  ② 面板新增**只读**「人读区」（有界 480、截断时如实写原长）；③ 契约加 `humanReadability`
  （**键必须在、值可 `null`**，词表外的值一律拒收）；④ 口径写死在契约里：三值 + 判断者是"不懂实现的人"、
  **`not_measured`/`error` 不进分母**、**`plan` 与 `clarification` 各有各的分母**、
  **rate 的分母是"已标注"条数 ⇒ 0 标注时是 `null` 而不是 0**。
  **本批"已标注"= 0**：报告里出现的是「未标注（分母 = 已标 0，不是 0 分）」，没有 0、没有占位比率。
  **`:(324)` 仍不勾** —— 剩下的不是代码，是**一个人真的去读那几段正文并打分**。
  一处我没想到、它钉住了的陷阱：**见证层也有一个同名的 `clarification`**，而只有 `planning` 层有"要读的那段东西"，
  所以见证层那个**不进**可读性分母。
- **pass@1 轴的第一次真实读数**（用户在其桌面端运行、控制器未旁观；那条通道的请求形状缺陷已在 `90eba6e` 修好）：
  `pass@1 1/8` / `pass@3 2/8` / `tool selection 45/45` / `tool error rate 4/45` / `average latency 4126 ms` / `average cost not measured` / `attempts 24`。
  口径：`passAt1` = **第 1 轮就过**的题数、`passAt3` = **三轮里任一轮过**。**与离线 `4/8` 的对比要小心说**：
  真实模型这一次**更低**，但两边**不是同一个被测对象**（离线那条腿是协议与几何回归，本仓一直禁止把它读成模型准确率），
  且这里是 8 题 × 3 轮、**单模型单次采样**。它证明的是更朴素的一件事：**这两个数确实不是一回事。**
- **删掉一个假指标**：报告里的 `semantic verify` 那一行原来打的是 `percent(scorecard.passAt1)` ——
  **把 `pass@1` 又打印了一遍**（`AgentEvalScorecard` 里没有独立的语义验证字段，全仓也无断言钉过它）。
  后果不是"少一行"：读数里会出现**两个名字、一个数**，而**发布门禁第 2 条**点名的恰是"pass@1 **和语义验证率**"⇒
  那个名义指标**看起来存在、实际没有**。**该行已删除**，并在发布门禁里写明"这个指标今天仍未被实现"
  （判据其实在仓里：`verification/taskVerification.ts` 的任务级语义验证器 + 记分卡给它的定义）。
  ⇒ 那次 pass@1 读数**只有 5 个数据点**，不是 6 个。
- **N6 第 2 条（每个 flag 有单元/浏览器/回退用例）：勾上，但逐格写明** ——
  `constrainedDrag` 三类齐；`obligationIR`/`witnessSearch` 的浏览器格 **【不适用】**，理由**不是"缺代码路径"**
  （运行时会读它们）而是"**浏览器里没有办法打开它们**"；两个占位开关是零读取点。
  **并写进覆盖矩阵**："不适用"是**有前提的结论**：哪天给那两个开关加了产品入口，就必须补浏览器用例并重审那一格。
- **`vite.config.ts` 的缓解注释升级**：从"效力未验证"改成"**有两次实地观察支持，仍非决定性**"
  （加它之后同样动作做过两次都没再崩：控制器改 5 个 app 文件；实施者触发约 30 次 HMR；加它之前同样的动作崩过两次）。
- **门禁**（控制器自跑）：typecheck 0；lint 0 error / 13 warning；定向 15 文件 / 149 通过；
  全库 **320 文件 / 3681 通过 + 1 todo**；`bench:agent` 三条读数**逐字不变**；`eval:agent` 四个数**逐字不变**；
  `test:e2e` **194 通过**；BOM `mismatches=0`。

## 2026-10-05 —— 让那个"唯一会花钱的按钮"真的能跑（请求形状收成一处）+ 读数按两条轴纠正

- **修的是"从来没有真正工作过"的通道**（复核员用探针独立复现、控制器读代码确认）：
  旧「agent 工具环」通道把请求写成 `plan({ userMessage } as never)` —— 对本地规划器成立，
  对**真实** `createModelPlanner` **不成立**：它在**发出任何网络请求之前**就读 `request.model.context`
  ⇒ `TypeError: Cannot read properties of undefined (reading 'context')`。后果不只是"报错"：
  那是应用里**唯一会花钱**的入口，而它从来没有真正发出过一次请求。
- **一处定义**：新增 `packages/agent-core/src/coordinatorPorts.ts` 的 `buildPlanRequest`，
  就放在 `PlanRequest` 端口旁（`PlanRequest.model` 的既有注释已经把这件"模型能看到什么"判给协调器）。
  它调的**就是**协调器原来那三个函数、**同样的顺序**（`buildContext` → 计费 → `buildConversationContext` →
  `createToolRegistry().forModelPhase("planning", …)`）。**三处收敛**：协调器自己 / 旧 8 题通道 / 题集 planning 通道
  （后者原先手写的约 60 行组装被完整取代）；`availableActionsFor` 也从两份收成一份。
- **旧通道语义一个字未改**：8 夹具 / `TRIALS` / `scoreAgentAttempts` / 先解析 provider / 无凭据 `not_measured`，只改请求形状。
- **一处控制器早读发现的真回归（已修 + 已钉）**：抽出请求构造时把 `dependencies.conversation?.()` 从"计费之后"
  挪到了"计费之前" ⇒ **预算耗尽的那一轮会多读一次宿主的会话来源**（旧代码在那条路径上根本不碰它）。
  改成 **thunk**（类型强制惰性）并加了一条**能红**的用例（"预算耗尽时 thunk 调用次数是 0"）。
  实施者如实申报：**加 thunk 之前那条用例确实红**（`expected 1 to be +0`）—— 那不是理论问题，是真被引入过的回归。
- **裁决：旧通道固定 `geometry3d` 不改**（实施者按纪律停手上报）。查证：8 条夹具**没有任何 `workspace` 字段**
  ⇒ 硬编码与夹具一致，是该通道从第一天起的口径 ⇒ **今天不是缺陷，是潜在约束**（加 CAD 夹具时才需要读它）。
- **读数纠正：真实 provider 必须按"两条轴"读**（这句话在本批之前被写成了一条）：
  **① 题集 planning 轴已跑两次**（`planned 2/3`；按现在的词表 = **`clarification 1/3`**，那一条是**模型在问、不是失败**；
  n=3、空画布条件）；**② 工具环 pass@1 轴不是"没跑"而是"以前跑不了"**，本批修好、**修好后仍没人跑过**；
  **③ 成本**与两者无关（没有价目表 ⇒ 恒 `not measured`）；**④ 人工可读性**仍缺字段与标注（N4e）。
- **门禁**（控制器自跑）：typecheck 0；lint 0 error / 13 warning；定向 16 文件 / 217 通过；
  全库 **319 文件 / 3665 通过 + 1 todo**；**`bench:agent` 三条读数逐字不变**；
  **`eval:agent` 四个数与旧读数逐字相同**（`pass@1 4/8` / `pass@3 4/8` / `tool selection 45/45` / `tool error rate 3/45`）；
  `test:e2e` **194 通过**；BOM `mismatches=0`。
  （`eval:agent` 这条门禁是控制器中途补的 —— 本批改了离线那条路径的请求内容，而它是 §一 的在版读数，简报最初漏列。）
- **用户需要知道的影响**：修好之后那条 **24 次请求**的按钮**真的会花钱**（8×3；题集通道另 3 次），两段式确认仍在；
  **实施者与控制器都没有跑它**，"真实 provider 上能不能跑成"**仍未被证明**（已证明的只是请求与生产路径同构 +
  真规划器能走完 24 次、假 transport、零网络）。

## 2026-10-05 —— 第一次真实 provider 读数（用户跑的）+ 逐条渲染与"钱按钮"不许假装在跑

- **第一次真实 provider 读数**（计划 N4 `:326` 的落点）：**用户在自己的桌面端**跑的应用内
  「真实 provider 评测：题集 planning」（授权规模 **3 题 × 1 轮**），面板原文：
  `planned 2/3` / `rejected 1/3` / `error 0/3` / `not measured 0/3`、`average latency 13445 ms (measured runs only)`、
  `cost not measured（仓里没有价目表）`、provider `deepseek-v4-flash`、`cases 3（layer=planning，seed=7）`。
  **来源如实标注**：控制器**未旁观**那次运行，只核了内部自洽（`3 = 2 + 1 + 0 + 0`、层与 seed 对得上、身份非空、成本如实）。
  **读法**：空画布条件下的规划请求 ⇒ `2/3` 是「**空画布条件下计划被接受的比例**」，**不是**"模型的规划能力"，
  也**不是**全题集（21 条）的结论（**n=3**）。
- **这次运行暴露并立刻修掉的一处缺口**：面板当时**只渲染汇总** —— "被拒的那一条为什么被拒"随窗口一起丢了，
  而原因其实就在 `runs[].evidence` 里（`code@path: detail`，或"模型给的是澄清/只读回答"）。
  现在**逐条渲染**（题 id / 结局 / 理由原文，带截断上限，截断时如实写原长）。
  **诊断信息留在内存里而没渲染，等于这次运行白跑一半。**
- **"唯一会花钱的按钮"不许再假装在跑**（复核 I-2，独立复现过）：旧那条 agent 工具环通道**不接异常**，
  于是 `setState({kind:"running"})` 之后 promise 被拒、面板**永远停在"正在跑…"**；
  而这条分支**今天必然走到** —— 它把请求写成 `{ userMessage }`，真实 `createModelPlanner` 在发出任何请求之前
  就抛 `TypeError: Cannot read properties of undefined (reading 'context')`。
  修法：旧通道与题集通道**共用同一支 `failed` 状态**（原来只有题集那套有），并明确写出它与"没配好"那支的**区别**
  （那支能保证"一次请求都没发"，这一支**不能**：异常可能出现在跑到一半时）。
  **两次变异**证明新判据会咬人（失败详情换固定串 ⇒ 红；catch 改回 `running` ⇒ 红），两次都还原。
  **没有**改旧通道的请求形状 —— 那会改变旧评测在测什么，**需要单独裁决**。
- **复核 Minor 里"会说谎或与钱有关"的几条**：`report.ts` 交叉引用指错行已改正；
  界面里的"21"改成单一常量 + 一条钉住它等于题集真实条数的用例；
  **金钱可见文案**"将发出 N 次请求"改成"**至少** N 次"并写明重试上限（上限从 `modelPlanner` 同一处取，
  为此把 `MAX_TRANSPORT_ATTEMPTS` 导出）；把保护归因给"类型"的说法改正为"控制流 + 用例"；
  并把复核要求的三处差异（`signal` 永不可中止、`compilePlan` 未带两个 flag、`conversationId === runId`）
  写进适配器注释 —— 不写出来，"这条请求 = 生产请求"就是一句不可核的话。
- **门禁**（控制器自跑）：typecheck 0；lint 0 error / 13 warning；定向 13 文件 / 131 通过；
  全库 **318 文件 / 3662 通过 + 1 todo**；`bench:agent` 三条读数**逐字不变**；`test:e2e` **194 通过**；BOM `mismatches=0`。
- **第二次运行（同一天、同 3 题）—— 逐条渲染在生产里生效，并立刻给出一个实质发现**：这次的逐条行是
  `underdetermined-pyramid-base` **planned**（诊断 0、动作 1、草稿已产出）、`unsupported-expression` **planned**（诊断 1、动作 1、草稿已产出）、
  `contradictory-two-lengths` **rejected，而原因是「模型给的是澄清、不是计划」** ——
  它问：「线段 AB 的长度不能同时等于 3 和 5（同一线段只有一个长度），请二选一：你希望 AB = 3 还是 AB = 5？」。
  汇总两次一样（`planned 2/3`），延迟 **13445 ms → 8465 ms**（n=3，这个均值本身很粗）。
- **⚠️ 由此得出一条必须写死的读法**：`rejected` 这一格**混着两种相反的东西** ——
  ① 模型**自己发现矛盾、于是提问**（这次就是这种；它与本产品自己的可证矛盾检测是同一个判断，属于**好**行为）、
  ② 编译器把计划拒了 / 模型根本没给计划（失败）。**合成一个计数会把"模型做对了"读成"模型失败了"。**
  建议把"模型只给了澄清"独立成一支（跨层词表里已有 `clarification`，见证层在用），
  或至少在计数行下按子类拆开 —— **但必须由结构化字段驱动，不许去解析中文证据串**（那是第二份判断）。
  **尚未实施，需要裁决。**
- **已实施（用户批准"按推荐做"）**：`planning` 层**新增 `clarification` 一支** ——
  契约词表变成 `["planned","clarification","rejected","not_measured","error"]`，
  应用侧结局判定从两支变三支（信封 `kind === "clarification"` ⇒ `clarification`，带**问题原文**），
  汇总多一行 `clarification N/M`。`rejected` 只留"编译器拒了 / 只读回答 / 什么都没给"。
  **fail-closed 一个字没改：澄清不是 `planned`**（"问了"不等于"计划被接受"）。
  于是那两次运行按今天的词表会读成 `planned 2/3` / **`clarification 1/3`** / `rejected 0/3`
  —— 面板当时显示 `rejected 1/3` 是**旧词表**的结果，两者都留在文档里，便于回溯。
  **RED**：改前那条用例红成 `expected ['rejected',…] to deeply equal ['clarification',…]`；
  **契约哨兵按设计先红一次**（`expected ['planned','clarification',…] to deeply equal ['planned','rejected',…]`）。
  **变异**：把汇总行标签改成 `clarify` ⇒ 红，证明它钉的是汇总行；并顺手修掉一条**不可能红的弱断言**
  （原 `toContain("clarification")` 会被逐条行满足，改成 `/^clarification\s+3\/3$/m`）。



## 2026-10-05 —— 应用内评测接到 21 条题集上，报告契约新增 `planning` 层（N4b）

- **为什么**：上一批把题集与报告契约搬进了 `packages/agent-core/src/benchmark/`，但**应用内那次真实
  provider 评测仍然跑自己那套旧 8 题夹具**（`AGENT_TASK_FIXTURES`）—— 两边都自称"跑过了"，数字**不可比**。
  这一批把应用侧真正接到那 21 条上。
- **契约新增第三层 `planning`**（`packages/agent-core/src/benchmark/report.ts`）。词表四个词，含义写在定义处：
  `planned`（`compilePlan` 返回 `ok` **且**给的是 `kind:"plan"` 的信封 —— 判据只有编译器那一个返回值，
  **不看模型自述**）、`rejected`（**没被接受**，含两种且 `evidence` 带真实原文：编译器报了 error，
  **或**模型根本没给计划 —— 澄清/只读回答也记这一支，fail-closed）、`error`（跑的时候抛了，带原始消息）、
  `not_measured`（这一轮什么都没测，显式 `null` 的 `provider`/`model`）。**不塞进 `extraction`**：
  拿见证/抽取的词描述"计划被不被接受"是 `report.ts` 自己写明的**范畴错误**。
  CLI 仍只发 `extraction` / `witness` 两层 ⇒ `bench:agent` 三条读数**逐字不变**
  （`cases=21 covered=14 empty=7 error=0` / `obligations=24 residue=9 rate=0.727` / `covered=14/21 rate=0.667`）。
- **那句报错文案改成与层数无关**：原来写"见证了层的结局词描述不了抽取层"，加第三层之后它只点了两层名。
  现在写"每一层有自己的结局词表，跨层用词会被拒"——**理由保留**，层名清单仍由
  `${BENCHMARK_LAYERS.join(" / ")}` 给全（下次再加层不用改这句）。
- **应用侧新通道**（`apps/web/src/agent/fixtures/benchmarkPlanningEval.ts`）：题集来自
  `parseBenchmarkCases()` 的**前 3 条**（本次小样本）、固定 `seed=7`（与 CLI 同一个）、
  `cost` 显式 `null`（**仓里没有价目表，不许编**）、`latency` 实测每条的墙钟毫秒；
  路径是 `createModelPlanner` → `plan(request)` → `compilePlan`（**判题口径只有一处**）。
  **先解析 provider，再决定要不要跑**：解析失败 ⇒ 整批 `not_measured` 且**一次请求都不发**。
- **界面上那两套评测各自独立、各自两段式、各自报自己的请求数**
  （agent 工具环 8 题 × 3 轮 = **24 次**；题集 planning 3 题 × 1 轮 = **3 次**），
  旧那套的**行为一个字未改**。合并成一个按钮会让"我点了什么、会花多少钱"说不清，故不允许。
- **读数边界（必须一起读，2026-10-05 控制器补记）**：这条通道发的是**空画布条件下的规划请求**
  —— 观察结果是空场景、技能是**全部技能**、且**没有只读工具**（没有 `ToolPort` 宿主）。所以将来那个数字要读成
  「**空画布条件下计划被接受的比例**」，**不是**"模型的规划能力"（真实会话里有画布观察、有只读工具、技能可能被裁剪）。
  这句原本只写在 `benchmarkPlanningEval.ts` 的注释里；控制器把它补进状态文档与这里 ——
  一个会被误读成"模型能力"的数字，光写在实现注释里不够。
- **没有跑那次付费运行**：它由人在桌面端点、密钥在系统凭据库里（浏览器只会得到 `no_desktop_shell`）
  ⇒ **真实 provider 的读数仍然一个都没有**，`not measured` 照旧。
- **这一批还改了一处过期措辞**：`scripts/agent-benchmark/run.test.ts` 文件头与一条用例标题里写着
  "适配器还没写"—— 那句话今天不成立（生产侧适配器与应用侧通道都在），改成点名事实：**这条 CLI 入口没接**。
  **行为未动**（该模式下整批 `not_measured` 是诚实的）。
- **发现一处既有缺陷，未修、如实记**：`providerAgentEval.ts` / `offlineAgentEval.ts` 那条旧通道把请求写成
  `{ userMessage } as never`。那对 `createLocalPlanner`（只读 `userMessage`）成立，对**真实**
  `createModelPlanner` **不成立**（它要 `request.model.context` / `run` / `budget` / `signal`），
  实测抛 `TypeError: Cannot read properties of undefined (reading 'context')` ——
  而且抛在**任何请求发出之前**，所以那个"唯一会花钱的按钮"当前用真实规划器会一次都不发就失败。
  **新通道不受影响**（它用完整的 `PlanRequest`，并有"真规划器 + 假 transport"的用例钉着）；
  旧通道的修法会改变旧评测的语义，**留待控制器裁决**。

## 2026-10-05 —— benchmark 题集与报告契约搬进 `agent-core`（一份定义，CLI 与应用共用）

- **为什么搬**：`scripts/` **不是工作区**（根 `package.json` 的 `workspaces` 只有 `apps/*` + `packages/*`），
  所以**应用侧（浏览器）拿不到它**。后果此前一直挂着：应用内那次真实 provider 评测跑的是自己那套旧
  **8 题**夹具（`AGENT_TASK_FIXTURES`），而 `bench:agent` 跑的是 **21 条** —— 两边都自称"跑过了"，
  **数字不可比**。搬进包后，题集与报告契约在 CLI 与应用之间是**同一份**。
- **搬了什么（零改动的搬运，用 blob 哈希核对而非 diff 推断）**：`report.ts`（314 行）/ `redaction.ts`（66 行）/
  `dataset.schema.json`（41 行）三份 **blob 级完全相同**地移到 `packages/agent-core/src/benchmark/`；
  `dataset.ts` 只 **+20 行**（`import`、`parseBenchmarkCases()`、注释）、**零删除** ⇒ 校验规则一条未动；
  新增 `benchmark/index.ts`（**逐项 re-export**）与包根 `export * from "./benchmark"`。`runner.mjs` 未动。
- **题集载体**：`scripts/agent-benchmark/cases.jsonl` 删除，改为 `cases.ts` 的 `BENCHMARK_CASES_JSONL`
  **文本常量** —— 格式仍是 JSONL（`parseBenchmarkDataset` 逐字不变地解析），载体换成"能被 import 拿到的东西"
  只因**浏览器不能 `node:fs`**。原文由 git blob 生成、不手抄。
- **"一个字节都没变"是复算的**：那段字面量解析回文本后与 `e96d0f5:scripts/agent-benchmark/cases.jsonl`
  的 blob 逐字节比对 —— **5488 字节 / sha256 `7bc7b49c074b85f3fc09cbbf91a1eb1a64883ce9078424741ee2d047af54769e`
  / 无 CR（只有 LF）**，双侧一致；`cases.ts` 注释自报的 blob 与摘要也被独立复算对上。
- **读数不变**：`npm run bench:agent` exit 0 / 13 通过，`cases=21 covered=14 empty=7 error=0`、
  `BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727`、`BENCHMARK_EXTRACTION covered=14/21 rate=0.667`、
  见证层 `solveRate=0.048` —— 与改前**逐字相同**。
- **新增应用侧判据**（`apps/web/src/agent/fixtures/benchmarkContract.test.ts`，5 条，**只 import 包、不读文件**）：
  21 条 = 七类各 3、**题集冻结指纹**、词表/状态常量可用、报告契约可调用并正确分组、报告错误类型文案未变。
- **两处"宣称"被换成"会咬人"**（都做了字节级备份 + 还原，变异完文件 sha256 与备份逐字节一致）：
  1. 这条判据的第一版是**恒真式**（断言 `parseBenchmarkCases()` 与
     `parseBenchmarkDataset(BENCHMARK_CASES_JSONL)` 相等，而前者就是后者的定义，**不可能红**），
     注释却宣称它能挡"两份副本分叉"，而**根本没有第二份** —— 换成**冻结指纹**后，删一个字符会红
     （`expected 5485 to be 5488`）、同字节长度换一个标点也会红（`da626ef5…` ≠ `7bc7b49c…`）；
  2. `scripts/nodeTypes.d.ts` 里 `readFileSync` 的理由写的是"`scripts/agent-benchmark` 的用例用它读题集"，
     那个用法已被本次搬迁删掉 ⇒ 注释改成点名当前真实用户，**声明本身保留**（还有人需要）。
- **本批没有解决的**：应用内评测**仍然**跑那 8 条夹具（接线是下一步）；`run.test.ts` 的 `real_provider`
  仍整批 `not_measured`；`parseBenchmarkCases()` **未加缓存**（刻意不引入第二份可漂移的东西，调用方应只调一次）。
## 2026-10-05 —— 第二次现场：模型只填了 `alias`、没填 `label`，于是那个点**没有名字**

- **现场**：用户重建桌面端后再跑同一题，**报错逐字相同**（"题设尚未核验：O为 BD的中点：点名缺失…"），
  但 trace 变了：**暂存 4 笔**（上次 1 笔）、而且规划阶段调了 `scene.inspect` —— 说明模型确实在建 O。
- **诊断（复现，不猜）**：探针实测两种写法 ——
  - `alias: "O"` **不给** `label` ⇒ 点建出来了、坐标**完全正确**（BD 中点 (0,0,0)），但**没有名字**；
    编译器报 `diagram_condition_unverified`（**放行但标记未核验**）⇒ 最后卡在确认门禁上，
    **与用户 trace 里"校验成功 → cannot confirm"逐字吻合**；
  - `alias: "O"` **且** `label: "O"` ⇒ 无诊断、核验 **passed**。
- **根因**：`alias` 是**草稿内的引用名**，`label` 才是**题面里的点名** —— 而模型很自然只给了前者。
  我上一轮的修复（让核验认 `label`）**没做错，但只覆盖了"模型给了 label"那一半**。
- **改法（一行 + 一段注释）**：`scene-graph` 的 `compileCreateBoundPoint` 里
  `label = inputs.label ?? inputs.alias` —— **没给点名时，用草稿内别名当它的名字**（显式 `label` 仍优先）。
  `alias` 本来就是模型给这个对象起的名字；`solid` 用 `vertexNames` 给顶点命名的道理一样。
- **一处缺口如实记**：这条默认**没有**写进登记表的 `defaults` —— 那里的策略闭集（`PlanDefaultPolicy`）
  里没有"从别的字段派生"这一档（`infer_from_facts` 是从**用户的话**里读），加它要牵动审计与提示词渲染。
  **要不要加那一档、以及 2D / 其它 create 动作要不要同样的退回，留待决定**（本次只改点绑定这一条）。
- **证据**：RED（"`O` 根本不存在"）→ GREEN；全库单测 **3639 → 3640 通过 + 1 todo / 0 失败**；
  `typecheck` / `lint` exit 0；**黄金样本 13 条仍绿**。

## 2026-10-05 —— N3 出口收尾：过约束拒绝 / 冲突恢复 / 一步撤销的**浏览器**证据

- **N3（动态拖动保持约束）的出口达成。** 此前只达成一半：`=false` 时旧拖动路径的浏览器回归、`=true` 时保持约束都在，但出口点名的**过约束拒绝 / 冲突恢复 / 一步撤销**只有**单元**证据。
- 补齐 `e2e/agent-constrained-drag.spec.ts`（现 **5 条**；提交 `d7fe702` + `2dd89ab`，**零产品改动**）：
  **过约束拒绝** —— 同一条线段被赋两个长度（可证矛盾）时拖动被拒、拒绝文案**点名冲突的约束 id**、草稿坐标逐字未变；
  **冲突恢复** —— 拒绝既不写文档也**不占一步历史**（撤销按钮保持禁用），把冲突从草稿里去掉并重载后同一次拖动**正常提交**；
  **一步撤销** —— 先证明 A 真的动过（且 `|AB|` 仍是 1），一次 Ctrl+Z 让**四个点**全部回到拖动前，且**没有第二步**可撤。
- **三条是"回归钉子"而不是 RED**（首跑即绿，实施者如实申报）。每条都用**变异**证明会咬人：拒绝落回旧路径 → 前两条红；关掉"同段两长度"矛盾判据 → 前两条红（文案降级成"轮数内没能同时满足"，**语义分裂被抓住**）；`applyBatch` 拆成逐点 `apply` → 撤销那条红；提交分支强制成 `noop` → 后两条红；加一步幽灵历史 → "没有第二步"红；拒绝只点名一个 id → id 断言单独红。**六个变异全部还原**、产品树逐字未变。
- **仍未实现（如实记，不影响该出口）**：`inconsistent` / `timeout` 两个状态 —— 顺序投影下矛盾只会振荡，本层如实报 `exhausted` 而不报"无解"；`timeout` 在这层没有时钟，也不打算为凑状态引入一个。`DragSolveResult` 的五个状态因此**仍未按计划原文成立**。
- **门禁**（控制器自跑）：全量 e2e **194 通过 / 0 失败**（1.1 min；上一版 191 + 本轮 3 条）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。

## 2026-10-05 —— `hostEdge`：按端点名指定棱（用户裁决；一步之内绑对，不必赌下标）

- **动机（承上一条）**：`hostSub` 是**宿主内部的棱下标**。模型在一个 stage 里"先建实体、再绑点"时
  **拿不到那次的观察结果**，只能赌下标；而赌错会被几何语义校验**当场拒绝**（实测：
  `diagram_condition_failed: O为 BD的中点：实测 0.70711，题设要求 0。`）。
  `hostEdge: { from, to }` 让它直接说"**B 与 D 之间那条棱**"，由编译器去查两端点名 —— **顺序无关**。
- **配套六处（缺一件都不成立，每一件都有它自己的守卫）**：
  1. `actionRegistry`：`inputFields` 加 `hostEdge`；`RawFieldTypes` 加 `hostEdge: "namePair"`；
     `FieldKind` 闭集加 `namePair`（**新字段必须显式声明**，这是刻意的）；
  2. `actionSchemas`：**发布给模型**的工具 schema 加 `namePair`（`{from,to}` 两个 string、required、
     `additionalProperties: false`）；
  3. `actionFieldParity.test`：**每个 `FieldKind` 都必须有形状断言** —— 补 `namePair`（这条奇偶守卫
     本身就是"新种类必须显式声明"的第二道）；
  4. `actionInputs`：`normalizeHostEdge`（两个有界非空点名）；
  5. `scene-graph`：动作类型加 `hostEdge`；`compileCreateBoundPoint` 里 `resolveEdgeByNames`
     —— 拿宿主物化出来的 `edge3` 的 `pointIds` 比对两端 `label`，**唯一命中**才返回 `...:e{k}`，
     **后面那条路径一个字节都没变**；找不到 ⇒ `edge_not_found`（detail 里**列出这条实体有哪些点名**，
     否则模型无从修）；
  6. 技能摘要：`spatial-modeling` 改成"**优先用 `hostEdge`**"，`hostSub` 只在拿不到点名时用。
- **又一次"同一个判断写了两遍"（与上一条同一笔账）**：我把「两条都给不许猜」在**校验层**与**编译层**
  各判了一遍 —— 于是靶向变异（去掉校验层那处）**全绿**、抓不住。删掉校验层那处、只留编译层
  （并在校验层写明判据在编译层）之后，变异立刻抓住它。
  **冗余的判据不是双保险，是假守卫** —— 这一条今天第二次记。
- **一支到不了的判据，如实标注**：`ambiguous_edge` 今天**到不了** —— 两个顶点同名在
  `solid.create_polyhedron` 那一层就被拒了（`duplicated…`），而正常多面体两顶点之间只有一条棱。
  所以用例改成**钉住"到不了"这件事**，注释里明说**不声称它有守卫**；留着那一支是为了将来真出现时不许猜。
- **又一次自己挖的引号坑**：把 `{from:"B",to:"D"}` 写进 TS 的**双引号字符串**里，未转义的引号把字符串截断，
  表现是两个测试文件报 **transform 错误**（不是用例失败）—— 这类"文件级失败"要看清是语法还是断言。
- **证据（都验过红绿）**：RED 5 条全红（`unknown_field`）；**变异 A**（解析只看一端）⇒ 2 条红；
  **变异 B**（去掉"两条都给"的判据）⇒ 1 条红；全库单测 **3634 → 3639 通过 + 1 todo / 0 失败**；
  `typecheck` / `lint` exit 0；**黄金样本 13 条仍绿**。

## 2026-10-05 —— 修掉"O 为 BD 的中点"那条死路（用户现场：题设尚未核验）

- **现场**：用户在三棱锥 A-BCD 的题上得到"题设尚未核验：**O为 BD的中点**：点名缺失、图形退化或角度无法计算"。
  复现之后查明**根因不在题面**，而在两个口子：
  1. **点名表只从一种动作里建**（扼颈的那一个）：`candidatePoints()` 原先**只**读
     `solid.create_polyhedron` 的 `vertexNames`，**从不看图元的 `label`** ——
     所以哪怕文档里明明有一个 `label:"O"`、坐标正落在 BD 中点的点，核验也**看不见它**；
  2. **立体几何那一轮的菜单里一个建点动作都没有**：`spatial-modeling` 技能只声明了 6 个 `solid.create_*`，
     而"把点放到某条棱的中点"的现成动作 `dynamic.create_bound_point`（`parameter: 0.5` 就是中点）
     被放在 `dynamic-bindings` 技能里 —— **模型看不到它，也就无点可放**。
- **改法（两处都在既有缝上，没有新写动作）**：
  1. `diagramVerification.ts` 的 `candidatePoints`：在原有 `vertexNames` 之外**再扫一遍带 label 的 `point3`**。
     三条语义一起定死：**顶点名优先**（标签不许顶掉 `vertexNames` 定的名字）、
     **同名只许一个**（同一标签出现两次 ⇒ 该名字缺失、如实未核验 —— **不猜**）、
     **非单字母标签不进表**（点名的形状是 `[A-Z]`）；
  2. `skills/manifest.ts` 的 `spatial-modeling`：菜单加上 `dynamic.create_bound_point`，
     并把"`hostSub` 是第几条棱、`parameter` 0.5 是中点"这句语义写进**模型读得到的**技能摘要里。
     清单内容变了，按本仓的签名机制（`catalog.ts` 的 `EXPECTED_HASHES` 覆盖 `actionIds`）
     **重新签了该技能的哈希** —— 这是设计要求的动作，不是绕过校验。
- **一次自己抓到的缺陷（值得记）**：我第一版把"顶点名优先"在**两处**都判了一遍（收集时 + 写入时），
  互为冗余 —— 于是那条用例**单点变异改不动行为**（试了两次都全绿）。
  按本仓"**同一个判断不许写两遍**"删成一处后，变异立刻能抓住它。**冗余的判据不是双保险，是假守卫。**
- **定向变异三次（都验过）**：① 去掉"同名只许一个"⇒ 红；② 让标签能顶掉顶点名 ⇒ 红；
  ③ 端到端那条把 `hostSub` 从 4（BD）改成 0 ⇒ 红。
- **证据**：新增 4 条用例（带 label 可被点名 / 同名不猜 / 顶点名优先 / **端到端**：
  实体 + 绑在 BD 中点的 O ⇒ "O为 BD的中点" **passed**）；全库单测 **3628 → 3632 通过 + 1 todo / 0 失败**；
  `typecheck` / `lint` exit 0；**黄金样本（关闭 flag 时编译器输出逐字节相同）13 条仍全绿** —— 这次改动没有碰那条契约。
- **还没做完的（如实记）**：
  1. ~~**`hostSub: 0` 编译不过** …… **这是个真缺陷，下一轮查**~~ —— **（同日更正：那句是错的）**
     把它查清了：`hostSub: 0` **不是**编译不过。它把 O 正确地放到了**第 0 条棱**（A–B）的中点，
     然后**编译器照规矩核验题设**，报 `diagram_condition_failed: O为 BD的中点：实测 0.70711，题设要求 0。`
     ⇒ **fail-closed 在正常工作**：猜错棱下标会被**当场拒绝**，而不是静默出一张错的图。
     （顺带把两条线索接上：这条诊断**就是**被黄金样本钉住、属于待裁决 ⑤ 的那句文案。）
  2. ~~**模型推不出"BD 是第几条棱"**~~ —— **（同日更正：也不需要新能力）**：
     `Edge3Primitive` 带 `pointIds: [string, string]`，而观察的 `REFERENCE_FIELDS` **包含 `pointIds`**；
     顶点又带 `label`（A/B/C/D）。所以建完实体之后，模型在观察里**就能读出**"哪条棱连着哪两个顶点"。
     真正缺的只是**那条两阶段走法被说出来**：**先建实体 → 从观察里读棱 → 再把点绑上去**（别猜）。
     已把这句话写进 `spatial-modeling` 的技能摘要（模型读得到的地方）。

## 2026-10-05 —— 文档同步：方案 C 落地后把四处口径改准，并把 perf 补成三次采样区间

- **perf 读数改成三次采样**（上一轮承诺过：单点不足以替代区间）：`drag/300-frames`
  **479.2 / 487.7 / 486.5 ms ⇒ 区间 479–488 ms**。比第 37 轮记录的 **686–711 ms** 明显低
  （同一台机器、同一批用例）；两者并存，因为性能与机器负载相关，一次区间不代表另一台机器。
- **发布门禁第 2 条那一行**（`agent-release-gate.md`）补上"**路径已存在**"：应用内「设置 → 真实 provider 评测」，
  但**仍是 ❌ 未测** —— 会花钱、要人点两下，跑之前那几栏如实写 `not measured`。
- **门禁 N4 一节**改准一处容易混的说法：**"走哪条通道"这个决定已经做了**（方案 C），
  已落地的是**评测那一侧**；**benchmark 那一侧（21 条题）仍未写**，而且它的题集与报告契约在
  **workspace 之外**，要先搬进包里。
- **能力目录 N4 行**补上同一个区分（评测侧 harness 已落地但一次没跑 / benchmark 侧仍未写）。
- **计划文件 N4 记录**同步同一句（把"两个决定"改成"决定已做、评测侧已落地"）。
- **没有改的**：任何**带日期的历史文档**（`v3.0.md`、`2026-09-29-*`、`2026-09-18-*`、外部调研等）。
  它们记的是"当时怎么样"，按本仓规矩**不许改写** —— 这一点在"更新文档"这类批量动作里最容易做错。

## 2026-10-05 —— 真实 provider 评测：harness 与入口落地（**方案 C**，用户裁决）

- **裁决**：`real_provider` 走**应用内跑 harness**（C），而不是"脚本自己发请求"（B）。理由是硬的：
  B 要在 TS 里再写一遍三家方言的拼请求与解码（**第二条调用路径**），还要把密钥交给脚本进程 ——
  而 `modelClient.ts` 的模块头写着「**密钥永远不到前端来**……真正的请求由 Rust 侧代理发出」。
  C 走的就是那条路：`createModelPlanner` → 回环代理 → provider，**密钥不出凭据库**。
- **怎么落地的（全在既有缝上）**：
  1. **抽出** `runOneEvalAttempt` / `runEvalSweep`（`offlineAgentEval.ts`）：把"规划 → 编译 → 判题"
     这一段从"写死本地规划器"改成**接收一个规划器工厂**。离线与真实两侧因此**共用同一条扫描** ——
     抄一份就等于两套判题口径；
  2. **新增** `providerAgentEval.ts`：`runProviderAgentEval(trials, deps)`。**先解析 provider，再决定要不要跑** ——
     解析失败时连规划器都不造，于是"没配好"这件事**在类型上**不可能变成一次网络请求；
  3. **新增** 设置面板 `ProviderEval.tsx`：**两段式**（先解析「使用中」的配置并说清"将发出 24 次请求、
     发给谁"，**显式确认**才跑）。它**没有** `useEffect`、没有定时器 —— 不挂在任何自动路径上；
  4. **报告**补 `provider` 一行（`formatScorecard`）：同一个 `pass@1` 在不同模型上不是一个数，
     不写是谁就没法比对。
- **成本这一项：不许编**。这条通道里有 `usage`（`kind: "usage"` 带 inputTokens/outputTokens），
  但**仓里没有价目表** ⇒ `costUsd` 一律不填 ⇒ 报告如实写 `average cost      not measured`，
  与记分卡 `REAL_PROVIDER_GAPS` 里那条 "provider-billed cost" 一致。
- **定向变异三次（都验过判据不是空壳）**：① 取不到 provider 时**编一个空记分卡** ⇒ 1 条红；
  ② 给每次尝试**编一个成本 0** ⇒ 1 条红；③（更早一轮）`enabled` 写死 false ⇒ 约束拖动正例红。
- **还没做完的（不许含糊）**：**一次都还没跑过** —— 它花钱，得**你**在配好 provider 的机器上点那两下。
  所以发布门禁第 2 条**仍然没有数据**，仍然是"还没到放行条件"。
- **证据**：新增 8 条用例（harness 4 + 报告 1 + 面板 3）；全库单测 **3620 → 3628 通过 + 1 todo / 0 失败**；
  全量 e2e **191 通过**；`typecheck` / `lint` exit 0；`npm run eval:agent` exit 0（pass@1 仍 4/8，多打 `provider not measured`）。

## 2026-10-05 —— **第一次推送**：61 个提交上远端（推到 CI 还不知道结果）

- **用户授权后执行**：`git push origin main` → **`9a65e6d..6a5c2f0`**（快进，无强推）。推完本地与远端
  **已同步**（领先 0 / 落后 0）。这批提交从 N1 之后一直只在本地 —— **远端与 CI 到今天才第一次见到它们**。
- **推之前先把门禁跑齐**（不拿未验证的提交去推）：本会话此前只量过 `typecheck` / `lint` / 单测 / e2e，
  这一轮补上 Rust、许可、构建、perf、eval、bench、proof:smoke。**全部 exit 0**，且读数与记录一致或更好：
  - Rust **238 通过 / 0 失败 / 3 ignored（16 个二进制）**；
  - 许可 `LICENCES_SCANNED packages=550 distinctExpressions=33`；
  - 构建 **3.92 s**，入口 chunk **1,803.76 kB / gzip 527.62 kB**（比上轮 +2.6 kB —— 正是新增的设置组件与偏好模块）；
  - perf 9/9，`drag/300-frames` **488.7 ms（单次采样）**；
  - `eval:agent` pass@1 **4/8**、`bench:agent` 三行**逐字与之前一致**（说明这次改动没有碰到那些路径）。
- **一处"假脏"（值得记，因为它差点被当成真改动）**：推完 `git status` 报
  `scripts/dependency-licences/rust-licences.json` 被修改 —— 但 `git diff` **是空的**。
  真因是**行尾**：那份文件由扫描器写成 **LF**，而本仓 `core.autocrlf=true` 期望工作树 **CRLF**。
  两次跑扫描的 SHA256 **相同**（输出是可复现的），所以内容一个字节都没变。
  **危险在于**：这种"假脏"会让 `git status` 长期噪声化，也会掩盖真改动 —— 我这次就先按"可能是真改动"
  查了 diff 才敢下结论。**根因是仓库没有 `.gitattributes`**（已核实：没有）。
  建议的修法是一行针对该生成物的 `.gitattributes`（`eol=lf`），但**改的是全仓的行尾约定**，
  所以留给你点头，我没有自行加。
- **顺带修掉两处我自己编的轮号**：goal 对象早已不存在，"第 N 轮"是我编的 ——
  已换成 `2026-10-05 复核` 这样的日期标注。

## 2026-10-05 —— N5「勾股」按裁决落地：**判成 ⊥ + 勾股定理那一步**（而且**没做成别名**）

- **裁决（用户 2026-10-05）**：勾股走"**把目标判成 ⊥，再用勾股定理那一步把结论接回来**"这条路。
- **怎么落地的（关键在"不别名"）**：我给 `ProofGoalSupport` 加了一个 **`inference`** 字段，而不是往
  `constraintTypes` 里塞一个 `"perpendicular"`。区别是实质性的：
  - **别名**会让"从约束层问 ⊥"顺带返回勾股 —— 一条**推断**就这样藏进分类函数里；
  - **`inference`** 把那条推断变成**有名字的一步**（`{ from: "perpendicular", theorem: "勾股定理及其逆定理" }`），
    并要求它出现在**证明**里。这正是第 50 轮我在代码注释里写下的那条约束。
  另外新增 `proofGoalDischargeRoute(kind)`（`direct` / `via-inference` / **`none`**）——
  `none` 那一档不是装饰，它是 fail-closed 的默认值：将来加一个既没载体、也没推断路线的目标时，
  它会**如实返回 none**，而不是被当成"直接能判"。
- **读数里的变化**：`proof:smoke` 现在报 `goalsWithoutAnyRoute: []`（"一处路线都没有的首批目标"**空了**）
  与 `pythagoreanRoute: {"kind":"via-inference","from":"perpendicular"}`。**裁决在读数里看得见。**
- **定向变异两次（都验过判据不是空壳）**：
  ① 把 `"perpendicular"` 塞进勾股的**载体**（也就是我禁止的那个别名）⇒ **4 条红**，
  含专门那条"勾股仍然没有直接载体 —— 裁决不是把它别名成 ⊥"；
  ② 让 `proofGoalDischargeRoute` **恒返回 `direct`** ⇒ 1 条红（"勾股有一条显式推断路线"）。
- **一处操作失误（如实记档）**：更新读数表时我用了一个只按内容匹配的替换，结果**改错了行** ——
  它命中的是**反证台账**里那条 `proof:smoke --mode=lean`（"没有后端模式，假装有比失败更糟"）的记录，
  把它覆盖成了读数行。**台账不是读数**，已按行还原。这是本会话**第二次**同型失误（上一次是 e2e 的
  186→189 改到历史记录上）。两次的处方一样：**改读数要按行号定位，不要按内容全局替换。**
  顺带把之前几处我自己编的"第 N 轮"换成**日期**（goal 对象早已不存在，轮号是我编的）。
- **证据**：proof 目录 36 → **41 条**；`proof:smoke` 7 条全绿；全库单测 **3620 通过 + 1 todo / 0 失败**；
  `typecheck` exit 0；`lint` **0 error / 13 warning**（实测）。
## 2026-10-05 —— **N3 计划 RED 的后半段补完**：约束拖动的浏览器正/反例

- **补上了什么**：`e2e/agent-constrained-drag.spec.ts`（2 条，一正一反）。
  夹具 `tetrahedron.mgeo` → 只留四个点（这样拖的是**独立点**、不是多面体顶点）→ 加一条 `|AB| = 1`
  的 `fixedDistance` → 用「自由拖动」按住 A 拖 90/60 像素：
  - **关着开关（默认）**：`|AB|` **变了** —— 这是原来那条路径；
  - **打开开关**：`|AB|` **仍然是 1**（沿约束走），而且**先断言 A 真的动过**。
- **为什么"反例"必须存在**：少了它，"开着时 |AB| 不变"完全可能只是**拖根本没生效**。
  本仓的老教训在这里又是同一条：**要证明的不是"没变"，而是"本该变的时候变了、该被约束住的时候被约束住了"。**
- **判据用的是应用自己的产物**：读的是 `mathcanvas:draft:geometry3d`（`saveDraft` 写进去的 `.mgeo` 文本），
  不是我注入的测试数据。
- **定向变异（关键证据）**：把 `App.tsx` 里的 `enabled: agentNextPhaseFlags().constrainedDrag` 写死成
  `enabled: false` ⇒ **正例红**：`Expected 1, Received 1.539321393834598`（拖发生了、距离没被约束住），
  而反例照旧绿。恢复后 2 条全绿 —— **这条用例确实在验约束路径，不是空壳**。
- **于是**：N3 计划 RED 里"浏览器正/反例"这一半**算完成**（计划里那条 `- [ ]` 已勾），
  发布门禁 N3 那一节的"仍然不能算完成"也改掉了。**§一.2 第 1 条整条关闭。**
- **证据**：全量 e2e **189 → 191 通过 / 0 失败**；全库单测 313 文件 / 3615 通过 + 1 todo / 0 失败；
  `typecheck` / `lint` exit 0。
## 2026-10-05 —— N3 入口的**浏览器验收**（外加：这条 e2e 抓到的是我自己测试脚本的毛病）

- **补上了什么**：`e2e/next-phase-flag-entry.spec.ts`（3 条）。它走的是**用户会走的那条路**：
  顶栏「设置」→ 设置模块 → 「实验性功能 → 约束拖动」→ 打开 → **刷新后仍然是开**，
  并且断言偏好里**只有这一个键**。全量 e2e **186 → 189 通过 / 0 失败**。
- **一次有价值的假红（记下来，因为它差点被当成产品缺陷）**：我第一版用
  `page.addInitScript(() => localStorage.clear())` 做隔离，结果"刷新后偏好还在吗"那条**红了** ——
  而 `addInitScript` 会在**每一次**页面加载时重跑，包括用例里那个 `page.reload()`。
  也就是说：**它被自己的隔离脚本清掉了**，报出来的却像产品缺陷。
  改成"载入一次 → 清一次 → 再载入"之后 3 条全绿 —— **偏好确实跨刷新保留**。
  这与第 55 轮那条教训同源：**先看"这个数是/这句话是怎么产生的"，再对它下结论。**
- **一次我自己的越界（也记下来）**：更新 §一.1 的 e2e 读数时，我用了一个会命中多处的替换 ——
  它把**两处历史记录**（"全量 e2e 跑了两次：一次 186 / 一次 185"那份定位记录，
  以及更早一行人工跑过的 186）也改成了 189。**历史记录不许改写**，已按行号逐条还原成 186，
  只留当前读数那一行是 189。**读数表与台账的区别是：前者是现在时，后者是发生过的事。**
- **还没做完的**：**拖动行为**那一半（计划点名的 `e2e/agent-constrained-drag.spec.ts`）**仍然不存在** ——
  要先把 3D 里"拖动单个 `point3`"的指针交互钉住。所以 N3 的 RED 后半段仍未完成，发布门禁那一条**仍不能算完成**。
- **证据**：全量 e2e **189 通过 / 0 失败**；全库单测 313 文件 / 3615 通过 + 1 todo / 0 失败；`typecheck` / `lint` exit 0。
## 2026-10-05 —— **N3 的第一个产品入口**：开关从哪来这件事定了（用户批准，方案 B）

- **背景**：`constrainedDrag` 的代码从 N3 起就在，但 `agentNextPhaseFlags()` 一直返回全关的一份，
  于是**没有产品入口能打开它** —— 浏览器验收写不出来，`current-status.md` §一.2 第 1 条挂了很久。
  这一轮把这个入口补上了（用户在两轮里分别选了「用户偏好」与「把死按钮接上」）。
- **做了什么**：
  1. `apps/web/src/persistence/nextPhasePreferences.ts`（新）：一个独立的 localStorage 键
     `mathcanvas:next-phase-preferences` + 一对 load/save。**降级口径与 `loadViewPreference3d` 一致**：
     没存过 / 坏数据 / 存不下**一律当作关**（判定用 `=== true`，所以 `{"constrainedDrag":"yes"}` 读成关）；
     写的时候**只改这一个键、其它键原样保留**（将来会有第二个实验性开关）。
  2. `agentNextPhaseFlags()` **只从偏好里取 `constrainedDrag` 这一个**。另外四个**故意不读偏好**：
     `witnessSearch` 打开会替换被物化的坐标与点名（有自己的接线前提），`openProblemCompiler` /
     `proofExport` 还没交付，`obligationIR` 同理。**一个"存了就能全开"的偏好等于把四个未完成阶段的路一起打开。**
  3. `apps/web/src/components/settings/ExperimentalFeatures.tsx`（新）：「设置 → 实验性功能 → 约束拖动」。
     **文案里两边行为都写清楚**（关着=原来的自由拖动；打开=受约束的点沿约束走并占一步撤销）——
     这个开关会**换掉拖动路径**，用户得知道自己在开什么。
  4. **顺带修掉一个死按钮**：`WorkspaceTabs` 顶栏那个「设置」此前**没有 `onClick`**、props 里也没有
     `onSettings`（它是个装饰）。现在它接到设置模块（`App` 切 `activeModule`），`AppChrome` 透传。
- **一条被改动的既有判据（如实记档）**：`featureFlags.test.ts` 的
  "keeps the application-owned flags fully off" 说的原本是"**恒为全关**"。
  偏好进来之后这句话要说得更准：**没有存过偏好时全关**。**它盯的东西没变**
（生产缺省不许自己变成开 —— 由 `createAgentNextPhaseFlags()` 那条继续把着），
  同时新增一条"**恶意存储**"用例把"只有 `constrainedDrag` 能被偏好打开"钉住。
- **证据（都看过红绿）**：
  - 新增 13 条用例（偏好 4 条、组件 4 条、端到端入口 3 条、顶栏按钮 1 条、既有判据拆成 2 条）；
  - **定向变异两次都对**：① 把偏好读取的默认改成"开" ⇒ **3 条红**；
    ② 顺手让 `witnessSearch` 也读偏好 ⇒ **正好那条"恶意存储"红**；
  - 全库单测 **310 文件 / 3602 通过** → **313 文件 / 3615 通过 + 1 todo / 0 失败**；
  - `typecheck` exit 0；`lint` exit 0。
- **还没做完的（不许含糊）**：`e2e/agent-constrained-drag.spec.ts` **仍然不存在** ——
  **入口有了，浏览器正/反例可以写了、但还没写**。所以 N3 的 RED 后半段与发布门禁那两条**仍然不能算完成**。
## 2026-10-05 —— N4 第十五步：提交被拒时，用户看到的是**引擎的英文原话**（已修，而且是修在"设计指定该修的那一层"）

- **怎么查到的**：接着第 54 轮那条线（去读"用户可见的字符串是怎么生成的"），这一轮沿着
  `App.tsx` → `agentRunner` → `RunStatus` 走了一遍提交被拒的路径。
- **事实**：`RunStatus.tsx` 把被拒的提交渲染成「**提交失败：{commit.detail}**」——
  **前缀是中文，内容却一直是英文**：引擎给的是**诊断用的原话**
（`draftStore.ts` 的 `"the document changed since the draft was compiled"`、
  `agentRuntime.ts` 的 `` `${reason}: …` ``，`reason` 还是 `stale_source` 这种英文码）。
- **为什么测试看不出来（两处都遮住了）**：① 原用例只断言**结构化返回值** `second.detail`，
  没断言用户看到的那句话；② `RunStatus.test.tsx` 的**夹具**用的是**中文** detail（`"文档已经被改过"`）——
  于是"真运行时给英文"这件事，**引擎侧与界面侧各自都看不见**。
- **修在哪（关键：不是新决定，是照本仓已声明的口径补一处的漏）**：本文件 `phase === "failed"` 那一支的
  注释早就写着 —— "**引擎的话是给诊断与修复通道用的，中文的用户话在这一层**"。提交被拒这一支
  **漏了这一步**，所以按同一条口径在 `agentRunner.ts` 里补上 `commitFailureText(outcome)`。
- **两条纪律**：① **不认识的码也要说人话**（兜底「提交被拒（原因码：X）」），不是把英文端出去；
  ② **原因码保留**（中文解释 + 括号里可搜索的码），诊断与用户话不互相顶替。
- **证据**：`agentRunner.test.ts` 的用例补上了**用户可见那半句**的断言；**定向变异**
（把 `commitFailureText(outcome)` 换回 `outcome.detail ?? outcome.status`）⇒ **正好那一条红**；
  恢复后 47/47 通过。全库单测与 `typecheck` / `lint` 见下方读数。
- **这一条线索至今查出三处用户可见的文案问题，共同的形状是同一个**（值得留档）：
  1. 第 54 轮：residue 的 `sourceText` 只取到第一个空白 ⇒ `∠PAB = 60°` 显示成 `∠PAB`（已修）；
  2. **第 55 轮**：关系型条件的失败原因说"题设要求 0"（**改它会动被钉住的契约，已退回**）；
  3. 第 56 轮（本轮）：提交被拒时把引擎的英文原话端给用户（已修）。
  **共同形状 = "用户看到的那句话，是在别处生成的"**；而**每一处的用例夹具都恰好覆盖了"好的那一侧"**
（无空格的写法 / 中文的 detail / 只断言结构化返回值），所以**测试一直是绿的**。
  这与第 40 轮那条方法教训是同一族：**先去看"这句话是怎么被生成的"，而不要只看它是否出现**。
- **与第 55 轮的区别（这一条值得分清）**：第 55 轮我改的是**编译器输出里的诊断文案**，它被
  "关闭 flag 时逐字节相同"的黄金样本钉着 ⇒ **那是改契约，我退回了**；这一轮改的是**应用层拼给用户的话**，
  与黄金样本无关 ⇒ **是补本仓自己声明过的口径**。**同样是"改文案"，一个动契约、一个不动。**
## 2026-10-05 —— N4 第十四步：**我自己踩了一次黄金样本**（它挡住了一个"改文案"的改动，而且挡得对）

- **我做了什么**：接着第 54 轮那条线（"去读用户可见的字符串是怎么生成的"），我在
  `diagramVerification.ts` 里发现**关系型条件的失败文案读不通** —— 垂直 / 平行 / 共线 / 共面 / 中点 /
  面⊥面这些条件的 `expected` 是**"残差要归零的那个 0"**，于是面板上会显示
  "**PA ⊥ 平面 ABCD：不满足。实测 0.24254，题设要求 0。**"
  （`ConfirmationPanel.tsx` 的 `{item.reason}` 会原样渲染）—— 题面要求的是"垂直"，**不是"等于 0"**，
  而且那个数**没有单位**。我改了文案，并加了两条一正一反的用例。
- **然后 `npm test` 报 2 条红**：`planCompiler.offPath.golden.test.ts`（**见证搜索关闭路径与基线
  `4707b64` 逐字节相同**那份黄金样本）。差异就在 `diagram_condition_failed` 的 `detail` 上：
  `"…实测 0.24254，题设要求 0。"` → `"…实测偏差 0.24254（这一类条件要求偏差归零）。"`
- **为什么它是对的、而我要退回去**：那条黄金样本钉的是一句**明确的承诺** ——
  "**关闭 flag 时旧路径行为逐字不变**"，而且它是发布门禁第 1 条与"N2 已交付"结论的证据之一。
  诊断文案**也是编译器输出的一部分**，所以改它**就是**一次 off-path 行为改变。
  **我不该在不声不响的情况下动它** —— 那不是"顺手改文案"，那是**改一个被钉住的契约**。
- **所以我把改动整个退回了**（源码 + 那两条用例），并确认黄金样本 13/13 通过、工作树干净。
  **用户可见的那句读不通的文案仍然存在** —— 它现在是一条**待裁决**：
  要不要为了这句文案去**重新基线化**黄金样本（那意味着"与 `4707b64` 逐字节相同"这句话要改成
  "除这一处诊断文案外逐字节相同"，发布门禁那一行也得跟着改）？
- **顺带一条正面结论**：**这条黄金样本抓到了一个真实的契约违反** —— 我此前在文档里把它列为
  "测出来的、最硬的一种离路径保证"（第 32 轮的台账），这一轮它当场证明了那个评价是对的。
- **证据**：`typecheck` exit 0；`lint` exit 0；`planCompiler.offPath.golden.test.ts` 13/13 通过。
## 2026-10-05 —— N4 第十三步：读那 9 条 residue，查出一个**用户可见**的真缺陷并修掉

- **按上一轮的方法**（"对读数下结论之前，先去看决定这个读数的那处代码怎么说"）去读 `BENCHMARK_PREMISE`
  那 9 条 residue。**九条全是"原话里出现了解析层认不了的写法"**（`sin∠PAB = 0.5`、`∠PAB = 60°`、
  `AB:AD = 1:2`、`BM:MC`、`二面角…为 45°`、`保持六条棱长始终相等`、`让 M 始终是 AB 的中点`、
  `让 PA 始终垂直于平面 ABCD`）—— **它们显形为 residue 正是那套机制的设计目的。**
- **但读的时候查出一个真缺陷**：其中 **5 条的文案是「碎片」而不是「条件」** ——
  `∠PAB = 60°` 显示成 `∠PAB`、`sin∠PAB = 0.5` 显示成 `AB`、`AB:AD = 1:2` 显示成 `AB:AD`。
- **为什么这是用户可见的（这是关键）**：`diagramVerification.ts` 把 residue 的 `sourceText`
  **原样**变成核验 check 的文案，而那条 check 会出现在用户的**"题设尚未核验"列表**里。
  所以用户看到的是"**∠PAB 没核验**" —— **条件本身没显示出来**。
- **根因（很窄）**：取文案用的是 `/^[^，,。；;\s]+/` —— **到第一个空白为止**。于是**带空格**的写法
（`∠PAB = 60°`）被截断，而**不带空格**的 `∠ABC=60°` 一直是对的。**既有用例恰好只覆盖了后者**，
  所以这个缺陷**在测试里看不见**；而"随手带个空格"正是用户最自然的写法。
- **改法**：引用**包含该条件的整句**（与另一条 residue 路径同一口径 —— 那条本来引的就是整句）。
  探针实测：`∠PAB = 60°` / `sin∠PAB = 0.5` / `AB:AD = 1:2` 现在都拿到整条，`∠ABC=60°` 不变。
- **回归用例 12 → 14 条**，两条都专门钉"**带空格**"那一侧（既有用例只覆盖不带空格的那一侧）。
- **读数没有因此变动**（`obligations=24 residue=9 rate=0.727`、`covered=14/21` 全部不变）——
  这一点本身是佐证：**改的是文案，不是分类**。
- **证据**：全库单测与 `typecheck` / `lint` 见下（本轮改了 `agent-core` 的源码，所以三项都要跑）。
## 2026-10-05 —— N4 第十二步：把码表**读完** —— 四类原因全是设计，一类不是原因

- **接着上一轮的方法**（"对读数下结论之前，先去看决定这个读数的那处代码怎么说"），把剩下两类也读掉：
  - **`requires-candidates`（7 条）**：`solverContracts.ts` 里这句就是它的定义 ——
    "**任意多面体的坐标必须由调用方给出，搜索器不凭空造。**" 所以那是**设计**（搜索器不去凭空编一个多面体）。
  - **`no-candidate-constructed`（4 条）**："所有候选都在构造期被拒，没有得到任何可核验的坐标。"
    —— 而"构造期为什么拒"上一轮已经查到：**明确拒绝好过悄悄换一个题面没说的形状**。
- **顺带一条读法纠正**：`witness-search` 那 20 条是**每条 `unverified_instance` 都带的汇总条目**，
  **不是一种原因**。第一版码表把它和真正的原因并列，读的时候会把它误当成主因。
- **读完之后的结论（这正是"把读数读完"的意义）**：`BENCHMARK_WITNESS_CODES` 上那四类，
  **没有一类是缺陷** —— 它们分别是"搜索器不凭空造多面体""题设推不出这一族要的结构""构造期明确拒绝"
  "底面形状超出首批"。**离线求解率 4.8% 是首批设计覆盖面决定的。**
- **于是那句待裁决也写准了**：不是"扩构造器认得的题面写法"（听着像补覆盖），而是
  "**要不要扩覆盖面、以及怎么扩才不违反'明确拒绝好过悄悄换形状'那条纪律**"。完整表已进发布门禁的 N4 一节。
- **只改文档**，没有可执行产物。
## 2026-10-05 —— N4 第十一步：去核"能不能扩构造器覆盖面"，结论是**它不该被当成缺陷**（一个否定性结果）

- **上一轮我留下的悬念**：码表显示卡点在**构造阶段**（`unsupported-shape` 9 + `unsupported-base-shape` 4），
  于是我写了"下一步可能是**扩构造器认得的题面写法**"。这一轮去核它到底能扩什么。
- **核出来的事实（读的是构造器自己的文件头，1056 行那份）**：`packages/geometry-kernel/src/witness/constructors.ts`
  首批覆盖写得很清楚 —— "棱锥 / 棱柱，底面 n = 3 或 4"；底面靠**点名的直角**（`AB ⊥ AD`）钉成矩形或直角三角形；
  顶点在**点名的垂足**正上方。**而最关键的一句是它自己写的**：
  > "覆盖不到的形状（斜平行四边形底面、直角不在环首的四边形…）**明确拒绝**并给出 `reason.code`，
  > 而不是悄悄换一个题目没说的形状 —— **那正是"特值化悄悄改题"的老毛病**。"
- **所以结论是否定的（而否定结果同样要写下）**：那 13 条失败**不是构造器写坏了**，是**题面落在首批
  覆盖面之外**；而**"明确拒绝"本身是设计选择**，理由写在代码里。**离线求解率 4.8% 是覆盖面决定的，
  不是缺陷。** 这也意味着：**"扩构造器"是一个设计决定**，且设计本身已经警告过硬扩的风险
（把题悄悄改成构造器认得的形状）。
- **我上一轮那句"下一步可能是扩构造器"因此需要限定**：它不是"顺手能做的覆盖改进"，
  而是"要不要扩、以及怎么扩才不违反那条纪律"的决定。发布门禁那一节与 `current-status.md` §四 F
  都按这个结论改准了。
- **这一轮也顺带暴露了我一个习惯**：我容易把"低读数"直接读成"这里有活干"。
  这一次的收获恰恰是**读出了"低是设计要的"** —— 与第 46–50 轮那五次"我低估了已有部分"是**同一枚硬币的另一面**：
  **对读数下结论之前，先去看那个决定读数的地方是怎么说的。**
- **只改文档**，没有可执行产物。
## 2026-10-05 —— N4 第十步：把「求解率 4.8%」**解释开**（判据不是瓶颈，构造才是）

- **为什么做这个**：第 48 轮我拿到了 `solveRate=0.048`，但一个**孤零零的 4.8%** 看不出该往哪儿使劲
  —— 是判据覆盖不够？是搜索预算太小？还是别的？所以这一轮把两个**内核已经算好、只是没人读**的字段读出来。
- **① 判定力（plan N4 第 4 条点名的 `judgeability`）**：
  `BENCHMARK_JUDGEABILITY supported=21 unsupported=3 ambiguous=0 totalObligations=24`
  —— **24 条题设里 21 条本来就判得了**。所以 **4.8% 不是判据问题**，这一条假设被排除掉了。
- **② 失败原因码的分布**（新增读数，第 51 轮）：
  `BENCHMARK_WITNESS_CODES {"requires-candidates":7,"unsupported-shape":9,"no-candidate-constructed":4,"unsupported-base-shape":4,"witness-search":20}`
  —— 其中 **`witness-search` 那 20 条是"汇总"条目**（每条 `unverified_instance` 都带一条），
  **不是一种独立原因**，读的时候要扣掉。真正的三种是：
  - `requires-candidates`（7）：题面没点名一个**构造器认得的立体**（"任意多面体的候选坐标必须由调用方给出"）；
  - `unsupported-shape`（9）：缺"**某条线段 ⊥ 某个点名平面**"这种写法 —— 构造器靠它定底面环与垂足；
  - `no-candidate-constructed`（4）：构造出了候选（13 个），**全在构造期被拒**。
- **结论（这才是读数的作用）**：卡住的是**构造阶段**，而这三种原因的**下一步完全不同**
  —— 扩构造器认得的题面写法 / 扩解析（带撇点名）/ 修构造期的约束。
  **"低"本身不是结论，这张码表才是。**
- **两处文档同步**：`current-status.md` §一.1 的 benchmark 行、发布门禁的 N4 一节（给 4.8% 一个解释）。
- **证据**：benchmark 套件 12 → **13 条**；`typecheck` exit 0；`lint` exit 0。
## 2026-10-05 —— N5 第六步：最后一个"缺能力"的结论也**缩水**了 —— 勾股有一个**等价近邻**

- **接着上一轮的问法**（"这件事在这个仓库里是不是已经有别的机制在做"），这一轮查最后一条：
  计划的「勾股」。先搜全仓：**`勾股` / `pythagorean` 只出现在我自己写的文件里** —— 所以确实没有现成载体。
- **但"没有直接载体"不等于"表达不出来"**：对三个点 X / Y / Z，
  **`XY ⊥ YZ` 与 `|XY|² + |YZ|² = |XZ|²` 是等价的**（勾股定理及其逆定理）。而
  `perpendicular` **是** `ConstraintType` 的一员、内核既判又投影；角度本身也有测量载体
（`derivedNodes.ts` 的 `MeasurementMetric` 含 `angle`，`dsl/types.ts` 的 `MEASUREMENT_METRICS` 含 `angle` / `dihedral`）。
- **所以这一条不是"缺能力"，而是一个取舍**：要不要让证明出口走
  "**把勾股目标判成 ⊥ 目标、再用勾股定理那一步把结论接回来**"。
  **关键区别写进代码注释了**：那是"**证明里的一步**"，不是"同一个目标" ——
  把两者**别名**就等于把一条**推断**藏进分类函数里，而推断应该出现在证明里、**看得见**。
- **顺带把"识别"与"表达"彻底分开**（这是我这几轮反复混起来的地方）：解析层的
  `DiagramObligationKind` 里没有共线 / 共面 / 勾股，那是**识别**的问题（原话读不出来）；
  而**表达**（文档能持久化、内核能判能投影）在约束层已经有了。**两件事不能互相冒充。**
- **三处文档改准**（`current-status.md` §一.2 的裁决表与 §四 F、计划文件），并把
  `proofGoals.ts` 的说明段落改写成上面那套区分。发布门禁那一处**不用改** —— 它写的是
  "在**解析层**表达不出来"，本来就准确。
- **证据**：`typecheck` exit 0（只改了注释与文档，没有改行为）。
## 2026-10-05 —— N4 第九步：**第四次同一个误判** —— "real_provider 适配器没写"是错的，它早就有了

- **我一直在说的一句话**："`real_provider` 整批 `not_measured`（**适配器没写**，需要先定用哪个 provider、
  凭据放哪）"。这句话在四份文档里出现过（发布门禁、记分卡、计划、能力目录）。**它是错的。**
- **事实（都指得到文件与行）**：`apps/desktop/src-tauri/src/providers/adapter.rs` —— **621 行**，
  开篇自述就是"**把协议、凭据、传输、取消、解码缝在一起**"，接口是
  `ProviderAdapter::send(request, secret, cancel) -> Stream<ModelEvent>`；拼请求 / 解响应 / 借凭据 /
  搬字节四件事各有归属，还有 `security::allow_upstream` 的 SSRF 守卫。而且**有一次真实往返记录**
  （记分卡：2026-09-29，DeepSeek `deepseek-chat`，`tools` 通道**验过 5 个模型可见工具**）。
- **真正缺的是什么**：缺的是 **benchmark 那一侧的 `real_provider` 模式** —— `scripts/agent-benchmark/`
  今天只发 `not_measured`。而"怎么跑它"本身要先定一件事：**走应用的`proxy/server.rs` 回环代理
  （同一份通道，不会造出第二条调用路径）还是自己发请求**；再加上凭据放在哪。
- **为什么这个更正重要**：原话把待裁决项说成"**写一个适配器**"（听着像一大块新工作），
  而实际是"**让 benchmark 接上已经存在的通道 + 决定凭据放哪**"（小得多，也完全不同的一件事）。
  **低估与夸大一样是错**，而这一条我低估的是"已有的部分"。
- **这是连续第四轮同一类错**（第 46 轮"中点"、47 轮"共线/共面"、48 轮"求解率"、这一轮"真实 provider"）。
  共同根因始终是：**只在最近的那一层里找，没去问"这个仓库里还有谁在做这件事"**。
- **四处文档同步改准**，并把新措辞写成"不是'适配器没写'"（保留旧说法，免得读者以为从来没人说过）。
- **只改文档**，没有可执行产物。
## 2026-10-05 —— N4 第八步：**离线求解率能跑了** —— 我第 36 轮把它记成"缺一个定义"，那个理由错了

- **同一个错法，第三次**（第 46 轮"中点"、第 47 轮"共线/共面"、这一轮"求解率"）。我第 36 轮的理由是：
  "见证搜索**只在救援路径里触发**（`planCompiler.ts:235`），要先有一份**模型给的计划**失败才有东西可救，
  所以离线那一侧**没有这个输入**"。**这个理由错了。**
- **真相**：救援路径传给 `searchWitness` 的只有两样东西 ——
  `first.obligations.ir`（**解析结果**）与 `witnessShapeFor(context.prompt)`（**从题面推出来的图形族**）。
  **两样都不来自模型。** 所以离线跑见证搜索**从来就不缺输入**，缺的只是"有没有人把它包成一个入口"。
- **做了什么**：
  1. `agent-core` 新增导出 `searchWitnessForPrompt(prompt)` —— 题面 → IR → 图形族 → 有界搜索；
     并把"入参怎么组成"（seed / 候选上限 / 超时 / 题面→图形族）收进**一个**私有 `witnessSearchInput`，
     **救援路径与离线入口共用同一份**（原先那三样在救援路径里各自写了一遍）。
  2. `bench:agent` 新增**见证层**：`deterministic_local` 现在每题跑**两层各一轮**（抽取 + 见证），
     `status` 用 `BENCHMARK_STATUSES_BY_LAYER.witness` 的现成词表 —— `WitnessSearchResult.status`
     与它**逐字对应**，所以这一层**没有引入任何新判断**。
  3. 新增读数与用例：`BENCHMARK_WITNESS verified=… unverified=… no_witness=… solveRate=…`，
     并断言四种结局**不重不漏**（否则"求解率"的分母是编出来的）。
- **第一个真实读数**：`BENCHMARK_WITNESS verified=1 unverified=20 no_witness=0 error=0 solveRate=0.048`
  —— **离线求解率 4.8%**（21 题里 1 题拿到通过核验的候选）。**这个数很低，而"低"本身就是有用的信息**：
  离线解析构造只覆盖得了"点名够、形状是棱锥"的那一小撮，其余 20 题如实回到 `unverified_instance`。
- **四处文档同步改准**：`current-status.md` §四 F（原文划掉并写明理由错在哪）、发布门禁的 N4 一节
（"求解率"从"没有"移出）、记分卡（`solve rate` 从 Missing 移出）、计划的 N4 记录。
- **证据**：benchmark 套件 11 → **12 条**；全库单测 **310 文件 / 3599 通过 + 1 todo / 0 失败**；
  `typecheck` exit 0；`lint` exit 0（0 error / 13 warning，与基线逐条相同）。
## 2026-10-05 —— N5 第五步：又一处**同源误判** —— 「共线 / 共面」不是没有载体，是我只找了一层

- **同一个错法，第二次**：第 46 轮我把计划的"中点"误判成需要扩约束词表（其实**派生点**早就在做）。
  这一轮我按同一个问法（"**这件事在这个仓库里是不是已经有别的机制在做**"）去查 N5 那三个
  "表达不出来"的首批目标 —— 果然：
  **「共线 / 共面」有载体，只是不在解析层，在约束层。**
- **证据（都要能指到行）**：`ConstraintType`（`packages/dsl/src/types.ts:876`）**本来就有**
  `collinear` / `coplanar`；内核**既判**（`constraints3d.ts` 的 `collinearResidual` / `coplanarResidual`）
  **又投影**（`constraints3dProjection.ts` 的 `PROJECTABLE` 与 L246/L267 两条分支）。
  我第一版只按 `DiagramObligationKind`（解析层）映射，于是把这两个也算成了"一处载体都没有"。
- **更正后的事实**：**真正一处载体都没有的，今天只有「勾股」一个** —— 它是三条边的代数关系，
  `fixedDistance` 固定的是**单条边长**，不是 a²+b²=c²。
- **代码侧改法（不只是改文档）**：
  1. `ProofGoalSupport` 增加 `constraintTypes` 字段 —— **两种载体都写出来**，而不是只写一层；
  2. 新增 `declaredProofGoalForConstraint(constraintType)`：同一条门，从**约束层**再问一遍；
  3. 把原来那个含混的 `unexpressibleFirstBatchGoals()` **拆成两个**：
     `firstBatchGoalsWithoutObligationCarrier()`（解析层读不出：共线/共面/勾股）与
     `firstBatchGoalsWithoutAnyCarrier()`（**一处都没有：只有勾股**）。
     原来混成一个，正是这次误判藏身的地方。
- **读数里的变化**：`npm run proof:smoke` 现在**分开报两个清单** ——
  `goalsWithoutObligationCarrier: ["collinear","coplanar","pythagorean"]`、
  `goalsWithoutAnyCarrier: ["pythagorean"]`。**这把待裁决的范围从"三个目标"缩到了"一个目标"。**
- **三处文档同步改准**（`current-status.md` §一.2 的裁决表、§四 F、计划文件各一处），
  都写清"第一版只在解析层找"这个错在哪。
- **证据**：proof 目录 35 → **36 条**；`proof:smoke` 7 条全绿；全库单测
  **310 文件 / 3598 通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` exit 0（0 error / 13 warning）。
## 2026-10-05 —— N3 第七步：改正我自己的一条结论 —— 计划的「中点」**不需要**扩约束词表

- **我怎么错的**：第 28 轮我把计划 N3 的 RED（"拖动保持中点/垂直/固定距离"）逐词对过
  `ConstraintType` 的 8 个成员，发现**没有 `midpoint`**，于是写下结论："要让'拖动保持中点'落到约束层，
  得先扩约束词表，那和角度 / 线⊥面一样属于**扩范围**"。**这个结论是错的。**
- **正确的事实**：计划的"中点"**早就有载体** —— 不是**约束**，是**派生点**（derived binding）。
  证据就在**计划 N3 RED 命令点名的那七件测试之一**里：
  `packages/scene-graph/src/operations.test.ts` 有一条用例 —— 派生中点 `p-mid = midpoint(p-a, p-b)`：
  **拖它自己被拒**（`not draggable`，派生点不该被直接拖），而**拖它挂靠的那条线会带着它走**
 （`line-ab` 平移 (3,0,0) 之后断言 `p-mid = (4,0,0)`）。3D 那一侧在 `resolve3d.ts:138`。
- **为什么这个更正值得写下来**：它把 N3 的 RED **从"还差一个词表"变成了"这一半本来就成立"** ——
  我此前把它算进"需要裁决的扩范围"，于是**低估了已完成的部分**（而低估和夸大一样是错）。
  根因是我**只在"约束"这一层里找**，没有去问"这件事在这个仓库里是不是已经有别的机制在做"
  —— 这与第 31 轮那次（把 `planar-constraints` 误当成可能重复的求解器）是**同一类错**。
- **改法**：在第 28 轮那段结论后面**保留原文并标注更正**（`CHANGELOG.md` 与计划文件的 N3 记录各一处），
  写上证据与位置 —— 不留一个"看起来权威但已经错了"的结论在文档里。
- **顺带把 N3 的状态说准**：RED 里除浏览器出口外**全部成立** —— 中点（派生点，已有）✓、垂直 ✓、
  固定距离 ✓、过约束拒绝 ✓、欠约束自由度 ✓、**一步撤销 ✓（第 45 轮补的用例）**。
- **只改文档**，没有可执行产物。
## 2026-10-05 —— N3 第六步：补上计划 RED 的最后一条「拖动一步撤销」（**用真的 store**，不是替身）

- **它是计划里剩下的、唯一既被点名、又不需要裁决的代码项**：N3 的 RED 写着"拖动保持中点/垂直/固定距离；
  过约束拒绝；欠约束显示自由度；**拖动一步撤销**"，而发布门禁与记分卡都明写
  "**没有任何用例验过『约束拖动后一次撤销回到原状』**"。两者指的正是同一条。
- **为什么它能在单元层验、不必等浏览器**：一步撤销**不是界面行为，是事务边界的行为** —— 拖动的提交走
  **一次** `applyBatch`（→ `commitTransaction`），所以它本来就该正好占**一步**历史。用**真的**
  `useSceneStore`（不是替身）就能钉死，与 `agentRunner.test.ts` 那条"确认提交一步撤销"同一口径。
- **两条判据一正一反**（`apps/web/src/constrainedDragUndo.test.ts`，2 条）：
  1. **拖动真的改了坐标 → 整批只占一步历史 → 撤销一次回到原状**。前半句是必要的：
     **要证明的不是"撤销之后没变"，而是"变过、然后被撤销回去了"** —— 少了它，这条用例可以空转
     （第 40 轮那条 `.each` 教训的另一面）；
  2. **被约束完全抵消的拖动（`noop`）一步历史都不占** —— 否则用户按 Ctrl+Z 会撤掉一个
     看不出任何变化的"幽灵步骤"。
- **如实写清范围**（这一步没有把 N3 的浏览器缺口解决）：用例钉的是**规划器给出的那一批** +
  store 的批/撤销语义；**`App.tsx` 那个调用点仍然没有被测**（要渲染 App 才碰得到，属浏览器那一档）。
  发布门禁那一节已按这个范围改写，没有把"一步撤销"整条划成绿。
- **顺带更新记分卡**：把"any test of single-step undo after a constrained drag"从 **Missing** 里移出
  （这是发布门禁/记分卡/计划三处第一次同时对齐）。
- **证据**：全库单测 **310 文件 / 3597 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）。
## 2026-10-05 —— N6 第二十三步：给"三张能力表会自己漂"这件事装上**机器判据**（而不是写第四句"记得改"）

- **为什么不再写一句约定**：第 25 / 33 / 43 轮我**三次**修同一个毛病，而且每次都是**撞见**的 ——
  `feature-catalog.md` 的"N3–N5 仍为设计阶段"、发布门禁里缺 N5 那一节、记分卡的
  "Formal proof | design only"。共同根因：**新写的进度会回流到 `current-status.md`（我会一直更新它），
  但不会自动回流到这些"按能力 / 按门槛列"的表里。** 前三句"注意同步"都没拦住，第四句也不会。
- **只钉一件结构性的事**：**每张能力表都必须链到 `current-status.md`**，而且链接**要真的指得到**
  （在 `docs/acceptance/` 下得写 `../current-status.md`）；反过来 `current-status.md` 也要链回这三张表。
  判据在 `scripts/docs-consistency/capability-tables.test.ts`。
- **这条判据第一次跑就抓到了结构性原因**：三张表里**唯一没有指向"现在时"的那一张，正是
  `agent-tool-loop-scorecard.md`** —— 也就是第 12–41 轮被反复引用、而它自己的四行漂了 25 轮的那一张。
  补上指针后 5 条全绿。
- **为什么不比对三张表的文字**：它们**故意用不同的切面**（能力 / 门槛 / 阶段与 flag）。用"每张表都必须
  提到某几个词"去钉，会造出一条**一改措辞就红**的假门禁 —— 第 40 轮我刚吃过一次同类亏
  （用 `grep it(` 数用例，把 5 条读成 3 条）。所以判据只碰**确定的事**：链得上、链得对。
- **顺带**：记分卡的标题行还写着"Date: October 4, 2026"，现在补了"**最后刷新：2026-10-05**"并列出
  第 43 轮改对的那四行 —— 免得那个日期被当成"这张表反映的就是 10-04 的状态"。
- **一处自己的小失误**：新测试里用了 `path.normalize` / `dirname` / `relative`，而本仓**刻意不装
  `@types/node`**，只维护一份最小的 `scripts/nodeTypes.d.ts`。vitest 不做类型检查所以测试当时**全绿**，
  但 `typecheck` **exit 2** —— 补上那三个方法声明后 typecheck exit 0。
  （**"测试绿"与"类型过"是两件事**，这与第 35 轮那个假绿是同一类教训的另一种形态。）
- **证据**：全库单测 **309 文件 / 3595 通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` exit 0
  （0 error / 13 warning，与基线逐条相同）。
## 2026-10-05 —— N6 第二十二步：审查**记分卡自己**（一份被引用了 25 轮、而它自己有 4 行已经过期的文件）

- **先说清了那个"阈值"问题**（我本来怀疑它是个缺口）：发布门禁第 2 条要"达到**预先约定阈值**"，
  于是我去找阈值定义在哪。答案在 `agent-release-gate.md` 的"**第 2 条为什么不能靠'定一个阈值'糊过去**"
  一节：**阈值必须有可对照的基线，而基线只能来自真实 provider 的读数；给一个假基线定阈值，等于让
  "达到阈值"变成一句永远成立的话。** 所以它**是刻意不设的、且写明了理由** —— 这不是缺口。**这一条我
  就不动它了。**
- **然后查到记分卡自己有 4 行过期**（它是 `docs/acceptance/` 里我唯一没整体核过的文件，
  却是我第 12–41 轮反复引用读数的那个文件）：
  1. **`Formal proof | design only`** ← 最严重的一条：N5 已经落了**四步**（产物边界 / 短目标词表 /
     后端接线门 / 后端准入契约）。改成 `boundary only (N5, no backend)` 并写清"**没有后端 ⇒
     `formally_proved` 今天不可达**"、首批三个目标解析层表达不出来、产物从未到过任何界面。
  2. **`Open-ended problem compilation | harness only (N4 step 1–2)`** 与"七类起步题集 / 覆盖 5/7" ←
     题集早已是 **21 条（7×3）**、N4 已到**第七步**，且多了**两个比率**。改成 `step 1–7` +
     `14/21` + 抽取率 `0.667` + 题设覆盖率 `0.727`。
  3. **`Constraint-preserving drag`** 的"已有的"清单里**漏了线状平行/垂直投影**（第 22 轮加的）。
  4. **`Deterministic code/tests` 的读数**：`303 文件 / 3529 通过`、Rust `236` ← 现在是
     **308 / 3590**、Rust **238**；两条统计也顺手更新（Rust **0/60 → 0/100**、e2e **4 → 7** 次连续全绿）。
- **为什么这一条值得单独记**：这份文件是"能力 vs 放行门槛"的对照表，**过期的那一行恰好是
  `Formal proof | design only`** —— 一个读者会据此认为 N5 一行代码都没有。**而这已经是我第三次修
  同一个毛病**（`feature-catalog.md` 的"N3–N5 仍为设计阶段"、发布门禁缺 N5 那一节、现在是记分卡）：
  **新写的进度不会自动回流到那些"按能力列"的对照表里。**
- **只改文档**，没有可执行产物。
## 2026-10-05 —— N6 第二十一步：查到一条"**关于文档漂移的警告自己漂移了**"

- **怎么查到的**：上一轮说要把"剩下的文档"按"历史快照 vs 声称现在时"分一遍。查引用关系时发现
  `docs/architecture.md` 的代码审查清单里有一条（优先级"中"）写着：
  > 旧"当前状态"（`current-status.md`）自称唯一当前状态，但**最后更新时间早于最近 Agent 迭代**，
  > 且其测试数字与发布门禁中的后续快照不同。→ **文档存在时间漂移风险。**
- **这条现在过时了**：那个漂移**正是我第 26–41 轮在修的东西** —— `current-status.md` 的"最后更新"已是
  2026-10-05，§一.1 现在是**同一批实测**的读数总表（九道门禁串行跑完），并且与发布门禁**逐条对齐**。
  所以**一条警告"文档会漂"的记录，自己漂了** —— 这是本轮最有价值的一个发现，也是这个仓库反复吃的那类亏。
- **改法（保留它、标注它、并检查它当时的建议落实了没有）**：
  1. 原文**保留**（划掉），因为"记住这个风险"本身有价值；补上 **2026-10-05 更正**与它现在的状态；
  2. 它当时给的三条建议**逐条核**：①"以本次复跑结果写当前读数"→ **已落实**（§一.1）；
     ②"给 `current-status.md` 加日期"→ **已落实**（"最后更新" + §一.1 每行的"记录于哪一轮"）；
     ③"不要复制旧数字到 README"→ **未逐字复核**，只确认 README 的描述里没有夹旧读数（如实标注）。
- **顺带修掉另两处"指针不清"**（同一种病：**让读者去一个不覆盖他关心内容的地方找答案**）：
  - 发布门禁开头写"做到哪一步看 `current-status.md` 与 `research/2026-09-28-...progress.md`" ——
    而后者是**上一版六阶段清单的快照**（正文截至 2026-09-29），**N1–N6 根本不在里面**。
    改成写明两者**各自覆盖什么**。
  - 那份快照自己加一句**时间边界**：它是快照、N1–N6 的实际进度在 `current-status.md`。
- **只改文档**，没有可执行产物。
## 2026-10-05 —— N6 第二十步：核 §三「还没做的」，改掉两个**过期的数字**（都有本次重量的证据）

- **查法**：§三 与它下面的"如实缺口"是一长串**陈述句**，但里面夹着**可核的数字**。所以只挑带数字的
  那几条去核 —— 这是第 40 轮那条教训的直接应用（**先问"这个说法有没有可核的载体"**）。
- **查出两处过期，都已改对**：
  1. **入口 bundle**：文档写"入口 1 614 kB"，**本次实测**（`npm run build --workspace @draw/web`）
     是 **1 801.18 kB**（gzip 526.71 kB）—— **又长了约 11.6%**。
     顺便把它那句话的边界写清楚：里面"应用代码 ≈855 + React 221 + Three 530"是**当时那次的拆分读数**，
     本轮**没有重新拆**（那要单独做一次 bundle 分析），不许让旧拆分冒充新拆分。
     同一次构建里另有 `engineeringExporters` 433.81 kB 与 `geometry.worker` 376.19 kB 两个 chunk。
     并且给 §二 方案 4 那一行加了交叉引用（"分包那一次 2 066.63 → 1 629.80"是**历史成绩**，
     **当前**是 1 801.18 —— 免得读者把历史值当现值）。
  2. **`test:rust` 的条数**：文档写"232 例通过 + 3 ignored"（2026-09-25 那次）。**本次实测 238**。
     差额说明白：**不是漂移，是第 21 轮给凭据库用例加了两条并发守卫** —— 与第 27 / 37 轮两次复跑一致。
- **顺带确认没问题的**：`scripts/` 已纳入 `tsc`、`planCompiler` 模块环的理由、`longtask` 不可用那条
  实测、`actionRegistry` 的 2026-10-01 更正 —— 这几条今天读仍然成立。
- **只改文档**，没有改代码；`npm run build` 只是**读一次**，产物落 `build-check/`（gitignore）。
## 2026-10-05 —— N6 第十九步：核 §二「逐条验收过」的**证据数字**，并抓到一次"审计方法自己制造缺陷"

- **查了什么**：`docs/current-status.md` §二 声称方案 1 / 3"**已完成并验收**"，并且**点名了用例条数**
  （`geometryWorkerClient` **10 条**、`geometryWorkerHost` **7 条**、`geometryCompileStrategy` **5 条**、
  方案 1 的参数化用例 **4 条**）。这些是**可核的数字**，所以核它们，而不是核那些形容词。
- **结论：逐条对得上**。三个文件用 runner 跑出来合计 **22 条**（10 + 7 + 5），与文档写的**完全一致**；
  方案 1 的 `compileTemplateSolid` 在 `actions.test.ts` 里也确实是 4 处。
- **但过程里差点犯一个错（这一轮最值钱的部分）**：我先用 `grep '^\s*it\('` 数
  `geometryCompileStrategy.test.ts`，得到 **3**，与文档写的 5 不符 —— **我差点就去"更正"那份文档**。
  用 runner 一跑才发现那个文件用的是 **`it.each(cases)`（2 个 case）+ 3 条普通 `it(` = 正好 5**。
  也就是说：**如果我当时直接按 grep 的结果改文档，我会往一份正确的文档里写进一个错误的更正。**
- **已把这条方法教训写进 `docs/current-status.md`**（紧挨反向验证台账）：
  **数用例一律以 runner 输出为准，`grep it(` 会漏掉 `.each` / 循环生成的用例。**
  这也是"审计动作本身会制造缺陷"的现场例子 —— 我这些轮一直在查别人的过期数字，
  这一轮查到的是**我自己的审查方法**。
- **一处读法歧义，如实标注、不猜**：§二 的"一句话进度"说"**七条方案全部落地并验收**"，而表格里
  方案 2 标的是 🔶「已开四十六批」。文档自己的解释是"方案 2 的六个目标文件全部拆分完成，剩下的是
  **可选**项与长尾" —— 所以 🔶 更可能表示"还在打磨长尾"而不是"没做完"。**我没有改它**：
  把它改成 ✅ 需要我替方案 2 的状态下判断，而我没有那个依据。
- **没有改任何代码**（也没改那个被误判的文档数字 —— 它本来就是对的）。
## 2026-10-05 —— N6 第十八步：把"依赖里出现 GPL 就红"做成**机器门禁**（台账里一条"只靠我读过"升格为有守卫）

- **起因**：第 38 轮的反向验证台账里，**"Rust 传递依赖无 GPL/AGPL/SSPL"是"没有守卫、只靠我读过"**
  的三条之一 —— 一旦有人加了个 GPL 依赖，**没有任何东西会拦住**。这一步把它补成门禁。
- **一个硬约束决定了做法**：`cargo metadata` **需要联网**（`--offline` 实测 exit 101）。
  而**跑不起来的门禁等于没有门禁** —— 所以拆成"快照 + 判据"：
  - `npm run licences:scan`（**要联网**）：把结论落成 `rust-licences.json`（只留结论，不留路径/作者/校验和）；
  - `licences.test.ts`（**不联网**）：拿快照 + `Cargo.lock` 判。
- **三条判据，各自挡一种"静默变坏"**：
  1. **同步**：`Cargo.lock` 里出现快照里没有的包 ⇒ 红。**这条最重要** —— 没有它，新加一个 GPL 依赖
     只要没人想起来跑扫描就永远查不出来；
  2. **硬禁**：表达式里出现 GPL / AGPL / SSPL / CDDL / EUPL ⇒ 无条件红（**即使**它同时提供宽松选项）；
  3. **copyleft-only 逐包复核**：整个表达式没有任何宽松选项时（例如裸 `MPL-2.0`），只有在
     `exceptions.json` 里**复核过**才允许；而例外**钉住当年复核的那个许可证**，包换了许可证就过期。
- **实测**：`LICENCES_GATE packages=550 lockPackages=550 distinct=33 exceptions=5`（6 条用例全绿）；
  **定向变异**（往快照塞一个 `eviltool@1.0.0: GPL-3.0-only`）⇒ **2 条红**（硬禁 + copyleft-only）。
- **门禁自己查出我一个错**（值得单记）：第一版解析器**没去括号**，`(MIT OR Apache-2.0) AND Unicode-3.0`
  被切成 `(MIT` 与 `Apache-2.0) AND Unicode-3.0)`，于是 `unicode-ident` 被误判成"只有 copyleft 选项"。
  **这是解析器的毛病，不是那个包的毛病** —— 我去修了解析器（去括号再切分），而不是把那个包写进例外。
  去括号在危险方向上是**保守**的：`(MIT OR GPL) AND X` 去掉括号会被切成 `MIT`，但 `GPL` 已被无条件
  硬禁抓住，不会漏。
- **台账同步**：那一条从"只靠我读过"改成"有守卫"，并补上进台账表格。
- **证据**：全库单测 **308 文件 / 3590 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）。
## 2026-10-05 —— N6 第十七步：抽查我自己的**结构性论断**（反向验证），并建一份**反向验证台账**

- **为什么查这个**：上一轮抽查了**数字**（能重跑），这一轮抽查**论断** —— 论断不能重跑，
  只能**反向验证**：把条件破坏掉，看该红的是不是真的红。**只有被变异验过的才算"有守卫"**，
  否则就只是"我读过一遍"。
- **本轮验的两条（都是我此前说得最满的两句）**：
  1. 「**没审查就接上这件事在结构上做不到**」→ 把推导改回**手写** `["lean4"]` ⇒ **3 条红**
     （含"接入不变量""今天的实况"）。**确认：它不是靠自觉，是有用例挡着回退。**
  2. 「让静默丢句**再也过不去**」→ 从 residue 关键词表删掉 `相等` ⇒ **4 条红**
     （含**题集级不变量**那条）。**确认：把当初那个缺陷原样放回去，会被挡住。**
- **建了一份台账**（写进 `docs/current-status.md` §一 的读数栏附近）：七条论断 × 各自的变异 × 结果 ——
  这是**"哪些话被机器挡着"的唯一一处**。
- **同时如实列出"没有守卫、只靠我读过"的三条**：① 关闭 `constrainedDrag` 时旧路径就是原来那一行
  （结构性的，没有用例 —— 因为可漂移的东西不存在）；② 两处约束模块互补而非重复（读文件的结论）；
  ③ Rust 传递依赖无 GPL/AGPL/SSPL（读出来的，没做成门禁）。
  **这三条不是错的，是"没被机器挡住"** —— 引用时要知道这一点。
- **没有改任何代码**：两处变异都已恢复，工作树干净。
## 2026-10-05 —— N6 第十六步：**抽查我自己记下的读数**（逐条重跑），并改对一条

- **为什么查这个而不是往下加新东西**：第 35 轮我抓到过自己一次"**假绿**"（一次 PowerShell 替换把
  断言删掉，测试还"通过"）。既然我会产出假绿，那么我**写进文档的那些数字**同样该被抽查 ——
  它们已经被引用十几轮了。
- **抽查方法**：把 §一.1 总表里能独立重跑的读数各跑一遍，与当初记下的**逐字**比。
- **结果：九条里八条逐字复现** —— `cargo metadata`（**551 包 / 550 第三方 / 33 种表达式 /
  0 个缺 `license` 字段 / 5 个 MPL-2.0-only**）、`test:rust`（**238 + 3 ignored / 0 失败**）、
  `eval:agent`（**4/8、4/8、45/45、3/45**）、`proof:smoke`（7 通过 + `PROOF_BACKENDS {"wired":[],"reviewed":0}`）、
  `bench:agent`（三条读数逐字相同）。
- **唯一动过的是性能，而且它动得有价值**：`drag/300-frames` 这次 **710.6 ms**（第 27 轮记的是 685.9 ms）。
  两次差 **3.6%** ⇒ 这个数本来就是**采样的离散**，不该以单点形式记。
  **§一.1 那一行已改成区间 `686–711 ms`**，并注明"三次采样的区间，不是单点"。
  这同时**加固了**第 11 轮那个判断：1295 ms 是 **1.8 倍**的离群值，不是回归。
- **两条统计性结论顺带加固**（它们此前只是"概率上说明"）：
  - **Rust secrets 抖动**：又跑 **40 次并行全绿**，累计 **0/100**（修前 15 次红 1 次）。
    若真率仍是 1/15，连绿 100 次的概率约 **0.1%**。
  - **e2e 抖动**：又跑 **3 次全绿**，累计 **0/7**（修前 6 次里 4 次红）。
    若真率仍是 4/6，连绿 7 次的概率约 **0.46%**。
- **这一步没有改任何代码**：改的是"我记的读数怎么记" —— 能复现的照旧，会漂的改成区间。
## 2026-10-05 —— N4 第七步：补上**抽取率（题级）**，并查实"求解率"缺的是**定义**不是实现

- **补的那条**：计划 N4 第 4 条点名"记录**抽取率**、求解率、**题设覆盖率**…"。题设覆盖率第 29 轮已补；
  而"抽取率"一直只**隐含**在 `covered=14` / `cases=21` 里，没有作为比率报出来。现在它是
  `BenchmarkExtractionRate` 的具名读数。
- **为什么值得单独具名**：它与**题设覆盖率不是一回事** —— 前者是**题级**（"这道题有没有读懂"，
  分子是**题数**），后者是**子句级**（"读出来的子句里有多少落成了给定义"，分子是**子句数**）。
  实测两个数**确实不同**：`covered=14/21 → 0.667`，而 `rate=0.727`。一道题可以"读懂了但有 5 条子句
  没核验"，也可以"一条都没读懂" —— 混成一个数就把这两件事说成同一件。
- **口径写进类型注释**：按题**去重**（同题跑多轮不撑大分母）、只看抽取层、`not_measured` 不进统计、
  **没有题时 `rate` 是 `null` 而不是 0**。四条都有用例。
- **实测输出**：`BENCHMARK_EXTRACTION covered=14/21 rate=0.667`（与 `BENCHMARK_PREMISE … rate=0.727` 并列）。
- **顺带查实一条（重要）**：「**求解率**」不是"顺手跑一下"就能有的 —— 见证搜索**只在救援路径里触发**
  （`planCompiler.ts:235` 的 `if (context.diagramWitnessSearch !== true) return first.result`，调用点在
  `:623`），它要**先有一份模型给的计划（含坐标）失败**才有东西可救；离线那一侧**没有这个输入**。
  所以那一条要先回答"**离线时喂什么给见证层**"（拿解析构造的候选当输入？还是干脆把离线见证层定义为
  `not_measured`？）—— **这是口径决定，不是实现缺口**。已记进 `docs/current-status.md` §四 F，
  免得下一轮把它当成"忘了跑"。
- **证据**：benchmark 套件 **+1 条**；全库单测 **307 文件 / 3584 通过 + 1 todo / 0 失败**；
  `typecheck` exit 0；`lint` exit 0（0 error / 13 warning，与基线逐条相同）。
## 2026-10-05 —— N4 第六步：**flag 状态进入 trace**（上一轮查实"从没做过"的那一条，不需要裁决）

- **做了什么**：把五个 feature flag 的状态**随 `RunRevisions` 一起写进 run 事件** ——
  于是**每一条事件都带着"这轮是在哪组开关下跑的"**（`RunEvent` 在每次相变时都 spread 整份
  `revisions`）。
- **为什么放在 `RunRevisions`**：那一节的定义就是"**这次运行是在什么条件下发生的**"，
  而**开关状态与版本号是同一种事后对账信息**。少了它，同一个 runId 在开关前后会有两种截然不同的
  含义，而"这份 trace 是在哪组开关下取的"**答不出来**。
- **两条纪律（都有一正一反的用例）**：
  1. **给了就随每一条事件带上**，不是只带第一条；
  2. **没接线就留空（`undefined`）**，**不许编一份"全关"** —— 与 `RunRevisions` 其余字段同一条口径：
     "调用方没接线"与"确认过是关的"是两件事。
- **落点**：`RunRevisions` 新增可选 `nextPhaseFlags`（**结构声明**五个布尔，不 import `apps/web` 的
  `AgentNextPhaseFlags` —— 同 `committerAdapter` 的处理）；`StartRequest` 收下它；
  `agentRunner.ts` 在 `coordinator.start({...})` 处把 `agentNextPhaseFlags()` 传进去。
- **证据**：`runState.test.ts` **+2 条**（正反各一）；**定向变异**（把 `revisions` 里的
  `nextPhaseFlags` 抹掉）→ **正好那一条红**；全库单测 **307 文件 / 3583 通过 + 1 todo / 0 失败**；
  `typecheck` exit 0；`lint` exit 0（0 error / 13 warning，与基线逐条相同）。
- **一处必须留档的自己的失误**：第一版用例我猜了两条**不合法**的相变（`planning` / `acting`），
  测试红了；修的时候一次 PowerShell 替换**把断言整段删掉** —— 于是测试"通过"了，
  而那是个**没有断言的空壳**（**假绿**）。我是在**读改动后的那几行**时发现的，改成用
  `nextPhases` 取合法相并保留断言。**"测试通过"必须与"测试断言了什么"一起看。**

## 2026-10-05 —— N6 第十五步：§四（自称"还差什么"的**唯一权威处**）里六处过期，逐条改对

- **为什么优先查这里**：`docs/current-status.md` §四 自己写着"本节是**还差什么**的唯一权威处"。
  一份**权威**清单过期，比别处过期危害大得多 —— 维护者会拿它当准。所以我把它逐条核了一遍。
- **查出六处**（全部改对，`misses=0`）：
  1. **§四 C.1** 把**题设覆盖率**列在"尚未完成"里 —— 而它在第 29 轮**已经有了读数**：
     `BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727`（抽取层，21 题，**72.7%**）。
     改成"抽取层的题级与题设级覆盖都有数，缺的是**真实模型那一侧的全部指标**"。
  2. **§四 D.1** 还写着"`main` 顶端 `9a65e6d` 只改文档" —— 实况是**本地 `main` 顶端 `60488fa`、
     领先 `origin/main` 33 个提交、从未 push**。也就是说**远端与 CI 都还没见过 N3/N4/N5/N6 的任何一行**。
     并补上一句：发布之前**先要决定要不要 push**。
  3. **§四 E.3（N3）** 停在"已开工三步" —— 现在**内核侧已做完**（第五步：线状平行/垂直），
     补上"按 `ConstraintType` 全部 8 个成员枚举核过 ⇒ `no-projection-rule` 不可达"与
     "计划点名的七件测试文件 7 文件 / 241 通过"。
  4. **§四 E.4（N4）** 的"flag 状态进入 trace/benchmark 记录" —— **核实后确认仍然没做，而且是查过的**：
     五个开关只被当作布尔**消费**，**没有任何一处把它们写进 run event / trace / benchmark**，
     所以"这份读数是在哪组开关下取的"今天**答不出来**。这一条**不依赖任何裁决**，可以独立做完。
  5. **§四 E.5（N5）** 停在"已开工第一步" —— 现在是**第四步**（边界 / 短目标词表 / 后端接线门 /
     后端准入契约），并补上 `PROOF_BACKENDS {"wired":[],"reviewed":0}` 这个读数。
  6. **§四 E.6（N6）** 停在"已开工第一步"，且"没回答的"那一串已经过时 —— Rust **传递依赖**许可扫描
     与**并发正确性专项**都已经做完（各自有结论与反证）。改成第十四步的正确摘要，
     并把"仍然没回答的"收窄到**浏览器用例**与**依赖体积/供应链**。
- **顺带查实一条**（不是推测）：flag 状态**确实没有**任何写入点 —— `planCompiler` 的 context 与
  `committerAdapter.nextPhaseFlags` 都只是**读**；`BENCHMARK_RUN_REQUIRED_FIELDS` 里也没有它。
- **只改文档**，没有可执行产物。

## 2026-10-05 —— N6 第十四步：发布门禁**只记录了三分之二的证据**，补齐 N5 那一份（并修掉 N4 那一节的过期读数）

- **怎么查的**：N6 的 `- [ ]` 写着"更新**所有**进度文档和发布门禁；**统一记录真实 provider、
  动态拖动和 proof artifact 证据**"。我没把"都更新了"当结论，而是去数**这三种证据在门禁里各有几处**：
  真实 provider **7 处**、`constrainedDrag` **7 处**、而 `formally_proved` / 证明产物 **1 处** ——
  且那一处还是在说"**没有**把静态实例升级成形式证明"。
- **查出的事实**：门禁里有 5 条编号门禁（来自 Task 6.3）+ 两处**已声明但未编号**的新门槛
  （witness coverage / real-provider baseline）+ **N3 与 N4 的两节散文**，而 **N5 一节都没有**。
  也就是说 **"统一记录三种证据"只做到了 2/3**，第三种只被顺带提了一句。
- **补上 N5 那一节**（照 N3/N4 两节的同一结构：已有的 / 可复核读数 / 没有的 / 为什么不能算达成）：
  边界、词表、后端接线门、准入契约、`proof:smoke` 都在；`PROOF_BACKENDS {"wired":[],"reviewed":0}`；
  **没有后端接入** ⇒ `formally_proved` 不可达；共线/共面/勾股在解析层表达不出来；产物没进过界面。
  并写清**为什么它不能算"已达成"**：一个**永远不可能产出** `formally_proved` 的系统，
  "实例 / 采样 / 证明严格分级"是**平凡成立**的 —— 那不算满足了门槛（分级本身已被**双向**验过）。
- **顺带修掉 N4 那一节的过期读数**：它当时写"七类各一条的起步题集"与
  `cases=7 covered=5 empty=2` —— 题集在第 24 轮已经变成 **21 条**、第 29 轮又加了**题设覆盖率**。
  现在改成 `cases=21 covered=14 empty=7` + `BENCHMARK_PREMISE … rate=0.727`，并明确标注**两个读数
  不可比**（题集换了）。**这就是"统一记录"没做到位留下的后果：一节写了、另一节没跟上。**
- **一句话结论也补了一句**：五条编号门禁之外，**N3 浏览器验收与 N5 证明出口"今天无法判定"，
  而且不是缺工作、是缺决定** —— 并明确"**无法判定**与**已达成**是两件事"，两条都不许读成绿。
- **只改文档**（核对的产出就是那份表），没有可执行产物。

## 2026-10-05 —— N6 第十三步：把"关闭 flag 时旧路径逐字不变"这句话**拆成三种证据**（一次过度概括的纠正）

- **怎么查的**：N6 的 `- [ ]` 里写着"每个 flag 有单元、浏览器和回退用例；**关闭 flag 时旧路径行为
  逐字不变**"。我没把这句当结论读过，而是逐条去核**每个开关的离路径到底靠什么保证**。
- **核出来的事实：那不是一种证据，是三种，强度也不同**（表已写进
  `docs/acceptance/next-phase-flag-and-dependency-review.md` §一 之后）：
  - `witnessSearch` —— **黄金样本逐字节**（`planCompiler.offPath.golden.test.ts`：冻时钟、对着基线
    commit 比 `JSON.stringify` 的每一个字节）。**这是唯一"测出来的"**。
  - `obligationIR` —— **结构 + 单测**：`diagramObligationIR?: boolean` 注释写明"**显式为 `true` 才开**"，
    `planCompiler.test.ts` 真的传过 `false`，跨 Worker 那一侧用 `request.obligationIR === true` 归一化
    （所以 `false` 不会在边界上变成真值）。
  - `constrainedDrag` —— **结构性**：`App.tsx:519` 的离路径**就是原来那一行**
    `apply({ op: "translatePrimitive3", id, delta })`，**没有第二份实现可以漂移**。
  - `openProblemCompiler` / `proofExport` —— **没有读取点**，不存在"旧路径"这回事。
- **为什么这次纠正值得写下来**：一份**黄金样本**保证"今天与基线逐字节相同"，但它是对**当时那份
  基线**的快照，有意改动就会过期；**结构性**保证不会过期，却**没留下"当时到底一样不一样"的证据**。
  两者都成立，**但不能互相冒充** —— 尤其不能拿"结构上没变"去充当"测过一样"。我此前在汇报里
  把它们混着说成"都有离路径证据"，那是过度概括。
- **顺带确认**：`obligationIR` 的严格 `true` 契约确实被单测碰过（不是只有注释），所以它不需要
  再补一条黄金样本 —— 这一点也写进了那张表。
- **只改文档**（核对过程本身就是产出），没有可执行产物；`typecheck` / `lint` 不受影响。

## 2026-10-05 —— N5/N3 核实：一条**判定为现在做不了**（并说清为什么），以及两处"约束"模块的分工

- **先核实计划里 N5 剩下的那条"只读展示"**（把 proof artifact 接进 `ConfirmationPanel` / `agentStore` /
  run event schema）。查下来它**现在做不了，而且不是"没时间做"**：
  1. `ClaimEvidence` 这套证据词汇**根本没有进过 Web 界面** —— 面板显示的是 `diagramVerification`
     （另一套词汇，讲"这份图核验了吗"），而 `ClaimEvidence` 只在 `witnessSearch` /
     `solverContracts` / `planCompiler` 这些**核心层**里活着；
  2. **今天没有任何后端**，产物永远不存在。
  所以为一个**不可能出现**的东西先做展示面属于投机性设计。**这一条与"接一个真实后端"是同一件事**，
  跟着那个决定走 —— 已如实记进 `docs/current-status.md` §四 F，免得下一轮又被当成"顺手能做"。
- **顺手解开一个我自己制造的疑点**：本仓现在有**两处**跟"约束"有关的模块，读代码的人（包括我）
  很容易怀疑是重复实现。核实结论是**互补，不是重复**：
  - `planar-constraints.ts`（"平面约束模型"）管**"点能待在哪儿"** —— 一条约束 = 一条**一维曲线 +
    自然参数**，`project(q)` 把鼠标位置映射成参数、`evaluate(t)` 再映射回坐标，于是**拖拽与动画
    是同一条状态更新**；它管的是**点 ↔ 宿主**（线段上 / 圆上 / 面上 / 实体内部）这种**一元**关系。
  - `constraints3dProjection.ts`（N3 新建）管**"几个对象之间必须保持什么关系"** —— `⊥` / `∥` /
    等长 / 共面这些**多元**关系没有"一个标量参数"能压进去（拖一个点会同时牵动另一条线），
    所以用**顺序投影**迭代到残差足够小，并在答案不唯一时如实跳过。
  一句话：**那边是"点沿曲线走"，这边是"点把关系拖住"**；两者可以同时出现在同一份文档里
  （一个点既绑在棱上、又与另一条线保持垂直）。**分工写进了 `constraints3dProjection.ts` 的文件头**
  —— 放在读它的人第一眼就会起疑的地方。
- **顺带补一个从没跑过的"计划点名"读数**：计划 N3 的 RED 命令点名了**七件**测试文件，我一直没按
  那个集合跑过。补跑：**7 文件 / 241 通过 / 0 失败**。（那行命令的后半段
  `e2e/agent-constrained-drag.spec.ts` **仍然不存在** —— 仍是那个产品入口的裁决。）
- **证据**：`typecheck` exit 0；`lint` exit 0（0 error / 13 warning，与基线逐条相同）；
  `constraints3dProjection.test.ts` 25 通过（文档改动不影响行为）。

## 2026-10-05 —— N5 第四步：把"接一个后端"变成**交一份通过的审查记录**（而不是改一个数组）

- **怎么发现的**：还是那个办法 —— 把计划的 `- [ ]` 逐条核。N5 那几行写着：
  "Proof spike … **先输出后端版本/许可证/进程模型/WASM 或原生依赖/启动耗时/超时状态**，
  未通过依赖审查时只允许 `unsupported`"、"**依赖审查任务（必须在 GREEN 前完成）**：记录许可证、
  进程/线程边界、WASM/原生依赖、缓存/沙箱、启动时间和失败/超时行为；**没有审查结论不得接入默认构建**"。
  我的 smoke 当时只验了边界，**这份审查记录一栏都没有**。
- **新增** `packages/agent-core/src/proof/proofBackendReview.ts`：十栏审查记录（名称 / 版本 / 许可证 /
  进程模型 / 原生或 WASM 依赖 / 启动耗时预算 / 超时策略 / 失败行为 / 缓存与沙箱 / 结论）
  \+ `reviewProblems`（逐条点名）+ `isReviewPassed`（填齐**且**结论为 `passed`）。
- **最关键的一处结构改动**：`WIRED_PROOF_BACKENDS` 从**手写数组**改成**由通过的审查记录推导** ——
  `PROOF_BACKEND_REVIEWS.filter(isReviewPassed).map(name)`。于是"**没审查就接上**"这件事
  **在结构上做不到**了：它不再靠记性，也不再靠 code review 抓。今天两份都是空数组，而**这不是缺陷**：
  "没有审查记录 ⇒ 没有接入 ⇒ 谁也升不到 `formally_proved`"是**同一件事的三种说法**。
- **刻意区分的两种"不算"**：**填不齐**（`reviewProblems` 非空）与**填齐了但结论不是 `passed`**
  （例如评审发现许可证有问题）—— 都挡住接入，但理由不同，所以拆成两个函数、两组用例。
- **刻意定死的两条边界**（都有用例）：① 说明性文字（超时策略 / 失败行为 / 缓存与沙箱）**只要求非空**
  —— "写得对不对"是**人的审查结论**，不是这一层的职责；② `startupBudgetMs` 必须是**有限的非负数**
  —— 写"很快"不算。
- **smoke 现在"先输出"这份状态**：`npm run proof:smoke` 打印
  `PROOF_BACKENDS {"wired":[],"reviewed":0,"rows":[]}` —— **空表本身就是要输出的读数**。
- **证据**：proof 目录 25 → **35 条**（新增 10 条审查契约用例）；smoke 6 → **7 条**；
  全库单测 **307 文件 / 3581 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）。

## 2026-10-05 —— N4 第五步：把计划第 4 条里**从没落地过**的两件事补上（轮数上限 + 题设覆盖率）

- **怎么发现的**：沿用上一轮的办法 —— 把计划里 N2–N6 的 `- [ ]` 逐条列出来核。N4 第 4 条写着
  「**每题最多 3 轮**，记录抽取率、求解率、**题设覆盖率**、verified/unverified/no_witness、成本、
  延迟和人工可读性」。逐条查下来：**"每题最多 3 轮"全仓没有任何一处实现或校验**
  （`grep maxRounds|rounds` 为空），**题设覆盖率也没有任何表示**。两件都不需要 provider，是我自己漏做的。
- **补上「每题最多 3 轮」**：`report.ts` 新增 `MAX_ROUNDS_PER_CASE = 3`，`buildBenchmarkReport` 按
  `(mode, caseId)` 计数，**超了整份拒收**。为什么按 mode 分开计：离线回归与真实模型是**两次独立评测**，
  各自上限 3 轮（口径写进注释）。为什么超限要**拒收整份**而不是打个警告：一份"某一题跑了 9 轮"的报告
  会让聚合数字失去可比性 —— **而它看起来完全正常**。
- **补上「题设覆盖率」**：`BenchmarkPremiseCoverage` = **给定义 ÷（给定义 + residue）**；只看抽取层、
  `not_measured` 不进统计；**一条子句都没读到时 `rate` 是 `null` 而不是 0**（"没读到任何子句"与
  "读到的全都核验不了"是两件事，这条在用例里钉着）。口径**写在类型注释里**，因为这是本仓自己的定义，
  不是行业标准。
- **单源**：residue 的记号抽成 `EXTRACTION_RESIDUE_STATUS` —— `run.test.ts` 造证据与 `report.ts`
  统计覆盖率用的是**同一个常量**，否则"哪条算 residue"会有两份判断。
- **第一个真实读数**：`BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727` —— 21 道题里
  **24 条子句变成给定义、9 条显形为 residue，题设覆盖率 72.7%**。
- **证据**：benchmark 套件 34 → **37 条**；**定向变异**（把上限从 `>` 改成 `> +99`）→ **正好那一条红**；
  全库单测 **306 文件 / 3570 通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` 0 error / 13 warning
  （与基线逐条相同）。
- **仍未做的（需要 provider，不是漏做）**：求解率、成本、延迟、人工可读性，以及
  `verified/unverified/no_witness` 那一组 —— 它们在**见证层**，今天整批是 `not_measured`。

## 2026-10-05 —— N6 第十二步：补跑计划点名、而我一直漏跑的**生产构建**（八道门禁到齐）

- **怎么发现的（方法比结果重要）**：我没有靠回忆，而是把计划里 N2–N6 的 `- [ ]` **逐条列出来核**。
  于是看到 N6 出口那一行写着八道命令，其中第五个是 **`npm.cmd run build --workspace @draw/web`** ——
  **而我从第 12 轮起自称的"整批电池"里没有这一条**。**我一直漏跑生产构建，却说了 8 轮"整批"。**
- **结果**：**成功**，exit 0，4.83 s；产物落在 `build-check/`（**已 gitignore**，构建后工作树干净）；
  有一条**既有的** chunk 提示（主 chunk 1.8 MB > 500 kB），不是新问题。
- **顺带一台环境错误（留档）**：第一次跑报 `ENOENT … open 'D:\数学画布\package.json'` —— 那是
  **我自己忘了指定工作目录**，npm 跑在了会话根目录而不是仓库根。**这不是构建失败**：按本仓纪律
  （环境错误不能算 RED），我没把它记成一次红，重跑即绿。
- **另一条核实（把词表枚举出来验，而不是断言）**：计划 N3 的 RED 写着"拖动保持**中点**/垂直/固定距离"。
  逐词对过 `ConstraintType` 的**全部 8 个成员**（`parallel | perpendicular | coincident | pointOnLine |
  pointOnPlane | collinear | coplanar | fixedDistance`）：可投影的 **7 个都在 `PROJECTABLE` 里**，
  剩下 `coincident` 是 `NO_SPATIAL_JUDGE`（平面内专有）。**所以"没有投影规则"那一支确实不可达。**
  而**"中点"根本不是 `ConstraintType` 的成员**（它是**题设种类**）—— 要让"拖动保持中点"落到约束层，
  得先扩约束词表，那和角度 / 线⊥面一样属于**扩范围**，不是顺手能做的。 **（2026-10-05 更正：这个结论错了）** —— 计划的"中点"**不需要**扩约束词表：它早就有载体了，是**派生点**（derived binding）。`packages/scene-graph/src/operations.test.ts`（**正是计划 N3 RED 命令点名的那七件之一**）里就有一条：派生中点 `p-mid = midpoint(p-a, p-b)` **拖它自己被拒**（`not draggable`，派生点不该被直接拖），而**拖它挂靠的那条线会带着它走**（`line-ab` 平移 (3,0,0) 之后断言 `p-mid = (4,0,0)`）。3D 那一侧在 `resolve3d.ts:138`。**所以"中点"这一半本来就成立，只是不在"约束"而在"派生"里。**
- **§一.1 的总表补上生产构建这一行**，并注明：**计划里 N6 出口点名的八道命令现在都有读数**；
  `bench:agent` 与 `proof:smoke` 是计划之外额外跑的。
- **只新增读数与文档**，没有改任何代码。

## 2026-10-05 —— N6 第十一步：**整批电池重跑**（九道门禁全绿），并推翻一个我自己记下的"性能读数"

- **为什么要重跑**：第 20 轮之后我又改了**几何内核**（线状平行/垂直投影）与 **agent 解析**
  （residue 关键词补 `相等`），而这两块都在 e2e / Rust / perf 的覆盖范围里 —— 却只复跑过快的几道。
  所以这一轮把**九道门禁串行跑完**（14:47:49 → 14:52:12，约 4 分 24 秒），结果**全部 exit 0**：
  `typecheck` / `lint`（0 error / 13 warning）/ 单测 **306 文件 / 3567 通过 + 1 todo / 0 失败** /
  Rust **238 通过 + 3 ignored / 0 失败**（16 个二进制）/ e2e **186 通过（54.2 s）** /
  perf 9/9 / eval pass@1 **4/8**、pass@3 **4/8**、工具选择 45/45 / bench
  `cases=21 covered=14 empty=7` / `proof:smoke` 6 通过。
- **顺带推翻了我自己上一批记下的一个数**：`drag/300-frames` 当时记成 **1295 ms**，并解释为
  "测在整批电池之后"。**本轮同样把 perf 放在整批最后，却得到 685.9 ms** —— 与 2026-10-01 基线的
  **682.5 ms** 吻合。所以那个 1295 ms 是**测量条件造成的离散值，不是回归**；
  本仓此前"不许读成回归"的措辞是**对的**，但理由记错了（不是"排在最后"，是那一次连跑了五遍
  `test:rust`）。这一条现在有**反证**，不再是"存疑"。
- **`docs/current-status.md` §一.1 的总表因此更新为"同一批读数"**（九行全是本轮实测），
  不再需要"某行是当时测过、此后未改动"那种免责写法。
- **只新增读数与文档**，没有改任何代码。

## 2026-10-05 —— N6 第十步：给 `current-status.md` 的 §一 补一张**真正的"现在时"总表**，并把待裁决写成不滚掉的表

- **问题是我自己造成的**：§一 的职责是"现在能不能跑"，而它已经长成 ~400 行、**按轮倒序堆着的
  "本批实测"** —— 26 轮下来它变成了日志，而**没有任何一处是"当前读数"**。这正好犯了本仓最忌讳的
  那种毛病（同一件事写着 20 多份、读者不知道该信哪份）。
- **改法（加，不删）**：
  1. **§一.1「当前读数总表」**：九道门禁一行一道，每行都带**"记录于哪一轮"**。单测 / typecheck /
     lint / benchmark / smoke 是**本轮复跑**的；Rust / e2e / eval / perf 标的是**当时测过、此后
     未再改动那一部分**的轮次。**没有一行写成"应该没问题"。**
  2. **§一.2「挡路的待裁决」**：四件事（`constrainedDrag` 入口、N5 首批的共线/共面/勾股、
     `real_provider` 的 provider 与凭据、要不要 push），每件写清**要你定什么 / 为什么我定不了 /
     定了之后能做什么**。写进文档的理由很直接：**聊天里的提问会滚掉，这张表不会。**
  3. 下面按轮的「本批实测」保留，但**明确标注为过程记录**。
- **顺带补一次我漏掉的复跑**：第 24 轮改了 `scripts/agent-benchmark/run.test.ts`（在 typecheck 的
  范围内），而我**当时没有重跑 typecheck/lint** —— 本轮补上了：`typecheck` exit 0、
  `lint` 0 error / 13 warning（与基线逐条相同）。**这属于我自己的验证缺口，不是代码问题。**
- **顺带把 §一 之前那句过期的"最后更新"重写**（它停在"N5 已开工第一步 / N4 第二步 / N3 四步"，
  已经落后四轮）。
- **`project-progress.md` 仍然不动**（它是明文归档）。**只改文档**，无新的可执行产物。

## 2026-10-05 —— N6 第九步：把 `feature-catalog.md` 里"**N3–N5 仍为设计阶段**"这句改对

- **为什么**：`docs/project-progress.md` 是**明文归档**（"任何数字都只代表写它的那一刻"），不该动；
  而 `docs/feature-catalog.md` 是**当前能力目录**，它那里写着
  **"N3–N5 仍为设计阶段，尚未计入当前已实现能力"** —— 这句现在**不准确**：N3 落了五个内核步骤
  加接线、N4 落了题集与运行入口、N5 落了边界与后端门。**低估和夸大一样是错**。
- **改法（不是把 ⬜ 改成 ✅）**：三条仍然保留 ⬜（它们的语义是"**用户可见能力**"，这一点没变），
  但每条都写清**已落地什么 + 卡在哪**：
  - N3：投影求解已做（含线状平行/垂直）+ 自由度/冗余/冲突诊断；卡在**没有产品入口能打开开关**，
    所以过约束/无解/超时的浏览器用例还没写；
  - N4：题集 7 类 × 3 条 + `npm run bench:agent` + 逐条归因已在；卡在**适配器没写**，
    `real_provider` 仍整批 `not_measured`；
  - N5：产物 schema + `verifyProofArtifact` + 词表 + **后端接线门** + `proof:smoke` 已在；
    卡在**没有后端**，所以这一层现在"只防冒充，不产生证明"。
- **顺带去掉一处"抄第二份"**：原来那句写死"关闭时默认行为与 `b1ee3d3` 相同"。基线哈希**只在
  `docs/current-status.md` 里记**（那里已经按各阶段分开记了），目录里再抄一份就会漂 —— 已改成
  指向那份唯一记录。
- **顺带确认**：全仓再没有第二处"设计阶段 / 尚未计入"的说法（grep 过 `docs/**` 与 `README.md`）。
- **只改文档**，没有可执行产物，因此没有新的门禁读数。

## 2026-10-05 —— N4 第四步：题集 7 → **21 条**（每类 3 条），并把"静默丢句"钉成题集级不变量

- **为什么扩**：`covered=5/7` 这个读数说服力不够 —— 每类只有一条时，它测的是"这一条恰好过不过"，
  不是"这一类行不行"。现在 **7 类 × 3 条 = 21 条**。
- **扩完先看归因（这次是机器展开，不是我逐条读）**：`cases=21 covered=14 empty=7 error=0`。
  **7 条 `empty` 全部带着 residue**（`unverified`）—— 也就是说，
  **14 条新用例里没有一条是"整句凭空消失"**。
- **这条负面结果本身是读数**：上一轮修掉的静默丢句（"棱长始终相等"）是个案，不是普遍塌陷；
  新加的 `dynamic-drag-midpoint`（"让 M 始终是 AB 的中点"）与 `dynamic-animate-perpendicular`
  （"让 PA 始终垂直于平面 ABCD"）**都留下了 residue** —— 这两条是我**特意**按同一类写法挑的
  （关系词在句子里、但状语把匹配隔开），它们没丢掉，说明上一轮的修法确实在管用。
- **把不变量钉在题集这一层**（本批第二个产出）：新增一条用例
  ——**每一条题都必须至少留下一条给定义或一条 residue**。它用的就是跑读数时的同一个
  `parseObligationIR`（不另写一份判断）。这样以后往 `cases.jsonl` 加新写法，静默丢掉会红在
  **题集**这一层，而不必等谁去逐条读归因。
- **一条必须说清的不可比性**：覆盖率**不能**和上一批直接比 ——`5/7`（71%）→ `14/21`（67%）
  看起来是下降，但题集**换了**：新加的三类（`unsupported-expression`、`dynamic-request`、
  `dihedral-or-ratio`）是**刻意偏难**的那几类，分母里现在有 9 条这种。所以这两个数字
  **只记录、不比较**。
- **归因摘要（21 条）**：`extracted` 14 条；`partial` 2 条（都是 `dihedral-or-ratio`：
  二面角或线段比读不干净，留下 residue）；`empty` 7 条且**全部带 residue**。
  `contradictory-three-lengths`（同一条线段三个长度）**没有**被静默合并：读出 3 条 `fixedLength`。
- **证据**：benchmark 套件 **33 → 34 条**全绿；`npm run bench:agent` exit 0；
  全库单测读数见 `docs/current-status.md` §一。

## 2026-10-05 —— N4 第三步：逐条归因，**然后 benchmark 真的查出一个缺陷**

- **先做归因**（"那两个 `empty` 到底是哪两个"这件事欠了好几轮）：`BENCHMARK_REPORT` 里本来就逐条带着
  `caseId` / `status` / `evidence`，展开就行 —— **不用改代码**。
- **归因结果**：`underdetermined-pyramid-base` extracted(3 条) / `contradictory-two-lengths`
  extracted(2) / `unsupported-expression` **empty** / `shuffled-naming` extracted(1) /
  `dihedral-forty-five` **partial**(2) / `dynamic-drag-request` **empty** /
  `universal-proof-request` extracted(1)。
- **先把 `empty` 这个标签的含义写清楚**：它是"**0 条给定义**"，**不等于**"什么都没留下" ——
  `unsupported-expression` 的 `empty` 旁边就带着一条 residue（"AB"）。
- **benchmark 查出的真缺陷（本批最有价值的产出）**：`dynamic-drag-request` 的原话是
  「拖动这个正四面体的一个顶点，**保持六条棱长始终相等**」，修前它 `givens=0` **且** `unverified=0`
  —— 一个几何条件词（"相等"）**凭空消失**了。而 `diagramObligations.ts` 自己的注释写着：
  新写法必须显形为 unverified，**不许把非空题面静默变成空通过**。
- **根因（复现 + 读代码，不是猜）**：residue 的关键词表只认**连续的** `等长` / `长度相等` /
  `线段相等` / `边相等`，而"棱长始终相等"里一个都没有 —— 只有"相等"，而它**不在表里**。
- **修法（一个词的改动）**：关键词表补上 `相等`。
- **按纪律走**：先写**失败**用例（用 benchmark 里的**原话**）→ 确认 RED
  （`expected 0 to be greater than 0`）→ 再改那一个词 → GREEN。旁边那两条
  "普通说明文字不许变成 residue"的既有用例仍然全绿，说明没有放宽过头。
- **修后的读数**：`dynamic-drag-request` 的 `evidence` 从"（没有抽出任何子句）"变成一条
  `unverified` —— 数字上 `covered=5 empty=2` **没变**（`empty` 的定义就是"0 条给定义"），
  但记录从"什么都没有"变成了"**有，但没核验**"。
- **证据**：`diagramObligations.test.ts` 11 → **12 条**；diagram 三个套件 25 条全绿；
  全库单测 **306 文件 / 3566 通过 + 1 todo / 0 失败**；`typecheck` / `lint` 见
  `docs/current-status.md` §一。

## 2026-10-05 —— N3 第五步：线状 `parallel` / `perpendicular` 的投影（内核最后一块缺口）

- **为什么现在能做**：之前我把它记成"要先决定旋转哪一侧的点，是一个产品判断"。**那个判断其实
  早就有先例** —— 2D 的 `projectLineConstraint` 一直是"保持第一条线不动、动第二条"。
  按同口径落地就不需要新裁决了。
- **做法**：保持**第一条**线不动，把**第二条**绕自己的中点摆成平行（或垂直）；取**最小改动**
  （`perpendicular` 的目标 = 当前方向在"垂直于第一条线"的那个平面上的投影）。**长度与中点都不变。**
- **两种"没有唯一答案"的如实跳过**（不猜）：① 方向是**显式写死**的直线（`pointDirection`）
  —— 靠挪点转不过去；② `perpendicular` 而两条线**已经平行** —— 转 90° 有无数个同样好的答案。
  另加一条：第二条线只要**有一个端点被锚住**就跳过（转动要同时动两个端点）。
- **顺带两件事**：`lineEndpoints` 从 `constraints3d.ts` **导出**（线状投影要用同一份"怎么从图元
  读出一条线"的判据，不许写两遍）；`no-projection-rule` 这一支**从此不可达** —— 有空间判据的
  约束种类现在都有投影规则了，代码与文档都写明了这一点，并**保留**那一支给下一个新增种类
  （静默通过才是最坏的结果）。
- **被替换掉的一条用例**：原来有一条"`parallel` 进 `no-projection-rule`"的用例 —— 它的前提
  已经不成立，所以**按新行为改写**（不是删掉）：现在钉的是"`parallel` 真的把第二条线转过去了、
  长度与中点不变"，另加 5 条覆盖垂直、已垂直、已平行、端点被锚、`pointDirection`。
- **证据**：`constraints3dProjection.test.ts` 20 → **25 条**（1 条拆成 6 条）；全库单测
  **306 文件 / 3565 通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` exit 0
  （0 error / 13 warning，与基线逐条相同）。
- **边界**：`constrainedDrag` 开关**仍然默认关**，所以这一块能力在产品里**依然不可达**；
  浏览器验收仍卡在"没有产品入口能把开关打开"。

## 2026-10-05 —— N6 第八步：并发正确性专项（唯一一处两把锁嵌套，此前**从未被执行到**）

- **为什么值得做**：`next-phase-flag-and-dependency-review.md` 的第四节原来自认"**没有做过并发
  正确性的专项审查**"。而这一节里有两个线程边界（几何 Worker、tokio 回环代理），"没审"是一个
  悬着的风险，不是一句免责声明。
- **审出来的结论（三条，都有代码位置）**：
  1. **IPC 命令全是同步的**（`commands/*.rs` 里没有 `async fn`），所以托管状态用
     `std::sync::Mutex` 是对的，代码里也写明了理由；**同步命令 + std Mutex + 无 `.await`**
     是自洽的 —— `MutexGuard` 不是 `Send`，"跨 await 持锁"那类错误在 async 上下文里编译不过。
  2. **唯一一处两把锁嵌套**在 `proxy/server.rs` 的 `RunRegistry::touch`：先拿 `order`、淘汰时再拿
     `runs`，**顺序恒为 `order → runs`**；两个调用点（`cancel_handle` / `record`）都在
     `drop(runs)` **之后**才调它 —— 那两行 `drop` 是**锁序的一部分，不是多余的清理**。
  3. **本批查出的真缺口**：`touch` 只在**超过 `MAX_TRACKED_RUNS`（16）**时才去拿第二把锁，而
     **此前没有任何用例把注册表推过上限** —— 也就是说**那段嵌套从未被执行到**。
- **本批补上的守卫**：新增两条用例（`evicting_past_the_cap_keeps_the_registry_bounded` /
  `recording_past_the_cap_also_evicts`）把淘汰分支跑到，并在两处 `drop(runs)` 上写明了不变量。
  **守卫是确定性的，而且验证过它会响**：`std::sync::Mutex` 不可重入，删掉任一处 `drop(runs)`
  会**同线程自锁**。实测——删掉第一处后跑那条用例：**90 秒未结束、被强杀**（挂住即红）；
  恢复后全量 `test:rust` **238 通过 / 0 失败**（原 236 + 新增 2）。
- **仍然没做的（写进文档，不是漏写）**：几何 Worker 那一侧**没有**做同样的"共享可变状态"清点
  （它是消息传递、没有共享锁，但这份结论**没有**写成清单），也没有任何并发压测 ——
  **"没有共享锁"是读代码得出的，不是机器挡住的。**
- **只改 Rust 源码与文档**：`server.rs` 的改动是**纯新增**（+63 / −0），
  `typecheck` / `lint` 不受影响（Rust 不在它们的范围内）。

## 2026-10-05 —— N5 第三步：补上"**这个后端接上了没有**"这一环（上一版漏掉的），并给出可跑的 smoke

- **上一版漏了什么（自查发现的真缺口）**：`verifyProofArtifact` 只校验产物的**形状、版本与绑定** ——
  而一份**手工编的**产物可以把这些都满足：`backend.name` 写 `lean4`、`proof` 里放一段字符串、
  `result.status` 写 `verified`。校验器**没有任何办法**从产物本身判断"这段话真的被 Lean 内核
  接受过"。所以"有没有证明"这件事最终只能由**我们这边**回答：这个后端**接上了没有**。
- **新增** `WIRED_PROOF_BACKENDS`（**空的**）+ `ProofVerifyOptions.wiredBackends` + 新码
  `backend-not-wired`。生产默认一个后端都没接，所以**今天没有任何产物能升到 `formally_proved`**
  —— 这不是保守，是事实。测试可以注入一个假后端，用来验"这条路本身是通的"。
- **新增** `scripts/proof-spike/`（计划 N5 的 `--mode=smoke`）：`smoke.test.ts` + `runner.mjs` +
  `npm run proof:smoke`（与 `agent-eval` / `bench:agent` 同一条纪律：没有 TS 运行器，所以真正的
  运行放 `.test.ts`，入口只传命令与退出码）。它验的**不是**"能不能证明"，而是那条不变量：
  **首批每一个能表达的目标，用一份"看起来完美"的手工产物都升不上去，而且原因必须是
  `backend-not-wired`**；同时钉住**反方向**（注入假后端后同一份产物必须能升上去）——
  少了那一条，一个"永远拒"的实现也能让不变量成立，那种绿是假的。
- **实测输出**：`PROOF_SPIKE {"wiredBackends":[],"firstBatchExpressible":6,"unexpressibleFirstBatch":["collinear","coplanar","pythagorean"],…}`
  —— 六类目标逐个报出"被拒的理由"，并把上一批查出的"计划点名但表达不出来"的三个也一并打出来。
- **证据**：proof 目录 **25 条**（原 22 + 3：生产默认拒 / 注入后可通 / 后端名要逐字匹配）；
  smoke **6 条**；`npm run proof:smoke -- --mode=lean` → **exit 1** 并说明"没有后端模式，
  假装有比失败更糟"。全库单测 **306 文件 / 3560 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）。
- **边界**：仍然**没有接任何后端**；要把后端加进那张名单，必须先过依赖 / 许可证 / 进程与线程边界
  的审查（做法见 [`next-phase-flag-and-dependency-review.md`](docs/acceptance/next-phase-flag-and-dependency-review.md)），
  **没有审查结论不许加**。

## 2026-10-05 —— N5 第二步：短目标**词表**，以及"计划点名的三个现在表达不出来"这个事实

- **为什么要有这张表**：证明出口最危险的失效方式不是"证不出来"，而是**把没证的东西说成证过了**。
  所以先要一个**封闭词表**：只有落在表里的目标，才允许升到 `formally_proved`。
- **新增** `packages/agent-core/src/proof/proofGoals.ts`：`ProofGoalKind`（10 种）+
  `PROOF_GOAL_SUPPORT` 矩阵 + `declaredProofGoal(obligationKind)` + `unexpressibleFirstBatchGoals()`。
  映射按**题设种类**（`DiagramObligationKind`，结构化字段）走，**不做文本关键词匹配** ——
  本项目在关键词表上吃过亏（覆盖度校对曾因关键词太宽把两个既有夹具误判成"漏声明"）。
- **一条必须记下来的事实（本批最有价值的产出）**：计划的首批清单写着"共线/共面、平行/垂直、
  等长、勾股"，而**解析层的 `DiagramObligationKind` 里根本没有共线 / 共面 / 勾股**
  （它只有 `fixedLength | equilateral | equalLength | midpoint | segmentRatio |
  planePerpendicular | dihedral | perpendicular | parallel`）。照计划的话把它们列进"支持"，
  这张表就会变成一句**没有载体的话**：永远不会有任何 goal 被分类成它。
  所以矩阵如实标注 `collinear` / `coplanar` / `pythagorean` 是"**首批里、但现在表达不出来**"，
  并把它们列成 `unexpressibleFirstBatchGoals()` —— **要么先扩解析层，要么从首批里划掉，
  这一条要一个裁决**（已写进 `docs/current-status.md` §四 F 的待裁决项）。
- **接线（fail-closed）**：`ProofExpectation` 新增**必填**的 `goalKind: ProofGoalKind | null`，
  `null` 表示"不在我们声称支持的首批里"，此时无论产物多合法都**不升级**，
  报新的机器可读码 `undeclared-goal`。刻意不做成可选参数：调用方**必须**显式回答这个问题。
  这条门放在绑定检查**之前** —— 免得报成"产物有问题、但目标本身是支持的"。
- **证据**：`proofGoals.test.ts` **5 条** + `proofArtifact.test.ts` **17 条**（原 15 + 2：
  "表外目标绝不升级"、以及"不合格产物与表外目标是两句话"）。
  **定向变异**：把 `goalKind === null` 那道门停掉 → **正好那一条红**，其余全绿。
  全库单测读数见 `docs/current-status.md` §一；`typecheck` exit 0；`lint` exit 0
  （0 error / 13 warning，与基线逐条相同）。
- **边界**：**仍然没有接任何后端**；`dihedral`（二面角）能表达但**不在首批**，所以也一律不升级。

## 2026-10-05 —— N5 开工第一步：形式证明出口的**边界**（还没有后端）

- **为什么先做这一步**：N5 的出口是"让'实例通过'‘采样'‘形式证明'严格分级"，而分级的前提是
  **一份产物到底凭什么算数**。计划 N5 的 RED 写的正是这件事：`verified_instance` / `sampled`
  **不能**变成 `formally_proved`；伪造 / 缺字段 / 版本不匹配的产物一律拒绝。
- **新增** `packages/agent-core/src/proof/proofArtifact.ts`：产物 schema
  （`version` / `claimId` / `inputHash` / `backend{name,version}` / `proof` / `result{status,detail}`）
  \+ `verifyProofArtifact` + `evidenceStatusWithProof` + `proofInputHash`。
- **两条设计决定值得单说**：
  1. **校验必须带一个 `expectation`（`claimId` + `inputHash`）** —— 只校验产物自身是不够的：
     一份"证明了**别的东西**"的合格产物可以被贴到这条 claim 上，而它看起来处处合法。
     所以没有"只看看形状就算通过"的那条路（fail-closed by construction）。
  2. **拒收不是第五种结局**：结局只有 `verified` / `failed` / `unsupported` / `timeout`
     （计划原文的四个），拒收一份产物意味着"这次没有得到证明"，所以报 `failed`，
     而**为什么拒**逐条落在 `reasons` 的机器可读 `code` 上 —— "它不是证明"与"它证明了别的东西"
     是两件事，不许混成一句。
- **输入指纹复用仓库既有的 `canonicalContentHash`**（`hashing.ts`），不另写一套散列 ——
  两套散列会在"输入到底变没变"这件事上给出两个答案。
- **证据**：`proofArtifact.test.ts` **15 条**，其中一半是反例（"什么都拒"的校验器同样能让判据成立，
  所以"合格的必须放行"也被钉住）。**定向变异一条**：把"只有 `verified` 才升级"改成"无条件升级"
  → **3 条红**，含「贴一份合格产物到别处」那条。全库单测 **304 文件 / 3544 通过 + 1 todo / 0 失败**；
  `typecheck` exit 0；`lint` exit 0（0 error / 13 warning，与基线逐条相同）。
- **边界（如实）**：**没有接任何后端** —— adapter（Lean/mathlib 或 AlphaGeometry/Newclid 风格）归后一步，
  而且计划要求它**先过依赖与许可证审查**；所以现在任何真实运行都只会得到 `unsupported`。
  另外"一份证明该绑到多细的输入上"（只绑原话？还是连坐标/文档一起绑？）**没有裁决** ——
  `documentFingerprint` 是**可选**参数，调用方必须显式说清它关心什么。

## 2026-10-05 —— N6 第七步：`test:rust` 的不稳定也**修掉了**（判别 → 排除 → 修 → 前后计数）

- **判别实验（把范围缩到一件事上）**：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
  --test secrets` —— **默认并行 15 次里红 1 次**；同一命令加 `-- --test-threads=1`：**20 次全绿**。
  所以它**需要并发**才能发生。
- **排除掉"别的用例把它删了"**：读完整份 `tests/secrets.rs` 得到的结论 —— 每个用例用各自的 profile 名
  （`SCRATCH_PROFILES` 那条等集断言钉着），`__probe__` 那条是 `#[ignore]`，
  **没有任何用例会删别人的格子**。（这就是上一轮说"根因在 OS / `keyring` 边界"之后能再往前推的一步。）
- **剩下的是什么**：所有用例共享**同一个凭据服务名**（`windows.rs` 的 `SERVICE = "MathCanvas"`，
  target 不同但服务相同），而 `keyring` 的 Windows 后端存在 `Error::Ambiguous`
  （"matched more than one entry"）这种**枚举**语义 —— 并发写/删会让另一次查找**瞬时**看不到条目。
- **修法**：`tests/secrets.rs` 里 5 处走真实凭据库的用例先取一把 `static STORE_LOCK: Mutex<()>`。
  **这不是"加重试"**：它只让**测试 harness** 不再制造一个产品里不存在的场景（产品里凭据的存/删是
  用户逐次触发的）。**它不主张"产品对并发凭据访问是安全的"** —— 那件事本文件没有测，
  也没有因为这把锁变成已测。这一点写进了代码注释。
- **证据**：加锁后 **60 次并行 `--test secrets` 全绿**（若真实故障率仍是 1/15，连绿 60 次的概率约
  **1.6%**），并且**连续 3 次全量 `test:rust` 都是 236 通过 / 0 失败**。
- **一处工具教训（留档）**：第一次跑"单线程 20 次"拿到 **20/20 失败**，险些写成"单线程必红"——
  其实是**我自己漏了 `--manifest-path`**，cargo 在仓库根找不到 `Cargo.toml`。
  **20/20 这种整齐的失败率本身就是警报**；这正是本仓那条纪律（环境错误不能算 RED）的现场例子。
- **门禁与记分卡同步**：`agent-release-gate.md` 第 1 条由"⚠️ 两条已定位、但未修复"改回
  **✅ 已守住**，并写明**两处修的都是测试侧、产品行为未变**；`agent-tool-loop-scorecard.md` 读数列同步。

## 2026-10-05 —— N6 第六步：Rust **传递依赖**的许可证扫描（那一节从"只有清单"变成"有结论"）

- **为什么要补**：`docs/acceptance/next-phase-flag-and-dependency-review.md` 的第三节原来自认
  "**只有清单，没有结论**" —— 只列了 15 个直接依赖。而"许可有没有风险"这件事，直接依赖永远是
  最不可能出问题的那一层。
- **怎么扫的**：`cargo metadata --format-version 1` 的 `packages[].license` **覆盖整张依赖图**
  （`node scripts/toolchain.mjs cargo metadata --format-version 1 --manifest-path
  apps/desktop/src-tauri/Cargo.toml`）。不需要新装任何工具。
- **实测**：**551 个包 = 1 个工作区成员 + 550 个第三方**，**33 种许可证表达式**，
  **没有一个包缺 `license` 字段**（所以不存在"许可未知"的黑洞）。
- **结论**：
  1. **没有任何 GPL / AGPL / SSPL / CDDL / EUPL**；
  2. **5 个 crate 只给 MPL-2.0** —— `cssparser@0.36.0`、`cssparser-macros@0.6.1`、`dtoa-short@0.3.5`、
     `option-ext@0.2.0`、`selectors@0.36.1`，全是 Tauri 的 CSS 选择器一侧的**传递依赖**。
     MPL-2.0 是**文件级** copyleft：链接与分发二进制允许，义务落在"被修改过的 MPL 文件"上，
     而**本项目不修改它们**；
  3. **2 个 crate 把 LGPL 列为可选项之一**（`r-efi@5.3.0` / `6.0.0` =
     `MIT OR Apache-2.0 OR LGPL-2.1-or-later`）—— 是**选择**，取 MIT/Apache 即可，**不承担 LGPL 义务**。
- **边界（写进文档，不是漏写）**：结论来自每个 crate **自己声明的 `license` 字段**；
  **没有**逐 crate 读 LICENSE 正文、**没有**做 per-crate 的 SPDX 择一解析
  （`cargo-about` / `cargo-deny` 会做）、**没有**复核 `rusqlite` 的 `bundled` SQLite 版本与声明。
  另外 `--offline` 在本机**跑不通**（registry 索引不全，exit 101）—— 这一遍**需要联网**。
- **只改文档**，无可执行产物，因此没有新的门禁读数。

## 2026-10-05 —— N6 第五步：**修掉** e2e 抖动（追到一条断言、一个机制、一处调用点）

- **先把它收敛成一条**：上一轮我记的是"两处抖动"。这一轮用固化的配方跑了 3 次全量，
  **又红 2 次，而且都在 `three-canvas-size.spec.ts:72`**；把那份 `error-context.md` 读出来之后才发现，
  它和在 `geometry3d-section.spec.ts:42` 红的那次**是同一条断言**：
  `await expect(scene).toHaveAttribute("data-preview-hovering", "true")`，实收 `"false"`。
  四次现场（含 round-12 那次硬失败）**全部是同一条**，失败那一刻场景读数也一致：
  `data-preview-count="1"`、`data-scene-syncs="5"` —— **预览在，指针却不在它上面**。
- **机制（推断，与全部证据一致）**：自动取景 `animateToFit` 约 250ms，在 rAF 里**逐帧插值整份相机状态**；
  而 `e2e/helpers/projection.ts` 的 `projectWorldPoint` **一上来就读** `data-camera-*`。
  动画没跑完时读到的是**中途**的方位角/距离，等 `mouse.move` 执行时相机又动过了 ——
  投影出来的屏幕点不再对应那个世界点，而预览的命中区只有那圈**边界虚线**，差一点就是空。
  指针事件不会再发一次，所以属性一直停在 `false`；产品侧的悬停自愈也救不回来（它按最后指针位置重算，
  而那个位置本身就是错的）。这与本仓已经修过一次的那条同类竞态是同一个东西
  （`geometry3d.spec.ts:277`：测试读了取景动画中途的读数）。
- **修法（一处，且是"单源"）**：把"等相机停稳"放进 `projectWorldPoint` **内部** ——
  判据用**连续两次相机读数一致**（不写死 sleep），与 `three-orbit-tracks.spec.ts` /
  `three-intersection-previews.spec.ts` 的 `settleCamera`、`geometry3d.spec.ts` 的 `settledTarget`
  **同一套口径**；并把画布盒子的读取挪到 settle **之后**。
  **为什么放在公共 helper 里而不是各个 spec 里**：这类坑已经咬过两次，而"每个调用点自己记得先 settle"
  正是它复发的原因。代价是每个用例第一次投影多等一次采样间隔。
- **证据（是证据，不是证明）**：修前** 6 次全量 e2e 里 4 次**红在这条断言（另 2 次全绿）；
  修后**连续 4 次全量、4 次全绿**（`186 passed`，无 flaky、无产物）。
  若真实故障率仍是 4/6，"连绿 4 次"的概率约 **1.2%**。
  **措辞纪律**：机制是**推断**出来的 —— 我**没有**直接录到"投影那一刻相机还在动"的那一帧，
  所以说的是"与全部证据一致"，不是"已证明"。
- **仍然没修的一条**：`test:rust` 的 `tests/secrets.rs:149`（`put` 成功后 `with_secret` 读回 `None`）——
  根因在 OS / `keyring` 边界，**一个字都没动**。
- **门禁与记分卡同步**：`agent-release-gate.md` 第 1 条由"两条已定位、但未修复的不稳定"改成
  "**e2e 那条已修并有前后计数**，剩下 `test:rust` 那条仍未修"；`agent-tool-loop-scorecard.md` 的读数列同步。
- **读数**：`typecheck` exit 0（含 `e2e/` 的 `tsc`）；`lint` exit 0（0 error / 13 warning，与基线逐条相同）。

## 2026-10-05 —— N6 第四步：e2e 抖动拿到了**断言现场**与**复现配方**

- **为什么值得单独一轮**：上一轮只做到"两条红定位到用例名"，而 e2e 那条连**是哪一条断言**都没拿到。
  一个"偶尔红一次、且不留证据"的门禁，下一轮还得从零开始查。
- **配方（本批真正有用的产出）**：`playwright.config.ts` 里 `retries: process.env.CI ? 2 : 0`、
  `trace: "on-first-retry"` —— **本机 retries=0，所以一次抖动什么证据都不留**。
  加上两个参数就有：
  `npm run test:e2e -- --workers=3 --retries=1 --output=test-results/flake-probe-1`
  （`--retries=1` 让 trace 生效；`--output` 指到新目录就不会被下一次运行清掉）。
  这一次就是这样拿到 `trace.zip` 与 `error-context.md` 的，报告写成 `1 flaky`、整轮 exit 0 ——
  **`flaky` 不是绿**。
- **现场，以及一处对上一轮的更正**：这次红的**不是**上一轮那条，而是
  `geometry3d-section.spec.ts:42` 第 59 行 `await expect(scene).toHaveAttribute("data-preview-hovering", "true")`，
  实收 `"false"`（5 秒轮询超时）。失败那一刻场景读数是 **`data-preview-count="1"`、`data-scene-syncs="5"`、
  `data-scene-reused="3"`** —— **预览存在**，只是"悬停"没被翻过来。
  所以 **e2e 至少有两处抖动，而且两处都是 `toHaveAttribute` 超时**：这说明它不是"某一条用例写坏了"，
  而是一类**时序**问题。（上一轮记的那条是 `three-canvas-size.spec.ts:72`。）
- **已排除的一条**：老的那条"指针先到、预览后到"已经被堵住了 —— `threeScene.tsx:307` 的 effect
  依赖里含 `previews`，它调 `runtime.syncContent()`，而那个包装（`threeSceneEffect.ts:452-459`）
  在同步之后调 `refreshPreviewHover()`，`threeScenePreviewHover.ts:137` 确实用最后指针位置重算。
  **这次的 `false` 不是那条旧路。**
- **两个还没证实的假设**（**刻意没有改代码**）：① 屏幕坐标是在布局稳定之前算的（`grabPoint()` 的
  投影与 `mouse.move` 之间画布尺寸可能不同，而预览的命中区只有那圈边界虚线）；② 预览组的几何在
  自愈那一次还没就位。这条抖动是 1/N，**"跑过一次绿"不算验证**，所以按本仓纪律：
  **证据不足之前不猜着改**。
- **文档同步**：`current-status.md` §一新增「e2e 抖动：拿到了断言现场与复现配方」一节（含两个假设与
  下一步）；`agent-release-gate.md` 的复跑清单补上抓抖动的两个参数，并写明 `flaky` 不是绿。
- **只改文档**（外加一次带产物的复跑），没有新的可执行产物；**两条不稳定都仍在**。

## 2026-10-05 —— N6 第三步：把上一轮那两条"不可复现的红"**定位到具体用例**

- **为什么值得单独做**：上一轮如实记下"e2e 与 rust 各红过一次、都没复现"，但那两条红
  悬在那里是没法处理的：既不能说"已修"，也不能说"无关"。一个**偶尔红一次、没人知道为什么**的
  发布门禁，本身就是该修的东西。
- **e2e**：又整跑了一次全量 —— **186 通过 / 0 失败**。所以现象是"两次里一次红"，
  红的是 `e2e/three-canvas-size.spec.ts:72`（"keeps the canvas size when the status text
  changes"），而那条**单独跑 3 次全过（12/12）**。**没抓到是哪一条断言**：那次的 Playwright
  产物被后续运行清掉了（`test-results/` 只剩 `.last-run.json`）。→ **负载下的不稳定，根因未定位**。
- **rust**：定位到了。上一轮那次失败的签名是"8 passed; 1 failed; 1 ignored"= 10 个用例，
  与 `tests/secrets.rs`（9 + 1 ignored）对得上；单跑 `--test secrets` **15 次里复现 1 次**，
  失败在 **`tests/secrets.rs:149` → `lends_the_secret_to_a_closure_and_nothing_else`**：
  `left: None` / `right: Some(11)` —— **`put` 成功之后 `with_secret` 立刻读回"没有这一条"**。
  后端实现（`src/secrets/windows.rs`）把 `keyring::Error::NoEntry` 映射成 `Ok(None)`、
  其余错误映射成 `Backend`，所以是**操作系统在写入成功后立即报了"没有这条凭据"**：
  **根因在 OS / `keyring` 边界，不在我们的分支里**。
- **刻意不做的事**：**没有"顺手加一次重试"**把红压下去 —— 那会把一条**真实的不稳定**藏起来，
  而这个组件是**密钥库**：它报"没有配置"时，调用方会去发一次注定 401 的请求。
  要么找到根因，要么如实留着这条记录。
- **文档同步**：`agent-release-gate.md` 第 1 条由"两条不可复现的红"改成"**两条已定位、但未修复的
  不稳定**"，并把具体用例名写进去；`agent-tool-loop-scorecard.md` 的读数列同步。
- **只改文档**（外加复跑本身），没有新的可执行产物；**两条不稳定都仍在**。

## 2026-10-05 —— N6 第二步：**串行**复跑整套门禁，并把两条不可复现的红如实记下

- **为什么要专门跑这一遍**：发布门禁文档（`docs/acceptance/agent-release-gate.md`）里的读数还是 N2 批次的
  （287 文件 / 3319 用例），而它回答的是"能不能放行"—— **一份过期的门禁读数比没有读数更危险**。
  计划的 N6 第 4 条也点名了这一整串命令。
- **这一遍是串行跑的**（不是并行）：本仓自己记过"整套 node 单测与 e2e 并行跑时，拖动那一档从
  16.8 ms 涨到 366.7 ms，那样跑出来的 e2e 不算一次有效验收"。原始读数在
  `docs/current-status.md` §一「N6 门禁复跑」。
- **两条红，都不可复现，都没有定位**（这是本批最值得留下的事实）：
  1. 全量 e2e **185 通过 / 1 失败**（`three-canvas-size.spec.ts:72`"keeps the canvas size when the
     status text changes"）—— 那条**单独跑 3 次全过**（12/12）；
  2. `test:rust` 五次里**一次有 1 条失败**—— 那次的完整输出没有留档，**失败用例名没抓到**，
     随后 4 次复跑都不复现（四次都是 236 通过 / 3 ignored / 0 失败）。
  **两条都不写成"已修"，也不写成"与本批无关"** —— 按本仓纪律"不复现就不猜着改"，
  它们是**未定位的不稳定**，这一条事实本身就该留在门禁文档里。
- **一处需要谨慎的读数**：`test:perf` 的 `drag/300-frames` 这次 **1295 ms**（≈4.3 ms/帧），
  而 2026-10-01 的读数是 **682.5 ms**（≈2.3 ms/帧）。这一次是在**跑完一整套门禁之后**测的，
  机器不是空闲状态，**不能据此断言回归** —— 要判断趋势得在空闲机器上单独复跑。
- **其余都是绿的**：`typecheck` exit 0；单测 **303 文件 / 3529 通过 + 1 todo / 0 失败**；
  `lint` exit 0（0 error / 13 warning）；`test:perf` 9/9；`eval:agent` exit 0
  （`deterministic_local`：pass@1 **4/8**、pass@3 **4/8**、tool selection **45/45**、tool error rate **3/45**
  —— 与 2026-09-29 那次逐项相同，**与模型能力无关**）；`bench:agent` exit 0
  （`cases=7 covered=5 empty=2 error=0`）。
- **发布门禁文档同步更新**（判决与读数分工）：`agent-release-gate.md` 的第 1 条由"✅ 已守住"改成
  "⚠️ **本轮复跑有两条不可复现的红**"，并补了 N3 / N4 各自"到哪一步、缺什么"的一节；
  `agent-tool-loop-scorecard.md` 把"Constraint-preserving drag"由 `design only` 改成
  **`partial (N3, flag default off)`**、"Open-ended problem compilation"改成 **`harness only (N4 step 1–2)`**，
  并把"自由度"那一句拆成**见证层（仍 `null`）**与**拖动层（一阶实数）**两件事 —— 它们回答的不是同一个问题。
- **只改文档**（外加门禁复跑本身），所以没有新的可执行产物。

## 2026-10-05 —— N4 第二步：benchmark 的**运行入口**与 `layer` 契约（跑出第一个真实读数）

- **补上了上一批留下的两件事**：
  1. **`layer` 契约**。运行记录原来只有一套结局词（见证层的 `verified_instance` / `no_witness` / …），
     而"只跑原话 → 题设的抽取"那一轮**根本没有见证结论** —— 拿见证层的词去描述抽取结果是
     **范畴错误**；而一律写 `not_measured` 又会把"跑了抽取、只是没跑求解"说成"什么都没测"。
     两者都会让报告**读起来是绿的、实际什么都没说**。现在运行记录分 `extraction` / `witness`
     两层，**每层有自己的词表**，跨层用词会被**拒绝**。
  2. **`runner.mjs` + `run.test.ts`**：与 `scripts/agent-eval.mjs` **同一条纪律** —— 这个仓库刻意
     没有 TS 运行器，所以真正的运行放在 `.test.ts` 里（只有 vitest 能 import 工作区的 TS 源码，
     `@draw/agent-core` 的 `exports` 直接指向 `./src/index.ts`），`runner.mjs` 只把命令接上来、
     **把退出码如实传出去**。新增 `npm run bench:agent`。
- **第一个真实读数**（本机实测）：`BENCHMARK_COVERAGE cases=7 covered=5 empty=2 error=0` ——
  抽取层在七类起步题集上覆盖了 5 道，**2 道一条子句都没抽出来**。这是**读数不是门禁**：
  我刻意没有把任何阈值钉成断言（把今天的读数钉死，等于让明天必须犯同样的错）。
- **`real_provider` 仍然整批 `not_measured`**（`measured: 0` / `notMeasured: 7`）：适配器还没写。
  `provider` / `model` 写 `null` 是**被允许**的（那正是"这一轮没有真实 provider 参与"的诚实写法），
  而**只要不写 `not_measured`，两者就必须是非空字符串**。没有凭据时编一个模型名字，
  等于把"没测"说成"测过了"。
- **三条用法都实测过**：`npm run bench:agent`（exit 0，打印报告与覆盖率）、
  `-- --mode=real_provider`（exit 0，measured 0 / notMeasured 7）、`--mode=nonsense`
  （**exit 1** 并打出可选项 —— "一个永远退 0 的测量命令会被当成测过了"）。
- **证据**：`scripts/agent-benchmark` 共 **33 条**通过（校验器 27 + 运行入口 6）；
  全库单测 **303 文件 / 3529 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）。
- **边界（如实）**：**一个真实 provider 都没跑**；题集只有七类各一条（离"基线"还很远）；
  `run.test.ts` 现在落进默认 glob，所以 `npm test` 也会打印报告 —— 那是**有意**的
  （与既有的 `agentEvalReport.test.ts` 同一条口径）。**没有按题归因那 2 道"抽不出子句"的是哪两道**，
  这是下一步。

## 2026-10-05 —— N6 第一步：五个开关的覆盖矩阵 + 依赖 / 许可证审查

- **为什么先做这个**：N6 是"把前五阶段的能力安全地从实验变成可发布能力"，它的前置事实是：
  这五个开关**到底有没有被覆盖**、依赖里**有没有许可风险**。这两件事不需要任何决定，只需要去查 ——
  查完才知道 N6 还差什么。
- **新增** `docs/acceptance/next-phase-flag-and-dependency-review.md`，逐格写实测：
  - **五个开关**：三个已实现的（`obligationIR` / `witnessSearch` / `constrainedDrag`）都有
    "关闭回退"的证据，其中 `witnessSearch` 最硬 —— `planCompiler.offPath.golden.test.ts` 断言
    关闭时**逐字节相同**；**五个都没有浏览器用例**；`openProblemCompiler` / `proofExport` 是
    **占位**（只有开关表与默认值，**没有任何读取点** —— 那是刻意的，N6 不该给占位开关补用例）。
  - **JS 运行依赖逐个读过 `license` 字段**（版本是实测装到的）：`three` / `react` / `react-dom` /
    `zustand` / `pdf-lib` / `robust-predicates` / `@tauri-apps/api` / `@vitejs/plugin-react` ——
    全是 MIT / Apache-2.0 / Unlicense，**没有 copyleft**。
  - **没有任何 WASM 依赖**（实测：所有非 `node_modules` 的 `package.json` 里依赖名中不含
    `wasm` / `z3` / `solver`）；N2 的后端 spike 刻意**没有**给任何 `package.json` 加依赖。
- **顺手查出两处依赖归位问题（未修）**：`apps/web` 把 `@vitejs/plugin-react` 列在 `dependencies`
  （构建期插件应在 `devDependencies`）；根 `package.json` 有一个多余的 `three`。
  **没有改**：动依赖牵动 `package-lock.json` 与安装结果，要单独一批验证，不塞进审查里顺手做。
- **这一份明确**没有**回答的**（写在文档第六节，不是漏写）：Rust **传递**依赖的许可证扫描
  （需要 `cargo-deny` 之类，本机没跑 —— 所以那一节**只是清单，不是结论**）；并发正确性专项；
  三个开关的浏览器用例；依赖体积与供应链（postinstall、lock 完整性）。
- **只改文档**，无可执行产物，因此没有新的门禁读数。

## 2026-10-05 —— N4 第一步：真实 provider benchmark 的**题集与报告契约**（还没有跑任何 provider）

- **为什么先做这个**：这个项目里被反复提起、又始终没有的一次测量，就是"真实 provider 在开放题上
  到底行不行"。而在那之前必须先有**一份不许自欺的载体**：题集长什么样、一轮运行必须记下什么、
  报告怎么把"离线确定性回归"与"真实模型"分开。计划 N4 的原文也是"先有 schema，才准动提示词"。
- **新增** `scripts/agent-benchmark/`：
  - `dataset.schema.json` + `dataset.ts`（JSONL 题集的 schema 与校验器）—— **类别清单、必需字段、
    允许的 workspace 全部从 schema 文件读**，不在代码里再写一遍：两处各写一份必然分叉，而分叉的
    表现是"schema 说合法、校验器说非法"。
  - `redaction.ts`（凭据检查）—— 题集是从**真实报障原话**长出来的，贴原话时顺手把 key 一起贴进来
    是最常见的泄漏方式。题集解析与报告生成**两道口子都查**，命中就**抛**（返回布尔值一定会有人
    忘记检查）。只认结构明确的几种形状，不做熵估计（熵估计会把普通十六进制 id 误判成密钥，
    而"合法题集跑不了"比漏判更常见）。
  - `report.ts`（运行记录与报告）—— 三条硬规矩：**必需字段必须"在"**（"没测"写成显式 `null`，
    不是把这个键删掉：删掉之后"没测"与"忘了写"长得一模一样）、**模式必须标识**、
    **claim 必须有证据**（唯一例外是 `not_measured` —— 逼它给证据等于逼它编）。
  - `cases.jsonl` —— 七类各一条的起步题集（欠定 / 矛盾 / 未支持表达式 / 点名打乱 / 二面角 /
    动态请求 / 普遍性请求）。
- **一处刻意的口径**：计划原文写"必须含 `provider` / `model`"，而 `deterministic_local` **本来就没有
  provider**。所以口径是**键必须在、值可以是 `null`**；`real_provider` 模式下两者必须是非空字符串。
  既没有编造一个 provider 名字，也没有把两种模式混进一张表（混报等于拿离线回归冒充模型准确率）。
- **证据**：**24 条**用例，**成对写** —— 每条"必须失败"旁边都有一条"合法输入不许被判失败"。
  校验器最容易犯的错不是漏报，而是把合法输入拒掉（那样 benchmark 跑不起来，而"跑不起来"会被
  误读成"没有数据"）。**定向变异两条**：停掉"模式必须标识"与"claim 必须有证据" → 对应的两条
  用例分别变红。全库单测 **302 文件 / 3520 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）。
- **边界（如实）**：**一个真实 provider 都没跑**，报告里没有任何 pass@1 / 成本 / 延迟数字 ——
  计划要求的"先跑小样本真实 provider"是**下一步**；`runner.mjs` 也还没写。
  这一批交付的是**载体与判据**，不是测量结果。另外 `scripts/nodeTypes.d.ts` 按仓库既有的
  "只声明真的用到的"纪律补了一条 `readFileSync`（不装 `@types/node`）。
- **一处与计划原文的偏差（有据）**：计划写的是 `runner.mjs` / `redaction.mjs` / `report.mjs`，
  实际写成 `.ts`。理由：`scripts/tsconfig.json` 的 `allowJs` 是 `false`，`.mjs` **根本不过 `tsc`**，
  而 `.test.ts` 去 import `.mjs` 会要求手写声明（那就是第二份 API，会漂移）。写成 `.ts` 之后
  校验器本身也过门禁；Node 24 可直接执行 `.ts`，所以将来的 node 入口仍然做得到。

## 2026-10-05 —— N3 第四步：把"没能同时满足"与"本身不可能成立"分开（可证的矛盾）

- **为什么必须有这一层**：顺序投影在矛盾约束上会**来回振荡**（长度 2 与长度 3 把同一个点沿
  同一根轴反复拽），求解层停下来时只能说"在轮数内没能同时满足"。那是诚实的，但它把
  "我还不知道"（可能只是投影没收敛）与"我知道它不成立"压成了同一句话。
- **新增** `findConstraintContradictions`（内核 `constraints3d.ts`），**只报能证明的两种**：
  1. 同一条线段被要求等于两个不同的长度 —— 按**无序点对**归组，所以 `["a","q"]` 与 `["q","a"]`
     算同一条线段；
  2. 点既在线上、又在平面上，而这条线与这个平面**平行且不相交**。
- **四种"看起来像矛盾、其实能解"的必须放过**（这一半用例比正例更重要）：直线**落在**平面里
  （交集就是整条线）、直线与平面**相交**（交点就是唯一解）、同一个长度写两遍（那是**冗余**）、
  不同线段各自的长度要求。
- **接线**：投影结果新增 `contradictions`；`planConstrainedDrag3` 的拒绝文案**先**说矛盾
  （"这些约束本身不可能同时成立"），再退回到"没能同时满足（还在动，这不等于'无解'）"。
  两句话不许混用 —— 前者是**证明过**的结论。
- **边界（如实）**：**直线 ∥ 直线不相交**这类**还没有判据** —— 顺序投影在它上面照样振荡，
  所以只能说"没能同时满足"。这留了一条**守门用例**：哪天内核把它也算成可证矛盾，那条会红，
  届时是**改用例**、而不是悄悄改文案。
- **证据**：内核 7 条新用例（3 正 4 反）+ 接线层 1 条；**三个定向变异**：
  ① 把"值不一样才算矛盾"改成永远算 → **反例**红（过度报告那一侧的危害）；
  ② 拿掉"直线落在平面里"那道守卫 → 对应反例红；
  ③ 整个检测停掉 → **四条正例全红**（含接线层那条）。
  全库单测 **301 文件 / 3496 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）。
- **边界**：`constrainedDrag` 开关仍默认关着，**产品行为与上一版完全相同**。

## 2026-10-05 —— N3 第三步：拖动接线的决策层（`constrainedDrag` 第一次有了读取点）

- **做成了什么**：新增 `apps/web/src/constrainedDrag3.ts`（纯函数 `planConstrainedDrag3`）并把
  `App.tsx` 的 3D 拖动抬手接上它。拖动不再无条件写一次整体平移，而是先问"这一次拖动能不能在
  满足已声明约束的前提下落下去"。
- **被拖点是"暖启动"，不是硬锚**（这一条决定功能可不可用）：先把它放到"原位置 + delta"，
  再让投影把它**连同别的点**拉回约束上 —— 所以它可能**贴回约束、不在指针正下方**。
  若改成硬锚，"拖一个被约束在平面上的点"会 **100% 被拒**（这个点自己就违反了它自己的约束），
  等于把功能做死。设计 §B 的原话本来就是"拖动点**接近**指针"。
- **四种出口，不压成一个布尔值**：`passthrough`（开关关着 / 非空间点 / 绑定点 / 锁定 /
  没有空间约束 → **逐字走原来那一次 `apply({ op: "translatePrimitive3", id, delta })`**）、
  `noop`（约束把这次拖动完全抵消 → **不提交空事务**）、`refused`（拖到这里满足不了 →
  **一个坐标都不写**，并说清是哪条约束）、`commit`（**一次** `applyBatch`）。
- **"一步撤销"是白拿的**：接线前先裁决了上一批留下的前置问题 —— `applyBatch` 走
  `commitTransaction`，而 op 工厂 `patchPoint3(id, position)` **早就存在**，所以
  "一次改多个点坐标"**不需要新 op**，一次事务就是一步撤销。
- **顺带**：内核导出 `isPlanarOnlyConstraint3`，让接线层把"不参与 3D 求解的平面约束"挑出来说
  的时候不必把那份词表再抄一遍。`constrainedDrag` 这个开关**第一次有了读取点**（此前是占位）。
- **如实不声称的**：`inconsistent` / `timeout` 仍然不报（矛盾约束只会振荡，本层只说"没能同时
  满足"）；非 `point3` 的被拖对象、绑定点、锁定对象一律交回旧路径；`onHostDragEnd`
  （提交宿主参数的那条路）**一行未动**。
- **证据**：新增 `constrainedDrag3.test.ts` **11 条**，其中两条是**行为上的关键判据** ——
  沿平面法向拖一个被约束在平面上的点 → `noop`；斜着拖 → `commit` 且它**贴回平面**。
  全库单测 **301 文件 / 3488 通过 + 1 todo / 0 失败**；`typecheck` exit 0；
  `lint` exit 0（0 error / 13 warning，与基线逐条相同）；3D 拖动 / 创建两个 spec 的浏览器回归
  **19 通过 / 0 失败**（含"一次自由拖动只撤销一步"与"拖动实体不转相机"—— 这两条正好钉住
  "开关关着时旧路径没变"）。
- **边界（重要，别读错）**：**开关默认仍然关着**（`agentNextPhaseFlags()` 恒返回五关），
  所以**产品行为与上一版完全相同** —— 这一批是"路修好了、闸门还没开"。
  也**还没有浏览器用例**（`e2e/agent-constrained-drag.spec.ts` 不存在），因为目前**没有任何
  产品入口**能把 `constrainedDrag` 打开；计划里 N3 的出口要求 `constrainedDrag=true` 的浏览器
  正/反例，那一项**未达成**。

## 2026-10-05 —— N3 第二步：拖动层的**自由度与冗余诊断**（欠约束看得见、过约束分得清）

- **做出了 N3 四条 RED 里的两条**：`projectPoint3Constraints` 的结果新增 `analysis` —— 在**最终构型**上对可动坐标做数值雅可比、算秩，于是"还剩多少自由度"（欠约束）与"约束有没有冗余"（过约束）都成了可读的数，而不是靠猜。
- **冗余的定义是"秩"，不是"条数"**：把同一条定长约束写两遍，秩仍是 1（不是 2）、第二条如实进 `redundantConstraintIds`。按条数算会同时给出"自由度少 1"与"过约束"两个错数 —— `constraintIR.test.ts` 早有一条用例盯着这件事，本批把它变成两边共用的实现。
- **消灭一处真重复（跨包）**：`agent-core/src/constraintIR.ts` 里的 `rankOf`（Gram–Schmidt）搬到内核 `linear-algebra.ts` 的 `rankRows`，`constraintIR` 改为调用。理由：拖动层要算的是同一件事，两处各写一份就会出现"同一组几何、两个不同的秩"。`agent-core` 的既有用例现在**走的是内核这一份实现**。
- **三处"看起来一样、其实不一样"的分开写清楚**（每一处都有一条例外用例钉着）：
  1. `redundantConstraintIds`（重复/能推出）与 `unaffectedConstraintIds`（雅可比那一行恒为零：对任何可动坐标都不敏感）分开 —— 混在一起会让一份完全正常的文档被读成"过约束"；
  2. 判据是"**行是不是零**"，不是"点名里有没有可动点"：`pointOnPlane(p, 平面)` 里 `p` 被锚住、而平面的定义点仍可动时，行是**非零**的（挪定义点会改变平面）。第一版测试就是在这里写错了预期，按实测改正；
  3. 本读数与 `agent-core` 的 `reportFreeDegrees` **不是同一个问题**，不许合并：那个按**绑定**算可动轴、并**扣掉**整体平移/旋转（问"形状定了没有"）；拖动层按 `anchoredPointIds` 算、**不扣**规范自由度（问"拖动时还有几个坐标能变"）。共用的是秩本身。
- **不声称的事（如实）**：矛盾约束在顺序投影下会**振荡**，表现为 `exhausted` + `unsatisfiedConstraintIds`；本层**不**把它判成 `inconsistent`（"无解"需要可证的冲突检测，本层没有）。残差取绝对值的地方在**恰好满足**时是非光滑点，前向差分给无符号梯度 —— 所以"同一线段两个不同的长度要求"会算成 2 条独立约束；这不是缺陷，它们本来就不该叫冗余，而是矛盾。
- **证据**：`constraints3dProjection.test.ts` 13 → **20 条**（新增 7 条钉分析语义），新建 `linear-algebra.test.ts` **8 条**钉秩本身；**定向变异两条**：① 把 `rankRows` 的"秩"换成"行数" → 9 条变红，**包括 `agent-core/constraintIR.test.ts` 那条重复约束用例**（跨包证明共用生效）；② `movableAxes` 忽略 `anchoredPointIds` → 分析里 2 条变红。全库单测读数见 `docs/current-status.md` §一；`typecheck` exit 0；`lint` exit 0（0 error / 13 warning）。
- **边界（如实）**：**仍然没有任何产品调用点** —— `analysis` 与投影都还没有消费者，拖动、重算、保存、Agent 一行未动，产品行为与上一版完全相同；N3 的出口仍未达成。

## 2026-10-05 —— N3 开工：3D 约束的点投影（内核砖；**未接线，产品行为零变化**）

- **为什么先做这一块**：N3 的出口是"拖动点不静默破坏已确认的题设"。而内核现有的
  `solvePoint3Constraints` 契约明写"**只诊断、绝不动点**"（还有一条用例钉着它）—— 它回答
  "现在差多少"，回答不了"该挪到哪"，而拖动要的正是后者。这两件事合成一个函数，
  结果就是"只想量一下"的调用方被顺手改了几何。
- **新增** `packages/geometry-kernel/src/constraints3dProjection.ts`：
  `projectPoint3Constraints(primitives, constraints, options)` —— 顺序投影（Gauss–Seidel 式，
  与 2D 的 `solveLineConstraints` 同一个思路），这一版支持 `pointOnLine` / `pointOnPlane` /
  `collinear` / `coplanar` / `fixedDistance` 五种；带 `anchoredPointIds`（拖动时用户抓住的点、
  被锁定宿主牵住的点——不许动）。**没有时钟、没有 RNG**：同一份输入必然给同一份输出，
  拖动才可能可撤销、可重放。
- **结果口径是 fail-closed 的**：`satisfied` 要求**每一条**约束都被判过且在容差内，
  `skipped` 非空时恒为 `false`；`exhausted` 单独表示"次数用完还没到定点"（半成品）。
  两个布尔值分开，是因为"停下了但没满足"与"还没跑完"是两件事 —— 合成一个会让上层门禁读错。
- **如实跳过的几类**（各有机器可读 code，绝不写成"已满足"）：`parallel` / `perpendicular` 的
  **线状写法**要动就必须先决定旋转哪一侧的点 —— 那是产品判断不是数学结论，进
  `no-projection-rule`；`coincident` 是平面约束、内核没有空间判据，进 `planar-only`；
  几何退化（方向为零、三点共线、两点重合还要求非零距离）进 `no-judge`；牵涉的点全被锚住进
  `no-movable-point`。
- **顺带的两处重构**（都在 `constraints3d.ts`，都是"同一个判断不许写两遍"）：抽出 `planeOrigin`
  （原先内联在 `pointPlaneResidual` 里，投影要用同一份"平面上的点是哪一个"的读法），
  并导出 `isLineLike3`（原先那段 `["line3","segment3",…].includes(type)` 要被抄第二遍）。
- **证据**：新增 `constraints3dProjection.test.ts` **13 条**；**先红后绿**（RED = 模块不存在，
  `Test Files 1 failed / no tests`）。**定向变异两条**：① 把 `projectPointOntoLine3` 改成原样
  返回 → pointOnLine 那两条用例变红；② 拿掉"已经满足就早退"那一行 → "本来就满足的约束不会被
  改动，也不算跳过"变红（它会掉进投影分支而报 `no-projection-rule`）。
  全库单测 **299 文件 / 3462 通过 + 1 todo / 0 失败**（比 N2 批次多 1 个文件 / 13 条，正是本批新增）；
  `typecheck` exit 0；`lint` exit 0（**0 error / 13 warning**，与基线逐条相同）。
- **边界（如实）**：**没有接进拖动管线** —— `apps/web` 的 `threeScene*`、`scene-graph` 的约束事务
  与 undo/redo **一行未动**，所以**产品行为与上一版完全相同**；`constraintIR.reportFreeDegrees`
  也尚未与这里合流（自由度还是它自己那份算）。N3 的出口（浏览器里拖动保持约束、过约束拒绝、
  一步撤销）**尚未达成**，本批只是它的第一块内核砖。

## 2026-10-05 —— N2 解析见证构造 + 有界见证搜索 + 默认关闭的接线

- **N2a 内核（`packages/geometry-kernel/src/witness/`）**：题面点名 + 关系（**无显式坐标**）时的解析候选构造 —— 棱锥（三/四边底面、垂足正上方、高由示例值/给定值/**点名侧棱长度**/点名二面角四种来源）与棱柱（底面 + 拉伸向量）；面环按规则生成后由**内核自己的判据**归一化成朝外；拒绝一律是带**机器可读 code** 的值（12 个），从不抛异常。提交 `c2314c9` / `1328088` / `84a6d89` / `e3fdb61`。
- **N2b 搜索编排（`packages/agent-core/src/solver/`）**：`searchWitness` 按 **seed / 候选上限 / 预算**编排候选，解析构造优先、有界确定性网格兜底（只扫构造器已暴露的自由标量）；每个候选都经**与产品同一条**物化与核验路径（`buildFromPoints` → `compilePlan` → `verifyDiagramObligations`），**只有 `passed` 才可能是 `verified_instance`**。`selectWitness` 降为 facade，polyhedron 的筛选/排序逻辑**只此一份**。提交 `8648a13` / `8b70fa1` / `b6a1388` / `ab05add`。
- **N2c 接线（默认关闭）**：`witnessSearch` 开关由应用层持有、缺省关，逐跳 `=== true` 才生效，并穿过 Worker 边界。语义三条：**只救不抢**（模型坐标本来就合格时不搜）、**生成物必须再走一遍同一个 verifier**、**没有候选不产生草稿**。提交 `ca1d0b2` / `2f3dd45` / `9c5ae2f`。
- **真缺陷（复核发现，全部带回归）**：① 搜索器曾用 `unverified: []` 把题设"洗白"后再判，等于**精确关掉**解析器故意留下的那道守卫，于是能对产品会判未核验的题面报 `verified_instance`（RED 实证）；改为传 N1 的 `ObligationIR`，把 residue 与自由点一并交给核验器。② 2D 点自由度按"有没有绑定"而非**绑定种类**判（线上点报 3），与文件头契约矛盾；改为按 `free=2 / onPath=1 / derived=0`。③ **两个新引入的模块环**：`parameterAudit → underdetermined → witnessSearch → planCompiler → parameterAudit` 已用叶子模块切断；`planCompiler ↔ solver/witnessSearch` 是有意保留并记录的，断法（给搜索器注入物化端口）归 N3。④ 二面角求高的"歧义保障"**两版都是空操作**（内核内角由**形心**方向算，与环绕向/参数顺序无关），已删除并改成如实表述；"高由二面角求出"如实写成**有界求根**而非解析闭式。
- **后端可行性 spike（R14：不加依赖、不接产品）**：独立脚本 `scripts/witness-search-backend-spike.mjs`，原始输出留在工作区 `spike-z3-raw.json`。实测：npm `z3-solver`（WASM）MIT、安装 35,962,287 B（wasm 34,938,413 B）、初始化 160 ms、首次非线性检查 322 ms、1 ms 预算下 `unknown` @680 ms、NLSAT 14 ms、**同步调用阻塞调用方 28 ms**；PyPI `z3-solver`（原生 libz3）MIT、41,035,922 B、import 329.8 ms、首次 6.9 ms、NLSAT 0.73 ms、阻塞 5.6 ms。**`not_measured`（附原因）**：Z3 自身的 `threads` 并行、浏览器内 WASM、内存占用、`z3` CLI（本机不存在）。**没有给任何 package.json 增加依赖**。
- **与计划原文的偏差（已裁决）**：入参由裸 `GeometryObligation[]` 改为 `ObligationIR`；接线多改 `committerAdapter` + `agentRuntime` 两处（协调器是生产主路，此前**一个开关都不传**，不加则任何 flag 在生产上都是装饰，顺带使 N1 的 `obligationIR` 在主路上第一次真正生效）；新增 `materialisedActions`（救援替换坐标后，草稿层的独立复验必须用实际被物化的那份计划）；`degreesOfFreedom` 保持 `null`（窄豁免：`ConstraintType` 无法表达线⊥面与角度，硬映射只会给出看不出漏项的偏大数字，归 N3）。
- **门禁**（控制器在 `9c5ae2f` 上复跑，非采信实施者）：全库 **298 文件 / 3449 通过 + 1 todo / 0 失败**（329 s）、`typecheck` exit 0、`lint` exit 0（**0 error / 13 warning**，与基线逐条相同）。**关闭 flag 时编译结果与 `4707b64` 逐字节相同**，由一条对着基线采的 golden 钉住（6 输入 × 2 种生产形状；golden 由 BASE 实现本身跑出）。

## 2026-10-05 —— N1 统一数学状态 IR 与自由度诊断（在默认关闭的 flag 之后）

- 新增 `packages/agent-core/src/obligationIR.ts`（题设/目标/自由选择的统一状态，与旧结构双向兼容且有无损断言）、`constraintIR.ts`（`reportFreeDegrees`：逐对象自由度、约束残差、冲突集合与未支持集合）、`claimEvidence.ts`（证据状态词表 + 候选结果 → 证据状态的显式映射），以及 `apps/web/src/agent/featureFlags.ts`（五个开关，**默认全部关闭**）。
- **兼容契约**：`parseDiagramObligations` / `DiagramObligationSet` 未改；`verifyDiagramObligations(set, plan, candidate, base?)` 前四个形参逐字未动，IR 经可选尾参与兼容适配层接入。`obligationIR` 缺省为**关**，关闭时报告形状与 `b1ee3d3` 逐字相同（有用例钉住键集合），且开关由**应用层**持有、随既有编译入参穿过 Worker 边界。
- **三个真缺陷**（复核发现，全部带回归）：① `no_witness` 曾被映射成证据状态 `failed`（把"我还不知道"说成"我知道它不是"），改为 `unknown`，冲突结论留给 N2 的 solver 报 `inconsistent`；② 受约束点的自由度按"有无绑定"而非绑定**种类**计（线上点报 3，与文件头契约的 1 矛盾），已按 `free=2 / onPath=1 / derived=0` 修正，2D 与 3D 两组用例经变异证明互不掩盖；③ 生产 Worker 策略（`createWorkerCompileStrategy`）不转发开关，使开关在真实应用里**永不生效**，已补转发并让**真实策略**驱动跨线程用例，`agentNextPhaseFlags()` 由此有了生产调用点。
- **门禁**（控制器在 `f997b3f` 上复跑，非采信实施者）：全库 **292 文件 / 3362 通过 + 1 todo / 0 失败**（439 s）、`typecheck` exit 0、`lint` exit 0（**0 error / 13 warning**，与基线逐条相同）。
- **本批不改变默认行为、也不新增可判定的题型**：题设覆盖面、确认门禁与用户可见文案未变；真实 provider 准确率、求解器状态机与拖动保持关系仍未测。

## 2026-10-04 —— 文档一致性审查（Git 元数据时间戳：2026-10-05 01:48:36 +08:00）：统一当前基线与下一阶段路线

- 对 README、当前状态、功能目录、项目进度归档、CHANGELOG、发布门禁、Agent 评测记分卡和研究进度做了统一审查。
- 当前代码基线固定为 `b1ee3d3`，上一轮文档路线提交为 `9fb64e0`；当前门禁读数以 `docs/current-status.md` §一为准，历史文档中的旧数字保留为历史记录，不再作为当前状态。
- README 现在链接完整下一阶段 N1–N6 路线：统一数学 IR、约束/非线性求解、动态拖动保持、开放题编译与真实 provider 评测、形式证明出口。
- 修正了当前状态中把“修复前问题”与“当前未完成任务”混在一起的表述，明确真实 provider、用户走查和 MSI 验收仍未完成。

## 2026-10-04 —— 下一阶段完整路线设计：把四条暂缓主线纳入实施计划

- 在 `b1ee3d3` 的静态示意图核验之上，补充了四条未来主线：统一 Obligation/Constraint/Claim IR；约束与非线性求解；动态拖动保持关系；开放题编译与真实 provider benchmark；以及形式证明出口。
- GitHub 调研参考了 SolveSpace 的自由度/冲突求解状态、FreeCAD 的参数化与几何内核分层、Z3 的非线性求解器边界、AlphaGeometry/Newclid 的几何证明分层、mathlib4/Lean 的形式化证明边界。
- **本条只记录设计，不代表任何暂缓能力已实现。** 具体设计与实施顺序见：
  - `docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`
  - `docs/superpowers/plans/2026-10-04-agent-full-next-phase-implementation-plan.md`
  - `docs/research/2026-10-04-github-project-survey.md`

## 2026-10-04 —— b1ee3d3：欠定立体示意图的题设核验与下一轮升级设计

- 本轮已推送 `b1ee3d3`：系统从用户原话建立题设清单，在候选多面体的实际坐标上核验定长、等长、等边、中点、分点比例、线面/面面关系和内二面角；未知写法、缺点名、退化和过期证据不再静默放行。
- 欠定图形按产品口径处理为“一组符合题设的示意图”：自由点示例值可见，不能称唯一图或普遍证明；宿主同意凭据也对未核验草稿 fail-closed。
- 新增离线四棱锥正/反浏览器验收、Worker/同步报告等价、多轮草稿回归和题设覆盖反例；最终读数见 `docs/current-status.md` §一。
- 下一轮只做规划，不宣称已实现：建立 Obligation IR、受支持题型的确定性见证搜索、冲突分类和真实 provider benchmark。设计与计划见：
  - `docs/superpowers/specs/2026-10-04-agent-next-round-witness-search-design.md`
  - `docs/superpowers/plans/2026-10-04-agent-next-round-witness-search-implementation-plan.md`
- 外部调研仅作为设计参考：GeoGebra 的动态几何产品分层、FreeCAD 的参数化/历史/内核分离、mathlib4 的形式证明边界；没有把外部项目代码或能力计入本仓库完成度。

## 2026-10-04 —— Agent 能画出立体了；但**错图会静默通过全部门禁**（用户现场确认）

- **为什么值得单列一条**：这是这一版**最重要的事实**，而且是一条**负面**事实。用户在现场第一次看到图
  （六轮真实运行之后），同时确认：**"图画出来了，明显画错了"** —— 而系统一路没有报任何错误。
- **做成了什么**：用户那条"A 字句只有关系、没有数值"的立体题面，从**画不出来**推进到**能画出来**。
  过程中推翻了两个自己的设计（见下），并修掉一批**真实运行**暴露的形式障碍。
- **⚠️ 暴露的问题（比上面那条更重要）**：模型对三棱锥那道题给出的坐标，实测 `OA · CD = −0.314 ≠ 0`
  —— **第（1）问要证的那件事本身不成立**；且 `A` 的高度取 0.64，而"二面角 45°"要求约 1.33（差约一倍）。
  那道题的七条条件里，机器**真正核验过的只有一条**（`O 为 BD 中点`）。**一张错图静默通过了全部门禁。**
  完整清单与修法方向见 [`docs/current-status.md`](docs/current-status.md) §四「当前最严重的问题」。
- **必须记住的教训**：这一版之前所有门禁都是**绿的**（282 文件 / 3277 通过），
  **而没有任何一条能发现这张图是错的** —— 因为判据里根本没有"等边""比例""二面角"这些条件。
  **"门禁全绿"不等于"结果正确"**，两者之间隔着一个"我们到底在验什么"。
- **被真实运行推翻的两个设计（都留档）**：
  1. **"要求模型声明 `relations`"**：模型两次都没给，即使系统明确要求它改 `envelope.relations`、
     并逐条列出缺 `perpendicular` 与 `parallel`，它只是把同一份计划又发了一遍。那条覆盖度门禁于是成了
     **模型满足不了的关卡** —— 几何正确的计划因"没有自证"被判失败。**质量门禁不能依赖被测方主动配合。**
     改为**方案 C：系统自己从原话抽关系**（`relationExtraction.ts`）。
  2. **"顶点顺序按题面点名顺序"**：这是个**会静默出错**的假设（模型一打乱，判据就指错顶点，
     报出来却像几何错）。改为让模型用可选的 `vertexNames` 说出来。
- **顺手修掉的形式障碍（每条都有真实运行的错误原文）**：
  - 信封样板字段：`schemaVersion` / `factIds` / `kind` 改为可推断，`goal` 与 `actions` 仍必填
    （模型连续四次在不同样板字段上翻车，而要求 `factIds: []` 这种零信息字段必须出现，收益为零）。
  - 平面动作带 `z` 会被传输层直接拒：提示词里写明**后果**（"整份计划作废"），旧文案只说"会得到平面对象"。
  - **面环绕向不一致由系统机械修正**：绕向由面环集合**唯一决定**（自洽解 + 用有向体积定朝外），
    不该卡住一份几何正确的实体；共面 / 自交 / 零体积这些**真**几何问题照旧拒。
  - 空 `relations` 数组 = 没声明（与 `assumptions` / `factIds` 同口径）。
  - 修复提示按**错误签名**给下一步，并在信封失败时点名"缺了哪个键"。
- **当次读数**：全库单测 **282 文件 / 3277 通过 + 1 todo / 0 失败**；`agent-core` / `scene-graph` /
  `apps/web` typecheck 均 exit 0；`eslint` exit 0；桌面端已重建并多次实测启动成功
  （真窗口句柄 + 标题 `MathCanvas` + `Responding=True`）。
  **这些读数与"图对不对"无关** —— 见上面的教训。
- **状态**：已在 `main` 上，**未打包、未发布**。

## 2026-10-03 —— 欠定图形的见证生成与关系核验（只有关系、没有数值的立体题面）

- **为什么值得单列一条**：这是**用户现场报障**。「在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD」这类题面**一个数字都没有**，而过去提示词里两条规则把两条路同时堵死——"澄清（信息不足时用它，不要编数值）"禁止编数值，"## 先做，别反问"禁止反问——于是模型没有正确出口，这类题**根本画不出来**。
- **改了什么**：
  - **计划信封新增可选 `relations` 表**（`contracts.ts` / `schemas.ts`）。信封走严格白名单，所以实测确认过：这个字段**原本是被拒的**（`unknown_field@envelope.relations`），改动只放行**这一个具名字段**，白名单不整体放宽。
  - **关系判据的唯一真源**：新模块 `packages/agent-core/src/relations.ts`。坐标版（因为要在草稿物化**之前**判定），与内核 `constraints3d.ts` 的残差**逐式相同**，并有一条**同源核对用例**把"同一组几何、两处判定一致"钉住——防的是"两套容差"这种最难查的分叉。
  - **覆盖度校对**：原话里出现「垂直/平行/共面/中点/等长/之比」而计划**既不声明、也没有用构造表达**时拒绝。只查漏、不查多；关键词刻意收窄（去掉「角」「裸比」「相等」等噪声词——实测它们会把两个既有夹具误判成漏声明）。
  - **接进 `planCompiler`**：与 `validateGeometry` 同类，stage 用 `geometry_validation`，失败产出诊断 + 既有的一次性修复请求（`relation_not_satisfied` / `relation_not_declared`）。
  - **多面体见证族**（`underdetermined.ts`）：`WitnessKind` 加 `polyhedron`，候选由模型给出、系统按规格 §6.3 的优先级筛选（先验题面关系、再验内核几何合法性），跳过的候选记进既有的 `considered`。**本批没有产品调用点**（`selectWitness` 只被 `parameterAudit` 以 triangle/prism 调用），价值在于为第二批留接口——已在计划里如实裁定，不许算进本批收益。
  - **提示词 v7**：把冲突解成三种情形（① 固定图形只缺数值 → 给满足全部关系的坐标见证 + 每个自选的数写进 `assumptions`；② 任意/恒定/定值 → **保留符号参数，这条一字未动**；③ 关系无法同时满足 → 才反问），并补「relations 表怎么写」一节。同时补上一个**功能性缺口**：`plan_set_plan` 的工具 schema 里原本**没有** `relations`，模型根本发不出来。
- **实测抓到的一个真缺陷（本轮最值得留下的一条）**：关系核验接进编译器后，**7 条编译器用例全绿**，但走真实运行时**100% 失败**（报 `relation_not_declared`）。根因是 `coordinator → committer → draftStore` 这条链上有两处按 `actions` **重造信封**、重造时没带 `relations`；直接调 `compilePlan` 时信封是完整的，所以**单元测试全绿也挡不住**。是补写的**端到端运行时用例**抓出来的（用户报障那一句走装配好的真实运行时）。教训：字段在链路上传递时，"我修的那一层绿了"不等于"这条路通了"。
- **两处过程中的自我纠错（都留了记录）**：
  - 我**先猜**覆盖度误报是关键词太宽，收紧后**仍然红**；写探针实测才拿到真原因——代表题里的"中点"是用 `dynamic.create_bound_point` + `parameter: 0.5` **构造表达**出来的。于是修法改成原则性的：`relationKindsConstructed` 认"动作层真能表达的关系"（midpoint / pointOn），而 `equalLength` / `ratio` / `perpendicular` / `parallel` / `coplanar` **没有对应构造动作**、仍必须由声明表回应（专门一条用例防它变成万能豁免）。
  - 我第一版**手推**的四棱锥面环绕向全错（被内核判 `inconsistent-winding`），还把"关系核验不通过"的假象带偏了一轮排查；最后暴力搜出合法组合（该顶点四棱锥只有 2 组合法）。**拓扑别手推。**
- **边界（如实）**：几何 Worker 的 compile 分支仍不带 `relations`（行为与今天逐字相同，属已知缺口）；平面几何那一批留到下一批；带自由参数的表达式关系不做；**不把关系存进文档**（约束求解是另一个量级）。分支 `feat/underdetermined-witness-relations` **尚未合并、未打包、未发布**。
- **当次读数**：全库单测 **281 文件 / 3250 通过 + 1 todo / 0 失败**；`agent-core` 与 `apps/web` 的 `typecheck` 均 exit 0；`eslint` exit 0。每个判据都做过定向变异（改坏判据→用例变红）。

## 2026-10-02 —— 发版后文档普查：把所有"最新版还没发布/球体未交付/HTML 未做"的过期表述改正

- **为什么值得单列一条**：v3.2.0 发布之后重扫了一遍全部进度文档，发现若干处**会让后来人误判**的过期表述 —— 这类"过时的未完成清单"在本项目里已经坑过几次（会让人重复劳动，或低估已完成的部分）。**这次改的都是表述，不是事实。**
- **改了什么**（逐处）：
  - `README.md`：立体几何那条不再说"球体还没有画布操作入口"（球体早在 v3.1.0 整体交付，含创建/编辑/解析截面/工程投影/Agent 动作，只不参与布尔运算）；"已具备"补上 **HTML 自包含快照**；"高中几何交互"那条不再说"最新版源码还没有匹配并安装验证的桌面发行包"（v3.1.0 / v3.2.0 都已发布，NSIS 装/卸已实测）；**「当前开发重点」整段重写** —— 从"球体计划刚起步"改为"代码侧已布置任务已做完，只剩用户侧 / 需管理员 / 未启动功能三类"；常用操作表新增「导出 HTML」一行。
  - `docs/current-status.md`：页首「最后更新」由 2026-10-01（还写着"球体只交付 Task 1–3、整个功能仍未完成"）改为 v3.2.0 发布口径；「本轮高中几何交互」小节标题与"仍未完成"那条按实情重写；§一 `bundle` 行由 v3.0.0 的旧读数更新为 v3.2.0（含构建/启动/Release 复核）；§四 E3 条目由"已获批并进入实施"改为"已交付并随 v3.2.0 发布"。
  - `docs/feature-catalog.md`：球体与 HTML 导出两项从「未交付」里划掉并写明随哪个版本发布；该节标题与指向 §四 的计数同步。
  - `docs/research/2026-09-29-high-school-geometry-interaction-progress.md`：页首改为"这条线已收尾并发布"，并**更正那份"仍记着、未修的"清单**（四条其实都已收口：锁定不吸附那条**记录本身就是错的**、单顶点编辑/体积数字/相机标签三者都已交付）。
  - 两个 HTML 导出文档（spec 与 plan）状态行改为"已实现并随 v3.2.0 发布"。
- **本批只改文档**，无可执行产物；因此没有新的门禁读数，引用的都是当次实跑过的数字（全量 e2e 184/0、单测 280 文件 / 3203 + 1 todo、CI #88 四项全绿）。

## 2026-10-02 —— 发版 v3.2.0：HTML 导出 + 三处修复，打包并发布 Release

- **为什么是 minor**：v3.1.0 之后 `main` 上新增了一个**用户可见的新能力**（HTML 导出），所以版本真值 `3.1.0 → 3.2.0`（只动 `apps/desktop/src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 两处；`git grep "3.1.0" -- "*.json" "*.toml"` 的命中全在 `package-lock.json` 的**第三方依赖**上，与产品版本无关）。
- **构建**：根 `npm run build` **exit 0** → `npm --workspace @draw/desktop run bundle` **exit 0**（Rust `Finished release profile [optimized] in 1m 16s`；WiX 出 MSI、NSIS 出 setup）。**打包前按 v3.1.0 的口径核实了前端来源**：外壳读的是 `build-check/mathcanvas-current`（不是 `apps/web/dist`），那份 `assets/index-BRMKadFt.js`（1,715,839 B）距打包 **2.3 分钟**，且确实含「导出 HTML」「自包含的 HTML 快照」「HTML 导出不在本批范围」「这次导出漏了什么」。
- **产物与哈希**（Windows x64，`FileVersion` / `ProductVersion` = **3.2.0**）：

  | 产物 | 字节 | SHA-256 |
  | --- | ---: | --- |
  | `mathcanvas-desktop.exe`（免安装） | 17,209,344 | `94253819D54ED351BF7AC4289C438B5D687B506F6DBF45D6349B6679B0CE783A` |
  | `MathCanvas_3.2.0_x64_en-US.msi` | 6,860,800 | `6671DACB382B35A595C0A8DFFE4F2756D034E237CA6076CA5195D1E85DC6AB33` |
  | `MathCanvas_3.2.0_x64-setup.exe` | 5,040,418 | `6EFFDB276945537EF3F0C7937C7E04F764B216DC3FD5CBA6F6AB2B2D87BA5680` |

- **启动实测**（release exe）：存活 T+12s / T+20s、真窗口句柄 `2886386`、标题 `MathCanvas`、`Responding=True`、工作集 43.3 MB，随后优雅关闭成功。
- **门禁**：全量 e2e **184 通过 / 0 失败**；全库单测 **280 文件 / 3203 通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` 0 error / 13 warning；`main` 顶端 CI **#87 四项全绿**（#84 / #86 被 `concurrency: cancel-in-progress` 取消，属设计行为）。
- **本版边界（如实）**：**MSI 的"装 → 启动 → 卸载"未验**（本会话 `admin=False`，MSI 按 Tauri 默认是每机器安装；NSIS 那半已在 v3.1.0 那次走完完整一圈）；教师/学生走查未做；立体几何画面进 HTML、`.ggb`、截图识图、平面/函数逐题补缺都不在本版。
- **Release 已发布并独立复核**：注解 tag `v3.2.0`（tag 对象 `62f6d0546817223f0dc3140c7c969d8cbf648b78`）→ 提交 `5291c5c`；Release id **`401859437`**、`draft=false`、`prerelease=false`、3 个资产（字节数与本地逐一相同）；**复核两步**：① 匿名 API `releases/latest` 由 `v3.1.0` 变为 **`v3.2.0`**；② 三件资产**重新下载**回来算 SHA-256 —— **全部 MATCH**。
- **发版过程的一处教训（写下来免得下次再踩）**：用 `curl` + 临时 config 调 API（token 取自 git 凭据助手，config 用完即删）。头两次创建 Release 都返 **422**，真实原因既不是网络也不是权限，而是 **PowerShell 5.1 的 `Get-Content -Raw` 给返回字符串挂了 ETS 属性**（`PSPath` / `ReadCount`…），`ConvertTo-Json` 于是把 `body` 序列化成 `{"value": …}` 对象、GitHub 判为非法请求；换成 `[System.IO.File]::ReadAllText(..., UTF8)` 拿到干净字符串后一次通过。**光看"成功/失败"不够，报文的形状本身也要核**（错误正文里 GitHub 已经把 `properties/body` 的原样值打出来了，是我第一遍没去读它）。
- 发行说明见 [`docs/release/v3.2.0.md`](docs/release/v3.2.0.md)。

## 2026-10-02 —— 收尾验证：全量 e2e 复跑 **184 通过 / 0 失败**（"未复跑"那条缺口关闭）

- 本轮改了共享路径上的三处（`pointerdown` 取消取景、内容同步后的悬停自愈、规划器的分析题守卫），所以做了一次**全量** e2e 而不是只跑相关 spec：`npx playwright test`（默认 workers）→ **184 通过 / 0 失败**（1.1 分钟）。
- **那条偶发红的 `geometry3d-section` 没有再出现** —— 它正是本轮"悬停自愈"修掉的那个机制（`data-preview-hovering` 只由 pointermove 写入）。
- 至此 `docs/current-status.md` §一里"全量 `npm run test:e2e` 未复跑"这条缺口**关闭**；该节现在只剩"`test:perf` / `test:rust` 未复跑"这类如实记录（Rust 已在上一批复跑过，见 §一表）。
- 本批**只改文档**（读数回填），无可执行产物。

## 2026-10-02 —— 悬停读数不再只跟着指针（修掉那条"不能复现"的 e2e 抖动）

- **修的是本文件同日追查过、当时"只记不改"的那条脆弱点**：`data-preview-hovering` **只**由 `pointermove` 写入（`threeScenePreviewHover.ts` 的 `updatePreviewHover`），而预览几何是**内容同步**建的 —— 两者谁先谁后是竞态：指针先到、预览后到，属性就永远停在 `false`，而 `expect` 的轮询救不回来（事件已经发生、不会再来一个）。现场记录见同日「追查 `geometry3d-section` 抖动」一节。
- **修法（产品侧重算）**：`threeScenePreviewHover` 记住最后一次指针的**归一化位置**，新增 `refreshPreviewHover()`；`threeSceneEffect` 的 `syncContent` 包装在**内容同步之后**调用它 —— 于是"指针已停下、内容才变"这类路径不再依赖两者先后。`pointerleave` 会清掉记住的位置，所以**不会凭空造一个悬停**。
- **判据为什么这么写（这一节值得记）**：原来那次竞态**不能按需复现**（单独跑 3/3、全量 `--workers=6` 179/179 全过，只在一次 `--workers=3` 里见过），所以我**不去重发指针移动**（那会变成"把抖动藏起来"），而是把同一件事**做成确定性的**：指针**一动都不动**，只让内容变（DOM 派发选中一只立方体 → 按 Delete ⇒ 预览消失），悬停读数必须跟着从 `true` 变成 `false`。用 DOM 派发而不是 `locator.click()`：后者会**移动鼠标**，一离开画布就走 `pointerleave`，那样测的就不是"内容变了"这件事。
- **证据**：`e2e/three-intersection-previews.spec.ts` 新增一条（修法下通过）；**变异检查**：拿掉 `refreshPreviewHover()` 那一行 → 期望 `false` 实收 `true`（**陈旧读数**，正是那条脆弱点的症状）✓。回归：预览 / 创建 / 截面三个 spec **23/23**；`npm run typecheck` exit 0；`eslint` exit 0；全库单测 **280 文件 / 3203 通过 + 1 todo / 0 失败**（282 s）。
- **顺带修正一处过时的排查笔记**：老记录里说"加立方体会触发取景动画"——**不成立**（`shouldAutoFit` 只在换文档或内容出界时触发，见前一条 `cancelFitAnimation` 那节的记录）。

## 2026-10-02 —— D2 的 NSIS 那半：本机「安装 → 启动 → 卸载」完整验收

- **用户选择只试 NSIS**（每用户、可卸载；MSI 每机器那半不试）。v3.1.0 的安装包**不在本地**（`target/release/bundle` 里只有 v0.2.0 的两件），所以从 GitHub Release 下载 `MathCanvas_3.1.0_x64-setup.exe`：**5,030,195 B**、SHA-256 **`1A4B2AA1A5278E8A5B1DA92B23B6FD6B47B74D6FD151B1C02C4343CF11D5052A`** —— 与 D1 记录的 `1a4b2aa1…5052a` **逐位一致**（顺带又独立复核了一次 Release 资产）。
- **装**：`setup.exe /S` → **exit 0**；落点 `D:\release\MathCanvas`，HKCU 卸载项 `DisplayVersion=3.1.0`、`Publisher=mathcanvas`、开始菜单快捷方式就位。
- **启动**：`mathcanvas-desktop.exe`（**17,190,400 B**、`FileVersion=3.1.0`）→ 存活 **T+12s / T+18s**、**真窗口句柄 `920116`**、标题 `MathCanvas`、`Responding=True`；WebView2 配置目录时间戳刷新到本次启动。
- **卸载**：先优雅关闭窗口，再 `uninstall.exe /S` → **exit 0**；核对**目录 / HKCU 卸载项 / 开始菜单快捷方式三者都已消失**。
- **两处如实说明**：① 这台机器在我动手**之前**就有一条 MathCanvas 卸载记录（HKCU，`InstallLocation=D:\release\MathCanvas`，主 exe 时间戳 16:41、版本已是 3.1.0）—— 所以这**不是"干净机器首次安装"**的验收，本轮 `-S` 安装是把它刷新一遍，**净效果是这台机器从"有一份 v3.1.0 每用户安装"变成"没有安装"**（按你的要求验完立即卸载）。② **MSI（每机器）那半仍未实测**（本会话非管理员，且你选的是只试 NSIS）—— 所以 D2 **只关闭了 NSIS 那一半**。
- 下载物放在仓库外的临时目录，用完已删；仓库工作区保持干净。

## 2026-10-02 —— 分析题不再被本地规划器当成建模指令（"这个正方体的内切球半径是多少"）

- **背景**：本文件早先把它记成"顺带查实一条**既有隐患**（未修，记为发现）"—— 把"这个正方体的内切球半径是多少"喂给本地规划器，命中的是既有的「正方体」条目，于是它会**去新建一只正方体**，而用户要的是一个读数。这一轮修掉（提交 `8febd38`）。
- **修法（也就是那条待定的口径）**：`matchLocalIntent` 加一道守卫 —— 句子里**没有任何建模动词**（画 / 作 / 建 / 添加 / 创建 / 放 / 来一个 / 来个）、却在**问读数**（是多少 / 多少 / 多大 / 多长 / 求 / 怎么 / 为什么 / 吗）时，**请求技能的建模意图一律不认**；认不出的结果是**既有的**"老实问路"（clarification）。不求技能的只读意图（例如"有什么"）不受影响 —— 它本来就要在问句里命中。这与文件里已有的两条纪律同类（不认裸词"四面体"、不认裸词"球"）。
- **边界（如实）**：只挡"没有建模动词"的问句。"画出这个正方体的内切球"这种**既在问几何、又明确要求作图**的句子照旧走建模 —— 它确实是在要求作图。
- **证据（先红后绿）**：新增 4 条单测 —— 两句分析题（内切球半径 / 外接球半径）必须是 `clarification`；两条**反向对照**（"建一个棱长 3 的立方体"仍建、`SPHERE_PROMPT` 仍建，挡住的是"只问读数"、不能连"画一个半径 5 的球体"一起挡）。RED：实现前这两条断言是 `expected 'plan' to be 'clarification'`。
- **读数**：`localPlanner.test.ts` **29/29**；Agent 相关四个 e2e（agent-flow / agent-conic-invariant / agent-oblique-prism / geometry3d-sphere）**17/17**；`npm run typecheck` exit 0；`eslint` exit 0；全库单测 **280 文件 / 3203 通过 + 1 todo / 0 失败**（234 s）。

## 2026-10-02 —— 修掉"自动取景动画覆盖用户拖动"的窗口 + 给它一个可观测状态

- **背景**：本文件早先把它记成"顺带发现、**只记不改**"（`cancelFitAnimation()` 只在副作用清理里被调用，用户拖动不会取消进行中的取景）。这一轮把它修掉（提交 `fd234fd`）。
- **修法**：画布的 `pointerdown` 处理器**先** `cancelFitAnimation()` 再交给交互层；滚轮缩放同理（同属"用户自己动相机"）。顺序不能反 —— 取景的帧不等任何判定，只要还在跑下一帧就会写 `cameraStateRef`，所以必须在用户动作的**第一步**掐掉。
- **顺带补一个可观测状态，因为这条缺口的第一版用例是假绿的**：我先用"添加立方体"去触发取景，而 `shouldAutoFit` 只在**换文档或内容出界**时取景（编辑不算、`dragging` 时也不算），动画压根没跑 —— "相机没被覆盖"于是自然成立。现在取景动画的三态写到画布上：`data-fit-animation` = `running` / `done` / `cancelled`（`cancelled` 只在**真有帧在跑**时报告，免得重取景时的例行取消把读数弄脏）。用例因此能分两步走：**先抓到 `running`（抓不到就明确失败，不再有假绿）**，再断言按下后变成 `cancelled` —— 与动画自己跑完的 `done` 区分得开。
- **证据**：
  - 新增单测 `apps/web/src/threeSceneCamera.test.ts`（该模块**此前没有测试文件**，3/3）：`running → done` 的转移、**取消之后不再排帧**（受控 rAF：再刷两帧相机也不动）、空取消不报 `cancelled`。
  - `e2e/geometry3d-drag.spec.ts` 新增一条：先抓 `running`，按下鼠标后断言 `cancelled`。**变异检查**：去掉按下时的 `cancel()` → 期望 `cancelled` 实收 `running` / `done`，**红** ✓。
  - 定向读数：`npm run typecheck` exit 0；`eslint`（四个改动文件）exit 0；拖动 + 相机记忆 + 自动取景三个 spec **11/11**；全库单测 **280 文件 / 3199 通过 + 1 todo / 0 失败**（258 s）。

## 2026-10-02 —— HTML 导出 Task 5：钉住 Agent 通道四个格式 + 收口（E3 的 HTML 一半交付完成）

- 实施计划 **Task 5** 完成，**5 个区块全部交付**。在 `packages/agent-core/src/tools/interactionTools.test.ts` 加了一条**类型级**判据，钉住 Agent 的导出通道**恰好四个格式**（spec §9 的"有意不做"：那条通道会把结果回给模型，加 HTML 得连带设计"模型拿它干什么"）。
- **变异检查做了两次，第二次比第一次有用**：第一次只钉 `proposeExport`，然后给 **`preflight`** 的 `format` 加 `| "html"` —— **`tsc` 全绿，拦不住**；于是把判据扩成两条（两处联合各一条）。再分别变异：改 `proposeExport` → `interactionTools.test.ts(149,11): Type 'true' is not assignable to type 'false'`；改 `preflight` → 报在 `(155,11)`。**两次都拦得住**，变异已恢复、`interactionTools.ts` 与 HEAD 无差异。这条"只钉一处等于没钉"的教训已写进计划的 Task 5 状态行。
- **功能收口**：`docs/feature-catalog.md` 的导出能力加了 HTML 一条（自包含快照 + 损失清单 + 内嵌存档 + **立体几何明确拒绝**，并写明"不做"的四项）；`current-status.md` §四 E3 更新为 **HTML 一半已交付、`.ggb` 一半仍未启动**。
- **全量门禁（本批最后一次复跑）**：`npm run typecheck` exit 0；`npm run lint` **0 error / 13 warning**；**全库单测 279 文件 / 3196 通过 + 1 todo / 0 失败**（265 s，比上一批 +1 = 新增的钉住用例）；`e2e/html-export.spec.ts` **3/3**、既有导出 e2e 回归 **11/11**。
- **发布边界（spec §7）**：本次只交付**当前 `main` 的源码能力**，**不等于**发布了含此功能的桌面安装包 —— 那需要一个新版本号、从确定的发行提交重打并核对哈希。

## 2026-10-02 —— HTML 导出 Task 3+4：e2e 先红 → 菜单接线转绿（全量门禁复跑）

- 实施计划 **Task 3 + Task 4** 完成（提交 `59eb3be`）。**e2e 三条浏览器判据**（`e2e/html-export.spec.ts`）：平面导出拿到 `.html`、文件里有内嵌 `<svg>` 与存档 JSON、**零外部引用**，再把它当普通网页 `setContent` 打开、断言图**可见**且"这次导出漏了什么"那一节在；CAD 导出断言文件名 `CAD-linear-dimension-A-B.html`、四个 `data-drawing-view` 齐全、整份文件**只有一个** `<svg>`；立体几何断言 `role="alert"` 含"立体几何"且**零下载**。
- **RED 证据如实记录**：接线前三条都红，红法一致 —— `waiting for getByRole('button', { name: '导出 HTML' })` 30 秒超时（菜单里还点不到）。计划把"提交这条红 spec"标为可选，实际**与接线合并成一笔提交**，避免历史里留一个"提交即红"的状态。
- **接线**：功能区两个分支各加 `export-html`；`commandDispatch` 的 CAD 表与功能区表各加一条分派 + 依赖注入类型；`App.tsx` 加 `exportHtmlFile` 包装并注入；`GeometryToolbar` 的 prop 与按钮同步。
- **两条口径差异，写进注释**：① 立体几何里 **HTML 不禁用**（spec §4 要求"点得到、点了明确拒绝"），与既有的"导出 SVG / PNG 在 3D **禁用**"是两套口径；② 顺带查实 **`GeometryToolbar` 没有被任何地方挂载**（只有自身引用）—— 真实入口是功能区，改它纯粹是"将来挂载时不用再补"，不构成功能证据。
- 读数：`e2e/html-export.spec.ts` **3/3**；`workbench` + `engineering-drawing` 回归 **11/11**；`ribbonCommands` + `commandDispatch` **19/19**；全仓 `npm run lint` **0 error / 13 warning**；`npm run typecheck` exit 0；**全库单测 279 文件 / 3195 通过 + 1 todo / 0 失败**（247 s）。

## 2026-10-02 —— HTML 导出 Task 2：接进文件导出路径，立体几何明确拒绝

- 实施计划 **Task 2** 完成（提交 `fc4df43`）：`fileExports.ts` 新增 `exportHtmlFile()` —— 按工作区选 `exportSvg`（平面）或 `exportEngineeringSvg`（工程），把 omissions、工程视图 `diagnostics` 与应用版本戳交给 Task 1 的产出器，最后走既有的 `download()`。
- **立体几何明确拒绝**（spec §4 的硬性要求）：`document.workspace === "geometry3d"` 时经 `setFileError` 给一句人话并**不产出任何文件**。理由写在代码注释里：照平面分支走会得到"导出成功、HTML 里只有一个坐标网格"，因为 `exportSvg` 刻意不投影 3D 图元。
- **版本戳如实**：走 `readDesktopRuntime()` —— 桌面外壳给 `tauri.conf.json` 的真版本，浏览器里 `info` 是 `null`，写 `unknown`（不编号、也不省略）。
- **类型收紧**：原来的 `ExportFormat` 拆成 `VectorExportFormat`（`svg|dxf|pdf`）与 `ExportFormat`（`+ "html"`）—— 否则 `exportSvgFile("html")` 在类型上合法、实际却导出一份 SVG（一个静默的路径混淆）。
- **3 条新单测，先红后绿**：3D 拒绝且零下载、平面文档产出自包含 HTML（文件名、`格式版本 1`、`应用版本 unknown`）、CAD 走工程产出器且视图诊断进损失清单。**变异检查**：去掉 3D 拒绝分支 → 用例立刻红在 `expected [ '我的-图纸.html' ] to deeply equal []`，正是"静默半死"的症状；变异已恢复。
- **一处与计划的差异（jsdom 限制，已记）**：计划里写 `await blobs[0].text()`，但 jsdom 的 `Blob` **没有** `text()`（`App.test.tsx:1962` 记过同一件事），改用 `FileReader` 读，与仓库既有手法一致。
- 读数：`fileExports.test.ts` **9/9**（6 旧 + 3 新）；`npm run typecheck` exit 0；定向 eslint exit 0。菜单入口还没接（那时还点不到），下一块走 e2e 先红 → 接线。

## 2026-10-02 —— HTML 导出 Task 1：纯函数产出器（`htmlExporter`）落地

- 实施计划 [`2026-10-02-html-export-implementation-plan.md`](docs/superpowers/plans/2026-10-02-html-export-implementation-plan.md) 的 **Task 1** 完成（提交 `6d28578`）。新增 `apps/web/src/persistence/htmlExporter.ts`：一个**纯函数**产出器（收文档 + 已算好的 SVG + 损失条目 + 版本戳，吐字符串），不碰 DOM、不下载、不读全局 —— 所以转义与注入这类判据能直接单测，而"按工作区选哪个 SVG 产出器"留给下一块的 `fileExports`。
- **9 条单测，先红后绿**（RED 是 `Failed to resolve import "./htmlExporter"`）：内嵌 SVG **逐字包含**且整份文件只有一个 `<svg>`；**零外部引用**（判据是"无 `<link>` / 无带 `src` 的 `<script>` / 无指向网络的 `src|href` / 无 `@import`"，并配"文件里真有内嵌 `<svg>` 与内联 `<style>`"的**反向对照**，免得"没有外链"只是因为文件是空的）；SVG 内部无 `id="`；内嵌存档 `encodeMgeo → decodeMgeo` **不动点**；标签里含 `</script>` 时结构不被提前闭合、解回来的标签**一字不差**；正文转义；损失清单有则列出、无则写明"无"；版本戳含 `unknown` 档。
- **一次变异检查**：同时去掉 `escapeHtmlText` 与 `escapeJsonForScript` → **3 条红**，其中注入那条正是它要防的症状 —— 存档被 `</script>` **提前截断**，连存档往返也一起失败。变异已恢复，产品文件与提交内容一致。
- **顺带把一张表只留一份**：`exportService` 新导出 `isUnexportableType`，`htmlExporter` 的"这次漏了什么"复用它（而不是另抄一张类型表）——两处各写一张的症状是"界面说有损失、文件里说没有"。
- 读数：该文件 **9/9**；`npm run typecheck` exit 0；`eslint`（三个改动文件）exit 0。全局 `npm run lint` / 全库单测按计划留到 Task 4 收口时复跑（本块只新增一个未被引用的模块，尚未接进任何用户路径）。

## 2026-10-02 —— E3 HTML 导出：spec 获批 + 实施计划落地（开始实现）

- **用户在本轮批准 HTML 导出的 spec**（`docs/superpowers/specs/2026-10-02-html-export-design.md`，此前状态是"待用户审阅"，brainstorming 的硬门禁要求用户审过才能出实施计划）。按 `writing-plans` 产出 [`docs/superpowers/plans/2026-10-02-html-export-implementation-plan.md`](docs/superpowers/plans/2026-10-02-html-export-implementation-plan.md)：**5 个区块**（纯函数产出器 → 导出路径含立体几何明确拒绝 → e2e 先红 → 命令与界面接线 → Agent 通道钉住 + 文档收口），每步都带可粘贴的代码与命令。
- **写计划时按实测改掉三处"凭印象"的写法**（这三处若不改，计划里的代码一跑就假红）：
  1. `AnnotationSpec` 的字段是 **`target`**，不是 `targetId`（`packages/dsl/src/types.ts:928-937`）；
  2. **工程 SVG 里没有"主视图"这类中文标签** —— `svgDrawing`（`engineeringExporters.ts:108`）只写 `data-drawing-view="front"` 这类属性，所以 CAD 那条 e2e 改成断言四个 `data-drawing-view`；
  3. 内嵌存档的往返判据改成 **"`encodeMgeo` → `decodeMgeo` 的不动点"**：`encodeMgeo` 会补默认值，拿手搭的文档直接 `toEqual` 会因那些默认值假红。
- **两处与 spec 的偏差，写在计划里而不是悄悄做**：
  1. **本批不调用 `buildExportPlan`** —— 实测它至今**没接进任何用户路径**（`agentRunner.ts:509` 还是 `{ error: "export preflight is not wired into the agent path yet" }` 的桩），而它需要的 `layoutDocumentId` / `geometryDocumentId` 在导出路径上拿不到（编一个就是伪造）。损失清单改为：**复用 `exportService` 那张"画不出来"的类型表**（新导出 `isUnexportableType`，规则只有一份）+ 隐藏对象 + 工程视图的 `diagnostics`。因此 spec §9 的第 7 处（`exportService` 的 `ExportFormat` 联合）**不需要动**。
  2. **"零外部引用"的判据不能写成"不含 `http://`"** —— 内嵌 SVG 的 `xmlns="http://www.w3.org/2000/svg"` 是 **XML 命名空间、不是网络请求**，照字面写会必红。判据落实为：无 `<link>`、无带 `src` 的 `<script>`、无指向网络的 `src|href`、无 `@import`，并配"文件里真有内嵌 `<svg>` 与内联 `<style>`"的反向对照（否则"没有外链"可能只是因为文件是空的）。
- **本批只新增文档**（计划 + spec 状态行 + 本节 + `current-status.md` §四 E3 的更新），**尚未写任何实现代码** —— 所以没有可执行门禁读数可报，下一批按计划 Task 1 起走 TDD。

## 2026-10-02 —— 同步到最新 `main`（`5a8546d`）时发现并修掉 `current-status.md` 的两处小节缺陷

- **背景**：用户要求"获取 GitHub 最新版本"。本地 `main` 落后 **36 个提交**，已快进到 `origin/main` = **`5a8546d`**（`git ls-remote` 核对；期间球体那批已全部交付、`v3.1.0` 已发布）。在最新的 `current-status.md` 上发现两处缺陷，一并修掉：
  1. **两个 `## 四`**（我 2026-09-30 加「未完成任务总清单」时造成的编号撞车）—— 把较早的「如实缺口」降为 **`###`** 并归到「三、还没做的」之下。于是文件里编号严格递增（一 / 二 / 三 / 四），而其它文档已经在用的 **§四 = 未完成任务总清单** 这一引用**全部保持有效**（球体计划、HTML 导出 spec、功能目录、归档都指它，不做无谓改名）。
  2. **E3 同一条 bullet 里既写"未启动"又写"2026-10-02 已启动"** —— 按本文件"现在时、就地改正"的规矩改成 **"HTML 一半进行中、`.ggb` 一半未启动"**；小节标题的更新时间由 2026-10-01 改为 2026-10-02（内容里本就有 10-02 的更新）。
- **同步读数（当次实跑）**：`git fetch --all --tags --prune` 后 `behind: 0 / ahead: 0`，工作区干净（那条 CRLF 幻影 `Cargo.toml` 已不复现）。本批**只改文档**，无可执行产物。

## 2026-10-02 —— 启动 E3：HTML 导出（spec 已写并就审，尚未实现）

- **用户决定**启动 E 类第 3 项的 **HTML 一半**（GeoGebra `.ggb` 仍未启动）。按 brainstorming 流程走：分类为 **architectural**（新的对外产物格式，且仓库惯例是每个功能配 spec + plan）→ 逐项澄清 → 八段设计获批 → 写 spec。
- **spec**：[`docs/superpowers/specs/2026-10-02-html-export-design.md`](docs/superpowers/specs/2026-10-02-html-export-design.md)。**用户逐项确认的四个决定**：① **自包含静态快照**（单文件、不依赖本应用、不联网、不可交互）；② 第一批覆盖**平面几何 + 工程制图**；③ 平面几何**复用 `exportSvg` 的标准视野（含网格）** —— 不是"我屏幕上当前这一张"；④ **内嵌 `.mgeo`**，使 HTML 兼作**可再导入的存档**。四条各自的**代价**都写进了 spec（③ 平移缩放过的文档与屏幕不一致；④ 文件变大且文档 JSON 对收件人可见）。
- **状态：卡在 spec 评审** —— brainstorming 的硬门禁要求用户审过才可写实施计划，因此**本批零实现代码**。第 23、24 轮改用**只读探查**去验 spec 自身的假设，查出 **5 处会让功能带病上线**的问题：
  - **加一个导出格式要同时改 8 处生产代码 + 5 处测试**（功能区命令定义 `ribbonCommands.ts:130`、命令分派 switch、`App.tsx` 包装类型、`GeometryToolbar.tsx` 的 prop、`fileExports.ts` / `exportService.ts` 的两个 `ExportFormat`、以及 **`packages/agent-core/src/tools/interactionTools.ts` 的 Agent 导出联合**）。**只改两个类型会做出"菜单里点不到"的功能。** 并明确写下取舍：本批**不让 Agent 提议 HTML 导出** + 一条测试钉住，防止后人误判为 bug 顺手"修齐"。
  - **立体几何会落进平面分支**：实测 `fileExports.ts:95-97` 的分支是 `workspace === "cad"` 才走工程产出器，否则一律走平面 `exportSvg`；而平面导出器**刻意不投影 3D 图元**（`exporters.test.ts:79`）。照现状做会得到"**导出成功、HTML 里只有一个坐标网格**"——正是本仓库最讨厌的静默半死。已硬性要求立体几何下**明确拒绝**而不是吐空 HTML，并配反向对照。
  - **标题字段是 `metadata.name` 不是 `title`**（`packages/dsl/src/types.ts:955`），且 DSL 自带默认值，不必自造默认名。
  - **现成转义函数够不着**：`engineeringExporters.ts:76` 的 `escapeXml` 等**未 export**，而 spec 硬性要求转义一切文档派生文本 ⇒ 必须自带（并给它自己的单测）。
  - **版本戳**：走桌面桥 `commands/providers.rs:282` 的 `package_info().version`（**就是 `tauri.conf.json` 的产品版本**；`runtime.rs` 里的 `0.1.0` 是单测夹具），但**浏览器里是 `unknown`**，须如实写。
- **一处自查出的文档漂移**：连推三版 spec 却忘了同步进度文档（§四 E3 仍写"未启动"），已在提交 `d5decf9` 更正；过程归档也在 `894192f` 补齐 2026-10-02 全段。

## 2026-10-02 —— 修掉本机必红的那条相机平移 e2e（根因：测试读了动画中途的读数）

- **症状**：`e2e/geometry3d.spec.ts:277`「pans the 3D view along the camera axes within a bounded range」在本机**必红**，CI 上却时绿时红。它让"本机全量 e2e"这条门禁不可信（此前一直以 CI 的 `e2e` 作业为准）。
- **根因（读代码得出，不是猜）**：自动取景是一段**约 250ms 的动画** —— `threeSceneCamera.ts` 的 `animateToFit` 在 rAF 里把**整份相机状态（含 `target`）**从旧值插值到拟合值，而 `three-canvas` 的 `data-camera-target` 是从**每帧都在变**的那个 ref 渲染的。用例加完立方体**立刻**读基准值，读到的是**动画中途**的值；而拖动发生在动画结束之后，落点是**拟合真值**。
  - **它有两个面孔，都是同一场竞态**：读得早 → `startX` 离拟合值还远 → **第 299 行**（`toBeCloseTo(boundsCentre[0], 1)`，容差 0.05）红，实测 `Expected -5 / Received -4.8`（另一次 `-4.87`）；读得晚但不等于停稳 → 第 299–301 行过了、**第 309 行**（`expect(z).toBeCloseTo(startZ, 6)`）红，实测 `Expected 1.98 / Received 2`。**这就解释了"同一个用例两次报不同的断言、且数值逐次运行都不一样"。**
  - **顺带排除两个曾经的怀疑**：① `clampCameraTarget` 是**箱式夹取**（中心 ± `PAN_RANGE_FACTOR(3)` × 半径），够不到那 0.02，不是它；② "水平平移不动 z"这条不变量**是真的** —— `cameraBasis` 的 `right = (-sin az, cos az, 0)`，第三个分量**恒为 0**。所以**错在测试的基准值，不在产品**（产品那 250ms 过渡是有意的体验）。
- **修法（一处，最小）**：取基准值前**等相机停稳** —— 判据是**连续两次读数一致**，**不写死 sleep**、不看动画时长。与同文件既有的 `settledWidth`、以及 `three-orbit-tracks.spec.ts` / `three-intersection-previews.spec.ts` 的 `settleCamera` 同一套口径。
- **验证**：修前先复现（`Expected -5 / Received -4.8`，红）；修后 `--repeat-each=5` **5/5 通过**（单跑一次不足以证明去掉了抖动，所以用重复跑）。`tsc -p e2e/tsconfig.json` exit 0；`npm run lint` exit 0（0 error / 13 warning）。
- **修完后全量 e2e 的读数（如实）**：**178 通过 / 1 失败** —— 失败**换了另一条**：`e2e/geometry3d-section.spec.ts:42`「explains the section preview and creates a section when it is clicked」在第 59 行 `data-preview-hovering` 上期望 `"true"`、实收 `"false"`（指针没落在那圈虚线预览上）。**单独跑 3/3 全过**，也就是说它是**并行负载下才出现**的抖动，**机制与刚修的那条不同**（那条是"读动画中途"，这条是"负载下命中判定偏移"）。
  - **本批没有修它**（一次只修一个根因，不夹带）。所以**"本机全量 e2e 现在全绿"这句话不成立** —— 仍然是 1 条红，只是红的那条换成了另一个尚未定位的负载敏感用例。文档里已同步更正。
- **另一处顺带发现（只记不改）**：`cancelFitAnimation()` 只在**副作用清理（卸载）**里被调用（`threeSceneEffect.ts:528`），**用户拖动并不会取消**进行中的自动取景动画 —— 理论上"在 250ms 内开始拖"会被剩下的帧覆盖。本批没动它（与本次红的原因无关：本例的拖动发生在动画结束之后）。**（2026-10-02 已修：见同日「修掉'自动取景动画覆盖用户拖动'的窗口 + 给它一个可观测状态」一节，提交 `fd234fd`。）**
- **那条 `geometry3d-section` 抖动的追查结论：没有修，但把两条假设里的**一条证伪了**、并查出一条**代码级可证的脆弱点**。**
  - **可复现性**：**没能按需复现** —— 单独跑（`--workers=1 --repeat-each=3`）3/3 全过；全量 `--workers=6` 跑了 **179/179 全过**。只在第 21 轮那次 `--workers=3` 的全量里见过一次。按纪律：**不复现就不猜着改**。
  - **假设一（我最初的想法）已被代码证伪**：我原以为是"投影时自动取景动画还在跑"。读 `threeSceneCamera.ts:87-97` 后不成立 —— 取景的触发条件是**文档 id 变了**（`fittedDocumentRef.current !== fittedId`），**不是每次编辑**；而它调的是 `fitToContent()`（**立即** `setCameraState`），**不是** `animateToFit()`。也就是说：加立方体**不会**触发取景动画，而真正那次取景发生在更早的"跳转到立体几何"，到 `grabPoint` 时早已结束。**这条假设作废。**
  - **查出一条代码级可证的脆弱点（新）**：`data-preview-hovering` **只在** `threeScenePreviewHover.ts` 的 `updatePreviewHover`（第 106 行）里被写入，而那个函数**只由 pointermove 事件驱动**（`handlePointerMoveForPreview`；没有任何 effect 会在其它状态变化时重算它）。于是：**一次性的合成指针移动天然是竞态的** —— 如果那一瞬间预览的命中几何还没准备好，属性就**永远停在 `"false"`**，`expect(...)` 那 5 秒的轮询**也救不回来**（事件已经发生过，不会再来一个）。这与观察到的现象（`data-preview-hovering` 期望 `"true"` 实收 `"false"`，且超时）**吻合**，但**我没有复现，所以不能称它为已证实的根因**。
  - **为什么不顺手改**：可选的修法是"反复重发指针移动直到 hovering 为真"（测试侧硬化），或让应用在预览变化时重算一次悬停（产品侧行为变更）。两者我都**无法用一次前后对比证明它修好了那次失败** —— 按本项目一贯纪律，**不拿未经验证的改动冒充修复**。留给下一次能复现时做定向追查。

## 2026-10-02 —— 仓库整理：远端功能分支先存档再删除（D3）

- **用户决定**：先打存档 tag，再删分支。
- **删除前实查，结果与旧表述不同**：`compare main...feat/high-school-geometry-interaction` 给出 **`status: diverged`、`ahead_by: 1`、`behind_by: 54`** —— 该分支**并非"已全合并的空壳"**，而是有 **1 个提交不在 `main` 里**：`8c67346`（2026-09-30）"docs: 补齐所有进度文档（归档 / README / 设计说明 / 当前状态）"，**仅动文档**（README、`current-status.md`、`project-progress.md`、一份 spec）。它是合并/打包当天的旧快照，main 上这几份文件此后已被反复重写 —— **很可能已取代，但没有逐行比对过**，故不假设内容已覆盖。另实查**无开放 PR**。
- **做法（顺序刻意如此）**：建注解 tag **`archive/feat-high-school-geometry-interaction`**（tag 对象 `bb4a5aad`）指向 `8c67346` 并推送 → **API 三重确认**（tag ref 存在 / 解引用得 `8c67346` 且与 tip MATCHES / 提交可解析）→ 才执行 `git push origin --delete`。
- **删除后复核**：远端分支只剩 `main`（`e2c53c0`）；存档 tag 仍解析到 `8c67346` —— 那份旧快照**在远端依然可达、不会被 GC**。
- **一条方法论纠正**：本轮第一次 `git ls-remote` 被网络 reset 打断，脚本据此打印过 "MERGED: NO" —— 那是**失败命令的产物、不是事实**；改用 API 重查才得到 `diverged / ahead_by=1`。**命令失败时的默认输出不能当结论。**

## 2026-10-02 —— 发布 v3.1.0（桌面三件套）

> 用户决定：把球体这批（Task 1–9）作为 **v3.1.0** 发布（新能力走 minor）。版本真值从 `3.0.1` 升到 `3.1.0`。

**产物（本机实打包，逐件记哈希）**

| 产物 | 字节 | 体积 | SHA-256 |
| --- | --- | --- | --- |
| `MathCanvas_3.1.0_x64_en-US.msi` | 6,848,512 | 6.53 MB | `3531e488383d6902d3d659e2c10a589f83d5efc3f151a9a117a0902b5a2f17eb` |
| `MathCanvas_3.1.0_x64-setup.exe`（NSIS） | 5,030,195 | 4.80 MB | `1a4b2aa1a5278e8a5b1da92b23b6fd6b47b74d6fd151b1c02c4343cf11d5052a` |
| `mathcanvas-desktop.exe`（未打包裸 exe） | 17,190,400 | 16.39 MB | `2c70f1c9c24c8d64c985a19ce5bc7d3d7421d9734443e29252779ddc9ebf7b23` |

**版本真值只有两处**（`git grep "3.0.1"` 在 `*.json` / `*.toml` 上只命中这两行）：`apps/desktop/src-tauri/tauri.conf.json` 与 `apps/desktop/src-tauri/Cargo.toml`。根 `package.json` 与 `apps/desktop/package.json` 都是 `0.1.0` 的**私有 workspace 版本**，不参与发行，故未动。

**打包前做过的一步核实**：桌面外壳的前端来自 `build-check/mathcanvas-current`（`tauri.conf.json` 的 `frontendDist`），**不是** `apps/web/dist` —— 所以先跑根 `npm run build`（exit 0），并确认那份 `index.html` 的时间戳距打包动作仅 **0.3 分钟**、`index-*.js` 里同时含「球体」与 `create_sphere`。**不核实这一步就有发一版旧界面的风险。**

**本次内容（相对 3.0.1）**：球体这条线的全部交付 —— 解析球文档类型、球-平面精确截交（圆 / 切点 / 空集）、场景事务与 `4πr²`·`4πr³/3` 测量、截面接入 + 球布尔门禁、3D 渲染（不画可选中经纬网）、「常用立体」球体预设 + 属性栏编辑、CAD 四视图与 SVG/DXF/PDF 导出、Agent 动作 `solid.create_sphere` 三层接通、Agent 端到端（一句话造球），以及审计查出的一处静默缺口修复（球的测量数字此前**不会**画在画布上）。详见同日各条。

**构建读数**：`vite build` 510 modules / 3.65 s；Rust release `26.28 s`；`cargo`、`candle`/`light`(MSI)、`makensis`(NSIS) 全部 exit 0。**警告一条**（如实记）：`mathcanvas-desktop (lib) generated 1 warning` —— `linker_messages`（链接器输出 DLL/EXP 提示），非代码告警。

**仍未做**：本机**安装实测**（装 → 启动 → 卸载）属 §四 **D2**，需用户决定；本文件只证明"打包成功且哈希可复核"，**不等于**"已在本机装过一遍"。GitHub Release 的上传见同日提交记录。

**GitHub Release 已发布（2026-10-02）**：注解 tag **`v3.1.0`**（tag 对象 `d9a92f94`，指向提交 `165e4fb`）→ **https://github.com/Huo0077/mathcanvas/releases/tag/v3.1.0**，非 draft、非 prerelease，挂 3 个资产。**独立复核**：① 匿名 API `releases/latest` 现已返回 `v3.1.0`（此前是 `v3.0`）、draft=false、assets=3；② 三个资产**重新下载**回来算 SHA-256，**三件全部 MATCH** 上面那张表的哈希 —— 也就是说"Release 上的字节"与"本机打出的字节"是同一份。第三个资产在 Release 上叫 `MathCanvas_3.1.0_x64.exe`（上游 `mathcanvas-desktop.exe`）。

**免安装裸 exe 的启动实测（2026-10-02 补做）**：用户选择"只试未打包裸 exe 能不能启动"，故只做了这一项。`target/release/mathcanvas-desktop.exe`（SHA-256 `2c70f1c9…f7b23`，与 Release 同哈希）**启动成功**：存活 T+10s 与 T+18s、真窗口句柄 `3017702`、标题 **`MathCanvas`**、`Responding=True`、工作集 32.6 MB；**仅按窗口句柄截图**（不截整屏）确认画面是**完整应用界面而非白窗**（立体几何页签、绘制与立体与截面工具栏、常用立体、代数区、z=0 网格与提示语）。截图存临时目录、未入库（本仓库不提交截图），其 SHA-256 为 `eb243753fb60496c25c2a138fedf4321c7ca9f35de75c1dc140c7d2fa4a53b85`。细节见 [`docs/release/v3.1.0.md`](docs/release/v3.1.0.md)。**MSI / NSIS 的安装验收仍未做**（本会话非管理员、无法提权）。

## 2026-10-01 —— Task 9 收口：切点与空集**在浏览器里也验到了**（我上一轮判"验不了"是错的）

- **上一轮我写下的结论是**："种一份草稿再读读数这条路走不通（恢复路径不重算派生字段），所以 z=8 相切 / z=9 空集只能停在单元判据。" **这一轮把它推翻了，而且推得干净。**
- **漏掉的那一点**：`sectionPlaneThroughSource` 对球默认给的是**过球心**的平面（球心 z=3 ⇒ `constant = -3`），而方向键在「自由拖动」开着、选中的是截面时按**整整 1 个单位**沿法向平移（`threeSceneEffect.ts`，Shift 才是 0.2）。于是**整数步 + 整数球心**让"相切"这个测度为零的状态在浏览器里可以**稳定走到**：五次 `ArrowUp` ⇒ `-8`（距离 = 半径 5，精确相切）、再一次 ⇒ `-9`（距离 6 > 5，空集）。
- **新增一条 e2e**（`e2e/geometry3d-sphere.spec.ts` 增到 **7 条**）：走**真界面** —— 工具栏切一刀（先断言 `exact-kind=circle`、常数 `-3.000`）→ 开「自由拖动」→ 五次方向键（断言常数 `-8.000`、`kind=point`、`status=exact`、**点数 1**）→ 再一次（断言常数 `-9.000`、`kind=empty`、**点数 0**，即**不留上一刀那个点**）。**7/7 通过**。
- **于是 Task 9 第二条 bullet 点名的 e2e 覆盖清单全部落到浏览器层**：数值创建 ✅ / 精确圆 ✅ / **切点 ✅** / **空集 ✅** / 编辑后持久化 ✅ / 撤销 ✅ / 相机与选择 ✅ / CAD 视图与导出 ✅ / **刻意的不支持布尔 ✅**。原先只剩单元判据的那两项已消掉。
- **留档**：那次失败的做法（直接种草稿）与原因（**恢复路径信任保存下来的派生字段**，不会为手写草稿重跑 `recomputeDerivedObjects`）仍写在用例注释里，供后来人参考 —— 结论从"所以验不了"改成"所以改用让应用自己算"。
- **验证**：`tsc -p e2e/tsconfig.json` exit 0；`npm run lint` exit 0（0 error / 13 warning）。本批只改 e2e，未动产品源码。

## 2026-10-01 —— 球体 Task 8 尾巴：Agent 端到端（一句话造球），并记一条既有隐患

- **补上清单里最后一块纯技术工作**：浏览器里没有模型服务，规划器用的是**确定性本地规划器**；一旦产出了计划，下游（传输校验 → 动作编译 → 隔离草稿 → 用户确认 → 原子落盘 → 撤销）与真实模型**走同一条**。所以给它加一条球指令，就能把那条链路真的跑一遍。
- **改动**：
  - `apps/web/src/agent/localPlanner.ts`：新增 `SPHERE` 构建器与指令条目，并导出 `SPHERE_PROMPT`。半径从原话里读第一个数字（"半径 5"），读不到取 `DEFAULT_SOLID_SIZE` —— 与立方体 / 正四面体同一口径（默认值只有一处）。
  - **触发词只认「球体」，刻意不认裸词「球」**：裸词会把**分析题**拉进来 —— "求这个四面体的**外接球**半径并画出球"里既有"球"又要求读数，规划器若认裸词就会去**新建一只球**而不是回答。这与本文件里"认正四面体、不认裸四面体"是同一条纪律，理由写进了代码注释与用例。
  - `e2e/geometry3d-sphere.spec.ts` 增到 **6 条**：新的一条走**真界面**（Agent 工作区 → 发送 → 确认改动面板 → 确认并提交 → 返回画布 → 一步撤销），断言"停在确认"（`会新增 1 个对象`）、"确认前文档零改动"、"确认后对象行 = 1 且文档里半径 = 5"、"一步 Ctrl+Z 回到零"。
- **验证**：新增 `localPlanner.test.ts` 三条（**RED 起点 3 条全红**）→ **25/25 通过**；球 e2e **6/6**；全库 **278 文件 / 3182 项通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` exit 0（0 error / 13 warning）；`tsc -p e2e/tsconfig.json` exit 0。
- **一处如实记录的小差异**：Agent 这条路（和棱柱那条一样）**不写 `label`**，所以对象行显示的是 id 而不是"球体"。因此那条 e2e 按**行数**断言而不是按显示名 —— 拿名字断言会把"名字从哪来"这件无关的事绑进来。（手工入口那条路会自动起名"球体 N"，两条路的命名口径不同，属于既有设计差异，本批不改。）
- **顺带查实一条**既有**隐患（不是本批引入，也未修）**：把 `内切球` 那句分析题（"这个正方体的内切球半径是多少"）喂给本地规划器，命中的是**既有的「正方体」条目** —— 也就是说**它会去新建一只正方体，而不是回答那个读数问题**。这与文档里早就记过的"裸词四面体会命中分析题"是**同一类**问题，只是这次落在「正方体 / 立方体」上。本批只把它**记为发现**（用例里写成"命中的不是球那条"，不冒充成球的问题），修不修需要单独定口径。

## 2026-10-01 —— 球体 Task 9（收尾）：功能目录按审计结果更新 + 补一条真 e2e + 一条走不通的路留下原因

- **`docs/feature-catalog.md` 的球体条目按审计结果重写**（Task 9 明确点名了这份文件）：标题由"Task 1 已交付、整体未交付"改为"**Task 1–8 已交付；Task 9 的门禁复跑与 spec §5 审计已完成；球体能力尚未宣布整体交付**"，正文逐条列出①–⑧ 八块交付 + 审计结论，并**明写仍不能读成整体交付的三条理由**（切点/空集/不支持布尔只有单元判据、外接内切球读数仍不是球图元、发布三件套属 D 类需先定版本）。顺带修掉同文件里两处**已被推翻的旧表述**（根脚本 `npm run build` 后来已跑通）。
- **补上一条真 e2e**（`e2e/geometry3d-sphere.spec.ts` 增到 **5 条**）：**球参与的布尔交一个预览都不给**。做法是把"两个立方体**有**交预览"作为**反向对照**放进同一条用例 —— 少了它，"预览数恒为 0"（比如预览功能压根没开）也能让断言变绿。实测两条都成立：立方体 ∩ 立方体 > 0、球 ∩ 立方体 = 0，且文档未被改动。
- **一条走不通的路，连同原因留在用例文件里**（不删掉静默了事）：本来还想在浏览器里验 z=8 相切 / z=9 空集（spec §5 点名两例），做法是把球 + 截面直接种进草稿再读 `data-section-exact-kind`。**实测走不通**：种下去的截面**不会被重算** —— 连最容易的正圆那一档都读不出 `kind`（空串），而 `data-section-count` 是 1。也就是说**恢复路径信任保存下来的派生字段**，不会为一份手写草稿重跑 `recomputeDerivedObjects`。
  - 这**不是缺陷**（保存的文档本来就该是算好的），但它决定了**这条路验不了**：要么让应用自己算这一刀（工具栏那条已覆盖"过球心给精确圆"），要么把刀口按到刚好相切（代价大且脆）。
  - 因此这两例**仍是单元判据**（`sphereSection.test.ts` 钉 z=8 → `point`、z=9 → `empty` 且不留旧环；`createSectionMesh` 钉切点画得出标记）。原因写在 `e2e/geometry3d-sphere.spec.ts` 末尾的注释里，供后来人参考。
- **实测**：`e2e/geometry3d-sphere.spec.ts` **5/5**；`tsc -p e2e/tsconfig.json` exit 0。本批未改产品源码，故单元/类型/构建门禁读数与上一批相同（全库 278 文件 / 3179 项 + 1 todo / 0 失败）。

## 2026-10-01 —— 球体 Task 9（下半）：spec §5 逐行审计，查出一处**静默缺口并修掉**

- **审计方式**：spec §5 是一张六行的"必须看到的证据"表。逐行拿**真实文件与测试输出**去对（而不是相信文档），结果如下：
  - **文档契约与保存** ✅ —— Task 1 的 DSL 往返 + `sphereTransactions.test.ts` 的保存/重开 + `sphereAction.test.ts` 的事务往返；`solid-prism.spec.ts` 的"打开每一只随仓库发布的夹具"（15 只）覆盖"旧 fixture 继续加载"。
  - **解析截面** ✅ —— `sphere.test.ts`（z=6/8/9、非单位法向等价、尺度容差）+ `sphereSection.test.ts`（精确圆 / 切点 / 空集不留旧环 / 改半径后重算）。
  - **UI/撤销/场景** ✅ —— `e2e/geometry3d-sphere.spec.ts` 四条：未确认预览不落盘、确认一次提交、属性栏可改 + 一步撤销、球可拾取（点击后快捷操作条出现）、刷新后 C/r 不变。
  - **工程图/导出与测量** ⚠️ **查出问题（见下）** —— 四视图同半径（`sphereProjection.test.ts` + `engineering-drawing.spec.ts`）、三件套导出、`4πr²` / `4πr³/3` 精确读数（`sphereMeasurements.test.ts`）都有；但"**来源在属性/画布可读**"这一半**不成立**。
  - **不支持项** ✅（单元层）—— `sphereSection.test.ts` 三条：拒绝创建含球的 `intersectionSolid`、反向对照、旧缓存交集退化为 `insufficient-data`。**无 e2e**。
  - **门禁与上传** ✅ —— 全程"先红后绿"，六条门禁当次复跑并报数。
- **查出的静默缺口**：`apps/web/src/measurementVisuals.ts` 的 `pointPositions` 是一张**硬编码类型名单**（`polyhedron3` / `cube` / `pyramid` / `cylinder` / `cone`），**漏了 `sphere`** → 球的面积 / 体积测量让 `resolveMeasurementVisual` 返回 `null` → **画布上一个字都不画**。而**属性栏照样有数字**，所以这个缺口是**静默的**。
  - 这**正是同一张名单第二次漏配**（此前它漏的是 `polyhedron3`，由另一批补上）—— 与"加一种实体要改七八张名单"是同一个结构问题，只是这次是**测量标签**那张。
  - **修法**：加球分支，落点取**球心**（与圆柱 / 圆锥同一条口径：解析体的几何中心）。
  - **RED → GREEN**：新增 `measurementVisuals.test.ts` 一条，修前 `expected null not to be null`、修后 **6/6 通过**。
- **实测**：全库 **278 文件 / 3179 项通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` exit 0（0 error / 13 warning）。
- **仍未做**：① 计划点名的 e2e 覆盖里"切点 / 空集 / **刻意的不支持布尔**"目前只有**单元**判据（浏览器里没有可读读数能观察）；② `docs/feature-catalog.md` 还没按审计结果更新；③ 发布决策属 **D 类**（等用户决定版本与是否发布，且计划要求"匹配版本的安装包 + 安装证据"）。

## 2026-10-01 —— 球体 Task 9（上半）：全量门禁复跑，逐条报数而不是"全绿"

- **本批只做测量，不改产品代码**。六条门禁**当次全部复跑**，逐条写出读数（包括那个不好看的）：
  - `npx vitest run --maxWorkers=3` → **278 文件 / 3178 项通过 + 1 todo / 0 失败**
  - `npm run typecheck` → exit 0（6 个 workspace + `e2e/` + `scripts/`）
  - `npm run lint` → exit 0，**0 error / 13 warning**（既有基线警告）
  - `npx playwright test --workers=3`（**全量 e2e**）→ **175 通过 / 1 失败**
  - `npm run test:rust` → **16 个测试二进制 / 236 通过 / 0 失败 / 3 ignored**，exit 0
  - `npm run test:perf` → **9 / 9 通过**；`roundTrip/large-mgeo` 24.8 ms、`denseIntersections/200x200` 1.4 ms、`drag/300-frames` **682.5 ms（≈2.3 ms/帧**，60 fps 预算 16.7 ms/帧）、校准档 1× ≈6 ms vs 4× ≈16–22 ms
- **那条失败不是"忽略掉"的，是查实为既有不稳**：`e2e/geometry3d.spec.ts:277`「pans the 3D view along the camera axes within a bounded range」在 `expect(z).toBeCloseTo(startZ, 6)` 上失败（期望 1.98 / 实收 2）。
  - **核实方法**：它在**单独跑**时照样失败（排除并行抢 CPU）；再回到球体工作**之前**的 `91ac837` 单独跑这一条 —— **同样失败**（期望 **1.99** / 实收 2）。
  - 而且那个**期望值逐次运行会变**（1.98 / 1.99 都出现过），说明初始取景在本机本身不是完全确定的。
  - CI 的 `e2e` 作业在 Linux 上 #52 / #54 / #55 三次都是 success。
  - **结论**：本机环境敏感的既有不稳定用例，**不是本批引入的**；但**它让"全量 e2e"这条门禁在本机不可信** —— 所以如实记为"门禁不稳"，而不是写成通过。**本机 e2e 不能当放行依据，CI 的 `e2e` 作业才是。**
- **未做（Task 9 剩下的）**：① 计划点名的 e2e 覆盖清单**逐项对照**（数值创建 / 精确圆 · 切点 · 空集 / 编辑后持久化 / 撤销 / 相机与选择 / CAD 视图与导出 / 刻意的不支持布尔）；② **spec §5 逐行审计**（拿真实文件与测试输出去对每一行，而不是相信文档）；③ 发布决策 —— 计划明写"新的桌面 Release 还需要一个匹配版本的安装包 + 安装证据"，而那属于 **D 类**（等用户决定版本与是否发布）。

## 2026-10-01 —— 球体 Task 8：Agent 动作 `solid.create_sphere`（三层一起接）

- **背景**：手工路径（Task 6）已经能造球，Agent 这条还没有 —— 能力表里球明确写着 `temporarily_unavailable`。**产品的球路径已经存在，所以这个动作该发布了**（这正是本 Task 的标题："只有产品路径存在时才发布动作"）。
- **三层一起改（不搞"某一层先跑在前面"）**：
  - **动作层（scene-graph）**：`types.ts` 加 `SolidCreateSphereAction` 并进 `DraftAction` 联合；`actions/index.ts` 加 `compileSolidSphereAction` 与分派。球**只落一个图元**（不物化点 / 棱 / 面 / `polyhedron3`），与手工路径产出同一种文档。
  - **传输层（agent-core）**：`actionIds.ts` 加 id；`actionInputs.ts` 加 `case`（只挡明显畸形，**缺字段合法** —— `center` / `radius` 都登记了 `ask_user`，由审计去问用户；半径非正 / 非有限则**当场按字段路径拒绝**，好让一次性修复够得到）。
  - **登记层**：`actionRegistry.ts` 加条目（`center` / `radius` 都是 `ask_user`，**不静默填默认**）；`capabilities.ts` 把球由 `temporarily_unavailable` 翻成 **`available`**；`skills/manifest.ts` 的技能动作列表与 `CAPABILITY_FOR_ACTION` 各加一条。
- **验证（本轮实测）**：
  - 新增 `packages/scene-graph/src/actions/sphereAction.test.ts`（5 条）。**RED 起点 3/5 红**（`unknown_action`：动作还不存在）。
  - **一处自查**：另两条（"半径非法要拒""球心非有限要拒"）在实现之前**就是绿的** —— 动作未知时同样"不产出操作 + 有诊断"，等于什么都没钉住。已加断言要求诊断码是 **`invalid_sphere`**（而不是 `unknown_action`）。这是本项目**第五次**踩同一个坑，规矩已经写进归档。
  - `packages/agent-core/src/actionSchemas.test.ts` 加 **3 条**：合法输入通过、**缺 `center`/`radius` 也通过**（它们是 ask_user 字段）、半径 0 按 `tool.inputs.radius` 路径拒绝。
  - **闸门确实存在（一处旧表述要更正）**：`current-status.md` 里一直写着"登记表承诺 ≠ 校验层实现这类风险只写在文档里，**没有机器挡住**"。这一批证明**动作目录这一层是有闸门的**，而且是它把我挡下来的：
    - `CAPABILITY_FOR_ACTION` 是 `Record<DraftActionIdName, string>` —— 新增动作漏登记**编译不过**（`tsc` 当场报 `Property '"solid.create_sphere"' is missing`）；
    - `actionIds.test.ts` 钉动作总数（27 → 28）、`capabilities.test.ts` 钉球的状态（`temporarily_unavailable` → `available`）、`catalog.test.ts` 钉技能清单的**内容哈希**（改 `actionIds` 不改哈希就 `hash_mismatch`）。
    - 也就是说："新加一个动作要同时改哪几处"在**动作目录**上是被机器逼着改齐的；那条旧表述该收窄到它真正适用的范围（`section.create` 那类逐动作的**字段**覆盖面）。
  - **全库**：`npx vitest run --maxWorkers=3` → **278 文件 / 3176 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
  - 顺带修掉一处自己造成的编辑事故（见下）。
- **事故与教训（如实记）**：我用 PowerShell 改 `actionIds.ts` 时，把替换文本写在**双引号字符串**里却用了 `\"` 转义 —— PowerShell 不认 `\"`，结果把 `"solid.create_prism",` 整行替换成了一个孤立的反斜杠行（`create_prism` 一度从清单里消失）。**当场发现并用 .NET 精确替换修好**（现顺序已逐行核对）。教训：**源码文本编辑不要走 PowerShell 的字符串转义**，改用编辑工具或 .NET 字面量替换。
- **未做**：Agent 端到端（真模型跑一轮"画一个半径 5 的球"）——计划里 Task 8 提到 e2e，本轮只做到三层单元与传输层；Task 9（完整产品门禁）整块未做。

## 2026-10-01 —— 球体 Task 7：工程投影与导出

- **背景**：球在画布上、在截面里都通了，但**工程制图里没有它** —— `projectionVisuals.ts` 的 `templateTypes` 又是一张漏了 `sphere` 的硬编码名单（上一批已经预告过这一处）。
- **改动（1 个文件 + 1 个新测试文件 + 1 个新夹具 + 1 处 e2e）**：
  - `projectionVisuals.ts` 加球分支：**只画轮廓，不投影显示网格的三角形**。判据是球区别于所有多面体的那条性质 —— **正投影下球的轮廓永远是半径等于球半径的圆，与视线方向无关**（立方体在四个视图里是三个不同的矩形，球是四个同样大的圆）。
  - 采样结果仍是既有的 `polyline` 图元（`closed: true`），所以 `DrawingViewport` 与 `engineeringExporters` **一个字都不用改**（计划里那句"仅在共用契约需要变更时才改 exporters"因此不成立），`sourceId` 也仍是那个球。
  - 半径 / 段的采样复用既有的 `sampleProjectedEllipse`（构造一个长短半轴都等于球半径的椭圆），所以弦高容差、闭合处不重算 `t=2π` 这些既有约定全部继承。
- **验证（本轮实测）**：
  - 新增 `apps/web/src/sphereProjection.test.ts`（5 条）。**RED 起点 4/5 红**，症状是 `expected [] to have a length of 1`（球压根没被投影）。
  - **一处自查**：第 5 条"隐藏的球不出现"在实现之前**就是绿的** —— 球那时压根不投影，`toHaveLength(0)` 成立得毫无意义（本项目第四次踩这个坑）。已改成**反向对照**：同一份文档里放一个隐藏的球 + 一个可见的空间点，点必须照常投影、球必须不出现。
  - 四个视图的**半径相等**由单元用例钉住（逐个视图把采样点集的形心当圆心、逐点量半径，都等于 5）；"投影中心就是球心投影"单独钉一条（front 视图下形心 = (1,2)）。
  - 新增夹具 `e2e/fixtures/cad-sphere.mgeo`，`e2e/engineering-drawing.spec.ts` 增到 **5 条**：逐个视图点名（第 N 个视图里恰好一条球轮廓，而不是"总共 4 条"——否则"四条全挤在一个视图里"也会绿），并断言"暂无可投影的空间对象"提示消失、三件套（SVG / DXF / PDF）都能导出且扩展名正确。**5/5 通过**。
  - **全库**：`npx vitest run --maxWorkers=3` → **277 文件 / 3168 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **如实说明**：新增那条 e2e 的 **RED 没有被独立观察到** —— 我只观察到单元用例的 RED（`expected [] to have a length of 1`）。e2e 断言的是 DOM 上的 `[data-source-id="sphere-1"]`，而那个属性只可能由投影产生，所以两者走的是同一条代码路径；但"e2e 在修改前必红"是**推理**，不是**实测**。
- **未做**：Task 8–9（Agent 创建球、完整产品门禁）。
- **CI 抓到我漏掉的一处（当轮已修）**：本地我只按文件跑了自己那两个 spec，**没有跑全量 e2e**；CI 的 `e2e` 作业红了。原因不是投影逻辑，而是**我新增了一个夹具文件** `e2e/fixtures/cad-sphere.mgeo`，而 `e2e/solid-prism.spec.ts` 有一条"打开**每一只**随仓库发布的 `.mgeo` 夹具"的用例，它**硬编码**了夹具个数：
  - `expect(fixtures.length).toBe(14)` → 实测 15（`Expected: 14 / Received: 15`）。
  - 这条断言本身是**有意**的（注释写着"目录里少一个文件也不该让这条静默变松"），所以正确做法是把数字改成 15 并写清来源，而不是把它放宽成 `toBeGreaterThan(0)`。
  - **教训**：**新增一个夹具文件是一次跨切面的改动** —— 它会被"清点目录"的用例数到。这又是本项目那个主题的又一例：**同一个事实散在多处硬编码的地方**（这次是"夹具有几只"）。本地只跑受影响的 spec 不足以替代全量 e2e；CI 才是兜底。
  - 修完复跑**全量 e2e：176 通过 / 0 失败**。

## 2026-10-01 —— 球体 Task 6（上半）：从「常用立体」手工造一个球

- **背景**：Task 5 之后球已经能画、能选、能切，但**没有任何界面入口能造出一个球** —— 上一批的浏览器验收甚至得先建个立方体、再把草稿里的图元偷换成球才验得了。这一批把入口补上。
- **改动（3 个文件 + 2 个新测试文件 / 2 处既有测试更新）**：
  - `spatialSolidWizardModel.ts`：`SolidPreset` 加 `"sphere"`，草稿加 `radius`（默认 2，球心沿用 `origin` 那个字段）；`solidWizardInput` 里球**先判**并单独校验（半径有限正数、球心有限），报错文案点名"球"。
  - `spatialSolidCommands.ts`：`TeachingSolidInput` 加 `{ kind: "sphere"; center; radius }`；`buildTeachingSolid` 的球分支**只落一个图元**（解析实体，不像立方体 / 棱柱那样物化点 / 棱 / 面 / `polyhedron3`），标签 `球体 N`。
  - `components/SpatialSolidWizard.tsx`：预设列表加「球体」（六 → 七），球只渲染**球心 + 半径**两个入参 —— 底面 / 拉伸向量 / 顶点偏移那一整套都不显示（它们与球无关）。
- **为什么要"球先判"**：共用那套尺寸校验会让球平白背上 `width/depth/height` 的合法性约束，而且报错会与棱锥那条混成一句看不出所以然的话。实测 RED 就是这个现场：球预设当时**掉进棱锥分支**，报 `{ kind: 'pyramid' }`、`Cannot read properties of undefined (reading 'length')`。
- **验证（本轮实测）**：
  - 新增 `apps/web/src/spatialSphereWizard.test.ts`（7 条）。**RED 起点 5/7 红**，成因如上。
  - **一处自查**：其中两条（"半径非法要拒""球心非有限要拒"）在实现之前**就已经是绿的** —— 因为球那时走棱锥分支、棱锥分支同样会拒 0/NaN，等于什么都没钉住。已加断言要求**报错文案点名"球"**，改法之后它们在实现前是红的。
  - `SpatialSolidWizard.test.tsx`：把"六个课堂立体"更新为**七个**（并在断言里点名"球体"），另加一条"球只提供球心 + 半径，不出现底面宽 / 拉伸向量 / 顶点偏移"。
  - **浏览器验收** `e2e/geometry3d-sphere.spec.ts` 增到 **2 条**（新增"从「常用立体」造球"）：参数改完但**没点确认**之前文档里不该有球（预览只改画面）、画面确实有东西（"这里什么都没有"的提示消失）、半径填 0 时如实报原因且文档没动、确认后恰好一个球且球心/半径逐值相等。**2/2 通过**。
  - **全库**：`npx vitest run --maxWorkers=3` → **276 文件 / 3163 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
  - 顺带修掉一处自己引入的类型错误：新测试里写了 `createEmptyDocument("geometry")`，而 `Workspace` 没有这个名字（合法值：`calculus` / `conics` / `cad` / `geometry3d`）—— 单测不报、`tsc` 当场报。
- **下半（属性栏编辑 + 截面按钮）也已落地**：
  - **属性栏编辑球心 / 半径**：`inspectorLabels.ts` 的 `SolidPrimitive` 与 `inspectorModel.ts` 的 `selectedSolid` 名单加入 `"sphere"`；`PropertiesBar.tsx` 加球的分支（**只有球心 + 半径 3D 两个字段**，用的是 Task 3 打通的 `updatePrimitive { center3, radius3 }`），并给"朝向"那块加 `selectedSolid.type !== "sphere"` 守卫 —— **球没有 `rotation` 字段**（解析体没有朝向），不加守卫 `tsc` 直接报错。
  - **工具栏「创建截面」对球可用**：`solidCommands.ts` 的 `solidTypes` 加入 `"sphere"`（它同时管着按钮的 `disabled` 与命令的守卫），对应测试的名单断言同步更新。
  - **还有一张更深的名单**：`packages/dsl/src/schema.ts` 里**另有一份** `solidTypes`，`section` 的校验写着"来源必须是实体" —— 不加球的话，界面点下去会被**文档校验层**挡掉，症状是"按钮可点但什么都没发生"。这一处是**跑 e2e 才暴露的**（单元测试全绿）。
- **验证（下半，本轮实测）**：
  - `e2e/geometry3d-sphere.spec.ts` 增到 **4 条**，新增两条：①"属性栏改球心 / 半径、一步撤销"（RED 起点是 `expect(locator).toHaveValue` 找不到"半径 3D"字段）；②"工具栏切一刀并记录精确圆"（断言 `data-section-count=1`、`data-section-exact-kind=circle`、`data-section-exact-status=exact`、交圆采样点 > 2）。**4/4 通过**。
  - **全库**：`npx vitest run --maxWorkers=3` → **276 文件 / 3163 项通过 + 1 todo / 0 失败**（含球布尔门禁那条 —— 说明 `schema.ts` 放开"球可当截面来源"之后，**"球不能参与布尔交"仍然成立**：那四处检查在查这张表**之前**先查 `hasSphereSource`）。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **一处结构性发现（值得单独记）**：给这个项目**加一种实体**，要同时改**七八张硬编码的类型名单**。球这一路已经踩过：`visibleSolids`（否则不进场景）、`pickKind`（否则看得见选不中）、`hasGeometry`（否则说画布是空的）、`schema.ts` 的 `solidTypes`（否则截面被文档校验挡掉）、`solidCommands.ts` 的 `solidTypes`（否则按钮不可点）、`inspectorModel` + `inspectorLabels`（否则属性栏不认识）。每一处漏掉都**不报错**，只是那条功能静默失效 —— 而且单元测试全绿。**下一处已知的还没改**：`projectionVisuals.ts` 的 `templateTypes`（Task 7 的工程投影）。

## 2026-10-01 —— 球体 Task 5（上半）：画的球与"不许出现经纬网"

- **背景**：Task 1–4 让球在**文档层**完整（类型、解析截交、可编辑可测量、截面接入 + 布尔门禁），但画布上**根本没有球** —— `SolidPrimitive` 只含 cube/pyramid/cylinder/cone，球会掉进"圆锥"那条分支。
- **改动（2 个文件 + 1 个新测试文件）**：
  - `apps/web/src/threePrimitives.ts`：
    - `SolidPrimitive` 联合类型加入 `SpherePrimitive`；`visibleSolids` 的过滤列表加入 `"sphere"`（否则球压根不进场景）。
    - `createSolidMesh` 加球分支：`SphereGeometry(radius, 48, 32)`，位置是**球心**。
    - `createSolidGroup` 对球**不画任何线**（`solidOutline` 与 `hiddenEdgeOverlay` 都跳过）。理由写进了代码：两者都是 `EdgesGeometry`，套在球面上会拆出一整张**经纬网** —— 几十条看得见、也**选得中**的"棱"，用户点球面会选到一条虚构的边；而 spec 明确不要"密集的可选中经纬线"。球真正的轮廓是**视角相关**的屏幕空间剪影，不是网格边，所以这里如实不加，而不是加一圈"看着像轮廓"的假边。
    - 网格密度取 48×32（与圆柱默认 48 分段同一量级）并写明：**它只是显示缓存**，文档只存球心与半径，改这个数不会动 `.mgeo` 一个字节。
  - `apps/web/src/threePicking.ts`：`pickKind` 的实体列表加入 `"sphere"` —— 少了它，点球面不会被认成实体，球"看得见但选不中"。
- **验证（本轮实测）**：
  - 新增 `apps/web/src/threeSphere.test.ts`（5 条）。**RED 起点：4/5 全红**，症状逐条对上"球走了圆锥那条分支"：出现了 `LineSegments`（经纬网）、开了隐藏边后变成 2 条、**`mesh.position` 是 `[1, NaN, 3]`**（球没有 `height`，`center.y + undefined / 2` 直接是 NaN）、`visibleSolids` 返回空。
  - **GREEN**：同一条命令 **5/5 通过**。
  - **一处自查**：第 5 条"隐藏的球不进场景"在实现之前**就是绿的**（`visibleSolids` 当时压根不认球，返回空数组碰巧满足 `toHaveLength(0)`）—— 典型的"为错误的理由通过"。已改成**反向对照**：一份文档里同时放可见球与隐藏球，必须只留下可见那一个；改法之后它在实现前是红的。
  - **全库回归**（因改了 `SolidPrimitive` 这个核心联合类型）：`npx vitest run --maxWorkers=3` → **275 文件 / 3152 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **下半（同一批的后续）也已落地**：
  - **相切的那一个点现在画得出来**（`threePrimitives.ts` 的 `createSectionMesh`）：此前第一行是 `points.length < 2 → return null`，于是**"相切"和"根本没切到"在画布上长得一模一样** —— 两个都是空的，用户无从分辨。新增 `points.length === 1` 分支：在切点画一个标记（`SphereGeometry(1,16,12)` 缩到手柄半径，与交点图元同一套尺寸语言），`visualRole = "section-tangent-point"`。空集仍然返回 `null`（反向对照：没切到**不许**出现假标记）。
  - **球的自动取景不用改**：`threeCamera.ts` 的取景是从**场景对象**算包围盒的（`contentRadiusExcluding`），球现在有了真网格，所以自动纳入 —— 这一条是"查实后确认不需要改"，不是漏做。
  - **`selectionCommands.ts` 里那张实体名单刻意不加球**（已加注释说明）：那句引导语是"点击棱或面默认选中整个实体；按住 Alt 点击可单独选中棱或面"，而**球既没有棱也没有面**（它是解析体，没有 `edge3`/`face3` 子对象）—— 给球弹这句引导是**误导**。
  - **新增浏览器实机验收** `e2e/geometry3d-sphere.spec.ts`（1 条）：球**还没有手工入口**（那是 Task 6），所以用例借应用自己的"添加立方体"落一份**合法**草稿、再把 `primitives` 换成球 —— 文档其余字段（图层 / 元数据）由应用保证，不在测试里手搓。断言：刷新后球的 C/r 逐值不变 → 对象树里以"球体 1"出现 → **刚刷新时快捷操作条不可见、在球心投影处点一下之后必须可见**（这是"真的画出来了"唯一的实机证据：没画出来的话这一点命不中任何物体）→ 轨道相机方位角确实变了、而文档里的 C/r 一个字节都没变。
- **验证（下半，本轮实测）**：
  - `apps/web/src/threeSphere.test.ts` 增到 **8 条**（球网格 5 + 相切标记 3）。**相切标记那条 RED 起点是 `expected null not to be null`**；另两条反向对照（空集仍 `null`、圆截面路径没被抢走）一开始就是绿的。
  - `e2e/geometry3d-sphere.spec.ts` → **1/1 通过**。**变异检查**：把 `"sphere"` 从 `visibleSolids` 拿掉 → 该用例当场红在 `expect(locator).toBeVisible()`（快捷操作条找不到）—— 证明它真的守着"球被画出来"这件事，不是只读文档。探针已还原。
  - **全库**：`npx vitest run --maxWorkers=3` → **275 文件 / 3155 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
  - 一处**自查**：这份 e2e 的初版里我写了一句拿方位角**自己和自己比**的断言（`not.toBeCloseTo(同一个读数)`），它永远不可能满足、只会超时 —— 等于把"相机真的转了"这条判据写废了。已改成先记下拖动前的方位角再比。同一版还因为单次 `mouse.move` 没触发旋转而红过一次，改用 `{ steps: 8 }`（既有 spec 的成熟写法）后通过。
- **仍未做（Task 5 剩下的两条判据）**：**经界面**创建球并切一刀来验"切点可见"（球的截面按钮是 Task 4 的尾巴、手工入口是 Task 6）；"没有密集可选中经纬线"只有单元判据（浏览器里没有可读的读数能观察它）。
- **视觉验收抓出一处真缺陷并已修**（计划里"visually inspect an actual frame"那一条真的有用）：按要求把种子球那一帧截下来人工看一眼，发现球画得对（剪影干净、**没有经纬网**），但**画布中间压着一句"添加点、线或面开始探索三维空间。"** —— 场景里明明有球，应用却说这里是空的。
  - **根因**：`threeScene.tsx` 的 `hasGeometry` 又是一张**硬编码类型名单**（`point3/line3/…/cube/pyramid/cylinder/cone`），**漏了 `sphere`**，于是一份只含球的文档被判成空图纸。这和 `visibleSolids` 是同一类漏配 —— 又一次"同一个判断散在多张名单里"。
  - **为什么单元用例全绿也没抓到**：`hasGeometry` 是组件里的局部常量，只有真渲染那一帧才看得见。所以这条**唯一的判据就是看一眼截图**。
  - **修法**：名单加入 `"sphere"` 并写明理由。**回归**钉在 `e2e/geometry3d-sphere.spec.ts` 里：断言那句空图纸提示 `toHaveCount(0)`。
  - 证据（修复前那一帧）见提交信息与 `docs/project-progress.md` 的 Task 5 一节。

## 2026-10-01 —— 球体 Task 4（上半）：球的解析截面接进 `SectionPrimitive`

- **背景**：Task 2 有了"球 ∩ 平面"的解析式，Task 3 让球可编辑可测量，但**截面还是画不出来** —— `recomputeSection` 里球走不到任何一条分支，落进兜底那句 `classification:"insufficient-data" / status:"failed"`，诊断还写着"截面来源不是可剖切的实体"。本批把这条接上。
- **改动（2 个文件 + 1 个新测试文件）**：
  - `packages/scene-graph/src/sectionRecompute.ts`：
    - `analyticSectionBoundary` 认球 —— 球走 `spherePlaneSection3`，**不是**二次曲面那套矩阵表示（球没有 `bounds`，`sectionQuadric3` 对它会直接回退，压根到不了那一行）。三种结局 `circle` / `point` / `empty` 本来就在 `Conic3Kind` 里，不新造枚举。
    - `recomputeSection` 加球分支：圆 → `classification:"polygon"` / `status:"exact"` / `visible:true`；**切点 → `classification:"point"` / `status:"exact"` / `visible:true`**（spec §3 要求画布上有一个点标记；这点与多面体那条路径**刻意不同** —— 那边相切时把截面藏起来，因为多边形切在一点上确实没有可画的边界）；空集 → `classification:"none"` / `status:"undefined"` / `visible:false`。
    - `section.points` / `loops` 按 spec §3 只当**可再生显示缓存**：由 `conic3PointAt` 采样解析圆得到（48 段，与圆柱默认分段同一视觉密度），真几何在 `section.exact` 里。文件里写明了**不许**拿这 48 个点去算面积 / 弦长冒充精确圆。
    - `analyticSectionBoundary` 仍是"源 + 平面 → 解析边界"的**唯一**一处映射；球分支里重算的只是同一个纯函数在同一组入参上的几个浮点运算，规则没有写两遍。
  - `packages/scene-graph/src/solidGeometry.ts`：`sectionPlaneThroughSource` 对球返回**过球心**的水平面（`constant = -center.z`）。球没有顶点可算包围盒，但球心就是它的几何中心；过球心切出来的是大圆，既最容易看见、也最容易和"压根没切到"区分开。
- **验证（本轮实测）**：
  - 新增 `packages/scene-graph/src/sphereSection.test.ts`（7 条）。**RED 起点：7/7 全红**，失败原因如实是"球落进兜底分支"（`exact` 为 `undefined`、`points` 为空、`classification` 是 `"insufficient-data"`、默认平面返回 `null`），不是断言写错。
  - **GREEN**：同一条命令 **7/7 通过**。
  - **全库回归**（因改的是所有截面共用的 `recomputeSection`）：`npx vitest run --maxWorkers=3` → **274 文件 / 3144 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**，与基线一致）。
  - **插曲（如实记）**：第一次 typecheck 报 exit 2 —— 新测试把 `PrimitiveSpec` 从 `@draw/geometry-kernel` 导入，而那个类型属于 `@draw/dsl`。当时整套单测是绿的，因为那是个 `import type`，运行时会被擦除、vitest 不做类型检查。改对之后 typecheck exit 0，并按纪律**重跑了整套单测**（读数同上），没有拿"改动只是类型层面的"当借口跳过验证。
- **判据的两条实质**：
  1. 显示缓存里的点必须**真的落在球面上**（回代 `|X−C|²=r²` 残差 < 1e-9）**且在剖切面上** —— 两个条件缺一条就说明缓存是编出来的；
  2. 改半径之后，**显示缓存与解析系数两边都重算**（半径 5 → 交圆半径 4、系数 `−16`；半径 4 → 交圆半径 `√7`、系数 `−7`）。只更新一边就等于"画的和算的不是一件事"。
- **下半（布尔门禁）也已落地**：
  - `packages/dsl/src/schema.ts`：新增一处判据 —— 四种布尔图元（`intersectionLine` / `intersectionSolid` / `intersectionFace` / `intersectionPoint3`）的**来源里出现球**时，报一条点名球的 `unsupported` 诊断（`… does not support a sphere source (unsupported): only sphere ∩ plane is exact; sphere ∩ sphere and sphere ∩ polyhedron are not implemented`）。
  - **为什么必须单独一句话**：球**本来就是实体**，让它掉进下面那句 `sources must be solids`，用户看到的是"需要实体"、而他手里给的正是实体 —— 那句话对球既没错也**没用**。这正是这一条要修掉的东西。四处共用同一个 helper，判断只写一份。
  - 创建时即拒（`changed=false`）且**返回原文档本身**（同一引用，不是"改了一半又回滚"的等价副本）；旧文档里已缓存的球交集重算仍如实退化为 `insufficient-data` / `visible:false` / 空顶点，**不伪造多面体**。
- **验证（下半，本轮实测）**：
  - `sphereSection.test.ts` 增到 **10 条**：门禁 2 条（拒绝 + "两个立方体照样放行"的**反向对照**，否则"一律拒绝"也能让它变绿）与防御性重算 1 条。**RED 起点：这 3 条全红** —— 当时诊断是 `intersectionSolid sources must be solids`（不含 `unsupported`、也没点名球）。
  - 顺手纠正了自己测试里一处 API 误用：`recomputeDerivedObjects` 返回的是 `GeometryDocument` 本身，不是 `{ document }`（RED 时报 `Cannot read properties of undefined (reading 'primitives')`）。
  - **全库**：`npx vitest run --maxWorkers=3` → **274 文件 / 3147 项通过 + 1 todo / 0 失败**。
  - 点名的那组截面 / 交测试（16 个文件：`section-loops`、`section-quadric`、`sections3d`、`section-materialization`、`intersectionSolid`、`intersectionLine`、`intersection-surfaces`、三个 `intersectionPreview*`、`threeIntersectionSolid` 等）→ **163/163 通过**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **未做（Task 4 剩下的）**：`apps/web/src/solidCommands.ts` 的截面按钮在 UI 上"选中球就能切"这一步、以及球截面的 e2e；删除级联语义本身**未改**（全库含 `deletion-cascade` 全绿，说明没有连带破坏）。

## 2026-10-01 —— 球体 Task 3：球的场景事务与数值测量

- **背景**：承接 Task 2（球-平面解析数学）。Task 3 要让球成为**文档里可编辑、可测量、可保存**的普通对象，而不是一个"只能摆着看"的类型。
- **改动（4 个文件 + 2 个新测试文件）**：
  - `packages/scene-graph/src/transforms.ts`：
    - `translatePrimitive3` 加球分支（平移球心、半径不变）；
    - `EDITABLE_GEOMETRY_TYPES` 与 `isFreeDraggable3` 加入 `"sphere"`。**这两处是真正的门**：`apply.ts` 的 `updatePrimitive` 先查 `EDITABLE_GEOMETRY_TYPES`（不满足直接 `changed=false, error:"object is not editable"`），`translatePrimitive3` 先查 `isFreeDraggable3`。**只改 `apply.ts` 的分支是不够的** —— 这正是本批第一次跑 RED 时踩到的。
  - `packages/scene-graph/src/patches.ts`：`center3Types` / `radiusTypes` 加入 `"sphere"`（球心与半径是它自己的字段，与圆柱/圆锥/轨道圆同一套"有限、正数"校验），错误文案同步为 "only cylinders, cones, spheres and circle tracks support …"。没有测试钉着旧文案，已核对过。
  - `packages/scene-graph/src/apply.ts`：`updatePrimitive` 加球分支 —— 只有 `center3` 与 `radius3`，**没有** `segments` / 朝向（显示网格是画布缓存，不进文档）。
  - `packages/geometry-kernel/src/measurements3d.ts`：球的面积 `4πr²` 与体积 `4πr³/3`，均标 `exact-input`。
- **为什么测量要单独钉**：同一个球如果走"三角网格求和"，48 边形的结果会明显偏小，而且**随画布网格密度漂** —— 读数会跟着渲染设置变。球是解析实体，读数必须来自解析式，所以用例直接钉 r=2 → `16π` / `32π/3`，并额外断言体积按 r³ 走（3 倍半径 = 27 倍体积）。
- **验证（本轮实测）**：
  - 新增 `packages/scene-graph/src/sphereTransactions.test.ts`（7 条）与 `packages/geometry-kernel/src/sphereMeasurements.test.ts`（4 条）。
  - **RED 起点**：4 条失败，原因如实记录为"球的编辑/平移被两道白名单挡在门外"，不是断言写错。
  - **GREEN**：`sphere.test.ts` + `sphereMeasurements.test.ts` + `sphereTransactions.test.ts` → **3 文件 24/24 通过**。
  - **全库回归**（因为动了共享白名单，必须跑全套）：`npx vitest run --maxWorkers=3` → **272 文件 / 3134 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**，与既有基线一致）。
- **一处自查并已加固的地方**：`sphereTransactions.test.ts` 里"非法半径整笔拒绝"两条在实现之前**就已经是绿的** —— 因为球当时压根不支持改半径，`changed=false` 成立得毫无意义（典型的"为错误的理由通过"）。已加断言 `expect(rejected.error).toMatch(/radius must be positive/)`，把**拒绝的理由**也钉住。
- **未做**：Task 4–9（截圆接入 `SectionPrimitive`、3D 网格与拾取、工程投影、手工/预览入口、Agent 创建、完整产品门禁）。Task 3 的方框按计划纪律**等 CI 四项全绿之后再勾**。
- **交付闭环**：代码提交 `44353ad` 推送后核对远端 SHA = 本地；CI run `36964580061` 的 `checks` / `build` / `rust` / `e2e` **四项全部 success**。勾选前补了两件事：① 跑齐 Task 3 点名的四个既有聚焦文件（`scene-store` / `patches` / `recomputeConsistency` / `measurements3d`）= **126/126**，确认**没有回归**（本 Task 的 RED 来自新增聚焦文件，不是靠改既有文件制造红）；② 补上原本缺的**撤销/重做**覆盖 —— 新增 `apps/web/src/sphereHistory.test.ts`（3 条：改半径 = 一步撤销、撤销后球仍在、**被拒绝的编辑不压历史**，否则下一次 Ctrl+Z 会变成空操作）。球用例合计 **27/27**。
- **一处范围说明**：Task 3 原清单里的「source section recompute」**不在本 Task 交付** —— 球当时还不是 `SectionPrimitive` 的来源；该子项由 **Task 4** 覆盖。已写进计划，避免被读成漏做。

## 2026-10-01 —— 球体 Task 2：球-平面精确数学与退化（内核 `spherePlaneSection3`）

- **背景**：球体九块计划（[`docs/superpowers/plans/2026-10-01-sphere-and-sections-implementation-plan.md`](docs/superpowers/plans/2026-10-01-sphere-and-sections-implementation-plan.md)）此前只交付了 Task 1（DSL 类型 + 校验）。本批按计划做 **Task 2**：把"球 ∩ 平面"做成**解析**判定，而不是把球切成多面体再求交。
- **新增** `packages/geometry-kernel/src/sphere.ts`：
  - `spherePlaneSection3(sphere, plane)` —— 设 `n̂ = n/|n|`、有符号距离 `d = (n·C + constant)/|n|`，交圆圆心 `C − d·n̂`、半径 `√(r² − d²)`；三种结局 `circle` / `point` / `empty`，非法输入返回带 `code` 的 `invalid`（`invalid_sphere` / `invalid_plane`），**不编一个"看着像"的圆**。
  - 圆分支同时给出 `conic`（复用既有的 `circleConic3`，所以能直接进 `Conic3` / `section.exact` 那套）与 `loops` —— 球是无端面实体，整条交圆是一段完整参数域 `[0, 2π]`，**不需要**圆柱/圆锥那套端面弦裁剪（与 `section-quadric.ts` 形成对照）。
  - 退化到切点时**刻意不返回** `√(r²−d²)` 算出的"极扁圆"：那个数在 `|d| ≈ r` 的区间里完全是噪声。
- **判据两条（都写进了用例）**：
  1. **交圆上的点真的落在球面上** —— 逐点采样回代 `|X − C|² = r²`，残差 < 1e-9。而不是断言"坐标看起来是整数"。
  2. **退化容差与模型尺度同源**（相对量 `r·1e-9`，不是绝对阈值）。两个方向各一条用例：半径 `1e-6` 的球上 `1e-12` 的绝对间隙是**真实间隙**（空集），半径 `1e6` 的球上 `1e-6` 的间隙是**数值噪声**（相切）。绝对阈值在这两处会各错一次。
- **验证（本轮实测）**：
  - `npx vitest run packages/geometry-kernel/src/sphere.test.ts` → **13/13 通过**。RED 起点是 `Failed to resolve import "./sphere"`（模块不存在，不是测试环境问题）。
  - 连同 `quadrics.test.ts` + `section-quadric.test.ts` 三个解析层文件一起跑 → **35/35 通过**（确认没有破坏既有的圆锥曲线分类与有限实体裁剪）。
  - `tsc -p packages/geometry-kernel/tsconfig.json` exit 0；`eslint` 三个改动文件 exit 0。
  - **变异检查**：把 `tolerance = radius * RELATIVE_TOLERANCE` 改成绝对量 `RELATIVE_TOLERANCE` → **恰好**那两条尺度用例变红（其余 11 条不动），证明这两条断言不是空转；探针随后还原，`git grep MUTATION-PROBE` 无输出。
- **有意偏离计划原文一处**：计划把"不相交"拼作 `kind:"none"`，内核实现用 `"empty"`。理由是 `Conic3Kind`（`"circle" | "ellipse" | … | "empty" | "insufficient-data"`）已经是内核的既有枚举，而 `"none"` 是 DSL `Section3Classification` 的产品层拼法 —— 同一个概念在内核里再起一个同义名，正是这个项目吃过亏的"同一个判断写了两遍"。映射在 Task 4 的 `sectionRecompute` 一层做（`empty` → `classification: "none"`）。
- **未做**：Task 3–9（截圆接入 / 3D 渲染 / 工程投影 / 交互 / Agent 创建）一条都没动；`sectionQuadric3` 也**没有**被改成走球体（球没有 `bounds`，仍如实回退既有路径）。Task 2 的方框按计划纪律**等 CI 四项全绿之后再勾**。
- **交付闭环**：代码提交 `22bd7a2` 推送后核对远端 SHA = 本地；CI run `36963752920` 的 `checks` / `build` / `rust` / `e2e` **四项全部 success**，随后才在计划里勾上 Task 2，并把计划 Interfaces 行里"不相交"的拼法由 `"none"` 更正为 `"empty"`（附理由），避免计划与代码互相打架。

## 2026-10-01 —— `main` 未发布修复：相机最后一帧标签对齐

- `a4e2f40`：`threeSceneRender.render()` 在顶点/测量 HTML 标签投影前显式同步相机矩阵，不再依赖网格渲染的偶然副作用；浏览器用例移除松手后的额外指针抖动。无网格隔离测试修前约 386px 漂移、修后对齐。
- 本地全库 269 文件/3105 测试通过 + 1 todo、全量 e2e 171/171；GitHub CI run `36901742182` 四作业成功。**尚未为这批新代码重打桌面安装包**。

## 2026-10-01 —— `main` 未发布修复：实体体积数字浮现在画布

- `374daa0`：`polyhedron3` 体积测量以物化顶点求画布标签中心，缺顶点不画假数字；沿用原有测量标注样式。真实斜棱柱显示 48.000u³，保存重开仍可见。
- 本地全库 268 文件/3104 测试通过 + 1 todo、全量 e2e 171/171；GitHub CI run `36898807030` 的 checks/build/rust/e2e 四作业成功。**没有重新打包或安装桌面发行包**，不属于 v3.0.1 二进制内容。

## 2026-10-01 —— `main` 未发布功能：单顶点编辑（非 v3.0.1 安装包）

- `cc9f533`：棱柱与模板实体的单顶点数值编辑将受影响的非共面四边形改为有效三角片，保留严格共面规则；新增内部细分棱、稳定的面/棱引用与不同面名，重合顶点修改被原子拒绝。棱柱/模板保存重开、撤销重做、改后体积与截面均有回归。
- 本地：全库 268 文件/3103 测试通过 + 1 todo，全量 e2e 171/171；GitHub CI run `36895877862` 的 checks/build/rust/e2e 四作业通过。此次只更新 `main` 代码和文档，**未重新打出或安装桌面发行包**，不属于 v3.0.1 的二进制内容。

## 2026-10-01 —— v3.0.1：旋转环默认关闭 + z=0 网格"无限延伸"（顶点色淡出）；版本 3.0.0 → 3.0.1

- 本版内容与验证见 [`docs/release/v3.0.1.md`](docs/release/v3.0.1.md)；两处我自己造成的事故（着色器栅格"编译通过却没画出来"、PowerShell 把成对参数拆成字符导致两份文档连字符被替换）与合并处置也记在那份发布说明与本条提交信息里。
## 2026-09-30 —— 把"还差什么"集中成一份总清单（`current-status` §四），并同步到最新 `main`

- **用户要求"更新，同时查阅进度文档，看看现在有哪些未完成的任务"**。本轮先把本地 `main` 同步到最新（`0d22ab4` → 远端无新提交，`git ls-remote` 核对 = `1676452`），再通读各进度文档，把散落在五份文件里的"未完成"合并成**一处权威清单**：`docs/current-status.md` 的「**四、未完成任务总清单**」，分五类 ——
  - **A. 计划内未勾选 3 项**：Task 6 单顶点编辑（已定修法"拆三角形"，待实施）、Task 8 第 2 项的**根脚本 `npm run build` 整体命令**（桌面 `bundle` 已跑通，4 个 packages 的 `tsc` 未跑）、Task 8 第 3 项教师/学生走查（用户侧）。
  - **B. 计划外、已查实未修的缺口 3 项**：实体源（体积等）测量在画布上无数字（`pointPositions` 缺 `polyhedron3` 分支）、指针抬起前最后一次相机移动不触发渲染（差约 30px 且不自行收敛）、选中线时三色旋转环遮挡教学图面。
  - **C. 未复跑的门禁 3 条**：全量 `npm run test:e2e`（47 spec）、`test:perf`、`test:rust`。
  - **D. 发布与仓库收尾 3 项**：桌面产物未推 GitHub Release、未在本机安装 MSI/NSIS、已合并的远端功能分支未删除（且其 tip 的文档是过时版本）。
  - **E. 已决定或待决定未启动 4 项**：球体与球截面（**已决定启动**，需先另立方案）、题目截图→可编辑图、HTML/GeoGebra 导出、平面/函数逐题补缺。
- **顺带修掉一处残留的过时表述**：实施计划「执行快照」里还写着"桌面打包仍未做"，而同日 `632130a` 已经打出 exe/MSI/NSIS 并做了启动实测 —— 按事实改写，并把执行快照更新到 2026-09-30（含"计划外未做/未跑"那几条，且声明未完成清单的权威处在 `current-status.md` §四）。
- `docs/feature-catalog.md` 的「已知但未修的缺陷」加了一句指路，避免同一份事实在多处各说各话（本阶段已经吃过两次"过时清单被误读"的亏）。
- **同步结果**：`git fetch` 后远端 `main` 无新提交，本地 = 远端 = `1676452`（`git ls-remote` 核对）。本批**只改文档**，无可执行产物，故未跑代码门禁。

## 2026-09-30 —— 按最新 `main` 重做文档普查：补齐归档第四十九批、README、设计说明与当前状态

- **背景**：用户要求"所有进度文档都要更新"。先前那版普查（功能分支上的 `8c67346`）是在**知道 PR #1 合并之前**写的，只存在于功能分支，且把"未合并 `main` / 未打包"这类**当时已过时**的口径写了进去 —— 直接搬到 `main` 会把 `7729376`、`632130a` 已经更正过的事实**又改回错的**。所以本轮**在最新 `main`（`0d22ab4`）上重做**。
- **当时 `main` 上真正缺的四处**（已补）：
  1. **`docs/project-progress.md` 完全没有这批工作的记录** —— 新增「第四十九批」整节（Task 8 三批六类样题、两处缺陷修复含 RED→GREEN、各任务补充用例、本轮回归收口、三次自我更正与两条"两层独立守卫"、以及合并后 `main` 上的后续提交摘要），并给第四十八批那条"未完成六类样题组合验证"加前向指引；
  2. **`README.md`** 两处：把"六类教学题的完整组合验收……仍待完成"改正为**已完成 7/7**，并更新"下一步"那句；
  3. **设计说明 `docs/superpowers/specs/2026-09-29-…-design.md`** 的状态行：由"P0 与部分 P1……整期尚未验收"改为"已合并进 `main`、六类验收完成、桌面端已能打包"，并列出剩余项；
  4. **`docs/current-status.md`**：`P1 已在功能分支完成部分` → **`P1 已完成`**；Task 8 第 2 项改写为"代码侧四条门禁当次复跑 + 桌面端 `bundle` 已成功实测，**但根脚本 `npm run build` 作为整体命令仍未跑**"；本节"仍未完成"清单同步（去掉"桌面打包"、补上旋转环遮挡与根脚本 `npm run build`）。
- **不改的**：`docs/project-progress.md` 里各批次的**历史读数**（3066 / 44 项 / 8÷8 等）按该文件自己的体例保留 —— 它们是"写它的那一刻"的实测值。
- **核对**：本地 `main` 已由 `4d35b9d` 快进到 `origin/main` 的 `0d22ab4`（早先落后 53 个提交，已用 `git merge-base --is-ancestor` 验证是快进关系）。本批**只改文档**，无可执行产物，故未跑代码门禁。

## 2026-09-30 —— 桌面端（最新版）实际打包并启动实测：release exe + MSI + NSIS

- **为什么值得记**：此前"完整桌面打包"一直被记为**用户侧、没做**（还留着"P0 时一次 Rust 编译超过 180 秒而中止"的旧读数）。这一轮按要求**真的把它跑了**，产物落地、并做了启动实测，所以旧口径必须改。
- **命令与结果**：`npm --workspace @draw/desktop run bundle`（= `tauri build`；`beforeBuildCommand` 会先跑 `npm run build --workspace @draw/web`）→ **exit 0**。前端 `vite build` 输出到 `build-check/mathcanvas-current`（入口 `index-*.js` **1 694.94 kB** / gzip 490.28 kB，`engineeringExporters` 433.81 kB，`geometry.worker` 310.99 kB，CSS 100.34 kB；仍超 500 kB 的 chunk 警告是历史基线）；Rust `Finished \`release\` profile [optimized] target(s) in 27.43s`，随后 `candle`/`light` 出 MSI、`makensis` 出 NSIS。只多一条**无害**的 linker 警告（`linker stdout: 正在创建库 …dll.lib 和对象 …dll.exp`，`#[warn(linker_messages)]`）。
- **产物（2026-09-30 13:05，Windows x64，`FileVersion` / `ProductVersion` = 3.0.0，`ProductName` = MathCanvas）**：

  | 产物 | 路径（相对仓库根） | 大小 | SHA256 前 16 位 |
  | --- | --- | ---: | --- |
  | 免安装 exe | `apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe` | 16.39 MB | `D2F6218A93721215` |
  | MSI 安装包 | `apps/desktop/src-tauri/target/release/bundle/msi/MathCanvas_3.0.0_x64_en-US.msi` | 6.53 MB | `8DD330974092E838` |
  | NSIS 安装包 | `apps/desktop/src-tauri/target/release/bundle/nsis/MathCanvas_3.0.0_x64-setup.exe` | 4.79 MB | `92690919FBD24D0A` |

- **启动实测**：release exe 直接启动后**存活满 12 秒并取得真实窗口句柄**（`MainWindowHandle=722346`）；期间 WebView2 与项目仓储按预期初始化（`%LOCALAPPDATA%\com.mathcanvas.desktop\EBWebView`、`%APPDATA%\com.mathcanvas.desktop\projects.db-shm` 都有对应时间戳）。
- **一处先前误判的更正**：早先这次会话里两次"起来几秒就没了"被我先怀疑成崩溃/环境不支持 GUI；**经用户确认是他自己关闭了窗口**。三条佐证与"崩溃"不符：stderr 只有关闭期噪声 `Failed to unregister class Chrome_WidgetWin_0. Error = 1411`（窗口类注销失败）、Windows 应用事件日志**无**崩溃记录、应用自己的日志文件 0 字节。**桌面端是能起的**。
- **仍然没跑（别读成整条门禁通过）**：根脚本 `npm run build`（= `build --workspaces`）**作为整体命令没跑过** —— 它除 web 与 desktop 的 `tauri build --no-bundle` 外，还要跑 4 个 packages 的 `tsc -p tsconfig.json`；本次跑的是 desktop 的 `bundle`（对 desktop 那一档是**超集**，但 4 个 packages 的 `tsc` 构建未跑）。完整 `npm run test:e2e`、`test:perf`、`test:rust` 本轮同样未复跑。所以实施计划 Task 8 第 2 项**仍不勾选**。
- 未提交/未发布：产物在 `target/` 下（git 忽略），**没有**推到 GitHub Release，也**没有**在本机安装 MSI/NSIS（"打包成功"≠"装过"）。

## 2026-09-30 —— 功能分支已合并进 `main`；文档里"尚未并入 main"的过时表述按事实改正

- **事实**：`feat/high-school-geometry-interaction` 已通过 **PR #1** 合并进 `main` —— 合并提交 **`3b1f770`**（2026-09-30 12:46:30；父提交 `4d35b9d`（合并前的 `main`）与 `e016f37`（分支 tip，"本轮总收口并暂停"那笔），两者都已用 `git merge-base --is-ancestor` 核实是它的祖先）。本地 `main` = `origin/main` = `3b1f770`，`.git/refs/remotes/origin/main` 于 **2026-09-30 12:50:19** 由 `fetch --all --prune --tags` fast-forward 到该提交；远端分支 `origin/feat/high-school-geometry-interaction` **仍存在（未删除）**。
- **改了什么**：把四处"尚未并入 `main` / 未合并"的**过时表述**按上述事实改正 —— `docs/current-status.md`（页首更新时间、本轮小节标题、"本轮结束时的交接"两条）、实施计划「执行快照」标题与末条、`docs/research/2026-09-29-high-school-geometry-interaction-progress.md`（页首与三处状态句）、`docs/feature-catalog.md`「本期收口」（引言与第 6 条）。`docs/project-progress.md` 是**归档**（记"当时实测"），其历史条目按该文件自己的体例**不改**。
- **没有变的**：桌面打包（`npm run build`，含 Tauri/Rust）**仍未做**；教师/学生走查**仍未做**；Task 6 单顶点编辑（已定修法：把受影响的面拆成三角形）**仍待实施**；球体与球截面**尚未启动**（需先另立方案与实施计划）。
- **核对（如实，分两步）**：写这份记录时第一次 `git ls-remote origin main` **失败**（`Connection was reset`，网络间歇），所以"远端 tip"一度只引用 2026-09-30 12:50 那次 fetch 的结果；**随后复跑成功，返回 `3b1f770`（当时的远端 `main` 就是这个合并提交）**；本批文档提交 **`7729376`** 推送后，`git ls-remote origin refs/heads/main` = `7729376` = 本地 `HEAD` = `origin/main`。
- 本批**只改文档**，无可执行产物。

## 2026-09-29 —— 本轮收尾并暂停：代码侧验证项做完，交接与后续方向已记录

- **按用户要求"暂停其他内容"**：本轮在此收尾。实施计划里**代码侧的验证项已全部完成** —— Task 1 / 2 / 3 / 4 / 5 / 7 全部勾选，Task 8 的第 1、4 项勾选。
- **只剩 3 项未勾选，且都不是"还没验"**：Task 6 的**单顶点编辑**（用户已定修法：把受影响的面拆成三角形，保持共面校验严格 —— **待实施**）、Task 8 第 2 项的 `npm run build`（桌面打包 Tauri/Rust，**用户侧**）、Task 8 第 3 项教师/学生走查（**用户侧**）。
- **用户已决定、尚未开始的两件**：把 `feat/high-school-geometry-interaction` **合并到 `main`**；**启动球体与球截面**（按计划需先另立方案与实施计划）。**本轮未启动**：截图识图、HTML/GGB 导出、平面/函数逐题补缺。
- 文档面同步收口：`docs/feature-catalog.md` 的「本期收口」按最新事实重写（新增"创建交互回归收口"一条；未交付各项标注用户的启动决定；**删掉两处已被更正的过时表述** —— "锁定对象仍可被拾取/吸附"与"属性栏改坐标被静默丢弃"）；`docs/current-status.md` 新增「本轮结束时的交接」一节；实施计划的执行快照写明三条剩余项与用户决定。
- **上传情况**：本轮共 9 次提交，全部推送到 `feat/high-school-geometry-interaction`，并以 `git ls-remote` **逐次核对**远端与本地一致（最后一次 `d3fb1ba`；其中一次 push 因 `github.com:443` 间歇性被挡重试到第 3 次才成功、一次到第 8 次）。**未合并 `main`，未打包桌面版本。**
- 本批**只改文档**，无可执行产物。

## 2026-09-29 —— 更正："锁定不被吸附"一直是实现的，是我记错了层次

- **要更正的是我自己先前的记录**：本文件与 `docs/current-status.md` 都把计划 Task 3 那条"隐藏或锁定对象不被当作可吸附目标"里的**锁定**一半记成**未实现**、并列进"如实缺口待定"。本轮核到**证据层**才发现那条**不成立**。
- **错在哪**：我当时只核对了纯函数 `resolveSpatialAnchor` —— 它**只按命中物回答、不认识文档**，所以它不认识 `locked` 本来就不奇怪。真正的过滤点在 `apps/web/src/threeSceneEffect.ts` 的 `resolveCreationAt`：
  ```ts
  const hit = primitive?.visible === false || primitive?.locked || (primitive?.type === "point3" && primitive.tessellation) ? null : picked
  ```
  三个条件各自挡一类：隐藏的、**锁定的**、以及生成的 `point3`（只该引用原点，不该吸附手柄球面）。
- **新增自带对照的 e2e**（`e2e/geometry3d-creation.spec.ts` 9→**10 项**，10/10 通过）：同一个屏幕坐标 —— 未锁定时读数 `已有点 (0.00, 0.00, 0.00)`；点属性栏「锁定图元」上锁后读数变成 `工作平面 XY (…)`（退回工作平面），同时断言**点本身仍在画布上**（锁定≠隐藏）；解锁后又读回 `已有点`。三个读数由同一个坐标产生，差别只可能来自锁定状态。
- **定向变异**：把 `primitive?.locked` 从那个过滤里摘掉 → 用例立刻红在 `Expected /^工作平面 XY \(/`、`Received "已有点 (0.00, 0.00, 0.00)"`。变异已恢复，产品文件与 HEAD **无差异**。
- **顺带澄清一处容易混的地方**：`primitiveVisibility.ts` 的 `isUserVisiblePrimitive` 确实**不看** `locked` —— 但那是对的，它是**渲染可见性**判据，而"锁定"本来就不该改变可见性（用户选的语义是"看得见、能选中，但不能当吸附目标"）。渲染可见性与吸附门禁是两件事，不在一个函数里。
- 本批读数：`tsc -p e2e/tsconfig.json` exit 0；`eslint` 该文件 exit 0；该 spec **10/10**；产品运行时代码零改动。

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


## 2026-10-06 —— Agent N1 来源追溯与证据契约补丁

- 补齐设计文档与代码的 ClaimEvidenceStatus.verified_instance 一致性。
- 用户原话中的目标与自由点携带可回切的原文区间；旧手工集合继续如实表示来源未知。
- RED/GREEN 用例覆盖解析、IR、兼容适配和报告；具体门禁与未交付范围见 docs/current-status.md §四 F。

## 2026-10-06 —— N2 见证搜索加入默认关闭的实验性入口

- 设置页新增独立开关；保存/刷新、损坏偏好 fail-closed 和不连带打开其它开关有单元与浏览器证据。
- 只开启既有有界见证救援；题设核验与用户确认仍是提交前硬门禁。当前题集覆盖与真实 provider 成功率未因此改变，后续需独立测量。

## 2026-10-06 —— N2 见证搜索支持唯一点名的非环首三角直角

- 只对底面三角形做点名驱动的循环旋转；四边形与没有可靠底角证据的输入仍保守拒绝。
- 内核构造、搜索、编译生产链的正反例覆盖；最终候选仍通过题设残差和实体拓扑判据。
- 定向 3 文件 / 97 项、非 Lean 慢集成全库 324 文件 / 3775 项通过 + 1 todo；类型检查和 Web 构建通过，lint 0 error / 13 warning；全量浏览器 195/195 通过；未提供真实 provider 命中率变化数据。

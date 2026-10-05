# MathCanvas 当前状态

> **同一件事的另外三张表**（各自切面不同，读它们时注意它们都是**镜像**）：
> [能力目录](feature-catalog.md)（按能力列）、
> [发布门禁](acceptance/agent-release-gate.md)（按门槛列，回答"能不能放行"）、
> [记分卡](acceptance/agent-tool-loop-scorecard.md)（按阶段与 flag 列）。
>
> **这是"现在时"的唯一一处。** 本文件只回答三个问题：现在能跑吗、已经做完什么、还差什么。
> 历史过程（每一轮的 RED→GREEN 证据、被推翻的方案、实测读数、误报清单）在
> [`docs/project-progress.md`](project-progress.md) —— 那是**归档**，里面的数字是"当时实测"，
> 不是当前值。两份文件分工明确：**要当前值看这里，要过程看归档。**

**最后更新：** 2026-10-05（**要当前读数直接看 §一 的「当前读数总表」，要挡路的事看 §一 的「待裁决」四件**。方案进度：**N2 已交付并复核**（`witnessSearch` 缺省关，关闭时与 `4707b64` 逐字节相同）；**N3 已开工五步**（内核点投影、拖动的自由度/冗余诊断、拖动接线决策层、可证矛盾判据、**线状平行/垂直投影**）—— `constrainedDrag` 开关**仍默认关**，产品行为未变，出口卡在**没有产品入口能打开它**；**N4 已开工五步**（题集 schema / 运行入口与 `layer` 契约 / 凭据检查与报告契约 / **题集 7→21 条并逐条归因**）—— `real_provider` 仍整批 `not_measured`；**N5 已开工四步**（产物边界、短目标词表、**后端接线门 + `proof:smoke`**）—— **没有接任何后端**，所以今天没有任何产物能升到 `formally_proved`；**N6 十五步**（flag/依赖/WASM 审查、门禁电池、**两条抖动都已修并有前后计数**、**并发专项**、目录订正）。）
**修复前一版做完了什么**：用户现场"A 字句只有关系、没有数值的立体题面"从**画不出来**推进到**能画出来**。路上推翻了两个自己的设计（见下方"走过的弯路"），并修掉一批真实运行暴露的形式障碍（信封缺字段、平面动作带 `z`、面环绕向不一致、空 `relations`）。
**修复前一版暴露了什么（更重要）**：用户在真图上确认"**图画出来了，明显画错了**"。实测模型给的坐标：`BD=2`、`O` 是中点、`△OCD` 等边、`AB=AD` 都对，但 `OA·CD = −0.314 ≠ 0`（**第（1）问要证的那件事本身不成立**），且 `A` 的高度取 0.64、而"二面角 45°"要求约 1.33（**差约一倍**）。
**当时根因（必须写清，不能含糊）**：这道题的七个条件里，机器**真正核验过的只有一条**（`O 为 BD 中点`）。`AB=AD` 的等号写法不在关系词表里、`平面⊥平面` 没有判据、`等边三角形` / `DE=2EA` / `二面角 45°` 是**数值约束**而不在判据范围内 —— 于是**一张错图静默通过了全部门禁**。当次读数：全库单测 **282 文件 / 3277 通过 + 1 todo / 0 失败**、`agent-core`/`scene-graph`/`apps/web` 的 `typecheck` 均 exit 0、`eslint` exit 0。**这些绿读数与"图对不对"无关** —— 这一点此前几轮我没有说清楚，是本轮修正的表述。
**上一次：** 2026-10-03（欠定图形的见证生成与关系核验：关系表进信封 + 内核残差执行前核验。**其中"要求模型声明 `relations`"的设计已被真实运行推翻**，改为系统自己从原话抽）。

## 一、现在能不能跑（可复核的门禁读数）

### 1. 当前读数总表（**这一张是现在时**；下面按轮的「本批实测」一律是过程记录）

| 门禁 | 命令 | 最新读数 | 退出码 | 记录于 |
| --- | --- | --- | --- | --- |
| 类型检查 | `npm.cmd run typecheck` | 全部工作区 + `e2e/` + `scripts/`，无错 | 0 | **第 27 轮**（整批电池） |
| Lint | `npm.cmd run lint` | **0 error / 13 warning**（与基线逐条相同） | 0 | **第 27 轮**（整批电池） |
| 单测（全库） | `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3567 通过 + 1 todo / 0 失败** | 0 | **第 27 轮**（整批电池） |
| Rust provider 测试 | `npm.cmd run test:rust` | **238 通过 / 3 ignored / 0 失败**（16 个二进制） | 0 | **第 27 轮**（整批电池） |
| 全量 e2e | `npm.cmd run test:e2e` | **186 通过 / 0 失败**（54.2 s，16 workers） | 0 | **第 27 轮**（整批电池） |
| 性能基线 | `npm.cmd run test:perf` | 9/9；`drag/300-frames` **686–711 ms**（**三次采样的区间，不是单点**） | 0 | **第 37 轮重校** |
| 生产构建（web） | `npm.cmd run build --workspace @draw/web` | **成功**（4.83 s）；产物落 `build-check/`（已 gitignore，构建后工作树干净）；有**既有的**主 chunk 1.8 MB 提示 | 0 | **第 28 轮** |
| Agent 评测 | `npm.cmd run eval:agent` | `deterministic_local`：pass@1 **4/8**、pass@3 **4/8**、工具选择 45/45、工具错误 3/45 | 0 | **第 27 轮**（整批电池；**未接真实模型**，不是模型准确率） |
| Agent benchmark | `npm.cmd run bench:agent` | 抽取层：`cases=21 covered=14 empty=7 error=0`；`BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727`；`BENCHMARK_EXTRACTION covered=14/21 rate=0.667`。**见证层（第 48 轮新增）**：`BENCHMARK_WITNESS verified=1 unverified=20 no_witness=0 error=0 solveRate=0.048` | 0 | **第 48 轮** |
| 证明边界 smoke | `npm.cmd run proof:smoke` | 7 通过 / 0 失败；`PROOF_BACKENDS {"wired":[],"reviewed":0}`、`wiredBackends=[]` | 0 | **第 30 轮** |
| N3 定向测试（**计划点名的那七件**） | `vitest run constraints / constraints3d / planar-constraints / reactive/constraints / operations / patches / scene-store` | **7 文件 / 241 通过 / 0 失败** | 0 | **第 31 轮** |

> **这一张表现在是同一批读数**（2026-10-05 第 27 轮，九道门禁**串行**跑完，14:47:49 → 14:52:12，
> 约 4 分 24 秒）。第 28 轮又补上了**生产构建**这一行 —— 于是**计划里 N6 出口点名的八道命令
> （`typecheck` / `test` / `lint` / **`build --workspace @draw/web`** / `test:e2e` / `test:rust` /
> `test:perf` / `eval:agent`）现在都有读数**，`bench:agent` 与 `proof:smoke` 是计划之外额外跑的。
> **`drag/300-frames` 的 1295 ms 不再可信**：第 12 轮那次是在**连跑五遍 `test:rust` 之后**测的，
> 本轮同样把 perf 放在整批最后、却得到 **685.9 ms**，与 2026-10-01 基线的 **682.5 ms** 吻合。
> 所以那个 1295 ms 是**测量条件造成的离散值，不是回归** —— 这一条现在有反证，不再是"存疑"。
> **怎么读**：没有一行是"应该没问题"；每一行都是**跑过的**。
> **第 37 轮：把上面这些读数抽出来重跑了一遍**（因为我在第 35 轮抓到过自己一次"假绿"，所以这些数字也该被抽查，而不是一直往上加新的）。**结论：逐条复现** ——
> `cargo metadata` **551 包 / 550 第三方 / 33 种表达式 / 0 个缺 `license` 字段 / 5 个 MPL-2.0-only**（与第 16 轮逐字相同）；
> `test:rust` **238 + 3 ignored / 0 失败**；`eval:agent` **pass@1 4/8、pass@3 4/8、工具选择 45/45、工具错误 3/45**；
> `proof:smoke` **7 通过** + `PROOF_BACKENDS {"wired":[],"reviewed":0}`；`bench:agent` **三条读数逐字相同**。
> **唯一动过的是性能**：`drag/300-frames` 这次是 **710.6 ms**（第 27 轮 685.9 ms）。所以那一行改成**区间**：
> 它是**采样的离散**（两次差 3.6%），不是单点真值 —— 这也进一步说明第 12 轮那个 **1295 ms** 是 1.8 倍的**离群值**。
> **两条统计性结论也顺带加固了**（它们本来只是"概率上说明"）：
> Rust 的 secrets 抖动**又跑了 40 次全绿**，累计 **0/100**（修前 1/15；若真率仍是 1/15，连绿 100 次的概率约 **0.1%**）；
> e2e **又跑了 3 次全绿**，累计 **0/7**（修前 6 次里 4 次红；若真率仍是 4/6，连绿 7 次的概率约 **0.46%**）。
> **第 38 轮：抽查我自己的"结构性论断"（数字能重跑，论断只能反向验证 —— 把条件破坏掉，看该红的是不是真的红）。**
> 这一栏是**反向验证台账**：哪条论断有守卫、守卫是哪条用例。**只有被变异验过的才算"有守卫"**，
> 剩下的只是"我读过一遍"。
>
> | 论断 | 变异（把条件破坏掉） | 结果 |
> | --- | --- | --- |
> | N5 边界：只有 `verified` 能让证据升级 | 改成**无条件**升级 | **3 条红**（含"证明了别的东西"那条） |
> | 表外目标绝不升级 | 停掉 `goalKind === null` 那道门 | **正好那一条红** |
> | `WIRED_PROOF_BACKENDS` **由通过的审查记录推导** | 改回**手写** `["lean4"]` | **3 条红**（含"接入不变量""今天的实况"） |
> | 静默丢句"**再也过不去**" | 从关键词表删掉 `相等` | **4 条红**（含题集级不变量那条） |
> | 每题最多 3 轮 | 上限从 `>` 改成 `> +99` | **正好那一条红** |
> | 每条 run 事件都带 flag 状态 | 抹掉 `revisions.nextPhaseFlags` | **正好那一条红** |
> | 并发：`drop(runs)` 是**锁序的一部分** | 删掉它 | **90 秒自锁、被强杀**（不是逃过） |
> | Rust 依赖里出现 GPL/AGPL/SSPL | 往快照里塞一个 `eviltool@1.0.0: GPL-3.0-only` | **2 条红**（硬禁 + copyleft-only） |
> | `Cargo.lock` 新增依赖却没重新扫描 | （判据本身就是它）本次实测：`lockPackages=550` 与快照 550 条对齐 |
>
> **一条方法教训（第 40 轮，差点把对的文档改成错的）**：我核 §二 里"10 条 / 7 条 / 5 条用例"时，
> 先用 `grep '^\s*it\('` 数 —— `geometryCompileStrategy.test.ts` 数出来是 **3**，与文档写的 **5** 不符，
> 我**差点**就去把文档改成 3。用 runner 一跑才发现：那个文件用的是 **`it.each(cases)`（2 个 case）**，
> 加上 3 条普通 `it(` = **正好 5 条**（三个文件合计 **22**，与 runner 输出一致）。
> **所以：数用例一律以 runner 的输出为准，`grep it(` 会漏掉 `.each` / 循环生成的用例。**
> 这一条也是"审计方法本身会制造缺陷"的现场例子 —— 我要是没多跑那一步，就会往一份**正确**的文档里
> 写进一个**错误**的更正。
> **没有守卫、只靠"我读过"的论断（如实列出）**：① "关闭 `constrainedDrag` 时旧路径就是原来那一行"
> （结构性的，只有注释与代码位置，没有用例；因为它是**同一行代码**，可漂移的东西不存在）；
> ② "两处约束模块互补而非重复"（一条读完两个模块文件的结论，不是可执行的判据）；
> ③ ~~"Rust 传递依赖无 GPL/AGPL/SSPL"（读 `cargo metadata` 得出）~~ —— **第 39 轮已升格为有守卫**：`scripts/dependency-licences/licences.test.ts`（快照 + `Cargo.lock`）。
> **这三条不是错的，是"没被机器挡住"** —— 引用它们时要知道这一点。
> `test-results/` 是 gitignore 的：e2e 的 trace 只在本机，**任何一次默认 e2e 跑都会覆盖它**
>（要留 `error-context.md` 就得用 `--retries=1 --output=...`，见下方过程记录）。

### 2. 挡路的待裁决（**做完这四件里的任意一件，都能立刻推进一格**）

| # | 要你定什么 | 为什么我定不了 | 定了之后能做什么 |
| --- | --- | --- | --- |
| 1 | **`constrainedDrag` 开关怎么打开** | 仓库里**不存在**任何运行期开关约定（没有 `import.meta.env`、没有 localStorage 开关；`agentNextPhaseFlags()` 是 `App.tsx:518` 直接调的常量）。所以"加一个入口"本身就是产品决定；而按 N2 的先例，**测试后门是被禁止的** | N3 的出口（保持约束 / 过约束拒绝 / 冲突恢复 / 一步撤销的**浏览器**正反例）当天就能写；N3 从"代码在、用户看不见"变成"可验收" |
| 2 | **N5 首批的「共线 / 共面 / 勾股」怎么办**：① 先扩解析层让它们能被表达，② 还是从首批里划掉 | **（2026-10-05 更正：只剩一个了）** 这三个里，**共线 / 共面已经有载体** —— 不在解析层，在**约束层**：`ConstraintType` 本来就有 `collinear` / `coplanar`，而内核**既判**（`collinearResidual` / `coplanarResidual`）**又投影**。所以我第一版"三个都表达不出来"的结论**只在解析层成立**（`DiagramObligationKind` 里确实没有这三种）。**真正一处载体都没有的今天只有「勾股」一个**（它是三条边的代数关系，`fixedDistance` 固定的是单条边长，不是 a²+b²=c²）。`proof:smoke` 现在把两个清单**分开报**：`goalsWithoutObligationCarrier` 与 `goalsWithoutAnyCarrier`。**要裁决的是「勾股怎么办」** | 短目标词表立刻自洽，`unexpressibleFirstBatchGoals()` 那条待办消失（详见 §四 F） |
| 3 | **`real_provider` 用哪个 provider、凭据放哪** | 要动凭据与对外调用边界，也是唯一会**花钱**的一项 | N4 的出口（pass@1 / pass@3 / 成本 / 延迟 / 人工复核率）才能有数字；今天那一栏是整批 `not_measured` |
| 4 | **要不要 `git push`** | 远端写操作，我不自行决定 | 本地领先 `origin/main` **25 个提交**（含两条门禁抖动的修复）才能进远端与 CI |

> 这四件我每轮都在问。写在这里，是因为**聊天里的提问会滚掉，这张表不会**。

---

**以下按轮倒序的「本批实测」是过程记录**（最新在最上面）。

**2026-10-05 N4 第四步（题集 7 → 21 条）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3567 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run bench:agent` | exit 0；`BENCHMARK_COVERAGE cases=21 covered=14 empty=7 error=0` |
| `npm.cmd exec -- vitest run scripts/agent-benchmark --maxWorkers=1` | **34 通过 / 0 失败**（原 33） |

> **题集从 7 条（每类 1 条）扩到 21 条（每类 3 条）**。归因是**机器展开**的（`BENCHMARK_REPORT` 逐条带 `caseId`/`status`/`evidence`）：`extracted` 14 条、`partial` 2 条（都是二面角/线段比，留下 residue）、`empty` 7 条且**全部带 residue**。
> **14 条新用例里没有一条"整句凭空消失"** —— 包括我**特意**按同一类写法挑的两条（`dynamic-drag-midpoint`「让 M 始终是 AB 的中点」、`dynamic-animate-perpendicular`「让 PA 始终垂直于平面 ABCD」：关系词在句子里、但状语把匹配隔开）。它们都留下了 residue，说明上一轮那个修法确实在管用。
> **新增一条题集级不变量用例**：每一条题都必须至少留下一条给定义或一条 residue（用的就是跑读数时的同一个 `parseObligationIR`，不另写判断）。以后往 `cases.jsonl` 加新写法，静默丢掉会红在**题集**这一层。
> **一条不可比性（必须说清）**：`covered` 从 `5/7`（71%）到 `14/21`（67%）**不是下降，是不可比** —— 题集换了，新加的三类是**刻意偏难**的（`unsupported-expression` / `dynamic-request` / `dihedral-or-ratio`，现在占 9 条）。**这两个数字只记录、不比较。**
> **顺带一条正面的**：`contradictory-three-lengths`（同一条线段被赋三个不同长度）**没有**被静默合并 —— 读出 3 条 `fixedLength`。

**2026-10-05 N4 第三步（逐条归因 + benchmark 查出的缺陷）—— 本批实测：**

| 用例 | 类别 | 状态 | 证据 |
| --- | --- | --- | --- |
| `underdetermined-pyramid-base` | underdetermined | extracted | 3 条 |
| `contradictory-two-lengths` | contradictory | extracted | 2 条 |
| `unsupported-expression` | unsupported-expression | **empty** | 1 条 **unverified**（"AB"） |
| `shuffled-naming` | shuffled-naming | extracted | 1 条 |
| `dihedral-forty-five` | dihedral-or-ratio | **partial** | 2 条 |
| `dynamic-drag-request` | dynamic-request | **empty** | 1 条 **unverified**（修前是"（没有抽出任何子句）"） |
| `universal-proof-request` | universal-proof-request | extracted | 1 条 |

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3566 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run bench:agent` | exit 0；`BENCHMARK_COVERAGE cases=7 covered=5 empty=2 error=0` |
| `npm.cmd exec -- vitest run packages/agent-core/src/diagramObligations.test.ts --maxWorkers=1` | **12 通过 / 0 失败**（原 11） |

> **`empty` 的含义要读准**：它是"**0 条给定义**"，**不等于**"什么都没留下" —— 上表两个 `empty` 里都带着一条 residue。
> **benchmark 查出的真缺陷（已修）**：`dynamic-drag-request` 的原话「…**保持六条棱长始终相等**」修前 `givens=0` **且** `unverified=0` —— 一个几何条件词凭空消失，与 `diagramObligations.ts` 自己的纪律（"新写法必须显形，不许把非空题面静默变成空通过"）冲突。**根因**：residue 关键词表只认连续的 `等长`/`长度相等`/`线段相等`/`边相等`，而"棱长始终相等"里只有"相等"，不在表里。**修法**：表里补上 `相等`（一个词）。
> **按纪律走的顺序**：先写**失败**用例（用 benchmark 原话）→ 看到 RED（`expected 0 to be greater than 0`）→ 再改那一个词 → GREEN；"普通说明文字不许变成 residue"的既有用例仍全绿，说明没放宽过头。
> **修后**：该用例的 `evidence` 从"（没有抽出任何子句）"变成一条 `unverified` —— `covered=5 empty=2` 数字未变（定义使然），但记录从"什么都没有"变成"**有，但没核验**"。

**2026-10-05 N3 第五步（线状 `parallel` / `perpendicular` 的投影）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3565 通过 + 1 todo / 0 失败**（134 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run packages/geometry-kernel/src/constraints3dProjection.test.ts --maxWorkers=1` | **25 通过 / 0 失败**（原 20） |

> **内核最后一块缺口补上了**：线状 `parallel` / `perpendicular` 现在有投影规则 —— 保持**第一条**线不动、把**第二条**绕中点摆过去（取最小改动），**长度与中点都不变**。这与 2D `projectLineConstraint` 是同一口径，所以不需要新的产品裁决（此前我把它记成"要先决定旋转哪一侧"）。
> **三种如实跳过**：方向显式写死的直线（`pointDirection`）、`perpendicular` 而两条线已平行（转 90° 没有唯一答案）、第二条线有端点被锚住（转动要同时动两个端点）。
> **`no-projection-rule` 从此不可达**：有空间判据的约束种类现在都有规则了；代码与文档写明这一点，并**保留**那一支给下一个新增种类。
> **边界**：`constrainedDrag` 开关**仍默认关**，所以这块能力在产品里依然不可达。

**2026-10-05 N5 第三步（后端接线门 + smoke）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3560 通过 + 1 todo / 0 失败**（137 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run proof:smoke` | exit 0；`PROOF_SPIKE {"wiredBackends":[],"firstBatchExpressible":6,"unexpressibleFirstBatch":["collinear","coplanar","pythagorean"],…}` |
| `npm.cmd run proof:smoke -- --mode=lean` | **exit 1**（"没有后端模式，假装有比失败更糟"） |

> **补上了上一版漏掉的一环**：`verifyProofArtifact` 原来只校验形状 / 版本 / 绑定，而**手工编的产物**可以把这些都满足。新增 `WIRED_PROOF_BACKENDS`（**空的**）+ `backend-not-wired`：生产默认一个后端都没接，所以**今天没有任何产物能升到 `formally_proved`**。
> **smoke 验的不是"能不能证明"，而是那条不变量**：首批每一个能表达的目标，用一份"看起来完美"的手工产物都升不上去、且理由必须是 `backend-not-wired`；同时钉住**反方向**（注入假后端后必须能升上去）—— 少了反向那条，一个"永远拒"的实现也能让不变量成立。
> **证据**：proof 目录 25 条 + smoke 6 条。
> **边界**：仍然**没有接任何后端**；加后端前必须先过依赖 / 许可证 / 进程与线程边界审查。

**2026-10-05 N5 第二步（短目标词表）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **305 文件 / 3551 通过 + 1 todo / 0 失败**（137 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1` | **22 通过 / 0 失败** |

> **新增** `packages/agent-core/src/proof/proofGoals.ts`：10 种短目标的**封闭词表** + 支持矩阵 + `declaredProofGoal(obligationKind)`。映射按**题设种类**（结构化字段）走，**不做文本关键词匹配**。
> **接线（fail-closed）**：`ProofExpectation` 新增**必填**的 `goalKind`；为 `null`（不在首批）时无论产物多合法都**不升级**，报 `undeclared-goal`。这条门放在绑定检查之前。
> **本批最有价值的产出是一条事实**：计划首批点名的"共线/共面、勾股"**在解析层表达不出来** —— `DiagramObligationKind` 里根本没有这三种（只有 `fixedLength | equilateral | equalLength | midpoint | segmentRatio | planePerpendicular | dihedral | perpendicular | parallel`）。矩阵如实标注为"首批里、但现在表达不出来"，并单列成 `unexpressibleFirstBatchGoals()`；**要一个裁决**（扩解析层，还是从首批划掉）。见 §四 F。
> **证据**：`proofGoals.test.ts` 5 条 + `proofArtifact.test.ts` 17 条；定向变异（停掉 `goalKind === null` 那道门）→ **正好那一条红**。
> **边界**：仍然**没有接任何后端**；`dihedral` 能表达但**不在首批**，同样不升级。

**2026-10-05 N5 第一步（形式证明出口的边界）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **304 文件 / 3544 通过 + 1 todo / 0 失败**（136 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1` | **15 通过 / 0 失败** |

> **N5 的判据第一次可执行了**：`verified_instance` / `sampled` **不能**变成 `formally_proved`；伪造、缺字段、版本不匹配、以及**"证明了别的东西"**（`claimId` 或 `inputHash` 不匹配）的产物一律拒绝。落点是 `packages/agent-core/src/proof/proofArtifact.ts` 的 `verifyProofArtifact` / `evidenceStatusWithProof`。
> **两条设计决定**：① 校验**必须**带 `expectation`（`claimId` + `inputHash`）—— 否则一份"证明了别的东西"的合格产物贴过来也看不出来；② **拒收不是第五种结局**，只报 `failed` + 机器可读 `reasons`。
> **证据**：15 条（一半反例）+ 一条定向变异（改成无条件升级 → 3 条红）。
> **边界**：**没有接任何后端**，所以现在任何真实运行都只会得到 `unsupported`；adapter 要先过依赖与许可证审查。"一份证明该绑到多细的输入"**未裁决**。

**2026-10-05 N6 门禁复跑（**串行**跑完整套）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **303 文件 / 3529 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run test:rust` | 五次里**四次 236 通过 / 3 ignored / 0 失败**；**一次有 1 条失败** |
| `npm.cmd run test:e2e -- --workers=3` | **185 通过 / 1 失败**（`three-canvas-size.spec.ts:72`） |
| `npm.cmd run test:perf` | **9 / 9 通过**；`drag/300-frames` **1295 ms（≈4.3 ms/帧）** |
| `npm.cmd run eval:agent` | exit 0；`deterministic_local`：pass@1 **4/8**、pass@3 **4/8**、tool selection **45/45**、tool error rate **3/45** |
| `npm.cmd run bench:agent` | exit 0；`cases=7 covered=5 empty=2 error=0` |

> **两条红都不是稳定复现的 —— 定位记录紧接在下面。** 全量 e2e 跑了**两次**：一次 **186 通过 / 0 失败**，一次 **185 通过 / 1 失败**；那条单独跑 3 次全过（12/12）。`test:rust` 同理（五次里四次全绿）。按本仓纪律"不复现就不猜着改"，两条都记为**不稳定**，既不写成"已修"，也不写成"与本批无关"。

**2026-10-05 N6 门禁不稳定：把两条红定位到具体用例**

| 门禁 | 现象 | 定位 | 判据与边界 |
| --- | --- | --- | --- |
| 全量 e2e | **已修**（原来 6 次全量里 4 次红） | 四次现场**全部是同一条断言**：`data-preview-hovering` 期望 `"true"` 实收 `"false"`（`three-canvas-size.spec.ts:90` 与 `geometry3d-section.spec.ts:59` 是同一条） | 机制见下；**修后连续 4 次全量全绿**（186 passed，无 flaky） |
| `test:rust` | **已修**（原来五次里一次红） | 定位到 `tests/secrets.rs:149`（`put` 成功后 `with_secret` 读回 `None`）。判别实验：**默认并行 15 次红 1 次**、**`--test-threads=1` 20 次全绿** | 见下；**加锁后 60 次并行全绿 + 3 次全量 `test:rust` 236 通过 / 0 失败** |

> **为什么不"顺手加一次重试"把红压下去**：那会把一条**真实的不稳定**藏起来，而这个组件是**密钥库** —— 它报"没有配置"时，调用方会去发一次注定 401 的请求。要么找到根因，要么如实留着这条记录。
> **下一次要做的**：让 e2e 失败时的产物**在失败当次就留住**（Playwright 的 `error-context.md` 会被下一次运行清掉），至少先拿到**是哪一条断言**。

**2026-10-05 `test:rust` 的不稳定：判别、排除、修法与证据**

- **判别实验（把范围缩到一件事上）**：`node scripts/toolchain.mjs cargo test --manifest-path
  apps/desktop/src-tauri/Cargo.toml --test secrets` —— **默认并行：15 次里红 1 次**；
  同一命令加 `-- --test-threads=1`：**20 次全绿**。所以它**需要并发**才能发生。
- **排除掉"别的用例把它删了"**（读完整份 `tests/secrets.rs` 得到的，不是猜的）：每个用例用各自的
  profile 名（`SCRATCH_PROFILES` 那条等集断言钉着），`__probe__` 那条是 `#[ignore]`，
  **没有任何用例会删别人的格子**。
- **剩下的是什么**：所有用例共享**同一个凭据服务名**（`windows.rs` 的 `SERVICE = "MathCanvas"`，
  target 不同但服务相同），而 `keyring` 的 Windows 后端存在 `Error::Ambiguous`
  （"matched more than one entry"）这种**枚举**语义 —— 并发写/删会让另一次查找**瞬时**看不到条目。
- **修法**：`tests/secrets.rs` 里凡是走真实凭据库的用例（5 处 `create_store()`）先取一把
  `static STORE_LOCK: Mutex<()>`。**这不是"加重试"**：它只让**测试 harness** 不再制造一个产品里
  不存在的场景（产品里凭据的存/删是用户逐次触发的）。**它不主张"产品对并发凭据访问是安全的"** ——
  那件事本文件没有测，也没有因为这把锁变成已测。
- **证据**：加锁后 **60 次并行 `--test secrets` 全绿**（若真实故障率仍是 1/15，连绿 60 次的概率约
  **1.6%**），并且**连续 3 次全量 `test:rust` 都是 236 通过 / 0 失败**。
- **一处工具教训（留档）**：第一次跑"单线程 20 次"时得到 **20/20 失败**，险些当成"单线程必红"——
  其实是**我自己漏了 `--manifest-path`**，cargo 在仓库根找不到 `Cargo.toml`。这正是本仓那条纪律
  "环境错误不能算 RED / 每条读数要看自己的退出码"的现场例子：**20/20 这种整齐的失败率本身就是警报**。

**2026-10-05 e2e 抖动：修掉了（一条断言、一个机制、一处调用点）**

- **收敛成一条**：用上面那个配方又跑了 3 次全量，**又红 2 次、都在 `three-canvas-size.spec.ts:72`**；
  把这次留下的 `error-context.md` 读出来才发现，它和在 `geometry3d-section.spec.ts:42` 红的那次
  **是同一条断言** —— `data-preview-hovering` 期望 `"true"` 实收 `"false"`。
  **四次现场（含 round-12 那次硬失败）全部是同一条**，失败那一刻场景读数也一致
  （`data-preview-count="1"`、`data-scene-syncs="5"`）：**预览在，指针却不在它上面。**
- **机制（推断，与全部证据一致）**：`animateToFit` 约 250ms，在 rAF 里逐帧插值整份相机状态；
  而 `e2e/helpers/projection.ts` 的 `projectWorldPoint` **一上来就读** `data-camera-*`。
  动画没跑完时读到的是中途值，等 `mouse.move` 执行时相机又动过 —— 投影出的屏幕点不再对应那个世界点，
  而预览命中区只有那圈边界虚线，差一点就是空。指针事件不会再发一次。
  同类竞态本仓修过一次（`geometry3d.spec.ts:277`）。
- **修法（单源）**：把"等相机停稳"放进 `projectWorldPoint` **内部**，判据是**连续两次读数一致**
  （不写死 sleep），与既有的 `settleCamera` / `settledTarget` 同一套口径；画布盒子的读取挪到 settle **之后**。
- **证据（是证据，不是证明）**：修前 **6 次全量里 4 次红**这条断言；修后 **连续 4 次全量、4 次全绿**
  （`186 passed`、无 flaky）。若真实故障率仍是 4/6，"连绿 4 次"的概率约 **1.2%**。
  **我没有直接录到"投影那一刻相机还在动"的那一帧**，所以说的是"与全部证据一致"，不是"已证明"。

**2026-10-05 e2e 抖动：拿到了断言现场与复现配方**

- **配方**（这是本批真正有用的产出）：`playwright.config.ts` 里 `retries: process.env.CI ? 2 : 0`、
  `trace: "on-first-retry"` —— **本机 retries=0，所以一次抖动什么证据都不留**。加两个参数就有：
  ```
  npm.cmd run test:e2e -- --workers=3 --retries=1 --output=test-results/flake-probe-1
  ```
  `--retries=1` 让 `trace: "on-first-retry"` 生效（第一次失败就落 trace），
  `--output` 指向一个**新目录**就不会被下一次运行清掉。这一次就是这么拿到 `trace.zip` 与
  `error-context.md` 的（报告里写的是 `1 flaky`，整轮仍 exit 0）。
- **现场**：`geometry3d-section.spec.ts:42` 第 59 行 `data-preview-hovering` 期望 `"true"`、实收 `"false"`；
  失败那一刻场景的读数里 **`data-preview-count="1"`、`data-scene-syncs="5"`、`data-scene-reused="3"`** ——
  **预览是存在的**，只是"悬停"这个属性没被翻过来。
- **已经排除的**：自愈那条路是通的 —— `threeScene.tsx:307` 的 effect 依赖里含 `previews`，
  它调 `runtime.syncContent()`，而那个包装（`threeSceneEffect.ts:452-459`）在 `syncContent()` 之后
  调了 `refreshPreviewHover()`；`threeScenePreviewHover.ts:137` 确实用最后指针位置重算。
  **所以"指针先到、预览后到"这条老路已经被堵住了**，这次的 `false` 不是那条。
- **两个还没证实的假设**（**没有改代码**，因为这条抖动 1/N、拿"跑过一次绿"当证据不算验证）：
  1. **屏幕坐标是在布局稳定之前算的**：`grabPoint()` 用 `projectWorldPoint` 投影出屏幕点，
     而画布高度依赖状态栏高度；并行负载下投影时与 `mouse.move` 时的画布尺寸可能不同，
     同一个屏幕点因此落在预览**边界线之外**（预览的命中区只有那圈虚线）。这条假设能解释
     为什么"属性一直 false"（事件不会再来一次）以及为什么单独跑必过。
  2. **预览组的几何在 refresh 那一刻还没就位**：`previewHitAt` 对预览组做射线检测，
     若组已建、但对象的位置/几何在**同一趟同步的后半段**才写好，自愈那一次也会打空。
- **下一步**：把 `--retries=1 --output=<新目录>` 固化成抓抖动的常规做法；
  再拿到 2–3 份现场之后，按两次现场共同点去证伪上面两条假设中的一条 —— **证据不足之前不猜着改**。
> **性能读数要谨慎比较**：`drag/300-frames` 这次 **1295 ms**，而本文件 2026-10-01 的读数是 **682.5 ms（≈2.3 ms/帧）**。这一次是在**跑完一整套门禁之后**测的（机器不是空闲状态），所以**不能据此断言回归**；要判断趋势得在空闲机器上单独复跑。
> **`eval:agent` 的数字与 2026-09-29 那次逐项相同**（4/8、4/8、45/45、3/45），模式仍是 `deterministic_local` —— 计划的记分卡原文写明它**与模型能力无关**。
> **串行纪律**：这一套是**依次**跑的。把 `test:e2e` 与那几条 node 套件并行跑会污染主线程读数（本文件记过：拖动那一档从 16.8 ms 涨到 366.7 ms），那样跑出来的 e2e 不算一次有效验收。

**2026-10-05 N4 第二步（benchmark 运行入口与 `layer` 契约）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **303 文件 / 3529 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run bench:agent` | exit 0；**`BENCHMARK_COVERAGE cases=7 covered=5 empty=2 error=0`** |
| `npm.cmd run bench:agent -- --mode=real_provider` | exit 0；`measured: 0` / `notMeasured: 7`（适配器未实现） |
| `npm.cmd run bench:agent -- --mode=nonsense` | **exit 1** 并打出可选项 |

> **`layer` 契约**：运行记录分 `extraction` / `witness` 两层，**每层有自己的结局词表**，跨层用词被拒绝 —— 拿见证层的词描述抽取层是范畴错误，而一律写 `not_measured` 又会把"跑了抽取、没跑求解"说成"什么都没测"。
> **第一个真实读数**：抽取层在七类起步题集上覆盖 5 道、**2 道一条子句都没抽出来**。这是**读数不是门禁**（刻意没有把任何阈值钉成断言）。
> **`real_provider` 整批 `not_measured`**：适配器还没写；`provider`/`model` 写 `null` 是被允许的，但只要不写 `not_measured` 就必须是非空字符串 —— 没凭据时编一个模型名字等于把"没测"说成"测过了"。
> **还没做**：真实 provider 一个都没跑；题集只有七类各一条；**没有按题归因那 2 道抽不出子句的是哪两道**。

**2026-10-05 N4 第一步（benchmark 题集与报告契约）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **302 文件 / 3520 通过 + 1 todo / 0 失败**（133 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run scripts/agent-benchmark --maxWorkers=1` | **24 通过 / 0 失败** |

> **这一批只交付"载体与判据"，不是测量结果**：`scripts/agent-benchmark/` 的题集 schema + 校验器、凭据检查、运行记录与报告契约，以及七类各一条的起步题集。
> **三条硬规矩**：必需字段必须**在**（"没测"写显式 `null`，不是删掉键）、**模式必须标识**（`deterministic_local` / `real_provider` 不许混报）、**claim 必须有证据**（唯一例外 `not_measured`）。
> **口径说明**：计划原文要"必须含 provider/model"，而 `deterministic_local` 本来就没有 provider —— 所以**键必须在、值可为 `null`**；`real_provider` 模式下两者必须是非空字符串。
> **证据**：24 条用例成对写（每条"必须失败"配一条"合法输入不许被判失败"）；两条定向变异各抓红对应用例。
> **尚未做**：`runner.mjs` 没写，**一个真实 provider 都没跑**，报告里没有任何 pass@1 / 成本 / 延迟数字。

**2026-10-05 N3 第四步（可证的矛盾）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **301 文件 / 3496 通过 + 1 todo / 0 失败**（134 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **把"没能同时满足"与"本身不可能成立"分开。** 新增内核 `findConstraintContradictions`，**只报能证明的两种**：① 同一条线段两个不同的长度要求（按无序点对归组）；② 点既在线上又在面上、而线与面**平行且不相交**。投影结果新增 `contradictions`，接线层的拒绝文案**先**说矛盾、再退回"没能同时满足"。
> **四种能解的情形必须放过**（这一半用例比正例更重要）：直线**落在**平面里、直线与平面**相交**、同一个长度写两遍（冗余）、不同线段各自的长度要求。
> **已知边界**：**直线 ∥ 直线不相交没有判据** —— 投影在它上面照样振荡，所以只能说"没能同时满足"，有一条守门用例钉着这个边界。
> **证据**：内核 7 条（3 正 4 反）+ 接线层 1 条；三个定向变异 —— 过度报告 → **反例**红，拿掉"落在平面里"守卫 → 对应反例红，停掉检测 → **4 条正例全红**（含接线层）。
> **产品行为仍未变**：开关默认关着。

**2026-10-05 N3 第三步（拖动接线的决策层）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **301 文件 / 3488 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run test:e2e -- e2e/geometry3d-drag.spec.ts e2e/geometry3d-creation.spec.ts --workers=1` | **19 通过 / 0 失败**（27 s）—— 含"一次自由拖动只撤销一步"与"拖动实体不转相机" |

> **这是第一批**摸到产品路径的 N3 工作：新增 `apps/web/src/constrainedDrag3.ts`（纯函数 `planConstrainedDrag3`），并把 `App.tsx` 的 3D 拖动抬手（`onDragEnd`）接上它。
> **但开关默认仍然关着**（`agentNextPhaseFlags()` 恒返回五关），关着时**逐字**走原来那一次 `apply({ op: "translatePrimitive3", id, delta })` —— 所以**产品行为与上一版完全相同**。
> **四条语义**：① 被拖点是**暖启动**不是硬锚（先放到"原位置 + delta"，再让投影把它连同别的点拉回约束 —— 所以它会贴回约束、可能不在指针正下方；做成硬锚会让"拖平面上的点"100% 被拒）；② 不许动的是锁定点与绑定点；③ 四种出口 `passthrough` / `noop` / `refused` / `commit` 分开，拒绝时一个坐标都不写、被抵消时不提交空事务；④ 提交走**一次** `applyBatch` → `commitTransaction`，所以一步撤销是白拿的。
> **前置已裁决**：op 工厂 `patchPoint3` 早就存在，所以"一次改多个点坐标"不需要新 op。
> **证据**：`constrainedDrag3.test.ts` 11 条（斜着拖 → 贴回平面并 commit；沿法向拖 → noop）。
> **还没有浏览器用例**：`e2e/agent-constrained-drag.spec.ts` 不存在 —— 目前**没有任何产品入口**能把 `constrainedDrag` 打开，N3 的出口（`constrainedDrag=true` 的浏览器正/反例）**未达成**。

**2026-10-05 N3 第二步（拖动层的自由度与冗余诊断）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **300 文件 / 3477 通过 + 1 todo / 0 失败**（138 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **又一批内核新增，同样没有接进任何产品路径。** 产品行为仍与 `9a65e6d` 之前完全相同。
> **新增内容**：`projectPoint3Constraints` 的结果加 `analysis` —— 在**最终构型**上对可动坐标做数值雅可比、算秩，得到"还剩多少自由度"与"有没有冗余约束"。同时新建内核 `linear-algebra.ts` 的 `rankRows`，并把 `agent-core/src/constraintIR.ts` 里那份 `rankOf` 删掉改调它（**消灭一处跨包重复**：拖动层与文档层问的是同一件事，两处各写一份就会出现"同一组几何、两个不同的秩"）。
> **三条必须分开的语义**：① `redundantConstraintIds`（重复/能推出）与 `unaffectedConstraintIds`（那一行恒为零）分开，混在一起会让正常文档被读成"过约束"；② 判据是"行是不是零"，**不是**"点名里有没有可动点"（`pointOnPlane(p, 平面)` 里 p 被锚住、平面定义点仍可动时行是非零的）；③ 本读数与 `reportFreeDegrees` 不是同一个问题（那个按绑定算、扣规范自由度；这个按锚点算、不扣），共用的只有秩。
> **明确不声称**：矛盾约束在顺序投影下**振荡**，只报 `exhausted` + `unsatisfiedConstraintIds`，**不报 `inconsistent`**（"无解"需要可证的冲突检测，本层没有）；`remainingDof` 是**一阶**读数。
> **证据**：`constraints3dProjection.test.ts` 13 → **20 条**，新建 `linear-algebra.test.ts` **8 条**；两条定向变异各自抓红（秩改成行数 → 9 条红，**含 `agent-core/constraintIR.test.ts` 的重复约束用例**；锚点被忽略 → 2 条红）。

**2026-10-05 N3 第一块砖（3D 约束的点投影，内核）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **299 文件 / 3462 通过 + 1 todo / 0 失败**（126 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **这一批全是内核新增，没有接进任何产品路径。** `apps/web` 的 `threeScene*`、`scene-graph` 的约束事务与 undo/redo 一行未动，所以**产品行为与上一版完全相同**。
> **新增内容**：`packages/geometry-kernel/src/constraints3dProjection.ts` 的 `projectPoint3Constraints` —— 顺序投影，支持 `pointOnLine` / `pointOnPlane` / `collinear` / `coplanar` / `fixedDistance`，带 `anchoredPointIds`。判据是 fail-closed 的：`satisfied` 要求每条约束都被判过且在容差内，`skipped` 非空时恒为 `false`；`exhausted` 单独表示"次数用完还没到定点"。
> **如实跳过的**：`parallel` / `perpendicular` 的线状写法（要先决定旋转哪一侧的点，属产品判断）进 `no-projection-rule`；`coincident` 进 `planar-only`；几何退化进 `no-judge`；点全被锚住进 `no-movable-point`。
> **证据**：新增 13 条用例，先红后绿；两条定向变异各自抓红对应用例（① 投影改成原样返回 → pointOnLine 两条红；② 拿掉"已满足就早退" → "本来就满足"那条红）。
> **还没做**：接进拖动管线、`parallel`/`perpendicular` 的线状投影、与 `constraintIR.reportFreeDegrees` 合流、浏览器端 e2e。

**2026-10-05 N2（解析见证构造 + 有界见证搜索 + flag 接线）—— 控制器在 `9c5ae2f` 上复跑：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **298 文件 / 3449 通过 + 1 todo / 0 失败**（329 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **N2 仍然没有改变默认行为。** `witnessSearch` 缺省**关**；关闭时编译结果与 `4707b64` **逐字节相同** —— 这条不是靠"看起来没变"，而是有一条**对着基线采的 golden 钉**（golden 由 **BASE 实现本身**跑出来：6 个输入 × 两种生产形状（缺省 / `false`），断言逐字节 JSON + 顶层 key 集合 + `diagramVerification` key 集合）。
> **这次真正接上的能力（关着 flag 时都不生效）**：原话题设受支持、而**模型给的坐标没能全部通过核验**时，系统自己生成一组见证坐标、**再走一遍同一个物化与核验路径**（只有 `passed` 才能进草稿）；模型坐标本来就合格时**根本不搜**（只救不抢）；搜不到就保持原样、**不产生半份草稿**。
> **N2 抓出并修掉的真缺陷（都有回归）**：① 搜索器曾把题设"洗白"后再判（丢掉解析器故意留下的未核验 residue），于是能对一个**产品路径会判未核验**的题面报 `verified_instance`（RED 实证：带 `∠ABC=60°` 的题面改前确实"通过"）；② 核验器在做**2D 点自由度**时按"有没有绑定"而不是按**绑定种类**判（线上点报 3），而 N1 的文件头承诺的是 1；③ 两个**新引入的模块环**（`parameterAudit → underdetermined → witnessSearch → planCompiler → parameterAudit` 与 `planCompiler ↔ witnessSearch`），前者已断、后者被有意记录并归 N3；④ 二面角求高的"歧义保障"先后两版都**是空操作**（先是对四次读数取最小值、后是只反转一个面环 —— 而内核的内角由**形心**方向算，两者都与环绕向/参数顺序无关），已删除并改成如实表述。
> **仍然没测的**：真实 provider 的开放题成功率（`deterministic_local` 不能冒充）；浏览器里"救援路径"的端到端验收（本阶段刻意不做测试后门，归 N4）；拖动保持关系（N3）；形式证明（N5）。**棱柱族**目前恒为"未核验"（原话解析把 `A′` 压成 `A`），这是设计出口允许的诚实结果，不是缺陷。

**2026-10-05 N1（统一数学状态 IR 与自由度诊断）—— 控制器在 `f997b3f` 上复跑：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **292 文件 / 3362 通过 + 1 todo / 0 失败**（439 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **N1 是基础设施，不是新能力。** 统一 IR、`reportFreeDegrees` 与五个 feature flag 已就位，但 `obligationIR` 开关**缺省为关**；关闭时报告形状与 `b1ee3d3` 逐字相同（有断言钉住）。题设覆盖面、确认门禁与用户可见文案**本批未变**，所以"错图静默通过"那一类的**可判定范围没有扩大** —— 它要等 N2 的求解与候选生成。真实 provider 准确率、拖动保持关系、形式证明仍全部未测。
> **本批复核抓出并修掉三个真缺陷（各带回归）**：① `no_witness` 曾被映射成证据状态 `failed`（"我知道它不是"），已改为 `unknown`，冲突结论留给 N2 的 solver 报 `inconsistent`；② 受约束点的自由度按"有没有绑定"判而不是按绑定种类判（线上点报 3），已按 `free=2 / onPath=1 / derived=0` 修正，2D 与 3D 两组用例经变异证明互不掩盖；③ 生产 Worker 策略不转发开关，使开关在真实应用里**永不生效** —— 已补转发，并让**真实策略**（而非手写替身）驱动跨线程用例。另：控制器自己的验证脚本曾被 `eslint` 扫到并制造 2 个 error，已移出仓库树，lint 复跑回到基线。

**2026-10-04 本轮升级后实测（代码提交 `b1ee3d3`；文档同步提交 `666d651`，均已推送 `origin/main`）：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | 287 文件 / 3319 通过 + 1 todo / 0 失败；先前 `--maxWorkers=3` 的一次全库运行遇到无关的 CAD 导出用例 5 秒超时，该文件单跑 9/9 通过，随后以 2 worker 完整重跑通过，不把超时那次算绿 |
| `npm.cmd run typecheck` | exit 0（全部工作区、e2e、scripts） |
| `npm.cmd run lint` | exit 0，0 error / 13 warning（既有基线警告） |
| `npm.cmd run build --workspace @draw/web` | exit 0，仍有既有的大 chunk 提示 |
| `npm.cmd run test:e2e -- --workers=3` | 186 通过 / 0 失败（含示意图可确认正例和额外未知条件拒绝反例） |
| `npm.cmd run test:perf` / `npm.cmd run eval:agent` | 9/9、3/3；后者仍仅离线确定性回归，不是真实模型准确率 |
| `npm.cmd run test:rust` | 236 通过、3 项按预设忽略、0 失败 |

> 以上“通过”只覆盖现有判据和固定示例；不保证真实 provider 能画对开放题，也不代表符号证明或拖动保持关系。

**2026-10-01 球体 Task 9 全量复跑（当次实测；下面那张表是更早一批的读数，保留作对照）**：

| 命令 | 当次实际结果 |
| --- | --- |
| `npx vitest run --maxWorkers=3` | **278 文件 / 3178 项通过 + 1 todo / 0 失败** |
| `npm run typecheck` | exit 0（6 个 workspace + `e2e/` + `scripts/`） |
| `npm run lint` | exit 0，**0 error / 13 warning**（既有基线警告，非零警告） |
| `npx playwright test --workers=3`（**全量 e2e**） | **175 通过 / 1 失败**。失败的是 `e2e/geometry3d.spec.ts:277`「pans the 3D view along the camera axes within a bounded range」，`expect(z).toBeCloseTo(startZ, 6)`：期望 1.98 / 实收 2。**经核实不是本批引入的**：在球体工作之前的 `91ac837` 上同样失败（期望 1.99 / 实收 2），而且那个期望值**逐次运行会变**（1.98 / 1.99 都出现过）—— 属**本机环境敏感的既有不稳定用例**；CI 的 `e2e` 作业在 Linux 上 #52 / #54 / #55 均绿。**这条已如实记为"门禁不稳"，没有被当成通过。**
   **2026-10-02 更新（该条已修，但全量 e2e 仍有 1 条红，且换了另一条）**：`geometry3d.spec.ts:277` 那条已**根因定位并修掉** —— 根因是**测试读了自动取景动画中途的读数**（`animateToFit` 约 250ms，rAF 里插值整份相机状态；`data-camera-target` 每帧都在变）。它有**两个面孔**：读得早 → 第 299 行（精度 1，实测 `Expected -5 / Received -4.8`）红；读得不等于停稳 → 第 309 行（精度 6，`Expected 1.98 / Received 2`）红。顺带**排除**了两个旧怀疑：`clampCameraTarget` 是箱式夹取（±3×半径）够不到那 0.02；而"水平平移不动 z"**确实成立**（`cameraBasis` 的 `right` 第三分量恒为 0）。修法：取基准前**等相机停稳**（连续两次读数一致，不写死 sleep），与既有 `settledWidth` / `settleCamera` 同一口径。**修后 `--repeat-each=5` 5/5 通过**。
   **但全量 e2e 仍不是全绿**：修后读数为 **178 通过 / 1 失败**，红的是**另一条** —— `e2e/geometry3d-section.spec.ts:42` 第 59 行 `data-preview-hovering` 期望 `"true"` 实收 `"false"`（指针没落在虚线预览上），**单独跑 3/3 全过**，属**并行负载下才出现的抖动**，机制与刚修的那条**不同**（那是"读动画中途"，这是"负载下命中判定偏移"）。**本条尚未定位，本批未修** —— 所以"本机全量 e2e 已全绿"**不成立**。
   **2026-10-02 再更新（追查结论：证伪一条假设 + 查出一条代码级脆弱点，但**没有修**）**：① **按需复现失败** —— 单独跑 3/3 全过、全量 `--workers=6` **179/179 全过**，只在第 21 轮那次 `--workers=3` 里见过一次；**不复现就不猜着改**。② **我最初的假设被代码证伪**：原以为是"投影时取景动画还在跑"，但 `threeSceneCamera.ts:87-97` 显示取景只在**文档 id 变化**时触发（不是每次编辑），且调的是**立即**的 `fitToContent()` 而非 `animateToFit()` —— 加立方体根本不触发取景动画，真正那次取景在更早的"跳转到立体几何"，到 `grabPoint` 时早已结束。③ **新查出一条代码级可证的脆弱点**：`data-preview-hovering` **只在** `threeScenePreviewHover.ts:106` 的 `updatePreviewHover` 里写入，而它**只由 pointermove 事件驱动**（没有任何 effect 在其它状态变化时重算）—— 所以**一次性的合成指针移动天然竞态**：那一瞬间命中几何没准备好，属性就永远停在 `"false"`，而 `expect` 的 5 秒轮询**救不回来**（事件不会再发）。这与观察到的现象吻合，但**未复现，不算已证实的根因**。④ **没有顺手改**：两条可选修法（测试侧反复重发移动 / 产品侧在预览变化时重算悬停）都无法用一次前后对比证明修好了那次失败 —— **不拿未经验证的改动冒充修复**。
   **2026-10-02 第三次更新 —— 按其中的"产品侧重算"那条修掉了**：③ 里查出的脆弱点现在有了修法 —— **内容同步之后按最后一次指针位置重算一次悬停**（`threeScenePreviewHover` 新增 `refreshPreviewHover()`，由 `threeSceneEffect` 的 `syncContent` 包装调用；`pointerleave` 会清掉记住的位置，所以不会凭空造悬停）。**因为原来那次竞态不能按需复现，判据做成了确定性的**：指针**一动都不动**、只让内容变（选中一只立方体删除 ⇒ 预览消失），`data-preview-hovering` 必须从 `true` 变成 `false`。**变异检查**：把 `refreshPreviewHover()` 那一行拿掉 → 期望 `false` 实收 `true`（**陈旧读数**，正是那条脆弱点的症状）✓。回归：预览 / 创建 / 截面三个 spec **23/23**；全库单测 280 文件 / 3203 通过 + 1 todo / 0 失败。详见 `CHANGELOG.md` 同日「悬停读数不再只跟着指针」一节。 |
| `npm run test:rust` | **16 个测试二进制 / 236 通过 / 0 失败 / 3 ignored**，exit 0 |
| `npm run test:perf` | **9 / 9 通过**。关键读数：`roundTrip/large-mgeo` 24.8 ms、`dag/local-recompute-400` 0.9 ms（全量 0.5 ms）、`denseIntersections/200x200` 1.4 ms、`drag/300-frames` **682.5 ms（≈2.3 ms/帧**，60 fps 预算 16.7 ms/帧）；校准档 1× ≈6 ms vs 4× ≈16–22 ms（量具灵敏度自证） |

> **读法**：第一节的读数各自注明"当次范围"；**全量 e2e 已于 2026-10-02 复跑并全绿**（见下条），其余几条是各自当次的精确读数。
**2026-10-02 第四次更新 —— 全量 e2e 已复跑：`npx playwright test`（默认 workers）→ 184 通过 / 0 失败。** 那条 `geometry3d-section` 抖动在本轮修掉之后（见上面第三次更新：悬停按最后的指针位置自愈）不再出现。**这是本会话唯一一次全量 e2e 复跑**，读数按当次实跑记录 —— 至此第一节里"全量 e2e 未复跑"这条缺口关闭。

| 命令 | 本轮实际结果与范围 |
| --- | --- |
| `npm test -- --maxWorkers=3` | **266 个测试文件 / 3072 个用例通过 + 1 todo / 0 失败**（全库；比上一批多 6 项 = 创建状态机补的边界用例） |
| `npm run typecheck` | 6 个 workspace，以及 `e2e/` 与 `scripts/` 类型检查，全部 exit 0（本轮复跑） |
| `npm run lint` | exit 0，**0 error / 13 warning**（已有基线警告，并非全部无警告；本轮复跑） |
| `npm.cmd run build`（2026-10-01） | **exit 0**：根脚本遍历全部工作区；桌面 `tauri build --no-bundle` 完成 release exe（不是 MSI/NSIS 打包），Web 前置构建和工作区构建均通过，4 个 packages 的 `tsc -p tsconfig.json` 全通过。Web 入口 1701.84 kB，仍有 >500 kB 分块及混用动态/静态 import 警告；Rust 有 linker 消息警告。首次沙箱内尝试因 `Cargo.toml` 写入拒绝而失败，获准在沙箱外复跑成功。**不代表**全量 e2e、Rust 测试、性能测试或安装包实机验证通过。 |
| `npm --workspace @draw/web run build` | exit 0；入口 1694.22 kB、`engineeringExporters` 433.81 kB、`geometry.worker` 310.99 kB；仍有 >500 kB chunk 警告 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，球体 Task 1 已核） | **269 文件 / 3110 项通过 + 1 todo，exit 0**。schema/codec 的球体目标用例先因未知 `sphere` 红，能力表/CSV 目标用例也红后转绿；提交 `ca03ed5` 的 CI checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，球体 Task 1 已核） | **171 / 171 通过**，提交 `ca03ed5` 的 CI e2e 成功；尚无球体 UI 用例，只能证明旧浏览器功能未回退，**不能冒充球体已可创建**。 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，相机同步） | **269 文件 / 3105 项通过 + 1 todo，exit 0**；无网格代刷新时标签与当前相机曾偏差约 386px，绘制入口在投影前显式同步矩阵后点名/测量两层均绿；提交 `a4e2f40` 的 CI checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，相机同步） | **171 / 171 通过，exit 0**；教学标签用例去掉“松手后再抖鼠标”的补帧，单独连续 5 次通过；提交 `a4e2f40` 的 CI e2e 成功。 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，实体体积标注） | **268 文件 / 3104 项通过 + 1 todo、exit 0**；用真实斜棱柱证明画布定位红→绿，缺顶点时不猜位置；GitHub CI run `36898807030` 的 checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，实体体积标注） | **171 / 171 通过、exit 0**；真实浏览器验证 `data-measurement-labels=1`、48.000u³ 数字可见且保存重开仍在；本地实景截图核对实体中心清晰可读，GitHub CI run `36898807030` 的 e2e 成功。 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，Task 6） | **268 / 268 文件、3103 项通过 + 1 todo / 0 失败，exit 0**；原始两条改单顶点目标用例曾红，面名唯一性、重合点拒绝、非凸布尔交集与合法外凸交集各有回归；提交 `cc9f533` 的 GitHub CI checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，Task 6） | **171 / 171 通过，exit 0**：棱柱/模板实体的属性栏改单点、一步撤销/重做、保存重开、改后体积量测与截面；提交 `cc9f533` 的 GitHub CI e2e 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01） | **169 / 169 通过，exit 0**（全量；Windows 本地）。修正 3 份旧 e2e 的测试几何输入：默认立方体已是 4×4×4，旧用例仍按 4×4×2 取剖切面/内切球；拖动截面的原落点在屏幕上与棱重合，棱按设计优先。修正前本地 165/169；**GitHub CI run `36890961011`（提交 `465788a`）四个作业全部成功**。 |
| 7 个相关 3D Playwright spec | **50 / 50 通过**（本批复跑；含创建、实体面板、原立体交互、旋转环、求交预览、棱柱旧文件、教学虚线；比 `a53b034` 记录的 44 项多 6 项 = 此后各批新增的用例）；**第二组 7 spec / 36 项也通过**（创建、棱柱、六类样题、拖动、相机记忆、求交预览、教学线型）；全量 2026-10-01 的新读数见上行（这里仍保留当时两组局部回归的历史读数） |
| `e2e/high-school-geometry-tasks.spec.ts`（Task 8 三批合计） | **7 / 7 通过**（本轮复跑）：三棱锥、四棱锥、斜三棱柱、异长长方体、圆锥截面、空间直线与平面的关系、已有文档恢复与撤销 —— **六类代表题全部覆盖**；断言顶点坐标、三边尺寸、拉伸向量、解析圆锥曲线离心率、平面方程判定的线面关系、旧文档迁移后的拓扑几何、刷新后逐 id 恢复、拓扑依赖、保存往返与一步撤销（三批各做过变异检查）；另含两条回归：**恢复后第一次改动必须写回草稿**（修复前红 Expected 112 / Received 84、修复后绿）与**点到平面距离与选择顺序无关**（两种顺序都量出 3.000u） |
| `apps/web/src/spatialPick.test.ts`（Task 3 补充用例） | **11 / 11 通过**：新增相机斜视（斜射线落点精确）、面背侧（命中优先于工作平面、不猜深度）、距离容差（`1e-8` 阈值两侧都钉住）、重叠点（身份来自命中而非坐标反查）；三次定向变异各自抓红对应用例 |
| `e2e/solid-prism.spec.ts`（Task 6） | **8 / 8 通过**：旧 6 项含棱柱体积 48 与保存/恢复；新增棱柱/模板改单顶点两项，覆盖 `.mgeo` 往返、棱柱一步撤销/重做、改后体积有效与截面成环。此行是 Task 6 当次读数；实体体积**画布数字**后续由 `374daa0` 独立修复并验收。 |
| `apps/web/src/persistence/mgeoRoundTrip.test.ts`（Task 4 补充） | **5 / 5 通过**：新增"画布新建的点 / 线段 / 直线 / 面"往返 —— id 集合与几何不变、三种引用写法（线段 `pointIds`、直线 `definition.pointIds`、面 `pointIds`）都仍指着存在的点，且重开后再引用旧点会**复用**（变异检查证过） |
| `e2e/geometry3d-teaching-lines.spec.ts`（Task 7 补充） | **2 / 2 通过**：新增「旋转视角后顶点标签仍逐点对齐」—— 对每个 `[data-point-id]` 断言其锚点等于**它自己那个顶点**的投影（±2px），旋转前后各查一遍，并用 `data-camera-azimuth` 确认真转了；变异检查（偏移 +10→+60）当场报 50px |
| `e2e/geometry3d-creation.spec.ts`（Task 5 / Task 3） | **10 / 10 通过**：创建悬停读数（工作平面 + 世界坐标 / 已有点 + **该点自己的**坐标，且**对象行数全程不变**）、切换工作区取消未提交状态（锚点归零、无半成品）、**创建优先于预览点击**（点交面预览只落地一个空间点，不多出交面图元、预览不被消耗）、**从「选择工具」退出**（工具与锚点归零、未提交锚点不落盘、退出后点空白回到选择语义不创建）、**锁定对象不被吸附**（同一坐标：未锁定读"已有点"、锁定读"工作平面 XY"、解锁又读回"已有点"，且点仍在画布上） |
| `e2e/geometry3d.spec.ts`（Task 1 基线补充） | **24 / 24 通过**（22→24）：新增 **Shift 两点多选→创建空间直线**（原用例只到"按钮可用"，现真的点下去建出对象，并以操作提示"对象 3"钉住复用已有两点不另建）与 **Esc 分级基线**（属性栏不再编辑任何对象、而对象行数一个不少 —— Esc 不是删除）；各带一条定向变异 |
| `apps/web/src/spatialCreationSession.test.ts`（Task 2 边界） | **10 / 10 通过**（4→10）：point3 一点完成 / line3+ray3 两点完成 / **face3 无论多少点都不自动完成、只有 Enter 收尾** / 首末点重合被拒且会话不前移 / 非有限坐标被拒且不留脏数据 / 拒绝提交的原因文案；三处变异各自精确抓红，并查明 face3 有"两层独立守卫" |
| `apps/web/src/spatialTools.test.ts` + `threeScene.test.ts`（Task 1 基线） | **74 / 74 通过**（16 + 58） |
| `e2e/html-export.spec.ts`（E3 HTML 导出） | **3 / 3 通过**（先红后绿，RED = 三条都卡在"导出 HTML"按钮不存在）：平面导出 `setContent` 打开后图可见且零外链、CAD 四个 `data-drawing-view` 且整份只有一个 `<svg>`、**立体几何明确拒绝且零下载** |
| `packages/agent-core/src/tools/interactionTools.test.ts`（E3 HTML 导出） | **12 / 12 通过**：新增"Agent 导出通道**恰好四个格式**"的**类型级**判据（`proposeExport` 与 `preflight` 两处联合各一条）。**两次变异**：改 `proposeExport` → `tsc` 报 `(149,11): Type 'true' is not assignable to type 'false'`；改 `preflight` → 报在 `(155,11)`。**第一次只钉一处时改另一处拦不住**（`tsc` 全绿），补上第二条后才拦得住 |
| `apps/web/src/persistence/htmlExporter.test.ts` + `fileExports.test.ts`（E3 HTML 导出） | **9 / 9** + **9 / 9 通过**：产出器（内嵌 SVG 逐字一致、零外部引用配反向对照、SVG 内无 id、存档 `encode→decode` 不动点、`</script>` 注入防护、损失清单有则列出无则写"无"、版本戳含 `unknown`）与导出路径（**立体几何明确拒绝且零下载**、平面产出自包含 HTML、CAD 走工程产出器且诊断进损失清单）；两处各带定向变异 |
| `npm --workspace @draw/desktop run bundle`（**2026-10-02，最新一次**） | 根 `npm run build` **exit 0** → `bundle`（`tauri build`）**exit 0**（Rust release 1m16s，WiX 出 MSI、NSIS 出 setup）。产出 **v3.2.0**：exe **17,209,344 B** / MSI **6,860,800 B** / NSIS **5,040,418 B**（哈希见 [`release/v3.2.0.md`](release/v3.2.0.md)）；**打包前核对了外壳前端来源**（`build-check/mathcanvas-current` 的那份 `index-*.js` 距打包 2.3 分钟且含「导出 HTML」等字符串）；免安装 exe 启动实测（句柄 `2886386`、存活 T+20s）。**tag `v3.2.0` + GitHub Release 已发布并独立复核**（匿名 API `releases/latest` = `v3.2.0`；三件资产重下载后 SHA-256 全部 MATCH）。与 **2026-10-01 根脚本 `npm.cmd run build` 的 v3.0.1 `--no-bundle` 构建是两次不同的验证**，不要混成同一件事。 |
| `npm.cmd run test:perf -- --reporter=verbose`（2026-10-01） | **9 / 9 通过，exit 0**；PERF 实际毫秒读数见下方新表，趋势/量级护栏不等于跨机器性能目标。 |
| `npm.cmd run test:rust`（2026-10-01） | **236 通过 / 0 失败 / 3 ignored，exit 0**（16 组测试/文档测试结果）；初次在沙箱中因 Cargo debug 构建锁写入拒绝而未运行，获准在沙箱外复跑。2 条真实 DeepSeek API 测试需凭据，1 条真实 Windows 凭据管理器写入测试按默认策略忽略；不能声称这些外部依赖已验证。 |

**本机性能趋势（2026-10-01，当次 `PERF` 毫秒，不跨机器作硬比较）**：`addPrimitives/1000-planar` **15.2**、`recomputeDerivedObjects/100-solid` **59.5**、`solidStatusReport/100-solid` **17.9**、`encodeMgeo/large` **12.7**、`roundTrip/large-mgeo` **40.4**、`denseIntersections/200x200` **3.3**、`drag/300-frames` **1680.5**（约 5.6 ms/帧）；`dag/full-recompute-400` **1.0** 与 `dag/local-recompute-400` **2.0**。本批所有量级护栏通过；局部重算耗时高于全量重算，是后续优化线索而非本批失败。

**性能读数（2026-09-26 历史基线；2026-10-01 的新读数见上表）**（当时本机实测，保留供历史比较；不同运行环境下不直接推断回归）：

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

**主线程帧间隔（2026-10-01）**：`e2e/main-thread-responsiveness.spec.ts` **单独运行 1/1**，载入 max **316.7 ms**、拖动 24 步 max **150.0 ms**（p95 **16.8 ms**）、故意阻塞标定 **199.9 ms**；同日**全量 e2e 并行运行时该条也通过**，载入 max **333.4 ms**、拖动 max **83.2 ms**（p95 **16.8 ms**）、标定 **200.0 ms**。两次拖动最大空档均低于该测试的 250 ms 量级护栏；冷启动/并行抢 CPU 的载入数字不作硬门槛。

**主线程响应性读数（2026-09-26 历史基线；2026-10-01 新读数见上行）**（保留当时两种运行环境的读数，不当作现值）：

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

## 本轮高中几何交互（功能分支，**2026-09-30 已合并进 `main`**；依次随 **v3.1.0** 与 **v3.2.0** 打包发布）

- **P0 已在功能分支完成**：直接在 3D 画布按步骤作空间点/线段/直线/射线/平面/面；XY/XZ/YZ/选中面工作平面落点、只预览不落盘、Esc 取消/Enter 完成、一笔事务一步撤销；保留原 Shift 多选和 Alt 选子对象路径。
- **P1 已完成**：常用立体参数面板可创建正方体、长方体、三/四棱柱（含斜棱柱）、三/四棱锥；改变参数显示未保存 3D 预览、确认后提交；原快速「添加立方体」新建尺寸更正为 4×4×4。教学线型模块支持独立空间线/棱的实线、虚线和点线，并保留到 `.mgeo`；「隐藏边」是另一套只影响视图的开关。**旧文件尺寸不迁移**。
- **仍未完成（2026-10-02 复核后的实情）**：① **教师/学生走查**（用户侧）；② **MSI 的"装 → 启动 → 卸载"验收**（需管理员；NSIS 那半已在本机走完一圈）；③ 画布拖动手柄 / 关联拉伸仍是独立后续范围（属性栏**单顶点数值编辑**已交付，提交 `cc9f533` 且 CI 全绿）。**曾经列在这一条里的两项已经交付**：球体与球截面随 **v3.1.0**、HTML 导出随 **v3.2.0**；题目截图识图、GeoGebra `.ggb`、平面/函数逐题补缺**仍未启动**（见 §四 E 类）。
- **Task 8 三批已落地并上传**（提交 `cecc1fe`、`0166845`、`1a82c97`）：`e2e/high-school-geometry-tasks.spec.ts` 六类代表题转成可重放操作序列，2026-09-29 的样题 e2e **7/7**；当次 `typecheck` exit 0、`lint` 0 error / 13 warning、全库单测 266 文件 / 3072 项通过 + 1 todo。**2026-10-01 单独补跑根脚本 `npm.cmd run build`，exit 0**（Web、桌面 release exe 和 4 个 packages）。计划 Task 8 第 2 项所列命令已有分次实测，仍不能视为整期验收完成：本地全量 e2e 于 2026-10-01 达到 169/169，教师/学生走查仍未做。
- **Task 8 第 4 项已收口**（提交 `f48d579`）：[功能目录](feature-catalog.md) 新增「本期收口（2026-09-29）：实际已完成 / 未完成」一节 —— 分别列出**已交付**（画布直接绘制 / 常用立体 / 教学线型 / 解析截面读数 / 六类样题可重放验收 / 两处缺陷修复）与**未交付且需要你决定是否启动**（球体与球截面、截图识图、HTML 与 GGB 导出、平面函数逐题补缺、教师走查与完整桌面打包），并写明「都在功能分支、未打包」（**2026-09-30 更正：该分支已通过 PR #1 合并进 `main`，见文末「本轮结束时的交接」**）。
## 二、按评审方案：做到哪一步了

**一句话进度（估计，口径写明）**：**七条方案全部落地并验收**；方案 2 的六个目标文件全部拆分完成（`operations.ts` 也走到 **2817→307**）。剩下的是**可选**项与长尾（`operations.ts` 内仍可细分、`App.tsx` 与 `threeSceneEffect.ts` 内仍可细分）。门禁面已无已知缺口（`e2e/` 与 `scripts/` 都进了 `tsc`）。

| 方案 | 优先级 | 状态 | 一句话 |
| --- | --- | --- | --- |
| 1. 统一实体构造与拓扑物化 | P0 | ✅ **已完成并验收** | 见下节 |
| 2. 拆分过大的编排和领域文件 | P1 | 🔶 **已开四十六批** | `operations.ts` 2817→**307**（→ 十一个模块）、`PropertiesBar.tsx` 1069→298（→`inspectorFields` / `inspectorLabels` / `inspectorReadings` / `inspectorModel`）、`App.tsx` 2000→**809**（→`fileExports` / `documentIds` / `creationCommands` / `solidCommands` / `recordCommands` / `structureCommands` / `anchorRotationCommands` / `point3ToolCommands` / `previewCommands` / `selectionCommands` / `canvasStatusPrompt` / `draftingCommands` / `appViewState` / `useDraftPersistence` / `commandDispatch` / `useKeyboardShortcuts`）、`threeScene.tsx` 1807→269（→`threeSceneEffect` + **七个阶段模块**）、Rust `lib.rs` 992→**168**（→`src/commands/` 五组）、`agent-core/schemas.ts` 1300→**180**（→`schemaReaders` / `actionRegistry` / `hashing` / `actionInputs` / `actionAudit`） |
| 3. 接入几何 Worker | P1 | ✅ **已完成并验收** | 宿主生命周期 + 如实降级；契约缺口全部填上 |
| 4. 工作区级代码分包 | P2 | ✅ **已完成** | 分包那一次：入口单 chunk 2 066.63 → 1 629.80 kB（−21.1%）。**当前入口是 1 801.18 kB**（2026-10-05 实测，之后的正常增长），见 §三 的"主 bundle 仍超 500 kB"一条 |
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

### 如实缺口（不是缺陷，是没做或做不到）

- **CI 的首次运行是"三红一绿"，三个红都不是产品代码的问题，而是门禁自己要不要自足**（2026-09-25，run #1 / `96ff89f`；run #2 又暴露出两处，run #3 / `f10ee8e` **四个作业全绿**；两条修复提交 `26763e7` / `f10ee8e`，见 `CHANGELOG.md` 同日那一节）：
  1. `checks` 红在 `scripts/preview-server.test.ts` —— 它等 `127.0.0.1:4173` 返回 200，而那需要 `build-check/` 里有一份构建；本机一直有，CI 上没有（构建在另一个作业里），于是轮询到 vitest 的 5 秒超时。修法：用例自己造最小产物 + 随机端口，**不再依赖本机恰好有构建**（把真实产物挪走后复跑，仍然绿）。
  2. `build` 红在根目录的 `npm run build`（= `--workspaces`）连带去跑 `apps/desktop` 的 `tauri build`，而那个作业没有装 WebKitGTK。修法：这个作业只构建 web 工作区 —— 与它自己注释里"桌面打包刻意不进 CI"一致。
  3. `rust` 红在 `shell_smoke` 的 `the_web_entry_the_shell_loads_exists_and_is_the_web_build`：它断言外壳加载的 web 产物**真的在**，而 `cargo test` 不会跑 `tauri.conf.json` 的 `beforeBuildCommand`。修法：作业里先 `npm run build --workspace @draw/web` 再跑测试。
- **Rust `lib.rs` 的"大"有一半是被一份**守护性断言**钉住的**（2026-09-25 拆它时发现）：`tests/shell_smoke.rs` 原来要求**所有** `#[tauri::command]` 都写在 `src/lib.rs` 里（它按 `lib.rs` 的文本数 `#[tauri::command]` 的条数、并逐条找 `fn <名字>(`）。也就是说这个文件不是"没人拆"，而是"拆了就会红"。这一批把那份断言的口径从"扫 lib.rs"改成"扫整棵树"（`src/lib.rs` + `src/commands/*.rs`）—— **意图没变，覆盖面反而更大**：它现在守的是"只暴露具名命令、没有泛型命令、没有通用 shell / 文件读写出口"这条性质，而不是"命令住哪个文件"。登记清单仍逐字写在测试里（比对时只取路径的**最后一段**）。
- **`scripts/` 下的测试已纳入 `tsc`**（2026-09-25 补）：新增 `scripts/tsconfig.json` 与一份**最小的 node 类型声明**（`scripts/nodeTypes.d.ts`，只声明脚本真的用到的 `spawn` / `once` / `mkdtemp` 等）—— 与 `e2e/` 同一套做法，同样**刻意不装 `@types/node`**（它会全局引入并改变应用侧 `setTimeout` 的类型）。根 `typecheck` 现在末尾跑三段：workspaces + `e2e/tsconfig.json` + `scripts/tsconfig.json`。

- **几何 Worker 已接线，但"值不值"这条结论仍是**依据本轮读数**得出的**（编译 73 ms vs 复制 1 ms，约 76 倍）；**不是"管线全同步"** —— 那个判断此前记错了，已更正。降级路径（没有 `Worker` 的环境就地算）有独立用例，见方案 3 一节。
- **性能上的一件事还没做**：把 `applyOperation` 每次从整份文档 `structuredClone` 的成本降下来。基准显示这一档**固定成本压过增量收益**（局部重算比全量还慢）。注意这与方案 3 不是同一件事：编译那 73 ms 花在**算**上（复制只占 1 ms），所以 Worker 对它是有效杠杆；而重算那一档的固定成本才是复制。
- **主 bundle 仍超 500 kB 警告（2026-10-05 重新量过）**：入口 `index` chunk 现在是 **1 801.18 kB**（gzip 526.71 kB），比此前记的 1 614 kB **又长了约 11.6%**。上面那句"应用代码 ≈855 + React 221 + Three 530"是**当时那次的拆分读数**，本轮**没有重新拆**（要拆得单独做一次 bundle 分析）。`three` 仍在入口 —— 立体几何是首屏可达的顶级模块，拆它要连带改 `threeScene.tsx` 的装配方式。**同一次构建里还有** `engineeringExporters` 433.81 kB 与 `geometry.worker` 376.19 kB 两个独立 chunk。
- **`npm run test:rust` 已复跑**（**2026-10-05 更新：238 例通过 + 3 ignored / 0 失败**；2026-09-25 那次是 232 —— 差额来自第 21 轮给凭据库用例加的两条并发守卫，与第 27 / 37 轮两次复跑一致）—— Rust 侧其余部分本阶段零改动。
- **确认面板不按属主实体归并子对象**：用户要"一个立方体"，面板会说"会新增 28 个对象"。计数本身没错（28 个对象确实都会进文档），但"要不要按实体归并着说"是产品判断 —— 与方案 1 里"对象树以拓扑为依据"是同一个问题的另一面。**连带影响**：`agent-flow.spec.ts` 里有两条用例还在按"一个立方体 = 一个对象"断言（`共 2 个` / `会新增 1 个对象`），方案 1 之后它们必然为红 —— 已改成断言**不会随计数口径漂移**的性质（"共 N 个"必须大于"本次新增"，即草稿落在已有内容之上），同批 e2e 里 `solid-prism` / `agent-oblique-prism` 一直是按新口径断言的。
- **`longtask` API 在本机不可用（实测，不是猜的）**：评审方案 7 点名要的 `PerformanceObserver({ type: "longtask" })` 在**空白页**上、对一次**故意阻塞 200 ms** 的主线程占用，`observed` 与 `performance.getEntriesByType("longtask")` **都是空的**，而 `supportedEntryTypes` 里**确实**列着 `longtask`（Chromium 153 / Playwright headless）—— 即"声称支持、什么也不报"（一次性探针复核过，用完即删）。所以主线程读数改用**帧间隔**（`requestAnimationFrame` 间隔）实现：同一个 200 ms 阻塞必定表现为 ≥200 ms 的空档，量具灵敏度可以自证（用例里就有这条标定断言）。见 `e2e/main-thread-responsiveness.spec.ts`。
- **`section.create` 的平面已收口，但"登记表承诺 ≠ 校验层实现"这类风险只是**被识别出来**，没有机器挡住**（2026-09-26，见 §二「实机现场故障」）：`actionRegistry` 是"我们承诺收什么"的唯一声明处，而 `actionInputs` 里**少一个分支就静默落空** —— 字段会原样透传，直到文档校验器才被拒，报的还是够不到的**动作级**路径（那条一次性修复因此改不动它）。这一批把 `section.create` 补上了（三种平面写法收成一种，且共线时按**字段路径**拒绝），并留了判据："登记表里写了 `ask_user` 问题、或写了可选字段的每个动作都必须在校验层有显式分支"。**但这条判据目前只写在文档里**，没有一个测试逐动作核对登记表与 `parseActionInputs` 的分支覆盖面 —— 下一个新动作照样可能漏。
  - **2026-10-01 更正（范围收窄）**：上面这条**对"整张动作登记表"是过重的说法**。球体 Task 8 新增 `solid.create_sphere` 时实测：**动作目录这一层是有机器闸门的**，而且是它把我挡下来的 ——
    1. **编译期**：`skills/manifest.ts` 的 `CAPABILITY_FOR_ACTION` 是 `Record<DraftActionIdName, string>`，新增动作漏登记直接 `tsc` 报错（实测 `Property '"solid.create_sphere"' is missing in type …`）；
    2. **测试期**：`actionIds.test.ts` 钉动作总数（27→28）、`capabilities.test.ts` 钉各图元能力状态、`catalog.test.ts` 钉技能清单的**内容哈希**（改 `manifest.actionIds` 不更新 `EXPECTED_HASHES` 就 `hash_mismatch`）、`actionFieldParity.test.ts` 逐动作跑 `parseActionToolInput` 并把失败落到字段路径。
    **所以真正缺的只是"逐动作的字段覆盖面"这一层**（登记表写了可选字段 / `ask_user`，而 `actionInputs` 没有对应分支 —— 那种"字段被原样透传到文档校验器"的静默落空），不是"整个登记表没有守卫"。下一个新动作在三处会被机器逼着改齐，但**新加一个可选字段**仍可能漏。
- **平面写法上刻意只收三种**：规范形 `{normal, constant}`、过三点 `{points|throughPoints: […3]}`、点 + 法向 `{point|origin, normal}`（坐标 `{x,y,z}` / `[x,y,z]` 都收）。**不做**的：用两个方向向量定平面、用字符串别名指代平面（`"diagonal"`）、用曲面/多边形顶点集反推 —— 遇到这些会如实按 `invalid_plane` 拒绝并给出字段路径，而不是猜。
- **（已闭环，留档；不再是缺口）本轮查实并修掉两处真缺陷** —— 2026-09-29：① **恢复草稿后第一次改动不落盘**（会丢用户数据；提交 `4968051`）—— 根因是 `useDraftPersistence.ts` 里 `skipNextDraftSaveRef` 与 `restoreSettledRef` 的判断顺序赛跑（skip 被用户恢复后的第一次改动吃掉），修法是先消费 skip 再判 settled、两条原有守卫都不变松；回归钉在浏览器侧（修复前红 Expected 112 / Received 84、修复后绿），单测那 9 条钉语义、前后都绿。② **「距离」测量在"平面先选"时只得到无效读数**（提交 `e25cacb`）—— 根因是内核 distance 分支固定按 `sourceIds[0]` 是点取数（`pointFromPrimitive` 对 `plane3` 返回 `null`），修法是把"点那一侧"换到前面、`measurement.sourceIds` 仍记用户的选择顺序；回归在内核（`measurements3d.test.ts`，修复前红）与浏览器（两种顺序都量出 3.000u）两侧都有。详见 `CHANGELOG.md` 同日两节。
- **（已闭环，留档；此前那条"锁定不被吸附未实现"的记录是错的）「隐藏或锁定对象不被当作可吸附目标」两半现在都成立** —— 2026-09-29 复核更正。**更正的原因是我在错的层次上核对**：当时只看了纯函数 `resolveSpatialAnchor`（它只按命中物回答、**不认识文档**，所以不可能知道 `locked`），没看真正的过滤点 —— `threeSceneEffect.ts` 的 `resolveCreationAt` 里 `primitive.visible === false || primitive.locked || （生成的 point3）` 一律丢弃命中。**隐藏**那一半是构造性的（`threeSceneContent.ts` 先 `filter(isUserVisiblePrimitive)` 再建对象，隐藏图元根本不进场景），**锁定**那一半由上面那道门禁负责：锁定对象仍看得见、仍能选中，但创建时不再被吸附（退回工作平面）。证据是一条自带对照的 e2e（`e2e/geometry3d-creation.spec.ts`）：同一屏幕坐标，未锁定读"已有点 (0.00, 0.00, 0.00)"、锁定后读"工作平面 XY (…)"、解锁后又读回"已有点"；定向变异（摘掉 `primitive?.locked`）当场红。顺带澄清一处容易混的地方：`primitiveVisibility.ts` 的 `isUserVisiblePrimitive` 确实**不看** `locked` —— 那是**渲染可见性**判据，锁定不改变可见性，这正是我们要的语义；吸附门禁在创建拾取那一层，两件事不在一个函数里。
- **单顶点编辑的旧缺口（2026-09-29 查实；2026-10-01 已修且 GitHub CI 全绿）**：旧路径会因非共面四边形整笔拒绝；现将受影响面拆为合法三角片，保留原面 id、补内部细分棱并同步实体面/棱引用，不放宽 `face3` 共面校验。旧症状与更正记录见以下历史子项。
  - **更正**：此前这里记的是"属性栏改棱柱顶点坐标被**静默丢弃**、无任何提示"。走 UI 的真实路径复核后，那条**不准确**：`commitPatch`（`store.apply` 调的就是它）返回 `changed=false` + `error = "the change would make the document invalid: face3 points are not coplanar…"`，浏览器实测输入框弹回原值的同时**页面确实弹出了 `role="alert"`**，文案就是这一句（用一次性探针实测，探针已删）。
  - **根因**：棱柱（与模板实体一样）的侧面是**四边形**；改一个顶点会让相邻三个面立刻不共面，而文档校验器要求 `face3` 的点共面 → **校验层**把整笔退回。存储层本身是支持这件事的（`apply.ts` 会把描述翻成 `fromFaces` 再写顶点），但它先过不了校验层 —— 所以"存储层能改"不等于"属性栏能改"。
  - **另一条现象很可能是同一根因**：拖顶点手柄之后按 Ctrl+Z 被拒，报的是**同一条** `face3 points are not coplanar`。**推断**（未逐条验证）：那次拖动本身被拒、没有留下历史，于是 Ctrl+Z 撤掉的是上一步"创建棱柱"，画面因此变空、`data-content-bounds` 读出 NaN。
  - **已交付**：棱柱和模板实体属性栏改单顶点、一步撤销/重做、`.mgeo` 保存重开、改后体积量测和截面已通过本地真实浏览器及 GitHub CI（`cc9f533`、run `36895877862`）；移动到另一顶点同坐标时明确拒绝且不改原文档。拖动手柄/关联拉伸属独立后续范围。
  - **旧表征用例已更新**：`scene-store.test.ts`、`recomputeConsistency.test.ts`、`intersectionSolid.test.ts` 钉住面/棱引用、增量重算不动点、真实凹形拒绝与外凸体交集体积；`e2e/solid-prism.spec.ts` 走浏览器保存/撤销/量测/截面。
- **实体源体积的画布数字（2026-09-29 查实；2026-10-01 已修且 GitHub CI 全绿）**：原 `measurementVisuals.ts` 的 `pointPositions` 不认 `polyhedron3`，有效体积测量也没有画布数字；现以物化顶点求标签落点、缺顶点不造假坐标，复用现有 3D 叠层和样式。提交 `374daa0`；48.000u³ 实景清楚显示于实体中央，`.mgeo` 重开保持，CI run `36898807030` 四作业成功。
- **相机拖动后 HTML 标签滞后一帧（2026-09-29 查实；2026-10-01 修复且 GitHub CI 全绿）**：两层标签原在 `renderer.render` 更新相机矩阵之前投影；v3.0.1 的网格脚印计算曾碰巧提前刷新矩阵，掩盖无网格时约 386px 的偏差。现由 `threeSceneRender.render()` 在点名/测量标签投影前显式同步矩阵，不靠网格副作用或松手额外补帧。提交 `a4e2f40`，CI run `36901742182` 四作业成功。
- **（已闭环，留档）「自动取景动画会覆盖用户拖动」那个窗口已修**（2026-10-02，提交 `fd234fd`）：过去 `cancelFitAnimation()` 只在副作用清理（卸载）里被调用，用户拖动不取消进行中的取景，于是"换文档触发取景"之后在 **250 ms 窗口内开始拖**，拖动结束后剩下的帧会把用户刚拖出来的视角覆盖回去。现在 `pointerdown` 与滚轮都会先取消它。**顺带补了可观测状态** `data-fit-animation`（`running` / `done` / `cancelled`）—— 因为这条缺口的第一版用例是**假绿**的（触发条件搞错了：`shouldAutoFit` 只在换文档或内容出界时取景），现在用例要先抓到 `running` 才继续。证据：新增 `threeSceneCamera.test.ts`（该模块此前无测试，3/3，含"取消后不再排帧"）+ `geometry3d-drag.spec.ts` 一条 e2e（变异：去掉取消 → 期望 cancelled 实收 done，红）。
- **引用进度档案一律用小节标题，不写行号**：`project-progress.md:<行号>` 形式的引用会随任何一次编辑静默失效（本阶段就发生过三处，已全部改成按标题引用）。

## 下一轮 Agent 方向（**N1、N2 已实施；N3 已开工；N4–N5 未实施**）

这次用户要求把原先暂缓的能力全部纳入路线，已形成完整设计。**N1 与 N2 已交付并复核**（都在默认关闭的 flag 之后，默认行为未变），其余尚未实现：

1. **N1 统一数学状态（已完成）**：Obligation / Constraint / Claim IR，统一题设、目标、自由点、证据和 solver 状态。提交 `acd3bd5` / `2d62c4d` / `b5b33f9` / `f997b3f`；**在 flag 之后，默认关闭**。
2. **N2 解析构造与见证搜索（已完成）**：题面点名 + 关系（**无显式坐标**）时，系统自己解析构造候选（棱锥/棱柱）、按 seed/上限/预算做有界搜索，并**只把通过同一个核验器的候选**接进编译路径。提交 `c2314c9`..`e3fdb61`（内核）、`8648a13`..`ab05add`（搜索）、`ca1d0b2`..`9c5ae2f`（接线 + spike）。**`witnessSearch` 缺省关**；关闭时编译结果与 `4707b64` 逐字节相同。后端的可行性评估（Z3/NLSAT）只有**一次运行**的实测数字与原始产物，**没有接入产品**。
3. **N3 动态拖动保持**：约束进入文档状态，拖动变成临时约束求解和事务提交，显示自由度与冲突原因。
   **已开工（2026-10-05，三步）**：内核的点投影、拖动层的自由度/冗余诊断、以及**拖动接线的决策层** `apps/web/src/constrainedDrag3.ts`（`App.tsx` 的 3D `onDragEnd` 已接上）都已落地并复核（见 §一）。**开关缺省关，关着时逐字走旧路径**，所以产品行为未变。还没做：把 `constrainedDrag` 打开的**产品入口**（否则浏览器正/反例无从谈起）、`inconsistent`/`timeout` 的可证判据（矛盾约束目前只报"没能同时满足"）、线状 `parallel`/`perpendicular` 的投影、`e2e/agent-constrained-drag.spec.ts`、拖动连带的撤销/重做与 inspector 提示。**秩已与 `reportFreeDegrees` 合流**（共用内核 `linear-algebra.ts` 的 `rankRows`），但两者的"可动集"口径按设计保持不同。
4. **N4 开放题理解与真实 Provider Benchmark**：自然语言先编译为 Obligation IR，再规划/求解/核验；建立真实 provider 的 pass@1、pass@3、成本、延迟和人工可读性基线。
5. **N5 形式证明出口**：先支持少量短目标，区分 verified_instance、sampled、formally_proved，证明后端独立校验证书。

完整设计：`docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`；实施计划：`docs/superpowers/plans/2026-10-04-agent-full-next-phase-implementation-plan.md`。外部项目调研：`docs/research/2026-10-04-github-project-survey.md`。

**当前明确不承诺**：下一阶段设计不等于已实现；在真实 provider 基线、求解器边界、动态拖动和证明试点完成前，默认 Agent 仍只按当前已验证的静态示意图能力运行。**N2 的能力目前只在把 `witnessSearch` 打开时才生效，而 CLI/界面里没有任何打开它的入口**。
## 四、未完成任务总清单（2026-10-04 文档审查后；本节是“还差什么”的唯一权威处）

> 口径：只有在第一节当次真正跑过的内容才写成门禁读数；本节只列当前未完成项。历史过程、失败尝试和旧数字移到 `docs/project-progress.md` / `CHANGELOG.md`，不在这里重复制造“当前状态”。

### 先保留一条关键教训

**门禁全绿 ≠ 结果正确。** 修复前，用户现场的一张三棱锥错图曾通过全部已有门禁，因为系统当时只核验了中点，未覆盖等式、等边、比例、面面垂直和二面角。`b1ee3d3` 已对支持的题设增加逐条核验和 fail-closed 提交；这条历史事实仍保留，因为它解释了为什么后续必须继续分层建设求解、动态约束和证明证据。

### A. 用户侧验收（不需要管理员权限）

1. **教师/学生走查尚未完成**：验证“三点一面”目标（主操作数 ≤8、不必依赖 Shift）、误操作、取消、恢复、未核验提示和欠定示意图文案。

### B. 管理员权限验收

1. **MSI 安装→启动→卸载尚未完成**：NSIS 的安装/启动/卸载已实测；MSI 仍需在管理员权限环境中单独验收。不能把裸 exe 或 NSIS 结果替代 MSI 证据。

### C. 真实 provider 与 Agent 质量基线

1. **真实 provider 开放题现场复核尚未完成**：仍缺 pass@1 / pass@3、成本、延迟、`verified/unverified/no_witness` 分类与人工图面可读性。
   **已有的一半（2026-10-05 更正）**：**题设覆盖率已经有读数了** —— `BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727`（抽取层，21 题，**72.7%**）。所以这一条不再是"一样都没有"：**抽取层的题级覆盖（`covered=14/21`）与题设级覆盖都有数**，缺的是**真实模型那一侧的全部指标**。
2. 当前 `deterministic_local` 只用于协议与几何回归，不能作为真实模型准确率。

### D. 发布与仓库收尾

1. **（2026-10-05 更正）**N2 的源基线是 `9c5ae2f`（当时 `main` 顶端 `9a65e6d` 只改文档）。**现在的实况是：本地 `main` 顶端 `60488fa`，领先 `origin/main` 33 个提交，而且从未 push** —— 也就是说**远端与 CI 都还没见过 N3 / N4 / N5 / N6 的任何一行**。公开 Release 仍对应较早的 `v3.2.0`；下一次发布前需要决定版本号、重新打包、校验哈希、创建 source tag 和 GitHub Release，**但在这之前先要决定要不要 push**（见 §一.2 第 4 条）。
2. 这不是本轮代码缺陷；在没有重新打包和发布前，不能把 `v3.2.0` 资产称为当前源码的发行包。

### E. 后续功能决策与下一阶段 N1–N6

**N1 与 N2 已实施并复核（2026-10-05，都在默认关闭的 flag 之后，不改变默认行为）。** 以下为尚未实施的部分：

1. ~~**N1：统一数学状态 IR**~~ —— **已完成**（`acd3bd5` / `2d62c4d` / `b5b33f9` / `f997b3f`；flag 默认关）。
2. ~~**N2：解析构造与见证搜索**~~ —— **已完成**（内核 `c2314c9`..`e3fdb61`；搜索 `8648a13`..`ab05add`；接线与 spike `ca1d0b2`..`9c5ae2f`；`witnessSearch` 默认关，关闭时与 `4707b64` 逐字节相同）。
3. **N3：动态拖动保持约束**（自由度、过约束、无解、事务和恢复）—— 并承接 N2 留下的两件事：`planCompiler ↔ solver/witnessSearch` 的模块环（断法：给搜索器注入物化端口）与"**真正算出**自由度"（需先把 `ConstraintType` 扩到能表达线⊥面与角度）。**状态（2026-10-05，已更新到第五步）：内核侧已经做完** —— 点投影、拖动层的自由度/冗余诊断、拖动接线的决策层（`apps/web/src/constrainedDrag3.ts` + `App.tsx` 的 3D `onDragEnd`）、可证的矛盾判据、以及**线状平行/垂直的投影**都已落地并复核；**按 `ConstraintType` 现有的全部 8 个成员枚举核过：7 个可投影 + `coincident`（平面内专有）⇒ "没有投影规则"那一支不可达**（是枚举出来的，不是断言的）。**计划 N3 的 RED 命令点名的那七件测试文件也补跑了：7 文件 / 241 通过。**
**但**：**但开关缺省关，产品行为未变**，也**没有把开关打开的产品入口**，所以浏览器正/反例仍未达成。上面两件事里，**"真正算出自由度"只解决了拖动层那一半**（文档层的 `witnessSearch.degreesOfFreedom` 仍是 `null`），**模块环仍未动**。
4. **N4：开放题编译与真实 Provider Benchmark** —— 并承接 N2 的浏览器端验收（flag 打开时救援路径的端到端）与 **flag 状态进入 trace/benchmark 记录**。
   **（2026-10-05，已完成）**后一条**已经做掉了**：五个开关的状态随 `RunRevisions` 一起进 run 事件（`RunEvent` 每次相变都 spread 整份 `revisions`），落点是 `runState.ts` 的 `RunRevisions.nextPhaseFlags` + `StartRequest.nextPhaseFlags` + `agentRunner.ts` 的调用点。**没接线就留空（`undefined`），不编一份"全关"** —— 正反两条用例钉着。所以"这份 trace 是在哪组开关下取的"现在**答得出来**了。
5. **N5：形式证明出口**（实例、采样、形式证明严格分级）。**状态（2026-10-05，已更新到第四步）**：① `proofArtifact.ts` 把判据落成可执行的（`verified_instance`/`sampled` 不得变成 `formally_proved`；伪造/缺字段/版本不匹配/"证明了别的东西"一律拒）；② `proofGoals.ts` 的**短目标封闭词表**（10 种）；③ **后端接线门** —— `WIRED_PROOF_BACKENDS` 由**通过的审查记录推导**；④ **后端准入契约**（`proofBackendReview.ts` 十栏，缺一栏就拒）。`npm run proof:smoke` 打印 `PROOF_BACKENDS {"wired":[],"reviewed":0}`。**没有接任何后端**，所以真实运行只会得到 `unsupported`；adapter 要先过依赖与许可证审查。
6. **N6：feature flag、依赖/许可证/线程/WASM 审查、发布门槛与维护收口**。**状态（2026-10-05，已更新到第十四步）** —— 五个开关的覆盖矩阵、JS 运行依赖的许可证清单、WASM/线程边界、**Rust 传递依赖的许可扫描**（`cargo metadata`：551 包 / 33 种表达式 / 无一缺 `license` 字段 / 无 GPL·AGPL·SSPL）、**并发正确性专项**（唯一一处两把锁嵌套的守卫 + 删掉 `drop(runs)` 会自锁的实测）、e2e 与 Rust 两条抖动的修复与前后计数、整批门禁（含**生产构建**）都在，写进 [`docs/acceptance/next-phase-flag-and-dependency-review.md`](acceptance/next-phase-flag-and-dependency-review.md) 与 [`docs/current-status.md`](current-status.md) §一。**那一份里仍然明确写了没回答的**：三个开关的**浏览器**用例（卡在没有产品入口）、依赖体积与供应链。另查出两处依赖归位问题（`apps/web` 的 `@vitejs/plugin-react` 放错在 `dependencies`、根 `package.json` 多余一个 `three`），**未修**。
7. 其他尚未启动的产品探索：题目截图识图、GeoGebra `.ggb` 互操作、平面/函数题型逐题补缺、3D 画面进入 HTML。

### F. N1/N2 的已知边界与 park 项（**不是缺陷，是如实记录**）

- **~~`deterministic_local` 的「求解率」缺一个定义~~（2026-10-05 更正：**这个结论错了，已经能跑了**）**：我原来的理由是"见证搜索只在救援路径里触发（`planCompiler.ts:235`），要先有一份模型给的计划失败才有东西可救，所以离线没有输入"。**那个理由错了** —— 救援路径传进去的只有两样：`first.obligations.ir`（**解析结果**）与 `witnessShapeFor(context.prompt)`（**从题面推出来的图形族**）。**两样都不来自模型。** 现在 `agent-core` 导出了离线入口 `searchWitnessForPrompt(prompt)`，`bench:agent` 的**见证层**用它，实测：`BENCHMARK_WITNESS verified=1 unverified=20 no_witness=0 solveRate=0.048`（**离线求解率 4.8%**，21 题里 1 题拿到通过核验的候选）。它与救援路径共用同一份组成（seed / 候选上限 / 超时 / 题面→图形族），不是又写一遍。

- **N5 的"只读展示"这一条**（计划要求把 proof artifact 接进 `ConfirmationPanel` / `agentStore` / run event schema）**目前做不了，而且不是"没时间做"**：查下来 `ClaimEvidence` 这套证据词汇**根本没有进过 Web 界面** —— 面板显示的是 `diagramVerification`（另一套词汇，讲的是"这份图核验了吗"），而 `ClaimEvidence` 只在 `witnessSearch` / `solverContracts` / `planCompiler` 这些**核心层**里活着。加上**今天没有任何后端**，产物永远不存在 —— 为一个**不可能出现**的东西先做展示面，属于投机性设计。**这一条与"接一个真实后端"是同一件事，跟着那个决定走。**
- **两处"约束"模块的分工（免得被误当成重复实现）**：`planar-constraints.ts` 管**"点能待在哪儿"**（一维曲线 + 自然参数，`project`/`evaluate`，拖拽与动画是同一条状态更新），是**点 ↔ 宿主**的一元关系；`constraints3dProjection.ts` 管**"几个对象之间必须保持什么关系"**（⊥ / ∥ / 等长 / 共面…），是**多元**关系，用顺序投影迭代。**两者互补，可以同时出现在同一份文档里**；分工已写进 `constraints3dProjection.ts` 的文件头。

- **N5 待裁决（2026-10-05 更正：范围小了很多）：只剩「勾股」一处载体都没有。** 计划 N5 的首批清单写着"共线/共面、平行/垂直、等长、勾股"。**共线 / 共面**在**约束层**有完整载体（`ConstraintType` 有这两个、内核既判又投影）—— 我第一版只在解析层找，得出了"三个都表达不出来"的错结论。**勾股**才是真的没有载体：它是三条边的代数关系，不是题设种类、也不是任何一种 `ConstraintType`。至于解析层的 `DiagramObligationKind`，它只有
  `fixedLength | equilateral | equalLength | midpoint | segmentRatio | planePerpendicular | dihedral | perpendicular | parallel` —— **没有共线、共面、勾股**。所以照计划把它们列进"支持"只会得到一句没有载体的话（永远不会有 goal 被分类成它）。处置见 `packages/agent-core/src/proof/proofGoals.ts` 的 `unexpressibleFirstBatchGoals()`，两条路：**① 先扩解析层**（让这三类目标能被表达），或 **② 从首批里划掉**（N5 只声称支持能表达的那几类）。**这一条需要裁决，不是实现细节。**

- **棱柱族恒为"未核验"**：原话解析把 `A′` / `AA₁` 压成单个大写字母，且核验器的点名别名映射只收 `/^[A-Z]$/`，所以 `shape:"prism"` 稳定产出 `unverified_instance`。设计 §5 的 R2 出口本来就规定"**不支持**题稳定产出 `unverified_instance`"，故这是**符合出口**的诚实结果；带撇点名的支持是独立后续项（要动解析层，**不许**在内核或接线层"猜"）。
- **`degreesOfFreedom` 目前恒为 `null`**（窄豁免）：N1 的 `reportFreeDegrees` 要的是 DSL `ConstraintSpec[]`（`targets` 是**图元 id**），而 `ConstraintType` 表达不了线⊥面与角度；只映射子集会让数字**看不出漏了什么**，拿实测值冒充更是自证。要真算需扩 `dsl` + 内核判据 → 归 N3。**呈现纪律**：`null` 必须读作"未计算"，**不得**读作"自由度 0 / 刚性"。
- **有意保留的模块环** `planCompiler ↔ solver/witnessSearch`（`planCompiler.ts:24-37` 写明理由与安全性）：唯一干净的断法是给 `searchWitness` 注入物化端口，但那要改已复核的公开 API，故等 N3 的第二个消费者到场时一次定死。
- **把 `unverified` 当作救援触发条件**：即"模型给的草稿本身可用、但题面里有一条读不出的子句"时也会被替换成系统选的坐标 —— 这是 R37① 规定的语义，**有意的**。
- **后端 spike 的 `not_measured`**：Z3 自身的 `threads` 并行、浏览器内 WASM、内存占用、`z3` CLI（本机不存在）；数字是**一次运行**的墙钟读数（WASM 阻塞在两次运行里量到 28 / 139 ms 的差），原始产物在 `.superpowers/sdd/…/spike-z3-raw.json`（工作区产物，不在版本控制里）。
- **park 的小瑕疵（不影响正确性，留给最终整支复核 triage）**：`planCompiler.ts` 里 1500 ms 的墙钟预算（失败方向保守：超时即不救援）；异步假设项 `value` 仍是**候选序号**而物化后的是模型序号（今天只消费 `.text`）；Worker 契约把非数组 `materialisedActions` 当缺席（只损失纵深防御）；`relations:[null]` / `unverified:[null]` 这类**非类型合法**输入仍会抛；报告 §7.1 有两个 `npm view` 得来的数字不在原始产物里。

完整设计：`docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`。
完整计划：`docs/superpowers/plans/2026-10-04-agent-full-next-phase-implementation-plan.md`。
GitHub 调研：`docs/research/2026-10-04-github-project-survey.md`。

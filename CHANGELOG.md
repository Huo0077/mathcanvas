# 变更记录

> **这份文件记"改了什么"，不记"现在什么样"，也不记"当时怎么想的"。**
> - **当前状态**（门禁读数、做到哪一步、还差什么）看 [`docs/current-status.md`](docs/current-status.md) —— 那是"现在时"的**唯一**一处；
> - **过程与证据**（每一轮的 RED→GREEN、被推翻的判断、实测读数、误报清单）看 [`docs/project-progress.md`](docs/project-progress.md) —— 那是**归档**；
> - **架构与能力清单**看 [`docs/feature-catalog.md`](docs/feature-catalog.md)。

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

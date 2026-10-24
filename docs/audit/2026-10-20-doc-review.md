> **这是一份审查快照（2026-10-20）**：审查对象是**对齐之前**的文档（当时的 `HEAD` = `8f9f549`），因此文中的行号对应那一刻，对齐之后已经移动。文中的 HIGH / MEDIUM 项已按第 6 节的顺序处置完毕，逐项动作见[项目进度归档](../project-progress.md) 的 2026-10-20 节。**2026-10-24 更正**：抽查 14 条中 11 条闭环，H1 的 2 处 marker、M19、M5 仍有残留；见 [2026-10-24 审查](2026-10-24-progress-doc-review.md)。
# MathCanvas 进度文档审查

**审查日期：** 2026-10-20 ｜ **范围：** `D:\draw\draw` 下全部进度/状态/门禁/发布文档 + 仓库外 2 份副本
**结论：CONCERNS** —— 4 项 HIGH、24 项 MEDIUM、9 项 LOW。

**一句话：** 问题不在于"某条读数是错的"，而在于**"唯一现在时"这个机制已经失效**——同一份 2026-10-16 快照被逐字复制进 13 个受跟踪文件，同步靠手工粘贴到 4 个文件，而且已经漏更新；权威文档内部对同一个 Task 同时存在"已完成"和"部分完成"两种说法；一份面向人评的走查手册仍让人安装 3.2.0。

---

## 0. 事实基准（本次审查的标尺，全部实跑/实查）

| 事实 | 值 |
| --- | --- |
| HEAD | `8f9f549` |
| tag | `v4.0`（注解对象 `ce05ae2`）→ 提交 `339d373` |
| Release | id `417498043`，`draft=false`，3 个资产，`releases/latest = v4.0` |
| 产品版本 | `4.0.0`（`tauri.conf.json` + `Cargo.toml`） |
| 现有安装包 | `MathCanvas_4.0.0_x64.exe` / `_x64_en-US.msi` / `_x64-setup.exe` |
| typecheck | exit 0 |
| lint | 0 error / **15** warning |
| 单测 | **457 文件 / 4852 通过 + 1 todo / 0 失败**（174.86 s） |
| docs-consistency | 12 通过 |
| 全量 e2e | **本版未跑** |
| CI | `5d30fd2` #418 success；`339d373` #419、`8f9f549` #420 仍 **queued** |
| 推送 | 无待推提交（`HEAD == origin/main`） |

---

## 1. 审查范围与方法

| 手段 | 覆盖 |
| --- | --- |
| 机械扫描 | 120 个受跟踪 `.md`：markdown 相对链接、日期合法性、未来日期、反引号里的仓库路径引用 |
| 事实核对 | git 状态 / tag / Release / 版本字段 / 安装包 / Actions API / 本机重跑门禁 |
| 分片人工审读 | `docs/current-status.md` **全 1783 行**（3 片）；`project-progress.md` 与 `CHANGELOG.md` 用关键词层+抽样（两文件 9 个状态词全 grep，共 736 处命中）；13 个 acceptance/release 文件**通读**；7 个 plan/research 文件通读 |

---

## 2. HIGH

### H1｜同一份"当前口径"复制进 13 个受跟踪文档，且已被 111 条测试甩开

**两种变体（`git ls-files *.md` 扫描）：**

- **marker 块**（`<!-- functional-checkpoint-20261016-ci -->`，6 个）：`README.md`、`docs/agent-next-round-progress.md`、`docs/current-status.md`、`docs/superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md`、`docs/superpowers/plans/2026-10-16-functional-completion.md`、`audit-20261016/functional-review.md`
- **blockquote 变体**（`> **2026-10-16 状态同步（当前口径）**`，7 个）：`apps/desktop/README.md`、`docs/evidence/README.md`、`docs/project-progress.md`、`docs/research/2026-09-28-agent-tool-loop-progress.md`、`docs/research/2026-09-29-high-school-geometry-interaction-progress.md`、`proof/lean4/README.md`、`scripts/sdd/README.md`

其中 4 份是**逐字相同**的 1534 字符；`docs/current-status.md` 里那份是 **1551 字符**的变体——**复制件已经开始漂移**。

**块内读数 vs 今天实测：**

| 块里写的（并自称"最新"） | 实测 |
| --- | --- |
| 单元测试 **404 文件 / 4741 passed** / 1 todo | **457 文件 / 4852 passed** |
| 浏览器测试 **239 passed** | 本版未跑，无法复核 |
| `lint` 0 errors / **13** warning | 0 error / **15** warning |

**同步机制本身就是缺陷：** `4ad5fc6`、`f3cdc95`、`5ddd6d7` 三次提交的 diff 都是**同 9–12 行同时写进 4 个文件**（`audit-20261016/functional-review.md` + `current-status.md` + 两个 plan）。所谓"唯一现在时"靠"记得粘 4～13 遍"维持。

**而且已经漏更新：** 10-17 有 Task 18/20/21 的新记录，但 **7 个文件里的任务计数仍是 10-16 的 `16 完成 / 3 部分 / 2 未完成`**，无一处跟进。

**建议：** 只保留 `current-status.md` 一处正文，其余 12 处改成一行链接；修完加一条"该文本只许出现一次"的机器判据。

### H2｜README 与 current-status 仍在说"最新 Release 是 v3.2.0 / 版号 3.3.14"

| 位置 | 原文 |
| --- | --- |
| `README.md:95` | 「远端可见最新版本标签仍为 **`v3.2.0`**…仓内声明的版号已是 `3.3.14`，它只是后续现场构建批次」 |
| `docs/current-status.md:335` | 「3.3.10 是现场构建批次，**不是已发布的 GitHub Release**（远端版本标签仍为 `v3.2.0`）」 |
| `docs/current-status.md:372`（子代理人报告†） | 「仓内声明版号现为 3.3.14；远端 Release 标签仍是 v3.2.0」 |
| `docs/current-status.md:1499` | 「公开 Release `v3.2.0` 对应较早产物…**下次发布**需定版号、构建和签名/哈希、source tag、GitHub Release」——把已完成的发布写成"下次"待办 |
| `docs/current-status.md:1500` | 「`bundle/` 下的 MSI/NSIS **仍是 10-10 11:48 那一批（3.3.10）**，比当前源码旧」——现有是 `MathCanvas_4.0.0_*` |

**实际：** `v4.0` 已于 2026-10-20 正式发布（id `417498043`），版号 `4.0.0`。

**为什么是 HIGH：** README 是外部第一入口；`current-status.md` 是仓库自己指定的"现在时"。**两份文档、五处位置都给出了错误的"最新版本"**，而且都在各自的"现在时"段落里，不是历史归档。

**建议：** 这五处都改写成 v4.0（指向 `docs/release/v4.0.md`），`:1499` 的"下次发布"改成"已发布（2026-10-20）"；再加一条"文档里出现的版本/tag 声明必须等于 `tauri.conf.json` 的 version 或最新 tag"的判据。

### H3｜CHANGELOG 停在 2026-10-12，v4.0 与 183 个提交没有记录

- `CHANGELOG.md` 最新 `## ` 日期标题 = **2026-10-12**；全文 `v4.0` / `4.0.0` / `2026-10-17` / `2026-10-19` / `2026-10-20` 命中 **0**。
- 缺口：**183 个提交 / 481 文件 / +58,096 −772**，含这次跨大版本发布本身。

**为什么是 HIGH：** 文件开头写明职责是"记改了什么"。跨大版本发布在里面没有任何条目，这条职责断了 8 天。

**建议：** 补 `## 2026-10-20 —— 发布 v4.0.0`（339d373 / Release 417498043 / 3 资产 / 安装包名 / 457 文件 4852 passed + 1 todo / lint 15 warning / e2e 未跑），并把 10-13～10-19 折叠成批次条目。

### H4｜人评走查手册仍让人安装 v3.2.0，且"定版号再发布"待办早已完成

`docs/acceptance/human-acceptance-walkthrough.md`：

- `:13` / `:14` / `:97`：让人双击 `bundle\msi\MathCanvas_3.2.0_x64_en-US.msi` 与 `MathCanvas_3.2.0_x64-setup.exe`。
- `:17`：「**⚠️ 版本号仍是 `3.2.0`**…`bundle/` 下的 MSI/NSIS 也**比源码旧**（那是 3.3.10 批次）」。
- `:173-174`（"还剩什么"第 1 条）：「**定版号再发布**：现在源码构建仍叫 `3.2.0`…要改版本、重新构建、写哈希与 Release」。

**实际：** 版号 `4.0.0`，安装包 `MathCanvas_4.0.0_*`，Release 已发布并复核哈希 MATCH。

**为什么是 HIGH：** 这是 Task 21"教师/学生走查"的执行入口。照它做，走查者会装 10-10 的旧构建，**人评结论对 4.0.0 无效**；第 173 行还会让人重复做一遍已完成的发布。

**建议：** 三处路径改成 `MathCanvas_4.0.0_*`，开头写明"对应 tag `v4.0` → `339d373`、2026-10-20 发布"；删掉 `:173` 那条待办。

---

## 3. MEDIUM（24 条）

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| M1 | `docs/feature-catalog.md` | 未收录 v4.0 新增的 4 个空间动作。代码已注册 `solid.create_projection`（`322a7de`）、`create_rotation`（`7bc93a6`）、`create_translation`（`39f7855`）、`create_reflection`（`ef698b1`，均 10-19），共 43 个动作；目录最新日期条目停在 **10-15**，`反射`/`线面交点`/`旋转动作` 命中 0 | 补这 4 个动作与线面交点 |
| M2 | `docs/current-status.md:337` | 「**最后更新：** 2026-10-19」，但第 3–8 行是 2026-10-20 的 v4.0 记录。**这是本次会话回填 v4.0 时漏改的**；`file-hygiene` 只判"是真日期且不在未来" | 改成 2026-10-20 |
| M3 | `docs/project-progress.md:1` vs `:3` | 第 1 行「**2026-10-16 状态同步（当前口径）**」，第 3 行标题却写「（归档）」，相邻两句互相否定 | 去掉"当前口径"字样，改为指向 current-status |
| M4 | `D:\draw\github-project-progress.md`（148 KB，**2026-09-17**）<br>`D:\draw\github-README.md`（24.9 KB，2026-09-17） | 仓库外副本停在 9-17，其中一份第 3 行自称「**这份文件是项目的单一进度记录**」；与仓库内 10-17 版是不同代，且在门禁视野外 | 删除或移入 `legacy/` 并标注日期 |
| M5 | `docs/acceptance/agent-release-gate.md:3`、`:17` | `:17` 自称「本文件是门禁的**当前读数**」，但判定行停在 2026-10-11/10-14，没有 v4.0 的判定行。边界：该门禁管"Agent 默认放行"，不等于"不许发桌面版"，v4.0 也没声称"已发布自动证明"——所以是**"当前读数"这句话过期**，不是违规 | 补 v4.0 判定行，或把标题改成带日期的口径 |
| M6 | `docs/current-status.md:63` / `:123` vs `:310` | 同一文件对 **Task 18** 两种说法：`63` 行「部分完成 \| 3 \| 16、18、19」、`123` 行「Task 18 remains partial…」，而 `310` 行「**Task 18** ✅ \| **已完成（2026-10-12）**」；`316` 行又说以该表为最新状态 | 统一为"部分完成（待发行验收）" |
| M7 | `docs/current-status.md:139` / `:141` / `:143`；`plans/2026-10-11…:433`；`plans/2026-10-16-functional-completion.md:96` | 多处把"待推"写成现状：「推送状况：本地已有五个提交待推，`git push` 仍被网络重置」「远端仍是 c1f109f」「本区块待独立提交并推送」。事实：全部已推送，`HEAD == origin/main`，无待推提交 | 各补一句结案，或标注为当时历史 |
| M8 | `docs/current-status.md:58` / `:323` / `:335` | 同一文件里三处各自自封"当前口径/以本段为准/现在时的唯一一处"，读者无法判断哪一段优先 | 只保留一处权威声明 |
| M9 | `docs/acceptance/agent-tool-loop-scorecard.md:17-19` | 镜像表"现在"列写「1–5 **未开始**」「6–9 **未实施**」「10–16 **未实施**」，与 release-gate `:9-12`（Task 1–19 已于 10-12 完成）全面冲突；该文件 `:7` 自己承诺"能力前进一格时这一行要跟着改" | 按现行编号重写该列 |
| M10 | `docs/feature-catalog.md:69`、`:71` | 同文件 `:47` 已记载 `solid.create_segment` 于 2026-10-15 落地，`:69`/`:71` 仍以现在时称「立体几何里仍**没有**"两点连成线段"的动作」「**已知缺口（下一件）**」 | 两处补"（2026-10-15 已补上）"，或删去该缺口 |
| M11 | `docs/acceptance/agent-release-gate.md:41`† | 第 1 条放行判据引用「单测 **303 文件 / 3529 通过**…lint 0 error / 13 warning」（2026-10-05 读数），而文件自称"当前读数" | 保留旧快照并标日期，判据改引当前读数 |
| M12 | `docs/acceptance/agent-release-gate.md:163-171` | 复跑清单列出 `typecheck`/`test`/`test:lean`/`test:rust`/`eval:agent`/`bench:agent`/`test:e2e`/`test:perf`，**缺 `lint` 与 `build`**——而 `package.json` 有这两个脚本、CI 也在跑 `npm run lint`、第 1 条证据还引了 lint 读数 | 补 `npm.cmd run lint` 与 `build` |
| M13 | `docs/acceptance/human-acceptance-walkthrough.md:79` | 「先在设置 → 实验性功能里打开「示意图见证搜索」（**默认关**…）」——自 2026-10-15 起默认**开**（代码缺省 `true`，只有显式 `false` 才关）。照着做会把默认开的功能**点成关**，随后把人评失败误记成 bug | 改为"默认已勾上，点一下才是关掉" |
| M14 | `docs/acceptance/next-phase-flag-and-dependency-review.md:10`、`:16`† | 矩阵以现在时写「五个开关…**缺省全关**」「`witnessSearch`…默认关」，同上，已过期 | 标注日期，`witnessSearch` 一行改为"默认开" |
| M15 | `plans/2026-10-11-four-family-agent-upgrade-progress.md:363` | 标题「## 7. 唯一的进度表（**下一项 Task 14**）」，而表内 Task 14 自己写着「完成（2026-10-12）」，文档其余部分说剩余项是 19–21 | 改为"下一项 Task 20/21" |
| M16 | `plans/2026-10-04-agent-full-next-phase-implementation-plan.md:246`、`:384`、`:725`、`:947` | 四处执行记录写「上面五条检查项**一条都还没勾**」，但全文 **37 个复选框已全部 `[x]`、0 未勾**（`:5` 状态行也这么写） | 加"历史，已被状态行取代"，或改成过去时 |
| M17 | `docs/agent-generalization-task-list-20261019.md:45`、`:149`† | P6-2 标 `done`，交付证据是「已重建 **3.3.14** exe + MSI + NSIS」，`149` 行把 3.3.14 安装包列为产物；现产品 4.0.0 | 补"4.0.0 已重建"，或注明该行时点为 10-19 |
| M18 | `docs/agent-drawing-eval-20261017.md:66`† | 「真实考试题入口：LaTeX/OCR 归一化**尚未进产品主路径**」，与同文件 §十（10-19）"已接入"及任务表 P5-1 冲突 | 改为"已于 10-19 接入（partial）" |
| M19 | `docs/project-progress.md:4588`† | 无日期的一级节「## 已完成 / ### 验证证据」下写「`npm test`：**15 个测试文件、108 个测试通过**」，与同文件 `4931`（51/484）、`4971`（188/2134）互斥，也与实测 457/4852 冲突 | 整节标注"2026-09 早期快照"，或改为指向 current-status |
| M20 | `docs/project-progress.md:4599`† | 一级标题「## 当前进行中 —— 阶段状态：P0：已完成…P7：工程制图已完成」，内容是 P0–P7 的 9 月快照，早于文件自身的 v3.0–v4.0 各节 | 标题改为「历史阶段快照（2026-09）」 |
| M21 | `docs/current-status.md:1328`† | 「**七条方案全部落地并验收**」，与同表「方案2 🔶 已开四十六批」及 §三"方案 2 剩下的"自相矛盾 | 改为"方案 1/3–7 已验收；方案 2 主体完成，余下为可选长尾" |
| M22 | `docs/current-status.md:1333` vs `:1414`† | 「`src/commands/` **五组**」与「其余全部搬进 `src/commands/` **六组**」互斥（该处实际列 5 个名字、目录实有 7 个模块） | 按目录实际模块数统一 |
| M23 | `docs/current-status.md:1337`、`:1474`† | 「`current-status.md` 是"现在时"的**唯一一处**」「本节是"还差什么"的**唯一权威处**」，而同节 1462/1495 又把归属指向 `agent-next-round-progress.md`——唯一权威自我否定 | 删掉"唯一"，改为"本页汇总口径，归属见 X" |
| M24 | `docs/current-status.md:1415`† | 「`schemas.ts` 与 Rust `lib.rs` 按评审排在**更后**」与同节 1414「Rust 侧已完成 / lib.rs 992→168 / schemas.ts 1300→180」矛盾，是残留旧句 | 删除该句或改为"已完成" |

† = 由子审计员报告并附逐字引文，我做了抽样复核（行号与引文一致），但未逐条重读上下文。

---

## 4. LOW / INFO（9 条）

| # | 位置 | 内容 |
| --- | --- | --- |
| L1 | `current-status.md:153`、两个 plan/spec | 4 处"死链"是**扫描器误报**：`](?:[′']\|[₁₂₃₄₅₆])` 是点名字母表的正则，不是链接 |
| L2 | `project-progress.md:2852`、`:3069`、`:3144` | 3 处引用已删除文件（`agentDemoReply.ts`、`derivedPrimitives.ts`、`draftCounts.ts`）都是**历史叙述**（"删除/移到…"），不是失效引用 |
| L3 | `plans/2026-10-11…:264` | 引用 `curve-tangents.ts` 不存在（仓内只有 `curve-tangents.test.ts`；实现是 `apps/web/src/curveTangents.ts`） |
| L4 | `research/2026-09-28-agent-tool-loop-progress.md:15` | 「`solid.create_sphere` has no handler yet」——现已 `available` 且 handler 在 `actions/index.ts:580`；属 2026-10-01 的历史记录，只建议补一句 |
| L5 | `current-status.md:750`† | 「首跑 222 通过 / 1 失败…比上一读数 +1」与同格「222 通过 / 0 失败」三个数不能同时成立 |
| L6 | `current-status.md:762`† | 「全量基线 194 **见下一行**」——下一行是空行，该数实际在 `1114` 行 |
| L7 | `current-status.md:649`† | 「**仍未做**：…双曲线 / 抛物线（**已于同日补齐**）」——"仍未做"里放了已完成项 |
| L8 | 全局 | 测试读数在文档里出现 **390 处**，最新一条是 `379 文件 / 4487 通过`（10-16）。按日期标注本身不算错，但没有一处收敛成"当前值见 current-status" |
| L9 | `current-status.md:1733`† | 英文句「the final documentation commit will be checked against the remote after push」——已是完成态（无待推提交，`HEAD == origin/main`） |

---

## 5. 机械门禁的盲区（这些漂移为什么能长期存活）

| 判据 | 查什么 | 不查什么 | 因此放过 |
| --- | --- | --- | --- |
| `readme-navigation` | README 里的**链接**指得到文件 | 链接**旁边那句话**是否还成立 | H2 |
| `capability-tables` | 三张能力表**链到** current-status | "唯一现在时"是否真的唯一 | H1 |
| `file-hygiene` | BOM / UTF-8 / 日期是真是假 | "最后更新"与**内容日期**是否一致 | M2 |
| `progress-claims` | 计划状态行 vs 执行记录、待裁决表件数 | CHANGELOG 新鲜度、版本声明、跨文件重复 | H3、H2、H1 |

四条判据**都只钉结构、不钉真值**——这是仓库刻意的取舍（避免"一改措辞就红的假门禁"）。代价是：**声明性的过期事实没有机器兜底**，只能靠人工审查，也就是这次做的事。

另外，**机械层本身干净**：markdown 死链真值 **0**、未来日期 **0**、非法日期 **0**；反引号里的仓库相对路径引用 1187 处，不存在的 14 处全部是 glob、临时脚本或已删除文件的历史记录。

---

## 6. 建议处置顺序

**P0（今天，4 处小改，全是"读者会因此做错事"的）**
1. `README.md:95`、`current-status.md:335`/`:372`/`:1499`/`:1500` → 改成 v4.0，并把"下次发布"改成"已发布"。
2. `docs/acceptance/human-acceptance-walkthrough.md:13/14/17/97/173` → 改成 4.0.0 产物，删掉"定版号再发布"待办。
3. `docs/current-status.md:337` → 最后更新改 2026-10-20。
4. `CHANGELOG.md` → 补 v4.0 一节。

**P1（本周，结构性）**
5. 13 处"当前口径"收敛为一处 + 一行链接；加"只许出现一次"判据。
6. `current-status.md` 内部：Task 18 两种说法统一；三处自封"当前唯一"只留一处。
7. `feature-catalog.md` 补 4 个空间动作；修 `:69`/`:71` 的自相矛盾。
8. 走查手册 `:79` 与 flag 矩阵的"默认关"改成"默认开"。

**P2（清理）**
9. 删除或归档 `D:\draw\github-*.md`（09-17 两份）。
10. 发布门禁补 v4.0 判定行；复跑清单补 `lint`/`build`。
11. `project-progress.md` 首行去"当前口径"；`4588`/`4599` 两处 9 月快照加日期或删读数。

---

## 7. 本次没有做的（如实）

- **全量 e2e 未跑**，所以 13 份拷贝里的 `239 passed` 既不支持也不否定。
- **历史段落未逐条核对史实**：带明确日期的旧读数按归档处理，只在它**自称"当前"**时计为问题。
- `project-progress.md`（5512 行）与 `CHANGELOG.md`（6087 行）**只做了关键词层 + 抽样**，未通读正文；其中 31–4535、4730–4930、4990–5470 行（project-progress）与 40–6086 行（CHANGELOG）没有逐行读。
- **本次审查未修改任何仓库文件**——上面每一条都只给"建议改法"。要动手改，说一声，我按 P0→P2 执行。

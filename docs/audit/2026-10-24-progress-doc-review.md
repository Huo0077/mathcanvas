> **审查快照（2026-10-24）**：对象是 HEAD `0500807`（= `origin/main`）上的文档。本文件只记录发现，**没有修改任何项目文档**。行号对应当前 HEAD。

# MathCanvas 进度文档审查（2026-10-24）

**结论：CONCERNS** —— 4 项 P0、17 项 P1、10 项 P2。

一句话：**证据底子很好，治理层在漏气**。抽查的 commit SHA、文件路径、Markdown 链接、安装证据几乎全部可复核，没有发现"编造已上传"；但同一份"当前状态"内部仍有**四个不同的"现在"**（v4.0 / v4.0.1 / 10-10 读数 / 10-12 任务表），一段 2026-10-16 的记录在三个文件里被半角问号替换成不可读文本，v4.0.1 发布说明还引用了一轮**早于本版 61 个文件改动**的 e2e 读数。

---

## 0. 版本事实（实查）

| 项 | 值 |
| --- | --- |
| 远端 | `https://github.com/Huo0077/mathcanvas` |
| HEAD / `origin/main` | `0500807`（ahead/behind = 0/0，无待推提交） |
| 最新 Release | `v4.0.1`（2026-10-20，`draft=false`，3 个资产） |
| tag | `v4.0.1`（注解对象 `fe68207`）→ `20e5ee9`；`v4.0` → `339d373` |
| 版本真值 | `4.0.1`（`tauri.conf.json` / `Cargo.toml`）；根 `package.json` 是 `0.1.0`，属内部包版本，不是发布号 |
| HEAD 与 tag 差 | `v4.0.1..HEAD` = 2 个提交（`6145993`、`0500807`，均 docs-only） |
| v4.0.1 相对 v4.0 | **61 文件 / +5397 / −203**（含 `ConfirmationPanel.tsx`、`diagramConfirmation.test.tsx`） |

获取过程的一个环境问题：`HTTP(S)_PROXY` / `ALL_PROXY` 指向 `127.0.0.1:7897`，该端口未监听，`git fetch` 因此失败；**清空代理环境变量后 fetch 成功**。GitHub API 可达，Release 元数据由 API 复核。

---

## 1. 审查范围与逐份结论

| 文档 | 规模 | 定位 | 结论 |
| --- | --- | --- | --- |
| `docs/current-status.md` | 1909 行 / 604 KB | 现状权威 | 顶部 2026-10-20 总览准确；下半部还留着 4 个过期"现在" |
| `docs/project-progress.md` | 5604 行 / 1.25 MB | 归档 | 过程证据可用；最新段停在 v4.0，全文无 v4.0.1 |
| `docs/agent-next-round-progress.md` | 134 行 | 半归档 | 标题仍写"当前范围"，状态已托管出去 |
| `docs/research/2026-09-28-agent-tool-loop-progress.md` | 255 行 | 归档 | 自洽，日期标注有小问题 |
| `docs/research/2026-09-29-high-school-geometry-interaction-progress.md` | 231 行 | 归档 | 自洽，一处自我更正没回填 |
| `docs/superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md` | 595 行 / 170 KB | 主计划 | 被 4 份文档当权威指向，但状态层已崩（三套并存） |
| `docs/superpowers/plans/2026-10-16-functional-completion.md` | 286 行 | 执行记录 | 约 2/3 正文是主计划尾部的逐字副本 |
| `docs/agent-generalization-task-list-20261019.md` | 24 KB | 任务表 | 总览列过期；P4-3 的验收词与代码相反 |
| `docs/agent-drawing-eval-20261019.md` | 21 KB | 评测 | 算术自洽；证据目录已空 |
| `docs/agent-drawing-eval-20261017.md` | 8.6 KB | 评测（旧） | 自洽 |
| `docs/release/v4.0.1.md` | 8.6 KB | 发布说明 | e2e 与 MSI 两处证据越版 |
| `docs/release/v4.0.md` | 9.5 KB | 发布说明（旧） | 自洽 |
| `docs/audit/2026-10-20-*.md`（3 份） | 41 KB | 审查快照 | 快照有效；结论行过度声称已闭环 |
| `README.md` | 145 行 | 外部入口 | 版本正确；提交数差一 |
| `CHANGELOG.md` | 6145 行 / 829 KB | 变更记录 | v4.0.1 已补；3 条 10-06 条目错序 |
| `docs/feature-catalog.md` | 477 行 | 能力目录 | 版本基线正确；Task 完成度与权威矩阵冲突 |

---

## 2. P0（读者会据此做错事 / 内容已损坏）

### P0-1 同一段记录在三个文件里变成不可读文本

- `docs/current-status.md:1794`、`:1796`、`:1798`
- `docs/superpowers/plans/2026-10-16-functional-completion.md:110-115`
- `docs/superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md:424-431`

三处是同一段 2026-10-16 Task 16（F1）记录：整行中文被**连续半角问号**替换，只剩 `` `structured_only` ``、`71/71`、`12/12`、`Web typecheck exit 0` 等拉丁片段可读。`git log -S '2026-10-16?Task 16'` 显示这些行在 `65bd8b6`（2026-10-17）进入仓库时**已经是坏文本**，父提交没有可恢复原文；`audit-20261016/agentRuntime-read.txt` 只有代码片段。**不能"从历史取回原文"，只能按该提交与同日记录重写。**

现有 `file-hygiene` 只验 UTF-8 合法性与 BOM；半角问号是合法 UTF-8，所以 6 天没被发现。

### P0-2 "最后更新"一行给出另一个版本

`docs/current-status.md:463` 仍写：

> **最后更新：** 2026-10-20（**v4.0 已发布：tag `v4.0` → `339d373`…全量 e2e 本版未跑**…`docs-consistency` **12 通过**…）

而同文件 `:53-57` 写 **v4.0.1**（`20e5ee9` / Release `417950826`）、`:65` 写 **e2e 239 通过**、`:28`/`:68` 写 **7 条判据 / 18 项**。跳读"最后更新"的人会拿到旧版本号、旧 e2e 结论和旧门禁计数。

### P0-3 任务完成度有三套口径

| 位置 | 说法 |
| --- | --- |
| `docs/current-status.md:425` | "**Task 1–19 已于 2026-10-12 完成**" |
| `docs/current-status.md:186-190` | 16 完成 / **3 部分（16、18、19）** / 2 未完成（20、21） |
| `docs/feature-catalog.md:5` | "**Task 1–19 已完成**" |
| `README.md:67` | "**不能沿用此前'Task 1–19 全部完成'的判断**" |
| `four-family…:346-370` | 1–19 全"完成"；**21 待做** |
| `four-family…:454-465` | Task 21 已跑 release build / 安装包 / 安装 / IPC |

同一仓库对"哪些 Task 完成"给出互斥答案，且最容易被引用的一句（current-status:425）正是错的那句。

### P0-4 v4.0.1 发布说明把 4.0.0 的 e2e 当成"本版源码"读数

`docs/release/v4.0.1.md:63`：

> **全量 e2e**：`npx playwright test --workers=3` → **239 通过 / 0 失败**（本版源码；本版只改版号与文档，Web 代码与那次全绿时一致）。

事实：`git diff --shortstat 339d373 20e5ee9` = **61 files, +5397/−203**，含 `apps/web/src/components/agent/ConfirmationPanel.tsx`（+18）与 `diagramConfirmation.test.tsx`（+43）；`docs/release/v4.0.md:102` 自己写着那次 239/0 是 4.0.0 **"发布后才补跑"**。两句不能同时成立。**发布页/README 都指向这份说明**，外部读者会把 4.0.0 的读数当成 4.0.1 的。

---

## 3. P1（会导致误读，需排期修）

| # | 位置 | 问题 | 证据 |
| --- | --- | --- | --- |
| 1 | `current-status.md:1625` | "公开 Release **现为 v4.0**" | 最新是 v4.0.1（同文 `:11`、README:82） |
| 2 | `current-status.md:857-888` | §一"现在能不能跑"首行读数是 **2026-10-10**，lint 13 warning | 顶部 `:28` 是 10-20 的 479/5054、15 warning |
| 3 | `current-status.md:438`、`:440` | Task 20 "进行中 / 付费等授权"；Task 20–21 "获授权才运行" | 同文 `:34` 写"用户 2026-10-20 明确先不做，冻结在此"；README:71、feature-catalog:5/7 同 |
| 4 | `four-family…:346`、`:370` | 标题"下一项 Task 14"；表内 Task 21"待做" | Task 14 行自己写"完成（2026-10-12）"；Task 21 证据在 `:454-465` |
| 5 | `project-progress.md:4704` | "1.6 尚缺 `.mcanvas` 打包与附件"；"G1 阶段状态表在本文件顶部" | 同文 `:2514` 记同日已交付；G1 表实际在 `:2377` |
| 6 | `project-progress.md:4822` | "平面边界拖动仍未做" | 同文 `:4932`/`:4935` 记 P6 v3-10 已完成 |
| 7 | `project-progress.md` 最新段（10-20） | 只写"全部改成 v4.0 / 4.0.0"；全文 grep `4.0.1` = 0 | v4.0.1 于同日更晚发布（CHANGELOG:10、README:82） |
| 8 | `release/v4.0.1.md:65` | MSI 载荷证据混用 4.0.0 的 exe（17,595,392 B） | 4.0.1 的 exe 是 17,611,776 B（同文 `:46`）；同句 NSIS 半段已注明"用 4.0.0、没重跑"，MSI 半段没注 |
| 9 | `agent-generalization-task-list-20261019.md:50` | P4-3 验收写"未 `passed` 时隐藏确认按钮" | `ConfirmationPanel.tsx:269` 是 `undefined \|\| status === "passed"`（未核验时按钮照出）；`unverified-audit.md:110` 也承认闸门未改 |
| 10 | `agent-drawing-eval-20261019.md:124` | "本次证据都在 `build-check/`" + 7 个文件 | `build-check/` 目录存在但**为空**，7 个文件均不存在且被 `.gitignore` 忽略 |
| 11 | `CHANGELOG.md:6138`、`:6144`、`:6149` | 三条 **2026-10-06** 条目追加在文件末尾（在 09-24 之后） | 全文日期按倒序排，只有这三条破序 |
| 12 | `README.md:82` | "相对 v3.2.0 共 **566** 个提交" | `git rev-list --count v3.2.0..v4.0` = **567** |
| 13 | `current-status.md:7` | "**十余轮**维护批次" | 同文轮次编号到 **第三十二轮**（30 轮）；README:69、feature-catalog:7、CHANGELOG:35 同 |
| 14 | `project-progress.md:127` 及全文 | 自己规定"引用一律用小节标题，不写行号"，但仍有 5 处行号引用，抽查 4 处已漂移 | 例：`current-status.md:750`（实为 `:876`）、`diagramObligations.ts:1098` |
| 15 | `audit-20261016/` | 105 个未跟踪文件被正文当证据引用 | `git ls-files` 197 / 实有 332；`e2e.log`、`lint.log`、`MathCanvas-installed` 等均 untracked |
| 16 | `docs/audit/2026-10-20-doc-review.md:1` | "HIGH / MEDIUM 项已…处置完毕" | 抽查 14 条：11 条闭环，H1 残留 2 处 marker、M19、M5 未清 |
| 17 | `agent-generalization-task-list-20261019.md:50` | "本轮已完成（`97dde4b`）…457 文件 / 4852 通过" | `97dde4b` 是 10-17 提交；457/4852 是 10-20 读数（10-17 当天是 422/4791） |

---

## 4. P2（清理项）

| # | 位置 | 问题 |
| --- | --- | --- |
| 1 | `current-status.md:69`、`:81` | 行号引用失效：`diagramObligations.ts:1098` → 实为 `:1967`；`diagramVerification.ts:1422` → 实为 `:2197` |
| 2 | `CHANGELOG.md:4501`、`:4897`、`:2302` | `cases.jsonl` 已迁至 `packages/agent-core/src/benchmark/cases.ts`；`proof/source.rs` 实为 `apps/desktop/src-tauri/src/proof/source.rs` |
| 3 | `current-status.md:119-133` | 15 行连续空行，紧接一条无承接的"审查留档" |
| 4 | `research/2026-09-28-…progress.md:7` | 文件名 09-28，正文 `Date: September 29, 2026` |
| 5 | `research/2026-09-29-…progress.md:159` | 仍写"属性栏改棱柱顶点坐标被静默丢弃（无提示）"，同文 `:30`/`:231` 已更正为有 `role="alert"` 告警 |
| 6 | `functional-completion.md:40`、`:45` | 两个重复的 `### B｜Task 20` 标题，`:42-43` 为悬空段落 |
| 7 | `functional-completion.md` | 172 条实质行中 114 条与主计划尾部逐字相同 |
| 8 | `agent-next-round-progress.md:51` | "最后更新 2026-10-16" 与页首 10-20 横幅不一致；标题仍写"（当前范围）" |
| 9 | `agent-drawing-eval-20261019.md:110` | 与 10-17 对比写"11/12 可画"，10-17 的整批最佳是 **12/12**（11/12 是某一列） |
| 10 | `four-family…:112` | "旧 Task 18c → 新 Task 5 记录待裁决" 仍悬空 |

---

## 5. 已核实为真（可以放心引用的部分）

- **版本链自洽**：`tauri.conf.json` / `Cargo.toml` = 4.0.1，README:82、current-status:55、CHANGELOG:10、v4.0.1 说明一致；tag → 提交 → Release id 三处对得上。
- **SHA 无造假**：抽查 52 个（另 23 个二次抽查）commit 全部 `git cat-file -t` = commit，且 `git branch --contains` 含 `main`。
- **路径无造假**：抽查 24 + 29 条文件/脚本路径 `Test-Path` 全部命中；30 题评测的代码引用（`planCompiler.ts:51/:80`、`ConfirmationPanel.tsx:269`、`allowAfterLabelColon`）真实存在。
- **链接可用**：current-status 53 条 / README 24 / CHANGELOG 35 / feature-catalog 28 条相对链接，除一条落在乱码行的正则误抓外全部命中。
- **安装证据逐字对齐**：NSIS 解出 17,595,392 B = 4.0.0 免安装 exe；卸载 exit 0、目录与注册项清理、"MSI 安装/卸载仍未验"都如实写。
- **30 题评测算术自洽**：25 生成 + 5 硬失败 = 30；2 全过 = joint-08/25；分组 14 立体 + 16 平面 = 30；逐题表与硬失败表一一对应。
- **文档门禁可跑**：`npx vitest run scripts/docs-consistency` = **17/18 通过**；唯一失败是 `file-hygiene` 的 5 s 默认超时（1600+ 文件冷扫），`--testTimeout=60000` 重跑 **3/3 通过**。判据本身不假，只是超时阈值偏紧。
- **479 个测试文件**与 `git ls-files '*test.ts*'` 的 479 一致（用例数未重跑，见第 7 节）。
- **没有"说已上传但 main 上找不到"**：52 个 SHA 全部在 main。

---

## 6. 建议（按性价比排序）

1. **先修 P0-1/P0-2/P0-4**（一个批次，动 4 个文件）：重写乱码块；把"最后更新"改成顶部一段由 HEAD/tag 生成的短块；v4.0.1 的 e2e 改成"沿用 4.0.0 那一轮，本版未重跑"或补跑。
2. **完成度只留一张矩阵**（P0-3）：`current-status.md:186-190` 的 16/3/2 为准，`current-status:425`、`feature-catalog:5`、`four-family:346-370`、README:67 全部改成引用它；计划表加一列"发行验收"。
3. **加三条机器判据**（补现有 7 条的空档）：
   - 受跟踪 Markdown 中连续 ≥3 个半角问号即红（先跑基线）；
   - 发布说明里出现"本版源码 / 本版只改"时，必须与 `git diff --shortstat <prev tag>..<tag>` 的结论一致（或强制标注"沿用"）；
   - 文档中出现的版本号必须等于 `tauri.conf.json` 或最新 tag，且最近发布日期不早于最新 tag。
4. **归档分层**：`project-progress.md`（1.25 MB）按季度拆成 `docs/archive/2026-Q3/`、`2026-Q4/` + 索引；`CHANGELOG.md`（829 KB）按年拆或折叠旧批次。两份都只保留最近 30 天在正文。
5. **去重**：`functional-completion.md` 只留 A–F 分块表 + 指针；`agent-next-round-progress.md` 改标题为"历史（止于 2026-10-16）"。
6. **统一 "as of" 纪律**：所有状态表头写"截至 YYYY-MM-DD / HEAD"，不带日期的读数一律加日期。
7. **证据入库**：`audit-20261016/` 被正文引用的日志要么提交，要么在引用处标"本机一次性证据，不在库内"。

---

## 7. 本次没有做的（如实）

- **未重跑全量单测**：`npx vitest run --maxWorkers=2` 在本机跑 >10 min、CPU 仅 ~30 s 后仍无输出（疑似挂起），已终止。因此 479/5054、460/4858、457/4852 三个读数按"文档自述 + 文件数外部核对"处理，未复现用例数。
- **未跑 e2e / Rust / 打包**，未启动 exe；窗口句柄、资产 SHA-256 与"三件 MATCH"未本地复验。
- **未联网复核 Release 资产哈希**（GitHub API 只核了 tag / release / draft / 资产数）。
- `project-progress.md`（5604 行）与 `CHANGELOG.md`（6145 行）只做标题链 + 关键词层 + 定点核对，未逐行通读历史数字。
- `audit-20261016/` 只做 tracked/untracked 统计与引用抽查，未逐个读 332 个文件。

---

## 8. 同一会话内的处置（2026-10-24，用户选 B：P0 + 2 条判据）

- **P0-1 已修**：34 行连续问号（4 个 md + 6 个 ts）按上下文重写，未猜原文；新增判据
  `scripts/docs-consistency/text-integrity.test.ts`（受跟踪文本里连续 ≥3 个 ASCII `?` 即红）。
  先看它红（34 个 offender），修完转绿。
- **P0-2 已修**：`current-status.md` 的“最后更新”改为 2026-10-24 / HEAD `0500807` / `v4.0.1`；
  `version-consistency.test.ts` 新增一条：README 的「最新版本标签」与 current-status 的
  「最后更新」必须含最新 tag。先看它红（`v4.0` 缺 `.1`），修完转绿。
- **P0-3 已修**：完成度统一到 16 / 3 / 2；`feature-catalog` 标题与 Task 16/18 行、
  `four-family` §7 标题与 Task 21 行同步。
- **P0-4 已修**：在 v4.0.1 的代码上复跑全量 e2e（2026-10-24）：
  **239 通过 / 0 失败，4.6 min，exit 0**；`docs/release/v4.0.1.md` 已改成这个读数，
  不再声称“本版只改版号与文档”。
- **判据数量变化**：`docs-consistency` 从 7 文件 / 18 项变为 **8 文件 / 20 项**；
  `current-status` 里当前口径的四处计数已同步（历史条目保留原读数）。
- **验证**：`npx vitest run scripts/docs-consistency --testTimeout=60000` → 8 文件 / 20 项全绿；
  `apps/web/src/curveTangents.test.ts` → 8 项全绿。
- **未做**：本文件的 P2 全部未动；改动尚未提交（新增判据文件仍是 untracked）。P1 见下一节。

---

## 9. P1 批次（2026-10-24 同日）

17 条 P1 全部处置（有的只是加日期/改口径，未重写整段）：

- **版本与日期**：`current-status:1625` 改成 v4.0.1；`§一` 改名为“门禁读数档案”并给出当前值；`十余轮` → “三十轮（第三–第三十二轮）”（current-status / feature-catalog / README）；README 提交数 566 → **567**。
- **任务口径**：Task 20 / 20–21 改成“冻结（用户 2026-10-20 决定先不做）”（current-status 两行、feature-catalog 两行），删掉“进行中 / 等授权 / 已授权”的互斥说法。
- **事实矛盾**：`project-progress` 的“1.6 尚缺 `.mcanvas`”与“平面边界拖动仍未做”改为已交付并指到对应小节；`release/v4.0.1.md:65` 的 MSI 载荷证据标明来自 4.0.0；`task-list` P4-3 改 `partial` 并写清 `undefined` 分支仍放行；`97dde4b` 与 457/4852 的时点拆开。
- **失效引用**：`build-check/` 标注已清理；`project-progress` 的 4 处行号换成函数名/小节名；`audit-20261016/functional-review.md` 顶部注明“本机一次性证据、未入库”，并去掉“当前口径”自称；`2026-10-20` 审查首行加 10-24 更正。
- **结构**：`CHANGELOG.md` 末尾三条 2026-10-06 移回 10-06 组（17 行移动；`git diff --numstat` 17/18，`git diff --check` exit 0）。
- **验证**：`docs-consistency` 8 文件 / 20 项全绿。
- **未做**：P2（行号引用、空段、重复标题、大文件拆分等）；改动未提交。

---

## 10. P2 批次（2026-10-24 同日）

10 条 P2 全部处置：

- **失效行号/路径**：`current-status` 两处行号改成函数名/分支名；`CHANGELOG` 的 `proof/source.rs` 补全为 `apps/desktop/src-tauri/src/proof/source.rs`，两处 `cases.jsonl` 标注已迁至 `packages/agent-core/src/benchmark/cases.ts`。
- **结构**：`current-status` 中 15 行连续空行收敛为 1 行；`functional-completion` 的两个 `### B｜Task 20` 合并（第二个降为 `#### 2026-10-16 执行记录`）。
- **日期与自称**：`2026-09-28` 快照的 `Date` 改为 9 月 28–29 日；`agent-next-round-progress` 标题改为“历史；正文止于 2026-10-16”，`最后更新` 拆成指针日 10-20 / 正文 10-16。
- **自我更正**：`2026-09-29` 高中几何进度里“改棱柱顶点被静默丢弃”补上 `a5c60c1` 的更正（界面有 `role="alert"`）。
- **计数与悬空项**：10-17 评测“最好读数 11/12”改为“整批最佳 12/12（最新一次 11/12）”；主计划迁移表里的“旧 Task 18c 记录待裁决”改为“不并入新编号，按旧记录归档”。
- **重复正文**：`functional-completion` 从 Functional audit 一节起约 2/3 与主计划逐字重复（117 条非空行中 99 条相同），加显式重复声明并指向主计划 —— **没有删原文**，因为尾部还含有主计划没有的 Task 12 revalidation 与 Current-HEAD checkpoint 18 条唯一内容。
- **验证**：`docs-consistency` 8 文件 / 20 项全绿；`git diff --check` exit 0。
- **归档拆分（2026-10-24 后续）**：`docs/project-progress.md` 把 2026-09 及更早（含后补的 10-04～10-06 条目）拆到 `docs/project-progress-early.md`，主文件 **1.25 MB → 317 KB**（5606 → 1658 行）；`CHANGELOG.md` 把 2026-09 及更早拆到 `CHANGELOG-2026-09.md`，主文件 **829 KB → 721 KB**（6144 → 5581 行）。两个主文件页首/页尾都有指针，拆分文件的相对链接 17 + 7 条全部可解析。
- **未做**：`CHANGELOG` 的 2026-10 部分仍有 721 KB（10-13～10-19 本就缺条目，拆月无法再显著缩小），如需更细的 release 级拆分需先把 10 月条目按发布线整理。





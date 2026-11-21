# MathCanvas 项目过程日志

## 2026-11-21 —— v5.0.0 系统性根治修复（24/24 纯文字真题 `--reset` 全过）、官网升级、识图 UI 暂隐与全量 E2E 闭环

- **系统性架构根治与 24/24 纯文字真题 `--reset` 全通过（`4a71d3e8`）**：深入排查高频易错题（含 `USER-16`、`JT-S01`、`JT-P01`、`GK-P06`、`JT-P06`、`JT-P08` 等）后完成多项底层架构修复：补齐圆锥曲线定比弦精确闭式求解、`A-BCD` 六边四面体与 Cayley-Menger 可行性诊断、任意 $k$ 棱锥/棱柱顶点组装、`construct_circumsphere` 球心注册 `points3`、`finish_candidate` 会话内至多 2 轮预检自修、失败签名输入哈希区分、`ds_action` 28 轮/96 网络预算与 `agentRuntime.confirmDraft()` 失败终态拒收。桌面端 `mathcanvas-desktop.exe` + `deepseek-v4-flash` 下 24 道纯文本高考/联考与用户实测题单轮 `--reset` 串行实测 **24/24（100%）通过**。
- **官网门户升级与服务器静态打包（`034b0836`）**：更新 [portal/index.html](../portal/index.html) 与 [portal/assets/styles.css](../portal/assets/styles.css)，增加「持续更新升级中」说明与显眼反馈邮箱 `dogf9066@gmail.com`（含一键复制），全部下载入口直链 GitHub Releases，并整理宝塔/Nginx/Caddy 可直接上传的静态部署包。
- **识图 UI 特性开关暂隐与小问阻断 E2E 修复（`4195ff87`）**：通过 [featureFlags.ts](../apps/web/src/featureFlags.ts) 的 `IMAGE_READER_UI_ENABLED = false` 统一隐藏识图 UI 入口并同步清理官网对应文案，底层代码与单测保留供后续开发恢复；修复 [draftStore.ts](../apps/web/src/agent/draftStore.ts) 唯一前置条件小问自动推断仅在数学核验 `passed` 时生效，彻底解决 CI 中 `e2e/agent-subquestion-guard.spec.ts` 4 条失败。最终验证：`typecheck`、`lint`（0 errors）、`test:docs`（22/22）、`eval:reliability -- --offline`（3/3）、`eval:explicit-solid -- --offline`（2/2）及全量 Playwright `npm run test:e2e`（**331 passed / 1 skipped / 0 failed**）全部通过；重新打包三件套并更新 GitHub Release `v5.0.0` 与 [v5.0.0.md](release/v5.0.0.md)。

## 2026-11-20 —— 首个正式版本里程碑定版与全流程交互体验收口

- **用户需求驱动的端到端体验与智能构图收口**：完成 44/44 纯文字题真机实测之后，继续围绕日常做题使用场景完成全面打磨：（1）实现正常题目（不显式点名平面）下自动补齐辅助线段并直接由相交线段与动点推测空间面（如仅写 `连结 AE、CE` 即自动构造 `面 AEC`），并支持小写/分隔写法（`面ace`/`平面 A-C-E`）与顶点 ID 复用联动；（2）Agent 草稿预览态即同步渲染左侧对象栏，独立面集中在 **「面（构造 / 辅助）」** 分组，支持两线定面与属性栏二面角 `sin`/`cos` 集中读取；（3）打通往期对话完整历史恢复、13 种模型预设 + Rust IPC 一键获取模型列表、精简设置面板（`模型服务 | 偏好设置`）、更新桌面图标与隐藏 Windows 启动黑框，并重写面向用户的 [README](../README.md)。最后一次改码后 `npm run typecheck` 通过（exit 0），桌面端 `deepseek-v4-flash` 实测全部通过。

> **2026-11-20 全面正确性二次根治修复与 `deepseek-v4-flash` 44 题全通过收口（基线 28/28 + 扩展 16/16 = 44/44 = 100.0%，0 离线测试）**：完成 `dsActionTools.ts`（`solveMaxInscribedBall3` + `construct_solid(kind="sphere", inscribedIn)` / `construct_circumsphere(mode="insphere")`、`construct_parallel` `offsetX/offsetY/distance`、`construct_intersection` `excludePointId` 与 `1e-2` 排他容差、`construct_conic` `(b, e)` 反算）、`modelPlanner.ts`（同批 `undeclared_entity_ref` 依赖波次重排与失败诊断日志）及 `systemPrompt.ts` 优化，全仓 `npm run typecheck`（exit 0）。真实 UI + `deepseek-v4-flash` 复测 `EX-P01`（19 次，6/6 义务全绿）、`EX-S05`（4 次，精确内心 `O=(4,2,1.5), r=1.5`）、`EX-P04`（6 次，精确 `rx=2, ry=√5`）、`EX-S06`（6 次，2/2 义务全绿）、`GK-S12`（2 次，精确 `r=1.41421≈√2`）与 `GK-S14`/`GK-S15`（各 5 次，如实保留 `r=5` / 四点外接球示意近似边界说明）；两套全集 **44/44（100.0%）** 通过确认落盘及 2D/3D 交互，累计估算上界费用 **\$3.1467 USD**（< \$5）。详见 [当前进度总表](g3-final/G3-F9-current-progress-and-remaining-work.md)。

> **2026-11-20 全面正确性首轮快照（已被上方 44/44 二次根治复测替代）**：完成 `useDraftPersistence.ts`、`dsActionTools.ts` 线性方程递归下降解析与 `AB ⊥ BC` 直角朝向等修复（当时 43/44）。详见 [当前进度总表](g3-final/G3-F9-current-progress-and-remaining-work.md)。

> **2026-11-20 扩展实测与收尾区块完成（阶段快照，已被上方全面正确性复测替代）**：补充正多边形棱台（`square_frustum`/`triangular_frustum`/`regular_frustum`/`frustum_pyramid`）精确 `solid.create_polyhedron` 构造及命名截面（`"截面 △"`/`"截面△"`/`"截面三角形"`/`"截面四边形"`）词条豁免，完成前序 A/B/D 纯文字主线区块收尾。详见 [当前进度总表](g3-final/G3-F9-current-progress-and-remaining-work.md)。

> **2026-11-20 纯文字高考/模考题 `ds_action` 真机端到端实测通过（28/28 = 100%，0 离线测试）**：继区块 1 修复后完成区块 2 收口与桌面端 Rust 重编译：`agentRunner.ts` 默认走 `ds_action` 与单题 20 次请求预算；`modelPlanner.ts` 提升批量工具上限至 32 并对未发布工具名返回可修复反馈；`dsActionTools.ts` 扩展 2D 方程/中点/交点与 3D `cube`/`cylinder`/`cone`/`frustum`/`sphere`/`sides`/正三棱锥构造并拒绝文字题误澄清；`drawingCertificate.ts`、`draftStore.ts`、`acceptance.ts` 对齐有限图元通过门禁与描述性“截面”词条排除。在最新编译的桌面端通过真实 UI + `deepseek-v4-flash` 实测 28 道纯文字题（平面 18 + 立体 10），**28/28 确认提交并完成 2D/3D 画布交互验证**（单题最多 11 次请求 ≤ 20，累计估算上界 **\$0.5340 USD** < \$5），`npm run typecheck` 通过。详见 [当前进度总表](g3-final/G3-F9-current-progress-and-remaining-work.md)。

> **2026-11-19 GK-P01/GK-P06 原卷复核（0新增 DS）**：GK-P01 在2025新高考Ⅱ卷学生 PDF p3 确认第16题无附图；GK-P06 冻结标注为2019全国Ⅲ理科#21，实际同题为文科#21，已在[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)与[候选清单](../test-fixtures/reliability/text-only-36-source-triage.json)明确来源错配待新 manifest 纠正，旧 suite 不变。旧23现6题 PDF 页级初核、2题来源错配、1题仅预览、14题待查；新36 `runnable=false`、未发模型请求、旧成绩不变。


> **2026-11-19 GK-P04 题页预览（0 DS 请求）**：找到 2022 全国甲卷文科 #20 的第三方 JPEG p4，题面匹配、该题不附图；但非原 PDF，证据单列 `page_preview_checked_needs_pdf_and_independent_review`。旧23现5题PDF页级初核、GK-P07来源错配、GK-P04仅预览、其余16题待审；[审计](audit/2026-11-19-g3-text-only-source-triage/README.md)。新36 `runnable=false`，未发模型请求，旧真实成绩不变。


> **2026-11-19 GK-P07 来源纠错（0 DS 请求）**：旧冻结合同 source 错写“2021 新高考I卷 #21”，实际相同题面在 **2021 全国乙卷理科 #21**，PDF p4 无附图。参见[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)；旧版 prompt/hash/91次请求不变，新清单保留 `source_mismatch_requires_new_manifest`，需纠正后另审合同。旧23有5题普通页级初核+该错配题、余17待核对；新版36 `runnable=false`，无新版 DS 成绩。


> **2026-11-19 B9 交点画面修复（0 新增 DS）**：直线-曲线有两个交点时旧动作固定取第一个却回报 accepted；现可明确选择最左/右/低/高，多交点未选择或方向并列显式可修复拒绝，不再画错点。切点与双直线交点原路径保留。[审计](audit/2026-11-19-g3-intersection-branch-b9/README.md)。真实 DS 尚未复测，新无图36题合同仍未冻结，旧合同1/26/9与原生交付未测口径不变。


> **2026-11-19 2022全国甲卷理科两题原卷复核（0 DS 请求）**：GK-P03 第20题与 GK-P08 第14题均已核对原卷 PDF 与附图归属；旧23纯文字候选现有 **5/23 仅原卷页级初核**，其余18题需逐卷复审，全部36合同仍未独立审核。[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)记录证据；[新版准入清单](../test-fixtures/reliability/text-only-36-source-triage.json)继续 `runnable=false`。旧DS 1/26/9 和原生交付未测保持不变。


> **2026-11-19 保留题 GK-P05 原卷核验（0 新增 DS）**：使用 2021 全国甲卷理科原卷 p4 第20题确认抛物线题与旁边第19题立体配图无关；旧23已有 GK-P02/GK-P05/GK-P09 共 **3/23 页级初核**，余20题待复核。[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)列出 PDF SHA；[新版清单](../test-fixtures/reliability/text-only-36-source-triage.json)仍 `runnable=false`，独立合同/DS真实作图/原生交付未测，旧36成绩不变。


> **2026-11-19 旧23题第二道原卷复核（0新增DS）**：GK-P02 已用 2022 全国乙卷理科学生试卷 p5 核对第20题椭圆题与附图归属；连同 GK-P09，旧23目前 2/23 仅页级初核，其余21题未核对。来源[审计](audit/2026-11-19-g3-text-only-source-triage/README.md)及[清单](../test-fixtures/reliability/text-only-36-source-triage.json)保留具体 SHA。**不是独立合同批准，也不是新 DS 实测**；新36仍 `runnable=false`、旧实测读数不变。


> **2026-11-19 题页预览线索（0 DS 请求）**：GK-S10/GK-S15 已找到并目视核验第三方 JPEG 试卷题页预览（题号及配图归属），但**未取得原试卷 PDF，也无独立合同**；[来源清单](../test-fixtures/reliability/text-only-36-source-triage.json) 将预览状态与六道高考 PDF 页状态分开记录，[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)附字节 SHA。旧23只有 GK-P09 原卷初核，剩余22待复核；新版36保持 `runnable=false`，既有 DS 实测读数不变。


> **2026-11-19 无图题来源复核增量（0 新增 DS）**：[来源审计](audit/2026-11-19-g3-text-only-source-triage/README.md)与[清单](../test-fixtures/reliability/text-only-36-source-triage.json)现记录 6/8 道高考立体候选的 PDF 页级初核、旧23中 GK-P09 原卷初核；仍缺高考 GK-S10/GK-S15 和旧22原卷审查。两份标题正确但题号内容不符的下载件明确拒收；GK-S16 转录“棱雉/棱柱”待按原卷重锁文本。所有候选未独立审核、合同未冻结，`runnable=false`；不改变旧36合同1/26/9或原生交付未测，也未发起新 DS。


> **2026-11-19 B8 线段参数闭合（0 新增 DS）**：`construct_segment` 由任意对象收紧为真实端点 `from/to` 必填；缺端点给明确缺字段码、额外几何字段不再被忽略后假接受，2D/3D 合法线段仍可构图。见[B8 审计](audit/2026-11-19-g3-segment-schema-b8/README.md)。旧36合同1/26/9、原生交付未测不变，新无图36待来源与合同审核、`runnable=false`；修复完成后的一次实测仍需新预算与每题请求上限。


> **2026-11-19 B7 声明动作假成功修复（零新增 DS）**：`declare_entity` 曾接受坐标字段却仅登记名字；现在模型可见 schema 限于真实执行字段，额外坐标返回可修复拒绝，`construct_point` 才真正物化图元。[B7 审计](audit/2026-11-19-g3-declare-entity-schema-b7/README.md)。旧36真实合同 1/26/9、原生交付未测不变；新版无图36来源/合同仍待审核、`runnable=false`。Goal 需全部修复后另获新费用/请求上限，才进行一次真实 DS 全量测试。


> **2026-11-19 高考候选原卷继续初核（0 新增 DS）**：又核验 GK-S12（2018 全国 I 文科 #5）和 GK-S14（2018 全国 II 理科 #16）原卷 PDF、哈希、题号及附图归属，[初筛审计](audit/2026-11-19-g3-text-only-source-triage/README.md)现有4/8高考候选原卷页初核；另4题仍转录线索。GK-S14 转录“圆雉”不同于原卷“圆锥”，需独立校正并重锁新题哈希；13道替换题没有独立合同，`runnable=false`，无新版 DS 实测。旧成绩不变。


> **2026-11-19 高考候选原卷增量初核（0 新增 DS）**：GK-S11（2016 全国新课标Ⅱ 第4题）和 GK-S13（2022 全国乙卷理科 第9题）已核验学生试卷 PDF 字节 SHA、题号、页码及附图归属，题目未附图；[证据](audit/2026-11-19-g3-text-only-source-triage/README.md)。另外6道高考候选仍只有转录线索，旧23需原卷复审，全部13候选仍待独立审阅与新合同；[来源清单](../test-fixtures/reliability/text-only-36-source-triage.json)继续 `runnable=false`。旧36合同 1/26/9 和原生交付未测均未改变。


> **2026-11-19 来源筛查检查点（0 新增 DS）**：[初筛审计](audit/2026-11-19-g3-text-only-source-triage/README.md)锁定旧23题文本/哈希、8道高考转录线索及5道联考原卷页/SHA；发现“题干无如图但旁有配图”的拒选反例，不能只凭关键词放行。所有候选仍待原卷/独立合同复审，[筛查数据](../test-fixtures/reliability/text-only-36-source-triage.json) `runnable=false`，新36题实测仍未开始；旧合同1/26/9与原生交付未测口径不变。


> **2026-11-19 纯文字36题重规划（0 新增 DS）**：用户明确本轮跳过原题有图的题，不进行视觉实测。旧36题保留历史 91 请求、合同 1通过/26失败/9未测且原生交付未测；[新规格](g3-final/G3-F9-text-only-36-suite-spec.md)和[实施计划](g3-final/G3-F9-text-only-36-implementation-plan.md)确定保留23个纯文字候选、另补8道高考立体+5道联考立体无图真题。13个目前只是待审空槽位，[规划清单](../test-fixtures/reliability/text-only-36-plan.json) `runnable=false`，新36未凑齐/不可开始实测，旧成绩不进入新分母；C0/C1视觉工作保留但退出本轮关键路径。先来源/文本完整性/独立合同审查，再另获费用授权做 DS 真测。


> **2026-11-19 C1 题图字节绑定（0 新增 DS）**：视觉阅读确认现按实际转码 PNG 的有序 SHA-256 绑定；同文字换图会使旧确认失效，发送内容携带脱敏哈希。当前原生请求仍禁止 images+tools 同请求，修正为视觉读取→人工核对→文本动作两阶段；13道原图、来源/原始 SHA、视觉 profile 与真实 DS 图文交付仍待补，旧36题合同 1/26/9 与原生交付未测不变。见 [C1 审计](audit/2026-11-19-g3-figure-digest-c1/README.md) 和 [主计划](g3-final/G3-F9-live-36-root-cause-and-repair-plan.md)。


> **2026-11-19 B6 作图与答案分源（0 新增 DS）**：移除 GK-S09 终止工具曾固定注入的球面积答案；录制棱柱/外接球仍通过**作图几何**合同和证书，但旧1题合同通过不能代表 DS 自主回答试卷选项。旧36题统计及原生交付未测状态不变，下一步仍需答案单独验证、图题原图与新授权真实复测。[B6 审计](audit/2026-11-19-g3-answer-provenance-b6/README.md)。

> **2026-11-19 B5 曲线两点拟合（0 新增 DS）**：针对真实 GK-P02 先构点后 `construct_conic` 缺参数序列，新增 `throughPointIds` 内核路径，只有两个已物化且足以确定请求曲线族的点才推导半轴/方向；退化、错族、混合输入、缺引用均拒绝。旧原生回执未保存原参数，**36题合同 1/26/9 不变**；仍需新提交真实 DS、图题与原生交付。[B5 审计](audit/2026-11-19-g3-conic-fit-b5/README.md)。

> **2026-11-19 B4 曲线方向/中心内核修正（零新增 DS）**：发现模型可见 `axis/cx/cy` 旧版执行被忽略，纵轴双曲线/偏移中心可能画错；现方向与中心进入内核且非法值显式拒绝。**没有新的付费实测，旧36题合同/交付口径不变**；曲线族必填参数、缺图与原生真实交付仍待处理。[B4 审计](audit/2026-11-19-g3-conic-axis-center-b4/README.md)。

> **2026-11-19 A2 批次假成功修复（零新增 DS）**：A1 多工具事务中“构造+撤销”可同时被接受却留下空候选；现整批可修复拒绝并保留逐 ID 回执，声明+失败构造不会污染下一轮引用目录。模型批次提示已升 v2 并与最多8个独立动作/修复分轮对齐。**旧36题1通过/26失败/9未评估不变**；新代码尚未获得真实 DS 同版复测或原生交付证明。[A2 审计](audit/2026-11-19-g3-batch-destructive-a2/README.md)。

> **2026-11-18 D0 原生候选交付观测（零新增 DS）**：产品 `ds_action` 确认路径新增可选脱敏事件，脚本化候选验证确认前 Agent 0写入、确认后同 hash 1次写入、过期/重复确认拒绝；但**真实 DS 候选的原生交付仍 not_measured**，不得倒填旧36题。图题同名 PNG 为产品生成图，不是原题图。[D0 审计](audit/2026-11-18-g3-f9-delivery-observer-d0/README.md)。

> **2026-11-18 C0 缺原图阻断（0 新增 DS 请求）**：原生冻结题入口以前会对13道图题只发文字；现基于题目合同在模型请求前标记 `input_figure_missing`、`modelInvoked=false`，单传确认引用也不能冒充图像。旧36题91请求的实测历史保持不变；图文真实成功仍未测，待原图和 vision/预算接线及新付费授权。[C0 证据](audit/2026-11-18-g3-f9-figure-input-c0/README.md)。

> **2026-11-18 Block B3 引用状态与回滚安全（零新增 DS）**：真实 `undeclared_entity_ref` 失败族驱动检查发现旧撤销仍保留线/曲线引用且分支撤销错改共享候选；已增有界模型可见物化/声明目录与共享、分支引用回滚安全测试。**本轮0付费调用，36题历史合同数据不变**；跨 scope/state 联动、原图和原生交付仍待修。[证据](audit/2026-11-18-g3-f9-entity-reference-b3/README.md)。

> **2026-11-18 Block B2 非付费精确直线方程**：根据真实构线引用失败族补上 `construct_line` 的 `a*x+b*y+c=0` 精确两点构图（保留旧 from/to；拒绝退化/混合/缺系数），可见 schema/说明同改；**原始模型参数未记录，因此不声称旧题已通过**。没有新增 DS 请求，下一步 B3 实体目录与同版真实复测待新授权。[审计](audit/2026-11-18-g3-f9-line-equation-b2/README.md)。

> **2026-11-18 Block B1 非付费平面参数契约**：针对真实36题频繁 `missing_required_parameter`，为曲线/点/线/测量/约束状态五项发布封闭参数字段，删去未实现的方程构造承诺，未知曲线类型不再默认椭圆；合法构造及非法引用正反例已核对。**没有新增 DS 请求，12题旧失败结论不变**；其余16项自由工具与完整实体引用/输入/交付仍需修复。详见[Block B1 审计](audit/2026-11-18-g3-f9-planar-schema-b1/README.md)。

> **2026-11-18 Block A1 真实失败驱动的非付费协议修复**：针对上次原生36题中8题同轮多构造调用被误判，多工具事务/逐 ID 回执与 Rust 同轮组包已加针对性测试（8个真实工具名称序列的合成参数协议测试、回滚/停滞/重复 ID 反例）；**本轮0新增 DS 请求，36题原审计和合同分数不变**。剩余需另获授权在固定新提交上验证真实供应商回执/合同/证书/画面及原生交付。详见[Block A1 审计](audit/2026-11-18-g3-f9-batch-protocol-a1/README.md)。

> **2026-11-18 真实 DS 失败深度研究 / Goal（规划阶段，未新增请求）**：依据固定36题原生91次调用建立[专项实施档案](g3-final/G3-F9-live-36-root-cause-and-repair-plan.md)，优先修同轮多工具事务和 Rust 多 ID 回执（8题）、逐族 schema/实体引用/完成候选，再补13题原图与原生确认交付。发现 GK-S09 的面积答案由现有 finish 路径提供特例，不能据此证明 DS 独立推导。Goal 已设为真实端到端可靠作图，文档完成**不是修复完成**；新增付费 DS 请求另获授权。

> **2026-11-18 最新真实 DS 全量36题（每题最多10次；取代下方旧单题状态）**：固定提交 `aa17eb70`、冻结题集 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`、保存的原生 DeepSeek profile revision 2 下，36/36题均实际发起请求，合计91次（91次 usage）；独立合同 **1 passed / 26 failed / 9 not_measured**，仅 GK-S09 同候选证书与隔离浏览器画面通过。13题引用原图但没有附经核验题图，只测了冻结文字；原生受控交付与主画布写入36题均未测，不宣称端到端通过率。实测定位8题同轮多构造工具调用被通用协议闸拒绝，9题未得到合同评估；保守估价上界 $0.5325891 < 整轮5美元，实际账单未知。后续只围绕真实断点修复，另获授权后才发新付费请求。见[36题脱敏审计](audit/2026-11-18-g3-f9-native-36-10x/README.md)。

> **2026-11-18 Task 7 family-tool checkpoint (zero cost):** Added `construct_equal_edge_triangular_prism` with a simple closed schema requiring only a named id and positive displayScale; it reuses the existing `construct_solid` solver, enforces the symbolic source, and rejects unknown geometry fields. A mock native provider request sees the published schema; recorded product flow and exact-candidate browser rendering pass. This does not prove the remote DeepSeek service accepts the schema; no paid request was made.

> **2026-11-18 GK-S09 symbolic-input hardening**: A RED test showed an all-edges-`a` prompt still accepted unlabelled numeric side/height values, allowing a guessed value to masquerade as the problem parameter. `construct_solid` now fails closed with `symbol_source_required` unless the model provides `symbol:"a"` plus a positive `displayScale`; the explicit symbolic path remains valid. Product ds_action and recorded replay regressions pass; no paid DS call.

> **2026-11-18 product-route correction (zero-cost recorded provider):** The product runner previously took the deterministic GK-S09 shortcut before consulting a selected `ds_action` planner. A RED test observed zero model calls. Explicit `intentMode: ds_action` now bypasses only that shortcut; the recorded 3-action provider path reaches the real product coordinator, waits for confirmation with zero main-canvas writes, and commits a sphere only after confirmation. The ordinary default deterministic route is unchanged. This is a test-injected opt-in path, not a proof that the default UI selects ds_action or that any paid DeepSeek call succeeded.

> **2026-11-18 exact-candidate browser evidence (recorded replay only):** The earlier 41 browser checks used the default deterministic planner, not the DS action candidate. A new Playwright check exports the GK-S09 candidate only after the independent contract and production certificate pass, imports that exact normalized document into the actual browser, and verifies the same candidate hash, prism, sphere, six labels, and canvas visibility (1/1). File import is a rendering check, NOT native DS participation or isolated confirmation/delivery for that candidate. Both remain open.

> **2026-11-18 F9 per-request receipt gate**: Zero-cost tests reproduced and fixed the case where an earlier request had an action receipt but a later action request lost telemetry. Each `ds_action` request is now checked against its action-call count and missing data is marked `telemetry_missing`. The generic `eval:reliability` runner also requires `--confirm-paid`; it is not the native G3-F9 `ds_action` entry and does not replace new user authorization. No paid request was made.

> **2026-11-18 live authorization gate rechecked**: `--allow-paid --max-requests 3` is parsed as live, but the actual runner refuses to start when `DEEPSEEK_API_KEY` is absent (`no automatic spend`). No provider request or charge occurred; the next action still requires new explicit user authorization.

> **2026-11-18 Task 9 verification note**: The required 41 Playwright same-candidate/lifecycle tests passed. A default parallel `npm test` run reported 8 timeout failures in unrelated common-tangent suites; rerunning those 3 files serialized with `--maxWorkers=1 --testTimeout=30000` passed `46/46`. This is recorded as an environment/timeout verification caveat, not converted into a false full-suite pass. No paid DS call was made.

> **2026-11-18 Task 8 zero-cost checkpoint**: Real derived sphere action and GK-S09 symbolic scale handling are implemented and recorded. Two display-scale whole-case replays pass the independent contract and certificate; no paid DS calls. Browser verification and authorized live DS remain pending.

> **2026-11-18 Task 7 parameter protocol first block (zero cost):** `construct_solid` now publishes a closed schema with supported kind values, positive dimensions, and named fields; the parser shares the same kind/field vocabulary and rejects unknown parameters. Targeted family/negative/missing-parameter checks pass, typecheck and test:docs pass, lint has 0 errors (34 pre-existing warnings). Per-family required-field rules and provider schema compatibility are not finished; Task 7 remains open. See [detailed plan](g3-final/G3-F9-GK-S09-detailed-repair-plan.md).

> **2026-11-18 Task 6 回执桥接（零付费）**：已增加 `runFrozenDsCaseTraced`，将真实 `ds_action` 逐请求/逐动作事件接入脱敏 `G3CaseTrace`，记录首次阻断码、图元变化和回执送达；零费伪 provider 验证缺参数和终止动作。旧 GK-S09 两次原始回执不可追溯，35题未测，实际费用未知。下一步 Task 7 参数 schema。详见 [详细修复计划](g3-final/G3-F9-GK-S09-detailed-repair-plan.md)。

> **2026-11-18 GK-S09详细实施计划已入档（仅文档）**：按[Task 6–9执行清单](g3-final/G3-F9-GK-S09-detailed-repair-plan.md)先补脱敏动作回执，再统一工具参数契约、符号尺度与真实外接球，最后零费整题回放及另获授权单题实测。本次不改作图代码、不发DS；旧真实GK-S09仍是2次请求无候选，35题未测，原因待回执定责。


## 2026-11-18 —— GK-S09根因边界与F9续作入档

将已观察的纯文字真题两次DS `construct_solid` 而未产候选与尚未记录 `blockerCode` 的边界写入[F9计划 Task 6–9](g3-final/G3-F9-kernel-action-repair-plan.md)：优先补白名单回执与参数形状；符号尺寸与球体构造作为待验证能力差距单列，不将猜测记成模型或内核已定责。本次只改文档、0付费调用，保留旧两次请求及35题未测口径。

## 2026-11-17 —— 纯文字题真实DS F9 单题试点

用户要求真实DS实测，选不依赖图像的GK-S09。当前源码零费探针19/21/15图元，定向86/86；原生模型实际2请求都调用construct_solid，仍无候选；其余35题未测，实际费用未知。报告与诊断缺口见[审计](audit/2026-11-17-g3-f9-text-only-pilot/README.md)，本次按首题未通过停批，不将其写为当前版本0/36。

## 2026-11-17 —— F9当前修订零费与真实DS首题复测

从当前源码重新打包原先的立体探针（避免旧打包JS污染），方锥/三棱柱/四面体得到19/21/15图元；86项定向测试通过。GK-S08真实原生DS试点1请求返回 `request_clarification`；其输入标记 `text_with_figure_reference`、此次无核对题图，35题未跑；候选/证书/渲染未测。实际扣费未知。本轮完整证据及止损见[审计](audit/2026-11-17-g3-f9-current-retest/README.md)，不改历史8请求记录。

## 2026-11-18 —— G3-F9 内核动作修复 Task 5：0 付费端到端全绿收口，停在真实 DS 重授权闸口（0 新增付费）

- 新增 `GK-S08` `ds_action` 端到端 0 付费回放通过（[g3DsFrozenCaseRunner.test.ts](./../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts) 与 `solid-\d+:v\d+` 拓扑焊接），最后一次改码后全量实测全通过：`npm test` **`557` 文件 `5883 passed | 1 todo`**、`typecheck` 退出 `0`、`lint` **`0 errors`**、Playwright E2E **`41 passed`**（`0` 重试）；详见 [g3-f9-repair-t5-zero-cost/README.md](./audit/g3-f9-repair-t5-zero-cost/README.md)。全程 **0 新增付费**，旧 `0/36` / `8 req` 试飞未重测、`humanReviewed: pending`、`Windows UIA: pending`，严停待用户重新授权 `GK-S08` 单题重测。

## 2026-11-18 —— G3-F9 内核动作修复 Task 4：Live 多范围 / 多状态 / 多分支 `CandidateSet` 接线（0 新增付费；下一步 Task 5）

- 在不触发任何新 DeepSeek API 付费调用前提下完成 Task 4：`PlanOutcome.candidateSlices`、`dsActionTools` 分支独立 `SpeculativeCanvas`（含 `parabola`）、`g3DsFrozenCaseRunner` 多状态/多分支展开、以及 `GK-S02` 开放折面与 `GK-P06` 三分支 live `ds_action` 端到端全绿（`4` 文件 **`131 passed`**，`typecheck` 退出 `0`，`lint` `0 errors`；详见 [g3-f9-repair-t4/README.md](./audit/g3-f9-repair-t4/README.md)）；历史 `0/36` / `8 req` 仍未重测。

## 2026-11-18 —— G3-F9 内核动作修复 Task 3：有界反馈、停滞熔断与预算统一（0 新增付费；下一步 Task 4）

- **状态与证据**：[dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 输出 `toolName` 与 `progressSignature`，[modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 实装停滞熔断与恢复放行并修复 `beforeProviderRequest` `network` 双扣；`3` 文件 **`83 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task 3 审计](audit/g3-f9-repair-t3/README.md)。

## 2026-11-18 —— G3-F9 内核动作修复 Task 2：实际面/底座/折叠动作与真实内核只读查询（0 新增付费；下一步 Task 3）

- **状态与证据**：在 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 补全 `construct_base`、`construct_face`（共线/非共面拒止）、`construct_fold_state`（独立 `pre_fold` / `post_fold` 切片与 `stateSlices()`）、3D 点线构造与 `query_measurement` / `query_constraint_status`（rollback 同步清理）；[dsActionTools.test.ts](apps/web/src/agent/dsActionTools.test.ts) 等 `4` 文件 **`27 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task 2 审计](audit/g3-f9-repair-t2/README.md)。

## 2026-11-18 —— G3-F9 内核动作修复 Task 1：参数化 `construct_solid` 经 `solveConstraint3d` 真实写入（0 新增付费；下一步 Task 2）

- **状态与证据**：[dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 接入 `solveConstraint3d` 将四族立体实际写入 `SpeculativeCanvas`，同步维护 `points3` 快照/回滚并补充 [dsActionTools.test.ts](apps/web/src/agent/dsActionTools.test.ts) 正反例；`3` 文件 **`17 passed`**、[solidContracts18.test.ts](scripts/reliability-eval/solidContracts18.test.ts) **`23 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task 1 审计](audit/g3-f9-repair-t1/README.md)。

## 2026-11-18 —— G3-F9 内核动作修复 Task 0：工具状态真实性闸与停滞保护（0 新增付费；下一步 Task 1）

- **状态与证据**：在 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 新增 `stateChanged` 字段、删除默认 `accepted` 兜底并收敛 `buildDsActionToolSchemas` 为已实装闭集；在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 接入同签名/假推进 `no_progress` 熔断；在 [dsActionTools.test.ts](apps/web/src/agent/dsActionTools.test.ts) 与 [modelPlanner.test.ts](apps/web/src/agent/modelPlanner.test.ts) 先 RED 后 GREEN（`2` 文件 `75 passed`、`typecheck`、`lint` `0 errors`、`test:docs` 全过）；详见 [Task 0 审计](audit/g3-f9-repair-t0/README.md)。

## 2026-11-17 —— F9三组不同参数的零费重复复现与修复计划

在当前`0267dd61`对方锥/三棱柱/四面体三族重复运行当前内核动作，3/3均 `construct_solid` 与 `construct_face` 虚报 accepted但0图元，finish 为 empty_candidate；本次没有新付费DS请求。将分级真实性闸、内核构造接线、面/读数/状态、熔断、多状态live评分写入[新计划](g3-final/G3-F9-kernel-action-repair-plan.md)，可复查证据[零费探针](audit/2026-11-17-g3-f9-repeat-probe/README.md)。旧8请求单题真实结果不更改，F9仍未完成。

## 2026-11-17 —— F9 动作级模型真测及立体无操作根因

先零费验证 `ds_action` 工具及录制的多状态CandidateSet评分，后在用户新授权的5美元/108总请求/单题8次内测历史通过GK-S08。8次原生请求、8条usage；模型以`construct_solid`起步并以`finish_candidate`结束，但产品实现把前者及`construct_face`当成功却不产生图元，终因`empty_candidate`/内部预算停止。其余35题未测，费用实际金额未知，不把此结果算作36题失败率。脱敏[审计](audit/2026-11-17-g3-f9-ds-action-pilot/README.md)记录停批与代码修复方向。

## 2026-11-17 —— F9误路由的付费四题检查点

应用户要求启动F9时沿用旧临时 `ds_intent` 而非新版 `ds_action`：四题10次真实DS请求、旧口径完整合同0/4；实际金额未知。用户本轮没有新指定金额，错误沿用已用尽的5美元；发现后停止，未测余下32题。脱敏证据见[审计](audit/2026-11-17-g3-f9-route-mismatch/README.md)。需先零费纠正实测入口、证明动作级链与多状态候选集合接线，再重新取得明确预算，绝不把本次结果计入F9新架构成绩。

## 2026-11-18 —— G3-DS 最终版实施 Task F8：真实画布同哈希交付与全仓终态回归（0 付费；F0–F8 工程完结，停在 Task F9 授权前）

- **状态与证据**：强化 [dsCandidateBundle.ts](packages/agent-core/src/dsCandidateBundle.ts) 与 [canvasEvidence.ts](apps/web/src/canvasEvidence.ts) 的 `speculativeOnly` 硬阻断与 `data-candidate-hash` / `screenshotCandidateHash` 绑定，扩展 [drawing-reliability-36-render.spec.ts](e2e/drawing-reliability-36-render.spec.ts) 与 [drawing-reliability-lifecycle.spec.ts](e2e/drawing-reliability-lifecycle.spec.ts)。最终修改后全仓回归实测全部通过：`npm test` **`557` 文件 `5875 passed | 1 todo`**、`typecheck` 退出 `0`、`lint` **`0 errors`**、`test:rust` 全过、`Playwright` **`41 passed`（`0` 重试）**、`test:docs` 全过；详见 [Task F8 审计](audit/g3-final-f8/README.md)。Task F0–F8 零付费工程已全面闭环，现严格停在 **Task F9（分层真实 DS 复测）** 付费授权门前。

## 2026-11-18 —— G3-DS 最终版实施 Task F7：定向局部修复与停机闭环 `repairProgress`（0 付费；下一步 Task F8）

- **状态与证据**：新建 [repairProgress.ts](packages/agent-core/src/repairProgress.ts) 与 [repairProgress.test.ts](packages/agent-core/src/repairProgress.test.ts)，接入 [coordinator.ts](packages/agent-core/src/coordinator.ts)、[coordinatorPorts.ts](packages/agent-core/src/coordinatorPorts.ts)、[runState.ts](packages/agent-core/src/runState.ts)、[modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 并导出至 [index.ts](packages/agent-core/src/index.ts)；先 RED 后 GREEN，`4` 文件 **`154 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task F7 审计](audit/g3-final-f7/README.md)。真实 DS 36 题仍维持 `0/36` 基线，下一步进入 **Task F8（真实画布交付一致性与全仓终态回归，随后在 Task F9 付费授权前停止）**。

## 2026-11-18 —— G3-DS 最终版实施 Task F6：折叠多状态分支谱系与统一候选评估（0 付费；下一步 Task F7）

- **状态与证据**：在 [foldChain.ts](packages/agent-core/src/foldChain.ts) 新增 `foldMirrorPairAboutHinge`、`buildFoldStateLineage` 与 `verifyFoldStateHashesDistinct` 并在 [foldChain.sequence.test.ts](packages/agent-core/src/foldChain.sequence.test.ts) 验证；在 [g3DsFrozenCaseRunner.ts](apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) 与 [g3DsFrozenCaseRunner.test.ts](apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts) 绑定 `lineageKey` / `documentHash` 并导出 `evaluateFrozenCandidateSet` 统一 Live 与 Offline 候选集评估。先 RED 后 GREEN，`4` 文件 **`27 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task F6 审计](audit/g3-final-f6/README.md)。真实 DS 36 题仍维持 `0/36` 基线，下一步进入 **Task F7（局部修复闭环 `repairProgress`）**。

## 2026-11-18 —— G3-DS 最终版实施 Task F5：三维约束内核求解器 `constraintSolve3d`（0 付费；下一步 Task F6）

- **状态与证据**：在 [constraints3d.ts](packages/geometry-kernel/src/constraints3d.ts) 与 [measurements3d.ts](packages/geometry-kernel/src/measurements3d.ts) 新增线面/面面关系、共面残差、垂足投影与闭合流形半边拓扑校验，新建 [constraintSolve3d.ts](packages/agent-core/src/solver/constraintSolve3d.ts) 与 [constraintSolve3d.test.ts](packages/agent-core/src/solver/constraintSolve3d.test.ts)，接入 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 并导出至 [index.ts](packages/agent-core/src/index.ts)；先 RED 后 GREEN，`4` 文件 **`35 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task F5 审计](audit/g3-final-f5/README.md)。真实 DS 36 题仍维持 `0/36` 基线，下一步进入 **Task F6（折叠与多状态分支及统一候选评估）**。

## 2026-11-18 —— G3-DS 最终版实施 Task F4：二维与函数内核求解器 `constraintSolve2d`（0 付费；下一步 Task F5）

- **状态与证据**：在 [planar-constraints.ts](packages/geometry-kernel/src/planar-constraints.ts) 与 [function-evidence.ts](packages/geometry-kernel/src/function-evidence.ts) 新增二维关系与定义域证据辅助，新建 [constraintSolve2d.ts](packages/agent-core/src/solver/constraintSolve2d.ts) 与 [constraintSolve2d.test.ts](packages/agent-core/src/solver/constraintSolve2d.test.ts)，接入 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 并导出至 [index.ts](packages/agent-core/src/index.ts)；先 RED 后 GREEN，`4` 文件 **`93 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task F4 审计](audit/g3-final-f4/README.md)。真实 DS 36 题仍维持 `0/36` 基线，下一步进入 **Task F5（三维约束内核求解器 `constraintSolve3d`）**。

## 2026-11-18 —— G3-DS 最终版实施 Task F3：实体图 `EntityGraph`、约束图 `ConstraintGraph` 与三态观察（0 付费；下一步 Task F4）

- **状态与证据**：新建 [entityGraph.ts](packages/agent-core/src/entityGraph.ts)、[constraintGraph.ts](packages/agent-core/src/constraintGraph.ts)、[kernelObservation.ts](packages/agent-core/src/kernelObservation.ts) 及 [entityGraph.test.ts](packages/agent-core/src/entityGraph.test.ts)、[constraintGraph.test.ts](packages/agent-core/src/constraintGraph.test.ts)，接入 [obligationIR.ts](packages/agent-core/src/obligationIR.ts) 与 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 并导出至 [index.ts](packages/agent-core/src/index.ts)；先 RED 后 GREEN，`4` 文件 **`33 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；详见 [Task F3 审计](audit/g3-final-f3/README.md)。真实 DS 36 题仍维持 `0/36` 基线，下一步进入 **Task F4（二维与函数内核求解器 `constraintSolve2d`）**。

## 2026-11-18 —— G3-DS 最终版实施 Task F2：动作级 DS ToolSpec 与单动作协议 `dsActionTools`（0 付费；下一步 Task F3）

- 按 [G3-DS 最终版真实作图能力实施档案](g3-final/G3-DS-final-implementation-dossier.md) 完成 **Task F2**：在 [actionRegistry.ts](packages/agent-core/src/actionRegistry.ts) 定义 22 项闭集 `DS_ACTION_CLOSED_SET`，新建 [dsActionTools.ts](apps/web/src/agent/dsActionTools.ts) 与 [dsActionTools.test.ts](apps/web/src/agent/dsActionTools.test.ts) 接入 `SpeculativeCanvas` 步进执行与 `accepted/repairable/blocked` 三态反馈；同步更新 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts)、[modelToolPolicy.ts](apps/web/src/agent/modelToolPolicy.ts) 与 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 打通 `ds_action` 多轮单动作闭环（拒重 `toolCallId`、拒读+写混批、支持取消与澄清），保持 `ds_intent` 路线 A 兼容。`4` 文件 **`110 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F2 审计](audit/g3-final-f2/README.md)。真实 DS 仍 `0/36`；下一步推进 **Task F3（实体图与约束图）**。

## 2026-11-18 —— G3-DS 最终版实施 Task F1：探索候选隔离层 `speculativeCanvas`（`15be4dfc`，0 付费）

- 按 [G3-DS 最终版真实作图能力实施档案](g3-final/G3-DS-final-implementation-dossier.md) 完成 **Task F1**：新建 [speculativeCanvas.ts](apps/web/src/agent/speculativeCanvas.ts) 与 [speculativeCanvas.test.ts](apps/web/src/agent/speculativeCanvas.test.ts)（不改原文档的步进试探、三态反馈、`rollback`/`discard` 与 `candidateHash` 绑定、`promoteToDraftStore`）；并在 [draftStore.ts](apps/web/src/agent/draftStore.ts) 与 [hostBridge.ts](apps/web/src/agent/hostBridge.ts) 接入 `speculativeOnly` 硬拦截，禁止任何未晋升探索候选写主画布或铸造同意。`3` 文件 **`47 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过；入档 [Task F1 审计](audit/g3-final-f1/README.md)。真实 DS 仍 `0/36`；下一步推进 **Task F2（动作级 DS ToolSpec `dsActionTools`）**。

## 2026-11-18 —— G3-DS 最终版实施 Task F0：冻结 `92981ebd` 失败真源基线（`f118c721`，0 付费）

- 按 [G3-DS 最终版真实作图能力实施档案](g3-final/G3-DS-final-implementation-dossier.md) 完成 **Task F0**：在 [g3DsCaseTrace.ts](apps/web/src/agent/fixtures/g3DsCaseTrace.ts) 与 [g3DsCaseTrace.test.ts](apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts) 新增 `classifyRetest92981Case`，对 `92981ebd` 实测 36 题全部给出可追责首失败边界（`0` `unknown`、`0` `mixed_read_plan`）与 4 题缺图界标，生成 [Task F0 冻结基线](g3-final/retests/2026-11-17-92981/README.md)；定向 `3` 文件 **`93 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过。真实 DS 成绩仍为 `0/36`；下一步进入 **Task F1（探索候选隔离层 `speculativeCanvas`）**。

## 2026-11-17 —— G3-DS 当前版本冻结36题原生复测

在修订 `92981ebd` clean HEAD 按用户新授权测试：36题全运行、77次真实请求，完整合同0/36、1 partial、35 failed；2题有候选、0主画布提交。工具混批由上轮7次降为本轮0次，但模型施工单的实体引用、参数和格式问题仍阻断。实际费用未知，DS候选真实浏览器与受控提交未测。报告见[脱敏审计](audit/2026-11-17-g3-ds-live-retest-92981/README.md)；本轮没有修改产品代码。

## 2026-11-17 —— G3-DS 失败驱动：Task 0–Task 5 完结 + Task 6 前置零付费加固（等待 Task 6 授权）

- **零付费加固轮（[加固审计](audit/g3-ds-failure-driven-hardening/README.md)）**：修正 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts) `mathcanvas.ds_intent.prompt.v2` 与 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 工具参数契约冲突；修复 [g3DsFrozenCaseRunner.ts](apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) `PlannerPort` 工具/信号接线并接入 `evaluateTask6LivePreflight` 与 `aggregateTask6FunnelReport`；在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 补齐 `function.create_tangent`（含 `common_tangent`）、`perpendicular_through_point`/`parallel_through_point`、一般缩放圆锥方程、多顶点折叠旋转与 `unresolved_construction` fail-closed；全仓 `npm test` `550` 文件 **`5850 passed | 1 todo`**、`typecheck`、`lint` 全过。
- **`Task 5`（[Task 5 审计](audit/g3-ds-failure-driven-t5/README.md)，`b776d609`）**：落地 `dsCandidateBundle.ts` `traceCandidateHash` 与 `bridge_replay_passed`/`dsLiveRendered` 分类、3D 轨道拖拽 `cameraHash` 刷新及隔离提交撤销/重做闭环；Playwright `--workers=1 --retries=0` **`41 passed`**、`test:rust` exit `0`。

## 2026-11-17 —— G3-DS 失败驱动 Task 4：多问/多状态/多分支同版评测入口 `g3DsFrozenCaseRunner`（`332d8e47`，0 付费）

- 在 [drawingContracts.ts](scripts/reliability-eval/drawingContracts.ts) 新增 `evaluateDrawingContractSetByPolicy`，新建 [g3DsFrozenCaseRunner.ts](apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts) 与 [g3DsFrozenCaseRunner.test.ts](apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts)，并在 [drawingContracts.test.ts](scripts/reliability-eval/drawingContracts.test.ts) 与 [examRunCoordinated.ts](apps/web/src/agent/fixtures/examRunCoordinated.ts) 对齐公有输入白名单投影；验证 `GK-P06` 三分支、`JT-S04` 状态交换、`JT-S08` 缺支与篡改 `candidateHash` 全数 fail-closed（`3` 文件 **`65 passed`**、`typecheck`、`lint`、`test:docs` 全过）。入档 [Task 4 审计](audit/g3-ds-failure-driven-t4/README.md)；真实 DS 仍 `0/36`，下一步进入 Task 5（零付费桥接）。

## 2026-11-17 —— G3-DS 失败驱动 Task 3：失败签名能力族（圆锥方程/割线异交点/棱比与标签桥接）及 `GK-P08` 负例（0 付费）

- 在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 新增 `resolveConicFromEquation`、`conic_vertex`、`other_line_conic_intersection`、实体 `id/label` 全注册与立体 `vertexNames` 作用域预登记；在 [dsDrawingIntent.test.ts](packages/agent-core/src/dsDrawingIntent.test.ts) 覆盖 `GK-S05` / `GK-P03` / `JT-P02` 改名变体，在 [drawingCertificate.test.ts](packages/agent-core/src/verification/drawingCertificate.test.ts) 增加 `GK-P08` `objCov=1, obCov=0` 表面齐全反例，并跑通 `5` 文件 **`111 passed`**、`typecheck`、`lint`、`test:docs`。入档 [Task 3 审计](audit/g3-ds-failure-driven-t3/README.md)；真实 DS 仍 `0/36`，下一步进入 Task 4（零付费）。

## 2026-11-17 —— G3-DS 失败驱动 Task 2：数学必要参数来源校验与 DAG fail-closed（0 付费调用）

- 在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 新增 `validateRequiredParameters` 与全策略必填参数表，禁止缺失 `expression`/`x0`/`domain` 等时偷偷代用 `"x"`/`0`/`[-5,5]`；`compileDsDrawingIntentToPlan` 遇到 `!dag.ok` 或参数未证实直接 fail-closed，不再退回原始步骤顺序，同步收紧 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts) 提示策略并在 [modelPlanner.test.ts](apps/web/src/agent/modelPlanner.test.ts) 与 [dsDrawingIntent.test.ts](packages/agent-core/src/dsDrawingIntent.test.ts) 完成 RED→GREEN 与 `GK-P08` 等回归（`4` 文件 **`110 passed`** + `systemPrompt.test.ts` `31 passed`、`typecheck`、`lint`、`test:docs` 全过）。入档 [Task 2 审计](audit/g3-ds-failure-driven-t2/README.md)；真实 DS 仍 `0/36`，下一步进入 Task 3（零付费）。

## 2026-11-17 —— G3-DS 失败驱动 Task 1：空场景构造与已有场景观察分阶段工具发布（0 付费调用）

- 新增 [modelToolPolicy.ts](apps/web/src/agent/modelToolPolicy.ts) 与 [modelToolPolicy.test.ts](apps/web/src/agent/modelToolPolicy.test.ts)，在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 与 [agentRunner.ts](apps/web/src/agent/agentRunner.ts) 实现基于实时 `GeometryDocument`/`selectedRefs` 的 `selectToolPhase` 互斥工具发布：`ds_intent` 空场景首轮仅发布 `plan_set_plan`，已有场景首轮仅发布只读工具并阻断偷发计划，`legacy_actions` 保持全兼容，7 题历史混合批次继续原子拒绝。`3` 文件 **`145 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过，入档 [Task 1 审计](audit/g3-ds-failure-driven-t1/README.md)；不凭回放声称 DS live 7 题已获救，下一步进入 Task 2（零付费）。

## 2026-11-17 —— G3-DS 失败驱动 Task 0：脱敏追踪 `G3CaseTrace`、结构化诊断与 R4 题图输入审计（0 付费调用）

- 新增 [g3DsCaseTrace.ts](apps/web/src/agent/fixtures/g3DsCaseTrace.ts) 与 [g3DsCaseTrace.test.ts](apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts)，在 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts) 新增 `onStructuredDiagnostic` 并保留 `onDiagnostic` 兼容，在 [examRunCoordinated.ts](apps/web/src/agent/fixtures/examRunCoordinated.ts) 增加可选脱敏 `onTrace` 出口；核验 `GK-S02/GK-S03/JT-S06/JT-S07` 为 `input_figure_missing` 且不改分母 `36`，并对旧 36 条记录给出 `7 tool_protocol / 10 verification / 19 unknown` 覆盖表。`3` 文件 **`90 passed`**、`typecheck`、`lint`（`0 errors`）与 `test:docs` 全过，入档 [Task 0 审计](audit/g3-ds-failure-driven-t0/README.md)；最新真实 DS 仍保持 `0/36`，下一步进入 Task 1（零付费）。

## 2026-11-17 —— G3-DS失败驱动升级方案入档（仅文档）

依据已保存[真实DS冻结36题0/36](audit/2026-11-17-g3-ds5-live-36/README.md)，写出[问题分层设计](superpowers/specs/2026-11-17-g3-ds-failure-driven-design.md)与[逐任务实施计划](superpowers/plans/2026-11-17-g3-ds-failure-driven-implementation-plan.md)，把26题零候选、7题混合工具、10题不完整候选和多状态验收口径列为不同根因/待证问题；GitHub参考只借机制，不引入新引擎。本轮未改作图代码、未调用DS；方案通过文档检查后提交推送，不宣称性能改善。
## 2026-11-17 —— DS5 36题真实模型全分母复测（失败检查点）

按用户要求在原生保存凭据通道跑完冻结36题：93次真实DS请求（请求上限108，单题≤3，预算最多5美元），完整合同 **0 passed / 3 partial / 33 failed**，10题非空候选、0主画布写入；输入211766 / 输出105984 tokens（91次有usage），账单费用未知。本轮未跑DS候选浏览器渲染/交付，不能用离线36/36顶替。混合场景读工具与计划同批返回至少7题，按现有安全规则拒绝。逐题脱敏证据见[审计](audit/2026-11-17-g3-ds5-live-36/README.md)；本轮额度结束，G3-DS未关闭。
## 2026-11-17 —— DS5 四题真实模型预检：否定性检查点

用户授权费用最多5美元；本次仅在原生通道做最多4请求、每题1请求的串行预检，累计4请求、输入7793/输出395 tokens，实际费用未知。四道代表题均无候选，完整合同0/4；至少3题以 `tool_calls` 完成首轮，单请求额度不足以验收后续工具环，不外推36题成功率。脱敏证据见[审计记录](audit/2026-11-17-g3-ds5-live-preflight/README.md)。本轮额度耗尽，未修改生产功能，未进行36题整批或用户确认提交。

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：过程日志；有日期的操作/测试记录是历史事实，不自动等于当前状态。实时状态仅维护在[当前状态](current-status.md)；执行总顺序以[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](superpowers/plans/2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

最后更新：2026-11-17。

## 2026-11-17 —— G3-DS / DS4 同候选浏览器渲染、冻结复播工件与受控交付（0 付费调用）

- **复播工件与 DOM Hash 链**：新增 [dsCandidateBundle.ts](packages/agent-core/src/dsCandidateBundle.ts)（`mathcanvas.ds_candidate_bundle.v1`）与 [dsCandidateBundle.test.ts](packages/agent-core/src/dsCandidateBundle.test.ts)，并在 [canvasEvidence.ts](apps/web/src/canvasEvidence.ts)（`data-viewport-hash`）和 [ConfirmationPanel.tsx](apps/web/src/components/agent/ConfirmationPanel.tsx)（`data-run-id`/`data-candidate-hash`/`data-document-hash`）贯通同候选渲染与确认文档一致校验；同步合入 `DS3` 全量回归收敛修复（[coordinator.ts](packages/agent-core/src/coordinator.ts) 恢复 `MAX_PLAN_ATTEMPTS = 4`、[diagramObligations.ts](packages/agent-core/src/diagramObligations.ts) 收窄 `JT-S07` 纯求解排除）。
- **验证与门禁**：最终代码改动后，全量 Vitest **`547` 文件 / `5824 passed | 1 todo`**、`typecheck` exit `0`、`lint`（`0 errors, 34 warnings`）、`test:rust` exit `0`、`@draw/desktop` `no-bundle` 构建出 `mathcanvas-desktop.exe`（SHA-256 `46EF3F1E0812E1B3CD66B8D7DA72035592598F78FF5DFAC6A0E9CD5042AD7BA5`）、串行 Playwright **`40 passed`**（[drawing-reliability-36-render.spec.ts](e2e/drawing-reliability-36-render.spec.ts) + [drawing-reliability-lifecycle.spec.ts](e2e/drawing-reliability-lifecycle.spec.ts)，`eval-results/g3-render-36/manifest.json` `36/36 passed`，`withHashes=36`，`warnCases=25`，`humanReviewed="pending"`，`dsLiveAuthorizedRun="pending_authorization"`）及 `test:docs` 全过；入档 [DS4 证据](audit/2026-11-17-g3-ds4-render-delivery/README.md)，**停在 `DS5` 付费授权门禁前**。

## 2026-11-17 —— G3-DS / DS3 生产证书双向真伪闭环与 `validating` 有界修复环（0 付费调用）

- **双向证书真伪修复**：封堵 [draftStore.ts](apps/web/src/agent/draftStore.ts) 空 `prompt: ""` 旁路并保留纯参数与无题设指令兼容性；在 [drawingCertificate.ts](packages/agent-core/src/verification/drawingCertificate.ts) 产出 `candidateHash`/`failedObligations`/`missingEntities`/`unresolvedClauses`，拦住 `GK-P09`（错表达式/缺切线）与 `JT-P09`（缺圆 `M` 与垂直共点弦）假阳性；在 [diagramObligations.ts](packages/agent-core/src/diagramObligations.ts) 与 [diagramVerification.ts](packages/agent-core/src/diagramVerification.ts) 修复 `JT-S07`（`（2）求...` 边界截断）及 `JT-S09`（`cube`+球共存与缺省 `neutralPlan` 形状识别）假阴性。
- **有界修复环**：扩展 [contracts.ts](packages/agent-core/src/contracts.ts)、[runState.ts](packages/agent-core/src/runState.ts)、[coordinatorPorts.ts](packages/agent-core/src/coordinatorPorts.ts)、[committerAdapter.ts](packages/agent-core/src/committerAdapter.ts) 与 [coordinator.ts](packages/agent-core/src/coordinator.ts)，支持带 `repairTracker` 停滞/无进展守卫和 `replaceDraft` 从头全量重验的 `validating -> planning` 修复（上限 2 次，无同意仍 0 写入）。
- **验证**：`planarContracts18`、`solidContracts18`、`drawingCertificate`、`draftStore`、`coordinator`、`diagramObligations`、`diagramVerification`、`runState`、`committerAdapter`、`agentRunner`、`dsDrawingIntent`（`11` 文件 **`438 passed`**）、`typecheck`、`lint` 与 `test:docs`（`8` 文件 `22 passed`）全过；入档 [DS3 证据](audit/2026-11-17-g3-ds3-certificate-repair/README.md)，下一步进入 **`DS4`**。

## 2026-11-17 —— G3-DS / DS2 4 类几何义务族求解、垂足与作用域隔离（0 付费调用）

- **正交求解补强**：在 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts) 补齐圆锥曲线焦点/离心率求参、直线与圆锥曲线交点/切线、过外点函数切线（数值求根+导数斜率）、`AD⊥DC` 四边形底座四棱锥、线/面垂足及连线、`infeasible_disclosure` 局部不可行共存，以及 `resolveAllowedScopes` / `compileDsDrawingIntentByScope` 作用域裁剪编译。
- **验证**：`dsDrawingIntent.test.ts`、`planarContracts18.test.ts`、`solidContracts18.test.ts`、`planCompiler.offPath.golden.test.ts`、`agentRunner.test.ts`（`5` 文件 **`137 passed`**，含独立 `verifyDiagramObligations` 正例及 $D$ 点垂直度篡改 `failed` 反例）、`typecheck`、`lint` 与 `test:docs`（`8` 文件 `22 passed`）全过；入档 [DS2 证据](audit/2026-11-17-g3-ds2-partial-families/README.md)，下一步进入 **`DS3`**。

## 2026-11-17 —— G3-DS / DS1 结构化施工单、紧凑提示词与通用构造 DAG（0 付费调用）

- **施工单编译器与不变量落地**：新增 [dsDrawingIntent.ts](packages/agent-core/src/dsDrawingIntent.ts)（8 类正交构图策略，直连数学内核与立体/平面求解器，拒绝手算立体顶点 `hand_computed_vertices_forbidden`、未声明引用、跨作用域污染与无来源自由常数，`blocking` 缺失转安全澄清），同步在 [drawingIntent.ts](packages/agent-core/src/drawingIntent.ts) 注册 `ds.*` 算子并在 [obligationIR.ts](packages/agent-core/src/obligationIR.ts) 增加 `irClauseSummaryForPrompt`。
- **紧凑协议瘦身与端到端接线**：在 [systemPrompt.ts](apps/web/src/agent/systemPrompt.ts)（`DS_INTENT_PROMPT_VERSION` 政策正文缩减 `<45%`）与 [modelPlanner.ts](apps/web/src/agent/modelPlanner.ts)（`buildDsIntentToolSchema()` + `resolveDsIntentOrPlanEnvelope`）落地 `intentMode: "ds_intent"`，通过 [agentRunner.ts](apps/web/src/agent/agentRunner.ts) 验证草稿暂存且主画布 `0` 写入。
- **验证**：`dsDrawingIntent.test.ts`、`drawingIntent.test.ts`、`obligationIR.test.ts`、`systemPrompt.test.ts`、`modelPlanner.test.ts`、`agentRunner.test.ts`（`6` 文件 **`196 passed`**）、`typecheck`、`lint` 与 `test:docs` 全过；入档 [DS1 证据](audit/2026-11-17-g3-ds1-intent/README.md)，下一步进入 **`DS2`**。

## 2026-11-17 —— G3-DS / DS0 脱敏基线账本与失败边界定位（0 付费调用）

- **方案升级与 `DS0` 闭环**：基于实测 `eval-results/ds-live-36-20261116/official-36/summary.json` 逐题核查，同步升级 [G3-DS实施计划](superpowers/plans/2026-11-16-g3-ds-live-upgrade-plan.md) 并完成 **`DS0` 区块**（0 新增付费调用）：建立纯函数脱敏账本与防泄漏校验 [dsLiveBaseline.ts](packages/agent-core/src/verification/dsLiveBaseline.ts) 及 [dsLiveBaseline.test.ts](packages/agent-core/src/verification/dsLiveBaseline.test.ts)，扩展 [examRunCoordinated.ts](apps/web/src/agent/fixtures/examRunCoordinated.ts) / [drawingContracts.ts](scripts/reliability-eval/drawingContracts.ts) 只读边界分类器，生成脱敏证据 [DS0 真实基线与失败边界](audit/2026-11-16-g3-ds-live-baseline/README.md) 与 [cases.json](audit/2026-11-16-g3-ds-live-baseline/cases.json)。
- **关键实证边界**：除已知 `2/36` 通过（`GK-S08`、`GK-S09`）、`JT-S07`/`JT-S09` 覆盖率 `1.00/1.00` 却判 `not_supported` 与 `13` 题零候选（含 `JT-S04` 停在 `waiting`）外，定位出 **`GK-P09`（`obCov=0.00`）与 `JT-P09`（`obCov=0.23`）生产证书假阳性放行进入 `awaiting_confirmation`**（根因涉及 `draftStore.ts:660` 空 `prompt: ""` 证书旁路及漏句），以及 **`coordinator.ts:776-784` 验证失败即死导致 6 题在 `req=1` 终止**、单次系统上下文达 `67.5–69.8 KB`。
- **验证**：`dsLiveBaseline.test.ts`、`examRunCoordinated.test.ts`、`drawingContracts.test.ts`、`typecheck`、`lint` 与 `test:docs` 全数通过；下一步进入 **`DS1`**。

## 2026-11-16（America/Los_Angeles）—— G3-DS 真实模型升级方案入档

用户指定以DS参与的冻结36题端到端36/36为新目标。[G3-DS独立实施计划](superpowers/plans/2026-11-16-g3-ds-live-upgrade-plan.md)及[设计增补](superpowers/specs/2026-11-15-drawing-reliability-design.md)已记录DS0–DS5、历史强制DS 2/36、未见题独立计分与新付费授权边界；此轮仅文档，无新DS请求或代码修复。历史主画布0写入不能用作DS零出图结论。
实时阶段进度只维护在[当前状态](current-status.md)。本文只记本轮过程；旧完整过程日志及旧状态/下一轮记录已按原字节[归档](audit/2026-11-15-pre-reset/README.md)，不删除历史、不继承旧完成数字。


## 2026-11-17 —— G3自动化渲染证据与既有回归修复（本轮）

- 渲染区块已作为 `fe46fbff` 提交并推送至远端 `feature/drawing-reliability-execution`，远端指针核对一致。本次后续单独补验同版桌面 `no-bundle` 构建退出0、exe SHA-256 `1cc02c296ec7fa0cf58e5cf943035e9d6fcf47396839427850fcdff003e7e983`；窗口UIA和人工签收仍未完成。

- 先运行36题真实浏览器渲染：36/36；对比截图机器诊断，25题仍有clipped/tiny warning，未写成人工通过。
- 完整E2E首轮321/327，针对性复现6项：3条旧三维不可测合同、2条球体在无点时对象索引缺失造成确认拒绝、1条棱柱拖动测试误点手柄。先写球体对象索引RED，再补实际WebGL group索引并GREEN；旧测试改为正向验证真实投影，棱柱测试瞄实体面内。
- 修后定向三维同步14/14、球体13/13、3D证据7/7；完整E2E **327/327**（单worker、零重试）；36题再跑36/36。全量Vitest **544文件/5799通过+1todo**，typecheck、文档22项、Lint 0 error。
- [报告与36题截图](audit/2026-11-17-g3-render-exit/README.md)：自动化passed仅说明没有error/必需标签遗漏；25题warning、人类可读性和Windows桌面UIA签收仍待完成。未跑DS模型、未宣称G3-UX整体退出。

## 2026-11-17 —— 真实候选渲染与确认链子区块

- **RED → GREEN**：2D 确认前椭圆缺失、3D `partial / objectsMeasurable=false`、真实候选取证函数缺失分别复现；随后补齐完整候选渲染、Three.js 实际对象投影与同版 `rendered` 盒子/截图/相机绑定。Agent 页在草稿期间并排显示真实候选，不以结构化估算或隐藏 mock 替代。
- **回归修复**：完整 Vitest 初跑暴露 32 项无画布测试边界失败，改用测试端口后 76 项真实 runner/提交测试通过；生命周期实核定位 remembered camera 初始出界，补一次取景后双击、撤销/重做/保存重载均恢复。最终 **544 文件 / 5796 passed + 1 todo**、目标 Playwright **5/5**、类型检查、Lint（0 errors）和 Web 构建通过。证据见[真实候选渲染与确认链](audit/2026-11-17-g3-candidate-render/README.md)。36 题审阅包、桌面 UIA、人工签收与最终复核继续保留。

## 2026-11-17 —— Task 6（T16）生命周期闭环与 G3 阶段总验收边界收口

- **RED → GREEN 与全量回归**：新增 [drawing-reliability-lifecycle.spec.ts](e2e/drawing-reliability-lifecycle.spec.ts)（确认前 0 写入、双击原子一次提交、撤销/重做、刷新与 `.mgeo` 导入导出哈希一致、丢弃 0 写入、跨对话隔离、矛盾拒绝、`GK-S05` 动点 `B₂` 拖动与一步撤销），实测曝光并修复 `AgentMessageList.tsx` 丢弃/提交后确认面板仍保留可点击按钮的缺陷，随后通过全量 Playwright `290/290` 发现并修复 `planarDrawing.ts` 拦截符号不变量题与 `functionDrawingPlan.ts` 丢失 `f(x)=x³−3x` 原文的回归。
- **全量验证与诚实保留项**：最终编辑后 `npm run typecheck`、`npm run lint`（0 errors）、`@draw/desktop` `no-bundle` 构建（`mathcanvas-desktop.exe` SHA-256 `826c6fc34b7bde2d23ff4620aa8e5ece6ca41630bbc361258585d901d91b9b0c`）、`eval:reliability -- --offline` 冒烟 **31/31** + 36 题 **36/36**、全量 Vitest **543 文件 / 5794 passed | 1 todo**、`npm run test:rust`（0 failed）与全量串行 Playwright **290/290 passed**（14.2m）全部通过。应用户指示**保留 DeepSeek 实测由用户后续执行**，非沙盒交互式 Windows 桌面走查、人工可读性签收与 `P8` 单列保留；证据见[Task 6 交互与全量回归证据](audit/2026-11-17-g3-interaction-exit/README.md)与[G3 阶段总验收汇总](audit/2026-11-17-g3-final/README.md)。

## 2026-11-17 —— Task 4 立体 / 折叠 18 题闭环与 G3-Math 36/36 总门禁退出

- **RED → GREEN 与契约/内核收口**：先跑出 `solidContracts18.test.ts` RED（0/18，随后首轮暴露复合点标 `solid-1:v0` 误截断与开放曲面 `polyhedron3` 校验阻断），继而在保留闭合体 ≥4 面 / ≥6 棱不变量前提下为 `solid.create_polyhedron` / `polyhedron3` 增加 `open?: boolean`、补齐 `solid.create_sphere.label` 解析、`inspectPointAndPrimitiveIntegrity` 内部复合点标例外、`solidVolume` / 分式根号 `dihedral` 余弦 / 翻折垂直优先级与 `scopePlans`/`statePlans`/`scopedStatePlans` 路由（`GK-S01..09`、`JT-S01..09`）。
- **验证与独立复核**：`solidContracts18.test.ts` **23/23 passed**（18 正例 + 4 项篡改反例）、`planarContracts18.test.ts` **23/23**、`drawingContracts.test.ts` **45/45**、`diagramObligations.test.ts` **109/109**、`eval:reliability -- --offline`（冒烟 **31/31** + 36 题 **`36/36 passed`**，`partial=0, failed=0, incomplete=0`，平均对象/义务覆盖率 **100%**，`liveWrites=0`、`drawingCertificateStatus="passed"`）、`typecheck`、`lint`（0 errors）、Web 构建、`test:rust` 与全量 Vitest **543 文件 / 5793 passed | 1 todo** 全部通过；只读独立数学与合同复核结论 **`SOUND (PASS)`**，**`G3-Math` 正式退出**，下一步推进 Task 6（`T16` 生命周期 E2E + Windows 桌面 `no-bundle` 实测 + 用户已保存 DeepSeek 实测）与 Task 7。证据见[Task 4 G3-Math 36/36 退出证据](audit/2026-11-17-g3-math-exit/README.md)。

## 2026-11-17 —— Task 3 平面 / 圆锥曲线 / 函数 18 题确定性求解与协调器全链闭环

- **RED → GREEN 整改与验证**：新增并打通 `planar.create_conic.excludedPoints`、`collinear`/`pointLineCoord`、`pointOnCurve` 线性求解、`verifyTangentLine` 拐点切线+防割线容差、`selectedScopeId` 全链（含修复 `draftStore.stage` 漏传导致多问场景报 `not_supported`）及 `evaluateDrawingContractBranches`；新建 `planarContracts18.test.ts` **23/23 passed**（18/18 正例 + 4 项负向篡改反例），并在暴露并修复 `actionSchemas` 缺失 `excludedPoints` 种类、`resolveFocusEccentricity` 显式方程重复提取与切线有限差分容差后全线通过。
- **验证**：`typecheck`、`lint`（0 errors）、Web 构建、`eval:reliability -- --offline`（冒烟 3/3 + 36 题实测 **18/18 平面全过**，`liveWrites=0`、`drawingCertificateStatus="passed"`；36 题总计 `18 passed / 2 partial / 16 failed`，对象覆盖 `54.17%`、义务覆盖 `52.31%`）与全量 Vitest **542 文件 / 5770 passed | 1 todo** 全部通过；下一步进入 Task 4 立体与折叠 18 题闭环。证据见[Task 3 平面 18 题证据](audit/2026-11-17-g3-planar-18/README.md)。

## 2026-11-17 —— Task 2 生产完整数学证书接线与统一评测接入

- **RED → GREEN 全链贯通**：新建 `drawingCertificatePipeline.test.ts`（先 RED `2 failed`）并在 `drawingCertificate.ts`、`draftStore.ts`、`committerAdapter.ts`、`hostBridge.ts`、`agentRuntime.ts`、`agentRunner.ts`、`agentStore.ts`、`ConfirmationPanel.tsx` 与 `reliabilityEval.eval.test.ts` 全线接入 `drawingCertificate` 与 `certificateBinding`，阻断部分核验、二阶段过期、会话切换与关闭开关回退，并补充 `ConfirmationPanel.test.tsx` 提交按钮禁用实证。
- **验证**：定向 10 文件 183 项、`typecheck`、`lint`（0 errors）、Web 构建、离线与 36 题 `eval:reliability`、Playwright `e2e/drawing-reliability-render.spec.ts`（`2 passed`）与全量 Vitest **541 文件 / 5747 passed | 1 todo** 全部通过；下一步进入 Task 3 平面 18 题闭环。证据见[Task 2 证书接线证据](audit/2026-11-17-g3-certificate-wiring/README.md)。

## 2026-11-17 —— P0 / T01 R4 终审签收与 R3 五项合同阻断整改（G3-Math 基线锁定）

- **RED → GREEN 整改**：围绕 R3 五项阻断在 `drawingContracts.test.ts` 新增反例测试后，完成 `GK-P06` AB 弦全分支绑定与 `touchPointLabel: "M"`、`JT-P02` `noncollinear-2d`（`y_P ≠ 0`）与互异交点、`JT-S04` 6 面闭合六面体与 `±90°` 对称镜像、`GK-S09 / JT-S01 / JT-S09` `resolveNamedPolyhedronVertexSets` 命名立体唯一绑定（拒绝匿名替身）以及 `inspectPointAndPrimitiveIntegrity` 全局重复归一化标签/别名/错维点拦截与跨状态谱系隔离。
- **R4 独立复核与 36 题真实基线**：只读独立审阅者复核结论 **`PASS`**，`drawing-contracts-36.json` suite 与 36 题全部转为 `independentReviewStatus: "approved"`（`GK-S02/GK-S03/JT-S06/JT-S07` 保留 `text_with_figure_reference` 诚实未知声明）。`drawingContracts.test.ts` **45/45 passed**、`typecheck`、`lint`（0 errors）、全量 Vitest **540 文件 / 5743 passed | 1 todo** 全部通过；36 题离线评测实测 **0 passed / 11 partial / 25 failed / 0 incomplete**（对象覆盖 23.5%、义务覆盖 18.9%），下一步进入 Task 2 生产完整数学证书接线。证据见[P0 / T01 R4 终审与基线](audit/2026-11-17-g3-contract-review-r4/README.md)。

## 2026-11-17 —— P7 / T15 真实画布渲染证据、分层视觉校验与标签不改数学避让

- **RED 复现**：扩展 `renderEvidence.test.ts`（`2 fail`）并新建 `e2e/drawing-reliability-render.spec.ts`，实测曝光 `planarDrawing.ts` 显式直线∩圆锥交点缺失与 2D/3D DOM 选择口径问题。
- **三层视觉隔离与真画布闭环落盘**：`renderEvidence.ts` 新增 `VisualEvidenceTier`（`structuredOnly` / `rendered` / `humanReviewed`）、`assertNoVisualTierUpgrade` 与 `adjustLayoutWithoutMutatingMath`；`renderLayoutInput.ts`、`canvasEvidence.ts`、`agentRunner.ts` 对齐 `rendered` / `structuredOnly` 标识；`planarDrawing.ts` 补齐显式直线与圆锥曲线求交。
- **验证**：定向 3 文件 47 项 + Playwright `e2e/drawing-reliability-render.spec.ts` `2 passed`（四族真渲染与反例通过，AI 已抽检渲染截图并单列 `agent_visual_review`）；最终编辑后全量 Vitest **540 文件 / 5742 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过，下一步按 `2026-11-16-g3-completion-plan.md` 闭环 r3 剩余合同与 G3 全链路。证据见[P7 / T15渲染可见性证据](audit/2026-11-17-p7-render-visibility/README.md)。

## 2026-11-17 —— 按用户要求停止 goal 与待办封存

- **停止决定**：用户明确要求不继续整改、停止goal和当前工作。第三轮复核之后的宿主/退化、重复标签、指定实体、镜像与闭合六面体整改均未开始，不把它们写成已完成。
- **后续待办**：GK-P06/JT-P02、重复标签与指定实体、JT-S04镜像与闭合六面体、未确认题图与T01最终复核；随后依次为Task2生产证书、Task3平面18题、Task4立体/折叠18题与G3-Math、Task5真实渲染/人工签收、Task6浏览器与桌面交互、Task7 G3总验收。以上均只作待办，未执行、未验收。
- **边界**：16/18平面、10/18立体仅为case专属数学内容可批准，suite不可批准，T01/G3未退出，发布仍阻断。所有活动文档已按停止状态对齐。

## 2026-11-16 —— G3 / T01 第三轮独立全量合同复核（否定性checkpoint）

- **独立结论**：agent-0复核当前 `6fb9f34a` 的36/36合同，16/18平面、10/18立体case专属数学内容可批准；suite不可批准，全部保持 `pending_second_reviewer`。原文/hash/sourceSpan一致，复核时9文件66项通过，但测试未覆盖新finding。
- **新阻断**：GK-P06缺AB/A/B/M绑定；JT-P02接受P=(-1,0)、M=A₁、N=A₂；JT-S04仅+90°且两面开放曲面替代闭合六面体；GK-S09/JT-S01/JT-S09可从其他polyhedron取正确实体；points2Of/points3Of同名覆盖。四个题图case继续保持unknown，不猜面环。
- **处置**：先保存[第三轮独立全量复核](audit/2026-11-16-g3-contract-review-r3/README.md)，再按RED→GREEN修平面宿主/退化、重复标签与指定实体、JT-S04镜像与闭合六面体。T01/P0不退出，不把局部批准数写成整体通过率。

## 2026-11-16 —— G3 / T01 GK-S02 文字可确定的折叠证据

- **RED→GREEN**：折前被错误要求P、折后混入折前检查、单方向折叠和lineage首状态对象覆盖问题逐项复现；新增state对象清单、±90°共享方向旋转和实际平面正弦后恢复44项通过。
- **数学与聚合**：P=(3√3,0,±2√3)，PC=4√3；PCD/PBF正弦为8/√65，镜像相同。谱系聚合使用全状态实体并集，开放曲面仅约束顶点，未填写未经审核的 `expectedFaceRings`。
- **验证与边界**：定向44项、全量540文件/5740通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner。题图hash/regions、宿主与完整面环仍未确认，不将GK-S02或T01标为退出；下一步恢复第二独立reviewer。证据：[GK-S02折叠证据](audit/2026-11-16-g3-gks02-fold/README.md)。

## 2026-11-16 —— G3 / T01 JT-S01 球半径与二面角最值

- **RED→GREEN**：指定O存在且四点共球仍无半径义务，先复现1项漏检；新增独立球心/半径与二面角最值检查后恢复43项通过。错误半径和φ=90°普通折叠点均拒绝。
- **数学与scope**：指定O=(1/2,1/2,√3/2)、半径√5/2。第(2)问 `cosθ=(√3+c)/√(7−3c²+2√3c)`，在c=−1/√3取得最小1/√3，两个镜像最优均通过，不继承第(1)问PC⊥AB。
- **验证与边界**：定向43项、全量540文件/5739通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner。GK-S02、生产证书与独立复审未关闭。证据：[JT-S01球半径与最值](audit/2026-11-16-g3-jts01-sphere-dihedral/README.md)。

## 2026-11-16 —— G3 / T01 JT-S08 动点平面夹角范围

- **底图纠错**：旧测试为菱形且BC不垂直AC，按原题三边长1和60°改为A(0,0,0)、B(2,0,0)、C(3/2,√3/2,0)、D(1/2,√3/2,0)，补第(1)问两个垂直方向，旧底图保留为反例。
- **RED→GREEN**：证明/端点缺失先得到1项失败；新增真实法向与端点义务后恢复43项通过。`cosθ=1/√(4+3t²)`，t=0/1给出 `[1/√7,1/2]`；中间代表点不能替代端点，缺端点返回incomplete。
- **验证与边界**：定向43项、全量540文件/5739通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner。JT-S01与其他折叠、生产证书与独立复审未关闭。证据：[JT-S08动点范围](audit/2026-11-16-g3-jts08-range/README.md)。

## 2026-11-16 —— G3 / T01 JT-S04(2) 异面直线最小余弦

- **RED→GREEN**：BE=6真实折叠满足旧合同但缺最值义务；新增 `ob-2-skew-min-cos` 后恢复43项通过。BE=5合法非最优与缺before/after证据均拒绝。
- **数学**：折后BC=(8−x,0,−x)、AD=(9−x,0,−x)，夹角差导数在x=6由负变正，最小余弦为7√2/10。第(2)问不继承CF⊥BD或BE=5，也不是二面角。
- **验证与边界**：定向43项、全量540文件/5739通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner。JT-S01/JT-S08及其他折叠、生产证书与独立复审未关闭。证据：[异面直线最小余弦](audit/2026-11-16-g3-fold-skew-min/README.md)。

## 2026-11-16 —— G3 / T01 GK-S05(2) 二面角区间不可行证据

- **RED→GREEN**：错误D₂与“另一小问无解”反例暴露旧不可行义务漏检；新增线段投影二次多项式、符号和分母范围核验后恢复42项通过，伪造P仍拒绝。
- **数学与纠错**：归一化BB₁参数 `t∈[0,1]` 下 `cos²θ=3/(16t²−16t+7)`，分母范围为[3,7]，cosθ≤−√(3/7)<−1/2，120°不可达。初次混入物理BP参数的系数后，显式记录参数域并纠正，未改容差。
- **验证与边界**：定向42项、全量540文件/5738通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner。其他折叠/范围、生产证书与独立复审未关闭。证据：[二面角区间不可行证据](audit/2026-11-16-g3-solid-infeasibility/README.md)。

## 2026-11-16 —— G3 / T01 平面动点最值与取等条件

- **RED→GREEN**：三份合法但非最优候选先复现3项漏检；新增解析族谓词、最值义务与取等条件后恢复42项通过。GK-P07最大值20√5、JT-P03最小|DE|=4/3、JT-P07最小点积1均独立推导。
- **反例与纠错**：JT-P03旧的|DE|=4普通候选保留为负例，正例改为参数和−8的真实最优割线；补查正确最值点配错误AB宿主的反例，并加端点绑定。JT-P07非竖直弦点积21/20>1，不能替代竖直弦最小值1。
- **验证与边界**：定向42项、全量540文件/5738通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner，不宣称真实36题通过。立体剩余范围/折叠、生产证书与独立复审未关闭。证据：[平面动点最值](audit/2026-11-16-g3-planar-extrema/README.md)。

## 2026-11-16 —— G3 / T01 完整棱柱几何合同

- **RED→GREEN**：新棱柱正反例先得到2项失败；复用 `vector-equal-3d` 等既有谓词补齐GK-S05十条、JT-S02五条义务后恢复39项通过。斜四棱柱、短AD、错对应棱与错误三棱柱平移均拒绝。
- **范围**：GK-S05补AD=2、第二底面法向、上下底/侧棱向量和第(1)问 B₂C₂=A₂D₂；JT-S02补三条侧棱平移与三对对应边，不把AC⊥BB₁证明目标塞回前提。
- **验证与边界**：修正新合同端点字段和测试类型守卫后，定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner。其余最值、折叠、生产证书与独立复审未关闭。证据：[完整棱柱几何](audit/2026-11-16-g3-prism-geometry/README.md)。

## 2026-11-16 —— G3 / T01 结构化不可行诊断与代数证据

- **RED→GREEN**：JT-P01/P04/P06 的“另一小问无解”及错误scope标记先复现3项失败；新增三类代数证据并关闭关键词回退后恢复39项通过。JT-P01错误平分线、JT-P06实际可行情形均拒绝。
- **数学纠错**：JT-P04旧PB不是切线，改用 `A(4,4)、B(-2,1)、P(1,-2)`，斜率积为−2；共圆条件化为 `d(p-d)=0`，与 `ab=-8` 矛盾。内核交点数组接口误读已按实际返回结构修正，未改容差。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner，不宣称真实36题通过。生产诊断绑定、其余最值、完整棱向量、其他折叠与独立复审未关闭。证据：[结构化不可行诊断](audit/2026-11-16-g3-infeasible-evidence/README.md)。

## 2026-11-16 —— G3 / T01 函数表达式与公共切线参数域

- **RED→GREEN**：GK-P04 范围反例与 GK-P09 微小偏移函数先复现2项失败；补 `ob-f-expression`、`ob-g-domain`、`ob-common-tangent-range` 及三个求值分支后恢复39项通过。等价多项式允许，微小偏移和 `a=-2` 拒绝。
- **数学依据**：公共切线消元得到 `a(t)=(3t²-1)²/4-2t³`，`a'(t)=3t(3t+1)(t-1)`；全局最小值为 `a(1)=-1`，范围是 `[-1,+∞)`。检查锁定题面三次函数与二次形状，不靠采样代表范围证明。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；未运行离线 reliability runner，未将工程回归记作36题或provider成绩。其余最值、其他折叠、生产证书与独立复审未关闭，T01/P0不退出。证据：[函数表达式与公共切线参数域](audit/2026-11-16-g3-function-domains/README.md)。

## 2026-11-16 —— G3 / T01 切线端点与目标直线绑定

- **RED**：GK-P05 原点/端点、GK-P07 切线点名、JT-P04 错误切点、JT-P08 脱离 EF 的点均先复现4项失败。
- **GREEN**：新增 `touchPointLabel` 与实际交点绑定；补O原点、P/Q与Aᵢ端点、P/A/B曲线/直线、每支EF端点义务，恢复39项通过。全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）及文档61项通过。
- **边界**：未新增离线 reliability 读数，未由局部切线正确推导整题正确；参数域/最值、其他折叠与生产验收未完成。证据：[切线端点与目标直线](audit/2026-11-16-g3-tangent-endpoints/README.md)。

## 2026-11-16 —— G3 / T01 跨状态折叠谱系

- **实现**：新增 `fold-transform-3d`、`stateCandidates` 与 `evaluateDrawingContractStates`，内核重算 F→E +90° 的 A/B 位置并核验铰链漂移，缺状态/缺点/非刚体旋转失败。
- **纠错与反例**：诊断发现合同 E→F 与测试 F→E 镜像不同，修正有向铰链而不改容差。伪造坐标仍满足 CF⊥BD、面面垂直与开放面环，但不符合同一翻折，已被拒绝。聚合缺 after_fold 返回 incomplete。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）及文档61项通过；未新增离线 reliability 读数。生产stage/runner、其他折叠和T15/T16未完成。证据：[跨状态折叠谱系](audit/2026-11-16-g3-fold-lineage/README.md)。

## 2026-11-16 —— DeepSeek 真实评测：端点重新授权阻断

- **用户新授权**：改用保存的 DeepSeek 做真实 provider 评测，不再以离线结果代替；P8与正式发布仍不开启。未读取、输出或保存密钥到 shell/文档。
- **真实执行**：通过 Tauri 正常设置界面选择最小题集 planning（至少3次请求），未运行至少24次请求的另一通道。实际为 **0 planned / 3 error**，32ms为本地失败回合，成本 not measured。
- **阻断**：旧凭据没有可信端点绑定，必须用户在编辑表单重新输入 API key 并保存才能建立授权。已打开该表单，不能用脚本读取旧密钥绕过。尚无成功模型输出或36题 provider 验收。证据：[DeepSeek端点重新授权阻断](audit/2026-11-16-g3-deepseek-provider/README.md)。

## 2026-11-16 —— DeepSeek 重新授权后最小真实评测通过

- **恢复**：用户重新输入并保存 API key，界面显示工具调用、严格 JSON、图像、流式验证通过，未读取或记录密钥。
- **真实结果**：最小题集 planning 为 **1 planned / 2 clarification / 0 error**，平均延迟1832ms，成本 not measured。一条产出可执行动作和草稿，两条合理要求澄清；没有以离线数据替代，未自动扩大为24/36次请求。
- **边界**：最小调用链连通不等于固定36题、G3-Math或G3-UX完成。证据：[DeepSeek重新授权与最小真实结果](audit/2026-11-16-g3-deepseek-provider/README.md)。

## 2026-11-16 —— G3 / T01 指定顶点与面环拓扑

- **RED→GREEN**：GK-S03 六顶点五面体合同曾被四面体满足，实测旧检查错误放行；新增 `expectedVertexIds/expectedFaceRings` 后真实五面体通过、错误绕向拒绝，循环面环起点保持兼容。
- **覆盖**：14个题面确定合同已绑定四棱锥、三棱柱/四棱柱、四面体、立方体及JT-S04开放面；GK-S09/JT-S09补辅助点命名。GK-S02、JT-S06/S07未提供题图，不猜面环；JT-S08折痕图另行处理。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过。最新离线0/11/25，对象/义务覆盖约23.50%/20.39%，更严格核验使旧虚高读数下降。fold-transform、生产证书与T15/T16未完成。证据：[指定拓扑整改](audit/2026-11-16-g3-named-topology/README.md)。

## 2026-11-16 —— G3 / T01 公共曲线与实体绑定推广

- **裁决**：前问确定且后续共用的 C/E/Γ 提升为 `stem`，而非隐式继承全部前问；绑定实际命名曲线，匿名正确曲线不得替错误 C 补位。GK-P08 原题未命名，不伪造必需标签。
- **反例**：JT-P01/P06 不可行披露搭配错误 C、GK-P01 匿名曲线替身、GK-P02 M=N 均由 RED 转为拒绝，恢复39项通过。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、单独Web构建（640 modules）及文档61项通过。离线0/12/24不变，义务覆盖约22.24%；指定拓扑、折叠谱系、切线端点及参数域/最值仍未闭合。证据：[公共曲线整改](audit/2026-11-16-g3-shared-curves/README.md)。

## 2026-11-16 —— G3 / T01 scope 继承与曲线/实体绑定试点

- **RED→GREEN**：JT-P05 跨问错 C、JT-P08 错误轨迹参数、GK-P09 零长度切线、JT-S01 全局强制 O/父条件丢失均先得到4项失败，再补通用判据与合同后恢复39项通过。
- **实现边界**：新增显式 `dependsOn`、`conic-2d.entityId`、轨迹实际参数核验、可选 `primitiveType` 与函数切线非退化；不隐式继承全部前问。JT-S01 的 O 仅属 `(1)(ii)`，且必须是真实球体。
- **验证**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）与文档61项通过。
- **未关闭**：离线仍为0/12/24，生产未路由不能由合同GREEN抵销；其余合同推广、指定拓扑、折叠谱系、切线端点与参数域/最值继续整改。证据：[scope与实体绑定试点](audit/2026-11-16-g3-scope-entities/README.md)。

## 2026-11-16 —— G3 / T01 第二轮独立复核与数学分支整改

- **独立复核**：agent-0 逐题复核36/36，4题作图数学合同可批准、32题需整改；T01/P0仍未退出，未由作者自签 approved。审计完整保存逐题理由、Critical/Important/Minor 与边界。
- **实质整改**：GK-P03 最优直线改为 `x−√2y−4=0` 并拒绝 `s=2`；GK-P06 枚举 `D=0,±1` 和面积 `3或4√2`；JT-S04 用真实90°铰链旋转确认 BE=5，反例20/3被拒绝；JT-S09 增加真实六面闭合拓扑。补 M/N互异、AB点名、切线端点、圆半径/切点义务。
- **验证与边界**：定向39项、全量540文件/5735通过+1todo、类型、Lint（0 errors/33既有warnings）、Web构建（640 modules）通过；最新离线结果为 **0 passed / 12 partial / 24 failed / 0 incomplete**，义务覆盖约22.38%。未路由和生产未接线仍导致24题失败，不能用合同GREEN冒充生产提升。scope继承、指定拓扑、跨状态折叠、切线绑定及参数域/最值仍未关闭。
- **证据**：[第二轮独立复核与整改](audit/2026-11-16-g3-contract-review-r2/README.md)。

## 2026-11-16 —— G3 / T01 第三批定义域、分支与切线整改

- **定义域/分支**：新增 `conic-domain-2d`、`evaluateDrawingContractBranches`、`line-equation-2d`；JT-P08排除 `(0,±√3)`，positive/negative双EF分别验证，缺支或漏排除点不通过。
- **切线/面积**：函数切线用符号导数、圆锥切线用真实代数交点；GK-P09错误斜率拒绝，GK-P07补P在圆M和两条抛物线切线，GK-P06补双切线/中点圆相切/面积，JT-P09补圆上/共线/四边形面积。
- **验证**：定向29项通过；全量540文件/5725通过+1todo，typecheck、lint（0 errors/33既有warnings）、Web构建（640 modules）通过。
- **边界**：最新36题为 **0 passed / 11 partial / 25 failed**，旧JT-P08因缺 `excludedPoints` 不再通过；生产DSL/渲染支持仍需后续接线。选择题子问文本保持中性。证据见[第三批定义域与切线整改](audit/2026-11-16-g3-domain-tangent/README.md)。

## 2026-11-16 —— G3 / T01 第二批拓扑、宿主与平面关联整改

- **立体**：新增 `topology-3d`（闭合/开放分开）、`coplanar-3d`、`point-on-segment-3d`；GK-S03/S02补拓扑与题图边界，JT-S03补垂足平面与第二方向，JT-S08补M线段域，GK-S07补棱柱对应向量与闭合拓扑。
- **平面**：新增点在线/线段/曲线、水平和x坐标判据；GK-P01补A/B在l与O，GK-P02补P/M/N共线、MT水平、T在线段AB，JT-P02补双曲线交点与共线，JT-P07补点值、l、P/Q及x=3交点。
- **验证**：定向25项通过；全量540文件/5721通过+1todo，typecheck、lint（0 errors/33既有warnings）、Web构建（640 modules）通过。两处测试坐标经独立复算纠正，未放宽实现判据。
- **边界**：最新36题仍为1 passed/10 partial/25 failed，义务覆盖约22.5%，不是通过率提升；T01/P0未退出。证据见[第二批拓扑与宿主整改](audit/2026-11-16-g3-host-topology/README.md)。

## 2026-11-16 —— G3 / T01 第一批合同安全整改

- **不可行与scope**：`infeasible-branch` 改为禁止实体绑定，修复JT-P06伪造P+披露、GK-S05全局强制P；新增 `evaluateDrawingContractScopes` 与二面角正弦/余弦判据，GK-S01补两问义务，JT-S02恢复真正面面垂直并补P宿主/二面角。
- **结构与数学**：真实 `sphere` 的外接球、等棱三棱柱、正方体棱长与半球内接检查取代名实不符谓词；GK-P04范围改为 `[-1,+∞)`，JT-P04(2)改为无实数解；函数/直线判据绑定唯一实体，f/g交换与替身直线均拒绝。
- **验证**：定向16项通过；全量540文件/5712通过+1todo，typecheck、lint（0 errors/33既有warnings）、Web构建（640 modules）通过。最新冻结36题为 **1 passed / 10 partial / 25 failed**，GK-S01旧passed降为partial是补验小问后的正确结果，不回退。
- **边界**：T01/P0未退出，独立reviewer尚未复审本切片；继续剩余关联义务、拓扑、显示策略和统一scope入口。证据见[第一批合同安全整改](audit/2026-11-16-g3-contract-safety/README.md)。

## 2026-11-16 —— G3 实核、T01 第二独立审题与整改重启

- **用户 goal**：按最新主计划完成 G3，每个区块验证、对齐活动文档并推送 GitHub；续作计划见[G3完成计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。
- **真实基线**：在 `8c26544c` 重跑冻结36题，结果为 **2 passed / 10 partial / 24 failed / 0 incomplete**，对象/义务覆盖约28.0%/25.7%，不是此前工作包提交记录可替代的 G3 退出证据。
- **第二独立 reviewer**：36/36逐题复核，结论 `changes_required`；仅 GK-P08 作图数学合同可批准，其余35题须整改。发现 GK-S01 局部条件未入义务、GK-S05/JT-P06 不可行点伪造、JT-S02 目标当题设、GK-P04 值域错误、JT-P04 伪解及立体拓扑/稳定实体绑定等系统性问题。
- **处置**：T01/P0 保持未退出；先提交否定性审计 checkpoint，再以 RED 反例整改合同和评测语义，之后进入生产证书接线、平面/立体数学闭环、T15/T16。全量工程基线复跑为540文件/5705通过+1todo；不进入P8、付费provider或发布。
- **证据**：[G3实核基线与第二独立审题](audit/2026-11-16-g3-truth-baseline/README.md)。

## 2026-11-16 —— P4 / T14 最终候选绑定、过期检测、仅相机不变性与原子一次确认（B4 工作包收口记录）

- **RED 复现**：新建 `drawingCertificateStaleness.test.ts` 并扩充 `committerAdapter.test.ts`，实现前 RED `2 failed | 4 failed | 44 passed (48)`。
- **候选保鲜、仅相机分离与防双击落盘**：`drawingCertificate.ts` 落地 `verifyCertificateFreshness`；`renderEvidence.ts` 区分 `camera_changed`（`mathStale: false, visualStale: true, requiresReplan: false`）；`committerAdapter.ts`、`agentRuntime.ts`、`agentRunner.ts` 与 `draftStore.ts` 落地原子一次确认锁（拦截二次点击写入）与 `promptHash` 过期检查。
- **验证**：定向 5 文件 103 项通过；最终编辑后全量 Vitest **540 文件 / 5705 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过，至此完成 `B4`（`P0–P6`）并按指令在 `T14` 后暂停；证据见[P4 / T14原子提交与保鲜证据](audit/2026-11-16-p4-atomic-commit-staleness/README.md)。

## 2026-11-16 —— P4 / T13 完整数学合同独立核验证书与变异拒绝矩阵

- **RED 复现**：新建 `drawingCertificate.test.ts` 与 `drawingMutation.test.ts`，实现前 RED `2 failed (2)`（缺失 `drawingCertificate.ts`）。
- **独立重算证书与变异拦截落盘**：实现 `drawingCertificate.ts`（`isDrawingRequestContract`、`evaluateMathGate`、`certifyDrawingAgainstContract`），结合 `acceptance.ts`（`isDrawingPrompt`）、`completionGate.ts`（重复 ID 自相矛盾检查）与 `diagramVerification.ts`（非有限坐标 `non_finite_geometry` 防线），直接对着最终图元坐标与 `conicResidualAt`/函数绑核重算，忽略自报证据并在关闭完整开关时显式报告 `"未完整核验"`。
- **验证**：定向 3 文件 16 项通过（覆盖 36 题合同必填结构与 8 类数学变异拒收 + 无关辅助点不变性）；最终编辑后全量 Vitest **539 文件 / 5701 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T13数学证书证据](audit/2026-11-16-p4-math-certificate/README.md)。

## 2026-11-16 —— P4 / T12 有界局部修复、停滞拦截、原子账本与 Worker 取消

- **RED 复现**：新建 `reliabilityDiagnostics.test.ts` 并扩充 `budget.test.ts`、`coordinator.test.ts` 与 `geometryWorkerClient.test.ts`，实现前 RED `4 failed (4) | 4 failed | 70 passed (74)`，涵盖停滞候选/非改进残差/缺失能力反复提问、跨账本部分扣减及 Worker 取消超时。
- **停滞拦截与原子取消落盘**：新增 `reliabilityDiagnostics.ts`（强制 `provenUnsat: false` 与 `createRepairStagnationTracker`）；`budget.ts` 实现 `consumeAll` 并对齐 `modelPlanner.ts`、`examRequestBudget.ts`、`examRunCoordinated.ts`；`coordinator.ts` 接入缺失能力及残差停滞立即终止；`geometryWorkerClient.ts` / `geometryCompileStrategy.ts` 接入 `AbortSignal` 与迟到消息丢弃。
- **验证**：定向 4 文件 76 项与 `examRunCoordinated.test.ts` 15 项通过；最终编辑后全量 Vitest **537 文件 / 5695 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建（639 modules）与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T12有界修复证据](audit/2026-11-16-p4-bounded-repair/README.md)。

## 2026-11-16 —— P4 / T10 折叠状态谱系、对称分支见证与耦合折角顺序约束

- **RED 复现**：扩充 `foldHinges.test.ts`、`planCompiler.foldBranches.test.ts` 与 `planCompiler.coupledFolds.test.ts`，覆盖铰链重合/漂移/边长突变/`dp_identity_conflation`、正负双分支与 `120°`/`60°` 内二面角/面面锐角隔离、逆序缺依赖点与 `> 3` 折越界拒绝；实现前 RED `3 failed | 5 failed | 11 passed (16)`。
- **状态谱系与多分支求解落盘**：`rotation3d.ts` 新增 `rotatePointAboutHinge` 与 `foldBranchesForTargetDistance`；`foldSystem.ts` 新增 `classifyFoldSystemResult`；`solidGoalMeasurements.ts` 新增 `verifyTargetAngleContract`；`foldHinges.ts` 新增 `validateFoldLineageStep` / `buildFoldLineage`；`coupledFolds.ts` 在保留 `solvePlanFoldSystem` 下新增 `solveCoupledFoldSequence` 追踪序贯谱系与多分支候选解 `candidateSolutions`（`complete: false`）。
- **验证**：定向 5 文件 26 项与全量 Vitest **536 文件 / 5689 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T10折叠谱系证据](audit/2026-11-16-p4-fold-lineage/README.md)。

## 2026-11-16 —— P4 / T09 参数化立体构造、拓扑拒收与开放曲面隔离

- **RED 复现与拓扑缺口验证**：扩充 `solid-builders.test.ts`、`prism.test.ts`、`pyramid.test.ts` 并新建 `solidDrawingContracts.test.ts`，实现前 RED `4 files failed | 9 failed | 46 passed (55)`。
- **内核开放曲面隔离与参数化求解落盘**：`solid-builders.ts` 导出 `signedPolyhedronVolume` 与 `buildOpenSurface`；`prism.ts`、`pyramid.ts`、`tetrahedron.ts` 分别补齐直/斜棱柱参数构造、已知垂足正交构造与未知垂足不默认中心、四面体镜像正负分支；`witnessSearch.ts` 接入 `validateAuxiliaryHosts` 拦截缺失顶点宿主；`compilePlan` 实测确认损坏拓扑不生成已通过草稿。
- **验证**：定向 4 文件 55 项与全量 Vitest **536 文件 / 5684 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T09立体作图证据](audit/2026-11-16-p4-solid-drawing/README.md)。

## 2026-11-16 —— P4 / T08 函数符号导数、定义域保留与竖直宿主动态依赖

- **RED 复现与漏洞拦截**：在 `function-evidence.test.ts` 扩展 5 项并新建 `functionDrawing.test.ts`（4 项），实现前 RED `2 failed | 8 failed | 20 passed (28)`，覆盖 `1/(x-0.37)` 奇数步长极点、`x/x`/`sqrt(-1)` 域保留、`abs(x)` 不可导尖点、域变更失效与 `JT-P02` 10 次拖动重算。
- **精确符号求导与宿主重算修复**：`expression.ts` 落盘 `differentiateExpressionAst`、`evaluateFunctionWithDomain` 与 `evaluateSymbolicDerivative`（不化简 `x/x`、对 `abs` 显式报 `unsupported_derivative`）；`calculus.ts` / `function-evidence.ts` / `diagramVerification.ts` 强化极点断开、外点切线区间报告、尖点/未定义点切线拒收与 `invalidateEvidenceOnDomainChange`；`planar-constraints.ts` 新增 `verticalLineConstraint` 解耦 `mathDomain` 与 `displayRange`，实测 `JT-P02` `P(t)=(-1,t)` 经 10 次跨窗拖动稳定保持 `x=-1`、`M,N` 在曲线上及共线定点 `(-4,0)`。
- **验证**：定向 3 文件 98 项与全量 Vitest **535 文件 / 5674 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T08函数作图证据](audit/2026-11-16-p4-function-drawing/README.md)。

## 2026-11-16 —— P4 / T07 平面与圆锥曲线确定性构造与定义域裁剪相交

- **RED 复现与内核扩展**：扩充 `conic-line.test.ts` 并新建 `planarDrawing.test.ts` 复现 RED 缺失；在 `@draw/geometry-kernel` 落盘旋转/平移 `conicFoci`、`tangentLineToConicAt`、`fitOriginConicThroughPoints`、参数化直线定义域排除 `intersectParametricLineWithConic`（区分截面截断 `single` 与二重切根 `tangent`）及 `intersectPlanarLineAndConicExact`。
- **代数优先平面/圆锥求解器与诚实诊断**：新增 `packages/agent-core/src/solver/planarDrawing.ts` 覆盖 `GK-P01`、`GK-P08`、`JT-P03`、`JT-P06`（实测发现 `c=1 < b=2` 时 `PF₁⊥PF₂` 实数域无解，改为记录 `infeasibleConstraints` 而非伪造 `P`；同时验证 `c ≥ b` 可行正交构造）、`JT-P07`、`JT-P08`（含 `x ≠ 0` 排除与 `EC=2CF` 线性消元）及 `"示意图"` `free_choice` 披露，接通 `deterministicProblemRoute.ts`、`agentRunner.ts` 与 `reliabilityEval.eval.test.ts`（同时保障 1D 函数题留给 `T08`）。
- **验证**：`conic-line.test.ts` 16 项 + `planarDrawing.test.ts` 9 项通过，全量 Vitest **534 文件 / 5665 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P4 / T07平面作图证据](audit/2026-11-16-p4-planar-drawing/README.md)。

## 2026-11-16 —— P5 / T11 可版本化尺度感知数值策略与退化分类

- **RED 复现与大尺度实测漏洞**：新增 `numericRobustness.test.ts`，实现前 RED `4 failed | 1 passed (5)`，除新增版本化无量纲接口待落盘外，实测捕获 `conic-line.ts` 在 `scale = 1000` 时单位步长切线因 `2.5e-7 + 1 - 1` 精度丢失与固定 `rootScale` 下界 `1` 导致误判 `none` 的真实漏洞。
- **三层无量纲策略与内核修复**：`numeric.ts` 新增 `NUMERIC_POLICY_VERSION = "num-policy-v1"`、无量纲长度/法向平面距/垂直/平行残差、`NaN`/`Infinity`/零向量 `degenerate` 判定与跨阈值返回 `unknown` 的 `classifyUncertaintyInterval`；`exact-forms.ts` 导出 `EXACT_FORM_POLICY_VERSION`，`diagramVerification.ts` 同步导出 `DIAGRAM_NUMERIC_POLICY_VERSION`；`conic-line.ts` 引入 Neumaier 补偿求和、最近原点投影重参数化与 `conicCharacteristicScale`；`solid-builders.ts` 整体共面判断采用 `span * 1e-9`。
- **验证**：`pointOnConic` + `numericRobustness` + `conic-line` 3 文件 22 项通过，全量 Vitest **533 文件 / 5653 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P5 / T11数值稳健性证据](audit/2026-11-16-p5-numeric-robustness/README.md)。

## 2026-11-16 —— P3 / T06 必需对象清单与类型化构造意图 DAG

- **RED 复现与契约设计**：编写 `drawingIntent.test.ts`，覆盖 DAG 六类异常拦截、拓扑序与 `T12` 脏传播、`GK-S02` 缺 `E/F/P` 与孤立 `label`/隐藏辅助对象拦截、`JT-P06` 缺焦点 `F₁`/`F₂` 与 `compilePlan` `drawingIntentCheck` 端到端阻断（初始因模块未创建 RED 失败）。
- **无环构造 DAG 与物化审计**：新增 `packages/agent-core/src/drawingIntent.ts`，直接绑定 `ACTIONS` 能力表实现 `compileConstructionDag`、`deriveRequiredDrawingIntent`（复用 `parseObligationWithLegacy`/`parseShapeClause`/`readFoldTransformations`）、`auditMaterializedIntent` 与 `collectDependentSubgraph`，在 `deterministicProblemRoute.ts`、`solver/solverContracts.ts` 与 `planCompiler.ts`（显式 `drawingIntentCheck` 开关）接通，off-path 黄金基线保持零字节变化。
- **验证**：`drawingIntent.test.ts` + `planCompiler.offPath.golden.test.ts` 2 文件 18 项通过，全量 Vitest **532 文件 / 5648 passed | 1 todo**、`typecheck`、`lint`（0 errors）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P3 / T06构造DAG证据](audit/2026-11-16-p3-drawing-intent-dag/README.md)。

## 2026-11-16 —— P3 / T05 稳定多实体绑定、同向向量比与忠实原文诊断

- **RED 复现与实测漏洞**：在 `diagramEntityBinding.test.ts` 与 `diagramSourceDiagnostics.test.ts` 构造 9 项契约并复现 7 项失败，实测暴露：`leftover` 把已识别圆方程替换为空格产出 `"若双曲线…与圆            相切"`、`JT-P08` 的 `"向量EC=2向量CF"` 被误读成固定长度 `EC=2`、`JT-P07` 省略 `/1` 与带标签 `"椭圆 C 上一点"` 漏匹配，以及多曲线并发/跨 scope 时缺少明确绑定拒绝码。
- **稳定绑定与同向向量解析**：`diagramVerification.ts`（`candidateConics`、`selectConicForObligation`）与 `planCompiler.ts` 实现按 `entityId` / 标签 / 作用域状态的稳定绑定，拒收重复候选（`binding_ambiguous`）、缺失实体（`entity_missing`）及跨问/跨状态混绑（`binding_scope_mismatch`），并兼容 `"双曲线C"` 标签归并与 `pointOnConic` 单条异族失败；`diagramObligations.ts` 新增 `resolveDirectedVectorRatios`（`splitPoint: true`）、放宽省略 `/1` 的标准圆锥方程并修补 `leftover` 原文诊断与 `reasonCode`。
- **验证**：`conicFromFocusEccentricity` / `pointOnConic` / `diagramEntityBinding` / `diagramSourceDiagnostics` / `diagramVerification` 5 文件 94 项通过，全量 Vitest **531 文件 / 5643 passed | 1 todo**、`typecheck`、`lint`（0 errors / 33 既有 warnings）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P3 / T05实体绑定与诊断证据](audit/2026-11-16-p3-entity-binding-diagnostics/README.md)。

## 2026-11-16 —— P2 / T04 表达式 AST、定义域保留与符号圆锥曲线契约

- **RED 复现与根因确认**：在 `latexNormalisation.chain.test.ts`、`symbolicConicContract.test.ts` 与 `obligationIR.test.ts` 构造 12 项失败契约，实测 RED `3 files failed | 12 failed | 28 passed (40)`，确认 `x^{4}-2x^{3}` 与 `\frac{x^{2}}{m^{2}}` 降级缺失、`expression.ts` 缺少预算与未化简定义域提取、`conic-parameters.ts` 缺少符号圆锥轴向/欠定/渐近线相切求解，以及 `GK-P01` / `GK-P08` 在 `ObligationIR` 中缺失域与符号信息。
- **LaTeX 迭代降级与有界 AST**：`latexNormalisation.ts` 在 `lowerMathGroupsTracked` 迭代处理 `^{n}` 并修正闭花括号区间映射；`expression.ts` 实现 `MAX_EXPRESSION_LENGTH=512` / `MAX_EXPRESSION_DEPTH=24`、Unicode 幂/隐式乘法（仍拒收 `foo(x)` 等未知函数）、`extractExpressionDomains`、`evaluateExpressionWithDomain`（不化简 `x/x`、`x=0` 除零报错）及 `parseRelationConstraint` / `evaluateRelationConstraint`。
- **一般化符号圆锥曲线与 IR/核验接通**：`conic-parameters.ts` 实现 `parseSymbolicConicEquation` 与 `solveSymbolicConicContract`，区分主轴/轴对调与欠定状态（绝不猜测 `a=2`），并通过一般二次相切方程、`conicResidualAt` 与切点回代完成独立校验；`diagramObligations.ts`、`claimEvidence.ts`、`obligationIR.ts` 与 `diagramVerification.ts` 接通 `parameterDomain` / `symbolicConic`（单问 off-path 黄金 JSON 零变化）；静态无 `eval` 源码检查置于 `drawingContracts.test.ts` 以维持 `@draw/agent-core` 纯 TS 无 Node 依赖。
- **验证**：定向 9 文件 252 项通过，全量 Vitest **529 文件 / 5634 passed | 1 todo**、`typecheck`、`lint`（0 errors / 33 既有 warnings）、Web 构建与 `eval:reliability -- --offline` 全部通过。证据见[P2 / T04符号圆锥曲线与AST证据](audit/2026-11-16-p2-symbolic-conic-ast/README.md)。

## 2026-11-16 —— P2 / T03 比例/位置语义分离与完整角等式链解析

- **RED 复现与领域纠偏确认**：在 `lengthEquality.test.ts`、`diagramObligations.test.ts` 与 `diagramVerification.test.ts` 补齐反例与纠错说明，实测 RED `3 files failed | 9 failed | 197 passed (206)`，确认裸 `DE=2EA` 仍误标 `splitPoint: true`、`GK-S06` 仅读右端 `∠ADC=60°` 而残留 `"∠ADB="`、`∠ADB=∠ADC` 与显式弧度 `(0, π)` 缺解析。
- **比例与位置彻底解耦**：`lengthEquality.ts`（`relationsOf`）与 `diagramObligations.ts`（倍数比读取器及删除末尾 `sizedSegments` `splitPoint` 补丁）将所有解析产生的 `segmentRatio` 统一为 `splitPoint: false`；`diagramVerification.ts` 收紧为仅当显式传入 `item.splitPoint === true` 时核验共线分段，并补齐 `E在DA线段内` / `E在线段DA内` 为明确 `pointOnSegment`（保持 `"E 在 AB 上"` 歧义不猜边界）。
- **完整角链与单一边界转度**：新增 `packages/agent-core/src/relationChains.ts`（`parseAngleChains`、`STATED_VERTEX_ANGLE`），先于句型匹配消费角等式链，将 `∠ADB=∠ADC=60°` 拆为两条带完整 `sourceSpan` 与 `chainIndex` 的 `planarAngle`、新增 `equalAngle` 支持无数值等角链并打通 `claimEvidence.ts` / `obligationIR.ts` / `diagramVerification.ts`（抽出单一 `planarAngleDegrees` 计算边界），严格拒绝截断右侧（`∠ADB=`）、长度=角度（`∠ADB=AB` / `AB=∠ADC=60°` / `AB=60°`）、缺失单位与度/弧度混用。
- **验证**：`relationChains.test.ts`（3 passed）、`lengthEquality.test.ts`（27 passed）、`diagramObligations.test.ts`（109 passed）、`diagramVerification.test.ts`（70 passed）、`obligationIR.test.ts`（14 passed）、`planCompiler.offPath.golden.test.ts`（13 passed）合计 6 文件 236 项通过；全量 Vitest **528 文件 / 5620 passed | 1 todo**、`typecheck`（0 errors）、`lint`（0 errors / 32 既有 warning）、Web 构建（636 modules）、`eval:reliability -- --offline`（3 passed）全部通过。证据见[P2 / T03关系语义与角链证据](audit/2026-11-16-p2-relation-chains/README.md)。

## 2026-11-16 —— P1 / T02 ProblemContract、来源映射、作用域隔离与无损 ObligationIR

- **RED 复现与安全缺口定位**：建立 `problemContract.test.ts` 与 `obligationIR.test.ts` / `promptNormalization.test.ts` RED 用例，实测确认 `toLegacyObligationSet(parsed.ir).parts` 丢失返回 `undefined`、`selectedPart: 2` 选问隔离未打通（遗漏 `AD⊥DC`）、`NormalisationApplication.sourceMap` 缺失，并覆盖第 (1) 问前提漏检与 `"任取一点P"` 未识别等边缘场景。
- **单一 `ProblemContract` 与 UTF-16 来源映射**：在 `latexNormalisation.ts` 新增 `normalizeGeometryPromptWithSourceMap` / `mapNormalizedRangeToOriginal` 并让 `normalizeGeometryPrompt` 同源复用；在 `promptNormalization.ts` 输出 `NormalisationApplication.sourceMap`（`mapEditedRangeToOriginal`），并拒绝将待求目标混入前提、降级自由点或篡改小问编号的改写。新增 `packages/agent-core/src/problemContract.ts`（`buildProblemContract`、`resolveEntityBinding`、`recordModelProposal`、`isContractStale`），统一 `A1` ↔ `A₁` 规范别名归并、折前 `D@s0` / 折后 `P@s1` 与同显示名跨 state 歧义检测（未指定 `stateId` 返回 `ambiguous`），显式阻断模型自选参数（如 `a=2`）升级为原题给定前提，并在改题或缺来源旧合同时显式失效/阻断证书。
- **`R01-B` 选问隔离与 `ObligationIR` 无损往返**：扩展 `numberedProblem.ts`、`diagramObligations.ts`、`claimEvidence.ts`、`obligationIR.ts` 与 `planCompiler.ts`，保留 `shared` / `subquestion:N` 作用域与 `selectedPart` / `selectedScopeId` 选问隔离（仅 `shared` 在多问含前提题面下显式标 `partial`），实现 `toLegacyObligationSet(ir).parts` 无损往返且单问路径维持 R6 / off-path 黄金 JSON 零变化。
- **验证**：`problemContract.test.ts`（7 passed）、`obligationIR.test.ts`（14 passed）、`promptNormalization.test.ts`（23 passed）、`planCompiler.subquestionCoverage.test.ts`（9 passed）、`planCompiler.offPath.golden.test.ts`（13 passed）全部通过；全量 Vitest **527 文件 / 5611 passed | 1 todo**、`typecheck`（0 errors）、`lint`（0 errors / 32 既有 warning）、Web 构建（635 modules）、`eval:reliability -- --offline`（3 passed）与 `test:docs` 通过。证据见[P1 / T02契约证据](audit/2026-11-16-p1-problem-contract/README.md)。

## 2026-11-16 —— P0 / T01 36 题黄金作图契约冻结与统一评测口径

- **RED 复现与黄金契约冻结**：依据 [`manifest.json`](audit/2026-11-15-drawing-baseline/manifest.json) 生成 `test-fixtures/reliability/drawing-contracts-36.json`（固定 `denominator = 36`），逐字匹配原文与 UTF-8 SHA-256 `inputHash`/`sourceHash`，并为每条必需义务绑定精确原文下标 `sourceSpan`。显式修正基线 `JT-P08` 仅点在椭圆而未校 `C - E = 2(F - C)` 的判据缺口，同时为 `GK-S05 (2)` 与 `JT-P06 (2)` 标注不可行分支与诚实披露要求，独立审阅状态如实标为 `pending_second_reviewer`。
- **契约校验器与统一报告接入**：新增 `scripts/reliability-eval/drawingContracts.ts` 与 `scripts/reliability-eval/drawingContracts.test.ts`（先因缺少实现模块与声明 RED，后 GREEN 8/8 通过），验证篡改题干拒收、缩分母 `< 36` 拒收、`GK-S02` 缺 `E/F/P` 失败、`JT-P08` 假反例捕获、`JT-P06` 伪造拒收与诚实披露通过、`incomplete` 不缩分母以及基线保存档案 `25/36` 草稿、`4/36` 旧 host、`null` 完整证书与 `8/36` 局部 exact 重建；更新 `scripts/reliability-eval/runner.mjs`（新增 `runner.d.mts` 与 `scripts/nodeTypes.d.ts` `node:crypto` 声明）与 `reliabilityEval.eval.test.ts`，输出 `reliability-summary.v2`（含固定分母、`objectCoverage`、`obligationCoverage`、失败分桶、`requests`、`tokens`、`costUsd: null`、`costKnown: false`）。
- **验证**：`drawingContracts.test.ts` + `finalOutcome.test.ts` 12 passed；`eval:reliability -- --offline`（`dev-smoke` 3 passed）、`eval:reliability -- --replay`（3 passed）、`eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`（3 passed，`denominator=36, ran=36, passed=1 (GK-S01), partial=2, failed=33, incomplete=0, requests=36, liveWrites=0, costKnown=false`）；`typecheck`、`lint`（0 errors / 32 既有 warning）、Web 构建（634 modules）与全量 Vitest **526 文件 / 5600 passed | 1 todo** 通过。证据见[P0 / T01契约与口径证据](audit/2026-11-16-p0-drawing-contracts/README.md)；第二位独立审阅者复核待补。

## 2026-11-16 —— R11 干净依赖、公告处置与 Rust 审计缺口（G2 闭环）

- **基线公告与工具核查**：确认 `--omit=dev` 为 0 漏洞，全量存在 14 个受影响包（3 High / 11 Moderate）；宿主机 `npm.cmd ls vitest` 因混合 `.pnpm` 安装与 `package-lock.json` `vitest@4.1.11` 漂移而报错；`cargo audit --version` 返回 `no such command: audit`，显式按 `unknown` 记录 RustSec 工具缺失。
- **最小兼容更新与例外台账**：在 `.worktrees/r00-node22`（Node `v22.23.5` + npm `11.16.0`）执行兼容升级并提高 `package.json` 下限至 `eslint@^10.15.0`、`typescript-eslint@^8.72.2`、`vite@^7.3.8`、`vitest@^4.1.12`，同步解决 `source-map-js@1.2.2` 与 `zod@4.6.7`。修复后清零全部 3 项 High 及可修 Moderate，仅余 `@typescript-eslint/typescript-estree@8.72.2 -> minimatch@10.2.6`（`GHSA-g3hv-75wg-m249`，Moderate），已建立适用性/缓解/责任人/2026-12-31 到期台账。新增 `scripts/ci/dependencyLockPolicy.test.ts` 先对旧锁文件复现 RED，同步后转 GREEN。
- **隔离 Node 22 全量实测**：修复 `draftStorage.test.ts` 与 `useDraftPersistence.test.tsx` 在 Node 22 jsdom 下的 `Storage.prototype` spy 兼容性并在 Node 22 / Node 26 双环境通过；隔离 `npm ci`、`npm ls --depth=0`、类型检查、Lint（0 errors / 16 warnings）、Web 构建（634 modules）、`eval:reliability -- --offline`、`eval:explicit-solid -- --offline`、`licences:scan`（550 crates）、全量 Vitest、全量 Rust（317 passed / 4 ignored）与全量串行 Playwright E2E（286 passed / 14.0m）全部通过。证据见[R11干净依赖与审计记录](audit/2026-11-15-clean-dependencies-and-audit/README.md)。

## 2026-11-16 —— R09-B Schema 与运行时叶子约束同源及明确降级清单

- **RED 基线实测失败 8 项**：运行 `schemas.test.ts` 与 `modelPlanner.test.ts` 确认 7 项运行时叶子漏检（ASCII/Unicode/零宽空白 `actionKey` 被接受、`normalisations` 未知字段放行）与 1 项真实 `buildPlanToolSchema` 差分对照不一致（发布的 `actionKey` / `factIds` 缺少长度与非空白约束）。
- **单源叶子契约与差分验证**：在 `schemaReaders.ts` 新增 `LEAF_CONSTRAINTS`、`stringLeafJsonSchema`、`stringArrayJsonSchema`、`readStringLeaf` 及覆盖零宽占位符的 `trimUnicodeBlank` / `isBlankText`；在 `actionSchemas.ts` 收敛动作字符串叶子并新增 `planActionToolItemSchema`，消除 `modelPlanner.ts` 内 `buildPlanToolSchema` 手写分支；在 `schemas.ts` 将 `actionKey` 与 `normalisations`（含 `rejectUnknownFields`、边缘去白与全空白拒收）接回同一叶子约束；新增 `PROVIDER_SCHEMA_UNSUPPORTED_KEYWORDS` 与 `degradeJsonSchemaForProvider` 明确宣布远端关键字退化边界及运行时兜底责任。不额外安装 `ajv`，直接使用 `validateJsonSchemaSubset` 覆盖真实 `buildPlanToolSchema` 输出。
- **验证**：定向 `schemas.test.ts`、`actionSchemas.test.ts`、`actionFieldParity.test.ts`、`modelPlanner.test.ts` 4 文件 / 169 passed；`eval:reliability -- --offline` 3 passed；`typecheck`、`lint`（0 errors / 32 既有警告）、Web 构建（634 modules）与全量 Vitest **524 文件 / 5590 passed | 1 todo** 全部通过。证据见[R09-B Schema与运行时同源记录](audit/2026-11-15-schema-runtime-leaf-consistency/README.md)。

## 2026-11-16 —— R08 E2E 与生产 UI / 合同重新对齐

- 对基线 E2E 失败与全量串行重跑逐项分类，区分生产缺陷、设计契约迁移与过期定位器，不跳过用例也不开启静默重试：
  - **生产外接球/直三棱柱路线修复**：`parametricSolidPlan.ts` 保留 `外接球` / `内切球` 派生动作，`planCompiler.ts` 在 `compilePlanOnce` 补充 `derivedCircumsphereAssumptions` 内核计算披露（`parametricSolidPlan.test.ts`、`planCompiler.test.ts` 114 passed 与 `agentRuntime.test.ts` 90 passed 验证）；新增 `rightPrismPlan.ts` `tryBuildRightPrismMidpointsPlan` 并在 `deterministicProblemRoute.ts` 接入，沿用分问剥离模式而不放宽 R01-A `diagramObligations` 守卫（`problem-image-reader.spec.ts` 2/2 通过）。
  - **真实 UI 叠放缺陷修复**：发现存在 `AI 草稿预览` 横幅（`z-index: 50`）时，`.clean-chrome`（`z-index: 20`）内的 `工具菜单` 被拦截遮挡，提升 `.clean-chrome` 至 `z-index: 100`。
  - **共享页面对象与契约对齐**：新建 `e2e/pages/MathCanvasPage.ts`，统一 `模型服务 → 高级 → 实验性功能`、`AppChrome` 工具栏/菜单与顶栏 `保存 .mgeo` 入口；对齐 `310px` 桌面检查器宽度契约、`LineBasicMaterial` 网格契约与空白背景拖转视角，更新 `agent-derived-sphere.spec.ts` 按真实顶点标签拖转 `P`。记录 `WorkspaceTabs.tsx` 为 legacy-compat（仅保留给 `WorkspaceTabs.test.tsx`）。
- 验证：全量串行 `npx playwright test --workers=1 --retries=0` 达 **286 passed / 0 failed (13.4m)**；默认 16-worker 并发 `npm.cmd run test:e2e` 达 **282 passed / 4 failed (4.2m)**（4 项均为高并发下 5s/30s 超时）；完整 Vitest 524 文件 / 5580 通过 + 1 todo；类型检查、Lint（0 errors / 32 既有警告）与 Web 构建（634 modules）通过。证据见[R08 E2E 与 UI 对齐记录](audit/2026-11-15-e2e-ui-contract-alignment/README.md)。

## 2026-11-16 —— R07 函数相关义务统一绑定与题图结构化复核

- 先补全 R07-A 与 R07-B RED 用例并复现6项预期失败：存在辅助曲线时 `functionLineIntersections` 返回 `unverified`、`g(x)` 未进入 `functionGraph` 解析且切线未核验曲线归属；根式/LaTeX分式/不确定坐标被 `addCoordinateReview` 跳过，且 `AB∥CD` / `AB与CD相交于E` / `AB和CD是两条棱` / 伪造 `kind:"label"` 直接通过黑名单进入确定性事实。
- R07-A 在 `diagramObligations.ts` 与 `diagramVerification.ts` 支持 `[fgh](x)` 函数定义与带函数名切线句子，扩展 `statedCurveNames` / `selectStatedCurve` 至 `functionGraph`、`functionLineIntersections` 与 `tangentAt`（按 `sourceId` 匹配绑定曲线，拒绝跨曲线切线与重名/多候选猜测），并在 `commonTangent` 校验配对图元 `id` 一致性。
- R07-B 在 `problemImageReader.ts`、`problemImageReview.ts`、`problemImagePrompt.ts`、`ProblemImageComposer.tsx` 与 `agentRunner.ts` 实现基于内容分类的结构白名单、`addCoordinateReview` 形态与数值语法解耦、`computeReadingRevision` 与摘要/来源证明绑定、重复观察 ID 阻断、改字清空旧确认及 `splitImagePrompt` / `agentRunner` 装配层二次拦截。
- 定向与组件回归 6 文件 / 152 项全部通过；完整 Vitest 524 文件 / 5577 通过 + 1 todo；类型、Lint 与 Web 构建通过。既有用例 `e2e/problem-image-reader.spec.ts` 在第 1 条确认题图 UI 复核交接正常，随后因既有 `PRISM` 未选定 `(2)` 小问被 R01-A 阻断，留交 R08 统一对齐 E2E 合同。证据见[R07曲线绑定与题图复核记录](audit/2026-11-15-image-review-and-curve-binding/README.md)。

## 2026-11-16 —— R06 草稿写保护与 CSV 文本安全（G1 闭环）

- 以等号/加号/减号/@ 与前导空白/制表换行触发电子表格公式注入及 `:unreadable` 备份写入异常/静默篡改丢草稿为RED。
- 在 `exporters.ts` 导出 `csvCell`，对不可信字符串命中 `/^[\s\u00a0]*[=+\-@]/` 或 `/^[\t\r\n]/` 的单元加单引号 `'` 前缀，同时保持负数数值（如 `-2`）和布尔值原样导出；无损工程仍通过 JSON `save` 通道保留。
- 在 `draftStorage.ts` 新增 `loadDraftRecovery` 与 `discardDraft`：`:unreadable` 写入后必须经 `getItem` 回读内容一致才删除主草稿键，否则返回 `backup_failed_readonly` 并完整保留损坏主键；在 `useDraftPersistence.ts` 以 `protectedDraftsRef` 仅锁定只读受保护工作区的自动保存，不影响健康工作区，并在 `App.tsx` `.footer-note` 提供原始损坏草稿下载与需 `window.confirm` 二次确认的放弃解锁按钮。
- 定向 `exporters.test.ts` 19项、`draftStorage.test.ts` 13项、`useDraftPersistence.test.tsx` 17项（共49项）全部通过；完整Vitest 522文件/5570通过+1todo；类型、Lint（0 errors，32既有警告）、Web构建（634 modules）通过。证据见[R06草稿与CSV记录](audit/2026-11-15-draft-and-csv-protection/README.md)。

## 2026-11-16 —— R05 归档资源边界与安全解码

- 以低限额和CRC观察者证明预扫描先于分配：重复名、共享offset、重叠记录、字段不一致与聚合超限均在CRC前拒绝；本地头偏移修正未放宽判据。
- 原包、聚合、单条、条数和附件分别设限；实际文件读取采用 `max+1`，manifest附件在blob读取前拒绝，base64在输出分配前检查形状与预算，前端在 `FileReader` 前检查大小。
- 项目包41项、前端20项通过；完整Rust 317项通过+4ignored；Vitest 522文件/5562通过+1todo；类型、Lint、Web构建通过。未运行大包或外部恶意输入。证据见[R05归档资源记录](audit/2026-11-15-archive-resource-limits/README.md)。

## 2026-11-15 —— R04 原生导出授权与原子写入

- 删除任意路径 `write_to_file`，导出IPC只接受 `fileName`，原生固定应用数据 `exports` 根目录。严格文件名拒绝穿越、UNC、设备名、ADS、点段和错误后缀。
- 随机 `create_new` 临时文件、`sync_all` 与同目录 `hard_link` 不覆盖提交保证旧目标字节不变；失败仅清理本次临时文件。Windows `mklink /J` 实测拒绝junction导出根，目标外无文件。
- 前端只记文件名，完整路径仅用于结果展示；服务与面板共18项通过，项目包33项及junction精确用例通过。
- 完整Rust 310项通过+4ignored；Vitest 522文件/5560通过+1todo；类型、Lint、Web构建通过。证据见[R04导出授权记录](audit/2026-11-15-export-authorization/README.md)。

## 2026-11-15 —— R03 URL/DNS与有界响应

- 以IPv6、映射私网、CGNAT、local/LAN越界和跨端口重定向为RED，使用 `reqwest::Url` 和统一IP分类替换手写host解析；local仅允许回环，重定向比较包含有效端口。
- 非2xx响应不再 `response.text()` 完整缓冲：Content-Length预检、chunked扩展前累计字节检查、4096字节硬上限与取消感知流式读取；短UTF-8诊断保持兼容。
- `ProviderRequest` 携带networkPolicy，resolver全部候选通过后才由 `resolve_to_addrs` 固定连接；混合候选拒绝、local公共候选拒绝，合法域名只解析一次且Host不变。未使用外部DNS或真实provider。
- 验证：R03定向7/7，受影响Rust 155项通过+1ignored；完整Rust 307项通过+4ignored；Vitest 522文件/5560通过+1todo；类型、Lint、Web构建通过。证据见[R03网络安全记录](audit/2026-11-15-network-security/README.md)。

## 2026-11-15 —— G1/G2启动与R02凭据安全

用户确认新goal：依次完成G1（R02–R06）与G2（R07、R08、R09-B、R11），不进入P0–P8、R12、付费provider或发布。

- R02先以跨profile、跨endpoint和旧三段补偿为RED，确认原生存储与发送均存在旁路。实现profile归属校验、规范化endpoint绑定、Rust版本化密钥槽及无明文恢复记录；无可信绑定的旧凭据必须重新输入，不能自动跟随手改host。
- 原生事务以fake store和临时目录覆盖成功轮换、CAS、secret写失败、profile写失败、提交前/后崩溃及清理重试；旧upsert走同一事务，legacy写删不能绕过。前端改为单命令，启动时自动恢复。
- 验证：受影响TS 3文件56项通过；定向Rust 104项通过+1ignored；完整Rust 297项通过+4ignored；类型检查通过；完整Vitest 522文件/5560通过+1todo、0失败；Lint 0错误/32条既有警告。未读取真实凭据、未调用外部provider。证据见[R02凭据安全记录](audit/2026-11-15-provider-credential-safety/README.md)。

## 2026-11-15 —— R00、R01-A、R09-A与R10首批实施

用户重新设置目标，只完成 R00、R01-A、R09-A、R10 后停止。先在 `feature/drawing-reliability-execution` 提交并推送文档基线 `3856263f` 与隔离 worktree 忽略配置 `be3f00bf`。

- R00：在 `.worktrees/r00-node22` 使用 Node 22.23.5 / npm 11.16.0 真实执行 `npm ci`，类型检查通过，文档22项通过，完整 Vitest 519文件/5535通过+1todo、0失败。证据见[环境清单](audit/2026-11-15-review-remediation-baseline/environment.json)。首次 npm 路径错误发生在安装前，已记录并纠正，未隐瞒。
- R01-A：新增真实非法四棱锥 compile 负例，裸条件/设/且共6项RED后全部转GREEN；普通单问和若作对照。新增 runtime 集成测试，受控回退旧条件时复现 `awaiting_confirmation`，恢复修复后确认失败且不能提交，主场景零写入。
- 浏览器闭环：四种小问写法均无确认面板且主场景图元为零，普通单问确认提交成功，单 worker / retries=0 共5/5通过。证据见[小问阻断记录](audit/2026-11-15-subquestion-guard/README.md)。最终全量 Vitest 为 520文件/5544通过+1todo、0失败，类型检查通过。R01-A 已完成，下一步只做 R09-A 和 R10，不启动后续阶段。
- R00 与 R01-A 证据分别提交并推送。
- R09-A：新增 `finalOutcome` 按 run/stage/round/contentHash/终态选择唯一最终产物，删除 `rounds.some` 历史答案兜底。双轮正反例、取消、跨run、错误hash、重复身份均通过；离线可靠性3项通过。完整 Vitest 521文件/5548通过+1todo、0失败。证据见[最终产物记录](audit/2026-11-15-final-outcome/README.md)。提交 `addf4c79` 已推送。
- R10：CI顶层权限改为 `contents: read`，11处Action固定到经官方API核对的提交，4处checkout均禁用持久化凭据。静态守卫有效RED为1失败/11通过，GREEN为12/12通过；类型检查通过，完整 Vitest 522文件/5560通过+1todo、0失败。Lint为0错误/32条既有unused警告，其中16条来自隔离worktree；新增文件无警告。证据见[CI加固记录](audit/2026-11-15-ci-hardening/README.md)。本轮在此停止；feature分支未触发远端CI，不启动G1/G2或P0–P8。

## 2026-11-15 —— 59ea3613基线重置与全面修复设计（仅文档）

### 请求与交付

用户要求重置进度并制定尽力接近100%画图能力的全面修复方案。本轮只处理文档、设计和证据整理，不实施产品逻辑。

- 以59ea36133c47971f4252e71f7a0f5ba003dd1028 / v4.3.0为代码基线。
- 三份旧文档原字节归档并记录SHA-256；重写活动进度入口、过程日志和下一轮导航。
- 固化上一轮36题manifest、最终报告、局部oracle和逐题分诊JSON。没有新增模型调用，也没有把保存证据当作P0黄金合同已完成。
- 比较三条路线，推荐模型理解题意、确定性几何构造、独立验收；[设计](superpowers/specs/2026-11-15-drawing-reliability-design.md)及[实施计划](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)均待批准。
- P0–P8功能阶段全部重置为未开始；旧能力不删除，旧计划不覆盖，完整证书与端到端正确率不虚填。

### 证据边界

上一轮25/36草稿、4/36旧宿主/待确认、8/36局部exact并不互相等价；基线缺完整证书且没有真实UI/配图输入。详见[基线审计](audit/2026-11-15-drawing-baseline/README.md)。本轮未重建、未重跑功能/真题/浏览器/真实provider，未提交或推送；不能宣称成功率已提高。

### 本轮文档验证

- 文档一致性：npm.cmd run test:docs -- --testTimeout=30000，退出0，8个文件/22项通过、0失败。
- 归档完整性：三份原件SHA-256与重置前记录相同；与Git HEAD内容仅存在工作区CRLF/Git LF的换行差异。
- 证据副本：manifest、最终报告、局部oracle与各自现场源文件逐字节一致；三组清单及最终报告均覆盖同一36题，题文hash逐条校验。
- 活动文档本地链接、UTF-8/控制字符/阶段计数已自检；Git差异空白检查通过。详细机器记录见[文档核验记录](audit/2026-11-15-drawing-baseline/documentation-verification.json)。
- 归档正文是原件，不按迁移后的相对链接当活动导航；见归档README说明。

这些只验证文档及保存证据，不属于功能阶段完成证据；没有新的成功率成绩。

### 同日方案深化：从阶段路线细化到可执行任务

用户进一步要求完善、全面且能指出具体修改方向和参考建议的实施方案。本次增加[详细实施手册](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)：18个工作包、拟定接口、具体数学构造、RED案例/测试命令、验收与回滚、36题任务映射。

- 直接调用现有解析器完成8个只读探针；不涉及模型、UI或功能修复。确认角链截断、裸比例自动分点语义、IR分问迁移缺口等问题。
- 对GK-P08更正初步推断：圆方程已被读取，诊断空白来自残留遮蔽；不是用户漏题或原式丢失。
- 发现旧局部oracle的一项名称包含比例关系但实际只核点在曲线上，补入黄金合同/独立验收的审查任务；不修改旧成绩。
- 核对25处源码锚点与7份官方参考，明确仅借鉴思想/开发期对照/未来spike三档，不安装新依赖。
- 功能阶段状态不变；未构建、未跑36题新评测、未付费、未提交推送。
- 本次最终文档验证见[深化审计记录](audit/2026-11-15-drawing-implementation-audit/verification.json)。

### 同日：阅读新项目审查并重排下一步实施顺序

- 完整阅读[项目审查报告](audit/2026-11-15-project-review/README.md)，对照17个关键源码/工作流文件，不修改原审查。
- 新增[审查驱动下一步实施方案](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)：R00–R12工作包、G0–G4门禁，覆盖24项审查发现及额外lint警告。
- 把漏小问错误认证、最终轮次评测、原生安全/数据保护与CI信任边界前置；原六题/36题画图扩展仍保留，但不是第一步。
- 纠正活动状态中“E2E未跑”的过时表述：原审查已跑两轮完整E2E且均失败；报告动态结果不是本轮重新执行。
- 保持用户指定59ea3613，不自动同步上游。全部功能任务仍未开始；没有应用报告建议补丁、升级依赖、付费请求或发布。
- 本轮新鲜文档核验见[方案修订记录](audit/2026-11-15-review-plan-response/README.md)。

### 同日：全面总方案与main重启授权

- 用户明确要求全面方案、舍弃后续版本、从当前基线重新提交main。
- 已查询并fetch远端main=d8743a32，59ea3613之后47个旧提交完整保存在本地/远端archive/abandoned-post-59ea3613-20261115，精确清单见[main重启记录](audit/2026-11-15-main-restart/README.md)。这不删除历史，但明确不继承旧线代码/成绩/阶段状态。
- 新增[统一全面实施总方案](superpowers/plans/2026-11-15-main-restart-master-plan.md)，整合版本治理、审查止损、原生安全/数据保护、语义与几何构造、真实交互、评测/依赖/性能/安装发布，以及批次退出和安全回滚。
- 本次提交仅方案、审查、证据与窄范围Git原件换行规则；产品源码不改、付费评测不跑、产品不发布。新提交父节点和同步结果按实际Git回执核验。

### 同日：将已有总方案升级为唯一完整实施主计划

- 不再留下新的同类总方案；直接完善[实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)，增加31项[任务合同](superpowers/plans/2026-11-15-implementation-task-ledger.json)、无环依赖、文件/测试边界、接口/失效规则、阶段指标、提交审阅与安全回滚。
- 以真实compilePlan只读校对4个输入：裸条件/设/且仍错误passed，若为unverified警告；基准文档不变，无provider和提交。这是缺陷复现，不是修复通过。
- 首批计划给出合法顶点/面环和真实接口RED，以及最终接受输出选择的纯函数/双轮计分测试草案；生产runtime/E2E验收明确仍待实施。
- 修正依赖方向：T11数值合同先于新构造器，T18准备发布证据再交R12签收；R01与T02、R07与T05不重复记功。
- 重启main仍为be033b71，代码基线59ea3613；本次没有产品修改、付费、依赖升级、提交或推送。验证见[计划核验记录](audit/2026-11-15-implementation-plan-verification/README.md)。

### 同日：全部进度文档与历史边界对齐

- 只保留current-status.md作为实时状态来源；主计划是唯一执行入口，R/P/T/设计为技术合同附录，机器台账不另维护完成率。
- 活动能力目录、发布门禁和计分卡撤下旧Task 1–21/V0–V3的现行顺序声明，旧记录置于明确历史边界；修正题图强制复核/全题核验等可能夸大当前能力的描述。
- 历史计划、阶段进度和设计文档仅增补历史导航块，不改原正文、日期、勾选或测试数；原审查/评测/发行及归档原件完全不改。
- 统一59ea3613代码基线、be033b71重启提交、旧线47提交舍弃、31工作包与9阶段的区别；功能均未开始，发布仍阻断。
- 本次不改产品代码、不新增模型请求、不跑新功能/E2E、不提交推送；具体对齐范围、正文保真与文档测试见[进度对齐核验](audit/2026-11-15-progress-alignment/README.md)。

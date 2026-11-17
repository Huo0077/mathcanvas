# 审查修复技术附录（R00–R12，59ea3613基线）

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：R00–R12审查修复技术附录；不另定总顺序或完成状态。实时状态仅维护在[当前状态](../../current-status.md)；执行总顺序以[完整实施主计划](2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

**版本事实（2026-11-15对齐）**：代码基线59ea3613、重启提交be033b71；旧范围59ea3613..d8743a32的47提交此前已备份并舍弃。重启提交/同步是已发生的操作，不再作为未来任务反复执行；本文实现细节待实际验收。本次对齐不提交/推送，不包含新功能或付费授权。

> **执行要求**：先读取[原项目审查报告](../../audit/2026-11-15-project-review/README.md)，再按本方案R00–R12逐包RED→GREEN→集成验收。使用writing-plans、systematic-debugging、test-driven-development和verification-before-completion工作方式；未经用户明确要求不派生代理。本文件是待实施方案，不是已应用补丁。

**Goal / 目标**：先堵住错误数学结果认证、原生安全和数据丢失路径，恢复可信的测试与评测，再推进画图能力接近100%的既定目标。

**Architecture / 架构**：在现有题意解析、编译核验、原生IPC/provider/repository和用户确认链上增加保守拒绝与可验证合同；不另造平行系统，不一次性重写。安全门禁先落地、题型扩展后收口。

**Tech Stack**：既有TypeScript/Vitest/Playwright/Tauri-Rust；依赖或Action更新独立评审、在实施时核对，不照抄报告中的版本/SHA作为永久最新值。

**Spec**：[画图总体设计](../specs/2026-11-15-drawing-reliability-design.md)；[原P0–P8阶段计划](2026-11-15-drawing-reliability-repair-plan.md)；[T01–T18实施手册](2026-11-15-drawing-reliability-execution-handbook.md)。本文件提供R任务的修改方向和安全负例；总顺序、跨任务依赖及发布前提服从完整实施主计划，原画图手册提供T任务细节。

日期：2026-11-15。目标基线：59ea36133c47971f4252e71f7a0f5ba003dd1028，v4.3.0。

**状态（与[当前状态](../../current-status.md)同步）：`R00–R11` 已按主计划与 G1/G2 实施收口，`G3-Math`（36/36）与 `T15/T16` 浏览器端及 `@draw/desktop` `no-bundle` 构建已通过；DeepSeek 真实模型画图测试按用户指示保留后续执行，非沙盒桌面交互走查、人工签收与 `P8` 未闭环，仍不得发布；本文件作为技术附录保留。** 审查报告中的P0–P3与旧画图P0–P8含义不同，本文件用R任务/G门禁消除编号冲突，不把审查完成计入修复完成。

## 1. 本次审查带来的实质改变

### 1.1 不再把所有问题称为“支持不足”

- **C1已由审查真实源码探针确认错误放行**：后续小问不以若/如果/假设/另设开头时，条件被吞入目标字符串。满足PA=2但AD·DC=1的图仍得到compile ok与diagram passed。不是简单的漏支持，应首先修复。
- **H1/H2/H3是原生安全边界**：凭据转发、未授权路径写入、归档聚合内存放大。H1需要renderer/IPC被控制，不虚构远程无认证攻击；H3理论路径已明确但没有运行破坏性大包。
- **完整E2E已跑且失败**：审查报告第一轮235通过/46失败，第二轮232通过/49失败；单worker定向10通过/3失败。不能继续把项目现状写成“E2E未跑”，也不能将全部失败归结为产品bug或全部归结为环境。
- **测试判定本身需要修复**：旧答案可替最终答案过关（L2）、旧UI定位器、过时宽度/网格期望、夹具披露不等于生产披露。
- **保存和恢复先于能力扩展**：旧凭据回滚丢失、草稿唯一副本覆盖，会让修复后的作图流程仍不可靠。

以上结果引用原审查，**不是本轮重新执行那些测试**。本轮核对源码并修改文档；未发起模型调用、未应用产品补丁、未执行攻击性测试。

### 1.2 对原方案的调整

| 原做法/表述 | 修订后 |
| --- | --- |
| 先完整审核36题，再开始所有修复 | 黄金合同继续做；C1最小阻断不等待36题全部审核或大IR重构 |
| 小问主要是IR迁移缺口 | 新增源解析层漏条件错误放行；从解析到确认三层加反例 |
| 验收覆盖不足，尚无已证实错误放行 | 保留局部oracle限制，但明确新增C1已证实，撤回全局“未证明错误放行”表述 |
| 生产安全主要指草稿提交/CAS | 扩充原生凭据、网络、文件、归档和恢复边界 |
| 最后才处理评测/CI | L2最终轮次判定和CI最小权限前置；否则错误分数/不可信CI会误导修复 |
| 第一批先角链、比例、六题切片 | 先R00/R01及R09最终轮次；随后高危/数据保护，再继续六题切片 |

## 2. 基线与全局约束

1. **继续59ea3613并舍弃旧后续线**：本次已实际fetch/查询，确认旧远端main=d8743a32，47提交已完整备份并标记不继承。main重启提交/同步按用户授权执行，不merge旧线、不换产品基线；后续选补丁仍需单独批准与逐项复现。
2. **不覆盖工作区**：保留已有未提交文档、审查报告、36题与诊断证据。清理后的缓存可能被审查重建，这是正常产物，不把旧清理后的体积当现状，也不为本任务再次清理。
3. **拒绝优先，但不谎报成功**：短期因范围不明确要求选问会降低旧“通过率”，接受这种真实降幅；澄清/阻断不是画图成功。
4. **原生边界不信renderer**：profile权限、rekey、保存路径和大小上限在Rust端落实；前端提示只改善体验，不能构成授权。
5. **无破坏性验收**：小型合成包、mock密钥库/解析器/transport、临时测试目录；不读真实密钥、不访问真实恶意服务、不运行256GiB内存测试。
6. **当前单机串行重负载**：Rust重建与完整E2E不要同时跑，审查已有LNK1102内存不足。可独立跑的轻量单测不必等待完整构建。
7. **干净环境另建**：Node22、与CI一致的包管理策略、lockfile驱动安装在隔离工作区完成，保留活动node_modules。npm ci --dry-run不能冒充实际干净安装，ignore-scripts不能冒充正常构建通过。
8. **不得重新开放已知漏洞作为回滚**：安全修复有问题时关闭相应入口/保持拒绝，不能回滚成任意路径写入、跨profile密钥引用或错误数学放行。
9. **真实provider、费用与发布另批**：新门禁未满足前不做付费成功率冲刺或产品发布。本次用户追加授权仅覆盖main重启提交/同步，不代表授权实施产品补丁或发行。

## 3. 顺序与门禁

| 门禁 | 对应任务 | 必须看到的证据 | 不代表什么 |
| --- | --- | --- | --- |
| G0 基线与错误认证阻断 | R00、R01、R09的L2部分 | 漏条件负例不能passed/进入确认；最终错误计划不能被旧答案救过 | 不代表数学能力已提高或可发布 |
| G1 原生安全/数据保护 | R02–R06、R10 | 凭据/网络/文件/资源/草稿/CSV负例与合法回归 | 不代替浏览器/盲测 |
| G2 可相信的产品与评测 | R07–R09、R11 | 当前UI合同明确、生产披露补齐、干净环境完整测试与审计闭环 | 不代表任意题100% |
| G3 画图能力收口 | 原T01–T17，复用R任务接口 | 36题完整数学/真实画布/交互合同，未见题统计 | 不可绕过G1/G2直接发布 |
| G4 发布候选 | R12、原T18 | 全部严重项闭环、性能/安装/回滚/费用证据与人工批准 | 未执行项不能由历史报告补齐 |

**执行不是机械瀑布**：R01和R09最终轮次优先落地；R10在任何包含敏感上下文的新CI运行前完成。原生与几何模块可分批推进，但共享文件由一个负责人顺序整合。本轮没有并行代理授权。G3的离线研究可在G1处理中继续，但付费/发布仍被门禁阻断。

## 4. 审查问题完整映射

C1为报告第3节的计划别名；I1–I3对应报告INFO三项；W1是补充lint警告，不改变报告1 critical/4 high/11 medium/5 low/3 info计数。

| ID | 报告节 | 修复任务 | 退出门禁 | 最低验收 |
| --- | --- | --- | --- | --- |
| C1 | 3 | R01 | G0 | 裸条件/设/且变式的错误候选不能passed或进入确认 |
| H1 | 4.1 | R02 | G1 | 跨profile引用、端点切换与重定向不能转发旧密钥 |
| H2 | 4.2 | R04 | G1 | 无原生授权不能写任意路径；目标外无新文件 |
| H3 | 4.3 | R05 | G1 | 重叠/重复offset及超聚合预算在CRC/克隆前拒绝 |
| H4 | 4.4 | R10 | G1 | 上游身份与完整SHA核验，CI固定到不可变提交 |
| M1 | 5.1 | R07 | G2 | 所有函数义务按同一实体绑定，辅助曲线不改变正确结论 |
| M2 | 5.2 | R07 | G2 | 未知/连接类观察默认待核对，未确认不进入prompt |
| M3 | 5.3 | R06 | G1 | 不可信文本前缀安全，可信数值负数保持数值 |
| M4 | 5.4 | R02 | G1 | 新建/编辑/换端点失败及崩溃后旧凭据可恢复且不外泄 |
| M5 | 5.5 | R06 | G1 | 配额异常后原键不被自动保存覆盖，重载仍保护 |
| M6 | 5.6 | R03 | G1 | 公共地址解析固定，私有/映射地址及重绑定被拒绝 |
| M7 | 5.7 | R03 | G1 | 限长/取消先于扩容，chunked及压缩展开同样受控 |
| M8 | 5.8 | R08 | G2 | 宽度和网格明确裁决；内核外接球披露来自生产数据 |
| M9 | 5.9 | R08 | G2 | 当前可访问契约和Page Object复用，不靠延时重试过关 |
| M10 | 5.10 | R10 | G1 | contents read默认、job额外权限有依据 |
| M11 | 5.11 | R11 | G2 | 独立更新锁文件、干净安装及审计闭环 |
| L1 | 6 | R09 | G0/G2 | 空白/长度/可选字段差分测试并固定支持子集 |
| L2 | 6 | R09 | G0 | 只对最终接受计划/候选判定；两轮正反例齐全 |
| L3 | 6 | R05 | G1 | 编码长度预检、受限解码、前端读取前校验 |
| L4 | 6 | R10 | G1 | 所有Action固定SHA，checkout不持久化不需要的token |
| L5 | 6 | R12 | G4 | 冷启动/首次作图实测对比，无功能或取消链退化 |
| I1 | 7 | R00 | G0 | 沿用用户指定59ea3613；迁移需另批，不自动pull |
| I2 | 7 | R00/R11 | G0/G2 | Node22/npm锁文件隔离验证，不清洗活动工作区 |
| I3 | 2.2/7 | R11/R12 | G2/G4 | 未执行项明确标记；禁止用历史结果填补 |
| W1 | 6 | R12 | G4 | 逐项确认无用再移除，不关闭规则或删除有用测试 |

机器映射见[finding-task-map.json](../../audit/2026-11-15-review-plan-response/finding-task-map.json)。每个问题必须有关闭证据或明确未解决；“已写方案”不是关闭状态。

## 5. 每个工作包的执行纪律

- [ ] 固定复现输入、源码/锁文件/环境版本，写出预期负例结果。
- [ ] 运行RED并确认失败原因；没复现就补诊断，不猜补丁。
- [ ] 最小实现并接入真实生产路径，避免只改fixture或评测脚本。
- [ ] GREEN + 正例兼容 + 故障注入/反例 + 受影响集成；记录退出码和跳过项。
- [ ] 检查回滚是否重新开放漏洞；必要时关闭入口而不是恢复不安全行为。
- [ ] 更新唯一进度入口，保留审查原文，另写关闭证据；获得提交授权后小步提交。

下列新增文件/API是**拟新增**，必须在实施时建立；其余路径均指仓库现有文件。命令在内层仓库执行，命令出现在计划不表示本轮已执行。

## R00 — 锁定基线、证据与可复现环境

**对应**：I1/I2，原T01。**依赖**：无。

**文件/产物**：保留审查README和全部原评测JSON；拟新增docs/audit/review-remediation-baseline/中的revision、lockfile hash、环境清单和逐项执行记录。不直接修改package-lock以模拟环境一致。

**输入→输出**：用户指定59ea3613、当前工作区和审查证据 → 可复算的修复起点/隔离环境。

- 记录HEAD、未提交差异、Node/npm/Rust/Playwright实际版本和安装来源，区分活动工作区与隔离测试环境。
- 实施前对上游补丁只作审查快照对照；若迁移基线，需用户另行选择并重新绑定全部证据。不能据“47提交”直接假定上游已经修好。
- 新测试保留在当前工作区后，隔离环境应包含同一修复diff而非仅checkout旧HEAD；固定锁文件，用Node22进行实际npm ci和测试。
- 全量Rust/E2E分开运行，保留初次失败和串行重跑两份日志。

**RED/验收**：环境清单缺lock hash或报告revision与构建不一致时验收脚本拒绝；完成后可准确回答“哪份源码、哪份依赖产生这份报告”。迁移/清理/付费不自动执行。

## R01 — 立即阻断漏小问条件的错误认证

**对应**：C1；原T02/T13/T14。**依赖**：R00基本快照，不等待完整36题黄金合同。

**修改**：packages/agent-core/src/numberedProblem.ts、diagramObligations.ts、obligationIR.ts、planCompiler.ts；按真实调用补draftStore/agentRunner确认门禁。
**测试**：扩展diagramObligations.test.ts、obligationIR.test.ts；拟新增planCompiler.subquestionCoverage.test.ts、e2e/agent-subquestion-guard.spec.ts。

### R01-A 最小止损补丁

识别到多问而未明确选问时，保留公共/各问原文和unverified标记，绝不允许遗漏条件后仍标passed。审查给的diff只是解析侧思路，**只添加warning不够**：必须走compile→runtime→draft→确认，断言不可确认且主场景零写入。可以展示未验公共底图，但标记partial/blocked，不展示完整通过或普通确认入口。

给已识别多问无条件分scope，而不是仅“若/如果/假设/另设”；暂不能可靠识别的编号/分隔写法不能靠首个“证明”把后文吞掉。增加检测到多问迹象但scope无法建成的明确unknown，不盲目把任何括号数字当小问。

**必须保留的RED形状**：

~~~ts
import { describe, expect, it } from "vitest";
import { parseDiagramObligations } from "./diagramObligations";
describe("later subquestion conditions are not silently swallowed", () => {
  it.each(["", "设", "且", "若"])("prefix %s", prefix => {
    const source = "四棱锥P-ABCD中，PA=2。（1）证明AD∥平面PBC；（2）"
      + prefix + "AD⊥DC，求AD。";
    const parsed = parseDiagramObligations(source);
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.unverified.length).toBeGreaterThan(0); // 未选问的临时护栏
  });
});
~~~

再用审查的合法四棱锥候选PA=2、AD·DC=1，实际compile不得passed；真实runtime不进入awaiting_confirmation，可确认草稿计数0、sceneWrites=0。同时测试满足第二问的候选在**明确选择第二问且具备完整覆盖**后能够通过，避免全部拒绝造成假安全。

### R01-B 完整scope，避免临时护栏永久阻断

在既有IR上添加shared/part/branch关系、已选scope和源映射，编译与证据hash携带scope。只选择（1）时不强加（2）条件；选择（2）时完整继承公共条件但不把（1）证明目标当已知。改选小问立即失效旧证书/草稿授权。题目要求两问时分别验收，不用公共图冒充整题完成。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/planCompiler.subquestionCoverage.test.ts packages/agent-core/src/obligationIR.test.ts --testTimeout=30000；npm.cmd exec -- playwright test e2e/agent-subquestion-guard.spec.ts --workers=1 --retries=0。

**退出**：全部裸条件/设/且/若变式及错误候选贯穿生产确认链均被阻断，单问题/明确选问正例不回归。G0可由A先达成；B作为原P1/P2完成要求保留，不能因护栏存在宣称画图能力修好。
**回滚**：关闭多问自动确认，不恢复原错误放行。

## R02 — 原生凭据归属、endpoint绑定和可恢复更新

**对应**：H1/M4。**依赖**：R00；与R03共享endpoint合同。

**修改**：apps/desktop/src-tauri/src/commands/providers.rs、providers/adapter.rs、providers/request.rs、repository/provider_profiles.rs、secrets/windows.rs及原生密钥命令；apps/web/src/services/providerProfileClient.ts、components/settings/ProviderSettings.tsx。
**测试**：Rust tests/provider_profiles.rs、secrets.rs、provider_adapter.rs；TS providerProfileClient.test.ts、ProviderSettings.test.tsx。

**禁止做法**：照搬“先覆盖旧secret，profile失败再remove”的补偿；把旧密钥返回renderer作备份；信任renderer传reauthorized；只限制secretRef字符串而让底层save_secret/remove_secret继续绕过。

**推荐合同**（拟定原生接口，语义先经review确认）：

~~~text
update_provider_credentials(profileId, expectedRevision, profileDraft, optionalNewSecret)
→ {profileRevision, credentialState: unchanged|committed|needs_reauthorization}
失败 → {code, profileUnchanged, previousCredentialRetained, recoveryRequired}
~~~

原生端决定credential slot，renderer不能指定任意secretRef。为profile保存“拥有者+凭据版本+授权endpoint”关联。endpoint规范化至少比较scheme/host/effective port；base path若影响服务租户/可信边界也重新授权。构造最终URL及任何重定向前再验绑定；跨origin不转发旧认证头。既有自定义云端/本地服务配置明确分策略，不能一刀切破坏合法本地provider。

**一致性策略**：跨OS凭据库与profile存储不能假装有数据库原子事务。采用原生受控版本化暂存：

1. 锁定expectedRevision并校验归属/endpoint；暂存新secret到属于本profile的新slot，旧slot不覆盖。
2. 持久化新profile指向新slot及授权端点；失败清理新slot，旧profile/旧secret不动。
3. 提交成功后再清理旧slot；清理失败登记无明文的待清理状态，不回滚到错误端点。
4. 崩溃恢复按事务阶段核对引用；孤儿清理只能删本profile未引用版本。凭据内容不进JSON日志、备份文件或renderer响应。
5. 旧存档secretRef不可信：原生迁移验证归属，冲突/缺少可信endpoint绑定时要求重新输入，不自动把旧secret绑定新host。

native-only重授权至少要求显式新密钥输入/受控原生确认，不接受可伪造的布尔标记。无法立即实现事务时，先禁止带凭据的endpoint更换和覆盖式编辑，明确恢复路径，宁可暂时不可编辑也不删除旧凭据。

**故障矩阵**：跨profile secretRef、同profile换host/port/scheme/path、更新冲突、新建失败、编辑profile落盘失败、OS凭据库失败、提交前/后崩溃、旧slot清理失败、直接调用旧IPC入口。全部用fake secret store，不用真实key；合法请求认证头仅到授权目标，旧配置失败后仍可用。

**命令**：node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test provider_profiles --test secrets --test provider_adapter；npm.cmd exec -- vitest run apps/web/src/services/providerProfileClient.test.ts apps/web/src/components/settings/ProviderSettings.test.tsx --testTimeout=30000。
**退出/回滚**：跨profile/跨端点凭据泄漏0，失败/崩溃不丢唯一凭据；回滚禁用更新入口，不恢复未绑定发送。

## R03 — URL/DNS/连接一致与有界响应读取

**对应**：M6/M7。**依赖**：R02端点身份合同；可先写独立网络负例。

**修改**：apps/desktop/src-tauri/src/proxy/security.rs、providers/adapter.rs及实际HTTP client构建处。
**测试**：tests/proxy.rs、proxy_server.rs、provider_adapter.rs，按责任扩展而非发请求到公网。

**连接决策顺序**：

~~~text
解析Url → 策略/规范host/端口 → 凭据endpoint绑定 → 受限DNS解析
→ 验证全部候选IP → 固定本次连接地址（保持原域名SNI与TLS验证）
→ 发送 → 对redirect重新做全部检查或禁止redirect → 有界读取
~~~

拒绝cloud策略下loopback/private/link-local/unspecified/IPv6 ULA/IPv4-mapped private及其他不允许的特殊网段；不能只匹配字符串，也不能混合DNS答案只选一个公共地址就放过私有候选。解析结果固定到实际client连接，不能校验后再默认DNS解析一次。代理环境变量和手工HTTP代理必须纳入策略，否则IP固定可能被代理绕过；未支持代理时明确拒绝该配置。TLS不关闭，原hostname校验保留。local策略的回环允许独立定义，不把云凭据带到本地端点。

非2xx响应使用取消感知的流式读取，**在extend前检查累计字节**。建议错误诊断正文4KiB硬上限、UI最多200字符，成功路径维持既有上限，配置经测试冻结；Content-Length只预检，不信任缺省/谎报长度。分块、自动解压后的字节、UTF-8截断和超慢响应都受字节/总时长/取消约束；不记录认证头或完整敏感回包。

**RED矩阵**：[::1]、IPv4映射私网、ULA、域名解析成私网、公共/私有混合、校验后DNS变更、跨origin跳转、代理配置、持续chunked错误体、压缩展开超限、半个UTF-8字符和取消。用注入resolver/transport、小容量内存流证明拒绝/读取停止次数，不运行恶意TLS或真实DNS rebinding。

**命令**：node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test proxy --test proxy_server --test provider_adapter。
**退出/回滚**：真正连接的地址与已验地址相同，错误响应不会先完整缓冲；能力不可用时拒绝网络发送，不能回退手写host切分。

## R04 — 导出只能写原生授权的目标

**对应**：H2。**依赖**：R00。

**修改**：apps/desktop/src-tauri/src/commands/repository.rs、repository/package.rs；apps/web/src/components/ProjectPackagePanel.tsx和导出IPC客户端。
**测试**：tests/repository_package.rs、project_repository.rs；新增ProjectPackagePanel导出测试和实际桌面手动/自动验收记录。

**第一步建议**：短期限制到应用持有的exports根目录，IPC仅接受单个文件名，前端展示实际保存位置。未来如恢复任意目的地，原生保存对话框颁发一次性授权token，绑定路径、文件操作、窗口/项目和失效时间；renderer发送字符串不构成授权。两种模式不要同时存在未经授权的后门。

Windows文件名需拒绝路径分隔符、绝对/UNC/设备路径、冒号ADS、点点、尾点/尾空格、保留设备名，以及非.mcanvas后缀。正确扩展名不意味着安全路径。受控导出根和父目录检查联接/符号链接；通过句柄/平台能力限定父目录，避免仅canonicalize字符串后另开路径的竞态。

现有可预测.mcanvas.tmp不能继续使用。同一授权父目录内随机临时名+create_new，写入/flush/sync后执行受控提交；默认不覆盖已有目标，覆盖需独立原生授权和平台明确语义。失败不截断旧文件，只清理本次确实创建的临时文件。

**RED矩阵**：../、绝对磁盘/UNC路径、保留名、ADS、同名已存在、预创建临时文件、联接切换、取消保存、无token/重放token/跨项目token；目标根外无文件创建/内容改变。正常包往返保持兼容。

**命令**：node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test repository_package --test project_repository。
**退出/回滚**：不经原生授权写入次数0；无法保证文件系统边界则禁用原生导出入口，不恢复自由文本路径。

## R05 — 项目包与附件的资源预算先于分配

**对应**：H3/L3。**依赖**：R00。

**修改**：apps/desktop/src-tauri/src/repository/archive.rs、repository/package.rs、commands/repository.rs；前端附件读取调用点在FileReader之前加检查。
**测试**：tests/repository_package.rs、project_repository.rs与archive模块测试；新增前端附件大小边界用例。

**不要直接照抄常量建议**：原始包读取上限和未压缩聚合上限是不同量纲/责任，建立一个Limits结构提供一致策略但保留独立rawBytes/unpackedBytes/entryBytes/entries/attachmentBytes字段。初始可保持64MiB单项、4096项、256MiB原包并新增256MiB聚合、32MiB附件；这些是待测试冻结值，不因单项合法允许聚合放大。

**两阶段读取**：

1. 限长读原文件：metadata只预检，实际读max+1拒绝增长/替换后的超限文件。
2. 预扫描全部目录元数据，用checked_add/checked_mul检查累计大小、偏移和范围；拒绝重复名字、重复local_offset、重叠本地记录/数据区、越界、中央与本地名称/flags/method/size不一致。不得BTreeMap覆盖重复键后隐藏成本。
3. 所有元数据预算通过后才允许CRC和data.to_vec；这样后续超限条目不会让前面先大量分配。
4. 现实现只接收stored条目；不借本次修复顺便支持压缩。未来若支持，要约束实际解压字节/比例和CPU时长，而非只信header。
5. base64按输入字符/字节长度先检查解码上界，再用有界输出缓冲解码；padding、非法字符、Unicode、空白策略明确。前端file.size先于FileReader，Rust独立再验，不能依赖前端。

**安全RED**：注入低测试限额如64字节单条/128字节总量，3个小条目超限；不同名字共享local header、部分数据重叠、整数溢出、谎报长度；通过计数器断言拒绝前未调用CRC/clone。无须分配实际256GiB。正例正常往返、边界大小与历史合法包。

**命令**：node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test repository_package --test project_repository；模块名过滤测试仅在确认测试数量非0后作证据。
**退出/回滚**：实际分配/读取受预算控制，重叠条目拒绝，合法包不回归；回滚保持有界读取或禁用导入。

## R06 — CSV输出安全与草稿唯一副本保护

**对应**：M3/M5。**依赖**：R00；两个独立小补丁，不捆成一个不可审查的大提交。

**修改**：apps/web/src/persistence/exporters.ts、draftStorage.ts、useDraftPersistence.ts。
**测试**：exporters.test.ts、draftStorage.test.ts、useDraftPersistence.test.tsx。

### CSV：字符串与可信数值分开

对用户可控ID/label等字符串，在CSV引号转义之前检查危险起始字符及前导空白/制表/换行；=、+、-、@开头文本采用明确文本前缀策略。可信结构化数值-2仍输出数字，不得把所有以减号开头的内容都转为文本。字符串“-2”是否保留文本需按字段合同决定，不能靠“看似数字”绕过不可信字段防护。

单引号作为建议文本防护需在目标电子表格导入方式验证；CSV各消费者可能不同，文档要注明这是面向指定导入路径的安全导出，不声称所有程序永远安全。确需无损原始文本另走不会执行公式的JSON导出，不提供默认不安全CSV开关。

**RED**：标签=1+1、带前导空白的@、制表符/换行开头、嵌套引号、正常逗号/换行、可信数值负数；只加双引号不能满足公式安全断言。

### 草稿：备份失败即进入写保护

恢复结果由泛化错误改为明确状态：restored、backup_saved、backup_failed_readonly。备份写入失败时保留原key/原文，不得显示“已备份”；useDraftPersistence不得随后自动覆盖。保护状态在再次加载同一损坏原文时重新判定，不依赖一个同样可能写不进去的localStorage标记。

允许内存中继续编辑/提供下载唯一原文，但首次持久保存须用户明确选择备份导出、另存或确认舍弃旧稿；“点击继续”不默认为允许覆盖。先确认旁路副本写成功并可读取，再解除保护；配额不足/禁用storage仍保持只读保护。

**RED**：unreadable备份setItem抛错→修改画布→自动保存→原key字节不变；重载后仍保护；备用键成功/失败、显式导出成功/取消；不要为保护损坏稿阻断正常草稿自动保存。

**命令**：npm.cmd exec -- vitest run apps/web/src/persistence/exporters.test.ts apps/web/src/persistence/draftStorage.test.ts apps/web/src/useDraftPersistence.test.tsx --testTimeout=30000。
**退出/回滚**：恶意CSV文本不能作为目标程序公式执行，唯一草稿在故障后仍可取回；回滚时禁用不安全导出/自动覆盖而不是隐藏告警。

## R07 — 题图人工复核和全部函数义务一致绑定

**对应**：M1/M2。**依赖**：R01范围合同；原T02/T05/T08/T16。

**修改**：packages/agent-core/src/diagramVerification.ts；apps/web/src/services/problemImageReview.ts、problemImagePrompt.ts、components/agent/ProblemImageComposer.tsx。
**测试**：diagramVerification相关测试、problemImageReview.test.ts；拟新增problemImagePrompt.reviewGate.test.ts及对应composer交互回归。

### R07-A 函数相关义务统一绑定

从既有selectStatedCurve扩展为所有函数相关义务的entity引用解析，覆盖functionGraph、functionLineIntersections、tangentAt/commonTangent等实际存在消费者。用义务指向的主函数构造局部FigureContext，不依赖curves.length===1，不选第一条。多个同语义候选也需稳定ID或明确unknown，不能模糊猜。

**RED**：一个主函数加辅助曲线，主函数/直线交点仍正确核验；互换图元顺序结果不变；两个不同主函数错绑被拒；函数本身passed但交点违反原式时必须failed。绑定策略属于T05，不另外写一个只供E2E的选择器。

### R07-B 题图观察按结构类别默认复核

引入明确observation kind：label、scalar、coordinate、connection、relation、unknown及来源区域。模型不能自行标confirmed；确认记录绑定reading revision/observation ID/hash，题图/文字改动后旧确认失效。

未知、连接、相交、平行/垂直、棱关系默认需要确认；坐标形状识别与数值语法分开，根式/LaTeX分式/读不懂的坐标仍进入疑点，不静默跳过。自动通过的label/scalar必须有严格白名单，模型任意kind字符串不能把关系伪装label绕过。

在prompt装配层再次检查确认状态，而不是只禁用发送按钮。未确认观察不进入事实/题设；可作为明确待核对附件提示，不能悄悄传给规划器用于构造。透视线交叉不当作空间相交。

**RED**：AB与CD相交于E、AB∥CD、AB和CD是两条棱、F(2√5,0)、LaTeX分式坐标、未知kind、伪造confirmedLines、重复观察ID、确认后改字；未确认时prompt不含其确定性题设，确认后有明确来源。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/diagramVerification.test.ts apps/web/src/services/problemImageReview.test.ts apps/web/src/services/problemImagePrompt.reviewGate.test.ts --testTimeout=30000。
**退出/回滚**：未确认观察进入事实数为0，合法已确认数据不丢；辅助曲线不错误阻断。失败时保持人工核对，不恢复正则漏掉就放行。

## R08 — E2E与生产UI合同重新对齐

**对应**：M8/M9。**依赖**：R00环境；原T15/T16。

**修改范围**：apps/web/src/components/AppChrome.tsx及真实App.tsx调用链；persistence/inspectorWidth.ts、threeSceneGrid.ts、agent生产确认信息装配；e2e/ribbon-ui.spec.ts、three-grid-fade.spec.ts、agent-derived-sphere.spec.ts、next-phase-flag-entry.spec.ts、solid-prism.spec.ts及其他直接签名用例。
**拟新增**：e2e/pages/MathCanvasPage.ts，统一公开用户操作，不加入只在测试模式才存在的控件。

### 先作明确产品裁决，不直接让测试迁就实现

| 项目 | 推荐合同（待实施确认） | 禁止捷径 |
| --- | --- | --- |
| 属性栏默认宽度 | 采用当前310作为新默认，兼容用户已保存宽度；检查设计文档/可访问性后记录裁决，再更新250旧期望 | 看到310失败就无记录改断言 |
| 网格淡出 | 当前基线已撤回着色器淡出，建议暂不恢复旧效果；保留网格可见/尺度/拖动/性能契约并记录功能边界 | 删除整个网格测试，或把无淡出说成淡出已完成 |
| 外接球披露 | 必须从生产构造/验收证据生成“由内核构造/核验范围”的真实说明，用户确认面板可见 | 只改fixture、只修改测试文案，或硬编码无依据披露 |

若用户/现有规格要求恢复250或淡出，则变成独立产品修复，并补正反测试；不是同时保留矛盾合同。

建立可访问roles/names：模型服务入口、header保存按钮、当前实体创建/透明面/空间平面命令。Page Object只封装这些真实入口与等待可见/可用状态，不直接写store绕过用户操作。WorkspaceTabs若已未被生产引用，明确标兼容遗留或另审查删除；它的组件测试通过不算AppChrome覆盖。

### 失败分类与复跑纪律

- 46/49来自审查两轮，不直接相加成95个不同缺陷；以testId/project/retry/trace建立唯一失败清单。
- 每项分类：旧定位器、产品功能回归、未裁决合同、资源/时序或混合；保存代表trace及修复前后证据。
- 先单worker、retries=0、无Rust并发验证稳定逻辑，再在固定正常并发重复完整套件。不得只报告“重试后绿”、加无限timeout或用test.skip屏蔽失败。
- 已知单worker恢复项仍需测正常并发，不能因此宣布全部是环境问题。

**命令**：npm.cmd exec -- playwright test e2e/ribbon-ui.spec.ts e2e/three-grid-fade.spec.ts e2e/agent-derived-sphere.spec.ts e2e/next-phase-flag-entry.spec.ts e2e/solid-prism.spec.ts --workers=1 --retries=0；收口后完整npm.cmd run test:e2e，保存每次总数/首轮失败/重试。

**退出/回滚**：所有失败有归因和处置；生产披露补齐、当前入口实际可用；干净环境完整套件通过，并在固定并发复跑检验稳定性。回滚保留用户可用入口，不恢复无人能点到的旧定位器作为唯一测试。

## R09 — 先修评测最终轮次，再统一schema/runtime

**对应**：L1/L2。**依赖**：L2只需R00，前置到G0；schema部分在R00之后独立进行。

**修改**：apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts:307、agent/modelPlanner.ts:227–247、packages/agent-core/src/schemas.ts；扩展modelPlanner.test.ts、schemas.test.ts。
**拟新增**：可单测的eval最终候选选择辅助模块及对应测试，不把测试写进付费eval入口导致必须请求模型。

### R09-A 最终候选是唯一计分对象

删除“任意round包含预期答案即通过”的规则。根据runtime terminal与实际staged/accepted plan ID获取唯一最终输出，按runId/attemptId/stageId/candidateHash绑定答案、数学核验、oracle和图元；不能把第一轮答案与第二轮图拼成成功。

~~~text
expected=answer → completed且最终接受answer匹配
expected=plan → awaiting_confirmation且当前staged plan/candidate匹配
failed/cancelled/无最终接受输出 → 不通过，即便历史round有正确答案
澄清 → 单独clarification指标，不混入出图成功
~~~

**双轮RED**：先正确后错误应fail；先错误后最终正确才可pass；旧round正确但最终取消/未接受应fail；题文/候选改动后历史证据stale；一轮无修复保持原计分。旧报告保留，以新metricVersion重新跑离线/回放，不能悄悄重写4/36或旧真实请求结果。

### R09-B schema叶子约束同源

actionKey非空/不全空白、normalisation字段trim/min长度等约束从共同定义生成provider可支持schema与runtime validator。验证未知字段、可选/null、最大长度/条目数、Unicode空白，加入差分样本。provider不支持的JSON Schema关键字要明确降级清单，runtime继续更严格检查；不承诺provider完整验证所有语义。

Ajv若尚未安装，先用现有验证器能力验证所需子集；确有需求再审查新增devDependency及锁文件，不为计划写一句“AJV差分”就静默安装。测试必须覆盖真实buildPlanToolSchema输出，不只手写一份理想schema。

**命令**：拟新增npm.cmd exec -- vitest run scripts/reliability-eval/finalOutcome.test.ts --testTimeout=30000；npm.cmd exec -- vitest run apps/web/src/agent/modelPlanner.test.ts packages/agent-core/src/schemas.test.ts --testTimeout=30000。
**退出/回滚**：旧答案不能拯救最终错误；发布schema与runtime在声明子集一致；若新计分尚未就绪暂停成绩声明，不回到rounds.some。

## R10 — CI权限和Action固定前置

**对应**：H4/M10/L4。**依赖**：R00；必须在依赖升级/敏感CI流程使用之前完成。

**修改**：.github/workflows/ci.yml，必要的静态工作流检查测试。

- 顶层permissions: contents: read；逐job列额外权限与用途，没有推送任务不增write。
- 第三方与第一方Action全部固定完整commit SHA，记录官方仓库、原tag、对应commit和核对日期；实施时再次核对上游，不能把报告所列SHA当永远最新或安全证明。
- checkout设置persist-credentials: false；检查后续步骤确实不依赖push凭据。
- 审查触发器/不可信PR输入、secrets暴露与cache信任边界；报告称未发现高危触发器不等于以后可随意增加。
- 合并依赖更新前先用静态校验检查YAML和权限，再进行无真实provider凭据的CI回归；不要用真实密钥验证恶意Action攻击。

**测试**：所有uses引用不可变且仓库身份正确；缺permissions或checkout默认token保留的fixture失败；合法least-privilege工作流通过。不要为了固定SHA而引用未知fork。
**退出/回滚**：最小权限下正常CI可跑，静态守卫防止回退可变引用；发生问题保持受限权限，换核验过的固定版本，不恢复stable/v2等浮动引用。

## R11 — 干净依赖、公告与Rust审计缺口

**对应**：M11/I2/I3。**依赖**：R00/R10。

**修改**：package.json、package-lock.json中经过逐项评估的依赖；Rust只在发现真实需修公告后单独处理Cargo.lock/依赖，不借本任务大范围升级。

报告的14项（3 high/11 moderate，生产omit-dev为0）仅表示审查时点。实施时重新获取npm audit --json及--omit=dev，记录具体advisory ID、受影响依赖链、修复版本范围和工具版本；**本方案没有重新查询公告，也不指定未经核验的“最新版本”**。

按直接包及其传递链选择最小兼容修复，不使用npm audit fix --force/忽略审计制造通过。更新锁文件后在隔离Node22环境实际npm ci、npm ls --depth=0、typecheck/lint/unit/build/offline/E2E，区分本机4.1.12和锁文件4.1.11。旧node_modules不能代替干净CI。

RustSec用可信安装渠道/版本固定的cargo-audit或项目批准的等价工具在实施时核对；工具不可用就明确unknown，不宣称Rust无公告。未修公告须给适用性/临时缓解/责任人与到期时间；可利用critical/high不接受“只是dev工具”豁免发布，缺审计的风险接受必须显式。

**RED/验证**：锁文件与实际版本漂移、CI使用不同包管理器、公告未处置却标通过应被门禁拒绝。高成本Rust与E2E串行，依赖更新commit单独可回滚，但回滚后公告仍开放必须保持发布阻断。

**命令**：npm.cmd audit --json；npm.cmd audit --omit=dev --json；隔离目录npm.cmd ci及完整验证；cargo-audit的实际安装/执行命令待工具选定后记录，不在当前活动目录直接清空依赖。
**退出**：两类npm审计明确、Rust审计已验证或明确未闭环、干净CI可复现；不以报告时的0生产公告冒充永久安全。

## R12 — 性能、Lint、发布证据与安全回滚

**对应**：L5/W1/I3，原T18。**依赖**：G0/G1/G2先达标；性能可先测，拆包不抢安全修复优先级。

**修改**：App.tsx及Agent/Three.js加载边界，按报告16项unused逐项审查；发布门禁/回滚证据。

- 先实测冷启动时间、首次可编辑、首次打开Agent/Three场景、首次作图、worker启动、失败/取消与内存。构建2.43MB/gzip732KB/worker692KB只是报告时体积，不是本轮新读数，不作为唯一性能门槛。
- 按真实功能边界lazy import，保留loading/error/retry和worker初始化合同，避免“首屏变小但第一次画图卡死”。消除无效动态导入前核对构建依赖图；阈值由同机器基线和产品要求冻结。
- unused警告分别判断：真死代码删除，测试专用与兼容接口保留说明；不关闭规则、不删有价值测试只为0 warning。
- 发布必须同时满足本R计划安全门禁、原36题/未见题合同、实际画布/交互、完整干净CI、Windows桌面构建及安装/冷启动验收。真实模型新测另批预算，不能以旧101请求证据代替。
- 安全回滚演练：禁用有问题入口仍不泄漏/丢数据；旧存档可读、旧凭据不外发、过期证书不升级。单纯恢复59ea3613不是安全回滚目标，因为它含已知错误放行与高危路径。

**最终证据**：版本/依赖锁/模型标识/校验器版本/二进制hash、负例清单、单轮E2E/重试读数、未见题统计、成本、安装/离线范围与未测项。未闭环项可阻断发布，不用单测5535通过抵销。

**命令**：依次npm.cmd run test:docs -- --testTimeout=30000、npm.cmd run typecheck、npm.cmd run lint、npm.cmd test -- --testTimeout=30000、npm.cmd run build、npm.cmd run test:rust、npm.cmd run eval:reliability -- --offline、npm.cmd run eval:explicit-solid -- --offline、npm.cmd run test:e2e；perf/安装/真实provider按独立批准的方案执行。

## 6. 下一次实施的具体起手顺序

1. R00记录工作区/锁文件/工具链快照，不改基线。
2. 将C1裸条件/设/且/若及错误四棱锥加入真实解析+compile RED；保存原审查结果，不重写报告。
3. R01-A最小fail-closed，接runtime确认链，补单问/明确scope正例；用户仍可看到未验底图，但不允许作为完整通过确认。
4. R09-A加入“第一轮正确、最终轮错误”离线反例，修最终候选计分；旧成绩冻结。
5. R10最小权限+SHA固定，继而R02凭据更新/归属、R03网络、R04文件授权、R05资源限制、R06草稿/CSV保护。每包独立审阅，不一次性大补丁。
6. R07/R08/R09-B/R11恢复题图复核、实体绑定、真实UI与干净环境可信测试。
7. 回到原T01–T18：先六题切片再36题数学/显示/交互，R01-B负责完整scope；最终R12收口。

**首批交付定义**：R00快照、R01-A安全护栏与生产负例、R09-A正确计分、R10最小CI加固。其完成只说明“不再错误认证/错误统计”，不承诺真实出图率提升，不代表G1所有风险已消除。

## 7. 方案裁决与阻塞处理

| 决策 | 推荐默认 | 需要另行确认的变化 |
| --- | --- | --- |
| 基线 | 保持59ea3613 | merge/rebase/迁移上游 |
| 多问 | 暂时未选问就阻断完整确认，再做scope | 允许公共图确认需独立明确partial产品流程 |
| endpoint变更 | 旧凭据不复用，原生rekey | 兼容旧跨profile引用绝不自动放开 |
| 导出路径 | 受控exports单文件名先落地 | 恢复任意路径需原生保存授权 |
| 属性栏/网格 | 310默认、淡出暂不承诺，记录规格裁决 | 恢复旧250/淡出另建产品任务 |
| 干净测试 | Node22隔离环境，重负载串行 | 清空活动依赖/变更CI运行时版本 |
| 费用/发布 | 不自动执行 | 新provider请求预算、发布和推送 |

这是建议，不伪装成用户已批准的功能更改。遇到有争议的产品合同可继续做其他无争议安全修复，不能用“待确认”阻塞全部风险处理。

## 8. 闭环记录模板

~~~text
审查ID / R工作包 / 原T工作包：
源码revision、工作区diff、lockfile hash、环境：
原报告证据位置/本次复现（分别列）：
漏洞或功能缺口的前提与影响：
RED命令/退出码/实际失败原因：
最小补丁与生产入口：
GREEN / 正例兼容 / 负例 / 故障注入 / 集成证据：
确认前场景写入、凭据/文件副作用与资源上限：
E2E首轮/重试/并发环境、未执行项：
是否改变统计口径、旧新metricVersion：
安全回滚方法与演练：
审阅者、用户裁决、关闭状态/尚未解决原因：
~~~

**本轮交付边界**：只更新方案、问题映射与状态导航；原审查报告保持字节不变。没有产品补丁、真实攻击复现、依赖升级、付费模型请求、Git提交或推送。

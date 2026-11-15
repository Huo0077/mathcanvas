# MathCanvas 当前状态

最后更新：2026-11-16；产品版本：v4.3.0；产品代码基线：59ea36133c47971f4252e71f7a0f5ba003dd1028。

## 2026-11-15 —— 进度文档统一对齐（仅文档，产品禁止发布）

**本页是实时进度和发布状态的唯一来源；当前基线不具备发布条件。** 其他文档分别负责执行合同、能力说明、计分定义或历史证据，不重复维护“完成率”。

### 文档入口与唯一职责

- **执行主入口**：[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)。
- **机器执行合同**：[任务台账](superpowers/plans/2026-11-15-implementation-task-ledger.json)：13项R审查工作包+18项T画图工作包=31项；记录依赖/文件/测试/验收，不记录第二套实时进度。
- **技术附录**：[R审查修复](superpowers/plans/2026-11-15-review-driven-next-implementation-plan.md)、[P0–P8阶段合同](superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)、[T画图实施细节](superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)、[架构设计](superpowers/specs/2026-11-15-drawing-reliability-design.md)。
- **能力/验收定义**：[功能目录](feature-catalog.md)、[发布门禁](acceptance/agent-release-gate.md)、[计分卡](acceptance/agent-tool-loop-scorecard.md)。旧Task/N/V/W记录不再决定本轮顺序或放行。

### 版本与已完成的非功能工作

| 项目 | 核对状态 |
| --- | --- |
| 代码基线 | 59ea3613，v4.3.0；本轮不迁回旧后续代码 |
| 重启提交 | be033b71，唯一父节点59ea3613；此前已核对同步远端。本次不重复推送、不声称重新查询了远端 |
| 舍弃旧线 | 59ea3613..d8743a32的47提交已保存在本地/远端archive/abandoned-post-59ea3613-20261115，不继承旧实现/成绩/进度；v4.4.0只作历史 |
| 已完成 | 原件归档、清理记录、审查阅读、方案/31任务合同与版本治理；均不等于产品修复 |
| 本次操作 | 仅对齐活动进度/能力合同/技术附录，给历史计划增加边界和导航；原审查、旧评测和发行证据不改 |
| 功能实施 | R00/R01-A/R09-A/R10、G1（R02–R06）及G2的R07、R08已完成；当前继续执行G2（下一步R09-B），其余R/T与P0–P8未开始；G2及后续G3–G4不得据单个切片宣称整体关闭 |

版本治理详见[main重启记录](audit/2026-11-15-main-restart/README.md)。前一轮探针仅确认缺陷，不是修复GREEN。

### 当前执行范围与区块结果

上一目标 **R00 → R01-A → R09-A → R10** 已完成。当前用户明确授权 **G1（R02–R06）与G2（R07、R08、R09-B、R11）**，每块验证、对齐文档并推送；不进入P0–P8、R12或发布。执行分支为 `feature/drawing-reliability-execution`。

| 工作包 | 当前状态 | 证据 |
| --- | --- | --- |
| R00 同源环境 | **已完成** | [Node22环境证据](audit/2026-11-15-review-remediation-baseline/README.md)：真实 `npm ci`、类型检查、文档22项、Vitest 5535项通过+1todo；隔离 worktree 无源码/锁差异 |
| R01-A 小问止损 | **已完成** | [小问阻断证据](audit/2026-11-15-subquestion-guard/README.md)：compile/runtime负例转GREEN，浏览器4种写法均阻断且零图元，普通单问确认成功；完整Vitest 520文件/5544通过+1todo |
| R09-A 最终产物计分 | **已完成** | [最终产物证据](audit/2026-11-15-final-outcome/README.md)：旧答案不再兜底，双轮正反例与离线评测通过；完整Vitest 521文件/5548通过+1todo |
| R10 CI边界 | **已完成（静态验证）** | [CI加固证据](audit/2026-11-15-ci-hardening/README.md)：顶层只读权限、11处固定SHA、4处checkout不持久化凭据、静态守卫12项通过；未触发远端CI |
| G1 / R02 凭据安全 | **已完成** | [凭据安全证据](audit/2026-11-15-provider-credential-safety/README.md)：原生归属与endpoint绑定、版本化事务及崩溃恢复；完整Rust 297项通过+4ignored，Vitest 522文件/5560通过+1todo |
| G1 / R03 网络安全 | **已完成** | [网络安全证据](audit/2026-11-15-network-security/README.md)：URL/DNS候选验证与连接固定、错误体4KiB有界读取；完整Rust 307项通过+4ignored，Vitest 522文件/5560通过+1todo |
| G1 / R04 导出授权 | **已完成** | [导出授权证据](audit/2026-11-15-export-authorization/README.md)：受控exports根、严格文件名、原子不覆盖写入及Windows junction拒绝；完整Rust 310项通过+4ignored，Vitest 522文件/5560通过+1todo |
| G1 / R05 归档资源边界 | **已完成** | [归档资源证据](audit/2026-11-15-archive-resource-limits/README.md)：目录预扫描先于CRC、独立raw/聚合/附件预算、有界base64与读取；完整Rust 317项通过+4ignored，Vitest 522文件/5562通过+1todo |
| G1 / R06 草稿与CSV保护 | **已完成（G1闭环）** | [草稿与CSV证据](audit/2026-11-15-draft-and-csv-protection/README.md)：CSV公式字符加单引号防注入且保留数值负数/布尔语义；`:unreadable` 备份写入并回读失败时保留原草稿、阻断该工作区自动保存并提供下载/二次确认放弃恢复；定向49项通过，Vitest 522文件/5570通过+1todo，类型/Lint/Web构建通过 |
| G2 / R07 函数绑定与题图复核 | **已完成** | [曲线绑定与题图复核证据](audit/2026-11-15-image-review-and-curve-binding/README.md)：函数图像/交点/切线/公切线统一entity绑定与错绑拒收；题图关系/连线/根式与分式坐标/未知类别默认须人工确认且绑定revision防改字失效与伪造绕过；定向6文件/152项通过，Vitest 524文件/5577通过+1todo，类型/Lint/Web构建通过 |
| G2 / R08 E2E与生产UI/合同对齐 | **已完成** | [E2E与生产UI对齐证据](audit/2026-11-15-e2e-ui-contract-alignment/README.md)：修复参数化外接球动作/内核披露、`tryBuildRightPrismMidpointsPlan` 分问路由与 `.clean-chrome` `z-index: 100` 遮挡缺陷；新增 `MathCanvasPage` 并对齐 `310px`/网格/工作区Chrome/空状态契约；全量串行E2E 286 passed/0 failed（retries=0），16-worker并发282/286（4项为高并发5s/30s超时），Vitest 524文件/5580通过+1todo，类型/Lint/Web构建通过 |
| G2其余 | 未开始 | 下一步依次R09-B、R11，不宣称G2已关闭 |

R00 仍有依赖公告留给 R11，不包含付费 provider、安装/冷机或发布验收。文档对齐提交 `3856263f`、worktree 忽略提交 `be3f00bf`、R00/R01-A/R09-A提交 `9ca9ff12`/`d8cac823`/`addf4c79`、R10提交 `ce1895e5`、R02提交 `ef13937b`、R03提交 `216fd3a9`、R04提交 `1fe0e9a8`、R05提交 `6f736bbf`、R06提交 `ab91233e`/`4355eeee`、R07提交 `d7b970e6` 均已推送；R08随本变更提交并核对远端后进入R09-B。

### 1. 证据分层与发布阻断

#### 同日审查结果（保存证据，非本次文档对齐复测）

来源：[项目审查报告](audit/2026-11-15-project-review/README.md)。

| 项目 | 保存结果及限制 |
| --- | --- |
| C1数学错误放行 | 裸条件/设/且的后续小问可能被吞入目标，违反条件候选仍passed；R01-A必须前置阻断 |
| 原生与数据安全 | H1–H4及M3–M7等未修；凭据、网络、文件、资源和恢复负例须按R任务闭环 |
| 完整Playwright两轮 | 第一轮235 passed/46 failed；第二轮232 passed/49 failed；不是两份独立失败数相加 |
| 单worker定向 | 10 passed/3 failed；定位器、产品披露、宽度/网格契约和资源时序分开修 |
| 工程验证 | Vitest5535通过/1todo；类型、文档、构建通过；Rust串行280通过/4ignored；首次并发链接内存不足 |
| 依赖审计 | 当时npm14项（3 high/11 moderate），omit-dev为0；RustSec未验证。实施时重新审计 |
| 未覆盖 | 新付费模型、安装/冷机、破坏性大包/DNS PoC等未做，不能以历史证据填新通过 |

完整E2E已经运行但未通过，不能继续概括为“未跑”，也不能用单测全绿抵销发布阻断。审查报告中的“落后47提交”是重启前历史状态，不是当前main分叉结论。

#### 36题真实作图基线（原JSON冻结，不重新计分）

| 指标 | 保存结果 |
| --- | --- |
| 样本/路由 | 36/36；平面18、立体18；35 native+1 local |
| 草稿 | 25/36（69.4%）；平面17/18、立体8/18 |
| 旧host通过/待确认 | 均4/36（11.1%），不是完整正确率 |
| 完整证书 | 该版不存在，null/not_available_in_revision；不能写0% |
| 局部oracle exact | 8/36，只覆盖部分条件 |
| 失败阶段 | compiling 11、validating 21 |
| 正式请求/主场景写入 | 101/0；不是新付费授权或交互成功证据 |

详见[36题基线审计](audit/2026-11-15-drawing-baseline/README.md)。新计分必须绑定最终接受的候选并另用metricVersion；澄清/拒绝、公共底图、局部exact不当作整题成功。

#### 前轮计划校对（同样不是功能修复）

[8个解析探针](audit/2026-11-15-drawing-implementation-audit/README.md)与[4个compile只读探针](audit/2026-11-15-implementation-plan-verification/README.md)用于核对已知缺口：裸条件/设/且仍passed，若为unverified warning；无模型调用、无主场景提交。6个最终产物选择示例断言只验证计划内代码，不是生产接线通过。

### 2. 本轮阶段验收（0 件已解决、9 件待定）

P是画图能力验收阶段，R/T是实现工作包，G是跨任务门禁；不能相加为新的完成总数。R01-A/B、R09-A/B是任务切片，不把31项再拆成另一份重复计数。

| 序号 | 阶段 | 状态 | 退出门槛摘要 |
| --- | --- | --- | --- |
| 1 | P0 基准与测量 | 未开始 | 36题黄金合同/独立复核/关键回放；前置R09-A正确计分 |
| 2 | P1 来源与语义合同 | 未开始 | R01-A先止损，T02再完整scope/source/entity/IR无损迁移 |
| 3 | P2 解析与归一化 | 未开始 | AST/链式关系/别名/小问；必要条件不丢失 |
| 4 | P3 平面确定性构造 | 未开始 | 平面18/18对象与数学合同；依赖稳定绑定和T11数值策略 |
| 5 | P4 立体与折叠构造 | 未开始 | 立体18/18合同与拓扑/state/分支负例 |
| 6 | P5 有界求解与修复 | 未开始 | 共享预算、限长、停滞、取消与过期安全 |
| 7 | P6 独立完整验收 | 未开始 | 最终候选完整覆盖与错图/stale变异拒绝 |
| 8 | P7 真实画布与交互 | 未开始 | R08先对齐生产契约，再36题渲染/确认/撤销/重载/拖动 |
| 9 | P8 泛化与发布 | 未开始 | G1/G2前置，盲测/成本/安装/性能/安全回滚与人工批准 |

### 3. 下一步及授权边界

**当前按主计划和新goal执行G1/G2**：R00 → R01-A → R09-A → R10、G1（R02–R06）及G2的首块R07已有关闭证据；下一步继续G2依次完成R08、R09-B、R11后停止，不进入P0–P8、R12或发布。

全部实现须RED→GREEN、生产接线、反例/兼容与独立复核；安全补丁回退只能关闭入口，不能重新开放已知漏洞。历史版本和授权不自动继承。付费预算、依赖升级和产品发布不在本次范围内，不自动触发。

### 4. 记录和验证导航

- [下一轮导航](agent-next-round-progress.md)、[本轮过程日志](project-progress.md)。
- [本次文档对齐清单/核验](audit/2026-11-15-progress-alignment/README.md)：活动文件、历史导航边界、原件保真和本次新鲜文档测试。
- [历史原件](audit/2026-11-15-pre-reset/README.md)、[旧清理记录](audit/2026-11-15-project-cleanup/README.md)、[v4.3.0历史发布说明](release/v4.3.0.md)。

# MathCanvas 项目过程日志

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：过程日志；有日期的操作/测试记录是历史事实，不自动等于当前状态。实时状态仅维护在[当前状态](current-status.md)；执行总顺序以[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](superpowers/plans/2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

最后更新：2026-11-16。

实时阶段进度只维护在[当前状态](current-status.md)。本文只记本轮过程；旧完整过程日志及旧状态/下一轮记录已按原字节[归档](audit/2026-11-15-pre-reset/README.md)，不删除历史、不继承旧完成数字。

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

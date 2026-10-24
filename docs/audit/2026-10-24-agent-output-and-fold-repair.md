# Agent 输出合同与翻折修复（2026-10-24）

> 基线：`40698e3`（`Huo0077/mathcanvas` main，2026-10-24）。
> 本文是**实施记录**，不是发布说明；每一条状态都能在本文末尾的"验证命令与读数"里找到对应证据。
> 状态词只用：未开始 / 进行中 / 已实现未验证 / 已验证 / 外部阻塞。

## 0. 本轮做了什么（一句话）

把"规划失败"从**伪装成一份计划**改成**带分类的失败合同**，把 Rust 侧的流式收尾与
Anthropic 工具参数分片补齐，把翻折句式读取器换成真正的点名语法并在默认配置下打开
单次翻折的确定性构造；其余任务按顺序推进并如实标注未完成部分。

## 1. 进度表

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T1 规划失败合同 | **已验证** | E1/E2/E3 已修复，新增 6 条规划失败用例 + 5 条协调器用例 |
| T2 流式完整性与协议归一化 | **已验证（Rust 单测）** | 收尾顺序、Anthropic `input_json_delta`、EOF 不算完成、UTF-8 跨块；6 条新用例 |
| T3 输出模式 / schema / 预算贯通 | **已验证（请求侧 + 探针侧）** | `normalisations` 进工具 schema（E4）；输出模式 `json_text/json_mode/json_schema` 已贯通 TS→IPC→Rust，`json_mode` 只在 `json` 已验证的通道发出，从不冒充 `json_schema`；**JSON 探针改为真的带 `response_format`**：参数被拒记 `unknown`（不是 `failed`），旧"能回 JSON"的证据不再放行严格模式 |
| T4 翻折语义与点名识别 | 已实现未验证（真实模型路径） | E6 六种写法 + 撇号/下标点名 + `rotate` 语义分开；9 条读取器用例 |
| T5 确定性构造 | 已验证（默认配置 + 换点名 + 尺度 ×2 + 浏览器闭环 + 欠定/矛盾披露） | E7 的默认开关缺口已修；换点名与整体尺度变式通过；浏览器闭环见 §5.4/§5.5；**欠定折角与矛盾条件不再被伪装成题设结论**（§5.6） |
| T6 连续折叠 | 已验证（代表链路 + 浏览器闭环） | `foldChain.ts` 给出依赖与分类；`planCompiler` 在**顺序链可解**时生成两笔 `solid.fold`（第二笔折痕含第一笔产出的点），代表链路编译 + 全题核验通过；链不可解时**拒绝只折第一条**；浏览器里两折题预览→确认→提交→撤销已跑通（§5.4）。多未知角联立求解仍未实现 |
| T7 失败回放与泛化评测 | 已实现（离线、模拟响应） | `fixtures/replay.test.ts`：8 条 provider 响应 + 9 条翻折题面，走真实入口并断言分类/结构；**没有**真实模型读数 |

## 2. T1：规划失败的合同

### 2.1 复现输入与原行为

| 编号 | 输入 | 原行为 | 现在 |
| --- | --- | --- | --- |
| E1 | 工具参数是一段**双重编码**的合法计划，解码后 `actions[0].inputs.size.x = "bad"` | 局部诊断认出 `non_finite_number@envelope.actions[0].inputs.size.x`，下一层却只得到 `invalid_type@envelope: got a string` | 失败里带 `decoded` 对象与该字段路径；修复提示与 `allowedChanges` 都指向 `envelope.actions[0].inputs.size.x` |
| E2 | 半截 JSON + `completed.stopReason = "length"` | 退化成"计划必须是 JSON 对象" | 分类 `response_incomplete`（结束原因原文保留），修复提示要求"重新完整输出" |
| E2 | 没有正文、只有 `stopReason = "length"` | 同上 | 分类 `response_incomplete`；没有结束原因的空响应是 `empty_output` |
| E3 | 一个对象里只有 radius 类型不合法 | 显示"计划必须是一个 JSON 对象" | 显示"字段不合法 + 具体字段路径"；只有根路径错误才用原话 |

### 2.2 接口变化

- `PlanOutcome`（`packages/agent-core/src/coordinatorPorts.ts`）改为判别联合：
  `{ plan, requestId, attemptId } | { failure, requestId, attemptId }`，判别靠 `"failure" in outcome`。
- 新增（`packages/agent-core/src/outputParser.ts`）：
  `PlanFailure`、`PlanFailureCategory`（`response_incomplete` / `empty_output` / `invalid_json` /
  `schema_invalid` / `unexpected_tool_call` / `provider_refusal`）、`createPlanFailure`、
  `planFailureFromParseFailure`、`planFailureDetail`、`describePlanFailureRepair`、
  `describePlanFailureForUser`、`planOf`（测试/评测入口的便捷读法，失败即抛）。
- 协调器：失败分支按分类组装修复请求（`repairRequestFor(errors, attempt, category)`），
  仍只占"形状类"一次修复名额；用完如实 `failed`。
- 调用方更新：本地规划器、模型规划器、评测入口（`benchmarkPlanningEval`、`offlineAgentEval`、
  `examRunAdapter`、`examRunCoordinated`）与 40 处 `.plan` 取值。

### 2.3 新增回归

`packages/agent-core/src/coordinator.test.ts`（`planning failure contract`）：
字段错误分类/路径一路到账本与第二次提问、截断说的是"被截断"、空输出独立分类、
第二次仍失败就停且不暂存。

`apps/web/src/agent/modelPlanner.test.ts`（`T1 — the planning failure contract`）：
双重编码合法计划被接受且留痕、双重编码 + `size.x` 错误带 `decoded` 与字段路径、
半截 JSON + `length`、空正文 + `length`、空正文无结束原因、三重编码不递归、
散文不抠取。

## 3. T2：流式完整性与协议归一化

### 3.1 缺陷与修复

| 缺陷 | 修复 |
| --- | --- |
| `RunStream::flush` 先 `drain()` 工具调用、后吸收残留半帧 → 最后一帧参数静默丢失 | 顺序改为「残留帧 → 累积器 → `drain`」 |
| 残留帧走 `normalize_response`（新建累加器） | 改走 `normalize_response_with(&mut self.tool_calls)` |
| TCP EOF 被当成正常完成 | 新增 `saw_terminal`；流式请求没见到 `[DONE]` / `message_stop` / `finish_reason` / `done:true` 时补一条 `MalformedOutput` |
| Anthropic `input_json_delta` 被忽略（E9）；`content_block_start` 提前发空参数工具调用 | 新增 `ToolCallAccumulator::absorb_anthropic`（按块 index 拼 `partial_json`，支持非流式 `content[]`）；块开始不再发事件，整条调用在收尾时一次发出 |
| 结束原因只有原始字符串 | 新增 `classifyStopReason`（`normal` / `tool_use` / `length` / `refusal` / `cancelled` / `unknown`），原始值一并保留；`PlanFailure` 分类用它 |

### 3.2 Rust 回归（真正执行）

`cargo test --test provider_adapter`：**31 passed / 0 failed**。新增 6 条：
Anthropic 增量拼接且只发一次、非流式 Anthropic 工具块、末帧无空行仍并入同一次调用、
UTF-8 字符跨 chunk 切割、无结束标记报断流、`[DONE]` 不误报失败。

## 4. T4：翻折读取器

- 点名语法：`[A-Z][A-Z′'’ʼ₀-₉]*` → 再切成名字，支持 `A′`、`A₁`；`[A-Z]{3}` 不再是点名的定义。
- 句式：`翻折/折叠/折起/翻起` + `至/成/到/为`、`使点 A 到达点 P`、`绕 BC 旋转到 △PBC`。
- `rotate` 与 `fold` **语义分开**（`motion` 字段，缺省 `fold`）；`planCompiler` 的补折路径
  只用 `motion !== "rotate"` 的条目。
- 每条读出来的变换带 `sourceText`（原文证据）。
- 校验不变：折痕两端必须同时在折前与折后，否则**不产出**（宁可说没读懂）。

新增 9 条用例（`figureIntent.test.ts` 的 `T4 — reading fold phrasing`）：
六种写法、撇号、下标、空格标点、折痕不在移动面上、只有"翻折"没有目标、连续两折按顺序读出。

## 5. T5：默认配置下的单次翻折

- 缺陷（E7）：`rescueWithFoldConstruction` 排在 `diagramWitnessSearch !== true` 的早退**之后**，
  于是默认配置下这道题只能得到 `ok=false`。
- 修复：开关关闭时先试规范重建（确定性构造），失败再原样交回第一遍结果；
  开关打开时顺序**不变**（广义搜索优先，既有断言不被抢走）。
- 用例：同一条四边形/AEF/PC=4√3 题在默认配置下 `ok=true`、`diagramVerification=passed`、
  assumptions 含 `witness.foldConstruction`（新增）。

### 5.3 换点名与尺度变式（2026-10-24 追加，含一次自我更正）

- **换点名**：A/B/C/D→P/Q/R/S、E/F→M/N、折后点 P→T，编译通过、`diagramVerification=passed`。
- **整体尺度 ×2**：所有长度 ×2（含 `PC=4√3`→`8√3`），同样通过。
- **更正**：本文早前版本把"换点名变式"记成产品缺口（见证搜索判 `underdetermined-planar`）。
  复查发现是**测试写错了**：`∠BAD`（顶点 A，边 BA、AD）被换成 `∠PQR`（顶点 Q），
  正确的换名是 `∠QPS`（顶点 P）。按题面语义改正后一次通过 —— 所以那不是产品限制，
  是这轮测试作者的错。记录在此，避免把"我们写错了"当成"系统做不到"。

### 5.4 浏览器闭环（2026-10-24）

`e2e/agent-fold-preview.spec.ts` 走真实产品路径（本地确定性规划器 → 协调器 → 折片编译 →
隔离草稿 → 用户确认 → 提交 → 一步撤销），**1 passed（7.1s）**：

1. 发送 `USER_FOLD_PROMPT`（四边形 + 定比分点 + 沿 EF 翻折 + `PC=4√3`）；
2. 运行状态停在「等待你确认」，确认面板出现且写着「只占一步撤销」；
3. 确认前画布对象数为 **0**（草稿真的隔离）；
4. 确认提交后画布出现 18 个对象（四边形、`E`、`F`、折后的 `P` 与折片面），工作区切到立体几何；
   现场图：`test-results/fold-preview.png`（生成目录，不进源码提交）；
5. `Ctrl+Z` 一步撤销 → 对象数回到 **0**。

**这一条不能当成模型质量评测**：题面命中的是本地规划器的固定入口（`userFoldPlan`），
它证明的是"折片能编译、预览、确认、撤销"，不是"模型能读懂任意翻折题"。

### 5.5 两次顺序折叠的浏览器闭环（T6，2026-10-24）

`e2e/agent-fold-chain.spec.ts`（**1 passed / 7.6s**，与 §5.4 同批跑 **2 passed / 8.9s**）：
题面为"先沿 EF 翻折 90° 至 △PEF，再沿 PF 折叠 60° 至 △QPF"，夹具**只给四边形**，
折痕端点与两笔 `solid.fold` 全由连续折叠构造生成；浏览器里同样走
等待确认 → 草稿隔离（确认前对象数 0）→ 确认提交 → 画布出现折后图形 → 一步撤销归零。
现场图：`test-results/fold-chain-preview.png`。

**边界**：浏览器断言的是"这条路径能走通并落盘/撤销"；"两笔折都在"这一结构由
`planCompiler.foldConstruction.test.ts` 的单元用例钉住（第二笔 `hinge={P,F}`、`angle=60`）。
题面同样命中的是本地固定入口（`userFoldChainPlan`），不是模型泛化能力。

### 5.6 欠定与矛盾的披露（T5，2026-10-24）

`planCompiler.foldMultiplicity.test.ts`（4 条）：

| 输入 | 行为 |
| --- | --- |
| 题面只说"沿 EF 翻折至 △PEF"，**没给折角、也没有终态约束** | 仍然出静态示意图，但追加 `witness.foldAngleAssumed`：「按 90° 折作静态示意，不是题设结论」；`witness.foldConstruction` 的文字也改说"折角方向题面没有给出"，**不再谎称"折角反求"** |
| 题面点名了折后点（`PC=4√3`） | 折角被整题核验约束住，文字说"在整题核验中成立（没有再单独反求）"——**不**贪功说成反求 |
| 题面给的折角明确（连续折叠那条） | 文字说"题面给出的折角（N°）" |
| 目标条件矛盾（`PC=4√3 且 PC=10`） | **失败**、`diagramVerification≠passed`、不带 `witness.foldConstruction`，诊断里点名 `PC` |
| 底图条件矛盾（`AB=8 且 AB=10`） | 同样如实失败，诊断里点名 `AB` |

这条修的是一个**披露**缺陷：旧实现在"题面既没给角、也没有能反求的约束"时悄悄用 90°，
而 assumption 的文字还写着"折角反求"——用户会以为 90° 是题面算出来的。

## 6. 仍未覆盖（如实记录）

1. **换点名/尺度的单折变式**已通过（见 §5.3）。**仍缺**的是"数值解不存在/多解"那类变式：
   当前用例只覆盖了一条可解的四边形折片，没有钉住"多解时如何披露方向筛选"与
   "矛盾条件如何如实失败"。
2. **T3 剩余**：能力探针现在真的带 `response_format` 并据此判证据（参数被拒 ⇒ `unknown`），
   但 `maxOutputTokens` 仍没有"按模型配置取值"的来源 —— 默认不发，靠各协议缺省。
   另外 `json_schema` 档目前**没有任何探针证据**能产生，生产路径不会发它（有意保守）。
3. **T6 已接线但范围窄**：`planCompiler` 只对**已判成可解**的顺序链接线（两条、折角明确、
   底图是"四边形 + 比例折痕"这一族），并拒绝在链不可解时只折第一条；
   多未知折角的联立求解仍未实现（任务书把它单列为里程碑）。
4. **T7 是离线回放，不是模型评测**：`fixtures/replay.test.ts` 的 provider 响应全部是**模拟**的
   （固定文本/固定事件），断言的是"管线对给定输入的处置"；**没有**传输完整率、
   真实截断率、真实 schema 通过率或费用读数 —— 那需要当前服务配置与预算授权。
   题面覆盖只有 9 条代表写法，不含多解/欠定/矛盾与非平面族。
5. **浏览器端到端**：单折与**两次顺序折叠**的"预览 → 确认 → 提交 → 一步撤销"都已跑通
   （§5.4 / §5.5，`2 passed / 8.9s`）。**仍缺**：真实模型响应下的浏览器回归
   —— 需要模型服务与预算授权；两条用例命中的都是本地固定入口，不能当成模型泛化证据。
6. **真实模型验证**：全部规划相关用例都是模拟响应；没有调用付费模型。

## 7. 修改文件

- `packages/agent-core/src/outputParser.ts`、`coordinatorPorts.ts`、`coordinator.ts`、
  `modelEvents.ts`、`figureIntent.ts`、`planCompiler.ts`
- `apps/web/src/agent/modelPlanner.ts`、`localPlanner.ts`、`agentRunner.ts`
- `apps/web/src/agent/fixtures/*`（评测入口适配判别联合）
- `apps/desktop/src-tauri/src/providers/normalize.rs`、`adapter.rs`、
  `apps/desktop/src-tauri/tests/provider_adapter.rs`
- 测试：`coordinator.test.ts`、`modelPlanner.test.ts`、`figureIntent.test.ts`、
  `planCompiler.foldConstruction.test.ts`

## 8. 验证命令与读数（本轮实际执行）

| 命令 | 读数 |
| --- | --- |
| `npx tsc -p packages/agent-core/tsconfig.json --noEmit` | 0 error |
| `npx tsc -p apps/web/tsconfig.json --noEmit` | 0 error |
| `npx vitest run modelPlanner / outputParser / coordinator / localPlanner` | 182 passed |
| `npx vitest run figureIntent + planCompiler.foldConstruction` | 15 passed |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test provider_adapter` | 31 passed / 0 failed |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test providers` | 23 passed / 0 failed（含 T3 三条：模式只在要求时发、无 schema 降级、上限字段名） |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test provider_capability` | **22 passed / 0 failed**（含 T3 三条：参数被拒 ⇒ `unknown`、严格模式可用 ⇒ `verified` 且请求体真带 `response_format`、接受但回散文 ⇒ `failed`） |
| `npm run lint` | exit 0，**0 error / 15 warning**（全是既有基线警告） |
| `npm run build --workspace @draw/web` | exit 0（591 modules，5.29s） |
| `npx vitest run --maxWorkers=2`（全量） | **482 文件 / 5098 通过 + 1 todo / 0 失败**（`D:\数学画布\t21-full-test.log`） |
| `npx playwright test e2e/agent-fold-preview.spec.ts` | **1 passed（7.1s）**：预览 → 确认 → 提交 → 一步撤销；现场图 `test-results/fold-preview.png` |
| `npx playwright test e2e/agent-fold-preview.spec.ts e2e/agent-fold-chain.spec.ts` | **2 passed（8.9s）**：单折与两次顺序折叠各自的闭环；现场图 `test-results/fold-preview.png` / `fold-chain-preview.png` |
| `npx playwright test`（全部 agent 用例，27 个 spec） | **59 passed（43.5s）** |
| `npx playwright test`（**全仓 e2e**） | **241 passed（3.0m）**（`D:\数学画布\t23-all-e2e.log`） |
| `npx tsc -p e2e/tsconfig.json --noEmit` | 0 error |
| `git diff --check` | exit 0（无空白错误） |

## 9. 下一步（按任务书顺序）

1. **T6 浏览器补齐**：已补（§5.5）。
2. **T5 覆盖**：欠定/矛盾/题面给角三档已补（§5.6）；多解分支披露由既有 `foldBranches` 用例覆盖。
3. **T3 剩余**：`maxOutputTokens` 的"按模型配置取值"来源。
4. **T7 扩容**：真实 provider 的读数（需配置与预算授权）；离线回放集可继续补多解/欠定族。

## 10. 完成判据逐条对照（任务书 §12）

| 判据 | 结论 | 证据 |
| --- | --- | --- |
| 字段错误不再退化成"不是 JSON 对象" | 达成 | §2.1 E1/E3；`coordinator.test.ts` + `modelPlanner.test.ts` |
| 截断、空输出和协议失败得到准确分类与有界恢复 | 达成 | §2.1 E2、§3；`response_incomplete` / `empty_output` / `invalid_json` / `provider_refusal` |
| 请求格式与已验证能力一致，参数真正到达 HTTP | 达成 | §4；`providers.rs` 三条断言请求体里真的有 `response_format` / `max_tokens`；`provider_capability.rs` 参数被拒记 `unknown` |
| 工具 schema、提示词、运行时校验器一致，`normalisations` 可达 | 达成 | E4 修复；`buildPlanToolSchema` 含 `normalisations` |
| OpenAI-compatible 与 Anthropic 响应回放通过，协议范围明确 | 达成 | `provider_adapter.rs` 31 条（含增量分片、非流式、UTF-8 截断、断流） |
| 单折叠语义变式与点名变式通过 | 达成 | §5.1–5.3；`figureIntent.test.ts` 9 条 + 换名/尺度用例 |
| 默认配置下单折构造、回代、预览、确认、撤销闭环 | 达成 | §5.4；Playwright 1 passed |
| 两次明确角度的顺序折叠代表链路 | 达成 | §5.5；单元断言两笔 fold + 浏览器闭环 |
| 核验没有放宽，未识别题设没有被丢弃，确认边界有效 | 达成 | §5.6（矛盾必须失败；链不可解时拒绝只折第一条） |
| 静态检查、单元/集成、浏览器检查已执行，阻碍清楚列出 | 达成 | §8 读数；真实模型读数与多未知角联立求解**按任务书要求**分别列为"需授权"与"独立里程碑" |

**外部阻塞（按任务书 §7 的口径如实列出）**：真实 provider 的传输完整率 / 截断率 /
schema 通过率 / 费用读数**没有**任何数字 —— 需要当前服务配置与预算授权；
本轮所有 provider 响应都是模拟的。

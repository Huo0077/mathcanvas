# MathCanvas 项目进度

> 这份文件是项目的单一进度记录。每完成一个可验证的切片，就更新“已完成”和“下一步”，并附上验证证据。

**最后更新：** 2026-09-21（**G2 第二十二批：修掉"传输层 → 动作层"接缝上的真实缺陷** —— `object.update_inputs` / `dynamic.bind_point` / `dynamic.bind_curve` 三个动作此前**不存在任何一种能同时通过校验并被正确编译的输入**：`schemas.ts` 产出 `{scope:"scene",ref:{…}}`，编译器读扁平的 `inputs.target.documentId`。缝之所以没被发现，是因为两侧测试各自只喂自己那一半的形状；新增 `planToCompile.seam.test.ts` 用**已校验的输出**钉住这条接缝（修前 2 红，修后 3 绿）。同时把 `draftStore.previewHash` 从"整份候选文档的 JSON 字符串"换成真 SHA-256（`canonicalContentHash`）。同日更早：**G2 第二十一批：确认面板（`ConfirmationPanel`）+ 在它上面抓到一个真实的数据暴露（Task 2.5 Step 4）** —— 新增 `ConfirmationPanel.tsx`（17 例），逐条实现计划点名的六样东西：精确计数（只列真有变化的类别）、假设、来源与目标、近似、**删除警告**（净删除 > 0 才报警，并说明只能靠撤销恢复）、一步撤销声明；计数缺省时如实说"规模无法核对"而非编数字。**修掉一处重复渲染**：`RunStatus` 与新面板会各给一份"确认并提交"，页面上出现两个同名按钮（e2e 立刻报"找到多个按钮"），已把草稿 UI 完全归新面板。**本批最有价值的发现**：面板第一个版本把"预览指纹"打在界面上，而 `draftStore` 用 `contentFingerprint`（返回**规范 JSON 字符串**，不是哈希）填这个字段 —— 于是**整份候选文档被渲染出来**，违反了我自己在第二十批写下的"草稿在界面里只是视图"那条不变量；**是 e2e 读出来才发现的**，现已不显示，并把"面板不含 primitives"变成正式断言。**未顺手改** `draftStore`（把 `previewHash` 换成真正的 `canonicalContentHash` 会改变 CAS 比较基准，属需单独验证的改动，已记入待办）—— 该待办已在第二十二批落地。单测 **174 文件 / 1957 用例全通过（零跳过）**、e2e **119/119**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第二十批：把对象计数交给宿主** —— 计划要求确认面板给出 "exact changed IDs/counts"，而数字**必须来自真实候选文档**（界面自己估的与真正落盘的一旦不一致，用户就是在确认一件他没看见的事）。修法：把 `countDraftObjects` 从 `apps/web` **移到 `@draw/agent-core`**（确认面板要给的是"候选 vs 基础"的对比，宿主侧与界面侧必须用同一个函数），`PreviewArtifact` 增加 `counts` / `baseCounts` 并由 `preview()` **现取**基础文档（旧快照会把"多出多少"算错）。判据仍只有一处（直接取 `derivedPrimitives` 的 `isDerivedPrimitive` / `isTessellationPrimitive`）。**如实标注**：本批只做地基，`ConfirmationPanel.tsx` 组件本身还未写。单测 **173 文件 / 1940 用例全通过（零跳过）**、e2e **119/119**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十九批：停止与重试接上真实取消** —— `agentRunner` 新增 `stop()` 与 `retry()`（+4 例），界面按钮不再是摆设：`stop()` 走协调器的**真实取消**（cancel 置位 + abort 各端口信号 + 账本收尾到 `cancelled`），只在确实成功时返回 true，没有运行时实例就如实返回 false；**取消后草稿一并作废**（留着会让用户看到一份永远不会生效的预览，有用例断言"停止后再点确认必须被拒"）；文案说清后果"没有改动文档"并标 `retryable: true`。`retry()` 用同一句话跑新一轮，取"上一句话"的判据与自动运行一致，找不到就什么都不做。一处自纠：`retry` 原用 `this.run(...)`（`this` 太脆），改为闭包内具名函数。**如实标注**：本地规划器一轮只要几百毫秒而停止按钮只存在于 pending 期间，**浏览器里点它必然是抖的**，所以停止/重试由单测覆盖、不写成 e2e，等真实 provider 让单轮变成秒级再补。单测 **172 文件 / 1938 用例全通过（零跳过）**、e2e **119/119**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十八批：修好上一条浏览器阻塞** —— 上一批那条红的 e2e 转绿，**根因是我自己的 store 逻辑**：`recordDraft` 保留了 `pending: true`，于是运行明明停在"等你确认"，界面却一直显示"进行中"（`RunStatus` 的判据是 pending 优先）。修法：记草稿时同时把 `pending` 清掉，并补一条 store 用例正面钉住。**我上一轮的两个诊断都被实测推翻并如实记录**：Playwright 服务旧 bundle 不成立（`global-setup` 每次重新 build）；把超时从 5s 提到 30s 仍在 61 次轮询里全是"进行中"，从而排除了"慢"。关于"控制台没输出"：真正原因是**生产构建会摇掉 `console.log`** —— 所以那不是证据，换用 `page.evaluate` 读 DOM 才拿到决定性事实（轨迹已到"等待你确认"、草稿已存在，而 `data-status` 仍是 running）。**教训：在构建产物里用日志做诊断不可靠，要读状态。** 新增的 3 条浏览器用例全绿（完整链路 / 丢弃草稿 / 认不出时问用户）；另有一条既有 e2e 的前提被 `prepare` 的工作区切换改变，已**如实改写并注明原因**而不是放宽断言。单测 **172 文件 / 1934 用例全通过（零跳过）**、e2e **119/119**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十七批：编译前的目标准备** —— 修掉一个真实设计缺口：编译器会拒"工作区不匹配"的动作（实测 `solid.create_template` 在平面几何里返回 `workspace_mismatch`），而用户在 Agent 里说"建一个立方体"时画布可能停在平面几何 —— 给协调器加 `prepare(plan)` 钩子，在**编译之前**调用（顺序是关键），运行器据此切工作区；**工程制图不参与自动切换**（直接切走会让用户图纸上下文消失，如实拒绝更尊重用户）。新增 `e2e/agent-flow.spec.ts` 三条浏览器用例：**丢弃草稿**与**认不出时问用户**两条通过，**完整链路那条失败**。**如实记录未修好的部分**：浏览器里发送后状态停在"进行中"，我加的浏览器事件追踪**没有捕获到任何控制台输出**，说明"没打出来"这件事本身还没查清，**没有据此下结论**；诊断代码已全部删除并确认零残留。`e2e/app-modules.spec.ts` 里另有一条既有用例因**同一根因**失败（所以是一个阻塞点，不是两个）。本批**不报完成**。单测 **172 文件 / 1933 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、e2e **117 通过 / 2 失败**。同日更早：**G2 第十六批：确认并提交真正落盘** —— 新增 `agent/agentRunner.ts`（8 例），把"运行 → 确认 → 提交 → 撤销"整条链走通：此前草稿能暂存能显示，但**点确认没有回调**。运行器**跨"运行结束→用户点确认"活着**（协调器按运行建，而确认发生在运行之后），做成模块级单例（组件切模块会卸载，放组件状态会丢掉等待确认的草稿）；界面唯一能触达提交的地方只调 `HostBridge.requestConsent` + `commit`，拿不到 `commit` 也造不出凭据。用例逐环覆盖 G2 Gate 那条链：暂存后文档不变 → 确认后真的变且**恰好一步历史** → `undo()` 一步回原样 → **拒绝二次提交** → 丢弃后文档与历史都不动 → 规划器认不出时给"需要补充信息"而非编回答。**测试抓到转移表一个真实缺口**：`answering → waiting` 漏了，导致"问澄清问题"永远停不到 `waiting`（用户看到空消息且无处可答）—— 这是第二次由用例逼出转移表修正。同时删掉 App 里那份重复的运行实现（改为转发），并清掉随之失效的死代码（lint 17 → 回基线 14）。单测 **172 文件 / 1930 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning。同日更早：**G2 第十五批：删掉演示回复，接上真实运行** —— **删除 `agentDemoReply.ts`**（计划 G2 Gate 逐字要求生产路径上不再有演示回复），`AgentWorkspace` 改成"只发起 + 只显示"（注入 `onRun(prompt, promptMessageId)`，组件里**没有任何"没有模型就编一段"的分支**）；新增**本地确定性规划器** `localPlanner.ts`（10 例）—— 它不是换个说法的演示回复：产出的动作真的会被编译、进草稿、要求用户确认，**认不出时问用户而不是编答案**，每条输出都过 `parsePlanEnvelope` 且确定性；`App.tsx` 接上真实 `createAgentRuntime` 并把每一步阶段回流到运行状态卡；`AgentMessageList` 渲染状态卡同时**保留**在途气泡的 `role="status"` 标签（屏幕阅读器要靠它）；e2e 断言从"演示回复里有代码块"改成"**运行真的发生了**"（状态卡可见、无"已提交"、不留下永远转圈的进行中）。单测 **171 文件 / 1922 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十四批：消息模型与运行状态卡** —— 扩展 `agentStore.ts` 的消息模型（助手消息可带 `runId` / `trace` / `draft` / `commit` / `failure`），把上一轮查明的 Task 2.5 阻塞点拆开。**草稿在界面里只是"视图"**（标识 + 计数，**没有候选文档**）—— 把候选文档放进 store 会让用户几何数据的副本被持久化进 localStorage，并让界面成为第二份真相；有用例断言持久化内容里不含 `primitives`/`candidate`。**迟到事件被丢弃**（没有在途消息时什么都不做、终态后 `pendingReplyId` 清空），对应计划点名的 "late response"。新增 `RunStatus.tsx`（12 例）逐字实现 Step 3：进度要说得出来（进行中 + 哪一步 + 整条轨迹）、**状态不只靠颜色**（每条轨迹带"成功/注意/失败"文字）、失败给原因码与"重试/改一改"（**不可重试就不给重试按钮**）。测试抓出一个真实缺陷：草稿已暂存但不再 pending 时整块预览**不渲染**，用户看到空消息却无处可点。单测 **170 文件 / 1908 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十三批：运行遥测与脱敏** —— 新增 `agent-core/src/events.ts`（18 例）。`redactDiagnostic` 的核心不是"能替换已知密钥"，而是**没有已知清单时也不漏**（默认拒绝：`Authorization` 头、JSON 里的 `apiKey`、URL 查询串、`sk-`/`ghp-` 前缀串、**任何 32 位以上的长随机串**一律替换），同时**普通诊断原样保留**（脱敏过度会让日志无用），循环引用不抛错（它跑在错误路径上）。`appendRunEvent` **只追加 + 按 eventId 幂等**（重复是 no-op，先到的不会被改写），并有 `byId` 支撑中断后的 **commit-receipt recovery**；写入前做**结构检查**，发现 `reasoning` / `imageBytes` 就拒绝（不是静默过滤）。账本有界，事件带全九个标识与三方版本。**查明 Task 2.5 的阻塞点并如实记录**：删演示回复不是替换一个函数，而要改消息模型（纯文本 → 事件流＋草稿状态＋提交回执），本轮未动它以免界面进入"发送后什么都不显示"的中间态。单测 **168 文件 / 1888 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十二批：宿主组装** —— 新增 `apps/web/src/agent/agentRuntime.ts`（7 例）。**此前从未验证过"这套东西能不能一起跑"**：每个部件各自有测试，但没有一处把它们连起来。这个文件的测试**一个替身都不用**（真实 `DraftStore` + 真实 `HostBridge` + 真实 `createCommitterAdapter` + 真实协调器，只有模型调用是脚本化替身）。关键性质各有独立用例：一次规划运行后**真文档一个字节都没变**；只读运行事件序列为 `preflight → observing → planning → answering → completed`；**刻意不注入同意凭据**，所以带 `confirmed: true` 也提交不了；工具与提交器**共用同一个草稿存储**（否则模型看到的草稿与提交的不是一回事）。接线时被类型检查抓到**四处真实 API 不一致**（`createHostBridge` 不在 agent-core、端口真名是 `DraftStorePort`、`DraftStore` 只有 `invalidate` 没有 `discard`、`diagnostics` 可选而端口要求必有），另补齐漏掉的 `unknown_draft`。改端口名时我一度用了 PowerShell 文本替换——正是第六批毁掉文件的同一手法——这次显式 `-Encoding UTF8` 并**立刻读回确认**中文完好。单测 **167 文件 / 1870 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十一批：CommitterPort 接上草稿与宿主** —— 新增 `committerAdapter.ts`（12 例），把协调器接到 G0.5 的 `DraftStore` + `HostBridge`：暂存只产生隔离草稿、提交委托给 `HostBridge`（**不复制**同意与 CAS 那套判断，复制就是把安全边界摊成两份）、失败原因不合并（`stale_draft` ≠ `stale_draft_version`），并**记住本次运行用的草稿**（记不住就会提交一个用户没看过的预览）。同时修掉两个真实缺口：① `CommitRequest` 原先只有 `actionCount`、**没有动作本身**，适配器拿不到动作；② agent-core 的 `contracts.ts` 有一份**自己的** `DraftAction`，与动作层的**不是同一个类型**，导致解析出的动作传不进编译器 —— 现已归一为动作层那一份（运行时仍逐字段校验，只保留一处有说明的 `as`）。测试替身第三次咬人：假 `HostBridge.preview` 恒返回版本 1，而真实实现读当前版本，导致第二次暂存被判过期。单测 **166 文件 / 1863 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第十批：交互工具与 WinAnsi 规则归一** —— 新增 `tools/interactionTools.ts`（11 例）。三个工具（`ask_clarification` / `propose_view` / `propose_export`）**只提议、不执行**；`propose_export` 刻意**消费**导出预检而不是自己算（再算一遍必然导致"建议与执行不一致"），并把干净 / 有损失需接受 / 被阻止三种结局分开，预检自身失败时如实报错而**不编一个看起来能导出的提议**，损失列表每类最多 6 条且截断有诊断。**顺带做掉一处真实重复**：`winAnsiSafe` 原先只在 app 的导出器里，导出预检也要报同一条损失，分叉症状是"界面说有损失、Agent 说没有" —— 规则已移到 `agent-core/src/winAnsi.ts`，app 两处改为导入（导出器保留别名，PDF 调用点零改动），并**按原文去重**（原先同一标签会报很多次，把"有损失"变成噪音）。两次自纠：改 `exportService.ts` 时一次编辑切掉了半个函数体（下次读文件立刻发现并修好）；测试夹具把"有损失需接受"误写成 `supported: false`（那是"被阻止"），是实现无误、测试有错。单测 **165 文件 / 1851 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第九批：草稿工具与场景工具** —— 新增 `tools/draftTools.ts`（12 例）与 `tools/sceneTools.ts`（8 例）。草稿工具逐条落实两条纪律：**这一层永远不说"文档改了"**（有个用例把六条路径的结果全部序列化后断言不含 `"changed"`，因为计划原文是 "No tool function returns a fake `changed: true`"）、**失败后草稿必须原样未动**（底层若偷偷改了会额外报 `draft_mutated_on_failure`）；旧版本号不合并、空批次不到存储层。场景工具把观察层包成带信封的工具，并做到**重名标签绝不猜**（给观察层加了 `resolveLabel`：两个「点 A」时返回全部候选并让模型去问用户），且把 `entity_not_found` 与 `document_not_in_context` 分开（换个名字 vs 检查作用域，处置完全不同）。单测 **164 文件 / 1840 用例全通过（零跳过）**、`agent-core` 单包 **200 例**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第八批：把"环境"参数真正接上** —— 实测发现 `ToolEnvironment` 的 `workspace` 与 `capabilityRevision` **声明了却完全没用**，于是模型在平面几何工作区也能看到空间建模与制图工具、能力修订号漂移了也没人发现。给 `ToolDescriptor` 加**必需**的 `workspaces` 字段并真正按它过滤，另加 `describeEnvironmentMismatch()` 让修订号不一致变成可见诊断；同时补上两个真实受约束的工具（`scene.check_section` / `cad.inspect_drawing`）。两次自纠：typecheck 抓到"只改了一半目录"（六处缺字段），esbuild 抓到遗留括号导致测试**收集阶段失败**——而"no tests"与"全过"看起来都像绿色，必须按错误码确认。单测 **162 文件 / 1820 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第七批：模型输出通道、有界恢复与网关通道选择** —— 新增 `outputParser.ts`（19 例）、`recovery.ts`（19 例）、`modelGateway.ts`（12 例）。解析器做成**两个可区分通道**（严格 JSON 不剥围栏 / 文本通道允许恰好一层 ```` ```json ````），**绝不抠取散文里的 JSON、绝不修补字段**，修复提示带精确字段路径且**按通道给格式建议**、不回显模型自己的话。恢复策略把"要不要再试一次"做成一条表：**auth / permission / geometry / contradictory_fact 一律不自动重试**（传输层的 401 会归类成 auth，不会被当成网络抖动），只有 429/5xx/连接中断可重试，schema 修复**一次性**，流损坏走 `refresh_context` 而非原样重发，每条决定都带理由与预算代价、停下时不收费。网关只依据**已验证**能力选通道（`declared` 不算），未验证就不发工具 schema；视觉单独判（"文本 ping 成功不等于视觉已验证"）。**如实标注**：真正的 `generate` 调用、`modelClient.ts` 与协议 fixture 集成测试都被 G1 的 Rust 工具链缺失挡着；本轮做的是**发请求之前**的通道与能力计划。单测 **162 文件 / 1817 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第六批：工具注册表与上下文组装（Task 2.2 完成）** —— 新增 `toolRegistry.ts`（12 例）与 `contextBuilder.ts`（12 例）。工具按阶段发布（观察阶段**一个写入工具都没有**；提交工具只在 `awaiting_confirmation` **且用户已确认**时出现，否则模型根本看不到它）；上下文组装把"绝不包含凭据 / 工具实现 / 思维链"落成**结构事实**（入参里就没有这些东西，并有用例钉住 `BuildContextInput` 的键），过期引用**不进列表、进警告**且不占分页名额，上限只能收紧不能放宽。两处诚实记录：① 我第一版把 `plan.set_plan`（只提议计划）与 `confirm_commit`（唯一写文档）混为一类，被"规划阶段不许有写入工具"当场挡下 —— 纪律没错，是**分类太粗**，已细化为四类；② 测试的 `ref()` 辅助函数把两个哈希写成同一个入参，导致"过期引用"用例测的是空气 —— 与前面几轮同一教训：**替身比生产代码宽松就失去判别力**。单测 **159 文件 / 1767 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第五批：九个技能清单与哈希校验目录** —— 新增 `skills/manifest.ts` + `skills/catalog.ts`（11 例）：计划要求的九个清单全部写齐（actionIds / limits / 成功案例 / 拒绝案例），且是**纯声明式**（只有 id、标题、描述、动作名、数字上限，没有函数或可执行片段）。`SkillCatalog.load` 四道校验：**哈希校验**（有用例构造"打包后被改过"的清单并断言诊断给出实际哈希）、动作名仍存在、修订号匹配、未注册 id 拒绝。另加 `CAPABILITY_FOR_ACTION` 显式对应表（能力注册表按 `DomainOperation` 编号、动作层按 `family.verb`，**两套名字体系不同**，必须显式翻译；漏登记即编译失败）。**顺带修掉上一批我自己写下的真实缺陷**：`sceneObservation` 里的内容指纹是自拼的，与句柄里的 `contentFingerprint` **永不相等**，过期检测要么恒真要么恒假；而上一批的测试复制了同一个错指纹，所以测试是绿的 —— 一个自洽的错误。单测 **157 文件 / 1743 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第四批：修掉传输层与动作层的登记表错位** —— 实测出本轮最重要的缺陷：`schemas.ts` 的 `ACTIONS` 只认 **4** 个 actionId，而动作层实现 **20** 个，于是**十几个已实现的合法动作从模型输出一律被拒**，且报错是 `unknown_action`（看起来像"模型编了个不存在的动作"，实际是登记表过期）；其中 `object.delete` / `object.update` 更是动作层根本不存在的名字。另有三处载荷形状也错（`section.create` 收裸 `sourceId` 而非作用域引用、`solid.create_template` 白名单多出 `segments`、两种引用语义未区分）。修法是**两道守卫 + 一张按真实形状重写的表**：动作层导出 `DraftActionId`，`actionIds.ts` 的规范清单用 `satisfies` 挡"多写"、用 `Record<DraftActionId, true>` 挡"漏写"（少一个多一个都编译失败），运行期再核对一次；传输层只认名字与畸形载荷，**语义校验留给编译器**（那份已存在且唯一）。修正当场暴露 4 条夹具是错的。单测 **156 文件 / 1732 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第三批：场景观察工具与判据去重** —— 新增 `agent-core/sceneObservation.ts`（14 例）：模型看场景的唯一窗口（`inspect`/`search`/`describe`/`dependencies`），计划 Step 1 点名的五件事逐条落地 —— 按文档解析（同 id 在两份文档里解析成各自的对象）、重名标签**列出具体 id**、内部近似细节既不列出也拒绝 describe、过期快照报 `stale_source` 不静默回退、分页夹紧且**截断必须说出来**（空查询不返回整份文档）。**产出二是消掉一处真实重复**：派生素型清单原本在 `apps/web`，场景观察也需要同一份，故**移到 `@draw/agent-core`**（依赖方向是 web → agent-core）并删掉 app 侧那份 —— 这个项目已因"同一个判断写两遍"吃过两次亏。单测 **155 文件 / 1727 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G2 第二批：协调器与四组端口（Task 2.1 完成）** —— 新增 `agent-core/coordinatorPorts.ts`（`PlannerPort` / `ObserverPort` / `CommitterPort` / `ToolPort` 四组**注入**接口；`ConsentToken` 做成不透明载荷，协调器既不能伪造也不能从模型输出里读出来）与 `agent-core/coordinator.ts`（19 例）。计划 Step 1 点名的九个场景一个不少：成功只读、成功草稿、缺事实（走 `waiting` 不猜）、输出非法（一次可见修复后仍失败）、草稿过期、提交前取消、提交中取消、provider 失败、应用中断；另加预算与事件标识两组。**本轮最有价值的产出是转移表当场否掉了我自己写的捷径**：第一版在 `validating` 后直接跳 `committing`，八条用例一起失败在 `illegal_transition` —— 确认状态是账本必须留下的记录，不是 UI 细节（跳过它就无法区分"用户确认过"与"调用方直接调了提交"）。单测 **154 文件 / 1713 用例全通过（零跳过）**、`agent-core` 单包 73 例、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G1 环境阻塞（缺 Rust）+ G2 第一批：运行账本与预算** —— 新增 `agent/workerContracts.ts`（12 例）、`agent/workerRuntime.ts`（5 例）与真实的 `agent/geometry.worker.ts` / `agent/agent.worker.ts`。逐字实现计划的两条要求：五个信封字段（`runId`/`draftId`/`draftVersion`/`requestId`/`schemaVersion`）缺一即拒；**未知 kind 丢弃并诊断**而不是抛异常（抛出去一条不认识的广播就能把管道打死）。规则做成纯函数、worker 文件只做接线——在 `self.onmessage` 里写业务逻辑，那段判断在 jsdom 里跑不起来也就永远没有测试。失败一律收敛成 `geometry.error` 响应（异常穿过 `postMessage` 会变成 `ErrorEvent`，调用方拿不到原因码）。`agent.worker.ts` 刻意**不写假协调器**（真状态机属 G2）。单测 **151 文件 / 1667 用例全通过（零跳过）**、e2e **116/116**、生产构建通过、typecheck exit 0、lint 0 error / 14 warning（基线）。如实记录一次既有抖动（jsdom WebGL 噪声导致的 `150 passed (151)`，随后连续四次全绿，与 worker 改动无新证据相关）。同日更早：**G0.5 第九批：草稿预览面板与对象计数** —— 新增 `components/agent/DraftPreview.tsx`（+7 例）与 `agent/draftCounts.ts`（+5 例）。面板逐条渲染计划点名的那份清单（用户/派生/内部计数、假设、证据、近似、导出省略、**逐字的"只占一步撤销"**），并把"不持有文档 / 不判断能否提交 / 不算数"写进类型：有用例断言 props 里**没有** `document` 与 `replace`，预览绝不落盘。计数把 `hidden` 与 `derived` 各列一档（隐藏的用户对象若并进可见数，用户会以为确认后画布上会多出东西；派生且隐藏的仍算派生，因为分类问的是"它是什么"）。顺手把原先只写在 `interaction.ts` 里的派生素型清单收敛到中立的 `derivedPrimitives.ts`（第一版误放在 `agent/`，层向反了，已改）。**诚实标注：组件尚未接进 `AgentWorkspace`**，浏览器里仍没有可点的预览面板。单测 **149 文件 / 1650 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G0.5 Gate 对账 + 第八批：端到端提交管线** —— 新增 `apps/web/src/agent/pipeline.test.ts`：**一个替身都不用**，真 `useSceneStore` + 真 `DocumentPort` + 真 `HostBridge` + 真 `DraftStore` 串起来，逐条证明 G0.5 的四条 Gate（隔离草稿 / 显示与导出同源 / 手工编辑使草稿过期且不覆盖新头 / 同意一次性·绑定哈希·会过期·不能由助手文本生成）。顺带发现并补上一条**没被覆盖的判断**：`DraftStore.assertFresh` 因为 `commit` 走的是 HostBridge 的 CAS 理由而**碰不到**，不单测的话它可以被整体删掉而全部测试仍然绿。另做了 RED 验证：删掉一次性 nonce 闸后两条用例都失败（且第二次提交被 CAS 挡成 `stale_source` —— **写入仍然被挡住，但拒绝理由是错的**，这正是断言必须存在的原因）。单测 **147 文件 / 1638 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G0.5 第七批：来源解析贯穿图纸树与检查器** —— 修掉一个真实缺陷：`sourceLabels` 与检查器"投影来源"**只查布局文档**，于是切到"投影立体几何"之后，**四个视图里看得见的空间对象会被标成"来源已删除"**。新增 `projectionSource.ts` 的 `resolveProjectionSourceEntity` / `resolveProjectionSourceLabels`（显示文档优先 → 布局 → 空间；两份都找不到才算 missing），并让图纸树标签表从检查器那份解析**派生**（同一判断不再写两遍）。两个独立 RED 证据。单测 **146 文件 / 1633 用例全通过（零跳过）**、e2e **116/116**、typecheck exit 0、lint 0 error / 14 warning（基线）。同日更早：**G0.5 第六批：App 级来源切换的导出断言（Task 0.6 Step 5 收尾）** —— 补上计划点名却一直缺的那条用例：新增 e2e `exports the switched projection source instead of the drawing's own document`，它**读回下载的 SVG** 再断言图元来源（只看画布 DOM 会漏掉"显示立方体、导出空图纸"这个真实缺陷）。已做 **RED 验证**：把 `App.tsx` 的来源解析改回 `document` 后该用例给出 `expected > 0, received 0`（画布有投影、导出里 `data-source-id` 计数为 0），恢复后通过，该 spec 13/13。同日更早：**G0.5 第五批：CAS 写入接进真实 store（Task 0.7 Step 5 收尾）** —— 新增 `apps/web/src/services/sceneDocumentPort.ts` 把 `DocumentService` 接到真 `useSceneStore`，并给 store 加了 CAS 的唯一落盘入口 `commitCandidate`。本批最有价值的是**测得一个能静默废掉整套 CAS 的坑**：zustand v5 的 `setState` 每次整体换根对象，所以 `getState()` 是**快照**——端口若闭包住它，四道闸就永远在旧值上比较，`stale_generation` / `stale_epoch` 全部失效而测试照样全绿；端口因此改收 `() => state`，并留下一条专门钉住此事的用例。另修掉 `{ epoch: undefined }` 仍算"有该属性"导致 `port.epoch?.()` 抛 `TypeError`。单测 **146 文件 / 1628 用例全通过（零跳过）**、e2e **115/115**、typecheck exit 0、`git diff --check` clean。同日更早：**G0 第一批：可信执行底座三块地基** —— Agent 能力注册表（42 图元 / 38 操作全覆盖 + 四项显式阻止）、传输契约与运行时 schema（未知字段/未知 action/非有限数/未作用域引用一律拒绝）、以及堵住 `scene-graph` 的 unknown-operation 与 false-change 两个洞（含入口处的非有限数值闸）。单测 137 文件 / 1556 用例、e2e 115/115、typecheck exit 0。同日更早：**数值转换内联回归 + 识别口径重写**：用户口径「根据现在已有的 ui，重新优化再加上去」＋「这个近似不那么好用，手稍微偏一偏分数就没了，我们不需要那么精确，我们要将数据往常见整数和分数上面靠」＋「坐标是整数或分数时，能够准确计算时，还是保留精度」。内核 `packages/geometry-kernel/src/exact-forms.ts` 改成三层：**精确层不动**（紧容差、不带 `≈`；手输 `0.0625` → `1/16`、`0.66` → `33/50`）；**吸附层只在常见形式里找**（整数与分母 ∈ {2,3,4,5,6,8,10,12} 的既约分数带 2%，π 的有理倍数与纯根式 `b√n/c` 带 0.3%，命中带 `≈`）；两位小数兜底不变 —— 拖动出来的 `0.667023` 从 `≈ 0.67` 变成 `≈ 2/3`，而 `33/50`、`20/29`、`(11-4√7)/5`、`(5+4√39)/10` 这类"数学上更近、教学上没用"的形式不再出现。界面**不恢复那块置顶面板**，把形式贴在数字已经在的地方：画布常驻读数（2D + 3D）与属性栏测量卡片显示 `长度：0.667u · ≈ 2/3`、`角度：1.571rad · π/2`，卡片带「复制 ≈ 2/3」按钮，三处共用新模块 `apps/web/src/measurementForms.ts`。同日追加 **`e`**（用户口径「e 也需要有」）：常量族再收 **e 的整数倍**（`e`、`2e`、`-e`…），`Math.E` 读作 `e`、`2.7183` 读作 `≈ e`，不再被吸到 `≈ 27/10`；同一次追加还把吸附层的取舍改成"两族各自取最近的、再比残差谁近谁赢"（用例当场抓出"常量优先"会把 `2.5001` 判成 `≈ 2√14/3`，而它离 `5/2` 只差 0.004%）。同日更早：2026-09-18（**粒子流畅度优化两刀**：①去掉逐帧 `filter: drop-shadow`、把 `left/top` 动画换成 `transform`、取消 `alternate` 往返、粒子层提到独立合成层，动画因此能在合成器线程完成；②按用户选定"周期拉长、幅度调小"，周期 3.6–7.4s → 8–15s、上浮 8–28px → 5–11px，每帧位移降到 0.003–0.011px（120Hz）。同日更早：**顶栏重排 + 动态粒子品牌 + 打字终端卡片**：顶栏只剩居中的「MathCanvas」品牌（带确定性粒子与打字方块光标），文件命令 / 搜索 / 设置按用户口径下沉到工作区标签栏右端，高亮的「用户中心」按钮与属性面板里终端卡片的光标均已删除。同日更早：**极简主义视觉重构**：冷白 `#F8FAFC` + `#E2E8F0` 极浅分割 + 深板岩蓝 `#2C3E50`，去掉生硬边框改用柔和弥散投影分层；顶栏品牌**精确居中**（实测偏差 0.5px）、单色极细线性图标；画布转冷白纸 + 极浅网格；直线改深红褐、圆改板岩蓝；画布数学符号改数学衬线字体。同日更早：**删除右侧「精确形式」面板**：用户口径「删除右侧的"精确形式"，似乎没什么用」。删掉的是那块**只读展示**，文档里的 `measurements`、常驻画布的测量数字与内核的 `exactFormOf` 全部保留；面板的两条 DOM 用例合并成一条反向用例。同日更早：**顶级双模块骨架 + Agent 交互区**（模块 A 传统工作区 / 模块 B Agent 工作区，左侧常驻模块导航栏切换；Agent 区只搭交互骨架，未接模型服务）；同日更早：**修复"未识别为精确形式"**：用户量出来的值常常是**简单分数的六位小数写法**（坐标 `0.333333` ⇒ 长度 `0.666667`），而上一轮定的紧容差（相对 1e-9）把它判成"不是 2/3"、显示"未识别"。现在改成**两级容差**：紧容差命中 = 确定（不带 `≈`）；不中则按**输入自身十进制的半个单位**再认一次（认回 `≈ 2/3`、`≈ 1/7`，同时**不硬凑** —— `e` 与 `π/100` 仍被拒）；两层都不中**保留两位小数**（`≈ 0.64`），"未识别"这句话彻底消失。同日更早：**无限长切线 + 数值精确形式转换**：切线 / 法线缺省**无限长**（`point ± 10000`，显式「切线半长」仍可修剪，取代并删除了上一轮的 1.5 倍常量）；右侧属性栏**最上方**新增「精确形式」面板，把每个有效测量的数值识别成**整数 / 分数 / π 的有理倍数 / 二次无理数**（`exact-forms.ts`：连分数 + π 倍数 + 反解 n 的二次无理数；容差紧、认不出如实标"未识别"）——过程中**实测推翻了原设计的枚举方案**（114.9 ms → 0.561 ms），并靠浏览器用例抓到 patch 层**第五份度量名副本**（漏周长/半径，点按钮没反应）。同日更早：**由动点引申出来的图元成为一等图元**：切线 / 法线 / 割线 / 导函数 / 积分区域现在与其它图元**求交**（预览、手动建交点、持久化重算三条路都通），平面测量接受**线类 / 圆类**来源（两条线夹角、点到直线距离、圆的面积 / 周长 / 半径），切线缺省画长 **1.5 倍**；顺手把"能求交的类型"与"度量名"各收敛成 `@draw/dsl` 里**一张表**（此前各有 5 处 / 2 处副本，切线在所有地方都不能求交正是副本漂移造成的）。同日更早：**测试运行器瑕疵已根治**：`npx vitest run` 偶发报 1 个 `[vitest-worker]: Timeout calling "onTaskUpdate"`（1480 条用例 0 失败却退码 1）。根因读出来是 vitest 3.x 打进来的 birpc **写死 60 秒 RPC 超时**、与 `testTimeout` 无关；按上游口径（[`vitest-dev/vitest#8297`](https://github.com/vitest-dev/vitest/pull/8297)）把 `vitest` 由 `^3.2.4` 升到 **`^4.1.11`** 根治，升级前连跑 3 次全失败、升级后连跑 3 次全绿 + 并发 Playwright 再跑一次也干净。同日：**轨道上动点的两个缺陷已修复**（2026-09-17 的工作，rebase 接在切线一轮之后合并进来）：①`point3` 宿主白名单漏了 `circle3`，导致"轨道上只要有动点，之后加点 / 建线 / 建面全被拒"——正是用户报的"**圆轨道上的动点无法与定点建立直线连接**"；②拖动动点时点手柄画的还是文档里的旧坐标，于是"**动点移动的动画没有了……拖到哪里了根本不知道，直到松手才能看到位置**"——现在拖绑定点与拖半径手柄都实时跟手。**平面几何切线（抛物线 / 双曲线 / 圆 / 椭圆）+ 动点扩展（在动点处作切线、以动点为圆心作圆、半径随动点变化）** —— 两条用户口径已交付；随后按用户四次现场反馈修正：**切线不能拖动**、删除**空白画布中间的标题**、再删除**四个快捷按钮与提示整块**、以及**平面画布的线与点整体收细**。当天更早的记录：**立体几何最后一轮（约束轨道 / 拖动旋转 / 测量数字常驻画布 / 立体几何 UI 与平面对齐）+ 轨道圆改为独立对象 + 坐标轴钉回世界原点 + 四类模板默认落点**；**平面几何元素选颜色（色板 + 批量改色 + 无填充）**；**UI 优化（功能可见性 + 草稿纸画布 + 字号与简约装饰）**；**封闭曲线绕定点旋转（圆 / 椭圆过一个定点）+ 动圆**；**全身大体检十批 + 平面网格固定 + 全量文档状态回填**；**动点与连线的命中顺序修复**；**交点 / 交线 / 交面三个独立图元**；平面画布拖动动点不再卡顿；3D 视口与几何内核重构；平面几何动点系统）
**当前阶段：** P0-P6 与 P7 工程制图已完成；MathCanvas 统一 Ribbon UI 基线、后续 UI 优化（Task 7-13）、工程制图视觉重做（Task 14）、工程制图可用性修复（Task 15-18）、圆锥曲线四项修复、功能键操作指引浮层、CAD 2D 绘图交互重做、平面几何动点系统、3D 视口与几何内核重构、封闭曲线绕定点旋转、UI 优化（草稿纸画布）与平面几何元素选颜色均已完成。**2026-09-17 新增两条解析几何交付线并已全部落地**：**A1 解析二次曲面与"真圆"**（8 片；设计 `docs/superpowers/specs/2026-09-17-analytic-quadrics-design.md`）与 **A2 交面按支撑曲面分组 + 真曲面**（5 轮；设计 `docs/superpowers/specs/2026-09-17-intersection-face-grouping-design.md`）——用户口径从"我不要一个逼近的圆，我需要一个真的圆"一路推到"我需要的只是那个相交的曲面，而不是由很多三角形拼出来的"。**随后"立体几何最后一轮"四件事也已全部交付**（7 片；设计 `docs/superpowers/specs/2026-09-17-3d-tracks-rotation-and-measurement-labels-design.md`）：约束轨道（`circle3` 当动点宿主）、拖动旋转（世界轴三色环 + 15° 吸附 + 属性栏角度）、测量数字常驻画布（2D + 3D）、立体几何 UI 与平面几何同一套令牌。平面动点系统按四个维度交付：①约束模型与参数化映射 ②依赖图 DAG 与增量拓扑重算 ③动态测量监听器 ④轨迹采样与消元法隐式化；3D 重构按四个区块交付：①动点宿主约束与渲染管道 ②截面几何 ③Auto-Fit ④生命周期与多解；四者与三区块**全部接进主流程**（不只是内核可用）。**2026-09-18 又完成平面几何切线**（抛物线 / 双曲线 / 圆 / 椭圆的曲线切线，切点可沿曲线拖动或跟随动点）**与动点扩展**（在动点处作切线、以动点为圆心作圆、半径可调且可随动点位置动态变化），并修掉"切线不能拖动"这一现场反馈。P4 Agent 与 P5 题图解析仍在排除范围内。
**总体状态：** 开发中

### G1 第七批：项目仓储真的接上了 —— 关掉再打开文档还在（Task 1.6 收口的前半）（2026-09-21）

- **交付**：Rust 侧 7 个仓储 IPC 命令（`read_document_head` / `create_document` / `commit_document` / `lookup_commit` / `read_document_snapshot` / `document_history_length` / `replace_document_epoch`）+ `apps/web/src/services/documentRepository.ts`（10 例）+ `documentPersistence.ts`（13 例）+ **`App.tsx` 真的接上了**。
- **本次的核心成果**：`documentService` 从"只写 zustand store"变成"写进 SQLite 的原子事务"。**这是 G1 第一条端到端可验证的链路**（内容变化 → CAS 提交 → 关掉应用 → 再打开还在）。

#### 三个真实缺陷（全部是被测试/探针抓出来的，不是想出来的）

1. **`reset`（打开文件 = 换一世）实现错了**。第一版写成"先试 `create`，撞到已存在就退化成一次普通提交" —— 而普通提交**改不了 epoch**，于是在途的旧自动保存仍然能写进来（用户刚打开的文件会被上一次编辑覆盖），用例直接挂死到超时。修法是补上 `replace_document_epoch` 这个**独立原语**：删掉再建会丢历史，普通提交改不了 epoch，只有换 epoch 两者都对。
2. **恢复的结果会盖掉用户刚做的事**。`restore()` 是异步的，完成就 `replace(...)`；用户在它返回前建的对象会被整个盖掉（e2e 抓到 3 条红）。加了守卫：用 `document.revision` 判断"用户是否已经动手"。
3. **守卫的基准取错了 —— 而这一条才是那 3 条 e2e 真正的原因**。基准原先取 effect 闭包里的 `document.revision`，而那是**切换工作区之前**的值 —— 于是"切回上次的工作区"这一步**自己**就被判成"用户动过手"，刷新之后**永远不恢复草稿**。改成 `useSceneStore.getState()`（当前值），基准落在自己那一步**之后**。
4. **最隐蔽的一个：自动保存 effect 在挂载时就把上一轮的草稿覆盖了**。它挂在 `[document]` 上，挂载即跑一次 —— 那时恢复还没回来，于是它把**初始的空文档**写进了 localStorage。**探针给出的决定性证据**：刷新前后 `mathcanvas:draft:cad` 从 3044 字符变成 2663、`图层 1` 消失，而**页面上没有任何报错**。修法是加一道 `restoreSettledRef` 闸：恢复那段结束前，自动保存什么都不写。
   - 这条值得单独记：它**不是测试的假阳性**，是真实用户会遇到的"刷新之后我建的东西没了"——而 e2e 之所以能抓到，只是因为它们断言了"刷新后还在"。
   - 诊断手法也记一下：`page.evaluate` 读 localStorage 的长度与内容，比"看界面上有没有那个按钮"快得多，而且**指向原因而不是症状**。

#### 设计上的两个判断

- **内容哈希在前端算**（`contentFingerprint`）。规则在 `scene-graph` 里（剔 `revision`/`updatedAt`、`visible:true` 视同缺省）。在 Rust 里再实现一遍必然分叉，而分叉的后果是**同一份文档有两个哈希** → CAS 永远失败，且看起来像"并发冲突"。
- **自动保存适配器在本地挡掉"内容没变"**。`saveDraft` 挂在 `[document]` 上，每次改动都会触发；直接接到仓储上会让拖一下点留下几百个 generation，把仓储的历史层冲成垃圾。适配器按内容指纹比对，没变就**连 IPC 都不发**。
- **恢复的顺序**：仓储（事务性、有历史、有 CAS）先答；仓储里没有才退回 localStorage 草稿（网页版的唯一持久化）。浏览器里 `restore()` 如实报 `not_a_desktop_shell`，行为与加这个功能之前完全一样 —— **没有在网页版上把已有草稿弄丢**。

**验证证据（本批）**：单测 **188 文件 / 2113 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / **14 warning**（回到基线，我新加的 2 条已清掉）、Rust **88 例通过 + 1 例 `#[ignore]`**、**e2e 119/119**（修复前是 116/119 —— 那 3 条红是真实缺陷的暴露，不是脆弱测试）。

### G1 第六批：SQLite 项目仓储 —— 迁移 / CAS / 幂等 / 崩溃恢复（Task 1.6 前半）（2026-09-21）

- **交付**：`apps/desktop/src-tauri/src/repository/{migrations,projects}.rs` + `tests/project_repository.rs`（**16 例**，用**真临时库文件**而不是内存库 —— WAL、崩溃恢复、"重开之后还在"这三条只有碰真文件才测得出来）。
- **迁移**：`user_version` 记版本号，**每一步各自一个事务**（`BEGIN` → SQL → 推版本号 → `COMMIT`）。这样失败时**已经成功的那几步留在库里**，失败那一步整个回滚 —— 库永远处于"某个完整的版本"上。
  - 计划 Step 1 要求 "**inject a failed migration**; assert the old DB remains usable"。**第一版的注入手法是错的**：伪造一个同名表去撞，而 `CREATE TABLE IF NOT EXISTS` 会**静默跳过** —— 那条"注入的失败"根本没失败，用例在断言处才崩。改成把迁移列表做成参数（`migrate_with`）并**真的注入一条拼错的 SQL**，于是三件事都能确定性地证明：如实报错（带出错那一步的名字）/ **版本号不推进** / **旧库仍可写可查**。
- **CAS 用三个字段一起判**（epoch / generation / content_hash）。三条各自的理由：只判 generation 会漏掉"同一版号被换成另一份内容"；只判 hash 会漏掉 **ABA**（内容回到原样但中间被人动过）；不判 epoch 会让**换过文档之后在途的请求**还能写进来（有一条用例专门覆盖"generation 对得上、epoch 是旧的"）。
- **幂等**：同一把键 + **同一份候选** = 回放当时的回执（**不再查 CAS**）；同一把键 + **不同候选** = `IdempotencyConflict`（静默按幂等处理会让第二次改动**悄无声息地丢掉**，而调用方拿到的是一张"成功"回执）。
  - **这里有一处被测试抓出来的顺序错误，值得记下来**：第一版把幂等检查放在 CAS **之后**，理由听起来也对（"不能因为键见过就跳过并发检查"）。但那样的话**真正的网络重试会失败** —— 第一次提交把 head 推进到 generation 2，重试携带的期望仍是 generation 1，CAS 判它过期，于是"重试"永远拿不到它本该拿到的那张回执。**那条路径正是幂等键存在的理由，却被顺序挡掉了。** 安全性没有变松：只有内容哈希逐字相同才走重放。
  - 另有一条 `lookup_commit(key)`（计划 Step 2 的 "crash between DB commit and UI response"）：客户端重试前先查这里，查到就直接用。
- **`Unchanged` 与 `Replayed` 是两种结果**，不是一种：前者是"这次没什么要做的"，后者是"这件事之前已经做过了"—— 界面按这两种类型说不同的话（"已保存" vs "这件事之前已经做过了"），合并成一种会让重试看起来像"又保存了一次"。
- **内容没变不推进 generation、不写快照**（否则撤销栈里会多一个空步），但**仍然记一条提交记录** —— 否则同一把幂等键会被误判成"没用过"。
- **`replace_epoch` 保留历史**：导入 / 切换项目之后旧历史仍要能一路读回去（撤销用）。

**验证证据（本批）**：Rust **88 例通过 + 1 例 `#[ignore]`**（单元 8 + project_repository 16 + provider_profiles 14 + providers 17 + proxy 16 + secrets 8 + shell_smoke 9）、typecheck exit 0、lint 0 error / 14 warning（基线）、单测 186 文件 / 2090 用例全通过。

**仍未做（如实）**：`.mcanvas` 打包导出/导入（Task 1.6 Step 5）、附件的两阶段写与孤儿回收（Step 4 —— 表已经建好，缺的是 blob 目录那一半）、`documentService` 接到这个仓储（现在前端仍用自己的内存 store）、以及"Windows 重启恢复烟雾测试"。

### G1 第五批：回环代理的传输安全判据（Task 1.5）（2026-09-21）

- **交付**：`apps/desktop/src-tauri/src/proxy/security.rs` + `tests/proxy.rs`（**16 例**，计划 Step 1 点名的**九种情形一条不少**）+ `apps/web/src/services/modelClient.ts`（11 例）。
- **为什么判据是纯函数、而且这一批**没有起真服务器**（如实标注）：计划 Step 1 要求九种拒绝理由各有测试 —— 而"起一个服务器再打它"的写法测这九种要起九次服务器，于是**没人会写全**，每条安全规则都会退化成"大概拦住了"。抽成纯函数之后每一条都能被确定性地钉住；`bind(127.0.0.1:0)` + 路由分发需要异步运行时（tokio/hyper），属于同一任务的下一步。**先写服务器再补判据，安全组件尤其不该那么做。**
- **九种情形逐条落地**：
  1. **missing token** —— 回环地址**不是**授权：任何本机进程都能连 127.0.0.1。
  2. **wrong token** —— 16 字节随机、**常数时间比较**（不在第一个不同字节处提前返回，否则"前几位对了"会通过耗时泄露出去）。
  3. **wrong Origin** —— 含**通配符 `*`**：CORS 通配 + 回环代理是经典组合漏洞。
  4. **wrong Host** —— **精确匹配**：`127.0.0.1.evil.com` 这种"包含"式判据会被骗过去。
  5. **oversize body** —— 上限 1 MiB。
  6. **stale profile revision** —— 配置改过之后旧证据不该继续被采信（与 `isCapabilityVerified` 同一条判据）；不声明修订号的请求不算过期。
  7. **arbitrary URL** —— `Route` 这个 enum 的**存在本身**就是那条约束：**没有任何变体接受上游 URL**。想加"转发到任意地址"的能力必须先加一个变体，而那是一次看得见的改动。带 `?url=` 的查询参数直接拒绝（不是"反正我不用它"，而是"这个代理没有这种能力"）。
  8. **redirect to another host** —— 只有**同 scheme 同 host** 才允许继续带凭据；一个 302 到 `evil.com` 就能把 `Authorization` 送出去，而那是代理类组件最经典的漏洞形状。
  9. **SSRF** —— `cloud` 策略下禁止私网与元数据地址（`169.254.169.254` 最出名）且必须 HTTPS；`local`/`lan` 放宽，但**协议仍然只允许 http/https**（`file://` 在有些客户端上能读本地文件）。
- **脱敏**：令牌与四种认证头一律抹掉，但**保留头名**（只整行删掉会让"这个头出现过"这个信息也没了），与安全无关的内容原样保留（脱敏过度会让日志没用）。
- **前端一半（`modelClient.ts`）**：三条纪律 —— ①**密钥永远不到前端来**（这个文件的类型里**没有**任何能装密钥的参数，有用例逐字扫 IPC 参数）；②**网络失败映射到错误契约并带 `retryable`**（"没有桌面外壳"**不是**可重试失败：重试一百次也还是浏览器；代理的准入拒绝也不该重试 —— 换个时机还是同样的规则）；③**取消之后不再产出事件**（用与 Rust 侧同一套 `stopAfterCancel` 语义）。回环地址与令牌**每次现取、不缓存**（缓存会把会话令牌变成一份长期凭据，而它本该随会话结束失效）。

**验证证据（本批）**：单测 **186 文件 / 2090 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、Rust **72 例通过 + 1 例 `#[ignore]`**（单元 8 + provider_profiles 14 + providers 17 + proxy 16 + secrets 8 + shell_smoke 9）。

**仍未做（如实）**：代理的**真服务器**（绑定回环 + 路由分发 + 流式转发）与 `ProviderAdapter` trait 本体；`proxy_session` / `model_run` / `model_cancel` 三个 IPC 命令；能力证据探针（计划 Step 5 的 "record declared/verified/failed per model/profile revision"）—— 数据结构与判据（`ProviderCapabilityEvidence` / `isCapabilityVerified`）已就位，缺的是"真的发一次探测请求"。

### G1 第四批：Provider 适配器与事件归一化（Task 1.4）（2026-09-21）

- **交付**：`packages/agent-core/src/modelEvents.ts`（8 例）+ `apps/desktop/src-tauri/src/providers/`（`events.rs` / `request.rs` / `normalize.rs`）+ `tests/providers.rs`（**17 例**）+ `test-fixtures/providers/`（9 份样本）。
- **一次真实的失败与它的收获（本批最有价值的一条）**：第一版把三家 provider **都按 SSE** 处理，于是 Ollama 的 fixtures **一行事件都解析不出来** —— 而"没有事件"在界面上表现为"**模型什么都没说**"，看起来像模型的问题、不像解析的问题。Ollama 原生是 **NDJSON**（一行一个完整 JSON，没有 `data:` 前缀），现在按协议分流。这条正好说明为什么 fixtures 值得先写：真实调用时这个 bug 会以"本地模型不会说话"的形式出现，而排查方向会被完全带偏。
- **三家形状的差异被收在适配器里**（协调器只认六种事件）：增量文本分别在 `choices[0].delta.content` / `content_block_delta.delta.text` / `message.content`；工具调用分别在 `delta.tool_calls[]` / `content_block_start(tool_use)` / `message.tool_calls[]`；用量分别在 `usage` / `message_delta.usage` / `prompt_eval_count`；结束标记分别是 `[DONE]` / `message_stop` / `done:true`。漏认任何一家的结束标记都会让 UI 一直转圈。
- **三条纪律，逐条有用例**：
  1. **`reasoning` 只作诊断元数据**（计划 Step 4 原文）：它进 `metadata`，**绝不**拼进 `Delta.text`。有用例断言"文本里只有答案，推理在 metadata 里"——否则模型的自述会变成"内容"。
  2. **畸形 JSON 是 `MalformedOutput` 而不是 panic**：网络切断时半截数据是常态。有用例用**真的截断 fixture** 断言"前面完整的那一块仍然被读出来"（用户已经看到的东西不该被丢掉），同时给出分类失败。
  3. **重试策略读分类、不读状态码**：`401/403/429/5xx` 的映射只有一处（`classify_http_failure`），三家共用 —— 每个适配器各写一遍必然分叉，而分叉的后果是"换一家 provider，重试策略就变了"。认证与权限**绝不**自动重试。
- **`ProviderRequest` 的形状是安全边界**：`endpoint` 由 `base_url` + **常量路径**拼出（调用方给不了整条 URL），header 只有两份白名单（**没有"额外 header"这个口子**），**认证头留空值** —— 密钥由调用方在发送那一刻借出（`authorize`），`build_request` 的产物里逐字不含密钥（有用例断言）。
- **方言决定"能发什么形状"**：`generic_compatible` **默认不带工具 schema** —— 那正是计划 Step 3 "Do not assume every compatible service supports the same tools, JSON, vision, or streaming shape" 的落点。而且**两个前置条件都要满足**：方言支持 **且** 调用方按**已验证证据**放行（有用例同时覆盖这两种否定）。
- **如实标注（本批不含 HTTP）**：这一批交付的是"**发请求之前**（拼装）与**之后**（归一化）"两半，**连接 / 超时 / 重定向 / TLS / 取消**属于 Task 1.5 的回环代理 —— 那里才有"绑定回环 + 临时令牌 + 精确 Origin/Host"的整套约束。这么切的好处是直接的：Task 1.5 接上真实传输时，需要新写的只有"怎么把字节搬回来"，而**协议解释与错误分类已经是被测过的纯函数**。
- **另一个如实标注**：`ProviderAdapter` trait 本体（计划里的 `send(...) -> Stream<ModelEvent>`）**还没有写** —— 它的形状取决于传输层（`Stream` 从哪来、取消怎么表达），先定形状再实现会返工。等 Task 1.5 把传输定下来，这个 trait 就是一层薄薄的转发。

**验证证据（本批）**：单测 **185 文件 / 2079 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、Rust **56 例通过 + 1 例 `#[ignore]`**（单元 8 + provider_profiles 14 + providers 17 + secrets 8 + shell_smoke 9）。

### G1 第三批：Provider 配置契约 + 设置存储 + 设置界面（Task 1.3）（2026-09-21）

- **交付四块**：`packages/agent-core/src/providerContracts.ts`（纯校验，20 例）、`apps/desktop/src-tauri/src/repository/provider_profiles.rs`（文件存储，14 例）、`apps/web/src/services/providerProfileClient.ts`（13 例）、`apps/web/src/components/settings/ProviderSettings.tsx`（13 例）。
- **三条设计决定**：
  1. **配置里永远没有密钥，只有引用**。`secretRef` 指向凭据库里的条目（Task 1.2）。而 `secret` / `apiKey` / `token` / `password` 这类字段**出现即拒绝**（不是忽略）—— 忽略会让调用方以为自己刚把密钥存进去了。三处都查：TS 解析器（入口）、TS 客户端（发 IPC 前）、Rust `prepare_profile`（落盘前），判据都是**结构检查**（任意深度）而不是字符串扫描。
  2. **协议与方言都是闭集，且必须配套**。`openai_compatible` 不是一个东西：有的支持工具、有的不支持流式、有的两边都不支持 —— 所以"方言"不是标签，而是"这个端点到底支持什么"的声明（计划 Task 1.4 Step 3 的原话）。方言与协议不匹配直接拒绝，因为那种错在发请求时表现为 404/400，看起来像"服务坏了"。
  3. **明文只允许去本地**。非 `local`/`lan` 必须 HTTPS，且 `cloud` 策略下**私网地址一律拒绝**（`169.254.169.254` 那种云元数据 SSRF 是最常见的形状）。想连私网就得显式改策略 —— 那是**用户的选择**，不是默认放开。
- **存储的取舍**：provider 配置用**文件**（原子写：临时文件 + 改名 + `sync_all`）而不是数据库。理由如实写进了 `repository/mod.rs`：计划 Task 1.3 只要求 "settings storage"，而项目仓储（快照/历史/CAS/崩溃恢复）是 Task 1.6 的事 —— 把配置也塞进那个还不存在的数据库，会让"改一次设置"依赖一个还没做出来的组件的迁移状态。
  - **修订号由存储方递增**（调用方给的值一律忽略），并带**乐观并发**：`expectedRevision` 不符就拒绝写，而不是覆盖另一个窗口的改动。健康记录**不改变**配置修订号，但**必须带**它对应的 revision（旧证据不该被当成本次的依据）。
  - **配置坏了要如实报错，不许静默重置** —— 有一条用例盯住"报错之后文件一个字节都没变"，因为重置会把用户所有配置悄悄删掉。
  - 删 profile 会**连带删掉健康记录**：留着它会让"重建一个同 id 的 profile"继承旧证据。
- **设置界面（模块 C）**：`ModuleRail` 从两个模块变三个，`ProviderSettings` 终于有了入口 —— 在那之前它做得再完整用户也看不到。计划 Step 2 点名的五条各有用例：标签可见（`getByLabelText` 找得到）/**密钥输入不持久化**（profile 里只有 `secretRef`，有一条用例断言发出去的对象逐字不含密钥）/提交有加载态与成败/**错误可聚焦且指向字段**（点"去修正"会把焦点移到字段上）/键盘可达每一项（全用原生控件）。
  - **一条刻意的取舍**：这个界面**不测试连接**。真实连通性要等 Task 1.5 的回环代理（密钥不能到前端来，请求必须由 Rust 侧发）。在那之前放一个"测试连接"按钮只有两种结局：假装成功、或永远失败 —— 两者都比没有更糟。所以这里只显示**已有的健康证据**，并如实标"未验证"。
  - 保存顺序（**密钥先、配置后、失败回滚**）收在一个函数里（`saveProfileWithSecret`）而不是交给界面：错一次就会留下"配置指向一个不存在的密钥"或"凭据库里的孤儿条目"，而放在界面里每个调用点都要自己想一遍。三条路径各有用例（成功 / 密钥失败则不动配置 / 配置失败则回滚密钥）。
- **一次真实的编译失败与它的收获**：`export * from "./providerContracts"` 撞了三个名字 —— `ProviderProfile`（`modelGateway` 有一份"网关视角"的简化版）、`CapabilityStatus` / `CAPABILITY_STATUSES`（`capabilities` 做的是"能力注册表视角"）。三类东西**确实**不同（配置里的能力证据带时间与失败原因；网关只关心三档；注册表讲的是"这个动作可不可用"），所以**不合并**，改成逐项导出 + 把配置侧那套改名为 `PROVIDER_CAPABILITY_STATUSES`。显式列出的另一个好处是它顺便在说清"这个模块对外提供哪些名字"。
- **两次自纠**：①协议/方言/网络策略第一版把"没填"和"填错"合成一条 `unknown_protocol`，于是漏填时报的是"协议不认识" —— **错误的错误信息比没有更费时间**，已拆成 `missing_field` 与 `unknown_*`；②`ModuleRail` 的可见短文案原先是 `index === 0 ? "传统" : "Agent"`，模块变三个之后**第三个也会显示成"Agent"**，已改成一张 `Record<AppModuleId, string>` 表。

**验证证据（本批）**：单测 **184 文件 / 2071 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线，与改动前一致）、Rust **39 例通过 + 1 例 `#[ignore]`**、桌面构建通过产出新 exe、e2e **119/119**。

### G1 第二批：SecretStore（Task 1.2）—— 凭据管理器真的存住了一次（2026-09-21）

- **交付**：`apps/desktop/src-tauri/src/secrets/`（`mod.rs` 语义 + `memory.rs` + `windows.rs`）+ 4 个具名 IPC 命令 + 前端 `apps/web/src/services/secretClient.ts`。
- **三条设计决定，逐条有理由**：
  1. **明文没有出口**。`put` 返回 `SecretState`（三态枚举）、`has` 返回 `bool`、`remove` 返回 `()`、`with_secret` 收一个闭包 —— **没有任何返回值的位置能装下明文**。这比"记得不要返回它"可靠：将来有人想加 `get_secret`，必须**先改这些类型**，而那是一次看得见的改动。有一条**文本断言**专门守这个形状（`the_secret_commands_have_no_plaintext_exit`）：谁把返回值改成 `String` 或加一个读明文的命令，它立刻红。
  2. **没有后端时不假装成功**。内存后端住在**生产代码**里（不是 `#[cfg(test)]` 后面），因为非 Windows、或凭据管理器被企业策略禁用时它**就是真的后端** —— 只不过进程一退就没了。`backend()` 如实回 `"memory"`，`get_runtime_info` 据此把 `secretStore` 报成 `not_implemented`，界面就能提醒"这次会话有效，重启要重填"。**如果它在测试后面，"没有后端时会怎样"这条路径就从来没有代码走过。**
  3. **空 id / 空密钥当场拒**。空 profile id 会让两个 provider 抢同一格；空密钥会把"没填"变成"存了一个空密钥"，于是界面显示已配置而请求必然 401。前端也在本地先拦（**一次 IPC 都不发**，有断言）—— 否则用户看到的是一次"失败"，而真正的意思是"你还没填"。
- **一次真实的编译失败与它的收获**：`SecretStore` 第一版用 `Box<dyn SecretStore>`，编译不过 —— `with_secret<T>` 是泛型方法，让 trait 失去 dyn 兼容性（`E0038`）。两条出路：把泛型挪走（那会让"借出明文"变成两步，明文在两步之间存在于调用方手里），或者用 `enum Store` 做**静态分派**。选后者：闭包形态正是"明文没有出口"那条性质的落点，不能为了 dyn 牺牲它。副作用是好的 —— `match` 必须穷尽，新增后端时编译器会逼你把每个方法都实现一遍。
- **真的往凭据管理器里存了一次**（计划 Step 5："Verify the Windows backend on a real user profile"）：`the_windows_backend_really_stores_and_deletes_a_credential` 默认 `#[ignore]`（它会在开发者真实凭据库里写一条），用**一眼能认出是测试**的 `__probe__` profile，并用 `Drop` 保证**即使断言炸了也会删掉**。本轮**显式跑过一次，通过**（存 → 查 → 轮换 → 读回新值 → 删 → 删第二次不报错）。这一条补上了最要紧的空白：上面所有常规用例走的都是内存后端，"生产后端到底能不能用"此前没有任何测试碰过 —— 而它恰恰是最可能失败的一环（企业策略禁用、`keyring` 初始化失败、服务名规则不符预期）。
- **顺带修正一处自述失真**：`build_runtime_info` 原先**写死** `secret_store: not_implemented`，密钥库做完了它也不会变。现在该参数由调用方传入（函数保持纯函数，`ready` / `not_implemented` 两条路径都能被测试），`get_runtime_info` **现问后端**。加了一条用例盯住"可用时必须报 ready"——"可用却说不可用"与"不可用却说可用"一样是自述失真。
- **安全边界没有放宽**：`tests/shell_smoke.rs` 里那条"只暴露具名命令"的断言改成**逐字列出四个命令名**（不是数一个数）：新增命令时它会逼你在这里写下名字 —— 那一刻就是一次**有意的**决定。

**验证证据（本批）**：Rust `cargo test` **25 例通过 + 1 例 `#[ignore]`**（单元 8 + secrets 8 + shell_smoke 9），其中忽略的那一例**已显式跑过并通过**；单测 181 文件 / 2025 用例全通过（零跳过）；typecheck exit 0；lint 0 error / 14 warning（基线）；`npm run build` 通过并产出新的 exe；e2e 119/119。

### G1 第一批：**解除唯一的外部阻塞**（装好 Rust 工具链）+ Task 1.1 桌面外壳落地（2026-09-21）

- **解除阻塞（这一步是纯环境操作，但它是 G1 全部六个任务的前置）**：`winget install --id Rustlang.Rustup --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity` → **`rustup 1.29.1` / `cargo 1.98.1` / `rustc 1.98.1`（`stable-x86_64-pc-windows-msvc`）**。装完直接跑 `npx tauri info`，六项前置全绿：
  - OS Windows 10.0.26100 x64 · **WebView2 153.0.4234.48** · **MSVC Visual Studio Community 2026** · rustc ✔ · cargo ✔ · rustup ✔ · toolchain `stable-x86_64-pc-windows-msvc (default)`。
  - **一个坑记下来**：winget 写的是**用户级 PATH**（`C:\Users\Huo\.cargo\bin`），所以**已经开着的进程看不到 `cargo`** —— `npx tauri info` 第一次报 "rustc: not installed!"，但直接调 `%USERPROFILE%\.cargo\bin\cargo.exe --version` 是好的。新开的进程（包括用户自己开的终端）会自动有。以后每一轮都要在每个 pwsh 调用里显式拼一次 PATH。
  - 安装体积与影响范围如实告知过用户（数百 MB + 需要 MSVC，而 MSVC 本机已有），用户批准后才执行。

- **Task 1.1 桌面外壳（`apps/desktop`）落地**，按计划接口逐条对齐：
  - **前端不复制一份**（计划原文："imports the existing `apps/web` application **without duplicating the geometry store**"）：`tauri.conf.json` 的 `frontendDist` 直接指向 `build-check/mathcanvas-current`，`beforeDevCommand` / `beforeBuildCommand` 走 `npm run … --workspace @draw/web`。`apps/desktop` 里**没有任何前端源码**（有一条用例专门断言这件事）。
  - **只暴露具名 IPC 命令**（原文："no generic command accepting JavaScript or shell text"）：整个外壳**只有一个**命令 `get_runtime_info`，且有一条用例剔掉注释后扫 `run_shell` / `read_file` / `write_file` / `std::process::Command` / `Command::new`。
  - **`get_runtime_info` 的安全性质**：不带密钥、不带数据根之外的路径。`build_runtime_info` 是**纯函数**（版本与目录由调用方传入），所以这些性质可以在单元测试里直接钉住，不需要起真窗口。`data_root` 只输出**目录名**——即便有人图省事把绝对路径传进来，取最后一段的写法也不会泄露它。
  - **三部件如实标 `not_implemented`**：SecretStore（1.2）/ 回环代理（1.5）/ SQLite 仓储（1.6）都还没做，自述里就写 `not_implemented`（枚举三态：`ready` / `missing` / `not_implemented`，而不是布尔——布尔分不清"没有"与"还没做"）。
  - **CSP 不再是脚手架的 `null`**：改成 `default-src 'self'; … object-src 'none'; base-uri 'none'; frame-ancestors 'none'`；能力清单保持**最小集**（只有 `core:default`），有用例点名禁止 `shell:` / `fs:` / `opener:` / `http:`。
  - **标识与窗口**：`identifier` 从脚手架的 `com.tauri.dev` 改成 `com.mathcanvas.desktop`；窗口 1280×860（最小 900×600）——脚手架的 800×600 装不下三栏工作台。

- **前端的另一半**：新增 `apps/web/src/services/desktopRuntime.ts`（7 例）。它明确区分三件事：①**在浏览器里跑是正常状态**（`invoke` 不存在 → 如实回 `null`，不抛异常——同一个 web 产物既要能当网页开、也要能在 Tauri 里跑）；②**在桌面里但自述没取回来** → 回 `runtime_info_failed` 并带原因，而不是编一份显示出来；③**缺字段一律当 `not_implemented`**（危险的那种默认值是"缺字段当可用"，前端会以为密钥库在，然后走一条不存在的路）。

- **RED→GREEN 与两次自纠**（都记在测试注释里）：
  1. Rust 那条"自述里没有密钥形状字段"的用例，**第一版用裸子串扫 `secret`，被自家字段名 `secretStore` 判红** —— 断言无法区分"名字里有 secret 的**状态字段**"与"真的装着密钥的字段"。改成两条能区分的检查：**字段集合闭集** + **值里没有密钥形状**（`sk-` / `ghp_` / `Bearer ` / 32 位以上无空格随机串）。
  2. "不许有通用命令"那条，**第二版又被注释里那句"没有、也不会有 `eval` / `run_shell`…"判红**。改成先剔注释行再扫——注释里点名这些词是**好事**，不该被断言当成违规。
  —— 两次都是"断言写得太糙"，不是实现有问题；两次都把教训写进了用例注释。

- **实测证据（本机）**：
  - `cargo test` **13 例全过**（`runtime.rs` 5 例单元 + `tests/shell_smoke.rs` 8 例集成）。
  - `npx tauri build --no-bundle` **exit 0**，产出 `apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe`（9,195,520 字节，release 2m43s）。
  - **真的启动了它**：`Start-Process` 起进程 → 等 6 秒 → 进程**仍在运行**（pid 30588，说明窗口起来了、WebView2 加载成功、没有立刻崩），随后 force kill，无残留进程。
  - 单元 179 文件 / 2010 用例、typecheck、lint、e2e 的结果见下（加入 `@draw/desktop` workspace 之后重跑）。

**如实标注（未做）**：`tauri dev` 的热重载路径**没有实测**（它要开一个长驻开发窗口）；打包（`tauri build` 带 bundle，产出安装器）**没有做** —— 计划把它放在 Task 5.4；图标仍是脚手架默认（换品牌图标属 Task 5.4）；`get_runtime_info` 的**真实 IPC 往返**没有在真窗口里断言过（前端那一半用假的 `__TAURI_INTERNALS__` 覆盖了它的三种结果）。

### G2 第三十二批：一次性修复真的把"上一次错在哪"告诉规划器（Task 2.3 Step 5）（2026-09-21）

- **缺口**：协调器**确实**会再问一次（`MAX_PLAN_ATTEMPTS = 2`），但**不告诉规划器上一次错在哪** —— 第二次尝试只是把同一份请求原样再发一遍，模型没有任何理由换个答案。也就是说计划里那句 "Implement visible one-time schema repair" 实际退化成"重试一次"。修复提示的构造函数 `outputParser.describeRepairPrompt` **早就写好并有测试，只是没人调它** —— 又一处"有实现、没接上"。
- **修法**：`PlanRequest` 增加可选 `repair: { reason, errors, hint }`。协调器在每次解析失败后组装它（`hint` 由**已注册的** `describeRepairPrompt` 生成），下一次尝试带上；第一次尝试没有 `repair`。
  - `reason` 用 `schema_invalid`（与解析器同名）；`channel` 给 `fenced_text` —— 那是**最宽松**的通道（一次外层围栏 + 围栏内只有 JSON），在"不知道对方用哪个通道"时说它不会给出错误的格式建议。
  - `hint` **绝不回显模型的原话**（`describeRepairPrompt` 的设计如此）：把散文再送回去会形成自我强化的循环。
- **RED→GREEN**：`coordinatorContext.test.ts` +1。用例先给一个 `actions: []` 的计划（解析器报 `empty_actions`），再给合法计划，然后断言：第一次 `repair` 为 `undefined`；第二次的 `errors` 含 `empty_actions`、**路径具体到 `envelope.actions`**，且 `hint` 里也带着这个路径 —— 这正是计划原文要求的 "include exact JSON path errors in the second prompt"。
- **顺带一提**：这条与上一批那个 `prepare` 缺口是**同一类**问题的两面 —— 上一批我判定"修复往返"还没有消费者而把重算撤掉了；这一批把修复往返本身接上了，于是"上下文在 prepare 之后重算"开始**有了读者**（下一次往返能看到正确的目标）。它现在是明确的下一步。

**验证证据（本批）**：单测 **179 文件 / 2010 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

### G2 第三十一批：把"`prepare` 换掉目标文档"这件事钉成用例（已知缺口，本批**只记录不改**）（2026-09-21）

- **发现**：真实的 `prepareWorkspaceFor` 会在**规划之后、编译之前**把工作区切到计划需要的那个（用户在平面几何里说"建一个立方体"，它切到立体几何）。而上下文是在**规划之前**组装好的 —— 于是**模型看到的是文档 A 的场景，动作却被编译到文档 B 上**。`context.handles.target` 与 `context.workspace` 都是旧的。
- **为什么本批不修**：能让模型看到正确目标的那次生成发生在**第 N+1 次往返**（例如 schema 修复），而一次成功的运行只有**一次**生成 —— 所以"在 prepare 之后重算上下文"在当前流程里**没有读者**。我先把重算写了一遍（并算上第二次观察），写完发现它算出来的值没有任何地方会读，于是**撤掉**：与其塞一段"看起来修好了"但没人读的代码，不如把现状钉成用例。修它属于 Task 2.3 那条"可见的一次性修复往返"接上之后的独立切片。
- **用例的价值在于它记录的是事实、不是期望**：断言就是"模型看到的仍是切换之前那份文档"（`target.documentId` 是平面文档、`workspace` 是 `conics`，而真正被编译的目标已经是空间文档）。谁哪天把这个行为改对了，它会立刻红，从而逼出一次**有意的决定**，而不是悄悄变化。
- **顺带改掉自家夹具的第二处不诚实**：`runContext()` 之前把句柄的 `workspace` 写死成 `geometry3d`，即使传进来的是平面文档 —— 于是这条用例第一次跑就红了（`expected 'geometry3d' to be 'conics'`）。已改成取自文档本身。这已经是这个夹具第三次因为"写死一个与传入文档无关的值"而出问题（前两次是 `documentId`、`generation`）；教训是：**夹具里的句柄必须由它描述的那份文档算出来**。

**验证证据（本批）**：单测 **179 文件 / 2009 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

### G2 第三十批：让本地规划器说出"这条指令要用哪些技能"（技能清单终于有了生产调用方）（2026-09-21）
- **上一批如实标注的那条"仍未做"**：`requestedSkillIds` 没有任何生产调用方 —— 于是运行时的技能接线虽然建好了，链路上仍然是零。
- **为什么不能在规划器命中之后再决定**：`requestedSkillIds` 必须在**建运行时之前**算出来，因为上下文是**发请求前**组装的，而它一旦定下来就决定了模型能看到哪几个动作。规划器是在请求**发出时**才被调用的 —— 那时已经晚了。
- **修法**：`LocalIntent` 增加 `skillIds`（立方体 → `spatial-modeling`；平面点 → `planar-basics`；只读提问 → 空数组，因为它不产生动作，给一个用不上的动作菜单只会误导模型）。抽出 `matchLocalIntent(prompt)` 作为**唯一**的匹配规则，`localIntentSkillIds(prompt)` 与 `createLocalPlanner().plan()` **共用它** —— 两边各写一遍"包含哪些词"的判断一旦分叉，就会出现"上下文里没有这个技能、而计划里有它的动作"这种莫名其妙的编译失败。`agentRunner` 在建运行时的时候问一次，注入 `requestedSkillIds`。
- **RED→GREEN**：`localPlanner.test.ts` +6：立方体要空间技能 / 平面点要平面技能 / 只读提问什么都不要 / 认不出什么都不要 / **产出的动作必须在声明的技能里**（这条是真正有用的那条：否则上下文与计划对不上）/ 声明的技能 id 必须在签入清单里存在。
- **如实标注**：真 provider 接进来时，"选哪些技能"要换成由意图判断或模型选择；本地这一份的作用是**让这条接线在离线环境下也能被验证**，而不是假装做了自然语言理解。`agentRunner` 里注入自定义 `planner` 时不传 `requestedSkillIds`（自定义规划器的意图只有它自己知道）。

**验证证据（本批）**：单测 **179 文件 / 2008 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

### G2 第二十九批：观察者交出事实文本 + 技能清单成为可用动作的唯一来源（2026-09-21）

- **缺陷（第一处）**：上一批给 `Observation` 补了 `facts?: { id; text; origin }[]`，理由是"只有 id 的话，模型看得到『有一个事实 point-1』，看不到『point-1 是点 A』"。但**补了形状不等于补了数据**：运行时的观察者从第一版起就在算那个数组，**只是没有把它放进返回值**（`return { factIds, summary }`），于是上下文里的事实仍然是空的。
  - **是变异检验抓出来的**：把 `facts` 从返回值里去掉，**全量用例仍然全绿** —— 因为既有用例的场景都是空文档，根本没有事实。补了一条"文档里有一个带标签的点"的用例之后，去掉就会红（这次的 RED 证据）。
- **缺陷（第二处）**：`requestedSkillIds` 与 `availableActions` 在运行时侧一直是**空数组**（上一批只在协调器里留了注入点）。也就是说模型看到的上下文里**一个可用动作都没有**，九个签入的技能清单一次都没被用过。
  - **修法的关键取舍**：让调用方**说请求哪些技能**，由运行时去清单里取动作，而**不是让调用方直接给一串动作名**。后者等于绕开清单（调用方可以声明任何名字），而清单正是"这次允许用哪一小撮"那份声明。所以 `AgentRuntimeDependencies` 增加 `requestedSkillIds?: readonly string[]`，运行时用 `SKILL_MANIFESTS` 解析出 `availableActions`（去重、按清单顺序）。
  - **未登记的技能 id 在这里就被丢掉**，不进 `requestedSkillIds` —— 于是它不会在上下文里变成一条 `skill_unregistered` 警告。那类警告是给"**清单本身**有问题"用的（哈希不符、修订号漂移），不该由调用方打错一个 id 触发。
- **RED→GREEN**：`agentRuntime.test.ts` +2（请求的技能与其声明的动作进入上下文 / 未登记的技能 id 被丢掉且不产生警告）+1（事实文本）。中间被自己的一处设定绊了一下：`SkillCatalog.load` 比对的**不是**能力注册表修订号而是 `SKILL_CATALOGUE_REVISION`（清单修订号），所以用例必须显式给这个值，否则技能会被静默拒载 —— **修正的是夹具，不是断言**。
- **如实标注**：`requestedSkillIds` 目前**没有任何生产调用方**（`agentRunner` 不传它），因为"用户这句话该请求哪些技能"需要一个真实的意图判断；本地确定性规划器只认几条固定指令，让它去选技能只会变成另一种硬编码。接真实 provider 时这一层才有人喂。

**验证证据（本批）**：单测 **179 文件 / 2002 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

### G2 第二十七批：worker 的 diff / check / artifact 信封（Task 2.4 Step 4）（2026-09-21）

- **计划原文**："Connect the geometry worker to the existing compiler and return **diff/check/artifact envelopes**."
- **在它之前，成功响应只有"操作列表 + 结果文档"** —— 对调用方缺的正好是三件事：**改了什么**（自己比两份文档也能得到，但两份文档可能很大，而且"自己比的"与"事务算的"一旦不一致就没法判断该信谁）、**查过了吗**（走 `check` 路径的调用方问的就是"能不能落"，回答里必须有这句话，而不是靠"没报错"推断）、**这是哪一版草稿的产物**（用户确认的必须是**他看过的那一份**）。
- **`WorkerSuccess` 增加五个字段**：`changed`（语义上有没有真变化 —— `commitTransaction` 早就在语义层做了这件事，这里只是把它**报出来**，否则调用方会把空操作当成一次改动）、`diff`（事务算出的增/删/改）、`checked` + `problems`、`beforeHash` / `afterHash`（供调用方核对"这份产物是从我给的那份算出来的"）、`artifact`（信封的四个标识逐字回带）。
- **`parseWorkerResponse` 也收紧**：`changed` / `diff` / `artifact` **缺一个就拒绝**，不给默认值糊过去。判据是"少了它调用方还能不能正确工作"。
- **RED→GREEN**：`workerRuntime.test.ts` +4（diff 信封 / check 信封 / artifact 归属 / 空操作如实报 `changed: false`），修前 4 红（`expected undefined to be true` 等）。`workerContracts.test.ts` 里那条既有用例的夹具**必须补全**才测得到它本来要测的东西（`requestId` 对不对）—— 顺带补了一条"缺 diff/check/artifact 一律拒绝"的用例。**没有放宽任何断言**。
- **顺带一条判断（如实记录，没做）**：`geometry.worker.ts` / `agent.worker.ts` 仍**没有任何 `new Worker(`**。本轮**刻意没有**去实例化它们：真正要接的是 `DraftStore.stage`，而它是**同步**的，而 worker 只能异步；为了"让 worker 看起来被用上"而把暂存改成异步，会动到用户确认链路的核心而没有任何调用方受益。规则那一半已经是纯函数并且有测试（`workerRuntime.test.ts`），接线等真有异步调用方（G1 的 provider 通道）时再做。

**验证证据（本批）**：两批一起跑的全量结果是单测 **179 文件 / 1999 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

### G2 第二十八批：把上下文与工具真正交给规划器（Task 2.2 Step 4 / Task 2.3 的接线）（2026-09-21）

- **缺口（审查早就点名的那条）**：`buildContext` 与 `createToolRegistry` 有实现、有测试，但**没有任何生产调用方**。根因在端口形状上：`PlanRequest` 只有 `run` / `userMessage` / `budget` / `signal` —— **一个 provider 适配器拿不到任何场景信息**，只能自己再造一份。
- **修法**：`PlanRequest` 增加**一个整体字段** `model: { context: ModelContext; tools: readonly ToolDescriptor[] }`（做成整体而不是两个平铺字段：它们是同一个问题的两面，平铺会让将来新增一项时又要改一次端口形状）。协调器在**观察之后、发请求之前**组装两者，并且**只组装一次** —— 两次尝试（含那次可见的修复）必须看到同一份上下文与同一批工具，否则"第二次机会"其实换了题目，事后无法判断是模型改好了还是条件变了。
- **谁组装、为什么是协调器**：两者都来自 `agent-core` 自己的部件，而协调器是唯一知道"现在是哪个阶段"的地方。让适配器自己组装，等于把"哪个阶段能看到什么"这条**安全边界**搬到 app 侧去。
- **顺带补上一个"接口缺字段"型缺口**：`buildContext` 的 `Fact` 有 `text` 与 `origin`（用户明说 / 视觉推断 / 系统假设），而观察端口原先**只有 id 列表**。也就是说：即使把 `buildContext` 接上，上下文里的事实也只剩一串 id —— 模型看得到"有一个事实 fact-1"，看不到"fact-1 是**点 A 在原点**"。所以 `Observation` 增加可选 `facts?: { id; text; origin }[]`（`factIds` 保留，因为"计划引用的都是已确认事实"那道检查不需要文本）。这类缺口两边各自都自洽，**只有把两个类型摆在一起才发现接不上**。
- **RED→GREEN**：新增 `packages/agent-core/src/coordinatorContext.test.ts`（4 例）：上下文事实带文本与来源 / 规划阶段**没有任何写文档的工具** / 两次尝试拿到按值相同的上下文与相同的工具 / 事实超限时截断并留 `truncated_facts` 警告。`agentRuntime.test.ts` +1（组装之后的运行时里，规划器拿到的上下文带着**真实活跃文档**的手柄）。**变异检验**：把 `model:` 参数删掉后 4 例全红（`Cannot read properties of undefined`），恢复后绿。
- **写这条用例时改掉的一处自家夹具错误**：`runContext()` 原先自己新建一份空文档填句柄，于是断言里拿到的 `documentId` 是**另一份文档**的 —— 这条用例要测的恰恰是"模型看到的手柄是不是我给它那份文档的"，夹具不对就测不到。已改为可以传入具体文档。

**验证证据（本批）**：两批一起跑的全量结果是单测 **179 文件 / 1999 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

**仍未做（明确记下）**：`agentRuntime` 注入的那个观察者**还没有产出 `facts` 文本**（它目前只把实体 id 当事实 id、并返回 `summary`），所以真实链路上的上下文事实仍只有 id —— 补它要同时决定"事实 id 用实体 id 还是标签"，属独立切片；`requestedSkillIds` / `availableActions` 目前是空数组（技能清单与能力注册表还没接进来）；`ToolPort` 仍未被协调器在运行中调用（分发器与运行时方法已就绪，缺的是真实 provider 的 tool-call 通道）；G1 仍被 Rust 工具链缺失挡着。

### G2 第二十六批：用户可见轨迹 + **默认关着**的开发者详细视图（`ToolTracePanel`，Task 2.6 Step 4）（2026-09-21）

- **计划原文**："Render a user-facing trace with short summaries; keep detailed diagnostics behind an **opt-in** developer view."
- **为什么是两层而不是"一层加个折叠"**：用户要的是"走到哪一步了"，排障要的是"从哪个阶段来、第几步、那句详情"。混成一层会两头不讨好：用户被账本术语淹掉，或者排障时缺字段。所以 `ToolTracePanel` 收两个独立入参：`trace`（短摘要，永远可见）与 `diagnostics`（原始行，**默认不展开**）。
- **新增 `components/agent/ToolTracePanel.tsx`（5 例）**，四条纪律各有用例：
  1. 每条轨迹带一个**文字**状态（成功 / 注意 / 失败）—— 颜色只是装饰，灰度截图与色觉障碍下必须仍读得出来；
  2. 详细视图用**原生 `<details>`**，`open` 属性**默认不存在**（这就是 "opt-in" 的全部含义），而内容仍在 DOM 里，页内查找与屏幕阅读器都能发现；
  3. 没有诊断行时**那一节整块不渲染**（一块永远空的折叠区不是"开发者视图"）；
  4. 没有轨迹时**整个面板不渲染** —— 一个空的"运行轨迹"会被读成"跑了但什么都没发生"，而真实情况是我们还不知道。
- **接线**：`RunStatus` 原先就地渲染的那个 `<ol>` 交给 `ToolTracePanel`（**保留 `.agent-run-trace` 类名**，样式与既有选择器都还指着它）；`AgentMessage` 增加 `diagnostics?: string[]`；`agentStore.recordDiagnostic(line)` 与 `recordRunEvent` 分开 —— 它服务的是另一层读者，不能混进用户可见的轨迹；`agentRunner` 在事件循环里写诊断行，**只搬账本已有的字段**（`sequence.from → phase: detail`）。这条"只搬已有字段"是"遥测不含模型推理与图像字节"在实现层最省事的落法：这里根本没有可以塞进去的位置。
- **RED→GREEN**：`ToolTracePanel.test.tsx` 5 例；`agentRunner.test.ts` +1（运行确实往那一层写了行，且含 `preflight` / `planning`）。过程中 `RunStatus.test.tsx` 那条"列出整条轨迹"**真的红了一次** —— 因为我把 `<ol>` 的结构移进了新组件；修法是让新组件**沿用 `.agent-run-trace`**，而不是去改那条既有断言（选择器没坏，是实现搬了家）。
- **如实标注**：`trace` 的 `from` / `durationMs` / `toolId` 目前**只有 `phase`/`summary`/`status`/`at` 被填**，其余三个字段是给真实 provider 的工具调用留的位置（现在没有工具调用，填不了就不填）。

**验证证据（本批）**：单测 **178 文件 / 1989 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

### G2 第二十五批：把"工具"从声明接到可执行（`ToolCallRequest` 补形状 + `toolDispatch`）（2026-09-21）

- **缺口**：`ToolPort` 早就定义、`ToolCallRequest` 也早就存在，但它只有 `run` / `toolCallId` / `actionCount` / `signal` —— **没有工具名，也没有参数**。也就是说"接上 ToolPort"此前是一句空话：端口拿到请求也不知道要执行哪个工具。工具目录（`toolRegistry.ts`）声明了*模型能看到什么*，`sceneTools.ts` 实现了*真正怎么读场景*，而**从名字到实现的这一段**从来不存在。
- **补的形状**：`ToolCallRequest` 增加 `toolId: string` 与 `input: Record<string, unknown>`（并注明 `input` 是**不可信输入**，由分发器逐项校验后才交给下层）。
- **新增 `packages/agent-core/src/toolDispatch.ts`**（7 例）。四条纪律：
  1. **只认自己这张表里的名字**。未知名字如实报 `unknown_tool`，不转发、不猜。
  2. **目录声明了但没实现的工具如实报 `tool_not_implemented`**，并给出可执行的下一步（`scene.measure` / `scene.check_relations` / `scene.check_section` / `scene.capabilities` / `cad.inspect_drawing` / `run.explain_refusal` 目前都是这一类）。返回一个空数组会让模型拿着空结果继续推理；说"还没实现"它会去问用户。
  3. **参数畸形在这里拦下**（`invalid_arguments`）：把 `undefined` 传下去只会让下层崩在更远的地方，还会丢掉"是模型的参数不对"这个事实。
  4. **没有任何写文档的工具**。目录里唯一的写工具是 `draft.confirm_commit`，分发器**明确不认它**（有用例钉住）—— 写入只有 `CommitterPort.commit` 一条路。
- **一条自己给自己设的检查**：新增用例逐条核对"分发表里的每个名字都必须在**某个阶段**被目录声明过"。写这条时**当场抓到我自己多塞的一个名字**：`scene.resolve_label`（观察层有这个能力，但目录里没有它）。当时的两个选择是"把它加进目录"或"从分发表里去掉"；选了后者，因为**模型面向的工具边界应该由目录单独决定**，而"把用户说的标签解析成对象"是 `interaction.ask_clarification` 那一路的事，不该被模型当只读工具直接调。
- **宿主接线**：`AgentRuntime` 新增 `callTool(toolId, input)`，内部每次都 `createToolDispatcher({ scene: createSceneTools(createSceneObservation(readSceneDocuments())) })` —— **现取**场景，不缓存快照（观察层的"过期"检测就靠现取）；`AgentRuntime.test.ts` +3 例（真实路径读到一个对象 / 拒绝写工具且文档未动 / 连续两次调用看到的是新场景）。
- **RED→GREEN**：`toolDispatch.test.ts` 先因模块不存在整体失败（`Failed to resolve import "./toolDispatch"`）；`agentRuntime.test.ts` 的三条在接线前拿不到 `callTool`（类型层直接不过）。

**验证证据（本批）**：单测 **177 文件 / 1983 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

**仍未做**：`ToolTracePanel.tsx`（Task 2.6 Step 4）；worker 的 diff/check/artifact 信封；`ToolPort` 本身仍未被协调器在运行中调用（分发器与运行时方法都已就绪，缺的是"谁在什么时候调它"——那需要真实 provider 的 tool-call 通道，属 G1 之后）。

### G2 第二十四批：让"同意不可伪造"从注释变成代码（`HostBridge` 只认自己铸造的 nonce）（2026-09-21）

- **发现的缺口（比上一批严重）**：`ConsentToken` 的注释一直写着"协调器**既不能伪造它，也不能从模型输出里读出一个来**"，`hostBridge.ts` 的文件头也写着"同意由**宿主/UI**创建"。但 `commit` 原先只检查四件事：nonce 是否已消费、`runId` 是否相同、是否过期、`previewHash`/`draftVersion` 是否与当前草稿一致 —— **这四条调用方自己就能凑齐**：`preview()` 是公开的（`previewHash` 随手可读）、`expiresAt` 填一个未来时间即可、`runId` 就是这个桥的构造参数。也就是说**任何能调到 `commit` 的代码都能自带一份"同意"**，那句注释当时比代码强。
- **今天不可利用**：生产路径上只有 `agentRunner.confirm()` 调 `commit`，而它老老实实走 `requestConsent`。所以这是一条**被文档声称、但代码没有保证**的性质，而不是一个已被利用的洞 —— 但它是"可信执行底座"那一层的地基，将来接 provider / worker 时第一个会被踩到的就是它。
- **修法**：桥内新增 `minted` 集合，`requestConsent` 铸造时记下，`commit` 拒绝任何**没铸造过**的 nonce（`unminted_consent`），消费成功时从 `minted` 删掉。`minted` 与 `consumed` 回答的是两个不同的问题：**你有没有这份授权** vs **这份授权用过没有**，所以两个集合都要留。
- **RED→GREEN**：先写"手搓一份同意"的用例（伪造 nonce，其余字段照抄真值），**实测今天被接受**；加护栏后 `unminted_consent` 且 `replaced` 为空。**做了变异检验**：删掉那一行护栏后该用例确实失败，恢复后绿。
- **修的时候牵出一条既有用例的失真**：`refuses consent minted for another run` 原先拿"run-1 铸造的凭据"去 run-2 的桥上提交，断言 `wrong_run`。加了 `minted` 护栏后它先撞上 `unminted_consent`（拦得更早），于是那条用例**验不到 `wrong_run` 了**。修法是让它去**真的铸造**一份 run-2 的凭据再跨桥提交 —— 那才是在测"别的运行的授权能不能用在这里"；断言改成 `unminted_consent` 并补一条"跨桥授权一样不许写文档"。**没有放宽断言**，而是让夹具更真实。

**验证证据（本批）**：单测 **176 文件 / 1973 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

### G2 第二十三批：把"假设"从数据面接通到界面（`AssumptionList`），补上那条一直是空的一节（2026-09-21）

- **发现的缺口**：`ConfirmationPanel` 有 `assumptions` 这个 prop、`DraftPreview` 也有，计划 Step 4 逐字点名要列出 assumptions —— 但**计划信封里根本没有这个字段**，也没有任何地方会传值。**组件做完了、数据没有**，于是那一节在整条链上永远是空的。这类"看起来做完了"的缺口比缺失的组件更危险：读代码只能看到"已实现"。

- **数据面**：`PlanEnvelope` 三个分支各加可选 `assumptions?: string[]`（`contracts.ts` 的 `EnvelopeAssumptions`），由 `parsePlanEnvelope` 严格校验（非空、有界字符串、数组上限，与 `factIds` 同一条通道）。**归一规则**：字段缺失、显式 `undefined`、空数组**都是"没有假设"** —— 线上只承载一种语义，免得下游出现"`length > 0` 与 `!== undefined` 哪个才算真"的分叉。
  - 失败用例先写好：`assumptions: [""]` → `empty_string`、`[42]` → `invalid_type`、64 条 → `array_too_long`、带假设的计划 → 原样带出、不带 → `undefined`。

- **传递链路**：假设在**计划解析成功那一刻**就知道，而界面是运行**结束之后**才拿到草稿的，中间隔着"编译 → 校验 → 等确认"，界面没有第二条路。所以给协调器加了 `onPlanParsed?: (plan: PlanEnvelope) => void` 通知点（传的是**已校验的值**，解析失败的计划不会走到这里），运行时把它存进闭包并暴露 `assumptions()`，运行器写进草稿视图，`AgentMessageList` 传给确认面板。

- **界面**：新增 `components/agent/AssumptionList.tsx`（4 例）。抽出来而不是留在面板里，理由是**它有自己的可读性要求**（用户要一条一条判断"这条我认不认"）、**会被不止一处用到**（`DraftPreview` 与确认面板都要这一节），以及**"空清单不渲染"值得单独钉住** —— 一个永远显示的"系统替你做的假设：（空）"会被读成"它检查过了，确实没有"，而那是我们**不知道**的事。

- **RED→GREEN**：`agentRunner.test.ts` 新增 2 例（规划器声明的假设一路走到草稿视图 / 没声明时是 `undefined`）。为了能用"会说假设的规划器"跑这条链，`createAgentRunner` 增加可选 `planner` 依赖（本地确定性规划器从不声明假设，它产出固定动作）；生产路径不传，仍是本地规划器。**做了变异检验**：把 `agentRuntime` 里的 `onPlanParsed` 接线删掉后该用例**确实失败**（`expected undefined to deeply equal [...]`），恢复后绿 —— 证明它钉住的是真的接线，不是同义反复。顺带钉住一条纪律：**有假设不等于改了文档**，确认前 `primitives` 仍为 0。

- **过程中踩到的一个测试环境细节（记下来）**：我第一版用了 `toBeEmptyDOMElement` / `toBeInTheDocument`，本仓库**没有装 jest-dom**（`test-setup.ts` 只补 storage 与 PointerEvent），于是直接报 "Invalid Chai property" —— 看起来像断言失败、其实是断言不存在。已改为原生 matcher，并把这条写进该文件的注释。

**验证证据（本批）**：单测 **176 文件 / 1971 用例全通过（零跳过）**、typecheck exit 0、lint 0 error / 14 warning（基线）、生产构建通过、e2e **119/119**。

**仍未做（明确记下）**：`ToolPort` 仍未接线（且 `ToolCallRequest` **没有工具名与参数**，接线前要先补这个形状）；`ToolTracePanel.tsx` 未写（计划 Task 2.6 Step 4 的"用户可见轨迹 + 可选开发者详细视图"）；两个 worker 仍无 `new Worker` 调用方；G1 仍被 Rust 工具链缺失挡着。

### G2 第二十二批：修掉"传输层 → 动作层"接缝上的真实缺陷（`object.update_inputs` / `dynamic.bind_point` / `dynamic.bind_curve` 全都走不通），并把 `previewHash` 换成真哈希（2026-09-21）

- **来源**：一次对当前进度的独立审查。审查不是读文档，而是**实测**：单测 174 文件 / 1957 用例、e2e 119/119、typecheck exit 0、lint 0 error / 14 warning —— 数字全部复现，**但写了一个临时探针把"已校验的计划"喂进编译器，当场红了**。

- **缺陷 1（真实、且被两侧测试各自绕开）**：`schemas.ts` 把既有对象的引用规范化成 `{ scope:"scene", ref:{ documentId, entityId } }`，而动作层的 `SceneReference` 是**扁平**的 `{ documentId, entityId }`（`actions/types.ts`），编译器读的是 `inputs.target.documentId`。
  - 结果是这三个动作**不存在任何一种能同时通过校验并被正确编译的输入**：传输层唯一接受的形状 → 编译器读到 `documentId === undefined` → `cross_document_reference`，**操作数为 0**；编译器真正需要的形状 → 传输层判 `unscoped_reference`。
  - 实测证据（临时探针，已删）：scoped 形状 → `diagnostics: [{"code":"cross_document_reference"}]`、`operations: []`；扁平形状 → 同样。
  - **为什么此前没被发现**：`actions*.test.ts` 只喂**扁平**形状给编译器，`schemas.test.ts` 只喂 **scoped** 形状给解析器，**没有任何一条用例让"已校验的计划"流进编译器**。单测全绿，缝是空的。今天不暴露只因为本地规划器只认"建立方体 / 建点 / 只读问答"，一旦接上真模型，"改属性 / 绑动点"这类最高频的修改动作会 100% 失败，而且看起来像模型犯错。
  - **修法**：在**传输层**摊平成动作层的 `SceneReference`（`schemas.ts` 的 `readScopedReference`）。**没有放宽任何校验** —— 输入形状、字段白名单、`documentId`/`entityId` 的边界照旧；变的只是"交给下一层时写哪个形状"。选传输层而不是改动作层，理由是那个形状本来就是"带 `documentId` 的引用"，仍然满足"只给 `entityId` 不算数"这条纪律。
  - **RED→GREEN**：新增 `packages/agent-core/src/planToCompile.seam.test.ts`（3 例）。它**只用已校验的输出**（`parsePlanEnvelope(...).value.actions`），不手写动作字面量、不 `as` 动作类型 —— 两边的形状一旦再次分叉，这里必红。修前 2 例红（`expected [ { actionKey: 'rename' } ] to deeply equal []`），修后 3 例全绿。第三条是反向用例：指向**别的文档**的引用仍然被拒（`cross_document_reference`），证明这次摊平没有顺手把跨文档防线拆掉。

- **缺陷 2（文档已经记过待办，本批落地）**：`draftStore.previewHash` 填的是 `contentFingerprint(候选文档)` —— 那个函数返回**整份候选文档的规范化 JSON 字符串**，不是哈希。后果：契约（`ConsentRecord.previewHash`）与实际不符；以及确认面板第一版把它渲染出来时**整份候选文档被打在界面上**（第二十一批记的那次数据暴露）。
  - 改用 `@draw/agent-core` 的 `canonicalContentHash`（SHA-256 / 64 位十六进制）。**两者分工保留、不是重复实现**：`contentFingerprint` 是 scene-graph 内部的**语义等价**判据（递归剔 `revision` / `updatedAt`、`visible:true` 视同缺省），供 `SourceContext` 过期判定与 CAS 比较；`canonicalContentHash` 是给**对外契约**用的真哈希。它住在 agent-core 里是因为 agent-core 依赖 scene-graph，反向导入会成环。**`contentHash`（CAS 比较基准）本批刻意不动** —— 动它要一起改 `createDocumentHandle` 并重新验证 CAS 仍然成立，属单独切片。
  - **RED→GREEN**：`draftStore.test.ts` 新增 1 例钉住**形状**（`^[0-9a-f]{64}$` 且不含 `{`）。修前红：`expected '{"schemaVersion":"0.1","workspace":"c…' to match /^[0-9a-f]{64}$/`；修后 6 例全绿，且依赖 `previewHash` 的 4 个套件（hostBridge / pipeline / agentRunner / agentRuntime，共 38 例）保持全绿。

- **顺带修正一处数字漂移**：`capabilities.ts` 两处注释写"38 个操作变体"，而真值列表 `DOMAIN_OPERATION_NAMES` 与 `capabilities.test.ts` 的断言都是 **39**（计划正文的 `42/38` 同属笔误）。已按 39 更正并注明原因。

**验证证据（本批）**：单测 **175 文件 / 1961 用例全通过（零跳过）**（+1 文件：`planToCompile.seam.test.ts` 3 例；`draftStore.test.ts` +1 例）、typecheck exit 0、lint 0 error / 14 warning（基线）、e2e **119/119**。

**仍未做（明确记下）**：`contentHash` 与 `createDocumentHandle` 的同源问题（见缺陷 2）；`buildContext` / `createToolRegistry` / 两个 worker 文件仍然**没有任何生产调用方**（属 Task 2.4/2.5 的接线）；G1（Tauri / 真 provider）仍被 Rust 工具链缺失挡着。

### G2 第二十一批：确认面板（`ConfirmationPanel`）—— 并在它上面抓到一个真实的数据暴露（Task 2.5 Step 4，2026-09-19）

- **新增 `components/agent/ConfirmationPanel.tsx` + 17 例**：逐条实现计划 Step 4 点名的六样东西：**精确计数**、**假设**、**来源与目标**、**近似**、**删除警告**、**一步撤销声明**。
  - **只列真的有变化的类别**：一份"没有变化"的清单会把真正需要注意的那一行埋掉（有 `countDeltas` 单测钉住）。
  - **"看不见"与"不存在"分开说**：内部近似细节（细分点/母线）在文档里但画布与列表都不显示；隐藏对象在文档里但确认后也看不见。各自成行 —— 否则用户会以为确认后画布上会多出几十个点。
  - **删除显式警告**：净删除 > 0 时出一条 `role="alert"`，并说明恢复手段（只能靠撤销）；没删除时**不报警**（不喊狼来了）。
  - 计数缺省时**如实说"规模无法核对"**，而不是编一个数字。
- **修掉一处因重复渲染而生的缺陷**：`RunStatus` 里原来自带一份草稿摘要（含"确认并提交/丢弃草稿"），新面板又给一份 —— 页面上会同时出现**两个**同名按钮。这不是"多一层保险"，而是让无障碍查询与用户都面对歧义；**e2e 立刻以"找到多个按钮"和定位不到草稿区块报出来**。已把草稿 UI 完全归 `ConfirmationPanel`，`RunStatus` 只保留状态与动作（停止/重试/改一改），并把那 3 条已迁移的断言改写成"状态卡**不**渲染草稿按钮与数字"（正面钉住新的边界）。
- **本批最有价值的发现：确认面板第一个版本把整份候选文档打在了界面上。** 我原先显示一行"预览指纹"，而 `draftStore` 用 `contentFingerprint(record.candidate)` 填这个字段 —— 那个函数返回的是**规范 JSON 字符串**，不是哈希。于是界面上出现一长串 `{"schemaVersion":…,"primitives":[…]}`,**用户几何数据的又一份副本被渲染出来**。
  - 这正是我自己在第二十批写下的那条不变量（"草稿在界面里只是视图，不带候选文档"）被违反的地方，而**是 e2e 把它读出来才发现的**（断言"面板里不含 primitives"现在成了一条正式断言）。
  - **处置**：`ConfirmationPanel` **不显示**这个字段。理由：显示一份"看起来像指纹、其实是全文"的东西比不显示更糟。**未在此批改 `draftStore`** —— 把 `previewHash` 换成真正的哈希（`canonicalContentHash`）会改变 `HostBridge` 里 Compare-and-Swap 的比较基准，属于要单独验证的改动；已记入待办（见下）。
- **门禁（实测）**：单测 **174 文件 / 1957 用例全通过、零跳过**；e2e **119/119**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **新增待办（明确记下，不在本批顺手改）**：`apps/web/src/agent/draftStore.ts` 的 `previewHash` 应改为 `canonicalContentHash(record.candidate)`（`@draw/agent-core` 已经导出，是真正的 SHA-256）。它与 `apps/web` 侧 `createDocumentHandle` 的 `contentHash` 同源问题（也用了 `contentFingerprint` 的 JSON）—— 两者要一起改并一起验证 CAS 仍然成立，所以不夹带在 UI 批次里。

### G2 第二十批：把对象计数交给宿主，确认面板的数字与落盘一致（Task 2.5 Step 4 前置，2026-09-19）

- **做掉了确认面板（`ConfirmationPanel`）真正需要的那块地基**：计划 Step 4 要求面板给出 "**exact changed IDs/counts**"。数字必须来自**真实候选文档**，不能由界面自己估 —— 界面估的与真正要落盘的一旦不一致，用户就是在确认一件他没看见的事。
- **修法**：
  1. **把 `countDraftObjects` 从 `apps/web/src/agent/` 移到 `packages/agent-core/src/`**。理由：确认面板要给的是"这次会多出/少掉多少"，也就是**候选 vs 基础两份文档**的对比；宿主侧（`hostBridge.preview` 拿得到两份真实文档）与界面侧必须用**同一个函数**，否则两边各算一套。
  2. **`PreviewArtifact` 增加 `counts` 与 `baseCounts`**（都由 `countDraftObjects` 从真实文档算出），`preview()` 里**现取**基础文档 —— 用旧快照会把"多出多少"算错。
  3. 判据仍只有一处：`draftCounts` 现在直接从 `derivedPrimitives` 取 `isDerivedPrimitive` / `isTessellationPrimitive`（上一批已经把那份清单收进 agent-core）。为了不把 `apps/web` 的 `primitiveVisibility` 拖进包里，包内自带一个 `isVisible`（一行，与 app 侧同一判据）。
- **移动后需要改的引用**：`DraftPreview.tsx` / `DraftPreview.test.tsx` 从 `@draw/agent-core` 导入；`hostBridge.ts` 从包导入并补上 `DraftObjectCounts` 类型。两个计数测试文件也跟着移到包里（其中一个的 `DERIVED_PRIMITIVE_TYPES` 改为从 `./derivedPrimitives` 导入）。
- **门禁（实测）**：单测 **173 文件 / 1940 用例全通过、零跳过**（移动后净 +2 例，即新增的确认面板计数用例）；e2e **119/119**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **如实标注**：本批**只做了计数这块地基**，`ConfirmationPanel.tsx` 组件本身还没写（它要渲染"精确的改动 id / 计数、假设、来源与目标、近似、删除/锁定警告、一步撤销声明"里的前两项与警告）。下一批从它开始。

### G2 第十九批：停止与重试接上真实取消（Task 2.5 交互收尾，2026-09-19）

- **`agentRunner` 新增 `stop()` 与 `retry()` + 4 例**，界面按钮不再是摆设：
  - **`stop()` 走协调器的真实取消**：`coordinator.cancel("user")` 会置位、abort 掉各端口的信号、把账本收尾到 `cancelled`。运行器只在**确实取消成功**时返回 `true`；没有运行时实例就如实返回 `false`（**不假装取消成功**）。
  - **取消之后草稿一并作废**：留着它会让用户看到一份**永远不会生效**的预览。有一条用例断言"停止后再点确认必须被拒"。
  - **界面文案说清后果**："已按你的要求停下。**没有改动文档**。"（并标 `retryable: true`，所以"重试"按钮会出现）。
  - **`retry()` 用同一句话跑**新一轮，不复用上一轮那份已作废的草稿。
- **重试的"上一句话"判据与自动运行完全一致**（都在消息列表里找最后一条用户消息），所以不会出现"重试了另一句话"；找不到用户消息时**什么都不做**，而不是编一个空 prompt 去跑。
- **一处实现上的自纠**：`retry` 起初写成 `this.run(...)`，而我对 `runtime` 变量做了遮蔽（`let runtime` 与对象方法里的参数同名），于是 `this` 指向变得不必要地脆。改为把 `runPrompt` 定义成**闭包内的具名函数**，`run: runPrompt` 与 `retry` 都直接调它 —— 不依赖 `this`。
- **门禁（实测）**：单测 **172 文件 / 1938 用例全通过、零跳过**（+4 例）；e2e **119/119**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **如实标注（e2e 未覆盖 stop 的原因）**：本地确定性规划器跑完一轮只要**几百毫秒**，而"停止"按钮只在 `pending` 期间存在 —— 在浏览器里点击它需要卡在那个窗口内，**这种用例必然是抖的**。所以停止/重试由 4 条单测覆盖（走真实的协调器取消路径），**不写成 e2e**；等真实 provider 接入、单轮耗时变成秒级之后再补浏览器用例才可靠。
- **Task 2.5 仍未完成**：① `ConfirmationPanel.tsx` / `AssumptionList.tsx` / `ToolTracePanel.tsx`；② `ToolPort` 未接线；③ cancel / switch-workspace 两条 Playwright 路径（同上：前者要等真实 provider）。

### G2 第十八批：**修好上一条浏览器阻塞** —— 根因是我自己的 store 逻辑（Task 2.5 Step 5，2026-09-19）

- **上一批那条红的 e2e 已经转绿，根因找到了，而且我上一轮的诊断是错的。**
  - **真根因**：`agentStore.recordDraft` **保留了 `pending: true`**（写成 `message.pending ? { ...message, draft } : message`）。于是运行明明已经停在"等你确认"，界面却一直显示**"进行中"** —— 用户在浏览器里看到的就是转不完的加载，而草稿预览就在下面摆着。**`RunStatus` 的判据是"pending 优先"**，所以 pending 不清就永远显示进行中。
  - 修法：`recordDraft` 同时把 `pending: false`（等待确认**不是**"还在跑"）。补了一条 store 用例正面钉住它。
- **我上一轮的两个诊断都被实测推翻，如实记下**：
  1. 我说"可能是 Playwright 服务旧 bundle" → **不成立**：`e2e/global-setup.mjs` 每次运行都会 `rm` 掉产物目录并**重新 build**，bundle 一定是当前的。
  2. 我按"断言太急"把超时从 5s 提到 30s → **仍然失败**（61 次轮询都是"进行中"）。**这一条让我排除了"慢"，把问题定位到"状态永远不会变"**。
  3. 关于"没有捕获到任何控制台输出"：真正的原因是**生产构建会把 `console.log` 摇掉**（vite build 的 minify）。所以"日志没打出来"从来不是证据 —— 我上一轮把它当成线索是错的。**换用 `page.evaluate` 直接读 DOM 状态**才拿到决定性事实：轨迹已经走到"等待你确认"、草稿区块已存在、而 `data-status` 仍是 `running`。
  - **教训（值得留着）**：**在构建产物里用 `console.log` 做诊断是不可靠的**；要读就读取状态（DOM / store），不要读日志。
- **新增 `e2e/agent-flow.spec.ts` 三条全绿**（上一批 2/3）：
  1. **完整链路**：一句话 → 真实运行 → 草稿预览（写着"还没有写进文档"与"只占一步撤销"）→ 确认前画布**空** → 点确认 → "已提交" → 回画布**对象出现** → `Ctrl+Z` **一步撤销回空**；
  2. **丢弃草稿**：丢弃后没有草稿、没有"已提交"、画布上什么都没有；
  3. **认不出时问用户**：状态"没有完成" + 原因码 `needs_more_information`，没有草稿也没有对象。
- **一条既有 e2e 的前提被产品行为改变，已如实改写而不是放宽**：`app-modules.spec.ts` 里"回到画布后点「添加点」"这个断言，第 1 条链路里说的那句话是"画一个正方体"，而**运行会在编译前把工作区切到立体几何**（`prepare` 钩子，第十七批加的），所以回画布时平面命令「添加点」根本不在那儿。改写为断言**3D 工作区的命令在且可用**（点「添加空间点」后对象列表出现条目），并在注释里写明原因。
- **门禁（实测，全部转绿）**：单测 **172 文件 / 1934 用例全通过、零跳过**；e2e **119/119**（上一批 117 通过 / 2 失败）；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）；诊断代码零残留（逐个文件核对过）。
- **Task 2.5 仍未完成**：① `ConfirmationPanel.tsx` / `AssumptionList.tsx` / `ToolTracePanel.tsx`；② `ToolPort` 未接线；③ `stop` / `retry` 按钮尚未接协调器的取消与重试；④ cancel / switch-workspace 两条 Playwright 路径还没走。

### G2 第十七批：编译前的目标准备（workspace prepare）+ 一条**未修好**的浏览器阻塞（Task 2.5 Step 5 部分，2026-09-19）

- **发现一个真实设计缺口（已修）**：动作编译器会拒"工作区不匹配"的动作 —— 探针确认 `compileActions` 对平面几何里的 `solid.create_template` 返回 `workspace_mismatch`。而用户在 Agent 里说"建一个立方体"时，画布可能停在**平面几何**。没有准备步骤，用户就必须自己先切工作区再重发一次 —— 那不是"对话式作图"。
  - **修法**：给协调器加 `prepare(plan)` 钩子，在**编译之前**调用（位置是关键：编译器会直接拒工作区不匹配的动作）。它拿到的是**已校验的计划**，不是模型的原始输出。`packages/agent-core/src/coordinator.ts` + 3 例（先准备后编译的顺序、被拒时不暂存任何东西、只读回答**不**调用它）。
  - 运行器侧 `prepareWorkspaceFor` 按动作名前缀判断目标工作区（`solid.`/`section.`/`dynamic.` → 立体几何，`planar.` → 平面几何）。**工程制图不参与自动切换**：在工图里说"建一个立方体"时直接切走会让用户当前的图纸上下文消失，而这条指令本来就不属于那个工作区 —— **如实拒绝**比悄悄切走更尊重用户。
- **新增 `e2e/agent-flow.spec.ts`（3 条浏览器用例）**：
  1. **完整链路**（一句话 → 草稿预览 → 确认 → 文档真的变了 → 一步撤销）—— **目前失败**；
  2. **丢弃草稿**（丢弃后没有草稿、没有"已提交"、画布上什么都没有）—— ✅ 通过；
  3. **认不出时问用户**（状态为"没有完成"、原因码 `needs_more_information`、没有草稿、没有对象）—— ✅ 通过。
- **第 1 条卡在哪里（如实记录，未修好）**：浏览器里发送之后运行状态卡停在**"进行中"**不再前进；`RunStatus` 正常渲染、`role="region"` 与草稿区块的无障碍名字都已修正（第 2/3 条因此能过），但**完整链路那条走不到 `awaiting_confirmation`**。我加过浏览器事件追踪（`for await` 循环里与 `run()` 入口各一处），却**没有捕获到任何浏览器控制台输出** —— 说明"没打出来"这件事本身还没查清（可能是监听时机，也可能是运行确实没进入循环），**我没有据此下结论**。为了不把诊断代码留在仓库里，这些 `console.log` 已全部删除并确认零残留。
  - **下一步的查法**（写下来免得下次重新摸索）：在 `agentRunner.run()` 入口与 `AgentWorkspace` 的自动运行 effect 里各打一条，但改用 `page.evaluate` 直接读 `useAgentStore.getState().pendingReplyId` 与消息上的 `trace`，而不是依赖控制台捕获；同时确认 Playwright 的 `webServer` 是**重新构建**过的产物（旧 bundle 会让新代码的日志根本不出现）。
- **门禁（实测，如实说明）**：单测 **172 文件 / 1933 用例全通过、零跳过**（+3 例）；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）；e2e **117 通过 / 2 失败**（新增 3 条里 2 条通过，另 1 条失败；要说明的是**另有 1 条既有用例也被带失败** —— 见下）。
  - **既有用例被带失败的那一条**：`e2e/app-modules.spec.ts` 里那条"发送之后状态卡不留下永远转圈的进行中"，与新增失败项是**同一个根因**（浏览器里那轮运行不会结束）。所以两处失败其实是**一个**阻塞点，不是两个。
- **这一批不该报"完成"**：Task 2.5 Step 5 要求"Verify component tests, typecheck, and the Agent Playwright flow"，而浏览器流程**有一条红的**。我把它如实留在这里，并把它列为下一轮的第一件事 —— 而不是把断言放宽成能过。

### G2 第十六批：确认并提交真正落盘（Task 2.5 Step 4，2026-09-19）

- **新增 `apps/web/src/agent/agentRunner.ts` + 8 例**：把"运行 → 确认 → 提交 → 撤销"整条链走通。此前草稿能暂存、能显示，但**点"确认并提交"没有回调** —— 用户看得到草稿却落不了盘，这是那条链上最后一段缺口。
  - **运行器必须跨"运行结束 → 用户点确认"活着**：协调器是按运行建的（每次 `start` 重置账本），而确认发生在运行**之后**。所以运行器持有上一次的 `AgentRuntime`。做成**模块级单例**而不是 React 状态，是因为组件在切换模块时会卸载 —— 放进组件状态会让"切走再切回来"丢掉等待确认的草稿。
  - **界面唯一能触达提交的地方**：`confirm()` 只调 `runtime.confirmDraft()`，后者只调 `HostBridge.requestConsent` + `HostBridge.commit`。界面那一层拿不到 `commit`、也造不出同意凭据 —— 这是"提交不是模型可见工具"在装配层的落点。
  - 用例覆盖计划 G2 Gate 那条链的每一环：**暂存后真文档一个字节没变** → **确认后文档真的变了且恰好压一步历史** → **`undo()` 一步回到原样** → **拒绝二次提交**（同意是一次性的，第一份草稿用完就该消失）→ **丢弃后文档与历史都不动** → **不确认就永远不变** → **规划器认不出时给"需要补充信息"而不是编回答** → **轨迹记录完整**。
- **测试抓到转移表里一个真实缺口（本轮的第二个产出）**：`answering → waiting` 这条边我**漏了**。后果是"问澄清问题"这条路径**永远走不到 `waiting`** —— 运行停在 `answering`（账本上看起来像"答完了"，其实什么都没答），用户看到一条空的助手消息且**无处可答**。已补上并写明原因。这是第二次由用例逼出转移表的修正（上一次是只读路径缺 `answering` 状态）。
- **`App.tsx` 里那份重复的运行实现被删掉**：上一批我在 App 里写了一遍运行逻辑，本批改为转发给 `agentRunner` —— App 不该再有一份自己的运行实现，否则界面行为与 `agentRunner` 的测试会慢慢分叉（这个项目已经因为"同一个判断写两遍"吃过四次亏）。顺带清掉因此变成死代码的 `PHASE_SUMMARY` 与两个失效 import（lint 一度升到 17 条，清完回到基线 14）。
- **门禁（实测）**：单测 **172 文件 / 1930 用例全通过、零跳过**（+1 文件 / +8 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.5 仍未完成**：① `ConfirmationPanel.tsx` / `AssumptionList.tsx` / `ToolTracePanel.tsx`（`RunStatus` 已覆盖确认/丢弃与轨迹基本面，"假设清单"与"可选的开发者详细视图"还没有）；② e2e 里还没有"点确认 → 画布上出现对象 → 撤销一步"的**浏览器**用例（单测已覆盖同一路径，但计划 Step 5 要求 Playwright）；③ `ToolPort` 未接线；④ `stop` / `retry` 按钮尚未接上协调器的取消与重试。

### G2 第十五批：删掉演示回复，接上真实运行（Task 2.5 Step 2，2026-09-19）

- **删除 `apps/web/src/agentDemoReply.ts`**（`composeDemoReply` 与那个 320ms 的 `setTimeout` 一并去掉）。计划 G2 Gate 逐字要求生产路径上不再有演示回复，本批兑现。删除后全仓库检索确认**零残留引用**。
- **`AgentWorkspace` 改成"只发起 + 只显示"**：新增注入端口 `onRun(prompt, promptMessageId)`，组件自己**不再有任何"如果没有模型就编一段"的分支** —— 那种分支正是把假成功带回生产路径的方式。4 条新用例守住这条边界：
  - `onRun` 收到的 `promptMessageId` **必须是那条用户消息的 id**（计划原句 "route `sendPrompt` to Coordinator with promptMessageId"）；
  - 发送后界面显示**运行状态**而**不是**编造的回答（断言文本里不出现"本地占位"/"还没有接入模型服务"）；
  - 同一轮**只发起一次**（StrictMode 双挂载与 store 更新引起的重渲染都不能让它跑两遍）；
  - 没有注入 runner 时界面仍可用（不抛错）。
- **新增 `apps/web/src/agent/localPlanner.ts` + 10 例（本地确定性规划器）**：这不是"换个说法的演示回复"，差别是本质的 —— 演示回复产出一段**常量文本**、不触碰编译/草稿/提交任何一环；本地规划器产出的动作**真的会**被编译、真的会进草稿、真的会要求用户确认，认不出时**问用户**（`clarification` → 运行进入 `waiting`）而**不是编一个答案**。
  - 认得出：`立方体`/`正方体`/`cube`（尺寸来自指令里的数字）、`画/作/建/添加 + 点`、`有什么`（只读回答，**不可能**产生动作）。
  - **每条输出都过 `parsePlanEnvelope`**（有用例逐条核对），否则它在真实运行里一定会被拒。
  - 认不出时明确说"没有接入模型服务，本地规划器只认识几条固定指令" —— 如实告知能力边界，而不是含糊其辞；输出**确定性**（同一输入两次结果逐字相同），评测与 e2e 因此不抖。
  - G1 到位后真实 provider 通过同一个 `PlannerPort` 接进来，这个文件**原样保留**（离线/评测环境仍需要它）。
- **`App.tsx` 接上真实运行时**：`runAgentPrompt` 用真实 `createAgentRuntime`（真实 `DraftStore` + 真实 `HostBridge` + 真实 `createCommitterAdapter` + 真实协调器）跑一轮，把**每一步阶段**回流到界面的运行状态卡；到 `awaiting_confirmation` 时把草稿的**视图**（标识 + 计数）记进消息；`waiting` / `failed` 分别落到"需要补充信息"与可读的失败原因。阶段名翻成中文（`PHASE_SUMMARY`），用户不需要看内部英文枚举。
  - **导出预检在 Agent 路径上暂时如实回"无法预检"**，而不是给一个假的"可以导出"：真实预检要投影结果，只有工程制图那套组件知道怎么取。
- **`AgentMessageList` 渲染运行状态卡**，并且**保留**在途消息气泡里那句带 `role="status"` 的短标签 —— 屏幕阅读器靠它播报，状态卡负责说明"走到哪一步"，两者不互相替代（有一条既有用例专门守"不要渲染空气泡"，本批没有把它删掉当作"顺手清理"）。
- **e2e `app-modules.spec.ts` 的断言跟着改了**：原先断言的是演示回复里的代码块 `[data-code-language='ts']`；现在改成断言**运行真的发生了** —— 运行状态卡可见、状态文字非空、**不出现"已提交"**（用户没确认过任何东西）、也不留下一个永远转圈的"进行中"。这比原来那条断言强：它验证的是真实链路。
- **门禁（实测）**：单测 **171 文件 / 1922 用例全通过、零跳过**（+2 文件 / +14 用例，另改 1 条 e2e 断言）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.5 仍未完成**：① `ConfirmationPanel.tsx` / `AssumptionList.tsx` / `ToolTracePanel.tsx` 未建（`RunStatus` 已覆盖确认/丢弃与轨迹基本面）；② 确认提交的按钮还没接上 `HostBridge.commit`（草稿能暂存、能显示，但点"确认并提交"目前没有回调）；③ `ToolPort` 仍未接线；④ Step 5 的完整 Agent Playwright 流程。

### G2 第十四批：消息模型与运行状态卡（Task 2.5 Step 1/3 上半，2026-09-19）

- **扩展 `agentStore.ts` 的消息模型**：助手消息现在能带 `runId` / `trace` / `draft` / `commit` / `failure`。真实运行产出的是**事件流 + 草稿状态 + 提交回执**，而原先的消息只有 `{ text, pending }` —— 这正是上一轮查明的 Task 2.5 阻塞点，本轮把它拆开。
  - **`AgentDraftView` 里只有标识与计数，没有候选文档、没有操作列表**。候选文档只存在于宿主侧的 `DraftStore`；把它放进 store 有两个后果：① 用户文档的副本会被**持久化进 localStorage**（聊天记录里出现用户几何数据的拷贝）；② 界面成了第二份真相。有一条用例把持久化内容与消息序列化后**断言不含 `primitives` / `candidate`**。
  - **迟到事件被丢弃**：`recordRunEvent` / `recordDraft` / `recordReceipt` / `failPendingReply` 都走同一个内部实现，规则只有一处 —— 没有在途消息时**什么都不做**（不凭空造消息）、收到终态后 `pendingReplyId` 清空所以**迟到事件进不来**。两条独立用例分别覆盖"回执之后再来轨迹"与"没有在途消息时的任何更新"。这直接对应计划 Step 1 的 "late response"。
- **新增 `components/agent/RunStatus.tsx` + 12 例**：逐字实现计划 Step 3 的三条要求。
  - **进度要说得出来**：不是转圈，而是"进行中 + 现在在哪一步"，并把整条轨迹逐行列出（阶段名翻成中文，不显示内部英文枚举）。
  - **状态不能只靠颜色**：每条轨迹带**词**（`成功` / `注意` / `失败`），整体状态也带词（`进行中` / `已提交` / `等待你确认` / `没有完成`）。有用例断言三条轨迹的文字状态恰好是这三个词 —— 色觉障碍用户与灰度截图里靠的就是它。
  - **失败要可执行**：显示原因、**原因码**（用户报问题时比"失败了"有用）、以及"重试 / 改一改"。**不可重试的失败不给重试按钮**（给一个没用的按钮比不给更糟，单独有用例）。
- **测试抓出的一个真实渲染缺陷**：草稿已暂存但运行不再 `pending` 时（即"等你确认"这一态），我的 `progressOf` 直接返回 `null`，于是**整块草稿预览（含确认/丢弃按钮与一步撤销声明）都不渲染** —— 用户看到一条空消息，却没有任何东西可点。已修：草稿存在时状态为 `等待你确认`，并补上原因注释。
- **门禁（实测）**：单测 **170 文件 / 1908 用例全通过、零跳过**（+2 文件 / +20 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.5 仍未完成**：① `AgentWorkspace.tsx` 仍在用 `composeDemoReply` + `setTimeout`（Step 2 未做 —— 现在消息模型与状态卡就绪，接真实协调器这条路已通）；② `ConfirmationPanel.tsx` / `AssumptionList.tsx` / `ToolTracePanel.tsx` 三个组件未建（`RunStatus` 已覆盖确认/丢弃与轨迹的基本面，但计划点名的"假设清单"与"可选的开发者详细视图"还没有）；③ Step 5 的 Agent Playwright 流程未走。

### G2 第十三批：运行遥测与脱敏（Task 2.6 的 TypeScript 部分，2026-09-19）

- **新增 `agent-core/src/events.ts` + 18 例**：计划点名的三条逐条落地。
  - **`redactDiagnostic(value, knownSecrets)`**：删掉 Authorization、密钥值、代理口令与查询串里的秘密，并**限制长度**（512）。
    - **核心不是"能替换已知密钥"（那太容易），而是"没有已知清单时也不漏"** —— 脱敏不能依赖调用方记得把每个密钥都传进来。所以规则是**默认拒绝**：`sk-` / `sk-ant-` / `ghp-` 这类前缀串，以及**任何 32 位以上的长随机串**，一律替换。有用例分别覆盖"已知密钥"、"Authorization 头"、"JSON 里的 apiKey"、"URL 查询串里的 key"、"无上下文的前缀密钥"、"纯长随机串"。
    - **反方向也有用例**：一条普通诊断（`compile_failed at envelope.actions[0].inputs.radius: …`）必须**原样保留** —— 脱敏过度会让日志毫无用处。
    - 循环引用**不许抛错**：它会在错误路径上被调用，那时抛错最难查（单独有用例）。
  - **`appendRunEvent` 只追加 + 按 `eventId` 幂等**：重复 id 是 **no-op** 而不是错误，且**先到的那条不会被后来者改写**（幂等是"重试/恢复"能用的前提）。另有 `byId` 支撑计划 Step 1 的 **commit-receipt recovery**（应用中断后按事件 id 找回提交结果）。
  - **绝不存原始推理与图像字节**：写入前做**结构检查**，发现 `reasoning` / `chainOfThought` / `imageBytes` 等字段就**拒绝**（不是"过滤掉那个字段" —— 静默丢弃会让人以为日志里已经有完整信息）。这比"记得不要传"可靠：将来有人顺手把整条 provider 响应塞进事件，这里当场拦下。
  - 事件带全计划点名的**九个标识**（run / conversation / prompt / request / attempt / tool / draft / consent / commit）、阶段、状态、耗时、用量与**三方版本**（能力注册表 / 工具目录 / 计划 schema）。账本**有界**（`MAX_EVENTS_PER_RUN`，超出丢最旧的）。
- **命名冲突（编译期抓到）**：`events.ts` 与 `runState.ts` 都导出了 `RunEventIds`，而**两者形状不同** —— `index.ts` 的 `export *` 直接报 `already exported a member named 'RunEventIds'`。已把事件侧的改名为 `RunTelemetryIds`（保留 `runState` 的那个，因为协调器与它的测试都在用）。
- **两处 lint 错误也是本轮引入并当场修掉的**：正则字符类里的 `\-` 是多余转义（`no-useless-escape`）。
- **门禁（实测）**：单测 **168 文件 / 1888 用例全通过、零跳过**（+1 文件 / +18 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **本轮**没有**动 Task 2.5**（详见下），也没有做 Task 2.6 的 Rust 侧（`run_events.rs`）与 `ToolTracePanel.tsx`。

### Task 2.5 的阻塞点（本轮查明，不是"还没做"而是"要更大范围的改动"）

计划 Step 2 要求"Remove `composeDemoReply`/demo delay from the production path and route `sendPrompt` to Coordinator with promptMessageId"。**实测读代码后的结论**：这一步不是替换一个函数（`agentDemoReply.ts` 的注释里当初是这么设想的），而是**要改消息模型**：

- `AgentWorkspace.tsx` 在 `pendingReplyId` 上挂一个 `setTimeout`，用 `composeDemoReply(prompt)` 产出一段**纯文本**；
- `agentStore.resolvePendingReply(text)` 只接受**字符串**，消息类型只有 `{ text, pending }`；
- 而真实运行产出的是**事件流**（阶段 / 状态 / 诊断）＋**草稿状态**（版本 / 预览哈希）＋**提交回执**。

也就是说，Step 2 依赖 Step 1/3/4 里那套 `RunStatus` / `ConfirmationPanel` / 结构化消息字段（计划 Task 2.5 的 Files 一栏也列了 `RunStatus.tsx`、`ConfirmationPanel.tsx`、`AssumptionList.tsx`、`ToolTracePanel.tsx` 四个新组件）。**如实记录**：本轮没有开始它，因为把它切成"只删演示回复、不建消息模型"会让界面进入一个中间态（发送后什么都不显示），那比现状更差。下一轮从"消息模型 + `RunStatus` 卡片"开始做。

### G2 第十二批：宿主组装 —— 所有部件第一次真正跑在一起（Task 2.4 组装，2026-09-19）

- **新增 `apps/web/src/agent/agentRuntime.ts` + 7 例**：把协调器、草稿存储、宿主桥、提交适配器、观察层、工具、导出预检**装到一起**。
  - **此前从未验证过的一件事**：每个部件各自都有测试，但"它们能不能一起跑"没人试过。这个文件就是那处连接，而它的测试**一个替身都不用** —— 真实的 `DraftStore`、真实的 `HostBridge`、真实的 `createCommitterAdapter`、真实的协调器；唯一被替身化的是 `PlannerPort`（真实模型调用被 G1 的 Rust 缺失挡着）。
  - **一次规划运行之后真文档必须一个字节都没变**：这是整条链最关键的性质，有独立用例。
  - **只读运行走通组装好的观察层**：事件序列正好是 `preflight → observing → planning → answering → completed`。
  - **刻意不注入同意凭据**：`createAgentRuntime` 不创建 `ConsentToken`，所以即使调用方传 `confirmed: true` 也**提交不了**（停在 `awaiting_confirmation`）—— 同意只能由宿主在用户确认后铸造，这条在装配层复述一次而不是靠记忆。
  - **工具与提交器共用同一个草稿存储**：有一个用例先经 `draftTools` 建草稿并暂存，再用 `hostBridge().preview()` 读到它 —— 若两处各建一个 `DraftStore`，模型看到的草稿与提交的就不是一回事。
  - **三条装配纪律写进注释**：① 句柄必须**现取**（缓存句柄会让 CAS 永远通过，等于静默关掉整个机制）；② 工具与提交器必须共用**一个** `DraftStore`；③ `replace` 只由宿主调用（用 `commitCandidate` 而不是 `replace`：前者压一步历史、撤销得回去）。
- **接线时被类型检查抓到的四处真实 API 不一致（都改对了，没有一处靠"看着差不多"蒙过去）**：
  1. `createHostBridge` 是 app 自己的导出，**不在** agent-core 里 —— 我重复 import 了一次；
  2. agent-core 的端口叫 `DraftStorePort`，不是我以为的 `DraftToolsPort`；
  3. `DraftStore` **只有 `invalidate(draftId, reason)`，没有 `discard`** —— 我按记忆写的方法不存在。适配器现在如实映射（并且"丢弃"要真的返回是否丢弃过）；
  4. `DraftStore.StageResult.diagnostics` 是**可选**的，而端口要求必有 —— 在适配器里显式 `?? []`。
  另有一处：`StageReason` 含 `unknown_draft`，我的端口联合类型漏了它，编译期报出后补齐。
- **一次险些重犯旧错**：改端口名时我用了 PowerShell 的 `Get-Content | Set-Content` 做文本替换 —— 那正是我在第六批里把中文注释写成乱码的方式。这次显式加了 `-Encoding UTF8`，并且**立刻读回文件确认**中文完好、行数一致。**记在文档里的教训要用上，而不是只写下来。**
- **门禁（实测）**：单测 **167 文件 / 1870 用例全通过、零跳过**（+1 文件 / +7 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.4 仍未完成**：① 这条运行时还**没有接到 UI**（Agent 工作区仍用演示回复，属 Task 2.5）；② worker 的 diff/check/artifact 信封（Step 4）；③ Step 5 的 Playwright"只产生草稿不提交"场景；④ Step 2 的"锁定模板拓扑"要由真实 `validatePatch` 路径覆盖。

### G2 第十一批：接线 —— CommitterPort 接上草稿与宿主，动作类型归一（Task 2.4 接线，2026-09-19）

- **新增 `agent-core/src/committerAdapter.ts` + 12 例**：把协调器的 `CommitterPort` 接到 G0.5 的 `DraftStore` + `HostBridge`。这是整条链上**唯一**能写文档的地方，所以三条纪律各有用例：
  - **暂存只产生隔离草稿**；**提交必须带用户同意** —— `commit` 委托给 `HostBridge.commit`，而它自己会检查同意记录（一次性、绑定预览哈希、会过期、绑定 runId）并做 Compare-and-Swap。**这里不复制那套判断**：复制就是把安全边界摊成两份。适配器**不检查**同意凭据（在协调器里它是不透明载荷），只原样转交。
  - **失败原因不合并**：`stale_draft`（基础文档被手工改过）与 `stale_draft_version`（调用方拿的是旧版本）是两回事，处置也不同；`stale_source` 与普通拒绝同样分开。
  - **适配器要记住"这次运行用的是哪个草稿"**：协调器按"运行"工作，而 `HostBridge.commit` 要的是**草稿 id**。记不住的话第二次阶段调用会新建草稿，`commit` 就会提交一个**用户没看过的预览**。有用例断言两次阶段只建一个草稿。
- **修掉一个真实的设计缺口**：`CommitterPort.stage/commit` 的入参原先**只有 `actionCount`**，没有动作本身 —— 适配器拿不到动作，"暂存"在真实接线时无中生有。现在 `CommitRequest` 带上 `actions`，协调器把解析出的动作传下去。**计数是给人看的说明，动作才是要编译的东西，而动作不能靠计数推出来。**
- **修掉一处类型身份问题（本轮最有价值的发现）**：agent-core 的 `contracts.ts` 里有一份**自己的** `DraftAction`（`inputs: Record<string, unknown>`），与动作层的 `DraftAction`（联合类型，`inputs` 按动作名各有形状）**不是同一个类型**。后果：`PlanEnvelope.actions` 里的动作**传不进编译器**，只能在中间加一层无意义的转换 —— 而任何转换都意味着"有一处可以悄悄改字段"。
  - 现在 `contracts.ts` 直接 `export type { DraftAction } from "@draw/scene-graph"`。运行时仍然严格（`parseDraftAction` 逐字段构造，绝不把 `unknown` 断言成业务类型）；`schemas.ts` 里保留**唯一一处** `as DraftAction`，并在注释里写明它是"说明形状已由上面的校验保证"，不是绕过校验。
  - 顺带确认：agent-core 与 scene-graph 的 `DocumentHandle` 也是**两个同名类型**（形状相同、nominal 不同），跨包赋值会被拒 —— 本次按"手写契约里的形状"处理，未合并（合并要动 `sourceContext.ts` 的导出面，留给后续）。
- **测试替身第三次咬人（同一类教训的第三例）**：适配器的假 `HostBridge.preview` 我第一版写成**恒返回版本 1**，而真实的 `HostBridge.preview` 从草稿存储里读当前版本 —— 于是第二次暂存必然被判 `stale_draft_version`，测试失败。改法是让替身的版本与假草稿存储**同步**（`onStaged` 回调）。**三次都是同一件事：替身与生产代码不一致，测试就测不到真东西**（前两次是替身太宽松，这次是太死板）。
- **门禁（实测）**：单测 **166 文件 / 1863 用例全通过、零跳过**（+1 文件 / +12 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.4 仍未完成**：① 用 `createCommitterAdapter` 在 `apps/web` 里真正组装协调器（宿主接线）；② worker 的 diff/check/artifact 信封（Step 4）；③ Step 5 的 Playwright"只产生草稿不提交"场景；④ Step 2 的"锁定模板拓扑"要由真实 `validatePatch` 路径覆盖。

### G2 第十批：交互工具与 WinAnsi 规则归一（Task 2.4 中段，2026-09-19）

- **新增 `agent-core/src/tools/interactionTools.ts` + 11 例**：计划点名的三个工具（`ask_clarification` / `propose_view` / `propose_export`）。它们的共同性质是**只提议、不执行** —— 没有一个会改文档或直接产出文件。
  - **`propose_export` 刻意"消费"预检而不是自己算**：导出预检（`apps/web/src/services/exportService.ts` 的 `buildExportPlan`）已经完整实现了"哪些来源会被略过 / 哪些字会被写坏 / 哪些格式被阻止"，而且它才是导出时**真正**要用的那份。在这里再算一遍的结果必然是**建议与执行不一致** —— 用户按 Agent 的说法确认，拿到的文件却不是那样。所以工具收一个 `ExportPreflightPort`，只负责把结论**如实且有限地**讲给模型。
  - **三种结局分开**：干净（`success`）、有损失需接受（`warning` + `needs_acceptance`）、被阻止（`error` + `export_blocked`）。预检**自己失败**时如实报错并给 `recovery.safeRetry = "refresh_context"`，**不编一个"看起来能导出"的提议**。
  - **提议有界**：每类损失最多列 6 条，截断时补 `truncated_losses` 诊断（否则模型会以为"就这些损失"）。
  - `ask_clarification` 明确下一步是"等用户回答"而不是自己猜一个数值；`propose_view` 只提议，采纳与否交给 UI 策略。
- **顺带做掉一处真实的重复判据（本轮第二个产出）**：`winAnsiSafe` 原先只写在 `apps/web/src/persistence/engineeringExporters.ts` 里，而**导出预检**也要报同一条损失。两处各写一份的分叉症状是**界面说有损失、Agent 说没有** —— 用户按 Agent 的说法确认，文件里一片问号。
  - 现在规则在 `agent-core/src/winAnsi.ts`（`winAnsiSafe` + `collectWinAnsiLoss`），app 侧两处改为从 `@draw/agent-core` 导入；`engineeringExporters.ts` 保留同名导出的**别名**，这样 PDF 的几处调用点一个字都不用动。
  - **顺手改掉一个真实的小缺陷**：`collectWinAnsiLoss` 按**原文去重**。原实现逐图元收集，一份全中文的图纸会把同一个标签报很多次，把"有损失"变成噪音 —— 用户要的是"哪些字打不出来"的清单，不是"有多少个对象叫这个名字"。
- **过程中两次自纠**：① 改 `exportService.ts` 时我一次 `edit` 把函数体切掉了一半（留下孤立的 `return losses` / `}`），**下一次读文件立刻看出来并修好** —— 这类损坏如果只看测试红绿很可能被误判成别的原因；② 我的测试夹具把"有损失需接受"写成了 `supported: false`（那是"被阻止"），断言自然对不上，**是测试的错误而不是实现的**，已改正并在注释里写明两者的区别。
- **门禁（实测）**：单测 **165 文件 / 1851 用例全通过、零跳过**（+1 文件 / +11 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.4 仍未完成**：① `CommitterPort` 接到 G0.5 的 `DraftStore` + `HostBridge`（app 侧接线，把 `draftTools` / `sceneTools` / `interactionTools` 真正接上）；② worker 的 diff/check/artifact 信封（Step 4）；③ Step 5 的 Playwright"只产生草稿不提交"场景；④ Step 2 的"锁定模板拓扑"要等宿主接线后由真实的 `validatePatch` 路径覆盖。

### G2 第九批：草稿工具与场景工具（Task 2.4 上半，2026-09-19）

- **新增 `agent-core/src/tools/draftTools.ts` + 12 例**：把 G0.5 的草稿存储包成五个工具（`create` / `stageActions` / `validate` / `preview` / `discard`），存储以接口 **注入**（`DraftStorePort`）—— agent-core 不能依赖 `apps/web`，所以规则在包里单测，宿主接线属后半。两条纪律逐条有测试：
  - **这一层永远不说"文档改了"**：所有结果的 `payload` 与 `artifacts` 只带**草稿工件**（id + 版本 + 预览哈希）。有一条用例把六个路径的结果全部 `JSON.stringify` 后断言**不含 `"changed"`** —— 计划原文是 "No tool function returns a fake `changed: true`; every write-like result references a draft artifact until Host consent"。一个"看起来成功了"的 `changed: true` 会让协调器以为可以跳过用户确认。
  - **失败后草稿必须原样未动**：底层返回 `unchanged: false` 时额外报一条 `draft_mutated_on_failure` —— 否则模型会以为"部分生效"而继续往上叠动作。
  - **旧版本号不合并**：`stale_draft_version` 直接拒。合并等于把用户看过的预览悄悄换掉。
  - **空批次不到存储层**：`empty_batch` 警告 + 一条用例断言存储的 `stage` 根本没被调用。
  - 失败时**原样带出动作层的原因码**并给 `next_actions`（笼统的"失败了"会让模型重复同一笔动作）。
- **新增 `agent-core/src/tools/sceneTools.ts` + 8 例**：把 Task 2.2 的观察层包成带 `ToolResult` 信封的工具，并做三件观察层不该管的事：把 `ambiguous_label` 转成"去问用户"、把缺文档/缺实体转成 `next_actions`、带上 `documentId`（平台有两份文档，答案不说清来自哪一份就没法用）。
  - **重名标签绝不猜**（Step 2 点名）：给 `SceneObservation` 加了 `resolveLabel`，两个对象都叫「点 A」时返回**全部候选**并给 `ambiguous_label` 诊断，`next_actions` 明说"ask the user"。随手挑一个的后果是用户拿到他不想动的那个对象，还以为系统听懂了。
  - **`entity_not_found` 与 `document_not_in_context` 分开**：前者要换个名字，后者要检查作用域 —— 处置完全不同，不能合并成一句"找不到"。
  - 空标签不当成"匹配一切"（单独有用例）。
- **门禁（实测）**：单测 **164 文件 / 1840 用例全通过、零跳过**（+2 文件 / +20 用例）；`agent-core` 单包 **200 例**；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.4 仍未完成的部分（如实标注）**：① `tools/interactionTools.ts`（`interaction.ask_clarification` → `waiting_input`、`propose_view` 走 UI 策略、`propose_export` 走导出预检）未写；② `CommitterPort` 还没有接到 G0.5 的 `DraftStore` + `HostBridge`（`apps/web` 侧接线）；③ worker 的 diff/check/artifact 信封（Step 4）未做；④ Step 5 的 Playwright"只产生草稿不提交"场景未走；⑤ **Step 2 里"锁定模板拓扑"与"不支持的动作"两条**：不支持的动作已由 `draftTools` 的 `unsupported_action` 诊断路径覆盖，锁定拓扑则要等宿主接线后由真实的 `validatePatch` 路径覆盖。

### G2 第八批：把"环境"参数真正接上（工具注册表的工作区过滤，Task 2.4 前置，2026-09-19）

- **实测到的缺陷（本轮产出）**：`toolRegistry.ts` 的 `ToolEnvironment` 里有 `workspace` 与 `capabilityRevision` 两个字段，但**实现里一个都没用** —— `forPhase` 只按阶段与"是否已确认"过滤。用 grep 核对代码即可确认：这两个名字只出现在类型声明里。
  - **后果**：模型在**平面几何**工作区里也能看到空间建模与工程制图的工具；能力注册表修订号变了也不会有人发现工具目录是旧的。**声明了却没接上的边界比没有这个边界更危险** —— 它让人以为边界已经在了。
  - 这与前几轮是同一类根因（声明与实现脱节），但这次是**类型系统没拦住**的那种：字段存在、类型正确、只是没人读它。
- **修法**：给 `ToolDescriptor` 加**必需**的 `workspaces` 字段（空数组 = 任何工作区），`forPhase` 真正按它过滤；并新增 `describeEnvironmentMismatch()` 让修订号不一致成为**可见的诊断**而不是沉默。
  - **为什么把 `workspaces` 做成必需而不是可选**：可选字段会被忘填；必需字段让"新加一个工具时想过它属于哪些工作区"变成编译要求。这与 `actionIds.ts` 的双向守卫、`schemas.ts` 的 `satisfies Record<DraftActionId, ActionSpec>` 是同一个思路。
  - **新增两个真实受工作区约束的工具**（而不是为了消化字段而硬塞）：`scene.check_section`（截面只在有实体的工作区有意义）与 `cad.inspect_drawing`（制图布局读取只在 CAD 工作区；制图布局的改动**没有对应动作**，技能清单里也是这么写的）。
- **过程中的两次自纠（都值得记）**：
  1. 我先前的一次 `edit` 只替换了目录的一部分（前六行没带上新字段），**typecheck 立刻列出六处 `Property 'workspaces' is missing`** —— 类型守卫在这里真的抓到了"改到一半"。
  2. 修完语法后又发现一处**遗留的括号**导致 esbuild 报 `Unexpected "}"`，测试直接"no tests"（收集阶段失败，而不是断言失败）。**"no tests" 与"测试全过"看起来都像绿色**，所以这类失败必须按错误码确认，不能只看有没有红。
- **门禁（实测）**：单测 **162 文件 / 1820 用例全通过、零跳过**（+3 例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.4 仍未开始**（本批只是把它依赖的"环境过滤"补齐）：`tools/sceneTools.ts` / `draftTools.ts` / `interactionTools.ts` 三个处理器文件、把 `CommitterPort` 接到 G0.5 的 `DraftStore` + `HostBridge`、worker 的 diff/check/artifact 信封、以及 Step 1/2 点名的那些测试（有效动作只产生草稿、非法动作不改草稿版本、标签歧义、锁定拓扑、缺来源文档、不支持的动作）。

### G2 第七批：模型输出通道、有界恢复与网关通道选择（Task 2.3 纯 TypeScript 部分，2026-09-19）

- **新增 `agent-core/src/outputParser.ts` + 19 例**：计划要求 `parseModelEnvelope` "**permits one outer JSON fence removal, never arbitrary substring extraction or field repair**"。这句话本身就是安全边界，所以做成**两个可区分的通道**而不是一个"宽容"的入口：
  - `parseStrictJsonEnvelope`：整段文本必须就是 JSON，**不剥围栏**。
  - `parseFencedTextEnvelope`：允许**恰好一层** ```json 围栏，围栏之外不许有别的字。
  - 两者可区分是有意的：严格通道上"带围栏"会被拒、文本通道上通过 —— 否则"按通道降级"没有意义。
  - **绝不抠取**：`好的，我来画一个立方体：{…}需要我继续吗？` 一律拒绝。理由写进了代码注释：抠取等于让模型用自然语言绕过校验规则，而被抠出来的片段一旦进入执行链，用户看到的是他没有确认过的东西。
  - **绝不修补**：数字以字符串形式到达（`"4"`）、多一个字段，都直接拒。字段路径错误如实带出（`envelope.actions[0]…`），供修复提示使用。
  - **修复提示按通道给格式建议**：第一版没有通道信息，只能给一句通用建议 —— 而**下一次尝试的格式要求正取决于通道**，给错建议等于把第二次机会也浪费掉。为此给失败结果加了 `channel` 字段。
  - 修复提示**不回显模型自己的散文**（避免自我强化循环，也避免污染提示词）。
- **新增 `agent-core/src/recovery.ts` + 19 例**：把"要不要再试一次"做成一条**策略表**而不是散落的 `if`。这是花钱的决定（每次尝试都吃网络与生成预算、用户要等），散着写迟早出现"认证失败也重试三次"或"几何失败被当成网络抖动"。
  - **绝不自动重试的四类**（计划逐字点名）：`auth` / `permission` / `geometry` / `contradictory_fact`，外加"未归类的错误默认不重试"与"用户取消"。传输层报的 **401 会被归类成 auth**，不会被当成网络抖动重试三次。
  - **只有 429 / 5xx / 连接中断可重试**（`400` 明确不可重试）；上限与**共享预算**都不够时停下（`attempts_exhausted` / `budget_exhausted`）。
  - **schema 修复是一次性的**：用过之后即使还能重试也停下，理由写清楚（"第二次修复只是把同一句话再问一遍"）。
  - **流损坏走 `refresh_context` 而不是原样重发**：模型与工具状态可能已经不同步；同样的损坏再来一次就停。
  - 每条决定都带 `reason` / `detail` / `budgetCost` / `safeRetry`，且**停下时不收费**（有用例逐类核对）。
- **新增 `agent-core/src/modelGateway.ts` + 12 例**：计划要求 "**Do not send a tool schema to providers that failed capability verification**" 与 "return `CAPABILITY_UNAVAILABLE` when no safe channel remains"。
  - 通道选择只看**已验证**的证据：`declared` **不算**。理由是一个真实的失败模式 —— 会静默忽略工具的服务上，模型会在散文里"描述"它想调用什么，而画布什么都不会变，用户看到一段解释却没有任何结果。
  - 三种通道的能力要求各不相同：`native_tools` 要 `tools === "verified"`（**唯一**敢发工具 schema 的情形）、`strict_json` 要 `json === "verified"`、`fenced_text` 无需额外能力（解析器自己会剥围栏并校验）。
  - 视觉**单独判**（`canSendImages`）：计划明确要求 "a successful text ping must not mark vision verified"，所以文本通道可用与能不能带图是两件事；未验证视觉却请求带图时整次请求被拒并说明缺哪一项证据。
- **门禁（实测）**：单测 **162 文件 / 1817 用例全通过、零跳过**（+3 文件 / +50 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.3 仍差的部分（如实标注）**：① `ModelGateway.generate(...): AsyncIterable<ModelEvent>` 的**真正调用**没写 —— 它必须经过 G1 的回环代理与 provider 适配器，而那部分被 Rust 工具链缺失挡着；我做的是**发请求之前的通道与能力计划**（`planModelRequest`），这部分是纯函数、可测、且能挡住"不该发的 schema 发出去了"；② `apps/web/src/services/modelClient.ts` 未修改（同一个原因）；③ 协议 fixture 集成测试属 G1。

### G2 第六批：工具注册表与上下文组装（Task 2.2 收尾，2026-09-19）

- **新增 `agent-core/src/toolRegistry.ts` + 12 例**：计划原文 `ToolRegistry.forPhase(phase, environment)` **publishes 6–10 phase-specific tools**。这里的关键认识是：**工具的可见性就是模型的能力边界**，所以按阶段发布是安全机制而不是省 token 的技巧。
  - 观察与规划阶段**一个写入工具都没有**；观察类七个（`scene.inspect` / `search_entities` / `describe_entities` / `dependencies` / `measure` / `check_relations` / `capabilities`）在所有工作阶段都在（模型随时可能要看一眼场景）。
  - **提交工具只在 `awaiting_confirmation` 且 `environment.confirmed` 为真时发布**。没有用户确认时它**根本不在列表里** —— 不是"调用了会被拒"，而是模型看不到。计划 Task 0.8 那句 "do not expose `commit` as a model-facing tool" 在这里落成了"提交需要一次性确认才发布"。
  - `actionsWithoutAChannel()` 检查**清单声明了动作、却没有任何控制工具能承载**的情况：清单说"允许这七个动作"，而模型产生动作只能通过 `plan.set_plan` / `draft.stage_actions`。没有通道的清单就是空头支票。
- **写测试时逼出的一处分类错误（本轮的诚实记录）**：我第一版把工具副作用分成三类，把 `plan.set_plan`（**只是提议计划、产生隔离草稿**）与 `draft.confirm_commit`（**唯一写文档**）一起归为"写入类"，于是"规划阶段不许有写入工具"这条纪律把**提议计划本身**也挡掉了，两条用例失败。修法不是放宽纪律，而是**把分类做细**：`none` / `propose_plan` / `stage_actions` / `commit` 四类，`isWritingTool` 精确地只指 `commit`。**纪律没错，是我把两件事混成了一类。**
- **新增 `agent-core/src/contextBuilder.ts` + 12 例**：`buildContext` 的输出会**原样进模型提示词**，所以它定义的是"模型能看到什么"。
  - **"绝不包含"靠结构而不是靠过滤**：函数的入参里根本没有凭据、provider 配置、工具实现或模型自述文本，所以它们不可能漏进输出。有一条用例把 `BuildContextInput` 的**键**钉住 —— 以后谁往里加 `apiKey` / `tools` / `reasoning`，它就会失败。另有一条断言序言里不含"不要告诉用户""内部规则"这类隐藏指令。
  - **事实只有一个来源**：上下文里的事实就是观察结果里的事实（`observation.facts`），没有第二个入口。这是"缺事实不许猜"在结构上的落点。
  - **过期引用不进列表、进警告**：参考文献在采集之后被改过时，塞进上下文会让模型基于旧位置判断；静默丢掉又会让模型以为用户没选中任何东西。所以两者都不做 —— 有用例断言过期的那个**不占分页名额**（有效引用仍占满一页）。
  - **有界且不可放宽**：条数上限只能**收紧**不能放宽（`limits.facts: 10_000` 会被夹到 `MAX_FACT_LIMIT`）—— 上下文预算不是调用方能单方面加大的东西；截断一律留下 `truncated_*` 警告。
  - **未注册技能如实报 `skill_unknown_skill` 警告**而不是静默丢弃（"为什么模型没看到我刚选的技能"必须可查）。
- **测试自己的坑（同一轮内抓到的第二个）**：`contextBuilder.test.ts` 第一版的 `ref()` 辅助函数把"采集时的哈希"与"句柄里的哈希"写成同一个入参，于是引用**永远不可能过期**，那条"过期引用"用例测的是空气（它却通过了 —— 因为断言只检查了列表内容）。改成两个独立入参后才真正测到。**这与前两轮是同一个教训：测试替身如果比生产代码"更宽松"，它就失去了判别力。**
- **门禁（实测）**：单测 **159 文件 / 1767 用例全通过、零跳过**（+2 文件 / +24 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.2 至此完成**：Step 1 的七类用例（document scoping / duplicate labels / hidden tessellation omission / stale 引用 / pagination / context budget / unregistered skill）都有落点，Step 2–4 全部实现。**如实标注**：`toolRegistry` 只发布**描述符**，真正的执行（把工具接到编译器与宿主）属 Task 2.4；`buildContext` 的调用方（协调器接线）也还没接 —— 协调器目前不构造上下文。

### G2 第五批：九个技能清单与哈希校验目录（Task 2.2 Step 2，2026-09-19）

- **新增 `agent-core/src/skills/manifest.ts` + `skills/catalog.ts` + 11 例**：计划要求的九个清单（平面基础、圆锥曲线/切线、函数、动态绑定、空间建模、截面/相交、工程制图、图像证据、安全恢复），每个都写齐了 **actionIds / limits / 一个成功案例 / 一个拒绝案例**。清单是**纯声明式**的：只有 id / 标题 / 描述 / 动作名 / 数字上限，**没有函数、没有可执行片段** —— "清单能影响模型用哪些动作，但不能携带行为"这条是布局上的事实，不是承诺。
- **`SkillCatalog.load` 的四道校验**（计划原文 "only loads packaged, hash-verified declarative content"）：
  1. **哈希校验**：每个清单的规范哈希签入目录，`load` 重新算一遍比对。有一条用例专门构造"打包后被改过"的清单（往 `planar-basics` 里偷偷加一个动作），断言 `hash_mismatch`，并断言诊断里**给出实际算出的哈希** —— 否则没法判断是"被改过"还是"忘了同步"。
  2. **动作名必须仍然存在**：逐条核对 `DRAFT_ACTION_IDS`。动作层改名后旧清单**加载失败**，而不是把不存在的名字交给模型。
  3. **修订号必须匹配**：清单是照着某一版能力注册表写的；注册表变了还拿旧清单，会出现"清单允许的动作已经不可用"。
  4. **未注册的 skill id 一律拒**（`unknown_skill`）。
  - 哈希只覆盖**语义**内容（动作名与上限），不含标题措辞：改文案不该让清单失效。
- **新增 `CAPABILITY_FOR_ACTION` 显式对应表**：能力注册表是按 `DomainOperation`（内核操作）编号的，动作层是更上层的 `family.verb`，**两套名字体系不同** —— 所以"清单里这个动作到底可不可用"必须靠这张表来问。它是 `Record<DraftActionIdName, string>`，动作层新增动作而这里没登记就编译失败；每个动作背后的能力是否 `available` 由用例对着注册表逐个核对（清单若广告一个被标为不可用的能力，"模型会一直试一个注定失败的动作"）。
- **顺带修掉上一批我自己写下的一个真实缺陷（本轮第二个产出）**：`sceneObservation.ts` 里的内容指纹是我**自己拼**的（workspace / primitives / groups / parameters），而句柄里的 `contentHash` 来自 `@draw/scene-graph` 的 `contentFingerprint`（SHA-256 规范化 JSON）。两者**永远不会相等**，于是过期检测要么恒真要么恒假，而它看起来"在正常工作"。更糟的是**上一批的测试也复制了同一个错指纹**，所以测试是绿的 —— 一个自洽的错误。现在两边都用 `contentFingerprint`，判断依据只有一处。
  - 这条与前面几次是同一类根因（同一个判断写两遍），但这次更隐蔽：**错误的复现让测试失去了判别力**。教训是"测试里也要用生产代码的判据，不要手写一份等价物"。
- **门禁（实测）**：单测 **157 文件 / 1743 用例全通过、零跳过**（+2 文件 / +11 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.2 剩余**：`toolRegistry.forPhase(phase, environment)`（6–10 个按阶段发布的工具）+ `contextBuilder.buildContext`（只带有作用域的手柄 / 已确认事实 / 有序选中引用 / 警告，**绝不含凭据、隐藏工具指令或思维链**）。

### G2 第四批：修掉传输层与动作层的登记表错位（Task 2.2 前置，2026-09-19）

- **实测到的严重缺陷（本轮最重要的产出）**：`agent-core/src/schemas.ts` 的 `ACTIONS` 登记表只认 **4** 个 actionId，而动作层（`packages/scene-graph/src/actions/types.ts`）实现了 **20** 个。用探针逐条喂进去实测：
  - `PROBE-ACCEPTED []`（我的探针载荷不完整，所以没有一条真的通过，但错误码说明了问题）
  - `PROBE-REJECTED` 里绝大多数是 **`unknown_action`**：`dynamic.bind_curve` / `dynamic.bind_point` / `dynamic.create_locus` / `dynamic.set_radius_rule` / `function.analyze` / `function.create_tangent` / `section.materialize` / `parameter.set` / `parameter.set_expression` / `object.delete_many` / `object.update_inputs` / `planar.create_point` 全部被拒。
  - **后果是静默的**：模型照计划给出一个**合法**动作 → `parseDraftAction` 报 `unknown_action` → 报错像是"模型编了个不存在的动作"，实际是登记表过期。**十几个已实现的动作根本无法从模型输出到达编译器**，而这正是 G2 的全部意义所在。
- **还有两个更糟的登记项**：`object.delete` 与 `object.update` **动作层根本不存在**（真名是 `object.delete_many` / `object.update_inputs`）—— 等于在教模型使用错名字。
- **三处载荷形状也错了**（修正登记表时才暴露）：
  - `section.create` 登记为 `inputs.source = { scope: "draft", alias }`（作用域引用），而 `SectionCreateAction` 收的是**同文档内的裸 `sourceId`**（动作层用 `findPrimitive` 查）。
  - `solid.create_template` 白名单里有 `segments`，而 `SolidCreateTemplateAction` **没有**这个字段（动作层会忽略它，于是"schema 接受但编译器看不见"）。
  - `dynamic.bind_curve` / `dynamic.set_radius_rule` / `section.materialize` 等混用"裸 id"与"作用域引用"两种引用语义，登记表里没有任何区分。
- **修法（两道守卫 + 一张按真实形状重写的表）**：
  1. **编译期双向守卫**：动作层导出 `DraftActionId = DraftAction["actionId"]`；`agent-core/src/actionIds.ts` 里是一份 `DRAFT_ACTION_IDS` 规范清单，`as const satisfies readonly DraftActionId[]` 挡住"清单里写了动作层没有的名字"，`Record<DraftActionId, true>` 挡住"动作层有而清单没写"。**少一个、多一个都编译失败。**
  2. **运行期再核对一次**（`actionIds.test.ts` 5 例）：编译期守卫在有人跳过 `tsc` 时不会生效，而 schema 是安全边界，值得多一道。用例断言"20 个名字全部被认出（错误码不是 `unknown_action`）"、"未实现的名字仍被拒"、"那两个幽灵登记项（`object.delete` / `object.update`）必须被拒"。
  3. **登记表按动作层的真实形状重写**：20 项逐一对照 `actions/types.ts` 的 `inputs` 写白名单，并新增 `requireReference: { field, kind: "scoped" | "id" }` 明确区分两种引用语义（作用域引用走 `readScopedReference`，裸 id 原样透传）。
- **一处刻意的分工（写进注释）**：传输层**只做"认名字 + 拒绝畸形载荷"**，载荷的**语义**校验（半径为正、坐标有限、工作区是否允许该动作）**留给动作编译器**——那套校验已经完整存在且只有一份，传输层再抄一遍必然分叉，症状是"schema 放行、编译器拒绝"这种莫名其妙的失败。这不是"不校验"：字段白名单仍在传输层执行。
- **登记表修正当场暴露了 4 条**夹具**是错的**（都在 `schemas.test.ts`）：它们用 `section.create` 配 `source: { scope: "draft", … }`、用不存在的 `object.delete` 测"未作用域引用"。改正后 92 例全绿 —— **失败的测试是这次修正的副产品，也是它正确的证据**。
- **门禁（实测）**：单测 **156 文件 / 1732 用例全通过、零跳过**（+1 文件 / +5 用例，另有 4 条夹具被改正）；`agent-core` 单包 **92 例**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **对 Task 2.2 的影响**：技能清单（Step 2）必须写**真实存在**的 actionId，否则就会出现"清单声明了、schema 不认、编译器也没有"的三方漂移。这张登记表现在与动作层双向钉住，技能清单可以直接对着它写。

### G2 第三批：场景观察工具与判据去重（Task 2.2 Step 3 上半，2026-09-19）

- **新增 `packages/agent-core/src/sceneObservation.ts` + 14 例**：模型看场景的**唯一**窗口（`inspect` / `search` / `describe` / `dependencies`）。计划 Step 1 点名要测的五件事逐条落在这里：
  - **按文档解析**（document scoping）：实体引用必须带 `documentId`；两份文档有同名 `point3-1` 时，**同一个 id 在各自文档里解析成各自的标签**。合并列表会让模型对着一份文档说另一份的事 —— 这正是 `SourceContext` 存在的理由。
  - **重名标签如实报告**（duplicate labels）：两个对象都叫「点 A」时返回 `duplicate_label` 诊断，**并列出具体是哪几个 id**（只说"有重名"没法消歧）。状态同时降为 `warning`。
  - **不暴露内部近似细节**（hidden tessellation omission）：`tessellation: true` 的细分顶点与母线**既不列出、也拒绝 describe**（"查得到也不返回"）。
  - **过期快照拒绝**（stale summary rejection）：句柄与内容不符时报 `stale_source`，**不静默按当前内容回答**。
  - **分页**（pagination）：`limit` 被夹到 `MAX_ENVELOPE_LIMIT = 40`，默认 12；**截断必须说出来**（`truncated` 诊断），否则模型会以为"场景里就这些对象"。另有一条：**空查询不返回整份文档**（那等于绕过上限），而是返回空 + `empty_query` 诊断。
  - 另有两条卫生规则：隐藏 / 锁定**照实标注**而不是丢弃（模型得知道"这个点看不见""这个对象改不了"）；派生对象标 `derived: true`（模型不能建议"拖动这个交点"）。
- **依赖解析刻意只认结构字段**（`sourceId`/`sourceIds`/`pointIds`/`vertexIds`/`lineA`/`startPointId`… 一份白名单），**不是**"扫一遍所有字符串看像不像 id"。有一条用例专门钉住这点：一个标签叫 `point-1`、表达式也是 `point-1` 的函数，其依赖必须是**空**——字面量不是引用。
- **顺手消掉一处真实的重复判据（本轮第二个产出）**：上一批我把派生素型清单放进了 `apps/web/src/derivedPrimitives.ts`，这一批场景观察（agent-core）也需要同一份。**两边各留一份一定会分叉**，而这个项目已经因为"同一个判断写两遍"吃过两次亏（来源解析的 `sourceLabel` / `cadInspectorSources` 漂移、导出用 `document` 而显示用来源文档）。依赖方向是 `@draw/web → @draw/agent-core`，所以把模块**移到 `agent-core`**、删掉 app 侧那份、三处引用改为从 `@draw/agent-core` 导入。同时把 `isTessellationPrimitive` 一并收进来（"画不画"与"给不给模型看"必须是同一判据）。
  - **这是本轮最该记的一步**：我先写了 `sceneObservation.ts` 并 import 了 `./derivedPrimitives`，直到 typecheck 才想起那份文件根本不在 agent-core 里。**如果当时图快在 agent-core 复制一份，这个数字清单就会有两个真相来源**，而它的分叉症状是"画布上能拖、预览说改不了"这类互相矛盾的行为。移动只花了三处 import。
- **门禁（实测）**：单测 **155 文件 / 1727 用例全通过、零跳过**（+1 文件 / +14 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线）。
- **Task 2.2 剩余**：九个技能清单（`skills/*.json` + `catalog.ts`，含"只加载签名入包、哈希校验过的声明式内容"）、`toolRegistry.forPhase(phase, environment)`（6–10 个按阶段发布的工具）、`contextBuilder.buildContext`（只带有作用域的手柄 / 已确认事实 / 有序选中引用 / 警告，绝不含凭据、隐藏工具指令或思维链）、以及 Step 1 里针对技能与上下文的那几条用例。

### G2 第二批：协调器与四组端口（Task 2.1 下半，2026-09-19）

- **新增 `packages/agent-core/src/coordinatorPorts.ts`**：把协调器要做的四件事拆成**注入的接口** —— `PlannerPort`（问模型）、`ObserverPort`（读场景）、`CommitterPort`（`stage` 只产生隔离草稿 / `commit` 是**唯一**能写文档的调用）、`ToolPort`（只读工具）。三个直接好处，本轮全都用到了：
  1. **没有网络**：`agent-core` 至今没有任何 `fetch` / provider 代码（G0 Gate 第 5 条守的性质），协调器也不例外 —— 它只认这些接口。
  2. **可测**：九个场景全用脚本化假端口驱动，不需要模型、网络或 worker。
  3. **取消可传播**：一个 `AbortSignal` 从协调器发给每个端口，端口负责真的中断自己的 IO。
  - `ConsentToken` 做成**不透明载荷**（`{ kind: "user_consent"; nonce; previewHash }`）是刻意的：协调器既不能伪造它，也不能从模型输出里读出一个来 —— 这是计划 Task 0.8 Step 3 那句 "do not expose `commit` as a model-facing tool" 在类型层的落点。缺凭据时协调器**只能停在 `awaiting_confirmation`**，有用例守着。
- **新增 `packages/agent-core/src/coordinator.ts` + 19 例**：`start` / `cancel` / `ledger` / `phase`。计划 Step 1 点名的九个场景**一个不少**（成功只读、成功草稿、缺事实、输出非法、草稿过期、提交前取消、提交中取消、provider 失败、应用中断），另加预算与事件标识两组。
  - **模型输出永远不可信**：`planner` 回来的东西必须过 `parsePlanEnvelope`。首次不合法 → **一次可见的修复尝试**（计划 Task 2.3），仍不合法 → `failed`。有效用例既有"两次都不合法则失败（恰好调用两次）"，也有"第二次修好了则继续"。
  - **缺事实不许猜**：计划信封引用的 `factId` 必须在观察结果里，缺了走 `waiting`（**不是失败**）——问用户比编一个数字好。用例断言 `stage` 一次都没被调用。
  - **绝不假装成功**：提交被拒（`stale_source` / `rejected`）时落到 `failed`，事件序列里**不出现 `completed`**。这条直接对应计划 G2 Gate 那句 "model claims success without receipt"。
  - **取消后不再发事件**：取消置位后各步骤处 `return`，账本由 `transition` 收尾；`record()` 在终态丢弃迟到结果。取消区分 `cancelled` 与 `interrupted`（中断不是用户的选择，恢复时应当可以查询幂等键）。
  - **预算是闸不是装饰**：每步之前 `consume`，被拒即 `failed` 且**不改文档**；修复请求花的是同一份预算的另一个名额（有用例把 `generation` 限成 1，断言"修复请求因预算被拒、模型只被调用一次"）。
- **本轮最有价值的产出：转移表当场否掉了我自己写的捷径。** 我第一版在 `validating` 之后直接 `transition("committing")`（有同意就跳过确认状态），八条用例一起失败在 `illegal_transition` 上。**那条捷径是错的**：确认状态不是"等用户点按钮"的 UI 细节，而是**账本必须留下的记录** —— 跳过它，事后就无法区分"用户确认过"与"调用方直接调了提交"。改法是**永远先停在 `awaiting_confirmation`**，再由 `confirmed` + 凭据决定是否继续；并加了一条断言：`awaiting_confirmation` **始终**出现在 `committing` 之前。这个错误是上一轮那张显式转移表抓出来的 —— 如果当时写成散落的 `if`，它会一直潜伏到真实运行里。
- **过程中被工具抓到的另外两处（都是我的错）**：① 我的计划夹具用了 `planar.create_point`，而 `schemas.ts` 的 `ACTIONS` 只登记了**四个**动作（`solid.create_template` / `section.create` / `object.delete` / `object.update`），于是被 `unknown_action` 拒绝 —— 我第一反应是怀疑解析器，探针打印出真实错误码后才改了夹具；② `requestId` / `attemptId` 要等第一次往返之后才知道，而 `planning` 事件在往返之前就发出来了，所以把它们挂到"计划已到手"那条事件上（标识会累积到后续事件），这才让"哪个请求、哪次尝试产生了这份计划"始终可查。
- **门禁（实测）**：单测 **154 文件 / 1713 用例全通过、零跳过**（+1 文件 / +19 用例）；`agent-core` 单包 **73 例**；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线，中途第 15 条是两个当时没用上的类型导入，已删）。
- **Task 2.1 至此完成**（`coordinator.ts` / `runState.ts` / `budget.ts` 三块都在，六个 Step 全有落点）。**如实标注**：① `ToolPort` 已定义但协调器**还没调用它**（观察走 `ObserverPort`，只读工具注册属 Task 2.2）；② `CommitterPort` 的真实实现尚未接到 G0.5 的 `HostBridge`（属 Task 2.4）；③ `agent.worker.ts` 还没接上协调器。

### G1 环境阻塞（2026-09-19 实测）：缺 Rust 工具链，转做 G2 纯 TypeScript 部分

- **实测读数**：`rustc --version` / `cargo --version` / `rustup` **全部"不是可识别的命令"**；`C:\Users\73246\.cargo\bin\cargo.exe` **不存在**、`C:\Program Files` 下无 Rust 目录、`PATH` 中没有 cargo/rust 项。对照可用项：`node v24.15.0`、`npm 11.12.1`、**WebView2 153.0.4234.32 已安装**、`winget` 可用。
- **后果**：G1 的六个任务（Tauri 2 外壳、SecretStore、provider 适配器、Rust 回环代理、SQLite 仓储、打包）**全部无法执行**。连计划纪律里"先跑失败测试"这一步都做不到 —— `cargo test` 根本起不来。这不是"跳过"，而是**缺前置条件**：计划 Execution Rules 第 4 条明确要求"at a gate, record command output and stop if a required condition fails"。
- **我没有自动安装 Rust**：`winget install Rustlang.Rustup` 可以跑，但那是往用户机器上装整套工具链（数百 MB，通常还要 MSVC 生成工具），并能改 `PATH`。这类会改变用户环境的操作应当由用户决定，不该由一个"继续"指令顺带执行。
  - **解除方式（任选其一）**：`winget install Rustlang.Rustup`，或从 rustup.rs 装官方安装器；装完确认 `cargo --version` 可执行即可。
- **在等待期间的计划内推进方式（已照此执行）**：G2 的 Task 2.1–2.3、2.6 是**纯 TypeScript**，只依赖 G0/G0.5 已完成的底座（能力注册表、传输契约、动作编译、草稿、HostBridge、worker 边界），**不需要 Rust**；Task 2.4/2.5 的 worker 接线与界面同样不需要。只有"真实 provider 调用"必须等 G1 的回环代理 —— 那部分会如实标注为未实现，而不是用前端直连假装做完。
- **一句话**：G1 缺失的是**环境**，不是设计；G2 是"agent 构建"的主体，现在就能做，而且做完之后 G1 一到位就能直接接上（provider 适配器与代理是替换传输层，不动协调器）。
- **关于提交**：计划 Global Constraints 第 5 条规定"执行期间不自动 commit/push"，所以 G0 / G0.5 / G2 的全部改动此前一直留在工作区。**2026-09-19 用户明确要求"更新文档并提交到远程仓库"，本批（第二十一批）之后按该授权提交并推送。**

### G2 第一批：运行账本状态机与运行预算（Task 2.1 上半，2026-09-19）

- **新增 `packages/agent-core/src/runState.ts` + 17 例**：把计划那张路径表落成**显式转移表**（`TRANSITIONS`），`transition` 与 UI 的"下一步能做什么"读同一份。
  - **非法转移返回"允许的下一步"而不是抛异常**：`{ ok:false, reason, from, allowed }`。出错时能直接告诉调用方"你现在只能走这些"，而不是让它在别处炸。
  - **终态之后一律拒绝**（`run_finished`，`allowed: []`），并且 `record()` 也**丢弃**迟到事件 —— 计划 Step 5 要求"discard late events"，否则一份已结束的账本会被迟到的模型分片或 worker 结果改写。
  - **事件只在活跃状态累积**；每条事件带全计划 Step 4 点名的七个标识（`runId` / `promptMessageId` / `requestId` / `attemptId` / `toolCallId` / `draftVersion` / `handle`），**全部必填**（`string | null` 而不是可选）—— 可选字段在实现里一定会被忘填，而"这条事件属于哪次尝试"是排障时唯一能用的线索。标识随事件累积：新值覆盖旧值、没给的沿用上一次，避免每个调用点重填一遍。
  - **`waiting` 是显式状态**：等用户补充信息（澄清）与等用户确认草稿（`awaiting_confirmation`）是两件事，混起来会让"用户还没回答"与"用户还没确认"分不开。用户回答后回到 `observing`（**重新观察**，不能拿旧观察继续规划）。
  - **`awaiting_confirmation → compiling`**（而不是回到 `planning`）：用户在预览里改要求时，规划产物（计划信封）没变，变的是要编译的动作。
- **写测试时发现的一个建模缺口（本轮真正的收获）**：我最初把只读问答写成 `planning → completed`，两条用例当场失败。**这个捷径是错的**：它会让"这次运行到底有没有产生过草稿"无从判断 —— 两种性质完全不同的运行会留下**同一条事件序列**，事后无法区分"回答完了"与"提交完了"。因此新增显式状态 **`answering`**，路径变成 `planning → answering → completed`，并加了一条断言"只读路径的事件序列里不出现 `compiling` / `committing`"。**是失败的测试逼出来的设计，不是我一开始想到的。**
- **新增 `packages/agent-core/src/budget.ts` + 10 例**：`createBudget` / `consume` / `beginStage` / `remaining` / `snapshot` / `exhausted`，默认值逐字取计划 Step 2 给的数字（生成 4、网络 6、工具 24、每暂存 32、每运行 128，另加上下文 / 时间 / 几何三项）。
  - **先判后扣**：被拒的那次**一个单位都不扣**。若先扣再判，被拒的尝试会白吃余量，"还能重试几次"从此对不上，协调器会以为还有额度而继续跑 —— 有一条用例专门断言"被拒后剩余量仍是 1"。
  - **重试/降级/修复共用同一份预算**：三者都走 `network` / `generation`，不存在各自的计数器。给它们各开一个计数器，等于把"总共 6 次网络"变成"每类各 6 次"，正是计划要防的失控方式；有用例按"首次 → 重试 → 修复 → 降级 → 超限"的顺序逐次核对。
  - **小数/负数/`NaN` 额度一律拒**（`invalid_amount`）：否则余量会变成非整数，之后所有"还能跑几步"的判断全部失真。
  - **`beginStage()` 只重置 `actions_per_stage`，不重置 `actions_per_run`**；`exhausted()` 刻意**不把** `actions_per_stage` 算进去 —— 否则第一次暂存用满 32 个就会误报"整次运行已耗尽"。另有一条用例走完 4×32=128 的完整额度，确认第 129 个动作进不来。
  - **预算层没有文档入参、也不返回文档**，所以它**不可能**改写文档。计划那句"stop the run without head mutation"的落点不在预算内部，而在协调器：拒绝之后什么都不做。这一点在注释里写明了，避免后来者误以为"预算是安全边界"。
- **门禁（实测）**：单测 **153 文件 / 1694 用例全通过、零跳过**（+2 文件 / +27 用例）；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 基线，中途出现的第 15 条是我给 `createBudget` 加的一个当时没用的 `runId` 参数，已删掉而不是留着当"以后可能用得上"）。
- **Task 2.1 剩余**：`coordinator.ts`（`AgentCoordinator.start` / `cancel`、事件发射、取消传播到模型流 / worker / 工具调用）与它点名的那组场景测试（成功只读、成功草稿、缺事实、输出非法、草稿过期、提交前取消、提交中取消、provider 失败、应用中断）。账本与预算这两块地基已就位并有测试。

### G1 环境阻塞之前：G0.5 第十批：Worker 消息边界与真实 worker 文件（Task 0.8 收尾，2026-09-19）

- **新增 `apps/web/src/agent/workerContracts.ts`（12 例）**：把计划那句 "Worker messages **always** carry `runId`, `draftId`, `draftVersion`, `requestId`, and `schemaVersion`" 落成运行时校验。理由不是形式主义：没有 `runId`，应用被中断后回来的旧结果就无法识别；没有 `draftVersion` 与 `requestId`，就无法判断这条结果对应的是不是用户眼下看着的那份草稿 —— 迟到结果会覆盖新预览。
  - 未做版本号**精确匹配**（`mathcanvas.worker.v1`），不匹配即拒；`draftVersion` 必须是**非负整数**（小数或 `NaN` 会让"对应哪一版"失去意义，表现为"预览偶尔串版"这种极难复现的故障，已有用例逐个钉住 `1.5 / NaN / -1 / "2"`）。
  - `base` 文档是**必填**：编译与执行必须落在同一份基准上，否则 id 分配与校验都会漂。
  - 单请求 actions 上限 32（与动作层单步上限一致）、check 的 operations 上限 128：一次塞 1000 笔会让 worker 长时间不可取消。
- **"unknown message kinds are dropped and diagnosed" 是逐字实现的**：未知 `kind` **不抛异常**，而是返回 `{ ok: false, dropped: true, diagnostic }`。抛异常会让一条不认识的广播把整条管道打死；静默丢弃则会让"为什么没反应"无从查起。诊断里带上被拒的 kind 本身，这样"发错了通道"一眼可见。
  - 与 `packages/agent-core/src/schemas.ts` 的策略**刻意不同**：那边守的是**模型输出**（字段白名单、未知字段即拒），这边守的是**自家两条线程之间**的消息（结构性字段 + 版本），所以未知 kind 是 drop 而不是 reject，也不禁止附加字段。
- **新增 `workerRuntime.ts`（5 例）+ 真实 worker 文件 `geometry.worker.ts` / `agent.worker.ts`**：
  - `handleGeometryRequest` 是**纯函数**，worker 文件只做接线。这不是洁癖：在 `self.onmessage` 里写业务逻辑，那段判断在 jsdom 里根本跑不起来，于是**永远没有测试**。现在 `geometry.worker.ts` 里只剩"解析 → 交出去 → 发回"。
  - **失败一律收敛成 `geometry.error` 响应，绝不抛异常跨边界**：异常穿过 `postMessage` 会变成 `ErrorEvent`，调用方拿不到原因码，用户只看到"没反应"。有一条用例专门构造"会让内核抛"的文档（`revision: NaN`）来钉住这点。
  - **解析失败也必须回一条响应**，否则主线程在等一个永远不来的答复，界面表现为卡在"处理中"。且响应一律用**我们自己的** `schemaVersion` —— 若把对方的版本号原样回过去，主线程的 `parseWorkerResponse` 会先把响应本身判为版本不符，真正的原因（"对方发的是别的版本"）就被掩盖了。
  - `agent.worker.ts` 现在对任何消息都回 `agent.unavailable` + `coordinator_not_implemented`。**这是刻意不写假协调器**：边界形状已有测试，而真正的状态机属于 G2；先塞一个"看起来能跑"的循环，替换它时还得先拆掉一套假的运行语义。
- **过程中被类型检查抓到两次（都是我的错）**：① 我按记忆写了 `validatePatch(...).errors`，实际它是判别联合 `{valid:true} | {valid:false; errors}`；② 我把 `solid.create_template` 的入参写成 `templateId`，实际字段是 `template` + `origin`。两处都由 `tsc` 当场拦下，改正后通过 —— 这正是"不要凭记忆写接口"的例子。
- **门禁（实测）**：单测 **151 文件 / 1667 用例全通过、零跳过**（+2 文件 / +17 用例）；e2e **116/116**；`npm.cmd run build` 生产构建通过（365 modules，无 TypeScript 错误）；lint **0 error / 14 warning**（= 基线）；全 workspace typecheck **exit 0**。
- **一处如实记录的既有抖动（不是本批引入）**：有一次全量单测报 `Test Files 150 passed (151)` 并附 `unhandled error`，随后的**连续四次**全量运行都是 **151/151、1667 用例**。抖动源是既有的 jsdom WebGL 噪声（`App.test.tsx` 渲染 3D 视图时 jsdom 没有 `getContext`，`THREE.WebGLRenderer` 打出 `Not implemented` 与 `Error creating WebGL context`）。**没有新证据表明它与 worker 改动有关**（worker 文件不被任何测试导入、也未被 `new Worker` 引用），我按"如实记录、不猜着改"处理，未改测试环境。
- **Task 0.8 至此基本收尾**。仍差：Step 5 的**浏览器**路径（取消 / 切换工作区 / 确认预览）—— 因为 `DraftPreview` 还没有挂进 `AgentWorkspace`（属 Task 2.5），以及 worker 目前**没有任何调用方**（真正的调用来自 Task 2.4 "Connect typed tools to draft compilation"）。

### G0.5 第九批：草稿预览面板与对象计数（Task 0.8 Step 4，2026-09-19）

- **新增 `apps/web/src/components/agent/DraftPreview.tsx` + 7 条用例**：计划 Step 4 要求"Show user/derived/internal counts, assumptions, evidence, approximation, omitted exports, and the exact one-undo statement"。面板按这个清单逐条渲染，并且把三条纪律写进**类型**而不是靠注释提醒：
  1. **它不持有文档** —— props 里没有 `document`，也没有任何 store 写入口（有一条用例专门断言签名里没有 `document` / `replace` 这两个键）。预览绝不落盘。
  2. **它不判断能不能提交** —— `onConfirm` 只是个回调，授权与校验都在 `HostBridge`。在渲染层加"看起来没问题就放行"的判断，等于把安全边界搬进 UI。
  3. **它不算数** —— 计数由 `countDraftObjects` 给出，面板只负责显示。
- **新增 `apps/web/src/agent/draftCounts.ts`（`countDraftObjects`）+ 5 条用例**：把"用户 / 隐藏 / 派生 / 内部"四类分开计数。
  - **`hidden` 单独一列而不是并进 `user`**：预览要说清"确认之后你能看见几个"。一个"用户建了但被隐藏"的对象若算进可见数，用户会以为确认后画布上会多出东西。
  - **派生且隐藏的对象算 `derived` 而不是 `hidden`**：分类问的是"它是什么"，隐藏只是开关；两者混在一起会让"我有多少个改不了的对象"失真。这条单独有用例。
- **顺手收敛了一处已经存在的重复判据**：派生素型清单原先只写在 `interaction.ts` 里（用来决定"不给拖拽手柄"）。预览需要同一份判断，于是新建中立的 `apps/web/src/derivedPrimitives.ts` 导出 `DERIVED_PRIMITIVE_TYPES` / `isDerivedPrimitive`，`interaction.ts` 改为引用它。
  - **为什么放中立位置而不是放进 `agent/`**：`interaction.ts` 是画布核心，让它反向依赖 `agent/` 目录是错的层向。第一版我就是那么写的，重写时改掉了。
  - **为什么与 `primitiveVisibility.ts` 分开**：那个文件回答"画不画"，这里回答"能不能编辑"——经常一起用，但不是同一件事（隐藏的派生对象仍不可编辑，可见的派生对象也不可编辑）。
- **样式**：`apps/web/src/styles/agent.css` 新增草稿预览一节（强调色顶边表示"还没写进文档"；近似与省略用**暖色**而不是灰色 —— 灰掉等于把它藏起来；用到的 `--color-warning` / `--radius-*` 都是既有令牌，没有新造变量）。
- **门禁（实测）**：单测 **149 文件 / 1650 用例全通过、零跳过**（+2 文件 / +12 用例）；e2e **116/116**；lint **0 error / 14 warning**（= 基线）；全 workspace typecheck **exit 0**；`git diff --check` clean。
- **诚实标注：这个组件还没有接进 `AgentWorkspace`**。Task 0.8 Step 4 是"渲染隔离候选"，组件与计数已就绪并有测试；把它挂到 Agent 工作区（并接上 `HostBridge` 的 preview/consent/commit）属于 Task 2.5"用真实运行替换演示 Agent 工作区"的范围 —— 那一阶段才有真实的 `runId`/草稿可预览。**在此之前，浏览器里仍然没有可点的预览面板**，所以 Task 0.8 Step 5 的 Playwright 手工路径仍未走。

### G0.5 Gate 对账：四条验收条件逐条实测（2026-09-19）

计划要求"在 gate 记录命令输出；任一条件不满足就停下复审"。下面是本机实测记录，**每条都给证据与读数**：

| # | Gate 条件（计划原文） | 实测 | 结论 |
| --- | --- | --- | --- |
| 1 | A model-shaped action can only create an isolated draft. | `apps/web/src/agent/pipeline.test.ts` 的 `Gate 1 — a model-shaped action only ever creates an isolated draft`：用**真** `useSceneStore` + 真草稿存储暂存一笔 `planar.create_point`，候选里 1 个对象、真文档 0 个、历史 0 步。另有 `draftStore.test.ts` 的 `keeps a draft candidate in memory and never touches the live document` 独立守着。 | ✅ 满足 |
| 2 | Display and export use the same scoped source context. | `projectionSource.ts` 的 `resolveProjectionSource` 是**唯一**来源选择（显示与导出都调它）；`e2e/engineering-workbench.spec.ts` 的 `exports the switched projection source instead of the drawing's own document` **读回下载的 SVG** 断言来源，并做过 RED 验证（改回 `document` 后导出里 `data-source-id` 计数为 0 而画布仍显示立方体）。第七批又修掉"图纸树与检查器只查布局文档"的第二个来源误报。 | ✅ 满足 |
| 3 | A manual edit after preview makes the draft stale; it cannot overwrite the newer head. | 两条独立证据：`pipeline.test.ts` 的 `Gate 2 — a manual edit after the preview makes the draft stale and the newer head survives`（真文档 `applyBatch` 之后 `commit` 返回 `stale_source`，新头未被覆盖、历史仍只有手工编辑那一步）；`Gate 2 — assertFresh reports the draft's base document as stale after a manual edit`（单独钉住 `DraftStore.assertFresh` —— `commit` 走的是 HostBridge 的 CAS 理由，**碰不到**它，不单测就等于它可以被整体删掉而测试全绿）。 | ✅ 满足 |
| 4 | Consent is one-time, hash-bound, expires, and cannot be generated from assistant text. | **一次性**：`pipeline.test.ts` 的 `Gate 3 — consent is one-time`（同一份记录第二次提交 `consumed_consent`，且对象数与历史步数都不变）+ `hostBridge.test.ts` 的 `consumes consent: the same nonce cannot commit twice`。**绑定哈希**：`pipeline.test.ts` 的 `Gate 3 — consent is hash-bound`（预览后再暂存一笔 → `stale_preview`，并断言预览哈希确实变了）。**会过期**：`hostBridge.test.ts` 的 `expires consent instead of honouring it later`（受控时钟）。**不能由助手文本生成**：结构性保证 —— `requestConsent` 只在 `HostBridge` 实例上暴露，模型侧只能产出 `DraftAction`（动作层类型钉住），通道里没有"把文本变成同意"的入口。 | ✅ 满足 |

- **一处诚实的限定（Gate 4 的"不能由助手文本生成"）**：这条我**没有**写成一条会失败的测试，因为它是结构性的而不是行为性的——用测试"证明某样东西不存在"很容易变成自欺。可以核对的是三件事：① `packages/agent-core` 的依赖只有 `@draw/dsl` 与 `@draw/scene-graph`（不含任何 UI/Host 模块）；② `HostBridge.requestConsent` 需要真实例，而实例只由宿主代码 `createHostBridge` 产出；③ 通道里没有任何"文本 → ConsentRecord"的转换函数（全仓库搜 `ConsentRecord` 只在 `hostBridge.ts` 与其测试里出现）。**没有写成 Gate 的那三条性质（一次性/哈希绑定/过期）都有单测**，所以这条 Gate 不是纯声明。
- **G0.5 仍未完成的部分（所以 Gate 只能算"条件满足"而不是"阶段交付完毕"）**：
  - `agent.worker.ts` / `geometry.worker.ts`（真实 Worker 文件）与 `DraftPreview.tsx`（隔离候选的渲染）—— 计划 Task 0.8 Step 4/5 明确要求，依赖 G1 的运行时形态，放在 Tauri 外壳到位后做；
  - Task 0.8 Step 5 的"在 Playwright 里手工走一遍取消 / 编辑真文档 / 切工作区 / 确认预览"—— 上面 Gate 2 的那条路径**已由 store 级端到端用例覆盖**，但**浏览器里还没有可点的预览面板**（因为 `DraftPreview.tsx` 还不存在），所以这条 Step 只能等面板到位再走一遍；
  - `SourceContext.viewId` 未参与解析；"选择"侧仍是裸 id 集合，两份文档同 id 时会同时高亮。

### G0.5 第七批：来源解析贯穿图纸树与检查器 —— 修掉"来源已删除"的误报（Task 0.6 Step 3 后半，2026-09-19）

- **实测抓到的真实缺陷**：`App.tsx` 的 `sourceLabels` 与 `cadInspectorSources` **只查布局文档**（两者都基于 `document.primitives`）。于是切到"投影立体几何"之后，**明明在四个视图里看得见的空间对象，会被图纸树与检查器标成"来源已删除"**——用户会以为自己的模型坏掉了。计划 Step 3 原文正是"Pass the selected source document through render, selection, annotation, diagnostics, and export"：上一批只贯穿了渲染与导出，**标注与诊断这两条漏了**。
- **修法（`projectionSource.ts` 新增两个纯函数，只有一处解析规则）**：
  - `resolveProjectionSourceEntity(id, preferred, documents)`：在**当前显示的那份文档**、布局文档、空间文档里依次找；`preferred` 优先，是为了"同 id 在两份文档里都存在时，标签跟着眼前显示的那份走"（这正是 `SourceContext` 要解决的场景，标签不能显示成另一份文档里的名字）。
  - `resolveProjectionSourceLabels(ids, preferred, documents)`：给图纸树用的标签表。
  - `App.tsx` 的 `sourceLabels` 改成**从 `cadInspectorSources` 派生**——同一批 id、同一套解析，两处不再各写一份查找（这正是上一批那个"导出用 `document`、显示用来源文档"缺陷的同一类根因：**同一个判断写了两遍就会漂移**）。
- **两个 RED 证据（各自独立，说明两条断言都在干活）**：
  1. 只把标签解析改回"只查布局文档"（`missing` 已是多文档判定）→ `expected '模型树图层树图纸树过滤▾工程图纸A4 横向1 个视图主视图比例 1来源 p…' to contain '空间点 A'`。即图纸树里显示的是**裸 id**，因为布局文档里根本没有这个对象。
  2. 恢复标签解析、把 `missing` 改回 `!layoutPrimitive` → 同一用例再次失败，证明 `data-missing` 那条断言**不依赖**标签断言。
- **边界如实保留**："看不见"与"被删了"是两件事——**两份文档都找不到**才算 `missing`。这条单独有用例（`still reports a genuinely deleted source as missing`），否则修完这个缺陷就会把"来源真的被删"也一起吞掉。
- **新增用例**：`projectionSource.test.ts` 4 例（只在空间文档里的来源 / 同 id 时以显示文档为准 / 真删除仍报 missing / 标签表与解析一致）；`App.test.tsx` 1 例（图纸树与检查器都不再说"来源已删除"）。`projectionSource.test.ts` 6 → **10 例**。
- **门禁（实测）**：单测 **146 文件 / 1633 用例全通过、零跳过**；e2e **116/116**；全 workspace typecheck **exit 0**；lint **0 error / 14 warning**（= 文档基线）；`git diff --check` clean。
- **Task 0.6 Step 3 至此收口**：渲染、导出、图纸树与检查器（诊断）都走同一套来源解析。**仍差**：`SourceContext` 的 `viewId` 还没参与解析（图纸视图目前按 kind 区分，没有把 `viewId` 带进解析），以及"选择"侧的跨文档来源在超集来源下依然按 id 比对（`selectedIds` 是裸 id 集合，两份文档同 id 时会同时高亮——这与 `SourceContext` 的设计目标仍有差距，留待 G0.6 与草稿/句柄一起处理）。

### G0.5 第六批：App 级来源切换的导出断言（Task 0.6 Step 5 收尾，2026-09-19）

- **补上计划点名、此前一直缺的那条用例**：`e2e/engineering-workbench.spec.ts` 新增 `exports the switched projection source instead of the drawing's own document`。它**读回下载的 SVG 文件**再断言图元来源，而不是像上一批的用例那样只看画布 DOM——因为上一批修掉的真实缺陷恰恰是"四个视图里显示立方体、导出的 SVG 里却是本图纸那份（通常是空的）"，只断言显示侧的话这条缺陷会**原样通过**。
- **做了 RED 验证（这是本批唯一有价值的证据）**：把 `App.tsx` 的来源解析从 `projectionSourceDocument` 改回 `document`（即回到缺陷状态）后运行该用例，得到 `expected > 0, received 0`——切到"立体几何"来源、**画布上明明有投影**，导出的 SVG 里 `data-source-id` 计数却是 **0**。恢复修复后同一用例通过，该 spec 13/13 全绿。这说明这条用例真的钉住了那个缺陷，而不是"写了个恒真的断言"。
- **用例还锁定了一条容易被忽略的性质**：来源为"本图纸"（空布局）时，导出的 SVG 里应当有 **4 个** `data-drawing-view` 分组但**没有任何** `data-source-id`——即"空"要如实导出为空，而不是伪造几何。
- **门禁（实测）**：`e2e/engineering-workbench.spec.ts` **13/13 通过**（含新增用例）；单测 **146 文件 / 1628 用例全通过、零跳过**；全 workspace typecheck **exit 0**；`git diff --check` clean；`test-results/` 已被 `.gitignore` 覆盖，无新增临时文件。
- **顺手清掉本会话引入的 4 条 lint warning（18 → 14，回到文档记录的基线）**：`App.tsx` 的 `deletionTargets`（批量删除改走 `compileActions` 后变成未使用导入）、`agent/draftStore.ts` 的 `createDocumentHandle`、`agent/hostBridge.test.ts` 的 `DocumentHandle`、`agent-core/capabilities.ts` 的 `CREATE_OPERATIONS`。
  - **两处如实标注为"本来就有的"、本轮不动**：`App.tsx` 的 `slopeLine` 在 `HEAD` 版本里就已存在（`HEAD` 第 239 行同样未使用——说明它是 `line-slope` 那条交互退役后留下的死变量，与本次 Agent 工作无关）；`App.tsx:1434` 的 `useEffect` 缺 `deleteSelected` 依赖也早于本会话（补它会把"选中变化 → 删除回调"重新三角化，属于独立改动，不夹带）。**结论：清掉的 4 条都是我自己造成的，留下的 2 条不是。**
- **计划文档同步**：`2026-09-18-desktop-agent-implementation-plan.md` 的 Task 0.6 标题下补了状态行（Step 1–5 全部完成、哪些步骤与计划原文有出入、新用例名与 RED 证据）。勾选框仍保留计划原文，不逐条回勾——与前面几次"文档回填"的口径一致。
- **G0.5 Gate 第二条（"Display and export use the same scoped source context"）至此有了可复现的证据**：显示侧与导出侧共用 `resolveProjectionSource` 这一处来源选择，且有一条会因"只看显示侧"而漏掉的导出级用例守着它。G0.5 剩余：`SourceContext` 贯穿选择 / 工程标注 / 诊断（Step 3 的后半，目前只贯穿了渲染与导出）、真实 Worker 文件与 `DraftPreview.tsx`、G0.5 Gate 其余三条对账。

### G0.5 第五批：CAS 写入接进真实 store —— 端口收 getter（Task 0.7 Step 5 收尾，2026-09-19）

- **新增 `apps/web/src/services/sceneDocumentPort.ts`**：把 `DocumentService` 接到真实的 `useSceneStore`。这一层刻意做得薄——四道闸与草稿逻辑都在 `documentService` / `draftStore` 里单测——它只把 store 的**读**（`document`）与**写**（`commitCandidate`）暴露成 `DocumentPort`，好让将来的 Tauri host 用**同一份** service、只换 port 实现。
- **实测定性的关键事实（这条决定了端口签名）**：zustand v5 的 `setState` **每次都整体换掉根对象**（`esm/vanilla.mjs` 里 `state = Object.assign({}, state, nextState)`），所以 `const store = useSceneStore.getState()` 拿到的是**快照**：写一次之后 `store.document` 就**永久停在旧版本**上。我用探针文件实测确认（`rootStableSameTurn: true`、`rootReplacedAfterSet: true`、`storeADocRev: 0` 而 `root3DocRev: 1`）。
  - **如果端口闭包住这个快照，四道闸就会在一个不动的值上比较**——`stale_generation` / `stale_epoch` 永远命不中，等于把 Task 0.7 Step 1 要断言的那条性质（"过期候选永远不落盘"）**悄悄废掉，而且测试看上去还是绿的**。这正是计划里"不许跳过 gate"要防的那类失效。
  - 因此端口签名收 `() => SceneStoreLike`（`createSceneDocumentPort` / `createSceneDocumentService` / `sceneStorePort` 统一收 getter），每次读都现取；并写了一条**专门钉住这点**的用例：`reads the live document every time instead of a construction-time snapshot`（同一个端口连续读两次，跨越一次 `applyBatch`，必须看到 `revision 0 → 1`）。
- **我自己踩的两个坑（都已修，都留下用例）**：
  1. **`{ epoch: undefined }` 也算"有该属性"**：第一版端口无条件写了 `epoch` 键，于是 `port.epoch?.()` 会去**调用 `undefined`**，`readHandle` 直接抛 `TypeError: port.epoch is not a function`。改成只在真的传了 `epoch` 时才挂这个键。
  2. **测试传了快照而不是 getter**：上面那条"过期候选被拒"的用例起初用 `createSceneDocumentService(useSceneStore.getState())`，于是 commit 读到的永远是句柄那一刻的文档，闸门比对通过、**`ok: true`**。为了定位它我依次加了端口侧与 service 侧的诊断打印，最后靠探针文件拿到决定性事实。**结论已写进该文件的文件头注释**：端口一律传 `useSceneStore.getState` 本身。
- **新增 `apps/web/src/store.ts` 的 `commitCandidate(candidate)`**：CAS 校验通过后的**唯一落盘入口**。与 `replace` 的区别是语义而非实现细节——`replace` 是"导入 / 新建文档"（清历史、可换工作区文档），`commitCandidate` 是"在现有文档上落一笔已确认的改动"（**压一步历史**、清 future），所以撤销得回去。内容无变化时（同 revision 且同文档 id）直接返回原 state，不留空历史。
- **用例覆盖（`sceneDocumentPort.test.ts` 4 例，全绿）**：①提交成功且**恰好压一步历史**（走 `commitCandidate` 而非 `replace`）②**过期 generation 被拒**，并断言真 store **既没换文档也没多压历史**③端口每次读实时文档④**epoch 变化使旧句柄失效**（导入/替换后"同 id 同 revision"的极端情形——此时只有 epoch 说得清"换了一世"，`document_mismatch` 与 `stale_content` 的语义都不对）。
- **门禁（实测）**：单测 **146 文件 / 1628 用例全通过、零跳过**；e2e **115/115**；全 workspace typecheck **exit 0**；`git diff --check` clean；临时探针文件与 vitest JSON 报告均已删除。
- **一处诚实的对账**：上一批记的是 145 文件 / 1624 用例，本批记为 **1628**，净增 4 —— 但本批 `sceneDocumentPort.test.ts` 是**新增文件**，所以 1624 那份基线**没有把它算进去**（当时该文件正被重写、尚未进入可运行状态）。我没有倒推早期基线，只报本轮实跑读数。
- **Task 0.7 至此收尾**（Step 5 的两半都完成：真实 `DocumentPort` 实现 + 现有 store 用例通过）。**仍未接进 App 的写入路径**：`App.tsx` 的手工操作依旧直接调 `apply` / `applyBatch`，`DocumentService` 目前只被测试使用；把它铺到所有手工写入点是 G0.6 的事。

### G0.5 第四批：HostBridge 与一次性同意（Task 0.8 上半，2026-09-19）

- **新增 `apps/web/src/agent/hostBridge.ts`**：`preview` / `requestConsent` / `commit`，`ConsentRecord` 按计划带全 `runId / draftId / draftVersion / previewHash / expectedHandles / allowedEffects / expiresAt / nonce`。四道拒绝闸各自有用例，且**每条都断言真文档没有被替换**（过期授权绝不能写入）：`missing_consent`、`consumed_consent`（nonce 一次性）、`wrong_run`、`expired_consent`。
- **提交走重放而不是塞候选**：`commit` 把草稿里**已编译的领域操作**在**当前活跃文档**上重放（`commitTransaction`），而不是把候选文档直接写进去。理由是候选文档带着草稿自己的 revision，直接写会破坏"版本号反映内容变化次数"。
- **实测抓到的严重类型错配（若不修会在生产路径上直接抛）**：我把 `HostBridgeDependencies.currentHandle(): DocumentHandle` 的返回值**当成 `GeometryDocument`** 传给了 `commitTransaction`，于是 `validatePatch` 里 `primitiveIds(undefined)` 直接 `TypeError`。修法是把依赖改成 `live(): { handle; document } | null` —— 句柄用于 Compare-and-Swap，文档本体才是提交的 base。**这个错误说明"名字相近的两个概念"必须靠类型和测试挡住，而不是靠记忆。**
- **另一处同类错配**：`commit` 起初把 `DraftAction`（动作层形状）当作 `DomainOperation` 传给 `commitTransaction`，被判 `unknown operation`。修法是 `draftStore` 的 `DraftRecord` 同时保存 `operations`（原始动作）与 `compiledOperations`（编译结果），预览带上后者供重放。
- **上一轮"待查"的用例已查清（根因有两层，一层是我的测试错、一层是真缺陷）**：`invalidates consent when the draft changed after the preview` 起初失败（第二次 `stage` 后 `commit` 仍返回 `ok: true`）。诊断打印出决定性事实：`secondStageOk: false, reason: compile_failed` —— **第二次暂存压根没成功**，所以草稿内容与预览哈希都没变，`commit` 当然放行。
  - **测试的错**：它想验"预览变了"，却用**同一个 alias `"p"`** 重试了同一笔动作。而 id 分配器**按 alias 幂等**是刻意设计（重试同一笔不该产生两个对象），于是第二次得到同一个 `point-1`，"添加已有 id"被 `validatePatch` 拒绝。改成暂存**另一笔**（不同 alias）后，用例立刻转绿。教训：**幂等分配器让"同 alias = 重试"，用它做"再改一次"的测试必然测不到东西。**
  - **顺带修掉一个真缺陷**：`stage` 里每次调用都 `createIdAllocator()`，分配器因此**不是草稿级**的 —— 同一草稿的第二次暂存会从 1 重新分配 id，与候选里已有的 id 撞车，表现为"暂存成功但内容没变"（用户完全看不出来）。现在分配器随 `DraftRecord` 持久，并支持经 `createDraftStore(allocatorFactory)` 注入（便于测试与将来的确定性重放）。
  - 该用例已从 `it.skip` 恢复为**正常执行**；单测因此从"1623 通过 + 1 跳过"变为 **1624 全通过、零跳过**。
- **门禁（实测）**：单测 **145 文件 / 1624 用例全通过（零跳过）**；e2e **115/115**；全 workspace typecheck **exit 0**；`git diff --check` clean。
- **Task 0.8 未完成部分**：`agent.worker.ts` / `geometry.worker.ts`（真实 Worker 文件）与 `DraftPreview.tsx`（隔离候选的渲染），以及计划的 Step 5"在 Playwright 里手工走一遍取消 / 编辑真文档 / 切工作区 / 确认预览"。这些依赖 G1 的运行时形态，放在 Tauri 外壳到位后做更合适。
### G0.5 第三批：显示与导出统一来源 —— 修掉一个真实缺陷（Task 0.6 Step 3，2026-09-19）

- **实测抓到的真实缺陷（这轮最有价值的产出）**：`EngineeringDrawingView` 按 `projectionSource` 选文档（`geometry3d` → 空间文档，否则本图纸），而 `App.tsx` 生成**导出内容**时**永远**用当前工作区文档。后果是：用户切到"投影立体几何"之后，**四个视图里显示的是立方体，导出的 SVG / DXF / PDF 里却是本图纸那份（往往是空的）内容** —— 拿到一个和眼前不一样的模型。计划里那句 "display and export use the same scoped source context" 正是这条，此前只是显示侧单方面实现了。
- **修法**：把来源选择收敛成**唯一一处** —— `projectionSource.ts` 新增 `resolveProjectionSource(source, layoutDocument, spatialDocument)`，`App` 的 `engineeringDrawings` 与 `EngineeringDrawingView` 共用它；`geometry3d` 来源缺文档时回退到本图纸，与显示侧历史行为一致。另加 `projectionSourceHandles(...)` 产出两份文档的句柄，供跨文档引用对账（同名 id 必须可区分 —— 这是 Task 0.6 的起点）。
- **补测试（先确认缺失）**：这个修复起初我改完就跑 e2e，**没有任何单测覆盖** —— 按纪律补了 `projectionSource.test.ts` 三条：来源选择、缺空间文档时的回退、两份文档句柄可区分。补的时候又踩一个自己的坑：追加用例时插入了**重复的 `createEmptyDocument` 导入**（typecheck 会拦，但更该在写的时候就避免）。
- **门禁（实测）**：单测 **144 文件 / 1616 用例**全部通过；e2e **115/115** 通过（工程工作台的投影来源切换用例覆盖了这条路径）；全 workspace typecheck **exit 0**；`git diff --check` clean。
- **Task 0.6 仍差最后一步**：Step 5 的"App 级来源切换用例"（现有 e2e 覆盖了切换与显示，但**没有**断言导出内容来自新来源——补它需要捕获下载内容）。Task 0.8 尚未开始。
### G0.5 第二批：CAS 写入服务与隔离草稿（Task 0.7，2026-09-19）

- **新增 `apps/web/src/services/documentService.ts`**：所有写入走 Compare-and-Swap，四道闸按"先便宜后昂贵"排列 —— `document_mismatch` → `stale_epoch` → `stale_generation` → `stale_content`。关键性质是**过期候选永远不调用 `port.replace`**（计划 Step 1 明确要断言的那一条），且 `undo` 因为会恢复**旧 revision**，恰好被 `stale_generation` 挡住。
- **新增 `apps/web/src/agent/draftStore.ts`**：`create` / `stage` / `assertFresh` / `invalidate` / `getPreview`。草稿在**内存克隆**上编译与执行，`stage` 必须先过 `compileActions`（诊断非空就保持草稿原样，不留"半成品"），执行走**与 `commitTransaction` 同一套** `validatePatch` + `applyOperation`，而不是自己写一份"草稿版执行"。`stage` 必须带**期望草稿版本**：拿旧版本号再来会被 `stale_draft_version` 拒绝，否则会静默覆盖更新的暂存。预览哈希随内容变化，供 Task 0.8 的 consent 绑定。
- **实测抓到的设计缺口（我自己的）**：`epoch` 最初由 `metadata.id` 派生，导致"**同一份文档被重新导入**（id 不变、内容整体替换）"这一情形**根本无法表达** —— 那种情况下 `stale_epoch` 永远不会触发，只有 `document_mismatch` 或 `stale_content` 能命中，而它们的语义都不对。修法是把 epoch 交给上层：`createDocumentHandle(document, projectId, epochOverride?)`，并由 `DocumentPort.epoch?()` 提供当前值（返回 `undefined` 表示"派生默认"）。这条也说明计划里那句"导入/替换产生新 epoch"**需要由导入服务参与**，句柄自己推不出来。
- **另两处小坑**：①我一度把 `import` 语句写在了文件中间（非法），且为同一件事套了三层包装函数 —— 重写为一次直接调用；②`actions/index.ts` 只导出了函数、**没有 re-export 类型**，导致 `draftStore` 取不到 `DraftAction` —— 补上类型导出。
- **门禁（实测）**：单测 **144 文件 / 1613 用例**全部通过（documentService 5 例、draftStore 5 例）；e2e **115/115**；全 workspace typecheck **exit 0**；`git diff --check` clean。
- **Task 0.7 尚未收尾**：Step 5 要求"现有 store 测试通过"（已满足）与把服务接进 `useSceneStore`（`DocumentPort` 的真实实现）—— 后者与 Task 0.6 的 Step 3 一起做，因为它们都要改 `App.tsx`/`store.ts` 的写入路径。Task 0.8（HostBridge + consent + 预览组件）尚未开始。**→ 已在「G0.5 第五批」完成**（真实端口 + `commitCandidate`，并因此发现"端口不能闭包 store 快照"这个能静默废掉整个 CAS 的坑）。
### G0.5 第一批：作用域来源上下文与导出预检（Task 0.6 上半，2026-09-19）

- **先验证计划对缺陷的描述，结果与计划不同（如实记）**：计划 Step 1 说"空 CAD 布局 + 含一个 point3 的空间文档，显示与导出必须得到相同的源计数"。我用探针实测两侧**本来就是一致的**（显示 4 个、导出 4 个），所以这条无法写成"修复前失败"的用例。但计划 Step 1 的第二句——"**同名 ID 在两份文档里必须保持可区分**"——**确实不成立**：`ProjectedPrimitive` 只带 `sourceId`（如 `point3-1`），**没有 `documentId`**，一旦 CAD 布局文档与几何文档出现同名 id，显示/选择/标注/导出都无法说清来源。Task 0.6 因此以"作用域引用"为落点。
- **新增 `packages/scene-graph/src/sourceContext.ts`**：`createDocumentHandle`（带 `contentHash`，复用 `transactions.ts` 的 `contentFingerprint`，两处共用**同一份**规范化规则而不是各写一份）、`resolveSourceEntity`（必须匹配 `documentId` 且内容哈希一致）、`contextHandles`。四种拒绝理由各自有原因码：`document_not_in_context` / `entity_not_found` / `stale_source` / `source_unavailable`。**句柄过期时绝不静默回退到当前文档**——静默回退会让用户看到一个不是他要的模型。
- **生成拓扑可追溯**：`cube-1-point-1` 这类模板物化出来的子 id 单独查不到，`resolveSourceEntity` 会把它解析成 `{kind:"generated", ownerId, childId}`，而不是报"不存在"。（写这条用例时我第一版只放了 `{type:"cube"}` 而没有真实拓扑，导致查不到——改用 `buildSolidTemplate` 造出真拓扑后通过。）
- **新增 `apps/web/src/services/exportService.ts` 的 `buildExportPlan`**：产出真实投影 id、略过项、字体丢失、近似说明、来源句柄，并在**产出文件之前**给出 `supported` / `requiresUserAcceptance` / `blockedReasons`。
- **实测抓到的真实静默丢弃**：`connection` 与 `intersectionSet` 这类来源**根本不会出现在投影结果里**（探针打印：投影只产出 `point3-1/2/3` 三个点）。所以只遍历 `drawing.primitives` 去找"不支持的来源"是错的——它们既不在已投影集合里、也不在略过列表里，等于**静默消失**。改成**对全量来源做差集**后才把它们列出来。这正是计划点名要报的那一类。
- **门禁（实测）**：单测 **142 文件 / 1603 用例**全部通过（sourceContext 5 例、exportService 4 例）；全 workspace typecheck **exit 0**；`git diff --check` clean。
- **Task 0.6 尚未收尾**：Step 3 的"把来源上下文贯穿渲染/选择/工程标注/诊断/导出"与 Step 5 的"App 级来源切换用例"还没做；`projectionVisuals` / `EngineeringDrawingView` / `App.tsx` 仍是各自查文档。这块与 Task 0.7（草稿与 CAS 句柄）耦合，放在下一批一起做更省事。
### G0 Gate 对账：五条验收条件逐条实测（2026-09-19）

计划要求"在 gate 记录命令输出；任一条件不满足就停下复审，不许跳过到下一阶段"。下面是本机实测记录，**每条都给命令与读数**：

| # | Gate 条件（计划原文） | 实测 | 结论 |
| --- | --- | --- | --- |
| 1 | `npm.cmd test -- packages/agent-core packages/scene-graph` passes | `npx vitest run packages/agent-core packages/scene-graph` → **19 文件 / 281 用例全绿** | ✅ 满足 |
| 2 | Runtime unknown operations are rejected; no-op commits do not increment revision | `patches.test.ts` 5/5、`transactions.test.ts` 6/6 全绿；用例名逐条可见：`rejects an unknown operation even when TypeScript was bypassed`、`reports a no-op batch as unchanged instead of bumping the revision`、`keeps applyOperation honest about semantic change` | ✅ 满足 |
| 3 | Batch deletion is atomic and order independent; manual UI still has one-step undo | `transactions.test.ts` 的 `deletes a complete union regardless of the order the ids arrive in`、`executes all operations or none when one of them fails`；`store.test.ts` 的 `keeps one undo step for a whole batch and deletes a union in any order`（+ `leaves history untouched when the batch changes nothing`） | ✅ 满足 |
| 4 | A registry coverage test reports 42/42 primitive types and 39/39 operation variants mapped or explicitly blocked | `capabilities.test.ts` 4/4 全绿，其中 `covers every current primitive type and operation variant` 断言 `PRIMITIVE_TYPE_NAMES` 42、`DOMAIN_OPERATION_NAMES` 39，并逐个查 `byPrimitiveType` / `byOperation`；`blocks the documented gaps explicitly` 钉住四项显式阻止 | ✅ 满足 |
| 5 | No Agent or model network code has been added yet; only local deterministic contracts and shared action handlers exist | 对 `packages/agent-core/src/*.ts`、`packages/scene-graph/src/*.ts`、`src/actions/*.ts` 搜 `fetch(` / `XMLHttpRequest` / `axios` / `EventSource` / `WebSocket` / `apiKey` / `Authorization` / `openai` / `anthropic` → **零命中**；`@draw/agent-core` 的 dependencies 只有 `@draw/dsl` 与 `@draw/scene-graph` | ✅ 满足 |

- **一处诚实的限定**：Gate 4 的"39"是**当前真实值**（原计划书写 38，我在 Task 0.4 新增 `deleteObjects` 后把它同步成了 39，计划书与文档一并改过）。所以这条 Gate 验的是"注册表与当前类型联合**无遗漏**"，而不是"数字恰好等于某个历史值"——后者会随每次新增操作失效，前者才是它真正要守的东西。
- **G0 阶段的结论**：G0（可信执行底座）五个任务全部完成，Gate 五条全部满足。按计划约定"**Stop here for review. Do not start Tauri or model work if any G0 condition fails.**"——条件均满足，因此**技术上可以进入 G0.5 / G1**；但计划同时要求在每个 gate 停下来由人复核，所以是否继续由你决定。
- **仍未提交**：计划明确规定执行期间不自动 commit/push，从 Task 0.1 至今的全部改动都在工作区。
### G0 第三批（下半）：再抽九个动作族，动作层覆盖 12 族（2026-09-19）

- **新增 `packages/scene-graph/src/actions/actions.families.test.ts`**（14 例）与对应 handler，把计划 Step 2 点名的剩余族补上：
  - `function.analyze`（导函数 / 切线 / 积分区域）：`unbounded_domain` 拒绝无界定义域上的积分，`source_not_function` 拒绝非函数来源；
  - 曲线切线 **anchor 全量**：`anchor.kind === "parameter"`（沿曲线自然参数）与 `anchor.kind === "point"`（**跟随动点** —— 定位写成对点的引用而不是抄下当前坐标，所以点一动切线跟着转）；
  - `dynamic.bind_curve`（点到曲线绑定，自然参数定位）：拒绝 `path_not_found` / `target_not_point` / **非有限参数**；
  - `dynamic.set_radius_rule`（半径由驱动点算出）：拒绝 `driver_not_found` / `driver_not_point` / `invalid_factor`；
  - `parameter.set` / `parameter.set_expression`：拒绝 `parameter_not_found` / 非有限值 / 空表达式。
- 至此动作层覆盖 **12 个动作族**（planar、conic、function、dynamic、planar_intersection 的部分、spatial、solid、spatial_dynamic、section、object/parameter/style 的部分、organization 的部分、legacy 只读）中的 12 个 —— 与 §7.3 的表逐行对照过，**仍未抽出**的是：相交预览持久化（`planar_intersection.create_*` 的落库那一步）、CAD 来源与导出提议、`style.set` 批量样式、`dynamic.anchor_rotation`（动圆绕定点旋转）。
- **实测踩到的两处（都是我的）**：①测试断言我一度改错方向 —— `sourceId` 给的是**点**时正确诊断是 `point_not_bound`（`source_not_curve` 是"给曲线 id"那条路），两者语义不同；②无差别地 `map` 给每个图元加 `binding` 会推断出**不属于 `PrimitiveSpec` 联合**的对象，必须先收窄 `type === "point"` —— typecheck 当场拦住，这正是严格类型在这里的价值。
- **门禁（实测）**：单测 **140 文件 / 1594 用例**全部通过（动作两批合计 30 例）；e2e **115/115** 通过；全 workspace typecheck **exit 0**。
### G0 第三批（上半）：动作编译器框架与九个动作族（Task 0.5，2026-09-19）

- **新增 `packages/scene-graph/src/actions/`**：`types.ts`（动作判别联合 + `ActionContext` + 幂等 `IdAllocator`）、`index.ts`（`compileAction` / `compileActions`）、`actions.test.ts`。设计规格 §7.3 的命名（`family.verb`）与 §7.4 的"手工按钮与 Agent 共用同一个编译器"是这层的两条硬约束。
- **Step 1 的对照表落在 `actions.test.ts` 顶部**：手工回调 → handler → 覆盖用例。表里同时写明**哪些回调还没抽出**（函数分析、曲线切线 anchor 全量与 `set_radius_rule`、相交预览持久化、CAD 来源/导出），所以它既是清单也是进度。
- **编译器三条纪律**：①不改输入文档（只产出 `DomainOperation[]`，由 `commitTransaction` 执行）；②id 由**按别名幂等**的分配器给（重试同一草稿不会在文档里留下两个对象）；③前置条件不成立时给**可读诊断码**而不是抛异常 —— 模型据此还能修一次（设计规格 L990）。
- **已实现九个动作族**：planar（点/线/线段/射线/折线/圆/圆弧）、solid.create_template、dynamic.bind_point、dynamic.create_locus、function.create_tangent、section.create、section.materialize、object.delete_many、object.update_inputs。拒绝路径包括：退化线（两端点重合）、非正半径、非立体来源、工作区不匹配（在平面工作区建立方体）、**跨文档引用**、点自绑定、未注册输入字段（`area` 这类派生量永不接受写入）、空批次。
- **手工按钮开始走同一个编译器**（Step 3）：`deleteSelected` 改为 `compileActions(... object.delete_many ...)` → `applyBatch`。
  **一处刻意保留**：`validateDeletion` 仍然先行，因为它给的是**用户可读**的拒绝理由（"对象被另一个对象引用"），而编译器的诊断是给 run 记录与模型修复路径看的。两种消费者的措辞要求不同，所以两处都留 —— 这是本轮唯一一处"有意不合并"。
- **Step 4 的幂等性有专门用例**：同一 allocator 上重复编译同一草稿，操作数组与分配到的 id 必须**逐字相同**；另有一条用例断言编译过程**不修改输入文档**（序列化前后一致）。
- **实测踩到的三处（都是我的）**：①`LocusPrimitive` 并不带"点列表"，它记的是**驱动参数与采样窗口**（`parameterId`/`domain`/`samples`），第一版照 `points: []` 写，被 typecheck 拦住；②`CAPABILITY_REGISTRY_REVISION` 属于 `@draw/agent-core`，而 `apps/web` 当时**没有声明该依赖** —— 补上依赖并 `npm install` 建链接；③测试里从部分字段构造判别联合需要 `as unknown as` 中转（生产代码不需要这种构造）。
- **门禁（实测）**：单测 **139 文件 / 1580 用例**全部通过（动作 16 例）；e2e **115/115** 通过；全 workspace typecheck **exit 0**；`git diff --check` clean。
- **G0 尚未收尾**：Task 0.5 的其余动作族（函数分析、曲线切线 anchor 全量 / `set_radius_rule`、相交预览持久化、CAD 来源与导出提议）仍需抽出，之后才能对 G0 Gate 逐条对账。
### G0 第二批：原子事务与顺序无关的批量删除（Task 0.4，2026-09-19）

- **新增 `packages/scene-graph/src/transactions.ts`**：`commitTransaction({ base, operations, expectedGeneration? })` 返回 `{ changed, document, diff, errors, beforeHash, afterHash }`，**要么全部执行、要么原样返回**。每笔先过 `validatePatch`（含 Task 0.3 的未知操作守卫）再在副本上执行，这样后续操作能看到前面操作的结果（先建点、再删它），同时失败时零副作用。
- **新增 `deleteObjects` 操作**（整批并集）：逐项 `deleteObject` 做不到"点 A 与依赖它的直线 AB 一起删"——先删点会被"仍被引用"拒绝、先删线又会把点留下，谁先谁后都不对。`validatePatch` 对它是**先整批存在性/锁定检查、再按并集算一次闭包**，所以与 ids 顺序无关。
- **删除闭包抽成共享函数 `applyDeletionPlan`**：`deleteObject` 与 `deleteObjects` 走同一套语义（先解绑 → 过滤图元 → **最后**回收孤儿驱动参数），避免两套实现漂移。抽的时候刻意保留原注释与顺序，因为顺序本身是有原因的。
- **store 新增 `applyBatch`，App 的批量删除改走它**：以前 `deleteSelected` 逐个 `apply({op:"deleteObject"})`，N 个对象留下 N 步撤销；现在整批一次提交、**只占一步撤销**。`validateDeletion` 仍先行——它给的是用户可读的拒绝理由，事务的 `errors` 是给 run 记录看的。
- **计划与文档里的数字同步**：新增 `deleteObjects` 后操作变体由 38 → **39**，`DOMAIN_OPERATION_NAMES` 与注册表随之扩展；`capabilities.test.ts` 的 `toHaveLength(38)` 断言当场抓住"改了 `OPERATION_CAPABILITIES` 却漏了运行时真值列表"，计划书的 `39 current` / `39/39` 也一并改掉（否则文档与代码立刻漂移）。
- **实测踩到的三处（两处是我测试写错，如实记）**：①比较两次删除的 `afterHash` 时我用了两份独立的 `createEmptyDocument` —— `metadata.id` 不同，等于在比较两份文档；改为共用同一个 `base`。②`revision` 语义我一开始断言成"事务只涨 1"，实测 `afterOne: 1, afterTwo: 2, batchResult: 2`：**revision 是内容版本号**（两笔成功操作就该涨两格），"一次事务 = 一步撤销"由 store 按事务粒度压栈保证，不是靠压住 revision。③`store.test.ts` 追加用例时漏了 `createEmptyDocument` 的导入。
- **门禁（实测）**：单测 **138 文件 / 1564 用例**全部通过（含事务 6 例 + store 批量 2 例）；e2e **115/115** 通过；全 workspace typecheck **exit 0**；`git diff --check` clean。
### G0 第一批：可信执行底座的三块地基（2026-09-19，按 `docs/superpowers/plans/2026-09-18-desktop-agent-implementation-plan.md`）

按计划按序执行 G0 的前三个任务（`executing-plans` 约定：分批 + 检查点）。**尚未提交** —— 该计划明确要求执行期间不自动 commit/push。

- **Task 0.1 能力注册表**（新包 `@draw/agent-core`）：把当前 **42 个图元类型**与 **38 个 `DomainOperation` 变体**全部映射到可用能力或**显式阻止状态**，并按计划点名阻止四项：`intersectionSolid` → `legacy_readonly`、内核物化拓扑（`edge3`/`face3`/`polyhedron3`）→ `temporarily_unavailable`、三维约束 → `diagnosis_only`、3D 的 SVG/PNG 导出 → `unsupported`。
  - 动手前**先核对了计划声称的两个数字**（42/38），逐一数准后才写测试 —— 否则"覆盖 42 个"这句话本身就是空的。
  - 漂移防护做成**编译期双向断言**（`Record<PrimitiveSpec["type"], …>` + `satisfies readonly Type[]`），当场生效一次：把 `circleIntersection` 误写成 `circleCircleIntersection` 时编译失败并给出 "Did you mean"。
  - 新增运行时真值列表 `packages/dsl/src/primitiveTypeNames.ts` 与 `packages/scene-graph/src/operationNames.ts`，避免测试维护第三份副本。
- **Task 0.2 传输契约与运行时 schema**：`contracts.ts` 严格照设计规格 §6 与附录 A；`schemas.ts` 手写校验（零依赖）。拒绝路径全覆盖：未知 kind／未知字段／未知 actionId／重复 actionKey／非有限数值／超长字符串与数组／**未加作用域的引用**／空 actions，并拒掉"raw `DomainOperation` 冒充 action"。
  - `canonicalContentHash` 用**纯 TypeScript SHA-256**（浏览器与 Node 结果一致、无依赖），排除视图与时间类字段 —— "只是滚了一下画布"不该让预览失效。
- **Task 0.3 堵住 unknown-operation 与 false-change 两个洞**（改 `scene-graph` 的校验与提交路径）：
  - `validatePatch` 以前逐条 `if (op === "…")` 检查，**没被任何分支覆盖的 op 会绕过全部校验返回 valid**；现在前置 `isDomainOperation` 守卫（放在 `operationNames.ts`，避免与 `operations.ts` 循环导入）。
  - `applyOperation` 以前**无条件** `revision += 1` 且 `changed: true`；现在重算之后做语义比较，无变化就 `changed: false` 且不推进 revision。
  - 顺带补强：`translatePrimitive3` / `rotatePrimitive3` / `moveSectionPlane` / `rotateSectionPlane` / `setSectionPlane` **在入口拒绝非有限数值**（此前 `moveSectionPlane(NaN)` 会把 `plane.constant` 写成 NaN，既不报错也不返回 —— 而 NaN 在 JSON 里序列化成 `null`，任何基于序列化的比较都会把它读成"内容变了"）。
- **两处实测踩到的坑（都是我自己写的 bug，如实记）**：①语义规范化里第一版只跳过了 `visible: undefined`，没跳过等价的 `visible: true`，于是 no-op 仍被判成改动；②更严重的是我把 `locked` 与 `visible` 一起当成"`true` 等于缺省"跳过 —— 但 `locked: true` **恰恰不是**缺省（缺省是未锁定），结果 `toggleLock` 被判成 no-op、锁根本写不进文档，三个既有"拒绝锁定对象"的用例当场变红。规范化只适用于 `visible`。
- **一处契约变更（影响既有用例）**：`curveTangents.test.ts` 里"锚定切线上写 `x` 会被重算覆盖"原本断言 `changed: true`。补丁被内核完全抹掉 = 没有语义变化，新契约是 `changed: false`（且**不是错误**）。已更新该用例并写明理由。
- **门禁（实测）**：单测 **137 文件 / 1556 用例**全部通过；全 workspace typecheck **exit 0**；`git diff --check` clean；agent-core 聚焦 27 用例、scene-graph 三件套 55 用例全绿；e2e 回归见下条。
### 数值转换内联回归 + 吸附口径重写（2026-09-19 用户口径）

用户口径：「根据现在已有的 ui，重新优化再加上去」＋「这个近似不那么好用，手稍微偏一偏分数就没了，我们不需要那么精确，我们要将数据往常见整数和分数上面靠」＋「坐标是整数或分数时，能够准确计算时，还是保留精度」。

- **先复现，再改**：写了一个临时探针（跑完即删）扫当前 `exactFormOf` 的真实行为，实测抓到两件事：① **该认的没认** —— 拖动出来的全精度浮点 `0.667023` 被认成 `≈ 0.67`（连 `0.6666`、`0.334`、`0.5001`、`2.9999`、`1.4142`、`0.866` 都一起掉）；② **不该认的乱认** —— `0.66 → 33/50`、`0.68 → 17/25`、`3.02 → 151/50`、`0.69 → ≈ 20/29`、`0.51 → ≈ 25/49`、`0.0834 → ≈ (11-4√7)/5`、`2.998 → ≈ (5+4√39)/10`。根因在 `exact-forms.ts`：松容差按"输入自身十进制末位的半个单位"（**绝对**值）算，拖动值的容差近似为 0；分数又取"分母 ≤ 64 里**最接近**的有理数"，于是一有余量就抓一个又大又没用的分母。
- **内核改成三层**（`packages/geometry-kernel/src/exact-forms.ts`）：① **精确层不动**（紧容差 相对 1e-9 / 绝对 1e-12，文本不带 `≈`）—— 手输的 `0.0625` 仍是 `1/16`、`0.66` 仍是 `33/50`，这就是"能准确计算时还是保留精度"；② **吸附层只在常见形式里找**：整数与分母 ∈ {2,3,4,5,6,8,10,12} 的既约分数带 **2%**，π 的有理倍数与**纯根式** `b√n/c`（b ∈ ±{1,2,3}、c ≤ 4）带 **0.3%**，命中一律带 `≈` 并给残差；③ 两位小数兜底不变。
- **TDD 逼出两个真问题**（不是我事后想到的，是先看见用例变红才发现的）：① `radicandFrom` 的整数判定用**固定** 1e-6，`1.41421` 反解出 `n = 1.9999903` 就被判成"不是 2"，`√2` 因此掉到 `≈ 17/12` —— 改成按调用方传入的容差换算允许误差（`2·√n·(c/|b|)·Δx`），并把范围判定落在**四舍五入后的整数**上（原来拿 `radicand < 2` 比，`1.9999903` 直接被挡）。② 根式候选一旦带上整数部分，0.3% 的带里几乎任何数都能被某个怪形式凑上（实测 `0.6751 → (-4+3√5)/4`、`0.69 → -4+√22`、`e → (3+√62)/4`、`e → (1+√51)/3`），所以**吸附层只留纯根式**（对角线那一族）；黄金比 `(1+√5)/2`、`2+√3` 这类仍由精确层认 —— 它们是精确构造出来的，不是拖出来的。
- **界面：不做置顶面板，把形式贴在数字已经在的地方**。画布常驻读数（平面 `planarMeasurementVisuals` / 立体 `measurementVisuals`）与属性栏测量卡片的「结果」都显示 `长度：0.667u · ≈ 2/3`、`角度：1.571rad · π/2`；测量卡片另给一个「复制 ≈ 2/3」按钮（`data-exact-form-text`，只复制形式，带 `≈` 不伪装成精确值）。三处共用新模块 `apps/web/src/measurementForms.ts`。规则：整数的**精确**形式不加后缀（`5.000u` 已经把 5 说清楚了），`2.9999` 这类**吸附**上来的整数要加（`≈ 3` 是别人看不出来的信息），两位小数兜底不加（与 3 位小数的读数是同一个信息）。顺手把测量卡片标题从英文度量 key 的 `length测量` 统一到 `measurementMetricLabel` 的「长度测量」—— 对象列表一直用中文，这是同一份名单的第二处副本。
- **追加 `e`（用户口径："e 也需要有"）**：先如实记录过代价 —— `e = 2.71828` 既不是常见分数、也不在常量的 0.3% 窄带里，会被吸到 `≈ 27/10`（差 0.67%）；用户看到这条后当场要求补上，于是常量族在 π 的有理倍数与纯根式之外再收 **e 的整数倍**（`e`、`2e`、`-e`…，`kind: "e-multiple"`，`formatConstantMultiple` 与 π 共用一份格式化）。**只认整数倍是刻意的**：π 认到 π/12 是因为 15°/30°/45° 的角都是它的分数倍，而 e 在这个画布上没有"分数倍"的自然来源 —— `e/12 ≈ 0.2266` 的间距下，0.3% 的带会覆盖约 **7%** 的数轴，而整数倍的间距是 e 本身，误认概率低两个数量级。实测：`Math.E → e`（精确，不带 `≈`）、`2.7182 / 2.7183 → ≈ e`、`5.4366 → ≈ 2e`，`2.5001` 仍是 `≈ 5/2`。
- **同一次追加被用例抓出并修掉的一个真缺陷：吸附层的取舍规则**。第一版是"常量族优先，没中再看常见分数"，结果 `2.5001` 被 `2√14/3`（差 0.22%）抢走，而它离 `5/2` 只差 0.004% —— 常量族虽然带更紧，仍会命中一些"合法但没用"的形式。现在两族**各自取最近的，再比残差、谁近谁赢**（常量想赢必须真的更近），规则写在一处（`snapToCommonValue`），用例 `does not let e's family claim ordinary values` 钉住。
- **门禁**：单测 **134 文件 / 1563 用例**全部通过（较基线 +1 文件 `measurementForms.test.ts`、+14 用例）；类型检查 4 个 workspace 通过；Web 生产构建通过；`e2e/measurement-labels.spec.ts` 在真实 Chromium 里 **3/3** 通过（新增断言：拖动出来的 `0.667023` → `长度：0.667u · ≈ 2/3`、单位正方形对角线 → `长度：1.414u · √2`、整数 → `长度：1.000u` 不带后缀）；内核新增一条**耗时护栏**用例，1000 次调用实测 **181 ms（0.18 ms/次）**，旧实现约 0.21 ms/次（这条护栏是必要的：第一版按 n 枚举根式曾实测最坏 114.9 ms）。

### 粒子流畅度优化：把动画搬进合成器（2026-09-18 用户反馈）

用户口径：「提高 MathCanvas 的光标粒子效果的流畅度，帧率很低」。

- **先量再改**：写了一个采样 180 帧的测量脚本，读数 **60.2fps / p50 16.7ms / p95 16.7ms / 0 个长帧** —— 测试机上帧率本来就是满的。所以问题不在"平均帧率"，而在**实现里有三处会真实造成掉帧与视觉抖动的东西**（低配机、高 DPI 屏、或画布同时有动画时就会暴露）。
- **根因 1：`filter: drop-shadow`**。它是逐帧的模糊绘制，20 颗粒子等于每帧 20 次滤镜 → 换成"径向渐变里多一段色标"表达光晕（`rgb(226 240 252) → rgb(170 205 240) → 透明`），观感接近、开销为 0。探针实测确认 `hasFilter: false`。
- **根因 2：`left` / `top` 动画**。这两个属性逐帧触发**布局**，动画只能跑在主线程，主线程一忙就掉帧 → 位置改成 `translate3d` 的基准偏移（`--px` / `--py`，由百分比按粒子层固定尺寸换算成 px），关键帧只动 `transform`；粒子层本身加 `translateZ(0)` 提升为独立合成层，整层只 raster 一次。
- **根因 3：`animation-direction: alternate`**。往返会在端点处顿一下，读起来就是抖 → 改成单调上浮 + 两端淡出（新关键帧 `brand-particle-rise`，10% / 76% 为不透明休止区，幅度仍由每颗粒子的 `--particle-rise` 决定）。
- **顺带补偿亮度**：去掉 `drop-shadow` 后粒子偏暗，把中心不透明度提到 100%、粒径 2–4.2px → **2.4–4.8px**；仍是零滤镜。
- **改完复量**：**60.4fps / p95 16.8ms / 0 长帧**（与基线同水平，差异在噪声内）；探针另确认动画名正确、各粒子 scale 取值错峰（1.18 / 0.90 / 1.10）。
- **如实记**：这一轮**没有**测出"帧率数字上的提升" —— 测试机基线就是满帧，所以我无法用数字证明"更快"，只能证明**高开销路径被拿掉了**（滤镜消失、动画只碰 `transform` / `opacity`）。若在你的机器上仍觉不流畅，下一步该量的是合成时间（DevTools Performance 的 Compositing 轨道），而不是 FPS。
- **第二刀（用户选定"把周期拉长、幅度调小"）：降速度，而不是继续减绘制开销**。周期 3.6–7.4s → **8–15s**、上浮幅度 8–28px → **5–11px**、水平位移 6px → **2px**、缩放 0.85↔1.2 → **0.9↔1.08**、不透明休止区 10%/76% → **8%/84%**（周期变长后可见时长比例也变大，常驻粒子数更稳）。
  判据是**每帧位移**：`rise / (duration × 120)` 从改前最高 0.065 px/帧降到 **0.003–0.011 px/帧**（120Hz），比"约 1px/帧人眼可见台阶"低两个数量级。这条已写成用例断言（`pixelsPerFrameAt120Hz < 0.05`），以后谁再把周期调短都会先红。
  实测探针确认生效：`duration 8.3–14.7s`、`rise 5–11px`、20 颗全部可见、1 秒内确有位移。
  **注意**：我第一次口头把速度说成 0.12–0.24 px/帧，实际算错了（量级差 20 倍），代码注释已按实测值更正 —— 这类"凭感觉给的数"必须落到测量上。
- **门禁**：单测 **133 文件 / 1555 用例**全部通过；Playwright **115/115** 通过；类型检查 4 个 workspace 通过。

### 顶栏改深色 chrome + 粒子清晰化（2026-09-18 用户口径）

用户口径：「顶部的 MathCanvas一栏也换成左边框的颜色，让 MathCanvas的光标粒子效果更清晰流畅」。

- **顶栏换成左侧栏的深色**：两者共用新令牌 `--color-chrome-top/bottom`（取自左侧模块栏原来的渐变），不再各写一份；顶栏因此与左侧栏连成一道**暗色边框**，与下方的冷白画布形成深浅对比。品牌文字随之改浅（`--color-chrome-ink`），光标从板岩蓝换成浅青 `#cfe0f5` + 8px 光晕（原来的板岩蓝在深底上偏暗）。
- **chrome 取值再落到冷色系（用户接受建议后的一处令牌改动）**：原来那份渐变是 `#211d33 → #1a1728`，带一点**紫调** —— 而整套界面已经收敛到板岩蓝系，chrome 成了唯一跑出体系的地方。改成 **slate-800 → slate-900**（`#1e293b → #0f172a`），色相统一、暗度不变；左侧栏另外三处硬编码的紫调文字（`#b6b1cc` 按钮字、`#8f89a8` 分组标签、`#7d7799` 脚注）也一并换成 `#94a3b8` / `#64748b`。**只有令牌与三处色值变了，布局与交互一行未动。**
- **粒子清晰化（四处一起改，不是只调透明度）**：①颜色从"板岩蓝低透明"换成**亮青径向光点**（`rgb(205 224 245)` 中心 → 透明边）并加 `drop-shadow` 光晕；②粒径 1.4–3.6px → **2–4.2px**；③基础不透明度 0.25–0.7 → **0.4–0.8**；④周期 5.5–11.5s → **3.6–7.4s**（更容易被眼睛捕捉到，也就是口径里的"流畅"）；⑤数量 14 → **20**，粒子层左右各外扩 56px。
- **关键帧只留位移与缩放**：原来关键帧里也写 `opacity`（0.15 → 1 → 0.25），会把每颗粒子自己的基础透明度盖掉，导致"整组一起闪"。改成**不透明度由行内样式给、关键帧只管 `transform`**，并在两端各留一段透明"休息区"（`18%, 82% { opacity: 1 }`）避免边缘硬闪。
- **顺手实测抓到一个真缺陷：品牌被截断**。容器按 9ch 收窄后截图只剩 "MathCanva" —— 实测当前字体 `1ch = 9.25px`，而 "MathCanvas" 的自然宽度是 **96px（≈10.4ch）**，按字符数估算宽度不足。改成 **11ch**（102px）后实测容器 102 ≥ 文字 96、光标 x863 紧贴文字 right862。教训：`ch` 只能用于等宽字体，比例字体下按 `ch` 估算宽度必然偏差。
- **门禁（实测）**：单测 **133 文件 / 1555 用例**全部通过；Playwright **115/115** 通过；类型检查 4 个 workspace 通过；改动文件 ESLint 0 error。截图核对过深色顶栏与粒子的实际观感（核对后临时脚本与截图已删除）。

### 顶栏重排 + 动态粒子品牌 + 打字终端卡片（2026-09-18 用户口径）

用户口径三件事：①「把右侧的光标删除」②「把顶部的 MathCanvas 一栏中图片的内容放到下面一栏（平面几何、立体几何）的右端」③「把动态粒子效果加入到 MathCanvas 一栏，光标中的文字就是 MathCanvas」。参考仓库 `RegexCore/RegexCore` 的 `assets/typing-intro.svg`（深色渐变底 + 圆角 + 两侧径向微光 + `clipPath` 逐字显示 + 实心方块光标）。

- **右侧属性面板底部的打字终端卡片 —— 后按用户口径整体移除（如实记）**：它最初按"局部嵌入一个科技感卡片"实现（深色圆角 + 极浅内阴影 + 边缘微光 + 扫描线 + feTurbulence 噪点 5%，等宽字体、青色 `>` 提示符、逐字打字、打完才淡入"结果回显"；命令面换成项目自己的 `mathcanvas --workspace planar` / `measure --sources circle-1` / `workspace switch solid --add cube` / `project --views front,top,left,axonometric` / `agent plan`，参考仓库里的个人履历没有照搬）。用户随后给出截图要求"把这个黑色的光标删了"—— 指的是这块**深色卡片**：它在 #F8FAFC 的极简版式里体量偏重、读成一整块黑。因此 `TerminalCard.tsx`、`terminalLines.ts`、`terminalCard.test.tsx` 三个文件与 `global.css` 里约 76 行样式（含 `@keyframes`）一并删除，`PropertiesBar` 不再引用；"打字 + 方块光标"这条视觉语言现在**只属于顶栏品牌**。教训：深色模块"局部嵌入"在浅色极简版式里不能按面积取胜，先给尺寸上限或做成可折叠项。
- **终端卡片的光标按用户口径删除**：①里的"右侧的光标"指属性面板里那个方块光标（同时也是顶栏那个高亮的「用户中心」按钮）。删除后终端卡片只保留逐字展开，方块光标那一条视觉语言**只属于顶栏品牌**。
- **顶栏只剩品牌**：品牌绝对居中（实测中心 791.5 vs 顶栏中心 792，偏差 0.5px），文字带打字动画（3.4s、`steps(9)`）与方块光标；粒子是**确定性纯函数**（`brandParticles`，不用 `Math.random`——否则每次刷新都不一样，"粒子有没有渲染出来"也没法断言），只落在文字两侧留白里（粒子层 `left/right: -46px`），不压字母。`WorkspaceHeader` 因此不再需要任何命令 prop。
- **打字 + 光标的实现方式改过一次（如实记）**：最初把 `clip-path` 放在文字容器上从右侧裁，实测**光标被整块裁掉**（文字 right=837 时可见边界只到 784，光标 x846 落在裁掉的一侧）—— `clip-path` 裁掉的部分不可能再显示光标。改成**动画容器宽度**：`width: 0 → 9ch` 配 `steps(9, jump-none)` 逐字增长、`overflow: hidden` 在容器外沿切断文字，光标 `left: calc(100% + 1px)` 因此永远紧贴可见末尾。逐步采样验证：`gap` 恒为 1px、`typeW` 从 21→83 递增、`opacity` 全程为 1。
- **命令组下沉到标签栏右端**：新增 `WorkspaceTabs` 的 `.workspace-tabs-actions`（搜索框 → 打开/保存 .mgeo → 撤销/重做 → 设置 → 功能区折叠/固定）。按钮的无障碍名字一个都没改，所以既有查询与 e2e 不受影响；窄屏下按"搜索 → 文件命令 → 全保留"的顺序让位。`HeaderIcon` 抽成独立文件（两处都要用）。
- **实测抓到的三个真缺陷**（都不是"看着没问题"就放过）：①`@keyframes` 的时间点选择器**不能用 `var()`**，构建器报 `Expected percentage but found "var("` 并整条丢掉关键帧 → 改成"时机用 `animation-delay` 表达、关键帧只留纯 0→1"；②终端卡片的方块光标 `left: 193.5px` 而 `.terminal-command` 只有 281px 宽，被 `.graphics` 的 `overflow: hidden` 整个裁掉 → 去掉 `overflow: hidden`、标题改单行截断；③光标**恒为透明**（连续采样 `getComputedStyle` 全是 `opacity: 0`）—— 基础规则里的 `opacity: 0` 配上"延迟到打完才开始的闪烁"，等于整个打字期间没有光标 → 改由动画负责初始态、闪烁从"亮"起手，修完实测 `left` 逐字推进 0→70→131→202→255。
- **一次自己造成的假失败（如实记）**：e2e 先报了 21 个失败，看日志像是"标签栏整块没渲染"。诊断脚本（列出全部按钮名与 DOM 计数）证明**渲染完全正常、无控制台错误** —— 真实原因是**我同时跑了两个 Playwright 任务，它们抢同一个预览端口 4173**。单独重跑即全绿。教训：e2e 预览服务是单例，并行跑测试任务会互相污染。
- **门禁（实测）**：单测 **134 文件 / 1562 用例**全部通过；Playwright **115/115** 通过（单独运行）；4 个 workspace 类型检查通过。过程中用临时截图 + DOM 测量脚本核对真实渲染（核对后已删除）。

### 极简主义视觉重构：冷色调 + 微拟物化分层（2026-09-18）

用户口径（完整设计规范）："UI改进。采用极简主义美学，结合现代Material Design元素与微拟物化（Neumorphism）的柔和投影，整体视觉不杂乱、高度清晰。…顶栏居中显示"MathCanvas"品牌字样，下方为间距宽敞的单色极细线性工具图标…左侧对象树（带极简可见性指示器，层级规范，留白充足）；居中为宽阔的绘图区（带有极浅极细的坐标网格线）；右侧为模块化的折叠属性卡片面板。…冷白色背景（#F8FAFC），极浅的灰色（#E2E8F0）用于面板边缘和分割，文字和图标使用深板岩蓝（#2C3E50）。画布上的几何图形使用克制的色彩（直线用深红褐色，圆用板岩蓝）…画布上的数学符号（如 P1, l1, c1）使用优雅的数学衬线字体。"

- **令牌层是这次的杠杆**（`styles/tokens.css`）：文字 `#2C3E50`、次要文字 `#64748B`、背景 `#F8FAFC`、分割 `#E2E8F0`、强调色由紫 `#6C5CE7` 收敛为板岩蓝 `#3D5A80`；阴影改成**大模糊半径 + 低不透明度的冷色投影**（`--shadow-panel/card/sheet`）—— 这就是"微拟物化"的全部要点；新增 `--font-sans`（界面无衬线）与 `--font-math`（Cambria Math → Georgia → 宋体）。
- **画布配色按用户口径重定**（`primitiveStyle.ts`）：直线系深红褐 `#8A4B3C`、圆板岩蓝 `#3D5A80`、点深板岩蓝 `#2F4A68`，其余曲线收敛到克制的冷色族。
- **画布表面转冷**：`--color-graph-*` 从暖灰黄改成极浅冷灰（格线 `#EEF2F7` / `#E2E8F0`、轴 `#CBD5E1`），`GraphicsView` 里两种表面的格线不再分叉；纸纹不透明度 `0.55 → 0.06`、暖棕水印改冷板岩灰（极简版式里它们读成"脏"而不是"质感"）。
- **顶栏品牌居中：中途试错两版，如实记**。①三列 grid（`1fr auto 1fr`）——**实测中线偏左 83px**，因为第一列是空元素，`1fr` 与第三列内容宽度无关，`auto` 列因此不在栏心；②改成绝对定位，又发现品牌是 `.topbar-leading` 的子元素，而那个容器被我整块隐藏了，量出来是 0×0。最终按设计意图**重排 `WorkspaceHeader` 的结构**：品牌成为顶栏的直接子元素（`position: absolute; left: 50%`），模型状态独立成块，命令组靠右。**实测品牌中心 791.5 vs 顶栏中心 792（偏差 0.5px）**。搜索框从"绝对定位在栏心"移回右侧命令组 —— 它原来正占着品牌的位置。
- **同一处教训写了两遍**：`.canvas-card` 在文件更早处写着 `align-self: start`，我的新规则没覆盖它，于是"宽阔的绘图区"没生效。**用 DOM 实测（`getBoundingClientRect`）代替肉眼看截图**才定位到：修完之后 `.canvas-card` 860px、SVG 834px，绘图区宽度 908px。
- **三处"断言了旧配色"的用例按新语义改写**（而不是改实现迁就）：`threeGrid.test.ts`（暖 → 冷）、`exporters.test.ts`（椭圆默认色 → 只钉"有自己的默认色"，并把注释文字的**具体色值**与"不含 `var(--color-`"钉住 —— `.svg` 是独立文件，没有令牌可继承，这也是本轮补的一处真缺陷）、`e2e/three-ui-tokens.spec.ts`（`warmth > 0` → `coolness >= 0`）。`threeGrid.ts` 里硬编码的 3D 栅格色被 e2e 当场抓住漂移，已同步。
- **门禁（实测）**：单测 **132 文件 / 1549 用例**全部通过；Playwright **115/115** 通过；4 个 workspace 类型检查通过；本轮改动文件 ESLint 0 error / 0 warning。过程中用临时截图 + DOM 测量脚本核对过实际渲染（核对后已删除，不留测试噪音）。

### 删除右侧「精确形式」面板（2026-09-18 用户反馈）

用户口径：「**删除右侧的"精确形式"，似乎没什么用**。」

- **删的是展示，不是能力**：`PropertiesBar.tsx` 里那块只读面板（`aria-label="数值转换"`、`data-exact-form-panel`、每行 `data-exact-form-row`）连同**只为它服务**的 `exactFormRows` 计算与两个导入（`exactFormOf`、`measurementMetricLabel`）一起删除；属性栏现在直接以「属性面板」标题开头。文档里的 `measurements`、常驻画布的测量数字、内核的 `exact-forms.ts` 与它的单测**全部保留** —— 用户否决的是那块面板，不是测量能力。
- **RED→GREEN**：先把 `EngineeringInspector.test.tsx` 里三条围着面板转的用例（列出 4π、空状态文案、两/三级容差回读）换成**一条反向用例**：面板与它的行、空状态文案都不再出现，同时 `measurements` 仍在文档里、属性面板入口仍在。改完先跑一次确认它**红**（`expect(queryByLabelText("数值转换")).toBeNull()` 拿到面板元素），删完实现转绿。
- **顺手清掉引用**：`e2e/exact-forms.spec.ts` 原本整份围着面板转，改写成"面板不存在 + 量圆面积照旧可用、读数 `12.566` 常驻画布"——它是唯一走完整路径（画圆 → 改半径 → 量面积）的浏览器用例，删掉整个文件会连这段覆盖一起丢掉。`measurement-labels.spec.ts` 里两条注释仍在解释"过去为什么要收窄查询"，一并改成如实描述。
- **实测**：单测 **132 文件 / 1547 用例**全部通过（比上一轮少 2 条：三条围着面板转的用例合并成一条反向用例）；`PropertiesBar.tsx` 的 ESLint 0 error / 0 warning；类型检查 4 个 workspace 通过；Playwright 全量 **115/115** 通过（`exact-forms.spec.ts` 改写后用例数不变）。

### 顶级双模块骨架 + Agent 交互区（2026-09-18）

用户口径：「请帮我重构当前项目的 UI，主要目标是引入独立的 Agent 交互区。①**将应用主界面拆分为两个顶级模块（请提供清晰的导航切换逻辑，例如左侧边栏菜单）**；②模块 A（传统工作区）作为默认界面，容纳并保留我们现有的功能（包含 CAD、平面几何、立体几何面板）；模块 B（Agent 工作区）参考 DSH 和 Codex 的设计语言，要求界面干净清爽，视觉焦点是一个位于页面中央的对话输入框，支持多行输入，上方预留对话结果和代码输出的展示区。请先帮我搭建好这两个顶级板块的导航框架和空页面结构，然后再重点实现 Agent 区的 CSS 布局。」

- **两级概念分开，不再混用**：`Workspace`（`conics` / `geometry3d` / `cad`）决定"传统工作区里放哪块画布"，新的 `AppModuleId`（`traditional` / `agent`）决定"整个应用的骨架"（有没有 Ribbon、有没有对话区）。两者写在 `shellModules.ts` 里各一张表，默认模块是 `traditional`。
- **导航框架**：最左侧常驻 `ModuleRail`（`nav[aria-label="全局模块"]`），上半是模块切换，下半**只在模块 A 里**列出三个工作区入口。切换逻辑集中在一个 `handleWorkspaceChange`：顶栏标签、左侧模块栏、Agent 区的「返回画布」三个入口共用它，选择 / 创建步骤 / 指引 / 移动端抽屉都按新画布清空。
- **模块 A 一行没动**：`AppChrome`（顶栏 + 标签栏 + Ribbon）与工作台原样包进 `.app-module`；`global.css` 里 27 处 `.app-shell > …` 改为 `.app-module > …`（多包一层之后选择器必须跟着走，否则顶栏高度、浮动 Ribbon 定位、手机端单列版式会一起失效）。浮动 Ribbon 的定位父级因此变成 `.app-module`，`left/right: 0` 不会盖住左侧栏。
- **名字冲突按无障碍规则解决**：侧栏工作区入口与标签栏按钮同名，`getByRole("button", { name: "平面几何" })` 会命中两个元素（单测里 41 个既有用例因此变红）。改法不是改用例，而是给侧栏入口一个不同的无障碍名字（可见文本仍是短名）。
- **同一处坑在浏览器层是另一种形态（如实记）**：单测改完就全绿了，Playwright 却红了 38 个用例——**testing-library 的 `getByRole(name)` 默认完全匹配，而 Playwright 的是子串匹配**，所以「跳转到立体几何」照样命中 `name: "立体几何"`。最终把侧栏入口定为 `跳转到<工作区>`，并同步替换 e2e 与 `App.test.tsx` 里共 **157 处**查询（`name: "平面几何" / "立体几何" / "工程制图"`）。教训：重名按钮的固定名字要按**最宽松的匹配方式**来命名，而不是按当前跑绿的那个测试运行器。
- **模块 B 的三段式版式**（`styles/agent.css`）：会话侧栏（新建 / 切换 / 删除，`localStorage` 持久化）→ 对话结果与**代码输出展示区**（围栏代码单独成栏、等宽字体、语言标签、复制按钮）→ **页面正中**的居中多行输入框。输入区 `width: min(760px, 100%)` + `margin: 0 auto`；Enter 发送 / Shift+Enter 换行，并且**中文输入法组合期间的 Enter 不算发送**（`compositionstart/end` + `isComposing`）。
- **没有接入模型服务，但把在途链路走完**：发送后由 `agentDemoReply`（本地占位、自己声明"尚未接入"）在 320ms 后落屏；期间显示 pending 气泡、发送键变「回复中」并禁用、`role="status"` 播报。接真实服务时只换这一个函数，界面行为不用重写。**这不是 P4 Agent 的落地**：没有任何工具调用、DSL 生成或模型接入，P4 仍在排除范围内。
- **RED→GREEN**：先写失败用例（`agentTranscript.test.ts` 6、`agentStore.test.ts` 6、`shellModules.test.ts` 2、`ModuleRail.test.tsx` 4、`AgentPieces.test.tsx` 4、`AgentWorkspace.test.tsx` 6、`App.test.tsx` 新增 4），其中 3 条一开始是**测试自己写错**：`zustand` 的 `setState` 是浅合并，只换 `conversations` 会让 `activeConversation` 继续指着旧数组里那条对话（用例互相污染）；新建对话插在列表头部，所以"第一个打开按钮"不是想点的那条。两处都按根因改了用例，不是改实现迁就。
- **顺手修掉一个既有缺陷：3D 顶部两排控件重叠**（README「下一步」里第 1 条，此前只是"实测到、没改"）。左侧栏占掉 72px 之后 3D 画布更窄，问题立刻从"点不到"变成"e2e 直接失败"：`getByRole("button", { name: "测量二面角" }).click()` 报 `three-camera-controls ... intercepts pointer events`。根因是左右两排都是绝对定位，画布一窄，左侧那排的按钮就铺到右侧那排身上。修法：`@media (max-width: 1500px)` 下给两排各加 `max-width: calc(50% - var(--space-4))`（两个 `space-4` 就是左右的 `space-3` 内缩加上中间空隙），放不下时**各自换行**而不是横向压过去；判定依据是"半个画布是硬上限"。
- **切换工作区时顺带呼出 Ribbon**：从左侧栏切工作区时，如果 Ribbon 正折着，就把它临时展开（与点击标签栏同一行为）。`ribbon-ui.spec.ts` 正好钉住这一点，也解释了为什么这是**行为对齐**而不是迁就测试。
- **门禁（实测）**：单测 **132 文件 / 1549 用例**全部通过（基线 1517 + 新增 32）；4 个 workspace 类型检查通过；ESLint 对本次新增/改动文件 **0 error / 0 warning**（App.tsx 里 2 条 warning 是改动前就存在的旧项）；`cmd /c npm run build` 真实退出码 **0**，Web 产物成功（CSS 74.36 kB，+6.5 kB 即 agent.css）；Playwright **115/115**（基线 113 + 新增 `e2e/app-modules.spec.ts` 2 个用例）。

### 修复：为什么显示"未识别为精确形式"（2026-09-18 用户反馈）

用户口径：「**为什么会显示"未识别为精确形式"**，我们可以把两个点先确定为分数形式，**如果不能转换为分数就保留两位小数**」。

- **先量根因（一次性探针，跑完即删）**：把"用户真会量出来的值"一个个过一遍，结果是——

  | 值 | 修前 | 说明 |
  | --- | --- | --- |
  | `0.666667`（坐标 `0.333333` ⇒ 长度） | **未识别** | 与 `2/3` 只差 `3.3e-7` |
  | `0.333333` / `1.333333` / `0.142857` | **未识别** | 分别是 `1/3` / `4/3` / `1/7` 的六位小数写法 |
  | `π/6`、`√2`、`√5` | ✓ 正常识别 | 差值 0 |

  所以不是"识别不了分数"，而是**容差太紧**（上一轮定的相对 1e-9）：量出来的值其实是"简单分数的六位小数写法"，按 1e-9 判定就"不是 2/3"。那条"误报比漏报更糟"的纪律本身没错，但它误伤了用户真正需要的那一类。
- **改法（用户选定方案 A：两级容差 + 两位小数兜底）**：
  1. **紧容差**（相对 1e-9）命中 ⇒ 确定的精确形式，文本不带 `≈`，确信度 `exact`（新增字段 `certainty`）；
  2. 不中 ⇒ 按**松容差**再认一次，命中 ⇒ 文本带 `≈`（`≈ 2/3`）、确信度 `approximate`，并如实给出差值；
  3. 两层都不中 ⇒ **保留两位小数**（`≈ 0.64`）——**"未识别为精确形式"这句话彻底消失**。
- **松容差怎么取（第一版错了，如实记）**：我最初按方案写死"相对 1e-4"，实测**太松**：`e` 被认成 `≈ 106/39`（差 3.3e-4）、`π/100` 被认成 `≈ 1/32` —— 这正是"硬凑"，比不认更糟。**改成按"输入自身十进制的半个单位"取**：判据变成"这个差值能不能用『它只是那个精确形式的四舍五入写法』解释"。于是 `0.666667`（6 位小数）容差 `5e-7` ⇒ 认回 `≈ 2/3` ✓；`e`（15 位）容差 `5e-16` ⇒ `106/39` 被拒 ✓；`0.1234567`（7 位）⇒ `1/8` 被拒 ✓。
- **一处测试边界随之明确**：`0.1666665` 与 `1/6` 差 `1.67e-7`，而它自己带 7 位小数（半个单位 `5e-8`）——差得比"写法误差"还大，说明它**本来就不是** `1/6` 的七位小数写法（那个是 `0.1666667`）。这种情况必须落回两位小数（`≈ 0.17`），用例里专门钉住这条边界。
- **RED→GREEN**：四条新用例起初全红（`certainty: undefined`、没有 `≈`、没有两位小数兜底）；修完 13 条全绿。中途我自己写错一条期望（把 `0.1666665` 当成 `1/6` 的写法），被实现按规则拒绝后才发现是**测试**错了，改成 `0.1666667` 并补了上面那条边界用例。
- **门禁（实跑）**：typecheck 4 workspace 通过；单测 **126 文件 / 1517 用例**通过（+6）；lint **0 error / 14 warning**（清掉重构后残留的未用常量，回到基线）；生产构建通过；Playwright **113/113**。

### 无限长切线 + 数值精确形式转换（2026-09-18）

用户口径（两句两件事）：①「**切线长度还要增长一点，最好是无限长**」②「旁边增加一个**数据转换功能**，能够**识别到图中的小数**，并且在功能内输出**分数形式**，**无理数也能输出**，该功能入口在**右侧属性栏最高处**」。设计 `docs/superpowers/specs/2026-09-18-exact-number-conversion-design.md`，计划 `docs/superpowers/plans/2026-09-18-exact-number-conversion.md`；分类上 A（切线）是 bounded、B（转换面板）是新子系统走完整流程。

**A：缺省即无限长**

- **规则不新增字段**：没有显式 `halfLength` 的切线 / 法线 ⇒ 无限长；在属性栏填过半长的仍然被修剪。`halfLength` 只有手填才会出现在文档里，所以**旧文档自动拿到新行为**，不需要迁移、`schemaVersion` 不变。
- **无限长怎么表示**：重算时把 `a/b` 写成 `point ± 10000` 世界单位（沿单位方向）。**刻意不按视口算** —— 视口一变就改文档，缩放会污染脏状态与撤销历史。画布照旧画这条线段、SVG 的 viewBox 自然裁掉画面外部分；**求交采样取同一条长线段**，所以"无限长"在求交上也成立（与其它曲线的交点数因此变多，这是定义使然，已写进功能目录）。函数来源的切线**同样**无限长（教科书里的切线本来就是一条直线）；割线不受影响（它是弦，仍按定义域）。
- **上一轮的 ×1.5 被取代并删除**：`CURVE_TANGENT_LENGTH_FACTOR` 与 `curveTangentHalfLength` 一并删掉，不留死代码；内核 `tangentSegment` 那句"用线段而不是无界直线是刻意的"注释改写为新规则。RED→GREEN 实测：`expected 6 to be greater than 19000` → 转绿。

**B：属性栏最上方的「精确形式」面板**

- **只读测量值**（用户答复"只需要测量值"）：数据直接取 `sceneDocument.measurements`（**不需要新 prop**），不碰图元几何、不改文档、不进撤销历史。
- **四族识别**（内核新模块 `exact-forms.ts`，纯函数）：整数 → 最佳分数（连分数，分母 ≤ 64，复用已有的 bigint `rational`/`rationalToString`）→ π 的有理倍数（分母 ≤ 12）→ 二次无理数 `(a+b√n)/c`。容差取紧（相对 1e-9 + 绝对 1e-12）：**误报比漏报更糟**，`0.1234567` 与 `e` 都如实"未识别"。命中结果带**残差**，面板整块标注"按容差识别"。每行还有复制按钮；无效测量不出行；没有测量时给空状态文案。
- **一处原设计被实测推翻（如实记）**：spec §6 原本写"有界枚举、应为毫秒级"。探针实测**最坏情况 114.9 ms/值**（`e` 这类未识别的值会把约 70 万个候选全扫一遍），对一个每次重渲染都调用的面板完全不可接受。**改成"不枚举 n、而是由 `(a+b√n)/c = input` 反解 `n = ((c·input − a)/b)²`"**，候选量降到约 1.4 万且与 n 范围无关；**改后实测最坏 0.561 ms、命中 0.006 ms**（同一台机器、同一探针，探针跑完即删）。最终是否命中仍由紧容差把关，所以反解步骤里那点相对容差不会造成误报。两次读数都回填进了 spec。
- **RED→GREEN**：`Failed to resolve import "./exact-forms"` → 分层红（`expected { kind: 'unrecognised' } to match { kind: 'pi-multiple' }` / `'√2'`）→ 全绿；面板两条 DOM 用例起初 `Unable to find a label with the text of: 数值转换`。

**e2e 抓到一处真缺陷（这一轮最有价值的收获）**

浏览器用例走到"先量面积、再量周长"时，画布上始终只有 **1** 个测量数字。一次性探针读页面状态才看到 `alert=[measurement is invalid]`：**`packages/scene-graph/src/patches.ts` 里还有第五份度量名白名单**，漏了 `perimeter` / `radius` —— 于是界面上点「周长」被 patch 层拒掉，而 DSL 校验（上一轮已收敛成一张表）是放行的，用户看到的只是"点了没反应"。已改成引用 `@draw/dsl` 的 `MEASUREMENT_METRICS`，并加一条"DSL 允许的每个度量名，`validatePatch` 都必须接受"的用例（新增一个度量名只改一处即可，漏改会红）。**这正是浏览器级门禁的价值：单测和 e2e 单跑都是绿的，只有把整条路径走一遍才暴露出来。**

- **两处测试连带面（如实记）**：新的面板也会在属性栏里显示同一个数值文本，于是 `e2e/measurement-labels.spec.ts` 里两条 `getByText("3.000 u")` / `getByText("1.571 rad")` 从"唯一命中"变成**strict mode violation**（面板那一行也匹配）。断言的本意是"测量卡片的读数"，所以收窄成 `.properties .metric-grid strong`，并在注释里写明原因 —— 不是把面板改丑去迁就旧断言。
- **顺带收敛**：`Measurement3["metric"] → 中文名` 原有**三份**副本（平面画布数字、对象列表、3D 标注），面板本来会成为第四份 —— 已提到 `apps/web/src/measurementLabels.ts` 一处，三处改为引用（3D 那处保留"二面角内角/外角"的说法，靠调用函数而不是查表）。
- **门禁（实跑）**：typecheck 4 workspace 通过；单测 **126 文件 / 1511 用例**通过（+11）；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **113/113**（+1）。

### 由动点引申出来的图元：成为一等图元（2026-09-18）

用户口径（三句，逐字）：①「由动点引申出来的图元（如切线，动圆）**也需要能够反映和其他图元的交点**」②「也需要**具有正常图元的基本功能**」③「同时我们把**切线画长一点点**」。设计 `docs/superpowers/specs/2026-09-18-derived-primitive-intersections-design.md`，切片计划 `docs/superpowers/plans/2026-09-18-derived-primitive-intersections.md`。

**先量、再改（探针实测，探针跑完即删）**

| 现状 | 证据 |
| --- | --- |
| **切线完全不能求交**（不是少，是没有） | 文档里放 直线 / 动圆 / 圆 / 切线，预览枚举出的图元对只有 `line×circle`、`circle×circle` 三个，**切线参与的 = 0** |
| **动圆今天已经能求交** | 动圆就是普通 `circle`（带 `rotationAbout`）：绕定点由 0° 转到 90°，圆心 `(4,0)→(2,2)`，`intersectionSet` 的交点跟着从 `x=5.73/2.27` 变成 `x=0.27/3.73` —— 依赖链本来是通的 |
| **DSL 也拦着** | 用切线当 `intersectionSet` 来源，`validateDocument` 直接报 `intersection set references invalid objects` |
| 「能求交的类型」有 **5 处副本** | kernel 的 `SampledPrimitive` 联合类型 + `samplePrimitive`、dsl 校验、scene-graph 重算取源、web 预览、web 手动建交点 |
| **平面测量只认点** | `planarMeasurementOptions` 要求所选**全是点**，`evaluatePlanarMeasurement` 也把来源逐个变成坐标 ⇒「切线与直线的夹角」「动圆的面积」根本没有入口 |
| 「画长一点」有现成入口 | `TangentPrimitive.halfLength` + 缺省 `curveTangentHalfLength(source)` |

**做了什么**

1. **可求交类型收敛成一张表**（`@draw/dsl` 的 `SAMPLED_PRIMITIVE_TYPES` + `isSampledPrimitiveType`）。放 dsl 而不是内核：依赖方向是 `dsl → kernel → scene-graph → web`，反向会成环。内核的 `SampledPrimitive` 从表**派生**，`samplePrimitive` 加 `never` 穷尽性检查 —— **实测这道防线是有效的**：删掉导函数/积分那一支，`npm run typecheck --workspace @draw/geometry-kernel` 立刻报 `Type 'DerivativePrimitive | IntegralPrimitive' is not assignable to type 'never'`。其余四处副本全部改成引用同一个谓词。
2. **采样规则**：切线 / 法线 / 割线 = 画出来的 `a→b` 那一段（交点必须落在看得见的地方）；导函数 / 积分 = 自带的 `points`（积分只取区域**上边界**）；`status !== "approximate"` 一律不采样（一个算不出来的切线有 `a/b` 残值，拿它求交会凭空造出交点）。
3. **平面测量改实体感知**：`MeasurableEntity = point | line | circle`，按「度量 × 实体种类」分派，归一化判据是"有没有 `kind` 字段"，于是既有的点类分支一个字没改，旧调用点（点表解析器）仍然可用。新增：两条线类的**锐角**夹角 `[0, π/2]`（与三点角度的 `[0, π]` 是两套语义，按钮文案分别写「夹角（两条线）」「角度（第二个点作顶点）」）、点到直线距离、圆的**面积 / 周长 / 半径**。度量名同样收敛成 `MEASUREMENT_METRICS` 一张表（之前校验那边自己抄了一份字面量列表）。
4. **切线的缺省半长 ×1.5**（具名常量 `CURVE_TANGENT_LENGTH_FACTOR`）。**函数来源不乘**：它的半长是定义域半宽，乘了会画到定义域之外。显式 `halfLength` 仍然优先。
5. **`analysisSet` 排除**并写明理由：它只有离散的零点/极值/拐点，没有曲线几何。
6. **不给切线提供"长度"度量**：它的 `a/b` 是绘制参数决定的，量出来是假数字；切线可用的是"与另一条线的夹角"与"点到它的距离"。

**RED→GREEN（每一片都有真实失败输出）**

| 片 | 红的时候实跑看到什么 |
| --- | --- |
| dsl 表 + 放行新来源 | 新用例起初连模块都 import 不到（`Failed to resolve import "./sampledTypes"`），实现前是同一条用例报 `intersection set references invalid objects` |
| 内核采样 | `expected [] to have a length of 1 but got +0`（切线×圆）、`expected [] to have a length of 2 but got +0`（割线/导函数/积分×圆） |
| 预览 / 手动建交点 / 持久化重算 | 预览：`expected false to be true`；持久化：把 scene-graph 的门槛退回旧名单后，`scene-store.test.ts` 里"切线被动点驱动"那条在**第 872 行**失败（交点数 1 → 0） |
| 内核测量实体化 | 五个新组合全红，最典型的是 `expected 'insufficient-data' to be 'degenerate'`（圆根本没被当成来源） |
| 度量名 + 周长/半径 | `measurement metric is invalid: m-1`、`m-2`；补上表之后 typecheck 一次性点出**五处** `Record<Measurement3["metric"], string>` 读数名缺键（类型系统替我找全了要改的地方） |
| 界面选项 / 画布数字 / 重算解析器 | 选项：`expected [] to deeply equal [ 'angle' ]`；画布数字：`expected [] to deeply equal [ '面积：28.274u²', '周长：18.850u' ]`；重算：把解析器退回点表 ⇒ `expected undefined to be close to 1.5707…` |
| 切线 ×1.5 | `expected 4 to be close to 6` |

**浏览器级证据（`e2e/planar-derived-intersections.spec.ts`）**：画圆 → 在圆上建切线 → 建一条水平线 → 画布出现交点 → 选中切线与直线量「夹角（两条线）」（读 `角度：1.571rad`）→ 选中圆量「面积」（读 `面积：12.566u²`），两条数字都常驻画布。

- **一处我自己先写错的测试（如实记）**：这条 e2e 最初把直线放在 `y=1`，那时"画布上有交点"其实由**圆×直线**满足 —— 把切线从共享表里临时删掉，用例**照样通过**。改成 `y=2.5`（穿过切线、不穿过圆，半径 2）之后，同样的删除操作让它红在 `Expected: not "0"  Received: "0"`。测试要通过这种"把被测对象拿掉"的对照才算数。
- **顺手修掉一处仓库缺陷**：`packages/geometry-kernel/src/dynamic-measurements.test.ts` 里有一个**非法 UTF-8 字节**（`E2 80 3F`，本该是破折号 `E2 80 94` 的第三个字节被写坏，多半是更早某轮用 PowerShell 改文本留下的）。严格 UTF-8 解码器（包括本会话的文件工具）拒绝打开它；按字节原位修好，diff 只有一个字符。这条正好印证仓库纪律里"不要用 PowerShell 文本管道改源码"。
- **门禁（实跑）**：typecheck 4 workspace 通过；单测 **125 文件 / 1500 用例**通过（+12：采样 3、透视/重算 2、测量 6、切线段 1）；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **112/112**（+1）。

### 修复：轨道上的动点连不出直线 + 拖动时看不到点走到哪（2026-09-17）

用户原话（两句，各是一个独立缺陷）："**圆轨道上的动点无法与定点建立直线连接**，还有一个很重要的，**动点移动的动画没有了**，就是动点移动的时候我只能看到在拖动但是拖到哪里了根本不知道，直到松手才能看到位置"。

**缺陷 1：绑在圆轨道上的动点让后续所有"新建"失效。**
- **根因**：`packages/dsl/src/schema.ts` 里 `point3` 的 `onHost` 宿主白名单只有 `["line3","segment3","ray3","edge3"]`。上一轮把 `circle3` 做成**通用一维宿主**（`Host3`，参数就是圆周角）时改了内核与界面，漏了这个白名单。
- **后果比"这条绑定不合法"大得多**：校验是**整份文档**级别的，而 `addPrimitive` 写入前要过它——于是只要轨道上有一个动点，**之后加点 / 建线 / 建面全部被拒**（实测报 `point3 host binding is invalid`）。所以用户要的"动点与定点连线"不是根本没这个功能，而是被这一句话挡死。
- **RED→GREEN**：`packages/dsl/src/point3HostBindings.test.ts` 新增"circle track 可以像其它一维宿主一样被绑定"；`apps/web/src/App.test.tsx` 新增"点绑到圆轨道之后仍然能继续加点和线"（RED 实跑 `expected [...] to have a length of 4 but got 3`）→ 白名单补上 `circle3` 后转绿。

**缺陷 2：拖动绑定点时画面不跟手，松手才"跳"过去。**
- **先量、再改（一次性探针，跑完即删）**：拖一个绑在圆轨道上的点，读数显示约束链路**完全正常**——`data-drag-parameter` 从 `3.1416` 一路走到 `3.5743`、`data-host-residual` 恒为 `0.000000`、这一拖动内重画了 **6 帧**；但同一段拖动里三个点标注的屏幕位置是 `624,381|562,412|686,412`，**一个字都没动**（`changed: false`），抬手后才跳到正确位置（到圆心距离 = 半径 2）。
- **根因（一行）**：`refreshPrimitiveObject` 是**按文档里的图元**重建的，而"拖动中"的新坐标只写进了内存里的 `points` 表（文档抬手才提交）。`createPoint3Mesh` 读的是 `primitive.position`，于是重建出来的球仍在**旧坐标**上；点标注投的正是这个球（`pointLabels.ts`），所以"字母不动"与"点手柄不动"是同一件事。
- **修法**：`buildPointDrivenObject` 里 `point3` 画在 `points` 表给的坐标上（表里没有这个点时才退回文档坐标，不把点画到别处去）。整场同步在开头就是按文档重建 `points` 的，两者恒等，所以**整场同步的结果一个字不变**。
- **同一个根因的第二个症状（顺手修掉）**：拖**半径手柄**时，绑在轨道上的"乘客点"也是同样地不动——`applyTrackRadiusPreview` 同样是"写 `points` + 同一套重建"。现在它也实时跟着新半径走。
- **RED→GREEN（两处，都是真实失败输出）**：
  - `e2e/three-orbit-tracks.spec.ts` 新增"手还没松，那个点就必须已经在动"：用手柄的标注位置度量，修前实跑 `Expected: > 4  Received: 0`（0 像素），修后通过。
  - 同文件再加一条**原样复刻用户动作**的浏览器用例"动点 + 定点 ⇒ 空间直线"：轨道 → 动点绑上去 → 选动点与定点 → 点「由选中点创建空间直线」。把白名单那句临时改回去实跑，得到 `Error: expect(locator).toBeVisible() failed … element(s) not found`（**直线根本没建出来**，正是用户报的现象）；改回来转绿。
  - `e2e/three-orbit-track-handles.spec.ts` 把原来只断言"抬手后坐标对"补成"**拖动期间**乘客点已在往外走"：修前实跑同样是 `Expected: > 4  Received: 0`（临时把修复撤掉跑出来的真实红），修后通过。这条用例的注释本来就写着"跟着到新圆周上……而不是等抬手才跳过去"，但断言只覆盖了抬手之后——**注释比测试更严格**，这次把测试补齐。
  - 单测 `apps/web/src/threeScene.test.ts` 加一条：重建时按 `points` 表的坐标画，表里没有则退回文档坐标。
- **与 2026-09-18 那一轮合并（诚实记录）**：我这条提交在推送时被远端拒绝（远端已有另一端推上来的切线一轮 `af78ce5` + `66ea9de`），改用 rebase 接在它后面；冲突只在**本文件的头部两行**，取远端版本后把我的新章节插回来。
- **合并后跑门禁，抓到切线一轮留下的一个回归（不是我这边的，但由我修）**：`af78ce5` 重排平面画布那个 `<svg>` 标签时**把 `data-measurement-labels` 读数删掉了**（`git show af78ce5 -- apps/web/src/components/GraphicsView.tsx` 里这个属性只出现在 `-` 行）。功能本身没坏——Playwright 失败现场的无障碍快照里画布上确实有 `长度：3.000u`，**坏的只是那条读数**，而 `e2e/measurement-labels.spec.ts` 正是按它断言的：实跑 `Expected: "1"  Received: ""`（连跑两次都稳定复现；合并前这条用例是过的）。已把读数补回，用例转绿。这正是"上一轮自己文档里写明**Playwright 本轮未运行**"的代价——浏览器级门禁一跑就露出来了。
- **门禁（合并后实跑）**：typecheck 4 workspace 通过；单测 **124 文件 / 1480 用例**全部通过；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **111/111**。
- **门禁瑕疵已修（vitest 3.x 自身缺陷，升级到 4.x 根治）**：合并后 `npx vitest run` 会报 **1 个 unhandled error** —— `[vitest-worker]: Timeout calling "onTaskUpdate"`，命令**退码 1 而 1480 条用例 0 失败**（实测连跑 3 次都复现；加 `--maxWorkers=2` 则退码 0）。
  - **根因（先查、再改，不是猜）**：读 `node_modules/vitest` 打进来的 birpc 源码，`const DEFAULT_TIMEOUT = 6e4` —— 主进程与工作进程之间那条 RPC 有**写死的 60 秒超时**，且**与 `testTimeout` 无关**。用 JSON reporter 量了 124 个文件的耗时：`App.test.tsx` 单文件占住一个工作进程 **25.8 秒**（第二名 0.7 秒），而整场 `environment` 累计约 2500 秒（jsdom 每文件 ~20 秒，31 个工作进程抢 32 个逻辑核）。所以只要某个工作进程被同步代码卡住够久，心跳计时器照样触发 —— 超时是**假阳性**，不是测试慢。
  - **上游口径（本次按用户要求调研了上游）**：这是 vitest 3.x 的已知缺陷，上游 PR [`vitest-dev/vitest#8297`](https://github.com/vitest-dev/vitest/pull/8297)「prevent rpc timeout on slow thread blocking synchronous methods」修掉，4.0.0-beta.4 起可用；另有仓库把「升级 3.x → 4.x」直接当作该 flake 的修复（如 [`IntersectMBO/evolution-sdk#176`](https://github.com/IntersectMBO/evolution-sdk/issues/176)）。**结论：不该用限并发去掩盖，该升级运行器。**
  - **改法**：`vitest` `^3.2.4` → **`^4.1.11`**（只动 devDependency；根 `package.json` 与 `package-lock.json`）。选 4.x 而不是 5.x：上游文档的修复目标是 4.x，且 5.0.1 当时才发布两天。
  - **验证（实跑）**：升级前同一条命令**连跑 3 次全失败**；升级后 **连跑 3 次全绿**（1480/1480、退码 0、无 unhandled error），**并额外在「Playwright 同时跑」的负载下再跑一次**（这正是最初触发它的场景）同样 0 error、退码 0。门禁其余部分不变：typecheck 4 workspace 通过、lint 0 error/14 warning、生产构建通过、Playwright 111/111。

### 修复：四类模板的默认落点（2026-09-17）

同一条反馈的后半句"**图有点怪**"量出来是四套互相矛盾的默认落点（参数在 `apps/web/src/App.tsx`）：

| 图元 | 改前 | z 范围 | 相对地面 z=0 |
| --- | --- | --- | --- |
| 立方体 | `origin (-2,-2,-1)`、`size 4×4×2` | [−1, 1] | **一半埋在地面下**（中心在原点） |
| 棱锥 | `baseCenter (-2,0,-2)`、`height 4` | [−2, 2] | **一半埋在地面下**（中心在原点） |
| 圆柱 | `center (3,0,0)`、`height 3` | [0, 3] | 躺在地面上 |
| 圆锥 | `center (-3,0,3)`、`height 3` | [3, 6] | **悬空 3 格** |

而且立方体与棱锥的水平足迹**本来就相交**（x ∈ [−2,0]）——先后添加两个会直接穿在一起。用户选定"**四个都坐在地面上，并水平错开**"。

- **改后**：立方体 `origin (-7,3,0)`、棱锥 `baseCenter (5,5,0)`、圆柱 `center (5,-5,0)`、圆锥 `center (-5,-5,0)`——四个象限各一个（中心距原点 ±5），底面都在 `z = 0`，两两间隙 ≥ 1，原点正好落在它们中间。**只影响新建实体**，已有文档一个字都不动。
- **RED→GREEN**：新增单测断言的是**性质**而不是坐标——"每个模板的底面都在 z=0、整体不低于地面"且"四个水平足迹两两不重叠"；改前实跑得到 `expected -1 to be close to +0`（立方体底面在地面下 1 格），改后转绿。
- **一处可见行为变化（如实记）**：新默认落点不在初始取景范围内，所以**新建一个实体时会触发一次自动取景**（用户马上能看到它），`data-camera-fit` 因此多计一次。`e2e/geometry3d-autofit.spec.ts` 原来写死"计数恰好是 1"，现改成"内容确实回到视野内"（这是该用例真正要守的），计数只做下界检查。
- **测试连带面（11 处，全部是"写死了旧默认位置"）**：4 个 e2e 文件（`geometry3d-section` ×5、`geometry3d-drag`、`geometry3d.spec` 的顶点拾取与相机视点、`three-canvas-size`）+ 3 个 App 单测（物化顶点重算、截面环坐标、实体内夹取）。处理原则是**把这些用例依赖的几何显式钉住**（或在用例内自己设好三个坐标），而不是跟着默认值改期望——它们测的是剖切 / 拾取 / 夹取，不该跟着模板默认落点漂。`geometry3d.spec.ts` 里那个写死 NDC 命中点的老写法也顺手换成"用实时相机读数投影交线上的一点"（原来的注释自己就抱怨过取景不一致）。
- **两处如实记录的观察（都不在本轮范围，没有改）**：
  1. **绑到「实体内」的点可能正好落在模板物化出来的顶点上**，于是拾取命中的是那个"不能单独拖动"的生成顶点（实测 `data-drag-target` 报 `point:cube-1-point-6`、`data-drag-parameter` 为 null）。触发条件：默认空间点在原点、而实体落在别处 ⇒ "离它最近的体内点"是包围盒的角。工作区里 `e2e/geometry3d-host-drag.spec.ts` 原本就**不是**在测这个（它的注释一直写"绑定到一条棱"），已改成真的绑棱 + 宿主参数 0.5（棱的中点，不与任何顶点重合）。
  2. **严格在实体内部的点从外面点不到**（指针射线先打到实体表面：实测 `data-drag-target` 报 `face:cube-1-face-10`）——所以把体内参数设到 0.5/0.5/0.5（正中心）之后反而抓不住。旧默认下这条路径没被覆盖是因为当时"实体内"绑定会把点**夹到表面**（实测位置 `(0,0,1)`）。是否要让"实体内的点"优先于实体表面被拾取，是拾取优先级的设计问题，留给下一轮定。
- **门禁（实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1431 用例**通过（+1）；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **109/109**。

### 修复：坐标轴必须钉在世界原点（2026-09-17）

用户反馈："**你的立体几何内容好像原点位置错了，图有点怪**"。

- **根因（实测，不是推测）**：坐标轴被搬到了**栅格中心**，而栅格中心 = 吸附到整格的相机视点中心。用一次性探针把内容挪到 (8,8)（自动取景把视点中心带到 (10,10)）后：真正的世界原点投影在屏幕 `(614, 209)`，坐标轴被画在 `(10, 10, 0)`、投影在 `(614, 400)`——**相差 191 像素**。坐标轴是"零点在哪"的标记，它一跑，整个坐标系就读错了。
- **是我自己引入的回归**：`git log -S` 指到 `0ab4c37`（"pin the grid to whole units"）——那一轮为了让栅格盖住远离原点的内容，把栅格挪到内容中心，顺手把 `axesHelper.position.set(...)` 也一起加上了。栅格跟着内容走是对的（覆盖范围要够，而且它的线仍落在整数世界坐标上），**坐标轴跟着走是错的**。
- **修法**：删掉那一行位置设置（坐标轴只缩放、不挪），并新增读数 `data-axes-origin` 把"坐标轴对象的世界位置"交出来，让这条不变量可断言。
- **RED→GREEN**：先只加读数、不修位置，新用例 `e2e/three-origin-marker.spec.ts` 实跑得到 `Expected: "0.000,0.000,0.000"  Received: "10.000,10.000,0.000"`（真实的错值）；删掉那行后转绿。用例同时断言**栅格中心确实跟着内容走到 (10,10)**（保证这条用例不是空跑）与**坐标轴仍是 0,0,0**。
- **门禁（实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1430 用例**通过；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **109/109**（+1）。

### 轨道圆改成独立对象：点在圆上，不在圆跟着点（2026-09-17 已完成）

用户口径（对上一轮交付的直接否定）："**轨道圆的内容做的很差，根本不是我要的那种，我要的轨道圆是点在圆上而不是圆跟着点走，而且圆要可以缩放旋转**"。设计与切片见 `docs/superpowers/specs/2026-09-17-orbit-track-independent-circle-design.md` 与 `docs/superpowers/plans/2026-09-17-orbit-track-independent-circle.md`。

**根因是数据模型选错了主从**：`Circle3Primitive` 存的是 `centerId: string`（引用一个点当圆心），于是圆是那个点的派生物。改动前用一次性探针实测（探针跑完即删，不进仓库）：

| 现象 | 实测证据 |
| --- | --- |
| 圆跟着点走 | 拖圆心点：点坐标 X `0 → -0.9588`，同时轨道「圆心 X」= `-0.959`；检查器页脚自己写着"圆心跟着那个空间点走" |
| 圆心点删不掉 | 删除该点得到 `object is referenced by another object: point3-1` |
| 画布上不能缩放 | 从圆周往外拖 70px，半径稳定在 `3`；同一时刻 `data-rotation-handles = 3`（环有、缩放手柄无） |

- **切片 1（圆自带圆心：模型 + 全部调用点 + 旧文档迁移）已完成**：`centerId: string` → `center: Vector3`，`circle3` 从"点驱动对象"改判为"自带几何的对象"。
  - **内核**：`conic3FromCircle3(primitive)` **不再需要点表**（签名里那个参数整个删掉）；`host3FromPrimitive` 的 `circle3` 分支直接读图元自己的 `center`，宿主的域 / `closedU` / 退化拒绝都不变（`circleHost3(center, normal, radius)` 签名本来就是坐标圆心）。**顺手补上一个真缺陷**：`circleConic3` 为渲染稳健会把**零法向**兜成 `+z`，于是"法向为零的圆"会被解析成一条凭空朝 +z 的圆——自己的新用例 `expected { kind: 'circle', … } to be null` 抓到了它，现在 `conic3FromCircle3` 显式挡住零法向（与 `circleHost3` 同一条口径：解析层不替用户编朝向）。
  - **迁移（在 `validateDocument` 之前）**：`codec.ts` 新增 `withCircleTrackCenter`，与既有的 `withSectionClassification` 同形；引用的点不存在时**只丢掉那一条轨道**（宁可少一条，也不能让整份文件打不开）。`.mgeo` 的 `schemaVersion` 仍是 `"0.1"`，加载与 localStorage 草稿恢复两条路都走 `decodeMgeo`，所以只改一处。**幂等**有单测。
  - **场景图**：`managedPointIds` 不再返回 `[centerId]`；`isFreeDraggable3` 把 `circle3` 挪到"自带几何"那一类；`translatePrimitive3` 平移它自己的 `center`；`rotatePrimitive3` 给它单独一支（转 `normal`，默认枢轴就是它自己的圆心，所以绕自己转时圆心不动）；`primitiveDependencies` 去掉圆心依赖；`patches.ts` 的 `isReferenced` 删掉 `circle3.centerId` 那条引用保护 ⇒ **圆心点从此可以随便删**。
  - **画布与检查器**：`createCircle3Line` 不再需要点表；`projectionVisuals`（工程图投影）读 `primitive.center`，那条"圆心点缺失"的诊断随之删掉；检查器的 `圆心 X/Y/Z` 从只读读数改成**可编辑的真实字段**（写新增的 `center3` 补丁，与圆柱 / 圆锥同名同义），并删掉"圆心跟着那个空间点走"那句；创建入口改成"**取一次坐标就脱钩**"，指引文案同步说明。
  - **RED→GREEN / 证据（三条都是真跑出来的失败）**：`Invalid geometry document: circle3 geometry is invalid`（迁移还没写 ⇒ **旧文件会打不开**，这正是我担心的那条风险）；`expected false to be true`（平移 / 旋转对轨道返回 `changed: false`）；`Cannot read properties of null (reading 'center')`（`rotationHandleGeometry` 对轨道返回 `null` ⇒ **三个旋转环会静默消失**，这条用例就是专门守它的）。实现后 **1427 用例全绿**。
  - **浏览器级证据**：新用例 `e2e/three-orbit-track-independent.spec.ts` 两条——①拖**圆本体**之后两个点的坐标**逐字未变**，而圆心读数已经变了（"点在圆上，不是圆跟着点走"的两半都断言了）；②检查器把圆心 X 改成 4 生效，然后**删掉当初定圆心的那个点**：点没了、轨道还在、圆心仍是 4、半径仍是 1.5。
  - **一处自己犯的流程错误（如实记）**：改 `patches.test.ts` 的夹具时我图快用了 PowerShell 文本替换，把文件里的中文注释写成了乱码（`Set-Content` 那一步编码没对齐）。立刻 `git checkout --` 还原，改用编辑工具重做同样的两处改动。仓库纪律里"不要走 PowerShell 文本管道"这条是有原因的。
  - **门禁（切片 1 后实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1427 用例**通过（+6）；lint **0 error / 14 warning**（基线；新 e2e 起初多出一条 `'scene' is assigned a value but never used`，已清）；生产构建通过；Playwright **105/105**（+2）。
- **切片 2（画布半径手柄：缩放）已完成**：选中恰好一个轨道圆时，圆周上出现一个**半径手柄**（小球 + 从圆心到它的虚线半径），拖着它改半径。
  - **手柄位置 = 宿主参数 0**：用 `circleHost3(center, normal, radius).evaluate({ u: 0 })` 取，于是"手柄在哪"与"绑上去的动点参数 0 在哪"是同一个点（两者共用同一套帧），不需要第二份基。**顺带纠正一处我自己的错误认知**：`circleHost3` 的帧是它自己的基，法向 +z 时参数 0 落在 **−y** 而不是 +x——我第一版 e2e 就是按 +x 去抓的，抓了个空。现在画布把 `data-track-handle`（手柄世界坐标）交出来，测试不猜。
  - **缩放数学**（纯函数、可单测）：`trackRadiusAt` 把指针射线与**圆所在的平面**求交，半径 = 交点到圆心的距离，下限 **0.01**（与属性栏输入框一致，零半径是退化图形）。**视线与平面平行（正对着圆看）时不猜，返回 `null`**。
  - **顺手修掉一个真的鲁棒性缺陷**：three 的 `Ray.intersectPlane` 在"射线与平面平行**且共面**"时返回的是**射线原点**（`distanceToPlane` 对共面情形返回 0）——实测"相机正好落在圆所在平面里"时会读出一个等于相机距离的假半径（**10** 而不是 `null`）。自己的用例 `expected 10 to be null` 抓到它之后，`trackRadiusAt` 与上一轮的 `rotationAngleAt`（同一个模式、同样的洞）都改成**自己显式挡平行**，两条都补了断言。
  - **拖动期间不改文档**（一次拖动 = 一步撤销）：画面由预览负责——①圆按预览半径重建 ②**绑在圆上的点**用同一个 `circleHost3(…, 预览半径)` 按当前宿主参数重算坐标并重建（所以拖半径时点始终贴在新圆周上，不会等抬手才跳）③手柄移到新圆周、虚线半径跟着重画 ④三色环按 `rotationHandleRadius` 的比例整体缩放（比例用构建时的轨道半径算，避免逐帧累积）。抬手先**清预览**再提交一次 `updatePrimitive { radius3 }`；**半径真的变了才提交**。
  - **优先级**：半径手柄 > 三色环 > 平移/选择（手柄压在圆周上、更具体，与"点 > 棱 > 面 > 线"同一套哲学）；两个手柄都**不需要先开「自由拖动」**，而拖圆本体平移仍受那个开关管辖。
  - **读数**：`data-track-radius`（拖动期间给预览值 ⇒ e2e 能断言"拖着的时候半径已经变了"）、`data-track-handle`（手柄世界坐标）、`data-track-radius-frames`（缩放拖动重画帧数）。
  - **RED→GREEN / 证据**：`(0 , circleRadiusHandlePoint) is not a function` / `(0 , trackRadiusAt) is not a function` / `(0 , createTrackRadiusHandle) is not a function` 先红；随后 `expected 10 to be null` 抓到上面那个平行/共面的洞。浏览器新用例 `e2e/three-orbit-track-handles.spec.ts` 两条：①抓手柄往外拉——**拖动中**读数已从 3 变大、抬手后属性栏与文档一致、绑在圆上的点 C 到圆心距离 = 新半径（残差极小）、一次 Ctrl+Z 回到 3；②在圆心附近按下拖（那里没有手柄）⇒ 半径**一字不动**。截图人工看过：手柄小球 + 虚线半径 + 三色环都在选中时出现。
  - **门禁（切片 2 后实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1430 用例**通过（+3）；lint **0 error / 14 warning**（基线；`createTrackRadiusHandle` 起初带了个没用的 `tolerance` 参数，已删）；生产构建通过；Playwright **107/107**（+2）。
  - **一处如实记下的既有观感问题（不在本轮范围）**：轨道圆本身是 `THREE.Line` 的 1px 描边，在暖色纸面上偏细（A1 就记过的"按像素描边要换 `Line2`"那条限制）。这不是本轮引入的，也没有因为本轮变差。
- **切片 3（文档收尾）已完成**：spec 与本计划的状态行改成"已交付"；`project-progress` / `feature-catalog` / README 三处按切片补完（README 的验证基线更新为 **1430 用例 / 108 个浏览器用例**）。**补上最后一块验证缺口**：轨道圆的**旋转**此前只有单测（`turns a circle track's normal without moving its centre`），浏览器层没有；新增一条 e2e "拖 X 环把轨道摆斜"——`data-rotation-handles` 仍为 3（它不再拥有点，环的几何按自己的圆心与半径算）、法向 `+Z → −Y`、**圆心三个字段都是 0**、一次 Ctrl+Z 回到水平。

### 轨道圆这一轮的最终交付（对应用户两句话）

| 用户口径 | 现在什么样 | 证据 |
| --- | --- | --- |
| "点在圆上而不是圆跟着点走" | 圆**自带圆心坐标**（不引用任何点）：拖圆本体移动的是它自己，拖点 / 改点 / 删点都不影响轨道；点绑上去只沿圆周滑动 | 单测 3 条（平移 / 旋转 / 删点）+ e2e 2 条（拖圆后两点坐标逐字未变；删掉圆心点轨道仍在） |
| "圆要可以缩放旋转" | 选中轨道时圆周上有**半径手柄**（拖着缩放，拖动中圆与绑定点一起走、抬手一步撤销）、三色环（世界轴旋转） | e2e 3 条（拖手柄：拖动中读数已变 + 绑定点落在新圆周 + 一步撤销；没抓手柄时半径不动；拖 X 环转 90° 且圆心不动） |
| 旧文件不能坏 | 加载时在校验**之前**把 `centerId` 搬成 `center`，幂等；悬空引用只丢那一条轨道 | 单测 2 条（迁移 + 幂等 / 悬空） |

**门禁（本轮收尾实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1430 用例**通过；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **108/108**。

### 立体几何最后一轮：约束轨道 / 拖动旋转 / 测量数字 / UI 对齐（2026-09-17 全部完成）

用户口径："对于立体，我们再做最后一步优化"——四件事：①可旋转可平移的**平面图元**（只要圆与多边形）当**约束轨道**；②给立体图形**拖动旋转**（"我想要一个横着的圆柱"，也能在属性栏填 90°）；③**测量数值常驻画布**（平面几何与立体几何都要）；④**立体几何 UI 参照平面几何**。设计与切片见 `docs/superpowers/specs/2026-09-17-3d-tracks-rotation-and-measurement-labels-design.md` 与 `docs/superpowers/plans/2026-09-17-3d-tracks-rotation-and-measurement-labels.md`（提交 `27d37b8`）。**一处按建议调整并获用户确认**：旋转手柄用**世界轴三色环**（X 红 / Y 绿 / Z 蓝）而不是"屏幕法向 / 水平 / 竖直"，理由是拖红环就是"X = 90°"、与属性栏三个角度字段一一对应。

- **切片 1（圆轨道宿主，内核）已完成**：`hosts3.ts` 新增 `circleHost3(center, normal, radius)`——**一维闭合宿主**（域 `u ∈ [0, 2π]` + `closedU: true`，参数用既有的 `normalizeAzimuth` 折回，拖过整圈不会无限增长）；帧**直接复用解析圆那一套**（`circleConic3` → `frameThroughPoint`，与 `planeFrame3` 同约定），于是"宿主参数 0"与"圆上参数 0"是同一个点——宿主参数、圆上读数、法向输入框说的是同一件事；`Host3Kind` 加 `"circle"`；`host3FromPrimitive` 补 `circle3` 分支（圆心从点表解析，缺失 → `null`）。**退化如实拒绝**：零法向 / 半径非正或非有限 → `null`（`circleConic3` 为渲染稳健会把零法向兜成 +z，宿主不这么兜——那等于替用户编一个朝向）。
  - **RED→GREEN**：4 条新用例先全部因 `TypeError: (0 , circleHost3) is not a function` 失败；实现后 25/25 通过（内核 474 用例）。
  - **变异检查**（执行后还原）：把 `closestParameter` 的 `normalizeAzimuth` 去掉 ⇒ 两条用例报 `expected -1.883… to be close to 4.4`、`expected -1.383… to be close to 4.9`（差恰好 2π）——证明"折回 `[0, 2π)`"这条断言不是空的。
  - **一处自己的测试写错并已修正**：最初按**世界 xy 角度**（3π/2）断言参数值，而宿主帧是它自己的基（法向 +z 时参数 0 落在 y 负方向）——改成断言"参数 0 就是 `conic3PointAt(circleConic3(...), 0)` 那个点"，并把"宿主参数与解析圆参数逐点重合"单独立一条用例。
- **切片 2（圆轨道图元落地）已完成**：轨迹从"内核能当宿主"接到"用户建得出来、绑得上去、拖得动"。
  - **场景图**：`managedPointIds` 加 `circle3 → [centerId]`、`isFreeDraggable3` 允许 `circle3`（平移圆 = 移动圆心那个点，圆自己不存坐标副本）；`radius3` 补丁扩展到 `circle3`（校验与圆柱 / 圆锥同一套："正数、有限"，别的图元借这个字段会被拒并说明）。
  - **顺手修掉一处真缺陷（两份清单漂移）**：允许改几何的图元类型在**校验**（`patches.ts`）与**应用**（`operations.ts`）里各写了一份，`circle3` 只加进一份 ⇒ 实测 `validatePatch` 说 valid、`commitPatch` 却报 `object is not editable`（最难受的那种失败）。现在抽成 `EDITABLE_GEOMETRY_TYPES` 单一来源，两处共用（注释里写明为什么）。
  - **创建入口**：Ribbon 立体几何新增「添加空间圆轨道」——选 1 个空间点 = 圆心（法向 +Z、半径默认 1.5）、2 个点 = 圆心 + 圆周点（半径 = 两点距离）、3 个点 = 三点定平面（法向 = 三点平面法向）。**三点共线 / 两点重合如实拒绝并说明**（`planeThroughPoints` 返回 null 就不猜），绝不退回 +Z 假装成功。`point3ToolAvailability` 增 `circle`（1–3 个点；超过 3 个不给入口，因为那没有唯一的圆），指引文案同步。
  - **能当轨道**：`pointHostOptions` 把 `circle3` 列进一维宿主（标签写「圆轨道」），选中点 → 宿主下拉 → 拖它就沿圆周滑动。
  - **检查器**：新增「空间圆轨道」块——半径可改（写 `radius3`）、圆心名字与坐标读数、法向读数；并说明"圆心跟着那个空间点走"。
  - **RED→GREEN / 证据**：`operations.test.ts` 的"平移圆轨道"先报 `expected false to be true`；`patches.test.ts` 的半径补丁先失败（并暴露了上面那处两份清单漂移）；`pointHostOptions.test.ts` 的"圆轨道条目"先失败；浏览器新用例 `e2e/three-orbit-tracks.spec.ts`：两个点建出半径 3 的轨道 → 下拉里选中「圆轨道」→ 拖点（`data-host-residual ≈ 0`、参数落在 `[0, 2π)`）→ 抬手后点到圆心距离仍精确等于 3。
  - **门禁（切片 2 后实跑）**：typecheck 4 workspace 通过；单测 **118 文件 / 1380 用例**通过（+5）；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **95/95**（+1）。
- **切片 3（`rotatePrimitive3`：绕世界轴转一个空间对象）已完成**：拖动旋转与属性栏角度**共用同一个域操作**，一次旋转 = 一次操作 = 一步撤销。
  - **单一真源 `rotation3d.ts`（内核）**：`eulerRotationMatrix3`（X→Y→Z，`R = Rz·Ry·Rx`，行主序）、`axisRotationMatrix3`、`applyRotationMatrix3`、`multiplyRotationMatrix3`、`rotateVectorAboutAxis3`、`rotatePointAboutAxis3`、`eulerFromRotationMatrix3`、`composeEuler3`。**顺手消掉一处两份实现**：A1 的 `quadrics.ts` 里那份私有 `rotationMatrix` 删掉、改用它（"读数说转了 90°、画面却没转"这类不一致的根就是矩阵约定各写一份）。万向锁（`y = ±90°`）单独一支并**如实记在函数的注释里**：`x` 与 `z` 只以 `x ∓ z` 的组合出现，取 `z = 0`，旋转本身分毫不差、只是表示不唯一。
  - **域操作**：`{ op: "rotatePrimitive3", id, axis: "x"|"y"|"z", degrees, pivot? }`。**枢轴缺省 = 它拥有的点的形心**（面的重心、线段中点、圆轨道的圆心），所以"绕自己转"永远不用调用方先算一次中心；给 `pivot` 时对象才绕着那个世界点公转。点驱动对象转的是它拥有的点，**并且**把存在文档里的朝向向量一起转过去（`circle3.normal`、`pointNormal` 平面的法向、`pointDirection` 直线的方向）——漏掉哪个，哪个就会"读数转了、画面还指着原来那边"；面的法向不在这里，它是从点算出来的、点转它自然转。模板实体只写欧拉角 `composeEuler3(旧朝向, axis, θ)`（`R_axis · R_euler`，与 `buildSolidTemplate` 同源），带 `pivot` 时连锚点一起挪（`templateSolidPivot` 从内核导出，属主中心只有这一处定义）。
  - **边界与校验（`patches.ts` 写入前拦下）**：轴名非法 → `rotation axis is invalid`；角度非有限 → `rotation angle must be finite`；枢轴非有限向量 → `rotation pivot must be finite`；孤立 `point3` → `object has no orientation to rotate`（转一个点绕它自己等于没转，如实拒绝而不是静默不动）；物化拓扑 / 绑定的点 / 锁定对象一律拒绝（与"能不能拖"同一套边界，`isRotatable3` 复用 `isFreeDraggable3`）。
  - **检查器「朝向」**：空间面与圆轨道**没有存欧拉角**（面朝向由点算、圆轨道存的是法向），所以这里不能像模板实体那样把三个角绑到字段上——那样输入框会永远读回 0、用户以为没生效。改成"选轴 + 填角度 + 应用"的**相对**旋转（每应用一次一步撤销），下面是实时读数（当前法向 + 与 +Z 夹角，`data-object-orientation`）。法向读数与"点在不在面内"的判定共用内核 `polygonNormal3`（Newell，从 `closedFacePlanes3` 里抽出来导出，不再各写一份）。
  - **RED→GREEN / 证据**：`operations.test.ts` 新增 9 条（圆轨道圆心不动 / 法向转 90° / 半径不变；空间面形心不动 / 边长一字不差 / 法向转过 90°；`pointNormal` 平面的法向跟着转；点驱动直线两端点跟着转；模板实体写欧拉角、物化顶点跟过来、与 `composeEuler3` 矩阵等价、给枢轴时中心真的绕过去、拒绝退化输入、一次撤销）先全部失败（`expected 1 to be close to +0`、`(0, templateSolidPivot) is not a function`、`expected { valid: true } to deeply equal { valid: false, … }` 等 10 条），实现后 **231/231** 通过；`patches.test.ts` 的 7 条校验断言同批红转绿；`App.test.tsx` 新增"检查器里转圆轨道、一步撤销"；`hosts3.test.ts` 新增 `polygonNormal3` 2 条（斜环单位法向 + 绕向反向 + 退化拒绝）。
  - **一处自己的测试写错并已修正**：断言模板实体的物化顶点按"绕原点"转过 90°（`after.y ≈ -before.z`），实际是绕**实体中心** `(0,0,2)` 转（`after.y ≈ 2 - before.z`）——实现是对的、断言是错的；改成断言真实几何事实"竖直的轴躺成 −Y 方向"（顶环落到 `y = -2, z = 2`）。
  - **门禁（切片 3 后实跑）**：typecheck 4 workspace 通过；单测 **119 文件 / 1399 用例**通过（+19）；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **95/95**。
- **切片 4（画布旋转手柄：世界轴三色环 + 拖动 + 15° 吸附）已完成**：选中**恰好一个**可转对象（模板实体 / 空间面 / 圆轨道）时，画布上出现三个环（X 红 / Y 绿 / Z 蓝，与世界坐标轴同一套颜色），拖哪个环就是绕哪根世界轴转。
  - **环的几处刻意选择**（都写在 `createRotationHandles` 的注释里）：环**不挂** `primitiveId`（不是图元，按 id 遍历的偏移 / 临时旋转必须跳过它们）；`excludeFromFit`（手柄不该撑大自动取景）；`depthTest: false` + 高 `renderOrder`（被实体挡住的那半圈也要看得见、抓得到——只画一半用户根本不知道能往那边拖）；环的平面与轴垂直。
  - **命中与优先级**：`pointerdown` 先对**三个环**做射线求交（不管挡在前面的实体，这是三维软件的惯例），命中才开旋转会话；**不需要先开「自由拖动」**——用户抓住了那个环，意图没有第二种解释，也免得"能转"这件事又藏起来。没命中环就完全不改行为（仍走选择 / 平移 / 转视角）。
  - **角度语义与属性栏同一套**：`rotationAngleAt` 把指针射线与**过枢轴、以该轴为法向**的平面求交，取交点在平面内的极角；参考基按右手循环取（X 用 (ŷ,ẑ)、Y 用 (ẑ,x̂)、Z 用 (x̂,ŷ)，`v = axis × u`），所以"把 ŷ 转到 ẑ"就是绕 X 的 **+90°**——与 `composeEuler3` 的右手法则一致，拖动的方向与读数不会相反。跨 ±π 用**最短弧**（拖过整圈不会突然倒退一整圈）。
  - **吸附**：按**累计值**量化到 15°（不是每步增量各自量化，否则误差一路累积），按住 **Alt** 不量化。拖动期间用 `applyRotationSkew` 画**临时旋转**（与平移共用"只落在最外层"的规则：组 + 子对象同 id 时各转一次就会转两倍角度，这条坑平移踩过）；抬手**先撤销临时旋转再提交**，否则提交后重建的场景会再转一次。**没有真正转过（吸附回 0°）就不提交**——一次误触不该多出一步撤销。
  - **顺手补的一处观感**：平移拖动时环的**位置**跟着图形走（环的**朝向**不变——它是世界轴的参照），否则拖着拖着环留在原地、实体自己走了。
  - **读数**：`data-rotation-handles`（环数）、`data-rotation-handle-pivot` / `data-rotation-handle-radius`（环心与半径，e2e 用它算出"环上某个世界点"再拖，不写死像素）、拖动期间 `data-rotation-axis` / `data-rotation-degrees` / `data-rotation-frames`。
  - **RED→GREEN / 证据**：新单测文件 `apps/web/src/threeRotation.test.ts`（13 条）先全部因 `(0 , rotationHandleGeometry) is not a function` 等失败，实现后全绿；浏览器新用例 `e2e/three-rotation-handle.spec.ts` 四条——①拖 X 环到 90°，`data-rotation-degrees` 读 **90.00**、属性栏「绕 X 轴旋转角度」= **90**、Y/Z 仍为 0，一次 Ctrl+Z 回到 0；②按住 Alt 时读数精确落在 **−25°**（吸附开着会变 −30°，所以这一条真的在分辨"有没有量化"）；③在画布空白处按下不产生旋转（`data-rotation-axis` 为空、朝向仍为 0）；④多选两个对象时环收起（`data-rotation-handles` = 0）。
  - **两处自己的测试写错并已修正（都是真问题）**：①抓取点原本取"环上 ±Y 那一点"，而 X 环与 Z 环**正好在 ±Y 处相交**——从那里按下时"抓住的是哪个环"取决于深度排序，实测同一段脚本一会儿给 x、一会儿给 z；改成取 45° 处（只有 X 环经过），命中唯一。②断言"`data-camera-distance` 一定会变"是错的：滚轮缩放是**异步**的，改成 `expect.poll` 等它变。
  - **门禁（切片 4 后实跑）**：typecheck 4 workspace 通过；单测 **120 文件 / 1412 用例**通过（+13）；lint **0 error / 14 warning**（基线；新用例最初多出一条 `'Page' is defined but never used` 的 warning，已去掉未用导入）；生产构建通过；Playwright **99/99**（+4）。
- **切片 5（测量数字常驻画布：2D + 3D）已完成**：不用选中任何对象，有效测量的数值就画在图上。
  - **3D**：测量数字的过滤条件从"来源被选中"改成"**有效且值有限**"。这条规则仍在 `resolveMeasurementVisual` 那一层（退化 / 数据不足 / 值非有限一律 `null`），并抽成纯函数 `measurementVisualsForDocument(document)`——**它压根没有选择参数**，所以"常驻"不是靠调用方记得别过滤。**辅助线段与二面角标记仍按选中显示**（那是引导线，几十条一起铺会把画布刷满），标签在选中时加 `data-selected` 高亮（数字常驻之后"我选中的是哪一条"必须还看得出）。读数 `data-measurement-labels`（旧的 `data-measurement-label-count` 保留）。
  - **2D**：新增纯函数模块 `apps/web/src/planarMeasurementVisuals.ts`——文本与右侧属性栏**同一份**（`值 + 单位`，3 位小数，一个测量只有一个数），位置按度量类型算：长度 = 两点中点；距离 = **垂足与第三点的中点**（两点情形就是两点中点）；角度 = 顶点沿**角平分线**外偏一点（不压在顶点、也不压住某条边；平角时角平分线退化，改取该边的法向）；面积 = 三个来源点的**形心**。位置算不出来（点重合 / 直线退化）或状态不是 `valid`、来源点缺失 → **不产出**（不猜位置、不画假数字）。`GraphicsView` 用 `<text class="planar-measurement-label">` 渲染，白描边 halo 叠在曲线上也读得清，`pointer-events: none` 让拾取行为一字不变；画布 `data-measurement-labels` 给出条数。
  - **RED→GREEN / 证据**：3D 侧 `measurementVisuals.test.ts` 新增"不选中任何对象也要有标签、退化一个都不画"（`measurementVisualsForDocument` 没有选择参数就是这条断言的证据）；2D 侧新文件 `planarMeasurementVisuals.test.ts` 7 条（四类位置 + 缺失来源 / 退化 / 值缺失不产出 + 选中高亮）；浏览器新用例 `e2e/measurement-labels.spec.ts` 两条——平面画布建出长度 3 的数字（位置落在两点中点对应的屏幕区间）→ **点空白清空选择** → 数字仍在 → 改一个点的 X 后数字实时变成 5.000；3D 画布同一条路径（距离 3.000u）并断言属性栏是同一个数。
  - **2D 模块的 RED 落空，改用变异实验补证（如实记录）**：这次模块与用例是一起写的，第一次跑就 7/7 全绿，没有"先红"。于是做了两次变异并还原：①把距离的"垂足中点"换成"第三个点自己" ⇒ 两条用例报 `expected 3 to be close to 1.5`、`expected { x: 5, y: 5 } to be null`；②把 `status !== "valid"` 这道门去掉 ⇒ 报 `expected '长度：0.000u' to be null`。两条断言都真的有分辨力。
  - **一处测试自己的错并已修正**：平面用例最初直接"连点两次添加点"，而新建的点都落在**同一处**——两个重合点的长度是**退化**的（内核如实报 degenerate），于是没有任何数字可画。改成先把两个点摆到 (0,0) 与 (3,0)。另一个坑：功能区每点一次命令就自动收起，第二次点「添加点」会命中收起状态下的另一份节点（`strict mode violation`），改成先「固定功能区」并在功能区范围内取按钮。
  - **当时如实记下的一处不一致（随后按用户决定解决，见本节末的「角的单位统一」）**：平面角的 `value` 存的是**弧度**、单位 "rad"（内核 `evaluatePlanarMeasurement` 的约定），所以 2D 画布上的角度数字与属性栏一样是 `1.571rad`；3D 的角度存的是**度**、单位 "°"。两边各自自洽（画布与属性栏永远同一个数），但没有统一——**这一轮先记在案，随后用户拍板"改成弧度"，两边就统一到弧度了**。
  - **门禁（切片 5 后实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1420 用例**通过（+8）；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **101/101**（+2）。
- **切片 6（立体几何的 UI 令牌与平面几何对齐）已完成**：只换视觉、不动布局（e2e 依赖现有位置与分组）。
  - **同一套令牌**：三维外壳加上 `data-canvas-surface="graph-paper"`——与平面画布**同名**，于是纸底色 / 内沿暖色投影 / 纸纹 / 右上角水印 / 控件样式直接复用平面那一套 CSS 规则，而不是各写一份"看起来差不多"的颜色。立体几何的画布是 WebGL canvas，所以"纸"由外壳与 `.three-render-target` 提供；水印用 `∴`（立体几何的记号）而不是平面的 `∑`。纸纹强度与平面同级（同一个 `--paper-grain-opacity`）。
  - **底色只有一个真源**：`scene.background` 改成 `null`（渲染器本来就是 `alpha: true`），让画布**透出** CSS 那层纸。原先 three.js 里那份 `#fbfcff` 与 CSS 令牌是**两个真源**，一开始就是这么漂的——现在删掉那份 JS 副本（连 `scenePalette` 常量一起删干净）。
  - **栅格换暖色**：`GRID_MINOR_COLOR` / `GRID_MAJOR_COLOR` 改成与 `--color-graph-grid-minor/major` **逐字相同**的 `#e8dfc2` / `#d5c79f`。three.js 读不到 CSS 变量，颜色只能各写一份，所以把"两端同源"钉成两道守卫：`threeGrid.test.ts` 断言这组值与令牌注释一致（并断言暖色 = 红分量 > 蓝分量），浏览器侧新增读数 `data-grid-colors`，e2e 拿它与 `getComputedStyle` 读到的令牌值**逐字比对**。
  - **一处按理由偏离计划**：计划写"`GridHelper` / `AxesHelper` 颜色都换成暖色常量"，实际**只换栅格、保留坐标轴的 X 红 / Y 绿 / Z 蓝**。理由：坐标轴的三色是**语义**（拖哪个旋转环就是绕哪个世界轴，见切片 4），改成暖灰会让"轴的颜色"与"环的颜色"从此对不上；平面几何的轴本来也没有这三色的语义（它画的是单一 `--color-graph-axis` 灰）。以截图为准的观感验收里，暖纸 + 暖格线 + 三色轴正好是"草稿纸上的立体图"该有的样子。
  - **视觉验收（截图对照，人工看过）**：`build-check/paper-planar.png` 与 `paper-spatial.png` 两张对照——同一张暖纸、同一套暖格线、右上角各自的水印；立体几何那张同时能看到三色旋转环与三色轴。截图核对过即认为观感达标（纸纹在两者上都属"很淡"一级）。
  - **顺手修掉一条真实的 e2e 抖动（有证据）**：全量跑出现 1 条 `toHaveAttribute` 失败，用 `--reporter=json` 抓到身份与真因——`three-intersection-previews.spec.ts` 的"从拐点建交点、从交线建交线"里，指针落在**面5**而不是**线**，失败读数带着 `data-camera-fit="2"`：**自动取景是动画、且会在文档变化后再次触发**，而"投影世界点 → 移动指针 → 断言"这段时间相机还在动，细目标（一条交线）就漂到旁边的面片上了（`--repeat-each=3` 约 1/9 复现）。修法：该夹具先**关掉自动取景**再重置视角（相机会被固定住），并加 `settleCamera` 等"连续两次相机读数完全一致"再投影。
  - **记下一条既有布局缺陷（不在本轮范围）**：窄一点的画布上，「显示控制」那一排的最后一个按钮（**自动取景**）会被「视角控制」那一排的第一个按钮（**自由拖动**）盖住——实测 `locator.click()` 被拦截（`subtree intercepts pointer events`），748px 宽的截图里 `自动取景` 也确实看不见。这是**切片 6 之前就存在**的（切片 6 不动布局），本轮只让 e2e 绕开它（DOM 派发点击，与 `geometry3d-drag.spec.ts` 里既有的同款注释一致）。**建议下一轮处理**：两排控件在窄画布下需要换行或收进一个"更多"菜单。
  - **门禁（切片 6 后实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1421 用例**通过（+1）；lint **0 error / 14 warning**（基线；新写的 e2e 起初多出 `'green' is assigned a value but never used` 与 `scenePalette` 未使用两条 warning，都已清掉）；生产构建通过；Playwright **102/102**（+1），其中被修的那条抖动用例 `--repeat-each=4` **12/12** 通过。
- **角的单位统一到弧度（2026-09-17 收尾后追加，用户决定："改成弧度"）已完成**：切片 5 记下的那处不一致（平面角是弧度、立体角的度）按用户的选择**统一到弧度**，两边从此是同一个数、同一个单位。
  - **改在哪**：`packages/geometry-kernel/src/measurements3d.ts` 两处产出——`measureAngle3` 不再 `× 180/π`、单位 `"rad"`；二面角同样换成弧度、单位 `"rad"`。**没有**去动 `markers3d` 的 `interiorDegrees` / `exteriorDegrees` 与 `dihedralAngleDegrees`：那是几何层的原始量（标记绘制的弧本来就用弧度算，这两个字段只是它按度给的一份视图，绘制与它自己的单测都按度读），换算只是一次精确的线性变换，不引入第二份真值。
  - **同一次改动里的一个必须一起改的地方**：二面角的 `explanation` 原先复用 `detail.explanation`（那段文字写着"内角为 120.000°"）。读数改成 2.094 而解释里还写 120.000°，同一个测量卡里两个数就会互相打脸——所以说明文字改成由 `measurements3d` 自己按弧度拼（`内角为 2.094 rad，外角（补角）为 1.047 rad`），并加断言 `explanation` 必须含 `rad` 且**不含 `°`**。
  - **显示层不用改**：画布标签与属性栏都印 `value + unit`（一个测量只有一个数），所以 3D 画布与检查器自动跟着变成 `角度：1.571rad` / `二面角内角：2.094rad`；导出（CSV/JSON）跟着一起变。
  - **RED→GREEN / 证据**：`measurements3d.test.ts` 先把断言改成弧度（`value: Math.PI/2, unit: "rad"`；二面角 `2π/3` 与 `π/3`），实跑得到 `expected { id: 'angle-1', …(8) } to match object { metric: 'angle', …(3) }` 与 `expected 120.00000000000001 to be close to 2.0943951023931953, received difference is 117.90560489760682` —— 两条真实失败；实现后全绿。画布层新增浏览器用例 `e2e/measurement-labels.spec.ts` 的第三条：三点 A(0,0,0) / B(3,0,0) / C(3,3,0)（顶点 = 第二个点 B，BA ⊥ BC）建角度测量 ⇒ 画布标签 `角度：1.571rad`、属性栏 `1.571 rad`；平面侧也补了文本断言 `角度：1.571rad`，两边同形。
  - **仍然按度显示、且是刻意的**：属性栏那些**输入**（「绕 X 轴旋转角度」、剖切面 ±15°、旋转环 15° 吸附）与 3D 的「测量二面角」演示卡（`二面角：90.0°`，那是坐标轴夹角的示例、不是测量）保持度——用户这次说的是**测量单位**，把输入框也改成弧度会让"填 90 度"变成"填 1.571"。
  - **门禁（本次追加后实跑）**：typecheck 4 workspace 通过；单测 **121 文件 / 1421 用例**通过；lint **0 error / 14 warning**（基线）；生产构建通过；Playwright **103/103**（+1）。

### 解析二次曲面与真圆（A1）+ 交面分组与真曲面（A2）（2026-09-17 全部完成）

用户三条原话串起这一整条线："**我不要一个逼近的圆，我需要一个真的圆，这个曲面的相交太难受了**" → "**重要的问题还在交面上，圆柱和立方体交面会被切成很多个片，这样很不合理**" → "**曲面交面相当乱，交出一大堆面，但是无法获取那个曲面**" → "**我需要的只是那个相交的曲面，但是在我们的图里面，相交那个曲面是由很多三角形拼出来的**"。

**A1（8 片，已交付）**：内核新增解析层 `packages/geometry-kernel/src/quadrics.ts`（对称 4×4 二次型、`PᵀQP` 平面∩二次曲面、圆锥曲线分类与规范化：`δ = B²−4AC` / `Δ = det` 不变量表，先系统归一化再按 `1e-12` 相对容差判圆）与 `section-quadric.ts`（把圆锥曲线裁剪到有限实体的端面之间，输出"曲线弧 + 端面弦"的**片段环** `CurvePiece3`）。DSL 只加可选字段（`section.exact`、`intersectionFace.exactLoops` 等），`polyhedron3` 契约不动、旧文档照常打开。画布按**屏幕误差**细分真曲线（`conicSampling.ts`：`0.5px × 世界单位每像素`，容差按 2 的幂滞回）——圆柱上下底 / 圆锥底圆、截面边界、`circle3` 空间圆都成了真曲线，放大时点变多而不是把 48 段的棱一起放大；读数、测量（`πr²`/`πab` 精确 vs 网格求和如实标注）、工程图真椭圆投影、SVG `<ellipse>`、框选解析判定全部适配。**两处与计划的差异已在 spec 记录**：描边用 `THREE.Line` 而非 `Line2`；圆柱 / 圆锥的**解析展开**延后（多边形版与解析版宽度差 0.07%）。**A1 收尾由用户选定**（"就此收尾 A1"）。

**A2（5 轮，已交付）**：

1. **第 1 轮：按支撑曲面分组**。实测立方体 ∩ 圆柱（48 段）= **50 片**交面（2 个圆盘 + 48 个侧面小四边形，法向两两不同 ⇒ "合并共面片"一片都减不掉）。新增内核 `intersection-surfaces.ts` 的 `mergeIntersectionSurfaces3`：同平面合并成一个外环（取消成对反向的内部有向边再串环），顶点都落在同一张圆柱 / 圆锥方程上的并成一个**曲面区域**并输出**解析片段环**，其余如实逐个保留。**50 片 → 3 个区域**（侧带面积 50.2296 标 `areaExact: false`，比真值 2πRh′ 偏小 0.071%）。
2. **第 2 轮：创建路径接上分组**。曲面区域的 `points` 改成整条带的闭合多边形（外环 + 其余环按外环绕向反走、接缝走真实母线），`recomputeIntersectionFace` 改为按区域认领并写 `points / normal / area / areaExact / exactLoops`，派生字段在算不出时**摘掉旧值**；检查器给"面积精度"（闭式精确 / 数值近似）。顺带修掉 `buildSolidQuadric` 在**未旋转分支直接返回局部矩阵**、没把曲面搬到 `center` 的真缺陷（实测默认圆柱 `center=(3,0,0)` 的曲面点残差 21 而非 0，平面切出来的圆心算成 `(0,0,1)` 而不是 `(3,0,1)`）。
3. **第 3 轮：把这条带子画对**。新增 `outerRingLength`（前导外环顶点数）⇒ 填充按**环向条带**三角化而不是从 `points[0]` 扇形铺开（扇形会把两圈之间的洞整块填掉）；交面边界在带 `exactLoops` 时**真的**交给真曲线渲染（此前那个字段从没被读过、边界一直是 96 段弦）；整圈闭曲线片段改用闭式段数公式（实测 40 段 vs 二分给的 64 段）；预览不再把曲面区域的 96 个网格顶点全标成"交点"。**浏览器级证据**：新增 `e2e/three-intersection-band.spec.ts` + 夹具 `cube-cylinder.mgeo`（50→3、点侧带建出整条带、`data-exact-curves` 1→2、放大后细分变多）。
4. **第 4 轮：曲面 ∩ 曲面**。圆柱 ∩ 圆锥（同底同高）此前 **49 片**（48 个侧面三角形 + 1 个底面圆盘）。两条根因：`radiusAt` 的 `ratio > 0` 把**锥尖**（`ratio` 恰为 0、半径本来就是 0、顶点在曲面上）判成"不在曲面上"；锥尖在轴上、`atan2(0,0)` 没有意义，按所有顶点量张角会把 7.5° 的侧面片量成 93°…116°。改成 `ratio >= 0` + 张角只按**离开轴**的顶点量 ⇒ **49 片 → 2 个区域**；再补 `poleIndex`（极点 = 曲面内部、不在边界环上的那个顶点）让填充**绕极点铺开**（否则"圆锥面"会被填成底面圆盘、形心还与底面圆盘区域重合，点它认领到的还是那张圆盘）。**浏览器级证据**：`e2e/three-intersection-cone.spec.ts` + 夹具 `cylinder-cone.mgeo`。
5. **第 5 轮：曲面画成光滑曲面**。区域的**填充**仍是 48 段网格面片（默认取景有竖条纹、放大后侧影是多边形）。内核把**解析曲面本身**交出去（`surface = { kind, origin, axis, radius, height }`），渲染方按屏幕误差把每片均分成 `n × n`、用 `snapToSurface` 把新顶点**吸回真正的曲面**（圆柱径向恒定、圆锥随高度线性收缩；`n ≈ √(弦高/容差)`，整块区域同一个 `n` 以免 T 形接缝），容差档进签名 ⇒ 缩放跨档才重建。**读数 `data-face-triangles`**：锥面 48 → 放大后 432、侧带 96 → 864（e2e 断言放大后涨 3 倍以上）。

**同日三个用户实测缺陷（都已修、都有变异实验）**：① **自由拖动圆锥 / 圆柱时底部圆单独跑掉**——边界圆那份对象是"组 + 每圈线"两层挂同一个 `primitiveId`，拖动偏移按 id 遍历 ⇒ 各加一次、圆以**两倍**位移飞出；改成偏移只画在**最外层**，并把"画面与位移是否一致"写成读数 `data-drag-offset-drift`（修前 1.1732、修后 0.0000）。② **拖动时点标注不跟手**——点手柄跟着临时偏移走了，但那层 HTML 字母标注是按**文档坐标**投影的（拖动期间文档不提交）⇒ 实体走了、字母留在原地；改成投影**画面上那个对象**的世界位置（`apps/web/src/pointLabels.ts`，纯函数可单测）。③ 上面的 A2 第 4 轮（曲面 ∩ 曲面拿不到曲面）。

**门禁（最后一次全量实跑）**：`typecheck` 4 个 workspace 通过；单测 **118 文件 / 1369 用例**通过；`lint` **0 error / 14 warning**（与基线一致）；Web 生产构建通过；Playwright **94/94**（连续三次）。**如实记录**：其中一次全量跑出现过一条 `toHaveAttribute` 失败（93/94），未留下用例名、随后三次均未复现，按"未复现的偶发"记着。

### 平面几何切线 + 动点扩展（2026-09-18 已完成）

**需求（用户原话）**：

1. 「现在实现平面几何的切线功能。逻辑是：创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项是创建一条在这个曲线上的切线。曲线包括抛物线，双曲线，圆，椭圆」
2. 「现在需要对动点功能进行拓展，动点在轨道上能够在动点位置画切线，同时切线能根据动点位置进行动态变化，第二动点能够作为圆心作圆，圆的半径能够调节，也能够根据动点位置进行动态变化」

**设计文档**：`docs/superpowers/specs/2026-09-18-planar-curve-tangents-design.md`。核心是三个判断：

1. **"切在哪"原本没有真值**。旧 `tangent` 图元只有函数来源加一个横坐标 `x`；圆锥曲线的自然参数（角度 / 轴向参数）与切点横坐标不是一回事，用 `x` 兼作参数是一个**会静默切错地方**的歧义（圆上参数 1.0 的切点是 `(r·cos1, r·sin1)`，而横坐标 1.0 对应两个完全不同的切点）。因此新增 `TangentAnchor`：要么是曲线自然参数，要么是**一个点图元的引用**（后者正是"切线随动点走"的载体）。函数来源的旧切线**不带** `anchor`，旧文档逐位不变；非函数来源**强制**要求它。
2. **切线会竖直**。圆的左右顶点切线斜率是无穷大，`y = kx + b` 在那里直接坏掉。切线几何因此换成**点 + 单位方向**（`constraintTangentAt`），竖直由 `vertical` 单独表达。切点严格由 `evaluate(参数)` 求出、不从切向积分回去 —— 后者会累积漂移、切点慢慢离开曲线。
3. **`center` / `radius` 降级为派生缓存**。圆的 `centerPointId`（圆心就是这个点）与 `radiusFrom`（半径 = 圆心到那个点的距离 × 倍率）让两个点图元成为真值，于是渲染、求交、测量、导出**一行都不用改** —— "圆过那个动点"对它们就是一个普通的圆。

**内核**：复用**已经存在**的解析 `PlanarConstraint.tangent(parameter, branch)`（圆、圆弧、椭圆、双曲线、抛物线、函数图像、隐式曲线各自都有实现），本轮**没有新增任何切线公式**，只是把它接出来并补上"点 + 单位方向"这个更诚实的表示。

**随后按用户四次现场反馈修正**（都是这一轮内发生的）：

1. 「谁让你在中间写这种的，把中间的文字去掉（就是"从这三件事开始"）」→ 删掉空白画布上的那行标题。**这一行不是本轮加的**，它来自上一个提交 `a74959b`；已按用户要求移除。
2. 「四个快捷按钮和下面那一句…也去掉啊……」→ 连四个快捷按钮与那句提示**整块**删掉。`runQuickStart`（画布快捷按钮转发到功能区命令）失去唯一调用者，一并删除；`global.css` 里 5 条 `.canvas-empty-hint*` 规则同时成为死代码，也清掉。功能区那四个按钮照旧工作。
3. 「切线不能在曲线上自由拖动」→ 两个根因：① 画布上切线那一组**只有 `onClick`、根本没有 `onPointerDown`**，指针按下时拖动从不成立；② 就算起拖，平移一条**算出来的**切线本来就是空操作。现在按定位方式分三种语义（曲线参数 → 改 `anchor.parameter`；跟随动点 → 位移转给那个动点；函数来源旧切线 → 横向位移加到 `x`），并记一个**按下偏移**避免切点一按下就瞬移到指针脚下。
4. 「平面画布中的线都太粗了，点也还是过大，变小」→ 图元线宽 3 → 1.5（选中 5 → 2.5）、点半径 4 → 2.5，以及一批标记与坐标轴按比例收细。**命中区一律不动** —— 那决定的是"点不点得中"，不是"看起来多大"。

### UI 优化：功能可见性 + 草稿纸画布 + 字号与简约装饰（2026-09-17 已完成）

**需求（用户原话）**：「现在来优化UI，我们很多功能藏得很深，用户很难发现，你需要让一些功能明显一些。然后UI看着有一股廉价的气息，你让平面几何区的画布变成有淡淡的黄色的"草稿纸的质感"，整体的UI边框的字体略微调大，做一些简约的装饰，比如一些数学符号。整体简约风」。

**三件事分别落在哪里**：

1. **功能可见性 —— 用"空白画布"当入口**。用户一定会看到空白画布，而此前它只有一句"点击图元查看属性"。现在它在纸中间给出**四个可点的起点**（放一个点 / 画一个圆 / 画一条直线 / 画一个函数）＋一句"先放一个点，再点右侧「创建动圆」，曲线就绕着那个定点转"。
   - 四个按钮走的是**功能区同一条路**（`runRibbonCommand`）：从画布点一下与从功能区点一下永远是同一个行为，不会变成两套实现。
   - 按钮文案与功能区**刻意不同名**（功能区是"添加点 / 添加圆"）。原因有二：屏幕上同时出现两个同名按钮，用户分不清；而且"按名字找按钮"的查询（含无障碍工具、我们自己的 e2e）会命中两个元素 —— 这一点是被 e2e 打回来才发现的（4 条量画布尺寸的用例因 `strict mode violation` 变红）。
   - 有内容时这一行自动消失，不挡画布。
2. **草稿纸质感（平面几何）**：纸底色 `#fdfbf3`（比面板暖、比白纸略黄），格线换成暖灰黄（`--color-graph-grid-minor/major`），卡片内沿加一圈极淡暖色投影，工作台背景也跟着暖一点，纸右上角一枚极淡的 `∑` 水印。
   - 只有 `data-canvas-surface="graph-paper"` 命中时才换色 —— **立体几何与工程制图仍是原来的冷色工作台**（用户只说了"平面几何区"）。
   - SVG 内部（底与格线）用行内属性、卡片与控制条那层用 CSS，两处读**同一组** `--color-graph-*` 令牌。
   - 第一版格线定得太浅（`#ece5cd`），截图上看几乎等于没有格子 —— 草稿纸的质感主要就来自那一层方格，于是加深到 `#e8dfc2` / `#d5c79f`。**这一处是靠截图发现的，不是靠读代码**。
3. **字号与装饰**：新增 `--font-ui / --font-ui-sm / --font-ui-lg` 三个令牌，把功能区、状态栏、检查器、对象列表那一圈"边框文字"整体调大一档；画布内的几何标注**不动**（那是图形的一部分，跟着纸面比例走）。分区标题前加一枚浅色数学符号（面板 `π`、检查器 `∠`），只加在标题上 —— 装饰一多就又廉价了。

**验证**：全量单测 **112 文件 / 1275 用例通过**；Playwright **89 用例全通过**；`typecheck` 通过；`lint` 0 error / 14 warning；构建通过。视觉部分用 Playwright 截图逐个确认（空白画布、有内容画布、把提示区单独截出来放大看文字是否发虚）—— 那段"重影"最后确认只是截图缩放造成的观感，实际渲染是干净的。

> **后续变更（2026-09-18）**：上面第 1 条那个"空白画布给出四个可点的起点 + 一句提示"**已按用户要求整块删除**（先删标题，再删按钮与提示）。理由与实现见本文件 2026-09-18 那一节；功能区的四个按钮未受影响。

**续：磨砂质感（用户口径："画布增加一点磨砂质感"）**

- **做法**：`feTurbulence` 程序生成细噪点（`components/PaperTexture.tsx` 里的 `#paper-grain` 滤镜，不占体积、不必随主题换图），CSS 把它铺在每个表面的一层**伪元素**上。
- **一个必须避开的坑**：**不能**把 `filter: url(#paper-grain)` 直接加在 `.canvas-card` 上 —— `filter` 会把整棵子树的渲染结果一起处理，网格与图形会被糊掉。所以纹理走独立的 `::before` 绘制层（`background: #fff; filter: …; mix-blend-mode: multiply`），图形照旧锐利。
- **强度是量出来的，不是调出来的**：截图后用像素直方图核对 —— 纸面色集中在 `L=249–251`、网格线在 `L=231–243`（两者清晰分开，说明没糊），只在"纸面那一簇"上算得幅度 **±2.7 个亮度级**。这个量级刚好是"看得见的哑光"，再强就会让网格线变得可疑。
- 范围：平面几何的纸面稍明显（`opacity 0.7`），两侧面板与状态栏更淡（`0.4 / 0.35`）—— 面板只是"同一种材质"，不该抢内容。立体几何 / 工程制图**不带**纸纹（实测 `data-canvas-surface` 为 `none`）。

**续：平面几何元素选颜色（用户口径："增加让平面几何的元素可以让用户选择不同颜色的功能"）**

功能本来就在（检查器里两个原生取色框），但用户提出来就说明它不好用。逐条查下来是三个问题，都处理了：

1. **控件太不起眼**：原来只有两个窄窄的原生取色框。现在每个颜色字段是**一排可点的色板**（线条 10 色、填充 10 色）＋保留原生的自定义取色框（完整能力不丢）。当前颜色有外圈高亮；"当前是自定义色"时不硬点一格最接近的。
2. **多选时改色只作用于主选中对象**（真缺陷：用户以为全改了，其实没有）。新增 `setPrimitivesStyle` 批量操作（`packages/scene-graph`，含与单条同样严格的校验），多选面板加「批量线条颜色 / 批量填充颜色」——**一次提交改完整批、撤销只要一步**（用版本号只加一来钉住）。
3. **填充没有出口**：填充色板加了「**无填充**」（画成斜杠格：它是一个状态、不是一个颜色）。同时把填充字段的出现条件从一串图元类型清单改成 `supportsFill()`——点与交点的填充恒等于自身线条色（见 `fillFor`），给它们独立的填充色没有意义。

新增 `apps/web/src/palette.ts`（色板 + `normalizeColour` / `paletteValueOf` / `isActiveColour` / `supportsFill`）与 `ColourField` 组件。

**一处顺带查出的可访问性问题（值得记下来）**：给色块/色板分组起名时，只要名字里含 `线条颜色` / `填充颜色` 这两个串，`getByLabel("填充颜色")` 就会一次命中十几个元素（实测：3D 交面那条 e2e 直接因此变红）。**名字之间不能互为子串**——否则"按名字找控件"的查询（无障碍工具同样如此）会失准。最终命名：分组叫 `线条预设 / 填充预设 / 批量改色预设`，色块只报颜色名（`红 / 紫 / 无填充`）。

**验证**：全量单测 **113 文件 / 1281 用例通过**（新增 `palette.test.ts` 4 例、批量改外观 2 例）；Playwright **89 用例全通过**；`typecheck` 通过；`lint` 0 error / 14 warning；构建通过。浏览器侧逐项实测过：单选改线条色（`#0f8a63 → #dc2626`）、改填充、点「无填充」回到空心（`fill="none"`）、多选批量改色（两个对象同时变成 `#7c3aed`），并截图确认色板观感。

**仍未做（明确记录）**：① 色板是固定的一组，没有"最近用过的颜色"；② 颜色只支持纯色，没有渐变/透明度快捷项（透明度仍是单独的数值输入）；③ CAD 2D 与 3D 场景没有换成色板（本次只做平面几何，与用户口径一致）。



**仍未做（明确记录）**：① 只做了平面几何的草稿纸，CAD 2D 与 3D 仍是冷色工作台（用户原话只提"平面几何区"）；② 功能区命令仍是平铺的一排，没有按使用频率做"常用 / 更多"分层；③ 快捷入口只放在空白画布上，还没有"最近用过的命令"这类动态入口。

### 封闭曲线绕定点旋转：圆 / 椭圆过一个定点（2026-09-17 已完成）

**需求（用户原话）**：「高中数学中有一类题目是有一些封闭曲线（圆，椭圆）过一个定点。现在你实现圆（椭圆）可以过一个定点旋转的功能」。

**用户第二次修正交互口径（原话）**：「创建一个定点后，点击定点，右侧应该出现选择创建一个"动圆"，这个动圆不需要标出圆心，但需要能够修改半径。在删除定点后，这个动圆也会跟着消失」。据此把入口与默认动作整个换掉（见下"动圆"一节）——第一节描述的"选中点 + Shift 选曲线 → 绕定点旋转"保留为**给已有曲线**定定点的通路，新主入口是「创建动圆」。

**交付的四层**（每一层都有自己的验证，不是只在内核可用）：

- **内核 `packages/geometry-kernel/src/conics.ts`**：新增 `ConicPlacement = { pivot, angle, baseCenter }`、`placedConic` / `baseConic` / `conicPivotAngle` / `reanchorBaseCenter`。语义是"整个图形绕过定点的刚体转动"：中心由 `baseCenter` 绕 `pivot` 转 `angle`，曲线自身朝向也加 `angle`。定点是转动中心，所以在曲线上的参数角从 θ₀ 变成 θ₀ + angle —— **"曲线始终过这个定点"与转角无关**，这正是用户要的那件事。没有放置信息时原样返回，旧文档逐位不变。
- **DSL**：`CurveRotation`（`pivot` 支持 `coordinate` 固定坐标与 `primitiveId` 点图元引用两种写法）+ `baseCenter`；`rotationAbout?` 加到 `circle` / `ellipse`。校验拦住：定点坐标 / 转角 / 基准圆心非有限数、定点引用悬空或不是点，以及**双曲线与圆弧上的 `rotationAbout`**（它们不是封闭曲线，必须拒绝而不是静默忽略）。
- **scene-graph**：重算时把放置烧进几何（于是路径约束、采样、包围盒、平移**一行都不用改** —— "圆过定点"对它们就是一个普通的圆）；依赖图补上"曲线依赖定点"这条边；`translatePrimitive` 同时搬定点与基准中心；补丁校验与写入 `rotationAbout`。
- **平面画布与检查器**：定点标记（红圈 + 十字，不接指针事件）、旋转手柄（拖动时按"指针绕定点转过多少"的**差值**改累积转角）、Ribbon「绕定点旋转」命令（选中一个点 + 一个圆/椭圆）、检查器「绕定点旋转」面板（定点坐标 / 转角 / 圆的说明）、状态栏三段式提示。

**"动圆"（用户第二次修正后的主入口）**：

- **入口**：选中一个**点** → 检查器出现「**创建动圆**」按钮（已经有一条动圆时按钮变成禁用的"已有动圆"）→ 点一下即以该点为定点生成曲线，并**自动选中**它（否则用户点完看不见检查器里的半径输入）。曲线默认半径 2、基准圆心摆在"定点 + 半径"处，所以**第一帧就过定点**。
- **不标圆心**：以某点为定点的曲线不渲染圆心小圆点（`data-shape-centre`），也把检查器里的"圆心 X/Y"换成一行说明——圆心是派生量，改它等于把曲线从定点上挪开。椭圆的 `rotation` 是曲线自身朝向、必须保留，所以只隐藏圆的圆心输入。
  - **定点标记只在选中时出现**（用户第三次反馈：「仍有圆心，或者你保留圆心，让圆心跟着动」）。此前我为定点画的"红圈 + 十字"一直挂着，用户看到的就是它。现在它跟控制点一样**只在选中那条曲线时**才画：选中时它是"定点在哪"的唯一说明，未选中时画布上不留任何多余标记（定点本身通常就是一个可见的点图元，再叠一个圈只会被当成"圆心又被画出来了"）。
  - **状态栏提示**也跟着换了：选中动圆时说的是"拖曲线就是绕定点转、半径在右侧改、删掉定点它会消失"，而不是"这条曲线可以当路径用"（它确实是合法路径宿主，但那不是用户此刻要办的事）。
- **半径可改**：检查器「半径」输入框，以及画布上摆在**斜 40° 方向**的半径手柄（原来在"定点正右方"，那正是圆的横向轴线端点，看上去就像一个点 / 圆心；手柄样式也改成虚线圈，与实心数据点区分开）。
- **拖圆本体 = 绕定点转**：以点图元为定点的曲线，拖动本体不再平移，而是按"指针绕定点转过的差值"改累积转角；半径手柄才改半径。**固定坐标**定点的曲线拖本体仍然是整体平移（定点与基准一起搬）。
- **删点级联**：`cascadeSources` 把"以某点为定点的曲线"列为级联来源，于是删掉定点时动圆一起消失。这是**级联**、不是"被引用所以拒绝删除"——曲线的圆心正是由定点 + 半径算出来的。
- **命中判定跟着选中状态**：控制点只在选中时画出来，`getDragHandle` 因此新增 `selected` 参数。动圆的半径手柄落在圆周上，不过滤选中状态的话，未选中的曲线会用一个看不见的手柄吃掉圆周那一小块的指针（实测：想拖曲线结果改了半径、定点还被甩开）。
- **点变小**：平面画布的点可见半径 6px → **4px**、标注字号 14 → 13（命中区仍 12px 不变）。

**过程中由探针定位并修掉的十个真实缺陷**（都不是靠推理猜的）：

0. **改半径不会重摆基准中心**（用户第二次修正后引入的真缺陷）：半径有**两条**编辑通路（画布拖手柄、检查器改输入框），而"把基准圆心摆到离定点恰好一个新半径"只写在拖动那条里。实测：半径 2→5 之后圆心留在 (4,1)，定点到圆心只剩 **2** 而半径是 **5** —— 曲线不再过定点。修法：抽成共享的 `resizedPlacement`，两条通路都走它。
0. **级联删除漏了动圆**：删掉定点后 `circle-1` 仍在文档里。根因是 `cascadeSources` 只列了交点 / 轨迹 / 截面那几类，没有覆盖"曲线以某点为定点"这条引用。修法见上"删点级联"。
1. **画布上 Shift 加选被处理了两次，选择反而被清空**（用户实测反馈的第一条）：用户原话「选中一个点 → Shift 选中一个圆或椭圆 → 点「绕定点旋转」无法实现」。探针（Playwright 读代数区的 `.selected` 行）测出：点选定点后是 `["P"]`，再 Shift 点曲线变成 **`[]`** —— 命令因此一直禁用。根因是选择被处理了两遍：`pointerDown`（`beginDrag`）先按加选把曲线加进去，紧接着 `click`（`handleObjectClick`）又按加选处理一次，而"加选"的语义是**切换**，同一个对象被加了又删。修法两条：按下时已处理过的选择，`click` 不再重复处理；拖动（而非点击）结束时也不改选择。
2. **拖动定点会毁掉形状**（由 Playwright 验收抓到）：定点是点图元引用，而重算是拿"新定点 + 旧基准中心"重新解一次 —— 只让点动、基准中心不动，曲线形状就变了。实测：把定点从 (3,0) 拖到 (0.22,-1.39)，圆被解成一个**不再过定点**的圆（定点落进圆内部，到圆心距离只剩半径的 **0.47 倍**，半径仍是 3）。修法：拖动定点所在的点时，把引用它的曲线**整体搬同样的位移**（圆心与基准中心一起搬）。数值探针 + 截图 + store 读数三份证据都留在了排查记录里。
3. **手柄用了派生中心**：`center` 是转过之后的位置，拿它算半径 / 旋转手柄，手柄会跟着转过去、看起来像曲线换了半径。修法是把手柄几何建在**基准**上。
4. **命令没接上**：case 加进了 `runCadCommand`（CAD 专用），而 Ribbon 在平面工作区走的是 `runRibbonCommand`。端到端测试直接抓到了"点了按钮什么都没发生"。
5. **定点没被真正定到曲线上**：`anchorRotation` 一开始只改曲线，点是点图元引用、仍留在原地（实测：点在 (5,0)、曲线被摆到只过 (3,0)），用户看到的仍然不是"过这个定点"。修法是**两次补丁**：点先投影落位，曲线再摆到过它的位置。
6. **未选中的曲线用手柄吃掉圆周上的指针**：动圆的半径手柄落在圆周上，而 `getDragHandle` 不看选中状态（控制点却只在选中时才画）。实测：在圆周那一小块按下想拖动曲线，结果改了半径、定点还被甩开。修法是给它加 `selected` 参数，命中判定与绘制一致。
7. **定点标记一直挂在画布上，被当成"圆心又画出来了"**（用户第三次反馈）：我原来把"红圈 + 十字"当成定点说明常驻渲染，但它就落在圆心附近，用户看到的正是"仍有圆心"。取证方式是把画布上**每一个被画出来的元素**都 dump 出来（tag / 类型 / `data-*` / 圆心的 `cx,cy,r` / 颜色），一眼看到那个 `r=5, stroke=#d94a4a` 的红圈 —— 而不是继续靠截图猜。修法：与其它控制点一样，只在选中时渲染。
8. **半径手柄看起来就是一个"点/圆心"**（用户第四次反馈：「这不是有一个点（圆心）吗」）：动圆的半径手柄画成小空心圆、位置又落在圆的**横向轴线端点**（角度 0 时那里还是圆心方向），看上去与一个点图元没有区别 —— 我上一轮 dump 元素时把它当成了"点的标记"，所以判错了。修法两处：①手柄从"定点正右方"改到**斜 40°** 的固定方向（既不与定点重合、也不在坐标轴方向上）；②控制点样式改成**虚线圈**（`.drag-handles circle` 加 `stroke-dasharray`），与实心数据点在形状上就不同。
9. **平面画布的点过大**（同一条反馈的后半句：「平面几何部分中的点的模型都过大了，改小一些」）：可见半径从 6px 收到 **4px**、标注字号 14→13，命中区仍是 12px 半径（命中区决定"点不点得中"，不跟着视觉缩小）。

**关于"既有失败"的一处更正（我先前判断错了）**：上一轮我把 `e2e/three-intersection-previews.spec.ts:77` 的失败记成"与本次改动无关的既有失败"——依据是 `git stash` 移走全部改动后它仍然失败。但本轮修掉上面的选择双击缺陷之后，**它自己就通过了**。变异测试给出确凿因果：只撤掉 `GraphicsView.tsx` 的那处改动，那条 3D 用例与我的旋转用例**同时转红**。所以它不是无关的既有失败，而是同一个选择 bug 的另一个受害者（3D 预览的"指针在谁身上"被错误的选择状态带偏）。**教训**：`git stash` 复现只能证明"不是本次改动引入的"，不能证明"与本次改动无关"——两者是不同的问题，我当时把后者也一起断言了。

**关于"幂等"的一处自我纠正（方法学记录）**：最初我以为"重算不幂等"是真实缺陷（同一份文档重算两次，圆心从 `(1.5,-2.598)` 跳到 `(4.5,-2.598)`）。后来用**变异测试**（把实现改回"就地改 `center`"）发现浏览器验收照样通过 —— 因为在真实应用里 `applyOperation` 每趟只重算一次，`center` 从不累积，那个漂移是我在**单测里人为构造**出来的。所以：`baseCenter` 这个设计仍然保留（它让重算幂等、语义清楚，且是"拖动定点整体平移"那条修复的前提），但我**不再管它叫"真实缺陷"**，只把幂等当成一条设计性质用测试守住。

**RED→GREEN 证据**（每一条都先红过）：
- `conics.test.ts` 12 例：12 个角度下曲线都过定点、转满一圈精确回原处、**幂等**（从自己的输出再算一遍逐位不变）、`baseConic` 能还原基准、没有放置信息时逐位不变、椭圆定点的离心角、绕自身中心转。
- `schema.test.ts` +14 例与 scene-graph `scene-store.test.ts` / `patches.test.ts`：校验拒绝非法放置；曲线在五个角度下都过定点；**反复重算不漂移**；定点移动后整条曲线重算；定点进依赖集；平移带着定点与基准走；补丁写入后同一次提交就把放置算好。
- `apps/web/src/curveRotation.test.ts` 9 例：定点投影到曲线上（点不在曲线上时拉到曲线上）、定型后曲线确实过定点、按差值算转角（按下不跳）、手柄位置（含定点在圆心的退化情况）、`mod 2π` 的度数读数。
- `interaction.test.ts` +5 例：`rotate` 手柄可抓、转子不改定点、**拉本体时定点与基准一起搬**、拉半径后定点仍在曲线上、定点是点图元时只更新转角。
- `App.test.tsx` +2 例：①**端到端**：选点 + Shift 选圆 → 点「绕定点旋转」→ 断言 `rotationAbout` 写成点图元引用、定点到圆心距离 = 半径、画布上有定点标记与 `data-drag-handle="rotate"`、检查器有定点与转角读数；再把转角改成 90°，重新断言"仍过定点"；②**拖动定点的回归**：拖定点所在的点之后，半径与转角不变、基准中心跟着搬、定点到圆心距离仍 = 半径。②做过变异测试（撤掉修复即转红）。
- `e2e/planar-rotation-anchor.spec.ts` 3 例（**Playwright 浏览器验收**，配三个夹具）：①**点定点 → 右侧「创建动圆」→ 曲线过定点 → 不画圆心 → 取消选中后画布上不留任何定点/圆心标记 → 改半径后仍过定点 → 删点连曲线一起消失**（这条就是用户第二次与第三次口径的回归）；②选点 + Shift 选圆 → 定型后定点落在圆上（屏幕比值 = 1）→ 拖**圆本体** 24 步 → 曲线确实转了且定点仍在圆上、并且**没有**独立的旋转手柄；③拖**定点本身** → 曲线跟着走、半径不变、仍然过定点。①与②都做过变异测试（①撤掉选择修复即转红；②把转角计算改成恒等 → "曲线应当移动"那条断言转红）。
- `statusPrompts.test.ts` 另加断言：选中动圆时给的是"怎么转 / 半径在哪改"，**不**给路径绑定提示。
- `interaction.test.ts` 另加一例：**未选中的曲线不得用手柄吃掉圆周上的指针**（同一个点，`selected=false` 判成 `body`、`selected=true` 判成 `radius`）。
- scene-graph `scene-store.test.ts` 加一例：**删定点级联带走曲线**，且反向（删曲线不动定点）成立；同时断言删除**被允许**（不是拿"被引用"来挡）。
- `App.test.tsx` 加一例：选中点 → 「创建动圆」→ 过定点 → 半径可改且仍过定点 → 删点连曲线一起消失（jsdom 层的同一条链路）。
- `exporters.test.ts` +1 例：导出的是**放置之后**的几何，且用导出器自己的 `worldToSvg` 判定"导出的图仍然过定点"。
- `statusPrompts.test.ts` +1 例：三种状态都有话说（两样都选中 / 文档里两样都有 / 都没有时不多嘴），且"两样都选中"时压过路径绑定提示。

**关于测试期望值的一处方法学记录**：这一轮我在期望值上写错过多次（圆心坐标、手柄方向、转角），每一次都是**探针或失败输出纠正我**，而不是反过来。其中转角那几处最终改成按 `mod 2π` 同余比较 —— `-π` 与 `+π` 是同一个角，直接比数值会把一个正确结果判成错。另外发现 `commitPatch` 只写补丁、`applyOperation` 末尾才重算，所以测试里再调一次 `recomputeDerivedObjects` 会重复施加放置；这条契约写进了测试注释。

**回归**：全量单测 **112 文件 / 1275 用例通过**（起始 112 / 1268）；`typecheck` 4 个 workspace 全过；`lint` **0 error / 14 warning**（起始 15 —— 清掉了一处本次改动引入的多余导入后反而少了一条）；生产构建通过；Playwright 全量 **89 用例 / 20 文件全通过**（`npx playwright test --list` 实测总数），其中本次新增 3 例（`e2e/planar-rotation-anchor.spec.ts`）。全量 e2e 起点是 **87 通过 / 1 失败**，那条失败在修掉选择双击缺陷后**自行消失**（见上面的更正）。

**仍未做（明确记录）**：① 绕定点旋转只给圆与椭圆，弧 / 抛物线 / 双曲线按设计不支持（不是封闭曲线）；② 定点是点图元时，"拖动那个点"会带动曲线，但**把定点做成沿曲线滑动的动点**（`onPath` 绑定）这条组合没有专门覆盖；③ 椭圆的绕定点旋转只有单测覆盖，浏览器里只验了圆的场景；④ 每个点只允许一条动圆（按钮在已有动圆时禁用）——"同一定点上的多条动圆"没有做；⑤ 点变小只改了平面画布（`GraphicsView`），CAD 2D 绘图视口（`DrawingViewport`）与 3D 场景的点手柄尺寸未动（用户只说了"平面几何部分"）。

### 3D 视口与几何内核重构（2026-09-17 设计与实施全部完成）

**收尾状态（2026-09-17）**：设计文档切分的 **10 片全部完成**（0 设计文档 / 1A-1 渲染管道去重建化 / 1A-2 `hosts3.ts` 与绑定 DSL / 1A-3 拖动状态机与绑定 UI / 1B 截面几何·多环·「转为图元」 / 2 Auto-Fit / 3-1 删除级联 / 3-2 求值层清理与画布尺寸稳定性 / 3-3 多解实体与就近吸附），并在队列之外补齐了三项排查阶段发现的问题：**F15 采样求交的去重尺度**、**验收项缺口（四个模板的默认截面）**、**相机与取景数学抽出独立模块**（另有背景坐标系自适应与"画布填满所在行"，来自同一批用户反馈，见下文对应小节）。**收尾时明确记录的三条"仍未做"随后也全部做完**：①`syncScene` 按图元增量同步（1A-1b）②相机状态跨工作区保留 ③`threeScene.tsx` 按职责拆成 `threePrimitives` / `threePicking` / `threeDrag`——见下文「场景增量同步与相机记忆」与「threeScene 按职责拆成独立模块」两节。三项用户需求逐条对照见本节末尾。

**需求**（用户提出，三项）：①重写 3D 动点的射线拾取与参数约束投影，使其严格沿宿主线段/曲面滑动、拖拽实时驱动下游重绘；截面改为真实截交闭合多边形，只渲染轮廓与半透明填充，并可「获取截面图元」。②3D 视口 Auto-Fit：按可见图元世界 AABB 计算视锥与相机距离，加载/增删/越界时平滑重置并保留 30% 安全边距。③重构图元生命周期与 DAG：删除宿主时级联注销测量、杜绝"图元无法删除"；多实根各自独立成实体，并按屏幕像素距离就近吸附。

**需求对照（逐条，均有测试证据）**
- ① **动点沿宿主滑动**：DSL 新增 `onHost / onFace / onSurface` 绑定（参数是唯一真值、坐标由参数派生），内核 `hosts3.ts` 给出线/面/平面/圆柱与圆锥侧面的 `evaluate / project / residual / domain`；属性栏「宿主绑定」下拉 + 参数输入，画布拖动时把指针落点投影回宿主参数再反算坐标（`e2e/geometry3d-host-drag.spec.ts` 断言拖动期间残差 ≈ 0、一次 Ctrl+Z 精确复位）。
- ① **截面**：内核按面边界求交后沿相邻面连成**闭合环**，**保留全部环**（带孔/分成多块不再丢几何），渲染外环半透明填充 + 内环轮廓；默认剖切面是过包围盒中高处的水平面（法向 `(0,0,1)`）；「转为图元」把每一环物化成点/棱/面并与来源解耦。
- ② **Auto-Fit**：AABB 八角逐个求"落进视锥所需的最小距离"再留 30% 边距，距离范围从 `[3,60]` 放宽到 `[0.005,1e4]`，近远平面随距离缩放；触发时机为"换文档"或"内容跑出视锥"，**编辑过程中永不抢视角**；画布上有「自动取景」开关且偏好跨刷新保留。
- ③ **生命周期与多解**：删除宿主时**级联**注销测量 / 2D 标注 / 工程标注 / 约束，分组只摘掉被删成员，锁定时仍拒绝；批量删除按**并集**校验（"点 + 依赖它的线"能一次删掉）；宿主消失时绑定点**降级为自由点并保留位置**。多解用任意非负整数 `solutionIndex` 各自独立成实体，`hint` 按最近解匹配，预览点击按**屏幕像素距离**就近吸附。

**已完成**：设计文档 `docs/superpowers/specs/2026-09-17-3d-viewport-kernel-refactor-design.md`（含调研结论、19 条现场事实、四区块设计与验收标准、10 片提交切分）。前期做了两路只读代码测绘与一路 GitHub/OSS 调研（three.js DragControls、JSXGraph Glider、trimesh 截面退化分类与成环、CGAL slicer 定向、FreeCAD `breakDependency`、SolveSpace 多解吸引域、tldraw/Excalidraw 像素容差）。

**已确认的四项决策**：渲染管道走去重建化方案 A（renderer 只建一次 + 命令式 `syncScene` + 拖动预览通道）；默认剖切面法向改为 `(0,0,1)` 过 AABB 中心；删除级联覆盖测量/2D 标注/工程标注/约束，分组自动移除成员，仅锁定仍拒绝删除；多解用 `solutionIndex`（任意非负整数）+ `hint` 坐标按最近解匹配。

**对需求原文的一处纠正**：测绘逐点核对后确认，测量/标注**不存在**循环引用，也没有未注销的监听器；真实问题是测量/标注**阻止删除宿主**、`dynamic-measurements.ts` 的订阅引擎是死代码、3D overlay 每帧重建全部 label。重构按真实问题实施。

**关键现场事实（带证据）**：3D 绑定点当前完全拖不动且无 UI 入口（`threeScene.tsx:1363`、`operations.ts:208-221`）；任何 App 重渲染都整场景重建并新建 `WebGLRenderer`（`threeScene.tsx:1543`、`App.tsx:393`）；模板实体存在三套几何两种朝上约定（`threeScene.tsx:531-574` / `operations.ts:271-304` / `solid-builders.ts:330-368`）；截面只保留一条环（`sections3d.ts:137`）；多选删除被逐个预校验卡死（`App.tsx:685-690`）；多解索引被 clamp 成 `0|1`（`App.tsx:537`、`types.ts:435/445/455`）。

### 动点与连线：命中顺序修复（2026-09-17 已完成）

**用户反馈（原话）**：「还有一个bug，描述起来比较麻烦，如果我将动点放在轨道上，同时动点又和另一个定点连了线，那我移动轨道会带着设置好的定点一起移动」。

**取证过程**（Playwright 探针，跑完即删）：按原话把场景搭成固定夹具 `e2e/fixtures/connected-dynamic-point.mgeo`（直线当轨道、绑在它上面的动点 A、自由的定点 B、A—B 的连线），然后一步一只读地量：
- **拖轨道**（起点取在直线上远离 A 与连线处）：轨道平移 ✓、动点 A 跟着重算 ✓、**定点 B 一动不动** ✓ —— 所以"移动轨道带走定点"这一句在**当前实现里并不成立**（坐标实测：B 始终是 (4,4)）。
- 真正的问题在**指针落到了谁身上**：用 `document.elementFromPoint` 读出端点上最上层的元素是 `line.- in connection`——即连线的**可见线**（3px，默认 `pointer-events: painted`）正好从两端点穿过，而连线画在点**之后**，于是"点正中心"的那一下指针按下落在连线上。连线是派生对象、`getDragHandle` 返回 null，拖动根本不成立，还会退化成**框选**：**动点抓不住、连着的定点也抓不住**。轨迹同理（动点必然落在自己的轨迹上）。

**修法**（两处，都很小）：
1. 连线的命中带从两端**缩进** `CONNECTION_HIT_INSET_PX = 16`（世界单位按当前缩放换算，短连线至少保留一半长度可选）——端点那一小块还给点本身；抽成纯函数 `insetSegment` 并有单测（正常缩进 / 短连线保底 / 退化线段不产生 NaN）。
2. **点的命中区在所有派生曲线之上再画一遍**（透明、只接指针事件）：连线与轨迹中段照旧可选可点，但端点与动点永远赢。没有把整层绘制顺序倒过来，是因为连线 / 轨迹自身仍要能被点选。

**回归用例**：`e2e/planar-connected-point-drag.spec.ts`（配上面的夹具）——拖轨道时动点跟着走、**定点坐标逐位不变**、连线跟着动点；再拖**动点自己**：先用 `elementFromPoint` 断言最上层是 `point`（修之前这里是 `connection`，正是抓不住的原因），然后拖动它严格沿轨道滑动，**定点依旧不动**。

**说明（仍未证实的一半）**：用户描述的"移动轨道带走定点"我没有复现出来；如果实际现象还在，需要用户说明当时抓的是哪个对象。另外两种情况下"定点"**确实**会跟着轨道走，且都是设计如此：①它是绑在轨道上的点（检查器里能看到「路径绑定」）；②它是**保存下来的交点图元**（由两条曲线派生，来源一动它就跟着动，检查器写明"该点由其他图元计算，不可直接拖动"）。

- **回归**：全量单测 **104 文件 / 1139 用例通过**（起始 103/1136）；`typecheck` 4 个 workspace 全过；`lint` 0 error、15 条 warning（持平）；生产构建通过；Playwright **83/83 通过**（起始 82，新增 1）。

### 五条浏览器反馈修复（2026-09-17 已完成）

**用户反馈（原话）**：「第一圆柱不圆，第二动点的约束应该可以在立方体内，第三动点的操作很不跟手，有时候约束移动了，动点却留在原地，第四动点的移动动画比较差，当我拖动动点时，只能看到起始和结束的动画，中间移动过程的动画没有了，第五我觉得可以把动态演示的栏目删掉」。

逐条取证后，**第三条是一个真缺陷、且根因在依赖图**；第四条经查是「动效演示」播放那条通路自己的问题（50ms 定时器 + 逐帧整文档预览），而第五条要求删掉这一栏，所以④随⑤一起消解（删掉而不是修）。

1. **圆柱不圆**（`apps/web/src/solidDefaults.ts`）：圆柱 / 圆锥是**多边形近似**（内核只有多面体），而默认分段数写死 **24**，半径 1.5 的圆柱每个侧面跨 15°，屏幕轮廓看得出明显的棱。改成 `ROUND_SOLID_SEGMENTS = 48`（弦高误差降到约 0.7px），并**把预览配额与它钉在一起**：`DEFAULT_MAX_FACES_PER_PAIR` 64 → 96、`DEFAULT_MAX_POINTS_PER_PAIR` 32 → 64，否则 48 段的圆柱一相交就会因为"面数超过单对上限"被截断、状态栏还得说"交面没画全"。RED→GREEN：新增 1 例（48 段圆柱 ∩ 立方体：`truncatedPairs === 0` 且面数 ≥ 48；把上限调回 32 时该用例转红——用变异测试确认过）。
2. **动点约束到实体内**（DSL + 内核 + scene-graph + UI）：新增绑定 `{ kind: "inSolid"; solidId; uvw }`——`uvw` 是实体包围盒内的三个比例（**参数仍是唯一真值**，实体平移/缩放时坐标跟着走），内核新增 `solidVolumeHost3` 与 `clampPointIntoSolid3`：点在内部时 `residual = 0`（可以自由移动），跑到外面就沿违反的面平面**夹回表面**（凸体逐面投影、迭代几轮收敛）。`Host3Kind` 增加 `"solid-volume"`、`Host3Parameter` 增加 `w`。UI 侧把下拉项的取值编码成 `<模式>:<图元 id>`（`pointHostOptions.ts`），因为同一个圆柱既要能绑"侧面"、也要能绑"内部"；检查器给出「体内参数 u / v / w」。RED→GREEN：内核 4 例（uvw 正反向映射、内部不动 / 外部夹回表面且残差等于距离、参数往返、退化输入拒绝）+ scene-graph 4 例（按参数落点、参数越界被夹回、实体平移后跟随、删实体时降级为自由点并保留位置）+ App 1 例（完整链路：下拉选「实体内」→ 点在立方体内 → 参数改成 9 → 仍在 [−2,2] 内 → 立方体平移 4 → 点跟着走）。
3. **约束动了、动点却留在原地**（真缺陷，根因在依赖图）：模板实体物化出来的点 / 棱 / 面原本只有"多面体依赖它们"这一个方向，**没有"它们依赖所属实体"这条边**——于是从实体出发的闭包只到多面体就断了。实测：把点绑在立方体的某个面上再移动立方体，`getAffectedPrimitiveIds(["cube-a"])` 只有 `cube-a` 与那个多面体，绑定点根本不在闭包里 → 点在原地不动。修法：新增 `templateChildOwners(document)`（参数化模板记 `sourceIds[0]`、按数值编辑过顶点的翻成 `fromFaces` 后记 `sourceId`），在 `primitiveDependencies` 里给每个子对象补上"依赖所属实体"这条边。RED→GREEN：新增 `boundPointFollow.test.ts` 3 例（面绑定 / 棱绑定随实体移动、以及"只把实体标脏时闭包必须包含绑定点"；三条在修之前全红）。
4. **动效演示只看得到起止两帧**：查下来是这一栏自己的问题——`window.setInterval(..., 50)`（20fps）+ 每帧一次整文档的参数预览提交，拖动/播放时中间帧被丢掉；而用户同时要求删掉这一栏，所以**不再修这条路**（见第 5 条）。
5. **删掉「动效演示」栏**（按用户要求）：删掉 PropertiesBar 里的面板、动画状态与两个 effect、`toggleAnimation` / `stopAnimation`、以及只服务于它的 store 前端引用；连带删掉 `.animation-controls` 的 CSS 规则。动点仍然有**两条**驱动通路（画布拖动、属性栏「路径参数」），它们写的是同一个参数、完全等价。原动画用例改写成"面板确实不存在 + 剩下的通路仍然打在动点自己的参数上"，另有一条直接断言播放 / 暂停 / 停止 / 模式四个控件都不再存在；「参数域」那条用例的断言也从动画滑块改到「路径参数」输入框（覆盖面不变）。
- **回归**：全量单测 **103 文件 / 1136 用例通过**（起始 101/1119）；`typecheck` 4 个 workspace 全过；`lint` 0 error、15 条 warning（持平）；生产构建通过；Playwright **82/82 通过**。



- **用户要求**（原话，先后两次）：
  1. 「还需要优化一下交面交线的问题，我需要交面交线作为单独的图元，ui操作逻辑参考平面」；
  2. **语义纠正（第二次反馈）**：「有一个错误，我需要的交面只是一个表面，而不是所有相交的表面，同时我需要一个交面内部填充颜色可以更改的功能，当然我们不止需要交面，还需要交线交点」。
  追问后确认：**交面 = 布尔交集的单个平面面片**（画布上每一面分开显示、分开可点，点哪块建哪块，读数给该面的面积，**填充色可改**）；**交点也做成独立图元**（交线的端点 / 拐点，每个可单独点一下建出来，跟随两个来源重算）；触发方式照平面画布（自动显示、点一下即创建）。
- **切片 0（第一次反馈的实现，随后按语义纠正调整）**：内核布尔交集 + 自动枚举所有两两相交 + 点击创建「交面（整体）」与「交线」+ `intersectionLine` 的检查器属性块。这一段保留为**兼容路径**：旧文档里已经建出来的 `intersectionSolid`（整体表面）仍然读得进、算得出、画得出来（标签改成"交集整体"，`intersectionFace` 才叫"交面"），但画布不再预览、也不再创建它。
- **切片 1：内核布尔交集** `packages/geometry-kernel/src/boolean3d.ts`（提交 `f2d2476`）。
  - 做法：凸实体 = 一组半空间的交集（每个面给一个半空间），用对方的每个面平面**依次裁剪**自己——凸体被平面裁剪后仍是凸体，算法简单、数值可控。切口面按平面内角度排序后补上，顶点按模型尺度量化去重，面按"顶点集合"去重。
  - 输出：`{ status, vertices, faces, faceNormals, faceAreas, volume, area, explanation, diagnostics }`——**每个面自己的法向与面积由内核给出**（交面图元要"这一面多大、朝哪边"），调用方不必各写一份 Newell 法向与面积。
  - status 区分 `polyhedron` / `flat`（只在一个平面区域相接）/ `segment` / `point` / `none` / `insufficient-data`（**非凸输入不做近似**，直接给诊断）。
  - RED→GREEN：`boolean3d.test.ts` 8 例（先全部因模块不存在 / 缺少 `faceAreas` 失败）——两个错位立方体的交集是精确的 0.5³（体积 0.125、6 面 8 顶点）、包含关系时等于小立方体（体积 1）、相切时报 `flat` 且面积 1、不相交报 `none`、**交集每个顶点都落在两个输入实体内部或表面上**（半空间判据）、L 形非凸棱柱报 `insufficient-data` 且说明里出现"凸"、退化输入报 `insufficient-data`、**每个面的面积与法向**（面积和等于总表面积、法向是朝外的单位向量且与形心方向同侧、无交集时两个数组为空）。
  - 过程中由探针定位的**两个真实算法错误**（都写进了实现注释）：①顶点正好落在裁剪平面上时会被重复压入环里，面退化成 `[7,4,6,7,7]`，扇形三角化随之算错（体积偏小 12%）→ 增加"去掉环上相邻重复点"；②补切口面时**漏了平面内排序**，切口面变成自交多边形，后面每一刀都切在烂几何上（包含关系算成体积 0.88、面里出现重复顶点）→ 补上 `orderSectionPoints3`。体积也改成"从内部点对每个面张成的四面体取绝对值求和"，与输入绕向无关（有符号求和会因绕向不一致互相抵消）。
- **切片 2：画布自动枚举所有两两交线 / 交面 / 交点**（已完成）。
  - `apps/web/src/intersectionPreviews3d.ts`：`computeIntersectionPreviews3d(document, { previous, maxSources, maxBooleanPairs, maxFacesPerPair, maxPointsPerPair })` 枚举**顶层实体**（`cube/pyramid/cylinder/cone/polyhedron3`，排除模板物化出来的"影子"多面体）的两两组合，先用**世界 AABB** 筛掉不相交的对，再算交线（`intersectFaceSets`）与交面（布尔交集）。
  - 一对来源给出**三类各自独立的预览**（各有 key、各有命中区、点击创建各自的图元）：
    `pair:<a>|<b>:线`（交线，虚线 + 加粗命中带）、`pair:<a>|<b>:面<i>`（**交集的每一个面各一份**，半透明面片 + 它自己那圈边）、`pair:<a>|<b>:点<j>`（**交线的每个拐点各一份**，圆点标记 + 不可见命中球）。
  - **交点是交线的拐点，不是布尔交集的顶点**：完全包含时两个表面根本不相交、交集却有顶点——那不是"交点"。取公共边界线段的端点去重（按模型尺度量化），所以"有没有交点"与"有没有交线"永远一致。
  - 自动枚举**只覆盖顶层实体**：按住 Alt 选中两个**面**（或面 + 实体）时，交线预览仍走**选择驱动**的老路径（`toSelectionLineScenePreview`），并与自动预览按同一套 key 去重——状态栏说"点击即可创建"时画布上必定有那条可点的虚线。交线的用户可见名称统一成「交线」（此前选择驱动路径叫"面交线"、图元标签叫"截线"，同一条线三个叫法）。
  - **性能**：每一对按"解析后的几何签名"缓存（`JSON.stringify(topology)`），只动一个实体时其余对直接沿用上一次的结论；单次扫描最多算 12 **对**来源的布尔交集（交线不受限）、每对最多 64 个面、每对最多 32 个交点，超出记入 `truncatedPairs` / `truncatedPoints` 并由状态栏说明；候选上限 24 个实体 / 120 对。
  - RED→GREEN：`intersectionPreviews3d.test.ts` 11 例（先因模块不存在 / 缺少新 kind 失败）——不选任何东西就枚举出交叠对、相交的一对给出 6 个面（面积和 64 = 交集表面积，其中两个 16、四个 8，每份面预览都带着自己的形心 `hint`）与 8 个拐点、包含关系只给 6 个面（面积和 24）不编交线也不编交点、包围盒不相交的对直接跳过、签名未变时 `computedPairs=0 / reusedPairs=1` 且结果逐字节相同（来源移动后重算，面积从 16/8 变成 16/12）、布尔配额生效（3 对只算 1 对 → 只有 6 个面、`truncatedPairs=2`）、**单对面数上限**（`maxFacesPerPair: 2` → 2 个面且 `truncatedPairs=1`）、配额放开后被挤掉的两对能补上（18 个面）、`truncatedPairs` 每次扫描都报、完全包含的被挤掉对也计数、面/平面/模板影子都不是候选。又用**变异测试**确认了配额那条断言真的会失败（把配额判断短路后该用例转红）。
  - 场景侧 `ThreeScenePreview` 从"单份预览"扩成**列表**（每份带 `key`）：`threeScene.tsx` 按 `preview:<key>` 增量同步，指针命中按射线取最近的一份；**距离几乎相同**（同一处同时压着好几份预览）时按"越具体越优先"取：**点 > 线 > 面**（拐点上压着交点标记、命中带与两块面片，用户点的是那个点）。悬停高亮改成**就地改材质 / 就地放大标记**（不进内容签名，悬停不再重建场景）。
- **切片 3：三个图元各自建得出来**（已完成）。
  - DSL 新增两个类型 + 校验：`intersectionFace`（`sourceIds` / `points` / `normal` / `area` / `hint` / `status` / `diagnostic`，来源必须是两个**实体**）与 `intersectionPoint3`（`sourceIds` / `position` / `hint` / `status`，来源可以是实体、面或平面）。两者的几何全部由来源重算，界面不给手改。
  - `scene-graph`：`recomputeIntersectionFace` 按"离 `hint`（上一次的形心）最近的面"认领同一个面，法向与面积直接用内核给的 `faceNormals` / `faceAreas`；`recomputeIntersectionPoint3` 按"离 `hint` 最近的拐点"认领，没有拐点时给"没有交点：两个表面不相交"的诊断。两者都进依赖图（`sourceIds`）与**删除级联**。
  - 渲染：`createIntersectionFaceGroup`（半透明面片 + 描边，**填色 / 透明度 / 描边色全部来自图元样式**；没设过时才用默认红）、`createIntersectionPointGroup`（单位球，半径由场景按屏幕尺寸统一缩放，与空间点手柄同一套约定，因此远看近看都好点）。旧的 `intersectionSolid`（整体表面）渲染保留，`createIntersectionSolidGroup` 不动。
  - 检查器：交面给「来源 A/B、面积、顶点数、法向量、状态」，交点给「来源 A/B、X/Y/Z、状态」；**填充颜色字段现在对 `intersectionFace` 与 `intersectionSolid` 都出现**。
  - RED→GREEN：`packages/scene-graph/src/intersectionSolid.test.ts` 14 例（新增 6 例先全部失败）——只materialise**一个**面（y=-2 那一面：4 顶点、面积 8、法向 (0,-1,0)、hint 跟着走）、来源移动后认领**最近**的那一面（y=-2 消失 → 认领 y=-1，面积 8 而不是 12）、不再相交时给"没有重叠"且不可见、只materialise**一个**交点（(2,-2,2)）、完全包含时"没有交点"且不可见、两个新类型都进依赖索引并在删来源时级联注销。`apps/web/src/threeIntersectionFace/Point` 渲染 3 例（先失败）：一个面片 + 一圈边 + 可拾取、**填色真的来自 `style.fill`（含用户特意选的色）**、透明度与描边色照办、空面环不画占位；交点画成可拾取的标记、选中换色。
  - e2e `e2e/three-intersection-previews.spec.ts`（配 `e2e/fixtures/overlapping-cubes.mgeo`）3 例：①不选任何东西就有 `data-preview-line-count=1` / `data-preview-point-count=8` / `data-preview-face-count=6`、keys 里同时有 `:线`、`:面0`、`:点0`、不含远处的 `cube-far`，状态栏说"已自动标出 1 处交线、8 处交点、6 个交面"；②指针移到交面片上 → 状态栏出现"公共区域的一个面"，点击建出**"交面 1"**且检查器给出面积 `8.000` 与来源 A/B，再打开「外观样式」把**填充色改成 `#22cc88`**（用户要求的那项功能）；③指针移到拐点上 → 悬停键是 `:点\d`、状态栏说"拐点"，点击建出**"交点 1"**；再移到那条轮廓线段的中间 → 悬停键是 `:线`，点击建出**"交线 1"**（段数 / 总长度）。
- **切片 4：交线图元的检查器属性块**（已完成）：`intersectionLine` 现在显示「来源 A / 来源 B / 段数 / 总长度 / 状态」（状态用给人看的说法：有交线 / 无交线 / 数据不足），有诊断时一并显示。
- **过程中修掉的三个真实交互问题**（都由 e2e 探针暴露，不是猜的）：
  - **点交面正中没反应**：粗拾取恰好命中一条从旁边穿过的棱（`data-pick-readout` 读出 `edge|...|precise|hover|behind`），而原规则是"命中点或棱都不让预览抢"。改法是让取舍看**深度 + 是否擦过**（见下一条的 `previewBeatsPick`）：擦过的棱不该赢。
  - **交线画在来源的棱上，于是"点虚线建交线"一度做不成**：两个立方体的公共边界恰好落在来源的**棱**上，而"棱只在指针确实压在它上面时才让位"意味着整条交线都点不动。最终规则：预览在棱前面（或同一深度，容差内）时预览赢，预览明显在后面且指针确实压在棱上时才让给那条棱。
  - **交点标记与顶点手柄共心**：交线的拐点常常就是来源实体的顶点，两者画在同一个位置、半径不同，粗拾取会先命中大一点的那个（手柄），于是"点交点建交点图元"永远做不到。现在深度差在一个拾取容差内就算"同一深度"，并且**交点标记**在这种情况下优先于手柄（其它预览仍然让位给手柄——那条回归不能破）。
  - **e2e 投影必须先固定相机**：自动取景会在内容同步之后调整相机，用"同步那一刻"的相机读数把世界点换成像素，细目标（交点 / 交线）会差出十几像素。用例改成先点「重置3D视角」再投影（顺带让自动取景不再抢镜头）。
- **状态栏**：新增 `resolvePreviewInventoryPrompt`——画布上自动铺开的交点 / 交线 / 交面必须被说出来（用户反馈过"画布上有东西却完全没有任何提示"）：`已自动标出 N 处交线、M 处交点、K 个交面：点虚线创建交线，点圆点创建交点，点面片创建交面`；没画全时补"另有 N 对来源的交面没画全（一次最多算 12 对、每对最多 64 个面…）"或"另有 N 处相交对超出单次扫描上限…连交线都没画"。悬停说明分别点出：交面是"两个实体公共区域的一个面"、交点是"交线的拐点（两个表面的公共点）"、交线是"点击即可创建为交线图元"。
- **切片 5：只读复查后的五处修正**（已完成，复查由独立子代理执行、只读不改文件，我逐条复核后修的）。
  1. **配额结果被永久缓存**（`intersectionPreviews3d.ts`）：受限（`maxSolidPreviews` / `MAX_PAIRS`）时的结果原来按**完整结果**写进缓存，于是被挤掉的那一对再也不会补上交面——即使配额腾出来、即使几何没变。现在受限结果记为 `truncated`，下次扫描重新尝试；沿用的交面同样**占配额**，所以"哪几对分到交面"在多次扫描之间是稳定的。
  2. **截断计数与措辞**：原来只在计算路径自增、且与"有没有交线"绑定 → 完全包含（两表面不相交）的被挤掉对**完全不计数**（静默），而 `MAX_PAIRS` 分支实际连交线都没有、文案却说"只画了交线"（与事实相反）。现在 `truncatedPairs` 无条件计数、每次扫描都报，措辞改成"另有 N 对来源的交面没画全（一次最多算 12 对、每对最多 64 个面…）"；另加 `droppedPairs` 单列"超出单次扫描对数上限、连交线都没画"。
  3. **棱不该整类让位给预览**：上一版为了修"点交面正中没反应"改成"只有顶点手柄优先"，代价是**确实压在预览前面的一条棱**再也选不中。现在把取舍抽成纯函数 `previewBeatsPick`（`threePicking.ts` + 单测），按**深度 + 是否擦过**判：棱明显在预览前面且指针确实压在它上面时归那条棱，其余情况归预览（"擦过"的棱从不该赢）。第二轮反馈后又补了两条例外（见上：交线画在棱上、交点标记与顶点手柄共心）。
  4. **数值编辑过的模板从预览里静默消失**：按数值改一个模板顶点会把物化拓扑从 `kind: "template"` 翻成 `"fromFaces"`，而 `sourceIds` 这时是**面**的 id——归属丢了 → 该实体在截面 / 交线 / 交面里找不到自己的拓扑，还会报"来源必须是实体"（误导：它明明是实体）。现在翻转时把归属一并写进 `construction.sourceId`（DSL 类型 + schema 校验），`templateTopology` 两种记法都认；顺便把 web 端那份只认模板的重复实现删掉，截面预览改用 scene-graph 的 `solidTopology3`。
  5. **共享预览资源被反复释放**：所有交点标记共用一份几何与材质，而 `disposeObject` 会释放整棵子树 → 多份预览并存时，重建任意一份都会掏空其它预览正在用的资源（单份预览时代几乎不触发）。现在共享资源打 `userData.shared` 标记，`disposeObject` 跳过。
  另外按复查建议清掉了三条 nit：`previewDepthRef` 死状态、`hoveredPreview` 改存 key（文档变化时状态栏读数不再滞后一版）、`previewHitAt` 每轮同步建 `key → 预览` 表而不是线性查找。
  **过程记录（一次自我纠错）**：第 4 条最初写的测试是把立方体的一个角沿 x 挪 1 再断言"仍然是 polyhedron"——实测失败后追下去发现那个实体**确实不再是凸体**（相邻三面不再共面），内核拒绝是对的；于是把正向用例改成**棱锥**（挪塔尖仍保持凸性，体积仍是 64/3），另加一条"非凸时诊断应该说几何、而不是说来源不是实体"。这条错误的期望值没有被留在测试里。
- **回归**：全量单测 **101 文件 / 1119 用例通过**（起始 96/1070，本轮新增 49 例）；`typecheck` 4 个 workspace 全过；`lint` 0 error、15 条 warning（起始 16）；生产构建通过；Playwright **82/82 通过**（起始 79，新增 3）。
- **仍未做（明确记录）**：①布尔交集目前只对**凸**实体成立，非凸输入给诊断而不是近似（L 形棱柱已在测试里钉住）；②交面 / 交点预览的配额是硬编码（12 对 / 每对 64 面 / 每对 32 点），实体多且两两相交时后面的只画一部分，状态栏会说明，但还没做"按音量排序 / 只画视锥内"；③`intersectionSolid`（交集整体）只作为**旧文档兼容**保留：画布不再预览、也不再创建它；④三个新图元都不参与展开图与二面角测量。

### 拖动动点不再卡顿：交点预览改为增量（2026-09-17 已完成）

- **用户反馈**：「动点的流畅度还需要优化」。
- **先量后改**（临时基准探针，测完即删）：造一份 52 个图元、含 6 条采样曲线（3 圆 + 3 函数）的文档，量一次 pointermove 的各步骤：
  | 步骤 | 耗时 |
  | --- | --- |
  | `structuredClone(document)` | 0.15 ms |
  | `applyOperation(updatePrimitive)` | 0.54 ms |
  | `recomputeDerivedObjects(增量)` | 0.17 ms |
  | **`getIntersectionPreviews(全量)`** | **76.5 ms** |
  即：拖动只有 ~13fps，而且**唯一的原因**是全文档两两求交（采样曲线两两组合很贵），其余步骤加起来不到 1ms。
- **改法**：`computeIntersectionPreviews(document, { recomputeFor, previous })` 支持**增量**——只重算与"被拖动对象的下游闭包"相关的图元对，其余交点整段沿用（输出顺序与全量一致，隐藏/删除掉的图元对会自然消失）。`GraphicsView` 在拖动时用 `getAffectedPrimitiveIds(previewDocument, [dragId])` 作为 `recomputeFor`，并新增读数 `data-preview-pairs`（本次重算了几对）/`data-preview-reused`（沿用了几个）/`data-preview-count`（当前交点数）。
- **实测对比**（同一份 52 图元文档）：
  | 路径 | 每次 pointermove |
  | --- | --- |
  | 全量（旧） | **76.5 ms** |
  | 增量：拖一个**点** | **0.12 ms** |
  | 增量：拖一条**曲线**（重算 5 对） | 9.58 ms |
  真实浏览器里（部署实例、`e2e/fixtures/planar-drag-cost.mgeo` 的两条直线 + 两圆 + 一条函数、40 步拖动）：**帧间隔中位数 16.7ms（60fps）、p95 18.1ms、最差 31.6ms**。
- **RED→GREEN 证据**：
  - `intersectionPreview.test.ts` 新增 4 例增量语义，先全部失败（`computeIntersectionPreviews is not a function`）：不相关的图元对**必须沿用**（改了几何也不许重算）、相关的对必须重算（与全量结果一致）、`recomputedPairs`/`reusedPreviews` 计数正确、全部标脏时与全量结果完全相同。
  - 新增 `e2e/planar-drag-performance.spec.ts` 2 例（配 `e2e/fixtures/planar-drag-cost.mgeo`）：①拖动动点时 `data-preview-pairs` 为 **0**、`reused` 为 12（旧实现每次都是全量 6 对）；②怕"只沿用不重算"变成 bug，另有一条：拖动直线的端点时 `pairs > 0` 且**交点标记的坐标真的跟着动**。
- **顺带记录的两个交互事实**（探针发现，不是本轮改的）：平面画布上拖动一个图元**本体**（圆/线的轮廓）时，如果那一处压着交点预览标记，点击会落到预览上（标记命中区 r=14 且在上层）；圆的半径手柄在 `(0,0)`，恰好被圆与圆的交点标记压住。这属于"预览优先于手柄"的既有取舍，若要改需要单独设计。
- **回归**：全量单测 **95 文件 / 1063 用例通过**（起始 95/1059）；`typecheck` 4 个 workspace 全过；`lint` 0 error、16 条 warning（持平）；生产构建通过；Playwright **79/79** 通过（起始 77，新增 2）。
- **仍未做（用户本轮同时提出，等确认交互模型）**：「交面 / 交线作为单独的图元，UI 操作逻辑参考平面」。现状：截线（`intersectionLine`）**已经是**独立图元（点击虚线预览创建、进对象列表、随来源重算），截面（`section`）也是独立图元并带「转为图元」；差距在于 ①交线预览**必须正好选中两个对象**才出现（平面画布是"有交点就一直可点"），②`intersectionLine` 在检查器里**没有属性块**（看不到来源与段数）。②是无争议的小改动，①需要确认"是否要像平面那样自动显示所有两两交线（以及两实体共面时的交面）"。

### 浏览器实测反馈的三处修正（2026-09-17 已完成）

用户在自己浏览器里试过之后提了三条（原话）：

1. 「我需要的更重要的是交面，交线和交点，而不是创建对象之后中间出现一个大截面，请修正这个问题」
2. 「动点（绑定）的内容完全没有提示，我也不知道如何将点固定到我创立的曲线或直线轨迹上面」
3. 「立体缩放不要改变网格图大小，网格大小要严格对应一比一」

- **① 选中实体不再铺一块大剖切面**：单实体被选中时，虚线预览原本会铺一块半透明剖切面片盖在图形中间——既挡视线又和目标无关。现在预览**只画这一刀的交线（那圈虚线）与交点（圆点标记）**，剖切面本身属于"创建出来的截面（交面）"，创建之后才画，拖动/方向键挪刀口时也仍然看得到面片。两对象选中的**面交线**照旧（本来就只画线）。
  - 实现：`createPreviewGroup` 去掉 `section-preview-plane`，改为在每个顶点（截面 = 环上顶点、交线 = 每段端点，共享端点只标一次）放一个不可拾取的圆点标记；命中仍然只认那圈边界线的加粗副本。状态栏提示也点名三者：`一圈虚线是这一刀的交线、圆点是交点，点击即创建截面（交面）`。
  - RED→GREEN：新增 `threePreview.test.ts` 3 例（先失败在"预览里存在 `section-preview-plane`"与"交点标记数为 0"）；`statusPrompts.test.ts` 增加"提示里必须出现交线/交点/交面"（先失败）。
- **② 动点绑定有提示了**：绑定能力一直在属性栏（「路径绑定」下拉 + 路径参数 + 记录轨迹），但没有任何提示告诉用户它在哪、绑定后能做什么。现在：
  - 选中一个**自由点**时状态栏直接说：`… 在右侧「路径绑定」里选一条曲线或直线，它就成为动点，之后可以直接在画布上拖它`；如果文档里还没有任何曲线/直线，则改成"先画一条路径"的指引；已经绑定时说明三种等价用法（拖动 / 路径参数 / 记录轨迹）。
  - 选中一条**能当路径的曲线**时提示：`… 选中一个点后在它的「路径绑定」里选这条线，那个点就成为动点`。
  - 属性栏「路径绑定」下拉下面补了一句同样的说明（与立体几何的宿主绑定提示同一套写法）。
  - 顺带把"哪些类型能当路径"抽成 `dynamicPointPaths.ts`（11 种：直线/线段/射线/折线/圆/圆弧/函数/椭圆/抛物线/双曲线），属性栏下拉与状态栏提示共用同一份清单——此前是散落在组件里的一份字面量数组，两边一旦走偏，提示就与下拉对不上，等于没有提示。
  - RED→GREEN：`statusPrompts.test.ts` 新增 2 例（先失败：给出的还是"拖动控制点调整形态"）；`App.test.tsx` 新增 1 例"选中点后状态栏必须出现「路径绑定」「动点」，绑定后出现「路径参数」「记录轨迹」"（先失败，实测拿到旧文案）。
- **③ 网格严格 1:1（1 格 = 1 世界单位）**：旧实现按可见范围挑"好读"的格边长（1/2/5 × 10ⁿ），缩放时格子的**世界尺寸**一直在变，网格就不再是一把可靠的尺子。现在格边长恒为 `1`，只有**覆盖范围**随视图长大（按 2 的幂分档），同档内缩放时栅格连位置都不动；每 10 格一条主线，缩得很远时细线按"一格占多少像素"淡出、主线仍在（间距仍是精确的 10 个单位）。
  - 实现：`sceneGrid.ts` 的 `gridPlacement` 改为"固定 1 单位格 + 2 的幂覆盖半径 + 中心吸附到整格"；新增 `threeGrid.ts`（按整数格生成细线/主线两份几何 + 淡出曲线），栅格几何只在**覆盖半径跨档**时重建；读数新增 `data-grid-major`，`data-grid-cell` 恒为 `1`。
  - RED→GREEN：`sceneGrid.test.ts` 重写为 11 例，先失败 7 例（格边长不再是常量、缩放会改尺寸、中心没吸附到整格、没有主线读数…）；新增 `threeGrid.test.ts` 4 例；e2e 新增"缩放时格边长恒为 1、同档内位置与尺寸完全不动、缩小只让覆盖范围变大"（旧实现在大幅缩小时 `data-grid-cell` 会变成 10，这条会失败）。
  - 过程中被自己的 e2e 抓到一处真实回归：主线栅格是"后加进来的 key"，忘了登记进 `alive`，于是每次同步都把它当过期对象删掉再建（`removed: 1` / `created: 1`）——已在 `syncScene` 的晚到 key 列表里补上。
- **回归**：全量单测 **95 文件 / 1059 用例通过**（起始 92/1042）；`typecheck` 4 个 workspace 全过；`lint` 0 error、16 条 warning（持平）；生产构建通过；Playwright **77/77** 通过（起始 76，新增 1）。

### 场景增量同步与相机记忆（切片 1A-1b + 相机记忆，2026-09-17 已完成）

- **来源**：3D 重构收尾时明确记录的两条"仍未做"——①`syncScene` 只做了"常驻 renderer + 命令式同步"，内容对象仍是全清全建，展开动画每帧重建整场（1A-1b）；②相机状态随组件卸载而丢失，切到平面几何再回来就回到默认视角。
- **① 内容对象按签名增量同步**：每个场景对象现在带一个**内容签名**——它自己的数据、它依赖的图元（**传递闭包**，因为 `face3` 只存点 id 而二面角标注读的是顶点坐标）、以及影响它外观的视图状态（选中 / 显示开关 / 展开进度 / 面片尺寸）。签名没变就沿用原对象，只重建真变了的那几个。实测：展开动画的每一帧从"重建 12 个对象"变成**只重建那张展开网**（created 1 / reused 11）；把选中从一个空间点切到实体从"重建 29 个"变成 **created 1**。
  - 两个新的纯模块让规则可单测：`sceneContentPlan.ts`（`planContentSync`：该沿用 / 重建 / 丢弃）与 `sceneContentSignature.ts`（`createContentSigner`）。新增读数 `data-scene-created / reused / removed / content / created-keys`，e2e 直接读它们。
  - **顺带查出并修掉的三个真实缺陷**（都由探针定位，不是猜的）：①平面片 / 预览 / 栅格 / 坐标轴这些"后面才加进来"的 key 被当成过期对象删掉又重建（每次同步都重建栅格与坐标轴）；②上一份文档的残留对象参与 `contentBounds`，打开新文件时自动取景偏（target 0.48 而不是 0.50）；③面片的自动尺寸把**旧面片自己**算进内容半径，手动半边长恢复自动后 7.02 变成 36.21（新增 `contentRadiusExcluding`）。
  - 另一处顺带修正：点手柄原来按**各自深度**缩放世界半径，近处小、远处大，于是内容包围盒不对称、自动取景的中心会偏（实测 target `-0.01,-0.01,-0.00`）。现在统一按"相机到视点中心的距离"取，同时把内容半径的计算提到缩放之后，自动面片尺寸也变得确定（7.11 / 7.11，而不是 7.02 vs 7.11）。
- **② 相机记忆（`cameraMemory.ts`）**：组件随工作区卸载，挂载时读回"某个文档配某个相机状态"并**跳过首次取景**（否则刚恢复就被重新构图覆盖），卸载时写回。刷新页面仍是默认视角（与改动前一致，也不写进用户偏好）。实测：转到方位角 18.8°、缩放后切走再切回，方位角 / 仰角 / 距离 / 视点中心全部一致（旧实现回到 45°）。
- **RED→GREEN 证据**（每项都先失败）：
  - `cameraMemory.test.ts` 6 例：先 `Failed to resolve import "./cameraMemory"`；实现后 6/6。
  - `e2e/geometry3d-camera-memory.spec.ts`：旧实现下切回来方位角是 **45**（默认值）而期望 18.8 → 实现后通过。
  - `sceneContentPlan.test.ts` 6 例、`sceneContentSignature.test.ts` 6 例：同样先因模块不存在整体失败。
  - `sceneFit.test.ts` 新增 `contentRadiusExcluding` 3 例（先 `is not a function`）。
  - `e2e/geometry3d-scene-lifecycle.spec.ts` 新增 2 例：**先**因为没有 `data-scene-content / reused` 读数失败（拿到 0），实现后 created ≤ 2 / reused ≥ 8 通过；一条断言"内容对象数不变"的写法也被探针纠正过（选中实体会多出一个剖切面预览，内容 +1）。
  - **两条既有 e2e 的期望按新的确定性改写**（不是放宽）：`resizes a plane patch…` 先关掉自动取景（自动尺寸合法地依赖屏幕缩放的点击手柄，相机一动就不可比）；`frames an opened figure…` 的相机 target 改为按数值比较（手柄也在包围盒里，中心是个"数值"而不是固定的两位小数字符串）。
- **回归**：全量单测 **92 文件 / 1042 用例通过**（起始 89/1021）；`typecheck` 4 个 workspace 全过；`lint` 0 error、**42 条 warning**；生产构建通过；Playwright **76/76** 通过（起始 73）。

### threeScene 按职责拆成独立模块（结构收尾，2026-09-17 已完成）

- **来源**：设计文档收尾时记录的第三条"仍未做"——`threeScene.tsx` 里那些纯几何构造器仍与组件同文件。
- **做了什么**：`threeScene.tsx` 从 **1927 行降到 1129 行**，抽出三个模块（代码逐行搬运、无逻辑改动，`git diff --numstat` 对组件只有删除 + 三行新 import）：
  - `threePrimitives.ts`（550 行）：点 / 棱 / 面 / 平面 / 实体 / 截面 / 展开网 / 平面片 / 预览的构造，加上释放与展开动画的数学；
  - `threePicking.ts`（114 行）：射线命中、命中种类与优先级、截面拾取，以及"这次点击该选中谁"的判定；
  - `threeDrag.ts`（81 行）：屏幕平面落点、拖动族与偏移应用。
- **收益**：组件文件现在**只导出组件**，`react-refresh/only-export-components` 的 warning **全部消失**——lint 从 **42 条降到 16 条**（剩下的 13 条 `no-unused-vars` + 3 条 `react-hooks/exhaustive-deps` 都是既有模式）。`threeScene.test.ts` 改为从各自模块导入；五个原先模块私有的辅助函数（`visibleSolids` / `buildPointDrivenObject` / `disposeObject` / `disposeScene` / `createPreviewGroup`）因为跨了模块边界而导出。
- **方法学注记**：这次拆分用脚本按"顶层声明 + 它上方的文档注释"切块，再按名字映射到模块，避免手工搬运 768 行时出错；切完用 `tsc` 列出的未解析符号收敛 import，最后用 lint 的 `no-unused-vars` 逐条清掉多余导入（34 → 13 条）。
- **回归**：全量单测 **92 文件 / 1042 用例通过**；`typecheck` 4 个 workspace 全过；`lint` 0 error、**16 条 warning**；生产构建通过；Playwright **76/76** 通过。

### 相机与取景数学抽出独立模块（结构收尾，2026-09-17 已完成）

- **背景**：这条是 Auto-Fit 那一片留下的"边界"——`threeScene.tsx` 把 React 组件与一堆纯函数混在一个文件里（1985 行），既让 `react-refresh/only-export-components` 一路告警，也让这些纯函数只能跨组件文件测试。文档里写明的正确做法是"把相机与取景数学抽到独立模块"。
- **做了什么**：新增 `apps/web/src/threeCamera.ts`（相机状态与轨道操作、`cameraBasis`、平移/缩放的视点夹取、AABB 八角拟合 `fitCameraState`、越界判定 `isContentOutOfView`、过渡插值、`shouldAutoFit` 策略、`contentBounds`、`applyCameraState`）。`threeScene.tsx` 只留下组件与场景装配，删掉 204 行、**没有改动任何一行**（`git diff --numstat` = `0 204`，所以不存在顺手改坏的逻辑）；`sceneFit.test.ts` 与 `threeScene.test.ts` 改为从新模块导入相机相关符号。
- **一处必须记录的教训（我自己的操作失误）**：第一次删除用的是 PowerShell 的 `Get-Content` / `Set-Content`，而这个环境里是 **Windows PowerShell 5.1**（`Get-Content` 默认按 ANSI 解码），结果把整个文件里的中文注释写成了乱码。发现后立刻 `git checkout` 还原，改用 .NET 的 `UTF8Encoding` 显式读写完成删除，并用 `git diff --numstat`（只能看到删除、看不到任何"修改"）与乱码特征串搜索双重确认。**在这个仓库里改文件一律用编辑工具，不要用 PowerShell 的文本管道。**
- **验证**：全量单测 **89 文件 / 1021 用例通过**；`typecheck` 4 个 workspace 全过；`lint` 从 **56 条 warning 降到 42 条**（0 error）；生产构建通过；Playwright **73/73** 通过。相机行为本身由既有的 `sceneFit.test.ts`（八角拟合、扁长盒、空场景、越界判定、过渡插值、`shouldAutoFit` 策略）与 e2e 的 Auto-Fit / 平移缩放 / 拖动用例继续守着，抽模块后一行断言都没改。
- **仍未做（明确记录）**：~~`threeScene.tsx` 里剩下的告警来自那些**纯几何构造器**（网格/棱/面/截面/展开网、拾取、拖动工具），它们同样与 React 无关，合适的做法是按"图元构造 / 拾取 / 拖动"再拆两三个模块~~ **（2026-09-17 已做：抽出 `threePrimitives` / `threePicking` / `threeDrag`，组件 1927 → 1129 行、lint 42 → 16 条 warning。见下文「threeScene 按职责拆成独立模块」一节。）**

### 验收覆盖补齐：四个模板的默认截面（2026-09-17 已完成）

- **来源**：设计文档 §8 的 e2e 验收项写着"截面：四个模板的默认截面都是 polygon 且点数 ≥3；转动到 45° 仍有效"，而当时只有立方体在 e2e 里被覆盖过（棱锥/圆柱/圆锥只在单测里验过刀口位置）。这是一条**验收项缺口**，不是新功能。
- **补的两层**：
  - 单测 `scene-store.test.ts` 新增 "cuts every template solid with its default plane"：立方体 / 棱锥 / 圆柱 / 圆锥各建一份文档，取 `sectionPlaneThroughSource` 的默认刀口，重算后 `classification === "polygon"`、点数 ≥3、至少一条闭合环。这同时是对切片 1B 那个"棱锥/圆柱/圆锥默认刀口切在边界甚至切空"的回归保护。
  - e2e `geometry3d-section.spec.ts` 新增 4 条（每个模板一条）：进入立体几何 → 添加模板 → 创建截面 → 点数 ≥3；再绕 X 轴三次 +15°（法向到 45°，断言 `|ny| ≈ sin45`、`nz ≈ cos45`），倾斜后仍有 ≥3 个截面点。
- **回归**：全量单测 **89 文件 / 1021 用例通过**；`typecheck` 4 个 workspace 全过；`lint` 0 error、56 条 warning；生产构建通过；Playwright **73/73** 通过（原 69 + 新增 4）。

### 采样求交的去重尺度（F15，2026-09-17 已完成）

- **背景**：这一条是切片 3-3「多交点定位」最后留下的已知未做项，也是用户需求③（"多实根各自独立成实体"）的收尾——解能被独立选中了，但**有些解在源头就被去重合并掉了**。
- **缺陷**：`curve-intersections.ts` 的去重容差是 `1e-4 × max(1, |x|, |y|)`，随"图形画在离原点多远"膨胀。半径 1 的圆放在原点附近容差 1e-4，平移到 x≈1000 之后容差变成 **0.1**：用 y = √(1 − 0.025²) ≈ 0.999687 的割线去切，两个相距 **0.0497** 的真实交点被并成一个（探针实测）。用户"点的坐标到 20 左右"的作图尺度已经在往这条比例上撞。另一个相反方向的问题是那个 `1e-4` **相对**容差本身太松：图形尺寸 2800（半径 1000 的圆）时绝对容差 0.1，同样会并掉相距 0.05 的交点。
- **修法**：容差改为**只看图形自身有多大**——并集包围盒对角线 × 1e-9，且不小于该坐标量级下 double 能分辨的最小间隔（`EPSILON × |坐标| × 64`）。导出为 `intersectionDedupeTolerance(clouds)` 便于直接断言。按这个尺度去重的依据是探针量到的事实：**"同一交点的重复候选"是完全相等的**（交点正好落在采样顶点上时，相邻两条弦给出同一个 double，间距 `0.000e+0`），所以机器精度量级的容差就够了，不需要 1e-4 那么松。
- **RED→GREEN 证据**（新增 `packages/geometry-kernel/src/curve-dedupe.test.ts` 5 例）：
  - "交点数与图形平移到哪里无关"：圆心在 x = 0 / 20 / 1000 / 100000 时，近切割线都必须给出 **2** 个交点、间距 0.04~0.06。旧实现在 x=1000 与 x=100000 处返回 `kind: "point"`（两个交点被并成一个）。
  - "尺寸 2800 的图形上仍保住近切的一对"：旧实现返回单个点（旧容差 0.1 > 两交点间距 5e-5），现在返回 2 个。
  - "采样顶点上的重复候选仍被合并"：x 轴切原点处半径 1 的圆，仍然只给 2 个交点（不是 4 个）——这是新容差"没有松过头"的反向保护。
  - `intersectionDedupeTolerance` 直接断言：同尺寸图形在原点与在 x=1000 处**容差完全相等**；相对容差 ≈ 1e-9（并显式断言远小于旧的 1e-4 量级）；容差随图形尺寸线性放大（2 → 2000 时放大 1000 倍）。
- **过程中两次测试数据错误（我自己的，都被探针当场抓住）**：①把半径 1000 的圆的割线定义点写在 ±2000，而 `line` 是按 `a − 100u … a + 100u` 采样成有限折线的，采样窗口整段落在图形之外（表现为 `kind: "none"`）；②近切交点的间距由**折线在采样顶点处的折角**决定，不是由圆的曲率决定，我先按曲率估了间距，断言写成了 0.05（实际 5e-5）。两处都改成了不依赖手算几何的断言。
- **回归**：全量单测 **89 文件 / 1020 用例通过**（起始 88/1015）；`typecheck` 4 个 workspace 全过；`lint` 0 error、56 条 warning；生产构建通过；Playwright **69/69** 通过。

### 生命周期清理与画布尺寸稳定性（切片 3-2，2026-09-17 已完成）

- **需求**（用户原话）："修复图元依赖树与多交点定位 Bug……请先排查数据结构与渲染管道瓶颈"；设计文档里这一片是 F16/F17 的收尾（`docs/superpowers/specs/2026-09-17-3d-viewport-kernel-refactor-design.md` 第 3 区块）。
- **一项用户可见的真实缺陷（本轮的主要修复）**：**状态栏文案一变，3D 画布就被压矮**。上一片（1B）只是把它记录成"布局稳定性待修"并让测试绕开；这一轮查明根因并修掉：
  1. `.workbench` 的第二行是 `auto`，而状态栏**横跨整宽**这件事从来没写进 CSS——它被自动排进了第一列，也就是左面板那一列。1280×800 实测：状态栏只有 **240px 宽、116px 高**（一段提示被挤成 6~7 行），指针一悬停到剖切面预览上提示变长，页脚涨到 **150px**、画布从 **532px 掉到 498px**。
  2. 画布填满所在网格行（上一片刚做的），于是"面板高度"直接等于"画布高度"：同一个屏幕坐标不再对应同一个世界点。**用户点不中剖切面预览就是这么来的**——实测 pointermove 报 `hovering=true`、pointerup 却是 `off`。
  3. 修法：状态栏改为 `grid-column: 1 / -1` + 那一行改成**常量高度** `--status-bar-height`（宽屏 72px、≤900px 92px、≤680px 108px，取值按实测"最长提示 + 状态项在该宽度需要几行"定；放不下的部分由状态栏自己滚动，且 `align-content: safe center` 保证溢出时上沿不被裁掉）。≤960px 时右侧检查器整宽另起一行，那一行也从 `auto` 改成 `minmax(0, 45%)`。
  4. 连带查出**第二个画布缺陷**：≤960px 时检查器那一行没有上界，属性卡片能要 1700px，把 `minmax(0, 1fr)` 的画布行压成 **0**（768×800 选中一个立方体后 3D 画布高度就是 0，画布等于消失）。现在检查器那一行最多 45%，超出部分由 `.panel.right` 自己滚动，画布稳定拿到约 47%。
- **RED→GREEN 证据**（临时把两个 CSS 文件 stash 掉，重跑新用例，三条全部失败）：
  - `e2e/three-canvas-size.spec.ts` 新增 "keeps the canvas size when the status text changes"：悬停让提示变长后画布/外壳高度必须不变（旧实现断言 `after.shell === before.shell` 失败），并断言状态栏确实横跨工作台（旧实现 240 vs 1280）且内容不溢出。
  - 同文件新增 "keeps a usable canvas height at tablet widths"：960/900/768/700 四个宽度下选中实体后画布 ≥ 工作台的 35%、检查器自己滚动。旧实现实测画布高度 **0**（期望 ≥ 226.8）。
  - `e2e/geometry3d-section.spec.ts` 的"点剖切面预览即创建截面"**删掉了上一片留下的"点击前重新投影"绕行**，改为悬停与点击用同一个坐标——这正是用户报告的交互。旧实现下这条用例失败，现在通过。
- **3D 覆盖层不再每帧重建**（F17 的第三项）：测量标注与点标注以前每帧（拖动、相机过渡、窗口缩放）都 `replaceChildren()` 重建，一次拖动每秒重建 60 次。新增纯模块 `apps/web/src/overlaySync.ts`：按 key 复用节点，只在真正变化时写文本 / dataset / 位置 / 顺序，不在列表里的 key 才删除，`visible:false` 的节点保留但 `hidden`（相机转出视野再转回来不重建）。这不只是性能：测量标注带 `role="status"`，节点被换掉等于"出现了一条新消息"，读屏软件会把同一条标注**反复播报**——无障碍上的真问题。
  - `overlaySync.test.ts` 7 例（用 `MutationObserver` 断言"内容不变时 **0 次 childList 变更**"、同一节点对象被复用、就地改文本/位置/dataset、隐藏后复用、删除后重建、顺序跟随 entries）。
- **`dynamic-measurements.ts` 的订阅引擎定性**：按设计文档给的第二个选项处理——**明确标注为未接入的公开 API 并写清接线方式**（`evaluatePlanarMeasurement` 那条纯函数路径是生产路径，测量重算走场景图叶子；引擎提供的是拉/推双通道与累积漂移上报，接线时要复用**同一张** `DependencyGraph`，避免出现两个真值来源）。不删的理由是它带 30 个用例、是内核公开 API 的一部分，且接线方式写清楚后不会再被误读成"已经在跑"。
- **补上 `PropertiesBar.tsx` 的 `cancelAnimationFrame`**（F16 第三项）：插入公式模板后的一帧焦点跳转现在记在 `formulaFocusFrameRef` 里，卸载时取消——不再对着已经消失的输入框聚焦。
- **模板拓扑只在自身参数变化时重同步**：`syncTemplateTopology(primitives, dirty?)` 之前每次都按参数重算顶点，会把用户手工调整过的顶点（例如把某个顶点拖到 (7,7,7)）覆盖回去。现在只有"模板自己 dirty"（或全量重算）才重同步。
  - `packages/scene-graph/src/template-sync.test.ts` 3 例：改了边长顶点跟着走、无关改动后手工顶点**保留**、全量重算仍能修复它。
- **回归**：全量单测 **88 文件 / 1015 用例通过**（起始 86/1005）；`typecheck` 4 个 workspace 全过；`lint` 0 error、56 条 warning；生产构建通过；Playwright **69/69** 通过（起始 67）。

### 多解实体与就近吸附（切片 3-3，2026-09-17 已完成）

- **需求**（用户原话）：修正平面求交方程中多个实根被覆盖折叠的问题，为所有解独立分配 Entity 实体，并在光标划过时按屏幕像素距离就近吸附。
- **修掉三个真实缺陷**（前两个在排查阶段就已量化）：
  1. **解被折叠**：`solutionIndex` 的类型写死 `0 | 1`，App 里又用 `Math.min(1, …)` 再夹一次——点第 3 个及以后的交点会落到**第 2 个解**上（实测：直线与 `sin(x)` 有 7 个交点）。现在 `solutionIndex` 是**任意非负整数**（schema 校验非负整数），每个解一个独立实体。
  2. **解的顺序不稳定**：直线端点或两圆的相对位置一变，解数组的顺序就可能翻转，按索引取就会换解（实测过）。新增 `hint`（用户点选的那个解的坐标）：重算**取离 hint 最近的解**，并把选中的解写回 `hint`——吸引域语义（与 SolveSpace 的做法一致），于是"我点的那个解"始终跟着它走。
  3. **就近吸附**：2D 预览的点击原先由 SVG 绘制顺序决定（后画的会吃掉点击，两个解挨近时无法选中被压在下面的那个）。新增纯函数 `nearestPreview`：在命中半径内按**屏幕距离**取最近；浏览器里用 `getScreenCTM` 把光标换算进 SVG 坐标系。
- **RED→GREEN 证据**：
  - `packages/scene-graph/src/multi-solution.test.ts` 3 例：5 个下标给出 5 个**互不相同**的解且都落在直线上（旧实现会把 ≥2 的都夹到 1）；hint 指向 2π 时就取 2π，且把直线抬高 0.1 之后点仍留在"同一个"解附近（不跳到别的零点）；没有 hint 时按下标取，无解时隐藏而不是伪造坐标。
  - `packages/dsl/src/intersectionSolutions.test.ts`：任意非负整数下标 + 有限 hint 合法（旧文档缺字段也合法）；负数 / 小数 / 非有限 / 坏 hint 被拒。
  - `apps/web/src/nearestPreview.test.ts` 3 例：就近取解而不是取最后绘制的那个（数组顺序反转结论不变）、半径外返回 null、自定义半径生效。
  - `App.test.tsx` 新增"点第 5 个解就建在第 5 个解上"（断言 `solutionIndex === 4`、`hint` 与坐标一致；再点另一个解得到另一个点）。
- **过程中一次真实的自伤**：jsdom 的 SVG 元素**没有 `getScreenCTM`**，我先直接调用，导致 2 个既有 App 用例抛 `TypeError`；改为能力检测 + 回退（无 CTM 时退回"被点到的那个"）后恢复。就近判定本身由上面的纯函数单测覆盖。
- **回归**：全量单测 **86 文件 / 1005 用例通过**（起始 83/996）；`typecheck` 4 个 workspace 全过；`lint` 0 error、56 条 warning；生产构建通过；Playwright **67/67** 通过。
- **已知未做（明确记录）**：采样求交的去重容差仍是 `1e-4 × max(1,|x|,|y|)`——在 `|x| ≈ 1000` 处会把相距 0.05 的两个真实交点合并成一个（排查阶段的 F15）。本轮先修"选中了哪个解"，容差本身留作后续。**（2026-09-17 已修，见上文「采样求交的去重尺度（F15）」一节：容差改为只跟图形自身尺寸有关。）**

### 删除级联与批量并集校验（切片 3-1，2026-09-17 已完成）

- **需求**（用户确认的语义）：删除宿主时**级联注销**测量 / 2D 标注 / 工程标注 / 约束，分组自动移除成员，**只有"锁定"仍然拒绝删除**；并"杜绝图元无法删除的异常"。
- **修掉的三个真实缺陷**：
  1. **批量删除被逐个 id 预校验卡死**（实测：选中"点 + 依赖它的线"，两个都删不掉，尽管一起删是合法且显然的用户意图）。新增 `validateDeletion(document, ids)`：一次要删的全部 id 一起算作"自己人"，再做引用校验。**单删的拒绝语义不变**——`validatePatch` 那条路仍然保护用户搭出来的构造引用。
  2. **测量 / 标注 / 约束 / 分组阻止删除**。新增 `deletionPlan(document, ids)` 一次算出要连带处理的集合：测量、注释、工程标注、约束随宿主注销；**分组只摘掉被删成员**（空分组保留，不替用户丢容器）。**截面与截线也纳入级联**——它们和交点一样是纯派生对象，删来源实体时不该要求用户先手动清掉它们。
  3. **绑定点挡住宿主删除**。宿主消失时把点**降级为自由点并保留位置**（二维 `onPath` 与三维 `onHost/onFace/onSurface` 同样处理）：既不留悬空引用让文档存不下去，也不静默删掉用户的内容。
- **中间失败不再被吞**：批量删除的错误由 `operationError` 渲染出来（旧实现循环末尾 `setFileError(null)` 会把中途的错误盖掉）。
- **RED→GREEN 证据**：
  - 新增 `packages/scene-graph/src/deletion-cascade.test.ts` 7 例：计划集合正确、级联注销测量/注释/工程标注/约束、分组保留而成员被摘、绑定点降级且**位置保留**、截面随实体注销、并集校验（单删仍拒绝 / 一起删合法）、锁定仍拒绝、级联后文档仍能通过重算。
  - **改写 11 处编码旧语义的既有期望**（`patches.test.ts` 9 处、`intersectionLine.test.ts` 1 处、`App.test.tsx` 1 处、`e2e/geometry3d.spec.ts` 1 处）——这是用户确认的**行为变更**，每一条都改成了对新语义的正面断言（"删 X 会一起注销 Y 且文档仍合法"），不是放宽断言。
- **过程中的一个测试数据错误（我自己的）**：先用 `cube-1-edge-1` 当宿主，而模板实体的棱 id 实际是 `cube-1-edge-15…`（点与棱共用一个 id 计数器）。用一次性探针查清后改成从 `buildSolidTemplate` 取真实 id，并让"位置保留"这条断言真正可比。
- **回归**：全量单测 **83 文件 / 996 用例通过**（起始 82/990）；`typecheck` 4 个 workspace 全过；`lint` 0 error、56 条 warning；生产构建通过；Playwright **67/67** 通过。

### 3D 动点接入界面与拖动（切片 1A-3，2026-09-17 已完成）

- **需求**（用户原话）：使动点能严格沿宿主线段或曲面平滑滑动，拖拽时实时响应并同步驱动下游依赖图元重绘。
- **绑定入口**：选中的空间点新增「宿主绑定」下拉（空间直线 / 线段 / 射线 / 棱 / 面 / 圆柱与圆锥侧面）与参数输入（一维宿主一个参数；面与曲面为 u / v 两个）。绑定参数取**点当前坐标在宿主上的最近点**（内核 `closestParameter`），所以"绑上去"这一步点不跳；之后**参数是唯一真值**。解绑恢复自由点、坐标字段重新可编辑。
- **拖动**：按住绑定点 → 指针在世界平面上的落点**投影回宿主参数域** → 由参数算出坐标 → **每帧只重建这个点与它的下游对象**（`refreshPrimitiveObject`，复用与场景同步完全相同的构造器 `buildPointDrivenObject`，因此下游几何必然与文档重算一致）→ 抬手一次性提交**参数**。所以：整次拖动 = 一步撤销；点不会因为浮点累积而漂离宿主；下游图元在拖动过程中就跟着动（拖动期间不提交文档这一既有约定不变）。
- **新增读数**：`data-drag-parameter`（拖动中的宿主参数）、`data-host-residual`（拖动期间的宿主违反度）、`data-host-dependents`（这次拖动重建了几个下游对象）。
- **RED→GREEN 证据**：新增 e2e `e2e/geometry3d-host-drag.spec.ts`（一次通过）——拖动期间 `data-host-residual` ≈ 0、`data-drag-parameter` 确实改变、抬手后坐标改变且一次 `Ctrl+Z` **精确**回到原处；App 用例 `binds a spatial point to a host and slides it along the host parameter` 覆盖绑定/吸附/参数滑动/解绑，并用内核 `host3FromPrimitive(...).residual(position)` 断言点精确落在宿主上（1e-6）。
- **方法学注记**：拖动只写参数、坐标由重算派生，所以"点贴住宿主"这条不变式**由构造保证**；e2e 的残差读数是对这条不变式的直接观测，而不是另算一遍。
- **边界（明确未做）**：面 / 曲面绑定的拖动走同一条通道（uv），但 e2e 目前只覆盖一维宿主；拖动时刷新的下游范围限于点驱动的直线 / 线段 / 射线 / 棱 / 面（多面体、截面、平面片仍由整场同步更新）；绑定点仍需先开启「自由拖动」（与其它拖动一致）；绑定仍**不允许删除宿主**（区块三会改成级联 / 降级为自由点）。
- **回归**：全量单测 **82 文件 / 990 用例通过**；`typecheck` 4 个 workspace 全过；`lint` 0 error、56 条 warning；生产构建通过；Playwright **67/67** 通过（起始 66）。

### 截面几何重构（切片 1B，2026-09-17 已完成）

- **需求**（用户原话）：计算几何体与平面的实际截交闭合多边形，自动渲染仅渲染剖出的切面轮廓与半透明填充，并且可以获取截面图元。（设计见 `docs/superpowers/specs/2026-09-17-3d-viewport-kernel-refactor-design.md` 第 4 节，未单独出计划文件。）
- **修掉的三个真实缺陷**：
  1. **默认剖切面的坐标系不一致**：`solidSectionGeometry` 是 Z-up 迁移前的 **Y-up 遗留**（棱锥底面在 XZ、顶点沿 +Y；圆柱/圆锥的环也在 XZ），而实际渲染与截面重算走的是 **Z-up** 物化拓扑。于是"取包围盒中心的那个高度"算到了实体之外或边界上——上一轮实测到的"棱锥/圆柱/圆锥默认截面错位"就是这个。现已统一为 Z-up。
  2. **圆锥回退几何退化**：旧实现建了上下两个**同半径**的环，顶点又落在上环高度上，等于"顶面被扇形封口的圆柱"。已改为单底环 + 顶点。
  3. **截面只保留一条环**（`loops.sort(...)[0]`）：带孔或分成多块的截面会被丢掉一部分几何。现在返回**全部闭合环**（按面积降序）。
- **顺带修掉一个实测过的浮点悬崖**：旋转 90° 得到的法向带 ~1e-17 残差，同一个交点在不同面上算出的坐标差几个 ulp，固定 9 位小数的键分不开它们 ⇒ 报"点连不成闭合边界"（旧实现把它写成了"已知限制"）。点键改为**按模型尺度量化**：只用于身份判定与去重，**返回的坐标仍然精确**——第一版把交点吸附到量化格上，把 0.5 变成了 0.500000001，被既有测试当场抓住并改正。
- **默认剖切面**：法向由 `(0,1,0)` 改为 `(0,0,1)`（Z-up 世界里的真水平面）。改之前先用探针确认过"**干净**的 (0,0,1) 切立方体本来就正常"（失败只发生在旋转产生残差时），所以这个改动是安全的。
- **渲染**：`createSectionMesh` 为**每一环**画轮廓；外环带半透明填充、内环只画轮廓（不覆盖孔洞）；`userData.sectionLoopCount` 可读。DSL `SectionPrimitive.loops` 可选，旧文档按 `[points]` 处理。
- **新增「转为图元」**（`sectionMaterialization`）：每一环 → `point3 + edge3 + face3`，**不写 `sourceId`**，因此与来源解耦——删截面、删宿主都不影响它们，且它们能被移动 / 求交 / 测量。一次 `addPrimitives` 提交 = 一步撤销；属性栏「剖切面」区有按钮，多环时显示"独立边界 N 环"。
- **RED→GREEN 证据**：`section-loops.test.ts` 4 例（带残差的法向、两个互不相邻立方体各切一环、带孔"回"字棱柱两环、退化仍如实上报）；`section-materialization.test.ts` 3 例（点/棱/面的数量与闭合顺序、一条补丁加入且删来源后仍在、非截面/无环时拒绝）；`threeScene.test.ts` 补多环渲染断言（单环 1 圈边界、两环 2 圈）；`App.test.tsx` 补"物化后删掉截面，物化几何仍在"。既有 6 处期望值按新坐标系更新（默认法向、截面点坐标、取面选中的面、拖动方向）。
- **连带发现并记录的一个真实缺陷**：**状态栏文案变化会改变画布尺寸**——画布现在填满所在网格行，页脚文案一换行，画布就被压矮，于是**同一个屏幕坐标不再对应同一个世界点**。实测证据：pointermove 报 `hovering=true`，pointerup 的读数却是 `off`，点击落空。测试已改为"点击前按当前布局重新投影"；同时新增 `data-pick-readout` 诊断读数（正是它定位到了这次问题）。**"画布不应在交互中途改变尺寸"这一点仍待修**（属布局稳定性，已单列）。
- **回归**：全量单测 **82 文件 / 989 用例通过**（起始 80/981）；`typecheck` 4 个 workspace 全过；`lint` 0 error、**56 条 warning**（全部是既有规则类型）；生产构建通过；Playwright **66/66** 通过。

### 背景坐标系自适应 + 画布填满所在行（2026-09-17 完成）

- **用户报告**：①"点的坐标到 20 左右，图中就看不到了，会跑到图外面去"；②"背景坐标系的大小太有限了"；③"背景画布有时候太小了"。①已由 Auto-Fit 的"内容越界即重新构图"解决（见上一节），②③是另外两个真实缺陷。
- **② 背景坐标系太小 —— 根因**：栅格固定 **14 格、以原点为中心**，格边长只按内容对角线取整（`niceGridStep(max(对角线, 4) / 14)`）；坐标轴长 = `max(min(内容半径 × 1.6, 60) × 0.7, 1.2)`。内容离原点一远就必然覆盖不到。把旧公式照抄进单测可直接看到："立方体 + 一个位于 x = 20 的点"时坐标面只铺到 **±14**、坐标轴只有 **12** 左右，那个点落在坐标面之外的空白里；极端情况（只有一个远处点、对角线≈0）格边长被算成 0.5，坐标面缩成原点周围一小块。
- **② 的修复**：新增纯函数模块 `apps/web/src/sceneGrid.ts` —— 格边长按**可见范围**与**内容到达范围**自适应（1/2/5 × 10ⁿ）、栅格中心跟随视点中心并**吸附到格**（轨道旋转时线不抖）、坐标轴长度与可见范围同量级。栅格与坐标轴改为"单位尺寸几何 + 每帧摆放"，并新增读数 `data-grid-cell` / `data-grid-centre` / `data-grid-extent` / `data-axes-length`。
- **③ 画布太小 —— 根因**：`.three-canvas-shell` 的高度写死 `clamp(320px, calc(100vh - 420px), 820px)`，而它的父级（`.workbench` 的画布行）本来就是 `minmax(0, 1fr)`、可以撑满。于是画布比容器矮一截——实测 800px 高的窗口里**矮 150px**（380px vs 应有 530px），下面留一条空白；公式里的 420px 还跟真实的工具栏/页脚高度无关，窗口一变就"太小"。
- **③ 的修复**：`.three-canvas-shell { height: 100%; min-height: 0 }`，高度交给所在的网格行。
- **RED→GREEN 证据**：
  - `apps/web/src/sceneGrid.test.ts`（7 例）：含一条**照抄旧公式**的对照用例，断言旧范围到不了 x = 20 而新实现到得了；另有格边长随缩放变化、中心吸附到格、坐标轴量级三组断言。
  - `e2e/three-grid-coverage.spec.ts`（2 例）：点设到 x = 20 后栅格确实铺到那里（并仍盖住原点一带）、坐标轴也够长；缩小后坐标面跟着变大（否则画面四周又是空白）。
  - `e2e/three-canvas-size.spec.ts`（2 例）：画布填满它所在的那一行、窗口尺寸变化后依然如此。RED 实测：800px 高窗口下画布外壳 380px，而"工作台高度减页脚"是 530px。
- **连带修复（实测出来的）**：`e2e/geometry3d-section.spec.ts` 的抓取点原来写死"画布中心上方 20px"——画布比例一改就失准（这正是本轮暴露的）；改为按相机读数投影世界点，并抽出共享 helper `e2e/helpers/projection.ts`。**创建截面用环上的点 (2,0,0)、拖动截面用填充内的点 (0,0,0)**：这是用一次性探针实测出来的——边界上的点能命中预览虚线（创建），但命中不到截面的填充网格（拖动），两者不是同一个点。
- **回归**：全量单测 **80 文件 / 981 用例通过**（起始 79/974）；`typecheck` 4 个 workspace 全过；`lint` 0 error、**55 条 warning**（较上轮 -1：`threeScene.tsx` 里重复的 `niceGridStep` 导出已移入 `sceneGrid.ts`，少一条 `react-refresh` warning）；生产构建通过；Playwright **66/66** 通过（起始 62，+4）。

### 3D 视口 Auto-Fit（区块二，2026-09-17 已完成）

- **需求**：按可见图元的世界坐标 AABB 动态计算最佳视锥与相机距离；在图元加载、增删或越界时平滑重置视角并保留 30% 安全边距；彻底解决 3D 画布初始尺寸过小、图元显示受限的问题。
- **取景数学重写**（`threeScene.tsx`，全部是纯函数、可单测）：
  - `fitCameraState` 改为**逐角点**求解：对 AABB 的八个角各算"它要落在视锥内所需的最小距离" `|投影| / tan - 纵深`，取最大值，再除以 `1 - FIT_MARGIN`（0.3）留出安全边距。旧实现是"包围球 × 1.25"，对长条盒会把相机推得远远的；逐角点后 4×4×2 的盒子从只填 55% 提升到接近 70%。
  - **近远平面随距离缩放**（`near = distance × 0.01`，`far = max(distance × 100, 1000)`）：固定 `near = 0.1` 会让"0.01 单位的小模型凑近看"整块被近平面裁掉——这是"小图形框不满"的另一半原因。
  - 距离夹取从 `[3, 60]` 放宽到 `[0.005, 1e4]`（与滚轮缩放共用同一组边界，否则拟合到 0.02 之后一滚轮就被夹回 3）。
  - 新增 `isContentOutOfView`（八角投影是否越出视锥）、`interpolateCameraState`（过渡插值）、`shouldAutoFit`（策略纯函数）。
- **触发与过渡**：打开文件 / 切换工作区 / 恢复草稿 → 拟合；内容跑出视锥 → 拟合；拟合走约 250ms 的 ease-out 插值（`prefersReducedMotion` 时直接跳变），读数 `data-camera-fit` 记录次数。
- **开关与持久化**：画布新增「自动取景」按钮（`aria-pressed` + `data-autofit`），偏好存 `mathcanvas:3d-view`，跨刷新保留；重新打开开关会立刻拟合一次。
- **RED→GREEN 证据**：`sceneFit.test.ts` 先在 8/10 处失败（`isContentOutOfView is not a function` 等），实现后 10/10；`viewPreference3d.test.ts` 3/3；e2e 新增开关用例（默认开 → 关闭 → 刷新仍是关 → 重新打开）。
- **一处必须说明的行为变更（相对原计划收窄）**：原计划"增删图元也拟合"实测**打断了 7 条既有浏览器流程**（拖动实体时相机跟着实体走、移动截面时视角跳、按已知屏幕坐标点击顶点的用例全部失准）。用户的真实痛点是"图形太小 / 跑到视野外"，所以策略收窄为 `enabled && !dragging && (documentChanged || outOfView)`：**编辑过程中永不抢视角**，需求里的"增删时重置"以"增删后若内容越界就重置"的形式满足——这正是"新加的图元看不见"的解法。`AutoFitInputs` 因此去掉 `boundsChanged` / `cameraTouched`。
- **测试侧配套改动**（行为变更导致，不是放宽断言）：`geometry3d.spec.ts` 的「frames an opened figure…」由"编辑时相机不动"改为断言自动取景生效；`geometry3d-drag.spec.ts` 的「drags only the solid under the pointer」在开头关掉自动取景（它依赖固定屏幕位移）；两处新按钮点击改用 DOM 派发（显示控制排换行会让 `locator.click()` 等"位置稳定"而超时，仓库里「取面」已有先例）。
- **用户报告的现象与量化复现（2026-09-17）**：用户反馈"点的坐标到 20 左右，图中就看不到了，会跑到图外面去"。根因不是渲染，而是**没有任何东西重新构图**——旧实现只在文档 id 变化（打开文件 / 切换工作区 / 恢复草稿）时取景，手工编辑出来的远处图元永远留在视野外（相机停在距离 16、视锥半高约 6，x=20 的点自然在画外）。新增 e2e `e2e/geometry3d-autofit.spec.ts` 刻意**自证**：把点的「坐标 X」设为 20 后，先关掉自动取景，用页面读数（`data-content-bounds` + `data-camera-*`）按与 `applyCameraState` 同一套基向量约定重算八个角的 NDC，实测最坏角落在 **2.29**（视野外，即用户看到的现象）；再打开自动取景，同样的读数在约 250ms 过渡后收敛到 **≤ 1**（点回到画面内），相机中心从 0 移到 x > 5。只看相机数字变化是不够的，这条用例证明的是"点确实回到画面里"。
- **回归**：全量单测 **79 文件 / 974 用例通过**（起始 77/961）；`typecheck` 4 个 workspace 全过；`lint` 0 error、**56 条 warning**（起始 52，+4 全部来自 `threeScene.tsx` 新增纯函数导出触发的既有 `react-refresh/only-export-components` 规则）；生产构建通过；Playwright **62/62** 通过（起始 60）。
- **边界**：~~相机状态仍不跨工作区保留（切到平面几何再回来会重置）~~ **（2026-09-17 已做，见「场景增量同步与相机记忆」一节：`cameraMemory.ts` 按"文档 + 视角"在会话内记住）**；本片新增的 warning 根因是 `threeScene.tsx` 混着组件与纯函数。**（2026-09-17 已处理相机与取景数学那一半：抽出 `threeCamera.ts`，lint 56 → 42 条；剩下的纯几何构造器见下文「相机与取景数学抽出独立模块」一节的"仍未做"。）**

### 3D 动点宿主约束内核（切片 1A-2，2026-09-17 已完成）

- **需求**：让动点能严格"贴"在宿主上滑动——宿主覆盖线段 / 射线 / 直线 / 棱 / 面 / 平面 / 圆柱与圆锥侧面；坐标由参数算出，而不是每帧叠加位移。
- **新增内核** `packages/geometry-kernel/src/hosts3.ts`（与 2D `planar-constraints.ts` 同构）：
  - `Host3` 只回答三件事：`evaluate(参数)` 正向映射、`closestParameter(点)` 反向映射（结果一定在域内）、`residual(点)` 违反度；`domain` 声明参数域（线段与棱 `[0,1]`、射线 `[0,∞)`、直线无界、圆柱/圆锥侧面 `u ∈ [0,2π)` 闭合 + `v ∈ [0,1]`）。
  - **唯一不变式**：参数是唯一真值、坐标只是派生缓存（借鉴 JSXGraph 的 Glider 语义），所以连续拖动不会漂离宿主。
  - 面宿主会把环外的点**夹到环边界**（否则"绑到三角形面上的点"可以停在面外的虚空里）；平面宿主无界。
  - 圆锥的最近点是**解析解**：绕轴对称 ⇒ 只需最小化 `(ρ - r + r·v)² + (dz - h·v)²`，驻点 `v = (h·dz - r·(ρ - r)) / (r² + h²)`，不做数值搜索。
  - `host3FromPrimitive` 从 DSL 图元解析宿主（`line3` 两种定义 / `segment3` / `ray3` / `edge3` / `face3` / `plane3` 两种定义 / `cylinder` / `cone`），退化输入与缺失引用一律返回 `null`。
- **数据模型**：`Point3Binding` 新增 `onHost{hostId, parameter}` / `onFace{faceId, uv}` / `onSurface{solidId, uv}`；`schemaVersion` 仍为 `"0.1"`，旧变体与旧文档行为不变。schema 校验**引用存在性与类型**（悬空宿主会让点静默冻住却仍能保存，这是仓库里踩过的坑）。
- **重算接入**：`resolveBoundPoint3` 由参数算出坐标（宿主解析失败时返回 `null`、保留点上一次坐标，不静默挪动）；参数在重算层夹进宿主域；`primitiveDependencies` 登记宿主 ⇒ 拓扑序与删除保护自动覆盖。
- **RED→GREEN 证据**：
  - `hosts3.test.ts` 先因模块不存在整体失败（`Failed to resolve import "./hosts3"`），实现后 **12/12**。
  - `point3HostBindings.test.ts`（dsl）先在合法绑定上报 3 条校验错误，实现后 **3/3**。
  - `point3HostBindings.test.ts`（scene-graph）先有 5 处失败（点没跟着参数走、端点移动后没跟着变、参数越域没夹取、曲面与面绑定不生效），实现后 **6/6**。
- **回归**：全量单测 **77 文件 / 961 用例通过**（起始 74/940）；`typecheck` 4 个 workspace 全过；`lint` 0 error、**52 条 warning**（持平）；生产构建通过；Playwright **60/60** 通过。
- **过程中的两个决定**：①参数夹取放在重算层而不是 `evaluate`（保持 `evaluate` 是纯正向映射，夹取语义只在一处、可单测）；②`edge3` 的宿主 `kind` 记为 `"edge"` 而不是 `"segment"`（保留来源信息，参数域相同）——第一版测试期望写错，按实现改正。
- **边界（明确未做，交给切片 1A-3 与区块三）**：本片结束时功能**不可从界面触达**——绑定入口、拖动状态机与"拖动时实时重绘下游"都在 1A-3；`isFreeDraggable3` 仍只放行 `free`；删除宿主时把点降级为 `free` 也在区块三（当前是拒绝删除以保文档合法）。

### 3D 渲染管道去重建化（切片 1A-1，2026-09-17 已完成）

- **需求**：3D 画布每次父组件重渲染都会销毁并新建 `WebGLRenderer`——挂载效应依赖数组含 `document` 与每次渲染都换身份的 `onSelect`，重建时 `renderer.dispose()` + `new THREE.WebGLRenderer()` 并替换 canvas。于是悬停、提示、错误、展开动画的每一帧都在换画布（浏览器 WebGL 上下文数量有限），也让相机动画与拖动预览随时被打断。这是后续所有实时拖拽与视角动画的前置障碍。
- **修复**（方案 A 第一步，计划见 `docs/superpowers/plans/2026-09-17-three-scene-lifecycle.md`）：
  - 挂载效应依赖改为 `[]`：文档 / 选择 / 显示开关 / 预览 / 选中回调 / 预览点击回调一律经 ref 读取（新增 `displayFlagsRef`、`previewRef`、`onSelectRef`、`previewClickRef`）。
  - 内容构建整段搬进 `syncContent()`：内容对象经 `addContent()` 登记、`clearContent()` 逐个释放（新增 `disposeObject`）；渲染器、canvas、事件监听留在挂载期。
  - 新增内容同步效应：只有 `sceneContentKey` 签名变化才调 `runtimeRef.current.syncContent()`；换文档时在该运行时里重新取景。
  - 新增读数 `data-scene-builds`（本次挂载创建渲染器的次数，恒为 1）与 `data-scene-syncs`（内容同步次数）。
- **RED→GREEN 证据**：
  - `sceneContentKey.test.ts` 先因模块不存在整体失败（`Failed to resolve import "./sceneContentKey"`），实现后 5/5；过程中发现**测试自身写错**（每次新建文档导致 `metadata.id` 不同），改为复用同一份文档。
  - `sceneSyncDecision` 先在 `threeScene.test.ts` 失败（`sceneSyncDecision is not a function`），实现后该文件 49/49。
  - 新增 `e2e/geometry3d-scene-lifecycle.spec.ts`：编辑 / 显示开关 / 新增图元 / 展开动画之后 `data-scene-builds` 仍为 `"1"` 且 canvas 节点未被替换；拖动过程中（**抬手前**采样）`data-scene-syncs` 不增长、`data-drag-frames` 增长。旧实现下这两条必然失败（实测 `data-scene-builds` 为 `null`）。
- **过程中抓到并修掉的两处既有回归**（都是"闭包过期"）：`onPreviewClick` 用首次渲染的闭包（App 的实现闭包着它自己那份 `document`）导致点击虚线预览创建不出截线；换文档时的自动取景留在挂载效应里导致打开 `.mgeo` 不再取景（既有 e2e 期望 `0.50,0.50,0.50`、实际 `0.00,0.00,0.00`）。
- **回归**：全量单测 **74 文件 / 940 用例通过**（起始 74/938）；`typecheck` 4 个 workspace 全过；`lint` 0 error、**52 条 warning**（与基线持平——`sceneSyncDecision` 特意放在纯函数模块而不是组件模块，避免多一条 `react-refresh` warning）；生产构建通过；Playwright **60/60** 通过（起始 59）。
- **边界（明确未做，交给切片 1A-1b）**：内容对象仍是"清空后重建"，展开动画每帧仍会重建几何，只是不再重建 WebGL 上下文与 canvas；按 `primitiveId` 的增量 diff 尚未落地。**（2026-09-17 已由 1A-1b 落地：按内容签名增量同步，见「场景增量同步与相机记忆」一节。）**

### 平面几何动点系统（2026-09-17）

**需求**：引入在特定约束（直线、圆锥曲线、函数图像）上自由运动的点，并处理由动点驱动的复杂几何关系与轨迹求解，先做平面几何。

**交付（四个维度，全部接进主流程）**：

1. **约束模型与参数化映射**（`packages/geometry-kernel/src/planar-constraints.ts`、`dynamic-points.ts`）。约束 = 一条一维曲线 + 它的**自然参数**，只回答三件事：`evaluate(t)` 正向映射、`project(q)` 反向映射（投影最近点）、`residual(q)` 违反度。于是拖拽与动画收敛成同一个状态更新（`project(指针) → t → evaluate(t)` 对 `t += Δt → evaluate(t)`），下游依赖图不需要区分点是被拖出来的还是播放出来的。`DynamicPoint` 的**唯一不变式**：参数是唯一真值、坐标是派生缓存，所以点永远精确落在约束上，不会在连续拖动后逐渐漂离曲线。非线性隐式约束支持任意 `F(x,y)=0`，用**拉格朗日–牛顿法**求最近点（雅可比 `[[I+λH, ∇F],[∇Fᵀ, 0]]`，带回退线搜索与多起点）；具名圆锥曲线另有精确参数化。
2. **依赖图与增量拓扑重算**（`dependency-graph.ts` + 接入 `scene-graph`）。Kahn 拓扑排序、脏闭包、环路径检测；脏集是**全局拓扑序的子序列**，所以按拓扑序过滤即可，拖拽时不需要重跑拓扑排序。`recomputeDerivedObjects` 现在按 `topologicalRecomputeOrder` 重算，并在每算完一个对象后更新查找表，因此下游读到的是刚算出的上游值；`recomputeBoundPoint3s` 那个"最多重跑 N 遍直到不动"的循环随之删除。
3. **动态测量**（`dynamic-measurements.ts`）。测量作为依赖图的**叶子**，天然继承剪枝。拉（`readings()`）推（`subscribe()`）双通道；变化判定的基准是**上一次对外报告的值**而不是上一次算出的值——用后者会把连续小幅漂移逐步吞掉，UI 会一直显示已经偏离很远的旧值。角度用 `atan2(|cross|, dot)` 而不是 `acos`，避免接近 0/π 时出现 NaN。
4. **轨迹采样与消元法隐式化**（`locus-sampling.ts`、`polynomial.ts`）。三阶段采样：均匀粗扫 → 用**中位数**步长定位断点（均值会被异常跳跃本身污染）→ 只在连续段内部按曲率自适应细分。断点先定、细分后做，所以不会把两条分支重新连起来。消元法用 **BigInt 精确有理数 + Sylvester 矩阵 + Bareiss 无分数消元**，从约束方程直接推出轨迹的隐式方程（验收：圆上动点与定点中点的轨迹解出 `4x² + 4y² − 8x + 3 = 0`，即圆心 `(1,0)` 半径 `1/2` 的圆）。

**用户反馈驱动的四轮修复**（都是真缺陷，先写失败测试再修）：

- **动点活动范围过小**：绑定参数一律被 `clamp(t, 0, 1)`，而直线在画布上是横贯整个视野画的——用户看到一条长线，点却只能在 `a..b` 段里滑动（实测 `b=(1,0)` 的直线上拖到 x=10.5 会被截到 x=1）。改为**自然参数**后，能滑多远由曲线自己决定。附录：`parameterWindow` 只决定滑块与轨迹扫多远，**拖动本身不受它限制**。
- **椭圆只能在上半部分运动**：内核违反了自己的契约——`parameterBounds` 声明椭圆参数周期为 `[0, 2π)`，但 `project` 会返回负角（下半部分），应用侧按 `[0,1]` 归一化时负角被截断成 0，整段下半部分塌到右顶点（实测拖到 `(0,-1)` 停在 `(4,0)`）。修在内核（折回声明域）并补了契约测试：64 个方向 × 3 个距离 × 椭圆/圆，断言投影永远落在声明域内。
- **删除图形需先删交点**：`deletionTargets` 改为**固定点迭代**求级联闭包，交点家族 / 轨迹 / 连接 / 导函数等纯派生对象随来源一起删除。"点 → 连接 → 连接与圆的交点"这类链条一趟只能收到中间层，所以迭代是必需的而不是保险。**有意保留的边界**：注释、分组、约束、测量指向被删对象时仍然拒绝删除（它们是用户自己写下的内容），这一点有 5 个既有测试保护。
- **驱动参数不可见也无生命周期**：绑定产生的 `t-<点id>` 此前不可见、删点后也不回收，而且绑定会盲取文档里第一个参数（在圆锥曲线工作区就是 `slope`），导致"路径参数"输入框完全失效、拖点会顺带转动无关直线。现在每个动点拥有**自己的**驱动参数（带 `ownerId`），代数区底部新增「参数」分组可改值/上下界/步长/名称，删除时按**孤儿**判据回收（带 ownerId + 归属已不存在 + 无人引用），手工创建的参数不受影响。

**测试捕获并修复的缺陷**（11 个，全部是写测试时才暴露的）：弧投影对"角度刚过 2π 起点"的点吸附到错误端点；非有限指针坐标永久破坏点状态；`linearConstraint.residual` 对线段外的点返回 0（量到了无限直线而非约束集）；`hyperbolaConicCoefficients` 把 `axis` 语义搞反（顶点处算出 −72 而非 0）；`coefficientsIn` 删掉被消变量导致指数向量错位（消元得 3/7 而非 −1/3）；Sylvester 矩阵行长度不足越界读 `undefined`；`recomputeAll` 把源节点当种子导致 `compute` 从不执行；测量容差以"上次计算值"为基准导致漂移永不通知；`recomputeBoundPoint3s` 缺拓扑序；二维点绑定与轨迹源点未纳入引用保护（悬空引用使文档**存不下去**）；连接未进依赖图也不能求交。

**过程中我自己犯并当场发现的错误**（记下来避免重犯）：改动测试时用 PowerShell `Set-Content` 批量替换，它默认按 ANSI 写，把测试文件的 UTF-8 中文写坏成非法 UTF-8——已用 `git checkout` 恢复并改用文件工具重写（此后不再用 shell 重定向改源码）；一次"保持 old/new 相同"的编辑实际吃掉了换行符导致语法错误；`deletionTargets` 的孤儿参数判据第一版只看"本次被删"，先删点 A 再删点 B 时永远收不掉参数；删除级联一度放宽成"级联对象身上的注释/测量也自动清理"，被 5 个既有测试挡回后明确收敛为"只级联纯派生对象"。

**RED→GREEN 证据**：新增 193 个测试——
`planar-constraints.test.ts`（约束与动点不变式，含 64 方向周期域契约）、`dependency-graph.test.ts`（拓扑序、脏闭包、剪枝、异常隔离）、
`dynamic-measurements.test.ts`（十种度量、四种状态、累积漂移上报）、`locus-sampling.test.ts`（渐近线分支纯度、曲率细分弦误差）、
`polynomial.test.ts`（结式已知值、尺度不变的消元验收、隐式等值线），以及 `scene-store.test.ts` / `patches.test.ts` / `App.test.tsx` 的集成与 UI 用例
（含"拖动被约束的点沿曲线滑动"、"一次操作删掉直线与其交点"、"连接曲线的动点与另一点后拖动，线段跟随"）。

**回归**：`npm run typecheck` 4 个 workspace 全过；全量单测 **73 文件 / 933 用例通过**；`lint` 0 error、**52 条 warning**（其中本轮新增的 4 个内核文件贡献 5 条未使用变量，见「验证证据」的规则分布）；生产构建通过；Playwright **58/58** 通过（本轮未新增 e2e 用例，沿用 9/16 的 58 个）。

**已知限制（明确未做）**：
- **消元法（`resultant` / `eliminate`）尚无 UI 调用方**，是四个维度里唯一"内核可用、产品未用"的部分。
- 结式消元的**增根因子**只做标记不做自动剔除；权威做法是 Gröbner 基，实现成本高得多。
- 隐式约束的 `residual` 是**一阶估计** `|F|/|∇F|`，不适合当精确距离；需要精确值请用 `project().distance`。
- 平面测量复用 `Measurement3` 容器（`kind: "measurement3"` 命名名不副实）；可用度量只有 length / distance / angle / area，内核里的 ratio / perimeter / radius / coordinate / signedArea / slope 还没有入口；**连接线段的长度也还没有测量入口**。
- 参数面板**不支持清空**「最小/最大/步长」（`patch.field ?? current.field` 分不清"没提供"与"要清空"）。
- 抛物线/双曲线绑定要拖到更远需手动放宽「参数域」（默认是与图形尺度成比例的窗口）。
- 连接的 `polyline` / `parabola` 变体不参与求交（抛物线连接用的是二次贝塞尔控制点，不是真正的抛物线）。
- **3D 动点**仍是既有 `Point3Binding` 机制（`onLine` / `onPlane` / `derived`），尚未接入本套 `PlanarConstraint` / `DynamicPoint` 抽象；3D 的点-线-面拓扑也不在删除级联范围内。

### 拖动丝滑化与运行期修复（2026-09-16）

- **用户反馈**：「自由移动手感不好，而且是'一帧一帧'地移动，我想要丝滑的」。复现后确认是**真缺陷**，不是手感问题。
- **根因（实测）**：拖动时把位移直接写进 Three.js 对象的位置，但**没有触发重画**。Three.js 不会因为改了 `object.position` 就重新渲染，画面要等"别的渲染顺带发生"才更新一次。用真实浏览器统计 WebGL draw call（20 次连续 `pointermove`）：
  - 修复前：**只有 3 / 20 次**真的重画（第 1、11、15 次），其余每次的绘制增量都是 0；
  - 修复后：**20 / 20 次**，每次移动都有一次完整重画。
- **修法**：应用临时偏移后立刻 `render()`，并把原因写进代码注释，避免以后被当成可删的"多余重画"。
- **同时修掉的相关缺陷**：拖动途中场景会被重建（选中变化、窗口尺寸变化都会重建），新场景的对象回到文档位置，已经"画上去"的偏移就丢了，观感是一次**回弹/闪跳**。现在场景构建后会立刻把进行中的拖动偏移补画回去（`resumeDragVisualRef`）。
- **顺带简化提交策略**：拖动期间不再按节流提交文档——每次提交都会重建整个场景的几何与材质，本身就是顿挫来源；现在画面完全由临时偏移负责，抬手一次性提交，`一次拖动 = 一步撤销` 也因此更纯粹。
- **运行项目时又发现并修掉两个缺陷**：
  1. **原地点击创建截面失效**：浏览器不保证在 `pointerdown` 之前先发 `pointermove`，而"指针是否在预览上"的标志只在 `pointermove` 里维护，所以不移过去直接点会因为读到过期状态而创建不出截面。现在点击时**按点击位置重新做一次射线判定**，并把判定抽成 `previewHitAt` 供悬停与点击共用。
  2. **旧开发服务器提供过期编译缓存**：5173 上那个进程服务的是旧 `threeScene.tsx`（不含 `previewKindRef` / `pickSectionAt`），在它上面点击创建截面无效。诊断期间我读到过自相矛盾的两次结果（同一条 URL 先"缺该标识符"、后又有），因此**该读数不作为判据**；可靠证据是行为差异（5173 创建不出 / 新鲜构建可以）加构建产物对比。现统一用 5174。
- **RED→GREEN 证据**：`e2e/geometry3d-drag.spec.ts` 新增一条"自由拖动期间必须逐次重画"的用例——读 `[data-3d-scene]` 上的 `data-drag-frames`（拖动期重画计数），按 20 次 `pointermove` 断言 ≥10（浏览器会合并部分 `mousemove`，所以不死抠 20）。旧实现在这条用例下必然失败（实测 3 次）。
- **回归**：全量单测 **68 文件 / 730 用例通过**；生产构建通过；Playwright **58/58** 通过（原 57 + 新增 1）。
- **剩余（明确未消除）**：拖动途中仍会发生约两次场景重建（触发源尚未定位），在长距离拖动时会造成轻微顿挫。这已不是"不重画"问题，而是"重建频率"问题——如需继续优化，从这里入手。

### 剖切面自由摆放（2026-09-16）

- **需求**：在"剖切面可移动"之后实现**自由摆放**——改朝向，并支持"用一个面当剖切面"。
- **内核**（`packages/scene-graph/src/operations.ts`）：
  - 新增 `rotateSectionPlane`（绕世界轴、可选枢轴）与 `setSectionPlane`（直接给定平面）两个操作；`rotatedSectionPlane`、`sectionPivot`、`sectionDistanceToPlane`、`planeThroughPoints`（≥4 点判共面）四个纯函数。校验覆盖轴/角度/枢轴/法向退化/非有限值/锁定对象。
  - **枢轴的选择有实测依据**：绕平面**自身垂足**旋转会把刀口推出实体（平面到原点距离 1.5 → 0.15，截面消失），所以界面绕**实体中心**旋转——学生要的"把刀口摆斜"是绕着图形转，倾斜后截面仍要看得见。枢轴因此参数化，默认仍保留纯几何语义。
  - **修掉一个我自己写错的判据**：共面容差原本乘上点集尺寸，导致"点集越大越松"（圆柱侧面那圈顶点会被当成平面）。现在判各点到平面的**绝对**距离。
- **界面**：
  - 属性面板新增「剖切面」区块：法向量 / 截面点数 / 分类读数，以及绕 X/Y/Z 各 ±15° 的倾斜按钮（枢轴由 App 按实体顶点中心算出）。
  - 画布显示控制新增「取面」：点它再点实体上的某个面，该面即成为选中截面的剖切面；`planeThroughPoints` 拒绝不共面的环（曲面侧边），所以不会塞进瞎猜的平面。
- **这轮踩到并修掉的两个非功能性坑（都是实测发现，值得记下来）**：
  1. **新按钮把显示控制那排挤成多行，导致画布尺寸反复重算**：`geometry3d.spec.ts` 里三条既有用例开始 30 秒超时，报"展开按钮一直不可见/不稳定"。把新按钮从右侧视角控制挪到左侧显示控制并限制文字换行后恢复。
  2. **e2e 用 `locator.click()` 点这个按钮会与场景重建互相等待**（真实浏览器里按钮位置稳定、可点，probe 实测坐标 5 次采样完全一致）。该用例改为 `evaluate` 直接派发 DOM click，并在中文注释里写明原因——测的是取面逻辑本身。
- **RED→GREEN 证据**：
  - `operations.test.ts` 的 `section plane` 扩到 12 条（新增：绕给定枢轴倾斜且截面仍穿过实体、连续多轴倾斜后截面始终存在且法向保持单位长、90° 变成竖直面并保持在枢轴上、`sectionPivot` 取点集中心、`setSectionPlane` 用立方体的 x=1 面当剖切面且截面四点都在 x=1、退化/非有限/坏轴被拒、不共面点被拒）。写这些用例时改正了两处**我自己的错误测试数据**：三点永远共面（不能用来测"不共面"），以及圆周上的点当然共面。
  - `e2e/geometry3d-section.spec.ts` 扩到 5 条（新增：属性面板倾斜 15° 后法向变化、截面仍成立、反向转回原值；取面后法向改变且截面仍有边界）。
- **已知限制**：绕轴切到**正好 90°**（法向落在坐标轴上）时截面会解析失败——**同一个平面直接写进文档也一样失败**，所以这是 `geometry-kernel` 里 `chainSectionLoops` 对轴对齐平面的既有边界问题，与本轮改动无关；10°–80° 全部正常。已在用例注释中标注。**（2026-09-17 已修：切片 1B 查明这其实是旋转产生的 ~1e-17 残差让"同一个交点"在相邻面上算出几个 ulp 的差异，点键改为按模型尺度量化后，默认水平面（法向 `(0,0,1)`）与"以面为剖切面"（法向落在一根轴上）都能正常成环——两条都在 `e2e/geometry3d-section.spec.ts` 里覆盖。）**
- **回归**：全量单测 **68 文件 / 730 用例通过**（新增 7 例）；`typecheck` 4 个 workspace 全过；`lint` 0 error；生产构建通过；Playwright **57/57** 通过（原 55 + 新增 2）。

### 截面的显示与生成可发现性修复（2026-09-16）

- **用户反馈**：「截面的显示和截面的生成操作方式都比较不清晰」。
- **复现与根因**（浏览器实测 + 读代码，四类问题都不是手感问题而是硬缺陷）：
  1. **截面预览根本点不动**：`threeScene.tsx` 只在提供了 hover 回调时才挂"点击创建"，而 `App.tsx` 对 `section` 预览显式传 null；再加上"点/棱拾取优先于创建"的规则，实体的面/顶点总会先被命中，截面的那圈虚线永远轮不到。实测：选中立方体后点画布中心的虚线**完全没有反应**。
  2. **状态栏不说这条虚线是什么**：实测原文是「已选中立方体 1 · 拖动控制点调整形态，按 Delete 键删除」。
  3. **「创建截面」名不实**：只切 `sectionPlaneThroughSource` 的默认面（法向 Y、过顶点高度中点），用户无法预知切在哪。
  4. **剖切面创建后不能调**，且创建后的实心橙色面与预览的红色虚线没有共同线索。
- **内核**（`packages/scene-graph/src/operations.ts`）：新增 `moveSectionPlane`（沿法向平移，只改常数项：`constant - distance * |normal|`）、`movedSectionPlane`、`sectionPlaneOffset`、`sectionSourceVertices`；校验拒绝非截面 / 锁定 / 非有限距离。
  - **顺带修掉一个真实 bug**：拖动实体时挂在它上面的截面**不会重算**（截面按 id 引用来源，不在依赖索引里）。实测证据：立方体沿 X 平移 2 后截面四点仍是 `x=±1`；补上显式重算后变成 `x=1/3`，与实体同步。
  - 实现里我自己引入又靠测试抓回的一个错误：**同时单位化法向并移动平面会让平面多漂移 `|n|-1` 个单位**（法向 (0,3,4)、距离 1 时实测多走 2 个单位）——现在只改常数项、法向原样保留。
- **画布与界面**：
  - 截面预览改为**闭合虚线 + 半透明剖切面片**（`createPlanePatch` 按来源实体在平面上的投影自动定尺寸），让"切在哪"可见；预览组的 `excludeFromFit` 必须为真，否则面片会把"适应视图/平移边界"撑大（实测平移边界从 15 涨到 15.36）。
  - **点那圈虚线即创建截面**；创建后选中截面，在**自由拖动**模式下**拖动截面**或按**方向键**（1 个单位，Shift 细调 0.2）即可沿法向移动剖切面，抬手/按键各提交一次、一步撤销。
  - 状态栏：未指向剖切面时保留「已选中…」（这也是用户需要的信息），指向时才解释"点击即创建、之后怎么挪刀口"。
  - 属性面板与画布对象树的截面条目沿用既有渲染。
- **过程中挖出的另外两个真实缺陷**：
  - `createSectionMesh` 的多边形分支**从未设置 `userData.primitiveId`**，而 `pickRaycastHit3` 会跳过没有该字段的命中——所以**截面根本无法被拾取**。
  - 拖动时抓到的是剖切面片而不是截面本体（面片又大又正对相机）；现在面片不参与拾取（`raycast` 置空）。
- **回归与教训**：为了让截面能被点中，我先把 `pickKindAllowance.section` 调大，结果**抢走了立方体顶点/棱/Alt 面的点击**（实测：点顶点选中了「截面 1」）；随后改为让**截面预览的命中区只保留它那圈边界线**（把整块剖切面当命中区会覆盖实体的大片投影，点任意顶点都算"指向预览"），并让手柄拾取与预览按**深度**比较先后。4 条回归因此全部恢复。
- **RED→GREEN 证据**：
  - `packages/scene-graph/src/operations.test.ts` 新增 `section plane` 6 例（默认面、平移并同事务重算截面、逼近面时截面变小 / 越界后归零、非单位法向不漂移、非截面 / 锁定 / NaN 被拒、拖实体时截面跟随）。
  - `apps/web/src/threeScene.test.ts` 新增 `section cutting plane` 4 例（法向单位化与退化拒绝、面片覆盖实体足印、退化法向不画面片、面片跟随平面而不是实体）；`statusPrompts.test.ts` 按新语义更新（未悬停不抢状态栏 / 悬停解释创建与移动）。
  - 新增 `e2e/geometry3d-section.spec.ts` 3 例：指向剖切面才解释、点击即创建（`data-section-count 0→1`、4 边形）；方向键 `0 → -1 → -2 → -1.8`、越界后 `data-section-point-count = 0`；拖动截面改变平面常数且一次撤销复位。
- **回归**：全量单测 **68 文件 / 723 用例通过**（新增 10 例）；`typecheck` 4 个 workspace 全过；`lint` 0 error 且我改动的文件没有新增 warning 类型；生产构建通过；Playwright **55/55** 通过（原 52 + 新增 3）。
- **边界**：剖切面目前只能**沿法向平移**（默认法向为 +Y，即水平剖切面），还没有改朝向（绕轴旋转 / 选择某个面作为剖切面）的入口；拖动截面需要先开启「自由拖动」，方向键同样只在该模式下接管。

### 立体几何自由拖动（2026-09-16）

- **需求**：立体几何新增「自由拖动」选项，开启后点击即可拖动图形。
- **拖动范围（用户确认）**：全部 3D 对象——模板实体（立方体/棱锥/圆柱/圆锥）、空间点，以及由点驱动的线/线段/射线/棱/面/平面；顶点手柄在拖动模式下也按"拖动整个图形"处理，避免一次误抓就把实体拆成点驱动。
- **内核**（`packages/scene-graph/src/operations.ts`）：
  - 新增操作 `translatePrimitive3`（世界向量平移）。模板实体平移到自己的定位参数（`origin` / `baseCenter` / `center`），生成拓扑由 `syncTemplateTopology` 跟随；点驱动对象平移的是它**按 id 引用的点**，这些点 id 一并进 `changedIds`，所以同一次提交里截面、测量、中点等派生对象都会重算。
  - 新增判定 `isFreeDraggable3` 与 `templateTopologyIds`：**模板实体生成的点/棱/面不允许单独拖动**（它们是从父级算出来的，单独拖会把实体悄悄拆散）；绑定/派生点、锁定对象同样拒绝。校验放在 `patches.ts`，越界操作返回 `object is not draggable` 而不是静默成功。
- **画布**（`apps/web/src/threeScene.tsx`）：
  - 新增纯函数 `dragWorldPoint`（与相机自身基向量的屏幕平面求交，**深度不变**）、`dragFamilyIds`（拖动族闭包：对象 + 它引用的点 + 生成拓扑的父级）、`applyDragOffsets`（把位移逐帧画到场景对象上，不重建场景）。
  - 拖动状态存在 `dragSessionRef` / `pointerStateRef`（组件作用域，不是 effect 内）：**拖动期间文档一次都不提交**，抬手才提交唯一一次操作。这一步是必须的——早期版本按 150ms 节流提交，实测一次 90px 的拖动会留下 4 步撤销，用户要按 4 次 Ctrl+Z 才回到原位。
  - 新增「自由拖动」按钮（与「平移视角」互斥，左键只能有一种含义）、`data-drag-mode`、move 光标、随模式切换的画布提示与状态栏说明（`statusPrompts.ts` 新增 `free-drag`）。
  - 顺手补上 `data-camera-azimuth` / `data-camera-elevation` 读数：旋转只改角度、不改视点中心，没有这两个读数就无法在测试里判断"视角到底转没转"。
- **RED→GREEN 证据**：
  - `packages/scene-graph/src/operations.test.ts` 新增 `free 3D drag` 8 例（实体+生成点整体移动、尺寸不变、点驱动线段/直线跟随、绑定点被拒但父级拖动时跟随、生成拓扑被拒、锁定与 NaN 被拒、一次拖动一步撤销）。
  - `apps/web/src/threeScene.test.ts` 新增 6 例（沿相机屏幕轴而非世界轴移动、相机转向后方向跟随、同一指针位置映射唯一、拖实体带上生成拓扑、拖直线带上端点且不牵连共享点的面、临时偏移可正向叠加与反向撤销）。写这几条时改正了两处自己写错的断言：相机在方位角 0 时屏幕右方是**世界 +Y**（不是 +X），且点驱动的 `face3` 只依赖点、不依赖线。
- **浏览器实测**（`e2e/geometry3d-drag.spec.ts`，5 例）：拖动后图形位移 > 0.2 且 `data-camera-target` 与方位角**完全不变**；一次 Ctrl+Z 即回到原位；关掉按钮后同样的左键拖动恢复为旋转视角（角度变、图形不动）；拖一个立方体时另一个立方体原点不动；平移视角与自由拖动互斥。
  - 过程中用一次性探针脚本量到两个真实数字，避免了两处误判：`data-content-bounds` 的包围盒边长含点手柄半径（4.10 而非 4），以及位移/像素在画布 CSS 尺寸下的正确比例（0.299 世界单位/像素 × 748/320 = 0.0336 实测值，拖动是线性的 45/90/180px → 1.51/3.03/6.05）。
- **回归**：全量单测 68 文件 / 713 用例通过（新增 15 例）；`typecheck` 4 个 workspace 全过；`lint` 0 error（无新增 warning，且顺带消掉了 `threeScene.tsx` 原有 2 条 `exhaustive-deps` 之一——拖动回调改走 ref，不再进依赖数组）；生产构建通过；Playwright **52/52** 通过（原 47 + 新增 5）。
- **边界**：拖动发生在屏幕平面（深度不变），没有沿视线的纵深拖动；一次拖动只提交一次，所以拖动过程中属性栏不会实时刷新数值，抬手后立即更新。

### CAD 2D 绘图交互重做（2026-09-16）

- **用户反馈**：「工程绘图似乎不好画图」，要求参考开源项目优化。
- **复现与根因**（读 `DrawingViewport` 实测，三条都是硬伤，不只是手感）：
  1. **坐标系随内容跳**：`draftBounds(document)` 按已画内容自适应算 viewBox，空文档是 `-4..4`；画下第一个点后窗口立刻缩放到该点附近 → 用户落第二个点时参照系已经换了，等于没法连续作图。
  2. **创建过程零反馈**：`creationStep` 只存在于 `App`，没有传给视口，所以画直线/圆/圆弧/折线时画布上什么都不显示，必须点完最后一下才知道对不对。
  3. **没有捕捉与约束**：点击直接按像素换算成图纸坐标（会是 `-13.7264957` 这种值），既无法对齐已有端点/中点/圆心，也无法画水平线；同时 2D 模式下 `view.scale` 完全没被使用，标题栏的 −/＋ 是死按钮。
- **修复**（纯 SVG/React，无新依赖）：
  - 新增 `apps/web/src/drafting.ts` 纯内核：`draftWindow`（固定窗口，比例 1 跨 100，只随 `view.scale` 缩放）、`draftGrid`（主 10mm 自适应加粗 + 次 1mm 仅在屏幕间距 ≥8px 时显示）、`clientToDraft`（像素→图纸坐标，y 向上，落点收敛到 0.001）、`draftSnapCandidates`（端点/中点/圆心）、`resolveDraftSnap`（**捕捉优先级 端点 > 中点 > 圆心**，同级取最近，容差外返回 null 以保留自由落点）、`constrainAngle`（正交 90°/极轴 45° 投影）、`draftMeasurement`（长度 + 0–360° 方位角）。
  - `DrawingViewport`：2D 模式改用固定窗口与栅格；新增指针悬停 → 捕捉 → 角度约束的解析链路（**捕捉优先于正交**，用户明确指到端点时不被拽到轴线上）；渲染橡皮筋预览（直线/线段/射线/折线/圆/圆弧与最终形状同构）、捕捉标记与类型标签、实时「长度 · 角度」读数；标题栏新增「自由 → 正交 → 45°」切换按钮，按住 `Shift` 可临时正交。做图元绑定：这些图层都是临时 UI 状态，不写进 `.mgeo`。
  - `DrawingSheetView` / `App`：把进行中的 `creationStep` 透传给绘图视口，仅用于预览。
- **RED→GREEN 证据**：`drafting.test.ts` 16 个用例先因模块不存在整体失败；`DrawingViewport.test.tsx` 新增 5 个用例先在旧实现上失败（固定窗口 `expected "0 -48.4 100.7 100.7" to be "-50 -50 100 100"`、捕捉标记不存在、`[data-draft-preview]` 不存在等）。实现后全部通过。过程中修掉两个自己写错的断言（缺自适应网格导致缩小后画 202 条主网格线；像素→坐标换算算错）。
- **既有测试的行为微调**：「maps a drafting click on the paper to document coordinates」改用空文档作为夹具——旧夹具的线段端点落在 12px 捕捉半径内，会被新吸附正确吸住，而这条用例本意只是验证坐标映射；另把 `-0` 归一为 `0`。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例断言拖动时有预览与读数、画完 `viewBox` 与画前完全一致、指针靠近已有端点时出现 `[data-draft-snap="endpoint"]`。
- **回归**：全量单测 60 个测试文件、567 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条既有 warning（无新增）；生产构建通过；Playwright 38/38 通过。
- **开源调研（已完成）**：`docs/research/drafting-interaction-patterns.md`（176 行、89 条来源链接、27 处许可证标注）。文档以「现状基线（已实现）」+「尚未实现」开头，把调研重点放在未完成部分：交点/垂足/切点/最近点/象限点捕捉、捕捉候选 Tab 循环、动态输入与命令行坐标、夹点编辑、框选方向语义、命中容差、偏移/修剪/延伸；并给出「不借鉴」清单与许可证速查（QCAD 是 **GPL-3.0**、JSketcher 为 Autodrop3d 自定义许可，均不能按宽松依赖评估）。
- **本轮补完的两项（调研文档点名的缺口）**：
  1. **栅格捕捉接线**：`snapToGrid` + 新增 `draftGridSnapStep`（取最细可见网格：次网格可见时 1mm，否则主网格）此前是死代码；现在标题栏有独立开关，捕捉优先级为 **对象捕捉 > 栅格捕捉 > 角度约束**（有专门的用例：端点位于非整格坐标 `(3.5, 7.25)` 时，开了栅格捕捉仍然吸到端点）。
  2. **极轴语义修正**：`constrainAngle` 原先对所有角度都取最近 45° 倍数 —— 那不是极轴追踪而是"把光标永久锁在 45° 的倍数上"。现在加了 `thresholdDegrees`：正交（含 Shift）**始终**压到轴上，45° 极轴**只在指针偏离射线 ≤4° 时**吸附，否则保持自由落点。
- **本轮抓到的一个真实缺陷**：`resolvePointer` 的返回值被 TypeScript 推断成 `snap: string | null`，`npm run typecheck` 报 TS2345。`vite build` 只做类型擦除，不会发现这类错误——这正是 typecheck 必须单独跑的原因。已用显式返回类型修掉。
- **RED→GREEN 证据（本轮）**：`drafting.test.ts` 新增 4 个用例（最细网格步长、正交严格性、极轴阈值内/外）与 `DrawingViewport.test.tsx` 新增 2 个用例（栅格捕捉默认关闭→开启后量化到 10mm；对象捕捉优先于栅格捕捉），实现后 33 个聚焦用例通过。
- **回归（本轮结束）**：全量单测 60 个测试文件、572 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条既有 warning（无新增）；生产构建通过；Playwright 38/38 通过（e2e 新增断言：栅格捕捉开关从 `off` → `on`，且远离图元处出现 `[data-draft-snap="grid"]`）。
- **本轮之后的进展（2026-09-16 已全部完成）**：动态输入与命令行坐标（绝对 `12,34` / 相对 `@10,5` / 极坐标 `@20<45`，放视口工具栏）、框选方向语义（左→右包含 / 右→左相交）与 Esc 分级、命中容差（线宽改为像素量级 + 14px 透明命中带）、切点捕捉与工程图线宽、偏移/修剪/延伸。逐项根因、RED→GREEN 证据与实测见本文件上方对应小节。

### 偏移 / 修剪 / 延伸（调研清单最后一片，2026-09-16 已完成）

- **内核几何**（新增 `packages/geometry-kernel/src/editing.ts`，13 个用例）：`offsetPrimitive`（直线类沿**行进方向左侧**平移，负值右侧；圆/圆弧改半径且拒绝 ≤ 0；折线逐段偏移后用相邻偏移线求**斜接点**，折返平行时退回直接平移顶点）、`trimPrimitive`（目标支撑直线 ∩ 边界，边界按自身范围过滤、目标不过滤，保留靠近 `near` 的一半）、`extendPrimitive`（只接受落在当前跨度**之外**的交点；边界落在跨度内时返回 null，那是修剪该干的事）。三个函数只返回几何结果，不依赖 scene-graph。
- **Web 映射**（新增 `apps/web/src/draftEditing.ts`，11 个用例）：`resolveGeometryEdit` 做前置条件校验并组装文档补丁。
- **写错后改掉的语义**：真正的 OFFSET 应**新建**一个平行对象，我最初实现成"把选中对象移走"——那是移动命令。现在偏移 → `create`，修剪/延伸 → `update`；复制时**不继承 `slopeParameter`**（副本不该继续被原对象的参数驱动）。typecheck 还抓到我漏了类型收窄（圆没有 a/b，不能修剪），已补显式判断与用例。
- **视口 UI**：绘图视口新增「偏移距离 + 偏移 / 修剪 / 延伸」，按选中数量门控（偏移需 1 个、修剪/延伸需 2 个），规则写进按钮 `title`，成败走 CAD 状态栏提示。
- **浏览器里挖出的真实 bug（本片最大收获）**：偏移之后再画图元会被**静默丢弃**——`data-revision` 不变、`role="alert"` 为空、CSV 导出（权威文档内容）里也没有新对象，但状态栏流程正常走完。定位过程：先在 jsdom 复现同一流程（**正常**，说明不是 store/App 逻辑）→ 浏览器探针确认连续两次创建**本来正常**（所以与偏移有关）→ 用 CSV 导出排除"只是没渲染" → 用 `data-revision` 排除"apply 生效了"。结论：`creationStep` 被清空但没有任何 apply，唯一符合的路径是**点到已有图元时 `updateSelection` 清掉了创建状态**——即 2D 绘图视口缺少"创建优先"的点选语义（数学画布 `GraphicsView.handleObjectClick` 早就有），而我这一轮刚把命中带加宽到 14px，于是"第二点落在已有图元附近"就更容易触发。
  - **修复**：`DrawingViewport` 新增 `handleDraftPrimitiveClick`——创建进行中点图元走 `onCreateAt`（并保留吸附与 Tab 候选序号），没有创建时才选中。同时把 `resolvePointer` 改成显式接收 `svg/clientX/clientY`，这样从图元组的事件里也能取到正确的元素矩形。
  - **回归测试**：`DrawingViewport.test.tsx` 新增 2 个用例（创建中点击图元 → 落点且**不**选中，落点仍是吸附后的端点 (2,1)；无创建时点击 → 选中）。
- **RED→GREEN 证据**：`editing.test.ts` 13 个用例先因模块不存在整体失败；`draftEditing.test.ts` 10 个用例先因模块不存在失败，改语义后又补了 1 个（圆不能修剪）；e2e「offsets, trims and extends」在修复前**必定失败**（延伸按钮拿不到 2 个选中）。
- **浏览器实测**：e2e 覆盖偏移（1→2 个图元、revision 增加、状态栏"已偏移"、副本与原线平行且有间距）+ 延伸（短竖线拉到边界、高度增加、状态栏"已延伸"）+ 修剪（穿线被剪短、状态栏"已修剪"）；选择用模型树行点选（命中带可能重叠，树行是确定性的，顺序正好是"先边界后目标"）。
- **回归**：全量单测 65 个测试文件、672 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 43/43 通过。
- **边界**：偏移只做平行复制（不做等距曲线族的自交清理）；修剪/延伸只支持直线、线段、射线；圆/圆弧修剪（拆成多段圆弧）明确列为未实现，遇到会报错而不是猜。

### 切点捕捉 + 工程图线宽与命中容差（调研清单收尾 ①②⑦，2026-09-16 已完成）

- **切点捕捉**（调研清单里的最后一种捕捉类型）：
  - 内核 `snap-geometry.ts` 新增 `tangentPointsOnPrimitive(primitive, from)`：直角三角形 C-T-P 在 T 处为直角，切点相对 C→P 方向偏转 ±`acos(r/d)`；锚点在圆内返回空、正好在圆上只有一条（切点即锚点）、圆弧只保留扫过范围内的切点。
  - `drafting.ts` 的 `SnapKind` 增加 `tangent` 并插在 `perpendicular` 之后（`nearest` 仍然垫底）；候选只在有创建锚点时生成；视口标签显示「切点」。
  - 测试里发现一个真实细节：锚点在圆心正上方时 `(0,5)` 同时是**垂足**和**象限点**，而象限点优先级更高——所以"垂足必然胜出"的断言是错的，改成断言两类候选的相对顺序（这也顺带证明了去重与优先级确实生效）。
- **命中容差（调研第 8 项「细线点不中」）——挖出的根因比预期严重**：
  - 用临时 Playwright 探针实测：绘图图元的 `getComputedStyle().strokeWidth === "0.04px"`，`vector-effect: non-scaling-stroke` 下这个值就是**屏幕像素**，所以整张工程图本来就是一条约 `0.04px` 的**隐形线**；`elementFromPoint` 在离中心 `1px` 处就已经点不中（命中带约 `0.1px`）。即"不好画图"的一半原因是**看不见也点不中**。
  - 修复一（可见）：`.engineering-drawing-primitive` 与 `.engineering-drawing-draft` 的线宽从 `0.018/0.022/0.04` 改为 `1.4/1.6`、选中 `2.4`（单位就是屏幕像素）。
  - 修复二（可点）：绘图与投影图元各加一条 **14px 透明命中带**（`data-drawing-hit="true"`）。
  - **两次被 CSS 级联击败**（都由 e2e 度量发现，而不是肉眼）：`.engineering-drawing-hit`（0,1,0）先被 `.engineering-drawing-draft line`（0,1,1）覆盖；提成 `(0,2,0)` 后又被 `.engineering-drawing-draft.is-selected line`（0,2,1）覆盖。最终改为**内联样式**给宽度（inline 胜过任何选择器），CSS 只留 `cursor`。
  - 第三次失败是单位搞错：`non-scaling-stroke` 意味着宽度**本身就是像素**，而我先填了世界单位的 `2.69`（≈2.7px 带）。改成直接给 `14`。
  - 还纠正了自己一个错误度量：最初用 `getBoundingClientRect().height` 当"渲染高度"（量到 0.085），但 SVG 的 gBCR **不包含** `non-scaling-stroke` 的描边宽度，这个数不能用；真正的证据是计算线宽。
- **RED→GREEN 证据**：`snap-geometry.test.ts` +4（两个切点、圆内/圆上退化、圆弧扫过范围、直线无切线）；`drafting.test.ts` +2（切点候选只在有锚点时生成、切点排在垂足之后）；新增 e2e `e2e/engineering-drawing-hit.spec.ts`——断言计算线宽 ≥ 1px、`elementFromPoint` 在离中心 0/2/5px 处都命中图元、点击离线 5px 处确实选中而不是新建图元。**这个 e2e 用例在修复前必然失败**（线宽 0.04、1px 就点不中），它同时钉住了两个缺陷。
- **回归**：全量单测 63 个测试文件、642 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 42/42 通过。
- **清单状态**：调研文档的优先级 ①②④⑤⑥⑦ 与「栅格捕捉接入捕捉链」「极轴阈值触发」全部完成；只剩原文就标注为"更后一片"的**偏移 / 修剪 / 延伸**。

### CAD 2D 绘图命令行坐标 + 动态输入（调研优先级 ⑥，2026-09-16 已完成）

- **依据**：调研文档「命令行与动态输入（坐标精确化）」——拖得再准也不如敲数字，尤其是工程图里的整数尺寸。
- **解析器**（新增 `apps/web/src/draftCoordinate.ts`，13 个用例）：支持 AutoCAD 的三种写法——绝对 `12,34`、相对 `@10,5`、极坐标 `@20<45`；另接受空格分隔与**全角逗号**（中文输入法下不用切换），负小数可解析；相对/极坐标**必须有基点**，否则报错而不是悄悄按原点算；单数字不是坐标（交给动态输入的长度字段）；非有限值（如 `1e999`）被拒。另有 `parseDraftDistance`（必须 > 0）、`parseDraftAngle`（归一化到 0–360）、`applyDistance`（只改长度、保留指针方向，指针压在锚点上时退回 +x 避免除零）、`applyAngle`（只改角度、保留长度）、`formatDraftCoordinate`。
- **接线**（`DrawingViewport.tsx`）：视口工具栏新增「坐标」输入框（回车提交，落点走与鼠标点击**同一条** `onCreateAt` 路径）；创建进行中额外显示「长度 / 角度」两个字段，其 placeholder 实时显示当前指针的尺寸，回车按输入值落点（只改一个维度、另一个沿用指针）。非法输入在工具栏给出说明且不落点。
- **一个刻意的取舍**：动态输入放在视口工具栏，**不做光标旁浮层**。图纸带 CSS `zoom`，在 SVG 里用 `foreignObject` 放 HTML 输入框的定位与清晰度都不稳；固定位置换来可测、可控，键盘流（输入 → 回车）完全一致。这是本片与调研文档描述的差异，已写入功能目录。
- **RED→GREEN 证据**：`draftCoordinate.test.ts` 13 个用例（先因模块不存在整体失败）；`DrawingViewport.test.tsx` 新增 4 个（绝对坐标落点并清空输入、相对与极坐标、非法输入只报错不落点、长度/角度字段只在有锚点时出现且按 10 得到 (6,8)）。
- **e2e 的两次失败尝试（值得记录）**：想在浏览器里断言"敲进去的 40mm 就是屏幕上 40mm 的比例"，先按 padding + `preserveAspectRatio` 较小边估算比例 → 差 3.98px；再改用坐标读数自校准（两次 hover 反推每单位像素）→ 差 64px（很可能受吸附影响）。最终把精确几何留给单测（`@40<0` → 基点 +(40,0) 已有精确断言），e2e 只断言与布局无关的事实：敲完确实生成了一条**水平**、有明显长度的线段，输入框被清空，revision 增加。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例——点第一个点后键入 `@40<0` 回车生成线段 → 选中后两个夹点 y 相同、间距 > 30px。
- **回归**：全量单测 63 个测试文件、636 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 41/41 通过。

### CAD 2D 绘图方向框选 + Esc 分级（调研优先级 ⑤，2026-09-16 已完成）

- **依据**：调研文档「框选方向语义与 Esc 分级」——左→右为窗口选择、右→左为相交选择，且 Esc 要分级而不是一次性全清。
- **几何判定进内核**：新增 `packages/geometry-kernel/src/selection.ts`，导出 `pointInSelectionBox` / `primitiveInSelectionBox`（window）/ `primitiveCrossesSelectionBox`（crossing）/ `selectPrimitivesInBox`。要点：
  - 圆的"圆周是否穿过框"用**半径 ∈ [圆心到框的最近距离, 圆心到框内最远角落距离]** 判定：大圆把框整个套住时圆周并不经过框，不该被相交框选选中（去掉上界就会误选，这一点用变异检验确认过）。
  - 无界直线/射线按定义它的两个端点判定（保留数学画布的历史语义），相交模式下用一个足够长的线段近似它去和框的四条边求交。
  - 圆弧没有解析的框相交判定，按**与渲染相同的 24 段**采样，保证"看到的形状"和"选中的形状"一致；折线按其各段。
  - 顺手把 `curve-intersections.ts` 里的 `segmentIntersection` 由私有改为导出，框选与采样求交共用一份实现。
- **方向语义接线**：`drafting.ts` 新增 `boxSelectionMode`（方向→语义）与 `normalizeSelectionBox`；`GraphicsView` 与 `DrawingViewport` 都在拖动时就带上语义，矩形分别用 `data-selection-mode` / `data-draft-box` 标记，样式上窗口选择实线、相交选择绿色虚线（一眼可辨）。CAD 2D 绘图新增框选：空白处按下拖框才启动，**有创建挂起或按到图元/夹点时不启动**（否则会把"点第一个点"或"拖夹点"误判成框选）。
- **Esc 分级**（`App.tsx`）：创建/CAD 命令 → 操作指引 → 选择，逐级取消；没有待取消的动作时保持不动，不会误删文档。
- **过程中修掉的两个真实缺陷**：
  1. **`keydown` effect 依赖数组陈旧**：`creationStep` / `activeCommand` / `guidance` 都不在依赖里，分级 Esc 读到的全是旧值、按下去毫无反应。已补齐依赖。
  2. **`selection.ts` 重复的 circle 分支**：恢复变异时把整个分支写重了，第二个分支被 TypeScript 窄化成 `never` 而报错——由 `npm run typecheck` 抓到（`vite build` 只做类型擦除，发现不了）。
- **变异检验（两次，结果不同）**：第一次删掉 crossing 的"包含即相交"早返回 —— **没被抓到**，因为该性质对每种类型都是结构性成立的，这个变异是语义等价的、什么也没证明；第二次去掉圆的"最远距离"上界 —— 被抓住（"套住框的大圆"用例 `expected true to be false`）。这说明第一版测试的强度边界，也说明变异检验本身需要挑真正有区别的变异。
- **RED→GREEN 证据**：`selection.test.ts` 13 个用例（两种语义、圆的相切/套住/穿过、无界图元、折线与圆弧采样、跳过 `point3`）；`drafting.test.ts` +2（方向→语义、矩形归一）；`DrawingViewport.test.tsx` +2（拖动中矩形带正确语义并在松手时提交、有创建挂起时不启动框选）；`App.test.tsx` +1（Esc 分级：先关指引、再清选择、文档不变——这条用例第一次写错，暴露了"指引优先于选择"的真实顺序）。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例——画线段后右→左拖框（断言 `data-draft-box="crossing"` 出现 → 线段 `data-selected="true"` → `data-revision` 不变），再左→右拖一个不完整包含的框（断言 `data-draft-box="window"` → 不选中）。
- **回归**：全量单测 62 个测试文件、619 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 40/40 通过。
- **边界**：数学画布的函数、圆锥曲线与派生曲线仍只有"完全包含"语义（没有解析的框相交几何）；CAD 绘图还没有「先框选再执行移动/删除」的命令式工作流，框选目前只改选择状态。

### CAD 2D 绘图夹点编辑（调研优先级 ④，2026-09-16 已完成）

- **依据**：调研文档把「夹点编辑」列在捕捉之后，并明确要求**直接复用 `interaction.ts`，但容差必须按屏幕像素换算，不能用默认 0.35**。
- **做了什么**：
  - `interaction.ts` 新增 `primitiveHandlePoints(primitive)`，把控制点几何从 `GraphicsView` 里提出来成为共享纯函数（线段/射线端点、折线顶点、抛物线顶点与旋转、圆半径、圆弧起止角与半径中点、椭圆/双曲线三轴）；`GraphicsView` 改为调用它，**两个视口不再各写一份手柄几何**（派生对象、锁定对象、无手柄图元一律返回空数组）。
  - `DrawingViewport` 新增夹点：选中图元才显示控制点；按下控制点 → `createDragAction(primitive, handle, origin, current)`；按下图元本体 → 先用 `getDragHandle(primitive, point, gripTolerance)` 判断是否落在控制点上，否则整体平移。拖动期间用 `applyOperation` 生成**临时文档**做预览（端点移动时关联交点跟着重算），指针抬起才把 `DragAction` 交给 App 提交成一次可撤销改动；位移小于半个夹点半径视为误触，不提交。
  - 容差换算：`gripTolerance(width) = DRAFT_GRIP_PIXELS / width * span`（`DRAFT_GRIP_PIXELS = 8`）。调研文档点名的这个坑是真的——默认 0.35 世界单位在跨度 100 的窗口里只有约 1.7px。
  - `DrawingSheetView` / `App` 透传 `onDragEnd`，与数学画布共用 `handleDragEnd`（`translatePrimitive` / `updatePrimitive`）。
- **RED→GREEN 证据**：`interaction.test.ts` 新增 3 个用例（端点手柄、折线/圆/圆弧手柄、锁定与派生对象无手柄）；`DrawingViewport.test.tsx` 新增 4 个（选中才显示夹点、拖端点提交 `update` 动作、微小位移不提交、拖本体提交 `translate`）。实现后 28 个聚焦用例通过。
- **过程中修掉的自己的错**：测试里把端点 `(-2,-1)` 的像素位置算成 `clientY 208`（实际 204，窗口 400px / 跨度 100 → 4px 每单位）；另一个用例拿半径 1 的小圆测"拖本体"，但 8px 夹点容差等于 2 世界单位，圆心的按下被正确判成半径编辑——改成拖线段本体（中点距端点 2.24 单位，超出容差）才测到翻译语义。
- **浏览器实测**：`e2e/engineering-workbench.spec.ts` 新增用例——画线段 → 点本体选中 → 断言出现 `[data-draft-handle="a"]` → 按住拖动（断言 `data-draft-dragging` 由 true 变 false）→ `data-revision` 增加 → 夹点位置随端点移动。
- **回归**：全量单测 61 个测试文件、601 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 39/39 通过。

### CAD 2D 绘图捕捉扩展（调研优先级 ① ②，2026-09-16 已完成）

- **依据**：`docs/research/drafting-interaction-patterns.md` 把「扩展捕捉类型」与「捕捉候选排序 + Tab 循环」列为最值得先做的两项；本切片按该优先级实施。
- **几何原语落在内核**（文档要求，不在 UI 里重复实现几何）：新增 `packages/geometry-kernel/src/snap-geometry.ts`，导出 `nearestPointOnPrimitive` / `perpendicularPointOnPrimitive` / `quadrantPointsOnPrimitive` / `planarIntersections`。实现要点：
  - 图元先拆成「支撑直线 + 范围规则」或「圆 + 范围规则」两种原子（折线拆成多段、圆弧按扫过角过滤），范围判定统一在原子层，因此"看起来在图元上"和"真的在图元上"一致。
  - `nearest` **夹取**到实体自身范围（线段收到端点、射线收到起点、圆弧收到扫过范围内的最近端点），这是"实体上最近点"的数学定义；`perpendicular` **不夹取**——脚点落在实体之外时垂足不存在。
  - 交点复用既有 `intersectLinesDetailed` / `intersectLineCircleDetailed` / `intersectCirclesDetailed`，只补范围过滤与去重，不重写求交算法。
- **候选编排与排序**（`apps/web/src/drafting.ts`）：`SnapKind` 扩展为 `endpoint | intersection | midpoint | center | quadrant | perpendicular | nearest | grid`；新增 `rankDraftSnaps(raw, candidates, { tolerance, primitives })` 返回**按优先级 → 距离排序**的候选数组，并按位置去重（两条线段共端点时"端点"与"交点"重合，只保留优先级更高的）。`nearest` 由指针位置决定，不能预先列举，因此只在排序时按 `primitives` 现算，并**固定排在最后**——否则它在数学上永远最近，会吃掉所有其他候选。`resolveDraftSnap` 保留旧签名（返回最优候选）以兼容既有调用与测试。
- **视口接线**（`DrawingViewport.tsx`）：候选按「文档 + 锚点」`useMemo` 缓存（交点计算是 O(n²)，不能每次指针移动重算）；垂足需要创建锚点，因此把 `creationAnchor` 作为 `from` 传入；命中多个候选时按 **Tab** 循环（`<svg>` 在 2D 模式获得 `tabIndex`，`onKeyDown` 里 `preventDefault`），标记标签显示「交点 2/3（Tab 切换）」与 `data-draft-snap-candidates`，让状态可被测试与 e2e 断言。
- **RED→GREEN 证据**：`snap-geometry.test.ts` 15 个用例（象限点、圆弧扫过范围、最近点夹取、垂足不夹取、线段/直线/圆/圆/折线/圆弧求交与范围过滤）；`drafting.test.ts` 新增 6 个（象限点、交点、垂足需要锚点、按优先级去重、`nearest` 垫底、极轴阈值）；`DrawingViewport.test.tsx` 新增 2 个（交点与象限点捕捉标记、Tab 循环后点击落在第 2 个候选上）。实现后 40 个聚焦用例通过。
- **本轮修掉的两个自己写错的地方**（都由门禁而不是肉眼发现）：`drafting.ts` 里旧的 `*_PRIORITY` 常量未删除导致重复声明（esbuild transform 直接失败）；`nearestPointOnPrimitive` 里 `candidate` 的初值从未被使用，被 ESLint `no-useless-assignment` 判为 **error**。另外把「圆弧最近点在扫过范围外」的语义从"返回 null"改成"夹取到圆弧端点"，并修正了测试里标错方向的"下半圆"用例（0°→90° 的四分之一圆弧才是可判定的）。
- **回归**：全量单测 61 个测试文件、594 个用例通过；4 个 workspace 类型检查通过；lint 0 error、40 条 warning（无新增）；生产构建通过；Playwright 38/38 通过（e2e 增加"实体中段给最近点"的断言）。

### Ribbon UI 重构（2026-09-15）

- [x] 统一 Top Bar、工作区 Tab 和 Ribbon；移除重复的工作区按钮与旧命令入口。
- [x] 实现折叠、临时呼出、图钉固定和 `Ctrl + F1` 快捷键；修复折叠态点击图钉时被外部点击逻辑提前关闭的问题。
- [x] 默认工作区使用内部 `conics`；保留立体几何、CAD 和旧 `.mgeo` 兼容。
- [x] Inspector 显示精简空状态、对象名称及锁定/删除快捷操作。
- [x] 底部状态提示覆盖选择、创建阶段和 CAD；Escape 取消命令并恢复默认提示。
- [x] 390px 手机视口采用对象列表/属性检查器抽屉；修复内容超过 `100vh`、顶部搜索框遮挡标签的问题。
- [x] 将旧 E2E 选择器迁移到新 Ribbon 命令和 Inspector 交互。

**Ribbon 基线验证（2026-09-16）：** `npm.cmd test` 为 59 个测试文件、533 个用例通过；四个 workspace 类型检查通过；ESLint 0 error、40 warnings；Web 生产构建通过；Playwright 34/34 通过，覆盖桌面、平板、手机视口、Ribbon 折叠/临时呼出/固定、CAD 工作流与 `.mgeo` 往返。修复后的操作指引浮层不再覆盖状态栏，Ribbon 外部点击回归通过。Vite bundle 仍提示超过 500 KB（约 1.52 MB，gzip 约 476 KB）；jsdom 的 Three.js WebGL 未实现提示不影响测试结果。

### 2026-09-16 后续 UI 优化（Task 7-13，已完成）

- [x] 将工作区显示名从“圆锥曲线”改为“平面几何”，保留内部 `conics` ID 和旧文件兼容。
- [x] 将平面几何新点默认名统一为 `A、B、C`（`Z` 之后回退 `P27`…），补充 3D 场景点名显示。
- [x] 将图元重命名入口移动到默认可见的「几何参数」区（原先只在需展开的「外观样式」里）。
- [x] 将多模态入口收敛为“文字转换”和“图片转换”；服务未接入时保持禁用并说明原因。
- [x] 从右侧属性区移除约束和智能体展示，但保留约束数据和真实测量能力。
- [x] 根据 Dock 展开状态扩大工程制图中间画布。
- [x] 修复工程制图图纸本身没有铺满画布的问题（按可用区域等比缩放并居中）。
- [x] 工程制图视觉重做（Task 14）：制图台 + 图纸层次、图框与图签、视图框刻度、显式缩放与响应式修复。
- [x] 在选择法向量、测量二面角时补充左下角操作提示。
- [x] 工程制图可用性修复（Task 15，切片 A + A2）：2D 绘图命令搬到图纸外的工具条，读数按视图单位定尺。
- [x] 工程制图可用性修复（Task 16，切片 B）：工程制图可切换投影来源为立体几何文档，空状态说明原因并互相指路。
- [x] 工程制图可用性修复（Task 17，切片 C1-C4）：新增 `intersectionLine` 图元与面环求交内核；相交时显示虚线截面/截线预览，悬停有说明，点击即创建持久化图元。

详细设计与分任务步骤见 [`docs/superpowers/specs/2026-09-15-ribbon-ui-redesign.md`](./superpowers/specs/2026-09-15-ribbon-ui-redesign.md) 和 [`docs/superpowers/plans/2026-09-15-ribbon-ui-redesign.md`](./superpowers/plans/2026-09-15-ribbon-ui-redesign.md)。

#### Task 7：平面几何改名、A/B/C 点名与重命名入口

- **可见名称**：`WorkspaceTabs` 的标签改为「平面几何」，`conics` ID、`.mgeo` 数据与工作区切换逻辑不变；`AppChrome.test.tsx` 断言新标签存在且「圆锥曲线」不再出现，`App.test.tsx`、`e2e/ribbon-ui.spec.ts`、`e2e/workbench.spec.ts` 的选择器同步迁移。
- **点名**：`App.tsx` 的 `nextPointLabel()` 由 `新点 A` 改为按未占用字母分配 `A`…`Z`，`Z` 之后回退 `P27`、`P28`…；测试用新的 `pointObjectRows()` 辅助函数按 `.object-name` 精确匹配单字母，避免 `getAllByText("A")` 命中坐标或其他文本。
- **重命名**：`PropertiesBar` 把「图元名称」输入框放进默认展开的 `data` 区（外观区仍保留同一字段的样式编辑），新增用例断言默认 `aria-expanded=true` 的「几何参数」区即可改名，并断言改动写回文档标签。
- **RED→GREEN 证据**：`App.test.tsx` 新增「assigns sequential point labels…」与「renames a selected primitive from the default data section」两个用例，在改名逻辑尚未接入时前者断言 `["A","B","C"]` 会失败（旧实现得到 `["新点 A","新点 B","新点 C"]`），后者在字段仍只存在于外观区时找不到可见输入框。

#### Task 8：多模态组收敛为两个禁用入口

- `ribbonCommands.ts` 的 `multimodal` 组现在只包含 `input-text-conversion`（文字转换）与 `input-image-conversion`（图片转换），两者 `disabled: true`，`disabledReason` 明确写「服务尚未接入，暂不可用」；`uiState.ts` 的 `RibbonIcon` 用 `image` 取代 `quiz`/`pen`，`Ribbon.tsx` 增加对应图标并删除旧图标。
- **证据**：`ribbonCommands.test.ts` 断言恰好两个 ID、两个标签、全部禁用及准确原因；`Ribbon.test.tsx` 断言禁用按钮渲染、`title` 说明原因、点击不触发 `onCommand`，并断言「抢答题」「画笔标注」已不存在。

#### Task 9：移除右侧约束与智能体展示，保留测量

- `PropertiesBar` 删除「几何约束」手风琴、三维约束工具卡和「暂无约束」空状态，移除 `onCreateConstraint` 属性与 `constraintOptions`；`InspectorTabs`/`EngineeringInspector` 的 CAD 页签收敛为 数据/外观/工程标注，`EngineeringInspector` 不再接收 `constraints` 插槽；`App.tsx` 卸载两处 `AgentDock`、移除 `ConstraintPanel` 插槽与 `addConstraint`/`nextConstraintId`，并删除不再引用的 `AgentDock.tsx`。
- **保留**：`document.constraints`、Scene Graph 约束操作、`.mgeo` 编码与 `ConstraintPanel`/`spatialTools` 内核均未删除；教学测量入口本就在 `data` 区，移除约束后仍在原处。
- **证据**：`App.test.tsx` 新增用例断言通用与 CAD 检查器中都不存在「几何约束」「暂无约束」「+添加」「智能体 (Agent)」「约束」页签，同时文档 `constraints` 字段仍存在；`EngineeringInspector.test.tsx` 断言没有约束插槽、并断言两个面的选择仍能从数据页签创建「二面角内角/外角」；`e2e/workbench.spec.ts` 把旧的「约束列表/已满足/删除约束」用例改为「打开含约束的旧 `.mgeo` 不再显示约束界面，但导出的 `.mgeo` 里约束记录仍有 1 条」。

#### Task 10：停靠面板收起后扩大工程画布

- `EngineeringWorkbench` 在 `.engineering-workbench` 上暴露 `data-left-open` / `data-right-open`；`global.css` 的 `.workbench-body` 按四种停靠组合给出网格列（左右都开＝250px + 1fr + 右侧宽度，单开一侧只保留可见列，都收起＝单列 1fr），中间画布始终占满剩余宽度。
- **证据**：`EngineeringWorkbench.test.tsx` 新增用例断言两个数据属性随按钮切换、画布区域始终存在、都收起时 `.workbench-body` 只剩一个子元素、重新展开后恢复两个。

#### Task 11：法向量与二面角示例的底部提示

- `statusPrompts.ts` 新增 `SceneControlMode`（`normals` / `dihedral-demo`）与 `resolveSceneControlPrompt()`；`resolveStatusPrompt()` 接受可选的 `sceneControl`，创建步骤优先，其次是场景显示提示。法向量提示说明它画的是各可见面的外法向量；二面角提示明确「显示的是坐标轴夹角的示例值，不读取你的选择」，并给出 `Alt` 单选两个面、再点「二面角内角/外角」的真实流程。
- `ThreeSceneView` 新增可选 `onStatusPromptChange`，用 `lastControlRef` 记录**最后切换**的开关（两个开关可以同时打开，提示跟随最近一次操作），App 用 `sceneControl` 状态把它交给状态栏；卸载时清空提示。
- **证据**：`statusPrompts.test.ts` 新增 3 个用例（法向量文案、示例值 + Alt + 两个测量按钮名、创建步骤优先于场景提示）；`e2e/geometry3d.spec.ts` 新增用例在真实浏览器里先开法向量看到「外法向量」，再开「测量二面角」看到「示例值」和 `Alt`，关闭后提示消失。

#### Task 12：3D 画布点名标注

- `ThreeSceneView` 新增 `three-point-label-overlay`（`aria-label="三维点标注"`）：在既有 render 循环里把每个可见 `point3` 投影到视口，用像素偏移（+10 / −10）生成带 `data-point-label` 与 `data-point-id` 的 `span`；标注层 `pointer-events: none`、`z-index: 1`，不参与 Raycaster 拾取，随相机旋转/缩放与 `ResizeObserver` 更新，文档变化时整体重建。
- **证据**：`e2e/geometry3d.spec.ts` 新增用例断言两个空间点各有一个标注、点名 `A`/`B` 可见、标注层 `pointer-events: none`，并断言「适应视图」后标注位置随之变化（说明它跟着相机走而不是留在原地）。

#### 追加修复：工程制图图纸没有铺满画布

- **现象与定位**（真实浏览器量测，1600×1000）：`.drawing-sheet` 只有 684×524，而中间画布可用区是 1058×744 —— A4 横向图纸的固定像素尺寸（594×420 + 24 边距，随视图包围盒增大）比工作区小得多，图纸看起来是一张浮在灰色底色里的小卡片。这不是停靠面板的问题（Task 10 只解决了列宽）。
- **真正的根因（第一轮修复没有生效的原因）**：`.workbench-canvas-slot` 里除了 `.engineering-drawing` 还有「显示投影线」工具栏（`.engineering-drawing-toolbar`）。画布列本身不是**确定高度的容器**，也没有把高度传下去，所以 `.engineering-drawing` 一直被内容撑到 556px（工具栏 44px + 内容 524px），中间 188px 永远是空白；只加 `height: 100%` 并不生效，因为百分比高度在这种 auto-height 块里无法解析。
- **修复**：
  - `.workbench-canvas-slot` 改为 `display: flex; flex-direction: column; height: 100%; overflow: hidden`，工具栏 `flex: 0 0 auto`，`.engineering-drawing` 用 `flex: 1 1 auto; height: 100%` 吃掉剩余全部高度。
  - `drawingGeometry.ts` 新增 `sheetFitScale(available, paper)`：等比缩放系数 = `min(可用宽/纸宽, 可用高/纸高)`，容器或纸张无有效尺寸时退回 1（PDF 式 zoom-to-fit，圆仍是圆）。
  - `DrawingSheetView` 把纸放进新的 `.drawing-sheet-area` 布局盒，用 `ResizeObserver` 量盒子实际尺寸算出 `fit`，对纸张应用 `transform: scale(fit)` + `transform-origin: center`，并在纸上写 `data-sheet-fit` 便于断言/排查；缩放走 CSS transform，视图内部的 SVG 与文字按比例放大不变形。
  - 诊断 `<details>` 作为 flex 兄弟留在图纸下方（`flex: 0 0 auto`），长内容仍可滚动查看，不会被裁掉。
- **实测效果**：1600×1000 下纸张由 684×524 变为 **856×656**（`data-sheet-fit=1.252`，占画布高度 88%），四个视图面板由 300×220 变为 **376×275**；`2D 绘图` 的单张模型视图为 991×712（fit 1.604，覆盖 94% × 96%）；两侧面板都收起时为同一张纸居中；390×844 手机视口自动缩到 fit 0.599（宽 370 / 可用 390）且无横向或纵向溢出。
- **回归**：`DrawingSheetView.test.tsx` 新增 3 个用例（缩放算法三种比例、无尺寸时退回 1:1、纸张渲染在专用布局盒内且 jsdom 下保持 1:1）；全量单测 59 个文件、**545** 个用例通过；`npm.cmd run test:e2e` 36/36 通过；`test:e2e` 与构建均重新执行。

### 工程制图视觉重做（Task 14，2026-09-16 已完成）

**用户反馈**：上一版只是把图纸整体放大，失去了美感，UI 也不贴合，要求"有美感一点"。

**加载的方法技能**：`redesign`（先审计再改，保留行为）+ `design-doctrine`（token by intent、八种状态、一个视觉焦点、不许 emoji）。`design-taste-frontend` 明确把自己限定在落地页/作品集，并把 dashboard 与稠密产品 UI 划为不适用范围，因此这里只借用它的"设计读法"（先判断受众与语境），不套用其页面级规则。

**审计（先量后改，1600×1000 真实浏览器）**：

| # | 病症（可测量） | 根因 |
|---|---|---|
| 1 | fit 把整个 DOM 一起拉大，视图标题/按钮/圆角/线宽按 1.25–1.6 倍膨胀 | 用 `transform: scale()` 缩放包含 UI 的整张纸 |
| 2 | 纸张、视图框、画布三层几乎同色（#ffffff / #f8f7fc / #f4f4f8），没有视觉焦点 | 复用通用面板 token，缺制图专用表面色 |
| 3 | 视图框越出图框：视图右/下边到 1148/888，图框内沿只到 1205/951 且右下角被标题栏占用 | 标题栏被挤进纸边距，纸张尺寸只按"视图包围盒 + 16px"算 |
| 4 | 面板内边距/间距跟着缩放（16px → 20–26px），刚"填满"又把空间吃掉 | 制图版式沿用通用 spacing |
| 5 | 自动 fit 没有任何比例读数或缩放入口，"被放大"像 bug | fit 是隐式行为 |
| 6 | 每个视图常驻 3 个按钮 + 两行标题 + 虚线空状态板 | 通用面板模板套在图纸上 |

**修复（按 token → 版式 → 组件 → 状态顺序）**：

- **tokens.css 新增制图表面语义 token**：`--color-drafting-surface: #e6e9f1`、`--color-drafting-grid: #dde1ec`、`--color-paper: #fff`、`--color-paper-tint: #fbfcfe`、`--color-hairline(#c6ccdb)/--color-hairline-strong`、`--shadow-sheet`、`--sheet-panel-padding/--sheet-panel-gap`。品牌紫只保留给"当前状态"，工程线稿改走冷灰墨色。
- **画布**：`.drawing-sheet-area` 变成 24px 制图底纹 + 内阴影的工作台面；纸张白 #fff 落在上面成为唯一视觉焦点。
- **纸张版式**：底色改为纯白纸 + 内缩 12px 的深墨图框 + 只在框线上点两处分区刻度；标题栏移到图框内右下角，做成真正的图签（工程图纸 / 图幅 A4 横 / 比例 1:1 / 4 视图 / 显示 111%），与视图框对齐而不是叠在视图上。
- **构图数学**：`sheetPaperSize` 的边距从 16 提到 100，并重写注释说明它的职责是"把图框和标题栏都留在视图之外"；实测视图框已完全落在图框内（视图 383–1148 / 框 353–1205）。
- **视图框**：细线 + 左上右下双角定位刻度（像工程图视图而不是白卡片）；标题压在图内左上（`工程视图` 小字 + `主视图`），状态在右上；3 个操作按钮改为悬停/聚焦才出现的胶囊（触摸设备用 `@media (hover: none)` 常驻），从"每个视图一排按钮"变成"需要时才在"。
- **缩放不再只是放大**：`DrawingSheetView` 增加 `zoom` 状态与工具栏"适应窗口 / − / ＋ + 比例读数"，纸张写 `data-sheet-fit`、`data-sheet-scale`，读数为 `fit × zoom`；缩放改用 **CSS `zoom`** 而不是 `transform: scale()`——`zoom` 参与布局，所以放大后滚动范围正确、fit 后不会留下未缩放的占位高度顶出滚动条；fit 状态 `overflow: hidden`，放大后 `data-zoomed` 切换成可滚动，整张纸仍可及（不再被裁掉）。
- **工具栏收敛**：整个 CAD 区域只有一个工具栏（原来图纸外面一个、纸里四个），`EngineeringDrawingView` 把「显示投影线」作为插槽交给 `DrawingSheetView`，比例读数居右。
- **空状态**：不再画坐标轴占位板，也不放虚线框；每个视图只留标题右侧的「空视图」，绘图视口为空时仍可点下第一笔（`pointer-events: none`）。
- **响应式回归修复**：`height: 100%` 只在 ≥981px 的多列布局里传递；单列布局下三块内容会均分高度并与行高互相撑，实测把 CAD 画布压成 68px（图纸 26×20）。现在 ≤980px 时画布 `height: auto; min-height: 46vh`，390×844 实测画布 388px 高、图纸 358×283（fit 0.58），无横向溢出。

**验证（全部重新执行）**：

- 单测：59 个文件、**546** 个用例通过（`DrawingSheetView.test.tsx` 从 6 个增到 9 个：位置改为按中心定位 + zoom 控件行为 + 「空视图不再画坐标轴」的对应断言）。
- 类型检查 4 个 workspace 通过；ESLint 0 error、40 条既有 warning（无新增）；生产构建通过。
- E2E：**37/37 通过**，新增 `fills the drafting area with the sheet and keeps an explicit display scale`，断言 fit 后纸张不超过可用区且在约束轴向上占比 > 0.9、比例读数与 `data-sheet-scale` 一致、放大后变成可滚动、适应窗口后恢复且不再溢出。
- 过程中修掉的既有 E2E 假设：`比例 1.5` 原本写在视图元信息行里（该行已按新设计移除），改为按「缩小 主视图」按钮是否可用判断视图比例已持久化；`放大 主视图` 现在需要先 hover 面板（控件默认收起）。

#### Task 13：完整验证
- `npm.cmd test`：59 个测试文件、542 个用例通过（追加图纸铺满修复后为 545 个，视觉重做后为 546 个）。
- `npm.cmd run typecheck`：4 个 workspace 通过。
- `npm.cmd run lint`：0 error、40 条既有 warning（无新增）。
- `npm.cmd run build`：Web 与 3 个 package 构建通过；Vite 仍提示主 bundle 超过 500 KB（2026-09-16 清理后实测 `index-*.js` 1,540.36 kB、gzip 485.23 kB，CSS 56.49 kB、gzip 9.73 kB）。
- `npm.cmd run test:e2e`：37/37 通过（含本轮的 3D 提示、点名标注、约束数据与图纸填充用例）。
- 修正的验证流程问题：`npm.cmd exec playwright test` 直接运行时不会重新构建，预览服务固定读取 `build-check/mathcanvas-current`，因此源码改动必须通过 `npm.cmd run test:e2e`（先构建再跑）验证，否则会看到上一次构建的旧行为。

### 工程制图可用性修复（Task 15-18，2026-09-16 已完成）

**用户反馈（原话）**：「工程制图的 2d 绘图 ui 表现堪比灾难性，中间的画布内容十分混乱，而且工程绘图这个功能很难用，让人不知所云，3d 投影的模块一直显示暂无可投影的空间对象，根本不知道怎么用，立体几何的模块，我希望能够获取截面，截线图元，就像平面板块获取交点图元一样，当相交时，会显示虚线的截面和截线，点击获取图元」。

三条反馈是三个独立根因，拆成 A（2D 绘图命令搬出图纸）/ B（三维投影来源）/ C（截面·截线图元）三组切片，每片跑完整门禁后单独提交。

| 症状 | 根因（先定位再改） |
|---|---|
| 2D 绘图「中间画布十分混乱」 | 绘图命令全部渲染在**图纸内部**的视口里，和视图框、图框、图签挤在同一层：纸内那一层同时挂着坐标/长度/角度 3 个输入框，以及偏移距离输入 + 偏移/修剪/延伸 3 个按钮（`drawing-viewport-input` 与 `data-draft-edit-row` 两行） |
| 3D 投影「一直显示暂无可投影的空间对象」 | 工程制图与立体几何各持有**独立文档**（`workspaceDocuments`），投影只读 CAD 自己的文档；界面上既没有"投影来源"这个概念的入口，空状态也不说明原因 |
| 立体几何「不知道怎么获取截面、截线图元」 | 截面只能先点命令再创建；没有"相交即虚线预览"的中间态，预览也无法点击创建 |

#### Task 15（切片 A + A2）：2D 绘图命令移出图纸，读数按图纸单位定尺

- **A（`9ca7d46`）**：新增 `DraftControlsRow.tsx`，把坐标输入、长度/角度、切换角度约束、切换栅格捕捉、偏移距离与偏移/修剪/延伸做成**图纸外**的一行工具条；`DrawingViewport` 把原本自绘的那一行状态改为 `onDraftControls` 上报（导出 `DraftControls` / `DraftConstraint` 类型），`DrawingSheetView` 新增 `draftControlsSlot` 渲染位与 `publishDraftControls`，`App.tsx` 把 `DraftControlsRow` 交给插槽并用 `draftControlsHandledExternally` 抑制纸内旧行。`global.css` 的 `.drawing-toolbar` 保持单行（高度 token `--drawing-toolbar-height: 48px`）。
- **A2（`90f8743`）**：搬迁后暴露出读数文字尺寸失控——捕捉标签与「长度 · 角度」读数此前按纸张 CSS zoom 后的像素写死，`DrawingViewport` 改为按视图 `viewBox` 跨度换算字号（`readoutFontUserUnits(span) = span / 42`），缩放图纸时读数不再被放大成巨大文字。
- **证据**：`DrawingSheetView.test.tsx`（+39 行）断言命令行渲染在纸**外**且纸内不再出现；`DrawingViewport.test.tsx`（A 改 19 行、A2 新增 15 行）断言外部模式不再画第二行、字号随跨度缩放；`e2e/engineering-workbench.spec.ts` 新增 `keeps the 2D drafting commands on the toolbar, off the drawing surface`（断言命令按钮的坐标区域落在图纸之外）。

#### Task 16（切片 B，`b552994`）：工程制图可以投影立体几何文档

- 新增 `apps/web/src/projectionSource.ts`：`ProjectionSource = "cad" | "geometry3d"`、`hasProjectableGeometry(document)`（只认可见的空间图元，二维图元与隐藏对象不算）、`projectionEmptyMessage(source, cadHasGeometry, spatialHasGeometry)`（分别说清"是哪份文档空"以及"另一份里已经有模型"）。
- `EngineeringDrawingView` 接受 `spatialDocument` / `projectionSource`，新增「投影来源：本图纸 / 立体几何」切换按钮（`data-projection-source`、`aria-pressed`），投影与空状态用来源文档，而**图纸布局始终来自 CAD 文档**（切来源不会改图纸版式）。空状态还带一个"去立体几何"的动作提示（`emptyStateAction`）。
- **证据**：`projectionSource.test.ts` 3 个用例（可见性判定、二维不算、四种空状态组合的文案与互相指路）；`EngineeringDrawingView.test.tsx` 新增用例断言切换后投影线来自立体几何文档且图纸布局未变；`e2e/engineering-workbench.spec.ts` 新增 `projects the spatial workspace model instead of claiming there is nothing to project`。

#### Task 17（切片 C）：截面·截线图元——先虚线预览，再点击创建

设计与已确认决策见 [`docs/superpowers/specs/2026-09-16-section-intersection-primitives-design.md`](./superpowers/specs/2026-09-16-section-intersection-primitives-design.md)（`1fbdda5`）。四个实现切片：

- **C1（`a52a74d`）内核**：新增 `packages/geometry-kernel/src/intersections3d.ts`——`planeFromRing` / `planeIntersectionLine` / `intersectRings3` / `intersectFaceSets` / `faceRingsFromFaces`。做法是两面环各自被对方平面裁剪成区间、再求两区间的交，因此不会出现"只按点到直线距离筛点"造成的幽灵线；共面直接短路（共面重叠没有唯一交线），线段去重后用并查集串联要求区间重叠。
- **C2（`a775c39`）DSL 与重算**：新增 `intersectionLine` 图元（`sourceIds: [string, string]`、`segments`、`classification`、`status`、`diagnostic`），进 `primitiveTypes` 与校验；`scene-graph` 的 `primitiveDependencies` / `isReferenced` 纳入 `sourceIds`，来源变化时 `recomputeIntersectionLine` 自动重算，来源被引用时禁止删除。`schemaVersion` 仍是 `"0.1"`（新类型可选，旧文件不受影响）。
- **C3（`68ec2a8`）虚线预览**：新增 `apps/web/src/intersectionPreview3d.ts`（`resolveIntersectionPreview` → `intersection` / `section` / `none` / `insufficient`，带 `sourceIds`、`segments`、`points`、`classification`、`label`）与 `threeScenePreview.ts` 类型；`threeScene.tsx` 的 `createPreviewGroup` 画虚线（`LineDashedMaterial` + 一条不可见命中副本），悬停高亮、`onPreviewClick` 回调，状态栏文案由 `resolveIntersectionPreviewPrompt` 给出。**两级预览**：悬停只给轻提示，选中两个含面环的对象才给完整虚线预览 + 标签。
- **C4（`0435622`）点击创建**：点击虚线预览即把预览写成持久化的 `section` / `intersectionLine` 图元（进文档、可撤销、随来源重算）；点击优先级是"点/棱拾取优先于创建"，避免预览抢走顶点手柄的拾取。
- **明确不做**（写入功能目录）：不做布尔运算、不把实体真实切开渲染、不为"任意两实体"猜一个剖切平面；圆柱/圆锥面环是**多边形近似**，共面面之间没有唯一交线，圆/圆弧的修剪仍不在范围内。
- **证据**：`intersections3d.test.ts` 8 个用例（含三共线点、区间求交、共面短路、去重串联）、`intersectionLine.test.ts` 6 个（来源重算、删除保护、往返）、`codec.test.ts` 往返、`intersectionPreview3d.test.ts` 4 个、`statusPrompts.test.ts` 文案优先级；`e2e/geometry3d.spec.ts` 新增 `previews the section of a selected solid as a dashed overlay` 与 `creates an intersection line by clicking the dashed preview`。
- **过程中修掉的回归**：搬迁后重复出现两个「栅格捕捉 / 角度约束」按钮；工具条换行把纸张从 128% 压到 64%（工具条必须保持单行）；预览点击抢走顶点手柄拾取；预览提示覆盖法向量/二面角的状态提示（已定为 创建 > 场景提示 > 预览 > 默认 的优先级）。

#### Task 18：完整验证（基线提升）

- `npm.cmd test`：**68 个测试文件、698 个用例通过**（本轮起始 64 / 670）。
- `npm.cmd run typecheck`：4 个 workspace 通过；`npm.cmd run lint`：0 error、39 条既有 warning（无新增）；`npm.cmd run build`：生产构建通过。
- `npm.cmd run test:e2e`：**47/47 通过**（本轮起始 43，新增 4 个：命令条出图纸、投影来源切换、截面虚线预览、点击创建截线）。
- 提交：`9ca7d46`（A）、`90f8743`（A2）、`b552994`（B）、`1fbdda5`（C 设计）、`a52a74d`（C1）、`a775c39`（C2）、`68ec2a8`（C3）、`0435622`（C4），均已推送 `origin/main`。

## 已完成

### P0 技术验证

- [x] 建立 npm workspaces monorepo：`apps/web`、`packages/dsl`、`packages/geometry-kernel`、`packages/scene-graph`
- [x] 初始化 React + TypeScript + Vite 工作台
- [x] 建立 Geometry DSL v0.1、`schemaVersion`、revision 和稳定对象 ID
- [x] 实现 `.mgeo` JSON 保存/恢复 codec 与可见文件打开入口
- [x] 实现点、线、圆的数据类型；完成两条直线和交点 SVG 渲染
- [x] 实现参数滑块 → Domain Operation → DAG 派生重算 → 交点更新
- [x] 实现 Algebra View、显示/隐藏、撤销/重做
- [x] 实现 Domain Patch 校验：重复 ID、缺失引用、非法参数和不存在对象拦截
- [x] “添加点”通过 Domain Operation 提交，并同步到 Algebra View 与画布
- [x] 建立 React Testing Library UI smoke tests
- [x] 配置 Playwright Chromium 与可回收的本地 preview 测试服务器
- [x] 通过浏览器 smoke test 验证工作台加载、滑块更新和添加点
- [x] 实现表达式 AST：数字、变量、括号、加减乘除和确定性求值
- [x] 将表达式接入 `ParameterSpec`，支持参数引用和链式重算
- [x] 循环引用、未知变量和非法表达式失败回滚
- [x] 点、线、圆及圆弧图元支持；新增直线-圆和圆-圆交点计算
- [x] 依赖关系传播与局部派生对象重算
- [x] 约束目标校验、引用保护和非法 Patch 回滚
- [x] 平行、垂直、重合约束的确定性几何投影
- [x] 圆、圆弧的画布多点击创建和属性编辑
- [x] 直线的画布双点击创建和端点属性编辑
- [x] 选择工具、对象删除和 Delete/Backspace 键盘交互
- [x] 删除引用对象时的依赖保护和 Patch 错误反馈
- [x] 对象锁定、框选和 Shift 多选操作
- [x] Playwright `.mgeo` 文件选择与恢复流程
- [x] 线段 DSL、画布双击创建、独立渲染和端点属性编辑
- [x] 1000 个图元下的增量重算性能回归测试
- [x] 多约束迭代求解、冲突检测与失败事务回滚
- [x] 持久化对象分组、六向对齐和批量显隐/锁定编辑
- [x] 数值鲁棒性：尺度化容差、鲁棒交点分类与退化回滚
- [x] 近平行几何纳入 1000 图元增量重算性能回归
- [x] 约束图按受影响分量局部求解，避免无关线重复投影
- [x] 射线与折线 DSL、校验及基础几何度量
- [x] 射线/折线补丁边界校验与退化输入防护
- [x] 射线/折线与直线、圆的详细交点内核
- [x] 圆锥曲线采样与微积分数值 MVP 内核
- [x] 多组件约束局部求解性能基准

### 验证证据

- `npm test`：15 个测试文件、108 个测试通过
- `npm run typecheck`：4 个 workspace 通过
- `npm run build`：Web bundle 与 3 个核心 package 构建通过
- `npm run test:e2e`：5 个 Chromium 浏览器用例通过

## 环境状态

- [x] npm、TypeScript、Vite、Vitest 已配置
- [x] Playwright 浏览器测试环境已安装并验证
- [x] 浏览器插件连接曾因当前环境的 `process` 属性冲突失败；已改用项目内 Playwright Chromium 验收

## 当前进行中

### 阶段状态

- P0：已完成
- P1：主体已完成，包含数值鲁棒性、约束局部求解、射线/折线交点和圆锥/微积分数值内核
- P2：基础几何编辑已完成；射线/折线、圆锥曲线、函数采样和采样交点联合交互已接入
- P3：函数分析（导数 / 零点极值拐点 / 切法割 / 积分区域与分析集）已完成
- P4 / P5：**由用户明确排除**（Agent 与 Provider Router、题图解析），不在当前范围
- P6：立体几何已完成（v1 四类模板 → v2 点驱动通用拓扑 → v3 可用性修复），并叠加 **A1 解析二次曲面与真圆**、**A2 交面分组与真曲面**
- P7：工程制图已完成（四视图、投影线联动、工程标注、SVG / DXF / PDF 导出、图纸与图层树）

- [x] P1：表达式 AST 最小能力（数字、变量、加减乘除、括号）
- [x] 将表达式求值接入参数环境，为后续函数图像和导数做基础
- [x] P1：圆、圆弧和基础交点内核
- [x] P1：依赖 DAG 局部传播及约束 Patch 校验
- [x] P1：平行、垂直、重合约束投影求解
- [x] P2：圆、圆弧的基础交互创建和属性编辑
- [x] P2：直线的基础交互创建和端点属性编辑
- [x] P2：选择、删除和键盘交互
- [x] P2：对象锁定、框选和多选
- [x] P2：线段构造和直线/线段差异化渲染
- [x] P1：1000 个图元增量重算性能回归
- [x] P1：多约束冲突检测与求解失败回滚
- [x] P2：对象分组、对齐和批量属性编辑
- [x] P1：尺度化数值策略与显式交点结果分类
- [x] P1：近平行几何性能回归覆盖
- [x] P1：约束图分量局部求解与增量重算接入
- [x] P2：射线方向判断、折线长度与点到折线距离
- [x] P2：射线/折线专用 UI 回归测试与属性编辑完善
- [x] P2：圆锥曲线和函数采样工作区渲染与属性编辑
- [x] P2：圆锥曲线交点与函数/曲线联合交互
- [x] P1：射线/折线非法输入在 Scene Graph 边界拒绝
- [x] P1：射线/折线与直线、圆交点过滤与端点去重
- [x] P1：抛物线、椭圆、双曲线采样
- [x] P1：函数采样、数值导数与梯形积分
- [x] P1：多组件约束性能基准
- [x] P1：大规模多组件约束增量求解优化，覆盖 1000/5000/10000 条线
- [x] P2：工作区独立文档切换与状态往返保留
- [x] P2：SVG 与 CSV 导出
- [x] P2：约束可视化列表、满足状态与冲突恢复提示
- [x] P2：PNG 导出、导出错误反馈与本地草稿自动保存
- [x] P2：约束批量清理与数值误差诊断
- [x] P2：属性检查器整体 UI 优化，统一卡片层级、图元类型徽标、双列字段、响应式布局和可见焦点态
- [x] P2：中间画布横向填充工作区，函数编辑框的 Backspace/Delete 不再误删函数图元
- [x] P2：函数公式键盘支持光标插入、嵌套函数和带底数对数；画布支持坐标悬停与点击创建持久交点
- [x] P2：函数无定义区间与采样渐近线断线保护；画布支持动态视口中心、鼠标中键或 `Space + 左键` 平移
- [x] P3-1：表达式编译缓存与有细化上限的自适应函数采样接入绘图、属性值域、导出和采样交点
- [x] P3-2：一阶/二阶中心差分导数内核，覆盖非有限邻域
- [x] P3-3：基于自适应样本的零点、极值和拐点数值检测
- [x] P3-4：可持久化一阶/二阶导函数图元，保存来源引用并联动重算
- [x] P3-5：可持久化切线、法线和割线图元，保存来源引用并联动重算
- [x] P3-6：积分区域、零点/极值/拐点分析集合和结构化数值诊断
- [x] P3-7：微积分分析工具、属性状态、Algebra View 条目和画布标记集成
- [x] P3-8：P3 文档、完整测试、类型检查、构建和 E2E 验证
- [x] P6-1：3D 向量、平面、射线—平面求交和二面角基础几何内核
- [x] P6-2：3D DSL 类型、几何校验、`.mgeo` round-trip 和旧 2D 文档兼容
- [x] P6-3：参数化立方体 Three.js 场景、geometry3d 工作区入口和 WebGL 降级状态
- [x] P6-4：棱锥、圆柱和圆锥参数化 Three.js 模型与创建入口
- [x] P6-5：3D 相机旋转、平移、缩放、重置和空间拾取
- [x] P6-6：隐藏边、透明面、法向量和选中态显示
- [x] P6-7：剖切平面、截面计算和截面派生对象
- [x] P6-8：立方体展开/折叠布局与动画
- [x] P6-9：二面角测量显示
- [x] P6-10：`geometry3d` 工作区、Algebra View 和立体属性栏集成
- [x] P6-11：P6 文档、完整验证、review、commit、push

### P6 v2：点驱动通用立体几何（分片实施中）

- [x] 方案 C 已确认：基础对象采用点、线、面驱动，参数化实体作为快捷模板。
- [x] 完成点、线、面、拓扑、builder、依赖重算、拾取和教学反馈的设计规格。
- [x] 完成十个可独立验证切片的实施计划，明确测试、类型检查、构建、E2E、review、commit 和 push 门槛。
- [x] P6 v2-1：3D DSL 基础对象与旧文档兼容。
- [x] P6 v2-2：纯三维几何与可注册实体 builder。
- [x] P6 v2-3：Scene Graph 依赖索引与拓扑重算。
- [x] P6 v2-4：点线面课堂构造工具与关键点交互。
- [x] P6 v2-5：四类固定实体迁移为统一拓扑模板。
- [x] P6 v2-6：空间拾取、约束与教学测量。
- [x] P6 v2-7：通用剖切与截面派生对象。
- [x] P6 v2-8：拓扑展开布局与折叠动画。
- [x] P6 v2-9：二面角与空间关系教学标记。
- [x] P6 v2-10：工作区整合、兼容、文档与最终验收。

- P6 v2-8 聚焦测试：`unfold3d.test.ts` 8 个、`scene-store.test.ts` 40 个、`threeScene.test.ts` 17 个用例通过
- P6 v2-8 全量单测：34 个测试文件、316 个用例通过
- P6 v2-8 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-8 浏览器验证：Playwright 10 个用例通过，新增“展开点驱动拓扑为平面展开图并折回”用例
- P6 v2-8 实现：新增 `unfold3d`（共享棱邻接 BFS、沿铰链递归旋转展平、折叠进度、重叠诊断、面朝向无关的展开侧判定）；`resolvePolyhedronTopology` 提供任意多面体拓扑；3D 画布按拓扑渲染展开图（每面填充 + 边界 + `unfolded-face-<i>` 子部件 ID），折叠姿态仍为临时 UI 状态，并支持 `prefers-reduced-motion`

- P6 v2-9 聚焦测试：`markers3d.test.ts` 9 个、`measurements3d.test.ts` 7 个、`threeScene.test.ts` 18 个用例通过
- P6 v2-9 全量单测：35 个测试文件、327 个用例通过
- P6 v2-9 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-9 浏览器验证：Playwright 11 个用例通过，新增“解释二面角内角/外角并绘制公共棱、角弧与法向量标记”用例
- P6 v2-9 实现：新增 `markers3d`（公共棱上的内角二面角，与面环缠绕方向无关；外角为补角；`dihedralMarker3` 输出公共棱、角弧和朝外法向量；点线/点面垂足），二面角测量改为报告内角并记录 `dihedralKind`，属性栏提供“二面角内角/外角”两个入口，画布在选中来源面时绘制公共棱、角弧与法向量标记

- P6 v2-10 聚焦测试：`codec.test.ts` 27 个（含点驱动 3D 文档含拓扑/截面/二面角测量的完整往返）、`App.test.tsx` 54 个（含 3D 工作区往返、WebGL 降级提示、导出入口门控、非法构造提示、单步撤销重做）、`exporters.test.ts` 7 个（含截面分类与测量行导出）用例通过
- P6 v2-10 全量单测：35 个测试文件、334 个用例通过
- P6 v2-10 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-10 浏览器验证：Playwright 11 个用例通过
- P6 v2-10 整合修复：立体几何工作区明确禁用 SVG/PNG 投影导出（导出入口不再静默生成空文件，改为禁用并在提示中说明将在 P7 工程制图接入，SVG/PNG 在平面工作区保持可用，`.mgeo` 与 CSV 在 3D 保持可用）
- P6 v2-10 验收对照：任意点驱动多面体可创建编辑（Slice 4-5）、四类模板仍可用（Slice 5）、派生对象按来源重算（Slice 3/6/7）、3D 对象可保存恢复并进入代数区（codec 往返 + 代数区子树）、错误与近似状态可解释（约束/测量/截面/展开诊断）

## 下一步

### P6 v3：立体几何可用性修复（已完成）

用户在真实浏览器里实测立体几何区，列出 6 个问题；另按要求顺带完成 1 项选取判定优化。逐个先定位根因（浏览器实测取证据），再写失败测试，最后实现。

| # | 用户报告的现象 | 定位到的根因 | 状态 |
|---|---|---|---|
| 1 | 无法修改立体几何图形的颜色；"每个图形只能改一次颜色，然后被锁定" | `.three-canvas-shell` 没有高度约束，被右侧属性面板内容撑到 **1902px**（视口仅 720px），相机宽高比变成 0.39，立体中心落在屏幕外 951px；同时 `visibleSolids()` 把模板实体排除出场景，画布射线永远命中不到实体本身，只能命中"棱" | ✅ 已验收 |
| 2 | 端点的模型过大 | `createPoint3Mesh` 用写死的**世界单位**半径 0.14（实测 9px），随手势缩放变化；圆柱 24 分段产生 48 个顶点、屏距仅 11px，挤成"串珠" | ✅ 已完成 |
| — | （用户要求顺带）对象选取判定 | `pickRaycastHit3` 按**类型优先级**排序再比深度，导致立体背后的顶点抢走点击；`raycaster.params.Line.threshold` 用 three.js 默认的 **1 个世界单位**（立方体棱长才 4） | ✅ 已完成 |
| 3 | 无法正常删除图形，删除后棱和点依然存在 | `deleteObject` 只删单个图元；模板实体被**自己生成的拓扑**引用，触发 `isReferenced` 保护而无法删除；删掉拓扑又留下孤立的顶点/棱/面 | ✅ 已完成 |
| 4 | 无法构建平面，更不用说合适大小的平面 | `threeScene.tsx` **完全没有 `plane3` 渲染分支**（创建成功但画不出来）；默认点 `(n%3)*2, floor(n/3)*2, z=0` 让前三点共线（建平面必然报 `plane3 points are collinear`）且全部落在 z=0；界面无任何操作引导；相机固定 16 单位，1 单位图形打开即是一个点 | ✅ 已验收 |
| 5 | 无法测量二面角，或者测量方法不明确 | 功能本身正确（实测四面体二面角 **45.000°** 与手算一致、状态 valid、画布有标记），入口已在选中两个面时明确提供内角/外角按钮和说明 | ✅ 已完成 |
| 6 | 测量结果无法可视化清晰地表现在画布中 | 有效测量现在会在 3D 画布显示实际数值标签，二面角继续绘制公共棱、角弧和法向量；辅助标记的屏幕恒定缩放保留为视觉细化项 | ✅ 已验收 |

### P6 v3 遗留与待决

- ✅ **5 号**：选中两个面后，属性面板直接提供二面角内角/外角入口和测量解释。
- ✅ **6 号**：测量结果已直接标注在画布上；辅助法向量和角弧已保留，屏幕恒定缩放作为后续视觉细化。
- ⚠️ **选中态高亮色完全覆盖填充色**（`face3` / `plane3` / 实体都一样，改完颜色需取消选中才可见），属 6 号范围，已与用户确认后处理。 → ✅ **已修复**（见下方「P6 v3-7」）。
- ❓ **点立方体的"面"会选中整个立体**：这是本轮修复 1 号时引入的判定规则（模板实体的棱/面归属所属实体），生成的顶点仍可直接选中以保留点驱动编辑。若产品希望"点面=选面"，需改判定方式，待确认。
- ❓ 平面目前只有**自动尺寸**（按所属图形包围盒自适应，即用户要求的"合适大小"），还没有手动拖动/缩放平面边界的入口（视角移动问题已在「P6 v3-8」单独解决，平面边界拖动仍未做）。
- ✅ **模板实体的朝向**：原本四个模板全部锁死沿世界 +Z，现已支持三轴朝向（见「P6 v3-9」）。

### P6 v3-8 视角不再只能在原点附近打转（已完成）

- **用户的判断与实测不符，先复现再改**：用真实浏览器读取页面已暴露的 `data-camera-target` 取硬数据 —— 平移**本来就有**（中键拖动、Shift+左键拖动都会改变枢轴）：初始 `0.00,0.00,0.00` → Shift 拖动后 `-3.66,0.00,0.00` → 中键拖动后 `-3.66,7.50,0.00`。所以不是"锁死在原点"。
- **实测定位到的 4 个真实缺陷**：
  1. **完全不可发现**：3D 工作区可见文案里没有任何一句提到平移，界面上只有「适应视图」「重置视角」。这是找不到功能的直接原因。
  2. **永远动不了 Z**：`panCameraState` 只写 `x` 和 `y`，三次手势后 `target.z` 始终是 `0.00`；z 方向偏心的图形无论怎么拖都无法居中。
  3. **方向是世界轴对齐而非跟随屏幕**：`target.x += -deltaX * distance * 1.5`。相机旋转后横向拖动不再对应屏幕横向，手感变成"拖了却往怪方向跑"。
  4. **没有任何范围限制**：可以无限平移把图形丢出画面。
- **修复**：
  - `panCameraState` 改为沿**相机自身基向量**平移（`cameraBasis` 由 azimuth/elevation 推出 right / up / forward），新增第三个 `forward` 分量用于沿视线纵深移动；横向拖动现在在世界 X 与 Z 上同时产生位移。
  - 新增 `clampCameraTarget`：把枢轴夹在以**当前图形包围盒**中心、半径为 `3 × 包围盒半径`（`PAN_RANGE_FACTOR`）的范围内；场景没有几何时退回原点周围 ±12（`EMPTY_BOUNDS_PAN_LIMIT`）。
  - 交互与可发现性：新增「平移视角」按钮（`aria-pressed` + 画布 `data-pan-mode` + `grab/grabbing` 光标），开启后左键拖动即平移；画布左下角常驻手势提示「左键拖动旋转 · 中键或 Shift+左键拖动平移 · Ctrl+拖动沿视线前后移动 · 滚轮缩放」；`Ctrl`（或 `Cmd`）拖动沿视线纵深移动。
  - 「适应视图」的提示文案补充说明它同时把视角中心移回图形。
- **RED→GREEN 证据**：`threeScene.test.ts` 新增 3 个用例，先在旧实现上失败并给出正确原因（`expected { x: 2, y: +0, z: +0 } to deeply equal { x: +0, y: +0, z: -2 }`，即横向拖动错误地只改世界 X）；实现后通过。
- **浏览器实测**：初始 `0.00,0.00,0.00` → Shift+右拖 `-3.02,0.00,3.02`（X/Z 同步、Y 不动，正是方位角 45° 的相机右向量）→ Ctrl+上拖 `2.50,4.50,8.53`（位移 `(5.5,4.5,5.5)` 恰为视线方向）→ 连续 8 次大幅拖动后停在 `-9.25,4.50,9.25`（受限，不再无限增长）→「适应视图」回到 `0.00,0.00,0.00`；「平移视角」按钮 `aria-pressed=true`、画布 `data-pan-mode=true`，开启后普通左键拖动确实平移而非旋转。
- **回归**：全量单测 51 个测试文件、469 个用例通过；4 个 workspace 类型检查通过；lint 0 error、**37 条 warning**（较基线 36 多 1 条，来自新增的可测试纯函数 `clampCameraTarget` 导出触发的既有 `react-refresh/only-export-components` 规则，属既有规则的重复计数）；生产构建通过；Playwright **26/26** 通过（新增 2 个视角导航用例）。

### P6 v3-9 参数化实体支持三轴朝向（已完成）

- **用户报告**：生成圆锥等图形时，图形只能朝向一个方向。
- **根因（代码级证据）**：`packages/geometry-kernel/src/solid-builders.ts` 里四个模板全部硬编码沿世界 +Z 生成 —— `buildCube` 用 `buildPrism({ vector: {x:0, y:0, z:size.z} })`；`buildPyramid` 把顶点固定在 `baseCenter.z + height`；`buildCylinder` 沿 `{x:0, y:0, height}` 拉伸；`buildCone` 把顶点固定在 `center.z + height`。数据模型里也没有任何朝向字段（`ConePrimitive`/`CylinderPrimitive` = `{center, radius, height, segments}`，`PyramidPrimitive` = `{baseCenter, baseSize, height}`，`CubePrimitive` = `{origin, size}`），属性面板只暴露这些。
- **同时确认「拖生成点来定向」这条路走不通**：`packages/scene-graph/src/operations.ts` 的 `syncTemplateTopology`（L551-566）在 L617 **每次重算都会执行**，把模板生成的每个 `point3` 位置按模板参数写回，手动移动的顶点会被弹回原位。
- **修复**：
  - `packages/dsl/src/types.ts` 新增 `SolidRotation`（弧度，X → Y → Z）与四类模板的可选 `rotation` 字段；`schema.ts` 校验必须是三个有限弧度；旧 `.mgeo` 缺该字段时行为完全不变。
  - `solid-builders.ts` 新增 `rotateAboutPivot` 与 `templatePivot`（立方体取包围盒中心，棱锥/圆柱/圆锥取轴线中点），在 `buildSolidTemplate` 里对**已生成的顶点**统一应用旋转 —— 一处改动覆盖四个模板，刚校验过的拓扑也不会被刚体旋转破坏；渲染、投影、导出、测量因此全部自动跟随。
  - `packages/scene-graph` 的 `PrimitiveUpdatePatch` 新增 `rotation3?: Partial<Vector3>`（按轴合并，未给出的轴保留原角度）；`updatePrimitive` 在四类模板上写入 `rotation`。
  - 属性面板新增「朝向」卡片：三个按度输入的角度框（`step=15`，可精确输入 45/90）、「归零」按钮与各轴「+90°」快捷按钮，并说明旋转顺序与轴心。
- **RED→GREEN 证据**：`solid-builders.test.ts` 新增 4 个用例，先在旧实现上失败并给出正确原因（`expected +0 to be close to -2`、`expected 2 to be close to 6`、`expected 2 to be close to 2.8284271247461903`，即旋转被完全忽略）；实现后通过。另在 `codec.test.ts` 新增 3 个用例（朝向往返、旧文档保持直立、非有限角度被拒绝），`operations.test.ts` 新增 2 个用例（朝向写入文档且生成拓扑跟随、按轴合并不影响其他轴）。
- **浏览器实测**：默认圆锥（半径 1.5、高度 3）包尺寸 `3.10,3.10,3.10`；高度改为 6 后 `3.10,3.10,6.10`；点「绕 X 轴 +90°」后变为 `3.10,6.10,3.10`，输入框显示 `90`，刷新后从草稿恢复仍为 `90`。截图对照确认圆锥由「轴沿世界 Z（屏幕上横躺）」变为「轴沿世界 −Y（屏幕上竖直朝下）」。
- **顺带纠正文档**：`docs/feature-catalog.md` 原写「编辑生成点后可脱离模板独立修改」，与 `syncTemplateTopology` 的实际行为相反，已改为明确说明并指向朝向参数。
- **回归**：全量单测 51 个测试文件、478 个用例通过；4 个 workspace 类型检查通过；lint 0 error、37 条 warning（与上一轮持平）；生产构建通过；Playwright 27/27 通过。

### P6 v3-11 立体几何改为 Z 轴朝上（已完成）

- **用户反馈**：立体几何的 xyz 轴不符合直觉，要求 Z 轴在上。
- **根因**：整个 3D 视图按 Three.js 默认的 **Y 朝上**搭建 —— `applyCameraState` 把仰角放在 Y 上（`position.y = target.y + distance·sin(elevation)`），`cameraBasis` 的 `right/up` 也按 Y-up 推导；`camera.up` 从未设置，一直是默认的 `(0,1,0)`；`THREE.GridHelper` 生成的网格在 XZ 平面（那是 Y-up 的地面）。
- **修复**：
  - `applyCameraState`：相机位置改为 `(cos el·cos az, cos el·sin az, sin el)`，仰角绕世界 **Z** 抬起；同时显式 `camera.up.set(0, 0, 1)`，否则 `lookAt` 会带着默认的 Y-up 产生滚转。该函数改为导出以便直接断言相机姿态。
  - `cameraBasis`：`forward` 与 `right` 按 Z-up 重新推导，平移方向继续跟随屏幕。
  - 网格：`grid.rotation.x = Math.PI / 2`，把 Three.js 的 XZ 地面转成 **XY** 地面。`AxesHelper` 本身沿世界轴绘制，无需改动，因此蓝色 +Z 自然朝上。
- **RED→GREEN 证据**：`threeScene.test.ts` 先改期望再看失败 —— `expected { x: +0, y: +0, z: -2 } to deeply equal { x: +0, y: +2, z: +0 }`（平移基向量仍是 Y-up）；新增 1 个用例断言 `camera.up === (0,0,1)`、仰角 0 时相机在 `+X`、仰角 90 时相机升到 `+Z`。实现后 36 个用例通过。
- **浏览器实测**：截图确认蓝色 +Z 竖直朝上、网格平铺为地面、立方体为 3/4 俯视；`data-content-bounds` 仍为 `0.00,0.00,0.00 size 4.10,4.10,2.10`（几何本身未变，只有视角改变）。E2E 里按世界点投影点击顶点的辅助函数 `projectDefaultCamera` 也同步改成 Z-up（否则"点顶点不穿透"用例会点到实体上）。
- **回归**：全量单测 51 个测试文件、484 个用例通过；4 个 workspace 类型检查通过；生产构建通过；Playwright 30/30 通过。lint 0 error、**38 条 warning**（较 37 多 1 条，来自导出 `applyCameraState` 以便测试相机姿态所触发的既有 `react-refresh/only-export-components` 规则）。
### 功能键操作指引（左下角小浮层）（已完成）

- **用户报告**：一些功能使用不明确，点击功能按键时左下角应该有清晰指引（例如"计算二面角要如何操作"）；指引不要过大，只在点击那些按键时才出现。
- **复现与根因**：立体几何与圆锥曲线工作区**没有任何状态提示面**——CAD 有 `StatusBar` 的命令提示，平面/3D 只有底部一行 `footer-note`（revision 与创建模式）。因此两件事说不清：① 多步创建（直线/圆/圆弧）与一键创建的下一步；② 前置条件不足时的原因。后者此前走 `setFileError`，弹出的是"请先按住 Shift 依次点选 2 个空间点"这类**报错**，而二面角真正的卡点（模板实体的面默认选中整个实体，要按 Alt 才能单独选面）根本没有出口。
- **修复**：
  - 新增 `apps/web/src/guidance.ts`：纯函数 `guidanceFor(action)` 把「点了什么 + 前置条件是否满足」映射为一句指引，覆盖平面创建、圆锥曲线、函数与函数分析、空间构造、截面、模板实体、6 类测量（含二面角内/外角）、8 类约束、3 个点驱动工具；`point3Tool` 会带上"还差几个空间点"。
  - 新增 `apps/web/src/components/GuidanceHint.tsx`：小浮层，`role="status"` + `aria-label="操作指引"` + 闭合按钮；`global.css` 用 `position: fixed; left/bottom: 18px`、`max-width: 420px`、`0.75rem` 字号把它压成一行到两行。
  - 出现/消失规则：只在功能键点击时写入；切换工作区、`Esc`、点 `×`、一步创建动作完成时清空；点另一个功能键被替换。用 `pendingCreationRef` 区分"多步创建结束"与"一次性指引"，避免把后者一起清掉。
  - 前置条件不足改为给指引：3D 的空间直线/平面/面创建、测量的 insufficient-data/degenerate 分支不再弹红色报错。
  - 二面角补上真正的入口提示：选中立方体/棱锥/圆柱/圆锥时提示 `Alt + 点击` 可单独选中棱或面。
- **RED→GREEN 证据**：`guidance.test.ts`（9 个用例，含逐条断言文案 ≤64 字）与 `GuidanceHint.test.tsx` 先在模块不存在时整体失败；`App.test.tsx` 新增 5 个用例，先在旧实现上失败（`Unable to find role="status" name="操作指引"`）。实现后全部通过。
- **既有测试的行为改写**：`App.test.tsx` 的 "explains an invalid spatial construction instead of creating objects" 原先断言红色 `alert`，现在断言左下角指引（这是本次要求的行为变更，不是绕过失败）。
- **过程中自修的两个错**：`addPoint` 里多写的一行 `setSelectedIds` 撞坏了 2 条既有用例（已还原为原语义）；新写的二面角用例选了立方体的**对面**（面 1 + 面 2，二面角本就退化），改为相邻的面 1 + 面 3，与既有 e2e 一致。
- **浏览器实测**：`e2e/geometry3d.spec.ts` 新增用例断言指引**贴在左下角**（`x < 视口宽/2`、底边在视口下方 60% 以下）、宽度 < 480px、点击"添加立方体"先出现实体指引、关闭后归零、只选面不弹、点"二面角内角"后出现含"公共棱/外角"的指引。
- **回归**：全量单测 54 个测试文件、516 个用例通过；4 个 workspace 类型检查通过；lint 0 error、38 条既有 warning（无新增）；生产构建通过；Playwright 32/32 通过。
- **边界**：CAD 工程制图工作台未接入这个浮层——它已有自己的 `StatusBar` 命令提示与 `notice` 通道，重复提示反而会打架；指引不做自动超时消失（用显式关闭/Esc/操作完成，避免"看着看着没了"）。

### 圆锥曲线工作区四项修复（画布缩放 / 交点全显 / 函数入口 / 函数可删）（已完成）

- **用户报告**（圆锥曲线部分）：1) 画布不能缩放；2) 线之间的交点只显示一个；3) 应该能加入 `exp`、简单三角函数等简单函数，似乎可以和微积分部分稍作整合；4) 无法删除函数。
- **复现与根因**（先复现再定位，全部用真实代码实测）：
  1. **缩放**：`GraphicsView` 只有中键拖动与 `Space+左键拖动` 平移，没有滚轮也没有按钮；而且圆与圆弧半径写死 `WORLD_SCALE`，与 `viewport.scale` 脱钩，所以即使加了缩放，圆也会画错。
  2. **交点只显示一个（两个独立缺陷）**：内核 `intersectSampledPrimitives` 把结果截断成 `[unique[0], unique[1]]` —— 实测直线与 `sin(x)` 有 6 个交点只显示 2 个，折线—直线、折线—圆同样截断；`GraphicsView` 的 `persistentPairs` 按“整对”过滤预览 —— 实测直线与圆 2 个交点，保存其中一个后剩下 0 个。
  3. **函数入口**：`onAddFunction` 传进了工具栏却从未渲染（退役切片的守卫测试还断言它不存在），而内核、DSL、`PropertiesBar` 的函数编辑区与 `functionPresets` 都还在。
  4. **无法删除函数**：`isReferenced()` 把 `derivative/tangent/normal/secant/integral/analysisSet` 当普通引用者，所以含派生分析对象的函数删除时报 `object is referenced by another object`（探针实测画布点击、代数区、键盘三种入口全部失败）。
- **修复**：
  - **内核**：`IntersectionResult.points` 由 `[Coordinate, Coordinate]` 放宽为 `Coordinate[]`；`intersectSampledPrimitives`、`intersectPolylineLineDetailed`、`intersectPolylineCircleDetailed` 返回全部去重交点，并用 `MAX_CURVE_INTERSECTIONS = 64` 兜住 `sin(1/x)` 这类病态输入。
  - **画布**：`viewport.ts` 新增 `zoomViewportAt`（以指针为锚点，锚点世界坐标保持不动）、`clampZoom`（0.05×～40×）、`zoomViewport`、`gridStep`（自适应网格步长）；`GraphicsView` 用原生 `wheel` 监听（`passive: false`，否则页面跟着滚）缩放，新增「放大画布 / 缩小画布 / 重置视图」按钮与百分比读数，圆与圆弧半径改用 `viewport.scale`，网格按缩放自适应。
  - **交点显示**：只有 `intersectionSet`（会实体化整对全部解）隐藏整对预览，单个交点图元只隐藏自己那个坐标，拖动时实时预览也不受影响。
  - **函数**：工具栏恢复「添加函数」；属性栏新增「常用函数预设」下拉（预设文案中文化：指数函数 `e^x`、正弦 `sin(x)`、双曲、高斯等，选择预设同时套用其课堂定义域）与「创建导函数 / 创建切线 / 创建积分区域」；`App.addFunctionAnalysis` 生成合法图元，`applyOperation` 在同一补丁内完成派生重算。
  - **删除**：`deletionTargets()` 把函数的派生分析对象并入同一对象一起删除，沿用模板实体拓扑的既有先例（`isReferenced` 通过 `ignoredReferrers` 放行）。
- **RED→GREEN 证据**：新增 `packages/geometry-kernel/src/curve-intersections.test.ts` 4 个用例，先在旧实现上失败（`expected [ { x: 1, y: +0 }, { x: +0, y: 1 } ] to have a length of 3 but got 2`）；`operations.test.ts` 新增函数分析删除 2 个用例先失败（`expected false to be true`）；`viewport.test.ts` 新增 4 个缩放用例先失败（`(0 , zoomViewportAt) is not a function`）；`App.test.tsx` 新增/改写 9 个用例先失败（`Unable to find role="button" name="添加函数"` 等），实现后全部通过。
- **回归**：全量单测 52 个测试文件、501 个用例通过；4 个 workspace 类型检查通过；lint 0 error、38 条既有 warning（无新增）；生产构建通过；Playwright 31/31 通过（新增「圆锥曲线画布缩放 + 直线与正弦的多个交点」浏览器用例）。
- **与退役切片的取舍**：微积分**工作区标签**继续退役，不恢复第四个标签；本次只把「添加函数 + 导数 / 切线 / 积分」入口放回圆锥曲线工作区，属于用户明确要求的回补，因此退役切片的守卫测试改为「标签不存在，但圆锥曲线提供添加函数」。
- **仍未做**：函数预设下拉只覆盖内核已有预设，没有自定义参数化 `a*sin(b*x+c)+d` 表单；`analysisSet`（零点 / 极值 / 拐点）与法线 / 割线仍未接入界面入口；保存的交点仍受既有的来源删除保护（删除被交点引用的图元会先提示）。

### 微积分工作区退役（切片 1 已完成，代码清理待续）

- **用户要求**：微积分部分用不到，删除。
- **已确认范围**：删 UI 与内核、保留 DSL 图元类型与解码路径（旧 `.mgeo` 仍可打开、只能查看/删除）；默认工作区改为 `geometry3d`。
- **切片 1（界面与默认，已完成并全绿）**：
  - `WorkspaceHeader` 工作区标签移除「微积分」，并把图标从"按下标取"改为每个标签自带，避免删项后图标错位。
  - `store.ts` 初始文档由 `createDemoDocument()`（calculus）改为 `withDocumentLayout(createEmptyDocument("geometry3d"))` —— 启动不再有任何演示内容。
  - `draftStorage.loadActiveWorkspace` 白名单去掉 `"calculus"`，旧草稿不会把应用带回已退役的工作区。
  - `GeometryToolbar` 的 `isPlanarWorkspace` 收窄为仅 `conics`。
  - 测试夹具 `createDemoDocument()` 改为 `conics` 文档（内容不变：两条直线 + 交点 + 斜率参数），因此平面画布相关用例无需逐个改工作区。
  - 新增 `e2e/fixtures/planar-demo.mgeo`（由 `createDemoDocument()` 经 `encodeMgeo` 生成），替代原先"启动即有演示内容"的假设。
- **切片的验证**：全量单测 51 个测试文件、484 个用例通过；Playwright 30/30 通过（含加载 `workspace: "calculus"` 文档仍能正常打开的兼容用例，以及"微积分标签不存在"的断言）。
- **切片 1b：可见入口清零（已完成）**：圆锥曲线工具栏的「添加函数图像」已移除；函数检查器里的「创建导函数/切线/法线/割线/积分区域/分析结果」按钮行与 `createDerivedAnalysis` 辅助函数已删除。微积分图元因此在任何工作区都无法再新建，遗留的内核/渲染/导出代码不再可达。
- **守卫测试（把你提的两条要求钉死）**：
  - `draftStorage.test.ts`：残留的 `active-workspace = "calculus"` 偏好不会让应用重新进入已退役工作区。
  - `App.test.tsx`：外壳里不存在「微积分」按钮；圆锥曲线工作区不存在「添加函数图像」（但抛物线/椭圆仍在）；加载含 `workspace: "calculus"` 与 `function` 图元的旧文档仍能打开、对象仍列出（可查看/删除）而不抛错。
  - `e2e/workbench.spec.ts`：全新会话停在「立体几何」，且「微积分」标签数量为 0。
  - 随之删除 7 个依赖函数/微积分入口的 App 用例。
- **按你的决定保留**：DSL 图元类型与 schema、`PropertiesBar` 的函数编辑区、`GraphicsView` 的函数/派生渲染分支、导出相关行、内核 `calculus.ts` 与 `operations.ts` 的重算分支。这些只在打开旧 `.mgeo` 时可达，不会再产生新的微积分对象。
### P7 修复：工图工作台的撤销与重做（已完成）

- **用户报告**：工程制图工作区里「重做」按键没有反应、「撤销」按键不能撤销。
- **先复现再定位**：用真实浏览器读页面已暴露的 `data-revision` 实测，撤销/重做**对命令栏创建、2D 绘图、图层增删与显隐、视图比例调整都是有效的**（revision 依次 1→2→3→2→1，重做回到 1）。所以问题不在 store 的 history/future 机制。
- **实测到的两个真实缺陷**：
  1. **键盘快捷键完全没有实现**：全项目只有 3 处 `keydown` 监听，分别处理 Escape / Delete / Backspace；`ctrlKey` 唯一用处是 3D 视角的纵深平移。实测 `Ctrl+Z`、`Ctrl+Y`、`Ctrl+Shift+Z` 按下后 revision 均停在 1 不动 —— 这是"按键没反应"最直接的原因。
  2. **撤销/重做按钮从不进入禁用态**：项目里没有任何 `canUndo`/`canRedo` 计算（grep 无结果），空历史时按钮依然可点，点了没有任何反馈。另外草稿恢复走的是 `replace()`，会清空 history，所以刷新后内容还在但"撤不掉"，而按钮看起来仍然可用 —— 观感就是"撤销失效"。
- **修复**：
  - `App.tsx` 新增 `historyShortcut(event)`：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y 重做，带 `preventDefault()`；用既有的 `isTextEditingTarget` 跳过输入框/文本域/下拉/可编辑区，不抢文本框里的撤销。监听器依赖补上 `undo`/`redo`。
  - `WorkspaceHeader` 新增 `canUndo`/`canRedo`：为 `false` 时按钮 `disabled`，并给出「没有可撤销的操作（Ctrl+Z）」这类提示；`App.tsx` 从 store 的 `history.length`/`future.length` 计算。
- **RED→GREEN 证据**：`App.test.tsx` 新增 3 个用例，先在旧实现上失败并给出正确原因（`expected [ { id: 'point3-1', … } ] to have a length of +0 but got 1`、`expected false to be true`），实现后通过；其中"不抢文本框快捷键"的用例作为反向守卫。
- **浏览器实测**：`Ctrl+Z` revision 1→0、`Ctrl+Y` 0→1、`Ctrl+Shift+Z` 1→2；按钮禁用态随历史正确切换（绘图后 undo 可用/redo 禁用 → 撤销后 undo 禁用/redo 可用 → 重做后反过来）。
- **回归**：全量单测 51 个测试文件、484 个用例通过；4 个 workspace 类型检查通过；lint 0 error、37 条 warning（无新增）；生产构建通过；Playwright 30/30 通过。
### P6 v3-10 模板子元素可选取 + 平面可手动定尺寸（已完成）

- **修复一：模板实体的棱/面取不到**。既有规则（`templateTopologyOwners` + `resolveSelectableHit`）把落在模板生成棱/面上的命中映射回所属实体，这是 P6 v3 第 1 号修复让实体"能被点选"的关键，因此不能简单推翻。改为 `resolveSelectableHit(id, owners, keepSubElement)`：默认行为不变，**按住 Alt 点击**时保留命中到的棱/面本身。
- **修复二：平面只有自动尺寸**。`plane3` 新增可选 `halfSize`（画出面片的半边长，世界单位）；`createPlane3Mesh` 用 `primitive.halfSize ?? autoHalfSize`，缺省时仍按场景自适应。属性面板新增「平面大小」卡片：半边长数值输入（留空＝自动）与「恢复自动」按钮；`halfSize: null` 会把字段从文档里删除而不是存 0。
- **顺带修掉两个会拦住这次改动的既有缺口**：
  1. `updatePrimitive` 的几何白名单在 `patches.ts` 与 `operations.ts` 里**各有一份**，两份都不含 `plane3`，所以平面此前根本无法通过属性面板修改任何几何。两份都已补上 `plane3`。
  2. `rotation3`（上一轮新增）此前没有任何 patch 校验，非有限角度可以写进文档。现已补上 per-axis 有限性校验与类型校验，`halfSize` 同样补上正数与类型校验。
- **RED→GREEN 证据**：`threeScene.test.ts` 新增 2 个用例，并**临时移除新行为实跑确认它们会失败**（`expected 2.8284270825993416 to be close to 7.0710678118654755`、`expected 'cube-1' to be 'face-1'`），恢复后通过。另新增 `operations.test.ts` 2 个（写入半边长、清空后字段被移除）、`codec.test.ts` 2 个（半边长往返、非正数被拒）。
- **浏览器实测**：普通点击立方体得到「立方体」，Alt+点击同一位置得到「空间面」；平面在有三点时自动尺寸下 x 跨度约 7，填入半边长 8 后跨度翻倍以上，点「恢复自动」回到原值。
- **回归**：全量单测 51 个测试文件、484 个用例通过；4 个 workspace 类型检查通过；lint 0 error、37 条 warning（无新增）；生产构建通过；Playwright 29/29 通过。
### P6 v3-7 修复 1 条遗留：选中态不再覆盖填充色（已完成）

- **根因**：选中态是通过**改写材质基础色**实现的。`createPlane3Mesh` 用 `colour = selected ? "#4c3ac7" : style.fill` 同时充当面片、外框和两条中心引导线的颜色；`createFace3Mesh` 同样用 `color: selected ? "#4c3ac7" : style.fill`。用户刚改完颜色看到的是强调紫，只有取消选中才露出真实填充色。
- **修复**：改成与 `solidMaterial` 一致的**非破坏式**做法——`face3` 与 `plane3` 的材质 `color` 永远取用户填充色；选中提示改由附加的强调色外框承担（`face3` 新增 `face3-outline` `LineLoop` 子对象，`plane3` 的外框与中心引导线在选中时取强调色），并保留选中时略高的面片不透明度。
- **顺带确认**：模板实体（立方体/棱锥/圆柱/圆锥）**本来就没有这个 bug**——`solidMaterial` 一直保留 `color: style.fill` 并用加性 `emissive`（强度 0.28）表达选中，实测选中状态下立方体填充色仍清晰可辨，因此本轮未改动实体渲染。
- **RED→GREEN 证据**：`threeScene.test.ts` 新增 2 个用例，先在旧实现上失败并给出正确原因（`expected '4c3ac7' to be 'ff0000'`），修复后通过；实测选中与未选中截图对照，`plane3` 与 `face3` 在选中态下均显示用户所选的红色填充，外框为强调色。
- **回归**：全量单测 51 个测试文件、466 个用例通过；4 个 workspace 类型检查通过；lint 0 error、36 条既有 warning；生产构建通过；Playwright 24/24 通过。

### P6 v3 验收结果

- 单元/UI 测试：37 个测试文件、360 个用例通过。
- 类型检查：4 个 workspace 通过。
- Lint：0 个 error，保留 36 个既有 hooks、Fast Refresh 和未使用类型 warning。
- 生产构建：Web 与 3 个 package 构建通过；Vite 仍提示主 chunk 超过 500 KB。
- 浏览器验收：17 个 Playwright 用例通过，命令退出码为 0；预览服务在 Windows 上由 `e2e/global-setup.mjs` 启动并通过 teardown 关闭。
- 工作区检查：`git diff --check` 通过，测试结束后 4173 端口无残留服务。

### 之后

P7-1 至 P7-6 与工程工作台层次化改造 Task 1-7 均已完成；P4 Agent、P5 题图解析保持在排除范围内。CAD 工作台的后续可选方向（手动拖动视口边界、B-rep/DWG 导入、自动尺寸布局）仍属于设计文档中的明确限制。

### P7-1 验收结果

- 新增 `DrawingView`、`ProjectionBasis`、`ProjectedPoint` 和 `projectVector3`，投影计算位于 `packages/geometry-kernel`，不依赖 Three.js 或 DOM。
- 主视图显示 X/Y，俯视图显示 X/Z，左视图显示 Z/Y；轴测图使用固定正交基并返回深度值。
- RED 阶段确认缺失模块失败；GREEN 阶段投影与 3D 几何聚焦测试 8 个用例通过，geometry-kernel 类型检查通过。
- P7-1 完整验收：全量单测 38 个测试文件、363 个用例通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 17 个用例通过；`git diff --check` 通过。

### P7-2 验收结果

- 新增 `resolveProjectedDrawing(document, view)`，输出 renderer-neutral 的点、棱折线和闭合面多边形，并保留 DSL 稳定 `sourceId`。
- 缺失点引用、未物化模板和投影退化进入 `diagnostics`，不伪造世界原点、不生成零长度线段；`polyhedron3` 只作为拓扑容器校验，不重复绘制子拓扑。
- 解析结果按有限深度和稳定源 ID 排序；P7-2 聚焦测试 4 个用例通过，与 Three.js/DSL codec 回归合计 59 个用例通过，Web 类型检查通过。
- P7-2 完整验收：全量单测 39 个测试文件、367 个用例通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 17 个用例通过；`git diff --check` 通过。

### P7-3 验收结果

- `cad` 工作区现在渲染主视图、俯视图、左视图和轴测图四个语义面板；每个 SVG 图元保留 `data-source-id`，支持点击、Enter/Space 键盘选择和可见焦点。
- 空文档显示可读空状态；投影诊断以可展开状态展示；CAD 工具栏隐藏二维/三维创建入口，暂时禁用尚未实现的 SVG/PNG 导出。
- P7-3 聚焦 UI 测试 59 个用例通过；完整验收：40 个测试文件、370 个单测通过，四个 workspace 类型检查通过，Lint 0 errors（保留 36 个既有 warnings），生产构建通过，Playwright 18 个用例通过；`git diff --check` 通过。

### P7-4 验收结果

- `ProjectionLine` 保留稳定 `sourceId`、`originView`、`targetView` 和有限投影端点；每个可见 `point3` 源对象在当前视图与其他视图之间生成对应关系，原点等重合投影不被错误丢弃。
- CAD 视图通过共享 `selectedIds` 同步四个面板的选中态；投影线由本地按钮控制，不进入文档、撤销历史或删除/锁定操作；文档 revision 变化会重新计算四个视图。
- P7-4 聚焦测试：`projectionVisuals` 5 个、`EngineeringDrawingView` 3 个、`App` 58 个用例通过；浏览器场景覆盖 CAD 源 ID 选择、12 条投影线显示/隐藏和选中态保留。
- P7-4 完整验收：40 个测试文件、373 个单测通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 19 个用例通过；`git diff --check` 通过。

### P7-5 工程标注与文档兼容

- 新增可选文档字段 `engineeringAnnotations`，旧 `.mgeo` 缺失时解码为空数组；schema 校验稳定 ID、来源、视图、状态、单位和公差，保持 `schemaVersion: "0.1"`。
- `geometry-kernel` 新增线性尺寸、角度和公差解析：从点或棱来源计算值与投影位置，缺失来源和退化来源分别返回 `insufficient-data` / `degenerate`，不伪造坐标。
- Scene Graph 新增工程标注新增/删除操作，并阻止删除仍被工程标注引用的来源对象；Web 投影描述和四视图消费同一份解析结果，展示有效数值及无效诊断。
- CAD 属性栏新增线性尺寸、角度、公差创建入口；创建操作进入文档与 undo history，来源对象移动后随 `revision` 自动重算。
- P7-5 完整验收：41 个测试文件、385 个单测通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 20/20 通过；`git diff --check` 通过。

### P7-6 工程图导出

- 新增共享 `ProjectedDrawing[]` 导出适配器：SVG 输出四视图、稳定源 ID、工程标注和诊断；DXF 输出 `SECTION/ENTITIES` 中的 `LINE`、`LWPOLYLINE`、`POINT` 和 `TEXT`；PDF 使用 `pdf-lib@1.17.1` 输出矢量页面。
- CAD 工具栏启用 SVG、DXF、PDF 下载，3D 工作区仍禁用投影 SVG/PNG；现有平面 SVG/PNG/CSV 行为保持不变。
- 依赖许可证与边界已记录在 `docs/research/graphing-tools.md`，导出器不调用 Three.js 或重复计算投影。
- P7-6 完整验收：42 个测试文件、388 个单测通过；四个 workspace 类型检查通过；Lint 0 errors（保留 36 个既有 warnings）；生产构建通过；Playwright 21/21 通过；`git diff --check` 通过。

### 工程工作台层次化改造：Task 1-7（全部完成）

- [x] **Task 1：图层、图纸和视图文档模型**：新增可选 `layers`、`drawingViews`、`drawingSheets`、`activeLayerId` 和 `activeSheetId` 字段；旧 `.mgeo` 自动解释为默认几何层、默认图纸和四个 P7 视图。
- [x] **Task 2：可撤销图层与布局操作**：新增图层、活动图层、图纸和视图的 Scene Graph 操作；删除图层时重分配图元，删除被引用视图或来源时保持引用保护。
- [x] **兼容与校验**：保持 `schemaVersion: "0.1"`，校验图层父子关系、活动引用、视图尺寸/比例和图纸视图引用；历史图元未指定 `layerId` 时不改写存储数据。
- [x] **Task 3：工作台壳、分层命令栏和状态栏**：新增 `CommandBar`（选择/创建/修改/标注/检查/导出六个一级类别、堆叠二级面板、`返回`、仅在命令激活时拦截 `Esc` 且不抢输入框焦点）、`StatusBar`（命令提示、捕捉、坐标、单位、比例、当前图层、诊断数、拒绝原因）和 `EngineeringWorkbench`（模式切换 + 左右停靠面板开关 + 命令区/画布区/Inspector 区/状态区四个插槽）。文件、撤销、重做和保存从 `GeometryToolbar` 上移到 `WorkspaceHeader`，CAD 工作区不再渲染大杂烩工具栏。
- [x] **Task 4：模型树、图层树和图纸树**：新增 `DocumentTreePanel`（三个标签页 + 共享过滤 + 方向键切换）、`LayerTree`（父子缩进、当前层、显隐、锁定、新建子图层、删除保护）、`DrawingTree`（图纸展开视图、类型/比例/来源标签、视图显隐）。`AlgebraView` 支持 `filter`；`store.ts` 增加 `treeTab`/`expandedIds`/`filterQuery` 与 setter，`draftStorage.ts` 增加只保存标签页与展开节点的本地工作台偏好。
- [x] **Task 5：图纸视口与 2D 直接绘图**：`EngineeringDrawingView` 从固定四卡片改为 `DrawingSheetView` + `DrawingViewport`；纸张、标题栏、视口矩形/比例/显隐全部来自持久化文档字段，`sheetPaperSize` 保证被移出或放大的视口不被裁剪。新增 `drawingGeometry.ts` 承载布局数学；`2D 绘图` 模式下绘图视口始终可点击，创建回调走活动视口，新图元带 `activeLayerId`，当前图层隐藏或锁定时拒绝创建并在状态栏说明。投影线开关保持临时 UI 状态。
- [x] **Task 6：上下文 Inspector 与完整流程**：`PropertiesBar` 新增 `sections` 过滤（23 处区块按 数据/外观/约束/工程标注 分类），新增 `InspectorTabs`（方向键切换）与 `EngineeringInspector`（四页签、无选择时的图纸/视图/图层/单位/命令上下文、所选对象所在图层、投影来源列表与「来源已删除」诊断）。`AgentDock` 增加 `showConstraints` 以避免约束面板重复；CAD Inspector 通过 `propertiesBarProps` 复用同一份字段更新逻辑。
- [x] **Task 7：迁移、E2E 与交付验证**：`engineeringExporters` 新增 `selectExportableDrawings`，隐藏视图不参与导出也不生成伪造几何；新增旧 `.mgeo` 迁移与草稿布局往返测试；重写 `e2e/engineering-drawing.spec.ts` 适配新壳，新增 `e2e/engineering-workbench.spec.ts`。
- [x] **聚焦验证**：`npm.cmd test -- packages/dsl/src/codec.test.ts packages/dsl/src/schema.test.ts packages/scene-graph/src/operations.test.ts`：3 个测试文件、41 个测试通过。
- [x] **类型验证**：`@draw/dsl` 与 `@draw/scene-graph` workspace 类型检查通过。

### Task 3-7 验证证据

- Task 3：`CommandBar.test.tsx` 6 个、`EngineeringWorkbench.test.tsx` 5 个用例通过；Web 类型检查通过；lint 保持 0 error。
- Task 4：`LayerTree.test.tsx` 8 个、`DrawingTree.test.tsx` 5 个用例通过；`store.test.ts` 6 个、`draftStorage.test.ts` 4 个用例通过；App 层新增图层树与图纸树联动用例。
- Task 5：`DrawingViewport.test.tsx` 7 个、`DrawingSheetView.test.tsx` 5 个、`EngineeringDrawingView.test.tsx` 4 个用例通过；App 层新增视图比例持久化、2D 绘图写入活动图层、隐藏图层拒绝创建 3 个用例。
- Task 6：`EngineeringInspector.test.tsx` 9 个用例通过；App 层工程标注用例改为先进入「工程标注」页签。
- Task 7：`engineeringExporters.test.ts` 5 个、`draftStorage.test.ts` 6 个用例通过；`e2e/engineering-drawing.spec.ts` 4 个、`e2e/engineering-workbench.spec.ts` 3 个用例通过（共 24 个 Playwright 用例）。
- 全量：`npm.cmd test` 51 个测试文件、484 个用例通过；`npm.cmd run typecheck` 4 个 workspace 通过；`npm.cmd run lint` 0 error、37 条 warning；`npm.cmd run build` 通过；`npm.cmd run test:e2e` 30/30 通过。

> 射线/折线、圆锥曲线和函数采样已接入工具栏、SVG 渲染、属性编辑和 UI 回归测试；选中两条可采样曲线即可创建持久化交点。

## 进度更新规则

- 每次完成一个独立可验证切片后更新本文件。
- 未运行验证命令的内容不得标记为完成。
- 浏览器级验证、单元测试、类型检查和构建分别记录，不互相替代。

## GitHub 协作

- [x] 创建公开仓库，远程地址 `https://github.com/Huo0077/mathcanvas.git`
- [x] 配置远程地址并同步远程 `main` 分支
- [x] 本地 `main` 已设置跟踪 `origin/main`
- [x] 通过远程分支检查确认 `origin/main` 可访问

### 本地与 GitHub 进度对比（2026-09-16 更新）

- 上一轮推送前对比：本地 `main` 为 `48096b4`，`origin/main` 为 `86eb7f3`，本地领先 2 个提交、没有落后提交；那一轮把远程操作指引、统一 Ribbon 基线、测量入口修复与状态栏浮层避让同步到了 GitHub。
- 本轮（Task 7-13 与 Task 14）在本地实现并通过验证后，按用户明确要求一并提交并推送；推送后 `main` 与 `origin/main` 指向同一提交，以推送后的 Git 状态核验为准。
- 本轮同步范围：平面几何改名、A/B/C 与 3D 画布点名、重命名入口前移、多模态入口收敛、右侧面板精简（约束/智能体展示移除、数据保留）、CAD 画布随停靠面板扩大、法向量/二面角底部提示、**工程制图视觉重做**（制图台 + 图纸、图框与图签、视图框刻度、显式缩放、单列响应式修复），以及对应的单测/E2E 与文档。
- 推送后核验（`git ls-remote`）：`origin/main` 曾为 `bdfa1fc`，本地与远端一致、无未推送提交；随后 fetch 发现远端领先本地 3 个提交（CAD 2D 绘图交互重做），本地以 `--ff-only` 快进到同一提交，**这批新代码在本机重新跑过全套门禁**（65 测试文件 / 672 用例、4 workspace 类型检查、lint 0 error、生产构建、Playwright 43/43）。
- 补齐文档时远端又前进了 1 个提交（`f6fff56`，另一会话记录同一批 CAD 2D 绘图工作），与本次文档改动**冲突于同两个文件**：已 rebase 并以远端那份更完整的分小节写法为准（README 的「CAD 2D 绘图交互」小节、进度头覆盖更多历史切片），只保留本地独有的两处——旧的「仍未做」清单改为指向已完成小节、README 的验证基线 43/43 与已剔除完成项的「下一步」。
- 审查修复提交 `e494fa3`（`fix: align docs with reality and drop the constraint/agent leftovers`）已推送并核验：`git rev-parse HEAD` = `origin/main` = `git ls-remote` 远程 ref，divergence `0/0`，工作区 clean，远端树中已无 `ConstraintPanel.tsx`。
- **工程制图可用性修复（Task 15-18）推送记录**：切片按 A → A2 → B → C 设计 → C1 → C2 → C3 → C4 → 文档的顺序推送——`9ca7d46`（2D 绘图命令搬出图纸）、`90f8743`（读数按视图单位定尺）、`b552994`（投影来源）、`1fbdda5`（截面/截线设计规格）、`a52a74d`（面环求交内核）、`a775c39`（`intersectionLine` 图元与重算）、`68ec2a8`（虚线预览）、`0435622`（点击创建）、`63d2dc9`（进度文档）。
- 每次推送前都先 `git fetch origin` 并核对 divergence（另一会话会并发推送同一仓库）；推送后用 `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 对比确认两端 ref 相同，工作区 clean。
- **平面几何动点系统（2026-09-17）推送记录**：`92509bd`（`feat(planar): dynamic points constrained to curves, functions and conics`，30 个文件 / +7041 −123）与 `1a38189`（`docs: record the planar dynamic point engine round`）由另一会话推送。本地 `git fetch` 发现落后 2 个提交后以 `git pull --ff-only` 快进到 `1a38189`，无冲突、无本地改动被覆盖；核验 `git rev-parse HEAD` = `origin/main` = `git ls-remote origin refs/heads/main` = `1a38189d99eed919f815d50677df0cfce28ebd94`，工作区 clean。该批次未改 `package.json` / `package-lock.json`，因此无需重跑 `npm install`。
- **该批次在本机复跑门禁（2026-09-17）**：`typecheck` 4 个 workspace、单测 73 文件 / 933 用例、`lint` 0 error / 52 warning、生产构建、Playwright 58/58 全部通过（exit 0）。即推送方的记录已在本机独立复现，而不只是转抄。
- **3D 视口与几何内核重构推送记录（2026-09-17）**：`4f793a5`（设计文档）→ `2210d21`/`9427296`（1A-1 渲染管道去重建化）→ `f23ba72`/`5b2702b`（1A-2 `hosts3.ts` 与绑定 DSL）→ `859741a`/`27236bf`（2 Auto-Fit）→ `17e8964`（背景坐标系自适应与画布填满所在行）→ `18babf7`（1B 截面几何）→ `659dbc2`/`9acd7ee`（1A-3 绑定 UI 与拖动）→ `97e13e1`（3-1 删除级联）→ `eb26b83`（3-3 多解与就近吸附）→ `57d3b2a`（3-2 求值层清理与画布尺寸稳定性）→ `1671289`（F15 去重尺度）→ `6f1c144`（四模板默认截面验收）→ `79ebce5`（相机与取景数学抽模块）→ `be731b9`（README 基线）→ `a5132ad`/`3edba9c`（进度文档与归档计划的状态标注）→ **`0d901d1`（1A-1b 增量同步 + 相机记忆）→ `a409894`（threeScene 按职责拆模块）**。每一片都是"先写失败用例（RED）→ 实现后转 GREEN → 更新 `docs/project-progress.md` 与 `docs/feature-catalog.md` → 跑全套门禁 → `git fetch` 核验 divergence → 提交推送 → 用 `git rev-parse HEAD` / `git ls-remote` 核验两端 ref 一致"。
- **重构期间的两个过程记录（都写进了提交信息）**：①3-2 定位"状态栏文案变化压缩画布"时，顺带查出窄屏（≤960px）下检查器那一行没有上界、把画布行压成 0 的第二个缺陷；②抽出相机模块时第一次用 PowerShell 的 `Get-Content`/`Set-Content` 删行，而本机是 Windows PowerShell 5.1（`Get-Content` 默认按 ANSI 解码），把文件里的中文注释写成了乱码；已 `git checkout` 还原并改用 .NET `UTF8Encoding` 显式读写完成，随后用 `git diff --numstat`（只有删除、没有修改）与乱码特征串全仓库扫描双重确认——**本仓库改文件一律用编辑工具，不要走 PowerShell 文本管道**。

下一步：由用户在本地浏览器验收**交面/交线作为独立图元**（立体几何里建两个交叠的立方体：不选任何东西画布上就该出现虚线交线与半透明交面片、状态栏说明"已自动标出 N 处交线、M 处交面"；点虚线建「截线」、点半透明面片建「交面」；拖动任一来源，两者都跟着重算；检查器里能看到来源与体积/表面积；删掉一个来源，两者一起消失）、**3D 视口与几何内核重构**（选中空间点后在属性栏「宿主绑定」里选宿主并拖动，点应严格沿宿主滑动且一次 Ctrl+Z 精确复位；选中实体创建截面，检查闭合环与「转为图元」；把图形移到 x≈20 以外确认背景坐标系与交点数量；窄窗口下确认检查器变长不会压缩 3D 画布；转动视角后切到平面几何再切回来，视角应保持不变）、**平面几何动点系统**（曲线上的动点拖动、路径参数与动效演示、轨迹与分支、平面测量、参数分组与孤儿回收）与工程制图可用性修复（2D 绘图命令条出图纸、投影来源切换、截面/截线虚线预览与点击创建）、UI 优化、工程制图视觉重做与 CAD 2D 绘图交互；P4 Agent 与 P5 题图解析保持排除。

## 验证证据

> **当前基线（唯一权威，2026-09-18 在"平面几何切线 + 动点扩展 + 切点拖动 + 画布收细"之后实测）**：`npx vitest run` **124 个测试文件、1477 个用例通过**（把上游那 22 个提交一起并进来之后重跑；本轮自己的 37 条全部在内）；4 个 workspace 类型检查通过；ESLint 对改动文件 **0 error**（仓库既有 5 条 warning 与本轮无关）；dev server 逐个模块转译通过。**Playwright 本轮未运行**（需另起构建产物端口与安装 Chromium）—— 界面交互由 `App.test.tsx` 的真实 DOM 与指针事件覆盖，浏览器级门禁待补。
>
> **后续回填（2026-09-18，轨道动点两处修复合并且浏览器级门禁补跑之后，本文件顶部那一节）**：同一棵树实测 **124 个测试文件 / 1480 个用例**（+3：`point3HostBindings.test.ts` 1 条、`App.test.tsx` 1 条、`threeScene.test.ts` 1 条）；**Playwright 110/110 通过**（补上了上一条"待补"的缺口，并因此抓到切线一轮误删的平面画布读数 `data-measurement-labels`，已修；随后又加了 1 条浏览器用例复刻"动点与定点连线"，合计 **111/111**）；`npm.cmd test` 当时会报 1 个 vitest 工作进程心跳超时的 unhandled error（1480 条 0 失败，`--maxWorkers=2` 退码 0）——**该瑕疵随后已根治：`vitest` ^3.2.4 → ^4.1.11**（上游 `vitest-dev/vitest#8297`），升级后 4 次实跑（含一次与 Playwright 并发）全部 0 error、退码 0。**上一条的 1477 与本条 1480 不矛盾**：1477 是那一轮自己的重跑，1480 是合并我这 3 条之后的读数。
> **上一轮基线（2026-09-17 在"全身大体检（十批）+ e2e 构建修复 + 平面网格固定 + 圆上四个点 + 母线不画 + 交点只标角点"之后实测）**：`npm.cmd test` **108 个测试文件、1210 个用例通过**；4 个 workspace 类型检查通过；ESLint **0 error、14 条 warning**；生产构建通过（Vite 仍提示主 bundle 超过 500 KB）；Playwright **86/86** 通过（**现在真的跑的是当前工作区的构建产物**，见下）。
> 下面按时间倒序列出各轮实测快照（数字是**当时**的取值，用于追溯与对比，不代表当前门禁）；例如 68 文件 / 698 用例与 Playwright 47/47 属于 2026-09-16 的 Task 15-18 那一轮。
### 平面几何切线 + 动点扩展（2026-09-18，用户要求）

- **新增测试文件 3 个、新增用例 37 条**：内核 `packages/geometry-kernel/src/curve-tangents.test.ts`（9 条，判据与参数化无关：切点在曲线上 `conicValue ≈ 0`、切向与梯度垂直 `∇F·d ≈ 0`、单位切向）、文档语义 `packages/scene-graph/src/curveTangents.test.ts`（19 条）、界面辅助 `apps/web/src/curveTangents.test.ts`（8 条）；另在 `App.test.tsx` 加 4 条、`interaction.test.ts` 加 6 条，并把 `recomputeConsistency.test.ts` 的平面夹具扩进参数切线 / 点定位切线 / 圆心半径驱动圆各一条真实编辑。
- **全量单测**：**124 个测试文件、1477 个用例通过**（合并上游最新 `main` 之后重跑。本轮开始时本地基线为 118 文件 / 1357 用例，本轮新增 37 条；上游那 22 个提交自带的那批也一并通过）。
- **类型检查**：四个 workspace 通过（`npm run typecheck`）。
- **ESLint**：改动文件 0 error；仓库既有 5 条 warning（`slopeLine` 未使用、两处 `useEffect` 依赖数组、`schema.ts` 未使用导入）与本轮无关。本轮一度引入一条 `react-hooks/exhaustive-deps`（`tangentTargetOf` 读了 `document.parameters`），已改成**显式传参让它成为纯函数**，而不是加注释压掉告警。
- **增量 = 全量不动点**：`recomputeConsistency.test.ts` 逐字段比较 `commitPatch` 与全量重算；本轮新增的依赖边（切线锚点、圆心点、半径驱动点）若漏一条就会在这里失败 —— 它是这轮最有力的一条守卫。
- **dev server 实测**：`npm run dev`（Vite 7.3.6，`http://localhost:5173/`）逐个请求改动过的模块（`App.tsx`、`GraphicsView.tsx`、`PropertiesBar.tsx`、`interaction.ts`、`curveTangents.ts`、`primitiveStyle.ts`、`global.css`、`packages/scene-graph/src/operations.ts`），全部 200 且转译成功；并确认 ① 空白画布那段提示已不在响应里、② 新线宽与点半径已在响应里、③ 切线那组已带上 `onPointerDown`。
- **浏览器级（Playwright）本轮未运行**：需要在另一端口起构建产物并安装 Chromium。界面交互由 `App.test.tsx` 的真实 DOM 与指针事件覆盖（含一次完整的切线拖动手势：在切线上 `pointerDown` → `pointerMove` → `pointerUp`，断言切点沿圆滑到 (0,3) 且该处切线变成水平），但**画布上的手感与观感仍需用户目视确认**。
- **过程记录（诚实条目）**：修"函数轨道上的动点切线 `anchor` 被静默忽略"时，我写的判据读了一个 `SecantPrimitive` 上不存在的字段，而当时只跑了 `vitest`（不做类型检查）与 `eslint`，**漏跑 `typecheck`** 因而没发现，直到下一轮才被 `npm run typecheck` 抓出来。教训：vitest 全绿不等于类型正确。
- **一条被测期望值的更新**：`App.test.tsx` 里交点预览标记的半径原本钉在 `"4"`；画布整体收细后同步改为 `"3"`。这是**产品口径变了所以更新期望值**，不是把测试改成能过 —— 该用例真正守的是"命中区（14）与可见标记分离"这件事，注释里已写明。
- **已知边界**：曲线上**没有**「创建法线」入口（内核与重算都支持曲线来源的法线）；曲线来源的**割线**仍未支持（需要第二个切点参数，是另一套交互）。


### 立体几何：圆上只留四个点 + 交点标记收敛（2026-09-17，用户要求）

- **用户原话**："立体里的圆相关的内容不要这么多标点啊，只需要四个点就够了，而且还是强调交点交线交面的问题，当两个图形相交时，我们不仅需要能获取交面的图元，也要突出交线和交点的图元，同样是相交会特殊标记，点击获得具体图元。"
- **根因（第一部分）**：圆柱 / 圆锥是多边形近似，`buildSolidTemplate` 会把**每个细分顶点**都物化成带标签的 `point3`——48 段 = **96 个点**，标签一路排到 `A…Z、P27…P96`；画布上是 96 个小球 + 96 个文字标签，对象列表展开也是 96 行。
- **改法（第一部分）**：新增 `quadrantVertexIndices`，每个圆环只把**离 0°/90°/180°/270° 最近的互异顶点**当用户点（48 段时就是精确象限点 0/12/24/36）；其余顶点标 `tessellation: true` 且**不给标签**，仍然留在文档里（面 / 棱 / 交线 / 布尔交集读它们的坐标，48 段精度不变）。可见点按环序重编标签：圆柱 A–H（上下底各 4 个）、圆锥 A–D + 顶点 E；立方体 / 棱锥 / 棱柱完全不变。渲染与列表统一走新的 `apps/web/src/primitiveVisibility.ts`（`isUserVisiblePrimitive`）：画布不画小球、不写标签，代数区不列这些行。DSL 只加一个可选布尔字段 `Point3Primitive.tessellation`（schema 校验类型、缺省即用户点，旧 `.mgeo` 不受影响）。
- **改法（第二部分）**：交点标记的取法从"交线折线的**每个顶点**都标一个点"改成 `intersectionMarkerPoints`：**转折 ≥ 18°** 的角点、悬挂端与分叉点优先（立方体↔立方体仍是 8 个角，与旧行为一致）；角点不足 4 个时（圆柱 / 圆锥这类光滑交线）沿交线**均匀补齐到 4 个**，上限 12 个。交线与交面照旧各自独立、突出显示、点击创建；因为光滑交线上的标记是采样点而不是拐点，状态栏文案改成"交线上的点"。同时删掉不再使用的 `dedupeCorners`。**（这条折中被用户随后否掉，见下一节。）**
- **验证（RED→GREEN）**：内核 4 例（48 段圆柱 = 8 个可见点且坐标是精确象限 / 圆锥含顶点 / 6 段与 3 段的最近互异 / 立方体不受影响）——RED 分别是 `expected [ …(96) ] to have a length of 8`、`…(49) to have a length of 5`、`…(12) to have a length of 8`；DSL 1 例（`tessellation` 只接受布尔）；对象树 1 例（`expected …(4) to have a length of 2 but got 4`）；预览 2 例（光滑交线的交点标记 4–12 个、矩形仍是 4 角 / 24 边形光滑取 4 个）；浏览器 1 例（`e2e/three-round-solid-points.spec.ts`：圆柱的点标签**恰好 8 个**、标签就是 A–H，对象列表展开也是 8 行）。文案改动同步更新了 `statusPrompts.test.ts` 与 `e2e/three-intersection-previews.spec.ts` 的断言。
- **两处按建议默认执行的取舍**（用户回复"继续"即按推荐执行）：①细分顶点**仍留在文档里**，只是不显示不列出（改成"隐式顶点"要重做 `face3`/`edge3` 引用模型，本次不做）；②分段数不能被 4 整除时取**最近的互异**象限点（六边形 → 0/2/3/5 号；三角形只有 3 个，如实少给）。

### 立体几何收尾：母线全隐藏 + 交点只标角点 + 旧文档补齐标记（2026-09-17，用户反馈）

- **用户原话**："圆锥中间还有好多点，我不需要这些，同时有太多母线，用不上这些，而且曲线相交时交点太多了，完全不是我们需要的那种。"三件事一件一件办：
- **①"圆锥中间还有好多点"= 旧文档没有跟着新口径走（真缺陷）**。上一轮只改了**新建**实体：`buildSolidTemplate` 给细分顶点打 `tessellation`。但草稿自动保存 / `.mgeo` 里存的是**升级前物化好的那份子对象**（96 个带标签的点、144 条带标签的棱），`migrateLegacySolids` 只在"没有模板"时才物化，看到已有 `polyhedron3` 就直接跳过——于是用户打开自己的圆锥，看到的还是旧口径的 49 个点。改法：`migrateLegacySolids` 对**已有模板**的实体改走 `realignTemplateChildren`，一个子对象都不重建（位置是用户拖过的、名字是用户改过的），只补两件事：新口径隐藏的（细分顶点 / 母线）标 `tessellation: true` 并去掉标签；可见的只有在标签**还是旧口径自动生成**的时候才重编（内核为此导出 `templatePointLabel` / `templateEdgeLabel`，用户自己起的名字原样保留，哪怕自动编号因此出现空档）。迁移幂等：再迁一次结果不变。
- **②"太多母线，用不上这些"（用户选定 A：母线全部不画）**。内核新增 `roundSolidHiddenTopology`（纯函数、可单测）：圆柱里"一端在下底环、另一端在上底环"的棱、圆锥里"有一端是顶点"的棱判为**母线**，标 `tessellation: true` 且不给标签；**两个圆环自身的棱保留**（它们在屏幕上就是那两个圆，圆柱 96 条、圆锥 48 条，标签按可见顺序重编为 `棱 1…N`，不留空洞）。DSL 同步加 `Edge3Primitive.tessellation` 并在 schema 校验；渲染与列表统一走 `isTessellationPrimitive`（由 `isTessellationVertex` 扩展而来，画布、标签层、代数区共用一处判定）——所以母线留在文档里（剖切 / 交线 / 面环仍读它的顶点），但不上画布、不进列表、点不到。
- **③"曲线相交时交点太多了"（用户选定 B：只标真角点）**。删掉上一轮那个折中——`intersectionMarkerPoints` 不再"没有角点就沿交线均匀补 4 个"，光滑交线**一个点都不标**：只标转折 ≥ 18° 的角点、悬挂端（只连一段）与分叉点（连三段以上），上限 12 个，`MIN_MARKERS_PER_PAIR` 随之删掉。交线与交面照旧各自独立、突出显示、可点。实测两个正交圆柱（48 段）的交线有 96 段，标记从"每个折线顶点一个"降到 **2 个**，且两个都落在圆柱底面圆的边上（`hypot(x,y) = 2`）——那是交线拐到端面圆环上的**真角点**，不是采样点。状态栏文案据此改回"拐点"（`statusPrompts.ts` 与它的用例、`e2e/three-intersection-previews.spec.ts` 同步）。
- **验证（RED→GREEN，全部先跑失败用例再改实现）**：内核 2 例（圆柱 144 条棱 = 48 母线隐藏 + 96 环棱可见且标签连续 / 圆锥 96 条棱 = 48 母线隐藏，母线两端必有一端是顶点）——RED 为 `expected [] to have a length of 48`（两例）；可见性 1 例（母线不算用户图元，`expected true to be false`）；对象树 1 例（`expected …(2) to have a length of 1 but got 2`，顺带发现旧夹取里母线根本没被列进 `vertexIds/edgeIds` 的写法会漏过滤）；迁移 1 例（6 段圆锥：7 个点 → 5 个可见且标签 `A/B/C/D/顶点甲`，6 条母线全隐藏，幂等；RED 先是 `templatePointLabel is not a function`）；预览 2 例（光滑圆柱相交 0 个采样标记 + `truncatedPoints = 0`、24 边形 / 48 边形全光滑 → `[]`，六边形 6 个角、阈值参数化 `5° → 24 个`）。**过程中抓到自己三个错**：①第一版 `roundSolidHiddenTopology` 用"下底象限点的 id 集合"去判上底，上底整圈被判成隐藏（圆柱只剩 4 个可见点，被上一轮的旧用例当场抓住）；②六边形那条用例把 `maxMarkers` 当成"可以超"的参数，实际被 12 的上限截到 12——改成显式放开上限才测出 24；③只写"光滑交线 0 个标记"是不够的诚实断言：实测 2 个真角点存在，于是把断言写成"≤4 个且都落在底面圆上"，并写清它们是什么。
- **门禁（本机实跑）**：`typecheck` 4 个 workspace 通过；单测 **108 文件 / 1210 用例**通过；`lint` **0 error / 14 warning**（与基线一致）；生产构建通过；Playwright **85/85** 通过。

### 解析二次曲面 A1（2026-09-17，用户要求·goal 模式分片交付）

- **用户原话**："我不要一个逼近的圆，我需要一个真的圆，这个曲面的相交太难受了。"+"我们去 github 上学习一下圆的问题应该如何解决"。设计文档 `docs/superpowers/specs/2026-09-17-analytic-quadrics-design.md`（A1，8 片）、实现计划 `docs/superpowers/plans/2026-09-17-analytic-quadrics-a1.md`、调研归档 `docs/research/quadric-intersection-algorithms.md`（GeoGebra 源码结论 / OCCT 三层结构 / BRL-CAD 吸附 / 文献与未确认清单）。
- **调研结论（决定路线）**：GeoGebra 自己**只做到"平面 ∩ 二次曲面"**（`AlgoIntersectPlaneQuadric` 就是一次 `PᵀQP`），曲面互交只有球∩球；所有网格 CSG 库（manifold / three-bvh-csg / csg.js / jscad）**按构造就没有真圆**；OCCT-WASM 家族能给真圆但实测 22.0 MB + LGPL-2.1 且没有展开实体的 API——**只有连对象模型一起换成 B-rep 才划算**，所以选 A（自建解析层，多边形只当渲染/手柄基底，`polyhedron3` 契约不动）。
- **第 1 片：内核解析层 `quadrics.ts`（提交 `523d1e5`）**。对称 4×4 二次型（圆柱 `x²+y²=R²`、圆锥 `x²+y²=k²(h−z)²`、平面 `xᵀQx=2(n·x+c)`）；旋转与物化层同 pivot 语义（X→Y→Z），用刚体共轭 `Q_world = TᵀQ_local T`；平面求交一次 `PᵀQP`；按 `δ=B²−4AC`/`Δ=det` 不变量表分类（**先系统归一化再比 1e-12**）；规范化提取中心 / 半轴 / 离心率 / 焦点 / 主轴方向；退化给 `point`/`line`/`lines`/`empty`。**圆的判定用半轴相对差 `(a−b) ≤ 1e-12·a`**——写计划时算出原稿的 `|A−C| ≤ 1e-9` 判别力只有 `√ε ≈ 0.0018°`，会把 spec 自己举的"倾斜 1e-3°"判成圆（`sin²θ = 3.05e-10 < 1e-9`），已回写修正。
- **第 1 片 RED→GREEN（10 例，实测）**：垂直切精确圆；30° 斜切 `a = R/cos30 = 2.3094010767585034`、`b = R`、`e = 0.5`、焦距 = 2ae；平行轴 → 两条平行线（过点 `t = ±√3`）/ 相切一条 / 外面空集；圆锥按"平面与轴夹角"判圆/椭圆/抛物线/双曲线（抛物线临界角 `atan(h/R)`，过顶点 → 一点）；圆判定边界两侧；旋转 90° 圆柱的垂直切 → 同一精确圆且 `bounds.axis/origin` 正确；两条性质测试（椭圆与抛物线采样点代回二次型，残差 < `1e-9·scale²`）；`segments=6` 与 `48` 结果相同。**RED 抓到两个真错误**：①`PᵀQP` 的列序是 `[origin, u, v]`（平面点齐次坐标是 `(1, s, t)`），我最初把系数次序写成 `[C00…C22]`，常数项与 `s²` 项互换，**9/10 用例把圆判成双曲线**；②校验函数 `quadricValueAt` 漏了对称矩阵另一半的线性项（只取 `q[3]` 不取 `q[12]`），圆柱无线性项所以性质测试掩盖了它，**圆锥抛物线的残差 1.65 暴露出来**（用探针手算 `y² = (8/3)(x + 2/3)` 确认顶点其实完全正确，错的是校验函数）。
- **第 2 片：有限实体裁剪 + DSL + 重算接线**。`section-quadric.ts` 的 `sectionQuadric3` 把圆锥曲线裁到端面之间，边界是**片段环**（圆锥曲线弧 + 端面弦），按端点重合成环、串不起来就返回 `null` 让上层回退多边形路径；双曲线**逐支**裁剪（落在实体内的可能只是其中一支）。类型定义放在 **DSL**（解析数据是文档数据，内核依赖 DSL，反向依赖会破坏分层），内核再导出。`section.exact?: { kind, loops }` + `intersectionFace.exactLoops?` + `status` 增加 `"exact"`（弯曲边界已精确，不该再说"数值近似"）；schema 校验六个有限系数、片段形状、`branch` 非负整数，**参数区间不要求升序**（反向片段合法）。`recomputeSection` 在源是圆柱/圆锥时写 `exact`，来源不再是圆类实体时**摘掉旧字段**（否则会留下一份与现几何对不上的解析边界）。
- **第 2 片 RED→GREEN（内核 8 例 + scene-graph 3 例 + DSL schema 12 例合计实测）**：RED 先是 `Failed to resolve import "./section-quadric"`；实现后 6/8 绿，**"圆锥双曲线"一例实测报 `empty`**——原因是我只解了 `+` 那一支的轴向交点，而落在实体内的可能是另一支，修法是把"支"作为片段的显式字段 `branch`；接线用例的 RED 证据用"临时撤掉 `operations.ts`"取得：`expected undefined to be 'circle'` / `'ellipse'`，接上后 34/34。裁剪用例断言：垂直切整圆无弦；30° 斜切（圆心 z=1.0）只切底面 → 1 段弦且两端 z≈0；60° 斜切（圆心 z=0.2）两端都出实体 → 2 弧 + 2 弦且弦高分别在 z=0 / z=3；每个端点都与另一个端点重合（闭合环无悬空端）；平面在实体外 → `empty`；直线/相切/顶点 → 只报 `kind`、`loops: []`（直线段的多边形路径本来就是精确的）。
- **第 4 片（检查器读数）**：新增 `apps/web/src/conicMetrics.ts`（纯函数：`conicMetrics(conic)` 把规范数据翻成"标签 + 数值"行、`exactConicOf(section)` 从片段环里取出圆锥曲线、`conicKindLabel` 结论文案），检查器在"剖切面"之上新增**解析截面**块：圆报圆心 / 半径 / 离心率，椭圆报中心 / 长短半轴 / 离心率 / 焦点，抛物线报顶点 / 焦准距 / 焦点，双曲线报中心 / 实虚半轴 / 离心率 / 焦点，退化与空集**只报结论、不编数字**。抽成纯函数是为了让读数规则能被单测钉住（检查器组件不适合跑这些断言）。浏览器侧在同一条用例里断言检查器真的显示"解析截面 / 半径 / 离心率"。
- **第 4 片 RED→GREEN**：`conicMetrics.test.ts` 5 例（圆只报半径不报长短半轴、椭圆 2.309/2.000/0.500/焦点、抛物线顶点与焦准距、双曲线离心率 > 1、空集只有一行结论、`exactConicOf` 对旧文档如实返回 `null`）。
- **第 5 片（测量精确化）**：查证后发现一个**既有事实**——圆柱 / 圆锥的体积在 `measurements3d.ts` 里**早就是闭式**（`πr²h`、`πr²h/3`，`:194-195`），空间圆面积也早就是 `πr²`；真正的缺口是**精度标注**：`precision` 的取值里有 `"exact-input"`，但**内核从来没有产出过它**，所有读数一律被标成 `"numeric-approximation"`。于是本片把语义写清并落实：`result(...)` 增加 `precision` 参数（默认仍是数值近似）；**圆柱 / 圆锥 / 立方体 / 棱锥体积、空间圆面积、平面多边形面积**（schema 强制共面，三角剖分是闭式）标 `exact-input`；**多面体体积保持数值近似**——它是网格求和，对 48 边形的圆柱 / 圆锥就是不精确的，"精确"这个词不能给它。
- **第 5 片新增解析面积 / 周长**：内核 `conic3Area`（`πab` 精确）与 `conic3Perimeter`（圆 `2πr` 精确；椭圆用第二类完全椭圆积分级数并**如实标 `exact: false`**）。检查器只在**整条圆锥曲线没被端面裁切**时给出这两个读数（`fullClosedConicOf`：唯一片段 + 参数域恰好 `2π` + 圆/椭圆）；被端面裁切的截面如实显示"由端面裁切，无解析闭式"——**拿 `πab` 冒充"椭圆弧 + 端面弦"围成的面积就是一个看着有效、其实错的读数**。
- **第 5 片 RED→GREEN**：内核 13 例（新增：圆面积/周长精确、椭圆面积 `πab` 精确而周长对照公开参考值 `9.688448220547675` 且 `exact === false`、周长落在 `2πb..2πa` 之间、抛物线与退化情形返回 `null`）；测量 9 例（新增：圆柱 / 圆锥 / 立方体 / 空间圆标 `exact-input`、多面体体积保持近似）；检查器 6 例（新增：整圆给"12.566（πab 精确）"与"12.566（2πr 精确）"、椭圆面积精确而周长含"椭圆级数，数值近似"、被裁切只给"由端面裁切，无解析闭式"）；浏览器用例追加断言检查器显示"面积 / πab 精确 / 周长"。
- **第 6 片（投影真椭圆）**：工程图里的空间圆以前**根本没有被投影**（`ProjectedPrimitive` 只有 point / polyline / polygon，`circle3` 不在其中）；现在有了**解析投影**：内核新增 `projection-conics.ts`（`projectConic3(conic, view)`），圆 `C + r(cos t·u + sin t·v)` 的像仍是 `proj(C) + r·cos t·P(u) + r·sin t·P(v)`，于是半轴 = `[A B]` 的奇异值 = `M = A·Aᵀ + B·Bᵀ` 的特征值开方、长轴 = `λ₁` 的特征向量；正交视图下"视线与圆平面法向成 θ"给出 `λ₂/λ₁ = cos²θ`，离心率**精确等于 `sin θ``（正是 spec §5.5 第 7 项的验收口径）。边视（θ = 90°）如实报**线段**并取圆上两个真实点（深度也是那两点的），不报压扁的椭圆；抛物线 / 双曲线 / 直线一律返回 `null`（屏幕空间重分类本次不做）。`projectionVisuals` 用**既有的 `polyline` 图元**承载采样点，因此三个消费方（视图、SVG/DXF/PDF 导出）零改动。
- **第 6 片的取舍（如实记档）**：spec §5.5 第 8 项"解析展开"**延后**——实测展开的多边形版与解析版**宽度只差 0.07%**（圆柱侧面展开的周长比 `n·sin(π/n)/π = 0.999287`），而投影是**定性差别**（斜看圆是真椭圆还是 48 段折线）。同样的工作量，投影的用户可见价值高一个量级；已在 spec §4 与 §5.5 第 8 项写明理由与状态。
- **第 6 片的残留限制（子代理如实报告、我复核确认）**：`resolveProjectedDrawing` 是**渲染器中立**的（拿不到相机/像素尺度），所以投影椭圆的采样用**相对容差** `1e-3·R`（曲率半径取 `a²/b`），推导出"世界半径 300px 时弦高 ≤ 0.3px"；它不是逐帧的屏幕误差驱动，与 3D 画布那条路径不同。这条限制写在实现注释里，未在浏览器里量过。
- **第 6 片的分工与独立验收**：本片由子代理实现（含 RED 证据与两次变异检查：去掉类型守卫 → 断言失败、把半轴写反 → 断言失败），我独立复核了改动面（`git status` 只有 5 个文件、未碰 `docs/` 与其他切片的文件）、逐行核对了投影数学与测试断言（不只断言离心率，还断言两个半轴各自等于 `r` 与 `r·cos θ`，并用"斜切圆柱的椭圆沿轴看回去又是圆"钉住两个半轴确实分开参与投影），随后**自己重跑全套门禁**：`typecheck` 无错、`lint` 0 error / 14 warning、单测 **113 文件 / 1260 用例**、Playwright **87/87**。
- **第 7 片（SVG 真曲线导出 + 解析框选）**：分两半交付，两半都由子代理实现、我独立复核与取 RED 证据。
  - **框选**：查证后发现真实缺口**只有圆弧**——`circle` 的"完全在框内"早就是解析判定（`圆心 ± r` 比包围盒），唯一还在采样弦的是圆弧（24 段）与它参与相交语义的 `segmentsOf`。现在圆弧的 `window`（完全在框内）改为**解析判定**：候选点 = 两个端点 + 落在弧内的四个轴向切点（0/90/180/270°），有向弧（负扫角）、整圆、空区间（如实判否而不是凭空造曲线）、非有限输入都处理了；**`crossing`（相交）如实保留弦判定**并写清误差方向（内接弦只会漏碰、不会无中生有）与超出本切片范围的理由。我发出的更正（"`circle` 本来就是解析的，RED 用例必须用圆弧"）避免了子代理写出一条"改前就通过"的假用例。
  - **SVG 导出**：椭圆改为真正的 `<ellipse>`（含 `rotate`，走画布同一套 `toX/toY/radiusToSvg` 映射），并把旧的 `not.toContain("<ellipse")` 断言**有意翻转为正向断言**、在注释里写明"行为有意改变"；**抛物线与双曲线保持折线**并写明理由（SVG 没有这两类图元，`<path A>` 画的是圆弧，硬套只会得到一条"看着精确其实错"的曲线）。
  - **我独立取的 RED 证据**：临时撤掉 `selection.ts` → **3 条失败**（含"弦全在框内但真弧顶出框"这条本片存在的理由）；临时撤掉 `exporters.ts` → **4 条失败**（椭圆 `<ellipse>` 断言）。两处都已还原。
  - **我修掉子代理留下的一处测试 bug**：它把圆弧端点 x 写成 `−1 − r·cos θ`（正确是 `−1 + r·cos θ`），符号写反后围着错值造框，"半径 1.3 出框"这个期望本身是假的（真实弧整个都在框里）。我重写了这条用例，改成**双向**检验：①框住整弧但排除弧外切点 `(−2, 1)` → 必须判"在框内"（只看全部四个切点的实现会误判否）；②框住两端点但排除弧内切点 `(0, 1)` → 必须判否（只看端点的实现会漏判）。
  - **spec 口径澄清（第 9 项）**：2D 画布的 SVG 导出器**故意不导出 3D 图元**（`circle3` / `section` 返回空串，3D 工作区禁用投影导出且有 e2e 钉住），所以原文的"`circle3` / 解析截面按真曲线导出"在这条路径上**不适用**；工程制图里的圆走第 6 片的投影真椭圆。
- **第 8 片（签名 + 旧档回归）**：
  - **`section.exact` 进签名：查证结论是不需要改代码**。`sceneContentSignature.ts` 用 `JSON.stringify(primitive)` 生成签名，解析字段本来就在里面；需要的是**钉住它**（防止以后有人为省字符串把它摘掉）。新增钉子用例：只改 `section.exact.kind`（多边形字段一模一样）⇒ 签名必须变；`intersectionFace.exactLoops` 同理。
  - **钉子用例的敏感性用变异检查证明**：把 `exact`/`exactLoops` 从签名里摘掉 → **只有这条用例失败**（`Tests 1 failed | 6 passed`），随后 `git checkout` 还原。
  - **旧档回归不需要新用例（如实说明覆盖来源）**：解析路径缺失时走折线，已有四条既有覆盖钉着——`operations.test.ts` 的"leaves a polygon source without an analytic boundary"（立方体截面 `exact` 为 `undefined`、`status === "approximate"`）、`solidTemplates.test.ts` 的旧文档物化与幂等、`threeScene.test.ts` 的"无 `exact` 时仍画多边形边界"、以及 e2e `workbench.spec.ts` 的 `.mgeo` 打开与草稿恢复。
- **第 3 片补做（收尾时逐条核对目标才发现的漏项）**：目标 ③ 明确列了"**3D 边界圆**"，但我当初只接了 `circle3` 与截面真曲线，**圆柱 / 圆锥的上下底圆仍是 96 段弦**，而且内核的 `rimCircles3` 成了**死代码**（违反本仓库"不留死代码"的规矩）。补齐：新增 `apps/web/src/rimCircles.ts`（`collectRimCircles` / `rimChordEdgeIds`，纯函数可单测——判定"两个端点落在**同一个**边界圆上"，因此母线不在集合里）、`threePrimitives.createRimCircles3`、`threeScene` 画解析边界圆并**跳过那些弦**（被选中时例外：选择反馈不能消失），画布读数 `data-rim-curves`。浏览器用例断言圆柱 `data-rim-curves = "2"`、`data-exact-curves = "2"`（边界圆一组 + 截面真圆），放大后细分点增加。
- **③ 的另一处如实偏差（不改，记录在案）**：spec §5.6 写的是用 `Line2` + `LineMaterial` 画描边，实现用的是 `THREE.Line`（与既有棱线、截面边界同一套 1px 线宽语言）。理由写进了 `createConic3Line` 的注释：本片要解决的是**曲线形状**（真圆 vs 折线），不是描边宽度；`Line2` 按像素宽画粗线时再上，而且它也不替你重采样（点还是我们按屏幕误差算的）。
- **A2（交面按支撑曲面分组）第 1 轮**：用户实测反馈"圆柱和立方体交面会被切成很多个片，这样很不合理"。根因用探针量化（立方体 4×4×4 ∩ 圆柱 R=2/h=6/48 段 = **50 片**：2 个圆盘 + **48 个圆柱侧面小四边形**，且这 48 片法向两两不同——所以"合并共面片"一片都减不掉，我用按法向直方图验证过才排除这条路）。设计见 `docs/superpowers/specs/2026-09-17-intersection-face-grouping-design.md`（提交 `48a620b`）。
  - **内核**：新增 `intersection-surfaces.ts` 的 `mergeIntersectionSurfaces3`——按**支撑曲面**分组：同平面合并成一个外环（靠"取消内部共享边的成对反向有向边"再串环），顶点都落在同一张圆柱/圆锥方程上的网格面并成一个**曲面区域**，其余如实逐个保留（不假装属于某张曲面）；曲面区域输出**解析片段环**（落在切割平面上的是 `segment`、落在二次曲面上的是 `conic`），区域按面积降序。
  - **实测验收**：50 片 → **3 个区域**（1 个圆柱侧带 `area 50.2296 / areaExact:false`、2 个平面圆盘 `area 12.566370614 / areaExact:true`）；侧带面积比真值 `2πRh' = 50.2655` **偏小 0.071%**（与事后估算一致）；侧带的 `exactLoops` = 2 个环、每环 1 段 `conic`（z=±2 处的圆），采样点径向误差 < 1e-9 且端点与网格顶点逐位重合。
  - **变异检查**（子代理做、我复核报告）：①跳过曲面分组 → 8/10 失败且报 `expected 3 but got 50`（立方体∩立方体与退化用例仍过，说明断言只测分组）；②不给曲面环输出 `conic` → 3 条失败。
  - **同时抓出并修掉 A1 的一个真缺陷**：`buildSolidQuadric` 的**非旋转分支**直接返回局部矩阵，没有平移到 `center`——实测 `center=(3,0,0)` 的圆柱，真正的表面点 `(5,0,1)` 代回二次型得 **21**（应为 0），平面 `z=1` 切出来的圆心是 `(0,0,1)` 而不是 `(3,0,1)`，**画布上那圈解析截面会画在离实体很远的地方**；而应用默认圆柱就建在 `center=(3,0,0)`，不是边角情形。修法：去掉这个捷径，一律走刚体共轭（无旋转时 `M = I`）。我自己写的 RED 证据是 `expected 21 to be less than 9e-9`，修后转绿；新增用例覆盖"表面点残差为 0 / 轴上点残差远大于 0（反向保护）/ 平面切出的圆心在 x=3 / 截面片段的圆心也在 x=3"。
  - **本轮的诚实缺口（下一轮做）**：**点出来的交面图元仍是一个网格小片**——`recomputeIntersectionFace`（`packages/scene-graph/src/operations.ts`）还在用旧的逐面重算、也从不写 `exactLoops`；另外曲面区域的 `points` 目前只放了它最大的那个环，于是侧带预览是一个很细的环（填充几乎看不见、也不好点）。也就是说：**预览数**从 50 降到 3 已生效，但"建出来的交面"要等下一轮接上分组结果才算真修好。
- **A2 第 2 轮（创建路径接上分组）**：把"点预览建出来的交面"接到分组结果上。
  - 内核：曲面区域的 `points` 改成**整条带的闭合多边形**（外环 + 其余环按外环绕向反走、并在接缝处走真实母线），这样侧带预览可填充、可点击；单环区域不变。**实现时发现字面意义的"把点列反过来"是错的**：网格边界给的两圈本来就是相反绕向，再反过来会让两半同向、配对错开一段、面积塌到 ~1e-16；正确做法是"按外环**绕向**反走"，已写进代码注释与用例（用"收尾边必须是母线：两端同径向、轴向差等于带高"来断言真的闭合，而不是拿 `points[0] === points.at(-1)` 这种恒真检查）。
  - DSL：`IntersectionFacePrimitive.areaExact?: boolean`（`true` = 闭式精确、`false` = 曲面区域按面片求和的数值近似），schema 校验 + 旧档兼容。
  - scene-graph：`recomputeIntersectionFace` 改为按**区域**认领（跑 `mergeIntersectionSurfaces3`，用两个来源的 `quadric3FromPrimitive`），写 `points / normal / area / areaExact / exactLoops`，并在区域没有解析边界时**清掉旧字段**（不留过期边界）；分组返回空时退回旧的逐面行为。
  - 检查器：交面块新增"面积精度"一行——曲面区域显示"数值近似（曲面区域按面片求和）"、平面区域显示"闭式精确"。
  - **实测**：`recomputeIntersectionFace` 在 hint 落在侧带时取到整条带（`areaExact === false`、`exactLoops` 两环、面积 ≈ `2πRh'`）；hint 落在端面时取到精确圆盘（`areaExact === true`、`|area − πr²| < 1e-9`）。
  - **变异检查**（子代理做、我复核数字）：把分组换成"退回逐面" → 4 条失败，侧带那条实测拿到的是 `area 1.0465 / 4 个点`的网格小片（比整条带的 50.23 **小 48 倍**），正是用户抱怨的那一片。
- **A2 第 2 轮的两个未决发现（如实记录，没修）**：
  1. **浏览器里点侧带预览建不出交面**。我加的 e2e 探针显示：hover 已经命中 `pair:cube-a|cyl-a:面0`（侧带），但点击之后对象列表没有新增交面、`data-preview-face-count` 仍是 3，而 `data-intersection-preview` 读数是 `section`——选中的立方体在画布上还带着默认截面预览（z=0 平面上的虚线方框），侧带中腰恰好也在 z=0，那块屏幕区域被截面预览接管，点击就没落到交面预览上。**创建路径本身**（hint 落在侧带 → 整条带 + `exactLoops` + `areaExact: false`）由 `intersectionExecution`… 由 `packages/scene-graph/src/intersectionSolid.test.ts` 的 4 条用例覆盖；**浏览器里"点侧带"这一条没有跑通**，需要单独处理（要么让交互优先级把交面预览排在截面预览之前，要么在侧带上避开截面预览所在的那一圈）。
  2. **本片的 e2e 断言被我还原掉了**：子代理新加的浏览器用例（50→3 + 点侧带）在点击那一步失败，同时它对既有 spec 的 helper 重构弄坏了原有的一条交线用例（第 141 行的 hover 断言）。我把整个 e2e 文件 `git checkout` 回已提交状态（既有 87 条全绿），**50→3 的浏览器级证据因此缺席**——它目前由单测覆盖（`apps/web/src/intersectionPreviews3d.test.ts` 19 例，含"该夹具产出 3 份面预览、侧带排第一"）。**这是覆盖缺口，不是通过。**
- **子代理报告的一次过程事故（我核查过）**：它有一次误用 PowerShell 文本管道写仓库文件、把编码弄坏，随后 `git checkout` 还原并用文件工具重做。我独立核验：改动涉及的 10 个文件**首字节无 BOM**（`/**`、`imp`、`exp`），`git diff` 全量扫 `锟`/`�` 等乱码特征**无命中**。
- **门禁（A2 第 2 轮后本机实跑）**：`typecheck` 4 个 workspace 通过；单测 **115 文件 / 1304 用例**通过；`lint` **0 error / 14 warning**（与基线一致）；生产构建通过；Playwright **87/87** 通过（e2e 文件已还原到已提交状态）。
- **A2 第 3 轮（区域的填充三角化 + 真曲线边界，收掉第 2 轮两条未决项）**：设计见 `docs/superpowers/specs/2026-09-17-intersection-face-grouping-design.md` §6。
  - **曲面区域的填充不能扇形三角化**：`points` 是"外环 + 其余环**反向**缝合"的多边形（配对 `points[长度−1−i] ↔ points[i]`），从 `points[0]` 扇形铺开会把两圈之间的**洞整块填掉**——48 段侧带会画成"顶上一块圆盘 + 几片横穿圆柱内部的三角形"。修法：内核新增 `IntersectionSurfaceRegion.outerRingLength?`（只有真的缝了不止一圈才写；平面区域与退回 `largestFace` 的情形都不写）→ DSL `IntersectionFacePrimitive.outerRingLength?`（schema 只收 ≥3 的整数）→ scene-graph 重算写入并**当派生字段摘旧值**（`withoutAnalytic` 一并清掉，否则会把平面多边形当条带缝）→ 渲染方（**创建出来的交面与预览命中面片共用** `regionFillPositions`）按**环向条带**三角化。RED 证据：8 段两圈的最小样本上，扇形给 **14 片且 z 跨度为 0**，条带给 **16 片且每片跨满带高**。
  - **真曲线边界这一片才真的接上**：spec §3.4 写的"`exactLoops` 存在时用 `createCurveLoops3` 画真曲线（已在用）"**当时并不成立**——`createIntersectionFaceGroup` 从没读过 `exactLoops`，交面边界一直是一圈 96 段弦。现在容差可用就把边界交给 `createCurveLoops3`（`createCurveLoops3` 增加可选的 `role` 参数，交面边界仍用 `intersection-face-edge`、并给每条线写 `segmentCount`），容差不可用（未给 / NaN / ≤0）**如实退回多边形弦**；`threeScene` 的交面条目签名带上"解析 or 多边形 + 容差档"，`wantsExactCurves` 把"带 `exactLoops` 的交面"算进去。RED 证据：`expected [LineSegments] to have a length of 2 but got 1`。
  - **整圈闭曲线片段改用闭式段数公式**：整圈的 `conic` 片段首尾同点 ⇒ 那根弦退化成一点、平坦度判据永远不满足，只能一路二分，而二分只给 **2 的幂**段数。实测弦高公式要 40 段时它给 **64 段**（`expected […] to have a length of 41 but got 65`）；`sampleConicRange` 现在遇到"闭曲线 + 整圈"直接用 `sampleClosedConic`。
  - **预览的顶点标记该收一收**：曲面区域的 `points` 是网格多边形（48 段侧带 = 96 个顶点），交面预览此前把每个顶点都画一个点标记 —— 画布上是两圈密密麻麻的点，与既有口径（"光滑交线一个采样点都不标"）冲突，缝合处的两个拐角也只是拼接多边形的接缝。现在**平面区域的拐角照旧标（4 边形 4 个）、曲面区域一个都不标**（真正的交点标记由交线预览负责）。RED 证据：`expected 16 to be +0`。
  - **第 2 轮未决项 ①（点侧带建不出交面）已查清并更正**：探针读数显示不带截面预览时点侧带**能**建出交面；真正被拦下的是射线**真的命中来源立方体的棱**——相机方位角 45° 时那个侧带点恰好与立方体 (2,2) 竖直棱共线，`data-pick-readout = edge|cube-a-edge-25|precise|hover|behind`，按 `threePicking.ts` 既有优先级（真命中棱 > 预览）点击被解释为选中那条棱。偏离 ±30° ⇒ `face|…|coarse|hover|front`、创建成功；偏离 ±50° ⇒ 射线贴着交线（hover 变 `:线`）。这是既有优先级的必然结果、**不是新缺陷**；第 2 轮"被截面预览接管"的说法只对了一半，已按实测更正。
  - **第 2 轮未决项 ②（浏览器级证据缺席）已补上**：新增夹具 `e2e/fixtures/cube-cylinder.mgeo` 与用例 `e2e/three-intersection-band.spec.ts`——`data-preview-face-count = 3`（50→3 的浏览器证据）、点侧带建出**整条带**（检查器面积 `50.230` = 48 段内接带面、顶点数 96、"数值近似"）、`data-exact-curves` 1→2、放大后细分点增加。**变异检查**：把解析边界关掉重跑该用例 ⇒ `data-exact-curves` 读回 `1`（`Expected "2" Received "1"`），证明这条断言不是空的；随后还原。
  - **门禁（A2 第 3 轮后本机实跑）**：`typecheck` 4 个 workspace 通过；单测 **115 文件 / 1315 用例**通过（+11）；`lint` **0 error / 14 warning**（与基线一致）；`npm run build --workspace @draw/web` 通过；Playwright **88/88** 通过（+1 新用例）。
  - **推送时发现远端已多一个提交**（`a74959b`：封闭曲线绕定点旋转 + UI 重排，同一天另一个会话推的，动到了同一批文件 `dsl/schema.ts`、`dsl/types.ts`、`scene-graph/operations.ts`、`project-progress.md`）。按仓库既有做法 `git rebase origin/main`：自动合并、无冲突，两边内容都在（schema 的那行校验、`types.ts` 的 `outerRingLength`、`operations.ts` 的三处、进度文档两段）。**rebase 后重跑全量门禁**：`typecheck` 通过；单测 **117 文件 / 1359 用例**通过；`lint` 0 error / 14 warning；Web 构建通过；Playwright **91/91** 通过。README 的基线行按合并后的实测值更新（117 / 1359 / 91）。
- **修 bug（2026-09-17，用户实测反馈）：自由拖动圆锥 / 圆柱时底部圆不跟手**。用户原话："自由移动圆锥圆柱时，底部圆的动画单独跑掉了，不跟手一起。"
  - **根因（先复现、后修）**：圆柱的上下底 / 圆锥的底由 `createRimCircles3` **另画一份解析圆**，那份对象是"组 + 每圈线"**两层都挂着同一个 `primitiveId`**（`threePrimitives.ts` 的 342 / 320 行），而拖动偏移是按 `primitiveId` 遍历加在 `position` 上的（`applyDragOffsets` / `offsetSceneObjects`）：组加一次、线再加一次 ⇒ 那棵子树以**两倍**位移跑掉。实体的网格与棱只有一层，所以"实体跟着手、圆自己飞"。拖动期间**文档不提交**（画面全靠这些临时偏移），所以文档里完全看不出这个错、只在画布上表现成"圆单独跑掉"，抬手提交后一切又对——正是"动画"这个词的来源。
  - **RED（用真构造器复现，不是手搭 mock）**：`createSolidGroup(cylinder)` + `createRimCircles3(...)` 放进同一个场景，`applyDragOffsets` 画一个 `(1,0,0)` 后按**世界位置**核验 ⇒ `expected { role: 'exact-curve', dx: 2 } to deeply equal { role: 'exact-curve', dx: 1 }`。
  - **修法**：偏移只画在**同一个图元的最外层**那一层（有同 id 祖先的对象跳过自己——组平移本来就会把整棵子树带走，两者在几何上等价）。这是**一条通则**，不是给边界圆打补丁：`threeScene.test.ts` 里同时钉住另一条偏移路径（拖动剖切面走 `offsetSceneObjects`，截面同样是"组 + 每环网格"两层挂 id），变异实验（把守卫短路）下两条用例分别报 `dx: 2` / `dy: 2`。
  - **顺手清掉一处死状态**：`userData.dragOffset` 此前只写不读。现在它是 `dragOffsetDrift(scene, family, applied)` 的依据：抬手时把"family 里每个对象由自己 + 祖先累计的偏移"与本次拖动画上去的位移相比，取最大偏差写进画布读数 **`data-drag-offset-drift`**（只算一次，不在每帧热路径上）。
  - **浏览器级证据**：`e2e/geometry3d-drag.spec.ts` 新增用例——加圆柱（先断言 `data-rim-curves = "2"`）、按内容包围盒中心投影点按住拖动（先断言 `data-drag-target` 命中 `cylinder`，避免"没抓到手"的假通过）、抬手断言 `data-drag-offset-drift = "0.0000"` 且圆柱中心确实移动了。**变异检查**：把守卫短路后重跑 ⇒ 读数 `1.1732`（`Expected "0.0000" Received "1.1732"`），证明这条断言不是空的；随后还原。
  - **门禁（修完本机实跑）**：`typecheck` 4 个 workspace 通过；单测 **117 文件 / 1362 用例**通过（+3）；`lint` **0 error / 14 warning**（与基线一致）；Web 生产构建通过；Playwright **92/92** 通过（+1 新用例）。README 基线行同步为 1362 / 92。
- **再修两个 bug（2026-09-17，用户实测反馈）**："现在圆柱上的点又不跟着动了，而且曲面交面相当乱，交出一大堆面，但是无法获取那个曲面。"
  - **① 拖动时点标注不跟手**（用户原话里的"圆柱上的点不跟着动"）。先复现：加圆柱 → 自由拖动 → **按住不放**时读那层 HTML 点标注（`.three-point-label`）的屏幕位置，实测与拖动前**逐位相同**（`labelsMovedDuringDrag=false`，而 `data-drag-frames=6`：实体确实在动、字母钉在原处），抬手提交后才跳过去。根因：标注此前按**文档坐标**投影（`visiblePointLabels` 的 `primitive.position`），而拖动期间文档**不提交**、画面全靠加在 Three.js 对象上的临时偏移 ⇒ 手柄跟着走了、字母没跟。修法：把投影提成纯函数 `apps/web/src/pointLabels.ts` 的 `pointLabelPlacements(points, objectOf, camera, size)`，**投影画面上那个对象的世界位置**（`objectIndex.get(id).getWorldPosition`），找不到对象时如实退回文档坐标。RED/变异：把"用对象位置"短路 ⇒ `pointLabels.test.ts` 两例失败（偏差 108px / 41px），e2e 也报标注位置在拖动中没变。
  - **② 曲面 ∩ 曲面的交面"一大堆、拿不到曲面"**（圆柱 ∩ 圆锥，同底同高 ⇒ 交集就是圆锥自己：48 个侧面三角形 + 1 个底面圆盘 = **49 片**）。两条根因都在"这个面是不是这张曲面上的一片"：**(a)** `radiusAt` 用 `ratio > 0`，锥尖处 `ratio` 恰为 0（半径本来就是 0，顶点在曲面上）⇒ 每个带锥尖的三角形都被排除；**(b)** 锥尖在轴上，`atan2(0,0)` 没有意义，按所有顶点量张角会把 7.5° 的侧面片量成 93°…116°，照样超过"一片最多张开 60°"。修法：`ratio >= 0`（只有越过锥尖才 `null`）+ 张角只按**离开轴**的顶点量（少于两个就不当它是曲面片）。**49 → 2 个区域**。
  - **② 的后半段（极点）**：圆锥面的边界只有底面那圈，锥尖在曲面内部、不在边界环上 ⇒ 多边形填充会把"圆锥面"填成底面圆盘，形心还与真正的底面圆盘区域**完全重合**（实测两者都是 `(0,0,0)`）——点锥面认领到的还是那张圆盘。新增 `poleIndex`（极点＝曲面内部、不在边界环上的唯一顶点，且径向 ≈ 0），`points[0]` 就是它；渲染方**绕极点铺开**、边界与顶点标记都排除它（极点与缝合带互斥：有极点就只有一个边界环）。
  - **RED/变异证据**：内核 `expected [] to have a length of 1 but got +0`（一个圆锥区域都分不出来）；web 极点用例 `expected [ …(7) ] to have a length of 8 but got 7`（不绕极点铺就是底圆那 7 片）；浏览器变异（`radiusAt` 改回 `ratio > 0`）⇒ `data-preview-face-count` 从 **2** 回到 **49**（`Expected "2" Received "49"`），正是用户看到的那一堆面。
  - **浏览器级证据**：新 e2e `e2e/three-intersection-cone.spec.ts` + 夹具 `e2e/fixtures/cylinder-cone.mgeo`（49→2、状态栏"2 个交面"、hover 命中 `面0`、点锥面建出的交面面积 **20.1**、"数值近似"）；`e2e/geometry3d-drag.spec.ts` 新增"按住不放时标注已经在跟着走"的用例。
  - **门禁（两个修复后本机实跑）**：`typecheck` 4 个 workspace 通过；单测 **118 文件 / 1368 用例**通过（+1 文件 +6 用例）；`lint` **0 error / 14 warning**（与基线一致）；Web 生产构建通过；Playwright **94/94** 通过（+2 用例）。README 基线行同步为 1368 / 94。
- **把"曲面"画成光滑曲面（2026-09-17，用户实测反馈）**："我需要的只是那个相交的曲面，但是在我们的图里面，相交那个曲面是由很多三角形拼出来的。" 设计见 spec §8。
  - **先看画布再动手**：e2e 探针截图（`e2e/tmp-probe5.spec.ts`，用完即删）显示建出来的圆柱侧带在放大后有一条条竖条纹、侧影是多边形——**区域**已经是一个，但它的**填充**还是 48 段网格面片。与 A1 的"真圆"同一类问题：曲面是解析的，只有"画出来"这一步在离散化，粒度不该钉死在 48。
  - **内核交出面本身**：`IntersectionSurfaceRegion.surface = { kind, origin, axis, radius, height }`（半径 / 高反解不出来就不写）；DSL 同名可选字段 + schema 校验（kind / 有限坐标 / 非零轴 / 正半径与正高）；scene-graph 写入并当派生字段摘旧值。
  - **渲染按屏幕误差细分 + 吸到曲面上**：`regionFillPositions` 先把区域铺成三角形（绕极点 / 环向条带 / 扇形），再把每片均分成 `n × n` 并把新顶点用 `snapToSurface` 吸回真正的曲面（圆柱径向恒定、圆锥随高度线性收缩）；`n ≈ √(最长边弦高 / 容差)`，对整块区域取同一个 `n`（共享边两边算得一样 ⇒ 不会有 T 形接缝）；上限 20000 片是性能保护。容差档进交面 / 预览的签名，缩放跨档才重建。
  - **RED/变异证据**：web 单测 `expected 16 to be greater than 16`（把细分短路）；断言本身钉住"每个顶点都落在半径 2 的圆柱面上、每片质心径向偏差 < 0.001"（弦高 ≤ 容差）。
  - **浏览器级证据**：新读数 `data-face-triangles`——锥面 48 → 放大后 432、条带 96 → 864（e2e 断言"放大后 > 3 倍"）；截图对比确认竖条纹消失。
  - **门禁（本轮本机实跑）**：`typecheck` 4 个 workspace 通过；单测 **118 文件 / 1369 用例**通过；`lint` **0 error / 14 warning**（与基线一致）；Web 生产构建通过；Playwright **94/94**（**连续三次**）。**如实记录**：其中一次全量跑出现过一条 `toHaveAttribute` 失败（93/94），未留下用例名、随后三次都没复现，按"未复现的偶发"记着。README 基线行同步为 1369 / 94。
- **A1 收尾状态**：8 片全部落地；唯一未做的是 spec §5.5 **第 8 项「解析展开」**，已在 §4 与 §5.5 写明**延后理由**（多边形版与解析版宽度只差 0.07%，价值低于投影那一项）。用户口径"我不要一个逼近的圆，我需要一个真的圆"在下列位置全部兑现：截面解析圆锥曲线、真曲线渲染（细分跟着缩放走）、检查器读数、测量精确化、工程图投影真椭圆、SVG `<ellipse>`、框选解析判定。
- **收尾决定（2026-09-17，用户选定）**：目标文本里剩的两项——③ 的 `Line2` 描边与 ⑥ 的圆柱/圆锥解析展开——**按"就此收尾 A1"处理**：用户可见的"真圆 + 曲面相交"已全链路交付，这两项属于清单上的工程润色、代价/收益不划算（`Line2` 要同时改 `resolution` 同步 / 拾取语义 / `dispose` 三处，收益只是圆帽与按像素加粗；解析展开与多边形版的宽度差只有 0.07%）。两项都已在 spec 里带着**明确的理由与后续做法**挂着（§5.6 与 §4/§5.5 第 8 项），不是漏做、也不是静默丢弃；真要做时按 spec 里写的三处回归补齐即可。
- **第 1-2 片门禁（当时实跑）**：`typecheck` 4 个 workspace 通过；单测 **110 文件 / 1232 用例**通过（较上轮 +2 文件 +22 用例）；`lint` **0 error / 14 warning**（与基线一致）；生产构建通过；Playwright **86/86** 通过。
- **过程纪律记录**：这一轮我误用了一次 PowerShell 的 `Add-Content` 追加仓库文件（本仓库明令只用编辑工具改文件，PowerShell 文本管道会按 ANSI/BOM 破坏中文）。发现后立即 `git checkout` 还原，并核验首字节是 `imp`（无 BOM）、`git status` 干净，随后改用编辑工具完成。
- **第 3 片（真曲线渲染）**：`conicSampling.ts`（纯函数：弦高公式 `segmentsForSagitta`、闭曲线采样、开曲线自适应、片段环 → 点列、`curveToleranceFor` 与 2 的幂**滞回档**）、`threePrimitives.ts` 的 `createConic3Line` / `createCurveLoops3` / `createCircle3Line`、`circle3` 真正渲染、截面在解析可用时**只画填充、边界交给真曲线**、`threeCamera.worldUnitsPerPixel` 提为单一来源（点手柄与曲线容差共用）。画布读数：`data-section-exact-kind` / `data-section-exact-status` / `data-exact-curves` / `data-exact-curve-segments`；新浏览器用例 `e2e/three-exact-circle.spec.ts` 断言"圆柱默认截面是精确圆 + 放大后细分点变多"。
- **第 3 片 RED→GREEN（内核 12 例 + web 采样 6 例 + threeScene 53 例 + 浏览器 1 例）抓到四个真问题**：①`createSectionMesh` 加 `omitBoundary` 时把 `group.add(mesh)` 留在了边界代码之后，提前 `return` 连**填充一起丢掉**（用例报 `Cannot read properties of null`）；②自适应采样的**中点判据被对称曲线骗过**：`y = x³` 在 `[-2,2]` 上中点偏差恰为 0（`(3/8)h²|2a+h|`，此处 `2a+h = 0`），整条曲线只采两个点却离弦极远 → 改成 1/4、1/2、3/4 三处取最大偏差；③相机缩放**根本不会触发内容同步**，容差档变了曲线却不重采样（浏览器用例抓到）→ 把档位提成状态并纳入同步签名；④把容差档无条件写进签名会让"只有立方体"的文档每次缩放都白跑一次同步，**顺带触发自动取景重新构图**——实测两条既有 e2e（autofit、相交预览）因此失败，改成"只有画布上真的存在解析曲线时才把档位写进签名"。
- **第 3 片的两条实测记录（都写进了用例注释）**：①8 次滚轮只放大 1.21×，读数仍是 32 段——容差按 2 的幂滞回，**小幅缩放不改细分点是正确行为**；②浏览器会**合并**连续滚轮事件，所以用例改成"持续放大直到读数增加"的轮询，而不是假定"发 N 次就放大 N 倍"；③依赖相机稳定的 e2e 必须先点掉"自动取景"（既有用例一致做法）。



### 平面画布网格改为固定尺寸（2026-09-17，用户要求）

- **用户原话**："平面缩放也会导致网格大小变化，我需要固定网格大小。"
- **根因**：平面画布用 `viewport.ts` 的 `gridStep(scale, 28)` 按屏幕像素挑"好读"的步长（0.1 / 0.2 / 0.5 / 1 / 2 / 5 / 10 / …），于是缩放时**格子本身在变**（放大变细到 0.1 单位、缩小变粗到 1000 单位），网格不能当尺子用。3D 背景坐标系早就按同一位用户的要求改成"一格恒为 1 个世界单位"，平面画布一直没跟上。
- **改法**：删掉 `gridStep`，新增 `gridLinePositions(min, max, step = GRID_CELL)`——**函数刻意不收缩放参数**，位置只由世界坐标区间与格边长决定，因此"格边长不随缩放变化"是结构性的。画布改用 `GRID_CELL = 1`（与 3D 共用 `sceneGrid.ts` 的常量）画细线、每 `GRID_MAJOR_EVERY = 10` 格画一条主线（缩得很远时细线变密，主线仍是可靠标尺），并在画布上暴露 `data-grid-cell` / `data-grid-major` 读数供断言。超过 `MAX_GRID_LINES = 4000` 条线时干脆不画（当前 0.05×～40× 的缩放范围最多约 430 条，够不到这个上限）。
- **验证**：`viewport.test.ts` 换成固定格边长的用例（最远 / 最近缩放下的间距都恒为 1、锚在整格上、退化输入与超限返回空）；新增 `e2e/planar-grid-cell.spec.ts` 在真实浏览器里量相邻竖网格线的**世界**间距：默认视图、放大后、缩小后、重置视图后**都恒为 1**，主线间距恒为 10。

### 全身大体检（2026-09-17）：并行只读审计 + 按严重度修复

- **做法**：4 路只读审计分头覆盖 `geometry-kernel`、`dsl`（schema/codec）、`scene-graph`（依赖图 / 重算 / 级联）、`apps/web`（状态 / 渲染 / 拾取）与持久化 / 基础设施，逐条给出 `文件:行号` 证据；随后我自己补一条**性质测试**把"增量重算 ≡ 全量重算"这条不变式钉死，凡审计与性质测试确认的缺陷一律**先写失败用例（RED）再修（GREEN）**，不确认的只记录不猜改。
- **性质测试先抓到一个真缺陷**（已修，提交 `e6a1e77`）：`primitiveDependencies` 漏掉"依赖图元的**已物化拓扑**"，数值改顶点后 `section` / `intersectionFace` 残留旧几何。`packages/scene-graph/src/recomputeConsistency.test.ts` 用 12 条平面 + 10 条空间编辑断言 `commitPatch` 后再做一次全量重算**不改变任何字段**；同一提交顺带修掉"交点预览画在点的命中层之上"（预览 14px 命中圆抢走动点 pointerdown）与预览被重复渲染两次的问题。
- **本轮修复的缺陷（都带 RED→GREEN）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | `parameters.ts` 存在**第二套求值器**，只认 6 个函数，其余函数名落到 `Math.tan` 兜底（`ln(2)` → `tan(2)`），错值还会写进 `parameter.value` 存盘 | 删掉副本，统一走 `expression.ts` 的求值器（变量用 Proxy 惰性解析，循环引用与未定义变量语义不变） |
| 内核 | `clampPointIntoSolid3` 用**全体顶点形心**定面朝向，凹实体形心在体外时会翻反内凹面法向，把点留在空气里还报"已满足" | 改用**有符号体积**定朝向；先判凸性，凹 / 退化 / 绕向自相矛盾的实体返回 `null`（宿主不存在 → 上层报数据不足），收尾再用"顶点形心 → 当前点"二分兜底 |
| 内核 | 面法向退化判据用**绝对** EPSILON 比 Newell 法向模长（≈2×面面积），1e-5 量级实体所有面都算不出来、夹取静默失效 | 全部改为**随实体尺度**的相对容差 |
| 内核 | `sectionPolyhedron3` 从不校验剖切平面，零法向（每个点都"在平面上"）会**凭空造出一片立方体面**并报 `polygon` | 法向零 / 非有限 / 相对尺度可忽略时返回 `insufficient-data` |
| 内核 | 顺时针圆弧的投影参数超出参数域（`startAngle + delta`，可达 2π 以上）而 `parameterBounds` 返回**反序区间**，动点一拖就跳到端点、滑块区间也是倒的 | 顺时针弧返回 `startAngle + delta − 2π`，参数域按 `[endAngle, startAngle]` 升序 |
| 内核 | `lineConstraint.project` 对非有限输入返回 `parameter: ∞`、坐标 `{∞, 0}` 且 `converged: true` | 输入或结果非有限时返回 `null`（`DynamicPoint.moveTo` 已有"未收敛、不移动"分支） |
| 内核 | `parameterBounds()` 返回**同一个可变对象**，调用方改一下就会污染约束 | 一律返回副本 |
| 内核 | 退化直线上的平行 / 垂直 / 共线约束残差返回 0（"完美满足"）、`converged: true`、几何一动不动也无诊断 | `ConstraintSolveResult` 增加 `unsatisfiable: string[]`，退化目标被显式列出；`operations.ts` 在求解失败时用它们给出准确诊断 |
| DSL | `document.parameters` 只校验"容器是对象"：`null` 会白屏，`id !== key` 让编辑静默丢失，非数字 `value` 变 NaN 且文档再也存不回去 | 逐条校验 `id === key`、有限 `value`、`expression`/`label`/`ownerId` 类型、`min`/`max`/`step` 有限且 `step > 0` |
| DSL | `metadata` 只校验 `id`，缺 `name` 的文件打开后一按导出就抛 TypeError | 要求 `metadata.name` 为非空字符串 |
| DSL | `section.loops` 从不校验，直接进 3D 预览的描边 / 三角化路径（非数组或 NaN 坐标） | 校验为"点数组的数组"且坐标有限 |
| scene-graph | 删除对象时分组只摘成员、不回收空壳，剩 1 个成员的分组让 `validateDocument` 失败 → 文档**再也存不回去** | 摘到成员 < 2 时解散该分组 |
| scene-graph | 平面点的 `derived` 绑定在来源被删后留下悬空引用（空间点早有降级，平面点漏了） | `unbindDeletedHost` 一并降级为自由点 |
| web | 打开 `.mgeo` 不清选中状态：id 是确定性的（`point-1`），属性栏会继续编辑"打开来的同名对象" | `load()` 清空选中 / 创建流程 / 活动图纸与视图 |
| web | 导出 SVG 的射线裁剪是**画布那份的副本**且 x 限位写反，导出与画布画得不一样 | 复用 `rayToViewport`；顺带把裁剪改成真正的矩形 slab 裁剪（旧实现与常数 20 取 min，起点在视口外时射线停在视口中间） |
| web | PDF 用 WinAnsi-only 的 Helvetica 画**应用自己生成的中文诊断**，只要有一条诊断整个 PDF 导出就失败 | 抽出 `winAnsiSafe()` 把不可编码字符替换成 `?`（真正的 CJK 需内嵌字体，已记入功能目录限制） |
| web | 读不出来的草稿被 `removeItem` **静默删除**（旧版本字段 / 手工改坏的文档都是用户的工作） | 区分"不是 JSON"（垃圾，删）与"是文档但读不出来"（挪到 `:unreadable` 旁路键保留并抛出，启动时如实提示） |
| web | `saveWorkbenchPreferences` / `saveViewPreference3d` / `saveDraft` 无 try/catch，配额溢出时从点击处理里抛错，界面半更新 | 三处都吞掉写入失败（视图偏好存不下是可接受降级） |
| 基础设施 | `test:e2e` 先构建 `apps/web/dist`，而 `e2e/global-setup.mjs` **preview 的是 `build-check/mathcanvas-current`** ——实测那份产物是 9/14 的旧 bundle，Playwright 全绿与当前源码无关 | global setup 改为按 `apps/web` 自己的 vite 配置**重新构建**同一个目录再 preview；`test:e2e` 不再做无用构建 |

**第二批（同一轮体检的继续，同样 RED→GREEN）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | 两条棱的角度标注固定拿**第一条棱的起点**当顶点：折线拐角（A 的终点 == B 的起点，最常见用法）量出来是 45° 而不是 90° | 在**公共端点**处量；没有唯一公共端点（不相邻或完全重合）报数据不足，说明改写成"两条共端点的空间棱" |
| 内核 | 框选"完全在框内"只检查每条采样弦的**起点**，弧的终点从不参与判定（终点戳出框外仍算全在框内，误差可达一个弦长） | 采样点包含终点（`arcSamplePoints`，0..N），弦由同一份采样派生 |
| web | 3D 视口把 Shift 记在 **pointerdown 的快照**里：先按住左键再按 Shift 完全不生效，拖动中松开也不会回到旋转 | 修饰键取**当前移动事件**状态，判定抽成纯函数 `cameraDragMode` 并有单测 |
| web | SVG / DXF / PDF 导出都硬写 `slice(0, 4)`，而 `addDrawingView` 允许更多视图 → 第 5 张起**静默丢失** | 三个导出器都导出全部视图：SVG 画布高度按行数增长、PDF 每个视图一页、DXF 无布局约束 |
| web | `drawingBounds` 用 `Math.min(...points.map(...))` 展开实参，点数一多就 `RangeError: Maximum call stack size exceeded`，整份导出失败 | 改成一次循环求极值（顺带省掉四次数组分配） |
| web | SVG 诊断文本的行号用 `indexOf` 求：重复诊断互相覆盖，且整体 O(n²) | 用 map 的下标 |
| web | 导出 CSV 带中文标签却没有 BOM，Excel（Windows）按 ANSI 解码 → 打开即乱码 | 输出以 `\uFEFF` 开头 |
| 死代码 | `persistence/mgeoStorage.ts`（`saveMgeo`/`loadMgeo` 两个只转发的壳）全仓库**没有任何生产调用点**，只有它自己的测试 | 删掉模块；那 3 个有价值的往返用例改用真正的 `encodeMgeo`/`decodeMgeo`（新文件 `mgeoRoundTrip.test.ts`），覆盖不变 |
| 体检结论 | 怀疑仓库里存在"PowerShell 文本管道"留下的乱码注释 | 写一次性脚本按字节扫描 280 个源文件 / 文档中的乱码特征字符：**没有任何文件命中**（此前看到的中文乱码是 `Get-Content` 的输出误解码，不是磁盘内容） |

- **第二批的 RED 证据是实跑出来的**（不是推演）：把三个源文件临时切回修复前的提交再跑新用例，得到 `expected 45.00000000000001 to be close to 90`（角度顶点）、`expected true to be false`（弧终点在框外却被判全在框内）、`expected false to be true`（CSV 无 BOM），以及一个审计没提到的连带问题——**两条不相邻的棱旧实现会返回 `valid` 和一个毫无意义的度数**（新用例期望 `insufficient-data`）。随后 `git checkout HEAD --` 还原源码，三个文件 30 个用例全绿，工作区 clean。

**第三批（同一轮体检的继续）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | `onRay` 用**绝对**容差（1e-12）判"交点在射线的前向半线上"，而垂距是长度量纲：在 ~1e6 的坐标上光浮点残差就有 ~1e-10，确实相交也被判成 `none`，理由还错写成"交点在射线起点之后" | 改用 `scaledTolerance`（随坐标尺度）；真在起点之后的解仍然被挡掉（新用例两侧都钉住） |
| 内核 | `ringNormal` 取**前三个点的叉积**：环上前三点共线是合法多边形（五边形底面从一条边的中间点开始），叉积为零 → `flatteningAngle` 把展开角当成 0 度 → 侧面留在折合姿态而 `status` 报 `ok` | 法向改用整个环的 **Newell**（只有环真的零面积才返回 null）；`flatteningAngle` 返回 `number \| null`，环没有法向时给出诊断并返回 `insufficient-data`，不再静默按 0 度展开 |
| 死代码 | `store.ts` 的预览三件套（`beginPreview` / `previewParameter` / `commitPreview`）与 `cancelPreview` 全仓库**没有任何调用点**（连测试都没有），`previewBase` 只被它们读；而且 `apply` 会把 `previewBase` 清空，预览中途再改一次就再也回不到基线 | 一并删除（连同 5 处 `previewBase: null` 赋值与 3 个测试里的初始化字段），`typecheck` 4 个 workspace 通过 |

- **第三批的 RED 证据同样是实跑出来的**：`onRay` → `expected 'none' to be 'point'`；展开（共线根环）→ `expected +0 to be close to 1`（侧面没被摊平）；展开（零面积环）→ `expected 'ok' to be 'insufficient-data'`。
- **审计里被证伪的一条**（记录，不改）：报告说 `threeScene.tsx:538` 的内容签名漏了 `focused` / `label`，会留下过期的预览分组。实际签名是 `` `kind:${item.kind};${JSON.stringify(item)}` ``，而 `ThreeScenePreview` 本身就带 `label` 与 `focused` 两个字段，JSON 里都包含——**不会过期**，属误报。

**第四批（性能与交互）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核（性能） | `clipByPlane` 的顶点索引每次插入都 `findIndex` 线性扫描并**重建字符串键**：一次裁剪 O(F·V) 次键构造。实测两个 48 段圆柱近似（各 ~100 顶点 / 50 面）一次交集 **137ms**，96 段 **1025ms** | 一次建 `Map<键, 下标>`（语义不变：键相同时仍取最早的下标）。实测同样三次降到 **27ms / 83ms**，体积逐位一致（`2.409054 / 2.444787 / 2.453749`） |
| web | `cameraMemory` 只有**一个槽位**：交替打开两个 3D 文档时，后者的相机会覆盖前者，切回去只能重新取景 | 改成按文档保存的 `Map`（上限 4，最近写入的优先保留），仍只在内存里 |
| web | 投影视图的工程标注文本没有 `pointer-events: none`：SVG 文本默认吃指针事件，尺寸标注压在棱 / 点上时点击落不到图元（平面画布的标注一直是 `none`） | 标注分组加 `pointerEvents="none"`（标注本来就没有点击处理，只是读数） |

- **第四批 RED 证据**：大体量布尔交集用例在旧实现下 `Test timed out in 5000ms`（新实现 6 次 96 段交集共 632ms）；相机记忆 `expected null to deeply equal { azimuth: 100, … }`；标注 `expected null to be 'none'`。

**第五批（可访问性）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 可访问性 | 草稿模式的**夹点完全不可键盘操作**：它们是挂在 `aria-hidden="true"` 分组里的装饰 `<circle>`，没有角色、没有焦点、没有键盘通路——键盘用户根本无法移动已选图元的端点 | 夹点变成可聚焦的 `role="button"`（`tabIndex=0` + `aria-label` 读对象名、`data-primitive-id` 供程序化定位），方向键按 1 个世界单位移动、Shift 加速 10 倍；走的是**与拖动同一条提交路径**（`createDragAction` + `onDragEnd`），因此撤销粒度与几何约束完全一致 |
| 可访问性 | `Tab` 在多个捕捉候选之间循环时无条件 `preventDefault()`，且不区分 Shift——**键盘用户走不出这个 SVG**（WCAG 2.1.2 键盘陷阱） | 只接管不带 Shift 的 `Tab`；Shift+Tab 交还浏览器（新用例断言事件未被取消、候选也不被换掉），无 Shift 的循环功能保留 |
| 体检结论 | 审计说 `circle3`"没有重算分支、会留下旧几何" | **证伪**：`Circle3Primitive` 只有 `centerId`（引用）+ `normal` + `radius`，**不存圆心坐标的派生态**，因此没有东西会过期；`centerId` 的依赖边与删除保护都在 |
| 体检结论 | 审计说 `DrawingSheetView` 有 observer churn | **证伪**：`ref={setWrapper}` 传的是 `useState` 的稳定 setter，`measure` 是 `useCallback([wrapper, paperWidth, paperHeight])`，ResizeObserver 只在节点 / 纸张变化时重建一次；`clientWidth/Height` 那个 effect 依赖不变也不会自激 |

**第六批（内核 API 的容差与输入护栏）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | `polyline.pointOnRay` 用**绝对** 1e-9 比叉积残差（长度量纲）：~1e9 坐标上"确实在射线上"的点会被判成不在（与已修的 `intersections.onRay` 同一类） | 用 `scaledTolerance`（`tolerance` 仍是绝对下限，相对项 1e-11）；真在射线外 / 反向的点仍然被拒 |
| 内核 | `distanceToPolyline` 对**只有一个点**的折线返回 `+Infinity`（退化成点却报"无穷远"） | 返回"到那个点"的距离；一个点都没有时才 `+Infinity` |
| 内核 | `buildSolid` 的 `catch {}` 把**任何**内部异常都说成"输入不合法"，真实原因被吞掉 | 诊断带上原始消息（"solid builder failed to create valid geometry: <原因>"） |
| 内核 | `segments` 只有下界（< 3 才拒）：`buildSolid("cylinder", { segments: 1e9 })` 会去分配十亿个顶点——浏览器卡死 | 新增 `MAX_SOLID_SEGMENTS = 256`（与 DSL schema 的上限一致）并在诊断里点名范围 |

- **第六批 RED 证据**：`pointOnRay` 大坐标 → `expected false to be true`；单点折线 → `expected Infinity to be close to 2`；`segments: 257` → `expected [ {…}, {…}, …(1543) ] to deeply equal []`（旧实现照样建出 1545 个图元）。
- **性能项实测（记录，不改）**：审计说"每帧自动保存 `encodeMgeo` + 同步写 localStorage 会造成输入卡顿"。实测 `encodeMgeo` 单次开销：示例文档（3 图元）**0.029ms**、200 图元 **0.219ms**、3000 图元 **2.631ms**——课堂规模文档下可忽略，所以不为它引入防抖（防抖会削弱"刷新即恢复草稿"的既有保证）。同一条审计还说"一次按键一条撤销记录"：这是**既有测试明确钉住的行为**（`store.test.ts` 连续 101 次 `setParameter` 期望 100 条历史上限），属设计选择而非缺陷。

**第七批（崩溃与"假满足"）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | `offsetPrimitive` 的折线分支对首段与中间段写了 `frame(...)!`，而 `frame` 对**重复顶点**返回 null（该段没有方向）→ 带重复点的折线一偏移就抛 `TypeError`，而不是按约定返回 null（末段那处一直有判空，说明作者知道会返回 null） | 先算全部段的 frame，任一段退化就返回 `null` |
| 内核 | `constraints3d.planeNormal` / `measurements3d` 的点面距离：schema 只要求法向"非零"，`(1e-30,0,0)` 能存进文档，而 `normalizeVector3` 对长度 < 1e-12 的输入返回**零向量** → 点积恒为 0 → 约束"永远满足"、距离读数恒为 0 | 归一化失败时返回 null / 报 `insufficient-data`（诊断文案"平面法向量退化"），非单位但可归一化的法向照常工作 |

- **第七批 RED 证据**：折线重复点 → `expected [Function] to not throw an error but 'TypeError: Cannot read properties of …' was thrown`；退化法向约束 → `expected +0 to be null`；退化法向距离测量 → `expected 'valid' to be 'insufficient-data'`。

**第八批（未校验的数值选项）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | `markers3d` 的二面角弧步数：`Math.max(2, Math.floor(NaN))` 仍是 NaN → 循环一次都不跑 → 标记照常返回但 `arc` 是**空数组**（画布上画不出弧）；`arcSteps: 1e9` 还会去分配十亿个点 | 非有限值退回默认 12；并夹到 `MAX_ARC_STEPS = 720` |
| 内核 | 公开的 `sampleFunctionSegments` **不校验** `steps`（同文件的 `adaptiveSampleFunctionSegments` 与 `numericalDerivative` 都校验）：`steps = 0` 算出 `x = NaN`、采样全被丢掉 → 空结果；负数 / NaN 同样静默为空；`steps = 1e9` 会真的跑十亿次求值 | 归一化到 `1..4096`（非有限值用默认 128）；定义域不是有限区间时返回空，不产生 NaN 坐标 |

- **第八批 RED 证据**：`steps=0: expected 0 to be greater than 1`（空采样）、`arcSteps=NaN: expected 0 to be greater than 2`（空弧）。

**第九批（隐式投影的迭代上限 + 死代码）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | `projectToImplicitCurve` 直接采信调用方的 `maxIterations`：传 `0`（或负数 / NaN）时内层循环一次都不跑，`converged` 恒为 false，而"残差够小就接受"的分支既不会接受种子点、也没有任何迭代结果 → 返回 `null`，动点拖拽直接卡住 | 0 / 负数 / 非有限值统一视为"没有有效偏好"用默认 40；正的有限值照旧尊重（哪怕是 1） |
| 死代码 | 同函数里的 `totalIterations` 只写不读（lint 里那条 `no-unused-vars` 警告就是它） | 删掉；lint warning **15 → 14** |

- **第九批 RED 证据**：`maxIterations=0: expected null not to be null`。
- **看过后判定"不是缺陷"的一条**（记录）：审计提到 `Ribbon.tsx:55-61` 的 Ctrl+F1 分支。实际语义是自洽的——折叠时**必须**清掉 `activeTab`，否则 `visible = expanded \|\| activeTab !== null` 会让面板留在展开态；再展开时 `activeTab` 为 null 只是回到"显示全部组"的默认视图，并非空面板。未改动。

**第十批（隐式约束残差的量纲 + 参数容差的单位）**：

| 类别 | 缺陷 | 修法 |
| --- | --- | --- |
| 内核 | 隐式约束的 `residual` 在梯度为零时退回 `\|F\|`，而那是 **F 的量纲不是距离**：椭圆中心实测 **16**，真实距离是短半轴 **1**（审计给的是同一缺陷的另一组系数下的 144 vs 3） | 梯度可以忽略时改用**精确投影**的距离（投影只读 `value`/`gradient`/`hessian`，不会递归回 `residual`） |
| 内核 | `inUnitInterval` 收的是**长度**容差当**参数**（无量纲）容差用：调用方若按坐标尺度传容差，长线段上端点外的点也会被算成"落在段内" | 改成固定的 `PARAMETER_TOLERANCE = 1e-12`（与原先各调用点传的值一致，行为不变；语义不再依赖调用方传什么） |

- **第十批 RED 证据**：隐式残差 `expected 16 to be close to 1, received difference is 15`。

### 体检收口：覆盖范围与最终结论（2026-09-17）

- **审计覆盖（含审计方自己声明未覆盖的两块，本轮补齐）**：
  - 4 路只读审计：`geometry-kernel`、`dsl`（schema/codec）、`scene-graph`（依赖图 / 重算 / 级联）、`apps/web`（状态 / 渲染 / 拾取 / 性能 / 可访问性）+ 持久化与基础设施（draft / 导出 / e2e / vite / eslint）；其中 kernel 与 web 两路各追加了一份深度补充报告。
  - 审计方声明**未覆盖**的两块由本轮补齐：`IntersectionPreview3dCache` 的剪枝（新缓存只含本次扫描真正遇到的 pair、`truncated` 结果刻意不入缓存、阈值上限 120 生效——**无缺陷**）；`threeScene` 的 rAF / 拖动内部（`pointercancel` 已绑到 `handlePointerUp`、卸载时 `cancelFitAnimation` + 清 `runtimeRef` / `contentKeyRef` + 记住相机、拖动会话与指针状态同生共死——**无缺陷**）。
- **观察到但未改的一条**（记录，不猜着改）：`pointercancel` 目前**提交**这次拖动（而不是中止回滚）。触摸设备上"系统手势抢走指针"会把已经拖出的位移写进文档与撤销历史。要改需要先确认目标平台的手势策略与期望语义，故本轮只记录。
- **最终结论**：审计确认的缺陷（含 5 处阻塞级）**全部修复并逐条 RED→GREEN**，共十批；性质测试 `recomputeConsistency.test.ts` 钉住"增量重算 ≡ 全量重算"不变式（并因此抓到模板拓扑依赖缺边这个真缺陷）；6 条误报 / 非缺陷（`threeScene` 预览签名、`circle3` 重算分支、`DrawingSheetView` observer churn、`Ribbon` Ctrl+F1、自动保存开销与撤销粒度）逐条给出证据并记录，未按错误结论改代码；剩余潜在项（依赖图对 3/4 目标约束不建边、`boolean3d.compact` 的每面签名拼串）在 `docs/feature-catalog.md` 的"明确限制"里如实标注。

### 文档集状态回填（2026-09-17，用户要求"更新所有实施计划文档、进度文档、readme"）

- **做法的原则**：文档只记录**能证实的**状态。计划文档保留原文（任务与验收标准不动），在标题下方加一行复核状态，并统一指向本文件的「验证证据」作为唯一门禁来源；历史数字一律标注"当时值"。
- **逐份回填**（本次实际改动）：
  - `docs/multimodal-math-engine-implementation-plan.md`：升到 v1.1，新增顶部「当前状态」、阶段表加"落地状态"列、P0–P7 逐节加状态行（P4 / P5 标注为用户明确排除、P8 标注部分完成）、第 8 节补测试现状、第 11 节补"实际交付顺序与计划不同"。
  - `docs/superpowers/plans/` 共 **14 份**全部带上 `> **状态（2026-09-17 复核）**`（其中 5 份是更早会话已加、本轮复核后保留；9 份本轮新增，含逐切片已勾选的 `p3-p6-platform` 与逐切片 `Status` 的 `point-driven-3d-geometry`）。
  - `docs/superpowers/specs/` 共 **10 份**：2 份已有"实现状态"小节；其余 8 份本轮更新——`dynamic-graphing-platform-design`（待用户审阅 → 已实现）、`numeric-robustness-design`（Approved for planning → Implemented）、`point-driven-3d-geometry-design`（待分阶段实施 → 已全部实现）、`3d-measurement-quality-design` / `p7-engineering-drawing-design`（补状态行）、`engineering-workbench-design` / `ribbon-ui-redesign`（状态行补 2026-09-17 复核）、`dynamic-point-engine-design`（状态改为"已全部交付"并列出体检修掉的五处缺陷）。
  - `docs/acceptance/2026-09-12-week-one.md`：加"历史记录"说明，指出其"当前边界"一节已被后续工作全部越过。
  - `README.md`：修正两处过时描述（**网格固定 1 单位**、**播放 / 暂停 UI 已删除**）、把"约束列表显示…"改为"诊断在内核里、列表入口已移除"、验证基线补上平面网格 e2e、重写「项目文档」索引（指向 14 份计划 + 10 份规格并标注复核状态）、重写「下一步」。
  - `docs/feature-catalog.md`：本轮新增「平面画布的网格是固定尺寸」与「体检覆盖说明」两条，网格 / 限制表述与代码一致。
- **明确不改的**：`docs/annotation-feature.md`（内容仍准确）与两份 `docs/research/*`（外部工具调研，不含本仓库状态声明）。
- **验证**：本次只改 Markdown，未触及任何源码；代码侧的最近一次全量门禁（提交 `cb129fc`）为 typecheck 4 workspace、单测 107 文件 / 1194 用例、lint 0 error / 14 warning、生产构建、Playwright 84/84 全绿。


- **明确不修、只记录**（都写进 `docs/feature-catalog.md` 的"体检结论与已知限制"）：
  - 非凸实体不再提供"实体内"宿主（宁可报数据不足，也不伪造体外坐标）。
  - 退化直线上的约束被跳过并列入 `unsatisfiable`，但**不让求解失败**：`recomputeDerivedObjects` 在 `!converged` 时抛错，改了就会让"把一条被约束的线拖成一个点"整份文档报错，得不偿失。
  - ~~隐式约束的残差在梯度退化时退回 `|F|`~~ → **第十批已修**（改用精确投影的距离）；隐式投影的**接受阈值**仍按查询点缩放（`|F| ≤ 1e-6·max(1,|desired|²)`），仓库里没有生产代码构造隐式约束，属潜在问题。
  - 草稿的多标签页/打开文件覆盖仍无版本比对（需要 `storage` 监听 + 修订号语义，留作后续）。
  - **依赖图对 3/4 目标的约束（共线 / 共面）不建边**：`getDependencyIndex` 只处理 `targets.length === 2`；但三维约束目前只做诊断、不移动点，所以没有任何对象因此变旧（潜在问题，改动会顺带收紧"对齐锁定对象"的拒绝条件）。
  - **`circle3` 没有重算分支**——已**证伪**：`Circle3Primitive` 只存 `centerId`（引用）+ `normal` + `radius`，不存圆心坐标的派生态，没有东西会过期。
  - 交点预览把"两者确实不相交"也归为 `insufficient`（状态栏文案本身是对的，例如"两组面之间没有交线"）；改标签要连带改状态栏分支，收益只是措辞，故保留现状。
  - `DrawingViewport` 的移动阈值会丢弃编辑、每帧自动保存草稿等性能 / 交互项，已记录待办（`boolean3d` 的 O(V²) 键重建已在第四批修掉：48 段 137ms → 27ms）。
  - `pointercancel` 目前**提交**而非中止拖动（见「体检收口」）。

### 文档集状态回填（第 2 次，2026-09-17，A1 + A2 交付后）

用户要求"更新所有进度文档，以及所有完成的功能和 readme"。做法沿用第 1 次的原则（计划文档保留原文、只在标题下加复核状态；数字一律是实跑值），本轮实际改动：

- `docs/project-progress.md`：**顶部状态块重写**（"最后更新 / 当前阶段"补上 A1、A2 五轮与当天三个实测修复），并新增一节「**解析二次曲面与真圆（A1）+ 交面分组与真曲面（A2）（2026-09-17 全部完成）**」——把这四条用户口径、A1 八片、A2 五轮、三个缺陷修复、两处如实偏差（`Line2` 描边 / 解析展开延后）与最后一次门禁数字集中成读者第一次打开就能看懂的交付说明；「阶段状态」补齐 P3 / P4-P5 / P6（含 A1+A2）/ P7。
- `docs/feature-catalog.md`：逐条核对**已过时的"明确限制"**并更正——剖切面**可以**平移与旋转（也能「以面为剖切面」，只是没有数值输入框）；圆柱 / 圆锥的截面与交面边界**已是解析的**（仍如实说明网格布尔与曲面面积近似在哪里）；`circle3` **已经**有渲染分支；`intersectionFace` 不只是"一个平面面片"而是支撑曲面区域（解析边界 + 光滑填充）；预览配额按**区域**计数（分段数不再吃配额，另加曲面细分 20000 片/区域的上限）；「下一阶段功能」里圆锥曲线关键属性标为已交付（并写明仍缺准线 / 渐近线的画布标记）。
- `README.md`：「当前状态」补上 A1 / A2 两条交付线与三个修复；「三维几何工作区」新增两条能力条目（解析二次曲面真圆 / 交面即支撑曲面区域且画成光滑曲面、拖动跟手与 `data-drag-offset-drift` 读数）；「项目文档」索引修正为 **15 份计划 + 12 份规格**（此前写 14 / 10，漏了 A1 计划与 A2 规格）并把两份新 spec 列进重点；「下一步」重写为"已收口 + 候选方向 + 明确挂账的两项 + 体检只记录未改的三项"。
- `docs/multimodal-math-engine-implementation-plan.md`：升到 v1.2，顶部「当前状态」与第 8 节门禁数字从 **107 文件 / 1194 用例、Playwright 84/84** 更新为 **118 文件 / 1369 用例、Playwright 94/94**，阶段表 P6 行注明叠加 A1 / A2。
- `docs/superpowers/plans/2026-09-17-analytic-quadrics-a1.md`：补 `> **状态（2026-09-17 复核）**`——8 片全部落地、两处与计划写法的差异（`Line2` → `THREE.Line`、解析展开延后）如实列出，复选框保留为计划原文不逐条回勾（与第 1 次同一口径）。
- `docs/superpowers/specs/2026-09-17-analytic-quadrics-design.md` 与 `…-intersection-face-grouping-design.md`：状态行改为"**已交付**"，并把用户后续两轮口径（"拿不到那个曲面"、"由很多三角形拼出来"）补进 A2 spec 的头部。
- **明确不改**：`docs/annotation-feature.md`（内容仍准确）、`docs/research/*`（外部调研，不含本仓库状态）、`docs/acceptance/2026-09-12-week-one.md`（已标注为历史快照）。
- **验证**：本轮只改 Markdown，未触及任何源码；最后一次全量门禁（提交 `ac9e343`）为 typecheck 4 workspace、单测 **118 文件 / 1369 用例**、lint 0 error / 14 warning、生产构建、Playwright **94/94**（连续三次）。
- **回填过程事故记录（第 2 次栽在同一个坑）**：这一轮我又用 PowerShell 的 `Get-Content -Raw` + `Set-Content` 改仓库文件，`Get-Content` 在中文文件上按 ANSI 解码，把 `schema.test.ts` 与 `App.tsx` 的中文注释写成了乱码并加了 BOM；两次都用 `git checkout` 还原并改用编辑工具重做（`App.tsx` 那次还顺带拿到了"清除选中"用例的真实 RED 证据）。**结论不变：仓库文件一律用编辑工具或显式 .NET `UTF8Encoding` 读写，绝不走 PowerShell 文本管道。**

- **动点与连线：命中顺序修复（2026-09-17）**：用户报告"把动点放在轨道上、动点又和另一个定点连了线，移动轨道会把设定好的定点一起带走"。取证（Playwright 读 `elementFromPoint`）查出真正的问题是**指针归属**：连线与轨迹都画在点之后，连线的可见线正好穿过两端点、轨迹必然穿过动点自己，于是"点正中心"那一下落在派生曲线上——派生对象拖不动，还会退化成框选，**动点及其相连的定点都抓不住**；而"拖轨道带走定点"本身没复现（实测定点坐标逐位不变）。修法：连线命中带两端缩进 16px（`insetSegment` + 单测），并把**点的命中区在所有派生曲线之上再画一遍**。本轮起始 **103 文件 / 1136 用例** → **104 文件 / 1139 用例**；Playwright **82/82 → 83/83**（新增 `e2e/planar-connected-point-drag.spec.ts`）；lint 0 error / 15 warning（持平）；`typecheck` 4 个 workspace 与生产构建全绿。

- **五条浏览器反馈修复（2026-09-17）**：①圆柱 / 圆锥默认分段数 24 → **48**（并同步抬高预览的面 / 点配额，见下）②动点新增**实体内**约束（`inSolid` + 包围盒比例 `uvw`，内核 `solidVolumeHost3` / `clampPointIntoSolid3` 把越界的点夹回实体表面）③修掉**依赖图缺边**这个真缺陷：模板物化出来的点 / 棱 / 面原来不依赖所属实体，导致移动实体时绑在它面上的点留在原地（新增 `templateChildOwners` + `primitiveDependencies` 补边）④⑤按用户要求**删掉「动效演示」栏**（连同只服务它的状态、定时器、store 引用与 CSS）：动点仍由画布拖动与「路径参数」两条通路驱动。本轮起始 **101 文件 / 1119 用例** → **103 文件 / 1136 用例**；lint 0 error / **15 条 warning**（持平）；Playwright **82/82**（持平）；`typecheck` 4 个 workspace 与生产构建全绿。

- **交点 / 交线 / 交面三个独立图元（2026-09-17，提交 `f2d2476`（内核）与本次两批提交（预览·图元·检查器、语义纠正））**：①内核 `intersectConvexPolyhedra3`（凸实体半空间裁剪，并给出每个面自己的法向与面积）②画布**自动枚举**所有两两相交的三类预览：交线（虚线）、**交集的每一个面各一份**交面片、**交线的每个拐点各一份**交点标记（AABB 预筛 + 几何签名缓存 + 布尔/面数/点数三重配额）③点击创建三个各自独立的图元 `intersectionFace`（**一个表面**、面积读数、**填充色可改**）/ `intersectionPoint3`（跟随来源重算的拐点）/ `intersectionLine`（段数与总长度），三者都进对象列表、进依赖图、随来源重算、删来源时级联注销 ④`intersectionLine` 检查器属性块。本轮起始 **96 文件 / 1070 用例** → **101 文件 / 1119 用例**（含语义纠正与复查修正新增的 49 例）；lint warning 16 → **15**；Playwright **79/79 → 82/82**。过程中由 e2e 探针定位并修掉三个真实交互缺陷：点交面正中因命中一条擦过的棱而失效、交线画在来源棱上导致点不动、交点标记与顶点手柄共心导致建不出交点（取舍规则最终抽成纯函数 `previewBeatsPick` 并有单测）。

- **3D 视口与几何内核重构收尾三项（2026-09-17，提交 `0d901d1` / `a409894`）**：①场景内容改为按签名增量同步——展开动画每帧从重建整场变成只重建那张展开网（created 1 / reused 11），切换选中从重建 29 个变成 created 1；顺带修掉三个由探针定位的缺陷（后加的 key 被当过期删掉、上一份文档的残留参与包围盒导致取景偏 0.02、面片自动尺寸把旧面片算进半径导致 7.02 → 36.21）。②相机状态跨工作区保留（`cameraMemory.ts`：卸载写回、挂载恢复并跳过首次取景）。③`threeScene.tsx` 1927 → 1129 行，抽出 `threePrimitives`（550）/`threePicking`（114）/`threeDrag`（81），组件文件只导出组件，`react-refresh` 告警清零。本轮起始 **89 文件 / 1021 用例** → **92 文件 / 1042 用例**；lint 0 error，warning **42 → 16**；Playwright **73/73 → 76/76**；`typecheck` 4 个 workspace 与生产构建全绿。
- **3D 视口与几何内核重构收尾（2026-09-17，收尾提交 `be731b9`）**：设计文档切分的 10 片全部落地（1A-1 渲染管道去重建化、1A-2 `hosts3.ts` 与绑定 DSL、1A-3 拖动状态机与绑定 UI、1B 截面、2 Auto-Fit、3-1 删除级联、3-2 求值层清理与画布尺寸稳定性、3-3 多解就近吸附），队列之外另补齐三项（F15 采样求交去重尺度、四个模板默认截面的验收覆盖、相机与取景数学抽成 `threeCamera.ts`），同批用户反馈还修掉了背景坐标系自适应与"画布填满所在行"。本轮起始 **73 文件 / 933 用例** → **89 文件 / 1021 用例**；lint 0 error，warning **52 → 42**（抽走相机数学后 `react-refresh/only-export-components` 从 37 条降到 26 条）；Playwright **58/58 → 73/73**；`typecheck` 4 个 workspace 与生产构建全绿。逐片证据见上文各小节（每节都有 RED→GREEN 记录）。

- **工程制图可用性修复（Task 15-18，2026-09-16）**：切片 A/A2/B/C1-C4 全部落地并逐片跑门禁；本轮起始 64 文件 / 670 用例 → **68 文件 / 698 用例**，E2E 43/43 → **47/47**，类型检查 4 个 workspace 通过，lint 0 error / 39 条既有 warning，生产构建通过。
- **审查复核与修复（2026-09-16）**：在 `b6d31f5` 上重新逐项核验——typecheck 0 error、lint 0 error、生产构建通过、Playwright 43/43、`git status` clean 且与 `origin/main` 一致。按符号核对了文档声明的 15 个绘图 API（`draftWindow` / `clientToDraft` / `rankDraftSnaps` / `boxSelectionMode` / `SnapKind` / `primitiveHandlePoints` / `resolveGeometryEdit` / `offsetPrimitive` / `trimPrimitive` / `extendPrimitive` / `selectPrimitivesInBox` / `tangentPointsOnPrimitive` / `parseDraftCoordinate` / `applyDistance` / `applyAngle`）**全部存在**，非测试源码无 TODO/FIXME。据审查结果修掉四处问题：① 功能目录里"约束界面可创建"的过时表述 → 改为明确说明三维约束当前**无任何 UI 入口**（数据/校验/编解码保留，恢复方式已写入文档）；② 删除 Task 9 遗留的死代码 `ConstraintPanel.tsx` 及其测试、以及随之孤立的两处 CSS 块（`.constraint-*`、`.empty-state`、`.agent-*`、`.agent-chip`、`.status-dot.pending`），删除前用全仓库 `className` 检索确证零引用；③ 本小节改为「当前基线 + 按时间倒序的历史快照」，消除"最新证据其实是旧数字"的误导；④ bundle 数字与门禁计数改为实测值。
  修复后的实测变化：测试文件 65 → **64**、用例 672 → **670**（删除的 `ConstraintPanel.test.tsx` 含 2 个用例）；lint warning 40 → **39**（`.agent-chip` 不再命中 `react-refresh/only-export-components`）；CSS 59.53 kB → **56.49 kB**；E2E 保持 **43/43**。
- **P6 v3 全量单测**：35 个测试文件、**353** 个用例通过（本轮起始 337，新增 16 个全部是回归用例）
- **P6 v3 类型检查**：4 个 workspace 通过
- **P6 v3 浏览器验证**：Playwright **17** 个用例通过（本轮起始 12，新增 5 个：实体点选反复改色、顶点拾取不穿透、删除实体连带拓扑并可撤销、被引用时仍拒绝删除、平面可建可见、打开图形自动取景）
- **P6 v3-1 修复 1 号**：实测画布 `1902px → 760px`，相机宽高比 `0.39 → 1.77`；点击探测 25 点全部只能命中"棱"、命中不到实体 → 修复后 24/77 点命中「立方体 1」，空白处回落 ∅；连续改 3 次填充色，6 个面全部同步
- **P6 v3-2 修复 2 号与选取判定**：用 `System.Drawing` 对截图做连通域测量，顶点手柄 `9px → 6px`，且默认/放大/缩小三个缩放级别都是 6px（旧实现在距离 3 时约 14px）；点最近的顶点手柄得到点 G（点驱动编辑保留），偏 24px 回落到实体，点"背面被遮挡顶点"的投影位置得到实体而非穿透选中
- **P6 v3-3 修复 3 号**：删除「立方体 1」由 28 个图元 → 0 且代数区清空、无报错（旧行为：`object is referenced by another object`，一个都删不掉）；删除「立方体 1 拓扑」同样清空（旧行为：留下 8 点 + 12 棱 + 6 面）；撤销后 28 个图元完整恢复
- **P6 v3-4 修复 4 号**：默认前三点 `A(0,0,0) B(3,0,0) C(0,3,0)`，叉积 `(0,0,9) ≠ 0` 不再共线；建平面后 `data-plane-count=1`（旧为 0，因为根本没有渲染分支），无报错；打开 1 单位四面体 `.mgeo` 相机 `distance 16.00 → 3.32`、`target (0,0,0) → (0.50,0.50,0.50)`，编辑时相机不再跳动
- **P6 v3 新增测试资产**：`e2e/fixtures/tetrahedron.mgeo`（四面体 A(0,0,0) B(0,0,1) C(1,0,0) D(1,1,1)，4 点 + 6 棱 + 4 面），用于取景与二面角回归
- **本轮质量与功能验证**：37 个测试文件、360 个单元/UI 用例通过；4 个 workspace 类型检查通过；ESLint 可执行并无错误（保留 36 条已有风格/依赖警告）；Web 生产构建通过并使用隔离输出目录；新增二面角入口、测量标签、撤销历史上限、展开动画收敛和预览服务退出回归。
- **本轮浏览器验证**：17/17 个 Playwright 用例通过，包括展开/折叠和二面角流程；预览服务改为 global setup/teardown 同进程管理，Windows 下命令正常退出。
- **工程工作台 Task 3-7 最新验证**：`npm.cmd test` 通过，51 个测试文件、464 个测试通过；`npm.cmd run typecheck` 通过，4 个 workspace 无类型错误；`npm.cmd run lint` 通过，0 error、36 条既有 warning（新增组件原本多出 6 条 `react-refresh/only-export-components` warning，已通过抽出 `drawingGeometry.ts` 并把仅内部使用的布局辅助函数改为非导出消除，回到既有基线）；`npm.cmd run build` 通过；`npm.cmd run test:e2e` 通过，24/24 个 Playwright 用例通过。
- **Z 轴朝上验证**：`npm.cmd test` 51 个测试文件、484 个用例通过（新增 1 个相机姿态用例先 RED 后 GREEN，另改 1 个平移基向量用例的期望）；lint 0 error、38 条 warning；生产构建通过；Playwright 30/30 通过；截图确认 +Z 朝上、网格为 XY 地面。
- **微积分工作区退役（切片 1）验证**：`npm.cmd test` 51 个测试文件、484 个用例通过；Playwright 30/30 通过；启动默认工作区为 `geometry3d`，工作区标签中不再出现「微积分」，加载含 `workspace: "calculus"` 的旧 `.mgeo` 仍能正常打开。
- **P7 撤销/重做修复验证**：`npm.cmd test` 51 个测试文件、484 个用例通过（新增 3 个 App 用例先 RED 后 GREEN）；lint 0 error、37 条 warning；生产构建通过；Playwright 30/30 通过（新增 1 个撤销/重做用例）；实测 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 生效且按钮禁用态随历史切换。
- **P6 v3-10 子元素选取与平面尺寸验证**：`npm.cmd test` 51 个测试文件、484 个用例通过；lint 0 error、37 条 warning；生产构建通过；Playwright 29/29 通过（普通点击选实体、Alt 点击选面、平面半边长写入与恢复自动均在真实浏览器验证）。
- **P6 v3-9 朝向能力验证**：`npm.cmd test` 51 个测试文件、478 个用例通过（新增 4 个内核、3 个 codec、2 个 Scene Graph 用例，内核 4 个先 RED 后 GREEN）；lint 0 error、37 条 warning；生产构建通过；Playwright 27/27 通过；浏览器实测包尺寸随朝向改变且刷新后保留。
- **P6 v3-8 视角导航验证**：`npm.cmd test` 51 个测试文件、469 个用例通过（新增 3 个相机用例先 RED 后 GREEN）；lint 0 error、37 条 warning；生产构建通过；Playwright 26/26 通过（新增 2 个视角导航用例）；浏览器实测枢轴沿相机轴向移动、纵深可平移且被夹在图形周围的有限范围内。
- **P6 v3-7 选中态修复验证**：`npm.cmd test` 51 个测试文件、466 个用例通过（新增 2 个 `threeScene.test.ts` 用例先 RED 后 GREEN）；4 个 workspace 类型检查通过；lint 0 error、36 条既有 warning；生产构建通过；Playwright 24/24 通过；浏览器截图对照确认 `plane3` 与 `face3` 选中态下显示用户所选填充色。
- **已知验证提示**：Vite 仍提示主 bundle 超过 500 KB；Vitest 的 3D UI 测试在 jsdom 中输出 Three.js WebGL context 未实现提示，但测试结果为通过；本轮新增组件已由 `CommandBar`、`EngineeringWorkbench`、`LayerTree`、`DrawingTree`、`DrawingViewport`、`DrawingSheetView`、`EngineeringInspector` 七个测试文件覆盖。

### 历史证据

- `npm test`：15 个测试文件、108 个测试通过
- P6-3 聚焦测试：`apps/web/src/threeScene.test.ts` 通过
- P6-3 全量测试：25 个测试文件、203 个测试通过
- `npm.cmd run typecheck`：4 个 workspace 通过
- P6-3 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-3 浏览器验证：Playwright 被宿主环境的 Vite `.vite-temp` `EPERM` 阻断，未标记为通过
- P6-4 聚焦测试：`apps/web/src/threeScene.test.ts` 的 4 个用例通过
- P6-4 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-4 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-5 聚焦测试：`apps/web/src/threeScene.test.ts` 的 6 个用例通过
- P6-5 Web 构建：待完整验证后记录
- P6-5 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-6 聚焦测试：`apps/web/src/threeScene.test.ts` 的 7 个用例通过
- P6-6 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-6 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-7 聚焦内核/DSL/Scene Graph 测试：48 个用例通过
- P6-7 Web 构建：待完整验证后记录
- P6-7 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-8 聚焦测试：`apps/web/src/threeScene.test.ts` 的 8 个用例通过
- P6-8 Web 构建：待完整验证后记录
- P6-8 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-9 聚焦内核测试：`packages/geometry-kernel/src/geometry3d.test.ts` 通过
- P6-9 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-9 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-10 聚焦测试：3D 属性栏 UI 与 Scene Graph 3D patch 更新测试通过
- P6-10 浏览器验证：Playwright 3D 用例通过，覆盖立方体、棱锥、圆柱和圆锥创建及属性编辑
- P6-10 类型检查：四个 workspace 通过；生产构建通过
- P6-10 review：无 Critical/Important 问题；修复 Three.js 挂载点删除 React 控件和重置按钮覆盖控制组问题
- P6-11 最终验证：全量单测 25 个测试文件、215 个用例通过；全量 Playwright 6 个用例通过；生产构建通过；`git diff --check` 通过
- P6 v2-1 验证：DSL codec 23 个用例通过；CSV exporter 6 个用例通过；全量单测 25 个测试文件、219 个用例通过；四个 workspace 类型检查通过；隔离目录 Vite 生产构建通过；`git diff --check` 通过
- P6 v2-2 验证：geometry3d 与 solid-builders 聚焦 19 个用例通过；全量单测 26 个测试文件、235 个用例通过；四个 workspace 类型检查通过；隔离目录 Vite 生产构建通过；`git diff --check` 通过
- P6 v2-3 验证：Scene Graph 聚焦 31 个用例通过；全量单测 26 个测试文件、240 个用例通过；四个 workspace 类型检查通过；`git diff --check` 通过
- P6 v2-4 验证：UI 聚焦测试 53 个用例通过；全量单测 26 个测试文件、245 个用例通过；四个 workspace 类型检查通过；隔离目录 Vite 生产构建通过；`git diff --check` 通过；浏览器验证因宿主环境浏览器绑定 `Cannot redefine property: process` 阻断，未标记为通过
- P6 v2-5 验证：DSL、builder、迁移和 Scene Graph 聚焦测试 73 个用例通过；四个 workspace 类型检查通过；Web 生产构建通过；3D 模板 Playwright 用例 1 个通过；`git diff --check` 通过
- P6 v2-6 聚焦测试：`measurements3d.test.ts` 4 个、`constraints3d.test.ts` 2 个、`patches.test.ts` 23 个、`scene-store.test.ts` 34 个、`AlgebraView.test.tsx` 5 个、`store.test.ts` 1 个用例通过
- P6 v2-6 全量单测：32 个测试文件、286 个用例通过（本轮新增 `store.test.ts`、`AlgebraView.test.tsx`、`spatialTools.test.ts` 三个测试文件，并为测量重算、测量删除、补丁校验、拾取优先级/子部件、空间工具门控和 `.mgeo` 测量往返补充用例；同时修复了 Slice 5 拓扑迁移遗留的 2 个 App UI 失败用例）
- P6 v2-6 类型检查：四个 workspace 通过
- P6 v2-6 Web 生产构建：`vite build` 通过
- P6 v2-6 浏览器验证：Playwright 8 个用例通过，其中新增“空间点拾取并创建教学测量”“顶点/棱/面子树展开”2 个 3D 用例；本机需先执行 `npx playwright install chromium` 安装浏览器
- P6 v2-6 修复：测试未重置整个 store 造成跨测试文档污染（改为在 `beforeEach` 完整重置，保留 `replace` 按工作区合并的语义，避免打开文件后把其他工作区的内存文档和草稿一起覆盖）、`addMeasurement` 缺少形状与字段校验会抛异常并接受非法 metric、测量来源缺失时用世界原点伪造点面距离、单个面/圆错误提供“长度”入口、点在线/点在面的来源顺序依赖点击顺序、App 工具栏误删圆柱/圆锥入口
- P6 v2-6 review：只读 code review 发现并修复了上述数据丢失路径与伪造坐标问题；等长/等角未纳入 DSL，约束投影求解、二面角内角/外角、固定距离输入入口等未完成项已写入功能目录的“明确限制”
- P6 v2-7 聚焦测试：`sections3d.test.ts` 9 个、`scene-store.test.ts` 39 个、`patches.test.ts` 24 个、`threeScene.test.ts` 15 个、`codec.test.ts` 26 个用例通过
- P6 v2-7 全量单测：33 个测试文件、305 个用例通过
- P6 v2-7 review 修复：只读 review 发现非凸截面按质心角度排序会插入跨凹口的对角边，改为沿面邻接串联边界并补充 L 形非凸用例；`sectionPlaneThroughSource` 在无法解析来源顶点时返回 null 而不是伪造 y=1.5 剖切面；`intersectPlaneSegment` 增加显式容差参数并透传
- P6 v2-7 类型检查：四个 workspace 通过；Web 生产构建通过
- P6 v2-7 浏览器验证：Playwright 9 个用例通过，新增“剖切点驱动拓扑并得到可见截面”用例
- P6 v2-7 修复：剖切来源支持任意 `polyhedron3`（含模板生成拓扑），默认剖切平面改为穿过来源包围盒中心，截面点按剖切平面内角度排序并给出 none/point/segment/polygon/insufficient-data 分类，来源实体纳入删除保护
- P6 v2-6 边界：`docs/feature-catalog.md` 与实施计划同步更新；Slice 6 只覆盖拾取/约束/测量，截面仍在 Slice 7
- P6-8 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-7 Web 构建：`vite build` 使用隔离 `outDir` 通过
- 默认 `npm.cmd run build`：当前沙箱因 Vite 写入 `.vite-temp`/`dist` 返回 `EPERM`；使用 `vite build apps/web --configLoader runner --outDir D:\\draw\\build-check\\mathcanvas-current` 完成等价 Web 构建验证
- `npm.cmd exec playwright test`：5 个 Chromium 浏览器用例通过
- `npm.cmd run lint`：未执行成功，仓库当前未安装 `eslint` 命令
- GitHub：P2 修复与 P3-1 之前的提交均已推送到 `origin/main`


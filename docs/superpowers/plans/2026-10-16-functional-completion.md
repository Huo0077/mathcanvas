# 21 项升级：功能补完执行记录（2026-10-16）

## 验收原则

用户要求按原计划补齐剩余功能；每个区块以可复跑的功能测试验收，更新本记录、主进度文档与当前状态，再提交、推送 GitHub。原始功能审查见 `audit-20261016/functional-review.md`。

起点：`3632817016d5cab5e4939199467e0b557962b844`，分支 main，与 origin/main 同步。保留用户原有 `apps/desktop/src-tauri/Cargo.toml` 修改，不纳入本轮提交。

## 分块计划

| 区块 | 范围 | 状态 | 验收条件 |
|---|---|---|---|
| A | Task 18：异步证明生命周期 | 已实现并通过本地功能回归 | 失效/被替换/并发暂存的迟到结果不返回 verified，不覆盖新草稿；身份绑定原请求 |
| B | Task 20：评测门禁 | 已实现并通过本地功能回归 | 实际工作量及逐次预算检查；非法金额拒绝；人评覆盖不齐不放行 |
| C | Task 9、16：独立核验与画布证据 | 进行中：oracle 与实时画布消费已修复；候选视觉/桌面待验 | oracle 必需条件完整覆盖；隐藏点不误报；过期渲染证据消费时拒绝 |
| D | Task 12、13、15：缺失产品链路 | Task 12 已完成支持范围；Task 13 已完成面上点/展开支持范围；Task 15 已完成公切线支持范围 | Task 12 有界折叠关系搜索；Task 13 面上点/展开入口；Task 15 公切线从产品动作到最终核验 |
| E | Task 19：本地证明执行 | 部分完成：实时输出上限已补；真实 Lean/发行待验 | 严格受支持模板、实时有界输出及工具链校验；真实 Lean/Rust 验证 |
| F | Task 20、21：最终验收 | 待做 | 真实模型评测、全量回归、桌面/安装/离线/人评按实测分别记账 |

## 边界

- 12 完成、7 部分、2 未完成是原审查起点，不是本轮完成数量。
- 不以假通道单测替代真实 Lean、真实 provider 或桌面安装验收。
- 付费调用仅在合法授权与可执行预算闸齐备时运行，不输出凭据，不伪造费用。
- 人评、干净机器、设备条件若不可得，保留未验收状态；普通作图与自动 Lean 分开判断。

## 区块记录

### A｜Task 18（2026-10-16）

- 修复：stage 在编译/证明等待期间使用私有候选；发布时核对草稿对象与当前暂存租约，失效后返回 unknown_draft，被新请求取代后返回 stale_draft_version，不再半发布或覆盖新草稿。
- 身份：保留 core 已核验的原命题 inputHash、实际后端版本；claim 在请求前绑定原题哈希。原文哈希与规范化题面哈希分别保存，即使两段原文规范化后相同，旧证明仍过期。
- RED → GREEN：原有四个生命周期反例先复现；独立 review 追加规范化碰撞，移除原文比较时得到 expected stale / received verified，恢复后通过。
- 本地验证：4 文件 / 50 测试通过（draftStore 生命周期/既有草稿/automaticProofStage/hostBridge）；全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff --check 通过。
- 独立 review：发现的原文身份 P2 已修正。使用注入通道测试异步生命周期，**不代表真实 Lean、桌面 IPC、安装或整题证明验收**。
- 提交：本区块独立提交并推送 origin/main（提交号见 Git 历史）。

### B｜Task 20 评测门禁

进入执行：先补请求声明与实际工作量不一致、缺人评误放行、非法费用的失败合同测试，再在实际模型调用边界补预算控制。


### B｜Task 20（2026-10-16）

- 修复请求工作量门禁：执行入口先按冻结样本计算固定工作量（12 题 × 3 次 = 36），声明为 1 等不一致请求在任何 `runCase` 前拒绝。
- 修复授权参数校验：请求上限必须为正整数；授权最高费用必须为有限非负数；本次预估费用必须为有限非负数；`NaN`、负数不会再绕过门禁。
- 修复人评覆盖门禁：只有一族的全部试验都有 readability 标注时才计算 `unreadableShare`；部分覆盖返回 `null` 并判定不通过。
- 修复真实调用预算：评测入口向 `runCase` 传入共享预算。适配器可为重试/额外 provider 调用显式消费请求；超授权时立即拒绝。旧的二参数适配器在没有显式消费时按一次逻辑试验计一次，避免已有夹具失效。
- 失败 → 修复验证：新增 4 条合同测试，先观察到固定工作量、人评覆盖、预算边界失败，再实现；当前评测测试 **20/20**，冻结授权测试与评测合计 **28/28** 通过。
- 全仓验证：`typecheck` exit 0；`lint` exit 0、0 error / 13 existing warnings；`git diff --check` 通过。
- 边界：这只证明评测门禁会阻止错误声明和超预算；没有执行真实 provider、真实人评或桌面发行验收，不能据此宣称 Task 20 的真实模型评测已完成。
- 提交：本区块独立提交并推送 origin/main（提交号见 Git 历史）。

### C1｜Task 9 oracle 完整性（2026-10-16）
已复现并修复：缺一条或全部实测读数时误判通过。现在按 oracle 条件名一一配对，缺失/重复/多余读数均拒绝；空 oracle 不能成为金标；无限数、非法容差及非实测状态不能通过。缺失项用明确的 missing 记录，不伪造测量值。新增 9 条边界测试，定向 20/20 通过；全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。

边界：此区块只补离线判据，不新增未经独立人工复核的真题答案，verifiedGoldCaseIds 仍为空。Task 16 仍在检查实际消费接线，区块 C 尚未整体验收。


### C2｜Task 16 真实画布证据消费（2026-10-16）
- 根因：旧实现只保存属性字符串；内容更新到下一次测量之间，旧读数仍会挂在新画布上。过期判据只在测试使用。
- 修复：2D/3D 保存真实测量快照，发布属性前用当前工作区与文档哈希消费证据。旧快照返回 stale，不发布旧盒子/标签/哈希读数；同哈希只换快照版本不误报。尚无实时文档绑定的读数为 unbound，不算通过。
- 区分结论：passed / partial / failed / stale / pending；3D WebGL 对象不可测只能 partial，即使 diagnostics 为空也不能 accepted；点名缺失判 failed；不能由调用方把不可测快照升级为可测。
- 验证：新增 5 条先红后绿；4 文件 55 条单测通过；真实浏览器 6/6（28.9 s），验证 2D accepted=true、3D partial/accepted=false、撤销后 failed/empty_canvas。首次 e2e 暴露旧选择器不能读取 stale 过渡态，改为稳定状态属性，并等待新测量再验空画布。
- 全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。
- 边界：这是提交后真实画布的证据消费，不是确认前候选图渲染，也不等于 HostBridge 在提交前已验证视觉。候选图视觉门禁、桌面画布与人工可读性仍未验收；Task 16 不据此升级为全部完成。数学条件仍由独立核验器判断。


### D1｜Task 12（2026-10-16）

- 在既有固定距离解析求角之外，新增 `searchFoldAngles`：有限区间、有限评估预算、均匀采样与二分回代；只接受有限残差且回代误差在容差内。跨极点的符号变化不会直接当根。
- 结论分级：`solved` 只表示找到数值见证；`not-found` 永远不是 `unreachable`，并明确 `complete:false`；非法区间/预算/容差零评估拒绝；下端点不含、上端点可含。
- 产品接线：`compilePlan` 对单折叠的 planarAngle、dihedral、linePlaneAngle 关系进行有界搜索；每个候选重新走完整 `compileOnce`，最后必须由最终坐标核验整份题设通过才发布。折叠数超过一笔不猜耦合解。
- 修复解析支路漏解：固定距离的每个解析候选逐支回代，不再只尝试第一支；其余合法支继续写入假设披露。
- RED→GREEN：新增 12 个内核/编译链路测试，先观察到搜索接口不存在及真实编译失败，随后 **212/212** 定向测试通过；当前 `typecheck` exit 0；`lint` 0 error / 13 existing warnings；Task 13 原用户翻折浏览器用例与画布证据用例 **7/7** 通过。
- 边界：这是 Task 12 与翻折代表链路的功能证据，不把 Task 13 的面上点/展开入口、不把 Task 15 公切线产品闭环写成完成。
- 提交：本区块待独立提交并推送，提交号在区块完成时回填。

## 2026-10-16 功能闭环增量：Task 13 面上点与 `solid.unfold`

本区块按真实运行链路验收，不以类型定义或文档存在作为完成依据。

- **面上点**：`dynamic.create_face_point` 已接通 `parseDraftAction → compileAction → commitPatch → resolveBoundPoint3`。测试覆盖面内坐标、跨文档引用、参数驱动更新、退化面与越界坐标拒绝；点以真实 `point3` 和 `onFace` binding 持久化。
- **多面体展开**：新增 `solid.unfold`，输入目标实体引用与 `[0,1]` 展开进度；编译为 `updatePrimitive`，由 `commitPatch` 写入文档的 `polyhedron3.unfoldProgress`。非多面体、越界/非有限进度、跨文档目标均拒绝。
- **渲染消费**：渲染器优先读取每个 `polyhedron3` 自身持久化的进度，未设置时才回退到 UI 全局进度；实体可独立展开。渲染测试通过 `sceneShell.dataset.unfoldObjects` 观察持久化值和 fallback 值。
- **新鲜证据**：定向测试 **6 个文件 / 28 个测试全部通过**；4 个相关 TypeScript 项目检查全部 exit 0；`npm run lint` exit 0（0 error，13 条既有 warning）。这是自动化闭环证据，不是人工视觉签收。
- **边界**：展开仅支持已有 `polyhedron3`，不声称任意曲面展开或自动选择展开树；Task 15、16、18、19、20、21 不因此升级。
- **提交**：功能提交 `4e0354a` 已推送到 `origin/main`。保留未提交的审查探针和桌面 Cargo 改动；本报告作为四份进度文档之一随区块提交。

## D2｜Task 15 函数公切线（2026-10-16）

- `function.create_tangent` 新增 common anchor：引用另一条显式 `function`，用 `branch: 0/1` 选择两条公切线；真实进入动作解析、编译、patch 提交和 `recomputeCurveTangent`。来源函数更新会重算，删除来源会级联删除。
- 题面解析新增 `commonTangent` obligation，并排在普通函数图像 obligation 之前；独立验证器重新计算候选公切线，检查数量、branch、来源函数、两条曲线相切及直线参数。通过后为 `verified-numeric` / `figure-instance`，不宣称形式证明。
- 支持边界：两条显式 `function`、branch 0/1；圆/椭圆/任意曲线、形式证明、真实模型、人工验收和完整桌面发行仍未做。
- RED→GREEN 与门禁：7 个测试文件 / 138 个测试通过；4 个相关 TypeScript 项目 typecheck exit 0；lint 0 error / 13 既有 warning；diff check 通过。
- **状态**：Task 15 在支持范围内完成。

## E1｜Task 19 实时输出上限（2026-10-16）

- 证明 runner 的 stdout/stderr 改为并行异步流式消费，每路固定只保留最后 4000 字节；不再等 `wait_with_output()` 收集完整输出后再截断。

- 墙钟超时会 kill/reap 子进程，超时和等待错误均不返回半成品证明；成功退出才发布有界尾部。

- 证据：`cargo check --lib` exit 0；`cargo test --lib proof` 2 passed / 0 failed。

- 边界：严格 OS 隔离、真实 Lean 慢集成、桌面 UI/IPC proof 生命周期、发行/安装验收仍未完成。

### F1?Task 16 ?????????2026-10-16?

- ???????????????????????????????????????? mint consent?
- ????? `CandidateRenderEvidencePort`????? `runId`?`draftId`?`draftVersion`?`documentHash`??????? draft ?? renderer ? fail-closed?consent ??????commit ????????????????????? `stale_render`/???????no-op draft ??????
- ??????? 12/12?Task 16 ?????????? 71/71????????? 8/8?Web typecheck exit 0?lint exit 0?0 error / 13 existing warnings?`git diff --check` ???
- ???`structured_only` ?????????????????????????????? WebView/IPC/???????/??????????? Task 16 ?????????
- ????????????? `origin/main`????? Git ???

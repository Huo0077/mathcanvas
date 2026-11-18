# F9 当前修订复测：零费修复验证 + 一题真实 DS 澄清停批

执行本地日期：2026-11-17 America/Los_Angeles。代码修订 `bff4d0ebc67400a061838cb37f9a2901360bc30b`，工作区干净，冻结36题SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`。旧 `0267dd61` 上的8请求模型测试及旧零费探针不改写。

## 1. 零费用验证（防止旧脚本误导）

上一次预打包的 `repeat.cjs` 仍包含旧代码，直接运行会错误重现“0图元”。本次**从当前源码重新打包**探针：`square_pyramid`、`triangular_prism`、`tetrahedron` 的 `construct_solid` 分别得到 **19、21、15 图元**，`finish_candidate` 均接受。旧 `construct_solid accepted/0` 缺陷在当前源码上未重现。按旧探针提供的面顶点名称尝试 `construct_face` 会返回 `repairable`，不能算“合法面构造成功”。

定向 `dsActionTools.test.ts`、`g3DsFrozenCaseRunner.test.ts`、`modelPlanner.test.ts` 为 **3文件86通过**；GK-S08 录制动作回放为 **1通过/7跳过**。这些是确定性工程测试，**不是 DS 作图成绩**。

## 2. 一题真实 DS 入场试点

沿用用户上次明确批准的上限：最多5美元、整批108请求、单题8请求、每次序列化输入≤80,000字节、输出≤4096 tokens。使用原生Tauri凭据 `deepseek-v4-flash`（profile revision 2），测试入口干跑首轮只发布 `ds_action` 工具、请求数0，然后实测 GK-S08：

- **真实请求：1次**；原生usage输入1560、输出184 tokens；序列化输入6119字节；实际服务商扣款未知，不能写0美元。
- 模型首轮调用 `request_clarification`，没有构造动作或候选；数学合同未通过（无候选），生产证书、真实DS浏览器渲染、隔离提交**未测**，用户主画布0写入。
- `GK-S08` 冻结题输入模式为 `text_with_figure_reference`，提示含“如图”，但本轮隔离评测只向模型提供了纯文字，**没有经用户核对的题图**。这可能解释澄清选择，但本轮未保存原始模型澄清正文，不能断言唯一原因。不能强迫模型在缺图时猜画来提高分数。
- 因首题未产生可验候选，按 F9 梯度熔断：其他35题**未测**；不能报告“当前版本0/36”，也不能把成功的零费回放作为DS成功。

脱敏报告见[summary.json](summary.json)。暂存运行产物在 Git 忽略目录 `eval-results/g3-f9-action-retest-20261117/`，不提交题干、原始请求/模型正文、凭据或工具参数。

## 3. 下一步的精确边界

1. 先确认 GK-S08 所需题图是否存在且已由用户复核；若题图确实必需，把同版题图经受控原生输入绑定到 `PublicFrozenCaseInput.confirmedFigureRefs` 和模型请求，题目/图像哈希需一致。缺题图则改选完整 `text_only` 代表题，但改样本前须记录原因，不能删除 GK-S08 或把澄清算成功。
2. 即使题图补齐，真实 `ds_action` 仍需验证内核动作、生产证书和完整合同，不能用“图元增加”宣布通过；多状态/多分支真实输出也必须测到，而不只复用预造切片回放。
3. 不自动使用剩余额度扩大批次；下一次付费测试应固定题图来源、新版 revision/二进制及上限并再次确认首题选择。人工可读性、非沙盒Windows实机签收和发布继续阻断。
# G3-F9 GK-S09 原生 DeepSeek 单题实测与可读性修复

- 日期：2026-11-18（America/Los_Angeles）。本轮获用户新授权：使用已保存 DeepSeek profile，仅 GK-S09，最多 **3 次原生请求 / 5 美元**，首题未达标停批；没有追加授权，其他35题未测。
- 发请求前冻结：源码提交 `44a5069ee3f0db960a924e1b0ce20527b46806cc`；冻结36题集 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`；原生保存的 `deepseek-v4-flash` profile revision 2，工具能力 `verified`。当前官方价格页面注明旧别名 `deepseek-v4-flash` 已退役，请求由 DeepSeek-V4.1-Flash-1017 服务并按 Flash 价格结算；不能声称测试的是旧版权重。官方来源：https://api-docs.deepseek.com/quick_start/pricing 。
- 零费 dry-run 验证发布24项动作工具、含 `construct_equal_edge_triangular_prism` 和 `construct_circumsphere`，原生请求计数0；前置上限输入50,000字节/请求、输出2,048 tokens/请求、3请求、5美元。按官方 Flash 峰值 cache-miss 输入 $0.30/百万 tokens、输出 $1.20/百万 tokens 和每字节最多一输入 token 的保守估计，上界约 **$0.0523728**；这**不是**账单上限的服务端强制执行或实际扣费。

## 实测结果（仅已测1题，不作36题比例）

| 原生请求 | 模型调用工具 | 动作回执 | 图元数 |
| --- | --- | --- | ---: |
| 1 | `construct_equal_edge_triangular_prism` | accepted，状态变更 | 21 |
| 2 | `construct_circumsphere` | accepted，状态变更 | 22 |
| 3 | `finish_candidate` | accepted，候选完成 | 22 |

- DS 确实参与，3/3请求有 usage，输入8508/输出235 tokens，传输计数内输入载荷31002字节；firstFailure 未出现。冻结合同 **passed**，生产证书 **passed**、失败义务0。候选 hash：`8cbc38117ef2301b6dbb417fe38478efd7fede093613dc7bc592dc63f933dbf6`。
- 根据已报告 tokens × 官网峰值单价，**粗估约 $0.0028344**；实际服务商扣费未知（`costKnown:false`、`actualCostUsd:null`），不得写0美元。
- 将真实 DS 的同一候选导入隔离浏览器：documentHash 与 candidateHash 相同，画布自动证据 passed、21个可量物体、六个标签、隐藏标签0、诊断错误0；**这不是在用户主画布受控提交**。原始截图 [遮挡版](GK-S09-opaque-before.png) 暴露自动门禁误放行：实体外接球不透明，遮挡棱柱；随后仅修改渲染材质为可透视球壳，同一候选复拍 [可读版](GK-S09-readable.png)，棱与面可读，图片 SHA-256 `57a15f0097b3df9efc32d3fb49b73caa7dab31caff7da38c9ba90ea0655cb9b8`。像素审阅为 AI 现场检查，不是教师/用户人工签收。
- **版本边界**：原生DS调用运行于 `44a5069e`；视觉改动发生在其后，本审计记录同一几何 hash 在修复后的浏览器渲染，不冒充“整个流程同一源码提交”，也不在已用尽3请求的授权下再调用 DS。
- 本轮原生 harness 返回的 render/commit 是 `pending`；在隔离浏览器单独核验渲染，不改变 harness 原值。原生确认前主画布写入次数、同候选隔离确认/提交均**未测量**；不能说整条产品交付通过或36题100%。

## 本次进度对齐复核

- 本次只复核真实 DS 候选的两张截图及其脱敏证据，不再运行离线题库评分；视觉回归单测 9/9、文档检查 22/22、类型检查通过、lint 0 errors / 34 warnings、`git diff --check` 通过。此项核验不是新增的 DeepSeek 调用，也不能代替修复后同版原生交付。

## 实施与退出

- 本轮 RED：`apps/web/src/threeSphere.test.ts` 发现派生外接球 `transparent=false`；修复 `apps/web/src/threePrimitives.ts` 只让 `derivedFrom.kind=circumsphere` 的球壳透明、opacity≤0.24、depthWrite=false，普通球保持不变。定向 Vitest 112/112、Playwright 2/2、typecheck 与文档检查通过，lint 0错误（已有34条 warning）。
- 发布门禁仍未退出：需在**修复后的同一源码提交**下，另获付费授权后复测原生DS + 同候选真实画布预览和隔离交付，并做人工可读性/Windows桌面签收；本次1题成功不扩批。

脱敏机器报告见 [summary.json](summary.json)；未提交原始模型正文、题干请求、凭据、球/棱柱原始动作输入。

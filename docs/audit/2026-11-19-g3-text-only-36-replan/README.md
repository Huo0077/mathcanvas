# G3-F9 纯文字36题重规划检查点（2026-11-19）

## 用户决策

不做视觉测试，原题有图就跳过。重新建立独立的无图36题，不删除产品已有视觉功能、不改写旧36题与旧91次请求回执。

## 已核对数据

读取 `test-fixtures/reliability/drawing-contracts-36.json`：旧23纯文字=18平面+5立体，旧13有图=8高考立体+5联考立体。旧36四象限各9题。历史审计 `2026-11-18-g3-f9-native-36-10x` 按旧 `inputMode` 拆分，旧纯文字23题合同1通过/13失败/9未测；13图题合同13失败（输入不完整），**不是新集成绩**。

## 本区块交付与安全口径

- [规格](../../g3-final/G3-F9-text-only-36-suite-spec.md)、[实施计划](../../g3-final/G3-F9-text-only-36-implementation-plan.md) 与[规划清单](../../../test-fixtures/reliability/text-only-36-plan.json)建立。规划清单锁定旧 suite SHA `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`、23旧候选 ID 和13个**待来源复核的空槽**；`runnable=false`，没有题面/答案/合同，不得对模型运行。
- 测试先 RED（JSON 不存在，2测试均 ENOENT），再 GREEN（2通过）；在旧合同回归一起跑时 2 文件/48 用例通过。核验时新旧合同与运行器定向 Vitest 3 文件/67 用例通过；`npm.cmd run typecheck` 通过；`npm.cmd run test:docs -- --maxWorkers=1` 8 文件/22 用例通过；`npm.cmd run lint` 0 error / 34 条旧 unused-vars warnings；`git diff --check` 通过。早期新测试曾因仓内 Node shim 要求 `Hash.update(text, encoding)` 类型检查失败，现按 UTF-8 读取并修正，最终复核通过。
- 主计划 Block C 已改为无图准入，视觉 C0/C1 保留为历史、退出本轮执行路径；五份进度文件头置同一口径。未收集13道可核查真题、旧23尚待重审，**新版36题尚不可实测**；本轮 0 新增 DS 调用，旧通过率和原生交付未测状态不变。

## 下一步

核对旧23是否真无原图；按8道高考立体、5道联考立体寻找合法且文字充分的真题（不以自编题充数），独立复核后建新 source manifest 与可执行合同。只有完整36题、新版冻结 SHA 与新版预算授权齐全才启动真实 DS 试点与36题全测。

# G3 / T01 scope 继承与曲线/实体绑定试点

- **日期**：2026-11-16
- **范围**：仅 JT-P05、JT-P08、JT-S01 三个合同及对应通用评测判据；T01/P0 仍未退出，未修改任何 `independentReviewStatus`。

## 1. RED 证据

在 `62f46701` 之后先加入真实反例，得到 **4 failed / 35 passed**：

1. JT-P05 第(2)问没有执行第(1)问的 `ob-hyp`，两问可使用不同 C。
2. GK-P09 的函数切线允许两个端点完全相同的零长度“直线”。
3. JT-P08 的 `conic-domain-2d` 只检查排除点声明，半径错误的 G 仍通过。
4. JT-S01 在无球 O 的第(1)(i)/(2)被全局 requiredEntityIds 阻断，同时第(1)(ii)未继承 PC⊥AB。

## 2. 最小通用实现

- `ContractSubquestion.dependsOn` 显式声明前问/父 scope 依赖；`evaluateDrawingContract` 递归收集依赖并防止环导致无限递归。未声明依赖时维持 `stem + 当前 scope`，不隐式继承全部前问。
- `conic-2d.entityId` 绑定唯一指定类型、指定 ID/label 的曲线，实际中心、轴、半径/焦距均须与合同相符，不能拿另一条匿名曲线代替。
- `conic-domain-2d` 同样先核验实际曲线参数，再检查排除点集合。
- `entity-present.primitiveType` 在声明时强制唯一正确图元类型；JT-S01 的 O 必须为真实 `sphere`，而不是同名点。
- 函数切线拒绝零长度端点。

## 3. 合同变更与 GREEN

- JT-P05：第(2)问 `dependsOn:["(1)"]`，双曲线绑定 `entityId:"C"`。正确两问通过；第(2)问替换半径错误的 C 被拒绝。
- JT-P08：第(Ⅱ)问 `dependsOn:["(Ⅰ)"]`，G 绑定实体及实际椭圆参数。正确双分支通过；错误半径的 G 被拒绝。
- JT-S01：两个子问均 `dependsOn:["(1)"]`，`ob-pc-ab` 提升到父 scope；`sharedScope` 补齐两个子 scope；O 从全局必需实体移到 `(1)(ii)` 的 `ob-sphere-present`。无球的 (i)/(2) 可通过，缺球或缺 PC⊥AB 的 (ii) 被拒绝。
- GK-P09：正确切线仍通过，零长度切线失败。

定向 `npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000` → **39/39 passed**。随后修正测试混合图元数组的类型收窄，未放宽评测条件。全量工程与文档读数见 §5。

## 4. 最新离线结果与边界

命令：`npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`。

报告：`eval-results/reliability/offline-2026-11-16T09-42-57.464Z-40916/`（Git 忽略）。

- **0 passed / 12 partial / 24 failed / 0 incomplete**；对象覆盖约27.66%，义务覆盖约22.38%，与上一区块相同。
- 三个试点中 JT-P05、JT-S01 无生产路由，不能从独立合同 GREEN 推导生产通过。没有付费 provider 请求。
- 尚未把 `dependsOn`/曲线 ID 推广到其余平面合同，也尚未实现额外跨候选共享实体哈希。

## 5. 验证记录

- `npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000` → **39/39 passed**。
- `npm.cmd test -- --testTimeout=30000` → **540 files / 5735 passed + 1 todo / 0 failed**。
- `npm.cmd run typecheck` → exit 0。
- `npm.cmd run lint` → exit 0，**0 errors / 33 pre-existing warnings**。
- `npm.cmd run --workspace @draw/web build` → exit 0，**640 modules**。
- `npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts scripts/docs-consistency --testTimeout=30000` → **9 files / 61 tests passed**。
- 合并曲线判据后已恢复双曲线半径的原有 `1e-2` 容差，再运行上述最终代码回归；未收窄既有兼容判据。提交哈希、GitHub 推送及 upstream 0/0 核对记录写入执行台账。

## 6. 未关闭项

- 其余前问曲线继承及关联义务，包括 GK-P01/P02/P05/P07、JT-P01/P02/P03/P04/P06/P07。
- 指定顶点/面环拓扑、真实跨状态 fold-transform、切线点名绑定和稳定实体 ID 指标。
- 全局函数表达式、动点范围/最值、精确不可行证据及 GK-S05/JT-S02 棱柱几何。
- JT-S01 的球半径还需绑定指定球和数值；局部存在性与四点共球不等于半径已核验。
- 统一 runner scope/branch/state 聚合、生产证书、T15/T16、人工签收和 Windows 桌面验收均未完成。

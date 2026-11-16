# G3 / T01 公共曲线 scope 与实体绑定推广

- **日期**：2026-11-16
- **范围**：在上一区块 `dependsOn` 试点基础上，把前问确定、后续共用的曲线按 `stem` 核验，并为命名曲线补实体 ID；T01/P0 未退出，未修改审核状态。

## 1. 合同裁决

前问求得的 C/E/Γ 不是仅属于该小问的局部条件，而是后续共用的对象。此类义务提升为 `stem`，每个 scope 都重新验证实际曲线；不使用“所有后续问继承全部前问”的隐式规则。JT-P05/P08 已显式声明的 `dependsOn` 保持不变。

绑定包括：

- GK-P01 C、GK-P02 E、GK-P03 C、GK-P05 C/M、GK-P06 C/E、GK-P07 C/M。
- JT-P01 C/M、JT-P02 C、JT-P03 C、JT-P04 Γ、JT-P05 C、JT-P06 C、JT-P07 C、JT-P08 G、JT-P09 M。
- GK-P08 原题未给曲线指定字母名称，保留既有匿名精确参数判据，不人为伪造必需标签。

GK-P02 另补 M≠N，防止将同一交点当成题目要求的两个交点。

## 2. RED → GREEN

先加入四个反例并得到 **4 failed / 35 passed**：

1. JT-P01 第(2)问的错误椭圆被不可行披露掩盖，未执行 `ob-c`。
2. GK-P02 的 M=N 曾被当成两个交点。
3. GK-P01 第(2)问的错误 C 被过滤，匿名正确曲线可替其补位。
4. JT-P06 第(2)问的错误 C 被不可行披露掩盖。

提升公共曲线到 `stem` 并绑定实体后，以上反例均被拒绝。GK-P01 还验证正确实体不接受另一条匿名正确曲线替身。修正测试断言后恢复 **39/39**，未改容差或删除反例。

## 3. 最新离线结果

命令：`npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`。

报告：`eval-results/reliability/offline-2026-11-16T10-06-44.893Z-46492/`（Git 忽略）。

- **0 passed / 12 partial / 24 failed / 0 incomplete**，与上一区块相同。
- 对象覆盖约27.66%，义务覆盖约22.24%；新增必要互异义务使分母更完整，不把覆盖率变化当成生产提分。
- 没有付费 provider 请求，没有真实渲染、桌面或人工签收证据。

## 4. 验证记录

- 定向合同测试：**39/39 passed**。
- 全量 Vitest：**540 files / 5735 passed + 1 todo / 0 failed**。
- 类型检查：exit 0。
- Lint：exit 0，**0 errors / 33 pre-existing warnings**。
- 并行验证的 typecheck/lint/build 组合在300秒上限停止，构建未启动；随后单独执行 `npm.cmd run --workspace @draw/web build`，**640 modules / exit 0**。未将超时记为通过。
- 合同与文档守卫：**9 files / 61 tests passed**。
- 提交哈希、GitHub 推送及 upstream 0/0 核对记录写入执行台账。

## 5. 未关闭项

- 通用拓扑仍只验证某个合法多面体，未绑定指定顶点与面环。
- 折前折后未统一核验同一铰链、保距与旋转角；切线/目标直线仍需完整点名绑定。
- 函数全局表达式、动点范围/最值、精确不可行证据、棱柱完整几何和稳定实体指标仍未闭合。
- runner 聚合、生产证书、T15/T16、人工签收及 Windows 桌面验收均未完成。

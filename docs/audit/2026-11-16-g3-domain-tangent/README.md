# G3 / T01 第三批定义域、分支与切线整改

- **日期**：2026-11-16
- **范围**：补 JT-P08 轨迹定义域与双分支、圆上弦关系、函数/圆锥切线和四边形面积。
- **边界**：T01/P0 未退出；本区块使旧 JT-P08 的伪完整通过降为 partial，禁止用完整椭圆掩盖缺失排除点。

## 1. 定义域与多分支

- 新增 `conic-domain-2d`：候选必须显式列出且仅列出审核后的排除点，排除点必须在完整曲线上；只写文字 `x≠0` 不够。
- JT-P08：显式排除 `(0,√3)`、`(0,-√3)`，因为 PA/PB 斜率在这两点无定义。
- 新增 `evaluateDrawingContractBranches` 与 obligation/options 的 `branchId`：分支独立核验，缺任一分支不通过。
- 新增 `line-equation-2d`：按归一化系数验证直线方程，允许非零倍数但不允许错误斜率。
- JT-P08 第(Ⅱ)问的 `displayPolicy` 改为 `enumerate:positive,negative`，分别验证 `y=x/2-1` 和 `y=-x/2-1`，不再只把两支写入备注。

## 2. 切线与圆

- 新增 `tangent-to-function-2d`：用 `evaluateFunctionWithDomain` 与 `evaluateSymbolicDerivative` 重算切点函数值和切线斜率。
- 新增 `tangent-to-conic-2d`：用 `intersectPlanarLineAndConicExact` 判定真实 `tangent`，可额外绑定切点。
- GK-P09：验证 `f(x)=x⁴−2x³` 在 `x=1` 的切线 `y=-2x+1`；经过 `(0,1)` 的错误斜率被拒绝。
- GK-P07：P 必须在圆 M 上，PA/PB 必须是抛物线 C 的真实切线。正例使用 P=(0,-5)、切点 `(±2√5,5)`。
- GK-P06：验证 DA/DB 抛物线切线、AB 中点 M、圆 E 在 M 与 AB 相切及四边形 ADBE 面积3；不固定第(1)问可变的切点。
- JT-P09：A/B/C/D 全部在圆 M 上，O 同时在 AC/BD 上，新增 `quadrilateral-area-2d` 验证面积12。
- GK-S09、JT-S09、GK-P09 的子问文本改为中性，正确选项仅留在 `expectedResult`。

## 3. RED → GREEN

- `evaluateDrawingContractBranches` 实现前不存在，双分支测试 RED；实现后 positive/negative 均通过，缺 negative 或漏排除点失败。
- JT-P09 原合同只检查弦长和垂直，新圆上/共线/面积义务缺失 RED；补齐后正例通过，错端点失败。
- GK-P09 的错误斜率曾被旧“过点”判据接受，RED 后由符号导数拒绝。
- GK-P07 初版测试误把 PA/PB 当作圆 M 切线，阅读原题后改为抛物线 C 切线；P 单独验证在圆 M 上。
- GK-P06 切线、圆中点相切和面积义务缺失 RED；补齐后通过。

最终定向：`npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000` → **1 file / 29 tests passed**。

## 4. 全量验证与最新 36 题

- `npm.cmd test -- --testTimeout=30000` → **540 files / 5725 passed + 1 todo / 0 failed**。
- `npm.cmd run typecheck` → exit 0。
- `npm.cmd run lint` → exit 0，0 errors / 33 pre-existing warnings。
- `npm.cmd run --workspace @draw/web build` → exit 0，640 modules。

最新报告：`eval-results/reliability/offline-2026-11-16T06-57-28.676Z-48656/`。

- **0 passed / 11 partial / 25 failed / 0 incomplete**。
- 平均对象覆盖约28.0%，义务覆盖约21.4%。
- 旧 JT-P08 候选没有 `excludedPoints`，因此不再完整通过；这是定义域判据生效，不是回退或误删成功案例。

## 5. 未关闭项

- 生产 DSL/渲染尚需正式支持 `excludedPoints` 并确保排除点不显示；当前只在合同反例与评测层验证。
- GK-P03/P05、JT-P01/P03/P04/P05 等仍需关联构造、切线/定义域/分支；其余立体题仍需拓扑与宿主。
- `requiredEntityIds` 类型化、显示策略与期望结果消费、统一 runner scope/branch 聚合、生产完整证书和实际构造仍未完成。
- 第二独立 reviewer 尚未复审，T01/P0 不得退出。

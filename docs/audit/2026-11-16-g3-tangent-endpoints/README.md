# G3 / T01 切线端点与目标直线绑定

- **日期**：2026-11-16
- **范围**：GK-P05、GK-P07、JT-P04、JT-P08 的点名实体与切点核验；T01/P0 未退出，未修改独立审核状态。

## 1. 实际缺口与 RED

已有切线只证明某个 `lineId` 与某个 `conicId` 相切，并不证明 P/A/B 位于该线或指定切点。直线方程正确也不证明 E/F 位于该线上。

先加入反例并复现 **4 failed / 35 passed**：

1. GK-P05 的 O 未固定为原点，P/Q 未绑定 l，Aᵢ 切线未绑定各自端点。
2. GK-P07 的 PA/PB 未绑定 P、A、B 及切点在 C 上。
3. JT-P04 的 PA/PB 未绑定 P、A、B，且可在错误点相切。
4. JT-P08 的 EF 方程可与不属于该线的 F 混用。

## 2. 最小实现

- `tangent-to-conic-2d.touchPointLabel`：指定命名点必须存在，且与内核交点算法返回的唯一切点坐标一致；与已有 `touchPoint` 可组合使用，不改变未指定标签的旧合同。
- GK-P05：新增 `ob-o-origin`、`ob-p-on-l`、`ob-q-on-l` 以及六条 Aᵢ 切线端点义务。
- GK-P07：新增 P 在 PA/PB、A 在 PA、B 在 PB、A/B 在 C，并以 A/B 作为命名切点。
- JT-P04：同样绑定 P/A/B 和曲线上的切点，Γ 的 PA/PB 使用 `touchPointLabel`。
- JT-P08：每个 EF 分支均要求 E/F 在名为 EF 的实际直线上，再验证其方程和向量关系。

O 的来源片段最终与原文逐字一致；未修改题目 hash、分母或容差。

## 3. GREEN 与反例

- 正确 P/A/B、曲线和切线组合通过；错误原点、离开切线的点、错误切点、离开 EF 的 F 均被拒绝。
- 单取 `ob-pa-tangent` 也能拒绝在其他点相切，而不是靠另一个义务兜底。
- 定向 **39/39**、全量 **540 files / 5735 passed + 1 todo / 0 failed**、类型检查通过；Lint **0 errors / 33 pre-existing warnings**；Web构建 **640 modules**；文档守卫 **9 files / 61 tests passed**。
- 未再次运行离线 reliability runner，未新增离线36题读数；DeepSeek 最小真实证据保持独立，不代替数学反例。

## 4. 未关闭项

- 动点最值/范围、全局函数表达式、精确不可行诊断、棱柱完整几何与指定球半径。
- 未提供题图的拓扑、其他折叠状态及生产 stage/runner。
- T15/T16 的真实渲染、人工签收与 Windows 桌面生命周期。

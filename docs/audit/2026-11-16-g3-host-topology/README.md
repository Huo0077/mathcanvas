# G3 / T01 第二批拓扑、宿主与平面关联整改

- **日期**：2026-11-16
- **范围**：继第一批合同安全整改后，补独立拓扑、宿主和平面关联义务。
- **边界**：T01/P0 仍未退出；本区块不宣称36题通过率提升，也不批准其余未复核合同。

## 1. 立体拓扑与宿主

- 新增 `topology-3d`：将实际 `polyhedron3.vertexIds/faceIds` 转为索引面环，复用内核 `buildFromPoints` / `buildOpenSurface` 检查共面、非退化、面环简单、连通、绕向、边界和体积；开放折纸与闭合实体分开。
- 未知合同检查默认返回 `unsupported contract check`，不再抛异常或误判通过。
- 新增 `coplanar-3d`：使用非共线点确定平面，退化点集拒绝，偏差按图形尺度检查。
- 新增 `point-on-segment-3d`：同时检查共线距离与线段参数，覆盖内部、越界和线外位置。
- GK-S03：补闭合五面体拓扑，明确未提供题图时只验证候选面环，不证明与原图一致。
- GK-S02：补底面 ABCD 共面与折叠开放曲面；E∈AD、F∈AB 保留题图待核披露。
- JT-S03：补 M∈平面PCD 与 AM⊥PC（在既有 AM⊥CD 之外第二独立方向）。正例 `M=(16/17,24/17,16/17)` 经独立投影计算，错误点仅满足 AM⊥CD 时被拒绝。
- JT-S08：M 由“名称存在”改为真实位于线段 EF 上。
- GK-S07：补 AA₁/BB₁、AA₁/CC₁ 对应平移向量、AB/A₁B₁ 对应边与闭合三棱柱拓扑。

## 2. 平面关联义务

- 新增 `point-on-line-2d`：按 lineId 唯一定位直线并计算点线距离。
- 新增 `point-on-segment-2d`、`horizontal-2d`、`point-x-2d` 和通用 `point-on-conic-2d`（圆、椭圆、双曲线、抛物线残差）。
- GK-P01：补 A/B 位于声明直线 l 及 O(0,0)；“只在椭圆上”不再足够。
- GK-P02：补 P/M/N 共线、M/T 水平与 T 在线段 AB 上，保留 MT=TH 向量中点。
- JT-P02：补 P 在 x=-1、M/N 在双曲线上、P/A₁/M 与 P/A₂/N 两组共线。
- JT-P07：补 A/B 坐标、l 过(1,0)、P/Q 在 l 上及 E/F 在 x=3 上。

## 3. 独立测试与纠错

最终定向命令：

```bash
npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000
```

结果：**1 file / 25 tests passed**。

关键 RED→GREEN：

- 合法四面体通过，反转面破坏共享边绕向被 `inconsistent-winding` 拒绝。
- 非共面底面、线外/越界动点、垂足不在平面、缺第二垂直方向均拒绝。
- GK-P01 点在椭圆但不在 l、GK-P02 T 越界、JT-P02 点不在双曲线、JT-P07 替身直线均拒绝。
- f/g 绑定、scope、不可行和结构谓词第一批16项继续通过，无删除反例。

过程中两处测试坐标经独立复算纠正，未放宽实现判据：

- GK-S07 使用底面直角在 B 的 `h=c=2` 正例，独立得到棱柱体积4、△A₁BC面积 `2√2`；先前错误面积公式未采用。
- JT-P02 的 PA₁ 交点修正为 `M=(-10/3,-16/3)`，与 `N=(-26/5,48/5)` 同时满足双曲线和两组共线。

## 4. 全量验证

- `npm.cmd test -- --testTimeout=30000` → **540 files / 5721 passed + 1 todo / 0 failed**。
- `npm.cmd run typecheck` → exit 0。
- `npm.cmd run lint` → exit 0，0 errors / 33 pre-existing warnings。
- `npm.cmd run --workspace @draw/web build` → exit 0，640 modules。
- 文档/合同守卫另在文档对齐后执行并记录。

最新冻结36题：

```bash
npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json
```

报告：`eval-results/reliability/offline-2026-11-16T06-20-56.393Z-21640/`。结果为 **1 passed / 10 partial / 25 failed / 0 incomplete**，平均对象覆盖约28.0%、义务覆盖约22.5%。义务覆盖继续下降是补齐漏检义务的分母效应，不作为功能退步或通过的证据。

## 5. 未关闭项

- JT-P08 的 `x≠0` 排除点与双 EF 分支尚需可执行定义域/分支合同及生产支持。
- 其余平面题仍需切线/交点/实体绑定/分支；其余立体题仍需对应拓扑、矩形/梯形、折后状态和题图核对。
- `requiredEntityIds` 完整类型化、`displayPolicy`/`expectedResult` 消费、统一 runner scope 聚合和生产完整证书仍未完成。
- 第二独立 reviewer 尚未复审两批整改，T01/P0 不得退出，G3-Math 不得写成36/36。

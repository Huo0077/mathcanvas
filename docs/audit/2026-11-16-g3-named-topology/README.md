# G3 / T01 指定顶点与面环拓扑

- **日期**：2026-11-16
- **范围**：把“存在一个合法多面体”升级为指定对象拓扑，仅覆盖题面可确定的14个立体合同。T01/P0未退出，未修改独立审核状态。

## 1. RED → GREEN

先给 GK-S03 写入六顶点五面体的预期拓扑，保留旧四面体候选并要求拒绝，实际得到 `expected false / received true`：旧检查完全忽略实体身份。随后实现：

- `topology-3d.expectedVertexIds`：按规范化点标签/ID精确匹配顶点集合，不允许缺点、替身或重复身份。
- `topology-3d.expectedFaceRings`：完整匹配面环，允许循环起点变化和面环反向，但不允许缺面、增面、错顶点或错误相邻关系。
- 匹配后仍调用 `buildFromPoints` 或 `buildOpenSurface`，继续检查非有限点、共面、自交、绕向一致性、连通、闭合/开放及非退化体积。

最终正例采用 GK-S03 已验证的六顶点五面体；循环移动面环起点通过，错误绕向拒绝。定向39项与类型检查通过。

## 2. 已绑定的14个合同

| 拓扑族 | Case | 指定面环 |
| --- | --- | --- |
| 四棱锥 P-ABCD | GK-S01、GK-S04、GK-S08、JT-S03、JT-S05 | 底面 ABCD 与四个侧面 PAB/PBC/PCD/PDA |
| 五面体 ABCDEF | GK-S03 | 四边形 ABCD/ADEF/BFEC，三角形 AFB/CED |
| 四面体 | GK-S06 A-BCD、JT-S01 P-ABC | 四个指定三角形 |
| 三棱柱 | GK-S07、GK-S09、JT-S02 | 两个三角形底面及三个四边形侧面 |
| 正四棱柱/立方体 | GK-S05、JT-S09 | 六个指定四边形面 |
| 翻折开放面 | JT-S04 | ABEF 与 ECDF 共用 EF，使用开放面检查 |

GK-S09、JT-S09 另补稳定的辅助顶点名称和 `requiredEntityIds/sharedScope.entities`，空对象清单不再自动给出覆盖1。辅助命名记录于 `freeChoices`，不是从原题臆造条件。

## 3. 未提供题图与不支持的拓扑

- GK-S02、JT-S06、JT-S07：没有已冻结审查的题图 hash/区域，不能推断完整面环，保留未核验披露，未填写猜测拓扑。
- JT-S08：保留共享 AC 的折痕图需求，不以三面共边非流形冒充合法开放面。
- 因此本区块不是立体18/18完成，也不是独立 reviewer 对这些修正的批准。

## 4. 最新离线结果

命令：`npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`。

报告：`eval-results/reliability/offline-2026-11-16T10-36-24.468Z-19032/`（Git 忽略）。

- **0 passed / 11 partial / 25 failed / 0 incomplete**。
- 平均对象覆盖约 **23.50%**，义务覆盖约 **20.39%**。下降反映原候选缺少辅助命名/指定拓扑等原先未计分项，不能用旧读数冒充更严格核验的提升。
- 没有付费 provider、真实桌面或人工签收证据。

## 5. 验证记录

- 定向合同：**39/39 passed**。
- 类型检查：exit 0。
- Lint：exit 0，**0 errors / 33 pre-existing warnings**。
- Web 构建：**640 modules / exit 0**。
- 全量 Vitest：**540 files / 5735 passed + 1 todo / 0 failed**。
- 合同与文档守卫：**9 files / 61 tests passed**。
- 提交哈希、GitHub 推送及 upstream 0/0 核对记录写入执行台账。

## 6. 下一区块

实现跨状态 `fold-transform`：同一铰链、折前折后点对应、保距及真实旋转角，拒绝两组局部条件凑巧成立但不来自同一翻折的候选。切线点名、参数域/最值、完整生产证书及 T15/T16 仍未完成。

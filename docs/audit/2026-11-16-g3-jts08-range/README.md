# G3 / T01 JT-S08 动点平面夹角范围

- **日期**：2026-11-16
- **范围**：JT-S08 的 BC⊥平面 ACFE 证明与 M∈EF 时 `cosθ` 全区间；T01/P0 未退出，未修改独立审核状态。
- **起点**：`e5feca72 test(eval): verify folded skew-angle minimum`。

## 1. 底图纠错与 RED

原测试采用 A(0,0)、B(1,0)、C(1/2,√3/2)、D(-1/2,√3/2)，形成菱形且 BC 不垂直 AC，不满足第(1)问的证明目标。

按 `AB∥CD`、`AD=DC=CB=1`、`∠ABC=60°` 重新独立确定：

`A=(0,0,0)`、`B=(2,0,0)`、`C=(3/2,√3/2,0)`、`D=(1/2,√3/2,0)`。

AB=2、CD=1、AD=CB=1，BA 与 BC 的夹角为60°，且 `BC=(-1/2,√3/2,0)` 与 `AC=(3/2,√3/2,0)` 点积为0。矩形 ACFE 取 E=(0,0,1)、F=(3/2,√3/2,1)。

先写正确底图与证明/范围反例，得到 **1 failed / 42 passed**：旧合同没有 `ob-1-bc-ac`、`ob-1-bc-cf` 或两端点义务。旧菱形底图也作为负例保留，不被删除。

## 2. 数学推导

令 `h=√3/2`、`M=E+t(F−E)=(3t/2,ht,1)`，其中 `t∈[0,1]`。

平面 MAB 与 FCB 的法向可分别取：

`n₁=AB×AM=(0,-2,2ht)`，`n₂=CF×CB=(h,1/2,0)`。

因此 `n₁·n₂=-1`、`|n₁|=2√(1+h²t²)`、`|n₂|=1`，平面锐夹角满足

`cosθ=|n₁·n₂|/(|n₁||n₂|)=1/√(4+3t²)`。

该函数在 `[0,1]` 单调递减，所以：

- `t=0`、`M=E`：`cosθ=1/2`，为最大值。
- `t=1`、`M=F`：`cosθ=1/√7`，为最小值。

故完整范围为 **[1/√7, 1/2]**，不是某一个中间 M 的代表值。

## 3. 实现与端点聚合

- 新增 `ob-1-bc-ac`、`ob-1-bc-cf`，以 AC、CF 两个独立方向核验 BC⊥平面 ACFE；错误菱形拒绝。
- 新增 `rectangle-ef-plane-cos-range-3d`，检查真实梯形、矩形、M 位置、实际法向余弦和端点解析值。
- `ob-2-cos-max` 绑定 `branchId=t0`，`ob-2-cos-min` 绑定 `branchId=t1`；`displayPolicy.multiBranchHandling` 为 `enumerate:t0,t1`。
- `evaluateDrawingContractBranches` 必须同时提供两个端点；缺任一端点为 incomplete，t=1/2 不能代替 t=0。
- 共享 AC 折痕/非流形披露保留，未把三面共边的伪开放面壳写成合法拓扑。

验证：

- 定向合同：**43/43 passed**；类型检查通过。
- 全量 Vitest：**540 files / 5739 passed + 1 todo / 0 failed**。
- Lint：**0 errors / 33 pre-existing warnings**。
- Web build：**640 modules transformed**，成功。
- 合同与文档守卫：**9 files / 65 tests passed**。
- 未运行离线 reliability runner，不新增36题或provider通过读数。

## 4. 未关闭项

- JT-S01 剩余二面角最值及指定球半径、GK-S02 及其他折叠状态。
- 生产完整证书、统一 scope/branch/state 聚合、显示策略/结果消费和第二独立 reviewer 全量复审。
- T15/T16 的真实渲染、人工签收与 Windows 桌面生命周期。

# G3 / T01 JT-S04(2) 异面直线最小余弦

- **日期**：2026-11-16
- **范围**：JT-S04(2) 的 BC 与 AD 异面直线夹角最值，绑定真实 F→E、+90° 折叠谱系；T01/P0 未退出，未修改独立审核状态。
- **起点**：`5b5590fc test(eval): prove segment dihedral infeasibility analytically`。

## 1. 目标纠正与 RED

第(2)问是**异面直线夹角**，不是二面角。第(1)问的 BE=5 也不能替代第(2)问的独立参数域。

先以 BE=6 建立真实旋转前后候选，实测满足旧合同但缺 `ob-2-skew-min-cos`，得到 **1 failed / 42 passed**。另保留 BE=5 的非最优反例，以及缺少 before/after 候选时的失败断言。

## 2. 独立数学推导

令 `h=2√3`、`x=BE∈(0,8)`。折前：

`A=(0,0,0)`、`B=(0,h,0)`、`C=(8,h,0)`、`D=(9,0,0)`、`E=(x,h,0)`、`F=(x,0,0)`。

A/B 绕 F→E 旋转90°后，`A=(x,0,x)`、`B=(x,h,x)`。故

`BC=(8-x,0,-x)`，`AD=(9-x,0,-x)`。

两方向的夹角差可写为

`θ(x)=atan(x/(9-x))-atan(x/(8-x))`，

`θ'(x)=9/(2x²-18x+81)-8/(2x²-16x+64)`
`     =2(x²-36)/[(2x²-18x+81)(2x²-16x+64)]`。

分母均为正，故 θ 在 `(0,6)` 递减、在 `(6,8)` 递增，唯一最小点在 x=6。此时 BC=(2,0,-6)、AD=(3,0,-6)，点积42、长度分别为√40、√45：

`cosθmin=42/(√40√45)=7√2/10`。

第(1)问的 BE=5 与此不同，第(2)问不继承 CF⊥BD 或 BE=5。

## 3. 实现与反例

新增 `folded-trapezoid-min-skew-cosine-3d` 和 `ob-2-skew-min-cos`，scope `(2)`、state `after_fold`：

- 核验折前直角梯形、AB=2√3、BC=8、AD=9、E/F 位置与 E 在 BC 内部。
- 复用既有 `fold-transform-3d`，要求 before/after 同一候选满足 F→E、+90° 的 A/B 刚体旋转和铰链不漂移；缺少跨状态输入失败。
- 从折后实际 A/B/C/D 重算异面方向余弦，并要求 BE=6 和 `7√2/10`，不能只给一个更大的合法角度。
- BE=5 的合法非最优候选被拒绝；BE=6 的真实折叠正例通过。

验证：

- 定向合同：**43/43 passed**；类型检查通过。
- 全量 Vitest：**540 files / 5739 passed + 1 todo / 0 failed**。
- Lint：**0 errors / 33 pre-existing warnings**。
- Web build：**640 modules transformed**，成功。
- 合同与文档守卫：**9 files / 65 tests passed**。
- 未运行离线 reliability runner，不新增36题或provider通过读数。

## 4. 未关闭项

- JT-S01 剩余二面角最值及指定球半径、JT-S08 cosθ 范围、GK-S02 及其他折叠状态。
- 生产完整证书、统一 scope/branch/state 聚合、显示策略/结果消费和第二独立 reviewer 全量复审。
- T15/T16 的真实渲染、人工签收与 Windows 桌面生命周期。

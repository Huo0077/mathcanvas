# G3 / T01 结构化不可行诊断与代数证据

- **日期**：2026-11-16
- **范围**：JT-P01、JT-P04、JT-P06 的指定小问诊断、真实图元及代数证据；T01/P0 未退出，未修改独立审核状态。
- **起点**：`a98ef41d test(eval): verify function expressions and tangent parameter domain`。

## 1. 根因与 RED

`infeasible-branch` 原先用全篇 `answerText` 的“无解/不存在”等关键词兜底。即使 `infeasibleDiagnosedSubquestions` 指向其他小问，全文出现关键词也会通过；它没有验证指定小问的几何原因。

对三个合同分别输入 `answerText: "另一小问无解。"`、`infeasibleDiagnosedSubquestions: ["(1)"]`，实现前均错误放行 `ob-2-infeasible`/`ob-infeasible-2`，实测 **3 failed / 36 passed**。这不是错误诊断文本的边界美化，而是合同判定缺少数学证据。

另发现 JT-P04 旧测试的 PB 并非切线，且斜率积 -2 没有被完整核验。独立重算采用 `A=(4,4)`、`B=(-2,1)`：切线分别为 `y=2x-4`、`y=-x-1`，交于 `P=(1,-2)`，斜率积为 -2。纠正的是错误的测试候选，不是降低切线要求。

## 2. 三类证据

### JT-P01：不是恰有一个交点

`A=(2,0)`、`F₁=(-1,0)`，所以 AF₁ 的垂直平分线为 `x=1/2`。椭圆 `x²/4+y²/3=1` 给出两个交点：

`(1/2, ±3√5/4)`。

`line-conic-intersections-2d` 先核验直线经过 AF₁ 中点且与 AF₁ 垂直，再调用内核精确交点算法，要求 secant 和两个指定交点；平移后的错误平分线被拒绝。它不是将 `single` 或 `tangent` 混计为两个交点。

### JT-P04：共圆条件无实数解

设抛物线 `x²=4y` 上两切点的横坐标为 a、b。切线为 `y=(a/2)x-a²/4`、`y=(b/2)x-b²/4`，斜率积 -2 给出 `ab=-8`，交点 `P=((a+b)/2,-2)`。令 `p=(a+b)/2`、`d=(a-b)/2`、`k=(d²-3)/2`，准线垂足为 `C=(a,-1)`、`D=(b,-1)`。

若 A、C、P、D 共圆：

1. C、D 的垂直平分线使圆心为 `(p,k)`；等距于 P、D 给出 `2k=d²-3`。
2. 等距于 A、D 给出 `a²/4=2k+1=d²-2`（另一分支为 `a²/4=-1`，实数不可能）。
3. 代入 `a=p+d` 得 `p²+2pd-3d²+8=0`。结合 `ab=p²-d²=-8`，得到 `d(p-d)=0`。

因此 `a=b` 或 `b=0`，都与 `ab=-8` 矛盾；不存在满足全部条件的实数点。`parabola-directrix-cyclic-infeasible-2d` 锁定此题的抛物线、真实切线、P、C/D 和斜率积，再使用上述推导，不用一张代表图冒充全称证明。

### JT-P06：焦点直角条件不可行

椭圆为 `x²/5+y²/4=1`，故 `b=2`、`c=1`、`F₁=(-1,0)`、`F₂=(1,0)`。对椭圆上任意 P=(x,y)：

`(P-F₁)·(P-F₂)=x²+y²-c²=b²-c²+(c²/a²)x²≥b²-c²=3>0`。

所以点积不能为 0，不存在 `PF₁⊥PF₂` 的椭圆点。`ellipse-focal-right-angle-infeasible-2d` 核验实际椭圆、焦点和 `b>c`；改为 `b=1<c` 的可行情形时，即使有不可行文字也拒绝。

## 3. 实现边界与验证

- 三份合同的可选 `evidence` 要求指定小问的结构化诊断，关键词不能兜底；禁止实体检查继续独立生效。
- 没有专用证据的旧合同保持原接口，未把 GK-S05 等其他诊断强制塞入不适用的新谓词。
- 首次实现误把 `intersectPlanarLineAndConicExact` 的 `points` 数组当成单点字段，导致 JT-P04 运行时错误和类型错误；核对真实接口后改为数组匹配并固定椭圆中心类型，随后定向与类型检查通过。未掩盖此中间失败。
- 定向合同测试：**39/39 passed**；类型检查通过。
- 全量 Vitest：**540 files / 5735 passed + 1 todo / 0 failed**。
- Lint：**0 errors / 33 pre-existing warnings**；Web build：**640 modules transformed**，成功。
- 合同与文档守卫：**9 files / 61 tests passed**。
- 未运行离线 reliability runner，不新增36题或provider通过读数。

本区块只证明独立合同求值及其反例。生产回答如何生成结构化诊断、如何与实际 `answerText`/scope 绑定，仍属于统一 runner/生产证书后续工作；此处不能证明真实模型或36题端到端通过。

## 4. 未关闭项

- 其余动点最值/范围、GK-S05/JT-S02 完整棱向量、其他折叠状态及指定球半径。
- 显示策略与结果消费、生产完整证书、统一 scope/branch/state 聚合和第二独立 reviewer 全量复审。
- T15/T16 的真实渲染、人工签收与 Windows 桌面生命周期。

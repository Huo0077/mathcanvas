# G3 / T01 第二轮独立复核与合同整改切片

- **日期**：2026-11-16
- **复核者**：agent-0，未参与合同撰写的独立 reviewer；只读逐题复核，未派生代理、未使用网络或付费 provider。
- **复核对象**：HEAD `2a6e40c84a2657c8337b2df6bfdd5440838d9e7d` 加上当时的三份未提交合同/测试文件。
- **结论**：4 题作图数学合同可批准、32 题 `changes_required`。suite 与全部 case 继续保持 `pending_second_reviewer`；T01/P0 和 G3-Math 均未退出。

## 1. 逐题复核清单

`修正待复审`表示本区块已按 finding 实现针对性修正，但不是 reviewer 新一轮批准。

| Case | 第二轮独立结论 | 本区块处置与仍未关闭事项 |
| --- | --- | --- |
| GK-P01 | changes_required | 前问确定的 C 未在后续 scope 继承、跨 scope 一致性未绑定。 |
| GK-P02 | changes_required | 后续 scope 的 C、M/N 互异仍缺。 |
| GK-P03 | **修正待复审** | 已纠正最优直线为 `x−√2y−4=0`，补 M≠N、A/B 在 AB 上和非最优/脱离直线反例；最优性推导见 §2。 |
| GK-P04 | changes_required | 全局函数表达式与参数域、范围证明未闭合。 |
| GK-P05 | changes_required | P/Q 在 l、O 原点、切线端点未完整绑定。 |
| GK-P06 | **修正待复审** | 已枚举 D=0,±1，面积为3或4√2，补切点在 C、切线端点、圆半径/切点；详见 §3。 |
| GK-P07 | changes_required | 切线端点/切点、圆定义与最大面积参数域未闭合。 |
| GK-P08 | approved（仅作图数学） | 精确曲线条件足以锁定渐近线相切；空 requiredEntityIds 是 Minor 指标问题。 |
| GK-P09 | changes_required | 全局函数表达式、退化函数切线未闭合。 |
| JT-P01 | changes_required | 不可行结论需结构化绑定两交点证据；前问 C 与 scope 继承未闭合。 |
| JT-P02 | changes_required | 实际 C、P 非零纵坐标及另一交点未完整绑定。 |
| JT-P03 | changes_required | 实际 C 和动点长度最小值未闭合。 |
| JT-P04 | changes_required | PA/PB、切点/曲线身份及精确不可行证据未闭合。 |
| JT-P05 | changes_required | 前问 C 在后续 scope 中被过滤。 |
| JT-P06 | changes_required | 不可行披露可与错误 C 组合；scope 继承未闭合。 |
| JT-P07 | changes_required | 实际 C、P/Q 互异和向量最小值未闭合。 |
| JT-P08 | changes_required | EF 未绑定 E/F，分支点集与直线可混用，G 参数未验证。 |
| JT-P09 | approved（仅作图数学） | 圆、圆心、圆上点、弦宿主、垂直和面积均有真实检查。 |
| GK-S01 | changes_required | 通用闭合拓扑未绑定 P-ABCD 的顶点/底面/五个面。 |
| GK-S02 | changes_required | 折前折后刚体变换与指定开放面环未闭合。 |
| GK-S03 | changes_required | 五面体合同曾被四面体正例满足，直接证明通用拓扑不足。 |
| GK-S04 | changes_required | 四棱锥指定拓扑未绑定。 |
| GK-S05 | changes_required | 正四棱柱缺第二垂直方向、AD=2和完整对应棱关系。 |
| GK-S06 | changes_required | 指定四面体面环未绑定，候选可另放合法多面体。 |
| GK-S07 | changes_required | 对应向量与实际三棱柱面环未绑定。 |
| GK-S08 | changes_required | 四棱锥指定拓扑未绑定。 |
| GK-S09 | approved（仅作图数学） | 等棱三棱柱距离分组、闭合拓扑和共球关系成立。 |
| JT-S01 | changes_required | `(1)`与两个子 scope 不一致，PC⊥AB 未继承，O 被错误全局强制。 |
| JT-S02 | changes_required | 三棱柱平移/棱关系与指定拓扑未闭合。 |
| JT-S03 | changes_required | 四棱锥指定拓扑未绑定。 |
| JT-S04 | changes_required | BE=5 经独立推导确认；跨状态铰链/保距/90°变换和第(2)问最值仍未闭合。 |
| JT-S05 | changes_required | 四棱锥指定拓扑未绑定。 |
| JT-S06 | changes_required | 未提供题图的披露不等于指定五面体拓扑证明。 |
| JT-S07 | changes_required | 五面体缺面数/顶点集约束。 |
| JT-S08 | changes_required | 非流形披露保留；动点 cosθ 范围未闭合。 |
| JT-S09 | approved（仅作图数学） | 本区块补真实闭合六面拓扑；立方体/半球关系已验证。 |

## 2. 两项明确数学错误的独立复算

### GK-P03

设抛物线 `y²=4x` 上点为 `(t²,2t)`，焦点弦参数满足 `mn=−1`。过 D(2,0) 的第二交点参数为 `−2/m,−2/n`。令 `s=m+n`，则 MN 的斜率为 `2/s`、AB 的斜率为 `1/s`，AB 截距为4。对 `s>0`：

\[
\theta(s)=\arctan(2/s)-\arctan(1/s),\qquad
\theta'(s)=-2/(s^2+4)+1/(s^2+1).
\]

内点驻点为 `s=√2`，端点角差趋于0，因此是最大分支；`AB: x−√2y−4=0`。最大角差约 `19.47122063449069°`，`s=2` 时只有约 `18.43494882292201°`，故原合同的 `x−2y−4=0` 不是最优答案。

### GK-P06

令 `D=(d,−1/2)`，切点弦为 `AB:y=dx+1/2`，中点 `M=(d,d²+1/2)`。圆在 M 与 AB 相切要求 `EM⊥AB`，即 `d(d²−2)=−d`，所以 `d=0,1,−1`。D=0 的面积为3，D=±1 的面积均为 `4√2`；三支圆半径分别为2、√2、√2。原合同只接受 `D=0`，属于漏合法分支，不是另一支的数值容差问题。

### JT-S04 调试纠错

测试现使用几何内核 `rotatePointAboutHinge` 对 A/B 绕 EF 旋转90°，而非手写伪折后坐标。折前 `B=(0,h,0)`、`E=(x,h,0)`、`F=(x,0,0)`，`h=2√3`；折后可取 `B'=(x,h,x)`。由 `FC·B'D=(x−8)(9−x)+12=−(x−5)(x−12)` 且 `0<x<8`，唯一有效解为5。主执行者临时推过的20/3已作为反例，未进入结论；reviewer 独立确认5。跨状态 fold-transform 合同仍是未关闭 finding。

## 3. 本区块 RED → GREEN 与边界

- GK-P03 的正例 `s=√2` 在旧方程下失败；修正后通过，`s=2` 非最优、M=N 和同名但不关联的 AB 均被拒绝。
- GK-P06 的正负支在旧面积3/固定切点下失败；修正后 zero/positive/negative 均通过，切点离开 C/DA 的反例被拒绝。
- JT-S04 由错误折后坐标产生的垂直/拓扑失败，改为真实旋转后通过；这不是修改容差。
- JT-S09 空面壳合同在新增拓扑测试下失败，补 `topology-3d` 后真实六面闭合立方体通过。
- 39 项目标合同测试和类型检查已在最终夹具修正后通过；全量 Vitest、Lint、Web 构建和文档守卫的最终读数在 §5 结算。

## 4. 最新生产离线结果

命令：`npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`。

- 报告：`eval-results/reliability/offline-2026-11-16T09-16-30.017Z-46844/`（Git 忽略原始输出）。
- revision：`2a6e40c84a2657c8337b2df6bfdd5440838d9e7d`，即本区块 BASE；没有付费 provider 请求。
- **0 passed / 12 partial / 24 failed / 0 incomplete**；对象覆盖约27.66%，义务覆盖约22.38%。
- 未路由和生产入口未闭合仍导致24题失败；分布变化不能解释为合同测试通过或生产数学完成。runner 的跨 scope/branch/state 聚合仍须实现，不能把单候选旧读数当成整题退出。

## 5. 全量验证与推送

- `npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000` → **1 file / 39 tests passed**。
- `npm.cmd test -- --testTimeout=30000` → **540 files / 5735 passed + 1 todo / 0 failed**。
- `npm.cmd run typecheck` → exit 0。
- `npm.cmd run lint` → exit 0，**0 errors / 33 pre-existing warnings**。
- `npm.cmd run --workspace @draw/web build` → exit 0，**640 modules**；保留既有动态 import/chunk-size 警告，不改作通过项。
- `npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts scripts/docs-consistency --testTimeout=30000` → **9 files / 61 tests passed**。
- 本审计不宣称第二轮 finding 已全部关闭，也不宣称 T01、G3-Math 或 G3-UX 已完成。本区块提交哈希、GitHub 推送及 upstream 0/0 核对记录写入执行台账，不在此预写未经核对的远端结论。

## 6. 下一区块必须保留的未关闭项

1. **前问/父子 scope 继承及共享实体一致性**，包括 JT-S01 的 O 局部必需性与错误全局强制。
2. **指定拓扑而非任意合法多面体**：顶点 ID、面数、面环和同一 solid 的度量/球面关系。
3. **真实跨状态折叠**：同一 EF 铰链、保距、旋转角和状态身份；不能分别给两组局部正确坐标就通过。
4. **切线及目标直线的点名绑定**，以及圆锥曲线实体 ID/实际参数，不再只看一条匿名正确曲线。
5. **全局函数表达式、参数域、动点范围/最值与精确不可行证据**，不用单点代表图或关键词替代。
6. **GK-S05/JT-S02 棱柱完整几何、非退化交点和稳定实体 ID 指标**。
7. `displayPolicy` 的生产消费、统一 runner 聚合、完整生产证书、T15/T16 的真实渲染/人工签收和 Windows 桌面验收均未完成。

Reviewer 明确不否决的边界：后续 displayPolicy 消费、生产证书、渲染、人工签收和桌面交互不属于本次数学合同否决依据；未提供的题图不猜像素内容；不把自动证明所有全称命题新增为本轮前提。这些边界不消除上述合同 finding。

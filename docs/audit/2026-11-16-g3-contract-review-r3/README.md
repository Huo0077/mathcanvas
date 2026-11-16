# G3 / T01 第三轮独立全量合同复核

- **日期**：2026-11-16
- **Reviewer**：agent-0，未参与合同撰写；只读复核，未派生子代理、未调用网络/provider、未读取密钥。
- **Revision**：`6fb9f34a4f3c3c7a27b413e75b9a155c6e943d04`
- **结论**：case 专属内容 **16/18 平面、10/18 立体**可批准；**suite 不可批准**，T01/P0 不得退出，suite/case 均保持 `pending_second_reviewer`。

## 1. 逐题结果

`approved` 只表示 case 专属数学合同内容可批准，不表示生产、渲染、交互或发布通过。

| Case | 独立结论 | 依据或最小未关闭项 |
| --- | --- | --- |
| GK-P01 | approved | stem 椭圆、A/B 在椭圆和 l、O 与面积均有实核。 |
| GK-P02 | approved | 共享 E、P/M/N 共线、M≠N、MT 水平、T 在线段和等长均核验。 |
| GK-P03 | approved | 最优直线 x−√2y−4=0；非最优、重合点与脱线反例成立。 |
| GK-P04 | approved | 全局多项式身份及公共切线推导 a≥−1，非采样证明。 |
| GK-P05 | approved | O、P/Q、端点、曲线与圆相切关系均绑定。 |
| GK-P06 | **changes_required** | 三支数值正确，但 A/B/M 未强制属于实际 AB；圆可与脱节的同名 AB 相切。 |
| GK-P07 | approved | 最大面积20√5在P=(0,-5)，有全域公式与切线绑定。 |
| GK-P08 | approved（Minor指标） | 双曲线/圆锁定渐近线相切；requiredEntityIds为空使对象覆盖指标失真。 |
| GK-P09 | approved | 全局函数、符号导数、非退化切线及答案B。 |
| JT-P01 | approved | 真实垂直平分线及两个交点证明第(2)问假命题。 |
| JT-P02 | **changes_required** | P=(-1,0)、M=A₁、N=A₂仍可通过；y_P≠0与第二交点非退化未入义务。 |
| JT-P03 | approved | 最小|DE|=4/3在s=-8，参数关系与交点完整。 |
| JT-P04 | approved | 切点、垂足、共圆矛盾均实核，无实数P。 |
| JT-P05 | approved | 显式继承实际C，恒比6/5和平行/弦关系完整。 |
| JT-P06 | approved | 实际椭圆/焦点排除直角，伪P和错误C拒绝。 |
| JT-P07 | approved | P/Q互异，最小点积1在竖直弦x=1取得。 |
| JT-P08 | approved | 排除点、实际曲线、EF端点和正负分支均核验。 |
| JT-P09 | approved | 圆上端点、弦、垂直与面积共同锁定结论。 |
| GK-S01 | approved | 两问局部条件、二面角正弦和指定P-ABCD拓扑完整。 |
| GK-S02 | **changes_required** | 折叠与8/√65正确，但E/F宿主及原图面环未确认。 |
| GK-S03 | **changes_required** | 命名五面体检查有效，但与原图的面环等价性未确认。 |
| GK-S04 | approved | 底面、度量、E中点和指定四棱锥面环完整。 |
| GK-S05 | approved | 棱柱向量完整，120°不可达的整段多项式证据成立。 |
| GK-S06 | approved | 等长、角度、E中点、EF=DA和四面体拓扑完整。 |
| GK-S07 | approved | 棱柱关系、体积、面积、局部垂直与命名拓扑完整。 |
| GK-S08 | approved | 底面、PD垂直、长度/平行及指定四棱锥拓扑完整。 |
| GK-S09 | **changes_required** | 棱柱正确，但circumsphere可从其他polyhedron集合取点顶替。 |
| JT-S01 | **changes_required** | 半径√5/2和最小1/√3正确，但指定O的球仍可从另一四面体取点。 |
| JT-S02 | approved | 棱柱关系、面面垂直、P比例与二面角余弦完整。 |
| JT-S03 | approved | M宿主、AM两个垂直方向、底面比例及指定拓扑完整。 |
| JT-S04 | **changes_required** | 数值正确；合同仅+90°，且以两面开放曲面替代原题闭合六面体。 |
| JT-S05 | approved | 矩形、等边PCD、体积、E中点与指定四棱锥拓扑完整。 |
| JT-S06 | **changes_required** | 通用拓扑和未提供原图不足以证明候选与题图一致。 |
| JT-S07 | **changes_required** | 五面体面数/面环与原图等价性仍未闭合。 |
| JT-S08 | approved | 正确梯形、两个垂直方向和cosθ∈[1/√7,1/2]均核验。 |
| JT-S09 | **changes_required** | 立方体/半球数值正确，但可从其他polyhedron取立方体顶替。 |

## 2. 独立复核发现的阻断项

1. **GK-P06**：每个 zero/positive/negative 分支都须把 A、B、M 绑定到实际 AB；增加移动实际点而保留正确 AB 图元的反例。
2. **JT-P02**：P 的非零纵坐标和第二交点身份/互异性必须成为义务；退化 P=(-1,0)、M=A₁、N=A₂ 不得通过。
3. **JT-S04**：需要闭合六面体而非两面开放曲面；主 fold 与 skew-min 都须覆盖同一 ±90° 镜像方向。
4. **球体/立方体绑定**：`polyhedronVertexSets` 的 `some(...)` 可任选正确替身。GK-S09、JT-S01、JT-S09 必须把 circumsphere/cube/hemisphere 与指定 solid 绑定；加入“题目实体错误、额外匿名实体正确”的反例。
5. **全局重复标签覆盖**：`points3Of`/`points2Of` 对规范化同名点直接覆盖，最后正确坐标可通过。必须拒绝同标签/别名冲突和错误类型，而不是覆盖。

题图来源未确认的 GK-S02、GK-S03、JT-S06、JT-S07 保留 unknown/条件合同，不从分母删除，不推断像素。

## 3. 已实际确认的修复与边界

- 36/36 原文、metadata、hash、sourceSpan 一致；reviewer 实测9文件66项通过，但这些测试不覆盖上述新 finding，不能据此关闭 T01。
- 第二轮之后的高风险数值经独立重算均吻合，包括 GK-P03、GK-P04、JT-P03、JT-P07、GK-P07、GK-S05、JT-S01、JT-S04、JT-S08、GK-S02。
- 共享 scope、不可行代数证据、函数全域表达式、平面最值、真实旋转、镜像和指定拓扑已形成实际检查。
- 生产渲染、交互、生产证书、桌面、发布、provider成绩不纳入本次数学合同批准/否决依据；也不能据此将正确合同写成产品通过。

## 4. 停止时的后续待办（2026-11-17，未执行）

用户随后明确要求停止 goal 和当前工作，不再开展整改。GK-P06/JT-P02、重复标签与指定球体/立方体、JT-S04 镜像与闭合六面体均未开始修复，未确认题图保持未关闭。T01最终复核、Task2生产证书、Task3平面18题、Task4立体/折叠18题与G3-Math、Task5真实渲染/人工签收、Task6浏览器与桌面交互、Task7 G3总验收也均未完成。恢复时仍须先整改并再次独立逐题复核，不将本文件当作批准证明。

`declined to judge`：生产渲染/交互/证书/桌面/发布、外部原卷视觉内容与provider泛化结果；自动证明所有课程命题不新增为本轮前置条件，但上述合同最值、分支和不可行证据不属于可搁置范围。

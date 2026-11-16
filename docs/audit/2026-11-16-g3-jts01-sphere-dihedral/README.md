# G3 / T01 JT-S01 指定球半径与二面角最值

- **日期**：2026-11-16
- **范围**：JT-S01(1)(ii) 指定 O 的半径与第(2)问 A-CP-B 的最小余弦；T01/P0 未退出，未修改独立审核状态。
- **起点**：`2cbf3180 test(eval): verify folded plane-angle range`。

## 1. 缺口与 RED

旧合同只证明指定 O 存在和四点共球，未核验半径；第(2)问只有代表点，没有二面角最值义务。

先要求 `ob-sphere-radius`、`ob-min-dihedral`，实测 **1 failed / 42 passed**。φ=90° 的普通折叠点保留为非最优反例；错误半径1也被拒绝。第(1)问仍使用 PC⊥AB 的 φ=90° 特例，第(2)问不继承该限制。

## 2. 球半径独立求解

取 A=(0,0,0)、B=(0,1,0)、C=(1,0,0)、P=(3/2,0,√3/2)。AB=AC=1、AC⊥AB、PC=1、PA=√3。

ABC 所在平面的外接圆圆心为 (1/2,1/2,0)。沿该平面法向移动球心到 O，由 OA=OP 得 O=(1/2,1/2,√3/2)，从而

`R²=1/4+1/4+3/4=5/4`，`R=√5/2`。

`circumsphere-3d` 新增可选 `sphereId`、`radius`：先用 A、B、C 的平面外接圆与 P 的位置独立解出球心，再与实际 O 的 center/radius 比较。可选字段为空时保持旧合同行为，有字段时必须同时满足共球、指定实体、球心和半径。

## 3. 二面角最小值

令 `r=√3/2`、`c=cosφ`，折叠圆上 P=(3/2,rc,rs)。沿 CP 投影 CA、CB，得到

`cosθ=(√3+c)/√(7-3c²+2√3c)`。

令 N=√3+c、D=7-3c²+2√3c。求导的符号由

`2D-ND'=8(1+√3c)`

决定，故 cosθ 在 `c<-1/√3` 时递减，在 `c>-1/√3` 时递增。最小值在 `c=-1/√3` 取得，为 **1/√3**。

对应 `P=(3/2,-1/2,±1/√2)`。两个镜像分支都验证通过；φ=90° 的 `cosθ=√(3/7)>1/√3`，不能作为最值答案。

`folded-triangle-dihedral-min-cosine-3d` 检查实际折叠圆、CP 投影余弦、解析公式、取等 c 和最小值。第(2)问不把第(1)问 PC⊥AB 的条件强加给动点。

## 4. 验证与未关闭项

- 定向合同：**43/43 passed**；类型检查通过。
- 全量 Vitest：**540 files / 5739 passed + 1 todo / 0 failed**。
- Lint：**0 errors / 33 pre-existing warnings**。
- Web build：**640 modules transformed**，成功。
- 合同与文档守卫：**9 files / 65 tests passed**。
- 未运行离线 reliability runner，不新增36题或provider通过读数。
- GK-S02 与其他折叠状态、生产完整证书、统一 runner、显示策略/结果消费和第二独立 reviewer 全量复审仍未完成。
- T15/T16 的真实渲染、人工签收与 Windows 桌面生命周期未完成。

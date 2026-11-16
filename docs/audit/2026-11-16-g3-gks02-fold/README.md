# G3 / T01 GK-S02 文字可确定的折叠证据

- **日期**：2026-11-16
- **范围**：GK-S02 的 A→P 刚体折叠、EF⊥PD、面 PCD/PBF 正弦和按状态的对象清单；T01/P0 未退出，未修改独立审核状态。
- **起点**：`5896a349 test(eval): verify sphere radius and fold dihedral minimum`。
- **边界**：本区块不把 GK-S02 标为完整退出。未提供已审核题图 hash/regions，完整面环与 E/F 宿主确认仍保留为未关闭项。

## 1. RED 与根因

新正反例先得到 **1 failed / 43 passed**：

- 折前被强制要求 P，尽管 P 是 A 折叠后的身份。
- 折后混入折前的义务，两个小问的测量也被错误合并。
- 单一 +90° 检查不能覆盖另一个合法镜像。
- 谱系最初只取第一份折前候选，导致缺 P 的误报；实际旋转已经通过，但 lineage 对象覆盖仍失败。

修复分为按 state 的对象集合、真实镜像旋转、实际角度测量和谱系聚合，而不是删除任何检查。

## 2. 文字可确定的数学内容

取 A=(5√3,0,0)、B=(√3,4,0)、C=(0,3,0)、D=(0,0,0)，则 AB=8、CD=3、AD=5√3、AD⊥CD、∠BAD=30°。按文字比例 E=A+2(D−A)/5=(3√3,0,0)、F=A+(B−A)/2=(3√3,2,0)。

A 绕 EF 旋转 ±90° 得 `P=(3√3,0,±2√3)`，满足 PE=2√3、PF=4、PC=4√3。EF 与 PD 垂直。

面 PCD 与 PBF 的法向可取 `(-2,0,3)`、`(√3,3,√3)`，其余弦绝对值为 `√3/(√13√15)=1/√65`，所以二面角正弦为

`√(1-1/65)=8/√65`。

镜像时法向符号改变，但正弦相同。

## 3. 实现

- `stateRequiredEntityIds`：折前 A/B/C/D/E/F，折后 B/C/D/E/F/P。
- `stemStateId`：原始题设默认折前；PE/PF/PC、开放曲面、证明和测量显式折后。其他合同未设置该字段，保持原行为。
- `fold-transform-3d.allowMirror`：尝试 ±angle，但所有移动点必须共享同一个有向角度；不允许不同点各自选镜像。
- `plane-sine-3d`：从两个实际平面法向重算正弦。
- `ob-fold-transform`、`ob-ef-pd`、`ob-plane-sine` 分别绑定谱系、scope (1)、scope (2)。
- `multiStateHandling=enumerate:before_fold,after_fold`；缺折前状态为 incomplete，伪旋转被拒绝。
- 谱系聚合改为使用全部状态的实体并集，不再以第一份候选的缺失误报 lineage。
- 开放曲面仅约束实际顶点 B/C/D/E/F/P；**没有写入 `expectedFaceRings`**。测试中的面环是满足文字条件的候选，不是已审核题图拓扑。

## 4. 验证与未关闭项

- 定向合同：**44/44 passed**；类型检查通过。
- 全量 Vitest：**540 files / 5740 passed + 1 todo / 0 failed**。
- Lint：**0 errors / 33 pre-existing warnings**。
- Web build：**640 modules transformed**，成功。
- 合同与文档守卫：**9 files / 66 tests passed**。
- 未运行离线 reliability runner，不新增36题或provider通过读数。
- 题图 hash/regions、E∈AD 与 F∈AB 的宿主确认、完整面环仍未获独立审核；不能用本区块替代这些证据。
- 生产完整证书、统一 runner、显示策略/结果消费、第二独立 reviewer 全量复审以及 T15/T16 仍未完成。

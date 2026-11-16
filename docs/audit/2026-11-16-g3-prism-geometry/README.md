# G3 / T01 完整棱柱几何合同

- **日期**：2026-11-16
- **范围**：GK-S05 正四棱柱、JT-S02 三棱柱的完整几何与对应棱；T01/P0 未退出，未修改独立审核状态。
- **起点**：`f93bffef test(eval): require scoped algebraic infeasibility evidence`。

## 1. 缺口与 RED

第二轮 reviewer 指出：GK-S05 缺第二垂直方向、AD=2 与完整对应棱；JT-S02 缺三棱柱平移与对应棱。实核还发现 GK-S05(1) 的 `B₂C₂∥A₂D₂` 只有自由文字，没有可执行义务。

先加入下列正反例，得到 **2 failed / 37 passed**：正确候选的结果中没有新增必需义务，旧合同不能完整表达原题。

- **斜四棱柱**：上底面相对下底面平移 `(0,2,√12)`，AA₁ 仍为4且仍垂直 AB，但不垂直 AD；所有 A₂/B₂/C₂/D₂ 保持各自棱上比例。不能因局部长度和闭合面壳放行正四棱柱。
- **缩短 AD**：D、D₁、D₂ 同步改变，保留局部垂直和中间点比例，但底面不再是边长2的正方形。
- **错对应顶点**：移动 C₁ 并保持 C₂ 比例，破坏 AA₁=CC₁。
- **错三棱柱平移**：移动 B₁，破坏 AA₁=BB₁、AB=A₁B₁、BC=B₁C₁；不能由普通闭合五面体替代三棱柱。

## 2. 最小合同实现

复用既有 `distance-3d`、`perp-3d`、`vector-equal-3d` 与 `topology-3d`，不新增第二套求值器或容差。

### GK-S05（新增10条义务）

- `ob-ad`：AD=2。
- `ob-aa1-ad`：AA₁⊥AD；与已有 AB⊥AD、AA₁⊥AB 共同锁定正四棱柱方向。
- `ob-base-ab-dc`、`ob-base-ad-bc`：底面两组有向边相等。
- `ob-aa1-bb1`、`ob-aa1-cc1`、`ob-aa1-dd1`：侧棱是同一平移向量。
- `ob-top-a1b1-d1c1`、`ob-top-a1d1-b1c1`：上底面两组有向边相等；结合同一侧棱向量核验上下底对应关系。
- `ob-1-b2c2-a2d2`：scope `(1)` 中 B₂C₂=A₂D₂，故 B₂C₂∥A₂D₂；证明目标只作核验，不当作前提省略。

### JT-S02（新增5条义务）

- `ob-translation-aa1-bb1`、`ob-translation-aa1-cc1`：三棱柱三条侧棱共享平移向量。
- `ob-corresponding-ab-a1b1`、`ob-corresponding-bc-b1c1`、`ob-corresponding-ca-c1a1`：底面与上底面的对应边同向相等。

已有 `ob-ac-bb1` 不存在：AC⊥BB₁ 是可由题设证明的目标，不能重新塞回前提。两条 P 的比例与二面角义务保持原样。

## 3. 数据修正与 GREEN

首次补合同时，`ob-ad` 的第二端点误写为 `d`，正例明确报告 `missing 3d vertex undefined`，改为既有接口的 `b: "D"`。测试斜棱柱数组也遇到 `type: string` 不能缩窄 position 属性的类型错误，改用 `position in primitive`；随后定向 **39/39 passed**、类型检查通过。这些是新增合同/测试数据修正，没有放宽实现判据。

- 全量 Vitest：**540 files / 5735 passed + 1 todo / 0 failed**。
- 类型检查：通过（workspaces、e2e、scripts）。
- Lint：**0 errors / 33 pre-existing warnings**。
- Web build：**640 modules transformed**，成功。
- 合同与文档守卫：**9 files / 61 tests passed**。
- 未运行离线 reliability runner，不新增36题或provider通过读数。

## 4. 未关闭项

- GK-S05(2) 的120°不可行诊断仍需专用数值/代数证据，不能由本棱柱区块代替。
- 平面动点最值/范围、JT-S01/JT-S04/JT-S08 的剩余范围与折叠状态、生产完整证书与统一 runner。
- `displayPolicy/expectedResult` 消费、第二独立 reviewer 全量复审、T15/T16 的真实渲染/人工签收与 Windows 桌面生命周期。

# G3 / T01 跨状态折叠谱系

- **日期**：2026-11-16
- **范围**：JT-S04 的 EF 翻折与通用跨状态评测入口；不是全部折叠题或生产36题通过。T01/P0 未退出，未修改独立审核状态。

## 1. 真实变换合同

新增 `fold-transform-3d`：

- `beforeStateId` / `afterStateId` 绑定折前折后候选。
- 有序 `hinge` 与 `angleDegrees` 指定旋转方向；A→A、B→B 等 `moving` 映射允许折后改名。
- 内核 `rotatePointAboutHinge` 重算目标位置，铰链漂移和移动点误差按既有尺度容差处理，不新放宽容差。
- 缺状态、缺点、铰链漂移或不符合真实旋转均失败，不以局部面面垂直替代刚体变换。

JT-S04 的义务 `ob-fold-transform` 使用 `F→E, +90°`，A/B 在两状态中保持同一实体。`scopeId:"fold_lineage"` 用于独立谱系检查，不把折后坐标错误代入折前长度。

## 2. RED → GREEN

1. 未接 `stateCandidates` 与 `fold-transform-3d` 时，谱系检查失败，暴露旧语义不能关联两个状态。
2. 首次内核误差为10，诊断输出 `expected={x:5,y:0,z:-5}`、`actual={x:5,y:0,z:5}`：测试的 `F→E,+90°` 与合同 `E→F,+90°` 是不同镜像。修正有向铰链，不忽略旋转方向或修改容差。
3. 真实 F→E 旋转通过。伪造候选 A.y=1、B.y=h+1、C.y=12/(h+1)，`CF⊥BD`、两平面垂直和开放面环均仍成立，但 A/B 不满足同一旋转，谱系检查拒绝。
4. 聚合接口初时不存在，新增 `evaluateDrawingContractStates` 的调用 RED 后补齐。缺 `after_fold` 返回 `incomplete`，伪造状态返回谱系失败。
5. 最后39项目标合同与类型检查通过。谱系测试明确只取变换义务，折前/折后其他条件继续分别检查，不删条件。

## 3. 统一状态聚合

`evaluateDrawingContractStates`：

- 按 `multiStateHandling` 的 `enumerate:` 枚举必需状态，也支持显式状态集合。
- 将同一 `stateCandidates` 映射传给各状态核验及独立谱系结果，避免 each state 各拿一组坐标就算翻折。
- 返回 `scopeResults` 与 `lineageResult`；缺必需状态是 `incomplete`，局部或失败不冒充完整通过。
- 尚未接入生产 stage/runner，不能用该离线合同接口替代生产证书或真实桌面生命周期。

## 4. 验证与真实 provider 边界

- 定向39项、全量 **540 files / 5735 passed + 1 todo / 0 failed**；类型检查通过；Lint **0 errors / 33 pre-existing warnings**；Web构建 **640 modules**；合同与文档守卫 **9 files / 61 tests passed**。
- 本区块**未再次运行离线 reliability runner**，不新增离线36题读数。
- 已完成的 DeepSeek 最小真实验证保留：1 planned / 2 clarification / 0 error，见[DeepSeek真实结果](../2026-11-16-g3-deepseek-provider/README.md)。它不是刚体折叠的自动证明，也不是固定36题验收。
- 未读取或输出新密钥，未自动扩大真实请求规模。

## 5. 未关闭项

- GK-S02 等缺少经核对题图的折叠拓扑/宿主不能猜测；其他折叠题需逐题绑定状态与旋转。
- 切线点名绑定、函数表达式与动点范围/最值、棱柱完整几何、指定球半径仍未闭合。
- 生产完整证书、统一 runner、T15/T16、人工签收及 Windows 桌面验收未完成。

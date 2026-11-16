# G3 / T01 第一批合同安全整改

- **日期**：2026-11-16
- **范围**：在第二独立审题 `changes_required` 后，修复第一批可独立验证的合同与评测漏洞。
- **边界**：本区块不是 T01/P0 或 G3-Math 退出。suite/case 继续保持 `pending_second_reviewer`；其余平面关联义务、立体拓扑、显示策略和生产构造仍需后续区块。

## 1. 已落地修复

### 不可行 scope 与伪造拒绝

- `infeasible-branch` 改为声明 `forbiddenEntityIds`，不再写死 `(2)` 和点 P 的特判。
- JT-P06：即使有结构化不可行标记或“不存在”文字，只要候选含 P 就拒绝；诚实底图加披露仍通过。
- GK-S05：从全局必需实体中移除不可行分支的 P，把“P 仅存在”改为 scoped `ob-infeasible-2`。正四棱柱底图加不可行披露可通过，伪造 P 必拒绝。
- JT-P04(2)：按独立推导改为不可行，删除伪解 `P(0,-2)`，保留不存在实数点的理由。

### scope 与二面角

- 新增 `evaluateDrawingContractScopes`：每个小问使用独立候选与选项，只计算 `stem + 当前 scope` 的义务；缺任一必需 scope 不得通过。
- GK-S01：补第(1)问 `AD⊥PB`、第(2)问 `AD⊥DC` 和 `sin(A-CP-D)=√42/7`。测试分别使用证明分支和测量分支，证明只给测量分支时不能整题通过。
- 新增沿棱投影的 `dihedral-sine-3d` / `dihedral-cosine-3d` 独立计算，拒绝零长棱和退化面投影。
- JT-S02：删除被误当 stem 的证明目标 `AC⊥BB₁`，恢复真正的 `平面AA₁C₁C⊥平面BB₁C₁C`；补 P 在 A₁B₁ 上的比例 `1−√2/2` 及 `cos(P-BC-C₁)=√6/3`。

### 结构谓词与数学错误

- `prism-3d`：等棱直三棱柱使用6顶点的距离集验证（9条棱、6条面对角线），不再接受任意6点多面体。
- `circumsphere-3d`：使用真实 DSL `sphere` 的球心/半径，验证多面体全部顶点共球。
- `cube-3d`：使用8顶点的12条棱、12条面对角线、4条体对角线验证棱长。
- `hemisphere-3d`：验证底面中心、顶点共球及指定半径，不再忽略半径或依赖不存在的 `sphere3`/`hemisphere3` 类型。
- GK-P04：参数范围由错误的 `(-∞,4]` 改为独立求得的 `[-1,+∞)`，并写入第(2)问期望结果。

### 稳定实体绑定

- `function-sample-2d`、`line-through-2d`、`line-vertical-2d` 新增 `entityId`，按语义 ID/label、图元类型和唯一匹配核验；同名歧义拒绝。
- GK-P04 的 f/g 交换反例不再通过；加入一条能满足旧“任意直线过点”的替身，也不能替代声明的 tangent。
- 所有现有函数采样/直线合同已补实体 ID；未命名切线/宿主使用显式语义名 `tangent`/`host`。

## 2. RED → GREEN 证据

| 反例 | 实现前实测 | 修复后 |
| --- | --- | --- |
| JT-P06 伪造 P＋“不存在”文字 | `forgedWithDisclaimer.passed === true`，RED | 拒绝，诚实披露保留 GREEN |
| GK-S05 无 P 的诚实不可行分支 | 因全局必需 P 而失败，RED | 无 P 通过；伪造 P 失败 |
| GK-S09 正确三棱柱与真实 `sphere` | 旧判据不识别真实球体，RED | 正例通过；错误尺寸和虚假 `sphere3` 拒绝 |
| JT-S09 正确内接正方体 | 旧判据不识别真实球体，RED | 正例通过；错棱长/错半径拒绝 |
| GK-S01 双 scope 证据 | `evaluateDrawingContractScopes is not a function`，RED | 双分支通过；缺证明分支不通过 |
| JT-S02 P 宿主/二面角 | 新义务不存在且中点可通过，RED | 正确比例通过，中点拒绝 |
| GK-P04/JT-P04 数学纠错 | 旧范围/伪解断言失败，RED | 新数学合同通过 |
| f/g 交换与替身直线 | 旧任意函数/任意线判据放行，RED | 交换和替身均拒绝 |

- 定向最终：`npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000` → **1 file / 16 tests passed**。
- 全量：`npm.cmd test -- --testTimeout=30000` → **540 files / 5712 passed + 1 todo / 0 failed**。
- 类型检查：`npm.cmd run typecheck` → exit 0。首次新增球体读取时有 `radius: unknown` 编译错误，改为显式数值守卫后通过。
- Lint：`npm.cmd run lint` → exit 0，0 errors / 33 pre-existing warnings。
- Web 构建：`npm.cmd run --workspace @draw/web build` → exit 0，640 modules。

## 3. 最新冻结 36 题实测（不是出口）

```bash
npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json
```

- 退出码 0，驱动 `1 file / 3 tests passed`。
- 最新报告：`eval-results/reliability/offline-2026-11-16T05-37-54.998Z-44772/`。
- **1 passed / 10 partial / 25 failed / 0 incomplete**；对象覆盖约 28.0%，义务覆盖约 23.3%。
- 相比实核基线 2 passed，GK-S01 现在只得到 partial，因为新义务暴露了原先未验的小问。义务覆盖下降来自补齐漏检条件。这是更诚实的测量，不用回退判据恢复旧数字。

## 4. 尚未关闭

- 多数平面题仍缺关联对象、切线/交点、共线、定义域和分支义务；不能只补曲线轮廓。
- 多数立体题仍缺面环、共面、拓扑、折前折后状态和题图来源；13个文字含“如图”的 case 不得猜未提供题图。
- `requiredEntityIds` 仍需完整类型化；`displayPolicy`、`expectedResult` 和多分支策略尚需进入实际验收。
- 统一 runner 尚需把 scope 聚合接入全部生产/离线路径；当前新增义务已使错误的整题通过下降，但不能满足于此。
- 生产完整证书、平面18/18、立体18/18、真实渲染和交互均未达到。独立 reviewer 尚未对本整改切片复审，T01/P0 继续保持未退出。

# F9 三次零费用重复复测与修复方案定位

- 本地日期 2026-11-17（America/Los_Angeles）；当前代码修订 `0267dd61`；**本轮新增DS真实请求0次**。上一轮单题 GK-S08 的8请求动作级真实试点见[原审计](../2026-11-17-g3-f9-ds-action-pilot/README.md)，**不要合并为本轮使用量**。
- 从当前源码打包 `createDsActionSession` 与 `createEmptyDocument("geometry3d")`，使用3组不同形状/尺寸执行相同构造序列：`construct_solid → construct_face → finish_candidate`；检查真实 `SpeculativeCanvas.snapshot()`。三组结果：[脱敏结果](results.json)。原始临时脚本与被忽略报告在 `eval-results/g3-f9-repeat-probe-20261117/`，本区块不读取/导出模型密钥。

| 形状参数族 | `construct_solid` | `construct_face` | `finish_candidate` | 最终图元 |
| --- | --- | --- | --- | ---: |
| square_pyramid（边2/高3） | accepted | accepted | repairable / empty_candidate | 0 |
| triangular_prism（边3/高4） | accepted | accepted | repairable / empty_candidate | 0 |
| tetrahedron（边2） | accepted | accepted | repairable / empty_candidate | 0 |

**确定性根因：** `apps/web/src/agent/dsActionTools.ts` 的 `construct_solid` 只拒绝模型手算 `vertices`，对其余参数直接返回 accepted，却没有调用 `solveConstraint3d` 或 `SpeculativeCanvas.applyAction`；`construct_face` 没有专属分支，落入末尾无条件 accepted；`query_measurement`/`query_constraint_status` 从代码上也仅返回 accepted 而非实际几何读数。即便 DS 继续请求，也不会因这些工具产生对象。三次是零费用本地内核重复复现，**不是**三次额外 DS 付费样本，不能给出新版DS通过率。

按[新的修复计划](../../g3-final/G3-F9-kernel-action-repair-plan.md)先做 Task 0 fail-closed，再将已支持参数族真实接到 `constraintSolve3d` 与注册动作，通过候选 hash/对象/数学验收；读数、停滞修复、多状态 live 接线按依赖推进。当前修订不可再扩大付费；真实复测应待新代码通过零费反例后重新确认额度。
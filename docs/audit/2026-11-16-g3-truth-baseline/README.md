# G3 实核基线与 T01 第二独立审题

- **日期**：2026-11-16
- **代码 revision**：`8c26544c0d440c1605b1fbc7c677bbd3783277fe`
- **范围**：G3-Math 真相基线与 T01 合同复核，不是产品修复 GREEN，不是 36 题通过报告。
- **独立 reviewer**：fresh independent coder subagent（agent-0），未参与合同撰写；顺序、只读复核，未再派生代理，未修改文件，未使用网络或付费 provider。
- **结论**：`changes_required`。suite 保持 `pending_second_reviewer`；仅 `GK-P08` 的作图数学合同可批准，其余 35 题仍有未解决 Critical/Important 合同问题。

## 1. 全量基线复跑

命令（仓库根目录）：

```bash
npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json
```

- 退出码：0；Vitest 驱动 `1 file / 3 tests passed`。
- 冻结 36 题独立合同结果：**2 passed / 10 partial / 24 failed / 0 incomplete**。
- `meanObjectCoverage = 0.2800925925925926`；`meanObligationCoverage = 0.25667989417989423`。
- `requests=36`，`liveWrites=0`，输入/输出 token 均为 0，`costKnown=false`。
- 原始报告（Git 忽略目录）：`eval-results/reliability/offline-2026-11-16T04-29-01.189Z-40284/`。
- 重要口径：驱动测试通过只说明评测完成，**不等于 36 题通过**。当前 `GK-S01` 的 `passed` 也只覆盖公共底图，不能视为整题通过。

环境与基线工程验证：随后执行 `npm.cmd install`（无 tracked manifest/lock 差异）及 `npm.cmd test -- --testTimeout=30000`，全量 **540 文件 / 5705 passed + 1 todo / 0 failed**。安装时 npm 报告 7 条 moderate 公告；这是新的环境信号，不覆盖 R11 的历史审计，也未在本区块进行依赖升级或修复。

## 2. 已确认的入口差异

- `GK-S02`：`routeDeterministicProblem(prompt)` 无路由，回退 `createLocalPlanner()` 后以“本地规划器无法识别”进入 `waiting`，零图元。不能把这种能力缺口写成用户题文缺失。
- `GK-P01`：独立合同对象与义务覆盖均为 1，但生产 stage 的 `verificationStatus=not_supported`，最终无草稿。说明正确候选、生产完整证书与确认链尚未闭环。
- 上述差异只是后续调试入口，不授权给评测器开后门或按题号补模板。

## 3. 独立复核覆盖与机械核对

**36/36 逐题复核完成（plane 18、solid 18），不是抽样。**

- 36 个 case 的 id、分类、来源、prompt 均与 `docs/audit/2026-11-15-drawing-baseline/manifest.json` 对齐。
- 36 个 prompt 的 UTF-8 SHA-256、`inputHash`、`sourceHash` 全部一致。
- 所有 `requiredObligation.sourceSpan` 精确切片均等于其 `text`。
- 固定分母 36，suite/case 均保持 `pending_second_reviewer`。
- 未发现生产构造器导入黄金 fixture，未发现按具体 `GK-*`/`JT-*` case id 分支的生产代码。
- 机械一致只证明来源冻结与结构完整，不证明数学语义正确。

### 平面 18 题

| Case | 复核结论 | 必须整改的语义缺口 |
| --- | --- | --- |
| GK-P01 | changes_required | `l` 未绑定 A/B，A/B 只需各自在椭圆上；O(0,0) 未检查，两个斜率分支未按显示策略处理。 |
| GK-P02 | changes_required | 缺 P/M/N 共线、T 在过 M 的水平线及线段 AB 上。 |
| GK-P03 | changes_required | M/N/A/B 在抛物线上的身份、“另一个交点”与最大角分支未建模。 |
| GK-P04 | changes_required | `a∈(-∞,4]` 数学错误，正确值域为 `[-1,+∞)`；函数与公共切线检查不足。 |
| GK-P05 | changes_required | P/Q、OP⊥OQ、三个 Aᵢ 在 C 上及两条切线未检查。 |
| GK-P06 | changes_required | DA/DB 切线、A/B 切点、圆在 AB 中点相切均缺失。 |
| GK-P07 | changes_required | P 在圆 M 上、PA/PB 切于 C 及切点没有义务。 |
| GK-P08 | **approved（仅作图数学）** | `m=√3/3` 及精确双曲线、圆在数学上等价锁定相切条件；对象覆盖指标仍另有 Minor 缺口。 |
| GK-P09 | changes_required | 两个采样不能确定函数，任意过 `(0,1)` 的直线不能证明是切线。 |
| JT-P01 | changes_required | 两问垂直平分线、与椭圆相切/唯一公共点及 M 的构造约束未检查。 |
| JT-P02 | changes_required | P 未检查在 `x=-1`，M/N 未检查在双曲线上，未绑定 PA₁/PA₂。 |
| JT-P03 | changes_required | `OA·OB=-4` 是目标非题设；AB 过 `(2,0)`、D/E 交点及 `l` 斜率缺失。 |
| JT-P04 | changes_required | 切线/准线垂足未验；共圆条件实际无实数解，`P(0,-2)` 是伪解。 |
| JT-P05 | changes_required | P/Q/A/B 曲线身份、PQ 过 M、AB 过 F 且平行 PQ 未检查，C 未列入必需实体。 |
| JT-P06 | changes_required | 不可行结论正确，但不可行谓词可被“伪造 P＋一句不存在”绕过。 |
| JT-P07 | changes_required | A/B 坐标、`l` 过 `(1,0)`、P/Q 共线、E/F 在 `x=3` 上未检查。 |
| JT-P08 | changes_required | 向量比检查有效，但轨迹遗漏 `x≠0`，两个 EF 方程分支未执行显示策略。 |
| JT-P09 | changes_required | A/B/C/D 在圆上、AC/BD 过 O 及面积/选项未验证。 |

### 立体 18 题

| Case | 复核结论 | 必须整改的语义缺口 |
| --- | --- | --- |
| GK-S01 | changes_required | 两问局部条件全部未进入 requiredObligations；当前 passed 只覆盖公共底图。 |
| GK-S02 | changes_required | 平面四边形共面、折叠拓扑未验；E/F 宿主只能来自未提供的题图。 |
| GK-S03 | changes_required | 五面体面环、连通、方向和非退化拓扑未检查。 |
| GK-S04 | changes_required | ABCD 共面与四棱锥面环/拓扑未检查。 |
| GK-S05 | changes_required | 120° 不可行结论正确，但全局强制 P 存在且未查 P∈BB₁，没有 scoped 不可行义务。 |
| GK-S06 | changes_required | 三棱锥棱/面实体和拓扑未验收，点集本身即可通过。 |
| GK-S07 | changes_required | B₁/C₁ 未被任何检查引用，棱柱对应边/平移关系缺失。 |
| GK-S08 | changes_required | 底面四边形方向/面环及四棱锥拓扑未检查。 |
| GK-S09 | changes_required | `prism-3d` 不检查等棱，`circumsphere-3d` 不检查顶点共球。 |
| JT-S01 | changes_required | PC⊥AB、球 O、四点共球未检查，`(1)` scope 未区分 `(1)(i)/(1)(ii)`。 |
| JT-S02 | changes_required | 把证明目标 AC⊥BB₁ 当 stem，真正面面垂直漏检；P 的棱上位置与二面角缺失。 |
| JT-S03 | changes_required | M 未检查在平面 PCD 内，AM 未垂直两个不共线方向，不能表示垂足。 |
| JT-S04 | changes_required | BC/AD、平行/直角、E 内点、折后面面垂直、CF⊥BD 均缺失。 |
| JT-S05 | changes_required | 矩形缺 AD/CD 与面环约束，等边三角形缺 CD 条件。 |
| JT-S06 | changes_required | “多面体 ABCDE”的图依赖拓扑没有来源或检查。 |
| JT-S07 | changes_required | 五面体拓扑未检查。 |
| JT-S08 | changes_required | 平面 ACFE⊥平面 ABCD 漏检，矩形不完整，M 未约束在 EF 上。 |
| JT-S09 | changes_required | `cube-3d` 忽略棱长，`hemisphere-3d` 忽略半径，也不验证内接关系。 |

## 4. 阻断批准的 Critical 合同问题

1. **scope 未执行且局部条件丢失**：GK-S01 两问条件只存在于说明字段；评测器直接汇总全部义务，不读取 scope。JT-S01、JT-S04 也有缺漏。只画公共底图、混入另一问条件都必须成为反例。
2. **不可行域编码矛盾**：GK-S05(2) 不可行却全局要求 P；JT-P06 可用任意“无解/不存在”文字加伪造 P 通过。结构化不可行证据必须绑定 case/scope，且该 scope 禁止构造假设点。
3. **目标与题设颠倒**：JT-S02 把证明目标 AC⊥BB₁ 当 stem，真正的面面垂直缺失；JT-P03 同样把待判断 dot 值作为检查而漏构造关系。
4. **明确数学错误**：GK-P04 的正确值域为 `[-1,+∞)`，反例 `a(2)=57/4`；JT-P04(2) 共圆条件不存在实数解，`P(0,-2)` 是伪解。
5. **结构谓词名实不符**：GK-S09/JT-S09 的棱柱、正方体、球/半球谓词忽略棱长、半径和内接关系。
6. **平面关联义务缺失**：GK-P01/P02/P03/P05/P06/P07/P09、JT-P01/P02/P03/P05/P07/P09 均可让不满足原题构造的对象组合通过。
7. **立体宿主与拓扑缺失**：GK-S07、JT-S03/S04/S05/S08 等存在未引用必需点、垂足不在平面、矩形不完整、折后状态缺失等问题。

详细行号以 reviewer 对 `test-fixtures/reliability/drawing-contracts-36.json` 的复核为准：GK-S01 51–219；GK-S05 1054–1320；JT-P06 6337–6349；JT-S02 2400–2487；GK-P04 4688–4747；JT-P04 5973–6046；GK-S09 2019–2075；JT-S09 3948–4004；结构谓词位于 `scripts/reliability-eval/drawingContracts.ts:437-449`。

## 5. Important 系统性缺口

- **拓扑与题图来源**：多道立体题只验点间距离/角度，没有面共面、面环、方向、连通、闭合/开放和折叠状态。13 个 `text_with_figure_reference` 没有图像 hash/区域或经核对拓扑；不能猜未提供题图，须显式 unknown/clarification 或限定文字可推子合同，仍保留 36 分母。
- **定义域与分支**：JT-P08 的 `x≠0` 与两个 EF 分支未进入实际验收。
- **稳定实体绑定**：`entity-present` 与 `requiredEntityIds` 只按 label；`line-through-2d` 无 line ID；`function-sample-2d` 可在任意函数中找样本。同名错类型、一线多用、f/g 互换均须成为反例。
- **显示策略和子问未消费**：`subquestions`、`displayPolicy`、`allowOmittedSubquestion`、`multiBranchHandling`、`expectedResult` 没有进入 passed 判据。作图数学、题目答案、渲染和交互必须分开计量。

## 6. Minor 与复核边界

- GK-S09、JT-S09、GK-P09、JT-P09 的 `subquestions[].text` 嵌入正确选项，应保持中性目标文本并与 `expectedResult` 分离。
- 空 `requiredEntityIds` 会使对象覆盖直接为 1；GK-P08 的精确曲线义务仍能阻止空候选，因此这只是指标问题，不影响本次对其作图数学的批准。JT-P05 应补曲线 C 的稳定 ID。
- 未核验外部原卷历史版本，不猜未提供题图的像素内容；不把自动证明全课程命题纳入本轮。生产提分、真实渲染、桌面交互与付费行为不在本次合同复核范围。

## 7. 退出结论与下一步

本区块只完成“真实基线＋第二独立审题”。**T01 未通过第二复核，P0 不得退出，G3-Math 必须保持进行中。** 下一区块先整改合同及评测语义（scope、不可行、实体绑定、拓扑、定义域/分支与显示策略），每类漏洞先有 RED 反例，再逐题复核；不得仅修改文字后自行标记 approved。

Reviewer 已运行：

```bash
npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts scripts/docs-consistency --testTimeout=30000
```

其结果为 **9 files / 31 tests passed**。该结果验证结构与现有文档守卫，不改变本审计的 `changes_required` 结论。

主执行者在文档对齐后复跑同一命令：首次因阶段表标题漏写计数而 RED（`1 failed / 30 passed`），随后补回真实的“0 件已解决、9 件待定”并 GREEN（**9 files / 31 tests passed**）；未修改或放宽文档守卫。
